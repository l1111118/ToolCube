/**
 * 正则表达式测试器
 * @version 1.3.0
 */

// DOM元素
const elements = {
  regexPattern: document.getElementById('regex-pattern'),
  testText: document.getElementById('test-text'),
  resultDisplay: document.getElementById('result-display'),
  matchCount: document.getElementById('match-count'),
  replacePattern: document.getElementById('replace-pattern'),
  replaceResult: document.getElementById('replace-result'),
  detailsSection: document.getElementById('details-section'),
  detailsList: document.getElementById('details-list'),
  flagsDisplay: document.getElementById('flags-display'),
  btnReplace: document.getElementById('btn-replace'),
  btnClearTest: document.getElementById('btn-clear-test'),
  btnSample: document.getElementById('btn-sample'),
  templateBtns: document.querySelectorAll('.template-btn'),
  flagCheckboxes: document.querySelectorAll('.regex-flags input'),
  toast: document.getElementById('toast')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
// 状态
let state = {
  matches: [],
  regex: null,
  isValid: false
};

// 示例文本
const SAMPLE_TEXT = `联系信息：
邮箱: example@email.com, test123@domain.org
电话: 138-1234-5678, 15987654321
网址: https://www.example.com, http://test.site/path
日期: 2024-01-15, 2023/12/25
身份证: 110101199001011234

订单信息：
订单号: ORD-2024-001, ORD-2024-002
金额: ¥1,234.56, ¥999.00`;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadSavedData();
  updateFlags();
});

/**
 * 初始化事件监听
 */
function initEventListeners() {
  // 正则输入变化
  elements.regexPattern.addEventListener('input', debounce(() => {
    testRegex();
    saveData();
  }, 300));
  
  // 测试文本变化
  elements.testText.addEventListener('input', debounce(() => {
    testRegex();
    saveData();
  }, 300));
  
  // 标志变化
  elements.flagCheckboxes.forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      updateFlags();
      testRegex();
    });
  });
  
  // 模板按钮
  elements.templateBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.regexPattern.value = btn.dataset.pattern;
      testRegex();
      saveData();
    });
  });
  
  // 操作按钮
  elements.btnReplace.addEventListener('click', testReplace);
  elements.btnClearTest.addEventListener('click', () => {
    elements.testText.value = '';
    testRegex();
  });
  elements.btnSample.addEventListener('click', () => {
    elements.testText.value = SAMPLE_TEXT;
    testRegex();
    saveData();
  });
  
  // 监听消息
  window.addEventListener('message', handleMessage);
}

/**
 * 更新标志显示
 */
function updateFlags() {
  let flags = '';
  if (document.getElementById('flag-g').checked) flags += 'g';
  if (document.getElementById('flag-i').checked) flags += 'i';
  if (document.getElementById('flag-m').checked) flags += 'm';
  if (document.getElementById('flag-s').checked) flags += 's';
  elements.flagsDisplay.textContent = flags || '(无)';
}

/**
 * 获取标志字符串
 */
function getFlags() {
  let flags = '';
  if (document.getElementById('flag-g').checked) flags += 'g';
  if (document.getElementById('flag-i').checked) flags += 'i';
  if (document.getElementById('flag-m').checked) flags += 'm';
  if (document.getElementById('flag-s').checked) flags += 's';
  return flags;
}

/**
 * 测试正则表达式
 */
function testRegex() {
  const pattern = elements.regexPattern.value;
  const text = elements.testText.value;
  
  if (!pattern || !text) {
    elements.resultDisplay.innerHTML = '<div class="result-placeholder">输入正则表达式和测试文本后，匹配结果将显示在这里</div>';
    elements.matchCount.textContent = '0 个匹配';
    elements.detailsSection.hidden = true;
    return;
  }
  
  try {
    const flags = getFlags();
    const regex = new RegExp(pattern, flags);
    state.regex = regex;
    state.isValid = true;
    
    // 执行匹配
    state.matches = [];
    let match;
    
    if (flags.includes('g')) {
      while ((match = regex.exec(text)) !== null) {
        state.matches.push(match);
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    } else {
      match = regex.exec(text);
      if (match) {
        state.matches.push(match);
      }
    }
    
    // 显示结果
    displayResults();
    displayDetails();
    
  } catch (error) {
    state.isValid = false;
    elements.resultDisplay.innerHTML = `<div class="error-message">正则表达式错误: ${escapeHtml(error.message)}</div>`;
    elements.matchCount.textContent = '表达式错误';
    elements.detailsSection.hidden = true;
  }
}

/**
 * 显示匹配结果
 */
function displayResults() {
  const text = elements.testText.value;
  const matches = state.matches;
  
  elements.matchCount.textContent = `${matches.length} 个匹配`;
  
  if (matches.length === 0) {
    elements.resultDisplay.innerHTML = `<div class="result-placeholder">未找到匹配项</div>`;
    return;
  }
  
  // 高亮显示匹配
  let resultHTML = '';
  let lastIndex = 0;
  
  matches.forEach((match, index) => {
    // 添加匹配前的文本
    resultHTML += escapeHtml(text.substring(lastIndex, match.index));
    
    // 添加高亮的匹配
    const matchText = match[0];
    let matchHTML = escapeHtml(matchText);
    
    // 如果有捕获组，在匹配内部显示
    if (match.length > 1) {
      // 复杂的组高亮逻辑
      matchHTML = highlightGroups(match);
    } else {
      matchHTML = `<span class="match-highlight" title="匹配 ${index + 1}">${matchHTML}</span>`;
    }
    
    resultHTML += matchHTML;
    lastIndex = match.index + matchText.length;
  });
  
  // 添加剩余文本
  resultHTML += escapeHtml(text.substring(lastIndex));
  
  elements.resultDisplay.innerHTML = resultHTML;
}

/**
 * 高亮捕获组
 */
function highlightGroups(match) {
  // 通过 DOM API 构造再由 outerHTML 序列化：
  // 本文件的 escapeHtml 基于 div.innerHTML，不会转义双引号，
  // 若直接把匹配文本拼进 title="..."，匹配内容含 " 时可闭合属性并注入标签。
  const span = document.createElement('span');
  span.className = 'match-highlight';
  span.title = '匹配: ' + match[0];
  span.textContent = match[0];
  return span.outerHTML;
}

/**
 * 显示匹配详情
 */
function displayDetails() {
  const matches = state.matches;
  
  if (matches.length === 0) {
    elements.detailsSection.hidden = true;
    return;
  }
  
  elements.detailsSection.hidden = false;
  elements.detailsList.innerHTML = '';
  
  matches.forEach((match, index) => {
    const item = document.createElement('div');
    item.className = 'detail-item';
    
    let groupsHTML = '';
    if (match.length > 1) {
      groupsHTML = '<div class="detail-groups">';
      for (let i = 1; i < match.length; i++) {
        if (match[i] !== undefined) {
          groupsHTML += `<div class="detail-group"><span>$${i}:</span> ${escapeHtml(match[i])}</div>`;
        }
      }
      groupsHTML += '</div>';
    }
    
    item.innerHTML = `
      <div class="detail-index">${index + 1}</div>
      <div class="detail-content">
        <div class="detail-match">${escapeHtml(match[0])}</div>
        <div class="detail-info">位置: ${match.index} - ${match.index + match[0].length} | 长度: ${match[0].length}</div>
        ${groupsHTML}
      </div>
    `;
    
    elements.detailsList.appendChild(item);
  });
}

/**
 * 测试替换
 */
function testReplace() {
  if (!state.isValid || !state.regex) {
    showToast('请先输入有效的正则表达式', 'error');
    return;
  }
  
  const text = elements.testText.value;
  const replacement = elements.replacePattern.value;
  
  try {
    // 创建新的正则（始终使用全局标志进行替换）
    const flags = getFlags();
    const globalFlags = flags.includes('g') ? flags : flags + 'g';
    const regex = new RegExp(elements.regexPattern.value, globalFlags);
    
    const result = text.replace(regex, replacement);
    elements.replaceResult.textContent = result;
    
    saveToHistory('replace', 'replace');
  } catch (error) {
    showToast('替换失败: ' + error.message, 'error');
  }
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
    pattern: elements.regexPattern.value,
    text: elements.testText.value,
    flags: getFlags(),
    timestamp: Date.now()
  };
  
  try {
    await safeSend({
      action: 'saveToolData',
      data: { toolId: 'regex-tester', data }
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
      data: { toolId: 'regex-tester' }
    });
    
    if (response) {
      if (response.pattern) {
        elements.regexPattern.value = response.pattern;
      }
      if (response.text) {
        elements.testText.value = response.text;
      }
      if (response.flags) {
        const flags = response.flags;
        document.getElementById('flag-g').checked = flags.includes('g');
        document.getElementById('flag-i').checked = flags.includes('i');
        document.getElementById('flag-m').checked = flags.includes('m');
        document.getElementById('flag-s').checked = flags.includes('s');
        updateFlags();
      }
      
      if (elements.regexPattern.value && elements.testText.value) {
        testRegex();
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
        toolId: 'regex-tester',
        type: action,
        data: { pattern: elements.regexPattern.value, action }
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
        elements.testText.value = data;
        testRegex();
        saveData();
      }
      break;
    case 'loadHistory':
      if (data) {
        if (data.pattern) elements.regexPattern.value = data.pattern;
        if (data.text) elements.testText.value = data.text;
        testRegex();
      }
      break;
  }
}
