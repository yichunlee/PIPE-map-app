// ========== 段落右鍵選單功能 ==========

function showSegmentContextMenu(e, segment, color) {
    L.DomEvent.stopPropagation(e);
    L.DomEvent.preventDefault(e);
    
    const segLength = segment.endDistance - segment.startDistance;
    const numSmallSegments = Math.ceil(segLength / 10);
    
    // 計算完工狀態
    const smallSegmentsStatus = segment.smallSegments || '';
    const statusArray = smallSegmentsStatus.split(',').map(s => s.trim());
    let completedCount = 0;
    for (let i = 0; i < numSmallSegments; i++) {
        const statusValue = statusArray[i] || '0';
        if (statusValue !== '0' && statusValue.trim() !== '') {
            completedCount++;
        }
    }
    
    const methodLabel = [segment.diameter, segment.pipeType, segment.method].filter(Boolean).join(' ');
    
    L.popup()
        .setLatLng(e.latlng)
        .setContent(`
            <div class="popup-title">段落 ${segment.segmentNumber}</div>
            <div class="popup-info">📏 ${segment.startDistance}m - ${segment.endDistance}m (${Math.round(segLength)}m)</div>
            <div class="popup-info">⚙️ ${methodLabel}</div>
            <div class="popup-info">📊 完工：${completedCount}/${numSmallSegments} 個小段</div>
            <div style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">
                <button class="popup-button" onclick="markWholeSegmentComplete('${segment.segmentNumber}')">
                    ✓ 標記整段完工
                </button>
                <button class="popup-button" onclick="markWholeSegmentIncomplete('${segment.segmentNumber}')" style="background: #e74c3c;">
                    ❌ 標記整段未完工
                </button>
            </div>
        `)
        .openOn(map);
}

// 標記整個段落為完工
window.markWholeSegmentComplete = async function(segmentNumber) {
    if (!requireLogin()) return;
    map.closePopup();
    const segment = currentPipeline.segments.find(s => s.segmentNumber == segmentNumber);
    if (!segment) {
        showToast('找不到段落！', 'error');
        return;
    }
    
    const segLength = segment.endDistance - segment.startDistance;
    const numSmallSegments = Math.ceil(segLength / 10);
    
    const confirmed = await showConfirm({ title: '整段標記完工', message: `確定要將段落 ${segmentNumber} 的全部 ${numSmallSegments} 個小段標記為完工嗎？`, okText: '全段完工', icon: '✅' });
    if (!confirmed) return;
    
    // 🚀 Optimistic UI：先立即更新所有小段的視覺
    const visualUpdates = [];
    for (let i = 0; i < numSmallSegments; i++) {
        visualUpdates.push({
            segmentNumber: segmentNumber,
            smallIndex: i,
            isCompleted: true
        });
    }
    batchUpdateSmallSegmentVisuals(visualUpdates);
    
    // 同步更新 segment.smallSegments，確保後續點擊小段時狀態正確
    const _today = new Date();
    const _sv = _today.getFullYear() + '-' + String(_today.getMonth()+1).padStart(2,'0') + '-' + String(_today.getDate()).padStart(2,'0');
    segment.smallSegments = new Array(numSmallSegments).fill(_sv).join(',');
    
    console.log('🔄 背景儲存中...');
    
    try {
        // 取得今天日期
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        const statusValue = `${year}-${month}-${day}`;
        
        // 建立完整的狀態陣列
        const statusArray = new Array(numSmallSegments).fill(statusValue);
        const statusString = statusArray.join(',');
        
        // 一次性更新整個段落
        const result = await apiCall('updateWholeSegment', { pipelineId: currentPipeline.id, statusString: statusString, segmentNumber: segmentNumber });
        
        if (!result.success) {
            throw new Error(result.error || '更新失敗');
        }
        
        console.log('✅ 背景儲存完成');
        
        // 清空選取陣列
        selectedSmallSegments = [];
        lastClickedSmallSegment = null;
        
        // 🚀 效能優化：不重繪地圖,只更新資料和統計面板
        const progressData = await apiCall('getProgress');
        
        if (progressData.segments) {
            const segments = parseBranchIndexFromSegments(progressData.segments);
            const pipelineIndex = allPipelines.findIndex(p => p.id === currentPipeline.id);
            if (pipelineIndex !== -1) {
                allPipelines[pipelineIndex].segments = segments;
            }
            currentPipeline.segments = segments;
        }
        
        showStatsPanel();
        // 即時更新地圖 label：完工 = 全段長度
        const _segLen = segment.endDistance - segment.startDistance;
        updateSegmentLabel(segmentNumber, _segLen, _segLen);
        map.closePopup();
        console.log('✅ 段落標記完成！');
    } catch (error) {
        // 發生錯誤時回退視覺狀態
        console.error('❌ 儲存失敗,回退視覺狀態:', error.message);
        const rollbackUpdates = visualUpdates.map(u => ({
            ...u,
            isCompleted: false
        }));
        batchUpdateSmallSegmentVisuals(rollbackUpdates);
        showToast('更新失敗：' + error.message, 'error');
    }
};

// 標記整個段落為未完工
window.markWholeSegmentIncomplete = async function(segmentNumber) {
    if (!requireLogin()) return;
    map.closePopup();
    const segment = currentPipeline.segments.find(s => s.segmentNumber == segmentNumber);
    if (!segment) {
        showToast('找不到段落！', 'error');
        return;
    }
    
    const segLength = segment.endDistance - segment.startDistance;
    const numSmallSegments = Math.ceil(segLength / 10);
    
    const confirmed = await showConfirm({ title: '整段取消完工', message: `確定要取消段落 ${segmentNumber} 的全部 ${numSmallSegments} 個小段的完工狀態嗎？`, okText: '取消完工', danger: true });
    if (!confirmed) return;
    
    // 🚀 Optimistic UI：先立即更新所有小段的視覺
    const visualUpdates = [];
    for (let i = 0; i < numSmallSegments; i++) {
        visualUpdates.push({
            segmentNumber: segmentNumber,
            smallIndex: i,
            isCompleted: false
        });
    }
    batchUpdateSmallSegmentVisuals(visualUpdates);
    
    // 同步更新 segment.smallSegments，確保後續點擊小段時狀態正確
    segment.smallSegments = new Array(numSmallSegments).fill('0').join(',');
    
    console.log('🔄 背景儲存中...');
    
    try {
        // 建立完整的狀態陣列（全部為 0）
        const statusArray = new Array(numSmallSegments).fill('0');
        const statusString = statusArray.join(',');
        
        // 一次性更新整個段落
        const result = await apiCall('updateWholeSegment', { pipelineId: currentPipeline.id, statusString: statusString, segmentNumber: segmentNumber });
        
        if (!result.success) {
            throw new Error(result.error || '更新失敗');
        }
        
        console.log('✅ 背景儲存完成');
        
        // 清空選取陣列
        selectedSmallSegments = [];
        lastClickedSmallSegment = null;
        
        // 🚀 效能優化：不重繪地圖,只更新資料和統計面板
        const progressData = await apiCall('getProgress');
        
        if (progressData.segments) {
            const segments = parseBranchIndexFromSegments(progressData.segments);
            const pipelineIndex = allPipelines.findIndex(p => p.id === currentPipeline.id);
            if (pipelineIndex !== -1) {
                allPipelines[pipelineIndex].segments = segments;
            }
            currentPipeline.segments = segments;
        }
        
        showStatsPanel();
        // 即時更新地圖 label：未完工 = 0m
        updateSegmentLabel(segmentNumber, 0, segment.endDistance - segment.startDistance);
        map.closePopup();
        console.log('✅ 段落標記完成！');
    } catch (error) {
        // 發生錯誤時回退視覺狀態
        console.error('❌ 儲存失敗,回退視覺狀態:', error.message);
        const rollbackUpdates = visualUpdates.map(u => ({
            ...u,
            isCompleted: true
        }));
        batchUpdateSmallSegmentVisuals(rollbackUpdates);
        showToast('更新失敗：' + error.message, 'error');
    }
};

function showSmallSegmentPopup(latlng, segment, smallIndex, smallStart, smallEnd, isCompleted) {
    const statusIcon = isCompleted ? '🟢' : '⚪';
    
    // 🆕 取得狀態值（可能是 "1" 或日期）
    const smallSegmentsStatus = segment.smallSegments || '';
    const statusArray = smallSegmentsStatus.split(',').map(s => s.trim());
    const statusValue = statusArray[smallIndex] || '0';
    
    // 判斷顯示文字
    let statusText = '未完工';
    if (isCompleted) {
        if (statusValue === '1') {
            statusText = '已完工';
        } else if (statusValue.includes('-')) {
            statusText = `完工日期：${statusValue}`;
        } else {
            statusText = '已完工';
        }
    }
    
    const popup = L.popup()
        .setLatLng(latlng)
        .setContent(`
            <div class="popup-title">小段 #${smallIndex + 1}</div>
            <div class="popup-info">📍 位置：${smallStart}m - ${smallEnd}m (${smallEnd - smallStart}m)</div>
            <div class="popup-info">🔧 管徑：${segment.diameter || '未設定'}</div>
            <div class="popup-info">🔩 管種：${segment.pipeType || '未設定'}</div>
            <div class="popup-info">⚙️ 施工方式：${segment.method || '未設定'}</div>
            <div class="popup-info">📊 狀態：${statusText} ${statusIcon}</div>
            <div style="font-size: 11px; color: #666; margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;">
                所屬段落：段落${segment.segmentNumber} (${segment.startDistance}-${segment.endDistance}m)
            </div>
            <button class="popup-button" onclick="toggleSmallSegment(&quot;${segment.segmentNumber}&quot;, ${smallIndex}, ${!isCompleted})">
                ${isCompleted ? '❌ 標記未完工' : '✓ 標記完工'}
            </button>
        `)
        .openOn(map);
}

// 切換小段狀態
window.toggleSmallSegment = async function(segmentNumber, smallIndex, newStatus) {
    if (!requireLogin()) return;
    console.log('========== 切換小段 DEBUG ==========');
    console.log('currentPipeline:', currentPipeline);
    console.log('currentPipeline.id:', currentPipeline ? currentPipeline.id : 'currentPipeline is null');
    console.log('currentPipeline.segments:', currentPipeline ? currentPipeline.segments : 'currentPipeline is null');
    console.log('segmentNumber:', segmentNumber, 'type:', typeof segmentNumber);
    console.log('smallIndex:', smallIndex, 'type:', typeof smallIndex);
    console.log('newStatus:', newStatus);
    console.log('=====================================');
    
    if (!currentPipeline) {
        showToast('錯誤：目前沒有選擇工程！', 'error');
        return;
    }
    
    if (!currentPipeline.id) {
        showToast('錯誤：工程 ID 不存在！', 'error');
        console.error('currentPipeline 物件:', currentPipeline);
        return;
    }
    
    console.log(`切換小段: 段落${segmentNumber}, 小段${smallIndex}, 新狀態=${newStatus ? '完工' : '未完工'}`);
    console.log('工程ID:', currentPipeline.id);
    
    // 檢查段落是否存在
    const segment = currentPipeline.segments.find(s => s.segmentNumber == segmentNumber);
    if (!segment) {
        showToast('找不到段落 #' + segmentNumber, 'error');
        console.error('找不到段落', segmentNumber, '可用段落:', currentPipeline.segments.map(s => s.segmentNumber));
        return;
    }
    
    try {
        // 🆕 如果是標記完工，使用今天日期；如果取消完工，使用 "0"
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
        
        // 🚀 Optimistic UI：先立即更新視覺，背景再存檔
        updateSmallSegmentVisual(segmentNumber, smallIndex, newStatus);
        // 同步更新 segment.smallSegments 字串，確保後續點擊判斷正確
        if (segment) {
            const arr = (segment.smallSegments || '').split(',').map(s => s.trim());
            while (arr.length <= smallIndex) arr.push('0');
            arr[smallIndex] = statusValue;
            segment.smallSegments = arr.join(',');
        }
        
        const result = await apiCall('updateSmallSegment', { pipelineId: currentPipeline.id, status: statusValue, segmentNumber: segmentNumber });
        
        if (result.success) {
            map.closePopup();
            
            // 🚀 Optimistic UI 已在前面做了，不需要重繪地圖
            // 只更新本地資料和統計面板
            const progressData = await apiCall('getProgress');
            
            if (progressData.segments) {
                const segments = parseBranchIndexFromSegments(progressData.segments);
                const pipelineIndex = allPipelines.findIndex(p => p.id === currentPipeline.id);
                if (pipelineIndex !== -1) allPipelines[pipelineIndex].segments = segments;
                currentPipeline.segments = segments;
                
                // 更新地圖 label（不重繪整個地圖）
                const seg = segments.find(s => String(s.segmentNumber) === String(segmentNumber));
                if (seg) {
                    const segLen = seg.endDistance - seg.startDistance;
                    const numSmall = Math.ceil(segLen / 10);
                    const statusArr = (seg.smallSegments || '').split(',').map(s => s.trim());
                    let completed = 0;
                    for (let i = 0; i < numSmall; i++) {
                        const v = statusArr[i] || '0';
                        if (v !== '0' && v !== '') completed += Math.min(10, segLen - i * 10);
                    }
                    updateSegmentLabel(segmentNumber, completed, segLen);
                }
            }
            
            showStatsPanel();
        } else {
            // 失敗：回退視覺狀態
            updateSmallSegmentVisual(segmentNumber, smallIndex, !newStatus);
            if (segment) {
                const arr = (segment.smallSegments || '').split(',').map(s => s.trim());
                while (arr.length <= smallIndex) arr.push('0');
                arr[smallIndex] = newStatus ? '0' : '1';
                segment.smallSegments = arr.join(',');
            }
            showToast('更新失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        // 失敗：回退視覺狀態
        updateSmallSegmentVisual(segmentNumber, smallIndex, !newStatus);
        showToast('更新失敗：' + error.message, 'error');
        console.error('更新錯誤:', error);
    }
};

// ========== 地圖備註功能 ==========
let mapNotes = [];
let noteMarkers = [];
let segmentLabels = []; // 段落標籤陣列 [{marker, segmentNumber, color, methodLabel, segLength}]

// 更新地圖上特定段落的 label 文字
function updateSegmentLabel(segmentNumber, completedLength, segLength) {
    const item = segmentLabels.find(l => String(l.segmentNumber) === String(segmentNumber));
    if (!item) return;
    const newText = `${item.methodLabel} ${Math.round(completedLength)}m/${Math.round(item.segLength || segLength)}m`;
    item.marker.setIcon(L.divIcon({
        className: 'segment-label',
        html: `<div style="background:transparent;color:${item.color};padding:3px 6px;border-radius:3px;font-size:10px;font-weight:700;white-space:nowrap;border:none;pointer-events:none;text-shadow:-1px -1px 0 white,1px -1px 0 white,-1px 1px 0 white,1px 1px 0 white,0 0 3px white,0 0 3px white;">${newText}</div>`,
        iconSize: null,
        iconAnchor: [-50, 15]
    }));
}
let photoPreviewElement = null; // 照片預覽元素

// 顯示照片預覽
function showPhotoPreview(e, photoUrl, label) {
    // 移除舊的預覽
    hidePhotoPreview();
    
    // 創建預覽元素
    photoPreviewElement = document.createElement('div');
    photoPreviewElement.className = 'marker-photo-preview';
    
    const img = document.createElement('img');
    img.src = photoUrl;
    img.onerror = function() {
        hidePhotoPreview(); // 圖片載入失敗就隱藏
    };
    
    const labelDiv = document.createElement('div');
    labelDiv.className = 'marker-photo-preview-label';
    labelDiv.textContent = label;
    
    photoPreviewElement.appendChild(img);
    photoPreviewElement.appendChild(labelDiv);
    document.body.appendChild(photoPreviewElement);
    
    // 定位預覽框（在標記旁邊）
    const x = e.originalEvent.pageX + 15;
    const y = e.originalEvent.pageY - 100;
    
    photoPreviewElement.style.left = x + 'px';
    photoPreviewElement.style.top = y + 'px';
}

// 隱藏照片預覽
function hidePhotoPreview() {
    if (photoPreviewElement) {
        photoPreviewElement.remove();
        photoPreviewElement = null;
    }
}

// 載入地圖備註
async function loadMapNotes() {
    try {
        // 如果有選擇工程，只載入該工程的備註
        const params = {};
        if (currentPipeline && currentPipeline.id) {
            params.pipelineId = currentPipeline.id;
        }
        
        const result = await apiCall('getMapNotes', params);
        
        if (result.notes) {
            mapNotes = result.notes;
            displayMapNotes();
        }
    } catch (error) {
        console.error('載入地圖備註失敗:', error);
    }
}

// 顯示地圖備註
function displayMapNotes() {
    // 清除舊的標記
    noteMarkers.forEach(marker => map.removeLayer(marker));
    noteMarkers = [];
    
    // 只在詳細檢視模式（有選擇工程時）才顯示備註
    if (!currentPipeline || !currentPipeline.id) {
        return;
    }
    
    // 顯示備註（加入前端二次過濾，確保只顯示當前工程的備註）
    mapNotes.forEach(note => {
        // 🔒 前端二次過濾：只顯示 pipelineId 符合的備註
        if (note.pipelineId && note.pipelineId !== currentPipeline.id) {
            console.log('過濾掉不符的備註:', note.id, '工程ID:', note.pipelineId);
            return; // 跳過不符的備註
        }
        
        // 判斷是否為節點（text 以 __node__ 開頭）
        const isNode = note.text && note.text.startsWith('__node__');
        const nodeName = isNode ? note.text.replace('__node__', '').split('\n')[0].trim() : '';
        const noteIcon = isNode
            ? L.divIcon({
                className: 'note-marker-custom',
                html: `<div style="background:#3f51b5;color:white;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;white-space:nowrap;cursor:pointer;box-shadow:0 2px 5px rgba(0,0,0,0.3);border:2px solid white;line-height:20px;">${nodeName}</div>`,
                iconSize: null,
                iconAnchor: [0, 10],
                popupAnchor: [0, -14]
            })
            : L.divIcon({
                className: 'note-marker-custom',
                html: `<div style="color:#FF0000;font-size:24px;text-shadow:0 2px 4px rgba(0,0,0,0.5),0 0 3px white;display:flex;align-items:center;justify-content:center;cursor:pointer;">⭐</div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12],
                popupAnchor: [0, -12]
            });
        const marker = L.marker([note.lat, note.lng], { icon: noteIcon }).addTo(map);
        
        // 懸停預覽照片
        if (note.photo) {
            marker.on('mouseover', function(e) {
                showPhotoPreview(e, note.photo, isNode ? ('📍 ' + nodeName) : '⭐ 備註');
            });
            marker.on('mouseout', function() {
                hidePhotoPreview();
            });
        }
        
        const noteBodyText = isNode
            ? note.text.replace('__node__', '').replace(nodeName, '').replace(/^\n/, '').trim()
            : (note.text || '');
        marker.bindPopup(`
            <div style="min-width: 240px; max-width: 300px;" id="note-popup-${note.id}">
                <div style="font-weight: bold; margin-bottom: 8px; color: ${isNode ? '#3f51b5' : '#FF0000'};">${isNode ? '📍 ' + nodeName : '⭐ 備註'}</div>
                ${note.photo ? `<img src="${note.photo}" onclick="window.open('${note.photo}', '_blank')" style="width: 100%; max-height: 200px; object-fit: cover; border-radius: 4px; margin-bottom: 8px; border: 1px solid #ddd; cursor: pointer;" title="點擊放大查看">` : ''}
                
                <!-- 檢視模式 -->
                <div id="note-view-${note.id}">
                    ${isNode ? `<div style="font-size:12px;color:#555;margin-bottom:6px;"><b>節點名稱：</b>${nodeName}</div>` : ''}
                    ${noteBodyText ? `<div style="margin-bottom: 8px; white-space: pre-wrap; font-size:13px;">${noteBodyText}</div>` : ''}
                    <div style="font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 5px; margin-top: 5px;">${note.creator || '未知'} · ${note.timestamp || ''}</div>
                    <div style="display: flex; gap: 5px; margin-top: 8px;">
                        <button onclick="startEditNote('${note.id}', ${isNode})" style="flex: 1; padding: 6px 8px; background: ${isNode ? '#3f51b5' : '#FFC107'}; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">✏️ 編輯</button>
                        <button onclick="deleteMapNote('${note.id}')" style="flex: 1; padding: 6px 8px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">🗑️ 刪除</button>
                    </div>
                </div>
                
                <!-- 編輯模式 -->
                <div id="note-edit-${note.id}" style="display:none;">
                    ${isNode ? `<div style="font-size:12px;color:#555;margin-bottom:4px;"><b>節點名稱</b></div>
                    <input id="note-nodename-${note.id}" value="${nodeName}" style="width:100%;padding:6px;border:2px solid #3f51b5;border-radius:4px;margin-bottom:8px;box-sizing:border-box;font-weight:bold;font-size:13px;">` : ''}
                    <div style="font-size:12px;color:#555;margin-bottom:4px;"><b>${isNode ? '備註（選填）' : '備註內容'}</b></div>
                    <textarea id="note-text-edit-${note.id}" style="width: 100%; height: 70px; padding: 6px; border: 1px solid #ddd; border-radius: 4px; resize: vertical; font-family: inherit; font-size: 13px; box-sizing: border-box;">${noteBodyText}</textarea>
                    <div style="display: flex; gap: 5px; margin-top: 8px;">
                        <button onclick="saveEditNote('${note.id}', ${isNode})" style="flex: 1; padding: 6px 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">💾 儲存</button>
                        <button onclick="cancelEditNote('${note.id}')" style="flex: 1; padding: 6px 8px; background: #e0e0e0; color: #666; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">取消</button>
                    </div>
                </div>
            </div>
        `);
        
        noteMarkers.push(marker);
    });
    applyMarkerVisibility();
}

// 顯示新增備註彈窗
function showAddNotePopup(latlng) {
    const popup = L.popup()
        .setLatLng(latlng)
        .setContent(`
            <div style="min-width: 280px;">
                <div style="font-weight: bold; margin-bottom: 10px; color: #FFC107;">📝 新增地圖標記</div>
                
                <div style="display:flex;gap:6px;margin-bottom:10px;">
                    <button id="btn_type_note" onclick="switchNoteType('note')" style="flex:1;padding:6px;border:2px solid #FFC107;border-radius:6px;background:#FFC107;color:white;font-size:12px;cursor:pointer;font-weight:bold;">⭐ 備註</button>
                    <button id="btn_type_node" onclick="switchNoteType('node')" style="flex:1;padding:6px;border:2px solid #ddd;border-radius:6px;background:white;color:#666;font-size:12px;cursor:pointer;">📍 節點</button>
                </div>
                
                <div id="node_name_row" style="display:none;margin-bottom:8px;">
                    <input type="text" id="nodeName" placeholder="節點名稱（如：節點1）" style="width:100%;padding:8px;border:2px solid #3f51b5;border-radius:4px;box-sizing:border-box;font-weight:bold;">
                </div>
                
                <textarea id="noteText" placeholder="備註內容（選填）..." style="width: 100%; height: 70px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical; font-family: inherit; box-sizing:border-box;"></textarea>
                <input type="text" id="noteCreator" placeholder="建立者名稱（選填）" style="width: 100%; padding: 8px; margin-top: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing:border-box;">
                
                <div style="margin-top: 10px;">
                    <label style="display: block; margin-bottom: 5px; font-size: 13px; color: #666;">📷 上傳照片（選填）</label>
                    <input type="file" id="notePhoto" accept="image/*" style="width: 100%; padding: 5px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;">
                    <div id="photoPreview" style="margin-top: 8px;"></div>
                </div>
                
                <button onclick="saveMapNote(${latlng.lat}, ${latlng.lng})" style="width: 100%; margin-top: 10px; padding: 10px; background: #FFC107; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
                    💾 儲存
                </button>
                <button onclick="map.closePopup()" style="width: 100%; margin-top: 5px; padding: 8px; background: #e0e0e0; color: #666; border: none; border-radius: 6px; cursor: pointer;">
                    取消
                </button>
            </div>
        `)
        .openOn(map);
    
    // 監聽照片選擇
    setTimeout(() => {
        const photoInput = document.getElementById('notePhoto');
        if (photoInput) {
            photoInput.addEventListener('change', function(e) {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = function(e) {
                        const preview = document.getElementById('photoPreview');
                        if (preview) {
                            preview.innerHTML = `<img src="${e.target.result}" style="max-width: 100%; max-height: 150px; border-radius: 4px; border: 1px solid #ddd;">`;
                        }
                    };
                    reader.readAsDataURL(file);
                }
            });
        }
    }, 100);
}

// 切換備註/節點類型
window._noteType = 'note';
window.switchNoteType = function(type) {
    window._noteType = type;
    const isNode = type === 'node';
    document.getElementById('node_name_row').style.display = isNode ? 'block' : 'none';
    document.getElementById('btn_type_note').style.cssText = 
        isNode ? 'flex:1;padding:6px;border:2px solid #ddd;border-radius:6px;background:white;color:#666;font-size:12px;cursor:pointer;'
               : 'flex:1;padding:6px;border:2px solid #FFC107;border-radius:6px;background:#FFC107;color:white;font-size:12px;cursor:pointer;font-weight:bold;';
    document.getElementById('btn_type_node').style.cssText = 
        isNode ? 'flex:1;padding:6px;border:2px solid #3f51b5;border-radius:6px;background:#3f51b5;color:white;font-size:12px;cursor:pointer;font-weight:bold;'
               : 'flex:1;padding:6px;border:2px solid #ddd;border-radius:6px;background:white;color:#666;font-size:12px;cursor:pointer;';
    const noteText = document.getElementById('noteText');
    if (noteText) noteText.placeholder = isNode ? '備註內容（選填）...' : '輸入備註內容...';
};

// 壓縮照片
async function compressImage(file, maxWidth = 1200, quality = 0.8) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                // 計算壓縮後的尺寸
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }
                
                // 創建 canvas 進行壓縮
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                // 轉換成 base64（JPEG 格式，品質 0.8）
                const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                
                console.log('原始檔案大小:', (file.size / 1024).toFixed(2), 'KB');
                console.log('壓縮後大小:', (compressedBase64.length * 0.75 / 1024).toFixed(2), 'KB');
                
                resolve(compressedBase64);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 儲存地圖備註
window.saveMapNote = async function(lat, lng) {
    if (!requireLogin()) return;
    const isNode = window._noteType === 'node';
    const rawText = document.getElementById('noteText').value.trim();
    const nodeName = isNode ? (document.getElementById('nodeName') ? document.getElementById('nodeName').value.trim() : '') : '';
    
    if (isNode && !nodeName) {
        showToast('請輸入節點名稱', 'warning');
        return;
    }
    if (!isNode && !rawText) {
        showToast('請輸入備註內容', 'warning');
        return;
    }
    
    // 節點：text = __node__節點名稱\n備註文字；備註：text = 原始文字
    const text = isNode ? ('__node__' + nodeName + (rawText ? '\n' + rawText : '')) : rawText;
    const creator = document.getElementById('noteCreator').value.trim() || '匿名';
    const photoInput = document.getElementById('notePhoto');
    
    // 儲存後重設類型
    window._noteType = 'note';
    
    let photoBase64 = '';
    
    // 處理照片
    if (photoInput && photoInput.files && photoInput.files[0]) {
        const file = photoInput.files[0];
        
        try {
            // 壓縮照片（照片存 Google Drive，不受字元限制，品質可以好一點）
            console.log('開始壓縮照片...');
            photoBase64 = await compressImage(file, 1600, 0.85);
            
            // 超過 3MB 再壓一次
            if (photoBase64.length > 3 * 1024 * 1024) {
                console.log('照片仍然太大，降低品質重新壓縮...');
                photoBase64 = await compressImage(file, 1200, 0.75);
            }
            
            console.log('照片壓縮完成！大小：' + Math.round(photoBase64.length / 1024) + 'KB');
        } catch (error) {
            console.error('照片壓縮失敗:', error);
            showToast('照片處理失敗，備註文字已繼續儲存', 'warning');
            photoBase64 = '';
        }
    }
    
    try {
        const result = await apiCall('addMapNote', {
                lat: lat, lng: lng, text: text, creator: creator,
                pipelineId: currentPipeline ? currentPipeline.id : ''
            }, { body: { photo: photoBase64 }, errorPrefix: '新增失敗' });
        map.closePopup();
        await loadMapNotes();
        showToast('備註已新增！', 'success');
    } catch (error) {
        showToast('新增失敗：' + error.message, 'error');
        console.error('新增備註錯誤:', error);
    }
};

// 刪除地圖備註
window.deleteMapNote = async function(noteId) {
    if (!requireLogin()) return;
    if (!await showConfirm({ title: '刪除備註', message: '確定要刪除這個備註嗎？', okText: '刪除', danger: true })) {
        return;
    }
    
    try {
        const result = await apiCall('deleteMapNote');
        
        if (result.success) {
            map.closePopup();
            await loadMapNotes();
            showToast('備註已刪除！', 'success');
        } else {
            showToast('刪除失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('刪除失敗：' + error.message, 'error');
        console.error('刪除備註錯誤:', error);
    }
};
// 切換備註為編輯模式
window.startEditNote = function(noteId, isNode) {
    document.getElementById('note-view-' + noteId).style.display = 'none';
    document.getElementById('note-edit-' + noteId).style.display = 'block';
    const editEl = document.getElementById('note-text-edit-' + noteId);
    if (editEl) editEl.focus();
};

// 取消編輯
window.cancelEditNote = function(noteId) {
    document.getElementById('note-view-' + noteId).style.display = 'block';
    document.getElementById('note-edit-' + noteId).style.display = 'none';
};

// 儲存編輯後的備註
window.saveEditNote = async function(noteId, isNode) {
    if (!requireLogin()) return;
    const bodyText = (document.getElementById('note-text-edit-' + noteId) ? document.getElementById('note-text-edit-' + noteId).value.trim() : '');
    let newText;
    if (isNode) {
        const nodeNameEl = document.getElementById('note-nodename-' + noteId);
        const newNodeName = nodeNameEl ? nodeNameEl.value.trim() : '';
        if (!newNodeName) { showToast('節點名稱不能為空', 'warning'); return; }
        newText = '__node__' + newNodeName + (bodyText ? '\n' + bodyText : '');
    } else {
        if (!bodyText) { showToast('備註內容不能為空', 'warning'); return; }
        newText = bodyText;
    }
    
    try {
        const result = await apiCall('updateMapNote', { text: newText });
        
        if (result.success) {
            map.closePopup();
            await loadMapNotes();
            showToast(isNode ? '節點已更新！' : '備註已更新！', 'success');
        } else {
            showToast('更新失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('更新失敗：' + error.message, 'error');
    }
};

// ========== 地圖備註功能結束 ==========
// ========== 右鍵選單 ==========
window.showRightClickMenu = function(latlng, clientX, clientY) {
    // 移除舊選單
    const old = document.getElementById('rightClickMenu');
    if (old) old.remove();
    
    const menu = document.createElement('div');
    menu.id = 'rightClickMenu';
    menu.style.cssText = 'position:fixed; left:' + clientX + 'px; top:' + clientY + 'px; background:white; border-radius:8px; box-shadow:0 4px 15px rgba(0,0,0,0.2); z-index:9999; overflow:hidden; min-width:160px;';
    const lat = latlng.lat;
    const lng = latlng.lng;
    menu.innerHTML =
        '<div class="rcm-item" onclick="closeRightClickMenu();showAddNotePopup({lat:' + lat + ',lng:' + lng + '})">📝 <span>新增備註</span></div>' +
        '<div class="rcm-item" style="border-top:1px solid #f0f0f0;" onclick="closeRightClickMenu();showAddShaftPopup(' + lat + ',' + lng + ')">🕳️ <span>新增工作井</span></div>' +
        '<div class="rcm-item" style="border-top:1px solid #f0f0f0;" onclick="closeRightClickMenu();showAddPanelPopup({lat:' + lat + ',lng:' + lng + '})">🔌 <span>新增配電盤/儀表箱</span></div>' +
        '<div class="rcm-item" style="border-top:1px solid #f0f0f0;" onclick="closeRightClickMenu();startDrawPermitZone()">🔴 <span>繪製挖掘許可範圍</span></div>';
    
    document.body.appendChild(menu);
    
    // 點其他地方關閉
    setTimeout(() => {
        document.addEventListener('click', closeRightClickMenu, { once: true });
        map.once('click', closeRightClickMenu);
    }, 100);
}

window.closeRightClickMenu = function() {
    const menu = document.getElementById('rightClickMenu');
    if (menu) menu.remove();
}
// ========== 右鍵選單結束 ==========
// ========== 施工日期標註功能（改良版）==========

// 載入甘特圖項目用於日期標註
async function loadGanttItemsForLabels() {
    if (!currentPipeline) return;
    
    try {
        const result = await apiCall('getGanttItems');
        ganttItemsCache = result.items || [];
        console.log('載入甘特圖項目用於日期標註:', ganttItemsCache.length, '個項目');
        
        // 監聽地圖縮放事件，自動調整標籤顯示
        map.on('zoomend', function() {
            if (dateLabelsVisible) {
                showDateLabels();
            }
        });
    } catch (error) {
        console.error('載入甘特圖項目失敗:', error);
        ganttItemsCache = [];
    }
}

// 切換日期標註顯示/隱藏
window.toggleDateLabels = function() {
    dateLabelsVisible = !dateLabelsVisible;
    const btn = document.getElementById('dateLabelButton');
    
    if (dateLabelsVisible) {
        btn.classList.add('active');
        showDateLabels();
    } else {
        btn.classList.remove('active');
        clearDateLabels();
    }
};

// 顯示日期標註（改良版：浮水印 + 箭頭線 + 智能密度控制）
function showDateLabels() {
    if (!currentPipeline || ganttItemsCache.length === 0) {
        console.log('無甘特圖項目可顯示');
        return;
    }
    
    clearDateLabels();
    
    // 取得當前縮放等級，決定顯示密度
    const zoom = map.getZoom();
    const showAllLabels = zoom >= 15; // 縮放等級 >= 15 時顯示所有標籤
    
    let visibleCount = 0;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    ganttItemsCache.forEach((item, index) => {
        // 只顯示尚未開始的項目（開始日期 > 今天）
        const itemStart = new Date(item.startDate);
        if (itemStart <= today) return;

        // 智能密度控制：低縮放時只顯示部分標籤
        if (!showAllLabels && index % 2 === 1) return; // 縮放小時跳過一半標籤
        
        const label = item.label || '';
        const segMatch = label.match(/段落([\w-]+)/);  // 🔧 支援 B0-1 格式
        const rangeMatch = label.match(/#(\d+)～#(\d+)/);
        
        if (!segMatch || !rangeMatch) return;
        
        const segmentNumber = segMatch[1];  // 🔧 保持為字串
        const fromSmall = parseInt(rangeMatch[1]) - 1;
        const toSmall = parseInt(rangeMatch[2]) - 1;
        
        const segment = currentPipeline.segments.find(s => String(s.segmentNumber) === String(segmentNumber));  // 🔧 字串比對
        if (!segment) return;
        
        const segmentLength = segment.endDistance - segment.startDistance;
        const numSmallSegments = Math.ceil(segmentLength / 10);
        
        const validFrom = Math.max(0, Math.min(fromSmall, numSmallSegments - 1));
        const validTo = Math.max(0, Math.min(toSmall, numSmallSegments - 1));
        
        // 計算起點和終點的實際距離
        const startDistance = segment.startDistance + (validFrom * 10);
        const endDistance = segment.startDistance + Math.min((validTo + 1) * 10, segmentLength);
        
        // 🔧 取得管線座標(支援MULTILINESTRING)
        const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
        let startCoord, endCoord, labelCoord;
        
        if (isMULTI) {
            // MULTILINESTRING: 從 branchIndex 獲取分支座標
            const branchData = parseLineStringWithBranches(currentPipeline.linestring);
            const branchIndex = segment.branchIndex !== undefined ? segment.branchIndex : 0;
            const branch = branchData.branches[branchIndex];
            
            if (branch) {
                startCoord = getCoordAtDistanceFromBranch(branch.coords, startDistance);
                endCoord = getCoordAtDistanceFromBranch(branch.coords, endDistance);
                const middleDistance = (startDistance + endDistance) / 2;
                labelCoord = getCoordAtDistanceFromBranch(branch.coords, middleDistance);
            }
        } else {
            // 單一LINESTRING: 使用原有邏輯
            const coords = parseLineString(currentPipeline.linestring);
            startCoord = getCoordAtDistance(coords, startDistance);
            endCoord = getCoordAtDistance(coords, endDistance);
            const middleDistance = (startDistance + endDistance) / 2;
            labelCoord = getCoordAtDistance(coords, middleDistance);
        }
        
        if (!startCoord || !endCoord || !labelCoord) return;
        
        // ========== 智能偏移：根據管線方向判斷 ==========
        // 計算管線方向（起點到終點的角度）
        const deltaLat = endCoord[0] - startCoord[0];
        const deltaLng = endCoord[1] - startCoord[1];
        const angle = Math.atan2(deltaLat, deltaLng) * (180 / Math.PI);
        
        // 判斷管線主要方向
        let offsetPixelsX = 0;
        let offsetPixelsY = -50; // 預設向上偏移
        
        // 東西向管線（-45° ~ 45° 或 135° ~ -135°）
        if ((angle >= -45 && angle <= 45) || (angle >= 135 || angle <= -135)) {
            offsetPixelsX = 0;
            offsetPixelsY = -80; // 東西向：標籤在上方，增加到80px
        }
        // 南北向管線（45° ~ 135° 或 -45° ~ -135°）
        else {
            // 判斷要放左邊還是右邊（避免被其他管線遮擋）
            if (angle >= 45 && angle <= 135) {
                offsetPixelsX = -120; // 東北-西南走向：標籤在左側，增加到120px
            } else {
                offsetPixelsX = 120;  // 西北-東南走向：標籤在右側，增加到120px
            }
            offsetPixelsY = 0;
        }
        
        const point = map.latLngToContainerPoint(labelCoord);
        const offsetPoint = L.point(point.x + offsetPixelsX, point.y + offsetPixelsY);
        const offsetLatLng = map.containerPointToLatLng(offsetPoint);
        
        // 計算日期資訊
        const startDate = new Date(item.startDate);
        const endDate = new Date(item.endDate);
        const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        
        // 計算管線長度
        const pipelineLength = Math.round(endDistance - startDistance);
        
        // 取得施工方式
        const method = segment.method || '未設定';
        
        const rangeStr = `#${validFrom + 1}~#${validTo + 1}`;
        const dateStr = `${formatDate(startDate)} ~ ${formatDate(endDate)}`;
        
        // 判斷時間狀態
        const now = new Date();
        const isPast = endDate < now;      // 已過期
        const isCurrent = startDate <= now && endDate >= now;  // 進行中
        const isFuture = startDate > now;  // 未來
        
        // 根據狀態設定背景色（10% 透明度）
        let bgColor = 'rgba(255, 255, 255, 0.1)';  // 預設：無色（10%透明白色）
        if (isPast) {
            bgColor = 'rgba(255, 255, 255, 0.1)';  // 已過期：無色
        } else if (isCurrent) {
            bgColor = 'rgba(255, 0, 0, 0.1)';      // 進行中：紅色 10%
        } else if (isFuture) {
            bgColor = 'rgba(255, 255, 0, 0.1)';    // 未來：黃色 10%
        }
        
        // 建立簡化單行標籤，備註用粗體顯示在最前面
        const notesPrefix = item.notes ? `<strong>${item.notes}</strong> ` : '';
        const labelHtml = `
            <div style="
                background: ${bgColor};
                border: 2px solid #999999;
                border-radius: 5px;
                padding: 4px 10px;
                font-size: 10px;
                font-weight: bold;
                color: #00695C;
                white-space: nowrap;
                box-shadow: 0 2px 6px rgba(0,0,0,0.25);
                pointer-events: none;
                text-shadow: 0 0 4px white, 0 0 4px white;
            ">
                ${notesPrefix}${rangeStr} (${pipelineLength}m ${method}) ${dateStr} (${days}天)
            </div>
        `;
        
        const marker = L.marker(offsetLatLng, {
            icon: L.divIcon({
                className: 'schedule-label-icon',
                html: labelHtml,
                iconSize: null,
                iconAnchor: [50, 10]
            }),
            zIndexOffset: 1000
        });
        
        marker.addTo(map);
        dateLabels.push(marker);
        
        // ========== 繪製箭頭線（改為灰色） ==========
        // 直接從管線起點/終點連到標籤位置，不計算交叉點
        const arrowStart = L.polyline([startCoord, offsetLatLng], {
            color: '#999999',      // 灰色
            weight: 2,
            opacity: 0.6,
            dashArray: '5, 5'
        }).addTo(map);
        
        const arrowEnd = L.polyline([endCoord, offsetLatLng], {
            color: '#999999',      // 灰色
            weight: 2,
            opacity: 0.6,
            dashArray: '5, 5'
        }).addTo(map);
        
        // 在起點和終點加上灰色圓點標記
        const startMarker = L.circleMarker(startCoord, {
            radius: 5,
            color: '#999999',      // 灰色邊框
            fillColor: '#CCCCCC',  // 淺灰色填充
            fillOpacity: 0.8,
            weight: 2
        }).addTo(map);
        
        const endMarker = L.circleMarker(endCoord, {
            radius: 5,
            color: '#999999',      // 灰色邊框
            fillColor: '#CCCCCC',  // 淺灰色填充
            fillOpacity: 0.8,
            weight: 2
        }).addTo(map);
        
        dateLabelArrows.push(arrowStart, arrowEnd, startMarker, endMarker);
        visibleCount++;
    });
    
    console.log(`顯示了 ${visibleCount} 個日期標註 (縮放等級: ${zoom})`);
}

// 清除日期標註
function clearDateLabels() {
    dateLabels.forEach(marker => map.removeLayer(marker));
    dateLabels = [];
    dateLabelArrows.forEach(arrow => map.removeLayer(arrow));
    dateLabelArrows = [];
}

// 格式化日期（YYYY/MM/DD）
function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}`;
}

// 根據距離取得座標點
function getCoordAtDistance(coords, targetDistance) {
    let accumulated = 0;
    
    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        const segLength = getDistance(p1, p2);
        
        if (accumulated + segLength >= targetDistance) {
            const ratio = (targetDistance - accumulated) / segLength;
            return [
                p1[0] + (p2[0] - p1[0]) * ratio,
                p1[1] + (p2[1] - p1[1]) * ratio
            ];
        }
        
        accumulated += segLength;
    }
    
    return coords[coords.length - 1];
}

// 🆕 分支版本:根據距離獲取分支上的座標
function getCoordAtDistanceFromBranch(branchCoords, targetDistance) {
    return getCoordAtDistance(branchCoords, targetDistance);
}

// 計算兩點間距離（公尺）- Haversine 公式
function getDistance(p1, p2) {
    const R = 6371000;
    const lat1 = p1[0] * Math.PI / 180;
    const lat2 = p2[0] * Math.PI / 180;
    const dLat = (p2[0] - p1[0]) * Math.PI / 180;
    const dLon = (p2[1] - p1[1]) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
}

// 🆕 從分支座標中提取指定距離範圍的座標片段
function getSegmentCoordsFromBranch(branchCoords, startDist, endDist) {
    const result = [];
    let accumulatedDist = 0;
    let started = false;
    
    for (let i = 0; i < branchCoords.length - 1; i++) {
        const p1 = branchCoords[i];
        const p2 = branchCoords[i + 1];
        const segDist = getDistance(p1, p2);
        const nextAccDist = accumulatedDist + segDist;
        
        // 段落起點在這段線段內
        if (!started && accumulatedDist <= startDist && startDist < nextAccDist) {
            // 內插起點座標
            const ratio = (startDist - accumulatedDist) / segDist;
            const startPoint = [
                p1[0] + (p2[0] - p1[0]) * ratio,
                p1[1] + (p2[1] - p1[1]) * ratio
            ];
            result.push(startPoint);
            started = true;
        }
        
        // 🔧 修正：如果已經開始，加入下一個點 p2（在範圍內時）
        if (started && nextAccDist <= endDist) {
            result.push(p2);
        }
        
        // 段落終點在這段線段內
        if (started && accumulatedDist < endDist && endDist < nextAccDist) {
            // 內插終點座標
            const ratio = (endDist - accumulatedDist) / segDist;
            const endPoint = [
                p1[0] + (p2[0] - p1[0]) * ratio,
                p1[1] + (p2[1] - p1[1]) * ratio
            ];
            result.push(endPoint);
            break;
        }
        
        accumulatedDist = nextAccDist;
    }
    
    // 檢查是否正確擷取到座標
    if (result.length < 2) {
        console.warn(`⚠️ getSegmentCoordsFromBranch 返回座標不足: ${result.length} 點 (${startDist}-${endDist}m)`);
    }
    
    return result;
}

// 供新視窗呼叫：刷新地圖上的日期標註
window.refreshDateLabels = async function() {
    console.log('收到新視窗的更新通知，刷新日期標註...');
    await loadGanttItemsForLabels();
    if (dateLabelsVisible) {
        showDateLabels();
    }
};

// 監聽來自甘特圖新視窗的訊息
window.addEventListener('message', async function(event) {
    console.log('主頁面收到訊息:', event.data);

    if (event.data && event.data.type === 'unitPriceChanged') {
        // 即時刷新 blob 內的 unitPrices 並重繪圖表
        if (event.data.unitPrices && window.ganttWindow && !window.ganttWindow.closed) {
            // This runs in main page - forward to blob via its own listener
        }
        return;
    }
    
    if (event.data && event.data.type === 'ganttChanged') {
        console.log('收到甘特圖變更通知，刷新日期標註...');
        await loadGanttItemsForLabels();
        if (dateLabelsVisible) {
            showDateLabels();
        }
    }
});

