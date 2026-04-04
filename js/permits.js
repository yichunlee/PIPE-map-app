// ========== 挖掘許可範圍功能 ==========
let permitZones = [];        // 儲存所有範圍圖層
let permitLabels = [];       // 儲存文字標籤
let permitZoneData = [];     // 儲存資料
let drawingMode = false;     // 是否在繪製模式
let drawPoints = [];         // 繪製中的點
let drawPolyline = null;     // 預覽線
let drawMarkers = [];        // 繪製中的頂點標記

window.startDrawPermitZone = function() {
    if (drawingMode) return;
    drawingMode = true;
    drawPoints = [];
    
    // 顯示提示
    showDrawHint('點擊地圖新增頂點，雙擊結束繪製');
    map.getContainer().style.cursor = 'crosshair';
    
    // 點擊加點
    map.on('click', onDrawClick);
    // 雙擊結束
    map.on('dblclick', onDrawDblClick);
};

function showDrawHint(msg) {
    let hint = document.getElementById('drawHint');
    if (!hint) {
        hint = document.createElement('div');
        hint.id = 'drawHint';
        hint.style.cssText = 'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:white;padding:10px 20px;border-radius:20px;z-index:9999;font-size:13px;pointer-events:none;';
        document.body.appendChild(hint);
    }
    hint.textContent = msg;
    hint.style.display = 'block';
}

function hideDrawHint() {
    const hint = document.getElementById('drawHint');
    if (hint) hint.style.display = 'none';
}

function onDrawClick(e) {
    if (!drawingMode) return;
    
    // 防止雙擊時觸發兩次 click
    if (e.originalEvent._dblclick) return;
    
    drawPoints.push([e.latlng.lat, e.latlng.lng]);
    
    // 畫頂點標記
    const dot = L.circleMarker([e.latlng.lat, e.latlng.lng], {
        radius: 5, fillColor: '#FF5722', color: '#fff', weight: 2, fillOpacity: 1
    }).addTo(map);
    drawMarkers.push(dot);
    
    // 更新預覽線
    if (drawPolyline) map.removeLayer(drawPolyline);
    if (drawPoints.length >= 2) {
        drawPolyline = L.polyline(drawPoints, {
            color: '#FF5722', weight: 2, dashArray: '6,4'
        }).addTo(map);
    }
    
    showDrawHint('已加入 ' + drawPoints.length + ' 個頂點，雙擊結束繪製，Esc 取消');
}

function onDrawDblClick(e) {
    if (!drawingMode) return;
    e.originalEvent._dblclick = true;
    
    // 移除最後一個多餘的點（dblclick 會觸發兩次 click）
    if (drawPoints.length > 0) drawPoints.pop();
    if (drawMarkers.length > 0) {
        map.removeLayer(drawMarkers.pop());
    }
    
    finishDrawing();
}

function finishDrawing() {
    map.off('click', onDrawClick);
    map.off('dblclick', onDrawDblClick);
    map.getContainer().style.cursor = '';
    drawingMode = false;
    hideDrawHint();
    
    // 清除預覽
    if (drawPolyline) { map.removeLayer(drawPolyline); drawPolyline = null; }
    drawMarkers.forEach(m => map.removeLayer(m));
    drawMarkers = [];
    
    if (drawPoints.length < 3) {
        showToast('至少需要 3 個頂點才能建立範圍', 'warning');
        drawPoints = [];
        return;
    }
    
    // 顯示儲存表單
    showPermitZoneForm(drawPoints.slice());
    drawPoints = [];
}

// 按 Esc 取消繪製
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && drawingMode) {
        map.off('click', onDrawClick);
        map.off('dblclick', onDrawDblClick);
        map.getContainer().style.cursor = '';
        drawingMode = false;
        hideDrawHint();
        if (drawPolyline) { map.removeLayer(drawPolyline); drawPolyline = null; }
        drawMarkers.forEach(m => map.removeLayer(m));
        drawMarkers = [];
        drawPoints = [];
    }
});

function showPermitZoneForm(points) {
    // 計算多邊形中心點
    const centerLat = points.reduce((s, p) => s + p[0], 0) / points.length;
    const centerLng = points.reduce((s, p) => s + p[1], 0) / points.length;
    
    const div = document.createElement('div');
    div.style.cssText = 'min-width:260px;';
    div.innerHTML = [
        '<div style="font-weight:bold;margin-bottom:10px;color:#c0392b;font-size:14px;">🔴 新增挖掘許可範圍</div>',
        '<div style="font-size:11px;color:#666;margin-bottom:8px;">已繪製 ' + points.length + ' 個頂點</div>',
        '<select id="pz_status" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;">',
        '<option value="applying">🔴 路權申請中</option>',
        '<option value="approved">🟢 路權已取得</option>',
        '</select>',
        '<input id="pz_permitNo" placeholder="許可證號（選填）" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;box-sizing:border-box;">',
        '<div style="font-size:11px;color:#666;margin-bottom:3px;">申請時間（選填）</div>',
        '<input id="pz_applyDate" type="date" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;box-sizing:border-box;">',
        '<div id="pz_permitPeriodLabel" style="font-size:11px;color:#666;margin-bottom:3px;">許可期間（選填）</div>',
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">',
        '<input id="pz_permitDateStart" type="date" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">',
        '<span style="color:#666;font-size:12px;">～</span>',
        '<input id="pz_permitDateEnd" type="date" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">',
        '</div>',
        '<textarea id="pz_notes" placeholder="備註（選填）" style="width:100%;height:55px;padding:8px;border:1px solid #ddd;border-radius:4px;resize:vertical;box-sizing:border-box;margin-bottom:8px;"></textarea>',
        '<input id="pz_creator" placeholder="建立者（選填）" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">'
    ].join('');
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 儲存範圍';
    saveBtn.style.cssText = 'width:100%;margin-top:8px;padding:10px;background:#c0392b;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;';
    saveBtn.onclick = function() { savePermitZone(points); };
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'width:100%;margin-top:3px;padding:5px;background:#e0e0e0;color:#666;border:none;border-radius:5px;cursor:pointer;font-size:12px;';
    cancelBtn.onclick = function() { map.closePopup(); };
    
    div.appendChild(saveBtn);
    div.appendChild(cancelBtn);
    
    L.popup().setLatLng([centerLat, centerLng]).setContent(div).openOn(map);
    
    // 監聽狀態變更，動態更新「許可期間」的必填標示
    document.getElementById('pz_status').addEventListener('change', function(e) {
        const isApproved = e.target.value === 'approved';
        document.getElementById('pz_permitPeriodLabel').textContent = '許可期間（' + (isApproved ? '必填' : '選填') + '）';
    });
}

async function savePermitZone(points) {
    if (!requireLogin()) return;
    const status = document.getElementById('pz_status').value;
    const permitNo = document.getElementById('pz_permitNo').value.trim();
    const notes = document.getElementById('pz_notes').value.trim();
    const creator = document.getElementById('pz_creator').value.trim() || '匿名';
    const pointsStr = points.map(p => p[0] + ',' + p[1]).join(';');
    
    const applyDate = document.getElementById('pz_applyDate').value;
    const permitDateStart = document.getElementById('pz_permitDateStart').value;
    const permitDateEnd = document.getElementById('pz_permitDateEnd').value;
    
    // 如果狀態是「已取得」，檢查許可期間是否填寫
    if (status === 'approved' && (!permitDateStart || !permitDateEnd)) {
        showToast('路權已取得時，許可期間為必填！', 'warning');
        return;
    }
    
    try {
        const result = await apiCall('addPermitZone', {
            pipelineId: currentPipeline.id,
            label: status === 'approved' ? '路權已取得' : '路權申請中',
            status: status, permitNo: permitNo, applyDate: applyDate,
            permitDateStart: permitDateStart, permitDateEnd: permitDateEnd,
            notes: notes, creator: creator, points: pointsStr
        }, { errorPrefix: '儲存失敗' });
        if (result.success) {
            map.closePopup();
            await loadPermitZones();
            showToast('挖掘許可範圍已儲存！', 'success');
        } else {
            showToast('儲存失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('儲存失敗：' + error.message, 'error');
    }
}

async function loadPermitZones() {
    try {
        const result = await apiCall('getPermitZones', { pipelineId: currentPipeline.id });
        if (result.zones) {
            permitZoneData = result.zones;
            displayPermitZones();
        }
    } catch (error) {
        console.error('載入挖掘許可範圍失敗:', error);
    }
}

function displayPermitZones() {
    // 清除舊圖層
    permitZones.forEach(z => map.removeLayer(z));
    permitZones = [];
    permitLabels.forEach(l => map.removeLayer(l));
    permitLabels = [];
    
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 設定為今天0點
    
    permitZoneData.forEach(zone => {
        const points = zone.points.split(';').map(p => {
            const parts = p.split(',');
            return [parseFloat(parts[0]), parseFloat(parts[1])];
        }).filter(p => !isNaN(p[0]) && !isNaN(p[1]));
        
        if (points.length < 3) return;
        
        const isApproved = zone.status === 'approved';
        let color = isApproved ? '#27ae60' : '#e74c3c';
        let statusLabel = isApproved ? '🟢 路權已取得' : '🔴 路權申請中';
        let isExpiring = false;
        
        // 檢查是否即將過期（已取得 且 距離結束日期不到14天）
        if (isApproved && zone.permitDateEnd) {
            const endDate = new Date(zone.permitDateEnd);
            endDate.setHours(0, 0, 0, 0);
            const daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
            
            if (daysRemaining <= 14 && daysRemaining >= 0) {
                color = '#FFA500'; // 橘黃色
                statusLabel = '🟡 路權即將過期';
                isExpiring = true;
            } else if (daysRemaining < 0) {
                color = '#808080'; // 灰色（已過期）
                statusLabel = '⚫ 路權已過期';
            }
        }
        
        const polygon = L.polygon(points, {
            color: color,
            weight: 2,
            fillColor: color,
            fillOpacity: 0.25,
            interactive: true,
            bubblingMouseEvents: false
        }).addTo(map);
        // 讓填色區域不攔截，只有邊框可以被點
        polygon.getElement && polygon.on('add', function() {
            const el = polygon.getElement();
            if (el) el.style.pointerEvents = 'visibleStroke';
        });
        
        const div = document.createElement('div');
        div.style.cssText = 'min-width:220px;font-size:13px;';
        div.innerHTML = [
            '<div style="font-weight:bold;color:' + color + ';margin-bottom:8px;font-size:14px;">' + statusLabel + '</div>',
            zone.permitNo ? '<div style="margin:3px 0"><b>許可證號：</b>' + zone.permitNo + '</div>' : '',
            zone.applyDate ? '<div style="margin:3px 0"><b>申請時間：</b>' + String(zone.applyDate).substring(0,10) + '</div>' : '',
            (zone.permitDateStart || zone.permitDateEnd) ? '<div style="margin:3px 0"><b>許可期間：</b>' + (zone.permitDateStart ? String(zone.permitDateStart).substring(0,10) : '') + ' ～ ' + (zone.permitDateEnd ? String(zone.permitDateEnd).substring(0,10) : '') + '</div>' : '',
            zone.notes ? '<div style="margin:3px 0;color:#666;"><b>備註：</b>' + zone.notes + '</div>' : '',
            '<div style="font-size:11px;color:#aaa;margin-top:5px;border-top:1px solid #eee;padding-top:5px;">' + (zone.creator || '') + ' · ' + (zone.timestamp || '') + '</div>'
        ].join('');
        
        const editBtn = document.createElement('button');
        editBtn.textContent = '✏️ 編輯';
        editBtn.style.cssText = 'margin-top:8px;width:100%;padding:6px;background:#2980b9;color:white;border:none;border-radius:4px;cursor:pointer;';
        editBtn.onclick = function() { showEditPermitZoneForm(zone); };
        
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️ 刪除';
        delBtn.style.cssText = 'margin-top:4px;width:100%;padding:6px;background:#e74c3c;color:white;border:none;border-radius:4px;cursor:pointer;';
        delBtn.onclick = function() { deletePermitZone(zone.id); };
        
        div.appendChild(editBtn);
        div.appendChild(delBtn);
        
        polygon.bindPopup(div);
        
        // 在多邊形中心加文字標籤
        const centerLat = points.reduce((s, p) => s + p[0], 0) / points.length;
        const centerLng = points.reduce((s, p) => s + p[1], 0) / points.length;
        const lines = [];
        // 只顯示狀態，不顯示 label
        lines.push(statusLabel);
        if (zone.applyDate) lines.push('申請：' + zone.applyDate);
        if (zone.permitDateStart || zone.permitDateEnd) lines.push('許可：' + (zone.permitDateStart || '') + '～' + (zone.permitDateEnd || ''));
        
        const labelHtml = '<div style="color:' + color + ';opacity:0.75;font-size:11px;font-weight:bold;text-align:center;white-space:nowrap;line-height:1.6;text-shadow:0 0 3px white,0 0 3px white,0 0 3px white;">' + lines.join('<br>') + '</div>';
        const labelIcon = L.divIcon({ className: '', html: labelHtml, iconAnchor: [0, 0] });
        const labelMarker = L.marker([centerLat, centerLng], { icon: labelIcon, interactive: false, zIndexOffset: -100 }).addTo(map);
        
        permitZones.push(polygon);
        permitLabels.push(labelMarker);
    });
    applyMarkerVisibility();
}

function showEditPermitZoneForm(zone) {
    const points = zone.points.split(';').map(p => { const parts = p.split(','); return [parseFloat(parts[0]), parseFloat(parts[1])]; });
    const centerLat = points.reduce((s, p) => s + p[0], 0) / points.length;
    const centerLng = points.reduce((s, p) => s + p[1], 0) / points.length;
    
    const div = document.createElement('div');
    div.style.cssText = 'min-width:260px;';
    div.innerHTML = [
        '<div style="font-weight:bold;margin-bottom:10px;color:#c0392b;font-size:14px;">✏️ 編輯挖掘許可範圍</div>',
        '<select id="pz_status" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;">',
        '<option value="applying"' + (zone.status === 'applying' ? ' selected' : '') + '>🔴 路權申請中</option>',
        '<option value="approved"' + (zone.status === 'approved' ? ' selected' : '') + '>🟢 路權已取得</option>',
        '</select>',
        '<input id="pz_permitNo" value="' + (zone.permitNo || '') + '" placeholder="許可證號（選填）" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;box-sizing:border-box;">',
        '<div style="font-size:11px;color:#666;margin-bottom:3px;">申請時間（選填）</div>',
        '<input id="pz_applyDate" type="date" value="' + (zone.applyDate || '') + '" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;margin-bottom:8px;box-sizing:border-box;">',
        '<div id="pz_permitPeriodLabel" style="font-size:11px;color:#666;margin-bottom:3px;">許可期間（' + (zone.status === 'approved' ? '必填' : '選填') + '）</div>',
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">',
        '<input id="pz_permitDateStart" type="date" value="' + (zone.permitDateStart || '') + '" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">',
        '<span style="color:#666;font-size:12px;">～</span>',
        '<input id="pz_permitDateEnd" type="date" value="' + (zone.permitDateEnd || '') + '" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">',
        '</div>',
        '<textarea id="pz_notes" style="width:100%;height:55px;padding:8px;border:1px solid #ddd;border-radius:4px;resize:vertical;box-sizing:border-box;margin-bottom:8px;">' + (zone.notes || '') + '</textarea>',
        '<input id="pz_creator" value="' + (zone.creator || '') + '" placeholder="建立者（選填）" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;">'
    ].join('');
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 儲存修改';
    saveBtn.style.cssText = 'width:100%;margin-top:8px;padding:10px;background:#c0392b;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;';
    saveBtn.onclick = function() { updatePermitZone(zone.id); };
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'width:100%;margin-top:3px;padding:5px;background:#e0e0e0;color:#666;border:none;border-radius:5px;cursor:pointer;font-size:12px;';
    cancelBtn.onclick = function() { map.closePopup(); };
    
    div.appendChild(saveBtn);
    div.appendChild(cancelBtn);
    
    L.popup().setLatLng([centerLat, centerLng]).setContent(div).openOn(map);
    
    // 監聽狀態變更，動態更新「許可期間」的必填標示
    document.getElementById('pz_status').addEventListener('change', function(e) {
        const isApproved = e.target.value === 'approved';
        document.getElementById('pz_permitPeriodLabel').textContent = '許可期間（' + (isApproved ? '必填' : '選填') + '）';
    });
}

async function updatePermitZone(zoneId) {
    if (!requireLogin()) return;
    const status = document.getElementById('pz_status').value;
    const permitDateStart = document.getElementById('pz_permitDateStart').value;
    const permitDateEnd = document.getElementById('pz_permitDateEnd').value;
    
    // 如果狀態是「已取得」，檢查許可期間是否填寫
    if (status === 'approved' && (!permitDateStart || !permitDateEnd)) {
        showToast('路權已取得時，許可期間為必填！', 'warning');
        return;
    }
    
    try {
        const result = await apiCall('updatePermitZone', {
            zoneId: zoneId,
            label: status === 'approved' ? '路權已取得' : '路權申請中',
            status: status,
            permitNo: document.getElementById('pz_permitNo').value,
            applyDate: document.getElementById('pz_applyDate').value,
            permitDateStart: permitDateStart, permitDateEnd: permitDateEnd,
            notes: document.getElementById('pz_notes').value,
            creator: document.getElementById('pz_creator').value || '匿名'
        }, { raw: true });
        if (result.success) { map.closePopup(); await loadPermitZones(); }
        else showToast('更新失敗：' + (result.error || '未知錯誤'), 'error');
    } catch (error) { showToast('更新失敗：' + error.message, 'error'); }
}

async function deletePermitZone(zoneId) {
    if (!requireLogin()) return;
    if (!await showConfirm({ title: '刪除範圍', message: '確定要刪除這個路權範圍嗎？', okText: '刪除', danger: true })) return;
    try {
        const result = await apiCall('deletePermitZone', { zoneId: zoneId });
        if (result.success) { map.closePopup(); await loadPermitZones(); }
        else showToast('刪除失敗：' + (result.error || '未知錯誤'), 'error');
    } catch (error) { showToast('刪除失敗：' + error.message, 'error'); }
}
let allMarkersVisible = true;

window.toggleAllMarkers = function() {
    allMarkersVisible = !allMarkersVisible;
    applyMarkerVisibility();
};

function applyMarkerVisibility() {
    const btn = document.getElementById('permitZoneButton');
    if (!btn) return;
    if (allMarkersVisible) {
        noteMarkers.forEach(m => map.addLayer(m));
        panelMarkers.forEach(m => map.addLayer(m));
        shaftMarkers.forEach(m => map.addLayer(m));
        permitZones.forEach(z => map.addLayer(z));
        permitLabels.forEach(l => map.addLayer(l));
        segmentLabels.forEach(l => map.addLayer(l.marker || l)); // 顯示段落標籤
        btn.classList.remove('hidden-markers');
        btn.textContent = '👁️';
        btn.title = '隱藏所有標記（備註/配電盤/工作井/挖掘範圍/段落標籤）';
    } else {
        noteMarkers.forEach(m => map.removeLayer(m));
        panelMarkers.forEach(m => map.removeLayer(m));
        shaftMarkers.forEach(m => map.removeLayer(m));
        permitZones.forEach(z => map.removeLayer(z));
        permitLabels.forEach(l => map.removeLayer(l));
        segmentLabels.forEach(l => map.removeLayer(l.marker || l)); // 隱藏段落標籤
        btn.classList.add('hidden-markers');
        btn.textContent = '🙈';
        btn.title = '顯示所有標記（備註/配電盤/工作井/挖掘範圍/段落標籤）';
    }
}

// ========== 挖掘許可範圍功能結束 ==========


