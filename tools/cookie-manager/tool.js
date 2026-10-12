/**
 * Cookie 管理器
 * 通过 chrome.cookies API 进行增删改查
 */
(function(){
'use strict';
let allCookies = [];
let currentDomain = '';
let currentCookieFilter = 'all'; // 'all' | 'session' | 'persistent'
const $list = document.getElementById('cm-list');
const $stats = document.getElementById('cm-stats');
const $domain = document.getElementById('cm-domain');
const $search = document.getElementById('cm-search');

function call(action, data) {
  return new Promise((resolve, reject) => {
    const id = Math.random().toString(36).slice(2);
    const handler = (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

      if (!e.data || e.source !== window.parent) return;
      if (e.data && e.data.action === '__bgResponse' && e.data.data && e.data.data.__id === id) {
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
    window.parent.postMessage({ action: 'callBackground', data: { id, action, data } }, '*');
  });
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/**
 * 按 name + domain + path 三元组回查 cookie 对象。
 * 三者共同构成 cookie 的唯一标识，用于从行元素反查数据。
 */
function findCookie(name, domain, path) {
  return allCookies.find(c => c.name === name && c.domain === domain && c.path === path) || null;
}

async function load() {
  $stats.textContent = '⏳ 加载中...';
  currentDomain = $domain.value.trim();
  const r = await call('getAllCookies', currentDomain ? { domain: currentDomain } : {});
  if (r && r.success) {
    allCookies = r.cookies;
    render();
  } else {
    $stats.textContent = '❌ 加载失败: ' + (r?.error || '请确认 cookies 权限已授予');
  }
}

function render() {
  const q = ($search.value || '').toLowerCase().trim();
  let list = allCookies;
  if (q) list = list.filter(c => (c.name || '').toLowerCase().includes(q) || (c.value || '').toLowerCase().includes(q) || (c.domain || '').toLowerCase().includes(q));
  // 按会话/持久分类筛选
  if (currentCookieFilter === 'session') list = list.filter(c => c.session);
  else if (currentCookieFilter === 'persistent') list = list.filter(c => !c.session);
  // 标记第三方Cookie
  let thirdPartyCount = 0;
  list.forEach(c => {
    if (!c._thirdParty) {
      const domain = (c.domain || '').replace(/^\./, '');
      // 如果cookie域名与当前页面域名不同，标记为第三方
      try {
        const pageHost = location.hostname;
        if (domain && pageHost && !domain.endsWith(pageHost) && !pageHost.endsWith(domain)) {
          c._thirdParty = true;
        }
      } catch(e) {}
    }
    if (c._thirdParty) thirdPartyCount++;
  });
  // 统计会话/持久数量
  const sessionCount = allCookies.filter(c => c.session).length;
  const persistentCount = allCookies.length - sessionCount;
  $stats.textContent = `共 ${allCookies.length} 个 cookie · 会话 ${sessionCount} · 持久 ${persistentCount}${thirdPartyCount > 0 ? ' · 第三方 ' + thirdPartyCount : ''}${q ? ' · 匹配 ' + list.length : ''}`;
  if (!list.length) {
    $list.innerHTML = '<div class="cm-empty">🍪 暂无 cookie</div>';
    return;
  }
  $list.innerHTML = list.map((c) => {
    const scheme = c.secure ? 'https' : 'http';
    const url = `${scheme}://${c.domain.startsWith('.') ? c.domain.slice(1) : c.domain}${c.path}`;
    const thirdPartyBadge = c._thirdParty ? '<span class="cm-flag cm-flag--third">第三方</span>' : '';
    return `
    <div class="cm-item" data-name="${escapeHtml(c.name)}" data-url="${escapeHtml(url)}" data-domain="${escapeHtml(c.domain)}" data-path="${escapeHtml(c.path)}">
      <div class="cm-item-check"><input type="checkbox" class="cm-sel" data-name="${escapeHtml(c.name)}" data-url="${escapeHtml(url)}"></div>
      <div class="cm-item-name">${escapeHtml(c.name)} ${thirdPartyBadge}</div>
      <div>
        <div class="cm-item-value cm-item-value--hidden" data-val="${escapeHtml(c.value)}">${escapeHtml(c.value)}</div>
        <div class="cm-item-meta">
          <span>${escapeHtml(c.domain)}</span>
          <span>${escapeHtml(c.path)}</span>
          ${c.session ? '<span>session</span>' : (c.expirationDate ? `<span>${new Date(c.expirationDate*1000).toLocaleString()}</span>` : '')}
        </div>
        <div class="cm-item-flags">
          ${c.secure ? '<span class="cm-flag cm-flag--true">Secure</span>' : '<span class="cm-flag cm-flag--false">非Secure</span>'}
          ${c.httpOnly ? '<span class="cm-flag cm-flag--true">HttpOnly</span>' : ''}
          ${c.sameSite ? `<span class="cm-flag">SameSite=${escapeHtml(c.sameSite)}</span>` : '<span class="cm-flag cm-flag--false">无SameSite</span>'}
        </div>
      </div>
      <div class="cm-item-actions">
        <button class="btn btn--secondary btn--sm cm-toggle">👁</button>
        <button class="btn btn--secondary btn--sm cm-edit-sec" title="编辑安全属性">🔒</button>
        <button class="btn btn--secondary btn--sm cm-copy">📋</button>
        <button class="btn btn--danger btn--sm cm-del">🗑️</button>
      </div>
    </div>
  `;
  }).join('');
  $list.querySelectorAll('.cm-item').forEach(row => {
    const name = row.dataset.name;
    const url = row.dataset.url;
    const val = row.querySelector('.cm-item-value');
    row.querySelector('.cm-toggle').addEventListener('click', () => {
      val.classList.toggle('cm-item-value--hidden');
    });
    row.querySelector('.cm-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(val.dataset.val); } catch (e) {}
    });
    // 编辑安全属性
    // 注意：这里的 row 与上面 map 回调里的 c 不在同一作用域，
    // 因此必须按 name+domain+path 回查 cookie 对象（旧实现直接引用 c，点按钮即抛 ReferenceError）。
    row.querySelector('.cm-edit-sec').addEventListener('click', () => {
      const cookie = findCookie(row.dataset.name, row.dataset.domain, row.dataset.path);
      if (!cookie) return;
      showSecurityEditor(cookie, row);
    });
    row.querySelector('.cm-del').addEventListener('click', async () => {
      if (!confirm('删除 cookie "' + name + '"?')) return;
      await call('deleteCookie', { url, name });
      allCookies = allCookies.filter(c => !(c.name === name && c.domain === row.dataset.domain && c.path === row.dataset.path));
      render();
    });
    val.addEventListener('click', () => val.classList.toggle('cm-item-value--hidden'));
  });
}

document.getElementById('btn-load').addEventListener('click', load);
// 分类筛选按钮
const btnFilterAll = document.getElementById('btn-filter-all');
if (btnFilterAll) btnFilterAll.addEventListener('click', () => { currentCookieFilter = 'all'; render(); });
const btnFilterSession = document.getElementById('btn-filter-session');
if (btnFilterSession) btnFilterSession.addEventListener('click', () => { currentCookieFilter = 'session'; render(); });
const btnFilterPersistent = document.getElementById('btn-filter-persistent');
if (btnFilterPersistent) btnFilterPersistent.addEventListener('click', () => { currentCookieFilter = 'persistent'; render(); });

// 编辑Cookie安全属性弹窗
function showSecurityEditor(cookie, row) {
  // 移除已有弹窗
  const existing = document.querySelector('.cm-sec-editor');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'cm-sec-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9998';
  const editor = document.createElement('div');
  editor.className = 'cm-sec-editor';
  editor.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--tt-bg);border:1px solid var(--tt-border);border-radius:8px;padding:16px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.3)';
  editor.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <b>🔒 编辑安全属性</b>
      <button class="cm-sec-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--tt-text)">✕</button>
    </div>
    <div style="font-size:11px;color:var(--tt-text-muted);margin-bottom:8px">${escapeHtml(cookie.name)} @ ${escapeHtml(cookie.domain)}${escapeHtml(cookie.path)}</div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer"><input type="checkbox" id="sec-secure" ${cookie.secure ? 'checked' : ''}> Secure (仅HTTPS)</label>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer"><input type="checkbox" id="sec-httponly" ${cookie.httpOnly ? 'checked' : ''}> HttpOnly (禁止JS访问)</label>
    <div style="margin-bottom:8px">
      <label style="font-size:12px;color:var(--tt-text-muted);display:block;margin-bottom:4px">SameSite</label>
      <select id="sec-samesite" style="width:100%;padding:6px 8px;border:1px solid var(--tt-border);border-radius:4px;background:var(--tt-bg-secondary);color:var(--tt-text)">
        <option value="" ${!cookie.sameSite ? 'selected' : ''}>默认</option>
        <option value="no_restriction" ${cookie.sameSite === 'no_restriction' ? 'selected' : ''}>None</option>
        <option value="lax" ${cookie.sameSite === 'lax' ? 'selected' : ''}>Lax</option>
        <option value="strict" ${cookie.sameSite === 'strict' ? 'selected' : ''}>Strict</option>
      </select>
    </div>
    <button class="btn btn--primary btn--sm" id="btn-save-sec" style="width:100%;margin-top:4px">💾 保存</button>
  `;
  document.body.appendChild(overlay);
  document.body.appendChild(editor);
  editor.querySelector('.cm-sec-close').addEventListener('click', () => { editor.remove(); overlay.remove(); });
  overlay.addEventListener('click', () => { editor.remove(); overlay.remove(); });
  editor.querySelector('#btn-save-sec').addEventListener('click', async () => {
    const scheme = document.getElementById('sec-secure').checked ? 'https' : 'http';
    const url = `${scheme}://${cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
    const r = await call('setCookie', {
      name: cookie.name, value: cookie.value,
      domain: cookie.domain, path: cookie.path,
      secure: document.getElementById('sec-secure').checked,
      httpOnly: document.getElementById('sec-httponly').checked,
      sameSite: document.getElementById('sec-samesite').value
    });
    if (r && r.success) {
      editor.remove(); overlay.remove();
      load();
    } else {
      alert('保存失败: ' + (r?.error || '未知错误'));
    }
  });
}
$search.addEventListener('input', render);
document.getElementById('btn-delete-domain').addEventListener('click', async () => {
  const d = $domain.value.trim();
  if (!d) { alert('请先输入要清理的域名'); return; }
  if (!confirm('确定删除域名 "' + d + '" 下的所有 cookie?')) return;
  const r = await call('deleteAllCookies', { domain: d });
  alert(r && r.success ? '已删除 ' + r.removed + ' 项' : '删除失败');
  load();
});
document.getElementById('btn-add').addEventListener('click', async () => {
  const name = document.getElementById('cm-add-name').value.trim();
  const value = document.getElementById('cm-add-value').value.trim();
  const domain = document.getElementById('cm-add-domain').value.trim();
  const path = document.getElementById('cm-add-path').value.trim() || '/';
  const secure = document.getElementById('cm-add-secure') ? document.getElementById('cm-add-secure').checked : false;
  const httpOnly = document.getElementById('cm-add-httponly') ? document.getElementById('cm-add-httponly').checked : false;
  const sameSite = document.getElementById('cm-add-samesite') ? document.getElementById('cm-add-samesite').value : '';
  if (!name || !domain) { alert('请填写 name 和 domain'); return; }
  const r = await call('setCookie', { name, value, domain, path, secure, httpOnly, sameSite });
  if (r && r.success) {
    document.getElementById('cm-add-name').value = '';
    document.getElementById('cm-add-value').value = '';
    document.getElementById('cm-add-domain').value = '';
    document.getElementById('cm-add-path').value = '';
    load();
  }
  else alert('添加失败: ' + (r?.error || '未知错误'));
});

// 全选
const btnSelectAll = document.getElementById('btn-select-all');
if (btnSelectAll) btnSelectAll.addEventListener('click', () => {
  const checkboxes = $list.querySelectorAll('.cm-sel');
  const allChecked = Array.from(checkboxes).every(c => c.checked);
  checkboxes.forEach(c => c.checked = !allChecked);
  btnSelectAll.textContent = allChecked ? '☑ 全选' : '☐ 取消全选';
});

// 批量删除选中
const btnDeleteSelected = document.getElementById('btn-delete-selected');
if (btnDeleteSelected) btnDeleteSelected.addEventListener('click', async () => {
  const selected = Array.from($list.querySelectorAll('.cm-sel:checked')).map(c => ({
    name: c.dataset.name,
    url: c.dataset.url
  }));
  if (!selected.length) { alert('请先选择要删除的Cookie'); return; }
  if (!confirm(`确定删除 ${selected.length} 个Cookie?`)) return;
  for (const s of selected) {
    await call('deleteCookie', { url: s.url, name: s.name });
  }
  load();
});

// 导出Cookie
const btnExport = document.getElementById('btn-export-cookies');
if (btnExport) btnExport.addEventListener('click', () => {
  const data = { exportDate: new Date().toISOString(), cookies: allCookies.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite,
    expirationDate: c.expirationDate, session: c.session
  }))};
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cookies_' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-') + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});

// 导入Cookie
const btnImport = document.getElementById('btn-import-cookies');
if (btnImport) btnImport.addEventListener('click', () => {
  const fileInput = document.getElementById('cm-file');
  if (fileInput) fileInput.click();
});
const fileInput = document.getElementById('cm-file');
if (fileInput) fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.cookies || !Array.isArray(data.cookies)) { alert('格式错误'); return; }
    let imported = 0;
    for (const c of data.cookies) {
      if (!c.name || !c.domain) continue;
      const r = await call('setCookie', { name: c.name, value: c.value || '', domain: c.domain, path: c.path || '/', secure: c.secure || false, httpOnly: c.httpOnly || false, sameSite: c.sameSite || '' });
      if (r && r.success) imported++;
    }
    alert(`成功导入 ${imported} 个Cookie`);
    load();
  } catch (e) { alert('导入失败: ' + e.message); }
  e.target.value = '';
});

window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data && e.data.action === 'setTheme' && e.data.data) document.documentElement.setAttribute('data-theme', e.data.data.theme);
});

load();
})();
