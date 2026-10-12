document.addEventListener('DOMContentLoaded',()=>{
const i=document.getElementById('input-area'),o=document.getElementById('output-area'),is=document.getElementById('input-status'),os=document.getElementById('output-status');
function set(t){
  let r='';switch(t){
    case'upper':r=i.value.toUpperCase();break;
    case'lower':r=i.value.toLowerCase();break;
    case'title':r=i.value.replace(/\w\S*/g,w=>w.charAt(0).toUpperCase()+w.substr(1).toLowerCase());break;
    case'sentence':r=i.value.toLowerCase().replace(/(^\s*\w|[.!?]\s+\w)/g,c=>c.toUpperCase());break;
    case'camel':r=i.value.toLowerCase().replace(/[^a-z0-9]+(.)/g,(_,c)=>c.toUpperCase()).replace(/^./,c=>c.toLowerCase());break;
    case'snake':r=i.value.replace(/([a-z])([A-Z])/g,'$1_$2').replace(/[\s-]+/g,'_').toLowerCase();break;
  }o.value=r;os.textContent=`${r.length} 字符`;
}
document.getElementById('btn-upper').addEventListener('click',()=>set('upper'));
document.getElementById('btn-lower').addEventListener('click',()=>set('lower'));
document.getElementById('btn-title').addEventListener('click',()=>set('title'));
document.getElementById('btn-sentence').addEventListener('click',()=>set('sentence'));
document.getElementById('btn-camel').addEventListener('click',()=>set('camel'));
document.getElementById('btn-snake').addEventListener('click',()=>set('snake'));
document.getElementById('btn-copy').addEventListener('click',()=>{if(o.value)navigator.clipboard.writeText(o.value).catch(()=>{})});
document.getElementById('btn-clear').addEventListener('click',()=>{i.value='';o.value='';is.textContent='0 字符';os.textContent='等待输入'});
i.addEventListener('input',()=>is.textContent=`${i.value.length} 字符`);
});
  // 主题切换消息监听
  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
    // 也处理 setData 消息（从 sidebar 传入参数）
    if (event.data && event.data.action === 'setData') {
      const inputArea = document.getElementById('input-area');
      if (inputArea && typeof event.data.data === 'string') {
        inputArea.value = event.data.data;
        inputArea.dispatchEvent(new Event('input'));
      }
    }
  });
