async function showPipelineDetail(pipelineId, keepView = false) {
    currentPipeline = allPipelines.find(p => p.id === pipelineId);

    if (typeof ganttData !== 'undefined') ganttData = [];
    if (window.ganttData) window.ganttData = [];
    const _gp = document.getElementById('ganttPanel');
    const _gb = document.getElementById('ganttBackdrop');
    if (_gp) _gp.style.display = 'none';
    if (_gb) _gb.style.display = 'none';
    
    setMapContext('pipeline');
    
    if (!keepView) {
        allMarkersVisible = true;
    }
    
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
    
    const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
    
    if (isMULTI) {
        console.log('🌿 檢測到 MULTILINESTRING 格式');
        
        const branchData = parseLineStringWithBranches(currentPipeline.linestring);
        console.log('   分支數:', branchData.branches.length);
        console.log('   交叉點:', branchData.junctionPoints.length);
        
        let totalLength = 0;
        branchData.branches.forEach(branch => {
            for (let i = 0; i < branch.coords.length - 1; i++) {
                totalLength += getDistance(branch.coords[i], branch.coords[i + 1]);
            }
        });
        totalLength = Math.round(totalLength);
        currentPipeline.length = totalLength;
        
        console.log('   總長度:', totalLength, 'm');
        
        if (currentPipeline.segments && currentPipeline.segments.length > 0) {
            console.log('🎨 開始繪製分支（含段落和小段）:');
            
            branchData.branches.forEach((branch, branchIndex) => {
                if (branchIndex === 0) {
                    console.log('   📊 所有段落的 branchIndex 資訊:');
                    currentPipeline.segments.forEach(seg => {
                        console.log(`      ${seg.segmentNumber}: branchIndex=${seg.branchIndex !== undefined ? seg.branchIndex : '未定義'}, notes="${seg.notes || ''}"`);
                    });
                }
                
                const branchSegments = currentPipeline.segments.filter(seg => {
                    if (seg.branchIndex !== undefined) {
                        return seg.branchIndex === branchIndex;
                    }
                    return branchIndex === 0;
                });
                
                console.log(`   分支 ${branchIndex}: ${branchSegments.length} 個段落`);
                
                if (branchSegments.length > 0) {
                    branchSegments.forEach(segment => {
                        const segLength = segment.endDistance - segment.startDistance;
                        const numSmallSegments = Math.ceil(segLength / 10);
                        
                        console.log(`      🔹 段落 ${segment.segmentNumber}: ${segment.startDistance}-${segment.endDistance}m, 預計 ${numSmallSegments} 個小段`);
                        
                        const segmentCoords = getSegmentCoordsFromBranch(branch.coords, segment.startDistance, segment.endDistance);
                        
                        if (!segmentCoords || segmentCoords.length < 2) {
                            console.warn(`   ⚠️ 段落 ${segment.segmentNumber} 座標計算失敗: ${segmentCoords ? segmentCoords.length : 0} 點`);
                            return;
                        }
                        
                        console.log(`         座標提取成功: ${segmentCoords.length} 個點`);
                        
                        const smallSegmentsStatus = segment.smallSegments || '';
                        const statusArray = smallSegmentsStatus.split(',').map(s => s.trim());
                        
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
                            
                            // 🔧 優先用小段自己的管徑/工法決定顏色
                            let diameter = segment.diameter || '';
                            let pipeType = segment.pipeType || '';
                            let method = segment.method || '';
                            if (segment.smallSegmentDetails && segment.smallSegmentDetails[i]) {
                                const d = segment.smallSegmentDetails[i];
                                diameter = d.diameter || diameter;
                                pipeType = d.pipe_type || pipeType;
                                method = d.method || method;
                            }
                            const methodKey = [diameter, pipeType, method].filter(Boolean).join('-');
                            const color = getColorForMethodKey(methodKey);
                            
                            const polyline = L.polyline(smallCoords, {
                                color: color,
                                weight: isCompleted ? 6 : 3,
                                opacity: isCompleted ? 1 : 0.5
                            }).addTo(map);
                            
                            polyline.on('click', function(e) {
                                const _arr = (segment.smallSegments || '').split(',').map(s => s.trim());
                                const _isCompleted = (_arr[i] || '0') !== '0' && (_arr[i] || '').trim() !== '';
                                handleSmallSegmentClick(e, segment, i, smallStart, smallEnd, _isCompleted, polyline, color);
                            });
                            
                            polyline.on('contextmenu', function(e) {
                                showSegmentContextMenu(e, segment, color);
                            });
                            
                            allPolylines.push(polyline);
                            
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
                            
                            const statusArrayForLabel = (segment.smallSegments || '').split(',').map(s => s.trim());
                            
                            // 統計各工法的長度和完工長度
                            const methodLengths = {};
                            const methodCompleted = {};
                            for (let j = 0; j < numSmallSegments; j++) {
                                let d = segment.diameter || '';
                                let pt = segment.pipeType || '';
                                let m = segment.method || '';
                                if (segment.smallSegmentDetails && segment.smallSegmentDetails[j]) {
                                    const sd = segment.smallSegmentDetails[j];
                                    d = sd.diameter || d;
                                    pt = sd.pipe_type || pt;
                                    m = sd.method || m;
                                }
                                const mk = [d, pt, m].filter(Boolean).join(' ');
                                const sl = Math.min(10, segLength - j * 10);
                                methodLengths[mk] = (methodLengths[mk] || 0) + sl;
                                const sv = statusArrayForLabel[j] || '0';
                                if (sv !== '0' && sv.trim() !== '') {
                                    methodCompleted[mk] = (methodCompleted[mk] || 0) + sl;
                                }
                            }
                            const dominantMethod = Object.entries(methodLengths).sort((a, b) => b[1] - a[1])[0];
                            const methodLabel = dominantMethod ? dominantMethod[0] : [segment.diameter, segment.pipeType, segment.method].filter(Boolean).join(' ');
                            const methodKeyForColor = methodLabel.split(' ').filter(Boolean).join('-');
                            const labelColor = getColorForMethodKey(methodKeyForColor);
                            const domCompleted = methodCompleted[methodLabel] || 0;
                            const domTotal = methodLengths[methodLabel] || segLength;
                            const labelText = `${methodLabel} ${Math.round(domCompleted)}m/${Math.round(domTotal)}m`;
                            
                            const label = L.marker(midLatLng, {
                                icon: L.divIcon({
                                    className: 'segment-label',
                                    html: `<div style="
                                        background: transparent;
                                        color: ${labelColor};
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
                                    iconAnchor: [-5, 20]
                                })
                            }).addTo(map);
                            
                            segmentLabels.push({ marker: label, segmentNumber: segment.segmentNumber, color: labelColor, methodLabel, segLength });
                            
                            if (segment.nodeRange && segment.nodeRange.trim()) {
                                const nodePos = getPositionAtDistance(pipelineCoords, Number(segment.startDistance));
                                if (nodePos) {
                                    const nm = L.marker(nodePos, {
                                        icon: L.divIcon({
                                            className: '',
                                            html: `<div style="position:relative;width:12px;height:12px;cursor:pointer;" title="點擊修改節點名稱">
                                                <div style="width:12px;height:12px;background:white;border:2px solid ${labelColor};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
                                                <div style="position:absolute;left:14px;top:-3px;white-space:nowrap;font-size:11px;font-weight:bold;color:${labelColor};background:white;padding:1px 4px;border-radius:3px;box-shadow:0 1px 3px rgba(0,0,0,0.15);">${segment.nodeRange}</div>
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
                        }
                    });
                } else {
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
        const coords = parseLineString(currentPipeline.linestring);
        const totalLength = Math.round(calculateTotalLength(coords));
        
        currentPipeline.length = totalLength;
        
        console.log('管線座標點數:', coords.length);
        console.log('管線總長:', totalLength, 'm');
    
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
                            💡 請使用「🛠️ 工具 → 📋 段落管理」功能
                        </div>
                    `)
                    .openOn(map);
            });
            
            allPolylines.push(polyline);
        } else {
            const sortedSegments = [...currentPipeline.segments].sort((a, b) => a.startDistance - b.startDistance);
            
            sortedSegments.forEach((segment, index) => {
                console.log(`段落 ${segment.segmentNumber}:`, segment.startDistance, '-', segment.endDistance, 'm,', segment.method || '未設定工法');
                
                const startDist = segment.startDistance;
                const endDist = segment.endDistance;
                const smallSegmentsStatus = segment.smallSegments || '';
                const statusArray = smallSegmentsStatus.split(',').map(s => s.trim());
                const segmentLength = endDist - startDist;
                const numSmallSegments = Math.ceil(segmentLength / 10);
                
                console.log(`  需要 ${numSmallSegments} 個小段`);
                
                for (let i = 0; i < numSmallSegments; i++) {
                    const smallStart = startDist + (i * 10);
                    const smallEnd = Math.min(startDist + ((i + 1) * 10), endDist);
                    
                    // 🔧 優先用小段自己的管徑/工法決定顏色
                    let diameter = segment.diameter || '';
                    let pipeType = segment.pipeType || '';
                    let method = segment.method || '';
                    if (segment.smallSegmentDetails && segment.smallSegmentDetails[i]) {
                        const d = segment.smallSegmentDetails[i];
                        diameter = d.diameter || diameter;
                        pipeType = d.pipe_type || pipeType;
                        method = d.method || method;
                    }
                    const methodKey = [diameter, pipeType, method].filter(Boolean).join('-');
                    const color = getColorForMethodKey(methodKey);
                    
                    const statusValue = statusArray[i] || '0';
                    const isCompleted = statusValue !== '0' && statusValue.trim() !== '';
                    
                    const gapSize = 0.5;
                    const smallCoords = getSegmentCoords(coords, smallStart + gapSize, smallEnd - gapSize);
                    
                    if (i < 5 || i === numSmallSegments - 1) {
                        console.log(`    小段${i}: ${smallStart}m-${smallEnd}m, 座標點數: ${smallCoords.length}, 完工: ${isCompleted}`);
                    }
                    
                    if (smallCoords.length >= 2) {
                        const polyline = L.polyline(smallCoords, {
                            color: color,
                            weight: isCompleted ? 6 : 3,
                            opacity: isCompleted ? 1 : 0.5,
                            lineCap: 'round'
                        }).addTo(map);
                        
                        polyline.segmentData = { segment, smallIndex: i, originalColor: color, isCompleted };
                        
                        polyline.on('click', function(e) {
                            const _arr = (segment.smallSegments || '').split(',').map(s => s.trim());
                            const _isCompleted = (_arr[i] || '0') !== '0' && (_arr[i] || '').trim() !== '';
                            handleSmallSegmentClick(e, segment, i, smallStart, smallEnd, _isCompleted, polyline, color);
                        });
                        
                        polyline.on('contextmenu', function(e) {
                            showSegmentContextMenu(e, segment, color);
                        });
                        
                        allPolylines.push(polyline);
                    }
                }
                
                // 標籤
                const midPoint = (startDist + endDist) / 2;
                const segCoords = getSegmentCoords(coords, midPoint - 5, midPoint + 5);
                if (segCoords.length > 0) {
                    const midLatLng = segCoords[Math.floor(segCoords.length / 2)];
                    
                    // 統計各工法的長度和完工長度
                    const methodLengths = {};
                    const methodCompleted = {};
                    for (let j = 0; j < numSmallSegments; j++) {
                        let d = segment.diameter || '';
                        let pt = segment.pipeType || '';
                        let m = segment.method || '';
                        if (segment.smallSegmentDetails && segment.smallSegmentDetails[j]) {
                            const sd = segment.smallSegmentDetails[j];
                            d = sd.diameter || d;
                            pt = sd.pipe_type || pt;
                            m = sd.method || m;
                        }
                        const mk = [d, pt, m].filter(Boolean).join(' ');
                        const sl = Math.min(10, segmentLength - j * 10);
                        methodLengths[mk] = (methodLengths[mk] || 0) + sl;
                        const sv = statusArray[j] || '0';
                        if (sv !== '0' && sv.trim() !== '') {
                            methodCompleted[mk] = (methodCompleted[mk] || 0) + sl;
                        }
                    }
                    const dominantMethod = Object.entries(methodLengths).sort((a, b) => b[1] - a[1])[0];
                    const methodLabel = dominantMethod ? dominantMethod[0] : [segment.diameter, segment.pipeType, segment.method].filter(Boolean).join(' ');
                    const labelColor = getColorForMethodKey(methodLabel.split(' ').filter(Boolean).join('-'));
                    const domCompleted = methodCompleted[methodLabel] || 0;
                    const domTotal = methodLengths[methodLabel] || segmentLength;
                    const labelText = `${methodLabel} ${Math.round(domCompleted)}m/${Math.round(domTotal)}m`;
                    
                    const label = L.marker(midLatLng, {
                        icon: L.divIcon({
                            className: 'segment-label',
                            html: `<div style="
                                background: transparent;
                                color: ${labelColor};
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
                            iconAnchor: [-5, 20]
                        })
                    }).addTo(map);
                    
                    segmentLabels.push({ marker: label, segmentNumber: segment.segmentNumber, color: labelColor, methodLabel, segLength: segmentLength });
                }
                
                // 節點標記
                if (segment.nodeRange && segment.nodeRange.trim()) {
                    const nodeLatLng = getPositionAtDistance(coords, startDist);
                    if (nodeLatLng) {
                        const segColor = getColorForMethodKey([segment.diameter, segment.pipeType, segment.method].filter(Boolean).join('-'));
                        const nodeMarker = L.marker(nodeLatLng, {
                            icon: L.divIcon({
                                className: '',
                                html: '<div style="position:relative;width:8px;height:8px;cursor:pointer;">' +
                                    '<div style="width:8px;height:8px;background:white;border:2px solid ' + segColor + ';border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>' +
                                    '<div class="node-label" style="color:' + segColor + ';">' + segment.nodeRange + '</div>' +
                                '</div>',
                                iconSize: [8, 8],
                                iconAnchor: [4, 4]
                            }),
                            zIndexOffset: 600
                        }).addTo(map);
                        nodeMarker.on('click', async function() {
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
                        allPolylines.push(nodeMarker);
                    }
                }
            });
            
            // 未定義空隙
            const gaps = [];
            const sortedSegs = [...currentPipeline.segments].sort((a, b) => a.startDistance - b.startDistance);
            if (sortedSegs.length > 0 && sortedSegs[0].startDistance > 0) {
                gaps.push({ start: 0, end: sortedSegs[0].startDistance });
            }
            for (let i = 0; i < sortedSegs.length - 1; i++) {
                const currentEnd = sortedSegs[i].endDistance;
                const nextStart = sortedSegs[i + 1].startDistance;
                if (nextStart > currentEnd) {
                    gaps.push({ start: currentEnd, end: nextStart });
                }
            }
            if (sortedSegs.length > 0) {
                const lastEnd = sortedSegs[sortedSegs.length - 1].endDistance;
                if (lastEnd < totalLength) {
                    gaps.push({ start: lastEnd, end: totalLength });
                }
            }
            
            gaps.forEach(gap => {
                console.log(`📍 顯示未定義部分: ${gap.start}m - ${gap.end}m`);
                const undefinedCoords = getSegmentCoords(coords, gap.start, gap.end);
                if (undefinedCoords.length > 0) {
                    const polyline = L.polyline(undefinedCoords, {
                        color: '#e74c3c',
                        weight: 8,
                        opacity: 0.5,
                        dashArray: '10, 10'
                    }).addTo(map);
                    polyline.on('click', function(e) {
                        L.popup()
                            .setLatLng(e.latlng)
                            .setContent(`
                                <div class="popup-title">未定義段落</div>
                                <div class="popup-info">📍 範圍：${gap.start}m - ${gap.end}m</div>
                                <div class="popup-info">📏 長度：${gap.end - gap.start}m</div>
                                <div style="margin-top: 8px; padding: 8px; background: #fff3cd; border-radius: 4px; font-size: 11px; color: #856404;">
                                    💡 請使用「🛠️ 工具 → 📋 段落管理」新增段落
                                </div>
                            `)
                            .openOn(map);
                    });
                    allPolylines.push(polyline);
                }
            });
        }
    }
    
    if (!keepView) {
        const allCoords = [];
        if (isMULTI) {
            const branchData = parseLineStringWithBranches(currentPipeline.linestring);
            branchData.branches.forEach(branch => {
                allCoords.push(...branch.coords);
            });
        } else {
            allCoords.push(...parseLineString(currentPipeline.linestring));
        }
        if (allCoords.length > 0) {
            map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50] });
        }
    }
    
    showStatsPanel();
    displayMapNotes();
    loadPanels();
    loadShafts();
    loadPermitZones();
    
    document.getElementById('ganttBtn').style.display = 'none';
    document.getElementById('editPathBtn').style.display = 'none';
    document.getElementById('toolsDrawerToggle').style.display = 'block';
    
    loadGanttItemsForLabels();
    
    setTimeout(() => {
        const btn = document.getElementById('permitZoneButton');
        if (btn) {
            if (allMarkersVisible) {
                btn.classList.remove('hidden-markers');
                btn.textContent = '👁️';
                btn.title = '隱藏所有標記（備註/配電盤/工作井/挖掘範圍）';
            } else {
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
