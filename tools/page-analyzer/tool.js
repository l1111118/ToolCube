/**
 * Page Analyzer Tool - 网页分析器（增强版）
 * 分析SEO、结构、性能、可访问性、技术栈、页面大小等
 */
document.addEventListener('DOMContentLoaded', () => {
  const content = document.getElementById('pa-content');
  let pendingTimeout = null;
  let pageInfoData = null;
  let webVitalsData = null;
  function escapeHtml(str) { if (str == null) return ''; return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function formatBytes(b) { if (!b || b <= 0) return '0 B'; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(2) + ' MB'; }

  function analyze() {
    content.innerHTML = '<div class="pa-placeholder">⏳ 正在分析页面信息...</div>';
    pageInfoData = null;
    webVitalsData = null;
    // 请求页面基本信息
    window.parent.postMessage({ action: 'getPageInfo' }, '*');
    // 请求Web Vitals性能数据
    window.parent.postMessage({ action: 'collectWebVitals' }, '*');
    // 超时保护：10秒后如果未收到响应，显示提示
    if (pendingTimeout) clearTimeout(pendingTimeout);
    pendingTimeout = setTimeout(() => {
      if (content.querySelector('.pa-placeholder')) {
        content.innerHTML = '<div class="pa-placeholder">⚠️ 未收到页面数据，请确保当前页面可访问后重试</div>';
      }
    }, 10000);
  }

  function tryRender() {
    // 当 pageInfo 和 webVitals 都到达时（或超时后）渲染
    if (!pageInfoData) return;
    renderAnalysis(pageInfoData, webVitalsData);
  }

  function renderAnalysis(data, vitals) {
    const cards = [];

    // ===== 性能指标 =====
    const perfItems = [];
    if (vitals && vitals.vitals) {
      const v = vitals.vitals;
      perfItems.push({ label: 'TTFB (首字节时间)', value: v.ttfb ? v.ttfb + 'ms' : '—', cls: v.ttfb < 200 ? 'good' : v.ttfb < 500 ? 'warn' : 'bad' });
      perfItems.push({ label: 'FCP (首次内容绘制)', value: v.fcp ? v.fcp + 'ms' : '—', cls: v.fcp < 1800 ? 'good' : v.fcp < 3000 ? 'warn' : 'bad' });
      perfItems.push({ label: 'LCP (最大内容绘制)', value: v.lcp ? v.lcp + 'ms' : '—', cls: v.lcp < 2500 ? 'good' : v.lcp < 4000 ? 'warn' : 'bad' });
      perfItems.push({ label: 'FID (首次输入延迟)', value: v.fid ? v.fid + 'ms' : '—', cls: v.fid < 100 ? 'good' : v.fid < 300 ? 'warn' : 'bad' });
      perfItems.push({ label: 'CLS (累积布局偏移)', value: v.cls != null ? v.cls.toFixed(3) : '—', cls: v.cls < 0.1 ? 'good' : v.cls < 0.25 ? 'warn' : 'bad' });
    }
    if (vitals && vitals.navigation) {
      const nav = vitals.navigation;
      perfItems.push({ label: 'DOM加载时间', value: nav.domContentLoaded ? nav.domContentLoaded + 'ms' : '—' });
      perfItems.push({ label: '页面完全加载', value: nav.load ? nav.load + 'ms' : '—' });
      perfItems.push({ label: 'DOM交互时间', value: nav.domInteractive ? nav.domInteractive + 'ms' : '—' });
    }
    if (vitals && vitals.resources) {
      perfItems.push({ label: '资源总数', value: String(vitals.resources.total || 0) });
      perfItems.push({ label: '资源总大小', value: formatBytes(vitals.resources.totalSize || 0) });
    }
    // 增强：来自 Performance API 的网络分解数据
    if (data.performance) {
      const p = data.performance;
      if (p.dnsTime != null) perfItems.push({ label: 'DNS解析', value: p.dnsTime + 'ms', cls: p.dnsTime < 50 ? 'good' : p.dnsTime < 200 ? 'warn' : 'bad' });
      if (p.tcpTime != null) perfItems.push({ label: 'TCP连接', value: p.tcpTime + 'ms', cls: p.tcpTime < 100 ? 'good' : p.tcpTime < 500 ? 'warn' : 'bad' });
      if (p.transferSize != null) perfItems.push({ label: '传输大小', value: formatBytes(p.transferSize) });
      if (p.decodedBodySize != null) perfItems.push({ label: '解码大小', value: formatBytes(p.decodedBodySize) });
      if (p.redirectCount > 0) perfItems.push({ label: '重定向次数', value: String(p.redirectCount), cls: 'warn' });
    }
    if (perfItems.length > 0) {
      cards.push({ title: '⚡ 性能指标', items: perfItems });
    }

    // ===== 页面大小统计 =====
    const sizeItems = [];
    // 修复：DOM 节点数应来自宿主页面（injector.js 提供），而非工具 iframe 自身的 document
    const domSize = data.domNodeCount || 0;
    let estimatedSize = 0;
    if (vitals && vitals.resources) estimatedSize = vitals.resources.totalSize || 0;
    sizeItems.push({ label: 'DOM节点数', value: String(domSize), cls: domSize < 1500 ? 'good' : domSize < 3000 ? 'warn' : 'bad' });
    sizeItems.push({ label: 'HTML大小(估计)', value: formatBytes(estimatedSize) });
    sizeItems.push({ label: '脚本数量', value: String(data.scriptCount || 0), cls: (data.scriptCount || 0) > 20 ? 'warn' : 'good' });
    sizeItems.push({ label: '样式表数量', value: String(data.styleCount || 0) });
    sizeItems.push({ label: '图片数量', value: String(data.imgCount || 0) });
    sizeItems.push({ label: '总资源数', value: String(vitals?.resources?.total || 0) });
    // 增强：内存使用情况（仅 Chromium 支持）
    if (data.memory) {
      sizeItems.push({ label: 'JS堆使用', value: formatBytes(data.memory.usedJSHeapSize), cls: 'good' });
      sizeItems.push({ label: 'JS堆总量', value: formatBytes(data.memory.totalJSHeapSize) });
    }
    cards.push({ title: '📦 页面大小统计', items: sizeItems });

    // ===== SEO分析（增强） =====
    const h1s = data.h1Count || 0;
    const descLen = data.description ? data.description.length : 0;
    const titleLen = data.title ? data.title.length : 0;
    // SEO评分简易计算
    let seoScore = 0;
    if (titleLen >= 10 && titleLen <= 70) seoScore += 15; else if (titleLen > 0) seoScore += 5;
    if (descLen >= 50 && descLen <= 160) seoScore += 15; else if (descLen > 0) seoScore += 5;
    if (h1s === 1) seoScore += 15; else if (h1s > 1) seoScore += 5;
    if (data.canonical) seoScore += 10;
    if (data.ogTitle) seoScore += 10;
    if (data.ogDescription) seoScore += 10;
    if (data.ogImage) seoScore += 5;
    if (data.lang) seoScore += 5;
    if (data.favicon) seoScore += 5;
    if (data.viewport) seoScore += 10;
    const seoCls = seoScore >= 70 ? 'good' : seoScore >= 40 ? 'warn' : 'bad';

    cards.push({
      title: '🔍 SEO 信息 (评分: ' + seoScore + '/100)',
      items: [
        { label: '页面标题', value: data.title || '—' },
        { label: '标题长度', value: `${titleLen} 字符`, cls: titleLen >= 10 && titleLen <= 70 ? 'good' : titleLen > 0 ? 'warn' : 'bad' },
        { label: 'Meta描述', value: data.description || '—' },
        { label: '描述长度', value: `${descLen} 字符`, cls: descLen >= 50 && descLen <= 160 ? 'good' : descLen > 0 ? 'warn' : 'bad' },
        { label: 'Meta关键词', value: data.keywords || '—' },
        { label: 'Canonical URL', value: data.canonical || '—', cls: data.canonical ? 'good' : 'warn' },
        { label: 'Robots', value: data.robots || '—' },
        { label: 'OG:title', value: data.ogTitle || '—', cls: data.ogTitle ? 'good' : 'warn' },
        { label: 'OG:description', value: data.ogDescription || '—', cls: data.ogDescription ? 'good' : 'warn' },
        { label: 'OG:image', value: data.ogImage ? '✅ 已设置' : '⚠️ 未设置', cls: data.ogImage ? 'good' : 'warn' },
        { label: 'SEO评分', value: seoScore + '/100', cls: seoCls },
      ]
    });

    // ===== Heading结构 =====
    const headingItems = [];
    headingItems.push({ label: 'H1数量', value: String(data.h1Count || 0), cls: h1s === 1 ? 'good' : (h1s === 0 ? 'bad' : 'warn') });
    headingItems.push({ label: 'H2数量', value: String(data.h2Count || 0) });
    for (let i = 3; i <= 6; i++) {
      const cnt = data['h' + i + 'Count'] || 0;
      headingItems.push({ label: 'H' + i + '数量', value: String(cnt) });
    }
    cards.push({ title: '📑 Heading结构', items: headingItems });

    // ===== 可访问性检查 =====
    const a11yItems = [];
    a11yItems.push({ label: '无Alt图片', value: String(data.imgNoAlt || 0), cls: (data.imgNoAlt || 0) > 0 ? 'bad' : 'good' });
    // 检查表单label
    const formInputs = (data.formCount || 0);
    a11yItems.push({ label: '表单数量', value: String(formInputs) });
    a11yItems.push({ label: 'HTML lang属性', value: data.lang || '⚠️ 未设置', cls: data.lang ? 'good' : 'bad' });
    // 修复：ARIA 元素计数必须来自宿主页面（工具 iframe 内查询会返回 0）
    a11yItems.push({ label: 'ARIA属性元素', value: String(data.ariaElCount || 0), cls: (data.ariaElCount || 0) > 0 ? 'good' : 'warn' });
    // 对比度检测提示
    a11yItems.push({ label: '对比度检查', value: '请使用颜色对比度工具详细检测', cls: 'warn' });
    // 焦点可见性
    a11yItems.push({ label: '键盘导航', value: '建议检测Tab键导航和焦点样式', cls: 'warn' });
    cards.push({ title: '♿ 可访问性(A11y)', items: a11yItems });

    // ===== 技术栈检测 =====
    const techItems = [];
    // 修复：技术栈检测必须由 injector.js 在宿主页面执行（工具 iframe 内的 document 无法访问页面）
    const techDetected = data.techStack || [];
    techItems.push({ label: '检测到的技术', value: techDetected.length > 0 ? techDetected.join(', ') : '未识别常见框架', cls: techDetected.length > 0 ? 'good' : '' });
    techItems.push({ label: '协议', value: data.protocol || '—', cls: data.protocol === 'https:' ? 'good' : 'bad' });
    techItems.push({ label: '字符集', value: data.charset || '—' });
    techItems.push({ label: 'Viewport', value: data.viewport || '⚠️ 未设置', cls: data.viewport ? 'good' : 'bad' });
    techItems.push({ label: 'Favicon', value: data.favicon ? '✅ 已设置' : '⚠️ 未设置', cls: data.favicon ? 'good' : 'warn' });
    // 增强：HTTP 协议版本
    if (data.performance && data.performance.protocol) {
      techItems.push({ label: 'HTTP协议', value: data.performance.protocol, cls: 'good' });
    }
    cards.push({ title: '⚙️ 技术栈 & 信息', items: techItems });

    // ===== 页面结构 =====
    cards.push({
      title: '📐 页面结构',
      items: [
        { label: '图片数量', value: String(data.imgCount || 0) },
        { label: '无Alt图片', value: String(data.imgNoAlt || 0), cls: data.imgNoAlt > 0 ? 'warn' : 'good' },
        { label: '链接数量', value: String(data.linkCount || 0) },
        { label: '内部链接', value: String(data.internalLinks || 0) },
        { label: '外部链接', value: String(data.externalLinks || 0) },
        { label: '表单数量', value: String(data.formCount || 0) },
        { label: '脚本数量', value: String(data.scriptCount || 0) },
        { label: '样式表数量', value: String(data.styleCount || 0) },
        { label: 'URL', value: data.url || '—' },
        { label: '域名', value: data.hostname || '—' },
      ]
    });

    // 渲染卡片
    content.innerHTML = cards.map(card => `
      <div class="pa-card">
        <div class="pa-card-title">${escapeHtml(card.title)}</div>
        <div class="pa-grid">
          ${card.items.map(item => `
            <div class="pa-item">
              <span class="pa-item-label">${escapeHtml(item.label)}</span>
              <span class="pa-item-value ${item.cls || ''}">${escapeHtml(item.value)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');

    // 追加：社交媒体卡片 + 结构化数据 + 内联资源统计
    const extraCards = buildExtraCards(data);
    if (extraCards.length) {
      content.insertAdjacentHTML('beforeend', extraCards.map(card => `
        <div class="pa-card">
          <div class="pa-card-title">${escapeHtml(card.title)}</div>
          <div class="pa-grid">
            ${card.items.map(item => `
              <div class="pa-item">
                <span class="pa-item-label">${escapeHtml(item.label)}</span>
                <span class="pa-item-value ${item.cls || ''}">${item.html ? item.value : escapeHtml(item.value)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join(''));
    }
  }

  // 构建额外分析卡片：Twitter Card / JSON-LD / 内联CSS-JS
  function buildExtraCards(data) {
    const cards = [];
    // ===== Twitter Card 检测 =====
    const twItems = [];
    const tc = data.twitterCard || {};
    twItems.push({ label: 'twitter:card', value: tc.card || '⚠️ 未设置', cls: tc.card ? 'good' : 'warn' });
    twItems.push({ label: 'twitter:title', value: tc.title || '—', cls: tc.title ? 'good' : 'warn' });
    twItems.push({ label: 'twitter:description', value: tc.description || '—' });
    twItems.push({ label: 'twitter:image', value: tc.image ? '✅ 已设置' : '⚠️ 未设置', cls: tc.image ? 'good' : 'warn' });
    twItems.push({ label: 'twitter:site', value: tc.site || '—' });
    twItems.push({ label: 'twitter:creator', value: tc.creator || '—' });
    cards.push({ title: '🐦 Twitter Card', items: twItems });

    // ===== 结构化数据 JSON-LD =====
    const ldItems = [];
    const jsonld = data.jsonld || [];
    ldItems.push({ label: 'JSON-LD数量', value: String(jsonld.length), cls: jsonld.length > 0 ? 'good' : 'warn' });
    if (jsonld.length > 0) {
      // 统计类型
      const types = {};
      jsonld.forEach(j => {
        const t = j['@type'] || '未知';
        const tName = Array.isArray(t) ? t.join('+') : t;
        types[tName] = (types[tName] || 0) + 1;
      });
      const typeStr = Object.entries(types).map(([t, c]) => `${t}(${c})`).join(', ');
      ldItems.push({ label: '结构化类型', value: typeStr, cls: 'good' });
    } else {
      ldItems.push({ label: '状态', value: '⚠️ 未检测到JSON-LD结构化数据', cls: 'warn' });
    }
    // 增强：微数据 (Microdata) 检测
    if (data.microdata && data.microdata.length) {
      ldItems.push({ label: 'Microdata项', value: String(data.microdata.length), cls: 'good' });
      const mdTypes = {};
      data.microdata.forEach(m => {
        const t = (m.type || '').split('/').pop() || '未知';
        mdTypes[t] = (mdTypes[t] || 0) + 1;
      });
      ldItems.push({ label: 'Microdata类型', value: Object.entries(mdTypes).map(([t, c]) => `${t}(${c})`).join(', '), cls: 'good' });
    }
    // 增强：RDFa 检测
    if (data.rdfaCount) {
      ldItems.push({ label: 'RDFa元素', value: String(data.rdfaCount), cls: 'good' });
    }
    cards.push({ title: '📐 结构化数据 (JSON-LD)', items: ldItems });

    // ===== 内联CSS/JS统计 =====
    const inlineItems = [];
    const inlineCss = data.inlineCssCount != null ? data.inlineCssCount : 0;
    const inlineJs = data.inlineJsCount != null ? data.inlineJsCount : 0;
    const inlineCssSize = data.inlineCssSize || 0;
    const inlineJsSize = data.inlineJsSize || 0;
    inlineItems.push({ label: '内联<style>数量', value: String(inlineCss), cls: inlineCss > 3 ? 'warn' : '' });
    inlineItems.push({ label: '内联<style>大小', value: formatBytes(inlineCssSize) });
    inlineItems.push({ label: '内联<script>数量', value: String(inlineJs), cls: inlineJs > 5 ? 'warn' : '' });
    inlineItems.push({ label: '内联<script>大小', value: formatBytes(inlineJsSize) });
    inlineItems.push({ label: '建议', value: (inlineCss > 3 || inlineJs > 5) ? '⚠️ 建议外联以提升性能' : '✅ 内联资源较少', cls: (inlineCss > 3 || inlineJs > 5) ? 'warn' : 'good' });
    cards.push({ title: '📝 内联CSS/JS统计', items: inlineItems });

    return cards;
  }

  document.getElementById('btn-analyze').addEventListener('click', analyze);
  document.getElementById('btn-refresh').addEventListener('click', analyze);

  // 导出分析报告为HTML文件
  const btnExport = document.getElementById('btn-export-report');
  if (btnExport) btnExport.addEventListener('click', () => {
    if (!pageInfoData) { alert('请先分析页面'); return; }
    const d = pageInfoData;
    const now = new Date().toLocaleString('zh-CN');
    // 提取内容文本
    const cardsText = content.querySelectorAll('.pa-card');
    let reportBody = '';
    cardsText.forEach(card => {
      const title = card.querySelector('.pa-card-title')?.textContent || '';
      reportBody += `\n## ${title}\n\n`;
      card.querySelectorAll('.pa-item').forEach(item => {
        const label = item.querySelector('.pa-item-label')?.textContent || '';
        const value = item.querySelector('.pa-item-value')?.textContent || '';
        reportBody += `- **${label}**: ${value}\n`;
      });
    });
    const report = `# 网页分析报告\n\n- **页面**: ${d.title || d.url || ''}\n- **URL**: ${d.url || ''}\n- **分析时间**: ${now}\n${reportBody}\n---\n*由本扩展生成*`;
    const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'page-report-' + new Date().toISOString().slice(0,10) + '.md';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // 接收页面信息
  window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    if (e.data && e.data.action === 'pageInfo' && e.data.data) {
      if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
      pageInfoData = e.data.data;
      tryRender();
    }
    // 注意：injector.js 通过 sendToSidebar('webVitals', ...) 回传，故监听 'webVitals'
    if (e.data && e.data.action === 'webVitals' && e.data.data) {
      webVitalsData = e.data.data;
      tryRender();
    }
    if (e.data && e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
  });

  // 初始加载时尝试分析
  setTimeout(analyze, 500);
});
