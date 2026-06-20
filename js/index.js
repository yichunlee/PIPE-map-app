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

      switch (action) {

case 'saveUnitPrice': {
  if (!params.methodKey || !params.pipelineId) return json({ success: false, error: '缺少參數' });
  await env.DB.prepare(
    `INSERT INTO method_prices (method_key, pipeline_id, project_name, unit_price, unit)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(method_key, pipeline_id) DO UPDATE SET unit_price=excluded.unit_price, project_name=excluded.project_name`
  ).bind(params.methodKey, params.pipelineId, params.projectName || '', parseFloat(params.unitPrice) || 0, params.unit || 'm').run();
  return json({ success: true });
}

case 'deleteUnitPrice': {
  if (!params.methodKey || !params.pipelineId) return json({ success: false, error: '缺少參數' });
  await env.DB.prepare(
    `DELETE FROM method_prices WHERE method_key = ? AND pipeline_id = ?`
  ).bind(params.methodKey, params.pipelineId).run();
  return json({ success: true });
}



        // ==================== 計畫 ====================
        case 'getProjects': {
          const rows = await env.DB.prepare(
            `SELECT DISTINCT project_name as name FROM pipelines ORDER BY project_name`
          ).all();
          return json({ success: true, projects: rows.results });
        }

        // ==================== 工程 ====================
case 'getPipelines': {
  const rows = await env.DB.prepare(
    `SELECT * FROM pipelines WHERE project_name = ? ORDER BY id`
  ).bind(params.projectName).all();
  // 取所有 codes
  const codeRows = await env.DB.prepare(
    `SELECT pipeline_id, GROUP_CONCAT(code) as codes FROM pipeline_codes GROUP BY pipeline_id`
  ).all();
  const codesMap = {};
  (codeRows.results || []).forEach(r => { codesMap[r.pipeline_id] = r.codes ? r.codes.split(',') : []; });
  // 轉換欄位名稱符合前端期待
  const pipelines = rows.results.map(p => ({
    id: p.id,
    projectName: p.project_name,
    name: p.name,
    area: p.area,
    linestring: p.linestring,
    notes: p.notes,
    created_at: p.created_at,
    codes: codesMap[p.id] || [],
  }));
  return json({ success: true, pipelines });
}

        case 'addPipeline': {
          const id = params.customPipelineId || ('P' + Date.now());
          await env.DB.prepare(
            `INSERT INTO pipelines (id, project_name, name, area, linestring) VALUES (?, ?, ?, ?, ?)`
          ).bind(id, params.projectName, params.pipelineName, params.area || '台中市', params.linestring || '').run();
          return json({ success: true, pipelineId: id });
        }

        case 'updatePipeline': {
          await env.DB.prepare(
            `UPDATE pipelines SET id = ?, project_name = ?, name = ? WHERE id = ?`
          ).bind(params.newPipelineId, params.projectName, params.name, params.oldPipelineId).run();
          return json({ success: true });
        }

        case 'deletePipeline': {
          const pid = params.pipelineId;
          await env.DB.prepare(`DELETE FROM pipelines WHERE id = ?`).bind(pid).run();
          await env.DB.prepare(`DELETE FROM segments WHERE pipeline_id = ?`).bind(pid).run();
          await env.DB.prepare(`DELETE FROM small_segments WHERE pipeline_id = ?`).bind(pid).run();
          await env.DB.prepare(`DELETE FROM map_notes WHERE pipeline_id = ?`).bind(pid).run();
          await env.DB.prepare(`DELETE FROM gantt WHERE pipeline_id = ?`).bind(pid).run();
          await env.DB.prepare(`DELETE FROM milestones WHERE pipeline_id = ?`).bind(pid).run();
          await env.DB.prepare(`DELETE FROM permit_zones WHERE pipeline_id = ?`).bind(pid).run();
          await env.DB.prepare(`DELETE FROM shafts WHERE pipeline_id = ?`).bind(pid).run();
          await env.DB.prepare(`DELETE FROM panels WHERE pipeline_id = ?`).bind(pid).run();
          return json({ success: true });
        }

        case 'updateLinestring': {
          await env.DB.prepare(
            `UPDATE pipelines SET linestring = ? WHERE id = ?`
          ).bind(params.linestring, params.pipelineId).run();
          return json({ success: true });
        }

        // ==================== 施工進度（大段）====================
        case 'getProgress': {
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
        }

        case 'addSegment': {
          const segNum = String(params.segmentNumber);
          await env.DB.prepare(
            `INSERT OR REPLACE INTO segments (pipeline_id, segment_number, start_distance, end_distance, status, diameter, pipe_type, method, notes)
             VALUES (?, ?, ?, ?, '未施工', ?, ?, ?, ?)`
          ).bind(params.pipelineId, segNum, params.startDistance, params.endDistance,
            params.diameter || '', params.pipeType || '', params.method || '', params.notes || '').run();

          // 自動建立小段
          const segLen = parseFloat(params.endDistance) - parseFloat(params.startDistance);
          const numSmall = Math.ceil(segLen / 10);
          for (let i = 0; i < numSmall; i++) {
            const smallStart = parseFloat(params.startDistance) + i * 10;
            const smallEnd = Math.min(smallStart + 10, parseFloat(params.endDistance));
            await env.DB.prepare(
              `INSERT OR IGNORE INTO small_segments (pipeline_id, segment_number, small_index, start_distance, end_distance, diameter, pipe_type, method, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0')`
            ).bind(params.pipelineId, segNum, i, smallStart, smallEnd,
              params.diameter || '', params.pipeType || '', params.method || '').run();
          }
          return json({ success: true, smallSegments: numSmall });
        }

        case 'updateSegment': {
          const segNum = String(params.segmentNumber);
          await env.DB.prepare(
            `UPDATE segments SET start_distance=?, end_distance=?, diameter=?, pipe_type=?, method=?, notes=? WHERE pipeline_id=? AND segment_number=?`
          ).bind(params.startDistance, params.endDistance, params.diameter || '',
            params.pipeType || '', params.method || '', params.notes || '',
            params.pipelineId, segNum).run();
          return json({ success: true });
        }

        case 'deleteSegment': {
          const segNum = String(params.segmentNumber);
          await env.DB.prepare(`DELETE FROM segments WHERE pipeline_id=? AND segment_number=?`)
            .bind(params.pipelineId, segNum).run();
          await env.DB.prepare(`DELETE FROM small_segments WHERE pipeline_id=? AND segment_number=?`)
            .bind(params.pipelineId, segNum).run();
          return json({ success: true });
        }

        // ==================== 小段 ====================
        case 'updateSmallSegment': {
          const segNum = String(params.segmentNumber);
          const idx = parseInt(params.smallIndex);
          const status = params.status || '0';
          await env.DB.prepare(
            `UPDATE small_segments SET status=? WHERE pipeline_id=? AND segment_number=? AND small_index=?`
          ).bind(status, params.pipelineId, segNum, idx).run();
          return json({ success: true });
        }

        // 🆕 直接更新單一小段的管線資料
case 'updateSmallSegmentInfo': {
  const segNum = String(params.segmentNumber);
  const idx = parseInt(params.smallIndex);
  const updates = [];
  const vals = [];
  if (params.diameter !== undefined) { updates.push('diameter=?'); vals.push(params.diameter); }
  if (params.pipeType !== undefined) { updates.push('pipe_type=?'); vals.push(params.pipeType); }
  if (params.method !== undefined) { updates.push('method=?'); vals.push(params.method); }
  if (params.status !== undefined) { updates.push('status=?'); vals.push(params.status); }
  if (params.nodeName !== undefined) { updates.push('node_name=?'); vals.push(params.nodeName); }
  if (updates.length === 0) return json({ success: true });
  vals.push(params.pipelineId, segNum, idx);
  await env.DB.prepare(
    `UPDATE small_segments SET ${updates.join(',')} WHERE pipeline_id=? AND segment_number=? AND small_index=?`
  ).bind(...vals).run();
  return json({ success: true });
}

        case 'updateWholeSegment': {
          const segNum = String(params.segmentNumber);
          const status = params.status === 'completed' ? new Date().toISOString().slice(0, 10) : '0';
          await env.DB.prepare(
            `UPDATE small_segments SET status=? WHERE pipeline_id=? AND segment_number=?`
          ).bind(status, params.pipelineId, segNum).run();
          return json({ success: true });
        }

        // ==================== 地圖備註 ====================
case 'getMapNotes': {
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
}

case 'addMapNote': {
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
}

case 'updateMapNote': {
  await env.DB.prepare(
    `UPDATE map_notes SET content=? WHERE id=?`
  ).bind(params.content || params.text || '', params.noteId).run();
  return json({ success: true });
}

        case 'deleteMapNote': {
          await env.DB.prepare(`DELETE FROM map_notes WHERE id=?`).bind(params.noteId).run();
          return json({ success: true });
        }

        // ==================== 使用者 ====================

case 'verifyUser': {
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
  
  return json({ success: true, authorized: true, role: user.role || 'viewer' });
}




        case 'getUser': {
          const row = await env.DB.prepare(
            `SELECT * FROM users WHERE email=?`
          ).bind(params.email).first();
          return json({ success: true, user: row });
        }

        case 'registerUser': {
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
        }

        case 'updateUserRole': {
          await env.DB.prepare(
            `UPDATE users SET role=? WHERE email=?`
          ).bind(params.role, params.email).run();
          return json({ success: true });
        }

        // ==================== 甘特圖 ====================
        case 'getGantt': {
          const rows = await env.DB.prepare(
            `SELECT * FROM gantt WHERE pipeline_id=? ORDER BY start_date`
          ).bind(params.pipelineId).all();
          return json({ success: true, ganttData: rows.results });
        }

case 'addGanttItem': {
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
}

case 'updateGanttItem': {
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
}

case 'deleteGanttItem': {
  await env.DB.prepare(`DELETE FROM gantt WHERE id=?`).bind(params.itemId).run();
  return json({ success: true });
}

case 'getGanttItems': {
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
}


        case 'saveGantt': {
          const items = JSON.parse(params.ganttData || '[]');
          await env.DB.prepare(`DELETE FROM gantt WHERE pipeline_id=?`).bind(params.pipelineId).run();
          for (const item of items) {
            await env.DB.prepare(
              `INSERT INTO gantt (id, pipeline_id, item_name, start_date, end_date, status, notes, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(item.id || ('gt_' + Date.now() + Math.random()), params.pipelineId,
              item.itemName || '', item.startDate || '', item.endDate || '',
              item.status || '', item.notes || '', item.unitPrice || '').run();
          }
          return json({ success: true });
        }

        // ==================== 挖掘許可範圍 ====================


case 'addPermitZone': {
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
}

        case 'updatePermitZone': {
          await env.DB.prepare(
            `UPDATE permit_zones SET name=?, status=?, permit_number=?, start_date=?, end_date=? WHERE id=?`
          ).bind(params.name, params.status, params.permitNumber || '',
            params.startDate || '', params.endDate || '', params.zoneId).run();
          return json({ success: true });
        }

        case 'deletePermitZone': {
          await env.DB.prepare(`DELETE FROM permit_zones WHERE id=?`).bind(params.zoneId).run();
          return json({ success: true });
        }

        // ==================== 施工單價 ====================
        case 'getMethodPrices': {
          const rows = await env.DB.prepare(
            `SELECT * FROM method_prices WHERE pipeline_id=?`
          ).bind(params.pipelineId).all();
          return json({ success: true, prices: rows.results });
        }

        case 'saveMethodPrice': {
          await env.DB.prepare(
            `INSERT OR REPLACE INTO method_prices (method_key, pipeline_id, project_name, unit_price, unit) VALUES (?, ?, ?, ?, ?)`
          ).bind(params.methodKey, params.pipelineId, params.projectName || '',
            params.unitPrice || 0, params.unit || 'm').run();
          return json({ success: true });
        }


case 'getPanels': {
  if (!params.pipelineId) return json({ success: true, panels: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM panels WHERE pipeline_id = ?`
  ).bind(params.pipelineId).all();
  return json({ success: true, panels: rows.results });
}

case 'addPanel': {
  const panelId = 'panel_' + Date.now();
  await env.DB.prepare(
    `INSERT INTO panels (id, pipeline_id, lng, lat, content, created_by, photo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(panelId, params.pipelineId, params.lng, params.lat,
    params.content || '', params.createdBy || '匿名', params.photo || '').run();
  return json({ success: true, panelId });
}

case 'deletePanel': {
  await env.DB.prepare(`DELETE FROM panels WHERE id=?`).bind(params.panelId).run();
  return json({ success: true });
}

case 'getShafts': {
  if (!params.pipelineId) return json({ success: true, shafts: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM shafts WHERE pipeline_id = ?`
  ).bind(params.pipelineId).all();
  return json({ success: true, shafts: rows.results });
}

case 'addShaft': {
  await env.DB.prepare(
    `INSERT INTO shafts (pipeline_id, segment_number, position_type, design_depth, current_depth, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(params.pipelineId, params.segmentNumber || '',
    params.positionType || '', params.designDepth || 0,
    params.currentDepth || 0, params.status || '').run();
  return json({ success: true });
}



case 'getPermitZones': {
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
}

case 'getMilestones': {
  if (!params.pipelineId) return json({ success: true, milestones: [] });
  const rows = await env.DB.prepare(
    `SELECT * FROM milestones WHERE pipeline_id = ?`
  ).bind(params.pipelineId).all();
  return json({ success: true, milestones: rows.results });
}

case 'getTaichungRoadwork': {
  const rows = await env.DB.prepare(
    `SELECT * FROM taichung_roadwork ORDER BY rowid DESC`
  ).all();
  const data = rows.results.map(r => ({
    '許可證編號': r.permit_number,
    '地點': r.location,
    '申請單位': r.applicant,
    '工程名稱': r.project_name,
    '核准起日期': r.start_date,
    '核准迄日期': r.end_date,
    '經度': r.lng,
    '緯度': r.lat,
    '最後更新': r.last_update,
    '施工範圍坐標': r.coordinates,
  }));
  return json({ success: true, data, count: data.length });
}


case 'updateTaichungRoadwork': {
  const apiUrl = 'https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=d5adb71a-00bb-4573-b67e-ffdccfc7cd27';
  const resp = await fetch(apiUrl);
  if (!resp.ok) return json({ success: false, error: 'HTTP ' + resp.status });
  
  const data = await resp.json();
  const filtered = data.filter(w => (w.申請單位 || '').includes('中區工程處'));
  
  await env.DB.prepare(`DELETE FROM taichung_roadwork`).run();
  
  const now = new Date().toISOString();
  for (const w of filtered) {
    await env.DB.prepare(
      `INSERT INTO taichung_roadwork (permit_number, location, applicant, project_name, start_date, end_date, lng, lat, last_update, coordinates)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      w.許可證編號 || '', w.地點 || '', w.申請單位 || '',
      w.工程名稱 || '', w.核准起日期 || '', w.核准迄日期 || '',
      parseFloat(w.經度) || 0, parseFloat(w.緯度) || 0,
      now, w.施工範圍坐標 || ''
    ).run();
  }
  return json({ success: true, count: filtered.length });
}


case 'getSegments': {
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
}

case 'listWgisFiles': {
  const rows = await env.DB.prepare(
    `SELECT id, name, size, uploaded_at FROM wgis_files ORDER BY uploaded_at DESC`
  ).all();
  return json({ success: true, files: rows.results });
}

case 'uploadWgisFile': {
  const fileId = 'wgis_' + Date.now();
  const content = params.data || '';
  // base64 decode to get size
  const size = Math.round(content.length * 0.75);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO wgis_files (id, name, content, size, uploaded_at) VALUES (?, ?, ?, ?, datetime('now'))`
  ).bind(fileId, params.fileName || 'unknown.csv', content, size).run();
  return json({ success: true, id: fileId, name: params.fileName });
}

case 'getWgisFile': {
  const row = await env.DB.prepare(
    `SELECT content FROM wgis_files WHERE id = ?`
  ).bind(params.fileId).first();
  if (!row) return json({ success: false, error: '找不到檔案' });
  return json({ success: true, data: row.content });
}

case 'deleteWgisFile': {
  await env.DB.prepare(`DELETE FROM wgis_files WHERE id = ?`).bind(params.fileId).run();
  return json({ success: true });
}
// 初始化小段（路徑儲存後自動呼叫）
case 'initSmallSegments': {
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
}

// 批次更新小段屬性（範圍選取）
case 'batchUpdateSmallSegments': {
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
}

// 取得所有小段（新版 getProgress）
case 'clearOldSegments': {
  // 清除舊架構 segments 資料（已改用新架構 branches 的工程使用）
  if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  await env.DB.prepare(`DELETE FROM segments WHERE pipeline_id = ?`).bind(params.pipelineId).run();
  return json({ success: true });
}

case 'generateMonthlyReport': {
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
}

case 'getAllSmallSegments': {
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
    nodeName: row.node_name || '',  // 加這行
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
}

case 'getUnitPrices': {
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
}



case 'uploadPhoto': {
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
}

case 'getPhotos': {
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
}

case 'deletePhoto': {
  if (!params.photoId) return json({ success: false, error: '缺少 photoId' });
  const row = await env.DB.prepare(`SELECT r2_key FROM photos WHERE id = ?`).bind(params.photoId).first();
  if (row) {
    await env.PHOTOS.delete(row.r2_key);
    await env.DB.prepare(`DELETE FROM photos WHERE id = ?`).bind(params.photoId).run();
  }
  return json({ success: true });
}

case 'syncUser': {
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
}

case 'getUsers': {
  // 管理員取得所有使用者列表
  const rows = await env.DB.prepare('SELECT email, name, picture, role, created_at, last_login FROM users ORDER BY created_at DESC').all();
  return json({ success: true, users: rows.results });
}

case 'setUserRole': {
  // 管理員設定使用者角色
  if (!params.email || !params.role) return json({ success: false, error: '缺少參數' });
  const validRoles = ['admin', 'supervisor', 'contractor', 'viewer'];
  if (!validRoles.includes(params.role)) return json({ success: false, error: '無效角色' });
  await env.DB.prepare('UPDATE users SET role = ? WHERE email = ?').bind(params.role, params.email).run();
  return json({ success: true });
}

case 'deleteUser': {
  // 管理員刪除使用者
  if (!params.email) return json({ success: false, error: '缺少 email' });
  await env.DB.prepare('DELETE FROM users WHERE email = ?').bind(params.email).run();
  return json({ success: true });
}

case 'getAccounting': {
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
}

case 'saveAccounting': {
  // 儲存某工程某月的核銷金額
  if (!params.pipelineId || !params.year_month || params.amount === undefined)
    return json({ success: false, error: '缺少參數' });
  const id = params.pipelineId + '_' + params.year_month;
  await env.DB.prepare(
    'INSERT OR REPLACE INTO accounting (id, pipeline_id, year_month, amount, note) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, params.pipelineId, params.year_month, parseFloat(params.amount), params.note || '').run();
  return json({ success: true });
}

case 'deleteAccounting': {
  if (!params.id) return json({ success: false, error: '缺少 id' });
  await env.DB.prepare('DELETE FROM accounting WHERE id = ?').bind(params.id).run();
  return json({ success: true });
}

case 'clearAllAccounting': {
  // 清除所有工程的核銷資料（慎用）
  await env.DB.prepare('DELETE FROM accounting').run();
  try { await env.DB.prepare('DELETE FROM accounting_by_code').run(); } catch(e) {}
  return json({ success: true });
}

case 'getContractAmount': {
  if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  let row = null;
  try {
    row = await env.DB.prepare('SELECT amount FROM contract_amount WHERE pipeline_id = ?').bind(params.pipelineId).first();
  } catch(e) {}
  return json({ success: true, amount: row ? row.amount : null });
}

case 'saveContractAmount': {
  if (!params.pipelineId || params.amount === undefined) return json({ success: false, error: '缺少參數' });
  try {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS contract_amount (pipeline_id TEXT PRIMARY KEY, amount REAL NOT NULL)').run();
    await env.DB.prepare('INSERT OR REPLACE INTO contract_amount (pipeline_id, amount) VALUES (?, ?)').bind(params.pipelineId, parseFloat(params.amount)).run();
  } catch(e) { return json({ success: false, error: e.message }); }
  return json({ success: true });
}

case 'getAccountingBudget': {
  // 取得所有年度預算設定
  let rows = { results: [] };
  try {
    rows = await env.DB.prepare(
      'SELECT * FROM accounting_budget ORDER BY prefix ASC, year ASC'
    ).all();
  } catch(e) { /* 表不存在則略過 */ }
  return json({ success: true, budgets: rows.results });
}

case 'saveAccountingBudget': {
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
}

case 'deleteAccountingBudget': {
  if (!params.id) return json({ success: false, error: '缺少 id' });
  try {
    await env.DB.prepare('DELETE FROM accounting_budget WHERE id = ?').bind(params.id).run();
  } catch(e) {}
  return json({ success: true });
}

case 'importAccountingExcel': {
  // 匯入 Excel 解析結果（前端解析後送來）
  // params.records = [{year_month, amount, note}]
  if (!params.pipelineId || !params.records) return json({ success: false, error: '缺少參數' });
  const records = typeof params.records === 'string' ? JSON.parse(params.records) : params.records;
  let count = 0;
  for (const r of records) {
    const id = params.pipelineId + '_' + r.year_month;
    await env.DB.prepare(
      'INSERT OR REPLACE INTO accounting (id, pipeline_id, year_month, amount, note) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, params.pipelineId, r.year_month, parseFloat(r.amount), r.note || '').run();
    count++;
  }
  return json({ success: true, count });
}

case 'getPipelineCodes': {
  if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  const rows = await env.DB.prepare('SELECT code FROM pipeline_codes WHERE pipeline_id = ? ORDER BY code').bind(params.pipelineId).all();
  return json({ success: true, codes: rows.results.map(r => r.code) });
}

case 'setPipelineCodes': {
  // 設定工程對應編號（先刪再加）
  if (!params.pipelineId) return json({ success: false, error: '缺少 pipelineId' });
  const codes = typeof params.codes === 'string' ? JSON.parse(params.codes) : (params.codes || []);
  await env.DB.prepare('DELETE FROM pipeline_codes WHERE pipeline_id = ?').bind(params.pipelineId).run();
  for (const code of codes) {
    if (code.trim()) {
      await env.DB.prepare('INSERT OR IGNORE INTO pipeline_codes (pipeline_id, code) VALUES (?, ?)').bind(params.pipelineId, code.trim()).run();
    }
  }
  return json({ success: true });
}

case 'importAllPipelinesExcel': {
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

  // 寫入 accounting（合計）
  let saved = 0;
  for (const [key, rec] of Object.entries(merged)) {
    await env.DB.prepare('INSERT OR REPLACE INTO accounting (id, pipeline_id, year_month, amount) VALUES (?, ?, ?, ?)')
      .bind(key, rec.pipeline_id, rec.year_month, rec.amount).run();
    saved++;
  }

  // 寫入 accounting_by_code（各 code + category 明細）
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS accounting_by_code (id TEXT PRIMARY KEY, pipeline_id TEXT NOT NULL, year_month TEXT NOT NULL, code TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, category TEXT)").run();
    for (const [codeKey, rec] of Object.entries(byCode)) {
      await env.DB.prepare(
        'INSERT OR REPLACE INTO accounting_by_code (id, pipeline_id, year_month, code, amount, category) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(codeKey, rec.pipeline_id, rec.year_month, rec.code, rec.amount, rec.category).run();
    }
  } catch(e) { /* 略過 */ }

  return json({ success: true, saved, matched, unmatched });
}

case 'getDgsApply': {
  // 從公路申挖管理系統撈台灣自來水公司中區工程處的申挖案件
  try {
    // Step 1: 取得頁面的 VIEWSTATE 和 csrf token
    const pageRes = await fetch('https://dgs.thb.gov.tw/THBDGS/', {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      }
    });
    if (!pageRes.ok) return json({ success: false, error: 'page fetch failed: ' + pageRes.status });
    const pageHtml = await pageRes.text();
    
    // 取 VIEWSTATE
    const vsMatch = pageHtml.match(/id="__VIEWSTATE"\s+value="([^"]+)"/);
    const vsgMatch = pageHtml.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/);
    const evMatch = pageHtml.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/);
    const csrfMatch = pageHtml.match(/id="csrf"\s+value="([^"]+)"/);
    const pageSetMatch = pageHtml.match(/id="__pageSetArgK"\s+value="([^"]+)"/);
    
    if (!vsMatch) return json({ success: false, error: 'VIEWSTATE not found', htmlLen: pageHtml.length });
    
    // 取 cookie
    const setCookieHeader = pageRes.headers.get('set-cookie') || '';
    const cookieMatch = setCookieHeader.match(/ASP\.NET_SessionId=([^;]+)/);
    const sessionCookie = cookieMatch ? 'ASP.NET_SessionId=' + cookieMatch[1] : '';
    
    // Step 2: 送出查詢（臺中市）
    const body = new URLSearchParams();
    body.set('ScriptManager1', 'ScriptManager1|BtnS');
    body.set('__SCROLLPOS', '0');
    body.set('__reloadActType', '');
    body.set('__nowActType', '');
    body.set('__pageBodyActBtnType', '');
    body.set('__pageBodyActBtnEventArgument', '');
    body.set('__pageBodyActBtnEventKey', '');
    body.set('__pageBodyTreeActBtn', '');
    body.set('__pageSetArgK', pageSetMatch ? pageSetMatch[1] : '');
    body.set('__pageSetArgV', '');
    body.set('__VIEWSTATE', vsMatch[1]);
    body.set('__VIEWSTATEGENERATOR', vsgMatch ? vsgMatch[1] : '');
    body.set('__EVENTVALIDATION', evMatch ? evMatch[1] : '');
    body.set('csrf', csrfMatch ? csrfMatch[1] : '');
    body.set('DrpCity', '臺中市');
    body.set('DrpWorkSection', '');  // 不限工務段
    body.set('DrpRoad', '');
    body.set('TxtArgU', '');
    body.set('TxtArgP', '');
    body.set('__ASYNCPOST', 'true');
    body.set('BtnS', '查詢');
    
    const queryRes = await fetch('https://dgs.thb.gov.tw/THBDGS/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'X-MicrosoftAjax': 'Delta=true',
        'Referer': 'https://dgs.thb.gov.tw/THBDGS/',
        'Cookie': sessionCookie,
      },
      body: body.toString()
    });
    
    if (!queryRes.ok) return json({ success: false, error: 'query failed: ' + queryRes.status });
    const responseText = await queryRes.text();
    
    // 解析表格（在 ASP.NET UpdatePanel 的 response 裡）
    const tableMatch = responseText.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) return json({ success: false, error: 'table not found', preview: responseText.substring(0, 500) });
    
    // 解析 tr/td
    const rows = [];
    const trReg = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    let rowIdx = 0;
    while ((trMatch = trReg.exec(tableMatch[0])) !== null) {
      if (rowIdx === 0) { rowIdx++; continue; } // skip header
      const tds = [];
      const tdReg = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let tdMatch;
      while ((tdMatch = tdReg.exec(trMatch[1])) !== null) {
        tds.push(tdMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
      }
      if (tds.length >= 5) {
        const pipeUnit = tds[2] || '';
        // 只取台灣自來水公司中區工程處
        if (pipeUnit.includes('台灣自來水') && pipeUnit.includes('中區')) {
          rows.push({
            applyNo: tds[0],
            receiveDate: tds[1],
            pipeUnit: pipeUnit,
            pipeType: tds[3],
            location: tds[4],
            period: tds[5] || '',
            section: tds[6] || '',
            city: tds[7] || '',
            status: tds[8] || ''
          });
        }
      }
      rowIdx++;
    }
    
    return json({ success: true, count: rows.length, records: rows });
  } catch(e) {
    return json({ success: false, error: e.message });
  }
}

        // ==================== 便利貼 ====================

case 'getStickyNotes': {
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
    createdAt: r.created_at,
  }));
  return json({ success: true, notes });
}

case 'addStickyNote': {
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
}

case 'updateStickyNote': {
  await env.DB.prepare(
    `UPDATE sticky_notes SET text=?, color=?, sw_lat=?, sw_lng=?, ne_lat=?, ne_lng=? WHERE id=?`
  ).bind(
    params.text || '',
    parseInt(params.color) || 0,
    parseFloat(params.swLat) || 0,
    parseFloat(params.swLng) || 0,
    parseFloat(params.neLat) || 0,
    parseFloat(params.neLng) || 0,
    params.noteId,
  ).run();
  return json({ success: true });
}

case 'deleteStickyNote': {
  await env.DB.prepare(`DELETE FROM sticky_notes WHERE id=?`).bind(params.noteId).run();
  return json({ success: true });
}

        default:
          return json({ success: false, error: 'Unknown action: ' + action }, 400);
      }

    } catch (err) {
      return json({ success: false, error: err.message }, 500);
    }
  }
};