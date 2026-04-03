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


