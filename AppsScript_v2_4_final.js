// Google Apps Script for 管線施工進度管理系統 v2.0
// 支援手動定義大段落 + 10m 小段狀態

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

// 處理 OPTIONS 請求（CORS preflight）
function doOptions(e) {
  return ContentService
    .createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function handleRequest(e) {
  // 安全地取得 action 參數和其他參數
  let action = null;
  let params = {};
  
  // 先取 URL query string 參數（GET 或 POST 都可能有）
  if (e && e.parameter) {
    params = Object.assign({}, e.parameter);
    action = params.action;
  }
  
  // 再合併 POST body（照片等大型資料放這裡）
  if (e && e.postData && e.postData.contents) {
    try {
      const bodyParams = JSON.parse(e.postData.contents);
      params = Object.assign(params, bodyParams);
      // 如果 URL 沒有 action，從 body 取
      if (!action) action = params.action;
    } catch (error) {
      // 如果解析失敗，繼續
    }
  }
  
  // 如果沒有 action，回傳測試訊息
  if (!action) {
    return ContentService.createTextOutput(JSON.stringify({ 
      success: true, 
      message: 'API 運作正常',
      timestamp: new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'}),
      hint: '請提供 action 參數，例如：?action=getProjects'
    }))
    .setMimeType(ContentService.MimeType.JSON);
  }
  
  let result = {};
  
  try {
    switch(action) {
      case 'getProjects':
        result = getProjects();
        break;
      case 'getPipelines':
        result = getPipelines(params.projectName);
        break;
      case 'getProgress':
        result = getProgress(params.pipelineId);
        break;
      case 'updateLargeSegment':
        // 更新整段狀態
        result = updateLargeSegment(params.pipelineId, params.segmentNumber, params.userEmail, params.notes);
        break;
      case 'getMapNotes':
        result = getMapNotes(params.pipelineId);
        break;
      case 'addMapNote':
        result = addMapNote(params.lat, params.lng, params.text, params.creator, params.photo, params.pipelineId);
        break;
      case 'updateMapNote':
        result = updateMapNote(params.noteId, params.text, params.photo);
        break;
      case 'deleteMapNote':
        result = deleteMapNote(params.noteId);
        break;
      case 'getShafts':
        result = getShafts(params.pipelineId);
        break;
      case 'addShaft':
        result = addShaft(params);
        break;
      case 'updateShaft':
        result = updateShaft(params);
        break;
      case 'deleteShaft':
        result = deleteShaft(params.shaftId);
        break;
      case 'getPermitZones':
        result = getPermitZones(params.pipelineId);
        break;
      case 'addPermitZone':
        result = addPermitZone(params);
        break;
      case 'updatePermitZone':
        result = updatePermitZone(params);
        break;
      case 'deletePermitZone':
        result = deletePermitZone(params.zoneId);
        break;
      case 'getMilestones':
        result = getMilestones(params.pipelineId);
        break;
      case 'addMilestone':
        result = addMilestone(params);
        break;
      case 'updateMilestone':
        result = updateMilestone(params);
        break;
      case 'deleteMilestone':
        result = deleteMilestone(params.milestoneId);
        break;
      case 'getGanttItems':
        result = getGanttItems(params.pipelineId);
        break;
      case 'addGanttItem':
        result = addGanttItem(params);
        break;
      case 'updateGanttItem':
        result = updateGanttItem(params);
        break;
      case 'deleteGanttItem':
        result = deleteGanttItem(params.itemId);
        break;
      case 'getTaichungRoadwork':
        result = getTaichungRoadwork();
        break;
      case 'updateTaichungRoadwork':
        result = updateTaichungRoadworkData();
        break;
      case 'saveSegment':
        // 儲存新段落
        result = saveSegment(params);
        break;
      case 'updateSegment':
        // 更新段落（包含範圍）
        result = updateSegment(params);
        break;
      case 'updateSegmentInfo':
        // 只更新段落資訊（不含範圍）
        result = updateSegmentInfo(params);
        break;
      case 'updateSmallSegment':
        // 更新小段狀態
        result = updateSmallSegment(params);
        break;
      case 'deleteSegment':
        // 刪除段落
        result = deleteSegment(params.pipelineId, params.segmentNumber);
        break;
      case 'clearAllSegments':
        // 清空工程所有段落
        result = clearAllSegments(params.pipelineId);
        break;
      default:
        result = { error: 'Unknown action: ' + action };
    }
  } catch (error) {
    result = { error: error.toString() };
    Logger.log('Error: ' + error.toString());
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// 取得所有計畫
function getProjects() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('計畫清單');
    
    if (!sheet) {
      return { error: '找不到「計畫清單」工作表' };
    }
    
    const data = sheet.getDataRange().getValues();
    const projects = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        projects.push({
          name: data[i][0],
          area: data[i][1] || ''
        });
      }
    }
    
    return { projects: projects };
  } catch (error) {
    return { error: error.toString() };
  }
}

// 取得指定計畫的所有工程
function getPipelines(projectName) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('工程清單');
    
    if (!sheet) {
      return { error: '找不到「工程清單」工作表' };
    }
    
    const data = sheet.getDataRange().getValues();
    const pipelines = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][2] === projectName) {
        pipelines.push({
          id: data[i][0],
          name: data[i][1],
          projectName: data[i][2],
          linestring: data[i][3],
          notes: data[i][4] || ''
        });
      }
    }
    
    return { pipelines: pipelines };
  } catch (error) {
    return { error: error.toString() };
  }
}

// 儲存新段落到 Google Sheets
function saveSegment(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('施工進度');
    
    if (!sheet) {
      // 如果工作表不存在，建立它
      sheet = ss.insertSheet('施工進度');
      sheet.appendRow(['工程編號', '段落編號', '起始距離', '結束距離', '施工狀態', '管徑', '施工方式', '完成時間', '完成者', '備註', '小段狀態']);
    }
    
    // 新增段落
    sheet.appendRow([
      params.pipelineId,
      params.segmentNumber,
      params.startDistance,
      params.endDistance,
      params.status || '未施工',
      params.diameter || '',
      params.method || '',
      '',  // 完成時間
      '',  // 完成者
      '',  // 備註
      ''   // 小段狀態
    ]);
    
    Logger.log('成功儲存段落：' + params.pipelineId + ' 段落 ' + params.segmentNumber);
    
    return { 
      success: true,
      message: '段落已儲存'
    };
    
  } catch (error) {
    return { 
      success: false, 
      error: error.toString() 
    };
  }
}

// 更新小段狀態
function updateSmallSegment(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const progressSheet = ss.getSheetByName('施工進度');
    
    if (!progressSheet) {
      return { success: false, error: '找不到「施工進度」工作表' };
    }
    
    const data = progressSheet.getDataRange().getValues();
    const targetPipelineId = String(params.pipelineId);
    const targetSegmentNumber = Number(params.segmentNumber);
    
    Logger.log('========== 開始更新小段 ==========');
    Logger.log('尋找工程編號: [' + targetPipelineId + '] (型別: ' + typeof targetPipelineId + ')');
    Logger.log('尋找段落編號: [' + targetSegmentNumber + '] (型別: ' + typeof targetSegmentNumber + ')');
    Logger.log('小段索引: ' + params.smallIndex);
    Logger.log('新狀態: ' + params.status);
    Logger.log('總共有 ' + (data.length - 1) + ' 行資料');
    Logger.log('====================================');
    
    // 找到要更新的行
    for (let i = 1; i < data.length; i++) {
      const rowPipelineId = String(data[i][0]);
      const rowSegmentNumber = Number(data[i][1]);
      
      Logger.log('檢查第 ' + (i + 1) + ' 行:');
      Logger.log('  A欄工程編號: [' + rowPipelineId + '] (型別: ' + typeof rowPipelineId + ')');
      Logger.log('  B欄段落編號: [' + rowSegmentNumber + '] (型別: ' + typeof rowSegmentNumber + ')');
      Logger.log('  比對結果: 工程=' + (rowPipelineId === targetPipelineId) + ', 段落=' + (rowSegmentNumber === targetSegmentNumber));
      
      if (rowPipelineId === targetPipelineId && rowSegmentNumber === targetSegmentNumber) {
        Logger.log('✅ 找到符合的行 ' + (i + 1) + '！');
        
        // 讀取現有的小段狀態 (J 欄)
        let smallSegments = data[i][9] || ''; // J 欄是第 10 欄 (index 9)
        Logger.log('原始 J 欄內容: [' + smallSegments + '] (型別: ' + typeof smallSegments + ')');
        
        let statusArray = [];
        if (smallSegments && smallSegments.toString().trim()) {
          statusArray = smallSegments.toString().split(',').map(s => s.trim());
          Logger.log('解析後陣列: ' + JSON.stringify(statusArray));
        } else {
          Logger.log('J 欄是空的，建立新陣列');
        }
        
        // 計算需要幾個小段
        const startDist = Number(data[i][2]);
        const endDist = Number(data[i][3]);
        const segLength = endDist - startDist;
        const numSmallSegments = Math.ceil(segLength / 10);
        
        Logger.log('段落範圍: ' + startDist + 'm - ' + endDist + 'm');
        Logger.log('段落長度: ' + segLength + 'm');
        Logger.log('需要小段數: ' + numSmallSegments);
        Logger.log('目前陣列長度: ' + statusArray.length);
        
        // 確保陣列長度足夠
        Logger.log('開始補 0...');
        while (statusArray.length < numSmallSegments) {
          statusArray.push('0');
          Logger.log('  補第 ' + (statusArray.length - 1) + ' 個 0，目前長度: ' + statusArray.length);
        }
        Logger.log('補 0 完成，最終長度: ' + statusArray.length);
        
        // 更新指定小段的狀態
        const smallIndex = parseInt(params.smallIndex);
        Logger.log('要更新的小段索引: ' + smallIndex);
        
        if (smallIndex >= 0 && smallIndex < statusArray.length) {
          Logger.log('更新小段 ' + smallIndex + ': [' + statusArray[smallIndex] + '] → [' + params.status + ']');
          statusArray[smallIndex] = params.status;
        } else {
          Logger.log('❌ 小段索引 ' + smallIndex + ' 超出範圍 (0-' + (statusArray.length - 1) + ')');
          return { success: false, error: '小段索引超出範圍' };
        }
        
        // 寫回 J 欄
        const newSmallSegments = statusArray.join(',');
        Logger.log('新的 J 欄內容: [' + newSmallSegments + ']');
        Logger.log('寫入位置: 第 ' + (i + 1) + ' 行，第 10 欄 (J)');
        
        progressSheet.getRange(i + 1, 10).setValue(newSmallSegments); // J 欄
        
        Logger.log('✅ 成功更新小段：' + targetPipelineId + ' 段落 ' + targetSegmentNumber + ' 小段 ' + smallIndex);
        return { success: true, message: '小段已更新' };
      }
    }
    
    Logger.log('❌ 找不到符合的段落！');
    Logger.log('尋找目標: 工程=' + targetPipelineId + ', 段落=' + targetSegmentNumber);
    return { 
      success: false, 
      error: '找不到對應的段落（工程: ' + targetPipelineId + ', 段落: ' + targetSegmentNumber + '）',
      debug: '共檢查 ' + (data.length - 1) + ' 行資料'
    };
    
  } catch (error) {
    Logger.log('❌ 發生錯誤: ' + error.toString());
    Logger.log('錯誤堆疊: ' + error.stack);
    return { success: false, error: error.toString() };
  }
}

// 只更新段落資訊（管徑、管種、工法），不更新範圍
function updateSegmentInfo(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const progressSheet = ss.getSheetByName('施工進度');
    
    if (!progressSheet) {
      return { success: false, error: '找不到「施工進度」工作表' };
    }
    
    const data = progressSheet.getDataRange().getValues();
    
    // 找到要更新的行
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == params.pipelineId && data[i][1] == params.segmentNumber) {
        // 只更新管徑、管種、工法，不動範圍和 J 欄
        progressSheet.getRange(i + 1, 6).setValue(params.diameter || '');  // F: 管徑
        progressSheet.getRange(i + 1, 7).setValue(params.pipeType || '');  // G: 管種
        progressSheet.getRange(i + 1, 8).setValue(params.method || '');    // H: 施工方式
        
        Logger.log('成功更新段落資訊：' + params.pipelineId + ' 段落 ' + params.segmentNumber);
        return { success: true, message: '段落資訊已更新' };
      }
    }
    
    return { success: false, error: '找不到指定的段落' };
    
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// 更新段落資訊（包含範圍）
function updateSegment(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('施工進度');
    
    if (!sheet) {
      return { success: false, error: '找不到「施工進度」工作表' };
    }
    
    const data = sheet.getDataRange().getValues();
    
    // 找到要更新的行
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === params.pipelineId && data[i][1] == params.segmentNumber) {
        // 更新資料
        sheet.getRange(i + 1, 3).setValue(params.startDistance);   // C: 起始距離
        sheet.getRange(i + 1, 4).setValue(params.endDistance);     // D: 結束距離
        sheet.getRange(i + 1, 6).setValue(params.diameter || '');  // F: 管徑
        sheet.getRange(i + 1, 7).setValue(params.method || '');    // G: 施工方式
        
        Logger.log('成功更新段落：' + params.pipelineId + ' 段落 ' + params.segmentNumber);
        return { success: true, message: '段落已更新' };
      }
    }
    
    return { success: false, error: '找不到指定的段落' };
    
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// 清空工程所有段落
function clearAllSegments(pipelineId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('施工進度');
    
    if (!sheet) {
      return { success: false, error: '找不到「施工進度」工作表' };
    }
    
    const data = sheet.getDataRange().getValues();
    let deletedCount = 0;
    
    // 從後往前刪除（避免索引問題）
    for (let i = data.length - 1; i >= 1; i--) {
      if (data[i][0] === pipelineId) {
        sheet.deleteRow(i + 1);
        deletedCount++;
      }
    }
    
    Logger.log('成功清空工程 ' + pipelineId + ' 的 ' + deletedCount + ' 個段落');
    return { 
      success: true, 
      message: '已清空 ' + deletedCount + ' 個段落',
      deletedCount: deletedCount
    };
    
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// 刪除段落
function deleteSegment(pipelineId, segmentNumber) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('施工進度');
    
    if (!sheet) {
      return { success: false, error: '找不到「施工進度」工作表' };
    }
    
    const data = sheet.getDataRange().getValues();
    
    // 找到要刪除的行
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === pipelineId && data[i][1] == segmentNumber) {
        sheet.deleteRow(i + 1);
        Logger.log('成功刪除段落：' + pipelineId + ' 段落 ' + segmentNumber);
        return { success: true, message: '段落已刪除' };
      }
    }
    
    return { success: false, error: '找不到指定的段落' };
    
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

// 取得工程的施工進度（大段落 + 小段狀態）
function getProgress(pipelineId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const progressSheet = ss.getSheetByName('施工進度');
    
    if (!progressSheet) {
      return { 
        error: '找不到「施工進度」工作表',
        segments: []
      };
    }
    
    const data = progressSheet.getDataRange().getValues();
    const segments = [];
    
    Logger.log('尋找工程編號: ' + pipelineId);
    
    // 跳過表頭，找出這個工程的所有段落
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === pipelineId) { // A欄是工程編號
        segments.push({
          segmentNumber: data[i][1],        // B: 段落編號
          startDistance: data[i][2],        // C: 起始距離
          endDistance: data[i][3],          // D: 結束距離
          status: data[i][4] || '未施工',   // E: 施工狀態
          diameter: data[i][5] || '',       // F: 管徑
          pipeType: data[i][6] || '',       // G: 管種
          method: data[i][7] || '',         // H: 施工方式
          notes: data[i][8] || '',          // I: 備註
          smallSegments: data[i][9] || ''   // J: 小段狀態
        });
      }
    }
    
    Logger.log('找到 ' + segments.length + ' 個段落');
    
    return { 
      segments: segments,
      lastUpdate: new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'})
    };
  } catch (error) {
    return { 
      error: error.toString(),
      segments: []
    };
  }
}

// 更新小段狀態
// 更新整段狀態
function updateLargeSegment(pipelineId, segmentNumber, userEmail, notes) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('施工進度');
    
    if (!sheet) {
      return { error: '找不到「施工進度」工作表' };
    }
    
    const data = sheet.getDataRange().getValues();
    
    // 找到對應的大段落
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === pipelineId && data[i][1] === segmentNumber) {
        const startDist = data[i][2];
        const endDist = data[i][3];
        const segmentLength = endDist - startDist;
        const numSmallSegs = Math.ceil(segmentLength / 10);
        
        // 建立全部為 1 的小段狀態
        const allCompleted = new Array(numSmallSegs).fill('1').join(',');
        
        // 更新資料
        const now = new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'});
        
        sheet.getRange(i + 1, 5).setValue('已完成');     // E: 施工狀態
        sheet.getRange(i + 1, 8).setValue(now);          // H: 完成時間
        sheet.getRange(i + 1, 9).setValue(userEmail);    // I: 完成者
        sheet.getRange(i + 1, 10).setValue(notes);       // J: 備註
        sheet.getRange(i + 1, 11).setValue(allCompleted);// K: 小段狀態
        
        return { 
          success: true,
          message: '整段已標記為完成'
        };
      }
    }
    
    return { error: '找不到對應的段落' };
  } catch (error) {
    return { error: error.toString() };
  }
}

// ========== 地圖備註功能 ==========

function getMapNotes(pipelineId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('地圖備註');
    
    if (!sheet) {
      return { notes: [] };
    }
    
    const data = sheet.getDataRange().getValues();
    const notes = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        const notePipelineId = data[i][7] || ''; // 第 8 欄（索引 7）是工程ID
        
        // 如果有指定 pipelineId（查看個別工程）
        if (pipelineId) {
          // 只回傳完全符合的備註（排除空白 pipelineId 的舊資料）
          if (notePipelineId !== pipelineId) {
            continue;
          }
        }
        // 如果沒有指定 pipelineId（總覽地圖），回傳所有備註
        
        notes.push({
          id: data[i][0],
          lng: data[i][1],
          lat: data[i][2],
          text: data[i][3],
          timestamp: data[i][4],
          creator: data[i][5],
          photo: data[i][6] || '',
          pipelineId: notePipelineId
        });
      }
    }
    
    return { notes: notes };
  } catch (error) {
    return { error: error.toString() };
  }
}

// 取得或建立 Drive 照片資料夾
function getPhotoFolder() {
  const folderName = '管線備註照片';
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  // 建立新資料夾並設為任何人可檢視
  const folder = DriveApp.createFolder(folderName);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

// 將 Base64 照片存到 Google Drive，回傳公開連結
function savePhotoToDrive(base64Data, noteId) {
  try {
    // 解析 Base64（格式：data:image/jpeg;base64,xxxxx）
    const matches = base64Data.match(/^data:([a-zA-Z0-9+\/]+\/[a-zA-Z0-9+\/]+);base64,(.+)$/);
    if (!matches) return '';
    
    const mimeType = matches[1];
    const base64 = matches[2];
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, noteId + '.jpg');
    
    const folder = getPhotoFolder();
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    // 回傳可直接顯示的圖片網址（lh3 格式可跨域顯示）
    return 'https://lh3.googleusercontent.com/d/' + file.getId();
  } catch (error) {
    Logger.log('照片上傳 Drive 失敗: ' + error.toString());
    return '';
  }
}

function addMapNote(lat, lng, text, creator, photo, pipelineId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('地圖備註');
    
    if (!sheet) {
      sheet = ss.insertSheet('地圖備註');
      sheet.appendRow(['備註ID', '經度', '緯度', '備註內容', '建立時間', '建立者', '照片', '工程ID']);
    }
    
    const noteId = 'note_' + new Date().getTime();
    const timestamp = new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'});
    
    // 若有照片，上傳到 Google Drive
    let photoUrl = '';
    if (photo && photo.startsWith('data:')) {
      photoUrl = savePhotoToDrive(photo, noteId);
    } else if (photo) {
      photoUrl = photo; // 已經是 URL（舊資料相容）
    }
    
    sheet.appendRow([noteId, lng, lat, text, timestamp, creator, photoUrl, pipelineId || '']);
    
    return { success: true, noteId: noteId };
  } catch (error) {
    return { error: error.toString() };
  }
}

function updateMapNote(noteId, text, photo) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('地圖備註');
    
    if (!sheet) {
      return { error: '找不到地圖備註工作表' };
    }
    
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === noteId) {
        sheet.getRange(i + 1, 4).setValue(text);
        if (photo && photo.startsWith('data:')) {
          // 新照片，上傳到 Drive
          const photoUrl = savePhotoToDrive(photo, noteId + '_edit_' + new Date().getTime());
          if (photoUrl) sheet.getRange(i + 1, 7).setValue(photoUrl);
        } else if (photo) {
          sheet.getRange(i + 1, 7).setValue(photo);
        }
        return { success: true };
      }
    }
    
    return { error: '找不到指定的備註' };
  } catch (error) {
    return { error: error.toString() };
  }
}

function deleteMapNote(noteId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('地圖備註');
    
    if (!sheet) {
      return { error: '找不到地圖備註工作表' };
    }
    
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === noteId) {
        // 若有 Drive 照片，一併刪除
        const photoUrl = data[i][6] || '';
        if (photoUrl && photoUrl.includes('lh3.googleusercontent.com/d/')) {
          try {
            const fileId = photoUrl.replace('https://lh3.googleusercontent.com/d/', '');
            DriveApp.getFileById(fileId).setTrashed(true);
          } catch (driveError) {
            Logger.log('刪除 Drive 照片失敗（繼續刪備註）: ' + driveError.toString());
          }
        }
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    
    return { error: '找不到指定的備註' };
  } catch (error) {
    return { error: error.toString() };
  }
}

// ========== 甘特圖功能 ==========

function getGanttItems(pipelineId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('甘特圖');
    if (!sheet) return { items: [] };
    const data = sheet.getDataRange().getValues();
    const items = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && String(data[i][1]) === String(pipelineId)) {
        items.push({
          id: data[i][0], pipelineId: data[i][1],
          label: data[i][2],
          startDate: formatDate(data[i][3]),
          endDate: formatDate(data[i][4]),
          status: data[i][5] || '',
          notes: data[i][6] || ''
        });
      }
    }
    return { items };
  } catch(e) { return { error: e.toString() }; }
}

function addGanttItem(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('甘特圖');
    if (!sheet) {
      sheet = ss.insertSheet('甘特圖');
      sheet.appendRow(['項目ID','工程編號','施工項目','開始日期','完成日期','狀態','備註']);
    }
    const id = 'gt_' + new Date().getTime();
    sheet.appendRow([id, params.pipelineId, params.label,
      params.startDate, params.endDate, params.status||'', params.notes||'']);
    return { success: true };
  } catch(e) { return { error: e.toString() }; }
}

function updateGanttItem(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('甘特圖');
    if (!sheet) return { error: '找不到工作表' };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === params.itemId) {
        sheet.getRange(i+1, 3).setValue(params.label);
        sheet.getRange(i+1, 4).setValue(params.startDate);
        sheet.getRange(i+1, 5).setValue(params.endDate);
        sheet.getRange(i+1, 6).setValue(params.status||'');
        sheet.getRange(i+1, 7).setValue(params.notes||'');
        return { success: true };
      }
    }
    return { error: '找不到指定項目' };
  } catch(e) { return { error: e.toString() }; }
}

function deleteGanttItem(itemId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('甘特圖');
    if (!sheet) return { error: '找不到工作表' };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === itemId) { sheet.deleteRow(i+1); return { success: true }; }
    }
    return { error: '找不到指定項目' };
  } catch(e) { return { error: e.toString() }; }
}

// ========== 施工里程碑功能 ==========

function getMilestones(pipelineId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('施工里程碑');
    if (!sheet) return { milestones: [] };
    const data = sheet.getDataRange().getValues();
    const milestones = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && String(data[i][1]) === String(pipelineId)) {
        let methodData = {};
        try { methodData = JSON.parse(data[i][5] || '{}'); } catch(e) {}
        milestones.push({
          id: data[i][0], pipelineId: data[i][1],
          week: data[i][2],
          startDate: formatDate(data[i][3]),
          endDate: formatDate(data[i][4]),
          methodData: methodData,
          notes: data[i][6]
        });
      }
    }
    return { milestones };
  } catch(e) { return { error: e.toString() }; }
}

function addMilestone(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('施工里程碑');
    if (!sheet) {
      sheet = ss.insertSheet('施工里程碑');
      sheet.appendRow(['里程碑ID','工程編號','週次','開始日期','結束日期','工法資料(JSON)','備註']);
    }
    const id = 'ms_' + new Date().getTime();
    sheet.appendRow([id, params.pipelineId, params.week, params.startDate, params.endDate,
      params.methodData || '{}', params.notes || '']);
    return { success: true };
  } catch(e) { return { error: e.toString() }; }
}

function updateMilestone(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('施工里程碑');
    if (!sheet) return { error: '找不到工作表' };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === params.milestoneId) {
        sheet.getRange(i+1, 3).setValue(params.week);
        sheet.getRange(i+1, 4).setValue(params.startDate);
        sheet.getRange(i+1, 5).setValue(params.endDate);
        sheet.getRange(i+1, 6).setValue(params.methodData || '{}');
        sheet.getRange(i+1, 7).setValue(params.notes || '');
        return { success: true };
      }
    }
    return { error: '找不到指定里程碑' };
  } catch(e) { return { error: e.toString() }; }
}

function deleteMilestone(milestoneId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('施工里程碑');
    if (!sheet) return { error: '找不到工作表' };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === milestoneId) { sheet.deleteRow(i+1); return { success: true }; }
    }
    return { error: '找不到指定里程碑' };
  } catch(e) { return { error: e.toString() }; }
}

// ========== 挖掘許可範圍功能 ==========

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Taipei', 'yyyy-MM-dd');
  }
  return String(val).substring(0, 10);
}

function getPermitZones(pipelineId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('挖掘許可範圍');
    if (!sheet) return { zones: [] };
    const data = sheet.getDataRange().getValues();
    const zones = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && String(data[i][1]) === String(pipelineId)) {
        zones.push({
          id: data[i][0], pipelineId: data[i][1], label: data[i][2],
          status: data[i][3], permitNo: data[i][4],
          applyDate: formatDate(data[i][5]),
          permitDateStart: formatDate(data[i][6]),
          permitDateEnd: formatDate(data[i][7]),
          notes: data[i][8], points: data[i][9],
          creator: data[i][10], timestamp: data[i][11]
        });
      }
    }
    return { zones };
  } catch (e) { return { error: e.toString() }; }
}

function addPermitZone(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('挖掘許可範圍');
    if (!sheet) {
      sheet = ss.insertSheet('挖掘許可範圍');
      sheet.appendRow(['範圍ID','工程編號','說明','狀態','許可證號','申請時間','許可起始','許可結束','備註','座標點','建立者','建立時間']);
    }
    const id = 'zone_' + new Date().getTime();
    const timestamp = new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'});
    sheet.appendRow([id, params.pipelineId, params.label, params.status, params.permitNo || '', params.applyDate || '', params.permitDateStart || '', params.permitDateEnd || '', params.notes || '', params.points, params.creator || '匿名', timestamp]);
    return { success: true, zoneId: id };
  } catch (e) { return { error: e.toString() }; }
}

function updatePermitZone(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('挖掘許可範圍');
    if (!sheet) return { error: '找不到工作表' };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === params.zoneId) {
        sheet.getRange(i+1, 3).setValue(params.label);
        sheet.getRange(i+1, 4).setValue(params.status);
        sheet.getRange(i+1, 5).setValue(params.permitNo || '');
        sheet.getRange(i+1, 6).setValue(params.applyDate || '');
        sheet.getRange(i+1, 7).setValue(params.permitDateStart || '');
        sheet.getRange(i+1, 8).setValue(params.permitDateEnd || '');
        sheet.getRange(i+1, 9).setValue(params.notes || '');
        sheet.getRange(i+1, 11).setValue(params.creator || '');
        return { success: true };
      }
    }
    return { error: '找不到指定範圍' };
  } catch (e) { return { error: e.toString() }; }
}

function deletePermitZone(zoneId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('挖掘許可範圍');
    if (!sheet) return { error: '找不到工作表' };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === zoneId) { sheet.deleteRow(i + 1); return { success: true }; }
    }
    return { error: '找不到指定範圍' };
  } catch (e) { return { error: e.toString() }; }
}

// ========== 工作井功能 ==========

function getShafts(pipelineId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('工作井');
    if (!sheet) return { shafts: [] };
    
    const data = sheet.getDataRange().getValues();
    const shafts = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && String(data[i][1]) === String(pipelineId)) {
        shafts.push({
          id: data[i][0],
          pipelineId: data[i][1],
          lat: data[i][2],
          lng: data[i][3],
          name: data[i][4],
          type: data[i][5],
          designDepth: data[i][6],
          currentDepth: data[i][7],
          status: data[i][8],
          notes: data[i][9] || '',
          creator: data[i][10] || '',
          timestamp: data[i][11] || ''
        });
      }
    }
    return { shafts: shafts };
  } catch (error) {
    return { error: error.toString() };
  }
}

function addShaft(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('工作井');
    if (!sheet) {
      sheet = ss.insertSheet('工作井');
      sheet.appendRow(['井ID','工程編號','緯度','經度','名稱','類型','設計深度','目前開挖深度','施工狀況','備註','建立者','建立時間']);
    }
    const id = 'shaft_' + new Date().getTime();
    const timestamp = new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'});
    sheet.appendRow([id, params.pipelineId, params.lat, params.lng, params.name, params.type,
      params.designDepth || 0, params.currentDepth || 0, params.status, params.notes || '',
      params.creator || '匿名', timestamp]);
    return { success: true, shaftId: id };
  } catch (error) {
    return { error: error.toString() };
  }
}

function updateShaft(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('工作井');
    if (!sheet) return { error: '找不到工作井工作表' };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === params.shaftId) {
        sheet.getRange(i+1, 5).setValue(params.name);
        sheet.getRange(i+1, 6).setValue(params.type);
        sheet.getRange(i+1, 7).setValue(params.designDepth || 0);
        sheet.getRange(i+1, 8).setValue(params.currentDepth || 0);
        sheet.getRange(i+1, 9).setValue(params.status);
        sheet.getRange(i+1, 10).setValue(params.notes || '');
        sheet.getRange(i+1, 11).setValue(params.creator || '');
        return { success: true };
      }
    }
    return { error: '找不到指定工作井' };
  } catch (error) {
    return { error: error.toString() };
  }
}

function deleteShaft(shaftId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('工作井');
    if (!sheet) return { error: '找不到工作井工作表' };
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === shaftId) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { error: '找不到指定工作井' };
  } catch (error) {
    return { error: error.toString() };
  }
}

// ========== 台中市道路挖掘資料 ==========

function getTaichungRoadwork() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('台中市自來水施工');
    
    if (!sheet) {
      return { 
        success: false, 
        error: '找不到「台中市自來水施工」工作表，請先建立' 
      };
    }
    
    const data = sheet.getDataRange().getValues();
    const roadworks = [];
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        roadworks.push({
          許可證編號: data[i][0],
          地點: data[i][1],
          申請單位: data[i][2],
          工程名稱: data[i][3],
          核准起日期: data[i][4],
          核准迄日期: data[i][5],
          經度: data[i][6],
          緯度: data[i][7],
          施工範圍坐標: data[i][9] || ''
        });
      }
    }
    
    return { 
      success: true, 
      data: roadworks,
      count: roadworks.length
    };
  } catch (error) {
    return { 
      success: false, 
      error: error.toString()
    };
  }
}

function updateTaichungRoadworkData() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('台中市自來水施工');
    
    if (!sheet) {
      sheet = ss.insertSheet('台中市自來水施工');
      sheet.appendRow(['許可證編號', '地點', '申請單位', '工程名稱', '核准起日期', '核准迄日期', '經度', '緯度', '最後更新', '施工範圍坐標']);
    }
    
    const url = 'https://newdatacenter.taichung.gov.tw/api/v1/no-auth/resource.download?rid=d5adb71a-00bb-4573-b67e-ffdccfc7cd27';
    const options = {
      'muteHttpExceptions': true,
      'timeout': 30
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    
    if (responseCode !== 200) {
      return { success: false, error: 'HTTP ' + responseCode };
    }
    
    const data = JSON.parse(response.getContentText());
    
    const waterCompanyData = data.filter(function(work) {
      const company = work.申請單位 || '';
      return company.indexOf('中區工程處') !== -1;
    });
    
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
    
    const headers = sheet.getRange(1, 1, 1, 10).getValues()[0];
    if (headers[9] !== '施工範圍坐標') {
      sheet.getRange(1, 1, 1, 10).setValues([['許可證編號', '地點', '申請單位', '工程名稱', '核准起日期', '核准迄日期', '經度', '緯度', '最後更新', '施工範圍坐標']]);
    }
    
    let rowsAdded = 0;
    waterCompanyData.forEach(function(work) {
      const timestamp = new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'});
      sheet.appendRow([
        work.許可證編號 || '',
        work.地點 || '',
        work.申請單位 || '',
        work.工程名稱 || '',
        work.核准起日期 || '',
        work.核准迄日期 || '',
        work.經度 || '',
        work.緯度 || '',
        timestamp,
        work.施工範圍坐標 || ''
      ]);
      rowsAdded++;
    });
    
    return { 
      success: true, 
      count: rowsAdded,
      message: '成功更新 ' + rowsAdded + ' 筆中區工程處施工資料'
    };
    
  } catch (error) {
    return { 
      success: false, 
      error: error.toString() 
    };
  }
}
