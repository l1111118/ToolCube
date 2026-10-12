/**
 * 子域名发现工具
 */
document.addEventListener('DOMContentLoaded', () => {
  const domainInput = document.getElementById('domain-input');
  const btnQuery = document.getElementById('btn-query');
  const btnExport = document.getElementById('btn-export');
  const methodCt = document.getElementById('method-ct');
  const methodCertspotter = document.getElementById('method-certspotter');
  const methodHackertarget = document.getElementById('method-hackertarget');
  const methodDns = document.getElementById('method-dns');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const statsBar = document.getElementById('stats-bar');
  const statTotal = document.getElementById('stat-total');
  const statUnique = document.getElementById('stat-unique');
  const resultArea = document.getElementById('result-area');
  const toastEl = document.getElementById('toast');
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
      // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
    // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
    }, 70000);
      _pendingMsgs.set(id, { resolve, reject, timer });
      window.parent.postMessage({ action: 'callBackground', data: { id, action, data } }, '*');
    });
  }

  async function saveToHistory(domain, count) {
    try {
      await callBackground('saveToHistory', { toolId: 'subdomain-finder', type: 'query', data: { domain, count } });
    } catch (e) {}
  }

  let allResults = [];
  let isScanning = false;

  const WORDLIST = [
    'www', 'mail', 'ftp', 'admin', 'api', 'dev', 'staging', 'test', 'app',
    'blog', 'shop', 'store', 'cdn', 'static', 'media', 'img', 'images',
    'assets', 'portal', 'login', 'signin', 'dashboard', 'panel', 'control',
    'manage', 'mx', 'smtp', 'pop', 'imap', 'ns1', 'ns2', 'vpn', 'remote',
    'cloud', 'db', 'database', 'redis', 'mysql', 'mongo', 'postgres',
    'elastic', 'kafka', 'queue', 'git', 'svn', 'ci', 'jenkins', 'gitlab',
    'bitbucket', 'jira', 'confluence', 'wiki', 'docs', 'status', 'monitor',
    'grafana', 'prometheus'
  ];

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg, type = 'info') {
    toastEl.textContent = msg;
    toastEl.className = 'toast toast--' + type;
    toastEl.classList.add('toast--show');
    setTimeout(() => toastEl.classList.remove('toast--show'), 3000);
  }

  function updateProgress(current, total, text) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressBar.style.width = pct + '%';
    progressText.textContent = text || `${current}/${total} (${pct}%)`;
  }

  function updateStats() {
    statTotal.textContent = allResults.length;
    const uniqueDomains = new Set(allResults.map(r => r.subdomain));
    statUnique.textContent = uniqueDomains.size;
  }

  function renderResults() {
    if (allResults.length === 0) {
      resultArea.innerHTML = '<div class="info-placeholder">未发现子域名</div>';
      return;
    }
    // 来源标签映射（source 由 provider 归一化给出）
    const sourceLabels = {
      'ct': { class: 'source-ct', label: 'crt.sh' },
      'certspotter': { class: 'source-certspotter', label: 'CertSpotter' },
      'hackertarget': { class: 'source-hackertarget', label: 'HackerTarget' },
      'dns': { class: 'source-dns', label: 'DNS' }
    };
    let html = '<table class="result-table"><thead><tr><th>子域名</th><th>IP地址</th><th>来源</th><th>首次发现</th><th>存活</th></tr></thead><tbody>';
    for (const r of allResults) {
      const src = sourceLabels[r.source] || { class: 'source-dns', label: r.source };
      const aliveIcon = r.alive === true ? '✅' : (r.alive === false ? '❌' : '--');
      html += `<tr>
        <td>${escapeHtml(r.subdomain)}</td>
        <td>${escapeHtml(r.ip || '--')}</td>
        <td><span class="${escapeHtml(src.class)}">${escapeHtml(src.label)}</span></td>
        <td>${escapeHtml(r.firstSeen || '--')}</td>
        <td>${aliveIcon}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    resultArea.innerHTML = html;
  }

  // 统一经 background 服务层枚举子域名（见 common/service-providers.js 的 subdomain 类别）。
  // 之所以不再逐家直接 fetch：
  //   1. 各家地址硬编码在工具里，用户无法换成自建 CT 网关 / 自托管服务；
  //   2. 各家返回结构不同（JSON 数组 / 纯文本），工具内散落大量格式适配代码。
  // 现在由 provider 负责协议与解析，工具只消费归一化的 subdomains[]（name/source/firstSeen）。
  // providerId 由用户勾选的数据源决定：crt-sh / certspotter / hackertarget。
  async function querySubdomains(domain, providerId) {
    const r = await callBackground('serviceRequest', {
      kind: 'subdomain',
      params: { domain },
      providerId
    });
    if (!r || !r.success) throw new Error((r && r.error) || '子域名查询失败');
    return (r.data && r.data.subdomains) || [];
  }

  // 查询单个数据源并合并结果：把归一化条目适配成表格所需的行结构
  async function runSource(domain, providerId, label) {
    try {
      const subs = await querySubdomains(domain, providerId);
      mergeResults(subs.map(s => ({
        subdomain: s.name,
        ip: '',
        source: s.source || providerId,
        firstSeen: s.firstSeen ? String(s.firstSeen).split('T')[0] : ''
      })));
    } catch (e) {
      showToast(label + ' 查询失败: ' + e.message, 'error');
    }
  }

  // 子域名的 A 记录解析改走服务层的 dns 类别：不再硬编码 Cloudflare DoH 地址，
  // 用户可在「设置 → 服务端点」换成自建 DoH。这里只取归一化 answers 中的 A 记录。
  async function resolveSubdomain(subdomain) {
    try {
      const r = await callBackground('serviceRequest', {
        kind: 'dns',
        params: { name: subdomain, type: 'A' }
      });
      if (!r || !r.success) return null;
      const answers = (r.data && r.data.answers) || [];
      const ips = answers.filter(a => a.type === 1).map(a => a.data);
      return ips.length > 0 ? ips[0] : null;
    } catch {
      return null;
    }
  }

  async function bruteForceDns(domain) {
    const results = [];
    const total = WORDLIST.length;
    let done = 0;
    // Process in batches of 5 for speed
    const batchSize = 5;
    for (let i = 0; i < total; i += batchSize) {
      const batch = WORDLIST.slice(i, i + batchSize);
      const promises = batch.map(async (word) => {
        const subdomain = `${word}.${domain}`;
        const ip = await resolveSubdomain(subdomain);
        done++;
        updateProgress(done, total, `DNS枚举: ${done}/${total}`);
        if (ip) {
          return { subdomain, ip, source: 'dns', firstSeen: '' };
        }
        return null;
      });
      const batchResults = await Promise.all(promises);
      for (const r of batchResults) {
        if (r) results.push(r);
      }
      // Update UI incrementally
      const existingSet = new Set(allResults.map(x => x.subdomain));
      for (const r of results) {
        if (!existingSet.has(r.subdomain)) {
          allResults.push(r);
          existingSet.add(r.subdomain);
        }
      }
      updateStats();
      renderResults();
    }
    return results;
  }

  // 合并查询结果并去重的辅助函数
  function mergeResults(newResults) {
    const existingSet = new Set(allResults.map(x => x.subdomain));
    for (const r of newResults) {
      if (!existingSet.has(r.subdomain)) {
        allResults.push(r);
        existingSet.add(r.subdomain);
      }
    }
    updateStats();
    renderResults();
  }

  async function doQuery() {
    const domain = domainInput.value.trim();
    if (!domain) { showToast('请输入域名', 'error'); return; }
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
    domainInput.value = cleanDomain;

    const anyChecked = methodCt.checked || methodCertspotter.checked || methodHackertarget.checked || methodDns.checked;
    if (!anyChecked) {
      showToast('请至少选择一种搜索方式', 'error'); return;
    }

    isScanning = true;
    btnQuery.disabled = true;
    allResults = [];
    progressContainer.style.display = 'flex';
    statsBar.style.display = 'flex';
    resultArea.innerHTML = '<div class="info-placeholder">⏳ 查询中...</div>';
    updateProgress(0, 1, '准备中...');

    // crt.sh（证书透明度日志）
    if (methodCt.checked) {
      updateProgress(0, 1, '查询证书透明度日志...');
      await runSource(cleanDomain, 'crt-sh', 'crt.sh');
    }

    // CertSpotter
    if (methodCertspotter.checked) {
      updateProgress(0, 1, '查询 CertSpotter...');
      await runSource(cleanDomain, 'certspotter', 'CertSpotter');
    }

    // HackerTarget
    if (methodHackertarget.checked) {
      updateProgress(0, 1, '查询 HackerTarget...');
      await runSource(cleanDomain, 'hackertarget', 'HackerTarget');
    }

    // DNS 暴力枚举
    if (methodDns.checked) {
      await bruteForceDns(cleanDomain);
    }

    progressContainer.style.display = 'none';
    isScanning = false;
    btnQuery.disabled = false;

    if (allResults.length === 0) {
      resultArea.innerHTML = '<div class="info-placeholder">未发现子域名</div>';
    }
    showToast(`发现 ${allResults.length} 个结果`);
    saveToHistory(cleanDomain, allResults.length);
  }

  btnQuery.addEventListener('click', doQuery);
  domainInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doQuery(); });

  // Censys 数据源已移除：新架构未提供带 API 认证的 subdomain provider。
  // 之所以选择移除而非保留复选框：保留会同时留下一个恒不可用的选项，以及一套
  // 无人读取的 Censys 凭证面板（死代码），清晰度更差；若需 Censys，可在
  // 「设置 → 服务端点」为 subdomain 类别配置自定义服务。

  btnExport.addEventListener('click', () => {
    if (allResults.length === 0) { showToast('无结果可导出', 'error'); return; }
    // 弹出导出格式选择
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    var box = document.createElement('div');
    box.style.cssText = 'background:var(--tt-bg-primary);border-radius:8px;padding:16px;max-width:360px;width:90%';
    box.innerHTML = '<h3 style="margin:0 0 12px">导出结果</h3>' +
      '<button id="export-txt" style="display:block;width:100%;margin-bottom:8px;padding:8px;cursor:pointer;border-radius:4px;border:1px solid var(--tt-border-color);background:var(--tt-bg-secondary)">📄 导出为 TXT (域名列表)</button>' +
      '<button id="export-json" style="display:block;width:100%;margin-bottom:8px;padding:8px;cursor:pointer;border-radius:4px;border:1px solid var(--tt-border-color);background:var(--tt-bg-secondary)">📋 导出为 JSON (完整数据)</button>' +
      '<button id="export-csv" style="display:block;width:100%;margin-bottom:8px;padding:8px;cursor:pointer;border-radius:4px;border:1px solid var(--tt-border-color);background:var(--tt-bg-secondary)">📊 导出为 CSV</button>' +
      '<button id="export-close" style="display:block;width:100%;padding:8px;cursor:pointer;border-radius:4px;border:1px solid var(--tt-border-color)">关闭</button>';
    modal.appendChild(box);
    document.body.appendChild(modal);
    document.getElementById('export-txt').onclick = function() {
      var text = allResults.map(r => r.subdomain).join('\n');
      navigator.clipboard.writeText(text).then(() => showToast('TXT已复制到剪贴板'));
      document.body.removeChild(modal);
    };
    document.getElementById('export-json').onclick = function() {
      var json = JSON.stringify(allResults, null, 2);
      navigator.clipboard.writeText(json).then(() => showToast('JSON已复制到剪贴板'));
      document.body.removeChild(modal);
    };
    document.getElementById('export-csv').onclick = function() {
      var csv = '子域名,IP地址,来源,首次发现,存活\n' + allResults.map(r => '"' + r.subdomain + '","' + (r.ip || '') + '","' + r.source + '","' + (r.firstSeen || '') + '","' + (r.alive === true ? '是' : r.alive === false ? '否' : '未知') + '"').join('\n');
      navigator.clipboard.writeText(csv).then(() => showToast('CSV已复制到剪贴板'));
      document.body.removeChild(modal);
    };
    document.getElementById('export-close').onclick = function() { document.body.removeChild(modal); };
    modal.addEventListener('click', function(e) { if (e.target === modal) document.body.removeChild(modal); });
  });

  // 子域名存活检测
  var btnCheckAlive = document.getElementById('btn-check-alive');
  if (btnCheckAlive) {
    btnCheckAlive.addEventListener('click', async () => {
      if (allResults.length === 0) { showToast('无结果可检测', 'error'); return; }
      btnCheckAlive.disabled = true;
      progressContainer.style.display = 'flex';
      var total = allResults.length;
      var alive = 0;
      for (var i = 0; i < allResults.length; i++) {
        updateProgress(i + 1, total, '存活检测: ' + allResults[i].subdomain);
        var r = allResults[i];
        try {
          var resp = await fetch('https://' + r.subdomain + '/', { method: 'HEAD', mode: 'no-cors', cache: 'no-cache', signal: AbortSignal.timeout(5000) });
          r.alive = true;
          alive++;
        } catch (e) {
          try {
            var resp2 = await fetch('http://' + r.subdomain + '/', { method: 'HEAD', mode: 'no-cors', cache: 'no-cache', signal: AbortSignal.timeout(5000) });
            r.alive = true;
            alive++;
          } catch (e2) {
            r.alive = false;
          }
        }
      }
      progressContainer.style.display = 'none';
      btnCheckAlive.disabled = false;
      renderResults();
      showToast('存活检测完成: ' + alive + '/' + total + ' 存活');
    });
  }
});

window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
  if (event.data.action === 'setData') {
    const inputArea = document.getElementById('domain-input');
    if (inputArea && typeof event.data.data === 'string') {
      inputArea.value = event.data.data;
    }
  }
});

function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast--' + type;
  el.classList.add('toast--show');
  setTimeout(() => el.classList.remove('toast--show'), 3000);
}

