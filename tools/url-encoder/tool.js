/**
 * URL编解码工具
 */
const elements = {
  inputArea: document.getElementById('input-area'),
  outputArea: document.getElementById('output-area'),
  btnEncode: document.getElementById('btn-encode'),
  btnDecode: document.getElementById('btn-decode'),
  btnSwap: document.getElementById('btn-swap'),
  btnCopy: document.getElementById('btn-copy'),
  btnPaste: document.getElementById('btn-paste'),
  encodeAll: document.getElementById('encode-all'),
  toast: document.getElementById('toast')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
document.addEventListener('DOMContentLoaded', () => {
  elements.btnEncode.addEventListener('click', encodeURL);
  elements.btnDecode.addEventListener('click', decodeURL);
  elements.btnSwap.addEventListener('click', swapText);
  elements.btnCopy.addEventListener('click', copyOutput);
  elements.btnPaste.addEventListener('click', pasteInput);
  window.addEventListener('message', handleMessage);
  loadSavedData();
});

function encodeURL() {
  const input = elements.inputArea.value;
  if (!input) { showToast('请输入内容', 'error'); return; }
  try {
    const encodeAll = elements.encodeAll.checked;
    const output = encodeAll 
      ? input.split('').map(c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('')
      : encodeURIComponent(input);
    elements.outputArea.value = output;
    showToast('编码成功', 'success');
    saveToHistory(input, 'encode');
  } catch (e) { showToast('编码失败: ' + e.message, 'error'); }
}

function decodeURL() {
  const input = elements.inputArea.value;
  if (!input) { showToast('请输入内容', 'error'); return; }
  try {
    const output = decodeURIComponent(input);
    elements.outputArea.value = output;
    showToast('解码成功', 'success');
    saveToHistory(input, 'decode');
  } catch (e) { showToast('解码失败: 无效的编码', 'error'); }
}

function swapText() {
  const temp = elements.inputArea.value;
  elements.inputArea.value = elements.outputArea.value;
  elements.outputArea.value = temp;
}

async function copyOutput() {
  const text = elements.outputArea.value;
  if (!text) { showToast('没有可复制的内容', 'error'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制', 'success');
  } catch (e) {
    showToast('复制失败', 'error');
  }
}

async function pasteInput() {
  try {
    const text = await navigator.clipboard.readText();
    elements.inputArea.value = text;
  } catch (e) { showToast('无法访问剪贴板', 'error'); }
}

function showToast(msg, type = 'info') {
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(() => elements.toast.classList.remove('toast--show'), 3000);
}

async function saveToHistory(input, action) {
  try {
    await safeSend({
      action: 'saveToHistory',
      data: { toolId: 'url-encoder', type: action, data: { input: input.substring(0, 200), action } }
    });
  } catch (e) {}
}

async function loadSavedData() {
  try {
    const res = await safeSend({ action: 'getToolData', data: { toolId: 'url-encoder' } });
    if (res && res.input) elements.inputArea.value = res.input;
  } catch (e) {}
}

function handleMessage(e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  const { action, data } = e.data;
  if (action === 'setTheme' && data && data.theme) { document.documentElement.setAttribute('data-theme', data.theme); return; }
  if (action === 'setData') {
    if (typeof data === 'object' && data.text) {
      elements.inputArea.value = data.text;
      if (data.action === 'encode') encodeURL();
      else if (data.action === 'decode') decodeURL();
    } else if (typeof data === 'string') {
      elements.inputArea.value = data;
    }
  }
}
