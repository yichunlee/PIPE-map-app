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
            weight: item.isCompleted ? 8 : 4,
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
                weight: item.isCompleted ? 8 : 4,
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
        weight: isCompleted ? 6 : 3,
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

