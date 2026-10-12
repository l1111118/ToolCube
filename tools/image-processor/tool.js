/**
 * 图片处理工具
 */
const elements = {
  uploadSection: document.getElementById('upload-section'),
  editorSection: document.getElementById('editor-section'),
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  canvas: document.getElementById('preview-canvas'),
  widthSlider: document.getElementById('width-slider'),
  heightSlider: document.getElementById('height-slider'),
  widthValue: document.getElementById('width-value'),
  heightValue: document.getElementById('height-value'),
  qualitySlider: document.getElementById('quality-slider'),
  qualityValue: document.getElementById('quality-value'),
  formatSelect: document.getElementById('format-select'),
  btnProcess: document.getElementById('btn-process'),
  btnDownload: document.getElementById('btn-download'),
  btnReset: document.getElementById('btn-reset'),
  toast: document.getElementById('toast')
};

let originalImage = null;
let currentFile = null;

const ctx = elements.canvas.getContext('2d');

document.addEventListener('DOMContentLoaded', () => {
  // 拖放上传
  elements.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropZone.style.borderColor = 'var(--tt-primary)';
  });
  elements.dropZone.addEventListener('dragleave', () => {
    elements.dropZone.style.borderColor = 'var(--tt-border)';
  });
  elements.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.dropZone.style.borderColor = 'var(--tt-border)';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadImage(file);
  });
  
  // 文件选择
  elements.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadImage(file);
  });

  // 点击拖拽区或"选择图片"按钮打开文件选择框
  // 注意：不能使用 HTML 内联 onclick —— 扩展页 CSP 为 script-src 'self'，
  // 内联事件处理器会被浏览器拒绝执行，导致按钮点击无任何反应。
  // 这里统一在拖拽区上绑定 click，按钮点击通过事件冒泡同样生效。
  elements.dropZone.addEventListener('click', (e) => {
    if (e.target === elements.fileInput) return;
    elements.fileInput.click();
  });
  
  // 滑块事件
  elements.widthSlider.addEventListener('input', updateDimensions);
  elements.heightSlider.addEventListener('input', updateDimensions);
  elements.qualitySlider.addEventListener('input', () => {
    elements.qualityValue.textContent = elements.qualitySlider.value;
  });
  
  // 按钮事件
  elements.btnProcess.addEventListener('click', processImage);
  elements.btnDownload.addEventListener('click', downloadImage);
  elements.btnReset.addEventListener('click', resetEditor);
});

function loadImage(file) {
  currentFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    originalImage = new Image();
    originalImage.onload = () => {
      elements.canvas.width = originalImage.width;
      elements.canvas.height = originalImage.height;
      ctx.drawImage(originalImage, 0, 0);
      
      // 设置滑块范围
      elements.widthSlider.max = originalImage.width * 2;
      elements.heightSlider.max = originalImage.height * 2;
      elements.widthSlider.value = originalImage.width;
      elements.heightSlider.value = originalImage.height;
      updateDimensions();
      
      // 切换视图
      elements.uploadSection.hidden = true;
      elements.editorSection.hidden = false;
    };
    originalImage.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function updateDimensions() {
  const w = parseInt(elements.widthSlider.value, 10);
  const h = parseInt(elements.heightSlider.value, 10);
  elements.widthValue.textContent = w;
  elements.heightValue.textContent = h;
}

function processImage() {
  if (!originalImage) return;
  
  const width = parseInt(elements.widthSlider.value, 10);
  const height = parseInt(elements.heightSlider.value, 10);
  
  elements.canvas.width = width;
  elements.canvas.height = height;
  ctx.drawImage(originalImage, 0, 0, width, height);
  
  showToast('处理完成', 'success');
}

function downloadImage() {
  const format = elements.formatSelect.value;
  const quality = parseInt(elements.qualitySlider.value, 10) / 100;
  
  const dataUrl = elements.canvas.toDataURL(format, quality);
  const ext = format.split('/')[1];
  
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = `processed_${Date.now()}.${ext}`;
  a.click();
}

function resetEditor() {
  originalImage = null;
  currentFile = null;
  elements.fileInput.value = '';
  elements.uploadSection.hidden = false;
  elements.editorSection.hidden = true;
}

function showToast(msg, type = 'info') {
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(() => elements.toast.classList.remove('toast--show'), 3000);
}
  // 主题切换消息监听
  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
  });
