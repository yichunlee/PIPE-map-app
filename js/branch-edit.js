// ============================================
// 📊 統計報表功能
// ============================================

// 顯示/隱藏統計報表
function toggleStatsReport() {
    const panel = document.getElementById('statsReportPanel');
    const overlay = document.getElementById('overlay');
    
    if (panel.style.display === 'flex') {
panel.style.display = 'none';
overlay.style.display = 'none';
    } else {
panel.style.display = 'flex';
overlay.style.display = 'block';
overlay.style.zIndex = '2999';
loadMonthlyReport();
    }
}

function closeStatsReport() {
    document.getElementById('statsReportPanel').style.display = 'none';
    document.getElementById('overlay').style.display = 'none';
}

// 載入每月統計報表
async function loadMonthlyReport() {
    try {
const content = document.getElementById('statsReportContent');
content.innerHTML = '<div style="text-align: center; padding: 50px; color: #999;">載入中...</div>';

// 🔧 只統計當前計畫
let projectName = '';
if (currentProject && currentProject.name) {
    projectName = currentProject.name;
}
console.log('📊 統計報表 - 計畫:', projectName);
console.log('📊 currentProject:', currentProject);
console.log('📊 API URL:', API_URL + '?action=generateMonthlyReport&projectName=' + encodeURIComponent(projectName));

const result = await apiCall('generateMonthlyReport');
console.log('📊 統計報表結果:', result);
console.log('📊 成功:', result.success);
console.log('📊 工程數:', result.pipelines ? result.pipelines.length : 0);
console.log('📊 月份數:', result.months ? result.months.length : 0);

if (!result.success) {
    content.innerHTML = '<div style="text-align: center; padding: 50px; color: #f44336;">❌ 載入失敗：' + escapeHtml(result.error) + '</div>';
    return;
}

if (!result.pipelines || result.pipelines.length === 0) {
    console.log('📊 沒有工程資料');
    console.log('📊 完整結果:', JSON.stringify(result, null, 2));
    console.log('📊 allPipelines:', allPipelines.map(p => ({id: p.id, name: p.name, project: p.project, projectName: p.projectName})));
    content.innerHTML = '<div style="text-align: center; padding: 50px; color: #999;">📊 尚無統計資料<br><br>查詢計畫：' + escapeHtml(projectName) + '<br>工程數：0<br><br>請檢查 Console 的 allPipelines</div>';
    return;
}

// 建立表格
let html = '<table class="stats-report-table">';
html += '<thead><tr>';
html += '<th style="text-align:left;padding-left:15px;">工程名稱</th>';

// 月份欄位（格式：2026/01）
console.log('📊 開始處理月份:', result.months);
result.months.forEach(month => {
    const [year, monthNum] = month.split('-');
    html += `<th>${year}/${monthNum}</th>`;
});

html += '<th>合計</th>';
html += '</tr></thead>';
html += '<tbody>';

// 資料列
result.pipelines.forEach(pipeline => {
    html += '<tr>';
    html += `<td style="text-align:left;padding-left:15px;">${pipeline.name}</td>`;
    
    let total = 0;
    console.log('📊 開始處理月份:', result.months);
result.months.forEach(month => {
        const length = pipeline.monthly[month] || 0;
        total += length;
        
        if (length > 0) {
            html += `<td style="background: #e8f5e9; font-weight: 600;">${length}m</td>`;
        } else {
            html += '<td style="color: #ccc;">-</td>';
        }
    });
    
    html += `<td style="background: #fff3e0; font-weight: bold;">${total}m</td>`;
    html += '</tr>';
});

// 月份總計列
html += '<tr style="background: #f5f5f5; font-weight: bold;">';
html += '<td style="text-align:left;padding-left:15px;">月份總計</td>';

console.log('📊 開始處理月份:', result.months);
result.months.forEach(month => {
    let monthTotal = 0;
    result.pipelines.forEach(pipeline => {
        monthTotal += pipeline.monthly[month] || 0;
    });
    html += `<td style="color: #667eea;">${monthTotal}m</td>`;
});

// 整體總計
let grandTotal = 0;
result.pipelines.forEach(pipeline => {
    console.log('📊 開始處理月份:', result.months);
result.months.forEach(month => {
        grandTotal += pipeline.monthly[month] || 0;
    });
});
html += `<td style="background: #667eea; color: white;">${grandTotal}m</td>`;
html += '</tr>';

html += '</tbody></table>';

content.innerHTML = html;

    } catch (error) {
console.error('載入統計報表錯誤:', error);
document.getElementById('statsReportContent').innerHTML = 
    '<div style="text-align: center; padding: 50px; color: #f44336;">❌ 載入失敗：' + error.message + '</div>';
    }
}

// 匯出每月統計報表為 Excel
async function exportMonthlyReportToExcel() {
    try {
// 取得統計資料
let projectName = '';
if (currentProject && currentProject.name) {
    projectName = currentProject.name;
}

const result = await apiCall('generateMonthlyReport');

if (!result.success || !result.pipelines || result.pipelines.length === 0) {
    showToast('無資料可匯出', 'error');
    return;
}

// 建立 CSV 內容（Excel 可以開啟 CSV）
let csv = '\uFEFF'; // UTF-8 BOM，讓 Excel 正確顯示中文

// 標題
csv += `每月施工長度統計表\n`;
csv += `計畫名稱：${projectName}\n`;
csv += `匯出時間：${new Date().toLocaleString('zh-TW')}\n\n`;

// 表頭
csv += '工程名稱,';
result.months.forEach(month => {
    const [year, monthNum] = month.split('-');
    csv += `${year}/${monthNum},`;
});
csv += '合計\n';

// 資料列
result.pipelines.forEach(pipeline => {
    csv += `${pipeline.name},`;
    
    let total = 0;
    result.months.forEach(month => {
        const length = pipeline.monthly[month] || 0;
        total += length;
        csv += `${length},`;
    });
    
    csv += `${total}\n`;
});

// 月份總計列
csv += '月份總計,';
result.months.forEach(month => {
    let monthTotal = 0;
    result.pipelines.forEach(pipeline => {
        monthTotal += pipeline.monthly[month] || 0;
    });
    csv += `${monthTotal},`;
});

// 整體總計
let grandTotal = 0;
result.pipelines.forEach(pipeline => {
    result.months.forEach(month => {
        grandTotal += pipeline.monthly[month] || 0;
    });
});
csv += `${grandTotal}\n`;

// 建立下載連結
const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
const link = document.createElement('a');
const url = URL.createObjectURL(blob);

link.setAttribute('href', url);
link.setAttribute('download', `每月施工統計_${projectName}_${new Date().toISOString().slice(0,10)}.csv`);
link.style.display = 'none';

document.body.appendChild(link);
link.click();
document.body.removeChild(link);

showToast('匯出成功！', 'success');

    } catch (error) {
console.error('匯出失敗:', error);
showToast('匯出失敗：' + error.message, 'error');
    }
}

// ==================== 分支編輯功能 ====================

function toggleBranchEditMode() {
    if (!currentPipeline) {
showToast('請先選擇一個工程', 'warning');
return;
    }
    
    // 檢查是否已經是 MULTILINESTRING
    const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
    if (isMULTI) {
showToast('此工程已是 MULTILINESTRING 格式，請使用「編輯路徑」功能', 'warning');
return;
    }
    
    if (!isBranchEditMode) {
startBranchEditMode();
    } else {
cancelBranchEdit();
    }
}

function startBranchEditMode() {
    isBranchEditMode = true;
    
    // 清除現有圖層
    clearMap();
    
    // 解析主幹座標
    const mainCoords = parseLineString(currentPipeline.linestring);
    
    // 繪製主幹(紅色半透明)
    branchEditMainPolyline = L.polyline(mainCoords, {
color: '#e74c3c',
weight: 6,
opacity: 0.5
    }).addTo(map);
    
    // 顯示操作提示
    showBranchEditPanel();
    
    // 監聽地圖點擊
    map.on('click', onBranchEditMapClick);
    
    console.log('✅ 進入分支編輯模式');
}

function showBranchEditPanel() {
    const panel = document.createElement('div');
    panel.id = 'branchEditPanel';
    panel.style.cssText = `
position: fixed;
top: 80px;
right: 20px;
background: white;
padding: 20px;
border-radius: 8px;
box-shadow: 0 4px 20px rgba(0,0,0,0.15);
z-index: 1001;
min-width: 320px;
max-width: 400px;
    `;
    
    const junctionCount = branchEditJunctions.length;
    const branchCount = branchEditNewBranches.length;
    const isDrawing = branchEditCurrentDrawing !== null;
    
    panel.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;">
    <h3 style="margin:0;color:#333;font-size:18px;">🌿 分支編輯</h3>
    <button onclick="cancelBranchEdit()" style="background:#f5f5f5;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:14px;">✕</button>
</div>

<div style="background:#f8f9fa;padding:12px;border-radius:6px;margin-bottom:15px;">
    <div style="font-size:13px;color:#666;margin-bottom:8px;">
        📍 Y接點: <strong style="color:#e74c3c;">${junctionCount}</strong> 個
    </div>
    <div style="font-size:13px;color:#666;">
        🌿 新支線: <strong style="color:#4CAF50;">${branchCount}</strong> 條
    </div>
</div>

<div style="background:#e3f2fd;padding:12px;border-radius:6px;margin-bottom:15px;font-size:12px;color:#1976d2;line-height:1.6;">
    ${isDrawing ? 
        '✏️ <strong>繪製中...</strong><br>點擊新增節點<br>雙擊或右鍵完成支線' :
        '📍 <strong>步驟1:</strong> 點擊主幹標記Y接點<br>🌿 <strong>步驟2:</strong> 點擊Y接點開始繪製支線'
    }
</div>

<div style="display:flex;gap:8px;flex-direction:column;">
    ${isDrawing ? `
        <button onclick="finishCurrentBranch()" style="width:100%;padding:12px;background:#4CAF50;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:14px;">
            ✓ 完成此支線
        </button>
        <button onclick="cancelCurrentBranch()" style="width:100%;padding:10px;background:#ff9800;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
            ✕ 取消此支線
        </button>
    ` : ''}
    
    <button onclick="previewBranchResult()" style="width:100%;padding:12px;background:#2196F3;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:14px;" ${junctionCount === 0 ? 'disabled' : ''}>
        👁️ 預覽結果
    </button>
    
    <button onclick="saveBranchEdits()" style="width:100%;padding:12px;background:#4CAF50;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:14px;" ${junctionCount === 0 ? 'disabled' : ''}>
        💾 儲存到 Google Sheets
    </button>
    
    <button onclick="clearAllBranchEdits()" style="width:100%;padding:10px;background:#f44336;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;" ${junctionCount === 0 && branchCount === 0 ? 'disabled' : ''}>
        🗑️ 清除所有編輯
    </button>
</div>
    `;
    
    // 移除舊面板
    const oldPanel = document.getElementById('branchEditPanel');
    if (oldPanel) oldPanel.remove();
    
    document.body.appendChild(panel);
}

function onBranchEditMapClick(e) {
    if (!isBranchEditMode) return;
    
    if (branchEditCurrentDrawing) {
// 繪製模式:新增節點
addBranchNode(e.latlng);
    } else {
// 檢查是否點擊在Y接點附近
let clickedJunction = null;
for (let junction of branchEditJunctions) {
    const distance = map.distance(e.latlng, junction.coord);
    if (distance < 20) { // 20m內
        clickedJunction = junction;
        break;
    }
}

if (clickedJunction) {
    // 開始從Y接點繪製支線
    startDrawingBranch(clickedJunction);
} else {
    // 在主幹上新增Y接點
    addJunctionPoint(e.latlng);
}
    }
}

function addJunctionPoint(latlng) {
    const mainCoords = parseLineString(currentPipeline.linestring);
    const clickPoint = [latlng.lat, latlng.lng];
    
    // 找到最近的管線點
    const nearestPoint = findNearestPointOnLineCoords(clickPoint, mainCoords);
    if (!nearestPoint) return;
    
    const distance = findDistanceOnLine(nearestPoint.coord, mainCoords);
    
    // 檢查是否太接近已有的Y接點
    for (let junction of branchEditJunctions) {
if (Math.abs(junction.distance - distance) < 10) {
    showToast('此位置太接近已有的Y接點(距離<10m)', 'warning');
    return;
}
    }
    
    // 建立Y接點標記
    const marker = L.marker(nearestPoint.coord, {
icon: L.divIcon({
    className: 'junction-marker-edit',
    html: '<div style="width:20px;height:20px;background:#ff5722;border:3px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
}),
draggable: false
    }).addTo(map);
    
    marker.bindPopup(`
<div style="text-align:center;padding:8px;">
    <div style="font-weight:bold;margin-bottom:4px;">Y 接點</div>
    <div style="font-size:12px;color:#666;">約 ${Math.round(distance)}m</div>
    <button onclick="removeJunction(${branchEditJunctions.length})" style="margin-top:8px;padding:6px 12px;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;">
        🗑️ 刪除
    </button>
</div>
    `);
    
    branchEditJunctions.push({
coord: nearestPoint.coord,
marker: marker,
distance: distance
    });
    
    updateBranchEditPanel();
    console.log(`✅ 新增 Y接點 at ${Math.round(distance)}m`);
}

function removeJunction(index) {
    if (index >= 0 && index < branchEditJunctions.length) {
map.closePopup();
const junction = branchEditJunctions[index];
map.removeLayer(junction.marker);
branchEditJunctions.splice(index, 1);
updateBranchEditPanel();
    }
}

function startDrawingBranch(junction) {
    branchEditCurrentDrawing = {
startCoord: junction.coord,
coords: [junction.coord],
polyline: null,
markers: []
    };
    
    updateBranchEditPanel();
    console.log('✏️ 開始繪製支線');
}

function addBranchNode(latlng) {
    if (!branchEditCurrentDrawing) return;
    
    const coord = [latlng.lat, latlng.lng];
    branchEditCurrentDrawing.coords.push(coord);
    
    // 更新預覽線
    if (branchEditCurrentDrawing.polyline) {
map.removeLayer(branchEditCurrentDrawing.polyline);
    }
    
    branchEditCurrentDrawing.polyline = L.polyline(branchEditCurrentDrawing.coords, {
color: '#4CAF50',
weight: 4,
opacity: 0.7,
dashArray: '10, 5'
    }).addTo(map);
    
    // 新增節點標記
    const marker = L.circleMarker(latlng, {
radius: 4,
fillColor: '#4CAF50',
fillOpacity: 1,
weight: 2,
color: 'white'
    }).addTo(map);
    
    branchEditCurrentDrawing.markers.push(marker);
    
    console.log(`  新增節點 #${branchEditCurrentDrawing.coords.length}`);
}

function finishCurrentBranch() {
    if (!branchEditCurrentDrawing || branchEditCurrentDrawing.coords.length < 2) {
showToast('支線至少需要2個點', 'warning');
return;
    }
    
    // 清除預覽線和標記
    if (branchEditCurrentDrawing.polyline) {
map.removeLayer(branchEditCurrentDrawing.polyline);
    }
    branchEditCurrentDrawing.markers.forEach(m => map.removeLayer(m));
    
    // 繪製最終支線
    const finalPolyline = L.polyline(branchEditCurrentDrawing.coords, {
color: '#9C27B0',
weight: 5,
opacity: 0.7
    }).addTo(map);
    
    branchEditNewBranches.push({
coords: branchEditCurrentDrawing.coords,
polyline: finalPolyline
    });
    
    console.log(`✅ 完成支線 (${branchEditCurrentDrawing.coords.length} 個節點)`);
    
    branchEditCurrentDrawing = null;
    updateBranchEditPanel();
}

function cancelCurrentBranch() {
    if (!branchEditCurrentDrawing) return;
    
    // 清除預覽線和標記
    if (branchEditCurrentDrawing.polyline) {
map.removeLayer(branchEditCurrentDrawing.polyline);
    }
    branchEditCurrentDrawing.markers.forEach(m => map.removeLayer(m));
    
    branchEditCurrentDrawing = null;
    updateBranchEditPanel();
    console.log('❌ 取消繪製支線');
}

async function clearAllBranchEdits() {
    if (!await showConfirm({ title: '清除編輯', message: '確定要清除所有編輯嗎？', okText: '清除', danger: true })) return;
    
    // 清除Y接點
    branchEditJunctions.forEach(j => map.removeLayer(j.marker));
    branchEditJunctions = [];
    
    // 清除支線
    branchEditNewBranches.forEach(b => map.removeLayer(b.polyline));
    branchEditNewBranches = [];
    
    // 清除當前繪製
    if (branchEditCurrentDrawing) {
cancelCurrentBranch();
    }
    
    updateBranchEditPanel();
    console.log('🗑️ 已清除所有編輯');
}

function updateBranchEditPanel() {
    showBranchEditPanel();
}

function previewBranchResult() {
    const multilinestring = buildMULTILINESTRING();
    
    const previewDiv = document.createElement('div');
    previewDiv.style.cssText = `
position: fixed;
top: 50%;
left: 50%;
transform: translate(-50%, -50%);
background: white;
padding: 24px;
border-radius: 8px;
box-shadow: 0 8px 32px rgba(0,0,0,0.3);
z-index: 2000;
max-width: 600px;
max-height: 80vh;
overflow: auto;
    `;
    
    previewDiv.innerHTML = `
<h3 style="margin:0 0 16px 0;color:#333;">📋 MULTILINESTRING 預覽</h3>
<div style="background:#f5f5f5;padding:12px;border-radius:6px;font-family:monospace;font-size:11px;word-break:break-all;margin-bottom:16px;max-height:400px;overflow:auto;">
    ${multilinestring}
</div>
<button onclick="this.parentElement.remove()" style="width:100%;padding:10px;background:#2196F3;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">
    關閉
</button>
    `;
    
    document.body.appendChild(previewDiv);
}

async function saveBranchEdits() {
    if (!requireSupervisor()) return;
    if (branchEditJunctions.length === 0) {
showToast('尚未建立任何Y接點', 'warning');
return;
    }
    
    if (!await showConfirm({ title: '儲存分支路徑', message: `Y接點：${branchEditJunctions.length} 個\n新支線：${branchEditNewBranches.length} 條\n\n儲存後將更新 Google Sheets`, okText: '儲存', icon: '💾' })) {
return;
    }
    
    const multilinestring = buildMULTILINESTRING();
    
    try {
const result = await apiCall('updateLinestring', {}, {
    body: new URLSearchParams({
        projectId: currentProject.id,
        pipelineId: currentPipeline.id,
        linestring: multilinestring
    })
});

if (result.success) {
    showToast('儲存成功！', 'success');
    
    // 更新本地資料
    currentPipeline.linestring = multilinestring;
    
    // 退出編輯模式並重新載入
    cancelBranchEdit();
    loadPipelineData(currentPipeline.id);
} else {
    showToast('儲存失敗：' + (result.error || '未知錯誤'), 'error');
}
    } catch (error) {
console.error('儲存錯誤:', error);
showToast('儲存失敗：' + error.message, 'error');
    }
}

function buildMULTILINESTRING() {
    const mainCoords = parseLineString(currentPipeline.linestring);
    
    // 根據Y接點距離排序
    const sortedJunctions = [...branchEditJunctions].sort((a, b) => a.distance - b.distance);
    
    // 分割主幹為多個分支
    const branches = [];
    let lastSplit = 0;
    
    sortedJunctions.forEach(junction => {
// 找到Y接點在主幹上的索引
const junctionIndex = findClosestIndexOnLine(junction.coord, mainCoords);

if (junctionIndex > lastSplit) {
    // 新增主幹片段
    const segment = mainCoords.slice(lastSplit, junctionIndex + 1);
    branches.push(segment);
    lastSplit = junctionIndex;
}
    });
    
    // 新增最後一段主幹
    if (lastSplit < mainCoords.length - 1) {
branches.push(mainCoords.slice(lastSplit));
    }
    
    // 如果沒有Y接點,整條就是主幹
    if (branches.length === 0) {
branches.push(mainCoords);
    }
    
    // 新增支線
    branchEditNewBranches.forEach(branch => {
branches.push(branch.coords);
    });
    
    // 組成 MULTILINESTRING
    const branchStrings = branches.map(branch => {
const coordStrings = branch.map(coord => `${coord[1]} ${coord[0]}`).join(', ');
return `(${coordStrings})`;
    });
    
    return `MULTILINESTRING(${branchStrings.join(', ')})`;
}

function findClosestIndexOnLine(coord, lineCoords) {
    let minDist = Infinity;
    let closestIndex = 0;
    
    for (let i = 0; i < lineCoords.length; i++) {
const dist = getDistance(coord, lineCoords[i]);
if (dist < minDist) {
    minDist = dist;
    closestIndex = i;
}
    }
    
    return closestIndex;
}

function findNearestPointOnLineCoords(clickPoint, lineCoords) {
    let minDistance = Infinity;
    let nearestPoint = null;
    
    for (let i = 0; i < lineCoords.length - 1; i++) {
const p1 = lineCoords[i];
const p2 = lineCoords[i + 1];

// 計算點到線段的最近點
const point = closestPointOnSegment(clickPoint, p1, p2);
const dist = getDistance(clickPoint, point);

if (dist < minDistance) {
    minDistance = dist;
    nearestPoint = { coord: point, segmentIndex: i };
}
    }
    
    return nearestPoint;
}

function closestPointOnSegment(point, lineStart, lineEnd) {
    const [px, py] = point;
    const [x1, y1] = lineStart;
    const [x2, y2] = lineEnd;
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    
    if (dx === 0 && dy === 0) return lineStart;
    
    const t = Math.max(0, Math.min(1, 
((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    ));
    
    return [x1 + t * dx, y1 + t * dy];
}

function findDistanceOnLine(targetCoord, lineCoords) {
    let totalDist = 0;
    let found = false;
    
    for (let i = 0; i < lineCoords.length - 1; i++) {
const p1 = lineCoords[i];
const p2 = lineCoords[i + 1];

// 檢查目標點是否在此線段上
const closestPt = closestPointOnSegment(targetCoord, p1, p2);
const distToSegment = getDistance(targetCoord, closestPt);

if (distToSegment < 1) { // 1m內
    // 計算到此點的距離
    totalDist += getDistance(p1, closestPt);
    found = true;
    break;
}

totalDist += getDistance(p1, p2);
    }
    
    return totalDist;
}

function cancelBranchEdit() {
    isBranchEditMode = false;
    
    // 清除所有標記和線條
    if (branchEditMainPolyline) {
map.removeLayer(branchEditMainPolyline);
branchEditMainPolyline = null;
    }
    
    branchEditJunctions.forEach(j => map.removeLayer(j.marker));
    branchEditJunctions = [];
    
    branchEditNewBranches.forEach(b => map.removeLayer(b.polyline));
    branchEditNewBranches = [];
    
    if (branchEditCurrentDrawing) {
cancelCurrentBranch();
    }
    
    // 移除面板
    const panel = document.getElementById('branchEditPanel');
    if (panel) panel.remove();
    
    // 移除地圖監聽
    map.off('click', onBranchEditMapClick);
    
    // 重新載入工程
    if (currentPipeline) {
loadPipelineData(currentPipeline.id);
    }
    
    console.log('❌ 退出分支編輯模式');
}

