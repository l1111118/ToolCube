document.addEventListener('DOMContentLoaded', () => {
  const domainInput = document.getElementById('domain-input');
  const providerSelect = document.getElementById('provider-select');
  const btnQuery = document.getElementById('btn-query');
  const btnQueryAll = document.getElementById('btn-query-all');
  const btnCopy = document.getElementById('btn-copy');
  const resultArea = document.getElementById('result-area');
  const historyList = document.getElementById('history-list');
  const btnClearHistory = document.getElementById('btn-clear-history');
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

  function safeStorage(op, ...args) {
    try {
      if (op === 'get') return chrome.storage.local.get(...args).catch(() => ({}));
      return chrome.storage.local[op](...args).catch(() => {});
    } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); }
  }

  const HISTORY_KEY = 'dns-lookup-history';
  const MAX_HISTORY = 10;
  // 缓存最近一次查询结果，供导出使用
  let lastResults = null;

  /**
   * 可用服务商由 background 的服务注册表提供（见 common/service-providers.js）。
   * 工具侧不再硬编码任何第三方地址 —— 用户可在「设置 → 服务端点」把某个类别
   * 指向自建 DoH 服务，或新增自定义服务，这里会自动出现。
   */
  let dnsProviders = [];
  let defaultDnsProviderId = 'cloudflare';

  async function loadDnsProviders() {
    try {
      const r = await callBackground('serviceProviders', null);
      if (!r || !r.success) return;
      dnsProviders = (r.providers || []).filter(p => p.kind === 'dns');
      const kind = (r.kinds || []).find(k => k.id === 'dns');
      if (kind && kind.defaultProviderId) defaultDnsProviderId = kind.defaultProviderId;
      if (dnsProviders.length === 0) return;
      const current = providerSelect.value;
      providerSelect.innerHTML = dnsProviders
        .map(p => '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.label) + '</option>')
        .join('');
      providerSelect.value = dnsProviders.some(p => p.id === current) ? current : defaultDnsProviderId;
    } catch (e) {
      console.warn('[dns-lookup] 加载服务商列表失败:', e);
    }
  }

  /**
   * 执行一次 DNS 查询（统一经 background 的服务层，支持自建服务）
   * @param {string} name 域名
   * @param {string} type 记录类型
   * @param {string} [providerId] 指定服务商（用于多服务商对比），留空则用设置页选定的服务商
   * @param {boolean} [dnssec] 是否请求 DNSSEC（服务端据此返回 AD 标志）
   * @returns {Promise<{status:number, ad:boolean, answers:Array}>}
   */
  async function dnsQuery(name, type, providerId, dnssec) {
    const r = await callBackground('serviceRequest', {
      kind: 'dns',
      params: { name, type, dnssec: dnssec === true },
      providerId: providerId || ''
    });
    if (!r || !r.success) throw new Error((r && r.error) || 'DNS 查询失败');
    return r.data;
  }

  // DNSSEC验证 - 通过检查AD(Authenticated Data)标志
  async function checkDNSSEC(domain, provider) {
    try {
      const data = await dnsQuery(domain, 'A', provider, true);
      // AD=1 表示DNSSEC验证通过
      return {
        supported: data.ad === true,
        rrsigs: (data.answers || []).some(a => a.type === 46),
        rcode: data.status
      };
    } catch (e) {
      return { supported: null, error: e.message };
    }
  }

  // DNS传播检查 - 多个DNS服务器对比（并发请求，避免串行等待）
  async function checkPropagation(domain, type) {
    const list = dnsProviders.length > 0
      ? dnsProviders
      : [{ id: defaultDnsProviderId, label: defaultDnsProviderId }];
    return Promise.all(list.map(async (p) => {
      try {
        const data = await dnsQuery(domain, type, p.id);
        return {
          provider: p.id,
          providerLabel: p.label,
          answers: (data.answers || []).map(a => a.data),
          status: data.status
        };
      } catch (e) {
        return { provider: p.id, providerLabel: p.label, answers: [], error: e.message };
      }
    }));
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatTtl(ttl) {
    if (ttl == null) return '--';
    const secs = Number(ttl);
    if (isNaN(secs)) return escapeHtml(ttl);
    let secondary = '';
    if (secs >= 86400) {
      const days = Math.floor(secs / 86400);
      const remain = secs % 86400;
      const hours = Math.floor(remain / 3600);
      secondary = `(${days}天${hours > 0 ? hours + '小时' : ''})`;
    } else if (secs >= 3600) {
      const hours = Math.floor(secs / 3600);
      const mins = Math.floor((secs % 3600) / 60);
      secondary = `(${hours}小时${mins > 0 ? mins + '分' : ''})`;
    } else if (secs >= 60) {
      const mins = Math.floor(secs / 60);
      const s = secs % 60;
      secondary = `(${mins}分${s > 0 ? s + '秒' : ''})`;
    }
    return `<span class="ttl-value">${secs}s</span>${secondary ? '<span class="ttl-secondary">' + secondary + '</span>' : ''}`;
  }

  function getSelectedTypes() {
    const checkboxes = document.querySelectorAll('.type-checkbox input[type="checkbox"]');
    const types = [];
    checkboxes.forEach(cb => { if (cb.checked) types.push(cb.value); });
    return types;
  }

  function showToast(msg, type = 'info') {
    toastEl.textContent = msg;
    toastEl.className = 'toast toast--' + type;
    toastEl.classList.add('toast--show');
    setTimeout(() => toastEl.classList.remove('toast--show'), 3000);
  }

  async function queryDns(domain, type) {
    return dnsQuery(domain, type, providerSelect.value);
  }

  function renderRecordValue(record) {
    const type = record.type;
    const data = record.data;
    if (type === 'MX') {
      return `${escapeHtml(record.priority || 0)} <code>${escapeHtml(data)}</code>`;
    }
    if (type === 'SRV') {
      return `${escapeHtml(record.priority || 0)} <code>${escapeHtml(data)}</code>`;
    }
    if (type === 'SOA') {
      return `<code>${escapeHtml(data)}</code>`;
    }
    return `<code>${escapeHtml(data)}</code>`;
  }

  function renderResults(allResults) {
    let html = '';
    let hasAnyRecords = false;

    for (const { type, result, error } of allResults) {
      if (error) {
        html += `<div class="result-section"><div class="result-section-title">${escapeHtml(type)} 记录</div><div class="result-error">❌ ${escapeHtml(error)}</div></div>`;
        continue;
      }

      const status = result.status;
      if (status === 3) {
        html += `<div class="result-section"><div class="result-section-title">${escapeHtml(type)} 记录</div><div class="result-error">❌ 域名不存在 (NXDOMAIN)</div></div>`;
        continue;
      }
      if (status === 2) {
        html += `<div class="result-section"><div class="result-section-title">${escapeHtml(type)} 记录</div><div class="result-error">❌ 服务器失败 (SERVFAIL)</div></div>`;
        continue;
      }
      if (status !== 0) {
        html += `<div class="result-section"><div class="result-section-title">${escapeHtml(type)} 记录</div><div class="result-error">❌ 查询失败 (RCODE: ${status})</div></div>`;
        continue;
      }

      const answers = result.answers || [];
      if (answers.length === 0) {
        html += `<div class="result-section"><div class="result-section-title">${escapeHtml(type)} 记录</div><div class="info-placeholder info-placeholder--small">无记录</div></div>`;
        continue;
      }

      hasAnyRecords = true;
      html += `<div class="result-section"><div class="result-section-title">${escapeHtml(type)} 记录 (${answers.length}条)</div>`;
      html += `<table class="result-table"><thead><tr><th>记录类型</th><th>TTL</th><th>值</th></tr></thead><tbody>`;
      for (const record of answers) {
        const recType = record.type === 1 ? 'A' : record.type === 28 ? 'AAAA' : record.type === 15 ? 'MX' :
          record.type === 2 ? 'NS' : record.type === 16 ? 'TXT' : record.type === 5 ? 'CNAME' :
          record.type === 6 ? 'SOA' : record.type === 33 ? 'SRV' :
          record.type === 12 ? 'PTR' : record.type === 257 ? 'CAA' : String(record.type);
        html += `<tr><td>${escapeHtml(recType)}</td><td>${formatTtl(record.ttl)}</td><td>${renderRecordValue({ type: recType, data: record.data })}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    if (!html) {
      html = '<div class="info-placeholder">无查询结果</div>';
    }
    return html;
  }

  async function doQuery(queryAll) {
    const domain = domainInput.value.trim();
    if (!domain) { showToast('请输入域名', 'error'); return; }

    // Remove protocol if user enters one
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    domainInput.value = cleanDomain;

    let types = getSelectedTypes();
    if (types.length === 0) { showToast('请至少选择一种记录类型', 'error'); return; }

    if (!queryAll) {
      // Query only the first selected type
      types = [types[0]];
    }

    resultArea.innerHTML = '<div class="info-loading">⏳ 查询中...</div>';
    btnQuery.disabled = true;
    btnQueryAll.disabled = true;

    const allResults = [];
    const promises = types.map(async (type) => {
      try {
        const result = await queryDns(cleanDomain, type);
        return { type, result, error: null };
      } catch (e) {
        let errMsg = e.message;
        if (e.name === 'AbortError') errMsg = '请求超时 (10秒)';
        return { type, result: null, error: errMsg };
      }
    });

    const results = await Promise.all(promises);
    for (const r of results) allResults.push(r);

    resultArea.innerHTML = renderResults(allResults);
    btnQuery.disabled = false;
    btnQueryAll.disabled = false;
    // 缓存结果供导出使用
    lastResults = { domain: cleanDomain, results: allResults, time: Date.now() };

    saveToHistory(cleanDomain, types.join(', '));
  }

  async function saveToHistory(domain, types) {
    try {
      const stored = await safeStorage('get', HISTORY_KEY);
      let history = stored[HISTORY_KEY] || [];
      const entry = { domain, types, time: Date.now() };
      // Remove duplicate domain entry
      history = history.filter(h => h.domain !== domain);
      history.unshift(entry);
      if (history.length > MAX_HISTORY) history = history.slice(0, MAX_HISTORY);
      await safeStorage('set', { [HISTORY_KEY]: history });
      renderHistory();
    } catch (e) {}
    // Also save via runtime message for tool-registry compatibility
    try {
      await callBackground('saveToHistory', { toolId: 'dns-lookup', type: types, data: { domain, types } });
    } catch (e) {}
  }

  async function loadHistory() {
    try {
      const stored = await safeStorage('get', HISTORY_KEY);
      return stored[HISTORY_KEY] || [];
    } catch (e) {
      return [];
    }
  }

  async function renderHistory() {
    const history = await loadHistory();
    if (history.length === 0) {
      historyList.innerHTML = '<div class="info-placeholder info-placeholder--small">暂无查询历史</div>';
      return;
    }
    historyList.innerHTML = history.map(h => {
      const time = new Date(h.time);
      const timeStr = `${time.getMonth() + 1}/${time.getDate()} ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
      return `<div class="history-item" data-domain="${escapeHtml(h.domain)}"><span class="history-domain">${escapeHtml(h.domain)}</span><span class="history-meta"><span>${escapeHtml(h.types)}</span><span>${timeStr}</span></span></div>`;
    }).join('');
  }

  btnQuery.addEventListener('click', () => doQuery(false));
  btnQueryAll.addEventListener('click', () => doQuery(true));

  domainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doQuery(true);
  });

  btnCopy.addEventListener('click', () => {
    const text = resultArea.innerText;
    if (text) {
      navigator.clipboard.writeText(text).then(() => showToast('已复制到剪贴板')).catch(() => {});
    }
  });

  // DNSSEC检查
  var btnCheckDnssec = document.getElementById('btn-check-dnssec');
  if (btnCheckDnssec) {
    btnCheckDnssec.addEventListener('click', async () => {
      const domain = domainInput.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!domain) { showToast('请输入域名', 'error'); return; }
      const provider = providerSelect.value;
      resultArea.innerHTML = '<div class="info-loading">⏳ DNSSEC验证中...</div>';
      const result = await checkDNSSEC(domain, provider);
      if (result.supported === true) {
        resultArea.innerHTML = '<div class="result-section"><div class="result-section-title">DNSSEC 验证</div><div style="padding:12px;color:var(--tt-success)">✅ DNSSEC 已启用并验证通过' + (result.rrsigs ? ' (检测到RRSIG记录)' : '') + '</div></div>' + resultArea.innerHTML;
      } else if (result.supported === false) {
        resultArea.innerHTML = '<div class="result-section"><div class="result-section-title">DNSSEC 验证</div><div style="padding:12px;color:#f59e0b">⚠️ DNSSEC 未启用或验证未通过</div></div>' + resultArea.innerHTML;
      } else {
        resultArea.innerHTML = '<div class="result-section"><div class="result-section-title">DNSSEC 验证</div><div style="padding:12px;color:var(--tt-text-tertiary)">❓ 无法确定DNSSEC状态: ' + escapeHtml(result.error || '未知') + '</div></div>' + resultArea.innerHTML;
      }
      showToast('DNSSEC检查完成');
    });
  }

  // DNS传播检查
  var btnPropagation = document.getElementById('btn-propagation');
  if (btnPropagation) {
    btnPropagation.addEventListener('click', async () => {
      const domain = domainInput.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!domain) { showToast('请输入域名', 'error'); return; }
      const types = getSelectedTypes();
      const type = types.length > 0 ? types[0] : 'A';
      resultArea.innerHTML = '<div class="info-loading">⏳ DNS传播检查中...</div>';
      const results = await checkPropagation(domain, type);
      let html = '<div class="result-section"><div class="result-section-title">DNS 传播检查 (' + type + ')</div>';
      html += '<table class="result-table"><thead><tr><th>DNS服务器</th><th>结果</th><th>状态</th></tr></thead><tbody>';
      const allAnswers = results.filter(r => r.answers && r.answers.length > 0).map(r => r.answers.sort().join(','));
      const allSame = allAnswers.length > 1 && allAnswers.every(a => a === allAnswers[0]);
      for (const r of results) {
        const pLabel = r.providerLabel || r.provider;
        const ans = r.answers && r.answers.length > 0 ? r.answers.map(a => '<code>' + escapeHtml(a) + '</code>').join(', ') : '<span style="color:var(--tt-text-tertiary)">无记录</span>';
        const status = r.error ? '❌ ' + escapeHtml(r.error) : (r.answers && r.answers.length > 0 ? '✅' : '—');
        html += '<tr><td>' + escapeHtml(pLabel) + '</td><td>' + ans + '</td><td>' + status + '</td></tr>';
      }
      html += '</tbody></table>';
      html += '<div style="margin-top:8px;font-size:12px;color:' + (allSame ? 'var(--tt-success)' : '#f59e0b') + '">' + (allSame ? '✅ 所有DNS服务器返回一致结果' : '⚠️ DNS服务器返回结果不一致，可能正在传播中') + '</div>';
      html += '</div>';
      resultArea.innerHTML = html;
      showToast('传播检查完成');
    });
  }

  // ==================== 批量查询 ====================
  var btnBatch = document.getElementById('btn-batch');
  var batchPanel = document.getElementById('batch-panel');
  var btnCloseBatch = document.getElementById('btn-close-batch');
  var btnRunBatch = document.getElementById('btn-run-batch');
  var batchInput = document.getElementById('batch-input');
  var batchResult = document.getElementById('batch-result');

  if (btnBatch && batchPanel) {
    btnBatch.addEventListener('click', () => {
      batchPanel.style.display = batchPanel.style.display === 'none' ? 'block' : 'none';
    });
  }
  if (btnCloseBatch && batchPanel) {
    btnCloseBatch.addEventListener('click', () => { batchPanel.style.display = 'none'; });
  }

  if (btnRunBatch) {
    btnRunBatch.addEventListener('click', async () => {
      const text = batchInput ? batchInput.value.trim() : '';
      if (!text) { showToast('请输入要批量查询的域名', 'error'); return; }
      const domains = text.split('\n').map(s => s.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
      if (domains.length === 0) { showToast('未解析到有效域名', 'error'); return; }
      if (domains.length > 20) { showToast('单次最多批量查询 20 个域名', 'error'); return; }
      const types = getSelectedTypes();
      if (types.length === 0) { showToast('请至少选择一种记录类型', 'error'); return; }
      btnRunBatch.disabled = true;
      if (batchResult) batchResult.innerHTML = '<div class="info-placeholder info-placeholder--small">⏳ 批量查询中...</div>';
      const batchAllResults = [];
      for (let i = 0; i < domains.length; i++) {
        const d = domains[i];
        const domainResults = [];
        for (const type of types) {
          try {
            const result = await queryDns(d, type);
            const answers = (result.answers || []).map(a => a.data);
            domainResults.push({ type, answers, status: result.status });
          } catch (e) {
            domainResults.push({ type, answers: [], error: e.message });
          }
        }
        batchAllResults.push({ domain: d, results: domainResults });
        // 实时更新进度
        if (batchResult) {
          batchResult.innerHTML = batchAllResults.map(r => {
            const recs = r.results.filter(x => x.answers && x.answers.length > 0)
              .map(x => x.type + ': ' + x.answers.join(', ')).join(' | ');
            return '<div class="batch-result-item"><span class="batch-result-domain">' + escapeHtml(r.domain) + '</span>' +
              '<div class="batch-result-records">' + (recs ? escapeHtml(recs) : '无记录') + '</div></div>';
          }).join('') + (i < domains.length - 1 ? '<div class="info-placeholder info-placeholder--small">⏳ 查询中... (' + (i + 1) + '/' + domains.length + ')</div>' : '');
        }
      }
      btnRunBatch.disabled = false;
      // 缓存批量结果供导出
      lastResults = { domain: '批量查询', results: batchAllResults, time: Date.now(), batch: true };
      showToast('批量查询完成 (' + domains.length + ' 个域名)');
    });
  }

  // ==================== 导出结果 ====================
  var btnExport = document.getElementById('btn-export');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      if (!lastResults) { showToast('请先执行查询再导出', 'error'); return; }
      // 弹出格式选择
      const choice = prompt('选择导出格式:\n1. JSON\n2. CSV\n3. TXT\n\n输入数字 1/2/3:', '1');
      if (!choice) return;
      let content = '';
      let filename = 'dns-result-' + Date.now();
      let mime = 'text/plain';
      if (choice === '1') {
        // JSON 导出
        content = JSON.stringify(lastResults, null, 2);
        filename += '.json';
        mime = 'application/json';
      } else if (choice === '2') {
        // CSV 导出
        content = 'Domain,Type,TTL,Value\n';
        if (lastResults.batch) {
          lastResults.results.forEach(dom => {
            dom.results.forEach(r => {
              r.answers.forEach(a => {
                content += '"' + dom.domain + '","' + r.type + '","","' + a.replace(/"/g, '""') + '"\n';
              });
            });
          });
        } else {
          lastResults.results.forEach(r => {
            const ans = r.result && r.result.answers ? r.result.answers : [];
            ans.forEach(a => {
              content += '"' + lastResults.domain + '","' + r.type + '","' + (a.ttl == null ? '' : a.ttl) + '","' + String(a.data || '').replace(/"/g, '""') + '"\n';
            });
          });
        }
        filename += '.csv';
        mime = 'text/csv';
      } else {
        // TXT 导出
        content = 'DNS 查询结果 - ' + new Date(lastResults.time).toLocaleString('zh-CN') + '\n';
        content += '域名: ' + lastResults.domain + '\n\n';
        if (lastResults.batch) {
          lastResults.results.forEach(dom => {
            content += '=== ' + dom.domain + ' ===\n';
            dom.results.forEach(r => {
              content += '  ' + r.type + ': ' + (r.answers && r.answers.length ? r.answers.join(', ') : '无记录') + '\n';
            });
            content += '\n';
          });
        } else {
          lastResults.results.forEach(r => {
            content += '--- ' + r.type + ' ---\n';
            const ans = r.result && r.result.answers ? r.result.answers : [];
            ans.forEach(a => { content += '  ' + (a.ttl == null ? '' : a.ttl) + 's  ' + a.data + '\n'; });
            if (ans.length === 0) content += '  无记录\n';
            content += '\n';
          });
        }
        filename += '.txt';
      }
      // 创建下载
      const blob = new Blob([content], { type: mime + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('已导出 ' + filename, 'success');
    });
  }

  btnClearHistory.addEventListener('click', async () => {
    try {
      await safeStorage('remove', HISTORY_KEY);
    } catch (e) {}
    renderHistory();
    showToast('历史已清除');
  });

  historyList.addEventListener('click', (e) => {
    const item = e.target.closest('.history-item');
    if (item) {
      const domain = item.dataset.domain;
      if (domain) {
        domainInput.value = domain;
        doQuery(true);
      }
    }
  });

  renderHistory();
  // 从服务注册表加载可用 DNS 服务商（含用户自建服务），失败不影响工具基本可用
  loadDnsProviders();
});

// 主题切换消息监听
window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data && event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
  // 也处理 setData 消息（从 sidebar 传入参数）
  if (event.data && event.data.action === 'setData') {
    const inputArea = document.getElementById('domain-input');
    if (inputArea && typeof event.data.data === 'string') {
      inputArea.value = event.data.data;
      inputArea.dispatchEvent(new Event('input'));
    }
  }
});
