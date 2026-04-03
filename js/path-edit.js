// ==================== 路徑編輯功能 ====================

// 切換編輯模式
function toggleEditMode() {
    if (!currentPipeline) {
        showToast('請先選擇一個工程', 'error');
        return;
    }
    
    if (isEditingPath) {
        cancelEditMode();
    } else {
        startEditMode();
    }
}

// 開始編輯模式
function startEditMode() {
    isEditingPath = true;
    
    // 更新按鈕狀態
    const btn = document.getElementById('editPathBtn');
    btn.classList.add('active');
    btn.textContent = '⏸️ 編輯中...';
    
    // 顯示工具列
    document.getElementById('editModeToolbar').classList.add('active');
    
    // 解析分支結構
    branchStructure = parseLineStringWithBranches(currentPipeline.linestring);
    
    console.log('🎨 進入編輯模式');
    console.log('   分支數:', branchStructure.branches.length);
    console.log('   交叉點:', branchStructure.junctionPoints.length);
    console.log('   格式:', branchStructure.isMULTI ? 'MULTILINESTRING' : 'LINESTRING');
    
    // 清除現有管線顯示
    allPolylines.forEach(layer => {
        if (layer instanceof L.Polyline) {
            map.removeLayer(layer);
        }
    });
    
    editingBranches = [];
    editingNodes = [];
    junctionMarkers = [];
    
    console.log('🎨 開始繪製分支:');
    
    // 繪製每個分支
    branchStructure.branches.forEach((branch, branchIndex) => {
        const isMain = !branch.isBranch;
        console.log(`   分支 ${branchIndex} (${isMain ? '主幹' : '分支'}): ${branch.coords.length} 個座標點`);
        
        const polyline = L.polyline(branch.coords, {
            color: isMain ? '#FF6B35' : '#9C27B0', // 主幹橙色，分支紫色
            weight: isMain ? 6 : 5,
            opacity: 0.8,
            className: isMain ? 'editing-polyline-main' : 'editing-polyline-branch'
        }).addTo(map);
        
        // 在管線上點擊新增節點
        polyline.on('click', function(e) {
            addNodeToBranch(e.latlng, branchIndex);
        });
        
        editingBranches.push({
            polyline: polyline,
            index: branchIndex,
            isMain: isMain
        });
        
        // 建立該分支的可拖曳節點
        branch.coords.forEach((coord, nodeIndex) => {
            createEditableNode(coord, branchIndex, nodeIndex);
        });
    });
    
    console.log(`✅ 分支繪製完成，共 ${editingNodes.length} 個節點`);
    
    // 顯示交叉點
    displayJunctionPoints();
}

// ========== MULTILINESTRING 分支編輯函數 ==========

/**
 * 建立單個可編輯節點
 * @param {Array} coord - [lat, lng] 座標
 * @param {Number} branchIndex - 分支索引
 * @param {Number} nodeIndex - 節點在該分支中的索引
 */
function createEditableNode(coord, branchIndex, nodeIndex) {
    // 檢查是否為交叉點
    const coordKey = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
    let junctionData = null;
    const isJunction = branchStructure.junctionPoints.some(jp => {
        const jpKey = `${jp.coord[0].toFixed(6)},${jp.coord[1].toFixed(6)}`;
        if (jpKey === coordKey) {
            junctionData = jp;
            return true;
        }
        return false;
    });
    
    // 檢查是否為分支起點（分支的第一個節點）
    const branch = branchStructure.branches[branchIndex];
    const isBranchStart = branch.isBranch && nodeIndex === 0;
    
    // 設定節點圖示
    let iconHtml, iconSize, className;
    if (isJunction) {
        // 交叉點：較大的黃色星星（現在可以拖曳！）
        iconHtml = '<div style="font-size:20px;">⭐</div>';
        iconSize = [24, 24];
        className = 'path-node-marker junction-marker';
    } else if (isBranchStart) {
        // 分支起點：綠色圓圈
        iconHtml = '<div style="background:#4CAF50;width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>';
        iconSize = [16, 16];
        className = 'path-node-marker branch-start-marker';
    } else {
        // 普通節點：白色圓圈
        iconHtml = '<div style="background:white;width:14px;height:14px;border-radius:50%;border:2px solid #333;box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>';
        iconSize = [14, 14];
        className = 'path-node-marker';
    }
    
    const marker = L.marker([coord[0], coord[1]], {
        draggable: true, // 🆕 所有節點都可以拖曳（包括交叉點）
        icon: L.divIcon({
            className: className,
            iconSize: iconSize,
            html: iconHtml
        })
    }).addTo(map);
    
    // 拖曳事件
    marker.on('drag', function(e) {
        if (isJunction) {
            // 🆕 交叉點拖曳：同步更新所有相關分支
            updateJunctionPosition(junctionData, e.latlng);
        } else {
            // 普通節點拖曳：只更新該分支
            updateBranchPolyline(branchIndex);
        }
    });
    
    // 右鍵選單
    marker.on('contextmenu', function(e) {
        e.originalEvent.preventDefault();
        showBranchNodeContextMenu(e, branchIndex, nodeIndex, isJunction, isBranchStart);
    });
    
    // 儲存到 editingNodes 陣列
    editingNodes.push({
        marker: marker,
        branchIndex: branchIndex,
        nodeIndex: nodeIndex,
        isJunction: isJunction,
        isBranchStart: isBranchStart,
        junctionData: junctionData  // 儲存交叉點資料
    });
}

/**
 * 🆕 更新交叉點位置（同步更新所有相關分支）
 */
function updateJunctionPosition(junctionData, newLatLng) {
    if (!junctionData) return;
    
    const newCoord = [newLatLng.lat, newLatLng.lng];
    
    // 找出所有在這個交叉點上的節點
    junctionData.branches.forEach(branchIdx => {
        // 找出該分支在這個交叉點的節點（起點或終點）
        const branch = branchStructure.branches[branchIdx];
        if (!branch) return;
        
        // 檢查起點
        if (branch.coords.length > 0) {
            const firstKey = `${branch.coords[0][0].toFixed(6)},${branch.coords[0][1].toFixed(6)}`;
            const junctionKey = `${junctionData.coord[0].toFixed(6)},${junctionData.coord[1].toFixed(6)}`;
            
            if (firstKey === junctionKey) {
                // 起點是交叉點，更新它
                branch.coords[0] = newCoord;
            }
            
            // 檢查終點
            const lastIdx = branch.coords.length - 1;
            const lastKey = `${branch.coords[lastIdx][0].toFixed(6)},${branch.coords[lastIdx][1].toFixed(6)}`;
            
            if (lastKey === junctionKey) {
                // 終點是交叉點，更新它
                branch.coords[lastIdx] = newCoord;
            }
        }
        
        // 更新該分支的 polyline
        updateBranchPolyline(branchIdx);
    });
    
    // 更新交叉點資料
    junctionData.coord = newCoord;
}

/**
 * 顯示交叉點標記
 */
function displayJunctionPoints() {
    // 清除舊的交叉點標記
    junctionMarkers.forEach(m => map.removeLayer(m));
    junctionMarkers = [];
    
    if (branchStructure.junctionPoints.length === 0) {
        console.log('📍 無交叉點');
        return;
    }
    
    branchStructure.junctionPoints.forEach(junction => {
        const [lat, lng] = junction.coord;
        
        // 交叉點標記已經在 createEditableNode 中建立了
        // 這裡只需要顯示額外資訊（例如 tooltip）
        
        console.log(`📍 交叉點: (${lat.toFixed(6)}, ${lng.toFixed(6)}) - 連接分支 ${junction.branches.join(', ')}`);
    });
}

/**
 * 更新指定分支的 polyline
 * @param {Number} branchIndex - 分支索引
 */
function updateBranchPolyline(branchIndex) {
    // 找出該分支的所有節點
    const branchNodes = editingNodes.filter(n => n.branchIndex === branchIndex);
    
    // 依照 nodeIndex 排序
    branchNodes.sort((a, b) => a.nodeIndex - b.nodeIndex);
    
    // 取得座標
    const coords = branchNodes.map(n => n.marker.getLatLng());
    
    // 更新 polyline
    const branchData = editingBranches.find(b => b.index === branchIndex);
    if (branchData && branchData.polyline) {
        branchData.polyline.setLatLngs(coords);
    }
    
    // 同步更新 branchStructure（以便保存時使用）
    if (branchStructure.branches[branchIndex]) {
        branchStructure.branches[branchIndex].coords = coords.map(ll => [ll.lat, ll.lng]);
    }
}

/**
 * 在分支上新增節點
 * @param {LatLng} latlng - 點擊位置
 * @param {Number} branchIndex - 分支索引
 */
function addNodeToBranch(latlng, branchIndex) {
    if (!isEditingPath) return;
    
    const branchNodes = editingNodes.filter(n => n.branchIndex === branchIndex);
    branchNodes.sort((a, b) => a.nodeIndex - b.nodeIndex);
    
    // 找出最接近的線段
    let minDist = Infinity;
    let insertAfterIndex = 0;
    
    for (let i = 0; i < branchNodes.length - 1; i++) {
        const p1 = branchNodes[i].marker.getLatLng();
        const p2 = branchNodes[i + 1].marker.getLatLng();
        
        // 計算點到線段的距離
        const dist = getDistanceToSegment(latlng, p1, p2);
        if (dist < minDist) {
            minDist = dist;
            insertAfterIndex = i;
        }
    }
    
    // 新節點的 nodeIndex
    const newNodeIndex = insertAfterIndex + 1;
    
    // 更新後面所有節點的 nodeIndex
    editingNodes.forEach(n => {
        if (n.branchIndex === branchIndex && n.nodeIndex >= newNodeIndex) {
            n.nodeIndex++;
        }
    });
    
    // 建立新節點
    createEditableNode([latlng.lat, latlng.lng], branchIndex, newNodeIndex);
    
    // 更新 polyline
    updateBranchPolyline(branchIndex);
    
    console.log(`✨ 在分支 ${branchIndex} 的位置 ${newNodeIndex} 新增節點`);
}

/**
 * 計算點到線段的距離（輔助函數）
 */
function getDistanceToSegment(point, lineStart, lineEnd) {
    const A = point.lat - lineStart.lat;
    const B = point.lng - lineStart.lng;
    const C = lineEnd.lat - lineStart.lat;
    const D = lineEnd.lng - lineStart.lng;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) param = dot / lenSq;
    
    let xx, yy;
    if (param < 0) {
        xx = lineStart.lat;
        yy = lineStart.lng;
    } else if (param > 1) {
        xx = lineEnd.lat;
        yy = lineEnd.lng;
    } else {
        xx = lineStart.lat + param * C;
        yy = lineStart.lng + param * D;
    }
    
    const dx = point.lat - xx;
    const dy = point.lng - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 顯示分支節點的右鍵選單
 */
function showBranchNodeContextMenu(e, branchIndex, nodeIndex, isJunction, isBranchStart) {
    // 移除舊選單
    const oldMenu = document.querySelector('.node-context-menu');
    if (oldMenu) oldMenu.remove();
    
    // 建立選單
    const menu = document.createElement('div');
    menu.className = 'node-context-menu';
    menu.style.cssText = `
        position: fixed;
        left: ${e.originalEvent.clientX}px;
        top: ${e.originalEvent.clientY}px;
        background: white;
        border: 2px solid #333;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        min-width: 180px;
    `;
    
    // 根據節點類型顯示不同選項
    if (isJunction) {
        // 交叉點選單
        menu.innerHTML = `
            <div class="rcm-item" onclick="createBranchFromJunction(${branchIndex}, ${nodeIndex})">
                <span>🌿</span> 建立分支
            </div>
            <div class="rcm-item" style="color:#999; cursor: default; font-size:11px;">
                <span>ℹ️</span> 連接 ${branchStructure.junctionPoints.find(jp => {
                    const key = editingNodes.find(n => n.branchIndex === branchIndex && n.nodeIndex === nodeIndex);
                    if (!key) return false;
                    const ll = key.marker.getLatLng();
                    const jpKey = `${jp.coord[0].toFixed(6)},${jp.coord[1].toFixed(6)}`;
                    const nodeKey = `${ll.lat.toFixed(6)},${ll.lng.toFixed(6)}`;
                    return jpKey === nodeKey;
                })?.branches.length || 0} 條分支
            </div>
        `;
    } else if (isBranchStart) {
        // 分支起點選單
        menu.innerHTML = `
            <div class="rcm-item" onclick="deleteNodeFromBranch(${branchIndex}, ${nodeIndex})">
                <span>🗑️</span> 刪除節點
            </div>
            <div class="rcm-item" onclick="deleteBranch(${branchIndex})" style="color:#F44336;">
                <span>❌</span> 刪除整個分支
            </div>
        `;
    } else {
        const thisBranch = branchStructure.branches[branchIndex];
        const isThisBranch = thisBranch && thisBranch.isBranch;
        menu.innerHTML = `
            <div class="rcm-item" onclick="deleteNodeFromBranch(${branchIndex}, ${nodeIndex})"><span>🗑️</span> 刪除節點</div>
            <div class="rcm-item" onclick="createBranchFromNode(${branchIndex}, ${nodeIndex})"><span>🌿</span> 建立分支</div>
            ${isThisBranch ? '<div class="rcm-item" onclick="deleteBranch(' + branchIndex + ')" style="color:#F44336;border-top:1px solid #f0f0f0;"><span>❌</span> 刪除整個分支</div>' : ''}
        `;
    }
    
    document.body.appendChild(menu);
    
    // 點擊其他地方關閉選單
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }, 0);
    }, 100);
}

/**
 * 從分支中刪除節點
 */
function deleteNodeFromBranch(branchIndex, nodeIndex) {
    const branch = branchStructure.branches[branchIndex];
    
    // 檢查分支是否至少有 3 個節點（刪除後至少要剩 2 個）
    const branchNodesCount = editingNodes.filter(n => n.branchIndex === branchIndex).length;
    if (branchNodesCount <= 2) {
        showToast('每個分支至少需要 2 個節點！', 'error');
        return;
    }
    
    // 找出要刪除的節點
    const nodeToDelete = editingNodes.find(n => 
        n.branchIndex === branchIndex && n.nodeIndex === nodeIndex
    );
    
    if (!nodeToDelete) return;
    
    // 移除標記
    map.removeLayer(nodeToDelete.marker);
    
    // 從陣列中移除
    const index = editingNodes.indexOf(nodeToDelete);
    editingNodes.splice(index, 1);
    
    // 更新後面節點的 nodeIndex
    editingNodes.forEach(n => {
        if (n.branchIndex === branchIndex && n.nodeIndex > nodeIndex) {
            n.nodeIndex--;
        }
    });
    
    // 更新 polyline
    updateBranchPolyline(branchIndex);
    
    console.log(`🗑️ 刪除分支 ${branchIndex} 的節點 ${nodeIndex}`);
}

/**
 * 刪除整個分支（階段 3 功能，目前僅顯示提示）
 */
async function deleteBranch(branchIndex) {
    if (!await showConfirm({ title: '刪除整個分支', message: '確定要刪除整個分支嗎？此操作無法復原。', okText: '刪除', danger: true })) return;
    
    // 移除該分支的所有節點標記
    const branchNodes = editingNodes.filter(n => n.branchIndex === branchIndex);
    branchNodes.forEach(n => map.removeLayer(n.marker));
    
    // 從 editingNodes 移除
    editingNodes = editingNodes.filter(n => n.branchIndex !== branchIndex);
    
    // 移除 polyline
    const branchData = editingBranches.find(b => b.index === branchIndex);
    if (branchData && branchData.polyline) {
        map.removeLayer(branchData.polyline);
    }
    editingBranches = editingBranches.filter(b => b.index !== branchIndex);
    
    // 從 branchStructure 移除
    branchStructure.branches.splice(branchIndex, 1);
    
    // 重新索引剩餘分支
    branchStructure.branches.forEach((b, i) => {
        b.index = i;
    });
    
    // 更新所有節點的 branchIndex
    editingNodes.forEach(n => {
        if (n.branchIndex > branchIndex) {
            n.branchIndex--;
        }
    });
    
    // 更新 editingBranches 的 index
    editingBranches.forEach(b => {
        if (b.index > branchIndex) {
            b.index--;
        }
    });
    
    // 重新計算交叉點
    recalculateJunctions();
    displayJunctionPoints();
    
    console.log(`❌ 已刪除分支 ${branchIndex}`);
}

/**
 * 從節點建立新分支（階段 3 功能，目前僅顯示提示）
 */
/**
 * 從節點建立新分支（階段 3 功能）
 */
function createBranchFromNode(branchIndex, nodeIndex) {
    // 找出起始節點
    const startNode = editingNodes.find(n => 
        n.branchIndex === branchIndex && n.nodeIndex === nodeIndex
    );
    
    if (!startNode) {
        console.error('❌ 找不到起始節點');
        return;
    }
    
    const startCoord = startNode.marker.getLatLng();
    
    console.log(`🌿 從分支 ${branchIndex} 的節點 ${nodeIndex} 建立新分支`);
    console.log('   起始座標:', startCoord);
    
    // 儲存起始節點資訊
    branchStartNode = {
        branchIndex: branchIndex,
        nodeIndex: nodeIndex,
        coord: [startCoord.lat, startCoord.lng]
    };
    
    // 進入分支繪製模式
    enterBranchDrawingMode();
}

/**
 * 從交叉點建立新分支（階段 3 功能）
 */
function createBranchFromJunction(branchIndex, nodeIndex) {
    // 與 createBranchFromNode 相同邏輯
    createBranchFromNode(branchIndex, nodeIndex);
}

/**
 * 進入分支繪製模式
 */
function enterBranchDrawingMode() {
    if (isBranchDrawingMode) {
        console.warn('⚠️ 已經在分支繪製模式中');
        return;
    }
    
    isBranchDrawingMode = true;
    branchDrawingNodes = [branchStartNode.coord]; // 第一個點是起始節點
    branchDrawingMarkers = [];
    
    console.log('🎨 進入分支繪製模式');
    
    // 顯示提示訊息
    showBranchDrawingHint();
    
    // 改變滑鼠游標
    map.getContainer().style.cursor = 'crosshair';
    
    // 在起始節點顯示特殊標記
    const startMarker = L.marker(branchStartNode.coord, {
        icon: L.divIcon({
            className: 'branch-start-marker-drawing',
            iconSize: [20, 20],
            html: '<div style="background:#4CAF50;width:20px;height:20px;border-radius:50%;border:3px solid white;box-shadow:0 0 8px rgba(76,175,80,0.8);"></div>'
        })
    }).addTo(map);
    branchDrawingMarkers.push(startMarker);
    
    // 監聽地圖點擊事件
    map.on('click', onBranchDrawingClick);
    
    // 監聽鍵盤事件
    document.addEventListener('keydown', onBranchDrawingKeyDown);
}

/**
 * 分支繪製模式：點擊地圖事件
 */
function onBranchDrawingClick(e) {
    if (!isBranchDrawingMode) return;
    
    const newCoord = [e.latlng.lat, e.latlng.lng];
    branchDrawingNodes.push(newCoord);
    
    console.log(`✨ 新增分支節點 ${branchDrawingNodes.length - 1}:`, newCoord);
    
    // 新增節點標記
    const marker = L.marker(newCoord, {
        icon: L.divIcon({
            className: 'branch-drawing-node',
            iconSize: [14, 14],
            html: '<div style="background:#9C27B0;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.3);"></div>'
        })
    }).addTo(map);
    branchDrawingMarkers.push(marker);
    
    // 更新預覽線
    updateBranchDrawingLine();
    
    // 更新提示訊息
    updateBranchDrawingHint();
}

/**
 * 分支繪製模式：鍵盤事件
 */
function onBranchDrawingKeyDown(e) {
    if (!isBranchDrawingMode) return;
    
    if (e.key === 'Escape') {
        // ESC 取消
        console.log('❌ 取消分支繪製');
        exitBranchDrawingMode(false);
    } else if (e.key === 'Enter') {
        // Enter 完成
        console.log('✅ 完成分支繪製');
        completeBranchDrawing();
    }
}

/**
 * 更新分支繪製預覽線
 */
function updateBranchDrawingLine() {
    // 移除舊的預覽線
    if (branchDrawingLine) {
        map.removeLayer(branchDrawingLine);
    }
    
    // 繪製新的預覽線
    branchDrawingLine = L.polyline(branchDrawingNodes, {
        color: '#9C27B0',
        weight: 5,
        opacity: 0.6,
        dashArray: '10, 5'  // 虛線
    }).addTo(map);
}

/**
 * 顯示分支繪製提示訊息
 */
function showBranchDrawingHint() {
    branchDrawingHint = document.createElement('div');
    branchDrawingHint.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(156, 39, 176, 0.95);
        color: white;
        padding: 20px 30px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        z-index: 10000;
        font-size: 14px;
        text-align: center;
        min-width: 300px;
    `;
    branchDrawingHint.innerHTML = `
        <div style="font-size: 20px; margin-bottom: 10px;">🌿 分支繪製模式</div>
        <div style="margin: 8px 0;">📍 點擊地圖建立分支路徑</div>
        <div style="margin: 8px 0;">✅ <kbd>Enter</kbd> 完成</div>
        <div style="margin: 8px 0;">❌ <kbd>Esc</kbd> 取消</div>
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.3); font-size: 12px;">
            已建立 <strong>0</strong> 個節點（至少需要 1 個）
        </div>
    `;
    document.body.appendChild(branchDrawingHint);
    
    // 2秒後淡出提示
    setTimeout(() => {
        if (branchDrawingHint) {
            branchDrawingHint.style.transition = 'opacity 0.5s';
            branchDrawingHint.style.opacity = '0.3';
            branchDrawingHint.style.pointerEvents = 'none';
        }
    }, 2000);
}

/**
 * 更新分支繪製提示訊息
 */
function updateBranchDrawingHint() {
    if (!branchDrawingHint) return;
    
    const nodeCount = branchDrawingNodes.length - 1; // 扣掉起始節點
    const lastLine = branchDrawingHint.querySelector('div:last-child');
    if (lastLine) {
        lastLine.innerHTML = `已建立 <strong>${nodeCount}</strong> 個節點${nodeCount >= 1 ? ' - 可按 Enter 完成' : '（至少需要 1 個）'}`;
    }
    
    // 重新顯示提示
    branchDrawingHint.style.opacity = '0.95';
}

/**
 * 完成分支繪製
 */
function completeBranchDrawing() {
    if (!isBranchDrawingMode) return;
    
    // 檢查至少有 2 個節點（起始節點 + 至少 1 個新節點）
    if (branchDrawingNodes.length < 2) {
        showToast('分支至少需要 2 個節點', 'warning');
        return;
    }
    
    console.log('✅ 分支繪製完成，共 ' + branchDrawingNodes.length + ' 個節點');
    
    // 建立新分支
    const newBranchIndex = branchStructure.branches.length;
    branchStructure.branches.push({
        index: newBranchIndex,
        coords: branchDrawingNodes.map(c => [...c]),  // 深拷貝
        isBranch: true
    });
    
    console.log(`🌿 新增分支 ${newBranchIndex}:`, branchDrawingNodes.length, '個節點');
    
    // 重新計算交叉點
    recalculateJunctions();
    
    // 退出繪製模式
    exitBranchDrawingMode(true);
    
    // 重新進入編輯模式以顯示新分支
    refreshEditMode();
}

/**
 * 退出分支繪製模式
 * @param {Boolean} save - 是否保存分支
 */
function exitBranchDrawingMode(save) {
    if (!isBranchDrawingMode) return;
    
    isBranchDrawingMode = false;
    
    // 移除提示訊息
    if (branchDrawingHint) {
        branchDrawingHint.remove();
        branchDrawingHint = null;
    }
    
    // 移除預覽線
    if (branchDrawingLine) {
        map.removeLayer(branchDrawingLine);
        branchDrawingLine = null;
    }
    
    // 移除標記
    branchDrawingMarkers.forEach(m => map.removeLayer(m));
    branchDrawingMarkers = [];
    
    // 恢復滑鼠游標
    map.getContainer().style.cursor = '';
    
    // 移除事件監聽
    map.off('click', onBranchDrawingClick);
    document.removeEventListener('keydown', onBranchDrawingKeyDown);
    
    // 清空變數
    branchDrawingNodes = [];
    branchStartNode = null;
    
    console.log('🔙 退出分支繪製模式' + (save ? '（已保存）' : '（已取消）'));
}

/**
 * 刷新編輯模式（重新繪製所有分支和節點）
 */
function refreshEditMode() {
    if (!isEditingPath) return;
    
    console.log('🔄 刷新編輯模式');
    
    // 清除現有的編輯元素
    editingBranches.forEach(branch => {
        if (branch.polyline) map.removeLayer(branch.polyline);
    });
    editingNodes.forEach(node => {
        if (node.marker) map.removeLayer(node.marker);
    });
    junctionMarkers.forEach(m => map.removeLayer(m));
    
    editingBranches = [];
    editingNodes = [];
    junctionMarkers = [];
    
    // 重新繪製所有分支
    branchStructure.branches.forEach((branch, branchIndex) => {
        const isMain = !branch.isBranch;
        console.log(`   重新繪製分支 ${branchIndex} (${isMain ? '主幹' : '分支'}): ${branch.coords.length} 個節點`);
        
        const polyline = L.polyline(branch.coords, {
            color: isMain ? '#FF6B35' : '#9C27B0',
            weight: isMain ? 6 : 5,
            opacity: 0.8,
            className: isMain ? 'editing-polyline-main' : 'editing-polyline-branch'
        }).addTo(map);
        
        polyline.on('click', function(e) {
            addNodeToBranch(e.latlng, branchIndex);
        });
        
        editingBranches.push({
            polyline: polyline,
            index: branchIndex,
            isMain: isMain
        });
        
        // 建立該分支的可拖曳節點
        branch.coords.forEach((coord, nodeIndex) => {
            createEditableNode(coord, branchIndex, nodeIndex);
        });
    });
    
    // 顯示交叉點
    displayJunctionPoints();
    
    console.log(`✅ 刷新完成，共 ${editingNodes.length} 個節點`);
}

/**
 * 重新計算交叉點（輔助函數）
 */
function recalculateJunctions() {
    const junctionMap = new Map();
    
    // 收集所有分支的端點
    branchStructure.branches.forEach((branch, bIdx) => {
        if (branch.coords.length > 0) {
            // 起點和終點
            [branch.coords[0], branch.coords[branch.coords.length - 1]].forEach(coord => {
                const key = `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
                if (!junctionMap.has(key)) {
                    junctionMap.set(key, []);
                }
                junctionMap.get(key).push(bIdx);
            });
        }
    });
    
    // 找出真正的交叉點（連接 2+ 條分支）
    branchStructure.junctionPoints = [];
    junctionMap.forEach((branches, key) => {
        if (branches.length > 1) {
            const [lat, lng] = key.split(',').map(Number);
            branchStructure.junctionPoints.push({
                coord: [lat, lng],
                branches: [...new Set(branches)] // 去重
            });
        }
    });
}

// ========== 原有的編輯函數（保留給單一 LINESTRING 用） ==========

// 建立可編輯節點
function createEditableNodes(coords) {
    editingNodes = [];
    
    coords.forEach((coord, index) => {
        const isBreakPoint = segmentBreakPoints.includes(index);
        
        const marker = L.marker([coord[0], coord[1]], {
            draggable: true,
            icon: L.divIcon({
                className: isBreakPoint ? 'path-node-marker segment-break' : 'path-node-marker',
                iconSize: [14, 14],
                html: isBreakPoint ? '<div style="background:#FF0000;width:14px;height:14px;border-radius:50%;border:2px solid white;"></div>' : ''
            })
        }).addTo(map);
        
        // 拖曳事件
        marker.on('drag', function(e) {
            updatePolylineFromNodes();
        });
        
        // 右鍵選單
        marker.on('contextmenu', function(e) {
            e.originalEvent.preventDefault();
            showNodeContextMenu(e, index);
        });
        
        editingNodes.push(marker);
    });
}

// 顯示節點右鍵選單
function showNodeContextMenu(e, nodeIndex) {
    // 移除舊選單
    const oldMenu = document.querySelector('.node-context-menu');
    if (oldMenu) oldMenu.remove();
    
    // 建立選單
    const menu = document.createElement('div');
    menu.className = 'node-context-menu';
    menu.style.cssText = `
        position: fixed;
        left: ${e.originalEvent.clientX}px;
        top: ${e.originalEvent.clientY}px;
        background: white;
        border: 2px solid #333;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        min-width: 150px;
    `;
    
    const isBreakPoint = segmentBreakPoints.includes(nodeIndex);
    
    // 選單項目
    const items = [];
    
    // 刪除節點
    if (editingNodes.length > 2) {
        items.push({
            text: '🗑️ 刪除節點',
            color: '#f44336',
            action: () => removeNode(nodeIndex)
        });
    }
    
    // 分段/取消分段
    if (nodeIndex > 0 && nodeIndex < editingNodes.length - 1) {
        if (isBreakPoint) {
            items.push({
                text: '🔗 取消分段',
                color: '#2196F3',
                action: () => toggleSegmentBreak(nodeIndex)
            });
        } else {
            items.push({
                text: '✂️ 在此分段',
                color: '#FF9800',
                action: () => toggleSegmentBreak(nodeIndex)
            });
        }
    }
    
    items.forEach(item => {
        const div = document.createElement('div');
        div.textContent = item.text;
        div.style.cssText = `
            padding: 10px 15px;
            cursor: pointer;
            color: ${item.color};
            font-weight: 600;
            font-size: 13px;
        `;
        div.onmouseover = () => div.style.background = '#f5f5f5';
        div.onmouseout = () => div.style.background = 'white';
        div.onclick = () => {
            item.action();
            menu.remove();
        };
        menu.appendChild(div);
    });
    
    document.body.appendChild(menu);
    
    // 點擊其他地方關閉選單
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }, 10);
    });
}

// 切換分段點
function toggleSegmentBreak(index) {
    const breakIndex = segmentBreakPoints.indexOf(index);
    if (breakIndex > -1) {
        // 移除分段點
        segmentBreakPoints.splice(breakIndex, 1);
        console.log('🔗 取消分段於節點', index);
    } else {
        // 新增分段點
        segmentBreakPoints.push(index);
        segmentBreakPoints.sort((a, b) => a - b); // 排序
        console.log('✂️ 在節點', index, '處分段');
    }
    
    // 更新節點顯示
    updateNodeIcons();
    updateSegmentBreakMarkers();
}

// 更新節點圖示（顯示分段點為紅色）
function updateNodeIcons() {
    editingNodes.forEach((marker, index) => {
        const isBreakPoint = segmentBreakPoints.includes(index);
        marker.setIcon(L.divIcon({
            className: isBreakPoint ? 'path-node-marker segment-break' : 'path-node-marker',
            iconSize: [14, 14],
            html: isBreakPoint ? '<div style="background:#FF0000;width:14px;height:14px;border-radius:50%;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);"></div>' : ''
        }));
    });
}

// 更新分段點標記（在地圖上顯示分段標籤）
function updateSegmentBreakMarkers() {
    // 移除舊標記
    const oldMarkers = document.querySelectorAll('.segment-break-label');
    oldMarkers.forEach(m => {
        const marker = m._leaflet_id;
        // 找到並移除 Leaflet 標記
    });
    
    // 在每個分段點旁邊顯示 "✂️ 分段點"
    segmentBreakPoints.forEach(index => {
        if (index < editingNodes.length) {
            const nodePos = editingNodes[index].getLatLng();
            const label = L.marker(nodePos, {
                icon: L.divIcon({
                    className: 'segment-break-label',
                    html: '<div style="background:#FF0000;color:white;padding:3px 8px;border-radius:4px;font-size:10px;font-weight:bold;white-space:nowrap;margin-left:20px;box-shadow:0 2px 4px rgba(0,0,0,0.3);">✂️ 分段點</div>',
                    iconSize: null,
                    iconAnchor: [-10, 7]
                })
            }).addTo(map);
        }
    });
}

// 在指定位置新增節點
function addNodeAtPosition(latlng) {
    // 找到最接近的線段
    const coords = editingPolyline.getLatLngs();
    let minDist = Infinity;
    let insertIndex = -1;
    
    for (let i = 0; i < coords.length - 1; i++) {
        const dist = L.GeometryUtil.distanceSegment(map, latlng, coords[i], coords[i + 1]);
        if (dist < minDist) {
            minDist = dist;
            insertIndex = i + 1;
        }
    }
    
    if (insertIndex === -1) return;
    
    // 插入新節點標記
    const newMarker = L.marker(latlng, {
        draggable: true,
        icon: L.divIcon({
            className: 'path-node-marker',
            iconSize: [14, 14]
        })
    }).addTo(map);
    
    newMarker.on('drag', function(e) {
        updatePolylineFromNodes();
    });
    
    newMarker.on('contextmenu', function(e) {
        e.originalEvent.preventDefault();
        const idx = editingNodes.indexOf(newMarker);
        showNodeContextMenu(e, idx);
    });
    
    // 調整分段點索引（在插入點之後的索引都要 +1）
    segmentBreakPoints = segmentBreakPoints.map(bp => bp >= insertIndex ? bp + 1 : bp);
    
    editingNodes.splice(insertIndex, 0, newMarker);
    updatePolylineFromNodes();
    updateNodeIcons();
    updateSegmentBreakMarkers();
    
    console.log('➕ 新增節點於索引', insertIndex);
}

// 移除節點
function removeNode(index) {
    // 如果刪除的是分段點，移除該分段點
    const breakIndex = segmentBreakPoints.indexOf(index);
    if (breakIndex > -1) {
        segmentBreakPoints.splice(breakIndex, 1);
    }
    
    // 調整分段點索引（在刪除點之後的索引都要 -1）
    segmentBreakPoints = segmentBreakPoints.map(bp => bp > index ? bp - 1 : bp);
    
    const marker = editingNodes[index];
    map.removeLayer(marker);
    editingNodes.splice(index, 1);
    updatePolylineFromNodes();
    updateNodeIcons();
    updateSegmentBreakMarkers();
    
    console.log('➖ 刪除節點索引', index, '，剩餘', editingNodes.length, '個節點');
}

// 從節點更新管線
function updatePolylineFromNodes() {
    const newCoords = editingNodes.map(marker => marker.getLatLng());
    editingPolyline.setLatLngs(newCoords);
}

// 儲存編輯
async function savePathEdits() {
    // 檢查是否為 MULTILINESTRING 編輯模式
    console.log('🔍 保存前檢查:');
    console.log('   branchStructure:', branchStructure);
    console.log('   branches 數量:', branchStructure ? branchStructure.branches.length : 0);
    console.log('   isMULTI 標記:', branchStructure ? branchStructure.isMULTI : false);
    
    // 判斷是否應該保存為 MULTILINESTRING
    // 條件：有 branchStructure 且分支數 >= 2 (或原本就是 MULTILINESTRING)
    const isMULTI = branchStructure && (
        (branchStructure.isMULTI && branchStructure.branches.length >= 1) ||  // 原本是 MULTI，即使只剩 1 個分支也保持
        branchStructure.branches.length > 1  // 或者現在有多個分支
    );
    
    // 第一階段確認：儲存路徑並清空段落
    let segmentInfo = '';
    if (isMULTI) {
        segmentInfo = `\n📍 路徑包含 ${branchStructure.branches.length} 個分支（MULTILINESTRING）`;
    } else if (segmentBreakPoints.length > 0) {
        segmentInfo = `\n📍 路徑包含 ${segmentBreakPoints.length + 1} 個分段`;
    } else {
        segmentInfo = '\n📍 路徑為單一段落';
    }
    
    const confirmMessage = `⚠️ 儲存路徑變更${segmentInfo}
    
新路徑將更新至 Google Sheets

⚠️ 重要提醒：
• 施工進度段落資料將被清空
• 小段狀態將被重設
• 地圖備註、工作井、路權範圍不受影響

您需要重新設定：
1. 在「施工進度」表手動新增段落
2. 設定起始/結束距離、管徑、施工方式等

確定要繼續嗎？`;
    
    if (!await showConfirm({ title: '確認操作', message: confirmMessage, okText: '確定' })) {
        return;
    }
    
    try {
        let linestring = '';
        let newLength = 0;
        
        // 根據是否為 MULTILINESTRING 產生不同格式
        if (isMULTI) {
            // ========== MULTILINESTRING 模式 ==========
            console.log('📝 準備生成 MULTILINESTRING');
            console.log('   分支總數:', branchStructure.branches.length);
            console.log('   editingNodes 總數:', editingNodes.length);
            
            linestring = 'MULTILINESTRING(';
            
            branchStructure.branches.forEach((branch, branchIndex) => {
                // 取得該分支的所有節點（從 editingNodes）
                const branchNodes = editingNodes.filter(n => n.branchIndex === branchIndex);
                branchNodes.sort((a, b) => a.nodeIndex - b.nodeIndex);
                
                console.log(`   分支 ${branchIndex}:`, branchNodes.length, '個節點');
                
                const coords = branchNodes.map(n => {
                    const ll = n.marker.getLatLng();
                    return [ll.lat, ll.lng];
                });
                
                // 計算該分支長度
                for (let i = 0; i < coords.length - 1; i++) {
                    newLength += getDistance(coords[i], coords[i + 1]);
                }
                
                // 加入該分支的座標字串（lng lat 格式）
                const coordStr = coords.map(c => `${c[1]} ${c[0]}`).join(', ');
                linestring += `(${coordStr})`;
                
                console.log(`   分支 ${branchIndex} 座標:`, coordStr.substring(0, 50) + '...');
                
                // 除了最後一個分支，其他都加逗號
                if (branchIndex < branchStructure.branches.length - 1) {
                    linestring += ', ';
                }
            });
            
            linestring += ')';
            console.log('✅ MULTILINESTRING 生成完成');
            console.log('   完整字串:', linestring.substring(0, 100) + '...');
            
        } else {
            // ========== 單一 LINESTRING 或多段 LINESTRING 模式 ==========
            
            // 取得新座標（從 marker 物件取得，兼容舊版和新版）
            const newCoords = editingNodes.map(node => {
                // 新版（物件）
                if (node.marker) {
                    const ll = node.marker.getLatLng();
                    return [ll.lat, ll.lng];
                }
                // 舊版（直接是 marker）
                const ll = node.getLatLng();
                return [ll.lat, ll.lng];
            });
            
            if (segmentBreakPoints.length === 0) {
                // 沒有分段點，生成單段 LINESTRING
                linestring = 'LINESTRING(' + 
                    newCoords.map(c => c[1] + ' ' + c[0]).join(', ') + 
                ')';
            } else {
                // 有分段點，生成多段 LINESTRING
                const sortedBreaks = [...segmentBreakPoints].sort((a, b) => a - b);
                let startIndex = 0;
                
                sortedBreaks.forEach((breakIndex, i) => {
                    const segmentCoords = newCoords.slice(startIndex, breakIndex + 1);
                    linestring += 'LINESTRING(' + 
                        segmentCoords.map(c => c[1] + ' ' + c[0]).join(', ') + 
                    ')';
                    startIndex = breakIndex; // 下一段從分段點開始（重複該點）
                });
                
                // 最後一段
                const lastSegmentCoords = newCoords.slice(startIndex);
                linestring += 'LINESTRING(' + 
                    lastSegmentCoords.map(c => c[1] + ' ' + c[0]).join(', ') + 
                ')';
            }
            
            // 計算新路徑長度
            for (let i = 0; i < newCoords.length - 1; i++) {
                newLength += getDistance(newCoords[i], newCoords[i + 1]);
            }
        }
        
        newLength = Math.round(newLength);
        
        console.log('📡 準備儲存新路徑');
        console.log('   當前工程ID:', currentPipeline.id);
        console.log('   當前工程名稱:', currentPipeline.name);
        console.log('   格式:', isMULTI ? 'MULTILINESTRING' : 'LINESTRING');
        console.log('   分支數:', isMULTI ? branchStructure.branches.length : 1);
        console.log('   分段點:', segmentBreakPoints);
        console.log('   LINESTRING:', linestring);
        console.log('   新路徑長度:', newLength, 'm');
        
        // 使用 POST 請求（避免 URL 過長）
        const result = await apiCall('updateLinestring', {}, {
            body: new URLSearchParams({
                pipelineId: currentPipeline.id,
                linestring: linestring
            })
        });
        
        if (result.success) {
            let successMsg = '✅ 路徑已成功更新！';
            if (isMULTI) {
                successMsg += `\n\n🌿 已儲存為 MULTILINESTRING（${branchStructure.branches.length} 個分支）`;
            } else if (segmentBreakPoints.length > 0) {
                successMsg += `\n\n✂️ 路徑已分為 ${segmentBreakPoints.length + 1} 段`;
            }
            successMsg += '\n\n施工進度段落資料已清空，請重新在 Google Sheets 設定。';
            
            showToast(successMsg, 'success');
            
            // 更新本地資料
            currentPipeline.linestring = linestring;
            currentPipeline.segments = []; // 清空本地段落資料
            
            // 退出編輯模式（靜默模式）
            cancelEditMode(true);
            
            // 重新載入工程詳細頁面
            showPipelineDetail(currentPipeline.id, true);
        } else {
            throw new Error(result.error || '更新失敗');
        }
    } catch (error) {
        console.error('❌ 儲存失敗:', error);
        showToast('儲存失敗：' + error.message, 'error');
    }
}

// 取消編輯模式
async function cancelEditMode(silent = false) {
    // silent = true 時不顯示確認對話框（例如：返回按鈕、儲存後）
    if (!silent && isEditingPath && !await showConfirm({ title: '取消編輯', message: '確定要取消編輯嗎？\n所有變更都將遺失。', okText: '放棄變更', danger: true })) {
        return;
    }
    
    // 🆕 如果在分支繪製模式，先退出
    if (isBranchDrawingMode) {
        exitBranchDrawingMode(false);
    }
    
    isEditingPath = false;
    
    // 恢復按鈕狀態
    const btn = document.getElementById('editPathBtn');
    btn.classList.remove('active');
    btn.textContent = '✏️ 編輯路徑';
    
    // 隱藏工具列
    document.getElementById('editModeToolbar').classList.remove('active');
    
    // 移除編輯元素
    if (editingPolyline) {
        map.removeLayer(editingPolyline);
        editingPolyline = null;
    }
    
    // 清理分支編輯元素
    editingBranches.forEach(branch => {
        if (branch.polyline) {
            map.removeLayer(branch.polyline);
        }
    });
    editingBranches = [];
    
    junctionMarkers.forEach(m => map.removeLayer(m));
    junctionMarkers = [];
    
    // 清理節點標記（兼容新舊格式）
    editingNodes.forEach(node => {
        if (node.marker) {
            // 新版（物件格式）
            map.removeLayer(node.marker);
        } else {
            // 舊版（直接是 marker）
            map.removeLayer(node);
        }
    });
    editingNodes = [];
    
    // 重設分支結構
    branchStructure = null;
    
    // 重新顯示管線
    if (currentPipeline) {
        showPipelineDetail(currentPipeline.id, true);
    }
    
    console.log('🔙 退出編輯模式');
}

// 加入 Leaflet.GeometryUtil 的簡化版本（計算點到線段距離）
L.GeometryUtil = L.GeometryUtil || {};
L.GeometryUtil.distanceSegment = function(map, latlng, latlng1, latlng2) {
    const p = map.latLngToLayerPoint(latlng);
    const p1 = map.latLngToLayerPoint(latlng1);
    const p2 = map.latLngToLayerPoint(latlng2);
    return L.LineUtil.pointToSegmentDistance(p, p1, p2);
};

