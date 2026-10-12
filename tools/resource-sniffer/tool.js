/**
 * 资源嗅探器
 * 通过 PerformanceObserver + DOM 扫描提取页面所有可下载资源
 */
(function(){
'use strict';

let allResources = [];
let currentFilter = 'all';
let selected = new Set();
let isLiveMonitor = false;
let isFilterLongVideo = false;
let isFilterHD = false;
let activeDetailUrl = null;
let scanOpts = { includeNetwork: true, includeDom: true, includeMeta: true, dedupe: 'exact' };

const $list = document.getElementById('rs-list');
const $summary = document.getElementById('rs-summary');
const $search = document.getElementById('rs-search');
const $dedupe = document.getElementById('rs-dedupe');
const $sort = document.getElementById('rs-sort');
const $incNet = document.getElementById('rs-include-network');
const $incDom = document.getElementById('rs-include-dom');
const $incMeta = document.getElementById('rs-include-meta');
const $tabs = document.getElementById('rs-tabs');
const $m3u8Panel = document.getElementById('rs-m3u8-panel');
const $m3u8Body = document.getElementById('rs-m3u8-body');

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

function post(a, d) { window.parent.postMessage({ action: a, data: d || {} }, '*'); }
function call(action, data) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    let settled = false;
    const onMsg = (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
      if (e.data && e.data.action === '__bgResponse' && e.data.data && e.data.data.__id === id) {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(e.data.data.result);
      }
    };
    window.addEventListener('message', onMsg);
    // 超时清理：30 秒未响应则拒绝，防止内存泄漏
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMsg);
      resolve({ success: false, error: '请求超时' });
    // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
    // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
    }, 70000);
    // 通过 sidebar 转发到 background
    window.parent.postMessage({
      action: 'callBackground',
      data: { id, action, data }
    }, '*');
  });
}
function toast(msg, ms = 2000) {
  let t = document.querySelector('.rs-toast');
  if (!t) { t = document.createElement('div'); t.className = 'rs-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('rs-toast--show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('rs-toast--show'), ms);
}
function formatSize(b) {
  if (!b || b <= 0) return '—';
  if (b < 1024) return b + 'B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(2) + 'MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + 'GB';
}
function formatDuration(sec) {
  if (!sec || !isFinite(sec) || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function formatBitrate(kbps) {
  if (!kbps || kbps <= 0) return '';
  if (kbps >= 1000) return (kbps / 1000).toFixed(1) + 'Mbps';
  return kbps + 'kbps';
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function getIconForType(type, subtype) {
  if (type === 'video') return '🎬';
  if (type === 'audio') return '🎵';
  if (type === 'image') return '🖼️';
  if (type === 'document') return '📄';
  if (type === 'font') return '🔤';
  return '📦';
}

function applyFilter() {
  const q = ($search.value || '').toLowerCase().trim();
  let list = allResources;
  if (currentFilter !== 'all') list = list.filter(x => x.type === currentFilter);
  if (q) {
    list = list.filter(x =>
      (x.url || '').toLowerCase().includes(q) ||
      (x.filename || '').toLowerCase().includes(q) ||
      (x.subtype || '').toLowerCase().includes(q) ||
      (x.source || '').toLowerCase().includes(q) ||
      (x.text || '').toLowerCase().includes(q)
    );
  }
  if (isFilterLongVideo) {
    list = list.filter(x => x.duration && x.duration > 300);
  }
  if (isFilterHD) {
    list = list.filter(x => x.width && x.height && (x.width * x.height) > 2073600);
  }
  const sortVal = $sort.value;
  if (sortVal === 'size-desc') list.sort((a, b) => (b.size || 0) - (a.size || 0));
  else if (sortVal === 'size-asc') list.sort((a, b) => (a.size || 0) - (b.size || 0));
  else if (sortVal === 'name') list.sort((a, b) => (a.filename || '').localeCompare(b.filename || ''));
  else if (sortVal === 'duration-desc') list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  else if (sortVal === 'duration-asc') list.sort((a, b) => (a.duration || 0) - (b.duration || 0));
  else if (sortVal === 'resolution') list.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
  else if (sortVal === 'bitrate') list.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  else list.sort((a, b) => {
    const order = { video: 0, audio: 1, image: 2, document: 3, font: 4, other: 9 };
    return (order[a.type] ?? 9) - (order[b.type] ?? 9);
  });
  renderList(list);
}

function renderList(list) {
  if (!list.length) {
    $list.innerHTML = '<div class="rs-empty">📦 没有匹配的资源</div>';
    return;
  }
  const html = list.map((r) => {
    const isSel = selected.has(r.url);
    const isImg = r.type === 'image';
    const isMedia = r.type === 'video' || r.type === 'audio';
    const dur = formatDuration(r.duration);
    const durTag = dur ? `<span class="rs-tag rs-tag--duration">⏱ ${dur}</span>` : '';
    const resTag = (r.width && r.height) ? `<span class="rs-tag rs-tag--resolution">${r.width}×${r.height}</span>` : '';
    const bitrateStr = formatBitrate(r.bitrate);
    const bitrateTag = bitrateStr ? `<span class="rs-tag rs-tag--bitrate">📊 ${bitrateStr}</span>` : '';
    const stateTag = r.playState ? `<span class="rs-tag rs-tag--${r.playState}">${r.playState === 'playing' ? '▶' : r.playState === 'ended' ? '⏹' : '⏸'} ${r.playState}</span>` : '';
    const codecTag = r.codec ? `<span class="rs-tag">${escapeHtml(r.codec)}</span>` : '';
    const fpsTag = r.fps ? `<span class="rs-tag">${r.fps}fps</span>` : '';
    const thumb = isImg
      ? `<div class="rs-thumb"><img src="${escapeHtml(r.url)}" loading="lazy" data-thumb="1"></div>`
      : isMedia && dur
        ? `<div class="rs-thumb rs-thumb--media"><span class="rs-thumb-empty">${getIconForType(r.type, r.subtype)}</span><span class="rs-thumb-duration">${dur}</span></div>`
        : `<div class="rs-thumb"><span class="rs-thumb-empty">${getIconForType(r.type, r.subtype)}</span></div>`;
    const meta = [
      `<span class="rs-tag">${r.type}</span>`,
      r.subtype ? `<span class="rs-tag">${escapeHtml(r.subtype)}</span>` : '',
      `<span class="rs-tag">${formatSize(r.size)}</span>`,
      durTag,
      resTag,
      bitrateTag,
      stateTag,
      codecTag,
      fpsTag,
      r.source ? `<span class="rs-tag">${escapeHtml(r.source)}</span>` : '',
    ].filter(Boolean).join('');
    return `
      <div class="rs-item ${isSel ? 'rs-item--selected' : ''}" data-url="${escapeHtml(r.url)}">
        <div class="rs-check-cell"><input type="checkbox" ${isSel ? 'checked' : ''} class="rs-sel"></div>
        ${thumb}
        <div class="rs-info">
          <div class="rs-name" title="${escapeHtml(r.filename)}">${escapeHtml(r.filename)}</div>
          <div class="rs-url" title="${escapeHtml(r.url)}">${escapeHtml(r.url)}</div>
          <div class="rs-meta">${meta}</div>
        </div>
        <div class="rs-actions">
          ${r.subtype === 'hls' || r.subtype === 'dash' || (r.url || '').includes('.m3u8') ?
            `<button class="btn btn--secondary btn--sm rs-m3u8" data-url="${escapeHtml(r.url)}" title="解析 M3U8">📺</button>` : ''}
          <button class="btn btn--secondary btn--sm rs-dl" data-url="${escapeHtml(r.url)}" title="下载">⬇️</button>
          <button class="btn btn--secondary btn--sm rs-copy" data-url="${escapeHtml(r.url)}" title="复制链接">📋</button>
          <button class="btn btn--secondary btn--sm rs-open" data-url="${escapeHtml(r.url)}" title="新窗口打开">🔗</button>
        </div>
      </div>
    `;
  }).join('');
  $list.innerHTML = html;
  bindRowEvents();
  // 详情面板点击事件委托
  $list.querySelectorAll('.rs-item').forEach(row => {
    row.addEventListener('click', (e) => {
      // 排除按钮和复选框区域
      if (e.target.closest('.rs-actions') || e.target.closest('.rs-check-cell')) return;
      const url = row.dataset.url;
      if (activeDetailUrl === url) {
        closeDetailPanel();
      } else {
        showDetailPanel(row, url);
      }
    });
  });
}

function bindRowEvents() {
  $list.querySelectorAll('.rs-item').forEach(row => {
    const url = row.dataset.url;
    const thumbImg = row.querySelector('img[data-thumb="1"]');
    if (thumbImg) {
      thumbImg.addEventListener('error', () => {
        thumbImg.parentElement.innerHTML = '<span class="rs-thumb-empty">❌</span>';
      });
    }
    row.querySelector('.rs-sel').addEventListener('change', (e) => {
      if (e.target.checked) selected.add(url); else selected.delete(url);
      row.classList.toggle('rs-item--selected', e.target.checked);
      updateSummary();
    });
    row.querySelector('.rs-dl').addEventListener('click', () => downloadOne(url));
    row.querySelector('.rs-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(url); toast('链接已复制'); } catch (e) {}
    });
    row.querySelector('.rs-open').addEventListener('click', () => {
      try { window.open(url, '_blank'); } catch (e) {}
    });
    const m3 = row.querySelector('.rs-m3u8');
    if (m3) m3.addEventListener('click', () => parseM3U8(url));
  });
}

function closeDetailPanel() {
  const existing = $list.querySelector('.rs-detail-panel');
  if (existing) existing.remove();
  activeDetailUrl = null;
}

function showDetailPanel(row, url) {
  closeDetailPanel();
  const r = allResources.find(x => x.url === url);
  if (!r) return;
  activeDetailUrl = url;
  const fields = [
    ['URL', r.url, true],
    ['文件名', r.filename],
    ['类型', r.type],
    ['子类型', r.subtype],
    ['MIME', r.mime],
    ['来源', r.source],
    ['大小', formatSize(r.size)],
    ['时长', r.duration ? formatDuration(r.duration) + ' (' + r.duration.toFixed(1) + 's)' : ''],
    ['分辨率', r.width && r.height ? `${r.width}×${r.height}` : ''],
    ['码率', formatBitrate(r.bitrate)],
    ['播放状态', r.playState],
    ['当前时间', r.currentTime != null ? formatDuration(r.currentTime) : ''],
    ['音量', r.volume != null ? (r.volume * 100).toFixed(0) + '%' : ''],
    ['静音', r.muted != null ? (r.muted ? '是' : '否') : ''],
    ['自动播放', r.autoplay != null ? (r.autoplay ? '是' : '否') : ''],
    ['循环', r.loop != null ? (r.loop ? '是' : '否') : ''],
    ['播放速率', r.playbackRate != null ? r.playbackRate + 'x' : ''],
    ['编解码器', r.codec],
    ['帧率', r.fps ? r.fps + 'fps' : ''],
    ['采样率', r.sampleRate ? r.sampleRate + 'Hz' : ''],
    ['声道', r.channels],
    ['首次发现时间', r.firstSeen ? new Date(r.firstSeen).toLocaleString() : ''],
    ['引用次数', r.refCount != null ? String(r.refCount) : ''],
  ].filter(([, v]) => v != null && v !== '');
  const rows = fields.map(([label, value, isUrl]) => {
    const display = isUrl ? `<span class="rs-detail-value" style="word-break:break-all;user-select:all">${escapeHtml(value)}</span>` : `<span class="rs-detail-value">${escapeHtml(String(value))}</span>`;
    return `<div class="rs-detail-row"><span class="rs-detail-label">${label}</span>${display}</div>`;
  }).join('');
  const panel = document.createElement('div');
  panel.className = 'rs-detail-panel';
  panel.innerHTML = `
    <div class="rs-detail-header">
      <span>📋 资源详情</span>
      <button class="rs-detail-close" title="关闭">✕</button>
    </div>
    <div class="rs-detail-body">${rows}</div>
  `;
  row.after(panel);
  panel.querySelector('.rs-detail-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeDetailPanel();
  });
}

function updateSummary() {
  const counts = { all: allResources.length, video: 0, audio: 0, image: 0, document: 0, font: 0 };
  allResources.forEach(r => { if (counts[r.type] != null) counts[r.type]++; });
  Object.keys(counts).forEach(k => {
    const el = document.getElementById('cnt-' + k);
    if (el) el.textContent = counts[k];
  });
  // 计算视频/音频总时长
  let videoDuration = 0, audioDuration = 0;
  allResources.forEach(r => {
    if (r.duration && isFinite(r.duration) && r.duration > 0) {
      if (r.type === 'video') videoDuration += r.duration;
      else if (r.type === 'audio') audioDuration += r.duration;
    }
  });
  // 计算总大小和已选大小
  const totalSize = allResources.reduce((s, r) => s + (r.size || 0), 0);
  const selectedSize = allResources.filter(r => selected.has(r.url)).reduce((s, r) => s + (r.size || 0), 0);
  // 构建汇总文本
  let parts = [`共 <b>${allResources.length}</b> 个资源`];
  if (counts.video > 0) {
    parts.push(`视频 <b>${counts.video}</b> (总时长 ${formatDuration(videoDuration)})`);
  } else {
    parts.push(`视频 <b>0</b>`);
  }
  if (counts.audio > 0) {
    parts.push(`音频 <b>${counts.audio}</b> (总时长 ${formatDuration(audioDuration)})`);
  } else {
    parts.push(`音频 <b>0</b>`);
  }
  if (counts.image > 0) parts.push(`图片 <b>${counts.image}</b>`);
  if (counts.document > 0) parts.push(`文档 <b>${counts.document}</b>`);
  if (counts.font > 0) parts.push(`字体 <b>${counts.font}</b>`);
  if (totalSize > 0) parts.push(`总大小 ${formatSize(totalSize)}`);
  const selectedPart = selected.size > 0
    ? `已选 <b style="color:var(--tt-primary)">${selected.size}</b> 项 (${formatSize(selectedSize)})`
    : `已选 <b style="color:var(--tt-primary)">0</b> 项`;
  $summary.innerHTML = `
    <span>${parts.join(' · ')}</span>
    <span>${selectedPart}</span>
  `;
}

async function downloadOne(url, filename) {
  if (!url) return;
  toast('开始下载: ' + (filename || url.split('/').pop()));
  const r = await call('downloadResource', { url, filename });
  if (r && r.success) toast('已加入下载队列');
  else toast('下载失败: ' + (r?.error || '未知错误'));
}

async function downloadSelected() {
  if (!selected.size) { toast('请先勾选资源'); return; }
  const items = Array.from(selected).map(url => {
    const r = allResources.find(x => x.url === url);
    return { url, filename: r ? r.filename : null };
  });
  toast(`开始批量下载 ${items.length} 项...`);
  const res = await call('batchDownload', { items, concurrency: 3 });
  if (res && res.success) {
    const ok = res.results.filter(x => x.success).length;
    toast(`完成 ${ok}/${res.total}`);
  } else toast('批量下载失败');
}

async function parseM3U8(url) {
  if (!url) return;
  $m3u8Panel.style.display = 'flex';
  $m3u8Body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--tt-text-muted)">⏳ 解析中...</div>';
  const r = await call('parseM3U8', { url, maxSegments: 2000 });
  if (!r || !r.success) {
    $m3u8Body.innerHTML = `<div style="padding:10px;color:var(--tt-danger)">❌ 解析失败: ${escapeHtml(r?.error || '未知错误')}</div>`;
    return;
  }
  // 保存当前 M3U8 数据供下载合并使用
  window.__currentM3U8 = { url, data: r };
  const totalSize = r.segments.reduce((s, x) => s + (x.duration || 0), 0);
  const sizeMb = (r.segments.length * 1.5).toFixed(1); // 粗略估计
  const segPreview = r.segments.slice(0, 10).map((s, i) =>
    `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--tt-border);font-size:10px">
      <span>#${s.index} · ${s.duration ? s.duration.toFixed(2) + 's' : '?'}</span>
      <span style="color:var(--tt-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60%">${escapeHtml(s.url)}</span>
    </div>`).join('');

  // 加密状态显示
  let encryptionHtml = '';
  if (r.encryption) {
    if (r.encryption.hasDRM) {
      encryptionHtml = `<div style="padding:6px 8px;background:rgba(220,50,50,0.1);border:1px solid rgba(220,50,50,0.3);border-radius:4px;margin-bottom:8px;font-size:11px;color:#dc3232">🔒 DRM加密 (${escapeHtml(r.encryption.methods.join(', '))}) — 无法解密，需使用录屏工具</div>`;
    } else if (r.encryption.hasAES128) {
      encryptionHtml = `<div style="padding:6px 8px;background:rgba(255,180,0,0.1);border:1px solid rgba(255,180,0,0.3);border-radius:4px;margin-bottom:8px;font-size:11px;color:#b8860b">🔐 AES-128加密 — 将自动获取密钥解密并合并</div>`;
    } else if (r.encryption.hasEncryption) {
      encryptionHtml = `<div style="padding:6px 8px;background:rgba(220,50,50,0.1);border:1px solid rgba(220,50,50,0.3);border-radius:4px;margin-bottom:8px;font-size:11px;color:#dc3232">🔒 加密 (${escapeHtml(r.encryption.methods.join(', '))}) — 暂不支持此加密方式</div>`;
    } else {
      encryptionHtml = `<div style="padding:6px 8px;background:rgba(80,180,80,0.1);border:1px solid rgba(80,180,80,0.3);border-radius:4px;margin-bottom:8px;font-size:11px;color:#2e7d32">🔓 无加密 — 可直接下载合并</div>`;
    }
  }

  let html = `
    <div style="background:var(--tt-bg-secondary);padding:8px;border-radius:5px;margin-bottom:8px">
      <div><b>主播放列表:</b> ${r.isMaster ? '✅ 是（多码率）' : '❌ 否（直接媒体）'}</div>
      <div><b>片段总数:</b> ${r.totalSegments}</div>
      <div><b>总时长:</b> ${totalSize.toFixed(1)}s (${(totalSize / 60).toFixed(1)}min)</div>
      <div><b>估计大小:</b> ~${sizeMb}MB</div>
    </div>
    ${encryptionHtml}
  `;
  if (r.variants && r.variants.length) {
    html += `<div style="margin-bottom:6px;font-weight:600">📺 可选码率（${r.variants.length}）</div>`;
    html += r.variants.map((v, i) => `
      <div class="rs-m3u8-variant">
        <div>
          <b>${v.resolution || '默认'}</b>
          <span class="rs-m3u8-seg-count">${(v.bandwidth/1000).toFixed(0)}kbps</span>
        </div>
        <div>
          <button class="btn btn--secondary btn--sm rs-m3u8-pick" data-url="${escapeHtml(v.url)}" data-idx="${i}">使用此码率</button>
        </div>
      </div>
    `).join('');
  }
  html += `<div style="margin:8px 0 4px;font-weight:600">📦 片段预览（前10）</div><div>${segPreview || '<i style="color:var(--tt-text-muted)">无片段</i>'}</div>`;

  // 下载合并按钮
  const canMerge = !r.encryption?.hasDRM && !r.encryption?.methods?.some(m => m !== 'AES-128' && m !== 'NONE');
  if (canMerge && r.segments.length > 0) {
    html += `
      <div style="margin-top:12px;padding:10px;background:var(--tt-bg-secondary);border-radius:6px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <button class="btn btn--primary" id="btn-m3u8-merge" style="flex:1">⬇️ 下载合并全部片段 (${r.segments.length}个)</button>
        </div>
        <div id="rs-merge-progress" style="display:none;margin-top:6px">
          <div style="background:var(--tt-bg-tertiary);border-radius:3px;height:6px;overflow:hidden">
            <div id="rs-merge-bar" style="height:100%;background:var(--tt-primary);width:0%;transition:width .3s"></div>
          </div>
          <div id="rs-merge-status" style="font-size:10px;color:var(--tt-text-muted);margin-top:4px"></div>
        </div>
      </div>
    `;
  }

  $m3u8Body.innerHTML = html;
  $m3u8Body.querySelectorAll('.rs-m3u8-pick').forEach(btn => {
    btn.addEventListener('click', () => parseM3U8(btn.dataset.url));
  });
  // 绑定下载合并按钮
  const mergeBtn = document.getElementById('btn-m3u8-merge');
  if (mergeBtn) {
    mergeBtn.addEventListener('click', () => mergeAndDownloadM3U8(url));
  }
}

async function mergeAndDownloadM3U8(m3u8Url) {
  const mergeBtn = document.getElementById('btn-m3u8-merge');
  const progressDiv = document.getElementById('rs-merge-progress');
  const progressBar = document.getElementById('rs-merge-bar');
  const progressStatus = document.getElementById('rs-merge-status');
  if (!mergeBtn) return;

  // 禁用按钮，显示进度
  mergeBtn.disabled = true;
  mergeBtn.textContent = '⏳ 下载合并中...';
  if (progressDiv) progressDiv.style.display = 'block';

  function updateProgress(msg, pct) {
    if (progressBar) progressBar.style.width = pct + '%';
    if (progressStatus) progressStatus.textContent = msg;
  }

  try {
    updateProgress('正在解析 M3U8 并下载片段...', 10);
    const r = await call('downloadAndMergeM3U8', { url: m3u8Url });
    if (r && r.success) {
      const sizeStr = formatSize(r.totalSize);
      const failMsg = r.failedSegments > 0 ? ` (${r.failedSegments}个片段失败)` : '';
      updateProgress(`✅ 完成！${r.successSegments}/${r.totalSegments}片段${failMsg} · ${sizeStr}`, 100);
      toast(`下载合并成功: ${r.filename}`);
    } else {
      const errMsg = r?.isDRM ? 'DRM加密，无法解密' : (r?.error || '未知错误');
      updateProgress(`❌ 失败: ${escapeHtml(errMsg)}`, 0);
      toast('下载合并失败: ' + errMsg);
    }
  } catch (e) {
    updateProgress('❌ 请求异常: ' + escapeHtml(e.message), 0);
    toast('下载合并异常');
  } finally {
    mergeBtn.disabled = false;
    mergeBtn.textContent = '⬇️ 重新下载合并';
  }
}

function scan() {
  $summary.innerHTML = '<span>⏳ 正在扫描...</span>';
  scanOpts = {
    includeNetwork: $incNet.checked,
    includeDom: $incDom.checked,
    includeMeta: $incMeta.checked,
    dedupe: $dedupe.value
  };
  post('clearNetworkCache');
  // 提示用户滚动以加载懒加载资源
  post('extractResources', { options: scanOpts });
}

function selectByType(type) {
  selected.clear();
  allResources.filter(r => r.type === type).forEach(r => selected.add(r.url));
  applyFilter();
  updateSummary();
  toast(`已选 ${selected.size} 个${type}资源`);
}

function clearSelection() {
  selected.clear();
  applyFilter();
  updateSummary();
}

// 事件绑定
document.getElementById('btn-scan').addEventListener('click', scan);
document.getElementById('btn-rescan').addEventListener('click', scan);
document.getElementById('btn-download-selected').addEventListener('click', downloadSelected);
document.getElementById('btn-select-video').addEventListener('click', () => selectByType('video'));
document.getElementById('btn-select-image').addEventListener('click', () => selectByType('image'));
document.getElementById('btn-select-audio').addEventListener('click', () => selectByType('audio'));
document.getElementById('btn-clear-sel').addEventListener('click', clearSelection);
document.getElementById('btn-m3u8-close').addEventListener('click', () => $m3u8Panel.style.display = 'none');
$search.addEventListener('input', debounce(applyFilter, 200));
$dedupe.addEventListener('change', scan);
$sort.addEventListener('change', applyFilter);
$incNet.addEventListener('change', scan);
$incDom.addEventListener('change', scan);
$incMeta.addEventListener('change', scan);
// 实时监控切换
const $liveToggle = document.getElementById('rs-live-toggle');
if ($liveToggle) {
  $liveToggle.addEventListener('click', () => {
    isLiveMonitor = !isLiveMonitor;
    $liveToggle.classList.toggle('rs-live--active', isLiveMonitor);
    post('toggleLiveMonitor', { enabled: isLiveMonitor });
    safeStorage('set', { toolbox_resource_sniffer: { isLiveMonitor, scanOpts } });
  });
}
// 快捷筛选按钮
const $filterLongVideo = document.getElementById('rs-filter-long-video');
if ($filterLongVideo) {
  $filterLongVideo.addEventListener('click', () => {
    isFilterLongVideo = !isFilterLongVideo;
    $filterLongVideo.classList.toggle('rs-filter--active', isFilterLongVideo);
    applyFilter();
  });
}
const $filterHD = document.getElementById('rs-filter-hd');
if ($filterHD) {
  $filterHD.addEventListener('click', () => {
    isFilterHD = !isFilterHD;
    $filterHD.classList.toggle('rs-filter--active', isFilterHD);
    applyFilter();
  });
}
$tabs.addEventListener('click', (e) => {
  const t = e.target.closest('.rs-tab');
  if (!t) return;
  $tabs.querySelectorAll('.rs-tab').forEach(x => x.classList.remove('rs-tab--active'));
  t.classList.add('rs-tab--active');
  currentFilter = t.dataset.filter;
  applyFilter();
});

function debounce(fn, ms) {
  let t;
  return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

// 接收消息
window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  const { action, data } = e.data;
  if (action === 'setTheme' && data) document.documentElement.setAttribute('data-theme', data.theme);
  if (action === 'resourceList' && data) {
    allResources = data.list || [];
    updateSummary();
    applyFilter();
    toast(`扫描完成: ${allResources.length} 项`);
  }
  if (action === 'resourceUpdate' && data) {
    const newItems = data.list || [];
    if (newItems.length) {
      const existingUrls = new Set(allResources.map(r => r.url));
      let added = 0;
      newItems.forEach(r => {
        if (!existingUrls.has(r.url)) {
          // 补充显示所需的字段
          if (!r.filename) {
            try { r.filename = decodeURIComponent(new URL(r.url).pathname.split('/').filter(Boolean).pop() || '').split('?')[0] || 'unnamed'; } catch(e) { r.filename = 'unnamed'; }
          }
          if (!r.mime) r.mime = '';
          if (!r.size) r.size = r.transferSize || r.encodedBodySize || 0;
          if (!r.source) r.source = 'network';
          allResources.push(r);
          existingUrls.add(r.url);
          added++;
        }
      });
      if (added > 0 && isLiveMonitor) {
        updateSummary();
        applyFilter();
        toast(`实时更新: +${added} 项`);
      }
    }
  }
  if (action === 'liveMonitorStarted') {
    toast('实时监控已开启');
  }
  if (action === 'liveMonitorStopped') {
    toast('实时监控已关闭');
  }
});

// 加载保存的状态
(async () => {
  try {
    const result = await safeStorage('get', 'toolbox_resource_sniffer');
    const saved = result.toolbox_resource_sniffer;
    if (saved) {
      if (saved.isLiveMonitor) {
        isLiveMonitor = true;
        if ($liveToggle) $liveToggle.classList.add('rs-live--active');
        post('toggleLiveMonitor', { enabled: true });
      }
      if (saved.scanOpts) {
        scanOpts = { ...scanOpts, ...saved.scanOpts };
        if ($incNet) $incNet.checked = scanOpts.includeNetwork;
        if ($incDom) $incDom.checked = scanOpts.includeDom;
        if ($incMeta) $incMeta.checked = scanOpts.includeMeta;
        if ($dedupe) $dedupe.value = scanOpts.dedupe || 'exact';
      }
    }
  } catch (e) {}
})();

// 自动扫描
setTimeout(scan, 800);
})();
