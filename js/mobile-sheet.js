// ========== 手機版面板收合 ==========
// 工地現場最常做的是「更新小段完工狀態」——需要看得到地圖、點得到小段。
// 但圖層面板在手機上會佔掉大半螢幕，把要點的東西蓋住。
//
// 解法：手機上點面板標題列可以把面板收合成一條（只留標題），
// 地圖立刻全部露出來；要再操作面板時點一下標題就展開。
// 桌機不受影響（沒有 sheet-collapsed 這個 class 的樣式）。

const MOBILE_MAX_WIDTH = 768;

function isMobileView() {
    return window.innerWidth <= MOBILE_MAX_WIDTH;
}

// 需要支援收合的面板，以及各自的標題列選擇器
const SHEET_PANELS = [
    { panel: 'roadworkPanel', title: '.panel-title' },
    { panel: 'dgsPanel', title: '.panel-title' },
    { panel: 'gwPanel', title: '.panel-title' },
    { panel: 'layerPanel', title: '.layer-panel-header' },
];

function toggleSheetCollapse(panelId) {
    if (!isMobileView()) return;           // 桌機不啟用
    const el = document.getElementById(panelId);
    if (!el) return;
    el.classList.toggle('sheet-collapsed');
    updateSheetHint(panelId);
}

// 在標題列右側顯示 ▼/▲ 提示目前是展開還是收合
function updateSheetHint(panelId) {
    const el = document.getElementById(panelId);
    if (!el) return;
    const cfg = SHEET_PANELS.find(p => p.panel === panelId);
    if (!cfg) return;
    const title = el.querySelector(cfg.title);
    if (!title) return;

    let hint = title.querySelector('.sheet-hint');
    if (!isMobileView()) {                  // 桌機不顯示提示
        if (hint) hint.remove();
        return;
    }
    if (!hint) {
        hint = document.createElement('span');
        hint.className = 'sheet-hint';
        hint.style.cssText = 'margin-left:auto;color:#94a3b8;font-size:12px;padding:0 6px;';
        title.appendChild(hint);
    }
    hint.textContent = el.classList.contains('sheet-collapsed') ? '▲ 展開' : '▼ 收合';
}

// 綁定標題列點擊。注意標題列裡本來就有「✕ 關閉」之類的按鈕，
// 點那些時不能觸發收合，所以只在點到標題列本身或文字時才處理。
function initSheetPanels() {
    SHEET_PANELS.forEach(cfg => {
        const el = document.getElementById(cfg.panel);
        if (!el) return;
        const title = el.querySelector(cfg.title);
        if (!title || title.dataset.sheetBound) return;
        title.dataset.sheetBound = '1';
        title.addEventListener('click', (ev) => {
            // 點到有自己 onclick 的元素（關閉鈕等）就不收合
            if (ev.target.closest('[onclick]') && ev.target !== title) return;
            toggleSheetCollapse(cfg.panel);
        });
        updateSheetHint(cfg.panel);
    });
}

// 面板是動態顯示的，用 MutationObserver 在它出現時補上綁定
function watchSheetPanels() {
    const check = () => initSheetPanels();
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
}

// 轉向或視窗尺寸改變時，重新判斷是否該顯示收合提示
window.addEventListener('resize', () => {
    SHEET_PANELS.forEach(cfg => {
        const el = document.getElementById(cfg.panel);
        if (!el) return;
        if (!isMobileView()) el.classList.remove('sheet-collapsed');  // 回到桌機就展開
        updateSheetHint(cfg.panel);
    });
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchSheetPanels);
} else {
    watchSheetPanels();
}

window.toggleSheetCollapse = toggleSheetCollapse;
window.isMobileView = isMobileView;
// ========== 手機版面板收合結束 ==========
