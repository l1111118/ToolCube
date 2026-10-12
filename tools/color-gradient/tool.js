document.addEventListener('DOMContentLoaded',()=>{
  const preview=document.getElementById('cg-preview'),code=document.getElementById('cg-code');
  const fromEl=document.getElementById('cg-from'),toEl=document.getElementById('cg-to');
  const stop0El=document.getElementById('cg-stop-0'),stop100El=document.getElementById('cg-stop-100');

  function update(){
    const angle=document.getElementById('cg-angle').value;
    const type=document.getElementById('cg-type').value;
    const s0=stop0El.value;
    const s50=document.getElementById('cg-stop-50').value;
    const s100=stop100El.value;
    document.getElementById('cg-angle-val').textContent=angle+'°';
    let css;
    if(type==='linear'){css=`linear-gradient(${angle}deg, ${s0} 0%, ${s50} 50%, ${s100} 100%)`;}
    else{css=`radial-gradient(circle, ${s0} 0%, ${s50} 50%, ${s100} 100%)`;}
    preview.style.background=css;
    code.textContent=`background: ${css};`;
  }

  // 「起始色 / 结束色」与「0% / 100% 色标」是同一组颜色的两种入口，
  // 做双向同步，避免出现改了起始色却毫无反应的"死控件"（原实现读取了这两个值但从未使用）。
  fromEl.addEventListener('input',()=>{stop0El.value=fromEl.value;update();});
  toEl.addEventListener('input',()=>{stop100El.value=toEl.value;update();});
  stop0El.addEventListener('input',()=>{fromEl.value=stop0El.value;update();});
  stop100El.addEventListener('input',()=>{toEl.value=stop100El.value;update();});

  document.querySelectorAll('#cg-angle,#cg-type,#cg-stop-50').forEach(e=>e.addEventListener('input',update));
  document.getElementById('btn-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(code.textContent);}catch(e){}});
  update();
  window.addEventListener('message',e=>{
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）
if(!e.data||e.source!==window.parent)return;if(e.data&&e.data.action==='setTheme'&&e.data.data)document.documentElement.setAttribute('data-theme',e.data.data.theme);});
});
