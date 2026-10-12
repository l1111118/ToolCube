/**
 * Currency Converter Tool - 汇率换算
 *
 * 汇率来源通过 background 的「服务端点」注册表获取（见 common/service-providers.js）：
 * 用户可在「设置 → 服务端点」把汇率类别指向自建服务或更换服务商，本工具无需改动。
 * 全部服务商都不可用时，回退到内置离线汇率表。
 */
document.addEventListener('DOMContentLoaded', () => {
  // ── 与 background 通信（工具运行在扩展页 iframe 中，无 chrome.runtime 直连权限之外的网络能力）──
  let _msgId = 0;
  const _pendingMsgs = new Map();

  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    const data = event.data;
    if (!data || typeof data !== 'object' || !data.__id) return;
    const pending = _pendingMsgs.get(data.__id);
    if (!pending) return;
    _pendingMsgs.delete(data.__id);
    clearTimeout(pending.timer);
    const result = data.result;
    if (data.action === '__bgResponse' && result && result.success === false && result.error) {
      pending.reject(new Error(result.error));
    } else {
      pending.resolve(result);
    }
  });

  function callBackground(action, data) {
    return new Promise((resolve, reject) => {
      const id = ++_msgId;
      const timer = setTimeout(() => {
        _pendingMsgs.delete(id);
        reject(new Error('后台调用超时'));
      }, 70000);
      _pendingMsgs.set(id, { resolve, reject, timer });
      window.parent.postMessage({ action: 'callBackground', data: { id, action, data } }, '*');
    });
  }

  // 内置汇率数据（相对于人民币 CNY），作为离线/请求失败的回退
  const fallbackRates = {
    CNY: 1,       USD: 7.25,   EUR: 7.85,   GBP: 9.15,
    JPY: 0.048,   KRW: 0.0054, HKD: 0.93,   TWD: 0.23,
    AUD: 4.75,    CAD: 5.35,   CHF: 8.10,   SGD: 5.40,
    THB: 0.205,   VND: 0.0003, MYR: 1.55,   PHP: 0.13,
    IDR: 0.00047, INR: 0.087,  RUB: 0.08,   TRY: 0.24,
    BRL: 1.35,    MXN: 0.38,   ZAR: 0.39,   AED: 1.97,
    SAR: 1.93,    NZD: 4.38,   SEK: 0.68,   NOK: 0.67,
    DKK: 1.05,    PLN: 1.78,   CZK: 0.31,   HUF: 0.02,
  };

  const currencyNames = {
    CNY: '人民币', USD: '美元', EUR: '欧元', GBP: '英镑',
    JPY: '日元', KRW: '韩元', HKD: '港币', TWD: '新台币',
    AUD: '澳元', CAD: '加元', CHF: '瑞士法郎', SGD: '新加坡元',
    THB: '泰铢', VND: '越南盾', MYR: '马来西亚林吉特', PHP: '菲律宾比索',
    IDR: '印尼盾', INR: '印度卢比', RUB: '俄罗斯卢布', TRY: '土耳其里拉',
    BRL: '巴西雷亚尔', MXN: '墨西哥比索', ZAR: '南非兰特', AED: '阿联酋迪拉姆',
    SAR: '沙特里亚尔', NZD: '新西兰元', SEK: '瑞典克朗', NOK: '挪威克朗',
    DKK: '丹麦克朗', PLN: '波兰兹罗提', CZK: '捷克克朗', HUF: '匈牙利福林',
  };

  // 实时汇率（相对于 USD），通过 API 获取后填充
  let liveRates = null; // { USD: 1, CNY: 7.2, ... }
  let lastUpdated = null;

  const amountInput = document.getElementById('cu-amount');
  const resultInput = document.getElementById('cu-result');
  const fromSelect = document.getElementById('cu-from');
  const toSelect = document.getElementById('cu-to');
  const rateEl = document.getElementById('cu-rate');
  const favGrid = document.getElementById('cu-fav-grid');
  const updatedEl = document.getElementById('cu-updated');

  // 取得当前 USD 基准的汇率：优先实时数据，回退到内置数据
  // 约定：返回的 rates[cur] 表示「1 USD 等于多少 cur」（与两个实时 API 的返回口径一致）。
  // fallbackRates 的口径是「1 单位货币 = 多少 CNY」，两者互为倒数关系，
  // 因此换算为 usdBased[cur] = fallbackRates.USD / fallbackRates[cur]。
  // （历史缺陷：此处原为 v / fallbackRates.USD，方向取反，导致离线结果偏差约 (7.25)² ≈ 52 倍。）
  function getUsdBasedRates() {
    if (liveRates) return { rates: liveRates, source: 'live' };
    const usdBased = {};
    for (const [cur, v] of Object.entries(fallbackRates)) {
      usdBased[cur] = v > 0 ? fallbackRates.USD / v : 0;
    }
    return { rates: usdBased, source: 'fallback' };
  }

  // 填充下拉框
  const currencies = Object.keys(fallbackRates);
  const optionsHtml = currencies.map(c =>
    `<option value="${c}">${c} - ${currencyNames[c] || c}</option>`
  ).join('');
  fromSelect.innerHTML = optionsHtml;
  toSelect.innerHTML = optionsHtml;

  // 默认: CNY -> USD
  fromSelect.value = 'CNY';
  toSelect.value = 'USD';

  function convert() {
    const amount = parseFloat(amountInput.value) || 0;
    const from = fromSelect.value;
    const to = toSelect.value;

    const { rates, source } = getUsdBasedRates();
    // 备用汇率源（frankfurter / ECB）不覆盖全部币种，缺失时给出明确提示而非静默显示 "--"
    if (!Number.isFinite(rates[from]) || !Number.isFinite(rates[to])) {
      resultInput.value = '--';
      rateEl.textContent = `当前汇率源不包含 ${Number.isFinite(rates[from]) ? to : from}，请点击「刷新」或改用其他币种`;
      return;
    }

    // from -> USD -> to
    const usdAmount = amount / rates[from];
    const result = usdAmount * rates[to];
    resultInput.value = isFinite(result) ? result.toFixed(4) : '--';

    // 显示汇率
    const directRate = rates[to] / rates[from];
    rateEl.textContent = `1 ${from} = ${isFinite(directRate) ? directRate.toFixed(4) : '--'} ${to}` + (source === 'fallback' ? '  (离线数据)' : '');
  }

  amountInput.addEventListener('input', convert);
  fromSelect.addEventListener('change', convert);
  toSelect.addEventListener('change', convert);

  // 互换
  document.getElementById('btn-swap').addEventListener('click', () => {
    const tmp = fromSelect.value;
    fromSelect.value = toSelect.value;
    toSelect.value = tmp;
    convert();
  });

  // 常用货币快捷切换
  const favorites = ['USD', 'EUR', 'GBP', 'JPY', 'KRW', 'HKD', 'TWD', 'AUD', 'CAD', 'SGD', 'THB', 'INR'];
  favGrid.innerHTML = favorites.map(c =>
    `<div class="cu-fav-item" data-currency="${c}">${c} ${currencyNames[c]}</div>`
  ).join('');

  favGrid.querySelectorAll('.cu-fav-item').forEach(item => {
    item.addEventListener('click', () => {
      toSelect.value = item.dataset.currency;
      convert();
    });
  });

  // 手动刷新按钮
  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => fetchLiveRates(true));
  }

  /**
   * 拉取实时汇率
   *
   * 为什么按顺序尝试多个服务商：不同数据源覆盖的币种范围不同（例如 ECB 数据不含
   * TWD / THB 等），单一服务商可能缺少用户需要的币种。因此先用「用户在设置页选定的
   * 服务商」，失败再依次尝试同类别的其他服务商，全部失败才回退内置离线表。
   *
   * @param {boolean} manual 是否由用户手动点击刷新触发（影响提示文案）
   * @returns {Promise<boolean>} 是否成功取到实时汇率
   */
  async function fetchLiveRates(manual = false) {
    if (manual && updatedEl) updatedEl.textContent = '⏳ 正在获取实时汇率...';

    // 取同类别服务商列表用于依次降级；取不到时只尝试用户配置
    let candidates = [''];
    try {
      const meta = await callBackground('serviceProviders', null);
      if (meta && meta.success) {
        candidates = [''].concat((meta.providers || []).filter(p => p.kind === 'currency').map(p => p.id));
      }
    } catch (e) {
      // 注册表不可用时不阻断主流程，仅尝试用户配置的服务商
    }

    const tried = new Set();
    for (const providerId of candidates) {
      if (providerId && tried.has(providerId)) continue;
      let r = null;
      try {
        r = await callBackground('serviceRequest', {
          kind: 'currency',
          params: { base: 'USD' },
          providerId
        });
      } catch (e) {
        r = null;
      }
      if (r && r.meta && r.meta.provider) tried.add(r.meta.provider);
      if (r && r.success && r.data && r.data.rates && Object.keys(r.data.rates).length > 0) {
        liveRates = r.data.rates;
        const parsed = r.data.date ? new Date(r.data.date) : new Date();
        lastUpdated = isNaN(parsed.getTime()) ? new Date() : parsed;
        if (updatedEl) {
          updatedEl.textContent = '✅ 实时汇率 · 更新于 ' + lastUpdated.toLocaleString('zh-CN')
            + (r.meta && r.meta.provider ? ' · ' + r.meta.provider : '');
        }
        convert();
        return true;
      }
    }

    if (updatedEl) updatedEl.textContent = '⚠️ 实时汇率获取失败，使用内置参考汇率';
    convert();
    return false;
  }

  // 启动时尝试获取一次实时汇率
  fetchLiveRates(false);
  // 先用回退数据计算一次，避免等待网络
  convert();

  window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    if (e.data && e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
  });
});
