// ========== 高程剖面圖功能 ==========

// 接收剖面圖的游標位置，在地圖上顯示紅點
let elevationCursorMarker = null;
const elevationChannel = new BroadcastChannel('elevation_cursor');
elevationChannel.onmessage = function(e) {
    if (!map || !currentPipeline) return;
    const { lat, lng } = e.data;
    
    if (elevationCursorMarker) map.removeLayer(elevationCursorMarker);
    
    if (lat === null) {
        elevationCursorMarker = null;
        return;
    }
    
    elevationCursorMarker = L.circleMarker([lat, lng], {
        radius: 8,
        color: '#e74c3c',
        fillColor: '#e74c3c',
        fillOpacity: 0.9,
        weight: 2
    }).addTo(map);
};

async function showElevationProfile() {
    if (!currentPipeline) {
        showToast('請先選擇工程', 'warning');
        return;
    }
    
    // 收集資料
    const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
    const branchData = isMULTI ? parseLineStringWithBranches(currentPipeline.linestring) : null;
    const SAMPLE_INTERVAL = 50;
    const allSamples = [];
    const nodeAnnotations = [];
    
    if (isMULTI && branchData) {
        branchData.branches.forEach((branch, branchIndex) => {
            let branchLen = 0;
            for (let i = 0; i < branch.coords.length - 1; i++) {
                branchLen += getDistance(branch.coords[i], branch.coords[i+1]);
            }
            let dist = 0;
            while (dist <= branchLen) {
                const coord = getPositionAtDistanceFromCoords(branch.coords, dist);
                if (coord) allSamples.push({ dist, lat: coord[0], lng: coord[1], branchIndex, branchLen, branchCoords: branch.coords });
                dist += SAMPLE_INTERVAL;
            }
            const lastCoord = branch.coords[branch.coords.length - 1];
            if (lastCoord) allSamples.push({ dist: branchLen, lat: lastCoord[0], lng: lastCoord[1], branchIndex, branchLen, branchCoords: branch.coords });
            
            const branchKey = `B${branchIndex}`;
            const segs = (currentPipeline.branches || {})[branchKey] || [];
            segs.forEach(seg => {
                if (seg.nodeName && seg.nodeName.trim()) {
                    const coord = getPositionAtDistanceFromCoords(branch.coords, seg.startDistance);
                    if (coord) nodeAnnotations.push({ dist: seg.startDistance, lat: coord[0], lng: coord[1], name: seg.nodeName, branchIndex });
                }
            });
        });
    } else {
        const coords = parseLineString(currentPipeline.linestring);
        let totalLen = calculateTotalLength(coords);
        let dist = 0;
        while (dist <= totalLen) {
            const coord = getPositionAtDistanceFromCoords(coords, dist);
            if (coord) allSamples.push({ dist, lat: coord[0], lng: coord[1], branchIndex: 0, branchLen: totalLen, branchCoords: coords });
            dist += SAMPLE_INTERVAL;
        }
        const segs = (currentPipeline.branches || {})['B0'] || [];
        segs.forEach(seg => {
            if (seg.nodeName && seg.nodeName.trim()) {
                const coord = getPositionAtDistanceFromCoords(coords, seg.startDistance);
                if (coord) nodeAnnotations.push({ dist: seg.startDistance, lat: coord[0], lng: coord[1], name: seg.nodeName, branchIndex: 0 });
            }
        });
    }
    
    // 顯示載入中的新視窗
    const win = window.open('', 'elevationProfile', 'width=950,height=520,resizable=yes,scrollbars=yes');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <title>高程剖面圖 — ${currentPipeline.name}</title>
        <style>
            body { margin: 0; font-family: sans-serif; background: #f5f5f5; }
            #header { background: linear-gradient(135deg,#1565C0,#1976D2); color: white; padding: 12px 16px; font-size: 15px; font-weight: bold; }
            #content { padding: 16px; }
            #status { color: #666; text-align: center; padding: 40px; font-size: 14px; }
            #stats { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; padding: 10px 14px; background: white; border-radius: 8px; font-size: 13px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
            svg { cursor: crosshair; display: block; background: white; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
        </style>
    </head><body>
        <div id="header">📈 高程剖面圖 — ${currentPipeline.name}</div>
        <div id="content">
            <div id="status">⏳ 正在取得高程資料（共 ${allSamples.length} 個採樣點）...</div>
        </div>
    </body></html>`);
    win.document.close();
    
    // 查詢高程
    const elevations = await fetchElevationsBatch(allSamples, win);
    
    const validSamples = allSamples.map((s, i) => ({ ...s, elevation: elevations[i] })).filter(s => s.elevation !== null);
    
    if (validSamples.length === 0) {
        win.document.getElementById('status').textContent = '❌ 無法取得高程資料';
        return;
    }
    
    renderElevationChartInWindow(win, validSamples, nodeAnnotations);
}

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

async function fetchElevationsBatch(samples, win) {
    const BATCH_SIZE = 50;
    const elevations = new Array(samples.length).fill(null);
    
    for (let i = 0; i < samples.length; i += BATCH_SIZE) {
        const batch = samples.slice(i, i + BATCH_SIZE);
        const locations = batch.map(s => ({ latitude: s.lat, longitude: s.lng }));
        
        if (win && !win.closed) {
            const statusEl = win.document.getElementById('status');
            if (statusEl) statusEl.textContent = `⏳ 查詢高程中... ${Math.min(i + BATCH_SIZE, samples.length)}/${samples.length}`;
        }
        
        try {
            const resp = await fetch('https://api.open-elevation.com/api/v1/lookup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locations })
            });
            const data = await resp.json();
            data.results.forEach((r, j) => { elevations[i + j] = r.elevation; });
        } catch(e) {
            console.warn('高程查詢失敗，批次:', i, e);
        }
        
        if (i + BATCH_SIZE < samples.length) await new Promise(r => setTimeout(r, 300));
    }
    return elevations;
}

function renderElevationChartInWindow(win, samples, nodeAnnotations) {
    const minElev = Math.min(...samples.map(s => s.elevation));
    const maxElev = Math.max(...samples.map(s => s.elevation));
    const elevRange = maxElev - minElev || 10;
    const maxDist = Math.max(...samples.map(s => s.dist));
    
    const branches = [...new Set(samples.map(s => s.branchIndex))];
    const COLORS = ['#1976D2','#E53935','#43A047','#FB8C00','#8E24AA','#00ACC1'];
    const branchColors = {};
    branches.forEach((b, i) => { branchColors[b] = COLORS[i % COLORS.length]; });
    
    const W = 880, H = 360;
    const PAD = { top: 30, right: 30, bottom: 90, left: 65 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
    
    const distToX = d => PAD.left + (d / maxDist) * chartW;
    const elevToY = e => PAD.top + chartH - ((e - minElev) / elevRange) * chartH;
    
    let svgContent = '';
    
    // 格線
    for (let i = 0; i <= 5; i++) {
        const e = minElev + (elevRange / 5) * i;
        const y = elevToY(e);
        svgContent += `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="#eee" stroke-width="1"/>`;
        svgContent += `<text x="${PAD.left-8}" y="${y+4}" text-anchor="end" font-size="10" fill="#777">${Math.round(e)}</text>`;
    }
    for (let i = 0; i <= 8; i++) {
        const d = (maxDist / 8) * i;
        const x = distToX(d);
        svgContent += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${H-PAD.bottom}" stroke="#eee" stroke-width="1"/>`;
        svgContent += `<text x="${x}" y="${H-PAD.bottom+14}" text-anchor="middle" font-size="10" fill="#777">${Math.round(d)}</text>`;
    }
    
    // 各分支折線+面積
    branches.forEach(b => {
        const color = branchColors[b];
        const pts = samples.filter(s => s.branchIndex === b);
        if (pts.length < 2) return;
        
        let area = `M${distToX(pts[0].dist)},${H-PAD.bottom} L${distToX(pts[0].dist)},${elevToY(pts[0].elevation)}`;
        let line = `M${distToX(pts[0].dist)},${elevToY(pts[0].elevation)}`;
        pts.forEach(p => {
            area += ` L${distToX(p.dist)},${elevToY(p.elevation)}`;
            line += ` L${distToX(p.dist)},${elevToY(p.elevation)}`;
        });
        area += ` L${distToX(pts[pts.length-1].dist)},${H-PAD.bottom} Z`;
        svgContent += `<path d="${area}" fill="${color}" fill-opacity="0.12"/>`;
        svgContent += `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.5"/>`;
    });
    
    // 節點標記
    nodeAnnotations.forEach((node, ni) => {
        const color = branchColors[node.branchIndex] || '#333';
        const x = distToX(node.dist);
        svgContent += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${H-PAD.bottom}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.8"/>`;
        svgContent += `<rect x="${x-2}" y="${H-PAD.bottom}" width="4" height="8" fill="${color}" rx="1"/>`;
        const ly = H - PAD.bottom + (ni % 2 === 0 ? 30 : 48);
        svgContent += `<text x="${x}" y="${ly}" text-anchor="middle" font-size="10" font-weight="bold" fill="${color}">${node.name}</text>`;
    });
    
    // 圖例
    branches.forEach((b, i) => {
        const color = branchColors[b];
        const lx = PAD.left + i * 120;
        const ly = H - 8;
        svgContent += `<line x1="${lx}" y1="${ly}" x2="${lx+18}" y2="${ly}" stroke="${color}" stroke-width="2.5"/>`;
        svgContent += `<text x="${lx+22}" y="${ly+4}" font-size="11" fill="#333">分支 ${b}</text>`;
    });
    
    // 軸標題
    svgContent += `<text x="${W/2}" y="${H-2}" text-anchor="middle" font-size="11" fill="#555">水平距離 (m)</text>`;
    svgContent += `<text x="13" y="${PAD.top + chartH/2}" text-anchor="middle" font-size="11" fill="#555" transform="rotate(-90,13,${PAD.top+chartH/2})">高程 (m)</text>`;
    svgContent += `<rect x="${PAD.left}" y="${PAD.top}" width="${chartW}" height="${chartH}" fill="none" stroke="#ccc" stroke-width="1"/>`;
    
    // 游標線（互動用）
    svgContent += `<line id="cursorLine" x1="0" y1="${PAD.top}" x2="0" y2="${H-PAD.bottom}" stroke="#e74c3c" stroke-width="1.5" stroke-dasharray="4,3" opacity="0" pointer-events="none"/>`;
    svgContent += `<circle id="cursorDot" cx="0" cy="0" r="5" fill="#e74c3c" opacity="0" pointer-events="none"/>`;
    svgContent += `<rect id="cursorBg" x="0" y="0" width="80" height="20" fill="white" rx="3" opacity="0" pointer-events="none"/>`;
    svgContent += `<text id="cursorText" x="0" y="0" font-size="11" fill="#e74c3c" opacity="0" pointer-events="none"></text>`;
    svgContent += `<rect id="hitArea" x="${PAD.left}" y="${PAD.top}" width="${chartW}" height="${chartH}" fill="transparent"/>`;
    
    const statsHTML = `
        <div id="stats">
            <span>📏 總長：<b>${Math.round(maxDist)}m</b></span>
            <span>⛰️ 最高：<b>${Math.round(maxElev)}m</b></span>
            <span>🏔️ 最低：<b>${Math.round(minElev)}m</b></span>
            <span>📊 高差：<b>${Math.round(elevRange)}m</b></span>
            <span>📍 節點：<b>${nodeAnnotations.length}</b></span>
        </div>
    `;
    
    win.document.getElementById('content').innerHTML = `
        <svg id="elevSvg" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;">${svgContent}</svg>
        ${statsHTML}
    `;
    
    // 互動：滑鼠移動
    const channel = new win.BroadcastChannel('elevation_cursor');
    const svgEl = win.document.getElementById('elevSvg');
    const cursorLine = win.document.getElementById('cursorLine');
    const cursorDot = win.document.getElementById('cursorDot');
    const cursorBg = win.document.getElementById('cursorBg');
    const cursorText = win.document.getElementById('cursorText');
    const hitArea = win.document.getElementById('hitArea');
    
    // 把 samples 存到視窗供查找
    win._samples = samples;
    
    hitArea.addEventListener('mousemove', function(e) {
        const rect = svgEl.getBoundingClientRect();
        const scaleX = W / rect.width;
        const mouseX = (e.clientX - rect.left) * scaleX;
        
        // 換算回距離
        const dist = ((mouseX - PAD.left) / chartW) * maxDist;
        if (dist < 0 || dist > maxDist) return;
        
        // 找最近的樣本點
        let nearest = null;
        let minGap = Infinity;
        samples.forEach(s => {
            const gap = Math.abs(s.dist - dist);
            if (gap < minGap) { minGap = gap; nearest = s; }
        });
        if (!nearest) return;
        
        const x = distToX(nearest.dist);
        const y = elevToY(nearest.elevation);
        
        // 更新游標
        cursorLine.setAttribute('x1', x);
        cursorLine.setAttribute('x2', x);
        cursorLine.setAttribute('opacity', '0.8');
        cursorDot.setAttribute('cx', x);
        cursorDot.setAttribute('cy', y);
        cursorDot.setAttribute('opacity', '1');
        
        const label = `${Math.round(nearest.dist)}m, ${Math.round(nearest.elevation)}m`;
        const labelX = x + 8 > W - PAD.right - 90 ? x - 88 : x + 8;
        cursorBg.setAttribute('x', labelX);
        cursorBg.setAttribute('y', y - 14);
        cursorBg.setAttribute('opacity', '0.9');
        cursorText.setAttribute('x', labelX + 4);
        cursorText.setAttribute('y', y);
        cursorText.setAttribute('opacity', '1');
        cursorText.textContent = label;
        
        // 廣播到主視窗地圖
        channel.postMessage({ lat: nearest.lat, lng: nearest.lng });
    });
    
    hitArea.addEventListener('mouseleave', function() {
        cursorLine.setAttribute('opacity', '0');
        cursorDot.setAttribute('opacity', '0');
        cursorBg.setAttribute('opacity', '0');
        cursorText.setAttribute('opacity', '0');
        channel.postMessage({ lat: null, lng: null });
    });
}
