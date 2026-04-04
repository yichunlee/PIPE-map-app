async function showPipelineDetail(pipelineId, keepView = false) {
    currentPipeline = allPipelines.find(p => p.id === pipelineId);

    // 切換工程時清空甘特資料，避免顯示舊工程的甘特條
    if (typeof ganttData !== 'undefined') ganttData = [];
    if (window.ganttData) window.ganttData = [];
    // 同時關閉 in-page panel（若開著）
    const _gp = document.getElementById('ganttPanel');
    const _gb = document.getElementById('ganttBackdrop');
    if (_gp) _gp.style.display = 'none';
    if (_gb) _gb.style.display = 'none';
    
    // 設定子工程地圖按鈕狀態
    setMapContext('pipeline');
    
    // 只在首次進入工程時重置標記可見性（編輯後重載時保持狀態）
    if (!keepView) {
        allMarkersVisible = true;
    }
    
    // 🚀 懶載入：第一次點進來才載入施工進度
    if (!currentPipeline._progressLoaded) {
        showLoading(true);
        try {
            const progressData = await apiCall('getProgress', { pipelineId: currentPipeline.id });
            currentPipeline.segments = parseBranchIndexFromSegments(progressData.segments || []);
            currentPipeline._progressLoaded = true;
            console.log('✅ 懶載入進度：', currentPipeline.name, currentPipeline.segments.length, '個段落');
        } catch (e) {
            console.error('載入進度失敗:', e);
            showToast('載入施工進度失敗，請重試', 'error');
        } finally {
            showLoading(false);
        }
    }
    
    console.log('顯示工程:', currentPipeline.name);
    console.log('段落數量:', currentPipeline.segments.length);
    
    clearMap();
    
    // 檢查是否為 MULTILINESTRING
    const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
    
    if (isMULTI) {
        console.log('🌿 檢測到 MULTILINESTRING 格式');
        
        // 解析分支結構
        const branchData = parseLineStringWithBranches(currentPipeline.linestring);
        console.log('   分支數:', branchData.branches.length);
        console.log('   交叉點:', branchData.junctionPoints.length);
        
        // 計算總長度（所有分支加總）
        let totalLength = 0;
        branchData.branches.forEach(branch => {
            for (let i = 0; i < branch.coords.length - 1; i++) {
                totalLength += getDistance(branch.coords[i], branch.coords[i + 1]);
            }
        });
        totalLength = Math.round(totalLength);
        currentPipeline.length = totalLength;
        
        console.log('   總長度:', totalLength, 'm');
        
        // 🆕 檢查是否有段落資料
        if (currentPipeline.segments && currentPipeline.segments.length > 0) {
            console.log('🎨 開始繪製分支（含段落和小段）:');
            
            // 為每個分支繪製段落和小段
            branchData.branches.forEach((branch, branchIndex) => {
                // 🔍 Debug: 顯示所有段落的 branchIndex
                if (branchIndex === 0) {
                    console.log('   📊 所有段落的 branchIndex 資訊:');
                    currentPipeline.segments.forEach(seg => {
                        console.log(`      ${seg.segmentNumber}: branchIndex=${seg.branchIndex !== undefined ? seg.branchIndex : '未定義'}, notes="${seg.notes || ''}"`);
                    });
                }
                
                // 篩選屬於該分支的段落
                const branchSegments = currentPipeline.segments.filter(seg => {
                    if (seg.branchIndex !== undefined) {
                        return seg.branchIndex === branchIndex;
                    }
                    // 舊資料沒有 branchIndex，視為主幹（index 0）
                    return branchIndex === 0;
                });
                
                console.log(`   分支 ${branchIndex}: ${branchSegments.length} 個段落`);
                
                if (branchSegments.length > 0) {
                    // 有段落資料：繪製段落和小段
                    branchSegments.forEach(segment => {
                        const segLength = segment.endDistance - segment.startDistance;
                        const numSmallSegments = Math.ceil(segLength / 10);
                        
                        console.log(`      🔹 段落 ${segment.segmentNumber}: ${segment.startDistance}-${segment.endDistance}m, 預計 ${numSmallSegments} 個小段`);
                        
                        // 計算該段落在分支上的實際座標
                        const segmentCoords = getSegmentCoordsFromBranch(branch.coords, segment.startDistance, segment.endDistance);
                        
                        if (!segmentCoords || segmentCoords.length < 2) {
                            console.warn(`   ⚠️ 段落 ${segment.segmentNumber} 座標計算失敗: ${segmentCoords ? segmentCoords.length : 0} 點`);
                            return;
                        }
                        
                        console.log(`         座標提取成功: ${segmentCoords.length} 個點`);
                        
                        // 解析小段狀態
                        const smallSegmentsStatus = segment.smallSegments || '';
                        const statusArray = smallSegmentsStatus.split(',').map(s => s.trim());
                        
                        // 繪製每個10m小段
                        let successCount = 0;
                        for (let i = 0; i < numSmallSegments; i++) {
                            const smallStart = segment.startDistance + (i * 10);
                            const smallEnd = Math.min(segment.startDistance + ((i + 1) * 10), segment.endDistance);
                            
                            const smallCoords = getSegmentCoordsFromBranch(branch.coords, smallStart, smallEnd);
                            
                            if (!smallCoords || smallCoords.length < 2) {
                                console.warn(`         ⚠️ 小段 #${i} (${smallStart}-${smallEnd}m) 座標不足: ${smallCoords ? smallCoords.length : 0} 點`);
                                continue;
                            }
                            
                            const statusValue = statusArray[i] || '0';
                            const isCompleted = statusValue !== '0' && statusValue.trim() !== '';
                            
                            // 🔧 根據施工方式決定顏色(與統計面板一致)
                            const diameter = segment.diameter || '';
                            const pipeType = segment.pipeType || '';
                            const method = segment.method || '';
                            const methodKey = [diameter, pipeType, method].filter(Boolean).join('-');
                            const color = getColorForMethodKey(methodKey);
                            
                            const polyline = L.polyline(smallCoords, {
                                color: color,
                                weight: isCompleted ? 6 : 3,  // 完工粗線,未完工細線
                                opacity: isCompleted ? 1 : 0.5
                            }).addTo(map);
                            
                            polyline.on('click', function(e) {
                                // 即時從 segment 重新判斷完工狀態，避免 Optimistic UI 後閉包值過期
                                const _arr = (segment.smallSegments || '').split(',').map(s => s.trim());
                                const _isCompleted = (_arr[i] || '0') !== '0' && (_arr[i] || '').trim() !== '';
                                handleSmallSegmentClick(e, segment, i, smallStart, smallEnd, _isCompleted, polyline, color);
                            });
                            
                            // 🔧 修復: 右鍵選單 - 整段操作
                            polyline.on('contextmenu', function(e) {
                                showSegmentContextMenu(e, segment, color);
                            });
                            
                            allPolylines.push(polyline);
                            
                            // 🚀 儲存到追蹤系統以支援局部更新
                            const trackingKey = `${segment.segmentNumber}-${i}`;
                            smallSegmentPolylines[trackingKey] = {
                                polyline: polyline,
                                segment: segment,
                                smallIndex: i,
                                color: color
                            };
                            
                            successCount++;
                        }
                        console.log(`         ✅ 成功繪製 ${successCount}/${numSmallSegments} 個小段`);
                        
                        // 🏷️ 在段落中間添加標註
                        const midPoint = (segment.startDistance + segment.endDistance) / 2;
                        const midCoords = getSegmentCoordsFromBranch(branch.coords, midPoint - 5, midPoint + 5);
                        if (midCoords.length > 0) {
                            const midLatLng = midCoords[Math.floor(midCoords.length / 2)];
                            
                            // 計算完成長度
                            const statusArray = (segment.smallSegments || '').split(',').map(s => s.trim());
                            let completedLength = 0;
                            for (let i = 0; i < numSmallSegments; i++) {
                                const statusValue = statusArray[i] || '0';
                                if (statusValue !== '0' && statusValue.trim() !== '') {
                                    const smallLength = Math.min(10, segLength - (i * 10));
                                    completedLength += smallLength;
                                }
                            }
                            
                            const diameter = segment.diameter || '';
                            const pipeType = segment.pipeType || '';
                            const method = segment.method || '';
                            const methodKey = [diameter, pipeType, method].filter(Boolean).join('-');
                            const color = getColorForMethodKey(methodKey);
                            const methodLabel = [diameter, pipeType, method].filter(Boolean).join(' ');
                            const labelText = `${methodLabel} ${Math.round(completedLength)}m/${Math.round(segLength)}m`;
                            
                            const label = L.marker(midLatLng, {
                                icon: L.divIcon({
                                    className: 'segment-label',
                                    html: `<div style="
                                        background: transparent;
                                        color: ${color};
                                        padding: 3px 6px;
                                        border-radius: 3px;
                                        font-size: 10px;
                                        font-weight: 700;
                                        white-space: nowrap;
                                        border: none;
                                        pointer-events: none;
                                        text-shadow: 
                                            -1px -1px 0 white,
                                            1px -1px 0 white,
                                            -1px 1px 0 white,
                                            1px 1px 0 white,
                                            0 0 3px white,
                                            0 0 3px white;
                                    ">${labelText}</div>`,
                                    iconSize: null,
                                    iconAnchor: [-50, 15]
                                })
                            }).addTo(map);
                            
                            segmentLabels.push({ marker: label, segmentNumber: segment.segmentNumber, color, methodLabel, segLength });
                            
                            // 節點標記：在段落起點放節點標記
                            if (segment.nodeRange && segment.nodeRange.trim()) {
                                const nodePos = getPositionAtDistance(pipelineCoords, Number(segment.startDistance));
                                if (nodePos) {
                                    const nm = L.marker(nodePos, {
                                        icon: L.divIcon({
                                            className: '',
                                            html: `<div style="position:relative;width:12px;height:12px;cursor:pointer;" title="點擊修改節點名稱">
                                                <div style="width:12px;height:12px;background:white;border:2px solid ${color};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
                                                <div style="position:absolute;left:14px;top:-3px;white-space:nowrap;font-size:11px;font-weight:bold;color:${color};background:white;padding:1px 4px;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.15);">${segment.nodeRange}</div>
                                            </div>`,
                                            iconSize: [12, 12],
                                            iconAnchor: [6, 6]
                                        }),
                                        zIndexOffset: 600
                                    }).addTo(map);
                                    nm.on('click', async function() {
                                        const newName = prompt('修改節點名稱：', segment.nodeRange || '');
                                        if (newName === null) return;
                                        segment.nodeRange = newName.trim();
                                        const notes = buildNotes(newName.trim(), segment.branchIndex);
                                        segment.notes = notes;
                                        try {
                                            await apiCall('updateSegment', {
                                                pipelineId: currentPipeline.id,
                                                segmentNumber: segment.segmentNumber,
                                                startDistance: segment.startDistance,
                                                endDistance: segment.endDistance,
                                                diameter: segment.diameter || '',
                                                pipeType: segment.pipeType || '',
                                                method: segment.method || '',
                                                notes: notes
                                            });
                                            showToast('節點名稱已更新', 'success');
                                            showPipelineDetail(currentPipeline.id, true);
                                        } catch(e) { showToast('更新失敗', 'error'); }
                                    });
                                    allPolylines.push(nm);
                                }
                            }
                        } // end if (midCoords.length > 0)
                    }); // end branchSegments.forEach
                } else {
                    // 沒有段落資料：繪製整條分支
                    const isMain = !branch.isBranch;
                    const color = isMain ? '#e74c3c' : '#9C27B0';
                    
                    const polyline = L.polyline(branch.coords, {
                        color: color,
                        weight: isMain ? 8 : 6,
                        opacity: 0.7
                    }).addTo(map);
                    
                    polyline.on('click', function(e) {
                        L.popup()
                            .setLatLng(e.latlng)
                            .setContent(`
                                <div class="popup-title">${currentPipeline.name}</div>
                                <div class="popup-info">分支 ${branchIndex + 1} / ${branchData.branches.length} (${isMain ? '主幹' : '分支'})</div>
                                <div class="popup-info">管線總長：約 ${totalLength}m</div>
                                <div style="margin-top: 8px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 11px; color: #856404;">
                                    💡 此分支尚未建立段落<br>
                                    請使用「🛠️ 工具 → 📋 段落管理」功能
                                </div>
                            `)
                            .openOn(map);
                    });
                    
                    allPolylines.push(polyline);
                }
            });
        } else {
            // 完全沒有段落資料：顯示整條管線
            console.log('🎨 開始繪製分支（無段落資料）:');
            branchData.branches.forEach((branch, index) => {
                const isMain = !branch.isBranch;
                const color = isMain ? '#e74c3c' : '#9C27B0';
                
                const polyline = L.polyline(branch.coords, {
                    color: color,
                    weight: isMain ? 8 : 6,
                    opacity: 0.7
                }).addTo(map);
                
                polyline.on('click', function(e) {
                    L.popup()
                        .setLatLng(e.latlng)
                        .setContent(`
                            <div class="popup-title">${currentPipeline.name}</div>
                            <div class="popup-info">分支 ${index + 1} / ${branchData.branches.length} (${isMain ? '主幹' : '分支'})</div>
                            <div class="popup-info">管線總長：約 ${totalLength}m</div>
                            <div style="margin-top: 8px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 11px; color: #856404;">
                                💡 請使用「🛠️ 工具 → 📋 段落管理」建立段落
                            </div>
                        `)
                        .openOn(map);
                });
                
                allPolylines.push(polyline);
            });
        }
        
        console.log(`✅ 共繪製 ${branchData.branches.length} 條分支`);
        
    } else {
        // 原本的單一 LINESTRING 處理方式
        const coords = parseLineString(currentPipeline.linestring);
        const totalLength = Math.round(calculateTotalLength(coords));
        
        // 儲存管線總長度到 currentPipeline 物件
        currentPipeline.length = totalLength;
        
        console.log('管線座標點數:', coords.length);
        console.log('管線總長:', totalLength, 'm');
    
        // 如果沒有段落資料，顯示整條管線（備用方案）
        if (currentPipeline.segments.length === 0) {
            console.warn('⚠️ 沒有段落資料，顯示整條管線');
            
            const polyline = L.polyline(coords, {
                color: '#e74c3c',
                weight: 8,
                opacity: 0.7
            }).addTo(map);
            
            polyline.on('click', function(e) {
                L.popup()
                    .setLatLng(e.latlng)
                    .setContent(`
                        <div class="popup-title">${currentPipeline.name}</div>
                        <div class="popup-info">⚠️ 尚未定義段落</div>
                        <div class="popup-info">管線總長：約 ${totalLength}m</div>
                        <div style="margin-top: 8px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 11px; color: #856404;">
                            💡 請在 Google Sheets「施工進度」表中手動設定段落資料<br>
                            或使用「🛠️ 工具 → 📋 段落管理」功能
                        </div>
                    `)
                    .openOn(map);
            });
            
            allPolylines.push(polyline);
        } else {
        // 有段落資料，顯示已定義的段落
        // 先排序段落（按起始距離）
        const sortedSegments = [...currentPipeline.segments].sort((a, b) => a.startDistance - b.startDistance);
        
        sortedSegments.forEach((segment, index) => {
            console.log(`段落 ${segment.segmentNumber}:`, segment.startDistance, '-', segment.endDistance, 'm,', segment.method || '未設定工法');
            
            const startDist = segment.startDistance;
            const endDist = segment.endDistance;
            const method = segment.method || '';
            const status = segment.status || '未施工';
            const diameter = segment.diameter || '';
            const pipeType = segment.pipeType || '';
            
            // 建立 methodKey 用於顏色匹配
            const methodKey = [diameter, pipeType, method].filter(Boolean).join('-');
            
            // 使用自動生成的易區分顏色
            const color = getColorForMethodKey(methodKey);
            
            // 解析小段狀態（K 欄）
            const smallSegmentsStatus = segment.smallSegments || '';
            const statusArray = smallSegmentsStatus.split(',').map(s => s.trim());
            
            // 計算這個段落需要幾個 10m 小段
            const segmentLength = endDist - startDist;
            const numSmallSegments = Math.ceil(segmentLength / 10);
            
            console.log(`  需要 ${numSmallSegments} 個小段`);
            
            // 顯示每個 10m 小段
            for (let i = 0; i < numSmallSegments; i++) {
                const smallStart = startDist + (i * 10);
                const smallEnd = Math.min(startDist + ((i + 1) * 10), endDist);
                
                // 🆕 兼容舊格式 (0/1) 和新格式 (日期)
                const statusValue = statusArray[i] || '0';
                const isCompleted = statusValue !== '0' && statusValue.trim() !== '';
                
                // 計算小段座標（縮短一點點，製造間隙）
                const gapSize = 0.5; // 間隙 0.5m
                const smallCoords = getSegmentCoords(coords, smallStart + gapSize, smallEnd - gapSize);
                
                // Debug: 輸出小段資訊
                if (i < 5 || i === numSmallSegments - 1) { // 只輸出前5個和最後一個
                    console.log(`    小段${i}: ${smallStart}m-${smallEnd}m, 座標點數: ${smallCoords.length}, 完工: ${isCompleted}`);
                }
                
                if (smallCoords.length >= 2) {
                    if (isCompleted) {
                        // 已完工：粗實線
                        const polyline = L.polyline(smallCoords, {
                            color: color,
                            weight: 6,
                            opacity: 1,
                            lineCap: 'round'
                        }).addTo(map);
                        
                        // 儲存段落資訊到 polyline
                        polyline.segmentData = { segment, smallIndex: i, originalColor: color, isCompleted };
                        
                        polyline.on('click', function(e) {
                            const _arr = (segment.smallSegments || '').split(',').map(s => s.trim());
                            const _isCompleted = (_arr[i] || '0') !== '0' && (_arr[i] || '').trim() !== '';
                            handleSmallSegmentClick(e, segment, i, smallStart, smallEnd, _isCompleted, polyline, color);
                        });
                        
                        // 右鍵選單：段落操作
                        polyline.on('contextmenu', function(e) {
                            showSegmentContextMenu(e, segment, color);
                        });
                        
                        allPolylines.push(polyline);
                    } else {
                        // 未完工：細線
                        const polyline = L.polyline(smallCoords, {
                            color: color,
                            weight: 3,
                            opacity: 0.5,
                            lineCap: 'round'
                        }).addTo(map);
                        
                        // 儲存段落資訊到 polyline
                        polyline.segmentData = { segment, smallIndex: i, originalColor: color, isCompleted };
                        
                        polyline.on('click', function(e) {
                            const _arr = (segment.smallSegments || '').split(',').map(s => s.trim());
                            const _isCompleted = (_arr[i] || '0') !== '0' && (_arr[i] || '').trim() !== '';
                            handleSmallSegmentClick(e, segment, i, smallStart, smallEnd, _isCompleted, polyline, color);
                        });
                        
                        // 右鍵選單：段落操作
                        polyline.on('contextmenu', function(e) {
                            showSegmentContextMenu(e, segment, color);
                        });
                        
                        allPolylines.push(polyline);
                    }
                }
            }
            
            // 🆕 在段落中間添加標籤：管徑-管種-施工方式 完成長度/設計長度
            const midPoint = (startDist + endDist) / 2;
            const segCoords = getSegmentCoords(coords, midPoint - 5, midPoint + 5);
            if (segCoords.length > 0) {
                const midLatLng = segCoords[Math.floor(segCoords.length / 2)];
                
                // 計算完成長度
                let completedLength = 0;
                for (let i = 0; i < numSmallSegments; i++) {
                    const statusValue = statusArray[i] || '0';
                    const isCompleted = statusValue !== '0' && statusValue.trim() !== '';
                    if (isCompleted) {
                        const smallLength = Math.min(10, segmentLength - (i * 10));
                        completedLength += smallLength;
                    }
                }
                
                const methodLabel = [diameter, pipeType, method].filter(Boolean).join(' ');
                const labelText = `${methodLabel} ${Math.round(completedLength)}m/${Math.round(segmentLength)}m`;
                
                // 將顏色轉為半透明
                const hexToRgba = (hex, alpha) => {
                    const r = parseInt(hex.slice(1, 3), 16);
                    const g = parseInt(hex.slice(3, 5), 16);
                    const b = parseInt(hex.slice(5, 7), 16);
                    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
                };
                
                const label = L.marker(midLatLng, {
                    icon: L.divIcon({
                        className: 'segment-label',
                        html: `<div style="
                            background: transparent;
                            color: ${color};
                            padding: 3px 6px;
                            border-radius: 3px;
                            font-size: 10px;
                            font-weight: 700;
                            white-space: nowrap;
                            border: none;
                            pointer-events: none;
                            text-shadow: 
                                -1px -1px 0 white,
                                1px -1px 0 white,
                                -1px 1px 0 white,
                                1px 1px 0 white,
                                0 0 3px white,
                                0 0 3px white;
                        ">${labelText}</div>`,
                        iconSize: null,
                        iconAnchor: [-50, 15]  // 向左偏移 50px，向下偏移 15px，遠離管線
                    })
                }).addTo(map);
                
                segmentLabels.push({ marker: label, segmentNumber: segment.segmentNumber, color, methodLabel, segLength: segmentLength }); // 加入標籤陣列，方便隱藏
            }
            
            // 節點標記：在段落起點放節點標記
            if (segment.nodeRange && segment.nodeRange.trim()) {
                const nodeLatLng = getPositionAtDistance(coords, startDist);
                if (nodeLatLng) {
                    const nodeMarker = L.marker(nodeLatLng, {
                        icon: L.divIcon({
                            className: '',
                            html: '<div style="position:relative;width:8px;height:8px;cursor:pointer;">' +
                                '<div style="width:8px;height:8px;background:white;border:2px solid ' + color + ';border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>' +
                                '<div class="node-label" style="color:' + color + ';">' + segment.nodeRange + '</div>' +
                            '</div>',
                            iconSize: [8, 8],
                            iconAnchor: [4, 4]
                        }),
                        zIndexOffset: 600
                    }).addTo(map);
                    // 點擊節點圓圈可編輯名稱
                    nodeMarker.on('click', async function() {
                        const newName = prompt('修改節點名稱：', segment.nodeRange || '');
                        if (newName === null) return;
                        segment.nodeRange = newName.trim();
                        // 更新 notes 並存回伺服器
                        const notes = buildNotes(newName.trim(), segment.branchIndex);
                        segment.notes = notes;
                        try {
                            await apiCall('updateSegment', {
                                pipelineId: currentPipeline.id,
                                segmentNumber: segment.segmentNumber,
                                startDistance: segment.startDistance,
                                endDistance: segment.endDistance,
                                diameter: segment.diameter || '',
                                pipeType: segment.pipeType || '',
                                method: segment.method || '',
                                notes: notes
                            });
                            showToast('節點名稱已更新', 'success');
                            showPipelineDetail(currentPipeline.id, true);
                        } catch(e) { showToast('更新失敗', 'error'); }
                    });
                    allPolylines.push(nodeMarker);
                }
            }
        });
        
        // 找出所有未定義的空隙
        const gaps = [];
        
        // 檢查開頭是否有空隙 (0 到第一段的起始)
        if (sortedSegments.length > 0 && sortedSegments[0].startDistance > 0) {
            gaps.push({
                start: 0,
                end: sortedSegments[0].startDistance
            });
        }
        
        // 檢查中間的空隙
        for (let i = 0; i < sortedSegments.length - 1; i++) {
            const currentEnd = sortedSegments[i].endDistance;
            const nextStart = sortedSegments[i + 1].startDistance;
            
            if (nextStart > currentEnd) {
                gaps.push({
                    start: currentEnd,
                    end: nextStart
                });
            }
        }
        
        // 檢查結尾是否有空隙 (最後一段的結束 到 總長)
        if (sortedSegments.length > 0) {
            const lastEnd = sortedSegments[sortedSegments.length - 1].endDistance;
            if (lastEnd < totalLength) {
                gaps.push({
                    start: lastEnd,
                    end: totalLength
                });
            }
        }
        
        // 顯示所有未定義的空隙（紅色虛線）
        gaps.forEach(gap => {
            console.log(`📍 顯示未定義部分: ${gap.start}m - ${gap.end}m`);
            
            const undefinedCoords = getSegmentCoords(coords, gap.start, gap.end);
            
            if (undefinedCoords.length > 0) {
                const polyline = L.polyline(undefinedCoords, {
                    color: '#e74c3c',
                    weight: 8,
                    opacity: 0.5,
                    dashArray: '10, 10'  // 虛線
                }).addTo(map);
                
                polyline.on('click', function(e) {
                    L.popup()
                        .setLatLng(e.latlng)
                        .setContent(`
                            <div class="popup-title">未定義段落</div>
                            <div class="popup-info">📍 範圍：${gap.start}m - ${gap.end}m</div>
                            <div class="popup-info">📏 長度：${gap.end - gap.start}m</div>
                            <div style="margin-top: 8px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 11px; color: #856404;">
                                💡 請在 Google Sheets「施工進度」表中手動新增這段的資料
                            </div>
                        `)
                        .openOn(map);
                });
                
                allPolylines.push(polyline);
            }
        });
    }
    }  // 結束 MULTILINESTRING 的 else 區塊
    
    // 調整地圖視角（兼容 MULTILINESTRING 和普通 LINESTRING）
    if (!keepView) {
        // 取得所有管線的座標來計算邊界
        const allCoords = [];
        if (isMULTI) {
            // MULTILINESTRING：合併所有分支的座標
            const branchData = parseLineStringWithBranches(currentPipeline.linestring);
            branchData.branches.forEach(branch => {
                allCoords.push(...branch.coords);
            });
        } else {
            // 普通 LINESTRING：使用原本的 coords
            allCoords.push(...parseLineString(currentPipeline.linestring));
        }
        
        if (allCoords.length > 0) {
            map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50] });
        }
    }
    
    // 更新統計面板
    showStatsPanel();
    
    // 顯示地圖備註（只在詳細檢視模式）
    displayMapNotes();
    
    // 載入配電盤標記
    loadPanels();
    
    // 載入工作井
    loadShafts();
    
    // 載入挖掘許可範圍
    loadPermitZones();
    
    // 隱藏獨立的工具按鈕（改用抽屜）
    document.getElementById('ganttBtn').style.display = 'none';
    document.getElementById('editPathBtn').style.display = 'none';
    
    // 顯示工具抽屜按鈕
    document.getElementById('toolsDrawerToggle').style.display = 'block';
    
    // 載入甘特圖資料（📅 按鈕已由 setMapContext 顯示）
    loadGanttItemsForLabels();
    
    // 恢復標記可見性狀態
    // 延遲執行，確保所有標記都已載入
    setTimeout(() => {
        // 先更新按鈕狀態
        const btn = document.getElementById('permitZoneButton');
        if (btn) {
            if (allMarkersVisible) {
                btn.classList.remove('hidden-markers');
                btn.textContent = '👁️';
                btn.title = '隱藏所有標記（備註/配電盤/工作井/挖掘範圍）';
            } else {
                // 如果之前已隱藏，需要移除剛載入的標記
                noteMarkers.forEach(m => map.removeLayer(m));
                panelMarkers.forEach(m => map.removeLayer(m));
                shaftMarkers.forEach(m => map.removeLayer(m));
                permitZones.forEach(z => map.removeLayer(z));
                permitLabels.forEach(l => map.removeLayer(l));
                btn.classList.add('hidden-markers');
                btn.textContent = '🙈';
                btn.title = '顯示所有標記（備註/配電盤/工作井/挖掘範圍）';
            }
        }
    }, 100);
    
    // 移除工程列表和切換按鈕
    const existingList = document.querySelector('.pipeline-list');
    if (existingList) existingList.remove();
    document.getElementById('pipelineListToggle').style.display = 'none';
}

function showSegmentPopup(latlng, segment) {
    const popup = L.popup()
        .setLatLng(latlng)
        .setContent(`
            <div class="popup-title">段落 #${segment.segmentNumber}</div>
            <div class="popup-info">📍 範圍：${segment.startDistance}m - ${segment.endDistance}m</div>
            <div class="popup-info">📏 長度：${segment.endDistance - segment.startDistance}m</div>
            <div class="popup-info">🔧 管徑：${segment.diameter || '未設定'}</div>
            <div class="popup-info">⚙️ 施工方式：${segment.method || '未設定'}</div>
            <div class="popup-info">📊 狀態：${segment.status || '未施工'}</div>
            <button class="popup-button" onclick="editSegment('${segment.segmentNumber}')">✏️ 編輯段落</button>
        `)
        .openOn(map);
}

