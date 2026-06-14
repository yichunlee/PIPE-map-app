// ============================================================
// budget.js — 會計科目年度預算設定
// ============================================================

window.openBudgetSetting = async function() {
    // 移除舊面板
    const old = document.getElementById('_budgetSettingPanel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = '_budgetSettingPanel';
    panel.style.cssText = 'position:fixed;top:0;right:0;width:480px;height:100%;background:white;z-index:3000;box-shadow:-4px 0 16px rgba(0,0,0,0.2);display:flex;flex-direction:column;';
    panel.innerHTML = `
        <div style="background:#4a148c;color:white;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
            <div style="font-size:15px;font-weight:bold;">📋 會計科目年度預算設定</div>
            <button onclick="document.getElementById('_budgetSettingPanel').remove()" style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:18px;cursor:pointer;padding:2px 8px;border-radius:4px;">✕</button>
        </div>
        <div style="padding:14px;flex-shrink:0;border-bottom:1px solid #eee;">
            <div style="font-size:12px;color:#888;margin-bottom:8px;">設定各會計科目前綴（BT、BU、BV...）每年度的預算金額，在計畫S曲線上顯示執行進度。</div>
            <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
                <div>
                    <div style="font-size:11px;color:#666;margin-bottom:3px;">科目前綴</div>
                    <input id="_budgetPrefix" placeholder="如 BU" maxlength="10"
                        style="width:80px;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;text-transform:uppercase;">
                </div>
                <div>
                    <div style="font-size:11px;color:#666;margin-bottom:3px;">年度（民國）</div>
                    <input id="_budgetYear" placeholder="如 113" maxlength="5" type="number"
                        style="width:90px;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;">
                </div>
                <div style="flex:1;min-width:120px;">
                    <div style="font-size:11px;color:#666;margin-bottom:3px;">預算金額（元）</div>
                    <input id="_budgetAmount" placeholder="如 200000000" type="number"
                        style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:4px;font-size:13px;">
                </div>
                <button onclick="_saveBudgetRow()" style="padding:6px 16px;background:#4a148c;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;white-space:nowrap;">新增 / 更新</button>
            </div>
        </div>
        <div id="_budgetList" style="flex:1;overflow-y:auto;padding:12px;">
            <div style="text-align:center;padding:20px;color:#aaa;">載入中...</div>
        </div>`;
    document.body.appendChild(panel);
    await _loadBudgetList();
};

async function _loadBudgetList() {
    const list = document.getElementById('_budgetList');
    if (!list) return;
    try {
        const result = await apiCall('getAccountingBudget', {});
        const budgets = result.budgets || [];
        if (!budgets.length) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;">尚無預算設定</div>';
            return;
        }
        // 依前綴分組
        const groups = {};
        budgets.forEach(b => {
            if (!groups[b.prefix]) groups[b.prefix] = [];
            groups[b.prefix].push(b);
        });
        let html = '';
        Object.keys(groups).sort().forEach(prefix => {
            html += `<div style="margin-bottom:16px;">
                <div style="font-size:13px;font-weight:bold;color:#4a148c;padding:6px 0;border-bottom:2px solid #e8d5f5;margin-bottom:6px;">${prefix}</div>
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr style="background:#f5f0ff;color:#555;">
                        <th style="padding:5px 8px;text-align:left;">年度</th>
                        <th style="padding:5px 8px;text-align:right;">預算金額</th>
                        <th style="width:36px;"></th>
                    </tr></thead><tbody>`;
            groups[prefix].forEach(b => {
                const rocYear = b.year > 1900 ? b.year - 1911 : b.year;
                html += `<tr style="border-bottom:1px solid #f0f0f0;">
                    <td style="padding:6px 8px;">${rocYear} 年（民國）</td>
                    <td style="padding:6px 8px;text-align:right;color:#4a148c;font-weight:bold;">
                        ${Number(b.amount).toLocaleString('zh-TW')} 元
                    </td>
                    <td style="padding:4px;text-align:center;">
                        <button onclick="_deleteBudgetRow('${b.id}')"
                            style="padding:2px 6px;background:#e53935;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">✕</button>
                    </td>
                </tr>`;
            });
            html += '</tbody></table></div>';
        });
        list.innerHTML = html;
    } catch(e) {
        list.innerHTML = `<div style="text-align:center;padding:20px;color:#e53935;">載入失敗：${e.message}</div>`;
    }
}

window._saveBudgetRow = async function() {
    const prefix = (document.getElementById('_budgetPrefix').value || '').trim().toUpperCase();
    const yearRaw = parseInt(document.getElementById('_budgetYear').value || '0');
    const amount = parseFloat(document.getElementById('_budgetAmount').value || '0');
    if (!prefix) { showToast('請輸入科目前綴', 'error'); return; }
    if (!yearRaw) { showToast('請輸入年度', 'error'); return; }
    if (!amount || amount <= 0) { showToast('請輸入預算金額', 'error'); return; }
    // 民國年轉西元
    const year = yearRaw < 1000 ? yearRaw + 1911 : yearRaw;
    try {
        const r = await apiCall('saveAccountingBudget', { prefix, year, amount });
        if (r.success) {
            showToast('✅ 儲存成功', 'success');
            document.getElementById('_budgetPrefix').value = prefix; // 保留前綴方便連續輸入
            document.getElementById('_budgetYear').value = '';
            document.getElementById('_budgetAmount').value = '';
            await _loadBudgetList();
        } else {
            showToast('儲存失敗：' + (r.error || ''), 'error');
        }
    } catch(e) {
        showToast('儲存失敗：' + e.message, 'error');
    }
};

window._deleteBudgetRow = async function(id) {
    if (!confirm('確定要刪除這筆預算設定？')) return;
    try {
        await apiCall('deleteAccountingBudget', { id });
        await _loadBudgetList();
    } catch(e) {
        showToast('刪除失敗：' + e.message, 'error');
    }
};
