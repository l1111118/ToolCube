/**
 * Tab 管理器
 * 跨窗口列出/搜索/切换/分组/关闭标签
 */
(function(){
'use strict';
let allTabs = [];
let selected = new Set();
const $list = document.getElementById('tm-list');
const $stats = document.getElementById('tm-stats');
const $search = document.getElementById('tm-search');
const $currentWin = document.getElementById('tm-current-window');
const $dupOnly = document.getElementById('tm-dup-only');

function call(action, data) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const handler = (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

      if (!e.data || e.source !== window.parent) return;
      if (e.data && e.data.action === '__bgResponse' && e.data.data && e.data.data.__id === id) {
        window.removeEventListener('message', handler);
        resolve(e.data.data.result);
      }
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ action: 'callBackground', data: { id, action, data } }, '*');
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
}

function findDuplicates(tabs) {
  const map = new Map();
  tabs.forEach(t => {
    if (!t.url) return;
    try {
      const u = new URL(t.url);
      const key = u.origin + u.pathname;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(t);
    } catch (e) {}
  });
  const dup = new Set();
  for (const arr of map.values()) {
    if (arr.length > 1) arr.forEach(t => dup.add(t.id));
  }
  return dup;
}

async function load(clearSelection = true) {
  $stats.innerHTML = '<span>⏳ 加载中...</span>';
  if (clearSelection) selected.clear();
  const r = await call('listTabs', {});
  if (r && r.success) {
    allTabs = r.tabs || [];
    render();
  } else {
    allTabs = [];
    $list.innerHTML = '<div class="tm-empty">❌ 加载失败: ' + escapeHtml(r?.error || '未知错误') + '</div>';
    $stats.innerHTML = '<span>❌ 加载失败</span>';
  }
}

function render() {
  const q = ($search.value || '').toLowerCase().trim();
  const dup = findDuplicates(allTabs);
  let list = allTabs;
  if (q) list = list.filter(t => (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q));
  if ($currentWin.checked) {
    const winId = allTabs.find(t => t.active)?.windowId;
    if (winId) list = list.filter(t => t.windowId === winId);
  }
  if ($dupOnly.checked) list = list.filter(t => dup.has(t.id));

  $stats.innerHTML = `<span>共 <b>${allTabs.length}</b> 个标签 · 匹配 <b>${list.length}</b>${dup.size ? ` · 重复 <b style="color:var(--tt-warning)">${dup.size}</b>` : ''}</span><span>已选 <b>${selected.size}</b></span>`;
  if (!list.length) {
    $list.innerHTML = '<div class="tm-empty">🏷 没有匹配的标签页</div>';
    return;
  }
  $list.innerHTML = list.map((t) => {
    const isDup = dup.has(t.id);
    const isSel = selected.has(t.id);
    const domain = getDomain(t.url);
    const fav = t.favIconUrl
      ? `<div class="tm-favicon"><img src="${escapeHtml(t.favIconUrl)}" data-fav="1"></div>`
      : `<div class="tm-favicon-empty">🌐</div>`;
    return `
    <div class="tm-item ${t.active ? 'tm-item--active' : ''} ${isSel ? 'tm-item--selected' : ''} ${isDup ? 'tm-item--dup' : ''}" data-id="${t.id}">
      <div class="tm-check-cell"><input type="checkbox" ${isSel ? 'checked' : ''} class="tm-sel"></div>
      ${fav}
      <div class="tm-info">
        <div class="tm-title">${escapeHtml(t.title || t.url || '(无标题)')}</div>
        <div class="tm-url">${escapeHtml(domain + (t.url ? (t.url.replace(/^https?:\/\/[^/]+/, '').substring(0, 80)) : ''))}</div>
        <div class="tm-badges">
          ${t.active ? '<span class="tm-badge tm-badge--active">● 当前</span>' : ''}
          ${t.audible ? '<span class="tm-badge tm-badge--audible">🔊 播放中</span>' : ''}
          ${t.pinned ? '<span class="tm-badge tm-badge--pinned">📌 已固定</span>' : ''}
          ${isDup ? '<span class="tm-badge tm-badge--dup">♊ 重复</span>' : ''}
        </div>
      </div>
      <div class="tm-actions">
        <button class="btn btn--primary btn--sm tm-switch">→ 切换</button>
        <button class="btn btn--secondary btn--sm tm-close">✕</button>
      </div>
    </div>
  `;
  }).join('');
  $list.querySelectorAll('.tm-item').forEach(row => {
    const id = parseInt(row.dataset.id, 10);
    const favImg = row.querySelector('img[data-fav="1"]');
    if (favImg) {
      favImg.addEventListener('error', () => {
        favImg.parentElement.innerHTML = '<span class="tm-favicon-empty">🌐</span>';
      });
    }
    row.querySelector('.tm-sel').addEventListener('change', (e) => {
      if (e.target.checked) selected.add(id); else selected.delete(id);
      row.classList.toggle('tm-item--selected', e.target.checked);
      updateStats();
    });
    row.querySelector('.tm-switch').addEventListener('click', async () => { await call('switchTab', { tabId: id }); load(false); });
    row.querySelector('.tm-close').addEventListener('click', async () => {
      await call('closeTabs', { tabIds: [id] });
      allTabs = allTabs.filter(t => t.id !== id);
      selected.delete(id);
      render();
    });
  });
}

function updateStats() {
  const q = ($search.value || '').toLowerCase().trim();
  const dup = findDuplicates(allTabs);
  let list = allTabs;
  if (q) list = list.filter(t => (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q));
  if ($currentWin.checked) {
    const winId = allTabs.find(t => t.active)?.windowId;
    if (winId) list = list.filter(t => t.windowId === winId);
  }
  if ($dupOnly.checked) list = list.filter(t => dup.has(t.id));
  $stats.innerHTML = `<span>共 <b>${allTabs.length}</b> 个标签 · 匹配 <b>${list.length}</b>${dup.size ? ` · 重复 <b style="color:var(--tt-warning)">${dup.size}</b>` : ''}</span><span>已选 <b>${selected.size}</b></span>`;
}

document.getElementById('btn-refresh').addEventListener('click', load);
$search.addEventListener('input', render);
$currentWin.addEventListener('change', render);
$dupOnly.addEventListener('change', render);

document.getElementById('btn-close-selected').addEventListener('click', async () => {
  if (!selected.size) return;
  if (!confirm(`关闭选中的 ${selected.size} 个标签?`)) return;
  await call('closeTabs', { tabIds: Array.from(selected) });
  allTabs = allTabs.filter(t => !selected.has(t.id));
  selected.clear();
  render();
});

document.getElementById('btn-close-dup').addEventListener('click', async () => {
  const dup = findDuplicates(allTabs);
  if (!dup.size) { alert('无重复'); return; }
  if (!confirm(`关闭 ${dup.size} 个重复标签?`)) return;
  // 每个 key 保留第一个
  const seen = new Map();
  const toClose = [];
  for (const t of allTabs) {
    if (!dup.has(t.id)) continue;
    try {
      const u = new URL(t.url);
      const key = u.origin + u.pathname;
      if (seen.has(key)) toClose.push(t.id);
      else seen.set(key, t.id);
    } catch (e) {}
  }
  if (toClose.length) {
    await call('closeTabs', { tabIds: toClose });
    allTabs = allTabs.filter(t => !toClose.includes(t.id));
    render();
  }
});

document.getElementById('btn-close-others').addEventListener('click', async () => {
  if (!confirm('关闭除当前标签外的所有标签?')) return;
  const current = allTabs.find(t => t.active);
  if (!current) return;
  const ids = allTabs.filter(t => t.id !== current.id && !t.pinned).map(t => t.id);
  if (ids.length) {
    await call('closeTabs', { tabIds: ids });
    allTabs = allTabs.filter(t => !ids.includes(t.id));
    render();
  }
});

document.getElementById('btn-group').addEventListener('click', async () => {
  if (!selected.size) { alert('请先选择要分组的标签'); return; }
  const title = prompt('分组名:', 'ToolCube 分组') || 'ToolCube 分组';
  const colors = ['blue','red','yellow','green','pink','purple','cyan','orange'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const r = await call('groupTabs', { tabIds: Array.from(selected), title, color });
  if (r && r.success) {
    alert('分组创建成功');
    selected.clear();
    load();
  } else {
    alert('分组失败: ' + (r?.error || '可能当前浏览器版本不支持 tabGroups'));
  }
});

window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data && e.data.action === 'setTheme' && e.data.data) document.documentElement.setAttribute('data-theme', e.data.data.theme);
});

load();
// 定时刷新
setInterval(() => load(false), 5000);
})();
