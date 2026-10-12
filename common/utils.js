/**
 * ToolCube - Common Utilities
 *
 * 跨页面共享的通用函数。**只收录真正被引用的实现**：
 * 早期这里堆积了约 60 个「可能有用」的辅助函数（编解码、颜色换算、进制转换、
 * 深拷贝、Worker 执行器等），实测只有下面 4 个被任何页面引用，其余全部是死代码 ——
 * 既增加阅读成本，也会让后续维护者误以为它们已被使用（例如 `runInWorker`
 * 通过 Blob 动态求值，与扩展页 `script-src 'self'` 的 CSP 约束天然冲突）。
 *
 * 需要新增共享函数时，请连同调用方一起提交，避免再次形成"只增不减"的堆积。
 *
 * @version 1.3.0
 */

// ==================== 防抖 ====================

/**
 * 防抖函数
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @param {boolean} immediate - 是否首次调用立即执行
 * @returns {Function} 防抖后的函数
 */
export function debounce(func, wait = 300, immediate = false) {
  let timeout;

  return function executedFunction(...args) {
    const context = this;

    const later = () => {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };

    const callNow = immediate && !timeout;

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);

    if (callNow) func.apply(context, args);
  };
}

// ==================== 字符串 ====================

/**
 * 截断字符串
 * @param {string} str - 原字符串
 * @param {number} length - 最大长度
 * @param {string} suffix - 后缀
 * @returns {string} 截断后的字符串
 */
export function truncate(str, length = 100, suffix = '...') {
  if (str.length <= length) return str;
  return str.substring(0, length - suffix.length) + suffix;
}

// ==================== HTML 转义 ====================

/**
 * HTML 转义
 *
 * 所有把外部数据（服务器响应、页面内容、剪贴板、用户输入）拼进 `innerHTML`
 * 的地方都必须先经过这里，否则会形成 XSS 入口。
 *
 * @param {string} str - 要转义的字符串
 * @returns {string} 转义后的字符串
 */
export function escapeHTML(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/**
 * HTML 转义别名（与 escapeHTML 完全一致）
 *
 * 保留两个名字是为了兼容两类调用方的既有写法（`escapeHtml` 为各页面历史命名），
 * 二者共用同一实现，不会出现"改了一处漏了另一处"。
 */
export function escapeHtml(str) {
  return escapeHTML(str);
}
