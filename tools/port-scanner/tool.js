/**
 * 端口扫描工具
 * 基于浏览器fetch的端口探测
 */
(function () {
  'use strict';

  var PORT_SETS = {
    common: [21, 22, 23, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 3389, 5432, 6379, 5900, 8080, 8443, 27017],
    web: [80, 443, 8080, 8443, 8000, 8888, 3000, 5000, 9000, 9090, 4000, 7001, 8081, 9443, 1080, 3128],
    db: [1433, 1521, 3306, 5432, 6379, 9200, 27017, 27018, 5984, 7000, 9042, 830, 2379],
    mail: [25, 110, 143, 465, 587, 993, 995, 2525, 8025],
    file: [21, 22, 69, 445, 139, 2049, 514, 20],
    // 远程桌面/远程管理端口预设：RDP/VNC/SSH/WinRM/X11 等
    remote: [22, 23, 3389, 3390, 5900, 5901, 5902, 5800, 4848, 5985, 5986, 445, 139, 135, 593, 4173],
    all: Array.from({ length: 1024 }, function (_, i) { return i + 1; })
  };

  var SERVICE_MAP = {
    20: 'FTP-Data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 69: 'TFTP',
    80: 'HTTP', 110: 'POP3', 135: 'MS-RPC', 139: 'NetBIOS', 143: 'IMAP', 443: 'HTTPS', 445: 'SMB',
    465: 'SMTPS', 514: 'Syslog', 587: 'SMTP(TLS)', 593: 'HTTP-RPC-EPMAP', 993: 'IMAPS', 995: 'POP3S',
    1080: 'SOCKS', 1433: 'MSSQL', 1521: 'Oracle', 2049: 'NFS', 2525: 'SMTP-Alt', 8025: 'SMTP-Alt2',
    3000: 'Node.js', 3128: 'Squid', 3306: 'MySQL', 3389: 'RDP', 3390: 'RDP-Alt',
    4000: 'DevServer', 4173: 'Remote-Utility', 4848: 'AppServer-GUI', 5000: 'Flask',
    5432: 'PostgreSQL', 5800: 'VNC-HTTP', 5900: 'VNC', 5901: 'VNC-1', 5902: 'VNC-2',
    5984: 'CouchDB', 5985: 'WinRM-HTTP', 5986: 'WinRM-HTTPS', 6379: 'Redis',
    7000: 'Cassandra', 7001: 'WebLogic',
    8080: 'HTTP-Proxy', 8081: 'HTTP-Alt', 830: 'Consul', 8443: 'HTTPS-Alt', 8888: 'HTTP-Alt',
    9000: 'PHP-FPM', 9042: 'Cassandra', 9090: 'Prometheus', 9200: 'Elasticsearch', 9443: 'HTTPS-Alt',
    2379: 'etcd', 27017: 'MongoDB', 27018: 'MongoDB'
  };

  var E = {
    host: document.getElementById('ps-host'),
    scan: document.getElementById('ps-scan'),
    progress: document.getElementById('ps-progress'),
    progressBar: document.getElementById('ps-progress-bar'),
    progressText: document.getElementById('ps-progress-text'),
    results: document.getElementById('ps-results'),
    serverScan: document.getElementById('ps-server-scan')
  };

  // ── PostMessage 通信路由 ──
  var _msgId = 0;
  var _pendingMsgs = new Map();

  function _handlePostMessageResponse(event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (event.source !== window.parent) return;
    if (!event.data || typeof event.data !== 'object') return;
    var action = event.data.action, data = event.data.data;
    if ((action === '__bgResponse' || action === '__contentResponse') && data && data.__id) {
      var pending = _pendingMsgs.get(data.__id);
      if (pending) {
        _pendingMsgs.delete(data.__id);
        clearTimeout(pending.timer);
        var result = data.result;
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
    return new Promise(function (resolve, reject) {
      var id = ++_msgId;
      var timer = setTimeout(function () {
        _pendingMsgs.delete(id);
        reject(new Error('后台调用超时'));
      // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
      // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
      // 本侧超时只是安全网：必须大于 background 的最长超时（服务请求 20s、通用代理最多 60s），
    // 否则慢请求下会先触发本侧超时，用户看到的是"后台调用超时"而不是服务端返回的可读错误。
    }, 70000);
      _pendingMsgs.set(id, { resolve: resolve, reject: reject, timer: timer });
      window.parent.postMessage({ action: 'callBackground', data: { id: id, action: action, data: data } }, '*');
    });
  }


  var currentPreset = 'common';
  var scanning = false;

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  document.querySelectorAll('.ps-preset').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.ps-preset').forEach(function (b) { b.classList.remove('active'); });
      this.classList.add('active');
      currentPreset = this.dataset.ports;
    });
  });


  // 端口状态 → 展示样式。unknown 是**如实标注**：浏览器无法区分「端口关闭」与
  // 「端口开放但非 HTTP 服务」，不应猜测成 OPEN/CLOSED。
  var PORT_STATE_META = {
    open:     { cls: 'ps-port--open',    statusCls: 'ps-port-status--open',    label: 'OPEN' },
    filtered: { cls: 'ps-port--closed',  statusCls: 'ps-port-status--closed',  label: 'FILTERED' },
    closed:   { cls: 'ps-port--closed',  statusCls: 'ps-port-status--closed',  label: 'CLOSED' },
    unknown:  { cls: 'ps-port--unknown', statusCls: 'ps-port-status--unknown', label: 'UNKNOWN' }
  };

  async function startScan() {
    var host = E.host.value.trim();
    if (!host) return;
    // Remove protocol prefix if present
    host = host.replace(/^https?:\/\//, '').split('/')[0];
    if (!host) return;

    scanning = true;
    E.scan.disabled = true;
    E.scan.textContent = '扫描中...';
    E.progress.style.display = 'block';
    E.results.innerHTML = '';

    var ports = PORT_SETS[currentPreset] || PORT_SETS.common;
    var total = ports.length;
    var timeout = 3000;

    // 服务端视角扫描：用于浏览器无法直连的目标（内网地址、被网络策略限制的端口）。
    // 走「服务端点 → 端口扫描」类别，可在设置中指向自建扫描服务。
    if (E.serverScan && E.serverScan.checked) {
      try {
        E.progressBar.style.width = '30%';
        E.progressText.textContent = '服务端扫描中...';
        var svcResp = await callBackground('serviceRequest', { kind: 'portScan', params: { host: host } });
        if (!svcResp || !svcResp.success) {
          E.results.innerHTML = '<div class="ps-port ps-port--closed"><div>服务端扫描失败：'
            + escapeHtml((svcResp && svcResp.error) || '未知错误')
            + '<br>可在「设置 → 服务端点 → 端口扫描」中更换服务商或指向自建服务</div></div>';
          E.progressText.textContent = '失败';
        } else {
          var openPorts = (svcResp.data && svcResp.data.ports) || [];
          E.progressBar.style.width = '100%';
          E.progressText.textContent = '完成（' + openPorts.length + ' 个端口）';
          if (!openPorts.length) {
            E.results.innerHTML = '<div class="ps-port ps-port--closed"><div>服务端未返回任何端口结果</div></div>';
          } else {
            openPorts.sort(function (a, b) { return a.port - b.port; });
            for (var s = 0; s < openPorts.length; s++) {
              var sp = openPorts[s];
              var svcName = sp.service || SERVICE_MAP[sp.port] || 'Unknown';
              var sMeta = PORT_STATE_META[sp.state] || PORT_STATE_META.unknown;
              var sDiv = document.createElement('div');
              sDiv.className = 'ps-port ' + sMeta.cls;
              sDiv.innerHTML = '<div><span class="ps-port-num">' + sp.port + '</span> <span class="ps-port-service">' + escapeHtml(svcName) + '</span></div>'
                + '<div><span class="ps-port-status ' + sMeta.statusCls + '">' + sMeta.label + '</span></div>';
              E.results.appendChild(sDiv);
            }
          }
        }
      } catch (svcErr) {
        E.results.innerHTML = '<div class="ps-port ps-port--closed"><div>服务端扫描出错：' + escapeHtml(svcErr.message) + '</div></div>';
        E.progressText.textContent = '失败';
      }
      scanning = false;
      E.scan.disabled = false;
      E.scan.textContent = '扫描';
      return;
    }

    // 通过 background 进行端口扫描，绕过 iframe 内的 CORS 限制
    try {
      E.progressBar.style.width = '10%';
      E.progressText.textContent = '扫描中...';

      var response = await callBackground('portScan', { host: host, ports: ports, timeout: timeout });

      if (!scanning) return;

      if (!response || !response.success) {
        E.results.innerHTML = '<div class="ps-port ps-port--closed"><div>扫描失败：' + escapeHtml((response && response.error) || '未知错误') + '</div></div>';
        scanning = false;
        E.scan.disabled = false;
        E.scan.textContent = '扫描';
        E.progressText.textContent = '失败';
        return;
      }

      var results = response.results || [];
      var done = 0;

      // 逐步渲染结果，保持 UI 的逐步更新效果
      results.sort(function (a, b) { return a.port - b.port; });

      for (var i = 0; i < results.length; i++) {
        if (!scanning) break;
        var r = results[i];
        done++;
        var pct = Math.round((done / total) * 100);
        E.progressBar.style.width = pct + '%';
        E.progressText.textContent = pct + '% (' + done + '/' + total + ')';

        var service = SERVICE_MAP[r.port] || 'Unknown';
        var meta = PORT_STATE_META[r.state] || PORT_STATE_META.unknown;
        var div = document.createElement('div');
        div.className = 'ps-port ' + meta.cls;
        div.innerHTML = '<div><span class="ps-port-num">' + r.port + '</span> <span class="ps-port-service">' + escapeHtml(service) + '</span></div>' +
          '<div><span class="ps-port-status ' + meta.statusCls + '">' + meta.label + '</span></div>';
        E.results.appendChild(div);
      }
    } catch (err) {
      if (scanning) {
        E.results.innerHTML = '<div class="ps-port ps-port--closed"><div>扫描出错：' + escapeHtml(err.message) + '</div></div>';
      }
    }

    scanning = false;
    E.scan.disabled = false;
    E.scan.textContent = '扫描';
    E.progressText.textContent = '完成';
  }

  E.scan.addEventListener('click', startScan);
  E.host.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !scanning) startScan();
  });

  // 导出扫描结果
  var btnExport = document.getElementById('ps-export');
  if (btnExport) {
    btnExport.addEventListener('click', function() {
      var items = E.results.querySelectorAll('.ps-port');
      if (items.length === 0) { showToast('无结果可导出'); return; }
      var lines = ['端口\t服务\t状态'];
      items.forEach(function(item) {
        var portNum = item.querySelector('.ps-port-num');
        var service = item.querySelector('.ps-port-service');
        var status = item.querySelector('.ps-port-status');
        if (portNum && status) {
          lines.push(portNum.textContent + '\t' + (service ? service.textContent : 'Unknown') + '\t' + status.textContent);
        }
      });
      var text = lines.join('\n');
      navigator.clipboard.writeText(text).then(function() { showToast('已复制到剪贴板'); }).catch(function() { showToast('复制失败'); });
    });
  }

  // 服务版本检测 - 对开放端口尝试获取Banner
  var btnVersionDetect = document.getElementById('ps-version-detect');
  if (btnVersionDetect) {
    btnVersionDetect.addEventListener('click', async function() {
      var host = E.host.value.trim().replace(/^https?:\/\//, '').split('/')[0];
      if (!host) { showToast('请输入主机地址'); return; }
      var openPorts = [];
      E.results.querySelectorAll('.ps-port--open .ps-port-num').forEach(function(el) {
        openPorts.push(parseInt(el.textContent, 10));
      });
      if (openPorts.length === 0) { showToast('请先扫描发现开放端口'); return; }
      btnVersionDetect.disabled = true;
      btnVersionDetect.textContent = '检测中...';
      // 对HTTP端口尝试通过 background 获取 Server 头
      // （浏览器 no-cors 模式下无法读取响应头，必须经 background 代理）
      for (var i = 0; i < openPorts.length; i++) {
        var port = openPorts[i];
        var isHttpPort = [80, 443, 8080, 8000, 8888, 3000, 5000, 9000, 9090, 8443, 8081, 9443, 7001, 4000].indexOf(port) >= 0;
        if (isHttpPort) {
          try {
            var proto = [443, 8443, 9443].indexOf(port) >= 0 ? 'https' : 'http';
            var targetUrl = proto + '://' + host + ':' + port + '/';
            // 通过 background 的 fetchHeaders 动作获取完整响应头
            var hdrResp = await callBackground('fetchHeaders', { url: targetUrl });
            var serverHeader = hdrResp && hdrResp.headers ? (hdrResp.headers['server'] || hdrResp.headers['Server']) : null;
            // 查找对应端口元素并添加版本信息
            var portEls = E.results.querySelectorAll('.ps-port--open .ps-port-num');
            portEls.forEach(function(el) {
              if (parseInt(el.textContent, 10) === port && serverHeader) {
                var parent = el.closest('.ps-port');
                var existing = parent.querySelector('.ps-port-version');
                if (!existing) {
                  var versionEl = document.createElement('span');
                  versionEl.className = 'ps-port-version';
                  versionEl.style.cssText = 'font-size:11px;color:var(--tt-primary);margin-left:8px';
                  versionEl.textContent = 'Server: ' + serverHeader;
                  parent.querySelector('.ps-port-service').after(versionEl);
                }
              }
            });
          } catch(e) {}
        }
      }
      btnVersionDetect.disabled = false;
      btnVersionDetect.textContent = '版本检测';
      showToast('版本检测完成');
    });
  }

  function showToast(msg) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;top:20px;right:20px;background:var(--tt-bg-primary);border:1px solid var(--tt-border-color);padding:8px 16px;border-radius:4px;font-size:13px;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.15)';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function() { document.body.removeChild(el); }, 2000);
  }

  // 主题切换
  window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    if (e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
  });
})();
