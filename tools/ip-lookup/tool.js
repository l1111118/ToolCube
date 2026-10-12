document.addEventListener('DOMContentLoaded',()=>{
const ipInput=document.getElementById('ip-input'),resultArea=document.getElementById('result-area'),
  historyArea=document.getElementById('ip-history'),
  batchMode=document.getElementById('batch-mode'),
  batchArea=document.getElementById('batch-area');
function escapeHtml(str){if(str==null)return'';return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// ── PostMessage 通信路由 ──
let _msgId = 0;
const _pendingMsgs = new Map();

function _handlePostMessageResponse(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (event.source !== window.parent) return;
  if (!event.data || typeof event.data !== 'object') return;
  const { action, data } = event.data;
  if ((action === '__bgResponse' || action === '__contentResponse') && data && data.__id) {
    const pending = _pendingMsgs.get(data.__id);
    if (pending) {
      _pendingMsgs.delete(data.__id);
      clearTimeout(pending.timer);
      const result = data.result;
      if (action === '__bgResponse' && result && result.success === false && result.error) {
        pending.reject(new Error(result.error));
      } else {
        pending.resolve(result);
      }
    }
  }
}
window.addEventListener('message', _handlePostMessageResponse);

function callBackground(action, data) {
  return new Promise((resolve, reject) => {
    const id = ++_msgId;
    const timer = setTimeout(() => {
      _pendingMsgs.delete(id);
      reject(new Error('后台调用超时'));
    // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
    // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
    }, 70000);
    _pendingMsgs.set(id, { resolve, reject, timer });
    window.parent.postMessage({ action: 'callBackground', data: { id, action, data } }, '*');
  });
}

// 通过 background 代理查询 IP（绕过 CORS，统一架构）
async function ipLookupViaBg(ip){
  const r=await callBackground('ipLookup',{ip:ip||''});
  if(!r||!r.success) throw new Error(r&&r.error||'查询失败');
  return r.data;
}
async function getMyIpViaBg(){
  const r=await callBackground('getMyIp',null);
  if(!r||!r.success) throw new Error(r&&r.error||'获取本机IP失败');
  return {ip:r.ip,data:r.data};
}

// IP类型判断：IPv4 / IPv6
function ipType(ip){
  if(!ip) return '未知';
  const s=ip.trim();
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(s)){
    const parts=s.split('.');
    if(parts.every(p=>+p>=0&&+p<=255)) return 'IPv4';
  }
  if(/^[0-9a-fA-F:]+$/.test(s) && s.includes(':')) return 'IPv6';
  return '未知';
}

// 当前批量查询结果（用于导出）
let lastBatchResults=[];

// 查询历史
let lookupHistory = [];
function loadHistory(){
  try{
    const d=localStorage.getItem('ip_lookup_history');
    if(d) lookupHistory=JSON.parse(d);
  }catch(e){}
  renderHistory();
}
function saveHistory(){
  try{ localStorage.setItem('ip_lookup_history',JSON.stringify(lookupHistory)); }catch(e){}
}
function addToHistory(ip,data){
  lookupHistory=lookupHistory.filter(h=>h.ip!==ip);
  lookupHistory.unshift({ip,country:data.country,city:data.city,isp:data.isp,timestamp:Date.now()});
  if(lookupHistory.length>10) lookupHistory=lookupHistory.slice(0,10);
  saveHistory();
  renderHistory();
}
function renderHistory(){
  if(!historyArea) return;
  if(lookupHistory.length===0){ historyArea.innerHTML='<div class="history-empty">暂无查询历史</div>'; return; }
  historyArea.innerHTML=lookupHistory.map((h,i)=>`<div class="history-item" data-idx="${i}"><span class="history-ip">${escapeHtml(h.ip)}</span><span class="history-loc">${escapeHtml(h.city||h.country||'--')}</span><span class="history-isp">${escapeHtml((h.isp||'').substring(0,20))}</span><span class="history-time">${new Date(h.timestamp).toLocaleTimeString()}</span></div>`).join('');
  historyArea.querySelectorAll('.history-item').forEach(item=>{
    item.addEventListener('click',()=>{
      const idx=parseInt(item.dataset.idx, 10);
      ipInput.value=lookupHistory[idx].ip;
      lookup();
    });
  });
}

// 批量/单个模式切换
let isBatchMode=false;
if(batchMode){
  batchMode.addEventListener('change',()=>{
    isBatchMode=batchMode.checked;
    if(batchArea) batchArea.style.display=isBatchMode?'block':'none';
    ipInput.style.display=isBatchMode?'none':'';
  });
}

// 风险评估
function assessRisk(data){
  const risks=[];
  const isp=(data.isp||'').toLowerCase();
  const org=(data.org||'').toLowerCase();
  const as=(data.as||'').toLowerCase();
  const vpnKeywords=['vpn','proxy','tunnel','hosting','cloud','server','datacenter','data center','vps','dedicated','rent','colocation','tor exit'];
  const torKeywords=['tor','exit node','relay'];
  const isTor=torKeywords.some(k=>as.includes(k)||org.includes(k)||isp.includes(k));
  const isVPN=vpnKeywords.some(k=>as.includes(k)||org.includes(k)||isp.includes(k));
  if(isTor) risks.push({level:'high',text:'🚨 Tor出口节点检测',desc:'该IP可能通过Tor网络访问'});
  if(isVPN&&!isTor) risks.push({level:'medium',text:'⚠️ 可能是VPN/代理',desc:'ISP/组织信息表明可能是VPN或代理服务'});
  if(data.hosting) risks.push({level:'medium',text:'⚠️ 数据中心IP',desc:'该IP属于数据中心而非住宅网络'});
  if(risks.length===0) risks.push({level:'low',text:'✅ 低风险',desc:'未检测到代理/VPN/Tor特征'});
  return risks;
}

async function lookup(){
  // 批量模式
  if(isBatchMode && batchArea){
    const text=batchArea.value.trim();
    if(!text){resultArea.innerHTML='<div class="info-placeholder">请输入IP地址</div>';return;}
    const ips=text.split(/[\n,;]+/).map(s=>s.trim()).filter(s=>s);
    if(!ips.length){resultArea.innerHTML='<div class="info-placeholder">未检测到有效IP</div>';return;}
    lastBatchResults=[]; // 清空批量结果，重新累计
    resultArea.innerHTML='<div class="info-loading">⏳ 批量查询中 (0/'+ips.length+')...</div>';
    let html='';
    for(let i=0;i<ips.length;i++){
      const ip=ips[i];
      try{
        const d=await ipLookupViaBg(ip);
        resultArea.innerHTML='<div class="info-loading">⏳ 批量查询中 ('+(i+1)+'/'+ips.length+')...</div>';
        // 查询失败会由 ipLookupViaBg 抛出，因此走到这里即为成功
        html+=renderResult(d,false);
        addToHistory(ip,d);
      }catch(e){
        lastBatchResults.push({ip, ipType: ipType(ip), error: e.message});
        html+='<div class="ip-card"><h3>🌐 '+escapeHtml(ip)+' <span class="ip-type-badge ip-type-badge--'+ipType(ip).toLowerCase()+'">'+ipType(ip)+'</span></h3><div class="info-placeholder">查询失败: '+escapeHtml(e.message)+'</div></div>';
      }
    }
    resultArea.innerHTML=html||'<div class="info-placeholder">批量查询完成，无有效结果</div>';
    return;
  }

  // 单个查询
  const ip=ipInput.value.trim();
  lastBatchResults=[]; // 单个查询也重置批量结果
  resultArea.innerHTML='<div class="info-loading">⏳ 查询中...</div>';
  try{
    if(!ip){
      // 查询本机IP：优先一次拿到 IP + 归属地，仅拿到 IP 时再补一次归属地查询
      const myip=await getMyIpViaBg();
      if(myip.ip){ ipInput.value=myip.ip; }
      if(myip.data){
        resultArea.innerHTML=renderResult(myip.data);
        addToHistory(myip.ip,myip.data);
      }else if(myip.ip){
        const d=await ipLookupViaBg(myip.ip);
        resultArea.innerHTML=renderResult(d);
        addToHistory(myip.ip,d);
      }else{
        resultArea.innerHTML='<div class="info-placeholder">获取本机IP失败</div>';
      }
    }else{
      const d=await ipLookupViaBg(ip);
      resultArea.innerHTML=renderResult(d);
      addToHistory(ip,d);
    }
  }catch(e){resultArea.innerHTML='<div class="info-placeholder">查询失败: '+escapeHtml(e.message)+'</div>'}
}

function renderResult(d,showHeader=true){
  const risks=assessRisk(d);
  // 使用 OpenStreetMap：开放数据、无追踪，避免把第三方地图服务硬编码进工具
  const mapsLink=d.lat&&d.lon?`<a href="https://www.openstreetmap.org/?mlat=${encodeURIComponent(d.lat)}&mlon=${encodeURIComponent(d.lon)}#map=12" target="_blank" rel="noopener" class="map-link">📍 在地图中查看</a>`:'';
  const riskHtml=risks.map(r=>{
    const cls=r.level==='high'?'risk-high':r.level==='medium'?'risk-medium':'risk-low';
    return `<div class="risk-item ${cls}"><strong>${r.text}</strong><br><small>${r.desc}</small></div>`;
  }).join('');
  // IP 类型判断
  const ipVer = ipType(d.ip);
  const ipTypeBadge = `<span class="ip-type-badge ip-type-badge--${ipVer.toLowerCase()}">${ipVer}</span>`;
  // 保存到批量结果
  const exists = lastBatchResults.find(r=>r.ip===d.ip);
  if(!exists) lastBatchResults.push({
    ip: d.ip, ipType: ipVer,
    country: d.country, region: d.region, city: d.city,
    zip: d.zip, isp: d.isp, org: d.org, as: d.as,
    lat: d.lat, lon: d.lon, timezone: d.timezone, hosting: d.hosting
  });
  return `<div class="ip-card">${showHeader?'<h3>🌐 IP信息</h3>':''}
    <table>
      <tr><td>IP地址</td><td><code>${escapeHtml(d.ip)}</code> ${ipTypeBadge}</td></tr>
      <tr><td>IP类型</td><td>${ipVer}</td></tr>
      <tr><td>国家</td><td>${escapeHtml(d.country)}</td></tr>
      <tr><td>地区</td><td>${escapeHtml(d.region)}</td></tr>
      <tr><td>城市</td><td>${escapeHtml(d.city)}</td></tr>
      <tr><td>邮编</td><td>${escapeHtml(d.zip)}</td></tr>
      <tr><td>ISP</td><td>${escapeHtml(d.isp)}</td></tr>
      <tr><td>组织</td><td>${escapeHtml(d.org)}</td></tr>
      <tr><td>AS</td><td>${escapeHtml(d.as)}</td></tr>
      <tr><td>经纬度</td><td>${escapeHtml(d.lat)}, ${escapeHtml(d.lon)} ${mapsLink}</td></tr>
      <tr><td>时区</td><td>${escapeHtml(d.timezone)}</td></tr>
      ${d.hosting!==undefined?`<tr><td>数据中心</td><td>${d.hosting?'✅ 是':'❌ 否'}</td></tr>`:''}
    </table>
    <div class="risk-section"><h4>🛡️ 风险评估</h4>${riskHtml}</div>
    <div class="ip-reputation">
      <button class="btn btn--secondary btn--sm" id="btn-ip-rep" data-ip="${escapeHtml(d.ip)}">🔍 查询 IP 信誉</button>
      <div class="ip-rep-result" id="ip-rep-result" hidden></div>
    </div>
  </div>`;
}

/**
 * 查询 IP 信誉（走服务端点，可指向自建服务）。
 * 归属地信息由 ipGeo 提供，但"是否被观测到恶意活动"需要专门的信誉数据源。
 */
async function lookupIpReputation(ip){
  const box=document.getElementById('ip-rep-result');
  if(!box||!ip) return;
  box.hidden=false;
  box.className='ip-rep-result ip-rep-result--loading';
  box.textContent='⏳ 查询中...';
  try{
    const r=await callBackground('serviceRequest',{kind:'ipReputation',params:{ip}});
    if(!r||!r.success){
      box.className='ip-rep-result ip-rep-result--err';
      box.textContent='❌ 查询失败: '+((r&&r.error)||'未知错误')
        +'\n可在「设置 → 服务端点 → IP 信誉查询」中更换服务商或指向自建服务';
      return;
    }
    const d=r.data||{};
    box.className='ip-rep-result ip-rep-result--ok';
    if(d.noise){
      box.innerHTML='<span style="color:#e53935;font-weight:600">🚨 该 IP 被观测到互联网扫描/恶意活动</span>'
        +(d.classification?' · 分类: '+escapeHtml(d.classification):'')
        +(d.name?' · '+escapeHtml(d.name):'')
        +(d.lastSeen?' · 最近出现: '+escapeHtml(String(d.lastSeen).slice(0,10)):'');
    }else if(d.riot){
      box.innerHTML='<span style="color:var(--tt-success)">✅ 该 IP 属于常见 benign 服务（RIOT 白名单）</span>';
    }else{
      box.innerHTML='<span style="color:var(--tt-text-tertiary)">ℹ️ 未观测到该 IP 的恶意活动记录</span>';
    }
  }catch(e){
    box.className='ip-rep-result ip-rep-result--err';
    box.textContent='❌ 查询失败: '+e.message;
  }
}

document.getElementById('btn-lookup').addEventListener('click',lookup);
document.getElementById('btn-copy').addEventListener('click',()=>{const t=resultArea.innerText;if(t)navigator.clipboard.writeText(t).catch(()=>{})});
ipInput.addEventListener('keydown',e=>{if(e.key==='Enter')lookup()});

// IP 信誉查询（结果区每次重新渲染，用事件委托绑定）
resultArea.addEventListener('click',(e)=>{
  const btn=e.target.closest('#btn-ip-rep');
  if(btn) lookupIpReputation(btn.dataset.ip);
});

// 查询我的IP按钮
const btnMyIp=document.getElementById('btn-my-ip');
if(btnMyIp){
  btnMyIp.addEventListener('click',async()=>{
    ipInput.value='';
    if(batchMode && batchMode.checked){ batchMode.checked=false; if(batchArea)batchArea.style.display='none'; ipInput.style.display=''; isBatchMode=false; }
    resultArea.innerHTML='<div class="info-loading">⏳ 获取本机IP中...</div>';
    try{
      const myip=await getMyIpViaBg();
      ipInput.value=myip.ip||'';
      lookup();
    }catch(e){resultArea.innerHTML='<div class="info-placeholder">获取本机IP失败: '+escapeHtml(e.message)+'</div>';}
  });
}

// 导出 JSON
const btnExportJson=document.getElementById('btn-export-json');
if(btnExportJson){
  btnExportJson.addEventListener('click',()=>{
    if(lastBatchResults.length===0){alert('请先查询后再导出');return;}
    const data=JSON.stringify(lastBatchResults,null,2);
    const blob=new Blob([data],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download='ip-lookup-'+Date.now()+'.json';a.click();
    URL.revokeObjectURL(url);
  });
}

// 导出 CSV
const btnExportCsv=document.getElementById('btn-export-csv');
if(btnExportCsv){
  btnExportCsv.addEventListener('click',()=>{
    if(lastBatchResults.length===0){alert('请先查询后再导出');return;}
    const headers=['IP','IP类型','国家','地区','城市','邮编','ISP','组织','AS','纬度','经度','时区','数据中心','错误'];
    const rows=lastBatchResults.map(r=>[
      r.ip,r.ipType||'',r.country||'',r.region||'',r.city||'',r.zip||'',
      r.isp||'',r.org||'',r.as||'',r.lat||'',r.lon||'',r.timezone||'',
      r.hosting===true?'是':r.hosting===false?'否':'',r.error||''
    ]);
    const csv=[headers,...rows].map(row=>row.map(cell=>{
      const s=String(cell==null?'':cell);
      return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
    }).join(',')).join('\n');
    // 添加 BOM 让 Excel 正确识别 UTF-8
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download='ip-lookup-'+Date.now()+'.csv';a.click();
    URL.revokeObjectURL(url);
  });
}

loadHistory();
lookup();
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
      const inputArea = document.getElementById('ip-input');
      if (inputArea && typeof event.data.data === 'string') {
        inputArea.value = event.data.data;
        inputArea.dispatchEvent(new Event('input'));
      }
    }
  });
