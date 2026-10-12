/**
 * 网页剪报（增强版）- 支持多种剪辑模式和格式
 */
(function(){
'use strict';
const $info = document.getElementById('wc-info');
const $preview = document.getElementById('wc-preview');
const $format = document.getElementById('wc-format');
let lastCapture = null;
let clipHistory = [];
const MAX_HISTORY = 20;

function post(a, d) { window.parent.postMessage({ action: a, data: d || {} }, '*'); }
function bytesToStr(b) {
  if (b < 1024) return b + 'B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + 'KB';
  return (b/1024/1024).toFixed(2) + 'MB';
}
function safeName(s) { return String(s).replace(/[\\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 100); }

let captureTimeout = null;
function capture() {
  const format = $format.value;
  const mode = document.getElementById('wc-mode') ? document.getElementById('wc-mode').value : 'full';
  const downloadImages = document.getElementById('wc-images') ? document.getElementById('wc-images').checked : false;
  $info.innerHTML = '<span>⏳ 抓取中...</span>';
  post('capturePageAsHtml', { format, mode, downloadImages });
  clearTimeout(captureTimeout);
  captureTimeout = setTimeout(() => {
    $info.innerHTML = '<span>❌ 抓取超时，请重试</span>';
  }, 10000);
}

// 纯文本模式：将HTML内容转为纯文本
function htmlToPlainText(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  // 移除script/style
  tmp.querySelectorAll('script,style').forEach(el => el.remove());
  // 块级元素后加换行
  tmp.querySelectorAll('div,p,br,li,h1,h2,h3,h4,h5,h6,tr').forEach(el => { el.append('\n'); });
  return (tmp.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

// 自动复制到剪贴板
async function autoCopy(content) {
  const autoCheckbox = document.getElementById('wc-autocopy');
  if (!autoCheckbox || !autoCheckbox.checked) return false;
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch (e) { return false; }
}

let lastBlobUrl = null;
function render() {
  if (!lastCapture) {
    $preview.innerHTML = '<div class="wc-empty">📋 等待抓取</div>';
    return;
  }
  const c = lastCapture;
  const modeLabel = c.mode === 'selection' ? '选择区域' : c.mode === 'article' ? '仅正文' : '全文';
  const formatLabel = c.format === 'text' ? '纯文本' : c.format.toUpperCase();
  const meta = `📄 <b>${escapeHtml(c.title)}</b>\n🔗 ${escapeHtml(c.url)}\n📦 ${bytesToStr(c.size)} · ${formatLabel} · ${modeLabel}`;
  if (c.format === 'html') {
    if (lastBlobUrl) URL.revokeObjectURL(lastBlobUrl);
    const blob = new Blob([c.content], { type: 'text/html;charset=utf-8' });
    lastBlobUrl = URL.createObjectURL(blob);
    $preview.innerHTML = '';
    $preview.innerHTML = `<div class="wc-meta">${meta}</div><iframe src="${lastBlobUrl}" style="width:100%;height:calc(100% - 80px);border:1px solid var(--tt-border);border-radius:4px;background:white"></iframe>`;
  } else {
    // Markdown 和纯文本都用 pre 预览
    $preview.innerHTML = `<div class="wc-meta">${meta}</div><pre class="wc-md-preview">${escapeHtml(c.content)}</pre>`;
  }
}

function addToHistory(capture) {
  if (!capture) return;
  const entry = { title: capture.title, url: capture.url, format: capture.format, size: capture.size, mode: capture.mode, timestamp: Date.now() };
  clipHistory.unshift(entry);
  if (clipHistory.length > MAX_HISTORY) clipHistory.pop();
  renderClipHistory();
}

function renderClipHistory() {
  const c = document.getElementById('wc-history');
  if (!c) return;
  if (!clipHistory.length) { c.innerHTML = '<div class="wc-empty">暂无剪辑历史</div>'; return; }
  c.innerHTML = clipHistory.map((h, i) => `<div class="wc-history-item"><span class="wc-history-title">${escapeHtml(h.title || '未命名')}</span><span class="wc-history-meta">${h.format.toUpperCase()} · ${bytesToStr(h.size)} · ${new Date(h.timestamp).toLocaleTimeString()}</span></div>`).join('');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
document.getElementById('btn-capture').addEventListener('click', capture);

/**
 * 通过「正文提取（服务端）」服务类别抓取任意 URL 的正文。
 *
 * 用途：浏览器端抓取只能处理当前标签页，且正文识别是启发式的；服务端提取
 * 可以处理任意 URL，且抽取质量更稳定。可在设置中指向自建服务。
 */
async function extractViaServer() {
  const input = document.getElementById('wc-server-url');
  const url = input ? input.value.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    $info.innerHTML = '<span>⚠️ 请输入以 http(s):// 开头的完整 URL</span>';
    return;
  }
  $info.innerHTML = '<span>⏳ 正在请求服务端提取正文...</span>';
  try {
    const resp = await new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const handler = (e) => {
        if (e.origin !== location.origin) return;
        if (!e.data || e.source !== window.parent) return;
        if (e.data.action === '__bgResponse' && e.data.data && e.data.data.__id === id) {
          clearTimeout(timer);
          window.removeEventListener('message', handler);
          resolve(e.data.data.result);
        }
      };
      const timer = setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('请求超时')); }, 25000);
      window.addEventListener('message', handler);
      window.parent.postMessage({
        action: 'callBackground',
        data: { id, action: 'serviceRequest', data: { kind: 'readability', params: { url } } }
      }, '*');
    });
    if (!resp || !resp.success) {
      $info.innerHTML = '<span>❌ 提取失败：' + escapeHtml((resp && resp.error) || '未知错误')
        + '<br>可在「设置 → 服务端点 → 正文提取（服务端）」中更换服务商或指向自建服务</span>';
      return;
    }
    const content = (resp.data && resp.data.content) || '';
    if (!content) {
      $info.innerHTML = '<span>❌ 服务端未返回正文内容</span>';
      return;
    }
    const title = (resp.data && resp.data.title) || url;
    lastCapture = {
      title: title,
      url: (resp.data && resp.data.url) || url,
      size: new Blob([content]).size,
      format: 'markdown',
      mode: 'article',
      content: content
    };
    render();
    addToHistory(lastCapture);
    await autoCopy(content);
    $info.innerHTML = '<span>✅ 已通过服务端提取正文</span>';
  } catch (e) {
    $info.innerHTML = '<span>❌ 提取失败：' + escapeHtml(e.message) + '</span>';
  }
}

const $btnServerExtract = document.getElementById('btn-server-extract');
if ($btnServerExtract) $btnServerExtract.addEventListener('click', extractViaServer);

/**
 * 查询 URL 的归档历史快照（走服务端点，可指向自建归档服务）。
 * 用途：页面已改版或已下线时，仍能取到历史版本；也可辅助判断站点存在时长。
 */
async function lookupArchive() {
  const input = document.getElementById('wc-server-url');
  let url = input ? input.value.trim() : '';
  if (!url && lastCapture && lastCapture.url) url = lastCapture.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    $info.innerHTML = '<span>⚠️ 请填写以 http(s):// 开头的 URL，或先抓取一个页面</span>';
    return;
  }
  $info.innerHTML = '<span>⏳ 正在查询归档快照...</span>';
  try {
    const resp = await new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const handler = (e) => {
        if (e.origin !== location.origin) return;
        if (!e.data || e.source !== window.parent) return;
        if (e.data.action === '__bgResponse' && e.data.data && e.data.data.__id === id) {
          clearTimeout(timer);
          window.removeEventListener('message', handler);
          resolve(e.data.data.result);
        }
      };
      const timer = setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('请求超时')); }, 25000);
      window.addEventListener('message', handler);
      window.parent.postMessage({
        action: 'callBackground',
        data: { id, action: 'serviceRequest', data: { kind: 'webArchive', params: { url } } }
      }, '*');
    });
    if (!resp || !resp.success) {
      $info.innerHTML = '<span>❌ 查询失败：' + escapeHtml((resp && resp.error) || '未知错误')
        + '<br>可在「设置 → 服务端点 → 网页归档快照」中更换服务商或指向自建服务</span>';
      return;
    }
    const d = resp.data || {};
    if (d.available && d.snapshotUrl) {
      $info.innerHTML = '<span>🗂️ 找到归档快照：<a href="' + escapeHtml(d.snapshotUrl)
        + '" target="_blank" rel="noopener" style="color:var(--tt-primary)">'
        + escapeHtml(d.timestamp || '在档案馆中打开') + '</a>'
        + (d.total > 1 ? '（约 ' + d.total + ' 个快照）' : '') + '</span>';
    } else {
      $info.innerHTML = '<span>ℹ️ 档案馆中没有该 URL 的快照</span>';
    }
  } catch (e) {
    $info.innerHTML = '<span>❌ 查询失败：' + escapeHtml(e.message) + '</span>';
  }
}

const $btnArchive = document.getElementById('btn-archive');
if ($btnArchive) $btnArchive.addEventListener('click', lookupArchive);
document.getElementById('btn-copy').addEventListener('click', async () => {
  if (!lastCapture) return;
  try { await navigator.clipboard.writeText(lastCapture.content); $info.innerHTML = '<span>✅ 已复制到剪贴板</span>'; } catch (e) { $info.innerHTML = '<span>❌ 复制失败</span>'; }
});
document.getElementById('btn-download').addEventListener('click', async () => {
  if (!lastCapture) return;
  const c = lastCapture;
  const ext = c.format === 'html' ? 'html' : c.format === 'text' ? 'txt' : 'md';
  const mime = c.format === 'html' ? 'text/html' : c.format === 'text' ? 'text/plain' : 'text/markdown';
  const filename = safeName(c.title) + '.' + ext;
  const blob = new Blob([c.content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  $info.innerHTML = `<span>✅ 下载: <b>${filename}</b></span>`;
});

// 保存为 PDF：通过浏览器打印对话框实现（用户可选择"另存为PDF"）
document.getElementById('btn-pdf').addEventListener('click', () => {
  if (!lastCapture) {
    $info.innerHTML = '<span>⚠️ 请先抓取页面内容</span>';
    return;
  }
  const c = lastCapture;
  // 构建打印用 HTML 文档（包含标题、来源、内容）
  let bodyContent;
  if (c.format === 'html') {
    bodyContent = c.content;
  } else if (c.format === 'text') {
    bodyContent = '<pre style="white-space:pre-wrap;word-wrap:break-word;font-family:inherit">' + escapeHtml(c.content) + '</pre>';
  } else {
    // Markdown：简单转为 HTML 段落（标题、粗体、链接、代码块）
    bodyContent = markdownToHtml(c.content);
  }
  const printHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + escapeHtml(c.title) + '</title>' +
    '<style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:800px;margin:20px auto;padding:20px;line-height:1.7;color:#333}' +
    '.wc-pdf-header{border-bottom:2px solid #4A90D9;padding-bottom:10px;margin-bottom:20px}' +
    '.wc-pdf-header h1{font-size:20px;margin:0 0 5px}' +
    '.wc-pdf-header .meta{font-size:12px;color:#999}' +
    'pre{background:#f5f5f5;padding:12px;border-radius:4px;overflow-x:auto}' +
    'code{background:#f5f5f5;padding:2px 6px;border-radius:3px;font-family:Consolas,monospace}' +
    'img{max-width:100%;height:auto}' +
    'table{border-collapse:collapse;width:100%}' +
    'th,td{border:1px solid #ddd;padding:8px;text-align:left}' +
    '@media print{.wc-pdf-no-print{display:none}}' +
    '</style></head><body>' +
    '<div class="wc-pdf-header"><h1>' + escapeHtml(c.title) + '</h1><div class="meta">来源: ' + escapeHtml(c.url) + ' · ' + new Date().toLocaleString() + '</div></div>' +
    bodyContent +
    '<script>window.onload=function(){setTimeout(function(){window.print();},300);}<\/script>' +
    '</body></html>';
  // 打开新窗口并打印
  const printWin = window.open('', '_blank');
  if (!printWin) {
    $info.innerHTML = '<span>❌ 弹窗被阻止，请允许弹窗后重试</span>';
    return;
  }
  printWin.document.open();
  printWin.document.write(printHtml);
  printWin.document.close();
  $info.innerHTML = '<span>✅ 已打开打印窗口，选择"另存为PDF"即可保存</span>';
});

// 简易 Markdown 转 HTML（支持标题、粗体、斜体、链接、代码、列表）
function markdownToHtml(md) {
  if (!md) return '';
  let html = escapeHtml(md);
  // 代码块
  html = html.replace(/```[\s\S]*?```/g, m => '<pre><code>' + m.replace(/```/g, '') + '</code></pre>');
  // 标题
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // 粗体和斜体
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  // 图片
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  // 无序列表
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  // 段落（连续非标签行）
  html = html.replace(/^(?!<[hupoli])(.+)$/gm, '<p>$1</p>');
  return html;
}

window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data.action === 'setTheme' && e.data.data) document.documentElement.setAttribute('data-theme', e.data.data.theme);
  if (e.data.action === 'pageCaptureResult' && e.data.data) {
    clearTimeout(captureTimeout);
    lastCapture = e.data.data;
    // 纯文本格式处理：如果请求的是text但返回的是html，则转换
    const reqFormat = $format.value;
    if (reqFormat === 'text' && lastCapture.format !== 'text') {
      lastCapture.content = htmlToPlainText(lastCapture.content);
      lastCapture.format = 'text';
      lastCapture.size = new Blob([lastCapture.content]).size;
    }
    addToHistory(lastCapture);
    $info.innerHTML = `<span>✅ 抓取完成 · <b>${bytesToStr(lastCapture.size)}</b></span>`;
    render();
    // 自动复制到剪贴板
    autoCopy(lastCapture.content).then(ok => {
      if (ok) $info.innerHTML = `<span>✅ 抓取完成 · <b>${bytesToStr(lastCapture.size)}</b> · 已自动复制到剪贴板</span>`;
    });
  }
});
})();
