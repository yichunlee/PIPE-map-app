// ========== WGIS 管線底圖功能 ==========
// wgisDatasets = [{ id(driveId), name, lines, polylines, visible, loaded }]
window.wgisDatasets = [];
let wgisCloudFiles = [];  // Drive 上的檔案清單

// ── 雲端檔案清單 ──
async function refreshWgisFileList() {
    const info = document.getElementById('wgisInfo');
    info.textContent = '⏳ 載入雲端清單...';
    try {
        const data = await apiCall('listWgisFiles');
        if (!data.success) throw new Error(data.error);
        wgisCloudFiles = data.files || [];
        info.textContent = wgisCloudFiles.length === 0 ? '尚無雲端檔案，請上傳 CSV' : '';
        renderWgisFileList();
    } catch(e) {
        info.textContent = '❌ 載入失敗：' + e.message;
    }
}

function renderWgisFileList() {
    const list = document.getElementById('wgisFileList');
    if (wgisCloudFiles.length === 0) { list.innerHTML = ''; return; }

    const isSupervisor = currentUser && (currentUser.role === 'supervisor' || currentUser.role === 'admin');

    list.innerHTML = wgisCloudFiles.map(f => {
        const ds = wgisDatasets.find(d => d.id === f.id);
        const isVisible = ds ? ds.visible : false;
        const isLoaded  = ds ? ds.loaded  : false;
        const sizeKb = (f.size / 1024).toFixed(0);
        return `<div class="wgis-file-item ${isVisible ? 'active' : ''}" onclick="toggleWgisDataset('${f.id}','${escapeHtml(f.name)}')">
            <input type="checkbox" ${isVisible ? 'checked' : ''} onclick="event.stopPropagation();toggleWgisDataset('${f.id}','${escapeHtml(f.name)}')">
            <span class="wgis-file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <span class="wgis-file-count">${sizeKb}KB</span>
            ${isSupervisor ? `<span class="wgis-file-del" title="刪除" onclick="event.stopPropagation();deleteWgisCloudFile('${f.id}','${escapeHtml(f.name)}')">✕</span>` : ''}
        </div>`;
    }).join('');

    document.getElementById('layerSwitchButton').classList.toggle('active', wgisDatasets.some(d=>d.visible) || document.getElementById('layerPanel').classList.contains('show'));
}

// escapeHtml() 已定義於上方（第 1655 行）

// ── 勾選/取消勾選某檔案 ──
async function toggleWgisDataset(fileId, fileName) {
    let ds = wgisDatasets.find(d => d.id === fileId);
    if (!ds) {
        // 首次選取：從 Drive 下載並解析
        ds = { id: fileId, name: fileName, lines: [], polylines: [], visible: false, loaded: false };
        wgisDatasets.push(ds);
    }
    if (!ds.loaded) {
        // 下載並解析
        const info = document.getElementById('wgisInfo');
        info.textContent = '⏳ 下載「' + fileName + '」...';
        try {
            const data = await apiCall('getWgisFile');
            if (!data.success) throw new Error(data.error);
            // base64 → Big5 bytes → text
            const binaryStr = atob(data.data);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
            const text = new TextDecoder('big5').decode(bytes);
            ds.lines = parseWgisCsv(text);
            ds.loaded = true;
            info.textContent = '✅ 已載入「' + fileName + '」' + ds.lines.length + ' 條管線';
        } catch(e) {
            const idx = wgisDatasets.indexOf(ds);
            if (idx >= 0) wgisDatasets.splice(idx, 1);
            document.getElementById('wgisInfo').textContent = '❌ 下載失敗：' + e.message;
            return;
        }
    }
    setWgisVisible(fileId, !ds.visible);
}

function setWgisVisible(fileId, visible) {
    const ds = wgisDatasets.find(d => d.id === fileId);
    if (!ds) return;
    if (visible && ds.polylines.length === 0 && ds.lines.length > 0) {
        ds.polylines = ds.lines.map(seg => {
            const tooltip = [
                seg.d ? '管徑: ' + seg.d + 'mm' : '',
                seg.m ? '管材: ' + seg.m : '',
                seg.l ? '長度: ' + parseFloat(seg.l||0).toFixed(1) + 'm' : ''
            ].filter(Boolean).join(' | ');
            const pl = L.polyline(seg.coords, { color: '#212121', weight: 3, opacity: 0.75, interactive: !!tooltip });
            if (tooltip) pl.bindTooltip(tooltip, { sticky: true, className: 'wgis-tooltip' });
            pl.addTo(map);
            return pl;
        });
        ds.visible = true;
    } else if (!visible) {
        ds.polylines.forEach(pl => map.removeLayer(pl));
        ds.polylines = [];
        ds.visible = false;
    }
    renderWgisFileList();
}

// ── 上傳 CSV 到 Drive ──
function loadWgisFile(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = '';
    if (!currentUser || (currentUser.role !== 'supervisor' && currentUser.role !== 'admin')) {
        showToast('需要監造單位以上權限才能上傳', 'warning');
        return;
    }
    const info = document.getElementById('wgisInfo');
    info.textContent = '⏳ 上傳中...';
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const bytes = new Uint8Array(e.target.result);
            // base64 encode
            let binary = '';
            bytes.forEach(b => binary += String.fromCharCode(b));
            const base64 = btoa(binary);
            const data = await apiCall('uploadWgisFile', {}, {
                body: { fileName: file.name, data: base64, email: currentUser ? currentUser.email : '' }
            });
            showToast('✅ 已上傳「' + file.name + '」', 'success');
            await refreshWgisFileList();
            // 自動勾選剛上傳的
            await toggleWgisDataset(data.id, data.name);
        } catch(e) {
            info.textContent = '❌ 上傳失敗：' + e.message;
        }
    };
    reader.readAsArrayBuffer(file);
}

// ── 刪除雲端檔案 ──
async function deleteWgisCloudFile(fileId, fileName) {
    if (!await showConfirm({ title: '刪除 WGIS 檔案', message: '刪除「' + fileName + '」？', okText: '刪除', danger: true })) return;
    try {
        // 先從地圖移除
        const ds = wgisDatasets.find(d => d.id === fileId);
        if (ds) { ds.polylines.forEach(pl => map.removeLayer(pl)); wgisDatasets.splice(wgisDatasets.indexOf(ds), 1); }
        const data = await apiCall('deleteWgisFile', { email: currentUser ? currentUser.email : '' });
        if (!data.success) throw new Error(data.error);
        showToast('已刪除「' + fileName + '」', 'success');
        await refreshWgisFileList();
    } catch(e) {
        showToast('刪除失敗：' + e.message, 'error');
    }
}

// ── CSV 解析（Big5 已解碼為 JS string）──
function parseWgisCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return [];
    const headers = parseCSVLine(lines[0]);
    // 同時支援兩種格式：
    // 格式A（舊）：端點1_x, 端點1_y, 端點2_x, 端點2_y
    // 格式B（新）：座標x1, 座標y1, 座標x2, 座標y2
    function findIdx(tests) {
        for (const fn of tests) {
            const i = headers.findIndex(fn);
            if (i >= 0) return i;
        }
        return -1;
    }
    const fx1 = findIdx([h => h.includes('端點1') && h.toLowerCase().includes('x'), h => /座標x1/i.test(h)]);
    const fy1 = findIdx([h => h.includes('端點1') && h.toLowerCase().includes('y'), h => /座標y1/i.test(h)]);
    const fx2 = findIdx([h => h.includes('端點2') && h.toLowerCase().includes('x'), h => /座標x2/i.test(h)]);
    const fy2 = findIdx([h => h.includes('端點2') && h.toLowerCase().includes('y'), h => /座標y2/i.test(h)]);
    const di  = headers.findIndex(h => h.includes('管徑寬度'));
    const mi  = headers.findIndex(h => h.includes('管種材料'));
    const li  = headers.findIndex(h => h.includes('管線長度'));
    if (fx1<0||fy1<0||fx2<0||fy2<0) throw new Error('找不到 TWD97 座標欄位');
    const result = [];
    for (let i = 1; i < lines.length; i++) {
        try {
            const cols = parseCSVLine(lines[i]);
            const x1 = parseFloat(cols[fx1]), y1 = parseFloat(cols[fy1]);
            const x2 = parseFloat(cols[fx2]), y2 = parseFloat(cols[fy2]);
            if (isNaN(x1)||isNaN(y1)||isNaN(x2)||isNaN(y2)) continue;
            const [lat1,lon1] = twd97ToWgs84(x1, y1);
            const [lat2,lon2] = twd97ToWgs84(x2, y2);
            result.push({ coords:[[lat1,lon1],[lat2,lon2]], d:di>=0?cols[di]||'':'', m:mi>=0?cols[mi]||'':'', l:li>=0?cols[li]||'':'' });
        } catch(e) {}
    }
    return result;
}

function parseCSVLine(line) {
    const result = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
        else { cur += ch; }
    }
    result.push(cur.trim());
    return result;
}

function twd97ToWgs84(x, y) {
    const a = 6378137.0, f = 1/298.257222101;
    const e2 = 2*f - f*f, k0 = 0.9999, dx = 250000;
    const lon0 = Math.PI/180*121;
    x = x - dx;
    const e4 = e2*e2, e6 = e2*e2*e2;
    const M = y/k0;
    const mu = M/(a*(1 - e2/4 - 3*e4/64 - 5*e6/256));
    const e1 = (1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
    const fp = mu + (3*e1/2-27*e1*e1*e1/32)*Math.sin(2*mu)
                  + (21*e1*e1/16-55*e1*e1*e1*e1/32)*Math.sin(4*mu)
                  + (151*e1*e1*e1/96)*Math.sin(6*mu)
                  + (1097*e1*e1*e1*e1/512)*Math.sin(8*mu);
    const e1sq = e2/(1-e2), C1 = e1sq*Math.cos(fp)*Math.cos(fp), T1 = Math.tan(fp)*Math.tan(fp);
    const R1 = a*(1-e2)/Math.pow(1-e2*Math.sin(fp)*Math.sin(fp),1.5);
    const N1 = a/Math.sqrt(1-e2*Math.sin(fp)*Math.sin(fp));
    const D = x/(N1*k0), Q1 = N1*Math.tan(fp)/R1;
    const lat = fp - Q1*(D*D/2 - (5+3*T1+10*C1-4*C1*C1-9*e1sq)*D*D*D*D/24 + (61+90*T1+298*C1+45*T1*T1-3*C1*C1-252*e1sq)*D*D*D*D*D*D/720);
    const lon = lon0 + (D - (1+2*T1+C1)*D*D*D/6 + (5-2*C1+28*T1-3*C1*C1+8*e1sq+24*T1*T1)*D*D*D*D*D/120)/Math.cos(fp);
    return [lat*180/Math.PI, lon*180/Math.PI];
}
// ========== WGIS 管線底圖功能結束 ==========
