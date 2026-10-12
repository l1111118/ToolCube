/**
 * 自定义请求头 - Custom Headers
 * 添加、修改或删除 HTTP 请求头
 */
document.addEventListener('DOMContentLoaded', () => {
  const $master = document.getElementById('ch-master');
  const $status = document.getElementById('ch-status');
  const $rules = document.getElementById('ch-rules');
  const $addRule = document.getElementById('ch-add-rule');
  const $toast = document.getElementById('toast');
  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(e => { console.warn('[custom-headers] safeSend error:', e); }); }
  function safeStorage(op, ...args) { if (!isCtxValid()) return op === 'get' ? Promise.resolve({}) : Promise.resolve(); try { return chrome.storage.local[op](...args); } catch(e) { console.warn('[custom-headers] safeStorage error:', e); return op === 'get' ? Promise.resolve({}) : Promise.resolve(); } }

  let rules = [];

  function showToast(msg, type) {
    type = type || 'info';
    $toast.textContent = msg;
    $toast.className = 'toast toast--' + type;
    $toast.classList.add('toast--show');
    clearTimeout($toast._tm);
    $toast._tm = setTimeout(() => $toast.classList.remove('toast--show'), 3000);
  }

  function saveToHistory(data) {
    try {
      safeSend({
        action: 'saveToHistory',
        data: { toolId: 'custom-headers', type: 'headers', data }
      });
    } catch (e) {}
  }

  function updateStatus(enabled) {
    if (enabled) {
      $status.textContent = '已启用';
      $status.classList.add('ch-status--active');
    } else {
      $status.textContent = '未启用';
      $status.classList.remove('ch-status--active');
    }
  }

  function collectRules() {
    const result = [];
    $rules.querySelectorAll('.ch-rule').forEach(el => {
      const name = el.querySelector('.ch-rule-name').value.trim();
      const value = el.querySelector('.ch-rule-value').value.trim();
      const op = el.querySelector('.ch-rule-op').value;
      const applyTo = el.querySelector('.ch-rule-apply').value;
      const pattern = el.querySelector('.ch-rule-pattern').value.trim();
      if (name) {
        result.push({ name, value, op, applyTo, pattern });
      }
    });
    return result;
  }

  function renderRules() {
    $rules.innerHTML = rules.map((rule, i) => `
      <div class="ch-rule" data-index="${i}">
        <div class="ch-rule-row">
          <span class="ch-rule-label">名称</span>
          <input type="text" class="ch-input ch-rule-name" value="${escapeAttr(rule.name)}" placeholder="Header-Name">
          <span class="ch-rule-label">值</span>
          <input type="text" class="ch-input ch-rule-value" value="${escapeAttr(rule.value)}" placeholder="Header-Value">
        </div>
        <div class="ch-rule-row">
          <span class="ch-rule-label">操作</span>
          <select class="ch-select ch-rule-op">
            <option value="set" ${rule.op === 'set' ? 'selected' : ''}>设置</option>
            <option value="remove" ${rule.op === 'remove' ? 'selected' : ''}>删除</option>
          </select>
          <span class="ch-rule-label">应用</span>
          <select class="ch-select ch-rule-apply">
            <option value="all" ${rule.applyTo === 'all' ? 'selected' : ''}>所有URL</option>
            <option value="pattern" ${rule.applyTo === 'pattern' ? 'selected' : ''}>匹配URL模式</option>
          </select>
          <input type="text" class="ch-input ch-rule-pattern" value="${escapeAttr(rule.pattern)}" placeholder="*://*.example.com/*" style="display:${rule.applyTo === 'pattern' ? 'block' : 'none'}">
          <button class="ch-rule-delete">删除</button>
        </div>
      </div>
    `).join('');

    $rules.querySelectorAll('.ch-rule').forEach(el => {
      el.querySelector('.ch-rule-delete').addEventListener('click', () => {
        const idx = parseInt(el.dataset.index, 10);
        rules.splice(idx, 1);
        renderRules();
        if ($master.checked) applySettings();
      });
      el.querySelector('.ch-rule-apply').addEventListener('change', (e) => {
        const patternInput = el.querySelector('.ch-rule-pattern');
        patternInput.style.display = e.target.value === 'pattern' ? 'block' : 'none';
      });
      el.querySelectorAll('input, select').forEach(input => {
        input.addEventListener('change', () => {
          if ($master.checked) applySettings();
        });
      });
    });
  }

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * 收集规则并下发到后台。
   *
   * 这里必须使用**带校验**的收集逻辑：旧实现把 applySettings 在文件后半段整体替换为
   * 校验版本，但 `$master.addEventListener('change', applySettings)` 早在前半段就绑定了
   * **原始函数对象**，因此用总开关启用时走的仍是不校验的旧路径，非法请求头会被直接下发。
   * 现在只保留一个实现，绑定与调用完全一致。
   */
  function applySettings() {
    const enabled = $master.checked;
    updateStatus(enabled);
    rules = collectRulesWithValidation();
    if (rules.length === 0 && $rules.querySelectorAll('.ch-rule').length > 0) {
      showToast('存在无效规则，请检查', 'error');
      return;
    }
    if (enabled) {
      // 转换为 background.js 期望的格式
      const bgRules = rules.map(r => ({
        urlFilter: r.applyTo === 'pattern' && r.pattern ? r.pattern : '*',
        headers: [{ header: r.name, operation: r.op, value: r.value }]
      }));
      safeSend({
        action: 'customHeaders_enable',
        data: { rules: bgRules }
      });
      showToast('自定义请求头已启用 (' + rules.length + ' 条规则)', 'success');
      saveToHistory({ enabled: true, ruleCount: rules.length });
    } else {
      safeSend({ action: 'customHeaders_disable' });
      showToast('自定义请求头已关闭', 'info');
      saveToHistory({ enabled: false });
    }
  }

  $master.addEventListener('change', applySettings);

  $addRule.addEventListener('click', () => {
    rules.push({ name: '', value: '', op: 'set', applyTo: 'all', pattern: '' });
    renderRules();
  });

  document.querySelectorAll('.ch-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = {
        name: btn.dataset.name,
        value: btn.dataset.value,
        op: btn.dataset.op,
        applyTo: btn.dataset.apply,
        pattern: btn.dataset.pattern
      };
      const existing = rules.findIndex(r => r.name === preset.name);
      if (existing >= 0) {
        rules[existing] = preset;
      } else {
        rules.push(preset);
      }
      renderRules();
      showToast('已应用预设: ' + preset.name, 'success');
      if ($master.checked) applySettings();
    });
  });

  async function loadSavedState() {
    try {
      const result = await safeStorage('get', 'toolbox_custom_headers');
      const config = result.toolbox_custom_headers;
      if (config) {
        if (config.enabled) {
          $master.checked = true;
          updateStatus(true);
        }
        if (config.rules && config.rules.length) {
          // 兼容两种格式：简单格式 {name, value, op, applyTo, pattern} 和 background 格式 {urlFilter, headers: [...]}
          rules = config.rules.map(rule => {
            if (rule.headers && Array.isArray(rule.headers)) {
              // background 格式 → 转换为简单格式供 UI 使用
              const h = rule.headers[0] || {};
              return {
                name: h.header || '',
                value: h.value || '',
                op: h.operation || 'set',
                applyTo: rule.urlFilter && rule.urlFilter !== '*' ? 'pattern' : 'all',
                pattern: rule.urlFilter && rule.urlFilter !== '*' ? rule.urlFilter : ''
              };
            }
            return rule;
          });
        }
        renderRules();
      }
    } catch (e) {}
  }

  // ── Preset Header Templates ──
  const HEADER_TEMPLATES = {
    security: {
      label: '🔒 常用安全头',
      rules: [
        { name: 'X-Content-Type-Options', value: 'nosniff', op: 'set', applyTo: 'all', pattern: '' },
        { name: 'X-Frame-Options', value: 'SAMEORIGIN', op: 'set', applyTo: 'all', pattern: '' },
        { name: 'X-XSS-Protection', value: '1; mode=block', op: 'set', applyTo: 'all', pattern: '' },
        { name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin', op: 'set', applyTo: 'all', pattern: '' }
      ]
    },
    cors: {
      label: '🌐 CORS 头',
      rules: [
        { name: 'Access-Control-Allow-Origin', value: '*', op: 'set', applyTo: 'all', pattern: '' },
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS', op: 'set', applyTo: 'all', pattern: '' },
        { name: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization', op: 'set', applyTo: 'all', pattern: '' }
      ]
    },
    auth: {
      label: '🔑 认证头',
      rules: [
        { name: 'Authorization', value: 'Bearer YOUR_TOKEN_HERE', op: 'set', applyTo: 'pattern', pattern: '*://api.example.com/*' }
      ]
    },
    api: {
      label: '🔌 API 测试头',
      rules: [
        { name: 'Content-Type', value: 'application/json', op: 'set', applyTo: 'all', pattern: '' },
        { name: 'Accept', value: 'application/json', op: 'set', applyTo: 'all', pattern: '' },
        { name: 'X-API-Key', value: 'YOUR_API_KEY', op: 'set', applyTo: 'pattern', pattern: '*://api.example.com/*' },
        { name: 'X-Requested-With', value: 'XMLHttpRequest', op: 'set', applyTo: 'all', pattern: '' }
      ]
    },
    cache: {
      label: '⚡ 缓存控制',
      rules: [
        { name: 'Cache-Control', value: 'no-cache, no-store, must-revalidate', op: 'set', applyTo: 'all', pattern: '' },
        { name: 'Pragma', value: 'no-cache', op: 'set', applyTo: 'all', pattern: '' },
        { name: 'Expires', value: '0', op: 'set', applyTo: 'all', pattern: '' }
      ]
    },
    debug: {
      label: '🐛 调试头',
      rules: [
        { name: 'X-Debug', value: 'true', op: 'set', applyTo: 'pattern', pattern: '*://*.example.com/*' },
        { name: 'X-Request-ID', value: '', op: 'set', applyTo: 'all', pattern: '' }
      ]
    },
    mobile: {
      label: '📱 移动端伪装',
      rules: [
        { name: 'User-Agent', value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', op: 'set', applyTo: 'all', pattern: '' }
      ]
    }
  };

  function renderTemplateButtons() {
    let tplEl = document.getElementById('ch-templates');
    if (!tplEl) {
      tplEl = document.createElement('div');
      tplEl.id = 'ch-templates';
      tplEl.style.cssText = 'margin:8px 0;padding:8px;border:1px solid var(--tt-border);border-radius:6px;font-size:12px;background:var(--tt-bg-secondary);';
      $addRule.parentElement.insertBefore(tplEl, $addRule);
    }
    tplEl.innerHTML = '<div style="font-weight:bold;margin-bottom:6px;">📦 预设头模板</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
      Object.entries(HEADER_TEMPLATES).map(([key, tpl]) =>
        '<button class="btn ch-tpl-btn" data-tpl="' + key + '" style="font-size:11px;padding:4px 8px;">' + tpl.label + '</button>'
      ).join('') +
      '</div>';

    tplEl.querySelectorAll('.ch-tpl-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tpl = HEADER_TEMPLATES[btn.dataset.tpl];
        if (!tpl) return;
        tpl.rules.forEach(r => {
          const existing = rules.findIndex(rule => rule.name === r.name);
          if (existing >= 0) { rules[existing] = { ...r }; }
          else { rules.push({ ...r }); }
        });
        renderRules();
        showToast('已应用模板: ' + tpl.label, 'success');
        if ($master.checked) applySettings();
      });
    });
  }

  // ── Import/Export ──
  function renderImportExport() {
    let ieEl = document.getElementById('ch-import-export');
    if (!ieEl) {
      ieEl = document.createElement('div');
      ieEl.id = 'ch-import-export';
      ieEl.style.cssText = 'margin:8px 0;padding:8px;border:1px solid var(--tt-border);border-radius:6px;font-size:12px;background:var(--tt-bg-secondary);';
      $addRule.parentElement.appendChild(ieEl);
    }
    ieEl.innerHTML = '<div style="display:flex;gap:8px;">' +
      '<button class="btn" id="ch-export-btn" style="font-size:11px;padding:4px 8px;">📤 导出规则 (JSON)</button>' +
      '<button class="btn" id="ch-import-btn" style="font-size:11px;padding:4px 8px;">📥 导入规则 (JSON)</button>' +
      '<input type="file" id="ch-import-file" accept=".json" style="display:none;">' +
    '</div>';

    document.getElementById('ch-export-btn').addEventListener('click', () => {
      const currentRules = collectRules();
      const json = JSON.stringify(currentRules, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'custom-headers-rules.json'; a.click();
      URL.revokeObjectURL(url);
      showToast('规则已导出', 'success');
    });

    document.getElementById('ch-import-btn').addEventListener('click', () => {
      document.getElementById('ch-import-file').click();
    });

    document.getElementById('ch-import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (Array.isArray(imported)) {
            imported.forEach(r => {
              if (r.name) rules.push({ name: r.name || '', value: r.value || '', op: r.op || 'set', applyTo: r.applyTo || 'all', pattern: r.pattern || '' });
            });
            renderRules();
            showToast('已导入 ' + imported.length + ' 条规则', 'success');
            if ($master.checked) applySettings();
          } else {
            showToast('无效的 JSON 格式', 'error');
          }
        } catch (err) {
          showToast('JSON 解析失败: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    });
  }

  // ── Header Value Validation ──
  function validateHeaderValue(name, value) {
    if (!name) return '请求头名称不能为空';
    // Check for invalid characters in header name
    if (/[^\x21-\x39\x3B-\x7E]/.test(name)) return '请求头名称包含非法字符';
    if (name.includes(':')) return '请求头名称不能包含冒号';
    if (value && /[\r\n]/.test(value)) return '请求头值不能包含换行符';
    return null;
  }

  // Enhanced collectRules with validation
  function collectRulesWithValidation() {
    const result = [];
    const errors = [];
    $rules.querySelectorAll('.ch-rule').forEach((el, idx) => {
      const name = el.querySelector('.ch-rule-name').value.trim();
      const value = el.querySelector('.ch-rule-value').value.trim();
      const op = el.querySelector('.ch-rule-op').value;
      const applyTo = el.querySelector('.ch-rule-apply').value;
      const pattern = el.querySelector('.ch-rule-pattern').value.trim();
      if (name) {
        const err = validateHeaderValue(name, value);
        if (err) {
          errors.push('规则 ' + (idx + 1) + ': ' + err);
          el.querySelector('.ch-rule-name').style.borderColor = '#ef4444';
        } else {
          el.querySelector('.ch-rule-name').style.borderColor = '';
          result.push({ name, value, op, applyTo, pattern });
        }
      }
    });
    if (errors.length > 0) {
      showToast(errors[0], 'error');
    }
    return result;
  }

  // 注意：不再在此处「重写」applySettings。
  // 旧实现通过 `applySettings = function(){...}` 覆盖函数声明，但事件监听器在覆盖之前
  // 就已绑定原始函数对象，导致总开关走的是未校验路径。校验逻辑现已内联到唯一实现中。

  window.addEventListener('message', (event) => {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data && event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
  });

  loadSavedState();
  renderTemplateButtons();
  renderImportExport();
});
