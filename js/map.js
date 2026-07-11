let nodeMarkers = [];

async function showPipelineDetail(pipelineId, keepView = false) {
    // 確保 is_valve 欄位存在（只需執行一次）
    if (!window._valveColumnEnsured) {
        window._valveColumnEnsured = true;
        apiCall('ensureValveColumn', {}).catch(() => {});
    }
    currentPipeline = allPipelines.find(p => p.id === pipelineId);
    if (!currentPipeline) { console.warn('找不到工程:', pipelineId); return; }
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


    
    // 載入小段資料（新架構）
// 確保使用新架構資料
if (currentPipeline._progressLoaded && !currentPipeline.branches) {
    currentPipeline._progressLoaded = false;
}
    
    if (!currentPipeline._progressLoaded) {
        showLoading(true);
        try {
            const data = await apiCall('getAllSmallSegments', { pipelineId });
            // await 期間若使用者已切換工程，放棄寫入，避免汙染到別的工程
            if (!currentPipeline || currentPipeline.id !== pipelineId) { showLoading(false); return; }
            currentPipeline.branches = data.branches || {};
            currentPipeline._progressLoaded = true;
            const totalSegs = Object.values(currentPipeline.branches).reduce((s, arr) => s + arr.length, 0);
            console.log('✅ 載入小段資料：', currentPipeline.name, totalSegs, '個小段');
        } catch (e) {
            console.error('載入小段失敗:', e);
            if (!currentPipeline || currentPipeline.id !== pipelineId) { showLoading(false); return; }
            currentPipeline.branches = {};
            // fallback: 嘗試舊版大段資料
            try {
                const progressData = await apiCall('getProgress', { pipelineId });
                if (!currentPipeline || currentPipeline.id !== pipelineId) { showLoading(false); return; }
                currentPipeline.segments = parseBranchIndexFromSegments(progressData.segments || []);
                currentPipeline._progressLoaded = true;
                console.log('✅ Fallback 載入大段：', currentPipeline.segments.length, '個段落');
            } catch(e2) {
                console.error('Fallback 也失敗:', e2);
            }
        } finally {
            showLoading(false);
        }
    }
    
    console.log('顯示工程:', currentPipeline.name);
    
   nodeMarkers = [];
   clearMap();
    
    const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
    const branchData = isMULTI ? parseLineStringWithBranches(currentPipeline.linestring) : null;
    
    // 計算總長度
    let totalLength = 0;
    if (isMULTI && branchData) {
        branchData.branches.forEach(branch => {
            for (let i = 0; i < branch.coords.length - 1; i++) {
                totalLength += getDistance(branch.coords[i], branch.coords[i + 1]);
            }
        });
    } else {
        const coords = parseLineString(currentPipeline.linestring);
        totalLength = calculateTotalLength(coords);
    }
    totalLength = Math.round(totalLength);
    currentPipeline.length = totalLength;

    // 判斷是否有新架構的小段資料
    const hasBranches = currentPipeline.branches && Object.keys(currentPipeline.branches).length > 0;
    const hasSegments = currentPipeline.segments && currentPipeline.segments.length > 0;

    if (hasBranches) {
        // ========== 新架構：直接從小段資料繪製 ==========
        console.log('🆕 新架構模式：從小段資料繪製');
        
        if (isMULTI && branchData) {
            console.log('🌿 MULTILINESTRING，分支數:', branchData.branches.length);
            
            branchData.branches.forEach((branch, branchIndex) => {
                const branchKey = `B${branchIndex}`;
                const smallSegs = currentPipeline.branches[branchKey] || [];
                
                console.log(`   分支 ${branchIndex}: ${smallSegs.length} 個小段`);
                
                if (smallSegs.length > 0) {
                    let successCount = 0;
                    smallSegs.forEach(seg => {
                        const i = seg.smallIndex;
                        const smallStart = seg.startDistance;
                        const smallEnd = seg.endDistance;
                        
                        const smallCoords = getSegmentCoordsFromBranch(branch.coords, smallStart, smallEnd);
                        if (!smallCoords || smallCoords.length < 2) return;
                        
                        const isCompleted = seg.status !== '0' && seg.status.trim() !== '';
                        const isValve = seg.isValve === 1 || seg.isValve === true || seg.isValve === '1';
                        const diameter = seg.diameter || '';
                        const pipeType = seg.pipeType || '';
                        const method = seg.method || '';
                        const methodKey = [diameter, pipeType, method].filter(Boolean).join('-');
                        const color = (diameter || pipeType || method) 
                            ? getColorForMethodKey(methodKey) 
                            : '#aaaaaa';
                        
                        const polyline = L.polyline(smallCoords, {
                            color: color,
                            weight: 5,
                            opacity: isCompleted ? 1 : 0.35
                        }).addTo(map);
                        
                        polyline.on('click', function(e) {
                            handleNewSmallSegmentClick(e, branchIndex, i, smallStart, smallEnd, seg, polyline, color);
                        });
                        
                        polyline.on('contextmenu', function(e) {
                            showNewSmallSegmentContextMenu(e, branchIndex, i, seg);
                        });
                        
                        allPolylines.push(polyline);
                        
                        const trackingKey = `${branchKey}-${i}`;
                        smallSegmentPolylines[trackingKey] = { polyline, seg, branchIndex, smallIndex: i, color };
                        // 制水閥：在中點畫垂直紅線（十字形）
                        if (isValve) drawValveCross(smallCoords, trackingKey);
                        // 繪製節點標記（可拖曳搬移，見 drawNodeNameMarker）
if (seg.nodeName && seg.nodeName.trim()) {
    const nodeCoords = getSegmentCoordsFromBranch(branch.coords, smallStart, smallStart + 1);
    if (nodeCoords && nodeCoords.length > 0) {
        drawNodeNameMarker(nodeCoords[0], seg, branchIndex, i, color);
    }
}
                        successCount++;
                    });
                    console.log(`   ✅ 成功繪製 ${successCount}/${smallSegs.length} 個小段`);
                    
                    // 繪製標籤
                    drawBranchLabel(branch, branchIndex, smallSegs);
                } else {
                    // 分支沒有小段資料，畫灰色虛線
                    const isMain = !branch.isBranch;
                    const polyline = L.polyline(branch.coords, {
                        color: '#aaaaaa',
                        weight: isMain ? 6 : 4,
                        opacity: 0.5,
                        dashArray: '8, 6'
                    }).addTo(map);
                    polyline.on('click', function(e) {
                        L.popup().setLatLng(e.latlng).setContent(`
                            <div class="popup-title">分支 ${branchIndex}</div>
                            <div class="popup-info">尚未設定管線資料</div>
                            <div class="popup-info">點選小段後可設定管徑/管材/施工方式</div>
                        `).openOn(map);
                    });
                    allPolylines.push(polyline);
                }
            });
            console.log(`✅ 共繪製 ${branchData.branches.length} 條分支`);
        } else {
            // 單一 LINESTRING
            const coords = parseLineString(currentPipeline.linestring);
            const branchKey = 'B0';
            const smallSegs = currentPipeline.branches[branchKey] || [];
            
            console.log(`🔵 LINESTRING，${smallSegs.length} 個小段`);
            
            if (smallSegs.length > 0) {
                smallSegs.forEach(seg => {
                    const i = seg.smallIndex;
                    const gapSize = 0.5;
                    const smallCoords = getSegmentCoords(coords, seg.startDistance + gapSize, seg.endDistance - gapSize);
                    if (smallCoords.length < 2) return;
                    
                    const isCompleted = seg.status !== '0' && seg.status.trim() !== '';
                    const isValve = seg.isValve === 1 || seg.isValve === true || seg.isValve === '1';
                    const diameter = seg.diameter || '';
                    const pipeType = seg.pipeType || '';
                    const method = seg.method || '';
                    const methodKey = [diameter, pipeType, method].filter(Boolean).join('-');
                    const color = (diameter || pipeType || method) 
                        ? getColorForMethodKey(methodKey) 
                        : '#aaaaaa';
                    
                    const polyline = L.polyline(smallCoords, {
                        color: color,
                        weight: 5,
                        opacity: isCompleted ? 1 : 0.35,
                        lineCap: 'round'
                    }).addTo(map);
                    
                    polyline.on('click', function(e) {
                        handleNewSmallSegmentClick(e, 0, i, seg.startDistance, seg.endDistance, seg, polyline, color);
                    });
                    
                    allPolylines.push(polyline);
                    const trackingKeyB0 = `B0-${i}`;
                    smallSegmentPolylines[trackingKeyB0] = { polyline, seg, branchIndex: 0, smallIndex: i, color };
                    // 🐛 修正：單一 LINESTRING（無分支）的管線原本完全沒呼叫 drawValveCross，
                    // 制水閥只有在 MULTILINESTRING（有分支）的管線才畫得出來。
                    if (isValve) drawValveCross(smallCoords, trackingKeyB0);
                    // 🐛 修正：單一 LINESTRING 原本也沒畫「節點名稱」標記（與制水閥同類遺漏），
                    // 就算小段上有設定節點名稱也看不到。這裡補上，與分支管線行為一致。
                    if (seg.nodeName && seg.nodeName.trim()) {
                        const nodeCoords = getSegmentCoords(coords, seg.startDistance, seg.startDistance + 1);
                        if (nodeCoords && nodeCoords.length > 0) {
                            drawNodeNameMarker(nodeCoords[0], seg, 0, i, color);
                        }
                    }
                });
            } else {
                const polyline = L.polyline(coords, {
                    color: '#aaaaaa', weight: 6, opacity: 0.5, dashArray: '8, 6'
                }).addTo(map);
                allPolylines.push(polyline);
            }
        }
    } else if (hasSegments) {
        // ========== 舊架構 Fallback：大段模式 ==========
        console.log('📦 舊架構 Fallback 模式');
        drawLegacySegments(isMULTI, branchData, totalLength);
    } else {
        // ========== 無資料：畫灰色管線 ==========
        console.log('⚪ 無段落資料，顯示路徑輪廓');
        if (isMULTI && branchData) {
            branchData.branches.forEach((branch, index) => {
                const isMain = !branch.isBranch;
                const polyline = L.polyline(branch.coords, {
                    color: isMain ? '#e74c3c' : '#9C27B0',
                    weight: isMain ? 8 : 6,
                    opacity: 0.7
                }).addTo(map);
                polyline.on('click', function(e) {
                    L.popup().setLatLng(e.latlng).setContent(`
                        <div class="popup-title">${currentPipeline.name}</div>
                        <div class="popup-info">分支 ${index + 1} / ${branchData.branches.length}</div>
                        <div class="popup-info">管線總長：約 ${totalLength}m</div>
                        <div style="margin-top:8px;padding:8px;background:#fff3cd;border-radius:4px;font-size:11px;color:#856404;">
                            💡 路徑已儲存，小段已自動產生<br>點擊小段可設定管徑/管材/施工方式
                        </div>
                    `).openOn(map);
                });
                allPolylines.push(polyline);
            });
        } else {
            const coords = parseLineString(currentPipeline.linestring);
            const polyline = L.polyline(coords, {
                color: '#e74c3c', weight: 8, opacity: 0.7
            }).addTo(map);
            allPolylines.push(polyline);
        }
    }
    
    // 調整視角
    if (!keepView) {
        const allCoords = [];
        if (isMULTI && branchData) {
            branchData.branches.forEach(branch => allCoords.push(...branch.coords));
        } else {
            allCoords.push(...parseLineString(currentPipeline.linestring));
        }
        if (allCoords.length > 0) {
            map.fitBounds(L.latLngBounds(allCoords), { padding: [50, 50] });
        }
    }

    // 節點名稱框、段落標籤（工法/進度/節點區間）剛剛才畫出來，
    // 立刻套用一次目前縮放層級該有的顯示/隱藏狀態（避免要等使用者手動縮放一次才生效）。
    if (typeof updateNodeLabelVisibility === 'function') updateNodeLabelVisibility();
    scheduleLabelCollisions();

    showStatsPanel();
    await loadMapNotes();
    loadPanels();
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
                btn.title = '隱藏所有標記';
            } else {
                noteMarkers.forEach(m => map.removeLayer(m));
                panelMarkers.forEach(m => map.removeLayer(m));
                permitZones.forEach(z => map.removeLayer(z));
                permitLabels.forEach(l => map.removeLayer(l));
                btn.classList.add('hidden-markers');
                btn.textContent = '🙈';
                btn.title = '顯示所有標記';
            }
        }
    }, 100);
    
    const existingList = document.querySelector('.pipeline-list');
    if (existingList) existingList.remove();
    document.getElementById('pipelineListToggle').style.display = 'none';
}

// ========== 新架構：繪製分支標籤 ==========
function drawBranchLabel(branch, branchIndex, smallSegs) {
    if (!smallSegs || smallSegs.length === 0) return;

    // 按「節點區間 + 工法」分組
    // 找出所有節點名稱變化點，切成區間
    const groups = []; // [{fromNode, toNode, method, segs:[]}]

    let currentGroup = null;
    smallSegs.forEach((seg, i) => {
        const d = seg.diameter || '';
        const pt = seg.pipeType || '';
        const m = seg.method || '';
        if (!d && !pt && !m) return;
        const methodKey = [d, pt, m].filter(Boolean).join(' ');

        // 節點名稱：有 nodeName 的 seg 作為新節點起點
        const nodeStart = seg.nodeName && seg.nodeName.trim() ? seg.nodeName.trim() : null;

        if (!currentGroup || methodKey !== currentGroup.method || (nodeStart && nodeStart !== currentGroup.fromNode)) {
            currentGroup = { fromNode: nodeStart || currentGroup?.toNode || '', toNode: '', method: methodKey, segs: [] };
            groups.push(currentGroup);
        }
        if (nodeStart) currentGroup.fromNode = nodeStart;
        currentGroup.segs.push(seg);
    });

    // 找每個區間的終點節點（下一個區間的起點）
    groups.forEach((g, gi) => {
        const nextGroup = groups[gi + 1];
        g.toNode = nextGroup?.fromNode || '';
    });

    if (groups.length === 0) return;

    groups.forEach(g => {
        if (g.segs.length === 0) return;
        const total = g.segs.reduce((s, seg) => s + (seg.endDistance - seg.startDistance), 0);
        // 太短的區間不顯示標籤（避免尾段零碎標籤）
        if (total < 15) return;
        const completed = g.segs.reduce((s, seg) => {
            const done = seg.status !== '0' && seg.status.trim() !== '';
            return s + (done ? seg.endDistance - seg.startDistance : 0);
        }, 0);

        // 標籤文字：「工法 完工m/總長m」，節點資訊放 tooltip
        const labelText = `${g.method} ${Math.round(completed)}m/${Math.round(total)}m`;
        const labelColor = getColorForMethodKey(g.method.split(' ').filter(Boolean).join('-'));

        // 標籤放在這組小段中間
        const midSeg = g.segs[Math.floor(g.segs.length / 2)];
        const midDist = (midSeg.startDistance + midSeg.endDistance) / 2;
        let midLatLng = null;
        const midCoords = getSegmentCoordsFromBranch(branch.coords, midDist - 5, midDist + 5);
        if (midCoords && midCoords.length > 0) {
            midLatLng = midCoords[Math.floor(midCoords.length / 2)];
        } else {
            const branchLen = branch.coords.length;
            if (branchLen >= 2) {
                const lastDist = g.segs[g.segs.length-1].endDistance || 1;
                const ratio = midDist / lastDist;
                const idx = Math.min(Math.floor(ratio * (branchLen-1)), branchLen-2);
                const p1 = branch.coords[idx];
                const p2 = branch.coords[idx+1];
                midLatLng = [(p1[0]+p2[0])/2, (p1[1]+p2[1])/2];
            }
        }
        if (!midLatLng) return;

        // 節點資訊行（有節點名稱才顯示）
        const nodeInfo = (g.fromNode || g.toNode)
            ? `<div style="font-size:9px;opacity:0.8;margin-top:1px;">${g.fromNode}${g.fromNode && g.toNode ? ' → ' : ''}${g.toNode}</div>`
            : '';

        const label = L.marker(midLatLng, {
            icon: L.divIcon({
                // zoom-detail-label：只在接近最大縮放層級時才顯示（見 plan-overview.js 的 updateNodeLabelVisibility）
                className: 'segment-label zoom-detail-label',
                html: `<div class="_lbl-collide" style="
                    background: transparent;
                    color: ${labelColor};
                    padding: 3px 6px;
                    border-radius: 3px;
                    font-size: 10px;
                    font-weight: 700;
                    white-space: nowrap;
                    border: none;
                    pointer-events: none;
                    user-select: none;
                    text-shadow: -1px -1px 0 white, 1px -1px 0 white, -1px 1px 0 white, 1px 1px 0 white;
                ">${labelText}${nodeInfo}</div>`,
                iconSize: null,
                iconAnchor: [-5, 20]
            }),
            interactive: false
        }).addTo(map);

        segmentLabels.push({ marker: label, segmentNumber: `B${branchIndex}`, color: labelColor, methodLabel: g.method });
    });
}

// ========== 新架構：點擊小段處理 ==========
window.handleNewSmallSegmentClick = function(e, branchIndex, smallIndex, smallStart, smallEnd, seg, polyline, color) {
    const isCompleted = seg.status !== '0' && seg.status.trim() !== '';
    const isValve = seg.isValve === 1 || seg.isValve === true || seg.isValve === '1';
    const diameter = seg.diameter || '未設定';
    const pipeType = seg.pipeType || '未設定';
    const method = seg.method || '未設定';
    const statusIcon = isCompleted ? '🟢' : '⚪';
    const statusText = isCompleted ? (seg.status.includes('-') ? `完工日期：${seg.status}` : '已完工') : '未完工';
    
    // 檢查是否為「起點選取」模式
    if (window._rangeSelectStart) {
        const start = window._rangeSelectStart;
        if (start.branchIndex === branchIndex) {
            // 同分支，執行範圍選取
            window._rangeSelectStart = null;
            document.getElementById('_rangeSelectHint')?.remove();
            showRangeSetDialog(branchIndex, start.smallIndex, smallIndex);
            return;
        } else {
            // 不同分支，取消
            window._rangeSelectStart = null;
            document.getElementById('_rangeSelectHint')?.remove();
            showToast('請在同一分支上選取範圍', 'warning');
        }
    }
    
const popup = L.popup()
    .setLatLng(e.latlng)
    .setContent(`
        <div class="popup-title">小段 #${smallIndex + 1}</div>
        <div class="popup-info">📍 位置：${smallStart}m - ${smallEnd}m</div>
        <div class="popup-info">🔧 管徑：${diameter}</div>
        <div class="popup-info">🔩 管種：${pipeType}</div>
        <div class="popup-info">⚙️ 施工方式：${method}</div>
        <div class="popup-info">📊 狀態：${statusText} ${statusIcon}</div>
        <div style="margin:8px 0;">
            <label style="font-size:12px;color:#555;">🔖 節點名稱</label>
            <div style="display:flex;gap:6px;margin-top:4px;">
                <input type="text" id="nodeNameInput" value="${seg.nodeName||''}" placeholder="例如：節點1"
                    style="flex:1;padding:6px;border:1px solid #ddd;border-radius:6px;font-size:13px;">
                <button onclick="saveNodeName(${branchIndex}, ${smallIndex})"
                    style="padding:6px 10px;background:#4CAF50;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">
                    儲存
                </button>
            </div>
        </div>
        <button class="popup-button" onclick="toggleNewSmallSegment(${branchIndex}, ${smallIndex})">
            ${isCompleted ? '❌ 標記未完工' : '✓ 標記完工'}
        </button>
        <button class="popup-button" style="background:${isValve ? '#b71c1c' : '#78909c'};margin-top:4px;"
            onclick="toggleValve(${branchIndex}, ${smallIndex})">
            🔴 ${isValve ? '移除制水閥' : '標記制水閥'}
        </button>
        <button class="popup-button" style="background:#2196F3;margin-top:4px;" 
            onclick="startRangeSelect(${branchIndex}, ${smallIndex}); map.closePopup();">
            📏 設定範圍屬性（此段為起點）
        </button>
        <button class="popup-button" style="background:#ff9800;margin-top:4px;"
            onclick="openPhotoPanel('${currentPipeline.id}', 'B${branchIndex}', ${smallIndex}); map.closePopup();">
            📷 施工照片
        </button>
    `)
    .openOn(map);
};

// ===== 節點名稱標記（可拖曳搬移）=====
// 節點1/節點2 這種「命名節點」是掛在某個小段上的屬性（node_name），
// 不是路徑編輯模式裡那些白色圓圈（幾何節點）。
// 這裡讓命名節點標記可以直接用滑鼠拖曳：放開時吸附到最近的小段，
// 把節點名稱從舊小段搬到新小段（等同右鍵清除舊的 + 在新位置填名稱，但一步完成）。
function drawNodeNameMarker(latlng, seg, branchIndex, smallIndex, color) {
    const nodeMarker = L.marker(latlng, {
        icon: L.divIcon({
            // 節點標記：倒數第三層（maxZoom-2）以後才顯示——縮小看全線時
            // 大量節點框會擠成一長條遮住地圖；隱藏時本來也不需要拖曳，
            // 放大到會顯示的層級後，拖曳搬移功能照常可用。
            // （段落進度文字用 zoom-detail-label，門檻是倒數第二層，兩者分開控制）
            className: 'zoom-node-label',
            html: `<div style="position:relative;width:10px;height:10px;">
                <div style="width:10px;height:10px;background:white;border:2px solid ${color};border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:move;"></div>
                <div class="_lbl-collide" style="position:absolute;left:10px;top:-22px;white-space:nowrap;font-size:9px;font-weight:bold;color:${color};background:white;padding:2px 5px;border-radius:3px;border:1.5px solid ${color};box-shadow:0 1px 4px rgba(0,0,0,0.2);pointer-events:none;">${seg.nodeName}</div>
            </div>`,
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        }),
        zIndexOffset: 600,
        draggable: true
    }).addTo(map);

    nodeMarker.nodeData = {
        branchIndex: branchIndex,
        smallIndex: smallIndex,
        nodeName: seg.nodeName,
        startDistance: seg.startDistance
    };

    nodeMarker.on('dragstart', function() { this._origLatLng = this.getLatLng(); });
    nodeMarker.on('dragend', function() { handleNodeMarkerDrag(this); });

    allPolylines.push(nodeMarker);
    nodeMarkers.push(nodeMarker);
    return nodeMarker;
}

async function handleNodeMarkerDrag(marker) {
    const revert = () => { if (marker._origLatLng) marker.setLatLng(marker._origLatLng); };

    if (!requireLogin()) { revert(); return; }

    const nd = marker.nodeData;
    const drop = marker.getLatLng();

    // 吸附：在所有小段中找離放開位置最近的一段
    let best = null, bestDist = Infinity;
    Object.keys(smallSegmentPolylines).forEach(key => {
        const t = smallSegmentPolylines[key];
        if (!t || !t.polyline) return;
        t.polyline.getLatLngs().forEach(ll => {
            const d = getDistance([drop.lat, drop.lng], [ll.lat, ll.lng]);
            if (d < bestDist) { bestDist = d; best = t; }
        });
    });

    if (!best || bestDist > 100) {
        showToast('放開的位置離管線太遠（超過 100m），已取消搬移', 'warning');
        revert();
        return;
    }
    // 放回原地（同一小段）＝取消
    if (best.branchIndex === nd.branchIndex && best.smallIndex === nd.smallIndex) { revert(); return; }

    const targetSeg = best.seg;
    if (targetSeg.nodeName && targetSeg.nodeName.trim()) {
        showToast(`目標位置已有節點「${targetSeg.nodeName}」，請先清除它或選其他位置`, 'warning');
        revert();
        return;
    }

    // 🆕 「段落分界節點」的拖曳＝移動分界本身（不只是搬名牌）。
    // 多段式管線（節點1→節點2、節點2→節點3 是兩段獨立的線）的分界節點
    // 位於後段的第 0 小段；把它往前/往後拖時，兩段之間的管段（連同管徑/工法/
    // 完工狀態等屬性）要跟著劃給另一段，這才是「節點1-節點2 變 150m、
    // 節點2-節點3 變 320m」的正確語意。若只搬名牌，中間會多出一截孤段。
    const isBoundaryNode = nd.smallIndex === 0 && nd.branchIndex > 0;
    if (isBoundaryNode && (best.branchIndex === nd.branchIndex - 1 || best.branchIndex === nd.branchIndex)) {
        const done = await moveSectionBoundary(nd, best, targetSeg, marker);
        if (done !== 'fallback') { if (!done) revert(); return; }
        // done === 'fallback'：結構不連續等原因，往下走一般名牌搬移
    }

    // 🆕 工法分界跟著節點走：節點是「區間」的分界，拖動節點時，
    // 新舊位置之間的小段應改屬於另一側的區間，其管徑/管種/工法一併改為
    // 該區間的屬性（完工狀態、照片等施工紀錄保留不動）。
    // 只處理同一段內的搬移；oldIdx=0（整條線起點，如節點1）往後拖時
    // 前面沒有區間可歸屬，維持純名牌搬移。
    let attrReassign = null; // { fromIdx, toIdx, src: {diameter,pipeType,method} }
    if (best.branchIndex === nd.branchIndex) {
        const branchSegs = currentPipeline.branches[`B${nd.branchIndex}`] || [];
        const oldIdx = nd.smallIndex, newIdx = best.smallIndex;
        let srcSeg = null, fromIdx = -1, toIdx = -1;
        if (newIdx < oldIdx) {
            // 往前拖：新舊位置之間的段改屬「後區間」（原本節點起頭的那個區間）
            srcSeg = branchSegs.find(sg => sg.smallIndex === oldIdx);
            fromIdx = newIdx; toIdx = oldIdx - 1;
        } else if (newIdx > oldIdx && oldIdx > 0) {
            // 往後拖：中間的段改屬「前區間」
            srcSeg = branchSegs.find(sg => sg.smallIndex === oldIdx - 1);
            fromIdx = oldIdx; toIdx = newIdx - 1;
        }
        if (srcSeg && fromIdx <= toIdx) {
            attrReassign = {
                fromIdx, toIdx,
                src: { diameter: srcSeg.diameter || '', pipeType: srcSeg.pipeType || '', method: srcSeg.method || '' }
            };
        }
    }

    const spanLen = attrReassign ? (attrReassign.toIdx - attrReassign.fromIdx + 1) * 10 : 0;
    const attrNote = attrReassign
        ? `\n\n中間約 ${spanLen}m 的區段將改屬另一側區間\n（管徑/工法改為「${[attrReassign.src.diameter, attrReassign.src.pipeType, attrReassign.src.method].filter(Boolean).join(' ')}」，完工紀錄保留）`
        : '';
    const ok = await showConfirm({
        title: '搬移節點',
        message: `將「${nd.nodeName}」移到 分支B${best.branchIndex} 的 ${targetSeg.startDistance}m 處？${attrNote}`,
        okText: '搬移'
    });
    if (!ok) { revert(); return; }

    try {
        // 兩步：清掉舊小段的名稱、寫入新小段（後端 updateSmallSegmentInfo 支援只更新 nodeName）
        await apiCall('updateSmallSegmentInfo', {
            pipelineId: currentPipeline.id,
            segmentNumber: `B${nd.branchIndex}`,
            smallIndex: nd.smallIndex,
            nodeName: ''
        });
        await apiCall('updateSmallSegmentInfo', {
            pipelineId: currentPipeline.id,
            segmentNumber: `B${best.branchIndex}`,
            smallIndex: best.smallIndex,
            nodeName: nd.nodeName
        });

        // 更新本地資料並重繪（標籤上的節點區間文字也要跟著更新）
        const oldSeg = (currentPipeline.branches[`B${nd.branchIndex}`] || []).find(s => s.smallIndex === nd.smallIndex);
        if (oldSeg) oldSeg.nodeName = '';
        targetSeg.nodeName = nd.nodeName;

        // 🆕 區段改屬：新舊位置之間的小段，管徑/管種/工法改為另一側區間的屬性
        // （後端 batchUpdateSmallSegments 只更新這三欄，完工狀態/照片不動）
        if (attrReassign) {
            await apiCall('batchUpdateSmallSegments', {
                pipelineId: currentPipeline.id,
                branchIndex: nd.branchIndex,
                fromIndex: attrReassign.fromIdx,
                toIndex: attrReassign.toIdx,
                diameter: attrReassign.src.diameter,
                pipeType: attrReassign.src.pipeType,
                method: attrReassign.src.method
            });
            (currentPipeline.branches[`B${nd.branchIndex}`] || []).forEach(sg => {
                if (sg.smallIndex >= attrReassign.fromIdx && sg.smallIndex <= attrReassign.toIdx) {
                    sg.diameter = attrReassign.src.diameter;
                    sg.pipeType = attrReassign.src.pipeType;
                    sg.method = attrReassign.src.method;
                }
            });
        }

        showToast(`✅ 「${nd.nodeName}」已移到 ${targetSeg.startDistance}m 處`, 'success');
        if (typeof isEditingPath !== 'undefined' && isEditingPath) {
            // 路徑編輯模式中不整頁重繪（會蓋掉編輯中的線形與白色幾何節點）：
            // 直接把標記吸到目標小段的起點、更新標記身上的資料即可；
            // 完整重繪等結束編輯（存檔或取消）時自然會做。
            const lls = best.polyline.getLatLngs();
            if (lls && lls.length) marker.setLatLng(lls[0]);
            marker.nodeData = {
                branchIndex: best.branchIndex,
                smallIndex: best.smallIndex,
                nodeName: nd.nodeName,
                startDistance: targetSeg.startDistance
            };
        } else {
            showPipelineDetail(currentPipeline.id, true);
        }
    } catch (e) {
        showToast('搬移失敗：' + e.message, 'error');
        revert();
    }
}

// 在指定距離處切割座標串（回傳的 head 尾與 tail 頭共用同一個內插點）
function _splitCoordsAtDistance(coords, d) {
    const head = [coords[0]];
    let acc = 0;
    for (let i = 1; i < coords.length; i++) {
        const segLen = getDistance(coords[i - 1], coords[i]);
        if (acc + segLen < d - 0.01) {
            head.push(coords[i]);
            acc += segLen;
            continue;
        }
        // 內插切割點
        const t = segLen > 0 ? (d - acc) / segLen : 0;
        const cut = [
            coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
            coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t
        ];
        head.push(cut);
        const tail = [cut, ...coords.slice(i)];
        return { head, tail };
    }
    return { head: coords.slice(), tail: [coords[coords.length - 1]] };
}

function _branchLenRounded(coords) {
    let len = 0;
    for (let i = 0; i < coords.length - 1; i++) len += getDistance(coords[i], coords[i + 1]);
    return Math.round(len);
}

function _rebuildWkt(branches, isMULTI) {
    const bodies = branches.map(c => '(' + c.map(pt => pt[1] + ' ' + pt[0]).join(', ') + ')');
    if (isMULTI) return 'MULTILINESTRING(' + bodies.join(', ') + ')';
    return bodies.map(b => 'LINESTRING' + b).join('');
}

// 移動段落分界：把分界節點（後段 Bk 的起點）沿著管線前後拖，
// 兩段之間的管段連同小段屬性一起劃給另一段。
// 回傳 true=完成、false=使用者取消或失敗、'fallback'=結構不適用（走一般名牌搬移）
async function moveSectionBoundary(nd, best, targetSeg, marker) {
    const k = nd.branchIndex;             // 後段（分界節點所在的分支）
    const a = k - 1, b = k;               // 前段 / 後段
    const wkt = currentPipeline.linestring;
    const isMULTI = wkt.trim().toUpperCase().startsWith('MULTILINESTRING');
    const parsed = parseLineStringWithBranches(wkt);
    const brA = parsed.branches[a], brB = parsed.branches[b];
    if (!brA || !brB) return 'fallback';

    // 兩段必須頭尾相接（多段式管線）；真正的 Y 型分支不適用分界移動
    if (getDistance(brA.coords[brA.coords.length - 1], brB.coords[0]) > 1) {
        showToast('這個節點位於分岔點（Y型分支），只搬移名稱、不移動分界', 'info');
        return 'fallback';
    }

    const lenA = _branchLenRounded(brA.coords);
    const lenB = _branchLenRounded(brB.coords);
    const segsA = Math.ceil(lenA / 10), segsB = Math.ceil(lenB / 10);
    const d = targetSeg.startDistance;    // 目標小段起點（10 的倍數）

    const newBranches = parsed.branches.map(br => br.coords.slice());
    const remap = {};
    let movedCount = 0;         // 跨段搬移的小段數
    let dropSrc = null;         // 節點名牌原始來源會落到的新位置（要清掉）

    if (best.branchIndex === a) {
        // ── 往前拖（分界向節點1 方向移動 d < lenA）──
        if (d <= 0) { showToast('不能把分界拖到前段起點（前段會消失）', 'warning'); return false; }
        movedCount = segsA - d / 10;
        const cut = _splitCoordsAtDistance(brA.coords, d);
        newBranches[a] = cut.head;
        newBranches[b] = [...cut.tail, ...brB.coords.slice(1)];
        remap['B' + a] = Array.from({ length: d / 10 }, (_, i) => ({ s: 'B' + a, i }));
        remap['B' + b] = [
            ...Array.from({ length: movedCount }, (_, i) => ({ s: 'B' + a, i: d / 10 + i })),
            ...Array.from({ length: segsB }, (_, i) => ({ s: 'B' + b, i }))
        ];
        dropSrc = { branch: 'B' + b, idx: movedCount }; // 舊 Bb 第0段（帶名牌）會落在這
    } else {
        // ── 往後拖（分界向節點3 方向移動 d > 0，在 Bb 上）──
        if (d <= 0) return false; // 放回原位
        movedCount = d / 10;
        const cut = _splitCoordsAtDistance(brB.coords, d);
        newBranches[a] = [...brA.coords, ...cut.head.slice(1)];
        newBranches[b] = cut.tail;
        remap['B' + a] = [
            ...Array.from({ length: segsA }, (_, i) => ({ s: 'B' + a, i })),
            ...Array.from({ length: movedCount }, (_, i) => ({ s: 'B' + b, i }))
        ];
        remap['B' + b] = Array.from({ length: segsB - movedCount }, (_, i) => ({ s: 'B' + b, i: movedCount + i }));
        dropSrc = { branch: 'B' + a, idx: segsA }; // 舊 Bb 第0段（帶名牌）會落在前段尾
    }

    const newLenA = _branchLenRounded(newBranches[a]);
    const newLenB = _branchLenRounded(newBranches[b]);
    const ok = await showConfirm({
        title: '移動段落分界',
        message: `將「${nd.nodeName}」的分界移到此處？\n\n前段：${lenA}m → ${newLenA}m\n後段：${lenB}m → ${newLenB}m\n\n中間的管段（含管徑/工法/完工狀態）會跟著劃給另一段。`,
        okText: '移動分界'
    });
    if (!ok) return false;

    try {
        const newWkt = _rebuildWkt(newBranches, isMULTI);
        const body = new URLSearchParams({
            pipelineId: currentPipeline.id,
            linestring: newWkt,
            branchLengths: JSON.stringify(newBranches.map((c, idx) => ({ branchIndex: idx, length: _branchLenRounded(c) }))),
            indexRemap: JSON.stringify(remap)
        });
        const result = await apiCall('updateLinestring', {}, { body });
        if (!result.success) throw new Error(result.error || '更新失敗');

        // 名牌歸位：分界節點的名稱永遠在「後段的第 0 小段」；
        // 舊名牌隨屬性搬移落到的位置要清掉，再寫到正確位置。
        if (!(dropSrc.branch === 'B' + b && dropSrc.idx === 0)) {
            await apiCall('updateSmallSegmentInfo', {
                pipelineId: currentPipeline.id,
                segmentNumber: dropSrc.branch,
                smallIndex: dropSrc.idx,
                nodeName: ''
            });
            await apiCall('updateSmallSegmentInfo', {
                pipelineId: currentPipeline.id,
                segmentNumber: 'B' + b,
                smallIndex: 0,
                nodeName: nd.nodeName
            });
        }

        // 🆕 區段改屬：搬到另一段的那些小段，管徑/管種/工法改為目的段的屬性
        // （完工紀錄已透過重對應表原位保留，這裡只統一三個屬性欄位）
        if (movedCount > 0) {
            const brsA = currentPipeline.branches['B' + a] || [];
            const brsB = currentPipeline.branches['B' + b] || [];
            let destAttrs = null, batchArgs = null;
            if (best.branchIndex === a) {
                // 往前拖：搬過去的段在「新後段」開頭，屬性改為原後段的（取原 Bb 第0段）
                destAttrs = brsB.find(sg => sg.smallIndex === 0);
                if (destAttrs) batchArgs = { branchIndex: b, fromIndex: 0, toIndex: movedCount - 1 };
            } else {
                // 往後拖：搬過去的段在「新前段」尾端，屬性改為原前段的（取原 Ba 最後一段）
                destAttrs = brsA.length ? brsA[brsA.length - 1] : null;
                if (destAttrs) batchArgs = { branchIndex: a, fromIndex: segsA, toIndex: segsA + movedCount - 1 };
            }
            if (destAttrs && batchArgs) {
                await apiCall('batchUpdateSmallSegments', {
                    pipelineId: currentPipeline.id,
                    branchIndex: batchArgs.branchIndex,
                    fromIndex: batchArgs.fromIndex,
                    toIndex: batchArgs.toIndex,
                    diameter: destAttrs.diameter || '',
                    pipeType: destAttrs.pipeType || '',
                    method: destAttrs.method || ''
                });
            }
        }

        showToast(`✅ 分界已移動：前段 ${newLenA}m、後段 ${newLenB}m`, 'success');
        currentPipeline.linestring = newWkt;
        currentPipeline._progressLoaded = false;
        if (typeof isEditingPath !== 'undefined' && isEditingPath) {
            // 編輯模式中：分界移動已改變幾何，必須重新載入編輯畫面才會一致
            await cancelEditMode(true);
        } else {
            showPipelineDetail(currentPipeline.id, true);
        }
        return true;
    } catch (e) {
        showToast('移動分界失敗：' + e.message, 'error');
        return false;
    }
}

// ===== 標籤防碰撞 =====
// 節點名稱框、管線段落標籤（工法/進度文字）都是畫在各自錨點上的文字；
// 兩條管線平行靠近、或節點密集時，文字會疊在一起完全讀不到。
// 這裡在繪製完成與縮放後掃一遍所有可見標籤：發現重疊就把後面的
// 往下推開，垂直排成一疊，每個都保持可讀。
// 位移做在標籤「內層」元素的 transform 上，不動 Leaflet 控制的外層定位，
// 平移地圖時相對位置不變、不用重算；縮放時間距改變才需要重跑。
let _lblCollideTimer = null;
function resolveLabelCollisions() {
    const els = Array.prototype.slice.call(document.querySelectorAll('._lbl-collide'))
        .filter(el => el.offsetParent !== null); // 只處理目前可見的
    // 先歸零之前的位移，取得原始位置
    els.forEach(el => { el.style.transform = ''; });
    if (els.length < 2) return;

    const PAD = 2; // 標籤間最小間距(px)
    const placed = [];
    // 由上而下、由左而右處理，重疊時往下推
    els.map(el => ({ el, rect: el.getBoundingClientRect() }))
        .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
        .forEach(item => {
            let dy = 0;
            // 反覆下推直到不與任何已定位的標籤重疊（設上限防呆）
            for (let guard = 0; guard < 25; guard++) {
                const t = item.rect.top + dy, b = item.rect.bottom + dy;
                const hit = placed.find(p =>
                    item.rect.left < p.right + PAD && item.rect.right > p.left - PAD &&
                    t < p.bottom + PAD && b > p.top - PAD
                );
                if (!hit) break;
                dy = hit.bottom + PAD - item.rect.top;
            }
            if (dy > 0) item.el.style.transform = 'translateY(' + dy + 'px)';
            placed.push({
                left: item.rect.left, right: item.rect.right,
                top: item.rect.top + dy, bottom: item.rect.bottom + dy
            });
        });
}
window.resolveLabelCollisions = resolveLabelCollisions;
function scheduleLabelCollisions() {
    clearTimeout(_lblCollideTimer);
    _lblCollideTimer = setTimeout(resolveLabelCollisions, 120); // 等 DOM 定位完成
    // 保險：部分標籤（如非同步載入的甘特日期、較慢放定位的節點框）可能在第一輪
    // 之後才出現，450ms 再掃一次，確保全部都被納入防碰撞。
    setTimeout(resolveLabelCollisions, 450);
}
window.scheduleLabelCollisions = scheduleLabelCollisions;

// ===== 制水閥 =====
const valveCrossLayers = {}; // key -> [line1, line2]

function drawValveCross(coords, trackingKey) {
    // 找中點
    if (!coords || coords.length < 2) return;
    const mid = coords[Math.floor(coords.length / 2)];
    const p0 = coords[0];
    const p1 = coords[coords.length - 1];
    // 計算管線方向向量
    const dlat = p1[0] - p0[0];
    const dlng = p1[1] - p0[1];
    const len = Math.sqrt(dlat*dlat + dlng*dlng) || 0.001;
    // 垂直方向（旋轉90度）
    const perpLat = -dlng / len;
    const perpLng = dlat / len;
    // 垂直線長度（約 40m 的地圖比例）
    const armLen = 0.00035;
    const pt1 = [mid[0] + perpLat * armLen, mid[1] + perpLng * armLen];
    const pt2 = [mid[0] - perpLat * armLen, mid[1] - perpLng * armLen];
    const vLine = L.polyline([pt1, pt2], {
        color: '#e53935', weight: 4, opacity: 1, lineCap: 'round'
    }).addTo(map);
    // 中點標記
    const dot = L.circleMarker(mid, {
        radius: 5, color: '#e53935', fillColor: '#e53935', fillOpacity: 1, weight: 2
    }).addTo(map);
    // 移除舊的
    if (valveCrossLayers[trackingKey]) {
        valveCrossLayers[trackingKey].forEach(l => { try { map.removeLayer(l); } catch(e) {} });
    }
    valveCrossLayers[trackingKey] = [vLine, dot];
}

function removeValveCross(trackingKey) {
    if (valveCrossLayers[trackingKey]) {
        valveCrossLayers[trackingKey].forEach(l => { try { map.removeLayer(l); } catch(e) {} });
        delete valveCrossLayers[trackingKey];
    }
}

window.toggleValve = async function(branchIndex, smallIndex) {
    if (!requireLogin()) return;
    const branchKey = `B${branchIndex}`;
    const seg = (currentPipeline.branches[branchKey] || []).find(s => s.smallIndex === smallIndex);
    if (!seg) return;
    const newVal = seg.isValve ? 0 : 1;
    try {
        await apiCall('updateSmallSegmentInfo', {
            pipelineId: currentPipeline.id,
            segmentNumber: branchKey,
            smallIndex,
            diameter: seg.diameter || '',
            pipeType: seg.pipeType || '',
            method: seg.method || '',
            status: seg.status || '0',
            isValve: newVal,
        });
        seg.isValve = newVal;
        const trackingKey = `${branchKey}-${smallIndex}`;
        if (newVal) {
            const tracked = smallSegmentPolylines[trackingKey];
            if (tracked) drawValveCross(tracked.polyline.getLatLngs().map(ll => [ll.lat, ll.lng]), trackingKey);
            showToast('✅ 已標記制水閥', 'success');
        } else {
            removeValveCross(trackingKey);
            showToast('已移除制水閥', 'info');
        }
        map.closePopup();
    } catch(e) { showToast('操作失敗：' + e.message, 'error'); }
};

window.saveNodeName = async function(branchIndex, smallIndex) {
    const branchKey = `B${branchIndex}`;
    const seg = (currentPipeline.branches[branchKey] || []).find(s => s.smallIndex === smallIndex);
    if (!seg) return;
    
    const nodeName = document.getElementById('nodeNameInput')?.value.trim() || '';
    
    try {
        await apiCall('updateSmallSegmentInfo', {
            pipelineId: currentPipeline.id,
            segmentNumber: branchKey,
            smallIndex: smallIndex,
            nodeName: nodeName,
        });
        seg.nodeName = nodeName;
        map.closePopup();
        showToast('節點名稱已儲存', 'success');
        // 重新繪製以更新節點標記
        currentPipeline._progressLoaded = false;
        showPipelineDetail(currentPipeline.id, true);
    } catch(e) {
        showToast('儲存失敗：' + e.message, 'error');
    }
};

// 標記完工/未完工
window.toggleNewSmallSegment = async function(branchIndex, smallIndex) {
    if (!requireLogin()) return;
    map.closePopup();
    const branchKey = `B${branchIndex}`;
    const seg = (currentPipeline.branches[branchKey] || []).find(s => s.smallIndex === smallIndex);
    if (!seg) return;
    
    const isCompleted = seg.status !== '0' && seg.status.trim() !== '';
    const newStatus = isCompleted ? '0' : new Date().toISOString().slice(0, 10);
    
    try {
        await apiCall('updateSmallSegmentInfo', {
            pipelineId: currentPipeline.id,
            segmentNumber: branchKey,
            smallIndex: smallIndex,
            diameter: seg.diameter || '',
            pipeType: seg.pipeType || '',
            method: seg.method || '',
            status: newStatus,
        });
        seg.status = newStatus;
        // 更新顏色
        const trackKey = `${branchKey}-${smallIndex}`;
        const tracked = smallSegmentPolylines[trackKey];
        if (tracked) {
            tracked.polyline.setStyle({
                weight: 5,
                opacity: newStatus !== '0' ? 1 : 0.35,
            });
        }
        showToast(newStatus !== '0' ? '✅ 已標記完工' : '已標記未完工', 'success');
        showStatsPanel();
        currentPipeline._progressLoaded = false;
        showPipelineDetail(currentPipeline.id, true);
    } catch(e) {
        showToast('更新失敗：' + e.message, 'error');
    }
};

// 開始範圍選取
window.startRangeSelect = function(branchIndex, smallIndex) {
    window._rangeSelectStart = { branchIndex, smallIndex };
    
    // 顯示提示
    const hint = document.createElement('div');
    hint.id = '_rangeSelectHint';
    hint.style.cssText = `
        position: fixed; top: 70px; left: 50%; transform: translateX(-50%);
        background: #2196F3; color: white; padding: 10px 20px;
        border-radius: 8px; z-index: 9999; font-size: 14px; font-weight: 600;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;
    hint.innerHTML = `📏 範圍選取模式：已選起點 #${smallIndex + 1}，請點選終點小段<br>
        <span style="font-size:12px;opacity:0.8;">點選同分支上的任一小段作為終點</span>
        <button onclick="window._rangeSelectStart=null;this.parentElement.remove();" 
            style="margin-left:10px;padding:2px 8px;background:rgba(255,255,255,0.3);border:none;border-radius:4px;color:white;cursor:pointer;">
            取消
        </button>`;
    document.getElementById('_rangeSelectHint')?.remove();
    document.body.appendChild(hint);
};

// 範圍設定對話框
window.showRangeSetDialog = function(branchIndex, fromIndex, toIndex) {
    if (!requireLogin()) return;
    const minIdx = Math.min(fromIndex, toIndex);
    const maxIdx = Math.max(fromIndex, toIndex);
    const count = maxIdx - minIdx + 1;
    
    const branchKey = `B${branchIndex}`;
    const segs = currentPipeline.branches[branchKey] || [];
    const firstSeg = segs.find(s => s.smallIndex === minIdx);
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:white;padding:24px;border-radius:12px;width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
            <div style="font-size:16px;font-weight:600;margin-bottom:8px;color:#333;">📏 設定範圍屬性</div>
            <div style="font-size:13px;color:#666;margin-bottom:16px;">
                分支 ${branchIndex}，第 ${minIdx + 1} 段 → 第 ${maxIdx + 1} 段（共 ${count} 段）
            </div>
            
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">管徑</label>
                <input type="text" id="rangeDialogDiameter" value="${firstSeg?.diameter || ''}" placeholder="例如：2200"
                    style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;">
            </div>
            
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">管種</label>
                <select id="rangeDialogPipeType" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:white;">
                    <option value="">（不變更）</option>
                    <option value="DIP" ${firstSeg?.pipeType==='DIP'?'selected':''}>DIP</option>
                    <option value="PVC" ${firstSeg?.pipeType==='PVC'?'selected':''}>PVC</option>
                    <option value="HDPE" ${firstSeg?.pipeType==='HDPE'?'selected':''}>HDPE</option>
                    <option value="鋼管" ${firstSeg?.pipeType==='鋼管'?'selected':''}>鋼管</option>
                    <option value="SP" ${firstSeg?.pipeType==='SP'?'selected':''}>SP</option>
                </select>
            </div>
            
            <div style="margin-bottom:20px;">
                <label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">施工方式</label>
                <select id="rangeDialogMethod" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:white;">
                    <option value="">（不變更）</option>
                    <option value="埋設" ${firstSeg?.method==='埋設'?'selected':''}>埋設</option>
                    <option value="推進" ${firstSeg?.method==='推進'?'selected':''}>推進</option>
                    <option value="水管橋" ${firstSeg?.method==='水管橋'?'selected':''}>水管橋</option>
                    <option value="潛鑽" ${firstSeg?.method==='潛鑽'?'selected':''}>潛鑽</option>
                    <option value="潛盾" ${firstSeg?.method==='潛盾'?'selected':''}>潛盾</option>
                    <option value="隧道" ${firstSeg?.method==='隧道'?'selected':''}>隧道</option>
                    <option value="其他" ${firstSeg?.method==='其他'?'selected':''}>其他</option>
                </select>
            </div>
            
            <div style="display:flex;gap:10px;">
                <button id="rangeDialogSave" style="flex:1;padding:10px;background:#4CAF50;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">
                    💾 套用到 ${count} 段
                </button>
                <button onclick="this.closest('div').parentElement.remove()" 
                    style="padding:10px 16px;background:#f5f5f5;border:none;border-radius:6px;cursor:pointer;">
                    取消
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    
    document.getElementById('rangeDialogSave').onclick = async function() {
        const diameter = document.getElementById('rangeDialogDiameter').value.trim();
        const pipeType = document.getElementById('rangeDialogPipeType').value;
        const method = document.getElementById('rangeDialogMethod').value;
        
        if (!diameter && !pipeType && !method) {
            showToast('請至少填寫一個欄位', 'warning');
            return;
        }
        
        this.textContent = '儲存中...';
        this.disabled = true;
        
        try {
            await apiCall('batchUpdateSmallSegments', {}, {
                body: {
                    action: 'batchUpdateSmallSegments',
                    pipelineId: currentPipeline.id,
                    branchIndex: branchIndex,
                    fromIndex: minIdx,
                    toIndex: maxIdx,
                    diameter: diameter,
                    pipeType: pipeType,
                    method: method,
                }
            });
            
            // 更新本地資料
            const segs = currentPipeline.branches[branchKey] || [];
            segs.forEach(s => {
                if (s.smallIndex >= minIdx && s.smallIndex <= maxIdx) {
                    if (diameter) s.diameter = diameter;
                    if (pipeType) s.pipeType = pipeType;
                    if (method) s.method = method;
                }
            });
            
            overlay.remove();
            showToast(`✅ 已更新 ${count} 個小段`, 'success');
            
            // 重新繪製
            currentPipeline._progressLoaded = false;
            showPipelineDetail(currentPipeline.id, true);
        } catch(e) {
            showToast('更新失敗：' + e.message, 'error');
            this.textContent = `💾 套用到 ${count} 段`;
            this.disabled = false;
        }
    };
};

// 編輯單一小段屬性
window.editNewSmallSegmentInfo = function(branchIndex, smallIndex, currentDiameter, currentPipeType, currentMethod) {
    map.closePopup();
    
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = `
        <div style="background:white;padding:24px;border-radius:12px;width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
            <div style="font-size:16px;font-weight:600;margin-bottom:16px;color:#333;">✏️ 編輯小段 #${smallIndex + 1}</div>
            
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">管徑</label>
                <input type="text" id="editNewDiameter" value="${currentDiameter}" placeholder="例如：2200"
                    style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;">
            </div>
            
            <div style="margin-bottom:12px;">
                <label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">管種</label>
                <select id="editNewPipeType" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:white;">
                    <option value="DIP" ${currentPipeType==='DIP'?'selected':''}>DIP</option>
                    <option value="PVC" ${currentPipeType==='PVC'?'selected':''}>PVC</option>
                    <option value="HDPE" ${currentPipeType==='HDPE'?'selected':''}>HDPE</option>
                    <option value="鋼管" ${currentPipeType==='鋼管'?'selected':''}>鋼管</option>
                    <option value="SP" ${currentPipeType==='SP'?'selected':''}>SP</option>
                </select>
            </div>
            
            <div style="margin-bottom:20px;">
                <label style="display:block;font-size:13px;color:#555;margin-bottom:4px;">施工方式</label>
                <select id="editNewMethod" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:white;">
                    <option value="埋設" ${currentMethod==='埋設'?'selected':''}>埋設</option>
                    <option value="推進" ${currentMethod==='推進'?'selected':''}>推進</option>
                    <option value="水管橋" ${currentMethod==='水管橋'?'selected':''}>水管橋</option>
                    <option value="潛鑽" ${currentMethod==='潛鑽'?'selected':''}>潛鑽</option>
                    <option value="潛盾" ${currentMethod==='潛盾'?'selected':''}>潛盾</option>
                    <option value="隧道" ${currentMethod==='隧道'?'selected':''}>隧道</option>
                    <option value="其他" ${currentMethod==='其他'?'selected':''}>其他</option>
                </select>
            </div>
            
            <div style="display:flex;gap:10px;">
                <button id="editNewSave" style="flex:1;padding:10px;background:#4CAF50;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;">
                    💾 儲存
                </button>
                <button onclick="this.closest('div').parentElement.remove()"
                    style="padding:10px 16px;background:#f5f5f5;border:none;border-radius:6px;cursor:pointer;">
                    取消
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
    
    document.getElementById('editNewSave').onclick = async function() {
        const diameter = document.getElementById('editNewDiameter').value.trim();
        const pipeType = document.getElementById('editNewPipeType').value;
        const method = document.getElementById('editNewMethod').value;
        
        try {
            const branchKey = `B${branchIndex}`;
            await apiCall('updateSmallSegmentInfo', {
                pipelineId: currentPipeline.id,
                segmentNumber: branchKey,
                smallIndex: smallIndex,
                diameter: diameter,
                pipeType: pipeType,
                method: method,
            });
            
            const seg = (currentPipeline.branches[branchKey] || []).find(s => s.smallIndex === smallIndex);
            if (seg) {
                seg.diameter = diameter;
                seg.pipeType = pipeType;
                seg.method = method;
            }
            
            overlay.remove();
            showToast('小段資料已更新', 'success');
            showStatsPanel();
            
            // 更新顏色
            const methodKey = [diameter, pipeType, method].filter(Boolean).join('-');
            const color = (diameter || pipeType || method) ? getColorForMethodKey(methodKey) : '#aaaaaa';
            const tracked = smallSegmentPolylines[`${branchKey}-${smallIndex}`];
            if (tracked) {
                tracked.polyline.setStyle({ color });
                tracked.color = color;
            }
        } catch(e) {
            showToast('更新失敗：' + e.message, 'error');
        }
    };
};

// 右鍵選單
window.showNewSmallSegmentContextMenu = function(e, branchIndex, smallIndex, seg) {
    e.originalEvent.preventDefault();
    const old = document.querySelector('.node-context-menu');
    if (old) old.remove();
    
    const menu = document.createElement('div');
    menu.className = 'node-context-menu';
    menu.style.cssText = `position:fixed;left:${e.originalEvent.clientX}px;top:${e.originalEvent.clientY}px;
        background:white;border:2px solid #333;border-radius:6px;
        box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:10000;min-width:180px;`;
    
    const isCompleted = seg.status !== '0' && seg.status.trim() !== '';
    menu.innerHTML = `
        <div class="rcm-item" onclick="toggleNewSmallSegment(${branchIndex}, ${smallIndex})">
            ${isCompleted ? '❌ 標記未完工' : '✓ 標記完工'}
        </div>
        <div class="rcm-item" onclick="startRangeSelect(${branchIndex}, ${smallIndex})">
            📏 設定範圍屬性（此段為起點）
        </div>

    `;
    
    document.body.appendChild(menu);
    setTimeout(() => {
        document.addEventListener('click', function closeMenu() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        }, 0);
    }, 100);
};

// ========== 舊架構 Fallback ==========
function drawLegacySegments(isMULTI, branchData, totalLength) {
    console.log('📦 使用舊架構繪製，段落數:', currentPipeline.segments.length);
    
    if (isMULTI && branchData) {
        branchData.branches.forEach((branch, branchIndex) => {
            const branchSegments = currentPipeline.segments.filter(seg => {
                if (seg.branchIndex !== undefined) return seg.branchIndex === branchIndex;
                return branchIndex === 0;
            });
            
            if (branchSegments.length > 0) {
                branchSegments.forEach(segment => {
                    const segLength = segment.endDistance - segment.startDistance;
                    const numSmallSegments = Math.ceil(segLength / 10);
                    const statusArray = (segment.smallSegments || '').split(',').map(s => s.trim());
                    
                    for (let i = 0; i < numSmallSegments; i++) {
                        const smallStart = segment.startDistance + (i * 10);
                        const smallEnd = Math.min(segment.startDistance + ((i + 1) * 10), segment.endDistance);
                        const smallCoords = getSegmentCoordsFromBranch(branch.coords, smallStart, smallEnd);
                        if (!smallCoords || smallCoords.length < 2) continue;
                        
                        const statusValue = statusArray[i] || '0';
                        const isCompleted = statusValue !== '0' && statusValue.trim() !== '';
                        
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
                            color, weight: 5, opacity: isCompleted ? 1 : 0.35
                        }).addTo(map);
                        
                        polyline.on('click', function(e) {
                            const _arr = (segment.smallSegments || '').split(',').map(s => s.trim());
                            const _isCompleted = (_arr[i] || '0') !== '0';
                            handleSmallSegmentClick(e, segment, i, smallStart, smallEnd, _isCompleted, polyline, color);
                        });
                        polyline.on('contextmenu', function(e) { showSegmentContextMenu(e, segment, color); });
                        allPolylines.push(polyline);
                        smallSegmentPolylines[`${segment.segmentNumber}-${i}`] = { polyline, segment, smallIndex: i, color };
                    }
                });
            } else {
                const isMain = !branch.isBranch;
                const color = isMain ? '#e74c3c' : '#9C27B0';
                const polyline = L.polyline(branch.coords, { color, weight: isMain ? 8 : 6, opacity: 0.7 }).addTo(map);
                allPolylines.push(polyline);
            }
        });
    } else {
        const coords = parseLineString(currentPipeline.linestring);
        currentPipeline.segments.sort((a, b) => a.startDistance - b.startDistance).forEach(segment => {
            const segmentLength = segment.endDistance - segment.startDistance;
            const numSmallSegments = Math.ceil(segmentLength / 10);
            const statusArray = (segment.smallSegments || '').split(',').map(s => s.trim());
            
            for (let i = 0; i < numSmallSegments; i++) {
                const smallStart = segment.startDistance + (i * 10);
                const smallEnd = Math.min(segment.startDistance + ((i + 1) * 10), segment.endDistance);
                const smallCoords = getSegmentCoords(coords, smallStart + 0.5, smallEnd - 0.5);
                if (smallCoords.length < 2) continue;
                
                const statusValue = statusArray[i] || '0';
                const isCompleted = statusValue !== '0';
                const methodKey = [segment.diameter, segment.pipeType, segment.method].filter(Boolean).join('-');
                const color = getColorForMethodKey(methodKey);
                
                const polyline = L.polyline(smallCoords, {
                    color, weight: 5, opacity: isCompleted ? 1 : 0.35, lineCap: 'round'
                }).addTo(map);
                polyline.on('click', function(e) {
                    const _arr = (segment.smallSegments || '').split(',').map(s => s.trim());
                    const _isCompleted = (_arr[i] || '0') !== '0';
                    handleSmallSegmentClick(e, segment, i, smallStart, smallEnd, _isCompleted, polyline, color);
                });
                polyline.on('contextmenu', function(e) { showSegmentContextMenu(e, segment, color); });
                allPolylines.push(polyline);
            }
        });
    }
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
