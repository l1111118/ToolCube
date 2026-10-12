/**
 * JWT解码工具
 */
document.addEventListener('DOMContentLoaded', () => {
  const els = {
    input: document.getElementById('input-area'), output: document.getElementById('output-area'),
    btnDecode: document.getElementById('btn-decode'), btnCopyHeader: document.getElementById('btn-copy-header'),
    btnCopyPayload: document.getElementById('btn-copy-payload'), btnCopy: document.getElementById('btn-copy'),
    btnClear: document.getElementById('btn-clear'), btnPaste: document.getElementById('btn-paste'),
    inputStatus: document.getElementById('input-status'), outputStatus: document.getElementById('output-status'),
    validIcon: document.getElementById('validation-icon'), validText: document.getElementById('validation-text'),
    errorToast: document.getElementById('error-toast'), errorMsg: document.getElementById('error-message')
  };
  function escapeHtml(str) { if (str == null) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  
  els.btnDecode.addEventListener('click', decodeJWT);
  els.btnCopy.addEventListener('click', () => copyText(els.output.innerText));
  els.btnClear.addEventListener('click', () => { els.input.value = ''; els.output.innerHTML = '<div class="jwt-empty">请输入JWT Token进行解码</div>'; updateInputStatus(); });
  els.btnPaste.addEventListener('click', () => navigator.clipboard.readText().then(t => { els.input.value = t; updateInputStatus(); }));
  els.input.addEventListener('input', updateInputStatus);
  document.getElementById('error-close').addEventListener('click', () => els.errorToast.classList.remove('error-toast--show'));
  
  function updateInputStatus() { els.inputStatus.textContent = `${els.input.value.length} 字符`; }
  
  function decodeJWT() {
    const token = els.input.value.trim();
    if (!token) { showError('请输入JWT Token'); return; }
    const parts = token.split('.');
    if (parts.length !== 3) { showError('无效的JWT格式，应为 header.payload.signature'); setValidation('invalid'); return; }
    try {
      const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      const now = Math.floor(Date.now() / 1000);
      const expired = payload.exp && payload.exp < now;
      const issuedAt = payload.iat ? new Date(payload.iat * 1000).toLocaleString('zh-CN') : 'N/A';
      const expiresAt = payload.exp ? new Date(payload.exp * 1000).toLocaleString('zh-CN') : 'N/A';
      const remaining = payload.exp ? Math.floor((payload.exp - now) / 60) : null;

      function makeSection(title, codeText) {
        const section = document.createElement('div');
        section.className = 'jwt-section';
        const h4 = document.createElement('h4');
        h4.textContent = title;
        const pre = document.createElement('pre');
        pre.className = 'jwt-code';
        pre.textContent = codeText;
        section.appendChild(h4);
        section.appendChild(pre);
        return section;
      }
      els.output.innerHTML = '';
      els.output.appendChild(makeSection('📋 Header', JSON.stringify(header, null, 2)));
      els.output.appendChild(makeSection('📦 Payload', JSON.stringify(payload, null, 2)));
      const sigSection = document.createElement('div');
      sigSection.className = 'jwt-section';
      sigSection.innerHTML = '<h4>🔑 Signature</h4><code class="jwt-sig"></code>';
      sigSection.querySelector('.jwt-sig').textContent = parts[2].substring(0, 20) + '...';
      els.output.appendChild(sigSection);
      const timeSection = document.createElement('div');
      timeSection.className = 'jwt-section';
      timeSection.innerHTML = '<h4>⏰ 时间信息</h4><table class="jwt-table"><tr><td>签发时间 (iat)</td><td></td></tr><tr><td>过期时间 (exp)</td><td></td></tr><tr><td>状态</td><td></td></tr></table>';
      const tds = timeSection.querySelectorAll('td');
      tds[1].textContent = issuedAt;
      tds[3].textContent = expiresAt;
      const statusSpan = document.createElement('span');
      statusSpan.className = expired ? 'jwt-expired' : 'jwt-valid';
      statusSpan.textContent = expired ? '❌ 已过期' : '✅ 有效' + (remaining !== null ? ` (剩余${remaining}分钟)` : '');
      tds[5].appendChild(statusSpan);
      els.output.appendChild(timeSection);
      setValidation('valid');
      els.outputStatus.textContent = '解码成功';
    } catch (e) { showError('解码失败: ' + escapeHtml(e.message)); setValidation('invalid'); }
  }
  
  els.btnCopyHeader.addEventListener('click', () => { const t = els.input.value.trim().split('.'); if (t[0]) try { copyText(JSON.stringify(JSON.parse(atob(t[0].replace(/-/g,'+').replace(/_/g,'/'))), null, 2)); } catch(e) { showError('复制失败'); } });
  els.btnCopyPayload.addEventListener('click', () => { const t = els.input.value.trim().split('.'); if (t[1]) try { copyText(JSON.stringify(JSON.parse(atob(t[1].replace(/-/g,'+').replace(/_/g,'/'))), null, 2)); } catch(e) { showError('复制失败'); } });
  
  function setValidation(s) {
    if (s === 'valid') { els.validIcon.textContent = '✅'; els.validText.textContent = 'JWT解码成功'; }
    else if (s === 'invalid') { els.validIcon.textContent = '❌'; els.validText.textContent = 'JWT格式无效'; }
  }
  function showError(msg) { els.errorMsg.textContent = msg; els.errorToast.classList.add('error-toast--show'); setTimeout(() => els.errorToast.classList.remove('error-toast--show'), 4000); }
  async function copyText(t) { try { await navigator.clipboard.writeText(t); showError('已复制到剪贴板'); } catch(e) { showError('复制失败'); } }
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
