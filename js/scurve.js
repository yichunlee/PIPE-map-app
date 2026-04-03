// ===== 計畫S曲線（跨工程彙整）=====
async function showProjectSCurve() {
    if (!currentProject) { showToast('請先選擇計畫', 'warning'); return; }
    const projectPipelines = allPipelines.filter(p => p.projectName === currentProject.name);
    if (!projectPipelines.length) { showToast('此計畫沒有工程', 'warning'); return; }

    showToast('載入中...', 'info');

    // 平行抓取所有工程的甘特 + 單價
    const fetchResults = await Promise.all(projectPipelines.map(async pl => {
        try {
            const [ganttRes, upRes, segRes] = await Promise.all([
                fetch(API_URL + '?action=getGanttItems&pipelineId=' + encodeURIComponent(pl.id)).then(r => r.json()),
                fetch(API_URL + '?action=getUnitPrices&pipelineId=' + encodeURIComponent(pl.id)).then(r => r.json()),
                fetch(API_URL + '?action=getProgress&pipelineId=' + encodeURIComponent(pl.id)).then(r => r.json())
            ]);
            return {
                pipeline: pl,
                items: ganttRes.items || [],
                unitPrices: upRes.prices || [],
                segments: segRes.segments || []
            };
        } catch(e) { return { pipeline: pl, items: [], unitPrices: [], segments: [] }; }
    }));

    // 計算每條工程的月度預算
    const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const YEAR_COLORS = { 2024:'rgba(158,158,158,0.12)', 2025:'rgba(56,142,60,0.12)', 2026:'rgba(25,118,210,0.12)', 2027:'rgba(229,57,53,0.12)', 2028:'rgba(255,152,0,0.12)' };
    const YEAR_TEXT = { 2024:'#9e9e9e', 2025:'#388e3c', 2026:'#1976d2', 2027:'#e53935', 2028:'#ff9800' };

    function getItemProgressLocal(item, segments) {
        if (item.status && item.status.toString().startsWith('custom:')) {
            var r = parseFloat(item.status.toString().split(':')[1]) / 100;
            return { rate: isNaN(r) ? 0 : Math.min(1, Math.max(0, r)), isCustom: true };
        }
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

    function computeMonthly(items, unitPrices, segments) {
        const map = {};
        items.forEach(item => {
            const prog = getItemProgressLocal(item, segments);
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

    // 每條工程的曲線資料
    const pipelineRows = fetchResults.map((r, idx) => {
        const rows = computeMonthly(r.items, r.unitPrices, r.segments);
        const hue = Math.round((idx / fetchResults.length) * 300); // 避開最後的紅色
        return { name: r.pipeline.name || r.pipeline.id, rows, color: 'hsl(' + hue + ',70%,45%)' };
    }).filter(r => r.rows.length > 0);

    if (!pipelineRows.length) {
        showToast('各工程尚未設定單價，無法繪製S曲線', 'warning');
        return;
    }

    // 合計曲線
    const totalMap = {};
    pipelineRows.forEach(pr => {
        pr.rows.forEach(r => { totalMap[r.month] = (totalMap[r.month] || 0) + r.monthly; });
    });
    const totalMonths = Object.keys(totalMap).sort();
    let totalCum = 0;
    const totalRows = totalMonths.map(m => { totalCum += totalMap[m]; return { month: m, monthly: totalMap[m], cumulative: totalCum }; });

    // 時間軸範圍
    const allMonths = totalRows.map(r => r.month);
    const minMonth = allMonths[0], maxMonth = allMonths[allMonths.length - 1];
    const [minY, minM] = minMonth.split('-').map(Number);
    const [maxY, maxM] = maxMonth.split('-').map(Number);
    const minDate = new Date(minY, minM - 2, 1);
    const maxDate = new Date(maxY, maxM + 1, 0);
    const totalRange = maxDate - minDate;
    const grandTotal = totalRows[totalRows.length - 1].cumulative;
    const yMax = grandTotal * 1.1;

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
            const prog = getItemProgressLocal(item, r.segments);
            const up = getEffectiveUnitPriceLocal(item, r.unitPrices);
            if (!prog || !up) return s2;
            if (item.status && item.status.toString().startsWith('custom:')) return s2 + up * prog.rate;
            return s2 + prog.done * up;
        }, 0);
    }, 0);

    const statsHtml =
        '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;align-items:center;font-size:13px;">' +
        '<span><span style="color:#7b1fa2;">計畫總預算：</span><strong style="color:#4a148c;">' + fmtY(grandTotal) + ' 元</strong></span>' +
        '<span style="color:#ccc;">|</span>' +
        '<span><span style="color:#1976d2;">計畫累積至今：</span><strong style="color:#0d47a1;">' + fmtY(todayCum) + ' 元</strong></span>' +
        '<span style="color:#ccc;">|</span>' +
        '<span><span style="color:#388e3c;">實際完成金額：</span><strong style="color:#1b5e20;">' + fmtY(actualDone) + ' 元</strong></span>' +
        '</div>';

    // 圖例
    const legendHtml = pipelineRows.map(pr =>
        '<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:11px;">' +
        '<span style="display:inline-block;width:20px;height:3px;background:' + pr.color + ';border-radius:2px;"></span>' +
        pr.name + '</span>'
    ).join('') +
    '<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 8px 2px 0;font-size:11px;font-weight:bold;">' +
    '<span style="display:inline-block;width:20px;height:4px;background:#4a148c;border-radius:2px;"></span>計畫合計</span>';

    // SVG layers（只放面積、折線、格線、今日線 — 不放圓點，避免橢圓）
    const CHART_H = 260;
    let svgLayers = '';
    // 各工程面積（半透明）
    pipelineRows.forEach(pr => {
        svgLayers += '<path d="' + buildArea(pr.rows) + '" fill="' + pr.color + '" opacity="0.07"/>';
        svgLayers += '<polyline points="' + buildPolyline(pr.rows) + '" fill="none" stroke="' + pr.color + '" stroke-width="1.5" vector-effect="non-scaling-stroke" opacity="0.7"/>';
    });
    // 合計粗線
    svgLayers += '<path d="' + buildArea(totalRows) + '" fill="#7b1fa2" opacity="0.12"/>';
    svgLayers += '<polyline points="' + buildPolyline(totalRows) + '" fill="none" stroke="#4a148c" stroke-width="3" vector-effect="non-scaling-stroke"/>';
    // 今日線
    const todayX = (todayPct * 10).toFixed(1);
    svgLayers += '<line x1="' + todayX + '" y1="0" x2="' + todayX + '" y2="100" stroke="#e53935" stroke-width="1.5" stroke-dasharray="4,3" vector-effect="non-scaling-stroke"/>';
    // 水平格線
    yTickFracs.forEach(f => {
        const y = ((1 - f) * 100).toFixed(1);
        svgLayers += '<line x1="0" y1="' + y + '" x2="1000" y2="' + y + '" stroke="#eee" stroke-width="0.5"/>';
    });

    // 圓點：用 HTML div 絕對定位，避免 preserveAspectRatio="none" 造成橢圓
    let dotDivs = '';
    pipelineRows.forEach(pr => {
        pr.rows.forEach(r => {
            const left = dateToPct(midDate(r.month)).toFixed(2);
            const bottom = (r.cumulative / yMax * 100).toFixed(2);
            dotDivs += '<div style="position:absolute;left:' + left + '%;bottom:' + bottom + '%;width:5px;height:5px;border-radius:50%;background:' + pr.color + ';transform:translate(-50%,50%);opacity:0.7;pointer-events:none;"></div>';
        });
    });
    totalRows.forEach(r => {
        const left = dateToPct(midDate(r.month)).toFixed(2);
        const bottom = (r.cumulative / yMax * 100).toFixed(2);
        dotDivs += '<div style="position:absolute;left:' + left + '%;bottom:' + bottom + '%;width:7px;height:7px;border-radius:50%;background:#4a148c;border:1.5px solid white;transform:translate(-50%,50%);pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>';
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

    const win = window.open('', '_blank', 'width=1100,height=680');
    if (!win) { showToast('請允許彈出視窗', 'warning'); return; }
    win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>計畫S曲線 - ' + currentProject.name + '</title>' +
        '<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,"Microsoft JhengHei",sans-serif;background:#f5f5f5;}' +
        '.hdr{background:#4a148c;color:white;padding:10px 16px;font-size:14px;font-weight:bold;}' +
        '.body{padding:16px;}.legend{margin-bottom:8px;line-height:2;}' +
        '#tip{display:none;position:fixed;background:rgba(0,0,0,0.8);color:white;font-size:11px;padding:8px 12px;border-radius:6px;pointer-events:none;z-index:999;white-space:pre-line;max-width:260px;line-height:1.6;}' +
        '</style></head><body>' +
        '<div class="hdr" style="display:flex;justify-content:space-between;align-items:center;"><span>📈 計畫S曲線 — ' + currentProject.name + '</span><button id="exportBtn" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);color:white;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">📥 匯出Excel</button></div>' +
        '<div class="body">' + statsHtml +
        '<div class="legend">' + legendHtml + '</div>' +
        '<div style="display:flex;">' +
        // Y軸左欄
        '<div style="width:80px;flex-shrink:0;position:relative;height:' + CHART_H + 'px;">' + yLabelsHtml + '</div>' +
        // 圖表區
        '<div style="flex:1;position:relative;">' +
        '<div style="position:relative;height:' + CHART_H + 'px;">' +
        '<svg viewBox="0 0 1000 100" preserveAspectRatio="none" width="100%" height="' + CHART_H + '" style="display:block;">' + svgLayers + '</svg>' +
        dotDivs +
        '<div style="position:absolute;bottom:0;left:0;right:0;height:1px;background:#ccc;"></div>' +
        hoverDivs +
        '</div>' +
        '<div style="border-top:1px solid #ddd;"><div style="position:relative;height:12px;">' + xYearHtml + '</div><div style="position:relative;height:16px;">' + xMonHtml + '</div></div>' +
        '</div></div>' +
        '<div id="tip"></div>' +
        '</div>' +
        '<script>' +
        'var tip=document.getElementById("tip");' +
        'document.querySelectorAll(".sc-hover").forEach(function(z){' +
        'z.addEventListener("mouseenter",function(){' +
        'var bd=z.dataset.breakdown?z.dataset.breakdown.replace(/&#10;/g,"\\n"):"";' +
        'tip.textContent="📅 "+z.dataset.month+"\\n當月："+z.dataset.monthly+" 元\\n累積："+z.dataset.cum+" 元"+(bd?"\\n\\n各工程當月：\\n"+bd:"");' +
        'tip.style.display="block";});' +
        'z.addEventListener("mouseleave",function(){tip.style.display="none";});' +
        'z.addEventListener("mousemove",function(e){var tx=e.clientX+14;if(tx+270>window.innerWidth)tx=e.clientX-280;tip.style.left=tx+"px";tip.style.top=Math.max(10,e.clientY-20)+"px";});' +
        '});' +
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

function showSCurvePanel() {
    document.getElementById('sCurveBackdrop').style.display = 'block';
    document.getElementById('sCurvePanel').style.display = 'flex';
    renderSCurve();
}

function closeSCurvePanel() {
    document.getElementById('sCurveBackdrop').style.display = 'none';
    document.getElementById('sCurvePanel').style.display = 'none';
}

// 計算每月累積預算（S 曲線）
function computeMonthlyCumulative() {
    // monthMap: { 'YYYY-MM': totalYen }
    const monthMap = {};
    ganttData.forEach(item => {
        const prog = getItemProgress(item);
        const totalLen = prog ? prog.total : 0;
        const unitPrice = item.unitPrice || 0;
        if (!totalLen || !unitPrice) return;
        const totalYen = totalLen * unitPrice;

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

    // 計算實際完成金額（用 progress rate × 總金額）
    let actualDone = 0;
    ganttData.forEach(item => {
        const prog = getItemProgress(item);
        if (prog && item.unitPrice) actualDone += prog.done * item.unitPrice;
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

    // SVG 圖表
    const W = 740, H = 260, PAD = { top: 20, right: 20, bottom: 40, left: 72 };
    const chartW = W - PAD.left - PAD.right;
    const chartH = H - PAD.top - PAD.bottom;
    const n = rows.length;
    const xStep = n > 1 ? chartW / (n - 1) : chartW;

    const yMax = maxCum * 1.08;
    const yScale = v => chartH - (v / yMax) * chartH;

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
            if (!prog || !item.unitPrice) return;
            const done = prog.done * item.unitPrice;
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

    // Y 軸刻度
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

    // X 軸月份標籤
    let xLabels = '';
    const step = n > 18 ? 3 : n > 9 ? 2 : 1;
    pts.forEach((p, i) => {
        if (i % step === 0) {
            xLabels += `<text x="${p.x}" y="${H-PAD.bottom+14}" font-size="9" fill="#888" text-anchor="middle">${p.month.slice(0,4)==(i>0?pts[i-1].month.slice(0,4):'') ? p.month.slice(5) : p.month}</text>`;
        }
    });

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
            <path d="${areaPath}" fill="url(#scGrad)"/>
            <polyline points="${polyPts}" fill="none" stroke="#7b1fa2" stroke-width="2.5"/>
            ${actualLine}
            ${todayLine}
            ${circles}
            ${yLabels}
            ${xLabels}
            <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top+chartH}" stroke="#ccc"/>
            <line x1="${PAD.left}" y1="${PAD.top+chartH}" x2="${W-PAD.right}" y2="${PAD.top+chartH}" stroke="#ccc"/>
            <!-- 圖例 -->
            <rect x="${W-PAD.right-160}" y="${PAD.top}" width="12" height="4" fill="#7b1fa2" rx="2"/>
            <text x="${W-PAD.right-144}" y="${PAD.top+5}" font-size="10" fill="#555">計畫累積金額</text>
            <line x1="${W-PAD.right-160}" y1="${PAD.top+14}" x2="${W-PAD.right-148}" y2="${PAD.top+14}" stroke="#388e3c" stroke-width="2" stroke-dasharray="4,2"/>
            <text x="${W-PAD.right-144}" y="${PAD.top+18}" font-size="10" fill="#555">實際完成金額</text>
        </svg>`;

    // 月份明細表
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
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map((r, i) => {
                            const isToday = r.month === todayStr;
                            const isPast = r.month < todayStr;
                            const bg = isToday ? '#fff9c4' : '';
                            return `<tr style="background:${bg};">
                                <td style="padding:4px 8px;border:1px solid #eee;${isToday?'font-weight:bold;color:#f57f17;':''}">${r.month}${isToday?' ◀':''}</td>
                                <td style="padding:4px 8px;border:1px solid #eee;text-align:right;">${fmt(r.monthly)} 元</td>
                                <td style="padding:4px 8px;border:1px solid #eee;text-align:right;font-weight:bold;">${fmt(r.cumulative)} 元</td>
                                <td style="padding:4px 8px;border:1px solid #eee;text-align:right;color:#7b1fa2;">${Math.round(r.cumulative/maxCum*100)}%</td>
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
    // 取得目前工程的所有 methodKey（從 segments）
    const methodKeys = new Set();
    if (currentPipeline && currentPipeline.segments) {
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
        const qs = `?action=saveUnitPrice&methodKey=${encodeURIComponent(methodKey)}&pipelineId=${encodeURIComponent(currentPipeline ? currentPipeline.id : '')}&projectName=${encodeURIComponent(projectName)}&unitPrice=${unitPrice}&unit=m`;
        const res = await fetch(API_URL + qs);
        const result = await res.json();
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
        const qs = `?action=deleteUnitPrice&methodKey=${encodeURIComponent(methodKey)}&pipelineId=${encodeURIComponent(currentPipeline ? currentPipeline.id : '')}&projectName=${encodeURIComponent(projectName)}`;
        const res = await fetch(API_URL + qs);
        const result = await res.json();
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
        const qs = `?action=saveUnitPrice&methodKey=${encodeURIComponent(methodKey)}&pipelineId=${encodeURIComponent(currentPipeline ? currentPipeline.id : '')}&projectName=${encodeURIComponent(projectName)}&unitPrice=${unitPrice}&unit=m`;
        const res = await fetch(API_URL + qs);
        const result = await res.json();
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

