// ========== 計畫總覽路權範圍功能 ==========
let projectPermitVisible = false;
let projectPermitZones = [];
let projectPermitLabels = [];

async function toggleProjectNotes(pipelines) {
    projectPermitVisible = !projectPermitVisible;
    const btn = document.getElementById('permitZoneButton');
    
    if (projectPermitVisible) {
        // 顯示所有工程的路權範圍
        btn.textContent = '🙈';
        btn.title = '隱藏所有工程路權申請狀況';
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // 同時載入所有工程的路權範圍
        await Promise.all(pipelines.map(async pipeline => {
            try {
                const result = await apiCall('getPermitZones');
                const zones = result.zones || [];
                
                zones.forEach(zone => {
                    const points = zone.points.split(';').map(p => {
                        const parts = p.split(',');
                        return [parseFloat(parts[0]), parseFloat(parts[1])];
                    }).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
                    
                    if (points.length < 3) return;
                    
                    const isApproved = zone.status === 'approved';
                    let color = isApproved ? '#27ae60' : '#e74c3c';
                    let statusLabel = isApproved ? '🟢 路權已取得' : '🔴 路權申請中';
                    
                    // 檢查是否即將過期
                    if (isApproved && zone.permitDateEnd) {
                        const endDate = new Date(zone.permitDateEnd);
                        endDate.setHours(0, 0, 0, 0);
                        const daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
                        
                        if (daysRemaining <= 14 && daysRemaining >= 0) {
                            color = '#FFA500';
                            statusLabel = '🟡 路權即將過期';
                        } else if (daysRemaining < 0) {
                            color = '#808080';
                            statusLabel = '⚫ 路權已過期';
                        }
                    }
                    
                    const polygon = L.polygon(points, {
                        color: color,
                        weight: 2,
                        fillColor: color,
                        fillOpacity: 0.25,
                        interactive: true
                    }).addTo(map);
                    
                    // Popup 內容
                    const popupContent = `
                        <div style="min-width:220px;font-size:13px;">
                            <div style="font-weight:bold;color:${color};margin-bottom:8px;font-size:14px;">${statusLabel}</div>
                            <div style="margin:3px 0;color:#666;"><b>工程：</b>${pipeline.name}</div>
                            ${zone.permitNo ? '<div style="margin:3px 0"><b>許可證號：</b>' + zone.permitNo + '</div>' : ''}
                            ${zone.applyDate ? '<div style="margin:3px 0"><b>申請時間：</b>' + String(zone.applyDate).substring(0,10) + '</div>' : ''}
                            ${(zone.permitDateStart || zone.permitDateEnd) ? '<div style="margin:3px 0"><b>許可期間：</b>' + (zone.permitDateStart ? String(zone.permitDateStart).substring(0,10) : '') + ' ～ ' + (zone.permitDateEnd ? String(zone.permitDateEnd).substring(0,10) : '') + '</div>' : ''}
                            ${zone.notes ? '<div style="margin:3px 0;color:#666;"><b>備註：</b>' + zone.notes + '</div>' : ''}
                        </div>
                    `;
                    polygon.bindPopup(popupContent);
                    
                    // 中心標籤
                    const centerLat = points.reduce((s, p) => s + p[0], 0) / points.length;
                    const centerLng = points.reduce((s, p) => s + p[1], 0) / points.length;
                    const lines = [statusLabel];
                    if (zone.applyDate) lines.push('申請：' + zone.applyDate);
                    if (zone.permitDateStart || zone.permitDateEnd) lines.push('許可：' + (zone.permitDateStart || '') + '～' + (zone.permitDateEnd || ''));
                    
                    const labelHtml = '<div style="color:' + color + ';opacity:0.75;font-size:11px;font-weight:bold;text-align:center;white-space:nowrap;line-height:1.6;text-shadow:0 0 3px white,0 0 3px white,0 0 3px white;">' + lines.join('<br>') + '</div>';
                    const labelIcon = L.divIcon({ className: '', html: labelHtml, iconAnchor: [0, 0] });
                    const labelMarker = L.marker([centerLat, centerLng], { icon: labelIcon, interactive: false, zIndexOffset: -100 }).addTo(map);
                    
                    projectPermitZones.push(polygon);
                    projectPermitLabels.push(labelMarker);
                });
            } catch (error) {
                console.error('載入工程路權範圍失敗:', pipeline.name, error);
            }
        }));
    } else {
        // 隱藏所有路權範圍
        btn.textContent = '👁️';
        btn.title = '顯示所有工程路權申請狀況';
        projectPermitZones.forEach(z => map.removeLayer(z));
        projectPermitZones = [];
        projectPermitLabels.forEach(l => map.removeLayer(l));
        projectPermitLabels = [];
    }
}

// 背景靜默載入整個計畫所有工程的進度，完成後更新統計欄
async function _loadProjectProgressBackground(pipelines) {
    const needLoad = pipelines.filter(p => !p._progressLoaded);
    if (needLoad.length === 0) {
        // 只在計畫大地圖時才更新統計欄（避免覆蓋工程子視圖）
        if (!currentPipeline) showProjectStatsPanel(pipelines);
        return;
    }
    
    console.log(`🔄 背景載入 ${needLoad.length} 個工程進度...`);
    
    for (const pipeline of needLoad) {
        try {
            const data = await apiCall('getProgress');
            pipeline.segments = parseBranchIndexFromSegments(data.segments || []);
            pipeline._progressLoaded = true;
            const idx = allPipelines.findIndex(p => p.id === pipeline.id);
            if (idx !== -1) allPipelines[idx].segments = pipeline.segments;
        } catch (e) {
            console.warn('載入進度失敗:', pipeline.name, e);
        }
        // 只在計畫大地圖時才更新統計欄
        if (!currentPipeline) showProjectStatsPanel(pipelines);
    }
    
    console.log('✅ 所有工程進度載入完成');
}

// 顯示計畫統計面板（整個計畫的多個工程）
function showProjectStatsPanel(pipelines) {
    const existingPanel = document.querySelector('.stats-panel');
    if (existingPanel) existingPanel.remove();
    
    // 計算所有工程的總進度
    let totalLength = 0;
    let completedLength = 0;
    const methodStats = {}; // {工法: {total: 長度, completed: 完工長度}}
    
    pipelines.forEach(pipeline => {
        (pipeline.segments || []).forEach(segment => {
            const segLength = segment.endDistance - segment.startDistance;
            const smallSegmentsStatus = segment.smallSegments || '';
            const statusArray = smallSegmentsStatus.split(',').map(s => s.trim());
            const numSmallSegments = Math.ceil(segLength / 10);
            
            let segCompleted = 0;
            for (let i = 0; i < numSmallSegments; i++) {
                const smallLength = Math.min(10, segLength - (i * 10));
                totalLength += smallLength;
                
            // 🆕 兼容新舊格式 (1 或日期)
            const statusValue = statusArray[i] || '0';
            const isCompleted = statusValue !== '0' && statusValue.trim() !== '';
            if (isCompleted) {
                    completedLength += smallLength;
                    segCompleted += smallLength;
                }
            }
            
            // 統計各工法（含管徑、管種）
            const method = segment.method || '未設定';
            const diameter = segment.diameter || '';
            const pipeType = segment.pipeType || '';
            const methodKey = [diameter, pipeType, method].filter(Boolean).join('-');
            const methodLabel = [diameter, pipeType, method].filter(Boolean).join(' ');
            if (!methodStats[methodKey]) {
                methodStats[methodKey] = { total: 0, completed: 0, label: methodLabel };
            }
            methodStats[methodKey].total += segLength;
            methodStats[methodKey].completed += segCompleted;
        });
    });
    
    const overallPercent = totalLength > 0 ? Math.round((completedLength / totalLength) * 100) : 0;
    
    let statsHTML = `
        <div class="stats-panel-header" onclick="toggleStatsPanel(event)">
            <h3>📊 ${currentProject.name}</h3>
            <span class="stats-toggle-btn">▼</span>
        </div>
        <div class="stats-content" style="margin-top: 10px;">
            <div class="stats-info" style="font-size: 13px; font-weight: bold; color: #2c3e50; margin-bottom: 10px;">
                總進度：${overallPercent}% (${Math.round(completedLength)}m/${Math.round(totalLength)}m)
            </div>
    `;
    
    // 顯示各工法統計
    Object.keys(methodStats).forEach(methodKey => {
        const stats = methodStats[methodKey];
        const percent = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
        
        // 使用自動生成的易區分顏色
        const color = getColorForMethodKey(methodKey);
        
        statsHTML += `
            <div class="stats-info" style="font-size: 11px; margin: 5px 0; padding-left: 10px; border-left: 3px solid ${color};">
                ${stats.label}：${percent}% (${Math.round(stats.completed)}m/${Math.round(stats.total)}m)
            </div>
        `;
    });
    
    statsHTML += `</div>`; // 關閉 stats-content
    
    const panel = document.createElement('div');
    panel.className = 'stats-panel collapsed'; // 預設收起
    panel.innerHTML = statsHTML;
    document.body.appendChild(panel);
}

// 清空工程所有段落
window.clearAllSegments = async function() {
    if (!await showConfirm({ title: '清空所有段落', message: '確定要刪除這個工程的所有段落嗎？\n此操作無法復原！', okText: '確認清空', danger: true })) {
        return;
    }
    
    console.log('清空工程所有段落:', currentPipeline.id);
    
    try {
        const result = await apiCall('clearAllSegments', { pipelineId: currentPipeline.id });
        
        if (result.success) {
            showToast('已清空所有段落', 'success');
            
            // 重新載入工程
            const progressData = await apiCall('getProgress');
            currentPipeline.segments = parseBranchIndexFromSegments(progressData.segments || []);
            
            showPipelineDetail(currentPipeline.id);
        } else {
            showToast('清空失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('清空失敗：' + error.message, 'error');
        console.error('清空錯誤:', error);
    }
};

function showBackButton() {
    const existingBtn = document.querySelector('.back-button');
    if (existingBtn) existingBtn.remove();
    
    const btn = document.createElement('div');
    btn.className = 'back-button';
    btn.innerHTML = '← 返回';
    btn.onclick = () => {
        const existingPanel = document.querySelector('.stats-panel');
        if (existingPanel) existingPanel.remove();
        
        const existingList = document.querySelector('.pipeline-list');
        if (existingList) existingList.remove();
        
        btn.remove();
        
        // 隱藏工具相關按鈕
        document.getElementById('editPathBtn').style.display = 'none';
        document.getElementById('toolsDrawerToggle').style.display = 'none';
        document.getElementById('toolsDrawer').classList.remove('active');
        
        // 重置密碼驗證狀態
        isAuthenticated = false;
        
        // 如果正在編輯，先取消（靜默模式，不顯示確認對話框）
        if (isEditingPath) {
            cancelEditMode(true);
        }
        
        if (currentPipeline) {
            // 返回工程列表
            currentPipeline = null;
            showProjectPipelines(currentProject.name);
        } else {
            // 返回計畫選擇
            currentProject = null;
            showProjectSelector();
        }
    };
    document.body.appendChild(btn);
}

function initMap() {
    if (map) return;
    map = L.map('map', {
        maxZoom: 19,
        zoomControl: false,  // 完全不顯示縮放控制（所有裝置）
        preferCanvas: true   // 🚀 效能優化：使用 Canvas 渲染,大幅提升數百個小段的繪製效能
    }).setView([24.15, 120.65], 11);

    // 全域單一 zoomend：zoom>=15 時地圖容器加 map-zoom-in class，讓節點標籤顯示
    function updateNodeLabelVisibility() {
        var show = map.getZoom() >= 15;
        document.querySelectorAll('.node-label').forEach(function(el) {
            el.style.display = show ? 'block' : 'none';
        });
    }
    map.on('zoomend', updateNodeLabelVisibility);
    updateNodeLabelVisibility();

    
    // 定義多種底圖圖層
    const baseMaps = {
        "街道圖": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
            maxNativeZoom: 19
        }),
        "衛星圖": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles © Esri',
            maxZoom: 19,
            maxNativeZoom: 18
        }),
        "地形圖": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenTopoMap contributors',
            maxZoom: 17,
            maxNativeZoom: 17
        })
    };
    
    // 預設使用街道圖
    baseMaps["街道圖"].addTo(map);
    
    // 將底圖圖層存儲到全域變數供切換使用
    window.currentBaseMaps = baseMaps;
    window.currentBaseLayer = baseMaps["街道圖"];
    
    // 設定測量按鈕
    document.getElementById('measureButton').onclick = toggleMeasureMode;
    
    // 地圖點擊事件（用於測量）
    map.on('click', function(e) {
        if (measureMode) {
            addMeasurePoint(e.latlng);
        }
    });
    
    // 右鍵選單(只在詳細檢視模式)
    map.on('contextmenu', function(e) {
        // 如果在分支編輯模式,處理支線完成
        if (isBranchEditMode && branchEditCurrentDrawing) {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            finishCurrentBranch();
            return;
        }
        
        // 一般模式的右鍵選單
        e.originalEvent.preventDefault();
        if (currentPipeline && currentPipeline.id) {
            showRightClickMenu(e.latlng, e.originalEvent.clientX, e.originalEvent.clientY);
        }
    });
    
    // 雙擊完成支線(分支編輯模式)
    map.on('dblclick', function(e) {
        if (isBranchEditMode && branchEditCurrentDrawing) {
            L.DomEvent.stopPropagation(e);
            finishCurrentBranch();
        }
    });
    
    // 載入並顯示地圖備註
    loadMapNotes();
}

// 切換圖層面板（整合底圖 + WGIS）
function toggleLayerPanel(event) {
    if (event) event.stopPropagation();
    const panel = document.getElementById('layerPanel');
    const btn   = document.getElementById('layerSwitchButton');
    const isOpen = panel.classList.toggle('show');
    btn.classList.toggle('active', isOpen);
    if (isOpen) {
        // 每次打開時更新 WGIS 雲端清單 & 上傳按鈕顯示
        refreshWgisFileList();
        const isSup = currentUser && (currentUser.role === 'supervisor' || currentUser.role === 'admin');
        const uploadBtn = document.getElementById('wgisUploadBtn');
        if (uploadBtn) uploadBtn.style.display = isSup ? 'block' : 'none';
    }
}

// 切換底圖
function switchBaseLayer(layerType) {
    if (!window.currentBaseMaps || !map) return;
    
    // 移除當前底圖
    if (window.currentBaseLayer) {
        map.removeLayer(window.currentBaseLayer);
    }
    
    // 加入新底圖
    let newLayer;
    if (layerType === 'street') {
        newLayer = window.currentBaseMaps["街道圖"];
    } else if (layerType === 'satellite') {
        newLayer = window.currentBaseMaps["衛星圖"];
    } else if (layerType === 'topo') {
        newLayer = window.currentBaseMaps["地形圖"];
    }
    
    if (newLayer) {
        newLayer.addTo(map);
        window.currentBaseLayer = newLayer;
    }
    
    // 切換底圖後把 WGIS 管線重新加回（底圖切換不應清除 WGIS）
    if (window.wgisDatasets) {
        window.wgisDatasets.forEach(ds => {
            if (ds.visible && ds.polylines) {
                ds.polylines.forEach(pl => { try { pl.addTo(map); } catch(e){} });
            }
        });
    }
    
    // 更新選項樣式
    document.querySelectorAll('.layer-option').forEach(opt => {
        opt.classList.remove('active');
        const radio = opt.querySelector('.layer-radio');
        if (radio) radio.textContent = '○';
    });
    
    const activeOption = document.getElementById('layer-' + layerType);
    if (activeOption) {
        activeOption.classList.add('active');
        const radio = activeOption.querySelector('.layer-radio');
        if (radio) radio.textContent = '●';
    }
    
    // 關閉面板
    document.getElementById('layerPanel').classList.remove('show');
    document.getElementById('layerSwitchButton').classList.remove('active');
}

function toggleMeasureMode() {
    measureMode = !measureMode;
    const btn = document.getElementById('measureButton');
    
    if (measureMode) {
        btn.classList.add('active');
        btn.title = '點擊地圖測量距離，右鍵結束';
        map.getContainer().style.cursor = 'crosshair';
    } else {
        btn.classList.remove('active');
        btn.title = '測量距離';
        map.getContainer().style.cursor = '';
        clearMeasure();
    }
}

function addMeasurePoint(latlng) {
    measurePoints.push(latlng);
    
    // 加入標記
    const marker = L.circleMarker(latlng, {
        radius: 5,
        color: '#FF5722',
        fillColor: '#FF5722',
        fillOpacity: 1
    }).addTo(map);
    measureMarkers.push(marker);
    
    // 如果有兩個以上的點，畫線
    if (measurePoints.length > 1) {
        if (measureLine) {
            map.removeLayer(measureLine);
        }
        
        measureLine = L.polyline(measurePoints, {
            color: '#FF5722',
            weight: 3,
            opacity: 0.8,
            dashArray: '5, 10'
        }).addTo(map);
        
        // 計算總距離
        let totalDistance = 0;
        for (let i = 0; i < measurePoints.length - 1; i++) {
            totalDistance += map.distance(measurePoints[i], measurePoints[i + 1]);
        }
        
        // 顯示距離標籤
        if (measureLabel) {
            map.removeLayer(measureLabel);
        }
        
        const lastPoint = measurePoints[measurePoints.length - 1];
        const distanceText = totalDistance >= 1000 
            ? (totalDistance / 1000).toFixed(2) + ' km'
            : totalDistance.toFixed(1) + ' m';
        
        measureLabel = L.popup({
            closeButton: false,
            autoClose: false,
            closeOnClick: false
        })
        .setLatLng(lastPoint)
        .setContent('<div style="font-weight: bold; color: #FF5722;">📏 ' + distanceText + '</div>')
        .openOn(map);
    }
    
    // 右鍵結束測量
    map.once('contextmenu', function() {
        if (measureMode) {
            toggleMeasureMode();
        }
    });
}

function clearMeasure() {
    measurePoints = [];
    
    if (measureLine) {
        map.removeLayer(measureLine);
        measureLine = null;
    }
    
    measureMarkers.forEach(m => map.removeLayer(m));
    measureMarkers = [];
    
    if (measureLabel) {
        map.removeLayer(measureLabel);
        measureLabel = null;
    }
}

function clearMap(resetMarkerVisibility = false) {
    allPolylines.forEach(p => map.removeLayer(p));
    allPolylines = [];
    
    // 🚀 效能優化：清除小段追蹤系統
    smallSegmentPolylines = {};
    
    // 清除段落標籤
    segmentLabels.forEach(label => map.removeLayer(label.marker || label));
    segmentLabels = [];
    // 清除備註標記（只在個別工程地圖顯示）
    noteMarkers.forEach(marker => map.removeLayer(marker));
    noteMarkers = [];
    // 清除配電盤標記
    panelMarkers.forEach(marker => map.removeLayer(marker));
    panelMarkers = [];
    panelData = [];
    // 清除工作井標記
    shaftMarkers.forEach(m => map.removeLayer(m));
    shaftMarkers = [];
    shaftData = [];
    // 清除挖掘許可範圍（個別工程）
    permitZones.forEach(z => map.removeLayer(z));
    permitZones = [];
    permitLabels.forEach(l => map.removeLayer(l));
    permitLabels = [];
    permitZoneData = [];
    // 清除大地圖的路權標記（計畫總覽）
    projectPermitZones.forEach(z => map.removeLayer(z));
    projectPermitZones = [];
    projectPermitLabels.forEach(l => map.removeLayer(l));
    projectPermitLabels = [];
    // 清除工程列表
    const existingList = document.querySelector('.pipeline-list');
    if (existingList) existingList.remove();
    // 只有真正返回大地圖時才重置隱藏狀態
    if (resetMarkerVisibility) {
        allMarkersVisible = true;
        document.getElementById('permitZoneButton').classList.remove('hidden-markers');
        document.getElementById('ganttBtn').style.display = 'none';
        document.getElementById('ganttPanel').style.display = 'none';
        ganttPanelOpen = false;
        ganttData = [];
        // 隱藏工程列表切換按鈕
        document.getElementById('pipelineListToggle').style.display = 'none';
        // 清除日期標籤（按鈕顯示由 setMapContext 管理）
        document.getElementById('dateLabelButton').classList.remove('active');
        clearDateLabels();
        dateLabelsVisible = false;
        ganttItemsCache = [];
    }
}

function parseLineString(lineString) {
    // 支援三種格式：
    // 1. LINESTRING(...) - 單段
    // 2. LINESTRING(...)LINESTRING(...) - 多段線性
    // 3. MULTILINESTRING((...), (...)) - 分支管線
    
    const allCoords = [];
    
    // 檢查是否為 MULTILINESTRING
    if (lineString.trim().toUpperCase().startsWith('MULTILINESTRING')) {
        const content = lineString.match(/MULTILINESTRING\s*\((.*)\)\s*$/is);
        if (content) {
            // 找出所有括號對
            let depth = 0;
            let segStart = -1;
            const segments = [];
            
            for (let i = 0; i < content[1].length; i++) {
                if (content[1][i] === '(') {
                    if (depth === 0) segStart = i + 1;
                    depth++;
                } else if (content[1][i] === ')') {
                    depth--;
                    if (depth === 0 && segStart !== -1) {
                        segments.push(content[1].substring(segStart, i));
                        segStart = -1;
                    }
                }
            }
            
            // 解析每個線段
            segments.forEach(seg => {
                const coords = seg.trim();
                const segmentCoords = coords.split(',').map(pair => {
                    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
                    return [lat, lng];
                });
                allCoords.push(...segmentCoords);
            });
        }
    } else {
        // LINESTRING 格式
        const matches = lineString.matchAll(/LINESTRING\s*\(([^)]+)\)/gi);
        for (const match of matches) {
            const coords = match[1];
            const segmentCoords = coords.split(',').map(pair => {
                const [lng, lat] = pair.trim().split(/\s+/).map(Number);
                return [lat, lng];
            });
            allCoords.push(...segmentCoords);
        }
    }
    
    return allCoords;
}

// 解析並返回分支結構
function parseLineStringWithBranches(lineString) {
    const branches = [];
    let junctionPoints = new Map(); // 交叉點座標 -> 相關分支
    
    // 檢查是否為 MULTILINESTRING
    if (lineString.trim().toUpperCase().startsWith('MULTILINESTRING')) {
        const content = lineString.match(/MULTILINESTRING\s*\((.*)\)\s*$/is);
        if (content) {
            // 找出所有括號對
            let depth = 0;
            let segStart = -1;
            const segments = [];
            
            for (let i = 0; i < content[1].length; i++) {
                if (content[1][i] === '(') {
                    if (depth === 0) segStart = i + 1;
                    depth++;
                } else if (content[1][i] === ')') {
                    depth--;
                    if (depth === 0 && segStart !== -1) {
                        segments.push(content[1].substring(segStart, i));
                        segStart = -1;
                    }
                }
            }
            
            // 解析每個線段
            segments.forEach((seg, index) => {
                const coords = seg.trim();
                const segmentCoords = coords.split(',').map(pair => {
                    const [lng, lat] = pair.trim().split(/\s+/).map(Number);
                    return [lat, lng];
                });
                
                branches.push({
                    index: index,
                    coords: segmentCoords,
                    isBranch: index > 0
                });
                
                // 記錄端點以找出交叉點
                [segmentCoords[0], segmentCoords[segmentCoords.length - 1]].forEach(point => {
                    const key = `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
                    if (!junctionPoints.has(key)) {
                        junctionPoints.set(key, []);
                    }
                    junctionPoints.get(key).push(index);
                });
            });
        }
    } else {
        // 普通 LINESTRING 或多段 LINESTRING
        const result = parseLineStringWithBreaks(lineString);
        branches.push({
            index: 0,
            coords: result.coords,
            isBranch: false,
            breakPoints: result.breakPoints || []
        });
    }
    
    // 找出真正的交叉點（連接多條分支的點）
    const realJunctions = [];
    junctionPoints.forEach((branchIndices, key) => {
        if (branchIndices.length > 1) {
            const [lat, lng] = key.split(',').map(Number);
            realJunctions.push({
                coord: [lat, lng],
                branches: branchIndices
            });
        }
    });
    
    return { 
        branches, 
        junctionPoints: realJunctions,
        isMULTI: lineString.trim().toUpperCase().startsWith('MULTILINESTRING')
    };
}

// 新函數：解析 LINESTRING 並返回分段資訊
function parseLineStringWithBreaks(lineString) {
    const matches = lineString.matchAll(/LINESTRING\s*\(([^)]+)\)/gi);
    const allCoords = [];
    const breakPoints = [];
    
    let currentIndex = 0;
    let segmentIndex = 0;
    
    for (const match of matches) {
        const coords = match[1];
        const segmentCoords = coords.split(',').map(pair => {
            const [lng, lat] = pair.trim().split(/\s+/).map(Number);
            return [lat, lng];
        });
        
        allCoords.push(...segmentCoords);
        currentIndex += segmentCoords.length;
        segmentIndex++;
        
        // 記錄每段的結束位置（最後一段除外）
        const matchesArray = Array.from(lineString.matchAll(/LINESTRING\s*\(([^)]+)\)/gi));
        if (segmentIndex < matchesArray.length) {
            breakPoints.push(currentIndex - 1);
        }
    }
    
    return { coords: allCoords, breakPoints: breakPoints };
}

function getSegmentCoords(allCoords, startDist, endDist) {
    // 先計算所有座標點的累積距離
    const coordsWithDist = [{coord: allCoords[0], dist: 0}];
    let accumulatedDist = 0;
    
    for (let i = 0; i < allCoords.length - 1; i++) {
        const segDist = calculateDistance(
            allCoords[i][0], allCoords[i][1],
            allCoords[i+1][0], allCoords[i+1][1]
        );
        accumulatedDist += segDist;
        coordsWithDist.push({coord: allCoords[i+1], dist: accumulatedDist});
    }
    
    // 找出包含 startDist 和 endDist 的兩個座標點
    let startPoint = null;
    let endPoint = null;
    
    for (let i = 0; i < coordsWithDist.length - 1; i++) {
        const curr = coordsWithDist[i];
        const next = coordsWithDist[i + 1];
        
        // 檢查 startDist 是否在這兩點之間
        if (!startPoint && curr.dist <= startDist && next.dist >= startDist) {
            // 在兩點之間插值
            const ratio = (startDist - curr.dist) / (next.dist - curr.dist);
            const lat = curr.coord[0] + (next.coord[0] - curr.coord[0]) * ratio;
            const lng = curr.coord[1] + (next.coord[1] - curr.coord[1]) * ratio;
            startPoint = [lat, lng];
        }
        
        // 檢查 endDist 是否在這兩點之間
        if (!endPoint && curr.dist <= endDist && next.dist >= endDist) {
            // 在兩點之間插值
            const ratio = (endDist - curr.dist) / (next.dist - curr.dist);
            const lat = curr.coord[0] + (next.coord[0] - curr.coord[0]) * ratio;
            const lng = curr.coord[1] + (next.coord[1] - curr.coord[1]) * ratio;
            endPoint = [lat, lng];
        }
    }
    
    // 如果找不到，用最接近的點
    if (!startPoint) {
        const closest = coordsWithDist.reduce((prev, curr) => 
            Math.abs(curr.dist - startDist) < Math.abs(prev.dist - startDist) ? curr : prev
        );
        startPoint = closest.coord;
    }
    
    if (!endPoint) {
        const closest = coordsWithDist.reduce((prev, curr) => 
            Math.abs(curr.dist - endDist) < Math.abs(prev.dist - endDist) ? curr : prev
        );
        endPoint = closest.coord;
    }
    
    // 收集起點到終點之間的所有實際座標點
    const result = [startPoint];
    
    for (let i = 0; i < coordsWithDist.length; i++) {
        const {coord, dist} = coordsWithDist[i];
        if (dist > startDist && dist < endDist) {
            result.push(coord);
        }
    }
    
    result.push(endPoint);
    
    return result;
}

function calculateTotalLength(coords) {
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += calculateDistance(coords[i][0], coords[i][1], coords[i+1][0], coords[i+1][1]);
    }
    return total;
}

function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 儲存編輯後的段落
window.saveEditedSegment = async function(segmentNumber) {
    const diameter = document.getElementById('editSegDiameter').value.trim();
    const pipeType = document.getElementById('editSegPipeType').value.trim();
    const method = document.getElementById('editSegMethod').value;
    
    if (!method) {
        showToast('請選擇施工方式', 'warning');
        return;
    }
    
    console.log('儲存編輯:', segmentNumber);
    
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = '⏳ 儲存中...';
    btn.disabled = true;
    
    try {
        const result = await apiCall('updateSegmentInfo', { pipelineId: currentPipeline.id, diameter: diameter, pipeType: pipeType, method: method, segmentNumber: segmentNumber });
        
        console.log('API 回應:', result);
        
        if (result.success) {
            showToast('段落已更新！', 'success');
            map.closePopup();
            
            // 重新載入工程
            const progressData = await apiCall('getProgress');
            currentPipeline.segments = parseBranchIndexFromSegments(progressData.segments || []);
            
            showPipelineDetail(currentPipeline.id);
        } else {
            showToast('更新失敗：' + (result.error || '未知錯誤'), 'error');
            btn.textContent = originalText;
            btn.disabled = false;
        }
    } catch (error) {
        showToast('更新失敗：' + error.message, 'error');
        console.error('更新錯誤:', error);
        btn.textContent = originalText;
        btn.disabled = false;
    }
};

// 刪除這個段落
window.deleteThisSegment = async function(segmentNumber) {
    if (!await showConfirm({ title: '刪除段落', message: '確定要刪除這個段落嗎？', okText: '刪除', danger: true })) {
        return;
    }
    
    console.log('刪除段落:', segmentNumber);
    
    try {
        const result = await apiCall('deleteSegment', { pipelineId: currentPipeline.id, segmentNumber: segmentNumber });
        
        if (result.success) {
            showToast('段落已刪除', 'success');
            map.closePopup();
            
            // 重新載入工程
            const progressData = await apiCall('getProgress');
            currentPipeline.segments = parseBranchIndexFromSegments(progressData.segments || []);
            
            showPipelineDetail(currentPipeline.id);
        } else {
            showToast('刪除失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('刪除失敗：' + error.message, 'error');
        console.error('刪除錯誤:', error);
    }
};

// 定義新段落
window.defineNewSegment = function() {
    defineSegmentFrom(0);
};

// 從特定距離開始定義段落
window.defineSegmentFrom = function(startFrom, endTo) {
    const coords = parseLineString(currentPipeline.linestring);
    const totalLength = Math.round(calculateTotalLength(coords));
    
    // 如果沒有指定結束距離，預設為總長
    if (!endTo) endTo = totalLength;
    
    const html = `
        <div style="padding: 10px;">
            <h3 style="margin-bottom: 15px;">📏 定義段落</h3>
            <div style="margin-bottom: 10px;">
                <label>管線總長：${totalLength}m</label>
            </div>
            <div style="margin-bottom: 10px;">
                <label>起始距離 (m)：</label>
                <input type="number" id="segStart" value="${startFrom}" min="0" max="${totalLength}" style="width: 100%; padding: 5px; margin-top: 5px;">
            </div>
            <div style="margin-bottom: 10px;">
                <label>結束距離 (m)：</label>
                <input type="number" id="segEnd" value="${endTo}" min="0" max="${totalLength}" style="width: 100%; padding: 5px; margin-top: 5px;">
            </div>
            <div style="margin-bottom: 10px;">
                <label>管徑：</label>
                <input type="text" id="segDiameter" placeholder="例如：DN300" style="width: 100%; padding: 5px; margin-top: 5px;">
            </div>
            <div style="margin-bottom: 10px;">
                <label>施工方式：</label>
                <select id="segMethod" style="width: 100%; padding: 5px; margin-top: 5px;">
                    <option value="">請選擇</option>
                    <option value="開挖">開挖</option>
                    <option value="推進">推進</option>
                    <option value="水管橋">水管橋</option>
                    <option value="潛鑽">潛鑽</option>
                    <option value="潛遁">潛遁</option>
                    <option value="隧道">隧道</option>
                </select>
            </div>
            <button onclick="saveNewSegment()" style="width: 100%; padding: 10px; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-top: 10px;">
                💾 儲存段落
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

// 儲存新段落
window.saveNewSegment = async function() {
    const start = parseInt(document.getElementById('segStart').value);
    const end = parseInt(document.getElementById('segEnd').value);
    const diameter = document.getElementById('segDiameter').value.trim();
    const method = document.getElementById('segMethod').value;
    
    if (start >= end) {
        showToast('結束距離必須大於起始距離', 'warning');
        return;
    }
    
    if (!method) {
        showToast('請選擇施工方式', 'warning');
        return;
    }
    
    console.log('儲存新段落...');
    
    // 顯示載入中
    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = '⏳ 儲存中...';
    btn.disabled = true;
    
    try {
        // 使用 GET 請求（避免 CORS 問題）
        const segmentNumber = currentPipeline.segments.length + 1;
        const result = await apiCall('saveSegment', { pipelineId: currentPipeline.id, status: '未施工', diameter: diameter, method: method, segmentNumber: segmentNumber, endDistance: end });
        
        console.log('API 回應:', result);
        
        if (result.success) {
            showToast('段落儲存成功：' + start + 'm - ' + end + 'm（' + method + '）', 'success');
            map.closePopup();
            
            // 重新載入這個工程的進度
            console.log('重新載入工程進度...');
            const progressData = await apiCall('getProgress');
            
            currentPipeline.segments = parseBranchIndexFromSegments(progressData.segments || []);
            console.log('更新後段落數:', currentPipeline.segments.length);
            
            // 重新顯示工程
            showPipelineDetail(currentPipeline.id);
        } else {
            showToast('儲存失敗：' + (result.error || '未知錯誤'), 'error');
            btn.textContent = originalText;
            btn.disabled = false;
        }
    } catch (error) {
        showToast('儲存失敗：' + error.message, 'error');
        console.error('儲存錯誤:', error);
        btn.textContent = originalText;
        btn.disabled = false;
    }
};

