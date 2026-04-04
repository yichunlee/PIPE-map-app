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

// 載入所有資料
// 🔐 Google OAuth2 登入處理

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
