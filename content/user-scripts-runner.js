/**
 * 用户自定义脚本注入运行器 - 内容脚本
 * 由 chrome.scripting.registerContentScripts 注册，Chrome 自动在每次导航时注入
 * 运行在 ISOLATED world, document_start，可访问 chrome.storage API
 * 读取用户配置的脚本规则，通过 <script>/<style> 元素注入到页面 MAIN world
 */
(async function() {
  'use strict';

  try {
    // 幂等守卫：使用 ISOLATED world 自身的全局变量，而非宿主页面的 DOM 属性。
    // 原因：本脚本由 registerContentScripts 与 executeScript 两条路径注入，可能重复执行；
    // 若把标记写在 document.documentElement.dataset 上，页面脚本可以读取并篡改它
    // （例如自行设置该属性即可让用户自定义脚本永不生效）。ISOLATED world 的全局对象
    // 与页面隔离，页面无法访问或修改。
    if (window.__toolboxUserScriptsInjected) return;
    window.__toolboxUserScriptsInjected = true;

    if (!chrome?.runtime?.id) return;
    const stored = await chrome.storage.local.get('toolbox_script_injector');
    const config = stored.toolbox_script_injector;
    if (!config?.enabled || !config.rules?.length) return;

    const pageUrl = window.location.href;
    const pendingJS = [];
    const pendingCSS = [];

    for (const rule of config.rules) {
      if (rule.disabled) continue;

      // URL 匹配检查
      const patterns = rule.matches || rule.urlPatterns || [];
      if (patterns.length > 0) {
        const matched = patterns.some(pattern => {
          try {
            // 将通配符模式转换为正则表达式
            const regexStr = pattern
              .replace(/[.+^${}()|[\]\\]/g, '\\$&')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.');
            return new RegExp(regexStr).test(pageUrl);
          } catch (e) {
            return false;
          }
        });
        if (!matched) continue;
      } else {
        // 无URL模式 = 匹配所有页面
      }

      // 收集待注入的脚本和样式
      if (rule.type === 'css' && rule.css) {
        pendingCSS.push(rule.css);
      } else if (rule.code) {
        pendingJS.push({
          code: rule.code,
          runAt: rule.runAt || 'document_idle'
        });
      }
    }

    // 注入 CSS（同步，立即生效）
    if (pendingCSS.length > 0) {
      const style = document.createElement('style');
      style.textContent = pendingCSS.join('\n');
      (document.documentElement || document.head || document.body).prepend(style);
    }

    // 注入 JS（通过 <script> 元素注入到 MAIN world）
    for (const script of pendingJS) {
      if (script.runAt === 'document_start') {
        // 立即注入
        injectScript(script.code);
      } else if (script.runAt === 'document_end') {
        // DOMContentLoaded 时注入（若已触发则立即注入）
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function() {
            injectScript(script.code);
          });
        } else {
          injectScript(script.code);
        }
      } else {
        // document_idle - 页面加载完成后注入（修复：readyState 判断在 DOMContentLoaded 回调内
        // 恒为 interactive 导致延迟到 load 的问题；动态注入时若已过 DOMContentLoaded 则直接注入）
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function() {
            if (document.readyState === 'complete') {
              injectScript(script.code);
            } else {
              window.addEventListener('load', function() {
                injectScript(script.code);
              });
            }
          });
        } else {
          injectScript(script.code);
        }
      }
    }
  } catch (e) {
    console.error('[Toolbox User Scripts Runner] Error:', e);
  }

  function injectScript(code) {
    try {
      const scriptEl = document.createElement('script');
      scriptEl.textContent = code;
      (document.documentElement || document.head || document.body).prepend(scriptEl);
      scriptEl.remove();
    } catch (e) {
      console.error('[Toolbox User Scripts Runner] Inject error:', e);
    }
  }
})();
