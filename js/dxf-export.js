// ============================================================
// dxf-export.js  —  匯出 AutoCAD DXF（含豐富 OSM 底圖）
// 座標轉換：WGS84 → TWD97 TM2（台灣工程標準）
// 圖層：管線/節點/工作井/道路分級/鐵路/水系/建築/地名/邊界
// ============================================================

function wgs84ToTWD97(lat, lng) {
    const a = 6378137.0, f = 1 / 298.257222101;
    const e2 = 2 * f - f * f;
    const k0 = 0.9999, lon0 = 121.0 * Math.PI / 180, FE = 250000;
    const phi = lat * Math.PI / 180, lam = lng * Math.PI / 180;
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2, C = (e2 / (1 - e2)) * Math.cos(phi) ** 2;
    const A = Math.cos(phi) * (lam - lon0);
    const e4 = e2 * e2, e6 = e4 * e2;
    const M = a * (
        (1 - e2/4 - 3*e4/64 - 5*e6/256) * phi
        - (3*e2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*phi)
        + (15*e4/256 + 45*e6/1024) * Math.sin(4*phi)
        - (35*e6/3072) * Math.sin(6*phi)
    );
    const x = FE + k0 * N * (A + (1-T+C)*A**3/6 + (5-18*T+T**2+72*C-58*(e2/(1-e2)))*A**5/120);
    const y = k0 * (M + N * Math.tan(phi) * (A**2/2 + (5-T+9*C+4*C**2)*A**4/24 + (61-58*T+T**2+600*C-330*(e2/(1-e2)))*A**6/720));
    return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

async function fetchOsmData(bounds) {
    const { south, west, north, east } = bounds;
    const query = `[out:json][timeout:45];
(
  way["highway"](${south},${west},${north},${east});
  way["railway"](${south},${west},${north},${east});
  way["waterway"](${south},${west},${north},${east});
  way["natural"="water"](${south},${west},${north},${east});
  way["landuse"="residential"](${south},${west},${north},${east});
  way["landuse"="industrial"](${south},${west},${north},${east});
  way["landuse"="farmland"](${south},${west},${north},${east});
  way["building"](${south},${west},${north},${east});
  node["name"](${south},${west},${north},${east});
  node["place"](${south},${west},${north},${east});
);
out body;>;out skel qt;`;
    const servers = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ];
    let lastError = null;
    for (const url of servers) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 40000);
            const resp = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: controller.signal });
            clearTimeout(timer);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            console.log('OSM OK:', url, data.elements?.length, '個元素');
            return data;
        } catch (e) { console.warn('OSM fail:', url, e.message); lastError = e; }
    }
    throw new Error('所有 OSM 伺服器均無法連線：' + lastError?.message);
}

function parseOsmResult(data) {
    const nodes = {};
    data.elements.forEach(el => { if (el.type === 'node') nodes[el.id] = { lat: el.lat, lng: el.lon, tags: el.tags || {} }; });
    const roads = [], railways = [], waterways = [], buildings = [], places = [];
    data.elements.forEach(el => {
        if (el.type === 'node' && el.tags) {
            const name = el.tags.name || '';
            if (name && el.lat) places.push({ lat: el.lat, lng: el.lon, name, type: el.tags.place || el.tags.amenity || 'name' });
            return;
        }
        if (el.type !== 'way' || !el.nodes) return;
        const coords = el.nodes.map(nid => nodes[nid]).filter(Boolean);
        if (coords.length < 2) return;
        const tags = el.tags || {};
        if (tags.highway) {
            const rank = { motorway:1, trunk:1, primary:2, secondary:3, tertiary:4, residential:5, service:6, footway:7, path:7, cycleway:7 };
            roads.push({ coords, name: tags.name || '', type: tags.highway, rank: rank[tags.highway] || 5 });
        } else if (tags.railway) {
            railways.push({ coords, name: tags.name || '', type: tags.railway });
        } else if (tags.waterway || tags.natural === 'water') {
            waterways.push({ coords, name: tags.name || '', type: tags.waterway || 'water', closed: tags.natural === 'water' });
        } else if (tags.building) {
            if (coords.length >= 3) buildings.push({ coords, type: tags.building });
        } else if (tags.landuse) {
            if (coords.length >= 3) buildings.push({ coords, type: 'landuse_' + tags.landuse });
        }
    });
    return { roads, railways, waterways, buildings, places };
}

function toAcadUnicode(str) {
    let r = '';
    for (const ch of String(str)) { const c = ch.codePointAt(0); r += c > 127 ? '\\U+' + c.toString(16).toUpperCase().padStart(4,'0') : ch; }
    return r;
}

function dxfHeader(minX, minY, maxX, maxY) {
    return `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1018\n9\n$DWGCODEPAGE\n3\nANSI_950\n9\n$INSUNITS\n70\n6\n9\n$EXTMIN\n10\n${minX}\n20\n${minY}\n30\n0.0\n9\n$EXTMAX\n10\n${maxX}\n20\n${maxY}\n30\n0.0\n0\nENDSEC\n`;
}

function dxfLayers() {
    const layers = [
        { name:'PIPE_MAIN',      color:1,   ltype:'CONTINUOUS' },
        { name:'PIPE_BRANCH',    color:6,   ltype:'CONTINUOUS' },
        { name:'PIPE_TXT',       color:2,   ltype:'CONTINUOUS' },
        { name:'PIPE_NODE',      color:2,   ltype:'CONTINUOUS' },
        { name:'WELL',           color:4,   ltype:'CONTINUOUS' },
        { name:'ROAD_PRIMARY',   color:7,   ltype:'CONTINUOUS' },
        { name:'ROAD_SECONDARY', color:9,   ltype:'CONTINUOUS' },
        { name:'ROAD_LOCAL',     color:8,   ltype:'CONTINUOUS' },
        { name:'ROAD_TXT',       color:8,   ltype:'CONTINUOUS' },
        { name:'RAILWAY',        color:5,   ltype:'DASHED'     },
        { name:'RAILWAY_TXT',    color:5,   ltype:'CONTINUOUS' },
        { name:'WATER',          color:4,   ltype:'CONTINUOUS' },
        { name:'WATER_TXT',      color:4,   ltype:'CONTINUOUS' },
        { name:'BUILDING',       color:251, ltype:'CONTINUOUS' },
        { name:'LANDUSE',        color:253, ltype:'DASHED'     },
        { name:'PLACE_NAME',     color:3,   ltype:'CONTINUOUS' },
        { name:'BOUNDARY',       color:6,   ltype:'DASHED'     },
        { name:'TITLE',          color:2,   ltype:'CONTINUOUS' },
    ];
    let out = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n3\n`;
    out += `0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n`;
    out += `0\nLTYPE\n2\nDASHED\n70\n0\n3\nDash\n72\n65\n73\n2\n40\n0.75\n49\n0.5\n49\n-0.25\n`;
    out += `0\nLTYPE\n2\nDOTTED\n70\n0\n3\nDot\n72\n65\n73\n2\n40\n0.2\n49\n0.0\n49\n-0.2\n`;
    out += `0\nENDTAB\n0\nTABLE\n2\nLAYER\n70\n${layers.length}\n`;
    layers.forEach(l => { out += `0\nLAYER\n2\n${l.name}\n70\n0\n62\n${l.color}\n6\n${l.ltype}\n`; });
    out += `0\nENDTAB\n0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n2\nSTANDARD\n70\n0\n40\n0.0\n41\n1.0\n50\n0.0\n71\n0\n42\n0.2\n3\nbigfont.shx\n4\nbigfont.shx\n0\nENDTAB\n0\nENDSEC\n`;
    return out;
}

function dxfPolyline(layer, coords2d, closed, lw) {
    let out = `0\nLWPOLYLINE\n8\n${layer}\n90\n${coords2d.length}\n70\n${closed ? 1 : 0}\n`;
    if (lw > 0) out += `370\n${lw}\n`;
    coords2d.forEach(([x, y]) => { out += `10\n${x}\n20\n${y}\n`; });
    return out;
}

function dxfText(layer, x, y, h, text, angle) {
    const safe = toAcadUnicode(String(text).replace(/[\x00-\x1F]/g, ''));
    return `0\nTEXT\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0.0\n40\n${h}\n1\n${safe}\n50\n${angle || 0}\n`;
}

function dxfCircle(layer, x, y, r) {
    return `0\nCIRCLE\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0.0\n40\n${r}\n`;
}

function midOf(coords2d) { return coords2d[Math.floor(coords2d.length / 2)] || coords2d[0]; }
function lineAngle(p1, p2) { return Math.atan2(p2[1]-p1[1], p2[0]-p1[0]) * 180 / Math.PI; }

async function exportDXF() {
    if (!currentPipeline) { showToast('請先選擇一個工程', 'error'); return; }
    const btn = document.getElementById('dxfExportBtn');
    if (btn) { btn.textContent = '⏳ 載入中...'; btn.disabled = true; }

    try {
        const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
        let branches = isMULTI
            ? parseLineStringWithBranches(currentPipeline.linestring).branches
            : [{ coords: parseLineString(currentPipeline.linestring), index: 0 }];

        const brTWD = branches.map((b, bi) => ({
            ...b, bi,
            coords2d: b.coords.map(([lat, lng]) => { const {x,y} = wgs84ToTWD97(lat,lng); return [x,y]; })
        }));

        const allLL = branches.flatMap(b => b.coords);
        const lats = allLL.map(c=>c[0]), lngs = allLL.map(c=>c[1]);
        const osmB = { south: Math.min(...lats)-0.003, north: Math.max(...lats)+0.003, west: Math.min(...lngs)-0.003, east: Math.max(...lngs)+0.003 };

        const allXY = brTWD.flatMap(b => b.coords2d);
        let minX=Math.min(...allXY.map(p=>p[0])), maxX=Math.max(...allXY.map(p=>p[0]));
        let minY=Math.min(...allXY.map(p=>p[1])), maxY=Math.max(...allXY.map(p=>p[1]));

        if (btn) btn.textContent = '⏳ 下載地圖資料...';
        let osmRoads=[], osmRail=[], osmWater=[], osmBldg=[], osmPlaces=[];
        try {
            const osmData = await fetchOsmData(osmB);
            const p = parseOsmResult(osmData);
            osmRoads=p.roads; osmRail=p.railways; osmWater=p.waterways; osmBldg=p.buildings; osmPlaces=p.places;
            console.log(`OSM: ${osmRoads.length}道路 ${osmRail.length}鐵路 ${osmWater.length}水系 ${osmBldg.length}建物 ${osmPlaces.length}地名`);
        } catch(e) { showToast('⚠️ 地圖底圖載入失敗，將只輸出管線', 'warning', 4000); }

        function toTWD(coords) { return coords.map(c=>{ const {x,y}=wgs84ToTWD97(c.lat,c.lng); return [x,y]; }); }
        const rdTWD = osmRoads.map(r=>({...r, coords2d:toTWD(r.coords)}));
        const raTWD = osmRail.map(r=>({...r, coords2d:toTWD(r.coords)}));
        const raRaTWD = raTWD;
        const waTWD = osmWater.map(w=>({...w, coords2d:toTWD(w.coords)}));
        const blTWD = osmBldg.map(b=>({...b, coords2d:toTWD(b.coords)}));
        const plTWD = osmPlaces.map(p=>{ const {x,y}=wgs84ToTWD97(p.lat,p.lng); return {...p,x,y}; });

        [...rdTWD,...raTWD,...waTWD,...blTWD].forEach(item => {
            item.coords2d.forEach(([x,y]) => { if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; });
        });

        if (btn) btn.textContent = '⏳ 產生 DXF...';
        const rX=maxX-minX, rY=maxY-minY;
        const tH=Math.max(rX/300,1.5), bigH=tH*1.8, sH=tH*0.7, nR=tH*0.4;
        let ent = '';

        // 建築/土地利用
        blTWD.forEach(b => { if(b.coords2d.length<3) return; ent += dxfPolyline(b.type&&b.type.startsWith('landuse')?'LANDUSE':'BUILDING', b.coords2d, true, 0); });
        // 水系
        waTWD.forEach(w => { if(w.coords2d.length<2) return; ent += dxfPolyline('WATER',w.coords2d,w.closed,30); if(w.name){const [mx,my]=midOf(w.coords2d);ent+=dxfText('WATER_TXT',mx,my,sH,w.name);} });
        // 鐵路
        raRaTWD.forEach(r => { if(r.coords2d.length<2) return; ent += dxfPolyline('RAILWAY',r.coords2d,false,50); if(r.name){const [mx,my]=midOf(r.coords2d);ent+=dxfText('RAILWAY_TXT',mx,my+sH,sH,r.name);} });
        // 道路
        rdTWD.forEach(r => {
            if(r.coords2d.length<2) return;
            let layer,lw;
            if(r.rank<=2){layer='ROAD_PRIMARY';lw=50;} else if(r.rank<=3){layer='ROAD_SECONDARY';lw=30;} else {layer='ROAD_LOCAL';lw=0;}
            ent += dxfPolyline(layer,r.coords2d,false,lw);
            if(r.name&&r.rank<=4){ const [mx,my]=midOf(r.coords2d); ent+=dxfText('ROAD_TXT',mx,my,sH,r.name); }
        });
        // 地名
        plTWD.filter(p => ['village','town','city','suburb','hamlet','neighbourhood'].includes(p.type)).forEach(p => { const isV=['city','town','village'].includes(p.type); ent+=dxfText('PLACE_NAME',p.x,p.y,isV?tH:sH,p.name); });

        // 管線
        brTWD.forEach((b,bi) => {
            if(b.coords2d.length<2) return;
            const layer = bi===0?'PIPE_MAIN':'PIPE_BRANCH';
            ent += dxfPolyline(layer, b.coords2d, false, 80);
            const [mx,my]=midOf(b.coords2d);
            const p1=b.coords2d[Math.floor(b.coords2d.length/2)];
            const p2=b.coords2d[Math.min(Math.floor(b.coords2d.length/2)+1,b.coords2d.length-1)];
            // 管線名稱只標一次在中間，用小字
if(bi===0){ const midI=Math.floor(b.coords2d.length/2); const [lx,ly]=b.coords2d[midI]; ent+=dxfText('PIPE_TXT',lx,ly+sH*1.2,sH,currentPipeline.name); }
        });

        // 節點 + 分段標註
        const pipeBranches = currentPipeline.branches || {};
        brTWD.forEach((b,bi) => {
            const segs = pipeBranches['B'+bi] || [];
            const addedNodes = new Set();
            segs.forEach(seg => {
                if(seg.nodeName&&seg.nodeName.trim()&&!addedNodes.has(seg.nodeName)) {
                    addedNodes.add(seg.nodeName);
                    const coord = getPositionAtDistanceFromCoords(b.coords, seg.startDistance);
                    if(coord){ const {x,y}=wgs84ToTWD97(coord[0],coord[1]); ent+=dxfCircle('PIPE_NODE',x,y,nR); ent+=dxfText('PIPE_TXT',x+nR*1.5,y,tH*0.9,seg.nodeName); }
                }
                const mk=[seg.diameter,seg.pipeType,seg.method].filter(Boolean).join(' ');
                if(!mk) return;
                const midDist=(seg.startDistance+seg.endDistance)/2;
                const coord=getPositionAtDistanceFromCoords(b.coords,midDist);
                if(!coord) return;
                const {x,y}=wgs84ToTWD97(coord[0],coord[1]);
                const segLen=Math.round(seg.endDistance-seg.startDistance);
                // 每隔10個小段標一次，避免過密
                if(Math.round(midDist/10) % 10 === 0) ent+=dxfText('PIPE_TXT',x,y-tH*1.5,sH,mk+'  L='+segLen+'m');
            });
        });

        // 工作井
        if(window.wellMarkers&&window.wellMarkers.length>0) {
            window.wellMarkers.forEach(wm=>{ const pos=wm.getLatLng?wm.getLatLng():null; if(!pos)return; const {x,y}=wgs84ToTWD97(pos.lat,pos.lng); ent+=dxfCircle('WELL',x,y,nR*1.5); ent+=dxfText('WELL',x+nR*2,y,tH*0.8,'工作井'); });
        }

        // 邊界框
        const pad=Math.max(rX,rY)*0.03;
        const bx1=minX-pad,by1=minY-pad,bx2=maxX+pad,by2=maxY+pad;
        ent += dxfPolyline('BOUNDARY',[[bx1,by1],[bx2,by1],[bx2,by2],[bx1,by2]],true,0);

        // 標題欄
        const tbW=rX*0.35,tbH=bigH*8,tbX=bx2-tbW,tbY=by1;
        ent += dxfPolyline('TITLE',[[tbX,tbY],[bx2,tbY],[bx2,tbY+tbH],[tbX,tbY+tbH]],true,0);
        ent += dxfText('TITLE',tbX+tbW*0.05,tbY+bigH*5.5,bigH,currentPipeline.name);
        ent += dxfText('TITLE',tbX+tbW*0.05,tbY+bigH*3.5,tH,'工程編號：'+(currentPipeline.id||''));
        ent += dxfText('TITLE',tbX+tbW*0.05,tbY+bigH*2.2,tH,'座標系統：TWD97 TM2');
        ent += dxfText('TITLE',tbX+tbW*0.05,tbY+bigH*1.0,sH,'繪圖日期：'+new Date().toLocaleDateString('zh-TW'));
        ent += dxfText('TITLE',tbX+tbW*0.05,tbY+bigH*0.1,sH,'單位：公尺  資料來源：OSM');

        // 比例尺
        const scLen=Math.round(rX/5/100)*100,scY=by1+bigH*0.5;
        ent += dxfPolyline('BOUNDARY',[[bx1,scY],[bx1+scLen,scY]],false,30);
        ent += dxfPolyline('BOUNDARY',[[bx1,scY-sH*0.5],[bx1,scY+sH*0.5]],false,0);
        ent += dxfPolyline('BOUNDARY',[[bx1+scLen,scY-sH*0.5],[bx1+scLen,scY+sH*0.5]],false,0);
        ent += dxfText('BOUNDARY',bx1,scY+sH*1.2,sH,'0');
        ent += dxfText('BOUNDARY',bx1+scLen-sH,scY+sH*1.2,sH,scLen+'m');

        // 北方向標
        const nX=bx1+tH*3,nY=by1+tH*6;
        ent += dxfPolyline('BOUNDARY',[[nX,nY-tH*2],[nX,nY+tH*2]],false,0);
        ent += dxfPolyline('BOUNDARY',[[nX-tH,nY],[nX,nY+tH*2]],false,0);
        ent += dxfPolyline('BOUNDARY',[[nX+tH,nY],[nX,nY+tH*2]],false,0);
        ent += dxfText('BOUNDARY',nX-tH*0.3,nY+tH*2.5,tH,'N');

        const dxf = [dxfHeader(bx1,by1,bx2,by2), dxfLayers(), '0\nSECTION\n2\nENTITIES\n', ent, '0\nENDSEC\n0\nEOF\n'].join('');
        const safeName=(currentPipeline.name||'pipeline').replace(/[\/\\?%*:|"<>]/g,'_');
        const blob=new Blob([dxf],{type:'application/dxf'});
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a'); a.href=url; a.download=safeName+'.dxf';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('DXF 匯出成功！道路'+osmRoads.length+'條 鐵路'+osmRail.length+'條 水系'+osmWater.length+'條 建物'+osmBldg.length+'棟 地名'+osmPlaces.length+'個', 'success', 6000);

    } catch(err) {
        console.error('DXF 匯出失敗:', err);
        showToast('匯出失敗：'+err.message, 'error', 6000);
    } finally {
        if(btn){btn.textContent='📐 匯出DXF';btn.disabled=false;}
    }
}

// ============================================================
// exportSVG — 匯出 SVG 向量圖（瀏覽器直接開啟，中文正常）
// ============================================================
async function exportSVG() {
    if (!currentPipeline) { showToast('請先選擇一個工程', 'error'); return; }

    const btn = document.querySelector('#svgToolItem');
    if (btn) btn.style.opacity = '0.5';
    showToast('⏳ 產生 SVG...', 'info', 2000);

    try {
        // ── 1. 解析管線座標 ──
        const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
        let branches = isMULTI
            ? parseLineStringWithBranches(currentPipeline.linestring).branches
            : [{ coords: parseLineString(currentPipeline.linestring), index: 0 }];

        // 收集所有 WGS84 座標
        const allLL = branches.flatMap(b => b.coords);
        const lats = allLL.map(c => c[0]), lngs = allLL.map(c => c[1]);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const padLat = (maxLat - minLat) * 0.1, padLng = (maxLng - minLng) * 0.1;

        // SVG 畫布尺寸
        const W = 1200, H = 900;
        const viewMinLng = minLng - padLng, viewMaxLng = maxLng + padLng;
        const viewMinLat = minLat - padLat, viewMaxLat = maxLat + padLat;

        function toSVG(lat, lng) {
            const x = (lng - viewMinLng) / (viewMaxLng - viewMinLng) * W;
            const y = H - (lat - viewMinLat) / (viewMaxLat - viewMinLat) * H;
            return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
        }

        // ── 2. 取得 OSM 資料 ──
        const osmBounds = { south: viewMinLat, north: viewMaxLat, west: viewMinLng, east: viewMaxLng };
        let osmRoads=[], osmRail=[], osmWater=[], osmBldg=[];
        try {
            const osmData = await fetchOsmData(osmBounds);
            const p = parseOsmResult(osmData);
            osmRoads=p.roads; osmRail=p.railways; osmWater=p.waterways; osmBldg=p.buildings;
        } catch(e) { showToast('⚠️ 底圖載入失敗，只輸出管線', 'warning', 3000); }

        // ── 3. 產生 SVG ──
        let svgContent = '';

        // 背景
        svgContent += `<rect width="${W}" height="${H}" fill="#f8f8f0"/>`;

        // 土地利用
        osmBldg.filter(b => b.type && b.type.startsWith('landuse')).forEach(b => {
            const pts = b.coords.map(c => toSVG(c.lat, c.lng).join(',')).join(' ');
            const fill = b.type.includes('residential') ? '#e8e8e0' : b.type.includes('industrial') ? '#ddd8cc' : '#e4ecd8';
            svgContent += `<polygon points="${pts}" fill="${fill}" stroke="none"/>`;
        });

        // 水系
        osmWater.forEach(w => {
            const pts = w.coords.map(c => toSVG(c.lat, c.lng));
            if (pts.length < 2) return;
            if (w.closed) {
                svgContent += `<polygon points="${pts.map(p=>p.join(',')).join(' ')}" fill="#aad4e8" stroke="#6ab0d0" stroke-width="1"/>`;
            } else {
                svgContent += `<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#6ab0d0" stroke-width="1.5"/>`;
            }
            if (w.name) {
                const mid = pts[Math.floor(pts.length/2)];
                svgContent += `<text x="${mid[0]}" y="${mid[1]}" font-size="9" fill="#2080a0" text-anchor="middle">${w.name}</text>`;
            }
        });

        // 建築
        osmBldg.filter(b => !b.type.startsWith('landuse')).forEach(b => {
            const pts = b.coords.map(c => toSVG(c.lat, c.lng).join(',')).join(' ');
            svgContent += `<polygon points="${pts}" fill="#d8d0c8" stroke="#b0a898" stroke-width="0.5"/>`;
        });

        // 道路
        osmRoads.forEach(r => {
            if (r.coords.length < 2) return;
            const pts = r.coords.map(c => toSVG(c.lat, c.lng).join(',')).join(' ');
            let stroke, sw;
            if (r.rank <= 2) { stroke='#ffffff'; sw=4; }
            else if (r.rank <= 3) { stroke='#f0f0f0'; sw=2.5; }
            else if (r.rank <= 5) { stroke='#e8e8e8'; sw=1.5; }
            else { stroke='#e0e0e0'; sw=0.8; }
            svgContent += `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
            if (r.name && r.rank <= 3) {
                const mid = toSVG(r.coords[Math.floor(r.coords.length/2)].lat, r.coords[Math.floor(r.coords.length/2)].lng);
                svgContent += `<text x="${mid[0]}" y="${mid[1]}" font-size="8" fill="#888" text-anchor="middle">${r.name}</text>`;
            }
        });

        // 鐵路
        osmRail.forEach(r => {
            const pts = r.coords.map(c => toSVG(c.lat, c.lng).join(',')).join(' ');
            svgContent += `<polyline points="${pts}" fill="none" stroke="#6080c0" stroke-width="2" stroke-dasharray="8,4"/>`;
            if (r.name) {
                const mid = toSVG(r.coords[Math.floor(r.coords.length/2)].lat, r.coords[Math.floor(r.coords.length/2)].lng);
                svgContent += `<text x="${mid[0]}" y="${mid[1]}" font-size="9" fill="#4060a0">${r.name}</text>`;
            }
        });

        // 管線（新架構用完工狀態上色）
        const pipeBranches = currentPipeline.branches || {};
        branches.forEach((b, bi) => {
            const segs = pipeBranches['B'+bi] || [];
            const isMain = bi === 0;

            if (segs.length > 0) {
                // 用小段完工狀態分色
                segs.forEach(seg => {
                    const fromCoord = getPositionAtDistanceFromCoords(b.coords, seg.startDistance);
                    const toCoord   = getPositionAtDistanceFromCoords(b.coords, seg.endDistance);
                    if (!fromCoord || !toCoord) return;
                    const p1 = toSVG(fromCoord[0], fromCoord[1]);
                    const p2 = toSVG(toCoord[0], toCoord[1]);
                    const done = seg.status && seg.status !== '0' && seg.status.trim() !== '';
                    const color = done ? '#00b050' : (isMain ? '#cc0000' : '#cc44cc');
                    svgContent += `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="${color}" stroke-width="${isMain?4:3}" stroke-linecap="round"/>`;
                });
            } else {
                // 整條線（無小段資料）
                const pts = b.coords.map(c => toSVG(c[0], c[1]).join(',')).join(' ');
                svgContent += `<polyline points="${pts}" fill="none" stroke="${isMain?'#cc0000':'#cc44cc'}" stroke-width="${isMain?4:3}" stroke-linecap="round" stroke-linejoin="round"/>`;
            }

            // 節點標示
            const addedNodes = new Set();
            segs.forEach(seg => {
                if (!seg.nodeName || !seg.nodeName.trim() || addedNodes.has(seg.nodeName)) return;
                addedNodes.add(seg.nodeName);
                const coord = getPositionAtDistanceFromCoords(b.coords, seg.startDistance);
                if (!coord) return;
                const [sx, sy] = toSVG(coord[0], coord[1]);
                svgContent += `<circle cx="${sx}" cy="${sy}" r="5" fill="white" stroke="#cc0000" stroke-width="1.5"/>`;
                svgContent += `<text x="${sx+7}" y="${sy+4}" font-size="10" fill="#cc0000" font-weight="bold">${seg.nodeName}</text>`;
            });
        });

        // 圖例
        const legX = W - 200, legY = 20;
        svgContent += `<rect x="${legX-10}" y="${legY-10}" width="210" height="100" fill="white" fill-opacity="0.9" stroke="#ccc" rx="4"/>`;
        svgContent += `<text x="${legX}" y="${legY+8}" font-size="11" font-weight="bold" fill="#333">圖例</text>`;
        svgContent += `<line x1="${legX}" y1="${legY+22}" x2="${legX+30}" y2="${legY+22}" stroke="#00b050" stroke-width="3"/><text x="${legX+35}" y="${legY+26}" font-size="10" fill="#333">已完工</text>`;
        svgContent += `<line x1="${legX}" y1="${legY+38}" x2="${legX+30}" y2="${legY+38}" stroke="#cc0000" stroke-width="3"/><text x="${legX+35}" y="${legY+42}" font-size="10" fill="#333">未完工（主線）</text>`;
        svgContent += `<line x1="${legX}" y1="${legY+54}" x2="${legX+30}" y2="${legY+54}" stroke="#cc44cc" stroke-width="3"/><text x="${legX+35}" y="${legY+58}" font-size="10" fill="#333">未完工（分支）</text>`;
        svgContent += `<line x1="${legX}" y1="${legY+70}" x2="${legX+30}" y2="${legY+70}" stroke="#6ab0d0" stroke-width="2"/><text x="${legX+35}" y="${legY+74}" font-size="10" fill="#333">水系</text>`;
        svgContent += `<line x1="${legX}" y1="${legY+86}" x2="${legX+30}" y2="${legY+86}" stroke="#6080c0" stroke-width="2" stroke-dasharray="6,3"/><text x="${legX+35}" y="${legY+90}" font-size="10" fill="#333">鐵路</text>`;

        // 標題
        svgContent += `<rect x="0" y="${H-40}" width="${W}" height="40" fill="white" fill-opacity="0.9"/>`;
        svgContent += `<text x="10" y="${H-22}" font-size="14" font-weight="bold" fill="#333">${currentPipeline.name}</text>`;
        svgContent += `<text x="10" y="${H-6}" font-size="10" fill="#888">座標系統：WGS84　繪圖日期：${new Date().toLocaleDateString('zh-TW')}　資料來源：OSM</text>`;

        // 完整 SVG
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><style>text { font-family: "Microsoft JhengHei", "微軟正黑體", Arial, sans-serif; }</style></defs>
${svgContent}
</svg>`;

        // 下載
        const safeName = (currentPipeline.name || 'pipeline').replace(/[\/\\?%*:|"<>]/g, '_');
        const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href=url; a.download=safeName+'.svg';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✅ SVG 匯出成功！用瀏覽器開啟即可檢視', 'success', 5000);

    } catch(err) {
        console.error('SVG 匯出失敗:', err);
        showToast('匯出失敗：'+err.message, 'error', 6000);
    } finally {
        if (btn) btn.style.opacity = '1';
    }
}
