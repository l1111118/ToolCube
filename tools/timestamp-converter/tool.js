/**
 * 时间戳转换工具
 * @version 1.3.0
 */

// DOM元素
const elements = {
  currentTimestamp: document.getElementById('current-timestamp'),
  currentDatetime: document.getElementById('current-datetime'),
  btnRefresh: document.getElementById('btn-refresh'),
  timestampInput: document.getElementById('timestamp-input'),
  datetimeOutput: document.getElementById('datetime-output'),
  btnConvertTs: document.getElementById('btn-convert-ts'),
  datetimeInput: document.getElementById('datetime-input'),
  timestampOutput: document.getElementById('timestamp-output'),
  btnConvertDt: document.getElementById('btn-convert-dt'),
  timezoneSelect: document.getElementById('timezone-select'),
  baseDate: document.getElementById('base-date'),
  dayOffset: document.getElementById('day-offset'),
  btnMinusDay: document.getElementById('btn-minus-day'),
  btnPlusDay: document.getElementById('btn-plus-day'),
  btnCalc: document.getElementById('btn-calc'),
  calcResult: document.getElementById('calc-result'),
  batchInput: document.getElementById('batch-input'),
  batchOutput: document.getElementById('batch-output'),
  btnBatchConvert: document.getElementById('btn-batch-convert'),
  btnBatchClear: document.getElementById('btn-batch-clear'),
  refTodayStart: document.getElementById('ref-today-start'),
  refTodayEnd: document.getElementById('ref-today-end'),
  refWeekStart: document.getElementById('ref-week-start'),
  refMonthStart: document.getElementById('ref-month-start'),
  refYearStart: document.getElementById('ref-year-start'),
  refUnixEpoch: document.getElementById('ref-unix-epoch'),
  toast: document.getElementById('toast'),
  unitRadios: document.querySelectorAll('input[name="unit"]')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
// 状态
let state = {
  timezone: 'local',
  updateInterval: null
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  updateCurrentTime();
  updateReferences();
  setBaseDateToNow();
  
  // 每秒更新时间
  state.updateInterval = setInterval(() => {
    updateCurrentTime();
  }, 1000);
  
  // 自动填充当前时间戳
  elements.timestampInput.value = Date.now();
  convertTimestampToDatetime();
});

/**
 * 初始化事件监听
 */
function initEventListeners() {
  // 刷新按钮
  elements.btnRefresh.addEventListener('click', () => {
    updateCurrentTime();
    updateReferences();
    showToast('已刷新', 'success');
  });
  
  // 转换按钮
  elements.btnConvertTs.addEventListener('click', convertTimestampToDatetime);
  elements.btnConvertDt.addEventListener('click', convertDatetimeToTimestamp);
  
  // 时区变化：重新渲染所有依赖时区的输出（当前时间、参考值、已填写的转换结果）
  elements.timezoneSelect.addEventListener('change', (e) => {
    state.timezone = e.target.value;
    updateCurrentTime();
    updateReferences();
    setBaseDateToNow();
    if (elements.timestampInput.value.trim()) convertTimestampToDatetime();
    showToast('已切换时区', 'success');
  });
  
  // 日期计算
  elements.btnMinusDay.addEventListener('click', () => {
    elements.dayOffset.value = parseInt(elements.dayOffset.value || 0, 10) - 1;
  });
  elements.btnPlusDay.addEventListener('click', () => {
    elements.dayOffset.value = parseInt(elements.dayOffset.value || 0, 10) + 1;
  });
  elements.btnCalc.addEventListener('click', calculateDate);
  
  // 批量转换
  elements.btnBatchConvert.addEventListener('click', batchConvert);
  elements.btnBatchClear.addEventListener('click', () => {
    elements.batchInput.value = '';
    elements.batchOutput.value = '';
  });
  
  // 回车转换
  elements.timestampInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') convertTimestampToDatetime();
  });
  
  // 监听消息
  window.addEventListener('message', handleMessage);
}

/**
 * 更新当前时间
 */
function updateCurrentTime() {
  const now = new Date();
  elements.currentTimestamp.textContent = Math.floor(now.getTime() / 1000);
  elements.currentDatetime.textContent = formatDateTime(now);
}

/**
 * 更新时间戳参考
 */
function updateReferences() {
  const now = new Date();
  
  // 今天开始
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  elements.refTodayStart.textContent = Math.floor(todayStart.getTime() / 1000);
  
  // 今天结束
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  elements.refTodayEnd.textContent = Math.floor(todayEnd.getTime() / 1000);
  
  // 本周开始（周日）
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  elements.refWeekStart.textContent = Math.floor(weekStart.getTime() / 1000);
  
  // 本月开始
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  elements.refMonthStart.textContent = Math.floor(monthStart.getTime() / 1000);
  
  // 本年开始
  const yearStart = new Date(now.getFullYear(), 0, 1);
  elements.refYearStart.textContent = Math.floor(yearStart.getTime() / 1000);
  
  // Unix纪元
  elements.refUnixEpoch.textContent = '0 (1970-01-01 00:00:00)';
}

/**
 * 时间戳转日期时间
 */
function convertTimestampToDatetime() {
  const input = elements.timestampInput.value.trim();
  if (!input) {
    showToast('请输入时间戳', 'error');
    return;
  }
  
  let timestamp = parseFloat(input);
  if (isNaN(timestamp)) {
    showToast('无效的时间戳', 'error');
    return;
  }
  
  // 判断单位
  const unit = document.querySelector('input[name="unit"]:checked').value;
  if (unit === 's') {
    timestamp *= 1000;
  }
  
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) {
    showToast('无效的时间戳', 'error');
    return;
  }
  
  elements.datetimeOutput.value = formatDateTime(date);
  showToast('转换成功', 'success');
  saveToHistory(input, 'ts-to-dt');
}

/**
 * 日期时间转时间戳
 */
function convertDatetimeToTimestamp() {
  const input = elements.datetimeInput.value;
  if (!input) {
    showToast('请选择日期时间', 'error');
    return;
  }
  
  // 按所选时区解释输入（而非浏览器本地时区）
  const ms = parseWallClockInZone(input);
  if (isNaN(ms)) {
    showToast('无效的日期时间', 'error');
    return;
  }
  
  const unit = document.querySelector('input[name="unit"]:checked').value;
  const timestamp = unit === 's' ? Math.floor(ms / 1000) : ms;
  
  elements.timestampOutput.value = timestamp;
  showToast('转换成功', 'success');
  saveToHistory(input, 'dt-to-ts');
}

/**
 * 日期计算
 */
function calculateDate() {
  const baseInput = elements.baseDate.value;
  const offset = parseInt(elements.dayOffset.value || 0, 10);
  
  if (!baseInput) {
    showToast('请选择基准日期', 'error');
    return;
  }
  
  // 基准日期按所选时区解释
  const baseMs = parseWallClockInZone(baseInput);
  if (isNaN(baseMs)) {
    showToast('无效的日期', 'error');
    return;
  }
  
  // 以 UTC 为中介做「按天加减」，避免夏令时导致的天数偏移
  const shifted = new Date(baseMs + getTimezoneOffsetMinutes() * 60000);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  const result = new Date(shifted.getTime() - getTimezoneOffsetMinutes() * 60000);
  
  elements.calcResult.value = formatDateTime(result);
  showToast('计算完成', 'success');
}

/**
 * 批量转换
 */
function batchConvert() {
  const input = elements.batchInput.value.trim();
  if (!input) {
    showToast('请输入要转换的内容', 'error');
    return;
  }
  
  const lines = input.split('\n');
  const results = [];
  
  lines.forEach(line => {
    line = line.trim();
    if (!line) {
      results.push('');
      return;
    }
    
    // 尝试作为时间戳转换
    const ts = parseFloat(line);
    // 边界取 >=：恰好等于 1000000000（2001-09-09T01:46:40Z）的秒级时间戳不应被判为无效
    if (!isNaN(ts) && ts >= 1000000000) {
      // 可能是时间戳
      const ms = line.length > 10 ? ts : ts * 1000;
      const date = new Date(ms);
      if (!isNaN(date.getTime())) {
        results.push(formatDateTime(date));
        return;
      }
    }
    
    // 尝试作为日期转换（同样按所选时区解释）
    const ms = parseWallClockInZone(line);
    if (!isNaN(ms)) {
      results.push(Math.floor(ms / 1000));
      return;
    }
    
    results.push('无效输入');
  });
  
  elements.batchOutput.value = results.join('\n');
  showToast('批量转换完成', 'success');
}

/**
 * 当前所选时区相对 UTC 的偏移（分钟）。
 * state.timezone 取值：'local' | 'UTC' | '+8' | '-5' | '+5.5' 等。
 * 旧实现只把下拉框的值存进 state.timezone，从未参与任何计算，
 * 于是"时区"选项对结果毫无影响。
 */
function getTimezoneOffsetMinutes() {
  const tz = state.timezone;
  if (!tz || tz === 'local') return -new Date().getTimezoneOffset();
  if (tz === 'UTC' || tz === '+0' || tz === '0') return 0;
  const hours = parseFloat(tz);
  return Number.isFinite(hours) ? Math.round(hours * 60) : -new Date().getTimezoneOffset();
}

/**
 * 把「所选时区的墙上时间」字符串（YYYY-MM-DDTHH:mm[:ss]）解析为真实毫秒时间戳。
 * 不能直接用 new Date(str)：那会按浏览器本地时区解释，与用户所选时区不符。
 */
function parseWallClockInZone(input) {
  const m = String(input).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return NaN;
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  return utcMs - getTimezoneOffsetMinutes() * 60000;
}

/**
 * 格式化日期时间（按当前所选时区）
 */
function formatDateTime(date) {
  // 先换算到目标时区的「墙上时间」，再用 UTC 取值输出，避免再次叠加本地偏移
  const shifted = new Date(date.getTime() + getTimezoneOffsetMinutes() * 60000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  const seconds = String(shifted.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 设置基准日期为当前时间
 */
function setBaseDateToNow() {
  // datetime-local 需要 `YYYY-MM-DDTHH:mm:ss` 形式；按所选时区取墙上时间
  elements.baseDate.value = formatDateTime(new Date()).replace(' ', 'T');
}

/**
 * 显示提示
 */
function showToast(message, type = 'info') {
  elements.toast.textContent = message;
  elements.toast.className = `toast toast--${type}`;
  elements.toast.classList.add('toast--show');
  
  setTimeout(() => {
    elements.toast.classList.remove('toast--show');
  }, 3000);
}

/**
 * 保存数据
 */
/**
 * 加载保存的数据
 */
/**
 * 保存到历史记录
 */
async function saveToHistory(input, action) {
  try {
    await safeSend({
      action: 'saveToHistory',
      data: {
        toolId: 'timestamp-converter',
        type: action,
        data: { input, action }
      }
    });
  } catch (error) {
    console.error('Save history failed:', error);
  }
}

/**
 * 处理来自父窗口的消息
 */
function handleMessage(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  const { action, data } = event.data;
  
  switch (action) {
    case 'setTheme':
      if (data && data.theme) document.documentElement.setAttribute('data-theme', data.theme);
      break;
    case 'setData':
      if (typeof data === 'string') {
        const ts = parseFloat(data.trim());
        if (!isNaN(ts)) {
          elements.timestampInput.value = ts;
          // 自动判断单位
          const isSeconds = data.trim().length <= 10;
          document.querySelector(`input[name="unit"][value="${isSeconds ? 's' : 'ms'}"]`).checked = true;
          convertTimestampToDatetime();
        }
      }
      break;
    case 'loadHistory':
      if (data && data.input) {
        elements.timestampInput.value = data.input;
        convertTimestampToDatetime();
      }
      break;
  }
}

// 页面卸载时清理
window.addEventListener('beforeunload', () => {
  if (state.updateInterval) {
    clearInterval(state.updateInterval);
  }
});
