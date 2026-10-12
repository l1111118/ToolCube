/**
 * 自动连播 - Auto Play Next Tool UI v3.1 (增强版)
 * 新增: 检测可视化、平台匹配状态、测试按钮、日志面板、排除域名
 */
document.addEventListener('DOMContentLoaded', () => {
  const $master = document.getElementById('apn-master');
  const $status = document.getElementById('apn-status');
  const $indicator = document.getElementById('apn-indicator');
  const $count = document.getElementById('apn-count');
  const $delay = document.getElementById('apn-delay');
  const $delayVal = document.getElementById('apn-delay-val');
  const $autoReplay = document.getElementById('apn-autoreplay');
  const $clickNext = document.getElementById('apn-clicknext');
  const $skipIntro = document.getElementById('apn-skipintro');
  const $nearEnd = document.getElementById('apn-nearend');
  const $nearEndVal = document.getElementById('apn-nearend-val');
  const $customSelector = document.getElementById('apn-custom-selector');
  const $pickElement = document.getElementById('apn-pick-element');
  const $pickHint = document.getElementById('apn-pick-hint');
  const $reset = document.getElementById('apn-reset');
  const $testBtn = document.getElementById('apn-test-btn');
  const $logPanel = document.getElementById('apn-log-panel');
  const $excludeDomains = document.getElementById('apn-exclude-domains');
  const $nextFound = document.getElementById('apn-next-found');
  const $clearHistory = document.getElementById('apn-clear-history');
  const $historyPanel = document.getElementById('apn-history-panel');
  const $toast = document.getElementById('toast');
  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
  function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

  // ====== 日志系统 ======
  const MAX_LOGS = 20;
  const logEntries = [];

  function addLog(message) {
    const now = new Date();
    const timeStr = String(now.getHours()).padStart(2,'0') + ':' +
                    String(now.getMinutes()).padStart(2,'0') + ':' +
                    String(now.getSeconds()).padStart(2,'0');
    logEntries.unshift({ time: timeStr, message: message });
    if (logEntries.length > MAX_LOGS) logEntries.pop();
    renderLog();
  }

  function renderLog() {
    if (!$logPanel) return;
    if (logEntries.length === 0) {
      $logPanel.innerHTML = '<div class="apn-log-empty">暂无记录</div>';
      return;
    }
    $logPanel.innerHTML = logEntries.map(entry =>
      '<div class="apn-log-entry"><span class="apn-log-time">' + entry.time + '</span>' + entry.message + '</div>'
    ).join('');
  }

  // ====== 检测可视化 ======
  const detectionMethods = ['ended', 'nearEnd', 'pauseAtEnd', 'domCompletion', 'customSelector'];

  function setDetectionTriggered(method) {
    const item = document.querySelector('.apn-detect-item[data-method="' + method + '"]');
    if (item) {
      const dot = item.querySelector('.apn-detect-dot');
      if (dot) dot.textContent = '🟢';
    }
  }

  // ====== 下一集检测状态 ======
  function setNextFound(found) {
    if ($nextFound) {
      $nextFound.textContent = found ? '✅' : '❌';
      $nextFound.title = found ? '已找到下一集' : '未找到下一集';
    }
  }

  // ====== Toast ======
  function showToast(msg, type) {
    type = type || 'info';
    $toast.textContent = msg;
    $toast.className = 'toast toast--' + type;
    $toast.classList.add('toast--show');
    clearTimeout($toast._tm);
    $toast._tm = setTimeout(() => $toast.classList.remove('toast--show'), 3000);
  }

  function updateStatus(enabled) {
    if (enabled) {
      $status.textContent = '已启用';
      $status.classList.add('apn-status--active');
      $indicator.textContent = '🟢';
    } else {
      $status.textContent = '未启用';
      $status.classList.remove('apn-status--active');
      $indicator.textContent = '⚪';
    }
  }

  function applySettings() {
    const enabled = $master.checked;
    const delay = parseInt($delay.value, 10);
    const autoReplay = $autoReplay.checked;
    const clickNextButton = $clickNext.checked;
    const skipIntro = $skipIntro.checked;
    const nearEndThreshold = parseInt($nearEnd.value, 10);
    const customSelector = ($customSelector.value || '').trim();
    const excludeDomains = ($excludeDomains.value || '').trim();

    updateStatus(enabled);

    if (enabled) {
      safeSend({
        action: 'autoPlayNext_enable',
        data: { delay, autoReplay, clickNextButton, skipIntro, nearEndThreshold, customSelector, excludeDomains }
      });
      showToast('自动连播已启用 (延迟' + delay + 's)', 'success');
      addLog('启用自动连播 (延迟' + delay + 's)');
    } else {
      safeSend({ action: 'autoPlayNext_disable' });
      showToast('自动连播已关闭', 'info');
      addLog('关闭自动连播');
    }
  }

  // 主开关
  $master.addEventListener('change', applySettings);

  // 延迟滑块
  $delay.addEventListener('input', () => {
    const val = parseInt($delay.value, 10);
    $delayVal.textContent = val + 's';
    if ($master.checked) applySettings();
  });

  // 提前触发滑块
  $nearEnd.addEventListener('input', () => {
    const val = parseInt($nearEnd.value, 10);
    $nearEndVal.textContent = val + 's';
    if ($master.checked) applySettings();
  });

  // 选项开关
  $autoReplay.addEventListener('change', () => { if ($master.checked) applySettings(); });
  $clickNext.addEventListener('change', () => { if ($master.checked) applySettings(); });
  if ($skipIntro) {
    $skipIntro.addEventListener('change', () => { if ($master.checked) applySettings(); });
  }

  // 自定义选择器
  $customSelector.addEventListener('change', () => { if ($master.checked) applySettings(); });

  // 拾取元素按钮 - 进入元素拾取模式
  if ($pickElement) {
    $pickElement.addEventListener('click', () => {
      // 通知 injector 进入元素拾取模式
      safeSend({ action: 'autoPlayNext_startPick' });
      if ($pickHint) $pickHint.style.display = 'block';
      showToast('已开启拾取模式，请到目标页面点击"下一集"按钮', 'info');
      addLog('开启元素拾取模式');
    });
  }

  // 排除域名
  $excludeDomains.addEventListener('change', () => { if ($master.checked) applySettings(); });

  // 重置计数
  $reset.addEventListener('click', async () => {
    try {
      const result = await safeStorage('get', 'toolbox_auto_play_next');
      const current = result.toolbox_auto_play_next || {};
      current.count = 0;
      await safeStorage('set', { toolbox_auto_play_next: current });
      $count.textContent = '0';
      showToast('计数已重置', 'info');
      addLog('重置计数');
    } catch (e) {}
  });

  // 测试按钮
  $testBtn.addEventListener('click', () => {
    safeSend({ action: 'autoPlayNext_test' });
    showToast('已手动触发连播测试', 'info');
    addLog('手动触发连播测试');
  });

  // ====== 连播历史记录 ======
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function(c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function formatTimestamp(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = String(d.getHours()).padStart(2,'0') + ':' +
                 String(d.getMinutes()).padStart(2,'0') + ':' +
                 String(d.getSeconds()).padStart(2,'0');
    if (isToday) return time;
    return (d.getMonth()+1) + '/' + d.getDate() + ' ' + time;
  }

  function renderHistory(history) {
    if (!$historyPanel) return;
    if (!history || history.length === 0) {
      $historyPanel.innerHTML = '<div class="apn-log-empty">暂无连播历史</div>';
      return;
    }
    $historyPanel.innerHTML = history.map(function(entry) {
      const title = entry.title || entry.url || '';
      const shortTitle = title.length > 40 ? title.substring(0, 37) + '...' : title;
      const method = entry.method || '';
      const time = formatTimestamp(entry.timestamp);
      return '<div class="apn-log-entry">' +
        '<span class="apn-log-time">' + time + '</span>' +
        escapeHtml(shortTitle) +
        (method ? ' <span style="color:var(--text-tertiary);font-size:11px">[' + escapeHtml(method) + ']</span>' : '') +
        '</div>';
    }).join('');
  }

  async function loadHistory() {
    try {
      const resp = await safeSend({ action: 'autoPlayNext_getHistory' });
      if (resp && resp.success && resp.history) {
        renderHistory(resp.history);
      }
    } catch (e) {}
  }

  if ($clearHistory) {
    $clearHistory.addEventListener('click', async () => {
      await safeSend({ action: 'autoPlayNext_clearHistory' });
      renderHistory([]);
      showToast('历史记录已清空', 'info');
      addLog('清空连播历史');
    });
  }

  // 定期刷新计数 + 接收日志
  async function refreshCount() {
    try {
      const result = await safeStorage('get', 'toolbox_auto_play_next');
      const config = result.toolbox_auto_play_next;
      if (config) $count.textContent = config.count || 0;
      // 同步日志
      if (config && config._lastLog) {
        addLog(config._lastLog);
        // 清除已读日志
        config._lastLog = undefined;
        safeStorage('set', { toolbox_auto_play_next: config });
      }
      // 同步拾取到的选择器
      if (config && config._lastPickedSelector) {
        if ($customSelector) $customSelector.value = config._lastPickedSelector;
        if ($pickHint) $pickHint.style.display = 'none';
        showToast('已拾取选择器: ' + config._lastPickedSelector, 'success');
        addLog('拾取到选择器: ' + config._lastPickedSelector);
        // 清除已读
        config._lastPickedSelector = undefined;
        safeStorage('set', { toolbox_auto_play_next: config });
        // 自动应用
        if ($master.checked) applySettings();
      }
    } catch (e) {}
  }
  setInterval(refreshCount, 3000);
  // 每 10 秒刷新历史记录
  setInterval(loadHistory, 10000);

  // 加载保存的状态
  async function loadSavedState() {
    try {
      const result = await safeStorage('get', 'toolbox_auto_play_next');
      const config = result.toolbox_auto_play_next;
      if (config) {
        if (config.enabled) { $master.checked = true; updateStatus(true); }
        if (config.delay !== undefined) { $delay.value = config.delay; $delayVal.textContent = config.delay + 's'; }
        if (config.autoReplay !== undefined) $autoReplay.checked = config.autoReplay;
        if (config.clickNextButton !== undefined) $clickNext.checked = config.clickNextButton;
        if (config.skipIntro !== undefined && $skipIntro) $skipIntro.checked = config.skipIntro;
        if (config.nearEndThreshold !== undefined) { $nearEnd.value = config.nearEndThreshold; $nearEndVal.textContent = config.nearEndThreshold + 's'; }
        if (config.customSelector) $customSelector.value = config.customSelector;
        if (config.excludeDomains) $excludeDomains.value = config.excludeDomains;
        $count.textContent = config.count || 0;
      }
    } catch (e) {}

    setNextFound(false);
    renderLog();
    // 加载连播历史记录
    loadHistory();
  }

  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
    // 接收检测触发消息
    if (event.data && event.data.action === 'apn:detectionTriggered' && event.data.data) {
      setDetectionTriggered(event.data.data.method);
      addLog('检测触发: ' + event.data.data.method);
    }
    // 接收日志消息
    if (event.data && event.data.action === 'apn:log' && event.data.data) {
      addLog(event.data.data.message);
    }
    // 接收下一集检测结果
    if (event.data && event.data.action === 'apn:nextFound' && event.data.data) {
      setNextFound(event.data.data.found);
    }
  });

  loadSavedState();
});
