/**
 * LocalStorage / SessionStorage 管理器
 * 通过 content script 与页面内存储交互
 */
(function(){
'use strict';
let currentKind = 'local';
let currentData = [];
let currentOrigin = location.origin;
const $list = document.getElementById('ls-list');
const $stats = document.getElementById('ls-stats');
const $search = document.getElementById('ls-search');
const $tabs = document.getElementById('ls-tabs');

function callContent(action, data) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const handler = (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

      if (!e.data || e.source !== window.parent) return;
      if (e.data && e.data.action === '__contentResponse' && e.data.data && e.data.data.__id === id) {
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(e.data.data.result);
      }
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('请求超时'));
    }, 10000);
    window.addEventListener('message', handler);
    window.parent.postMessage({ action: 'sendToContent', data: { id, action, data } }, '*');
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function load() {
  $stats.textContent = '⏳ 加载中...';
  const r = await callContent('getStorageSnapshot', { kind: currentKind });
  if (r && r.success) {
    currentData = r.items;
    currentOrigin = r.origin || location.origin;
    const totalSize = estimateStorageSize(currentData);
    $stats.textContent = `${currentOrigin} · ${currentKind} · 共 ${currentData.length} 项 · ${formatStorageSize(totalSize)}`;
    render();
  } else {
    $stats.textContent = '❌ 加载失败: ' + (r?.error || '请刷新页面或检查权限');
  }
}

function isJSON(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 2) return false;
  return (t[0] === '{' && t[t.length-1] === '}') || (t[0] === '[' && t[t.length-1] === ']');
}

// 值类型识别
function detectType(v) {
  if (v === 'true' || v === 'false') return 'boolean';
  if (v === 'null') return 'null';
  if (v === 'undefined') return 'undefined';
  if (/^-?\d+(\.\d+)?$/.test(v) && !isNaN(Number(v))) return 'number';
  if (isJSON(v)) {
    try { const p = JSON.parse(v); if (Array.isArray(p)) return 'array'; return 'object'; } catch(e) {}
  }
  return 'string';
}

function typeIcon(t) {
  switch(t) {
    case 'number': return '🔢';
    case 'boolean': return '🔘';
    case 'object': return '📦';
    case 'array': return '📋';
    case 'null': return '∅';
    case 'undefined': return '❓';
    default: return '📝';
  }
}

// 存储空间估算
function estimateStorageSize(items) {
  let totalBytes = 0;
  items.forEach(it => {
    // 每个key+value的UTF-16编码大小估算
    totalBytes += (it.key.length + (it.value || '').length) * 2;
  });
  return totalBytes;
}

function formatStorageSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

function render() {
  const q = ($search.value || '').toLowerCase().trim();
  let list = currentData;
  if (q) list = list.filter(it => (it.key || '').toLowerCase().includes(q) || (it.value || '').toLowerCase().includes(q));
  if (!list.length) {
    $list.innerHTML = '<div class="ls-empty">📦 暂无匹配数据</div>';
    return;
  }
  $list.innerHTML = list.map((it) => {
    const jsonLike = isJSON(it.value);
    const vType = detectType(it.value);
    const tIcon = typeIcon(vType);
    let displayValue = it.value || '';
    if (jsonLike) {
      try { displayValue = JSON.stringify(JSON.parse(it.value), null, 2); } catch (e) {}
    }
    if (displayValue.length > 800) displayValue = displayValue.substring(0, 800) + '\n... (' + (displayValue.length - 800) + ' more)';
    return `
    <div class="ls-item" data-key="${escapeHtml(it.key)}">
      <div class="ls-item-check"><input type="checkbox" class="ls-sel" data-key="${escapeHtml(it.key)}"></div>
      <div>
        <div class="ls-key">${tIcon} ${escapeHtml(it.key)} <span class="ls-type-badge">${vType}</span></div>
        <div class="ls-value ${jsonLike ? 'ls-value--json' : ''}">${escapeHtml(displayValue)}</div>
      </div>
      <div class="ls-actions">
        <button class="btn btn--secondary btn--sm ls-copy">📋 复制值</button>
        <button class="btn btn--secondary btn--sm ls-edit">✏️ 编辑</button>
        <button class="btn btn--danger btn--sm ls-del">🗑️</button>
      </div>
    </div>
  `;
  }).join('');
  $list.querySelectorAll('.ls-item').forEach(row => {
    const key = row.dataset.key;
    const it = currentData.find(x => x.key === key);
    if (!it) return;
    row.querySelector('.ls-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(it.value); } catch (e) {}
    });
    row.querySelector('.ls-edit').addEventListener('click', () => {
      const v = prompt('编辑 ' + key, it.value);
      if (v === null) return;
      callContent('setStorageItem', { kind: currentKind, key, value: v }).then(load);
    });
    row.querySelector('.ls-del').addEventListener('click', () => {
      if (!confirm('删除 ' + key + '?')) return;
      callContent('removeStorageItem', { kind: currentKind, key }).then(load);
    });
  });
}

document.getElementById('btn-refresh').addEventListener('click', load);
$search.addEventListener('input', render);
$tabs.addEventListener('click', (e) => {
  const t = e.target.closest('.ls-tab');
  if (!t) return;
  $tabs.querySelectorAll('.ls-tab').forEach(x => x.classList.remove('ls-tab--active'));
  t.classList.add('ls-tab--active');
  currentKind = t.dataset.kind;
  load();
});
document.getElementById('btn-clear').addEventListener('click', async () => {
  if (!confirm('清空 ' + currentKind + 'Storage?')) return;
  await callContent('clearStorage', { kind: currentKind });
  load();
});
// 全选
const btnSelectAll = document.getElementById('btn-select-all');
if (btnSelectAll) btnSelectAll.addEventListener('click', () => {
  const checkboxes = $list.querySelectorAll('.ls-sel');
  const allChecked = Array.from(checkboxes).every(c => c.checked);
  checkboxes.forEach(c => c.checked = !allChecked);
  btnSelectAll.textContent = allChecked ? '☑ 全选' : '☐ 取消全选';
});
// 批量删除选中
const btnDeleteSelected = document.getElementById('btn-delete-selected');
if (btnDeleteSelected) btnDeleteSelected.addEventListener('click', async () => {
  const selected = Array.from($list.querySelectorAll('.ls-sel:checked')).map(c => c.dataset.key);
  if (!selected.length) { alert('请先选择要删除的项'); return; }
  if (!confirm(`确定删除 ${selected.length} 项?`)) return;
  for (const key of selected) {
    await callContent('removeStorageItem', { kind: currentKind, key });
  }
  load();
});
document.getElementById('btn-add').addEventListener('click', async () => {
  const k = document.getElementById('ls-add-key').value.trim();
  const v = document.getElementById('ls-add-value').value;
  if (!k) { alert('请填写 key'); return; }
  await callContent('setStorageItem', { kind: currentKind, key: k, value: v });
  document.getElementById('ls-add-key').value = '';
  document.getElementById('ls-add-value').value = '';
  load();
});
document.getElementById('btn-export').addEventListener('click', () => {
  const data = { kind: currentKind, origin: currentOrigin, ts: Date.now(), items: currentData };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentKind === 'local' ? 'localStorage' : 'sessionStorage') + '_' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-') + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});
document.getElementById('btn-import').addEventListener('click', () => document.getElementById('ls-file').click());
document.getElementById('ls-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.items || !Array.isArray(data.items)) { alert('格式错误'); return; }
    for (const it of data.items) {
      await callContent('setStorageItem', { kind: currentKind, key: it.key, value: it.value });
    }
    load();
  } catch (e) { alert('解析失败: ' + e.message); }
  e.target.value = '';
});

window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data && e.data.action === 'setTheme' && e.data.data) document.documentElement.setAttribute('data-theme', e.data.data.theme);
});

load();
})();
