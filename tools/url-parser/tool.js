document.addEventListener("DOMContentLoaded",()=>{
var I=document.getElementById("up-input"),R=document.getElementById("up-result"),
  encodeInput=document.getElementById("up-encode-input"),encodeResult=document.getElementById("up-encode-result"),
  builderArea=document.getElementById("up-builder"),qrArea=document.getElementById("up-qr"),
  securityArea=document.getElementById("up-security");

function esc(s){return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}

// === URL安全检查 ===
function checkSecurity(url,u){
  if(!securityArea) return;
  var issues=[];
  // 检查可疑参数名
  var suspiciousKeys=['redirect','redirect_to','redirect_url','return','return_url','returnurl','url','next','goto','dest','destination','to','continue','callback','cb','jsonp','file','path','page','cmd','exec','command','eval','run','q','search','s'];
  var suspiciousFound=[];
  u.searchParams.forEach(function(v,k){
    var lk=k.toLowerCase();
    if(suspiciousKeys.indexOf(lk)>-1){
      suspiciousFound.push({key:k,value:v});
    }
  });
  if(suspiciousFound.length>0){
    issues.push({level:'warn',text:'发现可能敏感的参数名',detail:suspiciousFound.map(function(s){return '<code>'+esc(s.key)+'</code>=<code>'+esc(s.value.substring(0,50))+'</code>'}).join('<br>')});
  }
  // 检查参数值中的可疑内容
  var dangerPatterns=[
    {re:/javascript:/i,text:'参数值中包含 javascript: 协议（可能XSS）'},
    {re:/<script/i,text:'参数值中包含 &lt;script&gt; 标签（可能XSS）'},
    {re:/on\w+\s*=/i,text:'参数值中包含事件处理属性（可能XSS）'},
    {re:/%3Cscript/i,text:'参数值中包含编码后的 script 标签'},
    {re:/\.\.\//,text:'参数值中包含路径穿越 ../（可能目录遍历）'},
    {re:/%2e%2e%2f/i,text:'参数值中包含编码后的路径穿越'},
    {re:/union\s+select/i,text:'参数值中包含 SQL UNION SELECT（可能SQL注入）'},
    {re:/;\s*(drop|update|insert|delete)\s/i,text:'参数值中包含SQL语句（可能SQL注入）'}
  ];
  u.searchParams.forEach(function(v,k){
    dangerPatterns.forEach(function(p){
      if(p.re.test(v)){
        issues.push({level:'danger',text:p.text+' <br>参数: <code>'+esc(k)+'</code>',detail:''});
      }
    });
  });
  // 检查协议
  if(u.protocol==='http:'){
    issues.push({level:'warn',text:'使用HTTP明文协议，建议使用HTTPS',detail:''});
  }
  // 检查凭据在URL中
  if(u.username||u.password){
    issues.push({level:'danger',text:'URL中包含用户名/密码（不安全）',detail:''});
  }
  // 检查IP地址作为主机
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)){
    issues.push({level:'warn',text:'主机使用IP地址而非域名',detail:''});
  }
  // 渲染
  if(issues.length===0){
    securityArea.innerHTML='<div class="up-sec-ok">✅ 未发现可疑参数或安全风险</div>';
  }else{
    var html='';
    issues.forEach(function(it){
      var cls=it.level==='danger'?'up-sec-danger':'up-sec-warn';
      html+='<div class="up-sec-item '+cls+'"><strong>'+(it.level==='danger'?'🚨':'⚠️')+' '+esc(it.text)+'</strong>'+(it.detail?'<div class="up-sec-detail">'+it.detail+'</div>':'')+'</div>';
    });
    securityArea.innerHTML=html;
  }
}

// === URL解析 ===
function parse(url){
  try{
    var u=new URL(url),params=[];
    u.searchParams.forEach(function(v,k){params.push([k,v])});
    var html='<table class="up-table"><tr><td>完整URL</td><td><code>'+esc(url)+"</code></td></tr><tr><td>协议</td><td><code>"+u.protocol+"</code></td></tr><tr><td>主机名</td><td><code>"+esc(u.hostname)+"</code></td></tr><tr><td>端口</td><td><code>"+(u.port||"默认")+"</code></td></tr><tr><td>路径</td><td><code>"+esc(u.pathname)+"</code></td></tr><tr><td>Hash</td><td><code>"+esc(u.hash||"-")+"</code></td></tr><tr><td>查询参数 ("+params.length+")</td><td>"+(params.length?params.map(function(p,i){
      return '<div class="param-row"><code>'+esc(p[0])+'</code> = <input class="param-edit" data-idx="'+i+'" data-key="'+esc(p[0])+'" value="'+esc(p[1])+'"><button class="param-del btn btn--sm" data-key="'+esc(p[0])+'" title="删除">✕</button></div>';
    }).join(""):"-")+"</td></tr></table>";
    html+='<div class="up-actions"><button class="btn btn--secondary btn--sm" id="btn-add-param">➕ 新增参数</button><button class="btn btn--primary btn--sm" id="btn-apply-params">✅ 重建URL</button></div>';
    R.innerHTML=html;
    // 绑定删除参数按钮
    R.querySelectorAll('.param-del').forEach(function(btn){
      btn.addEventListener('click',function(){
        var key=btn.dataset.key;
        u.searchParams.delete(key);
        I.value=u.toString();
        parse(u.toString());
      });
    });
    // 新增参数按钮
    var addBtn=document.getElementById('btn-add-param');
    if(addBtn){
      addBtn.addEventListener('click',function(){
        var key=prompt('参数名:');
        if(!key) return;
        var val=prompt('参数值:');
        if(val===null) return;
        u.searchParams.append(key,val);
        I.value=u.toString();
        parse(u.toString());
      });
    }
    // 绑定应用参数修改（重建URL）
    var applyBtn=document.getElementById('btn-apply-params');
    if(applyBtn){
      applyBtn.addEventListener('click',function(){
        var newUrl=new URL(I.value.trim());
        R.querySelectorAll('.param-edit').forEach(function(input){
          newUrl.searchParams.set(input.dataset.key,input.value);
        });
        I.value=newUrl.toString();
        parse(newUrl.toString());
      });
    }
    // 执行安全检查
    checkSecurity(url,u);
  }catch(e){
    R.innerHTML='<div class="up-empty">❌ 无效的URL: '+esc(e.message)+"</div>";
    if(securityArea) securityArea.innerHTML='<div class="up-empty">URL无效，无法检查</div>';
  }
}

// === URL编码/解码 ===
if(document.getElementById('btn-url-encode')){
  document.getElementById('btn-url-encode').addEventListener('click',function(){
    if(!encodeInput||!encodeResult) return;
    try{encodeResult.innerHTML='<div class="up-code-result"><strong>编码结果:</strong></div><textarea class="up-result-area" readonly>'+esc(encodeURIComponent(encodeInput.value))+'</textarea>'}catch(e){encodeResult.innerHTML='<div class="up-empty">编码失败</div>'}
  });
}
if(document.getElementById('btn-url-decode')){
  document.getElementById('btn-url-decode').addEventListener('click',function(){
    if(!encodeInput||!encodeResult) return;
    try{encodeResult.innerHTML='<div class="up-code-result"><strong>解码结果:</strong></div><textarea class="up-result-area" readonly>'+esc(decodeURIComponent(encodeInput.value))+'</textarea>'}catch(e){encodeResult.innerHTML='<div class="up-empty">解码失败: '+esc(e.message)+'</div>'}
  });
}

// === URL构建 ===
if(document.getElementById('btn-build-url')){
  document.getElementById('btn-build-url').addEventListener('click',function(){
    if(!builderArea) return;
    var protocol=document.getElementById('build-protocol').value;
    var host=document.getElementById('build-host').value.trim();
    var port=document.getElementById('build-port').value.trim();
    var path=document.getElementById('build-path').value.trim();
    var query=document.getElementById('build-query').value.trim();
    var hash=document.getElementById('build-hash').value.trim();
    if(!host){R.innerHTML='<div class="up-empty">❌ 请至少输入主机名</div>';return;}
    var built=protocol+'//'+host;
    if(port) built+=':'+port;
    if(path) built+=(path.startsWith('/')?'':'/')+path;
    if(query) built+='?'+query;
    if(hash) built+='#'+hash;
    I.value=built;
    parse(built);
  });
}

// === QR码生成 ===
// 使用共享的本地编码器（common/qrcode.js）在 Canvas 上绘制，不再请求第三方接口：
// 旧实现硬编码了 api.qrserver.com，且用内联 onerror 做兜底 —— 内联事件处理器会被
// 扩展页 CSP（script-src 'self'）拦截，兜底永远不会执行。
function generateQR(){
  if(!qrArea) return;
  var url=I.value.trim();
  if(!url){qrArea.innerHTML='<div class="up-empty">输入URL后生成QR码</div>';return;}
  var encoder=window.ToolCubeQR;
  if(!encoder||typeof encoder.encode!=='function'){
    qrArea.innerHTML='<div class="up-empty">二维码编码器未加载</div>';
    return;
  }
  try{
    var qr=encoder.encode(url,{correctLevel:'M'});
    var cell=Math.max(2,Math.floor(150/qr.size));
    var quiet=cell*4;
    var total=qr.size*cell+quiet*2;
    var canvas=document.createElement('canvas');
    canvas.width=total;
    canvas.height=total;
    canvas.className='qr-image';
    canvas.style.width=total+'px';
    canvas.style.height=total+'px';
    var ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,total,total);
    ctx.fillStyle='#000000';
    for(var r=0;r<qr.size;r++){
      for(var c=0;c<qr.size;c++){
        if(qr.matrix[r][c]) ctx.fillRect(quiet+c*cell,quiet+r*cell,cell,cell);
      }
    }
    qrArea.innerHTML='';
    qrArea.appendChild(canvas);
  }catch(e){
    qrArea.innerHTML='<div class="up-empty">QR码生成失败: '+esc(e.message)+'</div>';
  }
}
if(document.getElementById('btn-gen-qr')){
  document.getElementById('btn-gen-qr').addEventListener('click',generateQR);
}

// === 原有按钮 ===
document.getElementById("btn-parse").onclick=document.getElementById("btn-parse2").onclick=function(){if(I.value.trim())parse(I.value.trim())};
document.getElementById("btn-current").onclick=function(){window.parent.postMessage({action:"getCurrentUrl"},"*")};
document.getElementById("btn-copy-url").onclick=function(){if(I.value)navigator.clipboard.writeText(I.value).catch(()=>{})};
document.getElementById("btn-clear").onclick=function(){I.value="";R.innerHTML='<div class="up-empty">输入URL后点击"解析"查看详细信息</div>'};
I.onkeydown=function(e){if(e.key==="Enter")parse(I.value.trim())};
});
window.addEventListener('message',function(e){
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）
if(!e.data||e.source!==window.parent)return;if(e.data&&e.data.action==='setTheme'&&e.data.data)document.documentElement.setAttribute('data-theme',e.data.data.theme);if(e.data&&e.data.action==='pageInfo'&&e.data.data&&e.data.data.url){var I=document.getElementById("up-input");if(I){I.value=e.data.data.url;I.dispatchEvent(new Event('input'));}}});
