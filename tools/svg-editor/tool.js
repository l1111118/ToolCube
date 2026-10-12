document.addEventListener('DOMContentLoaded',()=>{
const i=document.getElementById('input-area'),p=document.getElementById('svg-preview'),vb=document.getElementById('validation-bar'),vi=document.getElementById('validation-icon'),vt=document.getElementById('validation-text');
function escapeHtml(str){if(str==null)return'';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function sanitizeSvg(svg){
  // 移除脚本标签和事件处理器，防止XSS
  return svg.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,'')
            .replace(/\s(on\w+)=(["']?)[^"'>]*\2/gi,'');
}
function preview(){const svg=i.value.trim();if(!svg){p.innerHTML='<div class="placeholder">输入SVG代码</div>';return}
  const clean=sanitizeSvg(svg);
  if(clean!==svg&&vb){vb.classList.add('validation-bar--warn');}
  else if(vb){vb.classList.remove('validation-bar--warn');}
  try{p.innerHTML=clean;const err=p.querySelector('parsererror');if(err){p.innerHTML='<div class="placeholder">SVG解析错误</div>';vi.textContent='❌';vt.textContent='SVG代码无效'}else{vi.textContent='✅';vt.textContent='SVG预览正常'}}
  catch(e){p.innerHTML='<div class="placeholder">预览失败</div>';vi.textContent='❌';vt.textContent=escapeHtml(e.message)}}
document.getElementById('btn-preview').addEventListener('click',preview);
document.getElementById('btn-copy-code').addEventListener('click',()=>{navigator.clipboard.writeText(i.value).catch(()=>{})});
document.getElementById('btn-download').addEventListener('click',()=>{const b=new Blob([i.value],{type:'image/svg+xml'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='image.svg';a.click();URL.revokeObjectURL(a.href)});
document.getElementById('btn-fit').addEventListener('click',()=>{const svg=p.querySelector('svg');if(svg){svg.setAttribute('width','100%');svg.setAttribute('height','100%');svg.style.maxWidth='100%';svg.style.maxHeight='100%'}});
document.getElementById('btn-clear').addEventListener('click',()=>{i.value='';p.innerHTML='<div class="placeholder">输入SVG代码</div>'});
i.addEventListener('input',debounce(preview,500));
preview();
function debounce(f,w){let t;return function(...a){clearTimeout(t);t=setTimeout(()=>f.apply(this,a),w)}}
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
