/**
 * 自动连播 - Auto Play Next v3.0
 * 运行在 ISOLATED world, document_start, all_frames: true
 *
 * v3.0 改进:
 *  - 多重视频完成检测: ended + nearEnd(接近结尾) + pauseAtEnd(结尾暂停) + DOM完成态检测
 *  - 智能等待: 视频接近结尾时提前准备，减少切换延迟
 *  - 平台适配更健壮: 不只依赖CSS选择器，还检测DOM完成态(重播按钮、结束遮罩等)
 *  - 跨域iframe: 通过URL匹配 + 定时轮询检测视频完成
 *  - 自定义选择器: 用户可以手动指定"下一集"按钮的CSS选择器
 */
(function() {
  'use strict';

  if (window.__toolboxAutoPlayNextV3) return;
  window.__toolboxAutoPlayNextV3 = true;

  const IS_TOP = window.top === window.self;
  const MSG_SOURCE = '__toolbox_apn';

  // ==================== 配置 ====================
  const DEFAULT_CONFIG = {
    enabled: false,
    delay: 3,
    autoReplay: false,
    clickNextButton: true,
    skipIntro: false,     // 自动跳过片头/片尾
    count: 0,
    customSelector: '',   // 用户自定义"下一集"按钮选择器
    nearEndThreshold: 3,  // 提前N秒判定"接近结尾"
    excludeDomains: '',   // 排除域名（逗号或换行分隔）
  };

  let config = { ...DEFAULT_CONFIG };
  let countdownTimer = null;
  let countdownNotification = null;
  let advanceScheduled = false; // 防止重复触发

  // ==================== 存储读取 ====================
  function loadConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get('toolbox_auto_play_next', (result) => {
          if (result.toolbox_auto_play_next) {
            config = { ...DEFAULT_CONFIG, ...result.toolbox_auto_play_next };
          }
          resolve(config);
        });
      } catch (e) { resolve(config); }
    });
  }

  loadConfig().then((cfg) => {
    if (cfg.enabled && !isDomainExcluded()) init();
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.toolbox_auto_play_next) {
        const newConfig = changes.toolbox_auto_play_next.newValue;
        const oldSkipIntro = config.skipIntro;
        const oldEnabled = config.enabled;
        config = newConfig ? { ...DEFAULT_CONFIG, ...newConfig } : { ...DEFAULT_CONFIG };
        if (config.enabled && !initialized && !isDomainExcluded()) init();
        // 动态启停跳过片头/片尾检测
        if (config.skipIntro && config.enabled && initialized) {
          startSkipIntroOutro();
        } else if (!config.skipIntro || !config.enabled) {
          stopSkipIntroOutro();
        }
      }
    });
  } catch (e) {}

  // ==================== 排除域名检测 ====================
  function isDomainExcluded() {
    if (!config.excludeDomains) return false;
    const currentHost = window.location.hostname;
    const domains = config.excludeDomains.split(/[\n,;]+/).map(d => d.trim()).filter(Boolean);
    return domains.some(d => {
      // 支持通配符: *.example.com 匹配 sub.example.com
      if (d.startsWith('*.')) {
        const base = d.slice(2);
        return currentHost === base || currentHost.endsWith('.' + base);
      }
      return currentHost === d || currentHost.endsWith('.' + d);
    });
  }

  // ==================== 检测通知 ====================
  function notifyDetection(method) {
    try {
      window.postMessage({
        action: 'apn:detectionTriggered',
        data: { method: method }
      }, '*');
    } catch (e) {}
  }

  function notifyLog(message) {
    try {
      // 写入 storage 以便 tool UI 同步
      chrome.storage.local.get('toolbox_auto_play_next', (result) => {
        const current = result.toolbox_auto_play_next || {};
        current._lastLog = message;
        chrome.storage.local.set({ toolbox_auto_play_next: current });
      });
    } catch (e) {}
  }

  // 通知UI下一集检测结果
  function notifyNextFound(found) {
    try {
      window.postMessage({
        action: 'apn:nextFound',
        data: { found: found }
      }, '*');
    } catch (e) {}
  }

  // ==================== 初始化 ====================
  let initialized = false;
  const mediaElements = new WeakSet();
  const mediaStateMap = new WeakMap(); // 存储每个媒体元素的监控状态

  function init() {
    if (initialized) return;
    initialized = true;

    scanMediaElements(document);

    // MutationObserver 监听动态添加的元素
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scanMediaElements(node);
            if (node.shadowRoot) {
              scanMediaElements(node.shadowRoot);
              observeShadowRoot(node.shadowRoot);
            }
          }
        }
      }
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    document.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) {
        scanMediaElements(el.shadowRoot);
        observeShadowRoot(el.shadowRoot);
      }
    });

    interceptSPANavigation();

    // 启动跳过片头/片尾检测
    if (config.skipIntro) startSkipIntroOutro();

    if (IS_TOP) setupTopMessageListener();
  }

  // ==================== 跳过片头/片尾 ====================
  // 检测"跳过片头"/"跳过片尾"/"Skip Intro"/"Skip Recap"按钮并自动点击
  const SKIP_INTRO_SELECTORS = [
    // Netflix 风格
    '.skip-credits a', '.skip-credits button',
    '[data-uia="player-skip-intro"]', '[data-uia="player-skip-recap"]',
    // 通用 class 匹配
    '[class*="skip-intro" i]', '[class*="skip-opening" i]',
    '[class*="skip-recap" i]', '[class*="skip-outro" i]',
    '[class*="skip-intro-button" i]', '[class*="skip__button" i]',
    // 各平台
    '.bullet-skip', '.opening-skip', '.skip-btn',
    '[aria-label*="skip" i]', '[aria-label*="跳过" i]',
    '[title*="跳过片头"]', '[title*="跳过片尾"]',
    '[title*="Skip Intro" i]', '[title*="Skip Recap" i]'
  ];

  // 匹配"跳过片头"/"跳过片尾"等文本
  const SKIP_INTRO_TEXT_PATTERNS = /跳过片头|跳过片尾|跳过开头|跳过回顾|跳过片头曲|跳过片尾曲|skip\s*intro|skip\s*recap|skip\s*opening|skip\s*outro|skip\s*credits/i;

  let skipIntroObserver = null;
  let skipIntroInterval = null;

  function tryClickSkipButton() {
    if (!config.skipIntro || !config.enabled) return;

    const roots = getAllRoots();
    for (const root of roots) {
      // 1. 通过 CSS 选择器匹配
      for (const selector of SKIP_INTRO_SELECTORS) {
        try {
          const els = root.querySelectorAll(selector);
          for (const el of els) {
            if (isVisible(el)) {
              el.click();
              notifyLog('已跳过片头/片尾');
              return true;
            }
          }
        } catch (e) {}
      }

      // 2. 通过文本匹配
      try {
        const clickables = root.querySelectorAll('button, a, [role="button"], [onclick], div[class*="skip" i]');
        for (const el of clickables) {
          if (!isVisible(el)) continue;
          const text = (el.textContent || '').trim();
          if (text.length > 0 && text.length < 20 && SKIP_INTRO_TEXT_PATTERNS.test(text)) {
            el.click();
            notifyLog('已跳过片头/片尾');
            return true;
          }
        }
      } catch (e) {}
    }
    return false;
  }

  function startSkipIntroOutro() {
    if (skipIntroObserver || skipIntroInterval) return;
    // 立即检测一次
    tryClickSkipButton();

    // MutationObserver 监听动态出现的跳过按钮
    try {
      skipIntroObserver = new MutationObserver(function() {
        tryClickSkipButton();
      });
      skipIntroObserver.observe(document.documentElement || document, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style']
      });
    } catch (e) {}

    // 定时检测兜底（部分平台按钮延迟出现）
    skipIntroInterval = setInterval(tryClickSkipButton, 1000);
  }

  function stopSkipIntroOutro() {
    if (skipIntroObserver) {
      try { skipIntroObserver.disconnect(); } catch (e) {}
      skipIntroObserver = null;
    }
    if (skipIntroInterval) {
      clearInterval(skipIntroInterval);
      skipIntroInterval = null;
    }
  }

  function observeShadowRoot(shadowRoot) {
    try {
      const obs = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) scanMediaElements(node);
          }
        }
      });
      obs.observe(shadowRoot, { childList: true, subtree: true });
    } catch (e) {}
  }

  // ==================== 媒体元素扫描 ====================
  function scanMediaElements(root) {
    try {
      root.querySelectorAll('video, audio').forEach(el => bindMediaElement(el));
    } catch (e) {}
  }

  function bindMediaElement(el) {
    if (mediaElements.has(el)) return;
    mediaElements.add(el);

    const state = { nearEndFired: false, endedFired: false, lastTimeUpdate: 0, lastSrc: '' };
    mediaStateMap.set(el, state);

    // 检测src变化 — 同一video元素换源时重置状态（SPA导航常见）
    try { state.lastSrc = el.currentSrc || el.src || ''; } catch(e) {}

    // 播放时重置advanceScheduled（新视频开始播放说明上一个已成功切换）
    el.addEventListener('play', () => {
      if (advanceScheduled) {
        try {
          const curSrc = el.currentSrc || el.src || '';
          if (curSrc !== state.lastSrc) {
            state.lastSrc = curSrc;
            state.nearEndFired = false;
            state.endedFired = false;
            advanceScheduled = false;
          }
        } catch(e) {}
      }
    }, false);

    // duration变化时重置状态（新视频加载）
    el.addEventListener('durationchange', () => {
      try {
        const curSrc = el.currentSrc || el.src || '';
        if (curSrc !== state.lastSrc) {
          state.lastSrc = curSrc;
          state.nearEndFired = false;
          state.endedFired = false;
          advanceScheduled = false;
        }
      } catch(e) {}
    }, false);

    // loadedmetadata — 新视频元数据加载完成，重置状态
    el.addEventListener('loadedmetadata', () => {
      state.nearEndFired = false;
      state.endedFired = false;
    }, false);

    // 事件1: ended — 标准完成事件
    el.addEventListener('ended', () => {
      if (!config.enabled) return;
      state.endedFired = true;
      onMediaCompleted(el, 'ended');
    }, false);

    // 事件2: timeupdate — 检测接近结尾
    el.addEventListener('timeupdate', () => {
      if (!config.enabled || state.nearEndFired || state.endedFired) return;
      try {
        const cur = el.currentTime;
        const dur = el.duration;
        // 跳过无效duration（直播流或未加载完成）
        if (!isFinite(dur) || dur <= 0 || cur <= 0) return;
        if ((dur - cur) <= config.nearEndThreshold) {
          state.nearEndFired = true;
          onMediaCompleted(el, 'nearEnd');
        }
      } catch (e) {}
    }, false);

    // 事件3: pause — 检测在结尾处暂停（很多平台不会触发ended，而是在结尾pause）
    el.addEventListener('pause', () => {
      if (!config.enabled || state.endedFired) return;
      try {
        const cur = el.currentTime;
        const dur = el.duration;
        if (!isFinite(dur) || dur <= 0 || cur <= 0) return;
        // 视频在接近结尾处暂停，视为"播放完成"
        if ((dur - cur) <= 1.5) {
          state.endedFired = true;
          onMediaCompleted(el, 'pauseAtEnd');
        }
      } catch (e) {}
    }, false);

    // 事件4: error — 视频加载失败也尝试跳下一个
    el.addEventListener('error', () => {
      if (!config.enabled) return;
      if (el.error && el.error.code !== MediaError.MEDIA_ERR_ABORTED) {
        setTimeout(() => onMediaCompleted(el, 'error'), 1000);
      }
    }, false);

    // 事件5: seeked — 如果seek到结尾附近，也可能表示完成
    el.addEventListener('seeked', () => {
      if (!config.enabled || state.endedFired || state.nearEndFired) return;
      try {
        const cur = el.currentTime;
        const dur = el.duration;
        if (!isFinite(dur) || dur <= 0 || cur <= 0) return;
        if ((dur - cur) <= 0.5) {
          state.nearEndFired = true;
          onMediaCompleted(el, 'seekedToEnd');
        }
      } catch (e) {}
    }, false);

    // 事件6: waiting — 视频在结尾附近卡顿等待缓冲，可能已结束
    el.addEventListener('waiting', () => {
      if (!config.enabled || state.endedFired || state.nearEndFired) return;
      try {
        const cur = el.currentTime;
        const dur = el.duration;
        if (!isFinite(dur) || dur <= 0 || cur <= 0) return;
        if ((dur - cur) <= 0.5) {
          state.nearEndFired = true;
          onMediaCompleted(el, 'waitingAtEnd');
        }
      } catch (e) {}
    }, false);
  }

  // ==================== 媒体完成处理 ====================
  function onMediaCompleted(media, reason) {
    if (advanceScheduled) return; // 防止重复触发

    // 检查排除域名：必须在置位 advanceScheduled 之前返回。
    // 否则在排除域名下 advanceScheduled 会永久停留在 true，
    // 之后即便用户取消该域名的排除，本帧也无法再触发连播。
    if (isDomainExcluded()) return;

    advanceScheduled = true;

    // 通知检测方式
    notifyDetection(reason);
    notifyLog('视频完成检测: ' + reason);

    // 重置标记（延迟需覆盖完整的重试窗口，避免把待执行的重试一起取消）
    const state = mediaStateMap.get(media);
    const resetFlags = () => {
      if (state) {
        state.nearEndFired = false;
        state.endedFired = false;
      }
      advanceScheduled = false;
    };
    // 未登记状态的媒体走异常路径时同样需要兜底重置，避免 advanceScheduled 永久为 true
    setTimeout(resetFlags, ADVANCE_RESET_DELAY_MS);

    if (IS_TOP) {
      handleVideoCompleted(media, reason);
    } else {
      try {
        window.top.postMessage({
          source: MSG_SOURCE,
          type: 'videoCompleted',
          reason: reason,
          src: (media.currentSrc || media.src || '').substring(0, 200)
        }, '*');
      } catch (e) {
        handleVideoCompleted(media, reason);
      }
    }
  }

  // 顶层页面监听 iframe 消息
  function setupTopMessageListener() {
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.source !== MSG_SOURCE) return;
      if (e.data.type === 'videoCompleted' || e.data.type === 'videoEnded') {
        if (!config.enabled) return;
        clearCountdown();
        if (config.delay > 0) {
          showCountdown(config.delay, () => advanceToNext(), () => removeNotification());
        } else {
          advanceToNext();
        }
      }
    });
  }

  function handleVideoCompleted(media, reason) {
    clearCountdown();
    if (config.delay > 0) {
      showCountdown(config.delay, () => advanceToNext(media), () => removeNotification());
    } else {
      advanceToNext(media);
    }
  }

  // ==================== 查找下一个视频策略 ====================
  let retryCount = 0;
  const MAX_RETRIES = 3;
  const RETRY_INTERVAL_MS = 2000;
  // 重置延迟必须严格大于"最后一次重试的触发时刻"(MAX_RETRIES * RETRY_INTERVAL_MS)。
  // 原实现固定 5000ms，而第 3 次重试在 6000ms 才触发，届时 advanceScheduled 已被
  // 置回 false，重试的守卫条件不成立 → 最后一次重试被静默丢弃。
  const ADVANCE_RESET_DELAY_MS = MAX_RETRIES * RETRY_INTERVAL_MS + 2000;

  async function advanceToNext(media) {
    let success = false;

    // Strategy 0: 用户自定义选择器
    if (config.customSelector) {
      success = tryCustomSelector();
      if (success) { incrementCount(); showAdvanceNotification(); notifyLog('连播成功: 自定义选择器'); notifyDetection('customSelector'); notifyNextFound(true); retryCount = 0; return; }
    }

    // Strategy 1: 检测DOM完成态（重播按钮、结束遮罩等）
    success = tryDOMCompletionNext();
    if (success) { incrementCount(); showAdvanceNotification(); notifyLog('连播成功: DOM完成态'); notifyDetection('domCompletion'); notifyNextFound(true); retryCount = 0; return; }

    // Strategy 2: 文本匹配"下一集"按钮（通用，不依赖CSS选择器）
    success = tryTextBasedNext();
    if (success) { incrementCount(); showAdvanceNotification(); notifyLog('连播成功: 文本匹配'); notifyNextFound(true); retryCount = 0; return; }

    // Strategy 3: 网课/视频平台专用策略
    success = await tryPlatformSpecificNext();
    if (success) { incrementCount(); showAdvanceNotification(); notifyLog('连播成功: 平台适配'); notifyNextFound(true); retryCount = 0; return; }

    // Strategy 4: 点击"下一集"按钮（CSS选择器匹配）
    if (config.clickNextButton) {
      success = await tryClickNextButton();
      if (success) { incrementCount(); showAdvanceNotification(); notifyLog('连播成功: 下一集按钮'); notifyNextFound(true); retryCount = 0; return; }
    }

    // Strategy 5: 在播放列表中找到下一项
    success = tryPlaylistNext();
    if (success) { incrementCount(); showAdvanceNotification(); notifyLog('连播成功: 播放列表'); notifyNextFound(true); retryCount = 0; return; }

    // Strategy 6: 课程目录下一节
    success = tryCourseCatalogNext();
    if (success) { incrementCount(); showAdvanceNotification(); notifyLog('连播成功: 课程目录'); notifyNextFound(true); retryCount = 0; return; }

    // Strategy 7: 键盘快捷键模拟（兜底）
    success = tryKeyboardShortcut();
    if (success) { incrementCount(); showAdvanceNotification(); notifyLog('连播成功: 键盘快捷键'); notifyNextFound(true); retryCount = 0; return; }

    // 所有策略都失败，尝试重试（下一集按钮可能延迟出现）
    retryCount++;
    if (retryCount <= MAX_RETRIES) {
      notifyLog('未找到下一集，' + (retryCount * RETRY_INTERVAL_MS / 1000) + '秒后重试 (' + retryCount + '/' + MAX_RETRIES + ')');
      notifyNextFound(false);
      setTimeout(() => {
        // advanceScheduled 由 ADVANCE_RESET_DELAY_MS 统一重置，其延迟已覆盖全部重试窗口
        if (config.enabled && advanceScheduled) {
          advanceToNext(media);
        }
      }, retryCount * RETRY_INTERVAL_MS);
      return;
    }

    // 重试耗尽，检查是否自动重播
    retryCount = 0;
    if (config.autoReplay && media) {
      try {
        media.currentTime = 0;
        media.play();
      } catch (e) {}
      notifyLog('未找到下一集，自动重播');
      notifyNextFound(false);
    } else {
      showNoNextNotification();
      notifyLog('未找到下一个视频');
      notifyNextFound(false);
    }
  }

  // ==================== Strategy 0: 用户自定义选择器 ====================
  function tryCustomSelector() {
    if (!config.customSelector) return false;
    try {
      const el = document.querySelector(config.customSelector);
      if (el && isVisible(el)) {
        el.click();
        return true;
      }
      // 在iframe中也尝试
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          if (iframe.contentDocument) {
            const iel = iframe.contentDocument.querySelector(config.customSelector);
            if (iel) { iel.click(); return true; }
          }
        } catch (e) {}
      }
    } catch (e) {}
    return false;
  }

  // ==================== Strategy 1: DOM完成态检测 ====================
  // 很多平台在视频完成时会显示特定的UI元素（重播按钮、完成遮罩等）
  // 这些元素的出现比ended事件更可靠
  function tryDOMCompletionNext() {
    const completionSelectors = [
      // 通用重播/完成遮罩
      '[class*="replay" i]', '[class*="re-play" i]',
      '[class*="completed" i]', '[class*="finish" i]',
      '[class*="end-overlay" i]', '[class*="video-end" i]',
      '[class*="play-again" i]',
      // B站完播界面中的"下一个"按钮
      '.bilibili-player-video-btn-next',
      '.squirtle-controller-next',
      '.bpx-player-ending-related-item',
      '.bpx-player-ctrl-next',
      // YouTube
      '.ytp-next-button', 'a.ytp-next-button',
      // 优酷
      '[data-spm="next"]', '.yk-next', '.ykplayer-next-btn',
      // 爱奇艺
      '[data-player-hook="next"]', '.iqiyi-player-next', '.iqp-btn-next',
      // 腾讯视频
      '.tx-player-next', '.txp-next', '.txp_btn_next',
      // 芒果TV
      '.mgtv-next-btn', '.mg-next',
      // 各种"下一节"弹窗
      '[class*="next-episode" i]', '[class*="next-lesson" i]',
      '[class*="auto-play" i] [class*="next" i]',
      // 学习通/超星 完成弹窗
      '.jobFinish', '.complete-point',
      // 雨课堂
      '[class*="rain" i] [class*="next" i]',
      // 知道/智慧树完成提示
      '[class*="passed" i]',
    ];

    const roots = getAllRoots();
    for (const root of roots) {
      for (const selector of completionSelectors) {
        try {
          const el = root.querySelector(selector);
          if (el && isVisible(el)) {
            // 如果是"重播"按钮，跳过（不要重播，要找"下一个"）
            const text = (el.textContent || '').trim().toLowerCase();
            if (/重播|replay|再次播放/.test(text)) continue;
            el.click();
            return true;
          }
        } catch (e) {}
      }

      // 检测完成弹窗中的"下一节"或"确定"按钮
      try {
        const modals = root.querySelectorAll('[class*="modal" i], [class*="dialog" i], [class*="popup" i], [role="dialog"]');
        for (const modal of modals) {
          if (!isVisible(modal)) continue;
          const btns = modal.querySelectorAll('button, a, [role="button"], [onclick]');
          for (const btn of btns) {
            const text = (btn.textContent || '').trim();
            if (/下一|继续|next|next/i.test(text) && isVisible(btn)) {
              btn.click();
              return true;
            }
          }
        }
      } catch (e) {}
    }

    return false;
  }

  // ==================== Strategy 2: 文本匹配"下一集"按钮 ====================
  // 通用策略：扫描所有可点击元素的文本内容，匹配"下一集"等关键词
  // 不依赖CSS选择器，适用于所有平台
  function tryTextBasedNext() {
    // 匹配"下一集"/"下一节"/"下一话"/"下集"/"next"等文本
    const nextPatterns = /下一集|下一节|下一话|下一章|下一课|下一讲|下一 part|下集|next\s*(?:ep|episode|video|chapter|lesson|part)|^\s*next\s*$/i;
    // 排除"上一个"/"上一集"等
    const excludePatterns = /上一|previous|prev/i;

    const roots = getAllRoots();
    for (const root of roots) {
      try {
        // 扫描所有可点击元素：button, a, [role=button], [onclick], 以及带class含"next"的元素
        const clickables = root.querySelectorAll('button, a, [role="button"], [onclick], [class*="next" i], [class*="next-btn" i]');
        for (const el of clickables) {
          if (!isVisible(el)) continue;
          // 获取元素的文本内容（含子元素）
          const text = (el.textContent || el.innerText || '').trim();
          if (!text || text.length > 30) continue; // 跳过过长文本（可能是正文）
          if (excludePatterns.test(text)) continue;
          if (nextPatterns.test(text)) {
            el.click();
            return true;
          }
          // 检查 title/aria-label 属性
          const title = el.getAttribute('title') || el.getAttribute('aria-label') || '';
          if (title && title.length < 30 && !excludePatterns.test(title) && nextPatterns.test(title)) {
            el.click();
            return true;
          }
        }

        // 也检查弹窗/对话框中的按钮
        const modals = root.querySelectorAll('[class*="modal" i], [class*="dialog" i], [class*="popup" i], [role="dialog"]');
        for (const modal of modals) {
          if (!isVisible(modal)) continue;
          const btns = modal.querySelectorAll('button, a, [role="button"], [onclick]');
          for (const btn of btns) {
            if (!isVisible(btn)) continue;
            const text = (btn.textContent || '').trim();
            if (!text || text.length > 30) continue;
            if (excludePatterns.test(text)) continue;
            // 在弹窗中"确定"/"继续"也可能是下一集
            if (nextPatterns.test(text) || /^确定$|^继续$|^确认$/i.test(text)) {
              btn.click();
              return true;
            }
          }
        }
      } catch (e) {}
    }
    return false;
  }

  // ==================== Strategy 3: 网课/视频平台专用 ====================
  async function tryPlatformSpecificNext() {
    const url = window.location.href;

    // 超星/学习通
    if (/chaoxing\.com|edu\.cn.*course|fanya|mooc1/.test(url)) {
      return tryChaoxingNext();
    }
    // 智慧树
    if (/zhihuishu\.com/.test(url)) {
      return tryZhihuishuNext();
    }
    // 中国大学MOOC
    if (/icourse163/.test(url)) {
      return tryIcourse163Next();
    }
    // 学堂在线
    if (/xuetangx/.test(url)) {
      return tryXuetangxNext();
    }
    // 雨课堂
    if (/yuketang/.test(url)) {
      return tryYuketangNext();
    }
    // 优酷
    if (/youku\.com/.test(url)) {
      return tryYoukuNext();
    }
    // 爱奇艺
    if (/iqiyi\.com/.test(url)) {
      return tryIqiyiNext();
    }
    // 腾讯视频
    if (/v\.qq\.com|qq\.com\/x/.test(url)) {
      return tryQqVideoNext();
    }
    // 芒果TV
    if (/mgtv\.com/.test(url)) {
      return tryMgtvNext();
    }

    return false;
  }

  /**
   * 超星/学习通
   * 结构: 视频在iframe中，目录在父页面侧边栏
   * 关键: 需要在顶层页面操作目录
   */
  async function tryChaoxingNext() {
    // 1. 尝试点击"下一节"按钮
    const nextBtns = [
      '.prev_next a:last-child', '.jb_btn', '#nextBtn',
      '[title="下一页"]', '[title="下一节"]',
      'span.icon-next', '.next_btn'
    ];
    for (const sel of nextBtns) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) { btn.click(); return true; }
      } catch (e) {}
    }

    // 2. 在课程目录中找下一节
    const catalogSelectors = [
      '.chapter_item', '.catalog_li', '.pos_catalog_name',
      '.chapter_item_target', '[class*="catalog"] li',
      '[class*="chapter"] li', '.celllist li', '.timeline li',
      '.jobResouce', '.knowledge-card'
    ];
    for (const selector of catalogSelectors) {
      try {
        const items = document.querySelectorAll(selector);
        if (items.length === 0) continue;
        for (let i = 0; i < items.length - 1; i++) {
          const item = items[i];
          if (isActiveItem(item)) {
            const nextItem = items[i + 1];
            const clickTarget = nextItem.querySelector('a') ||
                               nextItem.querySelector('span[class*="title"]') ||
                               nextItem.querySelector('[onclick]') || nextItem;
            clickTarget.click();
            return true;
          }
        }
      } catch (e) {}
    }

    // 3. 尝试在iframe中找下一节按钮
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const doc = iframe.contentDocument;
          if (!doc) continue;
          for (const sel of nextBtns) {
            const btn = doc.querySelector(sel);
            if (btn) { btn.click(); return true; }
          }
        } catch (e) {}
      }
    } catch (e) {}

    // 4. 尝试查找"小节"标签页中的下一个
    try {
      const tabs = document.querySelectorAll('.tab_item, .section-item, [class*="task"] li');
      for (let i = 0; i < tabs.length - 1; i++) {
        if (isActiveItem(tabs[i])) {
          const next = tabs[i + 1];
          const link = next.querySelector('a') || next.querySelector('[onclick]') || next;
          link.click();
          return true;
        }
      }
    } catch (e) {}

    return false;
  }

  async function tryZhihuishuNext() {
    for (const sel of ['.nextBtn', '#nextBtn', '.next_btn', '.nextBtnWrap']) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) { btn.click(); return true; }
      } catch (e) {}
    }

    const selectors = ['.source-list li', '.video-list li', '.file-list li', '[class*="chapter"] li', '[class*="lesson"] li'];
    for (const selector of selectors) {
      try {
        const items = document.querySelectorAll(selector);
        if (items.length === 0) continue;
        for (let i = 0; i < items.length - 1; i++) {
          if (isActiveItem(items[i])) {
            const next = items[i + 1];
            (next.querySelector('a') || next).click();
            return true;
          }
        }
      } catch (e) {}
    }
    return false;
  }

  async function tryIcourse163Next() {
    for (const sel of ['.j-next', '.next-btn', '.nextBtn', '[class*="next"]']) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) { btn.click(); return true; }
      } catch (e) {}
    }
    try {
      const lessons = document.querySelectorAll('.u-learnLesson, .chapter-item, .lesson-item');
      for (let i = 0; i < lessons.length - 1; i++) {
        if (isActiveItem(lessons[i])) {
          const next = lessons[i + 1];
          (next.querySelector('a') || next).click();
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  async function tryXuetangxNext() {
    for (const sel of ['.next_btn', '.nextBtn', '#nextBtn', '.next']) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) { btn.click(); return true; }
      } catch (e) {}
    }
    try {
      const units = document.querySelectorAll('.course-unit, .chapter li, [class*="unit"] li');
      for (let i = 0; i < units.length - 1; i++) {
        if (isActiveItem(units[i])) {
          const next = units[i + 1];
          (next.querySelector('a') || next).click();
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  async function tryYuketangNext() {
    // 雨课堂的"下一节"按钮
    for (const sel of ['.next-btn', '.nextBtn', '[class*="next"]', '[class*="next-lesson"]']) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) { btn.click(); return true; }
      } catch (e) {}
    }
    try {
      const items = document.querySelectorAll('[class*="lesson"] li, [class*="chapter"] li, [class*="section"] li');
      for (let i = 0; i < items.length - 1; i++) {
        if (isActiveItem(items[i])) {
          const next = items[i + 1];
          (next.querySelector('a') || next).click();
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  // ==================== 视频网站平台适配 ====================

  /**
   * 优酷 (youku.com)
   * 下一集按钮通常在播放器控制栏，支持键盘快捷键和点击
   */
  async function tryYoukuNext() {
    // 优酷"下一集"按钮选择器
    const nextBtnSelectors = [
      '[data-spm="next"]', '.next-btn', '.yk-next',
      '.ykplayer-next-btn', '.player-next-btn',
      'button[title*="下一"]', 'a[title*="下一"]',
      '.control-next', '.next-episode-btn',
      // 优酷新版播放器
      '.yk-player .next', '.yk-player [class*="next"]'
    ];
    for (const sel of nextBtnSelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) { btn.click(); return true; }
      } catch (e) {}
    }
    // 优酷剧集列表
    const playlistSelectors = [
      '.episode-list li', '.yk-episode li', '.series-list li',
      '[class*="episode" i] li', '[class*="drama" i] li'
    ];
    for (const selector of playlistSelectors) {
      try {
        const items = document.querySelectorAll(selector);
        if (items.length === 0) continue;
        for (let i = 0; i < items.length - 1; i++) {
          if (isActiveItem(items[i])) {
            const next = items[i + 1];
            (next.querySelector('a') || next).click();
            return true;
          }
        }
      } catch (e) {}
    }
    return false;
  }

  /**
   * 爱奇艺 (iqiyi.com)
   * 下一集按钮在播放器控制栏
   */
  async function tryIqiyiNext() {
    const nextBtnSelectors = [
      '[data-player-hook="next"]', '.iqiyi-player-next',
      '.next-btn', '.next-episode-btn',
      'button[title*="下一"]', 'a[title*="下一"]',
      '.player-next', '.qp-player-next',
      // 爱奇艺新版
      '.iqp-btn-next', '[class*="next-episode" i]'
    ];
    for (const sel of nextBtnSelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) { btn.click(); return true; }
      } catch (e) {}
    }
    // 爱奇艺剧集列表
    const playlistSelectors = [
      '.episode-list li', '.iqiyi-episode li', '.drama-list li',
      '[class*="episode" i] li', '[class*="album" i] li'
    ];
    for (const selector of playlistSelectors) {
      try {
        const items = document.querySelectorAll(selector);
        if (items.length === 0) continue;
        for (let i = 0; i < items.length - 1; i++) {
          if (isActiveItem(items[i])) {
            const next = items[i + 1];
            (next.querySelector('a') || next).click();
            return true;
          }
        }
      } catch (e) {}
    }
    return false;
  }

  /**
   * 腾讯视频 (v.qq.com)
   * 下一集按钮在播放器控制栏
   */
  async function tryQqVideoNext() {
    const nextBtnSelectors = [
      '.tx-player-next', '.txp-next', '.txp_btn_next',
      '.next-btn', '.next-episode-btn',
      'button[title*="下一"]', 'a[title*="下一"]',
      // 腾讯视频新版
      '.txp-controls [class*="next"]', '[data-role="next"]'
    ];
    for (const sel of nextBtnSelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) { btn.click(); return true; }
      } catch (e) {}
    }
    // 腾讯视频剧集列表
    const playlistSelectors = [
      '.episode-list li', '.episode-item', '.qq-episode li',
      '[class*="episode" i] li', '.mod_episode li'
    ];
    for (const selector of playlistSelectors) {
      try {
        const items = document.querySelectorAll(selector);
        if (items.length === 0) continue;
        for (let i = 0; i < items.length - 1; i++) {
          if (isActiveItem(items[i])) {
            const next = items[i + 1];
            (next.querySelector('a') || next).click();
            return true;
          }
        }
      } catch (e) {}
    }
    return false;
  }

  /**
   * 芒果TV (mgtv.com)
   * 下一集按钮在播放器控制栏
   */
  async function tryMgtvNext() {
    const nextBtnSelectors = [
      '.mgtv-next-btn', '.mg-next', '.player-next-btn',
      '.next-btn', '.next-episode-btn',
      'button[title*="下一"]', 'a[title*="下一"]',
      // 芒果TV新版
      '.mg-player [class*="next"]', '[data-target="next"]'
    ];
    for (const sel of nextBtnSelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && isVisible(btn)) { btn.click(); return true; }
      } catch (e) {}
    }
    // 芒果TV剧集列表
    const playlistSelectors = [
      '.episode-list li', '.mgtv-episode li', '.mg-episode li',
      '[class*="episode" i] li', '.spec-part li'
    ];
    for (const selector of playlistSelectors) {
      try {
        const items = document.querySelectorAll(selector);
        if (items.length === 0) continue;
        for (let i = 0; i < items.length - 1; i++) {
          if (isActiveItem(items[i])) {
            const next = items[i + 1];
            (next.querySelector('a') || next).click();
            return true;
          }
        }
      } catch (e) {}
    }
    return false;
  }

  // ==================== Strategy 3: 点击"下一集"按钮 ====================
  const NEXT_BUTTON_SELECTORS = [
    '[aria-label*="next" i]', '[aria-label*="下一" i]',
    '.next', '.next-btn', '.btn-next', '[class*="next" i]', '[id*="next" i]',
    'a[title*="next" i]', 'a[title*="下一" i]',
    'button[title*="next" i]', 'button[title*="下一" i]',
    '.pagination .next a', '.player-next', '.video-next',
    '.course-next', '.lesson-next', '.chapter-next',
    '[data-action="next"]', '[data-next]',
    '.next-episode', '.next-lesson', '.next-video',
    // B站
    '.bilibili-player-video-btn-next', '.squirtle-controller-next',
    '.bpx-player-ctrl-next', '.bpx-player-ending-related-item',
    // YouTube
    '.ytp-next-button', 'a.ytp-next-button',
    // 优酷
    '[data-spm="next"]', '.yk-next', '.ykplayer-next-btn',
    // 爱奇艺
    '[data-player-hook="next"]', '.iqiyi-player-next', '.iqp-btn-next',
    // 腾讯视频
    '.tx-player-next', '.txp-next', '.txp_btn_next',
    // 芒果TV
    '.mgtv-next-btn', '.mg-next',
    // 各平台
    '.j-next', '.next_btn', '.nextBtn', '#nextBtn',
    '.prev_next a:last-child', '.jb_btn',
    '.courseware-next', '.next-class-btn', '.next-chapter'
  ];

  async function tryClickNextButton() {
    const roots = getAllRoots();
    for (const root of roots) {
      for (const selector of NEXT_BUTTON_SELECTORS) {
        try {
          const elements = root.querySelectorAll(selector);
          for (const el of elements) {
            if (isVisible(el)) {
              el.click();
              return true;
            }
          }
        } catch (e) {}
      }
    }
    return false;
  }

  // ==================== Strategy 7: 键盘快捷键模拟 ====================
  // 某些平台支持键盘快捷键切换下一集，作为兜底策略
  function tryKeyboardShortcut() {
    try {
      // 常见的"下一集"快捷键：Shift+N, ], Ctrl+→
      const shortcuts = [
        { key: 'N', shiftKey: true, code: 'KeyN' },  // YouTube/B站
        { key: ']', shiftKey: true, code: 'BracketRight' }, // 某些播放器
        { key: 'ArrowRight', ctrlKey: true, code: 'ArrowRight' }, // 通用
      ];
      for (const sc of shortcuts) {
        const event = new KeyboardEvent('keydown', {
          key: sc.key,
          code: sc.code,
          shiftKey: !!sc.shiftKey,
          ctrlKey: !!sc.ctrlKey,
          altKey: false,
          metaKey: false,
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(event);
        // 也尝试 keyup 事件（某些平台监听 keyup）
        const upEvent = new KeyboardEvent('keyup', {
          key: sc.key,
          code: sc.code,
          shiftKey: !!sc.shiftKey,
          ctrlKey: !!sc.ctrlKey,
          altKey: false,
          metaKey: false,
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(upEvent);
      }
      // 键盘事件无法确定是否成功，返回false让后续策略继续
      // （键盘快捷键是异步的，无法立即判断效果）
      return false;
    } catch (e) {
      return false;
    }
  }

  // ==================== Strategy 5: 播放列表查找 ====================
  const PLAYLIST_SELECTORS = [
    '.playlist li', '.course-list li', '.video-list li',
    '.chapter-list li', '.source-list li', '.file-list li',
    '.celllist li', '.timeline li',
    '[class*="playlist" i] li', '[class*="video-list" i] li',
    '[class*="course-list" i] li', '[class*="episode-list" i] li',
    '[class*="chapter"] li', '[class*="catalog"] li',
    '[class*="lesson"] li', '[class*="unit"] li',
    '[class*="section"] li', '[class*="task"] li',
    // 各视频平台剧集列表
    '.yk-episode li', '.iqiyi-episode li', '.qq-episode li',
    '.mgtv-episode li', '.mod_episode li', '.spec-part li',
    '.drama-list li', '.album-list li', '.series-list li',
    '.episode-item'
  ];

  const ACTIVE_CLASSES = ['active', 'playing', 'current', 'selected', 'currentCat', 'cat-active', 'on', 'cur'];

  function isActiveItem(item) {
    if (ACTIVE_CLASSES.some(cls => item.classList.contains(cls))) return true;
    if (item.querySelector('.current, .active')) return true;
    // 检查 aria 属性
    if (item.getAttribute('aria-current') === 'true') return true;
    return false;
  }

  function tryPlaylistNext() {
    const roots = getAllRoots();
    for (const root of roots) {
      for (const selector of PLAYLIST_SELECTORS) {
        try {
          const items = root.querySelectorAll(selector);
          if (items.length === 0) continue;

          let activeIndex = -1;
          for (let i = 0; i < items.length; i++) {
            if (isActiveItem(items[i])) { activeIndex = i; break; }
          }

          // 通过URL匹配
          if (activeIndex === -1) {
            for (let i = 0; i < items.length; i++) {
              const links = items[i].querySelectorAll('a, [data-url], [data-src]');
              for (const link of links) {
                const href = link.getAttribute('href') || link.dataset.url || link.dataset.src || '';
                if (href && window.location.href.includes(href)) {
                  activeIndex = i; break;
                }
              }
              if (activeIndex !== -1) break;
            }
          }

          if (activeIndex !== -1 && activeIndex < items.length - 1) {
            const nextItem = items[activeIndex + 1];
            const clickTarget = nextItem.querySelector('a') || nextItem.querySelector('button') || nextItem;
            clickTarget.click();
            return true;
          }
        } catch (e) {}
      }
    }
    // 兜底：尝试自动检测播放列表（通用模式）
    return tryAutoDetectPlaylist();
  }

  /**
   * 自动检测播放列表（通用模式）
   * 扫描页面中所有列表结构，寻找可能是播放列表的容器
   * 启发式规则：包含3个以上相似子元素，且子元素中有链接或可点击项
   */
  function tryAutoDetectPlaylist() {
    try {
      const roots = getAllRoots();
      for (const root of roots) {
        // 查找所有 ul/ol/div 容器
        const containers = root.querySelectorAll('ul, ol, div[class*="list" i], div[class*="playlist" i]');
        for (let c = 0; c < containers.length; c++) {
          const container = containers[c];
          // 跳过过大的容器（可能是整个页面）
          if (container.children.length > 100 || container.children.length < 2) continue;

          const items = Array.from(container.children);
          // 检查是否是播放列表（子元素中有链接，且数量>=2）
          let linkCount = 0;
          for (const item of items) {
            if (item.querySelector('a, [onclick], [data-url]')) linkCount++;
          }
          // 至少60%的子元素有链接才认为是播放列表
          if (linkCount < Math.ceil(items.length * 0.6)) continue;

          // 查找当前活动项
          let activeIndex = -1;
          for (let i = 0; i < items.length; i++) {
            if (isActiveItem(items[i])) { activeIndex = i; break; }
          }

          // 通过URL匹配
          if (activeIndex === -1) {
            for (let i = 0; i < items.length; i++) {
              const links = items[i].querySelectorAll('a, [data-url]');
              for (const link of links) {
                const href = link.getAttribute('href') || link.dataset.url || '';
                if (href && href.length > 1 && window.location.href.includes(href)) {
                  activeIndex = i; break;
                }
              }
              if (activeIndex !== -1) break;
            }
          }

          if (activeIndex !== -1 && activeIndex < items.length - 1) {
            const nextItem = items[activeIndex + 1];
            const clickTarget = nextItem.querySelector('a') || nextItem.querySelector('button') ||
                               nextItem.querySelector('[onclick]') || nextItem;
            clickTarget.click();
            notifyLog('自动检测到播放列表，点击下一项');
            return true;
          }
        }
      }
    } catch (e) {}
    return false;
  }

  // ==================== Strategy 5: 课程目录 ====================
  function tryCourseCatalogNext() {
    const catalogSelectors = [
      '.chapter_item', '.catalog_li', '.pos_catalog_name',
      '.chapter_item_target', '.u-learnLesson', '.course-unit',
      '.knowledge-card', '.jobResouce',
      'li[class*="section"]', 'li[class*="task"]'
    ];

    const roots = getAllRoots();
    for (const root of roots) {
      for (const selector of catalogSelectors) {
        try {
          const items = root.querySelectorAll(selector);
          if (items.length === 0) continue;
          for (let i = 0; i < items.length - 1; i++) {
            if (isActiveItem(items[i])) {
              const nextItem = items[i + 1];
              const clickTarget = nextItem.querySelector('a') ||
                                 nextItem.querySelector('span[onclick]') ||
                                 nextItem.querySelector('[onclick]') || nextItem;
              clickTarget.click();
              return true;
            }
          }
        } catch (e) {}
      }
    }
    return false;
  }

  // ==================== 工具函数 ====================
  function getAllRoots() {
    const roots = [document];
    try {
      document.querySelectorAll('iframe').forEach(iframe => {
        try {
          if (iframe.contentDocument) roots.push(iframe.contentDocument);
        } catch (e) {}
      });
    } catch (e) {}
    // Shadow DOM
    try {
      document.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) roots.push(el.shadowRoot);
      });
    } catch (e) {}
    return roots;
  }

  function isVisible(el) {
    if (!el) return false;
    try {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' &&
             style.visibility !== 'hidden' &&
             style.opacity !== '0' &&
             el.offsetWidth > 0 && el.offsetHeight > 0;
    } catch (e) {
      return el.offsetWidth > 0;
    }
  }

  // ==================== 倒计时通知 ====================
  function showCountdown(seconds, onConfirm, onCancel) {
    removeNotification();
    if (!IS_TOP) return;

    const notification = document.createElement('div');
    notification.id = '__toolbox-apn-countdown';
    notification.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px', 'z-index:2147483647',
      'padding:12px 18px', 'background:rgba(30,30,30,0.95)', 'color:#fff',
      'border-radius:10px', 'font-size:14px',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
      'box-shadow:0 4px 20px rgba(0,0,0,0.4)',
      'display:flex', 'align-items:center', 'gap:12px',
      'transition:all 0.3s ease', 'line-height:1'
    ].join(';');

    const textSpan = document.createElement('span');
    textSpan.id = '__toolbox-apn-countdown-text';
    textSpan.textContent = seconds + 's 后自动播放下一个';

    const cancelBtn = document.createElement('span');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = [
      'color:#ff9800', 'cursor:pointer', 'font-weight:600',
      'padding:4px 10px', 'border:1px solid #ff9800',
      'border-radius:4px', 'font-size:12px', 'white-space:nowrap'
    ].join(';');
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearCountdown();
      onCancel();
    });

    notification.appendChild(textSpan);
    notification.appendChild(cancelBtn);
    document.body.appendChild(notification);
    countdownNotification = notification;

    let remaining = seconds;
    countdownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearCountdown();
        onConfirm();
      } else {
        const textEl = document.getElementById('__toolbox-apn-countdown-text');
        if (textEl) textEl.textContent = remaining + 's 后自动播放下一个';
      }
    }, 1000);
  }

  function clearCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    removeNotification();
  }

  function showAdvanceNotification() {
    showFloatingNotification('⏭ 已自动播放下一个', 2000);
  }

  function showNoNextNotification() {
    showFloatingNotification('📭 没有找到下一个视频', 2000);
  }

  function showFloatingNotification(text, duration) {
    if (!IS_TOP) return;
    removeNotification();

    const notification = document.createElement('div');
    notification.id = '__toolbox-apn-notification';
    notification.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px', 'z-index:2147483647',
      'padding:12px 20px', 'background:rgba(30,30,30,0.95)', 'color:#fff',
      'border-radius:10px', 'font-size:14px',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
      'box-shadow:0 4px 20px rgba(0,0,0,0.4)',
      'transition:all 0.3s ease', 'line-height:1.4'
    ].join(';');
    notification.textContent = text;
    document.body.appendChild(notification);
    setTimeout(() => removeNotification(), duration || 2000);
  }

  function removeNotification() {
    const existing = document.getElementById('__toolbox-apn-countdown') ||
                     document.getElementById('__toolbox-apn-notification');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    countdownNotification = null;
  }

  // ==================== 计数器 ====================
  function incrementCount() {
    config.count = (config.count || 0) + 1;
    try {
      chrome.storage.local.get('toolbox_auto_play_next', (result) => {
        const current = result.toolbox_auto_play_next || {};
        current.count = (current.count || 0) + 1;
        chrome.storage.local.set({ toolbox_auto_play_next: current });
      });
    } catch (e) {}
    // 记录连播历史到 background（持久化，最多保留50条）
    try {
      chrome.runtime.sendMessage({
        action: 'autoPlayNext_addHistory',
        data: {
          url: window.location.href,
          title: document.title || '',
          method: '',
          timestamp: Date.now()
        }
      }).catch(() => {});
    } catch (e) {}
  }

  // ==================== SPA 导航检测 ====================
  function interceptSPANavigation() {
    window.addEventListener('popstate', () => {
      setTimeout(() => { scanMediaElements(document); advanceScheduled = false; retryCount = 0; }, 500);
    });

    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;

    history.pushState = function() {
      origPushState.apply(this, arguments);
      setTimeout(() => { scanMediaElements(document); advanceScheduled = false; retryCount = 0; }, 500);
    };

    history.replaceState = function() {
      origReplaceState.apply(this, arguments);
      setTimeout(() => { scanMediaElements(document); advanceScheduled = false; retryCount = 0; }, 500);
    };

    window.addEventListener('hashchange', () => {
      setTimeout(() => { scanMediaElements(document); advanceScheduled = false; retryCount = 0; }, 500);
    });
  }

  // ==================== 测试按钮处理 ====================
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'autoPlayNext_test') {
        // 手动触发一次连播
        if (!config.enabled) {
          sendResponse({ success: false, message: '未启用' });
          return;
        }
        if (isDomainExcluded()) {
          sendResponse({ success: false, message: '当前域名已被排除' });
          return;
        }
        advanceScheduled = false;
        advanceToNext(null);
        notifyLog('手动触发连播测试');
        sendResponse({ success: true });
      }
      if (message.action === 'autoPlayNext_enable') {
        const data = message.data || {};
        Object.assign(config, data);
        config.enabled = true;
        if (!initialized && !isDomainExcluded()) init();
        sendResponse({ success: true });
      }
      if (message.action === 'autoPlayNext_disable') {
        config.enabled = false;
        sendResponse({ success: true });
      }
      if (message.action === 'autoPlayNext_startPick') {
        // 启动元素拾取模式
        startElementPicker();
        sendResponse({ success: true });
      }
    });
  } catch (e) {}

  // ==================== 元素拾取器 ====================
  // 让用户在页面上点击"下一集"按钮，自动生成 CSS 选择器
  let pickerActive = false;
  let pickerOverlay = null;
  let pickerHighlight = null;

  function generateUniqueSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    // 如果有 id，直接用 id
    if (el.id) return '#' + CSS.escape(el.id);

    // 尝试用 class 组合
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).filter(c => c && !/^(active|current|playing|on|hover|selected)$/i.test(c));
      if (classes.length > 0) {
        const selector = el.tagName.toLowerCase() + '.' + classes.map(c => CSS.escape(c)).join('.');
        // 验证唯一性
        try {
          if (document.querySelectorAll(selector).length === 1) return selector;
        } catch (e) {}
      }
    }

    // 递归向上找带 id 的祖先，组合选择器
    const path = [];
    let current = el;
    let depth = 0;
    while (current && current.nodeType === Node.ELEMENT_NODE && depth < 5) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = '#' + CSS.escape(current.id);
        path.unshift(selector);
        break;
      }
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).filter(c => c && !/^(active|current|playing|on|hover|selected)$/i.test(c));
        if (classes.length > 0) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }
      }
      // 添加 nth-child 以确保唯一
      try {
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children);
          const idx = siblings.indexOf(current) + 1;
          selector += ':nth-child(' + idx + ')';
        }
      } catch (e) {}
      path.unshift(selector);
      current = current.parentElement;
      depth++;
    }
    return path.join(' > ');
  }

  function startElementPicker() {
    if (pickerActive) return;
    pickerActive = true;

    // 创建高亮提示框
    pickerHighlight = document.createElement('div');
    pickerHighlight.style.cssText = [
      'position:fixed', 'z-index:2147483646', 'pointer-events:none',
      'border:2px solid #ff9800', 'background:rgba(255,152,0,0.15)',
      'transition:all 0.1s ease', 'display:none'
    ].join(';');
    document.body.appendChild(pickerHighlight);

    // 创建提示横幅
    pickerOverlay = document.createElement('div');
    pickerOverlay.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
      'padding:10px 20px', 'background:rgba(255,152,0,0.95)', 'color:#fff',
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif', 'font-size:14px',
      'font-weight:600', 'text-align:center', 'box-shadow:0 2px 10px rgba(0,0,0,0.3)',
      'cursor:pointer'
    ].join(';');
    pickerOverlay.textContent = '🎯 拾取模式：点击页面上的"下一集"按钮 | 点击此处或按 ESC 取消';
    pickerOverlay.addEventListener('click', stopElementPicker);
    document.body.appendChild(pickerOverlay);

    // 鼠标移动高亮元素
    const onMouseMove = function(e) {
      if (!pickerActive) return;
      // 忽略提示横幅和高亮框本身
      if (e.target === pickerOverlay || e.target === pickerHighlight) return;
      const target = e.target;
      try {
        const rect = target.getBoundingClientRect();
        pickerHighlight.style.display = 'block';
        pickerHighlight.style.left = rect.left + 'px';
        pickerHighlight.style.top = rect.top + 'px';
        pickerHighlight.style.width = rect.width + 'px';
        pickerHighlight.style.height = rect.height + 'px';
      } catch (err) {}
    };

    // 点击拾取元素
    const onClick = function(e) {
      if (!pickerActive) return;
      if (e.target === pickerOverlay || e.target === pickerHighlight) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const target = e.target;
      const selector = generateUniqueSelector(target);

      // 保存到 storage
      try {
        chrome.storage.local.get('toolbox_auto_play_next', function(result) {
          const current = result.toolbox_auto_play_next || {};
          current._lastPickedSelector = selector;
          chrome.storage.local.set({ toolbox_auto_play_next: current });
        });
      } catch (err) {}

      // 显示成功提示
      const successMsg = document.createElement('div');
      successMsg.style.cssText = [
        'position:fixed', 'top:50%', 'left:50%', 'transform:translate(-50%,-50%)',
        'z-index:2147483647', 'padding:20px 30px', 'background:rgba(76,175,80,0.95)',
        'color:#fff', 'border-radius:10px', 'font-size:14px', 'font-weight:600',
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif',
        'box-shadow:0 4px 20px rgba(0,0,0,0.4)'
      ].join(';');
      successMsg.textContent = '✅ 已拾取选择器: ' + selector;
      document.body.appendChild(successMsg);
      setTimeout(function() { successMsg.remove(); }, 2000);

      stopElementPicker();
    };

    // ESC 取消
    const onKeydown = function(e) {
      if (e.key === 'Escape') {
        stopElementPicker();
      }
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeydown, true);

    function stopElementPicker() {
      if (!pickerActive) return;
      pickerActive = false;
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeydown, true);
      if (pickerHighlight) { pickerHighlight.remove(); pickerHighlight = null; }
      if (pickerOverlay) { pickerOverlay.remove(); pickerOverlay = null; }
      // 移除停止函数避免重复绑定
      document.removeEventListener('click', stopElementPicker, true);
    }

    // 5秒后自动取消（避免一直挂起）
    setTimeout(function() {
      if (pickerActive) stopElementPicker();
    }, 30000);
  }
})();
