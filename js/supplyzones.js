// ========== 台水淨水場/供水轄區（很少變動的參考圖層）==========
// 資料來源：台灣自來水公司開放資料「供水轄區資訊」，使用者上傳 CSV。
// 全國資料量小（約500筆），不分縣市、上傳後直接全部顯示，不用分批勾選。
// 這個圖層歸類在「圖層設定」面板裡（跟 WGIS 一樣是不常變動的參考底圖），
// 不佔用抽屜按鈕。

let supplyZones = [];
let supplyZoneLayer = null;
let supplyZoneVisible = false;
let supplyZoneLoaded = false;
let _szLastMeta = null;      // 保留最後一次的中繼資料，供快取情況下重繪按鈕權限用

function szCanEdit() {
    return typeof currentUser !== 'undefined' && currentUser &&
        typeof getRoleLevel === 'function' && getRoleLevel(currentUser.role) >= 2;
}

function szEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
        m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

async function loadSupplyZones() {
    // 就算資料已快取，也要重跑一次 renderSzMeta 來套用按鈕權限
    // （面板每次打開都會呼叫這裡，登入狀態可能已改變）
    if (supplyZoneLoaded) { renderSzMeta(_szLastMeta); return; }
    try {
        const res = await apiCall('getSupplyZones', {}, { silent: true });
        supplyZones = res.zones || [];
        supplyZoneLoaded = true;
        _szLastMeta = res;
        renderSzMeta(res);
    } catch (e) {
        console.warn('載入供水轄區失敗:', e);
    }
}

function renderSzMeta(res) {
    // 依權限決定上傳/刪除鈕是否顯示（訪客只能看，不能改動別人上傳的資料）
    const canEdit = szCanEdit();
    const upBtn = document.getElementById('szUploadBtn');
    const delBtn = document.getElementById('szDeleteBtn');
    if (upBtn) upBtn.style.display = canEdit ? '' : 'none';
    if (delBtn) delBtn.style.display = canEdit ? '' : 'none';

    const el = document.getElementById('szMeta');
    if (!el) return;
    if (!res || res.empty || !res.count) {
        el.innerHTML = '<span style="color:#999;">尚未上傳資料</span>';
        return;
    }
    el.innerHTML = '共 <b>' + res.count + '</b> 個站點' +
        (res.uploadedAt ? '<br><span style="color:#aaa;font-size:10px;">' +
            szEsc(res.sourceFile || '') + '，' + String(res.uploadedAt).slice(0, 10) + ' 上傳</span>' : '');
}

function szPopup(z) {
    let h = '<div style="min-width:200px;max-width:300px;font-size:12px;">';
    h += '<div style="font-weight:bold;color:#00838F;margin-bottom:6px;">💧 ' + szEsc(z.name) + '</div>';
    if (z.supplyArea) h += '<div style="margin:3px 0;white-space:pre-line;"><b>供水轄區：</b>' + szEsc(z.supplyArea) + '</div>';
    if (z.waterSource) h += '<div style="margin:3px 0;color:#666;"><b>原水來源：</b>' + szEsc(z.waterSource) + '</div>';
    h += (typeof buildNavLink === 'function' ? buildNavLink(z.lat, z.lng) : '');
    h += '</div>';
    return h;
}

function renderSupplyZoneLayer() {
    if (supplyZoneLayer) { map.removeLayer(supplyZoneLayer); supplyZoneLayer = null; }
    if (!map || !supplyZoneVisible) return;
    supplyZoneLayer = L.layerGroup();
    supplyZones.forEach(z => {
        const marker = L.circleMarker([z.lat, z.lng], {
            radius: 5, fillColor: '#00838F', color: '#fff', weight: 1.5,
            opacity: 1, fillOpacity: 0.85,
        });
        marker.bindPopup(() => szPopup(z));   // 點開才產生，約500站不用先全部組好
        supplyZoneLayer.addLayer(marker);

        // 站名標籤：依類型分兩種門檻與顏色
        //   淨水場/淨水廠/淡化廠/取水站 → 紅字紅框，倒數第八層（maxZoom-7）顯示
        //   井類                        → 黑字黑框，倒數第六層（maxZoom-5）才顯示
        //
        // 井的判定要小心：不能只看有沒有「井」字，因為「龍井」是地名
        // （龍井山頂區淨水場實際是淨水場）。所以限定「以井結尾」或
        // 「N號井 / N井 / N號更新井」這種明確的編號井格式。
        // 反之「沙鹿12號井淨水場」雖然叫淨水場，實際是井，會被正確歸到井類。
        const isWell = /井$/.test(z.name) || /\d+\s*(號)?(更新)?井/.test(z.name);
        const isPlant = !isWell && /淨水場|淨水廠|淡化廠|取水站/.test(z.name);
        const cls = isPlant ? 'zoom-supplyplant-label' : 'zoom-supplyzone-label';
        const color = isPlant ? '#c62828' : '#000';
        const label = L.marker([z.lat, z.lng], {
            icon: L.divIcon({
                className: cls,
                html: '<div style="position:relative;">' +
                    '<div style="position:absolute;left:8px;top:-9px;white-space:nowrap;' +
                    'font-size:11px;font-weight:bold;color:' + color + ';background:#fff;' +
                    'padding:2px 6px;border-radius:3px;border:1.5px solid ' + color + ';' +
                    'box-shadow:0 1px 3px rgba(0,0,0,0.25);pointer-events:none;">' +
                    szEsc(z.name) + '</div></div>',
                iconSize: [1, 1],
                iconAnchor: [0, 0],
            }),
            interactive: false,   // 標籤本身不接收點擊，點擊落在下面的圓點觸發 popup
        });
        supplyZoneLayer.addLayer(label);
    });
    supplyZoneLayer.addTo(map);

    // 新建立的標籤要立刻套用目前縮放層級該有的顯示狀態，
    // 不然會先全部顯示一瞬間才被隱藏（或反過來），畫面會閃一下。
    if (typeof window.updateNodeLabelVisibility === 'function') window.updateNodeLabelVisibility();
}

async function toggleSupplyZoneLayer() {
    supplyZoneVisible = !supplyZoneVisible;
    // 記住使用者的選擇，下次進來沿用（見 js/default-layers.js）
    if (typeof rememberLayerPref === 'function') rememberLayerPref('supplyzone', supplyZoneVisible);
    const opt = document.getElementById('layer-supplyzone');
    if (opt) {
        const box = opt.querySelector('.layer-checkbox');
        if (box) box.textContent = supplyZoneVisible ? '☑' : '☐';
    }
    if (supplyZoneVisible) {
        if (!supplyZoneLoaded) await loadSupplyZones();
        renderSupplyZoneLayer();
    } else if (supplyZoneLayer) {
        map.removeLayer(supplyZoneLayer);
        supplyZoneLayer = null;
    }
}

async function uploadSupplyZoneFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!szCanEdit()) { showToast('需登入且具編輯權限才能上傳', 'error'); return; }

    const btn = document.getElementById('szUploadBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 解析中…'; }
    try {
        const text = await file.text();
        const res = await apiCall('uploadSupplyZones', {}, {
            body: { csv: text, fileName: file.name },
            errorPrefix: '上傳失敗',
        });
        showToast('已解析 ' + res.count + ' 個站點' + (res.skipped ? '（跳過 ' + res.skipped + ' 筆無效資料）' : ''), 'success');
        supplyZoneLoaded = false;
        await loadSupplyZones();
        if (supplyZoneVisible) renderSupplyZoneLayer();
    } catch (e) {
        console.error('上傳失敗:', e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📂 上傳 CSV'; }
    }
}

async function deleteSupplyZones() {
    if (!szCanEdit()) { showToast('沒有刪除權限', 'error'); return; }
    if (!confirm('確定刪除全部供水轄區資料？')) return;
    try {
        await apiCall('deleteSupplyZones', {}, { errorPrefix: '刪除失敗' });
        supplyZones = []; supplyZoneLoaded = false; _szLastMeta = null;
        if (supplyZoneLayer) { map.removeLayer(supplyZoneLayer); supplyZoneLayer = null; }
        showToast('已刪除', 'success');
        renderSzMeta(null);
    } catch (e) { /* apiCall 已提示 */ }
}

window.toggleSupplyZoneLayer = toggleSupplyZoneLayer;
window.uploadSupplyZoneFile = uploadSupplyZoneFile;
window.deleteSupplyZones = deleteSupplyZones;
window.loadSupplyZones = loadSupplyZones;
// ========== 供水轄區結束 ==========
