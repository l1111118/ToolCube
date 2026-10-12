/**
 * 安全响应头分析工具
 * 分析HTTP安全响应头并给出安全评分
 */
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById('url-input');
  const btnAnalyze = document.getElementById('btn-analyze');
  const btnCurrentPage = document.getElementById('btn-current-page');
  const toolMain = document.getElementById('tool-main');
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


  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ==================== 安全头定义与评分 ====================
  const SECURITY_HEADERS = [
    {
      name: 'Strict-Transport-Security',
      weight: 15,
      analyze: (val) => {
        if (!val) return { status: 'bad', score: 0, label: '缺失', desc: 'HSTS 头缺失。浏览器可能通过 HTTP 访问站点，存在中间人攻击风险。', recommend: '建议添加 Strict-Transport-Security: max-age=31536000; includeSubDomains; preload' };
        const result = { status: 'good', score: 15, label: '已设置', desc: 'HSTS 已启用，浏览器将强制使用 HTTPS 连接。', recommend: '' };
        const maxAge = val.match(/max-age=(\d+)/);
        if (maxAge) {
          const age = parseInt(maxAge[1], 10);
          if (age < 2592000) {
            result.score = 8;
            result.status = 'warn';
            result.label = '较弱';
            result.desc = `HSTS max-age 仅为 ${age} 秒（约 ${Math.round(age / 86400)} 天），时间较短。`;
            result.recommend = '建议将 max-age 设置为至少 31536000（1年）。';
          } else if (age < 31536000) {
            result.score = 12;
            result.status = 'warn';
            result.label = '一般';
            result.desc = `HSTS max-age 为 ${age} 秒（约 ${Math.round(age / 86400)} 天）。`;
            result.recommend = '建议将 max-age 提升至 31536000（1年）以获得更强保护。';
          }
        }
        if (!val.includes('includeSubDomains')) {
          result.score = Math.min(result.score, 10);
          if (result.status === 'good') { result.status = 'warn'; result.label = '部分'; }
          result.desc += ' 未包含 includeSubDomains 指令，子域名不受保护。';
          result.recommend = '建议添加 includeSubDomains 指令以保护所有子域名。';
        }
        if (!val.includes('preload')) {
          result.score = Math.max(result.score - 2, 0);
          result.recommend += (result.recommend ? ' ' : '') + '可考虑添加 preload 指令以加入浏览器 HSTS 预加载列表。';
        }
        return result;
      }
    },
    {
      name: 'Content-Security-Policy',
      weight: 20,
      analyze: (val) => {
        if (!val) return { status: 'bad', score: 0, label: '缺失', desc: 'CSP 头缺失。页面容易受到 XSS 和数据注入攻击。', recommend: '建议配置 Content-Security-Policy 以限制资源加载来源。' };
        const result = { status: 'good', score: 20, label: '已设置', desc: 'CSP 已配置，有助于防止 XSS 和注入攻击。', recommend: '' };
        if (val.includes("'unsafe-inline'")) {
          result.score -= 8;
          result.status = 'warn';
          result.label = '较弱';
          result.desc += " 包含 'unsafe-inline'，允许内联脚本/样式，削弱了 XSS 防护。";
          result.recommend = "建议移除 'unsafe-inline'，使用 nonce 或 hash 替代。";
        }
        if (val.includes("'unsafe-eval'")) {
          result.score -= 6;
          result.status = 'warn';
          result.label = '较弱';
          result.desc += " 包含 'unsafe-eval'，允许 eval() 等动态代码执行。";
          result.recommend += (result.recommend ? ' ' : '') + "建议移除 'unsafe-eval'。";
        }
        if (val.includes('*')) {
          result.score -= 5;
          result.status = 'warn';
          result.label = '宽松';
          result.desc += ' 使用通配符 *，允许从任意来源加载资源。';
          result.recommend += (result.recommend ? ' ' : '') + '建议将 * 替换为具体的域名白名单。';
        }
        if (!val.includes('default-src')) {
          result.score -= 3;
          result.recommend += (result.recommend ? ' ' : '') + '建议添加 default-src 作为回退策略。';
        }
        if (val.includes('report-uri') || val.includes('report-to')) {
          result.desc += ' 已配置违规报告。';
        } else {
          result.recommend += (result.recommend ? ' ' : '') + '建议添加 report-uri 或 report-to 以收集违规报告。';
        }
        result.score = Math.max(0, result.score);
        if (result.score >= 16) { result.status = 'good'; result.label = '良好'; }
        return result;
      }
    },
    {
      name: 'X-Frame-Options',
      weight: 10,
      analyze: (val) => {
        if (!val) return { status: 'bad', score: 0, label: '缺失', desc: 'X-Frame-Options 头缺失。页面可能被嵌入 iframe，存在点击劫持风险。', recommend: '建议设置 X-Frame-Options: DENY 或 SAMEORIGIN。' };
        const v = val.trim().toUpperCase();
        if (v === 'DENY') return { status: 'good', score: 10, label: 'DENY', desc: '页面完全禁止被嵌入 iframe，提供最强点击劫持防护。', recommend: '' };
        if (v === 'SAMEORIGIN') return { status: 'good', score: 9, label: 'SAMEORIGIN', desc: '仅允许同源页面嵌入 iframe，防护点击劫持。', recommend: '如无需嵌入，可使用 DENY 获得更强防护。' };
        if (v.startsWith('ALLOW-FROM')) return { status: 'warn', score: 5, label: 'ALLOW-FROM', desc: 'ALLOW-FROM 已被多数浏览器弃用，兼容性差。', recommend: '建议改用 CSP 的 frame-ancestors 指令替代。' };
        return { status: 'warn', score: 4, label: '未知值', desc: `X-Frame-Options 值 "${val}" 不是标准值。`, recommend: '建议使用 DENY 或 SAMEORIGIN。' };
      }
    },
    {
      name: 'X-Content-Type-Options',
      weight: 8,
      analyze: (val) => {
        if (!val) return { status: 'bad', score: 0, label: '缺失', desc: 'X-Content-Type-Options 头缺失。浏览器可能进行 MIME 嗅探，将非可执行文件作为可执行内容执行。', recommend: '建议设置 X-Content-Type-Options: nosniff。' };
        if (val.trim().toLowerCase() === 'nosniff') return { status: 'good', score: 8, label: 'nosniff', desc: '已禁止浏览器 MIME 嗅探，防止内容类型混淆攻击。', recommend: '' };
        return { status: 'warn', score: 3, label: '非标准值', desc: `X-Content-Type-Options 值 "${val}" 不是标准值。`, recommend: '应设置为 nosniff。' };
      }
    },
    {
      name: 'X-XSS-Protection',
      weight: 5,
      analyze: (val) => {
        if (!val) return { status: 'bad', score: 0, label: '缺失', desc: 'X-XSS-Protection 头缺失。浏览器内置 XSS 过滤器行为不可控。', recommend: '建议设置 X-XSS-Protection: 1; mode=block（或考虑依赖 CSP 替代）。' };
        const v = val.trim();
        if (v === '1; mode=block') return { status: 'good', score: 5, label: '1; mode=block', desc: '已启用 XSS 过滤并阻止渲染被攻击页面。', recommend: '' };
        if (v.startsWith('1')) return { status: 'warn', score: 3, label: '1', desc: 'XSS 过滤器已启用，但未设置 mode=block，仅过滤而非阻止。', recommend: '建议设置为 1; mode=block 以阻止而非过滤。' };
        if (v.startsWith('0')) return { status: 'bad', score: 0, label: '0 (禁用)', desc: 'XSS 过滤器已被禁用。', recommend: '建议启用：X-XSS-Protection: 1; mode=block。' };
        return { status: 'warn', score: 2, label: '非标准值', desc: `X-XSS-Protection 值 "${val}" 不是标准值。`, recommend: '建议设置为 1; mode=block。' };
      }
    },
    {
      name: 'Referrer-Policy',
      weight: 8,
      analyze: (val) => {
        if (!val) return { status: 'bad', score: 0, label: '缺失', desc: 'Referrer-Policy 头缺失。浏览器可能在请求中泄露完整 URL 引荐信息。', recommend: '建议设置 Referrer-Policy: strict-origin-when-cross-origin。' };
        const v = val.trim().toLowerCase();
        const safeValues = ['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'];
        const moderateValues = ['origin', 'origin-when-cross-origin'];
        if (safeValues.includes(v)) return { status: 'good', score: 8, label: v, desc: `Referrer 策略为 ${v}，有效保护用户隐私。`, recommend: '' };
        if (moderateValues.includes(v)) return { status: 'warn', score: 5, label: v, desc: `Referrer 策略为 ${v}，跨域请求仍会发送来源域名。`, recommend: '建议使用 strict-origin-when-cross-origin 获得更好隐私保护。' };
        if (v === 'no-referrer-when-downgrade') return { status: 'warn', score: 4, label: v, desc: 'HTTPS→HTTP 时不发送 Referrer，但 HTTPS→HTTPS 时发送完整 URL。', recommend: '建议使用 strict-origin-when-cross-origin。' };
        if (v === 'unsafe-url') return { status: 'bad', score: 1, label: 'unsafe-url', desc: '所有请求均发送完整 URL，严重泄露用户隐私。', recommend: '强烈建议更改，使用 strict-origin-when-cross-origin 替代。' };
        return { status: 'warn', score: 3, label: v, desc: `Referrer 策略 "${v}" 不是常见安全值。`, recommend: '建议使用 strict-origin-when-cross-origin。' };
      }
    },
    {
      name: 'Permissions-Policy',
      weight: 8,
      analyze: (val) => {
        if (!val) return { status: 'bad', score: 0, label: '缺失', desc: 'Permissions-Policy 头缺失。浏览器功能（摄像头、麦克风、定位等）未受限制，可能被恶意利用。', recommend: '建议配置 Permissions-Policy 限制不必要的浏览器功能。' };
        const result = { status: 'good', score: 8, label: '已设置', desc: 'Permissions-Policy 已配置，限制了部分浏览器功能。', recommend: '' };
        const sensitiveFeatures = ['camera', 'microphone', 'geolocation', 'payment'];
        let restricted = 0;
        for (const f of sensitiveFeatures) {
          if (val.includes(f)) restricted++;
        }
        if (restricted === 0) {
          result.status = 'warn';
          result.score = 3;
          result.label = '宽松';
          result.desc = 'Permissions-Policy 已设置，但未限制敏感功能（摄像头、麦克风、定位、支付）。';
          result.recommend = '建议限制不需要的敏感功能。';
        } else if (restricted < 2) {
          result.status = 'warn';
          result.score = 5;
          result.label = '部分';
          result.desc += ` 已限制 ${restricted} 个敏感功能。`;
          result.recommend = '建议评估并限制更多不需要的敏感功能。';
        } else {
          result.desc += ` 已限制 ${restricted} 个敏感功能。`;
        }
        return result;
      }
    },
    {
      name: 'Cross-Origin-Opener-Policy',
      weight: 8,
      analyze: (val) => {
        if (!val) return { status: 'bad', score: 0, label: '缺失', desc: 'Cross-Origin-Opener-Policy 头缺失。页面可能受到跨源攻击，无法使用 SharedArrayBuffer 等高级 API。', recommend: '建议设置 Cross-Origin-Opener-Policy: same-origin。' };
        const v = val.trim().toLowerCase();
        if (v === 'same-origin') return { status: 'good', score: 8, label: 'same-origin', desc: '已限制跨源窗口访问，防止 Spectre 类侧信道攻击。', recommend: '' };
        if (v === 'same-origin-allow-popups') return { status: 'warn', score: 5, label: 'same-origin-allow-popups', desc: '允许跨源弹出窗口保留引用，安全性弱于 same-origin。', recommend: '如无需弹出窗口交互，建议使用 same-origin。' };
        if (v === 'unsafe-none') return { status: 'warn', score: 2, label: 'unsafe-none', desc: 'COOP 未限制跨源窗口访问。', recommend: '建议使用 same-origin。' };
        return { status: 'warn', score: 3, label: v, desc: `COOP 值 "${val}" 不是标准值。`, recommend: '建议设置为 same-origin。' };
      }
    },
    {
      name: 'Cross-Origin-Resource-Policy',
      weight: 5,
      analyze: (val) => {
        if (!val) return { status: 'bad', score: 0, label: '缺失', desc: 'Cross-Origin-Resource-Policy 头缺失。跨源页面可能加载本站资源，存在信息泄露风险。', recommend: '建议设置 Cross-Origin-Resource-Policy: same-origin。' };
        const v = val.trim().toLowerCase();
        if (v === 'same-origin') return { status: 'good', score: 5, label: 'same-origin', desc: '仅同源可加载资源，防止跨源信息泄露。', recommend: '' };
        if (v === 'same-site') return { status: 'good', score: 4, label: 'same-site', desc: '同站可加载资源，提供基本跨源保护。', recommend: '如需更严格保护，可使用 same-origin。' };
        if (v === 'cross-origin') return { status: 'warn', score: 1, label: 'cross-origin', desc: '允许任何源加载资源，未提供跨源保护。', recommend: '建议使用 same-origin 或 same-site。' };
        return { status: 'warn', score: 2, label: v, desc: `CORP 值 "${val}" 不是标准值。`, recommend: '建议设置为 same-origin。' };
      }
    },
    {
      name: 'Cross-Origin-Embedder-Policy',
      weight: 5,
      analyze: (val) => {
        if (!val) return { status: 'bad', score: 0, label: '缺失', desc: 'Cross-Origin-Embedder-Policy 头缺失。页面可被跨源资源嵌入，无法获得完整跨源隔离。', recommend: '建议设置 Cross-Origin-Embedder-Policy: require-corp 以启用跨源隔离。' };
        const v = val.trim().toLowerCase();
        if (v === 'require-corp') return { status: 'good', score: 5, label: 'require-corp', desc: '已要求跨源资源显式授权，启用完整跨源隔离，可使用 SharedArrayBuffer。', recommend: '' };
        if (v === 'credentialless') return { status: 'good', score: 5, label: 'credentialless', desc: '使用无凭据模式加载跨源资源，提供跨源隔离。', recommend: '' };
        if (v === 'unsafe-none') return { status: 'warn', score: 1, label: 'unsafe-none', desc: 'COEP 未限制跨源嵌入。', recommend: '建议使用 require-corp。' };
        return { status: 'warn', score: 2, label: v, desc: `COEP 值 "${val}" 不是标准值。`, recommend: '建议设置为 require-corp。' };
      }
    },
    {
      name: 'X-Permitted-Cross-Domain-Policies',
      weight: 3,
      analyze: (val) => {
        if (!val) return { status: 'warn', score: 1, label: '缺失', desc: 'X-Permitted-Cross-Domain-Policies 头缺失。Adobe Flash/PDF 等跨域策略未限制（现代浏览器影响较小）。', recommend: '建议设置 X-Permitted-Cross-Domain-Policies: none 以禁止跨域策略文件。' };
        const v = val.trim().toLowerCase();
        if (v === 'none') return { status: 'good', score: 3, label: 'none', desc: '已禁止跨域策略文件加载，最佳实践。', recommend: '' };
        if (v === 'master-only') return { status: 'warn', score: 2, label: 'master-only', desc: '仅允许主策略文件，部分限制。', recommend: '建议使用 none 获得更严格保护。' };
        return { status: 'warn', score: 1, label: v, desc: `值 "${val}" 不是标准值。`, recommend: '建议设置为 none。' };
      }
    },
    {
      name: 'Cache-Control',
      weight: 4,
      analyze: (val) => {
        if (!val) return { status: 'warn', score: 1, label: '缺失', desc: 'Cache-Control 头缺失。敏感数据可能被缓存，存在信息泄露风险。', recommend: '建议设置 Cache-Control: no-store, no-cache, must-revalidate（针对敏感页面）。' };
        const v = val.toLowerCase();
        if (v.includes('no-store')) return { status: 'good', score: 4, label: 'no-store', desc: '已禁止缓存，敏感数据不会被存储。', recommend: '' };
        if (v.includes('no-cache') || v.includes('private')) return { status: 'good', score: 3, label: 'no-cache/private', desc: '已限制缓存行为。', recommend: '敏感页面建议使用 no-store 更严格。' };
        if (v.includes('public') && v.includes('max-age')) return { status: 'warn', score: 2, label: 'public', desc: '允许公共缓存，敏感页面不应使用。', recommend: '敏感页面应使用 no-store 或 private。' };
        return { status: 'warn', score: 2, label: '已设置', desc: `Cache-Control: ${val}`, recommend: '敏感页面建议使用 no-store, no-cache, must-revalidate。' };
      }
    },
    {
      name: 'X-DNS-Prefetch-Control',
      weight: 2,
      analyze: (val) => {
        if (!val) return { status: 'info', score: 1, label: '缺失', desc: 'X-DNS-Prefetch-Control 头缺失。浏览器默认行为可能预取 DNS，存在隐私泄露。', recommend: '隐私敏感站点建议设置 X-DNS-Prefetch-Control: off。' };
        const v = val.trim().toLowerCase();
        if (v === 'off') return { status: 'good', score: 2, label: 'off', desc: '已禁用 DNS 预取，减少隐私泄露。', recommend: '' };
        if (v === 'on') return { status: 'warn', score: 1, label: 'on', desc: '已启用 DNS 预取，可能泄露用户浏览行为。', recommend: '隐私敏感站点建议设置为 off。' };
        return { status: 'info', score: 1, label: v, desc: `X-DNS-Prefetch-Control: ${val}`, recommend: '建议设置为 off 以减少隐私泄露。' };
      }
    }
  ];

  // ==================== 事件绑定 ====================
  btnAnalyze.addEventListener('click', () => analyze());
  btnCurrentPage.addEventListener('click', () => getCurrentTabUrl());
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') analyze(); });

  // ==================== 获取当前标签页 URL ====================
  async function getCurrentTabUrl() {
    try {
      const response = await callBackground('getTabInfo', null);
      if (response && response.success && response.data && response.data.url && response.data.url.startsWith('http')) {
        urlInput.value = response.data.url;
        analyze();
      } else {
        showToast('当前页面不是 HTTP/HTTPS 页面');
      }
    } catch (e) {
      showToast('无法获取当前页面 URL');
    }
  }

  // ==================== 分析核心逻辑 ====================
  async function analyze() {
    const url = urlInput.value.trim();
    if (!url) { showToast('请输入 URL'); return; }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (e) {
      showToast('URL 格式无效');
      return;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      showToast('仅支持 HTTP/HTTPS 协议');
      return;
    }

    toolMain.innerHTML = '<div class="loading">⏳ 正在分析安全响应头...</div>';

    let headers = {};
    let rawHeaders = '';

    // 统一经后台 fetchHeaders 代理获取响应头。
    // 此前先用工具页直连 fetch（mode:'cors'），跨域目标几乎必然失败，再回退后台 ——
    // 等于多走一条注定失败的路径。后台 fetch 不受 CORS 限制，能直接拿到真实响应头。
    try {
      const res = await callBackground('fetchHeaders', { url });
      if (res && res.headers) {
        headers = res.headers || {};
        rawHeaders = res.rawHeaders || '';
      } else {
        toolMain.innerHTML = `<div class="placeholder">❌ 获取响应头失败：${escapeHtml(res?.error || '未知错误')}</div>`;
        return;
      }
    } catch (e2) {
      toolMain.innerHTML = `<div class="placeholder">❌ 获取响应头失败：${escapeHtml(e2.message)}</div>`;
      return;
    }

    renderResults(headers, rawHeaders, url);
    saveToHistory(url);
  }

  // ==================== 渲染结果 ====================
  function renderResults(headers, rawHeaders, url) {
    const results = SECURITY_HEADERS.map(headerDef => {
      const headerName = headerDef.name.toLowerCase();
      const value = headers[headerName] || null;
      const analysis = headerDef.analyze(value);
      return { ...headerDef, value, analysis };
    });

    // 计算总分
    const totalScore = results.reduce((sum, r) => sum + r.analysis.score, 0);
    const maxScore = SECURITY_HEADERS.reduce((sum, h) => sum + h.weight, 0);
    const percent = Math.round((totalScore / maxScore) * 100);
    const grade = getGrade(percent);

    // 统计
    const goodCount = results.filter(r => r.analysis.status === 'good').length;
    const warnCount = results.filter(r => r.analysis.status === 'warn').length;
    const badCount = results.filter(r => r.analysis.status === 'bad').length;

    let html = '';

    // 数据来源说明：响应头由后台代理获取（后台 fetch 不受页面 CORS 限制）
    html += '<div class="cors-note">ℹ️ 响应头由后台统一代理获取。个别头部（如 Set-Cookie）受浏览器安全策略限制，可能不会出现在结果中。</div>';

    // 评分卡片
    html += `
      <div class="score-card">
        <div class="score-grade grade-${grade.cls}">${grade.letter}</div>
        <div class="score-info">
          <div class="score-number">${percent}<span style="font-size:14px;font-weight:400">/100</span></div>
          <div class="score-label">${escapeHtml(url)}</div>
          <div class="score-bar"><div class="score-bar-fill grade-${grade.cls}" style="width:${percent}%"></div></div>
          <div class="score-summary">
            <span class="summary-item good">✅ ${goodCount} 项良好</span>
            <span class="summary-item warn">⚠️ ${warnCount} 项较弱</span>
            <span class="summary-item bad">❌ ${badCount} 项缺失</span>
          </div>
        </div>
      </div>
    `;

    // 每个安全头详情
    for (const r of results) {
      const badgeText = r.analysis.label;
      html += `
        <div class="header-card status-${r.analysis.status}">
          <div class="header-top">
            <span class="header-name">${escapeHtml(r.name)}</span>
            <span class="header-badge ${r.analysis.status}">${escapeHtml(badgeText)}</span>
          </div>
          ${r.value ? `<div class="header-value">${escapeHtml(r.value)}</div>` : ''}
          <div class="header-desc">${r.analysis.desc}</div>
          ${r.analysis.recommend ? `<div class="header-recommend"><strong>建议：</strong>${r.analysis.recommend}</div>` : ''}
        </div>
      `;
    }

    // 原始头部
    if (rawHeaders) {
      html += `
        <div class="raw-section">
          <div class="raw-title" id="raw-toggle">📄 原始响应头 <span style="font-size:11px;color:var(--tt-text-secondary)">（点击展开/折叠）</span></div>
          <div class="raw-body collapsed" id="raw-body">${escapeHtml(rawHeaders)}</div>
        </div>
      `;
    }

    // ── CORS 策略分析 ──
    const corsHeaders = {
      'access-control-allow-origin': headers['access-control-allow-origin'],
      'access-control-allow-methods': headers['access-control-allow-methods'],
      'access-control-allow-headers': headers['access-control-allow-headers'],
      'access-control-allow-credentials': headers['access-control-allow-credentials'],
      'access-control-max-age': headers['access-control-max-age'],
      'access-control-expose-headers': headers['access-control-expose-headers']
    };
    const hasCorsHeaders = Object.values(corsHeaders).some(v => v != null);
    if (hasCorsHeaders) {
      const corsIssues = [];
      const acao = corsHeaders['access-control-allow-origin'];
      if (acao === '*') {
        corsIssues.push('⚠️ Access-Control-Allow-Origin: * — 允许任意源访问，存在安全风险');
      } else if (acao) {
        corsIssues.push('✓ Access-Control-Allow-Origin: ' + acao);
      }
      if (corsHeaders['access-control-allow-credentials'] === 'true' && acao === '*') {
        corsIssues.push('❌ 不允许同时设置 Allow-Credentials: true 和 Allow-Origin: *');
      }
      if (corsHeaders['access-control-allow-methods']) {
        const methods = corsHeaders['access-control-allow-methods'];
        corsIssues.push('Allow-Methods: ' + methods);
        if (methods.includes('*')) corsIssues.push('⚠️ 允许所有 HTTP 方法');
      }
      html += `
        <div class="header-card status-${corsIssues.some(i => i.includes('❌')) ? 'bad' : corsIssues.some(i => i.includes('⚠️')) ? 'warn' : 'good'}">
          <div class="header-top">
            <span class="header-name">CORS 策略分析</span>
            <span class="header-badge ${corsIssues.some(i => i.includes('❌') || i.includes('⚠️')) ? 'warn' : 'good'}">已检测</span>
          </div>
          ${corsIssues.map(i => '<div class="header-desc">' + escapeHtml(i) + '</div>').join('')}
          ${corsIssues.some(i => i.includes('⚠️') || i.includes('❌')) ? '<div class="header-recommend"><strong>建议：</strong>限制 Access-Control-Allow-Origin 为具体域名，避免使用通配符 *</div>' : ''}
        </div>
      `;
    }

    // ── 缺失安全头汇总 ──
    const missingHeaders = results.filter(r => r.analysis.status === 'bad');
    if (missingHeaders.length > 0) {
      html += `
        <div class="header-card status-bad" style="border-left:3px solid #ef4444;">
          <div class="header-top">
            <span class="header-name">❌ 缺失安全头汇总</span>
            <span class="header-badge bad">${missingHeaders.length} 项缺失</span>
          </div>
          <div class="header-desc">以下安全头未设置，建议优先配置：</div>
          <ul style="margin:4px 0 0 16px;font-size:12px;">
            ${missingHeaders.map(r => '<li><strong>' + escapeHtml(r.name) + '</strong>: ' + escapeHtml(r.analysis.recommend || r.analysis.desc) + '</li>').join('')}
          </ul>
        </div>
      `;
    }

    // ── 修复建议 ──
    const warnHeaders = results.filter(r => r.analysis.status === 'warn');
    if (warnHeaders.length > 0 || missingHeaders.length > 0) {
      const fixSuggestions = [];
      if (headers['strict-transport-security'] == null) {
        fixSuggestions.push('Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"');
      }
      if (headers['content-security-policy'] == null) {
        fixSuggestions.push('Header set Content-Security-Policy "default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'"');
      }
      if (headers['x-frame-options'] == null) {
        fixSuggestions.push('Header always set X-Frame-Options "SAMEORIGIN"');
      }
      if (headers['x-content-type-options'] == null) {
        fixSuggestions.push('Header always set X-Content-Type-Options "nosniff"');
      }
      if (headers['referrer-policy'] == null) {
        fixSuggestions.push('Header always set Referrer-Policy "strict-origin-when-cross-origin"');
      }
      if (headers['permissions-policy'] == null) {
        fixSuggestions.push('Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"');
      }
      if (fixSuggestions.length > 0) {
        html += `
          <div class="header-card status-warn" style="border-left:3px solid #ff9800;">
            <div class="header-top">
              <span class="header-name">💡 Apache 修复建议 (.htaccess)</span>
              <span class="header-badge warn">配置参考</span>
            </div>
            <div class="header-desc" style="font-family:monospace;font-size:11px;white-space:pre-wrap;background:var(--tt-bg-secondary);padding:8px;border-radius:4px;">${escapeHtml(fixSuggestions.join('\n'))}</div>
          </div>
        `;
        // Nginx 配置示例
        const nginxSuggestions = fixSuggestions.map(s => {
          // Apache "Header always set X" -> Nginx "add_header X always;"
          const m = s.match(/^Header\s+(?:always\s+)?set\s+(\S+)\s+"(.*)"$/);
          if (m) return 'add_header ' + m[1] + ' "' + m[2] + '" always;';
          return s;
        });
        html += `
          <div class="header-card status-warn" style="border-left:3px solid #009688;">
            <div class="header-top">
              <span class="header-name">💡 Nginx 修复建议 (nginx.conf)</span>
              <span class="header-badge warn">配置参考</span>
            </div>
            <div class="header-desc" style="font-family:monospace;font-size:11px;white-space:pre-wrap;background:var(--tt-bg-secondary);padding:8px;border-radius:4px;">${escapeHtml(nginxSuggestions.join('\n'))}</div>
          </div>
        `;
        // 最佳实践说明
        html += `
          <div class="header-card status-good" style="border-left:3px solid #4caf50;">
            <div class="header-top">
              <span class="header-name">📚 安全头最佳实践</span>
              <span class="header-badge good">最佳实践</span>
            </div>
            <div class="header-desc" style="font-size:12px;line-height:1.7;">
              <div>• <strong>HSTS</strong>: max-age 至少 31536000（1年），包含 includeSubDomains 和 preload</div>
              <div>• <strong>CSP</strong>: 避免 'unsafe-inline' 和 'unsafe-eval'，使用 nonce 或 hash；设置 object-src 'none'</div>
              <div>• <strong>X-Frame-Options</strong>: 优先使用 CSP frame-ancestors，兼容性考虑可同时设置</div>
              <div>• <strong>X-Content-Type-Options</strong>: 固定值 nosniff，所有响应都应设置</div>
              <div>• <strong>Referrer-Policy</strong>: 推荐 strict-origin-when-cross-origin</div>
              <div>• <strong>Permissions-Policy</strong>: 限制 camera/microphone/geolocation/payment 等敏感功能</div>
              <div>• <strong>Cache-Control</strong>: 敏感页面用 no-store，静态资源用 max-age 缓存</div>
              <div>• <strong>COOP/CORP/COEP</strong>: 高安全站点建议启用跨源隔离以防范侧信道攻击</div>
            </div>
          </div>
        `;
      }
    }

    toolMain.innerHTML = html;

    // 原始头部折叠切换
    const rawToggle = document.getElementById('raw-toggle');
    const rawBody = document.getElementById('raw-body');
    if (rawToggle && rawBody) {
      rawToggle.addEventListener('click', () => {
        rawBody.classList.toggle('collapsed');
      });
    }
  }

  function getGrade(percent) {
    if (percent >= 80) return { letter: 'A', cls: 'a' };
    if (percent >= 65) return { letter: 'B', cls: 'b' };
    if (percent >= 45) return { letter: 'C', cls: 'c' };
    if (percent >= 25) return { letter: 'D', cls: 'd' };
    return { letter: 'F', cls: 'f' };
  }

  // ==================== Toast ====================
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.className = 'toast toast--show';
    setTimeout(() => toastEl.classList.remove('toast--show'), 3000);
  }

  // ==================== 保存历史 ====================
  async function saveToHistory(url) {
    try {
      await callBackground('saveToHistory', { toolId: 'header-analyzer', type: 'analyze', data: { url } });
    } catch (e) {}
  }
});

// 主题切换消息监听
window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data && event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
  if (event.data && event.data.action === 'setData') {
    const inputArea = document.getElementById('url-input');
    if (inputArea && typeof event.data.data === 'string') {
      inputArea.value = event.data.data;
      inputArea.dispatchEvent(new Event('input'));
    }
  }
});
