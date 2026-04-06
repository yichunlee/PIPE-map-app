// v20260406_0206
// ========== 甘特圖功能 ==========
window.ganttData = []; // 全域，讓 batch.js 可存取已建立的甘特項目
let ganttPanelOpen = false;
let unitPricesCache = []; // 施工單價快取

// 從 label 解析段落+小段範圍，計算完工進度
function getItemProgress(item) {
    const label = item.label || '';
    const segMatch = label.match(/段落([A-Za-z0-9\-]+)/);
    const rangeMatch = label.match(/#(\d+)～#(\d+)/);
    if (!segMatch) return null;
    const seg = (currentPipeline.segments || []).find(s => String(s.segmentNumber) === segMatch[1]);
    if (!seg) return null;
    const arr = (seg.smallSegments || '').split(',').map(s => s.trim());
    const segLen = seg.endDistance - seg.startDistance;
    const numSmall = Math.ceil(segLen / 10);
    const from = rangeMatch ? parseInt(rangeMatch[1]) - 1 : 0;
    const to = rangeMatch ? parseInt(rangeMatch[2]) - 1 : numSmall - 1;
    let done = 0, total = 0;
    for (let i = from; i <= to; i++) {
        const smallLen = Math.min(10, segLen - i * 10);
        total += smallLen;
        if (arr[i] && arr[i] !== '0' && arr[i].trim() !== '') done += smallLen;
    }
    return { done: Math.round(done), total: Math.round(total), rate: total > 0 ? done / total : 0 };
}

window.toggleGanttPanel = async function() {
    console.log('=== 開始載入甘特圖 ===');
    
    // 先立即開視窗顯示 loading，不等資料
    const loadingHTML = `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><title>載入中...</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;}
.spinner{width:40px;height:40px;border:4px solid #e0e0e0;border-top:4px solid #00695C;border-radius:50%;animation:spin 0.8s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}</style></head>
<body><div class="spinner"></div><p style="color:#666;font-size:14px;">載入甘特圖資料中...</p></body></html>`;
    
    const loadingBlob = new Blob([loadingHTML], { type: 'text/html;charset=utf-8' });
    const loadingUrl = URL.createObjectURL(loadingBlob);
    window.ganttWindow = window.open(loadingUrl, 'gantt_' + currentPipeline.id, 'width=1400,height=900');
    setTimeout(() => URL.revokeObjectURL(loadingUrl), 1000);

    // 偵測 blob 視窗關閉 → 清除地圖螢光
    if (window._ganttWindowCloseTimer) clearInterval(window._ganttWindowCloseTimer);
    window._ganttWindowCloseTimer = setInterval(() => {
        if (!window.ganttWindow || window.ganttWindow.closed) {
            clearInterval(window._ganttWindowCloseTimer);
            window._ganttWindowCloseTimer = null;
            if (typeof clearGanttHighlight === 'function') clearGanttHighlight();
        }
    }, 800);
    
    try {
        // 平行抓取三個 API
        const projName = currentProject ? (currentProject.name || '') : '';
        const [result, upResult] = await Promise.all([
            apiCall('getGanttItems', { pipelineId: currentPipeline.id }),
            apiCall('getUnitPrices', { pipelineId: currentPipeline.id, projectName: projName })
        ]);
        
        const items = (result.items || []).sort((a, b) => {
            const oa = a.sortOrder != null ? a.sortOrder : 9999;
            const ob = b.sortOrder != null ? b.sortOrder : 9999;
            return oa !== ob ? oa - ob : new Date(a.startDate) - new Date(b.startDate);
        });
        const milestones = [];
        const unitPrices = upResult.prices || [];
        
        console.log('載入項目數:', items.length, '單價筆數:', unitPrices.length);
        
        // 資料備妥，產生完整 HTML 並替換視窗內容
        const html = createGanttWindowHTML(items, currentPipeline, milestones, unitPrices);
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        if (window.ganttWindow && !window.ganttWindow.closed) {
            window.ganttWindow.location.href = url;
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } else {
            // 視窗被關掉了就重開
            window.ganttWindow = window.open(url, 'gantt_' + currentPipeline.id, 'width=1400,height=900');
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }
    } catch(e) {
        console.error('開啟甘特圖失敗', e);
        showToast('開啟甘特圖失敗：' + e.message, 'error');
        if (window.ganttWindow && !window.ganttWindow.closed) window.ganttWindow.close();
    }
};

function createGanttWindowHTML(items, pipeline, milestones, unitPrices) {
    function safeJson(obj) {
        return JSON.stringify(obj)
            .replace(/</g, '\\u003c')
            .replace(/>/g, '\\u003e')
            .replace(/`/g, '\\u0060')
            .replace(/\$\{/g, '\\u0024{');
    }
    const itemsJson = safeJson(items);
    const segmentsJson = safeJson(pipeline.segments || []);
    const pipelineJson = safeJson(pipeline);
    const milestonesJson = "[]"; // 里程碑功能已移除
    const nameEscaped = (pipeline.name || '').replace(/'/g, "\\'").replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    const unitPricesJson = safeJson(unitPrices || []);
    const apiUrl = API_URL;
    const tokenEscaped = (userToken || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    
    return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<title>施工甘特圖 - ${nameEscaped}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; background: #f5f5f5; height: 100vh; display: flex; flex-direction: column; }
.header { background: #00695C; color: white; padding: 8px 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.header h1 { font-size: 14px; }
.chart-area { flex: 1; padding: 10px; overflow-y: auto; position: relative; }
.container { background: white; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 10px; }
.gantt-row { display: flex; margin-bottom: 3px; align-items: center; cursor: pointer; }
.gantt-row:hover { background: #f5f5f5; }
.gantt-row:hover .gantt-label { background: #f5f5f5; }
.gantt-label { width: 180px; font-size: 9px; color: #999; padding: 2px 4px 2px 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; position:sticky; left:0; background:white; z-index:2; }
.gantt-notes { font-size: 11px; font-weight: bold; color: #222; font-style: normal; padding: 1px 4px 1px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gantt-timeline-container { flex: 1; position: relative; }
.gantt-timeline { height: 26px; background: #f9f9f9; border-radius: 3px; position: relative; }
.gantt-bar { position: absolute; height: 100%; border-radius: 3px; display: flex; align-items: center; padding: 0 6px; font-size: 9px; color: white; font-weight: bold; }
.gantt-drag-overlay:hover { outline: 2px solid rgba(255,255,255,0.6); border-radius: 3px; }
.gantt-drag-overlay.dragging { cursor: grabbing !important; opacity: 0.85; }
.gantt-resize-handle:hover { background: rgba(255,255,255,0.3); border-radius: 0 3px 3px 0; }
.gantt-drag-ghost { position: absolute; border: 2px dashed rgba(255,255,255,0.8); border-radius: 3px; pointer-events: none; z-index: 20; background: rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; font-size: 10px; color: white; font-weight: bold; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
.gantt-progress { position: absolute; left: 100%; padding-left: 6px; font-size: 10px; color: #333; font-weight: 600; white-space: nowrap; display: flex; align-items: center; height: 100%; }
.gantt-today { position: absolute; width: 2px; height: 100%; background: #e53935; z-index: 10; }

.edit-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(520px, 95vw); background: white; border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.25); padding: 16px; display: none; z-index: 200; max-height: 85vh; overflow-y: auto; }
.edit-panel.show { display: block; }
.edit-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 199; display: none; }
.edit-backdrop.show { display: block; }
.panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #00695C; }
.panel-title { font-size: 12px; font-weight: bold; color: #00695C; }
.close-btn { cursor: pointer; font-size: 18px; color: #666; line-height: 1; }
.close-btn:hover { color: #333; }
button { cursor: pointer; padding: 6px 10px; border: none; border-radius: 4px; font-size: 11px; font-weight: bold; }
.btn-primary { background: #00695C; color: white; width: 100%; margin-top: 6px; }
.btn-primary:hover { background: #004D40; }
.btn-danger { background: #e53935; color: white; width: 100%; margin-top: 6px; }
input, select { width: 100%; padding: 5px 6px; border: 1px solid #ddd; border-radius: 3px; margin-bottom: 6px; font-size: 11px; }
label { display: block; font-size: 10px; color: #666; margin: 5px 0 2px; font-weight: bold; }
.info-box { background: #e8f5e9; padding: 6px 8px; border-radius: 4px; margin-bottom: 8px; font-size: 10px; }
.add-btn { position: fixed; top: 12px; right: 12px; width: 36px; height: 36px; border-radius: 8px; background: #00695C; color: white; font-size: 18px; box-shadow: 0 2px 6px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; z-index: 99; }
.add-btn:hover { background: #004D40; }

/* 統計報表面板 */
.stats-report-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 3000;
    background: white;
    display: none;
    width: 90%;
    max-width: 1200px;
    height: 80%;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    flex-direction: column;
}

.stats-report-header {
    padding: 20px;
    border-bottom: 1px solid #e0e0e0;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.stats-report-content {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
}

.stats-report-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
}

.stats-report-table th,
.stats-report-table td {
    padding: 10px;
    text-align: center;
    border: 1px solid #e0e0e0;
}

.stats-report-table th {
    background: #667eea;
    color: white;
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 10;
}

.stats-report-table tbody tr:hover {
    background: #f5f5f5;
}

</style>
</head>
<body>
<div class="header" style="display:flex;justify-content:space-between;align-items:center;"><h1>📊 施工甘特圖 - ${nameEscaped}</h1><div style="display:flex;gap:6px;"><button onclick="showAddForm()" style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:12px;cursor:pointer;padding:4px 12px;border-radius:4px;">＋ 新增</button><button onclick="showSCurveWindow()" style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:12px;cursor:pointer;padding:4px 12px;border-radius:4px;">📈 S曲線</button><button onclick="showUnitPriceMgr()" style="background:rgba(255,255,255,0.15);border:none;color:white;font-size:12px;cursor:pointer;padding:4px 12px;border-radius:4px;">⚙️ 施工單價</button><button onclick="exportToExcel()" style="background:rgba(76,175,80,0.8);border:none;color:white;font-size:12px;cursor:pointer;padding:4px 12px;border-radius:4px;">📥 匯出Excel</button><button onclick="exportToPDF()" style="background:rgba(244,143,0,0.85);border:none;color:white;font-size:12px;cursor:pointer;padding:4px 12px;border-radius:4px;">📄 匯出PDF</button></div></div>
<div style="background:#f5f5f5;border-bottom:1px solid #e0e0e0;padding:4px 12px;display:flex;align-items:center;gap:6px;font-size:12px;color:#555;">
    <span>🔍</span>
    <button onclick="adjustZoom(-1)" style="padding:1px 9px;border:1px solid #bbb;border-radius:3px;cursor:pointer;font-size:15px;font-weight:bold;background:white;line-height:1.4;">−</button>
    <span id="zoomLabel" style="min-width:60px;text-align:center;font-size:11px;color:#666;">0.5 px/日</span>
    <button onclick="adjustZoom(1)" style="padding:1px 9px;border:1px solid #bbb;border-radius:3px;cursor:pointer;font-size:15px;font-weight:bold;background:white;line-height:1.4;">＋</button>
    <span style="color:#aaa;font-size:11px;margin-left:4px;">← 可水平捲動</span>
</div>
<div id="chartScrollOuter" class="chart-area" style="overflow-x:auto;overflow-y:auto;padding:10px;">
    <div id="chartScrollInner" style="min-width:100%;">
    <div class="container" id="chart"></div>
    <div class="container" id="budgetChart" style="margin-top:8px;"></div>
    </div>
</div>
<div class="edit-backdrop" id="editBackdrop" onclick="closePanel()"></div>
<div class="edit-panel" id="editPanel">
<div class="panel-header">
<span class="panel-title" id="panelTitle">編輯項目</span>
<span class="close-btn" onclick="closePanel()">✕</span>
</div>
<div id="panelBody"></div>
</div>
<button class="add-btn" onclick="showAddForm()" title="新增甘特圖項目" style="display:none;">＋</button>
<script>
const items = ${itemsJson};
const segments = ${segmentsJson};
const pipeline = ${pipelineJson};
let milestones = [];
let unitPrices = ${unitPricesJson};
const API_URL = '${apiUrl}';
const USER_TOKEN = '${tokenEscaped}';

// 🔐 Blob 視窗用的 fetch 攔截器（與主視窗相同邏輯）
(function() {
    var _of = window.fetch;
    var WP = ['save','update','delete','add','clear','upload'];
    window.fetch = function(url, opts) {
if (typeof url === 'string' && url.includes(API_URL) && USER_TOKEN) {
    var am = url.match(/[?&]action=(\\w+)/);
    if (am) {
        var lower = am[1].toLowerCase();
        var isW = WP.some(function(p) { return lower.indexOf(p) === 0; });
        if (isW) {
            var sep = url.includes('?') ? '&' : '?';
            url = url + sep + 'userToken=' + encodeURIComponent(USER_TOKEN);
        }
    }
}
return _of.call(window, url, opts);
    };
})();

// HTML 跳脫（防 XSS）
function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

let editingItem = null;
let pxPerDay = 0.5;  // 縮放：每天幾像素
const ZOOM_LEVELS = [0.2, 0.3, 0.5, 0.7, 1.0];
const ZOOM_LABELS = ['0.2', '0.3', '0.5', '0.7', '1.0'];
let zoomIdx = 2;  // 預設 0.5px/日

function adjustZoom(delta) {
    zoomIdx = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoomIdx + delta));
    pxPerDay = ZOOM_LEVELS[zoomIdx];
    var lbl = document.getElementById('zoomLabel');
    if (lbl) lbl.textContent = ZOOM_LABELS[zoomIdx] + ' px/日';
    renderChart();
    renderBudgetChart();
}

function setZoom(px) {
    zoomIdx = ZOOM_LEVELS.indexOf(px);
    if (zoomIdx < 0) zoomIdx = 2;
    pxPerDay = px;
    renderChart();
}

function exportToExcel() {
    // 動態載入 SheetJS（避免 HTML parser 誤解 <script> 標籤）
    if (typeof XLSX === 'undefined') {
showToast('正在載入匯出模組...', 'info');
var s = document.createElement('script');
s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
s.onload = function() { exportToExcel(); };
s.onerror = function() { showToast('載入失敗，請檢查網路', 'error'); };
document.head.appendChild(s);
return;
    }
    var wb = XLSX.utils.book_new();

    // ===== 工作表1：甘特圖項目 =====
    var ganttData = [['項目名稱', '開始日期', '完成日期', '施工天數', '完成(m)', '總長(m)', '完成率(%)', '單價(元/m)', '總金額(元)', '完成金額(元)', '備註']];
    items.forEach(function(item) {
var prog = getItemProgress(item);
var up = getEffectiveUnitPrice(item);
var days = Math.round((new Date(item.endDate) - new Date(item.startDate)) / 86400000);
var totalLen = prog ? prog.total : 0;
var doneLen = prog ? prog.done : 0;
var rate = prog ? Math.round(prog.rate * 100) : 0;
ganttData.push([
    item.label,
    item.startDate,
    item.endDate,
    days,
    doneLen,
    totalLen,
    rate,
    up || '',
    up && totalLen ? totalLen * up : '',
    up && doneLen ? doneLen * up : '',
    item.notes || ''
]);
    });
    var ws1 = XLSX.utils.aoa_to_sheet(ganttData);
    // 欄寬
    ws1['!cols'] = [
{wch:35},{wch:12},{wch:12},{wch:10},{wch:10},{wch:10},{wch:10},{wch:14},{wch:16},{wch:16},{wch:20}
    ];
    XLSX.utils.book_append_sheet(wb, ws1, '甘特圖項目');

    // ===== 工作表2：逐月預算S曲線 =====
    function computeRows() {
var monthMap = {};
items.forEach(function(item) {
    var prog = getItemProgress(item);
    var totalLen = prog ? prog.total : 0;
    var up = getEffectiveUnitPrice(item);
    if (!totalLen || !up) return;
    var totalYen = totalLen * up;
    var start = new Date(item.startDate);
    var end = new Date(item.endDate);
    var totalDays = Math.max(1, Math.round((end - start) / 86400000));
    var cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
        var mStart = new Date(Math.max(cur.getTime(), start.getTime()));
        var nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        var mEnd = new Date(Math.min(nextMonth.getTime() - 1, end.getTime()));
        var mDays = Math.max(0, Math.round((mEnd - mStart) / 86400000) + 1);
        var key = cur.getFullYear() + '-' + String(cur.getMonth()+1).padStart(2,'0');
        monthMap[key] = (monthMap[key] || 0) + totalYen * (mDays / totalDays);
        cur = nextMonth;
    }
});
var sorted = Object.keys(monthMap).sort();
var cumulative = 0;
return sorted.map(function(m) {
    cumulative += monthMap[m];
    return { month: m, monthly: monthMap[m], cumulative: cumulative };
});
    }
    var budgetRows = computeRows();
    var maxCum = budgetRows.length ? budgetRows[budgetRows.length-1].cumulative : 0;
    var actualDone = 0;
    items.forEach(function(item) {
var prog = getItemProgress(item);
var up = getEffectiveUnitPrice(item);
if (prog && up) actualDone += prog.done * up;
    });

    var budgetData = [['月份', '當月計畫金額(元)', '累積計畫金額(元)', '累積比例(%)']];
    budgetRows.forEach(function(r) {
budgetData.push([
    r.month,
    Math.round(r.monthly),
    Math.round(r.cumulative),
    maxCum > 0 ? Math.round(r.cumulative / maxCum * 100) : 0
]);
    });
    // 加總列
    budgetData.push(['']);
    budgetData.push(['工程名稱', pipeline.name || '']);
    budgetData.push(['總計畫預算(元)', Math.round(maxCum)]);
    budgetData.push(['實際已完成(元)', Math.round(actualDone)]);
    budgetData.push(['完成率(%)', maxCum > 0 ? Math.round(actualDone / maxCum * 100) : 0]);

    var ws2 = XLSX.utils.aoa_to_sheet(budgetData);
    ws2['!cols'] = [{wch:12},{wch:20},{wch:20},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws2, 'S曲線逐月預算');

    // ===== 工作表3：施工單價表 =====
    var priceData = [['施工方式(methodKey)', '單價(元/m)', '備註']];
    unitPrices.forEach(function(p) {
priceData.push([p.methodKey, p.unitPrice, p.remark || '']);
    });
    var ws3 = XLSX.utils.aoa_to_sheet(priceData);
    ws3['!cols'] = [{wch:25},{wch:14},{wch:20}];
    XLSX.utils.book_append_sheet(wb, ws3, '施工單價');

    // 輸出
    var filename = (pipeline.name || '甘特圖') + '_' + new Date().toISOString().slice(0,10) + '.xlsx';
    XLSX.writeFile(wb, filename);
    showToast('已匯出：' + filename, 'success');
}


function exportToPDF() {
    var style = document.createElement('style');
    style.id = '_printStyle';
    style.textContent = '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .header { background: #00695C !important; -webkit-print-color-adjust: exact; } .gantt-bar { -webkit-print-color-adjust: exact; } @page { size: A3 landscape; margin: 10mm; } .edit-panel, .edit-backdrop, #editPanel, #editBackdrop { display: none !important; } #chartScrollOuter { overflow: visible !important; height: auto !important; } #chartScrollInner { min-width: 100% !important; } .gantt-sidebar { display: none !important; } }';
    document.head.appendChild(style);
    showToast('列印視窗即將開啟，請選擇 [另存為PDF]', 'info');
    setTimeout(function() {
        window.print();
        setTimeout(function() {
            var s = document.getElementById('_printStyle');
            if (s) s.remove();
        }, 1500);
    }, 400);
}

function showToast(message, type = 'info', duration = null) {
    let container = document.getElementById('_toast_container');
    if (!container) {
container = document.createElement('div');
container.id = '_toast_container';
container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;';
document.body.appendChild(container);
    }
    const colors = { success:'#2e7d32', error:'#c62828', warning:'#e65100', info:'#1565c0' };
    const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
    const autoClose = duration || (type === 'error' ? 5000 : type === 'warning' ? 4000 : 3000);
    const toast = document.createElement('div');
    toast.style.cssText = \`display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:10px;font-size:13px;font-weight:500;color:white;background:\${colors[type]||colors.info};box-shadow:0 4px 16px rgba(0,0,0,0.25);pointer-events:auto;max-width:320px;\`;
    toast.innerHTML = \`<span>\${icons[type]||''}</span><span>\${message}</span>\`;
    container.appendChild(toast);
    const dismiss = () => { toast.style.opacity='0'; toast.style.transform='translateY(8px)'; toast.style.transition='all 0.3s'; setTimeout(()=>toast.remove(),300); };
    toast.addEventListener('click', dismiss);
    setTimeout(dismiss, autoClose);
}
function showConfirm({ title='確認', message='', okText='確定', cancelText='取消', danger=false, icon=null } = {}) {
    return new Promise(resolve => {
const backdrop = document.createElement('div');
backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:99990;display:flex;align-items:center;justify-content:center;';
const autoIcon = icon || (danger ? '🗑️' : 'ℹ️');
backdrop.innerHTML = \`<div style="background:white;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.25);padding:28px;max-width:360px;width:90%;">
    <div style="font-size:28px;text-align:center;margin-bottom:10px;">\${autoIcon}</div>
    <p style="font-size:16px;font-weight:700;text-align:center;margin:0 0 8px;">\${title}</p>
    \${message ? \`<p style="font-size:13px;color:#555;text-align:center;margin:0 0 22px;line-height:1.6;white-space:pre-line;">\${message}</p>\` : ''}
    <div style="display:flex;gap:10px;">
        <button id="_c_cancel" style="flex:1;padding:11px;border:1px solid #ddd;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:#f5f5f5;">\${cancelText}</button>
        <button id="_c_ok" style="flex:1;padding:11px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;color:white;background:\${danger?'#c62828':'#1976d2'};">\${okText}</button>
    </div></div>\`;
document.body.appendChild(backdrop);
const close = r => { backdrop.remove(); resolve(r); };
backdrop.querySelector('#_c_ok').onclick = () => close(true);
backdrop.querySelector('#_c_cancel').onclick = () => close(false);
backdrop.addEventListener('click', e => { if (e.target === backdrop) close(false); });
    });
}
// ============================================

// 確保 methodData 是物件而不是字串
function getItemProgress(item) {
    const label = item.label || '';
    const segMatch = label.match(/段落([A-Za-z0-9\-]+)/);
    const rangeMatch = label.match(/#(\\d+)～#(\\d+)/);
    if (!segMatch) return null;
    const seg = segments.find(s => String(s.segmentNumber) === segMatch[1]);
    if (!seg) return null;
    const arr = (seg.smallSegments || '').split(',').map(s => s.trim());
    const segLen = seg.endDistance - seg.startDistance;
    const numSmall = Math.ceil(segLen / 10);
    const from = rangeMatch ? parseInt(rangeMatch[1]) - 1 : 0;
    const to = rangeMatch ? parseInt(rangeMatch[2]) - 1 : numSmall - 1;
    let done = 0, total = 0;
    for (let i = from; i <= to; i++) {
const smallLen = Math.min(10, segLen - i * 10);
total += smallLen;
if (arr[i] && arr[i] !== '0' && arr[i].trim() !== '') done += smallLen;
    }
    return { done: Math.round(done), total: Math.round(total), rate: total > 0 ? done / total : 0 };
}

// 自訂項目（非管線）的完成率，從 status 欄位解析 "custom:75"
function getCustomProgress(item) {
    if (!item.status || !item.status.toString().startsWith('custom:')) return null;
    const rate = parseFloat(item.status.toString().split(':')[1]) / 100;
    return { rate: isNaN(rate) ? 0 : Math.min(1, Math.max(0, rate)), isCustom: true };
}

// 判斷是否為自訂項目
function isCustomItem(item) {
    return item.status && item.status.toString().startsWith('custom:');
}

function renderChart() {
    if (!items || items.length === 0) {
document.getElementById('chart').innerHTML = '<div style="text-align:center;padding:60px;color:#999;">📋 尚無甘特圖項目</div>';
return;
    }
    
    const today = new Date();
    const dates = items.flatMap(item => [new Date(item.startDate), new Date(item.endDate)]);
    let minDate = new Date(Math.min(...dates));
    let maxDate = new Date(Math.max(...dates));
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 7);
    
    // 依 pxPerDay 設定確切寬度（非 min-width），確保縮放真正有效果
    const totalDaysCalc = (maxDate - minDate) / 86400000;
    const totalPxWidth = Math.max(totalDaysCalc * pxPerDay, 800);
    const scrollInner = document.getElementById('chartScrollInner');
    if (scrollInner) {
        scrollInner.style.width = totalPxWidth + 'px';
        scrollInner.style.minWidth = '100%';
    }
    

    let html = '<div style="display:flex;margin-bottom:6px;"><div style="width:180px;position:sticky;left:0;background:white;z-index:2;flex-shrink:0;"></div><div style="flex:1;position:relative;height:28px;padding-right:80px;border-bottom:1px solid #ddd;">';
    
    // 第一步：繪製年份背景色塊和標籤
    const yearColors = {
2025: 'rgba(56, 142, 60, 0.1)',   // 綠色（過去）
2026: 'rgba(25, 118, 210, 0.1)',  // 藍色（當前）
2027: 'rgba(229, 57, 53, 0.1)',   // 紅色（未來）
2028: 'rgba(255, 152, 0, 0.1)'    // 橘色（更未來）
    };
    const yearTextColors = {
2025: '#388e3c',
2026: '#1976d2',
2027: '#e53935',
2028: '#ff9800'
    };
    
    let currentDate = new Date(minDate);
    let yearSegments = [];
    
    // 計算每個年份的起始和結束位置
    while (currentDate <= maxDate) {
const year = currentDate.getFullYear();
const yearStart = new Date(Math.max(currentDate.getTime(), minDate.getTime()));
const yearEnd = new Date(Math.min(new Date(year, 11, 31).getTime(), maxDate.getTime()));

const startPct = ((yearStart - minDate) / (maxDate - minDate)) * 100;
const endPct = ((yearEnd - minDate) / (maxDate - minDate)) * 100;
const widthPct = endPct - startPct;

if (widthPct > 0) {
    yearSegments.push({ year, startPct, widthPct });
}

currentDate = new Date(year + 1, 0, 1);
    }
    
    // 繪製年份背景和標籤
    yearSegments.forEach(seg => {
const bgColor = yearColors[seg.year] || 'rgba(158, 158, 158, 0.1)';
const textColor = yearTextColors[seg.year] || '#9e9e9e';
html += '<div style="position:absolute;left:' + seg.startPct + '%;width:' + seg.widthPct + '%;height:12px;background:' + bgColor + ';border-right:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:' + textColor + ';">' + seg.year + '</div>';
    });
    
    // 第二步：繪製月份刻度（動態密度）
    html += '<div style="position:absolute;top:12px;left:0;right:0;height:16px;">';
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const totalDaysRange = (maxDate - minDate) / 86400000;
    const totalMonths = (maxDate.getFullYear()-minDate.getFullYear())*12 + (maxDate.getMonth()-minDate.getMonth());
    const step = totalMonths < 7 ? 1 : totalMonths < 19 ? 2 : 3;
    const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    while (cur <= maxDate) {
if (cur >= minDate) {
    const pct = ((cur - minDate) / (maxDate - minDate)) * 100;
    html += '<div style="position:absolute;left:' + pct + '%;transform:translateX(-50%);font-size:9px;color:#555;white-space:nowrap;">' + MONTHS[cur.getMonth()] + '</div>';
}
cur.setMonth(cur.getMonth() + step);
    }
    html += '</div>';
    
    html += '</div></div>';
    
    const todayPct = ((today - minDate) / (maxDate - minDate)) * 100;
    
    items.forEach((item, idx) => {
const start = new Date(item.startDate);
const end = new Date(item.endDate);
const left = ((start - minDate) / (maxDate - minDate)) * 100;
const width = ((end - start) / (maxDate - minDate)) * 100;
const days = Math.round((end - start) / 86400000);

const prog = getItemProgress(item);
const customProg = getCustomProgress(item);
const progLabel = prog ? prog.done + 'm/' + prog.total + 'm' : (customProg ? Math.round(customProg.rate*100) + '%' : '');
const rate = prog ? prog.rate : (customProg ? customProg.rate : 0);

// 根據施工方式決定顏色；自訂項目用橘色
const label = item.label || '';
let baseColor = '#9e9e9e'; // 預設灰色
if (isCustomItem(item)) baseColor = '#f57c00'; // 橘色（自訂）
else if (label.includes('埋設')) baseColor = '#e53935'; // 紅色
else if (label.includes('推進')) baseColor = '#1976d2'; // 藍色
else if (label.includes('水管橋')) baseColor = '#388e3c'; // 綠色

// 根據完成度決定透明度
let opacity = 0.3;
if (rate > 0 && rate < 1) opacity = 0.6;
else if (rate >= 1) opacity = 1.0;

const barColor = baseColor;
const barStyle = 'background:' + barColor + ';opacity:' + opacity + ';';

html += '<div class="gantt-row" data-idx="' + idx + '" style="position:relative;">';
// gantt-label：直接 onmousedown 觸發排序拖拉（比 document 委派更可靠）
html += '<div class="gantt-label" style="width:180px;height:auto;display:flex;flex-direction:column;justify-content:center;cursor:grab;user-select:none;" onmousedown="rowDragStart(event,' + idx + ')" title="拖拉可調整順序，點擊可編輯">' +
    (item.notes ? '<span class="gantt-notes" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;color:#999;">' + esc(item.notes) + '</span>' : '') +
    '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(item.label) + '</span>' +
    '</div>';
html += '<div class="gantt-timeline-container"><div class="gantt-timeline">';

// Bar 分為兩部分：已完成（實心）+ 未完成（半透明）
const barWidth = Math.max(width, 0.5);
const doneWidth = barWidth * rate;
const undoneWidth = barWidth - doneWidth;
const barLabel = progLabel || (days + '天');
const hoverTitle = item.startDate + ' ～ ' + item.endDate + '（' + days + '天）' + (progLabel ? ' | ' + progLabel : '');

// 已完成部分（實心）
if (doneWidth > 0) {
    html += '<div class="gantt-bar" style="left:' + left + '%;width:' + doneWidth + '%;background:' + baseColor + ';opacity:1;" title="' + hoverTitle + '"></div>';
}

// 未完成部分（半透明）
if (undoneWidth > 0) {
    html += '<div class="gantt-bar" style="left:' + (left + doneWidth) + '%;width:' + undoneWidth + '%;background:' + baseColor + ';opacity:0.3;" title="' + hoverTitle + '"></div>';
}

// Drag overlay（整條 bar 可拖移）+ resize handle（右端可拉長縮短）
html += '<div class="gantt-drag-overlay" onmousedown="ganttBarMouseDown(event,' + idx + ',0)" style="position:absolute;left:' + left + '%;width:' + barWidth + '%;height:100%;z-index:10;cursor:grab;box-sizing:border-box;user-select:none;" title="拖拉移動">';
html += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:9px;color:white;font-weight:bold;text-shadow:0 1px 2px rgba(0,0,0,0.4);pointer-events:none;">' + barLabel + '</div>';
// Resize handle（右邊 8px，蓋在 overlay 上面）
html += '<div class="gantt-resize-handle" onmousedown="ganttBarMouseDown(event,' + idx + ',1)" style="position:absolute;right:0;top:0;width:10px;height:100%;cursor:ew-resize;z-index:12;" title="拖拉調整結束日期"></div>';
html += '</div>';
html += '<div class="gantt-today" style="left:' + todayPct + '%;"></div>';
html += '</div></div></div>';
    });
    
    document.getElementById('chart').innerHTML = html;
    initGanttDrag();
    setTimeout(drawDependencyArrows, 80);
}

// ══════════════════════════════════════════════════════════════
// 依賴箭頭繪製（blob 視窗用 - items 變數）
// ══════════════════════════════════════════════════════════════
function drawDependencyArrows() {
    var chart = document.getElementById('chart');
    if (!chart) return;
    var oldSvg = document.getElementById('_depSvg');
    if (oldSvg) oldSvg.remove();

    var deps = (items || []).filter(function(it) { return it.dependsOn; });
    if (deps.length === 0) return;

    var allDates = items.flatMap(function(d) { return [new Date(d.startDate), new Date(d.endDate)]; });
    var minDate = new Date(Math.min.apply(null, allDates));
    var maxDate = new Date(Math.max.apply(null, allDates));
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 7);
    var totalMs = maxDate - minDate;

    var rows = chart.querySelectorAll('.gantt-row');
    if (rows.length === 0) return;
    var rowH = rows[0].getBoundingClientRect().height || 32;
    var chartRect = chart.getBoundingClientRect();
    var chartW = chartRect.width;
    var labelW = 180; // gantt-label width

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = '_depSvg';
    svg.setAttribute('width', chartW);
    svg.setAttribute('height', chart.scrollHeight || chart.offsetHeight);
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:30;overflow:visible;';
    chart.style.position = 'relative';
    chart.appendChild(svg);

    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = '<marker id="_dArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="#444" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker>';
    svg.appendChild(defs);

    var trackW = chartW - labelW;

    deps.forEach(function(item) {
        var fromItem = items.find(function(i) { return i.id === item.dependsOn; });
        if (!fromItem) return;
        var fromIdx = items.indexOf(fromItem);
        var toIdx   = items.indexOf(item);
        if (fromIdx < 0 || toIdx < 0) return;

        function geom(it) {
            var s = new Date(it.startDate), e = new Date(it.endDate);
            var left = ((s - minDate) / totalMs) * 100;
            var width = Math.max(((e - s) / totalMs) * 100, 0.5);
            return { left: left, right: left + width };
        }

        var fg = geom(fromItem), tg = geom(item);
        var x1 = labelW + (fg.right / 100) * trackW;
        var x2 = labelW + (tg.left  / 100) * trackW;
        var y1 = fromIdx * rowH + rowH / 2;
        var y2 = toIdx   * rowH + rowH / 2;

        var midX = x1 + Math.min(Math.max((x2 - x1) * 0.4, 10), 24);
        var d = 'M' + x1.toFixed(1) + ',' + y1.toFixed(1)
              + 'L' + midX.toFixed(1) + ',' + y1.toFixed(1)
              + 'L' + midX.toFixed(1) + ',' + y2.toFixed(1)
              + 'L' + (x2 - 3).toFixed(1) + ',' + y2.toFixed(1);

        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#444');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-dasharray', '5 3');
        path.setAttribute('marker-end', 'url(#_dArr)');
        svg.appendChild(path);
    });
}

// ══════════════════════════════════════════════════════════════
// 依賴箭頭繪製（in-page panel 用 - ganttData 變數）
// ══════════════════════════════════════════════════════════════
function drawInPageDependencyArrows() {
    var chartEl = document.getElementById('ganttChartInner');
    if (!chartEl) return;
    var oldSvg = document.getElementById('_inPageDepSvg');
    if (oldSvg) oldSvg.remove();

    if (!ganttData || ganttData.length === 0) return;
    var deps = ganttData.filter(function(item) { return item.dependsOn; });
    if (deps.length === 0) return;

    var allDates = ganttData.flatMap(function(d) { return [new Date(d.startDate), new Date(d.endDate)]; });
    var minDate = new Date(Math.min.apply(null, allDates));
    var maxDate = new Date(Math.max.apply(null, allDates));
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 7);
    var totalMs = maxDate - minDate;

    var rows = chartEl.querySelectorAll('.gantt-row');
    if (rows.length === 0) return;
    var rowH = rows[0].getBoundingClientRect().height || 32;
    var chartW = chartEl.getBoundingClientRect().width;
    if (chartW === 0) return;
    var labelW = 240;
    var trackW = chartW - labelW;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = '_inPageDepSvg';
    svg.setAttribute('width', chartW);
    svg.setAttribute('height', chartEl.scrollHeight || chartEl.offsetHeight);
    svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:30;overflow:visible;';
    chartEl.appendChild(svg);

    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = '<marker id="_ipArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1L9 5L1 9" fill="none" stroke="#444" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker>';
    svg.appendChild(defs);

    deps.forEach(function(item) {
        var fromItem = ganttData.find(function(i) { return i.id === item.dependsOn; });
        if (!fromItem) return;
        var fromIdx = ganttData.indexOf(fromItem);
        var toIdx   = ganttData.indexOf(item);
        if (fromIdx < 0 || toIdx < 0) return;

        function geom(it) {
            var s = new Date(it.startDate), e = new Date(it.endDate);
            var left = ((s - minDate) / totalMs) * 100;
            var width = Math.max(((e - s) / totalMs) * 100, 0.5);
            return { left: left, right: left + width };
        }

        var fg = geom(fromItem), tg = geom(item);
        var x1 = labelW + (fg.right / 100) * trackW;
        var x2 = labelW + (tg.left  / 100) * trackW;
        var y1 = fromIdx * rowH + rowH / 2;
        var y2 = toIdx   * rowH + rowH / 2;

        var midX = x1 + Math.min(Math.max((x2 - x1) * 0.4, 10), 24);
        var d = 'M' + x1.toFixed(1) + ',' + y1.toFixed(1)
              + 'L' + midX.toFixed(1) + ',' + y1.toFixed(1)
              + 'L' + midX.toFixed(1) + ',' + y2.toFixed(1)
              + 'L' + (x2 - 3).toFixed(1) + ',' + y2.toFixed(1);

        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#444');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-dasharray', '5 3');
        path.setAttribute('marker-end', 'url(#_ipArr)');
        svg.appendChild(path);
    });
}

// ===== 甘特圖拖拉移動 / 調整長度 =====
var _ganttDrag = null;

// ── 排序拖拉狀態 ──
var _rowDrag = null;
var _insertLineEl = null;
var _dragListenersAdded = false;

// 由 label 的 onmousedown 直接呼叫（比 document 委派可靠）
function rowDragStart(e, idx) {
    var rowEl = e.target.closest('.gantt-row');
    var rowRect = rowEl ? rowEl.getBoundingClientRect() : null;
    var ghost = document.createElement('div');
    ghost.style.cssText = 'position:fixed;display:none;left:0;' +
        'width:200px;height:' + (rowRect ? rowRect.height : 30) + 'px;' +
        'background:rgba(0,105,76,.18);border:1.5px dashed #00695C;border-radius:4px;' +
        'pointer-events:none;z-index:9997;align-items:center;padding-left:8px;' +
        'font-size:11px;color:#00695C;font-weight:bold;overflow:hidden;white-space:nowrap;';
    ghost.textContent = items[idx] ? items[idx].label : '';
    document.body.appendChild(ghost);
    _rowDrag = { idx: idx, startY: e.clientY, targetIdx: idx, ghost: ghost, rowRect: rowRect, moved: false };
    e.preventDefault();
}

function initGanttDrag() {
    if (_dragListenersAdded) return;
    _dragListenersAdded = true;

    // 時間軸計算（動態取，不快取）
    function getRange() {
        var dates = items.flatMap(function(i) { return [new Date(i.startDate), new Date(i.endDate)]; });
        var mn = new Date(Math.min.apply(null, dates));
        var mx = new Date(Math.max.apply(null, dates));
        mn.setDate(mn.getDate() - 7); mx.setDate(mx.getDate() + 7);
        return mx - mn;
    }
    function innerW() {
        var el = document.getElementById('chartScrollInner');
        return el ? el.getBoundingClientRect().width || el.offsetWidth : 1;
    }
    function pxToDays(px) { return px / innerW() * getRange() / 86400000; }
    function shiftDate(s, days) {
        var d = new Date(s); d.setDate(d.getDate() + Math.round(days));
        return d.toISOString().slice(0, 10);
    }

    // Tooltip（日期拖拉）
    var tip = document.getElementById('ganttDragTip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'ganttDragTip';
        tip.style.cssText = 'display:none;position:fixed;background:rgba(0,0,0,.75);color:#fff;font-size:11px;padding:4px 10px;border-radius:5px;pointer-events:none;z-index:9999;white-space:nowrap;';
        document.body.appendChild(tip);
    }

    // 插入線（排序拖拉）
    _insertLineEl = document.getElementById('_ganttInsertLine');
    if (!_insertLineEl) {
        _insertLineEl = document.createElement('div');
        _insertLineEl.id = '_ganttInsertLine';
        _insertLineEl.style.cssText = 'display:none;position:fixed;left:0;right:0;height:2px;background:#00695C;z-index:9998;pointer-events:none;box-shadow:0 0 4px rgba(0,105,76,.6);';
        document.body.appendChild(_insertLineEl);
    }

    // ── mousemove ──
    document.addEventListener('mousemove', function(ev) {
        // 日期拖拉
        if (_ganttDrag) {
            var dx = ev.clientX - _ganttDrag.startX;
            var days = pxToDays(dx);
            if (_ganttDrag.type === 'move') {
                _ganttDrag.newStart = shiftDate(_ganttDrag.origStart, days);
                _ganttDrag.newEnd   = shiftDate(_ganttDrag.origEnd, days);
            } else {
                _ganttDrag.newEnd = shiftDate(_ganttDrag.origEnd, days);
                if (_ganttDrag.newEnd <= _ganttDrag.origStart) _ganttDrag.newEnd = shiftDate(_ganttDrag.origStart, 1);
                _ganttDrag.newStart = _ganttDrag.origStart;
            }
            tip.textContent = _ganttDrag.newStart + ' ～ ' + _ganttDrag.newEnd;
            tip.style.display = 'block';
            tip.style.left = (ev.clientX + 14) + 'px';
            tip.style.top  = (ev.clientY - 10) + 'px';
            _ganttDrag.moved = Math.abs(dx) > 4;
            return;
        }

        // 排序拖拉
        if (!_rowDrag) return;
        var dy = ev.clientY - _rowDrag.startY;
        if (Math.abs(dy) > 6) _rowDrag.moved = true;
        if (!_rowDrag.moved) return;

        var baseTop = _rowDrag.rowRect ? _rowDrag.rowRect.top : ev.clientY;
        _rowDrag.ghost.style.top = (baseTop + dy) + 'px';
        _rowDrag.ghost.style.display = 'flex';

        var rows = document.querySelectorAll('#chart .gantt-row');
        var newTarget = _rowDrag.idx;
        rows.forEach(function(row, i) {
            var r = row.getBoundingClientRect();
            if (ev.clientY >= r.top && ev.clientY < r.bottom) newTarget = i;
        });
        _rowDrag.targetIdx = newTarget;
        var targetRow = rows[newTarget];
        if (targetRow && _insertLineEl) {
            var tr = targetRow.getBoundingClientRect();
            _insertLineEl.style.top = (_rowDrag.idx < newTarget ? tr.bottom : tr.top) + 'px';
            _insertLineEl.style.display = 'block';
        }
    }, true);

    // ── mouseup ──
    document.addEventListener('mouseup', async function(ev) {
        // 日期拖拉結束
        if (_ganttDrag) {
            var state = _ganttDrag;
            _ganttDrag = null;
            tip.style.display = 'none';
            if (state.overlay) state.overlay.style.cursor = state.type === 'resize' ? 'ew-resize' : 'grab';
            if (!state.moved) { editItem(state.idx); return; }
            var item = items[state.idx];
            item.startDate = state.newStart; item.endDate = state.newEnd;
            renderChart(); renderBudgetChart();
            try {
                var p = new URLSearchParams({ action:'updateGanttItem', pipelineId:pipeline.id,
                    itemId:item.id, label:item.label||'', startDate:state.newStart, endDate:state.newEnd,
                    status:item.status||'', notes:item.notes||'', unitPrice:item.unitPrice||'' });
                var r = await fetch(API_URL + '?' + p).then(function(r){return r.json();});
                if (r.authError) { showAuthExpiredBanner(); item.startDate=state.origStart; item.endDate=state.origEnd; renderChart(); renderBudgetChart(); return; }
                if (r.success) { showToast('日期已更新','success'); if(window.opener) window.opener.postMessage({type:'ganttChanged'},'*'); }
                else { item.startDate=state.origStart; item.endDate=state.origEnd; renderChart(); renderBudgetChart(); showToast('更新失敗','error'); }
            } catch(err) { item.startDate=state.origStart; item.endDate=state.origEnd; renderChart(); renderBudgetChart(); showToast('更新失敗','error'); }
            return;
        }

        // 排序拖拉結束
        if (!_rowDrag) return;
        var drag = _rowDrag;
        _rowDrag = null;
        drag.ghost.remove();
        if (_insertLineEl) _insertLineEl.style.display = 'none';

        if (!drag.moved) { editItem(drag.idx); return; }

        var from = drag.idx, to = drag.targetIdx;
        if (from === to) return;

        var movedItem = items.splice(from, 1)[0];
        items.splice(to, 0, movedItem);
        items.forEach(function(it, i) { it.sortOrder = i + 1; });
        renderChart(); renderBudgetChart();

        var orders = items.map(function(it, i) { return { id: it.id, sortOrder: i + 1 }; });
        try {
            var res = await fetch(API_URL + '?action=updateGanttOrder&pipelineId=' +
                encodeURIComponent(pipeline.id) + '&userToken=' + encodeURIComponent(USER_TOKEN) +
                '&orders=' + encodeURIComponent(JSON.stringify(orders)));
            var result = await res.json();
            if (result.authError) { showAuthExpiredBanner(); return; }
            if (!result.success) showToast('排序儲存失敗','error');
            else if (window.opener) window.opener.postMessage({ type:'ganttChanged' },'*');
        } catch(err) { showToast('排序儲存失敗：'+err.message,'error'); }
    }, true);
}
function ganttBarMouseDown(e, idx, typeNum) {
    var type = typeNum === 1 ? 'resize' : 'move';
    e.preventDefault();
    e.stopPropagation();
    const item = items[idx];
    if (!item) return;
    const overlayEl = e.target.closest('.gantt-drag-overlay') || e.target;
    _ganttDrag = {
type, idx,
startX: e.clientX,
origStart: item.startDate,
origEnd: item.endDate,
newStart: item.startDate,
newEnd: item.endDate,
moved: false,
overlay: overlayEl
    };
    overlayEl.style.cursor = 'grabbing';
}

function editItem(idx) {
    const item = items[idx];
    editingItem = item;
    // 通知主頁面高亮對應管段
    if (window.opener) window.opener.postMessage({ type: 'ganttHighlight', label: item.label }, '*');
    const prog = getItemProgress(item);
    const segMatch = item.label.match(/段落([\w\-]+)/);
    const rangeMatch = item.label.match(/#(\d+)～#(\d+)/);
    let html = '';
    if (prog) {
const up = item.unitPrice || 0;
const totalYen = up ? prog.total * up : 0;
const doneYen = up ? prog.done * up : 0;
html += '<div class="info-box">📊 ' + prog.done + 'm/' + prog.total + 'm (' + Math.round(prog.rate*100) + '%)';
if (up) html += '<br>💰 完成：' + (doneYen/10000).toFixed(1) + '萬 / 總：' + (totalYen/10000).toFixed(1) + '萬元';
html += '</div>';
    }
    var isCustom = isCustomItem(item);
    var customRate = isCustom ? parseInt(item.status.toString().split(':')[1]) || 0 : 0;
    html += '<label>項目類型</label><div style="display:flex;gap:8px;margin-bottom:8px;">';
    html += '<label style="display:flex;align-items:center;gap:4px;font-weight:normal;cursor:pointer;"><input type="radio" name="itemType" value="pipeline"' + (!isCustom?' checked':'') + ' onchange="toggleItemType()"> 管線</label>';
    html += '<label style="display:flex;align-items:center;gap:4px;font-weight:normal;cursor:pointer;"><input type="radio" name="itemType" value="custom"' + (isCustom?' checked':'') + ' onchange="toggleItemType()"> 自訂（配電盤/工作井等）</label>';
    html += '</div>';
    html += '<div id="pipelineFields"' + (isCustom?' style="display:none;"':'') + '>';
    html += '<label>段落</label><select id="segSelect" onchange="handleSegChange()"><option value="">手動輸入</option>';
    segments.forEach(function(seg) {
var numSmall = Math.ceil((seg.endDistance - seg.startDistance) / 10);
var lbl = [seg.diameter, seg.pipeType, seg.method].filter(Boolean).join(' ') + ' - 段落' + seg.segmentNumber;
var sel = segMatch && segMatch[1] === String(seg.segmentNumber) ? ' selected' : '';
html += '<option value="' + seg.segmentNumber + '" data-num="' + numSmall + '" data-diameter="' + (seg.diameter||'') + '" data-pipetype="' + (seg.pipeType||'') + '" data-method="' + (seg.method||'') + '"' + sel + '>' + lbl + '</option>';
    });
    html += '</select>';
    html += '<div id="rangeBox" style="display:none;"><label>小段範圍</label><div style="display:flex;gap:4px;"><select id="smallFrom" style="flex:1;" onchange="updateLabel()"></select><select id="smallTo" style="flex:1;" onchange="updateLabel()"></select></div></div>';
    html += '</div>';
    html += '<div id="customFields"' + (!isCustom?' style="display:none;"':'') + '>';
    html += '<label>完成率（%）</label><div style="display:flex;align-items:center;gap:8px;"><input id="customRate" type="range" min="0" max="100" value="' + customRate + '" style="flex:1;" oninput="document.getElementById(&quot;customRateNum&quot;).value=this.value"><input id="customRateNum" type="number" min="0" max="100" value="' + customRate + '" style="width:56px;" oninput="document.getElementById(&quot;customRate&quot;).value=this.value"></div>';
    html += '</div>';
    html += '<label>項目名稱</label><input id="itemLabel" value="' + esc(item.label || '') + '">';
    html += '<label>開始日期</label><input id="startDate" type="date" value="' + (item.startDate || '') + '" onchange="var e=document.getElementById(&quot;endDate&quot;);if(e){e.min=this.value;}">';
    html += '<label>完成日期</label><input id="endDate" type="date" value="' + (item.endDate || '') + '" min="' + (item.startDate || '') + '">';
    html += '<label>備註</label><input id="notes" value="' + esc(item.notes || '') + '">';
    html += '<label>前置項目（完成後才開始）</label>';
    html += '<select id="dependsOn" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;font-size:13px;">';
    html += '<option value="">— 無前置項目 —</option>';
    items.forEach(function(it) {
        if (it.id === item.id) return;
        var sel = (item.dependsOn && item.dependsOn === it.id) ? ' selected' : '';
        html += '<option value="' + it.id + '"' + sel + '>' + esc(it.label) + '</option>';
    });
    html += '</select>';
    if (isCustom) {
html += '<label id="unitPriceLabel" style="display:flex;justify-content:space-between;">施工單價（元/式）<span id="upHint" style="color:#1976d2;font-size:10px;font-weight:normal;"></span></label>';
html += '<input id="unitPriceInput" type="number" placeholder="輸入金額" value="' + (item.unitPrice != null && item.unitPrice !== '' ? item.unitPrice : '') + '" style="margin-bottom:8px;">';
    } else {
var cachedPrice = getEffectiveUnitPrice(item);
html += '<label style="display:flex;justify-content:space-between;color:#666;">施工單價（元/m）<span style="font-size:10px;color:#388e3c;">由施工單價工作表統一管理</span></label>';
html += '<div style="background:#f5f5f5;border:1px solid #ddd;border-radius:4px;padding:8px 10px;font-size:13px;color:#555;margin-bottom:8px;">' + (cachedPrice ? cachedPrice.toLocaleString() + ' 元/m' : '（尚未設定，請至⚙️施工單價管理設定）') + '</div>';
    }
    html += '<button class="btn-primary" onclick="saveItem()">💾 儲存</button><button class="btn-danger" onclick="deleteItem()">🗑️ 刪除</button>';
    document.getElementById('panelTitle').textContent = '✏️ 編輯項目';
    document.getElementById('panelBody').innerHTML = html;
    document.getElementById('editPanel').classList.add('show');
    document.getElementById('editBackdrop').classList.add('show');
    if (segMatch) {
setTimeout(function() {
    handleSegChange();
    if (rangeMatch) {
        document.getElementById('smallFrom').value = rangeMatch[1];
        document.getElementById('smallTo').value = rangeMatch[2];
    }
}, 50);
    }
}

function showAddForm() {
    editingItem = null;
    let html = '<label>項目類型</label><div style="display:flex;gap:8px;margin-bottom:8px;">';
    html += '<label style="display:flex;align-items:center;gap:4px;font-weight:normal;cursor:pointer;"><input type="radio" name="itemType" value="pipeline" checked onchange="toggleItemType()"> 管線</label>';
    html += '<label style="display:flex;align-items:center;gap:4px;font-weight:normal;cursor:pointer;"><input type="radio" name="itemType" value="custom" onchange="toggleItemType()"> 自訂（配電盤/工作井等）</label>';
    html += '</div>';
    html += '<div id="pipelineFields">';
    html += '<label>段落</label><select id="segSelect" onchange="handleSegChange()"><option value="">手動輸入</option>';
    segments.forEach(function(seg) {
var numSmall = Math.ceil((seg.endDistance - seg.startDistance) / 10);
var lbl = [seg.diameter, seg.pipeType, seg.method].filter(Boolean).join(' ') + ' - 段落' + seg.segmentNumber;
var fullyCovered = isSegFullyCovered(seg.segmentNumber, numSmall, null);
var suffix = fullyCovered ? ' (已全部建立)' : '';
var disabledAttr = fullyCovered ? ' disabled' : '';
html += '<option value="' + seg.segmentNumber + '" data-num="' + numSmall + '" data-diameter="' + (seg.diameter||'') + '" data-pipetype="' + (seg.pipeType||'') + '" data-method="' + (seg.method||'') + '" data-fully="' + (fullyCovered?'1':'0') + '"' + disabledAttr + '>' + lbl + suffix + '</option>';
    });
    html += '</select>';
    var coveredSegs = [];
    segments.forEach(function(seg2){
var ns = Math.ceil((seg2.endDistance - seg2.startDistance)/10);
if(isSegFullyCovered(seg2.segmentNumber, ns, null)){
    coveredSegs.push([seg2.diameter,seg2.pipeType,seg2.method].filter(Boolean).join(' ')+'-段落'+seg2.segmentNumber);
}
    });
    if(coveredSegs.length>0){
html += '<div style="font-size:10px;color:#e53935;margin-top:3px;">⚠️ 已全部建立（不可選）：'+coveredSegs.join('、')+'</div>';
    }
    html += '<div id="rangeBox" style="display:none;"><label>小段範圍</label><div style="display:flex;gap:4px;"><select id="smallFrom" style="flex:1;" onchange="updateLabel()"></select><select id="smallTo" style="flex:1;" onchange="updateLabel()"></select></div></div>';
    html += '</div>'; // close pipelineFields
    html += '<div id="customFields" style="display:none;">';
    html += '<label>完成率（%）</label><div style="display:flex;align-items:center;gap:8px;"><input id="customRate" type="range" min="0" max="100" value="0" style="flex:1;" oninput="document.getElementById(&quot;customRateNum&quot;).value=this.value"><input id="customRateNum" type="number" min="0" max="100" value="0" style="width:56px;" oninput="document.getElementById(&quot;customRate&quot;).value=this.value"></div>';
    html += '</div>';
    html += '<label>項目名稱</label><input id="itemLabel">';
    html += '<label>開始日期</label><input id="startDate" type="date" onchange="var e=document.getElementById(&quot;endDate&quot;);if(e&&!e.value){e.min=this.value;e.value=this.value;}else if(e){e.min=this.value;}">';
    html += '<label>完成日期</label><input id="endDate" type="date">';
    html += '<label>備註</label><input id="notes">';
    html += '<label>前置項目（完成後才開始）</label>';
    html += '<select id="dependsOn" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;font-size:13px;">';
    html += '<option value="">— 無前置項目 —</option>';
    items.forEach(function(it) {
        html += '<option value="' + it.id + '">' + esc(it.label) + '</option>';
    });
    html += '</select>';
    html += '<div id="unitPriceArea"></div>';
    html += '<div id="unitPriceCustomArea" style="display:none;"><label>施工單價（元/式）</label><input id="unitPriceInput" type="number" placeholder="輸入金額" style="margin-bottom:8px;"></div>';
    html += '<button class="btn-primary" onclick="saveItem()">💾 新增</button>';
    document.getElementById('panelTitle').textContent = '＋ 新增項目';
    document.getElementById('panelBody').innerHTML = html;
    document.getElementById('editPanel').classList.add('show');
    document.getElementById('editBackdrop').classList.add('show');
}

function closePanel() { document.getElementById('editPanel').classList.remove('show'); document.getElementById('editBackdrop').classList.remove('show'); }

// 計算某段落的已使用小段列表（回傳 Set of used small segment numbers）
function getUsedSmallSegs(segNum, excludeItemId) {
    var used = new Set();

    items.forEach(function(item) {
if (excludeItemId && item.id === excludeItemId) return;
var m = (item.label || '').match(/段落([^ ]+) #([0-9]+)～#([0-9]+)/);
if (m && String(m[1]) === String(segNum)) {
    var f = parseInt(m[2]), t = parseInt(m[3]);
    for (var i = f; i <= t; i++) used.add(i);
}
    });
    return used;
}

function isSegFullyCovered(segNum, numSmall, excludeItemId) {
    var used = getUsedSmallSegs(segNum, excludeItemId);
    for (var i = 1; i <= numSmall; i++) { if (!used.has(i)) return false; }
    return true;
}

function handleSegChange() {
    const sel = document.getElementById('segSelect');
    const opt = sel.options[sel.selectedIndex];
    if (!opt.value) { document.getElementById('rangeBox').style.display = 'none'; return; }
    const segNum = opt.value;
    const numSmall = parseInt(opt.dataset.num || 1);
    const fromSel = document.getElementById('smallFrom');
    const toSel = document.getElementById('smallTo');

    // 找出此段落已使用的小段（用共用 helper）
    const excludeId = editingItem ? editingItem.id : null;
    const usedSet = getUsedSmallSegs(segNum, excludeId);
    function isUsed(n) { return usedSet.has(n); }
    const usedRanges = []; // 計算已用區間（用於提示）
    items.forEach(function(item) {
if (excludeId && item.id === excludeId) return;
const m = (item.label || '').match(/段落([^ ]+) #([0-9]+)～#([0-9]+)/);
if (m && String(m[1]) === String(segNum)) {
    usedRanges.push({ from: parseInt(m[2]), to: parseInt(m[3]) });
}
    });

    let opts = '';
    let firstFree = -1;
    for (let i = 1; i <= numSmall; i++) {
const used = isUsed(i);

const label = '#' + i + (used ? ' (已建立)' : '');
opts += '<option value="' + i + '"' + (used ? ' disabled' : '') + '>' + label + '</option>';
    }
    fromSel.innerHTML = opts;
    toSel.innerHTML = opts;

    // 預設選到第一個未使用的範圍
    if (firstFree > 0) {
fromSel.value = firstFree;
// 找出連續未使用的最後一段
let lastFree = firstFree;
for (let i = firstFree + 1; i <= numSmall; i++) {
    if (!isUsed(i)) lastFree = i; else break;
}
toSel.value = lastFree;
    } else {
toSel.value = numSmall;
    }

    // 已用清單提示
    var hintEl = document.getElementById('usedRangeHint');
    if (!hintEl) {
hintEl = document.createElement('div');
hintEl.id = 'usedRangeHint';
hintEl.style.cssText = 'font-size:10px;color:#e53935;margin-top:4px;';
document.getElementById('rangeBox').appendChild(hintEl);
    }
    if (usedRanges.length > 0) {
hintEl.textContent = '已建立：' + usedRanges.map(function(r){ return '#' + r.from + '～#' + r.to; }).join('、');
    } else {
hintEl.textContent = '';
    }

    document.getElementById('rangeBox').style.display = 'block';
    updateLabel();
}

function updateLabel() {
    const sel = document.getElementById('segSelect');
    const opt = sel ? sel.options[sel.selectedIndex] : null;
    if (!opt || !opt.value) return;
    const seg = segments.find(function(s) { return String(s.segmentNumber) === opt.value; });
    if (!seg) return;
    const from = document.getElementById('smallFrom').value;
    const to = document.getElementById('smallTo').value;
    const prefix = [seg.diameter, seg.pipeType, seg.method].filter(Boolean).join(' ');
    document.getElementById('itemLabel').value = prefix + ' - 段落' + seg.segmentNumber + ' #' + from + '～#' + to;
    // 自動帶入施工單價
    const priceEl = document.getElementById('unitPriceInput');
    const hintEl = document.getElementById('upHint');
    if (priceEl && !priceEl.value && prefix) {
const match = unitPrices.find(function(p) { return p.methodKey === prefix; });
if (match) {
    priceEl.value = match.unitPrice;
    if (hintEl) hintEl.textContent = '（自動帶入）';
}
    }
}

function toggleItemType() {
    var isCustom = document.querySelector('input[name="itemType"]:checked')?.value === 'custom';
    var pf = document.getElementById('pipelineFields');
    var cf = document.getElementById('customFields');
    if (pf) pf.style.display = isCustom ? 'none' : '';
    if (cf) cf.style.display = isCustom ? '' : 'none';
    // 價格欄顯示切換
    var ua = document.getElementById('unitPriceArea');
    var uca = document.getElementById('unitPriceCustomArea');
    if (ua) ua.style.display = isCustom ? 'none' : '';
    if (uca) uca.style.display = isCustom ? '' : 'none';
    if (!isCustom) showPipelinePriceHint();
}

function showPipelinePriceHint() {
    var ua = document.getElementById('unitPriceArea');
    if (!ua) return;
    // 找出目前選的工法
    var sel = document.getElementById('segSelect');
    var opt = sel ? sel.options[sel.selectedIndex] : null;
    var prefix = '';
    if (opt && opt.value) {
prefix = [opt.dataset.diameter, opt.dataset.pipetype, opt.dataset.method].filter(Boolean).join(' ');
    }
    var cachedPrice = prefix ? (unitPrices.find(function(p){ return p.methodKey === prefix; }) || null) : null;
    var priceText = cachedPrice ? cachedPrice.unitPrice.toLocaleString() + ' 元/m' : '（尚未設定，請至⚙️施工單價管理設定）';
    ua.innerHTML = '<label style="display:flex;justify-content:space-between;color:#666;">施工單價（元/m）<span style="font-size:10px;color:#388e3c;">由施工單價工作表統一管理</span></label><div style="background:#f5f5f5;border:1px solid #ddd;border-radius:4px;padding:8px 10px;font-size:13px;color:#555;margin-bottom:8px;">' + priceText + '</div>';
}

async function saveItem() {
    const label = document.getElementById('itemLabel').value;
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const notes = document.getElementById('notes').value;
    const unitPriceEl = document.getElementById('unitPriceInput');
    const unitPrice = unitPriceEl ? (unitPriceEl.value || '') : '';
    if (!label || !startDate || !endDate) { showToast('請填寫完整資訊', 'warning'); return; }
    const action = editingItem ? 'updateGanttItem' : 'addGanttItem';
    var itemTypeVal = document.querySelector('input[name="itemType"]:checked')?.value || 'pipeline';
    var statusVal = '';
    if (itemTypeVal === 'custom') {
var rateEl = document.getElementById('customRateNum');
statusVal = 'custom:' + (rateEl ? (rateEl.value || '0') : '0');
    }
    // 管線項目不儲存 per-item 單價（統一用施工單價工作表）；自訂項目才儲存
    var unitPriceToSave = (itemTypeVal === 'custom') ? unitPrice : '';
    var dependsOnEl = document.getElementById('dependsOn');
    var dependsOnVal = dependsOnEl ? (dependsOnEl.value || '') : '';
    const params = new URLSearchParams({ action, pipelineId: pipeline.id, label, startDate, endDate, status: statusVal, notes, unitPrice: unitPriceToSave, dependsOn: dependsOnVal });
    if (editingItem) params.append('itemId', editingItem.id);
    try {
const res = await fetch(API_URL + '?' + params.toString());
const result = await res.json();
if (result.authError) { showAuthExpiredBanner(); return; }
if (result.success) { 
    showToast('儲存成功', 'success');
    if (window.opener) window.opener.postMessage({ type: 'ganttChanged' }, '*');
    await reloadGanttData();
    hideEditForm();
}
else { showToast('失敗：' + (result.error || '未知錯誤'), 'error'); }
    } catch(e) { showToast('失敗：' + e.message, 'error'); }
}

async function deleteItem() {
    if (!editingItem || !await showConfirm({ title: '刪除項目', message: '確定要刪除這個項目嗎？', okText: '刪除', danger: true })) return;
    try {
const res = await fetch(API_URL + '?action=deleteGanttItem&itemId=' + editingItem.id);
const result = await res.json();
if (result.authError) { showAuthExpiredBanner(); return; }
if (result.success) { 
    showToast('刪除成功', 'success');
    if (window.opener) window.opener.postMessage({ type: 'ganttChanged' }, '*');
    await reloadGanttData();
    hideEditForm();
}
else { showToast('失敗：' + (result.error || '未知錯誤'), 'error'); }
    } catch(e) { showToast('失敗：' + e.message, 'error'); }
}

// 登入過期友善提示（帶重新開啟按鈕）
function closeAuthBanner() {
    var b = document.getElementById('_authBanner');
    if (b) b.remove();
    window.location.href = 'login.html';
}
function showAuthExpiredBanner() {
    var old = document.getElementById('_authBanner');
    if (old) return;
    var banner = document.createElement('div');
    banner.id = '_authBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#b71c1c;color:white;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
    banner.innerHTML = '<span>⚠️ <b>登入已過期</b>，請重新登入後繼續操作</span>' +
        '<div style="display:flex;gap:8px;">' +
        '<button onclick="window.close()" style="background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.4);border-radius:5px;padding:6px 14px;font-size:13px;cursor:pointer;">✕ 關閉視窗</button>' +
        '<button onclick="closeAuthBanner()" style="background:white;color:#b71c1c;border:none;border-radius:5px;padding:6px 16px;font-size:13px;font-weight:bold;cursor:pointer;">🔑 重新登入</button>' +
        '</div>';
    document.body.prepend(banner);
    if (window.opener) window.opener.postMessage({ type: 'ganttAuthExpired' }, '*');
}

// 重新載入甘特圖資料（不關視窗）
// 上下移動甘特圖排序
async function moveGanttItem(idx, direction) {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= items.length) return;

    // 交換記憶體中的位置
    const tmp = items[idx];
    items[idx] = items[newIdx];
    items[newIdx] = tmp;

    // 重新指派 sortOrder（1-based）
    items.forEach(function(item, i) { item.sortOrder = i + 1; });

    // 立即重繪（視覺即時反饋）
    renderChart();
    renderBudgetChart();

    // 非同步儲存到後端
    const orders = items.map(function(item, i) {
        return { id: item.id, sortOrder: i + 1 };
    });
    try {
        const res = await fetch(API_URL + '?action=updateGanttOrder&pipelineId=' +
            encodeURIComponent(pipeline.id) +
            '&userToken=' + encodeURIComponent(USER_TOKEN) +
            '&orders=' + encodeURIComponent(JSON.stringify(orders)));
        const result = await res.json();
        if (result.authError) { showAuthExpiredBanner(); return; }
        if (!result.success) showToast('排序儲存失敗：' + (result.error || ''), 'error');
    } catch(e) {
        showToast('排序儲存失敗：' + e.message, 'error');
    }
}

async function reloadGanttData() {
    try {
const [r1, r3] = await Promise.all([
    fetch(API_URL + '?action=getGanttItems&pipelineId=' + pipeline.id).then(r => r.json()),
    fetch(API_URL + '?action=getUnitPrices&pipelineId=' + encodeURIComponent(pipeline.id)).then(r => r.json())
]);
// 保留舊的 unitPrice（自訂項目的 unitPrice 可能不在 GAS getGanttItems 回傳裡）
var oldPriceMap = {};
items.forEach(function(i) { if (i.id && i.unitPrice != null && i.unitPrice !== '') oldPriceMap[i.id] = i.unitPrice; });
items.length = 0;
// 依 sortOrder 排序（GAS 已排好，但保留 fallback）
(r1.items || []).sort(function(a, b) {
    const oa = a.sortOrder != null ? a.sortOrder : 9999;
    const ob = b.sortOrder != null ? b.sortOrder : 9999;
    return oa !== ob ? oa - ob : new Date(a.startDate) - new Date(b.startDate);
}).forEach(function(i) {
    if ((i.unitPrice == null || i.unitPrice === '') && oldPriceMap[i.id] != null) {
        i.unitPrice = oldPriceMap[i.id];
    }
    items.push(i);
});
unitPrices = r3.prices || [];
renderChart();
renderBudgetChart();
    } catch(e) { showToast('重新載入失敗：' + e.message, 'error'); }
}

// 關閉/隱藏編輯表單
function hideEditForm() {
    const sidebar = document.querySelector('.gantt-sidebar');
    if (sidebar) sidebar.innerHTML = '<div style="padding:16px;color:#999;font-size:13px;">點擊甘特圖列來編輯</div>';
    editingItem = null;
}

// ===== S 曲線 =====
function getEffectiveUnitPrice(item) {
    // 自訂項目（custom:xxx）才用 item 自身的 unitPrice
    if (isCustomItem(item)) {
return (item.unitPrice && item.unitPrice > 0) ? +item.unitPrice : 0;
    }
    // 管線項目：統一從施工單價工作表讀取（by methodKey），忽略 item.unitPrice
    var label = item.label || '';
    var match = unitPrices.find(function(p) {
return label.indexOf(p.methodKey) >= 0;
    });
    return match ? +match.unitPrice : 0;
}

function computeMonthlyCumulative() {
    var monthMap = {};
    items.forEach(function(item) {
var prog = getItemProgress(item);
var up = getEffectiveUnitPrice(item);
var totalYen = 0;
if (isCustomItem(item) && up) {
    // 自訂項目：單價即為總金額（元/式）
    totalYen = up;
} else {
    var totalLen = prog ? prog.total : 0;
    if (!totalLen || !up) return;
    totalYen = totalLen * up;
}
if (!totalYen) return;
var start = new Date(item.startDate);
var end = new Date(item.endDate);
var totalDays = Math.max(1, Math.round((end - start) / 86400000));
var cur = new Date(start.getFullYear(), start.getMonth(), 1);
while (cur <= end) {
    var mStart = new Date(Math.max(cur.getTime(), start.getTime()));
    var nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    var mEnd = new Date(Math.min(nextMonth.getTime() - 1, end.getTime()));
    var mDays = Math.max(0, Math.round((mEnd - mStart) / 86400000) + 1);
    var mYen = totalYen * (mDays / totalDays);
    var key = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0');
    monthMap[key] = (monthMap[key] || 0) + mYen;
    cur = nextMonth;
}
    });
    var sorted = Object.keys(monthMap).sort();
    var cumulative = 0;
    return sorted.map(function(m) {
cumulative += monthMap[m];
return { month: m, monthly: monthMap[m], cumulative: cumulative };
    });
}

function fmtYen(v) {
    if (v >= 1e8) return (v/1e8).toFixed(2) + '億';
    if (v >= 1e4) return (v/1e4).toFixed(1) + '萬';
    return Math.round(v).toLocaleString();
}

function closeSCWin() { var el=document.getElementById('_sCurvePanel'); if(el) el.remove(); }
function closeUpMgrWin() { var el=document.getElementById('_upMgr'); if(el) el.remove(); }

function showSCurveWindow() {
    // 移除舊面板
    var old = document.getElementById('_sCurvePanel');
    if (old) old.remove();

    var rows = computeMonthlyCumulative();
    var todayStr = new Date().toISOString().slice(0, 7);

    var panel = document.createElement('div');
    panel.id = '_sCurvePanel';
    panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9900;display:flex;align-items:center;justify-content:center;';
    
    var maxCum = rows.length ? rows[rows.length-1].cumulative : 0;
    var todayCum = 0;
    rows.filter(function(r) { return r.month <= todayStr; }).forEach(function(r) { todayCum = r.cumulative; });
    var actualDone = 0;
    items.forEach(function(item) {
var prog = getItemProgress(item);
var up = getEffectiveUnitPrice(item);
if (prog && up) actualDone += prog.done * up;
    });

    var statsHtml = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">' +
'<div style="flex:1;min-width:120px;padding:10px;background:#f3e5f5;border-radius:8px;border-left:4px solid #7b1fa2;">' +
    '<div style="font-size:10px;color:#7b1fa2;">總計畫預算</div>' +
    '<div style="font-size:16px;font-weight:bold;color:#4a148c;">' + fmtYen(maxCum) + ' 元</div></div>' +
'<div style="flex:1;min-width:120px;padding:10px;background:#e3f2fd;border-radius:8px;border-left:4px solid #1976d2;">' +
    '<div style="font-size:10px;color:#1565c0;">計畫累積至今</div>' +
    '<div style="font-size:16px;font-weight:bold;color:#0d47a1;">' + fmtYen(todayCum) + ' 元</div>' +
    '<div style="font-size:10px;color:#555;">' + (maxCum>0?Math.round(todayCum/maxCum*100):0) + '%</div></div>' +
'<div style="flex:1;min-width:120px;padding:10px;background:#e8f5e9;border-radius:8px;border-left:4px solid #388e3c;">' +
    '<div style="font-size:10px;color:#2e7d32;">實際已完成</div>' +
    '<div style="font-size:16px;font-weight:bold;color:#1b5e20;">' + fmtYen(actualDone) + ' 元</div>' +
    '<div style="font-size:10px;color:#555;">' + (maxCum>0?Math.round(actualDone/maxCum*100):0) + '%</div></div>' +
'</div>';

    // SVG chart
    var svgHtml = '';
    if (rows.length >= 2) {
var W = 680, H = 220;
var PL = 64, PR = 16, PT = 16, PB = 36;
var cW = W - PL - PR, cH = H - PT - PB;
var yMax = maxCum * 1.08;
var n = rows.length;
var pts = rows.map(function(r, i) {
    return { x: PL + (n > 1 ? i * cW / (n-1) : cW/2), y: PT + cH - (r.cumulative / yMax) * cH, month: r.month, cum: r.cumulative, mon: r.monthly };
});
// today line
var todayIdx = -1;
rows.forEach(function(r, i) { if (r.month <= todayStr) todayIdx = i; });
var todayX = todayIdx >= 0 ? pts[todayIdx].x : -1;

// Y ticks
var yGrid = '', yLbl = '';
for (var ti = 0; ti <= 4; ti++) {
    var v = yMax * ti / 4;
    var ty = PT + cH - (v / yMax) * cH;
    yGrid += '<line x1="' + PL + '" y1="' + ty + '" x2="' + (W-PR) + '" y2="' + ty + '" stroke="#eee"/>';
    yLbl += '<text x="' + (PL-4) + '" y="' + (ty+4) + '" font-size="9" fill="#999" text-anchor="end">' + fmtYen(v) + '</text>';
}
// X labels
var xLbl = '';
var step = n > 18 ? 3 : n > 9 ? 2 : 1;
pts.forEach(function(p, i) {
    if (i % step === 0) xLbl += '<text x="' + p.x + '" y="' + (H-PB+14) + '" font-size="8" fill="#888" text-anchor="middle">' + p.month.slice(5) + '</text>';
});
// area path
var areaPath = 'M ' + pts[0].x + ',' + (PT+cH) + ' ' + pts.map(function(p){ return 'L '+p.x+','+p.y; }).join(' ') + ' L ' + pts[pts.length-1].x + ',' + (PT+cH) + ' Z';
var linePts = pts.map(function(p){ return p.x+','+p.y; }).join(' ');
// actual done line (single point at today)
var actualLine = '';
if (actualDone > 0 && todayX > 0) {
    var actY = PT + cH - (actualDone / yMax) * cH;
    actualLine = '<circle cx="' + todayX + '" cy="' + actY + '" r="6" fill="#388e3c" stroke="white" stroke-width="2"><title>實際完成：' + fmtYen(actualDone) + '元</title></circle>' +
        '<line x1="' + PL + '" y1="' + actY + '" x2="' + todayX + '" y2="' + actY + '" stroke="#388e3c" stroke-width="1.5" stroke-dasharray="4,3"/>' +
        '<text x="' + (todayX+8) + '" y="' + (actY+4) + '" font-size="9" fill="#2e7d32">實際</text>';
}
var todayLine = todayX > 0 ? '<line x1="' + todayX + '" y1="' + PT + '" x2="' + todayX + '" y2="' + (PT+cH) + '" stroke="#e53935" stroke-width="1.5" stroke-dasharray="4,3"/><text x="' + (todayX+2) + '" y="' + (PT+10) + '" font-size="8" fill="#e53935">今</text>' : '';
var circles = pts.map(function(p) {
    return '<circle cx="' + p.x + '" cy="' + p.y + '" r="3" fill="#7b1fa2" stroke="white" stroke-width="1"><title>' + p.month + '｜當月：' + fmtYen(p.mon) + '｜累積：' + fmtYen(p.cum) + '</title></circle>';
}).join('');

svgHtml = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;margin-bottom:10px;">' +
    '<defs><linearGradient id="scg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7b1fa2" stop-opacity="0.2"/><stop offset="100%" stop-color="#7b1fa2" stop-opacity="0.02"/></linearGradient></defs>' +
    yGrid + '<path d="' + areaPath + '" fill="url(#scg2)"/>' +
    '<polyline points="' + linePts + '" fill="none" stroke="#7b1fa2" stroke-width="2.5"/>' +
    actualLine + todayLine + circles + yLbl + xLbl +
    '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (PT+cH) + '" stroke="#ccc"/>' +
    '<line x1="' + PL + '" y1="' + (PT+cH) + '" x2="' + (W-PR) + '" y2="' + (PT+cH) + '" stroke="#ccc"/>' +
    '</svg>';
    } else if (rows.length === 0) {
svgHtml = '<div style="text-align:center;padding:30px;color:#aaa;">尚無含單價的甘特圖項目<br><small>請先設定施工單價</small></div>';
    }

    // Table
    var tableRows = rows.map(function(r) {
var isToday = r.month === todayStr;
return '<tr style="background:' + (isToday?'#fff9c4':'') + ';">' +
    '<td style="padding:4px 8px;border:1px solid #eee;' + (isToday?'font-weight:bold;color:#e65100;':'') + '">' + r.month + (isToday?' ◀':'') + '</td>' +
    '<td style="padding:4px 8px;border:1px solid #eee;text-align:right;">' + fmtYen(r.monthly) + ' 元</td>' +
    '<td style="padding:4px 8px;border:1px solid #eee;text-align:right;font-weight:bold;">' + fmtYen(r.cumulative) + ' 元</td>' +
    '<td style="padding:4px 8px;border:1px solid #eee;text-align:right;color:#7b1fa2;">' + (maxCum>0?Math.round(r.cumulative/maxCum*100):0) + '%</td>' +
    '</tr>';
    }).join('');

    panel.innerHTML = '<div style="background:white;border-radius:12px;width:90%;max-width:800px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,0.3);overflow:hidden;">' +
'<div style="background:linear-gradient(135deg,#4a148c,#7b1fa2);color:white;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
    '<span style="font-size:15px;font-weight:bold;">📈 S 曲線 — 累積預算金額</span>' +
    '<div style="display:flex;gap:8px;">' +
        '<button onclick="showUnitPriceMgr()" style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:12px;cursor:pointer;padding:4px 10px;border-radius:4px;">⚙️ 施工單價管理</button>' +
        '<button onclick="closeSCWin()" style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:16px;cursor:pointer;padding:2px 8px;border-radius:4px;">✕</button>' +
    '</div></div>' +
'<div style="overflow:auto;flex:1;padding:16px;">' +
    statsHtml + svgHtml +
    (rows.length > 0 ? '<div style="font-size:11px;font-weight:bold;color:#4a148c;margin-bottom:6px;">📋 逐月明細</div>' +
    '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
    '<thead><tr style="background:#f3e5f5;"><th style="padding:5px 8px;text-align:left;border:1px solid #e1bee7;">月份</th>' +
    '<th style="padding:5px 8px;text-align:right;border:1px solid #e1bee7;">當月預算</th>' +
    '<th style="padding:5px 8px;text-align:right;border:1px solid #e1bee7;">累積預算</th>' +
    '<th style="padding:5px 8px;text-align:right;border:1px solid #e1bee7;">累積比例</th></tr></thead>' +
    '<tbody>' + tableRows + '</tbody></table>' : '') +
'</div></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function(e) { if (e.target === panel) closeSCWin(); });
}

// ===== 施工單價管理（blob 視窗版）=====
function showUnitPriceMgr() {
    var old = document.getElementById('_upMgr');
    if (old) old.remove();

    var methodKeys = new Set();
    segments.forEach(function(seg) {
var k = [seg.diameter, seg.pipeType, seg.method].filter(Boolean).join(' ');
if (k) methodKeys.add(k);
    });

    var panel = document.createElement('div');
    panel.id = '_upMgr';
    panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9950;display:flex;align-items:center;justify-content:center;';

    function renderMgrContent() {
var tableRows = unitPrices.map(function(p, idx) {
    var safeId = p.methodKey.replace(/[^a-zA-Z0-9]/g, '_');
    return '<tr><td style="padding:5px 8px;border:1px solid #eee;">' + p.methodKey + '</td>' +
        '<td style="padding:5px 8px;border:1px solid #eee;text-align:right;">' +
            '<input type="number" id="up2_' + safeId + '" value="' + p.unitPrice + '" style="width:90px;padding:3px 5px;border:1px solid #ddd;border-radius:3px;font-size:12px;"></td>' +
        '<td style="padding:5px 8px;border:1px solid #eee;text-align:center;">' +
            '<button onclick="saveUp2(' + idx + ')" style="padding:3px 8px;background:#00695C;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">💾</button>' +
            ' <button onclick="delUp2(' + idx + ')" style="padding:3px 8px;background:#e53935;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">🗑️</button>' +
        '</td></tr>';
}).join('');

var newKeyOpts = '<option value="">-- 選擇工法 --</option>';
methodKeys.forEach(function(k) {
    if (!unitPrices.find(function(p){ return p.methodKey === k; }))
        newKeyOpts += '<option value="' + k + '">' + k + '</option>';
});

panel.querySelector('#_upMgrBody').innerHTML =
    '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px;">' +
    '<thead><tr style="background:#e8f5e9;"><th style="padding:6px 8px;text-align:left;border:1px solid #c8e6c9;">施工方式</th>' +
    '<th style="padding:6px 8px;text-align:right;border:1px solid #c8e6c9;">單價（元/m）</th>' +
    '<th style="padding:6px 8px;text-align:center;border:1px solid #c8e6c9;">操作</th></tr></thead>' +
    '<tbody>' + (tableRows || '<tr><td colspan="3" style="text-align:center;padding:16px;color:#aaa;">尚無資料</td></tr>') + '</tbody></table>' +
    '<div style="background:#f9f9f9;border-radius:6px;padding:12px;border:1px solid #eee;">' +
    '<div style="font-size:12px;font-weight:bold;margin-bottom:8px;">＋ 新增單價</div>' +
    '<select id="up2_newKey" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px;font-size:12px;box-sizing:border-box;">' + newKeyOpts + '</select>' +
    '<input id="up2_newKeyManual" placeholder="或手動輸入工法名稱" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px;font-size:12px;box-sizing:border-box;">' +
    '<input id="up2_newPrice" type="number" placeholder="單價（元/m）" style="width:100%;padding:6px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;font-size:12px;box-sizing:border-box;">' +
    '<button onclick="addUp2()" style="width:100%;padding:8px;background:#00695C;color:white;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-weight:bold;">＋ 新增</button>' +
    '</div>';
    }

    panel.innerHTML = '<div style="background:white;border-radius:10px;width:88%;max-width:580px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.3);overflow:hidden;">' +
'<div style="background:#00695C;color:white;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">' +
    '<div>' +
        '<div style="font-weight:bold;">⚙️ 施工單價管理</div>' +
        '<div style="font-size:11px;opacity:0.8;margin-top:2px;">📍 ' + (pipeline.name || pipeline.id) + '　（單價為本工程專屬）</div>' +
    '</div>' +
    '<button onclick="closeUpMgrWin()" style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:15px;cursor:pointer;padding:2px 8px;border-radius:4px;">✕</button>' +
'</div>' +
'<div id="_upMgrBody" style="overflow:auto;flex:1;padding:16px;"></div>' +
'</div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function(e) { if (e.target === panel) closeUpMgrWin(); });
    renderMgrContent();

    window.saveUp2 = async function(idx) {
var p = unitPrices[idx];
if (!p) return;
var safeId = p.methodKey.replace(/[^a-zA-Z0-9]/g, '_');
var el = document.getElementById('up2_' + safeId);
if (!el) return;
var unitPrice = parseFloat(el.value);
if (isNaN(unitPrice) || unitPrice < 0) { showToast('請輸入有效單價', 'warning'); return; }
try {
    var res = await fetch(API_URL + '?action=saveUnitPrice&methodKey=' + encodeURIComponent(p.methodKey) + '&pipelineId=' + encodeURIComponent(pipeline.id) + '&projectName=' + encodeURIComponent(pipeline.projectName || '') + '&unitPrice=' + unitPrice + '&unit=m');
    var result = await res.json();
    if (result.success) {
        showToast('已儲存 ' + p.methodKey, 'success');
        unitPrices[idx].unitPrice = unitPrice;
        renderMgrContent();
        renderChart();
        renderBudgetChart();
    } else showToast(result.error || '儲存失敗', 'error');
} catch(e) { showToast(e.message, 'error'); }
    };

    window.delUp2 = async function(idx) {
var p = unitPrices[idx];
if (!p) return;
if (!await showConfirm({ title: '刪除單價', message: '確定刪除[' + p.methodKey + ']的單價？', okText: '刪除', danger: true })) return;
try {
    var res = await fetch(API_URL + '?action=deleteUnitPrice&methodKey=' + encodeURIComponent(p.methodKey) + '&pipelineId=' + encodeURIComponent(pipeline.id) + '&projectName=');
    var result = await res.json();
    if (result.success) {
        showToast('已刪除', 'success');
        unitPrices = unitPrices.filter(function(_, i){ return i !== idx; });
        renderMgrContent();
        renderChart();
        renderBudgetChart();
    } else showToast(result.error || '刪除失敗', 'error');
} catch(e) { showToast(e.message, 'error'); }
    };

    window.addUp2 = async function() {
var selKey = document.getElementById('up2_newKey').value;
var manualKey = document.getElementById('up2_newKeyManual').value.trim();
var methodKey = manualKey || selKey;
var unitPrice = parseFloat(document.getElementById('up2_newPrice').value);
if (!methodKey) { showToast('請選擇或輸入施工方式', 'warning'); return; }
if (isNaN(unitPrice) || unitPrice <= 0) { showToast('請輸入有效單價', 'warning'); return; }
try {
    var res = await fetch(API_URL + '?action=saveUnitPrice&methodKey=' + encodeURIComponent(methodKey) + '&pipelineId=' + encodeURIComponent(pipeline.id) + '&projectName=' + encodeURIComponent(pipeline.projectName || '') + '&unitPrice=' + unitPrice + '&unit=m');
    var result = await res.json();
    if (result.success) {
        showToast('已新增 ' + methodKey, 'success');
        var existing = unitPrices.findIndex(function(p){ return p.methodKey === methodKey; });
        if (existing >= 0) unitPrices[existing].unitPrice = unitPrice;
        else unitPrices.push({ methodKey: methodKey, projectName: '', unitPrice: unitPrice, unit: 'm' });
        renderMgrContent();
        renderChart();
        renderBudgetChart();
    } else showToast(result.error || '新增失敗', 'error');
} catch(e) { showToast(e.message, 'error'); }
    };
}

// ===== 預算進度圖 =====
function renderBudgetChart() {
    var container = document.getElementById('budgetChart');
    if (!container) return;

    var budgetRows = computeMonthlyCumulative();
    if (!budgetRows.length) {
container.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;font-size:12px;">尚無含單價的甘特圖項目<br>請先設定施工單價</div>';
return;
    }

    // 取得與 renderChart 相同的時間範圍
    var dates = items.flatMap(function(item) { return [new Date(item.startDate), new Date(item.endDate)]; });
    var minDate = new Date(Math.min.apply(null, dates));
    var maxDate = new Date(Math.max.apply(null, dates));
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 7);
    var totalRange = maxDate.getTime() - minDate.getTime();

    var maxCum = budgetRows[budgetRows.length-1].cumulative;
    var yMax = maxCum * 1.1;
    var actualDone = 0;
    items.forEach(function(item) {
var prog = getItemProgress(item);
var up = getEffectiveUnitPrice(item);
if (prog && up) actualDone += prog.done * up;
    });

    function dateToPct(d) {
return Math.max(0, Math.min(100, (d.getTime() - minDate.getTime()) / totalRange * 100));
    }
    // 取整到百位（萬為單位時取整到小數1位）
    function fmtY(v) {
if (v === 0) return '0';
if (v >= 1e8) return (Math.round(v/1e6)/100).toFixed(2) + '億';
if (v >= 1e4) return (Math.round(v/1e3)/10).toFixed(1) + '萬';
return Math.round(v/100)*100 > 0 ? (Math.round(v/100)*100).toLocaleString() : Math.round(v).toLocaleString();
    }

    // Build SVG points (% of time range → x axis)
    var pts = budgetRows.map(function(r) {
var parts = r.month.split('-');
var midDate = new Date(parseInt(parts[0]), parseInt(parts[1])-1, 15);
return { pct: dateToPct(midDate), cum: r.cumulative, month: r.month };
    });

    var svgPts = pts.map(function(p) {
return (p.pct * 10).toFixed(1) + ',' + ((1 - p.cum/yMax)*100).toFixed(1);
    }).join(' ');
    var areaPath = 'M0,100 ' + pts.map(function(p) {
return 'L' + (p.pct*10).toFixed(1) + ',' + ((1-p.cum/yMax)*100).toFixed(1);
    }).join(' ') + ' L' + (pts[pts.length-1].pct*10).toFixed(1) + ',100 Z';

    var todayPct = dateToPct(new Date());
    var todayX = (todayPct * 10).toFixed(1);
    var actY = ((1 - actualDone/yMax)*100).toFixed(1);

    // Y labels — 放在獨立絕對定位層，讓 sticky 左欄只需固定寬度
    var yLabelItems = [0, 0.33, 0.67, 1].map(function(frac) {
return { frac: frac, label: fmtY(yMax * frac) };
    });

    // Hover zones
    var hoverDivs = '';
    pts.forEach(function(p, i) {
var nextPct = i < pts.length-1 ? pts[i+1].pct : 100;
var w = Math.max(nextPct - p.pct, 2).toFixed(2);
var mon = budgetRows[i].monthly || (budgetRows[i].cumulative - (i > 0 ? budgetRows[i-1].cumulative : 0));
var pct = maxCum > 0 ? (p.cum / maxCum * 100).toFixed(1) : '0';
hoverDivs += '<div class="budget-hover-zone" data-date="' + p.month + '" data-cum="' + fmtY(p.cum) + '" data-monthly="' + fmtY(mon) + '" data-pct="' + pct + '" style="position:absolute;left:' + p.pct.toFixed(2) + '%;width:' + w + '%;top:0;bottom:20px;cursor:crosshair;"></div>';
    });

    // X axis ticks — 年份色塊 + 月份刻度，與甘特圖完全相同邏輯
    var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var totalMonthsRange = (maxDate.getFullYear()-minDate.getFullYear())*12 + (maxDate.getMonth()-minDate.getMonth());
    var xStep = totalMonthsRange < 7 ? 1 : totalMonthsRange < 19 ? 2 : 3;

    // 年份色塊（與甘特圖 yearColors/yearTextColors 相同）
    var xYearColors = { 2024:'rgba(158,158,158,0.1)', 2025:'rgba(56,142,60,0.1)', 2026:'rgba(25,118,210,0.1)', 2027:'rgba(229,57,53,0.1)', 2028:'rgba(255,152,0,0.1)' };
    var xYearTextColors = { 2024:'#9e9e9e', 2025:'#388e3c', 2026:'#1976d2', 2027:'#e53935', 2028:'#ff9800' };
    var xAxisYearHtml = '';
    var xYearCur = new Date(minDate.getFullYear(), 0, 1);
    while (xYearCur <= maxDate) {
var yr = xYearCur.getFullYear();
var yrStart = new Date(Math.max(xYearCur.getTime(), minDate.getTime()));
var yrEnd = new Date(Math.min(new Date(yr, 11, 31).getTime(), maxDate.getTime()));
var yrStartPct = ((yrStart - minDate) / totalRange * 100).toFixed(2);
var yrWidthPct = ((yrEnd - yrStart) / totalRange * 100).toFixed(2);
var yrBg = xYearColors[yr] || 'rgba(158,158,158,0.1)';
var yrTxt = xYearTextColors[yr] || '#9e9e9e';
xAxisYearHtml += '<div style="position:absolute;left:' + yrStartPct + '%;width:' + yrWidthPct + '%;height:12px;background:' + yrBg + ';border-right:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:' + yrTxt + ';">' + yr + '</div>';
xYearCur = new Date(yr + 1, 0, 1);
    }
    // 月份刻度
    var xAxisMonHtml = '';
    var xCur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    while (xCur <= maxDate) {
if (xCur >= minDate) {
    var xPct = ((xCur - minDate) / totalRange * 100).toFixed(2);
    xAxisMonHtml += '<div style="position:absolute;left:' + xPct + '%;transform:translateX(-50%);font-size:9px;color:#555;white-space:nowrap;">' + MONTHS_SHORT[xCur.getMonth()] + '</div>';
}
xCur.setMonth(xCur.getMonth() + xStep);
    }
    // X 軸完整 HTML（年份12px + 月份16px = 28px，與甘特圖 header 同高）
    var xAxisHtml = '<div style="position:relative;height:12px;">' + xAxisYearHtml + '</div>'
          + '<div style="position:relative;height:16px;">' + xAxisMonHtml + '</div>';

    // 整體佈局
    // 關鍵：甘特圖 bar 是在 .gantt-timeline-container { flex:1 } 裡，
    // 無任何 padding，bar 的 left:% 相對於 flex:1 的完整寬度。
    // 預算圖 SVG 必須對齊同一個寬度，所以右欄也不能有 padding-right。
    // header 的 padding-right:80px 只是讓文字標籤不被截掉，不影響 bar 位置。
    var CHART_H = 120;

    var html = '<div style="display:flex;align-items:stretch;">';

    // ── 左欄：sticky，含標題 + Y軸文字（對應 gantt-label width:180px）──
    html += '<div style="width:180px;flex-shrink:0;position:sticky;left:0;background:white;z-index:2;box-sizing:border-box;padding:8px 8px 0 8px;display:flex;flex-direction:column;justify-content:flex-start;">';
    // 預估金額標題已移除
    html += '<div style="position:relative;flex:1;min-height:' + CHART_H + 'px;">';
    yLabelItems.forEach(function(item) {
html += '<div style="position:absolute;right:0;bottom:' + (item.frac*100).toFixed(0) + '%;transform:translateY(50%);font-size:8px;color:#999;white-space:nowrap;text-align:right;">' + item.label + '</div>';
    });
    html += '</div>';
    html += '</div>';

    // ── 右欄：對應 gantt-timeline-container { flex:1 }，無 padding ──
    html += '<div style="flex:1;position:relative;min-width:0;">';

    // SVG 圖表（width:100% height 固定，與 .gantt-timeline 同寬）
    html += '<div style="position:relative;height:' + CHART_H + 'px;">';
    html += '<svg viewBox="0 0 1000 100" preserveAspectRatio="none" width="100%" height="' + CHART_H + '" style="display:block;">';
    html += '<defs><linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7b1fa2" stop-opacity="0.2"/><stop offset="100%" stop-color="#7b1fa2" stop-opacity="0.02"/></linearGradient></defs>';
    [0.33, 0.67, 1].forEach(function(f) {
html += '<line x1="0" y1="' + ((1-f)*100).toFixed(1) + '" x2="1000" y2="' + ((1-f)*100).toFixed(1) + '" stroke="#eee" stroke-width="0.5"/>';
    });
    html += '<path d="' + areaPath + '" fill="url(#bg2)"/>';
    html += '<polyline points="' + svgPts + '" fill="none" stroke="#7b1fa2" stroke-width="2" vector-effect="non-scaling-stroke"/>';
    html += '<line x1="' + todayX + '" y1="0" x2="' + todayX + '" y2="100" stroke="#e53935" stroke-width="1.5" stroke-dasharray="4,3" vector-effect="non-scaling-stroke"/>';
    html += '</svg>';
    // 圓點用 HTML div，避免 preserveAspectRatio="none" 造成橢圓
    var dotHtml = '';
    pts.forEach(function(p) {
var left = p.pct.toFixed(2);
var bottom = (p.cum / yMax * 100).toFixed(2);
dotHtml += '<div style="position:absolute;left:' + left + '%;bottom:' + bottom + '%;width:6px;height:6px;border-radius:50%;background:#7b1fa2;border:1.5px solid white;transform:translate(-50%,50%);pointer-events:none;box-shadow:0 1px 2px rgba(0,0,0,0.2);"></div>';
    });
    if (actualDone > 0) {
var actLeft = (todayPct).toFixed(2);
var actBottom = (actualDone / yMax * 100).toFixed(2);
dotHtml += '<div style="position:absolute;left:' + actLeft + '%;bottom:' + actBottom + '%;width:9px;height:9px;border-radius:50%;background:#388e3c;border:2px solid white;transform:translate(-50%,50%);pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,0.3);" title="實際完成：' + fmtY(actualDone) + '元"></div>';
    }
    html += dotHtml;
    html += '<div style="position:absolute;bottom:0;left:0;right:0;height:1px;background:#ddd;"></div>';
    html += hoverDivs;
    html += '<div id="budgetTooltip" style="display:none;position:absolute;background:rgba(0,0,0,0.75);color:white;font-size:11px;padding:6px 10px;border-radius:6px;pointer-events:none;z-index:100;white-space:nowrap;"></div>';
    html += '</div>';

    // X 軸（年份 + 月份）— 在同一個無 padding 的右欄內，百分比與 SVG 完全一致
    html += '<div style="border-top:1px solid #ddd;">' + xAxisHtml + '</div>';

    html += '</div>'; // 右欄
    html += '</div>'; // 整體

    container.innerHTML = html;

    // Bind hover events
    var tip = document.getElementById('budgetTooltip');
    document.querySelectorAll('.budget-hover-zone').forEach(function(zone) {
zone.addEventListener('mouseenter', function() {
    tip.innerHTML = '<div style="font-weight:bold;margin-bottom:3px;">📅 ' + zone.dataset.date + '</div><div>當月：' + zone.dataset.monthly + ' 元</div><div>累積：<b>' + zone.dataset.cum + ' 元</b>　<span style="color:#a5d6a7;">(' + zone.dataset.pct + '%)</span></div>';
    tip.style.display = 'block';
});
zone.addEventListener('mouseleave', function() { tip.style.display = 'none'; });
zone.addEventListener('mousemove', function(e) {
    var rect = zone.parentElement.getBoundingClientRect();
    var left = e.clientX - rect.left + 12;
    if (left + 160 > rect.width) left = e.clientX - rect.left - 170;
    tip.style.left = left + 'px';
    tip.style.top = (e.clientY - rect.top - 40) + 'px';
});
    });
}

// 初始化
renderChart();
renderBudgetChart();

// 監聽主頁面傳來的單價更新通知
window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'unitPriceChanged' && event.data.unitPrices) {
unitPrices = event.data.unitPrices;
renderChart();
renderBudgetChart();
    }
});
</` + `script>

<!-- 統計報表面板 -->
<div class="stats-report-panel" id="statsReportPanel">
    <div class="stats-report-header">
<div>
    <h3 style="margin: 0; font-size: 18px;">📊 每月施工長度統計表</h3>
    <div style="color: #666; font-size: 12px; margin-top: 5px;">各工程每月完工長度</div>
</div>
<button onclick="closeStatsReport()" style="padding: 8px 16px; background: #f5f5f5; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">✕ 關閉</button>
    </div>
    <div class="stats-report-content" id="statsReportContent">
<div style="text-align: center; padding: 50px; color: #999;">載入中...</div>
    </div>
</div>

</body>
</html>`;
}
async function loadGanttData() {
    try {
        const [result, upResult] = await Promise.all([
            apiCall('getGanttItems', { pipelineId: currentPipeline.id }),
            apiCall('getUnitPrices', { pipelineId: currentPipeline.id, projectName: currentProject ? currentProject.name || '' : '' })
        ]);
        ganttData = window.ganttData = (result.items || []).sort((a, b) => {
            const oa = a.sortOrder != null ? a.sortOrder : 9999;
            const ob = b.sortOrder != null ? b.sortOrder : 9999;
            return oa !== ob ? oa - ob : new Date(a.startDate) - new Date(b.startDate);
        });
        unitPricesCache = upResult.prices || [];
        console.log('甘特圖資料:', ganttData);
        console.log('施工單價:', unitPricesCache);
        ganttData.forEach(item => {
            console.log(`項目: ${item.label}, 備註: ${item.notes || '(無)'}`, `單價: ${item.unitPrice||0}`);
        });
        renderGanttChart();
    } catch(e) { console.error('甘特圖載入失敗', e); }
}

function renderGanttChart() {
    const body = document.getElementById('ganttPanelBody');
    if (ganttData.length === 0) {
        body.innerHTML = '<div style="color:#aaa;text-align:center;padding:30px;">尚無資料，請新增項目</div>';
        return;
    }
    
    const today = new Date();
    // 計算時間範圍
    const allDates = ganttData.flatMap(d => [new Date(d.startDate), new Date(d.endDate)]);
    let minDate = new Date(Math.min(...allDates));
    let maxDate = new Date(Math.max(...allDates));
    // 範圍擴展一週
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 7);
    const totalDays = (maxDate - minDate) / 86400000;
    
    // X軸月份刻度 - 增加左側寬度以容納更長的項目名稱
    // 動態計算 tick 間隔：總天數 < 90 用週、< 365 用月、否則用季
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    let headerHtml = '<div class="gantt-header-row"><div style="width:240px;flex-shrink:0;"></div><div style="flex:1;position:relative;height:28px;">';
    
    // 先畫年份標示（跨年時顯示）
    let yearHtml = '';
    const startYear = minDate.getFullYear();
    const endYear = maxDate.getFullYear();
    if (startYear !== endYear) {
        for (let y = startYear; y <= endYear; y++) {
            const yDate = new Date(Math.max(new Date(y, 0, 1), minDate));
            const pct = ((yDate - minDate) / (maxDate - minDate)) * 100;
            yearHtml += `<span style="position:absolute;left:${pct}%;font-size:11px;font-weight:700;color:#1976d2;white-space:nowrap;">${y}</span>`;
        }
    }
    headerHtml += `<div style="position:relative;height:14px;">${yearHtml}</div>`;
    headerHtml += '<div style="position:relative;height:14px;">';
    
    // 月份 tick
    const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    // 間隔：< 6個月 = 每月, < 18個月 = 每2月, 否則每季
    const totalMonths = (maxDate.getFullYear()-minDate.getFullYear())*12 + (maxDate.getMonth()-minDate.getMonth());
    const step = totalMonths < 7 ? 1 : totalMonths < 19 ? 2 : 3;
    while (cur <= maxDate) {
        if (cur >= minDate) {
            const pct = ((cur - minDate) / (maxDate - minDate)) * 100;
            const label = MONTHS[cur.getMonth()];
            headerHtml += `<span style="position:absolute;left:${pct}%;transform:translateX(-50%);font-size:11px;white-space:nowrap;color:#555;">${label}</span>`;
        }
        cur.setMonth(cur.getMonth() + step);
    }
    headerHtml += '</div></div></div>';
    
    // 今日線位置
    const todayPct = Math.max(0, Math.min(100, ((today - minDate) / (maxDate - minDate)) * 100));
    
    // 各列
    const rowsHtml = ganttData.map((item, idx) => {
        const start = new Date(item.startDate);
        const end = new Date(item.endDate);
        const days = Math.round((end - start) / 86400000);
        const left = ((start - minDate) / (maxDate - minDate)) * 100;
        const width = ((end - start) / (maxDate - minDate)) * 100;
        const prog = getItemProgress(item);
        const rate = prog ? prog.rate : 0;
        const progLabel = prog ? `${prog.done}m/${prog.total}m` : '';
        // 顏色：未開始=灰、施工中=藍、完成=綠
        const baseColor = rate === 0 ? '#9e9e9e' : rate >= 1 ? '#388e3c' : '#1976d2';
        const doneColor = rate >= 1 ? '#2e7d32' : '#0d47a1';
        const dotColor = baseColor;
        
        return `<div class="gantt-row">
            <div class="gantt-label" style="width:240px;" title="${esc(item.label)}${item.notes ? ' - ' + esc(item.notes) : ''}">
                <span style="display:inline-block;width:8px;height:8px;background:${dotColor};border-radius:50%;margin-right:4px;"></span>
                ${item.notes ? `<strong>${esc(item.notes)}</strong> ` : ''}${esc(item.label)}
            </div>
            <div class="gantt-track gantt-clickable" data-idx="${idx}" style="cursor:pointer;position:relative;">
                <div style="position:absolute;left:${left}%;width:${Math.max(width,1)}%;height:100%;background:${baseColor};border-radius:3px;opacity:0.35;pointer-events:none;"></div>
                <div style="position:absolute;left:${left}%;width:${Math.max(width,1)*rate}%;height:100%;background:${doneColor};border-radius:3px;pointer-events:none;"
                     title="${item.startDate} ～ ${item.endDate}（${days}天）${prog?' | '+progLabel:''}"></div>
                <div style="position:absolute;left:${left + Math.max(width,1)}%;padding-left:6px;height:100%;display:flex;align-items:center;font-size:11px;color:#333;font-weight:600;pointer-events:none;white-space:nowrap;">
                    ${progLabel}
                </div>
                <div class="gantt-today-line" style="left:${todayPct}%;height:100%;"></div>
            </div>
        </div>`;
    }).join('');
    
    body.innerHTML = headerHtml + '<div class="gantt-chart" id="ganttChartInner" style="position:relative;">' + rowsHtml + '</div>';
    
    // 畫依賴箭頭（延遲確保 DOM 已渲染）
    setTimeout(drawInPageDependencyArrows, 80);
    
    // 使用事件委派處理點擊
    const chart = body.querySelector('.gantt-chart');
    if (chart) {
        chart.addEventListener('click', function(e) {
            const track = e.target.closest('.gantt-clickable');
            if (track) {
                const idx = parseInt(track.dataset.idx);
                console.log('Clicked bar with idx:', idx);
                showGanttPopup(idx);
            }
        });
    }
}

// ===== 甘特圖 bar → 地圖螢光高亮 =====
let _ganttHighlightedPolylines = []; // 目前螢光中的 { polyline, origColor, origWeight, origOpacity }

function clearGanttHighlight() {
    for (const h of _ganttHighlightedPolylines) {
        try {
            h.polyline.setStyle({ color: h.origColor, weight: h.origWeight, opacity: h.origOpacity });
        } catch(e) {}
    }
    _ganttHighlightedPolylines = [];
}

function highlightGanttSegment(item) {
    clearGanttHighlight();
    if (!item || !item.label) return;

    // 解析 label：「xxx - 段落{segNum} #{from}～#{to}」
    const sMatch = item.label.match(/段落([A-Za-z0-9\-]+)/);
    const rMatch = item.label.match(/#(\d+)～#(\d+)/);
    if (!sMatch) return;

    const segNum = String(sMatch[1]);
    const fromIdx = rMatch ? parseInt(rMatch[1]) - 1 : null; // 轉 0-based
    const toIdx   = rMatch ? parseInt(rMatch[2]) - 1 : null;

    // 掃描 smallSegmentPolylines 找出符合的 polylines
    const matched = [];
    for (const [key, entry] of Object.entries(smallSegmentPolylines)) {
        if (String(entry.segment.segmentNumber) !== segNum) continue;
        if (fromIdx !== null && (entry.smallIndex < fromIdx || entry.smallIndex > toIdx)) continue;
        matched.push(entry);
    }

    if (matched.length === 0) return;

    // 螢光樣式
    for (const entry of matched) {
        const style = entry.polyline.options;
        _ganttHighlightedPolylines.push({
            polyline: entry.polyline,
            origColor: style.color || entry.color || '#2196F3',
            origWeight: style.weight || 4,
            origOpacity: style.opacity !== undefined ? style.opacity : 1
        });
        entry.polyline.setStyle({ color: '#FFEB3B', weight: 10, opacity: 1 });
        entry.polyline.bringToFront();
    }

    // 移動地圖視角到第一個螢光段
    try {
        const first = matched[0].polyline.getLatLngs();
        if (first && first.length > 0) map.panTo(first[Math.floor(first.length / 2)], { animate: true });
    } catch(e) {}
}

window.clearGanttHighlight = clearGanttHighlight;

// 點地圖任何地方清除螢光（map 在 config.js 宣告，這裡延遲掛事件）
setTimeout(() => {
    if (typeof map !== 'undefined' && map) {
        map.on('click', function() {
            if (_ganttHighlightedPolylines.length > 0) clearGanttHighlight();
        });
    }
}, 2000);

window.showGanttPopup = function(idx) {
    console.log('showGanttPopup called with idx:', idx);
    const item = ganttData[idx];
    console.log('item:', item);
    if (!item) {
        console.error('Item not found for idx:', idx);
        return;
    }
    // 地圖螢光高亮對應管段
    highlightGanttSegment(item);
    const days = Math.round((new Date(item.endDate) - new Date(item.startDate)) / 86400000);
    document.getElementById('ganttSidebarTitle').textContent = '📋 ' + item.label;
    const body = document.getElementById('ganttSidebarBody');
    
    // 計算金額資訊
    const prog = getItemProgress(item);
    const totalLen = prog ? prog.total : 0;
    const unitPrice = item.unitPrice || 0;
    const totalBudget = totalLen && unitPrice ? totalLen * unitPrice : 0;
    const doneBudget = prog && unitPrice ? prog.done * unitPrice : 0;
    
    const budgetHtml = unitPrice > 0 ? `
        <div style="margin-top:6px;padding:6px 8px;background:#e8f5e9;border-radius:4px;border-left:3px solid #388e3c;">
            <div style="font-size:10px;color:#2e7d32;font-weight:bold;margin-bottom:2px;">💰 預算資訊</div>
            <div style="font-size:11px;color:#333;">單價：<b>${unitPrice.toLocaleString()} 元/m</b></div>
            ${totalBudget ? `<div style="font-size:11px;color:#333;">總金額：<b>${(totalBudget/10000).toFixed(1)} 萬元</b></div>` : ''}
            ${doneBudget && prog.done > 0 ? `<div style="font-size:11px;color:#1976d2;">已完成：<b>${(doneBudget/10000).toFixed(1)} 萬元</b></div>` : ''}
        </div>` : '<div style="font-size:10px;color:#aaa;margin-top:4px;">尚未設定施工單價</div>';
    
    body.innerHTML = `
        <div style="font-size:12px;margin-bottom:8px;">
            <div style="margin-bottom:4px;">📅 ${esc(item.startDate)}</div>
            <div style="margin-bottom:4px;">🏁 ${esc(item.endDate)}</div>
            <div style="margin-bottom:4px;">⏱️ ${days} 天</div>
            ${prog ? `<div style="margin-bottom:4px;">進度：<b>${prog.done}m/${prog.total}m（${Math.round(prog.rate*100)}%）</b></div>` : ''}
            ${item.notes ? '<div style="color:#666;margin-top:4px;">備註：'+esc(item.notes)+'</div>' : ''}
            ${budgetHtml}
        </div>
    `;
    const editBtn = document.createElement('button');
    editBtn.textContent = '✏️ 編輯';
    editBtn.style.cssText = 'width:100%;margin-top:4px;padding:7px;background:#1976d2;color:white;border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:bold;';
    editBtn.onclick = () => showEditGanttForm(item.id);
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑️ 刪除';
    delBtn.style.cssText = 'width:100%;margin-top:4px;padding:7px;background:#e53935;color:white;border:none;border-radius:5px;cursor:pointer;font-size:12px;';
    delBtn.onclick = () => deleteGanttItem(item.id);
    const sCurveBtn = document.createElement('button');
    sCurveBtn.textContent = '📈 S 曲線';
    sCurveBtn.style.cssText = 'width:100%;margin-top:4px;padding:7px;background:#6a1b9a;color:white;border:none;border-radius:5px;cursor:pointer;font-size:12px;';
    sCurveBtn.onclick = () => showSCurvePanel();
    body.appendChild(editBtn);
    body.appendChild(delBtn);
    body.appendChild(sCurveBtn);
};

window.showAddGanttForm = function() { showGanttForm({}, false); };
window.showEditGanttForm = function(id) {
    const item = ganttData.find(x => x.id === id);
    if (item) showGanttForm(item, true);
};

// 計算某段落的完工率
function getSegmentCompletionRate(seg) {
    const len = seg.endDistance - seg.startDistance;
    const num = Math.ceil(len / 10);
    const arr = (seg.smallSegments || '').split(',').map(s => s.trim());
    let done = 0;
    for (let i = 0; i < num; i++) { if (arr[i] === '1') done++; }
    return num > 0 ? done / num : 0;
}



function showGanttForm(item, isEdit) {
    const segments = currentPipeline.segments || [];
    const inputStyle = 'width:100%;padding:5px 7px;border:1px solid #ddd;border-radius:4px;margin-bottom:5px;box-sizing:border-box;font-size:12px;';
    
    const segOptions = segments.map(seg => {
        const method = seg.method || '';
        const diameter = seg.diameter || '';
        const pipeType = seg.pipeType || '';
        const numSmall = Math.ceil((seg.endDistance - seg.startDistance) / 10);
        const label = [diameter, pipeType, method].filter(Boolean).join(' ') + ' - 段落' + seg.segmentNumber + '（'+numSmall+'小段）';
        const rate = Math.round(getSegmentCompletionRate(seg) * 100);
        return `<option value="${seg.segmentNumber}" data-num="${numSmall}" data-method="${method}" data-diameter="${diameter}" data-pipetype="${pipeType}" data-rate="${rate}">${label}</option>`;
    }).join('');
    
    // 如果是編輯模式，從 label 解析出段落和小段範圍
    let selectedSeg = '', selectedFrom = '', selectedTo = '';
    if (isEdit && item.label) {
        const segMatch = item.label.match(/段落(\d+)/);
        const rangeMatch = item.label.match(/#(\d+)～#(\d+)/);
        if (segMatch) selectedSeg = segMatch[1];
        if (rangeMatch) {
            selectedFrom = rangeMatch[1];
            selectedTo = rangeMatch[2];
        }
    }
    
    document.getElementById('ganttSidebarTitle').textContent = isEdit ? '✏️ 編輯項目' : '＋ 新增項目';
    const body = document.getElementById('ganttSidebarBody');
    body.innerHTML = [
        `<div style="font-size:10px;color:#666;margin-bottom:2px;">選取段落</div>`,
        `<select id="gt_segSelect" onchange="onGanttSegSelect()" style="${inputStyle}"><option value="">-- 選取段落 --</option>${segOptions}</select>`,
        `<div style="display:flex;gap:4px;margin-bottom:5px;" id="gt_smallRange">
            <div style="flex:1;"><div style="font-size:10px;color:#666;margin-bottom:2px;">起始小段</div><select id="gt_smallFrom" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;font-size:12px;"></select></div>
            <div style="flex:1;"><div style="font-size:10px;color:#666;margin-bottom:2px;">迄止小段</div><select id="gt_smallTo" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;font-size:12px;"></select></div>
        </div>`,
        `<div style="font-size:10px;color:#666;margin-bottom:2px;">項目名稱</div>`,
        `<input id="gt_label" placeholder="施工項目名稱" value="${esc(item.label||'')}" style="${inputStyle}">`,
        `<div style="display:flex;gap:4px;margin-bottom:5px;">`,
        `<div style="flex:1;"><div style="font-size:10px;color:#666;margin-bottom:2px;">開始日期</div><input id="gt_startDate" type="date" value="${item.startDate||''}" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;font-size:12px;" oninput="const ed=document.getElementById('gt_endDate');if(!ed.value)ed.value=this.value;"></div>`,
        `<div style="flex:1;"><div style="font-size:10px;color:#666;margin-bottom:2px;">完成日期</div><input id="gt_endDate" type="date" value="${item.endDate||''}" style="width:100%;padding:5px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;font-size:12px;"></div>`,
        `</div>`,
        `<input id="gt_notes" placeholder="備註（選填）" value="${esc(item.notes||'')}" style="${inputStyle}">`,
        `<div id="gt_unitPriceDisplay" style="font-size:11px;color:#666;padding:6px 8px;background:#f5f5f5;border:1px solid #e0e0e0;border-radius:4px;margin-bottom:5px;">施工單價：計算中…</div>`,
        `<div style="font-size:10px;color:#666;margin-bottom:2px;margin-top:4px;">前置項目（完成後才開始）</div>`,
        `<select id="gt_dependsOn" style="${inputStyle}margin-bottom:8px;">
          <option value="">— 無前置項目 —</option>
          ${(ganttData || []).filter(i => i.id !== (item.id || null)).map(i =>
            `<option value="${i.id}" ${(item.dependsOn === i.id) ? 'selected' : ''}>${esc(i.label)}</option>`
          ).join('')}
        </select>`
    ].join('');
    
    // 如果是編輯模式，設定預選值
    if (isEdit && selectedSeg) {
        const segSel = document.getElementById('gt_segSelect');
        segSel.value = selectedSeg;
        onGanttSegSelect(); // 觸發以產生小段選單
        setTimeout(() => {
            if (selectedFrom) document.getElementById('gt_smallFrom').value = selectedFrom;
            if (selectedTo) document.getElementById('gt_smallTo').value = selectedTo;
        }, 50);
    }
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 ' + (isEdit ? '儲存' : '新增');
    saveBtn.style.cssText = 'width:100%;margin-top:4px;padding:7px;background:#00695C;color:white;border:none;border-radius:5px;cursor:pointer;font-weight:bold;font-size:12px;';
    saveBtn.onclick = isEdit ? () => saveGanttEdit(item.id) : () => saveGanttNew();
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'width:100%;margin-top:3px;padding:5px;background:#e0e0e0;color:#666;border:none;border-radius:5px;cursor:pointer;font-size:12px;';
    cancelBtn.onclick = () => {
        document.getElementById('ganttSidebarTitle').textContent = '＋ 新增項目';
        document.getElementById('ganttSidebarBody').innerHTML = '<div style="color:#aaa;font-size:12px;text-align:center;padding:20px;">點擊甘特條可編輯</div>';
    };
    body.appendChild(saveBtn);
    body.appendChild(cancelBtn);
}

window.onGanttSegSelect = function() {
    const sel = document.getElementById('gt_segSelect');
    const opt = sel.options[sel.selectedIndex];
    if (!opt.value) return;
    const diameter = opt.dataset.diameter || '';
    const pipeType = opt.dataset.pipetype || '';
    const method = opt.dataset.method || '';
    const segNum = opt.value;
    const numSmall = parseInt(opt.dataset.num || '1');
    
    // 建立小段選單
    const fromSel = document.getElementById('gt_smallFrom');
    const toSel = document.getElementById('gt_smallTo');
    if (fromSel && toSel) {
        const opts = Array.from({length: numSmall}, (_, i) => 
            `<option value="${i+1}">#${i+1}（${i*10}m～${Math.min((i+1)*10, numSmall*10)}m）</option>`
        ).join('');
        fromSel.innerHTML = opts;
        toSel.innerHTML = opts;
        toSel.value = numSmall; // 預設選到最後
        document.getElementById('gt_smallRange').style.display = 'flex';
        fromSel.onchange = toSel.onchange = updateGanttLabelFromRange;
    }
    updateGanttLabelFromRange();
};

function updateGanttLabelFromRange() {
    const sel = document.getElementById('gt_segSelect');
    const opt = sel ? sel.options[sel.selectedIndex] : null;
    if (!opt || !opt.value) return;
    const diameter = opt.dataset.diameter || '';
    const pipeType = opt.dataset.pipetype || '';
    const method = opt.dataset.method || '';
    const segNum = opt.value;
    const fromSel = document.getElementById('gt_smallFrom');
    const toSel = document.getElementById('gt_smallTo');
    const from = fromSel ? fromSel.value : '1';
    const to = toSel ? toSel.value : from;
    const prefix = [diameter, pipeType, method].filter(Boolean).join(' ');
    const label = `${prefix} - 段落${segNum} #${from}～#${to}`;
    const labelEl = document.getElementById('gt_label');
    if (labelEl) labelEl.value = label;
    
    // 顯示施工單價（從 unitPricesCache 查詢，唯讀）
    const displayEl = document.getElementById('gt_unitPriceDisplay');
    if (displayEl) {
        if (prefix) {
            const match = unitPricesCache.find(p => p.methodKey === prefix);
            if (match) {
                displayEl.innerHTML = `施工單價：<b style="color:#00695C;">${match.unitPrice.toLocaleString()} 元/m</b> <span style="font-size:10px;color:#888;">（由⚙️單價管理設定）</span>`;
                displayEl.style.color = '#333';
            } else {
                displayEl.innerHTML = `施工單價：<span style="color:#e57373;">尚未設定</span> <a href="#" onclick="showUnitPriceManager();return false;" style="font-size:10px;color:#1976d2;">→ 前往⚙️設定</a>`;
            }
        } else {
            displayEl.textContent = '施工單價：（選取段落後顯示）';
        }
    }
    
    // 計算選取範圍的完工率
    const seg = (currentPipeline.segments || []).find(s => String(s.segmentNumber) === String(segNum));
    if (seg) {
        const arr = (seg.smallSegments || '').split(',').map(s => s.trim());
        let done = 0;
        const f = parseInt(from) - 1, t = parseInt(to) - 1;
        for (let i = f; i <= t; i++) { if (arr[i] === '1') done++; }
        const rate = (t - f + 1) > 0 ? done / (t - f + 1) : 0;
        const status = rate === 0 ? '未開始' : rate >= 1 ? '完成' : '施工中';
        const stEl = document.getElementById('gt_status');
        if (stEl) stEl.value = status;
    }
};

function getGanttFormData() {
    // 從 label 反推 methodKey，查 unitPricesCache 取得單價
    const label = document.getElementById('gt_label') ? document.getElementById('gt_label').value.trim() : '';
    const dashIdx = label.lastIndexOf(' - 段落');
    const prefix = dashIdx > 0 ? label.substring(0, dashIdx) : '';
    const matched = prefix ? unitPricesCache.find(p => p.methodKey === prefix) : null;
    const depEl = document.getElementById('gt_dependsOn');
    return {
        label,
        startDate: document.getElementById('gt_startDate').value,
        endDate: document.getElementById('gt_endDate').value,
        status: '',
        notes: document.getElementById('gt_notes').value.trim(),
        unitPrice: matched ? String(matched.unitPrice) : '',
        dependsOn: depEl ? (depEl.value || '') : ''
    };
}

async function saveGanttNew() {
    const data = getGanttFormData();
    if (!data.label) { showToast('請輸入施工項目', 'warning'); return; }
    if (!data.startDate || !data.endDate) { showToast('請填入開始和完成日期', 'warning'); return; }
    try {
        const result = await apiCall('addGanttItem', {
            pipelineId: currentPipeline.id, label: data.label,
            startDate: data.startDate, endDate: data.endDate,
            status: data.status, notes: data.notes, unitPrice: data.unitPrice || '',
            dependsOn: data.dependsOn || ''
        });
        if (result.success) { 
            map.closePopup();
            showToast('已新增，正在更新甘特圖…', 'success');
            await loadGanttData();
            await loadGanttItemsForLabels();
            if (dateLabelsVisible) showDateLabels();
            // 自動重整 blob 視窗（若已開啟）
            if (window.ganttWindow && !window.ganttWindow.closed) {
                await toggleGanttPanel();
            }
            closeGanttInPagePanel();
        }
        else showToast((result.error || '儲存失敗'), 'error');
    } catch(e) { showToast(e.message, 'error'); }
}

async function saveGanttEdit(id) {
    const data = getGanttFormData();
    if (!data.label) { showToast('請輸入施工項目', 'warning'); return; }
    try {
        const result = await apiCall('updateGanttItem', {
            itemId: id, label: data.label,
            startDate: data.startDate, endDate: data.endDate,
            status: data.status, notes: data.notes, unitPrice: data.unitPrice || '',
            dependsOn: data.dependsOn || ''
        });
        if (result.success) { 
            map.closePopup();
            showToast('已更新，正在重整甘特圖…', 'success');
            await loadGanttData();
            await loadGanttItemsForLabels();
            if (dateLabelsVisible) showDateLabels();
            // 自動重整 blob 視窗（若已開啟）
            if (window.ganttWindow && !window.ganttWindow.closed) {
                await toggleGanttPanel();
            }
            closeGanttInPagePanel();
        }
        else showToast((result.error || '更新失敗'), 'error');
    } catch(e) { showToast(e.message, 'error'); }
}

window.deleteGanttItem = async function(id) {
    if (!await showConfirm({ title: '刪除', message: '確定要刪除嗎？', okText: '刪除', danger: true })) return;
    try {
        const result = await apiCall('deleteGanttItem', { itemId: id });
        if (result.success) { 
            map.closePopup(); 
            await loadGanttData();
            // 重新載入甘特圖快取並更新地圖標註
            await loadGanttItemsForLabels();
            if (dateLabelsVisible) {
                showDateLabels(); // 如果標註正在顯示，重新繪製
            }
        }
        else showToast((result.error || '刪除失敗'), 'error');
    } catch(e) { showToast(e.message, 'error'); }
};
// ========== 甘特圖功能結束 ==========

// ==================== 圈選建甘特：開啟 in-page panel 並預選段落 ====================
// 關閉 in-page 甘特圖 panel
window.closeGanttInPagePanel = function() {
    const panel = document.getElementById('ganttPanel');
    const backdrop = document.getElementById('ganttBackdrop');
    if (panel) panel.style.display = 'none';
    if (backdrop) backdrop.style.display = 'none';
    clearGanttHighlight(); // 關閉時清除地圖螢光
};

window.openGanttPanelForSegment = async function(segmentNumber, fromSmall, toSmall) {
    if (!currentPipeline) return;

    // 顯示 panel + backdrop
    const panel = document.getElementById('ganttPanel');
    const backdrop = document.getElementById('ganttBackdrop');
    if (!panel) return;
    panel.style.display = 'flex';
    if (backdrop) backdrop.style.display = 'block';

    // 設定 header 工程名稱
    const nameEl = document.getElementById('ganttPipelineName');
    if (nameEl) nameEl.textContent = currentPipeline.name || '';

    // 永遠重新載入當前工程的甘特資料（避免顯示舊工程殘留）
    document.getElementById('ganttPanelBody').innerHTML =
        '<div style="color:#aaa;text-align:center;padding:30px;">載入中…</div>';
    await loadGanttData();

    // 顯示新增表單並自動選好段落
    showGanttForm({}, false);

    // 等 DOM 更新完再設值
    setTimeout(() => {
        const segSel = document.getElementById('gt_segSelect');
        if (!segSel) return;
        segSel.value = String(segmentNumber);
        if (segSel.value === String(segmentNumber)) {
            onGanttSegSelect(); // 觸發小段選單
            // 再等小段選單產生後設定 from/to
            setTimeout(() => {
                if (fromSmall != null) {
                    const fromSel = document.getElementById('gt_smallFrom');
                    if (fromSel) { fromSel.value = String(fromSmall); }
                }
                if (toSmall != null) {
                    const toSel = document.getElementById('gt_smallTo');
                    if (toSel) { toSel.value = String(toSmall); }
                }
                // 觸發 label/單價 自動更新
                if (typeof updateGanttLabelFromRange === 'function') updateGanttLabelFromRange();
            }, 60);
        } else {
            showToast(`找不到段落 #${segmentNumber}，請手動選取`, 'warning');
        }
    }, 60);
};
