// ========== 公路局申挖路權（自來水）圖層 ==========
// 資料來源：交通部公路局「道路申挖系統」即時 KML（僅涵蓋省道）
//   https://dgs.thb.gov.tw/thbdgs/CMMDGS/TEMP/DGS_{縣市}.kml
// 政府網站沒開 CORS，由 worker 的 getDgsPermits 代抓＋解析成 JSON。
// 與 roadwork.js（台中市市區道路）是兩套不同系統，可同時開啟。

let dgsCases = [];
let dgsVisible = false;
let dgsPolyLayer = null;    // 真實挖掘面（放大時顯示）
let dgsPointLayer = null;   // 圓點（縮小時顯示）
let dgsLoading = false;
let dgsZoomBound = false;
let dgsMeta = {};
let dgsUploadedCities = [];

const DGS_ZOOM_THRESHOLD = 17;   // 這個層級以上換成真實挖掘面
const DGS_COLOR = '#0288D1';     // 自來水＝藍
const DGS_COLOR_EXPIRED = '#90A4AE';

const DGS_CITIES = ['台中市','彰化縣','南投縣','苗栗縣','雲林縣','嘉義縣','嘉義市',
    '台南市','高雄市','屏東縣','新竹縣','新竹市','桃園市','台北市','新北市','基隆市',
    '宜蘭縣','花蓮縣','台東縣'];

// ---------- 小工具 ----------
function dgsToday() {
    const d = new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

// 是否在核准（或展延）期間內
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

// ---------- 載入 ----------
async function loadDgsPermits(force) {
    if (dgsLoading) return;
    dgsLoading = true;

    const citySel = document.getElementById('dgsCity');
    const kwInput = document.getElementById('dgsKeyword');
    const countEl = document.getElementById('dgsCount');

    const city = citySel ? citySel.value : '台中市';
    const keyword = kwInput ? kwInput.value.trim() : '自來水';

    if (countEl) countEl.textContent = '載入中…';

    try {
        const params = { city: city };
        if (keyword) { params.keyword = keyword; } else { params.all = '1'; }
        if (force) params.force = '1';

        const result = await apiCall('getDgsPermits', params, { errorPrefix: '申挖資料' });
        dgsCases = result.cases || [];
        dgsMeta = { sourceFile: result.sourceFile, uploadedAt: result.uploadedAt,
                    uploadedBy: result.uploadedBy, totalInFile: result.totalInFile, empty: result.empty };

        if (result.empty) {
            if (countEl) countEl.innerHTML = '<span style="color:#999;">' + city + ' 尚未上傳 KML</span>';
        } else {
            updateDgsCount();
        }
        renderDgsList();
        if (dgsVisible) renderDgsPermits();
    } catch (e) {
        console.error('載入申挖路權失敗:', e);
        if (countEl) countEl.textContent = '載入失敗：' + e.message;
    } finally {
        dgsLoading = false;
    }
}

// ---------- 繪製 ----------
function dgsPopupHtml(c, loc) {
    const active = dgsIsActive(c);
    let h = '<div style="min-width:250px;max-width:320px;font-size:12px;">';
    h += '<div style="font-weight:bold;color:' + DGS_COLOR + ';margin-bottom:6px;">💧 省道申挖路權' +
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

    dgsFilteredCases().forEach(c => {
        const active = dgsIsActive(c);
        const color = active ? DGS_COLOR : DGS_COLOR_EXPIRED;

        c.locations.forEach(loc => {
            const popup = dgsPopupHtml(c, loc);

            if (loc.type === 'polygon' && loc.coords.length >= 3) {
                const poly = L.polygon(loc.coords, {
                    color: color,
                    weight: 2,
                    fillColor: color,
                    fillOpacity: active ? 0.45 : 0.2,
                    dashArray: active ? null : '4,3',
                });
                poly.bindPopup(popup);
                dgsPolyLayer.addLayer(poly);
            }

            if (loc.center) {
                const marker = L.circleMarker(loc.center, {
                    radius: 7,
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: active ? 0.9 : 0.5,
                });
                marker.bindPopup(popup);
                dgsPointLayer.addLayer(marker);
            }
        });
    });

    applyDgsZoomLevel();

    if (!dgsZoomBound) {
        map.on('zoomend', applyDgsZoomLevel);
        dgsZoomBound = true;
    }
}

// 縮小看圓點、放大看真實挖掘面（挖掘面通常只有幾平方公尺，縮小時看不到）
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

// ---------- 清單 ----------
function renderDgsList() {
    const listEl = document.getElementById('dgsList');
    if (!listEl) return;

    const cases = dgsFilteredCases();
    if (cases.length === 0) {
        listEl.innerHTML = '<div style="color:#999;padding:8px 0;text-align:center;">查無符合的案件</div>';
        return;
    }

    listEl.innerHTML = cases.map((c, i) => {
        const active = dgsIsActive(c);
        return '<div onclick="zoomToDgsCase(' + i + ')" style="padding:6px 8px;border-left:3px solid ' +
            (active ? DGS_COLOR : DGS_COLOR_EXPIRED) + ';background:#f7f9fa;margin-bottom:4px;' +
            'border-radius:0 4px 4px 0;cursor:pointer;line-height:1.5;">' +
            '<div style="font-weight:bold;">' + dgsEsc(c.caseNo) + '</div>' +
            '<div style="color:#555;">' + dgsEsc(c.route) + '｜' + dgsEsc(c.pipeType) + '｜' + c.locations.length + ' 點</div>' +
            '<div style="color:#888;font-size:11px;">' + dgsEsc(c.startDate) + ' ~ ' + dgsEsc(c.extEndDate || c.endDate) + '</div>' +
            '</div>';
    }).join('');
}

function zoomToDgsCase(index) {
    const cases = dgsFilteredCases();
    const c = cases[index];
    if (!c || !map) return;
    const pts = [];
    c.locations.forEach(loc => { if (loc.center) pts.push(loc.center); });
    if (pts.length === 0) return;
    if (pts.length === 1) {
        map.setView(pts[0], 18);
    } else {
        map.fitBounds(L.latLngBounds(pts).pad(0.3));
    }
}

function fitDgsBounds() {
    const pts = [];
    dgsFilteredCases().forEach(c => c.locations.forEach(loc => { if (loc.center) pts.push(loc.center); }));
    if (pts.length === 0) { showToast('目前沒有可顯示的案件', 'info'); return; }
    map.fitBounds(L.latLngBounds(pts).pad(0.2));
}

// ---------- 開關 ----------
function toggleDgsLayer() {
    const btn = document.getElementById('dgsButton');
    const panel = document.getElementById('dgsPanel');
    dgsVisible = !dgsVisible;

    if (dgsVisible) {
        if (btn) btn.classList.add('active-blue');
        if (panel) panel.style.display = 'block';
        loadDgsUploadList();
        if (dgsCases.length === 0) {
            loadDgsPermits(false);
        } else {
            renderDgsPermits();
        }
    } else {
        if (btn) btn.classList.remove('active-blue');
        if (panel) panel.style.display = 'none';
        clearDgsLayers();
    }
}

function updateDgsCount() {
    const countEl = document.getElementById('dgsCount');
    if (!countEl) return;
    const shown = dgsFilteredCases();
    const pts = shown.reduce((s, c) => s + c.locations.length, 0);
    let h = '共 <b>' + shown.length + '</b> 件 / ' + pts + ' 個挖掘點';
    if (shown.length !== dgsCases.length) {
        h += '<br><span style="color:#999;">（已隱藏 ' + (dgsCases.length - shown.length) + ' 件非施工期間）</span>';
    }
    if (dgsMeta.uploadedAt) {
        h += '<br><span style="color:#aaa;font-size:10px;">來源 ' + dgsEsc(dgsMeta.sourceFile || 'KML') +
             '，' + dgsMeta.uploadedAt.slice(0, 10) + ' 上傳</span>';
    }
    countEl.innerHTML = h;
}

function onDgsFilterChange() {
    renderDgsList();
    updateDgsCount();
    if (dgsVisible) renderDgsPermits();
}

// ---------- 上傳 KML ----------
async function uploadDgsKml(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    input.value = '';   // 讓同一個檔案可以重複選

    if (!currentUser) { showToast('請先登入才能上傳', 'error'); return; }

    // 從檔名猜縣市（DGS_彰化縣.kml），猜不到就用目前下拉選的
    let city = (document.getElementById('dgsCity') || {}).value || '台中市';
    const m = file.name.match(/(基隆市|新北市|台北市|桃園市|新竹縣|新竹市|苗栗縣|台中市|南投縣|彰化縣|雲林縣|嘉義縣|嘉義市|台南市|高雄市|屏東縣|宜蘭縣|花蓮縣|台東縣)/);
    if (m) city = m[1];
    else {
        const ask = prompt('無法從檔名判斷縣市，請輸入（例：彰化縣）', city);
        if (!ask) return;
        city = ask.trim().replace(/^臺/, '台');
    }

    const btn = document.getElementById('dgsUploadBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 解析中…'; }

    try {
        const text = await file.text();
        const res = await apiCall('uploadDgsKml', {}, {
            body: { city: city, kml: text, fileName: file.name },
            errorPrefix: '上傳失敗',
        });
        showToast(city + '：解析出 ' + res.count + ' 件案件、' + res.pointCount + ' 個挖掘點', 'success');

        const sel = document.getElementById('dgsCity');
        if (sel) sel.value = city;
        await loadDgsUploadList();
        await loadDgsPermits(false);
    } catch (e) {
        console.error('上傳 KML 失敗:', e);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📂 上傳 KML'; }
    }
}

// 已上傳清單
async function loadDgsUploadList() {
    const el = document.getElementById('dgsUploadList');
    if (!el) return;
    try {
        const res = await apiCall('listDgsUploads', {}, { silent: true });
        const ups = res.uploads || [];
        dgsUploadedCities = ups.map(u => u.city);
        if (ups.length === 0) {
            el.innerHTML = '<div style="color:#aaa;font-size:10px;padding:2px 0;">尚無上傳資料</div>';
            return;
        }
        el.innerHTML = ups.map(u =>
            '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:#666;padding:1px 0;">' +
            '<span style="flex:1;cursor:pointer;" onclick="switchDgsCity(\'' + u.city + '\')">' +
            dgsEsc(u.city) + '（' + u.case_count + ' 件）</span>' +
            '<span style="cursor:pointer;color:#c62828;" onclick="deleteDgsUpload(\'' + u.city + '\')" title="刪除">✕</span>' +
            '</div>'
        ).join('');
    } catch (e) { /* 沒有這個 action 也不要讓面板壞掉 */ }
}

function switchDgsCity(city) {
    const sel = document.getElementById('dgsCity');
    if (sel) sel.value = city;
    loadDgsPermits(false);
}

async function deleteDgsUpload(city) {
    if (!confirm('確定刪除 ' + city + ' 的申挖資料？')) return;
    try {
        await apiCall('deleteDgsUpload', { city: city }, { errorPrefix: '刪除失敗' });
        showToast(city + ' 已刪除', 'success');
        await loadDgsUploadList();
        await loadDgsPermits(false);
    } catch (e) { /* apiCall 已提示 */ }
}

async function refreshDgsPermits() {
    dgsCases = [];
    await loadDgsPermits(true);
}

// 縣市下拉選單初始化
function initDgsCitySelect() {
    const sel = document.getElementById('dgsCity');
    if (!sel || sel.options.length > 0) return;
    DGS_CITIES.forEach(c => {
        const o = document.createElement('option');
        o.value = c; o.textContent = c;
        sel.appendChild(o);
    });
    sel.value = '台中市';
}

document.addEventListener('DOMContentLoaded', initDgsCitySelect);

window.toggleDgsLayer = toggleDgsLayer;
window.refreshDgsPermits = refreshDgsPermits;
window.onDgsFilterChange = onDgsFilterChange;
window.zoomToDgsCase = zoomToDgsCase;
window.fitDgsBounds = fitDgsBounds;
window.uploadDgsKml = uploadDgsKml;
window.switchDgsCity = switchDgsCity;
window.deleteDgsUpload = deleteDgsUpload;
// ========== 公路局申挖路權圖層結束 ==========
