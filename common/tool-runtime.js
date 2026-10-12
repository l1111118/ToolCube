/**
 * ToolCube - Tool Runtime（工具页共享运行时）
 *
 * 经典脚本（非 ES Module），由全部工具页在 `tool.js` 之前引入，
 * 与 `common/tool-i18n.js` 的引入方式一致。
 *
 * ## 为什么需要这一层
 *
 * 侧边栏与工具之间只靠 `postMessage` 通信，但工具页数量多、实现风格各异，
 * 有两类「宿主发起、工具应答」的消息不可能要求每个工具都实现：
 *
 *   1. `__getToolInput` —— 侧边栏在关闭工具前询问当前输入内容，用于「自动保存」。
 *      此前 86 个工具**无一实现**，导致设置页里「自动保存工具输入内容」开关
 *      永远只能超时、什么也存不下（典型的"看似有效实则无效"功能）。
 *   2. `setData` —— 宿主把外部数据（右键菜单选中的文本、自动保存的恢复值）交给工具。
 *      仅 41 个工具有自己的处理逻辑，其余工具的 `openToolWithData` 与自动保存恢复全部落空。
 *
 * 本运行时用一个**保守的兜底实现**补上这两条协议，不改动任何工具源码。
 *
 * ## 保守性设计（关键）
 *
 * - **绝不覆盖**：`setData` 只在目标输入为空时写入。若工具自身已处理并填充了输入，
 *   本运行时不介入（因此不会与工具的既有实现打架）。
 * - **延后一拍**：`setData` 用 `setTimeout(0)` 执行，让工具自身的同步处理器先跑完。
 * - **只认主输入框**：仅操作可见、可编辑的首个 `textarea` / 文本类 `input`；
 *   跳过 `[data-tool-runtime-skip]` 子树，跳过 `disabled` / `readonly` / 隐藏元素。
 * - **回退不报错**：找不到可用输入框时静默返回，工具功能不受影响。
 *
 * ## 安全边界
 *
 * 工具页是特权扩展页（可访问 `chrome.storage` / `chrome.runtime`），且
 * `web_accessible_resources` 含 `tools/**`，因此可能被第三方站点嵌入 iframe。
 * 与其他 86 个工具一致，这里**只接受同源消息**（`event.origin === location.origin`），
 * 恶意页面投递的 `setData` 会被直接丢弃。
 *
 * @version 1.3.0
 */

(function () {
  'use strict';

  /** 可作为「工具主输入」的控件：只收录纯文本类，避免误填滑块、颜色选择器等 */
  var PRIMARY_SELECTOR = [
    'textarea',
    'input[type="text"]',
    'input[type="search"]',
    'input[type="url"]',
    'input[type="email"]',
    'input[type="number"]',
    'input[type="password"]',
    'input:not([type])'
  ].join(',');

  /** 显式排除标记：工具可用它标注「不要当作主输入」的区域（如搜索/过滤框） */
  var SKIP_ATTRIBUTE = 'data-tool-runtime-skip';

  /**
   * 取「工具主输入」元素
   * 判定顺序即 DOM 顺序，取第一个可见、可编辑且未被显式排除的控件。
   * @returns {HTMLInputElement|HTMLTextAreaElement|null}
   */
  function pickPrimaryInput() {
    var candidates = document.querySelectorAll(PRIMARY_SELECTOR);
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (el.disabled || el.readOnly) continue;
      if (el.closest && el.closest('[' + SKIP_ATTRIBUTE + ']')) continue;
      // 不可见元素（折叠面板、隐藏 tab）不应被写入；getClientRects 为空即视为不可见
      if (el.getClientRects().length === 0) continue;
      return el;
    }
    return null;
  }

  /**
   * 从 setData 载荷中提取要填入的文本
   * 兼容三种形态：裸字符串、`{text|value|input|content}`、以及
   * `{action:'encode', text:'...'}` 这类「动作 + 内容」对象（取其中的文本字段）。
   * @param {*} payload
   * @returns {string} 无可提取文本时返回空串
   */
  function extractText(payload) {
    if (typeof payload === 'string') return payload;
    if (!payload || typeof payload !== 'object') return '';
    var keys = ['text', 'value', 'input', 'content'];
    for (var i = 0; i < keys.length; i++) {
      if (typeof payload[keys[i]] === 'string') return payload[keys[i]];
    }
    return '';
  }

  /**
   * 目标输入是否已有内容
   * 已有内容时**绝不覆盖** —— 工具自身可能已经处理了同一条 setData，
   * 覆盖会破坏它的结果（这是本运行时与工具既有实现能共存的前提）。
   * @param {HTMLInputElement|HTMLTextAreaElement} el
   * @returns {boolean}
   */
  function hasContent(el) {
    return typeof el.value === 'string' && el.value.length > 0;
  }

  /** 只接受本扩展自身页面发来的消息（工具页可能被第三方站点嵌入） */
  function isSameOrigin(event) {
    if (event.origin !== location.origin) return false;
    return true;
  }

  window.addEventListener('message', function (event) {
    if (!isSameOrigin(event)) return;
    var message = event.data;
    if (!message || typeof message !== 'object') return;

    // ---- 宿主询问当前输入（自动保存）----
    if (message.action === '__getToolInput') {
      var input = pickPrimaryInput();
      var value = input && typeof input.value === 'string' ? input.value : '';
      try {
        // 必须回带 __getToolInputResult，否则宿主的自动保存只能等到超时
        (event.source || window.parent).postMessage({
          action: '__getToolInputResult',
          data: value
        }, '*');
      } catch (err) { /* 宿主已卸载，忽略 */ }
      return;
    }

    // ---- 宿主下发数据（右键菜单传入 / 自动保存恢复）----
    if (message.action === 'setData') {
      var text = extractText(message.data);
      if (!text) return;
      // 延后一拍：若工具自身已处理 setData 并填充了输入，则不覆盖它的结果
      setTimeout(function () {
        var target = pickPrimaryInput();
        if (!target || hasContent(target)) return;
        target.value = text;
        // 触发 input 事件，让工具既有的实时预览 / 统计逻辑同步更新
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }, 0);
    }
  });
})();
