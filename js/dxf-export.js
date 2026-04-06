// ============================================================
// dxf-export.js  —  匯出 AutoCAD DXF（含 OSM 街道/建築物底圖）
// 座標轉換：WGS84 → TWD97 TM2（台灣工程標準）
// ============================================================

// ── proj4 座標轉換（TWD97 TM2）─────────────────────────────
// 若頁面已載入 proj4，直接使用；否則用近似公式
function wgs84ToTWD97(lat, lng) {
    // TWD97 TM2 參數（台灣中央經線 121°E）
    const a = 6378137.0;
    const f = 1 / 298.257222101;
    const b = a * (1 - f);
    const e2 = 2 * f - f * f;
    const e = Math.sqrt(e2);
    const k0 = 0.9999;
    const lon0 = 121.0 * Math.PI / 180;
    const FE = 250000;
    const FN = 0;

    const phi = lat * Math.PI / 180;
    const lam = lng * Math.PI / 180;

    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2;
    const C = (e2 / (1 - e2)) * Math.cos(phi) ** 2;
    const A = Math.cos(phi) * (lam - lon0);

    const e4 = e2 * e2, e6 = e4 * e2;
    const M = a * (
        (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
        - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
        + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
        - (35 * e6 / 3072) * Math.sin(6 * phi)
    );

    const x = FE + k0 * N * (
        A + (1 - T + C) * A ** 3 / 6
        + (5 - 18 * T + T ** 2 + 72 * C - 58 * (e2 / (1 - e2))) * A ** 5 / 120
    );
    const y = FN + k0 * (M + N * Math.tan(phi) * (
        A ** 2 / 2
        + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
        + (61 - 58 * T + T ** 2 + 600 * C - 330 * (e2 / (1 - e2))) * A ** 6 / 720
    ));

    return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
}

// ── OSM Overpass API 查詢 ────────────────────────────────────
async function fetchOsmData(bounds) {
    // bounds = { south, north, west, east }
    const { south, west, north, east } = bounds;
    const query = `
[out:json][timeout:30];
(
  way["highway"](${south},${west},${north},${east});
  way["building"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;`;

    const url = 'https://overpass-api.de/api/interpreter';
    const resp = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (!resp.ok) throw new Error('OSM 查詢失敗，請稍後再試');
    return await resp.json();
}

function parseOsmResult(data) {
    // 建立 node id → { lat, lng }
    const nodes = {};
    data.elements.forEach(el => {
        if (el.type === 'node') nodes[el.id] = { lat: el.lat, lng: el.lon };
    });

    const roads = [], buildings = [];
    data.elements.forEach(el => {
        if (el.type !== 'way' || !el.nodes) return;
        const coords = el.nodes.map(nid => nodes[nid]).filter(Boolean);
        if (coords.length < 2) return;
        if (el.tags && el.tags.highway) {
            roads.push({ coords, name: el.tags.name || '', type: el.tags.highway });
        } else if (el.tags && el.tags.building) {
            buildings.push({ coords });
        }
    });
    return { roads, buildings };
}

// ── DXF 產生器 ───────────────────────────────────────────────
// ACI 顏色代碼
const DXF_COLOR = { RED: 1, YELLOW: 2, GREEN: 3, CYAN: 4, BLUE: 5, MAGENTA: 6, WHITE: 7, GRAY: 8, LTGRAY: 9 };

function dxfHeader(minX, minY, maxX, maxY) {
    return `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1015\n9\n$INSUNITS\n70\n6\n9\n$EXTMIN\n10\n${minX}\n20\n${minY}\n30\n0.0\n9\n$EXTMAX\n10\n${maxX}\n20\n${maxY}\n30\n0.0\n0\nENDSEC\n`;
}

function dxfLayers() {
    // 定義圖層
    const layers = [
        { name: 'PIPE',     color: DXF_COLOR.RED,    ltype: 'CONTINUOUS' },
        { name: 'PIPE_TXT', color: DXF_COLOR.YELLOW,  ltype: 'CONTINUOUS' },
        { name: 'WELL',     color: DXF_COLOR.CYAN,    ltype: 'CONTINUOUS' },
        { name: 'ROAD',     color: DXF_COLOR.WHITE,   ltype: 'CONTINUOUS' },
        { name: 'BUILDING', color: DXF_COLOR.GRAY,    ltype: 'CONTINUOUS' },
        { name: 'BOUNDARY', color: DXF_COLOR.MAGENTA, ltype: 'DASHED'     },
    ];
    let out = `0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLTYPE\n70\n2\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n0\nLTYPE\n2\nDASHED\n70\n0\n3\nDash ____ ____ ____\n72\n65\n73\n2\n40\n0.75\n49\n0.5\n49\n-0.25\n0\nENDTAB\n0\nTABLE\n2\nLAYER\n70\n${layers.length}\n`;
    layers.forEach(l => {
        out += `0\nLAYER\n2\n${l.name}\n70\n0\n62\n${l.color}\n6\n${l.ltype}\n`;
    });
    out += `0\nENDTAB\n0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n2\nSTANDARD\n70\n0\n40\n0.0\n41\n1.0\n50\n0.0\n71\n0\n42\n0.2\n3\ntxt\n4\n\n0\nENDTAB\n0\nENDSEC\n`;
    return out;
}

function dxfPolyline(layer, coords2d, closed = false) {
    // LWPOLYLINE — 輕量多段線
    let out = `0\nLWPOLYLINE\n8\n${layer}\n90\n${coords2d.length}\n70\n${closed ? 1 : 0}\n`;
    coords2d.forEach(([x, y]) => { out += `10\n${x}\n20\n${y}\n`; });
    return out;
}

function dxfText(layer, x, y, height, text) {
    // 過濾 DXF 不支援的字元
    const safe = String(text).replace(/[\x00-\x1F]/g, '');
    return `0\nTEXT\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0.0\n40\n${height}\n1\n${safe}\n`;
}

function dxfPoint(layer, x, y) {
    return `0\nPOINT\n8\n${layer}\n10\n${x}\n20\n${y}\n30\n0.0\n`;
}

// ── 計算文字插入點（線段中點偏移）───────────────────────────
function midpointOf(coords2d) {
    const mid = Math.floor(coords2d.length / 2);
    return coords2d[mid] || coords2d[0];
}

// ── 主匯出函數 ────────────────────────────────────────────────
async function exportDXF() {
    if (!currentPipeline) {
        showToast('請先選擇一個工程', 'error');
        return;
    }

    const btn = document.getElementById('dxfExportBtn');
    if (btn) { btn.textContent = '⏳ 載入中...'; btn.disabled = true; }

    try {
        // ── 1. 解析管線座標（WGS84 → TWD97）──────────────
        const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
        let branches;
        if (isMULTI) {
            branches = parseLineStringWithBranches(currentPipeline.linestring).branches;
        } else {
            branches = [{ coords: parseLineString(currentPipeline.linestring), index: 0 }];
        }

        // 把所有座標轉換為 TWD97
        const branchesTWD = branches.map(b => ({
            ...b,
            coords2d: b.coords.map(([lat, lng]) => {
                const { x, y } = wgs84ToTWD97(lat, lng);
                return [x, y];
            })
        }));

        // 計算邊界 (WGS84 for OSM query)
        const allLatLng = branches.flatMap(b => b.coords);
        const lats = allLatLng.map(c => c[0]);
        const lngs = allLatLng.map(c => c[1]);
        const osmBounds = {
            south: Math.min(...lats) - 0.002,
            north: Math.max(...lats) + 0.002,
            west:  Math.min(...lngs) - 0.002,
            east:  Math.max(...lngs) + 0.002
        };

        // TWD97 範圍（供 DXF header）
        const allXY = branchesTWD.flatMap(b => b.coords2d);
        const allX = allXY.map(p => p[0]);
        const allY = allXY.map(p => p[1]);
        let minX = Math.min(...allX), maxX = Math.max(...allX);
        let minY = Math.min(...allY), maxY = Math.max(...allY);

        // ── 2. 取得 OSM 資料 ──────────────────────────────
        if (btn) btn.textContent = '⏳ 下載街道資料...';
        let osmRoads = [], osmBuildings = [];
        try {
            const osmData = await fetchOsmData(osmBounds);
            const parsed = parseOsmResult(osmData);
            osmRoads = parsed.roads;
            osmBuildings = parsed.buildings;
        } catch (e) {
            console.warn('OSM 資料取得失敗，跳過底圖:', e.message);
            showToast('⚠️ 街道底圖載入失敗，將只輸出管線資料', 'warning', 4000);
        }

        // OSM 座標也轉換
        const roadsTWD = osmRoads.map(r => ({
            ...r,
            coords2d: r.coords.map(c => {
                const { x, y } = wgs84ToTWD97(c.lat, c.lng);
                return [x, y];
            })
        }));
        const buildingsTWD = osmBuildings.map(b => ({
            coords2d: b.coords.map(c => {
                const { x, y } = wgs84ToTWD97(c.lat, c.lng);
                return [x, y];
            })
        }));

        // 更新 extent
        [...roadsTWD, ...buildingsTWD].forEach(item => {
            item.coords2d.forEach(([x, y]) => {
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            });
        });

        // ── 3. 組裝 DXF ───────────────────────────────────
        if (btn) btn.textContent = '⏳ 產生 DXF...';

        const textHeight = Math.max((maxX - minX) / 200, 2);  // 自動文字高度
        let entities = '';

        // 建築物（BUILDING 圖層）
        buildingsTWD.forEach(b => {
            if (b.coords2d.length >= 3) {
                entities += dxfPolyline('BUILDING', b.coords2d, true);
            }
        });

        // 街道（ROAD 圖層）
        roadsTWD.forEach(r => {
            if (r.coords2d.length >= 2) {
                entities += dxfPolyline('ROAD', r.coords2d, false);
                // 道路名稱
                if (r.name) {
                    const [mx, my] = midpointOf(r.coords2d);
                    entities += dxfText('ROAD', mx, my, textHeight * 0.6, r.name);
                }
            }
        });

        // 管線路徑（PIPE 圖層）
        branchesTWD.forEach(b => {
            if (b.coords2d.length >= 2) {
                entities += dxfPolyline('PIPE', b.coords2d, false);
            }
        });

        // 段落標註（PIPE_TXT 圖層）
        if (currentPipeline.segments && currentPipeline.segments.length > 0) {
            currentPipeline.segments.forEach(seg => {
                const branch = branchesTWD[seg.branchIndex || 0];
                if (!branch) return;

                // 找中點
                const mid = Math.floor(branch.coords2d.length / 2);
                const [mx, my] = branch.coords2d[mid];

                const segLen = Math.round(seg.endDistance - seg.startDistance);
                const method = seg.method || '';
                const diameter = seg.diameter || '';
                const label = `${seg.segmentNumber}  ${diameter}${method ? ' ' + method : ''}  ${segLen}m`;
                entities += dxfText('PIPE_TXT', mx, my + textHeight * 1.5, textHeight, label);
            });
        } else {
            // 沒有段落資料：在管線中點標工程名
            branchesTWD.forEach(b => {
                const [mx, my] = midpointOf(b.coords2d);
                entities += dxfText('PIPE_TXT', mx, my + textHeight * 1.5, textHeight, currentPipeline.name);
            });
        }

        // 工作井（WELL 圖層）- 如果有 wellMarkers
        if (window.wellMarkers && window.wellMarkers.length > 0) {
            window.wellMarkers.forEach(wm => {
                const pos = wm.getLatLng ? wm.getLatLng() : null;
                if (!pos) return;
                const { x, y } = wgs84ToTWD97(pos.lat, pos.lng);
                entities += dxfPoint('WELL', x, y);
                entities += dxfText('WELL', x + textHeight * 0.5, y, textHeight * 0.8, '井');
            });
        }

        // 邊界框（BOUNDARY 圖層）
        const pad = (maxX - minX) * 0.02;
        const bx1 = minX - pad, by1 = minY - pad, bx2 = maxX + pad, by2 = maxY + pad;
        entities += dxfPolyline('BOUNDARY', [[bx1, by1], [bx2, by1], [bx2, by2], [bx1, by2]], true);

        // 工程名稱（左上角）
        entities += dxfText('PIPE_TXT', bx1, by2 + textHeight * 2, textHeight * 1.5, currentPipeline.name);
        // 座標說明
        entities += dxfText('PIPE_TXT', bx1, by1 - textHeight * 3, textHeight * 0.8, `座標系統: TWD97 TM2 (EPSG:3826)  單位: 公尺`);
        entities += dxfText('PIPE_TXT', bx1, by1 - textHeight * 5, textHeight * 0.8, `產生時間: ${new Date().toLocaleString('zh-TW')}`);

        // ── 4. 組合完整 DXF 文件 ─────────────────────────
        const dxf = [
            dxfHeader(minX - pad, minY - pad, maxX + pad, maxY + pad),
            dxfLayers(),
            '0\nSECTION\n2\nENTITIES\n',
            entities,
            '0\nENDSEC\n0\nEOF\n'
        ].join('');

        // ── 5. 下載 ───────────────────────────────────────
        const safeName = (currentPipeline.name || 'pipeline').replace(/[/\\?%*:|"<>]/g, '_');
        const blob = new Blob([dxf], { type: 'application/dxf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.dxf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        const osmCount = osmRoads.length + osmBuildings.length;
        showToast(`✅ DXF 匯出成功！（管線 + ${osmRoads.length} 條街道 + ${osmBuildings.length} 棟建物）`, 'success', 5000);

    } catch (err) {
        console.error('DXF 匯出失敗:', err);
        showToast('匯出失敗：' + err.message, 'error', 6000);
    } finally {
        if (btn) { btn.textContent = '📐 匯出DXF'; btn.disabled = false; }
    }
}
