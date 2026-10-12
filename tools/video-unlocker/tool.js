/**
 * Video Unlocker Tool - 视频解锁 UI (增强版)
 * 解锁页面视频的原生控件，允许拖动进度条、画中画等
 * 新增: 右键菜单解锁、全屏解锁、画中画强制、下载链接提取、音量增益、速度微调
 */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // ==================== DOM 引用 ====================
  const E = {
    toggleEnabled: document.getElementById('toggle-enabled'),
    toggleControls: document.getElementById('toggle-controls'),
    toggleContextmenu: document.getElementById('toggle-contextmenu'),
    toggleFullscreen: document.getElementById('toggle-fullscreen'),
    togglePip: document.getElementById('toggle-pip'),
    toggleSkipAds: document.getElementById('toggle-skip-ads'),
    toggleBlockReports: document.getElementById('toggle-block-reports'),
    toggleSpoofProgress: document.getElementById('toggle-spoof-progress'),
    inputReportPatterns: document.getElementById('input-report-patterns'),
    inputSeek: document.getElementById('input-seek'),
    btnSeek: document.getElementById('btn-seek'),
    btnScan: document.getElementById('btn-scan'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnForceFullscreen: document.getElementById('btn-force-fullscreen'),
    btnDownloadVideo: document.getElementById('btn-download-video'),
    badgeStatus: document.getElementById('badge-status'),
    videoList: document.getElementById('video-list'),
    sliderVolumeBoost: document.getElementById('slider-volume-boost'),
    valVolumeBoost: document.getElementById('val-volume-boost'),
    sliderSpeedFine: document.getElementById('slider-speed-fine'),
    valSpeedFine: document.getElementById('val-speed-fine'),
    btnExtractUrls: document.getElementById('btn-extract-urls'),
    downloadList: document.getElementById('download-list')
  };

  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
  function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

  // ==================== 状态 ====================
  const state = {
    enabled: false,
    unlockControls: true,
    unlockContextmenu: true,
    unlockFullscreen: true,
    forcePip: true,
    skipAds: false,
    blockReports: false,
    reportPatterns: '',
    spoofProgress: false,
    volumeBoost: 1,
    speedFine: 1
  };

  // ==================== 发送消息到页面 ====================
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function postToPage(action, data) {
    window.parent.postMessage({ action, data: data || {} }, '*');
  }

  function sendConfig() {
    postToPage('videoUnlocker:setConfig', {
      enabled: state.enabled,
      unlockControls: state.unlockControls,
      unlockContextmenu: state.unlockContextmenu,
      unlockFullscreen: state.unlockFullscreen,
      forcePip: state.forcePip,
      skipAds: state.skipAds,
      spoofProgress: state.spoofProgress,
      volumeBoost: state.volumeBoost,
      speedFine: state.speedFine
    });
  }

  // 发送上报拦截配置到 background（通过 declarativeNetRequest 拦截）
  function sendReportBlockingConfig() {
    safeSend({
      action: 'videoUnlocker_setReportBlocking',
      data: {
        enabled: state.blockReports,
        patterns: state.reportPatterns
      }
    });
  }

  // ==================== UI 更新 ====================

  function updateBadge() {
    if (!E.badgeStatus) return;
    if (state.enabled) {
      E.badgeStatus.textContent = '已激活';
      E.badgeStatus.className = 'vu-badge active';
    } else {
      E.badgeStatus.textContent = '已停用';
      E.badgeStatus.className = 'vu-badge inactive';
    }
  }

  function formatTime(seconds) {
    if (seconds == null || isNaN(seconds)) return '--:--';
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) {
      return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }
    return m + ':' + String(sec).padStart(2, '0');
  }

  function renderVideoList(videos) {
    if (!E.videoList) return;
    if (!videos || videos.length === 0) {
      E.videoList.innerHTML = '<div class="vu-info">点击"搜索视频"查找页面中的视频元素</div>';
      return;
    }
    E.videoList.innerHTML = videos.map(function (v) {
      var statusClass = v.paused ? 'paused' : 'playing';
      var statusText = v.paused ? '已暂停' : '播放中';
      var src = v.src || '未知来源';
      var resolution = '';
      if (v.videoWidth && v.videoHeight) resolution = v.videoWidth + '×' + v.videoHeight;
      try {
        var u = new URL(src);
        src = u.pathname.split('/').pop() || src;
      } catch (e) {}
      if (src.length > 40) src = src.substring(0, 37) + '...';
      return '<div class="vu-video-item">' +
        '<span class="vu-vid-status ' + statusClass + '">' + statusText + '</span>' +
        '<span class="vu-vid-time">' + formatTime(v.currentTime) + '</span>' +
        '<span class="vu-vid-dur">/' + formatTime(v.duration) + '</span>' +
        (resolution ? '<span class="vu-vid-dur" style="color:var(--tt-primary)">📐 ' + resolution + '</span>' : '') +
        '<span class="vu-vid-src" title="' + escapeHtml(v.src || '') + '">' + escapeHtml(src) + '</span>' +
        '</div>';
    }).join('');
  }

  // ==================== 事件处理 ====================

  // 主开关
  E.toggleEnabled.addEventListener('change', function () {
    state.enabled = this.checked;
    if (state.enabled) {
      safeSend({
        action: 'videoUnlocker_enable',
        data: { unlockControls: state.unlockControls }
      }).then((response) => {
        if (response?.success) updateBadge();
      });
    } else {
      safeSend({ action: 'videoUnlocker_disable' }).then((response) => {
        if (response?.success) updateBadge();
      });
    }
    sendConfig();
    saveStateToStorage();
    updateBadge();
  });

  // 控件解锁
  E.toggleControls.addEventListener('change', function () {
    state.unlockControls = this.checked;
    sendConfig();
    saveStateToStorage();
  });

  // 右键菜单解锁
  E.toggleContextmenu.addEventListener('change', function () {
    state.unlockContextmenu = this.checked;
    sendConfig();
    saveStateToStorage();
  });

  // 全屏解锁
  E.toggleFullscreen.addEventListener('change', function () {
    state.unlockFullscreen = this.checked;
    sendConfig();
    saveStateToStorage();
  });

  // 画中画强制启用
  E.togglePip.addEventListener('change', function () {
    state.forcePip = this.checked;
    sendConfig();
    saveStateToStorage();
  });

  // 自动跳过广告
  if (E.toggleSkipAds) {
    E.toggleSkipAds.addEventListener('change', function () {
      state.skipAds = this.checked;
      sendConfig();
      saveStateToStorage();
    });
  }

  // 上报拦截开关
  if (E.toggleBlockReports) {
    E.toggleBlockReports.addEventListener('change', function () {
      state.blockReports = this.checked;
      sendReportBlockingConfig();
      saveStateToStorage();
    });
  }

  // 额外拦截URL关键词
  if (E.inputReportPatterns) {
    E.inputReportPatterns.addEventListener('change', function () {
      state.reportPatterns = this.value;
      if (state.blockReports) sendReportBlockingConfig();
      saveStateToStorage();
    });
  }

  // 进度伪装开关
  if (E.toggleSpoofProgress) {
    E.toggleSpoofProgress.addEventListener('change', function () {
      state.spoofProgress = this.checked;
      sendConfig();
      saveStateToStorage();
    });
  }

  // 强制全屏按钮
  if (E.btnForceFullscreen) {
    E.btnForceFullscreen.addEventListener('click', function () {
      postToPage('videoUnlocker:forceFullscreen');
    });
  }

  // 下载视频按钮
  if (E.btnDownloadVideo) {
    E.btnDownloadVideo.addEventListener('click', function () {
      if (E.downloadList) E.downloadList.innerHTML = '<div class="vu-info">正在提取并下载...</div>';
      postToPage('videoUnlocker:downloadVideo');
    });
  }

  // 音量增益
  E.sliderVolumeBoost.addEventListener('input', function () {
    state.volumeBoost = parseFloat(this.value);
    if (E.valVolumeBoost) E.valVolumeBoost.textContent = state.volumeBoost.toFixed(1) + 'x';
    sendConfig();
    saveStateToStorage();
  });

  // 播放速度微调
  E.sliderSpeedFine.addEventListener('input', function () {
    state.speedFine = parseFloat(this.value);
    if (E.valSpeedFine) E.valSpeedFine.textContent = state.speedFine.toFixed(1) + 'x';
    sendConfig();
    saveStateToStorage();
  });

  // 下载链接提取
  E.btnExtractUrls.addEventListener('click', function () {
    E.downloadList.innerHTML = '<div class="vu-info">正在提取...</div>';
    postToPage('videoUnlocker:extractUrls');
  });

  // 跳转到指定位置
  function seekTo() {
    var input = E.inputSeek.value.trim();
    if (!input) return;
    var seconds = parseTimeInput(input);
    if (seconds === null) {
      E.inputSeek.style.borderColor = '#ef4444';
      setTimeout(function () { E.inputSeek.style.borderColor = ''; }, 1500);
      return;
    }
    postToPage('videoUnlocker:seekTo', { time: seconds });
    setTimeout(function () { postToPage('videoUnlocker:getStatus'); }, 500);
  }

  E.btnSeek.addEventListener('click', seekTo);
  E.inputSeek.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') seekTo();
  });

  // 扫描按钮
  E.btnScan.addEventListener('click', function () {
    E.videoList.innerHTML = '<div class="vu-info">正在扫描视频...</div>';
    postToPage('videoUnlocker:scan');
    setTimeout(function () { postToPage('videoUnlocker:getStatus'); }, 800);
  });

  // 刷新按钮
  E.btnRefresh.addEventListener('click', function () {
    postToPage('videoUnlocker:getStatus');
  });

  function parseTimeInput(input) {
    var parts = input.split(':');
    if (parts.length === 3) {
      return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
    } else if (parts.length === 2) {
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
    } else {
      var num = parseFloat(input);
      return isNaN(num) ? null : num;
    }
  }

  // ==================== 状态持久化 ====================

  function saveStateToStorage() {
    safeStorage('set', {
      toolbox_video_unlocker: {
        enabled: state.enabled,
        unlockControls: state.unlockControls,
        unlockContextmenu: state.unlockContextmenu,
        unlockFullscreen: state.unlockFullscreen,
        forcePip: state.forcePip,
        skipAds: state.skipAds,
        blockReports: state.blockReports,
        reportPatterns: state.reportPatterns,
        spoofProgress: state.spoofProgress,
        volumeBoost: state.volumeBoost,
        speedFine: state.speedFine
      }
    });
  }

  // ==================== 消息接收 ====================

  window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;

    var msg = e.data;
    var action = msg.action;
    var data = msg.data || {};

    switch (action) {
      case 'videoUnlocker:status':
        renderVideoList(data.videos);
        break;
      case 'videoUnlocker:scanResult':
        break;
      case 'videoUnlocker:extractUrlsResult':
        renderDownloadList(data.urls || []);
        break;
      case 'videoUnlocker:fullscreenResult':
        // 强制全屏结果反馈（在视频列表区域显示，与 downloadResult 风格一致）
        if (E.videoList) {
          if (data && data.success) {
            E.videoList.innerHTML = '<div class="vu-info">🖥 已进入全屏</div>';
          } else {
            E.videoList.innerHTML = '<div class="vu-info">❌ 全屏失败: ' + escapeHtml((data && data.error) || '未知错误') + '</div>';
          }
        }
        break;
      case 'videoUnlocker:downloadResult':
        // 下载结果反馈
        if (E.downloadList) {
          if (data.success) {
            E.downloadList.innerHTML = '<div class="vu-info">✅ 已触发下载: ' + escapeHtml(data.url || '') + '</div>';
          } else {
            E.downloadList.innerHTML = '<div class="vu-info">❌ 下载失败: ' + escapeHtml(data.error || '未知错误') + '</div>';
          }
        }
        // 同时渲染提取到的URL列表
        if (data.urls && data.urls.length > 0) renderDownloadList(data.urls);
        break;
      case 'setTheme':
        if (data && data.theme) {
          document.documentElement.setAttribute('data-theme', data.theme);
        }
        break;
    }
  });

  function renderDownloadList(urls) {
    if (!E.downloadList) return;
    if (!urls || urls.length === 0) {
      E.downloadList.innerHTML = '<div class="vu-info">未检测到可提取的视频/音频链接</div>';
      return;
    }
    E.downloadList.innerHTML = urls.map(function(item) {
      var typeClass = item.tag === 'video' ? 'video' : 'audio';
      var typeLabel = item.tag === 'video' ? '视频' : '音频';
      var res = item.resolution ? '📐 ' + item.resolution : '';
      return '<div class="vu-download-item">' +
        '<span class="vu-dl-type ' + typeClass + '">' + typeLabel + '</span>' +
        (res ? '<span class="vu-dl-res">' + res + '</span>' : '') +
        '<div class="vu-dl-url">' + escapeHtml(item.url) + '</div>' +
        '</div>';
    }).join('');
  }

  // ==================== 初始化 ====================

  async function loadSavedState() {
    try {
      const result = await safeStorage('get', 'toolbox_video_unlocker');
      const saved = result.toolbox_video_unlocker;
      if (saved) {
        state.enabled = !!saved.enabled;
        if (saved.unlockControls !== undefined) state.unlockControls = saved.unlockControls;
        if (saved.unlockContextmenu !== undefined) state.unlockContextmenu = saved.unlockContextmenu;
        if (saved.unlockFullscreen !== undefined) state.unlockFullscreen = saved.unlockFullscreen;
        if (saved.forcePip !== undefined) state.forcePip = saved.forcePip;
        if (saved.skipAds !== undefined) state.skipAds = saved.skipAds;
        if (saved.blockReports !== undefined) state.blockReports = saved.blockReports;
        if (saved.reportPatterns !== undefined) state.reportPatterns = saved.reportPatterns;
        if (saved.spoofProgress !== undefined) state.spoofProgress = saved.spoofProgress;
        if (saved.volumeBoost !== undefined) state.volumeBoost = saved.volumeBoost;
        if (saved.speedFine !== undefined) state.speedFine = saved.speedFine;

        if (E.toggleEnabled) E.toggleEnabled.checked = state.enabled;
        if (E.toggleControls) E.toggleControls.checked = state.unlockControls;
        if (E.toggleContextmenu) E.toggleContextmenu.checked = state.unlockContextmenu;
        if (E.toggleFullscreen) E.toggleFullscreen.checked = state.unlockFullscreen;
        if (E.togglePip) E.togglePip.checked = state.forcePip;
        if (E.toggleSkipAds) E.toggleSkipAds.checked = state.skipAds;
        if (E.toggleBlockReports) E.toggleBlockReports.checked = state.blockReports;
        if (E.inputReportPatterns) E.inputReportPatterns.value = state.reportPatterns;
        if (E.toggleSpoofProgress) E.toggleSpoofProgress.checked = state.spoofProgress;
        if (E.sliderVolumeBoost) { E.sliderVolumeBoost.value = state.volumeBoost; }
        if (E.valVolumeBoost) E.valVolumeBoost.textContent = state.volumeBoost.toFixed(1) + 'x';
        if (E.sliderSpeedFine) { E.sliderSpeedFine.value = state.speedFine; }
        if (E.valSpeedFine) E.valSpeedFine.textContent = state.speedFine.toFixed(1) + 'x';

        updateBadge();
        // 恢复上报拦截规则
        if (state.blockReports) sendReportBlockingConfig();
      } else {
        if (E.toggleEnabled) E.toggleEnabled.checked = false;
        updateBadge();
      }
    } catch (e) {
      if (E.toggleEnabled) E.toggleEnabled.checked = false;
      updateBadge();
    }
  }

  function init() {
    loadSavedState();
    setTimeout(function () {
      sendConfig();
      postToPage('videoUnlocker:getStatus');
    }, 300);
  }

  init();
});
