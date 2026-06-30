// ============================================================
// 工程總設定面板 — settings.js
// 集中管理：會計編號、契約金額、當年度目標、年度預算
// ============================================================

window.openSettingsPanel = async function() {
    if (!requireLogin()) return;

    // 建立 overlay
    let overlay = document.getElementById('_settingsOverlay');
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = '_settingsOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = function(e) { if (e.target === overlay) closeSettingsPanel(); };
    document.body.appendChild(overlay);

    const panel = document.createElement('div');
    panel.id = '_settingsPanel';
    panel.style.cssText = [
        'background:#fff',
        'border-radius:16px',
        'box-shadow:0 20px 60px rgba(0,0,0,0.22)',
        'width:min(1100px,96vw)',
        'max-height:88vh',
        'display:flex',
        'flex-direction:column',
        'overflow:hidden',
        'font-family:Microsoft JhengHei,Arial,sans-serif',
    ].join(';');
    overlay.appendChild(panel);

    // Header
    panel.innerHTML = `
        <div style="background:linear-gradient(135deg,#1a5fb4,#1e6fdc);padding:14px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;">
            <span style="font-size:18px;">⚙️</span>
            <span style="color:white;font-weight:700;font-size:15px;flex:1;">工程總設定
                <span id="_stProjLabel" style="font-size:12px;font-weight:400;opacity:0.85;margin-left:8px;">${window.currentProject ? '📁 ' + window.currentProject.name : ''}</span>
            </span>
            <button onclick="closeSettingsPanel()" style="background:rgba(255,255,255,0.18);border:none;color:white;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;">✕</button>
        </div>
        <!-- Tab bar -->
        <div id="_stTabBar" style="display:flex;border-bottom:2px solid #e2e8f0;background:#f8fafc;flex-shrink:0;">
            <button class="_stTab active" onclick="switchSettingsTab('main')"   style="${_tabStyle(true)}">📋 工程設定</button>
            <button class="_stTab"        onclick="switchSettingsTab('budget')" style="${_tabStyle(false)}">📊 年度預算</button>
        </div>
        <!-- Content area -->
        <div id="_stContent" style="flex:1;overflow:auto;padding:0;">
            <div style="padding:40px;text-align:center;color:#94a3b8;">載入中...</div>
        </div>
        <!-- Footer -->
        <div id="_stFooter" style="padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;background:#f8fafc;flex-shrink:0;">
            <span id="_stStatus" style="font-size:12px;color:#64748b;"></span>
            <div style="display:flex;gap:8px;">
                <button onclick="closeSettingsPanel()" style="padding:8px 20px;background:#f1f5f9;border:1.5px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;color:#475569;">關閉</button>
                <button onclick="saveCurrentSettingsTab()" style="padding:8px 20px;background:#1e6fdc;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">💾 儲存全部</button>
            </div>
        </div>
    `;

    window._stCurrentTab = 'main';
    await _loadSettingsTab('main');
};

function _tabStyle(active) {
    return [
        'padding:10px 20px',
        'border:none',
        'background:' + (active ? '#fff' : 'transparent'),
        'border-bottom:' + (active ? '2px solid #1e6fdc' : '2px solid transparent'),
        'color:' + (active ? '#1e6fdc' : '#64748b'),
        'font-weight:' + (active ? '700' : '400'),
        'cursor:pointer',
        'font-size:13px',
        'font-family:Microsoft JhengHei,Arial,sans-serif',
        'transition:all 0.15s',
        'margin-bottom:-2px',
    ].join(';');
}

window.switchSettingsTab = async function(tab) {
    window._stCurrentTab = tab;
    document.querySelectorAll('._stTab').forEach(function(btn, i) {
        const tabs = ['main','budget'];
        const isActive = tabs[i] === tab;
        btn.style.background = isActive ? '#fff' : 'transparent';
        btn.style.borderBottom = isActive ? '2px solid #1e6fdc' : '2px solid transparent';
        btn.style.color = isActive ? '#1e6fdc' : '#64748b';
        btn.style.fontWeight = isActive ? '700' : '400';
    });
    document.getElementById('_stContent').innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">載入中...</div>';
    await _loadSettingsTab(tab);
};

async function _loadSettingsTab(tab) {
    const content = document.getElementById('_stContent');
    if (!content) return;
    content.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">載入所有工程中...</div>';

    // 載入所有計畫的工程
    let projects = window.allProjects || [];
    if (!projects.length) {
        // 嘗試重新取得計畫列表
        try {
            const pr = await apiCall('getProjects', {});
            if (pr.projects && pr.projects.length) {
                window.allProjects = pr.projects;
                projects = pr.projects;
            }
        } catch(e) {}
    }
    if (!projects.length) {
        content.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">尚無計畫資料</div>';
        return;
    }

    // 確保每個計畫的工程都已載入
    await Promise.all(projects.map(async function(proj) {
        const already = (window.allPipelines || []).some(function(p){ return p.projectName === proj.name; });
        if (!already) {
            try {
                const r = await apiCall('getPipelines', { projectName: proj.name });
                if (r.pipelines && r.pipelines.length) {
                    window.allPipelines = (window.allPipelines || []).concat(r.pipelines);
                }
            } catch(e) {}
        }
    }));

    const pipelines = window.allPipelines || [];
    if (!pipelines.length) {
        content.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">尚無工程資料</div>';
        return;
    }

    if (tab === 'main')   await _loadMainTab(pipelines, content);
    if (tab === 'budget') await _loadBudgetTab(content);
}

// ── Tab：工程設定（按計畫分組）────
async function _loadMainTab(pipelines, content) {
    const curYear = new Date().getFullYear();

    // 批次取得所有資料
    const codesMap = {}, amtMap = {}, targetMap = {};
    await Promise.all(pipelines.map(async function(p) {
        try { const r = await apiCall('getPipelineCodes', { pipelineId: p.id }); codesMap[p.id] = (r.codes||[]).join(', '); } catch(e) { codesMap[p.id] = p.codes ? p.codes.join(', ') : ''; }
        try { const r = await apiCall('getContractAmount', { pipelineId: p.id }); amtMap[p.id] = r.amount != null ? r.amount : ''; } catch(e) { amtMap[p.id] = ''; }
        targetMap[p.id] = parseFloat(localStorage.getItem('_bcYearTarget_' + p.id + '_' + curYear)||'0')||0;
    }));

    function getPrefixes(p) {
        const codes = codesMap[p.id] ? codesMap[p.id].split(',').map(function(s){return s.trim();}).filter(Boolean) : (p.codes||[]);
        return [...new Set(codes.map(function(c){return (c.match(/^[A-Za-z]+/)||[''])[0].toUpperCase();}).filter(Boolean))];
    }

    // 按計畫分組
    const groups = {}; // projectName -> pipelines[]
    pipelines.forEach(function(p) {
        const key = p.projectName || '未分類';
        if (!groups[key]) groups[key] = [];
        groups[key].push(p);
    });
    const sortedProjects = Object.keys(groups).sort();

    // 表頭
    const thStyle = 'padding:10px 14px;text-align:right;border-bottom:2px solid #1e6fdc;color:#1e293b;font-size:11px;white-space:nowrap;';
    let html = '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="background:#f0f6ff;position:sticky;top:0;z-index:2;">';
    html += '<th style="padding:10px 14px;text-align:left;border-bottom:2px solid #1e6fdc;color:#1e293b;font-size:11px;white-space:nowrap;min-width:230px;">工程名稱</th>';
    html += '<th style="padding:10px 14px;text-align:left;border-bottom:2px solid #1e6fdc;color:#1e293b;font-size:11px;white-space:nowrap;min-width:200px;">會計編號</th>';
    html += '<th style="' + thStyle + 'min-width:150px;">契約金額（元）</th>';
    html += '<th style="' + thStyle + 'min-width:150px;">本年度目標</th>';
    html += '</tr></thead><tbody>';

    sortedProjects.forEach(function(projName) {
        const plist = groups[projName];
        html += '<tr style="background:linear-gradient(135deg,#1a5fb4,#1e6fdc);">';
        html += '<td colspan="4" style="padding:9px 14px;font-weight:700;font-size:13px;color:#fff;">📁 ' + _esc(projName) + '</td>';
        html += '</tr>';

        let subtotalContract = 0, subtotalTarget = 0;
        plist.forEach(function(p, ri) {
            const prefs = getPrefixes(p);
            const prefixTags = prefs.map(function(pf) {
                return '<span style="background:#dbeafe;color:#1e40af;border-radius:3px;padding:1px 5px;font-size:10px;font-weight:700;margin-left:3px;">' + pf + '</span>';
            }).join('');
            const savedTarget = targetMap[p.id];
            const contractVal = parseFloat(amtMap[p.id])||0;
            subtotalContract += contractVal;
            subtotalTarget += savedTarget;
            const bg = ri%2===0 ? '#fff' : '#f8fafc';
            html += '<tr class="_stRow" style="background:' + bg + ';">';
            html += '<td style="padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#1e293b;">' +
                '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;">' +
                '<span style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + _esc(p.name) + '">' + _esc(p.name) + '</span>' +
                prefixTags + '</div></td>';
            html += '<td style="padding:5px 14px;border-bottom:1px solid #e2e8f0;">' +
                '<input class="_stCodesInput" data-id="' + p.id + '" value="' + _esc(codesMap[p.id]) + '" placeholder="NT11504130001" style="' + _inputStyle(185) + '"></td>';
            html += '<td style="padding:5px 14px;border-bottom:1px solid #e2e8f0;text-align:right;">' +
                '<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;">' +
                '<span style="font-size:10px;color:#94a3b8;" id="_ctHint_' + p.id + '">' + (amtMap[p.id]?_fmtAmt(amtMap[p.id]):'') + '</span>' +
                '<input class="_stContractInput" data-id="' + p.id + '" type="text" inputmode="numeric" value="' + _fmtNum(amtMap[p.id]) + '" placeholder="0" style="' + _inputStyle(120) + ';text-align:right;"></div></td>';
            html += '<td style="padding:5px 14px;border-bottom:1px solid #e2e8f0;text-align:right;">' +
                '<div style="display:flex;align-items:center;gap:4px;justify-content:flex-end;">' +
                '<span style="font-size:10px;color:#94a3b8;" id="_tgHint_' + p.id + '">' + (savedTarget?_fmtAmt(savedTarget):'') + '</span>' +
                '<input class="_stTargetInput" data-id="' + p.id + '" data-year="' + curYear + '" type="text" inputmode="numeric" value="' + _fmtNum(savedTarget) + '" placeholder="0" style="' + _inputStyle(120) + ';text-align:right;"></div></td>';
            html += '</tr>';
        });

        // 計畫小計
        html += '<tr style="background:#f0f6ff;">';
        html += '<td style="padding:7px 14px;font-size:11px;color:#1a5fb4;font-weight:600;border-bottom:2px solid #bfdbfe;" colspan="2">小計（' + plist.length + ' 個工程）</td>';
        html += '<td style="padding:7px 14px;text-align:right;font-size:12px;font-weight:700;color:#1a5fb4;border-bottom:2px solid #bfdbfe;">' + (subtotalContract?_fmtAmt(subtotalContract):'—') + '</td>';
        html += '<td style="padding:7px 14px;text-align:right;font-size:12px;font-weight:700;color:#1a5fb4;border-bottom:2px solid #bfdbfe;">' + (subtotalTarget?_fmtAmt(subtotalTarget):'—') + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    content.innerHTML = html;

    // 千分位格式化 + 即時換算
    content.querySelectorAll('._stContractInput, ._stTargetInput').forEach(function(inp) {
        inp.addEventListener('input', function() {
            const raw = inp.value.replace(/,/g, '');
            const v = parseFloat(raw) || 0;
            const isContract = inp.classList.contains('_stContractInput');
            const hint = document.getElementById((isContract?'_ctHint_':'_tgHint_') + inp.dataset.id);
            if (hint) hint.textContent = v ? _fmtAmt(v) : '';
        });
        inp.addEventListener('blur', function() {
            const raw = inp.value.replace(/,/g, '');
            const v = parseFloat(raw) || 0;
            inp.value = v ? _fmtNum(v) : '';
        });
        inp.addEventListener('focus', function() {
            inp.value = inp.value.replace(/,/g, '');
        });
    });
}

async function _saveMain() {
    await _saveCodes();
    await _saveContracts();
    await _saveTargets();
}

// ── Tab 1：會計編號 ──────────────────────────────
async function _loadCodesTab(pipelines, content) {
    // 批次取得所有工程的 codes
    const codesMap = {};
    await Promise.all(pipelines.map(async function(p) {
        try {
            const r = await apiCall('getPipelineCodes', { pipelineId: p.id });
            codesMap[p.id] = (r.codes || []).join(', ');
        } catch(e) { codesMap[p.id] = ''; }
    }));

    let html = _tableHeader('工程名稱', '會計編號（多個以逗號分隔，例如：NT11504130001, NT11504130002）');
    pipelines.forEach(function(p) {
        html += `<tr class="_stRow">
            <td style="${_tdName()}">${_ellipsis(p.name)}</td>
            <td style="${_tdInput()}">
                <input class="_stCodesInput" data-id="${p.id}"
                    value="${_esc(codesMap[p.id])}"
                    placeholder="例如：NT11504130001"
                    style="${_inputStyle()}">
            </td>
        </tr>`;
    });
    html += '</table></div>';
    content.innerHTML = html;
}

// ── Tab 2：契約金額 ──────────────────────────────
async function _loadContractTab(pipelines, content) {
    const amtMap = {};
    await Promise.all(pipelines.map(async function(p) {
        try {
            const r = await apiCall('getContractAmount', { pipelineId: p.id });
            amtMap[p.id] = r.amount != null ? r.amount : '';
        } catch(e) { amtMap[p.id] = ''; }
    }));

    let html = _tableHeader('工程名稱', '契約金額（元）');
    pipelines.forEach(function(p) {
        html += `<tr class="_stRow">
            <td style="${_tdName()}">${_ellipsis(p.name)}</td>
            <td style="${_tdInput()}">
                <input class="_stContractInput" data-id="${p.id}" type="number"
                    value="${amtMap[p.id]}"
                    placeholder="例如：45000000"
                    style="${_inputStyle()}">
                <span style="font-size:11px;color:#94a3b8;margin-left:6px;" id="_ctHint_${p.id}">
                    ${amtMap[p.id] ? _fmtAmt(amtMap[p.id]) : ''}
                </span>
            </td>
        </tr>`;
    });
    html += '</table></div>';
    content.innerHTML = html;

    // 即時顯示億/萬
    content.querySelectorAll('._stContractInput').forEach(function(inp) {
        inp.addEventListener('input', function() {
            const hint = document.getElementById('_ctHint_' + inp.dataset.id);
            if (hint) hint.textContent = inp.value ? _fmtAmt(parseFloat(inp.value)) : '';
        });
    });
}

// ── Tab 3：今年目標執行數 ──────────────────────────
async function _loadTargetTab(pipelines, content) {
    const curYear = new Date().getFullYear();
    // 同時取得前一年累積核銷（從 accounting_by_code 推算）
    const prevCumMap = {};
    await Promise.all(pipelines.map(async function(p) {
        try {
            const r = await apiCall('getAccounting', { pipelineId: p.id });
            let cum = 0;
            // 用 byCode 比較精確（包含所有 category）
            const src = (r.byCode && r.byCode.length) ? r.byCode : (r.records || []);
            // byCode 可能有重複月份不同 code，用 Set 避免重複加總
            if (r.byCode && r.byCode.length) {
                const monthSet = {};
                r.byCode.forEach(function(rec) {
                    if (parseInt((rec.year_month || '').split('-')[0]) < curYear) {
                        monthSet[rec.year_month + '_' + rec.code] = rec.amount || 0;
                    }
                });
                cum = Object.values(monthSet).reduce(function(a,b){ return a+b; }, 0);
            } else {
                (r.records || []).forEach(function(rec) {
                    if (parseInt((rec.year_month || '').split('-')[0]) < curYear) cum += (rec.amount || 0);
                });
            }
            prevCumMap[p.id] = cum;
        } catch(e) { prevCumMap[p.id] = 0; }
    }));

    let html = _tableHeader('工程名稱', curYear + ' 年目標核銷金額（元）', '前年累積核銷', '目標線（前年＋今年）');
    pipelines.forEach(function(p) {
        const key = '_bcYearTarget_' + p.id + '_' + curYear;
        const saved = parseFloat(localStorage.getItem(key) || '0') || 0;
        const prevCum = prevCumMap[p.id] || 0;
        const targetLine = saved > 0 ? prevCum + saved : 0;
        html += `<tr class="_stRow">
            <td style="${_tdName()}">${_ellipsis(p.name)}</td>
            <td style="${_tdInput()}">
                <input class="_stTargetInput" data-id="${p.id}" data-year="${curYear}" data-prevcum="${prevCum}" type="number"
                    value="${saved || ''}"
                    placeholder="例如：100000000"
                    style="${_inputStyle(120)}">
                <span style="font-size:11px;color:#94a3b8;margin-left:6px;" id="_tgHint_${p.id}">
                    ${saved ? _fmtAmt(saved) : ''}
                </span>
            </td>
            <td style="padding:10px 12px;font-size:12px;color:#64748b;">${prevCum ? _fmtAmt(prevCum) : '—'}</td>
            <td style="padding:10px 12px;font-size:12px;font-weight:600;color:#1565c0;" id="_tgLine_${p.id}">
                ${targetLine ? _fmtAmt(targetLine) : '—'}
            </td>
        </tr>`;
    });
    html += '</table></div>';
    content.innerHTML = html;

    content.querySelectorAll('._stTargetInput').forEach(function(inp) {
        inp.addEventListener('input', function() {
            const hint = document.getElementById('_tgHint_' + inp.dataset.id);
            const line = document.getElementById('_tgLine_' + inp.dataset.id);
            const v = parseFloat(inp.value) || 0;
            const prevCum = parseFloat(inp.dataset.prevcum) || 0;
            if (hint) hint.textContent = v ? _fmtAmt(v) : '';
            if (line) line.textContent = v ? _fmtAmt(prevCum + v) : '—';
        });
    });
}

// ── Tab 4：年度預算（prefix × 年度）────────────────
async function _loadBudgetTab(content) {
    let budgets = [];
    try {
        const r = await apiCall('getAccountingBudget', {});
        budgets = r.budgets || [];
    } catch(e) {}

    // 取得所有 prefix
    const allCodes = [];
    (window.allPipelines || []).forEach(function(p) {
        (p.codes || []).forEach(function(c) {
            const pref = (c.match(/^[A-Za-z]+/) || [''])[0].toUpperCase();
            if (pref && !allCodes.includes(pref)) allCodes.push(pref);
        });
    });
    budgets.forEach(function(b) { if (!allCodes.includes(b.prefix)) allCodes.push(b.prefix); });
    (window._tmpBudgetPrefixes || []).forEach(function(pf) { if (!allCodes.includes(pf)) allCodes.push(pf); });
    allCodes.sort();

    // 年度：從既有預算 + 暫存年度 + 預設範圍
    const curYear = new Date().getFullYear();
    const yearSet = new Set([curYear - 1, curYear, curYear + 1, curYear + 2]);
    budgets.forEach(function(b) { yearSet.add(parseInt(b.year)); });
    (window._tmpBudgetYears || []).forEach(function(y) { yearSet.add(y); });
    const years = Array.from(yearSet).sort(function(a,b){return a-b;});

    const budgetMap = {};
    budgets.forEach(function(b) { budgetMap[b.prefix + '_' + b.year] = b.amount; });

    if (!allCodes.length) {
        content.innerHTML = '<div style="padding:40px;text-align:center;color:#94a3b8;">尚未設定任何會計編號<br><small>請先在「工程設定」頁填入各工程的會計編號</small></div>';
        return;
    }

    const stickyColStyle = 'position:sticky;left:0;z-index:1;box-shadow:2px 0 4px rgba(0,0,0,0.06);';

    let html = '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">';
    html += '<thead><tr style="background:#f8fafc;">';
    const stickyRightStyle = 'position:sticky;right:0;z-index:1;box-shadow:-2px 0 4px rgba(0,0,0,0.06);';

    html += '<th style="padding:10px 16px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569;font-size:11px;white-space:nowrap;background:#f8fafc;' + stickyColStyle + 'z-index:2;">會計科目</th>';
    years.forEach(function(y) {
        html += '<th style="padding:10px 16px;text-align:right;border-bottom:2px solid #e2e8f0;color:#475569;font-size:11px;white-space:nowrap;">' + _toRoc(y) + ' 年預算（元）</th>';
    });
    html += '<th style="padding:10px 16px;text-align:right;border-bottom:2px solid #e2e8f0;color:#1a5fb4;font-size:11px;white-space:nowrap;background:#f0f6ff;' + stickyRightStyle + 'z-index:2;">合計</th>';
    html += '</tr></thead><tbody>';

    allCodes.forEach(function(prefix, ri) {
        const rowBg = ri%2===0?'#fff':'#f8fafc';
        let rowTotal = 0;
        html += '<tr style="background:' + rowBg + ';" class="_stRow">';
        html += '<td style="padding:10px 16px;font-weight:700;color:#1e293b;font-size:13px;border-bottom:1px solid #e2e8f0;background:' + rowBg + ';' + stickyColStyle + '">' +
            '<span style="background:#dbeafe;color:#1e40af;border-radius:4px;padding:2px 8px;">' + prefix + '</span></td>';
        years.forEach(function(y) {
            const val = budgetMap[prefix + '_' + y] || '';
            rowTotal += parseFloat(val) || 0;
            html += '<td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;">' +
                '<div style="display:flex;align-items:center;gap:6px;justify-content:flex-end;">' +
                '<input class="_stBudgetInput" data-prefix="' + prefix + '" data-year="' + y + '" type="text" inputmode="numeric"' +
                ' value="' + _fmtNum(val) + '" placeholder="0" style="' + _inputStyle(130) + ';text-align:right;">' +
                '<span style="font-size:10px;color:#94a3b8;min-width:55px;text-align:right;" id="_bdHint_' + prefix + '_' + y + '">' +
                (val ? _fmtAmt(val) : '') + '</span></div></td>';
        });
        html += '<td style="padding:10px 16px;text-align:right;font-weight:700;color:#1a5fb4;font-size:13px;border-bottom:1px solid #e2e8f0;background:' + rowBg + ';' + stickyRightStyle + '" id="_bdRowTotal_' + prefix + '">' +
            (rowTotal ? _fmtAmt(rowTotal) : '—') + '</td>';
        html += '</tr>';
    });

    // 年度小計列
    let grandTotal = 0;
    html += '<tr style="background:#f0f6ff;">';
    html += '<td style="padding:9px 16px;font-weight:700;color:#1a5fb4;font-size:12px;border-top:2px solid #bfdbfe;background:#f0f6ff;' + stickyColStyle + '">年度小計</td>';
    years.forEach(function(y) {
        let sum = 0;
        allCodes.forEach(function(prefix) { sum += parseFloat(budgetMap[prefix + '_' + y]) || 0; });
        grandTotal += sum;
        html += '<td style="padding:9px 16px;text-align:right;font-weight:700;color:#1a5fb4;font-size:13px;border-top:2px solid #bfdbfe;" id="_bdYearTotal_' + y + '">' +
            (sum ? _fmtAmt(sum) : '—') + '</td>';
    });
    html += '<td style="padding:9px 16px;text-align:right;font-weight:700;color:#1a5fb4;font-size:13px;border-top:2px solid #bfdbfe;background:#f0f6ff;' + stickyRightStyle + '" id="_bdGrandTotal">' +
        (grandTotal ? _fmtAmt(grandTotal) : '—') + '</td>';
    html += '</tr>';

    html += '</tbody></table></div>';

    // 新增會計科目 + 新增年度
    html += '<div style="padding:14px 16px;border-top:1px solid #e2e8f0;display:flex;gap:24px;flex-wrap:wrap;">' +
        '<div><span style="font-size:12px;color:#94a3b8;">新增會計科目：</span>' +
        '<input id="_stNewPrefix" placeholder="例如：DV" maxlength="6" style="width:80px;padding:5px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12px;text-transform:uppercase;">' +
        '<button onclick="_addBudgetPrefix()" style="padding:5px 12px;background:#1e6fdc;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;margin-left:6px;">新增</button></div>' +
        '<div><span style="font-size:12px;color:#94a3b8;">新增年度（民國）：</span>' +
        '<input id="_stNewYear" type="number" placeholder="例如：118" style="width:90px;padding:5px 8px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12px;">' +
        '<button onclick="_addBudgetYear()" style="padding:5px 12px;background:#1e6fdc;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px;margin-left:6px;">新增</button></div>' +
        '</div>';

    content.innerHTML = html;

    content.querySelectorAll('._stBudgetInput').forEach(function(inp) {
        inp.addEventListener('input', function() {
            const raw = inp.value.replace(/,/g, '');
            const v = parseFloat(raw) || 0;
            const hint = document.getElementById('_bdHint_' + inp.dataset.prefix + '_' + inp.dataset.year);
            if (hint) hint.textContent = v ? _fmtAmt(v) : '';
            // 即時更新年度小計（直欄）
            let yearSum = 0;
            document.querySelectorAll('._stBudgetInput[data-year="' + inp.dataset.year + '"]').forEach(function(i2) {
                yearSum += parseFloat(i2.value.replace(/,/g,'')) || 0;
            });
            const yearTotalEl = document.getElementById('_bdYearTotal_' + inp.dataset.year);
            if (yearTotalEl) yearTotalEl.textContent = yearSum ? _fmtAmt(yearSum) : '—';
            // 即時更新會計科目合計（橫列）
            let rowSum = 0;
            document.querySelectorAll('._stBudgetInput[data-prefix="' + inp.dataset.prefix + '"]').forEach(function(i3) {
                rowSum += parseFloat(i3.value.replace(/,/g,'')) || 0;
            });
            const rowTotalEl = document.getElementById('_bdRowTotal_' + inp.dataset.prefix);
            if (rowTotalEl) rowTotalEl.textContent = rowSum ? _fmtAmt(rowSum) : '—';
            // 即時更新總計
            let grand = 0;
            document.querySelectorAll('._stBudgetInput').forEach(function(i4) {
                grand += parseFloat(i4.value.replace(/,/g,'')) || 0;
            });
            const grandEl = document.getElementById('_bdGrandTotal');
            if (grandEl) grandEl.textContent = grand ? _fmtAmt(grand) : '—';
        });
        inp.addEventListener('blur', function() {
            const raw = inp.value.replace(/,/g, '');
            const v = parseFloat(raw) || 0;
            inp.value = v ? _fmtNum(v) : '';
        });
        inp.addEventListener('focus', function() { inp.value = inp.value.replace(/,/g, ''); });
    });
}

window._addBudgetPrefix = function() {
    const inp = document.getElementById('_stNewPrefix');
    if (!inp || !inp.value.trim()) return;
    const prefix = inp.value.trim().toUpperCase();
    inp.value = '';
    window._tmpBudgetPrefixes = window._tmpBudgetPrefixes || [];
    if (!window._tmpBudgetPrefixes.includes(prefix)) window._tmpBudgetPrefixes.push(prefix);
    _loadSettingsTab('budget');
};

window._addBudgetYear = function() {
    const inp = document.getElementById('_stNewYear');
    if (!inp || !inp.value) return;
    const rocYear = parseInt(inp.value);
    if (!rocYear || rocYear < 1 || rocYear > 200) { showToast('請輸入有效民國年度', 'warning'); return; }
    const year = rocYear + 1911; // 轉西元年（內部儲存用）
    inp.value = '';
    window._tmpBudgetYears = window._tmpBudgetYears || [];
    if (!window._tmpBudgetYears.includes(year)) window._tmpBudgetYears.push(year);
    _loadSettingsTab('budget');
};

// ── 儲存 ────────────────────────────────────────
window.saveCurrentSettingsTab = async function() {
    const tab = window._stCurrentTab;
    const status = document.getElementById('_stStatus');
    if (status) status.textContent = '儲存中...';

    try {
        if (tab === 'main')   await _saveMain();
        else if (tab === 'budget') await _saveBudgets();
        if (status) status.textContent = '✅ 已儲存';
        showToast('✅ 設定已儲存', 'success');
        setTimeout(function(){ if (status) status.textContent = ''; }, 3000);
    } catch(e) {
        if (status) status.textContent = '❌ 儲存失敗：' + e.message;
        showToast('❌ 儲存失敗：' + e.message, 'error');
    }
};

async function _saveCodes() {
    const inputs = document.querySelectorAll('._stCodesInput');
    await Promise.all(Array.from(inputs).map(async function(inp) {
        const codes = inp.value.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
        await apiCall('setPipelineCodes', { pipelineId: inp.dataset.id, codes: JSON.stringify(codes) });
    }));
    // 更新 allPipelines.codes
    if (window.allPipelines) {
        document.querySelectorAll('._stCodesInput').forEach(function(inp) {
            const p = allPipelines.find(function(p){ return p.id === inp.dataset.id; });
            if (p) p.codes = inp.value.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
        });
    }
}

async function _saveContracts() {
    const inputs = document.querySelectorAll('._stContractInput');
    await Promise.all(Array.from(inputs).map(async function(inp) {
        const raw = inp.value.replace(/,/g, '');
        if (!raw) return;
        await apiCall('saveContractAmount', { pipelineId: inp.dataset.id, amount: parseFloat(raw) });
    }));
}

async function _saveTargets() {
    document.querySelectorAll('._stTargetInput').forEach(function(inp) {
        const raw = inp.value.replace(/,/g, '');
        const key = '_bcYearTarget_' + inp.dataset.id + '_' + inp.dataset.year;
        const v = parseFloat(raw) || 0;
        if (v > 0) localStorage.setItem(key, v);
        else localStorage.removeItem(key);
    });
}

async function _saveBudgets() {
    const inputs = document.querySelectorAll('._stBudgetInput');
    await Promise.all(Array.from(inputs).map(async function(inp) {
        const v = parseFloat(inp.value.replace(/,/g, ''));
        if (!isNaN(v) && v > 0) {
            await apiCall('saveAccountingBudget', { prefix: inp.dataset.prefix, year: inp.dataset.year, amount: v });
        }
    }));
}

// ── 關閉 ───────────────────────────────────────
window.closeSettingsPanel = function() {
    const overlay = document.getElementById('_settingsOverlay');
    if (overlay) overlay.remove();
};

// ── 工具函式 ──────────────────────────────────
function _tableHeader() {
    const cols = Array.from(arguments);
    let h = '<div style="overflow:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">';
    h += '<thead><tr style="background:#f8fafc;">';
    cols.forEach(function(c, i) {
        h += `<th style="padding:10px ${i===0?'16':'12'}px;text-align:left;border-bottom:2px solid #e2e8f0;color:#475569;font-size:11px;text-transform:uppercase;white-space:nowrap;">${c}</th>`;
    });
    h += '</tr></thead><tbody>';
    return h;
}
function _tdName() { return 'padding:10px 16px;font-size:13px;color:#1e293b;border-bottom:1px solid #e2e8f0;max-width:280px;'; }
function _tdInput() { return 'padding:6px 12px;border-bottom:1px solid #e2e8f0;'; }
function _inputStyle(w) { return 'padding:6px 10px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:12px;font-family:Microsoft JhengHei,Arial,sans-serif;outline:none;transition:border 0.15s;width:' + (w||220) + 'px;'; }
function _ellipsis(s) { return `<span title="${_esc(s)}" style="display:block;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_esc(s)}</span>`; }
function _esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _fmtAmt(v) {
    v = parseFloat(v);
    if (isNaN(v)) return '';
    if (Math.abs(v) >= 1e8) return (v/1e8).toFixed(2) + ' 億';
    if (Math.abs(v) >= 1e4) return Math.round(v/1e4) + ' 萬';
    return v.toLocaleString();
}
function _fmtNum(v) {
    v = parseFloat(v);
    if (isNaN(v) || v === 0) return '';
    return v.toLocaleString('en-US');
}
function _toRoc(westernYear) {
    return (parseInt(westernYear) - 1911);
}
