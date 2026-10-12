document.addEventListener('DOMContentLoaded',()=>{
  const preview=document.getElementById('cs-preview');
  const code=document.getElementById('cs-code');
  const sliders={x:'cs-x',y:'cs-y',blur:'cs-blur',spread:'cs-spread',color:'cs-color',opacity:'cs-opacity',inset:'cs-inset'};

  function hexToRgba(hex,alpha){
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    return`rgba(${r},${g},${b},${alpha})`;
  }

  function update(){
    const x=parseInt(document.getElementById('cs-x').value, 10);
    const y=parseInt(document.getElementById('cs-y').value, 10);
    const blur=parseInt(document.getElementById('cs-blur').value, 10);
    const spread=parseInt(document.getElementById('cs-spread').value, 10);
    const color=document.getElementById('cs-color').value;
    const opacity=parseInt(document.getElementById('cs-opacity').value, 10)/100;
    const inset=document.getElementById('cs-inset').checked;

    document.getElementById('cs-x-val').textContent=x;
    document.getElementById('cs-y-val').textContent=y;
    document.getElementById('cs-blur-val').textContent=blur;
    document.getElementById('cs-spread-val').textContent=spread;
    document.getElementById('cs-color-val').textContent=color;
    document.getElementById('cs-opacity-val').textContent=Math.round(opacity*100)+'%';

    const rgba=hexToRgba(color,opacity);
    const shadow=`${inset?'inset ':''}${x}px ${y}px ${blur}px ${spread}px ${rgba}`;
    preview.style.boxShadow=shadow;
    code.textContent=`box-shadow: ${shadow};`;
  }

  Object.values(sliders).forEach(id=>{
    document.getElementById(id).addEventListener('input',update);
  });
  document.getElementById('cs-copy').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(code.textContent);document.getElementById('cs-copy').textContent='✅ 已复制';setTimeout(()=>document.getElementById('cs-copy').textContent='📋 复制CSS',1500);}catch(e){}
  });

  update();

  window.addEventListener('message',e=>{
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if(!e.data||e.source!==window.parent)return;
    if(e.data&&e.data.action==='setTheme'&&e.data.data)
      document.documentElement.setAttribute('data-theme',e.data.data.theme);
  });
});
