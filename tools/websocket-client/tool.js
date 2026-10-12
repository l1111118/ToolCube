/**
 * WebSocket客户端
 */
const elements = {
  wsUrl: document.getElementById('ws-url'),
  btnConnect: document.getElementById('btn-connect'),
  btnDisconnect: document.getElementById('btn-disconnect'),
  btnSend: document.getElementById('btn-send'),
  btnClear: document.getElementById('btn-clear'),
  connectionStatus: document.getElementById('connection-status'),
  statusLight: document.getElementById('status-light'),
  msgCounter: document.getElementById('msg-counter'),
  messagesList: document.getElementById('messages-list'),
  messageInput: document.getElementById('message-input'),
  toast: document.getElementById('toast'),
  autoReconnect: document.getElementById('auto-reconnect'),
  autoFormat: document.getElementById('auto-format'),
  saveHistory: document.getElementById('save-history'),
  templateList: document.getElementById('template-list'),
  btnAddTemplate: document.getElementById('btn-add-template'),
  heartbeat: document.getElementById('heartbeat'),
  heartbeatInterval: document.getElementById('heartbeat-interval'),
  heartbeatMsg: document.getElementById('heartbeat-msg')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

let ws = null;
let autoReconnectEnabled = false;
let autoFormatEnabled = true;
let saveHistoryEnabled = false;
let heartbeatEnabled = false;
let heartbeatTimer = null;
let lastPongTime = 0;
let lastPingTime = 0;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_MESSAGES = 100;
let messageTemplates = [];
let wsUrlForReconnect = '';
// 消息历史（最多100条，用于持久化和重渲染）
let messageHistory = [];

document.addEventListener('DOMContentLoaded', () => {
  elements.btnConnect.addEventListener('click', connect);
  elements.btnDisconnect.addEventListener('click', disconnect);
  elements.btnSend.addEventListener('click', sendMessage);
  elements.btnClear.addEventListener('click', () => {
    messageHistory = [];
    elements.messagesList.innerHTML = '';
    updateMsgCounter();
    if (saveHistoryEnabled) saveMessageHistory();
  });

  // 消息输入框 Enter+Ctrl 发送
  elements.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 自动重连选项
  if (elements.autoReconnect) {
    elements.autoReconnect.addEventListener('change', () => {
      autoReconnectEnabled = elements.autoReconnect.checked;
    });
  }

  // JSON 格式化选项
  if (elements.autoFormat) {
    elements.autoFormat.addEventListener('change', () => {
      autoFormatEnabled = elements.autoFormat.checked;
      // 重新渲染所有消息
      rerenderAllMessages();
    });
  }

  // 保存历史选项
  if (elements.saveHistory) {
    elements.saveHistory.addEventListener('change', () => {
      saveHistoryEnabled = elements.saveHistory.checked;
      if (saveHistoryEnabled) saveMessageHistory();
      else clearSavedMessageHistory();
    });
  }

  // 心跳检测选项
  if (elements.heartbeat) {
    elements.heartbeat.addEventListener('change', () => {
      heartbeatEnabled = elements.heartbeat.checked;
      if (heartbeatEnabled && ws && ws.readyState === WebSocket.OPEN) {
        startHeartbeat();
      } else {
        stopHeartbeat();
      }
    });
  }

  // 添加消息模板
  if (elements.btnAddTemplate) {
    elements.btnAddTemplate.addEventListener('click', addTemplate);
  }

  loadSavedData();
  loadTemplates();
  loadMessageHistorySettings();
});

function connect() {
  const url = elements.wsUrl.value.trim();
  if (!url) { showToast('请输入WebSocket地址', 'error'); return; }

  wsUrlForReconnect = url;
  reconnectAttempts = 0;
  doConnect(url);
}

function doConnect(url) {
  try {
    updateStatus('⏳ 连接中...', 'connecting');
    ws = new WebSocket(url);

    // 连接超时检测
    const connectTimeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.CONNECTING) {
        ws.close();
        updateStatus('⏱️ 连接超时', 'error');
        showToast('连接超时（10秒）', 'error');
        tryAutoReconnect();
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectTimeout);
      reconnectAttempts = 0;
      updateStatus('🟢 已连接', 'connected');
      elements.btnConnect.disabled = true;
      elements.btnDisconnect.disabled = false;
      elements.btnSend.disabled = false;
      showToast('连接成功', 'success');
      // 启动心跳
      if (heartbeatEnabled) startHeartbeat();
    };

    ws.onmessage = (event) => {
      // 检测心跳回复（pong）
      if (heartbeatEnabled && lastPingTime > 0) {
        lastPongTime = Date.now();
        const latency = lastPongTime - lastPingTime;
        // 不在消息区显示心跳回复，仅更新状态
      }
      addMessage(event.data, 'received');
    };

    ws.onerror = (error) => {
      clearTimeout(connectTimeout);
      updateStatus('🔴 错误', 'error');
      showToast('连接错误', 'error');
    };

    ws.onclose = (event) => {
      clearTimeout(connectTimeout);
      stopHeartbeat();
      updateStatus('⚪ 已断开', 'disconnected');
      elements.btnConnect.disabled = false;
      elements.btnDisconnect.disabled = true;
      elements.btnSend.disabled = true;
      addMessage(`连接已关闭 (code: ${event.code}, reason: ${event.reason || '无'})`, 'system');
      ws = null;
      tryAutoReconnect();
    };
  } catch (e) {
    updateStatus('🔴 连接失败', 'error');
    showToast('连接失败: ' + e.message, 'error');
  }
}

function tryAutoReconnect() {
  if (!autoReconnectEnabled || !wsUrlForReconnect) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    showToast(`自动重连已达到最大次数(${MAX_RECONNECT_ATTEMPTS})`, 'error');
    return;
  }
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
  addMessage(`⏳ 将在 ${(delay/1000).toFixed(0)}s 后尝试第 ${reconnectAttempts} 次重连...`, 'system');
  setTimeout(() => {
    if (autoReconnectEnabled && !ws) {
      doConnect(wsUrlForReconnect);
    }
  }, delay);
}

function disconnect() {
  autoReconnectEnabled = false;
  if (elements.autoReconnect) elements.autoReconnect.checked = false;
  stopHeartbeat();
  if (ws) {
    ws.close();
  }
}

// 启动心跳检测：定期发送 ping 消息，若连续无回复则断开重连
function startHeartbeat() {
  stopHeartbeat();
  const interval = Math.max(5, Math.min(300, parseInt(elements.heartbeatInterval?.value || '30', 10))) * 1000;
  const pingMsg = elements.heartbeatMsg?.value || 'ping';
  lastPongTime = Date.now();
  heartbeatTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      stopHeartbeat();
      return;
    }
    // 检查上次 pong 是否超时（超过 2 个间隔未收到回复）
    if (lastPingTime > 0 && lastPongTime < lastPingTime && (Date.now() - lastPingTime) > interval * 2) {
      addMessage('💔 心跳超时，连接可能已断开，尝试重连...', 'system');
      try { ws.close(); } catch(e) {}
      return;
    }
    lastPingTime = Date.now();
    try {
      ws.send(pingMsg);
    } catch (e) {
      stopHeartbeat();
    }
  }, interval);
  addMessage(`💓 心跳已启动 (间隔 ${interval / 1000}s, 消息: ${pingMsg})`, 'system');
}

// 停止心跳检测
function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    lastPingTime = 0;
  }
}

function sendMessage() {
  const message = elements.messageInput.value.trim();
  if (!message) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('未连接', 'error');
    return;
  }

  ws.send(message);
  addMessage(message, 'sent');
  elements.messageInput.value = '';
}

function addMessage(text, type) {
  // 转换 Blob 为文本（WebSocket 二进制消息）
  if (text instanceof Blob) {
    text.text().then(str => addMessage(str, type));
    return;
  }
  text = String(text);
  // 保存到历史
  const record = { text, type, timestamp: Date.now() };
  messageHistory.push(record);
  if (messageHistory.length > MAX_MESSAGES) messageHistory.shift();
  updateMsgCounter();
  if (saveHistoryEnabled) saveMessageHistory();

  appendMessageDom(record, true);
}

// 把消息记录渲染为 DOM 追加到列表
function appendMessageDom(record, scrollIntoView) {
  const div = document.createElement('div');
  div.className = `message-item message-item--${record.type}`;
  const dt = new Date(record.timestamp);
  const time = dt.toLocaleTimeString() + '.' + String(dt.getMilliseconds()).padStart(3, '0');
  const textHtml = renderMessageText(record.text);
  // 为接收/发送消息添加操作按钮
  let actionsHtml = '';
  if (record.type === 'sent' || record.type === 'received') {
    actionsHtml = `<div class="message-actions">
      <button class="message-action-btn" data-act="copy">📋 复制</button>
      <button class="message-action-btn" data-act="reuse">↩️ 填入输入框</button>
    </div>`;
  }
  div.innerHTML = `
    <div class="message-time">${time}</div>
    ${textHtml}
    ${actionsHtml}
  `;
  // 绑定操作按钮
  div.querySelectorAll('.message-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'copy') {
        navigator.clipboard.writeText(record.text).catch(()=>{});
        showToast('已复制', 'success');
      } else if (act === 'reuse') {
        elements.messageInput.value = record.text;
        elements.messageInput.focus();
      }
    });
  });
  elements.messagesList.appendChild(div);
  if (scrollIntoView) {
    elements.messagesList.scrollTop = elements.messagesList.scrollHeight;
  }
}

// 渲染消息文本：自动尝试 JSON 格式化
function renderMessageText(text) {
  if (autoFormatEnabled) {
    const formatted = tryFormatJson(text);
    if (formatted !== null) {
      return `<div class="message-text-json">${formatted}</div>`;
    }
  }
  return `<div class="message-text">${escapeHtml(text)}</div>`;
}

// 尝试格式化 JSON，返回 HTML 字符串或 null
function tryFormatJson(text) {
  try {
    const obj = JSON.parse(text);
    const pretty = JSON.stringify(obj, null, 2);
    // 正则捕获组顺序：
    // g1: 引号字符串（键），g2: 字符串内部最后字符（忽略），
    // g3: 冒号部分（忽略），g4: 数字，g5: 指数部分（忽略），
    // g6: 布尔值，g7: null
    return escapeHtml(pretty).replace(
      /("(\\.|[^"\\])*")(\s*:)|(\b-?\d+\.?\d*([eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b)|(\bnull\b)/g,
      (m, key, _innerStr, _colon, num, _exp, bool, nul) => {
        if (key) return `<span class="json-key">${key}</span>:`;
        if (num) return `<span class="json-number">${num}</span>`;
        if (bool) return `<span class="json-bool">${bool}</span>`;
        if (nul) return `<span class="json-null">${nul}</span>`;
        // 字符串值
        return `<span class="json-string">${m}</span>`;
      }
    );
  } catch (e) {
    return null;
  }
}

// 重新渲染所有消息（用于切换 JSON 格式化开关）
function rerenderAllMessages() {
  elements.messagesList.innerHTML = '';
  messageHistory.forEach(record => appendMessageDom(record, false));
  elements.messagesList.scrollTop = elements.messagesList.scrollHeight;
}

function updateMsgCounter() {
  if (elements.msgCounter) {
    elements.msgCounter.textContent = `(${messageHistory.length}/${MAX_MESSAGES})`;
  }
}

// 消息历史持久化（localStorage，避免 chrome.storage 配额问题）
function saveMessageHistory() {
  try {
    localStorage.setItem('ws_client_messages', JSON.stringify(messageHistory));
    localStorage.setItem('ws_client_save_history', '1');
  } catch(e) {}
}

function clearSavedMessageHistory() {
  try {
    localStorage.removeItem('ws_client_messages');
    localStorage.setItem('ws_client_save_history', '0');
  } catch(e) {}
}

function loadMessageHistorySettings() {
  try {
    const flag = localStorage.getItem('ws_client_save_history');
    if (flag === '1') {
      saveHistoryEnabled = true;
      if (elements.saveHistory) elements.saveHistory.checked = true;
      const saved = localStorage.getItem('ws_client_messages');
      if (saved) {
        messageHistory = JSON.parse(saved);
        rerenderAllMessages();
        updateMsgCounter();
      }
    }
  } catch(e) {}
}

function updateStatus(text, className) {
  elements.connectionStatus.textContent = text;
  elements.connectionStatus.className = 'status' + (className ? ' status--' + className : '');
  // 同步状态指示灯
  if (elements.statusLight) {
    elements.statusLight.className = 'status-light' + (className ? ' status-light--' + className : '');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(msg, type = 'info') {
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(() => elements.toast.classList.remove('toast--show'), 3000);
}

function addTemplate() {
  const msg = elements.messageInput.value.trim();
  if (!msg) { showToast('请先输入消息内容', 'error'); return; }
  const name = prompt('模板名称:', msg.substring(0, 20));
  if (!name) return;
  messageTemplates.push({ name, content: msg });
  renderTemplates();
  saveTemplates();
  showToast('模板已保存', 'success');
}

function renderTemplates() {
  if (!elements.templateList) return;
  if (messageTemplates.length === 0) {
    elements.templateList.innerHTML = '<div class="template-empty">暂无模板</div>';
    return;
  }
  elements.templateList.innerHTML = messageTemplates.map((t, i) => `
    <div class="template-item" data-idx="${i}">
      <span class="template-name">${escapeHtml(t.name)}</span>
      <button class="template-use" data-idx="${i}" title="使用">📝</button>
      <button class="template-del" data-idx="${i}" title="删除">✕</button>
    </div>
  `).join('');
  elements.templateList.querySelectorAll('.template-use').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      elements.messageInput.value = messageTemplates[idx].content;
    });
  });
  elements.templateList.querySelectorAll('.template-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      messageTemplates.splice(idx, 1);
      renderTemplates();
      saveTemplates();
    });
  });
}

async function saveTemplates() {
  try { await safeStorage('set', { ws_client_templates: messageTemplates }); } catch(e) {}
}

async function loadTemplates() {
  try {
    const data = await safeStorage('get', 'ws_client_templates');
    if (data && data.ws_client_templates) {
      messageTemplates = data.ws_client_templates;
      renderTemplates();
    }
  } catch(e) {}
}

async function loadSavedData() {
  try {
    const res = await safeSend({ action: 'getToolData', data: { toolId: 'websocket-client' } });
    if (res && res.url) elements.wsUrl.value = res.url;
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
      const inputArea = document.getElementById('ws-url');
      if (inputArea && typeof event.data.data === 'string') {
        inputArea.value = event.data.data;
        inputArea.dispatchEvent(new Event('input'));
      }
    }
  });
