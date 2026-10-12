/**
 * JWT 生成与签名 (HS256/HS384/HS512/RS256/ES256)
 * 纯本地实现，使用 Web Crypto API
 * @version 1.3.0
 */
(function () {
  'use strict';

  window.addEventListener('message',function(e){
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）
if(!e.data||e.source!==window.parent)return;if(e.data&&e.data.action==='setTheme'&&e.data.data)document.documentElement.setAttribute('data-theme',e.data.data.theme);});

  // 状态
  const state = {
    algo: 'HS256',
    secret: 'your-256-bit-secret',
    header: { alg: 'HS256', typ: 'JWT' },
    payload: { sub: '1234567890', name: 'John Doe', iat: 1700000000, exp: 1800000000 }
  };

  // DOM
  const E = {
    algo: document.getElementById('algo-select'),
    header: document.getElementById('header-input'),
    payload: document.getElementById('payload-input'),
    secret: document.getElementById('secret-input'),
    showSecret: document.getElementById('show-secret'),
    tokenOut: document.getElementById('token-output'),
    curTs: document.getElementById('cur-ts'),
    btnGen: document.getElementById('btn-generate'),
    btnCopy: document.getElementById('btn-copy'),
    btnClear: document.getElementById('btn-clear'),
    btnGenSecret: document.getElementById('btn-gen-secret'),
    btnFmtHeader: document.getElementById('btn-format-header'),
    btnInsertIat: document.getElementById('btn-insert-iat'),
    btnInsertExp: document.getElementById('btn-insert-exp'),
    btnInsertExp7: document.getElementById('btn-insert-exp7'),
    claimBtns: document.querySelectorAll('.jg-claim'),
    btnDecode: document.getElementById('btn-decode'),
    jwtDecodeInput: document.getElementById('jwt-decode-input'),
    decodeResult: document.getElementById('decode-result'),
    btnValidate: document.getElementById('btn-validate'),
    validateResult: document.getElementById('validate-result'),
    securityResult: document.getElementById('security-result'),
    btnGenKeyPair: document.getElementById('btn-gen-keypair'),
    keypairOutput: document.getElementById('keypair-output'),
    publicKey: document.getElementById('public-key-input'),
    tplBtns: document.querySelectorAll('.jg-tpl')
  };

  // ==================== 工具函数 ====================

  /**
   * base64url 编码 (无 padding, -_ 替换 +/)
   */
  function base64UrlEncode(str) {
    if (typeof str === 'string') {
      return btoa(unescape(encodeURIComponent(str)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    }
    // ArrayBuffer/Uint8Array
    const bytes = new Uint8Array(str);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }

  /**
   * HMAC 签名 (异步)
   */
  async function hmacSign(algo, key, data) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(key),
      { name: 'HMAC', hash: algo },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
    return base64UrlEncode(sig);
  }

  /**
   * 生成随机密钥
   */
  function generateSecret(len = 48) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    let s = '';
    for (let i = 0; i < len; i++) s += chars[arr[i] % chars.length];
    return s;
  }

  // ==================== PEM 与 ArrayBuffer 转换 ====================

  /**
   * ArrayBuffer 转 PEM 格式字符串
   * @param {ArrayBuffer} buffer 密钥二进制数据
   * @param {string} label PEM 标签 (PRIVATE KEY / PUBLIC KEY)
   */
  function abToPem(buffer, label) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const b64 = btoa(binary);
    // 按 64 字符断行
    const lines = b64.match(/.{1,64}/g).join('\n');
    return '-----BEGIN ' + label + '-----\n' + lines + '\n-----END ' + label + '-----';
  }

  /**
   * PEM 字符串转 ArrayBuffer
   * @param {string} pem PEM 格式字符串
   * @returns {ArrayBuffer}
   */
  function pemToAb(pem) {
    const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  /**
   * 检测 PEM 类型 (PKCS#8 私钥 / SPKI 公钥)
   */
  // ==================== 非对称签名 (RS256/ES256) ====================

  /**
   * RSA/ECDSA 密钥对生成
   * @param {string} algo RS256 或 ES256
   * @returns {Promise<{privateKeyPem:string, publicKeyPem:string, cryptoPrivKey:CryptoKey, cryptoPubKey:CryptoKey}>}
   */
  async function generateKeyPair(algo) {
    let keyAlgo, format;
    if (algo === 'RS256') {
      // RSASSA-PKCS1-v1_5, 模长 2048, 公共指数 65537
      keyAlgo = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    } else if (algo === 'ES256') {
      // ECDSA P-256 曲线
      keyAlgo = { name: 'ECDSA', namedCurve: 'P-256' };
    } else {
      throw new Error('不支持的算法: ' + algo);
    }
    const keyPair = await crypto.subtle.generateKey(keyAlgo, true, ['sign', 'verify']);
    // 导出为 PKCS#8 / SPKI 格式
    const privAb = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
    const pubAb = await crypto.subtle.exportKey('spki', keyPair.publicKey);
    return {
      privateKeyPem: abToPem(privAb, 'PRIVATE KEY'),
      publicKeyPem: abToPem(pubAb, 'PUBLIC KEY'),
      cryptoPrivKey: keyPair.privateKey,
      cryptoPubKey: keyPair.publicKey
    };
  }

  /**
   * 导入 PEM 格式私钥 (用于签名)
   * @param {string} pemPem PEM 字符串
   * @param {string} algo RS256 或 ES256
   */
  async function importPrivateKey(pem, algo) {
    const ab = pemToAb(pem);
    if (algo === 'RS256') {
      return await crypto.subtle.importKey('pkcs8', ab, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    } else if (algo === 'ES256') {
      return await crypto.subtle.importKey('pkcs8', ab, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    }
    throw new Error('不支持的算法: ' + algo);
  }

  /**
   * 导入 PEM 格式公钥 (用于验证)
   */
  async function importPublicKey(pem, algo) {
    const ab = pemToAb(pem);
    if (algo === 'RS256') {
      return await crypto.subtle.importKey('spki', ab, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    } else if (algo === 'ES256') {
      return await crypto.subtle.importKey('spki', ab, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    }
    throw new Error('不支持的算法: ' + algo);
  }

  /**
   * RS256/ES256 签名
   * @param {CryptoKey} cryptoKey 已导入的私钥
   * @param {string} algo RS256 或 ES256
   * @param {string} data 待签名数据
   * @returns {Promise<string>} base64url 签名
   */
  async function asymmetricSign(cryptoKey, algo, data) {
    const dataBytes = new TextEncoder().encode(data);
    let sigAb;
    if (algo === 'RS256') {
      sigAb = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, dataBytes);
    } else if (algo === 'ES256') {
      // ECDSA sign 需指定 hash 算法
      sigAb = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, dataBytes);
    } else {
      throw new Error('不支持的算法: ' + algo);
    }
    return base64UrlEncode(sigAb);
  }

  /**
   * RS256/ES256 验签
   * @returns {Promise<boolean>}
   */
  async function asymmetricVerify(cryptoKey, algo, data, signature) {
    const dataBytes = new TextEncoder().encode(data);
    // base64url 转 ArrayBuffer
    let s = signature.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const sigBinary = atob(s);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) sigBytes[i] = sigBinary.charCodeAt(i);
    try {
      if (algo === 'RS256') {
        return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sigBytes, dataBytes);
      } else if (algo === 'ES256') {
        return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, sigBytes, dataBytes);
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  // 缓存最近生成的 CryptoKey 密钥对，避免重复导入
  const keyCache = { private: null, public: null, algo: null };

  // ==================== 渲染 ====================

  function updateCurTs() {
    E.curTs.textContent = Math.floor(Date.now() / 1000);
    // 同步 iat
    setTimeout(updateCurTs, 1000);
  }

  function showError(msg) {
    E.tokenOut.innerHTML = '<span style="color:#ef4444">❌ ' + escapeHtml(msg) + '</span>';
  }

  function showToken(token) {
    const parts = token.split('.');
    if (parts.length !== 3) {
      E.tokenOut.textContent = token;
      return;
    }
    E.tokenOut.innerHTML =
      '<span class="jg-token-part-header">' + escapeHtml(parts[0]) + '</span>.' +
      '<span class="jg-token-part-payload">' + escapeHtml(parts[1]) + '</span>.' +
      '<span class="jg-token-part-sig">' + escapeHtml(parts[2]) + '</span>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // ==================== 生成 Token ====================

  async function generateToken() {
    let header, payload;
    try {
      header = JSON.parse(E.header.value);
      payload = JSON.parse(E.payload.value);
    } catch (e) {
      showError('JSON 格式错误: ' + e.message);
      return;
    }

    const secret = E.secret.value;
    if (!secret) {
      showError('请填写密钥');
      return;
    }

    // 同步 alg
    header.alg = state.algo;
    header.typ = header.typ || 'JWT';

    try {
      const headerB64 = base64UrlEncode(JSON.stringify(header));
      const payloadB64 = base64UrlEncode(JSON.stringify(payload));
      const signingInput = headerB64 + '.' + payloadB64;

      const isHmac = state.algo.startsWith('HS');
      const isAsymmetric = state.algo === 'RS256' || state.algo === 'ES256';

      if (isHmac) {
        // HMAC 对称签名
        const hashMap = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };
        const hashName = hashMap[state.algo];
        if (!hashName) {
          showError('不支持的算法: ' + state.algo);
          return;
        }
        const sig = await hmacSign(hashName, secret, signingInput);
        showToken(signingInput + '.' + sig);
      } else if (isAsymmetric) {
        // 非对称签名 (RS256/ES256) - 使用 PEM 私钥
        let cryptoKey;
        // 若缓存匹配且私钥未变化则复用
        if (keyCache.private && keyCache.algo === state.algo && keyCache.pem === secret) {
          cryptoKey = keyCache.private;
        } else {
          cryptoKey = await importPrivateKey(secret, state.algo);
          keyCache.private = cryptoKey;
          keyCache.algo = state.algo;
          keyCache.pem = secret;
        }
        const sig = await asymmetricSign(cryptoKey, state.algo, signingInput);
        showToken(signingInput + '.' + sig);
      } else {
        showError('不支持的算法: ' + state.algo);
      }
    } catch (e) {
      showError('生成失败: ' + e.message);
    }
  }

  // ==================== 事件 ====================

  E.algo.addEventListener('change', e => {
    state.algo = e.target.value;
    try {
      const h = JSON.parse(E.header.value);
      h.alg = state.algo;
      E.header.value = JSON.stringify(h, null, 2);
    } catch (e2) {}
    // RS256/ES256 显示公钥输出区，并切换密钥输入框提示
    const isAsymmetric = state.algo === 'RS256' || state.algo === 'ES256';
    if (E.keypairOutput) E.keypairOutput.style.display = isAsymmetric ? 'block' : 'none';
    if (isAsymmetric && E.secret && !E.secret.value.startsWith('-----BEGIN')) {
      E.secret.placeholder = '粘贴 PEM 格式私钥（-----BEGIN PRIVATE KEY-----）或点击「生成密钥对」';
    } else {
      E.secret.placeholder = '';
    }
  });

  E.showSecret.addEventListener('change', e => {
    E.secret.type = e.target.checked ? 'text' : 'password';
    E.secret.value = E.secret.value;
  });
  E.secret.type = 'password';

  E.btnGen.addEventListener('click', generateToken);

  E.btnCopy.addEventListener('click', () => {
    const text = E.tokenOut.textContent;
    if (!text || text.includes('点击')) return;
    navigator.clipboard.writeText(text).then(() => {
      E.btnCopy.textContent = '✓';
      setTimeout(() => { E.btnCopy.textContent = '📋'; }, 1200);
    }).catch(() => {});
  });

  E.btnClear.addEventListener('click', () => {
    E.header.value = '{}';
    E.payload.value = '{}';
    E.tokenOut.textContent = '点击「生成 Token」按钮生成';
  });

  E.btnGenSecret.addEventListener('click', () => {
    E.secret.value = generateSecret(48);
    E.showSecret.checked = true;
    E.secret.type = 'text';
  });

  // 生成 RSA/ECDSA 密钥对（仅 RS256/ES256 时使用）
  if (E.btnGenKeyPair) {
    E.btnGenKeyPair.addEventListener('click', async () => {
      const algo = state.algo === 'ES256' ? 'ES256' : 'RS256';
      // 若当前算法为 HS* 则默认切到 RS256
      if (!state.algo || !['RS256', 'ES256'].includes(state.algo)) {
        state.algo = 'RS256';
        E.algo.value = 'RS256';
        try {
          const h = JSON.parse(E.header.value);
          h.alg = 'RS256';
          E.header.value = JSON.stringify(h, null, 2);
        } catch (e2) {}
        if (E.keypairOutput) E.keypairOutput.style.display = 'block';
      }
      try {
        E.btnGenKeyPair.textContent = '⏳ 生成中...';
        E.btnGenKeyPair.disabled = true;
        const kp = await generateKeyPair(state.algo);
        // 私钥填入 secret 输入框
        E.secret.value = kp.privateKeyPem;
        E.secret.type = 'text';
        E.showSecret.checked = true;
        // 公钥填入公钥框
        if (E.publicKey) E.publicKey.value = kp.publicKeyPem;
        // 缓存 CryptoKey 避免重新导入
        keyCache.private = kp.cryptoPrivKey;
        keyCache.public = kp.cryptoPubKey;
        keyCache.algo = state.algo;
        keyCache.pem = kp.privateKeyPem;
        E.btnGenKeyPair.textContent = '✓ 已生成';
        setTimeout(() => { E.btnGenKeyPair.textContent = '🔑 生成密钥对'; E.btnGenKeyPair.disabled = false; }, 1200);
      } catch (e) {
        showError('密钥对生成失败: ' + e.message);
        E.btnGenKeyPair.textContent = '🔑 生成密钥对';
        E.btnGenKeyPair.disabled = false;
      }
    });
  }

  // ==================== Payload 模板 ====================
  const PAYLOAD_TEMPLATES = {
    // 认证令牌：标准登录态
    auth: {
      sub: 'user_12345', name: '张三', role: 'user',
      iss: 'myapp.example.com', aud: 'myapp.example.com',
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600
    },
    // API 访问令牌
    api: {
      sub: 'api_client', scope: 'read:profile write:data',
      iss: 'api.example.com', aud: 'api.example.com',
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'api-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now())
    },
    // 管理员令牌
    admin: {
      sub: 'admin_001', name: '管理员', role: 'admin', permissions: ['read', 'write', 'delete'],
      iss: 'admin.example.com', aud: 'admin.example.com',
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 1800
    },
    // 刷新令牌：有效期 30 天
    refresh: {
      sub: 'user_12345', type: 'refresh',
      iss: 'myapp.example.com', aud: 'myapp.example.com',
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 30 * 86400,
      jti: 'refresh-' + (crypto.randomUUID ? crypto.randomUUID() : Date.now())
    },
    // 空模板
    empty: {}
  };

  // 模板按钮点击：替换 payload 内容
  if (E.tplBtns && E.tplBtns.length) {
    E.tplBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tplKey = btn.dataset.tpl;
        const tpl = PAYLOAD_TEMPLATES[tplKey];
        if (!tpl) return;
        E.payload.value = JSON.stringify(tpl, null, 2);
        // 视觉反馈
        const orig = btn.textContent;
        btn.textContent = '✓ 已应用';
        setTimeout(() => { btn.textContent = orig; }, 1000);
      });
    });
  }

  E.btnFmtHeader.addEventListener('click', () => {
    try {
      const obj = JSON.parse(E.header.value);
      E.header.value = JSON.stringify(obj, null, 2);
    } catch (e) {
      showError('JSON 格式错误');
    }
  });

  // 快速插入 claim
  E.claimBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const claim = btn.dataset.claim;
      try {
        const p = JSON.parse(E.payload.value);
        p[claim] = p[claim] ?? defaultClaimValue(claim);
        E.payload.value = JSON.stringify(p, null, 2);
      } catch (e) {
        showError('请先填写合法的 JSON');
      }
    });
  });

  function defaultClaimValue(claim) {
    if (claim === 'iat' || claim === 'exp' || claim === 'nbf') {
      return Math.floor(Date.now() / 1000);
    }
    if (claim === 'jti') {
      return crypto.randomUUID ? crypto.randomUUID() : ('id-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9));
    }
    return '';
  }

  function insertClaim(key, value) {
    try {
      const p = JSON.parse(E.payload.value);
      p[key] = value;
      E.payload.value = JSON.stringify(p, null, 2);
    } catch (e) {
      showError('请先填写合法的 JSON');
    }
  }

  E.btnInsertIat.addEventListener('click', () => insertClaim('iat', Math.floor(Date.now() / 1000)));
  E.btnInsertExp.addEventListener('click', () => {
    const now = Math.floor(Date.now() / 1000);
    insertClaim('iat', now);
    insertClaim('exp', now + 3600);
  });
  E.btnInsertExp7.addEventListener('click', () => {
    const now = Math.floor(Date.now() / 1000);
    insertClaim('iat', now);
    insertClaim('exp', now + 7 * 86400);
  });

  // ==================== JWT 解码 ====================

  function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return atob(str);
  }

  function decodeJWT() {
    const token = (E.jwtDecodeInput ? E.jwtDecodeInput.value : '').trim();
    if (!token) { if (E.decodeResult) E.decodeResult.innerHTML = '<span style="color:var(--tt-text-tertiary)">请输入JWT令牌</span>'; return; }
    const parts = token.split('.');
    if (parts.length < 2) { if (E.decodeResult) E.decodeResult.innerHTML = '<span style="color:#ef4444">❌ 无效的JWT格式（需要至少2段）</span>'; return; }
    try {
      const header = JSON.parse(base64UrlDecode(parts[0]));
      let html = '<div style="margin-bottom:8px"><strong>Header:</strong></div>';
      html += '<pre style="background:var(--tt-bg-secondary);padding:8px;border-radius:4px;font-size:12px;overflow:auto">' + escapeHtml(JSON.stringify(header, null, 2)) + '</pre>';
      try {
        const payload = JSON.parse(base64UrlDecode(parts[1]));
        html += '<div style="margin:8px 0"><strong>Payload:</strong></div>';
        html += '<pre style="background:var(--tt-bg-secondary);padding:8px;border-radius:4px;font-size:12px;overflow:auto">' + escapeHtml(JSON.stringify(payload, null, 2)) + '</pre>';
        // 时间字段解析
        const now = Math.floor(Date.now() / 1000);
        if (payload.iat) html += '<div style="font-size:12px;color:var(--tt-text-tertiary)">iat(签发): ' + new Date(payload.iat * 1000).toLocaleString() + '</div>';
        if (payload.exp) {
          const expDate = new Date(payload.exp * 1000);
          html += '<div style="font-size:12px;color:' + (payload.exp < now ? '#ef4444' : 'var(--tt-success)') + '">exp(过期): ' + expDate.toLocaleString() + (payload.exp < now ? ' ⚠️ 已过期' : '') + '</div>';
        }
        if (payload.nbf) html += '<div style="font-size:12px;color:var(--tt-text-tertiary)">nbf(生效): ' + new Date(payload.nbf * 1000).toLocaleString() + '</div>';
        // 自动填充到生成器
        E.header.value = JSON.stringify(header, null, 2);
        E.payload.value = JSON.stringify(payload, null, 2);
        if (header.alg) { state.algo = header.alg; E.algo.value = header.alg; }
      } catch (e) {
        html += '<div style="color:var(--tt-text-tertiary)">Payload 非JSON: ' + escapeHtml(base64UrlDecode(parts[1]).substring(0, 200)) + '</div>';
      }
      if (parts[2]) {
        html += '<div style="margin-top:8px"><strong>签名:</strong></div>';
        html += '<code style="font-size:11px;word-break:break-all">' + escapeHtml(parts[2]) + '</code>';
      }
      if (E.decodeResult) E.decodeResult.innerHTML = html;
    } catch (e) {
      if (E.decodeResult) E.decodeResult.innerHTML = '<span style="color:#ef4444">❌ 解码失败: ' + escapeHtml(e.message) + '</span>';
    }
    // 同时执行安全检查
    runSecurityCheck(token);
  }

  // ==================== JWT 验证 ====================

  async function validateJWT() {
    const token = (E.jwtDecodeInput ? E.jwtDecodeInput.value : '').trim();
    if (!token) { if (E.validateResult) E.validateResult.innerHTML = '<span style="color:var(--tt-text-tertiary)">请输入JWT令牌</span>'; return; }
    const parts = token.split('.');
    if (parts.length !== 3) { if (E.validateResult) E.validateResult.innerHTML = '<span style="color:#ef4444">❌ 无效的JWT格式</span>'; return; }
    const secret = E.secret.value;
    if (!secret) { if (E.validateResult) E.validateResult.innerHTML = '<span style="color:#f59e0b">⚠️ 请输入密钥以验证签名</span>'; return; }
    try {
      const header = JSON.parse(base64UrlDecode(parts[0]));
      const signingInput = parts[0] + '.' + parts[1];
      const alg = header.alg;
      let isValid = false;

      if (alg && alg.startsWith('HS')) {
        // HMAC 对称验证
        const hashMap = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };
        const hashName = hashMap[alg];
        if (!hashName) { if (E.validateResult) E.validateResult.innerHTML = '<span style="color:#f59e0b">⚠️ 不支持的算法: ' + escapeHtml(alg) + '</span>'; return; }
        const expectedSig = await hmacSign(hashName, secret, signingInput);
        isValid = expectedSig === parts[2];
      } else if (alg === 'RS256' || alg === 'ES256') {
        // 非对称验证：优先用公钥框内容，否则尝试用私钥导出公钥
        let pubPem = E.publicKey && E.publicKey.value.trim();
        if (!pubPem) {
          // 若密钥框里是私钥 PEM，可使用缓存的公钥（来自 generateKeyPair）
          if (keyCache.public && keyCache.algo === alg && keyCache.pem === secret) {
            const cryptoPubKey = keyCache.public;
            isValid = await asymmetricVerify(cryptoPubKey, alg, signingInput, parts[2]);
            renderValidateResult(isValid, alg, '公钥(由私钥生成)');
            return;
          }
          if (E.validateResult) E.validateResult.innerHTML = '<span style="color:#f59e0b">⚠️ RS256/ES256 验证需要公钥，请在「公钥」框填入 PEM 公钥，或先点击「生成密钥对」</span>';
          return;
        }
        const cryptoPubKey = await importPublicKey(pubPem, alg);
        isValid = await asymmetricVerify(cryptoPubKey, alg, signingInput, parts[2]);
      } else if (alg === 'none' || !alg) {
        if (E.validateResult) E.validateResult.innerHTML = '<span style="color:#f59e0b">⚠️ 算法为 none，无签名可验证</span>';
        return;
      } else {
        if (E.validateResult) E.validateResult.innerHTML = '<span style="color:#f59e0b">⚠️ 不支持的算法: ' + escapeHtml(alg) + '</span>';
        return;
      }

      renderValidateResult(isValid, alg, alg.startsWith('HS') ? '共享密钥' : '公钥');
    } catch (e) {
      if (E.validateResult) E.validateResult.innerHTML = '<span style="color:#ef4444">❌ 验证失败: ' + escapeHtml(e.message) + '</span>';
    }
  }

  function renderValidateResult(isValid, alg, keyType) {
    if (!E.validateResult) return;
    if (isValid) {
      E.validateResult.innerHTML = '<span style="color:var(--tt-success);font-size:14px">✅ 签名验证通过 — ' + escapeHtml(alg) + ' · ' + escapeHtml(keyType) + ' 匹配</span>';
    } else {
      E.validateResult.innerHTML = '<span style="color:#ef4444;font-size:14px">❌ 签名验证失败 — ' + escapeHtml(keyType) + ' 不匹配</span>';
    }
  }

  // ==================== JWT 安全检查 ====================

  function runSecurityCheck(token) {
    if (!E.securityResult) return;
    const parts = token.split('.');
    if (parts.length < 2) { E.securityResult.innerHTML = ''; return; }
    try {
      const header = JSON.parse(base64UrlDecode(parts[0]));
      const payload = parts[1] ? JSON.parse(base64UrlDecode(parts[1])) : {};
      const issues = [];
      const alg = header.alg;
      const isAsymmetric = alg === 'RS256' || alg === 'ES256';
      // 算法检查
      if (alg === 'none' || !alg) issues.push({ level: 'critical', text: '🚨 算法为 none 或未设置 — 令牌无签名保护' });
      if (alg && alg.startsWith('HS') && E.secret && E.secret.value.length < 16) issues.push({ level: 'high', text: '⚠️ HMAC密钥过短（<16字符），容易被暴力破解' });
      // 非对称算法密钥格式检查
      if (isAsymmetric && E.secret && !E.secret.value.includes('-----BEGIN')) {
        issues.push({ level: 'high', text: '⚠️ RS256/ES256 需要 PEM 格式私钥（-----BEGIN PRIVATE KEY-----）' });
      }
      // 无签名
      if (!parts[2] || parts[2] === '') issues.push({ level: 'critical', text: '🚨 令牌无签名 — 任何人都可以伪造' });
      // 过期检查
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) issues.push({ level: 'medium', text: '⚠️ 令牌已过期' });
      if (!payload.exp) issues.push({ level: 'high', text: '⚠️ 未设置过期时间 (exp) — 令牌永不过期' });
      // nbf
      if (payload.nbf && payload.nbf > now) issues.push({ level: 'low', text: 'ℹ️ 令牌尚未生效 (nbf)' });
      // 弱密钥常见值（仅 HMAC 算法检查）
      if (alg && alg.startsWith('HS')) {
        const weakKeys = ['secret', 'password', 'key', '123456', 'your-256-bit-secret', 'supersecret'];
        if (E.secret && weakKeys.includes(E.secret.value.toLowerCase())) issues.push({ level: 'critical', text: '🚨 使用了常见弱密钥: "' + escapeHtml(E.secret.value) + '"' });
      }
      // jti
      if (!payload.jti) issues.push({ level: 'low', text: 'ℹ️ 未设置 jti — 无法防止重放攻击' });
      // iss/aud
      if (!payload.iss) issues.push({ level: 'low', text: 'ℹ️ 未设置签发者 (iss)' });
      if (!payload.aud) issues.push({ level: 'low', text: 'ℹ️ 未设置受众 (aud)' });

      if (issues.length === 0) {
        E.securityResult.innerHTML = '<div style="color:var(--tt-success)">✅ 未发现明显安全问题</div>';
      } else {
        E.securityResult.innerHTML = issues.map(i =>
          '<div style="padding:4px 0;font-size:13px;color:' + (i.level === 'critical' ? '#ef4444' : i.level === 'high' ? '#f59e0b' : 'var(--tt-text-tertiary)') + '">' + i.text + '</div>'
        ).join('');
      }
    } catch (e) {
      E.securityResult.innerHTML = '<span style="color:var(--tt-text-tertiary)">安全检查需要有效JWT</span>';
    }
  }

  // 绑定解码和验证按钮
  if (E.btnDecode) E.btnDecode.addEventListener('click', decodeJWT);
  if (E.btnValidate) E.btnValidate.addEventListener('click', validateJWT);
  // 自动解码：粘贴JWT时自动解码
  if (E.jwtDecodeInput) {
    E.jwtDecodeInput.addEventListener('paste', () => { setTimeout(decodeJWT, 100); });
  }

  updateCurTs();
  // 初始生成一次示例
  setTimeout(generateToken, 100);
})();
