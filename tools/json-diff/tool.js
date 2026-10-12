document.addEventListener('DOMContentLoaded',()=>{
  const aEl=document.getElementById('jd-a'),bEl=document.getElementById('jd-b'),result=document.getElementById('jd-result');
  function escapeHtml(str){if(str==null)return'';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

  function deepDiff(a,b,path=''){
    const changes=[];
    if(typeof a!==typeof b){changes.push({path,type:'changed',old:String(a),new:String(b)});return changes;}
    if(a===null||b===null||typeof a!=='object'){if(a!==b)changes.push({path,type:'changed',old:String(a),new:String(b)});return changes;}
    const keys=new Set([...Object.keys(a||{}),...Object.keys(b||{})]);
    keys.forEach(k=>{
      const np=path?path+'.'+k:k;
      if(!(k in a))changes.push({path:np,type:'added',new:String(b[k])});
      else if(!(k in b))changes.push({path:np,type:'removed',old:String(a[k])});
      else changes.push(...deepDiff(a[k],b[k],np));
    });
    return changes;
  }

  function compare(){
    try{var ja=JSON.parse(aEl.value||'{}');}catch(e){result.innerHTML='<div class="jd-error">JSON A 解析失败: '+escapeHtml(e.message)+'</div>';return;}
    try{var jb=JSON.parse(bEl.value||'{}');}catch(e){result.innerHTML='<div class="jd-error">JSON B 解析失败: '+escapeHtml(e.message)+'</div>';return;}

    const changes=deepDiff(ja,jb);
    if(changes.length===0){result.innerHTML='<div class="jd-empty">✅ 两个JSON完全相同</div>';return;}

    const typeIcons={added:'➕',removed:'➖',changed:'🔄'};
    const typeClasses={added:'jd-added',removed:'jd-removed',changed:'jd-changed'};
    result.innerHTML=`<div class="jd-summary">找到 ${changes.length} 处差异</div>`+
      changes.map(c=>`<div class="jd-diff-row ${typeClasses[c.type]}">
        <span class="jd-diff-type">${typeIcons[c.type]||'?'}</span>
        <span class="jd-diff-path">${escapeHtml(c.path)||'(root)'}</span>
        <span class="jd-diff-old">${escapeHtml(c.old)||''}</span>
        <span class="jd-diff-arrow">→</span>
        <span class="jd-diff-new">${escapeHtml(c.new)||''}</span>
      </div>`).join('');
  }

  document.getElementById('btn-compare').addEventListener('click',compare);
  document.getElementById('btn-swap').addEventListener('click',()=>{const t=aEl.value;aEl.value=bEl.value;bEl.value=t;});
  window.addEventListener('message',e=>{
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）
if(!e.data||e.source!==window.parent)return;if(e.data&&e.data.action==='setTheme'&&e.data.data)document.documentElement.setAttribute('data-theme',e.data.data.theme);});
});
