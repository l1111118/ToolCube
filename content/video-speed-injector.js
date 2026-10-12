/**
 * ToolCube - Video Speed Controller v5.0 (Firefox 版)
 * 全局视频倍速控制器 - 智能浏览器适配 + 反篡改保护
 * Firefox 不支持 world: 'MAIN'，通过自注入机制将脚本注入到 MAIN world
 * Chrome: 0.07x~16x | Firefox: 0.07x~8x | Edge: 0.07x~16x | Safari: 0.07x~2x
 * 特性: Shadow DOM(open+closed), iframe穿透, PiP, Web Components, 反篡改拦截
 * @version 5.0.0
 */
(function() {
  'use strict';

  // ==================== 共享常量 ====================
  // 这些常量必须在使用前声明：ISOLATED 分支会在 IIFE 末尾的 `return` 处提前退出，
  // 若把声明放在 MAIN world 段落里，ISOLATED 侧引用时会命中 const 的暂时性死区（TDZ）
  // 并抛出 ReferenceError，导致倍速持久化被静默吞掉、刷新后失效。
  const STORAGE_KEY = 'toolbox_video_speed_v5';           // 历史遗留 key（仅页面级 localStorage 使用）
  const STORAGE_TOOL_KEY = 'toolbox_video_speed';          // 全局倍速配置 { speed }
  const STORAGE_ENABLED_KEY = 'toolbox_video_speed_enabled'; // 全局启用标志
  // 持久化入参的合法区间（取各浏览器上限的最大值 16，由 MAIN world 按浏览器再收敛）
  const PERSIST_SPEED_MIN = 0.07;
  const PERSIST_SPEED_MAX = 16;

  // Firefox MAIN world 自注入检测
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    // 幂等守卫：同一帧内重复注入时避免重复注册监听器与重复插入 <script>
    if (window.__toolboxVideoSpeedIsolated) return;
    window.__toolboxVideoSpeedIsolated = true;

    // 当前运行在 ISOLATED world，需要自注入到 MAIN world
    // 在自注入前，先从 chrome.storage.local 读取配置，通过 DOM data 属性传递给 MAIN world
    try {
    chrome.storage.local.get(['toolbox_video_speed_v5', 'toolbox_video_speed_enabled', 'toolbox_video_speed', 'toolbox_master_enabled'], function(stored) {
      try {
        // 全局开关检查：若关闭则完全不注入，等同于扩展不存在
        if (stored.toolbox_master_enabled === false) return;
        const initData = {};
        // 优先从 toolbox_video_speed（工具 iframe 写入）读取，其次从旧 key 读取
        const speedSet = stored.toolbox_video_speed && stored.toolbox_video_speed.speed !== undefined;
        if (speedSet) {
          initData.speed = stored.toolbox_video_speed.speed;
        } else if (stored.toolbox_video_speed_v5 !== undefined) {
          initData.speed = stored.toolbox_video_speed_v5;
        }
        // enabled 状态：显式存储过则采用；未显式禁用且设置了非 1 倍速时视为启用（修复刷新后倍速不生效）
        if (stored.toolbox_video_speed_enabled !== undefined) {
          initData.enabled = stored.toolbox_video_speed_enabled !== false;
        } else if (speedSet && stored.toolbox_video_speed.speed !== 1) {
          initData.enabled = true;
        }
        if (Object.keys(initData).length > 0) {
          document.documentElement.dataset.__toolboxVideoSpeedConfig = JSON.stringify(initData);
        }
      } catch (e) {}
      const scriptUrl = chrome.runtime.getURL('content/video-speed-injector.js');
      const s = document.createElement('script');
      s.src = scriptUrl;
      (document.documentElement || document.head).prepend(s);
      s.onload = () => s.remove();
    });
    } catch (e) { return; }

    // 接收 MAIN world 的持久化请求（MAIN world 无 chrome API，无法直接写 storage）
    // 说明：MAIN world 与页面共享同一个 window，页面脚本也能发出同构消息，
    // 因此这里无法靠来源鉴别彻底防御。缓解手段是严格校验载荷：
    // 倍速必须为有限数值且落在合法区间（超出即丢弃），enabled 必须是布尔值。
    // 最坏情况也只是被页面改写视频播放速度，属于可逆、无权限提升的低危影响。
    window.addEventListener('message', function (e) {
      if (e.source !== window) return;
      if (!e.data || e.data.action !== '__vsPersist' || !e.data.data) return;
      try {
        const d = e.data.data;
        const speed = Number(d.speed);
        if (!Number.isFinite(speed) || speed < PERSIST_SPEED_MIN || speed > PERSIST_SPEED_MAX) return;
        if (typeof d.enabled !== 'boolean') return;
        chrome.storage.local.set({
          [STORAGE_TOOL_KEY]: { speed: speed },
          [STORAGE_ENABLED_KEY]: d.enabled
        });
      } catch (err) {}
    });

    // 跨标签页 / 跨站点同步：ISOLATED world 才能访问 chrome.storage，
    // 监听配置变化后转发给本页 MAIN world 实例，使倍速改动立即在所有已打开标签页生效。
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        const cfgChange = changes[STORAGE_TOOL_KEY];
        const enabledChange = changes[STORAGE_ENABLED_KEY];
        if (!cfgChange && !enabledChange) return;
        const payload = {};
        if (cfgChange && cfgChange.newValue && Number.isFinite(Number(cfgChange.newValue.speed))) {
          payload.speed = Number(cfgChange.newValue.speed);
        }
        if (enabledChange) payload.enabled = enabledChange.newValue !== false;
        if (Object.keys(payload).length === 0) return;
        window.postMessage({ action: '__vsApply', data: payload }, '*');
      });
    } catch (e) {}

    return;
  }

  // 以下代码运行在 MAIN world
  if (window.__toolboxVideoSpeedV5) return;
  window.__toolboxVideoSpeedV5 = true;

  // ==================== 浏览器检测 ====================
  const ua = navigator.userAgent;
  let browserName = 'chrome';
  let SPEED_MIN = 0.07;
  let SPEED_MAX = 16;
  const SPEED_STEP = 0.05;

  if (ua.indexOf('Firefox/') > -1) { browserName = 'firefox'; SPEED_MAX = 8; }
  else if (ua.indexOf('Edg/') > -1) { browserName = 'edge'; SPEED_MAX = 16; }
  else if (ua.indexOf('OPR/') > -1 || ua.indexOf('Opera/') > -1) { browserName = 'opera'; SPEED_MAX = 16; }
  else if (ua.indexOf('Chrome/') > -1) { browserName = 'chrome'; SPEED_MAX = 16; }
  else if (ua.indexOf('Safari/') > -1 && ua.indexOf('Chrome/') === -1) { browserName = 'safari'; SPEED_MAX = 2; }
  else if (ua.indexOf('QQBrowser/') > -1) { browserName = 'qq'; SPEED_MAX = 12; }
  else if (ua.indexOf('UCBrowser/') > -1) { browserName = 'uc'; SPEED_MAX = 8; }

  // ==================== 全局状态 ====================
  let panel = null;
  let badge = null;
  let currentSpeed = 1;
  let panelVisible = false;
  let extensionEnabled = false;
  // 音频变调补偿（默认开启，倍速时声音不变调）
  let preservesPitch = true;
  // CSS 滤镜参数（亮度/对比度/饱和度，1=原始）
  let filterBrightness = 1;
  let filterContrast = 1;
  let filterSaturation = 1;
  // 跳过片头/片尾秒数（0=不跳过）
  let skipIntroSec = 0;
  let skipOutroSec = 0;
  // STORAGE_KEY / STORAGE_TOOL_KEY / STORAGE_ENABLED_KEY 已在 IIFE 顶部统一定义（ISOLATED 与 MAIN 共用）
  const PRESET_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  if (SPEED_MAX >= 4) PRESET_SPEEDS.push(4);
  if (SPEED_MAX >= 8) PRESET_SPEEDS.push(8);
  if (SPEED_MAX >= 16) PRESET_SPEEDS.push(16);

  // 用于跟踪已应用速度的媒体元素（避免重复设置）
  const appliedElements = new WeakSet();
  // 跟踪所有探测到的媒体元素（用于ratechange事件）
  const trackedMedia = new WeakSet();

  // 全局标志（供 playbackRate 拦截器使用）
  window.__toolboxVideoSpeedEnabled = false;
  window.__toolboxVideoSpeedCurrent = 1;

  // ==================== playbackRate 反篡改拦截 ====================
  /**
   * 拦截 HTMLMediaElement.prototype.playbackRate 防止网站（B站、YouTube等）
   * 将倍速重置为 1.0x。这是 v5 的核心改进。
   */
  (function interceptPlaybackRate() {
    try {
      const proto = HTMLMediaElement.prototype;
      const origDesc = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
      if (!origDesc || !origDesc.set || !origDesc.get) return;

      Object.defineProperty(proto, 'playbackRate', {
        get() {
          return origDesc.get.call(this);
        },
        set(v) {
          // 如果倍速控制器已启用，任何试图将速度改为非期望值的操作都应被拦截
          if (window.__toolboxVideoSpeedEnabled) {
            const desired = window.__toolboxVideoSpeedCurrent;
            // 允许设置为我们期望的速度
            if (Math.abs(v - desired) < 0.01) {
              origDesc.set.call(this, v);
              return;
            }
            // 任何其他值（包括1x重置和中间值篡改）都被阻止
            origDesc.set.call(this, desired);
            return;
          }
          origDesc.set.call(this, v);
        },
        configurable: true,
        enumerable: true
      });
    } catch (e) {
      console.warn('[ToolCube] playbackRate intercept failed:', e);
    }
  })();

  // ==================== 时间加速（墙钟时间 Hook） ====================
  /**
   * 超星/学习通等平台使用 Date.now() / performance.now() 计算学习进度，
   * 而非 video.currentTime。单纯改 playbackRate 只能加速视频播放，
   * 但平台进度条基于真实时间，不会随倍速推进。
   *
   * 解决方案：Hook Date.now() 和 performance.now()，让它们返回加速后的时间。
   * 例如 2x 倍速时，1 秒真实时间 → 看起来过了 2 秒。
   *
   * 原理：
   *   - 记录一个基准时间 baseReal 和 baseFake
   *   - 每次调用返回 baseFake + (真实经过时间 * speedMultiplier)
   *   - 倍速变化时更新基准，保证时间连续不跳变
   *   - 仅在视频正在播放且倍速≠1时生效
   */
  let timeAccelEnabled = false;      // 是否启用时间加速
  let timeAccelRealBase = 0;         // 真实时间基准 (performance.now)
  let timeAccelFakeBase = 0;         // 伪时间基准 (performance.now)
  let timeAccelDateRealBase = 0;     // 真实时间基准 (Date.now)
  let timeAccelDateFakeBase = 0;     // 伪时间基准 (Date.now)
  let timeAccelSpeed = 1;            // 当前加速倍率
  let timeAccelVideoPlaying = false; // 视频是否正在播放

  // 全局开关（供外部控制）
  window.__toolboxTimeAccelEnabled = false;

  function timeAccelUpdate(speed) {
    const nowPerf = _origPerfNow();
    const nowDate = _origDateNow();
    // 先结算之前的加速时间
    if (timeAccelSpeed !== 1 && timeAccelVideoPlaying) {
      const elapsed = nowPerf - timeAccelRealBase;
      timeAccelFakeBase += elapsed * timeAccelSpeed;
      const elapsedDate = nowDate - timeAccelDateRealBase;
      timeAccelDateFakeBase += elapsedDate * timeAccelSpeed;
    } else {
      timeAccelFakeBase = nowPerf;
      timeAccelDateFakeBase = nowDate;
    }
    timeAccelRealBase = nowPerf;
    timeAccelDateRealBase = nowDate;
    timeAccelSpeed = speed;
  }

  function timeAccelSetPlaying(playing) {
    if (timeAccelVideoPlaying === playing) return;
    const nowPerf = _origPerfNow();
    const nowDate = _origDateNow();
    if (timeAccelVideoPlaying && timeAccelSpeed !== 1) {
      // 从播放切换到暂停，结算加速
      const elapsed = nowPerf - timeAccelRealBase;
      timeAccelFakeBase += elapsed * timeAccelSpeed;
      const elapsedDate = nowDate - timeAccelDateRealBase;
      timeAccelDateFakeBase += elapsedDate * timeAccelSpeed;
    } else {
      timeAccelFakeBase = nowPerf;
      timeAccelDateFakeBase = nowDate;
    }
    timeAccelRealBase = nowPerf;
    timeAccelDateRealBase = nowDate;
    timeAccelVideoPlaying = playing;
  }

  function getAcceleratedPerfTime() {
    const now = _origPerfNow();
    if (timeAccelEnabled && timeAccelSpeed !== 1 && timeAccelVideoPlaying) {
      return timeAccelFakeBase + (now - timeAccelRealBase) * timeAccelSpeed;
    }
    return now;
  }

  function getAcceleratedDateTime() {
    const now = _origDateNow();
    if (timeAccelEnabled && timeAccelSpeed !== 1 && timeAccelVideoPlaying) {
      return timeAccelDateFakeBase + (now - timeAccelDateRealBase) * timeAccelSpeed;
    }
    return now;
  }

  // 保存原始函数引用（在 Hook 之前）
  const _origDateNow = Date.now;
  const _origPerfNow = performance.now.bind(performance);

  // Hook Date.now()
  Date.now = function() {
    if (!timeAccelEnabled || timeAccelSpeed === 1 || !timeAccelVideoPlaying) {
      return _origDateNow();
    }
    return Math.round(getAcceleratedDateTime());
  };

  // Hook performance.now()
  try {
    Object.defineProperty(performance, 'now', {
      value: function() {
        if (!timeAccelEnabled || timeAccelSpeed === 1 || !timeAccelVideoPlaying) {
          return _origPerfNow();
        }
        return getAcceleratedPerfTime();
      },
      writable: true,
      configurable: true
    });
  } catch (e) {
    // 某些环境可能不允许 Hook performance.now
    try { performance.now = function() { return getAcceleratedPerfTime(); }; } catch(_) {}
  }

  // Hook new Date() — 超星等平台可能用 new Date() 获取当前时间
  const _OrigDate = Date;
  const _origDateConstructor = Date.bind(Date);
  try {
    // 创建一个新的 Date 构造函数，无参数时使用加速后的时间
    const AcceleratedDate = function(...args) {
      if (args.length === 0) {
        return new _origDateConstructor(Math.round(getAcceleratedDateTime()));
      }
      return new _origDateConstructor(...args);
    };
    // 复制 Date 的所有静态方法
    AcceleratedDate.now = Date.now;  // 已被 Hook
    AcceleratedDate.parse = Date.parse;
    AcceleratedDate.UTC = Date.UTC;
    AcceleratedDate.prototype = Date.prototype;
    // 替换全局 Date
    Date = AcceleratedDate;
    // 保持 Date.prototype.constructor 一致
    Date.prototype.constructor = AcceleratedDate;
  } catch (e) {
    // 如果替换 Date 构造函数失败，至少 Date.now() 已经被 Hook
  }

  // Hook setTimeout / setInterval 让回调也按加速时间触发
  const _origSetTimeout = window.setTimeout;
  const _origSetInterval = window.setInterval;

  window.setTimeout = function(fn, delay, ...args) {
    if (timeAccelEnabled && timeAccelSpeed !== 1 && timeAccelVideoPlaying && delay > 0) {
      delay = Math.max(1, Math.round(delay / timeAccelSpeed));
    }
    return _origSetTimeout.call(window, fn, delay, ...args);
  };

  window.setInterval = function(fn, delay, ...args) {
    if (timeAccelEnabled && timeAccelSpeed !== 1 && timeAccelVideoPlaying && delay > 0) {
      delay = Math.max(1, Math.round(delay / timeAccelSpeed));
    }
    return _origSetInterval.call(window, fn, delay, ...args);
  };

  // ==================== 媒体元素发现（增强） ====================

  /**
   * 拦截 attachShadow 以便追踪 closed shadow root
   * 注意：closed shadow root 内的元素无法直接访问，但我们可以记录创建事件
   */
  (function interceptAttachShadow() {
    try {
      const orig = Element.prototype.attachShadow;
      if (orig.__toolboxPatched) return;
      Element.prototype.attachShadow = function(init) {
        const root = orig.call(this, init);
        // 标记为 toolboxed；open root 会被常规 find 探测到，closed 仅做记录
        try { Object.defineProperty(root, '__toolboxShadow', { value: true, configurable: true }); } catch (_) {}
        // 对 closed root 额外保存引用，便于本文件作用域使用
        try {
          if (init && init.mode === 'closed') {
            Object.defineProperty(this, '__toolboxShadowRoot', { value: root, configurable: true });
          }
        } catch (_) {}
        return root;
      };
      Object.defineProperty(Element.prototype.attachShadow, '__toolboxPatched', { value: true });
    } catch (e) {}
  })();

  /**
   * 递归查找所有 video/audio 元素，包括 Shadow DOM(open+closed) 和 iframe
   */
  function findAllMediaElements(root) {
    const media = [];
    if (!root) return media;

    // 当前文档中的媒体元素
    if (root.querySelectorAll) {
      try {
        root.querySelectorAll('video, audio').forEach(el => media.push(el));
      } catch (e) {}
    }

    // 递归进入所有 Shadow Root（open 和 closed）
    if (root.querySelectorAll) {
      try {
        root.querySelectorAll('*').forEach(el => {
          if (el.shadowRoot) {
            media.push(...findAllMediaElements(el.shadowRoot));
          }
          // 通过 attachShadow 拦截附加引用的 closed root
          if (el.__toolboxShadowRoot) {
            try {
              media.push(...findAllMediaElements(el.__toolboxShadowRoot));
            } catch (e) {}
          }
        });
      } catch (e) {}
    }

    // 处理 iframe（同源可访问，跨域 best-effort）
    if (root.querySelectorAll) {
      try {
        root.querySelectorAll('iframe').forEach(iframe => {
          try {
            const iframeDoc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
            if (iframeDoc) {
              media.push(...findAllMediaElements(iframeDoc));
            } else if (iframe.contentWindow) {
              // 跨域 iframe：尝试 postMessage 通知注入脚本
              try {
                iframe.contentWindow.postMessage({ action: 'toolboxProbeMedia' }, '*');
              } catch (e) {}
            }
          } catch (e) {}
        });
      } catch (e) {}
    }

    return media;
  }

  /**
   * 对所有媒体元素设置播放速度
   */
  function setAllMediaSpeed(speed) {
    const mediaElements = findAllMediaElements(document);

    // 补充 document.body 中的媒体
    if (document.body) {
      try {
        document.body.querySelectorAll('video, audio').forEach(el => {
          if (!mediaElements.includes(el)) mediaElements.push(el);
        });
      } catch (e) {}
    }

    // 补充 Picture-in-Picture 视频
    try {
      if (document.pictureInPictureElement) {
        if (!mediaElements.includes(document.pictureInPictureElement)) {
          mediaElements.push(document.pictureInPictureElement);
        }
      }
    } catch (e) {}

    // 去重
    const uniqueMedia = [...new Set(mediaElements)];
    let foundCount = 0;

    uniqueMedia.forEach(el => {
      try {
        if (Math.abs(el.playbackRate - speed) > 0.001) {
          el.playbackRate = speed;
          foundCount++;
        }
        // 应用音频变调补偿（preservesPitch）
        try {
          // 标准 API
          if ('preservesPitch' in el) el.preservesPitch = preservesPitch;
          // 兼容前缀
          if ('mozPreservesPitch' in el) el.mozPreservesPitch = preservesPitch;
          if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = preservesPitch;
        } catch (e) {}
        // 应用 CSS 滤镜（亮度/对比度/饱和度）
        applyVideoFilter(el);
        appliedElements.add(el);
        if (!trackedMedia.has(el)) {
          trackedMedia.add(el);
          attachMediaListeners(el);
        }
      } catch (e) {}
    });

    return { count: foundCount, total: uniqueMedia.length };
  }

  /**
   * 为媒体元素绑定事件：play / loadedmetadata / ratechange / pause
   * ratechange 是反篡改的关键——网站改回 1.0x 时立即恢复
   * play/pause 同步时间加速状态
   */
  function attachMediaListeners(el) {
    try {
      el.addEventListener('play', () => {
        if (currentSpeed !== 1 && extensionEnabled) {
          requestAnimationFrame(() => {
            try { el.playbackRate = currentSpeed; } catch (e) {}
          });
        }
        // 同步时间加速：视频开始播放
        if (timeAccelEnabled && currentSpeed !== 1) {
          timeAccelSetPlaying(true);
        }
      });

      el.addEventListener('pause', () => {
        // 同步时间加速：视频暂停
        if (timeAccelEnabled) {
          timeAccelSetPlaying(false);
        }
      });

      el.addEventListener('ended', () => {
        // 同步时间加速：视频结束
        if (timeAccelEnabled) {
          timeAccelSetPlaying(false);
        }
      });

      el.addEventListener('loadedmetadata', () => {
        if (currentSpeed !== 1 && extensionEnabled) {
          requestAnimationFrame(() => {
            try { el.playbackRate = currentSpeed; } catch (e) {}
          });
        }
      });

      el.addEventListener('ratechange', () => {
        if (!extensionEnabled) return;
        const desired = currentSpeed;
        // 网站将 speed 改回 1.0x 而我们想要非 1.0x → 下一帧恢复
        if (Math.abs(desired - 1) > 0.01 && Math.abs(el.playbackRate - desired) > 0.01) {
          requestAnimationFrame(() => {
            try {
              el.playbackRate = desired;
            } catch (e) {}
          });
        }
      });

      // 跳过片头/片尾：在 timeupdate 中检测
      el.addEventListener('timeupdate', () => {
        if (skipIntroSec <= 0 && skipOutroSec <= 0) return;
        try {
          const cur = el.currentTime;
          const dur = el.duration;
          // 跳过片头
          if (skipIntroSec > 0 && cur > 0 && cur < skipIntroSec) {
            el.currentTime = skipIntroSec;
            flashInfo('已跳过片头 ' + skipIntroSec + 's');
          }
          // 跳过片尾
          if (skipOutroSec > 0 && dur > 0 && isFinite(dur) && (dur - cur) <= skipOutroSec && (dur - cur) > 0.1) {
            el.currentTime = dur - 0.1;
            flashInfo('已跳过片尾 ' + skipOutroSec + 's');
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  /**
   * 应用 CSS 滤镜到视频元素（亮度/对比度/饱和度）
   */
  function applyVideoFilter(el) {
    try {
      // 仅在非默认值时应用滤镜，避免影响正常显示
      if (filterBrightness === 1 && filterContrast === 1 && filterSaturation === 1) {
        el.style.filter = '';
        return;
      }
      const parts = [];
      if (filterBrightness !== 1) parts.push('brightness(' + filterBrightness + ')');
      if (filterContrast !== 1) parts.push('contrast(' + filterContrast + ')');
      if (filterSaturation !== 1) parts.push('saturate(' + filterSaturation + ')');
      el.style.filter = parts.join(' ');
    } catch (e) {}
  }

  /**
   * 将当前滤镜应用到所有视频元素
   */
  function applyFilterToAll() {
    const media = findAllMediaElements(document);
    media.forEach(el => applyVideoFilter(el));
  }

  /**
   * 请求视频进入画中画模式
   */
  function requestPiP() {
    try {
      const media = findAllMediaElements(document);
      const video = media.find(el => el.tagName === 'VIDEO' && !el.paused) || media.find(el => el.tagName === 'VIDEO');
      if (!video) {
        flashInfo('未找到可用的视频元素');
        return;
      }
      if (!document.pictureInPictureEnabled) {
        flashInfo('当前浏览器不支持画中画');
        return;
      }
      if (document.pictureInPictureElement) {
        // 已在 PiP 中，退出
        document.exitPictureInPicture().catch(() => {});
        flashInfo('已退出画中画');
      } else {
        // 移除禁用属性
        try { video.removeAttribute('disablepictureinpicture'); } catch (e) {}
        try { video.disablePictureInPicture = false; } catch (e) {}
        video.requestPictureInPicture().then(() => {
          flashInfo('已进入画中画');
        }).catch(err => {
          flashInfo('画中画失败: ' + (err && err.message ? err.message : '未知错误'));
        });
      }
    } catch (e) {
      flashInfo('画中画请求异常');
    }
  }

  // ==================== 存储 ====================

  // Firefox: 从 DOM data 属性读取 ISOLATED world 传递的初始配置
  let __initConfigFromStorage = null;
  try {
    const configStr = document.documentElement.dataset.__toolboxVideoSpeedConfig;
    if (configStr) {
      __initConfigFromStorage = JSON.parse(configStr);
      delete document.documentElement.dataset.__toolboxVideoSpeedConfig;
    }
  } catch (e) {}

  function saveSpeed(speed) {
    try { localStorage.setItem(STORAGE_KEY, String(speed)); } catch (e) {}
    // MAIN world 无 chrome API，通过 postMessage 桥接到 ISOLATED world 写入全局 storage，
    // 使倍速设置跨页面/跨站点生效（此前仅 localStorage，页面级）
    try {
      window.postMessage({
        action: '__vsPersist',
        data: { speed: speed, enabled: extensionEnabled }
      }, '*');
    } catch (e) {}
  }

  function loadSpeed() {
    // Firefox: 优先使用 ISOLATED world 通过 DOM data 属性传递的配置
    if (__initConfigFromStorage) {
      if (__initConfigFromStorage.speed !== undefined && __initConfigFromStorage.speed >= SPEED_MIN && __initConfigFromStorage.speed <= SPEED_MAX) {
        currentSpeed = __initConfigFromStorage.speed;
        window.__toolboxVideoSpeedCurrent = currentSpeed;
      }
      if (__initConfigFromStorage.enabled !== undefined) {
        extensionEnabled = __initConfigFromStorage.enabled !== false;
        window.__toolboxVideoSpeedEnabled = extensionEnabled;
      }
      __initConfigFromStorage = null;
      return;
    }

    let saved = null;
    try {
      const v = parseFloat(localStorage.getItem(STORAGE_KEY));
      if (v && v > 0 && v >= SPEED_MIN && v <= SPEED_MAX) saved = v;
    } catch (e) {}
    if (saved == null) {
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get([STORAGE_KEY, STORAGE_ENABLED_KEY, STORAGE_TOOL_KEY], (res) => {
            // 优先从 toolbox_video_speed（工具 iframe 写入）读取
            if (res && res[STORAGE_TOOL_KEY] && res[STORAGE_TOOL_KEY].speed !== undefined &&
                res[STORAGE_TOOL_KEY].speed >= SPEED_MIN && res[STORAGE_TOOL_KEY].speed <= SPEED_MAX) {
              currentSpeed = res[STORAGE_TOOL_KEY].speed;
              window.__toolboxVideoSpeedCurrent = currentSpeed;
            } else if (res && res[STORAGE_KEY] && res[STORAGE_KEY] > 0 &&
                res[STORAGE_KEY] >= SPEED_MIN && res[STORAGE_KEY] <= SPEED_MAX) {
              currentSpeed = res[STORAGE_KEY];
              window.__toolboxVideoSpeedCurrent = currentSpeed;
            }
            // 正确恢复 enabled 状态
            if (res && res[STORAGE_ENABLED_KEY] !== undefined) {
              extensionEnabled = res[STORAGE_ENABLED_KEY] !== false;
              window.__toolboxVideoSpeedEnabled = extensionEnabled;
              if (extensionEnabled && currentSpeed !== 1) {
                setAllMediaSpeed(currentSpeed);
              }
            }
          });
        }
      } catch (e) {}
    }
    if (saved != null) {
      currentSpeed = saved;
      window.__toolboxVideoSpeedCurrent = currentSpeed;
    }
  }

  // ==================== UI 面板 ====================

  function createPanel() {
    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'toolbox-vs-panel';
    panel.innerHTML = `
      <style>
        #toolbox-vs-panel {
          position: fixed;
          top: 50%;
          right: 12px;
          transform: translateY(-50%);
          z-index: 2147483640;
          background: rgba(22, 22, 28, 0.94);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          padding: 12px 10px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.6);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          opacity: 0;
          visibility: hidden;
          transition: opacity 0.25s ease, visibility 0.25s ease, transform 0.25s ease;
          user-select: none;
          -webkit-user-select: none;
          min-width: 100px;
        }
        #toolbox-vs-panel.show {
          opacity: 1;
          visibility: visible;
        }
        #toolbox-vs-panel .vs-header {
          color: rgba(255,255,255,0.5);
          font-size: 9px;
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 1px;
          padding-bottom: 4px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 5px;
        }
        #toolbox-vs-panel .vs-badge {
          background: rgba(255,180,0,0.12);
          color: rgba(255,200,80,0.85);
          font-size: 8px;
          padding: 1px 5px;
          border-radius: 4px;
          letter-spacing: 0.5px;
          font-weight: 500;
        }
        #toolbox-vs-panel .vs-power {
          cursor: pointer;
          user-select: none;
          -webkit-user-select: none;
          color: rgba(120,200,120,0.7);
          font-size: 10px;
          margin-left: auto;
        }
        #toolbox-vs-panel .vs-power.off {
          color: rgba(255,120,120,0.7);
        }
        #toolbox-vs-panel .vs-display {
          color: #fff;
          font-size: 17px;
          font-weight: 700;
          text-align: center;
          padding: 2px 0;
          min-width: 48px;
          font-variant-numeric: tabular-nums;
          letter-spacing: -0.5px;
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 2px;
        }
        #toolbox-vs-panel .vs-display .unit {
          color: rgba(255,255,255,0.4);
          font-size: 12px;
          font-weight: 400;
        }
        #toolbox-vs-panel .vs-display .count {
          margin-left: 6px;
          color: rgba(255,255,255,0.35);
          font-size: 10px;
          font-weight: 500;
        }
        #toolbox-vs-panel .vs-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          max-width: 130px;
          justify-content: center;
        }
        #toolbox-vs-panel .vs-btn {
          width: 36px;
          height: 28px;
          border: none;
          border-radius: 6px;
          background: rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.8);
          cursor: pointer;
          font-size: 11px;
          font-weight: 600;
          transition: all 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }
        #toolbox-vs-panel .vs-btn:hover {
          background: rgba(255,255,255,0.2);
          color: #fff;
          transform: scale(1.05);
        }
        #toolbox-vs-panel .vs-btn.active {
          background: #5b7fff;
          color: #fff;
          box-shadow: 0 2px 8px rgba(74,144,217,0.4);
        }
        #toolbox-vs-panel .vs-btn.extreme {
          background: rgba(255,152,0,0.15);
          color: rgba(255,255,255,0.6);
          font-size: 10px;
        }
        #toolbox-vs-panel .vs-btn.extreme:hover {
          background: rgba(255,152,0,0.3);
          color: #fff;
        }
        #toolbox-vs-panel .vs-slider-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        #toolbox-vs-panel .vs-slider {
          width: 86px;
          height: 6px;
          -webkit-appearance: none;
          appearance: none;
          background: rgba(255,255,255,0.12);
          border-radius: 3px;
          cursor: pointer;
          outline: none;
        }
        #toolbox-vs-panel .vs-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #5b7fff;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          transition: transform 0.15s;
        }
        #toolbox-vs-panel .vs-slider::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }
        #toolbox-vs-panel .vs-slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #5b7fff;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }
        #toolbox-vs-panel .vs-slider::-moz-range-track {
          background: rgba(255,255,255,0.12);
          height: 6px;
          border-radius: 3px;
        }
        #toolbox-vs-panel .vs-actions {
          display: flex;
          gap: 4px;
          justify-content: center;
          margin-top: 2px;
        }
        #toolbox-vs-panel .vs-action {
          width: 26px;
          height: 26px;
          border: none;
          border-radius: 6px;
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.5);
          cursor: pointer;
          font-size: 12px;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        #toolbox-vs-panel .vs-action:hover {
          background: rgba(255,255,255,0.15);
          color: #fff;
        }
        #toolbox-vs-panel .vs-applyall {
          margin-top: 2px;
          padding: 5px 8px;
          border: none;
          border-radius: 6px;
          background: rgba(74,144,217,0.2);
          color: rgba(255,255,255,0.85);
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 0.3px;
          transition: all 0.15s;
          display: none;
        }
        #toolbox-vs-panel .vs-applyall.show {
          display: block;
        }
        #toolbox-vs-panel .vs-applyall:hover {
          background: rgba(74,144,217,0.4);
          color: #fff;
        }
        #toolbox-vs-panel .vs-info {
          color: rgba(255,255,255,0.3);
          font-size: 9px;
          text-align: center;
          padding-top: 4px;
          border-top: 1px solid rgba(255,255,255,0.06);
          line-height: 1.4;
        }
        #toolbox-vs-panel .vs-filter-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 6px 4px;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        #toolbox-vs-panel .vs-filter-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        #toolbox-vs-panel .vs-filter-label {
          color: rgba(255,255,255,0.5);
          font-size: 9px;
          min-width: 36px;
        }
        #toolbox-vs-panel .vs-filter-val {
          color: rgba(255,255,255,0.7);
          font-size: 9px;
          min-width: 28px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        #toolbox-vs-panel .vs-filter-slider {
          flex: 1;
          height: 4px;
          -webkit-appearance: none;
          appearance: none;
          background: rgba(255,255,255,0.12);
          border-radius: 2px;
          cursor: pointer;
          outline: none;
        }
        #toolbox-vs-panel .vs-filter-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #5b7fff;
          cursor: pointer;
        }
        #toolbox-vs-panel .vs-filter-slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #5b7fff;
          cursor: pointer;
          border: none;
        }
        #toolbox-vs-panel .vs-skip-group {
          display: flex;
          gap: 4px;
          padding: 6px 4px;
          border-top: 1px solid rgba(255,255,255,0.06);
        }
        #toolbox-vs-panel .vs-skip-input {
          flex: 1;
          min-width: 0;
          padding: 3px 4px;
          font-size: 9px;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 4px;
          background: rgba(255,255,255,0.06);
          color: rgba(255,255,255,0.8);
          text-align: center;
          outline: none;
        }
        #toolbox-vs-panel .vs-skip-input:focus {
          border-color: #5b7fff;
        }
        #toolbox-vs-panel .vs-skip-input::placeholder {
          color: rgba(255,255,255,0.3);
        }
        #toolbox-vs-panel .vs-pip-btn {
          padding: 5px 8px;
          border: none;
          border-radius: 6px;
          background: rgba(33,150,243,0.2);
          color: rgba(255,255,255,0.85);
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          letter-spacing: 0.3px;
          transition: all 0.15s;
        }
        #toolbox-vs-panel .vs-pip-btn:hover {
          background: rgba(33,150,243,0.4);
          color: #fff;
        }
      </style>

      <div class="vs-header">
        <span>VIDEO SPEED</span>
        <span class="vs-badge">学习研究</span>
        <span class="vs-power" id="vs-power" title="启用/禁用">●</span>
      </div>
      <div class="vs-display" id="vs-speed-display">
        <span id="vs-speed-val">1.0</span><span class="unit">x</span>
        <span class="count" id="vs-count">·0</span>
      </div>
      <div class="vs-presets" id="vs-presets">
        ${PRESET_SPEEDS.map(s => {
          const isExtreme = s <= 0.5 || s >= 4;
          return `<button class="vs-btn${isExtreme ? ' extreme' : ''}" data-speed="${s}">${s}x</button>`;
        }).join('')}
      </div>
      <input type="range" class="vs-slider" id="vs-range"
        min="${SPEED_MIN}" max="${SPEED_MAX}" step="${SPEED_STEP}" value="1">
      <div class="vs-actions">
        <button class="vs-action" id="vs-slower" title="减速 (Alt+-)">−</button>
        <button class="vs-action" id="vs-faster" title="加速 (Alt+=)">+</button>
        <button class="vs-action" id="vs-reset" title="重置 (Alt+0)">1×</button>
        <button class="vs-action" id="vs-pip-toggle" title="画中画">🖼</button>
        <button class="vs-action" id="vs-close" title="关闭">✕</button>
      </div>
      <button class="vs-applyall" id="vs-applyall">应用到所有视频</button>
      <button class="vs-applyall" id="vs-time-accel" style="background:rgba(255,152,0,0.2);color:rgba(255,255,255,0.85)">⏱ 时间加速: 关</button>
      <button class="vs-pip-btn" id="vs-pip-btn">🖼 画中画模式</button>
      <div class="vs-filter-group">
        <div class="vs-filter-row">
          <span class="vs-filter-label">亮度</span>
          <input type="range" class="vs-filter-slider" id="vs-brightness" min="0.2" max="2" step="0.05" value="1">
          <span class="vs-filter-val" id="vs-brightness-val">1.00</span>
        </div>
        <div class="vs-filter-row">
          <span class="vs-filter-label">对比度</span>
          <input type="range" class="vs-filter-slider" id="vs-contrast" min="0.2" max="2" step="0.05" value="1">
          <span class="vs-filter-val" id="vs-contrast-val">1.00</span>
        </div>
        <div class="vs-filter-row">
          <span class="vs-filter-label">饱和度</span>
          <input type="range" class="vs-filter-slider" id="vs-saturation" min="0" max="2" step="0.05" value="1">
          <span class="vs-filter-val" id="vs-saturation-val">1.00</span>
        </div>
      </div>
      <div class="vs-skip-group">
        <input type="number" class="vs-skip-input" id="vs-skip-intro" placeholder="跳片头s" min="0" max="600" step="1" value="0" title="跳过片头秒数">
        <input type="number" class="vs-skip-input" id="vs-skip-outro" placeholder="跳片尾s" min="0" max="600" step="1" value="0" title="跳过片尾秒数">
      </div>
      <div class="vs-info" id="vs-video-info">${browserName} · 0.07x~${SPEED_MAX}x · Alt+V</div>
    `;

    document.body.appendChild(panel);

    // 预设速度按钮
    panel.querySelectorAll('.vs-btn[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => setSpeed(parseFloat(btn.dataset.speed)));
    });

    // 滑块
    const range = panel.querySelector('#vs-range');
    range.addEventListener('input', () => setSpeed(parseFloat(range.value)));

    // 操作按钮
    panel.querySelector('#vs-slower').addEventListener('click', () => {
      setSpeed(Math.max(SPEED_MIN, +(currentSpeed - 0.25).toFixed(2)));
    });
    panel.querySelector('#vs-faster').addEventListener('click', () => {
      setSpeed(Math.min(SPEED_MAX, +(currentSpeed + 0.25).toFixed(2)));
    });
    panel.querySelector('#vs-reset').addEventListener('click', () => setSpeed(1));
    panel.querySelector('#vs-close').addEventListener('click', hide);

    // 应用到所有视频
    panel.querySelector('#vs-applyall').addEventListener('click', () => {
      const r = setAllMediaSpeed(currentSpeed);
      flashInfo(`已应用 ${r.total} 个媒体`);
    });

    // 时间加速开关（超星/学习通等平台进度条加速）
    panel.querySelector('#vs-time-accel').addEventListener('click', () => {
      timeAccelEnabled = !timeAccelEnabled;
      window.__toolboxTimeAccelEnabled = timeAccelEnabled;
      const btn = panel.querySelector('#vs-time-accel');
      if (timeAccelEnabled) {
        btn.textContent = '⏱ 时间加速: 开';
        btn.style.background = 'rgba(76,175,80,0.3)';
        // 初始化时间基准
        timeAccelRealBase = _origPerfNow();
        timeAccelFakeBase = _origPerfNow();
        timeAccelDateRealBase = _origDateNow();
        timeAccelDateFakeBase = _origDateNow();
        timeAccelSpeed = currentSpeed;
        // 检测视频是否正在播放
        const media = findAllMediaElements(document);
        timeAccelVideoPlaying = media.some(el => !el.paused);
        flashInfo('时间加速已启用 (进度条将跟随倍速)');
      } else {
        btn.textContent = '⏱ 时间加速: 关';
        btn.style.background = 'rgba(255,152,0,0.2)';
        timeAccelSpeed = 1;
        timeAccelVideoPlaying = false;
        flashInfo('时间加速已关闭');
      }
    });

    // 画中画按钮（操作栏小图标 + 独立按钮）
    const pipBtnHandler = () => requestPiP();
    const pipToggleBtn = panel.querySelector('#vs-pip-toggle');
    if (pipToggleBtn) pipToggleBtn.addEventListener('click', pipBtnHandler);
    const pipBtn = panel.querySelector('#vs-pip-btn');
    if (pipBtn) pipBtn.addEventListener('click', pipBtnHandler);

    // CSS 滤镜：亮度/对比度/饱和度
    const brightnessSlider = panel.querySelector('#vs-brightness');
    const brightnessVal = panel.querySelector('#vs-brightness-val');
    if (brightnessSlider) {
      brightnessSlider.addEventListener('input', () => {
        filterBrightness = parseFloat(brightnessSlider.value);
        if (brightnessVal) brightnessVal.textContent = filterBrightness.toFixed(2);
        applyFilterToAll();
      });
    }
    const contrastSlider = panel.querySelector('#vs-contrast');
    const contrastVal = panel.querySelector('#vs-contrast-val');
    if (contrastSlider) {
      contrastSlider.addEventListener('input', () => {
        filterContrast = parseFloat(contrastSlider.value);
        if (contrastVal) contrastVal.textContent = filterContrast.toFixed(2);
        applyFilterToAll();
      });
    }
    const saturationSlider = panel.querySelector('#vs-saturation');
    const saturationVal = panel.querySelector('#vs-saturation-val');
    if (saturationSlider) {
      saturationSlider.addEventListener('input', () => {
        filterSaturation = parseFloat(saturationSlider.value);
        if (saturationVal) saturationVal.textContent = filterSaturation.toFixed(2);
        applyFilterToAll();
      });
    }

    // 跳过片头/片尾
    const skipIntroInput = panel.querySelector('#vs-skip-intro');
    const skipOutroInput = panel.querySelector('#vs-skip-outro');
    if (skipIntroInput) {
      skipIntroInput.addEventListener('change', () => {
        const v = parseInt(skipIntroInput.value, 10);
        skipIntroSec = (isNaN(v) || v < 0) ? 0 : Math.min(600, v);
        skipIntroInput.value = skipIntroSec;
        if (skipIntroSec > 0) flashInfo('片头跳过: ' + skipIntroSec + 's');
      });
    }
    if (skipOutroInput) {
      skipOutroInput.addEventListener('change', () => {
        const v = parseInt(skipOutroInput.value, 10);
        skipOutroSec = (isNaN(v) || v < 0) ? 0 : Math.min(600, v);
        skipOutroInput.value = skipOutroSec;
        if (skipOutroSec > 0) flashInfo('片尾跳过: ' + skipOutroSec + 's');
      });
    }

    // 启用/禁用开关
    panel.querySelector('#vs-power').addEventListener('click', () => {
      extensionEnabled = !extensionEnabled;
      window.__toolboxVideoSpeedEnabled = extensionEnabled;
      const dot = panel.querySelector('#vs-power');
      dot.classList.toggle('off', !extensionEnabled);
      flashInfo(extensionEnabled ? '已启用' : '已禁用');
      if (extensionEnabled && currentSpeed !== 1) {
        setAllMediaSpeed(currentSpeed);
      }
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [STORAGE_ENABLED_KEY]: extensionEnabled });
        }
      } catch (e) {}
    });

    // 拖拽
    makePanelDraggable();

    // 点击外部关闭
    setTimeout(() => {
      document.addEventListener('mousedown', onDocumentMouseDown, true);
    }, 0);
  }

  let suppressOutsideClick = false;
  function onDocumentMouseDown(e) {
    if (!panel || !panelVisible) return;
    if (suppressOutsideClick) {
      suppressOutsideClick = false;
      return;
    }
    if (!panel.contains(e.target)) {
      hide();
    }
  }

  function flashInfo(text) {
    const info = document.getElementById('vs-video-info');
    if (info) {
      const orig = info.textContent;
      info.textContent = text;
      setTimeout(() => { info.textContent = orig; }, 1200);
    }
  }

  function makePanelDraggable() {
    let isDragging = false, startX, startY, startLeft, startTop;
    panel.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.transition = 'none';
      panel.style.cursor = 'grabbing';
      suppressOutsideClick = true;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.right = 'auto';
      panel.style.top = (Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, startTop + dy))) + 'px';
      panel.style.left = (Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + dx))) + 'px';
      panel.style.transform = 'none';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panel.style.cursor = '';
        panel.style.transition = 'opacity 0.25s ease, visibility 0.25s ease, transform 0.25s ease';
      }
    });
  }

  // ==================== 浮动指示徽章 ====================

  function createBadge() {
    if (badge) return;
    badge = document.createElement('div');
    badge.id = 'toolbox-vs-badge';
    badge.style.cssText =
      'position:fixed;right:0;top:50%;transform:translateY(-50%) translateX(100%);' +
      'z-index:2147483639;background:rgba(74,144,217,0.92);color:#fff;' +
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
      'font-size:11px;font-weight:700;padding:6px 8px;border-radius:6px 0 0 6px;' +
      'cursor:pointer;box-shadow:-2px 2px 8px rgba(0,0,0,0.3);' +
      'transition:transform 0.3s ease, opacity 0.3s ease;' +
      'opacity:0;pointer-events:none;user-select:none;-webkit-user-select:none;letter-spacing:0.3px;';
    badge.addEventListener('mousedown', (e) => {
      // 阻止 onDocumentMouseDown 在 badge 点击时关闭面板
      suppressOutsideClick = true;
    });
    badge.addEventListener('click', () => {
      show();
    });
    document.body.appendChild(badge);
  }

  function showBadge() {
    if (!badge) createBadge();
    badge.textContent = currentSpeed.toFixed(currentSpeed % 1 === 0 ? 1 : 2) + 'x';
    badge.style.transform = 'translateY(-50%) translateX(0)';
    badge.style.opacity = '1';
    badge.style.pointerEvents = 'auto';
  }

  function hideBadge() {
    if (!badge) return;
    badge.style.transform = 'translateY(-50%) translateX(100%)';
    badge.style.opacity = '0';
    badge.style.pointerEvents = 'none';
  }

  function updateBadge() {
    if (currentSpeed !== 1 && extensionEnabled) {
      showBadge();
    } else {
      hideBadge();
    }
  }

  // ==================== 速度控制 ====================

  function setSpeed(speed) {
    speed = Math.max(SPEED_MIN, Math.min(SPEED_MAX, +speed.toFixed(2)));
    currentSpeed = speed;
    window.__toolboxVideoSpeedCurrent = speed;

    // 同步时间加速倍率
    if (timeAccelEnabled) {
      timeAccelUpdate(speed);
    }

    // 用户主动设置速度时自动启用
    if (speed !== 1 && !extensionEnabled) {
      extensionEnabled = true;
      window.__toolboxVideoSpeedEnabled = true;
      try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [STORAGE_ENABLED_KEY]: true });
        }
      } catch (e) {}
    }

    updatePanelDisplay();
    updateBadge();

    const result = setAllMediaSpeed(speed);
    saveSpeed(speed);

    const infoEl = document.getElementById('vs-video-info');
    if (infoEl && panel) {
      if (result.total > 0) {
        infoEl.textContent = `${browserName} · ${result.total} 媒体 · Alt=V`;
      } else {
        infoEl.textContent = `${browserName} · 0.07x~${SPEED_MAX}x · Alt=V`;
      }
    }

    // 多视频时显示"应用到所有"按钮
    const applyAllBtn = document.getElementById('vs-applyall');
    if (applyAllBtn) {
      applyAllBtn.classList.toggle('show', result.total > 1);
    }

    // 速度非 1x 且启用时维持反篡改循环
    ensureEnforceLoop();
  }

  function updatePanelDisplay() {
    if (!panel) return;
    const display = document.getElementById('vs-speed-val');
    if (display) {
      display.textContent = currentSpeed.toFixed(currentSpeed % 1 === 0 ? 1 : 2);
    }
    const range = panel.querySelector('#vs-range');
    if (range && Math.abs(parseFloat(range.value) - currentSpeed) > 0.001) {
      range.value = currentSpeed;
    }
    panel.querySelectorAll('.vs-btn[data-speed]').forEach(btn => {
      btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.speed) - currentSpeed) < 0.001);
    });
    const media = findAllMediaElements(document);
    const countEl = document.getElementById('vs-count');
    if (countEl) countEl.textContent = '·' + media.length;
  }

  function show() {
    createPanel();
    panel.classList.add('show');
    panelVisible = true;
    const media = findAllMediaElements(document);
    const infoEl = document.getElementById('vs-video-info');
    if (infoEl) {
      infoEl.textContent = media.length > 0
        ? `${browserName} · ${media.length} 媒体 · Alt=V`
        : `${browserName} · 0.07x~${SPEED_MAX}x · Alt=V`;
    }
    const countEl = document.getElementById('vs-count');
    if (countEl) countEl.textContent = '·' + media.length;
    updatePanelDisplay();
  }

  function hide() {
    if (panel) {
      panel.classList.remove('show');
      panelVisible = false;
    }
  }

  function toggle() {
    createPanel();
    if (panelVisible) hide(); else show();
  }

  // ==================== 视频监控（SPA/HMR） ====================

  // MutationObserver 监控 DOM 变化
  const observer = new MutationObserver(() => {
    if (currentSpeed !== 1 && extensionEnabled) {
      // 用 requestAnimationFrame 替代 setTimeout，更适配 SPA/HMR
      requestAnimationFrame(() => setAllMediaSpeed(currentSpeed));
    }
  });

  function startObserver() {
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src']
      });
    }
  }

  // iframe 加载监控
  const iframeObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.tagName === 'IFRAME') {
          try {
            node.addEventListener('load', () => {
              if (currentSpeed !== 1 && extensionEnabled) {
                requestAnimationFrame(() => setAllMediaSpeed(currentSpeed));
              }
            });
          } catch (e) {}
        }
      });
    });
  });

  // ==================== 反篡改：rAF 循环强制恢复 ====================

  // 使用 rAF 循环每 500ms 检查并恢复非 1x 的速度
  // 优化：速度=1x 或功能禁用时自动停止循环（不再空转消耗 CPU）
  let lastEnforceTime = 0;
  let enforceRunning = false;
  function enforceLoop(ts) {
    enforceRunning = false;
    // 不需要强制恢复时停止循环
    if (!(currentSpeed !== 1 && extensionEnabled)) return;
    if (ts - lastEnforceTime >= 500) {
      lastEnforceTime = ts;
      const media = findAllMediaElements(document);
      for (let i = 0; i < media.length; i++) {
        const el = media[i];
        try {
          if (Math.abs(el.playbackRate - currentSpeed) > 0.01) {
            requestAnimationFrame(() => {
              try { el.playbackRate = currentSpeed; } catch (e) {}
            });
          }
          if (!trackedMedia.has(el)) {
            trackedMedia.add(el);
            attachMediaListeners(el);
          }
        } catch (e) {}
      }
    }
    enforceRunning = true;
    requestAnimationFrame(enforceLoop);
  }

  // 仅在需要时启动/维持反篡改循环
  function ensureEnforceLoop() {
    if (!enforceRunning && currentSpeed !== 1 && extensionEnabled) {
      enforceRunning = true;
      lastEnforceTime = 0;
      requestAnimationFrame(enforceLoop);
    }
  }

  // ==================== 键盘快捷键 ====================

  document.addEventListener('keydown', e => {
    // 输入框中只允许 Alt+V
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      if (!(e.altKey && (e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.shiftKey)) {
        return;
      }
    }

    if (e.altKey && (e.key === 'v' || e.key === 'V') && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      toggle();
      return;
    }
    if (e.altKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      setSpeed(Math.min(SPEED_MAX, +(currentSpeed + 0.25).toFixed(2)));
      if (!panelVisible) show();
      return;
    }
    if (e.altKey && e.key === '-') {
      e.preventDefault();
      setSpeed(Math.max(SPEED_MIN, +(currentSpeed - 0.25).toFixed(2)));
      if (!panelVisible) show();
      return;
    }
    if (e.altKey && e.key === '0') {
      e.preventDefault();
      setSpeed(1);
      if (!panelVisible) show();
      return;
    }
    if (e.shiftKey && e.key === '>' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setSpeed(Math.min(SPEED_MAX, +(currentSpeed + 0.1).toFixed(2)));
      return;
    }
    if (e.shiftKey && e.key === '<' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setSpeed(Math.max(SPEED_MIN, +(currentSpeed - 0.1).toFixed(2)));
      return;
    }
  });

  // ==================== postMessage 通信 ====================

  window.addEventListener('message', e => {
    // 安全：仅接受来自 sidebar iframe、window.parent（宿页面）或当前 window 的消息
    const sidebarWin = document.getElementById('toolbox-iframe')?.contentWindow;
    if (e.source && e.source !== window && e.source !== window.parent && e.source !== sidebarWin) return;
    const { action, data } = e.data || {};
    if (action === 'setVideoSpeed' && data && typeof data.speed === 'number') {
      // 同时接收音频变调补偿设置
      if (typeof data.preservesPitch === 'boolean') {
        preservesPitch = data.preservesPitch;
      }
      setSpeed(data.speed);
      if (!panelVisible) show();
    }
    // 跨标签页同步：ISOLATED world 监听 storage 变更后经 __vsApply 转发到本实例
    // （MAIN world 无 chrome.storage，无法自行订阅，此前那段 onChanged 代码恒不执行）
    if (action === '__vsApply' && data && typeof data === 'object') {
      if (typeof data.speed === 'number' && Number.isFinite(data.speed)) {
        const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, data.speed));
        currentSpeed = clamped;
        window.__toolboxVideoSpeedCurrent = clamped;
        if (extensionEnabled) setAllMediaSpeed(clamped);
        updatePanelDisplay();
        updateBadge();
      }
      if (typeof data.enabled === 'boolean') {
        extensionEnabled = data.enabled;
        window.__toolboxVideoSpeedEnabled = extensionEnabled;
        if (extensionEnabled && currentSpeed !== 1) setAllMediaSpeed(currentSpeed);
        updateBadge();
      }
    }
    // 音频变调补偿开关
    if (action === 'setPreservesPitch' && data && typeof data.preservesPitch === 'boolean') {
      preservesPitch = data.preservesPitch;
      // 立即应用到所有媒体元素
      const media = findAllMediaElements(document);
      media.forEach(el => {
        try {
          if ('preservesPitch' in el) el.preservesPitch = preservesPitch;
          if ('mozPreservesPitch' in el) el.mozPreservesPitch = preservesPitch;
          if ('webkitPreservesPitch' in el) el.webkitPreservesPitch = preservesPitch;
        } catch (e) {}
      });
      flashInfo('音频变调补偿: ' + (preservesPitch ? '开启' : '关闭'));
    }
    // 画中画请求
    if (action === 'enterPiP') {
      requestPiP();
    }
    // 时间加速开关
    if (action === 'setTimeAccel' && data) {
      timeAccelEnabled = !!data.enabled;
      window.__toolboxTimeAccelEnabled = timeAccelEnabled;
      if (timeAccelEnabled) {
        timeAccelRealBase = _origPerfNow();
        timeAccelFakeBase = _origPerfNow();
        timeAccelDateRealBase = _origDateNow();
        timeAccelDateFakeBase = _origDateNow();
        timeAccelSpeed = currentSpeed;
        const media = findAllMediaElements(document);
        timeAccelVideoPlaying = media.some(el => !el.paused);
      } else {
        timeAccelSpeed = 1;
        timeAccelVideoPlaying = false;
      }
      // 同步面板按钮
      const btn = document.getElementById('vs-time-accel');
      if (btn) {
        btn.textContent = timeAccelEnabled ? '⏱ 时间加速: 开' : '⏱ 时间加速: 关';
        btn.style.background = timeAccelEnabled ? 'rgba(76,175,80,0.3)' : 'rgba(255,152,0,0.2)';
      }
    }
    if (action === 'detectVideos') {
      const media = findAllMediaElements(document);
      const videos = media.map(function(el, idx) {
        try {
          return {
            index: idx,
            src: el.currentSrc || el.src || '',
            paused: el.paused,
            ended: el.ended,
            duration: isFinite(el.duration) ? el.duration : 0,
            currentTime: isFinite(el.currentTime) ? el.currentTime : 0,
            playbackRate: el.playbackRate || 1,
            volume: el.volume,
            muted: el.muted,
            videoWidth: el.videoWidth || 0,
            videoHeight: el.videoHeight || 0
          };
        } catch(e) { return null; }
      }).filter(Boolean);
      window.postMessage({
        action: 'detectVideosResult',
        data: { count: videos.length, videos: videos }
      }, '*');
      if (media.length > 0) {
        setSpeed(currentSpeed);
        show();
      }
    }
    if (action === 'getVideoStatus') {
      const media = findAllMediaElements(document);
      window.postMessage({
        action: 'videoStatus',
        data: { speed: currentSpeed, count: media.length, panelVisible, enabled: extensionEnabled }
      }, '*');
    }
    if (action === 'videoControl' && data) {
      const media = findAllMediaElements(document);
      const idx = typeof data.index === 'number' ? data.index : 0;
      const el = media[idx];
      if (el) {
        try {
          switch (data.cmd) {
            case 'pause': el.pause(); break;
            case 'play': el.play().catch(function(){}); break;
            case 'toggle': el.paused ? el.play().catch(function(){}) : el.pause(); break;
            case 'seek': if (isFinite(data.time)) el.currentTime = data.time; break;
            case 'restart': el.currentTime = 0; if (el.paused) el.play().catch(function(){}); break;
          }
        } catch(e) {}
      }
    }
    // A-B 循环播放控制
    if (action === 'setABLoop' && data) {
      if (data.enabled && typeof data.pointA === 'number' && typeof data.pointB === 'number') {
        abLoopConfig.enabled = true;
        abLoopConfig.pointA = data.pointA;
        abLoopConfig.pointB = data.pointB;
        // 确保 timeupdate 监听
        const media = findAllMediaElements(document);
        if (media.length > 0 && !abLoopListenerAttached) {
          attachABLoopListener(media[0]);
        }
      } else {
        abLoopConfig.enabled = false;
        abLoopConfig.pointA = null;
        abLoopConfig.pointB = null;
      }
    }
    if (action === 'toolboxMediaInfo' && data && Array.isArray(data.media)) {
      // 注：MAIN world 无 chrome 扩展 API，此处的跨域上报原本无法生效，已移除
      // 跨域媒体检测结果由 injector 的 PerformanceObserver 路径独立收集
    }
    // 全局开关关闭 — 重置倍速为1x并禁用
    if (action === 'masterSwitchOff' && e.data && e.data.source === 'toolbox') {
      extensionEnabled = false;
      window.__toolboxVideoSpeedEnabled = false;
      setAllMediaSpeed(1);
      hide();
      hideBadge();
    }
    // 全局开关开启 — 恢复倍速
    if (action === 'masterSwitchOn' && e.data && e.data.source === 'toolbox') {
      extensionEnabled = true;
      window.__toolboxVideoSpeedEnabled = true;
      if (currentSpeed !== 1) {
        setAllMediaSpeed(currentSpeed);
      }
      updateBadge();
      ensureEnforceLoop();
    }
  });

  // ==================== A-B 循环播放 ====================
  const abLoopConfig = { enabled: false, pointA: null, pointB: null };
  let abLoopListenerAttached = false;

  function attachABLoopListener(el) {
    if (abLoopListenerAttached) return;
    abLoopListenerAttached = true;
    el.addEventListener('timeupdate', () => {
      if (!abLoopConfig.enabled || abLoopConfig.pointA === null || abLoopConfig.pointB === null) return;
      try {
        const cur = el.currentTime;
        if (cur >= abLoopConfig.pointB) {
          el.currentTime = abLoopConfig.pointA;
        }
      } catch (e) {}
    });
  }

  // ==================== 初始化 ====================

  function init() {
    loadSpeed();

    // 同步全局状态
    window.__toolboxVideoSpeedCurrent = currentSpeed;
    window.__toolboxVideoSpeedEnabled = extensionEnabled;

    // 启动监控
    if (document.body) {
      startObserver();
      iframeObserver.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        startObserver();
        iframeObserver.observe(document.body, { childList: true, subtree: true });
      });
    }

    // 初始应用保存的速度
    setTimeout(() => {
      const media = findAllMediaElements(document);
      if (media.length > 0 && currentSpeed !== 1 && extensionEnabled) {
        setAllMediaSpeed(currentSpeed);
      }
    }, 1500);

    // 启动反篡改循环（仅在需要时运行，速度=1x 或禁用时自动停止）
    ensureEnforceLoop();

    // 监听 PiP 变化
    try {
      if ('pictureInPictureEnabled' in document && document.pictureInPictureEnabled) {
        document.addEventListener('enterpictureinpicture', () => {
          if (currentSpeed !== 1 && extensionEnabled) {
            requestAnimationFrame(() => setAllMediaSpeed(currentSpeed));
          }
        });
      }
    } catch (e) {}

    // 跨标签页同步由 ISOLATED world 的 chrome.storage.onChanged 监听 + __vsApply 消息完成
    // （原实现在此监听 changes[STORAGE_KEY]，但该 key 从未被写入，属死代码，已移除）

    console.log('[ToolCube] Video Speed Controller v5.0 (' + browserName + ', 0.07x~' + SPEED_MAX + 'x, Shadow+iframe+PiP+Anti-tamper)');
  }

  init();
})();
