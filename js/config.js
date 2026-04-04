const API_URL = 'https://script.google.com/macros/s/AKfycbwJfTW9FHDaasFMnZluPAPPij6PhjYS5nU5qvR5fV2Y2n7tEMrhBFIKH6b0-Cn5xxjy/exec';

let currentUser = null; // { email, name, picture, role }
let userToken = null; // Google ID Token

let map = null;
let allProjects = [];
let allPipelines = [];
let currentProject = null;
let currentPipeline = null;
let allPolylines = [];

// 🚀 效能優化：追蹤每個小段的 polyline 物件,用於局部更新
// 格式: { "段落編號-小段索引": { polyline, segment, smallIndex, color } }
let smallSegmentPolylines = {};

// 批次選取功能變數
let batchSelectMode = false;
let selectedSmallSegments = []; // {segmentNumber, smallIndex, polyline}
let lastClickedSmallSegment = null; // 用於 Shift 範圍選取

// 測量功能變數
let measureMode = false;
let measurePoints = [];
let measureLine = null;
let measureMarkers = [];
let measureLabel = null;

// 施工日期標籤
let dateLabelsVisible = false;
let dateLabels = [];
let dateLabelArrows = [];
let ganttItemsCache = [];

// 路徑編輯模式變數
let isEditingPath = false;
let editingPolyline = null;
let editingNodes = [];
let segmentBreakPoints = []; // 記錄分段點的索引位置
let originalSegmentBreaks = []; // 原始的分段點位置
let branchStructure = null; // 分支結構 { branches: [], junctionPoints: [] }
let editingBranches = []; // 編輯中的分支 polylines
let junctionMarkers = []; // 交叉點標記
let originalCoords = [];

// 分支繪製模式變數
let isBranchDrawingMode = false; // 是否在分支繪製模式
let branchDrawingNodes = []; // 正在繪製的分支節點
let branchDrawingLine = null; // 繪製中的分支預覽線
let branchStartNode = null; // 分支起始節點 {branchIndex, nodeIndex, coord}
let branchDrawingMarkers = []; // 繪製模式的標記
let branchDrawingHint = null; // 提示訊息 div

// 🆕 分支編輯模式變數
let isBranchEditMode = false; // 是否在分支編輯模式
let branchEditJunctions = []; // Y接點標記 [{coord, marker, distance}]
let branchEditNewBranches = []; // 新繪製的支線 [{coords, polyline}]
let branchEditCurrentDrawing = null; // 當前正在繪製的支線 {startCoord, coords, polyline, markers}
let branchEditMainPolyline = null; // 主幹預覽線

// 工法顏色配置（改用飽和度更高的顏色）
const METHOD_COLORS = {
    '埋設': { color: '#F44336' },   // 紅色
    '推進': { color: '#2196F3' },   // 藍色
    '水管橋': { color: '#4CAF50' }, // 綠色
    '潛鑽': { color: '#FFC107' },   // 黃色
    '潛遁': { color: '#9C27B0' },   // 紫色
    '隧道': { color: '#FF5722' }    // 橘色
};

// 自動生成易區分的顏色（用於不同的管徑-管種-施工方式組合）
const DISTINCT_COLORS = [
    '#E91E63', // 粉紅
    '#9C27B0', // 紫色
    '#673AB7', // 深紫
    '#3F51B5', // 靛藍
    '#2196F3', // 藍色
    '#03A9F4', // 淺藍
    '#00BCD4', // 青色
    '#009688', // 藍綠
    '#4CAF50', // 綠色
    '#8BC34A', // 淺綠
    '#CDDC39', // 萊姆綠
    '#FFEB3B', // 黃色
    '#FFC107', // 琥珀
    '#FF9800', // 橙色
    '#FF5722', // 深橙
    '#F44336', // 紅色
    '#795548', // 棕色
    '#607D8B', // 藍灰
    '#E91E63', // 玫瑰紅
    '#00E676'  // 螢光綠
];

// 為每個組合分配顏色
const methodKeyColorMap = {}; // {methodKey: color}
let colorIndex = 0;

function getColorForMethodKey(methodKey) {
    if (!methodKeyColorMap[methodKey]) {
        methodKeyColorMap[methodKey] = DISTINCT_COLORS[colorIndex % DISTINCT_COLORS.length];
        colorIndex++;
    }
    return methodKeyColorMap[methodKey];
}

// 🔍 解析段落資料中的 branchIndex (從備註欄位提取)
// 從 notes 欄位解析節點區間（格式：node:節點1-2|branchIndex:0）
function parseNodeFromNotes(notes) {
    if (!notes) return '';
    const match = String(notes).match(/node:([^|]+)/);
    return match ? match[1].trim() : '';
}

// 組合 notes 字串（保留 branchIndex，加入/更新 node）
function buildNotes(nodeStr, branchIndex) {
    const parts = [];
    if (nodeStr && nodeStr.trim()) parts.push('node:' + nodeStr.trim());
    if (branchIndex !== undefined && branchIndex !== null && String(branchIndex) !== '') {
        parts.push('branchIndex:' + branchIndex);
    }
    return parts.join('|');
}

function parseBranchIndexFromSegments(segments) {
    if (!segments || !Array.isArray(segments)) return segments;
    
    segments.forEach(seg => {
        if (seg.notes && seg.notes.includes('branchIndex:')) {
            const match = seg.notes.match(/branchIndex:(\d+)/);
            if (match) {
                seg.branchIndex = parseInt(match[1], 10);
            }
        }
        // 同時解析節點區間
        seg.nodeRange = parseNodeFromNotes(seg.notes);
    });
    
    return segments;
}

