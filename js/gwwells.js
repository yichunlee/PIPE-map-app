// ========== 地下水水位觀測井（水利署開放資料）==========
// 資料來源：data.gov.tw dataset 32718「地下水水位觀測井井況」，
// 使用者手動下載 CSV 後上傳，worker 解析、依縣市分別存 D1。
// 操作方式比照公路局申挖路權：每縣市獨立、可勾選顯示、可個別刪除。

let gwDatasets = [];         // 已載入的縣市資料 { county, wells, visible, loaded }
let gwCloudFiles = [];       // 雲端已上傳的縣市清單
let gwVisible = false;
let gwLayer = null;
let gwLoading = false;

const GW_COLOR_ACTIVE = '#0288D1';   // 尚未廢站＝藍
const GW_COLOR_INACTIVE = '#9E9E9E'; // 已廢站＝灰

function gwCanEdit() {
    return typeof currentUser !== 'undefined' && currentUser &&
        typeof getRoleLevel === 'function' && getRoleLevel(currentUser.role) >= 2;
}

function gwEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
        m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function gwFmtDate(yyyymmdd) {
    const s = String(yyyymmdd || '');
    if (s.length !== 8) return s;
    return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
}

// 目前勾選中的資料集，合併所有井
function gwAllWells() {
    const out = [];
    gwDatasets.forEach(ds => { if (ds.visible && ds.loaded) out.push(...ds.wells); });
    return out;
}

function gwFiltered() {
    const onlyActive = document.getElementById('gwOnlyActive');
    const all = gwAllWells();
    if (onlyActive && onlyActive.checked) return all.filter(w => w.active);
    return all;
}

// ---------- 雲端清單 ----------
async function refreshGwFileList() {
    if (gwLoading) return;
    gwLoading = true;
    const countEl = document.getElementById('gwCount');
    if (countEl) countEl.textContent = '載入清單中…';
    try {
        const res = await apiCall('listGwWellFiles', {}, { silent: true });
        gwCloudFiles = res.files || [];
        gwDatasets = gwDatasets.filter(ds => gwCloudFiles.some(f => f.county === ds.county));
        renderGwFileList();
        updateGwCount();
        if (gwVisible) renderGwLayer();
    } catch (e) {
        console.error('載入地下水觀測井清單失敗:', e);
        if (countEl) countEl.textContent = '載入失敗：' + e.message;
    } finally {
        gwLoading = false;
    }
}

function renderGwFileList() {
    const el = document.getElementById('gwFileList');
    if (!el) return;
    if (gwCloudFiles.length === 0) {
        el.innerHTML = '<div style="color:#aaa;font-size:11px;padding:4px 0;">尚無上傳資料</div>';
        return;
    }
    const canEdit = gwCanEdit();
    el.innerHTML = gwCloudFiles.map(f => {
        const ds = gwDatasets.find(d => d.county === f.county);
        const on = ds ? ds.visible : false;
        const c = gwEsc(f.county);
        const del = canEdit
            ? `<span style="cursor:pointer;color:#c62828;padding:0 2px;" title="刪除"
                 onclick="event.stopPropagation();deleteGwCounty('${c}')">✕</span>`
            : '';
        return `<div onclick="toggleGwCounty('${c}')"
            style="display:flex;align-items:center;gap:5px;padding:4px 5px;margin-bottom:3px;
                   border-radius:4px;cursor:pointer;font-size:11px;
                   background:${on ? '#e3f2fd' : '#fafafa'};border:1px solid ${on ? '#90caf9' : '#eee'};">
            <input type="checkbox" ${on ? 'checked' : ''} style="margin:0;"
                   onclick="event.stopPropagation();toggleGwCounty('${c}')">
            <span style="flex:1;">${c}</span>
            <span style="color:#999;font-size:10px;">${f.well_count} 口</span>
            ${del}
        </div>`;
    }).join('');
}

async function toggleGwCounty(county) {
    let ds = gwDatasets.find(d => d.county === county);
    if (!ds) { ds = { county, wells: [], visible: false, loaded: false }; gwDatasets.push(ds); }

    if (!ds.loaded) {
        try {
            const res = await apiCall('getGwWells', { county }, { silent: true });
            ds.wells = res.wells || [];
            ds.loaded = true;
        } catch (e) {
            console.error('載入失敗:', e);
            showToast('載入「' + county + '」失敗', 'error');
            return;
        }
    }
    ds.visible = !ds.visible;

    if (ds.visible && !gwVisible) {
        gwVisible = true;
        const btn = document.getElementById('gwButton');
        if (btn) btn.classList.add('active');
    }
    renderGwFileList();
    updateGwCount();
    if (gwVisible) renderGwLayer();
}

function updateGwCount() {
    const el = document.getElementById('gwCount');
    if (!el) return;
    if (gwCloudFiles.length === 0) {
        el.innerHTML = '<span style="color:#999;">尚未上傳資料</span>';
        return;
    }
    const chosen = gwDatasets.filter(d => d.visible && d.loaded);
    if (chosen.length === 0) {
        el.innerHTML = '<span style="color:#999;">請勾選要顯示的縣市</span>';
        return;
    }
    const shown = gwFiltered();
    const total = gwAllWells().length;
    let h = '共 <b>' + shown.length + '</b> 口井';
    if (shown.length !== total) h += '<br><span style="color:#999;">（已隱藏 ' + (total - shown.length) + ' 口已廢站）</span>';
    h += '<br><span style="color:#aaa;font-size:10px;">已選 ' + chosen.length + ' 個縣市</span>';
    el.innerHTML = h;
}

// ---------- 繪製 ----------
function gwPopup(w) {
    const color = w.active ? GW_COLOR_ACTIVE : GW_COLOR_INACTIVE;
    let h = '<div style="min-width:210px;max-width:300px;font-size:12px;">';
    h += '<div style="font-weight:bold;color:' + color + ';margin-bottom:6px;">💧 ' + gwEsc(w.name) +
         (w.active ? '' : ' <span style="color:#999;font-weight:normal;">(已廢站)</span>') + '</div>';
    if (w.waterLevel != null) h += '<div style="margin:3px 0;"><b>水位：</b>' + w.waterLevel + ' m</div>';
    if (w.wellDepth) h += '<div style="margin:3px 0;"><b>井深：</b>' + w.wellDepth + ' m</div>';
    if (w.wellElevation != null) h += '<div style="margin:3px 0;"><b>井頂高：</b>' + w.wellElevation + ' m</div>';
    if (w.layerAttribute) {
        const lbl = { C: '受壓', L: '漏壓', U: '自由' }[w.layerAttribute] || w.layerAttribute;
        h += '<div style="margin:3px 0;"><b>含水層屬性：</b>' + lbl + '</div>';
    }
    if (w.groundwaterZone) h += '<div style="margin:3px 0;"><b>地下水分區：</b>' + gwEsc(w.groundwaterZone) + '</div>';
    h += '<div style="margin:3px 0;color:#666;"><b>位置：</b>' + gwEsc(w.county) + gwEsc(w.town) + '</div>';
    if (w.address) h += '<div style="margin:3px 0;color:#666;font-size:11px;">' + gwEsc(w.address) + '</div>';
    if (w.establishDate) h += '<div style="margin:3px 0;color:#999;font-size:11px;">設站：' + gwFmtDate(w.establishDate) + '</div>';
    h += '<div style="margin-top:6px;color:#b91c1c;font-size:10px;">⚠️ 水位資料每年更新，非即時值，僅供參考</div>';
    h += (typeof buildNavLink === 'function' ? buildNavLink(w.lat, w.lng) : '');
    h += '</div>';
    return h;
}

function renderGwLayer() {
    if (gwLayer) { map.removeLayer(gwLayer); gwLayer = null; }
    if (!map) return;
    gwLayer = L.layerGroup();

    gwFiltered().forEach(w => {
        const color = w.active ? GW_COLOR_ACTIVE : GW_COLOR_INACTIVE;
        const marker = L.circleMarker([w.lat, w.lng], {
            radius: 6, fillColor: color, color: '#fff', weight: 2,
            opacity: 1, fillOpacity: w.active ? 0.9 : 0.5,
        });
        marker.bindPopup(gwPopup(w));
        gwLayer.addLayer(marker);
    });
    gwLayer.addTo(map);
}

// ---------- 上傳 ----------
async function uploadGwWellsFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!gwCanEdit()) { showToast('需登入且具編輯權限才能上傳', 'error'); return; }

    const btn = document.getElementById('gwUploadBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 解析中…'; }
    try {
        const text = await file.text();
        const res = await apiCall('uploadGwWells', {}, {
            body: { csv: text, fileName: file.name },
            errorPrefix: '上傳失敗',
        });
        const names = (res.counties || []).slice(0, 5).map(c => c.county).join('、');
        showToast('已解析 ' + res.totalCount + ' 口井，涵蓋 ' + (res.counties || []).length +
            ' 縣市（' + names + (res.counties.length > 5 ? '…' : '') + '）', 'success');
        await refreshGwFileList();
        await showAllGwCounties();   // 全國井數不多（實測不到千口），上傳後直接全部顯示，不用一個個勾
    } catch (e) {
        console.error('上傳失敗:', e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📂 上傳 CSV'; }
    }
}

// 一次載入並顯示所有已上傳的縣市（全國井數量級不大，不需要分縣市勾選）
async function showAllGwCounties() {
    const toLoad = gwCloudFiles.filter(f => {
        const ds = gwDatasets.find(d => d.county === f.county);
        return !ds || !ds.visible;
    });
    for (const f of toLoad) {
        let ds = gwDatasets.find(d => d.county === f.county);
        if (!ds) { ds = { county: f.county, wells: [], visible: false, loaded: false }; gwDatasets.push(ds); }
        if (!ds.loaded) {
            try {
                const res = await apiCall('getGwWells', { county: f.county }, { silent: true });
                ds.wells = res.wells || [];
                ds.loaded = true;
            } catch (e) { console.warn('載入', f.county, '失敗:', e); continue; }
        }
        ds.visible = true;
    }
    if (!gwVisible) {
        gwVisible = true;
        const btn = document.getElementById('gwButton');
        if (btn) btn.classList.add('active');
    }
    renderGwFileList();
    updateGwCount();
    renderGwLayer();
}

async function deleteGwCounty(county) {
    if (!gwCanEdit()) { showToast('沒有刪除權限', 'error'); return; }
    if (!confirm('確定刪除「' + county + '」的觀測井資料？')) return;
    try {
        await apiCall('deleteGwWells', { county }, { errorPrefix: '刪除失敗' });
        gwDatasets = gwDatasets.filter(d => d.county !== county);
        showToast('已刪除', 'success');
        await refreshGwFileList();
    } catch (e) { /* apiCall 已提示 */ }
}

// ---------- 開關 ----------
function toggleGwLayer() {
    const panel = document.getElementById('gwPanel');
    const panelOpen = panel && panel.style.display !== 'none';

    if (gwVisible) {
        if (panelOpen) { hideGwLayer(); } else { openGwPanel(); }
        return;
    }
    gwVisible = true;
    const btn = document.getElementById('gwButton');
    if (btn) btn.classList.add('active');
    openGwPanel();
    if (gwCloudFiles.length === 0) {
        refreshGwFileList().then(showAllGwCounties);
    } else if (gwDatasets.some(d => d.visible)) {
        renderGwLayer();
    } else {
        showAllGwCounties();
    }
}

function openGwPanel() {
    const panel = document.getElementById('gwPanel');
    if (panel) panel.style.display = 'block';
    // 依權限顯示上傳/刪除鈕（訪客只能看）
    const canEdit = gwCanEdit();
    const up = document.getElementById('gwUploadBtn');
    if (up) up.style.display = canEdit ? '' : 'none';
    const del = document.getElementById('gwDeleteBtn');
    if (del) del.style.display = canEdit ? '' : 'none';
}

// 清空全部縣市的觀測井資料
async function deleteAllGwWells() {
    if (!gwCanEdit()) { showToast('沒有刪除權限', 'error'); return; }
    if (!confirm('確定清空所有縣市的地下水觀測井資料？')) return;
    try {
        await apiCall('deleteGwWells', {}, { errorPrefix: '清空失敗' });
        gwDatasets = [];
        showToast('已清空', 'success');
        await refreshGwFileList();
        if (gwLayer) { map.removeLayer(gwLayer); gwLayer = null; }
    } catch (e) { /* apiCall 已提示 */ }
}

function collapseGwPanel() {
    const panel = document.getElementById('gwPanel');
    if (panel) panel.style.display = 'none';
}

function hideGwLayer() {
    gwVisible = false;
    const btn = document.getElementById('gwButton');
    if (btn) btn.classList.remove('active');
    const panel = document.getElementById('gwPanel');
    if (panel) panel.style.display = 'none';
    if (gwLayer) { map.removeLayer(gwLayer); gwLayer = null; }
}

function onGwFilterChange() {
    updateGwCount();
    if (gwVisible) renderGwLayer();
}

window.toggleGwLayer = toggleGwLayer;
window.collapseGwPanel = collapseGwPanel;
window.openGwPanel = openGwPanel;
window.hideGwLayer = hideGwLayer;
window.toggleGwCounty = toggleGwCounty;
window.showAllGwCounties = showAllGwCounties;
window.deleteAllGwWells = deleteAllGwWells;
window.uploadGwWellsFile = uploadGwWellsFile;
window.deleteGwCounty = deleteGwCounty;
window.onGwFilterChange = onGwFilterChange;
window.refreshGwFileList = refreshGwFileList;
// ========== 地下水水位觀測井結束 ==========
