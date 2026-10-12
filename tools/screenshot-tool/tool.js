/**
 * Screenshot Tool - 网页截图（增强版）
 * 支持全页截图、可见区域、选择区域、格式选择、质量调节
 */
document.addEventListener('DOMContentLoaded',()=>{
  const preview=document.getElementById('st-preview');
  const canvas=document.getElementById('st-canvas');
  const placeholder=document.getElementById('st-placeholder');
  const wrap=document.getElementById('st-preview-wrap');
  const actions=document.getElementById('st-result-actions');
  let imageDataUrl='';
  let screenshotTimeout=null;

  // 截图设置状态
  let settings = {
    mode: 'visible',    // 'visible' | 'fullpage' | 'selection'
    format: 'png',       // 'png' | 'jpeg' | 'webp'
    quality: 92,         // 1-100 for jpeg/webp
    delay: 0             // 延迟秒数 0-10
  };

  // 延迟倒计时定时器
  let delayCountdownTimer = null;

  // 加载保存的设置
  try {
    const saved = localStorage.getItem('st_settings');
    if (saved) settings = { ...settings, ...JSON.parse(saved) };
  } catch(e) {}

  function saveSettings() {
    try { localStorage.setItem('st_settings', JSON.stringify(settings)); } catch(e) {}
  }

  function showPreview(dataUrl){
    imageDataUrl=dataUrl;
    preview.src=dataUrl;
    preview.style.display='block';
    canvas.style.display='none';
    placeholder.style.display='none';
    wrap.style.display='block';
    actions.style.display='flex';
    // 显示图片大小信息
    const info = document.getElementById('st-image-info');
    if (info) {
      const sizeKB = Math.round((dataUrl.length * 3 / 4) / 1024);
      info.textContent = `${settings.format.toUpperCase()} · ${settings.quality}% · ~${sizeKB}KB`;
    }
  }

  // 可见区域截图
  async function captureVisible(){
    try{
      if(screenshotTimeout) clearTimeout(screenshotTimeout);
      window.parent.postMessage({action:'captureScreenshot',data:{mode:'visible',format:settings.format,quality:settings.quality}},'*');
      placeholder.textContent='⏳ 正在截取可见区域...';
      wrap.style.display='block';
      preview.style.display='none';
      actions.style.display='none';
      // 10秒超时
      screenshotTimeout=setTimeout(()=>{
        if(placeholder.textContent.includes('截取')){
          placeholder.textContent='⚠️ 截图超时，请重试';
        }
      },10000);
    }catch(e){
      placeholder.textContent='❌ 截图失败: '+e.message;
    }
  }

  // 全页截图
  async function captureFullPage(){
    try{
      if(screenshotTimeout) clearTimeout(screenshotTimeout);
      window.parent.postMessage({action:'captureScreenshot',data:{mode:'fullpage',format:settings.format,quality:settings.quality}},'*');
      placeholder.textContent='⏳ 正在截取完整页面（可能需要滚动）...';
      wrap.style.display='block';
      preview.style.display='none';
      actions.style.display='none';
      screenshotTimeout=setTimeout(()=>{
        if(placeholder.textContent.includes('截取')){
          placeholder.textContent='⚠️ 全页截图超时，页面可能过大';
        }
      },15000);
    }catch(e){
      placeholder.textContent='❌ 全页截图失败: '+e.message;
    }
  }

  // 选择区域截图
  // 由宿主页面显示真实的选区浮层（content/injector.js 的 startRegionSelection），
  // 拖选完成后在宿主页面上裁剪并回传结果。
  // 旧实现把 mode 传成 'selection'，而注入脚本对 selection 与 visible 走同一条路径
  // （都截可见区域），因此"截取选中区域"实际从未让用户选择过任何区域。
  async function captureSelection(){
    try{
      if(screenshotTimeout) clearTimeout(screenshotTimeout);
      window.parent.postMessage({action:'startRegionSelection',data:{}},'*');
      placeholder.textContent='⏳ 请在页面上拖选截图区域（Esc 取消）...';
      wrap.style.display='block';
      preview.style.display='none';
      actions.style.display='none';
      screenshotTimeout=setTimeout(()=>{
        if(placeholder.textContent.includes('拖选')){
          placeholder.textContent='⚠️ 区域选择超时，请重试';
        }
      },30000);
    }catch(e){
      placeholder.textContent='❌ 区域截图失败: '+e.message;
    }
  }

  // 服务端渲染截图（用于截取非当前标签页，或需要完整页面高度的场景）
  // 走「服务端点 → 网页截图」类别，可指向自建渲染服务。
  async function captureViaServer(){
    const url=(document.getElementById('st-server-url')||{}).value||'';
    const trimmed=url.trim();
    if(!trimmed||!/^https?:\/\//i.test(trimmed)){
      placeholder.textContent='⚠️ 请输入以 http(s):// 开头的完整 URL';
      wrap.style.display='block';
      return;
    }
    placeholder.textContent='⏳ 正在请求服务端渲染...';
    wrap.style.display='block';
    preview.style.display='none';
    actions.style.display='none';
    try{
      const r=await new Promise((resolve,reject)=>{
        const id=Math.random().toString(36).slice(2);
        const handler=(e)=>{
          if(e.origin!==location.origin) return;
          if(!e.data||e.source!==window.parent) return;
          if(e.data.action==='__bgResponse'&&e.data.data&&e.data.data.__id===id){
            clearTimeout(timer);
            window.removeEventListener('message',handler);
            resolve(e.data.data.result);
          }
        };
        const timer=setTimeout(()=>{window.removeEventListener('message',handler);reject(new Error('请求超时'));},25000);
        window.addEventListener('message',handler);
        window.parent.postMessage({action:'callBackground',data:{id,action:'clientRequestUrl',data:{kind:'screenshot',params:{url:trimmed,width:1200}}}},'*');
      });
      if(!r||!r.success||!r.url){
        placeholder.textContent='❌ 无法生成截图地址: '+((r&&r.error)||'未知错误')+'\n可在「设置 → 服务端点 → 网页截图」中配置自建服务';
        return;
      }
      // 服务端返回的是可直接嵌入的图片地址，把它当作当前结果（保存/复制按钮据此工作）
      imageDataUrl=r.url;
      preview.onload=()=>{
        placeholder.textContent='';
        preview.style.display='block';
        actions.style.display='flex';
        const info=document.getElementById('st-image-info');
        if(info) info.textContent='服务端渲染 · '+(r.provider||'');
      };
      preview.onerror=()=>{placeholder.textContent='❌ 服务端截图加载失败，请检查服务地址是否可用';};
      preview.src=r.url;
    }catch(e){
      placeholder.textContent='❌ 服务端截图失败: '+e.message;
    }
  }

  // 根据当前模式截图（支持延迟）
  function doCapture(){
    if(delayCountdownTimer){clearInterval(delayCountdownTimer);delayCountdownTimer=null;}
    const delaySec=parseInt(settings.delay, 10)||0;
    if(delaySec<=0){
      runCaptureByMode();
      return;
    }
    // 延迟倒计时
    let remain=delaySec;
    placeholder.textContent='⏳ '+remain+' 秒后截图...';
    wrap.style.display='block';
    preview.style.display='none';
    actions.style.display='none';
    delayCountdownTimer=setInterval(()=>{
      remain--;
      if(remain<=0){
        clearInterval(delayCountdownTimer);
        delayCountdownTimer=null;
        runCaptureByMode();
      }else{
        placeholder.textContent='⏳ '+remain+' 秒后截图...';
      }
    },1000);
  }

  // 实际执行截图（按模式分发）
  function runCaptureByMode(){
    switch(settings.mode){
      case 'fullpage': captureFullPage(); break;
      case 'selection': captureSelection(); break;
      default: captureVisible();
    }
  }

  function downloadImage(){
    if(!imageDataUrl)return;
    const link=document.createElement('a');
    const ext = settings.format === 'jpeg' ? 'jpg' : settings.format;
    link.download='screenshot-'+Date.now()+'.'+ext;
    link.href=imageDataUrl;
    link.click();
  }

  async function copyToClipboard(){
    if(!imageDataUrl)return;
    try{
      const resp=await fetch(imageDataUrl);
      const blob=await resp.blob();
      const mimeType = 'image/' + (settings.format === 'jpg' ? 'jpeg' : settings.format);
      await navigator.clipboard.write([new ClipboardItem({[mimeType]:blob})]);
      const btn=document.getElementById('btn-copy-img');
      const orig=btn.textContent;
      btn.textContent='✅ 已复制';
      setTimeout(()=>btn.textContent=orig,1500);
    }catch(e){
      alert('复制失败，请尝试使用"保存"按钮');
    }
  }

  // 绑定截图按钮
  document.getElementById('btn-capture').addEventListener('click',doCapture);
  document.getElementById('btn-capture-selection').addEventListener('click',captureSelection);
  document.getElementById('btn-capture-server').addEventListener('click',captureViaServer);
  document.getElementById('btn-download').addEventListener('click',downloadImage);
  document.getElementById('btn-copy-img').addEventListener('click',copyToClipboard);
  // 裁剪按钮 - 进入裁剪模式
  document.getElementById('btn-crop-start').addEventListener('click',startCrop);

  // ===== 裁剪功能 =====
  let cropMode=false;
  let cropRect=null; // {x,y,w,h} 相对于预览图
  let cropOverlay=null;

  function startCrop(){
    if(!imageDataUrl){
      placeholder.textContent='⚠️ 请先截取一张图片再裁剪';
      wrap.style.display='block';
      return;
    }
    cropMode=true;
    const cropArea=document.getElementById('st-crop-area');
    if(cropArea) cropArea.style.display='block';
    preview.style.cursor='crosshair';
    // 创建裁剪遮罩元素
    if(!cropOverlay){
      cropOverlay=document.createElement('div');
      cropOverlay.style.cssText='position:absolute;border:2px dashed #ff5722;background:rgba(255,87,34,0.15);pointer-events:none;display:none;z-index:5';
      wrap.appendChild(cropOverlay);
    }
    // 绑定鼠标事件（一次性绑定，由 cropMode 控制）
    if(!preview.__toolboxCropBound){
      preview.__toolboxCropBound=true;
      let startX=0,startY=0;
      const onStart=(e)=>{
        if(!cropMode)return;
        const rect=preview.getBoundingClientRect();
        startX=e.clientX-rect.left;
        startY=e.clientY-rect.top;
        cropOverlay.style.display='block';
        cropOverlay.style.left=startX+'px';
        cropOverlay.style.top=startY+'px';
        cropOverlay.style.width='0px';
        cropOverlay.style.height='0px';
        const onMove=(ev)=>{
          if(!cropMode)return;
          const curX=Math.max(0,Math.min(rect.width,ev.clientX-rect.left));
          const curY=Math.max(0,Math.min(rect.height,ev.clientY-rect.top));
          const x=Math.min(startX,curX),y=Math.min(startY,curY);
          const w=Math.abs(curX-startX),h=Math.abs(curY-startY);
          cropOverlay.style.left=x+'px';
          cropOverlay.style.top=y+'px';
          cropOverlay.style.width=w+'px';
          cropOverlay.style.height=h+'px';
          cropRect={x,y,w,h,scaleX:preview.naturalWidth/rect.width,scaleY:preview.naturalHeight/rect.height};
        };
        const onEnd=()=>{
          if(!cropMode)return;
          document.removeEventListener('mousemove',onMove);
          document.removeEventListener('mouseup',onEnd);
          if(cropRect&&cropRect.w>5&&cropRect.h>5){
            applyCrop();
          }else{
            cropOverlay.style.display='none';
          }
        };
        document.addEventListener('mousemove',onMove);
        document.addEventListener('mouseup',onEnd);
      };
      preview.addEventListener('mousedown',onStart);
    }
  }

  function applyCrop(){
    if(!cropRect||!imageDataUrl)return;
    try{
      const c=document.createElement('canvas');
      const sx=cropRect.x*cropRect.scaleX;
      const sy=cropRect.y*cropRect.scaleY;
      const sw=cropRect.w*cropRect.scaleX;
      const sh=cropRect.h*cropRect.scaleY;
      c.width=Math.max(1,Math.round(sw));
      c.height=Math.max(1,Math.round(sh));
      const ctx=c.getContext('2d');
      ctx.drawImage(preview,sx,sy,sw,sh,0,0,c.width,c.height);
      const mime='image/'+(settings.format==='jpg'?'jpeg':settings.format);
      const quality=settings.format==='png'?undefined:(settings.quality/100);
      const newDataUrl=c.toDataURL(mime,quality);
      showPreview(newDataUrl);
      cropMode=false;
      cropOverlay.style.display='none';
      const cropArea=document.getElementById('st-crop-area');
      if(cropArea) cropArea.style.display='none';
      preview.style.cursor='';
    }catch(e){
      placeholder.textContent='❌ 裁剪失败: '+e.message;
      cropMode=false;
      if(cropOverlay) cropOverlay.style.display='none';
      preview.style.cursor='';
    }
  }

  // 截图模式选择
  const modeSelect = document.getElementById('st-mode');
  if(modeSelect){
    modeSelect.value = settings.mode;
    modeSelect.addEventListener('change',()=>{settings.mode=modeSelect.value;saveSettings();});
  }
  // 格式选择
  const formatSelect = document.getElementById('st-format');
  if(formatSelect){
    formatSelect.value = settings.format;
    formatSelect.addEventListener('change',()=>{settings.format=formatSelect.value;saveSettings();});
  }
  // 质量滑块
  const qualitySlider = document.getElementById('st-quality');
  const qualityLabel = document.getElementById('st-quality-label');
  if(qualitySlider){
    qualitySlider.value = settings.quality;
    if(qualityLabel) qualityLabel.textContent = settings.quality + '%';
    qualitySlider.addEventListener('input',()=>{
      settings.quality = parseInt(qualitySlider.value, 10);
      if(qualityLabel) qualityLabel.textContent = settings.quality + '%';
      saveSettings();
    });
  }
  // 全页截图按钮
  const btnFullPage = document.getElementById('btn-capture-fullpage');
  if(btnFullPage) btnFullPage.addEventListener('click',captureFullPage);
  // 延迟截图选择
  const delaySelect = document.getElementById('st-delay');
  const delayLabel = document.getElementById('st-delay-label');
  if(delaySelect){
    delaySelect.value = String(settings.delay);
    if(delayLabel) delayLabel.textContent = settings.delay>0 ? settings.delay+' 秒' : '立即';
    delaySelect.addEventListener('change',()=>{
      settings.delay = parseInt(delaySelect.value, 10)||0;
      if(delayLabel) delayLabel.textContent = settings.delay>0 ? settings.delay+' 秒' : '立即';
      saveSettings();
    });
  }

  // 接收截图结果
  window.addEventListener('message',e=>{
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if(!e.data||e.source!==window.parent)return;
    if(e.data&&e.data.action==='screenshotResult'&&e.data.data){
      if(screenshotTimeout) clearTimeout(screenshotTimeout);
      if(e.data.data.success){
        showPreview(e.data.data.dataUrl);
      }else{
        placeholder.textContent='❌ 截图失败: '+(e.data.data.error||'未知错误');
      }
    }
    if(e.data&&e.data.action==='setTheme'&&e.data.data){
      document.documentElement.setAttribute('data-theme',e.data.data.theme);
    }
  });

  // ===== 截图标注功能 =====
  // 标注画布叠加在预览图上方，支持矩形/箭头/画笔/文字/马赛克
  let annotateMode=false;
  let annotateTool='rect';        // 'rect'|'arrow'|'pen'|'text'|'blur'
  let annotateColor='#E74C3C';
  let annotateThickness=3;
  let annotateCanvas=null;
  let annotateCtx=null;
  let annotateHistory=[];         // 标注历史（用于撤销，每项是 ImageData）
  let annotateDrawing=false;
  let annotateStartX=0, annotateStartY=0;

  // 标注按钮 - 进入/退出标注模式
  document.getElementById('btn-annotate-start').addEventListener('click',()=>{
    if(!imageDataUrl){
      placeholder.textContent='⚠️ 请先截取一张图片再标注';
      wrap.style.display='block';
      return;
    }
    annotateMode=!annotateMode;
    const bar=document.getElementById('st-annotate-bar');
    bar.style.display=annotateMode?'flex':'none';
    if(annotateMode){
      startAnnotation();
    }else{
      finishAnnotation();
    }
  });

  function startAnnotation(){
    // 创建标注画布，尺寸与预览图显示尺寸一致
    if(!annotateCanvas){
      annotateCanvas=document.createElement('canvas');
      annotateCanvas.style.cssText='position:absolute;top:0;left:0;pointer-events:none;z-index:4;cursor:crosshair';
      wrap.style.position='relative';
      wrap.appendChild(annotateCanvas);
    }
    const rect=preview.getBoundingClientRect();
    const wrapRect=wrap.getBoundingClientRect();
    annotateCanvas.width=rect.width;
    annotateCanvas.height=rect.height;
    annotateCanvas.style.width=rect.width+'px';
    annotateCanvas.style.height=rect.height+'px';
    // 对齐预览图位置
    annotateCanvas.style.left=(rect.left-wrapRect.left)+'px';
    annotateCanvas.style.top=(rect.top-wrapRect.top)+'px';
    annotateCanvas.style.pointerEvents='auto';
    annotateCtx=annotateCanvas.getContext('2d');
    // 保存初始状态
    annotateHistory=[annotateCtx.getImageData(0,0,annotateCanvas.width,annotateCanvas.height)];
    // 绑定绘制事件
    if(!annotateCanvas.__toolboxAnnoBound){
      annotateCanvas.__toolboxAnnoBound=true;
      annotateCanvas.addEventListener('mousedown',onAnnotateStart);
      annotateCanvas.addEventListener('mousemove',onAnnotateMove);
      annotateCanvas.addEventListener('mouseup',onAnnotateEnd);
      annotateCanvas.addEventListener('mouseleave',onAnnotateEnd);
    }
  }

  function finishAnnotation(){
    if(annotateCanvas){
      annotateCanvas.style.pointerEvents='none';
    }
  }

  function onAnnotateStart(e){
    if(!annotateMode||!annotateCtx)return;
    annotateDrawing=true;
    const rect=annotateCanvas.getBoundingClientRect();
    annotateStartX=e.clientX-rect.left;
    annotateStartY=e.clientY-rect.top;
    // 保存当前状态用于撤销
    annotateHistory.push(annotateCtx.getImageData(0,0,annotateCanvas.width,annotateCanvas.height));
    if(annotateHistory.length>30) annotateHistory.shift();
    // 画笔模式直接开始绘制
    if(annotateTool==='pen'){
      annotateCtx.beginPath();
      annotateCtx.moveTo(annotateStartX,annotateStartY);
    }
    // 文字模式弹出输入框
    if(annotateTool==='text'){
      const text=window.prompt('请输入标注文字：');
      if(text){
        annotateCtx.fillStyle=annotateColor;
        const fs=Math.max(14,annotateThickness*5);
        annotateCtx.font=fs+'px sans-serif';
        annotateCtx.fillText(text,annotateStartX,annotateStartY+fs);
      }
      annotateDrawing=false;
      return;
    }
    // 马赛克模式 - 记录起始区域
    if(annotateTool==='blur'){
      // 在 move 中处理
    }
  }

  function onAnnotateMove(e){
    if(!annotateDrawing||!annotateCtx)return;
    const rect=annotateCanvas.getBoundingClientRect();
    const x=e.clientX-rect.left;
    const y=e.clientY-rect.top;
    annotateCtx.strokeStyle=annotateColor;
    annotateCtx.fillStyle=annotateColor;
    annotateCtx.lineWidth=annotateThickness;
    annotateCtx.lineCap='round';
    annotateCtx.lineJoin='round';

    if(annotateTool==='pen'){
      annotateCtx.lineTo(x,y);
      annotateCtx.stroke();
    }else if(annotateTool==='rect'){
      // 实时预览：恢复上次状态后重绘
      const last=annotateHistory[annotateHistory.length-1];
      if(last) annotateCtx.putImageData(last,0,0);
      annotateCtx.strokeRect(annotateStartX,annotateStartY,x-annotateStartX,y-annotateStartY);
    }else if(annotateTool==='arrow'){
      const last=annotateHistory[annotateHistory.length-1];
      if(last) annotateCtx.putImageData(last,0,0);
      drawArrow(annotateCtx,annotateStartX,annotateStartY,x,y);
    }else if(annotateTool==='blur'){
      const last=annotateHistory[annotateHistory.length-1];
      if(last) annotateCtx.putImageData(last,0,0);
      // 在拖选区域应用马赛克效果
      applyBlur(annotateCtx,annotateStartX,annotateStartY,x-annotateStartX,y-annotateStartY,preview);
    }
  }

  function onAnnotateEnd(e){
    annotateDrawing=false;
  }

  // 绘制箭头
  function drawArrow(ctx,x1,y1,x2,y2){
    const headLen=Math.max(10,annotateThickness*4);
    const angle=Math.atan2(y2-y1,x2-x1);
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x2,y2);
    ctx.stroke();
    // 箭头头部
    ctx.beginPath();
    ctx.moveTo(x2,y2);
    ctx.lineTo(x2-headLen*Math.cos(angle-Math.PI/6),y2-headLen*Math.sin(angle-Math.PI/6));
    ctx.lineTo(x2-headLen*Math.cos(angle+Math.PI/6),y2-headLen*Math.sin(angle+Math.PI/6));
    ctx.closePath();
    ctx.fill();
  }

  // 应用马赛克效果（从源图采样并放大绘制）
  function applyBlur(ctx,x,y,w,h,sourceImg){
    const sx=x*(sourceImg.naturalWidth/ctx.canvas.width);
    const sy=y*(sourceImg.naturalHeight/ctx.canvas.height);
    const sw=Math.max(1,w*(sourceImg.naturalWidth/ctx.canvas.width));
    const sh=Math.max(1,h*(sourceImg.naturalHeight/ctx.canvas.height));
    // 临时画布缩小再放大产生马赛克
    const tmp=document.createElement('canvas');
    const blockSize=10;
    tmp.width=Math.max(1,Math.ceil(Math.abs(w)/blockSize));
    tmp.height=Math.max(1,Math.ceil(Math.abs(h)/blockSize));
    const tctx=tmp.getContext('2d');
    tctx.drawImage(sourceImg,sx,sy,sw,sh,0,0,tmp.width,tmp.height);
    // 关闭平滑后放大
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(tmp,0,0,tmp.width,tmp.height,x,y,Math.abs(w),Math.abs(h));
    ctx.imageSmoothingEnabled=true;
  }

  // 工具选择
  document.querySelectorAll('.st-annotate-tools button').forEach(btn=>{
    btn.addEventListener('click',()=>{
      annotateTool=btn.dataset.tool;
      document.querySelectorAll('.st-annotate-tools button').forEach(b=>b.classList.remove('btn--primary'));
      btn.classList.add('btn--primary');
    });
  });
  // 颜色选择
  document.querySelectorAll('.st-color-swatch').forEach(sw=>{
    sw.addEventListener('click',()=>{
      annotateColor=sw.dataset.color;
      document.querySelectorAll('.st-color-swatch').forEach(s=>s.style.outline='');
      sw.style.outline='2px solid #5b7fff';
    });
  });
  // 粗细
  const thicknessInput=document.getElementById('st-anno-thickness');
  if(thicknessInput){
    thicknessInput.addEventListener('input',()=>{
      annotateThickness=parseInt(thicknessInput.value, 10)||3;
    });
  }
  // 撤销
  document.getElementById('btn-anno-undo').addEventListener('click',()=>{
    if(annotateHistory.length>0){
      const last=annotateHistory.pop();
      annotateCtx.putImageData(last,0,0);
    }
  });
  // 清除标注
  document.getElementById('btn-anno-clear').addEventListener('click',()=>{
    if(annotateCtx){
      annotateCtx.clearRect(0,0,annotateCanvas.width,annotateCanvas.height);
      annotateHistory=[annotateCtx.getImageData(0,0,annotateCanvas.width,annotateCanvas.height)];
    }
  });
  // 完成标注 - 将标注合并到原图
  document.getElementById('btn-anno-done').addEventListener('click',()=>{
    if(!annotateCanvas||!imageDataUrl)return;
    try{
      // 创建合成画布：以原图为底，叠加标注层
      const out=document.createElement('canvas');
      out.width=preview.naturalWidth;
      out.height=preview.naturalHeight;
      const octx=out.getContext('2d');
      // 绘制原图
      octx.drawImage(preview,0,0);
      // 缩放绘制标注层（从显示尺寸到原始尺寸）
      const scaleX=preview.naturalWidth/annotateCanvas.width;
      const scaleY=preview.naturalHeight/annotateCanvas.height;
      octx.drawImage(annotateCanvas,0,0,annotateCanvas.width,annotateCanvas.height,0,0,out.width,out.height);
      const mime='image/'+(settings.format==='jpg'?'jpeg':settings.format);
      const quality=settings.format==='png'?undefined:(settings.quality/100);
      const newDataUrl=out.toDataURL(mime,quality);
      showPreview(newDataUrl);
      // 退出标注模式
      annotateMode=false;
      if(annotateCanvas) annotateCanvas.style.display='none';
      document.getElementById('st-annotate-bar').style.display='none';
    }catch(e){
      placeholder.textContent='❌ 标注合并失败: '+e.message;
    }
  });
});
