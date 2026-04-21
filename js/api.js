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

    // --- 發送前先檢查 token 是否已過期（在組 URL/body 之前，避免帶入舊 token）---
    if (_isWriteAction(action) && userToken && typeof parseJwt === 'function') {
        try {
            const _jwtPayload = parseJwt(userToken);
            if (_jwtPayload && _jwtPayload.exp && _jwtPayload.exp < Math.floor(Date.now() / 1000)) {
                console.warn('⚠️ apiCall: token 已過期，先 reauth 再送出');
                if (typeof showReauthOverlay === 'function') {
                    await showReauthOverlay(); // 等 reauth 完成，userToken 會被更新
                }
                // 遞迴：用新 token 重新呼叫（不帶 _isRetry，讓它完整走一次）
                return await apiCall(action, params, opts);
            }
        } catch(e) { /* parseJwt 失敗就繼續照舊送出 */ }
    }

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
    if (_isWriteAction(action)) {
        console.log('[API] 發送', action, '| userToken 長度:', userToken ? userToken.length : 0, '| _isRetry:', opts._isRetry || false);
    }
    var response = await fetch(url, fetchOpts);
    var data = await response.json();

    // --- authError 檢查（token 在發送途中過期的 fallback）---
    if (data && data.authError) {
        console.log('[REAUTH] apiCall 收到 authError，action:', action, '_isRetry:', opts._isRetry);
        if (opts._isRetry) {
            showToast('重新登入後仍然失敗，請重新整理頁面', 'error');
            throw new Error('AUTH_EXPIRED');
        }
        if (typeof showReauthOverlay === 'function') {
            try {
                console.log('[REAUTH] 開始等待 showReauthOverlay...');
                await showReauthOverlay();
                console.log('[REAUTH] resolve！新 userToken 長度:', userToken ? userToken.length : 0, '，準備重試', action);
                return await apiCall(action, params, Object.assign({}, opts, { _isRetry: true }));
            } catch(e) {
                console.log('[REAUTH] rejected 或重試失敗:', e.message);
                showToast('重新登入失敗，請重新整理頁面', 'error');
                throw new Error('AUTH_EXPIRED');
            }
        } else {
            showToast('登入已過期，請重新登入', 'error');
            throw new Error('AUTH_EXPIRED');
        }
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
