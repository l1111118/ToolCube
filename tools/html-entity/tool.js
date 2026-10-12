/**
 * HTML实体编解码工具
 */
document.addEventListener('DOMContentLoaded', () => {
  const els = {
    input: document.getElementById('input-area'), output: document.getElementById('output-area'),
    btnEncode: document.getElementById('btn-encode'), btnDecode: document.getElementById('btn-decode'),
    btnSwap: document.getElementById('btn-swap'), btnCopy: document.getElementById('btn-copy'),
    btnClear: document.getElementById('btn-clear'), mode: document.getElementById('encode-mode'),
    inputStatus: document.getElementById('input-status'), outputStatus: document.getElementById('output-status')
  };

  const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
  
  function encode() {
    const text = els.input.value;
    if (!text) return;
    const mode = els.mode.value;
    let result;
    if (mode === 'named') {
      result = text.replace(/[&<>"']/g, c => ENTITIES[c] || c);
    } else if (mode === 'numeric') {
      result = text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    } else {
      result = text.split('').map(c => { const code = c.charCodeAt(0); return (code >= 32 && code <= 126 && !/[&<>"']/.test(c)) ? c : `&#${code};`; }).join('');
    }
    els.output.value = result;
    els.outputStatus.textContent = `编码完成 | ${result.length} 字符`;
  }

  function decode() {
    const text = els.input.value;
    if (!text) return;
    const txt = document.createElement('textarea');
    txt.innerHTML = text;
    els.output.value = txt.value;
    els.outputStatus.textContent = `解码完成 | ${txt.value.length} 字符`;
  }

  els.btnEncode.addEventListener('click', encode);
  els.btnDecode.addEventListener('click', decode);
  els.btnSwap.addEventListener('click', () => { [els.input.value, els.output.value] = [els.output.value, els.input.value]; els.inputStatus.textContent = `${els.input.value.length} 字符`; els.outputStatus.textContent = `等待输入`; });
  els.btnCopy.addEventListener('click', () => { if (els.output.value) navigator.clipboard.writeText(els.output.value).catch(() => {}); });
  els.btnClear.addEventListener('click', () => { els.input.value = ''; els.output.value = ''; els.inputStatus.textContent = '0 字符'; els.outputStatus.textContent = '等待输入'; });
  els.input.addEventListener('input', () => els.inputStatus.textContent = `${els.input.value.length} 字符`);
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
