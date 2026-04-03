// ==================== 工具抽屜功能 ====================

// 🔐 工具權限控制 - 使用 Google 帳號角色
// 只有管理員 (role = 'admin') 可以使用工具

// 切換工具抽屜
function toggleToolsDrawer() {
    const drawer = document.getElementById('toolsDrawer');
    const loginItem = document.getElementById('loginToolItem');
    const toolsContainer = document.getElementById('toolsContainer');
    
    // 如果抽屜已開啟，直接關閉
    if (drawer.classList.contains('active')) {
        drawer.classList.remove('active');
        return;
    }
    
    // 檢查是否登入
    if (!currentUser) {
        // 未登入，只顯示登入選項
        loginItem.style.display = 'flex';
        toolsContainer.style.display = 'none';
        drawer.classList.add('active');
        return;
    }
    
    // 已登入，隱藏登入選項，顯示工具
    loginItem.style.display = 'none';
    toolsContainer.style.display = 'block';
    
    // 檢查監造單位以上權限
    if (getRoleLevel(currentUser.role) < 2) {
        showToast('此功能需要「監造單位」以上權限（目前：' + currentUser.role + '）', 'warning');
        return;
    }
    
    // 管理員權限驗證通過，展開抽屜
    drawer.classList.add('active');
}

// 選擇工具
function selectTool(tool) {
    // 關閉抽屜
    document.getElementById('toolsDrawer').classList.remove('active');
    
    // 執行對應功能
    switch(tool) {
        case 'edit':
            if (!isEditingPath) {
                toggleEditMode();
            }
            break;
        case 'branch':
            toggleBranchEditMode();
            break;
        case 'segment':
            toggleSegmentPanel();
            break;
        case 'gantt':
            toggleGanttPanel();
            break;
        case 'editPipeline':
            // 編輯工程
            if (!currentPipeline) {
                showToast('請先選擇一個工程', 'warning');
                return;
            }
            editPipelineFromTool();
            break;
    }
}

// ==================== 編輯工程功能 ====================

// 從工具抽屜呼叫(使用當前工程)
async function editPipelineFromTool() {
    if (!currentPipeline) {
        showToast('請先選擇一個工程', 'warning');
        return;
    }
    await editPipeline(currentPipeline);
}

// 從工具抽屜呼叫(使用當前工程)

// 通用編輯工程函數
async function editPipeline(pipeline) {
    // 🔐 權限檢查 - 管理員可以編輯工程
    if (!requireAdmin()) {
        return;
    }
    
    // 建立遮罩層
    const overlay = document.createElement('div');
    overlay.id = 'editPipelineOverlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 9999;
    `;
    overlay.onclick = closeEditPipelineForm;
    
    const formDiv = document.createElement('div');
    formDiv.id = 'editPipelineForm';
    formDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 24px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        z-index: 10000;
        width: 450px;
        max-height: 80vh;
        overflow-y: auto;
    `;
    formDiv.onclick = (e) => e.stopPropagation();
    
    // 建立計畫下拉選單選項
    const projects = allProjects || [];
    const projectOptions = projects.map(p => 
        `<option value="${p.name}" ${p.name === pipeline.projectName ? 'selected' : ''}>${p.name}</option>`
    ).join('');
    
    formDiv.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
            <h3 style="margin:0;color:#333;font-size:20px;">✏️ 編輯工程</h3>
            <button onclick="closeEditPipelineForm()" style="background:#f5f5f5;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:16px;">✕</button>
        </div>
        
        <div style="margin-bottom:16px;">
            <label style="display:block;margin-bottom:6px;font-weight:600;color:#555;font-size:14px;">📋 計畫名稱</label>
            <select id="editPipelineProjectName" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:white;cursor:pointer;">
                ${projectOptions}
            </select>
        </div>
        
        <div style="margin-bottom:16px;">
            <label style="display:block;margin-bottom:6px;font-weight:600;color:#555;font-size:14px;">🔢 工程編號</label>
            <input type="text" id="editPipelineId" value="${pipeline.id}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
            <div style="font-size:11px;color:#999;margin-top:4px;">⚠️ 修改編號後,相關資料的工程ID也會更新</div>
        </div>
        
        <div style="margin-bottom:16px;">
            <label style="display:block;margin-bottom:6px;font-weight:600;color:#555;font-size:14px;">🏗️ 工程名稱</label>
            <input type="text" id="editPipelineName" value="${pipeline.name}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
        </div>
        
        <div style="background:#fff3cd;padding:12px;border-radius:8px;margin-bottom:20px;font-size:12px;color:#856404;line-height:1.6;">
            ⚠️ 修改後會立即更新 Google Sheets<br>
            請確認資料正確後再儲存
        </div>
        
        <div style="display:flex;gap:10px;margin-bottom:12px;">
            <button onclick="submitEditPipeline('${pipeline.id}')" style="flex:1;padding:14px;background:#2196F3;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:15px;">
                💾 儲存變更
            </button>
            <button onclick="closeEditPipelineForm()" style="padding:14px 20px;background:#f5f5f5;border:none;border-radius:8px;cursor:pointer;font-size:14px;">
                取消
            </button>
        </div>
        
        <button onclick="confirmDeletePipeline('${pipeline.id}', '${pipeline.name.replace(/'/g, "\\'")}')" style="width:100%;padding:12px;background:#f44336;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:14px;margin-top:8px;">
            🗑️ 刪除此工程
        </button>
    `;
    
    document.body.appendChild(overlay);
    document.body.appendChild(formDiv);
}

// 確認刪除工程(從編輯表單內呼叫)
window.confirmDeletePipeline = async function(pipelineId, pipelineName) {
    if (!requireAdmin()) return;
    const confirmMsg = `⚠️ 警告：即將刪除工程

工程名稱：${pipelineName}
工程編號：${pipelineId}

⚠️ 此操作將會：
• 刪除工程的路徑資料
• 刪除所有施工進度段落
• 刪除所有地圖備註
• 刪除所有工作井、配電盤、路權範圍

此操作無法復原！

確定要刪除嗎？`;

    if (!await showConfirm({ title: '確認刪除工程', message: confirmMsg, okText: '確認刪除', danger: true, icon: '🗑️' })) {
        return;
    }
    
    // 二次確認
    const typedName = prompt(`請輸入工程名稱「${pipelineName}」以確認刪除:`);
    if (typedName !== pipelineName) {
        showToast('名稱不符，已取消刪除', 'error');
        return;
    }
    
    try {
        const response = await fetch(API_URL + 
            '?action=deletePipeline' +
            '&pipelineId=' + encodeURIComponent(pipelineId));
        const result = await response.json();
        
        if (result.success) {
            showToast('工程已刪除', 'success');
            closeEditPipelineForm();
            
            // 重新載入工程資料
            await loadPipelines();
            
            // 返回計畫頁面
            if (currentProject) {
                showProjectPipelines(currentProject.name);
            }
        } else {
            showToast('刪除失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        console.error('刪除工程錯誤:', error);
        showToast('發生錯誤：' + error.message, 'error');
    }
};

// 選擇計畫(編輯工程用)

// 關閉編輯工程表單
window.closeEditPipelineForm = function() {
    const overlay = document.getElementById('editPipelineOverlay');
    const form = document.getElementById('editPipelineForm');
    if (overlay) overlay.remove();
    if (form) form.remove();
};

// 提交編輯工程
window.submitEditPipeline = async function(oldPipelineId) {
    if (!requireAdmin()) return;
    const newProjectName = document.getElementById('editPipelineProjectName').value.trim();
    const newPipelineId = document.getElementById('editPipelineId').value.trim();
    const newPipelineName = document.getElementById('editPipelineName').value.trim();
    
    if (!newProjectName || !newPipelineId || !newPipelineName) {
        showToast('所有欄位都必須填寫', 'error');
        return;
    }
    
    if (!await showConfirm({ title: '儲存工程變更', message: `計畫：${newProjectName}\n編號：${newPipelineId}\n名稱：${newPipelineName}`, okText: '儲存', icon: '💾' })) {
        return;
    }
    
    try {
        const response = await fetch(API_URL + 
            '?action=updatePipeline' +
            '&oldPipelineId=' + encodeURIComponent(oldPipelineId) +
            '&newPipelineId=' + encodeURIComponent(newPipelineId) +
            '&projectName=' + encodeURIComponent(newProjectName) +
            '&name=' + encodeURIComponent(newPipelineName));
        const result = await response.json();
        
        if (result.success) {
            showToast('工程資料已更新', 'success');
            closeEditPipelineForm();
            
            // 重新載入工程資料
            await loadPipelines();
            
            // 重新顯示計畫工程列表
            if (currentProject) {
                showProjectPipelines(currentProject.name);
            }
        } else {
            showToast('更新失敗：' + (result.error || '未知錯誤'), 'error');
        }
    } catch (error) {
        console.error('編輯工程錯誤:', error);
        showToast('發生錯誤：' + error.message, 'error');
    }
};

// 點擊地圖其他地方時關閉圖層面板
document.addEventListener('click', function(e) {
    const panel = document.getElementById('layerPanel');
    const btn   = document.getElementById('layerSwitchButton');
    if (panel && btn &&
        panel.classList.contains('show') &&
        !panel.contains(e.target) &&
        !btn.contains(e.target)) {
        panel.classList.remove('show');
        btn.classList.remove('active');
    }
});

// 點擊地圖其他地方時關閉抽屜
document.addEventListener('click', function(e) {
    const drawer = document.getElementById('toolsDrawer');
    const toggle = document.getElementById('toolsDrawerToggle');
    
    if (drawer && toggle && 
        !drawer.contains(e.target) && 
        !toggle.contains(e.target) &&
        drawer.classList.contains('active')) {
        drawer.classList.remove('active');
    }
});

// ==================== 新增工程功能 ====================

// 帶密碼驗證的新增工程表單
async function showAddPipelineFormWithAuth() {
    // 🔐 權限檢查 - 管理員可以新增工程
    if (!requireAdmin()) {
return;
    }
    
    // 顯示新增工程表單
    showAddPipelineForm();
}

async function showAddPipelineForm() {
    showAddPipelineFormForProject(null);
}

// 新增工程表單(可帶入計畫名稱)
async function showAddPipelineFormForProject(projectName = null) {
    // 使用已載入的計畫列表
    const projects = allProjects || [];
    console.log('📋 載入的計畫:', projects);
    
    // 取得地圖中心座標
    const center = map ? map.getCenter() : { lat: 24.1477, lng: 120.6736 };
    
    // 建立遮罩層
    const overlay = document.createElement('div');
    overlay.id = 'addPipelineOverlay';
    overlay.style.cssText = `
position: fixed;
top: 0;
left: 0;
right: 0;
bottom: 0;
background: rgba(0,0,0,0.5);
z-index: 9999;
    `;
    overlay.onclick = closeAddPipelineForm;
    
    const formDiv = document.createElement('div');
    formDiv.id = 'addPipelineForm';
    formDiv.style.cssText = `
position: fixed;
top: 50%;
left: 50%;
transform: translate(-50%, -50%);
background: white;
padding: 24px;
border-radius: 12px;
box-shadow: 0 8px 32px rgba(0,0,0,0.2);
z-index: 10000;
width: 450px;
max-height: 80vh;
overflow-y: auto;
    `;
    formDiv.onclick = (e) => e.stopPropagation();
    
    // 建立計畫下拉選單選項
    const projectOptions = projects.map(p => 
`<option value="${p.name}" ${projectName && p.name === projectName ? 'selected' : ''}>${p.name}</option>`
    ).join('');
    
    // 如果沒有帶入計畫名稱,加入預設選項
    const defaultOption = projectName ? '' : '<option value="" disabled selected>請選擇計畫</option>';
    
    formDiv.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
    <h3 style="margin:0;color:#333;font-size:20px;">➕ 新增工程</h3>
    <button onclick="closeAddPipelineForm()" style="background:#f5f5f5;border:none;padding:8px 12px;border-radius:6px;cursor:pointer;font-size:16px;">✕</button>
</div>

<div style="margin-bottom:16px;">
    <label style="display:block;margin-bottom:6px;font-weight:600;color:#555;font-size:14px;">📋 計畫名稱</label>
    <select id="addPipelineProjectSelect" onchange="handleProjectSelectChange()" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;background:white;cursor:pointer;">
        ${defaultOption}
        ${projectOptions}
        <option value="__NEW__">➕ 新增計畫...</option>
    </select>
    <input type="text" id="addPipelineProjectName" placeholder="請輸入新計畫名稱" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;margin-top:8px;display:none;">
</div>

<div style="margin-bottom:16px;">
    <label style="display:block;margin-bottom:6px;font-weight:600;color:#555;font-size:14px;">🔢 工程編號</label>
    <input type="text" id="addPipelineId" placeholder="例如: BU11040112" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
    <div style="font-size:11px;color:#999;margin-top:4px;">⚠️ 必填</div>
</div>

<div style="margin-bottom:16px;">
    <label style="display:block;margin-bottom:6px;font-weight:600;color:#555;font-size:14px;">🏗️ 工程名稱</label>
    <input type="text" id="addPipelineName" placeholder="例如: 鯉魚潭場第二送水管工程-管(一)" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
</div>

<div style="background:#e3f2fd;padding:12px;border-radius:8px;margin-bottom:20px;font-size:13px;color:#1565c0;line-height:1.6;">
    💡 <strong>預設路徑</strong><br>
    系統將在地圖中心生成一條短路徑(2個點)<br>
    儲存後可用「✏️ 編輯路徑」調整
</div>

<div style="background:#fff3cd;padding:12px;border-radius:8px;margin-bottom:20px;font-size:12px;color:#856404;line-height:1.6;">
    ⚠️ 儲存後會立即寫入 Google Sheets<br>
    請確認資料正確後再儲存
</div>

<div style="display:flex;gap:10px;">
    <button onclick="submitAddPipeline()" style="flex:1;padding:14px;background:#4CAF50;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:15px;">
        💾 儲存工程
    </button>
    <button onclick="closeAddPipelineForm()" style="padding:14px 20px;background:#f5f5f5;border:none;border-radius:8px;cursor:pointer;font-size:14px;">
        取消
    </button>
</div>
    `;
    
    document.body.appendChild(overlay);
    document.body.appendChild(formDiv);
}

async function loadAllProjects() {
    try {
const response = await fetch(`${API_URL}?action=getProjects`);
const result = await response.json();

console.log('🔍 getProjects API 回應:', result);

if (result.success) {
    console.log('✅ projects 陣列:', result.projects);
    return result.projects || [];
}
console.log('❌ API success=false');
return [];
    } catch (error) {
console.error('載入計畫列表失敗:', error);
return [];
    }
}

function selectProject(projectName) {
    // 清除所有按鈕的選中狀態
    const buttons = document.querySelectorAll('[id^="projectBtn_"]');
    buttons.forEach(btn => {
btn.style.background = 'white';
btn.style.borderColor = '#ddd';
btn.classList.remove('selected');
    });
    
    // 設置當前按鈕為選中
    event.target.style.background = '#e3f2fd';
    event.target.style.borderColor = '#2196F3';
    event.target.classList.add('selected');
    
    // 更新顯示欄位
    document.getElementById('addPipelineProjectName').value = projectName;
    document.getElementById('addPipelineNewProject').style.display = 'none';
}

function showNewProjectInput() {
    // 清除所有按鈕的選中狀態
    const buttons = document.querySelectorAll('[id^="projectBtn_"]');
    buttons.forEach(btn => {
btn.style.background = 'white';
btn.style.borderColor = '#ddd';
btn.classList.remove('selected');
    });
    
    // 清空並顯示新計畫輸入框
    document.getElementById('addPipelineProjectName').value = '';
    const newProjectInput = document.getElementById('addPipelineNewProject');
    newProjectInput.style.display = 'block';
    newProjectInput.focus();
}

async function submitAddPipeline() {
    if (!requireAdmin()) return;
    const projectSelect = document.getElementById('addPipelineProjectSelect');
    const projectNameInput = document.getElementById('addPipelineProjectName');
    const pipelineIdInput = document.getElementById('addPipelineId');
    const nameInput = document.getElementById('addPipelineName');
    
    // 取得計畫名稱
    let projectName;
    if (projectSelect.value === '__NEW__') {
// 新增計畫模式
projectName = projectNameInput.value.trim();
if (!projectName) {
    showToast('請輸入新計畫名稱', 'warning');
    projectNameInput.focus();
    return;
}
    } else if (projectSelect.value) {
// 選擇既有計畫
projectName = projectSelect.value;
    } else {
showToast('請選擇計畫', 'warning');
return;
    }
    
    // 驗證工程編號(必填)
    const pipelineId = pipelineIdInput.value.trim();
    if (!pipelineId) {
showToast('請輸入工程編號', 'warning');
pipelineIdInput.focus();
return;
    }
    
    // 驗證工程名稱
    const pipelineName = nameInput.value.trim();
    if (!pipelineName) {
showToast('請輸入工程名稱', 'warning');
nameInput.focus();
return;
    }
    
    const area = '台中市'; // 固定地區
    
    // 生成預設的 MULTILINESTRING (地圖中心的兩個點)
    const center = map ? map.getCenter() : { lat: 24.1477, lng: 120.6736 };
    const lat1 = center.lat;
    const lng1 = center.lng;
    
    // 第二個點往東偏移約20m (經度+0.0002度 ≈ 20m)
    const lat2 = center.lat;
    const lng2 = center.lng + 0.0002;
    
    const linestring = `MULTILINESTRING((${lng1} ${lat1}, ${lng2} ${lat2}))`;
    
    // 確認訊息
    const confirmMsg = `確定要新增以下工程嗎?\n\n工程編號: ${pipelineId}\n計畫: ${projectName}\n工程: ${pipelineName}\n\n將自動生成短路徑供後續編輯`;
    
    if (!await showConfirm({ title: '確認新增工程', message: confirmMsg, okText: '確認新增', icon: '➕' })) {
return;
    }
    
    try {
const params = {
    action: 'addPipeline',
    projectName: projectName,
    pipelineName: pipelineName,
    area: area,
    linestring: linestring,
    customPipelineId: pipelineId
};

const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
});

const result = await response.json();

if (result.success) {
    closeAddPipelineForm();
    showToast('新增成功!', 'success');
    
    // 重新載入所有資料
    await loadData();
    
    // 等待資料載入完成後,自動顯示新工程
    if (result.pipelineId) {
        setTimeout(() => {
            const newPipeline = allPipelines.find(p => p.id === result.pipelineId);
            if (newPipeline) {
                console.log('✅ 自動載入新工程:', result.pipelineId);
                showPipelineDetail(result.pipelineId);
            } else {
                console.warn('⚠️ 找不到新工程,請手動選擇');
            }
        }, 2000);
    }
} else {
    showToast('新增失敗：' + (result.error || '未知錯誤'), 'error');
}
    } catch (error) {
console.error('新增工程失敗:', error);
showToast('新增失敗：' + error.message, 'error');
    }
}

// 處理計畫下拉選單切換
window.handleProjectSelectChange = function() {
    const select = document.getElementById('addPipelineProjectSelect');
    const input = document.getElementById('addPipelineProjectName');
    
    if (select.value === '__NEW__') {
// 顯示新增計畫輸入框
input.style.display = 'block';
input.focus();
    } else {
// 隱藏新增計畫輸入框
input.style.display = 'none';
input.value = '';
    }
};

function closeAddPipelineForm() {
    const form = document.getElementById('addPipelineForm');
    const overlay = document.getElementById('addPipelineOverlay');
    if (form) form.remove();
    if (overlay) overlay.remove();
}

