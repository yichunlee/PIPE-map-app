// ========== 進入地圖時自動開啟的參考圖層 ==========
// 需求：一進地圖就要看到「淨水場/供水轄區」「公路局申挖路權」「台中市自來水挖掘許可」，
// 不用每次自己點開；不需要時取消勾選，而且下次進來要記得取消過。
//
// 為什麼要獨立成一個檔案：
//   這三個圖層分屬 supplyzones.js / dgs-permits.js / roadwork.js，各自的開關函式
//   行為不一致（有的只切圖層、有的會連面板一起打開、有的還要再勾資料集）。
//   把「開機要自動開哪些」的決策集中在這裡，三個原始模組完全不用改，
//   日後要增減預設圖層也只改這一支。

const DL_STORE_KEY = 'defaultLayers.v1';

// 預設全開；使用者取消勾選後會寫進 localStorage，下次就不再自動開。
const DL_DEFAULTS = { supplyzone: true, dgs: true, roadwork: true };

let _dlApplied = false;     // 這次載入是否已經自動開過（避免切換計畫時重複觸發）
let _dlBusy = false;

function dlPrefs() {
    try {
        const saved = JSON.parse(localStorage.getItem(DL_STORE_KEY) || '{}');
        return Object.assign({}, DL_DEFAULTS, saved);
    } catch (e) {
        return Object.assign({}, DL_DEFAULTS);
    }
}

function dlSavePref(key, on) {
    try {
        const saved = JSON.parse(localStorage.getItem(DL_STORE_KEY) || '{}');
        saved[key] = !!on;
        localStorage.setItem(DL_STORE_KEY, JSON.stringify(saved));
    } catch (e) {
        console.warn('儲存圖層偏好失敗:', e);
    }
}

// 供三個模組的開關函式呼叫，把使用者的選擇記下來。
// 用「目前是否顯示」而不是「使用者按了什麼」，因為那些 toggle 函式的語意各不相同
// （例如申挖路權在圖層已開、面板收合時再按一次，是把面板叫回來而不是關圖層）。
window.rememberLayerPref = function (key, on) { dlSavePref(key, on); };

// ---------- 各圖層的開啟方式 ----------
// 這三個模組的 toggle 函式會順便把操作面板打開。自動開啟時只想要地圖上的資料，
// 面板一次跳三個會蓋住畫面，所以開完立刻收合面板（圖層會留著）。

async function dlEnableSupplyZone() {
    if (typeof toggleSupplyZoneLayer !== 'function') return;
    if (typeof supplyZoneVisible !== 'undefined' && supplyZoneVisible) return;
    await toggleSupplyZoneLayer();
}

async function dlEnableDgs() {
    if (typeof toggleDgsLayer !== 'function') return;
    if (typeof dgsVisible !== 'undefined' && dgsVisible) return;
    toggleDgsLayer();
    if (typeof collapseDgsPanel === 'function') collapseDgsPanel();
}

async function dlEnableRoadwork() {
    if (typeof toggleRoadworkLayer !== 'function') return;
    if (typeof roadworkVisible === 'undefined' || !roadworkVisible) {
        toggleRoadworkLayer();
        if (typeof collapseRoadworkPanel === 'function') collapseRoadworkPanel();
    }
    // 台中市挖掘許可是「一個檔案一個資料集」，光把圖層打開不會有任何標記，
    // 還要再勾選要顯示哪些檔案。等清單載完後挑最新的一個自動勾起來
    // （全部勾會一次抓下所有月份的資料，量太大也沒必要）。
    await dlWaitFor(() => typeof rwCloudFiles !== 'undefined' && rwCloudFiles.length > 0, 8000);
    if (typeof rwCloudFiles === 'undefined' || !rwCloudFiles.length) return;

    const saved = dlRoadworkSaved();
    let names = saved && saved.length
        ? saved.filter(n => rwCloudFiles.some(f => f.file_name === n))
        : [dlNewestRoadworkFile()];
    names = names.filter(Boolean);

    for (const nm of names) {
        const ds = (typeof rwDatasets !== 'undefined' ? rwDatasets : []).find(d => d.name === nm);
        if (!ds || !ds.visible) {
            if (typeof toggleRoadworkDataset === 'function') await toggleRoadworkDataset(nm);
        }
    }
    if (typeof collapseRoadworkPanel === 'function') collapseRoadworkPanel();
}

// 取最新的挖掘許可檔案。優先用上傳時間，沒有就用檔名排序（檔名多半含年月）。
function dlNewestRoadworkFile() {
    const files = (typeof rwCloudFiles !== 'undefined' ? rwCloudFiles : []).slice();
    if (!files.length) return null;
    files.sort((a, b) => {
        const ta = a.uploaded_at || '', tb = b.uploaded_at || '';
        if (ta && tb && ta !== tb) return ta < tb ? 1 : -1;
        return String(a.file_name) < String(b.file_name) ? 1 : -1;
    });
    return files[0].file_name;
}

function dlRoadworkSaved() {
    try {
        const saved = JSON.parse(localStorage.getItem(DL_STORE_KEY) || '{}');
        return Array.isArray(saved.roadworkFiles) ? saved.roadworkFiles : null;
    } catch (e) { return null; }
}

// 使用者手動勾選/取消資料集後記下來，下次進來沿用
window.rememberRoadworkFiles = function () {
    try {
        const on = (typeof rwDatasets !== 'undefined' ? rwDatasets : [])
            .filter(d => d.visible).map(d => d.name);
        const saved = JSON.parse(localStorage.getItem(DL_STORE_KEY) || '{}');
        saved.roadworkFiles = on;
        localStorage.setItem(DL_STORE_KEY, JSON.stringify(saved));
    } catch (e) { /* 記不起來就算了，不影響操作 */ }
};

// 等某個條件成立（給非同步載入的清單用），逾時就放棄
function dlWaitFor(cond, timeoutMs) {
    return new Promise(resolve => {
        const t0 = Date.now();
        (function tick() {
            if (cond()) return resolve(true);
            if (Date.now() - t0 > timeoutMs) return resolve(false);
            setTimeout(tick, 150);
        })();
    });
}

// ---------- 進入地圖後套用 ----------
// 由 showProjectPipelines / showPipelineDetail 呼叫。
// 只在第一次進地圖時跑，之後切換計畫不重跑（圖層本身會被 initMap 的清圖層動作
// 移除，所以另外用 reapply 補畫，不重新抓資料）。
window.applyDefaultLayers = async function () {
    if (_dlBusy) return;
    _dlBusy = true;
    try {
        const p = dlPrefs();
        if (!_dlApplied) {
            _dlApplied = true;
            // 逐一開啟，不用 Promise.all：三個都會打 API，一起發會讓
            // 手機在工地的網路更容易逾時，也讓錯誤難以歸因。
            if (p.supplyzone) await dlEnableSupplyZone().catch(e => console.warn('供水轄區', e));
            if (p.dgs) await dlEnableDgs().catch(e => console.warn('申挖路權', e));
            if (p.roadwork) await dlEnableRoadwork().catch(e => console.warn('挖掘許可', e));
        } else {
            dlReapply(p);
        }
    } finally {
        _dlBusy = false;
    }
};

// 切換計畫/工程時 initMap 會把非底圖的圖層全部移除，
// 這裡把已經抓回來的資料重畫一次就好，不再打 API。
function dlReapply(p) {
    if (p.supplyzone && typeof supplyZoneVisible !== 'undefined' && supplyZoneVisible
        && typeof renderSupplyZoneLayer === 'function') renderSupplyZoneLayer();
    if (p.dgs && typeof dgsVisible !== 'undefined' && dgsVisible
        && typeof renderDgsPermits === 'function') renderDgsPermits();
    if (p.roadwork && typeof roadworkVisible !== 'undefined' && roadworkVisible
        && typeof displayRoadworkMarkers === 'function') displayRoadworkMarkers();
}

// ========== 預設圖層結束 ==========
