document.addEventListener('DOMContentLoaded',()=>{
  const code=document.getElementById('hp-code'),preview=document.getElementById('hp-preview');
  let consoleEl=document.getElementById('hp-console');

  // 创建控制台面板（如不存在）
  if(!consoleEl){
    const previewPanel=preview.parentElement;
    const consoleDiv=document.createElement('div');
    consoleDiv.className='hp-console';
    consoleDiv.id='hp-console';
    consoleDiv.innerHTML='<div class="hp-console-title"><span>🖥 控制台</span><button class="hp-console-clear" id="btn-console-clear">清空</button></div><div class="hp-console-log" id="hp-console-log"></div>';
    previewPanel.appendChild(consoleDiv);
    consoleEl=consoleDiv;
    document.getElementById('btn-console-clear').addEventListener('click',()=>{
      document.getElementById('hp-console-log').innerHTML='';
    });
  }

  function run(){
    const html=code.value;
    // 注入控制台捕获脚本
    const consoleScript=`<script>(function(){
      var _l=console.log,_e=console.error,_w=console.warn,_i=console.info;
      function _s(type,args){try{var msg=Array.prototype.slice.call(args).map(function(a){try{return typeof a==='object'?JSON.stringify(a):String(a)}catch(e){return String(a)}}).join(' ');
      window.parent.postMessage({action:'__hpConsole',data:{type:type,msg:msg}},'*');}catch(e){}}
      console.log=function(){_s('log',arguments);_l.apply(console,arguments);};
      console.error=function(){_s('error',arguments);_e.apply(console,arguments);};
      console.warn=function(){_s('warn',arguments);_w.apply(console,arguments);};
      console.info=function(){_s('info',arguments);_i.apply(console,arguments);};
      window.onerror=function(msg,url,line){_s('error',[msg+' (line '+line+')']);};
    })();<\/script>`;
    // 在 <head> 或开头注入控制台脚本
    let finalHtml=html;
    if(finalHtml.includes('<head>')){
      finalHtml=finalHtml.replace('<head>','<head>'+consoleScript);
    }else if(finalHtml.includes('<html>')){
      finalHtml=finalHtml.replace('<html>','<html><head>'+consoleScript+'</head>');
    }else{
      finalHtml=consoleScript+finalHtml;
    }
    preview.srcdoc=finalHtml;
  }

  // ── 模板库 ──
  // 「加载模板」此前只是重新运行当前代码（run()），不加载任何模板，属于名不副实。
  // 这里提供一组可直接使用的基础模板，选择后填入编辑器并立即预览。
  const TEMPLATES = {
    card: `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f0f4ff; font-family: sans-serif; }
  .card { background: #5b7fff; color: #fff; padding: 32px; border-radius: 12px; text-align: center; box-shadow: 0 8px 24px rgba(91,127,255,.3); }
  .card h1 { margin: 0 0 8px; }
  .btn { background: #fff; color: #5b7fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; margin-top: 12px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Hello World</h1>
    <p>这是一个居中卡片模板</p>
    <button class="btn" onclick="this.textContent='已点击!'">点击我</button>
  </div>
</body>
</html>`,
    form: `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f7f7f7; font-family: sans-serif; }
  form { background: #fff; padding: 28px; border-radius: 10px; width: 300px; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
  h2 { margin: 0 0 16px; }
  label { display: block; font-size: 13px; color: #555; margin: 10px 0 4px; }
  input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
  button { width: 100%; padding: 10px; margin-top: 16px; background: #4a6cf7; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
</style>
</head>
<body>
<form onsubmit="event.preventDefault(); alert('已提交');">
  <h2>登录</h2>
  <label>邮箱</label><input type="email" placeholder="you@example.com" required>
  <label>密码</label><input type="password" placeholder="••••••••" required>
  <button type="submit">登录</button>
</form>
</body>
</html>`,
    grid: `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; padding: 24px; background: #fafafa; font-family: sans-serif; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
  .item { background: #fff; border-radius: 10px; padding: 16px; box-shadow: 0 1px 6px rgba(0,0,0,.06); }
  .item .thumb { height: 80px; border-radius: 6px; background: linear-gradient(135deg,#667eea,#764ba2); margin-bottom: 10px; }
  h3 { margin: 0 0 6px; font-size: 15px; }
  p { margin: 0; font-size: 13px; color: #666; }
</style>
</head>
<body>
  <h2>响应式卡片网格</h2>
  <div class="grid">
    <div class="item"><div class="thumb"></div><h3>卡片 1</h3><p>自适应列数</p></div>
    <div class="item"><div class="thumb"></div><h3>卡片 2</h3><p>minmax 布局</p></div>
    <div class="item"><div class="thumb"></div><h3>卡片 3</h3><p>无需媒体查询</p></div>
    <div class="item"><div class="thumb"></div><h3>卡片 4</h3><p>auto-fill</p></div>
  </div>
</body>
</html>`,
    flex: `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; padding: 24px; font-family: sans-serif; background: #fff; }
  .bar { display: flex; gap: 12px; align-items: center; padding: 12px; background: #eef2ff; border-radius: 8px; }
  .bar .spacer { flex: 1; }
  .bar button { padding: 8px 14px; border: none; border-radius: 6px; background: #4a6cf7; color: #fff; cursor: pointer; }
  .bar .ghost { background: #fff; color: #4a6cf7; border: 1px solid #4a6cf7; }
</style>
</head>
<body>
  <h3>Flex 工具栏</h3>
  <div class="bar">
    <button>主操作</button>
    <button class="ghost">次操作</button>
    <span class="spacer"></span>
    <button class="ghost">右侧</button>
  </div>
</body>
</html>`,
    animation: `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #1a1a2e; font-family: sans-serif; }
  .box { width: 120px; height: 120px; background: #e94560; border-radius: 16px; animation: bounce 1.2s ease-in-out infinite; }
  @keyframes bounce {
    0%, 100% { transform: translateY(0) scale(1); }
    50% { transform: translateY(-40px) scale(1.1); }
  }
  p { position: absolute; bottom: 30px; color: #888; font-size: 13px; }
</style>
</head>
<body>
  <div class="box"></div>
  <p>CSS 关键帧动画</p>
</body>
</html>`,
    table: `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { margin: 0; padding: 24px; font-family: sans-serif; }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 14px; }
  th { background: #f5f7fb; color: #333; }
  tr:hover { background: #f9fbff; }
  .ok { color: #2e7d32; font-weight: 600; }
</style>
</head>
<body>
  <h3>数据表格</h3>
  <table>
    <thead><tr><th>名称</th><th>状态</th><th>更新时间</th></tr></thead>
    <tbody>
      <tr><td>服务 A</td><td class="ok">运行中</td><td>10:24</td></tr>
      <tr><td>服务 B</td><td class="ok">运行中</td><td>10:20</td></tr>
      <tr><td>服务 C</td><td>已停止</td><td>09:58</td></tr>
    </tbody>
  </table>
</body>
</html>`
  };

  document.getElementById('btn-run').addEventListener('click',run);
  document.getElementById('btn-clear').addEventListener('click',()=>{code.value='';preview.srcdoc='';document.getElementById('hp-console-log').innerHTML='';});
  const templateSelect=document.getElementById('hp-template-select');
  if(templateSelect){
    templateSelect.addEventListener('change',()=>{
      const tpl=TEMPLATES[templateSelect.value];
      if(!tpl){templateSelect.value='';return;}
      code.value=tpl;
      run();
      templateSelect.value='';
    });
  }
  // 自动运行（防抖）
  let timer;code.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(run,600);});

  // 接收预览iframe中的控制台消息
  window.addEventListener('message',e=>{
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if(!e.data)return;
    // 控制台消息来自预览iframe
    if(e.data.action==='__hpConsole'&&e.data.data){
      const logEl=document.getElementById('hp-console-log');
      if(logEl){
        const cls='hp-console-'+e.data.data.type;
        const line=document.createElement('div');
        line.className='hp-console-line '+cls;
        line.textContent=e.data.data.msg;
        logEl.appendChild(line);
        logEl.scrollTop=logEl.scrollHeight;
      }
      return;
    }
    if(e.source!==window.parent)return;
    if(e.data&&e.data.action==='setTheme'&&e.data.data)document.documentElement.setAttribute('data-theme',e.data.data.theme);
  });

  run();
});
