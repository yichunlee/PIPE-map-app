async function loadData() {
    try {
        showLoading(true);
        
        console.log('開始載入計畫清單...');
        const projectsData = await apiCall('getProjects');
        
        if (projectsData.error) {
            throw new Error(projectsData.error);
        }
        
        allProjects = projectsData.projects;
        console.log('載入了', allProjects.length, '個計畫');
        
        // 載入所有工程
        console.log('開始載入工程清單...');
        const pipelinePromises = allProjects.map(project => 
            apiCall('getPipelines', { projectName: project.name })
        );
        
        const pipelinesResults = await Promise.all(pipelinePromises);
        allPipelines = [];
        pipelinesResults.forEach(data => {
            if (data.pipelines) {
                allPipelines = allPipelines.concat(data.pipelines);
            }
        });
        console.log('載入了', allPipelines.length, '個工程');
        
        // 🚀 懶載入：不在初始化時載入進度，點進工程才載入
        allPipelines.forEach(p => { p.segments = []; p._progressLoaded = false; });
        console.log('載入了', allPipelines.length, '個工程（進度將於點擊時載入）');
        
        showLoading(false);
        showProjectSelector();
        
    } catch (error) {
        showLoading(false);
        console.error('載入錯誤:', error);
        showToast('載入失敗：' + error.message, 'error', 8000);
    }
}

// 重新載入工程資料(用於編輯/刪除後)
async function loadPipelines() {
    console.log('🔄 重新載入工程資料...');
    
    // 重新載入計畫清單
    const projectsData = await apiCall('getProjects');
    allProjects = projectsData.projects;
    
    // 重新載入所有工程
    const pipelinePromises = allProjects.map(project => 
        apiCall('getPipelines', { projectName: project.name })
    );
    
    const pipelinesResults = await Promise.all(pipelinePromises);
    allPipelines = [];
    pipelinesResults.forEach(data => {
        if (data.pipelines) {
            allPipelines = allPipelines.concat(data.pipelines);
        }
    });
    
    // 🚀 懶載入：重置進度，點進去才重新抓
    allPipelines.forEach(p => { p.segments = []; p._progressLoaded = false; });
    console.log('✅ 工程清單已重新載入');
}

function showLoading(show) {
    document.getElementById('loadingScreen').style.display = show ? 'flex' : 'none';
}

// ══════════════════════════════════════════════
// 統一管理左側按鈕狀態
// context: 'none' | 'project' | 'pipeline'
// ══════════════════════════════════════════════
function setMapContext(context, projectPipelines) {
    const ids = {
        layer:     document.getElementById('layerSwitchButton'),
        roadwork:  document.getElementById('roadworkButton'),
        eye:       document.getElementById('permitZoneButton'),
        measure:   document.getElementById('measureButton'),
        date:      document.getElementById('dateLabelButton'),
        elevation: document.getElementById('elevationButton'),
        photo:     document.getElementById('photoLayerButton'),
    };
    const leftDrawerToggle = document.getElementById('leftDrawerToggle');
    const leftDrawer = document.getElementById('leftDrawer');

    if (context === 'none') {
        // 計畫選擇畫面：全部隱藏
        Object.values(ids).forEach(el => { if (el) el.style.display = 'none'; });
        if (leftDrawerToggle) leftDrawerToggle.style.display = 'none';
        if (leftDrawer) leftDrawer.style.display = 'none';
        var dxfBtn0 = document.getElementById('dxfToolItem');
        if (dxfBtn0) dxfBtn0.style.display = 'none';
        var scBtn0 = document.getElementById('projectSCurveBtn');
        if (scBtn0) scBtn0.style.display = 'none';
        var ganttDrawerBtn00 = document.getElementById('ganttDrawerBtn');
        if (ganttDrawerBtn00) ganttDrawerBtn00.style.display = 'none';
        // 未登入也隱藏工具抽屜
        const toolsToggle = document.getElementById('toolsDrawerToggle');
        if (toolsToggle) toolsToggle.style.display = currentUser ? '' : 'none';
        return;
    }

    if (context === 'project') {
        // 中地圖（計畫總覽）：🗺️ 🚧 👁️ 📐 全顯示，📅 隱藏
        if (leftDrawerToggle) leftDrawerToggle.style.display = 'flex';
        var accountingBtn1 = document.getElementById('accountingToolItem');
        if (accountingBtn1) accountingBtn1.style.display = 'none';
        var dxfBtn1 = document.getElementById('dxfToolItem');
        if (dxfBtn1) dxfBtn1.style.display = 'none';
        var svgBtn1 = document.getElementById('svgToolItem');
        if (svgBtn1) svgBtn1.style.display = 'none';
        var scBtn = document.getElementById('projectSCurveBtn');
        if (scBtn) scBtn.style.display = 'flex';
        var ganttDrawerBtn0 = document.getElementById('ganttDrawerBtn');
        if (ganttDrawerBtn0) ganttDrawerBtn0.style.display = 'none';
        if (ids.layer)     { ids.layer.style.display = 'flex'; }
        if (ids.roadwork)  { ids.roadwork.style.display = 'flex'; ids.roadwork.classList.remove('active'); }
        if (ids.measure)   { ids.measure.style.display = 'flex'; }
        if (ids.date)      { ids.date.style.display = 'none'; ids.date.classList.remove('active'); }
        if (ids.elevation) { ids.elevation.style.display = 'none'; }
        if (ids.photo)     { ids.photo.style.display = 'none'; }
        const _peb2 = document.getElementById('photoExportButton'); if (_peb2) _peb2.style.display = 'none';
        // 👁️ 改成「看路權」功能
        if (ids.eye) {
            ids.eye.style.display = 'flex';
            ids.eye.classList.remove('hidden', 'hidden-markers');
            ids.eye.textContent = '👁️';
            ids.eye.title = '顯示所有工程路權申請狀況';
            ids.eye.onclick = () => toggleProjectNotes(projectPipelines);
        }
        return;
    }

    if (context === 'pipeline') {
        // 子工程地圖：全部顯示
        if (leftDrawerToggle) leftDrawerToggle.style.display = 'flex';
        var accountingBtn = document.getElementById('accountingToolItem');
        if (accountingBtn) accountingBtn.style.display = 'flex';
        var dxfBtn2 = document.getElementById('dxfToolItem');
        if (dxfBtn2) dxfBtn2.style.display = 'flex';
        var svgBtn = document.getElementById('svgToolItem');
        if (svgBtn) svgBtn.style.display = 'flex';
        var scBtn2 = document.getElementById('projectSCurveBtn');
        if (scBtn2) scBtn2.style.display = 'flex';
        var ganttDrawerBtn = document.getElementById('ganttDrawerBtn');
        if (ganttDrawerBtn) ganttDrawerBtn.style.display = 'flex';
        if (ids.layer)     { ids.layer.style.display = 'flex'; }
        if (ids.roadwork)  { ids.roadwork.style.display = 'flex'; }
        if (ids.measure)   { ids.measure.style.display = 'none'; }  // 已移到右鍵選單
        if (ids.date)      { ids.date.style.display = 'flex'; }
        if (ids.elevation) { ids.elevation.style.display = 'flex'; }
        if (ids.photo)     { ids.photo.style.display = 'flex'; }
        const _peb = document.getElementById('photoExportButton'); if (_peb) _peb.style.display = 'flex';
        // 👁️ 改成「看標記」功能
        if (ids.eye) {
            ids.eye.style.display = 'flex';
            ids.eye.classList.remove('hidden', 'hidden-markers');
            ids.eye.textContent = '👁️';
            ids.eye.title = '隱藏所有標記（備註/配電盤/挖掘範圍）';
            ids.eye.onclick = toggleAllMarkers;
        }
        return;
    }
}

        function showProjectSelector() {
    document.getElementById('projectSelector').classList.remove('hidden');
    if (map) clearMap(true);
    
    // 隱藏所有左側按鈕（計畫選擇畫面不需要）
    setMapContext('none');
    
    renderProjectGrid();
}

function renderProjectGrid() {
    const grid = document.getElementById('projectGrid');
    grid.innerHTML = '';
    
    allProjects.forEach(project => {
        const projectPipelines = allPipelines.filter(p => p.projectName === project.name);
        
        const card = document.createElement('div');
        card.className = 'project-card';
        card.style.cursor = 'pointer';
        card.onclick = () => showProjectPipelines(project.name);
        card.innerHTML = `
            <div class="project-card-title">${escapeHtml(project.name)}</div>
            <div class="project-card-info">🏗️ ${projectPipelines.length} 個工程</div>
        `;
        
        grid.appendChild(card);
    });
    
    // 新增「新增工程計畫」卡片
    const addCard = document.createElement('div');
    addCard.className = 'project-card';
    addCard.style.cursor = 'pointer';
    addCard.onclick = () => showAddPipelineFormWithAuth();
    addCard.innerHTML = `
        <div class="project-card-title">新增工程計畫</div>
    `;
    grid.appendChild(addCard);
}

function showProjectPipelines(projectName) {
    currentProject = allProjects.find(p => p.name === projectName);
    const projectPipelines = allPipelines.filter(p => p.projectName === projectName);
    
    document.getElementById('projectSelector').classList.add('hidden');
    
    initMap();
    
    // 徹底清除地圖上的所有圖層（除了底圖）
    map.eachLayer(function(layer) {
        // 只保留底圖 (TileLayer)
        if (!(layer instanceof L.TileLayer)) {
            map.removeLayer(layer);
        }
    });
    allPolylines = [];
    
    // WGIS polylines 已被清除，重置狀態（保留資料，只清 polyline 物件）
    if (window.wgisDatasets) {
        window.wgisDatasets.forEach(ds => {
            ds.polylines = [];
            ds.visible = false;
        });
        if (typeof renderWgisFileList === 'function') renderWgisFileList();
    }
    
    // 清除計畫備註標記
    projectPermitZones = [];
    projectPermitLabels = [];
    projectPermitVisible = false;
    
    // 設定中地圖（計畫總覽）按鈕狀態
    setMapContext('project', projectPipelines);
    
    // 顯示工程列表（會設定按鈕為顯示）
    showPipelineList(projectPipelines);
    
    // 大地圖也載入便利貼
    if (typeof loadStickyNotes === 'function') loadStickyNotes();
    
    // 顯示返回按鈕
    showBackButton();
    
    // 顯示所有工程在地圖上
    const bounds = [];
    // 根據工程總數平均分配色相，確保同計畫內不重複
    const total = projectPipelines.length;
    
    projectPipelines.forEach((pipeline, index) => {
        // HSL 均勻分配：色相 0~360 平均切割，飽和度和亮度固定
        const hue = Math.round((index / total) * 360);
        const color = 'hsl(' + hue + ', 80%, 45%)';
        
        // 🆕 檢查是否為 MULTILINESTRING
        const isMULTI = pipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
        
        if (isMULTI) {
            // MULTILINESTRING：分別繪製每個分支
            const branchData = parseLineStringWithBranches(pipeline.linestring);
            
            branchData.branches.forEach((branch, branchIdx) => {
                branch.coords.forEach(c => bounds.push(c));
                
                const polyline = L.polyline(branch.coords, {
                    color: color,
                    weight: 6,
                    opacity: 0.8
                }).addTo(map);
                
                polyline.on('click', () => showPipelineDetail(pipeline.id));
                allPolylines.push(polyline);
            });
            
            // 在第一個分支的中點顯示標籤
            if (branchData.branches.length > 0 && branchData.branches[0].coords.length > 0) {
                const mainBranch = branchData.branches[0].coords;
                const midIndex = Math.floor(mainBranch.length / 2);
                const midPoint = mainBranch[midIndex];
                
                const labelTooltip = L.tooltip({
                    permanent: true,
                    direction: 'top',
                    offset: [0, -10],
                    className: 'pipeline-permanent-label',
                    interactive: false
                })
                .setLatLng(midPoint)
                .setContent(`<span style="background: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: ${color}; border: 2px solid ${color}; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: inline-block;">${pipeline.name}</span>`)
                .addTo(map);
                
                allPolylines.push(labelTooltip);
            }
            
        } else {
            // 普通 LINESTRING：原本的邏輯
            const coords = parseLineString(pipeline.linestring);
            coords.forEach(c => bounds.push(c));
            
            const polyline = L.polyline(coords, {
                color: color,
                weight: 6,
                opacity: 0.8
            }).addTo(map);
            
            // 在管線中點顯示固定標籤（彩色框線）
            if (coords.length > 0) {
                const midIndex = Math.floor(coords.length / 2);
                const midPoint = coords[midIndex];
                
                const labelTooltip = L.tooltip({
                    permanent: true,
                    direction: 'top',
                    offset: [0, -10],
                    className: 'pipeline-permanent-label',
                    interactive: false
                })
                .setLatLng(midPoint)
                .setContent(`<span style="background: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: ${color}; border: 2px solid ${color}; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.3); display: inline-block;">${pipeline.name}</span>`)
                .addTo(map);
                
                allPolylines.push(labelTooltip);
            }
            
            polyline.on('click', () => showPipelineDetail(pipeline.id));
            allPolylines.push(polyline);
        }
    });
    
    if (bounds.length > 0) {
        map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50] });
    }
    
    // 顯示計畫統計面板（先顯示，背景再載入進度更新）
    showProjectStatsPanel(projectPipelines);
    
    // 背景靜默載入所有工程進度，載入完自動更新統計欄
    _loadProjectProgressBackground(projectPipelines);
}

function showPipelineList(pipelines) {
    console.log('=== showPipelineList 被呼叫 ===');
    console.log('工程數量:', pipelines.length);
    
    const existingList = document.querySelector('.pipeline-list');
    if (existingList) existingList.remove();
    
    const listDiv = document.createElement('div');
    listDiv.className = 'pipeline-list';
    listDiv.innerHTML = `
        <div style="padding:14px 14px 10px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#1a5fb4,#1e6fdc);border-radius:0;">
            <div style="color:white;font-weight:700;font-size:14px;margin-bottom:10px;letter-spacing:0.3px;">📋 工程列表</div>
            <div style="display:flex;gap:8px;">
                <div style="flex:1;background:rgba(255,255,255,0.18);color:white;padding:8px 10px;border-radius:8px;cursor:pointer;font-weight:600;text-align:center;font-size:12px;border:1px solid rgba(255,255,255,0.3);transition:all 0.15s;" onclick="toggleStatsReport()" onmouseover="this.style.background='rgba(255,255,255,0.28)'" onmouseout="this.style.background='rgba(255,255,255,0.18)'">
                    📊 每月施工統計
                </div>
            </div>
        </div>
        <div style="padding:8px 10px 4px;font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">工程選擇</div>
    `;
    
    pipelines.forEach(pipeline => {
        const item = document.createElement('div');
        item.className = 'pipeline-item';
        item.style.cursor = 'pointer';
        item.onclick = () => {
            showPipelineDetail(pipeline.id);
            // 選擇工程後自動關閉列表
            const list = document.querySelector('.pipeline-list');
            const toggle = document.getElementById('pipelineListToggle');
            if (list) list.classList.remove('open');
            if (toggle) toggle.textContent = '📋 工程列表';
        };
        
        // 📝 工程名稱
        const nameDiv = document.createElement('div');
        nameDiv.className = 'pipeline-item-name';
        nameDiv.textContent = pipeline.name;
        nameDiv.style.cssText = 'font-weight:600;font-size:13px;color:#1e293b;';
        
        const idDiv = document.createElement('div');
        idDiv.style.cssText = 'font-size:10px;color:#94a3b8;margin-top:2px;font-family:monospace;';
        idDiv.textContent = pipeline.id;

        item.appendChild(nameDiv);
        item.appendChild(idDiv);
        
        listDiv.appendChild(item);
    });
    
    document.body.appendChild(listDiv);
    
    // 顯示切換按鈕並重置文字和狀態
    const toggle = document.getElementById('pipelineListToggle');
    console.log('切換按鈕元素:', toggle);
    if (toggle) {
        toggle.style.display = 'block';
        toggle.textContent = '📋 工程列表'; // 重置文字
        console.log('✅ 切換按鈕已設定為顯示並重置文字');
    } else {
        console.error('❌ 找不到切換按鈕元素！');
    }
}

// 切換工程列表顯示/隱藏
function togglePipelineList() {
    const list = document.querySelector('.pipeline-list');
    const toggle = document.getElementById('pipelineListToggle');
    
    if (list) {
        const isOpen = list.classList.contains('open');
        if (isOpen) {
            list.classList.remove('open');
            toggle.textContent = '📋 工程列表';
        } else {
            list.classList.add('open');
            toggle.textContent = '✕ 關閉';
        }
    }
}


function showStatsPanel() {
    const existingPanel = document.querySelector('.stats-panel');
    if (existingPanel) existingPanel.remove();
    
    let totalLength = 0;
    let completedLength = 0;
    const methodStats = {};

    if (currentPipeline.branches && Object.keys(currentPipeline.branches).length > 0) {
        Object.values(currentPipeline.branches).forEach(segs => {
            segs.forEach(seg => {
                const sl = seg.endDistance - seg.startDistance;
                totalLength += sl;
                const isCompleted = seg.status !== '0' && seg.status.trim() !== '';
                if (isCompleted) completedLength += sl;
                const d = seg.diameter || '';
                const pt = seg.pipeType || '';
                const m = seg.method || '';
                if (!d && !pt && !m) return;
                const methodKey = [d, pt, m].filter(Boolean).join('-');
                const methodLabel = [d, pt, m].filter(Boolean).join(' ');
                if (!methodStats[methodKey]) {
                    methodStats[methodKey] = { total: 0, completed: 0, label: methodLabel };
                }
                methodStats[methodKey].total += sl;
                if (isCompleted) methodStats[methodKey].completed += sl;
            });
        });
    } else {
        (currentPipeline.segments || []).forEach(segment => {
            const segLength = segment.endDistance - segment.startDistance;
            const statusArray = (segment.smallSegments || '').split(',').map(s => s.trim());
            const numSmallSegments = Math.ceil(segLength / 10);
            for (let i = 0; i < numSmallSegments; i++) {
                const smallLength = Math.min(10, segLength - (i * 10));
                totalLength += smallLength;
                const statusValue = statusArray[i] || '0';
                const isCompleted = statusValue !== '0' && statusValue.trim() !== '';
                if (isCompleted) completedLength += smallLength;
                let diameter = segment.diameter || '';
                let pipeType = segment.pipeType || '';
                let method = segment.method || '未設定';
                if (segment.smallSegmentDetails && segment.smallSegmentDetails[i]) {
                    const d = segment.smallSegmentDetails[i];
                    diameter = d.diameter || diameter;
                    pipeType = d.pipe_type || pipeType;
                    method = d.method || method;
                }
                const methodKey = [diameter, pipeType, method].filter(Boolean).join('-');
                const methodLabel = [diameter, pipeType, method].filter(Boolean).join(' ');
                if (!methodStats[methodKey]) {
                    methodStats[methodKey] = { total: 0, completed: 0, label: methodLabel };
                }
                methodStats[methodKey].total += smallLength;
                if (isCompleted) methodStats[methodKey].completed += smallLength;
            }
        });
    }

    const overallPercent = totalLength > 0 ? Math.round((completedLength / totalLength) * 100) : 0;
    
    let statsHTML = `
        <div class="stats-panel-header" onclick="toggleStatsPanel(event)" style="background:linear-gradient(135deg,#1a5fb4,#1e6fdc);padding:10px 14px;border-radius:10px 10px 0 0;cursor:pointer;display:flex;align-items:center;justify-content:space-between;">
            <div style="color:white;font-weight:700;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${currentPipeline.name}</div>
            <span class="stats-toggle-btn" style="color:rgba(255,255,255,0.8);font-size:12px;margin-left:8px;">▼</span>
        </div>
        <div class="stats-content" style="padding:10px 12px 8px;">
            <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:6px;">
                總進度：${overallPercent}% <span style="font-weight:400;color:#64748b;font-size:12px;">(${Math.round(completedLength)}m / ${Math.round(totalLength)}m)</span>
            </div>
    `;
    
    currentPipelineMethods = Object.keys(methodStats)
        .filter(m => m !== '未設定')
        .map(m => methodStats[m].label);
    
    Object.keys(methodStats).forEach(methodKey => {
        const stats = methodStats[methodKey];
        const percent = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
        const color = getColorForMethodKey(methodKey);
        statsHTML += `
            <div style="font-size:11px;margin:5px 0;padding-left:10px;border-left:3px solid ${color};color:#475569;">
                ${stats.label}：${percent}% <span style="color:#94a3b8;">(${Math.round(stats.completed)}m / ${Math.round(stats.total)}m)</span>
            </div>
        `;
    });
    
    if (currentPipeline.notes) {
        statsHTML += `
            <div class="stats-info" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee; font-size: 11px; color: #666;">
                ${currentPipeline.notes}
            </div>
        `;
    }
    
    statsHTML += `</div>`;
    
    const panel = document.createElement('div');
    panel.className = 'stats-panel collapsed';
    panel.innerHTML = statsHTML;
    document.body.appendChild(panel);
}

// 統計面板收合功能
window.toggleStatsPanel = function(event) {
    event.stopPropagation();
    const panel = document.querySelector('.stats-panel');
    if (panel) {
        panel.classList.toggle('collapsed');
    }
};

