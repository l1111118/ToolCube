/**
 * 隐私追踪检测 - Privacy Checker
 * 检测当前页面的追踪器、第三方请求、Cookie、指纹脚本等
 */
document.addEventListener('DOMContentLoaded', () => {
  const $scoreSection = document.getElementById('pc-score-section');
  const $results = document.getElementById('pc-results');
  const $recommendations = document.getElementById('pc-recommendations');
  const $recoList = document.getElementById('pc-reco-list');
  const $toast = document.getElementById('toast');
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


  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ============ 已知追踪器域名列表 (30+) ============
  const TRACKER_DOMAINS = {
    'google-analytics.com': 'Google Analytics',
    'googletagmanager.com': 'Google Tag Manager',
    'googleadservices.com': 'Google Ads',
    'googlesyndication.com': 'Google AdSense',
    'doubleclick.net': 'DoubleClick (Google)',
    'facebook.net': 'Facebook SDK',
    'facebook.com': 'Facebook Pixel',
    'fbcdn.net': 'Facebook CDN',
    'hotjar.com': 'Hotjar',
    'mixpanel.com': 'Mixpanel',
    'amplitude.com': 'Amplitude',
    'segment.io': 'Segment',
    'segment.com': 'Segment',
    'analytics.segment.com': 'Segment Analytics',
    'intercom.io': 'Intercom',
    'intercomcdn.com': 'Intercom CDN',
    'newrelic.com': 'New Relic',
    'nr-data.net': 'New Relic Data',
    'sentry.io': 'Sentry',
    'fullstory.com': 'FullStory',
    'cdn.fullstory.com': 'FullStory CDN',
    'crazyegg.com': 'CrazyEgg',
    'optimizely.com': 'Optimizely',
    'cdn.optimizely.com': 'Optimizely CDN',
    'clarity.ms': 'Microsoft Clarity',
    'hubspot.com': 'HubSpot',
    'adsymptotic.com': 'AdSymptotic',
    'scorecardresearch.com': 'ScorecardResearch',
    'outbrain.com': 'Outbrain',
    'taboola.com': 'Taboola',
    'adnxs.com': 'AppNexus',
    'amazon-adsystem.com': 'Amazon Ads',
    'ads.twitter.com': 'Twitter Ads',
    'analytics.twitter.com': 'Twitter Analytics',
    't.co': 'Twitter URL Shortener',
    'linkedin.com': 'LinkedIn Tracker',
    'snap.licdn.com': 'LinkedIn Insight',
    'pinterest.com': 'Pinterest Tracker',
    'ct.pinterest.com': 'Pinterest Conversion',
    'tiktok.com': 'TikTok Pixel',
    'analytics.tiktok.com': 'TikTok Analytics',
    'microsoft.com': 'Microsoft Tracking',
    'bing.com': 'Bing Tracking',
    'quantserve.com': 'Quantcast',
    'moatads.com': 'Moat (Oracle)',
    'rubiconproject.com': 'Rubicon Project',
    'pubmatic.com': 'PubMatic',
    'openx.net': 'OpenX',
    'criteo.com': 'Criteo',
    'adroll.com': 'AdRoll',
    'pardot.com': 'Pardot (Salesforce)',
    'marketo.com': 'Marketo (Adobe)',
    'cdn.mxpnl.com': 'Mixpanel CDN',
    'mc.yandex.ru': 'Yandex Metrica',
    'yandex.ru': 'Yandex',
  };

  // ============ 已知指纹脚本库 ============
  const FINGERPRINT_PATTERNS = [
    { pattern: 'fingerprintjs', name: 'FingerprintJS' },
    { pattern: 'fp.js', name: 'FingerprintJS (fp.js)' },
    { pattern: 'clientjs', name: 'ClientJS' },
    { pattern: 'client.js', name: 'ClientJS (client.js)' },
    { pattern: 'fingerprint2', name: 'Fingerprint2' },
    { pattern: 'fingerprint2.js', name: 'Fingerprint2.js' },
    { pattern: 'canvas-fingerprint', name: 'Canvas Fingerprint' },
    { pattern: 'deviceprint', name: 'DevicePrint (Iovation)' },
    { pattern: 'iovation', name: 'Iovation' },
    { pattern: 'threatmetrix', name: 'ThreatMetrix' },
    { pattern: 'truste', name: 'TRUSTe' },
    { pattern: 'bluekai', name: 'BlueKai (Oracle)' },
    { pattern: 'exelator', name: 'Exelate (Nielsen)' },
    { pattern: 'browser-update', name: 'Browser Update' },
    { pattern: 'botd', name: 'BotD (Fingerprint)' },
    { pattern: 'seon', name: 'SEON Fraud' },
  ];

  // ============ 追踪器分类（广告/分析/社交/其他） ============
  const TRACKER_CATEGORIES = {
    ad: {
      label: '广告', icon: '📢',
      domains: ['doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'adnxs.com',
        'amazon-adsystem.com', 'ads.twitter.com', 'criteo.com', 'taboola.com', 'outbrain.com',
        'pubmatic.com', 'rubiconproject.com', 'openx.net', 'moatads.com', 'adroll.com',
        'scorecardresearch.com', 'quantserve.com', 'zedo.com', 'serving-sys.com', 'adcolony.com']
    },
    analytics: {
      label: '分析', icon: '📊',
      domains: ['google-analytics.com', 'googletagmanager.com', 'hotjar.com', 'mixpanel.com',
        'amplitude.com', 'segment.io', 'segment.com', 'fullstory.com', 'heap.io',
        'crazyegg.com', 'optimizely.com', 'mouseflow.com', 'inspectlet.com', 'luckyorange.com',
        'clicktale.net', 'newrelic.com', 'pingdom.net', 'chartbeat.com', 'mc.yandex.ru']
    },
    social: {
      label: '社交', icon: '👥',
      domains: ['facebook.net', 'facebook.com', 'fbcdn.net', 'platform.twitter.com',
        'analytics.twitter.com', 't.co', 'linkedin.com', 'snap.licdn.com', 'pinterest.com',
        'ct.pinterest.com', 'tiktok.com', 'analytics.tiktok.com', 'connect.ok.ru', 'vk.com']
    },
    other: {
      label: '其他', icon: '🔍',
      domains: ['addthis.com', 'sharethis.com', 'disqus.com', 'gravatar.com',
        'crwdcntrl.net', 'bluekai.com', 'exelator.com', 'rlcdn.com', 'demdex.net',
        'pippio.com', 'agkn.com', 'adsymptotic.com', 'intercom.io', 'intercomcdn.com',
        'hubspot.com', 'pardot.com', 'marketo.com', 'cdn.mxpnl.com', 'nr-data.net',
        'sentry.io', 'clarity.ms', 'bing.com', 'microsoft.com', 'yandex.ru']
    }
  };

  // 根据域名归类追踪器
  function classifyTracker(domain) {
    const d = (domain || '').toLowerCase();
    for (const [catKey, cat] of Object.entries(TRACKER_CATEGORIES)) {
      if (cat.domains.some(td => d === td || d.endsWith('.' + td) || d.includes(td))) {
        return catKey;
      }
    }
    return 'other';
  }

  // ============ Toast ============
  function showToast(msg, type) {
    type = type || 'info';
    $toast.textContent = msg;
    $toast.className = 'toast toast--' + type;
    $toast.classList.add('toast--show');
    clearTimeout($toast._tm);
    $toast._tm = setTimeout(() => $toast.classList.remove('toast--show'), 3000);
  }

  // ============ Save to History ============
  async function saveToHistory(score, details) {
    try {
      await callBackground('saveToHistory', {
          toolId: 'privacy-checker',
          type: 'scan',
          data: { score, trackers: details.trackers?.length || 0, cookies: details.thirdPartyCookies + details.firstPartyCookies }
        });
    } catch (e) {}
  }

  // ============ Call content script helper ============
  // 通过 sidebar -> injector 在页面上下文中执行脚本
  function callContent(action, data) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const handler = (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

        if (!e.data || e.source !== window.parent) return;
        if (e.data && e.data.action === '__contentResponse' && e.data.data && e.data.data.__id === id) {
          window.removeEventListener('message', handler);
          resolve(e.data.data.result);
        }
      };
      window.addEventListener('message', handler);
      const timer = setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(null);
      // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
      // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
      // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
    // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
    }, 70000);
      window.parent.postMessage({ action: 'sendToContent', data: { id, action, data } }, '*');
    });
  }


  // ============ Calculate Privacy Score (0-100) ============
  function calculateScore(data) {
    let score = 100;

    // Trackers penalty: -5 per tracker, max -40
    const trackerCount = data.trackers.length;
    if (trackerCount > 0) score -= Math.min(40, trackerCount * 5);

    // Third-party cookies penalty (estimated from third-party requests that set cookies)
    const thirdPartyCount = data.thirdPartyRequests.length;
    if (thirdPartyCount > 10) score -= 15;
    else if (thirdPartyCount > 5) score -= 10;
    else if (thirdPartyCount > 0) score -= 5;

    // First-party cookies penalty
    const fpCookies = data.firstPartyCookies;
    if (fpCookies > 20) score -= 10;
    else if (fpCookies > 10) score -= 5;

    // Tracking cookie detection
    const trackingCookiePatterns = ['_ga', '_gid', '_fbp', '_fbc', 'fr', 'datr', 'sb', 'ajs_', 'mp_', 'hubspotutk', '__hstc', 'intercom-id', 'km_ai', 'km_lv', '_hjid', 'mmapi.xyz'];
    if (data.cookieNames) {
      const trackingCookies = data.cookieNames.filter(name => trackingCookiePatterns.some(p => name.startsWith(p) || name === p));
      if (trackingCookies.length > 5) score -= 10;
      else if (trackingCookies.length > 0) score -= 5;
      data.trackingCookieCount = trackingCookies.length;
    }

    // Local storage tracking penalty
    const lsKeys = data.localStorageKeys + data.sessionStorageKeys;
    if (lsKeys > 30) score -= 10;
    else if (lsKeys > 10) score -= 5;

    // localStorage tracking key detection
    if (data.localStorageTrackingKeys) {
      if (data.localStorageTrackingKeys.length > 5) score -= 10;
      else if (data.localStorageTrackingKeys.length > 0) score -= 5;
    }

    // Fingerprint scripts penalty: -15 each, max -45
    const fpCount = data.fingerprintScripts.length;
    if (fpCount > 0) score -= Math.min(45, fpCount * 15);

    // Fingerprint uniqueness penalty
    if (data.fingerprintUniqueness) {
      if (data.fingerprintUniqueness >= 80) score -= 10;
      else if (data.fingerprintUniqueness >= 50) score -= 5;
    }

    // WebRTC leak penalty
    if (data.webrtcLeak) score -= 10;

    // Privacy policy bonus
    if (data.hasPrivacyPolicy) score += 5;

    return Math.max(0, Math.min(100, score));
  }

  function getScoreLevel(score) {
    if (score >= 80) return { level: 'low', label: '较安全', color: '#4caf50' };
    if (score >= 60) return { level: 'medium', label: '中等风险', color: '#ff9800' };
    if (score >= 40) return { level: 'high', label: '高风险', color: '#f44336' };
    return { level: 'critical', label: '极高风险', color: '#9c27b0' };
  }

  function getRiskLevel(count, thresholds) {
    // thresholds: { low, medium, high }
    if (count <= thresholds.low) return 'low';
    if (count <= thresholds.medium) return 'medium';
    if (count <= thresholds.high) return 'high';
    return 'critical';
  }

  function riskLabel(level) {
    const map = { low: '低', medium: '中', high: '高', critical: '严重' };
    return map[level] || level;
  }

  // ============ Render Score Gauge ============
  function renderScore(score) {
    const info = getScoreLevel(score);
    const circumference = 2 * Math.PI * 58; // radius 58
    const offset = circumference - (score / 100) * circumference;

    $scoreSection.innerHTML = `
      <div class="pc-score-gauge">
        <svg viewBox="0 0 140 140">
          <circle class="pc-score-gauge-bg" cx="70" cy="70" r="58"></circle>
          <circle class="pc-score-gauge-fill" cx="70" cy="70" r="58"
            stroke="${info.color}"
            stroke-dasharray="${circumference}"
            stroke-dashoffset="${offset}">
          </circle>
        </svg>
        <div class="pc-score-gauge-text">
          <div class="pc-score-value" style="color:${info.color}">${score}</div>
          <div class="pc-score-label">隐私评分</div>
        </div>
      </div>
      <div class="pc-score-desc risk-${info.level}">${info.label}</div>
    `;
  }

  // ============ Render Category Cards ============
  function renderResults(data) {
    const cards = [];

    // 1. 已知追踪器检测
    const trackerRisk = getRiskLevel(data.trackers.length, { low: 0, medium: 2, high: 5 });
    cards.push({
      id: 'trackers',
      icon: '🔍',
      title: '已知追踪器检测',
      count: data.trackers.length,
      risk: data.trackers.length === 0 ? 'low' : trackerRisk,
      details: data.trackers.length > 0
        ? data.trackers.map(t => ({
            name: t.name,
            url: t.urls[0] || ''
          }))
        : [],
      emptyText: '未检测到已知追踪器 ✅'
    });

    // 2. 第三方请求检测
    const tpRisk = getRiskLevel(data.thirdPartyRequests.length, { low: 3, medium: 10, high: 20 });
    cards.push({
      id: 'thirdparty',
      icon: '🌐',
      title: '第三方请求检测',
      count: data.thirdPartyRequests.length,
      risk: data.thirdPartyRequests.length <= 3 ? 'low' : tpRisk,
      details: data.thirdPartyRequests.slice(0, 50).map(r => ({
        name: r.host,
        url: r.url
      })),
      emptyText: '未检测到第三方请求 ✅'
    });

    // 3. 第一方Cookie数量
    const cookieRisk = getRiskLevel(data.firstPartyCookies, { low: 5, medium: 15, high: 25 });
    cards.push({
      id: 'cookies',
      icon: '🍪',
      title: '第一方Cookie数量',
      count: data.firstPartyCookies,
      risk: data.firstPartyCookies <= 5 ? 'low' : cookieRisk,
      details: [],
      emptyText: '无第一方Cookie ✅',
      extraInfo: `${data.firstPartyCookies} 个Cookie`
    });

    // 4. 本地存储检测
    const totalStorage = data.localStorageKeys + data.sessionStorageKeys;
    const storageRisk = getRiskLevel(totalStorage, { low: 5, medium: 15, high: 30 });
    cards.push({
      id: 'storage',
      icon: '💾',
      title: '本地存储检测',
      count: totalStorage,
      risk: totalStorage <= 5 ? 'low' : storageRisk,
      details: [],
      emptyText: '本地存储使用量较少 ✅',
      extraInfo: `localStorage: ${data.localStorageKeys} 项 · sessionStorage: ${data.sessionStorageKeys} 项`
    });

    // 5. 指纹脚本检测
    const fpRisk = getRiskLevel(data.fingerprintScripts.length, { low: 0, medium: 1, high: 2 });
    cards.push({
      id: 'fingerprint',
      icon: '🔏',
      title: '指纹脚本检测',
      count: data.fingerprintScripts.length,
      risk: data.fingerprintScripts.length === 0 ? 'low' : fpRisk,
      details: data.fingerprintScripts.map(f => ({
        name: f.name,
        url: f.url || ''
      })),
      emptyText: '未检测到指纹脚本 ✅'
    });

    // 6. 隐私政策检测
    cards.push({
      id: 'privacy-policy',
      icon: '📜',
      title: '隐私政策检测',
      count: data.hasPrivacyPolicy ? 1 : 0,
      risk: data.hasPrivacyPolicy ? 'low' : 'medium',
      details: [],
      emptyText: '未检测到隐私政策链接 ⚠️',
      extraInfo: data.hasPrivacyPolicy
        ? `已找到隐私政策: ${escapeHtml(data.privacyPolicyUrl.substring(0, 80))}`
        : '未找到隐私政策链接'
    });

    // 7. 追踪Cookie检测 (Enhanced)
    const trackingCookieCount = data.trackingCookieCount || 0;
    const trackingCookieRisk = getRiskLevel(trackingCookieCount, { low: 0, medium: 3, high: 8 });
    cards.push({
      id: 'tracking-cookies',
      icon: '🍪',
      title: '追踪Cookie检测',
      count: trackingCookieCount,
      risk: trackingCookieCount === 0 ? 'low' : trackingCookieRisk,
      details: [],
      emptyText: '未检测到已知追踪Cookie ✅',
      extraInfo: trackingCookieCount > 0
        ? `检测到 ${trackingCookieCount} 个追踪Cookie (如 _ga, _fbp 等)`
        : '未检测到追踪Cookie'
    });

    // 8. localStorage 追踪检测 (Enhanced)
    const lsTrackingKeys = data.localStorageTrackingKeys || [];
    const lsTrackingRisk = getRiskLevel(lsTrackingKeys.length, { low: 0, medium: 3, high: 8 });
    cards.push({
      id: 'ls-tracking',
      icon: '💾',
      title: 'localStorage 追踪检测',
      count: lsTrackingKeys.length,
      risk: lsTrackingKeys.length === 0 ? 'low' : lsTrackingRisk,
      details: lsTrackingKeys.slice(0, 20).map(k => ({ name: k, url: '' })),
      emptyText: '未检测到 localStorage 追踪键 ✅',
      extraInfo: lsTrackingKeys.length > 0
        ? `发现 ${lsTrackingKeys.length} 个可疑追踪键`
        : '未检测到可疑 localStorage 键'
    });

    // 9. 浏览器指纹唯一性评估
    const fpUniqueness = data.fingerprintUniqueness || 0;
    const fpUniqueRisk = fpUniqueness >= 80 ? 'high' : fpUniqueness >= 50 ? 'medium' : 'low';
    cards.push({
      id: 'fp-uniqueness',
      icon: '🔍',
      title: '浏览器指纹唯一性',
      count: fpUniqueness,
      risk: fpUniqueRisk,
      details: [],
      emptyText: '指纹唯一性较低 ✅',
      extraInfo: `指纹唯一性: ${fpUniqueness}% (${fpUniqueness >= 80 ? '极易识别' : fpUniqueness >= 50 ? '较易识别' : '较难识别'})`
    });

    // 10. WebRTC 泄露检测
    const webrtcLeak = data.webrtcLeak || false;
    cards.push({
      id: 'webrtc-leak',
      icon: '🌐',
      title: 'WebRTC 泄露检测',
      count: webrtcLeak ? 1 : 0,
      risk: webrtcLeak ? 'high' : 'low',
      details: [],
      emptyText: '未检测到 WebRTC IP 泄露 ✅',
      extraInfo: webrtcLeak
        ? '⚠️ WebRTC 可能泄露本地IP地址'
        : '未检测到 WebRTC 泄露'
    });

    // 11. 追踪器分类统计（广告/分析/社交/其他）
    const trackerCats = { ad: 0, analytics: 0, social: 0, other: 0 };
    data.trackers.forEach(t => {
      const domain = t.urls && t.urls[0] ? (function(){ try { return new URL(t.urls[0]).hostname; } catch(e){ return t.urls[0]; } })() : t.name;
      trackerCats[classifyTracker(domain)]++;
    });
    const trackerCatCount = Object.values(trackerCats).filter(n => n > 0).length;
    cards.push({
      id: 'tracker-categories',
      icon: '🏷️',
      title: '追踪器分类统计',
      count: data.trackers.length,
      risk: data.trackers.length === 0 ? 'low' : (trackerCats.ad + trackerCats.social > 5 ? 'high' : 'medium'),
      details: Object.entries(TRACKER_CATEGORIES).map(([key, cat]) => ({
        name: cat.icon + ' ' + cat.label + ' (' + trackerCats[key] + ' 个)',
        url: trackerCats[key] > 0 ? '占比 ' + Math.round(trackerCats[key] / Math.max(1, data.trackers.length) * 100) + '%' : ''
      })),
      emptyText: '未检测到追踪器 ✅',
      extraInfo: data.trackers.length > 0
        ? '广告 ' + trackerCats.ad + ' · 分析 ' + trackerCats.analytics + ' · 社交 ' + trackerCats.social + ' · 其他 ' + trackerCats.other
        : '无追踪器'
    });

    // 12. Cookie 安全属性检查（Secure/HttpOnly/SameSite）
    const allCookies = data.cookies || [];
    let noSecure = 0, noHttpOnly = 0, noSameSite = 0, laxSameSite = 0;
    allCookies.forEach(c => {
      if (!c.secure) noSecure++;
      if (!c.httpOnly && !c.session) noHttpOnly++;
      if (!c.sameSite || c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') noSameSite++;
      else if (c.sameSite === 'lax') laxSameSite++;
    });
    const cookieSecIssues = noSecure + noHttpOnly + noSameSite;
    cards.push({
      id: 'cookie-security',
      icon: '🍪',
      title: 'Cookie 安全属性',
      count: allCookies.length,
      risk: allCookies.length === 0 ? 'low' : (cookieSecIssues > 10 ? 'high' : cookieSecIssues > 3 ? 'medium' : 'low'),
      details: allCookies.length === 0 ? [] : [
        { name: '缺少 Secure 标志', url: noSecure + ' / ' + allCookies.length + ' 个' },
        { name: '缺少 HttpOnly 标志', url: noHttpOnly + ' / ' + allCookies.length + ' 个' },
        { name: '缺少 SameSite 属性', url: noSameSite + ' / ' + allCookies.length + ' 个' },
        { name: 'SameSite=Lax (可接受)', url: laxSameSite + ' / ' + allCookies.length + ' 个' }
      ],
      emptyText: '无 Cookie 可检查 ✅',
      extraInfo: allCookies.length > 0
        ? '共 ' + allCookies.length + ' 个 Cookie，' + cookieSecIssues + ' 项安全问题'
        : '无 Cookie'
    });

    // 13. 第三方域名统计
    const domainStats = {};
    data.thirdPartyRequests.forEach(r => {
      const host = r.host || (function(){ try { return new URL(r.url).hostname; } catch(e){ return r.url; } })();
      domainStats[host] = (domainStats[host] || 0) + 1;
    });
    const sortedDomains = Object.entries(domainStats).sort((a, b) => b[1] - a[1]);
    cards.push({
      id: 'thirdparty-stats',
      icon: '🌐',
      title: '第三方域名统计',
      count: sortedDomains.length,
      risk: sortedDomains.length === 0 ? 'low' : (sortedDomains.length > 10 ? 'high' : sortedDomains.length > 5 ? 'medium' : 'low'),
      details: sortedDomains.slice(0, 20).map(([host, count]) => ({
        name: host,
        url: count + ' 次请求'
      })),
      emptyText: '未检测到第三方请求 ✅',
      extraInfo: sortedDomains.length > 0
        ? '涉及 ' + sortedDomains.length + ' 个第三方域名，最多: ' + (sortedDomains[0] ? sortedDomains[0][0] + ' (' + sortedDomains[0][1] + ')' : '')
        : '无第三方请求'
    });

    $results.innerHTML = cards.map(card => {
      const badgeClass = 'risk-badge--' + card.risk;
      const riskText = riskLabel(card.risk);
      return `
        <div class="pc-card" data-card="${card.id}">
          <div class="pc-card-head" data-toggle="${card.id}">
            <div class="pc-card-title">
              <span class="pc-card-title-icon">${card.icon}</span>
              <span>${escapeHtml(card.title)}</span>
            </div>
            <div class="pc-card-meta">
              ${card.extraInfo ? `<span style="font-size:11px;color:var(--tt-text-secondary)">${escapeHtml(card.extraInfo)}</span>` : `<span class="pc-card-count">${card.count}</span>`}
              <span class="risk-badge ${badgeClass}">${riskText}</span>
              <span class="pc-card-expand">▼</span>
            </div>
          </div>
          <div class="pc-card-body">
            ${card.details.length > 0
              ? card.details.map(d => `
                  <div class="pc-detail-row">
                    <span class="pc-detail-name" title="${escapeHtml(d.name)}">${escapeHtml(d.name)}</span>
                    <span class="pc-detail-url" title="${escapeHtml(d.url)}">${escapeHtml(d.url.split('?')[0])}</span>
                  </div>
                `).join('')
              : `<div class="pc-empty-detail">${card.emptyText}</div>`
            }
          </div>
        </div>
      `;
    }).join('');

    // Bind card toggle
    $results.querySelectorAll('.pc-card-head').forEach(head => {
      head.addEventListener('click', () => {
        const cardId = head.dataset.toggle;
        const card = $results.querySelector(`[data-card="${cardId}"]`);
        if (card) card.classList.toggle('pc-card--open');
      });
    });
  }

  // ============ Render Recommendations ============
  function renderRecommendations(data, score) {
    const recos = [];

    if (data.trackers.length > 0) {
      recos.push({
        icon: '🚫',
        text: `检测到 ${data.trackers.length} 个已知追踪器，建议使用广告拦截器（如 uBlock Origin）阻止追踪请求。`
      });
    }

    if (data.thirdPartyRequests.length > 10) {
      recos.push({
        icon: '🌐',
        text: `页面加载了 ${data.thirdPartyRequests.length} 个第三方请求，数量较多。建议检查是否必要，并使用浏览器隐私设置限制第三方请求。`
      });
    }

    if (data.firstPartyCookies > 15) {
      recos.push({
        icon: '🍪',
        text: `第一方Cookie数量较多（${data.firstPartyCookies} 个），建议定期清理Cookie或使用浏览器自动清理功能。`
      });
    }

    if (data.localStorageKeys + data.sessionStorageKeys > 15) {
      recos.push({
        icon: '💾',
        text: '本地存储使用量较多，部分网站可能利用本地存储进行跨会话追踪，建议定期清理。'
      });
    }

    if (data.fingerprintScripts.length > 0) {
      recos.push({
        icon: '🔏',
        text: `检测到 ${data.fingerprintScripts.length} 个浏览器指纹脚本，这些脚本可唯一识别您的浏览器。建议使用反指纹浏览器或 Tor Browser 进行防护。`
      });
    }

    if (!data.hasPrivacyPolicy) {
      recos.push({
        icon: '📜',
        text: '未找到隐私政策链接，该网站可能缺少明确的数据使用声明，建议谨慎提供个人信息。'
      });
    }

    if (data.webrtcLeak) {
      recos.push({
        icon: '🌐',
        text: 'WebRTC 可能泄露您的本地 IP 地址。建议在浏览器设置中禁用 WebRTC 或使用浏览器扩展阻止 WebRTC 泄露。'
      });
    }

    if (data.fingerprintUniqueness && data.fingerprintUniqueness >= 80) {
      recos.push({
        icon: '🔍',
        text: `您的浏览器指纹唯一性高达 ${data.fingerprintUniqueness}%，极易被网站识别追踪。建议使用 Tor Browser 或安装反指纹扩展。`
      });
    }

    if (data.trackingCookieCount && data.trackingCookieCount > 3) {
      recos.push({
        icon: '🍪',
        text: `检测到 ${data.trackingCookieCount} 个追踪Cookie，建议定期清理Cookie或使用浏览器自动清理功能。`
      });
    }

    if (data.localStorageTrackingKeys && data.localStorageTrackingKeys.length > 0) {
      recos.push({
        icon: '💾',
        text: `检测到 ${data.localStorageTrackingKeys.length} 个可疑 localStorage 追踪键，部分网站利用本地存储进行跨会话追踪。`
      });
    }

    // 拦截建议：Cookie 安全属性
    if (data.cookies && data.cookies.length > 0) {
      let noSecure = 0, noHttpOnly = 0, noSameSite = 0;
      data.cookies.forEach(c => {
        if (!c.secure) noSecure++;
        if (!c.httpOnly && !c.session) noHttpOnly++;
        if (!c.sameSite || c.sameSite === 'no_restriction' || c.sameSite === 'unspecified') noSameSite++;
      });
      if (noSecure > 0 || noHttpOnly > 0 || noSameSite > 0) {
        recos.push({
          icon: '🍪',
          text: `Cookie 安全属性不足：${noSecure} 个缺少 Secure、${noHttpOnly} 个缺少 HttpOnly、${noSameSite} 个缺少 SameSite。建议网站侧设置 Secure/HttpOnly/SameSite=Strict，浏览器侧可启用"屏蔽第三方 Cookie"。`
        });
      }
    }

    // 拦截建议：第三方域名拦截
    if (data.thirdPartyRequests && data.thirdPartyRequests.length > 5) {
      const domainStats = {};
      data.thirdPartyRequests.forEach(r => {
        const host = r.host || (function(){ try { return new URL(r.url).hostname; } catch(e){ return r.url; } })();
        domainStats[host] = (domainStats[host] || 0) + 1;
      });
      const topDomains = Object.entries(domainStats).sort((a, b) => b[1] - a[1]).slice(0, 3);
      recos.push({
        icon: '🚫',
        text: `检测到 ${data.thirdPartyRequests.length} 个第三方请求，涉及 ${Object.keys(domainStats).length} 个域名。建议在"追踪拦截器"中拦截高频域名：${topDomains.map(d => d[0]).join('、')}。`
      });
    }

    // 拦截建议：追踪器分类
    if (data.trackers && data.trackers.length > 0) {
      const cats = { ad: 0, analytics: 0, social: 0, other: 0 };
      data.trackers.forEach(t => {
        const domain = t.urls && t.urls[0] ? (function(){ try { return new URL(t.urls[0]).hostname; } catch(e){ return t.urls[0]; } })() : t.name;
        cats[classifyTracker(domain)]++;
      });
      const parts = [];
      if (cats.ad) parts.push('广告 ' + cats.ad);
      if (cats.analytics) parts.push('分析 ' + cats.analytics);
      if (cats.social) parts.push('社交 ' + cats.social);
      if (cats.other) parts.push('其他 ' + cats.other);
      recos.push({
        icon: '🏷️',
        text: `追踪器分类：${parts.join('、')}。建议在浏览器设置中启用"严格追踪保护"，或使用追踪拦截器针对相应类别拦截。`
      });
    }

    if (score >= 80) {
      recos.push({
        icon: '✅',
        text: '当前页面隐私状况良好，继续保持良好的浏览习惯。'
      });
    }

    if (recos.length === 0) {
      recos.push({ icon: '✅', text: '当前页面隐私状况良好，未发现明显隐私风险。' });
    }

    $recoList.innerHTML = recos.map(r => `
      <div class="pc-reco-item">
        <span class="pc-reco-icon">${r.icon}</span>
        <span class="pc-reco-text">${escapeHtml(r.text)}</span>
      </div>
    `).join('');

    $recommendations.style.display = recos.length > 0 ? 'block' : 'none';
  }

  // ============ Main Scan ============
  async function scan() {
    $scoreSection.innerHTML = '<div class="pc-score-placeholder">⏳ 正在检测页面隐私状况...</div>';
    $results.innerHTML = '';
    $recommendations.style.display = 'none';

    const data = await callContent('privacyScan');

    if (!data) {
      $scoreSection.innerHTML = '<div class="pc-score-placeholder">❌ 检测失败，请确保当前页面为普通网页（非浏览器内部页面）</div>';
      return;
    }

    // ── Enhanced: Browser Fingerprint Uniqueness Estimation ──
    try {
      let uniquenessPoints = 0;
      if (navigator.userAgent) uniquenessPoints += 15;
      if (screen.width && screen.height) uniquenessPoints += 10;
      if (navigator.language) uniquenessPoints += 5;
      if (navigator.hardwareConcurrency) uniquenessPoints += 10;
      if (navigator.platform) uniquenessPoints += 10;
      if (window.devicePixelRatio && window.devicePixelRatio !== 1) uniquenessPoints += 10;
      try { const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); if (ctx) uniquenessPoints += 15; } catch(e) {}
      try { const gl = document.createElement('canvas').getContext('webgl'); if (gl) { uniquenessPoints += 15; const info = gl.getExtension('WEBGL_debug_renderer_info'); if (info) uniquenessPoints += 10; } } catch(e) {}
      data.fingerprintUniqueness = Math.min(100, uniquenessPoints);
    } catch(e) {
      data.fingerprintUniqueness = 0;
    }

    // ── Enhanced: WebRTC Leak Detection ──
    // STUN 地址来自「设置 → 服务端点 → STUN 服务器」，可指向自建 coturn；
    // 工具内不硬编码任何 STUN 地址。解析失败时不配置 STUN，此时无法收集
    // srflx 候选，检测会如实返回"未发现泄露"而不是伪造结果。
    try {
      let stunUrl = '';
      try {
        const resolved = await callBackground('clientRequestUrl', { kind: 'stun', params: {} });
        if (resolved && resolved.success && resolved.url) stunUrl = resolved.url;
      } catch (e) { /* 无 STUN 时继续，仅检测本地候选 */ }
      const rtcConfig = stunUrl ? { iceServers: [{ urls: stunUrl }] } : {};
      data.webrtcLeak = false;
      try {
        const pc = new RTCPeerConnection(rtcConfig);
        pc.createDataChannel('');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        // Check if local IP is exposed in SDP
        const sdp = pc.localDescription?.sdp || '';
        const ipRegex = /([0-9]{1,3}\.){3}[0-9]{1,3}/g;
        const localIPs = sdp.match(ipRegex);
        if (localIPs && localIPs.some(ip => !ip.startsWith('0.') && ip !== '0.0.0.0')) {
          data.webrtcLeak = true;
        }
        pc.close();
      } catch(e) {
        // RTCPeerConnection not available
      }
    } catch(e) {
      data.webrtcLeak = false;
    }

    // ── Enhanced: Tracking Cookie Detection ──
    try {
      const cookieResult = await callBackground('getAllCookies', { domain: '' });
      if (cookieResult && cookieResult.success && cookieResult.cookies) {
        const trackingPatterns = ['_ga', '_gid', '_fbp', '_fbc', 'fr', 'datr', 'sb', 'ajs_', 'mp_', 'hubspotutk', '__hstc', 'intercom-id', '_hjid'];
        data.cookies = cookieResult.cookies; // 保存完整 Cookie 对象，用于安全属性检查
        data.cookieNames = cookieResult.cookies.map(c => c.name);
        data.trackingCookieCount = data.cookieNames.filter(name =>
          trackingPatterns.some(p => name.startsWith(p) || name === p)
        ).length;
      }
    } catch(e) {}

    // ── Enhanced: localStorage Tracking Key Detection ──
    try {
      const lsTrackingPatterns = ['_ga', '_gid', 'fp', 'fingerprint', 'track', 'visitor', 'session_id', 'uid', 'user_id', 'device', 'browser', 'client'];
      const lsKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (lsTrackingPatterns.some(p => key.toLowerCase().includes(p))) {
          lsKeys.push(key);
        }
      }
      data.localStorageTrackingKeys = lsKeys;
    } catch(e) {
      data.localStorageTrackingKeys = [];
    }

    const score = calculateScore(data);

    renderScore(score);
    renderResults(data);
    renderRecommendations(data, score);

    showToast(`检测完成，隐私评分: ${score}/100`, score >= 60 ? 'success' : 'error');
    saveToHistory(score, data);
  }

  // ============ Event Bindings ============
  document.getElementById('btn-scan').addEventListener('click', scan);
  document.getElementById('btn-refresh').addEventListener('click', scan);

  // ============ Message Listener ============
  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
    if (event.data && event.data.action === 'setData' && typeof event.data.data === 'string') {
      // setData support - trigger scan if URL provided
      scan();
    }
  });
});
