// ============================================================
// user-mgmt.js — 成員管理面板（管理員專用）
// ============================================================

const ROLE_LABELS = {
    admin:      '👑 管理員',
    supervisor: '🔍 監工',
    contractor: '🔨 施工單位',
    viewer:     '👁️ 設計單位/訪客',
};

const ROLE_COLORS = {
    admin:      '#c0392b',
    supervisor: '#1565c0',
    contractor: '#e65100',
    viewer:     '#555',
};

window.openUserMgmt = async function() {
    if (!currentUser || currentUser.role !== 'admin') {
        showToast('此功能需要管理員權限', 'error');
        return;
    }

    const old = document.getElementById('_userMgmtPanel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = '_userMgmtPanel';
    panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
    panel.innerHTML = `
        <div style="background:white;border-radius:12px;width:95%;max-width:620px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.3);overflow:hidden;">
            <div style="background:#1565c0;color:white;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <div style="font-weight:bold;font-size:15px;">👥 成員管理</div>
                <button onclick="document.getElementById('_userMgmtPanel').remove()"
                    style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:16px;cursor:pointer;padding:2px 10px;border-radius:4px;">✕</button>
            </div>
            <div style="padding:12px 16px;border-bottom:1px solid #eee;flex-shrink:0;background:#f8f9fa;">
                <div style="font-size:12px;color:#666;">
                    角色說明：
                    <span style="color:#c0392b;font-weight:bold;">管理員</span> 全部功能　
                    <span style="color:#1565c0;font-weight:bold;">監工</span> 全部（不能刪工程）　
                    <span style="color:#e65100;font-weight:bold;">施工單位</span> 標記完工+照片　
                    <span style="color:#555;font-weight:bold;">設計單位</span> 只能看+匯出
                </div>
            </div>
            <div id="_userList" style="overflow-y:auto;flex:1;padding:12px 16px;">
                <div style="text-align:center;padding:30px;color:#aaa;">載入中...</div>
            </div>
        </div>`;

    document.body.appendChild(panel);
    panel.addEventListener('click', e => { if (e.target === panel) panel.remove(); });

    await _loadUserList();
};

async function _loadUserList() {
    const list = document.getElementById('_userList');
    if (!list) return;

    try {
        const result = await apiCall('getUsers', {});
        const users = result.users || [];

        if (users.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;">尚無成員</div>';
            return;
        }

        list.innerHTML = users.map(u => `
            <div style="border:1px solid #eee;border-radius:8px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:12px;">
                <img src="${u.picture || ''}" onerror="this.style.display='none'"
                    style="width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;background:#eee;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:bold;font-size:13px;color:#333;">${u.name || '未知'}</div>
                    <div style="font-size:11px;color:#888;margin-top:1px;">${u.email}</div>
                    <div style="font-size:11px;color:#aaa;margin-top:1px;">上次登入：${u.last_login ? new Date(u.last_login).toLocaleString('zh-TW') : '從未'}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
                    <select onchange="_setRole('${u.email}', this.value)"
                        style="padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;cursor:pointer;color:${ROLE_COLORS[u.role]||'#555'};font-weight:bold;">
                        ${Object.entries(ROLE_LABELS).map(([val, label]) =>
                            `<option value="${val}" ${u.role === val ? 'selected' : ''} style="color:${ROLE_COLORS[val]}">${label}</option>`
                        ).join('')}
                    </select>
                    ${u.email !== currentUser.email ? `
                    <button onclick="_deleteUser('${u.email}')"
                        style="padding:3px 8px;background:#e53935;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;">
                        移除
                    </button>` : '<span style="font-size:11px;color:#aaa;">（自己）</span>'}
                </div>
            </div>
        `).join('');

    } catch(e) {
        list.innerHTML = `<div style="text-align:center;padding:20px;color:#e53935;">載入失敗：${e.message}</div>`;
    }
}

window._setRole = async function(email, role) {
    try {
        await apiCall('setUserRole', { email, role });
        showToast('已更新權限', 'success');
    } catch(e) {
        showToast('更新失敗：' + e.message, 'error');
        await _loadUserList(); // 還原
    }
};

window._deleteUser = async function(email) {
    if (!confirm(`確定移除 ${email}？`)) return;
    try {
        await apiCall('deleteUser', { email });
        showToast('已移除', 'success');
        await _loadUserList();
    } catch(e) {
        showToast('移除失敗：' + e.message, 'error');
    }
};
