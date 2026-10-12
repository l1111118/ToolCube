document.addEventListener('DOMContentLoaded', () => {
  const domainInput = document.getElementById('domain-input');
  const btnCurrent = document.getElementById('btn-current');
  const btnCheck = document.getElementById('btn-check');
  const resultArea = document.getElementById('result-area');
  const toast = document.getElementById('toast');
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

  function safeStorage(op, ...args) {
    try {
      if (op === 'get') return chrome.storage.local.get(...args).catch(() => ({}));
      return chrome.storage.local[op](...args).catch(() => {});
    } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); }
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function showToast(msg, type = 'info') {
    toast.textContent = msg;
    toast.className = 'toast toast--' + type;
    toast.classList.add('toast--show');
    setTimeout(() => toast.classList.remove('toast--show'), 3000);
  }

  function extractDomain(input) {
    let domain = input.trim();
    if (!domain) return '';
    domain = domain.replace(/^https?:\/\//, '');
    domain = domain.replace(/\/.*$/, '');
    domain = domain.replace(/:\d+$/, '');
    return domain.toLowerCase();
  }

  // 检查当前页面按钮
  btnCurrent.addEventListener('click', async () => {
    try {
      const response = await callBackground('getTabInfo', null);
      if (response && response.success && response.data && response.data.url) {
        const domain = extractDomain(response.data.url);
        if (domain) {
          domainInput.value = domain;
          checkSSL();
        } else {
          showToast('无法获取当前页面域名', 'error');
        }
      } else {
        showToast('无法访问当前标签页', 'error');
      }
    } catch (e) {
      showToast('无法访问当前标签页', 'error');
    }
  });

  btnCheck.addEventListener('click', checkSSL);
  domainInput.addEventListener('keydown', e => { if (e.key === 'Enter') checkSSL(); });

  async function checkSSL() {
    const domain = extractDomain(domainInput.value);
    if (!domain) {
      showToast('请输入域名', 'error');
      return;
    }
    domainInput.value = domain;
    resultArea.innerHTML = '<div class="info-loading">⏳ 正在检查 SSL 证书...</div>';

    try {
      const results = await Promise.allSettled([
        checkHTTPS(domain),
        fetchCTLogs(domain),
        probeTransportSecurity(domain),
        checkHSTS(domain)
      ]);

      const httpsResult = results[0].status === 'fulfilled' ? results[0].value : null;
      const ctResult = results[1].status === 'fulfilled' ? results[1].value : null;
      const transportResult = results[2].status === 'fulfilled' ? results[2].value : null;
      const hstsResult = results[3].status === 'fulfilled' ? results[3].value : null;

      if (!httpsResult && !ctResult) {
        resultArea.innerHTML = '<div class="info-placeholder">❌ 无法获取证书信息，请检查域名是否正确</div>';
        return;
      }

      const cert = ctResult ? ctResult.currentCert : null;
      // 协议版本/加密套件/漏洞只能由外部服务完成完整握手后给出，页面侧无法探测
      const gradeResult = await fetchExternalGrade(domain);

      resultArea.innerHTML = renderResult(domain, httpsResult, ctResult, transportResult, hstsResult, gradeResult);
      saveToHistory(domain);
      // 检查到期提醒
      checkExpiryReminder(domain, cert);
    } catch (e) {
      resultArea.innerHTML = '<div class="info-placeholder">❌ 检查失败: ' + escapeHtml(e.message) + '</div>';
    }
  }

  /**
   * 探测「浏览器可观测」的传输安全事实。
   *
   * 页面侧能观测到的只有两件事：能否建立 HTTPS 连接、是否仍接受明文 HTTP。
   * TLS 协议版本与加密套件**无法**从页面探测（浏览器不向页面暴露握手细节）。
   *
   * 旧实现把 supportsTLS12/13 直接写成 true（注释写着"现代浏览器默认 TLS 1.2+"），
   * 于是界面永远显示"✅ 支持 TLS 1.2+/1.3"，这并非检测结果，而是伪造的结论。
   */
  async function probeTransportSecurity(domain) {
    const result = { httpsReachable: false, plainHttpReachable: false };
    try {
      await fetch('https://' + domain + '/', { method: 'HEAD', mode: 'no-cors', cache: 'no-cache', signal: AbortSignal.timeout(8000) });
      result.httpsReachable = true;
    } catch (e) {
      // 连接失败：可能是无证书、域名不可达或被网络策略拦截
    }
    try {
      await fetch('http://' + domain + '/', { method: 'HEAD', mode: 'no-cors', cache: 'no-cache', signal: AbortSignal.timeout(5000) });
      result.plainHttpReachable = true;
    } catch (e) {
      // 明文不可达（已强制 HTTPS 或端口未开放）
    }
    return result;
  }

  /**
   * 通过外部服务获取真实的 TLS 配置评级（协议版本、加密套件、已知漏洞）。
   *
   * 这些信息页面侧拿不到，只能由服务端完成完整握手后给出结论 —— 这正是
   * 「SSL/TLS 深度评级」服务类别存在的原因，可在设置里换成自建服务。
   *
   * @returns {Promise<{ok:boolean, status?:string, grade?:string, endpoints?:Array, error?:string}>}
   */
  async function fetchExternalGrade(domain) {
    try {
      const r = await callBackground('serviceRequest', { kind: 'ssl', params: { domain } });
      if (!r || !r.success) return { ok: false, error: (r && r.error) || '外部评级服务不可用' };
      return Object.assign({ ok: true }, r.data || {});
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // HSTS 检测 - 通过 background 代理获取 Strict-Transport-Security 头
  // （工具 iframe 直接 fetch 受 CORS 限制，无法读取跨域响应头，必须经 background 代理）
  async function checkHSTS(domain) {
    try {
      const resp = await callBackground('fetchHeaders', { url: 'https://' + domain + '/' });
      if (!resp || resp.success === false || !resp.headers) {
        return { enabled: null, header: null, maxAge: 0, error: resp?.error || 'No response' };
      }
      const hsts = resp.headers['strict-transport-security'] || resp.headers['Strict-Transport-Security'];
      const hstsEnabled = !!hsts;
      let maxAge = 0;
      if (hsts) {
        const m = hsts.match(/max-age=(\d+)/i);
        if (m) maxAge = parseInt(m[1], 10);
      }
      return { enabled: hstsEnabled, header: hsts, maxAge };
    } catch (e) {
      return { enabled: null, header: null, maxAge: 0, error: e.message };
    }
  }

  // 通过HTTPS连接检测
  async function checkHTTPS(domain) {
    const result = {
      httpsSupported: false,
      redirectsToHttps: false,
      connectionTime: null,
      error: null
    };

    try {
      const start = performance.now();
      const response = await fetch('https://' + domain + '/', {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-cache',
        signal: AbortSignal.timeout(10000)
      });
      const end = performance.now();
      result.httpsSupported = true;
      result.connectionTime = Math.round(end - start);
    } catch (e) {
      result.error = e.message;
      // 尝试HTTP
      try {
        await fetch('http://' + domain + '/', {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-cache',
          signal: AbortSignal.timeout(10000)
        });
      } catch (e2) {
        // 两种都不行
      }
    }

    // 检查HTTP->HTTPS重定向
    try {
      const httpResp = await fetch('http://' + domain + '/', {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(10000)
      });
      result.redirectsToHttps = httpResp.url && httpResp.url.startsWith('https://');
    } catch (e) {
      // ignore
    }

    return result;
  }

  // 通过证书透明度日志获取证书信息
  // 不再由工具直接 fetch crt.sh：地址应可被用户替换（自建 CT 网关 / 其他日志），
  // 且工具 iframe 受 CSP/CORS 限制。统一经 background 服务层（ct 类别）代取，
  // 工具只消费归一化结果 certificates[]，不再关心上游返回结构。
  async function fetchCTLogs(domain) {
    try {
      const r = await callBackground('serviceRequest', { kind: 'ct', params: { domain } });
      if (!r || !r.success) return null;
      const certificates = (r.data && r.data.certificates) || [];
      if (certificates.length === 0) return null;

      // 找到最新的、匹配域名的证书
      const now = new Date();
      let bestCert = null;
      let bestScore = -1;

      for (const entry of certificates) {
        const notBefore = new Date(entry.notBefore);
        const notAfter = new Date(entry.notAfter);
        const isCurrent = notBefore <= now && notAfter >= now;
        const nameMatch = entry.nameValue && entry.nameValue.includes(domain);

        let score = 0;
        if (isCurrent) score += 100;
        if (nameMatch) score += 50;
        score += notBefore.getTime() / 1e10; // prefer newer

        if (score > bestScore) {
          bestScore = score;
          bestCert = entry;
        }
      }

      if (!bestCert) bestCert = certificates[0];

      // 获取多个当前有效证书用于构建证书链信息
      const currentCerts = certificates.filter(e => {
        const nb = new Date(e.notBefore);
        const na = new Date(e.notAfter);
        return nb <= now && na >= now;
      }).sort((a, b) => new Date(b.notBefore) - new Date(a.notBefore));

      return {
        currentCert: parseCertEntry(bestCert, domain),
        allCurrentCerts: currentCerts.slice(0, 10).map(e => parseCertEntry(e, domain)),
        totalCerts: certificates.length
      };
    } catch (e) {
      return null;
    }
  }

  function parseCertEntry(entry, domain) {
    const notBefore = new Date(entry.notBefore);
    const notAfter = new Date(entry.notAfter);
    const now = new Date();
    const daysRemaining = Math.ceil((notAfter - now) / (1000 * 60 * 60 * 24));
    const totalDays = Math.ceil((notAfter - notBefore) / (1000 * 60 * 60 * 24));

    // 解析issuer
    const issuerCN = extractDNField(entry.issuer, 'CN') || '--';
    const issuerO = extractDNField(entry.issuer, 'O') || '--';

    // 解析subject
    const subjectCN = extractDNField(entry.commonName, 'CN') || entry.commonName || '--';

    // SAN列表
    const sanList = entry.nameValue ? entry.nameValue.split('\n').filter(s => s.trim()) : [];

    // 判断是否自签名
    const isSelfSigned = entry.issuer && entry.commonName &&
      entry.issuer.includes(entry.commonName);

    // 判断状态
    let status = 'valid';
    if (daysRemaining < 0) status = 'expired';
    else if (isSelfSigned) status = 'self-signed';
    else if (daysRemaining < 30) status = 'warning';

    return {
      // 归一化契约（见 common/service-providers.js 的 ct 类别）不含序列号，
      // 保留占位以维持既有渲染结构
      serialNumber: '--',
      subjectCN: subjectCN,
      issuerCN: issuerCN,
      issuerO: issuerO,
      issuerName: entry.issuer || '--',
      notBefore: notBefore,
      notAfter: notAfter,
      daysRemaining: daysRemaining,
      totalDays: totalDays,
      sanList: sanList,
      isSelfSigned: isSelfSigned,
      status: status
    };
  }

  function extractDNField(dn, field) {
    if (!dn) return null;
    const regex = new RegExp(field + '\\s*=\\s*([^,]+)', 'i');
    const match = dn.match(regex);
    return match ? match[1].trim() : null;
  }

  function renderResult(domain, httpsResult, ctResult, transportResult, hstsResult, gradeResult) {
    const cert = ctResult ? ctResult.currentCert : null;
    const status = cert ? cert.status : (httpsResult && httpsResult.httpsSupported ? 'valid' : 'invalid');
    const statusLabel = {
      valid: '✅ 有效',
      invalid: '❌ 无效/不安全',
      expired: '❌ 已过期',
      self_signed: '⚠️ 自签名',
      warning: '⚠️ 即将过期'
    }[status] || '❓ 未知';

    const statusClass = {
      valid: 'valid',
      invalid: 'invalid',
      expired: 'expired',
      self_signed: 'self-signed',
      warning: 'warning'
    }[status] || 'unknown';

    // 计算评分（含 HSTS 加分）
    const score = calculateScore(cert, httpsResult, status, hstsResult);
    // A+ 评级：分数 >= 95 且 HSTS 启用且 max-age >= 31536000 (1年)
    const hstsStrong = hstsResult && hstsResult.enabled && hstsResult.maxAge >= 31536000;
    let scoreGrade;
    if (score >= 95 && hstsStrong) scoreGrade = 'A+';
    else if (score >= 90) scoreGrade = 'A';
    else if (score >= 75) scoreGrade = 'B';
    else if (score >= 60) scoreGrade = 'C';
    else if (score >= 40) scoreGrade = 'D';
    else scoreGrade = 'F';

    let html = '';

    // 证书状态卡片
    html += '<div class="cert-card">';
    html += '<h3>🛡️ 证书状态</h3>';
    html += '<div style="margin-bottom:16px"><span class="status-badge status-badge--' + statusClass + '">';
    html += '<span class="status-dot status-dot--' + statusClass + '"></span>' + statusLabel;
    html += '</span></div>';

    if (httpsResult) {
      html += '<table class="info-table">';
      html += '<tr><td>HTTPS 支持</td><td>' + (httpsResult.httpsSupported ? '✅ 是' : '❌ 否') + '</td></tr>';
      if (httpsResult.connectionTime) {
        html += '<tr><td>连接耗时</td><td><code>' + httpsResult.connectionTime + ' ms</code></td></tr>';
      }
      html += '<tr><td>HTTP→HTTPS 重定向</td><td>' + (httpsResult.redirectsToHttps ? '✅ 是' : (httpsResult.httpsSupported ? '❌ 否' : '--')) + '</td></tr>';
      html += '</table>';
    }
    html += '</div>';

    // 证书详情
    if (cert) {
      html += '<div class="cert-card">';
      html += '<h3>📋 证书详情</h3>';
      html += '<table class="info-table">';

      // 主题
      html += '<tr><td>证书主题 (CN)</td><td><code>' + escapeHtml(cert.subjectCN) + '</code></td></tr>';

      // 颁发者
      html += '<tr><td>颁发者 (CN)</td><td><code>' + escapeHtml(cert.issuerCN) + '</code></td></tr>';
      html += '<tr><td>颁发者 (O)</td><td>' + escapeHtml(cert.issuerO) + '</td></tr>';

      // 有效期
      const expiryColor = cert.daysRemaining < 0 ? '#ef4444' : cert.daysRemaining < 30 ? '#f59e0b' : '#22c55e';
      html += '<tr><td>生效时间</td><td>' + formatDate(cert.notBefore) + '</td></tr>';
      html += '<tr><td>过期时间</td><td>' + formatDate(cert.notAfter) + '</td></tr>';
      html += '<tr><td>剩余天数</td><td style="color:' + expiryColor + ';font-weight:600">';
      if (cert.daysRemaining < 0) {
        html += '已过期 ' + Math.abs(cert.daysRemaining) + ' 天';
      } else {
        html += cert.daysRemaining + ' 天';
      }
      html += '</td></tr>';

      // 有效期进度条
      const totalDays = Math.max(cert.totalDays, 1);
      const remainingRatio = Math.max(0, Math.min(1, cert.daysRemaining / totalDays));
      const barColor = cert.daysRemaining < 0 ? 'red' : cert.daysRemaining < 30 ? 'yellow' : 'green';
      html += '<tr><td>有效期进度</td><td><div class="expiry-bar"><div class="expiry-bar-fill expiry-bar-fill--' + barColor + '" style="width:' + (remainingRatio * 100) + '%"></div></div></td></tr>';

      // 序列号
      html += '<tr><td>序列号</td><td><code>' + escapeHtml(cert.serialNumber) + '</code></td></tr>';

      // 自签名
      html += '<tr><td>自签名证书</td><td>' + (cert.isSelfSigned ? '⚠️ 是' : '否') + '</td></tr>';

      html += '</table>';
      html += '</div>';

      // SAN列表
      if (cert.sanList.length > 0) {
        html += '<div class="cert-card">';
        html += '<h3>🌐 主题备用名称 (SAN)</h3>';
        html += '<ul class="san-list">';
        for (const san of cert.sanList) {
          html += '<li>' + escapeHtml(san) + '</li>';
        }
        html += '</ul>';
        html += '</div>';
      }

      // 证书链（从CT日志中推断）
      if (ctResult && ctResult.allCurrentCerts.length > 1) {
        html += '<div class="cert-card">';
        html += '<h3>🔗 相关证书链</h3>';
        const issuers = new Map();
        for (const c of ctResult.allCurrentCerts) {
          const key = c.issuerCN;
          if (!issuers.has(key)) issuers.set(key, c);
        }

        let level = 0;
        html += '<div class="chain-item">';
        html += '<span class="chain-level">终端实体</span>';
        html += '<span><code>' + escapeHtml(cert.subjectCN) + '</code></span>';
        html += '</div>';

        for (const [issuerName, certData] of issuers) {
          level++;
          if (issuerName === cert.subjectCN) continue;
          html += '<div class="chain-item">';
          html += '<span class="chain-arrow">↑</span>';
          html += '<span class="chain-level">中间 CA</span>';
          html += '<span><code>' + escapeHtml(issuerName) + '</code></span>';
          html += '</div>';
        }

        html += '<div class="chain-item">';
        html += '<span class="chain-arrow">↑</span>';
        html += '<span class="chain-level">根 CA</span>';
        html += '<span><code>' + escapeHtml(cert.issuerO) + '</code></span>';
        html += '</div>';

        html += '</div>';
      }
    } else if (httpsResult && httpsResult.httpsSupported) {
      // HTTPS可用但CT日志无数据
      html += '<div class="cert-card">';
      html += '<h3>📋 证书详情</h3>';
      html += '<div class="info-placeholder">HTTPS连接正常，但CT日志中未找到详细证书信息。该站点可能使用了较新的证书或CT日志尚未收录。</div>';
      html += '</div>';
    }

    // 安全评估
    html += '<div class="cert-card">';
    html += '<h3>📊 安全评估</h3>';
    html += '<div class="score-section">';
    html += '<div class="score-circle score-circle--' + scoreGrade.toLowerCase() + '">' + scoreGrade + '</div>';
    html += '<div class="score-details">';
    html += '<h4>安全评分: ' + score + '/100</h4>';
    html += '<ul>';
    if (httpsResult && httpsResult.httpsSupported) {
      html += '<li>✅ HTTPS 连接正常</li>';
    } else {
      html += '<li>❌ HTTPS 连接失败</li>';
    }
    if (httpsResult && httpsResult.redirectsToHttps) {
      html += '<li>✅ HTTP 自动重定向到 HTTPS</li>';
    } else if (httpsResult && httpsResult.httpsSupported) {
      html += '<li>⚠️ 未配置 HTTP→HTTPS 重定向</li>';
    }
    if (cert) {
      if (!cert.isSelfSigned) {
        html += '<li>✅ 由受信任 CA 签发</li>';
      } else {
        html += '<li>⚠️ 自签名证书，不受浏览器信任</li>';
      }
      if (cert.daysRemaining > 30) {
        html += '<li>✅ 证书有效期充足 (' + cert.daysRemaining + '天)</li>';
      } else if (cert.daysRemaining > 0) {
        html += '<li>⚠️ 证书即将过期 (剩余' + cert.daysRemaining + '天)</li>';
      } else {
        html += '<li>❌ 证书已过期</li>';
      }
      if (cert.sanList.length > 1) {
        html += '<li>✅ 包含 SAN 扩展 (' + cert.sanList.length + '个域名)</li>';
      }
    }
    html += '</ul></div></div>';
    html += '</div>';

    // CT日志信息
    if (ctResult) {
      html += '<div class="cert-card">';
      html += '<h3>📚 CT日志</h3>';
      html += '<table class="info-table">';
      html += '<tr><td>CT日志记录数</td><td>' + ctResult.totalCerts + '</td></tr>';
      html += '<tr><td>当前有效证书</td><td>' + ctResult.allCurrentCerts.length + '</td></tr>';
      html += '</table>';
      html += '</div>';
    }

    // 传输安全（仅展示浏览器确实能观测到的结论）
    if (transportResult) {
      html += '<div class="cert-card">';
      html += '<h3>🔐 传输安全</h3>';
      html += '<table class="info-table">';
      html += '<tr><td>HTTPS 可达</td><td>' + (transportResult.httpsReachable ? '✅ 是' : '❌ 否') + '</td></tr>';
      html += '<tr><td>明文 HTTP</td><td>' + (transportResult.plainHttpReachable
        ? '<span style="color:#f59e0b">⚠️ 仍可访问（建议强制跳转 HTTPS）</span>'
        : '✅ 不可访问') + '</td></tr>';
      html += '<tr><td>TLS 版本 / 加密套件</td><td style="color:var(--tt-text-tertiary)">浏览器不向页面暴露握手细节，需由外部评级服务给出（见下方「TLS 深度评级」）</td></tr>';
      html += '</table>';
      html += '</div>';
    }

    // HSTS 检测
    if (hstsResult) {
      html += '<div class="cert-card">';
      html += '<h3>🛡️ HSTS (HTTP 严格传输安全)</h3>';
      html += '<table class="info-table">';
      if (hstsResult.enabled === true) {
        html += '<tr><td>HSTS 状态</td><td style="color:var(--tt-success);font-weight:600">✅ 已启用</td></tr>';
        html += '<tr><td>max-age</td><td><code>' + hstsResult.maxAge + ' 秒 (' + Math.round(hstsResult.maxAge / 86400) + ' 天)</code></td></tr>';
        if (hstsResult.header && /includeSubDomains/i.test(hstsResult.header)) {
          html += '<tr><td>includeSubDomains</td><td>✅ 是</td></tr>';
        }
        if (hstsResult.header && /preload/i.test(hstsResult.header)) {
          html += '<tr><td>preload</td><td>✅ 是</td></tr>';
        }
      } else if (hstsResult.enabled === false) {
        html += '<tr><td>HSTS 状态</td><td style="color:#f59e0b;font-weight:600">⚠️ 未启用</td></tr>';
        html += '<tr><td>建议</td><td>启用 HSTS 头部以防止 SSL 降级攻击（推荐 max-age ≥ 31536000）</td></tr>';
      } else {
        html += '<tr><td>HSTS 状态</td><td style="color:var(--tt-text-tertiary)">❓ 无法检测（CORS 限制）</td></tr>';
      }
      html += '</table>';
      html += '</div>';
    }

    // TLS 深度评级（来自外部服务，可在设置中换成自建服务）
    if (gradeResult) {
      html += '<div class="cert-card">';
      html += '<h3>🏅 TLS 深度评级</h3>';
      if (!gradeResult.ok) {
        html += '<div style="padding:8px;background:var(--tt-bg-secondary);border-radius:4px;font-size:12px;color:var(--tt-text-tertiary)">'
          + '❓ 未能获取外部评级：' + escapeHtml(gradeResult.error || '未知错误')
          + '<br>可在「设置 → 服务端点 → SSL/TLS 深度评级」中更换服务商或指向自建服务。</div>';
      } else if (gradeResult.status && gradeResult.status !== 'READY') {
        html += '<div style="padding:8px;background:var(--tt-bg-secondary);border-radius:4px;font-size:12px;color:var(--tt-text-tertiary)">'
          + '⏳ 外部服务正在分析该域名（状态：' + escapeHtml(gradeResult.status) + '），请稍后重新检查。</div>';
      } else {
        html += '<table class="info-table">';
        html += '<tr><td>综合评级</td><td style="font-size:18px;font-weight:700">'
          + (gradeResult.grade ? escapeHtml(gradeResult.grade) : '—') + '</td></tr>';
        for (const ep of gradeResult.endpoints || []) {
          html += '<tr><td>' + escapeHtml(ep.ipAddress || '—') + (ep.serverName ? '<br><span style="font-size:10px;color:var(--tt-text-tertiary)">' + escapeHtml(ep.serverName) + '</span>' : '') + '</td>';
          const protoText = (ep.protocols || []).filter(p => p.version && p.version !== '0').map(p => p.name + ' ' + p.version).join('、');
          html += '<td>评级 <strong>' + escapeHtml(ep.grade || '—') + '</strong>'
            + (ep.hasWarnings ? ' <span style="color:#f59e0b">⚠️ 有警告</span>' : '')
            + (protoText ? '<br><span style="font-size:11px;color:var(--tt-text-tertiary)">' + escapeHtml(protoText) + '</span>' : '')
            + '</td></tr>';
        }
        html += '</table>';
      }
      html += '</div>';
    }

    // 证书到期倒计时
    if (cert) {
      html += '<div class="cert-card">';
      html += '<h3>⏰ 到期倒计时</h3>';
      var daysLeft = cert.daysRemaining;
      var totalDays = Math.max(cert.totalDays, 1);
      var elapsedRatio = Math.max(0, Math.min(1, 1 - (daysLeft / totalDays)));
      var barColor = daysLeft < 0 ? 'red' : daysLeft < 30 ? 'yellow' : 'green';
      html += '<div style="margin:8px 0"><div style="font-size:24px;font-weight:bold;color:' + (daysLeft < 0 ? '#ef4444' : daysLeft < 30 ? '#f59e0b' : 'var(--tt-success)') + '">' + (daysLeft < 0 ? '已过期 ' + Math.abs(daysLeft) + ' 天' : daysLeft + ' 天') + '</div>';
      html += '<div style="font-size:12px;color:var(--tt-text-tertiary)">' + formatDate(cert.notAfter) + ' 到期</div></div>';
      html += '<div class="expiry-bar"><div class="expiry-bar-fill expiry-bar-fill--' + barColor + '" style="width:' + (elapsedRatio * 100) + '%"></div></div>';
      if (daysLeft > 0 && daysLeft <= 30) {
        html += '<div style="margin-top:8px;padding:8px;background:rgba(245,158,11,0.1);border-radius:4px;font-size:12px;color:#f59e0b">⚠️ 证书即将过期，建议尽快续签！</div>';
      }
      html += '</div>';
    }

    return html;
  }

  function calculateScore(cert, httpsResult, status, hstsResult) {
    let score = 0;

    // HTTPS支持 (40分)
    if (httpsResult && httpsResult.httpsSupported) {
      score += 30;
      if (httpsResult.redirectsToHttps) score += 10;
    }

    if (!cert) {
      // HSTS 加分（无证书时也可评估）
      if (hstsResult && hstsResult.enabled) score += 5;
      return Math.min(100, score);
    }

    // 证书状态 (30分)
    if (status === 'valid') score += 30;
    else if (status === 'warning') score += 15;
    else if (status === 'self_signed') score += 5;
    // expired or invalid: 0

    // 有效期 (15分)
    if (cert.daysRemaining > 365) score += 15;
    else if (cert.daysRemaining > 90) score += 12;
    else if (cert.daysRemaining > 30) score += 8;
    else if (cert.daysRemaining > 0) score += 3;

    // CA信任 (10分)
    if (!cert.isSelfSigned) score += 10;

    // SAN (5分)
    if (cert.sanList && cert.sanList.length > 0) score += 5;

    // HSTS 加分（5分）- 达到 A+ 评级的关键
    if (hstsResult && hstsResult.enabled) {
      score += 3;
      if (hstsResult.maxAge >= 31536000) score += 2; // max-age >= 1年
    }

    return Math.min(100, score);
  }

  function formatDate(date) {
    if (!date) return '--';
    const d = new Date(date);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0') + ':' +
      String(d.getSeconds()).padStart(2, '0');
  }

  async function saveToHistory(domain) {
    try {
      await callBackground('saveToHistory', { toolId: 'ssl-checker', type: 'ssl-check', data: { domain } });
    } catch (e) {}
  }

  // ==================== 证书到期提醒 ====================
  const REMINDER_KEY = 'ssl-checker-reminders';
  const REMINDER_THRESHOLD_KEY = 'ssl-checker-reminder-threshold';

  // 获取到期提醒阈值（天数）
  async function getReminderThreshold() {
    try {
      const data = await safeStorage('get', REMINDER_THRESHOLD_KEY);
      return data[REMINDER_THRESHOLD_KEY] || 30;
    } catch (e) { return 30; }
  }

  // 保存到期提醒阈值
  async function setReminderThreshold(days) {
    try {
      await safeStorage('set', { [REMINDER_THRESHOLD_KEY]: days });
    } catch (e) {}
  }

  // 检查并保存到期提醒
  async function checkExpiryReminder(domain, cert) {
    if (!cert || cert.daysRemaining < 0) return;
    const threshold = await getReminderThreshold();
    try {
      const data = await safeStorage('get', REMINDER_KEY);
      const reminders = data[REMINDER_KEY] || [];
      if (cert.daysRemaining <= threshold) {
        // 添加/更新提醒
        const idx = reminders.findIndex(r => r.domain === domain);
        const entry = { domain, daysRemaining: cert.daysRemaining, notAfter: cert.notAfter, time: Date.now() };
        if (idx >= 0) reminders[idx] = entry;
        else reminders.push(entry);
        showToast('⚠️ ' + domain + ' 证书将在 ' + cert.daysRemaining + ' 天后过期', 'info');
      } else {
        // 移除已不需要的提醒
        const idx = reminders.findIndex(r => r.domain === domain);
        if (idx >= 0) reminders.splice(idx, 1);
      }
      await safeStorage('set', { [REMINDER_KEY]: reminders });
    } catch (e) {}
  }

  // 到期提醒阈值设置
  var reminderThresholdInput = document.getElementById('reminder-threshold');
  var btnSaveThreshold = document.getElementById('btn-save-threshold');
  var btnViewReminders = document.getElementById('btn-view-reminders');

  // 初始化加载已保存的阈值
  (async () => {
    const t = await getReminderThreshold();
    if (reminderThresholdInput) reminderThresholdInput.value = t;
  })();

  if (btnSaveThreshold) {
    btnSaveThreshold.addEventListener('click', async () => {
      const days = parseInt(reminderThresholdInput ? reminderThresholdInput.value : '30', 10);
      if (isNaN(days) || days < 1 || days > 365) { showToast('请输入 1-365 之间的数字', 'error'); return; }
      await setReminderThreshold(days);
      showToast('已保存提醒阈值: ' + days + ' 天', 'success');
    });
  }

  // 查看到期提醒列表
  if (btnViewReminders) {
    btnViewReminders.addEventListener('click', async () => {
      try {
        const data = await safeStorage('get', REMINDER_KEY);
        const reminders = data[REMINDER_KEY] || [];
        if (reminders.length === 0) {
          resultArea.innerHTML = '<div class="cert-card"><h3>📋 证书到期提醒</h3><div class="info-placeholder">暂无到期提醒。检查域名时若证书剩余天数低于阈值将自动记录。</div></div>';
          return;
        }
        // 按剩余天数升序排序
        reminders.sort((a, b) => a.daysRemaining - b.daysRemaining);
        let html = '<div class="cert-card"><h3>📋 证书到期提醒 (' + reminders.length + ')</h3>';
        html += '<table class="info-table"><thead><tr><th>域名</th><th>剩余天数</th><th>到期时间</th><th>操作</th></tr></thead><tbody>';
        for (const r of reminders) {
          const color = r.daysRemaining < 7 ? '#ef4444' : r.daysRemaining < 30 ? '#f59e0b' : 'var(--tt-text)';
          html += '<tr><td><code>' + escapeHtml(r.domain) + '</code></td>';
          html += '<td style="color:' + color + ';font-weight:600">' + r.daysRemaining + ' 天</td>';
          html += '<td>' + formatDate(r.notAfter) + '</td>';
          html += '<td><button class="btn-recheck" data-domain="' + escapeHtml(r.domain) + '" style="cursor:pointer;color:var(--tt-primary);font-size:11px;background:none;border:none">重新检查</button></td></tr>';
        }
        html += '</tbody></table></div>';
        resultArea.innerHTML = html;
        // 绑定重新检查按钮
        resultArea.querySelectorAll('.btn-recheck').forEach(btn => {
          btn.addEventListener('click', () => {
            domainInput.value = btn.dataset.domain;
            checkSSL();
          });
        });
      } catch (e) {
        showToast('加载提醒列表失败', 'error');
      }
    });
  }
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
