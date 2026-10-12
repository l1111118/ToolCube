/**
 * 剪贴板历史 - 在工具 iframe 内直接读取剪贴板
 */
(function(){
'use strict';
const MAX_ITEMS = 200;
let history = []; // {text, ts, id, type, pinned}
let recording = false;
let pollTimer = null;
let lastClipboardText = '';
const $list = document.getElementById('ch-list');
const $stats = document.getElementById('ch-stats');
const $search = document.getElementById('ch-search');
const $type = document.getElementById('ch-type');

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
// ============ Toast 提示（本工具内部实现，避免依赖外部） ============
let toastTimer = null;
function showToast(msg, type) {
  let toast = document.getElementById('ch-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ch-toast';
    toast.className = 'ch-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'ch-toast ch-toast--' + (type || 'info') + ' ch-toast--show';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('ch-toast--show');
  }, 2000);
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function classify(text) {
  if (!text) return 'text';
  const t = text.trim();
  if (/^https?:\/\//i.test(t)) return 'url';
  if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return 'email';
  if (/^(function|const|let|var|if|for|while|class|import|export|return|def|public|private|static)/m.test(t) || /[{};]/.test(t)) return 'code';
  return 'text';
}
function ago(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return Math.floor(diff/1000) + 's 前';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm 前';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h 前';
  return Math.floor(diff/86400000) + 'd 前';
}

async function load() {
  const r = await safeSend({ action: 'getToolData', data: { toolId: 'clipboard-history' } });
  if (r && r.history) history = r.history;
  render();
}

async function save() {
  await safeSend({ action: 'saveToolData', data: { toolId: 'clipboard-history', data: { history } } });
}

function addItem(text) {
  if (!text) return;
  // 去重（忽略固定项）
  if (history.length && history[0].text === text && !history[0].pinned) return;
  const item = { text, ts: Date.now(), id: Date.now() + Math.random().toString(36).slice(2,6), type: classify(text), pinned: false };
  // 插入到第一个非固定项之前
  const firstUnpinned = history.findIndex(x => !x.pinned);
  if (firstUnpinned === -1) history.push(item);
  else history.splice(firstUnpinned, 0, item);
  if (history.length > MAX_ITEMS) history = history.slice(0, MAX_ITEMS);
  save();
  render();
}

function render() {
  const q = ($search.value || '').toLowerCase().trim();
  const type = $type.value;
  let list = history.slice();
  if (type !== 'all') list = list.filter(x => x.type === type);
  if (q) list = list.filter(x => (x.text || '').toLowerCase().includes(q));
  $stats.className = 'ch-stats' + (recording ? ' ch-stats--recording' : '');
  $stats.innerHTML = `<span>${recording ? '🔴 正在监听' : '⏸ 已停止'} · 共 ${history.length} 条${q || type !== 'all' ? ` · 匹配 ${list.length}` : ''}</span><span>保留最近 ${MAX_ITEMS} 条</span>`;
  if (!list.length) {
    $list.innerHTML = '<div class="ch-empty">📋 剪贴板历史为空</div>';
    return;
  }
  $list.innerHTML = list.map(it => {
    const preview = it.text.length > 500 ? it.text.substring(0, 500) + '...' : it.text;
    return `
    <div class="ch-item ${it.pinned ? 'ch-item--pinned' : ''}" data-id="${it.id}">
      <div class="ch-item-head">
        <span class="ch-item-type">${it.type}</span>
        <span class="ch-item-time">${it.pinned ? '📌 固定' : ago(it.ts)}</span>
      </div>
      <div class="ch-item-content" data-text="${escapeHtml(it.text)}">${escapeHtml(preview)}</div>
      <div class="ch-item-actions">
        <button class="btn btn--secondary btn--sm ch-copy">📋 复制</button>
        <button class="btn btn--primary btn--sm ch-paste">↩ 写回剪贴板</button>
        <button class="btn btn--secondary btn--sm ch-pin">${it.pinned ? '🔓 取消固定' : '📌 固定'}</button>
        <button class="btn btn--danger btn--sm ch-del">🗑️</button>
      </div>
    </div>
  `;
  }).join('');
  $list.querySelectorAll('.ch-item').forEach(row => {
    const id = row.dataset.id;
    const it = history.find(x => x.id === id);
    if (!it) return;
    row.querySelector('.ch-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(it.text); showToast('已复制到剪贴板'); } catch (e) { showToast('复制失败: ' + e.message); } });
    row.querySelector('.ch-paste').addEventListener('click', async () => { try { await navigator.clipboard.writeText(it.text); showToast('已写回剪贴板'); } catch (e) { showToast('写回失败: ' + e.message); } });
    row.querySelector('.ch-pin').addEventListener('click', () => { it.pinned = !it.pinned; it.ts = Date.now(); save(); render(); });
    row.querySelector('.ch-del').addEventListener('click', () => {
      history = history.filter(x => x.id !== id);
      save(); render();
    });
    row.querySelector('.ch-item-content').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(it.text); showToast('已复制到剪贴板'); } catch (e) { showToast('复制失败: ' + e.message); }
    });
  });
}

/**
 * 确保已获得剪贴板读取权限。
 *
 * `clipboardRead` 声明在 optional_permissions 中，默认**未授予**；
 * 不申请就直接调用 readText 会抛 NotAllowedError，监听随即被停止 ——
 * 这正是旧实现"点了开始却一条也记录不到"的根因（看似有效实则无效）。
 *
 * 权限申请必须在用户手势（点击）回调中发起，因此这里优先在工具页内
 * 直接调用 chrome.permissions.request；若该环境不支持，再退回后台代申请。
 */
async function ensureClipboardPermission() {
  try {
    if (chrome.permissions && chrome.permissions.contains) {
      const has = await chrome.permissions.contains({ permissions: ['clipboardRead'] });
      if (has) return true;
    }
  } catch (e) { /* 查询失败时继续尝试申请 */ }

  try {
    if (chrome.permissions && chrome.permissions.request) {
      const granted = await chrome.permissions.request({ permissions: ['clipboardRead'] });
      if (granted) return true;
    }
  } catch (e) { /* 本页无法申请时退回后台 */ }

  try {
    const r = await safeSend({ action: 'requestOptionalPermissions', data: { permissions: ['clipboardRead'] } });
    return !!(r && r.granted);
  } catch (e) {
    return false;
  }
}

async function readClipboardOnce() {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    showToast('剪贴板 API 不可用，请使用 HTTPS 或扩展环境', 'error');
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (text && text !== lastClipboardText) {
      lastClipboardText = text;
      addItem(text);
    }
  } catch (e) {
    // 权限被拒绝或其他错误
    if (recording) {
      // 监听中遇到错误：停止监听并提示
      stopRecording();
      const msg = e.name === 'NotAllowedError'
        ? '剪贴板读取被拒绝：请确认已授权，并让本侧边栏保持焦点（浏览器要求读取时页面处于激活状态）'
        : '读取剪贴板失败: ' + (e.message || e.name);
      showToast(msg, 'error');
    }
  }
}

function startRecording() {
  recording = true;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(readClipboardOnce, 1200);
  render();
}

function stopRecording() {
  recording = false;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  render();
}

document.getElementById('btn-start').addEventListener('click', async () => {
  // 先拿到权限再开始轮询，否则第一轮 readText 就会失败并立即停止监听
  const granted = await ensureClipboardPermission();
  if (!granted) {
    showToast('未获得剪贴板读取权限，无法记录剪贴板', 'error');
    return;
  }
  readClipboardOnce();
  startRecording();
});
document.getElementById('btn-stop').addEventListener('click', stopRecording);
$search.addEventListener('input', render);
$type.addEventListener('change', render);
document.getElementById('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ history, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'clipboard-history-' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-') + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});
document.getElementById('btn-clear').addEventListener('click', () => {
  if (!confirm('清空所有剪贴板历史?')) return;
  history = []; save(); render();
});

window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data && e.data.action === 'setTheme' && e.data.data) document.documentElement.setAttribute('data-theme', e.data.data.theme);
});

load();
})();
