/**
 * 网页安全扫描器
 * 扫描当前页面安全状态：HTTPS、混合内容、安全头、Cookie安全、表单安全、第三方资源
 */
(function () {
  'use strict';

  // DOM 引用（在 init() 中初始化，确保 DOM 就绪）
  let $scanBtn, $url, $scoreSection, $ringFill, $scoreNum, $scoreLabel, $list, $toast, $exportBtn, $loading;

  // 最近一次扫描结果（用于导出）
  let _lastScanResults = null;
  let _lastScanUrl = '';
  let _lastScanScore = 0;

  const CIRCUMFERENCE = 2 * Math.PI * 42; // ≈ 263.89

  // ── PostMessage 通信路由 ──
  // 工具 iframe 通过 window.parent.postMessage → sidebar 代理 → background/content script
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
        // background 返回 { success: false, error } 时视为失败
        if (action === '__bgResponse' && result && result.success === false && result.error) {
          pending.reject(new Error(result.error));
        } else {
          pending.resolve(result);
        }
      }
    }
  }

  // ── Helpers ──

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function showToast(msg, type) {
    $toast.textContent = msg;
    $toast.className = 'toast toast--' + (type || 'info');
    $toast.classList.add('toast--show');
    setTimeout(() => $toast.classList.remove('toast--show'), 3000);
  }

  /**
   * 通过 sidebar 代理调用 background handler
   * 路由: tool iframe → postMessage → sidebar callBackground → chrome.runtime.sendMessage → background
   * 响应: background → sidebar → postMessage(__bgResponse) → tool iframe
   */
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

  /**
   * 通过 sidebar 代理调用 content script (injector)
   * 路由: tool iframe → postMessage → sidebar sendToContent → postMessage → injector
   * 响应: injector → postMessage(__contentResponse) → sidebar → postMessage → tool iframe
   */
  function callContentScript(tabId, action, data) {
    return new Promise((resolve, reject) => {
      const id = ++_msgId;
      const timer = setTimeout(() => {
        _pendingMsgs.delete(id);
        reject(new Error('Content script call timeout'));
      // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
      // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
      // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
    // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
    }, 70000);
      _pendingMsgs.set(id, { resolve, reject, timer });
      window.parent.postMessage({ action: 'sendToContent', data: { id, action, data } }, '*');
    });
  }

  function badgeIcon(status) {
    if (status === 'pass') return '✓';
    if (status === 'warn') return '!';
    if (status === 'fail') return '✗';
    return 'i';
  }

  function statusText(status) {
    if (status === 'pass') return '通过';
    if (status === 'warn') return '警告';
    if (status === 'fail') return '不安全';
    return '信息';
  }

  // ── 漏洞等级分类 (高/中/低/信息) ──
  // 根据 status 与 title 自动推断漏洞严重等级
  function classifySeverity(result) {
    // 高危：直接威胁数据安全/可被远程利用
    const highKeywords = ['HTTPS 检查', '表单安全', 'CSP 深度分析', '混合内容检测', 'HSTS'];
    // 中危：削弱防护但非直接漏洞
    const mediumKeywords = ['Cookie 安全', 'SRI', 'CSP 深度分析'];
    if (result.status === 'fail') {
      // fail 中包含高危关键词为高，否则为中
      if (highKeywords.some(k => result.title.includes(k))) return 'high';
      return 'medium';
    }
    if (result.status === 'warn') {
      if (mediumKeywords.some(k => result.title.includes(k))) return 'medium';
      return 'low';
    }
    if (result.status === 'pass') return 'info';
    return 'info';
  }

  function severityLabel(sev) {
    const map = { high: '高危', medium: '中危', low: '低危', info: '信息' };
    return map[sev] || sev;
  }

  // ── Security Grade (A-F) ──
  function getSecurityGrade(score) {
    if (score >= 90) return { grade: 'A', label: '优秀', color: '#4caf50' };
    if (score >= 75) return { grade: 'B', label: '良好', color: '#8bc34a' };
    if (score >= 55) return { grade: 'C', label: '一般', color: '#ff9800' };
    if (score >= 35) return { grade: 'D', label: '较差', color: '#f44336' };
    return { grade: 'F', label: '危险', color: '#9c27b0' };
  }

  // ── CSP Analysis ──
  function analyzeCSP(cspValue) {
    if (!cspValue) return { issues: [], score: 0, maxScore: 15, directives: [] };
    const issues = [];
    let score = 15;
    const directives = cspValue.split(';').map(d => d.trim()).filter(Boolean);

    if (cspValue.includes("'unsafe-inline'")) {
      issues.push("包含 'unsafe-inline'，允许内联脚本/样式，削弱 XSS 防护");
      score -= 5;
    }
    if (cspValue.includes("'unsafe-eval'")) {
      issues.push("包含 'unsafe-eval'，允许 eval() 动态代码执行");
      score -= 4;
    }
    if (cspValue.includes('*')) {
      issues.push("使用通配符 *，允许从任意来源加载资源");
      score -= 3;
    }
    if (!cspValue.includes('default-src')) {
      issues.push("未设置 default-src 回退策略");
      score -= 2;
    }
    if (!cspValue.includes('script-src')) {
      issues.push("未设置 script-src，脚本来源不受限");
      score -= 2;
    }
    if (cspValue.includes('object-src') && cspValue.includes("'none'")) {
      // Good: object-src 'none'
    } else {
      issues.push("建议设置 object-src 'none' 以阻止插件加载");
      score -= 1;
    }
    return { issues, score: Math.max(0, score), maxScore: 15, directives };
  }

  // ── SRI Check via content script ──

  // ── Score rendering ──

  function renderScore(score) {
    $scoreSection.style.display = '';
    const grade = getSecurityGrade(score);
    const level = score >= 70 ? 'green' : score >= 40 ? 'yellow' : 'red';
    $scoreSection.setAttribute('data-level', level);
    const offset = CIRCUMFERENCE - (CIRCUMFERENCE * score / 100);
    $ringFill.style.strokeDashoffset = offset;
    $scoreNum.textContent = score;

    if (score >= 90) $scoreLabel.textContent = '安全状态：优秀 (' + grade.grade + ')';
    else if (score >= 75) $scoreLabel.textContent = '安全状态：良好 (' + grade.grade + ')';
    else if (score >= 55) $scoreLabel.textContent = '安全状态：一般 (' + grade.grade + ')';
    else if (score >= 35) $scoreLabel.textContent = '安全状态：较差 (' + grade.grade + ')';
    else $scoreLabel.textContent = '安全状态：危险 (' + grade.grade + ')';

    // 在分数区域添加等级标记
    let gradeEl = document.getElementById('ss-grade-badge');
    if (!gradeEl) {
      gradeEl = document.createElement('div');
      gradeEl.id = 'ss-grade-badge';
      gradeEl.style.cssText = 'text-align:center;font-size:28px;font-weight:bold;margin-top:4px;';
      $scoreNum.parentElement.appendChild(gradeEl);
    }
    gradeEl.textContent = grade.grade;
    gradeEl.style.color = grade.color;
  }

  // ── Results rendering ──

  function renderResults(results) {
    // 统计各严重等级数量
    const sevCounts = { high: 0, medium: 0, low: 0, info: 0 };
    results.forEach(r => {
      r._severity = classifySeverity(r);
      sevCounts[r._severity]++;
    });

    $list.innerHTML = results.map(r => {
      const bi = badgeIcon(r.status);
      const st = statusText(r.status);
      const sev = r._severity;
      const sevLbl = severityLabel(sev);
      let bodyHtml = '';
      if (r.details && r.details.length) {
        bodyHtml += '<ul>' + r.details.map(d => '<li>' + escapeHtml(d) + '</li>').join('') + '</ul>';
      }
      if (r.recommend) {
        bodyHtml += '<div class="ss-recommend">💡 ' + escapeHtml(r.recommend) + '</div>';
      }
      return `
        <div class="ss-item">
          <div class="ss-item-head">
            <span class="ss-item-badge ss-item-badge--${r.status}">${bi}</span>
            <span class="ss-item-title">${escapeHtml(r.title)}</span>
            <span class="ss-severity ss-severity--${sev}" title="漏洞严重等级">${sevLbl}</span>
            <span class="ss-item-status ss-item-status--${r.status}">${st}</span>
          </div>
          ${bodyHtml ? '<div class="ss-item-body">' + bodyHtml + '</div>' : ''}
        </div>
      `;
    }).join('');

    // 渲染漏洞等级汇总 + 修复建议列表
    renderSeveritySummary(sevCounts, results);
  }

  // ── 漏洞等级汇总 + 修复建议列表 ──
  function renderSeveritySummary(sevCounts, results) {
    let summaryEl = document.getElementById('ss-severity-summary');
    if (!summaryEl) {
      summaryEl = document.createElement('div');
      summaryEl.id = 'ss-severity-summary';
      summaryEl.className = 'ss-severity-summary';
      $list.parentElement.insertBefore(summaryEl, $list);
    }
    const total = sevCounts.high + sevCounts.medium + sevCounts.low;
    summaryEl.innerHTML = `
      <div class="ss-sev-head">📋 漏洞等级汇总${total > 0 ? '' : '（未发现漏洞）'}</div>
      <div class="ss-sev-stats">
        <span class="ss-sev-chip ss-severity--high">高危 ${sevCounts.high}</span>
        <span class="ss-sev-chip ss-severity--medium">中危 ${sevCounts.medium}</span>
        <span class="ss-sev-chip ss-severity--low">低危 ${sevCounts.low}</span>
        <span class="ss-sev-chip ss-severity--info">信息 ${sevCounts.info}</span>
      </div>
    `;

    // 修复建议列表
    const fixList = results.filter(r => r.recommend && r.status !== 'pass' && r.status !== 'info');
    let fixEl = document.getElementById('ss-fix-list');
    if (!fixEl) {
      fixEl = document.createElement('div');
      fixEl.id = 'ss-fix-list';
      fixEl.className = 'ss-fix-list';
      $list.parentElement.appendChild(fixEl);
    }
    if (fixList.length === 0) {
      fixEl.style.display = 'none';
    } else {
      fixEl.style.display = '';
      fixEl.innerHTML = '<div class="ss-fix-head">🔧 修复建议清单</div>' +
        '<ol class="ss-fix-ol">' +
          fixList.map(r => {
            const sev = r._severity;
            return '<li><span class="ss-severity ss-severity--' + sev + '">' + severityLabel(sev) + '</span>' +
              '<span class="ss-fix-title">' + escapeHtml(r.title) + '</span>' +
              '<div class="ss-fix-text">💡 ' + escapeHtml(r.recommend) + '</div></li>';
          }).join('') +
        '</ol>';
    }
  }

  // ── Security checks ──

  async function scanPage() {
    $scanBtn.disabled = true;
    $scanBtn.textContent = '⏳ 扫描中...';
    $list.innerHTML = '<div class="ss-empty">⏳ 正在扫描页面安全状态...</div>';
    $scoreSection.style.display = 'none';
    if ($exportBtn) $exportBtn.style.display = 'none';
    if (window.__ssExportJsonBtn) window.__ssExportJsonBtn.style.display = 'none';
    if ($loading) $loading.style.display = 'flex';

    try {
      // Get active tab via background
      const tabInfo = await callBackground('getTabInfo', null);
      if (!tabInfo || !tabInfo.data || !tabInfo.data.url) {
        showToast('无法获取当前标签页', 'error');
        return;
      }
      const tabUrl = tabInfo.data.url;
      _lastScanUrl = tabUrl;

      // Display URL
      try {
        const u = new URL(tabUrl);
        $url.textContent = u.host + u.pathname.substring(0, 80);
      } catch (e) {
        $url.textContent = tabUrl.substring(0, 100);
      }

      const results = [];
      let totalScore = 0;
      let maxScore = 0;

      // ── 1. HTTPS Check ──
      const isHttps = tabUrl.startsWith('https://');
      const isHttp = tabUrl.startsWith('http://');
      const isSpecial = !isHttps && !isHttp; // chrome://, about:, etc.
      if (isSpecial) {
        results.push({
          title: 'HTTPS 检查',
          status: 'info',
          details: ['当前页面为特殊协议页面（如 chrome://、about:），不适用 HTTPS 检查'],
          recommend: 'HTTPS 检查仅适用于 http/https 协议页面'
        });
        totalScore += 20; maxScore += 20;
      } else if (isHttps) {
        results.push({
          title: 'HTTPS 检查',
          status: 'pass',
          details: ['页面使用 HTTPS 加密连接', 'URL: ' + tabUrl.split('?')[0]],
        });
        totalScore += 20; maxScore += 20;
      } else {
        results.push({
          title: 'HTTPS 检查',
          status: 'fail',
          details: ['页面未使用 HTTPS，数据传输未加密', '当前协议: HTTP'],
          recommend: '建议启用 HTTPS，确保数据传输安全。联系网站管理员配置 SSL 证书。'
        });
        maxScore += 20;
      }

      // ── 2. Mixed Content Check ──
      if (isHttps) {
        let pageData = null;
        try {
          pageData = await callContentScript(null, 'securityScan_collectPageInfo', null);
        } catch (e) {
          // content script may not be injected
        }

        if (pageData && pageData.mixedContent && pageData.mixedContent.length > 0) {
          results.push({
            title: '混合内容检查',
            status: 'warn',
            details: pageData.mixedContent.slice(0, 10).map(m => m.type + ': ' + m.url.substring(0, 80)),
            recommend: 'HTTPS 页面中加载了 HTTP 资源，可能导致混合内容警告。建议将所有资源链接改为 HTTPS。'
          });
          totalScore += 10; maxScore += 20;
        } else if (pageData) {
          results.push({
            title: '混合内容检查',
            status: 'pass',
            details: ['未发现混合内容（HTTP 资源在 HTTPS 页面中加载）'],
          });
          totalScore += 20; maxScore += 20;
        } else {
          results.push({
            title: '混合内容检查',
            status: 'info',
            details: ['无法检测混合内容（需要内容脚本支持）'],
            recommend: '刷新页面后重新扫描可检测混合内容'
          });
          totalScore += 15; maxScore += 20;
        }
      } else {
        results.push({
          title: '混合内容检查',
          status: 'info',
          details: ['非 HTTPS 页面，不适用混合内容检查'],
        });
        totalScore += 15; maxScore += 15;
      }

      // ── 3. Security Headers ──
      let headers = {};
      let headersAvailable = false;
      try {
        // Try to fetch headers via background script
        const headerResult = await callBackground('fetchSecurityHeaders', { url: tabUrl });
        if (headerResult && headerResult.headers) {
          headers = headerResult.headers;
          headersAvailable = true;
        }
      } catch (e) {
        // Fallback: try direct fetch (CORS may block)
        try {
          const resp = await fetch(tabUrl, { method: 'HEAD', mode: 'no-cors', credentials: 'omit' });
          // no-cors won't expose headers, so headers remain empty
        } catch (e2) { }
      }

      const securityHeaders = [
        { name: 'Strict-Transport-Security', label: 'HSTS', desc: '强制使用 HTTPS 连接', weight: 5 },
        { name: 'Content-Security-Policy', label: 'CSP', desc: '限制资源加载来源，防止 XSS', weight: 5 },
        { name: 'X-Content-Type-Options', label: 'X-Content-Type-Options', desc: '防止 MIME 类型嗅探', weight: 3 },
        { name: 'X-Frame-Options', label: 'X-Frame-Options', desc: '防止点击劫持', weight: 3 },
        { name: 'X-XSS-Protection', label: 'X-XSS-Protection', desc: '浏览器 XSS 过滤器', weight: 2 },
        { name: 'Referrer-Policy', label: 'Referrer-Policy', desc: '控制 Referer 头信息泄露', weight: 2 },
        { name: 'Permissions-Policy', label: 'Permissions-Policy', desc: '控制浏览器功能权限', weight: 2 },
        // 新增安全头检测
        { name: 'X-Permitted-Cross-Domain-Policies', label: 'X-Permitted-Cross-Domain-Policies', desc: '控制 Adobe Flash/PDF 跨域策略', weight: 1 },
        { name: 'Cross-Origin-Opener-Policy', label: 'COOP', desc: '防止跨源窗口隔离攻击（Spectre）', weight: 2 },
        { name: 'Cross-Origin-Resource-Policy', label: 'CORP', desc: '防止跨源资源被加载', weight: 2 },
        { name: 'Cross-Origin-Embedder-Policy', label: 'COEP', desc: '启用跨源隔离，保护 SharedArrayBuffer', weight: 1 },
        { name: 'Cache-Control', label: 'Cache-Control', desc: '控制缓存策略，防止敏感信息缓存', weight: 1 },
        { name: 'Clear-Site-Data', label: 'Clear-Site-Data', desc: '清除站点缓存/Cookie 等数据', weight: 1 },
        { name: 'X-DNS-Prefetch-Control', label: 'X-DNS-Prefetch-Control', desc: '控制 DNS 预取，减少隐私泄露', weight: 1 }
      ];

      if (headersAvailable) {
        const found = [];
        const missing = [];
        let headerScore = 0;
        let headerMax = 0;

        securityHeaders.forEach(h => {
          headerMax += h.weight;
          if (headers[h.name.toLowerCase()] || headers[h.name]) {
            found.push(h.label + ' ✓ — ' + h.desc);
            headerScore += h.weight;
          } else {
            missing.push(h.label + ' — ' + h.desc);
          }
        });

        totalScore += headerScore;
        maxScore += headerMax;

        results.push({
          title: '安全响应头',
          status: missing.length === 0 ? 'pass' : missing.length <= 2 ? 'warn' : 'fail',
          details: found.concat(missing.map(m => '缺失: ' + m)),
          recommend: missing.length > 0 ? '建议配置以下安全头: ' + missing.join(', ') : null
        });
      } else {
        // Cannot get headers - show info
        results.push({
          title: '安全响应头',
          status: 'info',
          details: [
            '无法获取响应头（CORS 限制或后台脚本未支持）',
            '安全头包括: HSTS, CSP, X-Frame-Options, X-Content-Type-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, X-Permitted-Cross-Domain-Policies, COOP/CORP/COEP, Cache-Control, Clear-Site-Data, X-DNS-Prefetch-Control'
          ],
          recommend: '如需检测安全响应头，请确保后台脚本支持 fetchSecurityHeaders 功能'
        });
        totalScore += 11; maxScore += 22;
      }

      // ── 3b. CSP Deep Analysis ──
      const cspValue = headers['content-security-policy'] || headers['Content-Security-Policy'] || null;
      if (cspValue) {
        const cspAnalysis = analyzeCSP(cspValue);
        if (cspAnalysis.issues.length > 0) {
          results.push({
            title: 'CSP 深度分析',
            status: cspAnalysis.score >= 10 ? 'warn' : 'fail',
            details: cspAnalysis.issues,
            recommend: 'CSP 策略存在安全弱点，建议加强配置。参考: https://content-security-policy.com/'
          });
        } else {
          results.push({
            title: 'CSP 深度分析',
            status: 'pass',
            details: ['CSP 策略配置良好，共 ' + cspAnalysis.directives.length + ' 条指令']
          });
        }
        totalScore += cspAnalysis.score; maxScore += cspAnalysis.maxScore;
      } else if (headersAvailable) {
        results.push({
          title: 'CSP 深度分析',
          status: 'fail',
          details: ['未设置 Content-Security-Policy 头，页面容易受到 XSS 和注入攻击'],
          recommend: '强烈建议配置 CSP，至少设置 default-src \'self\' 和 script-src \'self\''
        });
        maxScore += 15;
      }

      // ── 3c. HSTS Status Detection ──
      const hstsValue = headers['strict-transport-security'] || headers['Strict-Transport-Security'] || null;
      if (hstsValue) {
        const hstsDetails = [];
        const maxAgeMatch = hstsValue.match(/max-age=(\d+)/);
        const hasIncludeSubDomains = hstsValue.includes('includeSubDomains');
        const hasPreload = hstsValue.includes('preload');
        let hstsScore = 8;
        if (maxAgeMatch) {
          const age = parseInt(maxAgeMatch[1], 10);
          hstsDetails.push('max-age: ' + age + ' 秒 (约 ' + Math.round(age / 86400) + ' 天)');
          if (age < 2592000) { hstsDetails.push('⚠️ max-age 过短 (< 30天)'); hstsScore -= 3; }
          else if (age < 31536000) { hstsDetails.push('max-age 不足1年'); hstsScore -= 1; }
          else { hstsDetails.push('✓ max-age 设置合理 (>= 1年)'); }
        }
        if (hasIncludeSubDomains) { hstsDetails.push('✓ 包含 includeSubDomains'); }
        else { hstsDetails.push('⚠️ 未包含 includeSubDomains'); hstsScore -= 2; }
        if (hasPreload) { hstsDetails.push('✓ 包含 preload 指令'); }
        else { hstsDetails.push('⚠️ 未包含 preload 指令'); hstsScore -= 1; }
        results.push({
          title: 'HSTS 状态检测',
          status: hstsScore >= 6 ? 'pass' : 'warn',
          details: hstsDetails,
          recommend: !hasPreload ? '建议添加 preload 指令以加入浏览器 HSTS 预加载列表' : null
        });
        totalScore += hstsScore; maxScore += 8;
      } else if (headersAvailable && isHttps) {
        results.push({
          title: 'HSTS 状态检测',
          status: 'fail',
          details: ['HTTPS 页面未设置 HSTS，浏览器可能通过 HTTP 访问站点'],
          recommend: '建议添加 Strict-Transport-Security: max-age=31536000; includeSubDomains; preload'
        });
        maxScore += 8;
      }

      // ── 3d. Mixed Content Deep Detection ──
      if (isHttps) {
        let pageData = null;
        try {
          pageData = await callContentScript(null, 'securityScan_collectPageInfo', null);
        } catch (e) {}

        if (pageData) {
          // HTTP resources on HTTPS page
          const httpResources = (pageData.thirdPartyResources || [])
            .filter(r => r.url && r.url.startsWith('http://'))
            .concat((pageData.mixedContent || []));
          if (httpResources.length > 0) {
            results.push({
              title: '混合内容检测 (HTTP@HTTPS)',
              status: 'fail',
              details: ['发现 ' + httpResources.length + ' 个 HTTP 资源在 HTTPS 页面中加载'].concat(
                httpResources.slice(0, 5).map(r => (r.type || 'resource') + ': ' + (r.url || r.domain || '').substring(0, 80))
              ),
              recommend: 'HTTPS 页面中的 HTTP 资源会触发混合内容警告，建议将所有资源升级为 HTTPS。可在 <head> 中添加 <meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">'
            });
            totalScore += 5; maxScore += 15;
          } else {
            results.push({
              title: '混合内容检测 (HTTP@HTTPS)',
              status: 'pass',
              details: ['未发现混合内容，所有资源均通过安全协议加载']
            });
            totalScore += 15; maxScore += 15;
          }
        }
      }

      // ── 3e. SRI (Subresource Integrity) Check ──
      try {
        const sriData = await callContentScript(null, 'securityScan_collectPageInfo', null);
        if (sriData && sriData.externalScripts) {
          const externalScripts = sriData.externalScripts || [];
          const noIntegrity = externalScripts.filter(s => !s.integrity);
          if (externalScripts.length > 0 && noIntegrity.length > 0) {
            results.push({
              title: 'SRI (子资源完整性) 检测',
              status: noIntegrity.length > 3 ? 'fail' : 'warn',
              details: [
                '外部脚本: ' + externalScripts.length + ' 个',
                '缺少 integrity 属性: ' + noIntegrity.length + ' 个'
              ].concat(noIntegrity.slice(0, 5).map(s => '无SRI: ' + (s.src || 'inline').substring(0, 80))),
              recommend: '建议为外部脚本添加 integrity 和 crossorigin 属性，防止篡改。生成工具: https://www.srihash.org/'
            });
            totalScore += noIntegrity.length <= 1 ? 8 : 4; maxScore += 10;
          } else if (externalScripts.length > 0) {
            results.push({
              title: 'SRI (子资源完整性) 检测',
              status: 'pass',
              details: ['所有 ' + externalScripts.length + ' 个外部脚本均已设置 integrity 属性']
            });
            totalScore += 10; maxScore += 10;
          }
        }
      } catch (e) {}

      // ── 4. Cookie Security (Enhanced) ──
      try {
        const cookieResult = await callBackground('getAllCookies', { domain: (function () { try { return new URL(tabUrl).hostname; } catch (e) { return ''; } })() });
        if (cookieResult && cookieResult.cookies && cookieResult.cookies.length > 0) {
          const cookies = cookieResult.cookies;
          const insecureCookies = [];
          const noHttpOnly = [];
          const noSameSite = [];
          const sameSiteLax = [];
          const sessionCookies = [];

          cookies.forEach(c => {
            if (isHttps && !c.secure) insecureCookies.push(c.name);
            if (!c.httpOnly && !c.session) noHttpOnly.push(c.name);
            if (!c.sameSite || c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') noSameSite.push(c.name);
            else if (c.sameSite === 'lax') sameSiteLax.push(c.name);
            if (c.session) sessionCookies.push(c.name);
          });

          const issues = [];
          let cookieScore = 15;
          const cookieMax = 15;

          if (insecureCookies.length > 0) {
            issues.push(insecureCookies.length + ' 个 Cookie 缺少 Secure 标志: ' + insecureCookies.slice(0, 5).join(', '));
            cookieScore -= 5;
          }
          if (noHttpOnly.length > 0) {
            issues.push(noHttpOnly.length + ' 个非 session Cookie 缺少 HttpOnly 标志: ' + noHttpOnly.slice(0, 5).join(', '));
            cookieScore -= 3;
          }
          if (noSameSite.length > 0) {
            issues.push(noSameSite.length + ' 个 Cookie 缺少 SameSite 属性: ' + noSameSite.slice(0, 5).join(', '));
            cookieScore -= 3;
          }
          if (sameSiteLax.length > 0) {
            issues.push(sameSiteLax.length + ' 个 Cookie SameSite=Lax (可接受但不够严格): ' + sameSiteLax.slice(0, 5).join(', '));
          }
          if (sessionCookies.length > 0) {
            issues.push(sessionCookies.length + ' 个会话 Cookie (浏览器关闭后删除)');
          }

          totalScore += Math.max(0, cookieScore);
          maxScore += cookieMax;

          if (issues.length === 0) {
            results.push({
              title: 'Cookie 安全',
              status: 'pass',
              details: ['共 ' + cookies.length + ' 个 Cookie，均设置了安全标志'],
            });
          } else {
            results.push({
              title: 'Cookie 安全',
              status: cookieScore >= 10 ? 'warn' : 'fail',
              details: issues,
              recommend: '建议为 Cookie 设置 Secure（仅 HTTPS 传输）、HttpOnly（防 XSS 读取）、SameSite=Strict（防 CSRF）标志'
            });
          }
        } else {
          results.push({
            title: 'Cookie 安全',
            status: 'pass',
            details: ['当前域名未发现 Cookie'],
          });
          totalScore += 15; maxScore += 15;
        }
      } catch (e) {
        results.push({
          title: 'Cookie 安全',
          status: 'info',
          details: ['无法读取 Cookie（可能缺少 cookies 权限）'],
        });
        totalScore += 10; maxScore += 15;
      }

      // ── 5. Form Security ──
      let pageData2 = null;
      try {
        pageData2 = await callContentScript(null, 'securityScan_collectPageInfo', null);
      } catch (e) { }

      if (pageData2 && pageData2.forms !== undefined) {
        const insecureForms = pageData2.forms || [];
        if (insecureForms.length > 0) {
          results.push({
            title: '表单安全',
            status: 'fail',
            details: insecureForms.slice(0, 5).map(f => '表单提交至 HTTP: ' + f.action.substring(0, 80)),
            recommend: '表单通过 HTTP 提交会导致用户数据明文传输，强烈建议使用 HTTPS action 地址'
          });
          totalScore += 0; maxScore += 10;
        } else {
          results.push({
            title: '表单安全',
            status: 'pass',
            details: isHttps ? ['所有表单均提交至安全地址'] : ['页面未使用 HTTPS，但表单提交地址未见不安全'],
          });
          totalScore += 10; maxScore += 10;
        }
      } else {
        results.push({
          title: '表单安全',
          status: 'info',
          details: ['无法检测表单安全状态（需要内容脚本支持）'],
        });
        totalScore += 7; maxScore += 10;
      }

      // ── 6. Third-Party Resources ──
      if (pageData2 && pageData2.thirdPartyResources !== undefined) {
        const thirdParty = pageData2.thirdPartyResources || [];
        if (thirdParty.length === 0) {
          results.push({
            title: '第三方资源',
            status: 'pass',
            details: ['未检测到第三方资源加载'],
          });
          totalScore += 10; maxScore += 10;
        } else if (thirdParty.length <= 5) {
          results.push({
            title: '第三方资源',
            status: 'warn',
            details: ['检测到 ' + thirdParty.length + ' 个第三方域名的资源'].concat(
              thirdParty.slice(0, 8).map(d => d.domain + ' (' + d.count + ' 个资源)')
            ),
            recommend: '第三方资源可能存在安全隐患，建议审查第三方域名可信度'
          });
          totalScore += 7; maxScore += 10;
        } else {
          results.push({
            title: '第三方资源',
            status: 'warn',
            details: ['检测到 ' + thirdParty.length + ' 个第三方域名的资源'].concat(
              thirdParty.slice(0, 8).map(d => d.domain + ' (' + d.count + ' 个资源)')
            ),
            recommend: '加载了大量第三方资源，建议减少第三方依赖，审查各域名的安全性'
          });
          totalScore += 4; maxScore += 10;
        }
      } else {
        results.push({
          title: '第三方资源',
          status: 'info',
          details: ['无法检测第三方资源（需要内容脚本支持）'],
        });
        totalScore += 7; maxScore += 10;
      }

      // ── Calculate score ──
      const finalScore = maxScore > 0 ? Math.round(totalScore / maxScore * 100) : 0;
      _lastScanResults = results;
      _lastScanScore = finalScore;
      renderScore(finalScore);
      renderResults(results);

      // 显示导出报告按钮
      if ($exportBtn) $exportBtn.style.display = '';
      if (window.__ssExportJsonBtn) window.__ssExportJsonBtn.style.display = '';

      // Save to history
      try {
        await callBackground('saveToHistory', { toolId: 'security-scanner', type: 'scan', data: { url: tabUrl, score: finalScore } });
      } catch (e) { }

    } catch (error) {
      showToast('扫描失败: ' + error.message, 'error');
      $list.innerHTML = '<div class="ss-empty">❌ 扫描失败: ' + escapeHtml(error.message) + '</div>';
    } finally {
      $scanBtn.disabled = false;
      $scanBtn.textContent = '🛡️ 扫描当前页面';
      if ($loading) $loading.style.display = 'none';
    }
  }

  // ── 导出报告（JSON 格式） ──

  function exportReportJSON() {
    if (!_lastScanResults || !_lastScanResults.length) {
      showToast('没有可导出的扫描结果', 'warn');
      return;
    }
    const grade = getSecurityGrade(_lastScanScore);
    const report = {
      tool: 'security-scanner',
      version: '1.0',
      scanTime: new Date().toISOString(),
      url: _lastScanUrl,
      score: _lastScanScore,
      grade: grade.grade,
      gradeLabel: grade.label,
      findings: _lastScanResults.map(r => ({
        title: r.title,
        status: r.status,
        severity: r._severity || classifySeverity(r),
        severityLabel: severityLabel(r._severity || classifySeverity(r)),
        details: r.details || [],
        recommendation: r.recommend || null
      })),
      summary: {
        total: _lastScanResults.length,
        high: _lastScanResults.filter(r => (r._severity || classifySeverity(r)) === 'high').length,
        medium: _lastScanResults.filter(r => (r._severity || classifySeverity(r)) === 'medium').length,
        low: _lastScanResults.filter(r => (r._severity || classifySeverity(r)) === 'low').length,
        info: _lastScanResults.filter(r => (r._severity || classifySeverity(r)) === 'info').length,
        failed: _lastScanResults.filter(r => r.status === 'fail').length,
        warned: _lastScanResults.filter(r => r.status === 'warn').length,
        passed: _lastScanResults.filter(r => r.status === 'pass').length
      }
    };
    const json = JSON.stringify(report, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'security-scan-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('JSON 报告已导出', 'info');
  }

  // ── 导出报告 ──

  function exportReport() {
    if (!_lastScanResults || !_lastScanResults.length) {
      showToast('没有可导出的扫描结果', 'warn');
      return;
    }
    const lines = [];
    lines.push('=== 网页安全扫描报告 ===');
    lines.push('URL: ' + _lastScanUrl);
    const grade = getSecurityGrade(_lastScanScore);
    lines.push('安全评分: ' + _lastScanScore + '/100 (' + grade.grade + ' - ' + grade.label + ')');
    lines.push('扫描时间: ' + new Date().toLocaleString('zh-CN'));
    lines.push('');
    _lastScanResults.forEach(r => {
      const statusMap = { pass: '✓ 通过', warn: '! 警告', fail: '✗ 不安全', info: 'i 信息' };
      lines.push('【' + (statusMap[r.status] || r.status) + '】' + r.title);
      if (r.details && r.details.length) {
        r.details.forEach(d => lines.push('  - ' + d));
      }
      if (r.recommend) {
        lines.push('  💡 ' + r.recommend);
      }
      lines.push('');
    });
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      showToast('报告已复制到剪贴板', 'info');
    }).catch(() => {
      // 降级：使用 textarea 复制
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showToast('报告已复制到剪贴板', 'info'); }
      catch (e) { showToast('复制失败，请手动复制', 'error'); }
      document.body.removeChild(ta);
    });
  }

  // ── 初始化 ──

  function init() {
    // 获取 DOM 元素引用
    $scanBtn = document.getElementById('btn-scan');
    $url = document.getElementById('ss-url');
    $scoreSection = document.getElementById('ss-score-section');
    $ringFill = document.getElementById('ss-ring-fill');
    $scoreNum = document.getElementById('ss-score-num');
    $scoreLabel = document.getElementById('ss-score-label');
    $list = document.getElementById('ss-list');
    $toast = document.getElementById('toast');

    // 创建加载状态指示器
    $loading = document.createElement('div');
    $loading.className = 'ss-loading';
    $loading.style.cssText = 'display:none;align-items:center;justify-content:center;padding:8px 0;gap:6px;font-size:12px;color:var(--tt-text-secondary);';
    $loading.innerHTML = '<span class="ss-spinner" style="display:inline-block;width:14px;height:14px;border:2px solid var(--tt-border);border-top-color:var(--tt-primary);border-radius:50%;animation:ss-spin 0.8s linear infinite;"></span>扫描中...';
    // 添加 spinner 动画
    if (!document.getElementById('ss-spin-style')) {
      const style = document.createElement('style');
      style.id = 'ss-spin-style';
      style.textContent = '@keyframes ss-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(style);
    }
    const toolbar = document.querySelector('.ss-toolbar');
    if (toolbar) toolbar.after($loading);

    // 创建导出报告按钮
    $exportBtn = document.createElement('button');
    $exportBtn.className = 'btn';
    $exportBtn.textContent = '📋 导出报告';
    $exportBtn.style.cssText = 'display:none;font-size:12px;padding:4px 10px;background:var(--tt-bg-secondary);border:1px solid var(--tt-border);color:var(--tt-text);';
    $exportBtn.addEventListener('click', exportReport);
    if (toolbar) toolbar.appendChild($exportBtn);

    // 创建 JSON 导出报告按钮
    const $exportJsonBtn = document.createElement('button');
    $exportJsonBtn.className = 'btn';
    $exportJsonBtn.textContent = '📥 导出JSON';
    $exportJsonBtn.style.cssText = 'display:none;font-size:12px;padding:4px 10px;background:var(--tt-bg-secondary);border:1px solid var(--tt-border);color:var(--tt-text);';
    $exportJsonBtn.addEventListener('click', exportReportJSON);
    if (toolbar) toolbar.appendChild($exportJsonBtn);
    // 保存引用，以便扫描完成时显示
    window.__ssExportJsonBtn = $exportJsonBtn;

    // 扫描按钮事件
    $scanBtn.addEventListener('click', scanPage);

    // 监听 postMessage 响应（background/content script 回传）
    window.addEventListener('message', _handlePostMessageResponse);
  }

  document.addEventListener('DOMContentLoaded', init);

  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    // 响应路由已由 _handlePostMessageResponse 处理
    // 这里处理 setTheme / setData 等工具级消息
    const { action, data } = event.data;
    if (action === 'setTheme' && data) {
      document.documentElement.setAttribute('data-theme', data.theme);
    }
    if (action === 'setData') {
      if (data === 'scan' || (typeof data === 'object' && data.action === 'scan')) {
        scanPage();
      }
    }
  });
})();
