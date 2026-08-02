// ========== 台水淨水場/供水轄區（很少變動的參考圖層）==========
// 資料來源：台灣自來水公司開放資料「供水轄區資訊」，使用者上傳 CSV。
// 全國資料量小（約500筆），不分縣市、上傳後直接全部顯示，不用分批勾選。
// 這個圖層歸類在「圖層設定」面板裡（跟 WGIS 一樣是不常變動的參考底圖），
// 不佔用抽屜按鈕。

let supplyZones = [];
let supplyZoneLayer = null;
let supplyZoneVisible = false;
let supplyZoneLoaded = false;

function szCanEdit() {
    return typeof currentUser !== 'undefined' && currentUser &&
        typeof getRoleLevel === 'function' && getRoleLevel(currentUser.role) >= 2;
}

function szEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
        m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

async function loadSupplyZones() {
    if (supplyZoneLoaded) return;
    try {
        const res = await apiCall('getSupplyZones', {}, { silent: true });
        supplyZones = res.zones || [];
        supplyZoneLoaded = true;
        renderSzMeta(res);
    } catch (e) {
        console.warn('載入供水轄區失敗:', e);
    }
}

function renderSzMeta(res) {
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
        marker.bindPopup(szPopup(z));
        supplyZoneLayer.addLayer(marker);
    });
    supplyZoneLayer.addTo(map);
}

async function toggleSupplyZoneLayer() {
    supplyZoneVisible = !supplyZoneVisible;
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
        supplyZones = []; supplyZoneLoaded = false;
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
