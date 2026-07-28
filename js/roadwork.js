// ========== 台中市自來水挖掘許可（上傳 JSONL，可分檔勾選）==========
// 資料來源：台中市政府道路挖掘管理系統 GIS 匯出的 ArcGIS JSONL。
// 操作方式比照 WGIS 管線底圖：每個上傳的檔案獨立列出，可個別勾選顯示／刪除。
// rwDatasets = [{ name, cases, visible, loaded, caseCount, areaCount }]

let rwDatasets = [];          // 已載入的資料集
window.rwDatasets = rwDatasets;
let rwCloudFiles = [];        // 雲端上的檔案清單
let roadworkVisible = false;  // 圖層總開關
let roadworkPolyLayer = null; // 挖掘面（放大時顯示）
let roadworkPointLayer = null;// 圓點（縮小時顯示）
let roadworkZoomBound = false;
let roadworkLoading = false;

const RW_ZOOM_THRESHOLD = 17;       // 這個層級以上顯示挖掘面，以下顯示圓點
const RW_COLOR = '#FF5722';         // 施工期間內＝橘
const RW_COLOR_OUT = '#BDBDBD';     // 非期間／未核發＝灰

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
    return String(s == null ? '' : s).replace(/[&<>"']/g,
        m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// 目前所有「已勾選」資料集的案件（合併）
function rwAllCases() {
    const out = [];
    rwDatasets.forEach(ds => { if (ds.visible && ds.loaded) out.push(...ds.cases); });
    return out;
}

function rwFiltered() {
    const onlyActive = document.getElementById('rwOnlyActive');
    const all = rwAllCases();
    if (onlyActive && onlyActive.checked) return all.filter(rwIsActive);
    return all;
}

// ---------- 雲端檔案清單 ----------
async function refreshRoadworkFileList() {
    if (roadworkLoading) return;
    roadworkLoading = true;
    const countEl = document.getElementById('roadworkCount');
    if (countEl) countEl.textContent = '載入清單中…';
    try {
        const res = await apiCall('listTaichungDigFiles', {}, { silent: true });
        rwCloudFiles = res.files || [];
        // 清掉已被刪除的資料集
        rwDatasets = rwDatasets.filter(ds => rwCloudFiles.some(f => f.file_name === ds.name));
        window.rwDatasets = rwDatasets;
        renderRoadworkFileList();
        updateRoadworkCount();
        renderRoadworkList();
        if (roadworkVisible) displayRoadworkMarkers();
    } catch (e) {
        console.error('載入挖掘許可清單失敗:', e);
        if (countEl) countEl.textContent = '載入失敗：' + e.message;
    } finally {
        roadworkLoading = false;
    }
}

function renderRoadworkFileList() {
    const el = document.getElementById('roadworkFileList');
    if (!el) return;
    if (rwCloudFiles.length === 0) {
        el.innerHTML = '<div style="color:#aaa;font-size:11px;padding:4px 0;">尚無上傳檔案</div>';
        return;
    }
    const canEdit = rwCanEdit();
    el.innerHTML = rwCloudFiles.map(f => {
        const ds = rwDatasets.find(d => d.name === f.file_name);
        const on = ds ? ds.visible : false;
        const nm = rwEsc(f.file_name);
        const del = canEdit
            ? `<span style="cursor:pointer;color:#c62828;padding:0 2px;" title="刪除"
                 onclick="event.stopPropagation();deleteRoadworkFile('${nm}')">✕</span>`
            : '';
        return `<div onclick="toggleRoadworkDataset('${nm}')"
            style="display:flex;align-items:center;gap:5px;padding:4px 5px;margin-bottom:3px;
                   border-radius:4px;cursor:pointer;font-size:11px;
                   background:${on ? '#fff3e0' : '#fafafa'};border:1px solid ${on ? '#ffcc80' : '#eee'};">
            <input type="checkbox" ${on ? 'checked' : ''} style="margin:0;"
                   onclick="event.stopPropagation();toggleRoadworkDataset('${nm}')">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                  title="${nm}">${nm}</span>
            <span style="color:#999;font-size:10px;white-space:nowrap;">${f.case_count} 件</span>
            ${del}
        </div>`;
    }).join('');
}

// ---------- 勾選／取消某個檔案 ----------
async function toggleRoadworkDataset(fileName) {
    let ds = rwDatasets.find(d => d.name === fileName);
    if (!ds) {
        ds = { name: fileName, cases: [], visible: false, loaded: false };
        rwDatasets.push(ds);
        window.rwDatasets = rwDatasets;
    }

    if (!ds.loaded) {
        const countEl = document.getElementById('roadworkCount');
        if (countEl) countEl.textContent = '⏳ 載入「' + fileName + '」…';
        try {
            const res = await apiCall('getTaichungRoadwork', { file: fileName }, { silent: true });
            ds.cases = res.data || [];
            ds.loaded = true;
        } catch (e) {
            console.error('載入失敗:', e);
            showToast('載入「' + fileName + '」失敗', 'error');
            if (countEl) updateRoadworkCount();
            return;
        }
    }

    ds.visible = !ds.visible;

    // 勾了任何一個檔就自動把圖層打開
    if (ds.visible && !roadworkVisible) {
        roadworkVisible = true;
        const btn = document.getElementById('roadworkButton');
        if (btn) btn.classList.add('active');
    }

    renderRoadworkFileList();
    updateRoadworkCount();
    renderRoadworkList();
    if (roadworkVisible) displayRoadworkMarkers();
}

function updateRoadworkCount() {
    const el = document.getElementById('roadworkCount');
    if (!el) return;
    if (rwCloudFiles.length === 0) {
        el.innerHTML = '<span style="color:#999;">尚未上傳 JSONL</span>';
        return;
    }
    const chosen = rwDatasets.filter(d => d.visible && d.loaded);
    if (chosen.length === 0) {
        el.innerHTML = '<span style="color:#999;">請勾選要顯示的檔案</span>';
        return;
    }
    const shown = rwFiltered();
    const areas = shown.reduce((s, c) => s + c.areas.length, 0);
    const total = rwAllCases().length;
    let h = '共 <b>' + shown.length + '</b> 件許可 / ' + areas + ' 個挖掘面';
    if (shown.length !== total) {
        h += '<br><span style="color:#999;">（已隱藏 ' + (total - shown.length) + ' 件非施工期間）</span>';
    }
    h += '<br><span style="color:#aaa;font-size:10px;">已選 ' + chosen.length + ' 個檔案</span>';
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

    // 先畫「非期間／未核發」(灰)，再畫「施工期間內」(橘)，
    // 後加入的圖層在上層 → 重疊時橘色不會被灰色蓋住。
    const shown = rwFiltered();
    const ordered = shown.filter(c => !rwIsActive(c)).concat(shown.filter(rwIsActive));

    ordered.forEach(c => {
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

// 縮小看圓點、放大看真實挖掘面
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

// ---------- 案件清單 ----------
function renderRoadworkList() {
    const el = document.getElementById('roadworkList');
    if (!el) return;
    const cases = rwFiltered();
    if (cases.length === 0) { el.innerHTML = ''; return; }
    const show = cases.slice(0, 200);   // 全部可能上千件，清單只列前 200
    el.innerHTML = show.map((c, i) => {
        const active = rwIsActive(c);
        return '<div onclick="zoomToRoadwork(' + i + ')" style="padding:6px 8px;border-left:3px solid ' +
            (active ? RW_COLOR : RW_COLOR_OUT) + ';background:#fafafa;margin-bottom:4px;border-radius:0 4px 4px 0;' +
            'cursor:pointer;line-height:1.4;' + (active ? '' : 'opacity:0.7;') + '">' +
            '<div style="font-weight:bold;font-size:12px;">' + rwEsc(String(c.projectName || c.appNo).slice(0, 24)) + '</div>' +
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
    if (!pts.length) { showToast('請先勾選要顯示的檔案', 'info'); return; }
    map.fitBounds(L.latLngBounds(pts).pad(0.1));
}

// ---------- 上傳（可一次多檔，各自成為獨立檔案）----------
async function uploadRoadworkJsonl(input) {
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    if (files.length === 0) return;
    if (!rwCanEdit()) { showToast('需登入且具編輯權限才能上傳', 'error'); return; }

    const btn = document.getElementById('rwUploadBtn');
    if (btn) btn.disabled = true;

    let ok = 0, fail = 0;
    const uploaded = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (btn) btn.textContent = '⏳ ' + (i + 1) + '/' + files.length + '…';
        try {
            const text = await file.text();
            const res = await apiCall('uploadTaichungDig', {}, {
                body: { data: text, fileName: file.name },
                silent: true,
            });
            if (res && res.success) { ok++; uploaded.push(file.name); }
            else { fail++; console.warn(file.name, res && res.error); }
        } catch (e) { fail++; console.error('上傳', file.name, '失敗:', e); }
    }

    if (btn) { btn.disabled = false; btn.textContent = '📂 上傳 JSONL'; }
    if (ok) showToast('已上傳 ' + ok + ' 個檔案' + (fail ? '（' + fail + ' 個失敗）' : ''), fail ? 'info' : 'success');
    else showToast('上傳失敗，請確認是台中市挖掘 JSONL 檔', 'error');

    await refreshRoadworkFileList();
    // 剛上傳的自動勾選顯示
    for (const nm of uploaded) {
        const ds = rwDatasets.find(d => d.name === nm);
        if (!ds || !ds.visible) await toggleRoadworkDataset(nm);
    }
}

async function deleteRoadworkFile(fileName) {
    if (!rwCanEdit()) { showToast('沒有刪除權限', 'error'); return; }
    if (!confirm('確定刪除「' + fileName + '」？')) return;
    try {
        await apiCall('deleteTaichungDig', { file: fileName }, { errorPrefix: '刪除失敗' });
        rwDatasets = rwDatasets.filter(d => d.name !== fileName);
        window.rwDatasets = rwDatasets;
        showToast('已刪除', 'success');
        await refreshRoadworkFileList();
    } catch (e) { /* apiCall 已提示 */ }
}

// ---------- 開關 ----------
function toggleRoadworkLayer() {
    const panel = document.getElementById('roadworkPanel');
    const panelOpen = panel && panel.style.display !== 'none';

    if (roadworkVisible) {
        if (panelOpen) { hideRoadworkLayer(); }
        else { openRoadworkPanel(); }
        return;
    }

    roadworkVisible = true;
    const btn = document.getElementById('roadworkButton');
    if (btn) btn.classList.add('active');
    openRoadworkPanel();
    if (rwCloudFiles.length === 0) refreshRoadworkFileList();
    else displayRoadworkMarkers();
}

function openRoadworkPanel() {
    const panel = document.getElementById('roadworkPanel');
    if (panel) panel.style.display = 'block';
    const up = document.getElementById('rwUploadBtn');
    if (up) up.style.display = rwCanEdit() ? '' : 'none';
}

// 收合面板，地圖圖層保留
function collapseRoadworkPanel() {
    const panel = document.getElementById('roadworkPanel');
    if (panel) panel.style.display = 'none';
}

function hideRoadworkLayer() {
    roadworkVisible = false;
    const btn = document.getElementById('roadworkButton');
    if (btn) btn.classList.remove('active');
    const panel = document.getElementById('roadworkPanel');
    if (panel) panel.style.display = 'none';
    clearRoadworkMarkers();
}

function onRoadworkFilterChange() {
    updateRoadworkCount();
    renderRoadworkList();
    if (roadworkVisible) displayRoadworkMarkers();
}

window.toggleRoadworkLayer = toggleRoadworkLayer;
window.collapseRoadworkPanel = collapseRoadworkPanel;
window.openRoadworkPanel = openRoadworkPanel;
window.hideRoadworkLayer = hideRoadworkLayer;
window.uploadRoadworkJsonl = uploadRoadworkJsonl;
window.deleteRoadworkFile = deleteRoadworkFile;
window.toggleRoadworkDataset = toggleRoadworkDataset;
window.refreshRoadworkFileList = refreshRoadworkFileList;
window.onRoadworkFilterChange = onRoadworkFilterChange;
window.zoomToRoadwork = zoomToRoadwork;
window.fitRoadworkBounds = fitRoadworkBounds;
// ========== 台中市自來水挖掘許可結束 ==========
