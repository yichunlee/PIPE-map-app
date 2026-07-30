// ========== HTML 跳脫（防 XSS） ==========
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
const esc = escapeHtml; // 短名，blob 視窗內也有同名函數

// ========== Toast 通知函數 ==========
function showToast(message, type = 'info', duration = null) {
    const container = document.getElementById('toast-container');
    if (!container) { console.warn(message); return; }
    const autoClose = duration || (type === 'error' ? 5000 : type === 'warning' ? 4000 : 3000);
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icons[type] || '';
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    toast.appendChild(iconSpan);
    toast.appendChild(msgSpan);
    container.appendChild(toast);
    const dismiss = () => { toast.classList.add('hiding'); setTimeout(() => toast.remove(), 300); };
    toast.addEventListener('click', dismiss);
    setTimeout(dismiss, autoClose);
}

// ========== 自訂確認 Modal ==========
// 用法：const ok = await showConfirm({ title, message, okText, cancelText, danger })
function showConfirm({ title = '確認', message = '', okText = '確定', cancelText = '取消', danger = false, icon = null } = {}) {
    return new Promise(resolve => {
        const backdrop = document.createElement('div');
        backdrop.className = 'confirm-backdrop';
        const autoIcon = icon || (danger ? '🗑️' : 'ℹ️');
        backdrop.innerHTML = `
            <div class="confirm-box">
                <div class="confirm-icon">${autoIcon}</div>
                <div class="confirm-title">${title}</div>
                ${message ? `<div class="confirm-msg">${message}</div>` : ''}
                <div class="confirm-btns">
                    <button class="confirm-btn confirm-btn-cancel" id="_confirmCancel">${cancelText}</button>
                    <button class="confirm-btn ${danger ? 'confirm-btn-danger' : 'confirm-btn-ok'}" id="_confirmOk">${okText}</button>
                </div>
            </div>`;
        document.body.appendChild(backdrop);
        const close = (result) => { backdrop.remove(); resolve(result); };
        backdrop.querySelector('#_confirmOk').onclick = () => close(true);
        backdrop.querySelector('#_confirmCancel').onclick = () => close(false);
        backdrop.addEventListener('click', e => { if (e.target === backdrop) close(false); });
    });
}



// ============================================================
// 載入失敗追蹤
// ------------------------------------------------------------
// 目的：避免「載入失敗 → 畫面顯示空白 → 使用者誤以為本來就沒資料」。
// 最糟的情況是使用者在空白畫面按了儲存，把正確的資料覆寫掉。
//
//   reportLoadFail(key, err, label)  記錄失敗並提示使用者
//   isLoadFailed(key)                儲存前檢查，用來擋掉不可信的資料
//   clearLoadFail(key)               重新載入成功後清除
//   flushLoadFailSummary(label)      批次載入時彙總成一則提示（避免洗頻）
// ============================================================
window._loadFailures = window._loadFailures || new Set();
let _loadFailPending = [];      // 批次載入時暫存，最後彙總
let _loadFailTimer = null;

function reportLoadFail(key, err, label, opts) {
    opts = opts || {};
    window._loadFailures.add(key);
    const msg = (err && err.message) ? err.message : String(err || '未知錯誤');
    console.error('[載入失敗]', key, label || '', msg);

    if (opts.silentToast) return;            // 呼叫端自行處理提示

    if (opts.batch) {
        // 批次情境：先累積，短時間內只出一則彙總提示
        _loadFailPending.push(label || key);
        if (_loadFailTimer) clearTimeout(_loadFailTimer);
        _loadFailTimer = setTimeout(() => {
            const n = _loadFailPending.length;
            const names = _loadFailPending.slice(0, 3).join('、');
            _loadFailPending = [];
            _loadFailTimer = null;
            if (typeof showToast === 'function') {
                showToast('⚠️ 有 ' + n + ' 項資料載入失敗（' + names +
                    (n > 3 ? ' 等' : '') + '），畫面可能不完整，請重新整理', 'error');
            }
        }, 800);
        return;
    }

    if (typeof showToast === 'function') {
        showToast('⚠️ ' + (label || '資料') + '載入失敗：' + msg + '（畫面可能不完整）', 'error');
    }
}

function isLoadFailed(key) { return window._loadFailures.has(key); }
function clearLoadFail(key) { window._loadFailures.delete(key); }

// 在容器裡顯示「載入失敗」而不是留白／顯示「沒有資料」
function renderLoadFailBox(el, label, err, retryFn) {
    if (!el) return;
    const msg = (err && err.message) ? err.message : String(err || '');
    el.innerHTML =
        '<div style="padding:24px;text-align:center;color:#c62828;line-height:1.8;">' +
        '⚠️ ' + escapeHtml(label || '資料') + '載入失敗<br>' +
        '<span style="font-size:11px;color:#999;">' + escapeHtml(msg.slice(0, 90)) + '</span><br>' +
        '<span style="font-size:12px;color:#666;">這不代表沒有資料，請稍後重新整理再試</span>' +
        (retryFn ? '<br><button onclick="' + retryFn + '" style="margin-top:10px;padding:5px 14px;' +
            'background:#c62828;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;">重新載入</button>' : '') +
        '</div>';
}

window.reportLoadFail = reportLoadFail;
window.isLoadFailed = isLoadFailed;
window.clearLoadFail = clearLoadFail;
window.renderLoadFailBox = renderLoadFailBox;
