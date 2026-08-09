// ========== 營造工程物價指數（CCI）查詢 ==========
// 資料由 worker 每月自動抓取自主計總處，存在 D1。
// 這個面板讓使用者直接查看與下載，取代原本每月手動跑 Colab notebook。

let cciItems = [];      // 各組合的狀態清單
let cciRuns = [];       // 最近幾次抓取記錄
let cciLoaded = false;

function cciEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
        m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function cciCanFetch() {
    return typeof currentUser !== 'undefined' && currentUser &&
        typeof getRoleLevel === 'function' && getRoleLevel(currentUser.role) >= 3;
}

async function openCciPanel() {
    let panel = document.getElementById('cciPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'cciPanel';
        panel.className = 'roadwork-panel';
        panel.style.cssText =
            'display:block; top:80px; bottom:auto; right:64px; left:auto; ' +
            'width:min(560px, calc(100vw - 90px)); max-height:76vh; overflow:auto; z-index:1200;';
        document.body.appendChild(panel);
    }
    panel.style.display = 'block';
    panel.innerHTML =
        '<div class="panel-title">' +
        '<span style="color:#00695C;">📈 營造工程物價指數（CCI）</span>' +
        '<span onclick="closeCciPanel()" style="cursor:pointer;color:#999;font-size:16px;padding:0 4px;">✕</span>' +
        '</div><div id="cciBody" style="padding:8px 4px;">載入中…</div>';

    await loadCciList();
}

function closeCciPanel() {
    const p = document.getElementById('cciPanel');
    if (p) p.style.display = 'none';
}

async function loadCciList() {
    const body = document.getElementById('cciBody');
    try {
        const res = await apiCall('listCci', {}, { silent: true });
        cciItems = res.items || [];
        cciRuns = res.runs || [];
        cciLoaded = true;
        renderCciList();
    } catch (e) {
        if (body) body.innerHTML =
            '<div style="color:#c62828;padding:12px;">載入失敗：' + cciEsc(e.message) + '</div>';
    }
}

function renderCciList() {
    const body = document.getElementById('cciBody');
    if (!body) return;

    if (cciItems.length === 0) {
        body.innerHTML =
            '<div style="padding:16px;color:#666;line-height:1.8;">尚無資料。<br>' +
            (cciCanFetch()
                ? '<button onclick="runCciFetchAll()" style="margin-top:8px;padding:6px 14px;background:#00695C;color:#fff;border:none;border-radius:4px;cursor:pointer;">立即抓取</button>'
                : '請洽管理員執行抓取') +
            '</div>';
        return;
    }

    const okCount = cciItems.filter(i => !i.error).length;
    const failCount = cciItems.length - okCount;
    const last = cciItems.find(i => i.fetched_at);
    const lastRun = cciRuns[0];

    let h = '<div style="font-size:11px;color:#666;line-height:1.8;margin-bottom:8px;padding:0 6px;">' +
        '共 <b>' + cciItems.length + '</b> 組　' +
        '<span style="color:#2E7D32;">正常 ' + okCount + '</span>' +
        (failCount ? '　<span style="color:#c62828;">失敗 ' + failCount + '</span>' : '') +
        (last ? '<br>最後更新：' + cciEsc(String(last.fetched_at).slice(0, 10)) : '') +
        (lastRun ? '　（' + cciEsc(lastRun.trigger === 'cron' ? '自動排程' : '手動') + '）' : '') +
        '<br><span style="color:#999;">每月 8 日自動更新，資料來源：行政院主計總處</span>' +
        '</div>';

    // 合併下載：把所有組合依年月對齊成一份 CSV（多數人實際使用的形式）
    h += '<div style="padding:0 6px 8px;display:flex;gap:6px;flex-wrap:wrap;">' +
        '<button onclick="downloadCciMerged()" style="padding:5px 12px;background:#0288D1;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">⬇ 下載合併 CSV（全部 ' + cciItems.length + ' 組）</button>' +
        (cciCanFetch()
            ? '<button id="cciFetchBtn" onclick="runCciFetchAll()" style="padding:5px 12px;background:#00695C;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;">🔄 立即重新抓取</button>'
            : '') +
        '</div>';

    // 表格：每組一列，可展開看資料、可下載 CSV
    h += '<table style="width:100%;border-collapse:collapse;font-size:11px;">' +
        '<tr style="background:#f8fafc;color:#64748b;">' +
        '<th style="text-align:left;padding:4px 6px;">代號</th>' +
        '<th style="text-align:left;padding:4px 6px;">分類參數</th>' +
        '<th style="text-align:right;padding:4px 6px;">月數</th>' +
        '<th style="text-align:center;padding:4px 6px;">操作</th></tr>';

    cciItems.forEach(it => {
        // CCI_TOTAL 來自另一個 API（主計總處統計資料庫），是未扣除任何項目的
        // 原始總指數，與 80 組裡的「不含X之總指數」口徑不同，特別標示避免混淆
        const isTotal = it.code === 'CCI_TOTAL';
        const param = isTotal
            ? '<span style="color:#00695C;font-weight:600;">營造工程總指數（原始）</span>'
            : ((it.categories_id ? 'C:' + it.categories_id : '') +
               (it.category_ids ? (it.categories_id ? ' / ' : '') + 'I:' + it.category_ids : ''));
        h += '<tr style="border-top:1px solid #eee;">' +
            '<td style="padding:4px 6px;font-weight:600;">' + cciEsc(it.code) + '</td>' +
            '<td style="padding:4px 6px;color:#666;">' + (isTotal ? param : cciEsc(param || '(全部)')) + '</td>' +
            '<td style="padding:4px 6px;text-align:right;">' +
            (it.error
                ? '<span style="color:#c62828;" title="' + cciEsc(it.error) + '">失敗</span>'
                : it.row_count) +
            '</td>' +
            '<td style="padding:4px 6px;text-align:center;white-space:nowrap;">' +
            (it.error ? '' :
                '<span onclick="viewCci(\'' + it.code + '\')" style="cursor:pointer;color:#0288D1;">查看</span>' +
                ' <span onclick="downloadCci(\'' + it.code + '\')" style="cursor:pointer;color:#00695C;">下載</span>') +
            '</td></tr>';
    });
    h += '</table>';
    body.innerHTML = h;
}

// 查看單一組合的資料
async function viewCci(code) {
    const body = document.getElementById('cciBody');
    if (!body) return;
    body.innerHTML = '<div style="padding:12px;">載入 ' + cciEsc(code) + '…</div>';
    try {
        const res = await apiCall('getCci', { code }, { silent: true });
        if (!res.headers || res.headers.length === 0) {
            body.innerHTML = '<div style="padding:12px;color:#c62828;">沒有資料</div>';
            return;
        }
        let h = '<div style="padding:0 6px 8px;">' +
            '<span onclick="renderCciList()" style="cursor:pointer;color:#0288D1;font-size:12px;">← 返回清單</span>' +
            '　<b style="font-size:13px;">' + cciEsc(code) + '</b>' +
            '　<span onclick="downloadCci(\'' + code + '\')" style="cursor:pointer;color:#00695C;font-size:11px;">⬇ 下載 CSV</span>' +
            '</div>';
        h += '<div style="overflow:auto;max-height:56vh;"><table style="border-collapse:collapse;font-size:11px;white-space:nowrap;">';
        h += '<tr style="background:#f8fafc;position:sticky;top:0;">' +
            res.headers.map(x => '<th style="padding:4px 8px;text-align:left;border:1px solid #e2e8f0;">' + cciEsc(x) + '</th>').join('') +
            '</tr>';
        // 最新的月份放最上面，方便看近期數值
        res.data.slice().reverse().forEach(row => {
            h += '<tr>' + row.map((c, i) =>
                '<td style="padding:3px 8px;border:1px solid #eee;' +
                (i === 0 ? 'font-weight:600;' : 'text-align:right;') + '">' + cciEsc(c) + '</td>').join('') + '</tr>';
        });
        h += '</table></div>';
        body.innerHTML = h;
    } catch (e) {
        body.innerHTML = '<div style="padding:12px;color:#c62828;">載入失敗：' + cciEsc(e.message) + '</div>';
    }
}

// 下載 CSV（格式與原本 notebook 產出的一致）
async function downloadCci(code) {
    try {
        const res = await apiCall('exportCciCsv', { code }, { silent: true });
        if (!res.csv) { showToast('沒有資料可下載', 'error'); return; }
        // 加 BOM 讓 Excel 正確辨識 UTF-8 中文
        const blob = new Blob(['\uFEFF' + res.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = code + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast('下載失敗：' + e.message, 'error');
    }
}


// 下載合併後的 CSV（所有組合依年月對齊成一張表）
async function downloadCciMerged() {
    showToast('產生合併檔中…', 'info');
    try {
        const res = await apiCall('exportCciMerged', {}, { silent: true });
        if (!res.csv) { showToast(res.error || '沒有資料可下載', 'error'); return; }
        const blob = new Blob(['\uFEFF' + res.csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.href = url; a.download = 'CCI_合併_' + today + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('已下載：' + res.groupCount + ' 組 / ' + res.colCount + ' 欄 / ' +
                  res.rowCount + ' 個月（' + res.ymRange + '）', 'success');
    } catch (e) {
        showToast('下載失敗：' + e.message, 'error');
    }
}

// 手動重新抓取（分兩批，與排程一致）
async function runCciFetchAll() {
    if (!cciCanFetch()) { showToast('需要監工以上權限', 'error'); return; }
    const btn = document.getElementById('cciFetchBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 抓取中…(約90秒)'; }
    try {
        const r1 = await apiCall('fetchCci', { from: 0, to: 40 }, { silent: true });
        if (btn) btn.textContent = '⏳ 抓取中…(40/80)';
        const r2 = await apiCall('fetchCci', { from: 40, to: 80 }, { silent: true });
        const ok = (r1.ok || 0) + (r2.ok || 0);
        const fail = (r1.fail || 0) + (r2.fail || 0);
        showToast('抓取完成：成功 ' + ok + ' 組' + (fail ? '、失敗 ' + fail + ' 組' : ''),
            fail ? 'info' : 'success');
        await loadCciList();
    } catch (e) {
        showToast('抓取失敗：' + e.message, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔄 立即重新抓取'; }
    }
}

window.openCciPanel = openCciPanel;
window.closeCciPanel = closeCciPanel;
window.viewCci = viewCci;
window.downloadCci = downloadCci;
window.downloadCciMerged = downloadCciMerged;
window.runCciFetchAll = runCciFetchAll;
window.renderCciList = renderCciList;
// ========== CCI 查詢結束 ==========
