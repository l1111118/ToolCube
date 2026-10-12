/**
 * 反指纹保护 - Anti-Fingerprint
 * 保护浏览器指纹信息，防止追踪
 */
document.addEventListener('DOMContentLoaded', () => {
  const $master = document.getElementById('af-master');
  const $status = document.getElementById('af-status');
  const $indicator = document.getElementById('af-indicator');
  const $blockedCount = document.getElementById('af-blocked-count');
  const $toast = document.getElementById('toast');
  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(e => { console.warn('[anti-fingerprint] safeSend error:', e); }); }
  function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { console.warn('[anti-fingerprint] safeStorage error:', e); return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

  function showToast(msg, type) {
    type = type || 'info';
    $toast.textContent = msg;
    $toast.className = 'toast toast--' + type;
    $toast.classList.add('toast--show');
    clearTimeout($toast._tm);
    $toast._tm = setTimeout(() => $toast.classList.remove('toast--show'), 3000);
  }

  function saveToHistory(data) {
    try {
      safeSend({
        action: 'saveToHistory',
        data: { toolId: 'anti-fingerprint', type: 'protect', data }
      });
    } catch (e) {}
  }

  function getLevel() {
    const checked = document.querySelector('input[name="af-level"]:checked');
    return checked ? checked.value : 'stealth';
  }

  function getProtections() {
    const prots = {};
    document.querySelectorAll('.af-prot-check').forEach(cb => {
      prots[cb.dataset.prot] = cb.checked;
    });
    return prots;
  }

  function updateStatus(enabled) {
    if (enabled) {
      $status.textContent = '已启用';
      $status.classList.add('af-status--active');
      $indicator.textContent = '🟢';
    } else {
      $status.textContent = '未启用';
      $status.classList.remove('af-status--active');
      $indicator.textContent = '⚪';
    }
  }

  // ── Noise Level Configuration ──
  let noiseLevel = 'medium'; // low, medium, high
  const NOISE_PRESETS = {
    low: { canvas: 0.01, webgl: 0.01, audio: 0.005, desc: '低噪声 — 对指纹影响最小，隐私保护有限' },
    medium: { canvas: 0.05, webgl: 0.03, audio: 0.02, desc: '中噪声 — 平衡可用性与隐私保护' },
    high: { canvas: 0.15, webgl: 0.10, audio: 0.05, desc: '高噪声 — 最强隐私保护，可能影响页面显示' }
  };

  function getNoisePreset() { return NOISE_PRESETS[noiseLevel] || NOISE_PRESETS.medium; }

  // ── Protection Status Display ──
  const PROTECTION_DIMS = [
    { id: 'canvas', label: 'Canvas 指纹保护', icon: '🎨' },
    { id: 'webgl', label: 'WebGL 指纹保护', icon: '🎮' },
    { id: 'audio', label: 'AudioContext 指纹保护', icon: '🔊' },
    { id: 'fonts', label: '字体枚举保护', icon: '🔤' },
    { id: 'screen', label: '屏幕信息保护', icon: '🖥️' },
    { id: 'hardware', label: '硬件信息保护', icon: '⚙️' },
    { id: 'timezone', label: '时区信息保护', icon: '🕐' },
    { id: 'navigator', label: '浏览器特征保护', icon: '🌐' },
    { id: 'webrtc', label: 'WebRTC 泄露保护', icon: '📡' }
  ];

  // ── 屏幕分辨率与字体伪装预设 ──
  let screenPreset = 'default';
  let fontPreset = 'default';
  const $screenPreset = document.getElementById('af-screen-preset');
  const $fontPreset = document.getElementById('af-font-preset');

  // 屏幕分辨率预设说明
  const SCREEN_PRESET_DESC = {
    'default': '使用真实分辨率，不进行伪装',
    '1920x1080': '伪装为 1920×1080（最常见桌面分辨率，融入性高）',
    '1366x768': '伪装为 1366×768（常见笔记本分辨率）',
    '1440x900': '伪装为 1440×900（MacBook 默认分辨率）',
    '2560x1440': '伪装为 2560×1440（2K 显示器分辨率）',
    '3840x2160': '伪装为 3840×2160（4K 显示器分辨率）',
    'random': '每次会话随机选择分辨率，最强防追踪'
  };
  const FONT_PRESET_DESC = {
    'default': '返回真实字体列表，不进行伪装',
    'minimal': '仅保留 Arial、Times New Roman 等核心字体',
    'windows': '伪装为 Windows 常见字体集（宋体、微软雅黑等）',
    'macos': '伪装为 macOS 常见字体集（San Francisco、Helvetica 等）',
    'linux': '伪装为 Linux 常见字体集（DejaVu、Liberation 等）',
    'random': '每次会话随机选择字体集，最强防追踪'
  };

  function updatePresetHints() {
    const $sh = document.getElementById('af-screen-hint');
    const $fh = document.getElementById('af-font-hint');
    if ($sh) $sh.textContent = SCREEN_PRESET_DESC[screenPreset] || '';
    if ($fh) $fh.textContent = FONT_PRESET_DESC[fontPreset] || '';
  }

  function renderProtectionStatus() {
    let statusEl = document.getElementById('af-protection-status');
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.id = 'af-protection-status';
      statusEl.style.cssText = 'margin:8px 0;padding:8px;border:1px solid var(--tt-border);border-radius:6px;font-size:12px;background:var(--tt-bg-secondary);';
      if ($indicator && $indicator.parentElement) {
        $indicator.parentElement.insertBefore(statusEl, $indicator.nextSibling);
      }
    }
    const enabled = $master.checked;
    const protections = getProtections();
    statusEl.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;">🛡️ 各维度保护状态</div>' +
      PROTECTION_DIMS.map(d => {
        const isActive = enabled && protections[d.id] !== false;
        return '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--tt-border);">' +
          '<span>' + d.icon + ' ' + d.label + '</span>' +
          '<span style="color:' + (isActive ? '#4caf50' : '#9e9e9e') + ';">' + (isActive ? '✓ 已启用' : '✗ 未启用') + '</span>' +
        '</div>';
      }).join('');
  }

  // ── Noise Level Selector ──
  function renderNoiseConfig() {
    let noiseEl = document.getElementById('af-noise-config');
    if (!noiseEl) {
      noiseEl = document.createElement('div');
      noiseEl.id = 'af-noise-config';
      noiseEl.style.cssText = 'margin:8px 0;padding:8px;border:1px solid var(--tt-border);border-radius:6px;font-size:12px;background:var(--tt-bg-secondary);';
      const statusEl = document.getElementById('af-protection-status');
      if (statusEl && statusEl.nextSibling) {
        statusEl.parentElement.insertBefore(noiseEl, statusEl.nextSibling);
      } else if (statusEl) {
        statusEl.parentElement.appendChild(noiseEl);
      }
    }
    const preset = getNoisePreset();
    noiseEl.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;">🔧 噪声注入强度</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:6px;">' +
        ['low', 'medium', 'high'].map(l =>
          '<button class="btn af-noise-btn" data-level="' + l + '" style="font-size:11px;padding:4px 8px;' +
          (l === noiseLevel ? 'background:var(--tt-primary);color:#fff;' : '') +
          '">' + (l === 'low' ? '低' : l === 'medium' ? '中' : '高') + '</button>'
        ).join('') +
      '</div>' +
      '<div style="color:var(--tt-text-secondary);font-size:11px;">' + escHtml(preset.desc) + '</div>' +
      '<div style="margin-top:4px;font-size:11px;color:var(--tt-text-secondary);">Canvas噪声: ' + preset.canvas + ' | WebGL噪声: ' + preset.webgl + ' | Audio噪声: ' + preset.audio + '</div>';

    noiseEl.querySelectorAll('.af-noise-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        noiseLevel = btn.dataset.level;
        // 噪声强度属于反指纹配置的一部分，统一由后台写入 toolbox_anti_fingerprint，
        // 内容脚本才能读到；旧实现写的是另一个键 toolbox_af_noise，没人读，等于没生效。
        if ($master.checked) applySettings();
        renderNoiseConfig();
        showToast('噪声强度已调整为: ' + (noiseLevel === 'low' ? '低' : noiseLevel === 'medium' ? '中' : '高'), 'success');
      });
    });
  }

  // ── Fingerprint Consistency Check ──
  async function checkConsistency() {
    let consEl = document.getElementById('af-consistency');
    if (!consEl) {
      consEl = document.createElement('div');
      consEl.id = 'af-consistency';
      consEl.style.cssText = 'margin:8px 0;padding:8px;border:1px solid var(--tt-border);border-radius:6px;font-size:12px;background:var(--tt-bg-secondary);';
      const noiseConf = document.getElementById('af-noise-config');
      if (noiseConf) { noiseConf.parentElement.appendChild(consEl); }
    }
    try {
      const fp1 = await generateTestFingerprint();
      const fp2 = await generateTestFingerprint();
      const consistent = fp1 === fp2;
      consEl.innerHTML = '<div style="font-weight:bold;margin-bottom:4px;">🔬 指纹一致性检测</div>' +
        (consistent
          ? '<div style="color:#4caf50;">✓ 两次指纹一致，噪声注入稳定</div>'
          : '<div style="color:#ff9800;">⚠️ 两次指纹不同（这是正常的反指纹行为）</div>' +
            '<div style="color:var(--tt-text-secondary);font-size:11px;">随机噪声会导致每次指纹不同，有助于防止追踪</div>'
        );
    } catch(e) {
      consEl.innerHTML = '<div style="color:var(--tt-text-secondary);">无法进行一致性检测</div>';
    }
  }

  async function generateTestFingerprint() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 200; canvas.height = 50;
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top'; ctx.font = '14px Arial';
      ctx.fillStyle = '#f60'; ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069'; ctx.fillText('TestFP', 2, 15);
      ctx.fillStyle = 'rgba(102,204,0,0.7)'; ctx.fillText('TestFP', 4, 17);
      return canvas.toDataURL();
    } catch(e) { return ''; }
  }

  function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── Fix $blockedCount: load from storage and listen for updates ──
  let afBlockedCount = 0;
  async function loadBlockedCount() {
    try {
      const result = await safeStorage('get', 'toolbox_af_blocked');
      afBlockedCount = result.toolbox_af_blocked || 0;
      if ($blockedCount) $blockedCount.textContent = afBlockedCount;
    } catch(e) {}
  }

  async function applySettings() {
    const enabled = $master.checked;
    updateStatus(enabled);
    // 同步预设选择到变量
    if ($screenPreset) screenPreset = $screenPreset.value;
    if ($fontPreset) fontPreset = $fontPreset.value;
    if (enabled) {
      const protections = getProtections();
      const level = getLevel();
      // 配置由后台**唯一**写入 chrome.storage：内容脚本读取的正是这份配置。
      // 旧实现前端与后台各写一次同一个键，后台那次只带 protections/level，
      // 会把噪声强度与屏幕/字体预设覆盖掉，导致这三项设置全部失效。
      const resp = await safeSend({
        action: 'antiFingerprint_enable',
        data: {
          protections,
          level,
          noiseLevel,
          screenPreset,
          fontPreset
        }
      });
      if (!resp || !resp.success) {
        showToast('启用失败: ' + ((resp && resp.error) || '未知错误'), 'error');
        return;
      }
      const levelLabels = { stealth: '隐形', fake: '伪装', block: '阻断' };
      showToast('反指纹保护已启用 (' + levelLabels[level] + ' · 噪声'
        + (noiseLevel === 'low' ? '低' : noiseLevel === 'medium' ? '中' : '高') + ')', 'success');
      saveToHistory({ enabled: true, level, protections });
    } else {
      await safeSend({ action: 'antiFingerprint_disable' });
      showToast('反指纹保护已关闭', 'info');
      saveToHistory({ enabled: false });
    }
    renderProtectionStatus();
    renderNoiseConfig();
    updatePresetHints();
    checkConsistency();
  }

  $master.addEventListener('change', applySettings);
  document.querySelectorAll('input[name="af-level"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if ($master.checked) applySettings();
    });
  });
  document.querySelectorAll('.af-prot-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if ($master.checked) applySettings();
    });
  });

  // 屏幕分辨率 / 字体伪装下拉变化时应用设置并更新提示
  if ($screenPreset) {
    $screenPreset.addEventListener('change', () => {
      screenPreset = $screenPreset.value;
      updatePresetHints();
      if ($master.checked) applySettings();
    });
  }
  if ($fontPreset) {
    $fontPreset.addEventListener('change', () => {
      fontPreset = $fontPreset.value;
      updatePresetHints();
      if ($master.checked) applySettings();
    });
  }

  async function loadSavedState() {
    try {
      const result = await safeStorage('get', 'toolbox_anti_fingerprint');
      const config = result.toolbox_anti_fingerprint;
      if (config) {
        if (config.enabled) {
          $master.checked = true;
          updateStatus(true);
        }
        if (config.level) {
          const radio = document.querySelector('input[name="af-level"][value="' + config.level + '"]');
          if (radio) radio.checked = true;
        }
        if (config.protections) {
          document.querySelectorAll('.af-prot-check').forEach(cb => {
            if (config.protections[cb.dataset.prot] !== undefined) {
              cb.checked = config.protections[cb.dataset.prot];
            }
          });
        }
        if (config.screenPreset && $screenPreset) {
          screenPreset = config.screenPreset;
          $screenPreset.value = config.screenPreset;
        }
        if (config.fontPreset && $fontPreset) {
          fontPreset = config.fontPreset;
          $fontPreset.value = config.fontPreset;
        }
        if (config.noiseLevel) {
          noiseLevel = config.noiseLevel;
        }
      }
    } catch (e) {}
  }

  // 监听拦截计数的变化。
  // 旧实现监听的是 chrome.runtime.onMessage 里的 antiFingerprint_blocked ——
  // 既没有任何地方发送这条消息，工具 iframe 也不是消息的投递目标，计数永远是 0。
  // 改为直接观察存储：内容脚本上报后由后台累加写入 toolbox_af_blocked。
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.toolbox_af_blocked) {
        afBlockedCount = Number(changes.toolbox_af_blocked.newValue) || 0;
        if ($blockedCount) $blockedCount.textContent = afBlockedCount;
      }
    });
  } catch (e) {}

  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
  });

  loadSavedState();
  loadBlockedCount();
  renderProtectionStatus();
  renderNoiseConfig();
  updatePresetHints();
});
