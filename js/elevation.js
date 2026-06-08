// ========== 高程剖面圖功能 ==========

let elevationCursorMarker = null;
const elevationChannel = new BroadcastChannel('elevation_cursor');
elevationChannel.onmessage = function(e) {
    if (!map || !currentPipeline) return;
    const { lat, lng } = e.data;
    if (elevationCursorMarker) map.removeLayer(elevationCursorMarker);
    if (lat === null) { elevationCursorMarker = null; return; }
    elevationCursorMarker = L.circleMarker([lat, lng], {
        radius: 8, color: '#e74c3c', fillColor: '#e74c3c', fillOpacity: 0.9, weight: 2
    }).addTo(map);
};

async function showElevationProfile() {
    if (!currentPipeline) { showToast('請先選擇工程', 'warning'); return; }
    
    const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
    const branchData = isMULTI ? parseLineStringWithBranches(currentPipeline.linestring) : null;
    const SAMPLE_INTERVAL = 10;
    const allSamples = [];
    const nodeAnnotations = [];
    
    if (isMULTI && branchData) {
        branchData.branches.forEach((branch, branchIndex) => {
            let branchLen = 0;
            for (let i = 0; i < branch.coords.length - 1; i++)
                branchLen += getDistance(branch.coords[i], branch.coords[i+1]);
            let dist = 0;
            while (dist <= branchLen) {
                const coord = getPositionAtDistanceFromCoords(branch.coords, dist);
                if (coord) allSamples.push({ dist, lat: coord[0], lng: coord[1], branchIndex, branchLen, branchCoords: branch.coords });
                dist += SAMPLE_INTERVAL;
            }
            const lastCoord = branch.coords[branch.coords.length - 1];
            if (lastCoord) allSamples.push({ dist: branchLen, lat: lastCoord[0], lng: lastCoord[1], branchIndex, branchLen, branchCoords: branch.coords });
            
            const segs = (currentPipeline.branches || {})[`B${branchIndex}`] || [];
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
    
    const win = window.open('', 'elevationProfile', 'width=980,height=580,resizable=yes,scrollbars=yes');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <title>高程剖面圖 — ${currentPipeline.name}</title>
        <style>
            body { margin:0; font-family:sans-serif; background:#f5f5f5; }
            #header { background:linear-gradient(135deg,#1565C0,#1976D2); color:white; padding:12px 16px; font-size:15px; font-weight:bold; }
            #content { padding:16px; }
            #status { color:#666; text-align:center; padding:40px; font-size:14px; }
            #stats { display:flex; gap:16px; flex-wrap:wrap; margin-top:12px; padding:10px 14px; background:white; border-radius:8px; font-size:13px; box-shadow:0 1px 4px rgba(0,0,0,0.1); }
            #hint { text-align:center; font-size:11px; color:#999; margin-top:6px; }
            svg { cursor:crosshair; display:block; background:white; border-radius:8px; box-shadow:0 1px 4px rgba(0,0,0,0.1); }
        </style>
    </head><body>
        <div id="header">📈 高程剖面圖 — ${currentPipeline.name}</div>
        <div id="content"><div id="status">⏳ 正在取得高程資料（共 ${allSamples.length} 個採樣點）...</div></div>
    </body></html>`);
    win.document.close();
    
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
            return [coords[i][0] + (coords[i+1][0] - coords[i][0]) * ratio,
                    coords[i][1] + (coords[i+1][1] - coords[i][1]) * ratio];
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
        if (win && !win.closed) {
            const statusEl = win.document.getElementById('status');
            if (statusEl) statusEl.textContent = `⏳ 查詢高程中... ${Math.min(i+BATCH_SIZE, samples.length)}/${samples.length}`;
        }
        try {
            const resp = await fetch('https://api.open-elevation.com/api/v1/lookup', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locations: batch.map(s => ({ latitude: s.lat, longitude: s.lng })) })
            });
            const data = await resp.json();
            data.results.forEach((r, j) => { elevations[i+j] = r.elevation; });
        } catch(e) { console.warn('高程查詢失敗:', i, e); }
        if (i + BATCH_SIZE < samples.length) await new Promise(r => setTimeout(r, 300));
    }
    return elevations;
}

function renderElevationChartInWindow(win, samples, nodeAnnotations) {
    const COLORS = ['#1976D2','#E53935','#43A047','#FB8C00','#8E24AA','#00ACC1'];
    const branches = [...new Set(samples.map(s => s.branchIndex))];
    const branchColors = {};
    branches.forEach((b, i) => { branchColors[b] = COLORS[i % COLORS.length]; });
    
    // 預設選中分支 0
    let activeBranch = branches[0];
    
    const W = 900, H = 380;
    const PAD = { top: 30, right: 30, bottom: 90, left: 65 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
    
    function getChartRange(branchIdx) {
        const pts = samples.filter(s => s.branchIndex === branchIdx);
        const minE = Math.min(...pts.map(s => s.elevation));
        const maxE = Math.max(...pts.map(s => s.elevation));
        const maxD = Math.max(...pts.map(s => s.dist));
        return { minE, maxE, elevRange: maxE - minE || 10, maxD };
    }
    
    function buildSVG(activeBranch) {
        const { minE, maxE, elevRange, maxD } = getChartRange(activeBranch);
        
        // 全局範圍（所有分支）
        const globalMinE = Math.min(...samples.map(s => s.elevation));
        const globalMaxE = Math.max(...samples.map(s => s.elevation));
        const globalRange = globalMaxE - globalMinE || 10;
        const globalMaxD = Math.max(...samples.map(s => s.dist));
        
        const distToX = d => PAD.left + (d / globalMaxD) * chartW;
        const elevToY = e => PAD.top + chartH - ((e - globalMinE) / globalRange) * chartH;
        
        let svg = '';
        
        // 格線
        for (let i = 0; i <= 5; i++) {
            const e = globalMinE + (globalRange / 5) * i;
            const y = elevToY(e);
            svg += `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="#eee" stroke-width="1"/>`;
            svg += `<text x="${PAD.left-8}" y="${y+4}" text-anchor="end" font-size="10" fill="#777">${Math.round(e)}</text>`;
        }
        for (let i = 0; i <= 8; i++) {
            const d = (globalMaxD / 8) * i;
            const x = distToX(d);
            svg += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${H-PAD.bottom}" stroke="#eee" stroke-width="1"/>`;
            svg += `<text x="${x}" y="${H-PAD.bottom+14}" text-anchor="middle" font-size="10" fill="#777">${Math.round(d)}</text>`;
        }
        
        // 先畫非active分支（淡化）
        branches.forEach(b => {
            if (b === activeBranch) return;
            const color = branchColors[b];
            const pts = samples.filter(s => s.branchIndex === b);
            if (pts.length < 2) return;
            let line = `M${distToX(pts[0].dist)},${elevToY(pts[0].elevation)}`;
            pts.forEach(p => { line += ` L${distToX(p.dist)},${elevToY(p.elevation)}`; });
svg += `<path class="branch-line" data-branch="${b}" d="${line}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.25"/>`;
svg += `<path class="branch-line" data-branch="${b}" d="${line}" fill="none" stroke="transparent" stroke-width="20" style="cursor:pointer"/>`;  
        });
        
        // 畫 active 分支（粗亮）
        const activePts = samples.filter(s => s.branchIndex === activeBranch);
        const activeColor = branchColors[activeBranch];
        if (activePts.length >= 2) {
            let area = `M${distToX(activePts[0].dist)},${H-PAD.bottom} L${distToX(activePts[0].dist)},${elevToY(activePts[0].elevation)}`;
            let line = `M${distToX(activePts[0].dist)},${elevToY(activePts[0].elevation)}`;
            activePts.forEach(p => {
                area += ` L${distToX(p.dist)},${elevToY(p.elevation)}`;
                line += ` L${distToX(p.dist)},${elevToY(p.elevation)}`;
            });
            area += ` L${distToX(activePts[activePts.length-1].dist)},${H-PAD.bottom} Z`;
            svg += `<path d="${area}" fill="${activeColor}" fill-opacity="0.15"/>`;
            svg += `<path class="branch-line" data-branch="${activeBranch}" d="${line}" fill="none" stroke="${activeColor}" stroke-width="3" style="cursor:pointer"/>`;
        }
        
        // 節點（只顯示 active 分支的）
        nodeAnnotations.filter(n => n.branchIndex === activeBranch).forEach((node, ni) => {
            const color = branchColors[node.branchIndex] || '#333';
            const x = distToX(node.dist);
            svg += `<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${H-PAD.bottom}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.8"/>`;
            svg += `<rect x="${x-2}" y="${H-PAD.bottom}" width="4" height="8" fill="${color}" rx="1"/>`;
            const ly = H - PAD.bottom + (ni % 2 === 0 ? 30 : 48);
            svg += `<text x="${x}" y="${ly}" text-anchor="middle" font-size="10" font-weight="bold" fill="${color}">${node.name}</text>`;
        });
        
        // 圖例
        branches.forEach((b, i) => {
            const color = branchColors[b];
            const isActive = b === activeBranch;
            const lx = PAD.left + i * 130;
            const ly = H - 10;
            svg += `<line x1="${lx}" y1="${ly}" x2="${lx+18}" y2="${ly}" stroke="${color}" stroke-width="${isActive ? 3 : 1.5}" opacity="${isActive ? 1 : 0.4}"/>`;
            svg += `<text x="${lx+22}" y="${ly+4}" font-size="11" fill="${isActive ? color : '#aaa'}" font-weight="${isActive ? 'bold' : 'normal'}">分支 ${b}${isActive ? ' ✓' : ''}</text>`;
        });
        
        // 軸標題
        svg += `<text x="${W/2}" y="${H-2}" text-anchor="middle" font-size="11" fill="#555">水平距離 (m)</text>`;
        svg += `<text x="13" y="${PAD.top+chartH/2}" text-anchor="middle" font-size="11" fill="#555" transform="rotate(-90,13,${PAD.top+chartH/2})">高程 (m)</text>`;
        svg += `<rect x="${PAD.left}" y="${PAD.top}" width="${chartW}" height="${chartH}" fill="none" stroke="#ccc" stroke-width="1"/>`;
        
        // 游標
        svg += `<line id="cursorLine" x1="0" y1="${PAD.top}" x2="0" y2="${H-PAD.bottom}" stroke="#e74c3c" stroke-width="1.5" stroke-dasharray="4,3" opacity="0" pointer-events="none"/>`;
        svg += `<circle id="cursorDot" cx="0" cy="0" r="5" fill="#e74c3c" opacity="0" pointer-events="none"/>`;
        svg += `<rect id="cursorBg" x="0" y="0" width="90" height="20" fill="white" rx="3" opacity="0" pointer-events="none"/>`;
        svg += `<text id="cursorText" x="0" y="0" font-size="11" fill="#e74c3c" opacity="0" pointer-events="none"></text>`;
        svg += `<rect id="hitArea" x="${PAD.left}" y="${PAD.top}" width="${chartW}" height="${chartH}" fill="transparent"/>`;
        
        return { svg, distToX, elevToY, globalMaxD, globalMinE, globalRange };
    }
    
    function render() {
        const { svg, distToX, elevToY, globalMaxD, globalMinE, globalRange } = buildSVG(activeBranch);
        const activePts = samples.filter(s => s.branchIndex === activeBranch);
        const activeStats = {
            maxD: Math.max(...activePts.map(s => s.dist)),
            maxE: Math.max(...activePts.map(s => s.elevation)),
            minE: Math.min(...activePts.map(s => s.elevation)),
        };
        
        win.document.getElementById('content').innerHTML = `
            <svg id="elevSvg" viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;">${svg}</svg>
            <div id="hint" style="text-align:center;font-size:11px;color:#999;margin-top:4px;">💡 點擊其他分支線條可切換顯示</div>
            <div id="stats" style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;padding:10px 14px;background:white;border-radius:8px;font-size:13px;box-shadow:0 1px 4px rgba(0,0,0,0.1);">
                <span>📏 分支長：<b>${Math.round(activeStats.maxD)}m</b></span>
                <span>⛰️ 最高：<b>${Math.round(activeStats.maxE)}m</b></span>
                <span>🏔️ 最低：<b>${Math.round(activeStats.minE)}m</b></span>
                <span>📊 高差：<b>${Math.round(activeStats.maxE - activeStats.minE)}m</b></span>
                <span>📍 節點：<b>${nodeAnnotations.filter(n => n.branchIndex === activeBranch).length}</b></span>
                <span style="color:#1976D2;">🔵 目前：分支 ${activeBranch}</span>
            </div>
        `;
        
        const channel = new win.BroadcastChannel('elevation_cursor');
        const svgEl = win.document.getElementById('elevSvg');
        const cursorLine = win.document.getElementById('cursorLine');
        const cursorDot = win.document.getElementById('cursorDot');
        const cursorBg = win.document.getElementById('cursorBg');
        const cursorText = win.document.getElementById('cursorText');
        const hitArea = win.document.getElementById('hitArea');
        
        // 點擊分支線條切換
        svgEl.querySelectorAll('.branch-line').forEach(el => {
            el.addEventListener('click', function(e) {
                const b = parseInt(this.getAttribute('data-branch'));
                if (b !== activeBranch) {
                    activeBranch = b;
                    render();
                }
            });
        });
        
        // 游標互動
        hitArea.addEventListener('mousemove', function(e) {
            const rect = svgEl.getBoundingClientRect();
            const scaleX = W / rect.width;
            const mouseX = (e.clientX - rect.left) * scaleX;
            const dist = ((mouseX - PAD.left) / chartW) * globalMaxD;
            if (dist < 0 || dist > globalMaxD) return;
            
            // 只在 active 分支找最近點
            const activePts = samples.filter(s => s.branchIndex === activeBranch);
            let nearest = null, minGap = Infinity;
            activePts.forEach(s => {
                const gap = Math.abs(s.dist - dist);
                if (gap < minGap) { minGap = gap; nearest = s; }
            });
            if (!nearest) return;
            
            const x = PAD.left + (nearest.dist / globalMaxD) * chartW;
            const y = PAD.top + chartH - ((nearest.elevation - globalMinE) / globalRange) * chartH;
            
            cursorLine.setAttribute('x1', x); cursorLine.setAttribute('x2', x); cursorLine.setAttribute('opacity', '0.8');
            cursorDot.setAttribute('cx', x); cursorDot.setAttribute('cy', y); cursorDot.setAttribute('opacity', '1');
            
            const label = `${Math.round(nearest.dist)}m, ${Math.round(nearest.elevation)}m`;
            const labelX = x + 8 > W - PAD.right - 95 ? x - 98 : x + 8;
            cursorBg.setAttribute('x', labelX); cursorBg.setAttribute('y', y - 14); cursorBg.setAttribute('opacity', '0.9');
            cursorText.setAttribute('x', labelX + 4); cursorText.setAttribute('y', y); cursorText.setAttribute('opacity', '1');
            cursorText.textContent = label;
            
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
    
    render();
}
