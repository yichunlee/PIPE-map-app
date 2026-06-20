// ── 工程勾選面板（跨所有計畫，回傳 Promise<Set<id>> 或 null=取消）──
function _showPipelineSelector(pipelines) {
    return new Promise(resolve => {
        const old = document.getElementById('_plSelector');
        if (old) old.remove();

        // 用 allPipelines（全部工程），按計畫分組
        const allPl = (typeof allPipelines !== 'undefined' ? allPipelines : pipelines);
        const groups = {};
        allPl.forEach(pl => {
            const proj = pl.projectName || '未分類';
            if (!groups[proj]) groups[proj] = [];
            groups[proj].push(pl);
        });

        // 預設：同計畫工程全勾，其他不勾
        const currentProjName = currentProject ? (currentProject.name || '') : '';
        let idx = 0;
        let projIdx = 0;
        const groupRows = Object.entries(groups).map(([projName, pls]) => {
            const isCurrentProj = projName === currentProjName;
            const gId = 'plGrp_' + (projIdx++);
            const plRows = pls.map(pl => {
                const i = idx++;
                const checked = isCurrentProj ? 'checked' : '';
                return `<label style="display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:6px;cursor:pointer;"
                               onmouseover="this.style.background='#f5f5f5'" onmouseout="this.style.background=''">
                    <input type="checkbox" id="plChk_${i}" value="${pl.id}" ${checked}
                           style="width:15px;height:15px;accent-color:#4a148c;cursor:pointer;">
                    <span style="font-size:13px;color:#333;">${pl.name || pl.id}</span>
                </label>`;
            }).join('');
            return `<div style="margin-bottom:10px;">
                <div style="font-size:11px;font-weight:bold;color:#7b1fa2;padding:4px 12px 2px;letter-spacing:0.5px;display:flex;align-items:center;justify-content:space-between;">
                    <span>📁 ${projName}</span>
                    <span style="display:flex;gap:6px;">
                        <span onclick="document.getElementById('${gId}').querySelectorAll('input').forEach(c=>c.checked=true)"
                              style="font-size:10px;color:#1976d2;cursor:pointer;font-weight:normal;text-decoration:underline;">全選</span>
                        <span onclick="document.getElementById('${gId}').querySelectorAll('input').forEach(c=>c.checked=false)"
                              style="font-size:10px;color:#999;cursor:pointer;font-weight:normal;text-decoration:underline;">清除</span>
                    </span>
                </div>
                <div id="${gId}" style="background:#fafafa;border-radius:8px;border:1px solid #eee;padding:4px 0;">
                    ${plRows}
                </div>
            </div>`;
        }).join('');

        const backdrop = document.createElement('div');
        backdrop.id = '_plSelector';
        backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
        backdrop.innerHTML = `
            <div style="background:white;border-radius:12px;width:88%;max-width:520px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.3);overflow:hidden;">
                <div style="background:linear-gradient(135deg,#4a148c,#7b1fa2);color:white;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
                    <span style="font-size:15px;font-weight:bold;">📈 S 曲線 — 選擇工程</span>
                    <button onclick="document.getElementById('_plSelector').remove()" style="background:rgba(255,255,255,0.2);border:none;color:white;font-size:16px;cursor:pointer;padding:2px 8px;border-radius:4px;">✕</button>
                </div>
                <div style="padding:8px 16px;border-bottom:1px solid #eee;display:flex;gap:8px;flex-shrink:0;">
                    <button onclick="document.querySelectorAll('[id^=plChk_]').forEach(c=>c.checked=true)"
                            style="flex:1;padding:6px;background:#f3e5f5;color:#4a148c;border:1px solid #ce93d8;border-radius:6px;cursor:pointer;font-size:12px;font-weight:bold;">全選</button>
                    <button onclick="document.querySelectorAll('[id^=plChk_]').forEach(c=>c.checked=false)"
                            style="flex:1;padding:6px;background:#f5f5f5;color:#555;border:1px solid #ddd;border-radius:6px;cursor:pointer;font-size:12px;">全不選</button>
                </div>
                <div style="overflow-y:auto;flex:1;padding:12px 14px;">
                    ${groupRows}
                </div>
                <div style="padding:12px 16px;border-top:1px solid #eee;display:flex;gap:8px;flex-shrink:0;">
                    <button id="_plCancelBtn" style="flex:1;padding:10px;background:#f5f5f5;color:#555;border:1px solid #ddd;border-radius:8px;cursor:pointer;font-size:13px;">取消</button>
                    <button id="_plConfirmBtn" style="flex:2;padding:10px;background:#4a148c;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:bold;">產生 S 曲線</button>
                </div>
            </div>`;

        document.body.appendChild(backdrop);

        document.getElementById('_plConfirmBtn').onclick = () => {
            const checked = new Set(
                Array.from(document.querySelectorAll('[id^=plChk_]:checked')).map(c => c.value)
            );
            backdrop.remove();
            resolve(checked);
        };
        document.getElementById('_plCancelBtn').onclick = () => { backdrop.remove(); resolve(null); };
        backdrop.addEventListener('click', e => { if (e.target === backdrop) { backdrop.remove(); resolve(null); } });
    });
}

// ===== 計畫S曲線（跨工程彙整）=====
// 監聽 blob 視窗的年度篩選訊息
if (!window._scYearFilterListenerAdded) {
    window._scYearFilterListenerAdded = true;
    window.addEventListener('message', function(e) {
        if (e.data && e.data.type === 'scYearFilter') {
            window._scYearFilter = window._scYearFilter ? null : new Date().getFullYear();
            showProjectSCurve(window._scYearFilter);
        }
    });
}

async function showProjectSCurve(yearFilter) {
    if (!allPipelines || !allPipelines.length) { showToast('尚無工程資料', 'warning'); return; }

    let selectedPipelines;
    // 若是年度篩選切換（已有快取），直接重用上次選的工程
    if (yearFilter !== undefined && window._scLastSelectedPipelines && window._scLastSelectedPipelines.length) {
        selectedPipelines = window._scLastSelectedPipelines;
    } else {
        // ── 先顯示工程勾選面板（跨所有計畫）──
        const selectedIds = await _showPipelineSelector(allPipelines);
        if (!selectedIds) return; // 使用者按取消
        selectedPipelines = allPipelines.filter(p => selectedIds.has(p.id));
        if (!selectedPipelines.length) { showToast('請至少勾選一個工程', 'warning'); return; }
        window._scLastSelectedPipelines = selectedPipelines; // 快取
    }

    showToast('載入中...', 'info');

    // 同時抓取預算設定
    let budgetData = {};
    try {
        const br = await apiCall('getAccountingBudget', {});
        (br.budgets || []).forEach(b => {
            const key = b.prefix + '_' + b.year;
            budgetData[key] = b.amount;
        });
    } catch(e) {}

    // 平行抓取所有工程的甘特 + 單價 + 小段進度
    const fetchResults = await Promise.all(selectedPipelines.map(async pl => {
        try {
            const [ganttRes, upRes, segRes, smallRes, accRes, codesRes] = await Promise.all([
                apiCall('getGanttItems', { pipelineId: pl.id }),
                apiCall('getUnitPrices', { pipelineId: pl.id }),
                apiCall('getProgress', { pipelineId: pl.id }),
                apiCall('getAllSmallSegments', { pipelineId: pl.id }),
                apiCall('getAccounting', { pipelineId: pl.id }).catch(() => ({ records: [] })),
                apiCall('getPipelineCodes', { pipelineId: pl.id }).catch(() => ({ codes: [] }))
            ]);
            // 新架構優先用 getAllSmallSegments 的 branches，舊架構用 getProgress 的 segments
            const branches = smallRes.branches && Object.keys(smallRes.branches).length > 0
                ? smallRes.branches
                : (pl.branches || {});
            return {
                pipeline: pl,
                items: ganttRes.items || [],
                unitPrices: upRes.prices || [],
                segments: segRes.segments || [],
                branches,
                accRecords: accRes.records || [],
                accByCode: accRes.byCode || [],
                codes: codesRes.codes || []
            };
        } catch(e) { return { pipeline: pl, items: [], unitPrices: [], segments: [], branches: {}, accRecords: [] }; }
    }));

    // 計算每條工程的月度預算
    const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const YEAR_COLORS = { 2024:'rgba(158,158,158,0.12)', 2025:'rgba(56,142,60,0.12)', 2026:'rgba(25,118,210,0.12)', 2027:'rgba(229,57,53,0.12)', 2028:'rgba(255,152,0,0.12)' };
    const YEAR_TEXT = { 2024:'#9e9e9e', 2025:'#388e3c', 2026:'#1976d2', 2027:'#e53935', 2028:'#ff9800' };

    function getItemProgressLocal(item, segments, branches) {
        if (item.status && item.status.toString().startsWith('custom:')) {
            var r = parseFloat(item.status.toString().split(':')[1]) / 100;
            return { rate: isNaN(r) ? 0 : Math.min(1, Math.max(0, r)), isCustom: true };
        }
        // 新架構：branches
        const hasBranches = branches && Object.keys(branches).length > 0;
        if (hasBranches) {
            const branchKey = item.segmentNumber;
            const segs = branchKey && branches[branchKey] ? branches[branchKey] : null;
            if (segs) {
                const from = item.fromSmall != null ? Number(item.fromSmall) : 0;
                const to   = item.toSmall   != null ? Number(item.toSmall)   : segs.length - 1;
                let done = 0, total = 0;
                segs.forEach(seg => {
                    if (seg.smallIndex < from || seg.smallIndex > to) return;
                    const len = seg.endDistance - seg.startDistance;
                    total += len;
                    if (seg.status && seg.status !== '0' && seg.status.trim() !== '') done += len;
                });
                return { done: Math.round(done), total: Math.round(total), rate: total > 0 ? done / total : 0 };
            }
            // fallback：prefix 比對
            const label = item.label || '';
            const dashIdx = label.lastIndexOf(' - ');
            const prefix = dashIdx >= 0 ? label.substring(0, dashIdx).trim() : '';
            const nodeMatch = label.match(/- (.+)至(.+)（/);
            const fromNode = nodeMatch ? nodeMatch[1].trim() : null;
            const toNode   = nodeMatch ? nodeMatch[2].trim() : null;
            let done = 0, total = 0, found = false;
            Object.values(branches).forEach(bsegs => {
                const first = bsegs.find(s => s.diameter || s.pipeType || s.method);
                if (!first) return;
                const bp = [first.diameter||'', first.pipeType||'', first.method||''].filter(Boolean).join(' ');
                if (bp !== prefix) return;
                let fi = 0, ti = bsegs.length - 1;
                if (fromNode) { const x = bsegs.findIndex(s => s.nodeName === fromNode); if (x >= 0) fi = bsegs[x].smallIndex; }
                if (toNode)   { const x = bsegs.findIndex(s => s.nodeName === toNode);   if (x >= 0) ti = bsegs[x].smallIndex; }
                bsegs.forEach(seg => {
                    if (seg.smallIndex < fi || seg.smallIndex > ti) return;
                    const len = seg.endDistance - seg.startDistance;
                    total += len;
                    if (seg.status && seg.status !== '0' && seg.status.trim() !== '') done += len;
                    found = true;
                });
            });
            if (!found) return null;
            return { done: Math.round(done), total: Math.round(total), rate: total > 0 ? done / total : 0 };
        }
        // 舊架構：segments
        const label = item.label || '';
        const segMatch = label.match(/段落([A-Za-z0-9\-]+)/);
        const rangeMatch = label.match(/#(\d+)～#(\d+)/);
        if (!segMatch) return null;
        const seg = segments.find(s => String(s.segmentNumber) === segMatch[1]);
        if (!seg) return null;
        const arr = (seg.smallSegments || '').split(',').map(s => s.trim());
        const segLen = seg.endDistance - seg.startDistance;
        const numSmall = Math.ceil(segLen / 10);
        const from = rangeMatch ? parseInt(rangeMatch[1]) - 1 : 0;
        const to = rangeMatch ? parseInt(rangeMatch[2]) - 1 : numSmall - 1;
        let done = 0, total = 0;
        for (let i = from; i <= to; i++) {
            const smallLen = Math.min(10, segLen - i * 10);
            total += smallLen;
            if (arr[i] && arr[i] !== '0' && arr[i].trim() !== '') done += smallLen;
        }
        return { done: Math.round(done), total: Math.round(total), rate: total > 0 ? done / total : 0 };
    }

    function getEffectiveUnitPriceLocal(item, unitPrices) {
        // 自訂項目用 per-item 單價；管線項目用施工單價工作表
        if (item.status && item.status.toString().startsWith('custom:')) {
            return (item.unitPrice && item.unitPrice > 0) ? +item.unitPrice : 0;
        }
        const label = item.label || '';
        const match = unitPrices.find(p => label.indexOf(p.methodKey) >= 0);
        return match ? +match.unitPrice : 0;
    }

    function computeMonthly(items, unitPrices, segments, branches) {
        const map = {};
        items.forEach(item => {
            const prog = getItemProgressLocal(item, segments, branches);
            const up = getEffectiveUnitPriceLocal(item, unitPrices);
            let totalYen = 0;
            if (item.status && item.status.toString().startsWith('custom:') && up) {
                totalYen = up;
            } else {
                const totalLen = prog ? prog.total : 0;
                if (!totalLen || !up) return;
                totalYen = totalLen * up;
            }
            if (!totalYen) return;
            const start = new Date(item.startDate), end = new Date(item.endDate);
            const totalDays = Math.max(1, Math.round((end - start) / 86400000));
            let cur = new Date(start.getFullYear(), start.getMonth(), 1);
            while (cur <= end) {
                const mStart = new Date(Math.max(cur.getTime(), start.getTime()));
                const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
                const mEnd = new Date(Math.min(nextMonth.getTime() - 1, end.getTime()));
                const mDays = Math.max(0, Math.round((mEnd - mStart) / 86400000) + 1);
                const key = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0');
                map[key] = (map[key] || 0) + totalYen * (mDays / totalDays);
                cur = nextMonth;
            }
        });
        const sorted = Object.keys(map).sort();
        let cum = 0;
        return sorted.map(m => { cum += map[m]; return { month: m, monthly: map[m], cumulative: cum }; });
    }

    // 每條工程的曲線資料（依 filterYear 過濾）
    const _filterYear = yearFilter || null;
    const pipelineRows = fetchResults.map((r, idx) => {
        let rows = computeMonthly(r.items, r.unitPrices, r.segments, r.branches);
        // 本年度模式：只留當年月份，累積從年初重算
        if (_filterYear) {
            rows = rows.filter(row => parseInt(row.month.split('-')[0]) === _filterYear);
            let cum = 0;
            rows = rows.map(row => { cum += row.monthly; return { ...row, cumulative: cum }; });
        }
        const hue = Math.round((idx / fetchResults.length) * 300);
        return { name: r.pipeline.name || r.pipeline.id, rows, color: 'hsl(' + hue + ',70%,45%)' };
    }).filter(r => r.rows.length > 0);

    const hasPlan = pipelineRows.length > 0;
    if (!hasPlan) showToast('各工程尚未設定單價，僅顯示核銷資料', 'info');

    // 合計曲線
    const totalMap = {};
    pipelineRows.forEach(pr => {
        pr.rows.forEach(r => { totalMap[r.month] = (totalMap[r.month] || 0) + r.monthly; });
    });
    const totalMonths = Object.keys(totalMap).sort();
    let totalCum = 0;
    const totalRows = totalMonths.map(m => { totalCum += totalMap[m]; return { month: m, monthly: totalMap[m], cumulative: totalCum }; });

    // 核銷資料：各工程分開（用於分色柱狀圖）+ 合計（用於累積折線）
    const accByPipeline = fetchResults.map((r, idx) => {
        const monthlyMap = {};
        (r.accRecords || []).forEach(rec => {
            monthlyMap[rec.year_month] = (monthlyMap[rec.year_month] || 0) + rec.amount;
        });
        return { name: r.pipeline.name || r.pipeline.id, monthlyMap, color: pipelineRows[idx] ? pipelineRows[idx].color : 'hsl(' + Math.round(idx/fetchResults.length*300) + ',70%,45%)' };
    }).filter(p => Object.keys(p.monthlyMap).length > 0);

    const accMonthlyMap = {}; // 合計：year_month -> 月金額
    accByPipeline.forEach(p => {
        Object.entries(p.monthlyMap).forEach(([m, v]) => {
            accMonthlyMap[m] = (accMonthlyMap[m] || 0) + v;
        });
    });
    const accSortedMonths = Object.keys(accMonthlyMap).sort();
    let accCumTotal = 0;
    const accCumMap = {}; // year_month -> 累積金額
    accSortedMonths.forEach(m => { accCumTotal += accMonthlyMap[m]; accCumMap[m] = accCumTotal; });
    const hasAcc = accSortedMonths.length > 0;

    // 若有年度篩選，重新計算該年度的累積核銷（從年初起算）
    const filterYear = yearFilter || null;
    let filteredAccMonthlyMap = accMonthlyMap;
    let filteredAccCumMap = accCumMap;
    let filteredAccSortedMonths = accSortedMonths;
    if (filterYear) {
        filteredAccMonthlyMap = {};
        Object.entries(accMonthlyMap).forEach(([m, v]) => {
            if (parseInt(m.split('-')[0]) === filterYear) filteredAccMonthlyMap[m] = v;
        });
        filteredAccSortedMonths = Object.keys(filteredAccMonthlyMap).sort();
        let cum = 0;
        filteredAccCumMap = {};
        filteredAccSortedMonths.forEach(m => { cum += filteredAccMonthlyMap[m]; filteredAccCumMap[m] = cum; });
    }

    // 計算各前綴各年度的核銷加總（用於對比年度預算）
    // prefix 從 accByPipeline 的 pipeline.id 前兩碼取得
    const accByPrefixYear = {}; // prefix_year -> 累積金額
    fetchResults.forEach(r => {
        (r.accRecords || []).forEach(rec => {
            // 從各工程的 accounting_codes 取前綴
        });
    });
    // 改從 accByPipeline 取前綴（用工程名稱對應的code）
    // 直接從 accounting_by_code 取（若有）—— 這裡用工程編號前綴
    // 前綴 = accounting code 前兩碼（BT/BU/BV/WR...）
    // accByPipeline 的 color/name 是工程名稱，不是 code
    // 用 accMonthlyMap 月份金額對比 prefixYear budget
    // 策略：從 accSortedMonths 的年份，搭配 accCumMap 找各年底累積值
    const budgetYears = [...new Set(Object.keys(budgetData).map(k => parseInt(k.split('_')[1])))].sort();
    // 各年度核銷合計（1月到12月）
    const accByYear = {}; // year -> 當年核銷總額
    accSortedMonths.forEach(m => {
        const yr = parseInt(m.split('-')[0]);
        accByYear[yr] = (accByYear[yr] || 0) + accMonthlyMap[m];
    });
    // 各前綴核銷：需從 accByPipeline 的工程核銷資料中取 code 前綴
    // 先收集所有工程的 code (從 pipeline.id 或 accounting codes)
    // 用 byCode（accounting_by_code）精確計算各前綴各年度核銷，避免重複計算
    const prefixAccByYear = {}; // prefix -> year -> amount
    fetchResults.forEach(r => {
        (r.accByCode || []).forEach(rec => {
            const prefix = (rec.code || '').match(/^[A-Za-z]+/)?.[0]?.toUpperCase() || '';
            if (!prefix) return;
            const yr = parseInt((rec.year_month || '').split('-')[0]);
            if (!yr) return;
            if (!prefixAccByYear[prefix]) prefixAccByYear[prefix] = {};
            prefixAccByYear[prefix][yr] = (prefixAccByYear[prefix][yr] || 0) + rec.amount;
        });
    });
    const hasBudget = Object.keys(budgetData).length > 0;

    // 時間軸範圍（含核銷月份）
    const allMonths = totalRows.map(r => r.month);
    const allRangeMonths = [...new Set([...(filterYear ? allMonths.filter(m => parseInt(m.split('-')[0]) >= filterYear) : allMonths), ...filteredAccSortedMonths])].sort();
    const minMonth = allRangeMonths[0], maxMonth = allRangeMonths[allRangeMonths.length - 1];
    const [minY, minM] = minMonth.split('-').map(Number);
    const [maxY, maxM] = maxMonth.split('-').map(Number);
    const minDate = new Date(minY, minM - 2, 1);
    const maxDate = new Date(maxY, maxM + 1, 0);
    const totalRange = maxDate - minDate;
    const grandTotal = totalRows.length ? totalRows[totalRows.length - 1].cumulative : 0;
    // Y軸最大值：本年度篩選時用本年度資料；全期用全部資料
    const accCumMax = hasAcc ? accCumMap[accSortedMonths[accSortedMonths.length-1]] : 0;
    let yMax;
    if (filterYear) {
        // 本年度模式：Y軸最大值 = 本年度計畫最高點 + 本年度核銷最高點 + 本年度總預算
        const filterYearRows = totalRows.filter(r => parseInt(r.month.split('-')[0]) === filterYear);
        const filterYearPlanMax = filterYearRows.length ? filterYearRows[filterYearRows.length - 1].cumulative : 0;
        const filterYearAccCum = filteredAccCumMap[filteredAccSortedMonths[filteredAccSortedMonths.length - 1]] || 0;
        // 計算本年度各前綴預算合計（只算 filterYear 那一條線的金額，不累積）
        let filterYearBudgetMax = 0;
        Object.keys(budgetData).forEach(k => {
            const [prefix, yr] = k.split('_');
            if (parseInt(yr) === filterYear) filterYearBudgetMax += budgetData[k];
        });
        yMax = Math.max(filterYearPlanMax, filterYearAccCum, filterYearBudgetMax, 1) * 1.15;
    } else {
        yMax = Math.max(grandTotal, accCumMax, 1) * 1.1;
    }

    function dateToPct(d) { return Math.max(0, Math.min(100, (d - minDate) / totalRange * 100)); }
    function midDate(m) { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 15); }
    function fmtY(v) {
        if (v === 0) return '0';
        if (v >= 1e8) return (Math.round(v/1e6)/100).toFixed(2) + '億';
        if (v >= 1e4) return Math.round(v/1e4) + '萬';
        return Math.round(v/100)*100 > 0 ? (Math.round(v/100)*100).toLocaleString() : Math.round(v).toLocaleString();
    }

    // 建立 blob 視窗 HTML
    const todayPct = dateToPct(new Date());

    // SVG points per pipeline
    function buildPolyline(rows) {
        return rows.map(r => {
            const p = dateToPct(midDate(r.month)) * 10;
            const y = (1 - r.cumulative / yMax) * 100;
            return p.toFixed(1) + ',' + y.toFixed(1);
        }).join(' ');
    }
    function buildArea(rows) {
        const pts = rows.map(r => {
            const p = dateToPct(midDate(r.month)) * 10;
            const y = (1 - r.cumulative / yMax) * 100;
            return 'L' + p.toFixed(1) + ',' + y.toFixed(1);
        }).join(' ');
        const lastP = (dateToPct(midDate(rows[rows.length-1].month)) * 10).toFixed(1);
        return 'M0,100 ' + pts + ' L' + lastP + ',100 Z';
    }

    // Y 軸刻度
    const yTickFracs = [0, 0.25, 0.5, 0.75, 1];

    // X 軸（年份 + 月份）
    const totalMonthCount = (maxDate.getFullYear() - minDate.getFullYear()) * 12 + (maxDate.getMonth() - minDate.getMonth());
    const xStep = totalMonthCount < 7 ? 1 : totalMonthCount < 19 ? 2 : 3;
    let xYearHtml = '', xMonHtml = '';
    let xYCur = new Date(minDate.getFullYear(), 0, 1);
    while (xYCur <= maxDate) {
        const yr = xYCur.getFullYear();
        const yrS = new Date(Math.max(xYCur.getTime(), minDate.getTime()));
        const yrE = new Date(Math.min(new Date(yr, 11, 31).getTime(), maxDate.getTime()));
        const sp = ((yrS - minDate) / totalRange * 100).toFixed(2);
        const wp = ((yrE - yrS) / totalRange * 100).toFixed(2);
        const bg = (YEAR_COLORS[yr] || 'rgba(158,158,158,0.1)');
        const tc = (YEAR_TEXT[yr] || '#9e9e9e');
        xYearHtml += '<div style="position:absolute;left:' + sp + '%;width:' + wp + '%;height:12px;background:' + bg + ';border-right:1px solid #ddd;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;color:' + tc + ';">' + yr + '</div>';
        xYCur = new Date(yr + 1, 0, 1);
    }
    let xMCur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    while (xMCur <= maxDate) {
        if (xMCur >= minDate) {
            const pp = ((xMCur - minDate) / totalRange * 100).toFixed(2);
            xMonHtml += '<div style="position:absolute;left:' + pp + '%;transform:translateX(-50%);font-size:9px;color:#555;white-space:nowrap;">' + MONTHS_SHORT[xMCur.getMonth()] + '</div>';
        }
        xMCur.setMonth(xMCur.getMonth() + xStep);
    }

    // 統計卡
    const today = new Date();
    const todayKey = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
    const todayCumRow = totalRows.filter(r => r.month <= todayKey);
    const todayCum = todayCumRow.length ? todayCumRow[todayCumRow.length - 1].cumulative : 0;
    const actualDone = fetchResults.reduce((sum, r) => {
        return sum + r.items.reduce((s2, item) => {
            const prog = getItemProgressLocal(item, r.segments, r.branches);
            const up = getEffectiveUnitPriceLocal(item, r.unitPrices);
            if (!prog || !up) return s2;
            if (item.status && item.status.toString().startsWith('custom:')) return s2 + up * prog.rate;
            return s2 + prog.done * up;
        }, 0);
    }, 0);

    // 計算統計卡數字
    const statYear = filterYear || null; // 本年度篩選用 filterYear，全期用 null

    // 收集所有 prefix
    const allPrefixesInBudget = new Set();
    Object.keys(budgetData).forEach(k => { allPrefixesInBudget.add(k.split('_')[0]); });

    let statsHtml;
    if (statYear) {
        // ===== 本年度篩選：顯示該年度預算 / 核銷 / 執行率 =====
        let totalBudgetStatYear = 0;
        const prefixesInBudget = new Set();
        Object.keys(budgetData).forEach(k => {
            const [prefix, yr] = k.split('_');
            if (parseInt(yr) === statYear) {
                totalBudgetStatYear += budgetData[k];
                prefixesInBudget.add(prefix);
            }
        });

        // 年度核銷「總金額」：用 accMonthlyMap（與圖表橘色曲線同源，不遺漏）
        let totalAccStatYear = 0;
        accSortedMonths.forEach(m => {
            if (parseInt(m.split('-')[0]) === statYear) totalAccStatYear += accMonthlyMap[m];
        });

        // 各 prefix 明細：用 byCode（有就顯示，沒有就不顯示）
        const accByPrefix = {};
        prefixesInBudget.forEach(prefix => {
            const amt = (prefixAccByYear[prefix] && prefixAccByYear[prefix][statYear]) || 0;
            accByPrefix[prefix] = amt;
        });
        const byCodeTotal = [...prefixesInBudget].reduce((s, p) => s + (accByPrefix[p] || 0), 0);
        // 只有 byCode 接近總金額時才顯示明細（避免明細遺漏造成誤解）
        const showAccDetail = byCodeTotal > 0 && byCodeTotal >= totalAccStatYear * 0.8;
        const accDetailStr = showAccDetail
            ? [...prefixesInBudget].sort().map(p => p + ' ' + fmtY(accByPrefix[p] || 0)).join('、')
            : '';

        const budgetExecPct = totalBudgetStatYear > 0 ? Math.round(totalAccStatYear / totalBudgetStatYear * 100) : null;
        const budgetDetail = [...prefixesInBudget].sort().map(p => p + ' ' + fmtY(budgetData[p + '_' + statYear] || 0)).join('、');

        // 各 prefix 執行率
        const prefixExecDetail = [...prefixesInBudget].sort().map(p => {
            const b = budgetData[p + '_' + statYear] || 0;
            const a = accByPrefix[p] || 0;
            const pct = b > 0 ? Math.round(a / b * 100) : 0;
            return p + ' ' + pct + '%';
        }).join('、');

        statsHtml =
            '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;align-items:center;font-size:13px;">' +
            (totalBudgetStatYear > 0
                ? '<span><span style="color:#7b1fa2;">' + (statYear-1911) + '年計畫預算：</span><strong style="color:#4a148c;">' + fmtY(totalBudgetStatYear) + ' 元</strong><span style="font-size:10px;color:#7b1fa2;margin-left:4px;">（' + budgetDetail + '）</span></span>'
                : '<span style="color:#e65100;">⚠️ 尚未設定 ' + (statYear-1911) + ' 年預算</span>'
            ) +
            (hasAcc ? '<span style="color:#ccc;">|</span><span><span style="color:#e65100;">' + (statYear-1911) + '年核銷：</span><strong style="color:#bf360c;">' + fmtY(totalAccStatYear) + ' 元</strong>' + (accDetailStr ? '<span style="font-size:10px;color:#bf360c;margin-left:4px;">（' + accDetailStr + '）</span>' : '') + '</span>' : '') +
            (budgetExecPct !== null ? '<span style="color:#ccc;">|</span><span><span style="color:#1565c0;">' + (statYear-1911) + '年預算執行：</span><strong style="color:#0d47a1;">' + budgetExecPct + '%</strong>' + (prefixExecDetail ? '<span style="font-size:10px;color:#1565c0;margin-left:4px;">（' + prefixExecDetail + '）</span>' : '') + '</span>' : '') +
            '</div>';
    } else {
        // ===== 全期：顯示計畫總預算 / 累積至今 / 實際完成 / 累積核銷 =====
        const grandTotal2 = totalRows.length ? totalRows[totalRows.length - 1].cumulative : 0;
        const todayKey2 = new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0');
        const todayCumRow2 = totalRows.filter(r => r.month <= todayKey2);
        const todayCum2 = todayCumRow2.length ? todayCumRow2[todayCumRow2.length - 1].cumulative : 0;
        const actualDone2 = fetchResults.reduce((sum, r) => {
            return sum + r.items.reduce((s2, item) => {
                const prog = getItemProgressLocal(item, r.segments, r.branches);
                const up = getEffectiveUnitPriceLocal(item, r.unitPrices);
                if (!prog || !up) return s2;
                if (item.status && item.status.toString().startsWith('custom:')) return s2 + up * prog.rate;
                return s2 + prog.done * up;
            }, 0);
        }, 0);
        const accCumTotal2 = hasAcc ? accCumMap[accSortedMonths[accSortedMonths.length-1]] : 0;

        // 全期各 prefix 累積核銷明細
        const allPrefixes2 = Object.keys(prefixAccByYear).sort();
        const accDetailAll = allPrefixes2.map(p => {
            let total = 0;
            Object.values(prefixAccByYear[p]).forEach(v => total += v);
            return p + ' ' + fmtY(total);
        });
        const accDetailAllStr = accDetailAll.length ? '<span style="font-size:10px;color:#bf360c;margin-left:4px;">（' + accDetailAll.join('、') + '）</span>' : '';

        // 全期計畫總預算各 prefix 明細（用 budgetData 所有年加總）
        const allBudgetPrefixes = [...new Set(Object.keys(budgetData).map(k => k.split('_')[0]))].sort();
        const budgetByPrefix2 = {};
        Object.keys(budgetData).forEach(k => {
            const [p] = k.split('_');
            budgetByPrefix2[p] = (budgetByPrefix2[p] || 0) + budgetData[k];
        });
        const planBudgetTotal2 = Object.values(budgetByPrefix2).reduce((s, v) => s + v, 0);
        const planBudgetDetail2 = allBudgetPrefixes.map(p => p + ' ' + fmtY(budgetByPrefix2[p] || 0)).join('、');

        // 達成率：累積核銷 / 計畫總預算
        const totalBudgetExecPct2 = planBudgetTotal2 > 0 ? Math.round(accCumTotal2 / planBudgetTotal2 * 100) : null;

        // 各 prefix 達成率（核銷 / 預算）
        const prefixExecDetail2 = allBudgetPrefixes.filter(p => budgetByPrefix2[p] > 0).map(p => {
            let accTotal = 0;
            Object.values(prefixAccByYear[p] || {}).forEach(v => accTotal += v);
            const pct = Math.round(accTotal / budgetByPrefix2[p] * 100);
            return p + ' ' + pct + '%';
        }).join('、');

        statsHtml =
            '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;align-items:center;font-size:13px;">' +
            (planBudgetTotal2 > 0
                ? '<span><span style="color:#7b1fa2;">計畫總預算：</span><strong style="color:#4a148c;">' + fmtY(planBudgetTotal2) + ' 元</strong><span style="font-size:10px;color:#7b1fa2;margin-left:4px;">（' + planBudgetDetail2 + '）</span></span>'
                : (hasPlan
                    ? '<span><span style="color:#7b1fa2;">計畫總預算：</span><strong style="color:#4a148c;">' + fmtY(grandTotal2) + ' 元</strong></span>'
                    : '<span style="color:#e65100;">⚠️ 尚未設定施工單價，僅顯示核銷支用資料</span>')
            ) +
            (hasAcc ? '<span style="color:#ccc;">|</span><span><span style="color:#e65100;">累積核銷：</span><strong style="color:#bf360c;">' + fmtY(accCumTotal2) + ' 元</strong>' + accDetailAllStr + '</span>' : '') +
            (totalBudgetExecPct2 !== null ? '<span style="color:#ccc;">|</span><span><span style="color:#1565c0;">總預算達成率：</span><strong style="color:#0d47a1;">' + totalBudgetExecPct2 + '%</strong>' + (prefixExecDetail2 ? '<span style="font-size:10px;color:#1565c0;margin-left:4px;">（' + prefixExecDetail2 + '）</span>' : '') + '</span>' : '') +
            '</div>';
    }

    // 圖例：有計畫S曲線的工程 + 有核銷但無計畫的工程
    const planNames = new Set(pipelineRows.map(pr => pr.name));
    const accOnlyEntries = accByPipeline.filter(p => !planNames.has(p.name));

    const _lgItem = (icon, label, color) =>
        '<span style="display:inline-flex;align-items:center;gap:5px;margin:3px 12px 3px 0;font-size:11px;color:' + (color||'#333') + ';font-family:Arial,\'Microsoft JhengHei\',sans-serif;">' +
        icon + label + '</span>';
    const _lgLine = (color, dash) =>
        '<span style="display:inline-block;width:22px;height:0;border-top:' + (dash?'3px dashed ':'3px solid ') + color + ';vertical-align:middle;"></span>';
    const _lgBar = (color) =>
        '<span style="display:inline-block;width:13px;height:11px;background:' + color + ';opacity:0.55;border-radius:1px;vertical-align:middle;"></span>';
    const _lgThick = (color) =>
        '<span style="display:inline-block;width:22px;height:0;border-top:4px solid ' + color + ';vertical-align:middle;"></span>';

    const legendHtml =
    pipelineRows.map(pr => _lgItem(_lgLine(pr.color, false), pr.name, '#333')).join('') +
    accOnlyEntries.map(p => _lgItem(_lgBar(p.color), p.name, '#555')).join('') +
    (hasPlan ? _lgItem(_lgThick('#4a148c'), '<strong>計畫合計</strong>', '#4a148c') : '') +
    (hasAcc ?
        _lgItem(_lgLine('#e65100', true), '累積核銷', '#e65100') +
        _lgItem(_lgBar('#e65100'), '當月核銷', '#e65100')
    : '');

    // SVG layers（只放面積、折線、格線、今日線 — 不放圓點，避免橢圓）
    const CHART_H = 260;
    // 各層分開存，方便勾選控制
    let planLayerSvg = '';
    // 各工程面積（半透明）
    pipelineRows.forEach(pr => {
        planLayerSvg += '<path d="' + buildArea(pr.rows) + '" fill="' + pr.color + '" opacity="0.07"/>';
        planLayerSvg += '<polyline points="' + buildPolyline(pr.rows) + '" fill="none" stroke="' + pr.color + '" stroke-width="1.5" vector-effect="non-scaling-stroke" opacity="0.7"/>';
    });
    // 合計粗線（有計畫資料才畫）
    if (hasPlan && totalRows.length) {
        planLayerSvg += '<path d="' + buildArea(totalRows) + '" fill="#7b1fa2" opacity="0.12"/>';
        planLayerSvg += '<polyline points="' + buildPolyline(totalRows) + '" fill="none" stroke="#4a148c" stroke-width="3" vector-effect="non-scaling-stroke"/>';
    }
    // 今日線 + 格線（固定顯示）
    const todayX = (todayPct * 10).toFixed(1);
    let yGridSvg = '<line x1="' + todayX + '" y1="0" x2="' + todayX + '" y2="100" stroke="#e53935" stroke-width="1.5" stroke-dasharray="4,3" vector-effect="non-scaling-stroke"/>';
    yTickFracs.forEach(f => {
        const y = ((1 - f) * 100).toFixed(1);
        yGridSvg += '<line x1="0" y1="' + y + '" x2="1000" y2="' + y + '" stroke="#eee" stroke-width="0.5"/>';
    });
    let svgLayers = yGridSvg; // 先放格線
    // 年度預算水平線（各前綴各年度，高度=累積預算）
    // budgetLayerSvg 分開存，方便勾選控制
    let budgetLayerSvg = '';
    if (hasBudget) {
        const prefixes = [...new Set(Object.keys(budgetData).map(k => k.split('_')[0]))].sort();
        if (filterYear) {
            // ===== 本年度：畫一條合計線 =====
            let totalBudget = 0;
            const details = [];
            prefixes.forEach(prefix => {
                const key = prefix + '_' + filterYear;
                if (!budgetData[key]) return;
                totalBudget += budgetData[key];
                details.push(prefix + ' ' + fmtY(budgetData[key]));
            });
            if (totalBudget > 0) {
                const xStart = (dateToPct(new Date(filterYear, 0, 1)) * 10).toFixed(1);
                const xEnd = (dateToPct(new Date(filterYear, 11, 31)) * 10).toFixed(1);
                const yBudget = ((1 - totalBudget / yMax) * 100).toFixed(1);
                const titleText = (filterYear-1911) + '年預算合計：' + Math.round(totalBudget).toLocaleString() + '元（' + details.join('、') + '）';
                budgetLayerSvg += '<line x1="' + xStart + '" y1="' + yBudget + '" x2="' + xEnd + '" y2="' + yBudget + '" stroke="#2e7d32" stroke-width="2" stroke-dasharray="8,4" vector-effect="non-scaling-stroke" opacity="0.9"><title>' + titleText + '</title></line>';
                budgetLayerSvg += '<text x="' + (parseFloat(xStart)+2) + '" y="' + (parseFloat(yBudget)-2) + '" font-size="8" fill="#2e7d32" text-anchor="start" vector-effect="non-scaling-stroke">' + (filterYear-1911) + '年預算 ' + fmtY(totalBudget) + '</text>';
            }
        } else {
            // ===== 全期：畫一條「計畫總預算」水平線（所有年度所有prefix加總）=====
            let grandBudget = 0;
            const prefixTotals = {};
            prefixes.forEach(prefix => {
                prefixTotals[prefix] = 0;
                budgetYears.forEach(yr => { prefixTotals[prefix] += budgetData[prefix + '_' + yr] || 0; });
                grandBudget += prefixTotals[prefix];
            });
            if (grandBudget > 0) {
                // 線段橫跨整個 X 軸範圍
                const yBudget = ((1 - grandBudget / yMax) * 100).toFixed(1);
                const detailLabel = prefixes.filter(p => prefixTotals[p] > 0).map(p => p + ' ' + fmtY(prefixTotals[p])).join('、');
                const titleText = '計畫總預算：' + fmtY(grandBudget) + '（' + detailLabel + '）';
                budgetLayerSvg += '<line x1="0" y1="' + yBudget + '" x2="1000" y2="' + yBudget + '" stroke="#2e7d32" stroke-width="1.5" stroke-dasharray="8,4" vector-effect="non-scaling-stroke" opacity="0.85"><title>' + titleText + '</title></line>';
                budgetLayerSvg += '<text x="2" y="' + (parseFloat(yBudget)-2) + '" font-size="7.5" fill="#2e7d32" text-anchor="start" vector-effect="non-scaling-stroke">計畫總預算 ' + fmtY(grandBudget) + '（' + detailLabel + '）</text>';
            }
        }
    }
    svgLayers += budgetLayerSvg;
    // 核銷：當月柱狀圖 + 累積折線（分層存）
    let accBarsSvg = '', accLineSvg = '';
    if (hasAcc) {
        const accMonthlyMax = Math.max(...Object.values(filteredAccMonthlyMap)) * 1.15;
        const barW = Math.max(0.5, 1000 / Math.max(filteredAccSortedMonths.length, 1) * 0.3);
        const accLinePts = [];
        filteredAccSortedMonths.forEach(m => {
            const xPct = parseFloat((dateToPct(midDate(m)) * 10).toFixed(1));
            let stackY = 100;
            accByPipeline.forEach(pl => {
                const v = pl.monthlyMap[m] || 0;
                if (!v) return;
                const bH = parseFloat((v / accMonthlyMax * 100).toFixed(2));
                stackY -= bH;
                accBarsSvg += '<rect x="' + (xPct - barW/2).toFixed(1) + '" y="' + stackY.toFixed(2) + '" width="' + barW.toFixed(1) + '" height="' + bH.toFixed(2) + '" fill="' + pl.color + '" opacity="0.55" vector-effect="non-scaling-stroke"><title>' + pl.name + ' ' + m + '：' + Math.round(v).toLocaleString() + '元</title></rect>';
            });
            const yPct = ((1 - filteredAccCumMap[m] / yMax) * 100).toFixed(1);
            accLinePts.push(xPct.toFixed(1) + ',' + yPct);
        });
        if (accLinePts.length >= 2) {
            accLineSvg = '<polyline points="' + accLinePts.join(' ') + '" fill="none" stroke="#e65100" stroke-width="2.5" stroke-dasharray="6,3" vector-effect="non-scaling-stroke"/>';
        }
    }
    // 最終 SVG 組合（各層用 <g id> 包裝，JavaScript 可切換 display）
    svgLayers = yGridSvg +
        '<g id="scBarsLayer">' + accBarsSvg + '</g>' +
        '<g id="scAccLine">' + accLineSvg + '</g>' +
        '<g id="scBudgetLayer">' + budgetLayerSvg + '</g>' +
        '<g id="scPlanLayer">' + planLayerSvg + '</g>';

    // 核銷累積圓點（可點擊）
    let accDotDivs = '';
    if (hasAcc) {
        filteredAccSortedMonths.forEach(m => {
            const left = dateToPct(midDate(m)).toFixed(2);
            const bottom = (filteredAccCumMap[m] / yMax * 100).toFixed(2);
            const monthly = fmtY(filteredAccMonthlyMap[m] || 0);
            const cum = fmtY(filteredAccCumMap[m]);
            // 各工程當月明細
            const breakdown = accByPipeline.map(p => {
                const v = p.monthlyMap[m];
                return v ? p.name + '：' + fmtY(v) : null;
            }).filter(Boolean).join('&#10;');
            accDotDivs += '<div class="sc-acc-dot" data-month="' + m + '" data-monthly="' + monthly + '" data-cum="' + cum + '" data-breakdown="' + breakdown + '" style="position:absolute;left:' + left + '%;bottom:' + bottom + '%;width:12px;height:12px;border-radius:50%;background:#e65100;border:2px solid white;transform:translate(-50%,50%);cursor:pointer;z-index:10;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>';
        });
    }

    // 圓點：用 HTML div 絕對定位，避免 preserveAspectRatio="none" 造成橢圓
    let dotDivs = '';
    pipelineRows.forEach(pr => {
        pr.rows.forEach(r => {
            const left = dateToPct(midDate(r.month)).toFixed(2);
            const bottom = (r.cumulative / yMax * 100).toFixed(2);
            dotDivs += '<div class="sc-plan-dot" data-month="' + r.month + '" data-name="' + pr.name + '" data-monthly="' + fmtY(r.monthly) + '" data-cum="' + fmtY(r.cumulative) + '" data-color="' + pr.color + '" style="position:absolute;left:' + left + '%;bottom:' + bottom + '%;width:8px;height:8px;border-radius:50%;background:' + pr.color + ';border:1.5px solid white;transform:translate(-50%,50%);opacity:0.85;cursor:pointer;z-index:8;"></div>';
        });
    });
    totalRows.forEach(r => {
        const left = dateToPct(midDate(r.month)).toFixed(2);
        const bottom = (r.cumulative / yMax * 100).toFixed(2);
        dotDivs += '<div class="sc-plan-dot" data-month="' + r.month + '" data-name="計畫合計" data-monthly="' + fmtY(r.monthly) + '" data-cum="' + fmtY(r.cumulative) + '" data-color="#4a148c" style="position:absolute;left:' + left + '%;bottom:' + bottom + '%;width:9px;height:9px;border-radius:50%;background:#4a148c;border:1.5px solid white;transform:translate(-50%,50%);cursor:pointer;z-index:9;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>';
    });

    // Y 軸標籤 HTML（放在左欄）
    const yLabelsHtml = yTickFracs.map(f =>
        '<div style="position:absolute;right:4px;bottom:' + (f*100).toFixed(0) + '%;transform:translateY(50%);font-size:11px;color:#666;white-space:nowrap;text-align:right;font-weight:500;">' + fmtY(yMax * f) + '</div>'
    ).join('');

    // Tooltip hover divs
    let hoverDivs = '';
    const allPoints = totalRows.map((r, i) => {
        const pct = dateToPct(midDate(r.month));
        const nextPct = i < totalRows.length - 1 ? dateToPct(midDate(totalRows[i + 1].month)) : 100;
        const w = Math.max(nextPct - pct, 1).toFixed(2);
        // per-pipeline breakdown
        const breakdown = pipelineRows.map(pr => {
            const pr_row = pr.rows.find(x => x.month === r.month);
            return pr_row ? pr.name + '：' + fmtY(pr_row.monthly) + ' 元' : '';
        }).filter(Boolean).join('&#10;');
        return { pct, w, month: r.month, monthly: fmtY(r.monthly), cum: fmtY(r.cumulative), breakdown };
    });
    hoverDivs = allPoints.map(p =>
        '<div class="sc-hover" data-month="' + p.month + '" data-monthly="' + p.monthly + '" data-cum="' + p.cum + '" data-breakdown="' + p.breakdown + '" style="position:absolute;left:' + p.pct.toFixed(2) + '%;width:' + p.w + '%;top:0;bottom:0;cursor:crosshair;"></div>'
    ).join('');

    let win = window.open('', 'scurve_project', 'width=1100,height=680');
    if (!win || win.closed) {
        win = window.open('', 'scurve_project', 'width=1100,height=680');
    }
    if (!win) { showToast('請允許彈出視窗', 'warning'); return; }
    win.focus();
    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>計畫S曲線 - ' + currentProject.name + '</title>' +
        '<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,"Microsoft JhengHei",sans-serif;background:#f5f5f5;}' +
        '.hdr{background:#4a148c;color:white;padding:10px 16px;font-size:14px;font-weight:bold;}' +
        '.body{padding:16px;}.legend{margin-bottom:8px;line-height:2;}' +
        '#tip{display:none;position:fixed;background:rgba(0,0,0,0.8);color:white;font-size:11px;padding:8px 12px;border-radius:6px;pointer-events:none;z-index:999;white-space:pre-line;max-width:260px;line-height:1.6;}' +
        '</style></head><body>' +
        '<div class="hdr" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">' +
        '<span>📈 S 曲線（' + selectedPipelines.length + ' 個工程）</span>' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
        '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;font-weight:normal;"><input type="checkbox" id="chkPlan" checked onchange="toggleLayer(\'scPlanLayer\',this.checked)"> S曲線</label>' +
        (hasAcc ? '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;font-weight:normal;"><input type="checkbox" id="chkAccLine" checked onchange="toggleLayer(\'scAccLine\',this.checked)"> 累積核銷</label>' : '') +
        (hasAcc ? '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;font-weight:normal;"><input type="checkbox" id="chkBars" checked onchange="toggleLayer(\'scBarsLayer\',this.checked)"> 當月核銷</label>' : '') +
        (hasBudget ? '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;font-weight:normal;"><input type="checkbox" id="chkBudget" checked onchange="toggleLayer(\'scBudgetLayer\',this.checked)"> 年度預算</label>' : '') +
        '<button onclick="_toggleScYearFilter()" style="background:' + (filterYear ? '#e3f2fd' : 'rgba(255,255,255,0.15)') + ';border:1px solid rgba(255,255,255,0.4);color:' + (filterYear ? '#0d47a1' : 'white') + ';padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:' + (filterYear ? 'bold' : 'normal') + ';">🗓️ ' + (filterYear ? filterYear + '年' : '本年度') + '</button>' +
        '<button id="exportBtn" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:white;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">📥 匯出Excel</button>' +
        '</div></div>' +
        '<div class="body">' + statsHtml +
        '<div style="display:flex;">' +
        // Y軸左欄
        '<div style="width:80px;flex-shrink:0;position:relative;height:' + CHART_H + 'px;">' + yLabelsHtml + '</div>' +
        // 圖表區
        '<div style="flex:1;position:relative;">' +
        '<div style="position:relative;height:' + CHART_H + 'px;">' +
        '<svg viewBox="0 0 1000 100" preserveAspectRatio="none" width="100%" height="' + CHART_H + '" style="display:block;">' + svgLayers + '</svg>' +
        dotDivs +
        accDotDivs +
        '<div style="position:absolute;bottom:0;left:0;right:0;height:1px;background:#ccc;"></div>' +
        hoverDivs +
        '</div>' +
        '<div style="border-top:1px solid #ddd;"><div style="position:relative;height:12px;">' + xYearHtml + '</div><div style="position:relative;height:16px;">' + xMonHtml + '</div></div>' +
        '<div style="padding:8px 0 4px 0;border-top:1px solid #f0f0f0;margin-top:6px;line-height:1.8;">' + legendHtml + '</div>' +
        '</div></div>' +
        '<div id="tip"></div>' +
        '</div>' +
        '<script>' +
        'function _toggleScYearFilter(){window.opener&&window.opener.postMessage({type:"scYearFilter"},"*");}' +
        'function toggleLayer(id,show){var el=document.getElementById(id);if(el)el.style.display=show?"":"none";if(id==="scPlanLayer"){document.querySelectorAll(".sc-plan-dot").forEach(function(d){d.style.display=show?"":"none";});}if(id==="scAccLine"){document.querySelectorAll(".sc-acc-dot").forEach(function(d){d.style.display=show?"":"none";});}}' +
        'var tip=document.getElementById("tip");' +
        'var tipPinned=false;' +
        'document.querySelectorAll(".sc-hover").forEach(function(z){' +
        'z.addEventListener("mouseenter",function(){if(tipPinned)return;' +
        'var bd=z.dataset.breakdown?z.dataset.breakdown.replace(/&#10;/g,"\\n"):"";' +
        'tip.innerHTML="<b>📅 "+z.dataset.month+"</b>\\n當月核銷："+z.dataset.monthly+" 元"+(bd?"\\n\\n各工程當月：\\n"+bd:"");' +
        'tip.style.display="block";});' +
        'z.addEventListener("mouseleave",function(){if(tipPinned)return;tip.style.display="none";});' +
        'z.addEventListener("mousemove",function(e){if(tipPinned)return;var tx=e.clientX+14;if(tx+270>window.innerWidth)tx=e.clientX-280;tip.style.left=tx+"px";tip.style.top=Math.max(10,e.clientY-20)+"px";});' +
        '});' +
        'document.querySelectorAll(".sc-plan-dot").forEach(function(d){' +
        'd.addEventListener("click",function(e){' +
        'e.stopPropagation();' +
        'tip.textContent="\u{1F4C5} "+d.dataset.month+"\\n"+d.dataset.name+"\\n\u7d2f\u7a4d(S\u66f2\u7dda)\uff1a"+d.dataset.cum+" \u5143\\n\u7576\u6708\uff1a"+d.dataset.monthly+" \u5143";' +
        'var tx=e.clientX+14;if(tx+270>window.innerWidth)tx=e.clientX-280;' +
        'tip.style.left=tx+"px";tip.style.top=Math.max(10,e.clientY-20)+"px";' +
        'tip.style.display="block";tipPinned=true;' +
        'd.style.transform="translate(-50%,50%) scale(1.7)";d.style.zIndex=20;' +
        '});' +
        '});' +
        'document.querySelectorAll(".sc-acc-dot").forEach(function(d){' +
        'd.addEventListener("click",function(e){' +
        'e.stopPropagation();' +
        'var bd=d.dataset.breakdown?d.dataset.breakdown.replace(/&#10;/g,"\\n"):"";' +
        'tip.textContent="\u{1F4C5} "+d.dataset.month+"\\n\u7d2f\u7a4d\u6838\u92b7\uff1a"+d.dataset.cum+" \u5143\\n\u7576\u6708\u6838\u92b7\uff1a"+d.dataset.monthly+" \u5143"+(bd?"\\n\\n\u5404\u5de5\u7a0b\u7576\u6708\uff1a\\n"+bd:"");' +
        'var tx=e.clientX+14;if(tx+270>window.innerWidth)tx=e.clientX-280;' +
        'tip.style.left=tx+"px";tip.style.top=Math.max(10,e.clientY-20)+"px";' +
        'tip.style.display="block";tipPinned=true;' +
        'd.style.background="#ff6d00";d.style.transform="translate(-50%,50%) scale(1.5)";' +
        '});' +
        '});' +
        'document.addEventListener("click",function(){' +
        'if(tipPinned){tipPinned=false;tip.style.display="none";' +
        'document.querySelectorAll(".sc-acc-dot").forEach(function(d){d.style.background="#e65100";d.style.transform="translate(-50%,50%) scale(1)";});' +
        'document.querySelectorAll(".sc-plan-dot").forEach(function(d){d.style.transform="translate(-50%,50%) scale(1)";d.style.zIndex=9;});' +
        '}});' +
        'document.getElementById("exportBtn").onclick=function(){' +
        'var script=document.createElement("script");script.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";' +
        'script.onload=function(){' +
        'var wb=XLSX.utils.book_new();' +
        'var totalData=' + JSON.stringify(totalRows.map(r=>({月份:r.month,當月金額:Math.round(r.monthly),累積金額:Math.round(r.cumulative)}))) + ';' +
        'XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(totalData),"計畫合計");' +
        JSON.stringify(pipelineRows.map(pr=>pr.name)).replace(/^\[|\]$/g,'').split(',').map((name,i)=>{return '';}).join('') +
        '' +
        'var plData=' + JSON.stringify(pipelineRows.map(pr=>({name:pr.name,rows:pr.rows.map(r=>({月份:r.month,當月金額:Math.round(r.monthly),累積金額:Math.round(r.cumulative)}))}))).replace(/`/g,'\u0060') + ';' +
        'plData.forEach(function(pl){XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(pl.rows),pl.name.slice(0,31));});' +
        'XLSX.writeFile(wb,"計畫S曲線_' + currentProject.name.replace(/[\/\\?*\[\]]/g,'_') + '.xlsx");' +
        '};document.head.appendChild(script);};' +
        '<\/script></body></html>');
    win.document.close();
}

// ========== S 曲線 / 施工單價管理功能 ==========

// 核銷資料快取（供 renderSCurve 使用）
window._accountingCache = []; let _accountingCache = window._accountingCache;

function showSCurvePanel() {
    document.getElementById('sCurveBackdrop').style.display = 'block';
    document.getElementById('sCurvePanel').style.display = 'flex';
    // 確保甘特資料和單價快取都已載入再渲染
    const projName = currentProject ? (currentProject.name || '') : '';
    Promise.all([
        apiCall('getGanttItems', { pipelineId: currentPipeline.id })
            .then(r => {
                ganttData = window.ganttData = (r.items || []).sort((a, b) => {
                    const oa = a.sortOrder != null ? a.sortOrder : 9999;
                    const ob = b.sortOrder != null ? b.sortOrder : 9999;
                    return oa !== ob ? oa - ob : new Date(a.startDate) - new Date(b.startDate);
                });
            }),
        apiCall('getUnitPrices', { pipelineId: currentPipeline.id, projectName: projName })
            .then(r => { unitPricesCache = r.prices || []; }),
        apiCall('getAccounting', { pipelineId: currentPipeline.id })
            .then(r => { _accountingCache = window._accountingCache = r.records || []; })
            .catch(() => { _accountingCache = window._accountingCache = []; })
    ]).then(() => renderSCurve()).catch(() => renderSCurve());
}

function closeSCurvePanel() {
    document.getElementById('sCurveBackdrop').style.display = 'none';
    document.getElementById('sCurvePanel').style.display = 'none';
}

// 計算每月累積預算（S 曲線）
// 從 unitPricesCache 取得有效單價（管線項目查工法表，自訂項目用 item.unitPrice）
function getEffectiveUnitPriceInPage(item) {
    if (item.status && String(item.status).startsWith('custom:')) {
        return (item.unitPrice && item.unitPrice > 0) ? +item.unitPrice : 0;
    }
    const label = item.label || '';
    const match = (unitPricesCache || []).find(p => label.indexOf(p.methodKey) >= 0);
    return match ? +match.unitPrice : 0;
}

function computeMonthlyCumulative() {
    // monthMap: { 'YYYY-MM': totalYen }
    const monthMap = {};
    ganttData.forEach(item => {
        const isCustom = item.status && String(item.status).startsWith('custom:');
        const prog = getItemProgress(item);
        const unitPrice = getEffectiveUnitPriceInPage(item);
        if (!unitPrice) return;
        let totalYen = 0;
        if (isCustom) {
            totalYen = unitPrice;
        } else {
            const totalLen = prog ? prog.total : 0;
            if (!totalLen) return;
            totalYen = totalLen * unitPrice;
        }

        const start = new Date(item.startDate);
        const end = new Date(item.endDate);
        const totalDays = Math.max(1, Math.round((end - start) / 86400000));

        // 逐月切割
        let cur = new Date(start.getFullYear(), start.getMonth(), 1);
        while (cur <= end) {
            const mStart = new Date(Math.max(cur, start));
            const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
            const mEnd = new Date(Math.min(nextMonth - 1, end));
            const mDays = Math.max(0, Math.round((mEnd - mStart) / 86400000) + 1);
            const mYen = totalYen * (mDays / totalDays);
            const key = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0');
            monthMap[key] = (monthMap[key] || 0) + mYen;
            cur = nextMonth;
        }
    });

    // 排序 → 累積
    const sorted = Object.keys(monthMap).sort();
    let cumulative = 0;
    return sorted.map(m => {
        cumulative += monthMap[m];
        return { month: m, monthly: monthMap[m], cumulative };
    });
}

function renderSCurve() {
    const body = document.getElementById('sCurvePanelBody');
    const rows = computeMonthlyCumulative();

    if (rows.length === 0) {
        body.innerHTML = `
            <div style="text-align:center;padding:40px;color:#999;">
                <div style="font-size:40px;margin-bottom:12px;">📊</div>
                <div>尚無可計算預算的甘特圖項目</div>
                <div style="font-size:12px;margin-top:8px;color:#bbb;">請先在甘特圖項目中設定施工單價，<br>或至「施工單價管理」建立單價資料</div>
                <button onclick="showUnitPriceManager()" style="margin-top:16px;padding:8px 20px;background:#00695C;color:white;border:none;border-radius:6px;cursor:pointer;font-size:13px;">⚙️ 前往施工單價管理</button>
            </div>`;
        return;
    }

    const maxCum = rows[rows.length - 1].cumulative;
    const totalItems = ganttData.filter(i => i.unitPrice > 0).length;
    const totalBudget = maxCum;

    // 計算今日累積預算（截至今天的累積）
    const todayStr = new Date().toISOString().slice(0, 7); // YYYY-MM
    const todayRow = rows.filter(r => r.month <= todayStr);
    const todayCum = todayRow.length > 0 ? todayRow[todayRow.length - 1].cumulative : 0;

    // 計算實際完成金額（用 progress rate × 總金額，單價從 unitPricesCache 查）
    let actualDone = 0;
    ganttData.forEach(item => {
        const up = getEffectiveUnitPriceInPage(item);
        if (!up) return;
        if (item.status && String(item.status).startsWith('custom:')) {
            const r = parseFloat(String(item.status).split(':')[1]) / 100 || 0;
            actualDone += up * r;
        } else {
            const prog = getItemProgress(item);
            if (prog) actualDone += prog.done * up;
        }
    });

    // 統計卡
    const fmt = v => v >= 1e8 ? (v/1e8).toFixed(2)+'億' : v >= 1e4 ? (v/1e4).toFixed(1)+'萬' : Math.round(v).toLocaleString();

    let html = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">
            <div style="flex:1;min-width:130px;padding:10px 14px;background:#f3e5f5;border-radius:8px;border-left:4px solid #7b1fa2;">
                <div style="font-size:10px;color:#7b1fa2;margin-bottom:2px;">總計畫預算</div>
                <div style="font-size:18px;font-weight:bold;color:#4a148c;">${fmt(totalBudget)} 元</div>
            </div>
            <div style="flex:1;min-width:130px;padding:10px 14px;background:#e3f2fd;border-radius:8px;border-left:4px solid #1976d2;">
                <div style="font-size:10px;color:#1565c0;margin-bottom:2px;">計畫累積至今（${todayStr}）</div>
                <div style="font-size:18px;font-weight:bold;color:#0d47a1;">${fmt(todayCum)} 元</div>
                <div style="font-size:10px;color:#555;">${totalBudget>0?Math.round(todayCum/totalBudget*100):0}%</div>
            </div>
            <div style="flex:1;min-width:130px;padding:10px 14px;background:#e8f5e9;border-radius:8px;border-left:4px solid #388e3c;">
                <div style="font-size:10px;color:#2e7d32;margin-bottom:2px;">實際已完成金額</div>
                <div style="font-size:18px;font-weight:bold;color:#1b5e20;">${fmt(actualDone)} 元</div>
                <div style="font-size:10px;color:#555;">${totalBudget>0?Math.round(actualDone/totalBudget*100):0}%</div>
            </div>
        </div>`;

    // ── 核銷資料整理 ──────────────────────────────────────────
    // 依月份建立核銷 Map（累計）
    const accMap = {}; // month -> amount
    _accountingCache.forEach(r => { accMap[r.year_month] = (accMap[r.year_month] || 0) + r.amount; });
    // 計算核銷累計
    const accMonths = Object.keys(accMap).sort();
    let accCum = 0;
    const accCumMap = {}; // month -> 累計
    accMonths.forEach(m => { accCum += accMap[m]; accCumMap[m] = accCum; });
    const hasAcc = accMonths.length > 0;

    // SVG 圖表
    const W = 740, H = 300, PAD = { top: 20, right: hasAcc ? 72 : 20, bottom: 40, left: 72 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
    const n = rows.length;
    const xStep = n > 1 ? chartW / (n - 1) : chartW;

    const yMax = maxCum * 1.08;
    const yScale = v => chartH - (v / yMax) * chartH;

    // 右 Y 軸：以核銷最大月份金額為基準
    const accMonthlyMax = hasAcc ? Math.max(...accMonths.map(m => accMap[m])) * 1.15 : 1;
    const yScaleR = v => chartH - (v / accMonthlyMax) * chartH;

    // 折線點
    const pts = rows.map((r, i) => ({
        x: PAD.left + (n > 1 ? i * (chartW / (n - 1)) : chartW / 2),
        y: PAD.top + yScale(r.cumulative),
        month: r.month,
        cum: r.cumulative,
        mon: r.monthly
    }));

    // 今日線位置
    const todayIdx = rows.findLastIndex(r => r.month <= todayStr);
    const todayX = todayIdx >= 0 ? pts[todayIdx].x : -1;

    // 實際進度折線（按月累積實際完成）
    // 簡化：計算每個月底的累積實際完成（用完工率×金額按比例分配到期間內）
    let actualPts = [];
    {
        const actualMonthMap = {};
        ganttData.forEach(item => {
            const prog = getItemProgress(item);
            const up = getEffectiveUnitPriceInPage(item);
            if (!prog || !up) return;
            const done = prog.done * up;
            if (done <= 0) return;
            // 假設已完成部分均勻分布在施工期間到今天
            const start = new Date(item.startDate);
            const today = new Date();
            const effectiveEnd = new Date(Math.min(new Date(item.endDate), today));
            const totalDays = Math.max(1, Math.round((effectiveEnd - start) / 86400000));
            let cur = new Date(start.getFullYear(), start.getMonth(), 1);
            while (cur <= effectiveEnd) {
                const mStart = new Date(Math.max(cur, start));
                const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
                const mEnd = new Date(Math.min(nextMonth - 1, effectiveEnd));
                const mDays = Math.max(0, Math.round((mEnd - mStart) / 86400000) + 1);
                const mYen = done * (mDays / totalDays);
                const key = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0');
                actualMonthMap[key] = (actualMonthMap[key] || 0) + mYen;
                cur = nextMonth;
            }
        });
        let cumAct = 0;
        const sortedAct = Object.keys(actualMonthMap).sort();
        actualPts = sortedAct.map(m => {
            cumAct += actualMonthMap[m];
            const rowIdx = rows.findIndex(r => r.month === m);
            const x = rowIdx >= 0 ? pts[rowIdx].x : null;
            return { month: m, cum: cumAct, x };
        }).filter(p => p.x !== null);
    }

    // Y 軸刻度（左：計畫金額）
    const yTicks = 5;
    let yLabels = '';
    let yGrids = '';
    for (let i = 0; i <= yTicks; i++) {
        const v = yMax * i / yTicks;
        const y = PAD.top + yScale(v);
        const label = v >= 1e8 ? (v/1e8).toFixed(1)+'億' : v >= 1e4 ? (v/1e4).toFixed(0)+'萬' : Math.round(v);
        yGrids += `<line x1="${PAD.left}" y1="${y}" x2="${W-PAD.right}" y2="${y}" stroke="#eee" stroke-width="1"/>`;
        yLabels += `<text x="${PAD.left-6}" y="${y+4}" font-size="10" fill="#888" text-anchor="end">${label}</text>`;
    }
    // 右 Y 軸刻度（核銷月金額）
    let yLabelsR = '';
    if (hasAcc) {
        for (let i = 0; i <= yTicks; i++) {
            const v = accMonthlyMax * i / yTicks;
            const y = PAD.top + yScaleR(v);
            const label = v >= 1e8 ? (v/1e8).toFixed(1)+'億' : v >= 1e4 ? (v/1e4).toFixed(0)+'萬' : Math.round(v);
            yLabelsR += `<text x="${W-PAD.right+6}" y="${y+4}" font-size="10" fill="#e65100" text-anchor="start">${label}</text>`;
        }
        yLabelsR += `<text x="${W-PAD.right+6}" y="${PAD.top-6}" font-size="9" fill="#e65100" text-anchor="start">核銷(元)</text>`;
    }

    // X 軸月份標籤
    let xLabels = '';
    const step = n > 18 ? 3 : n > 9 ? 2 : 1;
    pts.forEach((p, i) => {
        if (i % step === 0) {
            xLabels += `<text x="${p.x}" y="${H-PAD.bottom+14}" font-size="9" fill="#888" text-anchor="middle">${p.month.slice(0,4)==(i>0?pts[i-1].month.slice(0,4):'') ? p.month.slice(5) : p.month}</text>`;
        }
    });

    // 核銷柱狀圖（對應右Y軸）
    let barsSvg = '';
    if (hasAcc) {
        const barW = Math.max(4, Math.min(18, (chartW / n) * 0.55));
        pts.forEach(p => {
            const monthly = accMap[p.month];
            if (!monthly) return;
            const bH = (monthly / accMonthlyMax) * chartH;
            const bY = PAD.top + chartH - bH;
            barsSvg += `<rect x="${p.x - barW/2}" y="${bY}" width="${barW}" height="${bH}"
                fill="#e65100" opacity="0.65" rx="2">
                <title>${p.month} 核銷：${fmt(monthly)}元</title>
            </rect>`;
        });
    }

    // 計畫線面積
    const polyPts = pts.map(p => `${p.x},${p.y}`).join(' ');
    const areaPath = `M ${pts[0].x},${PAD.top+chartH} ` + pts.map(p => `L ${p.x},${p.y}`).join(' ') + ` L ${pts[pts.length-1].x},${PAD.top+chartH} Z`;

    // 實際線
    const actualLine = actualPts.length >= 2
        ? `<polyline points="${actualPts.map(p=>`${p.x},${PAD.top+yScale(p.cum)}`).join(' ')}" fill="none" stroke="#388e3c" stroke-width="2.5" stroke-dasharray="5,3"/>`
        : '';

    // hover tooltip circles
    const circles = pts.map((p, i) =>
        `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#7b1fa2" stroke="white" stroke-width="1.5" opacity="0.8">
            <title>${p.month}｜當月：${fmt(p.mon)}元｜累積：${fmt(p.cum)}元</title>
        </circle>`
    ).join('');

    const todayLine = todayX > 0
        ? `<line x1="${todayX}" y1="${PAD.top}" x2="${todayX}" y2="${PAD.top+chartH}" stroke="#e53935" stroke-width="1.5" stroke-dasharray="4,3"/>
           <text x="${todayX+3}" y="${PAD.top+10}" font-size="9" fill="#e53935">今日</text>`
        : '';

    html += `
        <svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block;overflow:visible;">
            <defs>
                <linearGradient id="scGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#7b1fa2" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#7b1fa2" stop-opacity="0.03"/>
                </linearGradient>
            </defs>
            ${yGrids}
            ${barsSvg}
            <path d="${areaPath}" fill="url(#scGrad)"/>
            <polyline points="${polyPts}" fill="none" stroke="#7b1fa2" stroke-width="2.5"/>
            ${actualLine}
            ${todayLine}
            ${circles}
            ${yLabels}
            ${yLabelsR}
            ${xLabels}
            <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top+chartH}" stroke="#ccc"/>
            <line x1="${PAD.left}" y1="${PAD.top+chartH}" x2="${W-PAD.right}" y2="${PAD.top+chartH}" stroke="#ccc"/>
            ${hasAcc ? `<line x1="${W-PAD.right}" y1="${PAD.top}" x2="${W-PAD.right}" y2="${PAD.top+chartH}" stroke="#e65100" stroke-opacity="0.4" stroke-width="1"/>` : ''}
            <!-- 圖例 -->
            <rect x="${PAD.left+4}" y="${PAD.top+2}" width="12" height="4" fill="#7b1fa2" rx="2"/>
            <text x="${PAD.left+20}" y="${PAD.top+7}" font-size="10" fill="#555">計畫累積</text>
            <line x1="${PAD.left+4}" y1="${PAD.top+16}" x2="${PAD.left+16}" y2="${PAD.top+16}" stroke="#388e3c" stroke-width="2" stroke-dasharray="4,2"/>
            <text x="${PAD.left+20}" y="${PAD.top+20}" font-size="10" fill="#555">實際完成</text>
            ${hasAcc ? `<rect x="${PAD.left+4}" y="${PAD.top+26}" width="12" height="8" fill="#e65100" opacity="0.65" rx="1"/>
            <text x="${PAD.left+20}" y="${PAD.top+34}" font-size="10" fill="#e65100">當月核銷</text>` : ''}
        </svg>`;

    // 月份明細表（含核銷欄）
    // 合併所有月份（計畫 + 核銷）
    const allMonths = [...new Set([...rows.map(r=>r.month), ...accMonths])].sort();
    const rowMap = {}; rows.forEach(r => rowMap[r.month] = r);

    html += `
        <div style="margin-top:12px;">
            <div style="font-size:12px;font-weight:bold;color:#4a148c;margin-bottom:6px;">📋 逐月明細</div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:11px;">
                    <thead>
                        <tr style="background:#f3e5f5;">
                            <th style="padding:5px 8px;text-align:left;border:1px solid #e1bee7;">月份</th>
                            <th style="padding:5px 8px;text-align:right;border:1px solid #e1bee7;">當月預算</th>
                            <th style="padding:5px 8px;text-align:right;border:1px solid #e1bee7;">累積預算</th>
                            <th style="padding:5px 8px;text-align:right;border:1px solid #e1bee7;">累積比例</th>
                            ${hasAcc ? '<th style="padding:5px 8px;text-align:right;border:1px solid #e1bee7;color:#e65100;">當月核銷</th><th style="padding:5px 8px;text-align:right;border:1px solid #e1bee7;color:#e65100;">累積核銷</th>' : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${allMonths.map(m => {
                            const r = rowMap[m];
                            const isToday = m === todayStr;
                            const bg = isToday ? '#fff9c4' : '';
                            const planCells = r
                                ? `<td style="padding:4px 8px;border:1px solid #eee;text-align:right;">${fmt(r.monthly)} 元</td>
                                   <td style="padding:4px 8px;border:1px solid #eee;text-align:right;font-weight:bold;">${fmt(r.cumulative)} 元</td>
                                   <td style="padding:4px 8px;border:1px solid #eee;text-align:right;color:#7b1fa2;">${Math.round(r.cumulative/maxCum*100)}%</td>`
                                : `<td colspan="3" style="padding:4px 8px;border:1px solid #eee;color:#ccc;text-align:center;">—</td>`;
                            const accCells = hasAcc
                                ? `<td style="padding:4px 8px;border:1px solid #eee;text-align:right;color:#e65100;">${accMap[m] ? fmt(accMap[m])+'元' : '-'}</td>
                                   <td style="padding:4px 8px;border:1px solid #eee;text-align:right;font-weight:bold;color:#bf360c;">${accCumMap[m] ? fmt(accCumMap[m])+'元' : '-'}</td>`
                                : '';
                            return `<tr style="background:${bg};">
                                <td style="padding:4px 8px;border:1px solid #eee;${isToday?'font-weight:bold;color:#f57f17;':''}">${m}${isToday?' ◀':''}</td>
                                ${planCells}
                                ${accCells}
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;

    body.innerHTML = html;
}

// ========== 施工單價管理 ==========
function showUnitPriceManager() {
    document.getElementById('unitPriceBackdrop').style.display = 'block';
    document.getElementById('unitPriceModal').style.display = 'flex';
    const sub = document.getElementById('unitPriceModalSubtitle');
    if (sub) {
        const pname = currentPipeline ? (currentPipeline.name || currentPipeline.id) : '—';
        sub.textContent = '📍 ' + pname + '　（單價為本工程專屬）';
    }
    renderUnitPriceManager();
}


function closeUnitPriceManager() {
    document.getElementById('unitPriceBackdrop').style.display = 'none';
    document.getElementById('unitPriceModal').style.display = 'none';
}

function renderUnitPriceManager() {
    const body = document.getElementById('unitPriceModalBody');
    // 取得目前工程的所有 methodKey
    const methodKeys = new Set();
    if (currentPipeline && currentPipeline.branches) {
        Object.values(currentPipeline.branches).forEach(segs => {
            segs.forEach(seg => {
                const k = [seg.diameter||'', seg.pipeType||'', seg.method||''].filter(Boolean).join(' ');
                if (k) methodKeys.add(k);
            });
        });
    } else if (currentPipeline && currentPipeline.segments) {
        currentPipeline.segments.forEach(seg => {
            const k = [seg.diameter, seg.pipeType, seg.method].filter(Boolean).join(' ');
            if (k) methodKeys.add(k);
        });
    }

    const projectName = currentProject ? (currentProject.name || '') : '';
    const inputStyle = 'width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:4px;box-sizing:border-box;font-size:13px;';

    let tableRows = '';
    unitPricesCache.forEach(p => {
        tableRows += `<tr>
            <td style="padding:5px 8px;border:1px solid #eee;">${p.methodKey}</td>
            <td style="padding:5px 8px;border:1px solid #eee;text-align:right;">
                <input type="number" value="${p.unitPrice}" style="width:90px;padding:3px 5px;border:1px solid #ddd;border-radius:3px;font-size:12px;" id="up_${CSS.escape(p.methodKey)}">
            </td>
            <td style="padding:5px 8px;border:1px solid #eee;text-align:center;">
                <button onclick="saveOneUnitPrice('${p.methodKey.replace(/'/g,"\\'")}','${projectName}')" style="padding:3px 8px;background:#00695C;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;">💾</button>
                <button onclick="deleteOneUnitPrice('${p.methodKey.replace(/'/g,"\\'")}','${projectName}')" style="padding:3px 8px;background:#e53935;color:white;border:none;border-radius:3px;cursor:pointer;font-size:11px;margin-left:3px;">🗑️</button>
            </td>
        </tr>`;
    });

    // 新增行
    let newKeyOptions = '<option value="">-- 選擇工法 --</option>';
    methodKeys.forEach(k => {
        const exists = unitPricesCache.find(p => p.methodKey === k);
        if (!exists) newKeyOptions += `<option value="${k}">${k}</option>`;
    });

    body.innerHTML = `
        <div style="font-size:12px;color:#666;margin-bottom:10px;">
            計畫：<b>${projectName || '（全域）'}</b>　工程：<b>${currentPipeline ? currentPipeline.name || currentPipeline.id : '—'}</b>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px;">
            <thead>
                <tr style="background:#e8f5e9;">
                    <th style="padding:6px 8px;text-align:left;border:1px solid #c8e6c9;">施工方式（管徑+管種+工法）</th>
                    <th style="padding:6px 8px;text-align:right;border:1px solid #c8e6c9;">單價（元/m）</th>
                    <th style="padding:6px 8px;text-align:center;border:1px solid #c8e6c9;">操作</th>
                </tr>
            </thead>
            <tbody>${tableRows || '<tr><td colspan="3" style="text-align:center;padding:16px;color:#aaa;">尚無資料</td></tr>'}</tbody>
        </table>
        <div style="background:#f9f9f9;border-radius:6px;padding:12px;border:1px solid #eee;">
            <div style="font-size:12px;font-weight:bold;color:#333;margin-bottom:8px;">＋ 新增單價</div>
            <div style="margin-bottom:6px;">
                <div style="font-size:11px;color:#666;margin-bottom:2px;">施工方式</div>
                <select id="up_newKey" style="${inputStyle}">
                    ${newKeyOptions}
                </select>
                <div style="font-size:10px;color:#bbb;margin-top:2px;">或手動輸入：</div>
                <input id="up_newKeyManual" placeholder="例：2200 DIP 埋設" style="${inputStyle}margin-top:2px;">
            </div>
            <div style="margin-bottom:8px;">
                <div style="font-size:11px;color:#666;margin-bottom:2px;">單價（元/m）</div>
                <input id="up_newPrice" type="number" placeholder="例：15000" style="${inputStyle}">
            </div>
            <button onclick="addNewUnitPrice('${projectName}')" style="width:100%;padding:8px;background:#00695C;color:white;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-weight:bold;">＋ 新增</button>
        </div>`;
}

window.saveOneUnitPrice = async function(methodKey, projectName) {
    const escaped = CSS.escape(methodKey);
    const priceEl = document.getElementById('up_' + escaped);
    if (!priceEl) return;
    const unitPrice = parseFloat(priceEl.value);
    if (isNaN(unitPrice) || unitPrice < 0) { showToast('請輸入有效單價', 'warning'); return; }
    try {
        const result = await apiCall('saveUnitPrice', {
                methodKey: methodKey,
                pipelineId: currentPipeline ? currentPipeline.id : '',
                projectName: projectName,
                unitPrice: unitPrice,
                unit: 'm'
            }, { errorPrefix: '儲存失敗' });
        if (result.success) {
            showToast('已儲存 ' + methodKey, 'success');
            // 更新快取
            const idx = unitPricesCache.findIndex(p => p.methodKey === methodKey && p.projectName === projectName);
            if (idx >= 0) unitPricesCache[idx].unitPrice = unitPrice;
            else unitPricesCache.push({ methodKey, projectName, unitPrice, unit: 'm', remark: '' });
            // 通知 blob 視窗即時刷新
            if (window.ganttWindow && !window.ganttWindow.closed) window.ganttWindow.postMessage({ type: 'unitPriceChanged', unitPrices: unitPricesCache }, '*');
        } else showToast(result.error || '儲存失敗', 'error');
    } catch(e) { showToast(e.message, 'error'); }
};

window.deleteOneUnitPrice = async function(methodKey, projectName) {
    if (!await showConfirm({ title: '刪除單價', message: `確定刪除「${methodKey}」的單價？`, okText: '刪除', danger: true })) return;
    try {
        const result = await apiCall('deleteUnitPrice', {
                methodKey: methodKey,
                pipelineId: currentPipeline ? currentPipeline.id : '',
                projectName: projectName
            }, { errorPrefix: '刪除失敗' });
        if (result.success) {
            showToast('已刪除', 'success');
            unitPricesCache = unitPricesCache.filter(p => !(p.methodKey === methodKey && p.projectName === projectName));
            renderUnitPriceManager();
            if (window.ganttWindow && !window.ganttWindow.closed) window.ganttWindow.postMessage({ type: 'unitPriceChanged', unitPrices: unitPricesCache }, '*');
        } else showToast(result.error || '刪除失敗', 'error');
    } catch(e) { showToast(e.message, 'error'); }
};

window.addNewUnitPrice = async function(projectName) {
    const selKey = document.getElementById('up_newKey').value;
    const manualKey = document.getElementById('up_newKeyManual').value.trim();
    const methodKey = manualKey || selKey;
    const unitPrice = parseFloat(document.getElementById('up_newPrice').value);
    if (!methodKey) { showToast('請選擇或輸入施工方式', 'warning'); return; }
    if (isNaN(unitPrice) || unitPrice <= 0) { showToast('請輸入有效單價', 'warning'); return; }
    try {
        const result = await apiCall('saveUnitPrice', {
                methodKey: methodKey,
                pipelineId: currentPipeline ? currentPipeline.id : '',
                projectName: projectName,
                unitPrice: unitPrice,
                unit: 'm'
            }, { errorPrefix: '儲存失敗' });
        if (result.success) {
            showToast('已新增 ' + methodKey, 'success');
            const idx = unitPricesCache.findIndex(p => p.methodKey === methodKey && p.projectName === projectName);
            if (idx >= 0) unitPricesCache[idx].unitPrice = unitPrice;
            else unitPricesCache.push({ methodKey, projectName, unitPrice, unit: 'm', remark: '' });
            renderUnitPriceManager();
        } else showToast(result.error || '新增失敗', 'error');
    } catch(e) { showToast(e.message, 'error'); }
};

// ========== S 曲線功能結束 ==========

// ========== 施工里程碑功能 ==========

// ========== 施工里程碑功能結束 ==========

