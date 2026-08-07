// ========== 完成狀況檢視（計畫總覽）==========
// 把計畫總覽地圖上「每個工程不同顏色」的管線，切換成
// 「已完成＝綠、未完成＝紅」的逐段著色，一眼看出整個計畫的施工進度。
//
// 資料來源：pipeline.branches（新架構小段）或 pipeline.segments（舊架構），
// 由 plan-overview.js 的 _loadProjectProgressBackground() 背景載入。
// 完成判定與統計欄一致：status 不是 '0' 且非空白即視為已完成。

let completionViewOn = false;
let completionPolylines = [];

const COMPLETION_COLOR_DONE = '#2E7D32';   // 已完成＝綠
const COMPLETION_COLOR_TODO = '#D32F2F';   // 未完成＝紅

function isSegDone(status) {
    return !!(status && String(status) !== '0' && String(status).trim() !== '');
}

// 切換完成狀況檢視
function toggleCompletionView() {
    completionViewOn = !completionViewOn;

    const btn = document.getElementById('permitZoneButton');
    if (btn) btn.classList.toggle('active', completionViewOn);

    if (completionViewOn) {
        renderCompletionView();
    } else {
        clearCompletionLayers();
        // 恢復原本的彩色管線
        allPolylines.forEach(p => { if (p.setStyle) p.setStyle({ opacity: 0.8 }); });
    }
}

// 只清除圖層（重畫時內部使用，不動開關狀態）
function clearCompletionLayers() {
    completionPolylines.forEach(p => { try { map.removeLayer(p); } catch (e) {} });
    completionPolylines = [];
    const legend = document.getElementById('completionLegend');
    if (legend) legend.remove();
}

// 完整關閉（離開總覽、切換工程時使用，會一併重置狀態與按鈕外觀）
function clearCompletionView() {
    clearCompletionLayers();
    completionViewOn = false;
    const b = document.getElementById('permitZoneButton');
    if (b) b.classList.remove('active');
}

function renderCompletionView() {
    clearCompletionLayers();
    if (!map) return;

    // 取得目前計畫的工程清單（總覽頁面）
    // 注意：allPipelines / currentProject 在 config.js 是用 let 宣告，
    // 這種變數不會成為 window 的屬性，所以要直接用裸變數存取，
    // 寫成 window.allPipelines 會永遠拿到 undefined。
    const all = (typeof allPipelines !== 'undefined' && allPipelines) ? allPipelines : [];
    const proj = (typeof currentProject !== 'undefined') ? currentProject : null;
    const pipelines = all.filter(p => proj && p.projectName === proj.name);

    if (pipelines.length === 0) {
        showToast('沒有可顯示的工程', 'info');
        completionViewOn = false;
        return;
    }

    // 進度還在背景載入時先提示，載完會自動重畫
    const notLoaded = pipelines.filter(p => !p._progressLoaded);
    if (notLoaded.length > 0) {
        showToast('進度載入中（' + notLoaded.length + ' 個工程），完成後會自動更新', 'info');
    }

    let doneLen = 0, totalLen = 0;

    pipelines.forEach(pipeline => {
        if (!pipeline.linestring) return;
        const isMULTI = pipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');

        // 取得每個分支的座標
        const branchCoordsList = isMULTI
            ? parseLineStringWithBranches(pipeline.linestring).branches.map(b => b.coords)
            : [parseLineString(pipeline.linestring)];

        // 新架構：branches 物件；舊架構：segments 陣列
        if (pipeline.branches && Object.keys(pipeline.branches).length > 0) {
            Object.entries(pipeline.branches).forEach(([key, segs]) => {
                // B0 → 第0個分支；子分支（B0-1）目前總覽不畫，避免重複
                const m = key.match(/^B(\d+)$/);
                if (!m) return;
                const coords = branchCoordsList[parseInt(m[1], 10)];
                if (!coords || coords.length < 2) return;

                segs.forEach(seg => {
                    const segCoords = getSegmentCoords(coords, seg.startDistance, seg.endDistance);
                    if (!segCoords || segCoords.length < 2) return;
                    const done = isSegDone(seg.status);
                    const len = seg.endDistance - seg.startDistance;
                    totalLen += len;
                    if (done) doneLen += len;
                    drawCompletionSeg(segCoords, done, pipeline, seg);
                });
            });
        } else if (pipeline.segments && pipeline.segments.length) {
            // 舊架構：smallSegments 是逗號分隔的狀態字串，每 10m 一段
            const coords = branchCoordsList[0];
            if (!coords || coords.length < 2) return;
            pipeline.segments.forEach(segment => {
                const statusArr = String(segment.smallSegments || '').split(',').map(s => s.trim());
                const segLen = segment.endDistance - segment.startDistance;
                const n = Math.ceil(segLen / 10);
                for (let i = 0; i < n; i++) {
                    const s = segment.startDistance + i * 10;
                    const e = Math.min(s + 10, segment.endDistance);
                    const segCoords = getSegmentCoords(coords, s, e);
                    if (!segCoords || segCoords.length < 2) continue;
                    const done = isSegDone(statusArr[i]);
                    totalLen += (e - s);
                    if (done) doneLen += (e - s);
                    drawCompletionSeg(segCoords, done, pipeline, { startDistance: s, endDistance: e });
                }
            });
        }
    });

    // 原本的彩色管線淡化，讓完成狀況成為主角（不移除，關閉時可直接恢復）
    allPolylines.forEach(p => { if (p.setStyle) p.setStyle({ opacity: 0.12 }); });

    renderCompletionLegend(doneLen, totalLen, pipelines.length);
}

function drawCompletionSeg(coords, done, pipeline, seg) {
    const pl = L.polyline(coords, {
        color: done ? COMPLETION_COLOR_DONE : COMPLETION_COLOR_TODO,
        weight: 6,
        opacity: 0.9,
    }).addTo(map);
    pl.bindTooltip(
        '<b>' + escapeHtml(pipeline.name) + '</b><br>' +
        (done ? '✅ 已完成' : '⬜ 未完成') +
        '<br>' + Math.round(seg.startDistance) + 'm ~ ' + Math.round(seg.endDistance) + 'm',
        { sticky: true }
    );
    pl.on('click', () => { if (typeof showPipelineDetail === 'function') showPipelineDetail(pipeline.id); });
    completionPolylines.push(pl);
}

function renderCompletionLegend(doneLen, totalLen, pipelineCount) {
    const pct = totalLen > 0 ? Math.round((doneLen / totalLen) * 100) : 0;
    const el = document.createElement('div');
    el.id = 'completionLegend';
    el.style.cssText = 'position:absolute;bottom:30px;left:10px;z-index:1000;background:white;' +
        'padding:10px 14px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.2);font-size:12px;line-height:1.8;';
    el.innerHTML =
        '<div style="font-weight:bold;margin-bottom:4px;">📊 完成狀況（' + pipelineCount + ' 個工程）</div>' +
        '<div><span style="display:inline-block;width:14px;height:4px;background:' + COMPLETION_COLOR_DONE + ';vertical-align:middle;"></span> 已完成　' +
        Math.round(doneLen) + ' m</div>' +
        '<div><span style="display:inline-block;width:14px;height:4px;background:' + COMPLETION_COLOR_TODO + ';vertical-align:middle;"></span> 未完成　' +
        Math.round(totalLen - doneLen) + ' m</div>' +
        '<div style="margin-top:4px;font-weight:bold;color:' + COMPLETION_COLOR_DONE + ';">總進度 ' + pct + '%</div>';
    document.body.appendChild(el);
}

// 背景進度載入完成後，如果正在檢視完成狀況就自動重畫
function refreshCompletionViewIfOn() {
    if (completionViewOn) renderCompletionView();
}

window.toggleCompletionView = toggleCompletionView;
window.refreshCompletionViewIfOn = refreshCompletionViewIfOn;
window.clearCompletionView = clearCompletionView;
window.clearCompletionLayers = clearCompletionLayers;
// ========== 完成狀況檢視結束 ==========
