/**
 * QR Code Reader Tool - 二维码读取
 *
 * 解码策略（按优先级）：
 *   1. BarcodeDetector API —— 支持二维码及多种一维条码（Chrome 88+ / Edge 88+）
 *   2. jsQR —— 纯 JS 二维码解码器，覆盖 Firefox 等未实现 BarcodeDetector 的浏览器
 * 两者结合后，本工具在 Firefox / Chrome / Edge 上均可完成二维码识别。
 */
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('qr-file');
  const preview = document.getElementById('qr-preview');
  const camera = document.getElementById('qr-camera');
  const resultBox = document.getElementById('qr-result');
  const resultText = document.getElementById('qr-text');
  const resultType = document.getElementById('qr-type');
  const dropZone = document.getElementById('qr-dropzone');
  const loadingEl = document.getElementById('qr-loading');
  const compatNotice = document.getElementById('qr-compat-notice');
  let cameraStream = null;
  let scanInterval = null;

  const hasBarcodeDetector = typeof window.BarcodeDetector === 'function';
  const hasJsQR = typeof window.jsQR === 'function';

  // 兼容性提示：仅在两种解码器都不可用时展示（此时确实无法识别）
  if (!hasBarcodeDetector && !hasJsQR && compatNotice) {
    compatNotice.style.display = 'block';
  }

  /** 单次解码的像素上限：jsQR 耗时随像素数增长，超出时先等比缩放以控制单帧成本 */
  const DECODE_MAX_DIM = 1024;

  /**
   * 用 jsQR 解码 ImageData（仅支持二维码）
   * @param {ImageData} imageData
   * @returns {{text:string, type:string}|null}
   */
  function decodeWithJsQR(imageData) {
    if (!hasJsQR || !imageData) return null;
    try {
      const result = window.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth'
      });
      if (result && result.data) return { text: result.data, type: 'QR_CODE (jsQR)' };
    } catch (e) {
      console.log('jsQR decode error:', e);
    }
    return null;
  }

  /**
   * 将图像源绘制到 canvas 并返回 ImageData（超过 DECODE_MAX_DIM 时等比缩放）
   * @param {CanvasImageSource} source
   * @param {number} naturalWidth
   * @param {number} naturalHeight
   * @returns {ImageData}
   */
  function toScaledImageData(source, naturalWidth, naturalHeight) {
    const canvas = document.createElement('canvas');
    let w = naturalWidth || 1;
    let h = naturalHeight || 1;
    const maxDim = Math.max(w, h);
    if (maxDim > DECODE_MAX_DIM) {
      const scale = DECODE_MAX_DIM / maxDim;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function showLoading() {
    loadingEl.style.display = 'block';
    resultBox.style.display = 'none';
  }

  function hideLoading() {
    loadingEl.style.display = 'none';
  }

  function showResult(text, type) {
    resultText.textContent = text;
    resultType.textContent = type || 'QR Code / Barcode';
    resultBox.style.display = 'block';
    hideLoading();
  }

  /**
   * 识别图片中的二维码/条码
   * 先尝试 BarcodeDetector（格式覆盖更广），不可用或未命中时回退到 jsQR。
   * @param {string} imageSource 图片地址（data URL / blob URL）
   */
  async function detectQrCode(imageSource) {
    showLoading();
    try {
      const img = new Image();
      img.src = imageSource;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;

      // 1) BarcodeDetector：支持二维码 + 多种一维/二维条码
      if (hasBarcodeDetector) {
        try {
          const detector = new BarcodeDetector({
            formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'aztec', 'data_matrix', 'pdf417']
          });
          const barcodes = await detector.detect(img);
          if (barcodes.length > 0) {
            showResult(barcodes[0].rawValue, barcodes[0].format.toUpperCase());
            return;
          }
        } catch (e) {
          console.log('BarcodeDetector error:', e);
        }
      }

      // 2) jsQR 回退：Firefox 等无 BarcodeDetector 的环境依赖它完成识别
      const viaJsQr = decodeWithJsQR(toScaledImageData(img, width, height));
      if (viaJsQr) {
        showResult(viaJsQr.text, viaJsQr.type);
        return;
      }

      // 3) 仍未识别：提示内容与当前实际可用能力保持一致
      resultText.textContent = (hasBarcodeDetector || hasJsQR)
        ? '未识别到二维码/条形码\n请尝试更清晰的图片，或更换扫码角度'
        : '当前浏览器缺少可用的解码能力\n请升级浏览器后重试';
      resultType.textContent = '识别失败';
      resultBox.style.display = 'block';
      hideLoading();

    } catch (e) {
      resultText.textContent = '图片加载失败: ' + e.message;
      resultType.textContent = '错误';
      resultBox.style.display = 'block';
      hideLoading();
    }
  }

  // 文件选择
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.src = ev.target.result;
      preview.style.display = 'block';
      dropZone.style.display = 'none';
      resultBox.style.display = 'none';
      detectQrCode(ev.target.result);
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('btn-select').addEventListener('click', () => fileInput.click());

  // 拖放
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        preview.src = ev.target.result;
        preview.style.display = 'block';
        dropZone.style.display = 'none';
        detectQrCode(ev.target.result);
      };
      reader.readAsDataURL(file);
    }
  });
  dropZone.addEventListener('click', () => fileInput.click());

  // 剪贴板
  document.getElementById('btn-paste').addEventListener('click', async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const url = URL.createObjectURL(blob);
            preview.src = url;
            preview.style.display = 'block';
            dropZone.style.display = 'none';
            detectQrCode(url);
            return;
          }
        }
      }
      alert('剪贴板中未找到图片');
    } catch(e) {
      alert('读取剪贴板失败，请确认已授权剪贴板权限');
    }
  });

  /**
   * 对相机当前帧执行一次解码（BarcodeDetector 优先，jsQR 回退）
   * @param {HTMLCanvasElement} canvas 已绘制当前帧的 canvas
   * @returns {Promise<{text:string, type:string}|null>}
   */
  async function decodeCameraFrame(canvas) {
    if (hasBarcodeDetector) {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39'] });
        const barcodes = await detector.detect(canvas);
        if (barcodes.length > 0) return { text: barcodes[0].rawValue, type: barcodes[0].format.toUpperCase() };
      } catch (e) {
        // 该格式不被支持时继续走 jsQR
      }
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return decodeWithJsQR(ctx.getImageData(0, 0, canvas.width, canvas.height));
  }

  // 相机扫描
  document.getElementById('btn-camera').addEventListener('click', async () => {
    if (cameraStream) {
      stopCamera();
      return;
    }
    if (!hasBarcodeDetector && !hasJsQR) {
      alert('当前浏览器缺少可用的二维码解码能力，无法进行摄像头实时扫描。\n您仍可使用「选择图片」功能上传二维码图片尝试识别。');
      return;
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });
      camera.srcObject = cameraStream;
      camera.style.display = 'block';
      preview.style.display = 'none';
      dropZone.style.display = 'none';
      resultBox.style.display = 'none';
      document.getElementById('btn-camera').textContent = '⏹ 停止扫描';

      // 定时扫描：decoding 标志确保上一帧未解码完成时不再叠加新帧（jsQR 为同步计算，可能耗时）
      let decoding = false;
      scanInterval = setInterval(async () => {
        if (!cameraStream || camera.videoWidth === 0 || decoding) return;
        decoding = true;
        try {
          let w = camera.videoWidth;
          let h = camera.videoHeight;
          const maxDim = Math.max(w, h);
          if (maxDim > DECODE_MAX_DIM) {
            const scale = DECODE_MAX_DIM / maxDim;
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, w);
          canvas.height = Math.max(1, h);
          canvas.getContext('2d', { willReadFrequently: true }).drawImage(camera, 0, 0, canvas.width, canvas.height);

          const found = await decodeCameraFrame(canvas);
          if (found) {
            stopCamera();
            showResult(found.text, found.type);
          }
        } catch (e) {
          // 单帧解码失败不应中断扫描循环
        } finally {
          decoding = false;
        }
      }, 400);

    } catch(e) {
      alert('无法访问摄像头: ' + (e.message || '请检查权限设置'));
    }
  });

  function stopCamera() {
    if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    if (cameraStream) {
      cameraStream.getTracks().forEach(t => t.stop());
      cameraStream = null;
    }
    camera.style.display = 'none';
    camera.srcObject = null;
    document.getElementById('btn-camera').textContent = '📷 拍照扫描';
  }

  // 清除
  document.getElementById('btn-clear').addEventListener('click', () => {
    stopCamera();
    preview.style.display = 'none';
    preview.src = '';
    resultBox.style.display = 'none';
    dropZone.style.display = 'block';
    hideLoading();
  });

  // 结果操作
  document.getElementById('btn-open').addEventListener('click', () => {
    const text = resultText.textContent.trim();
    if (/^https?:\/\//.test(text)) window.open(text, '_blank');
  });
  document.getElementById('btn-copy-result').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(resultText.textContent.trim());
      // visual feedback
      const btn = document.getElementById('btn-copy-result');
      const orig = btn.textContent;
      btn.textContent = '✅ 已复制';
      setTimeout(() => btn.textContent = orig, 1500);
    } catch(e) {}
  });
  document.getElementById('btn-new-scan').addEventListener('click', () => {
    resultBox.style.display = 'none';
    dropZone.style.display = 'block';
  });

  // 主题
  window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    if (e.data && e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
  });
});
