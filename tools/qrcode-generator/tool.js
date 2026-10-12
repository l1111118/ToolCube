/**
 * 二维码生成器 - 纯本地实现（无外部依赖，使用Canvas渲染）
 */
(function() {

// ============ QR Code 编码器 ============
// ============ QR Code 编码器 ============
// 编码器实现已抽到 common/qrcode.js（经典脚本，通过 window.ToolCubeQR 暴露），
// 由工具页在 tool.js 之前引入；qrcode-generator 与 url-parser 共用同一份实现。
var QRCode = window.ToolCubeQR;



// ============ UI逻辑 ============
var elements = {
  tabs: document.querySelectorAll('.tab'),
  tabContents: document.querySelectorAll('.tab-content'),
  textInput: document.getElementById('text-input'),
  urlInput: document.getElementById('url-input'),
  wifiSsid: document.getElementById('wifi-ssid'),
  wifiPassword: document.getElementById('wifi-password'),
  wifiType: document.getElementById('wifi-type'),
  vcardName: document.getElementById('vcard-name'),
  vcardPhone: document.getElementById('vcard-phone'),
  vcardEmail: document.getElementById('vcard-email'),
  vcardOrg: document.getElementById('vcard-org'),
  qrSize: document.getElementById('qr-size'),
  sizeValue: document.getElementById('size-value'),
  qrColor: document.getElementById('qr-color'),
  qrBg: document.getElementById('qr-bg'),
  btnGenerate: document.getElementById('btn-generate'),
  qrContainer: document.getElementById('qr-container'),
  qrActions: document.getElementById('qr-actions'),
  btnDownload: document.getElementById('btn-download'),
  btnCopyData: document.getElementById('btn-copy-data'),
  toast: document.getElementById('toast')
};

var currentData = '';
function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }

document.addEventListener('DOMContentLoaded', function() {
  elements.tabs.forEach(function(tab) {
    tab.addEventListener('click', function() { switchTab(tab.dataset.tab); });
  });
  elements.qrSize.addEventListener('input', function() {
    elements.sizeValue.textContent = elements.qrSize.value + 'px';
  });
  elements.btnGenerate.addEventListener('click', generateQR);
  elements.btnDownload.addEventListener('click', downloadQR);
  elements.btnCopyData.addEventListener('click', copyQRData);
});

function switchTab(tabName) {
  elements.tabs.forEach(function(t) { t.classList.toggle('tab--active', t.dataset.tab === tabName); });
  elements.tabContents.forEach(function(c) { c.classList.toggle('tab-content--active', c.id === tabName + '-tab'); });
}

function getQRData() {
  var activeTab = document.querySelector('.tab--active').dataset.tab;
  switch (activeTab) {
    case 'text': return elements.textInput.value.trim();
    case 'url': return elements.urlInput.value.trim();
    case 'wifi':
      var ssid = elements.wifiSsid.value.trim();
      var pass = elements.wifiPassword.value;
      var type = elements.wifiType.value;
      if (!ssid) return '';
      if (type === 'nopass') return 'WIFI:S:' + ssid + ';;';
      return 'WIFI:T:' + type + ';S:' + ssid + ';P:' + pass + ';;';
    case 'vcard':
      var name = elements.vcardName.value.trim();
      var phone = elements.vcardPhone.value.trim();
      var email = elements.vcardEmail.value.trim();
      var org = elements.vcardOrg.value.trim();
      var vcard = 'BEGIN:VCARD\nVERSION:3.0\n';
      if (name) vcard += 'FN:' + name + '\nN:' + name + ';;;\n';
      if (phone) vcard += 'TEL:' + phone + '\n';
      if (email) vcard += 'EMAIL:' + email + '\n';
      if (org) vcard += 'ORG:' + org + '\n';
      vcard += 'END:VCARD';
      return vcard;
    default: return '';
  }
}

function generateQR() {
  var data = getQRData();
  if (!data) { showToast('请输入内容', 'error'); return; }
  currentData = data;

  elements.qrContainer.innerHTML = '';
  var size = parseInt(elements.qrSize.value, 10);
  var color = elements.qrColor.value;
  var bg = elements.qrBg.value;

  try {
    var qr = QRCode.encode(data, { correctLevel: 'M' });
    renderQRToCanvas(qr, size, color, bg);
    elements.qrContainer.style.border = 'none';
    elements.qrContainer.style.background = 'transparent';
    elements.qrActions.hidden = false;
    showToast('生成成功', 'success');
    saveToHistory(data.substring(0, 100), 'generate');
  } catch (e) {
    showToast('生成失败: ' + e.message, 'error');
    console.error('QR error:', e);
  }
}

function renderQRToCanvas(qr, displaySize, color, bg) {
  var cellSize = Math.floor(displaySize / qr.size);
  var canvasSize = cellSize * qr.size;
  var quietZone = Math.floor(cellSize * 4);
  var totalSize = canvasSize + quietZone * 2;

  var canvas = document.createElement('canvas');
  canvas.width = totalSize;
  canvas.height = totalSize;
  canvas.style.width = displaySize + 'px';
  canvas.style.height = displaySize + 'px';
  elements.qrContainer.appendChild(canvas);

  var ctx = canvas.getContext('2d');
  // 背景
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, totalSize, totalSize);
  // QR模块
  ctx.fillStyle = color;
  for (var i = 0; i < qr.size; i++) {
    for (var j = 0; j < qr.size; j++) {
      if (qr.matrix[i][j]) {
        ctx.fillRect(quietZone + j * cellSize, quietZone + i * cellSize, cellSize, cellSize);
      }
    }
  }
}

function downloadQR() {
  var canvas = elements.qrContainer.querySelector('canvas');
  if (!canvas) { showToast('请先生成二维码', 'error'); return; }
  var link = document.createElement('a');
  link.href = canvas.toDataURL('image/png');
  link.download = 'qrcode_' + Date.now() + '.png';
  link.click();
}

async function copyQRData() {
  if (!currentData) { showToast('没有可复制的内容', 'error'); return; }
  try {
    await navigator.clipboard.writeText(currentData);
    showToast('已复制', 'success');
  } catch (e) { showToast('复制失败', 'error'); }
}

function showToast(msg, type) {
  type = type || 'info';
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(function() { elements.toast.classList.remove('toast--show'); }, 3000);
}

async function saveToHistory(input, action) {
  await safeSend({
    action: 'saveToHistory',
    data: { toolId: 'qrcode-generator', type: action, data: { input: input, action: action } }
  });
}

// 主题切换和setData消息监听（统一处理，无重复）
window.addEventListener('message', function(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data && event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
  if (event.data && event.data.action === 'setData' && typeof event.data.data === 'string') {
    if (event.data.data.startsWith('http')) {
      switchTab('url');
      elements.urlInput.value = event.data.data;
    } else {
      switchTab('text');
      elements.textInput.value = event.data.data;
    }
    generateQR();
  }
});

})();
