// 🔐 fetch 攔截器已移除 — 改用 api.js 的 apiCall() 統一處理 token 注入與 authError

function showUserInfo() {
    const userInfoDiv = document.getElementById('userInfo');
    const userAvatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const userRole = document.getElementById('userRole');

    // 若頁面沒有這些元素就直接跳過（避免 null.src crash）
    if (!userInfoDiv) return;

    if (currentUser) {
        if (userAvatar) userAvatar.src = currentUser.picture || '';
        if (userName) userName.textContent = currentUser.name || '';
        if (userRole) userRole.textContent = getRoleLabel(currentUser.role);
        userInfoDiv.style.display = 'flex';
    } else {
        // 訪客模式：顯示登入按鈕
        if (userAvatar) userAvatar.src = '';
        if (userName) userName.textContent = '訪客模式';
        if (userRole) userRole.textContent = '🔑 點擊登入';
        userInfoDiv.style.display = 'flex';
        userInfoDiv.style.cursor = 'pointer';
        userInfoDiv.onclick = function() {
            window.location.href = 'login.html';
        };
    }
}

// ==================== 三級權限系統 ====================
// 角色等級: user(一般使用者) < supervisor(監造單位) < admin(管理員)
// 
// 訪客(未登入)：瀏覽地圖、查看資料
// user：標記完工、備註/面板/人孔/路證
// supervisor：段落管理、工程管理、分支編輯、甘特圖、里程碑
// admin：所有功能 + 工具抽屜 + 使用者管理

// 角色等級數值（用於比較）
function getRoleLevel(role) {
    switch(role) {
        case 'admin': return 3;
        case 'supervisor': return 2;
        case 'user': return 1;
        default: return 0;
    }
}

// 角色中文名稱
function getRoleLabel(role) {
    switch(role) {
        case 'admin': return '👑 管理員';
        case 'supervisor': return '🔧 監造單位';
        case 'user': return '👤 一般使用者';
        default: return '👁️ 訪客';
    }
}

// 檢查登入狀態 - 用於 user 等級操作（標記完工、備註、面板、人孔、路證）
// 回傳 true = 已登入可繼續；false = 未登入已提示
function requireLogin() {
    if (currentUser) return true;
    showToast('請先登入 Google 帳號', 'warning');
    setTimeout(() => { window.location.href = 'login.html'; }, 1500);
    return false;
}

// 檢查監造權限 - 用於 supervisor 等級操作（段落、分支、甘特圖、里程碑）
function requireSupervisor() {
    if (!currentUser) {
        showToast('請先登入 Google 帳號', 'warning');
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        return false;
    }
    if (getRoleLevel(currentUser.role) < 2) {
        showToast('此功能需要「監造單位」以上權限（目前：' + currentUser.role + '）', 'warning');
        return false;
    }
    return true;
}

// 檢查管理員權限 - 用於 admin 等級操作（工程 CRUD）
function requireAdmin() {
    if (!currentUser) {
        showToast('請先登入 Google 帳號', 'warning');
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        return false;
    }
    if (currentUser.role !== 'admin') {
        showToast('此功能需要「管理員」權限（目前：' + currentUser.role + '）', 'warning');
        return false;
    }
    return true;
}

// 初始化 - 自動載入資料（不強制登入）
window.addEventListener('load', function() {
    console.log('🚀 系統初始化...');
    
    // 嘗試從 localStorage 取得使用者資訊
    const userInfoStr = localStorage.getItem('userInfo');
    
    if (!userInfoStr) {
        // 未登入 → 訪客模式（可瀏覽，修改時再要求登入）
        console.log('👁️ 訪客模式 - 可瀏覽地圖與資料，修改時需登入');
        currentUser = null;
        userToken = null;
    } else {
        try {
            const userInfo = JSON.parse(userInfoStr);
            
            // 檢查登入是否過期 (24小時)
            if (Date.now() - userInfo.timestamp > 24 * 60 * 60 * 1000) {
                console.log('⏰ 登入已過期，切換為訪客模式');
                localStorage.removeItem('userInfo');
                currentUser = null;
                userToken = null;
            } else {
                // 設定當前使用者
                currentUser = {
                    email: userInfo.email,
                    name: userInfo.name,
                    picture: userInfo.picture,
                    role: userInfo.role
                };
                
                userToken = userInfo.token;
                
                console.log('✅ 使用者已登入:', currentUser.email, '角色:', currentUser.role);

                // 啟動 silent token refresh
                initSilentRefresh(userInfo.email);
            }
        } catch (error) {
            console.error('❌ 解析使用者資訊失敗:', error);
            localStorage.removeItem('userInfo');
            currentUser = null;
            userToken = null;
        }
    }
    
    // 隱藏登入畫面（主系統不需要登入畫面）
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen) {
        loginScreen.style.display = 'none';
    }
    
    // 無論是否登入，都載入資料
    loadData();
});

// ==================== 重新登入 Overlay ====================
// 當 token 過期時，彈出小型 overlay 讓使用者重新登入
// 不跳頁、不清除地圖狀態，登入完成後自動繼續

let _reauthOverlay = null;
let _reauthPollTimer = null;
let _reauthWindow = null;

window.showReauthOverlay = function() {
    // 已顯示就不重複
    if (_reauthOverlay) return;

    _reauthOverlay = document.createElement('div');
    _reauthOverlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999',
        'background:rgba(0,0,0,0.6)',
        'display:flex', 'align-items:center', 'justify-content:center'
    ].join(';');

    _reauthOverlay.innerHTML = `
        <div style="background:white;border-radius:14px;padding:28px 32px;
                    max-width:340px;width:90%;text-align:center;
                    box-shadow:0 8px 40px rgba(0,0,0,0.35);">
            <div style="font-size:40px;margin-bottom:12px;">🔑</div>
            <div style="font-size:16px;font-weight:bold;color:#333;margin-bottom:8px;">
                登入已過期
            </div>
            <div style="font-size:13px;color:#666;margin-bottom:20px;line-height:1.5;">
                Google 登入憑證已過期（約 1 小時）<br>
                點下方按鈕重新登入，<b>不會離開目前頁面</b>
            </div>
            <button id="_reauthBtn" style="
                width:100%;padding:12px;border:none;border-radius:8px;
                background:#00695C;color:white;font-size:15px;
                font-weight:bold;cursor:pointer;margin-bottom:10px;">
                🔄 重新登入
            </button>
            <div id="_reauthStatus" style="font-size:12px;color:#999;min-height:18px;"></div>
        </div>
    `;

    document.body.appendChild(_reauthOverlay);

    document.getElementById('_reauthBtn').onclick = function() {
        _startReauthFlow();
    };
};

function _startReauthFlow() {
    const statusEl = document.getElementById('_reauthStatus');
    if (statusEl) statusEl.textContent = '正在開啟登入視窗…';

    // 記下目前 localStorage 的 timestamp，登入成功後 timestamp 會更新
    let oldTimestamp = 0;
    try {
        const old = JSON.parse(localStorage.getItem('userInfo') || '{}');
        oldTimestamp = old.timestamp || 0;
    } catch(e) {}

    // 開小視窗到 login.html
    const w = 480, h = 600;
    const left = Math.round(screen.width / 2 - w / 2);
    const top = Math.round(screen.height / 2 - h / 2);
    _reauthWindow = window.open(
        'login.html',
        'reauth_popup',
        `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`
    );

    if (!_reauthWindow) {
        // popup 被封鎖（手機常見）→ 改導向
        if (statusEl) statusEl.textContent = '彈出視窗被封鎖，請允許後再試，或點下方連結';
        const link = document.createElement('a');
        link.href = 'login.html';
        link.target = '_blank';
        link.textContent = '→ 點此開啟登入頁面';
        link.style.cssText = 'display:block;margin-top:8px;color:#1976d2;font-size:13px;';
        if (statusEl) statusEl.after(link);
        // 改用 localStorage 輪詢
        _startTokenPoll(oldTimestamp);
        return;
    }

    if (statusEl) statusEl.textContent = '請在登入視窗完成 Google 登入…';
    _startTokenPoll(oldTimestamp);
}

function _startTokenPoll(oldTimestamp) {
    // 每 500ms 檢查 localStorage 是否有新 token
    if (_reauthPollTimer) clearInterval(_reauthPollTimer);
    _reauthPollTimer = setInterval(function() {
        try {
            const info = JSON.parse(localStorage.getItem('userInfo') || '{}');
            if (info.token && info.timestamp && info.timestamp > oldTimestamp) {
                // 登入成功！更新主頁的 token
                clearInterval(_reauthPollTimer);
                _reauthPollTimer = null;
                _applyNewToken(info);
            }
        } catch(e) {}

        // 若小視窗被關掉了也停止輪詢
        if (_reauthWindow && _reauthWindow.closed) {
            clearInterval(_reauthPollTimer);
            _reauthPollTimer = null;
            const statusEl = document.getElementById('_reauthStatus');
            if (statusEl) statusEl.textContent = '視窗已關閉，請再試一次';
        }
    }, 500);
}

function _applyNewToken(info) {
    // 更新記憶體中的 token
    userToken = info.token;
    currentUser = {
        email: info.email,
        name: info.name,
        picture: info.picture,
        role: info.role
    };

    // 關閉登入小視窗
    if (_reauthWindow && !_reauthWindow.closed) _reauthWindow.close();
    _reauthWindow = null;

    // 關閉 overlay
    if (_reauthOverlay) { _reauthOverlay.remove(); _reauthOverlay = null; }

    // 重啟 silent refresh
    initSilentRefresh(info.email);

    showToast('✅ 重新登入成功，請繼續操作', 'success');
    console.log('✅ Token 已更新，email:', info.email);
}

// ==================== Silent Token Refresh ====================
// Google ID Token 約 1 小時過期，用 silent refresh 在背景自動更新
// 不需要使用者操作，完全無感

let _silentRefreshTimer = null;

function initSilentRefresh(email) {
    // 清除舊的 timer
    if (_silentRefreshTimer) clearInterval(_silentRefreshTimer);

    // 每 45 分鐘執行一次 silent refresh（token 1hr 過期，45min 更新確保不斷線）
    _silentRefreshTimer = setInterval(() => {
        silentRefreshToken(email);
    }, 45 * 60 * 1000);

    console.log('🔄 Silent token refresh 已啟動（每 45 分鐘自動更新）');
}

function silentRefreshToken(email) {
    if (!currentUser) return; // 已登出就不更新
    console.log('🔄 嘗試 silent token refresh...');

    try {
        // 用 Google Identity Services 的 prompt: 'none' 靜默取得新 token
        // 這不會彈出任何視窗，完全在背景執行
        google.accounts.id.initialize({
            client_id: getGoogleClientId(),
            callback: function(response) {
                if (response && response.credential) {
                    const payload = parseJwt(response.credential);
                    // 確認是同一個使用者
                    if (payload.email === (email || currentUser?.email)) {
                        const oldToken = userToken;
                        userToken = response.credential;

                        // 更新 localStorage
                        const userInfoStr = localStorage.getItem('userInfo');
                        if (userInfoStr) {
                            try {
                                const userInfo = JSON.parse(userInfoStr);
                                userInfo.token = response.credential;
                                userInfo.timestamp = Date.now(); // 重置 24hr 計時
                                localStorage.setItem('userInfo', JSON.stringify(userInfo));
                            } catch(e) {}
                        }

                        console.log('✅ Token 已靜默更新');
                    }
                }
            },
            prompt_parent_id: null,
        });
        google.accounts.id.prompt(function(notification) {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                console.log('ℹ️ Silent refresh: 無法靜默更新（', notification.getNotDisplayedReason() || notification.getSkippedReason(), '）');
                // 靜默更新失敗時不強制登出，繼續用舊 token 直到真正過期
            }
        });
    } catch(e) {
        console.warn('⚠️ Silent refresh 失敗:', e.message);
        // 失敗時靜默忽略，讓使用者自然遇到 authError 再處理
    }
}

// 從 index.html 的 Google Sign-In script tag 取得 client_id
function getGoogleClientId() {
    // 嘗試從頁面的 meta tag 或 script 屬性取得
    const metaClientId = document.querySelector('meta[name="google-signin-client_id"]');
    if (metaClientId) return metaClientId.content;

    // 嘗試從 google.accounts.id 現有設定取得（若已初始化）
    const scriptTag = document.querySelector('script[src*="accounts.google.com/gsi"]');
    if (scriptTag) {
        // 從 data attribute 取
        const dataClientId = document.querySelector('[data-client_id]');
        if (dataClientId) return dataClientId.getAttribute('data-client_id');
    }

    // fallback: 從 localStorage 取得（login.html 存進去時帶的）
    try {
        const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
        if (userInfo.clientId) return userInfo.clientId;
    } catch(e) {}

    console.warn('⚠️ 無法取得 Google Client ID，silent refresh 停用');
    return null;
}

// ==================== Google OAuth2 登入處理 ====================

// Google Sign-In 回調函數
function handleCredentialResponse(response) {
    console.log('Google 登入成功');
    userToken = response.credential;
    
    // 解析 JWT token 獲取使用者資訊
    const payload = parseJwt(response.credential);
    console.log('使用者資訊:', payload);
    
    // 驗證使用者權限
    verifyUserAccess(payload);
}

// 解析 JWT Token
function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

// 驗證使用者存取權限
async function verifyUserAccess(payload) {
    try {
        const result = await apiCall('verifyUser', {}, {
            body: { email: payload.email, name: payload.name, picture: payload.picture, token: userToken },
            raw: true
        });
        
        if (result.success && result.authorized) {
            // 授權成功
            currentUser = {
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
                role: result.role // 'admin', 'supervisor', 或 'user'
            };

            // 儲存到 localStorage（含 clientId 供 silent refresh 使用）
            const clientId = (() => {
                const el = document.querySelector('[data-client_id]') ||
                           document.querySelector('div[data-client_id]') ||
                           document.getElementById('g_id_onload');
                return el ? (el.getAttribute('data-client_id') || el.dataset.client_id) : null;
            })();
            localStorage.setItem('userInfo', JSON.stringify({
                email: payload.email,
                name: payload.name,
                picture: payload.picture,
                role: result.role,
                token: userToken,
                timestamp: Date.now(),
                clientId: clientId || ''
            }));
            
            // 啟動 silent refresh
            initSilentRefresh(payload.email);
            
            // 顯示使用者資訊
            showUserInfo();
            
            // 隱藏登入畫面,顯示主介面
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('loadingScreen').style.display = 'flex';
            
            // 載入資料
            await loadData();
            
            document.getElementById('loadingScreen').style.display = 'none';
        } else {
            // 未授權
            showToast('帳號未被授權，請聯絡管理員：' + payload.email, 'error', 8000);
            handleSignOut();
        }
    } catch (error) {
        console.error('驗證失敗:', error);
        showToast('登入驗證失敗，請稍後再試', 'error');
        handleSignOut();
    }
}

// 顯示使用者資訊
// 登出處理
function handleSignOut() {
    // 清除使用者資訊
    currentUser = null;
    userToken = null;
    
    // 清除 localStorage
    localStorage.removeItem('userInfo');
    
    // 重新導向到登入頁面
    window.location.href = 'login.html';
}

// 檢查權限 - 用於需要管理員權限的操作
function checkAdminPermission() {
    // 檢查是否登入
    if (!currentUser) {
        showToast('請先登入 Google 帳號', 'warning');
        setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        return false;
    }
    
    // 檢查管理員權限
    if (currentUser.role !== 'admin') {
        showToast('此功能需要「管理員」權限（目前：' + currentUser.role + '）', 'warning');
        return false;
    }
    
    return true;
}
