// ========== 統一 API 封裝 ==========
// 所有後端 API 呼叫經過此函數，集中處理：
// - Token 注入（取代 fetch 攔截器）
// - authError 偵測（登入過期自動清除）
// - success 檢查（失敗自動 throw）
//
// 用法：
//   GET:  await apiCall('getProgress', { pipelineId: id })
//   POST JSON:  await apiCall('addMapNote', { lat, lng }, { body: { photo: base64 } })
//   POST form:  await apiCall('updateLinestring', {}, { body: new URLSearchParams({ pipelineId, linestring }) })
//
// opts.raw    = true → 跳過 success 檢查，回傳原始 JSON
// opts.silent = true → 失敗時不顯示 toast（由呼叫者自行處理）

const WRITE_PREFIXES = ['save', 'update', 'delete', 'add', 'clear', 'upload'];

function _isWriteAction(actionName) {
    if (!actionName) return false;
    const lower = actionName.toLowerCase();
    return WRITE_PREFIXES.some(p => lower.startsWith(p));
}

async function apiCall(action, params, opts) {
    params = params || {};
    opts = opts || {};

    // --- 組 URL ---
    const qp = new URLSearchParams();
    qp.set('action', action);
    Object.keys(params).forEach(function(k) {
        if (params[k] !== undefined && params[k] !== null) {
            qp.set(k, params[k]);
        }
    });

    // GET 請求：token 加在 URL
    if (!opts.body && userToken && _isWriteAction(action)) {
        qp.set('userToken', userToken);
    }

    var url = API_URL + '?' + qp.toString();

    // --- fetch 選項 ---
    var fetchOpts = {};

    if (opts.body) {
        fetchOpts.method = 'POST';

        if (opts.body instanceof URLSearchParams) {
            // URLSearchParams — token 加在 body
            opts.body.set('action', action);
            if (userToken && _isWriteAction(action)) {
                opts.body.set('userToken', userToken);
            }
            fetchOpts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            fetchOpts.body = opts.body;
        } else if (typeof opts.body === 'object') {
            // JSON body — token 加在 body
            var bodyObj = Object.assign({}, opts.body);
            if (userToken && _isWriteAction(action)) {
                bodyObj.userToken = userToken;
            }
            fetchOpts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
            fetchOpts.body = JSON.stringify(bodyObj);
            fetchOpts.redirect = 'follow';
        }
    }

    // --- 發送請求 ---
    var response = await fetch(url, fetchOpts);
    var data = await response.json();

    // --- authError 檢查 ---
    if (data && data.authError) {
        // 先嘗試 silent refresh，若有新 token 就直接用（不打擾使用者）
        // silentRefreshToken 是非同步的，這裡只能觸發，無法等待結果
        // 所以仍然拋錯，讓呼叫端知道這次失敗，但背景已在更新 token
        if (currentUser && typeof silentRefreshToken === 'function') {
            console.log('🔄 authError 觸發，嘗試 silent refresh...');
            silentRefreshToken(currentUser.email);
        } else {
            // 無法 silent refresh → 清除登入狀態
            showToast('登入已過期，請重新登入', 'error');
            localStorage.removeItem('userInfo');
            currentUser = null;
            userToken = null;
            showUserInfo();
        }
        throw new Error('AUTH_EXPIRED');
    }

    // --- success 檢查 ---
    if (!opts.raw && data.success === false) {
        var errMsg = data.error || '操作失敗';
        if (!opts.silent) {
            showToast((opts.errorPrefix || '錯誤') + '：' + errMsg, 'error');
        }
        throw new Error(errMsg);
    }

    return data;
}
