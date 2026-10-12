document.addEventListener('DOMContentLoaded',()=>{
const ci=document.getElementById('cron-input'),ra=document.getElementById('result-area'),pp=document.getElementById('presets-panel');
const FIELD_NAMES=['分钟','小时','日期','月份','星期'];
const MONTHS=['','1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const DAYS=['日','一','二','三','四','五','六'];

/** HTML 转义：用户输入的 Cron 表达式会被拼入 innerHTML，必须转义以避免自 XSS */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function parseField(field,min,max){
  if(field==='*')return`每${min===0?'分钟':min===1?'小时':min===2?'号':'个'}`;
  let parts=[];
  field.split(',').forEach(p=>{
    if(p.includes('/')){const[b,s]=p.split('/');parts.push(`从${b==='*'?min:b}开始每${s}${min===0?'分钟':''}`)}
    else if(p.includes('-')){const[b,e]=p.split('-');parts.push(`${b}到${e}`)}
    else parts.push(p)
  });
  return parts.join('、');
}

/**
 * 计算下次执行时间
 * 采用"按字段跳进"策略而非逐分钟穷举：月份/日/小时不匹配时直接跳到下一个
 * 边界（下月1日 / 次日0点 / 下一个整点），把最坏情况从数百万次迭代降到数千次，
 * 同时保留 5 年搜索上限，避免永不匹配的表达式（如 2月30日）造成界面卡死。
 * @param {string} cron 5 字段 Cron 表达式
 * @param {number} count 需要的结果数量
 * @returns {Date[]} 下次执行时间列表（找不到则为空数组）
 */
function getNextRuns(cron,count=5){
  const parts=cron.split(/\s+/);
  if(parts.length!==5)return [];
  const[min,hour,dom,month,dow]=parts.map(p=>p.trim());
  // 标准 cron（Vixie/POSIX）语义：日与星期同时被限制时取"或"，否则取"与"
  const domRestricted=dom!=='*',dowRestricted=dow!=='*';
  const dayMatches=d=>(domRestricted&&dowRestricted)
    ?(valMatch(d.getDate(),dom,1,31)||valMatch(d.getDay(),dow,0,6))
    :(valMatch(d.getDate(),dom,1,31)&&valMatch(d.getDay(),dow,0,6));

  const runs=[];
  const deadline=Date.now()+5*366*24*3600*1000; // 最多向前搜索 5 年
  const d=new Date();
  d.setSeconds(0,0);d.setMinutes(d.getMinutes()+1);

  while(runs.length<count&&d.getTime()<=deadline){
    if(!valMatch(d.getMonth()+1,month,1,12)){d.setMonth(d.getMonth()+1,1);d.setHours(0,0,0,0);continue}
    if(!dayMatches(d)){d.setDate(d.getDate()+1);d.setHours(0,0,0,0);continue}
    if(!valMatch(d.getHours(),hour,0,23)){d.setHours(d.getHours()+1,0,0,0);continue}
    if(!valMatch(d.getMinutes(),min,0,59)){d.setMinutes(d.getMinutes()+1);continue}
    runs.push(new Date(d));
    d.setMinutes(d.getMinutes()+1);
  }
  return runs;
}

function valMatch(v,expr,min,max){
  if(expr==='*')return true;
  return expr.split(',').some(p=>{
    if(p.includes('/')){const[b,s]=p.split('/');const base=b==='*'?min:parseInt(b, 10);const step=parseInt(s, 10);if(!Number.isFinite(base)||!Number.isFinite(step)||step<=0)return false;return v>=base&&(v-base)%step===0}
    if(p.includes('-')){const[b,e]=p.split('-');const bs=parseInt(b, 10),es=parseInt(e, 10);if(!Number.isFinite(bs)||!Number.isFinite(es))return false;return v>=bs&&v<=es}
    const n=parseInt(p, 10);
    // 星期字段允许 7 表示星期日（部分 cron 方言）
    if(max===6&&n===7)return v===0;
    return n===v;
  });
}

/** 校验表达式是否为合法的 5 字段 cron，返回 {ok, error} */
function validateCron(cron){
  const parts=cron.split(/\s+/);
  if(parts.length!==5)return{ok:false,error:'Cron表达式需要5个字段: 分钟 小时 日 月 星期'};
  const ranges=[[0,59],[0,23],[1,31],[1,12],[0,6]];
  for(let i=0;i<5;i++){
    const field=parts[i];
    if(field==='*')continue;
    const ok=field.split(',').every(p=>{
      if(!p)return false;
      if(p.includes('/')){const[b,s]=p.split('/');if(!/^\d+$/.test(s)||parseInt(s, 10)<=0)return false;if(b==='*')return true;return /^\d+$/.test(b)&&inRange(parseInt(b, 10),ranges[i])}
      if(p.includes('-')){const[b,e]=p.split('-');if(!/^\d+$/.test(b)||!/^\d+$/.test(e))return false;const bs=parseInt(b, 10),es=parseInt(e, 10);return inRange(bs,ranges[i])&&inRange(es,ranges[i])&&bs<=es}
      if(!/^\d+$/.test(p))return false;
      const n=parseInt(p, 10);
      return i===4&&n===7?true:inRange(n,ranges[i]);
    });
    if(!ok)return{ok:false,error:`第 ${i+1} 个字段（${FIELD_NAMES[i]}）取值非法: ${field}`};
  }
  return{ok:true};
}
function inRange(n,[min,max]){return n>=min&&n<=max}

function parse(){
  const cron=ci.value.trim();
  if(!cron){ra.innerHTML='<div class="info-placeholder">请输入Cron表达式</div>';return}
  const v=validateCron(cron);
  if(!v.ok){ra.innerHTML='<div class="info-placeholder error">'+esc(v.error)+'</div>';return}
  const parts=cron.split(/\s+/);
  const nextRuns=getNextRuns(cron,5);
  ra.innerHTML=`
    <div class="cron-result-card"><h4>📋 字段解析</h4><table>
      ${FIELD_NAMES.map((n,i)=>`<tr><td>${n}</td><td><code>${esc(parts[i])}</code></td><td>${esc(parseField(parts[i],i===0?0:i===1?0:1,i===0?59:i===1?23:i===2?31:i===3?12:6))}</td></tr>`).join('')}
    </table></div>
    <div class="cron-result-card"><h4>⏰ 下次执行时间</h4>
      ${nextRuns.length>0?nextRuns.map(d=>`<div class="next-run">📅 ${esc(d.toLocaleString('zh-CN',{weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}))}</div>`).join(''):'<div>未来 5 年内无匹配时间（表达式可能指向不存在的日期，如 2月30日）</div>'}
    </div>
    <div class="cron-result-card"><h4>📝 说明</h4><div class="cron-desc">${esc(getDescription(cron))}</div></div>`;
}

function getDescription(cron){
  const parts=cron.split(/\s+/);
  if(parts.length<5)return '无效表达式';
  const fs=[parseField(parts[0],0,59),parseField(parts[1],0,23),parseField(parts[2],1,31),parseField(parts[3],1,12),parseField(parts[4],0,6)];
  return `在${fs[1]}的${fs[0]}，${fs[2]}${fs[3]}${parts[4]!=='*'?`星期${parseField(parts[4],0,6)}`:''}执行`;
}

ci.addEventListener('keydown',e=>{if(e.key==='Enter')parse()});
document.getElementById('btn-parse').addEventListener('click',parse);
document.getElementById('btn-preset').addEventListener('click',()=>{pp.hidden=!pp.hidden});
document.getElementById('btn-copy').addEventListener('click',()=>{navigator.clipboard.writeText(ra.innerText).catch(()=>{})});
pp.querySelectorAll('.preset-btn').forEach(btn=>btn.addEventListener('click',()=>{ci.value=btn.dataset.cron;parse()}));
parse();
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
      const inputArea = document.getElementById('cron-input');
      if (inputArea && typeof event.data.data === 'string') {
        inputArea.value = event.data.data;
        inputArea.dispatchEvent(new Event('input'));
      }
    }
  });
