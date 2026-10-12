/**
 * Markdown编辑器 - 纯本地解析（无外部依赖）
 */
const elements = {
  editor: document.getElementById('editor'),
  preview: document.getElementById('preview'),
  btnCopy: document.getElementById('btn-copy'),
  btnDownload: document.getElementById('btn-download'),
  toast: document.getElementById('toast')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
// ============ 内联Markdown解析器 ============
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function isSafeUrl(url) {
  if (!url) return false;
  return /^https?:\/\//i.test(url.trim());
}
function parseMarkdown(md) {
  if (!md) return '';

  // 转义HTML
  var html = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 代码块（多行，先处理避免干扰其他规则）
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(m, lang, code) {
    return '<pre><code class="language-' + escapeHtml(lang || '') + '">' + code.replace(/\n$/, '') + '</code></pre>';
  });
  
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 标题
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // 图片 ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function(m, alt, url) {
    var safeUrl = isSafeUrl(url) ? url.trim() : '';
    return safeUrl ? '<img src="' + safeUrl + '" alt="' + escapeHtml(alt) + '" style="max-width:100%">' : escapeHtml(m);
  });

  // 链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(m, text, url) {
    var safeUrl = isSafeUrl(url) ? url.trim() : '';
    return safeUrl ? '<a href="' + safeUrl + '" target="_blank" rel="noopener">' + escapeHtml(text) + '</a>' : escapeHtml(m);
  });
  
  // 粗体和斜体（注意顺序：先粗体+斜体，再粗体，再斜体）
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  // 删除线
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
  
  // 水平线
  html = html.replace(/^(---|\*\*\*|___)$/gm, '<hr>');
  
  // 引用块
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // 合并连续的引用块
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  
  // 无序列表
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, function(m) { return '<ul>' + m + '</ul>'; });
  // 更准确地处理列表：将连续的行内<li>包裹在<ul>中
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, function(m) {
    // 避免嵌套
    if (m.indexOf('<ul>') === -1) return '<ul>' + m + '</ul>';
    return m;
  });
  
  // 有序列表
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, function(m) {
    if (m.indexOf('<ol>') === -1 && m.indexOf('<ul>') === -1) return '<ol>' + m + '</ol>';
    return m;
  });
  
  // 段落：相邻的非空非标签行合并
  var lines = html.split('\n');
  var result = [];
  var inParagraph = false;
  
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    
    // 跳过已经是块级元素的行
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|hr|table|div|img)/.test(line) || line === '') {
      result.push(line);
      inParagraph = false;
    } else {
      if (!inParagraph) {
        result.push('<p>' + line);
        inParagraph = true;
      } else {
        result[result.length - 1] += '<br>' + line;
      }
    }
  }
  
  // 关闭未闭合的段落
  if (inParagraph) {
    result[result.length - 1] += '</p>';
  }
  
  return result.join('\n');
}

document.addEventListener('DOMContentLoaded', function() {
  // 工具栏按钮
  document.querySelectorAll('.btn--icon').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var md = btn.dataset.md;
      insertMarkdown(md);
    });
  });
  
  // 实时预览
  elements.editor.addEventListener('input', updatePreview);
  
  // 复制和下载
  elements.btnCopy.addEventListener('click', copyMarkdown);
  elements.btnDownload.addEventListener('click', downloadMarkdown);
  
  // 初始化
  updatePreview();
  loadSavedData();
});

function insertMarkdown(text) {
  var start = elements.editor.selectionStart;
  var end = elements.editor.selectionEnd;
  var value = elements.editor.value;
  
  elements.editor.value = value.substring(0, start) + text + value.substring(end);
  elements.editor.focus();
  elements.editor.setSelectionRange(start + text.length, start + text.length);
  updatePreview();
}

function updatePreview() {
  var markdown = elements.editor.value;
  elements.preview.innerHTML = parseMarkdown(markdown);
}

async function copyMarkdown() {
  var text = elements.editor.value;
  if (!text) { showToast('没有可复制的内容', 'error'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制', 'success');
  } catch (e) {
    showToast('复制失败', 'error');
  }
}

function downloadMarkdown() {
  var text = elements.editor.value;
  if (!text) { showToast('没有可下载的内容', 'error'); return; }
  
  var blob = new Blob([text], { type: 'text/markdown' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'document_' + Date.now() + '.md';
  a.click();
  URL.revokeObjectURL(url);
}

function showToast(msg, type) {
  type = type || 'info';
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(function() { elements.toast.classList.remove('toast--show'); }, 3000);
}

async function loadSavedData() {
  try {
    var res = await safeSend({ action: 'getToolData', data: { toolId: 'markdown-editor' } });
    if (res && res.content) {
      elements.editor.value = res.content;
      updatePreview();
    }
  } catch (e) {}
}

// 主题切换和setData消息监听（统一处理，无重复）
window.addEventListener('message', function(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!event.data || event.source !== window.parent) return;
  if (event.data && event.data.action === 'setTheme' && event.data.data) {
    document.documentElement.setAttribute('data-theme', event.data.data.theme);
  }
  if (event.data && event.data.action === 'setData') {
    var inputArea = document.getElementById('editor');
    if (inputArea && typeof event.data.data === 'string') {
      inputArea.value = event.data.data;
      inputArea.dispatchEvent(new Event('input'));
    }
  }
});
