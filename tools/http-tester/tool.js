/**
 * HTTP测试工具
 * 增强：请求历史(20条)、计时器、响应大小、复制cURL、环境变量
 * 增强2：通过 background 代理 fetch 绕过 CORS、请求/响应头展示、JSON/HTML/Text 格式化
 */
const elements = {
  methodSelect: document.getElementById('method-select'),
  urlInput: document.getElementById('url-input'),
  btnSend: document.getElementById('btn-send'),
  btnCurl: document.getElementById('btn-curl'),
  btnEnv: document.getElementById('btn-env'),
  btnAddEnv: document.getElementById('btn-add-env'),
  btnClearHistory: document.getElementById('btn-clear-history'),
  headersInput: document.getElementById('headers-input'),
  bodyInput: document.getElementById('body-input'),
  responseStatus: document.getElementById('response-status'),
  responseTime: document.getElementById('response-time'),
  responseSize: document.getElementById('response-size'),
  responseBody: document.getElementById('response-body'),
  responseHeaders: document.getElementById('response-headers'),
  requestHeadersDisplay: document.getElementById('request-headers-display'),
  toast: document.getElementById('toast'),
  quickHeaders: document.getElementById('quick-headers'),
  historyList: document.getElementById('history-list'),
  envList: document.getElementById('env-list'),
  envVarsTip: document.getElementById('env-vars-tip'),
  btnFormatJson: document.getElementById('btn-format-json'),
  btnFormatHtml: document.getElementById('btn-format-html'),
  btnFormatText: document.getElementById('btn-format-text'),
  btnCopyBody: document.getElementById('btn-copy-body'),
  useProxy: document.getElementById('ht-use-proxy')
};

// ── PostMessage 通信路由 ──
let _msgId = 0;
const _pendingMsgs = new Map();

function _handlePostMessageResponse(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (event.source !== window.parent) return;
  if (!event.data || typeof event.data !== 'object') return;
  const { action, data } = event.data;
  if ((action === '__bgResponse' || action === '__contentResponse') && data && data.__id) {
    const pending = _pendingMsgs.get(data.__id);
    if (pending) {
      _pendingMsgs.delete(data.__id);
      clearTimeout(pending.timer);
      const result = data.result;
      if (action === '__bgResponse' && result && result.success === false && result.error) {
        pending.reject(new Error(result.error));
      } else {
        pending.resolve(result);
      }
    }
  }
}
window.addEventListener('message', _handlePostMessageResponse);

function callBackground(action, data) {
  return new Promise((resolve, reject) => {
    const id = ++_msgId;
    const timer = setTimeout(() => {
      _pendingMsgs.delete(id);
      reject(new Error('后台调用超时'));
    // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
    // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
    }, 70000);
    _pendingMsgs.set(id, { resolve, reject, timer });
    window.parent.postMessage({ action: 'callBackground', data: { id, action, data } }, '*');
  });
}

function safeStorage(op, ...args) {
  try {
    if (op === 'get') return chrome.storage.local.get(...args).catch(() => ({}));
    return chrome.storage.local[op](...args).catch(() => {});
  } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); }
}

// 请求历史记录（最近20条）
let requestHistory = [];
// 环境变量
let envVars = {};
const MAX_HISTORY = 20;

const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

document.addEventListener('DOMContentLoaded', () => {
  // Tab切换
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('tab--active'));
      tabContents.forEach(c => c.classList.remove('tab-content--active'));
      tab.classList.add('tab--active');
      document.getElementById(tab.dataset.tab + '-tab').classList.add('tab-content--active');
    });
  });

  // 响应区域 Tab 切换
  document.querySelectorAll('.resp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.resp-tab').forEach(t => t.classList.remove('resp-tab--active'));
      document.querySelectorAll('.resp-tab-content').forEach(c => c.classList.remove('resp-tab-content--active'));
      tab.classList.add('resp-tab--active');
      document.getElementById('resp-tab-' + tab.dataset.respTab).classList.add('resp-tab-content--active');
    });
  });

  elements.btnSend.addEventListener('click', sendRequest);

  // URL输入框Enter发送
  elements.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendRequest(); }
  });

  // 复制为cURL
  if (elements.btnCurl) {
    elements.btnCurl.addEventListener('click', copyAsCurl);
  }

  // 切换到环境变量Tab
  if (elements.btnEnv) {
    elements.btnEnv.addEventListener('click', () => {
      const envTab = document.querySelector('.tab[data-tab="env"]');
      if (envTab) envTab.click();
    });
  }

  // 添加环境变量
  if (elements.btnAddEnv) {
    elements.btnAddEnv.addEventListener('click', addEnvVar);
  }

  // 清空历史
  if (elements.btnClearHistory) {
    elements.btnClearHistory.addEventListener('click', clearHistory);
  }

  // 快捷请求头按钮
  if (elements.quickHeaders) {
    elements.quickHeaders.addEventListener('click', (e) => {
      const btn = e.target.closest('.quick-header-btn');
      if (!btn) return;
      const headerKey = btn.dataset.header;
      const headerValue = btn.dataset.value;
      let headers = {};
      try {
        const text = elements.headersInput.value.trim();
        if (text) headers = JSON.parse(text);
      } catch (ex) {
        headers = {};
      }
      if (headers[headerKey] === headerValue) {
        delete headers[headerKey];
      } else {
        headers[headerKey] = headerValue;
      }
      elements.headersInput.value = JSON.stringify(headers, null, 2);
      btn.classList.toggle('active', headers[headerKey] === headerValue);
    });
  }

  // 响应格式化按钮
  if (elements.btnFormatJson) elements.btnFormatJson.addEventListener('click', () => formatResponseBody('json'));
  if (elements.btnFormatHtml) elements.btnFormatHtml.addEventListener('click', () => formatResponseBody('html'));
  if (elements.btnFormatText) elements.btnFormatText.addEventListener('click', () => formatResponseBody('text'));
  // 复制响应体
  if (elements.btnCopyBody) {
    elements.btnCopyBody.addEventListener('click', () => {
      const text = elements.responseBody.textContent;
      if (text) {
        navigator.clipboard.writeText(text).then(() => showToast('已复制响应体', 'success')).catch(() => showToast('复制失败', 'error'));
      }
    });
  }

  loadSavedData();
  loadHistory();
  loadEnvVars();
  updateEnvTip();
});

// 应用环境变量：将 {{varName}} 替换为 envVars[varName]
function applyEnvVars(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/\{\{\s*([a-zA-Z_][\w-]*)\s*\}\}/g, (match, key) => {
    return envVars.hasOwnProperty(key) ? envVars[key] : match;
  });
}

// 更新环境变量提示
function updateEnvTip() {
  if (!elements.envVarsTip) return;
  const keys = Object.keys(envVars);
  if (keys.length === 0) {
    elements.envVarsTip.style.display = 'none';
  } else {
    elements.envVarsTip.style.display = 'inline-block';
    elements.envVarsTip.textContent = `✓ ${keys.length}个变量: ${keys.slice(0, 5).map(k => '{{' + k + '}}').join(', ')}${keys.length > 5 ? '...' : ''}`;
  }
}

// 环境变量管理
function addEnvVar() {
  const key = prompt('变量名（英文）:', 'baseUrl');
  if (!key) return;
  if (!/^[a-zA-Z_][\w-]*$/.test(key)) {
    showToast('变量名只能包含字母、数字、下划线', 'error');
    return;
  }
  const value = prompt('变量值:', 'https://api.example.com');
  if (value === null) return;
  envVars[key] = value;
  renderEnvVars();
  saveEnvVars();
  updateEnvTip();
  showToast(`变量 ${key} 已添加`, 'success');
}

function renderEnvVars() {
  if (!elements.envList) return;
  const keys = Object.keys(envVars);
  if (keys.length === 0) {
    elements.envList.innerHTML = '<div class="env-empty">暂无环境变量，点击"新增变量"添加</div>';
    return;
  }
  elements.envList.innerHTML = keys.map(k => `
    <div class="env-item" data-key="${escapeHtml(k)}">
      <input class="env-item-key" value="${escapeHtml(k)}" data-orig-key="${escapeHtml(k)}" title="变量名">
      <input class="env-item-value" value="${escapeHtml(envVars[k])}" title="变量值">
      <button class="env-item-del" title="删除">✕</button>
    </div>
  `).join('');
  // 绑定事件
  elements.envList.querySelectorAll('.env-item').forEach(item => {
    const keyInput = item.querySelector('.env-item-key');
    const valInput = item.querySelector('.env-item-value');
    const delBtn = item.querySelector('.env-item-del');
    const origKey = keyInput.dataset.origKey;
    keyInput.addEventListener('change', () => {
      const newKey = keyInput.value.trim();
      if (!/^[a-zA-Z_][\w-]*$/.test(newKey)) {
        showToast('变量名只能包含字母、数字、下划线', 'error');
        keyInput.value = origKey;
        return;
      }
      if (newKey !== origKey && envVars.hasOwnProperty(newKey)) {
        showToast('变量名已存在', 'error');
        keyInput.value = origKey;
        return;
      }
      const val = envVars[origKey];
      delete envVars[origKey];
      envVars[newKey] = val;
      keyInput.dataset.origKey = newKey;
      saveEnvVars();
      updateEnvTip();
    });
    valInput.addEventListener('change', () => {
      envVars[keyInput.dataset.origKey] = valInput.value;
      saveEnvVars();
    });
    delBtn.addEventListener('click', () => {
      delete envVars[keyInput.dataset.origKey];
      renderEnvVars();
      saveEnvVars();
      updateEnvTip();
    });
  });
}

async function saveEnvVars() {
  try { await safeStorage('set', { http_tester_env: envVars }); } catch(e) {}
}

async function loadEnvVars() {
  try {
    const data = await safeStorage('get', 'http_tester_env');
    if (data && data.http_tester_env) {
      envVars = data.http_tester_env;
      renderEnvVars();
      updateEnvTip();
    }
  } catch(e) {}
}

// 复制为cURL命令
function copyAsCurl() {
  const rawUrl = elements.urlInput.value.trim();
  if (!rawUrl) { showToast('请输入URL', 'error'); return; }
  const url = applyEnvVars(rawUrl);
  const method = elements.methodSelect.value;

  // 解析headers
  let headers = {};
  try {
    const headersText = elements.headersInput.value.trim();
    if (headersText) headers = JSON.parse(applyEnvVars(headersText));
  } catch (e) {
    showToast('Headers格式错误', 'error');
    return;
  }

  let body = null;
  if (method !== 'GET' && method !== 'HEAD') {
    body = applyEnvVars(elements.bodyInput.value);
  }

  // 构建cURL命令
  let curl = `curl -X ${method}`;
  for (const [k, v] of Object.entries(headers)) {
    curl += ` \\\n  -H '${k}: ${v}'`;
  }
  if (body) {
    curl += ` \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
  }
  curl += ` \\\n  '${url}'`;

  navigator.clipboard.writeText(curl).then(() => {
    showToast('cURL命令已复制到剪贴板', 'success');
  }).catch(() => {
    showToast('复制失败', 'error');
  });
}

async function sendRequest() {
  const rawUrl = elements.urlInput.value.trim();
  if (!rawUrl) { showToast('请输入URL', 'error'); return; }

  // 应用环境变量
  const url = applyEnvVars(rawUrl);
  const method = elements.methodSelect.value;
  let headers = {};
  let body = null;

  try {
    const headersText = elements.headersInput.value.trim();
    if (headersText) headers = JSON.parse(applyEnvVars(headersText));
  } catch (e) {
    showToast('Headers格式错误', 'error');
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    body = applyEnvVars(elements.bodyInput.value);
  }

  elements.responseStatus.textContent = '⏳ 请求中...';
  elements.responseStatus.className = 'response-status';
  elements.responseTime.textContent = '';
  if (elements.responseSize) elements.responseSize.textContent = '';
  elements.responseBody.textContent = '';
  if (elements.responseHeaders) elements.responseHeaders.textContent = '响应头将显示在这里';
  if (elements.requestHeadersDisplay) elements.requestHeadersDisplay.textContent = '请求头将显示在这里';
  elements.btnSend.disabled = true;

  // 显示请求头（实际发送的请求头）
  const reqHeaderLines = [
    `${method} ${url}`,
    'User-Agent: (由 background 发送)',
    ...(Object.entries(headers).map(([k, v]) => `${k}: ${v}`))
  ];
  if (body) reqHeaderLines.push(`Content-Length: ${new Blob([body]).size}`);
  if (elements.requestHeadersDisplay) {
    elements.requestHeadersDisplay.textContent = reqHeaderLines.join('\n');
  }

  try {
    // 两种发送方式：
    //   1) 默认：由 background 直接 fetch（最快的路径，支持任意方法与自定义请求头）
    //   2) 通过「HTTP 转发代理」服务类别转发：请求从代理的出口 IP 发出，
    //      适用于目标站点按 IP 做限制、或需要绕过网络策略的场景（可在设置中指向自建代理）
    const useProxy = !!(elements.useProxy && elements.useProxy.checked);
    let result;
    if (useProxy) {
      if (method !== 'GET') {
        showToast('转发代理仅支持 GET，请切换方法或取消勾选', 'error');
        elements.btnSend.disabled = false;
        return;
      }
      const pr = await callBackground('serviceRequest', { kind: 'proxy', params: { url } });
      if (!pr || !pr.success) {
        elements.responseStatus.textContent = '❌ 代理转发失败';
        elements.responseStatus.className = 'response-status response-status--error';
        elements.responseBody.textContent = ((pr && pr.error) || '代理不可用')
          + '\n可在「设置 → 服务端点 → HTTP 转发代理」中更换服务商或指向自建代理';
        elements.btnSend.disabled = false;
        return;
      }
      const proxyBody = (pr.data && pr.data.body) || '';
      result = {
        success: true,
        status: (pr.data && pr.data.status) || 0,
        statusText: '',
        headers: (pr.data && pr.data.headers) || {},
        body: proxyBody,
        duration: (pr.meta && pr.meta.duration) || 0,
        finalUrl: (pr.data && pr.data.finalUrl) || url,
        bodySize: new Blob([proxyBody]).size
      };
    } else {
      // 通过 background 代理发送请求，绕过 CORS 限制
      result = await callBackground('fetchUrl', { url, method, headers, body, timeout: 30000 });
    }

    if (!result || !result.success) {
      elements.responseStatus.textContent = '❌ 请求失败';
      elements.responseStatus.className = 'response-status response-status--error';
      elements.responseTime.textContent = result ? `${result.duration}ms` : '';
      elements.responseBody.textContent = (result && result.error) ? result.error : '请求失败，请检查URL或网络';
      elements.btnSend.disabled = false;
      return;
    }

    const duration = result.duration;
    const responseText = result.body || '';
    const bodySize = result.bodySize || new Blob([responseText]).size;
    const sizeStr = bodySize < 1024 ? bodySize + ' B' : bodySize < 1024*1024 ? (bodySize/1024).toFixed(1) + ' KB' : (bodySize/1024/1024).toFixed(2) + ' MB';
    if (elements.responseSize) elements.responseSize.textContent = sizeStr;

    // 显示响应头
    if (elements.responseHeaders) {
      elements.responseHeaders.textContent = result.rawHeaders || '(无响应头)';
    }

    // 自动判断并格式化响应体
    renderResponseBody(responseText, result.headers || {}, result.status);

    elements.responseStatus.textContent = `${result.status} ${result.statusText}`;
    elements.responseStatus.className = 'response-status ' + (result.ok ? 'response-status--success' : 'response-status--error');
    elements.responseTime.textContent = `${duration}ms`;

    // 保存到历史（包含完整信息以便重发）
    addToHistory({
      url: rawUrl,
      method,
      status: result.status,
      time: duration,
      size: bodySize,
      headers: elements.headersInput.value,
      body: elements.bodyInput.value,
      timestamp: Date.now()
    });
    saveToHistory(rawUrl, method);
  } catch (error) {
    elements.responseStatus.textContent = '❌ 请求失败';
    elements.responseStatus.className = 'response-status response-status--error';
    elements.responseBody.textContent = error.message;
  } finally {
    elements.btnSend.disabled = false;
  }
}

// 渲染响应体：自动判断 JSON / HTML / 文本
function renderResponseBody(text, headers, status) {
  if (!text) {
    elements.responseBody.textContent = '(空响应体)';
    return;
  }
  const contentType = (headers['content-type'] || headers['Content-Type'] || '').toLowerCase();
  // 尝试 JSON 格式化
  try {
    const json = JSON.parse(text);
    const pretty = JSON.stringify(json, null, 2);
    elements.responseBody.innerHTML = highlightJson(pretty);
    return;
  } catch (e) {}
  // HTML 高亮预览（仅渲染文本，不执行脚本）
  if (contentType.includes('html') || /^\s*<!doctype|<html/i.test(text)) {
    elements.responseBody.textContent = text;
    return;
  }
  // 纯文本
  elements.responseBody.textContent = text;
}

// 手动切换响应体格式
function formatResponseBody(mode) {
  const text = elements.responseBody.textContent;
  if (!text || text === '响应内容将显示在这里') return;
  if (mode === 'json') {
    try {
      const json = JSON.parse(text);
      elements.responseBody.innerHTML = highlightJson(JSON.stringify(json, null, 2));
      showToast('已格式化为 JSON', 'success');
    } catch (e) {
      showToast('不是有效的 JSON', 'error');
    }
  } else if (mode === 'html') {
    // 在新窗口预览 HTML
    const preview = window.open('', '_blank');
    if (preview) {
      preview.document.write(text);
      preview.document.close();
      showToast('已在新窗口预览 HTML', 'success');
    } else {
      showToast('弹窗被拦截，请允许弹窗', 'error');
    }
  } else if (mode === 'text') {
    elements.responseBody.textContent = text;
    showToast('已切换为纯文本', 'success');
  }
}

// JSON 语法高亮
function highlightJson(jsonStr) {
  const escaped = escapeHtml(jsonStr);
  return escaped.replace(
    /("(\\.|[^"\\])*")(\s*:)|(\b-?\d+\.?\d*([eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)/g,
    (m, key, _innerStr, _colon, num, _exp, bool, nul) => {
      if (key) return `<span class="json-key">${key}</span>:`;
      if (num) return `<span class="json-number">${num}</span>`;
      if (bool) return `<span class="json-bool">${bool}</span>`;
      if (nul) return `<span class="json-null">${nul}</span>`;
      return `<span class="json-string">${m}</span>`;
    }
  );
}

function showToast(msg, type = 'info') {
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(() => elements.toast.classList.remove('toast--show'), 3000);
}

function addToHistory(record) {
  // 去重（同 method + url）
  requestHistory = requestHistory.filter(h => !(h.url === record.url && h.method === record.method));
  requestHistory.unshift(record);
  if (requestHistory.length > MAX_HISTORY) requestHistory = requestHistory.slice(0, MAX_HISTORY);
  renderHistory();
  try { safeStorage('set', { http_tester_history: requestHistory }); } catch(e) {}
}

function renderHistory() {
  if (!elements.historyList) return;
  if (requestHistory.length === 0) {
    elements.historyList.innerHTML = '<div class="history-empty">暂无请求历史</div>';
    return;
  }
  elements.historyList.innerHTML = requestHistory.map((h, i) => {
    const statusClass = h.status < 400 ? 'history-status--ok' : 'history-status--err';
    const timeStr = new Date(h.timestamp).toLocaleTimeString();
    const sizeStr = h.size != null ? (h.size < 1024 ? h.size + 'B' : (h.size/1024).toFixed(1) + 'KB') : '--';
    return `<div class="history-item" data-idx="${i}">
      <span class="history-method">${escapeHtml(h.method)}</span>
      <span class="history-url" title="${escapeHtml(h.url)}">${escapeHtml(h.url.length > 50 ? h.url.substring(0, 50) + '...' : h.url)}</span>
      <span class="history-status ${statusClass}">${h.status}</span>
      <span class="history-time">${h.time}ms</span>
      <span class="history-time">${sizeStr}</span>
      <span class="history-date">${timeStr}</span>
      <span class="history-actions">
        <button class="history-resend" data-idx="${i}" title="重发">🔄</button>
        <button class="history-del" data-idx="${i}" title="删除">✕</button>
      </span>
    </div>`;
  }).join('');
  // 点击行加载到表单
  elements.historyList.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.history-resend') || e.target.closest('.history-del')) return;
      const idx = parseInt(item.dataset.idx, 10);
      const h = requestHistory[idx];
      if (h) {
        elements.urlInput.value = h.url;
        elements.methodSelect.value = h.method;
        if (h.headers) elements.headersInput.value = h.headers;
        if (h.body) elements.bodyInput.value = h.body;
      }
    });
  });
  // 重发按钮
  elements.historyList.querySelectorAll('.history-resend').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      const h = requestHistory[idx];
      if (h) {
        elements.urlInput.value = h.url;
        elements.methodSelect.value = h.method;
        if (h.headers) elements.headersInput.value = h.headers;
        if (h.body) elements.bodyInput.value = h.body;
        sendRequest();
      }
    });
  });
  // 删除按钮
  elements.historyList.querySelectorAll('.history-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      requestHistory.splice(idx, 1);
      renderHistory();
      try { safeStorage('set', { http_tester_history: requestHistory }); } catch(e) {}
    });
  });
}

function clearHistory() {
  if (requestHistory.length === 0) return;
  if (!confirm('确定清空所有请求历史？')) return;
  requestHistory = [];
  renderHistory();
  try { safeStorage('set', { http_tester_history: requestHistory }); } catch(e) {}
  showToast('历史已清空', 'success');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function loadHistory() {
  try {
    const data = await safeStorage('get', 'http_tester_history');
    if (data && data.http_tester_history) {
      requestHistory = data.http_tester_history;
      renderHistory();
    }
  } catch(e) {}
}

async function saveToHistory(url, method) {
  try {
    await callBackground('saveToHistory', { toolId: 'http-tester', type: method, data: { url, method } });
  } catch (e) {}
}

async function loadSavedData() {
  try {
    const res = await callBackground('getToolData', { toolId: 'http-tester' });
    if (res) {
      if (res.url) elements.urlInput.value = res.url;
      if (res.headers) elements.headersInput.value = res.headers;
    }
  } catch (e) {}
}
  // 主题切换消息监听
  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
    // 也处理 setData 消息（从 sidebar 传入参数）
    if (event.data && event.data.action === 'setData') {
      const inputArea = document.getElementById('url-input');
      if (inputArea && typeof event.data.data === 'string') {
        inputArea.value = event.data.data;
        inputArea.dispatchEvent(new Event('input'));
      }
    }
  });
