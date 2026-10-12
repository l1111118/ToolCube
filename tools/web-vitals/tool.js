/**
 * Web Vitals 仪表盘
 * 通过 content script 收集页面性能指标
 */
(function(){
'use strict';
function postContent(action, data) {
  window.parent.postMessage({ action: 'sendToContent', data: { id: Math.random().toString(36).slice(2), action, data } }, '*');
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function formatMs(ms) { return ms > 0 ? Math.round(ms) + 'ms' : '—'; }
function formatBytes(b) {
  if (b < 1024) return b + 'B';
  if (b < 1024*1024) return (b/1024).toFixed(1) + 'KB';
  return (b/1024/1024).toFixed(2) + 'MB';
}
function classify(value, good, bad) {
  if (value <= good) return 'good';
  if (value <= bad) return 'warn';
  return 'bad';
}
function classifyPercent(value, goodPct, badPct) {
  if (value <= goodPct) return 'good';
  if (value <= badPct) return 'warn';
  return 'bad';
}

// 性能建议生成
function getRecommendations(v) {
  const recs = [];
  if (v.lcp && v.lcp > 2500) {
    recs.push({ metric: 'LCP', level: v.lcp > 4000 ? 'bad' : 'warn', text: 'LCP过慢。建议：优化最大内容元素的加载速度，使用图片CDN、预加载关键资源、优化服务器响应时间。' });
  }
  if (v.fid && v.fid > 100) {
    recs.push({ metric: 'FID', level: v.fid > 300 ? 'bad' : 'warn', text: 'FID过高。建议：减少主线程JavaScript执行时间，拆分长任务，使用Web Workers处理复杂计算。' });
  }
  if (v.inp && v.inp > 200) {
    recs.push({ metric: 'INP', level: v.inp > 500 ? 'bad' : 'warn', text: 'INP过高。建议：优化交互响应速度，拆分长任务，使用 requestIdleCallback 延迟非关键工作，减少主线程阻塞。' });
  }
  if (v.cls != null && v.cls > 0.1) {
    recs.push({ metric: 'CLS', level: v.cls > 0.25 ? 'bad' : 'warn', text: 'CLS过高。建议：为图片/视频设置明确的宽高，避免在视口上方动态插入内容，使用CSS contain属性。' });
  }
  if (v.fcp && v.fcp > 1800) {
    recs.push({ metric: 'FCP', level: v.fcp > 3000 ? 'bad' : 'warn', text: 'FCP过慢。建议：减少渲染阻塞资源，内联关键CSS，延迟非关键JS。' });
  }
  if (v.ttfb && v.ttfb > 800) {
    recs.push({ metric: 'TTFB', level: v.ttfb > 1800 ? 'bad' : 'warn', text: 'TTFB过高。建议：使用CDN、优化服务器响应速度、启用缓存、减少重定向。' });
  }
  if (recs.length === 0) {
    recs.push({ metric: '', level: 'good', text: '🎉 所有指标表现良好！页面性能优秀，继续保持。' });
  }
  return recs;
}

// 历史数据对比
let vitalHistory = [];
function loadHistory() {
  try {
    const d = localStorage.getItem('web_vitals_history');
    if (d) vitalHistory = JSON.parse(d);
  } catch(e) {}
}
function saveToHistory(vitals) {
  try {
    vitalHistory.push({ ...vitals, timestamp: Date.now() });
    if (vitalHistory.length > 20) vitalHistory = vitalHistory.slice(-20);
    localStorage.setItem('web_vitals_history', JSON.stringify(vitalHistory));
  } catch(e) {}
}
function renderHistoryComparison(v) {
  const area = document.getElementById('wv-history');
  if (!area) return;
  if (vitalHistory.length < 2) {
    area.innerHTML = '<div class="wv-empty">需要至少2次测量才能对比</div>';
    return;
  }
  const prev = vitalHistory[vitalHistory.length - 2];
  const curr = v;
  const metrics = [
    { name: 'LCP', prev: prev.lcp, curr: curr.lcp, unit: 'ms', lower: true },
    { name: 'FID', prev: prev.fid, curr: curr.fid, unit: 'ms', lower: true },
    { name: 'INP', prev: prev.inp, curr: curr.inp, unit: 'ms', lower: true },
    { name: 'CLS', prev: prev.cls, curr: curr.cls, unit: '', lower: true },
    { name: 'FCP', prev: prev.fcp, curr: curr.fcp, unit: 'ms', lower: true },
    { name: 'TTFB', prev: prev.ttfb, curr: curr.ttfb, unit: 'ms', lower: true },
  ];
  let html = '<table class="wv-compare-table"><thead><tr><th>指标</th><th>上次</th><th>本次</th><th>变化</th></tr></thead><tbody>';
  for (const m of metrics) {
    if (m.prev == null && m.curr == null) continue;
    const pv = m.prev != null ? (m.unit === 'ms' ? formatMs(m.prev) : m.prev.toFixed(3)) : '—';
    const cv = m.curr != null ? (m.unit === 'ms' ? formatMs(m.curr) : m.curr.toFixed(3)) : '—';
    let diff = '';
    if (m.prev != null && m.curr != null) {
      const d = m.curr - m.prev;
      const better = m.lower ? d < 0 : d > 0;
      const cls = better ? 'wv-diff-good' : d === 0 ? 'wv-diff-same' : 'wv-diff-bad';
      diff = `<span class="${cls}">${d > 0 ? '+' : ''}${m.unit === 'ms' ? Math.round(d) + 'ms' : d.toFixed(3)}</span>`;
    }
    html += `<tr><td>${m.name}</td><td>${pv}</td><td>${cv}</td><td>${diff}</td></tr>`;
  }
  html += '</tbody></table>';
  area.innerHTML = html;
}

// 综合评分计算 (0-100)，综合所有可用指标
function calcScore(v) {
  let score = 0, scoreMax = 0;
  const items = [
    { val: v.lcp, good: 2500, bad: 4000 },
    { val: v.fid, good: 100, bad: 300 },
    { val: v.cls, good: 0.1, bad: 0.25 },
    { val: v.inp, good: 200, bad: 500 },
    { val: v.fcp, good: 1800, bad: 3000 },
    { val: v.ttfb, good: 800, bad: 1800 },
  ];
  for (const it of items) {
    if (it.val != null && it.val >= 0) {
      let s;
      if (it.val <= it.good) s = 100;
      else if (it.val <= it.bad) s = 75;
      else s = 50;
      score += s; scoreMax += 100;
    }
  }
  return scoreMax > 0 ? Math.round(score / scoreMax * 100) : 0;
}

// 历史趋势图：用 canvas 绘制最近 10 次测量的综合评分折线
function renderHistoryChart() {
  const canvas = document.getElementById('wv-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const data = vitalHistory.slice(-10);
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, h = canvas.clientHeight || 160;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // 读取主题色
  const cs = getComputedStyle(document.documentElement);
  const cMuted = (cs.getPropertyValue('--tt-text-muted') || '#999').trim();
  const cBorder = (cs.getPropertyValue('--tt-border') || '#ddd').trim();
  const cPrimary = (cs.getPropertyValue('--tt-primary') || '#007bff').trim();
  if (!data.length) {
    ctx.fillStyle = cMuted; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('暂无历史数据，请先进行测量', w / 2, h / 2);
    return;
  }
  const padL = 28, padR = 12, padT = 14, padB = 22;
  const cw = w - padL - padR, ch = h - padT - padB;
  // 网格线
  ctx.strokeStyle = cBorder; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + ch * i / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
  }
  // Y 轴标签 (100/75/50/25/0)
  ctx.fillStyle = cMuted; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + ch * i / 4;
    ctx.fillText(String(100 - i * 25), padL - 4, y + 3);
  }
  // 计算每次综合评分
  const scores = data.map(d => calcScore(d));
  const stepX = data.length > 1 ? cw / (data.length - 1) : 0;
  const points = scores.map((s, i) => ({ x: padL + (data.length > 1 ? i * stepX : cw / 2), y: padT + ch * (1 - s / 100), s }));
  // 折线
  ctx.strokeStyle = cPrimary; ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
  ctx.stroke();
  // 数据点
  ctx.fillStyle = cPrimary;
  for (const p of points) {
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
  }
  // X 轴标签 (测量序号)
  ctx.fillStyle = cMuted; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
  const offset = vitalHistory.length - data.length;
  points.forEach((p, i) => {
    ctx.fillText('#' + (offset + i + 1), p.x, h - padB + 12);
  });
  // 评分数值标注
  ctx.fillStyle = cPrimary; ctx.font = 'bold 10px sans-serif';
  points.forEach(p => { ctx.fillText(String(p.s), p.x, p.y - 7); });
}

let lastVitals = null;
let lastResources = null;

function measure() {
  document.querySelectorAll('.wv-card').forEach(c => { c.classList.remove('wv-card--good', 'wv-card--warn', 'wv-card--bad'); c.querySelector('.wv-card-value').textContent = '—'; c.querySelector('.wv-card-bar-fill').style.width = '0'; });
  document.getElementById('wv-slow').innerHTML = '<div class="wv-empty">⏳ 测量中...</div>';
  document.getElementById('wv-stats').innerHTML = '';
  const recsArea = document.getElementById('wv-recommendations');
  if (recsArea) recsArea.innerHTML = '<div class="wv-empty">⏳ 测量中...</div>';
  const histArea = document.getElementById('wv-history');
  if (histArea) histArea.innerHTML = '<div class="wv-empty">⏳ 测量中...</div>';
  const chartCanvas = document.getElementById('wv-chart');
  if (chartCanvas) { const c = chartCanvas.getContext('2d'); c.clearRect(0, 0, chartCanvas.width, chartCanvas.height); }
  postContent('collectWebVitals');
}

function render(vitals, resources) {
  lastVitals = vitals; lastResources = resources;
  const v = vitals;
  // LCP
  const lcpCard = document.querySelector('[data-metric="lcp"]');
  if (v.lcp) {
    lcpCard.classList.add('wv-card--' + classify(v.lcp, 2500, 4000));
    lcpCard.querySelector('.wv-card-value').textContent = formatMs(v.lcp);
    lcpCard.querySelector('.wv-card-bar-fill').style.width = Math.min(100, v.lcp / 50) + '%';
  }
  // FID
  const fidCard = document.querySelector('[data-metric="fid"]');
  if (v.fid) {
    fidCard.classList.add('wv-card--' + classify(v.fid, 100, 300));
    fidCard.querySelector('.wv-card-value').textContent = formatMs(v.fid);
    fidCard.querySelector('.wv-card-bar-fill').style.width = Math.min(100, v.fid * 1.5) + '%';
  }
  // INP
  const inpCard = document.querySelector('[data-metric="inp"]');
  if (v.inp) {
    inpCard.classList.add('wv-card--' + classify(v.inp, 200, 500));
    inpCard.querySelector('.wv-card-value').textContent = formatMs(v.inp);
    inpCard.querySelector('.wv-card-bar-fill').style.width = Math.min(100, v.inp / 5) + '%';
  }
  // CLS
  const clsCard = document.querySelector('[data-metric="cls"]');
  if (v.cls != null) {
    clsCard.classList.add('wv-card--' + classify(v.cls, 0.1, 0.25));
    clsCard.querySelector('.wv-card-value').textContent = v.cls.toFixed(3);
    clsCard.querySelector('.wv-card-bar-fill').style.width = Math.min(100, v.cls * 200) + '%';
  }
  // FCP
  const fcpCard = document.querySelector('[data-metric="fcp"]');
  if (v.fcp) {
    fcpCard.classList.add('wv-card--' + classify(v.fcp, 1800, 3000));
    fcpCard.querySelector('.wv-card-value').textContent = formatMs(v.fcp);
    fcpCard.querySelector('.wv-card-bar-fill').style.width = Math.min(100, v.fcp / 50) + '%';
  }
  // TTFB
  const ttfbCard = document.querySelector('[data-metric="ttfb"]');
  if (v.ttfb) {
    ttfbCard.classList.add('wv-card--' + classify(v.ttfb, 800, 1800));
    ttfbCard.querySelector('.wv-card-value').textContent = formatMs(v.ttfb);
    ttfbCard.querySelector('.wv-card-bar-fill').style.width = Math.min(100, v.ttfb / 30) + '%';
  }
  // 总分: 综合所有 Core Web Vitals 指标评分
  const scoreCard = document.querySelector('[data-metric="score"]');
  const pct = calcScore(v);
  if (pct > 0) {
    scoreCard.classList.add('wv-card--' + classifyPercent(100 - pct, 30, 60));
    scoreCard.querySelector('.wv-card-value').textContent = pct + ' 分';
    scoreCard.querySelector('.wv-card-bar-fill').style.width = pct + '%';
  }
  // 慢资源
  const slowList = document.getElementById('wv-slow');
  if (!resources.slow || !resources.slow.length) {
    slowList.innerHTML = '<div class="wv-empty">🎉 没有超过 200ms 的慢资源</div>';
  } else {
    slowList.innerHTML = resources.slow.map(r => `
      <div class="wv-slow-item">
        <div class="wv-slow-item-type">${escapeHtml(r.type)}</div>
        <div class="wv-slow-item-url" title="${escapeHtml(r.name)}">${escapeHtml(r.name.split('?')[0])}</div>
        <div class="wv-slow-item-time">${formatMs(r.duration)}</div>
        <div class="wv-slow-item-size">${formatBytes(r.size)}</div>
      </div>
    `).join('');
  }
  // 资源统计
  document.getElementById('wv-stats').innerHTML = `
    <div class="wv-stat"><div class="wv-stat-value">${resources.total}</div><div class="wv-stat-label">资源总数</div></div>
    <div class="wv-stat"><div class="wv-stat-value">${formatBytes(resources.totalSize)}</div><div class="wv-stat-label">总传输</div></div>
    <div class="wv-stat"><div class="wv-stat-value">${resources.slow?.length || 0}</div><div class="wv-stat-label">慢资源</div></div>
    <div class="wv-stat"><div class="wv-stat-value">${v.navigation ? formatMs(v.navigation.load) : '—'}</div><div class="wv-stat-label">Load 完成</div></div>
  `;
  // 页面
  const pageUrl = resources?.pageUrl || location.href;
  try {
    const u = new URL(pageUrl);
    document.getElementById('wv-page').textContent = u.host + u.pathname.substring(0, 60);
  } catch (e) {
    document.getElementById('wv-page').textContent = pageUrl.substring(0, 80);
  }

  // 性能建议
  const recsArea = document.getElementById('wv-recommendations');
  if (recsArea) {
    const recs = getRecommendations(v);
    recsArea.innerHTML = recs.map(r => {
      const cls = r.level === 'good' ? 'wv-rec-good' : r.level === 'warn' ? 'wv-rec-warn' : 'wv-rec-bad';
      return `<div class="wv-rec-item ${cls}">${r.metric ? '<strong>' + r.metric + '</strong>: ' : ''}${escapeHtml(r.text)}</div>`;
    }).join('');
  }

  // 保存到历史 & 对比 & 趋势图
  saveToHistory(v);
  renderHistoryComparison(v);
  renderHistoryChart();
}

loadHistory();
renderHistoryChart();
document.getElementById('btn-measure').addEventListener('click', measure);

window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data && e.data.action === 'setTheme' && e.data.data) document.documentElement.setAttribute('data-theme', e.data.data.theme);
  if (e.data && e.data.action === 'webVitals' && e.data.data) render(e.data.data.vitals, e.data.data.resources);
});

setTimeout(measure, 500);
})();
