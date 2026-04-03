// ========== 台中市挖掘許可功能 ==========
let roadworkMarkers = [];
let roadworkVisible = false;
let roadworkData = [];

async function loadRoadworkData() {
    try {
        document.getElementById('roadworkCount').textContent = '載入中...';
        const result = await apiCall('getTaichungRoadwork');
        if (result.success && result.data) {
            roadworkData = result.data;
            document.getElementById('roadworkCount').textContent = '共 ' + roadworkData.length + ' 筆許可';
            if (roadworkVisible) displayRoadworkMarkers();
        } else {
            document.getElementById('roadworkCount').textContent = '載入失敗，請先更新資料';
        }
    } catch (error) {
        document.getElementById('roadworkCount').textContent = '載入失敗';
        console.error('載入挖掘許可失敗:', error);
    }
}

// 解析 POLYGON (( lng lat, lng lat, ... )) 格式
function parsePolygon(polygonStr) {
    if (!polygonStr) return null;
    const match = polygonStr.match(/POLYGON\s*\(\(\s*([^)]+)\)\)/i);
    if (!match) return null;
    const coords = match[1].trim().split(',').map(pair => {
        const parts = pair.trim().split(/\s+/);
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        return [lat, lng];
    }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
    return coords.length >= 3 ? coords : null;
}

function displayRoadworkMarkers() {
    roadworkMarkers.forEach(m => map.removeLayer(m));
    roadworkMarkers = [];
    
    roadworkData.forEach(work => {
        const lat = parseFloat(work['緯度']);
        const lng = parseFloat(work['經度']);
        const polygonCoords = parsePolygon(work['施工範圍坐標']);
        
        const popupContent =
            '<div style="min-width:220px; font-size:12px;">' +
            '<div style="font-weight:bold; color:#FF5722; margin-bottom:6px;">🚧 挖掘許可</div>' +
            '<div style="margin:3px 0;"><b>地點：</b>' + (work['地點'] || '-') + '</div>' +
            '<div style="margin:3px 0;"><b>工程名稱：</b>' + (work['工程名稱'] || '-') + '</div>' +
            '<div style="margin:3px 0;"><b>申請單位：</b>' + (work['申請單位'] || '-') + '</div>' +
            '<div style="margin:3px 0; color:#666;"><b>許可證：</b>' + (work['許可證編號'] || '-') + '</div>' +
            '<div style="margin:3px 0; color:#666;"><b>核准期間：</b>' + (work['核准起日期'] || '') + ' ~ ' + (work['核准迄日期'] || '') + '</div>' +
            '</div>';
        
        // 有 POLYGON 就畫範圍，沒有就畫圓點
        if (polygonCoords) {
            const polygon = L.polygon(polygonCoords, {
                color: '#FF5722',
                weight: 2,
                fillColor: '#FF5722',
                fillOpacity: 0.3
            }).addTo(map);
            polygon.bindPopup(popupContent);
            roadworkMarkers.push(polygon);
        } else if (!isNaN(lat) && !isNaN(lng) && lat && lng) {
            const marker = L.circleMarker([lat, lng], {
                radius: 8,
                fillColor: '#FF5722',
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.85
            }).addTo(map);
            marker.bindPopup(popupContent);
            roadworkMarkers.push(marker);
        }
    });
}

function clearRoadworkMarkers() {
    roadworkMarkers.forEach(m => map.removeLayer(m));
    roadworkMarkers = [];
}


        function toggleRoadworkLayer() {
    const btn = document.getElementById('roadworkButton');
    const panel = document.getElementById('roadworkPanel');
    roadworkVisible = !roadworkVisible;
    if (roadworkVisible) {
        btn.classList.add('active');
        panel.style.display = 'block';
        if (roadworkData.length === 0) {
            loadRoadworkData();
        } else {
            displayRoadworkMarkers();
        }
    } else {
        btn.classList.remove('active');
        panel.style.display = 'none';
        clearRoadworkMarkers();
    }
}

async function updateRoadworkData() {
    const btn = event.target;
    btn.textContent = '更新中...';
    btn.disabled = true;
    try {
        const result = await apiCall('updateTaichungRoadwork');
        if (result.success) {
            document.getElementById('roadworkCount').textContent = '更新成功，重新載入中...';
            await loadRoadworkData();
            showToast('已更新 ' + result.count + ' 筆台中市挖掘許可資料', 'success');
        } else {
            showToast('更新失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('更新失敗：' + error.message, 'error');
    } finally {
        btn.textContent = '🔄 更新資料';
        btn.disabled = false;
    }
}
// ========== 台中市挖掘許可功能結束 ==========
