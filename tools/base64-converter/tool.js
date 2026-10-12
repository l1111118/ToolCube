/**
 * Base64编解码工具
 * @version 1.3.0
 */

// DOM元素
const elements = {
  // 模式标签
  modeTabs: document.querySelectorAll('.mode-tab'),
  modeContents: document.querySelectorAll('.mode-content'),
  
  // 文本模式
  textInput: document.getElementById('text-input'),
  textOutput: document.getElementById('text-output'),
  btnEncode: document.getElementById('btn-encode'),
  btnDecode: document.getElementById('btn-decode'),
  btnSwap: document.getElementById('btn-swap'),
  textPaste: document.getElementById('text-paste'),
  textClear: document.getElementById('text-clear'),
  textCopy: document.getElementById('text-copy'),
  textDownload: document.getElementById('text-download'),
  textInputStats: document.getElementById('text-input-stats'),
  textOutputStats: document.getElementById('text-output-stats'),
  
  // 图片模式
  imageDropZone: document.getElementById('image-drop-zone'),
  imageInput: document.getElementById('image-input'),
  imagePreviewArea: document.getElementById('image-preview-area'),
  imagePreview: document.getElementById('image-preview'),
  btnConvertImage: document.getElementById('btn-convert-image'),
  btnClearImage: document.getElementById('btn-clear-image'),
  base64Input: document.getElementById('base64-input'),
  btnConvertBase64: document.getElementById('btn-convert-base64'),
  btnPasteBase64: document.getElementById('btn-paste-base64'),
  imageResultArea: document.getElementById('image-result-area'),
  imageResult: document.getElementById('image-result'),
  btnDownloadImage: document.getElementById('btn-download-image'),
  
  // 文件模式
  fileDropZone: document.getElementById('file-drop-zone'),
  fileInput: document.getElementById('file-input'),
  fileInfo: document.getElementById('file-info'),
  fileName: document.getElementById('file-name'),
  fileSize: document.getElementById('file-size'),
  fileType: document.getElementById('file-type'),
  fileResult: document.getElementById('file-result'),
  fileOutput: document.getElementById('file-output'),
  btnCopyFile: document.getElementById('btn-copy-file'),
  btnDownloadFile: document.getElementById('btn-download-file'),
  
  // 提示
  toast: document.getElementById('toast')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
// 状态
let state = {
  currentMode: 'text',
  selectedImage: null,
  convertedBase64: null,
  selectedFile: null
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadSavedData();
});

/**
 * 初始化事件监听
 */
function initEventListeners() {
  // 模式切换
  elements.modeTabs.forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });
  
  // 文本模式
  elements.btnEncode.addEventListener('click', encodeText);
  elements.btnDecode.addEventListener('click', decodeText);
  elements.btnSwap.addEventListener('click', swapText);
  elements.textPaste.addEventListener('click', () => pasteTo(elements.textInput));
  elements.textClear.addEventListener('click', () => clearText());
  elements.textCopy.addEventListener('click', () => copyFrom(elements.textOutput));
  elements.textDownload.addEventListener('click', downloadTextResult);
  elements.textInput.addEventListener('input', updateTextStats);
  
  // 图片模式 - 拖放
  elements.imageDropZone.addEventListener('dragover', handleDragOver);
  elements.imageDropZone.addEventListener('dragleave', handleDragLeave);
  elements.imageDropZone.addEventListener('drop', handleImageDrop);
  elements.imageDropZone.addEventListener('click', () => elements.imageInput.click());
  elements.imageInput.addEventListener('change', handleImageSelect);
  
  elements.btnConvertImage.addEventListener('click', convertImageToBase64);
  elements.btnClearImage.addEventListener('click', clearImage);
  elements.btnConvertBase64.addEventListener('click', convertBase64ToImage);
  elements.btnPasteBase64.addEventListener('click', () => pasteTo(elements.base64Input));
  elements.btnDownloadImage.addEventListener('click', downloadConvertedImage);
  
  // 文件模式 - 拖放
  elements.fileDropZone.addEventListener('dragover', handleDragOver);
  elements.fileDropZone.addEventListener('dragleave', handleDragLeave);
  elements.fileDropZone.addEventListener('drop', handleFileDrop);
  elements.fileDropZone.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', handleFileSelect);
  
  elements.btnCopyFile.addEventListener('click', () => copyFrom(elements.fileOutput));
  elements.btnDownloadFile.addEventListener('click', downloadFileResult);
  
  // 监听消息
  window.addEventListener('message', handleMessage);
}

/**
 * 切换模式
 */
function switchMode(mode) {
  state.currentMode = mode;
  
  // 更新标签
  elements.modeTabs.forEach(tab => {
    tab.classList.toggle('mode-tab--active', tab.dataset.mode === mode);
  });
  
  // 更新内容
  elements.modeContents.forEach(content => {
    content.classList.toggle('mode-content--active', content.id === `${mode}-mode`);
  });
}

// ==================== 文本模式 ====================

/**
 * 编码文本
 */
function encodeText() {
  const input = elements.textInput.value;
  if (!input) {
    showToast('请输入要编码的文本', 'error');
    return;
  }
  
  try {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(input);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const encoded = btoa(binary);
    elements.textOutput.value = encoded;
    updateTextStats();
    showToast('编码成功', 'success');
    saveToHistory(input, 'encode');
  } catch (error) {
    showToast('编码失败: ' + error.message, 'error');
  }
}

/**
 * 解码文本
 */
function decodeText() {
  const input = elements.textInput.value.trim();
  if (!input) {
    showToast('请输入要解码的文本', 'error');
    return;
  }
  
  try {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decoded = new TextDecoder().decode(bytes);
    elements.textOutput.value = decoded;
    updateTextStats();
    showToast('解码成功', 'success');
    saveToHistory(input, 'decode');
  } catch (error) {
    showToast('解码失败: 无效的Base64字符串', 'error');
  }
}

/**
 * 交换输入输出
 */
function swapText() {
  const temp = elements.textInput.value;
  elements.textInput.value = elements.textOutput.value;
  elements.textOutput.value = temp;
  updateTextStats();
}

/**
 * 清空文本
 */
function clearText() {
  elements.textInput.value = '';
  elements.textOutput.value = '';
  updateTextStats();
}

/**
 * 更新文本统计
 */
function updateTextStats() {
  elements.textInputStats.textContent = `${elements.textInput.value.length} 字符`;
  elements.textOutputStats.textContent = `${elements.textOutput.value.length} 字符`;
}

/**
 * 下载文本结果
 */
function downloadTextResult() {
  const output = elements.textOutput.value;
  if (!output) {
    showToast('没有可下载的内容', 'error');
    return;
  }
  
  const blob = new Blob([output], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `base64_result_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== 图片模式 ====================

/**
 * 处理拖放悬停
 */
function handleDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drop-zone--dragover');
}

/**
 * 处理拖放离开
 */
function handleDragLeave(e) {
  e.currentTarget.classList.remove('drop-zone--dragover');
}

/**
 * 处理图片拖放
 */
function handleImageDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-zone--dragover');
  
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    loadImage(files[0]);
  }
}

/**
 * 处理图片选择
 */
function handleImageSelect(e) {
  const file = e.target.files[0];
  if (file) {
    loadImage(file);
  }
}

/**
 * 加载图片
 */
function loadImage(file) {
  if (!file.type.startsWith('image/')) {
    showToast('请选择图片文件', 'error');
    return;
  }
  
  state.selectedImage = file;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    elements.imagePreview.src = e.target.result;
    elements.imageDropZone.hidden = true;
    elements.imagePreviewArea.hidden = false;
  };
  reader.readAsDataURL(file);
}

/**
 * 图片转Base64
 */
function convertImageToBase64() {
  if (!state.selectedImage) {
    showToast('请先选择图片', 'error');
    return;
  }
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target.result;
    elements.base64Input.value = base64;
    showToast('转换成功', 'success');
    saveToHistory(state.selectedImage.name, 'image-to-base64');
  };
  reader.readAsDataURL(state.selectedImage);
}

/**
 * 清除图片
 */
function clearImage() {
  state.selectedImage = null;
  elements.imagePreview.src = '';
  elements.imageDropZone.hidden = false;
  elements.imagePreviewArea.hidden = true;
  elements.imageInput.value = '';
}

/**
 * Base64转图片
 */
function convertBase64ToImage() {
  const base64 = elements.base64Input.value.trim();
  if (!base64) {
    showToast('请输入Base64数据', 'error');
    return;
  }
  
  try {
    // 验证是否是有效的图片Base64
    if (!base64.match(/^data:image\/[a-z]+;base64,/)) {
      // 尝试添加前缀
      if (base64.match(/^[A-Za-z0-9+/=]+$/)) {
        showToast('警告: 缺少图片类型前缀，尝试作为PNG解析', 'error');
        elements.imageResult.src = 'data:image/png;base64,' + base64;
      } else {
        elements.imageResult.src = base64;
      }
    } else {
      elements.imageResult.src = base64;
    }
    
    elements.imageResultArea.hidden = false;
    showToast('转换成功', 'success');
    saveToHistory('base64-to-image', 'base64-to-image');
  } catch (error) {
    showToast('转换失败: ' + error.message, 'error');
  }
}

/**
 * 下载转换后的图片
 */
function downloadConvertedImage() {
  const src = elements.imageResult.src;
  if (!src) {
    showToast('没有可下载的图片', 'error');
    return;
  }
  
  const a = document.createElement('a');
  a.href = src;
  a.download = `converted_image_${Date.now()}.png`;
  a.click();
}

// ==================== 文件模式 ====================

/**
 * 处理文件拖放
 */
function handleFileDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-zone--dragover');
  
  const files = e.dataTransfer.files;
  if (files.length > 0) {
    loadFile(files[0]);
  }
}

/**
 * 处理文件选择
 */
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) {
    loadFile(file);
  }
}

/**
 * 加载文件
 */
function loadFile(file) {
  state.selectedFile = file;
  
  // 显示文件信息
  elements.fileName.textContent = file.name;
  elements.fileSize.textContent = formatFileSize(file.size);
  elements.fileType.textContent = file.type || '未知';
  elements.fileInfo.hidden = false;
  
  // 转换为Base64
  const reader = new FileReader();
  reader.onload = (e) => {
    elements.fileOutput.value = e.target.result;
    elements.fileResult.hidden = false;
    showToast('文件加载成功', 'success');
  };
  reader.onerror = () => {
    showToast('文件读取失败', 'error');
  };
  reader.readAsDataURL(file);
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 下载文件结果
 */
function downloadFileResult() {
  const output = elements.fileOutput.value;
  if (!output) {
    showToast('没有可下载的内容', 'error');
    return;
  }
  
  const blob = new Blob([output], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${state.selectedFile?.name || 'file'}_base64.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== 通用功能 ====================

/**
 * 粘贴到输入框
 */
async function pasteTo(element) {
  try {
    const text = await navigator.clipboard.readText();
    element.value = text;
    if (element === elements.textInput) {
      updateTextStats();
    }
    showToast('粘贴成功', 'success');
  } catch (error) {
    showToast('无法访问剪贴板', 'error');
  }
}

/**
 * 从输出框复制
 */
async function copyFrom(element) {
  const text = element.value;
  if (!text) {
    showToast('没有可复制的内容', 'error');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板', 'success');
  } catch (error) {
    showToast('复制失败', 'error');
  }
}

/**
 * 显示提示
 */
function showToast(message, type = 'info') {
  elements.toast.textContent = message;
  elements.toast.className = `toast toast--${type}`;
  elements.toast.classList.add('toast--show');
  
  setTimeout(() => {
    elements.toast.classList.remove('toast--show');
  }, 3000);
}

/**
 * 保存数据
 */
/**
 * 加载保存的数据
 */
async function loadSavedData() {
  try {
    const response = await safeSend({
      action: 'getToolData',
      data: { toolId: 'base64-converter' }
    });
    
    if (response) {
      if (response.textInput) {
        elements.textInput.value = response.textInput;
        updateTextStats();
      }
      if (response.base64Input) {
        elements.base64Input.value = response.base64Input;
      }
      if (response.mode) {
        switchMode(response.mode);
      }
    }
  } catch (error) {
    console.error('Load data failed:', error);
  }
}

/**
 * 保存到历史记录
 */
async function saveToHistory(input, action) {
  try {
    await safeSend({
      action: 'saveToHistory',
      data: {
        toolId: 'base64-converter',
        type: action,
        data: { input: input.substring(0, 200), action }
      }
    });
  } catch (error) {
    console.error('Save history failed:', error);
  }
}

/**
 * 处理来自父窗口的消息
 */
function handleMessage(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  const { action, data } = event.data;
  
  switch (action) {
    case 'setTheme':
      if (data && data.theme) document.documentElement.setAttribute('data-theme', data.theme);
      break;
    case 'setData':
      if (typeof data === 'object') {
        if (data.action === 'encode') {
          elements.textInput.value = data.text || '';
          updateTextStats();
          encodeText();
        } else if (data.action === 'decode') {
          elements.textInput.value = data.text || '';
          updateTextStats();
          decodeText();
        }
      } else if (typeof data === 'string') {
        elements.textInput.value = data;
        updateTextStats();
      }
      break;
    case 'loadHistory':
      if (data && data.input) {
        elements.textInput.value = data.input;
        updateTextStats();
      }
      break;
  }
}
