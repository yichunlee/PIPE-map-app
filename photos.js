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

        if (photos.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;"><div style="font-size:40px;margin-bottom:8px;">📷</div><div>尚無照片</div><div style="font-size:11px;margin-top:4px;color:#bbb;">點上方按鈕拍照或選取</div></div>';
            return;
        }

        list.innerHTML = photos.map((p, i) => `
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

// ============================================================
// 照片圖層 — 在地圖上顯示有照片的小段 📷 標記
// ============================================================
let _photoLayerActive = false;
let _photoMarkers = [];

window.togglePhotoLayer = async function() {
    _photoLayerActive = !_photoLayerActive;
    const btn = document.getElementById('photoLayerButton');
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

                    const imgs = photos.slice(0, 3).map(p =>
                        `<img src="${p.dataUrl}" onclick="viewFullPhoto('${p.id}','${p.dataUrl.replace(/'/g,"\'")}')"
                            style="width:90px;height:70px;object-fit:cover;border-radius:4px;cursor:pointer;margin:2px;">`
                    ).join('');

                    const content = `
                        <div style="max-width:300px;">
                            <div style="font-weight:bold;font-size:12px;margin-bottom:6px;">
                                📷 ${g.segmentNumber} 小段 #${parseInt(g.smallIndex)+1}　共 ${photos.length} 張
                            </div>
                            <div style="display:flex;flex-wrap:wrap;gap:2px;">${imgs}</div>
                            ${photos.length > 3 ? `<div style="font-size:11px;color:#888;margin-top:4px;">還有 ${photos.length-3} 張...</div>` : ''}
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
            allItems.push({ label: `${branchKey} 小段 #${smallNum}`, photos });
        }

        if (allItems.length === 0) { showToast('沒有照片資料', 'warning'); return; }

        // 3. 用 docx library 產生 Word（動態載入）
        if (!window.docx) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdnjs.cloudflare.com/ajax/libs/docx/8.5.0/docx.umd.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });
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

        // 每個小段：2張照片一排，A4 每排佔半頁
        for (const item of allItems) {
            // 小段標題
            children.push(new Paragraph({
                heading: HeadingLevel.HEADING_2,
                children: [new TextRun({ text: `📍 ${item.label}`, bold: true, size: 24, color: 'E65100' })]
            }));

            // 每2張一行
            const photos = item.photos;
            for (let i = 0; i < photos.length; i += 2) {
                const cells = [];
                for (let j = 0; j < 2; j++) {
                    const p = photos[i + j];
                    let cellChildren = [];
                    if (p) {
                        // 從 dataUrl 取 base64
                        const dataUrl = p.dataUrl || '';
                        const isJpeg = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg');
                        const isPng = dataUrl.startsWith('data:image/png');
                        const b64 = dataUrl.split(',')[1] || '';
                        if (b64 && (isJpeg || isPng)) {
                            const imgBuf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                            cellChildren.push(new Paragraph({
                                children: [new ImageRun({
                                    data: imgBuf,
                                    transformation: { width: 310, height: 230 },
                                    type: isJpeg ? 'jpg' : 'png'
                                })]
                            }));
                        }
                        // 拍照時間
                        const ts = p.timestamp || p.created_at || '';
                        const dateStr = ts ? ts.slice(0, 10) : '';
                        if (dateStr) {
                            cellChildren.push(new Paragraph({
                                children: [new TextRun({ text: dateStr, size: 16, color: '888888' })]
                            }));
                        }
                    } else {
                        cellChildren.push(new Paragraph({ children: [new TextRun('')] }));
                    }
                    cells.push(new TableCell({
                        borders,
                        width: { size: 4503, type: WidthType.DXA },
                        margins: { top: 80, bottom: 80, left: 120, right: 120 },
                        children: cellChildren
                    }));
                }
                children.push(new Table({
                    width: { size: 9026, type: WidthType.DXA },
                    columnWidths: [4503, 4503],
                    rows: [new TableRow({ children: cells })]
                }));
                children.push(new Paragraph({ children: [new TextRun('')] }));
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

        const buffer = await Packer.toBuffer(doc);
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
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
