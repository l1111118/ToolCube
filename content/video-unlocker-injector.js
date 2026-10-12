/**
 * ToolCube - Video Unlocker Injector v3.0 (Firefox 版)
 * 视频解锁注入脚本（精简版）
 *
 * Firefox 不支持 world: 'MAIN'，通过自注入机制将脚本注入到 MAIN world
 * 当在 ISOLATED world 加载时，自动创建 <script> 标签注入到 MAIN world
 *
 * 特性:
 *  - 控件解锁：强制开启原生控件，允许拖动进度条
 *  - playbackRate 劫持：与视频倍速控制器协调
 *  - 反劫持：rAF + 1s 定时器双重保险
 *  - MutationObserver + Shadow DOM 递归扫描（SPA 友好）
 *  - iframe 多帧独立状态（content_scripts all_frames:true）
 *
 * @version 3.0.0
 */
(async function () {
  'use strict';

  // Firefox MAIN world 自注入检测
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    try {
      const stored = await chrome.storage.local.get(['toolbox_video_unlocker', 'toolbox_master_enabled']);
      // 全局开关检查：若关闭则完全不注入，等同于扩展不存在
      if (stored.toolbox_master_enabled === false) return;
      if (stored.toolbox_video_unlocker) {
        document.documentElement.dataset.__toolboxVideoUnlockerConfig = JSON.stringify(stored.toolbox_video_unlocker);
      }
    } catch (e) {}
    const scriptUrl = chrome.runtime.getURL('content/video-unlocker-injector.js');
    const s = document.createElement('script');
    s.src = scriptUrl;
    (document.documentElement || document.head).prepend(s);
    s.onload = () => s.remove();

    // ISOLATED world 消息桥接：MAIN world 无法直接调用 chrome API
    // 监听 MAIN world 发来的下载请求，转发给 background 通过 chrome.downloads 下载（绕过 CORS）
    //
    // 安全说明：MAIN world 与页面共享同一个 window，页面脚本同样能发出该消息，
    // 无法通过来源鉴别彻底防御。因此对载荷做严格校验：
    //   1) 仅接受 e.source === window（拒绝跨 frame 发送方）
    //   2) 仅接受 http/https 协议（拒绝 file:/data:/blob:/javascript: 等可被滥用的协议）
    //   3) 文件名长度受限，且 background 侧 sanitizeFilename 会剥离路径分隔符，避免路径穿越
    // 残余影响：页面可请求下载一个 http(s) 资源到下载目录——这与页面用 <a download> 的能力等价，
    // 不构成权限提升，属可接受风险。
    window.addEventListener('message', function (e) {
      if (e.source !== window) return;
      if (!e.data || typeof e.data !== 'object') return;
      // 仅处理 MAIN world 发来的后台下载请求
      if (e.data.action !== 'videoUnlocker:downloadViaBg') return;
      const payload = e.data.data || {};
      const url = payload.url;
      const filename = String(payload.filename || 'toolbox-video.mp4').slice(0, 180);
      const reply = (data) => {
        try { window.postMessage({ action: 'videoUnlocker:downloadResult', data }, '*'); } catch (err) {}
      };
      if (!url) {
        reply({ success: false, error: '缺少下载URL' });
        return;
      }
      let parsed;
      try { parsed = new URL(String(url)); } catch (err) { parsed = null; }
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        reply({ success: false, url: String(url), error: '仅支持 http/https 协议的下载地址' });
        return;
      }
      // 转发给 background 的 downloadResource 处理器
      chrome.runtime.sendMessage({ action: 'downloadResource', data: { url: parsed.href, filename: filename, conflictAction: 'uniquify' } })
        .then(function (resp) {
          reply({ success: !!(resp && resp.success), url: parsed.href, error: resp && resp.error ? resp.error : null });
        })
        .catch(function (err) {
          reply({ success: false, url: parsed.href, error: err && err.message ? err.message : '后台下载失败' });
        });
    });

    // background 动态推送配置（chrome.runtime.onMessage）→ 桥接到 MAIN world 的 window 消息
    // 修复：background 的 videoUnlocker:setConfig 推送此前无法到达 MAIN world，配置修改需刷新才生效
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message !== 'object') return;
        const action = message.action;
        if (action === 'videoUnlocker:setConfig' ||
            action === 'masterSwitchOff' ||
            action === 'masterSwitchOn') {
          window.postMessage({
            action: action,
            data: message.data || {},
            source: 'toolbox'
          }, '*');
          if (sendResponse) sendResponse({ success: true });
        }
      });
    } catch (e) {}

    return;
  }

  // 以下代码运行在 MAIN world

  // 防止重复注入
  if (window.__toolboxVideoUnlockerV3) {
    try {
      window.postMessage({ __toolbox_unlocker: true, version: 3 }, '*');
    } catch (e) {}
    return;
  }
  window.__toolboxVideoUnlockerV3 = true;

  // ==================== 启动提示 ====================
  try {
    console.log(
      '%c[Toolbox Video Unlocker v3]%c 已激活',
      'color:#22c55e;font-weight:bold',
      'color:inherit'
    );
  } catch (e) {}

  // ==================== 默认配置 ====================
  const DEFAULT_CONFIG = Object.freeze({
    enabled: false,
    unlockControls: true,
    unlockContextmenu: true,
    unlockFullscreen: true,
    forcePip: true,
    skipAds: false,
    spoofProgress: false,
    volumeBoost: 1,
    speedFine: 1
  });

  const config = Object.assign({}, DEFAULT_CONFIG);

  // Firefox: 从 DOM data 属性读取 ISOLATED world 传递的初始配置
  try {
    const configStr = document.documentElement.dataset.__toolboxVideoUnlockerConfig;
    if (configStr) {
      const storedConfig = JSON.parse(configStr);
      Object.assign(config, storedConfig);
      delete document.documentElement.dataset.__toolboxVideoUnlockerConfig;
    }
  } catch (e) {}

  // ==================== 工具函数 ====================
  function safeCall(fn, thisArg) {
    try {
      return fn.apply(thisArg, Array.prototype.slice.call(arguments, 2));
    } catch (e) {
      return undefined;
    }
  }

  // ==================== 原型链劫持 ====================
  const PROTO = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
  if (PROTO) {
    // 保存原始描述符
    const ORIGINAL_DESCRIPTORS = {};
    const TRACKED_PROPS = [
      'playbackRate', 'volume', 'muted', 'controls',
      'readyState', 'networkState', 'error'
    ];

    TRACKED_PROPS.forEach(function (prop) {
      try {
        const d = Object.getOwnPropertyDescriptor(PROTO, prop);
        if (d) {
          ORIGINAL_DESCRIPTORS[prop] = {
            get: d.get,
            set: d.set,
            value: d.value,
            configurable: d.configurable,
            enumerable: d.enumerable
          };
        }
      } catch (e) {}
    });

    // 暴露给内部使用
    window.__toolboxOriginalMediaDescriptors = ORIGINAL_DESCRIPTORS;

    function realGet(media, prop) {
      const d = ORIGINAL_DESCRIPTORS[prop];
      if (!d) return undefined;
      if (typeof d.get === 'function') return d.get.call(media);
      return d.value;
    }

    function realSet(media, prop, value) {
      const d = ORIGINAL_DESCRIPTORS[prop];
      if (!d || !d.set) return;
      d.set.call(media, value);
    }

    // ---- playbackRate ----
    // 与视频倍速控制器协调：如果倍速控制器启用，任何非期望值都被拦截
    try {
      Object.defineProperty(PROTO, 'playbackRate', {
        configurable: true,
        enumerable: true,
        get: function () { return realGet(this, 'playbackRate'); },
        set: function (v) {
          if (window.__toolboxVideoSpeedEnabled) {
            const desired = window.__toolboxVideoSpeedCurrent;
            if (Math.abs(v - desired) < 0.01) {
              realSet(this, 'playbackRate', v);
              return;
            }
            realSet(this, 'playbackRate', desired);
            return;
          }
          realSet(this, 'playbackRate', v);
        }
      });
    } catch (e) {}

    // ---- volume / muted ----
    try {
      Object.defineProperty(PROTO, 'volume', {
        configurable: true, enumerable: true,
        get: function () { return realGet(this, 'volume'); },
        set: function (v) { realSet(this, 'volume', v); }
      });
    } catch (e) {}
    try {
      Object.defineProperty(PROTO, 'muted', {
        configurable: true, enumerable: true,
        get: function () { return realGet(this, 'muted'); },
        set: function (v) { realSet(this, 'muted', v); }
      });
    } catch (e) {}

    // ---- controls ----
    // 保留原始 getter/setter，但解锁时强制为 true
    try {
      const origControlsGet = ORIGINAL_DESCRIPTORS.controls ? ORIGINAL_DESCRIPTORS.controls.get : null;
      const origControlsSet = ORIGINAL_DESCRIPTORS.controls ? ORIGINAL_DESCRIPTORS.controls.set : null;
      Object.defineProperty(PROTO, 'controls', {
        configurable: true, enumerable: true,
        get: function () {
          if (config.unlockControls && config.enabled) return true;
          if (origControlsGet) return origControlsGet.call(this);
          return false;
        },
        set: function (v) {
          if (origControlsSet) origControlsSet.call(this, v);
        }
      });
    } catch (e) {}

    // ---- currentTime（进度伪装） ----
    // 保存原始 currentTime 描述符并劫持 getter
    // 当进度伪装启用时，返回按 1x 墙钟时间推进的伪装值，让平台轮询看到正常的 1x 播放进度
    try {
      const origCtDesc = Object.getOwnPropertyDescriptor(PROTO, 'currentTime');
      if (origCtDesc && typeof origCtDesc.get === 'function') {
        ORIGINAL_DESCRIPTORS.currentTime = {
          get: origCtDesc.get, set: origCtDesc.set,
          configurable: origCtDesc.configurable, enumerable: origCtDesc.enumerable
        };
      }
      // 每个媒体元素维护独立的伪装状态
      // spoofState: { baseReal: 真实currentTime基准, baseWall: 墙钟基准, playing: 是否在播放 }
      const spoofMap = new WeakMap();

      function getSpoofState(media) {
        let st = spoofMap.get(media);
        if (!st) {
          st = { baseReal: 0, baseWall: 0, playing: false, duration: NaN };
          spoofMap.set(media, st);
        }
        return st;
      }

      function readRealCurrentTime(media) {
        const d = ORIGINAL_DESCRIPTORS.currentTime;
        if (d && typeof d.get === 'function') return d.get.call(media);
        return 0;
      }

      function readRealDuration(media) {
        try {
          const dd = Object.getOwnPropertyDescriptor(PROTO, 'duration');
          if (dd && typeof dd.get === 'function') return dd.get.call(media);
        } catch (e) {}
        return media.duration;
      }

      Object.defineProperty(PROTO, 'currentTime', {
        configurable: true, enumerable: true,
        get: function () {
          if (config.spoofProgress && config.enabled) {
            const st = getSpoofState(this);
            const realCt = readRealCurrentTime(this);
            const now = Date.now();
            // 计算 1x 推进的伪装时间
            let spoofed;
            if (st.playing) {
              spoofed = st.baseReal + (now - st.baseWall) / 1000;
            } else {
              spoofed = st.baseReal;
            }
            // 不超过 duration（如果已知）
            const dur = readRealDuration(this);
            if (isFinite(dur) && dur > 0 && spoofed > dur) spoofed = dur;
            // 不低于 0
            if (spoofed < 0) spoofed = 0;
            return spoofed;
          }
          return readRealCurrentTime(this);
        },
        set: function (v) {
          const d = ORIGINAL_DESCRIPTORS.currentTime;
          if (d && d.set) d.set.call(this, v);
          // 用户/平台 seek 时，同步更新伪装基准
          if (config.spoofProgress && config.enabled) {
            const st = getSpoofState(this);
            st.baseReal = Number(v) || 0;
            st.baseWall = Date.now();
          }
        }
      });

      // 导出工具函数，供 unlockMediaControls 使用
      window.__toolboxSpoofState = {
        spoofMap: spoofMap,
        getSpoofState: getSpoofState,
        readRealCurrentTime: readRealCurrentTime
      };
    } catch (e) {}
  }

  // ==================== 媒体元素扫描 ====================
  const activeMediaList = new Set();

  function findAllMedia(root) {
    const out = [];
    if (!root) return out;
    if (root.querySelectorAll) {
      root.querySelectorAll('video, audio').forEach(function (el) { out.push(el); });
    }
    if (root.querySelectorAll) {
      root.querySelectorAll('*').forEach(function (el) {
        if (el.shadowRoot) out.push.apply(out, findAllMedia(el.shadowRoot));
      });
    }
    return out;
  }

  function unlockMediaControls(media) {
    if (!media || activeMediaList.has(media)) return;
    activeMediaList.add(media);

    if (config.unlockControls && config.enabled) {
      try { media.controls = true; } catch (e) {}
      try { media.setAttribute('controls', ''); } catch (e) {}
      try { media.removeAttribute('disablepictureinpicture'); } catch (e) {}
      // 移除常见阻止拖动的样式
      try {
        if (media.style) {
          media.style.pointerEvents = '';
          media.style.userSelect = '';
        }
      } catch (e) {}
    }

    // 画中画强制启用
    if (config.forcePip && config.enabled) {
      try { media.removeAttribute('disablepictureinpicture'); } catch (e) {}
      try { media.disablePictureInPicture = false; } catch (e) {}
    }

    // 全屏解锁
    if (config.unlockFullscreen && config.enabled) {
      try {
        // 移除父容器上的全屏限制样式
        var parent = media.parentElement;
        while (parent && parent !== document.body) {
          try {
            var style = window.getComputedStyle(parent);
            if (style && style.zIndex && parseInt(style.zIndex, 10) > 0) {
              // 保持原样，但确保 video 有全屏能力
            }
          } catch (e) {}
          parent = parent.parentElement;
        }
      } catch (e) {}
    }

    // 音量增益 - 使用 Web Audio API
    if (config.volumeBoost > 1 && config.enabled) {
      applyVolumeBoost(media);
    }

    // 播放速度微调
    if (config.speedFine !== 1 && config.enabled) {
      try { media.playbackRate = config.speedFine; } catch (e) {}
    }

    // 进度伪装 - 为媒体元素绑定 play/pause/seeked/loadedmetadata 监听
    // 当伪装启用时，跟踪播放状态以计算 1x 推进的伪装时间
    setupSpoofListeners(media);
  }

  // ==================== 进度伪装事件监听 ====================
  function setupSpoofListeners(media) {
    if (media.__toolboxSpoofBound) return;
    media.__toolboxSpoofBound = true;

    const spoofUtils = window.__toolboxSpoofState;
    if (!spoofUtils) return;

    media.addEventListener('play', function () {
      if (!config.spoofProgress || !config.enabled) return;
      const st = spoofUtils.getSpoofState(media);
      // 以当前真实位置作为起点，开始按 1x 墙钟推进
      st.baseReal = spoofUtils.readRealCurrentTime(media);
      st.baseWall = Date.now();
      st.playing = true;
    }, false);

    media.addEventListener('pause', function () {
      if (!config.spoofProgress || !config.enabled) return;
      const st = spoofUtils.getSpoofState(media);
      // 暂停时，把基准同步到当前伪装值（冻结）
      const now = Date.now();
      let frozen = st.playing ? st.baseReal + (now - st.baseWall) / 1000 : st.baseReal;
      st.baseReal = frozen;
      st.baseWall = now;
      st.playing = false;
    }, false);

    media.addEventListener('seeked', function () {
      if (!config.spoofProgress || !config.enabled) return;
      const st = spoofUtils.getSpoofState(media);
      // seek 完成后，以新的真实位置作为起点
      st.baseReal = spoofUtils.readRealCurrentTime(media);
      st.baseWall = Date.now();
    }, false);

    media.addEventListener('loadedmetadata', function () {
      if (!config.spoofProgress || !config.enabled) return;
      const st = spoofUtils.getSpoofState(media);
      st.baseReal = spoofUtils.readRealCurrentTime(media);
      st.baseWall = Date.now();
      st.playing = !media.paused;
    }, false);
  }

  // ==================== 右键菜单解锁 ====================
  let contextMenuUnlocked = false;

  function unlockContextMenu() {
    if (contextMenuUnlocked) return;
    contextMenuUnlocked = true;
    // 覆盖常见阻止右键的方法
    document.oncontextmenu = null;
    document.onselectstart = null;
    document.oncopy = null;
    document.onmousedown = null;

    // 解除右键限制的实现说明：
    // 旧实现改写 EventTarget.prototype.addEventListener，并按"监听器源码里是否出现
    // preventDefault / return false"来决定丢弃监听器。这种做法会误伤大量合法逻辑
    // （拖拽、复制、输入框 mousedown 等），直接破坏页面功能。
    // 改为在 window 的捕获阶段拦截 contextmenu：window 是最外层捕获目标，
    // 在此调用 stopPropagation() 即可阻止页面任意层级的监听器执行 preventDefault()，
    // 从而让浏览器显示原生右键菜单，同时完全不影响其他事件类型。
    //
    // 例外：必须放行ToolCube自身的 UI。捕获阶段的 stopPropagation 会阻断事件到达目标元素，
    // 而悬浮按钮的快捷菜单（#toolbox-toggle-btn → contextmenu）与侧边栏都依赖该事件，
    // 若不排除，开启本功能后扩展自身的右键菜单将失效。
    const TOOLBOX_UI_SELECTOR = '#toolbox-toggle-btn, #toolbox-toggle-menu, #toolbox-sidebar, #toolbox-iframe';

    window.addEventListener('contextmenu', function(e) {
      if (!config.unlockContextmenu || !config.enabled) return;
      const target = e.target;
      // 仅在扩展自身 UI 之外拦截（closest 兼容元素节点与文本节点）
      if (target && typeof target.closest === 'function' && target.closest(TOOLBOX_UI_SELECTOR)) return;
      e.stopPropagation();
    }, true);

    // 移除所有现有阻止右键的属性
    try {
      var allElements = document.querySelectorAll('[oncontextmenu]');
      for (var i = 0; i < allElements.length; i++) {
        allElements[i].oncontextmenu = null;
      }
    } catch (e) {}
  }

  // ==================== 全屏解锁 ====================
  let fullscreenUnlocked = false;

  function unlockFullscreen() {
    if (fullscreenUnlocked) return;
    fullscreenUnlocked = true;

    // 确保 requestFullscreen 可用
    if (!Element.prototype.requestFullscreen && Element.prototype.webkitRequestFullscreen) {
      Element.prototype.requestFullscreen = Element.prototype.webkitRequestFullscreen;
    }
    if (!Element.prototype.requestFullscreen && Element.prototype.mozRequestFullScreen) {
      Element.prototype.requestFullscreen = Element.prototype.mozRequestFullScreen;
    }
    if (!Element.prototype.requestFullscreen && Element.prototype.msRequestFullscreen) {
      Element.prototype.requestFullscreen = Element.prototype.msRequestFullscreen;
    }

    // 覆盖 exitFullscreen
    if (!document.exitFullscreen && document.webkitExitFullscreen) {
      document.exitFullscreen = document.webkitExitFullscreen;
    }

    // 在视频上双击全屏
    document.addEventListener('dblclick', function(e) {
      if (!config.unlockFullscreen || !config.enabled) return;
      var target = e.target;
      if (target.tagName === 'VIDEO' || target.tagName === 'AUDIO') {
        try {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            target.requestFullscreen();
          }
        } catch (e) {}
      }
    }, true);
  }

  // ==================== 音量增益 (Web Audio API) ====================
  const audioContextMap = new WeakMap();
  const gainNodeMap = new WeakMap();
  const mediaSourceMap = new WeakMap();

  function applyVolumeBoost(media) {
    if (config.volumeBoost <= 1) {
      // volumeBoost从>1改回1时，断开GainNode连接
      var existingGain = gainNodeMap.get(media);
      var existingSource = mediaSourceMap.get(media);
      if (existingGain) {
        try { existingGain.disconnect(); } catch (e) {}
        gainNodeMap.delete(media);
      }
      if (existingSource) {
        try { existingSource.connect(audioContextMap.get(media)?.destination || (window.AudioContext || window.webkitAudioContext) && new (window.AudioContext || window.webkitAudioContext)().destination); } catch (e) {}
        // 恢复直连：source → destination
        try {
          var ctx = audioContextMap.get(media);
          if (ctx && existingSource) {
            existingSource.disconnect();
            existingSource.connect(ctx.destination);
          }
        } catch (e) {}
      }
      return;
    }
    try {
      // 检查是否已经创建了音频上下文和MediaElementSource
      if (audioContextMap.has(media)) {
        var existingGain2 = gainNodeMap.get(media);
        if (existingGain2) existingGain2.gain.value = config.volumeBoost;
        return;
      }

      // 检查是否已有MediaElementSource（可能被其他脚本创建）
      if (mediaSourceMap.has(media)) {
        // 已有source，只调整gain（如果有的话）
        var existingGain3 = gainNodeMap.get(media);
        if (existingGain3) {
          existingGain3.gain.value = config.volumeBoost;
        }
        return;
      }

      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      var audioCtx = new AudioCtx();
      var source = audioCtx.createMediaElementSource(media);
      var gainNode = audioCtx.createGain();
      gainNode.gain.value = config.volumeBoost;
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      audioContextMap.set(media, audioCtx);
      gainNodeMap.set(media, gainNode);
      mediaSourceMap.set(media, source);

      // 恢复被暂停的音频上下文
      if (audioCtx.state === 'suspended') {
        media.addEventListener('play', function() {
          try { audioCtx.resume(); } catch (e) {}
        }, { once: true });
      }
    } catch (e) {
      // createMediaElementSource 可能失败（已被创建过等）
      // 标记该媒体元素已有source，避免反复尝试
      mediaSourceMap.set(media, null);
    }
  }

  function updateVolumeBoost(media) {
    if (config.volumeBoost <= 1) {
      applyVolumeBoost(media);
      return;
    }
    var gainNode = gainNodeMap.get(media);
    if (gainNode) {
      gainNode.gain.value = config.volumeBoost;
    } else {
      applyVolumeBoost(media);
    }
  }

  // ==================== 下载链接提取 ====================
  function extractMediaUrls() {
    var urls = [];
    var elements = findAllMedia(document);
    elements.forEach(function(el) {
      var src = el.currentSrc || el.src || '';
      if (src) {
        var resolution = '';
        try {
          if (el.videoWidth && el.videoHeight) resolution = el.videoWidth + '×' + el.videoHeight;
        } catch (e) {}
        urls.push({
          tag: el.tagName.toLowerCase(),
          url: src,
          resolution: resolution
        });
      }
      // 检查 source 子元素
      try {
        var sources = el.querySelectorAll('source');
        for (var i = 0; i < sources.length; i++) {
          var s = sources[i].src || sources[i].getAttribute('src') || '';
          if (s) {
            urls.push({
              tag: el.tagName.toLowerCase(),
              url: s,
              resolution: ''
            });
          }
        }
      } catch (e) {}
    });
    return urls;
  }

  function scanAndUnlock() {
    findAllMedia(document).forEach(unlockMediaControls);
  }

  // ==================== 自动跳过广告 ====================
  // 常见广告容器选择器
  const AD_CONTAINER_SELECTORS = [
    // 通用广告容器
    '[class*="ad-container" i]', '[class*="ad-wrapper" i]', '[class*="adsense" i]',
    '[class*="advertisement" i]', '[id*="ad-container" i]', '[id*="adsense" i]',
    '[class*="ad-banner" i]', '[class*="ad-overlay" i]',
    // 视频网站广告
    '.ad-showing', '.video-ad', '.preroll', '.postroll',
    '[class*="vast" i]', '[class*="ima-ad" i]',
    // 各平台
    '.ad-player', '.ad-mark', '[class*="pre-ad" i]',
    '[class*="ad-tip" i]', '[class*="ad-layer" i]',
    // iframe 广告
    'iframe[src*="ads"]', 'iframe[src*="ad."]', 'iframe[id*="ad"]'
  ];

  // 跳过广告按钮选择器（"跳过广告"按钮）
  // 注意：不使用 button[class*="skip"] / [aria-label*="skip"] 这类泛化选择器，
  // 它们会命中"跳过引导/跳过问卷/跳过推荐"等无关按钮并被自动点击，造成误操作。
  // 这里只保留带广告语义的定位方式。
  const AD_SKIP_BUTTON_SELECTORS = [
    '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern', '.ytp-ad-skip-button-container button',
    '[class*="skip-ad" i]', '[class*="ad-skip" i]', '[class*="skipAd" i]',
    '[id*="skip-ad" i]', '[id*="skipAd" i]',
    '[aria-label*="跳过广告"]', '[aria-label*="skip ad" i]',
    '.btn-skip-ad', '.skip-ad-btn'
  ];

  let adSkipObserver = null;
  let adSkipInterval = null;

  function hideAdContainers() {
    if (!config.skipAds || !config.enabled) return;
    AD_CONTAINER_SELECTORS.forEach(function(selector) {
      try {
        var els = document.querySelectorAll(selector);
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          // 不要隐藏视频本身
          if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') continue;
          // 不要隐藏包含视频的容器
          if (el.querySelector('video, audio')) continue;
          try {
            el.style.display = 'none';
            el.style.visibility = 'hidden';
            el.style.opacity = '0';
          } catch (e) {}
        }
      } catch (e) {}
    });
  }

  function clickSkipAdButtons() {
    if (!config.skipAds || !config.enabled) return;
    AD_SKIP_BUTTON_SELECTORS.forEach(function(selector) {
      try {
        var btns = document.querySelectorAll(selector);
        for (var i = 0; i < btns.length; i++) {
          var btn = btns[i];
          if (btn.offsetParent !== null) { // 可见
            btn.click();
          }
        }
      } catch (e) {}
    });
  }

  // 跳过视频片头广告：检测到广告播放时直接 seek 跳过
  //
  // 旧实现把"时长 < 30s 且刚开播"也判定为广告，导致所有正常短视频
  // （教学短片、视频预览、GIF 式循环视频）一开播就被跳到结尾。
  // 现在必须存在显式的广告播放标记才会执行跳过。
  const AD_SHOWING_MARKERS = '.ad-showing, .video-ad, .preroll, [class*="ima-ad" i]';

  function skipVideoAdInMedia() {
    if (!config.skipAds || !config.enabled) return;
    var hasAdMarker = false;
    try { hasAdMarker = !!document.querySelector(AD_SHOWING_MARKERS); } catch (e) { return; }
    var media = findAllMedia(document);
    media.forEach(function(el) {
      try {
        // 广告结束后清除标记，允许下一次广告继续跳过
        if (!hasAdMarker) {
          if (el.dataset) delete el.dataset.__toolboxAdSkipped;
          return;
        }
        if (!(el.duration > 0) || el.currentTime >= el.duration) return;
        // 单次跳过：定时器每 1s 触发一次，若不加标记会反复 seek 造成播放抖动
        if (el.dataset && el.dataset.__toolboxAdSkipped === '1') return;
        el.currentTime = el.duration - 0.5;
        if (el.dataset) el.dataset.__toolboxAdSkipped = '1';
      } catch (e) {}
    });
  }

  function startAdSkipper() {
    if (adSkipObserver || adSkipInterval) return;
    // 立即执行一次
    hideAdContainers();
    clickSkipAdButtons();
    skipVideoAdInMedia();

    // MutationObserver 监听广告动态加载
    try {
      adSkipObserver = new MutationObserver(function() {
        hideAdContainers();
        clickSkipAdButtons();
        skipVideoAdInMedia();
      });
      adSkipObserver.observe(document.documentElement || document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style']
      });
    } catch (e) {}

    // 定时检测（兜底）
    adSkipInterval = setInterval(function() {
      hideAdContainers();
      clickSkipAdButtons();
      skipVideoAdInMedia();
    }, 1000);
  }

  function stopAdSkipper() {
    if (adSkipObserver) {
      try { adSkipObserver.disconnect(); } catch (e) {}
      adSkipObserver = null;
    }
    if (adSkipInterval) {
      clearInterval(adSkipInterval);
      adSkipInterval = null;
    }
  }

  // ==================== 强制全屏 ====================
  function forceFullscreen() {
    try {
      var media = findAllMedia(document);
      var video = null;
      for (var i = 0; i < media.length; i++) {
        if (media[i].tagName === 'VIDEO') { video = media[i]; break; }
      }
      if (!video) {
        return { success: false, error: '未找到视频元素' };
      }
      // 解锁全屏 API（确保可用）
      unlockFullscreen();
      // 尝试调用 requestFullscreen
      var el = video;
      // 优先对视频父容器请求全屏（更好的体验）
      if (video.parentElement) el = video.parentElement;
      var req = el.requestFullscreen || el.webkitRequestFullscreen ||
                el.mozRequestFullScreen || el.msRequestFullscreen;
      if (req) {
        req.call(el);
        return { success: true };
      }
      return { success: false, error: '浏览器不支持全屏 API' };
    } catch (e) {
      return { success: false, error: e && e.message ? e.message : '全屏请求异常' };
    }
  }

  // ==================== 视频下载 ====================
  function downloadVideoByUrl(url, filename) {
    try {
      // 通过创建 <a> 标签触发下载
      var a = document.createElement('a');
      a.href = url;
      a.download = filename || 'video.mp4';
      // 必须附加到 DOM 才能在某些浏览器生效
      document.body.appendChild(a);
      a.click();
      setTimeout(function() { document.body.removeChild(a); }, 100);
      return true;
    } catch (e) {
      // 降级：在新标签页打开
      try {
        window.open(url, '_blank');
        return true;
      } catch (err) {
        return false;
      }
    }
  }

  function downloadFirstVideo() {
    try {
      var urls = extractMediaUrls();
      if (!urls || urls.length === 0) {
        return { success: false, error: '未检测到可下载的视频/音频', urls: [] };
      }
      // 优先选择视频
      var videoUrls = urls.filter(function(u) { return u.tag === 'video'; });
      var target = videoUrls[0] || urls[0];
      // 生成文件名
      var filename = 'toolbox-video-' + Date.now();
      try {
        var u = new URL(target.url);
        var pathName = u.pathname.split('/').pop();
        if (pathName && pathName.length > 0) filename = pathName;
      } catch (e) {}
      // 添加扩展名（如果没有）
      if (filename && !/\.\w{2,5}$/.test(filename)) {
        filename += target.tag === 'video' ? '.mp4' : '.mp3';
      }

      // blob:/data: URL 直接用 <a> 标签下载（无法通过 background 下载）
      if (target.url.startsWith('blob:') || target.url.startsWith('data:')) {
        var ok = downloadVideoByUrl(target.url, filename);
        return {
          success: ok,
          url: target.url,
          error: ok ? null : '下载触发失败',
          urls: urls
        };
      }

      // http(s) URL 通过 ISOLATED world 转发给 background 下载（绕过 CORS）
      // ISOLATED world 的消息桥接监听 videoUnlocker:downloadViaBg 并转发给 background
      window.postMessage({
        action: 'videoUnlocker:downloadViaBg',
        data: { url: target.url, filename: filename }
      }, '*');

      return {
        success: true,
        url: target.url,
        error: null,
        urls: urls,
        viaBackground: true
      };
    } catch (e) {
      return { success: false, error: e && e.message ? e.message : '下载异常', urls: [] };
    }
  }

  // ==================== MutationObserver ====================
  let _mutationObserver = null;
  function setupMutationObserver() {
    if (typeof MutationObserver === 'undefined') return;
    _mutationObserver = new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.addedNodes && m.addedNodes.length) {
          for (let j = 0; j < m.addedNodes.length; j++) {
            const n = m.addedNodes[j];
            if (!n || n.nodeType !== 1) continue;
            if (n.tagName === 'VIDEO' || n.tagName === 'AUDIO') unlockMediaControls(n);
            if (n.querySelectorAll) n.querySelectorAll('video, audio').forEach(unlockMediaControls);
            if (n.shadowRoot) findAllMedia(n.shadowRoot).forEach(unlockMediaControls);
          }
        }
        if (m.type === 'attributes' && m.target) {
          if (m.target.tagName === 'VIDEO' || m.target.tagName === 'AUDIO') {
            unlockMediaControls(m.target);
          }
        }
      }
    });
    try {
      _mutationObserver.observe(document.documentElement || document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['src']
      });
    } catch (e) {}
  }

  // ==================== 反劫持 ====================
  function reapplyHijacks() {
    if (!PROTO || !window.__toolboxOriginalMediaDescriptors) return;
    const ORIG = window.__toolboxOriginalMediaDescriptors;
    Object.keys(ORIG).forEach(function (prop) {
      try {
        const cur = Object.getOwnPropertyDescriptor(PROTO, prop);
        if (!cur || !cur.get) {
          const orig = ORIG[prop];
          if (orig) {
            Object.defineProperty(PROTO, prop, {
              configurable: true, enumerable: true,
              get: orig.get, set: orig.set, value: orig.value
            });
          }
        }
      } catch (e) {}
    });
  }

  function startAntiTamper() {
    // 只保留 rAF 循环并降频到每 500ms 执行一次（原实现额外叠加了一个
    // setInterval(reapplyHijacks, 1000) 造成双重冗余，已移除）
    let lastTs = 0;
    function rafLoop(ts) {
      if (ts - lastTs >= 500) {
        lastTs = ts;
        try { reapplyHijacks(); } catch (e) {}
      }
      requestAnimationFrame(rafLoop);
    }
    try { requestAnimationFrame(rafLoop); } catch (e) {}
  }

  // ==================== 与 sidebar/tool 通信 ====================
  function getStatus() {
    const videos = [];
    activeMediaList.forEach(function (m) {
      const d = (window.__toolboxOriginalMediaDescriptors || {})['duration'];
      let dur = NaN;
      try {
        const durDesc = Object.getOwnPropertyDescriptor(
          (window.HTMLMediaElement && window.HTMLMediaElement.prototype) || {}, 'duration'
        );
        if (durDesc && typeof durDesc.get === 'function') dur = durDesc.get.call(m);
      } catch (e) {}
      let curTime = 0;
      try {
        const ctDesc = Object.getOwnPropertyDescriptor(
          (window.HTMLMediaElement && window.HTMLMediaElement.prototype) || {}, 'currentTime'
        );
        if (ctDesc && typeof ctDesc.get === 'function') curTime = ctDesc.get.call(m);
      } catch (e) {}
      videos.push({
        src: (m.currentSrc || m.src || '').substring(0, 200),
        paused: m.paused,
        currentTime: curTime,
        duration: isNaN(dur) ? null : dur,
        videoWidth: m.videoWidth || 0,
        videoHeight: m.videoHeight || 0
      });
    });
    return {
      config: {
        enabled: config.enabled,
        unlockControls: config.unlockControls,
        unlockContextmenu: config.unlockContextmenu,
        unlockFullscreen: config.unlockFullscreen,
        forcePip: config.forcePip,
        skipAds: config.skipAds,
        spoofProgress: config.spoofProgress,
        volumeBoost: config.volumeBoost,
        speedFine: config.speedFine
      },
      videos: videos,
      frame: (window === window.top) ? 'top' : 'child'
    };
  }

  function seekAllTo(seconds) {
    activeMediaList.forEach(function (m) {
      try {
        const ctDesc = Object.getOwnPropertyDescriptor(
          (window.HTMLMediaElement && window.HTMLMediaElement.prototype) || {}, 'currentTime'
        );
        if (ctDesc && ctDesc.set) ctDesc.set.call(m, Number(seconds) || 0);
        else m.currentTime = Number(seconds) || 0;
      } catch (e) {}
    });
  }

  function applyConfig(cfg) {
    if (!cfg) return;
    if (typeof cfg.enabled === 'boolean') config.enabled = cfg.enabled;
    if (typeof cfg.unlockControls === 'boolean') config.unlockControls = cfg.unlockControls;
    if (typeof cfg.unlockContextmenu === 'boolean') config.unlockContextmenu = cfg.unlockContextmenu;
    if (typeof cfg.unlockFullscreen === 'boolean') config.unlockFullscreen = cfg.unlockFullscreen;
    if (typeof cfg.forcePip === 'boolean') config.forcePip = cfg.forcePip;
    if (typeof cfg.skipAds === 'boolean') config.skipAds = cfg.skipAds;
    if (typeof cfg.spoofProgress === 'boolean') config.spoofProgress = cfg.spoofProgress;
    if (typeof cfg.volumeBoost === 'number') config.volumeBoost = cfg.volumeBoost;
    if (typeof cfg.speedFine === 'number') config.speedFine = cfg.speedFine;

    // 解锁控件
    if (config.unlockControls && config.enabled) {
      activeMediaList.forEach(function (m) {
        try { m.controls = true; } catch (e) {}
        try { m.setAttribute('controls', ''); } catch (e) {}
        try { m.removeAttribute('disablepictureinpicture'); } catch (e) {}
      });
    }

    // 画中画
    if (config.forcePip && config.enabled) {
      activeMediaList.forEach(function (m) {
        try { m.removeAttribute('disablepictureinpicture'); } catch (e) {}
        try { m.disablePictureInPicture = false; } catch (e) {}
      });
    }

    // 右键菜单
    if (config.unlockContextmenu && config.enabled) {
      unlockContextMenu();
    }

    // 全屏
    if (config.unlockFullscreen && config.enabled) {
      unlockFullscreen();
    }

    // 自动跳过广告
    if (config.skipAds && config.enabled) {
      startAdSkipper();
    } else {
      stopAdSkipper();
    }

    // 音量增益
    if (config.enabled) {
      activeMediaList.forEach(function (m) {
        updateVolumeBoost(m);
      });
    }

    // 播放速度微调
    if (config.speedFine !== 1 && config.enabled) {
      activeMediaList.forEach(function (m) {
        try { m.playbackRate = config.speedFine; } catch (e) {}
      });
    }
  }

  function restoreAllVideos() {
    // 停止 MutationObserver
    if (_mutationObserver) {
      try { _mutationObserver.disconnect(); } catch (e) {}
      _mutationObserver = null;
    }
    // 停止广告跳过器
    stopAdSkipper();
  }

  function setupMessageBridge() {
    window.addEventListener('message', function (e) {
      if (!e.data) return;
      const d = e.data;
      if (typeof d !== 'object') return;
      const action = d.action || d.type;
      const data = d.data || d.payload || {};
      if (!action) return;

      switch (action) {
        case 'videoUnlocker:setConfig':
          applyConfig(data);
          try {
            (e.source || window.parent).postMessage({
              action: 'videoUnlocker:status',
              data: getStatus()
            }, '*');
          } catch (err) {}
          break;
        case 'videoUnlocker:scan':
          scanAndUnlock();
          try {
            (e.source || window.parent).postMessage({
              action: 'videoUnlocker:scanResult',
              data: { count: activeMediaList.size }
            }, '*');
          } catch (err) {}
          break;
        case 'videoUnlocker:getStatus':
          try {
            (e.source || window.parent).postMessage({
              action: 'videoUnlocker:status',
              data: getStatus()
            }, '*');
          } catch (err) {}
          break;
        case 'videoUnlocker:seekTo':
          seekAllTo(data.time);
          break;
        case 'videoUnlocker:extractUrls':
          try {
            var urls = extractMediaUrls();
            (e.source || window.parent).postMessage({
              action: 'videoUnlocker:extractUrlsResult',
              data: { urls: urls }
            }, '*');
          } catch (err) {}
          break;
        case 'videoUnlocker:forceFullscreen':
          // 强制视频进入浏览器全屏
          try {
            var fsResult = forceFullscreen();
            (e.source || window.parent).postMessage({
              action: 'videoUnlocker:fullscreenResult',
              data: fsResult
            }, '*');
          } catch (err) {
            try {
              (e.source || window.parent).postMessage({
                action: 'videoUnlocker:fullscreenResult',
                data: { success: false, error: '全屏请求异常' }
              }, '*');
            } catch (e2) {}
          }
          break;
        case 'videoUnlocker:downloadVideo':
          // 提取URL并触发下载
          try {
            var dlResult = downloadFirstVideo();
            (e.source || window.parent).postMessage({
              action: 'videoUnlocker:downloadResult',
              data: dlResult
            }, '*');
          } catch (err) {
            try {
              (e.source || window.parent).postMessage({
                action: 'videoUnlocker:downloadResult',
                data: { success: false, error: '下载异常', urls: [] }
              }, '*');
            } catch (e2) {}
          }
          break;
        case 'videoUnlocker:ping':
          try {
            (e.source || window.parent).postMessage({
              action: 'videoUnlocker:pong',
              data: { ready: true, version: 3 }
            }, '*');
          } catch (err) {}
          break;
        case 'masterSwitchOff':
          if (e.data && e.data.source === 'toolbox') {
            activated = false;
            try { restoreAllVideos(); } catch (err) {}
          }
          break;
        case 'masterSwitchOn':
          if (config.enabled && !activated) activate();
          break;
      }
    });
  }

  // ==================== 启动 ====================
  let activated = false;

  function activate() {
    if (activated) return;
    activated = true;
    try { scanAndUnlock(); } catch (e) {}
    // 刷新后（无 videoUnlocker:setConfig 消息）也要按配置应用右键/全屏解锁
    if (config.unlockContextmenu && config.enabled) {
      try { unlockContextMenu(); } catch (e) {}
    }
    if (config.unlockFullscreen && config.enabled) {
      try { unlockFullscreen(); } catch (e) {}
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        try { scanAndUnlock(); } catch (e) {}
      });
    }
    window.addEventListener('load', function () {
      try { scanAndUnlock(); } catch (e) {}
    });
    try { setupMutationObserver(); } catch (e) {}
    try { startAntiTamper(); } catch (e) {}
    try {
      window.postMessage({ __toolbox_unlocker: true, version: 3 }, '*');
    } catch (e) {}
  }

  function start() {
    try { setupMessageBridge(); } catch (e) {}
    if (config.enabled) activate();
  }

  const _originalApplyConfig = applyConfig;
  applyConfig = function(cfg) {
    _originalApplyConfig(cfg);
    if (config.enabled && !activated) activate();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
