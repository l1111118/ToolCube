document.addEventListener('DOMContentLoaded',()=>{
  const stats=document.getElementById('ce-stats'),colorsEl=document.getElementById('ce-colors');
  let colors=[];
  let cssVarColors=[];
  let mergeSimilar=false; // 是否合并相似色

  function hexToRgb(hex){
    const m=hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if(!m)return null;
    return{r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16),str:`rgb(${parseInt(m[1],16)}, ${parseInt(m[2],16)}, ${parseInt(m[3],16)})`};
  }

  function rgbToHsl(r,g,b){
    r/=255;g/=255;b/=255;
    const max=Math.max(r,g,b),min=Math.min(r,g,b);
    let h,s,l=(max+min)/2;
    if(max===min){h=s=0;}else{
      const d=max-min;
      s=l>0.5?d/(2-max-min):d/(max+min);
      switch(max){case r:h=((g-b)/d+(g<b?6:0))/6;break;case g:h=((b-r)/d+2)/6;break;case b:h=((r-g)/d+4)/6;break;}
    }
    return{h:Math.round(h*360),s:Math.round(s*100),l:Math.round(l*100),str:`hsl(${Math.round(h*360)}, ${Math.round(s*100)}%, ${Math.round(l*100)}%)`};
  }

  // WCAG对比度计算
  function luminance(r,g,b){
    const[a,bn,c]=[r,g,b].map(v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
    return 0.2126*a+0.7152*bn+0.0722*c;
  }
  function contrastRatio(rgb1,rgb2){
    const l1=luminance(rgb1.r,rgb1.g,rgb1.b);
    const l2=luminance(rgb2.r,rgb2.g,rgb2.b);
    const lighter=Math.max(l1,l2),darker=Math.min(l1,l2);
    return((lighter+0.05)/(darker+0.05)).toFixed(2);
  }

  // 生成互补色/类似色调色板
  function generatePalette(hsl){
    const palettes=[];
    // 互补色
    palettes.push({name:'互补色',colors:[
      hsl.str,
      `hsl(${(hsl.h+180)%360}, ${hsl.s}%, ${hsl.l}%)`
    ]});
    // 类似色
    palettes.push({name:'类似色',colors:[
      `hsl(${(hsl.h-30+360)%360}, ${hsl.s}%, ${hsl.l}%)`,
      hsl.str,
      `hsl(${(hsl.h+30)%360}, ${hsl.s}%, ${hsl.l}%)`
    ]});
    // 三角色
    palettes.push({name:'三角色',colors:[
      hsl.str,
      `hsl(${(hsl.h+120)%360}, ${hsl.s}%, ${hsl.l}%)`,
      `hsl(${(hsl.h+240)%360}, ${hsl.s}%, ${hsl.l}%)`
    ]});
    // 明暗变化
    palettes.push({name:'明暗变化',colors:[
      `hsl(${hsl.h}, ${hsl.s}%, ${Math.max(10,hsl.l-30)}%)`,
      `hsl(${hsl.h}, ${hsl.s}%, ${Math.max(10,hsl.l-15)}%)`,
      hsl.str,
      `hsl(${hsl.h}, ${hsl.s}%, ${Math.min(90,hsl.l+15)}%)`,
      `hsl(${hsl.h}, ${hsl.s}%, ${Math.min(90,hsl.l+30)}%)`
    ]});
    return palettes;
  }

  function extract(){
    stats.textContent='⏳ 提取中...';
    window.parent.postMessage({action:'extractColors',data:{}},'*');
    // 10秒超时
    if(extract._timer) clearTimeout(extract._timer);
    extract._timer=setTimeout(()=>{
      if(stats.textContent.includes('提取'))stats.textContent='⚠️ 提取超时，请重试';
    },10000);
  }

  // 计算两个颜色之间的距离（RGB空间）
  function colorDistance(c1,c2){
    const r1=hexToRgb(c1),r2=hexToRgb(c2);
    if(!r1||!r2)return 999;
    return Math.sqrt(Math.pow(r1.r-r2.r,2)+Math.pow(r1.g-r2.g,2)+Math.pow(r1.b-r2.b,2));
  }

  // 合并相似颜色（距离小于阈值的颜色合并，保留使用次数最多的）
  function mergeSimilarColors(colorList,threshold){
    threshold=threshold||30;
    if(!colorList||!colorList.length)return[];
    const sorted=[...colorList].sort((a,b)=>(b.count||1)-(a.count||1));
    const merged=[];
    sorted.forEach(c=>{
      const similar=merged.find(m=>colorDistance(m.color,c.color)<threshold);
      if(similar){
        // 合并：累加使用次数
        similar.count=(similar.count||1)+(c.count||1);
      }else{
        merged.push({...c});
      }
    });
    return merged;
  }

  // 导出为SCSS格式
  function exportSCSS(){
    let list=mergeSimilar?mergeSimilarColors(colors):colors;
    // 按使用频率排序
    list=[...list].sort((a,b)=>(b.count||1)-(a.count||1));
    const bg=list.filter(c=>c.type==='bg');
    const text=list.filter(c=>c.type==='text');
    const border=list.filter(c=>c.type==='border');
    const other=list.filter(c=>!['bg','text','border'].includes(c.type));
    let scss='// ===== 网页配色方案 (由本扩展生成) =====\n\n';
    if(bg.length){scss+='// 背景色\n';bg.forEach((c,i)=>scss+=`$color-bg-${i+1}: ${c.color}; // ×${c.count||1}\n`);scss+='\n';}
    if(text.length){scss+='// 文字色\n';text.forEach((c,i)=>scss+=`$color-text-${i+1}: ${c.color}; // ×${c.count||1}\n`);scss+='\n';}
    if(border.length){scss+='// 边框色\n';border.forEach((c,i)=>scss+=`$color-border-${i+1}: ${c.color}; // ×${c.count||1}\n`);scss+='\n';}
    if(other.length){scss+='// 其他\n';other.forEach((c,i)=>scss+=`$color-other-${i+1}: ${c.color}; // ×${c.count||1}\n`);}
    downloadFile(scss,'_colors.scss','text/plain');
  }

  // 导出为CSS变量格式
  function exportCSSVars(){
    let list=mergeSimilar?mergeSimilarColors(colors):colors;
    list=[...list].sort((a,b)=>(b.count||1)-(a.count||1));
    const bg=list.filter(c=>c.type==='bg');
    const text=list.filter(c=>c.type==='text');
    const border=list.filter(c=>c.type==='border');
    const other=list.filter(c=>!['bg','text','border'].includes(c.type));
    let css=':root {\n';
    if(bg.length){css+='  /* 背景色 */\n';bg.forEach((c,i)=>css+=`  --color-bg-${i+1}: ${c.color}; /* ×${c.count||1} */\n`);css+='\n';}
    if(text.length){css+='  /* 文字色 */\n';text.forEach((c,i)=>css+=`  --color-text-${i+1}: ${c.color}; /* ×${c.count||1} */\n`);css+='\n';}
    if(border.length){css+='  /* 边框色 */\n';border.forEach((c,i)=>css+=`  --color-border-${i+1}: ${c.color}; /* ×${c.count||1} */\n`);css+='\n';}
    if(other.length){css+='  /* 其他 */\n';other.forEach((c,i)=>css+=`  --color-other-${i+1}: ${c.color}; /* ×${c.count||1} */\n`);}
    css+='}\n';
    downloadFile(css,'_colors.css','text/css');
  }

  function downloadFile(content,filename,mime){
    const blob=new Blob([content],{type:mime+';charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  }

  let selectedColor=null;
  function render(){
    if(colors.length===0&&cssVarColors.length===0){colorsEl.innerHTML='<div class="ce-empty">未提取到颜色</div>';return;}
    // 根据开关决定是否合并相似色
    const displayColors=mergeSimilar?mergeSimilarColors(colors):colors;
    const bg=[],text=[],border=[],other=[];
    displayColors.forEach(c=>{if(c.type==='bg')bg.push(c);else if(c.type==='text')text.push(c);else if(c.type==='border')border.push(c);else other.push(c);});
    // 统计总使用次数
    const totalUsage=displayColors.reduce((s,c)=>s+(c.count||1),0);
    const mergeTag=mergeSimilar?'(已合并)':'';
    stats.textContent=`共 ${displayColors.length} 种颜色${mergeTag} · 背景${bg.length} · 文字${text.length} · 边框${border.length} · 总使用${totalUsage}次`;

    function renderGroup(title,items){
      if(!items.length)return'';
      // 按使用频率排序
      items.sort((a,b)=>(b.count||1)-(a.count||1));
      return`<div class="ce-group"><div class="ce-group-title">${title} (${items.length})</div><div class="ce-group-grid">${items.map(c=>{
        const rgb=hexToRgb(c.color);
        const hsl=rgb?rgbToHsl(rgb.r,rgb.g,rgb.b):null;
        // 对比度检测（与白色/黑色背景）
        let contrastInfo='';
        if(rgb&&c.type==='text'){
          const ratioW=contrastRatio(rgb,{r:255,g:255,b:255});
          const ratioB=contrastRatio(rgb,{r:0,g:0,b:0});
          const bestRatio=parseFloat(ratioW)>parseFloat(ratioB)?ratioW:ratioB;
          const pass=parseFloat(bestRatio)>=4.5;
          contrastInfo=`<span class="ce-contrast ${pass?'pass':'fail'}" title="对比度 ${bestRatio}:1 ${pass?'✅通过':'❌未通过'}">${bestRatio}:1</span>`;
        }
        const freq=Math.round((c.count||1)/totalUsage*100);
        return`
        <div class="ce-color-item" data-color="${c.color}" data-type="${c.type||''}" title="点击查看详情/复制 ${c.color}${rgb?' / '+rgb.str:''}${hsl?' / '+hsl.str:''}">
          <div class="ce-color-swatch" style="background:${c.color}"></div>
          <div class="ce-color-info">
            <span class="ce-color-hex">${c.color}</span>
            ${rgb?'<span class="ce-color-rgb">'+rgb.str+'</span>':''}
            ${hsl?'<span class="ce-color-hsl">'+hsl.str+'</span>':''}
            <span class="ce-color-count">×${c.count||1} (${freq}%)</span>
            ${contrastInfo}
          </div>
        </div>`;
      }).join('')}</div></div>`;
    }

    // CSS变量颜色组
    let cssVarHtml='';
    if(cssVarColors.length>0){
      cssVarHtml=`<div class="ce-group"><div class="ce-group-title">🎨 CSS变量 (${cssVarColors.length})</div><div class="ce-group-grid">${cssVarColors.map(v=>{
        return`<div class="ce-color-item" data-color="${v.value}" title="变量: ${v.name}">
          <div class="ce-color-swatch" style="background:${v.value}"></div>
          <div class="ce-color-info"><span class="ce-color-hex">${v.name}</span><span class="ce-color-rgb">${v.value}</span></div>
        </div>`;
      }).join('')}</div></div>`;
    }

    colorsEl.innerHTML=renderGroup('🖼️ 背景色',bg)+renderGroup('📝 文字色',text)+renderGroup('📏 边框色',border)+renderGroup('📦 其他',other)+cssVarHtml;
    colorsEl.querySelectorAll('.ce-color-item').forEach(item=>{
      item.addEventListener('click',async()=>{
        const color=item.dataset.color;
        selectedColor=color;
        const rgb=hexToRgb(color);
        const hsl=rgb?rgbToHsl(rgb.r,rgb.g,rgb.b):null;
        // 构建详情/调色板弹窗
        let detail=`<div class="ce-detail-panel"><div class="ce-detail-header"><span>颜色详情</span><button class="ce-detail-close">✕</button></div>`;
        detail+=`<div class="ce-detail-body">`;
        detail+=`<div class="ce-detail-swatch" style="background:${color};width:60px;height:60px;border-radius:8px;border:1px solid var(--tt-border)"></div>`;
        detail+=`<div class="ce-detail-formats"><div>HEX: <b>${color}</b></div>`;
        if(rgb)detail+=`<div>RGB: <b>${rgb.str}</b></div>`;
        if(hsl)detail+=`<div>HSL: <b>${hsl.str}</b></div>`;
        if(rgb){
          const ratioW=contrastRatio(rgb,{r:255,g:255,b:255});
          const ratioB=contrastRatio(rgb,{r:0,g:0,b:0});
          detail+=`<div>白色对比度: <b>${ratioW}:1</b> ${parseFloat(ratioW)>=4.5?'✅':'❌'}</div>`;
          detail+=`<div>黑色对比度: <b>${ratioB}:1</b> ${parseFloat(ratioB)>=4.5?'✅':'❌'}</div>`;
        }
        detail+=`</div>`;
        // 调色板
        if(hsl){
          const palettes=generatePalette(hsl);
          palettes.forEach(p=>{
            detail+=`<div class="ce-palette"><div class="ce-palette-name">${p.name}</div><div class="ce-palette-colors">${p.colors.map(c=>`<div class="ce-palette-swatch" style="background:${c}" title="${c}"></div>`).join('')}</div></div>`;
          });
        }
        detail+=`</div></div>`;
        // 显示/替换详情面板
        let existing=colorsEl.querySelector('.ce-detail-panel');
        if(existing)existing.remove();
        colorsEl.insertAdjacentHTML('beforeend',detail);
        const panel=colorsEl.querySelector('.ce-detail-panel');
        panel.querySelector('.ce-detail-close').addEventListener('click',()=>panel.remove());
        // 点击复制颜色值
        try{await navigator.clipboard.writeText(color);}catch(e){}
        item.style.outline='2px solid var(--toolbox-primary,#5b7fff)';
        setTimeout(()=>{item.style.outline='';},600);
      });
    });
  }

  document.getElementById('btn-extract').addEventListener('click',extract);
  document.getElementById('btn-copy-all').addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(colors.map(c=>c.color).join('\n'));
    document.getElementById('btn-copy-all').textContent='✅ 已复制';setTimeout(()=>document.getElementById('btn-copy-all').textContent='📋 复制全部',1500);
    }catch(e){}
  });

  // 导出SCSS按钮
  document.getElementById('btn-export-scss').addEventListener('click',()=>{
    if(!colors.length){stats.textContent='⚠️ 请先提取颜色';return;}
    exportSCSS();
    const btn=document.getElementById('btn-export-scss');
    const old=btn.textContent;btn.textContent='✅ 已导出';
    setTimeout(()=>btn.textContent=old,1500);
  });

  // 导出CSS变量按钮
  document.getElementById('btn-export-css').addEventListener('click',()=>{
    if(!colors.length){stats.textContent='⚠️ 请先提取颜色';return;}
    exportCSSVars();
    const btn=document.getElementById('btn-export-css');
    const old=btn.textContent;btn.textContent='✅ 已导出';
    setTimeout(()=>btn.textContent=old,1500);
  });

  // 合并相似色按钮（切换开关状态并重新渲染）
  document.getElementById('btn-merge-similar').addEventListener('click',()=>{
    if(!colors.length){stats.textContent='⚠️ 请先提取颜色';return;}
    mergeSimilar=!mergeSimilar;
    const btn=document.getElementById('btn-merge-similar');
    if(mergeSimilar){
      btn.textContent='🔀 已开启合并';
      btn.classList.add('btn--primary');
      btn.classList.remove('btn--secondary');
    }else{
      btn.textContent='🔀 合并相似色';
      btn.classList.add('btn--secondary');
      btn.classList.remove('btn--primary');
    }
    render();
  });

  window.addEventListener('message',e=>{
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if(!e.data||e.source!==window.parent)return;
    if(e.data&&e.data.action==='setTheme'&&e.data.data)document.documentElement.setAttribute('data-theme',e.data.data.theme);
    if(e.data&&e.data.action==='colorList'&&e.data.data){
      colors=e.data.data.colors||[];
      cssVarColors=e.data.data.cssVars||[];
      render();
    }
  });

  setTimeout(extract,300);
});
