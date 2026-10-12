/**
 * File Hash Tool - 文件哈希校验
 * 使用 Web Crypto API (SubtleCrypto) 计算 SHA-1/SHA-256/SHA-512
 * MD5 使用纯 JS 实现（Web Crypto API 不支持 MD5）
 */
document.addEventListener('DOMContentLoaded',()=>{
  const dropzone=document.getElementById('fh-dropzone');
  const fileInput=document.getElementById('fh-file');
  const info=document.getElementById('fh-info');
  const progressEl=document.getElementById('fh-progress');
  const progressFill=document.getElementById('fh-progress-fill');
  const progressText=document.getElementById('fh-progress-text');
  const results=document.getElementById('fh-results');

  // ============ MD5 纯 JS 实现（公共领域算法，支持大文件分块） ============
  // 使用增量方式：md5_init -> md5_update -> md5_final
  function md5_create(){
    return {state:[1732584193,-271733879,-1732584194,271733878],count:0,buffer:new Uint8Array(64)};
  }
  function md5_rotl(n,b){return (n<<b)|(n>>>(32-b));}
  function md5_add32(a,b){return (a+b)&0xFFFFFFFF;}
  function md5_cmn(q,a,b,x,s,t){a=md5_add32(md5_add32(a,q),md5_add32(x,t));return md5_add32(md5_rotl(a,s),b);}
  function md5_ff(a,b,c,d,x,s,t){return md5_cmn((b&c)|((~b)&d),a,b,x,s,t);}
  function md5_gg(a,b,c,d,x,s,t){return md5_cmn((b&d)|(c&(~d)),a,b,x,s,t);}
  function md5_hh(a,b,c,d,x,s,t){return md5_cmn(b^c^d,a,b,x,s,t);}
  function md5_ii(a,b,c,d,x,s,t){return md5_cmn(c^(b|(~d)),a,b,x,s,t);}
  function md5_cycle(x,k){
    let a=x[0],b=x[1],c=x[2],d=x[3];
    a=md5_ff(a,b,c,d,k[0],7,-680876936);d=md5_ff(d,a,b,c,k[1],12,-389564586);c=md5_ff(c,d,a,b,k[2],17,606105819);b=md5_ff(b,c,d,a,k[3],22,-1044525330);
    a=md5_ff(a,b,c,d,k[4],7,-176418897);d=md5_ff(d,a,b,c,k[5],12,1200080426);c=md5_ff(c,d,a,b,k[6],17,-1473231341);b=md5_ff(b,c,d,a,k[7],22,-45705983);
    a=md5_ff(a,b,c,d,k[8],7,1770035416);d=md5_ff(d,a,b,c,k[9],12,-1958414417);c=md5_ff(c,d,a,b,k[10],17,-42063);b=md5_ff(b,c,d,a,k[11],22,-1990404162);
    a=md5_ff(a,b,c,d,k[12],7,1804603682);d=md5_ff(d,a,b,c,k[13],12,-40341101);c=md5_ff(c,d,a,b,k[14],17,-1502002290);b=md5_ff(b,c,d,a,k[15],22,1236535329);
    a=md5_gg(a,b,c,d,k[1],5,-165796510);d=md5_gg(d,a,b,c,k[6],9,-1069501632);c=md5_gg(c,d,a,b,k[11],14,643717713);b=md5_gg(b,c,d,a,k[0],20,-373897302);
    a=md5_gg(a,b,c,d,k[5],5,-701558691);d=md5_gg(d,a,b,c,k[10],9,38016083);c=md5_gg(c,d,a,b,k[15],14,-660478335);b=md5_gg(b,c,d,a,k[4],20,-405537848);
    a=md5_gg(a,b,c,d,k[9],5,568446438);d=md5_gg(d,a,b,c,k[14],9,-1019803690);c=md5_gg(c,d,a,b,k[3],14,-187363961);b=md5_gg(b,c,d,a,k[8],20,1163531501);
    a=md5_gg(a,b,c,d,k[13],5,-1444681467);d=md5_gg(d,a,b,c,k[2],9,-51403784);c=md5_gg(c,d,a,b,k[7],14,1735328473);b=md5_gg(b,c,d,a,k[12],20,-1926607734);
    a=md5_hh(a,b,c,d,k[5],4,-378558);d=md5_hh(d,a,b,c,k[8],11,-2022574463);c=md5_hh(c,d,a,b,k[11],16,1839030562);b=md5_hh(b,c,d,a,k[14],23,-35309556);
    a=md5_hh(a,b,c,d,k[1],4,-1530992060);d=md5_hh(d,a,b,c,k[4],11,1272893353);c=md5_hh(c,d,a,b,k[7],16,-155497632);b=md5_hh(b,c,d,a,k[10],23,-1094730640);
    a=md5_hh(a,b,c,d,k[13],4,681279174);d=md5_hh(d,a,b,c,k[0],11,-358537222);c=md5_hh(c,d,a,b,k[3],16,-722521979);b=md5_hh(b,c,d,a,k[6],23,76029189);
    a=md5_hh(a,b,c,d,k[9],4,-640364487);d=md5_hh(d,a,b,c,k[12],11,-421815835);c=md5_hh(c,d,a,b,k[15],16,530742520);b=md5_hh(b,c,d,a,k[2],23,-995338651);
    a=md5_ii(a,b,c,d,k[0],6,-198630844);d=md5_ii(d,a,b,c,k[7],10,1126891415);c=md5_ii(c,d,a,b,k[14],15,-1416354905);b=md5_ii(b,c,d,a,k[5],21,-57434055);
    a=md5_ii(a,b,c,d,k[12],6,1700485571);d=md5_ii(d,a,b,c,k[3],10,-1894986606);c=md5_ii(c,d,a,b,k[10],15,-1051523);b=md5_ii(b,c,d,a,k[1],21,-2054922799);
    a=md5_ii(a,b,c,d,k[8],6,1873313359);d=md5_ii(d,a,b,c,k[15],10,-30611744);c=md5_ii(c,d,a,b,k[6],15,-1560198380);b=md5_ii(b,c,d,a,k[13],21,1309151649);
    a=md5_ii(a,b,c,d,k[4],6,-145523070);d=md5_ii(d,a,b,c,k[11],10,-1120210379);c=md5_ii(c,d,a,b,k[2],15,718787259);b=md5_ii(b,c,d,a,k[9],21,-343485551);
    x[0]=md5_add32(a,x[0]);x[1]=md5_add32(b,x[1]);x[2]=md5_add32(c,x[2]);x[3]=md5_add32(d,x[3]);
  }
  // 将字节数组喂入状态机
  function md5_update(ctx,bytes){
    let idx = (ctx.count % 64);
    ctx.count += bytes.length;
    const partLen = 64 - idx;
    let i = 0;
    if (bytes.length >= partLen) {
      ctx.buffer.set(bytes.subarray(0, partLen), idx);
      const k = new Uint32Array(ctx.buffer.buffer.slice(0));
      md5_cycle(ctx.state, k);
      i = partLen;
      while (i + 64 <= bytes.length) {
        // 必须使用 slice 获取独立缓冲区，否则 subarray 共享原缓冲区会读到错误数据
        const chunkBuf = bytes.slice(i, i + 64).buffer;
        const k2 = new Uint32Array(chunkBuf);
        md5_cycle(ctx.state, k2);
        i += 64;
      }
      idx = 0;
    }
    if (i < bytes.length) {
      ctx.buffer.set(bytes.subarray(i), idx);
    }
  }
  function md5_final(ctx){
    const total = ctx.count;
    const idx = (total % 64);
    // 构造尾部：0x80 + 0x00... + 8字节长度
    const tail = new Uint8Array(64);
    tail.set(ctx.buffer.subarray(0, idx), 0);
    tail[idx] = 0x80;
    if (idx >= 56) {
      const k = new Uint32Array(tail.buffer.slice(0));
      md5_cycle(ctx.state, k);
      tail.fill(0);
    }
    // 长度（位），低字节在前
    const bitLen = total * 8;
    const lenView = new DataView(tail.buffer);
    // 低32位
    lenView.setUint32(56, bitLen >>> 0, true);
    lenView.setUint32(60, Math.floor(bitLen / 0x100000000) >>> 0, true);
    const k = new Uint32Array(tail.buffer.slice(0));
    md5_cycle(ctx.state, k);
    // 输出 hex
    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    outView.setUint32(0, ctx.state[0] >>> 0, true);
    outView.setUint32(4, ctx.state[1] >>> 0, true);
    outView.setUint32(8, ctx.state[2] >>> 0, true);
    outView.setUint32(12, ctx.state[3] >>> 0, true);
    return Array.from(out).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // 计算 MD5（分块流式，避免一次性加载大文件）
  async function computeMD5(file, onProgress){
    const ctx = md5_create();
    const chunkSize = 4 * 1024 * 1024; // 4MB
    const totalChunks = Math.ceil(file.size / chunkSize);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const slice = file.slice(start, end);
      const buf = await slice.arrayBuffer();
      md5_update(ctx, new Uint8Array(buf));
      if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
      // 让出事件循环，避免阻塞 UI
      await new Promise(r => setTimeout(r, 0));
    }
    return md5_final(ctx);
  }

  // 计算 SHA 哈希（Web Crypto API）
  async function computeSHA(file, algo, onProgress){
    const chunkSize = 4 * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / chunkSize);
    // 一次性读取（Web Crypto 不支持流式增量哈希）
    // 对大文件先报告进度
    if (file.size <= 16 * 1024 * 1024) {
      const buf = await file.arrayBuffer();
      const hashBuffer = await crypto.subtle.digest(algo, buf);
      if (onProgress) onProgress(100);
      return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // 大文件：分块读取以更新进度，但最终需合并计算
    const chunks = [];
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const buf = await file.slice(start, end).arrayBuffer();
      chunks.push(buf);
      if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 50));
      await new Promise(r => setTimeout(r, 0));
    }
    const total = new Uint8Array(file.size);
    let pos = 0;
    for (const c of chunks) {
      total.set(new Uint8Array(c), pos);
      pos += c.byteLength;
    }
    const hashBuffer = await crypto.subtle.digest(algo, total);
    if (onProgress) onProgress(100);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function computeHash(file, algo, displayId){
    try {
      let hex;
      if (algo === 'MD5') {
        hex = await computeMD5(file, (pct) => {
          progressFill.style.width = pct + '%';
          progressText.textContent = pct + '%';
        });
      } else {
        hex = await computeSHA(file, algo, (pct) => {
          progressFill.style.width = pct + '%';
          progressText.textContent = pct + '%';
        });
      }
      document.getElementById(displayId).value = hex;
    } catch(e) {
      document.getElementById(displayId).value = '计算失败: ' + e.message;
    }
  }

  async function processFile(file){
    info.style.display='block';
    results.style.display='block';
    progressEl.style.display='block';
    progressFill.style.width='0%';
    progressText.textContent='0%';
    document.getElementById('fh-filename').textContent='📄 '+file.name;
    document.getElementById('fh-filesize').textContent=(file.size/1024/1024).toFixed(2)+' MB';
    document.getElementById('fh-md5').value='计算中...';
    document.getElementById('fh-sha1').value='计算中...';
    document.getElementById('fh-sha256').value='计算中...';
    document.getElementById('fh-sha512').value='计算中...';

    // 顺序计算各算法，避免一次性占用过多内存
    const algos = [
      { algo: 'MD5', id: 'fh-md5' },
      { algo: 'SHA-1', id: 'fh-sha1' },
      { algo: 'SHA-256', id: 'fh-sha256' },
      { algo: 'SHA-512', id: 'fh-sha512' }
    ];
    for (const a of algos) {
      await computeHash(file, a.algo, a.id);
    }
    progressText.textContent = '100%';
    // 延迟隐藏进度条
    setTimeout(() => { progressEl.style.display = 'none'; }, 1500);
  }

  dropzone.addEventListener('click',()=>fileInput.click());
  dropzone.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();dropzone.classList.add('dragover');});
  dropzone.addEventListener('dragleave',()=>dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop',e=>{
    e.preventDefault();e.stopPropagation();
    dropzone.classList.remove('dragover');
    const file=e.dataTransfer.files[0];
    if(file)processFile(file);
  });
  fileInput.addEventListener('change',e=>{
    const file=e.target.files[0];
    if(file)processFile(file);
  });

  document.querySelectorAll('[data-copy]').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const val=document.getElementById(btn.dataset.copy)?.value;
      if(val)try{await navigator.clipboard.writeText(val);btn.textContent='✅';setTimeout(()=>btn.textContent='📋',1500);}catch(e){}
    });
  });

  window.addEventListener('message',e=>{
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if(!e.data||e.source!==window.parent)return;
    if(e.data&&e.data.action==='setTheme'&&e.data.data)
      document.documentElement.setAttribute('data-theme',e.data.data.theme);
  });
});
