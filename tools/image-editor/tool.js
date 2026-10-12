/**
 * Image Editor Tool - 图片编辑器
 * Canvas操作: 旋转/翻转/滤镜
 */
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('ie-canvas');
  const ctx = canvas.getContext('2d');
  const placeholder = document.getElementById('ie-placeholder');
  const infoEl = document.getElementById('ie-info');
  const fileInput = document.getElementById('file-input');
  let originalImage = null;
  let currentFilter = 'none';
  let rotation = 0;
  let flipH = false;
  let flipV = false;

  function loadImage(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        originalImage = img;
        rotation = 0;
        flipH = false;
        flipV = false;
        currentFilter = 'none';
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.filter-btn[data-filter="none"]')?.classList.add('active');
        placeholder.style.display = 'none';
        canvas.style.display = 'block';
        document.getElementById('ie-filters').style.display = 'flex';
        infoEl.textContent = `${img.naturalWidth}×${img.naturalHeight} | ${(file.size/1024).toFixed(1)}KB`;
        renderCanvas();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function renderCanvas() {
    if (!originalImage) return;
    // 计算旋转后的尺寸
    const isRotated90 = rotation % 180 !== 0;
    const w = isRotated90 ? originalImage.height : originalImage.width;
    const h = isRotated90 ? originalImage.width : originalImage.height;

    // 适应容器
    const container = canvas.parentElement;
    const maxW = container.clientWidth - 32;
    const maxH = container.clientHeight - 32;
    const scale = Math.min(maxW / w, maxH / h, 1);
    canvas.width = w * scale;
    canvas.height = h * scale;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.filter = getFilter();
    ctx.drawImage(originalImage, -originalImage.width * scale / 2, -originalImage.height * scale / 2,
      originalImage.width * scale, originalImage.height * scale);
    ctx.restore();
  }

  function getFilter() {
    switch (currentFilter) {
      case 'grayscale': return 'grayscale(100%)';
      case 'sepia': return 'sepia(80%)';
      case 'invert': return 'invert(100%)';
      case 'blur': return 'blur(3px)';
      case 'brightness': return 'brightness(1.5)';
      case 'contrast': return 'contrast(1.8)';
      default: return 'none';
    }
  }

  // 文件选择
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadImage(file);
  });

  // 旋转
  document.getElementById('btn-rotate-left').addEventListener('click', () => {
    rotation = (rotation - 90) % 360;
    renderCanvas();
  });
  document.getElementById('btn-rotate-right').addEventListener('click', () => {
    rotation = (rotation + 90) % 360;
    renderCanvas();
  });

  // 翻转
  document.getElementById('btn-flip-h').addEventListener('click', () => {
    flipH = !flipH;
    renderCanvas();
  });
  document.getElementById('btn-flip-v').addEventListener('click', () => {
    flipV = !flipV;
    renderCanvas();
  });

  // 滤镜
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderCanvas();
    });
  });

  // ==================== 裁剪 ====================
  // 「裁剪」此前只在工具描述里声称支持，界面与代码中均无任何实现。
  // 实现方式：裁剪作用于**当前渲染结果**（已应用旋转/翻转/滤镜的图像），
  // 这样无需把选区坐标逆向映射回原图的旋转/翻转空间，语义也最符合直觉。
  let cropMode = false;
  let cropRect = null;        // {x, y, w, h} 相对于 canvas 像素
  let cropOverlay = null;
  let cropBox = null;
  let cropStart = null;

  const cropBar = document.getElementById('ie-crop-bar');

  function enterCropMode() {
    if (!originalImage) { alert('请先打开图片'); return; }
    cropMode = true;
    cropRect = null;
    if (cropBar) cropBar.style.display = 'flex';
    // 遮罩 + 选区框（绝对定位于 canvas 之上）
    cropOverlay = document.createElement('div');
    cropOverlay.style.cssText = 'position:absolute;inset:0;cursor:crosshair;z-index:5;';
    cropBox = document.createElement('div');
    cropBox.style.cssText = 'position:absolute;border:2px dashed #fff;box-shadow:0 0 0 9999px rgba(0,0,0,0.45);display:none;pointer-events:none;z-index:6;';
    const wrap = canvas.parentElement;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    wrap.appendChild(cropOverlay);
    wrap.appendChild(cropBox);

    cropOverlay.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      cropStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      cropBox.style.display = 'block';
      cropBox.style.left = cropStart.x + 'px';
      cropBox.style.top = cropStart.y + 'px';
      cropBox.style.width = '0px';
      cropBox.style.height = '0px';
      e.preventDefault();
    });
    cropOverlay.addEventListener('mousemove', (e) => {
      if (!cropStart) return;
      const rect = canvas.getBoundingClientRect();
      const cx = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const cy = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const x = Math.min(cropStart.x, cx);
      const y = Math.min(cropStart.y, cy);
      cropBox.style.left = x + 'px';
      cropBox.style.top = y + 'px';
      cropBox.style.width = Math.abs(cx - cropStart.x) + 'px';
      cropBox.style.height = Math.abs(cy - cropStart.y) + 'px';
    });
    cropOverlay.addEventListener('mouseup', (e) => {
      if (!cropStart) return;
      const rect = canvas.getBoundingClientRect();
      const cx = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const cy = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const x = Math.min(cropStart.x, cx);
      const y = Math.min(cropStart.y, cy);
      const w = Math.abs(cx - cropStart.x);
      const h = Math.abs(cy - cropStart.y);
      cropStart = null;
      if (w < 8 || h < 8) { cropBox.style.display = 'none'; cropRect = null; return; }
      // CSS 像素 → canvas 像素
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      cropRect = { x: Math.round(x * sx), y: Math.round(y * sy), w: Math.round(w * sx), h: Math.round(h * sy) };
    });
  }

  function exitCropMode() {
    cropMode = false;
    cropRect = null;
    cropStart = null;
    if (cropBar) cropBar.style.display = 'none';
    if (cropOverlay) { cropOverlay.remove(); cropOverlay = null; }
    if (cropBox) { cropBox.remove(); cropBox = null; }
  }

  function applyCrop() {
    if (!cropRect || !originalImage) { exitCropMode(); return; }
    const { x, y, w, h } = cropRect;
    // 从当前 canvas 提取选区（已含旋转/翻转/滤镜效果）
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    off.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
    const img = new Image();
    img.onload = () => {
      // 裁剪结果已成为新原图，重置变换与滤镜（效果已烘焙进图像）
      originalImage = img;
      rotation = 0;
      flipH = false;
      flipV = false;
      currentFilter = 'none';
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.filter-btn[data-filter="none"]')?.classList.add('active');
      exitCropMode();
      renderCanvas();
    };
    img.src = off.toDataURL('image/png');
  }

  document.getElementById('btn-crop').addEventListener('click', () => {
    if (cropMode) exitCropMode();
    else enterCropMode();
  });
  document.getElementById('btn-crop-apply').addEventListener('click', applyCrop);
  document.getElementById('btn-crop-cancel').addEventListener('click', exitCropMode);

  // 重置
  document.getElementById('btn-reset-img').addEventListener('click', () => {
    rotation = 0;
    flipH = false;
    flipV = false;
    currentFilter = 'none';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.filter-btn[data-filter="none"]')?.classList.add('active');
    renderCanvas();
  });

  // 下载
  document.getElementById('btn-download').addEventListener('click', () => {
    if (!originalImage) return;
    const link = document.createElement('a');
    link.download = 'edited-image.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  // 拖放支持
  canvas.parentElement.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  canvas.parentElement.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });

  document.getElementById('ie-filters').style.display = 'none';

  window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    if (e.data && e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
  });
});
