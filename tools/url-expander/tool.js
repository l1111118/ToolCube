/**
 * 短链还原器 - 跟随 3xx 跳转链展开真实 URL
 */
(function(){
'use strict';
const $url = document.getElementById('ue-url');
const $list = document.getElementById('ue-list');

// 展开历史
let expandHistory = [];
function loadHistory(){
  try{
    const d=localStorage.getItem('url_expand_history');
    if(d) expandHistory=JSON.parse(d);
  }catch(e){}
  renderExpandHistory();
}
function saveExpandHistory(){
  try{localStorage.setItem('url_expand_history',JSON.stringify(expandHistory));}catch(e){}
}
function addToExpandHistory(shortUrl,finalUrl,hops){
  expandHistory=expandHistory.filter(h=>h.shortUrl!==shortUrl);
  expandHistory.unshift({shortUrl,finalUrl,hops,timestamp:Date.now()});
  if(expandHistory.length>20) expandHistory=expandHistory.slice(0,20);
  saveExpandHistory();
  renderExpandHistory();
}
function renderExpandHistory(){
  const histArea=document.getElementById('ue-history');
  if(!histArea) return;
  if(expandHistory.length===0){histArea.innerHTML='<div class="ue-empty-sm">暂无展开历史</div>';return;}
  histArea.innerHTML=expandHistory.map((h,i)=>`<div class="ue-hist-item" data-idx="${i}"><span class="ue-hist-short" title="${escapeHtml(h.shortUrl)}">${escapeHtml(h.shortUrl.length>40?h.shortUrl.substring(0,40)+'...':h.shortUrl)}</span><span class="ue-hist-arrow">→</span><span class="ue-hist-final" title="${escapeHtml(h.finalUrl)}">${escapeHtml(h.finalUrl.length>50?h.finalUrl.substring(0,50)+'...':h.finalUrl)}</span><span class="ue-hist-hops">${h.hops}跳</span><span class="ue-hist-time">${new Date(h.timestamp).toLocaleTimeString()}</span></div>`).join('');
  histArea.querySelectorAll('.ue-hist-item').forEach(item=>{
    item.addEventListener('click',()=>{
      const idx=parseInt(item.dataset.idx, 10);
      $url.value=expandHistory[idx].shortUrl;
    });
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
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
function isShortUrl(u) {
  const shortDomains = ['t.cn', 'bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 't.co', 'lnkd.in', 'rb.gy', 'shorturl.at', 'cutt.ly', 'short.io', 'v.gd', 'qr.ae', 'po.st', 'mzl.la', 'snip.ly', 'soo.gd', 's.id', 'shorte.st', 'adf.ly', 'shst.me', 'u.to', 'tiny.cc', 'short.cm', 'shrtco.de', 'gg.gg', 'rb.gy', 'tr.im', 'lnk.to', 'v.ht', 'sh.st', 'da.gd', 'go2l.ink', 'x.co', 'q.gs', 't1p.de', 'chilp.it', 'urlz.fr', 'urlcero.es', 'kr3w.de', 'sk.gy', 'tiny.pl', 'url.pt', 'tweetburner.com', 'icio.us', 'sn.im', 'piurl.com', 'adjix.com', '2tu.us', 'snurl.com', 'snipurl.com', 'sn.pm', 'xrl.us', 'url4.eu', 'urlx.ie', 'urlin.us', 'url.fi', 'url.az', 'url.az', 'urlborg.com', 'urlcut.com', 'urlkick.com', 'urlmeter.com', 'urlspan.com', 'zapit.it'];
  try {
    const h = new URL(u).hostname.toLowerCase();
    return shortDomains.some(d => h === d || h.endsWith('.' + d));
  } catch (e) { return false; }
}

function extractUrls(text) {
  const urlRe = /https?:\/\/[^\s<>"'，。；！？、\)\]\}]+/gi;
  return text.match(urlRe) || [];
}

// 当前展开结果，用于复制全部
let lastExpandResults = [];

async function expand() {
  const text = $url.value.trim();
  if (!text) return;
  const urls = extractUrls(text);
  if (!urls.length) {
    $list.innerHTML = '<div class="ue-empty">未发现 URL（请以 http:// 或 https:// 开头）</div>';
    return;
  }
  lastExpandResults = [];
  $list.innerHTML = urls.map((u, idx) => `
    <div class="ue-item" data-idx="${idx}" data-url="${escapeHtml(u)}">
      <div class="ue-item-head">
        <span class="ue-item-status ue-status--pending">⏳ 处理中</span>
        <div class="ue-item-actions">
          <button class="btn btn--secondary btn--sm ue-copy">📋 复制</button>
          <button class="btn btn--secondary btn--sm ue-open">🔗 打开</button>
        </div>
      </div>
      <div class="ue-line"><span class="ue-line-prefix">原</span><span class="ue-line-url">${escapeHtml(u)}</span><span class="ue-line-status">${isShortUrl(u) ? '🔗 短链' : '🌐 直接'}</span></div>
    </div>
  `).join('');
  $list.querySelectorAll('.ue-item').forEach(row => {
    const url = row.dataset.url;
    row.querySelector('.ue-copy').addEventListener('click', () => {
      const final = row.querySelector('.ue-final-url');
      const target = final ? final.textContent : url;
      navigator.clipboard.writeText(target).catch(()=>{});
    });
    row.querySelector('.ue-open').addEventListener('click', () => {
      const final = row.querySelector('.ue-final-url');
      const target = final ? final.textContent : url;
      window.open(target, '_blank');
    });
  });
  // 并发处理（限 3 并发）
  const queue = urls.map((u, idx) => ({ u, idx }));
  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const { u, idx } = queue.shift();
      const row = $list.querySelector(`[data-idx="${idx}"]`);
      if (!row) continue;
      // 捕获 call 可能的 rejection（如超时），避免单个失败中断整个批量处理
      let r;
      try {
        r = await call('expandShortUrl', { url: u, maxHops: 8 });
      } catch (e) {
        r = { success: false, error: e.message };
      }
      renderResult(row, u, r);
      if (r && r.success) {
        lastExpandResults.push({ original: u, final: r.final, hops: r.hops });
        addToExpandHistory(u, r.final, r.hops);
      }
    }
  });
  await Promise.all(workers);
}

function renderResult(row, url, r) {
  const statusEl = row.querySelector('.ue-item-status');
  if (!r || !r.success) {
    statusEl.className = 'ue-item-status ue-status--err';
    statusEl.textContent = '❌ 失败';
    return;
  }
  statusEl.className = 'ue-item-status ue-status--ok';
  statusEl.textContent = `✅ ${r.hops} 跳`;
  // 渲染跳转链
  const head = row.querySelector('.ue-item-head');
  const chainHtml = r.chain.map((c, i) => `
    <div class="ue-line">
      <span class="ue-line-prefix">${i === 0 ? '原' : '↓'}</span>
      <span class="ue-line-url">${escapeHtml(c.url)}</span>
      <span class="ue-line-status">${c.status ? c.status : (c.error ? '❌' : '')}</span>
    </div>
  `).join('');
  // 安全检查最终URL
  const securityHtml = checkFinalUrlSecurity(r.final);
  const final = `
    <div class="ue-final">
      <div class="ue-final-label">🎯 最终目标</div>
      <div class="ue-final-url" title="点击复制">${escapeHtml(r.final)}</div>
    </div>
    ${securityHtml}
    <div class="ue-enrich" data-final="${escapeHtml(r.final)}">
      <button class="btn btn--secondary btn--sm ue-enrich-btn" data-kind="urlScan">🛡️ 检测目标安全性</button>
      <button class="btn btn--secondary btn--sm ue-enrich-btn" data-kind="webArchive">🗂️ 查看历史快照</button>
      <div class="ue-enrich-result" hidden></div>
    </div>
  `;
  const chainWrap = document.createElement('div');
  chainWrap.innerHTML = chainHtml + final;
  head.insertAdjacentElement('afterend', chainWrap);
  const finalUrl = row.querySelector('.ue-final-url');
  if (finalUrl) finalUrl.addEventListener('click', () => navigator.clipboard.writeText(r.final).catch(()=>{}));

  // 绑定「安全检测 / 历史快照」：走服务端点，可指向自建服务
  const enrich = row.querySelector('.ue-enrich');
  if (enrich) {
    const enrichBtn = enrich.querySelectorAll('.ue-enrich-btn');
    const enrichResult = enrich.querySelector('.ue-enrich-result');
    enrichBtn.forEach(btn => {
      btn.addEventListener('click', async () => {
        const kind = btn.dataset.kind;
        const target = enrich.dataset.final;
        if (!target || !/^https?:\/\//i.test(target)) return;
        enrichResult.hidden = false;
        enrichResult.className = 'ue-enrich-result ue-enrich-result--loading';
        enrichResult.textContent = '⏳ 查询中...';
        try {
          const resp = await call('serviceRequest', { kind, params: { url: target } });
          if (!resp || !resp.success) {
            enrichResult.className = 'ue-enrich-result ue-enrich-result--err';
            enrichResult.textContent = '❌ 查询失败: ' + ((resp && resp.error) || '未知错误');
            return;
          }
          enrichResult.className = 'ue-enrich-result ue-enrich-result--ok';
          if (kind === 'urlScan') {
            const d = resp.data || {};
            if (d.malicious) {
              enrichResult.innerHTML = '<span style="color:#e53935;font-weight:600">🚨 该 URL 被标记为恶意'
                + (d.categories && d.categories.length ? '（' + escapeHtml(d.categories.join('、')) + '）' : '')
                + '</span>' + (d.reports ? ' · 相关记录 ' + d.reports + ' 条' : '');
            } else if (d.reports > 0) {
              enrichResult.innerHTML = '<span style="color:#f59e0b">⚠️ 未判定为恶意，但有 ' + d.reports + ' 条相关扫描记录</span>';
            } else {
              enrichResult.innerHTML = '<span style="color:var(--tt-success)">✅ 未发现该 URL 的恶意记录</span>';
            }
          } else {
            const d = resp.data || {};
            if (d.available && d.snapshotUrl) {
              enrichResult.innerHTML = '🗂️ 最早/最近快照：<a href="' + escapeHtml(d.snapshotUrl)
                + '" target="_blank" rel="noopener" style="color:var(--tt-primary)">' + escapeHtml(d.timestamp || '查看') + '</a>'
                + (d.total > 1 ? ' · 共约 ' + d.total + ' 个快照' : '');
            } else {
              enrichResult.innerHTML = '<span style="color:var(--tt-text-tertiary)">ℹ️ 档案馆中没有该 URL 的快照（可能是新注册域名，需留意）</span>';
            }
          }
        } catch (e) {
          enrichResult.className = 'ue-enrich-result ue-enrich-result--err';
          enrichResult.textContent = '❌ 查询失败: ' + e.message;
        }
      });
    });
  }
}

// 检查最终URL安全性，返回HTML片段
function checkFinalUrlSecurity(finalUrl) {
  const issues = [];
  let finalHost = '';
  let finalProtocol = '';
  try {
    const u = new URL(finalUrl);
    finalHost = u.hostname;
    finalProtocol = u.protocol;
    // 检查协议
    if (u.protocol === 'http:') {
      issues.push({ level: 'warn', text: '最终目标使用HTTP明文协议，传输不加密' });
    } else if (u.protocol !== 'https:') {
      issues.push({ level: 'danger', text: '最终目标使用非标准协议: ' + u.protocol });
    }
    // 检查IP地址作为主机
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) {
      issues.push({ level: 'warn', text: '最终目标使用IP地址而非域名（可能可疑）' });
    }
    // 检查可疑TLD
    const suspiciousTlds = ['.zip', '.mov', '.xyz', '.top', '.click', '.country', '.kim', '.cricket', '.science', '.work', '.party', '.gq', '.cf', '.tk', '.ml'];
    if (suspiciousTlds.some(tld => u.hostname.toLowerCase().endsWith(tld))) {
      issues.push({ level: 'warn', text: '最终域名使用了可疑的顶级域名（常被钓鱼网站使用）' });
    }
    // 检查过长子域名（可能钓鱼）
    const parts = u.hostname.split('.');
    if (parts.length > 5) {
      issues.push({ level: 'warn', text: '最终域名层级过深（可能钓鱼）' });
    }
    // 检查凭据在URL中
    if (u.username || u.password) {
      issues.push({ level: 'danger', text: '最终URL中包含用户名/密码（不安全）' });
    }
    // 检查URL长度
    if (finalUrl.length > 2000) {
      issues.push({ level: 'warn', text: '最终URL过长（' + finalUrl.length + '字符）' });
    }
    // 检查可疑参数
    const suspiciousParams = ['redirect', 'url', 'next', 'callback', 'cmd', 'exec', 'eval'];
    let foundSuspicious = [];
    u.searchParams.forEach((v, k) => {
      if (suspiciousParams.includes(k.toLowerCase())) foundSuspicious.push(k);
    });
    if (foundSuspicious.length > 0) {
      issues.push({ level: 'warn', text: '最终URL包含可疑参数: ' + foundSuspicious.join(', ') });
    }
  } catch (e) {
    issues.push({ level: 'danger', text: '最终URL格式无效: ' + e.message });
  }
  // 检查是否与原短链域名差异巨大
  if (finalHost) {
    // 简单启发：如果最终域名包含下载或可执行文件后缀
    if (/\.(exe|bat|cmd|scr|com|pif|vbs|js|jar|apk|msi|dll)$/i.test(finalUrl)) {
      issues.push({ level: 'danger', text: '🚨 最终URL指向可执行文件，可能是恶意软件！' });
    }
  }
  if (issues.length === 0) {
    return '<div class="ue-security ue-security--ok">✅ 最终URL安全检查通过</div>';
  }
  let html = '<div class="ue-security"><div class="ue-security-title">🛡️ 安全检查</div>';
  issues.forEach(it => {
    const cls = it.level === 'danger' ? 'ue-security--danger' : 'ue-security--warn';
    const icon = it.level === 'danger' ? '🚨' : '⚠️';
    html += `<div class="ue-security-item ${cls}">${icon} ${escapeHtml(it.text)}</div>`;
  });
  html += '</div>';
  return html;
}

// 复制全部结果
function copyAllResults() {
  if (lastExpandResults.length === 0) { return; }
  const text = lastExpandResults.map(r => r.original + ' → ' + r.final).join('\n');
  navigator.clipboard.writeText(text).catch(()=>{});
}

document.getElementById('btn-expand').addEventListener('click', expand);
document.getElementById('btn-pick').addEventListener('click', async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t) $url.value = t;
  } catch (e) { alert('剪贴板权限被拒绝'); }
});
document.getElementById('btn-clear').addEventListener('click', () => { $url.value = ''; $list.innerHTML = '<div class="ue-empty">⛓ 短链还原器</div>'; lastExpandResults = []; });

const btnCopyAll = document.getElementById('btn-copy-all');
if (btnCopyAll) btnCopyAll.addEventListener('click', copyAllResults);

loadHistory();

window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data && e.data.action === 'setTheme' && e.data.data) document.documentElement.setAttribute('data-theme', e.data.data.theme);
});
})();
