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
  
  // 處理 POST body
  if (e && e.postData && e.postData.contents) {
    try {
      // 檢查 content type
      const contentType = e.postData.type || '';
      
      if (contentType.includes('application/json')) {
        // JSON 格式
        const bodyParams = JSON.parse(e.postData.contents);
        params = Object.assign(params, bodyParams);
        if (!action) action = params.action;
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        // Form-urlencoded 格式 (已經在 e.parameter 中)
        // Google Apps Script 會自動解析,不需要額外處理
        Logger.log('✅ 使用 form-urlencoded 格式');
      }
    } catch (error) {
      Logger.log('⚠️ POST body 解析失敗: ' + error.toString());
    }
  }
  
  // 除錯日誌
  if (action === 'updateLinestring') {
    Logger.log('🔍 updateLinestring 參數檢查:');
    Logger.log('   action: ' + action);
    Logger.log('   e.parameter 完整內容: ' + JSON.stringify(e.parameter));
    Logger.log('   params 完整內容: ' + JSON.stringify(params));
    Logger.log('   pipelineId: ' + params.pipelineId);
    Logger.log('   linestring 長度: ' + (params.linestring ? params.linestring.length : 0));
    Logger.log('   linestring 前 100 字元: ' + (params.linestring ? params.linestring.substring(0, 100) : 'null'));
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
      case 'getPanels':
        result = getPanels(params.pipelineId);
        break;
      case 'addPanel':
        result = addPanel(params);
        break;
      case 'updatePanel':
        result = updatePanel(params);
        break;
      case 'deletePanel':
        result = deletePanel(params.panelId);
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
      case 'updateWholeSegment':
        // 批次更新整個段落的所有小段
        result = updateWholeSegment(params);
        break;
      case 'deleteSegment':
        // 刪除段落
        result = deleteSegment(params.pipelineId, params.segmentNumber);
        break;
      case 'clearAllSegments':
        // 清空工程所有段落
        result = clearAllSegments(params.pipelineId);
        break;
      case 'getSegments':
        // 取得段落資料
        result = getSegments(params.pipelineId);
        break;
      case 'addSegment':
        // 新增段落
        result = addSegment(params);
        break;
      case 'addPipeline':
        // 新增工程
        result = addPipeline(params);
        break;
      case 'updatePipeline':
        // 更新工程名稱
        result = updatePipeline(params);
        break;
      case 'deletePipeline':
        // 刪除工程
        result = deletePipeline(params);
        break;
      case 'updateLinestring':
        // 更新工程的 LINESTRING (用於分支編輯)
        result = updateLinestring(params);
        break;
      case 'getMonthlyStats':
        // 取得每月完工統計
        result = getMonthlyStats(params.pipelineId, params.month);
        break;
      case 'generateMonthlyReport':
        // 產生所有工程的每月統計報表
        result = generateMonthlyReport(params.projectName);
        break;
      case 'getAllPipelinesMonthlyStats':
        // 取得所有工程的當月完工統計
        result = getAllPipelinesMonthlyStats();
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
    const pipelineSheet = ss.getSheetByName('工程清單');
    
    if (!pipelineSheet) {
      return { error: '找不到「工程清單」工作表' };
    }
    
    const data = pipelineSheet.getDataRange().getValues();
    const projectMap = {}; // 用來去重複
    
    // 從工程清單的 C 欄(計畫名稱)提取唯一計畫
    for (let i = 1; i < data.length; i++) {
      const projectName = String(data[i][2] || '').trim(); // C欄: 計畫名稱
      
      if (projectName && !projectMap[projectName]) {
        projectMap[projectName] = {
          name: projectName,
          area: '台中市' // 預設地區,可以之後擴充
        };
      }
    }
    
    // 轉為陣列
    const projects = Object.values(projectMap);
    
    Logger.log('✅ 從工程清單提取了 ' + projects.length + ' 個計畫');
    
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
    
    // 工程清單欄位結構: A=工程編號, B=工程名稱, C=計畫名稱, D=LINESTRING
    for (let i = 1; i < data.length; i++) {
      if (data[i][2] === projectName) {  // C欄 = 計畫名稱
        pipelines.push({
          id: data[i][0],           // A欄 = 工程編號
          name: data[i][1],         // B欄 = 工程名稱  
          projectName: data[i][2],  // C欄 = 計畫名稱
          linestring: data[i][3]    // D欄 = LINESTRING
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
      sheet.appendRow(['工程編號', '段落編號', '起始距離', '結束距離', '施工狀態', '管徑', '管種', '施工方式', '備註', '小段狀態']);
    }
    
    // 🆕 準備備註內容（包含 branchIndex）
    let notes = params.notes || '';
    if (params.branchIndex !== undefined && params.branchIndex !== null) {
      notes = 'branchIndex:' + params.branchIndex;
    }
    
    // 新增段落
    sheet.appendRow([
      params.pipelineId,
      params.segmentNumber,
      params.startDistance,
      params.endDistance,
      params.status || '未施工',
      params.diameter || '',
      params.pipeType || '',
      params.method || '',
      notes,  // 🆕 備註（含 branchIndex）
      ''      // 小段狀態
    ]);
    
    Logger.log('成功儲存段落：' + params.pipelineId + ' 段落 ' + params.segmentNumber + ' (branchIndex: ' + params.branchIndex + ')');
    
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
    const targetSegmentNumber = String(params.segmentNumber); // 🔧 改為字串（支援 B0-1 格式）
    
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
      const rowSegmentNumber = String(data[i][1]); // 🔧 改為字串
      
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

// 批次更新整個段落的所有小段（優化版本）
function updateWholeSegment(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const progressSheet = ss.getSheetByName('施工進度');
    
    if (!progressSheet) {
      return { success: false, error: '找不到「施工進度」工作表' };
    }
    
    const data = progressSheet.getDataRange().getValues();
    const targetPipelineId = String(params.pipelineId);
    const targetSegmentNumber = String(params.segmentNumber); // 🔧 改為字串
    const statusString = params.statusString; // 已經是逗號分隔的字串
    
    Logger.log('========== 批次更新整個段落 ==========');
    Logger.log('工程編號: ' + targetPipelineId);
    Logger.log('段落編號: ' + targetSegmentNumber);
    Logger.log('狀態字串: ' + statusString);
    
    // 找到要更新的行
    for (let i = 1; i < data.length; i++) {
      const rowPipelineId = String(data[i][0]);
      const rowSegmentNumber = String(data[i][1]); // 🔧 改為字串
      
      if (rowPipelineId === targetPipelineId && rowSegmentNumber === targetSegmentNumber) {
        Logger.log('✅ 找到符合的行 ' + (i + 1));
        
        // 直接寫入 J 欄
        progressSheet.getRange(i + 1, 10).setValue(statusString); // J 欄
        
        Logger.log('✅ 成功批次更新段落：' + targetPipelineId + ' 段落 ' + targetSegmentNumber);
        return { success: true, message: '段落已批次更新' };
      }
    }
    
    Logger.log('❌ 找不到符合的段落');
    return { 
      success: false, 
      error: '找不到對應的段落（工程: ' + targetPipelineId + ', 段落: ' + targetSegmentNumber + '）'
    };
    
  } catch (error) {
    Logger.log('❌ 發生錯誤: ' + error.toString());
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
        sheet.getRange(i + 1, 7).setValue(params.pipeType || '');  // G: 管種
        sheet.getRange(i + 1, 8).setValue(params.method || '');    // H: 施工方式
        
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

// ========== 配電盤/儀表箱功能 ==========

function getPanels(pipelineId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('配電盤標記');
    if (!sheet) return { panels: [] };
    
    const data = sheet.getDataRange().getValues();
    const panels = [];
    for (let i = 1; i < data.length; i++) {
      // 工作表結構: 標記ID, 經度, 緯度, 備註內容, 建立時間, 建立者, 照片, 工程ID
      if (data[i][0] && String(data[i][7]) === String(pipelineId)) {
        panels.push({
          id: data[i][0],         // A: 標記ID
          pipelineId: data[i][7], // H: 工程ID
          lng: data[i][1],        // B: 經度
          lat: data[i][2],        // C: 緯度
          text: data[i][3],       // D: 備註內容
          timestamp: data[i][4] || '', // E: 建立時間
          creator: data[i][5] || '',   // F: 建立者
          photo: data[i][6] || ''      // G: 照片（Google Drive 連結）
        });
      }
    }
    return { panels: panels };
  } catch (error) {
    return { error: error.toString() };
  }
}

function addPanel(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('配電盤標記');
    if (!sheet) {
      sheet = ss.insertSheet('配電盤標記');
      sheet.appendRow(['標記ID', '經度', '緯度', '備註內容', '建立時間', '建立者', '照片', '工程ID']);
    }
    
    const id = 'panel_' + new Date().getTime();
    const timestamp = new Date().toLocaleString('zh-TW', {timeZone: 'Asia/Taipei'});
    
    // 如果有照片（Base64），上傳到 Google Drive 並取得連結
    let photoUrl = '';
    if (params.photo && params.photo.startsWith('data:image')) {
      try {
        photoUrl = uploadPhotoToDrive(params.photo, id, 'Panels');
      } catch (error) {
        Logger.log('照片上傳失敗: ' + error.toString());
        // 照片上傳失敗不影響標記建立
      }
    }
    
    // 工作表結構: 標記ID, 經度, 緯度, 備註內容, 建立時間, 建立者, 照片, 工程ID
    sheet.appendRow([
      id,                      // A: 標記ID
      params.lng,              // B: 經度
      params.lat,              // C: 緯度
      params.text || '',       // D: 備註內容
      timestamp,               // E: 建立時間
      params.creator || '匿名', // F: 建立者
      photoUrl,                // G: 照片（Google Drive 連結）
      params.pipelineId        // H: 工程ID
    ]);
    return { success: true, panelId: id };
  } catch (error) {
    return { error: error.toString() };
  }
}

function updatePanel(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('配電盤標記');
    if (!sheet) return { error: '找不到配電盤標記工作表' };
    
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === params.panelId) {
        // D: 備註內容
        sheet.getRange(i+1, 4).setValue(params.text || '');
        
        // G: 照片
        if (params.photo !== undefined && params.photo.startsWith('data:image')) {
          try {
            const photoUrl = uploadPhotoToDrive(params.photo, params.panelId, 'Panels');
            sheet.getRange(i+1, 7).setValue(photoUrl);
          } catch (error) {
            Logger.log('照片上傳失敗: ' + error.toString());
          }
        }
        return { success: true };
      }
    }
    return { error: '找不到指定配電盤' };
  } catch (error) {
    return { error: error.toString() };
  }
}

function deletePanel(panelId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('配電盤標記');
    if (!sheet) return { error: '找不到配電盤標記工作表' };
    
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === panelId) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }
    return { error: '找不到指定配電盤' };
  } catch (error) {
    return { error: error.toString() };
  }
}

// 上傳照片到 Google Drive 的共用函數
function uploadPhotoToDrive(base64Data, recordId, folderType) {
  try {
    // 取得或建立照片資料夾
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const spreadsheetFolder = DriveApp.getFileById(ss.getId()).getParents().next();
    
    let photoFolder;
    const folderName = folderType + '_Photos';
    const folders = spreadsheetFolder.getFoldersByName(folderName);
    
    if (folders.hasNext()) {
      photoFolder = folders.next();
    } else {
      photoFolder = spreadsheetFolder.createFolder(folderName);
    }
    
    // 解析 Base64 資料
    const base64 = base64Data.split(',')[1];
    const mimeType = base64Data.match(/data:([^;]+);/)[1];
    const extension = mimeType.split('/')[1];
    
    // 建立檔案
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), mimeType, recordId + '.' + extension);
    const file = photoFolder.createFile(blob);
    
    // 設定為任何人都可查看
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    // 取得檔案 ID 並組成可嵌入的連結
    const fileId = file.getId();
    const embedUrl = 'https://drive.google.com/uc?export=view&id=' + fileId;
    
    Logger.log('照片已上傳: ' + embedUrl);
    
    // 回傳可嵌入的連結
    return embedUrl;
  } catch (error) {
    Logger.log('照片上傳失敗: ' + error.toString());
    throw error;
  }
}

// 更新管線路徑 (LINESTRING) 並清空段落資料
function updateLinestring(pipelineId, newLinestring) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const pipelineSheet = ss.getSheetByName('工程清單');
    
    if (!pipelineSheet) {
      return { success: false, error: '找不到「工程清單」工作表' };
    }
    
    // 找到對應工程的列
    const data = pipelineSheet.getDataRange().getValues();
    let targetRow = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === pipelineId) {
        targetRow = i + 1; // Sheets 從 1 開始
        break;
      }
    }
    
    if (targetRow === -1) {
      return { success: false, error: '找不到工程 ID: ' + pipelineId };
    }
    
    // 更新 LINESTRING (假設在 D 欄，索引 4)
    pipelineSheet.getRange(targetRow, 4).setValue(newLinestring);
    
    Logger.log('✅ 已更新工程 ' + pipelineId + ' 的路徑');
    Logger.log('新 LINESTRING: ' + newLinestring);
    
    // 清空該工程的所有段落資料
    let deletedCount = 0;
    const progressSheet = ss.getSheetByName('施工進度');
    
    if (progressSheet) {
      const progressData = progressSheet.getDataRange().getValues();
      const rowsToDelete = [];
      
      // 從後往前找，收集要刪除的列號
      for (let i = progressData.length - 1; i >= 1; i--) {
        if (progressData[i][0] === pipelineId) {
          rowsToDelete.push(i + 1); // Sheets 從 1 開始
        }
      }
      
      // 刪除所有找到的列
      rowsToDelete.forEach(row => {
        progressSheet.deleteRow(row);
      });
      
      deletedCount = rowsToDelete.length;
      Logger.log('🗑️ 已清空 ' + deletedCount + ' 筆段落資料');
    }
    
    return { 
      success: true, 
      message: '路徑已成功更新，段落資料已清空',
      pipelineId: pipelineId,
      linestring: newLinestring,
      deletedSegments: deletedCount
    };
    
  } catch (error) {
    Logger.log('❌ 更新 LINESTRING 失敗: ' + error.toString());
    return { 
      success: false, 
      error: error.toString() 
    };
  }
}


// ============================================
// 📋 段落管理功能
// ============================================

// 取得段落資料
function getSegments(pipelineId) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var progressSheet = ss.getSheetByName('施工進度');
    
    if (!progressSheet) {
      return { success: false, error: '找不到「施工進度」工作表' };
    }
    
    var data = progressSheet.getDataRange().getValues();
    var segments = [];
    
    for (var i = 1; i < data.length; i++) {
      var rowPipelineId = String(data[i][0]);
      
      if (rowPipelineId === pipelineId) {
        segments.push({
          segmentNumber: data[i][1],
          startDistance: data[i][2],
          endDistance: data[i][3],
          status: data[i][4] || '',
          diameter: data[i][5] || '',
          pipeType: data[i][6] || '',
          method: data[i][7] || '',
          notes: data[i][8] || '',
          smallSegments: data[i][9] || ''
        });
      }
    }
    
    return {
      success: true,
      segments: segments
    };
    
  } catch (error) {
    Logger.log('getSegments Error: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

// 新增段落
function addSegment(params) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var progressSheet = ss.getSheetByName('施工進度');
    
    if (!progressSheet) {
      return { success: false, error: '找不到「施工進度」工作表' };
    }
    
    // 🆕 計算需要多少個小段（每 10m 一段）
    var segmentLength = Number(params.endDistance) - Number(params.startDistance);
    var numSmallSegments = Math.ceil(segmentLength / 10);
    
    // 🆕 建立小段狀態字串（全部填 0）
    var smallSegmentsArray = [];
    for (var i = 0; i < numSmallSegments; i++) {
      smallSegmentsArray.push('0');
    }
    var smallSegmentsStr = smallSegmentsArray.join(',');
    
    Logger.log('段落長度: ' + segmentLength + 'm');
    Logger.log('需要小段數: ' + numSmallSegments);
    Logger.log('初始小段狀態: ' + smallSegmentsStr);
    
    // 新增一行
    var newRow = [
      params.pipelineId,
      params.segmentNumber,
      params.startDistance,
      params.endDistance,
      '未施工', // 狀態
      params.diameter || '',
      params.pipeType || '',
      params.method || '',
      params.notes || '',
      smallSegmentsStr // 🆕 自動填充小段狀態
    ];
    
    progressSheet.appendRow(newRow);
    
    Logger.log('成功新增段落：' + params.pipelineId + ' 段落 ' + params.segmentNumber);
    return { success: true, message: '段落已新增' };
    
  } catch (error) {
    Logger.log('addSegment Error: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

// ============================================
// 📊 統計功能 (v6.0 新增)
// ============================================

// 取得單一工程的每月完工統計
function getMonthlyStats(pipelineId, month) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var progressSheet = ss.getSheetByName('施工進度');
    
    if (!progressSheet) {
      return { success: false, error: '找不到「施工進度」工作表' };
    }
    
    var data = progressSheet.getDataRange().getValues();
    
    if (!month) {
      var today = new Date();
      var year = today.getFullYear();
      var monthNum = String(today.getMonth() + 1);
      if (monthNum.length === 1) monthNum = '0' + monthNum;
      month = year + '-' + monthNum;
    }
    
    var totalCompleted = 0;
    var methodStats = {};
    
    for (var i = 1; i < data.length; i++) {
      var rowPipelineId = String(data[i][0]);
      
      if (rowPipelineId === pipelineId) {
        var method = data[i][7] || '未設定';
        var smallSegments = data[i][9] || '';
        
        if (!smallSegments) continue;
        
        var statusArray = String(smallSegments).split(',');
        for (var j = 0; j < statusArray.length; j++) {
          var status = statusArray[j].trim();
          if (status && status.indexOf('-') !== -1 && status.indexOf(month) === 0) {
            totalCompleted += 10;
            if (!methodStats[method]) methodStats[method] = 0;
            methodStats[method] += 10;
          }
        }
      }
    }
    
    return {
      success: true,
      pipelineId: pipelineId,
      month: month,
      totalCompleted: totalCompleted,
      methodStats: methodStats
    };
    
  } catch (error) {
    Logger.log('getMonthlyStats Error: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

// 產生所有工程的每月統計報表
function generateMonthlyReport(projectName) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var pipelineSheet = ss.getSheetByName('工程清單');
    var progressSheet = ss.getSheetByName('施工進度');
    
    if (!pipelineSheet || !progressSheet) {
      return { success: false, error: '找不到必要的工作表' };
    }
    
    var pipelineData = pipelineSheet.getDataRange().getValues();
    var progressData = progressSheet.getDataRange().getValues();
    
    var pipelines = [];
    Logger.log('generateMonthlyReport - 計畫名稱: ' + projectName);
    for (var i = 1; i < pipelineData.length; i++) {
      var rowProjectName = pipelineData[i][2];
      Logger.log('第 ' + i + ' 行計畫: ' + rowProjectName);
      // 同時檢查 B欄計畫名稱 和可能的其他欄位
      var rowPipelineName = pipelineData[i][2]; // C欄工程名稱
      var match = !projectName || 
                  rowProjectName === projectName || 
                  rowProjectName.indexOf(projectName) >= 0 ||
                  projectName.indexOf(rowProjectName) >= 0;
      if (match) {
        pipelines.push({
          id: String(pipelineData[i][0]),
          project: pipelineData[i][2],
          name: pipelineData[i][1]
        });
      }
    }
    
    var monthsSet = {};
    for (var i = 1; i < progressData.length; i++) {
      var smallSegments = progressData[i][9] || '';
      if (!smallSegments) continue;
      
      var statusArray = String(smallSegments).split(',');
      for (var j = 0; j < statusArray.length; j++) {
        var status = statusArray[j].trim();
        if (status && status.indexOf('-') !== -1 && status.length >= 7) {
          var month = status.substring(0, 7);
          monthsSet[month] = true;
        }
      }
    }
    
    var months = Object.keys(monthsSet).sort();
    
    var report = [];
    for (var p = 0; p < pipelines.length; p++) {
      var pipeline = pipelines[p];
      var row = {
        pipelineId: pipeline.id,
        project: pipeline.project,
        name: pipeline.name,
        monthly: {}
      };
      
      for (var m = 0; m < months.length; m++) {
        var month = months[m];
        var monthlyLength = 0;
        
        for (var i = 1; i < progressData.length; i++) {
          var rowPipelineId = String(progressData[i][0]);
          
          if (rowPipelineId === pipeline.id) {
            var smallSegments = progressData[i][9] || '';
            if (!smallSegments) continue;
            
            var statusArray = String(smallSegments).split(',');
            for (var j = 0; j < statusArray.length; j++) {
              var status = statusArray[j].trim();
              if (status && status.indexOf(month) === 0) {
                monthlyLength += 10;
              }
            }
          }
        }
        
        row.monthly[month] = monthlyLength;
      }
      
      report.push(row);
    }
    
    return {
      success: true,
      months: months,
      pipelines: report
    };
    
  } catch (error) {
    Logger.log('generateMonthlyReport Error: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

// 取得所有工程的當月完工統計
function getAllPipelinesMonthlyStats() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var pipelineSheet = ss.getSheetByName('工程清單');
    var progressSheet = ss.getSheetByName('施工進度');
    
    if (!pipelineSheet || !progressSheet) {
      return { success: false, error: '找不到必要的工作表' };
    }
    
    var today = new Date();
    var year = today.getFullYear();
    var monthNum = String(today.getMonth() + 1);
    if (monthNum.length === 1) monthNum = '0' + monthNum;
    var currentMonth = year + '-' + monthNum;
    
    var pipelineData = pipelineSheet.getDataRange().getValues();
    var progressData = progressSheet.getDataRange().getValues();
    
    var stats = [];
    
    for (var i = 1; i < pipelineData.length; i++) {
      var pipelineId = String(pipelineData[i][0]);
      var projectName = pipelineData[i][1];
      var pipelineName = pipelineData[i][2];
      
      var monthlyCompleted = 0;
      
      for (var j = 1; j < progressData.length; j++) {
        var rowPipelineId = String(progressData[j][0]);
        
        if (rowPipelineId === pipelineId) {
          var smallSegments = progressData[j][9] || '';
          if (!smallSegments) continue;
          
          var statusArray = String(smallSegments).split(',');
          for (var k = 0; k < statusArray.length; k++) {
            var status = statusArray[k].trim();
            if (status && status.indexOf(currentMonth) === 0) {
              monthlyCompleted += 10;
            }
          }
        }
      }
      
      stats.push({
        pipelineId: pipelineId,
        project: projectName,
        name: pipelineName,
        monthlyCompleted: monthlyCompleted
      });
    }
    
    return {
      success: true,
      month: currentMonth,
      stats: stats
    };
    
  } catch (error) {
    Logger.log('getAllPipelinesMonthlyStats Error: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

// ==================== 新增工程 ====================
function addPipeline(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const pipelineListSheet = ss.getSheetByName('工程清單');
    
    if (!pipelineListSheet) {
      return { success: false, error: '找不到「工程清單」工作表' };
    }
    
    const projectName = String(params.projectName || '').trim();
    const pipelineName = String(params.pipelineName || '').trim();
    const linestring = String(params.linestring || '');
    const customPipelineId = String(params.customPipelineId || '').trim();
    
    // 驗證必填欄位
    if (!projectName) {
      return { success: false, error: '計畫名稱不可為空' };
    }
    if (!pipelineName) {
      return { success: false, error: '工程名稱不可為空' };
    }
    if (!linestring) {
      return { success: false, error: 'LINESTRING 不可為空' };
    }
    
    // 決定工程ID
    let pipelineId;
    if (customPipelineId) {
      // 使用自訂編號
      pipelineId = customPipelineId;
      
      // 檢查編號是否已存在
      const existingData = pipelineListSheet.getDataRange().getValues();
      for (let i = 1; i < existingData.length; i++) {
        if (String(existingData[i][0]).trim() === pipelineId) {
          return { success: false, error: '工程編號已存在: ' + pipelineId };
        }
      }
    } else {
      // 自動生成 (格式: BT + 時間戳)
      const timestamp = new Date().getTime().toString().slice(-8);
      pipelineId = 'BT' + timestamp;
    }
    
    // 新增工程到工程清單
    // 欄位順序: A=工程編號, B=工程名稱, C=計畫名稱, D=LINESTRING
    pipelineListSheet.appendRow([
      pipelineId,       // A欄: 工程編號
      pipelineName,     // B欄: 工程名稱
      projectName,      // C欄: 計畫名稱
      linestring        // D欄: LINESTRING
    ]);
    
    Logger.log('✅ 新增工程: ' + pipelineName + ' (ID: ' + pipelineId + ', 計畫: ' + projectName + ')');
    
    return {
      success: true,
      message: '新增成功',
      pipelineId: pipelineId,
      projectName: projectName,
      pipelineName: pipelineName
    };
    
  } catch (error) {
    Logger.log('addPipeline Error: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

// ==================== 更新 LINESTRING (編輯路徑) ====================
function updateLinestring(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const pipelineListSheet = ss.getSheetByName('工程清單');
    
    if (!pipelineListSheet) {
      return { success: false, error: '找不到「工程清單」工作表' };
    }
    
    const pipelineId = String(params.pipelineId || '').trim();
    const newLinestring = String(params.linestring || '');
    
    // 驗證參數
    if (!pipelineId) {
      return { success: false, error: '工程編號不可為空' };
    }
    
    // 驗證 LINESTRING 格式
    if (!newLinestring || (!newLinestring.includes('LINESTRING') && !newLinestring.includes('MULTILINESTRING'))) {
      return { success: false, error: '無效的 LINESTRING 格式' };
    }
    
    // 讀取所有資料
    const data = pipelineListSheet.getDataRange().getValues();
    
    // 尋找對應的工程 (只用 A欄的工程編號)
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      const rowPipelineId = String(data[i][0]).trim(); // A欄: 工程編號
      
      if (rowPipelineId === pipelineId) {
        foundRow = i + 1; // +1 因為 sheet 行號從 1 開始
        break;
      }
    }
    
    if (foundRow === -1) {
      return { success: false, error: '找不到工程編號: ' + pipelineId };
    }
    
    // 更新 D欄 (LINESTRING)
    pipelineListSheet.getRange(foundRow, 4).setValue(newLinestring);
    
    Logger.log('✅ 更新 LINESTRING: ' + pipelineId);
    
    return {
      success: true,
      message: '更新成功',
      pipelineId: pipelineId
    };
    
  } catch (error) {
    Logger.log('updateLinestring Error: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

// ==================== 更新工程資料 ====================
function updatePipeline(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const pipelineListSheet = ss.getSheetByName('工程清單');
    const progressSheet = ss.getSheetByName('施工進度');
    const mapNotesSheet = ss.getSheetByName('地圖備註');
    const shaftsSheet = ss.getSheetByName('工作井');
    const panelsSheet = ss.getSheetByName('配電盤');
    const permitZonesSheet = ss.getSheetByName('路權範圍');
    const ganttSheet = ss.getSheetByName('甘特圖');
    const milestoneSheet = ss.getSheetByName('施工計畫');
    
    if (!pipelineListSheet) {
      return { success: false, error: '找不到「工程清單」工作表' };
    }
    
    const oldPipelineId = String(params.oldPipelineId || params.pipelineId || '').trim();
    const newPipelineId = String(params.newPipelineId || '').trim();
    const newName = String(params.name || '').trim();
    const newProjectName = String(params.projectName || '').trim();
    
    // 驗證參數
    if (!oldPipelineId) {
      return { success: false, error: '原工程編號不可為空' };
    }
    
    if (!newPipelineId) {
      return { success: false, error: '新工程編號不可為空' };
    }
    
    if (!newName) {
      return { success: false, error: '工程名稱不可為空' };
    }
    
    if (!newProjectName) {
      return { success: false, error: '計畫名稱不可為空' };
    }
    
    // 如果更改工程編號,檢查新編號是否已存在
    if (oldPipelineId !== newPipelineId) {
      const allData = pipelineListSheet.getDataRange().getValues();
      for (let i = 1; i < allData.length; i++) {
        if (String(allData[i][0]).trim() === newPipelineId) {
          return { success: false, error: '工程編號已存在: ' + newPipelineId };
        }
      }
    }
    
    // 讀取所有資料
    const data = pipelineListSheet.getDataRange().getValues();
    
    // 尋找對應的工程 (用舊編號搜尋)
    let foundRow = -1;
    for (let i = 1; i < data.length; i++) {
      const rowPipelineId = String(data[i][0]).trim(); // A欄: 工程編號
      
      if (rowPipelineId === oldPipelineId) {
        foundRow = i + 1; // +1 因為 sheet 行號從 1 開始
        break;
      }
    }
    
    if (foundRow === -1) {
      return { success: false, error: '找不到工程編號: ' + oldPipelineId };
    }
    
    // 更新工程清單 (A=編號, B=名稱, C=計畫)
    pipelineListSheet.getRange(foundRow, 1).setValue(newPipelineId);  // A欄: 工程編號
    pipelineListSheet.getRange(foundRow, 2).setValue(newName);        // B欄: 工程名稱
    pipelineListSheet.getRange(foundRow, 3).setValue(newProjectName); // C欄: 計畫名稱
    
    // 如果工程編號有變更,需要更新其他工作表的 pipelineId
    if (oldPipelineId !== newPipelineId) {
      Logger.log('🔄 工程編號已變更,更新相關資料: ' + oldPipelineId + ' -> ' + newPipelineId);
      
      // 更新施工進度
      if (progressSheet) {
        updateSheetPipelineId(progressSheet, oldPipelineId, newPipelineId, 0); // A欄
      }
      
      // 更新地圖備註
      if (mapNotesSheet) {
        updateSheetPipelineId(mapNotesSheet, oldPipelineId, newPipelineId, 5); // F欄
      }
      
      // 更新工作井
      if (shaftsSheet) {
        updateSheetPipelineId(shaftsSheet, oldPipelineId, newPipelineId, 1); // B欄
      }
      
      // 更新配電盤
      if (panelsSheet) {
        updateSheetPipelineId(panelsSheet, oldPipelineId, newPipelineId, 1); // B欄
      }
      
      // 更新路權範圍
      if (permitZonesSheet) {
        updateSheetPipelineId(permitZonesSheet, oldPipelineId, newPipelineId, 1); // B欄
      }
      
      // 更新甘特圖
      if (ganttSheet) {
        updateSheetPipelineId(ganttSheet, oldPipelineId, newPipelineId, 1); // B欄
      }
      
      // 更新施工計畫
      if (milestoneSheet) {
        updateSheetPipelineId(milestoneSheet, oldPipelineId, newPipelineId, 1); // B欄
      }
    }
    
    Logger.log('✅ 更新工程: ' + newPipelineId + ' (' + newName + ', 計畫: ' + newProjectName + ')');
    
    return {
      success: true,
      message: '更新成功',
      pipelineId: newPipelineId,
      name: newName,
      projectName: newProjectName
    };
    
  } catch (error) {
    Logger.log('updatePipeline Error: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}

// 輔助函數: 更新工作表中的 pipelineId
function updateSheetPipelineId(sheet, oldId, newId, columnIndex) {
  const data = sheet.getDataRange().getValues();
  let updateCount = 0;
  
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][columnIndex]).trim() === oldId) {
      sheet.getRange(i + 1, columnIndex + 1).setValue(newId);
      updateCount++;
    }
  }
  
  if (updateCount > 0) {
    Logger.log('   ✅ ' + sheet.getName() + ': 更新了 ' + updateCount + ' 筆資料');
  }
}

// ==================== 刪除工程 ====================
function deletePipeline(params) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const pipelineListSheet = ss.getSheetByName('工程清單');
    const progressSheet = ss.getSheetByName('施工進度');
    const mapNotesSheet = ss.getSheetByName('地圖備註');
    const shaftsSheet = ss.getSheetByName('工作井');
    const panelsSheet = ss.getSheetByName('配電盤');
    const permitZonesSheet = ss.getSheetByName('路權範圍');
    
    if (!pipelineListSheet) {
      return { success: false, error: '找不到「工程清單」工作表' };
    }
    
    const pipelineId = String(params.pipelineId || '').trim();
    
    // 驗證參數
    if (!pipelineId) {
      return { success: false, error: '工程編號不可為空' };
    }
    
    // 1. 從「工程清單」中刪除
    const pipelineData = pipelineListSheet.getDataRange().getValues();
    let pipelineRow = -1;
    
    for (let i = 1; i < pipelineData.length; i++) {
      if (String(pipelineData[i][0]).trim() === pipelineId) {
        pipelineRow = i + 1;
        break;
      }
    }
    
    if (pipelineRow === -1) {
      return { success: false, error: '找不到工程編號: ' + pipelineId };
    }
    
    pipelineListSheet.deleteRow(pipelineRow);
    Logger.log('✅ 已從工程清單刪除: ' + pipelineId);
    
    // 2. 從「施工進度」中刪除相關段落
    if (progressSheet) {
      const progressData = progressSheet.getDataRange().getValues();
      const rowsToDelete = [];
      
      for (let i = progressData.length - 1; i >= 1; i--) {
        if (String(progressData[i][0]).trim() === pipelineId) {
          rowsToDelete.push(i + 1);
        }
      }
      
      rowsToDelete.forEach(row => progressSheet.deleteRow(row));
      Logger.log('✅ 已刪除 ' + rowsToDelete.length + ' 個施工進度段落');
    }
    
    // 3. 從「地圖備註」中刪除相關備註
    if (mapNotesSheet) {
      const notesData = mapNotesSheet.getDataRange().getValues();
      const rowsToDelete = [];
      
      for (let i = notesData.length - 1; i >= 1; i--) {
        if (String(notesData[i][5]).trim() === pipelineId) { // F欄是 pipelineId
          rowsToDelete.push(i + 1);
        }
      }
      
      rowsToDelete.forEach(row => mapNotesSheet.deleteRow(row));
      Logger.log('✅ 已刪除 ' + rowsToDelete.length + ' 個地圖備註');
    }
    
    // 4. 從「工作井」中刪除相關資料
    if (shaftsSheet) {
      const shaftsData = shaftsSheet.getDataRange().getValues();
      const rowsToDelete = [];
      
      for (let i = shaftsData.length - 1; i >= 1; i--) {
        if (String(shaftsData[i][1]).trim() === pipelineId) { // B欄是 pipelineId
          rowsToDelete.push(i + 1);
        }
      }
      
      rowsToDelete.forEach(row => shaftsSheet.deleteRow(row));
      Logger.log('✅ 已刪除 ' + rowsToDelete.length + ' 個工作井');
    }
    
    // 5. 從「配電盤」中刪除相關資料
    if (panelsSheet) {
      const panelsData = panelsSheet.getDataRange().getValues();
      const rowsToDelete = [];
      
      for (let i = panelsData.length - 1; i >= 1; i--) {
        if (String(panelsData[i][1]).trim() === pipelineId) { // B欄是 pipelineId
          rowsToDelete.push(i + 1);
        }
      }
      
      rowsToDelete.forEach(row => panelsSheet.deleteRow(row));
      Logger.log('✅ 已刪除 ' + rowsToDelete.length + ' 個配電盤');
    }
    
    // 6. 從「路權範圍」中刪除相關資料
    if (permitZonesSheet) {
      const zonesData = permitZonesSheet.getDataRange().getValues();
      const rowsToDelete = [];
      
      for (let i = zonesData.length - 1; i >= 1; i--) {
        if (String(zonesData[i][1]).trim() === pipelineId) { // B欄是 pipelineId
          rowsToDelete.push(i + 1);
        }
      }
      
      rowsToDelete.forEach(row => permitZonesSheet.deleteRow(row));
      Logger.log('✅ 已刪除 ' + rowsToDelete.length + ' 個路權範圍');
    }
    
    return {
      success: true,
      message: '工程及所有相關資料已刪除',
      pipelineId: pipelineId
    };
    
  } catch (error) {
    Logger.log('deletePipeline Error: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}
