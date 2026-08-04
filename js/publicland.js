// ========== 公有土地地籍圖（疊加圖層）==========
// 資料來源：內政部國土測繪中心 WMTS，圖層代碼 LAND_OPENDATA
//   服務網址是從環境部環境圖資平台的圖層設定查到的，該圖層標記為
//   「開放使用 / access: public」，免申請、可直接介接。
//
// 用途：紅色區塊＝公有土地、白色＝私有土地。
//   管線原則上只能走公有地（多為道路用地），這層可以直接看出
//   哪一段路可以埋、哪裡會卡到私人土地需要另外協調地主。
//
// 注意：這是「疊加層」不是「底圖」，會蓋在街道圖/衛星圖之上，
//   所以預設用半透明，並提供透明度調整，避免蓋住自己的管線路徑。

let publicLandLayer = null;
let publicLandVisible = false;
const PUBLIC_LAND_DEFAULT_OPACITY = 0.55;

function initPublicLandLayer() {
    if (publicLandLayer) return publicLandLayer;
    publicLandLayer = L.tileLayer(
        'https://wmts.nlsc.gov.tw/wmts/LAND_OPENDATA/default/GoogleMapsCompatible/{z}/{y}/{x}',
        {
            attribution: '公有土地地籍：內政部國土測繪中心',
            maxZoom: 20,
            maxNativeZoom: 20,
            opacity: PUBLIC_LAND_DEFAULT_OPACITY,
            // 這個服務不一定每個層級都有圖磚，缺圖時不要顯示破圖圖示
            errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        }
    );
    return publicLandLayer;
}

function togglePublicLandLayer() {
    publicLandVisible = !publicLandVisible;

    const opt = document.getElementById('layer-publicland');
    if (opt) {
        const box = opt.querySelector('.layer-checkbox');
        if (box) box.textContent = publicLandVisible ? '☑' : '☐';
        opt.classList.toggle('active', publicLandVisible);
    }
    const opacityBox = document.getElementById('publicLandOpacityBox');
    if (opacityBox) opacityBox.style.display = publicLandVisible ? 'block' : 'none';

    if (!map) return;
    const layer = initPublicLandLayer();
    if (publicLandVisible) {
        if (!map.hasLayer(layer)) layer.addTo(map);
        // 確保疊在底圖之上、但在管線路徑之下（管線是 overlayPane，這裡用 tilePane 之上的順序）
        if (layer.bringToFront) layer.bringToFront();
    } else if (map.hasLayer(layer)) {
        map.removeLayer(layer);
    }
}

function setPublicLandOpacity(v) {
    const o = Math.max(0.1, Math.min(1, Number(v) / 100));
    if (publicLandLayer) publicLandLayer.setOpacity(o);
}

// 切換底圖時，疊加層會被蓋掉，需要重新拉到上層
function refreshPublicLandOrder() {
    if (publicLandVisible && publicLandLayer && map && map.hasLayer(publicLandLayer)) {
        if (publicLandLayer.bringToFront) publicLandLayer.bringToFront();
    }
}

window.togglePublicLandLayer = togglePublicLandLayer;
window.setPublicLandOpacity = setPublicLandOpacity;
window.refreshPublicLandOrder = refreshPublicLandOrder;
// ========== 公有土地地籍圖結束 ==========
