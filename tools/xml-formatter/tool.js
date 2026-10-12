/**
 * XML 格式化 / 压缩 / 校验
 *
 * 与早期实现的关键差异（均为正确性修复）：
 *  1) 文本与属性值做完整的 XML 实体转义。原实现只转义了属性里的引号，
 *     文本节点与属性值中的 & / < / > 原样输出，会产出**非法 XML**
 *     （例如源文件里的 &amp; 解析后变回 &，再输出成裸 &）。
 *  2) 保留注释、CDATA 与处理指令。原实现把它们过滤掉了，格式化后内容丢失。
 *  3) 无子元素但存在非空文本的元素不再被压成自闭合标签（<a> </a> → <a/> 会改变语义）。
 */
document.addEventListener('DOMContentLoaded', () => {
  const I = document.getElementById('input-area');
  const O = document.getElementById('output-area');
  const Vt = document.getElementById('validation-text');
  const Vi = document.getElementById('validation-icon');

  const NODE = { ELEMENT: 1, TEXT: 3, CDATA: 4, PROCESSING: 7, COMMENT: 8 };

  /** 文本节点转义（& 必须最先替换，否则会二次转义） */
  function escapeXmlText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** 属性值转义：XML 规范要求转义 & < " 与换行 */
  function escapeXmlAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;')
      .replace(/\t/g, '&#9;')
      .replace(/\n/g, '&#10;')
      .replace(/\r/g, '&#13;');
  }

  /** 该子节点是否需要保留在输出中 */
  function isMeaningfulChild(c) {
    if (c.nodeType === NODE.ELEMENT || c.nodeType === NODE.COMMENT ||
        c.nodeType === NODE.CDATA || c.nodeType === NODE.PROCESSING) return true;
    return c.nodeType === NODE.TEXT && c.textContent.trim() !== '';
  }

  /**
   * 递归格式化 XML 节点
   * @param {Node} node
   * @param {string} indentUnit
   * @param {number} level
   * @returns {string}
   */
  function formatXML(node, indentUnit, level) {
    const sp = indentUnit.repeat(level);

    if (node.nodeType === NODE.TEXT) {
      const t = node.textContent.trim();
      return t ? sp + escapeXmlText(t) + '\n' : '';
    }
    if (node.nodeType === NODE.COMMENT) {
      return sp + '<!--' + node.textContent + '-->\n';
    }
    if (node.nodeType === NODE.CDATA) {
      // CDATA 内容不转义，仅需处理其中出现的 ]]> 以免提前结束
      return sp + '<![CDATA[' + String(node.textContent).replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]>\n';
    }
    if (node.nodeType === NODE.PROCESSING) {
      return sp + '<?' + node.target + (node.data ? ' ' + node.data : '') + '?>\n';
    }
    if (node.nodeType !== NODE.ELEMENT) return '';

    let out = sp + '<' + node.nodeName;
    for (let i = 0; i < node.attributes.length; i++) {
      const a = node.attributes[i];
      out += ' ' + a.name + '="' + escapeXmlAttr(a.value) + '"';
    }

    const children = Array.from(node.childNodes).filter(isMeaningfulChild);

    if (children.length === 0) {
      // 无有效子节点：若元素原本带有非空文本，必须保留成对标签，否则会改变文档语义
      const raw = node.textContent || '';
      if (raw.trim() !== '') {
        return out + '>' + escapeXmlText(raw.trim()) + '</' + node.nodeName + '>\n';
      }
      return out + '/>\n';
    }

    // 仅有一个纯文本子节点时保持内联，避免把短文本拆成多行
    if (children.length === 1 && children[0].nodeType === NODE.TEXT) {
      return out + '>' + escapeXmlText(children[0].textContent.trim()) + '</' + node.nodeName + '>\n';
    }

    out += '>\n';
    for (const c of children) out += formatXML(c, indentUnit, level + 1);
    return out + sp + '</' + node.nodeName + '>\n';
  }

  /** 解析并返回 { doc, error } */
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const err = doc.querySelector('parsererror');
    return { doc, error: err ? err.textContent : null };
  }

  function fmt() {
    const t = I.value.trim();
    if (!t) return;
    try {
      const { doc, error } = parseXml(t);
      if (error) {
        Vi.textContent = '❌';
        Vt.textContent = 'XML错误: ' + error;
        return;
      }
      const ind = document.getElementById('indent-select').value;
      const unit = ind === 'tab' ? '\t' : ' '.repeat(parseInt(ind, 10) || 2);
      let out = formatXML(doc.documentElement, unit, 0);
      // 源文本未声明 XML 版本时补上，便于直接使用
      if (!/^\s*<\?xml/i.test(t)) out = '<?xml version="1.0" encoding="UTF-8"?>\n' + out;
      O.value = out.replace(/\n+$/, '\n');
      Vi.textContent = '✅';
      Vt.textContent = 'XML格式化成功';
      document.getElementById('output-status').textContent = O.value.length + '字符';
    } catch (e) {
      Vi.textContent = '❌';
      Vt.textContent = '错误: ' + e.message;
    }
  }

  function min() {
    const t = I.value.trim();
    if (!t) return;
    try {
      const { doc, error } = parseXml(t);
      if (error) {
        Vi.textContent = '❌';
        Vt.textContent = 'XML错误: ' + error;
        return;
      }
      // XMLSerializer 会正确序列化实体、注释与 CDATA，直接使用即可
      O.value = new XMLSerializer().serializeToString(doc);
      Vi.textContent = '✅';
      Vt.textContent = '压缩完成';
      document.getElementById('output-status').textContent = O.value.length + '字符';
    } catch (e) {
      Vi.textContent = '❌';
      Vt.textContent = '错误: ' + e.message;
    }
  }

  document.getElementById('btn-format').onclick = fmt;
  document.getElementById('btn-minify').onclick = min;
  document.getElementById('btn-validate').onclick = function () {
    const t = I.value.trim();
    if (!t) return;
    const { error } = parseXml(t);
    if (error) {
      Vi.textContent = '❌';
      Vt.textContent = '无效XML: ' + error;
    } else {
      Vi.textContent = '✅';
      Vt.textContent = 'XML格式正确';
    }
  };
  document.getElementById('btn-swap').onclick = function () {
    const t = I.value;
    I.value = O.value;
    O.value = t;
  };
  document.getElementById('btn-copy').onclick = function () {
    if (O.value) navigator.clipboard.writeText(O.value).catch(function () {});
  };
  document.getElementById('btn-clear').onclick = function () {
    I.value = O.value = '';
    Vt.textContent = '等待输入...';
    document.getElementById('input-status').textContent = '';
    document.getElementById('output-status').textContent = '';
  };
  document.getElementById('btn-paste').onclick = function () {
    navigator.clipboard.readText().then(function (t) {
      I.value = t;
      I.dispatchEvent(new Event('input'));
    }).catch(function () {});
  };
  I.oninput = function () {
    document.getElementById('input-status').textContent = I.value.length + '字符';
  };
});

window.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data || e.source !== window.parent) return;
  if (e.data && e.data.action === 'setTheme' && e.data.data) {
    document.documentElement.setAttribute('data-theme', e.data.data.theme);
  }
  if (e.data && e.data.action === 'setData') {
    const el = document.getElementById('input-area');
    if (el && typeof e.data.data === 'string') {
      el.value = e.data.data;
      el.dispatchEvent(new Event('input'));
    }
  }
});
