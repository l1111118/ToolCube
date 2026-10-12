/**
 * JSON格式化与验证工具
 * @version 1.3.0
 */

// DOM元素
const elements = {
  inputArea: document.getElementById('input-area'),
  outputArea: document.getElementById('output-area'),
  treeView: document.getElementById('tree-view'),
  btnFormat: document.getElementById('btn-format'),
  btnMinify: document.getElementById('btn-minify'),
  btnEscape: document.getElementById('btn-escape'),
  btnUnescape: document.getElementById('btn-unescape'),
  btnCopy: document.getElementById('btn-copy'),
  btnDownload: document.getElementById('btn-download'),
  btnClear: document.getElementById('btn-clear'),
  btnPaste: document.getElementById('btn-paste'),
  fileInput: document.getElementById('file-input'),
  indentSelect: document.getElementById('indent-select'),
  toggleTree: document.getElementById('toggle-tree'),
  inputStatus: document.getElementById('input-status'),
  outputStatus: document.getElementById('output-status'),
  validationBar: document.getElementById('validation-bar'),
  validationIcon: document.getElementById('validation-icon'),
  validationText: document.getElementById('validation-text'),
  errorToast: document.getElementById('error-toast'),
  errorMessage: document.getElementById('error-message'),
  errorClose: document.getElementById('error-close'),
  resizer: document.getElementById('resizer')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
// 状态
let state = {
  isValid: null,
  lastInput: '',
  isTreeView: false
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadSavedData();
  updateInputStatus();
});

/**
 * 初始化事件监听
 */
function initEventListeners() {
  // 格式化按钮
  elements.btnFormat.addEventListener('click', formatJSON);
  
  // 压缩按钮
  elements.btnMinify.addEventListener('click', minifyJSON);
  
  // 转义按钮
  elements.btnEscape.addEventListener('click', escapeJSON);
  
  // 反转义按钮
  elements.btnUnescape.addEventListener('click', unescapeJSON);
  
  // 复制按钮
  elements.btnCopy.addEventListener('click', copyResult);
  
  // 下载按钮
  elements.btnDownload.addEventListener('click', downloadResult);
  
  // 清空按钮
  elements.btnClear.addEventListener('click', clearAll);
  
  // 粘贴按钮
  elements.btnPaste.addEventListener('click', pasteFromClipboard);
  
  // 文件输入
  elements.fileInput.addEventListener('change', handleFileSelect);
  
  // 输入区域变化
  elements.inputArea.addEventListener('input', debounce(() => {
    updateInputStatus();
    autoValidate();
    saveData();
  }, 500));
  
  // 树形视图切换
  elements.toggleTree.addEventListener('change', (e) => {
    state.isTreeView = e.target.checked;
    toggleViewMode();
  });
  
  // 缩进选择
  elements.indentSelect.addEventListener('change', () => {
    if (elements.outputArea.value) {
      formatJSON();
    }
  });
  
  // 错误提示关闭
  elements.errorClose.addEventListener('click', hideError);
  
  // 分隔条拖拽
  initResizer();
  
  // 监听来自父窗口的消息
  window.addEventListener('message', handleMessage);
}

/**
 * 格式化JSON
 */
function formatJSON() {
  const input = elements.inputArea.value.trim();
  
  if (!input) {
    showValidation('empty');
    return;
  }
  
  try {
    const parsed = JSON.parse(input);
    const indent = elements.indentSelect.value;
    const formatted = JSON.stringify(parsed, null, indent === '\\t' ? '\t' : parseInt(indent, 10));
    
    elements.outputArea.value = formatted;
    updateOutputStatus('formatted');
    showValidation('valid');
    
    if (state.isTreeView) {
      renderTreeView(parsed);
    }
    
    saveToHistory(input, 'format');
  } catch (error) {
    showError(`格式化失败: ${error.message}`);
    showValidation('invalid', error.message);
  }
}

/**
 * 压缩JSON
 */
function minifyJSON() {
  const input = elements.inputArea.value.trim();
  
  if (!input) {
    showValidation('empty');
    return;
  }
  
  try {
    const parsed = JSON.parse(input);
    const minified = JSON.stringify(parsed);
    
    elements.outputArea.value = minified;
    updateOutputStatus('minified');
    showValidation('valid');
    
    saveToHistory(input, 'minify');
  } catch (error) {
    showError(`压缩失败: ${error.message}`);
    showValidation('invalid', error.message);
  }
}

/**
 * 转义JSON
 */
function escapeJSON() {
  const input = elements.inputArea.value;
  
  if (!input) return;
  
  const escaped = input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  
  elements.outputArea.value = escaped;
  updateOutputStatus('escaped');
}

/**
 * 反转义JSON
 */
function unescapeJSON() {
  const input = elements.inputArea.value;
  
  if (!input) return;
  
  try {
    const unescaped = input
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    
    elements.outputArea.value = unescaped;
    updateOutputStatus('unescaped');
  } catch (error) {
    showError('反转义失败');
  }
}

/**
 * 复制结果
 */
async function copyResult() {
  const output = elements.outputArea.value;
  
  if (!output) {
    showError('没有可复制的内容');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(output);
    showValidation('copied');
    setTimeout(() => showValidation(state.isValid ? 'valid' : null), 1500);
  } catch (error) {
    showValidation('copied');
    setTimeout(() => showValidation(state.isValid ? 'valid' : null), 1500);
  }
}

/**
 * 下载结果
 */
function downloadResult() {
  const output = elements.outputArea.value;
  
  if (!output) {
    showError('没有可下载的内容');
    return;
  }
  
  const blob = new Blob([output], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `formatted_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 清空所有
 */
function clearAll() {
  if (elements.inputArea.value || elements.outputArea.value) {
    if (!confirm('确定要清空所有内容吗？')) return;
  }
  
  elements.inputArea.value = '';
  elements.outputArea.value = '';
  elements.treeView.innerHTML = '';
  updateInputStatus();
  updateOutputStatus('empty');
  showValidation('empty');
  saveData();
}

/**
 * 从剪贴板粘贴
 */
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    elements.inputArea.value = text;
    updateInputStatus();
    autoValidate();
    saveData();
  } catch (error) {
    showError('无法访问剪贴板');
  }
}

/**
 * 处理文件选择
 */
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    elements.inputArea.value = event.target.result;
    updateInputStatus();
    autoValidate();
    saveData();
  };
  reader.onerror = () => {
    showError('文件读取失败');
  };
  reader.readAsText(file);
}

/**
 * 自动验证
 */
function autoValidate() {
  const input = elements.inputArea.value.trim();
  
  if (!input) {
    showValidation('empty');
    return;
  }
  
  try {
    JSON.parse(input);
    showValidation('valid');
  } catch (error) {
    // 不显示错误，只是更新状态
    showValidation('typing');
  }
}

/**
 * 显示验证状态
 */
function showValidation(status, message = '') {
  const bar = elements.validationBar;
  const icon = elements.validationIcon;
  const text = elements.validationText;
  
  bar.classList.remove('validation-bar--valid', 'validation-bar--invalid');
  
  switch (status) {
    case 'empty':
      icon.textContent = '⏳';
      text.textContent = '等待输入...';
      state.isValid = null;
      break;
    case 'typing':
      icon.textContent = '✏️';
      text.textContent = '正在输入...';
      state.isValid = null;
      break;
    case 'valid':
      icon.textContent = '✅';
      text.textContent = 'JSON格式正确';
      bar.classList.add('validation-bar--valid');
      state.isValid = true;
      break;
    case 'invalid':
      icon.textContent = '❌';
      text.textContent = `格式错误: ${truncate(message, 50)}`;
      bar.classList.add('validation-bar--invalid');
      state.isValid = false;
      break;
    case 'copied':
      icon.textContent = '📋';
      text.textContent = '已复制到剪贴板';
      break;
  }
}

/**
 * 更新输入状态
 */
function updateInputStatus() {
  const length = elements.inputArea.value.length;
  elements.inputStatus.textContent = `${length} 字符`;
}

/**
 * 更新输出状态
 */
function updateOutputStatus(type) {
  const length = elements.outputArea.value.length;
  let status = '';
  
  switch (type) {
    case 'formatted':
      status = `格式化完成 | ${length} 字符`;
      break;
    case 'minified':
      status = `压缩完成 | ${length} 字符`;
      break;
    case 'escaped':
      status = `转义完成 | ${length} 字符`;
      break;
    case 'unescaped':
      status = `反转义完成 | ${length} 字符`;
      break;
    case 'empty':
      status = '等待输入';
      break;
    default:
      status = `${length} 字符`;
  }
  
  elements.outputStatus.textContent = status;
}

/**
 * 切换视图模式
 */
function toggleViewMode() {
  if (state.isTreeView) {
    elements.outputArea.hidden = true;
    elements.treeView.hidden = false;
    
    const output = elements.outputArea.value;
    if (output) {
      try {
        const parsed = JSON.parse(output);
        renderTreeView(parsed);
      } catch (e) {
        elements.treeView.innerHTML = '<div class="tree-error">无法解析为树形视图</div>';
      }
    }
  } else {
    elements.outputArea.hidden = false;
    elements.treeView.hidden = true;
  }
}

/**
 * 渲染树形视图
 */
function renderTreeView(data, key = '', level = 0) {
  const indent = '  '.repeat(level);
  let html = '';
  
  if (data === null) {
    html += `<span class="tree-null">null</span>`;
  } else if (typeof data === 'boolean') {
    html += `<span class="tree-boolean">${data}</span>`;
  } else if (typeof data === 'number') {
    html += `<span class="tree-number">${data}</span>`;
  } else if (typeof data === 'string') {
    html += `<span class="tree-string">"${escapeHtml(data)}"</span>`;
  } else if (Array.isArray(data)) {
    if (data.length === 0) {
      html += '<span>[]</span>';
    } else {
      html += `<span class="tree-toggle" data-level="${level}">▼</span> [<span class="tree-count">${data.length}</span>]\n`;
      data.forEach((item, index) => {
        html += `<div class="tree-node" data-level="${level + 1}">${indent}  ${renderTreeView(item, index, level + 1)},</div>`;
      });
      html += `${indent}]`;
    }
  } else if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 0) {
      html += '<span>{}</span>';
    } else {
      html += `<span class="tree-toggle" data-level="${level}">▼</span> {<span class="tree-count">${keys.length}</span>}\n`;
      keys.forEach((k, index) => {
        html += `<div class="tree-node" data-level="${level + 1}">${indent}  <span class="tree-key">"${escapeHtml(k)}"</span>: ${renderTreeView(data[k], k, level + 1)}${index < keys.length - 1 ? ',' : ''}</div>`;
      });
      html += `${indent}}`;
    }
  }
  
  if (level === 0) {
    elements.treeView.innerHTML = `<div class="tree-root">${html}</div>`;
    initTreeToggle();
  }
  
  return html;
}

/**
 * 初始化树形折叠
 */
function initTreeToggle() {
  elements.treeView.querySelectorAll('.tree-toggle').forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      const level = parseInt(e.target.dataset.level, 10);
      const node = e.target.closest('.tree-node, .tree-root');
      const children = node.querySelectorAll(`[data-level="${level + 1}"]`);
      
      children.forEach(child => {
        child.style.display = child.style.display === 'none' ? '' : 'none';
      });
      
      e.target.textContent = e.target.textContent === '▼' ? '▶' : '▼';
    });
  });
}

/**
 * 初始化分隔条拖拽
 */
function initResizer() {
  let isResizing = false;
  let startX = 0;
  let startWidth = 0;
  const panel = document.querySelector('.panel--input');
  
  elements.resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = panel.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    
    const dx = e.clientX - startX;
    const newWidth = startWidth + dx;
    
    if (newWidth > 200 && newWidth < window.innerWidth - 200) {
      panel.style.flex = 'none';
      panel.style.width = newWidth + 'px';
    }
  });
  
  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

/**
 * 显示错误
 */
function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorToast.classList.add('error-toast--show');
  
  setTimeout(hideError, 5000);
}

/**
 * 隐藏错误
 */
function hideError() {
  elements.errorToast.classList.remove('error-toast--show');
}

/**
 * HTML转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * 截断字符串
 */
function truncate(str, length) {
  if (str.length <= length) return str;
  return str.substring(0, length) + '...';
}

/**
 * 防抖函数
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * 保存数据
 */
async function saveData() {
  const data = {
    input: elements.inputArea.value,
    output: elements.outputArea.value,
    timestamp: Date.now()
  };
  
  try {
    await safeSend({
      action: 'saveToolData',
      data: { toolId: 'json-formatter', data }
    });
  } catch (error) {
    console.error('Save data failed:', error);
  }
}

/**
 * 加载保存的数据
 */
async function loadSavedData() {
  try {
    const response = await safeSend({
      action: 'getToolData',
      data: { toolId: 'json-formatter' }
    });
    
    if (response && response.input) {
      elements.inputArea.value = response.input;
      elements.outputArea.value = response.output || '';
      updateInputStatus();
      if (elements.inputArea.value) {
        autoValidate();
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
        toolId: 'json-formatter',
        type: action,
        data: { input: truncate(input, 500), action }
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
      if (typeof data === 'string') {
        elements.inputArea.value = data;
        updateInputStatus();
        autoValidate();
        formatJSON();
      }
      break;
    case 'loadHistory':
      if (data && data.input) {
        elements.inputArea.value = data.input;
        updateInputStatus();
        autoValidate();
      }
      break;
  }
}
