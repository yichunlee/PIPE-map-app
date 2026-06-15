// ============================================================
// accounting.js — 會計核銷金額匯入與管理
// ============================================================

function rocDateToYearMonth(rocDateStr) {
    const s = String(rocDateStr).trim();
    if (s.length === 7) {
        const rocYear = parseInt(s.slice(0, 3));
        const month = s.slice(3, 5);
        return `${rocYear + 1911}-${month}`;
    }
    const m = s.match(/(\d{2,3})[\/\-](\d{1,2})/);
    if (m) return `${parseInt(m[1]) + 1911}-${m[2].padStart(2, '0')}`;
    return null;
}

// ── 開啟核銷管理面板 ─────────────────────────────────────────
window.openAccountingPanel = async function() {
    if (!currentPipeline) { showToast('請先選擇工程', 'error'); return; }

    const old = document.getElementById('_accountingPanel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = '_accountingPanel';
    panel.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
    panel.innerHTML = `
        <div style="background:white;border-radius:12px;width:95%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.3);overflow:hidden;">
            <div style="background:#1565c0;color:white;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                <div>
                    <div style="font-weight:bold;font-size:14px;">💰 實支數查詢</div>
                    <div style="font-size:11px;opacity:0.85;margin-top:2px;">${currentPipeline.name}</div>
                </div>
                <button onclick="document.getElementById('_accountingPanel').remove()"
                    style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:16px;cursor:pointer;padding:2px 10px;border-radius:4px;">✕</button>
            </div>

            <!-- 工程編號設定 -->
            <div id="_codesSection" style="padding:10px 16px;border-bottom:1px solid #eee;flex-shrink:0;background:#f0f4f8;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-size:12px;color:#555;font-weight:bold;">🔢 會計編號：</span>
                    <span id="_codesDisplay" style="font-size:12px;color:#1565c0;">載入中...</span>
                    <button onclick="_openCodesEdit()" style="padding:3px 10px;background:#1565c0;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;">⚙️ 設定</button>
                </div>
            </div>

            <!-- 匯入區 -->
            <div style="padding:10px 16px;border-bottom:1px solid #eee;flex-shrink:0;background:#f8f9fa;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <button onclick="document.getElementById('_excelInputAll').click()"
                        style="padding:8px 14px;background:#2e7d32;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">
                        📂 匯入未完工程明細
                    </button>
                    <button onclick="_clearAllAccounting()"
                        style="padding:8px 14px;background:#e53935;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;">
                        🗑️ 清除全部資料
                    </button>
                </div>
                <input type="file" id="_excelInputAll" accept=".xlsx,.xls" style="display:none;"
                    onchange="_handleExcelAll(event)">
                <div id="_excelProgress" style="display:none;margin-top:8px;font-size:12px;color:#1565c0;"></div>
            </div>

            <!-- 記錄列表 -->
            <div id="_accountingList" style="overflow-y:auto;flex:1;padding:12px 16px;">
                <div style="text-align:center;padding:20px;color:#aaa;">載入中...</div>
            </div>

            <div id="_accountingTotal" style="padding:10px 16px;border-top:1px solid #eee;background:#f8f9fa;font-size:13px;font-weight:bold;color:#1565c0;flex-shrink:0;"></div>
        </div>`;

    document.body.appendChild(panel);
    panel.addEventListener('click', e => { if (e.target === panel) panel.remove(); });
    await _loadCodes();
    await _loadAccountingList();
};

// ── 工程編號設定 ─────────────────────────────────────────────
async function _loadCodes() {
    const display = document.getElementById('_codesDisplay');
    if (!display) return;
    try {
        const result = await apiCall('getPipelineCodes', { pipelineId: currentPipeline.id });
        const codes = result.codes || [];
        display.textContent = codes.length > 0 ? codes.join('、') : '尚未設定';
        display.style.color = codes.length > 0 ? '#1565c0' : '#aaa';
    } catch(e) { display.textContent = '載入失敗'; }
}

window._openCodesEdit = async function() {
    const result = await apiCall('getPipelineCodes', { pipelineId: currentPipeline.id });
    const codes = (result.codes || []).join(', ');

    const old = document.getElementById('_codesEdit');
    if (old) old.remove();

    const div = document.createElement('div');
    div.id = '_codesEdit';
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
    div.innerHTML = `
        <div style="background:white;border-radius:10px;padding:24px;width:380px;box-shadow:0 4px 20px rgba(0,0,0,0.2);">
            <div style="font-weight:bold;font-size:14px;margin-bottom:8px;">⚙️ 設定會計工程編號</div>
            <div style="font-size:11px;color:#888;margin-bottom:12px;">
                輸入此工程在會計系統的編號，多個用逗號分隔<br>
                例如：BU11304010002, BV11504010013
            </div>
            <textarea id="_codesInput" rows="4" placeholder="BU11304010002, BV11504010013"
                style="width:100%;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:13px;box-sizing:border-box;font-family:monospace;">${codes}</textarea>
            <div style="display:flex;gap:8px;margin-top:12px;">
                <button onclick="_saveCodes()" style="flex:1;padding:10px;background:#1565c0;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;">儲存</button>
                <button onclick="document.getElementById('_codesEdit').remove()" style="padding:10px 16px;background:#f5f5f5;color:#555;border:1px solid #ddd;border-radius:6px;cursor:pointer;">取消</button>
            </div>
        </div>`;
    document.body.appendChild(div);
};

window._saveCodes = async function() {
    const input = document.getElementById('_codesInput')?.value || '';
    const codes = input.split(/[,，\n]/).map(c => c.trim()).filter(Boolean);
    try {
        await apiCall('setPipelineCodes', { pipelineId: currentPipeline.id, codes: JSON.stringify(codes) });
        showToast(`已儲存 ${codes.length} 個編號`, 'success');
        document.getElementById('_codesEdit')?.remove();
        await _loadCodes();
    } catch(e) { showToast('儲存失敗：' + e.message, 'error'); }
};

// ── 載入 SheetJS ─────────────────────────────────────────────
async function _loadXLSX() {
    if (window.XLSX) return;
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
}

// 解析 Excel → 取得所有 {code, year_month, amount} 記錄
async function _parseExcel(file) {
    await _loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    const records = [];
    rows.slice(1).forEach(row => {
        const date = String(row[2] || '').trim();
        const direction = String(row[6] || '').trim();
        const amount = parseFloat(row[7]) || 0;
        const ref1 = String(row[9] || '').trim();
        const ref2 = String(row[10] || '').trim(); // 參考欄二：科目
        if (!date || direction !== '借方' || !amount || !ref1) return;
        const ym = rocDateToYearMonth(date);
        if (!ym) return;
        // 取工程編號（第一個空格前的字串）
        const code = ref1.split(' ')[0].trim();
        // 科目分類：011=施工費, other=其餘
        const catPrefix = ref2.split(' ')[0].trim();
        const category = catPrefix === '011' ? '011' : 'other';
        if (code) records.push({ code, year_month: ym, amount, category });
    });
    return records;
}

// ── 匯入此工程（依設定的編號過濾）────────────────────────────
window._handleExcelSingle = async function(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    const progress = document.getElementById('_excelProgress');
    if (progress) { progress.style.display = 'block'; progress.textContent = '解析 Excel...'; }

    try {
        // 取得此工程的編號
        const codesResult = await apiCall('getPipelineCodes', { pipelineId: currentPipeline.id });
        const codes = new Set(codesResult.codes || []);

        if (codes.size === 0) {
            showToast('請先設定會計編號', 'warning');
            if (progress) progress.style.display = 'none';
            return;
        }

        if (progress) progress.textContent = '解析中...';
        const allRecords = await _parseExcel(file);

        // 過濾此工程的記錄並依月份合併
        const merged = {};
        allRecords.forEach(r => {
            if (!codes.has(r.code)) return;
            merged[r.year_month] = (merged[r.year_month] || 0) + r.amount;
        });

        const records = Object.entries(merged).map(([year_month, amount]) => ({ year_month, amount }));

        if (records.length === 0) {
            showToast('Excel 中找不到此工程的記錄（編號：' + [...codes].join(', ') + '）', 'warning');
            if (progress) progress.style.display = 'none';
            return;
        }

        if (progress) progress.textContent = `找到 ${records.length} 個月份，儲存中...`;

        const result = await apiCall('importAccountingExcel', {
            pipelineId: currentPipeline.id,
            records: JSON.stringify(records)
        });

        if (result.success) {
            showToast(`成功匯入 ${result.count} 筆記錄`, 'success');
            await _loadAccountingList();
        }
    } catch(e) {
        showToast('匯入失敗：' + e.message, 'error');
    } finally {
        if (progress) progress.style.display = 'none';
    }
};

// ── 一次全部匯入（所有已設定編號的工程）────────────────────────
window._handleExcelAll = async function(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = '';

    const progress = document.getElementById('_excelProgress');
    if (progress) { progress.style.display = 'block'; progress.textContent = '解析 Excel...'; }

    try {
        const rawRecords = await _parseExcel(file);
        if (progress) progress.textContent = `解析完成，共 ${rawRecords.length} 筆，前端合併中...`;

        // 前端先依 code+year_month+category 合併，避免跨批次資料被覆蓋
        const mergeMap = {};
        rawRecords.forEach(r => {
            const key = r.code + '_' + r.year_month + '_' + (r.category || 'other');
            if (!mergeMap[key]) mergeMap[key] = { code: r.code, year_month: r.year_month, amount: 0, category: r.category || 'other' };
            mergeMap[key].amount += r.amount;
        });
        const allRecords = Object.values(mergeMap);

        // 分批送（每批 200 筆），避免 URL 過長
        const BATCH = 200;
        let totalSaved = 0, totalMatched = 0, totalUnmatched = 0;
        for (let i = 0; i < allRecords.length; i += BATCH) {
            const batch = allRecords.slice(i, i + BATCH);
            if (progress) progress.textContent = `處理中 ${Math.min(i + BATCH, allRecords.length)} / ${allRecords.length} 筆...`;
            // 用 POST JSON body 送，避免 GET URL 截斷 category
            const result = await apiCall('importAllPipelinesExcel', {}, {
                body: { allRecords: batch }
            });
            if (!result.success) throw new Error(result.error || '批次匯入失敗');
            totalSaved += result.saved || 0;
            totalMatched += result.matched || 0;
            totalUnmatched += result.unmatched || 0;
        }

        showToast(`✅ 全部匯入完成！${totalSaved} 個工程月份，比對到 ${totalMatched} 筆，未比對 ${totalUnmatched} 筆`, 'success', 6000);
        await _loadAccountingList();
    } catch(e) {
        showToast('匯入失敗：' + e.message, 'error');
    } finally {
        if (progress) progress.style.display = 'none';
    }
};

// ── 載入記錄列表 ─────────────────────────────────────────────
async function _loadAccountingList() {
    const list = document.getElementById('_accountingList');
    const total = document.getElementById('_accountingTotal');
    if (!list) return;
    try {
        const result = await apiCall('getAccounting', { pipelineId: currentPipeline.id });
        const records = result.records || [];
        const byCode = result.byCode || []; // [{year_month, code, amount}]

        if (records.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;"><div style="font-size:32px;margin-bottom:8px;">💰</div><div>尚無核銷記錄</div></div>';
            if (total) total.textContent = '';
            return;
        }

        // 整理各 code 明細 → Map[year_month][code] = amount
        const codeDetail = {}; // year_month -> {code: amount}
        const codeSet = new Set();
        byCode.forEach(r => {
            if (!codeDetail[r.year_month]) codeDetail[r.year_month] = {};
            codeDetail[r.year_month][r.code] = r.amount;
            codeSet.add(r.code);
        });
        const codes = [...codeSet].sort(); // 排序後的 code 列表

        const sum = records.reduce((s, r) => s + r.amount, 0);

        // 決定是否顯示 code 明細欄（有明細才顯示）
        const showCodeCols = codes.length > 0;

        const codeHeaders = showCodeCols
            ? codes.map(c => `<th style="padding:8px 6px;text-align:right;font-size:11px;white-space:nowrap;">${c}</th>`).join('')
            : '';

        const rows = records.map(r => {
            const codeCells = showCodeCols
                ? codes.map(c => {
                    const amt = codeDetail[r.year_month]?.[c];
                    return `<td style="padding:8px 6px;text-align:right;font-size:11px;color:#555;">${amt != null ? Number(amt).toLocaleString('zh-TW') : '-'}</td>`;
                }).join('')
                : '';
            return `<tr style="border-bottom:1px solid #f0f0f0;">
                <td style="padding:8px 10px;white-space:nowrap;">${r.year_month}</td>
                ${codeCells}
                <td style="padding:8px 10px;text-align:right;color:#1565c0;font-weight:bold;white-space:nowrap;">${Number(r.amount).toLocaleString('zh-TW')}</td>
            </tr>`;
        }).join('');

        list.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:13px;">
                <thead><tr style="background:#f0f4f8;color:#555;">
                    <th style="padding:8px 10px;text-align:left;">年月</th>
                    ${codeHeaders}
                    <th style="padding:8px 10px;text-align:right;">合計</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>`;
        if (total) total.innerHTML = `合計：<span style="color:#e65100;">NT$ ${sum.toLocaleString('zh-TW')}</span>`;
    } catch(e) {
        list.innerHTML = `<div style="text-align:center;padding:20px;color:#e53935;">載入失敗：${e.message}</div>`;
    }
}

// ── 手動新增 ─────────────────────────────────────────────────
window._openManualInput = function() {
    const old = document.getElementById('_manualInput');
    if (old) old.remove();
    const div = document.createElement('div');
    div.id = '_manualInput';
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';
    div.innerHTML = `
        <div style="background:white;border-radius:10px;padding:24px;width:320px;box-shadow:0 4px 20px rgba(0,0,0,0.2);">
            <div style="font-weight:bold;font-size:14px;margin-bottom:16px;">✏️ 手動新增核銷記錄</div>
            <div style="margin-bottom:12px;">
                <label style="font-size:12px;color:#555;">年月</label>
                <input type="month" id="_manualYM" style="width:100%;margin-top:4px;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
                <label style="font-size:12px;color:#555;">金額（元）</label>
                <input type="number" id="_manualAmt" placeholder="例如：1500000" style="width:100%;margin-top:4px;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;">
            </div>
            <div style="margin-bottom:16px;">
                <label style="font-size:12px;color:#555;">備註（選填）</label>
                <input type="text" id="_manualNote" placeholder="例如：第一期請款" style="width:100%;margin-top:4px;padding:8px;border:1px solid #ddd;border-radius:6px;font-size:14px;box-sizing:border-box;">
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="_saveManualRecord()" style="flex:1;padding:10px;background:#1565c0;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:bold;">儲存</button>
                <button onclick="document.getElementById('_manualInput').remove()" style="padding:10px 16px;background:#f5f5f5;color:#555;border:1px solid #ddd;border-radius:6px;cursor:pointer;">取消</button>
            </div>
        </div>`;
    document.body.appendChild(div);
};

window._saveManualRecord = async function() {
    const ym = document.getElementById('_manualYM')?.value;
    const amt = parseFloat(document.getElementById('_manualAmt')?.value);
    const note = document.getElementById('_manualNote')?.value || '';
    if (!ym) { showToast('請選擇年月', 'warning'); return; }
    if (!amt || amt <= 0) { showToast('請輸入有效金額', 'warning'); return; }
    try {
        await apiCall('saveAccounting', { pipelineId: currentPipeline.id, year_month: ym, amount: amt, note });
        showToast('已儲存', 'success');
        document.getElementById('_manualInput')?.remove();
        await _loadAccountingList();
    } catch(e) { showToast('儲存失敗：' + e.message, 'error'); }
};

window._deleteAccountingRecord = async function(id) {
    if (!confirm('確定刪除此記錄？')) return;
    try {
        await apiCall('deleteAccounting', { id });
        showToast('已刪除', 'success');
        await _loadAccountingList();
    } catch(e) { showToast('刪除失敗：' + e.message, 'error'); }
};

window._clearAllAccounting = async function() {
    const confirmed = await showConfirm({
        title: '⚠️ 清除全部實支數資料',
        message: '確定要清除【所有工程】的實支數記錄嗎？\n清除後需重新匯入，此操作無法復原！',
        okText: '確認全部清除',
        danger: true
    }).catch(() => false);
    if (!confirmed) return;
    try {
        const result = await apiCall('clearAllAccounting', {});
        if (result.success) {
            showToast('✅ 已清除所有工程的實支數資料', 'success');
            await _loadAccountingList();
        } else {
            showToast('清除失敗：' + (result.error || ''), 'error');
        }
    } catch(e) { showToast('清除失敗：' + e.message, 'error'); }
};
