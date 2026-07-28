// ========== 公路局申挖路權圖層 ==========
// 資料來源：交通部公路局「道路申挖系統」即時 KML（僅涵蓋省道）
//   https://dgs.thb.gov.tw/thbdgs/CMMDGS/TEMP/DGS_{縣市}.kml
// 該網域擋伺服器自動抓取，改由使用者上傳 KML，worker 解析存 D1。
// 這個圖層直接顯示「所有已上傳縣市」的全部案件（不分縣市、不做關鍵字過濾）。
// 與 roadwork.js（台中市市區道路）是兩套不同系統，可同時開啟。

let dgsCases = [];            // 合併後的全部案件（每筆多帶一個 _city）
let dgsUploads = [];          // 各縣市上傳狀態
let dgsVisible = false;
let dgsPolyLayer = null;      // 真實挖掘面（放大時顯示）
let dgsPointLayer = null;     // 圓點（縮小時顯示）
let dgsLoading = false;
let dgsZoomBound = false;

const DGS_ZOOM_THRESHOLD = 17;   // 這個層級以上換成真實挖掘面
const DGS_COLOR = '#0288D1';        // 自來水＝藍
const DGS_COLOR_OTHER = '#9E9E9E';  // 其他管線＝灰

// 是否屬「自來水」案件：比對管線種類／申請單位／監造／施工單位
function dgsIsWater(c) {
    const hay = [c.pipeType, c.applyUnit, c.superUnit, c.workUnit].join('|');
    return hay.indexOf('自來水') >= 0;
}

// 可否編輯（上傳／刪除）：登入且權限 ≥ 2。訪客只能看。
function dgsCanEdit() {
    return typeof currentUser !== 'undefined' && currentUser &&
        typeof getRoleLevel === 'function' && getRoleLevel(currentUser.role) >= 2;
}

// ---------- 小工具 ----------
function dgsToday() {
    const d = new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

function dgsIsActive(c) {
    const today = dgsToday();
    const start = c.startDate || '';
    const end = c.extEndDate || c.endDate || '';
    if (!start && !end) return true;
    if (start && today < start) return false;
    if (end && today > end) return false;
    return true;
}

function dgsEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g,
        m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

function dgsFilteredCases() {
    const onlyActive = document.getElementById('dgsOnlyActive');
    if (onlyActive && !onlyActive.checked) return dgsCases;
    return dgsCases.filter(dgsIsActive);
}

// ---------- 載入（合併所有縣市）----------
async function loadDgsPermits() {
    if (dgsLoading) return;
    dgsLoading = true;
    const countEl = document.getElementById('dgsCount');
    if (countEl) countEl.textContent = '載入中…';

    try {
        // 1) 先拿有哪些縣市有資料
        const listRes = await apiCall('listDgsUploads', {}, { silent: true });
        dgsUploads = listRes.uploads || [];

        // 2) 逐縣市把案件抓回來合併（all=1 ＝ 不過濾）
        const merged = [];
        for (const u of dgsUploads) {
            const res = await apiCall('getDgsPermits', { city: u.city, all: '1' }, { silent: true });
            (res.cases || []).forEach(c => { c._city = u.city; merged.push(c); });
        }
        dgsCases = merged;

        renderDgsUploadList();
        updateDgsCount();
        renderDgsList();
        if (dgsVisible) renderDgsPermits();
    } catch (e) {
        console.error('載入申挖路權失敗:', e);
        if (countEl) countEl.textContent = '載入失敗：' + e.message;
    } finally {
        dgsLoading = false;
    }
}

function updateDgsCount() {
    const countEl = document.getElementById('dgsCount');
    if (!countEl) return;
    if (dgsUploads.length === 0) {
        countEl.innerHTML = '<span style="color:#999;">尚未上傳任何 KML</span>';
        return;
    }
    const shown = dgsFilteredCases();
    const pts = shown.reduce((s, c) => s + c.locations.length, 0);
    let h = '共 <b>' + shown.length + '</b> 件 / ' + pts + ' 個挖掘點';
    if (shown.length !== dgsCases.length) {
        h += '<br><span style="color:#999;">（已隱藏 ' + (dgsCases.length - shown.length) + ' 件非施工期間）</span>';
    }
    countEl.innerHTML = h;
}

// ---------- 繪製 ----------
function dgsPopupHtml(c, loc) {
    const active = dgsIsActive(c);
    const titleColor = dgsIsWater(c) ? DGS_COLOR : DGS_COLOR_OTHER;
    let h = '<div style="min-width:250px;max-width:320px;font-size:12px;">';
    h += '<div style="font-weight:bold;color:' + titleColor + ';margin-bottom:6px;">' +
        (dgsIsWater(c) ? '💧' : '⚙️') + ' 公路局申挖路權' +
        (active ? '' : ' <span style="color:#999;font-weight:normal;">(非施工期間)</span>') + '</div>';
    h += '<div style="margin:3px 0;"><b>核准文號：</b>' + dgsEsc(c.caseNo) + '</div>';
    h += '<div style="margin:3px 0;"><b>路線：</b>' + dgsEsc(c.route) + '</div>';
    h += '<div style="margin:3px 0;"><b>地點：</b>' + dgsEsc(c.locationDesc) + '</div>';
    if (loc && loc.segName) h += '<div style="margin:3px 0;"><b>樁位：</b>' + dgsEsc(loc.segName.replace(/^路段:/, '')) + '</div>';
    h += '<div style="margin:3px 0;"><b>管線種類：</b>' + dgsEsc(c.pipeType) + '</div>';
    h += '<div style="margin:3px 0;"><b>申請單位：</b>' + dgsEsc(c.applyUnit) + '</div>';
    if (c.workUnit) h += '<div style="margin:3px 0;"><b>施工單位：</b>' + dgsEsc(c.workUnit) + '</div>';
    h += '<div style="margin:3px 0;"><b>申請事宜：</b>' + dgsEsc(c.purpose) + '</div>';
    h += '<div style="margin:3px 0;color:#666;"><b>核准期間：</b>' + dgsEsc(c.startDate) + ' ~ ' + dgsEsc(c.endDate) +
        (c.startHour ? '（' + dgsEsc(c.startHour) + ':00-' + dgsEsc(c.endHour) + ':00）' : '') + '</div>';
    if (c.extEndDate) h += '<div style="margin:3px 0;color:#E65100;"><b>展延至：</b>' + dgsEsc(c.extEndDate) + '</div>';
    if (loc && (loc.length || loc.width)) {
        h += '<div style="margin:3px 0;color:#666;"><b>挖掘尺寸：</b>' + loc.length + ' m × ' + loc.width + ' m</div>';
    }
    if (c.contact) h += '<div style="margin:3px 0;color:#666;"><b>聯絡：</b>' + dgsEsc(c.contact) + ' ' + dgsEsc(c.contactPhone) + '</div>';
    if (loc && loc.photo) {
        h += '<div style="margin-top:6px;"><a href="' + dgsEsc(loc.photo) + '" target="_blank">' +
            '<img src="' + dgsEsc(loc.photo) + '" style="width:100%;border-radius:4px;" loading="lazy"></a></div>';
    }
    h += '</div>';
    return h;
}

function renderDgsPermits() {
    clearDgsLayers();
    if (!map) return;

    dgsPolyLayer = L.layerGroup();
    dgsPointLayer = L.layerGroup();

    // 先畫「其他管線」(灰)，再畫「自來水」(藍)，後加入者在上層 →
    // 重疊時自來水不會被灰色蓋住。
    const shownCases = dgsFilteredCases();
    const orderedCases = shownCases.filter(c => !dgsIsWater(c))
                                   .concat(shownCases.filter(dgsIsWater));

    orderedCases.forEach(c => {
        const active = dgsIsActive(c);
        const color = dgsIsWater(c) ? DGS_COLOR : DGS_COLOR_OTHER;

        c.locations.forEach(loc => {
            const popup = dgsPopupHtml(c, loc);

            if (loc.type === 'polygon' && loc.coords.length >= 3) {
                const poly = L.polygon(loc.coords, {
                    color: color, weight: 2, fillColor: color,
                    fillOpacity: active ? 0.45 : 0.2,
                    dashArray: active ? null : '4,3',
                });
                poly.bindPopup(popup);
                dgsPolyLayer.addLayer(poly);
            }
            if (loc.center) {
                const marker = L.circleMarker(loc.center, {
                    radius: 7, fillColor: color, color: '#fff', weight: 2,
                    opacity: 1, fillOpacity: active ? 0.9 : 0.5,
                });
                marker.bindPopup(popup);
                dgsPointLayer.addLayer(marker);
            }
        });
    });

    applyDgsZoomLevel();
    if (!dgsZoomBound) { map.on('zoomend', applyDgsZoomLevel); dgsZoomBound = true; }
}

// 縮小看圓點、放大看真實挖掘面
function applyDgsZoomLevel() {
    if (!dgsVisible || !map || !dgsPolyLayer || !dgsPointLayer) return;
    const z = map.getZoom();
    if (z >= DGS_ZOOM_THRESHOLD) {
        if (!map.hasLayer(dgsPolyLayer)) map.addLayer(dgsPolyLayer);
        if (map.hasLayer(dgsPointLayer)) map.removeLayer(dgsPointLayer);
    } else {
        if (map.hasLayer(dgsPolyLayer)) map.removeLayer(dgsPolyLayer);
        if (!map.hasLayer(dgsPointLayer)) map.addLayer(dgsPointLayer);
    }
}

function clearDgsLayers() {
    if (dgsPolyLayer) { if (map) map.removeLayer(dgsPolyLayer); dgsPolyLayer = null; }
    if (dgsPointLayer) { if (map) map.removeLayer(dgsPointLayer); dgsPointLayer = null; }
}

// ---------- 案件清單 ----------
function renderDgsList() {
    const listEl = document.getElementById('dgsList');
    if (!listEl) return;
    const cases = dgsFilteredCases();
    if (cases.length === 0) {
        listEl.innerHTML = '<div style="color:#999;padding:8px 0;text-align:center;">目前沒有案件</div>';
        return;
    }
    listEl.innerHTML = cases.map((c, i) => {
        const active = dgsIsActive(c);
        return '<div onclick="zoomToDgsCase(' + i + ')" style="padding:6px 8px;border-left:3px solid ' +
            (dgsIsWater(c) ? DGS_COLOR : DGS_COLOR_OTHER) + ';background:#f7f9fa;margin-bottom:4px;' +
            'border-radius:0 4px 4px 0;cursor:pointer;line-height:1.5;' + (active ? '' : 'opacity:0.6;') + '">' +
            '<div style="font-weight:bold;">' + dgsEsc(c.caseNo) +
            ' <span style="color:#999;font-weight:normal;font-size:10px;">' + dgsEsc(c._city || '') + '</span></div>' +
            '<div style="color:#555;">' + dgsEsc(c.route) + '｜' + dgsEsc(c.pipeType) + '｜' + c.locations.length + ' 點</div>' +
            '<div style="color:#888;font-size:11px;">' + dgsEsc(c.startDate) + ' ~ ' + dgsEsc(c.extEndDate || c.endDate) + '</div>' +
            '</div>';
    }).join('');
}

function zoomToDgsCase(index) {
    const c = dgsFilteredCases()[index];
    if (!c || !map) return;
    const pts = [];
    c.locations.forEach(loc => { if (loc.center) pts.push(loc.center); });
    if (pts.length === 0) return;
    if (pts.length === 1) map.setView(pts[0], 18);
    else map.fitBounds(L.latLngBounds(pts).pad(0.3));
}

function fitDgsBounds() {
    const pts = [];
    dgsFilteredCases().forEach(c => c.locations.forEach(loc => { if (loc.center) pts.push(loc.center); }));
    if (pts.length === 0) { showToast('目前沒有可顯示的案件', 'info'); return; }
    map.fitBounds(L.latLngBounds(pts).pad(0.2));
}

// ---------- 已上傳縣市清單（收合，預設關閉，不佔版面）----------
function renderDgsUploadList() {
    const el = document.getElementById('dgsUploadList');
    if (!el) return;
    if (dgsUploads.length === 0) {
        el.innerHTML = '<div style="color:#aaa;font-size:10px;padding:2px 0;">尚無上傳資料</div>';
        return;
    }
    const canEdit = dgsCanEdit();
    const rows = dgsUploads.map(u => {
        const del = canEdit
            ? '<span style="cursor:pointer;color:#c62828;" onclick="event.stopPropagation();deleteDgsUpload(\'' + u.city + '\')" title="刪除">✕</span>'
            : '';
        return '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#666;padding:1px 0;">' +
            '<span style="flex:1;cursor:pointer;" onclick="zoomToDgsCity(\'' + u.city + '\')">' +
            dgsEsc(u.city) + '（' + u.case_count + ' 件）</span>' + del + '</div>';
    }).join('');

    el.innerHTML =
        '<details style="font-size:11px;">' +
        '<summary style="cursor:pointer;color:#0288D1;padding:2px 0;">已上傳 ' + dgsUploads.length + ' 個縣市（點開管理）</summary>' +
        '<div style="margin-top:4px;">' + rows + '</div>' +
        '</details>';
}

function zoomToDgsCity(city) {
    const pts = [];
    dgsCases.filter(c => c._city === city).forEach(c =>
        c.locations.forEach(loc => { if (loc.center) pts.push(loc.center); }));
    if (pts.length === 0 || !map) return;
    map.fitBounds(L.latLngBounds(pts).pad(0.2));
}

// ---------- 上傳（可一次多檔；整合檔會自動依縣市別拆分）----------
async function uploadDgsKml(input) {
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (files.length === 0) return;
    if (!dgsCanEdit()) { showToast('需登入且具編輯權限才能上傳', 'error'); return; }

    // 從檔名猜縣市，只當「案件裡讀不到縣市別」時的退路（整合檔通常用不到）
    const cityRe = /(基隆市|新北市|台北市|臺北市|桃園市|新竹縣|新竹市|苗栗縣|台中市|臺中市|南投縣|彰化縣|雲林縣|嘉義縣|嘉義市|台南市|臺南市|高雄市|屏東縣|宜蘭縣|花蓮縣|台東縣|臺東縣)/;
    const btn = document.getElementById('dgsUploadBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 上傳中…'; }

    const citiesSaved = new Set();
    let fileFail = 0;

    for (const file of files) {
        const m = file.name.match(cityRe);
        const fallbackCity = m ? m[1].replace(/^臺/, '台') : '';
        try {
            const text = await file.text();
            const res = await apiCall('uploadDgsKml', {}, {
                body: { city: fallbackCity, kml: text, fileName: file.name },
                silent: true,
            });
            if (res && res.success) {
                (res.cities || []).forEach(c => citiesSaved.add(c.city));
            } else {
                fileFail++; console.warn(file.name, res && res.error);
            }
        } catch (e) { fileFail++; console.error('上傳', file.name, '失敗:', e); }
    }

    if (btn) { btn.disabled = false; btn.textContent = '📂 上傳 KML'; }

    const n = citiesSaved.size;
    if (n > 0) {
        const names = [...citiesSaved].join('、');
        showToast('已更新 ' + n + ' 個縣市：' + names + (fileFail ? '（' + fileFail + ' 個檔失敗）' : ''),
                  fileFail ? 'info' : 'success');
    } else {
        showToast('上傳失敗，請確認是否為有效 KML（不是驗證頁）', 'error');
    }
    await loadDgsPermits();
}

async function deleteDgsUpload(city) {
    if (!dgsCanEdit()) { showToast('沒有刪除權限', 'error'); return; }
    if (!confirm('確定刪除 ' + city + ' 的申挖資料？')) return;
    try {
        await apiCall('deleteDgsUpload', { city: city }, { errorPrefix: '刪除失敗' });
        showToast(city + ' 已刪除', 'success');
        await loadDgsPermits();
    } catch (e) { /* apiCall 已提示 */ }
}

// ---------- 開關 ----------
function toggleDgsLayer() {
    const panel = document.getElementById('dgsPanel');
    const panelOpen = panel && panel.style.display !== 'none';

    if (dgsVisible) {
        // 圖層開著、面板也開著 → 關掉整個圖層
        // 圖層開著、面板收合中 → 只是把面板叫回來（圖層不動）
        if (panelOpen) { hideDgsLayer(); }
        else { openDgsPanel(); }
        return;
    }

    // 圖層原本關著：開啟圖層 + 面板
    dgsVisible = true;
    const btn = document.getElementById('dgsButton');
    if (btn) btn.classList.add('active-blue');
    openDgsPanel();
    if (dgsCases.length === 0 && dgsUploads.length === 0) loadDgsPermits();
    else renderDgsPermits();
}

// 開啟面板（不影響圖層）
function openDgsPanel() {
    const panel = document.getElementById('dgsPanel');
    if (panel) panel.style.display = 'block';
    const up = document.getElementById('dgsUploadBtn');
    if (up) up.style.display = dgsCanEdit() ? '' : 'none';
}

// 收合面板，但地圖圖層保留
function collapseDgsPanel() {
    const panel = document.getElementById('dgsPanel');
    if (panel) panel.style.display = 'none';
    // 圖層仍在，工具鈕維持 active 提示使用者「還開著」
}

// 真正關閉圖層（長按工具鈕，或關閉鈕另設；預設保留給程式呼叫）
function hideDgsLayer() {
    dgsVisible = false;
    const btn = document.getElementById('dgsButton');
    if (btn) btn.classList.remove('active-blue');
    const panel = document.getElementById('dgsPanel');
    if (panel) panel.style.display = 'none';
    clearDgsLayers();
}

function onDgsFilterChange() {
    renderDgsList();
    updateDgsCount();
    if (dgsVisible) renderDgsPermits();
}

window.toggleDgsLayer = toggleDgsLayer;
window.collapseDgsPanel = collapseDgsPanel;
window.openDgsPanel = openDgsPanel;
window.hideDgsLayer = hideDgsLayer;
window.onDgsFilterChange = onDgsFilterChange;
window.zoomToDgsCase = zoomToDgsCase;
window.fitDgsBounds = fitDgsBounds;
window.uploadDgsKml = uploadDgsKml;
window.deleteDgsUpload = deleteDgsUpload;
window.zoomToDgsCity = zoomToDgsCity;
// ========== 公路局申挖路權圖層結束 ==========
