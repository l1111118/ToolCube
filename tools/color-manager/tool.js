/**
 * 颜色管理器
 */
const elements = {
  colorPicker: document.getElementById('color-picker'),
  colorPreview: document.getElementById('color-preview'),
  hexValue: document.getElementById('hex-value'),
  rgbValue: document.getElementById('rgb-value'),
  hslValue: document.getElementById('hsl-value'),
  cmykValue: document.getElementById('cmyk-value'),
  paletteGrid: document.getElementById('palette-grid'),
  shadesRow: document.getElementById('shades-row'),
  historyList: document.getElementById('history-list'),
  toast: document.getElementById('toast')
};

let colorHistory = [];

document.addEventListener('DOMContentLoaded', () => {
  elements.colorPicker.addEventListener('input', updateFromPicker);
  elements.hexValue.addEventListener('input', updateFromHex);
  
  document.querySelectorAll('.btn--icon').forEach(btn => {
    btn.addEventListener('click', () => {
      copyToClipboard(document.getElementById(btn.dataset.target).value);
    });
  });
  
  generatePalette();
  updateShades(elements.colorPicker.value);
  loadHistory();
  window.addEventListener('message', handleMessage);
});

function updateFromPicker() {
  const color = elements.colorPicker.value;
  updateColor(color);
}

function updateFromHex() {
  let hex = elements.hexValue.value.trim();
  if (!hex.startsWith('#')) hex = '#' + hex;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
    elements.colorPicker.value = hex;
    updateColor(hex);
  }
}

function updateColor(hex) {
  elements.colorPreview.style.background = hex;
  elements.hexValue.value = hex.toUpperCase();
  
  const rgb = hexToRgb(hex);
  elements.rgbValue.value = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  elements.hslValue.value = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
  
  const cmyk = rgbToCmyk(rgb.r, rgb.g, rgb.b);
  elements.cmykValue.value = `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`;
  
  updateShades(hex);
  addToHistory(hex);
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function rgbToCmyk(r, g, b) {
  let c = 1 - r / 255;
  let m = 1 - g / 255;
  let y = 1 - b / 255;
  let k = Math.min(c, m, y);
  
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  
  c = (c - k) / (1 - k);
  m = (m - k) / (1 - k);
  y = (y - k) / (1 - k);
  
  return {
    c: Math.round(c * 100),
    m: Math.round(m * 100),
    y: Math.round(y * 100),
    k: Math.round(k * 100)
  };
}

function updateShades(hex) {
  elements.shadesRow.innerHTML = '';
  const hsl = rgbToHsl(...Object.values(hexToRgb(hex)));
  
  for (let i = 0; i <= 10; i++) {
    const l = i * 10;
    const shade = hslToHex(hsl.h, hsl.s, l);
    const div = document.createElement('div');
    div.className = 'shade-color';
    div.style.background = shade;
    div.title = shade;
    div.addEventListener('click', () => {
      elements.colorPicker.value = shade;
      updateColor(shade);
    });
    elements.shadesRow.appendChild(div);
  }
}

function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generatePalette() {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
    '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
    '#f43f5e', '#78716c', '#57534e', '#44403c', '#292524',
    '#dc2626', '#ea580c', '#d97706', '#65a30d', '#16a34a',
    '#059669', '#0d9488', '#0891b2', '#0284c7', '#2563eb'
  ];
  
  colors.forEach(color => {
    const div = document.createElement('div');
    div.className = 'palette-color';
    div.style.background = color;
    div.title = color;
    div.addEventListener('click', () => {
      elements.colorPicker.value = color;
      updateColor(color);
    });
    elements.paletteGrid.appendChild(div);
  });
}

function addToHistory(color) {
  if (colorHistory.includes(color)) return;
  colorHistory.unshift(color);
  if (colorHistory.length > 10) colorHistory.pop();
  saveHistory();
  renderHistory();
}

/**
 * 持久化历史色板。
 * 旧实现只在 loadHistory 里读 localStorage，从来没有写入过 ——
 * 因此"历史"永远是空的，读的是一个永不存在的键。
 */
function saveHistory() {
  try {
    localStorage.setItem('color-history', JSON.stringify(colorHistory));
  } catch (e) { /* 隐私模式等场景下写入失败，不影响当前会话使用 */ }
}

function renderHistory() {
  elements.historyList.innerHTML = '';
  colorHistory.forEach(color => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.style.background = color;
    div.title = color;
    div.addEventListener('click', () => {
      elements.colorPicker.value = color;
      updateColor(color);
    });
    elements.historyList.appendChild(div);
  });
}

function loadHistory() {
  // 从localStorage加载历史
  const saved = localStorage.getItem('color-history');
  if (saved) {
    try {
      colorHistory = JSON.parse(saved);
      renderHistory();
    } catch (e) {
      colorHistory = [];
    }
  }
}

async function copyToClipboard(text) {
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
    let color = data.trim();
    if (!color.startsWith('#')) color = '#' + color;
    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
      elements.colorPicker.value = color;
      updateColor(color);
    }
  }
}
