/**
 * ToolCube - 工具页 i18n 运行时（经典脚本，供 86 个工具页共享）
 *
 * 为什么按「原文匹配」而不是给每个元素加 data-i18n：
 *   86 个工具页共约 3500 条文案，且相当一部分是 JS 动态生成后插入 DOM 的，
 *   逐条加属性既容易漏、也覆盖不到动态内容。这里以「中文原文 → 译文」字典
 *   在渲染后统一替换，静态与动态文案一并覆盖，且**无需改动任何工具源码**。
 *
 * 安全边界（避免误译用户数据）：
 *   - 只改**文本节点**与 placeholder/title/aria-label/alt，**绝不碰 input/textarea 的 value**；
 *   - 跳过 script/style/textarea/pre/code/kbd/samp 及带 [data-i18n-skip] 的子树，
 *     这样代码片段、示例文本、用户输入都不会被当作界面文案；
 *   - 未命中字典的文案**原样保留**（回退中文），不会出现空白或乱码；
 *   - zh-CN 是文案源语言，不做任何替换。
 *
 * 加载方式：工具页在 tool.js 之前引入本文件与 tool-i18n-dict.js。
 * 语言取自 chrome.storage.local 的 toolbox_settings.language，并监听其变化。
 */
(function () {
  'use strict';

  var DICT = (typeof window !== 'undefined' && window.TOOL_I18N) || null;
  // 直接以 file:// 打开工具页调试时没有字典，此时静默退出，不影响功能
  if (!DICT) return;

  // 这些标签内的文本属于代码 / 用户输入，不能翻译
  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, SELECT: 1, OPTION: 1,
    PRE: 1, CODE: 1, KBD: 1, SAMP: 1, NOSCRIPT: 1, TITLE: 1
  };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var HAS_CN = /[\u4e00-\u9fff]/;

  var locale = 'zh-CN';
  var table = null;      // 当前语言的字典（zh-CN 时为 null）
  var observer = null;
  var pending = 0;

  /** 查表；未命中返回 null（调用方据此保留原文） */
  function translate(text) {
    if (!table || !text) return null;
    var key = text.trim();
    if (!key || !HAS_CN.test(key)) return null;
    var hit = table[key];
    return hit === undefined ? null : hit;
  }

  /** 元素自身或祖先是否被标记为不翻译 */
  function isSkipped(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hasAttribute && n.hasAttribute('data-i18n-skip')) return true;
    }
    return false;
  }

  /** 翻译一个子树内的文本节点与属性 */
  function translateTree(root) {
    if (!root) return;
    if (root.nodeType === 1) {
      if (SKIP_TAGS[root.nodeName] || isSkipped(root)) return;
      for (var i = 0; i < ATTRS.length; i++) {
        var a = ATTRS[i];
        if (root.hasAttribute(a)) {
          var t = translate(root.getAttribute(a));
          if (t !== null) root.setAttribute(a, t);
        }
      }
    }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentNode;
      if (!parent || parent.nodeType !== 1) continue;
      if (SKIP_TAGS[parent.nodeName] || isSkipped(parent)) continue;
      var out = translate(node.nodeValue);
      if (out !== null) node.nodeValue = out;
    }
  }

  /** 同一次渲染往往触发多次变更，去抖后统一处理 */
  function scheduleTranslate(root) {
    if (pending) clearTimeout(pending);
    pending = setTimeout(function () {
      pending = 0;
      translateTree(root || document.body);
    }, 30);
  }

  function setLocale(lang) {
    locale = lang || 'zh-CN';
    table = locale === 'zh-CN' ? null : (DICT[locale] || null);
    if (!table) return;
    translateTree(document.body);
    if (!observer) {
      observer = new MutationObserver(function (records) {
        // 只关心新增/改动的节点；避免因自身改写 nodeValue 造成的回环
        for (var i = 0; i < records.length; i++) {
          if (records[i].type === 'childList' && records[i].addedNodes.length) {
            scheduleTranslate(document.body);
            return;
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function readLocale() {
    try {
      chrome.storage.local.get('toolbox_settings', function (r) {
        var s = r && r.toolbox_settings;
        setLocale((s && s.language) || 'zh-CN');
      });
    } catch (e) {
      // 非扩展环境：保持中文，不做任何处理
    }
  }

  function onStorageChanged(changes, area) {
    if (area !== 'local' || !changes.toolbox_settings) return;
    var s = changes.toolbox_settings.newValue;
    setLocale((s && s.language) || 'zh-CN');
  }

  function init() {
    readLocale();
    try {
      chrome.storage.onChanged.addListener(onStorageChanged);
    } catch (e) { /* 非扩展环境 */ }
    // 页面脚本可能在 DOMContentLoaded 之后才填充内容，这里再兜一次
    window.addEventListener('load', function () { scheduleTranslate(document.body); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 暴露给测试与工具脚本使用
  window.ToolI18n = { translate: translate, translateTree: translateTree, setLocale: setLocale };
})();
