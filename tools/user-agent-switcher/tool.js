/**
 * User-Agent 切换器
 * 通过 declarativeNetRequest 动态修改请求头
 */
(function(){
'use strict';

const UAS = [
  {
    group: '桌面浏览器',
    items: [
      { name: 'Chrome (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36', desc: 'Chrome 137 · Win10' },
      { name: 'Chrome (macOS)', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36', desc: 'Chrome 137 · macOS' },
      { name: 'Chrome (Linux)', ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36', desc: 'Chrome 137 · Linux' },
      { name: 'Firefox (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0', desc: 'Firefox 139 · Win10' },
      { name: 'Firefox (macOS)', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:139.0) Gecko/20100101 Firefox/139.0', desc: 'Firefox 139 · macOS' },
      { name: 'Firefox (Linux)', ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0', desc: 'Firefox 139 · Linux' },
      { name: 'Safari (macOS)', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', desc: 'Safari 18 · macOS' },
      { name: 'Edge (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0', desc: 'Edge 137 · Win10' },
      { name: 'Edge (macOS)', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0', desc: 'Edge 137 · macOS' },
      { name: 'Opera (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 OPR/122.0.0.0', desc: 'Opera 122 · Win10' },
      { name: 'Brave (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36', desc: 'Brave 137 · Win10' },
      { name: 'Vivaldi (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Vivaldi/7.3', desc: 'Vivaldi 7.3 · Win10' }
    ]
  },
  {
    group: '移动设备',
    items: [
      { name: 'iPhone Safari', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', desc: 'iOS 18 · iPhone' },
      { name: 'iPhone Chrome', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/137.0.6919.26 Mobile/15E148 Safari/604.1', desc: 'iOS 18 · Chrome' },
      { name: 'iPad Safari', ua: 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1', desc: 'iOS 18 · iPad' },
      { name: 'Android Chrome', ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36', desc: 'Android 15 · Pixel 9' },
      { name: 'Android Firefox', ua: 'Mozilla/5.0 (Android 15; Mobile; rv:139.0) Gecko/139.0 Firefox/139.0', desc: 'Android 15 · Firefox' },
      { name: 'Android WebView', ua: 'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36', desc: 'Android 15 · Galaxy S24' },
      { name: 'Android Tablet', ua: 'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36', desc: 'Android 14 · Galaxy Tab' },
      { name: 'HarmonyOS', ua: 'Mozilla/5.0 (Linux; Android 12; HarmonyOS; PCT-AL10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/14.0.5.301 Mobile Safari/537.36', desc: 'HarmonyOS · 华为' }
    ]
  },
  {
    group: '搜索引擎/爬虫',
    items: [
      { name: 'Googlebot', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', desc: '桌面 · 爬虫' },
      { name: 'Googlebot Mobile', ua: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', desc: '移动 · 爬虫' },
      { name: 'Baiduspider', ua: 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)', desc: '百度 · 爬虫' },
      { name: 'Bingbot', ua: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', desc: '必应 · 爬虫' },
      { name: 'YandexBot', ua: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)', desc: 'Yandex · 爬虫' },
      { name: 'DuckDuckBot', ua: 'Mozilla/5.0 (compatible; DuckDuckBot/1.1; +http://duckduckgo.com/duckduckbot.html)', desc: 'DuckDuckGo · 爬虫' },
      { name: 'Sogou Spider', ua: 'Mozilla/5.0 (compatible; Sogou web spider/4.0; +http://www.sogou.com/docs/help/webmasters.htm#07)', desc: '搜狗 · 爬虫' },
      { name: 'Bingbot Mobile', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', desc: '必应 · 移动爬虫' },
      { name: 'Applebot', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)', desc: 'Apple · 爬虫' }
    ]
  },
  {
    group: '社交媒体/链接预览',
    items: [
      { name: 'FacebookBot', ua: 'Mozilla/5.0 (compatible; FacebookBot/1.0; +http://www.facebook.com/externalhit_uatext.php)', desc: 'Facebook · 链接预览' },
      { name: 'Twitterbot', ua: 'Mozilla/5.0 (compatible; Twitterbot/1.0)', desc: 'Twitter · 链接预览' },
      { name: 'LinkedIn Bot', ua: 'Mozilla/5.0 (compatible; LinkedInBot/1.0; +http://www.linkedin.com)', desc: 'LinkedIn · 链接预览' },
      { name: 'Slackbot', ua: 'Mozilla/5.0 (compatible; Slackbot-LinkExpanding 1.0; +https://api.slack.com/robots)', desc: 'Slack · 链接预览' },
      { name: 'TelegramBot', ua: 'Mozilla/5.0 (compatible; TelegramBot)', desc: 'Telegram · 链接预览' },
      { name: 'WhatsApp', ua: 'Mozilla/5.0 (compatible; WhatsApp/2.23.20.0)', desc: 'WhatsApp · 链接预览' },
      { name: 'Discord Bot', ua: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', desc: 'Discord · 链接预览' }
    ]
  },
  {
    group: 'SEO 分析工具',
    items: [
      { name: 'AhrefsBot', ua: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', desc: 'Ahrefs · SEO 爬虫' },
      { name: 'SemrushBot', ua: 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)', desc: 'Semrush · SEO 爬虫' },
      { name: 'MJ12bot', ua: 'Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)', desc: 'Majestic · SEO 爬虫' },
      { name: 'DotBot', ua: 'Mozilla/5.0 (compatible; DotBot/1.2; +https://opensiteexplorer.org/dotbot; help@moz.com)', desc: 'Moz · SEO 爬虫' },
      { name: 'PetBot', ua: 'Mozilla/5.0 (compatible; PetalBot;+https://webmaster.petalsearch.com/site/petalbot)', desc: 'Petal · SEO 爬虫' }
    ]
  },
  {
    group: '特殊环境',
    items: [
      { name: '微信内置', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.54(0x1800362f) NetType/WIFI Language/zh_CN', desc: 'iOS · 微信' },
      { name: '微信安卓', ua: 'Mozilla/5.0 (Linux; Android 15; SM-S928B Build/AP3A.241105.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.0.0 Mobile Safari/537.36 MMWEBID/1234 MicroMessenger/8.0.54.2700(0x2800365b)', desc: 'Android · 微信' },
      { name: 'QQ内置', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 QQ/9.1.5', desc: 'iOS · QQ' },
      { name: '钉钉', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 DingTalk/7.6.0', desc: 'iOS · 钉钉' },
      { name: '支付宝', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AlipayClient/10.6.50.8000', desc: 'iOS · 支付宝' },
      { name: '命令行 curl', ua: 'curl/8.12.0', desc: 'Linux curl 8.12' },
      { name: 'Python requests', ua: 'python-requests/2.32.0', desc: 'Python requests 2.32' },
      { name: 'Wget', ua: 'Wget/1.25.0 (linux-gnu)', desc: 'Linux wget 1.25' },
      { name: 'Postman', ua: 'PostmanRuntime/7.42.0', desc: 'Postman 7.42' },
      { name: 'Electron', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) MyElectronApp/1.0.0 Chrome/137.0.0.0 Electron/35.0.0 Safari/537.36', desc: 'Electron 35 · 桌面应用' },
      { name: 'PowerShell', ua: 'Mozilla/5.0 (Windows NT; Windows NT 10.0; en-US) WindowsPowerShell/5.1.22621.4111', desc: 'PowerShell 5.1' }
    ]
  }
];

const $list = document.getElementById('uas-list');
const $current = document.getElementById('uas-current-value');
const $active = document.getElementById('uas-active');
const $custom = document.getElementById('uas-custom');

function call(action, data) {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve({ success: false, error: 'Timeout' });
    }, 5000);
    const handler = (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

      if (!e.data || e.source !== window.parent) return;
      if (e.data && e.data.action === '__bgResponse' && e.data.data && e.data.data.__id === id) {
        clearTimeout(timer);
        window.removeEventListener('message', handler);
        resolve(e.data.data.result);
      }
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ action: 'callBackground', data: { id, action, data } }, '*');
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function render() {
  $list.innerHTML = UAS.map((group) => `
    <div class="uas-group-title">${escapeHtml(group.group)}</div>
    ${group.items.map((item, i) => `
      <div class="uas-item" data-ua="${encodeURIComponent(item.ua)}" data-name="${encodeURIComponent(item.name)}">
        <div class="uas-item-title">
          <span>${escapeHtml(item.name)}</span>
          <span class="uas-item-badge">${escapeHtml(item.desc)}</span>
        </div>
        <div class="uas-item-desc">${escapeHtml(item.ua)}</div>
      </div>
    `).join('')}
  `).join('');
  $list.querySelectorAll('.uas-item').forEach((el) => {
    el.addEventListener('click', async () => {
      const ua = decodeURIComponent(el.dataset.ua);
      const name = decodeURIComponent(el.dataset.name);
      await applyUA(ua, name);
    });
  });
}

async function applyUA(ua, label) {
  const r = await call('setDeclarativeRule', { userAgent: ua });
  if (r && r.success) {
    $active.textContent = '✅ 状态: 已启用 - ' + (label || '自定义');
    $active.style.color = 'var(--tt-success)';
    $list.querySelectorAll('.uas-item').forEach(el => {
      const isActive = decodeURIComponent(el.dataset.ua) === ua;
      el.classList.toggle('uas-item--active', isActive);
    });
  } else {
    $active.textContent = '❌ 设置失败: ' + (r?.error || '未知错误');
    $active.style.color = 'var(--tt-danger)';
  }
}

async function resetUA() {
  const r = await call('clearDeclarativeRules');
  if (r && r.success) {
    $active.textContent = '✅ 状态: 默认';
    $active.style.color = 'var(--tt-success)';
    $list.querySelectorAll('.uas-item').forEach(el => el.classList.remove('uas-item--active'));
  }
}

document.getElementById('uas-apply-custom').addEventListener('click', async () => {
  const v = $custom.value.trim();
  if (!v) return;
  await applyUA(v, '自定义');
});
document.getElementById('uas-reset').addEventListener('click', resetUA);

// UA随机化
document.getElementById('uas-random').addEventListener('click', async () => {
  var allUAs = [];
  UAS.forEach(function(group) { group.items.forEach(function(item) { allUAs.push(item); }); });
  var randomItem = allUAs[Math.floor(Math.random() * allUAs.length)];
  await applyUA(randomItem.ua, randomItem.name + ' (随机)');
});

// 范围切换：当前页面 / 全局
var scopeSelect = document.getElementById('uas-scope');
var currentScope = 'global'; // 默认全局
if (scopeSelect) {
  scopeSelect.addEventListener('change', function() {
    currentScope = this.value;
  });
}

// 增强applyUA，支持scope
var _origApplyUA = applyUA;
applyUA = async function(ua, label) {
  var scope = currentScope || 'global';
  var r;
  if (scope === 'tab') {
    // 仅当前标签页 - 使用tabId特定规则
    r = await call('setDeclarativeRule', { userAgent: ua, tabOnly: true });
  } else {
    r = await call('setDeclarativeRule', { userAgent: ua, tabOnly: false });
  }
  if (r && r.success) {
    $active.textContent = '✅ 状态: 已启用 - ' + (label || '自定义') + (scope === 'tab' ? ' (仅当前页面)' : ' (全局)');
    $active.style.color = 'var(--tt-success)';
    $list.querySelectorAll('.uas-item').forEach(el => {
      const isActive = decodeURIComponent(el.dataset.ua) === ua;
      el.classList.toggle('uas-item--active', isActive);
    });
  } else {
    $active.textContent = '❌ 设置失败: ' + (r?.error || '未知错误');
    $active.style.color = 'var(--tt-danger)';
  }
};

// 初始化时读取当前生效规则，恢复高亮状态
async function initCurrentUA() {
  try {
    const r = await call('getCurrentUA');
    if (r && r.success && r.ua) {
      $active.textContent = '✅ 状态: 已启用';
      $active.style.color = 'var(--tt-success)';
      $current.textContent = r.ua;
      $list.querySelectorAll('.uas-item').forEach(el => {
        const isActive = decodeURIComponent(el.dataset.ua) === r.ua;
        el.classList.toggle('uas-item--active', isActive);
      });
    } else {
      $active.textContent = '✅ 状态: 默认';
      $active.style.color = 'var(--tt-success)';
    }
  } catch (e) {
    $active.textContent = '✅ 状态: 默认';
    $active.style.color = 'var(--tt-success)';
  }
}
initCurrentUA();

window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data && e.data.action === 'setTheme' && e.data.data) document.documentElement.setAttribute('data-theme', e.data.data.theme);
});

// 显示真实 navigator UA（仅作为参考，扩展实际修改的是后续请求的 UA）
try {
  $current.textContent = navigator.userAgent;
} catch (e) {}

render();
})();
