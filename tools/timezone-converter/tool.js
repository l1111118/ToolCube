/**
 * 时区转换器
 * 纯本地实现，使用 Intl.DateTimeFormat 与 Date API
 * @version 1.3.0
 */
(function () {
  'use strict';

  window.addEventListener('message',function(e){
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）
if(!e.data||e.source!==window.parent)return;if(e.data&&e.data.action==='setTheme'&&e.data.data)document.documentElement.setAttribute('data-theme',e.data.data.theme);});

  // 常用时区列表
  const TIMEZONES = [
    { id: 'Pacific/Midway', label: '中途岛 (UTC-11)' },
    { id: 'Pacific/Honolulu', label: '檀香山 (UTC-10)' },
    { id: 'America/Anchorage', label: '安克雷奇 (UTC-9)' },
    { id: 'America/Los_Angeles', label: '洛杉矶 (UTC-8)' },
    { id: 'America/Denver', label: '丹佛 (UTC-7)' },
    { id: 'America/Chicago', label: '芝加哥 (UTC-6)' },
    { id: 'America/New_York', label: '纽约 (UTC-5)' },
    { id: 'America/Sao_Paulo', label: '圣保罗 (UTC-3)' },
    { id: 'Atlantic/Azores', label: '亚速尔群岛 (UTC-1)' },
    { id: 'Europe/London', label: '伦敦 (UTC+0)' },
    { id: 'Europe/Paris', label: '巴黎 (UTC+1)' },
    { id: 'Europe/Berlin', label: '柏林 (UTC+1)' },
    { id: 'Europe/Athens', label: '雅典 (UTC+2)' },
    { id: 'Europe/Moscow', label: '莫斯科 (UTC+3)' },
    { id: 'Asia/Dubai', label: '迪拜 (UTC+4)' },
    { id: 'Asia/Karachi', label: '卡拉奇 (UTC+5)' },
    { id: 'Asia/Kolkata', label: '加尔各答 (UTC+5:30)' },
    { id: 'Asia/Dhaka', label: '达卡 (UTC+6)' },
    { id: 'Asia/Bangkok', label: '曼谷 (UTC+7)' },
    { id: 'Asia/Shanghai', label: '上海 (UTC+8)' },
    { id: 'Asia/Hong_Kong', label: '香港 (UTC+8)' },
    { id: 'Asia/Singapore', label: '新加坡 (UTC+8)' },
    { id: 'Asia/Taipei', label: '台北 (UTC+8)' },
    { id: 'Asia/Tokyo', label: '东京 (UTC+9)' },
    { id: 'Asia/Seoul', label: '首尔 (UTC+9)' },
    { id: 'Australia/Sydney', label: '悉尼 (UTC+10)' },
    { id: 'Pacific/Auckland', label: '奥克兰 (UTC+12)' }
  ];

  // 状态
  let targets = [
    { id: 'America/New_York', label: '纽约' },
    { id: 'Europe/London', label: '伦敦' },
    { id: 'Asia/Tokyo', label: '东京' }
  ];

  // DOM
  const E = {
    srcDate: document.getElementById('src-date'),
    srcTime: document.getElementById('src-time'),
    srcTz: document.getElementById('src-tz'),
    srcMeta: document.getElementById('src-meta'),
    targetList: document.getElementById('target-list'),
    tsInput: document.getElementById('ts-input'),
    tsType: document.getElementById('ts-type'),
    calStrip: document.getElementById('cal-strip'),
    btnNow: document.getElementById('btn-now'),
    btnSwap: document.getElementById('btn-swap'),
    btnAdd: document.getElementById('btn-add-row'),
    btnCopy: document.getElementById('btn-copy'),
    btnTsToTime: document.getElementById('btn-ts-to-time'),
    btnTimeToTs: document.getElementById('btn-time-to-ts')
  };

  // ==================== 工具函数 ====================

  /**
   * 推断浏览器本地时区
   */
  function detectLocalTz() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    } catch (e) {
      return 'Asia/Shanghai';
    }
  }

  /**
   * 获取指定时区的偏移分钟数
   */
  function getTimezoneOffset(date, tz) {
    try {
      // 使用 Intl.DateTimeFormat 获取目标时区的"墙钟时间"
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      });
      const parts = dtf.formatToParts(date);
      const get = type => parts.find(p => p.type === type)?.value;
      const utcOfWall = Date.UTC(+get('year'), +get('month') - 1, +get('day'),
        +get('hour') === 24 ? 0 : +get('hour'),
        +get('minute'), +get('second'));
      return Math.round((utcOfWall - date.getTime()) / 60000);
    } catch (e) {
      return 0;
    }
  }

  /**
   * 获取时区缩写
   */
  function getTimezoneAbbreviation(date, tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, timeZoneName: 'short'
      }).formatToParts(date);
      return parts.find(p => p.type === 'timeZoneName')?.value || '';
    } catch (e) {
      return '';
    }
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  /**
   * 将源时区的"墙钟时间"转换为 UTC Date
   * 注意：仅作为计算中间值使用
   */
  function wallTimeToUtc(date, time, tz) {
    // 构造一个临时 Date 假定为 UTC，然后计算其目标时区的墙钟，再反推
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm, ss] = time.split(':').map(Number);
    const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss || 0));
    const offset = getTimezoneOffset(guess, tz);
    return new Date(guess.getTime() - offset * 60000);
  }

  /**
   * 在指定时区中格式化 Date
   */
  function formatInTz(date, tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
      }).formatToParts(date);
      const get = type => parts.find(p => p.type === type)?.value;
      const hour = +get('hour') === 24 ? 0 : +get('hour');
      return {
        date: get('year') + '-' + get('month') + '-' + get('day'),
        time: pad(hour) + ':' + get('minute') + ':' + get('second'),
        weekday: new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(date)
      };
    } catch (e) {
      return { date: '--', time: '--:--:--', weekday: '' };
    }
  }

  function formatOffset(min) {
    const sign = min >= 0 ? '+' : '-';
    const abs = Math.abs(min);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return 'UTC' + sign + pad(h) + ':' + pad(m);
  }

  // ==================== 渲染 ====================

  function fillTzSelect(sel, selected) {
    sel.innerHTML = TIMEZONES.map(tz =>
      '<option value="' + tz.id + '"' + (tz.id === selected ? ' selected' : '') + '>' + escapeHtml(tz.label) + '</option>'
    ).join('');
  }

  function getCurrentSrcDate() {
    return E.srcDate.value && E.srcTime.value
      ? wallTimeToUtc(E.srcDate.value, E.srcTime.value, E.srcTz.value)
      : new Date();
  }

  function render() {
    const srcTz = E.srcTz.value;
    const utcDate = getCurrentSrcDate();
    const srcOffset = getTimezoneOffset(utcDate, srcTz);
    const srcAbbrev = getTimezoneAbbreviation(utcDate, srcTz);

    // 源时区元信息
    E.srcMeta.innerHTML =
      '<div><b>' + escapeHtml(srcTz) + '</b> (' + escapeHtml(srcAbbrev) + ') ' + formatOffset(srcOffset) + '</div>' +
      '<div>Unix 时间戳: <b>' + Math.floor(utcDate.getTime() / 1000) + '</b> 秒 / <b>' + utcDate.getTime() + '</b> 毫秒</div>';

    // 目标时区列表
    E.targetList.innerHTML = targets.map((t, i) => {
      const f = formatInTz(utcDate, t.id);
      const offset = getTimezoneOffset(utcDate, t.id);
      const abbrev = getTimezoneAbbreviation(utcDate, t.id);
      const diff = offset - srcOffset;
      const diffStr = diff === 0 ? '同时区' : (diff > 0 ? '快 ' : '慢 ') + formatOffset(Math.abs(diff)).replace('UTC', '');
      return (
        '<div class="tz-target-row">' +
          '<button class="tz-target-row__del" data-del="' + i + '">×</button>' +
          '<div class="tz-target-row__head">' +
            '<select class="tz-input tz-target-row__sel" data-sel="' + i + '">' +
              TIMEZONES.map(tz =>
                '<option value="' + tz.id + '"' + (tz.id === t.id ? ' selected' : '') + '>' + escapeHtml(tz.label) + '</option>'
              ).join('') +
            '</select>' +
            '<span class="tz-target-row__abbrev">' + escapeHtml(abbrev) + '</span>' +
            '<span class="tz-target-row__offset">' + formatOffset(offset) + '</span>' +
          '</div>' +
          '<div class="tz-target-row__time">' + f.time + '</div>' +
          '<div class="tz-target-row__date">' + f.weekday + ' ' + f.date + ' (' + diffStr + ')</div>' +
        '</div>'
      );
    }).join('');

    // 日历对照条
    E.calStrip.innerHTML = targets.map(t => {
      const f = formatInTz(utcDate, t.id);
      return '<div class="tz-cal-item">' +
        '<div class="tz-cal-item__city">' + escapeHtml(t.label) + '</div>' +
        '<div class="tz-cal-item__time">' + f.time + '</div>' +
        '<div class="tz-cal-item__date">' + f.weekday + ' ' + f.date + '</div>' +
      '</div>';
    }).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ==================== 事件 ====================

  // 初始化时区下拉
  fillTzSelect(E.srcTz, detectLocalTz());

  ['srcDate', 'srcTime', 'srcTz'].forEach(k => {
    E[k].addEventListener('input', render);
    E[k].addEventListener('change', render);
  });

  E.btnNow.addEventListener('click', () => {
    const now = new Date();
    const f = formatInTz(now, E.srcTz.value);
    E.srcDate.value = f.date;
    E.srcTime.value = f.time;
    render();
  });

  E.btnSwap.addEventListener('click', () => {
    if (targets.length === 0) return;
    // 把源时区放到目标列表首位，目标的第一个变成源
    const newSrc = targets[0].id;
    targets.shift();
    targets.unshift({ id: E.srcTz.value, label: '' });
    E.srcTz.value = newSrc;
    render();
  });

  E.btnAdd.addEventListener('click', () => {
    targets.push({ id: 'Asia/Shanghai', label: '上海' });
    render();
  });

  E.targetList.addEventListener('change', e => {
    const sel = e.target;
    if (sel.dataset.sel != null) {
      targets[+sel.dataset.sel].id = sel.value;
      render();
    }
  });

  E.targetList.addEventListener('click', e => {
    const btn = e.target.closest('[data-del]');
    if (btn) {
      targets.splice(+btn.dataset.del, 1);
      render();
    }
  });

  E.btnTsToTime.addEventListener('click', () => {
    const raw = E.tsInput.value.trim();
    if (!raw) return;
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    const type = E.tsType.value;
    const ms = type === 's' ? num * 1000 : num;
    const date = new Date(ms);
    const f = formatInTz(date, E.srcTz.value);
    E.srcDate.value = f.date;
    E.srcTime.value = f.time;
    render();
  });

  E.btnTimeToTs.addEventListener('click', () => {
    const utcDate = getCurrentSrcDate();
    const type = E.tsType.value;
    const val = type === 's' ? Math.floor(utcDate.getTime() / 1000) : utcDate.getTime();
    E.tsInput.value = val;
    E.tsInput.select();
    try { navigator.clipboard.writeText(String(val)); } catch (e) {}
  });

  E.btnCopy.addEventListener('click', () => {
    const lines = [];
    const f = formatInTz(getCurrentSrcDate(), E.srcTz.value);
    lines.push(E.srcTz.value + ': ' + f.date + ' ' + f.time);
    targets.forEach(t => {
      const fi = formatInTz(getCurrentSrcDate(), t.id);
      lines.push(t.id + ': ' + fi.date + ' ' + fi.time);
    });
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      E.btnCopy.textContent = '✓';
      setTimeout(() => { E.btnCopy.textContent = '📋'; }, 1200);
    }).catch(() => {});
  });

  // 初始化时间
  E.btnNow.click();
})();
