// ========== 批次選取小段功能 ==========

// 處理小段點擊（支持 Ctrl 多選、Shift 範圍選取）
function handleSmallSegmentClick(e, segment, smallIndex, smallStart, smallEnd, isCompleted, polyline, originalColor) {
    // 🔧 視覺化分段模式下，轉交給分段線新增功能
    if (visualSegmentationMode) {
        onMapClickAddDivider(e);
        return;
    }
    
    const isCtrlPressed = e.originalEvent.ctrlKey || e.originalEvent.metaKey; // Mac 用 Cmd 鍵
    const isShiftPressed = e.originalEvent.shiftKey;
    
    // Shift+Click：一鍵更新整個段落所有小段
    if (isShiftPressed) {
        L.DomEvent.stopPropagation(e);
        showWholeSegmentPopup(e.latlng, segment);
        return;
    }
    
    // Ctrl 多選
    if (isCtrlPressed) {
        toggleSelectSmallSegment(segment, smallIndex, polyline, originalColor);
        lastClickedSmallSegment = {segment, smallIndex, polyline, originalColor};
        
        if (selectedSmallSegments.length > 0) {
            showBatchPopup();
        } else {
            map.closePopup();
        }
        L.DomEvent.stopPropagation(e);
        return;
    }
    
    // 一般點擊：清除選取，顯示單個彈窗
    clearSmallSegmentSelection();
    showSmallSegmentPopup(e.latlng, segment, smallIndex, smallStart, smallEnd, isCompleted);
    lastClickedSmallSegment = {segment, smallIndex, polyline, originalColor};
}

// 切換選取單個小段
function toggleSelectSmallSegment(segment, smallIndex, polyline, originalColor) {
    const existingIndex = selectedSmallSegments.findIndex(
        s => s.segment.segmentNumber === segment.segmentNumber && s.smallIndex === smallIndex
    );
    
    if (existingIndex >= 0) {
        // 取消選取
        const item = selectedSmallSegments[existingIndex];
        item.polyline.setStyle({ 
            weight: 5,
            color: item.originalColor,
            opacity: item.isCompleted ? 1 : 0.3
        });
        selectedSmallSegments.splice(existingIndex, 1);
    } else {
        // 加入選取
        const smallSegmentsStatus = segment.smallSegments || '';
        const statusArray = smallSegmentsStatus.split(',').map(s => s.trim());
        const statusValue = statusArray[smallIndex] || '0';
        const isCompleted = statusValue !== '0' && statusValue.trim() !== '';
        
        polyline.setStyle({ 
            weight: 10,
            color: '#FFD700',
            opacity: 1
        });
        selectedSmallSegments.push({
            segment,
            smallIndex,
            polyline,
            originalColor,
            isCompleted
        });
    }
}

// 範圍選取小段（從 lastClicked 到當前點擊的小段）
function selectRangeSmallSegments(from, to) {
    clearSmallSegmentSelection();
    
    // 如果在同一段落
    if (from.segment.segmentNumber === to.segment.segmentNumber) {
        const start = Math.min(from.smallIndex, to.smallIndex);
        const end = Math.max(from.smallIndex, to.smallIndex);
        
        // 找到這個段落的所有小段 polylines
        // 需要重新繪製時才能取得所有 polyline 引用，這裡簡化處理
        for (let i = start; i <= end; i++) {
            toggleSelectSmallSegment(from.segment, i, from.polyline, from.originalColor);
        }
    } else {
        // 跨段落選取較複雜，先選取兩個端點
        toggleSelectSmallSegment(from.segment, from.smallIndex, from.polyline, from.originalColor);
        toggleSelectSmallSegment(to.segment, to.smallIndex, to.polyline, to.originalColor);
    }
}

// 清除所有選取
function clearSmallSegmentSelection() {
    selectedSmallSegments.forEach(item => {
        // 確保 polyline 還在地圖上才設置樣式
        if (map.hasLayer(item.polyline)) {
            item.polyline.setStyle({ 
                weight: 5,
                color: item.originalColor,
                opacity: item.isCompleted ? 1 : 0.3
            });
        }
    });
    selectedSmallSegments = [];
}

// 顯示批次操作彈窗
function showBatchPopup() {
    if (selectedSmallSegments.length === 0) return;
    
    const completedCount = selectedSmallSegments.filter(s => s.isCompleted).length;
    const uncompletedCount = selectedSmallSegments.length - completedCount;
    
    const centerLat = selectedSmallSegments.reduce((sum, s) => 
        sum + s.polyline.getLatLngs()[0].lat, 0) / selectedSmallSegments.length;
    const centerLng = selectedSmallSegments.reduce((sum, s) => 
        sum + s.polyline.getLatLngs()[0].lng, 0) / selectedSmallSegments.length;
    
    L.popup()
        .setLatLng([centerLat, centerLng])
        .setContent(`
            <div class="popup-title">已選取 ${selectedSmallSegments.length} 個小段</div>
            <div class="popup-info">✅ 已完工：${completedCount} 個</div>
            <div class="popup-info">⚪ 未完工：${uncompletedCount} 個</div>
            <div style="margin-top: 12px; display: flex; gap: 8px;">
                <button class="popup-button" onclick="batchMarkComplete()" style="flex: 1;">
                    ✓ 全部標記完工
                </button>
                <button class="popup-button" onclick="batchMarkIncomplete()" style="flex: 1; background: #e74c3c;">
                    ❌ 全部取消完工
                </button>
            </div>
            <button class="popup-button" onclick="clearSmallSegmentSelection(); map.closePopup();" style="background: #95a5a6; margin-top: 8px;">
                取消選取
            </button>
        `)
        .openOn(map);
}

// ========== Shift+Click：整個段落一次更新 ==========
function showWholeSegmentPopup(latlng, segment) {
    const segLength = segment.endDistance - segment.startDistance;
    const numSmallSegs = Math.ceil(segLength / 10);
    const statusArray = (segment.smallSegments || '').split(',').map(s => s.trim());
    let completedCount = 0;
    for (let i = 0; i < numSmallSegs; i++) {
        const v = statusArray[i] || '0';
        if (v !== '0' && v !== '') completedCount++;
    }
    const progressPct = numSmallSegs > 0 ? Math.round(completedCount / numSmallSegs * 100) : 0;
    L.popup().setLatLng(latlng).setContent(`
        <div class="popup-title">⚡ 段落 ${segment.segmentNumber} 整段操作</div>
        <div class="popup-info">📏 範圍：${segment.startDistance}m - ${segment.endDistance}m</div>
        <div class="popup-info">🔢 共 ${numSmallSegs} 個小段　✅ 已完工：${completedCount}　⚪ 未完工：${numSmallSegs - completedCount}</div>
        <div class="popup-info">📊 進度：${progressPct}%</div>
        <div style="margin-top:12px;display:flex;gap:8px;">
            <button class="popup-button" onclick="wholeSegmentMarkComplete('${segment.segmentNumber}')" style="flex:1;">✓ 全段標記完工</button>
            <button class="popup-button" onclick="wholeSegmentMarkIncomplete('${segment.segmentNumber}')" style="flex:1;background:#e74c3c;">❌ 全段取消完工</button>
        </div>`).openOn(map);
}
window.wholeSegmentMarkComplete = async function(segmentNumber) {
    if (!requireLogin()) return;
    const segment = currentPipeline.segments.find(s => String(s.segmentNumber) === String(segmentNumber));
    if (!segment) { showToast('找不到段落 ' + segmentNumber, 'error'); return; }
    const numSmallSegs = Math.ceil((segment.endDistance - segment.startDistance) / 10);
    if (!await showConfirm({ title: '整段標記完工', message: `確定要將段落 ${segmentNumber} 的全部 ${numSmallSegs} 個小段標記為完工嗎？`, okText: '全段完工', icon: '✅' })) return;
    const today = new Date();
    const sv = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const visualUpdates = Array.from({length: numSmallSegs}, (_, i) => ({segmentNumber, smallIndex: i, isCompleted: true}));
    batchUpdateSmallSegmentVisuals(visualUpdates);
    map.closePopup();
    try {
        const r = await apiCall('updateWholeSegment', { pipelineId: currentPipeline.id, segmentNumber: segmentNumber, statusString: Array(numSmallSegs).fill(sv).join(',') });
        if (!r.success) throw new Error(r.error || '更新失敗');
        await _refreshProgress();
        showToast('段落 ' + segmentNumber + ' 全段標記完工', 'success');
    } catch (e) {
        batchUpdateSmallSegmentVisuals(visualUpdates.map(u => ({...u, isCompleted: false})));
        showToast('更新失敗：' + e.message, 'error');
    }
};
window.wholeSegmentMarkIncomplete = async function(segmentNumber) {
    if (!requireLogin()) return;
    const segment = currentPipeline.segments.find(s => String(s.segmentNumber) === String(segmentNumber));
    if (!segment) { showToast('找不到段落 ' + segmentNumber, 'error'); return; }
    const numSmallSegs = Math.ceil((segment.endDistance - segment.startDistance) / 10);
    if (!await showConfirm({ title: '整段取消完工', message: `確定要取消段落 ${segmentNumber} 的全部 ${numSmallSegs} 個小段的完工狀態嗎？`, okText: '取消完工', danger: true })) return;
    const visualUpdates = Array.from({length: numSmallSegs}, (_, i) => ({segmentNumber, smallIndex: i, isCompleted: false}));
    batchUpdateSmallSegmentVisuals(visualUpdates);
    map.closePopup();
    try {
        const r = await apiCall('updateWholeSegment', { pipelineId: currentPipeline.id, segmentNumber: segmentNumber, statusString: Array(numSmallSegs).fill('0').join(',') });
        if (!r.success) throw new Error(r.error || '更新失敗');
        await _refreshProgress();
        showToast('段落 ' + segmentNumber + ' 已取消完工', 'success');
    } catch (e) {
        batchUpdateSmallSegmentVisuals(visualUpdates.map(u => ({...u, isCompleted: true})));
        showToast('更新失敗：' + e.message, 'error');
    }
};
async function _refreshProgress() {
    const d = await apiCall('getProgress', { pipelineId: currentPipeline.id });
    if (d.segments) {
        const segments = parseBranchIndexFromSegments(d.segments);
        const idx = allPipelines.findIndex(p => p.id === currentPipeline.id);
        if (idx !== -1) allPipelines[idx].segments = segments;
        currentPipeline.segments = segments;
        
        // 即時更新地圖上所有段落的 label
        segments.forEach(seg => {
            const segLen = seg.endDistance - seg.startDistance;
            const numSmall = Math.ceil(segLen / 10);
            const statusArr = (seg.smallSegments || '').split(',').map(s => s.trim());
            let completed = 0;
            for (let i = 0; i < numSmall; i++) {
                const v = statusArr[i] || '0';
                if (v !== '0' && v !== '') completed += Math.min(10, segLen - i * 10);
            }
            updateSegmentLabel(seg.segmentNumber, completed, segLen);
        });
    }
    showStatsPanel();
}

// ========== 原有批次標記完工 (Ctrl多選用) ==========

// 批次標記完工
window.batchMarkComplete = async function() {
    if (!requireLogin()) return;
    if (selectedSmallSegments.length === 0) return;
    
    const confirmed = await showConfirm({ title: '批次標記完工', message: `確定要將 ${selectedSmallSegments.length} 個小段標記為完工嗎？`, okText: '標記完工', icon: '✅' });
    if (!confirmed) return;
    
    // 🚀 Optimistic UI：先立即更新視覺,讓使用者看到即時回饋
    const visualUpdates = selectedSmallSegments.map(item => ({
        segmentNumber: item.segment.segmentNumber,
        smallIndex: item.smallIndex,
        isCompleted: true
    }));
    batchUpdateSmallSegmentVisuals(visualUpdates);
    
    // 背景存檔,不顯示 Loading 畫面
    console.log('🔄 背景儲存中...');
    
    try {
        // 按段落分組
        const segmentGroups = {};
        for (const item of selectedSmallSegments) {
            const key = item.segment.segmentNumber;
            if (!segmentGroups[key]) {
                segmentGroups[key] = {
                    segment: item.segment,
                    smallIndexes: []
                };
            }
            segmentGroups[key].smallIndexes.push(item.smallIndex);
        }
        
        // 取得今天日期
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const statusValue = `${year}-${month}-${day}`;
        
        // 對每個段落進行批次更新
        for (const segNum in segmentGroups) {
            const group = segmentGroups[segNum];
            const segment = group.segment;
            const segLength = segment.endDistance - segment.startDistance;
            const numSmallSegments = Math.ceil(segLength / 10);
            
            // 取得現有狀態
            const smallSegmentsStatus = segment.smallSegments || '';
            const statusArray = smallSegmentsStatus.split(',').map(s => s.trim());
            
            // 補齊陣列長度
            while (statusArray.length < numSmallSegments) {
                statusArray.push('0');
            }
            
            // 更新選中的小段
            for (const idx of group.smallIndexes) {
                if (idx >= 0 && idx < statusArray.length) {
                    statusArray[idx] = statusValue;
                }
            }
            
            // 一次性更新整個段落
            const statusString = statusArray.join(',');
            const result = await apiCall('updateWholeSegment', { pipelineId: currentPipeline.id, statusString: statusString, segmentNumber: segNum });
            
            if (!result.success) {
                throw new Error(result.error || '更新失敗');
            }
        }
        
        console.log('✅ 背景儲存完成');
        
        // 清空選取陣列
        selectedSmallSegments = [];
        lastClickedSmallSegment = null;
        
        // 🚀 效能優化：不呼叫 reloadCurrentPipeline(),僅更新統計面板
        // 重新載入資料但不重繪地圖
        const progressData = await apiCall('getProgress', { pipelineId: currentPipeline.id });
        
        if (progressData.segments) {
            const segments = parseBranchIndexFromSegments(progressData.segments);
            const pipelineIndex = allPipelines.findIndex(p => p.id === currentPipeline.id);
            if (pipelineIndex !== -1) {
                allPipelines[pipelineIndex].segments = segments;
            }
            currentPipeline.segments = segments;
        }
        
        // 更新統計面板和地圖 label
        showStatsPanel();
        currentPipeline.segments.forEach(seg => {
            const segLen = seg.endDistance - seg.startDistance;
            const numSmall = Math.ceil(segLen / 10);
            const statusArr = (seg.smallSegments || '').split(',').map(s => s.trim());
            let completed = 0;
            for (let i = 0; i < numSmall; i++) {
                const v = statusArr[i] || '0';
                if (v !== '0' && v !== '') completed += Math.min(10, segLen - i * 10);
            }
            updateSegmentLabel(seg.segmentNumber, completed, segLen);
        });
        
        map.closePopup();
        // 顯示簡短的成功提示（不擋畫面）
        console.log('✅ 批次更新完成！');
    } catch (error) {
        // 發生錯誤時回退視覺狀態
        console.error('❌ 儲存失敗,回退視覺狀態:', error.message);
        const rollbackUpdates = visualUpdates.map(u => ({
            ...u,
            isCompleted: false
        }));
        batchUpdateSmallSegmentVisuals(rollbackUpdates);
        showToast('批次更新失敗：' + error.message, 'error');
    }
};

// 批次標記未完工
window.batchMarkIncomplete = async function() {
    if (!requireLogin()) return;
    if (selectedSmallSegments.length === 0) return;
    
    const confirmed = await showConfirm({ title: '批次取消完工', message: `確定要取消 ${selectedSmallSegments.length} 個小段的完工狀態嗎？`, okText: '取消完工', danger: true });
    if (!confirmed) return;
    
    // 🚀 Optimistic UI：先立即更新視覺
    const visualUpdates = selectedSmallSegments.map(item => ({
        segmentNumber: item.segment.segmentNumber,
        smallIndex: item.smallIndex,
        isCompleted: false
    }));
    batchUpdateSmallSegmentVisuals(visualUpdates);
    
    // 背景存檔
    console.log('🔄 背景儲存中...');
    
    try {
        // 按段落分組
        const segmentGroups = {};
        for (const item of selectedSmallSegments) {
            const key = item.segment.segmentNumber;
            if (!segmentGroups[key]) {
                segmentGroups[key] = {
                    segment: item.segment,
                    smallIndexes: []
                };
            }
            segmentGroups[key].smallIndexes.push(item.smallIndex);
        }
        
        // 對每個段落進行批次更新
        for (const segNum in segmentGroups) {
            const group = segmentGroups[segNum];
            const segment = group.segment;
            const segLength = segment.endDistance - segment.startDistance;
            const numSmallSegments = Math.ceil(segLength / 10);
            
            // 取得現有狀態
            const smallSegmentsStatus = segment.smallSegments || '';
            const statusArray = smallSegmentsStatus.split(',').map(s => s.trim());
            
            // 補齊陣列長度
            while (statusArray.length < numSmallSegments) {
                statusArray.push('0');
            }
            
            // 更新選中的小段為未完工
            for (const idx of group.smallIndexes) {
                if (idx >= 0 && idx < statusArray.length) {
                    statusArray[idx] = '0';
                }
            }
            
            // 一次性更新整個段落
            const statusString = statusArray.join(',');
            const result = await apiCall('updateWholeSegment', { pipelineId: currentPipeline.id, statusString: statusString, segmentNumber: segNum });
            
            if (!result.success) {
                throw new Error(result.error || '更新失敗');
            }
        }
        
        // 清空選取陣列（在重新載入前）
        selectedSmallSegments = [];
        lastClickedSmallSegment = null;
        
        // 🚀 效能優化：不重繪地圖,只更新資料和統計面板
        const progressData = await apiCall('getProgress', { pipelineId: currentPipeline.id });
        
        if (progressData.segments) {
            const segments = parseBranchIndexFromSegments(progressData.segments);
            const pipelineIndex = allPipelines.findIndex(p => p.id === currentPipeline.id);
            if (pipelineIndex !== -1) {
                allPipelines[pipelineIndex].segments = segments;
            }
            currentPipeline.segments = segments;
        }
        
        showStatsPanel();
        currentPipeline.segments.forEach(seg => {
            const segLen = seg.endDistance - seg.startDistance;
            const numSmall = Math.ceil(segLen / 10);
            const statusArr = (seg.smallSegments || '').split(',').map(s => s.trim());
            let completed = 0;
            for (let i = 0; i < numSmall; i++) {
                const v = statusArr[i] || '0';
                if (v !== '0' && v !== '') completed += Math.min(10, segLen - i * 10);
            }
            updateSegmentLabel(seg.segmentNumber, completed, segLen);
        });
        map.closePopup();
        console.log('✅ 批次取消完成！');
    } catch (error) {
        // 發生錯誤時回退視覺狀態
        console.error('❌ 儲存失敗,回退視覺狀態:', error.message);
        const rollbackUpdates = visualUpdates.map(u => ({
            ...u,
            isCompleted: true
        }));
        batchUpdateSmallSegmentVisuals(rollbackUpdates);
        showToast('批次取消失敗：' + error.message, 'error');
    }
};

// 直接更新小段狀態（不重新載入）
async function toggleSmallSegmentDirect(segmentNumber, smallIndex, newStatus) {
    if (!currentPipeline || !currentPipeline.id) {
        throw new Error('沒有選擇工程');
    }
    
    let statusValue;
    if (newStatus) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        statusValue = `${year}-${month}-${day}`;
    } else {
        statusValue = '0';
    }
    
    const result = await apiCall('updateSmallSegment', { pipelineId: currentPipeline.id, segmentNumber: segmentNumber, smallIndex: smallIndex, status: statusValue });
    
    if (!result.success) {
        throw new Error(result.error || '更新失敗');
    }
}

// 🚀 效能優化：局部更新小段視覺狀態 (Optimistic UI)
// 參數: segmentNumber=段落編號, smallIndex=小段索引, isCompleted=是否完工
function updateSmallSegmentVisual(segmentNumber, smallIndex, isCompleted) {
    const trackingKey = `${segmentNumber}-${smallIndex}`;
    const tracked = smallSegmentPolylines[trackingKey];
    
    if (!tracked || !tracked.polyline) {
        console.warn(`⚠️ 找不到小段 ${trackingKey} 的 polyline,無法更新視覺`);
        return false;
    }
    
    // 立即更新 polyline 樣式
    tracked.polyline.setStyle({
        weight: 5,
        opacity: isCompleted ? 1 : 0.5
    });
    
    return true;
}

// 🚀 效能優化：批次局部更新小段視覺狀態
function batchUpdateSmallSegmentVisuals(updates) {
    let successCount = 0;
    for (const update of updates) {
        if (updateSmallSegmentVisual(update.segmentNumber, update.smallIndex, update.isCompleted)) {
            successCount++;
        }
    }
    console.log(`✅ 成功更新 ${successCount}/${updates.length} 個小段的視覺狀態`);
    return successCount;
}

// 重新載入當前工程
async function reloadCurrentPipeline() {
    // 清空選取陣列（避免引用已被刪除的 polyline）
    selectedSmallSegments = [];
    lastClickedSmallSegment = null;
    
    const progressData = await apiCall('getProgress', { pipelineId: currentPipeline.id });
    
    if (progressData.segments) {
        const segments = parseBranchIndexFromSegments(progressData.segments);
        
        const pipelineIndex = allPipelines.findIndex(p => p.id === currentPipeline.id);
        if (pipelineIndex !== -1) {
            allPipelines[pipelineIndex].segments = segments;
        }
        currentPipeline.segments = segments;
    }
    
    showPipelineDetail(currentPipeline.id, true);
    setTimeout(() => { showStatsPanel(); }, 50);
}


// ==================== 地圖圈選 → 建甘特圖 ====================

let ganttRectMode = false;       // 是否在圈選甘特模式
let ganttRectStart = null;       // 起始點 {lat, lng}
let ganttRectLayer = null;       // 畫在地圖上的矩形預覽
let ganttRectHint = null;        // 提示文字 div
let _ganttRectMoveFn = null;   // Leaflet mousemove 函數參照
let _ganttRectDownFn = null;   // Leaflet mousedown 函數參照
let ganttRectKeyHandler = null;
let _ganttRectTouchMoveFn = null;
let _ganttRectTouchEndFn = null;
const _isTouchDevice = () => ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

window.startGanttRectSelect = function() {
    if (!currentPipeline) { showToast('請先選擇一個工程', 'warning'); return; }

    // 若已在模式中，取消
    if (ganttRectMode) { cancelGanttRectSelect(); return; }

    ganttRectMode = true;
    ganttRectStart = null;
    map.dragging.disable();
    map.getContainer().style.cursor = 'crosshair';

    // 提示文字（依裝置類型顯示不同說明）
    ganttRectHint = document.createElement('div');
    ganttRectHint.id = 'ganttRectHint';
    ganttRectHint.style.cssText = [
        'position:fixed', 'top:70px', 'left:50%', 'transform:translateX(-50%)',
        'background:rgba(0,103,80,0.92)', 'color:white', 'padding:8px 18px',
        'border-radius:20px', 'font-size:13px', 'font-weight:bold',
        'z-index:9999', 'pointer-events:none',
        'box-shadow:0 2px 10px rgba(0,0,0,0.3)'
    ].join(';');
    ganttRectHint.textContent = _isTouchDevice()
        ? '👆 用手指拖曳框選管線範圍'
        : '🗺️ 拖曳框選管線範圍，按 Esc 取消';
    document.body.appendChild(ganttRectHint);

    // ===== 滑鼠事件 =====
    _ganttRectMoveFn = function(ev) {
        if (!ganttRectStart) return;
        const bounds = L.latLngBounds(ganttRectStart, ev.latlng);
        if (ganttRectLayer) map.removeLayer(ganttRectLayer);
        ganttRectLayer = L.rectangle(bounds, {
            color: '#00695C', weight: 2, dashArray: '6,4',
            fillColor: '#00695C', fillOpacity: 0.12
        }).addTo(map);
    };

    _ganttRectDownFn = function(e) {
        if (!ganttRectMode) return;
        ganttRectStart = e.latlng;
        map.on('mousemove', _ganttRectMoveFn);

        const upHandler = function() {
            map.off('mousemove', _ganttRectMoveFn);
            document.removeEventListener('mouseup', upHandler);
            if (!ganttRectStart) return;
            const bounds = ganttRectLayer
                ? ganttRectLayer.getBounds()
                : L.latLngBounds(ganttRectStart, ganttRectStart);
            ganttRectStart = null;
            finishGanttRectSelect(bounds);
        };
        document.addEventListener('mouseup', upHandler);
    };
    map.on('mousedown', _ganttRectDownFn);

    // ===== 觸控事件（手機）=====
    const mapContainer = map.getContainer();

    const getTouchLatLng = function(touch) {
        const rect = mapContainer.getBoundingClientRect();
        const point = L.point(touch.clientX - rect.left, touch.clientY - rect.top);
        return map.containerPointToLatLng(point);
    };

    _ganttRectTouchMoveFn = function(e) {
        if (!ganttRectMode || !ganttRectStart || e.touches.length !== 1) return;
        e.preventDefault();
        const latlng = getTouchLatLng(e.touches[0]);
        const bounds = L.latLngBounds(ganttRectStart, latlng);
        if (ganttRectLayer) map.removeLayer(ganttRectLayer);
        ganttRectLayer = L.rectangle(bounds, {
            color: '#00695C', weight: 2, dashArray: '6,4',
            fillColor: '#00695C', fillOpacity: 0.12
        }).addTo(map);
    };

    _ganttRectTouchEndFn = function(e) {
        if (!ganttRectStart) return;
        const bounds = ganttRectLayer
            ? ganttRectLayer.getBounds()
            : L.latLngBounds(ganttRectStart, ganttRectStart);
        ganttRectStart = null;
        mapContainer.removeEventListener('touchmove', _ganttRectTouchMoveFn);
        mapContainer.removeEventListener('touchend', _ganttRectTouchEndFn);
        finishGanttRectSelect(bounds);
    };

    mapContainer.addEventListener('touchstart', function onTouchStart(e) {
        if (!ganttRectMode || e.touches.length !== 1) return;
        ganttRectStart = getTouchLatLng(e.touches[0]);
        mapContainer.addEventListener('touchmove', _ganttRectTouchMoveFn, { passive: false });
        mapContainer.addEventListener('touchend', _ganttRectTouchEndFn, { once: true });
        mapContainer.removeEventListener('touchstart', onTouchStart);
    }, { once: true });

    // Esc 取消（桌機）
    ganttRectKeyHandler = function(e) {
        if (e.key === 'Escape') cancelGanttRectSelect();
    };
    document.addEventListener('keydown', ganttRectKeyHandler);
};

function cancelGanttRectSelect() {
    ganttRectMode = false;
    ganttRectStart = null;
    if (ganttRectLayer) { map.removeLayer(ganttRectLayer); ganttRectLayer = null; }
    if (ganttRectHint) { ganttRectHint.remove(); ganttRectHint = null; }
    if (_ganttRectMoveFn) { map.off('mousemove', _ganttRectMoveFn); _ganttRectMoveFn = null; }
    if (_ganttRectDownFn) { map.off('mousedown', _ganttRectDownFn); _ganttRectDownFn = null; }
    if (_ganttRectTouchMoveFn) {
        map.getContainer().removeEventListener('touchmove', _ganttRectTouchMoveFn);
        _ganttRectTouchMoveFn = null;
    }
    if (_ganttRectTouchEndFn) {
        map.getContainer().removeEventListener('touchend', _ganttRectTouchEndFn);
        _ganttRectTouchEndFn = null;
    }
    if (ganttRectKeyHandler) { document.removeEventListener('keydown', ganttRectKeyHandler); ganttRectKeyHandler = null; }
    map.dragging.enable();
    map.getContainer().style.cursor = '';
}

function finishGanttRectSelect(bounds) {
    cancelGanttRectSelect();

    // 找出框選範圍內的節點 marker
    const hitNodes = [];
    for (const marker of nodeMarkers) {
        if (!marker.nodeData) continue;
        const latlng = marker.getLatLng();
        if (bounds.contains(latlng)) {
            hitNodes.push(marker.nodeData);
        }
    }

    if (hitNodes.length < 2) {
        showToast('請至少框選到 2 個節點', 'warning');
        return;
    }

    // 🆕 共用範圍計算：支援跨分支（支線節點A＋主線節點B → 兩個範圍涵蓋完整管路）
    const ranges = computeRectNodeRanges(hitNodes);
    const entries = ranges.map(r => ({
        segmentNumber: `B${r.branchIndex}`,
        minIdx: r.minIdx + 1,   // 1-based 給甘特圖
        maxIdx: r.maxIdx + 1,
        fromNode: r.fromNode,
        toNode: r.toNode,
        conflicts: []
    }));

    // 排除已建立過的範圍
    const existingItems = typeof ganttItemsCache !== 'undefined' ? ganttItemsCache : [];
    const filteredEntries = [];
    const skippedEntries = [];
    
    for (const entry of entries) {
        const segNum = entry.segmentNumber;
        const minIdx = entry.minIdx;
        const maxIdx = entry.maxIdx;
        
        // 檢查是否與現有項目完全重疊（支援新格式節點名稱和舊格式 #N～#N）
        const entry_fromNode = entry.fromNode || '';
        const entry_toNode = entry.toNode || '';
        const isFullyCovered = existingItems.some(item => {
            const label = item.label || '';
            // 新格式：比對節點名稱（「節點X至節點Y」）
            if (entry_fromNode && entry_toNode) {
                const nodeMatch = label.match(/[－-]\s*(.+?)至(.+?)（/);
                if (nodeMatch) {
                    return nodeMatch[1].trim() === entry_fromNode && nodeMatch[2].trim() === entry_toNode;
                }
            }
            // 舊格式：「...段落B0 #1～#31」
            const sMatch = label.match(/段落([A-Za-z0-9\-]+)/);
            const rMatch = label.match(/#(\d+)～#(\d+)/);
            if (sMatch && rMatch) {
                return String(sMatch[1]) === String(segNum) &&
                    parseInt(rMatch[1]) <= minIdx &&
                    parseInt(rMatch[2]) >= maxIdx;
            }
            return false;
        });
        
        if (isFullyCovered) {
            skippedEntries.push(entry);
        } else {
            filteredEntries.push(entry);
        }
    }
    
    if (skippedEntries.length > 0) {
        showToast(`已略過 ${skippedEntries.length} 個已建立的範圍`, 'warning');
    }
    
    entries.length = 0;
    filteredEntries.forEach(e => entries.push(e));

    if (entries.length === 0) {
        if (skippedBranches > 0) {
            showToast('每個分支都只有 1 個節點，請在同一分支上框選至少 2 個節點', 'warning');
        } else {
            showToast('框選範圍內沒有找到節點', 'warning');
        }
        return;
    }

    if (entries.length === 1) {
        const e = entries[0];
        openGanttPanelForSegment(e.segmentNumber, e.minIdx, e.maxIdx, e.fromNode, e.toNode);
    } else {
        showGanttSegmentPicker(entries);
    }
}


function showGanttSegmentPicker(entries) {
    // 移除舊的
    const old = document.getElementById('ganttSegPickerModal');
    if (old) old.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'ganttSegPickerModal';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;';

    const box = document.createElement('div');
    box.style.cssText = 'background:white;border-radius:12px;padding:20px;min-width:300px;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,0.3);';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:bold;font-size:14px;margin-bottom:12px;color:#00695C;';
    title.textContent = `📋 找到 ${entries.length} 個段落，請選擇要新增甘特項目的段落：`;
    box.appendChild(title);

    entries.forEach(e => {
        // 🐛 修正：原本讀取 e.segment.method，但建立 entries 的程式從未提供 segment
        // 欄位——以前單分支框選只會產生 1 筆、走不到這個多筆選擇器，所以潛伏至今；
        // 跨分支圈選會常態產生多筆，第一次執行就中招。改用 entry 本身既有的欄位。
        const numSmall = e.maxIdx - e.minIdx + 1;
        const rangeText = e.minIdx === e.maxIdx
            ? `#${e.minIdx}`
            : `#${e.minIdx}～#${e.maxIdx}`;
        const nodeText = (e.fromNode && e.toNode) ? `${e.fromNode} → ${e.toNode}，` : '';
        const btn = document.createElement('button');
        btn.style.cssText = 'display:block;width:100%;text-align:left;padding:9px 12px;margin-bottom:6px;border:1px solid #e0e0e0;border-radius:6px;cursor:pointer;background:#f9f9f9;font-size:13px;transition:background 0.15s;';
        btn.innerHTML = `<strong>段落 ${e.segmentNumber}</strong> 小段 <span style="color:#00695C;font-weight:bold;">${rangeText}</span> <span style="color:#888;font-size:11px;">（${nodeText}共 ${numSmall} 小段）</span>`;
        btn.onmouseover = () => btn.style.background = '#e8f5e9';
        btn.onmouseout = () => btn.style.background = '#f9f9f9';
        btn.onclick = () => {
            backdrop.remove();
            openGanttPanelForSegment(e.segmentNumber, e.minIdx, e.maxIdx, e.fromNode, e.toNode);
        };
        box.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'display:block;width:100%;padding:8px;margin-top:4px;border:none;border-radius:6px;cursor:pointer;background:#eeeeee;color:#666;font-size:13px;';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => backdrop.remove();
    box.appendChild(cancelBtn);

    backdrop.appendChild(box);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
}


// ==================== 地圖圈選 → 批次更新完工狀態 ====================

let completeRectMode = false;
let completeRectStart = null;
let completeRectLayer = null;
let completeRectHint = null;
let _completeRectMoveFn = null;
let _completeRectDownFn = null;
let _completeRectTouchMoveFn = null;
let _completeRectTouchEndFn = null;
let completeRectKeyHandler = null;

window.startCompleteRectSelect = function() {
    if (!currentPipeline) { showToast('請先選擇一個工程', 'warning'); return; }
    if (completeRectMode) { cancelCompleteRectSelect(); return; }

    completeRectMode = true;
    completeRectStart = null;
    map.dragging.disable();
    map.getContainer().style.cursor = 'crosshair';

    completeRectHint = document.createElement('div');
    completeRectHint.id = 'completeRectHint';
    completeRectHint.style.cssText = [
        'position:fixed', 'top:70px', 'left:50%', 'transform:translateX(-50%)',
        'background:rgba(230,81,0,0.92)', 'color:white', 'padding:8px 18px',
        'border-radius:20px', 'font-size:13px', 'font-weight:bold',
        'z-index:9999', 'pointer-events:none',
        'box-shadow:0 2px 10px rgba(0,0,0,0.3)'
    ].join(';');
    completeRectHint.textContent = _isTouchDevice()
        ? '👆 拖曳框選節點範圍（更新完工狀態）'
        : '🏗️ 拖曳框選節點範圍，按 Esc 取消';
    document.body.appendChild(completeRectHint);

    _completeRectMoveFn = function(ev) {
        if (!completeRectStart) return;
        const bounds = L.latLngBounds(completeRectStart, ev.latlng);
        if (completeRectLayer) map.removeLayer(completeRectLayer);
        completeRectLayer = L.rectangle(bounds, {
            color: '#e65100', weight: 2, dashArray: '6,4',
            fillColor: '#e65100', fillOpacity: 0.12
        }).addTo(map);
    };

    _completeRectDownFn = function(e) {
        if (!completeRectMode) return;
        completeRectStart = e.latlng;
        map.on('mousemove', _completeRectMoveFn);
        const upHandler = function() {
            map.off('mousemove', _completeRectMoveFn);
            document.removeEventListener('mouseup', upHandler);
            if (!completeRectStart) return;
            const bounds = completeRectLayer
                ? completeRectLayer.getBounds()
                : L.latLngBounds(completeRectStart, completeRectStart);
            completeRectStart = null;
            finishCompleteRectSelect(bounds);
        };
        document.addEventListener('mouseup', upHandler);
    };
    map.on('mousedown', _completeRectDownFn);

    // 觸控
    const mapContainer = map.getContainer();
    const getTouchLatLng = function(touch) {
        const rect = mapContainer.getBoundingClientRect();
        const point = L.point(touch.clientX - rect.left, touch.clientY - rect.top);
        return map.containerPointToLatLng(point);
    };
    _completeRectTouchMoveFn = function(e) {
        if (!completeRectMode || !completeRectStart || e.touches.length !== 1) return;
        e.preventDefault();
        const latlng = getTouchLatLng(e.touches[0]);
        const bounds = L.latLngBounds(completeRectStart, latlng);
        if (completeRectLayer) map.removeLayer(completeRectLayer);
        completeRectLayer = L.rectangle(bounds, {
            color: '#e65100', weight: 2, dashArray: '6,4',
            fillColor: '#e65100', fillOpacity: 0.12
        }).addTo(map);
    };
    _completeRectTouchEndFn = function(e) {
        if (!completeRectStart) return;
        const bounds = completeRectLayer
            ? completeRectLayer.getBounds()
            : L.latLngBounds(completeRectStart, completeRectStart);
        completeRectStart = null;
        mapContainer.removeEventListener('touchmove', _completeRectTouchMoveFn);
        mapContainer.removeEventListener('touchend', _completeRectTouchEndFn);
        finishCompleteRectSelect(bounds);
    };
    mapContainer.addEventListener('touchstart', function onTouchStart(e) {
        if (!completeRectMode || e.touches.length !== 1) return;
        completeRectStart = getTouchLatLng(e.touches[0]);
        mapContainer.addEventListener('touchmove', _completeRectTouchMoveFn, { passive: false });
        mapContainer.addEventListener('touchend', _completeRectTouchEndFn, { once: true });
        mapContainer.removeEventListener('touchstart', onTouchStart);
    }, { once: true });

    completeRectKeyHandler = function(e) {
        if (e.key === 'Escape') cancelCompleteRectSelect();
    };
    document.addEventListener('keydown', completeRectKeyHandler);
};

function cancelCompleteRectSelect() {
    completeRectMode = false;
    completeRectStart = null;
    if (completeRectLayer) { map.removeLayer(completeRectLayer); completeRectLayer = null; }
    if (completeRectHint) { completeRectHint.remove(); completeRectHint = null; }
    if (_completeRectMoveFn) { map.off('mousemove', _completeRectMoveFn); _completeRectMoveFn = null; }
    if (_completeRectDownFn) { map.off('mousedown', _completeRectDownFn); _completeRectDownFn = null; }
    if (_completeRectTouchMoveFn) {
        map.getContainer().removeEventListener('touchmove', _completeRectTouchMoveFn);
        _completeRectTouchMoveFn = null;
    }
    if (_completeRectTouchEndFn) {
        map.getContainer().removeEventListener('touchend', _completeRectTouchEndFn);
        _completeRectTouchEndFn = null;
    }
    if (completeRectKeyHandler) { document.removeEventListener('keydown', completeRectKeyHandler); completeRectKeyHandler = null; }
    map.dragging.enable();
    map.getContainer().style.cursor = '';
}

function finishCompleteRectSelect(bounds) {
    cancelCompleteRectSelect();

    // 找框選內的節點
    const hitNodes = [];
    for (const marker of nodeMarkers) {
        if (!marker.nodeData) continue;
        if (bounds.contains(marker.getLatLng())) {
            hitNodes.push(marker.nodeData);
        }
    }

    if (hitNodes.length < 2) {
        showToast('請至少框選到 2 個節點', 'warning');
        return;
    }

    // 🆕 共用範圍計算：支援跨分支（支線節點A＋主線節點B → 兩個範圍涵蓋完整管路）
    const hasBranches = currentPipeline.branches && Object.keys(currentPipeline.branches).length > 0;
    const ranges = computeRectNodeRanges(hitNodes);
    const entries = [];
    for (const r of ranges) {
        const branchKey = `B${r.branchIndex}`;
        if (hasBranches) {
            const branchSegs = currentPipeline.branches[branchKey];
            if (!branchSegs || branchSegs.length === 0) continue;
            entries.push({
                segmentNumber: branchKey,
                branchIndex: r.branchIndex,
                minSmallIndex: r.minIdx,
                maxSmallIndex: r.maxIdx,
                fromNode: r.fromNode,
                toNode: r.toNode,
                branchSegs: branchSegs,
                isNewArch: true
            });
        } else {
            const seg = currentPipeline.segments.find(s =>
                String(s.segmentNumber) === branchKey || String(s.branchIndex) === String(r.branchIndex)
            );
            if (!seg) continue;
            entries.push({
                segmentNumber: seg.segmentNumber,
                branchIndex: r.branchIndex,
                minSmallIndex: r.minIdx,
                maxSmallIndex: r.maxIdx,
                fromNode: r.fromNode,
                toNode: r.toNode,
                segment: seg,
                isNewArch: false
            });
        }
    }

    if (entries.length === 0) {
        showToast('請在同一分支上框選至少 2 個節點', 'warning');
        return;
    }

    if (entries.length === 1) {
        showCompleteStatusPicker(entries[0]);
    } else {
        showCompleteSegmentPicker(entries);
    }
}

// 選要操作哪個段落（多段落時）
function showCompleteSegmentPicker(entries) {
    const old = document.getElementById('completeSegPickerModal');
    if (old) old.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'completeSegPickerModal';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;';

    const box = document.createElement('div');
    box.style.cssText = 'background:white;border-radius:12px;padding:20px;min-width:300px;max-width:440px;box-shadow:0 8px 32px rgba(0,0,0,0.3);';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:bold;font-size:14px;margin-bottom:12px;color:#e65100;';
    title.textContent = `🏗️ 找到 ${entries.length} 個段落，請選擇要更新完工狀態的段落：`;
    box.appendChild(title);

    entries.forEach(e => {
        const count = e.maxSmallIndex - e.minSmallIndex + 1;
        const btn = document.createElement('button');
        btn.style.cssText = 'display:block;width:100%;text-align:left;padding:10px 12px;margin-bottom:6px;border:1px solid #ddd;border-radius:8px;cursor:pointer;background:#f9f9f9;font-size:13px;';
        btn.innerHTML = `<strong>段落 #${e.segmentNumber}</strong> <span style="color:#e65100;font-weight:bold;">${e.fromNode} → ${e.toNode}</span> <span style="color:#888;font-size:11px;">（共 ${count} 個小段）</span>`;
        btn.onmouseover = () => btn.style.background = '#fff3e0';
        btn.onmouseout = () => btn.style.background = '#f9f9f9';
        btn.onclick = () => { backdrop.remove(); showCompleteStatusPicker(e); };
        box.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'display:block;width:100%;padding:8px;margin-top:4px;border:none;border-radius:6px;cursor:pointer;background:#eee;color:#666;font-size:13px;';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => backdrop.remove();
    box.appendChild(cancelBtn);

    backdrop.appendChild(box);
    backdrop.addEventListener('click', ev => { if (ev.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
}

// 彈出選單：選完工 or 未完工
function showCompleteStatusPicker(entry) {
    const old = document.getElementById('completeStatusPickerModal');
    if (old) old.remove();

    const count = entry.maxSmallIndex - entry.minSmallIndex + 1;

    const backdrop = document.createElement('div');
    backdrop.id = 'completeStatusPickerModal';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9000;display:flex;align-items:center;justify-content:center;';

    const box = document.createElement('div');
    box.style.cssText = 'background:white;border-radius:12px;padding:24px;min-width:280px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.3);text-align:center;';

    const title = document.createElement('div');
    title.style.cssText = 'font-weight:bold;font-size:15px;margin-bottom:6px;color:#333;';
    title.textContent = '🏗️ 批次更新完工狀態';
    box.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'font-size:12px;color:#666;margin-bottom:18px;';
    subtitle.textContent = `段落 #${entry.segmentNumber}｜${entry.fromNode} → ${entry.toNode}｜共 ${count} 個小段`;
    box.appendChild(subtitle);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;margin-bottom:10px;';

    const completeBtn = document.createElement('button');
    completeBtn.style.cssText = 'flex:1;padding:14px 8px;border:none;border-radius:10px;cursor:pointer;background:#00897b;color:white;font-size:14px;font-weight:bold;';
    completeBtn.innerHTML = '✅ 標記完工';
    completeBtn.onclick = () => { backdrop.remove(); executeBatchComplete(entry, true); };

    const incompleteBtn = document.createElement('button');
    incompleteBtn.style.cssText = 'flex:1;padding:14px 8px;border:none;border-radius:10px;cursor:pointer;background:#e53935;color:white;font-size:14px;font-weight:bold;';
    incompleteBtn.innerHTML = '❌ 標記未完工';
    incompleteBtn.onclick = () => { backdrop.remove(); executeBatchComplete(entry, false); };

    btnRow.appendChild(completeBtn);
    btnRow.appendChild(incompleteBtn);
    box.appendChild(btnRow);

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'display:block;width:100%;padding:8px;border:none;border-radius:6px;cursor:pointer;background:#eee;color:#666;font-size:13px;';
    cancelBtn.textContent = '取消';
    cancelBtn.onclick = () => backdrop.remove();
    box.appendChild(cancelBtn);

    backdrop.appendChild(box);
    backdrop.addEventListener('click', ev => { if (ev.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
}

// 執行批次更新（支援新/舊架構）
async function executeBatchComplete(entry, isComplete) {
    if (!requireLogin()) return;

    const { segmentNumber, minSmallIndex, maxSmallIndex, branchIndex } = entry;
    const count = maxSmallIndex - minSmallIndex + 1;
    const branchKey = `B${branchIndex}`;

    const today = new Date();
    const dateStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    const statusValue = isComplete ? dateStr : '0';

    // Optimistic UI：立即更新 polyline 粗細
    const visualUpdates = [];
    for (let i = minSmallIndex; i <= maxSmallIndex; i++) {
        const trackKey = `${branchKey}-${i}`;
        const tracked = smallSegmentPolylines[trackKey];
        if (tracked) {
            tracked.polyline.setStyle({
                weight: isComplete ? 6 : 3,
                opacity: isComplete ? 1 : 0.5,
            });
        }
        visualUpdates.push({ trackKey, tracked });
    }

    showToast(`🔄 正在更新 ${count} 個小段...`, 'info', 2000);

    if (entry.isNewArch) {
        // ===== 新架構：逐一呼叫 updateSmallSegmentInfo =====
        const branchSegs = entry.branchSegs;
        const promises = [];
        for (let i = minSmallIndex; i <= maxSmallIndex; i++) {
            const seg = branchSegs.find(s => s.smallIndex === i);
            if (!seg) continue;
            promises.push(
                apiCall('updateSmallSegmentInfo', {
                    pipelineId: currentPipeline.id,
                    segmentNumber: branchKey,
                    smallIndex: i,
                    diameter: seg.diameter || '',
                    pipeType: seg.pipeType || '',
                    method: seg.method || '',
                    status: statusValue,
                }).then(() => {
                    seg.status = statusValue;
                })
            );
        }

        try {
            await Promise.all(promises);
            showToast(`✅ ${count} 個小段已${isComplete ? '標記完工' : '取消完工'}`, 'success');
            showStatsPanel();
            currentPipeline._progressLoaded = false;
            showPipelineDetail(currentPipeline.id, true);
        } catch (error) {
            // 回退視覺
            for (const { trackKey, tracked } of visualUpdates) {
                if (tracked) {
                    tracked.polyline.setStyle({
                        weight: !isComplete ? 6 : 3,
                        opacity: !isComplete ? 1 : 0.5,
                    });
                }
            }
            showToast('更新失敗：' + error.message, 'error');
        }
    } else {
        // ===== 舊架構：用 updateWholeSegment 一次送出 =====
        const segment = entry.segment;
        const segLength = segment.endDistance - segment.startDistance;
        const numSmall = Math.ceil(segLength / 10);
        const arr = (segment.smallSegments || '').split(',').map(s => s.trim());
        while (arr.length < numSmall) arr.push('0');
        const oldArr = [...arr];

        for (let i = minSmallIndex; i <= maxSmallIndex; i++) {
            arr[i] = statusValue;
        }
        const newStatusString = arr.join(',');
        segment.smallSegments = newStatusString;

        // 也用 batchUpdateSmallSegmentVisuals 更新
        const oldVisuals = [];
        for (let i = minSmallIndex; i <= maxSmallIndex; i++) {
            oldVisuals.push({ segmentNumber, smallIndex: i, isCompleted: isComplete });
        }
        batchUpdateSmallSegmentVisuals(oldVisuals);

        try {
            const result = await apiCall('updateWholeSegment', {
                pipelineId: currentPipeline.id,
                statusString: newStatusString,
                segmentNumber: segmentNumber
            });
            if (!result.success) throw new Error(result.error || '更新失敗');
            showToast(`✅ ${count} 個小段已${isComplete ? '標記完工' : '取消完工'}`, 'success');

            const progressData = await apiCall('getProgress', { pipelineId: currentPipeline.id });
            if (progressData.segments) {
                const segments = parseBranchIndexFromSegments(progressData.segments);
                const pipelineIndex = allPipelines.findIndex(p => p.id === currentPipeline.id);
                if (pipelineIndex !== -1) allPipelines[pipelineIndex].segments = segments;
                currentPipeline.segments = segments;
            }
            showStatsPanel();

            let completed = 0;
            const finalArr = newStatusString.split(',').map(s => s.trim());
            for (let i = 0; i < numSmall; i++) {
                const v = finalArr[i] || '0';
                if (v !== '0' && v !== '') completed += Math.min(10, segLength - i * 10);
            }
            updateSegmentLabel(segmentNumber, completed, segLength);
        } catch (error) {
            batchUpdateSmallSegmentVisuals(oldVisuals.map(u => ({ ...u, isCompleted: !isComplete })));
            segment.smallSegments = oldArr.join(',');
            showToast('更新失敗：' + error.message, 'error');
        }
    }
}

// ==================== 圈選共用：跨分支節點範圍計算 ====================
// 三個圈選功能（建甘特/更新完工/設定屬性）共用。
// 規則：
//   - 同一分支框到 2 個以上節點 → 取最小~最大（原本行為）。
//   - 只框到 1 個節點的分支 → 自動延伸到「與另一個被選分支的交會點」：
//     例如框住支線的節點A＋主線的節點B，會得到兩個範圍：
//     主線【節點B ~ 交會點】＋支線【交會點 ~ 節點A】，涵蓋兩點之間的完整管路。
//   - 單節點分支若與其他被選分支沒有相接（>1m），維持舊行為忽略之。
// 回傳 [{ branchIndex, minIdx, maxIdx, fromNode, toNode }]
function computeRectNodeRanges(hitNodes) {
    const branchGroups = {};
    hitNodes.forEach(function(n) {
        if (!branchGroups[n.branchIndex]) branchGroups[n.branchIndex] = [];
        branchGroups[n.branchIndex].push(n);
    });
    Object.keys(branchGroups).forEach(function(k) {
        branchGroups[k].sort(function(a, b) { return a.smallIndex - b.smallIndex; });
    });
    const bIdxs = Object.keys(branchGroups).map(Number);

    function mkRange(bi, lo, hi) {
        return {
            branchIndex: bi, minIdx: lo.smallIndex, maxIdx: hi.smallIndex,
            fromNode: lo.nodeName || ('#' + (lo.smallIndex + 1)),
            toNode: hi.nodeName || ('#' + (hi.smallIndex + 1))
        };
    }

    const ranges = [];
    if (bIdxs.length === 1) {
        const nodes = branchGroups[bIdxs[0]];
        if (nodes.length >= 2) ranges.push(mkRange(bIdxs[0], nodes[0], nodes[nodes.length - 1]));
        return ranges;
    }

    // ── 跨分支：需要幾何拓撲（找交會點） ──
    const parsed = parseLineStringWithBranches(currentPipeline.linestring);
    function coordsOf(bi) {
        const br = parsed.branches[bi];
        return br ? br.coords : null;
    }
    // pt 到分支 bi 的最近點：回傳 { d: 最近距離(米), dist: 該點的沿線累積距離(米) }
    // 🐛 注意：必須做「點到線段」投影，不能只比對頂點——支線通常接在主線
    // 某個直線段的中間，不會剛好落在頂點上。
    function nearestOn(bi, pt) {
        const cs = coordsOf(bi);
        if (!cs || cs.length < 2) return null;
        const cosLat = Math.cos(pt[0] * Math.PI / 180);
        const toXY = function(c) { return [c[1] * 111320 * cosLat, c[0] * 110540]; };
        const P = toXY(pt);
        let acc = 0, best = { d: Infinity, dist: 0 };
        for (let i = 1; i < cs.length; i++) {
            const A = toXY(cs[i - 1]), B = toXY(cs[i]);
            const ABx = B[0] - A[0], ABy = B[1] - A[1];
            const segLen2 = ABx * ABx + ABy * ABy;
            let t = segLen2 > 0 ? ((P[0] - A[0]) * ABx + (P[1] - A[1]) * ABy) / segLen2 : 0;
            t = Math.max(0, Math.min(1, t));
            const qx = A[0] + ABx * t, qy = A[1] + ABy * t;
            const d = Math.sqrt((P[0] - qx) * (P[0] - qx) + (P[1] - qy) * (P[1] - qy));
            const segLen = getDistance(cs[i - 1], cs[i]);
            if (d < best.d) best = { d: d, dist: acc + segLen * t };
            acc += segLen;
        }
        return best;
    }
    function lastIdxOf(bi) {
        const segs = currentPipeline.branches['B' + bi] || [];
        return segs.length ? segs[segs.length - 1].smallIndex : 0;
    }

    let ignored = 0;
    bIdxs.forEach(function(bi) {
        const nodes = branchGroups[bi];
        if (nodes.length >= 2) {
            ranges.push(mkRange(bi, nodes[0], nodes[nodes.length - 1]));
            return;
        }
        // 單節點分支：找它與其他被選分支的交會端
        const node = nodes[0];
        const cs = coordsOf(bi);
        if (!cs) { ignored++; return; }
        let junctionIdx = null;
        for (let k = 0; k < bIdxs.length && junctionIdx === null; k++) {
            const other = bIdxs[k];
            if (other === bi) continue;
            // 本分支的起點/終點是否貼在另一分支上（Y 型：支線起點接在主線上；串接：頭尾相接）
            const sHit = nearestOn(other, cs[0]);
            if (sHit && sHit.d < 1) { junctionIdx = 0; break; }
            const eHit = nearestOn(other, cs[cs.length - 1]);
            if (eHit && eHit.d < 1) { junctionIdx = lastIdxOf(bi); break; }
            // 反向：另一分支的端點貼在本分支上（本分支是主線）
            const ocs = coordsOf(other);
            if (ocs) {
                const oS = nearestOn(bi, ocs[0]);
                if (oS && oS.d < 1) { junctionIdx = Math.min(Math.floor(oS.dist / 10), lastIdxOf(bi)); break; }
                const oE = nearestOn(bi, ocs[ocs.length - 1]);
                if (oE && oE.d < 1) { junctionIdx = Math.min(Math.floor(oE.dist / 10), lastIdxOf(bi)); break; }
            }
        }
        if (junctionIdx === null) { ignored++; return; }
        const jFake = { smallIndex: junctionIdx, nodeName: '交會點' };
        if (node.smallIndex <= junctionIdx) ranges.push(mkRange(bi, node, jFake));
        else ranges.push(mkRange(bi, jFake, node));
    });
    if (ignored > 0) showToast('已忽略 ' + ignored + ' 個與其他被選分支不相接的節點', 'info');
    return ranges;
}

// ==================== 圈選設定屬性：拖框選取小段範圍 → 開啟範圍屬性對話框 ====================
// 與「圈選更新完工」同一套拖框機制；差別在命中的是「小段」本身（不需依賴節點名稱），
// 框到的每個分支取最小~最大小段編號，接到既有的 showRangeSetDialog。
let attrsRectMode = false, attrsRectStart = null, attrsRectLayer = null, attrsRectHint = null;
let _attrsRectMoveFn = null, _attrsRectDownFn = null, attrsRectKeyHandler = null;
let _attrsRectTouchMoveFn = null, _attrsRectTouchEndFn = null;

window.startAttrsRectSelect = function() {
    if (!currentPipeline) { showToast('請先選擇一個工程', 'warning'); return; }
    if (!requireLogin()) return;
    if (attrsRectMode) { cancelAttrsRectSelect(); return; }

    attrsRectMode = true;
    attrsRectStart = null;
    map.dragging.disable();
    map.getContainer().style.cursor = 'crosshair';

    attrsRectHint = document.createElement('div');
    attrsRectHint.style.cssText = [
        'position:fixed', 'top:70px', 'left:50%', 'transform:translateX(-50%)',
        'background:rgba(33,150,243,0.92)', 'color:white', 'padding:8px 18px',
        'border-radius:20px', 'font-size:13px', 'font-weight:bold',
        'z-index:9999', 'pointer-events:none',
        'box-shadow:0 2px 10px rgba(0,0,0,0.3)'
    ].join(';');
    attrsRectHint.textContent = _isTouchDevice()
        ? '👆 拖曳框選要設定屬性的管段範圍'
        : '📏 拖曳框選要設定屬性的管段範圍，按 Esc 取消';
    document.body.appendChild(attrsRectHint);

    _attrsRectMoveFn = function(ev) {
        if (!attrsRectStart) return;
        const bounds = L.latLngBounds(attrsRectStart, ev.latlng);
        if (attrsRectLayer) map.removeLayer(attrsRectLayer);
        attrsRectLayer = L.rectangle(bounds, {
            color: '#2196F3', weight: 2, dashArray: '6,4',
            fillColor: '#2196F3', fillOpacity: 0.12
        }).addTo(map);
    };

    _attrsRectDownFn = function(e) {
        if (!attrsRectMode) return;
        attrsRectStart = e.latlng;
        map.on('mousemove', _attrsRectMoveFn);
        const upHandler = function() {
            map.off('mousemove', _attrsRectMoveFn);
            document.removeEventListener('mouseup', upHandler);
            if (!attrsRectStart) return;
            const bounds = attrsRectLayer
                ? attrsRectLayer.getBounds()
                : L.latLngBounds(attrsRectStart, attrsRectStart);
            attrsRectStart = null;
            finishAttrsRectSelect(bounds);
        };
        document.addEventListener('mouseup', upHandler);
    };
    map.on('mousedown', _attrsRectDownFn);

    // 觸控
    const mapContainer = map.getContainer();
    const getTouchLatLng = function(touch) {
        const rect = mapContainer.getBoundingClientRect();
        const point = L.point(touch.clientX - rect.left, touch.clientY - rect.top);
        return map.containerPointToLatLng(point);
    };
    _attrsRectTouchMoveFn = function(e) {
        if (!attrsRectMode || !attrsRectStart || e.touches.length !== 1) return;
        e.preventDefault();
        const latlng = getTouchLatLng(e.touches[0]);
        const bounds = L.latLngBounds(attrsRectStart, latlng);
        if (attrsRectLayer) map.removeLayer(attrsRectLayer);
        attrsRectLayer = L.rectangle(bounds, {
            color: '#2196F3', weight: 2, dashArray: '6,4',
            fillColor: '#2196F3', fillOpacity: 0.12
        }).addTo(map);
    };
    _attrsRectTouchEndFn = function(e) {
        if (!attrsRectStart) return;
        const bounds = attrsRectLayer
            ? attrsRectLayer.getBounds()
            : L.latLngBounds(attrsRectStart, attrsRectStart);
        attrsRectStart = null;
        mapContainer.removeEventListener('touchmove', _attrsRectTouchMoveFn);
        mapContainer.removeEventListener('touchend', _attrsRectTouchEndFn);
        finishAttrsRectSelect(bounds);
    };
    mapContainer.addEventListener('touchstart', function onTouchStart(e) {
        if (!attrsRectMode || e.touches.length !== 1) return;
        attrsRectStart = getTouchLatLng(e.touches[0]);
        mapContainer.addEventListener('touchmove', _attrsRectTouchMoveFn, { passive: false });
        mapContainer.addEventListener('touchend', _attrsRectTouchEndFn, { once: true });
        mapContainer.removeEventListener('touchstart', onTouchStart);
    }, { once: true });

    attrsRectKeyHandler = function(e) {
        if (e.key === 'Escape') cancelAttrsRectSelect();
    };
    document.addEventListener('keydown', attrsRectKeyHandler);
};

function cancelAttrsRectSelect() {
    attrsRectMode = false;
    attrsRectStart = null;
    if (attrsRectLayer) { map.removeLayer(attrsRectLayer); attrsRectLayer = null; }
    if (attrsRectHint) { attrsRectHint.remove(); attrsRectHint = null; }
    if (_attrsRectMoveFn) { map.off('mousemove', _attrsRectMoveFn); _attrsRectMoveFn = null; }
    if (_attrsRectDownFn) { map.off('mousedown', _attrsRectDownFn); _attrsRectDownFn = null; }
    if (_attrsRectTouchMoveFn) {
        map.getContainer().removeEventListener('touchmove', _attrsRectTouchMoveFn);
        _attrsRectTouchMoveFn = null;
    }
    if (_attrsRectTouchEndFn) {
        map.getContainer().removeEventListener('touchend', _attrsRectTouchEndFn);
        _attrsRectTouchEndFn = null;
    }
    if (attrsRectKeyHandler) { document.removeEventListener('keydown', attrsRectKeyHandler); attrsRectKeyHandler = null; }
    map.dragging.enable();
    map.getContainer().style.cursor = '';
}

function finishAttrsRectSelect(bounds) {
    cancelAttrsRectSelect();

    // 命中判定：與「圈選更新完工」完全相同——以框到的「節點名牌」為準，
    // 同一分支至少要框到 2 個節點，取最小~最大節點之間的範圍。
    const hitNodes = [];
    for (const marker of nodeMarkers) {
        if (!marker.nodeData) continue;
        if (bounds.contains(marker.getLatLng())) {
            hitNodes.push(marker.nodeData);
        }
    }

    if (hitNodes.length < 2) {
        showToast('請至少框選到 2 個節點', 'warning');
        return;
    }

    // 🆕 共用範圍計算：支援跨分支（支線節點A＋主線節點B → 兩個範圍一次設定）
    const ranges = computeRectNodeRanges(hitNodes);
    if (ranges.length === 0) {
        showToast('請框選到可構成範圍的節點（同分支 2 個、或相接分支各 1 個）', 'warning');
        return;
    }
    // 接上範圍屬性對話框：第一個範圍為主，其餘一併套用
    showRangeSetDialog(ranges[0].branchIndex, ranges[0].minIdx, ranges[0].maxIdx, ranges.slice(1));
}
