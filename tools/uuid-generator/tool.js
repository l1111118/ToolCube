/**
 * UUID生成器
 */
document.addEventListener('DOMContentLoaded', () => {
  const els = { list: document.getElementById('uuid-list'), bulkCount: document.getElementById('bulk-count') };
  
  function generateUUID(format) {
    if (format === 'v7') return uuidV7();
    let d = new Date().getTime(), d2 = (performance && performance.now && performance.now()*1000) || 0;
    let uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      let r = Math.random() * 16; if (d > 0) { r = (d + r) % 16 | 0; d = Math.floor(d / 16); } else { r = (d2 + r) % 16 | 0; d2 = Math.floor(d2 / 16); }
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
    if (format === 'compact') uuid = uuid.replace(/-/g, '');
    if (format === 'uppercase') uuid = uuid.toUpperCase();
    return uuid;
  }

  function uuidV7() {
    const ts = Date.now();
    const bytes = new Uint8Array(16);
    bytes[0] = ((ts / 2**40) & 0xff) | 0;
    bytes[1] = ((ts / 2**32) & 0xff);
    bytes[2] = ((ts / 2**24) & 0xff);
    bytes[3] = ((ts / 2**16) & 0xff);
    bytes[4] = ((ts / 2**8) & 0xff);
    bytes[5] = (ts & 0xff);
    crypto.getRandomValues(new Uint8Array(bytes.buffer, 6, 10));
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0,4).join('')}-${hex.slice(4,6).join('')}-${hex.slice(6,8).join('')}-${hex.slice(8,10).join('')}-${hex.slice(10).join('')}`;
  }

  function getFormat() { return document.querySelector('input[name="format"]:checked')?.value || 'standard'; }
  function generate() {
    const count = Math.min(100, Math.max(1, parseInt(els.bulkCount.value, 10) || 1));
    const format = getFormat();
    const uuids = Array.from({length: count}, () => generateUUID(format));
    els.list.innerHTML = uuids.map((u, i) => `<div class="uuid-item"><span class="uuid-num">${i+1}.</span><code>${u}</code><button class="uuid-copy" data-uuid="${u}">📋</button></div>`).join('');
    els.list.querySelectorAll('.uuid-copy').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); navigator.clipboard.writeText(btn.dataset.uuid).catch(() => {}); btn.textContent = '✅'; setTimeout(() => btn.textContent = '📋', 1500); }));
  }

  document.getElementById('btn-generate').addEventListener('click', generate);
  document.getElementById('btn-bulk').addEventListener('click', () => { els.bulkCount.value = 10; generate(); });
  document.getElementById('btn-copy').addEventListener('click', () => {
    const codes = els.list.querySelectorAll('code');
    navigator.clipboard.writeText(Array.from(codes, c => c.textContent).join('\n')).catch(() => {});
  });
  document.getElementById('btn-clear').addEventListener('click', () => { els.list.innerHTML = '<div class="uuid-item">点击"生成UUID"开始</div>'; });
  document.querySelectorAll('input[name="format"]').forEach(r => r.addEventListener('change', generate));
  generate();
});
  // 主题切换消息监听
  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
  });
