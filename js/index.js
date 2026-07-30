const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ==================== 寫入動作權限驗證（Google ID Token） ====================
// 前端在寫入動作會附上 userToken（Google 登入的 ID Token），
// 這裡以 Google 公開金鑰（JWKS）驗證 RS256 簽章、aud、iss、exp，
// 再查 users 表的角色決定是否放行。讀取（get*）維持免登入。
const GOOGLE_CLIENT_ID = '850504271041-0n2eqka71m9i9t2ss7b8gue27rk7cg26.apps.googleusercontent.com';
// 與前端 api.js 的 WRITE_PREFIXES 保持一致
const WRITE_PREFIXES = ['save', 'update', 'delete', 'add', 'clear', 'upload', 'set', 'import', 'init', 'batch'];
// 登入握手用的 action 不需 token
const AUTH_EXEMPT = new Set(['verifyUser', 'registerUser', 'syncUser']);
// 僅限管理員的 action
const ADMIN_ACTIONS = new Set(['setUserRole', 'updateUserRole', 'deleteUser']);
const ROLE_LEVEL = { admin: 4, supervisor: 3, contractor: 2, user: 2, viewer: 1 };

function isWriteAction(action) {
  if (!action) return false;
  const lower = action.toLowerCase();
  return WRITE_PREFIXES.some(p => lower.startsWith(p));
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Google JWKS 快取（模組層，跨請求共用，1 小時更新一次）
let _jwksCache = { keys: null, expires: 0 };
async function getGoogleJwks() {
  if (_jwksCache.keys && Date.now() < _jwksCache.expires) return _jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error('無法取得 Google 憑證');
  const data = await res.json();
  _jwksCache = { keys: data.keys || [], expires: Date.now() + 3600 * 1000 };
  return _jwksCache.keys;
}

// 驗證 Google ID Token，成功回傳 payload，失敗回傳 null
async function verifyGoogleIdToken(token, env) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch { return null; }
  const clientId = (env && env.GOOGLE_CLIENT_ID) || GOOGLE_CLIENT_ID;
  if (payload.aud !== clientId) return null;
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') return null;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now - 30) return null; // 容許 30 秒時鐘誤差
  if (!payload.email) return null;
  const keys = await getGoogleJwks();
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key,
    b64urlDecode(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  return valid ? payload : null;
}

// 寫入動作的權限閘門：通過回傳 null，否則回傳錯誤 Response
async function checkWritePermission(action, params, env) {
  if (!isWriteAction(action) || AUTH_EXEMPT.has(action)) return null;
  const token = params.userToken;
  if (!token) return json({ success: false, authError: true, error: '此操作需要登入' }, 401);
  let payload = null;
  try { payload = await verifyGoogleIdToken(token, env); } catch { payload = null; }
  if (!payload) return json({ success: false, authError: true, error: '登入憑證無效或已過期' }, 401);
  const user = await env.DB.prepare('SELECT role FROM users WHERE email = ?').bind(payload.email).first();
  const role = (user && user.role) || 'viewer';
  const level = ROLE_LEVEL[role] || 1;
  if (ADMIN_ACTIONS.has(action)) {
    if (role !== 'admin') return json({ success: false, error: '需要管理員權限' }, 403);
  } else if (level < 2) {
    return json({ success: false, error: '權限不足（需「施工單位」以上權限）' }, 403);
  }
  // 提供給後續 handler 使用（例如記錄操作者）
  params._authEmail = payload.email;
  params._authRole = role;
  return null;
}

// ==================================================================
// 公路局申挖 KML 解析器
//   回傳 { cases, scannedPlacemarks }，不做關鍵字過濾（存全部，讀取時才篩）。
//   已驗證可吃真實檔案：同一個挖掘點會有 <Polygon>（真實挖掘面）與
//   <Point>（僅放圖示）兩個 Placemark，兩者第一個座標相同，需去重。
// ==================================================================
const DGS_CITIES = ['基隆市','新北市','台北市','桃園市','新竹縣','新竹市','苗栗縣',
  '台中市','南投縣','彰化縣','雲林縣','嘉義縣','嘉義市','台南市','高雄市',
  '屏東縣','宜蘭縣','花蓮縣','台東縣'];

function parseDgsKml(kml) {
    // ---------- 小工具 ----------
  const stripTag = (s) => String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();

  // description 是一張 HTML 表格：<td width=100>欄位</td><td>值&nbsp;</td>
  const field = (desc, name) => {
    const re = new RegExp('<td[^>]*>\\s*' + name + '\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>', 'i');
    const m = desc.match(re);
    return m ? stripTag(m[1]) : '';
  };

  // 民國 7 碼 → 西元 YYYY-MM-DD（1150817 → 2026-08-17）
  const rocToIso = (s) => {
    const d = String(s || '').replace(/\D/g, '');
    if (d.length !== 7) return '';
    const y = parseInt(d.slice(0, 3), 10) + 1911;
    return y + '-' + d.slice(3, 5) + '-' + d.slice(5, 7);
  };

  // "lng,lat,0 lng,lat,0 ..." → [[lat,lng], ...]（Leaflet 用 lat,lng）
  const parseCoords = (text) => {
    const out = [];
    String(text || '').trim().split(/\s+/).forEach(tok => {
      const p = tok.split(',');
      const lng = parseFloat(p[0]), lat = parseFloat(p[1]);
      if (isFinite(lng) && isFinite(lat) && lng !== 0 && lat !== 0) out.push([lat, lng]);
    });
    return out;
  };

  const keyOf = (c) => c ? (c[0].toFixed(9) + ',' + c[1].toFixed(9)) : '';

  // ---------- 取 KML（isolate 內快取 5 分鐘，來源本身也是 5 分鐘更新）----------
    // ---------- 解析 ----------
  const casesMap = new Map();   // caseKey -> case object
  let totalPlacemarks = 0;

  const folders = kml.split('<Folder>').slice(1);
  for (const rawFolder of folders) {
    const folder = rawFolder.split('</Folder>')[0];
    const fnMatch = folder.match(/<name>([\s\S]*?)<\/name>/);
    const folderName = fnMatch ? stripTag(fnMatch[1]) : '';

    const placemarks = folder.split('<Placemark>').slice(1);
    const polyKeys = new Set();
    const pending = [];   // 先收集，最後才去掉與面重複的點

    for (const rawPm of placemarks) {
      const pm = rawPm.split('</Placemark>')[0];
      totalPlacemarks++;

      const dm = pm.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
      const desc = dm ? dm[1] : '';

      const pipeType  = field(desc, '管線種類');
      const applyUnit = field(desc, '申請挖掘單位');
      const superUnit = field(desc, '監造單位');
      const workUnit  = field(desc, '施工單位');

      const caseNo = field(desc, '核准文號') || folderName || '(無文號)';
      const startIso = rocToIso(field(desc, '核准期間起'));
      const endIso   = rocToIso(field(desc, '核准期間訖'));
      const extStart = rocToIso(field(desc, '展延期間起'));
      const extEnd   = rocToIso(field(desc, '展延期間訖'));

      const caseKey = caseNo + '|' + folderName;
      if (!casesMap.has(caseKey)) {
        casesMap.set(caseKey, {
          caseNo,
          folderName,
          city:        field(desc, '縣市別'),
          route:       field(desc, '路線別'),
          office:      field(desc, '轄管工程處'),
          issuer:      field(desc, '路證核發單位'),
          purpose:     field(desc, '申請事宜'),
          locationDesc:field(desc, '施工地點說明'),
          pipeType,
          applyUnit,
          applyPhone:  field(desc, '申請單位電話'),
          contact:     field(desc, '單位連絡人'),
          contactPhone:field(desc, '連絡人電話'),
          superUnit,
          workUnit,
          workPhone:   field(desc, '施工單位電話'),
          startDate:   startIso,
          endDate:     endIso,
          extStartDate:extStart,
          extEndDate:  extEnd,
          startHour:   field(desc, '核准時段起'),
          endHour:     field(desc, '核准時段訖'),
          locations:   [],
        });
      }
      const rec = casesMap.get(caseKey);

      // 路段層級資訊（每個 Placemark 各自的樁位/長寬）
      const segName = (pm.match(/<name>([\s\S]*?)<\/name>/) || [])[1];
      const sizeAll = [...desc.matchAll(/<td[^>]*>\s*長度\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)];
      const widthAll = [...desc.matchAll(/<td[^>]*>\s*寬度\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)];
      const length = sizeAll.length ? parseFloat(stripTag(sizeAll[sizeAll.length - 1][1])) || 0 : 0;
      const width  = widthAll.length ? parseFloat(stripTag(widthAll[widthAll.length - 1][1])) || 0 : 0;
      const photo  = (desc.match(/<img[^>]+src=['"]([^'"]+)['"]/i) || [])[1] || '';

      const polyM = pm.match(/<Polygon>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/);
      const pointM = pm.match(/<Point>\s*<coordinates>([\s\S]*?)<\/coordinates>\s*<\/Point>/);

      if (polyM) {
        const coords = parseCoords(polyM[1]);
        if (coords.length >= 3) {
          polyKeys.add(keyOf(coords[0]));
          pending.push({ rec, loc: {
            type: 'polygon', coords, center: coords[0],
            segName: stripTag(segName), length, width, photo,
          }});
        }
      } else if (pointM) {
        const c = parseCoords(pointM[1])[0];
        if (c) {
          pending.push({ rec, loc: {
            type: 'point', coords: [c], center: c,
            segName: stripTag(segName), length, width, photo,
          }, pointKey: keyOf(c) });
        }
      }
    }

    // 同一個挖掘點會同時有 <Polygon>（真實挖掘面）和 <Point>（地圖圖示）兩個
    // Placemark，兩者第一個座標相同 → 有面就丟掉重複的點
    for (const p of pending) {
      if (p.pointKey && polyKeys.has(p.pointKey)) continue;
      p.rec.locations.push(p.loc);
    }
  }

  const cases = [...casesMap.values()].filter(c => c.locations.length > 0);
  cases.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  return { cases, scannedPlacemarks: totalPlacemarks };
}

// ==================================================================
// 台中市自來水挖掘許可 JSONL 解析器（ArcGIS 格式）
//   每行一筆，含 attributes / geometry.rings / license。
//   依 APP_NO 分組（同一許可有多個挖掘面），日期民國轉西元。
//   回傳 { cases, areaCount, skipped }
// ==================================================================
function parseTaichungDigJsonl(text) {
  const rocToIso = (s) => {
    const m = String(s || '').match(/(\d+)年(\d+)月(\d+)日/);
    if (!m) return '';
    const y = parseInt(m[1], 10) + 1911;
    return y + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  };

  // ArcGIS rings: [[[lng,lat],...], ...] → Leaflet [[lat,lng],...]（取第一環為主）
  const ringToLatLng = (ring) => ring
    .map(p => [p[1], p[0]])
    .filter(c => isFinite(c[0]) && isFinite(c[1]));

  const groups = new Map();   // APP_NO -> case
  let areaCount = 0, skipped = 0;

  const lines = text.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let row;
    try { row = JSON.parse(t); } catch (e) { skipped++; continue; }

    const a = row.attributes || {};
    const lic = row.license || {};
    const rings = (row.geometry && row.geometry.rings) || [];
    if (rings.length === 0) { skipped++; continue; }

    const appNo = a.APP_NO || lic['申請書編號'] || ('_' + (a.OBJECTID || Math.random()));

    // 核准施工起訖 "115年06月29日~115年08月28日"
    let startDate = '', endDate = '';
    const period = lic['核准施工起訖'] || '';
    if (period.indexOf('~') >= 0) {
      const parts = period.split('~');
      startDate = rocToIso(parts[0]);
      endDate = rocToIso(parts[1]);
    }

    if (!groups.has(appNo)) {
      groups.set(appNo, {
        appNo,
        projectName: lic['工程名稱'] || a.APPNAME || '',
        applicant:   lic['申請單位'] || '',
        customer:    lic['用戶名稱'] || '',
        route:       a.APP_ROUTE || '',
        district:    lic['挖掘區域'] || '',
        permitNo:    lic['挖路許可證號'] || '',
        applyDate:   rocToIso(lic['申請日期']),
        issueDate:   rocToIso(lic['發證日期']),
        startDate,
        endDate,
        workTime:    lic['核准施工時間'] || '',
        permitState: lic['路證核發狀態'] || '',
        areas:       [],
      });
    }
    const rec = groups.get(appNo);
    // 一筆可能有多環（複雜多邊形），每環各存一個面
    for (const ring of rings) {
      const coords = ringToLatLng(ring);
      if (coords.length >= 3) {
        rec.areas.push({ coords, area: a['SHAPE.AREA'] || 0 });
        areaCount++;
      }
    }
  }

  const cases = [...groups.values()].filter(c => c.areas.length > 0);
  // 依核准起日新到舊
  cases.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  return { cases, areaCount, skipped };
}


// 每個 handler：async (params, env) => Response
// 權限已在 fetch 入口的 checkWritePermission 統一把關（params._authEmail / _authRole 可用）
// ==================================================================
// 台中挖掘許可：每個上傳檔案獨立儲存（比照 WGIS 可個別勾選／刪除）
//   D1 單筆上限 2 MB，故單一檔案內容仍切塊存放。
// ==================================================================
const TCDIG_CHUNK_BYTES = 700 * 1024;

async function readTaichungDigFile(env, fileName) {
  const rows = await env.DB.prepare(
    `SELECT data FROM taichung_dig WHERE file_name = ? ORDER BY chunk_idx ASC`
  ).bind(fileName).all();
  const out = [];
  for (const r of (rows.results || [])) {
    for (const c of JSON.parse(r.data)) out.push(c);
  }
  return out;
}

async function writeTaichungDigFile(env, fileName, cases, areaCount, uploader) {
  const chunks = [];
  let cur = [], curBytes = 2;
  for (const c of cases) {
    const str = JSON.stringify(c);
    if (cur.length > 0 && curBytes + str.length + 1 > TCDIG_CHUNK_BYTES) {
      chunks.push(cur); cur = []; curBytes = 2;
    }
    cur.push(c); curBytes += str.length + 1;
  }
  if (cur.length > 0) chunks.push(cur);
  if (chunks.length === 0) chunks.push([]);

  const now = new Date().toISOString();
  // 同名檔案重新上傳 = 取代。
  // DELETE 與所有分塊 INSERT 包成單一交易：若中途失敗會整批回滾，
  // 不會出現「舊資料已刪、新資料只寫一半」的狀況。
  const ins = env.DB.prepare(`
      INSERT INTO taichung_dig (file_name, chunk_idx, data, case_count, area_count, uploaded_by, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
  const stmts = [
    env.DB.prepare(`DELETE FROM taichung_dig WHERE file_name = ?`).bind(fileName),
  ];
  for (let i = 0; i < chunks.length; i++) {
    stmts.push(ins.bind(
      fileName, i, JSON.stringify(chunks[i]),
      i === 0 ? cases.length : 0,
      i === 0 ? areaCount : 0,
      i === 0 ? uploader : '',
      now
    ));
  }
  await env.DB.batch(stmts);
  return chunks.length;
}

// 分批送出 batch。
//   D1 的 batch() 是單一交易（全成功或全回滾），但語句太多時
//   請求會過大，因此超過 CHUNK 就分批。
//   注意：分批之後「跨批」不再是原子的，所以只用在幂等的
//   INSERT OR REPLACE 匯入上（失敗重跑即可修正），
//   先刪再插那種會遺失資料的情境一律用單一 batch。
const DB_BATCH_CHUNK = 400;

async function batchAll(env, stmts) {
  if (!stmts || stmts.length === 0) return 0;
  if (stmts.length <= DB_BATCH_CHUNK) {
    await env.DB.batch(stmts);
    return stmts.length;
  }
  for (let i = 0; i < stmts.length; i += DB_BATCH_CHUNK) {
    await env.DB.batch(stmts.slice(i, i + DB_BATCH_CHUNK));
  }
  return stmts.length;
}

const HANDLERS = {
  'saveUnitPrice': async (params, env) => {
  if (!params.methodKey || !params.pipelineId) return json({ success: false, error: '缺少參數' });
  await env.DB.prepare(
    `INSERT INTO method_prices (method_key, pipeline_id, project_name, unit_price, unit)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(method_key, pipeline_id) DO UPDATE SET unit_price=excluded.unit_price, project_name=excluded.project_name`
  ).bind(params.methodKey, params.pipelineId, params.projectName || '', parseFloat(params.unitPrice) || 0, params.unit || 'm').run();
  return json({ success: true });
},

  'deleteUnitPrice': async (params, env) => {
  if (!params.methodKey || !params.pipelineId) return json({ success: false, error: '缺少參數' });
  await env.DB.prepare(
    `DELETE FROM method_prices WHERE method_key = ? AND pipeline_id = ?`
  ).bind(params.methodKey, params.pipelineId).run();
  return json({ success: true });
},

  'getProjects': async (params, env) => {
          const rows = await env.DB.prepare(
            `SELECT DISTINCT project_name as name FROM pipelines ORDER BY project_name`
          ).all();
          return json({ success: true, projects: rows.results });
        },

  'getPipelines': async (params, env) => {
  const rows = await env.DB.prepare(
    `SELECT * FROM pipelines WHERE project_name = ? ORDER BY id`
  ).bind(params.projectName).all();
  const codeRows = await env.DB.prepare(
    `SELECT pc.pipeline_id, GROUP_CONCAT(pc.code) as codes
     FROM pipeline_codes pc
     JOIN pipelines p ON p.id = pc.pipeline_id
     WHERE p.project_name = ?
     GROUP BY pc.pipeline_id`
  ).bind(params.projectName).all();
  const codesMap = {};
  (codeRows.results || []).forEach(r => { codesMap[r.pipeline_id] = r.codes ? r.codes.split(',') : []; });
  const pipelines = rows.results.map(p => ({
    id: p.id, projectName: p.project_name, name: p.name, area: p.area,
    linestring: p.linestring, notes: p.notes, created_at: p.created_at,
    codes: codesMap[p.id] || [],
  }));
  return json({ success: true, pipelines });
},

  'addPipeline': async (params, env) => {
          const id = params.customPipelineId || ('P' + Date.now());
          await env.DB.prepare(
            `INSERT INTO pipelines (id, project_name, name, area, linestring) VALUES (?, ?, ?, ?, ?)`
          ).bind(id, params.projectName, params.pipelineName, params.area || '台中市', params.linestring || '').run();
          return json({ success: true, pipelineId: id });
        },

  'updatePipeline': async (params, env) => {
          const oldId = params.oldPipelineId, newId = params.newPipelineId;
          if (!oldId || !newId) return json({ success: false, error: '缺少參數' });
          const stmts = [
            env.DB.prepare(`UPDATE pipelines SET id = ?, project_name = ?, name = ? WHERE id = ?`)
              .bind(newId, params.projectName, params.name, oldId),
          ];
          // 若使用者改了工程編號，所有子表的 pipeline_id 必須跟著改，
          // 否則段落、照片、甘特圖等全部變孤兒資料（原本的重大 bug）。
          if (newId !== oldId) {
            const childTables = ['segments', 'small_segments', 'map_notes', 'gantt', 'milestones',
              'permit_zones', 'shafts', 'panels', 'photos', 'accounting', 'accounting_by_code',
              'contract_amount', 'pipeline_codes', 'method_prices', 'sticky_notes'];
            for (const t of childTables) {
              stmts.push(env.DB.prepare(`UPDATE ${t} SET pipeline_id = ? WHERE pipeline_id = ?`).bind(newId, oldId));
            }
          }
          await env.DB.batch(stmts);
          return json({ success: true });
        },

  'deletePipeline': async (params, env) => {
          const pid = params.pipelineId;
          if (!pid) return json({ success: false, error: '缺少 pipelineId' });
          // db.batch：單一交易、單次網路來回。全刪或全不刪（原子性），不會刪到一半失敗留下孤兒資料。
          const childTables = ['segments', 'small_segments', 'map_notes', 'gantt', 'milestones',
            'permit_zones', 'shafts', 'panels', 'photos', 'accounting', 'accounting_by_code',
            'contract_amount', 'pipeline_codes', 'method_prices', 'sticky_notes'];
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM pipelines WHERE id = ?`).bind(pid),
            ...childTables.map(t => env.DB.prepare(`DELETE FROM ${t} WHERE pipeline_id = ?`).bind(pid)),
          ]);
          return json({ success: true });
        },

  'updateLinestring': async (params, env) => {
          await env.DB.prepare(
            `UPDATE pipelines SET linestring = ? WHERE id = ?`
          ).bind(params.linestring, params.pipelineId).run();
          function _hav(p1, p2) {
            const R=6371000, d2r=Math.PI/180;
            const lat1=p1[0]*d2r, lat2=p2[0]*d2r, dLat=(p2[0]-p1[0])*d2r, dLon=(p2[1]-p1[1])*d2r;
            const a=Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
            return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
          }
          const _branches = [];
          (params.linestring.match(/\(([^()]+)\)/g)||[]).forEach(p => {
            const coords = p.replace(/[()]/g,'').split(',').map(c => { const xy=c.trim().split(/\s+/).map(parseFloat); return [xy[1],xy[0]]; });
            if (coords.length >= 2) _branches.push(coords);
          });
          // 🆕 小段屬性重對應表（前端計算）：{ "B0": [新編號→舊編號, ...], ... }
          // 有這張表時，屬性依「實際位置」繼承；沒有時退回舊行為（同編號繼承）。
          let _remap = null;
          try { _remap = params.indexRemap ? JSON.parse(params.indexRemap) : null; } catch { _remap = null; }
          // 🆕 跨分支重對應支援：remap 陣列元素可以是數字（同分支舊編號，原有行為）
          // 或物件 {s:'B0', i:15}（從指定分支的指定小段繼承，含節點名稱）。
          // 物件格式用於「拖曳節點=移動段落分界」：某段尾端的小段連同屬性劃給下一段。
          // 🆕 照片重掛：收集「舊(分支,編號) → 新(分支,編號)」的對應與各分支新段數，
          // 迴圈結束後把照片搬到正確的新位置（照片跟著實際管段走，永不因編輯被刪）。
          const _srcToNew = {};        // 'B0:17' -> { seg: 'B1', idx: 2 }
          const _branchNumSegs = {};   // 'B0' -> 新的小段數
          let _allAttr = null;
          if (_remap) {
            const allRows = await env.DB.prepare(
              `SELECT segment_number,small_index,diameter,pipe_type,method,status,node_name FROM small_segments WHERE pipeline_id=?`
            ).bind(params.pipelineId).all();
            _allAttr = {};
            (allRows.results || []).forEach(r => {
              if (!_allAttr[r.segment_number]) _allAttr[r.segment_number] = {};
              _allAttr[r.segment_number][r.small_index] = {
                diameter: r.diameter || '', pipe_type: r.pipe_type || '',
                method: r.method || '', status: r.status || '0', node_name: r.node_name || ''
              };
            });
          }
          for (let bi = 0; bi < _branches.length; bi++) {
            const coords = _branches[bi];
            let branchLen = 0;
            for (let i = 0; i < coords.length-1; i++) branchLen += _hav(coords[i], coords[i+1]);
            branchLen = Math.round(branchLen);
            const segNum = `B${bi}`, numSegs = Math.ceil(branchLen / 10);
            const existing = await env.DB.prepare(
              `SELECT small_index,diameter,pipe_type,method,status,node_name FROM small_segments WHERE pipeline_id=? AND segment_number=? ORDER BY small_index`
            ).bind(params.pipelineId, segNum).all();
            const attrMap = {};
            (existing.results||[]).forEach(s => { attrMap[s.small_index]={diameter:s.diameter||'',pipe_type:s.pipe_type||'',method:s.method||'',status:s.status||'0',node_name:s.node_name||''}; });
            const rawRemap = (_remap && Array.isArray(_remap[segNum])) ? _remap[segNum] : null;
            const hasObjEntries = rawRemap && rawRemap.some(e => e && typeof e === 'object');
            // 純數字格式維持原本的嚴格長度檢查；物件格式（跨分支）允許長度±1（湊整誤差）
            const remapArr = rawRemap && (hasObjEntries || rawRemap.length === numSegs) ? rawRemap : null;
            // 節點名稱要特別處理：一個舊節點名稱只能落在一個新小段上
            // （路徑被拉長時，同一個舊小段可能對應多個新小段，若直接繼承會出現重複的節點標記）。
            let nodeNameByNewIdx = null;
            if (remapArr && !hasObjEntries) {
              nodeNameByNewIdx = {};
              Object.keys(attrMap).forEach(k => {
                const oldIdx = parseInt(k, 10);
                const nm = attrMap[k].node_name;
                if (!nm) return;
                // 找第一個對應到這個舊編號的新小段；沒有精確命中就找最接近的
                let best = -1, bestDiff = Infinity;
                for (let i = 0; i < numSegs; i++) {
                  const diff = Math.abs(remapArr[i] - oldIdx);
                  if (remapArr[i] === oldIdx) { best = i; break; }
                  if (diff < bestDiff) { bestDiff = diff; best = i; }
                }
                if (best >= 0 && !(best in nodeNameByNewIdx)) nodeNameByNewIdx[best] = nm;
              });
            }
            _branchNumSegs[segNum] = numSegs;
            const stmts = [];
            const DEF_ATTR = {diameter:'',pipe_type:'',method:'',status:'0',node_name:''};
            for (let i = 0; i < numSegs; i++) {
              const sd=i*10, ed=(i===numSegs-1)?branchLen:(i+1)*10;
              let attr, nodeName;
              if (remapArr && hasObjEntries) {
                // 跨分支繼承：{s,i} 直接從來源分支取（含節點名稱）；超出表長退回同編號
                const e = i < remapArr.length ? remapArr[i] : i;
                if (e && typeof e === 'object') {
                  attr = (_allAttr && _allAttr[e.s] && _allAttr[e.s][e.i]) || DEF_ATTR;
                  const k = e.s + ':' + e.i;
                  if (!(k in _srcToNew)) _srcToNew[k] = { seg: segNum, idx: i };
                } else {
                  attr = attrMap[e] || DEF_ATTR;
                  const k = segNum + ':' + e;
                  if (!(k in _srcToNew)) _srcToNew[k] = { seg: segNum, idx: i };
                }
                nodeName = attr.node_name;
              } else if (remapArr) {
                const srcIdx = remapArr[i];
                attr = attrMap[srcIdx] || DEF_ATTR;
                const k = segNum + ':' + srcIdx;
                if (!(k in _srcToNew)) _srcToNew[k] = { seg: segNum, idx: i };
                nodeName = (nodeNameByNewIdx && nodeNameByNewIdx[i]) || '';
              } else {
                attr = attrMap[i] || DEF_ATTR;
                nodeName = attr.node_name;
              }
              stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO small_segments (pipeline_id,segment_number,small_index,start_distance,end_distance,diameter,pipe_type,method,status,node_name) VALUES (?,?,?,?,?,?,?,?,?,?)`)
                .bind(params.pipelineId,segNum,i,sd,ed,attr.diameter,attr.pipe_type,attr.method,attr.status,nodeName));
            }
            stmts.push(env.DB.prepare(`DELETE FROM small_segments WHERE pipeline_id=? AND segment_number=? AND small_index>=?`).bind(params.pipelineId,segNum,numSegs));
            await env.DB.batch(stmts);
          }

          // 🆕 照片跟著實際管段走（取代原本「段落變短就刪照片」的粗暴行為）：
          // 1) 有對應表：照片依「舊(分支,編號)→新(分支,編號)」搬到正確位置，
          //    含跨分支的情況（分界移動時，被劃走管段上的照片跟著搬去另一段）。
          // 2) 找不到精確對應（該區域被壓縮）：搬到同分支來源編號最接近的新小段。
          // 3) 無論如何不刪除照片；超出範圍的夾到該分支最後一段。
          {
            const photoRows = await env.DB.prepare(
              `SELECT id, segment_number, small_index FROM photos WHERE pipeline_id=?`
            ).bind(params.pipelineId).all();
            const moves = [];
            (photoRows.results || []).forEach(ph => {
              const key = ph.segment_number + ':' + ph.small_index;
              let target = _srcToNew[key] || null;
              if (!target) {
                // 沒有精確對應：在同來源分支的對應中找編號最接近的
                let bestDiff = Infinity;
                for (const k in _srcToNew) {
                  const ci = k.lastIndexOf(':');
                  if (k.slice(0, ci) !== ph.segment_number) continue;
                  const diff = Math.abs(parseInt(k.slice(ci + 1), 10) - ph.small_index);
                  if (diff < bestDiff) { bestDiff = diff; target = _srcToNew[k]; }
                }
              }
              if (!target) {
                // 該分支沒有任何對應（無 remap 的舊式編輯）：至少夾回有效範圍，不刪
                const ns = _branchNumSegs[ph.segment_number];
                if (ns !== undefined && ph.small_index >= ns) {
                  target = { seg: ph.segment_number, idx: Math.max(0, ns - 1) };
                }
              }
              if (target && (target.seg !== ph.segment_number || target.idx !== ph.small_index)) {
                moves.push(env.DB.prepare(`UPDATE photos SET segment_number=?, small_index=? WHERE id=?`)
                  .bind(target.seg, target.idx, ph.id));
              }
            });
            if (moves.length) await env.DB.batch(moves);
          }
          return json({ success: true });
        },

  'getProgress': async (params, env) => {
          const segs = await env.DB.prepare(
            `SELECT * FROM segments WHERE pipeline_id = ? ORDER BY segment_number`
          ).bind(params.pipelineId).all();

          // 每個大段附上其小段資料
          const result = [];
          for (const seg of segs.results) {
            const smalls = await env.DB.prepare(
              `SELECT * FROM small_segments WHERE pipeline_id = ? AND segment_number = ? ORDER BY small_index`
            ).bind(params.pipelineId, seg.segment_number).all();

            // 組成舊格式 smallSegments 字串，前端不用改
            const statusArr = smalls.results.map(s => s.status || '0');
            result.push({
              segmentNumber: seg.segment_number,
              startDistance: seg.start_distance,
              endDistance: seg.end_distance,
              status: seg.status || '未施工',
              diameter: seg.diameter || '',
              pipeType: seg.pipe_type || '',
              method: seg.method || '',
              notes: seg.notes || '',
              smallSegments: statusArr.join(','),
              // 附上小段詳細資料（新功能用）
              smallSegmentDetails: smalls.results,
            });
          }
          return json({ success: true, segments: result });
        },

  'addSegment': async (params, env) => {
          const segNum = String(params.segmentNumber);
          const segLen = parseFloat(params.endDistance) - parseFloat(params.startDistance);
          const numSmall = Math.ceil(segLen / 10);

          // 大段與其小段包成單一交易：避免建到一半失敗，
          // 留下「大段存在但小段不完整」的破碎狀態。
          const stmts = [
            env.DB.prepare(
              `INSERT OR REPLACE INTO segments (pipeline_id, segment_number, start_distance, end_distance, status, diameter, pipe_type, method, notes)
             VALUES (?, ?, ?, ?, '未施工', ?, ?, ?, ?)`
            ).bind(params.pipelineId, segNum, params.startDistance, params.endDistance,
              params.diameter || '', params.pipeType || '', params.method || '', params.notes || ''),
          ];
          const insSmall = env.DB.prepare(
            `INSERT OR IGNORE INTO small_segments (pipeline_id, segment_number, small_index, start_distance, end_distance, diameter, pipe_type, method, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0')`
          );
          for (let i = 0; i < numSmall; i++) {
            const smallStart = parseFloat(params.startDistance) + i * 10;
            const smallEnd = Math.min(smallStart + 10, parseFloat(params.endDistance));
            stmts.push(insSmall.bind(params.pipelineId, segNum, i, smallStart, smallEnd,
              params.diameter || '', params.pipeType || '', params.method || ''));
          }
          await batchAll(env, stmts);
          return json({ success: true, smallSegments: numSmall });
        },

  'updateSegment': async (params, env) => {
          const segNum = String(params.segmentNumber);
          await env.DB.prepare(
            `UPDATE segments SET start_distance=?, end_distance=?, diameter=?, pipe_type=?, method=?, notes=? WHERE pipeline_id=? AND segment_number=?`
          ).bind(params.startDistance, params.endDistance, params.diameter || '',
            params.pipeType || '', params.method || '', params.notes || '',
            params.pipelineId, segNum).run();
          return json({ success: true });
        },

  'deleteSegment': async (params, env) => {
          const segNum = String(params.segmentNumber);
          await env.DB.prepare(`DELETE FROM segments WHERE pipeline_id=? AND segment_number=?`)
            .bind(params.pipelineId, segNum).run();
          await env.DB.prepare(`DELETE FROM small_segments WHERE pipeline_id=? AND segment_number=?`)
            .bind(params.pipelineId, segNum).run();
          return json({ success: true });
        },

  'updateSmallSegment': async (params, env) => {
          const segNum = String(params.segmentNumber);
          const idx = parseInt(params.smallIndex);
          const status = params.status || '0';
          await env.DB.prepare(
            `UPDATE small_segments SET status=? WHERE pipeline_id=? AND segment_number=? AND small_index=?`
          ).bind(status, params.pipelineId, segNum, idx).run();
          return json({ success: true });
        },

  'updateSmallSegmentInfo': async (params, env) => {
  const segNum = String(params.segmentNumber);
  const idx = parseInt(params.smallIndex);
  const updates = [];
  const vals = [];
  if (params.diameter !== undefined) { updates.push('diameter=?'); vals.push(params.diameter); }
  if (params.pipeType !== undefined) { updates.push('pipe_type=?'); vals.push(params.pipeType); }
  if (params.method !== undefined) { updates.push('method=?'); vals.push(params.method); }
  if (params.status !== undefined) { updates.push('status=?'); vals.push(params.status); }
  if (params.nodeName !== undefined) { updates.push('node_name=?'); vals.push(params.nodeName); }
  if (params.isValve !== undefined) { updates.push('is_valve=?'); vals.push(parseInt(params.isValve)||0); }
  if (updates.length === 0) return json({ success: true });
  vals.push(params.pipelineId, segNum, idx);
  await env.DB.prepare(
    `UPDATE small_segments SET ${updates.join(',')} WHERE pipeline_id=? AND segment_number=? AND small_index=?`
  ).bind(...vals).run();
  return json({ success: true });
},

  'updateWholeSegment': async (params, env) => {
          const segNum = String(params.segmentNumber);
          const status = params.status === 'completed' ? new Date().toISOString().slice(0, 10) : '0';
          await env.DB.prepare(
            `UPDATE small_segments SET status=? WHERE pipeline_id=? AND segment_number=?`
          ).bind(status, params.pipelineId, segNum).run();
          return json({ success: true });
        },

  'getMapNotes': async (params, env) => {
  if (!params.pipelineId) return json({ success: true, notes: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM map_notes WHERE pipeline_id = ? ORDER BY created_at DESC`
  ).bind(params.pipelineId).all();
  const notes = rows.results.map(r => ({
    id: r.id,
    pipelineId: r.pipeline_id,
    lng: r.lng,
    lat: r.lat,
    text: r.content,
    content: r.content,
    creator: r.created_by,
    createdBy: r.created_by,
    photo: r.photo || '',
    createdAt: r.created_at,
  }));
  return json({ success: true, notes });
},

  'addMapNote': async (params, env) => {
  const noteId = 'note_' + Date.now();
  const pipelineId = params.pipelineId || params.pipeline_id || '';
  if (!pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  const lat = parseFloat(params.lat) || 0;
  const lng = parseFloat(params.lng) || 0;
  const content = params.content || params.text || '';
  const createdBy = params.createdBy || params.creator || '匿名';
  const photo = params.photo || '';
  await env.DB.prepare(
    `INSERT INTO map_notes (id, pipeline_id, lng, lat, content, created_by, photo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(noteId, pipelineId, lng, lat, content, createdBy, photo).run();
  return json({ success: true, noteId });
},

  'updateMapNote': async (params, env) => {
  await env.DB.prepare(
    `UPDATE map_notes SET content=? WHERE id=?`
  ).bind(params.content || params.text || '', params.noteId).run();
  return json({ success: true });
},

  'deleteMapNote': async (params, env) => {
          await env.DB.prepare(`DELETE FROM map_notes WHERE id=?`).bind(params.noteId).run();
          return json({ success: true });
        },

  'verifyUser': async (params, env) => {
  const email = params.email;
  if (!email) return json({ success: false, authorized: false, error: '缺少 email' });
  
  let user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  
  if (!user) {
    // 新使用者 → 自動建立，預設 viewer
    await env.DB.prepare(
      'INSERT INTO users (email, name, picture, role, last_login) VALUES (?, ?, ?, "viewer", datetime("now"))'
    ).bind(email, params.name || '', params.picture || '').run();
    user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  } else {
    // 更新最後登入時間和資料
    await env.DB.prepare(
      'UPDATE users SET last_login = datetime("now"), name = ?, picture = ? WHERE email = ?'
    ).bind(params.name || user.name, params.picture || user.picture, email).run();
  }
  
  return json({ success: true, authorized: true, role: (user && user.role) || 'viewer' });
},

  'getUser': async (params, env) => {
          const row = await env.DB.prepare(
            `SELECT * FROM users WHERE email=?`
          ).bind(params.email).first();
          return json({ success: true, user: row });
        },

  'registerUser': async (params, env) => {
          const existing = await env.DB.prepare(
            `SELECT * FROM users WHERE email=?`
          ).bind(params.email).first();
          if (existing) {
            await env.DB.prepare(
              `UPDATE users SET last_login=datetime('now') WHERE email=?`
            ).bind(params.email).run();
            return json({ success: true, user: existing });
          }
          await env.DB.prepare(
            `INSERT INTO users (email, role, name, avatar, first_login, last_login, status) VALUES (?, 'user', ?, ?, datetime('now'), datetime('now'), '啟用')`
          ).bind(params.email, params.name || '', params.avatar || '').run();
          const newUser = await env.DB.prepare(`SELECT * FROM users WHERE email=?`).bind(params.email).first();
          return json({ success: true, user: newUser });
        },

  'updateUserRole': async (params, env) => {
          await env.DB.prepare(
            `UPDATE users SET role=? WHERE email=?`
          ).bind(params.role, params.email).run();
          return json({ success: true });
        },

  'getGantt': async (params, env) => {
          const rows = await env.DB.prepare(
            `SELECT * FROM gantt WHERE pipeline_id=? ORDER BY start_date`
          ).bind(params.pipelineId).all();
          return json({ success: true, ganttData: rows.results });
        },

  'addGanttItem': async (params, env) => {
  const itemId = 'gt_' + Date.now();
  await env.DB.prepare(
    `INSERT INTO gantt (id, pipeline_id, item_name, start_date, end_date, status, notes, unit_price, depends_on, segment_number, from_small, to_small)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(itemId, params.pipelineId, params.label || '',
    params.startDate || '', params.endDate || '',
    params.status || '', params.notes || '',
    params.unitPrice || '', params.dependsOn || '',
    params.segmentNumber || '', parseInt(params.fromSmall) || 0, parseInt(params.toSmall) || 0
  ).run();
  return json({ success: true, itemId });
},

  'updateGanttItem': async (params, env) => {
  await env.DB.prepare(
    `UPDATE gantt SET item_name=?, start_date=?, end_date=?, status=?, notes=?, unit_price=?, depends_on=?, segment_number=?, from_small=?, to_small=?
     WHERE id=?`
  ).bind(params.label || '', params.startDate || '', params.endDate || '',
    params.status || '', params.notes || '', params.unitPrice || '',
    params.dependsOn || '', params.segmentNumber || '',
    parseInt(params.fromSmall) || 0, parseInt(params.toSmall) || 0,
    params.itemId
  ).run();
  return json({ success: true });
},

  'deleteGanttItem': async (params, env) => {
  await env.DB.prepare(`DELETE FROM gantt WHERE id=?`).bind(params.itemId).run();
  return json({ success: true });
},

  'getGanttItems': async (params, env) => {
  if (!params.pipelineId) return json({ success: true, items: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM gantt WHERE pipeline_id=? ORDER BY start_date`
  ).bind(params.pipelineId).all();

  const items = rows.results.map(r => ({
    id: r.id,
    pipelineId: r.pipeline_id,
    label: r.item_name || '',
    startDate: r.start_date || '',
    endDate: r.end_date || '',
    status: r.status || '',
    notes: r.notes || '',
    unitPrice: r.unit_price || '',
    dependsOn: r.depends_on || '',
    sortOrder: r.sort_order || 0,
    segmentNumber: r.segment_number || '',  // 新增
    fromSmall: r.from_small || 0,           // 新增
    toSmall: r.to_small || 0,               // 新增
  }));
  return json({ success: true, items });
},

  'addPermitZone': async (params, env) => {
  const zoneId = 'zone_' + Date.now();
  await env.DB.prepare(
    `INSERT INTO permit_zones (id, pipeline_id, name, status, permit_number, apply_date, start_date, end_date, coordinates, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(
    zoneId,
    params.pipelineId,
    params.name || params.label || '',
    params.status || 'applying',
    params.permitNumber || params.permitNo || '',
    params.applyDate || '',
    params.startDate || params.permitDateStart || '',
    params.endDate || params.permitDateEnd || '',
    params.coordinates || params.points || '',
    params.createdBy || params.creator || '匿名'
  ).run();
  return json({ success: true, zoneId });
},

  'updatePermitZone': async (params, env) => {
          await env.DB.prepare(
            `UPDATE permit_zones SET name=?, status=?, permit_number=?, start_date=?, end_date=? WHERE id=?`
          ).bind(params.name, params.status, params.permitNumber || '',
            params.startDate || '', params.endDate || '', params.zoneId).run();
          return json({ success: true });
        },

  'deletePermitZone': async (params, env) => {
          await env.DB.prepare(`DELETE FROM permit_zones WHERE id=?`).bind(params.zoneId).run();
          return json({ success: true });
        },

  'getMethodPrices': async (params, env) => {
          const rows = await env.DB.prepare(
            `SELECT * FROM method_prices WHERE pipeline_id=?`
          ).bind(params.pipelineId).all();
          return json({ success: true, prices: rows.results });
        },

  'saveMethodPrice': async (params, env) => {
          await env.DB.prepare(
            `INSERT OR REPLACE INTO method_prices (method_key, pipeline_id, project_name, unit_price, unit) VALUES (?, ?, ?, ?, ?)`
          ).bind(params.methodKey, params.pipelineId, params.projectName || '',
            params.unitPrice || 0, params.unit || 'm').run();
          return json({ success: true });
        },

  'getPanels': async (params, env) => {
  if (!params.pipelineId) return json({ success: true, panels: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM panels WHERE pipeline_id = ?`
  ).bind(params.pipelineId).all();
  return json({ success: true, panels: rows.results });
},

  'addPanel': async (params, env) => {
  const panelId = 'panel_' + Date.now();
  await env.DB.prepare(
    `INSERT INTO panels (id, pipeline_id, lng, lat, content, created_by, photo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(panelId, params.pipelineId, params.lng, params.lat,
    params.content || '', params.createdBy || '匿名', params.photo || '').run();
  return json({ success: true, panelId });
},

  'deletePanel': async (params, env) => {
  await env.DB.prepare(`DELETE FROM panels WHERE id=?`).bind(params.panelId).run();
  return json({ success: true });
},

  'getShafts': async (params, env) => {
  if (!params.pipelineId) return json({ success: true, shafts: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM shafts WHERE pipeline_id = ?`
  ).bind(params.pipelineId).all();
  return json({ success: true, shafts: rows.results });
},

  'addShaft': async (params, env) => {
  await env.DB.prepare(
    `INSERT INTO shafts (pipeline_id, segment_number, position_type, design_depth, current_depth, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(params.pipelineId, params.segmentNumber || '',
    params.positionType || '', params.designDepth || 0,
    params.currentDepth || 0, params.status || '').run();
  return json({ success: true });
},

  'getPermitZones': async (params, env) => {
  if (!params.pipelineId) return json({ success: true, zones: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM permit_zones WHERE pipeline_id = ?`
  ).bind(params.pipelineId).all();
  const zones = rows.results.map(r => ({
    id: r.id,
    pipelineId: r.pipeline_id,
    name: r.name || '',
    status: r.status || 'applying',
    permitNo: r.permit_number || '',
    applyDate: r.apply_date || '',
    permitDateStart: r.start_date || '',
    permitDateEnd: r.end_date || '',
    points: r.coordinates || '',  // 前端用 zone.points
    createdBy: r.created_by || '',
  }));
  return json({ success: true, zones });
},

  'getMilestones': async (params, env) => {
  if (!params.pipelineId) return json({ success: true, milestones: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM milestones WHERE pipeline_id = ?`
  ).bind(params.pipelineId).all();
  return json({ success: true, milestones: rows.results });
},

  // ==================================================================
  // 公路局「道路申挖系統」路權圖層
  //
  //   資料來源：https://dgs.thb.gov.tw/thbdgs/CMMDGS/TEMP/DGS_{縣市}.kml
  //
  //   ⚠️ 該網域掛在 Imperva Incapsula 後面，會擋掉所有資料中心 IP
  //      （Cloudflare、GCP 實測皆回 JS 挑戰頁），伺服器端抓不到。
  //      因此改為：使用者從瀏覽器下載 KML → 上傳 → 這裡解析後存進 D1。
  //
  //   uploadDgsKml   上傳並解析 KML（需登入）
  //   getDgsPermits  讀取已存的案件（免登入）
  //   listDgsUploads 列出各縣市已上傳的狀態
  //   deleteDgsUpload 刪除某縣市的資料（需登入）
  // ==================================================================
  'uploadDgsKml': async (params, env) => {
    const kml = String(params.kml || '');

    if (!kml || kml.indexOf('<Placemark') < 0) {
      return json({ success: false, error: '檔案內容不是有效的 KML（找不到 <Placemark>）' });
    }
    // 上傳到被 WAF 擋下的挑戰頁 = 使用者存錯檔案了，講清楚比默默存空的好
    if (kml.indexOf('_Incapsula_Resource') >= 0 || kml.indexOf('Additional security check') >= 0) {
      return json({ success: false, error: '這是 WAF 的攔截頁不是 KML，請用瀏覽器實際開啟網址另存檔案' });
    }

    const parsed = parseDgsKml(kml);
    if (parsed.cases.length === 0) {
      return json({ success: false, error: '解析後沒有任何案件，請確認檔案是否正確' });
    }

    // 按每個案件自己的「縣市別」分組（整合檔會含多個縣市，單縣市檔就只有一組）。
    // 縣市別讀不到時，退而用呼叫端傳來的 city，再退用「未分類」。
    const norm = (s) => String(s || '').trim().replace(/^臺/, '台');
    const fallback = norm(params.city);
    const groups = {};   // city -> cases[]
    for (const c of parsed.cases) {
      let cc = norm(c.city);
      if (!DGS_CITIES.includes(cc)) cc = DGS_CITIES.includes(fallback) ? fallback : '';
      if (!cc) cc = '未分類';
      (groups[cc] = groups[cc] || []).push(c);
    }

    // 逐縣市寫入（同縣市覆蓋）。包成單一交易，
    // 避免整合檔上傳時「前幾個縣市寫進去、後面失敗」的半套狀態。
    const now = new Date().toISOString();
    const fileName = String(params.fileName || '');
    const uploader = params._authEmail || '';
    const saved = [];
    const upsert = env.DB.prepare(`
        INSERT INTO dgs_permits (city, data, case_count, point_count, source_file, uploaded_by, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(city) DO UPDATE SET
          data=excluded.data, case_count=excluded.case_count, point_count=excluded.point_count,
          source_file=excluded.source_file, uploaded_by=excluded.uploaded_by, uploaded_at=excluded.uploaded_at
      `);
    const stmts = [];
    for (const cc of Object.keys(groups)) {
      const cases = groups[cc];
      const pts = cases.reduce((s, c) => s + c.locations.length, 0);
      stmts.push(upsert.bind(cc, JSON.stringify(cases), cases.length, pts, fileName, uploader, now));
      saved.push({ city: cc, count: cases.length, pointCount: pts });
    }
    await env.DB.batch(stmts);

    saved.sort((a, b) => b.count - a.count);
    return json({
      success: true,
      multi: saved.length > 1,
      cities: saved,
      count: parsed.cases.length,
      pointCount: parsed.cases.reduce((s, c) => s + c.locations.length, 0),
      scannedPlacemarks: parsed.scannedPlacemarks,
    });
  },

  'getDgsPermits': async (params, env) => {
    const city = String(params.city || '台中市').trim().replace(/^臺/, '台');
    const keyword = String(params.keyword || '自來水').trim();
    const noFilter = params.all === '1' || params.all === 1 || params.all === true || keyword === '';

    const row = await env.DB.prepare(
      `SELECT data, case_count, source_file, uploaded_by, uploaded_at FROM dgs_permits WHERE city = ?`
    ).bind(city).first();

    if (!row) {
      return json({
        success: true, city, count: 0, pointCount: 0, cases: [],
        empty: true,
        hint: city + ' 尚未上傳 KML',
      });
    }

    let all = [];
    try { all = JSON.parse(row.data) || []; } catch (e) {
      return json({ success: false, error: '已存資料毀損，請重新上傳' });
    }

    const cases = noFilter ? all : all.filter(c => {
      const hay = [c.pipeType, c.applyUnit, c.superUnit, c.workUnit].join('|');
      return hay.indexOf(keyword) >= 0;
    });

    return json({
      success: true,
      city,
      keyword: noFilter ? '' : keyword,
      count: cases.length,
      totalInFile: all.length,
      pointCount: cases.reduce((s, c) => s + c.locations.length, 0),
      sourceFile: row.source_file,
      uploadedBy: row.uploaded_by,
      uploadedAt: row.uploaded_at,
      cases,
    });
  },

  'listDgsUploads': async (params, env) => {
    const rows = await env.DB.prepare(
      `SELECT city, case_count, point_count, source_file, uploaded_by, uploaded_at
       FROM dgs_permits ORDER BY uploaded_at DESC`
    ).all();
    return json({ success: true, uploads: rows.results || [] });
  },

  'deleteDgsUpload': async (params, env) => {
    const city = String(params.city || '').trim().replace(/^臺/, '台');
    if (!city) return json({ success: false, error: '缺少縣市' });
    await env.DB.prepare(`DELETE FROM dgs_permits WHERE city = ?`).bind(city).run();
    return json({ success: true, city });
  },

  // ==================================================================
  // 台中市自來水挖掘許可（使用者上傳台中市 GIS 的 ArcGIS JSONL）
  //   uploadTaichungDig  上傳並解析 JSONL（需登入）
  //   getTaichungRoadwork 讀取（免登入，沿用舊 action 名相容前端）
  //   deleteTaichungDig  清空（需登入）
  // ==================================================================
  'uploadTaichungDig': async (params, env) => {
    const text = String(params.data || params.jsonl || '');
    const fileName = String(params.fileName || '').trim() || ('未命名_' + Date.now());
    if (!text.trim()) return json({ success: false, error: '檔案是空的' });

    const parsed = parseTaichungDigJsonl(text);
    if (parsed.cases.length === 0) {
      return json({ success: false, error: '解析後沒有任何資料，請確認是台中市挖掘 JSONL 檔' });
    }

    const areaCount = parsed.cases.reduce((s, c) => s + c.areas.length, 0);
    await writeTaichungDigFile(env, fileName, parsed.cases, areaCount, params._authEmail || '');

    return json({
      success: true,
      fileName,
      count: parsed.cases.length,
      areaCount,
      skipped: parsed.skipped,
    });
  },

  // 檔案清單（比照 WGIS，前端據此顯示勾選列表）
  'listTaichungDigFiles': async (params, env) => {
    const rows = await env.DB.prepare(
      `SELECT file_name, case_count, area_count, uploaded_by, uploaded_at
       FROM taichung_dig WHERE chunk_idx = 0 ORDER BY uploaded_at DESC`
    ).all();
    return json({ success: true, files: rows.results || [] });
  },

  // 讀取指定檔案的內容（前端勾選時才載入）
  'getTaichungRoadwork': async (params, env) => {
    const fileName = String(params.file || '').trim();
    if (!fileName) {
      // 沒指定檔名 → 只回清單，讓前端自己決定要載哪些
      const rows = await env.DB.prepare(
        `SELECT file_name, case_count, area_count, uploaded_by, uploaded_at
         FROM taichung_dig WHERE chunk_idx = 0 ORDER BY uploaded_at DESC`
      ).all();
      const files = rows.results || [];
      return json({ success: true, data: [], files, empty: files.length === 0 });
    }
    let cases;
    try { cases = await readTaichungDigFile(env, fileName); } catch (e) {
      return json({ success: false, error: '資料毀損，請重新上傳：' + fileName });
    }
    return json({
      success: true,
      fileName,
      data: cases,
      count: cases.length,
      areaCount: cases.reduce((s, c) => s + c.areas.length, 0),
    });
  },

  'deleteTaichungDig': async (params, env) => {
    const fileName = String(params.file || '').trim();
    if (fileName) {
      await env.DB.prepare(`DELETE FROM taichung_dig WHERE file_name = ?`).bind(fileName).run();
      return json({ success: true, fileName });
    }
    await env.DB.prepare(`DELETE FROM taichung_dig`).run();   // 沒指定 = 全清
    return json({ success: true, all: true });
  },

  'getSegments': async (params, env) => {
  if (!params.pipelineId) return json({ success: true, segments: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM segments WHERE pipeline_id = ? ORDER BY segment_number`
  ).bind(params.pipelineId).all();
  const segments = rows.results.map(r => ({
    segmentNumber: r.segment_number,
    startDistance: r.start_distance,
    endDistance: r.end_distance,
    status: r.status || '未施工',
    diameter: r.diameter || '',
    pipeType: r.pipe_type || '',
    method: r.method || '',
    notes: r.notes || '',
  }));
  return json({ success: true, segments });
},

  'listWgisFiles': async (params, env) => {
  const rows = await env.DB.prepare(
    `SELECT id, name, size, uploaded_at FROM wgis_files ORDER BY uploaded_at DESC`
  ).all();
  return json({ success: true, files: rows.results });
},

  'uploadWgisFile': async (params, env) => {
  const fileId = 'wgis_' + Date.now();
  const content = params.data || '';
  // base64 decode to get size
  const size = Math.round(content.length * 0.75);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO wgis_files (id, name, content, size, uploaded_at) VALUES (?, ?, ?, ?, datetime('now'))`
  ).bind(fileId, params.fileName || 'unknown.csv', content, size).run();
  return json({ success: true, id: fileId, name: params.fileName });
},

  'getWgisFile': async (params, env) => {
  const row = await env.DB.prepare(
    `SELECT content FROM wgis_files WHERE id = ?`
  ).bind(params.fileId).first();
  if (!row) return json({ success: false, error: '找不到檔案' });
  return json({ success: true, data: row.content });
},

  'deleteWgisFile': async (params, env) => {
  await env.DB.prepare(`DELETE FROM wgis_files WHERE id = ?`).bind(params.fileId).run();
  return json({ success: true });
},

  'initSmallSegments': async (params, env) => {
  const pipelineId = params.pipelineId;
  if (!pipelineId) return json({ success: false, error: '缺少 pipelineId' });

  const branchLengths = JSON.parse(params.branchLengths || '[]');
  let insertCount = 0;

  for (const branch of branchLengths) {
    const branchLen = Math.round(branch.length);
    const numSegs = Math.ceil(branchLen / 10);
    const segNum = `B${branch.branchIndex}`;

    // 批次 INSERT，每次最多 50 筆
    const batchSize = 50;
    for (let batch = 0; batch < numSegs; batch += batchSize) {
      const end = Math.min(batch + batchSize, numSegs);
      const statements = [];
      for (let i = batch; i < end; i++) {
        const start = i * 10;
        const endDist = Math.min((i + 1) * 10, branchLen);
        statements.push(
          env.DB.prepare(
            `INSERT OR IGNORE INTO small_segments 
             (pipeline_id, segment_number, small_index, start_distance, end_distance, diameter, pipe_type, method, status)
             VALUES (?, ?, ?, ?, ?, '', '', '', '0')`
          ).bind(pipelineId, segNum, i, start, endDist)
        );
      }
      await env.DB.batch(statements);
      insertCount += end - batch;
    }
// 繼承屬性：把空白小段填入相鄰有屬性小段的值
const existing = await env.DB.prepare(
    `SELECT small_index, diameter, pipe_type, method FROM small_segments 
     WHERE pipeline_id=? AND segment_number=? AND (diameter!='' OR pipe_type!='' OR method!='')
     ORDER BY small_index`
).bind(pipelineId, segNum).all();

if (existing.results.length > 0) {
    const blanks = await env.DB.prepare(
        `SELECT small_index FROM small_segments 
         WHERE pipeline_id=? AND segment_number=? AND diameter='' AND pipe_type='' AND method=''
         ORDER BY small_index`
    ).bind(pipelineId, segNum).all();
    
    for (const blank of blanks.results) {
        // 找最近的有屬性小段
        let nearest = existing.results[0];
        let minDist = Math.abs(blank.small_index - existing.results[0].small_index);
        for (const e of existing.results) {
            const d = Math.abs(blank.small_index - e.small_index);
            if (d < minDist) { minDist = d; nearest = e; }
        }
        await env.DB.prepare(
            `UPDATE small_segments SET diameter=?, pipe_type=?, method=? 
             WHERE pipeline_id=? AND segment_number=? AND small_index=?`
        ).bind(nearest.diameter, nearest.pipe_type, nearest.method, pipelineId, segNum, blank.small_index).run();
    }
}
    // 刪除多餘的小段
    await env.DB.prepare(
      `DELETE FROM small_segments WHERE pipeline_id=? AND segment_number=? AND small_index>=?`
    ).bind(pipelineId, segNum, numSegs).run();
  }

  return json({ success: true, count: insertCount });
},

  'batchUpdateSmallSegments': async (params, env) => {
  const pipelineId = params.pipelineId;
  const branchIndex = params.branchIndex;
  const fromIndex = parseInt(params.fromIndex);
  const toIndex = parseInt(params.toIndex);
  const diameter = params.diameter || '';
  const pipeType = params.pipeType || '';
  const method = params.method || '';

  const segNum = `B${branchIndex}`;
  const minIdx = Math.min(fromIndex, toIndex);
  const maxIdx = Math.max(fromIndex, toIndex);

  await env.DB.prepare(
    `UPDATE small_segments SET diameter=?, pipe_type=?, method=?
     WHERE pipeline_id=? AND segment_number=? AND small_index>=? AND small_index<=?`
  ).bind(diameter, pipeType, method, pipelineId, segNum, minIdx, maxIdx).run();

  return json({ success: true, updated: maxIdx - minIdx + 1 });
},

  'clearOldSegments': async (params, env) => {
  // 清除舊架構 segments 資料（已改用新架構 branches 的工程使用）
  if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  await env.DB.prepare(`DELETE FROM segments WHERE pipeline_id = ?`).bind(params.pipelineId).run();
  return json({ success: true });
},

  'generateMonthlyReport': async (params, env) => {
  const projectName = params.projectName || '';

  // 取得該計畫所有工程
  let pipelines;
  if (projectName) {
    pipelines = await env.DB.prepare(
      `SELECT id, name FROM pipelines WHERE project_name = ? ORDER BY name`
    ).bind(projectName).all();
  } else {
    pipelines = await env.DB.prepare(
      `SELECT id, name FROM pipelines ORDER BY project_name, name`
    ).all();
  }

  const pipelineList = pipelines.results;
  if (!pipelineList.length) return json({ success: true, months: [], pipelines: [] });

  // 收集所有月份 & 每個工程的月度完工長度
  const monthSet = new Set();
  const pipelineData = [];

  for (const pl of pipelineList) {
    // 取該工程所有已完工（status 不是 '0' 且有日期值）的小段
    const rows = await env.DB.prepare(
      `SELECT status, start_distance, end_distance
       FROM small_segments
       WHERE pipeline_id = ?
         AND status != '0'
         AND status != ''
         AND status IS NOT NULL
         AND length(status) >= 7`
    ).bind(pl.id).all();

    const monthly = {};
    for (const row of rows.results) {
      // status 格式：YYYY-MM-DD 或 YYYY-MM
      const month = String(row.status).slice(0, 7); // 取 YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(month)) continue;
      const len = (row.end_distance || 0) - (row.start_distance || 0);
      if (len <= 0) continue;
      monthly[month] = (monthly[month] || 0) + len;
      monthSet.add(month);
    }

    if (Object.keys(monthly).length > 0) {
      pipelineData.push({ id: pl.id, name: pl.name, monthly });
    }
  }

  const months = Array.from(monthSet).sort();
  return json({ success: true, months, pipelines: pipelineData });
},

  'getAllSmallSegments': async (params, env) => {
  const pipelineId = params.pipelineId;
  if (!pipelineId) return json({ success: true, smallSegments: [] });

  const rows = await env.DB.prepare(
    `SELECT * FROM small_segments WHERE pipeline_id = ? ORDER BY segment_number, small_index`
  ).bind(pipelineId).all();

  // 依分支分組
  const branches = {};
  for (const row of rows.results) {
    const b = row.segment_number;
    if (!branches[b]) branches[b] = [];
branches[b].push({
    smallIndex: row.small_index,
    startDistance: row.start_distance,
    endDistance: row.end_distance,
    diameter: row.diameter || '',
    pipeType: row.pipe_type || '',
    method: row.method || '',
    status: row.status || '0',
    nodeName: row.node_name || '',
    isValve: row.is_valve || 0,
});
  }

  // 只回傳主分支（B0, B1...），過濾掉舊架構的子分支（B0-1, B0-2...）
  const mainBranches = {};
  const subBranchPattern = /^B\d+-\d+$/;
  for (const [key, segs] of Object.entries(branches)) {
    if (!subBranchPattern.test(key)) {
      mainBranches[key] = segs;
    }
  }
  // 如果過濾後是空的（全是子分支），就回傳原始資料
  const finalBranches = Object.keys(mainBranches).length > 0 ? mainBranches : branches;
  return json({ success: true, branches: finalBranches });
},

  'getUnitPrices': async (params, env) => {
  if (!params.pipelineId) return json({ success: true, prices: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM method_prices WHERE pipeline_id = ?`
  ).bind(params.pipelineId).all();
  return json({ success: true, prices: rows.results.map(r => ({
    methodKey: r.method_key,
    unitPrice: r.unit_price,
    unit: r.unit || 'm',
    projectName: r.project_name || '',
    pipelineId: r.pipeline_id || ''
  })) });
},

  'uploadPhoto': async (params, env) => {
  // 上傳施工照片到 R2
  // 參數：pipelineId, segmentNumber, smallIndex, uploader, lat, lng, takenAt, imageBase64, mimeType
  if (!params.pipelineId || !params.imageBase64) return json({ success: false, error: '缺少參數' });
  
  const photoId = 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const mimeType = params.mimeType || 'image/jpeg';
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const key = `${params.pipelineId}/${params.segmentNumber || 'general'}/${params.smallIndex || 0}/${photoId}.${ext}`;
  
  // base64 → binary
  const base64Data = params.imageBase64.replace(/^data:[^;]+;base64,/, '');
  const binaryStr = atob(base64Data);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  
  // 上傳到 R2
  await env.PHOTOS.put(key, bytes.buffer, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      pipelineId: params.pipelineId || '',
      segmentNumber: params.segmentNumber || '',
      smallIndex: String(params.smallIndex || 0),
      uploader: params.uploader || '未知',
      lat: String(params.lat || ''),
      lng: String(params.lng || ''),
      takenAt: params.takenAt || new Date().toISOString(),
      uploadedAt: new Date().toISOString(),
    }
  });
  
  // 同時在 D1 記錄 metadata（方便查詢）
  await env.DB.prepare(
    `INSERT INTO photos (id, pipeline_id, segment_number, small_index, r2_key, uploader, lat, lng, taken_at, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(
    photoId, params.pipelineId, params.segmentNumber || '', parseInt(params.smallIndex) || 0,
    key, params.uploader || '未知',
    parseFloat(params.lat) || null, parseFloat(params.lng) || null,
    params.takenAt || new Date().toISOString()
  ).run();
  
  return json({ success: true, photoId, key });
},

  'getPhotos': async (params, env) => {
  // 取得某工程/某小段的照片列表
  if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  
  let query = `SELECT * FROM photos WHERE pipeline_id = ?`;
  const binds = [params.pipelineId];
  
  if (params.segmentNumber !== undefined && params.segmentNumber !== '') {
    query += ` AND segment_number = ?`;
    binds.push(params.segmentNumber);
  }
  if (params.smallIndex !== undefined && params.smallIndex !== '') {
    query += ` AND small_index = ?`;
    binds.push(parseInt(params.smallIndex));
  }
  query += ` ORDER BY uploaded_at DESC LIMIT 50`;
  
  const rows = await env.DB.prepare(query).bind(...binds).all();
  
  // 產生每張照片的暫時 URL（直接從 R2 讀取 base64）
  const photos = await Promise.all(rows.results.map(async r => {
    try {
      const obj = await env.PHOTOS.get(r.r2_key);
      if (!obj) return null;
      const bytes = await obj.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
      const mime = obj.httpMetadata?.contentType || 'image/jpeg';
      return {
        id: r.id,
        pipelineId: r.pipeline_id,
        segmentNumber: r.segment_number,
        smallIndex: r.small_index,
        uploader: r.uploader,
        lat: r.lat,
        lng: r.lng,
        takenAt: r.taken_at,
        uploadedAt: r.uploaded_at,
        dataUrl: `data:${mime};base64,${b64}`
      };
    } catch(e) { return null; }
  }));
  
  return json({ success: true, photos: photos.filter(Boolean) });
},

  'deletePhoto': async (params, env) => {
  if (!params.photoId) return json({ success: false, error: '缺少 photoId' });
  const row = await env.DB.prepare(`SELECT r2_key FROM photos WHERE id = ?`).bind(params.photoId).first();
  if (row) {
    await env.PHOTOS.delete(row.r2_key);
    await env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(params.photoId).run();
  }
  return json({ success: true });
},

  'syncUser': async (params, env) => {
  // 登入時同步使用者資料，回傳角色
  if (!params.email) return json({ success: false, error: '缺少 email' });
  const existing = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(params.email).first();
  if (existing) {
    // 更新最後登入時間和名稱
    await env.DB.prepare('UPDATE users SET last_login = datetime("now"), name = ?, picture = ? WHERE email = ?')
      .bind(params.name || existing.name, params.picture || existing.picture, params.email).run();
    return json({ success: true, role: existing.role, isNew: false });
  } else {
    // 新使用者，預設 viewer
    await env.DB.prepare('INSERT INTO users (email, name, picture, role) VALUES (?, ?, ?, "viewer")')
      .bind(params.email, params.name || '', params.picture || '').run();
    return json({ success: true, role: 'viewer', isNew: true });
  }
},

  'getUsers': async (params, env) => {
  // 管理員取得所有使用者列表
  const rows = await env.DB.prepare('SELECT email, name, picture, role, created_at, last_login FROM users ORDER BY created_at DESC').all();
  return json({ success: true, users: rows.results });
},

  'setUserRole': async (params, env) => {
  // 管理員設定使用者角色
  if (!params.email || !params.role) return json({ success: false, error: '缺少參數' });
  const validRoles = ['admin', 'supervisor', 'contractor', 'viewer'];
  if (!validRoles.includes(params.role)) return json({ success: false, error: '無效角色' });
  await env.DB.prepare('UPDATE users SET role = ? WHERE email = ?').bind(params.role, params.email).run();
  return json({ success: true });
},

  'deleteUser': async (params, env) => {
  // 管理員刪除使用者
  if (!params.email) return json({ success: false, error: '缺少 email' });
  await env.DB.prepare('DELETE FROM users WHERE email = ?').bind(params.email).run();
  return json({ success: true });
},

  'getAccounting': async (params, env) => {
  // 取得某工程的核銷金額（依月份）＋各 code 明細
  if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  const rows = await env.DB.prepare(
    'SELECT * FROM accounting WHERE pipeline_id = ? ORDER BY year_month ASC'
  ).bind(params.pipelineId).all();
  // 取各 code 明細（若有）
  let codeRows = { results: [] };
  try {
    codeRows = await env.DB.prepare(
      'SELECT year_month, code, amount, category FROM accounting_by_code WHERE pipeline_id = ? ORDER BY year_month ASC, code ASC'
    ).bind(params.pipelineId).all();
  } catch(e) { /* 若表不存在則略過 */ }
  return json({ success: true, records: rows.results, byCode: codeRows.results });
},

  'saveAccounting': async (params, env) => {
  // 儲存某工程某月的核銷金額
  if (!params.pipelineId || !params.year_month || params.amount === undefined)
    return json({ success: false, error: '缺少參數' });
  const id = params.pipelineId + '_' + params.year_month;
  await env.DB.prepare(
    'INSERT OR REPLACE INTO accounting (id, pipeline_id, year_month, amount, note) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, params.pipelineId, params.year_month, parseFloat(params.amount), params.note || '').run();
  return json({ success: true });
},

  'deleteAccounting': async (params, env) => {
  if (!params.id) return json({ success: false, error: '缺少 id' });
  await env.DB.prepare('DELETE FROM accounting WHERE id = ?').bind(params.id).run();
  return json({ success: true });
},

  'clearAllAccounting': async (params, env) => {
  // 清除所有工程的核銷資料（慎用）
  await env.DB.prepare('DELETE FROM accounting').run();
  try { await env.DB.prepare('DELETE FROM accounting_by_code').run(); } catch(e) {}
  return json({ success: true });
},

  'getContractAmount': async (params, env) => {
  if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  let row = null;
  try {
    row = await env.DB.prepare('SELECT amount FROM contract_amount WHERE pipeline_id = ?').bind(params.pipelineId).first();
  } catch(e) {}
  return json({ success: true, amount: row ? row.amount : null });
},

  'saveContractAmount': async (params, env) => {
  if (!params.pipelineId || params.amount === undefined) return json({ success: false, error: '缺少參數' });
  try {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS contract_amount (pipeline_id TEXT PRIMARY KEY, amount REAL NOT NULL)').run();
    await env.DB.prepare('INSERT OR REPLACE INTO contract_amount (pipeline_id, amount) VALUES (?, ?)').bind(params.pipelineId, parseFloat(params.amount)).run();
  } catch(e) { return json({ success: false, error: e.message }); }
  return json({ success: true });
},

  'getAccountingBudget': async (params, env) => {
  // 取得所有年度預算設定
  let rows = { results: [] };
  try {
    rows = await env.DB.prepare(
      'SELECT * FROM accounting_budget ORDER BY prefix ASC, year ASC'
    ).all();
  } catch(e) { /* 表不存在則略過 */ }
  return json({ success: true, budgets: rows.results });
},

  'saveAccountingBudget': async (params, env) => {
  // 儲存某前綴某年度的預算金額
  if (!params.prefix || !params.year || params.amount === undefined)
    return json({ success: false, error: '缺少參數' });
  const id = params.prefix + '_' + params.year;
  try {
    await env.DB.prepare(
      'CREATE TABLE IF NOT EXISTS accounting_budget (id TEXT PRIMARY KEY, prefix TEXT NOT NULL, year INTEGER NOT NULL, amount REAL NOT NULL DEFAULT 0)'
    ).run();
    await env.DB.prepare(
      'INSERT OR REPLACE INTO accounting_budget (id, prefix, year, amount) VALUES (?, ?, ?, ?)'
    ).bind(id, params.prefix.toUpperCase(), parseInt(params.year), parseFloat(params.amount)).run();
  } catch(e) { return json({ success: false, error: e.message }); }
  return json({ success: true });
},

  'deleteAccountingBudget': async (params, env) => {
  if (!params.id) return json({ success: false, error: '缺少 id' });
  try {
    await env.DB.prepare('DELETE FROM accounting_budget WHERE id = ?').bind(params.id).run();
  } catch(e) {}
  return json({ success: true });
},

  'importAccountingExcel': async (params, env) => {
  // 匯入 Excel 解析結果（前端解析後送來）
  // params.records = [{year_month, amount, note}]
  if (!params.pipelineId || !params.records) return json({ success: false, error: '缺少參數' });
  const records = typeof params.records === 'string' ? JSON.parse(params.records) : params.records;
  // 用 batch 一次送出：原本逐筆 await 會有 N 次網路往返（幾百筆就很慢），
  // 且中途失敗會只匯入一半。batch 是單一交易，全成功或全不生效。
  const ins = env.DB.prepare(
    'INSERT OR REPLACE INTO accounting (id, pipeline_id, year_month, amount, note) VALUES (?, ?, ?, ?, ?)'
  );
  const stmts = records.map(r => ins.bind(
    params.pipelineId + '_' + r.year_month, params.pipelineId,
    r.year_month, parseFloat(r.amount), r.note || ''));
  if (stmts.length) await env.DB.batch(stmts);
  return json({ success: true, count: stmts.length });
},

  'getPipelineCodes': async (params, env) => {
  if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  const rows = await env.DB.prepare('SELECT code FROM pipeline_codes WHERE pipeline_id = ? ORDER BY code').bind(params.pipelineId).all();
  return json({ success: true, codes: rows.results.map(r => r.code) });
},

  'setPipelineCodes': async (params, env) => {
  // 設定工程對應編號（先刪再加，包成單一交易避免中途失敗把編號清空）
  if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  const codes = typeof params.codes === 'string' ? JSON.parse(params.codes) : (params.codes || []);
  const stmts = [
    env.DB.prepare('DELETE FROM pipeline_codes WHERE pipeline_id = ?').bind(params.pipelineId),
  ];
  const ins = env.DB.prepare('INSERT OR IGNORE INTO pipeline_codes (pipeline_id, code) VALUES (?, ?)');
  for (const code of codes) {
    if (code && String(code).trim()) stmts.push(ins.bind(params.pipelineId, String(code).trim()));
  }
  await env.DB.batch(stmts);
  return json({ success: true, count: stmts.length - 1 });
},

  'importAllPipelinesExcel': async (params, env) => {
  // 一次匯入所有工程：Excel records + 系統工程編號對應
  // params.allRecords = [{code, year_month, amount}]
  if (!params.allRecords) return json({ success: false, error: '缺少資料' });
  const allRecords = typeof params.allRecords === 'string' ? JSON.parse(params.allRecords) : params.allRecords;

  // 取得所有工程的編號對應
  const mappings = await env.DB.prepare('SELECT pipeline_id, code FROM pipeline_codes').all();
  const codeMap = {}; // code -> pipeline_id
  mappings.results.forEach(m => { codeMap[m.code] = m.pipeline_id; });

  // 依工程和月份合併金額；同時記錄各 code + category 明細
  const merged = {}; // pipeline_id_ym -> {pipeline_id, year_month, amount}
  const byCode = {}; // pipeline_id_ym_code_cat -> {pipeline_id, year_month, code, category, amount}
  let matched = 0, unmatched = 0;
  allRecords.forEach(r => {
    const pipelineId = codeMap[r.code];
    if (!pipelineId) { unmatched++; return; }
    const cat = r.category || 'other';
    const key = pipelineId + '_' + r.year_month;
    if (!merged[key]) merged[key] = { pipeline_id: pipelineId, year_month: r.year_month, amount: 0 };
    merged[key].amount += r.amount;
    const codeKey = pipelineId + '_' + r.year_month + '_' + r.code + '_' + cat;
    if (!byCode[codeKey]) byCode[codeKey] = { pipeline_id: pipelineId, year_month: r.year_month, code: r.code, category: cat, amount: 0 };
    byCode[codeKey].amount += r.amount;
    matched++;
  });

  // 寫入 accounting（合計）— 用 batch 取代逐筆 await，快很多且不會只匯入一半
  const insAcc = env.DB.prepare('INSERT OR REPLACE INTO accounting (id, pipeline_id, year_month, amount) VALUES (?, ?, ?, ?)');
  const accStmts = Object.entries(merged).map(([key, rec]) =>
    insAcc.bind(key, rec.pipeline_id, rec.year_month, rec.amount));
  const saved = await batchAll(env, accStmts);

  // 寫入 accounting_by_code（各 code + category 明細）
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS accounting_by_code (id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, year_month TEXT NOT NULL, code TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, category TEXT)").run();
    const insCode = env.DB.prepare(
      'INSERT OR REPLACE INTO accounting_by_code (id, pipeline_id, year_month, code, amount, category) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const codeStmts = Object.entries(byCode).map(([codeKey, rec]) =>
      insCode.bind(codeKey, rec.pipeline_id, rec.year_month, rec.code, rec.amount, rec.category));
    await batchAll(env, codeStmts);
  } catch(e) { /* 略過 */ }

  return json({ success: true, saved, matched, unmatched });
},

  'ensureValveColumn': async (params, env) => {
  try { await env.DB.prepare('ALTER TABLE small_segments ADD COLUMN is_valve INTEGER DEFAULT 0').run(); } catch(e) {}
  return json({ success: true });
},

  'getStickyNotes': async (params, env) => {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS sticky_notes (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL,
      text TEXT NOT NULL,
      color INTEGER DEFAULT 0,
      sw_lat REAL, sw_lng REAL,
      ne_lat REAL, ne_lng REAL,
      created_at TEXT
    )
  `).run();
  // 便利貼尺寸欄位（舊表沒有，冪等補欄；已存在會失敗但無害）。放在 CREATE 之後，全新 DB 也適用。
  try { await env.DB.prepare(`ALTER TABLE sticky_notes ADD COLUMN width INTEGER`).run(); } catch (e) {}
  try { await env.DB.prepare(`ALTER TABLE sticky_notes ADD COLUMN height INTEGER`).run(); } catch (e) {}
  if (!params.pipelineId) return json({ success: true, notes: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM sticky_notes WHERE pipeline_id = ? ORDER BY created_at DESC`
  ).bind(params.pipelineId).all();
  const notes = rows.results.map(r => ({
    id: r.id,
    pipelineId: r.pipeline_id,
    text: r.text,
    color: r.color,
    swLat: r.sw_lat,
    swLng: r.sw_lng,
    neLat: r.ne_lat,
    neLng: r.ne_lng,
    width: r.width || null,
    height: r.height || null,
    createdAt: r.created_at,
  }));
  return json({ success: true, notes });
},

  'addStickyNote': async (params, env) => {
  // 建表（若不存在）
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS sticky_notes (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL,
      text TEXT NOT NULL,
      color INTEGER DEFAULT 0,
      sw_lat REAL, sw_lng REAL,
      ne_lat REAL, ne_lng REAL,
      created_at TEXT
    )
  `).run();
  const noteId = 'sticky_' + Date.now();
  await env.DB.prepare(
    `INSERT INTO sticky_notes (id, pipeline_id, text, color, sw_lat, sw_lng, ne_lat, ne_lng, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(
    noteId,
    params.pipelineId || '',
    params.text || '',
    parseInt(params.color) || 0,
    parseFloat(params.swLat) || 0,
    parseFloat(params.swLng) || 0,
    parseFloat(params.neLat) || 0,
    parseFloat(params.neLng) || 0,
  ).run();
  return json({ success: true, noteId });
},

  'updateStickyNote': async (params, env) => {
  // 🐛 修正：改為部分更新（只更新有傳的欄位）。
  // 原本是全欄位覆蓋——前端只想存寬度時，text 會被清成空字串、座標被歸零。
  if (!params.noteId) return json({ success: false, error: '缺少 noteId' });
  try { await env.DB.prepare(`ALTER TABLE sticky_notes ADD COLUMN width INTEGER`).run(); } catch (e) {}
  try { await env.DB.prepare(`ALTER TABLE sticky_notes ADD COLUMN height INTEGER`).run(); } catch (e) {}
  const sets = [], binds = [];
  if (params.text !== undefined) { sets.push('text=?'); binds.push(params.text || ''); }
  if (params.color !== undefined) { sets.push('color=?'); binds.push(parseInt(params.color) || 0); }
  if (params.swLat !== undefined) { sets.push('sw_lat=?'); binds.push(parseFloat(params.swLat) || 0); }
  if (params.swLng !== undefined) { sets.push('sw_lng=?'); binds.push(parseFloat(params.swLng) || 0); }
  if (params.neLat !== undefined) { sets.push('ne_lat=?'); binds.push(parseFloat(params.neLat) || 0); }
  if (params.neLng !== undefined) { sets.push('ne_lng=?'); binds.push(parseFloat(params.neLng) || 0); }
  if (params.width !== undefined) { sets.push('width=?'); binds.push(parseInt(params.width) || null); }
  if (params.height !== undefined) { sets.push('height=?'); binds.push(parseInt(params.height) || null); }
  if (sets.length === 0) return json({ success: true });
  binds.push(params.noteId);
  await env.DB.prepare(`UPDATE sticky_notes SET ${sets.join(', ')} WHERE id=?`).bind(...binds).run();
  return json({ success: true });
},

  'deleteStickyNote': async (params, env) => {
  await env.DB.prepare(`DELETE FROM sticky_notes WHERE id=?`).bind(params.noteId).run();
  return json({ success: true });
},

  'getPhotoSegments': async (params, env) => {
          if (!params.pipelineId) return json({ success: true, groups: [] });
          const rows = await env.DB.prepare(
            `SELECT DISTINCT segment_number, small_index
             FROM photos WHERE pipeline_id = ?
             ORDER BY segment_number, small_index`
          ).bind(params.pipelineId).all();
          const groups = (rows.results || []).map(r => ({
            segmentNumber: r.segment_number,
            smallIndex: r.small_index,
          }));
          return json({ success: true, groups });
        },

  'updatePanel': async (params, env) => {
          if (!params.panelId) return json({ success: false, error: '缺少 panelId' });
          await env.DB.prepare(`UPDATE panels SET content=? WHERE id=?`)
            .bind(params.content || params.text || '', params.panelId).run();
          return json({ success: true });
        },

  'clearAllSegments': async (params, env) => {
          if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
          // 兩張表一起清，包成單一交易：避免大段刪了、小段沒刪（或反之）造成資料不一致
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM segments WHERE pipeline_id = ?`).bind(params.pipelineId),
            env.DB.prepare(`DELETE FROM small_segments WHERE pipeline_id = ?`).bind(params.pipelineId),
          ]);
          return json({ success: true });
        },

  'saveSegment': async (params, env) => {
          // 新增/覆蓋一個大段，並自動產生其小段（純 ceil 切法，與全系統一致）
          const segNum = String(params.segmentNumber);
          const startD = parseFloat(params.startDistance) || 0;
          const endD = parseFloat(params.endDistance) || 0;
          await env.DB.prepare(
            `INSERT OR REPLACE INTO segments (pipeline_id, segment_number, start_distance, end_distance, status, diameter, pipe_type, method, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(params.pipelineId, segNum, startD, endD,
            params.status || '未施工', params.diameter || '', params.pipeType || '',
            params.method || '', params.notes || '').run();
          const segLen = endD - startD;
          const numSmall = Math.max(0, Math.ceil(segLen / 10));
          const inserts = [];
          for (let i = 0; i < numSmall; i++) {
            const smallStart = startD + i * 10;
            const smallEnd = Math.min(smallStart + 10, endD);
            inserts.push(env.DB.prepare(
              `INSERT OR IGNORE INTO small_segments (pipeline_id, segment_number, small_index, start_distance, end_distance, diameter, pipe_type, method, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0')`
            ).bind(params.pipelineId, segNum, i, smallStart, smallEnd,
              params.diameter || '', params.pipeType || '', params.method || ''));
          }
          if (inserts.length) await env.DB.batch(inserts); // N 次來回 → 1 次
          return json({ success: true, smallSegments: numSmall });
        },

  'updateSegmentInfo': async (params, env) => {
          // 只更新大段的管徑/管材/工法，並同步到其小段（讓地圖上色一致）
          const segNum = String(params.segmentNumber);
          const updates = [];
          const vals = [];
          if (params.diameter !== undefined) { updates.push('diameter=?'); vals.push(params.diameter); }
          if (params.pipeType !== undefined) { updates.push('pipe_type=?'); vals.push(params.pipeType); }
          if (params.method !== undefined) { updates.push('method=?'); vals.push(params.method); }
          if (updates.length === 0) return json({ success: true });
          const setClause = updates.join(',');
          await env.DB.prepare(
            `UPDATE segments SET ${setClause} WHERE pipeline_id=? AND segment_number=?`
          ).bind(...vals, params.pipelineId, segNum).run();
          await env.DB.prepare(
            `UPDATE small_segments SET ${setClause} WHERE pipeline_id=? AND segment_number=?`
          ).bind(...vals, params.pipelineId, segNum).run();
          return json({ success: true });
        },

  'updateGanttOrder': async (params, env) => {
          // 甘特圖拖拉排序（gantt.js 有呼叫，原本後端沒有這個 action，排序永遠存不進去）
          let orders = [];
          try { orders = JSON.parse(params.orders || '[]'); } catch { return json({ success: false, error: 'orders 格式錯誤' }); }
          if (!Array.isArray(orders) || orders.length === 0) return json({ success: true });
          await env.DB.batch(orders.map(o =>
            env.DB.prepare(`UPDATE gantt SET sort_order = ? WHERE id = ? AND pipeline_id = ?`)
              .bind(parseInt(o.sortOrder) || 0, String(o.id), params.pipelineId)
          ));
          return json({ success: true });
        },

};

export default {
  async fetch(request, env) {
    // 處理 CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      const url = new URL(request.url);
      let params = {};

// 先讀 URL params（GET 和 POST 都讀）
url.searchParams.forEach((v, k) => (params[k] = v));

if (request.method !== 'GET') {
    const ct = request.headers.get('Content-Type') || '';
    let bodyParams = {};
    if (ct.includes('application/json')) {
        bodyParams = await request.json();
    } else if (ct.includes('x-www-form-urlencoded')) {
        const text = await request.text();
        new URLSearchParams(text).forEach((v, k) => (bodyParams[k] = v));
    } else {
        try { bodyParams = await request.json(); } catch {}
    }
    // body 參數覆蓋 URL 參數
    Object.assign(params, bodyParams);
}

      const action = params.action || url.searchParams.get('action');

      // 寫入動作先過權限驗證（讀取 get* 維持公開）
      const authFail = await checkWritePermission(action, params, env);
      if (authFail) return authFail;

      const handler = HANDLERS[action];
      if (!handler) {
        return json({ success: false, error: 'Unknown action: ' + (action || '(none)') }, 400);
      }
      return await handler(params, env);

    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }
};