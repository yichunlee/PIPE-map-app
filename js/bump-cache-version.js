#!/usr/bin/env node
/**
 * 快取版本號自動化
 * ------------------------------------------------------------------
 * 把 HTML 裡 js/css 的 ?v=xxx 換成「該檔案內容的 hash」。
 *
 * 為什麼要這樣做：
 *   原本 ?v=20260718 是手寫的，改了 js 卻忘了改版本號，
 *   瀏覽器與 GitHub Pages 的 CDN 就會繼續送舊檔，
 *   造成「明明改了卻沒生效」這種很難查的問題。
 *   改用內容 hash 後：檔案有變 → 網址自動變 → 一定拿到新版；
 *   檔案沒變 → 網址不變 → 繼續用快取（不會浪費流量）。
 *
 * 用法：
 *   node bump-cache-version.js          正常執行（會改寫 HTML）
 *   node bump-cache-version.js --check   只檢查不改寫（回傳碼 1 = 有檔案過期）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const HTML_FILES = ['index.html', 'change-design.html'];
const CHECK_ONLY = process.argv.includes('--check');

// 抓 src="js/xxx.js?v=yyy" 與 href="css/xxx.css?v=yyy"
// 也接受原本沒有 ?v= 的寫法（會補上）
const ASSET_RE = /((?:src|href)=")((?:js|css)\/[A-Za-z0-9._-]+\.(?:js|css))(\?v=[^"]*)?(")/g;

function shortHash(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
}

let totalChanged = 0;
let totalMissing = 0;
let totalScanned = 0;

for (const htmlName of HTML_FILES) {
  const htmlPath = path.join(ROOT, htmlName);
  if (!fs.existsSync(htmlPath)) continue;

  const original = fs.readFileSync(htmlPath, 'utf8');
  const changed = [];
  const missing = [];

  const updated = original.replace(ASSET_RE, (m, pre, assetPath, oldVer, post) => {
    totalScanned++;
    const full = path.join(ROOT, assetPath);
    if (!fs.existsSync(full)) {
      missing.push(assetPath);
      return m;                                  // 檔案不存在就別動
    }
    const h = shortHash(full);
    const newVer = '?v=' + h;
    if (oldVer !== newVer) changed.push({ assetPath, from: (oldVer || '(無)').replace('?v=', ''), to: h });
    return pre + assetPath + newVer + post;
  });

  totalChanged += changed.length;
  totalMissing += missing.length;

  console.log(`\n[${htmlName}]`);
  if (missing.length) {
    console.log('  ⚠️  找不到檔案（版本未更新）：');
    missing.forEach(f => console.log('      - ' + f));
  }
  if (changed.length === 0) {
    console.log('  ✅ 所有 js/css 版本號都是最新的');
  } else {
    console.log(`  ${CHECK_ONLY ? '⚠️  以下需要更新' : '🔄 已更新'}（${changed.length} 個）：`);
    changed.forEach(c => console.log(`      ${c.assetPath}  ${c.from} → ${c.to}`));
    if (!CHECK_ONLY) fs.writeFileSync(htmlPath, updated);
  }
}

console.log(`\n掃描 ${totalScanned} 個資源，${totalChanged} 個需更新` +
            (totalMissing ? `，${totalMissing} 個找不到檔案` : '') + '。');

if (CHECK_ONLY && totalChanged > 0) {
  console.log('\n❌ 有檔案改過但版本號沒更新。請先執行：node bump-cache-version.js');
  process.exit(1);
}
if (!CHECK_ONLY && totalChanged > 0) {
  console.log('\n✅ HTML 已改寫，記得一起 commit。');
}
