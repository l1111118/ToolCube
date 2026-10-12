/**
 * 密码强度检测器
 * 纯本地实现：熵计算、字符分析、破解时间估算、强密码生成
 * @version 1.3.0
 */
(function () {
  'use strict';

  window.addEventListener('message',function(e){
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）
if(!e.data||e.source!==window.parent)return;if(e.data&&e.data.action==='setTheme'&&e.data.data)document.documentElement.setAttribute('data-theme',e.data.data.theme);});

  // 常见弱密码字典（扩展版，含 Top 500+ 常见密码及变体）
  const COMMON_PASSWORDS = new Set([
    // Top 100 基础弱密码
    '123456','password','12345678','qwerty','123456789','12345','1234','111111',
    '1234567','dragon','123123','baseball','abc123','football','monkey','letmein',
    '696969','shadow','master','666666','qwertyuiop','123321','mustang','1234567890',
    'michael','654321','superman','1qaz2wsx','7777777','fuckyou','121212','000000',
    'qazwsx','123qwe','killer','trustno1','jordan','jennifer','zxcvbnm','asdfgh',
    'hunter','buster','soccer','harley','batman','andrew','tigger','sunshine',
    'iloveyou','2000','charlie','robert','thomas','hockey','ranger','daniel',
    'starwars','klaster','112233','george','computer','michelle','jessica','pepper',
    '1111','zxcvbn','555555','11111111','131313','freedom','777777','passwd',
    'maggie','159753','aaaaaa','ginger','princess','joshua','cheese','amanda',
    'summer','love','ashley','nicole','chelsea','biteme','matthew','access',
    'yankees','987654321','dallas','austin','thunder','taylor','matrix','mobilemail',
    'mom','monitor','monitoring','montana','moon','moscow','admin','administrator',
    'root','test','guest','welcome','pass','12345678910','password1','p@ssw0rd',
    // 扩展：更多常见密码
    '123','12345a','123456789a','abc','abcd','abcdef','abc12345','aaa','aaaa',
    'aaron','amber','andrea','andy','anthony','apple','april','arthur','asdf',
    'asdfasdf','asdfghjkl','baby','babygirl','badger','barney','barcelona','batista',
    'bear','beatles','beautiful','beaver','bigdog','bigtits','birdie','bitch',
    'black','blaster','blink182','blizzard','blowme','blue','bond007','booboo',
    'booger','boomer','boston','bowwow','brandon','braves','brazil','bronco',
    'browns','bubbles','buddha','buddy','buffalo','butter','butterfly','butthead',
    'cactus','calvin','camaro','cameron','canada','captain','carlos','carter',
    'casper','casino','charles','chevelle','chicago','chicken','chris','christian',
    'christina','christopher','cisco','claire','clayton','killer1','killer12',
    'cocacola','coffee','colts','compaq','cookie','cooper','corona','cowboys',
    'coyote','crystal','cumming','cumshot','cunt','dakota','dammit','damon',
    'david','davis','debbie','dennis','diablo','diamond','digger','dipshit',
    'dolphin','dookie','doom','doodoo','dragon1','dragons','dreams','dustin',
    'eagles','einstein','elephant','enter','erotic','estrella','extreme',
    'falcon','family','famous','father','fear','ferrari','fender','fighter',
    'fishing','florida','flower','flowers','flyers','football1','forever',
    'formula','fortress','france','frank','franklin','fred','freddy','freedom1',
    'fuck','fucked','fucker','fucking','fuckoff','fuckyou1','fun','gandalf',
    'gangsta','garcia','garden','garfield','genius','germany','gibson','goblue',
    'golfer','gordon','great','green','guitar','guns','gunner','hammer',
    'hannah','hardcore','hawaii','hello','hello123','henry','herbert','hidden',
    'hilton','honda','horney','hotdog','house','houston','hugedick','hunter1',
    'iceman','impact','indian','ingrid','ironman','islam','italia','italy',
    'jackie','jackson','jaguar','jasmine','jason','javier','jayson','jazz',
    'jeff','jenny','jeremy','jesus','jewel','jordan23','joseph','joshua1',
    'junior','justin','juwan','karina','katelyn','katie','kelly','kevin',
    'kimberly','knights','lakers','laptop','lauren','leather','legend','lemon',
    'leonardo','liam','light','liverpool','liverpoo','lizard','login','london',
    'london1','lonely','lovers','lucky','lucky1','lunch','madison','madonna',
    'magnum','major','marcus','maria','marines','mark','market','martin',
    'marvin','master1','matrix1','matt','maverick','maxwell','melissa','member',
    'mercedes','merlin','mets','mexico','michael1','michael2','michigan','mickey',
    'mike','miller','mirage','mission','model','money','mondeo','monster',
    'monty','morgan','morris','moses','motor','mountain','mountie','mouse',
    'muffin','murphy','music','mustang1','naked','nascar','nasty','nathan',
    'nature','nelson','netherlands','network','newyork','nicholas','night','nike',
    'nirvana','nissan','norton','notepad','nova','nutter','ocean','oliver',
    'orange','orlando','outlaw','oxford','pacific','pakistan','panda','paradise',
    'paris','parker','password12','password123','password2','patrick','peaches',
    'pearl','penguin','penny','perry','pete','phoenix','phoenix1','pimpin',
    'player','please','polk','polo','popcorn','pork','portal','pprty',
    'predator','prince','python','qaz123','qwe123','qweasd','qweasdzxc','qweewq',
    'rabbit','rachel','raider','railroad','rainbow','rancho','random','raptor',
    'rascal','rebecca','redskins','redsox','redwings','remember','retard','richard',
    'rock','rocket','ronald','rosebud','runner','rusty','russia','saints',
    'salmon','samantha','sammy','samuel','sandra','sandy','santana','sapphire',
    'scarface','school','scooby','scooter','scorpio','scorpion','secret','secure',
    'senior','sergei','sexsex','shadow1','shaggy','shannon','shark','sheila',
    'sierra','silvia','simple','skippy','slayer','smiley','smoke','snake',
    'sniper','snowball','soccer1','soccer2','softball','spanish','sparky','spider',
    'spit','sponge','springer','sprit','stalker','star','starcraft','startrek',
    'steven','sticky','stupid','success','suckit','summer1','sunshine1','super',
    'superstar','surfer','sweetie','swimmer','sydney','tanner','tarzan','tennis',
    'teresa','tester','theking','thomas1','tigers','titanic','tomcat','tool',
    'topgun','toyota','travis','trinity','trouble','trustno','tucker','turtle',
    'tweety','unicorn','unknown','user','valentin','valerie','vampire','victor',
    'victoria','vincent','violet','warrior','water','webmaster','whatever',
    'wheat','whiter','wilson','winner','winston','winter','wizard','wolf',
    'wolfpack','wolves','world','worm','xxx','xxxx','xxxxxx','xxxxxxxx',
    'yamaha','yankee','yankees1','yellow','zombie','zxcvbn1','zzzzzz',
    // 常见 leet-speak 变体
    'p@ssword','p@ssword1','p@ssw0rd1','passw0rd','passw0rd1','p455w0rd',
    'p455w0rd1','adm1n','r00t','t3st','gu3st','w3lc0m3','l0v3','s3cr3t',
    'h4ck3r','h4cker','hack3r','m4st3r','drag0n','m0nk3y','b4tm4n','h3ll0',
    // 常见名字+数字组合
    'john1','john123','mary1','mary123','david1','david123','james1','james123',
    'robert1','robert123','jennifer1','michael1','michael123','william1','william123',
    'richard1','richard123','joseph1','joseph123','thomas1','thomas123',
    'charles1','charles123','christopher1','christopher123','daniel1','daniel123',
    'matthew1','matthew123','anthony1','anthony123','mark1','mark123','donald1',
    // 年份模式
    '2020','2021','2022','2023','2024','2025','1990','1991','1992','1993','1994',
    '1995','1996','1997','1998','1999','1985','1986','1987','1988','1989','1980',
    '1981','1982','1983','1984','2010','2011','2012','2013','2014','2015','2016',
    '2017','2018','2019','password2020','password2021','password2022','password2023'
  ]);

  // 键盘序列
  const KEYBOARD_SEQS = [
    'qwertyuiop','asdfghjkl','zxcvbnm',
    '1234567890','0987654321',
    'qwerty','asdfgh','zxcvbn',
    'qazwsx','qazwsxedc','1qaz2wsx3edc',
    'abcdefghijklmnopqrstuvwxyz',
    'abcdefghijklmnop'
  ];

  // DOM 引用
  const E = {
    input: document.getElementById('pwd-input'),
    btnToggle: document.getElementById('btn-toggle'),
    btnCopy: document.getElementById('btn-copy'),
    btnGenerate: document.getElementById('btn-generate'),
    btnDoGen: document.getElementById('btn-do-generate'),
    genLower: document.getElementById('gen-lower'),
    genUpper: document.getElementById('gen-upper'),
    genDigit: document.getElementById('gen-digit'),
    genSymbol: document.getElementById('gen-symbol'),
    genLen: document.getElementById('gen-len'),
    genNoAmbig: document.getElementById('gen-no-ambiguous'),
    genOutput: document.getElementById('gen-output'),
    meterFill: document.getElementById('meter-fill'),
    badge: document.getElementById('strength-badge'),
    metaLen: document.getElementById('meta-len'),
    metaCharset: document.getElementById('meta-charset'),
    metaEntropy: document.getElementById('meta-entropy'),
    timeOnlineSlow: document.getElementById('time-online-slow'),
    timeOnlineFast: document.getElementById('time-online-fast'),
    timeOfflineSlow: document.getElementById('time-offline-slow'),
    timeOfflineFast: document.getElementById('time-offline-fast'),
    csLower: document.getElementById('cs-lower'),
    csUpper: document.getElementById('cs-upper'),
    csDigit: document.getElementById('cs-digit'),
    csSymbol: document.getElementById('cs-symbol'),
    csCjk: document.getElementById('cs-cjk'),
    csOther: document.getElementById('cs-other'),
    tips: document.getElementById('tips-list'),
    entropyChart: document.getElementById('entropy-chart')
  };

  // 字符集定义
  const CHARSETS = {
    lower: { re: /[a-z]/g, size: 26 },
    upper: { re: /[A-Z]/g, size: 26 },
    digit: { re: /[0-9]/g, size: 10 },
    symbol: { re: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/g, size: 32 },
    cjk: { re: /[\u4e00-\u9fff]/g, size: 20902 }
  };

  /**
   * 分析密码
   */
  function analyze(pwd) {
    const result = {
      length: pwd.length,
      entropy: 0,
      charsetSize: 0,
      charsetCount: 0,
      hasLower: false,
      hasUpper: false,
      hasDigit: false,
      hasSymbol: false,
      hasCjk: false,
      hasOther: false,
      counts: { lower: 0, upper: 0, digit: 0, symbol: 0, cjk: 0, other: 0 },
      isCommon: false,
      hasSequence: false,
      hasRepeat: false,
      level: 0, // 0-5
      score: 0
    };

    if (!pwd) return result;

    // 字符统计
    for (const ch of pwd) {
      if (/[a-z]/.test(ch)) { result.hasLower = true; result.counts.lower++; }
      else if (/[A-Z]/.test(ch)) { result.hasUpper = true; result.counts.upper++; }
      else if (/[0-9]/.test(ch)) { result.hasDigit = true; result.counts.digit++; }
      else if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(ch)) { result.hasSymbol = true; result.counts.symbol++; }
      else if (/[\u4e00-\u9fff]/.test(ch)) { result.hasCjk = true; result.counts.cjk++; }
      else { result.hasOther = true; result.counts.other++; }
    }

    // 计算字符集大小
    let charsetSize = 0;
    if (result.hasLower) charsetSize += 26;
    if (result.hasUpper) charsetSize += 26;
    if (result.hasDigit) charsetSize += 10;
    if (result.hasSymbol) charsetSize += 32;
    if (result.hasCjk) charsetSize += 20902;
    if (result.hasOther) charsetSize += 256; // 其他 Unicode
    result.charsetSize = charsetSize;

    result.charsetCount = [result.hasLower, result.hasUpper, result.hasDigit, result.hasSymbol].filter(Boolean).length;

    // 熵 = L * log2(N)，其中 N 为字符集大小
    if (charsetSize > 0) {
      result.entropy = pwd.length * Math.log2(charsetSize);
    }

    // 常见密码检测
    result.isCommon = COMMON_PASSWORDS.has(pwd.toLowerCase());

    // 键盘序列检测（长度>=4 的连续序列）
    const lowPwd = pwd.toLowerCase();
    for (const seq of KEYBOARD_SEQS) {
      for (let i = 0; i <= seq.length - 4; i++) {
        const chunk = seq.substring(i, i + 4);
        if (lowPwd.includes(chunk)) {
          result.hasSequence = true;
          break;
        }
        // 反向
        const rev = chunk.split('').reverse().join('');
        if (lowPwd.includes(rev)) {
          result.hasSequence = true;
          break;
        }
      }
      if (result.hasSequence) break;
    }

    // 重复字符检测（如 aaaa、1111）
    if (/(.)\1{3,}/.test(pwd)) {
      result.hasRepeat = true;
    }

    // 综合评分 (0-100)
    let score = 0;
    if (pwd.length >= 8) score += 15;
    if (pwd.length >= 12) score += 15;
    if (pwd.length >= 16) score += 10;
    if (result.charsetCount >= 2) score += 10;
    if (result.charsetCount >= 3) score += 10;
    if (result.charsetCount >= 4) score += 10;
    if (result.entropy >= 40) score += 10;
    if (result.entropy >= 60) score += 10;
    if (result.entropy >= 80) score += 10;

    // 减分
    if (result.isCommon) score = Math.min(score, 10);
    if (result.hasSequence) score -= 15;
    if (result.hasRepeat) score -= 10;
    if (pwd.length < 6) score = Math.min(score, 5);

    result.score = Math.max(0, Math.min(100, score));
    // 0-5 等级
    if (result.score < 20) result.level = 1;
    else if (result.score < 40) result.level = 2;
    else if (result.score < 60) result.level = 3;
    else if (result.score < 80) result.level = 4;
    else result.level = 5;

    return result;
  }

  /**
   * 估算破解时间
   * @param {number} entropy bits
   * @param {number} rate guesses per second
   */
  function crackTime(entropy, rate) {
    const guesses = Math.pow(2, entropy) / 2; // 平均情况
    const seconds = guesses / rate;
    return formatDuration(seconds);
  }

  function formatDuration(sec) {
    if (sec < 1) return '瞬间';
    if (sec < 60) return Math.round(sec) + ' 秒';
    if (sec < 3600) return Math.round(sec / 60) + ' 分钟';
    if (sec < 86400) return Math.round(sec / 3600) + ' 小时';
    if (sec < 86400 * 30) return Math.round(sec / 86400) + ' 天';
    if (sec < 86400 * 365) return Math.round(sec / 86400 / 30) + ' 月';
    if (sec < 86400 * 365 * 100) return Math.round(sec / 86400 / 365) + ' 年';
    if (sec < 86400 * 365 * 1e6) return (sec / 86400 / 365 / 1e3).toFixed(1) + ' 千年';
    if (sec < 86400 * 365 * 1e9) return (sec / 86400 / 365 / 1e6).toFixed(1) + ' 百万年';
    if (sec < 86400 * 365 * 1e12) return (sec / 86400 / 365 / 1e9).toFixed(1) + ' 十亿年';
    return '宇宙级安全';
  }

  /**
   * 生成改进建议
   */
  function buildTips(pwd, r) {
    const tips = [];
    if (!pwd) {
      tips.push({ type: 'info', text: '开始输入密码以获取分析' });
      return tips;
    }
    if (r.isCommon) {
      tips.push({ type: 'err', text: '🚨 这是Top100常见弱密码！在密码字典中排名靠前，几秒内即可被破解' });
    }
    if (pwd.length < 8) {
      tips.push({ type: 'err', text: '长度不足 8 位，建议至少 12 位' });
    } else if (pwd.length < 12) {
      tips.push({ type: 'warn', text: '建议长度 12 位以上更安全' });
    } else if (pwd.length >= 16) {
      tips.push({ type: 'ok', text: '✓ 长度优秀' });
    }
    if (!r.hasLower || !r.hasUpper) {
      tips.push({ type: 'warn', text: '混合使用大小写字母' });
    }
    if (!r.hasDigit) {
      tips.push({ type: 'warn', text: '加入数字' });
    }
    if (!r.hasSymbol) {
      tips.push({ type: 'warn', text: '加入特殊符号 (!@#$%^&* 等)' });
    }
    if (r.hasSequence) {
      tips.push({ type: 'err', text: '⚠️ 包含键盘连续序列 (如 qwerty、123)，容易被猜到' });
    }
    if (r.hasRepeat) {
      tips.push({ type: 'err', text: '⚠️ 包含连续重复字符 (如 aaaa、1111)' });
    }
    if (r.charsetCount < 3) {
      tips.push({ type: 'warn', text: '字符种类单一，至少 3 种不同类型' });
    }
    if (r.entropy < 40) {
      tips.push({ type: 'err', text: `熵值过低 (${r.entropy.toFixed(1)} bits)，极易被破解` });
    } else if (r.entropy < 60) {
      tips.push({ type: 'warn', text: `熵值中等 (${r.entropy.toFixed(1)} bits)，仍有提升空间` });
    } else if (r.entropy >= 80) {
      tips.push({ type: 'ok', text: `✓ 熵值很高 (${r.entropy.toFixed(1)} bits)，抗暴力破解能力强` });
    }
    if (pwd.length === pwd.toLowerCase().length && /^[a-z]+$/.test(pwd)) {
      tips.push({ type: 'warn', text: '纯小写字母密码，强度有限' });
    }
    if (/^\d+$/.test(pwd)) {
      tips.push({ type: 'err', text: '⚠️ 纯数字密码极易被破解' });
    }
    // 新增：检测常见替换模式
    if (/[a@][s$][s$][i1][i1]/i.test(pwd) || /p[a@4][s$][s$]w[o0]rd/i.test(pwd)) {
      tips.push({ type: 'err', text: '⚠️ 检测到常见替换模式(如a→@, s→$, o→0)，这不会显著增加安全性' });
    }
    // 新增：包含日期
    if (/(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])/.test(pwd) || /\d{2}\/\d{2}\/\d{4}/.test(pwd)) {
      tips.push({ type: 'warn', text: '⚠️ 检测到日期模式，这会降低密码熵值' });
    }
    // 新增：建议使用密码管理器
    if (r.score < 60) {
      tips.push({ type: 'info', text: '💡 建议使用密码管理器生成并保存强密码，避免重复使用' });
    }
    // 新增：字典攻击说明
    if (r.entropy < 30) {
      tips.push({ type: 'err', text: '⚠️ 熵值极低，即使在线慢速攻击(100次/秒)也可在数分钟内破解' });
    }
    if (tips.length === 0) {
      tips.push({ type: 'ok', text: '✓ 密码强度良好' });
    }
    return tips;
  }

  /**
   * 绘制视觉熵图表
   * 上半部分：熵值水平条（带阈值标记 40/60/80 bits）
   * 下半部分：各字符集熵贡献分解条
   */
  function drawEntropyChart(r) {
    const canvas = E.entropyChart;
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    // 清空画布
    ctx.clearRect(0, 0, W, H);
    if (!r.length) {
      ctx.fillStyle = '#999';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('输入密码后显示熵图表', W / 2, H / 2);
      return;
    }
    // 获取主题色（根据 CSS 变量）
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#ccc' : '#555';
    const bgColor = isDark ? '#2a2a2a' : '#f5f5f5';

    // === 上半部分：熵值水平条 ===
    const barY = 20;
    const barH = 28;
    const barX = 10;
    const barW = W - 20;
    const maxEntropy = 120; // 最大显示 120 bits

    // 绘制背景
    ctx.fillStyle = bgColor;
    ctx.fillRect(barX, barY, barW, barH);

    // 绘制熵值填充（分段着色）
    const entropyPct = Math.min(r.entropy / maxEntropy, 1);
    const fillW = barW * entropyPct;
    // 根据熵值选择颜色
    let entropyColor;
    if (r.entropy < 40) entropyColor = '#ef4444';
    else if (r.entropy < 60) entropyColor = '#f59e0b';
    else if (r.entropy < 80) entropyColor = '#3b82f6';
    else entropyColor = '#22c55e';
    ctx.fillStyle = entropyColor;
    ctx.fillRect(barX, barY, fillW, barH);

    // 绘制阈值标记线（40/60/80）
    const thresholds = [40, 60, 80];
    ctx.strokeStyle = isDark ? '#666' : '#999';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const t of thresholds) {
      const x = barX + (barW * t / maxEntropy);
      ctx.beginPath();
      ctx.moveTo(x, barY - 4);
      ctx.lineTo(x, barY + barH + 4);
      ctx.stroke();
      // 标签
      ctx.fillStyle = textColor;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t + '', x, barY + barH + 14);
    }
    ctx.setLineDash([]);

    // 绘制熵值文字
    ctx.fillStyle = isDark ? '#fff' : '#333';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('熵: ' + r.entropy.toFixed(1) + ' bits', barX + 6, barY + 18);

    // === 下半部分：各字符集熵贡献 ===
    const breakdownY = 70;
    const breakdownH = 70;
    // 计算各字符集的熵贡献
    const contributions = [];
    if (r.hasLower) contributions.push({ label: 'a-z', count: r.counts.lower, setSize: 26, color: '#3b82f6' });
    if (r.hasUpper) contributions.push({ label: 'A-Z', count: r.counts.upper, setSize: 26, color: '#8b5cf6' });
    if (r.hasDigit) contributions.push({ label: '0-9', count: r.counts.digit, setSize: 10, color: '#f59e0b' });
    if (r.hasSymbol) contributions.push({ label: '!@#', count: r.counts.symbol, setSize: 32, color: '#ef4444' });
    if (r.hasCjk) contributions.push({ label: '中文', count: r.counts.cjk, setSize: 20902, color: '#22c55e' });
    if (r.hasOther) contributions.push({ label: '其他', count: r.counts.other, setSize: 256, color: '#ec4899' });

    if (contributions.length === 0) return;

    // 标题
    ctx.fillStyle = textColor;
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('字符集熵贡献分解', barX, breakdownY - 4);

    // 绘制每个字符集的贡献条
    const itemH = 16;
    const itemGap = 2;
    const labelW = 36;
    const barStartX = barX + labelW;
    const barMaxW = W - barStartX - 60; // 留出数值显示空间

    // 找到最大贡献值用于归一化
    const maxContrib = Math.max.apply(null, contributions.map(function(c) {
      return c.count > 0 ? c.count * Math.log2(c.setSize) : 0;
    }));

    for (var i = 0; i < contributions.length; i++) {
      var c = contributions[i];
      var y = breakdownY + i * (itemH + itemGap);
      var contrib = c.count > 0 ? c.count * Math.log2(c.setSize) : 0;
      var w = maxContrib > 0 ? (barMaxW * contrib / maxContrib) : 0;

      // 标签
      ctx.fillStyle = textColor;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(c.label, barX, y + 12);

      // 背景条
      ctx.fillStyle = bgColor;
      ctx.fillRect(barStartX, y, barMaxW, itemH);

      // 填充条
      ctx.fillStyle = c.color;
      ctx.fillRect(barStartX, y, w, itemH);

      // 数值
      ctx.fillStyle = textColor;
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(contrib.toFixed(1) + 'b', barStartX + barMaxW + 4, y + 12);
    }
  }

  /**
   * 渲染结果
   */
  function render() {
    const pwd = E.input.value;
    const r = analyze(pwd);

    // 强度条
    const widths = ['0%', '20%', '40%', '60%', '80%', '100%'];
    E.meterFill.style.width = widths[r.level];
    E.meterFill.className = 'ps-meter__fill s' + r.level;

    const labels = ['', '极弱', '较弱', '中等', '良好', '极强'];
    E.badge.textContent = labels[r.level] || '未评估';
    E.badge.className = 'ps-strength-badge s' + r.level;

    // 元信息
    E.metaLen.textContent = r.length;
    E.metaCharset.textContent = r.charsetCount;
    E.metaEntropy.textContent = r.entropy.toFixed(2);

    // 破解时间估算
    // rate 单位为 次/秒；UI 标注 100/H 即 100次/小时，需换算为 100/3600 次/秒
    E.timeOnlineSlow.textContent = r.entropy > 0 ? crackTime(r.entropy, 100 / 3600) : '-';
    E.timeOnlineFast.textContent = r.entropy > 0 ? crackTime(r.entropy, 1e1) : '-';
    E.timeOfflineSlow.textContent = r.entropy > 0 ? crackTime(r.entropy, 1e10) : '-';
    E.timeOfflineFast.textContent = r.entropy > 0 ? crackTime(r.entropy, 1e11) : '-';

    // 字符组成
    E.csLower.textContent = r.counts.lower;
    E.csUpper.textContent = r.counts.upper;
    E.csDigit.textContent = r.counts.digit;
    E.csSymbol.textContent = r.counts.symbol;
    E.csCjk.textContent = r.counts.cjk;
    E.csOther.textContent = r.counts.other;

    // 建议
    const tips = buildTips(pwd, r);
    E.tips.innerHTML = tips.map(t => '<li class="ps-tip ps-tip--' + t.type + '">' + escapeHtml(t.text) + '</li>').join('');

    // 绘制视觉熵图表
    drawEntropyChart(r);
  }

  /**
   * 强密码生成
   */
  function generatePassword(len, opts) {
    const LOWER = 'abcdefghijklmnopqrstuvwxyz';
    const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const DIGIT = '0123456789';
    const SYMBOL = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const AMBIGUOUS = 'Il1O0oB8S5Z2G6';

    let pool = '';
    const required = [];
    if (opts.lower) { pool += LOWER; required.push(pick(LOWER)); }
    if (opts.upper) { pool += UPPER; required.push(pick(UPPER)); }
    if (opts.digit) { pool += DIGIT; required.push(pick(DIGIT)); }
    if (opts.symbol) { pool += SYMBOL; required.push(pick(SYMBOL)); }
    if (!pool) return '';

    if (opts.noAmbig) {
      pool = pool.split('').filter(c => !AMBIGUOUS.includes(c)).join('');
    }

    const chars = [...required];
    while (chars.length < len) {
      chars.push(pool[secureRandom(pool.length)]);
    }
    // Fisher-Yates shuffle
    for (let i = chars.length - 1; i > 0; i--) {
      const j = secureRandom(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  function pick(s) { return s[secureRandom(s.length)]; }

  function secureRandom(max) {
    if (max <= 0) return 0;
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] % max;
    }
    return Math.floor(Math.random() * max);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function showToast(msg) {
    // 简化：用 badge 临时显示状态
    const original = E.badge.textContent;
    E.badge.textContent = msg;
    setTimeout(() => { render(); }, 1200);
  }

  // ==================== 事件绑定 ====================
  E.input.addEventListener('input', render);

  E.btnToggle.addEventListener('click', () => {
    E.input.type = E.input.type === 'password' ? 'text' : 'password';
  });

  E.btnCopy.addEventListener('click', () => {
    const v = E.input.value;
    if (!v) return;
    navigator.clipboard.writeText(v).then(() => {
      showToast('已复制');
    }).catch(() => {
      showToast('复制失败');
    });
  });

  function doGen() {
    const opts = {
      lower: E.genLower.checked,
      upper: E.genUpper.checked,
      digit: E.genDigit.checked,
      symbol: E.genSymbol.checked,
      noAmbig: E.genNoAmbig.checked
    };
    const len = Math.max(6, Math.min(64, parseInt(E.genLen.value, 10) || 20));
    const pwd = generatePassword(len, opts);
    if (!pwd) {
      showToast('请至少选择一种字符');
      return;
    }
    E.genOutput.value = pwd;
    E.input.value = pwd;
    E.input.type = 'text';
    render();
  }

  E.btnGenerate.addEventListener('click', doGen);
  E.btnDoGen.addEventListener('click', doGen);

  E.genOutput.addEventListener('click', () => {
    if (!E.genOutput.value) return;
    navigator.clipboard.writeText(E.genOutput.value).then(() => {
      showToast('已复制');
    }).catch(() => {});
  });

  // 初始化
  render();
})();
