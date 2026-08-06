// ========== 歷史衛星影像時間軸（Esri World Imagery Wayback）==========
//
// 用途：切換到過去的衛星影像，可用於
//   施工前後對照、路面損壞爭議佐證、變更設計現況佐證、找舊管線施工痕跡。
//
// 資料來源：Esri World Imagery Wayback（與現有「衛星圖」同一套系統的歷史封存）
//   圖磚網址格式：.../World_Imagery/MapServer/tile/{releaseNum}/{z}/{y}/{x}
//   releaseNum 由官方設定檔提供，2014-02-20 起至今共 180+ 個版本。
//
// 版本清單來源策略：
//   1) 優先即時抓官方 waybackconfig.json（Esri 新增版本會自動出現，不用維護）
//   2) 抓不到（CORS/離線）就用下面的內建備援清單
//
// ⚠️ 注意：不是每個版本在台灣都有新影像。Esri 更新是分區進行的，
//    台中一帶可能連續幾個版本影像都相同，這是正常現象。

const WAYBACK_CONFIG_URL =
    'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const WAYBACK_TILE_URL =
    'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{num}/{z}/{y}/{x}';

// 內建備援清單（每年 2~3 個代表版本）。releaseNum 已對照官方設定檔驗證。
const WAYBACK_FALLBACK = [
    { num: 10, date: '2014-02-20' }, { num: 5232, date: '2014-07-30' }, { num: 5844, date: '2014-12-30' },
    { num: 20222, date: '2015-01-21' }, { num: 24007, date: '2015-07-08' }, { num: 28163, date: '2015-12-16' },
    { num: 3515, date: '2016-01-13' }, { num: 11509, date: '2016-06-13' }, { num: 18966, date: '2016-12-20' },
    { num: 577, date: '2017-01-11' }, { num: 14765, date: '2017-06-14' }, { num: 25521, date: '2017-11-16' },
    { num: 13161, date: '2018-01-08' }, { num: 8249, date: '2018-06-06' }, { num: 23448, date: '2018-12-14' },
    { num: 6036, date: '2019-01-09' }, { num: 645, date: '2019-06-26' }, { num: 4756, date: '2019-12-12' },
    { num: 23001, date: '2020-01-08' }, { num: 18289, date: '2020-07-01' }, { num: 29260, date: '2020-12-16' },
    { num: 1049, date: '2021-01-13' }, { num: 13534, date: '2021-06-30' }, { num: 26120, date: '2021-12-21' },
    { num: 42663, date: '2022-01-12' }, { num: 4905, date: '2022-06-29' }, { num: 45134, date: '2022-12-14' },
    { num: 11475, date: '2023-01-11' }, { num: 47963, date: '2023-06-29' }, { num: 56102, date: '2023-12-07' },
    { num: 41468, date: '2024-01-18' }, { num: 39767, date: '2024-06-27' }, { num: 16453, date: '2024-12-12' },
    { num: 36557, date: '2025-01-30' }, { num: 49999, date: '2025-07-31' }, { num: 13192, date: '2025-12-18' },
    { num: 22252, date: '2026-01-29' }, { num: 49059, date: '2026-04-30' }, { num: 26334, date: '2026-08-05' },
];

let waybackItems = null;        // [{num, date}]，由設定檔或備援清單填入
let waybackLayer = null;
let waybackVisible = false;
let waybackLoaded = false;

// ---------- 取得版本清單 ----------
async function loadWaybackItems() {
    if (waybackItems) return waybackItems;
    try {
        const resp = await fetch(WAYBACK_CONFIG_URL, { cache: 'force-cache' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const cfg = await resp.json();
        // 格式：{ "26334": { itemTitle: "World Imagery (Wayback 2026-08-05)", ... }, ... }
        const list = [];
        for (const num of Object.keys(cfg)) {
            const title = (cfg[num] && cfg[num].itemTitle) || '';
            const m = title.match(/(\d{4}-\d{2}-\d{2})/);
            if (m) list.push({ num: parseInt(num, 10), date: m[1] });
        }
        if (list.length) {
            list.sort((a, b) => a.date.localeCompare(b.date));
            waybackItems = list;
            return waybackItems;
        }
        throw new Error('設定檔沒有可用版本');
    } catch (e) {
        // 抓不到就用內建清單（例如 S3 沒開 CORS、或離線）
        console.warn('無法取得 Wayback 版本清單，改用內建備援清單:', e.message);
        waybackItems = WAYBACK_FALLBACK.slice();
        return waybackItems;
    }
}

// ---------- UI ----------
async function initWaybackUI() {
    if (waybackLoaded) return;
    const items = await loadWaybackItems();
    const sel = document.getElementById('waybackSelect');
    if (!sel) return;
    sel.innerHTML = items.slice().reverse()
        .map(it => '<option value="' + it.num + '">' + it.date + '</option>').join('');
    waybackLoaded = true;

    const info = document.getElementById('waybackInfo');
    if (info) {
        info.textContent = '共 ' + items.length + ' 個版本（' +
            items[0].date + ' ~ ' + items[items.length - 1].date + '）';
    }
}

async function toggleWaybackLayer() {
    waybackVisible = !waybackVisible;

    const opt = document.getElementById('layer-wayback');
    if (opt) {
        const box = opt.querySelector('.layer-checkbox');
        if (box) box.textContent = waybackVisible ? '☑' : '☐';
        opt.classList.toggle('active', waybackVisible);
    }
    const box = document.getElementById('waybackControls');
    if (box) box.style.display = waybackVisible ? 'block' : 'none';

    if (waybackVisible) {
        await initWaybackUI();
        applyWaybackVersion();
    } else if (waybackLayer && map) {
        map.removeLayer(waybackLayer);
        waybackLayer = null;
    }
}

// 套用目前選定的版本
function applyWaybackVersion() {
    if (!map || !waybackVisible) return;
    const sel = document.getElementById('waybackSelect');
    if (!sel || !sel.value) return;

    if (waybackLayer) { map.removeLayer(waybackLayer); waybackLayer = null; }

    waybackLayer = L.tileLayer(WAYBACK_TILE_URL.replace('{num}', sel.value), {
        attribution: 'Esri World Imagery Wayback',
        maxZoom: 19,
        maxNativeZoom: 19,
        // 缺圖時不要顯示破圖
        errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    });
    waybackLayer.addTo(map);
    // 歷史影像是「取代底圖」的性質，要壓在其他疊加層之下
    if (waybackLayer.bringToBack) waybackLayer.bringToBack();
    // 但仍要在真正的底圖之上
    if (window.currentBaseLayer && window.currentBaseLayer.bringToBack) {
        window.currentBaseLayer.bringToBack();
    }
    // 公有土地地籍圖要保持在最上層
    if (typeof refreshPublicLandOrder === 'function') refreshPublicLandOrder();
}

// 上一個 / 下一個版本（方便快速比對前後變化）
function stepWaybackVersion(dir) {
    const sel = document.getElementById('waybackSelect');
    if (!sel || !sel.options.length) return;
    let i = sel.selectedIndex + dir;
    i = Math.max(0, Math.min(sel.options.length - 1, i));
    sel.selectedIndex = i;
    applyWaybackVersion();
}

window.toggleWaybackLayer = toggleWaybackLayer;
window.applyWaybackVersion = applyWaybackVersion;
window.stepWaybackVersion = stepWaybackVersion;
// ========== 歷史衛星影像時間軸結束 ==========
