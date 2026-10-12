/**
 * Video Speed Tool - 视频倍速工具 (增强版)
 * 控制页面中所有视频的播放速度，显示视频列表及快捷操作
 * 新增: A-B循环播放、视频信息、网站倍速记忆、快捷键增强
 */
document.addEventListener('DOMContentLoaded', () => {
  const display = document.getElementById('vs-display');
  const slider = document.getElementById('vs-slider');
  const videoList = document.getElementById('vs-video-list');
  const videoInfoSection = document.getElementById('vs-video-info-section');
  const infoDuration = document.getElementById('vs-info-duration');
  const infoCurrent = document.getElementById('vs-info-current');
  const infoResolution = document.getElementById('vs-info-resolution');
  const abStatus = document.getElementById('vs-ab-status');
  const siteMemoryToggle = document.getElementById('toggle-site-memory');
  const siteCurrent = document.getElementById('vs-site-current');
  const pitchToggle = document.getElementById('toggle-pitch');
  const btnPip = document.getElementById('btn-pip');
  let speed = 1;
  let lastVideos = []; // 缓存上次的视频数据

  // A-B 循环状态
  let abPointA = null;
  let abPointB = null;
  let abLoopActive = false;

  // 网站倍速记忆
  let siteMemoryEnabled = false;

  // 音频变调补偿（默认开启）
  let preservesPitch = true;

  // 根据浏览器调整倍速上限
  const ua = navigator.userAgent;
  let SPEED_MAX = 16;
  if (ua.indexOf('Firefox/') > -1) SPEED_MAX = 8;
  else if (ua.indexOf('Safari/') > -1 && ua.indexOf('Chrome/') === -1) SPEED_MAX = 2;
  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

  // ====== 通信函数 ======

  // 通过 sidebar -> injector 在页面上下文中执行并获取响应 (10秒超时)
  function callContent(action, data) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const handler = (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

        if (!e.data || e.source !== window.parent) return;
        if (e.data && e.data.action === '__contentResponse' && e.data.data && e.data.data.__id === id) {
          window.removeEventListener('message', handler);
          clearTimeout(timer);
          resolve(e.data.data.result);
        }
      };
      window.addEventListener('message', handler);
      const timer = setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(null);
      }, 10000);
      window.parent.postMessage({ action: 'sendToContent', data: { id, action, data } }, '*');
    });
  }

  function post(a, d) {
    window.parent.postMessage({ action: a, data: d || {} }, '*');
  }

  // ====== 工具函数 ======

  function formatTime(s) {
    if (!s || !isFinite(s)) return '0:00';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    return m + ':' + String(sec).padStart(2, '0');
  }

  function extractFileName(src) {
    if (!src) return '(未知来源)';
    try {
      const url = new URL(src, location.href);
      const path = url.pathname;
      const name = path.split('/').pop();
      if (name && name.length > 1) {
        return decodeURIComponent(name).substring(0, 40);
      }
      return url.host;
    } catch (e) {
      return src.substring(0, 40);
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ====== 网站倍速记忆 ======

  function getSiteKey() {
    try {
      const url = new URL(window.parent.location.href);
      return url.hostname;
    } catch (e) {
      return '';
    }
  }

  async function saveSiteSpeed(siteKey, spd) {
    if (!siteMemoryEnabled || !siteKey) return;
    try {
      const result = await safeStorage('get', 'toolbox_video_speed_sites');
      const sites = result.toolbox_video_speed_sites || {};
      sites[siteKey] = spd;
      await safeStorage('set', { toolbox_video_speed_sites: sites });
    } catch (e) {}
  }

  async function loadSiteSpeed(siteKey) {
    if (!siteMemoryEnabled || !siteKey) return null;
    try {
      const result = await safeStorage('get', 'toolbox_video_speed_sites');
      const sites = result.toolbox_video_speed_sites || {};
      return sites[siteKey] || null;
    } catch (e) {
      return null;
    }
  }

  async function updateSiteDisplay() {
    const siteKey = getSiteKey();
    if (siteCurrent) {
      if (siteMemoryEnabled && siteKey) {
        const saved = await loadSiteSpeed(siteKey);
        siteCurrent.textContent = saved
          ? `当前网站: ${siteKey} → ${saved}x`
          : `当前网站: ${siteKey} (未记忆)`;
      } else {
        siteCurrent.textContent = siteKey ? `当前网站: ${siteKey}` : '';
      }
    }
  }

  siteMemoryToggle.addEventListener('change', async () => {
    siteMemoryEnabled = siteMemoryToggle.checked;
    await safeStorage('set', { toolbox_video_speed_site_memory: siteMemoryEnabled });
    if (siteMemoryEnabled) {
      const siteKey = getSiteKey();
      if (siteKey) await saveSiteSpeed(siteKey, speed);
    }
    updateSiteDisplay();
  });

  // ====== 时间加速开关（超星/学习通等平台进度条加速） ======
  const timeAccelToggle = document.getElementById('toggle-time-accel');

  timeAccelToggle.addEventListener('change', async () => {
    const enabled = timeAccelToggle.checked;
    await safeStorage('set', { toolbox_video_speed_time_accel: enabled });
    // 通知 injector 切换时间加速
    post('setTimeAccel', { enabled });
  });

  // ====== 音频变调补偿开关 ======
  if (pitchToggle) {
    pitchToggle.addEventListener('change', async () => {
      preservesPitch = pitchToggle.checked;
      await safeStorage('set', { toolbox_video_speed_pitch: preservesPitch });
      // 立即应用到当前视频
      post('setPreservesPitch', { preservesPitch });
      // 同时通过 setVideoSpeed 同步一次（确保 injector 收到）
      post('setVideoSpeed', { speed: speed, preservesPitch: preservesPitch });
    });
  }

  // ====== 画中画模式按钮 ======
  if (btnPip) {
    btnPip.addEventListener('click', async () => {
      // 请求视频进入画中画模式
      post('enterPiP', {});
    });
  }

  // ====== UI 更新 ======

  function updateUI(s) {
    speed = s;
    display.innerHTML = s.toFixed(s % 1 === 0 ? 1 : 2) + '<span>x</span>';
    if (slider && Math.abs(parseFloat(slider.value) - s) > 0.001) {
      slider.value = s;
    }
    document.querySelectorAll('.vs-preset').forEach(p => {
      p.classList.toggle('vs-preset--active', Math.abs(parseFloat(p.dataset.speed) - s) < 0.001);
    });
  }

  function saveSpeed(s) {
    try {
      safeStorage('set', {
        toolbox_video_speed: { speed: s },
        // 同步写入 enabled 标志，保证刷新页面后倍速自动恢复生效
        toolbox_video_speed_enabled: true
      });
    } catch (e) {}
  }

  function setSpeed(s, showPanel) {
    s = Math.max(0.1, Math.min(SPEED_MAX, s));
    updateUI(s);
    saveSpeed(s);
    // 网站倍速记忆
    if (siteMemoryEnabled) {
      const siteKey = getSiteKey();
      if (siteKey) saveSiteSpeed(siteKey, s);
    }
    if (showPanel !== false) {
      detectAndRender();
    }
    // 同时发送倍速和音频变调补偿设置
    post('setVideoSpeed', { speed: s, preservesPitch: preservesPitch });
  }

  // ====== 视频信息更新 ======

  function updateVideoInfo(v) {
    if (!v || !videoInfoSection) return;
    videoInfoSection.style.display = '';
    if (infoDuration) infoDuration.textContent = formatTime(v.duration);
    if (infoCurrent) infoCurrent.textContent = formatTime(v.currentTime);
    if (infoResolution) infoResolution.textContent = (v.videoWidth && v.videoHeight) ? `${v.videoWidth}×${v.videoHeight}` : '未知';
  }

  // ====== A-B 循环控制 ======

  function updateABStatus() {
    if (!abStatus) return;
    if (abPointA === null && abPointB === null) {
      abStatus.textContent = '未设定循环点';
    } else if (abPointA !== null && abPointB === null) {
      abStatus.textContent = `A点: ${formatTime(abPointA)} | 等待设定B点...`;
    } else if (abPointA !== null && abPointB !== null) {
      const state = abLoopActive ? '🔴 循环中' : '⏸ 未开启';
      abStatus.textContent = `A: ${formatTime(abPointA)} → B: ${formatTime(abPointB)} | ${state}`;
    }
  }

  document.getElementById('btn-ab-set-a').addEventListener('click', async () => {
    const result = await callContent('detectVideos');
    if (result && result.videos && result.videos[0]) {
      abPointA = result.videos[0].currentTime;
      updateABStatus();
      if (abPointB !== null && abPointA >= abPointB) {
        abPointB = null;
        abLoopActive = false;
        post('setABLoop', { enabled: false });
        updateABStatus();
      }
    }
  });

  document.getElementById('btn-ab-set-b').addEventListener('click', async () => {
    const result = await callContent('detectVideos');
    if (result && result.videos && result.videos[0]) {
      const b = result.videos[0].currentTime;
      if (abPointA !== null && b <= abPointA) {
        abStatus.textContent = '⚠️ B点必须大于A点';
        return;
      }
      abPointB = b;
      updateABStatus();
    }
  });

  document.getElementById('btn-ab-toggle').addEventListener('click', () => {
    if (abPointA === null || abPointB === null) {
      abStatus.textContent = '⚠️ 请先设定A和B两个循环点';
      return;
    }
    abLoopActive = !abLoopActive;
    const btn = document.getElementById('btn-ab-toggle');
    btn.textContent = abLoopActive ? '⏸ 停止循环' : '▶ 开启循环';
    post('setABLoop', { enabled: abLoopActive, pointA: abPointA, pointB: abPointB });
    updateABStatus();
  });

  document.getElementById('btn-ab-clear').addEventListener('click', () => {
    abPointA = null;
    abPointB = null;
    abLoopActive = false;
    const btn = document.getElementById('btn-ab-toggle');
    if (btn) btn.textContent = '▶ 开启循环';
    post('setABLoop', { enabled: false });
    updateABStatus();
  });

  // ====== 视频检测与渲染 ======

  async function detectAndRender() {
    videoList.innerHTML = '<div class="vs-info">🔍 正在检测视频...</div>';
    const result = await callContent('detectVideos');
    if (!result) {
      videoList.innerHTML = '<div class="vs-info">❌ 检测失败，请确保当前页面为普通网页</div>';
      return;
    }
    lastVideos = result.videos || [];
    renderVideoList(result);
    // 更新视频信息
    if (lastVideos.length > 0) {
      updateVideoInfo(lastVideos[0]);
    }
  }

  async function refreshStatus() {
    const result = await callContent('getVideoStatus');
    if (!result) return;
    lastVideos = result.videos || [];
    renderVideoList(result);
    if (lastVideos.length > 0) {
      updateVideoInfo(lastVideos[0]);
    }
  }

  function renderVideoList(result) {
    const { count, videos } = result;
    if (!count || count === 0) {
      videoList.innerHTML = '<div class="vs-info">📹 当前页面未检测到视频元素，打开含视频的页面后重试</div>';
      return;
    }

    videoList.innerHTML = `
      <div class="vs-list-header">
        <span>✅ 检测到 <strong>${count}</strong> 个媒体元素</span>
        <button class="btn btn--secondary btn--sm" id="btn-refresh">🔄 刷新状态</button>
      </div>
      <div class="vs-list-items">
        ${videos.map((v, i) => renderVideoItem(v, i)).join('')}
      </div>
    `;

    // 绑定刷新按钮
    const refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshBtn.textContent = '⏳ 刷新中...';
        refreshStatus().then(() => {
          const btn = document.getElementById('btn-refresh');
          if (btn) btn.textContent = '🔄 刷新状态';
        });
      });
    }

    // 绑定视频控制按钮
    videoList.querySelectorAll('[data-ctrl]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        const ctrl = btn.dataset.ctrl;
        const r = await callContent('videoControl', { index: idx, ctrl });
        if (r && r.success) {
          // 操作后延迟刷新状态
          setTimeout(refreshStatus, 300);
        }
      });
    });
  }

  function renderVideoItem(v, index) {
    const src = extractFileName(v.src);
    const timeStr = formatTime(v.currentTime) + ' / ' + formatTime(v.duration);
    let statusText, statusClass;
    if (v.ended) {
      statusText = '已结束';
      statusClass = 'vs-status--ended';
    } else if (v.paused) {
      statusText = '暂停';
      statusClass = 'vs-status--paused';
    } else {
      statusText = '播放中';
      statusClass = 'vs-status--playing';
    }
    const rateStr = (v.playbackRate || 1).toFixed(v.playbackRate % 1 === 0 ? 1 : 2) + 'x';
    const resolution = (v.videoWidth && v.videoHeight) ? `${v.videoWidth}×${v.videoHeight}` : '';
    const toggleLabel = v.paused ? '▶ 播放' : '⏸ 暂停';
    const toggleCtrl = v.paused ? 'play' : 'pause';

    return `
      <div class="vs-item">
        <div class="vs-item-header">
          <span class="vs-item-src" title="${escapeHtml(v.src)}">${escapeHtml(src)}</span>
          <span class="vs-item-status ${statusClass}">${statusText}</span>
        </div>
        <div class="vs-item-meta">
          <span class="vs-item-time">⏱ ${timeStr}</span>
          <span class="vs-item-rate">⚡ ${rateStr}</span>
          ${resolution ? `<span class="vs-item-res">📐 ${resolution}</span>` : ''}
        </div>
        <div class="vs-item-actions">
          <button class="btn btn--secondary btn--sm" data-ctrl="restart" data-index="${index}">⏮ 开头</button>
          <button class="btn btn--secondary btn--sm" data-ctrl="${toggleCtrl}" data-index="${index}">${toggleLabel}</button>
        </div>
      </div>
    `;
  }

  // ====== 根据浏览器调整UI ======
  slider.max = SPEED_MAX;
  // 更新右侧标签
  const maxLabel = document.querySelector('.vs-range-row .vs-range-label:last-child');
  if (maxLabel) maxLabel.textContent = SPEED_MAX + 'x';
  // 隐藏超出上限的预设按钮
  document.querySelectorAll('.vs-preset').forEach(p => {
    const s = parseFloat(p.dataset.speed);
    if (s > SPEED_MAX) {
      p.style.display = 'none';
    }
  });

  // ====== 滑块与预设 ======

  slider.addEventListener('input', () => {
    setSpeed(parseFloat(slider.value));
  });

  document.querySelectorAll('.vs-preset').forEach(p => {
    p.addEventListener('click', () => {
      setSpeed(parseFloat(p.dataset.speed));
    });
  });

  // ====== 控制按钮 ======

  document.getElementById('btn-slower').addEventListener('click', () => {
    setSpeed(Math.max(0.1, +(speed - 0.25).toFixed(2)));
  });
  document.getElementById('btn-faster').addEventListener('click', () => {
    setSpeed(Math.min(SPEED_MAX, +(speed + 0.25).toFixed(2)));
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    setSpeed(1);
  });
  document.getElementById('btn-apply').addEventListener('click', () => {
    setSpeed(parseFloat(slider.value));
  });
  document.getElementById('btn-detect').addEventListener('click', () => {
    detectAndRender();
  });

  // ====== 键盘快捷键 ======

  document.addEventListener('keydown', (e) => {
    // 如果焦点在 input/textarea 中则不处理
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (lastVideos.length > 0) {
          callContent('videoControl', { index: 0, ctrl: 'toggle' }).then(() => {
            setTimeout(refreshStatus, 300);
          });
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (lastVideos.length > 0) {
          callContent('detectVideos').then(r => {
            if (r && r.videos && r.videos[0]) {
              const newTime = Math.max(0, r.videos[0].currentTime - 5);
              callContent('videoControl', { index: 0, ctrl: 'seek', time: newTime }).then(() => {
                setTimeout(refreshStatus, 300);
              });
            }
          });
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (lastVideos.length > 0) {
          callContent('detectVideos').then(r => {
            if (r && r.videos && r.videos[0]) {
              const newTime = r.videos[0].currentTime + 5;
              callContent('videoControl', { index: 0, ctrl: 'seek', time: newTime }).then(() => {
                setTimeout(refreshStatus, 300);
              });
            }
          });
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSpeed(Math.min(SPEED_MAX, +(speed + 0.25).toFixed(2)));
        break;
      case 'ArrowDown':
        e.preventDefault();
        setSpeed(Math.max(0.1, +(speed - 0.25).toFixed(2)));
        break;
      case '[':
        e.preventDefault();
        // A-B循环: 设定A点
        if (lastVideos.length > 0) {
          callContent('detectVideos').then(r => {
            if (r && r.videos && r.videos[0]) {
              abPointA = r.videos[0].currentTime;
              updateABStatus();
            }
          });
        }
        break;
      case ']':
        e.preventDefault();
        // A-B循环: 设定B点
        if (lastVideos.length > 0) {
          callContent('detectVideos').then(r => {
            if (r && r.videos && r.videos[0]) {
              const b = r.videos[0].currentTime;
              if (abPointA !== null && b > abPointA) {
                abPointB = b;
                updateABStatus();
              }
            }
          });
        }
        break;
      case '\\':
        e.preventDefault();
        // A-B循环: 切换
        if (abPointA !== null && abPointB !== null) {
          abLoopActive = !abLoopActive;
          const btn = document.getElementById('btn-ab-toggle');
          if (btn) btn.textContent = abLoopActive ? '⏸ 停止循环' : '▶ 开启循环';
          post('setABLoop', { enabled: abLoopActive, pointA: abPointA, pointB: abPointB });
          updateABStatus();
        }
        break;
    }
  });

  // ====== 接收消息 ======

  window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    // 主题切换
    if (e.data && e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
  });

  // ====== 初始化 ======

  async function loadSavedState() {
    try {
      const result = await safeStorage('get', 'toolbox_video_speed');
      const saved = result.toolbox_video_speed;
      if (saved && saved.speed !== undefined) {
        setSpeed(saved.speed, false);
      } else {
        updateUI(1);
      }
    } catch (e) {
      updateUI(1);
    }

    // 加载网站倍速记忆开关
    try {
      const result = await safeStorage('get', 'toolbox_video_speed_site_memory');
      siteMemoryEnabled = !!result.toolbox_video_speed_site_memory;
      if (siteMemoryToggle) siteMemoryToggle.checked = siteMemoryEnabled;
    } catch (e) {}

    // 加载时间加速开关
    try {
      const result = await safeStorage('get', 'toolbox_video_speed_time_accel');
      if (timeAccelToggle) timeAccelToggle.checked = !!result.toolbox_video_speed_time_accel;
    } catch (e) {}

    // 加载音频变调补偿开关（默认开启）
    try {
      const result = await safeStorage('get', 'toolbox_video_speed_pitch');
      // 仅当显式存储了 false 时才关闭
      if (result.toolbox_video_speed_pitch === false) {
        preservesPitch = false;
        if (pitchToggle) pitchToggle.checked = false;
      } else {
        preservesPitch = true;
        if (pitchToggle) pitchToggle.checked = true;
      }
    } catch (e) {}

    // 如果网站倍速记忆开启，加载当前网站的速度
    if (siteMemoryEnabled) {
      const siteKey = getSiteKey();
      if (siteKey) {
        const siteSpeed = await loadSiteSpeed(siteKey);
        if (siteSpeed !== null) {
          setSpeed(siteSpeed, false);
        }
      }
    }

    updateSiteDisplay();
    updateABStatus();
  }

  loadSavedState();
});
