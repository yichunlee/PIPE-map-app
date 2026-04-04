window.editSegment = function(segmentNumber) {
    const segment = currentPipeline.segments.find(s => s.segmentNumber === segmentNumber);
    if (!segment) {
        showToast('找不到段落', 'error');
        return;
    }
    
    const html = `
        <div style="padding: 10px;">
            <h3 style="margin-bottom: 15px;">✏️ 編輯段落 #${segmentNumber}</h3>
            <div style="margin-bottom: 10px; padding: 8px; background: #e3f2fd; border-radius: 4px;">
                <div style="font-size: 12px; color: #1976d2; margin-bottom: 4px;">📍 段落範圍（不可修改）</div>
                <div style="font-size: 14px; font-weight: bold;">${segment.startDistance}m - ${segment.endDistance}m (${segment.endDistance - segment.startDistance}m)</div>
            </div>
            <div style="margin-bottom: 10px;">
                <label>管徑：</label>
                <input type="text" id="editSegDiameter" value="${segment.diameter || ''}" placeholder="例如：DN300" style="width: 100%; padding: 5px; margin-top: 5px;">
            </div>
            <div style="margin-bottom: 10px;">
                <label>管種：</label>
                <input type="text" id="editSegPipeType" value="${segment.pipeType || ''}" placeholder="例如：DIP、PVC" style="width: 100%; padding: 5px; margin-top: 5px;">
            </div>
            <div style="margin-bottom: 10px;">
                <label>施工方式：</label>
                <select id="editSegMethod" style="width: 100%; padding: 5px; margin-top: 5px;">
                    <option value="">請選擇</option>
                    <option value="開挖" ${segment.method === '開挖' ? 'selected' : ''}>開挖</option>
                    <option value="推進" ${segment.method === '推進' ? 'selected' : ''}>推進</option>
                    <option value="水管橋" ${segment.method === '水管橋' ? 'selected' : ''}>水管橋</option>
                    <option value="潛鑽" ${segment.method === '潛鑽' ? 'selected' : ''}>潛鑽</option>
                    <option value="潛遁" ${segment.method === '潛遁' ? 'selected' : ''}>潛遁</option>
                    <option value="隧道" ${segment.method === '隧道' ? 'selected' : ''}>隧道</option>
                </select>
            </div>
            <div style="margin-bottom: 10px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 11px; color: #856404;">
                💡 提示：如需修改段落範圍，請直接在 Google Sheets「施工進度」表中修改
            </div>
            <button onclick="saveEditedSegment('${segmentNumber}')" style="width: 100%; padding: 10px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 10px;">
                💾 儲存修改
            </button>
            <button onclick="map.closePopup()" style="width: 100%; padding: 8px; background: #e0e0e0; color: #666; border: none; border-radius: 6px; cursor: pointer; margin-top: 5px;">
                取消
            </button>
        </div>
    `;
    
    L.popup()
        .setLatLng(map.getCenter())
        .setContent(html)
        .openOn(map);
};


let currentPipelineMethods = []; // 統計面板計算出來的工法列表
// ==================== 段落管理功能 ====================

let currentSegments = []; // 儲存當前工程的段落資料
let visualSegmentationMode = false; // 視覺化分段模式
let segmentDividers = []; // 分段線標記 {distance: number, marker: L.Marker}
let pipelineCoords = []; // 管線座標
let isDraggingDivider = false; // 是否正在拖拉分段線

// 🆕 MULTILINESTRING 支援
let currentBranchForSegmentation = 0; // 當前選擇的分支索引（用於段落管理）
let branchDataForSegmentation = null; // 分支資料（用於段落管理）
let currentBranchLength = 0; // 當前分支的長度（用於視覺化分段）

// 切換視覺化分段模式
function toggleVisualSegmentation() {
    if (!currentPipeline) {
        showToast('請先選擇一個工程', 'warning');
        return;
    }
    
    visualSegmentationMode = !visualSegmentationMode;
    const buttonsContainer = document.getElementById('segmentPanelButtons');
    
    if (visualSegmentationMode) {
        // 進入視覺化分段模式：顯示完成和取消按鈕
        buttonsContainer.innerHTML = `
            <div style="display:flex;gap:10px;">
                <button onclick="completeVisualSegmentation()" class="btn-visual-segment active" style="flex:1;">✓ 完成分段</button>
                <button onclick="cancelVisualSegmentation()" style="flex:1;padding:10px;background:#f5f5f5;color:#666;border:none;border-radius:4px;cursor:pointer;font-size:14px;font-weight:500;">✕ 取消</button>
            </div>
        `;
        enterVisualSegmentationMode();
    } else {
        // 退出視覺化分段模式：恢復單一按鈕
        buttonsContainer.innerHTML = `
            <button onclick="toggleVisualSegmentation()" class="btn-visual-segment" style="width:100%;">🎯 視覺化分段</button>
        `;
        exitVisualSegmentationMode();
    }
}

// 完成視覺化分段
function completeVisualSegmentation() {
    visualSegmentationMode = false;
    const buttonsContainer = document.getElementById('segmentPanelButtons');
    buttonsContainer.innerHTML = `
        <button onclick="toggleVisualSegmentation()" class="btn-visual-segment" style="width:100%;">🎯 視覺化分段</button>
    `;
    exitVisualSegmentationMode();
}

// 取消視覺化分段
async function cancelVisualSegmentation() {
    if (segmentDividers.length > 0) {
        if (!await showConfirm({ title: '取消分段', message: '確定要取消嗎？所有分段線將被清除。', okText: '確認取消', danger: true })) {
            return;
        }
    }
    
    visualSegmentationMode = false;
    const buttonsContainer = document.getElementById('segmentPanelButtons');
    buttonsContainer.innerHTML = `
        <button onclick="toggleVisualSegmentation()" class="btn-visual-segment" style="width:100%;">🎯 視覺化分段</button>
    `;
    
    // 移除所有分段線標記
    segmentDividers.forEach(divider => {
        map.removeLayer(divider.marker);
    });
    segmentDividers = [];
    
    // 移除地圖點擊事件
    map.off('click', onMapClickAddDivider);
    
    // 恢復段落表格
    document.querySelector('.segment-table').style.display = 'table';
    hideVisualSegmentationPanel();
}

// 進入視覺化分段模式
async function enterVisualSegmentationMode() {
    console.log('📍 進入視覺化分段模式');
    
    // 🆕 檢查是否為 MULTILINESTRING
    const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
    
    if (isMULTI) {
        // MULTILINESTRING：需要先選擇分支
        branchDataForSegmentation = parseLineStringWithBranches(currentPipeline.linestring);
        
        console.log('🌿 檢測到 MULTILINESTRING，分支數:', branchDataForSegmentation.branches.length);
        
        // 顯示分支選擇面板
        showBranchSelectionPanel();
        return; // 等待使用者選擇分支
    }
    
    // 單一 LINESTRING：原本的邏輯
    // 解析管線座標
    pipelineCoords = parseLineString(currentPipeline.linestring);
    
    // 🔧 設定管線長度
    currentBranchLength = currentPipeline.length;
    
    // 檢查是否已有段落
    let adjustmentMode = false; // 微調模式
    
    if (currentSegments.length > 0) {
        // 已有段落，詢問使用者意圖
        const choice = await showConfirm({
            title: '選擇分段模式',
            message: `目前已有 ${currentSegments.length} 個段落\n\n【確定】微調現有段落位置（拖拉調整）\n【取消】清空重新分段（新增分段線）`,
            okText: '微調模式',
            cancelText: '重新分段',
            icon: '📐'
        });
        
        if (choice) {
            // 微調模式：載入現有分段線，也允許新增
            adjustmentMode = true;
            const sortedSegments = [...currentSegments].sort((a, b) => a.startDistance - b.startDistance);
            
            sortedSegments.forEach((seg, index) => {
                // 在每個段落的結束位置加分段線（除了終點）
                if (index < sortedSegments.length - 1) {
                    addSegmentDivider(seg.endDistance);
                }
            });
            
            // 微調模式也啟用點擊新增
            map.on('click', onMapClickAddDivider);
            updateVisualSegmentationPanel();
        } else {
            // 重新分段模式：不載入現有分段線
            showVisualSegmentationGuide();
            // 啟用地圖點擊新增分段線
            map.on('click', onMapClickAddDivider);
        }
    } else {
        // 無段落，顯示提示訊息
        showVisualSegmentationGuide();
        // 啟用地圖點擊新增分段線
        map.on('click', onMapClickAddDivider);
    }
    
    // 隱藏段落表格，顯示操作說明
    document.querySelector('.segment-table').style.display = 'none';
    showVisualSegmentationPanel(adjustmentMode);
}

// 🆕 顯示分支選擇面板
function showBranchSelectionPanel() {
    // 隱藏段落表格
    document.querySelector('.segment-table').style.display = 'none';
    
    // 建立分支選擇面板
    const panelContainer = document.getElementById('visualSegmentationPanel');
    if (!panelContainer) {
        console.error('找不到 visualSegmentationPanel 元素');
        return;
    }
    
    let html = `
        <div style="padding: 20px; background: #f8f9fa; border-radius: 8px; margin-bottom: 15px;">
            <div style="font-size: 16px; font-weight: bold; color: #333; margin-bottom: 15px;">
                🌿 請選擇要分段的分支
            </div>
    `;
    
    branchDataForSegmentation.branches.forEach((branch, index) => {
        const isMain = !branch.isBranch;
        const label = isMain ? '主幹' : `分支 ${index}`;
        
        // 計算該分支長度
        let branchLength = 0;
        for (let i = 0; i < branch.coords.length - 1; i++) {
            branchLength += getDistance(branch.coords[i], branch.coords[i + 1]);
        }
        branchLength = Math.round(branchLength);
        
        const color = isMain ? '#e74c3c' : '#9C27B0';
        const checked = index === currentBranchForSegmentation ? 'checked' : '';
        
        html += `
            <div style="margin: 10px 0; padding: 12px; background: white; border: 2px solid ${color}; border-radius: 6px; cursor: pointer;" onclick="selectBranchForSegmentation(${index})">
                <label style="cursor: pointer; display: flex; align-items: center; gap: 10px;">
                    <input type="radio" name="branchSelection" value="${index}" ${checked} style="width: 18px; height: 18px; cursor: pointer;">
                    <span style="font-weight: 600; color: ${color};">${label}</span>
                    <span style="color: #666; font-size: 13px;">(${branchLength}m, ${branch.coords.length} 個節點)</span>
                </label>
            </div>
        `;
    });
    
    html += `
        </div>
        <div style="display: flex; gap: 10px; margin-top: 15px;">
            <button onclick="confirmBranchSelection()" style="flex: 1; padding: 12px; background: #4CAF50; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;">
                ✓ 確認選擇
            </button>
            <button onclick="cancelBranchSelection()" style="flex: 1; padding: 12px; background: #f5f5f5; color: #666; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600;">
                ✕ 取消
            </button>
        </div>
    `;
    
    panelContainer.innerHTML = html;
    panelContainer.style.display = 'block';
}

// 🆕 選擇分支
function selectBranchForSegmentation(branchIndex) {
    currentBranchForSegmentation = branchIndex;
    console.log('選擇分支:', branchIndex);
}

// 🆕 確認分支選擇
async function confirmBranchSelection() {
    const branch = branchDataForSegmentation.branches[currentBranchForSegmentation];
    
    console.log(`✅ 確認選擇分支 ${currentBranchForSegmentation}`);
    
    // 設定該分支的座標
    pipelineCoords = branch.coords;
    
    // 🔧 計算該分支的長度
    let branchLength = 0;
    for (let i = 0; i < branch.coords.length - 1; i++) {
        branchLength += getDistance(branch.coords[i], branch.coords[i + 1]);
    }
    currentBranchLength = Math.round(branchLength); // 🆕 儲存當前分支長度
    console.log(`   分支長度: ${currentBranchLength}m`);
    
    // 篩選該分支的段落
    const branchSegments = currentSegments.filter(seg => {
        // 如果段落有 branchIndex 屬性，檢查是否匹配
        if (seg.branchIndex !== undefined) {
            return seg.branchIndex === currentBranchForSegmentation;
        }
        // 舊資料沒有 branchIndex，視為主幹（index 0）
        return currentBranchForSegmentation === 0;
    });
    
    let adjustmentMode = false;
    
    if (branchSegments.length > 0) {
        const choice = await showConfirm({
            title: '選擇分段模式',
            message: `分支已有 ${branchSegments.length} 個段落\n\n【確定】微調現有段落位置（拖拉調整）\n【取消】清空重新分段（新增分段線）`,
            okText: '微調模式',
            cancelText: '重新分段',
            icon: '📐'
        });
        
        if (choice) {
            adjustmentMode = true;
            const sortedSegments = [...branchSegments].sort((a, b) => a.startDistance - b.startDistance);
            
            sortedSegments.forEach((seg, index) => {
                if (index < sortedSegments.length - 1) {
                    addSegmentDivider(seg.endDistance);
                }
            });
            
            updateVisualSegmentationPanel();
        } else {
            showVisualSegmentationGuide();
            map.on('click', onMapClickAddDivider);
        }
    } else {
        showVisualSegmentationGuide();
        map.on('click', onMapClickAddDivider);
    }
    
    // 隱藏分支選擇面板，顯示操作說明
    document.getElementById('visualSegmentationPanel').style.display = 'none';
    document.querySelector('.segment-table').style.display = 'none';
    showVisualSegmentationPanel(adjustmentMode);
}

// 🆕 取消分支選擇
function cancelBranchSelection() {
    console.log('❌ 取消分支選擇');
    
    // 退出視覺化分段模式
    visualSegmentationMode = false;
    const buttonsContainer = document.getElementById('segmentPanelButtons');
    buttonsContainer.innerHTML = `
        <button onclick="toggleVisualSegmentation()" class="btn-visual-segment" style="width:100%;">🎯 視覺化分段</button>
    `;
    
    // 隱藏分支選擇面板
    document.getElementById('visualSegmentationPanel').style.display = 'none';
    
    // 恢復段落表格
    document.querySelector('.segment-table').style.display = 'table';
    
    // 重置變數
    branchDataForSegmentation = null;
    currentBranchForSegmentation = 0;
}

// 退出視覺化分段模式
async function exitVisualSegmentationMode() {
    console.log('📍 退出視覺化分段模式');
    
    // 先檢查是否有分段線需要儲存
    const hasDividers = segmentDividers.length > 0;
    
    if (hasDividers) {
        // 有分段線：詢問是否儲存
        if (await showConfirm({ title: '建立段落', message: '是否要根據分段線建立段落？', okText: '建立', cancelText: '不建立', icon: '📐' })) {
            createSegmentsFromDividers();
            return; // createSegmentsFromDividers 會處理清理工作
        }
    } else {
        // 🆕 沒有分段線：詢問是否要建立整條為一個段落
        const isMULTI = branchDataForSegmentation !== null;
        
        if (isMULTI) {
            // MULTILINESTRING：詢問是否建立整條分支為一個段落
            const branch = branchDataForSegmentation.branches[currentBranchForSegmentation];
            const branchLabel = branch.isBranch ? `分支 ${currentBranchForSegmentation}` : '主幹';
            
            if (await showConfirm({ title: '建立整段', message: `沒有分段線，是否要將整條${branchLabel}建立為一個段落？`, okText: '建立', cancelText: '取消', icon: '📐' })) {
                createWholeBranchSegment();
                return;
            }
        } else {
            // 單一 LINESTRING：詢問是否建立整條為一個段落
            if (await showConfirm({ title: '建立整段', message: '沒有分段線，是否要將整條管線建立為一個段落？', okText: '建立', cancelText: '取消', icon: '📐' })) {
                createWholeLineSegment();
                return;
            }
        }
    }
    
    // 移除所有分段線標記
    segmentDividers.forEach(divider => {
        map.removeLayer(divider.marker);
    });
    segmentDividers = [];
    
    // 移除地圖點擊事件
    map.off('click', onMapClickAddDivider);
    
    // 恢復段落表格
    document.querySelector('.segment-table').style.display = 'table';
    hideVisualSegmentationPanel();
}

// 🆕 建立整條分支為一個段落（MULTILINESTRING）
async function createWholeBranchSegment() {
    if (!requireSupervisor()) return;
    const branch = branchDataForSegmentation.branches[currentBranchForSegmentation];
    
    // 計算分支長度
    let branchLength = 0;
    for (let i = 0; i < branch.coords.length - 1; i++) {
        branchLength += getDistance(branch.coords[i], branch.coords[i + 1]);
    }
    branchLength = Math.round(branchLength);
    
    console.log(`📏 建立整條分支為一個段落，長度: ${branchLength}m`);
    
    // 建立單一段落
    const segments = [{
        start: 0,
        end: branchLength
    }];
    
    // 顯示段落設定表單
    showBatchSegmentForm(segments);
}

// 🆕 建立整條管線為一個段落（單一 LINESTRING）
async function createWholeLineSegment() {
    if (!requireSupervisor()) return;
    const totalLength = currentPipeline.length || 0;
    
    console.log(`📏 建立整條管線為一個段落，長度: ${totalLength}m`);
    
    // 建立單一段落
    const segments = [{
        start: 0,
        end: totalLength
    }];
    
    // 顯示段落設定表單
    showBatchSegmentForm(segments);
}

// 在地圖上點擊新增分段線
async function onMapClickAddDivider(e) {
    if (!visualSegmentationMode) return;
    
    // 🔧 單純點擊即可新增分段線(視覺化分段模式專用)
    // 不需要按任何鍵,避免與小段操作衝突
    
    // 計算點擊位置在管線上的距離
    const clickPoint = [e.latlng.lat, e.latlng.lng];
    const distance = findNearestPointOnLine(clickPoint, pipelineCoords);
    
    if (distance !== null) {
        addSegmentDivider(distance);
    }
}

// 新增分段線標記
function addSegmentDivider(distance) {
    // 🔧 取得當前管線/分支的總長度
    const totalLength = branchDataForSegmentation !== null 
        ? currentBranchLength 
        : currentPipeline.length;
    
    // 檢查是否在起點或終點（不允許）
    if (distance < 1) {
        console.log('⚠️ 不能在起點 (0m) 放置分段線');
        return;
    }
    if (distance >= totalLength - 1) {
        console.log(`⚠️ 不能在終點 (${totalLength}m) 放置分段線`);
        return;
    }
    
    // 檢查是否已存在相同位置的分段線
    const existing = segmentDividers.find(d => Math.abs(d.distance - distance) < 1);
    if (existing) {
        console.log('⚠️ 該位置已有分段線');
        return;
    }
    
    // 計算分段線在管線上的座標
    const position = getPositionAtDistance(pipelineCoords, distance);
    if (!position) {
        console.error('❌ 無法計算分段線位置');
        return;
    }
    
    // 建立分段線標記
    const dividerIcon = L.divIcon({
        className: 'segment-divider-marker',
        html: `<div style="position:relative;">
            ✂️
            <div class="segment-divider-label">${Math.round(distance)}m</div>
        </div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });
    
    const marker = L.marker(position, {
        icon: dividerIcon,
        draggable: true,
        zIndexOffset: 2000
    }).addTo(map);
    
    // 拖拉事件
    marker.on('dragstart', function() {
        isDraggingDivider = true;
        this._icon.classList.add('dragging');
    });
    
    marker.on('drag', function(e) {
        // 計算新位置的距離（使用 marker 的當前位置）
        const latlng = this.getLatLng();
        const newPos = [latlng.lat, latlng.lng];
        const newDistance = findNearestPointOnLine(newPos, pipelineCoords);
        
        if (newDistance !== null) {
            // 更新標籤
            const label = this._icon.querySelector('.segment-divider-label');
            if (label) {
                label.textContent = Math.round(newDistance) + 'm';
            }
        }
    });
    
    marker.on('dragend', function(e) {
        isDraggingDivider = false;
        this._icon.classList.remove('dragging');
        
        // 🔧 取得當前管線/分支的總長度
        const totalLength = branchDataForSegmentation !== null 
            ? currentBranchLength 
            : currentPipeline.length;
        
        // 計算最終位置（使用 marker 的當前位置）
        const latlng = this.getLatLng();
        const newPos = [latlng.lat, latlng.lng];
        const newDistance = findNearestPointOnLine(newPos, pipelineCoords);
        
        console.log('拖拉結束，距離:', newDistance, '總長度:', totalLength);
        
        if (newDistance !== null) {
            // 檢查是否太靠近起點或終點
            if (newDistance < 5 || newDistance >= totalLength - 5) {
                // 自動刪除這條分段線
                console.log('🗑️ 拖拉到邊界，自動刪除分段線');
                console.log('刪除前分段線數量:', segmentDividers.length);
                
                map.removeLayer(this);
                const dividerIndex = segmentDividers.findIndex(d => d.marker === this);
                console.log('找到的索引:', dividerIndex);
                
                if (dividerIndex !== -1) {
                    segmentDividers.splice(dividerIndex, 1);
                }
                
                console.log('刪除後分段線數量:', segmentDividers.length);
                console.log('剩餘分段線:', segmentDividers.map(d => Math.round(d.distance)));
                
                updateVisualSegmentationPanel();
                return;
            }
            
            // 更新距離
            const dividerIndex = segmentDividers.findIndex(d => d.marker === this);
            if (dividerIndex !== -1) {
                console.log('更新分段線距離:', segmentDividers[dividerIndex].distance, '->', newDistance);
                segmentDividers[dividerIndex].distance = newDistance;
            }
            
            // 吸附到管線
            const snapPosition = getPositionAtDistance(pipelineCoords, newDistance);
            if (snapPosition) {
                this.setLatLng(snapPosition);
            }
            
            // 更新視覺化面板
            updateVisualSegmentationPanel();
        }
    });
    
    // 右鍵選單：刪除或設為節點
    marker.on('contextmenu', async function(e) {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
        
        const divider = segmentDividers.find(d => d.marker === marker);
        const currentNode = divider ? (divider.nodeLabel || '') : '';
        
        // 建立右鍵選單
        const menuDiv = document.createElement('div');
        menuDiv.style.cssText = 'position:fixed;z-index:9999;background:white;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.2);padding:8px;min-width:160px;font-size:13px;';
        menuDiv.style.left = (e.originalEvent.clientX) + 'px';
        menuDiv.style.top = (e.originalEvent.clientY) + 'px';
        
        menuDiv.innerHTML = `
            <div style="padding:6px 12px;color:#666;font-size:11px;border-bottom:1px solid #eee;margin-bottom:4px;">
                分段線 ${Math.round(divider ? divider.distance : 0)}m
            </div>
            <div id="_dm_node" style="padding:8px 12px;cursor:pointer;border-radius:4px;display:flex;align-items:center;gap:8px;" 
                 onmouseover="this.style.background='#f0f4ff'" onmouseout="this.style.background=''">
                📍 ${currentNode ? '修改節點：' + currentNode : '設為節點'}
            </div>
            <div id="_dm_del" style="padding:8px 12px;cursor:pointer;border-radius:4px;color:#e53935;display:flex;align-items:center;gap:8px;"
                 onmouseover="this.style.background='#fff5f5'" onmouseout="this.style.background=''">
                🗑️ 刪除分段線
            </div>
        `;
        document.body.appendChild(menuDiv);
        
        const removeMenu = () => { if (menuDiv.parentNode) menuDiv.remove(); };
        document.addEventListener('click', removeMenu, { once: true });
        
        menuDiv.querySelector('#_dm_node').addEventListener('click', async () => {
            removeMenu();
            const nodeName = prompt('輸入節點名稱（如：節點1）：', currentNode);
            if (nodeName !== null) {
                const dividerObj = segmentDividers.find(d => d.marker === marker);
                if (dividerObj) {
                    dividerObj.nodeLabel = nodeName.trim();
                    // 更新圖示
                    const hasNode = nodeName.trim() !== '';
                    marker.setIcon(L.divIcon({
                        className: 'segment-divider-marker',
                        html: `<div style="position:relative;text-align:center;">
                            <div style="font-size:18px;">${hasNode ? '📍' : '✂️'}</div>
                            <div class="segment-divider-label">${Math.round(dividerObj.distance)}m</div>
                            ${hasNode ? `<div style="font-size:9px;color:#3f51b5;font-weight:bold;white-space:nowrap;">${nodeName.trim()}</div>` : ''}
                        </div>`,
                        iconSize: [40, 40],
                        iconAnchor: [20, 20]
                    }));
                    updateVisualSegmentationPanel();
                }
            }
        });
        
        menuDiv.querySelector('#_dm_del').addEventListener('click', async () => {
            removeMenu();
            if (await showConfirm({ title: '刪除分段線', message: '確定要刪除這條分段線嗎？', okText: '刪除', danger: true })) {
                map.removeLayer(marker);
                const index = segmentDividers.findIndex(d => d.marker === marker);
                if (index !== -1) segmentDividers.splice(index, 1);
                updateVisualSegmentationPanel();
            }
        });
    });
    
    // 儲存分段線
    segmentDividers.push({ distance, marker });
    
    // 更新視覺化面板
    updateVisualSegmentationPanel();
    
    console.log(`✅ 新增分段線：${Math.round(distance)}m`);
}

// 切換段落管理面板
function toggleSegmentPanel() {
    const panel = document.getElementById('segmentPanel');
    const overlay = document.getElementById('overlay');
    
    if (!currentPipeline) {
        showToast('請先選擇一個工程', 'warning');
        return;
    }
    
    if (panel.style.display === 'flex') {
        panel.style.display = 'none';
        overlay.style.display = 'none';
        // 如果在視覺化分段模式，退出
        if (visualSegmentationMode) {
            visualSegmentationMode = false;
            const btn = document.querySelector('.btn-visual-segment');
            if (btn) {
                btn.classList.remove('active');
                btn.textContent = '🎯 視覺化分段';
            }
            exitVisualSegmentationMode();
        }
    } else {
        loadSegmentData();
        panel.style.display = 'flex';
        panel.classList.remove('minimized'); // 確保展開
        overlay.style.display = 'none'; // 不顯示遮罩，讓地圖可操作
    }
}

// 切換最小化
function toggleSegmentPanelMinimize() {
    const panel = document.getElementById('segmentPanel');
    panel.classList.toggle('minimized');
}

// 載入段落資料
async function loadSegmentData() {
    try {
        const result = await apiCall('getSegments', { pipelineId: currentPipeline.id });
        
        if (result.success) {
            currentSegments = result.segments || [];
            
            // 🆕 解析備註中的分支編號
            currentSegments.forEach(seg => {
                if (seg.notes && seg.notes.includes('branchIndex:')) {
                    const match = seg.notes.match(/branchIndex:(\d+)/);
                    if (match) {
                        seg.branchIndex = parseInt(match[1]);
                    }
                }
            });
            
            renderSegmentTable();
            updateSegmentInfo();
        } else {
            showToast('載入段落失敗：' + result.error, 'error');
        }
    } catch (error) {
        console.error('載入段落錯誤:', error);
        showToast('載入段落失敗：' + error.message, 'error');
    }
}

// 更新工程資訊顯示
function updateSegmentInfo() {
    const infoDiv = document.getElementById('segmentPipelineInfo');
    
    // 計算管線總長度（從 LINESTRING）
    const totalLength = currentPipeline.length || 0;
    
    // 計算已分配的段落總長度
    let allocatedLength = 0;
    currentSegments.forEach(seg => {
        allocatedLength += (parseFloat(seg.endDistance) - parseFloat(seg.startDistance));
    });
    allocatedLength = Math.round(allocatedLength);
    
    const remaining = totalLength - allocatedLength;
    
    infoDiv.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
                <strong style="color:#667eea;font-size:14px;">${currentPipeline.id}</strong>
                <div style="color:#666;font-size:12px;margin-top:3px;">管線總長度：${totalLength}m</div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:12px;color:#666;">已分配：${allocatedLength}m</div>
                <div style="font-size:13px;font-weight:bold;color:${remaining > 0 ? '#f44336' : '#4CAF50'};margin-top:2px;">
                    剩餘：${remaining}m
                </div>
            </div>
        </div>
    `;
}

// 渲染段落表格
function renderSegmentTable() {
    const tbody = document.getElementById('segmentTableBody');
    tbody.innerHTML = '';
    
    if (currentSegments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="padding:30px;color:#999;font-size:12px;">尚無段落資料</td></tr>';
        return;
    }
    
    // 🆕 檢查是否為 MULTILINESTRING
    const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
    
    // 🆕 如果是 MULTILINESTRING，修改表頭
    const table = document.querySelector('.segment-table');
    if (isMULTI) {
        table.querySelector('thead tr').innerHTML = `
            <th style="width:60px;">分支</th>
            <th style="width:40px;">段落</th>
            <th style="width:55px;">起始(m)</th>
            <th style="width:55px;">結束(m)</th>
            <th style="width:50px;">長度</th>
            <th style="width:45px;">管徑</th>
            <th style="width:45px;">管種</th>
            <th style="width:55px;">方式</th>
            <th style="width:70px;">操作</th>
        `;
    } else {
        table.querySelector('thead tr').innerHTML = `
            <th style="width:45px;">段落</th>
            <th style="width:60px;">起始(m)</th>
            <th style="width:60px;">結束(m)</th>
            <th style="width:55px;">長度</th>
            <th style="width:50px;">管徑</th>
            <th style="width:50px;">管種</th>
            <th style="width:60px;">方式</th>
            <th style="width:70px;">操作</th>
        `;
    }
    
    // 按段落編號排序
    currentSegments.sort((a, b) => {
        // 🆕 如果有 branchIndex，先按分支排序
        if (a.branchIndex !== undefined && b.branchIndex !== undefined) {
            if (a.branchIndex !== b.branchIndex) {
                return a.branchIndex - b.branchIndex;
            }
        }
        // 再按段落編號排序
        const aNum = typeof a.segmentNumber === 'string' ? parseInt(a.segmentNumber.split('-')[1]) : a.segmentNumber;
        const bNum = typeof b.segmentNumber === 'string' ? parseInt(b.segmentNumber.split('-')[1]) : b.segmentNumber;
        return aNum - bNum;
    });
    
    currentSegments.forEach(seg => {
        const length = parseFloat(seg.endDistance) - parseFloat(seg.startDistance);
        const row = document.createElement('tr');
        
        // 🆕 解析分支資訊
        let branchLabel = '';
        let segmentLabel = seg.segmentNumber;
        
        if (isMULTI && seg.branchIndex !== undefined) {
            const branchIndex = seg.branchIndex;
            branchLabel = branchIndex === 0 ? '主幹' : `分支${branchIndex}`;
            
            // 從段落編號中提取純數字
            if (typeof seg.segmentNumber === 'string' && seg.segmentNumber.includes('-')) {
                segmentLabel = seg.segmentNumber.split('-')[1];
            }
            
            const branchColor = branchIndex === 0 ? '#e74c3c' : '#9C27B0';
            
            row.innerHTML = `
                <td style="font-weight:bold;color:${branchColor};">${escapeHtml(branchLabel)}</td>
                <td style="font-weight:bold;">#${escapeHtml(segmentLabel)}</td>
                <td>${Math.round(seg.startDistance)}</td>
                <td>${Math.round(seg.endDistance)}</td>
                <td style="font-weight:600;color:#667eea;">${Math.round(length)}</td>
                <td>${escapeHtml(seg.diameter || '-')}</td>
                <td>${escapeHtml(seg.pipeType || '-')}</td>
                <td style="font-size:10px;">${escapeHtml(seg.method || '-')}</td>
                <td style="white-space:nowrap;">
                    <button class="btn-edit-segment" onclick="editSegmentForm('${escapeHtml(seg.segmentNumber)}')">編輯</button>
                    <button class="btn-delete-segment" onclick="deleteSegmentConfirm('${escapeHtml(seg.segmentNumber)}')">刪除</button>
                </td>
            `;
        } else {
            // 普通 LINESTRING
            row.innerHTML = `
                <td style="font-weight:bold;">#${escapeHtml(seg.segmentNumber)}</td>
                <td>${Math.round(seg.startDistance)}</td>
                <td>${Math.round(seg.endDistance)}</td>
                <td style="font-weight:600;color:#667eea;">${Math.round(length)}</td>
                <td>${escapeHtml(seg.diameter || '-')}</td>
                <td>${escapeHtml(seg.pipeType || '-')}</td>
                <td style="font-size:10px;">${escapeHtml(seg.method || '-')}</td>
                <td style="white-space:nowrap;">
                    <button class="btn-edit-segment" onclick="editSegmentForm('${escapeHtml(seg.segmentNumber)}')">編輯</button>
                    <button class="btn-delete-segment" onclick="deleteSegmentConfirm('${escapeHtml(seg.segmentNumber)}')">刪除</button>
                </td>
            `;
        }
        
        tbody.appendChild(row);
    });
}

// 顯示新增段落表單
function showAddSegmentForm() {
    const totalLength = currentPipeline.length || 0;
    
    // 計算已分配的長度
    let allocatedLength = 0;
    currentSegments.forEach(seg => {
        allocatedLength += (parseFloat(seg.endDistance) - parseFloat(seg.startDistance));
    });
    
    // 建議起始距離為最後一個段落的結束距離（取整數）
    let suggestedStart = 0;
    if (currentSegments.length > 0) {
        const lastSeg = currentSegments.reduce((max, seg) => 
            parseFloat(seg.endDistance) > parseFloat(max.endDistance) ? seg : max
        );
        suggestedStart = Math.round(parseFloat(lastSeg.endDistance));
    }
    
    const formHTML = `
        <div style="background:white;padding:20px;border-radius:6px;width:320px;box-shadow:0 4px 20px rgba(0,0,0,0.15);">
            <div style="font-size:16px;font-weight:600;margin-bottom:15px;color:#333;">新增段落</div>
            
            <div style="font-size:11px;color:#666;margin-bottom:15px;padding:8px;background:#f8f9fa;border-radius:4px;">
                總長 ${Math.round(totalLength)}m · 已分配 ${Math.round(allocatedLength)}m · 剩餘 ${Math.round(totalLength - allocatedLength)}m
            </div>
            
            <div style="margin-bottom:12px;">
                <input type="number" id="segStartDist" value="${suggestedStart}" step="1" placeholder="起始距離(m)" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;">
            </div>
            
            <div style="margin-bottom:12px;">
                <input type="number" id="segEndDist" value="${Math.round(totalLength)}" step="1" placeholder="結束距離(m)" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;">
            </div>
            
            <div style="margin-bottom:12px;">
                <input type="text" id="segDiameter" value="2200" placeholder="管徑" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;">
            </div>
            
            <div style="margin-bottom:12px;">
                <select id="segPipeType" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;background:white;">
                    <option value="DIP">DIP</option>
                    <option value="PVC">PVC</option>
                    <option value="HDPE">HDPE</option>
                    <option value="鋼管">鋼管</option>
                </select>
            </div>
            
            <div style="margin-bottom:15px;">
                <select id="segMethod" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;background:white;">
                    <option value="埋設">埋設</option>
                    <option value="推進">推進</option>
                    <option value="潛鑽">潛鑽</option>
                    <option value="潛盾">潛盾</option>
                    <option value="水管橋">水管橋</option>
                    <option value="隧道">隧道</option>
                    <option value="其他">其他</option>
                </select>
            </div>
            
            <div style="margin-bottom:15px;">
                <input type="text" id="segNodeRange" placeholder="節點區間（如：節點1-2）" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;">
            </div>
            
            <div style="display:flex;gap:10px;">
                <button onclick="confirmAddSegment()" style="flex:1;padding:10px;background:#667eea;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;font-weight:500;">儲存</button>
                <button onclick="closeCustomDialog()" style="flex:1;padding:10px;background:#f5f5f5;color:#666;border:none;border-radius:4px;cursor:pointer;font-size:14px;">取消</button>
            </div>
        </div>
    `;
    
    showCustomDialog(formHTML);
}

// 確認新增段落
async function confirmAddSegment() {
    if (!requireSupervisor()) return;
    const startDist = parseFloat(document.getElementById('segStartDist').value);
    const endDist = parseFloat(document.getElementById('segEndDist').value);
    const diameter = document.getElementById('segDiameter').value.trim();
    const pipeType = document.getElementById('segPipeType').value;
    const method = document.getElementById('segMethod').value;
    const nodeRange = (document.getElementById('segNodeRange') ? document.getElementById('segNodeRange').value.trim() : '');
    const notes = buildNotes(nodeRange, null);
    
    // 驗證
    if (isNaN(startDist) || isNaN(endDist)) {
        showToast('請輸入有效的距離', 'error');
        return;
    }
    
    if (startDist >= endDist) {
        showToast('結束距離必須大於起始距離', 'error');
        return;
    }
    
    if (endDist > currentPipeline.length) {
        if (!await showConfirm({ title: '距離超出範圍', message: `結束距離 ${endDist}m 超過管線總長度 ${currentPipeline.length}m，是否繼續？`, okText: '繼續', icon: '⚠️' })) {
            return;
        }
    }
    
    // 檢查是否與現有段落重疊
    const overlapping = currentSegments.some(seg => {
        const segStart = parseFloat(seg.startDistance);
        const segEnd = parseFloat(seg.endDistance);
        return (startDist < segEnd && endDist > segStart);
    });
    
    if (overlapping) {
        if (!await showConfirm({ title: '段落重疊警告', message: '此段落與現有段落有重疊，是否繼續？', okText: '繼續', icon: '⚠️' })) {
            return;
        }
    }
    
    // 計算下一個段落編號
    let nextSegNum = 1;
    if (currentSegments.length > 0) {
        const maxNum = Math.max(...currentSegments.map(s => parseInt(s.segmentNumber)));
        nextSegNum = maxNum + 1;
    }
    
    try {
        const result = await apiCall('addSegment', { pipelineId: currentPipeline.id, segmentNumber: nextSegNum, startDistance: startDist, endDistance: endDist, diameter: diameter, pipeType: pipeType, method: method, notes: notes });
        
        if (result.success) {
            closeCustomDialog();
            showToast(`段落新增成功！\n\n段落 #${nextSegNum}\n長度：${Math.round(endDist - startDist)}m\n小段數量：${result.smallSegments}個`, 'success');
            loadSegmentData();
        } else {
            showToast('新增失敗：' + result.error, 'error');
        }
    } catch (error) {
        console.error('新增段落錯誤:', error);
        showToast('新增失敗：' + error.message, 'error');
    }
}

// 編輯段落表單
function editSegmentForm(segmentNumber) {
    const segment = currentSegments.find(s => s.segmentNumber == segmentNumber);
    if (!segment) {
        showToast('找不到段落', 'error');
        return;
    }
    
    const formHTML = `
        <div style="background:white;padding:20px;border-radius:6px;width:320px;box-shadow:0 4px 20px rgba(0,0,0,0.15);">
            <div style="font-size:16px;font-weight:600;margin-bottom:15px;color:#333;">編輯段落 #${segmentNumber}</div>
            
            <div style="margin-bottom:12px;">
                <input type="number" id="editStartDist" value="${Math.round(segment.startDistance)}" step="1" placeholder="起始距離(m)" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;">
            </div>
            
            <div style="margin-bottom:12px;">
                <input type="number" id="editEndDist" value="${Math.round(segment.endDistance)}" step="1" placeholder="結束距離(m)" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;">
            </div>
            
            <div style="margin-bottom:12px;">
                <input type="text" id="editDiameter" value="${segment.diameter || ''}" placeholder="管徑" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;">
            </div>
            
            <div style="margin-bottom:12px;">
                <select id="editPipeType" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;background:white;">
                    <option value="DIP" ${segment.pipeType === 'DIP' ? 'selected' : ''}>DIP</option>
                    <option value="PVC" ${segment.pipeType === 'PVC' ? 'selected' : ''}>PVC</option>
                    <option value="HDPE" ${segment.pipeType === 'HDPE' ? 'selected' : ''}>HDPE</option>
                    <option value="鋼管" ${segment.pipeType === '鋼管' ? 'selected' : ''}>鋼管</option>
                </select>
            </div>
            
            <div style="margin-bottom:15px;">
                <select id="editMethod" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;background:white;">
                    <option value="埋設" ${segment.method === '埋設' ? 'selected' : ''}>埋設</option>
                    <option value="推進" ${segment.method === '推進' ? 'selected' : ''}>推進</option>
                    <option value="潛鑽" ${segment.method === '潛鑽' ? 'selected' : ''}>潛鑽</option>
                    <option value="潛盾" ${segment.method === '潛盾' ? 'selected' : ''}>潛盾</option>
                    <option value="水管橋" ${segment.method === '水管橋' ? 'selected' : ''}>水管橋</option>
                    <option value="隧道" ${segment.method === '隧道' ? 'selected' : ''}>隧道</option>
                    <option value="其他" ${segment.method === '其他' ? 'selected' : ''}>其他</option>
                </select>
            </div>
            
            <div style="margin-bottom:15px;">
                <input type="text" id="editNodeRange" value="${segment.nodeRange || ''}" placeholder="節點區間（如：節點1-2）" style="width:100%;padding:10px;border:1px solid #e0e0e0;border-radius:4px;font-size:14px;">
            </div>
            
            <div style="display:flex;gap:10px;">
                <button onclick="confirmEditSegment('${segmentNumber}')" style="flex:1;padding:10px;background:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;font-weight:500;">儲存</button>
                <button onclick="closeCustomDialog()" style="flex:1;padding:10px;background:#f5f5f5;color:#666;border:none;border-radius:4px;cursor:pointer;font-size:14px;">取消</button>
            </div>
        </div>
    `;
    
    showCustomDialog(formHTML);
}

// 確認編輯段落
async function confirmEditSegment(segmentNumber) {
    if (!requireSupervisor()) return;
    const startDist = parseFloat(document.getElementById('editStartDist').value);
    const endDist = parseFloat(document.getElementById('editEndDist').value);
    const diameter = document.getElementById('editDiameter').value.trim();
    const pipeType = document.getElementById('editPipeType').value;
    const method = document.getElementById('editMethod').value;
    const nodeRange = document.getElementById('editNodeRange') ? document.getElementById('editNodeRange').value.trim() : '';
    // 取得原本的 branchIndex（保留不動）
    const seg = currentPipeline.segments.find(s => String(s.segmentNumber) === String(segmentNumber));
    const branchIdx = seg ? seg.branchIndex : undefined;
    const notes = buildNotes(nodeRange, branchIdx);
    
    // 驗證
    if (isNaN(startDist) || isNaN(endDist)) {
        showToast('請輸入有效的距離', 'error');
        return;
    }
    
    if (startDist >= endDist) {
        showToast('結束距離必須大於起始距離', 'error');
        return;
    }
    
    try {
        const result = await apiCall('updateSegment', { pipelineId: currentPipeline.id, segmentNumber: segmentNumber, startDistance: Math.round(startDist), endDistance: Math.round(endDist), diameter: diameter, pipeType: pipeType, method: method, notes: notes });
        
        if (result.success) {
            closeCustomDialog();
            
            console.log('✅ 段落更新成功，開始重新載入資料...');
            
            // 🔧 重新載入段落資料
            const progressData = await apiCall('getProgress', { pipelineId: currentPipeline.id });
            if (progressData.segments) {
                const pipelineIndex = allPipelines.findIndex(p => p.id === currentPipeline.id);
                if (pipelineIndex !== -1) allPipelines[pipelineIndex].segments = parseBranchIndexFromSegments(progressData.segments);
                currentPipeline.segments = progressData.segments;
                currentSegments = parseBranchIndexFromSegments(progressData.segments);
            }
            showPipelineDetail(currentPipeline.id, true);
            setTimeout(() => { showStatsPanel(); }, 50);
            renderSegmentTable();
            updateSegmentInfo();
            
            showToast('段落更新成功！', 'success');
        } else {
            showToast('更新失敗：' + result.error, 'error');
        }
    } catch (error) {
        console.error('更新段落錯誤:', error);
        showToast('更新失敗：' + error.message, 'error');
    }
}

// 刪除段落確認
async function deleteSegmentConfirm(segmentNumber) {
    const segment = currentSegments.find(s => s.segmentNumber == segmentNumber);
    if (!segment) {
        showToast('找不到段落', 'error');
        return;
    }
    
    const start = Math.round(parseFloat(segment.startDistance));
    const end = Math.round(parseFloat(segment.endDistance));
    const length = end - start;
    
    if (await showConfirm({ title: `刪除段落 #${segmentNumber}`, message: `起始：${start}m　結束：${end}m　長度：${length}m\n此操作無法復原！`, okText: '刪除', danger: true })) {
        deleteSegment(segmentNumber);
    }
}

// 刪除段落
async function deleteSegment(segmentNumber) {
    if (!requireSupervisor()) return;
    try {
        const result = await apiCall('deleteSegment', {
            pipelineId: currentPipeline.id, segmentNumber: segmentNumber
        });
        
        if (result.success) {
            console.log('✅ 段落刪除成功，開始重新載入資料...');
            
            // 🔧 重新載入段落資料
            const progressData = await apiCall('getProgress', { pipelineId: currentPipeline.id });
            if (progressData.segments) {
                const pipelineIndex = allPipelines.findIndex(p => p.id === currentPipeline.id);
                if (pipelineIndex !== -1) allPipelines[pipelineIndex].segments = parseBranchIndexFromSegments(progressData.segments);
                currentPipeline.segments = progressData.segments;
                currentSegments = parseBranchIndexFromSegments(progressData.segments);
            }
            showPipelineDetail(currentPipeline.id, true);
            setTimeout(() => { showStatsPanel(); }, 50);
            renderSegmentTable();
            updateSegmentInfo();
            
            showToast('段落刪除成功！', 'success');
        } else {
            showToast('刪除失敗：' + result.error, 'error');
        }
    } catch (error) {
        console.error('刪除段落錯誤:', error);
        showToast('刪除失敗：' + error.message, 'error');
    }
}

// 顯示自訂對話框
function showCustomDialog(html) {
    const overlay = document.getElementById('overlay');
    const container = document.createElement('div');
    container.id = 'customDialog';
    container.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;';
    container.innerHTML = html;
    
    document.body.appendChild(container);
    overlay.style.display = 'block';
    overlay.style.zIndex = '9998'; // 確保遮罩在對話框下方
}

// 關閉自訂對話框
function closeCustomDialog() {
    const dialog = document.getElementById('customDialog');
    if (dialog) {
        dialog.remove();
    }
    const overlay = document.getElementById('overlay');
    overlay.style.display = 'none';
    overlay.style.zIndex = '1500'; // 恢復原本的 z-index
}

// ==================== 視覺化分段輔助函數 ====================

// 找到點擊位置在管線上最近的點，並返回距離
function findNearestPointOnLine(clickPoint, lineCoords) {
    let minDist = Infinity;
    let bestDistance = null;
    let accumulatedDistance = 0;
    
    for (let i = 0; i < lineCoords.length - 1; i++) {
        const p1 = lineCoords[i];
        const p2 = lineCoords[i + 1];
        
        // 計算點到線段的最短距離
        const result = pointToSegmentDistance(clickPoint, p1, p2);
        
        if (result.distance < minDist) {
            minDist = result.distance;
            // 計算到該點的累積距離
            const segmentLength = getDistance(p1, p2);
            bestDistance = accumulatedDistance + (segmentLength * result.t);
        }
        
        accumulatedDistance += getDistance(p1, p2);
    }
    
    // 只接受距離管線 50m 以內的點擊
    if (minDist > 50) {
        return null;
    }
    
    return bestDistance;
}

// 計算點到線段的最短距離
function pointToSegmentDistance(point, segStart, segEnd) {
    const [px, py] = point;
    const [x1, y1] = segStart;
    const [x2, y2] = segEnd;
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    
    let t = 0;
    if (lengthSquared > 0) {
        t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    }
    
    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;
    
    const distX = px - closestX;
    const distY = py - closestY;
    const distance = Math.sqrt(distX * distX + distY * distY) * 111000; // 轉換為公尺
    
    return { distance, t };
}

// 根據距離取得管線上的座標位置
function getPositionAtDistance(lineCoords, targetDistance) {
    let accumulatedDistance = 0;
    
    for (let i = 0; i < lineCoords.length - 1; i++) {
        const p1 = lineCoords[i];
        const p2 = lineCoords[i + 1];
        const segmentLength = getDistance(p1, p2);
        
        if (accumulatedDistance + segmentLength >= targetDistance) {
            // 目標距離在這個線段上
            const remainingDistance = targetDistance - accumulatedDistance;
            const t = remainingDistance / segmentLength;
            
            const lat = p1[0] + (p2[0] - p1[0]) * t;
            const lng = p1[1] + (p2[1] - p1[1]) * t;
            
            return [lat, lng];
        }
        
        accumulatedDistance += segmentLength;
    }
    
    // 如果超出範圍，返回終點
    return lineCoords[lineCoords.length - 1];
}

// 顯示視覺化分段操作面板
function showVisualSegmentationPanel(adjustmentMode = false) {
    const tbody = document.getElementById('segmentTableBody');
    
    const instructions = `
        <div>✂️ <strong>點擊地圖</strong>新增分段線</div>
        <div>🖱️ <strong>拖拉分段線</strong>調整位置</div>
        <div>🗑️ <strong>右鍵分段線</strong>可刪除或設為節點</div>
    `;
    
    tbody.innerHTML = `
        <tr>
            <td colspan="8" style="padding:30px;">
                <div style="text-align:center;">
                    <div style="font-size:48px;margin-bottom:15px;">🎯</div>
                    <div style="font-size:16px;font-weight:bold;color:#667eea;margin-bottom:10px;">視覺化分段模式</div>
                    <div style="font-size:13px;color:#666;line-height:1.8;">
                        ${instructions}
                        <div style="margin-top:15px;padding:12px;background:#f0f4ff;border-radius:6px;">
                            <div id="dividerCount" style="font-weight:bold;color:#667eea;">目前分段線：0 條</div>
                            <div id="segmentPreview" style="margin-top:8px;color:#999;">尚未新增分段線</div>
                        </div>
                    </div>
                </div>
            </td>
        </tr>
    `;
    
    // 修改表格顯示方式
    document.querySelector('.segment-table').style.display = 'table';
}

// 隱藏視覺化分段操作面板
function hideVisualSegmentationPanel() {
    // 恢復段落表格
    renderSegmentTable();
}

// 更新視覺化分段面板資訊
function updateVisualSegmentationPanel() {
    const dividerCountEl = document.getElementById('dividerCount');
    const segmentPreviewEl = document.getElementById('segmentPreview');
    
    if (!dividerCountEl || !segmentPreviewEl) return;
    
    // 排序分段線
    const sortedDividers = [...segmentDividers].sort((a, b) => a.distance - b.distance);
    
    dividerCountEl.textContent = `目前分段線：${sortedDividers.length} 條`;
    
    if (sortedDividers.length === 0) {
        segmentPreviewEl.innerHTML = '<span style="color:#999;">尚未新增分段線</span>';
        return;
    }
    
    // 🔧 使用已儲存的分支長度
    const totalLength = currentBranchLength || currentPipeline.length;
    
    // 計算預覽段落
    const segments = [];
    let prevDistance = 0;
    
    sortedDividers.forEach((divider, index) => {
        segments.push({
            num: index + 1,
            start: prevDistance,
            end: divider.distance,
            length: divider.distance - prevDistance
        });
        prevDistance = divider.distance;
    });
    
    // 最後一段：使用分支長度
    segments.push({
        num: sortedDividers.length + 1,
        start: prevDistance,
        end: totalLength,
        length: totalLength - prevDistance
    });
    
    // 顯示預覽
    const preview = segments.map(seg => {
        const divBefore = sortedDividers[seg.num - 2]; // 前面那條分段線
        const divAfter = sortedDividers[seg.num - 1];  // 後面那條分段線
        const startNode = divBefore ? (divBefore.nodeLabel || '') : '';
        const endNode = divAfter ? (divAfter.nodeLabel || '') : '';
        const nodeStr = (startNode || endNode) ? ` [${startNode || '起'} → ${endNode || '終'}]` : '';
        return `段落${seg.num}：${Math.round(seg.start)}-${Math.round(seg.end)}m (${Math.round(seg.length)}m)${nodeStr}`;
    }).join('<br>');
    
    segmentPreviewEl.innerHTML = preview;
}

// 顯示視覺化分段引導
function showVisualSegmentationGuide() {
    // 在地圖中央顯示提示
    const center = map.getCenter();
    L.popup()
        .setLatLng(center)
        .setContent(`
            <div style="text-align:center;padding:10px;">
                <div style="font-size:32px;margin-bottom:10px;">🎯</div>
                <div style="font-weight:bold;margin-bottom:8px;">視覺化分段模式</div>
                <div style="font-size:12px;color:#666;line-height:1.6;">
                    點擊管線新增分段線
                </div>
            </div>
        `)
        .openOn(map);
}

// 根據分段線建立段落
async function createSegmentsFromDividers() {
    if (!requireSupervisor()) return;
    if (segmentDividers.length === 0) {
        showToast('沒有分段線，無法建立段落', 'warning');
        return;
    }
    
    // 排序分段線
    const sortedDividers = [...segmentDividers].sort((a, b) => a.distance - b.distance);
    
    // 🔧 使用已儲存的分支長度
    const branchLength = currentBranchLength || currentPipeline.length;
    
    console.log(`📏 分支總長度: ${branchLength}m (使用 currentBranchLength)`);
    
    // 計算段落
    const segments = [];
    let prevDistance = 0;
    
    sortedDividers.forEach((divider, idx) => {
        // 每段的節點：前一條分段線 nodeLabel 到這條分段線 nodeLabel
        const prevDivider = idx > 0 ? sortedDividers[idx-1] : null;
        segments.push({
            start: prevDistance,
            end: divider.distance,
            startNode: prevDivider ? (prevDivider.nodeLabel || '') : '',
            endNode: divider.nodeLabel || ''
        });
        prevDistance = divider.distance;
    });
    
    // 🆕 最後一段：使用分支長度
    const lastDivider = sortedDividers[sortedDividers.length - 1];
    segments.push({
        start: prevDistance,
        end: branchLength,
        startNode: lastDivider ? (lastDivider.nodeLabel || '') : '',
        endNode: ''
    });
    
    // 顯示段落設定表單
    showBatchSegmentForm(segments);
}

// 批次段落設定表單
function showBatchSegmentForm(segments) {
    let formHTML = `
        <div style="background:white;padding:20px;border-radius:6px;width:400px;max-height:85vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.15);">
            <div style="font-size:16px;font-weight:600;margin-bottom:10px;color:#333;">批次設定 (${segments.length}段)</div>
    `;
    
    segments.forEach((seg, index) => {
        const length = Math.round(seg.end - seg.start);
        formHTML += `
            <div style="border:1px solid #e0e0e0;border-radius:4px;padding:12px;margin-bottom:10px;background:#fafafa;">
                <div style="font-weight:600;color:#667eea;margin-bottom:8px;font-size:13px;">
                    #${index + 1} · ${Math.round(seg.start)}-${Math.round(seg.end)}m (${length}m)
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <input type="text" id="seg${index}_diameter" value="2200" placeholder="管徑" style="padding:8px;border:1px solid #e0e0e0;border-radius:4px;font-size:13px;">
                    <select id="seg${index}_pipeType" style="padding:8px;border:1px solid #e0e0e0;border-radius:4px;font-size:13px;background:white;">
                        <option value="DIP">DIP</option>
                        <option value="PVC">PVC</option>
                        <option value="HDPE">HDPE</option>
                        <option value="鋼管">鋼管</option>
                    </select>
                </div>
                <select id="seg${index}_method" style="width:100%;padding:8px;border:1px solid #e0e0e0;border-radius:4px;font-size:13px;margin-top:8px;background:white;">
                    <option value="埋設">埋設</option>
                    <option value="推進">推進</option>
                    <option value="潛鑽">潛鑽</option>
                    <option value="潛盾">潛盾</option>
                    <option value="水管橋">水管橋</option>
                    <option value="隧道">隧道</option>
                    <option value="其他">其他</option>
                </select>
            </div>
        `;
    });
    
    formHTML += `
            <div style="display:flex;gap:10px;margin-top:15px;position:sticky;bottom:0;background:white;padding-top:10px;">
                <button onclick="confirmBatchSegments(${JSON.stringify(segments).replace(/"/g, '&quot;')})" style="flex:1;padding:10px;background:#667eea;color:white;border:none;border-radius:4px;cursor:pointer;font-size:14px;font-weight:500;">建立全部</button>
                <button onclick="closeCustomDialog()" style="flex:1;padding:10px;background:#f5f5f5;color:#666;border:none;border-radius:4px;cursor:pointer;font-size:14px;">取消</button>
            </div>
        </div>
    `;
    
    showCustomDialog(formHTML);
}

// 確認批次建立段落
window.confirmBatchSegments = async function(segments) {
    console.log('📋 批次建立段落:', segments);
    
    // 🆕 檢查是否為 MULTILINESTRING 模式
    const isMULTI = branchDataForSegmentation !== null;
    const branchIndex = isMULTI ? currentBranchForSegmentation : undefined;
    
    if (isMULTI) {
        console.log('🌿 MULTILINESTRING 模式，分支索引:', branchIndex);
    }
    
    // 檢查是否有現有段落
    if (currentSegments.length > 0) {
        console.log('📋 目前段落列表:', currentSegments.map(s => ({
            segNum: s.segmentNumber,
            branchIdx: s.branchIndex,
            start: s.startDistance,
            end: s.endDistance
        })));
        
        // MULTILINESTRING：只刪該分支；LINESTRING：刪全部
        // 用寬鬆比對（== 而非 ===）避免型別不同造成比對失敗
        const segmentsToDelete = isMULTI 
            ? currentSegments.filter(s => {
                const sIdx = s.branchIndex !== undefined ? s.branchIndex : 
                    (s.notes && s.notes.match(/branchIndex:(\d+)/) ? parseInt(s.notes.match(/branchIndex:(\d+)/)[1]) : -1);
                return sIdx == branchIndex;
            })
            : currentSegments;
        
        console.log(`🔍 找到 ${segmentsToDelete.length} 個需要刪除的段落:`, segmentsToDelete.map(s => s.segmentNumber));
        
        if (segmentsToDelete.length > 0) {
            if (!await showConfirm({ title: '批次重建段落', message: `目前已有 ${segmentsToDelete.length} 個段落，批次建立會刪除後重新建立，確定要繼續嗎？`, okText: '確認重建', danger: true })) {
                return;
            }
            
            // 刪除段落
            console.log(`🗑️ 開始刪除 ${segmentsToDelete.length} 個現有段落...`);
            for (const seg of segmentsToDelete) {
                try {
                    const result = await apiCall('deleteSegment', { pipelineId: currentPipeline.id, segmentNumber: seg.segmentNumber });
                    
                    if (result.success) {
                        console.log(`   ✅ 成功刪除段落 ${seg.segmentNumber}`);
                    } else {
                        console.error(`   ❌ 刪除段落 ${seg.segmentNumber} 失敗:`, result.error);
                    }
                } catch (error) {
                    console.error(`   ❌ 刪除段落 ${seg.segmentNumber} 錯誤:`, error);
                }
            }
            
            // 從列表中移除
            if (isMULTI) {
                const beforeCount = currentSegments.length;
                currentSegments = currentSegments.filter(s => s.branchIndex !== branchIndex);
                console.log(`🗑️ 前端列表清理: ${beforeCount} → ${currentSegments.length}`);
            } else {
                currentSegments = [];
                console.log(`🗑️ 前端列表清空`);
            }
        }
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const diameter = document.getElementById(`seg${i}_diameter`).value.trim();
        const pipeType = document.getElementById(`seg${i}_pipeType`).value;
        const method = document.getElementById(`seg${i}_method`).value;
        
        // 🆕 段落編號：如果是 MULTILINESTRING，格式為 "分支索引-段落號"
        const segmentNumber = isMULTI 
            ? `B${branchIndex}-${i + 1}`  // 例如：B0-1, B1-1, B2-1
            : (i + 1);
        
        // 組合節點區間和分支索引到 notes
        const nodeRange = (seg.startNode || seg.endNode) 
            ? ((seg.startNode || '') + (seg.startNode && seg.endNode ? '-' : '') + (seg.endNode || ''))
            : '';
        const notes = buildNotes(nodeRange, isMULTI ? branchIndex : null);
        
        console.log(`🔧 建立段落 ${i + 1}/${segments.length}:`);
        console.log(`   isMULTI: ${isMULTI}`);
        console.log(`   branchIndex: ${branchIndex} (type: ${typeof branchIndex})`);
        console.log(`   segmentNumber: ${segmentNumber}`);
        console.log(`   notes: "${notes}"`);
        
        try {
            const result = await apiCall('addSegment', { pipelineId: currentPipeline.id, segmentNumber: segmentNumber, startDistance: Math.round(seg.start), endDistance: Math.round(seg.end), diameter: diameter, pipeType: pipeType, method: method, notes: notes });
            
            if (result.success) {
                successCount++;
            } else {
                errorCount++;
                console.error(`段落 ${segmentNumber} 建立失敗:`, result.error);
            }
        } catch (error) {
            errorCount++;
            console.error(`段落 ${segmentNumber} 建立錯誤:`, error);
        }
    }
    
    closeCustomDialog();
    
    if (errorCount === 0) {
        showToast(`成功建立 ${successCount} 個段落！`, 'success');
    } else {
        showToast(`建立完成\n\n成功：${successCount} 個\n失敗：${errorCount} 個`, 'warning');
    }
    
    // 移除所有分段線標記
    segmentDividers.forEach(divider => {
        map.removeLayer(divider.marker);
    });
    segmentDividers = [];
    
    // 移除地圖點擊事件
    map.off('click', onMapClickAddDivider);
    
    // 退出視覺化分段模式並恢復按鈕
    visualSegmentationMode = false;
    const buttonsContainer = document.getElementById('segmentPanelButtons');
    if (buttonsContainer) {
        buttonsContainer.innerHTML = `
            <button onclick="toggleVisualSegmentation()" class="btn-visual-segment" style="width:100%;">🎯 視覺化分段</button>
        `;
    }
    
    // 🔧 重新載入段落資料，更新 allPipelines
    console.log('🔄 重新載入段落資料...');
    const progressData = await apiCall('getProgress', { pipelineId: currentPipeline.id });
    
    if (progressData.segments) {
        // 🆕 解析備註中的分支編號
        progressData.segments.forEach(seg => {
            if (seg.notes && seg.notes.includes('branchIndex:')) {
                const match = seg.notes.match(/branchIndex:(\d+)/);
                if (match) {
                    seg.branchIndex = parseInt(match[1]);
                    console.log(`   解析段落 ${seg.segmentNumber} 的 branchIndex: ${seg.branchIndex}`);
                }
            }
        });
        
        // 更新 allPipelines 中的段落資料
        const pipelineIndex = allPipelines.findIndex(p => p.id === currentPipeline.id);
        if (pipelineIndex !== -1) {
            allPipelines[pipelineIndex].segments = parseBranchIndexFromSegments(progressData.segments);
            console.log('✅ 已更新 allPipelines 中的段落資料');
        }
        
        // 更新 currentPipeline 的段落資料
        currentPipeline.segments = progressData.segments;
        console.log('✅ 已更新 currentPipeline 的段落資料');
        
        // 更新 currentSegments（用於段落管理面板）
        currentSegments = parseBranchIndexFromSegments(progressData.segments);
        console.log('✅ 已更新 currentSegments，段落數:', currentSegments.length);
        console.log('   段落詳情:', currentSegments.map(s => ({
            segNum: s.segmentNumber,
            branchIdx: s.branchIndex,
            start: s.startDistance,
            end: s.endDistance
        })));
    }
    
    // 立即重新渲染地圖（不需要延遲）
    console.log('🔄 重新渲染地圖...');
    showPipelineDetail(currentPipeline.id, true);
    
    // 重新載入統計面板
    showStatsPanel();
    
    // 更新段落表格
    renderSegmentTable();
    updateSegmentInfo();
};

console.log('管線施工進度管理系統 v3.5 - 段落管理版');
console.log('API URL:', API_URL);
console.log('請打開 F12 Console 查看載入狀態');
    

