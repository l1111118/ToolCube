document.addEventListener('DOMContentLoaded',()=>{
  const list=document.getElementById('le-list');
  const stats=document.getElementById('le-stats');
  const searchInput=document.getElementById('le-search');
  let allLinks=[];
  let currentFilter=null;
  let deduplicatedLinks=[];
  let showDedup=false;
  let searchQuery='';

  function escapeAttr(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  function extract(){
    stats.textContent='⏳ 正在提取...';
    list.innerHTML='';
    currentFilter=null;
    window.parent.postMessage({action:'extractLinks',data:{}},'*');
    // 10秒超时
    if(extract._timer) clearTimeout(extract._timer);
    extract._timer=setTimeout(()=>{
      if(stats.textContent.includes('提取'))stats.textContent='⚠️ 提取超时，请重试';
    },10000);
  }

  // 链接分类
  function classifyLink(href){
    if(!href)return'other';
    if(href.startsWith('mailto:'))return'mail';
    if(href.startsWith('tel:'))return'phone';
    if(href.startsWith('#')||href.startsWith('javascript:'))return'anchor';
    try{
      const u=new URL(href,location.href);
      if(u.hostname===location.hostname)return'internal';
      return'external';
    }catch(e){return'other';}
  }

  // 去重
  function deduplicate(links){
    const seen=new Set();
    return links.filter(l=>{
      const key=l.href||'';
      if(seen.has(key))return false;
      seen.add(key);
      return true;
    });
  }

  function render(filter){
    currentFilter=filter||null;
    let links=showDedup?deduplicatedLinks:allLinks;
    if(filter==='ext')links=links.filter(l=>l.type==='external');
    else if(filter==='int')links=links.filter(l=>l.type==='internal');
    else if(filter==='anchor')links=links.filter(l=>classifyLink(l.href)==='anchor');
    else if(filter==='mail')links=links.filter(l=>classifyLink(l.href)==='mail');
    else if(filter==='phone')links=links.filter(l=>classifyLink(l.href)==='phone');
    else if(filter==='image')links=links.filter(l=>l.isImage);
    // 应用搜索过滤
    if(searchQuery){
      const q=searchQuery.toLowerCase();
      links=links.filter(l=>(l.href||'').toLowerCase().includes(q)||(l.text||'').toLowerCase().includes(q));
    }

    const intCount=allLinks.filter(l=>l.type==='internal').length;
    const extCount=allLinks.filter(l=>l.type==='external').length;
    const anchorCount=allLinks.filter(l=>classifyLink(l.href)==='anchor').length;
    const mailCount=allLinks.filter(l=>classifyLink(l.href)==='mail').length;
    const imgCount=allLinks.filter(l=>l.isImage).length;
    const dupCount=allLinks.length-deduplicatedLinks.length;

    stats.innerHTML=`共 <b>${links.length}</b> 个链接 (总计 ${allLinks.length}${dupCount>0?' · 重复 '+dupCount:''}) · 内部 ${intCount} · 外部 ${extCount} · 锚点 ${anchorCount} · 邮件 ${mailCount} · 图片 ${imgCount}${searchQuery?' · 搜索"'+escapeAttr(searchQuery)+'"':''}`;

    if(links.length===0){list.innerHTML='<div class="le-empty">无匹配链接</div>';return;}
    list.innerHTML=links.map(l=>{
      const linkType=classifyLink(l.href);
      const typeIcon=linkType==='internal'?'🏠':linkType==='external'?'🌐':linkType==='anchor'?'🔗':linkType==='mail'?'📧':linkType==='phone'?'📞':'📦';
      const imgBadge=l.isImage?'<span class="le-img-badge">🖼️</span>':'';
      // 状态检测现在基于真实 HTTP 状态码（经后台代理获取），错误链接会显示具体状态码
      const statusIcon=l.status==='ok'
        ? (l.statusCode?`<span class="le-code le-code--ok">${l.statusCode}</span>`:'✅')
        : l.status==='error'
          ? `<span class="le-code le-code--error">${l.statusCode||'ERR'}</span>`
          : l.status==='checking'?'⏳':'';
      return`
      <div class="le-item" data-href="${escapeAttr(l.href)}">
        <span class="le-type ${l.type}">${typeIcon}</span>
        <div class="le-info">
          <a class="le-href" href="${escapeAttr(l.href)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(l.href)}">${escapeAttr(l.text||l.href)}</a>
          <span class="le-url">${escapeAttr(l.href)} ${imgBadge} ${statusIcon}</span>
        </div>
        <button class="btn btn--secondary btn--sm le-copy" data-href="${escapeAttr(l.href)}">📋</button>
      </div>
    `}).join('');

    list.querySelectorAll('.le-copy').forEach(b=>{
      b.addEventListener('click',async(e)=>{
        e.stopPropagation();
        try{await navigator.clipboard.writeText(b.dataset.href);b.textContent='✅';setTimeout(()=>b.textContent='📋',1500);}catch(e){}
      });
    });
  }

  document.getElementById('btn-extract').addEventListener('click',extract);
  document.getElementById('btn-filter-all').addEventListener('click',()=>render());
  document.getElementById('btn-filter-ext').addEventListener('click',()=>render('ext'));
  document.getElementById('btn-filter-int').addEventListener('click',()=>render('int'));
  // 新增分类过滤按钮
  const btnFilterAnchor=document.getElementById('btn-filter-anchor');
  if(btnFilterAnchor)btnFilterAnchor.addEventListener('click',()=>render('anchor'));
  const btnFilterMail=document.getElementById('btn-filter-mail');
  if(btnFilterMail)btnFilterMail.addEventListener('click',()=>render('mail'));
  const btnFilterImage=document.getElementById('btn-filter-image');
  if(btnFilterImage)btnFilterImage.addEventListener('click',()=>render('image'));
  // 搜索框过滤
  if(searchInput){
    searchInput.addEventListener('input',()=>{
      searchQuery=searchInput.value.trim();
      render(currentFilter);
    });
  }

  // 去重切换
  const btnDedup=document.getElementById('btn-dedup');
  if(btnDedup)btnDedup.addEventListener('click',()=>{
    showDedup=!showDedup;
    btnDedup.textContent=showDedup?'📋 显示全部':'🔄 去重显示';
    render(currentFilter);
  });

  // 导出按钮 - CSV/TXT
  const btnExportCsv=document.getElementById('btn-export-csv');
  if(btnExportCsv)btnExportCsv.addEventListener('click',()=>{
    const links=showDedup?deduplicatedLinks:allLinks;
    const csv='文本,链接,类型,分类\n'+links.map(l=>'"'+(l.text||'').replace(/"/g,'""')+'","'+l.href.replace(/"/g,'""')+'","'+(l.type||'')+'","'+classifyLink(l.href)+'"').join('\n');
    downloadFile(csv,'links-export.csv','text/csv');
  });

  const btnExport=document.getElementById('btn-export');
  if(btnExport)btnExport.addEventListener('click',async()=>{
    const links=showDedup?deduplicatedLinks:allLinks;
    try{await navigator.clipboard.writeText(links.map(l=>l.href).join('\n'));btnExport.textContent='✅ 已复制';setTimeout(()=>btnExport.textContent='📋 复制全部',1500);}catch(e){}
  });

  function downloadFile(content,filename,mime){
    const blob=new Blob(['\ufeff'+content],{type:mime+';charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
  }

  // 链接状态检测（异步检测可达性）
  let statusCheckQueue=[];
  let isChecking=false;
  function checkLinkStatus(links){
    statusCheckQueue=links.filter(l=>l.type==='external'&&l.href&&l.href.startsWith('http'));
    isChecking=true;
    processNextCheck();
  }
  function processNextCheck(){
    if(!statusCheckQueue.length||!isChecking){isChecking=false;return;}
    const link=statusCheckQueue.shift();
    // 使用head请求检测可达性（通过background）
    window.parent.postMessage({action:'checkLinkStatus',data:{url:link.href}},'*');
    setTimeout(processNextCheck,200); // 限速
  }

  window.addEventListener('message',e=>{
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if(!e.data||e.source!==window.parent)return;
    if(e.data&&e.data.action==='linkList'&&e.data.data){
      allLinks=e.data.data.links||[];
      // 标记图片链接
      allLinks.forEach(l=>{
        l.isImage=/\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(l.href||'');
        l.type=l.type||(classifyLink(l.href)==='internal'?'internal':'external');
        l.status=l.status||'';
      });
      deduplicatedLinks=deduplicate(allLinks);
      render(currentFilter);
      // 开始异步检测链接状态
      checkLinkStatus(allLinks);
    }
    if(e.data&&e.data.action==='linkStatusResult'&&e.data.data){
      const url=e.data.data.url;
      const status=e.data.data.status; // 'ok' | 'error'
      const code=typeof e.data.data.code==='number'?e.data.data.code:0;
      allLinks.forEach(l=>{if(l.href===url){l.status=status;l.statusCode=code;}});
      deduplicatedLinks.forEach(l=>{if(l.href===url){l.status=status;l.statusCode=code;}});
      render(currentFilter);
    }
    if(e.data&&e.data.action==='setTheme'&&e.data.data)
      document.documentElement.setAttribute('data-theme',e.data.data.theme);
  });

  setTimeout(extract,300);
});
