// ========== 配電盤/儀表箱功能 ==========
let panelMarkers = [];
let panelData = [];

// 載入配電盤標記
async function loadPanels() {
    try {
        console.log('🔌 開始載入配電盤標記...');
        let url = API_URL + '?action=getPanels';
        if (currentPipeline && currentPipeline.id) {
            url += '&pipelineId=' + encodeURIComponent(currentPipeline.id);
            console.log('當前工程ID:', currentPipeline.id);
        }
        
        const response = await fetch(url);
        const result = await response.json();
        
        console.log('配電盤 API 回應:', result);
        
        if (result.panels) {
            panelData = result.panels;
            console.log('✅ 載入配電盤數量:', panelData.length);
            panelData.forEach(p => {
                console.log('  - 配電盤:', p.id, '工程:', p.pipelineId, '照片:', p.photo ? '有' : '無');
            });
            displayPanels();
        } else if (result.error) {
            console.error('❌ 載入配電盤失敗:', result.error);
        } else {
            console.warn('⚠️ API 回應格式異常:', result);
        }
    } catch (error) {
        console.error('❌ 載入配電盤標記失敗:', error);
    }
}

// 顯示配電盤標記
function displayPanels() {
    panelMarkers.forEach(marker => map.removeLayer(marker));
    panelMarkers = [];
    
    if (!currentPipeline || !currentPipeline.id) {
        return;
    }
    
    console.log('📍 顯示配電盤標記，數量:', panelData.length);
    
    panelData.forEach(panel => {
        // 前端二次過濾
        if (panel.pipelineId && panel.pipelineId !== currentPipeline.id) {
            return;
        }
        
        // 處理經緯度（後端可能回傳 lat/lng 或 lat/lon）
        const lat = panel.lat || panel.latitude;
        const lng = panel.lng || panel.lon || panel.longitude;
        
        console.log('配電盤資料:', {
            id: panel.id,
            lat: lat,
            lng: lng,
            photo: panel.photo,
            text: panel.text
        });
        
        if (!lat || !lng) {
            console.warn('❌ 配電盤座標不完整:', panel);
            return;
        }
        
        const marker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'panel-marker-custom',
                html: `
                    <div style="
                        background: #4CAF50; 
                        color: white; 
                        width: 20px; 
                        height: 20px; 
                        border-radius: 3px; 
                        display: flex; 
                        align-items: center; 
                        justify-content: center; 
                        font-size: 11px; 
                        box-shadow: 0 2px 5px rgba(0,0,0,0.3); 
                        border: 2px solid white;
                        cursor: pointer;
                    ">🔌</div>
                `,
                iconSize: [20, 20],
                iconAnchor: [10, 10],
                popupAnchor: [0, -12]
            })
        }).addTo(map);
        
        // 轉換 Google Drive 連結為可嵌入的圖片 URL
        let photoUrl = '';
        if (panel.photo) {
            console.log('原始照片連結:', panel.photo);
            
            if (panel.photo.includes('drive.google.com/file/d/') || panel.photo.includes('drive.google.com/uc?')) {
                // Google Drive 連結格式
                let fileId = '';
                
                // 提取 FILE_ID
                const fileIdMatch1 = panel.photo.match(/\/d\/([^\/]+)/);
                const fileIdMatch2 = panel.photo.match(/id=([^&]+)/);
                
                if (fileIdMatch1) {
                    fileId = fileIdMatch1[1];
                } else if (fileIdMatch2) {
                    fileId = fileIdMatch2[1];
                }
                
                if (fileId) {
                    // 使用 Google Drive 縮圖 API（更可靠）
                    photoUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
                    console.log('✅ 使用縮圖 API:', photoUrl);
                }
            } else if (panel.photo.includes('drive.google.com/open?id=')) {
                // 另一種 Google Drive 格式
                const fileIdMatch = panel.photo.match(/id=([^&]+)/);
                if (fileIdMatch) {
                    const fileId = fileIdMatch[1];
                    photoUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`;
                    console.log('✅ 使用縮圖 API:', photoUrl);
                }
            } else if (panel.photo.startsWith('http')) {
                // 其他 HTTP 連結直接使用
                photoUrl = panel.photo;
                console.log('📷 使用原始 HTTP 連結');
            } else if (panel.photo.startsWith('data:image')) {
                // Base64 圖片直接使用
                photoUrl = panel.photo;
                console.log('📷 使用 Base64 圖片');
            }
        } else {
            console.log('⚠️ 沒有照片');
        }
        
        // 懸停預覽照片
        if (photoUrl) {
            marker.on('mouseover', function(e) {
                showPhotoPreview(e, photoUrl, '🔌 配電盤');
            });
            marker.on('mouseout', function() {
                hidePhotoPreview();
            });
        }
        
        marker.bindPopup(`
            <div style="min-width: 240px; max-width: 300px;" id="panel-popup-${panel.id}">
                <div style="font-weight: bold; margin-bottom: 8px; color: #4CAF50;">🔌 配電盤/儀表箱</div>
                ${photoUrl ? `<img src="${photoUrl}" onclick="window.open('${photoUrl}', '_blank')" style="width: 100%; max-height: 200px; object-fit: cover; border-radius: 4px; margin-bottom: 8px; border: 1px solid #ddd; cursor: pointer;" title="點擊放大查看" onerror="console.error('圖片載入失敗:', this.src); this.style.display='none'">` : '<div style="padding: 20px; text-align: center; color: #999; background: #f5f5f5; border-radius: 4px; margin-bottom: 8px;">📷 無照片</div>'}
                <div id="panel-text-view-${panel.id}" style="margin-bottom: 8px; white-space: pre-wrap;">${panel.text || ''}</div>
                <textarea id="panel-text-edit-${panel.id}" style="display:none; width: 100%; height: 80px; padding: 6px; border: 1px solid #4CAF50; border-radius: 4px; resize: vertical; font-family: inherit; font-size: 13px; box-sizing: border-box;">${panel.text || ''}</textarea>
                <div style="font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 5px; margin-top: 5px;">
                    ${panel.creator || '未知'} · ${panel.timestamp || ''}
                </div>
                <div id="panel-btns-view-${panel.id}" style="display: flex; gap: 5px; margin-top: 8px;">
                    <button onclick="startEditPanel('${panel.id}')" style="flex: 1; padding: 6px 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                        ✏️ 編輯
                    </button>
                    <button onclick="deletePanel('${panel.id}')" style="flex: 1; padding: 6px 8px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                        🗑️ 刪除
                    </button>
                </div>
                <div id="panel-btns-edit-${panel.id}" style="display:none; gap: 5px; margin-top: 8px;">
                    <button onclick="saveEditPanel('${panel.id}')" style="flex: 1; padding: 6px 8px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                        💾 儲存
                    </button>
                    <button onclick="cancelEditPanel('${panel.id}')" style="flex: 1; padding: 6px 8px; background: #e0e0e0; color: #666; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">
                        取消
                    </button>
                </div>
            </div>
        `);
        
        panelMarkers.push(marker);
    });
    applyMarkerVisibility();
}

// 顯示新增配電盤彈窗
function showAddPanelPopup(latlng) {
    const div = document.createElement('div');
    div.style.cssText = 'min-width:260px;';
    div.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 10px; color: #4CAF50;">🔌 新增配電盤/儀表箱標記</div>
        <textarea id="panelText" placeholder="輸入備註內容..." style="width: 100%; height: 80px; padding: 8px; border: 1px solid #4CAF50; border-radius: 4px; resize: vertical; margin-bottom: 8px; font-family: inherit; font-size: 13px; box-sizing: border-box;"></textarea>
        <div style="font-size: 11px; color: #666; margin-bottom: 3px;">上傳照片（選填）</div>
        <input type="file" id="panelPhoto" accept="image/*" style="width: 100%; margin-bottom: 8px; font-size: 12px;">
        <input id="panelCreator" placeholder="建立者（選填）" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box;">
    `;
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 儲存';
    saveBtn.style.cssText = 'width:100%;margin-top:8px;padding:8px;background:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer;font-weight:bold;';
    saveBtn.onclick = function() { savePanel(latlng.lat, latlng.lng); };
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'width:100%;margin-top:3px;padding:5px;background:#e0e0e0;color:#666;border:none;border-radius:5px;cursor:pointer;font-size:12px;';
    cancelBtn.onclick = function() { map.closePopup(); };
    
    div.appendChild(saveBtn);
    div.appendChild(cancelBtn);
    
    L.popup().setLatLng([latlng.lat, latlng.lng]).setContent(div).openOn(map);
}

// 儲存配電盤標記
window.savePanel = async function(lat, lng) {
    if (!requireLogin()) return;
    const text = document.getElementById('panelText').value.trim();
    const creator = document.getElementById('panelCreator').value.trim() || '匿名';
    const photoInput = document.getElementById('panelPhoto');
    
    if (!text) {
        showToast('請輸入備註內容', 'warning');
        return;
    }
    
    // 確保有 currentPipeline
    if (!currentPipeline || !currentPipeline.id) {
        showToast('無法取得工程資訊，請重新進入', 'error');
        console.error('currentPipeline 未定義:', currentPipeline);
        return;
    }
    
    let photoBase64 = '';
    
    if (photoInput && photoInput.files && photoInput.files[0]) {
        const file = photoInput.files[0];
        try {
            photoBase64 = await compressImage(file, 1600, 0.85);
            if (photoBase64.length > 3 * 1024 * 1024) {
                photoBase64 = await compressImage(file, 1200, 0.75);
            }
        } catch (error) {
            console.error('照片壓縮失敗:', error);
            showToast('照片處理失敗，備註文字已繼續儲存', 'warning');
            photoBase64 = '';
        }
    }
    
    try {
        const queryString = '?action=addPanel' +
            '&lat=' + lat +
            '&lng=' + lng +
            '&text=' + encodeURIComponent(text) +
            '&creator=' + encodeURIComponent(creator) +
            '&pipelineId=' + encodeURIComponent(currentPipeline.id);
        
        const response = await fetch(API_URL + queryString, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ photo: photoBase64 }),
            redirect: 'follow'
        });
        const result = await response.json();
        
        if (result.success) {
            map.closePopup();
            await loadPanels();
            showToast('配電盤標記已新增！', 'success');
        } else {
            showToast('新增失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('新增失敗：' + error.message, 'error');
        console.error('新增配電盤標記錯誤:', error);
    }
};

// 刪除配電盤標記
window.deletePanel = async function(panelId) {
    if (!requireLogin()) return;
    if (!await showConfirm({ title: '刪除配電盤標記', message: '確定要刪除嗎？', okText: '刪除', danger: true })) {
        return;
    }
    
    try {
        const url = API_URL + '?action=deletePanel&panelId=' + encodeURIComponent(panelId);
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.success) {
            map.closePopup();
            await loadPanels();
            showToast('配電盤標記已刪除！', 'success');
        } else {
            showToast('刪除失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('刪除失敗：' + error.message, 'error');
    }
};

// 編輯模式切換
window.startEditPanel = function(panelId) {
    document.getElementById('panel-text-view-' + panelId).style.display = 'none';
    document.getElementById('panel-text-edit-' + panelId).style.display = 'block';
    document.getElementById('panel-btns-view-' + panelId).style.display = 'none';
    document.getElementById('panel-btns-edit-' + panelId).style.display = 'flex';
    document.getElementById('panel-text-edit-' + panelId).focus();
};

window.cancelEditPanel = function(panelId) {
    document.getElementById('panel-text-view-' + panelId).style.display = 'block';
    document.getElementById('panel-text-edit-' + panelId).style.display = 'none';
    document.getElementById('panel-btns-view-' + panelId).style.display = 'flex';
    document.getElementById('panel-btns-edit-' + panelId).style.display = 'none';
};

window.saveEditPanel = async function(panelId) {
    if (!requireLogin()) return;
    const newText = document.getElementById('panel-text-edit-' + panelId).value.trim();
    if (!newText) {
        showToast('備註內容不能為空', 'warning');
        return;
    }
    
    try {
        const url = API_URL + '?action=updatePanel&panelId=' + encodeURIComponent(panelId) + '&text=' + encodeURIComponent(newText);
        const response = await fetch(url);
        const result = await response.json();
        
        if (result.success) {
            map.closePopup();
            await loadPanels();
            showToast('配電盤標記已更新！', 'success');
        } else {
            showToast('更新失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        showToast('更新失敗：' + error.message, 'error');
    }
};
// ========== 配電盤/儀表箱功能結束 ==========
