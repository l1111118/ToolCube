/**
 * 反浏览器指纹保护 - 内容脚本 (Firefox 版)
 * Firefox 不支持 world: 'MAIN'，通过自注入机制将脚本注入到 MAIN world
 * 当在 ISOLATED world 加载时，自动创建 <script> 标签注入到 MAIN world
 *
 * v3: 修复配置时序问题 —— 配置通过 DOM data 属性在 MAIN world 脚本执行前同步传递，
 *     保证用户开关/预设真正生效；patch 内按调用时检查开关，支持运行时动态切换。
 */
(function() {
  'use strict';

  // 防止重复注入（MAIN world）
  if (window.__toolboxAntiFingerprint) return;

  // Firefox MAIN world 自注入检测
  // 在 ISOLATED world 中 chrome.runtime.id 可用，MAIN world 中不可用
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    // 幂等守卫（ISOLATED world 独立作用域，与 MAIN world 的 __toolboxAntiFingerprint 互不可见）
    // 背景：启用该功能时 background 会「动态注册内容脚本」并「立即对已有标签页 executeScript」，
    // 两条路径叠加会让本脚本在 ISOLATED 侧执行两次。若无守卫，chrome.storage.onChanged
    // 会被注册两份，并且会重复向 MAIN world 注入 <script>。
    if (window.__toolboxAfIsolated) return;
    window.__toolboxAfIsolated = true;

    // 当前运行在 ISOLATED world，需要自注入到 MAIN world
    const DEFAULT_CONFIG = {
      enabled: true,
      level: 'stealth',
      protections: {
        canvas: true, webgl: true, audio: true, fonts: true,
        hardware: true, screen: true, timezone: true,
        navigator: true, webrtc: true
      },
      noiseLevel: 'medium',
      screenPreset: 'default',
      fontPreset: 'default'
    };

    // 噪声强度预设
    const NOISE_PRESETS = {
      low: { canvas: 0.01, webgl: 0.01, audio: 0.005 },
      medium: { canvas: 0.05, webgl: 0.03, audio: 0.02 },
      high: { canvas: 0.15, webgl: 0.10, audio: 0.05 }
    };

    function normalizeConfig(rawConfig) {
      const config = Object.assign({}, DEFAULT_CONFIG, rawConfig || {});
      if (config.protections) {
        config.protections = Object.assign({}, DEFAULT_CONFIG.protections, config.protections);
      }
      config.noisePreset = NOISE_PRESETS[config.noiseLevel] || NOISE_PRESETS.medium;
      return config;
    }

    // 将配置同步写入 DOM data 属性，MAIN world 脚本在执行前即可读取（修复时序问题）
    function sendConfigToMain(rawConfig) {
      const config = normalizeConfig(rawConfig);
      try {
        document.documentElement.dataset.__toolboxAFConfig = JSON.stringify(config);
      } catch (e) {}
    }

    // 初始加载配置：先同步写入 data 属性，再注入 MAIN world 脚本
    try {
      chrome.storage.local.get('toolbox_anti_fingerprint', (result) => {
        sendConfigToMain(result.toolbox_anti_fingerprint);
        // 注入 MAIN world 脚本（必须在 data 属性写入之后）
        const scriptUrl = chrome.runtime.getURL('content/anti-fingerprint.js');
        const s = document.createElement('script');
        s.src = scriptUrl;
        (document.documentElement || document.head).prepend(s);
        s.onload = () => s.remove();
      });
    } catch (e) {
      // storage 读取失败时也要注入（使用默认配置）
      try {
        const scriptUrl = chrome.runtime.getURL('content/anti-fingerprint.js');
        const s = document.createElement('script');
        s.src = scriptUrl;
        (document.documentElement || document.head).prepend(s);
        s.onload = () => s.remove();
      } catch (e2) {}
    }

    // 监听配置变化，实时同步到 MAIN world（patch 内按调用时检查开关，可动态生效）
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.toolbox_anti_fingerprint) {
          sendConfigToMain(changes.toolbox_anti_fingerprint.newValue);
          try {
            window.dispatchEvent(new CustomEvent('__toolbox_af_config', { detail: normalizeConfig(changes.toolbox_anti_fingerprint.newValue) }));
          } catch (e) {}
        }
      });
    } catch (e) {}

    // 定期把 MAIN world 记录的拦截次数上报后台。
    // MAIN world 拿不到 chrome.*，因此拦截计数先写回 DOM 属性，由这里转发。
    // 旧实现里工具页在等待一条**从未有人发送**的消息，计数永远停在 0。
    try {
      let reported = 0;
      setInterval(() => {
        let hits = 0;
        try {
          hits = Number(document.documentElement.dataset.__toolboxAFHits) || 0;
        } catch (e) { return; }
        const delta = hits - reported;
        if (delta <= 0) return;
        reported = hits;
        try {
          chrome.runtime.sendMessage({ action: 'antiFingerprint_reportHits', data: { hits: delta } });
        } catch (e) { /* 扩展上下文失效时忽略 */ }
      }, 5000);
    } catch (e) {}

    return; // 不在 ISOLATED world 执行保护代码
  }

  // ====== 以下代码运行在 MAIN world ======
  window.__toolboxAntiFingerprint = true;

  // 读取 ISOLATED world 同步写入的配置（在执行前已就绪）
  function readInitialConfig() {
    let raw = null;
    try {
      const data = document.documentElement.dataset.__toolboxAFConfig;
      if (data) raw = JSON.parse(data);
    } catch (e) {}
    return raw;
  }

  const INITIAL_RAW = readInitialConfig();

  // 默认配置（ISOLATED world 配置不可用时使用）
  let afConfig = Object.assign({
    enabled: true,
    level: 'stealth',
    protections: {
      canvas: true, webgl: true, audio: true, fonts: true,
      hardware: true, screen: true, timezone: true,
      navigator: true, webrtc: true
    },
    noiseLevel: 'medium',
    noisePreset: { canvas: 0.05, webgl: 0.03, audio: 0.02 },
    screenPreset: 'default',
    fontPreset: 'default'
  }, INITIAL_RAW || {});
  if (afConfig.protections) {
    afConfig.protections = Object.assign({
      canvas: true, webgl: true, audio: true, fonts: true,
      hardware: true, screen: true, timezone: true,
      navigator: true, webrtc: true
    }, afConfig.protections);
  }
  if (!afConfig.noisePreset) {
    const NOISE_PRESETS = {
      low: { canvas: 0.01, webgl: 0.01, audio: 0.005 },
      medium: { canvas: 0.05, webgl: 0.03, audio: 0.02 },
      high: { canvas: 0.15, webgl: 0.10, audio: 0.05 }
    };
    afConfig.noisePreset = NOISE_PRESETS[afConfig.noiseLevel] || NOISE_PRESETS.medium;
  }

  // 屏幕分辨率预设值
  const SCREEN_PRESETS = {
    '1920x1080': { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040 },
    '1366x768': { width: 1366, height: 768, availWidth: 1366, availHeight: 728 },
    '1440x900': { width: 1440, height: 900, availWidth: 1440, availHeight: 877 },
    '2560x1440': { width: 2560, height: 1440, availWidth: 2560, availHeight: 1400 },
    '3840x2160': { width: 3840, height: 2160, availWidth: 3840, availHeight: 2120 }
  };

  // 字体预设
  const FONT_PRESETS = {
    minimal: ['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'],
    windows: ['SimSun', 'Microsoft YaHei', 'Arial', 'Times New Roman', 'Calibri', 'Consolas', 'Segoe UI'],
    macos: ['Helvetica', 'San Francisco', 'Arial', 'Times New Roman', 'Menlo', 'Monaco'],
    linux: ['DejaVu Sans', 'Liberation Sans', 'Arial', 'Times New Roman', 'Ubuntu']
  };

  // 监听来自 ISOLATED world 的配置更新（动态切换）
  let screenPatched = false;
  let fontPatched = false;
  let fontsStyleEl = null;
  let timezonePatched = false;
  let hardwarePatched = false;
  let navigatorPatched = false;
  let webrtcPatched = false;

  function applyConfig(cfg) {
    if (!cfg) return;
    afConfig = Object.assign({}, afConfig, cfg);
    if (cfg.protections) {
      afConfig.protections = Object.assign({}, afConfig.protections, cfg.protections);
    }
    if (cfg.noiseLevel && !cfg.noisePreset) {
      const NOISE_PRESETS = {
        low: { canvas: 0.01, webgl: 0.01, audio: 0.005 },
        medium: { canvas: 0.05, webgl: 0.03, audio: 0.02 },
        high: { canvas: 0.15, webgl: 0.10, audio: 0.05 }
      };
      afConfig.noisePreset = NOISE_PRESETS[cfg.noiseLevel] || NOISE_PRESETS.medium;
    }
    // 屏幕预设可重新应用
    if (cfg.screenPreset !== undefined) applyScreenProtection();
    if (cfg.fontPreset !== undefined) applyFontProtection();
    // 强度变化时同步归一化环境特征（伪装 / 阻断需要）
    if (cfg.level !== undefined && isNormalized()) {
      applyHardwareProtection();
      applyNavigatorProtection();
      applyScreenProtection();
    }
    // 时区/硬件/navigator/webrtc 为一次性原型修改，关闭时不再撤销（避免破坏页面）
  }

  window.addEventListener('__toolbox_af_config', (e) => {
    if (e.detail) applyConfig(e.detail);
  });

  // 辅助：判断某项保护是否启用（调用时动态检查）
  function isProtected(name) {
    return afConfig.enabled && afConfig.protections && afConfig.protections[name] !== false;
  }

  // 辅助：获取噪声强度
  function getNoise(type) {
    const preset = afConfig.noisePreset || { canvas: 0.05, webgl: 0.03, audio: 0.02 };
    return preset[type] || 0.05;
  }

  // ====== 保护强度（level）语义 ======
  // 界面上提供三档强度，此前只被写入存储、从未被使用（是个摆设的单选组）。
  // 这里给出可实现的明确语义：
  //   stealth（隐形）：仅对输出加噪声，环境特征保持真实
  //   fake（伪装）   ：额外把环境特征归一化为常见值（屏幕/硬件/时区/navigator）
  //   block（阻断）  ：在伪装基础上，把指纹**读取**接口的返回值固定为恒定空值，
  //                   使所有站点拿到完全相同的结果，从而无法用于识别
  function levelMode() {
    const lv = afConfig.level;
    return lv === 'fake' || lv === 'block' ? lv : 'stealth';
  }
  /** 是否处于「阻断」强度 */
  function isBlocked() { return levelMode() === 'block'; }
  /** 是否需要对环境特征做归一化（伪装 / 阻断） */
  function isNormalized() { return levelMode() !== 'stealth'; }

  // ====== 拦截计数 ======
  // MAIN world 无法直接与后台通信，因此把计数写回 DOM 属性，
  // 由 ISOLATED world 定期读取并上报后台（见文件开头的 ISOLATED 分支）。
  let hitCount = 0;
  let hitFlushTimer = null;

  /** 记录一次指纹读取拦截；写入 DOM 属性的频率被限制在每秒一次，避免影响页面性能 */
  function countHit() {
    hitCount++;
    if (hitFlushTimer) return;
    hitFlushTimer = setTimeout(() => {
      hitFlushTimer = null;
      try {
        document.documentElement.dataset.__toolboxAFHits = String(hitCount);
      } catch (e) {}
    }, 1000);
  }

  /** 「阻断」强度下用于替代真实画布输出的恒定图片（1×1 透明，所有站点一致） */
  let blankCanvasUrl = null;
  /** 原始 toDataURL 引用；必须在打补丁前捕获，否则生成恒定图片时会递归调用自身 */
  let origCanvasToDataURL = null;

  /** 获取（并缓存）恒定空白画布的数据 URL */
  function getBlankCanvasUrl() {
    if (blankCanvasUrl === null) {
      if (!origCanvasToDataURL) return 'data:,';
      try {
        const c = document.createElement('canvas');
        c.width = 1;
        c.height = 1;
        blankCanvasUrl = origCanvasToDataURL.call(c);
      } catch (e) {
        blankCanvasUrl = 'data:,';
      }
    }
    return blankCanvasUrl;
  }

  // ====== Canvas 指纹防护（调用时动态检查开关） ======
  {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    origCanvasToDataURL = origToDataURL; // 供「阻断」强度生成恒定图片使用
    HTMLCanvasElement.prototype.toDataURL = function() {
      if (!isProtected('canvas') || this.width === 0 || this.height === 0) {
        return origToDataURL.apply(this, arguments);
      }
      // 阻断：所有站点拿到同一张空白图，指纹失去区分度
      if (isBlocked()) {
        countHit();
        return getBlankCanvasUrl();
      }
      try {
        const noiseAmount = getNoise('canvas');
        const ctx = this.getContext('2d');
        if (ctx) {
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = this.width;
          tmpCanvas.height = this.height;
          const tmpCtx = tmpCanvas.getContext('2d');
          tmpCtx.drawImage(this, 0, 0);
          const range = Math.max(16, Math.floor(this.width * noiseAmount * 10));
          const imgData = tmpCtx.getImageData(0, 0, Math.min(this.width, range), Math.min(this.height, range));
          for (let i = 0; i < imgData.data.length; i += 4) {
            imgData.data[i] ^= Math.floor(noiseAmount * 10) || 1;
          }
          tmpCtx.putImageData(imgData, 0, 0);
          countHit();
          return origToDataURL.apply(tmpCanvas, arguments);
        }
      } catch (e) {}
      return origToDataURL.apply(this, arguments);
    };

    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function() {
      if (!isProtected('canvas') || this.width === 0 || this.height === 0) {
        return origToBlob.apply(this, arguments);
      }
      // 阻断：改用恒定的 1×1 空白画布产出 Blob，保证所有站点结果一致
      if (isBlocked()) {
        countHit();
        const blank = document.createElement('canvas');
        blank.width = 1;
        blank.height = 1;
        return origToBlob.apply(blank, arguments);
      }
      try {
        const noiseAmount = getNoise('canvas');
        const ctx = this.getContext('2d');
        if (ctx) {
          const tmpCanvas = document.createElement('canvas');
          tmpCanvas.width = this.width;
          tmpCanvas.height = this.height;
          const tmpCtx = tmpCanvas.getContext('2d');
          tmpCtx.drawImage(this, 0, 0);
          const range = Math.max(16, Math.floor(this.width * noiseAmount * 10));
          const imgData = tmpCtx.getImageData(0, 0, Math.min(this.width, range), Math.min(this.height, range));
          for (let i = 0; i < imgData.data.length; i += 4) {
            imgData.data[i] ^= Math.floor(noiseAmount * 10) || 1;
          }
          tmpCtx.putImageData(imgData, 0, 0);
          countHit();
          return origToBlob.apply(tmpCanvas, arguments);
        }
      } catch (e) {}
      return origToBlob.apply(this, arguments);
    };

    // Canvas getImageData 防护
    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function() {
      if (isProtected('canvas')) {
        if (isBlocked()) {
          // 阻断：返回全零像素，任何站点读到的都是同一份数据
          const w = Math.floor(arguments[2] || 0);
          const h = Math.floor(arguments[3] || 0);
          if (w > 0 && h > 0) {
            try {
              countHit();
              return new ImageData(w, h);
            } catch (e) { /* 回退到原实现 */ }
          }
        } else {
          const result = origGetImageData.apply(this, arguments);
          const noiseAmount = getNoise('canvas');
          for (let i = 0; i < result.data.length; i += 4) {
            result.data[i] ^= Math.floor(noiseAmount * 10) || 1;
          }
          countHit();
          return result;
        }
      }
      return origGetImageData.apply(this, arguments);
    };
  }

  // ====== WebGL 指纹防护（调用时动态检查开关） ======
  {
    const webglRestricted = [0x1F00, 0x1F01, 0x1F02, 0x1F03, 0x9245, 0x9246];
    const webglFakeValues = {
      0x1F00: 'WebKit WebGL',
      0x1F01: 'WebKit',
      0x1F02: 'WebKit WebGL',
      0x1F03: 'WebKit WebGL Engine',
      0x9245: 'Angler',
      0x9246: 'ANGLE'
    };

    function patchGetParameter(proto) {
      const orig = proto.getParameter;
      proto.getParameter = function(param) {
        if (isProtected('webgl') && webglRestricted.includes(param)) {
          countHit();
          // 阻断强度下返回空串（所有站点一致，无法用于区分设备）
          return isBlocked() ? '' : (webglFakeValues[param] || '');
        }
        return orig.apply(this, arguments);
      };
    }
    try { patchGetParameter(WebGLRenderingContext.prototype); } catch(e) {}
    if (typeof WebGL2RenderingContext !== 'undefined') {
      try { patchGetParameter(WebGL2RenderingContext.prototype); } catch(e) {}
    }

    // WebGL getExtension 防护
    function patchGetExtension(proto) {
      const orig = proto.getExtension;
      proto.getExtension = function(name) {
        const ext = orig.apply(this, arguments);
        if (isProtected('webgl') && name === 'WEBGL_debug_renderer_info' && ext) {
          return new Proxy(ext, {
            get(target, prop) {
              if (prop === 'UNMASKED_VENDOR_WEBGL') return 0x1F02;
              if (prop === 'UNMASKED_RENDERER_WEBGL') return 0x1F03;
              return target[prop];
            }
          });
        }
        return ext;
      };
    }
    try { patchGetExtension(WebGLRenderingContext.prototype); } catch(e) {}
    if (typeof WebGL2RenderingContext !== 'undefined') {
      try { patchGetExtension(WebGL2RenderingContext.prototype); } catch(e) {}
    }
  }

  // ====== Audio 指纹防护（调用时动态检查开关） ======
  {
    if (typeof AudioContext !== 'undefined') {
      const origCreateOscillator = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function() {
        const osc = origCreateOscillator.apply(this, arguments);
        if (isProtected('audio')) {
          const audioNoise = getNoise('audio');
          const origConnect = osc.connect.bind(osc);
          osc.connect = function(dest) {
            try {
              const ctx = dest.context || this.context;
              const gain = ctx.createGain();
              gain.gain.value = 1.0 + (Math.random() * audioNoise - audioNoise / 2);
              origConnect(gain);
              gain.connect(dest);
              return dest;
            } catch (e) {
              return origConnect(dest);
            }
          };
        }
        return osc;
      };
    }

    if (typeof OfflineAudioContext !== 'undefined') {
      const origStart = OfflineAudioContext.prototype.startRendering;
      OfflineAudioContext.prototype.startRendering = function() {
        const ctx = this;
        if (isProtected('audio')) {
          try {
            const audioNoise = getNoise('audio');
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = audioNoise;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(0);
          } catch (e) {}
        }
        return origStart.apply(this, arguments);
      };
    }
  }

  // ====== 硬件信息防护（一次性） ======
  function applyHardwareProtection() {
    if (hardwarePatched) return;
    hardwarePatched = true;
    try {
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
        get: function() { return 4; },
        configurable: true
      });
    } catch (e) {}
    try {
      Object.defineProperty(Navigator.prototype, 'deviceMemory', {
        get: function() { return 8; },
        configurable: true
      });
    } catch (e) {}
  }

  // ====== 浏览器特征防护 (Navigator)（一次性） ======
  function applyNavigatorProtection() {
    if (navigatorPatched) return;
    navigatorPatched = true;
    try {
      Object.defineProperty(Navigator.prototype, 'platform', {
        get: function() { return 'Win32'; },
        configurable: true
      });
    } catch (e) {}

    // Battery API 防护
    if (navigator.getBattery) {
      navigator.getBattery = function() {
        return Promise.resolve({
          charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1,
          addEventListener: function() {}, removeEventListener: function() {},
          dispatchEvent: function() { return true; }
        });
      };
    }

    // 插件/MIME 类型防护
    try {
      Object.defineProperty(Navigator.prototype, 'plugins', {
        get: function() {
          return { length: 0, item: function() { return null; }, namedItem: function() { return null; }, refresh: function() {}, [Symbol.iterator]: function*() {} };
        },
        configurable: true
      });
    } catch (e) {}
    try {
      Object.defineProperty(Navigator.prototype, 'mimeTypes', {
        get: function() {
          return { length: 0, item: function() { return null; }, namedItem: function() { return null; }, [Symbol.iterator]: function*() {} };
        },
        configurable: true
      });
    } catch (e) {}

    // Connection API 防护
    if (navigator.connection) {
      try {
        Object.defineProperty(navigator.connection, 'rtt', { get: function() { return 50; }, configurable: true });
        Object.defineProperty(navigator.connection, 'downlink', { get: function() { return 10; }, configurable: true });
        Object.defineProperty(navigator.connection, 'effectiveType', { get: function() { return '4g'; }, configurable: true });
      } catch (e) {}
    }
  }

  // ====== 屏幕信息防护（可重复应用，配置变化时生效） ======
  function applyScreenProtection() {
    // 「伪装 / 阻断」强度下，即使用户没有显式选择分辨率预设，
    // 也归一化为最常见的 1920×1080，避免真实分辨率成为稳定指纹。
    let presetId = afConfig.screenPreset;
    if ((!presetId || presetId === 'default') && isNormalized()) presetId = '1920x1080';
    const preset = SCREEN_PRESETS[presetId];
    if (!isProtected('screen') || !preset) {
      // 预设为 default 且非伪装/阻断强度：无需（或不再）覆写
      return;
    }
    screenPatched = true;
    try {
      Object.defineProperty(Screen.prototype, 'width', { get: function() { return preset.width; }, configurable: true });
      Object.defineProperty(Screen.prototype, 'height', { get: function() { return preset.height; }, configurable: true });
      Object.defineProperty(Screen.prototype, 'availWidth', { get: function() { return preset.availWidth; }, configurable: true });
      Object.defineProperty(Screen.prototype, 'availHeight', { get: function() { return preset.availHeight; }, configurable: true });
      Object.defineProperty(Screen.prototype, 'colorDepth', { get: function() { return 24; }, configurable: true });
      Object.defineProperty(Screen.prototype, 'pixelDepth', { get: function() { return 24; }, configurable: true });
    } catch (e) {}
  }

  // ====== 时区信息防护（有实际效果的偏移，调用时动态检查） ======
  {
    const origGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = function() {
      const orig = origGetTimezoneOffset.apply(this, arguments);
      if (!isProtected('timezone')) return orig;
      // 基于当前时区做稳定偏移（+4 小时），干扰时区指纹且不破坏日期逻辑
      return orig - 240;
    };
  }

  // ====== WebRTC IP 泄露防护（调用时动态检查） ======
  function applyWebRTCProtection() {
    if (webrtcPatched) return;
    webrtcPatched = true;
    try {
      const origRTCPeerConnection = window.RTCPeerConnection;
      if (origRTCPeerConnection) {
        window.RTCPeerConnection = function() {
          const pc = new origRTCPeerConnection(...arguments);
          // 拦截 addEventListener，过滤 host 候选
          const origAddEventListener = pc.addEventListener;
          pc.addEventListener = function(type, listener) {
            if (type === 'icecandidate') {
              const wrappedListener = function(event) {
                if (event && event.candidate && event.candidate.candidate && /typ host/i.test(event.candidate.candidate)) {
                  return; // 不传递 host 候选
                }
                return listener.apply(this, arguments);
              };
              return origAddEventListener.call(this, type, wrappedListener);
            }
            return origAddEventListener.apply(this, arguments);
          };
          return pc;
        };
        window.RTCPeerConnection.prototype = origRTCPeerConnection.prototype;
        // 同时拦截 onicecandidate 属性赋值
        try {
          Object.defineProperty(window.RTCPeerConnection.prototype, 'onicecandidate', {
            configurable: true,
            get: function() { return this.__toolboxOnIceCandidate || null; },
            set: function(handler) {
              const pc = this;
              const wrapped = function(event) {
                if (event && event.candidate && event.candidate.candidate && /typ host/i.test(event.candidate.candidate)) {
                  return;
                }
                return handler.apply(pc, arguments);
              };
              pc.__toolboxOnIceCandidate = handler;
              // 通过原生 addEventListener 注册包装后的监听
              if (typeof pc.addEventListener === 'function') {
                try { pc.addEventListener('icecandidate', wrapped); } catch (e) {}
              }
            }
          });
        } catch (e) {}
      }
    } catch (e) {}
  }

  // ====== 字体枚举防护（可重复应用，配置变化时生效） ======
  function applyFontProtection() {
    const allowedFonts = FONT_PRESETS[afConfig.fontPreset];
    if (!isProtected('fonts') || !allowedFonts) return;
    fontPatched = true;
    try {
      if (fontsStyleEl && fontsStyleEl.parentNode) {
        fontsStyleEl.parentNode.removeChild(fontsStyleEl);
      }
      const style = document.createElement('style');
      style.textContent = allowedFonts.map(f => '@font-face { font-family: "' + f + '"; src: local("' + f + '"); }').join('\n');
      (document.head || document.documentElement).appendChild(style);
      fontsStyleEl = style;
    } catch (e) {}
    // SpeechSynthesis 指纹防护
    if (window.speechSynthesis) {
      const origGetVoices = window.speechSynthesis.getVoices;
      window.speechSynthesis.getVoices = function() {
        const voices = origGetVoices.apply(this, arguments);
        return voices.slice(0, Math.min(voices.length, 2));
      };
    }
  }

  // ====== 应用初始配置 ======
  function init() {
    if (isProtected('canvas')) { /* canvas patch 已常驻，调用时检查 */ }
    if (isProtected('webgl')) { /* webgl patch 已常驻，调用时检查 */ }
    if (isProtected('audio')) { /* audio patch 已常驻，调用时检查 */ }
    // 硬件/浏览器特征在「伪装 / 阻断」强度下也一并归一化（这两项本来就把真实值
    // 替换为常见值，因此无需区分强度）。屏幕与字体则始终按预设应用。
    if (isProtected('hardware') || isNormalized()) applyHardwareProtection();
    if (isProtected('navigator') || isNormalized()) applyNavigatorProtection();
    if (isProtected('screen')) applyScreenProtection();
    if (isProtected('fonts')) applyFontProtection();
    if (isProtected('webrtc')) applyWebRTCProtection();
    // timezone patch 已常驻，调用时检查
  }

  // 若 DOM 尚未就绪（document_start 注入），等 DOMContentLoaded 后再应用字体等依赖 DOM 的防护
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 标记已注入
  Object.defineProperty(window, '__toolbox_anti_fingerprint_active', {
    value: true, writable: false, configurable: false
  });
})();
