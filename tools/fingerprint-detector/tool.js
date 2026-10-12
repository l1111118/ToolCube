/**
 * 浏览器指纹检测 - 检测浏览器泄露的可追踪指纹信息
 */
let elements = {};

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
    }, 70000);
    _pendingMsgs.set(id, { resolve, reject, timer });
    window.parent.postMessage({ action: 'callBackground', data: { id, action, data } }, '*');
  });
}


// SHA-256 hash using Web Crypto API
async function sha256(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============ Canvas Fingerprint ============
function getCanvasFingerprint() {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, 400, 200);

  // Text with various fonts
  ctx.fillStyle = '#c00';
  ctx.font = '18px Arial';
  ctx.fillText('Fingerprint Test 🎨', 10, 30);

  ctx.fillStyle = '#0a0';
  ctx.font = 'bold 16px Georgia';
  ctx.fillText('Browser FP Detection', 10, 60);

  ctx.fillStyle = '#00c';
  ctx.font = 'italic 14px Times New Roman';
  ctx.fillText('Unique Canvas Rendering', 10, 85);

  // Shapes
  ctx.beginPath();
  ctx.arc(300, 60, 40, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,0,0,0.5)';
  ctx.fill();

  ctx.beginPath();
  ctx.rect(250, 110, 80, 60);
  ctx.fillStyle = 'rgba(0,0,255,0.3)';
  ctx.fill();

  // Gradient
  const grad = ctx.createLinearGradient(10, 130, 200, 170);
  grad.addColorStop(0, '#ff0000');
  grad.addColorStop(0.5, '#00ff00');
  grad.addColorStop(1, '#0000ff');
  ctx.fillStyle = grad;
  ctx.fillRect(10, 140, 200, 30);

  // More text
  ctx.fillStyle = '#333';
  ctx.font = '12px Courier New';
  ctx.fillText('Cwm fjord veg balks nth pyx quiz', 10, 180);

  return canvas.toDataURL();
}

// ============ WebGL Fingerprint ============
function getWebGLFingerprint() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  const result = { renderer: '不支持', vendor: '不支持', params: {} };

  if (!gl) return result;

  const info = gl.getExtension('WEBGL_debug_renderer_info');
  if (info) {
    result.renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '未知';
    result.vendor = gl.getParameter(info.UNMASKED_VENDOR_WEBGL) || '未知';
  }

  result.params = {
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    maxViewportDims: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)).join('×'),
    maxCubeMapTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
    maxTextureImageUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
    maxVertexTextureImageUnits: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS),
    maxCombinedTextureImageUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
    maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
    maxVertexUniformVectors: gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
    maxFragmentUniformVectors: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
    maxVaryingVectors: gl.getParameter(gl.MAX_VARYING_VECTORS),
    aliasedPointSizeRange: Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)).join('-'),
    aliasedLineWidthRange: Array.from(gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE)).join('-'),
    version: gl.getParameter(gl.VERSION),
    shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION)
  };

  return result;
}

// ============ Audio Fingerprint ============
function getAudioFingerprint() {
  return new Promise(resolve => {
    try {
      // 使用 OfflineAudioContext 避免产生可听噪声
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtx) { resolve({ hash: '不支持', supported: false }); return; }

      const context = new OfflineCtx(1, 4096, 44100);
      const oscillator = context.createOscillator();
      const compressor = context.createDynamicsCompressor();

      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(10000, 0);

      compressor.threshold.setValueAtTime(-50, 0);
      compressor.knee.setValueAtTime(40, 0);
      compressor.ratio.setValueAtTime(12, 0);
      compressor.attack.setValueAtTime(0, 0);
      compressor.release.setValueAtTime(0.25, 0);

      oscillator.connect(compressor);
      compressor.connect(context.destination);
      oscillator.start(0);

      context.startRendering().then(buffer => {
        const data = Array.from(buffer.getChannelData(0).slice(0, 50)).map(v => v.toFixed(10)).join(',');
        resolve({ hash: data, supported: true, sampleRate: context.sampleRate });
      }).catch(e => {
        resolve({ hash: '渲染失败: ' + e.message, supported: false });
      });
    } catch (e) {
      resolve({ hash: '检测失败: ' + e.message, supported: false });
    }
  });
}

// ============ Font Enumeration ============
function detectFonts() {
  const testFonts = [
    'Arial', 'Arial Black', 'Arial Narrow', 'Book Antiqua', 'Bookman Old Style',
    'Bradley Hand', 'Calibri', 'Cambria', 'Cambria Math', 'Century',
    'Century Gothic', 'Comic Sans MS', 'Consolas', 'Constantia', 'Copperplate Gothic',
    'Courier', 'Courier New', 'Didot', 'Franklin Gothic Medium', 'Garamond',
    'Geneva', 'Georgia', 'Gill Sans', 'Goudy Old Style', 'Helvetica',
    'Helvetica Neue', 'Hoefler Text', 'Impact', 'Lucida Bright', 'Lucida Console',
    'Lucida Grande', 'Lucida Sans', 'Lucida Sans Typewriter', 'Microsoft Sans Serif',
    'Monaco', 'Monotype Corsiva', 'MS Gothic', 'MS PGothic', 'MS UI Gothic',
    'Optima', 'Palatino', 'Palatino Linotype', 'Papyrus', 'Perpetua',
    'Rockwell', 'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Light',
    'Segoe UI Semibold', 'Segoe UI Symbol', 'SimHei', 'SimSun', 'STHeiti',
    'STSong', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS',
    'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic'
  ];

  const testString = 'mmmmmmmmmmlli';
  const testSize = '72px';
  const baseFonts = ['monospace'];
  const body = document.body;

  const span = document.createElement('span');
  span.style.position = 'absolute';
  span.style.left = '-9999px';
  span.style.fontSize = testSize;
  span.style.lineHeight = 'normal';
  span.textContent = testString;
  body.appendChild(span);

  // Get base widths
  const baseWidths = {};
  baseFonts.forEach(f => {
    span.style.fontFamily = f;
    baseWidths[f] = span.offsetWidth;
  });

  const detected = [];
  testFonts.forEach(font => {
    let found = false;
    baseFonts.forEach(base => {
      span.style.fontFamily = "'" + font + "', " + base;
      if (span.offsetWidth !== baseWidths[base]) found = true;
    });
    if (found) detected.push(font);
  });

  body.removeChild(span);
  return detected;
}

// ============ Battery API Fingerprint ============
async function getBatteryFingerprint() {
  try {
    if (!navigator.getBattery) return { supported: false, info: '不支持 Battery API' };
    const battery = await navigator.getBattery();
    const info = {
      supported: true,
      level: battery.level,
      charging: battery.charging,
      chargingTime: battery.chargingTime,
      dischargingTime: battery.dischargingTime
    };
    return info;
  } catch (e) {
    return { supported: false, info: '检测失败: ' + e.message };
  }
}

// ============ WebRTC IP Leak Detection ============
/**
 * 解析后的 STUN 地址。
 *
 * STUN 属于「服务端点」中的一类（设置 → 服务端点 → STUN 服务器），
 * 可指向自建 coturn。工具内**不再硬编码**任何 STUN 地址；
 * 解析失败时退化为"不配置 STUN"，此时 ICE 无法收集 srflx 候选，
 * 检测结果会如实显示为"无法确定"，而不是假装检测成功。
 */
let resolvedStunUrl = '';

async function loadStunUrl() {
  if (resolvedStunUrl) return resolvedStunUrl;
  try {
    const r = await callBackground('clientRequestUrl', { kind: 'stun', params: {} });
    if (r && r.success && r.url) resolvedStunUrl = r.url;
  } catch (e) {
    // 保持为空：不使用 STUN
  }
  return resolvedStunUrl;
}

async function getWebRTCFingerprint() {
  const stunUrl = await loadStunUrl();
  return new Promise(resolve => {
    try {
      const RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
      if (!RTCPeerConnection) { resolve({ supported: false, localIPs: [], info: '不支持 WebRTC' }); return; }
      const pc = new RTCPeerConnection(stunUrl ? { iceServers: [{ urls: stunUrl }] } : {});
      const localIPs = [];
      pc.createDataChannel('');
      pc.onicecandidate = function (e) {
        if (!e.candidate) {
          try { pc.close(); } catch (err) {}
          resolve({
            supported: true,
            localIPs: localIPs,
            leaked: localIPs.length > 0,
            info: localIPs.length > 0 ? '发现本地IP: ' + localIPs.join(', ') : '未泄露IP'
          });
          return;
        }
        const cand = e.candidate.candidate || '';
        const ipMatch = cand.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
        if (ipMatch) {
          const ip = ipMatch[0];
          if (!localIPs.includes(ip) && ip !== '0.0.0.0') localIPs.push(ip);
        }
        // IPv6
        const ipv6Match = cand.match(/([0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}/i);
        if (ipv6Match) {
          const ip6 = ipv6Match[0];
          if (!localIPs.includes(ip6)) localIPs.push(ip6);
        }
      };
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => {
        resolve({ supported: true, localIPs: [], leaked: false, info: 'ICE 收集失败' });
      });
      // 超时保护
      setTimeout(() => {
        try { pc.close(); } catch (e) {}
        resolve({
          supported: true,
          localIPs: localIPs,
          leaked: localIPs.length > 0,
          info: localIPs.length > 0 ? '发现本地IP: ' + localIPs.join(', ') : '超时未检测到IP'
        });
      }, 5000);
    } catch (e) {
      resolve({ supported: false, localIPs: [], info: '检测失败: ' + e.message });
    }
  });
}

// ============ Main Detection ============
async function runDetection() {
  elements.btnDetect.disabled = true;
  elements.btnDetect.textContent = '⏳ 检测中...';
  elements.fpSections.innerHTML = '<div class="fp-loading"><span class="fp-loading-spinner"></span>正在收集指纹数据...</div>';

  const allData = {};
  const sections = [];

  // 1. Canvas Fingerprint
  try {
    const canvasDataURL = getCanvasFingerprint();
    const canvasHash = await sha256(canvasDataURL);
    allData.canvas = canvasHash;
    sections.push({
      id: 'canvas',
      icon: '🎨',
      title: 'Canvas 指纹',
      risk: 'high',
      riskText: '高风险',
      items: [
        { key: 'Canvas 哈希', value: canvasHash },
        { key: '数据大小', value: canvasDataURL.length + ' 字符' }
      ]
    });
  } catch (e) {
    sections.push({ id: 'canvas', icon: '🎨', title: 'Canvas 指纹', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '不支持' }] });
  }

  // 2. WebGL Fingerprint
  try {
    const webgl = getWebGLFingerprint();
    allData.webgl = JSON.stringify(webgl);
    const webglItems = [
      { key: '渲染器', value: webgl.renderer },
      { key: '厂商', value: webgl.vendor }
    ];
    Object.entries(webgl.params).forEach(([k, v]) => {
      webglItems.push({ key: k, value: String(v) });
    });
    sections.push({
      id: 'webgl',
      icon: '🎮',
      title: 'WebGL 指纹',
      risk: webgl.renderer !== '不支持' ? 'high' : 'low',
      riskText: webgl.renderer !== '不支持' ? '高风险' : '不可用',
      items: webglItems
    });
  } catch (e) {
    sections.push({ id: 'webgl', icon: '🎮', title: 'WebGL 指纹', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '检测失败' }] });
  }

  // 3. Audio Fingerprint
  try {
    const audio = await getAudioFingerprint();
    const audioHash = await sha256(audio.hash);
    allData.audio = audioHash;
    sections.push({
      id: 'audio',
      icon: '🔊',
      title: 'Audio 指纹',
      risk: audio.supported ? 'medium' : 'low',
      riskText: audio.supported ? '中风险' : '不可用',
      items: [
        { key: 'Audio 哈希', value: audioHash },
        { key: '采样率', value: audio.sampleRate ? audio.sampleRate + ' Hz' : '—' },
        { key: '支持', value: audio.supported ? '是' : '否' }
      ]
    });
  } catch (e) {
    sections.push({ id: 'audio', icon: '🔊', title: 'Audio 指纹', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '检测失败' }] });
  }

  // 4. Font Enumeration
  try {
    const fonts = detectFonts();
    allData.fonts = fonts.join(',');
    sections.push({
      id: 'fonts',
      icon: '🔤',
      title: '字体枚举',
      risk: fonts.length > 20 ? 'high' : fonts.length > 10 ? 'medium' : 'low',
      riskText: fonts.length > 20 ? '高风险' : fonts.length > 10 ? '中风险' : '低风险',
      items: [
        { key: '检测到字体数', value: fonts.length + ' 个' },
        { key: '字体列表', value: fonts.join(', ') }
      ]
    });
  } catch (e) {
    sections.push({ id: 'fonts', icon: '🔤', title: '字体枚举', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '检测失败' }] });
  }

  // 5. Screen Info
  try {
    const screenInfo = {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      devicePixelRatio: window.devicePixelRatio
    };
    allData.screen = JSON.stringify(screenInfo);
    sections.push({
      id: 'screen',
      icon: '🖥️',
      title: '屏幕信息',
      risk: 'medium',
      riskText: '中风险',
      items: [
        { key: '分辨率', value: screen.width + '×' + screen.height },
        { key: '可用区域', value: screen.availWidth + '×' + screen.availHeight },
        { key: '色深', value: screen.colorDepth + ' bit' },
        { key: '像素深度', value: screen.pixelDepth + ' bit' },
        { key: '设备像素比', value: (window.devicePixelRatio || 1).toFixed(2) }
      ]
    });
  } catch (e) {
    sections.push({ id: 'screen', icon: '🖥️', title: '屏幕信息', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '检测失败' }] });
  }

  // 6. Hardware Info
  try {
    const hardware = {
      platform: navigator.platform || '未知',
      hardwareConcurrency: navigator.hardwareConcurrency || '未知',
      deviceMemory: navigator.deviceMemory || '未知',
      maxTouchPoints: navigator.maxTouchPoints || 0
    };
    allData.hardware = JSON.stringify(hardware);
    sections.push({
      id: 'hardware',
      icon: '⚙️',
      title: '硬件信息',
      risk: hardware.hardwareConcurrency !== '未知' ? 'medium' : 'low',
      riskText: hardware.hardwareConcurrency !== '未知' ? '中风险' : '低风险',
      items: [
        { key: '平台', value: hardware.platform },
        { key: 'CPU 核心数', value: String(hardware.hardwareConcurrency) },
        { key: '设备内存', value: hardware.deviceMemory === '未知' ? '未暴露' : hardware.deviceMemory + ' GB' },
        { key: '最大触控点', value: String(hardware.maxTouchPoints) }
      ]
    });
  } catch (e) {
    sections.push({ id: 'hardware', icon: '⚙️', title: '硬件信息', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '检测失败' }] });
  }

  // 7. Browser Features
  try {
    const plugins = Array.from(navigator.plugins || []).map(p => p.name);
    const mimeTypes = Array.from(navigator.mimeTypes || []).map(m => m.type);
    const languages = navigator.languages ? navigator.languages.join(', ') : navigator.language;
    const browserFeatures = {
      userAgent: navigator.userAgent,
      language: navigator.language,
      languages: languages,
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      plugins: plugins.join(', '),
      mimeTypes: mimeTypes.join(', ')
    };
    allData.browser = JSON.stringify(browserFeatures);
    sections.push({
      id: 'browser',
      icon: '🌐',
      title: '浏览器特征',
      risk: 'high',
      riskText: '高风险',
      items: [
        { key: 'User-Agent', value: navigator.userAgent },
        { key: '语言', value: browserFeatures.language },
        { key: '语言列表', value: languages },
        { key: 'Cookie', value: navigator.cookieEnabled ? '已启用' : '未启用' },
        { key: 'Do Not Track', value: navigator.doNotTrack === '1' ? '已启用' : '未启用' },
        { key: '插件数', value: plugins.length + ' 个' },
        { key: '插件列表', value: plugins.length > 0 ? plugins.join(', ') : '无' },
        { key: 'MIME 类型', value: mimeTypes.length > 0 ? mimeTypes.join(', ') : '无' }
      ]
    });
  } catch (e) {
    sections.push({ id: 'browser', icon: '🌐', title: '浏览器特征', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '检测失败' }] });
  }

  // 8. Timezone Info
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = new Date().getTimezoneOffset();
    const offsetHours = -offset / 60;
    const offsetStr = 'UTC' + (offsetHours >= 0 ? '+' : '') + offsetHours;
    allData.timezone = tz + offsetStr;
    sections.push({
      id: 'timezone',
      icon: '🕐',
      title: '时区信息',
      risk: 'medium',
      riskText: '中风险',
      items: [
        { key: '时区', value: tz },
        { key: 'UTC 偏移', value: offsetStr },
        { key: '偏移分钟', value: offset + ' 分钟' }
      ]
    });
  } catch (e) {
    sections.push({ id: 'timezone', icon: '🕐', title: '时区信息', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '检测失败' }] });
  }

  // 9. Storage Estimate
  try {
    let storageInfo = '不可用';
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      storageInfo = JSON.stringify({ quota: est.quota, usage: est.usage });
      allData.storage = storageInfo;
      sections.push({
        id: 'storage',
        icon: '💾',
        title: '存储估算',
        risk: 'low',
        riskText: '低风险',
        items: [
          { key: '配额', value: formatBytes(est.quota) },
          { key: '已使用', value: formatBytes(est.usage) },
          { key: '使用率', value: ((est.usage / est.quota) * 100).toFixed(2) + '%' }
        ]
      });
    } else {
      allData.storage = '不可用';
      sections.push({
        id: 'storage', icon: '💾', title: '存储估算', risk: 'low', riskText: '不可用',
        items: [{ key: '状态', value: 'API 不可用' }]
      });
    }
  } catch (e) {
    sections.push({ id: 'storage', icon: '💾', title: '存储估算', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '检测失败' }] });
  }

  // 10. Battery API Fingerprint
  try {
    const battery = await getBatteryFingerprint();
    if (battery.supported) {
      allData.battery = JSON.stringify(battery);
      sections.push({
        id: 'battery',
        icon: '🔋',
        title: 'Battery API 指纹',
        risk: 'medium',
        riskText: '中风险',
        items: [
          { key: '支持', value: '是' },
          { key: '电量', value: (battery.level * 100).toFixed(0) + '%' },
          { key: '充电状态', value: battery.charging ? '充电中' : '使用电池' },
          { key: '充电时间', value: battery.chargingTime === Infinity ? '∞' : battery.chargingTime + ' 秒' },
          { key: '放电时间', value: battery.dischargingTime === Infinity ? '∞' : battery.dischargingTime + ' 秒' }
        ]
      });
    } else {
      allData.battery = '不支持';
      sections.push({
        id: 'battery', icon: '🔋', title: 'Battery API 指纹', risk: 'low', riskText: '不可用',
        items: [{ key: '状态', value: battery.info || '不支持' }]
      });
    }
  } catch (e) {
    sections.push({ id: 'battery', icon: '🔋', title: 'Battery API 指纹', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '检测失败' }] });
  }

  // 11. WebRTC IP Leak
  try {
    const webrtc = await getWebRTCFingerprint();
    if (webrtc.supported) {
      allData.webrtc = JSON.stringify(webrtc.localIPs);
      const leaked = webrtc.leaked;
      sections.push({
        id: 'webrtc',
        icon: '🌐',
        title: 'WebRTC IP 泄露',
        risk: leaked ? 'high' : 'low',
        riskText: leaked ? '高风险' : '低风险',
        items: [
          { key: '支持', value: '是' },
          { key: '泄露状态', value: leaked ? '⚠️ 已泄露本地IP' : '未泄露' },
          { key: '检测到的IP', value: webrtc.localIPs.length > 0 ? webrtc.localIPs.join(', ') : '无' },
          { key: 'IP 数量', value: String(webrtc.localIPs.length) }
        ]
      });
    } else {
      allData.webrtc = '不支持';
      sections.push({
        id: 'webrtc', icon: '🌐', title: 'WebRTC IP 泄露', risk: 'low', riskText: '不可用',
        items: [{ key: '状态', value: webrtc.info || '不支持' }]
      });
    }
  } catch (e) {
    sections.push({ id: 'webrtc', icon: '🌐', title: 'WebRTC IP 泄露', risk: 'low', riskText: '不可用', items: [{ key: '状态', value: '检测失败' }] });
  }

  // Calculate overall hash
  const allDataStr = JSON.stringify(allData);
  const overallHash = await sha256(allDataStr);

  // Calculate score
  const score = calculateScore(sections);

  // Render
  renderScore(score, overallHash);
  renderSections(sections);
  renderRecommendations(sections);

  elements.scoreSection.style.display = 'grid';
  elements.fpRecommendations.style.display = 'block';
  elements.btnDetect.disabled = false;
  elements.btnDetect.textContent = '🔄 重新检测';

  showToast('检测完成', 'success');
  saveToHistory(overallHash, 'fingerprint');
}

function calculateScore(sections) {
  let points = 0;
  const weights = { high: 15, medium: 8, low: 2 };
  sections.forEach(s => { points += weights[s.risk] || 0; });
  // 这是一个**启发式风险分**：只反映"当前暴露了多少可用于跨站识别的稳定特征"，
  // 不代表在人群中的唯一性百分位（本扩展没有任何人群样本数据可依据）。
  let extraPoints = 0;
  sections.forEach(s => {
    if (s.id === 'canvas' && s.risk === 'high') extraPoints += 5;
    if (s.id === 'webgl' && s.risk === 'high') extraPoints += 5;
    if (s.id === 'audio' && s.risk === 'medium') extraPoints += 3;
    if (s.id === 'fonts' && s.risk !== 'low') extraPoints += 3;
    if (s.id === 'browser' && s.risk === 'high') extraPoints += 4;
    if (s.id === 'hardware' && s.risk !== 'low') extraPoints += 2;
    if (s.id === 'screen' && s.risk !== 'low') extraPoints += 2;
  });
  return Math.min(100, points + extraPoints);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function renderScore(score, hash) {
  elements.fpScore.textContent = score + '/100';

  // 描述只说明"暴露了多少可识别特征"，不给出人群唯一性百分位：
  // 旧实现写的"前1% / 前10% / 约30% 唯一性"没有任何数据来源，属于凭空生成的结论。
  let color, desc;
  if (score >= 80) { color = '#e53935'; desc = '极高 — 多项高熵特征同时暴露，极易被跨站识别'; }
  else if (score >= 60) { color = '#f57c00'; desc = '较高 — 存在多项可用于识别的稳定特征'; }
  else if (score >= 40) { color = '#fbc02d'; desc = '中等 — 部分特征可用于识别'; }
  else if (score >= 20) { color = '#7cb342'; desc = '较低 — 可识别的稳定特征较少'; }
  else { color = '#388e3c'; desc = '低 — 未发现明显的可识别特征'; }

  elements.fpScore.style.color = color;
  elements.fpScoreBar.style.width = score + '%';
  elements.fpScoreBar.style.background = color;
  elements.fpScoreDesc.textContent = desc;
  elements.fpHash.textContent = hash;
}

function renderSections(sections) {
  elements.fpSections.innerHTML = sections.map(s => {
    const itemsHtml = s.items.map(item =>
      '<div class="fp-item"><span class="fp-item-key">' + escHtml(item.key) +
      '</span><span class="fp-item-value">' + escHtml(String(item.value)) + '</span></div>'
    ).join('');

    return '<div class="fp-section" id="fp-sec-' + s.id + '">' +
      '<div class="fp-section-header" data-section="' + s.id + '">' +
        '<div class="fp-section-left">' +
          '<span class="fp-section-icon">' + s.icon + '</span>' +
          '<span class="fp-section-title">' + escHtml(s.title) + '</span>' +
        '</div>' +
        '<div class="fp-section-right">' +
          '<span class="fp-section-badge fp-section-badge--' + s.risk + '">' + escHtml(s.riskText) + '</span>' +
          '<span class="fp-section-arrow">▼</span>' +
        '</div>' +
      '</div>' +
      '<div class="fp-section-body">' + itemsHtml + '</div>' +
    '</div>';
  }).join('');

  // Bind toggle
  elements.fpSections.querySelectorAll('.fp-section-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('open');
    });
  });

  // Open first section by default
  const first = elements.fpSections.querySelector('.fp-section');
  if (first) first.classList.add('open');
}

function renderRecommendations(sections) {
  const recs = [];

  const highRiskSections = sections.filter(s => s.risk === 'high');
  if (highRiskSections.length > 0) {
    recs.push({ icon: '⚠️', text: '你存在 ' + highRiskSections.length + ' 个高风险指纹向量（' + highRiskSections.map(s => s.title).join('、') + '），这些是最容易被追踪的特征。' });
  }

  const canvasSec = sections.find(s => s.id === 'canvas');
  if (canvasSec && canvasSec.risk === 'high') {
    recs.push({ icon: '🎨', text: 'Canvas 指纹是强追踪向量。可使用隐私浏览器（如 Tor Browser）或安装 Canvas Blocker 扩展来添加随机噪声。Firefox 可在 about:config 设置 privacy.resistFingerprinting = true。' });
  }

  const webglSec = sections.find(s => s.id === 'webgl');
  if (webglSec && webglSec.risk === 'high') {
    recs.push({ icon: '🎮', text: 'WebGL 渲染器和厂商信息可直接暴露你的显卡型号。隐私浏览器通常会对这些信息进行模糊处理。建议禁用 WebGL 或使用扩展模糊化。' });
  }

  const audioSec = sections.find(s => s.id === 'audio');
  if (audioSec && audioSec.risk === 'medium') {
    recs.push({ icon: '🔊', text: 'AudioContext 指纹可通过音频处理差异识别浏览器。在 Firefox 中设置 privacy.reduceTimerPrecision = true 可降低此风险。' });
  }

  const fontSec = sections.find(s => s.id === 'fonts');
  if (fontSec && fontSec.risk !== 'low') {
    recs.push({ icon: '🔤', text: '字体枚举可以生成独特的指纹。使用隐私浏览器可限制字体枚举能力。Firefox 隐私模式会将字体列表统一化。' });
  }

  const browserSec = sections.find(s => s.id === 'browser');
  if (browserSec && browserSec.risk === 'high') {
    recs.push({ icon: '🌐', text: 'User-Agent 和插件信息非常具有辨识度。考虑使用隐私扩展来随机化或统一 User-Agent，如 UA 切换器。' });
  }

  const hardwareSec = sections.find(s => s.id === 'hardware');
  if (hardwareSec && hardwareSec.risk !== 'low') {
    recs.push({ icon: '⚙️', text: '硬件信息（CPU核心数、内存）是有效的指纹维度。privacy.resistFingerprinting = true 会统一这些值为常见配置。' });
  }

  const batterySec = sections.find(s => s.id === 'battery');
  if (batterySec && batterySec.risk !== 'low') {
    recs.push({ icon: '🔋', text: 'Battery API 可通过电量、充放电时间生成指纹。建议在 Firefox about:config 中设置 dom.battery.enabled = false 禁用该 API，或使用隐私扩展屏蔽。' });
  }

  const webrtcSec = sections.find(s => s.id === 'webrtc');
  if (webrtcSec && webrtcSec.risk === 'high') {
    recs.push({ icon: '🌐', text: 'WebRTC 泄露了你的本地 IP 地址，可绕过 VPN/代理暴露真实位置。建议安装 WebRTC 控制扩展（如 uBlock Origin 的 WebRTC 隐私保护），或在 Firefox about:config 中设置 media.peerconnection.enabled = false。' });
  } else if (webrtcSec) {
    recs.push({ icon: '🌐', text: 'WebRTC 未泄露 IP，当前配置较安全。如需进一步保护，可在 about:config 设置 media.peerconnection.ice.default_address_only = true。' });
  }

  recs.push({ icon: '🛡️', text: '使用 Tor Browser 是降低浏览器指纹最有效的方式，它将所有用户的指纹统一为相同特征。' });
  recs.push({ icon: '🔧', text: 'Firefox 隐私设置中可启用 privacy.resistFingerprinting，会统一时区、屏幕分辨率、硬件信息等特征。在 about:config 中搜索 resistFingerprinting。' });
  recs.push({ icon: '📱', text: '移动端浏览器的指纹通常比桌面端更统一，因为硬件配置差异较小。' });
  recs.push({ icon: '🔒', text: '安装本扩展的"反指纹保护"功能，可自动对 Canvas、WebGL、AudioContext 等指纹向量注入噪声或进行伪装。' });

  elements.fpRecList.innerHTML = recs.map(r =>
    '<div class="fp-rec-item"><span class="fp-rec-icon">' + r.icon + '</span><span>' + escHtml(r.text) + '</span></div>'
  ).join('');
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============ Toast ============
function showToast(msg, type) {
  type = type || 'info';
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(function() { elements.toast.classList.remove('toast--show'); }, 3000);
}

// ============ Save to History ============
async function saveToHistory(input, action) {
  try {
    await callBackground('saveToHistory', { toolId: 'fingerprint-detector', type: action, data: { hash: input, action: action } });
  } catch (e) {}
}

// ============ Copy ============
async function copyToClipboard(text) {
  if (!text) { showToast('没有可复制的内容', 'error'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制', 'success');
  } catch (e) { showToast('复制失败', 'error'); }
}

// ============ Init ============
document.addEventListener('DOMContentLoaded', () => {
  elements = {
    btnDetect: document.getElementById('btn-detect'),
    scoreSection: document.getElementById('score-section'),
    fpScore: document.getElementById('fp-score'),
    fpScoreBar: document.getElementById('fp-score-bar'),
    fpScoreDesc: document.getElementById('fp-score-desc'),
    fpHash: document.getElementById('fp-hash'),
    btnCopyHash: document.getElementById('btn-copy-hash'),
    fpSections: document.getElementById('fp-sections'),
    fpRecommendations: document.getElementById('fp-recommendations'),
    fpRecList: document.getElementById('fp-rec-list'),
    toast: document.getElementById('toast')
  };
  elements.btnDetect.addEventListener('click', runDetection);
  elements.btnCopyHash.addEventListener('click', () => copyToClipboard(elements.fpHash.textContent));
});

window.addEventListener('message', function(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data && event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
  if (event.data && event.data.action === 'setData' && typeof event.data.data === 'string') {
    // No specific setData handling for fingerprint detector
  }
});
