/**
 * Color Picker Tool - 屏幕取色器
 * 支持 EyeDropper API 屏幕取色（Chrome/Edge），
 * Firefox 等不支持时降级到上传截图取色、调色板、手动输入
 */
document.addEventListener('DOMContentLoaded', () => {
  let currentColor = '#5b7fff';
  let history = loadHistory();

  const swatch = document.getElementById('cp-swatch');
  const hexInput = document.getElementById('cp-hex');
  const rgbInput = document.getElementById('cp-rgb');
  const hslInput = document.getElementById('cp-hsl');
  const customInput = document.getElementById('cp-custom-input');
  const historyGrid = document.getElementById('cp-history-grid');
  const dropZone = document.getElementById('cp-dropzone');
  const imagePicker = document.getElementById('cp-image-picker');
  const imageFile = document.getElementById('cp-image-file');
  const imageCanvas = document.getElementById('cp-image-canvas');
  const pickTip = document.getElementById('cp-pick-tip');

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return { r, g, b };
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function updateDisplay(hex) {
    currentColor = hex;
    swatch.style.background = hex;
    hexInput.value = hex;
    const { r, g, b } = hexToRgb(hex);
    rgbInput.value = `rgb(${r}, ${g}, ${b})`;
    const hsl = rgbToHsl(r, g, b);
    hslInput.value = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
    renderHistory();
  }

  function parseColor(str) {
    str = str.trim();
    if (/^#[0-9a-f]{6}$/i.test(str)) return str;
    if (/^#[0-9a-f]{3}$/i.test(str)) {
      return '#' + str[1]+str[1]+str[2]+str[2]+str[3]+str[3];
    }
    const rgbMatch = str.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (rgbMatch) {
      const toHex = (n) => parseInt(n, 10).toString(16).padStart(2, '0');
      return '#' + toHex(rgbMatch[1]) + toHex(rgbMatch[2]) + toHex(rgbMatch[3]);
    }
    const hslMatch = str.match(/hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/);
    if (hslMatch) {
      const h = parseInt(hslMatch[1], 10) / 360;
      const s = parseInt(hslMatch[2], 10) / 100;
      const l = parseInt(hslMatch[3], 10) / 100;
      const rgb = hslToRgb(h, s, l);
      const toHex = (n) => Math.round(n).toString(16).padStart(2, '0');
      return '#' + toHex(rgb.r) + toHex(rgb.g) + toHex(rgb.b);
    }
    return null;
  }

  function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) { r = g = b = l; }
    else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return { r: r * 255, g: g * 255, b: b * 255 };
  }

  function loadHistory() {
    try {
      return JSON.parse(localStorage.getItem('toolbox_color_history') || '[]');
    } catch(e) { return []; }
  }

  function saveHistory() {
    try {
      localStorage.setItem('toolbox_color_history', JSON.stringify(history.slice(0, 20)));
    } catch(e) {}
  }

  function addToHistory(hex) {
    history = history.filter(h => h !== hex);
    history.unshift(hex);
    if (history.length > 20) history = history.slice(0, 20);
    saveHistory();
    renderHistory();
  }

  function renderHistory() {
    historyGrid.innerHTML = history.map(h =>
      `<div class="cp-history-item" style="background:${h}" title="${h}" data-color="${h}"></div>`
    ).join('');
    historyGrid.querySelectorAll('.cp-history-item').forEach(item => {
      item.addEventListener('click', () => updateDisplay(item.dataset.color));
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch(e) {}
  }

  // 屏幕取色（EyeDropper API）
  document.getElementById('btn-pick').addEventListener('click', async () => {
    if (!window.EyeDropper) {
      // Firefox 等不支持 EyeDropper 的浏览器：切换到图片取色模式
      if (imagePicker) {
        imagePicker.style.display = 'block';
        if (pickTip) pickTip.style.display = 'block';
        // 自动触发文件选择
        if (imageFile) imageFile.click();
      } else {
        alert('您的浏览器不支持屏幕取色功能，请使用 Chrome 95+ 或 Edge 95+，或使用下方调色板/手动输入');
      }
      return;
    }
    try {
      const dropper = new EyeDropper();
      const result = await dropper.open();
      updateDisplay(result.sRGBHex);
      addToHistory(result.sRGBHex);
    } catch(e) {
      // 用户取消
    }
  });

  // ============ 图片取色（Firefox 降级方案） ============
  if (imageFile) {
    imageFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          // 缩放到合适尺寸显示
          const maxW = 480;
          const scale = Math.min(1, maxW / img.width);
          imageCanvas.width = img.width * scale;
          imageCanvas.height = img.height * scale;
          const ctx = imageCanvas.getContext('2d');
          ctx.drawImage(img, 0, 0, imageCanvas.width, imageCanvas.height);
          imageCanvas.style.display = 'block';
          if (pickTip) pickTip.textContent = '👆 点击图片任意位置取色';
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });

    imageCanvas.addEventListener('click', (e) => {
      const rect = imageCanvas.getBoundingClientRect();
      const scaleX = imageCanvas.width / rect.width;
      const scaleY = imageCanvas.height / rect.height;
      const x = Math.floor((e.clientX - rect.left) * scaleX);
      const y = Math.floor((e.clientY - rect.top) * scaleY);
      const ctx = imageCanvas.getContext('2d');
      try {
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]]
          .map(v => v.toString(16).padStart(2, '0')).join('');
        updateDisplay(hex);
        addToHistory(hex);
      } catch (err) {
        if (pickTip) pickTip.textContent = '❌ 取色失败: ' + err.message;
      }
    });

    // 拖放图片
    if (dropZone) {
      dropZone.addEventListener('click', () => imageFile.click());
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
          imageFile.files = e.dataTransfer.files;
          imageFile.dispatchEvent(new Event('change'));
        }
      });
    }
  }

  // 随机色
  document.getElementById('btn-random').addEventListener('click', () => {
    const hex = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    updateDisplay(hex);
    addToHistory(hex);
  });

  // 调色板 - 显示系统颜色选择器
  document.getElementById('btn-palette').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = currentColor;
    input.addEventListener('input', () => updateDisplay(input.value));
    input.addEventListener('change', () => {
      updateDisplay(input.value);
      addToHistory(input.value);
    });
    input.click();
  });

  // 手动输入
  document.getElementById('btn-apply-custom').addEventListener('click', () => {
    const parsed = parseColor(customInput.value);
    if (parsed) {
      updateDisplay(parsed);
      addToHistory(parsed);
      customInput.value = '';
    } else {
      // 简单视觉反馈
      customInput.style.borderColor = 'red';
      setTimeout(() => customInput.style.borderColor = '', 1000);
    }
  });

  // 回车应用
  customInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btn-apply-custom').click();
    }
  });

  // 复制按钮
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.copy;
      const input = document.getElementById(id);
      if (input) {
        copyText(input.value);
        const orig = btn.textContent;
        btn.textContent = '✅';
        setTimeout(() => btn.textContent = orig, 1200);
      }
    });
  });

  renderHistory();
  updateDisplay('#5b7fff');

  window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    if (e.data && e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
  });
});
