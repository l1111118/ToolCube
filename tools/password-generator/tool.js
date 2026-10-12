/**
 * 密码生成器
 */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ', LOWER = 'abcdefghjkmnpqrstuvwxyz', NUMBERS = '23456789', SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?',
  UPPER_AMBIGUOUS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', LOWER_AMBIGUOUS = 'abcdefghijklmnopqrstuvwxyz', NUMBERS_AMBIGUOUS = '0123456789';

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

document.addEventListener('DOMContentLoaded', () => {
  const els = {
    display: document.getElementById('pw-display'), strengthBar: document.getElementById('strength-bar'),
    strengthText: document.getElementById('strength-text'), lengthRange: document.getElementById('length-range'),
    lengthValue: document.getElementById('length-value'), opts: ['opt-uppercase','opt-lowercase','opt-numbers','opt-symbols','opt-exclude'].map(id => document.getElementById(id)),
    toggleAuto: document.getElementById('toggle-auto'), historyList: document.getElementById('history-list')
  };
  const history = [];

  function generate() {
    if (!['opt-uppercase','opt-lowercase','opt-numbers','opt-symbols'].some((_,i) => els.opts[i].checked)) { els.display.textContent = '请至少选择一种字符类型'; return; }
    const exclude = els.opts[4].checked;
    let chars = '';
    if (els.opts[0].checked) chars += exclude ? UPPER_AMBIGUOUS : UPPER;
    if (els.opts[1].checked) chars += exclude ? LOWER_AMBIGUOUS : LOWER;
    if (els.opts[2].checked) chars += exclude ? NUMBERS_AMBIGUOUS : NUMBERS;
    if (els.opts[3].checked) chars += SYMBOLS;
    const len = parseInt(els.lengthRange.value, 10);
    const arr = new Uint32Array(len); crypto.getRandomValues(arr);
    let pw = ''; for (let i = 0; i < len; i++) pw += chars[arr[i] % chars.length];
    els.display.textContent = pw;
    updateStrength(pw);
    history.unshift(pw); if (history.length > 10) history.pop();
    renderHistory();
  }

  function updateStrength(pw) {
    let score = 0;
    if (pw.length >= 12) score++; if (pw.length >= 16) score++;
    if (/[A-Z]/.test(pw)) score++; if (/[a-z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++; if (/[^A-Za-z0-9]/.test(pw)) score++;
    const pct = Math.min(100, score * 16.7);
    const labels = ['','很弱','弱','一般','强','很强','极强'];
    els.strengthBar.style.width = pct + '%';
    els.strengthBar.style.background = pct < 33 ? '#dc3545' : pct < 66 ? '#ff9800' : '#4caf50';
    els.strengthText.textContent = labels[Math.min(score, 6)];
  }

  function renderHistory() {
    els.historyList.innerHTML = history.map((pw, i) => `<div class="pw-history-item" data-idx="${i}">${escapeHtml(pw)}</div>`).join('');
    els.historyList.querySelectorAll('.pw-history-item').forEach(el => el.addEventListener('click', () => { els.display.textContent = el.textContent; updateStrength(el.textContent); }));
  }

  els.lengthRange.addEventListener('input', () => { els.lengthValue.textContent = els.lengthRange.value; if (els.toggleAuto.checked) generate(); });
  els.opts.forEach(opt => opt.addEventListener('change', () => { if (els.toggleAuto.checked) generate(); }));
  els.toggleAuto.addEventListener('change', () => { if (els.toggleAuto.checked) generate(); });
  document.getElementById('btn-generate').addEventListener('click', generate);
  document.getElementById('btn-copy').addEventListener('click', () => navigator.clipboard.writeText(els.display.textContent).catch(() => {}));
  generate();
});
  // 主题切换消息监听
  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
  });
