/**
 * 进制转换器
 */
const elements = {
  binInput: document.getElementById('bin-input'),
  octInput: document.getElementById('oct-input'),
  decInput: document.getElementById('dec-input'),
  hexInput: document.getElementById('hex-input'),
  btnClear: document.getElementById('btn-clear'),
  toast: document.getElementById('toast')
};

const inputs = [elements.binInput, elements.octInput, elements.decInput, elements.hexInput];

document.addEventListener('DOMContentLoaded', () => {
  inputs.forEach(input => {
    input.addEventListener('input', () => convertFrom(input));
  });
  
  elements.btnClear.addEventListener('click', () => {
    inputs.forEach(i => i.value = '');
  });
  
  document.querySelectorAll('.btn--icon').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      copyToClipboard(target.value);
    });
  });
  
  window.addEventListener('message', handleMessage);
});

/**
 * 按指定进制解析为 BigInt
 *
 * 为什么必须用 BigInt：parseInt 返回 double，超过 Number.MAX_SAFE_INTEGER（2^53-1）后会静默丢精度。
 * 例如 0xFFFFFFFFFFFFFFFF 会被解析成 18446744073709552000（正确值为 18446744073709551615），
 * 转成二进制后完全错误。BigInt 可精确表示任意大整数。
 *
 * @param {string} value 已通过字符集校验的字符串
 * @param {number} base 2 | 8 | 10 | 16
 * @returns {bigint|null} 解析失败返回 null
 */
function parseBigInt(value, base) {
  const v = value.trim();
  if (!v) return null;
  try {
    switch (base) {
      case 2: return BigInt('0b' + v);
      case 8: return BigInt('0o' + v);
      case 16: return BigInt('0x' + v);
      case 10: return BigInt(v);
      default: return null;
    }
  } catch (e) {
    return null;
  }
}

function convertFrom(source) {
  const value = source.value.trim();
  const base = parseInt(source.dataset.base, 10);
  
  if (!value) {
    inputs.forEach(i => { if (i !== source) i.value = ''; });
    return;
  }
  
  // 验证输入
  const validChars = getValidChars(base);
  const regex = new RegExp(`^[${validChars}]+$`, 'i');
  if (!regex.test(value)) {
    source.style.borderColor = '#f44336';
    return;
  }
  source.style.borderColor = 'var(--tt-primary)';
  
  // 转换为十进制（使用 BigInt，避免大整数精度丢失）
  const decimal = parseBigInt(value, base);
  if (decimal === null) return;

  // 更新其他输入
  if (source !== elements.binInput) elements.binInput.value = decimal.toString(2);
  if (source !== elements.octInput) elements.octInput.value = decimal.toString(8);
  if (source !== elements.decInput) elements.decInput.value = decimal.toString(10);
  if (source !== elements.hexInput) elements.hexInput.value = decimal.toString(16).toUpperCase();
}

function getValidChars(base) {
  switch (base) {
    case 2: return '01';
    case 8: return '0-7';
    case 10: return '0-9';
    case 16: return '0-9a-f';
    default: return '0-9';
  }
}

async function copyToClipboard(text) {
  if (!text) { showToast('没有可复制的内容', 'error'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制', 'success');
  } catch (e) { showToast('复制失败', 'error'); }
}

function showToast(msg, type = 'info') {
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(() => elements.toast.classList.remove('toast--show'), 3000);
}

function handleMessage(e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  const { action, data } = e.data;
  if (action === 'setTheme' && data && data.theme) { document.documentElement.setAttribute('data-theme', data.theme); return; }
  if (action === 'setData' && typeof data === 'string') {
    const val = data.trim();
    // 自动识别进制：只处理「无歧义」的情形。
    // 早期实现先判 /^[01]+$/ 为二进制，导致 "10"、"101" 这类常见十进制输入被误判；
    // 二进制与十进制在纯 0/1 串上本质上无法区分，因此这里不再猜测二进制，
    // 而是「含 a-f 字母 → 十六进制，否则 → 十进制」，用户可自行改填到目标输入框。
    if (/[a-f]/i.test(val)) {
      elements.hexInput.value = val;
      convertFrom(elements.hexInput);
    } else if (/^[0-9]+$/.test(val)) {
      elements.decInput.value = val;
      convertFrom(elements.decInput);
    }
  }
}
