/**
 * Unicode转换工具
 */
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('input-area'), output = document.getElementById('output-area'),
    inputStatus = document.getElementById('input-status'), outputStatus = document.getElementById('output-status');

  function toUnicode() {
    const text = input.value;
    if (!text) return;
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 127) result += '\\u' + code.toString(16).padStart(4, '0').toUpperCase();
      else result += text[i];
    }
    output.value = result; outputStatus.textContent = `转换完成 | ${result.length} 字符`;
  }

  function fromUnicode() {
    const text = input.value;
    if (!text) return;
    try {
      const result = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      output.value = result; outputStatus.textContent = `转换完成 | ${result.length} 字符`;
    } catch(e) { output.value = '转换失败: ' + e.message; }
  }

  document.getElementById('btn-to-unicode').addEventListener('click', toUnicode);
  document.getElementById('btn-from-unicode').addEventListener('click', fromUnicode);
  document.getElementById('btn-swap').addEventListener('click', () => { [input.value, output.value] = [output.value, input.value]; inputStatus.textContent = `${input.value.length} 字符`; });
  document.getElementById('btn-copy').addEventListener('click', () => { if (output.value) navigator.clipboard.writeText(output.value).catch(() => {}); });
  document.getElementById('btn-clear').addEventListener('click', () => { input.value = ''; output.value = ''; inputStatus.textContent = '0 字符'; outputStatus.textContent = '等待输入'; });
  input.addEventListener('input', () => inputStatus.textContent = `${input.value.length} 字符`);
  toUnicode(); if (input.value) toUnicode();
});
  // 主题切换消息监听
  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
    // 也处理 setData 消息（从 sidebar 传入参数）
    if (event.data && event.data.action === 'setData') {
      const inputArea = document.getElementById('input-area');
      if (inputArea && typeof event.data.data === 'string') {
        inputArea.value = event.data.data;
        inputArea.dispatchEvent(new Event('input'));
      }
    }
  });
