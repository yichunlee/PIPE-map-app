// ========== 工作井功能 ==========
let shaftMarkers = [];
let shaftData = [];

const SHAFT_TYPES = ['推進坑', '到達坑', '推進兼到達坑'];
const SHAFT_STATUS = ['路權取得中', '開挖中', '擋土支撐施工', '底版澆置', '反力牆構築', '設備安裝與進場準備', '推進作業中', '上引段銜接', '工作井回填', '完工'];

window.loadShafts = async function() {
    try {
        const response = await fetch(API_URL + '?action=getShafts&pipelineId=' + encodeURIComponent(currentPipeline.id));
        const result = await response.json();
        if (result.shafts) {
            shaftData = result.shafts;
            displayShafts();
        }
    } catch (error) {
        console.error('載入工作井失敗:', error);
    }
}

window.displayShafts = function() {
    shaftMarkers.forEach(m => map.removeLayer(m));
    shaftMarkers = [];
    
    shaftData.forEach(shaft => {
        const lat = parseFloat(shaft.lat);
        const lng = parseFloat(shaft.lng);
        if (isNaN(lat) || isNaN(lng)) return;
        
        const progress = shaft.designDepth > 0 ? Math.min(100, Math.round((shaft.currentDepth / shaft.designDepth) * 100)) : 0;
        const color = shaft.type === '推進坑' ? '#1565C0' : shaft.type === '到達坑' ? '#6A1B9A' : '#00695C';
        
        const shaftLabel = shaft.type === '推進坑' ? '推' : shaft.type === '到達坑' ? '到' : '兼';
        const icon = L.divIcon({
            className: 'note-marker-custom',
            html: '<div style="background:' + color + ';color:white;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;box-shadow:0 2px 5px rgba(0,0,0,0.3);border:2px solid white;cursor:pointer;">' + shaftLabel + '</div>',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
            popupAnchor: [0, -13]
        });
        
        const marker = L.marker([lat, lng], { icon }).addTo(map);
        marker.bindPopup(buildShaftPopup(shaft, progress, color));
        shaftMarkers.push(marker);
    });
    applyMarkerVisibility();
}

function buildShaftPopup(shaft, progress, color) {
    // 用 DOM 方式建立，避免引號衝突
    const div = document.createElement('div');
    div.style.cssText = 'min-width:240px;font-size:13px;';
    div.innerHTML = [
        '<div style="font-weight:bold;color:' + color + ';margin-bottom:8px;font-size:14px;">🕳️ ' + escapeHtml(shaft.name || '工作井') + '</div>',
        '<div style="margin:4px 0"><b>類型：</b>' + escapeHtml(shaft.type || '-') + '</div>',
        '<div style="margin:4px 0"><b>設計深度：</b>' + escapeHtml(shaft.designDepth || '-') + ' m</div>',
        '<div style="margin:4px 0"><b>目前開挖深度：</b>' + escapeHtml(shaft.currentDepth || '0') + ' m</div>',
        '<div style="margin:6px 0">',
        '<div style="font-size:11px;color:#666;margin-bottom:3px;">開挖進度 ' + progress + '%</div>',
        '<div style="background:#eee;border-radius:4px;height:8px;overflow:hidden;">',
        '<div style="background:' + color + ';width:' + progress + '%;height:100%;border-radius:4px;"></div></div></div>',
        '<div style="margin:4px 0"><b>施工狀況：</b><span style="background:#e3f2fd;padding:2px 8px;border-radius:10px;font-size:11px;">' + escapeHtml(shaft.status || '-') + '</span></div>',
        shaft.notes ? '<div style="margin:4px 0;color:#666;font-size:12px"><b>備註：</b>' + escapeHtml(shaft.notes) + '</div>' : '',
        '<div style="font-size:11px;color:#aaa;margin-top:6px;border-top:1px solid #eee;padding-top:5px;">' + escapeHtml(shaft.creator || '') + ' · ' + escapeHtml(shaft.timestamp || '') + '</div>'
    ].join('');
    
    const editBtn = document.createElement('button');
    editBtn.textContent = '✏️ 編輯';
    editBtn.style.cssText = 'margin-top:8px;width:100%;padding:6px;background:#1976D2;color:white;border:none;border-radius:4px;cursor:pointer;';
    editBtn.onclick = function() { showEditShaftPopup(shaft.id); };
    
    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑️ 刪除';
    delBtn.style.cssText = 'margin-top:4px;width:100%;padding:6px;background:#f44336;color:white;border:none;border-radius:4px;cursor:pointer;';
    delBtn.onclick = function() { deleteShaft(shaft.id); };
    
    div.appendChild(editBtn);
    div.appendChild(delBtn);
    return div;
}

function buildShaftForm(lat, lng, shaft) {
    const isEdit = shaft !== null;
    const div = document.createElement('div');
    div.style.cssText = 'min-width:220px;max-width:280px;';
    
    const title = isEdit ? '編輯工作井' : '新增工作井';
    const typeOptions = SHAFT_TYPES.map(t =>
        '<option value="' + t + '"' + (isEdit && shaft.type === t ? ' selected' : '') + '>' + t + '</option>'
    ).join('');
    const statusOptions = SHAFT_STATUS.map(s =>
        '<option value="' + s + '"' + (isEdit && shaft.status === s ? ' selected' : '') + '>' + s + '</option>'
    ).join('');
    
    div.innerHTML = [
        '<div style="font-weight:bold;margin-bottom:10px;color:#1565C0;font-size:14px;">🕳️ ' + title + '</div>',
        '<input id="sf_name" placeholder="名稱（如：第1推進坑）" value="' + escapeHtml(isEdit ? (shaft.name || '') : '') + '" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px;box-sizing:border-box;">',
        '<select id="sf_type" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px;">' + typeOptions + '</select>',
        '<div style="display:flex;gap:6px;margin-bottom:6px;">',
        '<div style="flex:1"><div style="font-size:11px;color:#666;margin-bottom:3px;">設計深度 [m]</div><input id="sf_designDepth" type="number" placeholder="0" value="' + escapeHtml(isEdit ? (shaft.designDepth || '') : '') + '" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;"></div>',
        '<div style="flex:1"><div style="font-size:11px;color:#666;margin-bottom:3px;">目前開挖深度 [m]</div><input id="sf_currentDepth" type="number" placeholder="0" value="' + escapeHtml(isEdit ? (shaft.currentDepth || '') : '') + '" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;"></div>',
        '</div>',
        '<select id="sf_status" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:4px;margin-bottom:6px;">' + statusOptions + '</select>',
        '<textarea id="sf_notes" placeholder="備註（選填）" style="width:100%;height:60px;padding:7px;border:1px solid #ddd;border-radius:4px;resize:vertical;box-sizing:border-box;">' + escapeHtml(isEdit ? (shaft.notes || '') : '') + '</textarea>',
        '<input id="sf_creator" placeholder="建立者（選填）" value="' + escapeHtml(isEdit ? (shaft.creator || '') : '') + '" style="width:100%;padding:7px;border:1px solid #ddd;border-radius:4px;margin-top:6px;box-sizing:border-box;">'
    ].join('');
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 ' + (isEdit ? '儲存修改' : '新增工作井');
    saveBtn.style.cssText = 'width:100%;margin-top:8px;padding:10px;background:#1565C0;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;';
    saveBtn.onclick = isEdit ? function() { saveEditShaft(shaft.id); } : function() { saveNewShaft(lat, lng); };
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'width:100%;margin-top:3px;padding:5px;background:#e0e0e0;color:#666;border:none;border-radius:5px;cursor:pointer;font-size:12px;';
    cancelBtn.onclick = function() { map.closePopup(); };
    
    div.appendChild(saveBtn);
    div.appendChild(cancelBtn);
    return div;
}

window.showAddShaftPopup = function(lat, lng) {
    const popup = L.popup()
        .setLatLng([lat, lng])
        .setContent(buildShaftForm(lat, lng, null))
        .openOn(map);
};

window.saveNewShaft = async function(lat, lng) {
    if (!requireLogin()) return;
    const name = document.getElementById('sf_name').value.trim();
    if (!name) { showToast('請輸入名稱', 'warning'); return; }
    const payload = {
        action: 'addShaft',
        pipelineId: currentPipeline.id,
        lat, lng,
        name,
        type: document.getElementById('sf_type').value,
        designDepth: document.getElementById('sf_designDepth').value || '0',
        currentDepth: document.getElementById('sf_currentDepth').value || '0',
        status: document.getElementById('sf_status').value,
        notes: document.getElementById('sf_notes').value,
        creator: document.getElementById('sf_creator').value || '匿名'
    };
    try {
        const qs = '?action=addShaft&pipelineId=' + encodeURIComponent(payload.pipelineId) +
            '&lat=' + lat + '&lng=' + lng +
            '&name=' + encodeURIComponent(payload.name) +
            '&type=' + encodeURIComponent(payload.type) +
            '&designDepth=' + encodeURIComponent(payload.designDepth) +
            '&currentDepth=' + encodeURIComponent(payload.currentDepth) +
            '&status=' + encodeURIComponent(payload.status) +
            '&notes=' + encodeURIComponent(payload.notes) +
            '&creator=' + encodeURIComponent(payload.creator);
        const response = await fetch(API_URL + qs);
        const result = await response.json();
        if (result.success) {
            map.closePopup();
            await loadShafts();
            showToast('工作井已新增！', 'success');
        } else {
            showToast('新增失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('新增失敗：' + error.message, 'error');
    }
}

window.showEditShaftPopup = function(shaftId) {
    const shaft = shaftData.find(s => s.id === shaftId);
    if (!shaft) return;
    L.popup()
        .setLatLng([parseFloat(shaft.lat), parseFloat(shaft.lng)])
        .setContent(buildShaftForm(shaft.lat, shaft.lng, shaft))
        .openOn(map);
};

window.saveEditShaft = async function(shaftId) {
    if (!requireLogin()) return;
    const name = document.getElementById('sf_name').value.trim();
    if (!name) { showToast('請輸入名稱', 'warning'); return; }
    const qs = '?action=updateShaft&shaftId=' + encodeURIComponent(shaftId) +
        '&name=' + encodeURIComponent(name) +
        '&type=' + encodeURIComponent(document.getElementById('sf_type').value) +
        '&designDepth=' + encodeURIComponent(document.getElementById('sf_designDepth').value || '0') +
        '&currentDepth=' + encodeURIComponent(document.getElementById('sf_currentDepth').value || '0') +
        '&status=' + encodeURIComponent(document.getElementById('sf_status').value) +
        '&notes=' + encodeURIComponent(document.getElementById('sf_notes').value) +
        '&creator=' + encodeURIComponent(document.getElementById('sf_creator').value || '匿名');
    try {
        const response = await fetch(API_URL + qs);
        const result = await response.json();
        if (result.success) {
            map.closePopup();
            await loadShafts();
            showToast('工作井已更新！', 'success');
        } else {
            showToast('更新失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('更新失敗：' + error.message, 'error');
    }
};

window.deleteShaft = async function(shaftId) {
    if (!requireLogin()) return;
    if (!await showConfirm({ title: '刪除工作井', message: '確定要刪除這個工作井嗎？', okText: '刪除', danger: true })) return;
    try {
        const response = await fetch(API_URL + '?action=deleteShaft&shaftId=' + encodeURIComponent(shaftId));
        const result = await response.json();
        if (result.success) {
            map.closePopup();
            await loadShafts();
            showToast('工作井已刪除！', 'success');
        } else {
            showToast('刪除失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('刪除失敗：' + error.message, 'error');
    }
};
// ========== 工作井功能結束 ==========
