// ========== 台中市自來水挖掘許可（上傳 JSONL）==========
// 資料來源：台中市政府道路挖掘管理系統 GIS 匯出的 ArcGIS JSONL。
// 由使用者上傳（含 attributes / geometry.rings / license），worker 解析存 D1。
// 操作邏輯與「公路局申挖路權」「WGIS」一致：上傳、訪客只能看、面板收合。

let roadworkData = [];        // 許可陣列（每件含 areas[]）
let roadworkVisible = false;
let roadworkPolyLayer = null; // 挖掘面（放大時顯示）
let roadworkPointLayer = null;// 圓點（縮小時顯示）
let roadworkZoomBound = false;
let roadworkLoading = false;
let roadworkMeta = {};

const RW_ZOOM_THRESHOLD = 17;       // 這個層級以上顯示挖掘面，以下顯示圓點
const RW_COLOR = '#FF5722';         // 施工期間內＝橘
const RW_COLOR_OUT = '#BDBDBD';     // 非期間／無日期＝灰

function rwCanEdit() {
    return typeof currentUser !== 'undefined' && currentUser &&
        typeof getRoleLevel === 'function' && getRoleLevel(currentUser.role) >= 2;
}

function rwToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function rwIsActive(c) {
    if (!c.startDate || !c.endDate) return false;   // 無核准期間 → 當非施工中
    const t = rwToday();
    return c.startDate <= t && t <= c.endDate;
}
function rwEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
}
function rwFiltered() {
    const onlyActive = document.getElementById('rwOnlyActive');
    if (onlyActive && onlyActive.checked) return roadworkData.filter(rwIsActive);
    return roadworkData;
}

// ---------- 載入 ----------
async function loadRoadworkData() {
    if (roadworkLoading) return;
    roadworkLoading = true;
    const countEl = document.getElementById('roadworkCount');
    if (countEl) countEl.textContent = '載入中…';
    try {
        const res = await apiCall('getTaichungRoadwork', {}, { silent: true });
        roadworkData = res.data || [];
        roadworkMeta = { sourceFile: res.sourceFile, uploadedAt: res.uploadedAt, areaCount: res.areaCount, empty: res.empty };
        updateRoadworkCount();
        renderRoadworkList();
        if (roadworkVisible) displayRoadworkMarkers();
    } catch (e) {
        console.error('載入挖掘許可失敗:', e);
        if (countEl) countEl.textContent = '載入失敗：' + e.message;
    } finally {
        roadworkLoading = false;
    }
}

function updateRoadworkCount() {
    const el = document.getElementById('roadworkCount');
    if (!el) return;
    if (roadworkMeta.empty || roadworkData.length === 0) {
        el.innerHTML = '<span style="color:#999;">尚未上傳 JSONL</span>';
        return;
    }
    const shown = rwFiltered();
    const areas = shown.reduce((s, c) => s + c.areas.length, 0);
    let h = '共 <b>' + shown.length + '</b> 件許可 / ' + areas + ' 個挖掘面';
    if (shown.length !== roadworkData.length) {
        h += '<br><span style="color:#999;">（已隱藏 ' + (roadworkData.length - shown.length) + ' 件非施工期間）</span>';
    }
    if (roadworkMeta.uploadedAt) {
        h += '<br><span style="color:#aaa;font-size:10px;">' + rwEsc(roadworkMeta.sourceFile || '') +
             '，' + roadworkMeta.uploadedAt.slice(0,10) + ' 上傳</span>';
    }
    el.innerHTML = h;
}

// ---------- 繪製 ----------
function rwPopup(c) {
    const active = rwIsActive(c);
    let h = '<div style="min-width:230px;max-width:320px;font-size:12px;">';
    h += '<div style="font-weight:bold;color:' + (active ? RW_COLOR : RW_COLOR_OUT) + ';margin-bottom:6px;">🚧 自來水挖掘許可' +
         (active ? '' : ' <span style="color:#999;font-weight:normal;">(非施工期間)</span>') + '</div>';
    h += '<div style="margin:3px 0;"><b>工程名稱：</b>' + rwEsc(c.projectName) + '</div>';
    if (c.route) h += '<div style="margin:3px 0;"><b>地點：</b>' + rwEsc(c.route) + '</div>';
    if (c.district) h += '<div style="margin:3px 0;"><b>行政區：</b>' + rwEsc(c.district) + '</div>';
    if (c.customer) h += '<div style="margin:3px 0;"><b>用戶：</b>' + rwEsc(c.customer) + '</div>';
    if (c.applicant) h += '<div style="margin:3px 0;"><b>申請單位：</b>' + rwEsc(c.applicant) + '</div>';
    h += '<div style="margin:3px 0;color:#666;"><b>核准施工：</b>' +
         (c.startDate ? rwEsc(c.startDate) + ' ~ ' + rwEsc(c.endDate) : '（未核發）') +
         (c.workTime ? '　' + rwEsc(c.workTime) : '') + '</div>';
    if (c.permitNo) h += '<div style="margin:3px 0;color:#666;"><b>許可證號：</b>' + rwEsc(c.permitNo) + '</div>';
    if (c.issueDate) h += '<div style="margin:3px 0;color:#666;"><b>發證：</b>' + rwEsc(c.issueDate) + '（' + rwEsc(c.permitState) + '）</div>';
    h += '<div style="margin:3px 0;color:#999;font-size:11px;">申請書編號 ' + rwEsc(c.appNo) + '</div>';
    h += '</div>';
    return h;
}

function displayRoadworkMarkers() {
    clearRoadworkMarkers();
    if (!map) return;
    roadworkPolyLayer = L.layerGroup();
    roadworkPointLayer = L.layerGroup();

    rwFiltered().forEach(c => {
        const active = rwIsActive(c);
        const color = active ? RW_COLOR : RW_COLOR_OUT;
        const popup = rwPopup(c);
        c.areas.forEach(ar => {
            if (ar.coords.length >= 3) {
                const poly = L.polygon(ar.coords, {
                    color: color, weight: 2, fillColor: color,
                    fillOpacity: active ? 0.35 : 0.2,
                    dashArray: active ? null : '4,3',
                });
                poly.bindPopup(popup);
                roadworkPolyLayer.addLayer(poly);

                // 圓點放在該面的第一個座標
                const marker = L.circleMarker(ar.coords[0], {
                    radius: 6, fillColor: color, color: '#fff', weight: 2,
                    opacity: 1, fillOpacity: active ? 0.9 : 0.5,
                });
                marker.bindPopup(popup);
                roadworkPointLayer.addLayer(marker);
            }
        });
    });

    applyRoadworkZoomLevel();
    if (!roadworkZoomBound) { map.on('zoomend', applyRoadworkZoomLevel); roadworkZoomBound = true; }
}

// 縮小看圓點、放大看真實挖掘面（挖掘面通常只有幾平方公尺，縮小看不到）
function applyRoadworkZoomLevel() {
    if (!roadworkVisible || !map || !roadworkPolyLayer || !roadworkPointLayer) return;
    const z = map.getZoom();
    if (z >= RW_ZOOM_THRESHOLD) {
        if (!map.hasLayer(roadworkPolyLayer)) map.addLayer(roadworkPolyLayer);
        if (map.hasLayer(roadworkPointLayer)) map.removeLayer(roadworkPointLayer);
    } else {
        if (map.hasLayer(roadworkPolyLayer)) map.removeLayer(roadworkPolyLayer);
        if (!map.hasLayer(roadworkPointLayer)) map.addLayer(roadworkPointLayer);
    }
}

function clearRoadworkMarkers() {
    if (roadworkPolyLayer) { if (map) map.removeLayer(roadworkPolyLayer); roadworkPolyLayer = null; }
    if (roadworkPointLayer) { if (map) map.removeLayer(roadworkPointLayer); roadworkPointLayer = null; }
}

// ---------- 清單 ----------
function renderRoadworkList() {
    const el = document.getElementById('roadworkList');
    if (!el) return;
    const cases = rwFiltered();
    if (cases.length === 0) {
        el.innerHTML = '<div style="color:#999;padding:8px 0;text-align:center;">目前沒有許可</div>';
        return;
    }
    // 清單最多顯示 200 件，避免 DOM 過大（全台中 800 件）
    const show = cases.slice(0, 200);
    el.innerHTML = show.map((c, i) => {
        const active = rwIsActive(c);
        return '<div onclick="zoomToRoadwork(' + i + ')" style="padding:6px 8px;border-left:3px solid ' +
            (active ? RW_COLOR : RW_COLOR_OUT) + ';background:#fafafa;margin-bottom:4px;border-radius:0 4px 4px 0;' +
            'cursor:pointer;line-height:1.4;' + (active ? '' : 'opacity:0.7;') + '">' +
            '<div style="font-weight:bold;font-size:12px;">' + rwEsc((c.projectName || c.appNo).slice(0, 24)) + '</div>' +
            '<div style="color:#777;font-size:11px;">' + rwEsc(c.district || c.route || '') + '｜' + c.areas.length + ' 面</div>' +
            '<div style="color:#999;font-size:10px;">' + (c.startDate ? rwEsc(c.startDate) + ' ~ ' + rwEsc(c.endDate) : '未核發') + '</div>' +
            '</div>';
    }).join('') + (cases.length > 200 ? '<div style="color:#aaa;font-size:10px;text-align:center;padding:4px;">（僅列前 200 件，地圖顯示全部）</div>' : '');
}

function zoomToRoadwork(index) {
    const c = rwFiltered()[index];
    if (!c || !map || !c.areas.length) return;
    const pts = [];
    c.areas.forEach(ar => ar.coords.forEach(p => pts.push(p)));
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.4));
}

function fitRoadworkBounds() {
    const pts = [];
    rwFiltered().forEach(c => c.areas.forEach(ar => ar.coords.forEach(p => pts.push(p))));
    if (!pts.length) { showToast('目前沒有可顯示的許可', 'info'); return; }
    map.fitBounds(L.latLngBounds(pts).pad(0.1));
}

// ---------- 上傳 ----------
async function uploadRoadworkJsonl(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!rwCanEdit()) { showToast('需登入且具編輯權限才能上傳', 'error'); return; }

    const btn = document.getElementById('rwUploadBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 解析中…'; }
    try {
        const text = await file.text();
        const res = await apiCall('uploadTaichungDig', {}, {
            body: { data: text, fileName: file.name },
            errorPrefix: '上傳失敗',
        });
        showToast('已解析 ' + res.count + ' 件許可、' + res.areaCount + ' 個挖掘面', 'success');
        await loadRoadworkData();
    } catch (e) {
        console.error('上傳 JSONL 失敗:', e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📂 上傳 JSONL'; }
    }
}

async function deleteRoadworkData() {
    if (!rwCanEdit()) { showToast('沒有刪除權限', 'error'); return; }
    if (!confirm('確定清空目前的挖掘許可資料？')) return;
    try {
        await apiCall('deleteTaichungDig', {}, { errorPrefix: '刪除失敗' });
        roadworkData = [];
        showToast('已清空', 'success');
        await loadRoadworkData();
    } catch (e) { /* apiCall 已提示 */ }
}

// ---------- 開關 ----------
function toggleRoadworkLayer() {
    const btn = document.getElementById('roadworkButton');
    const panel = document.getElementById('roadworkPanel');
    roadworkVisible = !roadworkVisible;
    if (roadworkVisible) {
        if (btn) btn.classList.add('active');
        if (panel) panel.style.display = 'block';
        const up = document.getElementById('rwUploadBtn');
        if (up) up.style.display = rwCanEdit() ? '' : 'none';
        const del = document.getElementById('rwDeleteBtn');
        if (del) del.style.display = rwCanEdit() ? '' : 'none';
        if (roadworkData.length === 0) loadRoadworkData();
        else displayRoadworkMarkers();
    } else {
        if (btn) btn.classList.remove('active');
        if (panel) panel.style.display = 'none';
        clearRoadworkMarkers();
    }
}

function onRoadworkFilterChange() {
    updateRoadworkCount();
    renderRoadworkList();
    if (roadworkVisible) displayRoadworkMarkers();
}

window.toggleRoadworkLayer = toggleRoadworkLayer;
window.uploadRoadworkJsonl = uploadRoadworkJsonl;
window.deleteRoadworkData = deleteRoadworkData;
window.onRoadworkFilterChange = onRoadworkFilterChange;
window.zoomToRoadwork = zoomToRoadwork;
window.fitRoadworkBounds = fitRoadworkBounds;
// ========== 台中市自來水挖掘許可結束 ==========
