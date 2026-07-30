// ========== 目前施工情形（中工處月彙計表）==========
// 資料來源：使用者上傳的「工程執行進度月彙計表」xlsx。
// 顯示位置：工程地圖右上角統計面板，接在管線埋設長度後面，可展開。

let progressMemoCache = {};      // pipelineId -> memo 物件
let _memoUploadRows = [];        // 上傳後暫存，供手動指定未對應的列

function memoCanEdit() {
    return typeof currentUser !== 'undefined' && currentUser &&
        typeof getRoleLevel === 'function' && getRoleLevel(currentUser.role) >= 2;
}

function memoEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
        m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ---------- 取得單一工程的施工情形 ----------
async function loadProgressMemo(pipelineId) {
    if (!pipelineId) return null;
    if (progressMemoCache[pipelineId] !== undefined) return progressMemoCache[pipelineId];
    try {
        const res = await apiCall('getProgressMemo', { pipelineId }, { silent: true });
        progressMemoCache[pipelineId] = res.memo || null;
        return progressMemoCache[pipelineId];
    } catch (e) {
        console.warn('載入施工情形失敗:', e);
        return null;   // 這是附加資訊，載不到不阻斷主畫面
    }
}

// ---------- 產生要插進統計面板的 HTML ----------
// memo.memo 是多行純文字（1. 2. 3. …），逐行呈現保留縮排
function buildProgressMemoHtml(memo) {
    if (!memo || !memo.memo || !String(memo.memo).trim()) return '';
    const lines = String(memo.memo).replace(/\r/g, '').split('\n');
    const body = lines.map(ln => {
        if (!ln.trim()) return '';
        // 保留原本的前導空白（月報常用縮排表示子項）
        const lead = (ln.match(/^\s*/) || [''])[0].length;
        return '<div style="margin:2px 0;padding-left:' + (lead * 4) + 'px;">' + memoEsc(ln.trim()) + '</div>';
    }).join('');

    let head = '';
    if (memo.planned != null || memo.actual != null) {
        head = '<div style="font-size:11px;color:#64748b;margin-bottom:4px;">' +
            '月報進度：預定 ' + (memo.planned != null ? memo.planned : '-') + '%' +
            '　實際 ' + (memo.actual != null ? memo.actual : '-') + '%</div>';
    }

    return '' +
        '<details class="memo-details" style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0;">' +
        '<summary style="cursor:pointer;font-size:12px;font-weight:700;color:#b45309;outline:none;">' +
        '📋 目前施工情形' +
        (memo.uploaded_at ? '<span style="font-weight:400;color:#94a3b8;font-size:10px;">　' +
            memoEsc(String(memo.uploaded_at).slice(0, 10)) + '</span>' : '') +
        '</summary>' +
        '<div class="memo-body" style="margin-top:6px;font-size:11px;color:#334155;line-height:1.65;' +
        'max-height:38vh;overflow-y:auto;overscroll-behavior:contain;padding-right:4px;">' +
        head + body +
        '</div></details>';
}

// 把施工情形插進已經產生的統計面板（統計面板由 data.js 建立）
async function attachProgressMemo(pipelineId) {
    const panel = document.querySelector('.stats-panel .stats-content');
    if (!panel) return;
    const memo = await loadProgressMemo(pipelineId);
    const html = buildProgressMemoHtml(memo);
    if (!html) return;
    const old = panel.querySelector('.memo-details');
    if (old) old.remove();
    panel.insertAdjacentHTML('beforeend', html);
}


// SheetJS 載入（accounting.js 已有 _loadXLSX，這裡做保險：
// 有就用它，沒有就自己載，避免 script 載入順序造成的相依問題）
async function ensureXLSX() {
    if (window.XLSX) return;
    if (typeof _loadXLSX === 'function') { await _loadXLSX(); return; }
    await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('無法載入 Excel 解析元件，請檢查網路'));
        document.head.appendChild(s);
    });
}

// ---------- 上傳（設定頁用）----------
async function uploadProgressMemoFile(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!memoCanEdit()) { showToast('需登入且具編輯權限才能上傳', 'error'); return; }

    const status = document.getElementById('_memoStatus');
    if (status) status.textContent = '⏳ 解析中…';

    try {
        await ensureXLSX();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        // 優先用「修正版」分頁，找不到就用第一個
        const sheetName = wb.SheetNames.find(n => n.indexOf('修正版') >= 0) || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        // 找表頭列（含「工程名稱」那一列），再定位各欄
        let hdr = -1;
        for (let i = 0; i < Math.min(aoa.length, 15); i++) {
            if (aoa[i].some(v => String(v).replace(/\s/g, '') === '工程名稱')) { hdr = i; break; }
        }
        if (hdr < 0) throw new Error('找不到「工程名稱」表頭，請確認是月彙計表');

        const idx = {};
        aoa[hdr].forEach((v, c) => {
            const k = String(v).replace(/\s/g, '');
            if (k === '工程名稱') idx.name = c;
            else if (k.indexOf('工程編號') === 0) idx.code = c;
            else if (k.indexOf('目前施工情形') === 0) idx.memo = c;
            else if (k === '工程進度%') idx.prog = c;   // 下一列才是 預定/實際
        });
        if (idx.name == null || idx.memo == null) throw new Error('找不到必要欄位（工程名稱／目前施工情形）');

        const rows = [];
        for (let i = hdr + 1; i < aoa.length; i++) {
            const row = aoa[i];
            const name = String(row[idx.name] || '').trim();
            if (!name) continue;
            rows.push({
                name: name,
                code: String(row[idx.code] || '').split('\n')[0].trim(),
                memo: String(row[idx.memo] || '').trim(),
                planned: idx.prog != null ? row[idx.prog] : null,
                actual: idx.prog != null ? row[idx.prog + 1] : null,
            });
        }
        if (!rows.length) throw new Error('沒有讀到任何工程資料');

        if (status) status.textContent = '⏳ 比對中…（共 ' + rows.length + ' 筆）';
        const res = await apiCall('uploadProgressMemo', {}, {
            body: { rows: rows, fileName: file.name },
            errorPrefix: '上傳失敗',
        });

        _memoUploadRows = rows;
        progressMemoCache = {};            // 清快取，讓地圖重新讀
        renderMemoResult(res, file.name);
        showToast('已對應 ' + res.matchedCount + ' 個工程' +
            (res.unmatchedCount ? '，' + res.unmatchedCount + ' 筆未對應' : ''),
            res.matchedCount ? 'success' : 'info');
    } catch (e) {
        console.error('上傳月彙計表失敗:', e);
        if (status) status.textContent = '❌ ' + e.message;
        showToast('❌ ' + e.message, 'error');
    }
}

// 顯示比對結果，未對應的可手動指定
function renderMemoResult(res, fileName) {
    const box = document.getElementById('_memoResult');
    const status = document.getElementById('_memoStatus');
    if (status) status.textContent = '✅ ' + fileName + '：對應 ' + res.matchedCount + ' 筆';
    if (!box) return;

    let h = '';
    if (res.matched && res.matched.length) {
        h += '<div style="font-size:12px;font-weight:700;color:#166534;margin:10px 0 4px;">✅ 已對應（' + res.matched.length + '）</div>';
        h += res.matched.map(m =>
            '<div style="font-size:11px;color:#475569;padding:3px 6px;background:#f0fdf4;border-radius:4px;margin-bottom:2px;">' +
            memoEsc(m.pipelineName) +
            '<span style="color:#94a3b8;"> ← ' + memoEsc(m.excelName.slice(0, 26)) + '（' + memoEsc(m.how) + '）</span></div>'
        ).join('');
    }

    const un = (res.unmatched || []).filter(u => u.reason === '找不到對應工程');
    if (un.length) {
        const opts = (window.allPipelines || []).map(p =>
            '<option value="' + memoEsc(p.id) + '">' + memoEsc(p.name) + '</option>').join('');
        h += '<div style="font-size:12px;font-weight:700;color:#9a3412;margin:12px 0 4px;">' +
             '⚠️ 未對應（' + un.length + '）<span style="font-weight:400;color:#94a3b8;font-size:11px;">' +
             '　多數是其他工程處的案子，屬正常；若有你的工程可手動指定</span></div>';
        h += un.map((u, i) =>
            '<div style="display:flex;gap:4px;align-items:center;margin-bottom:3px;font-size:11px;">' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + memoEsc(u.name) + '">' +
            memoEsc(u.name) + '</span>' +
            '<select id="_memoSel' + i + '" style="font-size:11px;max-width:150px;">' +
            '<option value="">（不指定）</option>' + opts + '</select>' +
            '<button onclick="assignMemoManually(' + i + ')" style="font-size:11px;padding:2px 8px;' +
            'background:#0284c7;color:#fff;border:none;border-radius:4px;cursor:pointer;">指定</button></div>'
        ).join('');
        window._memoUnmatched = un;
    }
    box.innerHTML = h;
}

async function assignMemoManually(i) {
    const un = window._memoUnmatched || [];
    const u = un[i];
    const sel = document.getElementById('_memoSel' + i);
    if (!u || !sel || !sel.value) { showToast('請先選擇要對應的工程', 'info'); return; }
    const row = _memoUploadRows.find(r => r.name === u.name);
    if (!row) { showToast('找不到原始資料，請重新上傳', 'error'); return; }
    try {
        await apiCall('assignProgressMemo', {}, {
            body: {
                pipelineId: sel.value, excelName: row.name, code: row.code,
                memo: row.memo, planned: row.planned, actual: row.actual,
            },
            errorPrefix: '指定失敗',
        });
        progressMemoCache = {};
        showToast('已指定給「' + sel.options[sel.selectedIndex].text + '」', 'success');
        sel.parentElement.style.opacity = '0.45';
        sel.disabled = true;
    } catch (e) { /* apiCall 已提示 */ }
}

window.loadProgressMemo = loadProgressMemo;
window.attachProgressMemo = attachProgressMemo;
window.buildProgressMemoHtml = buildProgressMemoHtml;
window.uploadProgressMemoFile = uploadProgressMemoFile;
window.assignMemoManually = assignMemoManually;
// ========== 目前施工情形結束 ==========
