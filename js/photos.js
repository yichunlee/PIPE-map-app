// ============================================================
// photos.js — 施工照片上傳/瀏覽功能
// ============================================================

// 開啟照片面板
window.openPhotoPanel = async function(pipelineId, segmentNumber, smallIndex) {
    // 移除舊面板
    const old = document.getElementById('_photoPanel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = '_photoPanel';
    panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';

    panel.innerHTML = `
        <div style="background:white;border-radius:12px;width:92%;max-width:540px;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.3);overflow:hidden;">
            <div style="background:#ff9800;color:white;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <div>
                    <div style="font-weight:bold;font-size:14px;">📷 施工照片</div>
                    <div style="font-size:11px;opacity:0.85;margin-top:2px;">${segmentNumber} 小段 #${smallIndex + 1}</div>
                </div>
                <button onclick="document.getElementById('_photoPanel').remove()" 
                    style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:16px;cursor:pointer;padding:2px 8px;border-radius:4px;">✕</button>
            </div>
            
            <!-- 上傳區 -->
            <div style="padding:12px 16px;border-bottom:1px solid #eee;flex-shrink:0;">
                <div style="display:flex;gap:8px;margin-bottom:8px;">
                    <button onclick="triggerCamera('${pipelineId}','${segmentNumber}',${smallIndex})"
                        style="flex:1;padding:10px;background:#ff9800;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:bold;">
                        📷 拍照上傳
                    </button>
                    <button onclick="triggerFileUpload('${pipelineId}','${segmentNumber}',${smallIndex})"
                        style="flex:1;padding:10px;background:#f5f5f5;color:#555;border:1px solid #ddd;border-radius:8px;cursor:pointer;font-size:13px;">
                        🖼️ 從相簿選取
                    </button>
                </div>
                <!-- 隱藏的 file input -->
                <input type="file" id="_photoFileInput" accept="image/*" capture="environment" style="display:none;" 
                    onchange="handlePhotoSelect(event,'${pipelineId}','${segmentNumber}',${smallIndex})">
                <input type="file" id="_photoGalleryInput" accept="image/*" style="display:none;"
                    onchange="handlePhotoSelect(event,'${pipelineId}','${segmentNumber}',${smallIndex})">
                <div id="_photoUploadProgress" style="display:none;font-size:12px;color:#ff9800;text-align:center;">上傳中...</div>
            </div>
            
            <!-- 照片列表 -->
            <div id="_photoList" style="overflow-y:auto;flex:1;padding:12px 16px;">
                <div style="text-align:center;padding:30px;color:#aaa;">載入中...</div>
            </div>
        </div>`;

    document.body.appendChild(panel);
    panel.addEventListener('click', e => { if (e.target === panel) panel.remove(); });

    // 載入照片
    await loadPhotos(pipelineId, segmentNumber, smallIndex);
};

// 觸發相機
window.triggerCamera = function(pipelineId, segmentNumber, smallIndex) {
    if (!requireLogin()) return;
    const input = document.getElementById('_photoFileInput');
    if (input) { input.value = ''; input.click(); }
};

// 觸發相簿
window.triggerFileUpload = function(pipelineId, segmentNumber, smallIndex) {
    if (!requireLogin()) return;
    const input = document.getElementById('_photoGalleryInput');
    if (input) { input.value = ''; input.click(); }
};

// 處理選取的照片
window.handlePhotoSelect = async function(event, pipelineId, segmentNumber, smallIndex) {
    const file = event.target.files[0];
    if (!file) return;
    // 限制只能有1張照片
    try {
        const existing = await apiCall('getPhotos', { pipelineId, segmentNumber, smallIndex });
        if ((existing.photos || []).length >= 1) {
            showToast('每個小段只能上傳1張照片，請先刪除現有照片', 'warning');
            return;
        }
    } catch(e) {}

    const progress = document.getElementById('_photoUploadProgress');
    if (progress) { progress.style.display = 'block'; progress.textContent = '壓縮照片中...'; }

    try {
        // 壓縮圖片（最大 800px，品質 0.75）
        const compressed = await compressImage(file, 800, 0.75);

        if (progress) progress.textContent = '取得定位中...';
        // 取得 GPS
        let lat = null, lng = null;
        try {
            const pos = await new Promise((res, rej) => {
                navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000, enableHighAccuracy: true });
            });
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
        } catch(e) { console.log('無法取得定位:', e.message); }

        if (progress) progress.textContent = '上傳中...';

        // 上傳（用 POST JSON，因為 base64 圖片太大不能放 URL）
        const uploader = currentUser ? (currentUser.name || currentUser.email || '未知') : '未知';
        const result = await apiCall('uploadPhoto', {
            pipelineId,
            segmentNumber,
            smallIndex,
            uploader,
            lat: lat || '',
            lng: lng || '',
            takenAt: new Date().toISOString(),
            mimeType: file.type || 'image/jpeg'
        }, {
            body: {
                imageBase64: compressed,
                action: 'uploadPhoto',
                pipelineId,
                segmentNumber,
                smallIndex,
                uploader,
                lat: lat || '',
                lng: lng || '',
                takenAt: new Date().toISOString(),
                mimeType: file.type || 'image/jpeg'
            }
        });

        if (result.success) {
            showToast('照片上傳成功！', 'success');
            await loadPhotos(pipelineId, segmentNumber, smallIndex);
        } else {
            showToast('上傳失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch(e) {
        showToast('上傳失敗：' + e.message, 'error');
    } finally {
        if (progress) progress.style.display = 'none';
    }
};

// 壓縮圖片
function compressImage(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
                else { w = Math.round(w * maxSize / h); h = maxSize; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = url;
    });
}

// 載入照片列表
async function loadPhotos(pipelineId, segmentNumber, smallIndex) {
    const list = document.getElementById('_photoList');
    if (!list) return;

    try {
        const result = await apiCall('getPhotos', { pipelineId, segmentNumber, smallIndex });
        const photos = result.photos || [];

        // 最多1張：有照片就隱藏上傳按鈕
        const uploadArea = document.querySelector('#_photoPanel [style*="border-bottom"]');
        if (uploadArea) uploadArea.style.display = photos.length >= 1 ? 'none' : '';

        if (photos.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;"><div style="font-size:40px;margin-bottom:8px;">📷</div><div>尚無照片</div><div style="font-size:11px;margin-top:4px;color:#bbb;">點上方按鈕拍照或選取</div></div>';
            return;
        }

        list.innerHTML = photos.slice(0, 1).map((p, i) => `
            <div style="border:1px solid #eee;border-radius:8px;margin-bottom:10px;overflow:hidden;">
                <img src="${p.dataUrl}" style="width:100%;max-height:220px;object-fit:cover;display:block;cursor:pointer;"
                    onclick="viewFullPhoto('${p.id}', '${p.dataUrl.replace(/'/g, "\\'")}')">
                <div style="padding:8px 10px;background:#fafafa;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <div style="font-size:12px;font-weight:bold;color:#333;">👤 ${p.uploader}</div>
                            <div style="font-size:11px;color:#888;">🕐 ${new Date(p.uploadedAt).toLocaleString('zh-TW')}</div>
                            ${p.lat ? `<div style="font-size:11px;color:#888;">📍 ${parseFloat(p.lat).toFixed(5)}, ${parseFloat(p.lng).toFixed(5)}</div>` : ''}
                        </div>
                        <div style="display:flex;gap:4px;">
                            ${p.lat ? `<button onclick="showPhotoOnMap(${p.lat},${p.lng})"
                                style="padding:4px 8px;background:#2196F3;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;">🗺️</button>` : ''}
                            <button onclick="confirmDeletePhoto('${p.id}','${pipelineId}','${segmentNumber}',${smallIndex})"
                                style="padding:4px 8px;background:#e53935;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;">🗑️</button>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    } catch(e) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#e53935;">載入失敗：' + e.message + '</div>';
    }
}

// 全螢幕看照片
window.viewFullPhoto = function(id, dataUrl) {
    const old = document.getElementById('_photoViewer');
    if (old) old.remove();
    const viewer = document.createElement('div');
    viewer.id = '_photoViewer';
    viewer.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:19999;display:flex;align-items:center;justify-content:center;flex-direction:column;';
    viewer.innerHTML = `
        <button onclick="document.getElementById('_photoViewer').remove()"
            style="position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.2);border:none;color:white;font-size:20px;cursor:pointer;padding:4px 12px;border-radius:6px;">✕</button>
        <img src="${dataUrl}" style="max-width:95vw;max-height:90vh;object-fit:contain;border-radius:4px;">
        <a href="${dataUrl}" download="photo_${id}.jpg"
            style="margin-top:12px;padding:8px 20px;background:#ff9800;color:white;border-radius:6px;text-decoration:none;font-size:13px;">💾 下載</a>`;
    document.body.appendChild(viewer);
    viewer.addEventListener('click', e => { if(e.target===viewer) viewer.remove(); });
};

// 在地圖上顯示拍照位置
window.showPhotoOnMap = function(lat, lng) {
    document.getElementById('_photoPanel')?.remove();
    if (typeof map !== 'undefined') {
        map.setView([lat, lng], 18);
        L.circleMarker([lat, lng], { radius: 10, color: '#ff9800', fillColor: '#ff9800', fillOpacity: 0.8 })
            .addTo(map)
            .bindPopup('📷 拍照位置')
            .openPopup();
    }
};

// 確認刪除
window.confirmDeletePhoto = async function(photoId, pipelineId, segmentNumber, smallIndex) {
    if (!requireLogin()) return;
    if (!await showConfirm({ title: '刪除照片', message: '確定要刪除這張照片嗎？', okText: '刪除', danger: true })) return;
    try {
        const result = await apiCall('deletePhoto', { photoId });
        if (result.success) {
            showToast('已刪除', 'success');
            await loadPhotos(pipelineId, segmentNumber, smallIndex);
        }
    } catch(e) { showToast('刪除失敗：' + e.message, 'error'); }
};

// ============================================================
// 左側工具抽屜
// ============================================================
let _leftDrawerOpen = false;

window.toggleLeftDrawer = function() {
    _leftDrawerOpen = !_leftDrawerOpen;
    const drawer = document.getElementById('leftDrawer');
    const toggle = document.getElementById('leftDrawerToggle');
    if (drawer) drawer.style.display = _leftDrawerOpen ? 'block' : 'none';
    if (toggle) toggle.style.background = _leftDrawerOpen ? '#e8f4f8' : 'white';
};

// 照片子選單（📷 展開「顯示位置 / 匯出報告」）
window.togglePhotoMenu = function(ev) {
    if (ev) ev.stopPropagation();
    const menu = document.getElementById('photoSubmenu');
    const btn = document.getElementById('photoMenuButton');
    if (!menu || !btn) return;
    if (menu.style.display === 'block') { menu.style.display = 'none'; return; }

    // 對齊 📷 按鈕，往左側展開（抽屜在右邊）
    const r = btn.getBoundingClientRect();
    menu.style.top = r.top + 'px';
    menu.style.left = 'auto';
    menu.style.right = (window.innerWidth - r.left + 6) + 'px';
    menu.style.display = 'block';

    // 點別處就收起
    setTimeout(() => {
        document.addEventListener('click', window.closePhotoMenu, { once: true });
    }, 0);
};

window.closePhotoMenu = function() {
    const menu = document.getElementById('photoSubmenu');
    if (menu) menu.style.display = 'none';
};

// ============================================================
// 照片圖層 — 在地圖上顯示有照片的小段 📷 標記
// ============================================================
let _photoLayerActive = false;
let _photoMarkers = [];
let _photoLatLngMap = {}; // key: "segmentNumber-smallIndex" -> [lat, lng]

window.togglePhotoLayer = async function() {
    _photoLayerActive = !_photoLayerActive;
    const btn = document.getElementById('photoMenuButton');
    if (btn) btn.classList.toggle('active', _photoLayerActive);

    if (!_photoLayerActive) {
        _clearPhotoMarkers();
        return;
    }

    if (!currentPipeline) return;
    showToast('載入照片位置...', 'info', 2000);

    try {
        const result = await apiCall('getPhotos', { pipelineId: currentPipeline.id });
        const photos = result.photos || [];

        if (photos.length === 0) {
            showToast('此工程尚無照片', 'warning');
            _photoLayerActive = false;
            if (btn) btn.classList.remove('active');
            return;
        }

        // 依 segmentNumber + smallIndex 分組
        const groups = {};
        photos.forEach(p => {
            const key = `${p.segmentNumber}_${p.smallIndex}`;
            if (!groups[key]) groups[key] = { segmentNumber: p.segmentNumber, smallIndex: p.smallIndex, count: 0, lat: p.lat, lng: p.lng };
            groups[key].count++;
        });

        _clearPhotoMarkers();

        Object.values(groups).forEach(g => {
            // 從管線座標找小段中點
            const bi = parseInt((g.segmentNumber || 'B0').replace('B','')) || 0;
            const branches = currentPipeline.branches || {};
            const segs = branches[g.segmentNumber] || [];
            const seg = segs.find(s => s.smallIndex === parseInt(g.smallIndex));

            let latlng = null;
            if (seg) {
                const isMULTI = currentPipeline.linestring.trim().toUpperCase().startsWith('MULTILINESTRING');
                let allBranches = isMULTI
                    ? parseLineStringWithBranches(currentPipeline.linestring).branches
                    : [{ coords: parseLineString(currentPipeline.linestring), index: 0 }];
                const branch = allBranches[bi];
                if (branch) {
                    const midDist = (seg.startDistance + seg.endDistance) / 2;
                    const coord = getPositionAtDistanceFromCoords(branch.coords, midDist);
                    if (coord) latlng = [coord[0], coord[1]];
                }
            }

            // fallback：用照片 GPS
            if (!latlng && g.lat && g.lng) latlng = [parseFloat(g.lat), parseFloat(g.lng)];
            if (!latlng) return;
            // 把座標存回供匯出使用
            g._latlng = latlng;
            _photoLatLngMap[`${g.segmentNumber}-${g.smallIndex}`] = latlng;

            // 標籤：「B0 #20」格式
            const branchKey = g.segmentNumber || 'B?';
            const smallNum = parseInt(g.smallIndex) + 1;
            const labelText = `${branchKey} #${smallNum}`;
            const labelW = Math.max(52, labelText.length * 9 + 12);
            const icon = L.divIcon({
                className: '',
                html: `<div style="background:transparent;font-size:11px;font-weight:bold;color:#e65100;white-space:nowrap;cursor:pointer;line-height:1.4;text-shadow:0 0 3px white,0 0 3px white,0 0 3px white;">${labelText}</div>`,
                iconSize: [labelW, 18],
                iconAnchor: [labelW/2, 9],
            });

            const marker = L.marker(latlng, { icon }).addTo(map);

            // 滑鼠移入：自動載入並顯示照片縮圖
            marker.on('mouseover', async function() {
                // 避免重複建立
                if (marker._photoPopupOpen) return;
                marker._photoPopupOpen = true;

                // 先顯示載入中
                const loadingPopup = L.popup({ autoPan: false, closeButton: false, offset: [0, -14] })
                    .setLatLng(latlng)
                    .setContent('<div style="padding:6px 10px;font-size:12px;color:#888;">載入照片...</div>')
                    .openOn(map);

                try {
                    const res = await apiCall('getPhotos', {
                        pipelineId: currentPipeline.id,
                        segmentNumber: g.segmentNumber,
                        smallIndex: g.smallIndex
                    });
                    const photos = res.photos || [];

                    if (!marker._photoPopupOpen) return; // 已移出

                    const imgs = photos.slice(0, 1).map(p =>
                        `<img src="${p.dataUrl}" onclick="viewFullPhoto('${p.id}','${p.dataUrl.replace(/'/g,"\'")}')"
                            style="width:90px;height:70px;object-fit:cover;border-radius:4px;cursor:pointer;margin:2px;">`
                    ).join('');

                    const content = `
                        <div style="max-width:300px;">
                            <div style="font-weight:bold;font-size:12px;margin-bottom:6px;">
                                📷 ${g.segmentNumber} 小段 #${parseInt(g.smallIndex)+1}　共 ${photos.length} 張
                            </div>
                            <div style="display:flex;flex-wrap:wrap;gap:2px;">${imgs}</div>

                            <button onclick="openPhotoPanel('${currentPipeline.id}','${g.segmentNumber}',${g.smallIndex})"
                                style="margin-top:6px;width:100%;padding:4px;background:#ff9800;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
                                查看全部照片
                            </button>
                        </div>`;

                    L.popup({ autoPan: false, closeButton: false, offset: [0, -14] })
                        .setLatLng(latlng)
                        .setContent(content)
                        .openOn(map);
                } catch(e) {
                    marker._photoPopupOpen = false;
                }
            });

            // 滑鼠移出：延遲關閉，讓滑鼠有時間移到 popup 上
            marker.on('mouseout', function() {
                marker._closeTimer = setTimeout(function() {
                    if (!marker._mouseOnPopup) {
                        marker._photoPopupOpen = false;
                        map.closePopup();
                    }
                }, 300);
            });

            // 監聽 popup 開啟後，讓 popup DOM 也能攔截滑鼠
            marker.on('popupopen', function(e) {
                const popupEl = e.popup.getElement();
                if (!popupEl) return;
                popupEl.addEventListener('mouseenter', function() {
                    marker._mouseOnPopup = true;
                    clearTimeout(marker._closeTimer);
                });
                popupEl.addEventListener('mouseleave', function() {
                    marker._mouseOnPopup = false;
                    marker._photoPopupOpen = false;
                    map.closePopup();
                });
            });

            _photoMarkers.push(marker);
        });

        showToast(`顯示 ${_photoMarkers.length} 個有照片的小段`, 'success');
    } catch(e) {
        showToast('載入失敗：' + e.message, 'error');
        _photoLayerActive = false;
        if (btn) btn.classList.remove('active');
    }
};

function _clearPhotoMarkers() {
    _photoMarkers.forEach(m => { if (map) map.removeLayer(m); });
    _photoMarkers = [];
    _photoLatLngMap = {};
}


// ==================== 匯出照片位置報告（Word） ====================

window.exportPhotoReport = async function() {
    if (!currentPipeline) { showToast('請先選擇工程', 'warning'); return; }
    if (_photoMarkers.length === 0) { showToast('請先開啟「顯示照片位置」', 'warning'); return; }

    showToast('📋 正在準備照片報告...', 'info', 60000);

    try {
        // 1. 取所有有照片的小段資料
        const result = await apiCall('getPhotoSegments', { pipelineId: currentPipeline.id });
        const groups = result.groups || [];

        if (groups.length === 0) { showToast('沒有照片資料', 'warning'); return; }

        // 2. 逐筆取照片
        const allItems = [];
        for (const g of groups) {
            const res = await apiCall('getPhotos', {
                pipelineId: currentPipeline.id,
                segmentNumber: g.segmentNumber,
                smallIndex: g.smallIndex
            });
            const photos = res.photos || [];
            if (photos.length === 0) continue;
            const branchKey = g.segmentNumber || 'B?';
            const smallNum = parseInt(g.smallIndex) + 1;
            const latlngKey = `${g.segmentNumber}-${g.smallIndex}`;
            const latlng4export = _photoLatLngMap[latlngKey] || null;
            allItems.push({ label: `${branchKey} 小段 #${smallNum}`, photos, latlng: latlng4export });
        }

        if (allItems.length === 0) { showToast('沒有照片資料', 'warning'); return; }

        // 3. 用 docx library 產生 Word
        if (!window.docx) {
            showToast('docx 函式庫未載入，請重新整理頁面', 'error');
            return;
        }

        const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
                ImageRun, AlignmentType, WidthType, BorderStyle, ShadingType,
                PageBreak, HeadingLevel } = window.docx;

        const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
        const borders = { top: border, bottom: border, left: border, right: border };

        const children = [];

        // 標題
        children.push(new Paragraph({
            heading: HeadingLevel.HEADING_1,
            children: [new TextRun({ text: `📷 施工照片位置報告 — ${currentPipeline.name}`, bold: true, size: 28 })]
        }));
        children.push(new Paragraph({
            children: [new TextRun({ text: `工程編號：${currentPipeline.id}　共 ${allItems.length} 個小段有照片`, size: 20, color: '555555' })]
        }));
        children.push(new Paragraph({ children: [new TextRun('')] }));

        // 截圖前隱藏所有地圖標記，截完還原
        function hideAllMapMarkers() {
            // 隱藏：備註、配電盤、挖掘範圍、段落標籤、甘特日期標籤、便利貼
            // 保留：節點標籤、照片位置標籤（B0 #20）
            if (typeof noteMarkers !== 'undefined') noteMarkers.forEach(m => map.removeLayer(m));
            if (typeof panelMarkers !== 'undefined') panelMarkers.forEach(m => map.removeLayer(m));
            if (typeof permitZones !== 'undefined') permitZones.forEach(z => map.removeLayer(z));
            if (typeof permitLabels !== 'undefined') permitLabels.forEach(l => map.removeLayer(l));
            if (typeof segmentLabels !== 'undefined') segmentLabels.forEach(l => map.removeLayer(l.marker || l));
            if (typeof dateLabels !== 'undefined') dateLabels.forEach(m => map.removeLayer(m));
            if (typeof dateLabelArrows !== 'undefined') dateLabelArrows.forEach(m => map.removeLayer(m));
            if (typeof stickyNotes !== 'undefined') stickyNotes.forEach(n => { if (n.marker) map.removeLayer(n.marker); });
        }

        function restoreAllMapMarkers() {
            if (typeof allMarkersVisible !== 'undefined' && allMarkersVisible) {
                if (typeof noteMarkers !== 'undefined') noteMarkers.forEach(m => map.addLayer(m));
                if (typeof panelMarkers !== 'undefined') panelMarkers.forEach(m => map.addLayer(m));
                if (typeof permitZones !== 'undefined') permitZones.forEach(z => map.addLayer(z));
                if (typeof permitLabels !== 'undefined') permitLabels.forEach(l => map.addLayer(l));
                if (typeof segmentLabels !== 'undefined') segmentLabels.forEach(l => map.addLayer(l.marker || l));
            }
            if (typeof dateLabelsVisible !== 'undefined' && dateLabelsVisible) {
                if (typeof dateLabels !== 'undefined') dateLabels.forEach(m => map.addLayer(m));
                if (typeof dateLabelArrows !== 'undefined') dateLabelArrows.forEach(m => map.addLayer(m));
            }
            if (typeof stickyNotes !== 'undefined') stickyNotes.forEach(n => { if (n.marker) map.addLayer(n.marker); });
        }

        // 輔助：用 html2canvas 截取 Leaflet 地圖某座標的畫面
        async function captureMapAt(latlng, zoom = 19) {
            return new Promise(async (resolve) => {
                try {
                    const origCenter = map.getCenter();
                    const origZoom = map.getZoom();
                    map.setView(latlng, zoom);
                    await new Promise(r => setTimeout(r, 1500));
                    const mapContainer = map.getContainer();
                    const fullCanvas = await html2canvas(mapContainer, {
                        useCORS: true, allowTaint: true, scale: 1,
                        width: mapContainer.offsetWidth,
                        height: mapContainer.offsetHeight,
                        logging: false
                    });
                    map.setView(origCenter, origZoom);

                    // 只裁取地圖中央 50% 區域（等效放大2倍）
                    const cw = fullCanvas.width, ch = fullCanvas.height;
                    const cropW = Math.floor(cw * 0.5);
                    const cropH = Math.floor(ch * 0.5);
                    const cropX = Math.floor((cw - cropW) / 2);
                    const cropY = Math.floor((ch - cropH) / 2);

                    const cropped = document.createElement('canvas');
                    cropped.width = cropW;
                    cropped.height = cropH;
                    cropped.getContext('2d').drawImage(
                        fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH
                    );

                    cropped.toBlob(blob => {
                        if (!blob) { resolve(null); return; }
                        const reader = new FileReader();
                        reader.onload = e => {
                            const b64 = e.target.result.split(',')[1];
                            resolve(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
                        };
                        reader.readAsDataURL(blob);
                    }, 'image/png');
                } catch(e) {
                    console.warn('地圖截圖失敗:', e);
                    resolve(null);
                }
            });
        }

        // 每個小段一頁：標題 + 地圖（上半，全寬）+ 照片（下半，每行2張）
        for (let itemIdx = 0; itemIdx < allItems.length; itemIdx++) {
            const item = allItems[itemIdx];
            const photos = item.photos;
            const latlng = item.latlng;
            const lat = latlng ? latlng[0].toFixed(6) : '';
            const lng = latlng ? latlng[1].toFixed(6) : '';

            // 非第一個小段前加分頁
            if (itemIdx > 0) {
                children.push(new Paragraph({ children: [new PageBreak()] }));
            }

            // 標題：小段編號 + 座標
            children.push(new Paragraph({
                heading: HeadingLevel.HEADING_2,
                children: [
                    new TextRun({ text: `📍 ${item.label}`, bold: true, size: 26, color: 'E65100' }),
                    new TextRun({ text: `　緯度 ${lat}　經度 ${lng}`, size: 18, color: '888888' })
                ]
            }));

            // 地圖截圖
            let mapImgBuf = null;
            if (latlng && window.html2canvas) {
                showToast(`📷 截取 ${item.label} 地圖...`, 'info', 3000);
                hideAllMapMarkers();
                mapImgBuf = await captureMapAt(latlng, 19);
                restoreAllMapMarkers();
            }

            // 上半：地圖全寬（A4 內容寬約 9026 DXA = ~16cm → 圖寬 500pt）
            if (mapImgBuf) {
                children.push(new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new ImageRun({
                        data: mapImgBuf,
                        transformation: { width: 520, height: 300 },
                        type: 'png'
                    })]
                }));
            } else {
                children.push(new Paragraph({
                    children: [new TextRun({ text: '（地圖截圖失敗）', size: 16, color: 'aaaaaa' })]
                }));
            }
            children.push(new Paragraph({ children: [new TextRun('')] }));

            // 下半：只印第1張照片，全寬置中
            const p = photos[0];
            if (p) {
                const dataUrl = p.dataUrl || '';
                const isJpeg = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg');
                const isPng = dataUrl.startsWith('data:image/png');
                const b64 = dataUrl.split(',')[1] || '';
                if (b64 && (isJpeg || isPng)) {
                    const imgBuf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                    children.push(new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new ImageRun({
                            data: imgBuf,
                            transformation: { width: 480, height: 360 },
                            type: isJpeg ? 'jpg' : 'png'
                        })]
                    }));
                }
                const ts = p.timestamp || p.created_at || '';
                if (ts) children.push(new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ text: ts.slice(0, 10), size: 16, color: '888888' })]
                }));
            }
        }
        // 4. 產生並下載
        const doc = new Document({
            styles: {
                default: { document: { run: { font: 'Arial', size: 22 } } },
                paragraphStyles: [
                    { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
                      run: { size: 32, bold: true, font: 'Arial' },
                      paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 } },
                    { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
                      run: { size: 24, bold: true, font: 'Arial', color: 'E65100' },
                      paragraph: { spacing: { before: 180, after: 80 }, outlineLevel: 1 } },
                ]
            },
            sections: [{
                properties: {
                    page: {
                        size: { width: 11906, height: 16838 },
                        margin: { top: 720, right: 720, bottom: 720, left: 720 }
                    }
                },
                children
            }]
        });

        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `照片報告_${currentPipeline.id}_${new Date().toISOString().slice(0,10)}.docx`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`✅ 已匯出 ${allItems.length} 個小段的照片報告`, 'success');

    } catch(e) {
        console.error('匯出失敗:', e);
        showToast('匯出失敗：' + e.message, 'error');
    }
};
