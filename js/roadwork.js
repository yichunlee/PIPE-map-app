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
// 三種狀態：
//   active  施工期間／待進場（已核發且今天 <= 迄日）＝ 綠
//   ended   已結束（已核發但今天 > 迄日）           ＝ 灰
//   pending 未核發（沒有核准施工起訖）              ＝ 紅
const RW_COLOR_ACTIVE  = '#2E7D32';
const RW_COLOR_ENDED   = '#BDBDBD';
const RW_COLOR_PENDING = '#E53935';
const RW_STATUS_LABEL = { active: '施工期間/待進場', ended: '已結束', pending: '未核發' };
const RW_STATUS_COLOR = { active: RW_COLOR_ACTIVE, ended: RW_COLOR_ENDED, pending: RW_COLOR_PENDING };

function rwCanEdit() {
    return typeof currentUser !== 'undefined' && currentUser &&
        typeof getRoleLevel === 'function' && getRoleLevel(currentUser.role) >= 2;
}

function rwToday() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
// 回傳 'active' | 'ended' | 'pending'
// 只要今天還沒超過迄日就算 active（含尚未開工的「待進場」），
// 因為那些路證已經拿到、工程還會進行，不該跟已結束的混在一起。
function rwStatus(c) {
    if (!c.endDate) return 'pending';               // 沒有核准施工起訖 → 還沒拿到路證
    return rwToday() <= c.endDate ? 'active' : 'ended';
}
function rwIsActive(c) { return rwStatus(c) === 'active'; }
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

// 依三個狀態勾選過濾（元素不存在時視為顯示）
function rwStatusShown(st) {
    const el = document.getElementById(
        st === 'active' ? 'rwShowActive' : st === 'ended' ? 'rwShowEnded' : 'rwShowPending');
    return el ? el.checked : true;
}

function rwFiltered() {
    return rwAllCases().filter(c => rwStatusShown(rwStatus(c)));
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
    // 記住勾了哪些檔案，下次進來自動沿用（見 js/default-layers.js）
    if (typeof rememberRoadworkFiles === 'function') rememberRoadworkFiles();
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
    const all = rwAllCases();
    const tally = { active: 0, ended: 0, pending: 0 };
    all.forEach(c => { tally[rwStatus(c)]++; });

    const shown = rwFiltered();
    const areas = shown.reduce((s, c) => s + c.areas.length, 0);

    let h = '顯示 <b>' + shown.length + '</b> / ' + all.length + ' 件許可（' + areas + ' 個挖掘面）';
    h += '<br><span style="font-size:10px;">';
    h += '<span style="color:' + RW_COLOR_ACTIVE + ';">● 施工/待進場 ' + tally.active + '</span>　';
    h += '<span style="color:' + RW_COLOR_PENDING + ';">● 未核發 ' + tally.pending + '</span>　';
    h += '<span style="color:#999;">● 已結束 ' + tally.ended + '</span>';
    h += '</span>';
    h += '<br><span style="color:#aaa;font-size:10px;">已選 ' + chosen.length + ' 個檔案</span>';
    el.innerHTML = h;
}

// ---------- 繪製 ----------
function rwPopup(c) {
    const st = rwStatus(c);
    let h = '<div style="min-width:230px;max-width:320px;font-size:12px;">';
    h += '<div style="font-weight:bold;color:' + RW_STATUS_COLOR[st] + ';margin-bottom:6px;">🚧 自來水挖掘許可' +
         ' <span style="font-weight:normal;">(' + RW_STATUS_LABEL[st] + ')</span></div>';
    h += '<div style="margin:3px 0;"><b>工程名稱：</b>' + rwEsc(c.projectName) + '</div>';
    if (c.route) h += '<div style="margin:3px 0;"><b>地點：</b>' + rwEsc(c.route) + '</div>';
    if (c.district) h += '<div style="margin:3px 0;"><b>行政區：</b>' + rwEsc(c.district) + '</div>';
    if (c.customer) h += '<div style="margin:3px 0;"><b>用戶：</b>' + rwEsc(c.customer) + '</div>';
    if (c.applicant) h += '<div style="margin:3px 0;"><b>申請單位：</b>' + rwEsc(c.applicant) + '</div>';
    if (st === 'pending') {
        h += '<div style="margin:3px 0;color:' + RW_COLOR_PENDING + ';font-weight:bold;">' +
             '<b>核准施工：</b>尚未取得路證</div>';
    } else {
        h += '<div style="margin:3px 0;color:#666;"><b>核准施工：</b>' +
             rwEsc(c.startDate || '') + ' ~ ' + rwEsc(c.endDate) +
             (c.workTime ? '　' + rwEsc(c.workTime) : '') + '</div>';
    }
    if (c.permitNo) h += '<div style="margin:3px 0;color:#666;"><b>許可證號：</b>' + rwEsc(c.permitNo) + '</div>';
    if (c.issueDate) h += '<div style="margin:3px 0;color:#666;"><b>發證：</b>' + rwEsc(c.issueDate) + '（' + rwEsc(c.permitState) + '）</div>';
    h += '<div style="margin:3px 0;color:#999;font-size:11px;">申請書編號 ' + rwEsc(c.appNo) + '</div>';
    // 導航：用第一個挖掘面的第一個座標當目的地
    var _p0 = (c.areas && c.areas[0] && c.areas[0].coords && c.areas[0].coords[0]) || null;
    if (_p0 && typeof buildNavLink === 'function') h += buildNavLink(_p0[0], _p0[1]);
    h += '</div>';
    return h;
}

function displayRoadworkMarkers() {
    clearRoadworkMarkers();
    if (!map) return;
    roadworkPolyLayer = L.layerGroup();
    roadworkPointLayer = L.layerGroup();

    // 疊放順序：已結束(灰) → 施工/待進場(綠) → 未核發(紅)。
    // 後加入者在上層，所以最需要被看到的「未核發」不會被蓋住。
    const shown = rwFiltered();
    const ordered = shown.filter(c => rwStatus(c) === 'ended')
        .concat(shown.filter(c => rwStatus(c) === 'active'))
        .concat(shown.filter(c => rwStatus(c) === 'pending'));

    ordered.forEach(c => {
        const st = rwStatus(c);
        const color = RW_STATUS_COLOR[st];
        const popup = rwPopup(c);
        c.areas.forEach(ar => {
            if (ar.coords.length >= 3) {
                const poly = L.polygon(ar.coords, {
                    color: color, weight: 2, fillColor: color,
                    fillOpacity: st === 'ended' ? 0.18 : 0.4,
                    dashArray: st === 'pending' ? '5,4' : null,   // 未核發用虛線再加強辨識
                });
                poly.bindPopup(popup);
                roadworkPolyLayer.addLayer(poly);

                const marker = L.circleMarker(ar.coords[0], {
                    radius: 6, fillColor: color, color: '#fff', weight: 2,
                    opacity: 1, fillOpacity: st === 'ended' ? 0.5 : 0.95,
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
        const st = rwStatus(c);
        return '<div onclick="zoomToRoadwork(' + i + ')" style="padding:6px 8px;border-left:3px solid ' +
            RW_STATUS_COLOR[st] + ';background:#fafafa;margin-bottom:4px;border-radius:0 4px 4px 0;' +
            'cursor:pointer;line-height:1.4;' + (st === 'ended' ? 'opacity:0.65;' : '') + '">' +
            '<div style="font-weight:bold;font-size:12px;">' + rwEsc(String(c.projectName || c.appNo).slice(0, 24)) + '</div>' +
            '<div style="color:#777;font-size:11px;">' + rwEsc(c.district || c.route || '') + '｜' + c.areas.length + ' 面</div>' +
            '<div style="font-size:10px;color:' + (st === 'pending' ? RW_COLOR_PENDING : '#999') + ';">' +
            (st === 'pending' ? '未核發' : rwEsc(c.startDate || '') + ' ~ ' + rwEsc(c.endDate)) + '</div>' +
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
    if (typeof rememberLayerPref === 'function') rememberLayerPref('roadwork', true);
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
    if (typeof rememberLayerPref === 'function') rememberLayerPref('roadwork', false);
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
