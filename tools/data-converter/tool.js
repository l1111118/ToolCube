/**
 * 数据格式转换工具
 */
const elements = {
  fromFormat: document.getElementById('from-format'),
  toFormat: document.getElementById('to-format'),
  inputArea: document.getElementById('input-area'),
  outputArea: document.getElementById('output-area'),
  btnConvert: document.getElementById('btn-convert'),
  btnCopy: document.getElementById('btn-copy'),
  btnDownload: document.getElementById('btn-download'),
  toast: document.getElementById('toast')
};

function isCtxValid() { try { return !!(chrome && chrome.runtime && chrome.runtime.id); } catch(e) { return false; } }
function safeSend(msg) { if (!isCtxValid()) return Promise.resolve(); return chrome.runtime.sendMessage(msg).catch(() => {}); }
document.addEventListener('DOMContentLoaded', () => {
  elements.btnConvert.addEventListener('click', convertData);
  elements.btnCopy.addEventListener('click', copyOutput);
  elements.btnDownload.addEventListener('click', downloadOutput);
  window.addEventListener('message', handleMessage);
  loadSavedData();
});

function convertData() {
  const input = elements.inputArea.value.trim();
  if (!input) { showToast('请输入数据', 'error'); return; }
  
  const from = elements.fromFormat.value;
  const to = elements.toFormat.value;
  
  if (from === to) {
    elements.outputArea.value = input;
    showToast('格式相同', 'success');
    return;
  }
  
  try {
    // 先解析为对象
    let data;
    switch (from) {
      case 'json':
        data = JSON.parse(input);
        break;
      case 'xml':
        data = parseXML(input);
        break;
      case 'yaml':
        data = parseYAML(input);
        break;
      case 'csv':
        data = parseCSV(input);
        break;
    }
    
    // 转换为目标格式
    let output;
    switch (to) {
      case 'json':
        output = JSON.stringify(data, null, 2);
        break;
      case 'xml':
        output = toXML(data);
        break;
      case 'yaml':
        output = toYAML(data);
        break;
      case 'csv':
        output = toCSV(data);
        break;
    }
    
    elements.outputArea.value = output;
    showToast('转换成功', 'success');
    saveToHistory(from + '-to-' + to);
  } catch (e) {
    showToast('转换失败: ' + e.message, 'error');
  }
}

function parseXML(xml) {
  // 使用 DOMParser 解析 XML，支持属性、文本节点、子元素
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  // 检查解析错误
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('XML 解析错误: ' + parseError.textContent.split('\n')[0]);
  return xmlToObject(doc.documentElement);
}

function xmlToObject(node) {
  // 元素含属性时，将属性放入对象
  const obj = {};
  const hasAttrs = node.attributes && node.attributes.length > 0;
  const hasChildren = node.children.length > 0;
  const text = (node.textContent || '').trim();

  if (!hasAttrs && !hasChildren) {
    return text;
  }

  if (hasAttrs) {
    for (const attr of node.attributes) {
      obj['@' + attr.name] = attr.value;
    }
  }

  // 分组同名子元素，转为数组
  const grouped = {};
  for (const child of node.children) {
    if (!grouped[child.nodeName]) grouped[child.nodeName] = [];
    grouped[child.nodeName].push(xmlToObject(child));
  }
  for (const [name, values] of Object.entries(grouped)) {
    obj[name] = values.length === 1 ? values[0] : values;
  }

  // 若只有文本且无子元素，将文本作为 #text
  if (text && !hasChildren) {
    obj['#text'] = text;
  }
  return obj;
}

function escapeXml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function toXML(obj, root = 'root') {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<${escapeXml(root)}>\n`;

  function buildXML(data, indent = '  ') {
    if (data === null || data === undefined) return;
    if (Array.isArray(data)) {
      // 数组项：每项用占位标签 item 包裹（外层 key 已在外部生成）
      for (const item of data) {
        if (typeof item === 'object' && item !== null) {
          xml += `${indent}<item>\n`;
          buildXML(item, indent + '  ');
          xml += `${indent}</item>\n`;
        } else {
          xml += `${indent}<item>${escapeXml(item)}</item>\n`;
        }
      }
      return;
    }
    if (typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        const safeKey = escapeXml(key);
        if (value === null) {
          xml += `${indent}<${safeKey}/>\n`;
        } else if (Array.isArray(value)) {
          // 数组：每个元素用同一个 key
          for (const item of value) {
            if (typeof item === 'object' && item !== null) {
              xml += `${indent}<${safeKey}>\n`;
              buildXML(item, indent + '  ');
              xml += `${indent}</${safeKey}>\n`;
            } else {
              xml += `${indent}<${safeKey}>${escapeXml(item)}</${safeKey}>\n`;
            }
          }
        } else if (typeof value === 'object') {
          xml += `${indent}<${safeKey}>\n`;
          buildXML(value, indent + '  ');
          xml += `${indent}</${safeKey}>\n`;
        } else {
          xml += `${indent}<${safeKey}>${escapeXml(value)}</${safeKey}>\n`;
        }
      }
      return;
    }
    // 标量：直接输出文本
    xml += `${indent}${escapeXml(data)}\n`;
  }

  buildXML(obj);
  xml += `</${escapeXml(root)}>`;
  return xml;
}

function parseYAML(yaml) {
  // 增强版 YAML 解析：支持嵌套对象、数组、缩进
  const lines = yaml.split('\n').map(l => l.replace(/\r$/, ''));
  // 保留行号信息（含原始缩进），过滤空行与注释
  const meaningful = lines
    .map((l, i) => ({ text: l, indent: l.search(/\S/), idx: i }))
    .filter(l => l.indent >= 0 && l.text.trim() && !l.text.trim().startsWith('#'));
  let lineIdx = 0;

  // 查看下一有效行的缩进（不消费）
  function peekNextIndent() {
    if (lineIdx >= meaningful.length) return -1;
    return meaningful[lineIdx].indent;
  }

  // 解析位于 indent 列对齐的块；返回对象或数组
  function parseBlock(indent) {
    // 判断是数组还是对象：看第一行是否以 "- " 开头
    if (lineIdx < meaningful.length) {
      const firstTrimmed = meaningful[lineIdx].text.trim();
      if (firstTrimmed.startsWith('- ') || firstTrimmed === '-') {
        return parseArray(indent);
      }
    }

    const result = {};
    while (lineIdx < meaningful.length) {
      const line = meaningful[lineIdx];
      if (line.indent < indent) break;
      // 行内数组项可能出现在对象块中（如 key: value 之后跟着 - item）
      const trimmed = line.text.trim();

      // 解析 "key: value" 或 "key:"
      const m = trimmed.match(/^([\w.\-]+):\s*(.*)$/);
      if (!m) {
        // 不是 key: value 形式，跳过
        lineIdx++;
        continue;
      }
      const key = m[1];
      const rawVal = m[2].trim();
      const curIndent = line.indent;

      if (rawVal === '' || rawVal === '|' || rawVal === '>') {
        // 值为空，检查后续是否有缩进的子块
        lineIdx++;
        const nextIndent = peekNextIndent();
        if (nextIndent > curIndent) {
          // 递归解析子块（使用子块自身的缩进）
          result[key] = parseBlock(nextIndent);
        } else {
          // 没有子块，值为 null
          result[key] = null;
        }
      } else {
        // 行内值
        result[key] = parseScalar(rawVal);
        lineIdx++;
      }
    }
    return result;
  }

  function parseArray(indent) {
    const arr = [];
    while (lineIdx < meaningful.length) {
      const line = meaningful[lineIdx];
      if (line.indent < indent) break;
      if (line.indent > indent) {
        // 缩进不一致，跳过避免死循环
        lineIdx++;
        continue;
      }
      const trimmed = line.text.trim();
      const m = trimmed.match(/^-\s+(.*)$/);
      if (!m) break;
      const itemRaw = m[1].trim();
      // 数组项可能是 "- key: value" 形式（对象数组）
      const objM = itemRaw.match(/^([\w.\-]+):\s*(.*)$/);
      if (objM) {
        // 对象数组项：构建对象，并合并后续同缩进的 key
        const obj = {};
        obj[objM[1]] = objM[2].trim() === '' ? null : parseScalar(objM[2].trim());
        lineIdx++;
        // 收集后续更深层缩进的 key
        while (lineIdx < meaningful.length) {
          const next = meaningful[lineIdx];
          if (next.indent <= indent) break;
          const nextTrimmed = next.text.trim();
          const nextM = nextTrimmed.match(/^([\w.\-]+):\s*(.*)$/);
          if (!nextM) break;
          obj[nextM[1]] = nextM[2].trim() === '' ? null : parseScalar(nextM[2].trim());
          lineIdx++;
        }
        arr.push(obj);
      } else {
        // 标量数组项
        arr.push(parseScalar(itemRaw));
        lineIdx++;
      }
    }
    return arr;
  }

  function parseScalar(s) {
    if (s === 'true' || s === 'True' || s === 'TRUE') return true;
    if (s === 'false' || s === 'False' || s === 'FALSE') return false;
    if (s === 'null' || s === 'Null' || s === '~' || s === '') return null;
    // 数字
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    // 去引号
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.slice(1, -1);
    }
    // 内联数组 [a, b, c]
    if (s.startsWith('[') && s.endsWith(']')) {
      const inner = s.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(',').map(x => parseScalar(x.trim()));
    }
    // 内联对象 {a: 1, b: 2}
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1).trim();
      if (!inner) return {};
      const o = {};
      for (const pair of inner.split(',')) {
        const [k, v] = pair.split(':').map(x => x.trim());
        if (k) o[k] = parseScalar(v);
      }
      return o;
    }
    return s;
  }

  return parseBlock(0);
}

function toYAML(obj, indent = 0) {
  // 增强版 YAML 输出：支持嵌套对象与数组
  const pad = '  '.repeat(indent);
  let yaml = '';
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === 'object' && item !== null) {
        // 对象作为数组项，第一行带 "- "，后续行缩进
        const sub = toYAML(item, indent + 1);
        const firstNewline = sub.indexOf('\n');
        if (firstNewline === -1) {
          yaml += pad + '- ' + sub + '\n';
        } else {
          yaml += pad + '- ' + sub.slice(0, firstNewline) + '\n';
          yaml += sub.slice(firstNewline + 1);
        }
      } else {
        yaml += pad + '- ' + formatScalar(item) + '\n';
      }
    }
    return yaml;
  }
  for (const [key, value] of Object.entries(obj)) {
    if (value === null) {
      yaml += pad + key + ': null\n';
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        yaml += pad + key + ': []\n';
      } else {
        yaml += pad + key + ':\n';
        yaml += toYAML(value, indent + 1);
      }
    } else if (typeof value === 'object') {
      if (Object.keys(value).length === 0) {
        yaml += pad + key + ': {}\n';
      } else {
        yaml += pad + key + ':\n';
        yaml += toYAML(value, indent + 1);
      }
    } else {
      yaml += pad + key + ': ' + formatScalar(value) + '\n';
    }
  }
  return yaml;
}

function formatScalar(v) {
  if (typeof v === 'string') {
    // 含特殊字符的字符串加引号
    if (v === '' || /[:\#\[\]\{\}\,\&\*\!\|\>\'\"]/.test(v) || /^\s|\s$/.test(v) || v === 'true' || v === 'false' || v === 'null') {
      return JSON.stringify(v);
    }
    return v;
  }
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (v === null) return 'null';
  return String(v);
}

function parseCSV(csv) {
  // 增强版 CSV 解析：支持引号包裹、逗号转义、换行符
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < csv.length) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"') {
        if (csv[i + 1] === '"') {
          // 双引号转义为单个引号
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    // 不在引号内
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      cur.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      // 处理 \r\n
      i++;
      continue;
    }
    if (ch === '\n') {
      cur.push(field);
      // 忽略全空行
      if (cur.some(f => f !== '')) rows.push(cur);
      cur = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // 最后一行
  if (field !== '' || cur.length > 0) {
    cur.push(field);
    if (cur.some(f => f !== '')) rows.push(cur);
  }
  if (rows.length === 0) return [];
  const headers = rows[0];
  const result = [];
  for (let r = 1; r < rows.length; r++) {
    const obj = {};
    headers.forEach((h, j) => obj[h] = rows[r][j] !== undefined ? rows[r][j] : '');
    result.push(obj);
  }
  return result;
}

function toCSV(data) {
  if (!Array.isArray(data) || data.length === 0) return '';
  // 收集所有键，保证表头完整
  const headerSet = new Set();
  for (const item of data) {
    if (item && typeof item === 'object') {
      Object.keys(item).forEach(k => headerSet.add(k));
    }
  }
  const headers = Array.from(headerSet);
  function esc(v) {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // 含逗号、引号、换行符的字段需要用引号包裹并转义
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  let csv = headers.map(esc).join(',') + '\n';
  for (const item of data) {
    csv += headers.map(h => esc(item && item[h] !== undefined ? item[h] : '')).join(',') + '\n';
  }
  // 去掉末尾换行
  return csv.replace(/\n$/, '');
}

async function copyOutput() {
  const text = elements.outputArea.value;
  if (!text) { showToast('没有可复制的内容', 'error'); return; }
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制', 'success');
  } catch (e) {
    showToast('复制失败', 'error');
  }
}

function downloadOutput() {
  const text = elements.outputArea.value;
  if (!text) { showToast('没有可下载的内容', 'error'); return; }
  
  const to = elements.toFormat.value;
  const ext = { json: 'json', xml: 'xml', yaml: 'yaml', csv: 'csv' }[to];
  
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `converted_${Date.now()}.${ext}`;
  a.click();
  URL.revokeObjectURL(url);
}

function showToast(msg, type = 'info') {
  elements.toast.textContent = msg;
  elements.toast.className = 'toast toast--' + type;
  elements.toast.classList.add('toast--show');
  setTimeout(() => elements.toast.classList.remove('toast--show'), 3000);
}

async function saveToHistory(action) {
  try {
    await safeSend({
      action: 'saveToHistory',
      data: { toolId: 'data-converter', type: action, data: { action } }
    });
  } catch (e) {}
}

async function loadSavedData() {
  try {
    const res = await safeSend({ action: 'getToolData', data: { toolId: 'data-converter' } });
    if (res && res.input) elements.inputArea.value = res.input;
  } catch (e) {}
}

function handleMessage(e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  const { action, data } = e.data;
  if (action === 'setTheme' && data && data.theme) { document.documentElement.setAttribute('data-theme', data.theme); return; }
  if (action === 'setData' && typeof data === 'string') {
    elements.inputArea.value = data;
    convertData();
  }
}
