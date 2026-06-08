// ========== 高程剖面圖功能 ==========

async function showElevationProfile() {
    if (!currentPipeline) {
        showToast('請先選擇工程', 'warning');
        return;
    }
    
    // 建立面板
    const existingPanel = document.getElementById('elevationPanel');
    if (existingPanel) existingPanel.remove();
    
    const panel = document.createElement('div');
    panel.id = 'elevationPanel';
    panel.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 4000;
        display: flex; align-items: center; justify-content: center;
    `;
    panel.innerHTML = `
        <div style="background:white;border-radius:12px;width:90%;max-width:900px;max-height:85vh;
            box-shadow:0 8px 40px rgba(0,0,0,0.3);overflow:hidden;display:flex;flex-direction:column;">
            <div style="background:linear-gradient(135deg,#1565C0,#1976D2);color:white;padding:12px 16px;
                display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <span style="font-size:15px;font-weight:bold;">📈 高程剖面圖 — ${currentPipeline.name}</span>
                <button onclick="document.getElementById('elevationPanel').remove()"
                    style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:16px;
                    cursor:pointer;padding:2px 8px;border-radius:4px;">✕</button>
            </div>
            <div id="elevationContent" style="padding:20px;overflow:auto;flex:1;">
                <div style="text-align:center;padding:40px;color:#666;">
                    <div style="font-size:24px;margin-bottom:12px;">⏳</div>
                    <div>正在取得高程資料...</div>
                    <div id="elevationProgress" style="margin-top:8px;font-size:12px;color:#999;"></div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(panel);
    panel.onclick = e => { if (e.target === panel) panel.remove(); };
    
    try {
        await buildElevationProfile();
    } catch(e) {
        document.getElementById('elevationContent').innerHTML = `
            <div style="text-align:center;padding:40px;color:#e74c3c;">
                <div style="font-size:24px;margin-bottom:12px;">❌</div>
                <div>取得高程資料失敗</div>
                <div style="font-size:12px;color:#999;margin-top:8px;">${e.message}</div>
            </div>
        `;
    }
}

async function buildElevationProfile() {
    const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
    const branchData = isMULTI ? parseLineStringWithBranches(currentPipeline.linestring) : null;
    
    // 收集所有分支的採樣點
    const SAMPLE_INTERVAL = 50; // 每50m一個點
    const allSamples = []; // { dist, lat, lng, branchIndex, branchName }
    const nodeAnnotations = []; // { dist, name, branchIndex }
    
    if (isMULTI && branchData) {
        branchData.branches.forEach((branch, branchIndex) => {
            // 計算分支總長
            let branchLen = 0;
            for (let i = 0; i < branch.coords.length - 1; i++) {
                branchLen += getDistance(branch.coords[i], branch.coords[i+1]);
            }
            
            // 採樣
            let dist = 0;
            while (dist <= branchLen) {
                const coord = getPositionAtDistanceFromCoords(branch.coords, dist);
                if (coord) {
                    allSamples.push({ dist, lat: coord[0], lng: coord[1], branchIndex, branchLen });
                }
                dist += SAMPLE_INTERVAL;
            }
            // 確保最後一點
            const lastCoord = branch.coords[branch.coords.length - 1];
            if (lastCoord) {
                allSamples.push({ dist: branchLen, lat: lastCoord[0], lng: lastCoord[1], branchIndex, branchLen });
            }
            
            // 收集節點
            const branchKey = `B${branchIndex}`;
            const segs = (currentPipeline.branches || {})[branchKey] || [];
            segs.forEach(seg => {
                if (seg.nodeName && seg.nodeName.trim()) {
                    const nodeDist = seg.startDistance;
                    const coord = getPositionAtDistanceFromCoords(branch.coords, nodeDist);
                    if (coord) {
                        nodeAnnotations.push({
                            dist: nodeDist,
                            lat: coord[0],
                            lng: coord[1],
                            name: seg.nodeName,
                            branchIndex
                        });
                    }
                }
            });
        });
    } else {
        const coords = parseLineString(currentPipeline.linestring);
        let totalLen = calculateTotalLength(coords);
        let dist = 0;
        while (dist <= totalLen) {
            const coord = getPositionAtDistanceFromCoords(coords, dist);
            if (coord) {
                allSamples.push({ dist, lat: coord[0], lng: coord[1], branchIndex: 0, branchLen: totalLen });
            }
            dist += SAMPLE_INTERVAL;
        }
        
        // 節點
        const segs = (currentPipeline.branches || {})['B0'] || [];
        segs.forEach(seg => {
            if (seg.nodeName && seg.nodeName.trim()) {
                nodeAnnotations.push({ dist: seg.startDistance, name: seg.nodeName, branchIndex: 0 });
            }
        });
    }
    
    document.getElementById('elevationProgress').textContent = `共 ${allSamples.length} 個採樣點，查詢中...`;
    
    // 批次查詢高程（每次最多 50 點）
    const elevations = await fetchElevationsBatch(allSamples);
    
    // 渲染圖表
    renderElevationChart(allSamples, elevations, nodeAnnotations, branchData);
}

// 從座標陣列取得指定距離的位置
function getPositionAtDistanceFromCoords(coords, targetDist) {
    let accDist = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const segDist = getDistance(coords[i], coords[i+1]);
        if (accDist + segDist >= targetDist) {
            const ratio = (targetDist - accDist) / segDist;
            return [
                coords[i][0] + (coords[i+1][0] - coords[i][0]) * ratio,
                coords[i][1] + (coords[i+1][1] - coords[i][1]) * ratio
            ];
        }
        accDist += segDist;
    }
    return coords[coords.length - 1];
}

// 批次查詢高程
async function fetchElevationsBatch(samples) {
    const BATCH_SIZE = 50;
    const elevations = new Array(samples.length).fill(null);
    
    for (let i = 0; i < samples.length; i += BATCH_SIZE) {
        const batch = samples.slice(i, i + BATCH_SIZE);
        const locations = batch.map(s => ({ latitude: s.lat, longitude: s.lng }));
        
        document.getElementById('elevationProgress').textContent = 
            `查詢高程中... ${Math.min(i + BATCH_SIZE, samples.length)}/${samples.length}`;
        
        try {
            const resp = await fetch('https://api.open-elevation.com/api/v1/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locations })
            });
            const data = await resp.json();
            data.results.forEach((r, j) => {
                elevations[i + j] = r.elevation;
            });
        } catch(e) {
            console.warn('高程查詢失敗，批次:', i, e);
            // 填 null，繼續
        }
        
        // 避免 API 限速
        if (i + BATCH_SIZE < samples.length) {
            await new Promise(r => setTimeout(r, 300));
        }
    }
    
    return elevations;
}

// 渲染高程圖表
function renderElevationChart(samples, elevations, nodeAnnotations, branchData) {
    const validSamples = samples.map((s, i) => ({ ...s, elevation: elevations[i] }))
        .filter(s => s.elevation !== null);
    
    if (validSamples.length === 0) {
        document.getElementById('elevationContent').innerHTML = `
            <div style="text-align:center;padding:40px;color:#e74c3c;">無法取得高程資料</div>`;
        return;
    }
    
    const minElev = Math.min(...validSamples.map(s => s.elevation));
    const maxElev = Math.max(...validSamples.map(s => s.elevation));
    const elevRange = maxElev - minElev || 10;
    
    // 取得唯一分支
    const branches = [...new Set(validSamples.map(s => s.branchIndex))];
    const branchColors = branches.map((b, i) => {
        const colors = ['#1976D2','#E53935','#43A047','#FB8C00','#8E24AA','#00ACC1'];
        return colors[i % colors.length];
    });
    
    // Canvas 尺寸
    const W = 820, H = 380;
    const PAD = { top: 30, right: 30, bottom: 80, left: 60 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
    
    // 找最大距離
    const maxDist = Math.max(...validSamples.map(s => s.dist));
    
    const distToX = d => PAD.left + (d / maxDist) * chartW;
    const elevToY = e => PAD.top + chartH - ((e - minElev) / elevRange) * chartH;
    
    // 建立 SVG
    let svgPaths = '';
    let svgGrid = '';
    let svgAxes = '';
    let svgNodes = '';
    let svgLegend = '';
    
    // 格線
    const yTicks = 5;
    for (let i = 0; i <= yTicks; i++) {
        const e = minElev + (elevRange / yTicks) * i;
        const y = elevToY(e);
        svgGrid += `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="#f0f0f0" stroke-width="1"/>`;
        svgAxes += `<text x="${PAD.left - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#666">${Math.round(e)}m</text>`;
    }
    
    const xTicks = Math.min(10, Math.floor(maxDist / 100));
    for (let i = 0; i <= xTicks; i++) {
        const d = (maxDist / xTicks) * i;
        const x = distToX(d);
        svgGrid += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${H - PAD.bottom}" stroke="#f0f0f0" stroke-width="1"/>`;
        svgAxes += `<text x="${x}" y="${H - PAD.bottom + 16}" text-anchor="middle" font-size="10" fill="#666">${Math.round(d)}m</text>`;
    }
    
    // 繪製每條分支的折線
    branches.forEach((branchIndex, bi) => {
        const color = branchColors[bi];
        const pts = validSamples.filter(s => s.branchIndex === branchIndex);
        if (pts.length < 2) return;
        
        // 面積填充
        let areaPath = `M ${distToX(pts[0].dist)} ${H - PAD.bottom}`;
        areaPath += ` L ${distToX(pts[0].dist)} ${elevToY(pts[0].elevation)}`;
        pts.forEach(p => { areaPath += ` L ${distToX(p.dist)} ${elevToY(p.elevation)}`; });
        areaPath += ` L ${distToX(pts[pts.length-1].dist)} ${H - PAD.bottom} Z`;
        svgPaths += `<path d="${areaPath}" fill="${color}" fill-opacity="0.1"/>`;
        
        // 折線
        let linePath = `M ${distToX(pts[0].dist)} ${elevToY(pts[0].elevation)}`;
        pts.forEach(p => { linePath += ` L ${distToX(p.dist)} ${elevToY(p.elevation)}`; });
        svgPaths += `<path d="${linePath}" fill="none" stroke="${color}" stroke-width="2"/>`;
    });
    
    // 節點標記
    nodeAnnotations.forEach((node, ni) => {
        const bi = branches.indexOf(node.branchIndex);
        const color = bi >= 0 ? branchColors[bi] : '#333';
        const x = distToX(node.dist);
        
        // 垂直虛線
        svgNodes += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${H - PAD.bottom}" 
            stroke="${color}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7"/>`;
        
        // 節點標籤（交錯上下避免重疊）
        const labelY = H - PAD.bottom + (ni % 2 === 0 ? 32 : 50);
        svgNodes += `
            <rect x="${x - 2}" y="${H - PAD.bottom}" width="4" height="8" fill="${color}" rx="1"/>
            <text x="${x}" y="${labelY}" text-anchor="middle" font-size="10" font-weight="bold" fill="${color}">${node.name}</text>
        `;
    });
    
    // 圖例
    branches.forEach((b, i) => {
        const color = branchColors[i];
        const lx = PAD.left + i * 150;
        const ly = H - 15;
        svgLegend += `
            <line x1="${lx}" y1="${ly}" x2="${lx + 20}" y2="${ly}" stroke="${color}" stroke-width="2"/>
            <text x="${lx + 25}" y="${ly + 4}" font-size="11" fill="#333">分支 ${b}</text>
        `;
    });
    
    // 軸標題
    svgAxes += `<text x="${W/2}" y="${H - 2}" text-anchor="middle" font-size="11" fill="#555">水平距離 (m)</text>`;
    svgAxes += `<text x="12" y="${H/2}" text-anchor="middle" font-size="11" fill="#555" transform="rotate(-90, 12, ${H/2})">高程 (m)</text>`;
    
    // 邊框
    svgAxes += `<rect x="${PAD.left}" y="${PAD.top}" width="${chartW}" height="${chartH}" fill="none" stroke="#ddd" stroke-width="1"/>`;
    
    const svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${W}px;">
        ${svgGrid}${svgPaths}${svgNodes}${svgAxes}${svgLegend}
    </svg>`;
    
    // 統計資訊
    const stats = `
        <div style="display:flex;gap:20px;flex-wrap:wrap;margin-top:16px;padding:12px;background:#f8f9fa;border-radius:8px;font-size:13px;">
            <div>📏 管線總長：<b>${Math.round(maxDist)}m</b></div>
            <div>⛰️ 最高點：<b>${Math.round(maxElev)}m</b></div>
            <div>🏔️ 最低點：<b>${Math.round(minElev)}m</b></div>
            <div>📊 高差：<b>${Math.round(elevRange)}m</b></div>
            <div>📍 節點數：<b>${nodeAnnotations.length}</b></div>
        </div>
    `;
    
    document.getElementById('elevationContent').innerHTML = svg + stats;
}
