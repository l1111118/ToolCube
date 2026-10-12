/**
 * 网络分析器
 */
document.addEventListener('DOMContentLoaded', () => {
  const btnAnalyze = document.getElementById('btn-analyze');
  const btnExport = document.getElementById('btn-export');
  const btnExportHar = document.getElementById('btn-export-har');
  const filterType = document.getElementById('filter-type');
  const sortBy = document.getElementById('sort-by');
  const filterDomain = document.getElementById('filter-domain');
  const filterSearch = document.getElementById('filter-search');
  const filterSize = document.getElementById('filter-size');
  const overviewBar = document.getElementById('overview-bar');
  const ovTotal = document.getElementById('ov-total');
  const ovSize = document.getElementById('ov-size');
  const ovTime = document.getElementById('ov-time');
  const ovTypes = document.getElementById('ov-types');
  const tabBar = document.getElementById('tab-bar');
  const requestsArea = document.getElementById('requests-area');
  const groupedArea = document.getElementById('grouped-area');
  const timelineArea = document.getElementById('timeline-area');
  const slowArea = document.getElementById('slow-area');
  const largeArea = document.getElementById('large-area');
  const thirdpartyArea = document.getElementById('thirdparty-area');
  const securityArea = document.getElementById('security-area');
  const toastEl = document.getElementById('toast');
  // ── PostMessage 通信路由（与 security-scanner 一致） ──
  // 工具 iframe 通过 window.parent.postMessage → sidebar 代理 → background
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


  let allEntries = [];
  let pageDomain = '';

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

  function formatSize(bytes) {
    if (!bytes || bytes === 0) return '--';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function formatDuration(ms) {
    if (!ms || ms === 0) return '--';
    if (ms < 1000) return ms.toFixed(0) + 'ms';
    return (ms / 1000).toFixed(2) + 's';
  }

  function getTypeBadge(initiatorType) {
    const type = mapType(initiatorType);
    const cls = 'type-badge type-badge--' + type.toLowerCase();
    return `<span class="${cls}">${escapeHtml(type)}</span>`;
  }

  function mapType(initiatorType) {
    if (!initiatorType) return 'Other';
    const t = initiatorType.toLowerCase();
    if (t === 'navigation' || t === 'document') return 'Document';
    if (t === 'script') return 'Script';
    if (t === 'css' || t === 'link') return 'Stylesheet';
    if (t === 'img' || t === 'image') return 'Image';
    if (t === 'font') return 'Font';
    if (t === 'xmlhttprequest' || t === 'fetch') return 'XHR';
    return 'Other';
  }

  function getDomain(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  function renderRequestTable(entries, container, highlightSlow, highlightLarge) {
    if (entries.length === 0) {
      container.innerHTML = '<div class="info-placeholder">无匹配请求</div>';
      return;
    }
    let html = '<table class="result-table"><thead><tr><th>URL</th><th>方法</th><th>状态</th><th>大小</th><th>耗时</th><th>类型</th></tr></thead><tbody>';
    for (const e of entries) {
      const rowClass = (highlightSlow && e.duration > 500) ? ' class="row--slow"' : (highlightLarge && e.transferSize > 102400) ? ' class="row--large"' : '';
      // 为行添加 data-idx 以便点击打开详情
      const idx = allEntries.indexOf(e);
      html += `<tr${rowClass} data-entry-idx="${idx}">
        <td title="${escapeHtml(e.name)}">${escapeHtml(e.name.length > 60 ? e.name.substring(0, 60) + '...' : e.name)}</td>
        <td>${escapeHtml(e.method || '--')}</td>
        <td>${escapeHtml(e.status || '--')}</td>
        <td>${formatSize(e.transferSize)}</td>
        <td>${formatDuration(e.duration)}</td>
        <td>${getTypeBadge(e.initiatorType)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
    // 绑定行点击事件，打开详情弹窗
    container.querySelectorAll('tr[data-entry-idx]').forEach(tr => {
      tr.addEventListener('click', () => {
        const i = parseInt(tr.dataset.entryIdx, 10);
        if (!isNaN(i) && allEntries[i]) {
          showRequestDetail(allEntries[i]);
        }
      });
    });
  }

  // 显示请求详情弹窗
  const modal = document.getElementById('detail-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const modalClose = document.getElementById('modal-close');
  function showRequestDetail(e) {
    if (!modal || !modalBody) return;
    const type = mapType(e.initiatorType);
    const domain = getDomain(e.name);
    let urlObj = null;
    try { urlObj = new URL(e.name); } catch(err) {}
    const queryParams = urlObj ? Array.from(urlObj.searchParams.entries()) : [];
    modalTitle.textContent = type + ' · ' + (e.status || '--');
    let html = '<div class="detail-actions">';
    html += '<button class="btn btn--secondary btn--sm" id="btn-copy-url-detail">📋 复制URL</button>';
    html += '<button class="btn btn--secondary btn--sm" id="btn-open-url-detail">🔗 打开URL</button>';
    html += '</div>';
    // 基本信息
    html += '<div class="detail-section"><div class="detail-section-title">📋 基本信息</div>';
    html += '<table class="detail-table">';
    html += `<tr><td>完整URL</td><td><code>${escapeHtml(e.name)}</code></td></tr>`;
    html += `<tr><td>域名</td><td><code>${escapeHtml(domain)}</code></td></tr>`;
    html += `<tr><td>路径</td><td><code>${escapeHtml(urlObj ? urlObj.pathname : '')}</code></td></tr>`;
    html += `<tr><td>请求方法</td><td><code>${escapeHtml(e.method || 'GET')}</code></td></tr>`;
    html += `<tr><td>状态码</td><td><code>${escapeHtml(e.status || '--')}</code></td></tr>`;
    html += `<tr><td>类型</td><td>${escapeHtml(type)} (${escapeHtml(e.initiatorType || 'unknown')})</td></tr>`;
    html += '</table></div>';
    // 性能信息
    html += '<div class="detail-section"><div class="detail-section-title">⚡ 性能信息</div>';
    html += '<table class="detail-table">';
    if (e.protocol) html += `<tr><td>协议</td><td><code>${escapeHtml(e.protocol)}</code></td></tr>`;
    html += `<tr><td>开始时间</td><td>${formatDuration(e.startTime || 0)}</td></tr>`;
    html += `<tr><td>响应开始</td><td>${formatDuration(e.responseStart || 0)}</td></tr>`;
    html += `<tr><td>响应结束</td><td>${formatDuration(e.responseEnd || 0)}</td></tr>`;
    html += `<tr><td>总耗时</td><td><strong>${formatDuration(e.duration || 0)}</strong></td></tr>`;
    html += `<tr><td>传输大小</td><td><strong>${formatSize(e.transferSize)}</strong></td></tr>`;
    html += `<tr><td>编码后大小</td><td>${formatSize(e.encodedBodySize)}</td></tr>`;
    html += `<tr><td>解码后大小</td><td>${formatSize(e.decodedBodySize)}</td></tr>`;
    if (e.transferSize > 0 && e.decodedBodySize > 0 && e.transferSize < e.decodedBodySize) {
      const ratio = ((1 - e.transferSize / e.decodedBodySize) * 100).toFixed(0);
      html += `<tr><td>压缩节省</td><td><strong style="color:#34a853">${ratio}%</strong> (节省 ${formatSize(e.decodedBodySize - e.transferSize)})</td></tr>`;
    }
    html += '</table></div>';
    // 计时分解瀑布图（DNS/TCP/TLS/TTFB/下载/重定向/Worker）
    if (e.breakdown) {
      const b = e.breakdown;
      const stages = [
        { key: 'redirect', label: '🔁 重定向', val: b.redirect, color: '#9c27b0' },
        { key: 'worker',   label: '⚙️ Service Worker', val: b.worker, color: '#607d8b' },
        { key: 'dns',      label: '🌐 DNS 解析', val: b.dns, color: '#4285f4' },
        { key: 'tcp',      label: '🔌 TCP 连接', val: b.tcp, color: '#34a853' },
        { key: 'tls',      label: '🔒 TLS 握手', val: b.tls, color: '#fbbc04' },
        { key: 'ttfb',     label: '⏳ TTFB 等待', val: b.ttfb, color: '#ea4335' },
        { key: 'download', label: '📥 内容下载', val: b.download, color: '#ff6d00' }
      ];
      const total = stages.reduce((s, st) => s + (st.val || 0), 0) || 1;
      html += '<div class="detail-section"><div class="detail-section-title">📊 计时分解瀑布图</div>';
      html += '<table class="detail-table">';
      for (const st of stages) {
        const pct = ((st.val || 0) / total * 100).toFixed(1);
        html += `<tr><td style="min-width:140px">${st.label}</td><td>${formatDuration(st.val || 0)} <span style="color:var(--tt-text-muted)">(${pct}%)</span></td></tr>`;
      }
      html += '</table>';
      // 瀑布条
      html += '<div class="waterfall" style="margin-top:8px;display:flex;height:18px;border-radius:4px;overflow:hidden;border:1px solid var(--tt-border)">';
      for (const st of stages) {
        const w = (st.val || 0) / total * 100;
        if (w > 0) html += `<div title="${st.label}: ${formatDuration(st.val || 0)}" style="width:${w}%;background:${st.color}"></div>`;
      }
      html += '</div></div>';
    }
    // 导航条目提示
    if (e.isNavigation) {
      html += '<div class="detail-section"><div class="detail-section-title">📄 主文档导航</div><div style="font-size:11px;color:var(--tt-text-muted);padding:4px 0">此条目为页面主文档导航请求，含请求方法和状态码。</div></div>';
    } else if (!e.method && !e.status) {
      html += '<div class="detail-section" style="font-size:11px;color:var(--tt-text-muted)">ℹ️ PerformanceResourceTiming API 不暴露子资源的请求方法和状态码，仅主文档导航条目可获取。</div>';
    }
    // 查询参数
    if (queryParams.length > 0) {
      html += '<div class="detail-section"><div class="detail-section-title">🔎 查询参数 (' + queryParams.length + ')</div>';
      html += '<table class="detail-table">';
      for (const [k, v] of queryParams) {
        html += `<tr><td><code>${escapeHtml(k)}</code></td><td><code>${escapeHtml(v)}</code></td></tr>`;
      }
      html += '</table></div>';
    }
    // 完整 entries 信息
    html += '<div class="detail-section"><div class="detail-section-title">📦 原始 PerformanceEntry 数据</div>';
    html += `<pre style="font-size:11px;background:var(--tt-code-bg);padding:8px;border-radius:4px;overflow:auto;max-height:200px;font-family:var(--tt-font-mono);">${escapeHtml(JSON.stringify(e, null, 2))}</pre></div>`;
    modalBody.innerHTML = html;
    modal.style.display = 'flex';
    // 绑定弹窗内按钮
    const btnCopy = document.getElementById('btn-copy-url-detail');
    const btnOpen = document.getElementById('btn-open-url-detail');
    if (btnCopy) btnCopy.addEventListener('click', () => navigator.clipboard.writeText(e.name).catch(()=>{}));
    if (btnOpen) btnOpen.addEventListener('click', () => window.open(e.name, '_blank'));
  }
  if (modalClose) modalClose.addEventListener('click', () => { modal.style.display = 'none'; });
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });

  function getFilteredEntries() {
    let entries = [...allEntries];
    const typeFilter = filterType.value;
    const domainFilter = filterDomain.value.trim().toLowerCase();
    const searchFilter = filterSearch ? filterSearch.value.trim().toLowerCase() : '';
    const sizeFilter = filterSize ? filterSize.value : 'all';
    const sortField = sortBy.value;

    if (typeFilter !== 'all') {
      entries = entries.filter(e => {
        const t = mapType(e.initiatorType).toLowerCase();
        return t === typeFilter.toLowerCase();
      });
    }
    if (domainFilter) {
      entries = entries.filter(e => getDomain(e.name).toLowerCase().includes(domainFilter));
    }
    // 搜索框：匹配 URL / 类型 / 状态 / 域名
    if (searchFilter) {
      entries = entries.filter(e => {
        const type = mapType(e.initiatorType).toLowerCase();
        const status = String(e.status || '').toLowerCase();
        const domain = getDomain(e.name).toLowerCase();
        return e.name.toLowerCase().includes(searchFilter) ||
               type.includes(searchFilter) ||
               status.includes(searchFilter) ||
               domain.includes(searchFilter);
      });
    }
    if (sizeFilter === 'small') {
      entries = entries.filter(e => (e.transferSize || 0) < 10240);
    } else if (sizeFilter === 'medium') {
      entries = entries.filter(e => (e.transferSize || 0) >= 10240 && (e.transferSize || 0) < 1048576);
    } else if (sizeFilter === 'large') {
      entries = entries.filter(e => (e.transferSize || 0) >= 1048576);
    }

    switch (sortField) {
      case 'size-desc': entries.sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0)); break;
      case 'size-asc': entries.sort((a, b) => (a.transferSize || 0) - (b.transferSize || 0)); break;
      case 'duration-desc': entries.sort((a, b) => (b.duration || 0) - (a.duration || 0)); break;
      case 'duration-asc': entries.sort((a, b) => (a.duration || 0) - (b.duration || 0)); break;
    }
    return entries;
  }

  function updateOverview() {
    ovTotal.textContent = allEntries.length;
    const totalSize = allEntries.reduce((s, e) => s + (e.transferSize || 0), 0);
    ovSize.textContent = formatSize(totalSize);
    const totalTime = allEntries.length > 0 ? Math.max(...allEntries.map(e => e.responseEnd || 0)) - Math.min(...allEntries.map(e => e.startTime || 0)) : 0;
    ovTime.textContent = formatDuration(totalTime);
    const typeCounts = {};
    allEntries.forEach(e => {
      const t = mapType(e.initiatorType);
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    ovTypes.textContent = Object.entries(typeCounts).map(([k, v]) => `${k}:${v}`).join(' ');
  }

  function renderAll() {
    const entries = getFilteredEntries();
    renderRequestTable(entries, requestsArea, false, false);

    // Grouped by type
    const groups = {};
    allEntries.forEach(e => {
      const t = mapType(e.initiatorType);
      if (!groups[t]) groups[t] = [];
      groups[t].push(e);
    });
    let groupedHtml = '';
    for (const [type, items] of Object.entries(groups)) {
      const totalSize = items.reduce((s, e) => s + (e.transferSize || 0), 0);
      groupedHtml += `<div class="grouped-section"><h4>${escapeHtml(type)} (${items.length}个, ${formatSize(totalSize)})</h4>`;
      groupedHtml += '<table class="result-table"><thead><tr><th>URL</th><th>大小</th><th>耗时</th></tr></thead><tbody>';
      for (const e of items) {
        groupedHtml += `<tr><td title="${escapeHtml(e.name)}">${escapeHtml(e.name.length > 80 ? e.name.substring(0, 80) + '...' : e.name)}</td><td>${formatSize(e.transferSize)}</td><td>${formatDuration(e.duration)}</td></tr>`;
      }
      groupedHtml += '</tbody></table></div>';
    }
    groupedArea.innerHTML = groupedHtml || '<div class="info-placeholder">无数据</div>';

    // Slow requests (>1s)
    const slowEntries = allEntries.filter(e => e.duration > 1000).sort((a, b) => b.duration - a.duration);
    renderRequestTable(slowEntries, slowArea, true, false);
    if (slowEntries.length === 0) slowArea.innerHTML = '<div class="info-placeholder">无慢请求 (>1s)</div>';

    // Large requests (>1MB)
    const largeEntries = allEntries.filter(e => e.transferSize > 1048576).sort((a, b) => b.transferSize - a.transferSize);
    renderRequestTable(largeEntries, largeArea, false, true);
    if (largeEntries.length === 0) largeArea.innerHTML = '<div class="info-placeholder">无大请求 (>1MB)</div>';

    // Timeline view
    if (timelineArea) {
      if (allEntries.length === 0) {
        timelineArea.innerHTML = '<div class="info-placeholder">无数据</div>';
      } else {
        const minTime = Math.min(...allEntries.map(e => e.startTime || 0));
        const maxTime = Math.max(...allEntries.map(e => e.responseEnd || 0));
        const totalSpan = maxTime - minTime || 1;
        let tlHtml = '<div class="timeline-container">';
        allEntries.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
        for (const e of allEntries) {
          const start = ((e.startTime || 0) - minTime) / totalSpan * 100;
          const width = Math.max(2, ((e.responseEnd || e.startTime || 0) - (e.startTime || 0)) / totalSpan * 100);
          const type = mapType(e.initiatorType);
          const color = type === 'Document' ? '#4285f4' : type === 'Script' ? '#fbbc04' : type === 'Stylesheet' ? '#34a853' : type === 'Image' ? '#ea4335' : type === 'Font' ? '#9c27b0' : type === 'XHR' ? '#ff6d00' : '#757575';
          tlHtml += `<div class="timeline-row">
            <div class="timeline-label" title="${escapeHtml(e.name)}">${escapeHtml(e.name.length > 40 ? e.name.substring(0, 40) + '...' : e.name)}</div>
            <div class="timeline-bar-area"><div class="timeline-bar" style="left:${start}%;width:${width}%;background:${color}" title="${formatDuration(e.duration)} · ${formatSize(e.transferSize)} · ${type}"></div></div>
            <div class="timeline-dur">${formatDuration(e.duration)}</div>
          </div>`;
        }
        tlHtml += '</div>';
        timelineArea.innerHTML = tlHtml;
      }
    }

    // Third party requests
    const thirdParty = allEntries.filter(e => {
      const d = getDomain(e.name);
      return d && d !== pageDomain && !d.endsWith('.' + pageDomain);
    });
    renderRequestTable(thirdParty, thirdpartyArea, false, false);
    if (thirdParty.length === 0) thirdpartyArea.innerHTML = '<div class="info-placeholder">无第三方请求</div>';

    // Security analysis
    let secHtml = '<div class="security-section">';
    const httpResources = allEntries.filter(e => e.name.startsWith('http://'));
    if (httpResources.length > 0) {
      secHtml += `<div class="security-item security-item--danger">🚨 混合内容: 发现 ${httpResources.length} 个不安全HTTP资源</div>`;
    }
    const trackingDomains = ['google-analytics.com', 'googletagmanager.com', 'facebook.net', 'doubleclick.net', 'analytics', 'track', 'pixel', 'hotjar.com', 'mixpanel.com'];
    const trackingRequests = allEntries.filter(e => {
      const d = getDomain(e.name).toLowerCase();
      return trackingDomains.some(td => d.includes(td));
    });
    if (trackingRequests.length > 0) {
      secHtml += `<div class="security-item security-item--warning">⚠️ 追踪脚本: 发现 ${trackingRequests.length} 个可能的追踪请求</div>`;
    }
    const thirdPartyDomains = [...new Set(thirdParty.map(e => getDomain(e.name)))];
    if (thirdPartyDomains.length > 0) {
      secHtml += `<div class="security-item security-item--info">ℹ️ 第三方域名 (${thirdPartyDomains.length}): ${escapeHtml(thirdPartyDomains.slice(0, 10).join(', '))}${thirdPartyDomains.length > 10 ? '...' : ''}</div>`;
    }
    if (httpResources.length === 0 && trackingRequests.length === 0 && thirdPartyDomains.length === 0) {
      secHtml += '<div class="security-item security-item--info">✅ 未发现明显安全问题</div>';
    }
    secHtml += '</div>';
    securityArea.innerHTML = secHtml;
  }

  // Tab switching
  tabBar.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('tab-content--active'));
    tab.classList.add('active');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('tab-content--active');
  });

  // Filter/sort change
  filterType.addEventListener('change', () => { if (allEntries.length > 0) renderAll(); });
  sortBy.addEventListener('change', () => { if (allEntries.length > 0) renderAll(); });
  filterDomain.addEventListener('input', () => { if (allEntries.length > 0) renderAll(); });
  if (filterSearch) filterSearch.addEventListener('input', () => { if (allEntries.length > 0) renderAll(); });
  if (filterSize) filterSize.addEventListener('change', () => { if (allEntries.length > 0) renderAll(); });

  // Analyze current page
  btnAnalyze.addEventListener('click', () => {
    btnAnalyze.disabled = true;
    requestsArea.innerHTML = '<div class="info-placeholder">⏳ 正在分析...</div>';

    const timeout = setTimeout(() => {
      requestsArea.innerHTML = '<div class="info-placeholder">⏱️ 分析超时（10秒），请重试</div>';
      btnAnalyze.disabled = false;
    }, 10000);

    callBackground(
      'getNetworkAnalysis', null
    ).then((response) => {
      clearTimeout(timeout);
      if (!response || !response.success || !response.entries) {
        requestsArea.innerHTML = '<div class="info-placeholder">无法获取网络数据，请确保页面已加载完成</div>';
        btnAnalyze.disabled = false;
        return;
      }
      if (response.pageDomain) pageDomain = response.pageDomain;
      processEntries(response.entries);
    }).catch(() => {
      clearTimeout(timeout);
      requestsArea.innerHTML = '<div class="info-placeholder">无法获取网络数据，请确保页面已加载完成</div>';
      btnAnalyze.disabled = false;
    });
  });

  function processEntries(entries) {
    allEntries = entries || [];
    overviewBar.style.display = 'flex';
    updateOverview();
    renderAll();
    btnAnalyze.disabled = false;
    showToast(`分析完成，共 ${allEntries.length} 个请求`);
    saveToHistory(allEntries.length);
  }

  // Export JSON
  btnExport.addEventListener('click', () => {
    if (allEntries.length === 0) { showToast('无数据可导出', 'error'); return; }
    const data = allEntries.map(e => ({
      url: e.name,
      type: mapType(e.initiatorType),
      initiatorType: e.initiatorType,
      duration: e.duration,
      transferSize: e.transferSize,
      startTime: e.startTime,
      responseEnd: e.responseEnd
    }));
    const json = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(json).then(() => showToast('已导出JSON到剪贴板')).catch(() => showToast('导出失败', 'error'));
  });

  // Export HAR
  if (btnExportHar) {
    btnExportHar.addEventListener('click', () => {
      if (allEntries.length === 0) { showToast('无数据可导出', 'error'); return; }
      const har = {
        log: {
          version: '1.2',
          creator: { name: 'Network Analyzer', version: '1.0' },
          entries: allEntries.map(e => ({
            startedDateTime: new Date(performance.timeOrigin + (e.startTime || 0)).toISOString(),
            time: e.duration || 0,
            request: {
              method: e.method || 'GET',
              url: e.name,
              httpVersion: 'HTTP/1.1',
              headers: [],
              queryString: [],
              headersSize: -1,
              bodySize: -1
            },
            response: {
              status: e.status || 0,
              statusText: '',
              httpVersion: 'HTTP/1.1',
              headers: [],
              content: { size: e.transferSize || 0, mimeType: e.initiatorType || '' },
              redirectURL: '',
              headersSize: -1,
              bodySize: e.transferSize || -1
            },
            timings: { send: 0, wait: 0, receive: e.duration || 0 }
          }))
        }
      };
      const json = JSON.stringify(har, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'network-analysis.har'; a.click();
      URL.revokeObjectURL(url);
      showToast('HAR文件已导出');
    });
  }
  async function saveToHistory(count) {
    try {
      await callBackground('saveToHistory', { toolId: 'network-analyzer', type: 'analyze', data: { count } });
    } catch (e) {}
  }
});

window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
});
