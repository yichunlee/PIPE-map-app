// ========== 街景（Google Street View）==========
//
// 兩種模式，依 config.js 的 GOOGLE_MAPS_EMBED_KEY 自動切換：
//
//   A. 沒填 key（預設）→ 開新分頁到 Google 街景
//      完全免費、不用任何設定。
//
//   B. 有填 key → 街景直接嵌在系統裡的面板
//      用 Maps Embed API，官方載明「免費且無使用次數限制」。
//
// ⚠️ 不要改用 Maps JavaScript API 的 Dynamic Street View 或
//    Street View Static API——那兩個是「按次計費」的，會產生費用。

let _svActive = false;          // 是否在「選點看街景」模式
let _svPanel = null;
let _svLastLatLng = null;

function svKey() {
    return (typeof GOOGLE_MAPS_EMBED_KEY !== 'undefined' && GOOGLE_MAPS_EMBED_KEY)
        ? String(GOOGLE_MAPS_EMBED_KEY).trim() : '';
}

// ---------- 進入／離開選點模式 ----------
function toggleStreetView() {
    _svActive ? exitStreetViewPick() : enterStreetViewPick();
}

function enterStreetViewPick() {
    if (!map) return;
    _svActive = true;
    const btn = document.getElementById('streetViewButton');
    if (btn) btn.classList.add('active');

    const c = map.getContainer();
    c.style.cursor = 'crosshair';
    map.on('click', _svOnMapClick);

    showStreetViewHint(true);
}

function exitStreetViewPick() {
    _svActive = false;
    const btn = document.getElementById('streetViewButton');
    if (btn) btn.classList.remove('active');
    if (map) {
        map.getContainer().style.cursor = '';
        map.off('click', _svOnMapClick);
    }
    showStreetViewHint(false);
}

function showStreetViewHint(show) {
    let el = document.getElementById('_svHint');
    if (!show) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = '_svHint';
    el.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);' +
        'background:#1e293b;color:#fff;padding:8px 16px;border-radius:20px;z-index:1500;' +
        'font-size:13px;box-shadow:0 2px 12px rgba(0,0,0,.3);display:flex;align-items:center;gap:10px;';
    el.innerHTML = '🧍 點選地圖上任一點查看街景' +
        '<span onclick="exitStreetViewPick()" style="cursor:pointer;opacity:.7;font-size:16px;">✕</span>';
    document.body.appendChild(el);
}

function _svOnMapClick(e) {
    openStreetView(e.latlng.lat, e.latlng.lng);
    exitStreetViewPick();
}

// ---------- 開啟街景 ----------
// heading 可選：有的話讓視角朝向管線方向
function openStreetView(lat, lng, heading) {
    _svLastLatLng = { lat, lng };
    const key = svKey();
    if (!key) {
        // 模式 A：開新分頁（免費、免設定）
        const url = 'https://www.google.com/maps/@?api=1&map_action=pano' +
            '&viewpoint=' + lat + ',' + lng +
            (heading != null ? '&heading=' + Math.round(heading) : '');
        window.open(url, '_blank', 'noopener');
        return;
    }
    // 模式 B：嵌入面板
    showStreetViewPanel(lat, lng, heading, key);
}

function showStreetViewPanel(lat, lng, heading, key) {
    closeStreetViewPanel();
    const p = document.createElement('div');
    p.id = '_svPanel';
    p.style.cssText = 'position:absolute;left:50%;bottom:24px;transform:translateX(-50%);' +
        'width:min(720px,calc(100vw - 100px));height:min(420px,52vh);background:#000;' +
        'border-radius:10px;overflow:hidden;z-index:1600;box-shadow:0 6px 28px rgba(0,0,0,.45);' +
        'display:flex;flex-direction:column;';

    const src = 'https://www.google.com/maps/embed/v1/streetview?key=' + encodeURIComponent(key) +
        '&location=' + lat + ',' + lng +
        (heading != null ? '&heading=' + Math.round(heading) : '') +
        '&fov=90&pitch=0';

    p.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:#1e293b;color:#fff;font-size:12px;">' +
        '<span style="flex:1;">🧍 街景　<span style="color:#94a3b8;">' +
        lat.toFixed(6) + ', ' + lng.toFixed(6) + '</span></span>' +
        '<span onclick="openStreetViewExternal()" title="在 Google 地圖開啟" ' +
        'style="cursor:pointer;padding:2px 8px;background:#334155;border-radius:4px;">↗ 開新分頁</span>' +
        '<span onclick="closeStreetViewPanel()" style="cursor:pointer;font-size:16px;padding:0 4px;">✕</span>' +
        '</div>' +
        '<iframe src="' + src + '" style="flex:1;border:0;" allowfullscreen loading="lazy" ' +
        'referrerpolicy="no-referrer-when-downgrade"></iframe>';
    document.body.appendChild(p);
    _svPanel = p;
}

function closeStreetViewPanel() {
    const p = document.getElementById('_svPanel');
    if (p) p.remove();
    _svPanel = null;
}

function openStreetViewExternal() {
    if (!_svLastLatLng) return;
    window.open('https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=' +
        _svLastLatLng.lat + ',' + _svLastLatLng.lng, '_blank', 'noopener');
}

// ---------- 從管線上的點看街景（帶方位角）----------
// 給 popup 用：看這個小段時，視角朝向管線延伸方向
function openStreetViewAt(lat, lng, lat2, lng2) {
    let heading = null;
    if (lat2 != null && lng2 != null) heading = svBearing(lat, lng, lat2, lng2);
    openStreetView(lat, lng, heading);
}

// 兩點間的方位角（度，0=北）
function svBearing(lat1, lng1, lat2, lng2) {
    const toRad = d => d * Math.PI / 180;
    const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

window.toggleStreetView = toggleStreetView;
window.enterStreetViewPick = enterStreetViewPick;
window.exitStreetViewPick = exitStreetViewPick;
window.openStreetView = openStreetView;
window.openStreetViewAt = openStreetViewAt;
window.closeStreetViewPanel = closeStreetViewPanel;
window.openStreetViewExternal = openStreetViewExternal;
window.svBearing = svBearing;
// ========== 街景結束 ==========
