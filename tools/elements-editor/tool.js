/**
 * 元素编辑器 - 增强版 DOM 元素检查与编辑工具
 * 支持页面元素选择和代码编辑（输入HTML+实时预览）双模式
 */

// 尽早同步父窗口主题，避免打开工具时出现亮色/暗色闪烁。
// 注意：不能写成 tool.html 里的内联 <script>——扩展页 CSP 为 script-src 'self'，
// 内联脚本会被浏览器拒绝执行（原实现即因此从未生效）。
// 本文件以经典脚本形式在 </body> 前加载，执行时机早于首次绘制，可达到同样效果。
try {
  if (window.parent && window.parent.document) {
    const parentTheme = window.parent.document.documentElement.getAttribute('data-theme');
    if (parentTheme) document.documentElement.setAttribute('data-theme', parentTheme);
  }
} catch (e) {
  // 跨源访问父文档时抛错属预期情况（父窗口非同源），忽略即可
}

(function() {
'use strict';

// ==================== 状态管理 ====================
let el = null;          // 当前选中元素信息
let computed = {};      // 计算后的样式
let selecting = false;  // 选择模式中？
let mode = 'page';      // 'page' | 'code'
let codeHtml = '';      // 代码编辑模式的HTML源码
let codeSelectedIdx = -1; // 代码模式中选中的元素路径索引

// ==================== 撤销/重做 ====================
let undoStack = [];
let redoStack = [];
const MAX_UNDO = 50;

function undo() {
  if (!undoStack.length) return;
  const action = undoStack.pop();
  redoStack.push(action);
  // 执行反向操作
  performReverseAction(action);
  updateUndoRedoButtons();
}

function redo() {
  if (!redoStack.length) return;
  const action = redoStack.pop();
  undoStack.push(action);
  // 重新执行操作
  performAction(action);
  updateUndoRedoButtons();
}

function performAction(action) {
  if (!el) return;
  if (el.source === 'codePreview') {
    codeModify({ action: action.type, attr: action.attr, value: action.newValue, className: action.className, prop: action.prop });
  } else {
    const modData = { selector: el.selector, action: action.type };
    if (action.attr) modData.attr = action.attr;
    if (action.newValue !== undefined) modData.value = action.newValue;
    if (action.className) modData.className = action.className;
    if (action.prop) modData.prop = action.prop;
    post('modifyElement', modData);
  }
  if (el.source !== 'codePreview') setTimeout(refreshElement, 300);
}

function performReverseAction(action) {
  if (!el) return;
  switch(action.type) {
    case 'setAttr':
      if (action.oldValue === undefined) {
        // was adding new attr, now remove it
        if (el.source === 'codePreview') codeModify({ action: 'removeAttr', attr: action.attr });
        else post('modifyElement', { selector: el.selector, action: 'removeAttr', attr: action.attr });
      } else {
        // was modifying, restore old value
        if (el.source === 'codePreview') codeModify({ action: 'setAttr', attr: action.attr, value: action.oldValue });
        else post('modifyElement', { selector: el.selector, action: 'setAttr', attr: action.attr, value: action.oldValue });
      }
      break;
    case 'removeAttr':
      // Restore removed attr
      if (action.oldValue !== undefined) {
        if (el.source === 'codePreview') codeModify({ action: 'setAttr', attr: action.attr, value: action.oldValue });
        else post('modifyElement', { selector: el.selector, action: 'setAttr', attr: action.attr, value: action.oldValue });
      }
      break;
    case 'addClass':
      if (el.source === 'codePreview') codeModify({ action: 'removeClass', className: action.className });
      else post('modifyElement', { selector: el.selector, action: 'removeClass', className: action.className });
      break;
    case 'removeClass':
      if (el.source === 'codePreview') codeModify({ action: 'addClass', className: action.className });
      else post('modifyElement', { selector: el.selector, action: 'addClass', className: action.className });
      break;
    case 'setInlineStyle':
      if (el.source === 'codePreview') codeModify({ action: 'setInlineStyle', prop: action.prop, value: action.oldValue || '' });
      else post('modifyElement', { selector: el.selector, action: 'setInlineStyle', prop: action.prop, value: action.oldValue || '' });
      break;
    case 'setText':
      if (el.source === 'codePreview') codeModify({ action: 'setText', value: action.oldValue || '' });
      else post('modifyElement', { selector: el.selector, action: 'setText', value: action.oldValue || '' });
      break;
    case 'setHtml':
      if (el.source === 'codePreview') codeModify({ action: 'setHtml', value: action.oldValue || '' });
      else post('modifyElement', { selector: el.selector, action: 'setHtml', value: action.oldValue || '' });
      break;
  }
  if (el.source !== 'codePreview') setTimeout(refreshElement, 300);
}

function updateUndoRedoButtons() {
  const btnUndo = $('btn-undo');
  const btnRedo = $('btn-redo');
  if (btnUndo) btnUndo.disabled = undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

// ==================== DOM引用 ====================
const $ = (id) => document.getElementById(id);

const E = {
  btnSelect: $('btn-select'), btnCancel: $('btn-cancel'), btnRefresh: $('btn-refresh'),
  btnScroll: $('btn-scroll'), btnCopySel: $('btn-copy-sel'), btnDelete: $('btn-delete'),
  status: $('ee-status'),
  overview: $('ee-overview'), tagName: $('ee-tag-name'), tagInfo: $('ee-tag-info'),
  tagDim: $('ee-tag-dim'), tagSelector: $('ee-tag-selector'), breadcrumb: $('ee-breadcrumb'),
  tabs: $('ee-tabs'), tabBtns: document.querySelectorAll('.ee-tab'),
  styles: $('ee-styles'), styleFilter: $('ee-style-filter'),
  attrs: $('ee-attrs'), attrName: $('ee-attr-name'), attrValue: $('ee-attr-value'),
  classes: $('ee-classes'), className: $('ee-class-name'),
  boxModel: $('ee-box-model'),
  children: $('ee-children'),
  domTree: $('ee-dom-tree'),
  htmlSource: $('ee-html-source'), textContent: $('ee-text-content'),
  toast: $('ee-toast'),
  // 代码编辑模式
  codeMode: $('ee-code-mode'), codeInput: $('ee-code-input'),
  codePreview: $('ee-code-preview'), previewHint: $('ee-preview-hint'),
  btnModePage: $('btn-mode-page'), btnModeCode: $('btn-mode-code'),
  btnCodeRender: $('btn-code-render'), btnCodeClear: $('btn-code-clear'),
};

// ==================== 消息通信 ====================
function post(action, data) {
  window.parent.postMessage({ action, data: data || {} }, '*');
}

// ==================== 初始化 ====================
function init() {
  // 选择/取消按钮
  E.btnSelect.addEventListener('click', startSelection);
  E.btnCancel.addEventListener('click', cancelSelection);
  E.btnRefresh.addEventListener('click', refreshElement);
  E.btnScroll.addEventListener('click', scrollToElement);
  E.btnCopySel.addEventListener('click', copySelector);
  if (E.btnDelete) E.btnDelete.addEventListener('click', deleteElement);

  // 模式切换
  E.btnModePage.addEventListener('click', () => switchMode('page'));
  E.btnModeCode.addEventListener('click', () => switchMode('code'));

  // 代码编辑模式按钮
  E.btnCodeRender.addEventListener('click', renderCodePreview);
  E.btnCodeClear.addEventListener('click', () => {
    E.codeInput.value = '';
    codeHtml = '';
    clearCodePreview();
  });

  // 标签页切换
  E.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // 样式过滤
  E.styleFilter.addEventListener('input', () => {
    renderStyles(computed, E.styleFilter.value);
  });

  // 属性添加
  $('btn-add-attr').addEventListener('click', addAttribute);
  // 类名添加
  $('btn-add-class').addEventListener('click', addClass);

  // HTML编辑
  $('btn-edit-html').addEventListener('click', toggleHtmlEdit);
  $('btn-copy-html').addEventListener('click', copyHtml);
  $('btn-save-text').addEventListener('click', saveTextContent);
  $('btn-copy-text').addEventListener('click', copyText);

  // 撤销/重做按钮
  const btnUndo = $('btn-undo');
  const btnRedo = $('btn-redo');
  if (btnUndo) btnUndo.addEventListener('click', undo);
  if (btnRedo) btnRedo.addEventListener('click', redo);
  updateUndoRedoButtons();
  // 初始禁用删除按钮
  updateDeleteButton();

  // 消息监听
  window.addEventListener('message', handleMessage);

  // ESC 键退出元素选择
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selecting) {
      e.preventDefault();
      cancelSelection();
    }
    // Ctrl+Z 撤销 / Ctrl+Y 重做
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    }
  });

  // 延迟加载DOM树
  setTimeout(() => post('getDomTree'), 500);

  updateStatus('点击"选择元素"开始检查', '');
}

// ==================== 模式切换 ====================
function switchMode(newMode) {
  try {
    if (mode === newMode) return;
    mode = newMode;

    // 更新按钮状态
    E.btnModePage.classList.toggle('ee-mode-btn--active', mode === 'page');
    E.btnModeCode.classList.toggle('ee-mode-btn--active', mode === 'code');

    // 切换UI
    if (mode === 'page') {
      E.codeMode.style.display = 'none';
      E.btnSelect.style.display = 'inline-flex';
      E.btnCancel.style.display = 'none';
      E.btnScroll.style.display = 'inline-flex';
      updateStatus('点击"选择元素"开始检查', '');
      // 清除代码模式数据
      if (codeHtml) {
        clearAll();
        E.overview.style.display = 'none';
        E.tabs.style.display = 'none';
        el = null;
        computed = {};
      }
      // 加载DOM树
      setTimeout(() => post('getDomTree'), 300);
    } else {
      E.codeMode.style.display = 'block';
      E.btnSelect.style.display = 'none';
      E.btnCancel.style.display = 'none';
      E.btnScroll.style.display = 'none';
      // 清除页面模式数据
      el = null;
      computed = {};
      clearAll();
      E.overview.style.display = 'none';
      E.tabs.style.display = 'none';
      if (codeHtml) {
        E.codeInput.value = codeHtml;
        renderCodePreview();
      } else {
        updateStatus('输入HTML代码，点击"渲染预览"后可在预览中点击元素编辑', '');
      }
    }
  } catch(e) {
    console.error('[ElementsEditor] switchMode error:', e);
  }
}

// ==================== 代码编辑模式 ====================
function renderCodePreview() {
  const html = E.codeInput.value.trim();
  if (!html) {
    showToast('请输入HTML代码', 'error');
    return;
  }
  codeHtml = html;
  updateStatus('渲染预览中...', '');
  // 重置选中状态
  el = null;
  computed = {};
  clearAll();
  E.overview.style.display = 'none';
  E.tabs.style.display = 'none';

  // 构建预览文档（注入元素选择脚本）
  const doc = buildPreviewDoc(html);
  E.codePreview.srcdoc = doc;
  E.previewHint.textContent = '点击预览中的元素可选中编辑';
}

function clearCodePreview() {
  codeHtml = '';
  el = null;
  computed = {};
  clearAll();
  E.overview.style.display = 'none';
  E.tabs.style.display = 'none';
  E.codePreview.srcdoc = '';
  updateStatus('输入HTML代码，点击"渲染预览"后可在预览中点击元素编辑', '');
}

/**
 * 构建预览文档，注入元素选择脚本
 */
function buildPreviewDoc(html) {
  return '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><style>' +
    'body{margin:0;padding:0;font-family:Arial,sans-serif;}' +
    '.toolbox-hover{outline:2px solid var(--toolbox-primary,#4A90D9) !important;outline-offset:-1px;cursor:pointer;}' +
    '.toolbox-selected{outline:2px solid var(--toolbox-error,#E74C3C) !important;outline-offset:-1px;}' +
    '.toolbox-tooltip{position:fixed;z-index:999999;background:var(--toolbox-tooltip-bg,#333);color:var(--toolbox-tooltip-text,#fff);padding:4px 8px;' +
    'border-radius:4px;font-size:12px;font-family:monospace;pointer-events:none;white-space:nowrap;}' +
    '</style></head><body>' + html + '<script>' +
    '(function(){' +
    'var hovered=null,selected=null,tooltip=null;' +
    'function getElInfo(el){' +
    '  if(!el||el===document.body||el===document.documentElement||el===document)return null;' +
    '  var rect=el.getBoundingClientRect();' +
    '  var attrs={};' +
    '  for(var i=0;i<el.attributes.length;i++){' +
    '    var a=el.attributes[i];' +
    '    if(a.name!=="class"&&a.name!=="id")attrs[a.name]=a.value;' +
    '  }' +
    '  var style=window.getComputedStyle(el);' +
    '  var computedStyles={};' +
    '  var props=["display","position","width","height","margin","padding","color","background-color",' +
    '    "font-size","font-family","font-weight","text-align","border","border-radius","opacity",' +
    '    "box-shadow","transform","overflow","z-index","cursor","flex","grid","gap","line-height",' +
    '    "letter-spacing","transition","animation","visibility","outline","word-break"];' +
    '  props.forEach(function(p){' +
    '    var v=style.getPropertyValue(p);' +
    '    if(v&&v!=="normal"&&v!=="auto"&&v!=="none"&&v!=="rgba(0, 0, 0, 0)"&&v!=="0px")' +
    '      computedStyles[p]=v;' +
    '  });' +
    '  var children=[];' +
    '  for(var j=0;j<el.children.length;j++){' +
    '    var c=el.children[j];' +
    '    children.push({tag:c.tagName.toLowerCase(),id:c.id||"",classes:Array.from(c.classList)||[]});' +
    '  }' +
    '  var boxModel={marginTop:parseFloat(style.marginTop)||0,marginRight:parseFloat(style.marginRight)||0,' +
    '    marginBottom:parseFloat(style.marginBottom)||0,marginLeft:parseFloat(style.marginLeft)||0,' +
    '    borderTop:parseFloat(style.borderTopWidth)||0,borderRight:parseFloat(style.borderRightWidth)||0,' +
    '    borderBottom:parseFloat(style.borderBottomWidth)||0,borderLeft:parseFloat(style.borderLeftWidth)||0,' +
    '    paddingTop:parseFloat(style.paddingTop)||0,paddingRight:parseFloat(style.paddingRight)||0,' +
    '    paddingBottom:parseFloat(style.paddingBottom)||0,paddingLeft:parseFloat(style.paddingLeft)||0,' +
    '    width:rect.width,height:rect.height,offsetWidth:el.offsetWidth,offsetHeight:el.offsetHeight};' +
    '  var path=[];' +
    '  var p=el;' +
    '  while(p&&p!==document.body){' +
    '    path.unshift({tag:p.tagName.toLowerCase(),id:p.id||"",classes:Array.from(p.classList)||[]});' +
    '    p=p.parentElement;' +
    '  }' +
    '  var sel=el.tagName.toLowerCase();' +
    '  if(el.id)sel+="#"+el.id;' +
    '  else if(el.classList.length)sel+="."+Array.from(el.classList).join(".");' +
    '  return{' +
    '    tag:el.tagName.toLowerCase(),id:el.id||"",' +
    '    classes:Array.from(el.classList)||[],' +
    '    attrs:attrs,styles:computedStyles,' +
    '    rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},' +
    '    boxModel:boxModel,children:children,' +
    '    text:el.textContent?el.textContent.substring(0,500):"",' +
    '    textContent:el.textContent||"",' +
    '    innerHTML:el.innerHTML||"",' +
    '    outerHTML:el.outerHTML||"",' +
    '    selector:sel,path:path,' +
    '    source:"codePreview"' +
    '  };' +
    '}' +
    'function showTooltip(el,info){' +
    '  if(!tooltip){tooltip=document.createElement("div");tooltip.className="toolbox-tooltip";' +
    '    document.body.appendChild(tooltip);}' +
    '  var rect=el.getBoundingClientRect();' +
    '  tooltip.textContent="<"+info.tag+(info.id?"#"+info.id:"")+"> "+(info.classes.length?info.classes.join(" "):"")+' +
    '    " "+Math.round(info.rect.width)+"×"+Math.round(info.rect.height);' +
    '  tooltip.style.left=(rect.left+4)+"px";' +
    '  tooltip.style.top=(rect.top-24)+"px";' +
    '  tooltip.style.display="block";' +
    '}' +
    'function hideTooltip(){if(tooltip)tooltip.style.display="none";}' +
    'document.addEventListener("mouseover",function(e){' +
    '  if(e.target===document.body||e.target===document.documentElement)return;' +
    '  if(hovered&&hovered!==e.target)hovered.classList.remove("toolbox-hover");' +
    '  hovered=e.target;' +
    '  if(hovered!==selected)hovered.classList.add("toolbox-hover");' +
    '  var info=getElInfo(hovered);' +
    '  if(info)showTooltip(hovered,info);' +
    '},true);' +
    'document.addEventListener("mouseout",function(e){' +
    '  if(hovered){hovered.classList.remove("toolbox-hover");hovered=null;}' +
    '  hideTooltip();' +
    '},true);' +
    'document.addEventListener("click",function(e){' +
    '  e.preventDefault();e.stopPropagation();' +
    '  if(selected)selected.classList.remove("toolbox-selected");' +
    '  selected=e.target;' +
    '  selected.classList.add("toolbox-selected");' +
    '  var info=getElInfo(selected);' +
    '  if(info){' +
    '    window.parent.postMessage({action:"elementSelected",data:info},"*");' +
    '  }' +
    '},true);' +
    'document.addEventListener("keydown",function(e){' +
    '  if(e.key==="Escape"){' +
    '    if(selected){selected.classList.remove("toolbox-selected");selected=null;}' +
    '    window.parent.postMessage({action:"codeSelectCancelled"},"*");' +
    '  }' +
    '},true);' +
    'window.addEventListener("message",function(e){' +
    '  var msg=e.data;' +
    '  if(!msg||!msg.action)return;' +
    '  if(msg.action==="codeModifyElement"&&selected){' +
    '    var d=msg.data;' +
    '    switch(d.action){' +
    '      case"setAttr":selected.setAttribute(d.attr,d.value);break;' +
    '      case"removeAttr":selected.removeAttribute(d.attr);break;' +
    '      case"addClass":selected.classList.add(d.className);break;' +
    '      case"removeClass":selected.classList.remove(d.className);break;' +
    '      case"setInlineStyle":selected.style.setProperty(d.prop,d.value);break;' +
    '      case"setText":selected.textContent=d.value;break;' +
    '      case"setHtml":selected.innerHTML=d.value;break;' +
    '      case"removeElement":{' +
    '        var toRemove=selected;' +
    '        selected=null;' +
    '        if(toRemove&&toRemove.parentNode){toRemove.parentNode.removeChild(toRemove);}' +
    '        window.parent.postMessage({action:"elementDeleted",data:{success:true,source:"codePreview"}},"*");' +
    '        break;' +
    '      }' +
    '    }' +
    '    var info=getElInfo(selected);' +
    '    if(info)window.parent.postMessage({action:"elementSelected",data:info},"*");' +
    '  }' +
    '  if(msg.action==="codeClearSelection"){' +
    '    if(selected){selected.classList.remove("toolbox-selected");selected=null;}' +
    '  }' +
    '  if(msg.action==="codeSelectChild"&&msg.data&&msg.data.selector){' +
    '    var target=null;' +
    '    try{target=document.querySelector(msg.data.selector);}catch(err){}' +
    '    if(target){' +
    '      if(selected)selected.classList.remove("toolbox-selected");' +
    '      selected=target;' +
    '      selected.classList.add("toolbox-selected");' +
    '      selected.scrollIntoView({block:"center",behavior:"smooth"});' +
    '      var ci=getElInfo(selected);' +
    '      if(ci)window.parent.postMessage({action:"elementSelected",data:ci},"*");' +
    '    }' +
    '  }' +
    '});' +
    '})();' +
    '<\/script></body></html>';
}

/**
 * 向代码预览iframe发送修改消息
 */
function codeModify(action, value) {
  if (!E.codePreview || !E.codePreview.contentWindow) return;
  E.codePreview.contentWindow.postMessage({
    action: 'codeModifyElement',
    data: action
  }, '*');
}

// ==================== 选择模式（页面元素） ====================
function startSelection() {
  if (mode !== 'page') return;
  selecting = true;
  E.btnSelect.style.display = 'none';
  E.btnCancel.style.display = 'inline-flex';
  updateStatus('选择元素中... 点击元素确认 | 方向键导航 | 空格键锁定 | Esc取消', 'warn');
  post('startElementSelection');
}

function cancelSelection() {
  selecting = false;
  E.btnSelect.style.display = 'inline-flex';
  E.btnCancel.style.display = 'none';
  updateStatus('已取消', '');
  post('stopElementSelection');
  post('hideHighlight');
}

function refreshElement() {
  if (!el) return;
  updateStatus('刷新中...', '');
  if (el.source === 'codePreview') {
    // 代码模式下重新从预览获取
    renderCodePreview();
  } else {
    post('getElementInfo', { selector: el.selector });
    post('getDomTree');
  }
}

function scrollToElement() {
  if (!el) return;
  if (el.source === 'codePreview') {
    showToast('代码模式不支持定位', 'info');
    return;
  }
  post('highlightElement', { selector: el.selector, show: true, scroll: true });
  setTimeout(() => post('hideHighlight'), 3000);
}

async function copySelector() {
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.selector);
    showToast('选择器已复制', 'success');
  } catch(e) {
    showToast('复制失败', 'error');
  }
}

// 删除当前选中元素（支持页面模式和代码预览模式）
function deleteElement() {
  if (!el) return;
  // 二次确认，避免误删（注意：删除操作不可通过撤销恢复）
  const tagLabel = el.tag ? '<' + el.tag + '>' : '当前元素';
  if (!confirm('确定要删除 ' + tagLabel + ' 吗？此操作不可撤销，请谨慎操作。')) return;

  if (el.source === 'codePreview') {
    // 代码模式：通知预览iframe删除选中元素
    codeModify({ action: 'removeElement' });
    // 清除选中状态
    el = null;
    computed = {};
    clearAll();
    E.overview.style.display = 'none';
    E.tabs.style.display = 'none';
    E.previewHint.textContent = '元素已删除 — 点击预览中的元素可选中编辑';
    updateStatus('元素已删除', 'success');
  } else {
    // 页面模式：发送删除消息到内容脚本
    post('deleteElement', { selector: el.selector });
    updateStatus('正在删除元素...', '');
  }
}

// 更新删除按钮的可用状态
function updateDeleteButton() {
  if (E.btnDelete) E.btnDelete.disabled = !el;
}

// ==================== 标签页切换 ====================
function switchTab(name) {
  E.tabBtns.forEach(b => b.classList.toggle('ee-tab--active', b.dataset.tab === name));
  document.querySelectorAll('.ee-panel').forEach(p => p.classList.remove('ee-panel--active'));
  const panel = document.getElementById('panel-' + name);
  if (panel) panel.classList.add('ee-panel--active');

  if (name === 'styles' && el) {
    if (el.source === 'codePreview') {
      // 代码模式的样式已在 elementSelected 中处理
      if (Object.keys(computed).length > 0) renderStyles(computed, E.styleFilter.value);
    } else {
      post('getElementInfo', { selector: el.selector });
      setTimeout(() => { if (Object.keys(computed).length > 0) renderStyles(computed, E.styleFilter.value); }, 200);
    }
  }
  if (name === 'domtree' && el && el.source !== 'codePreview') post('getDomTree');
}

// ==================== 消息处理 ====================
function handleMessage(e) {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

  if (!e.data) return;
  // 接受来自父窗口（sidebar/injector）和代码预览 iframe 的消息
  // 代码预览 iframe 通过 window.parent.postMessage 发送消息时，e.source 是 iframe 的 contentWindow
  const codePreviewWin = E.codePreview ? E.codePreview.contentWindow : null;
  if (e.source !== window.parent && e.source !== codePreviewWin) return;
  const { action, data } = e.data || {};
  if (!action) return;

  switch (action) {
    case 'setTheme':
      if (data && data.theme) document.documentElement.setAttribute('data-theme', data.theme);
      break;

    case 'elementSelected':
      if (data) {
        el = data;
        selecting = false;
        E.btnSelect.style.display = mode === 'page' ? 'inline-flex' : 'none';
        E.btnCancel.style.display = 'none';
        const sourceLabel = data.source === 'codePreview' ? ' [代码]' : '';
        updateStatus('已选择: <' + data.tag + '>' + sourceLabel, 'success');
        renderAll(data);
        E.overview.style.display = 'block';
        E.tabs.style.display = 'flex';
        // 启用删除按钮
        updateDeleteButton();
        // 代码模式直接有样式数据
        if (data.styles) {
          computed = data.styles;
          renderStyles(computed, E.styleFilter.value);
        }
        if (data.source !== 'codePreview') {
          post('getDomTree');
        }
      }
      break;

    case 'elementComputed':
      if (data && data.styles) {
        computed = data.styles;
        renderStyles(computed, E.styleFilter.value);
      }
      break;

    case 'domTree':
      if (data) renderDomTree(data);
      break;

    case 'selectionComplete':
      selecting = false;
      E.btnSelect.style.display = mode === 'page' ? 'inline-flex' : 'none';
      E.btnCancel.style.display = 'none';
      if (data && data.cancelled) updateStatus('已取消', '');
      break;

    case 'elementDeleted':
      el = null;
      computed = {};
      clearAll();
      E.overview.style.display = 'none';
      E.tabs.style.display = 'none';
      updateDeleteButton();
      updateStatus('元素已删除', 'success');
      break;

    case 'codeSelectCancelled':
      el = null;
      computed = {};
      clearAll();
      E.overview.style.display = 'none';
      E.tabs.style.display = 'none';
      updateDeleteButton();
      E.previewHint.textContent = '选择已取消 — 点击预览中的元素可选中编辑';
      updateStatus('选择已取消', '');
      break;
  }
}

// ==================== 渲染 ====================
function renderAll(info) {
  // 标签
  E.tagName.textContent = '<' + escapeHtml(info.tag) + '>';
  const extra = [];
  if (info.id) extra.push('#' + escapeHtml(info.id));
  if (info.classes && info.classes.length) extra.push('.' + info.classes.map(escapeHtml).join('.'));
  E.tagInfo.textContent = extra.join(' ') || '';
  if (info.rect) {
    E.tagDim.textContent = Math.round(info.rect.width) + '\u00D7' + Math.round(info.rect.height) + 'px';
  }
  E.tagSelector.textContent = (info.selector || '').substring(0, 60);
  E.tagSelector.title = info.selector || '';

  // 面包屑
  if (info.path && info.path.length) {
    E.breadcrumb.innerHTML = info.path.map(p =>
      '<span class="ee-bc-item">' + escapeHtml(p.tag) + (p.id ? '#' + escapeHtml(p.id) : '') + '</span>'
    ).join(' \u203A ');
    // 面包屑点击事件（代码模式不支持导航）
    if (info.source !== 'codePreview') {
      E.breadcrumb.querySelectorAll('.ee-bc-item').forEach((item, idx) => {
        item.addEventListener('click', () => {
          let sel = info.path.slice(0, idx + 1).map((p, i) => {
            return escapeHtml(p.tag) + (p.id ? '#' + escapeHtml(p.id) : '') + (p.classes && p.classes.length ? '.' + escapeHtml(p.classes[0]) : '');
          }).join(' > ');
          post('getElementInfo', { selector: sel });
        });
      });
    }
  }

  // 属性
  renderAttrs(info.attrs || {});
  // 类名
  renderClasses(info.classes || []);
  // 盒模型
  renderBoxModel(info.boxModel);
  // 子元素
  renderChildren(info.children || []);
  // 内容
  if (E.htmlSource) {
    E.htmlSource.value = info.outerHTML || '';
    E.htmlSource.readOnly = true;
  }
  if (E.textContent) {
    E.textContent.value = info.textContent || info.text || '';
  }
  $('btn-edit-html').textContent = '✏️ 编辑HTML';
}

function clearAll() {
  try {
    E.tagName.textContent = '\u2014';
    E.tagInfo.textContent = '';
    E.tagDim.textContent = '';
    E.tagSelector.textContent = '';
    E.breadcrumb.innerHTML = '';
    E.attrs.innerHTML = '<div class="ee-empty">请选择一个元素</div>';
    E.classes.innerHTML = '<div class="ee-empty">请选择一个元素</div>';
    E.styles.innerHTML = '<div class="ee-empty">请选择一个元素</div>';
    E.boxModel.innerHTML = '<div class="ee-empty">请选择一个元素</div>';
    E.children.innerHTML = '<div class="ee-empty">请选择一个元素</div>';
    E.domTree.innerHTML = '<div class="ee-empty">请选择一个元素</div>';
    if (E.htmlSource) E.htmlSource.value = '';
    if (E.textContent) E.textContent.value = '';
    // 清空时禁用删除按钮
    updateDeleteButton();
  } catch(e) {
    console.error('[ElementsEditor] clearAll error:', e);
  }
}

// ==================== 属性面板 ====================
function renderAttrs(attrs) {
  const keys = Object.keys(attrs).filter(k => k !== 'data-toolbox-hidden');
  if (!keys.length) {
    E.attrs.innerHTML = '<div class="ee-empty">无属性</div>';
    return;
  }
  E.attrs.innerHTML = keys.map(k => {
    const v = escapeHtml(attrs[k] || '');
    return '<div class="ee-attr-row">' +
      '<span class="ee-attr-name">' + escapeHtml(k) + '</span>' +
      '<input class="ee-attr-input" value="' + v + '" data-attr="' + escapeHtml(k) + '">' +
      '<button class="ee-attr-btn set" title="保存" data-attr="' + escapeHtml(k) + '">\u2714</button>' +
      '<button class="ee-attr-btn del" title="删除" data-attr="' + escapeHtml(k) + '">\u2716</button>' +
      '</div>';
  }).join('');

  E.attrs.querySelectorAll('.ee-attr-btn.set').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.parentElement;
      const attrName = btn.dataset.attr;
      const input = row.querySelector('.ee-attr-input');
      if (el && el.source === 'codePreview') {
        codeModify({ action: 'setAttr', attr: attrName, value: input.value });
      } else {
        post('modifyElement', { selector: el.selector, action: 'setAttr', attr: attrName, value: input.value });
      }
      updateStatus('属性 ' + attrName + ' 已更新', 'success');
      if (el && el.source !== 'codePreview') setTimeout(refreshElement, 300);
    });
  });
  E.attrs.querySelectorAll('.ee-attr-btn.del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (el && el.source === 'codePreview') {
        codeModify({ action: 'removeAttr', attr: btn.dataset.attr });
      } else {
        post('modifyElement', { selector: el.selector, action: 'removeAttr', attr: btn.dataset.attr });
      }
      updateStatus('属性 ' + btn.dataset.attr + ' 已删除', 'success');
      if (el && el.source !== 'codePreview') setTimeout(refreshElement, 300);
    });
  });
}

function addAttribute() {
  const name = E.attrName.value.trim();
  const value = E.attrValue.value.trim();
  if (!name || !el) return;
  if (el.source === 'codePreview') {
    codeModify({ action: 'setAttr', attr: name, value: value });
  } else {
    post('modifyElement', { selector: el.selector, action: 'setAttr', attr: name, value: value });
  }
  E.attrName.value = '';
  E.attrValue.value = '';
  updateStatus('属性 ' + name + ' 已添加', 'success');
  if (el.source !== 'codePreview') setTimeout(refreshElement, 300);
}

// ==================== 类名面板 ====================
function renderClasses(cls) {
  if (!cls || !cls.length) {
    E.classes.innerHTML = '<div class="ee-empty">无CSS类</div>';
    return;
  }
  E.classes.innerHTML = cls.map(c =>
    '<span class="ee-cls-tag">' + escapeHtml(c) +
    '<button class="ee-cls-del" data-class="' + escapeHtml(c) + '">\u00D7</button></span>'
  ).join('');
  E.classes.querySelectorAll('.ee-cls-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.source === 'codePreview') {
        codeModify({ action: 'removeClass', className: btn.dataset.class });
      } else {
        post('modifyElement', { selector: el.selector, action: 'removeClass', className: btn.dataset.class });
      }
      updateStatus('类 .' + btn.dataset.class + ' 已删除', 'success');
      if (el.source !== 'codePreview') setTimeout(refreshElement, 300);
    });
  });
  E.classes.querySelectorAll('.ee-cls-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const btn = tag.querySelector('.ee-cls-del');
      if (btn) {
        if (el.source === 'codePreview') {
          codeModify({ action: 'removeClass', className: btn.dataset.class });
        } else {
          post('modifyElement', { selector: el.selector, action: 'removeClass', className: btn.dataset.class });
        }
        updateStatus('类 .' + btn.dataset.class + ' 已删除', 'success');
        if (el.source !== 'codePreview') setTimeout(refreshElement, 300);
      }
    });
  });
}

function addClass() {
  const name = E.className.value.trim();
  if (!name || !el) return;
  if (el.source === 'codePreview') {
    codeModify({ action: 'addClass', className: name });
  } else {
    post('modifyElement', { selector: el.selector, action: 'addClass', className: name });
  }
  E.className.value = '';
  updateStatus('类 .' + name + ' 已添加', 'success');
  if (el.source !== 'codePreview') setTimeout(refreshElement, 300);
}

// ==================== 样式面板 ====================
function renderStyles(styles, filter) {
  let entries = Object.entries(styles || {});
  if (filter) {
    const q = filter.toLowerCase();
    entries = entries.filter(([k]) => k.toLowerCase().includes(q));
  }
  if (!entries.length) {
    E.styles.innerHTML = '<div class="ee-empty">' + (filter ? '无匹配样式' : '请选择一个元素') + '</div>';
    return;
  }
  const cats = { layout: [], visual: [], text: [], other: [] };
  const lk = ['display','position','width','height','margin','padding','flex','grid','top','left','right','bottom','overflow','z-index'];
  const vk = ['color','background','border','opacity','box-shadow','transform','visibility','outline'];
  const tk = ['font','text','line-height','letter-spacing','white-space','word-'];
  entries.forEach(([k, v]) => {
    const lo = k.toLowerCase();
    if (lk.some(p => lo.indexOf(p) === 0)) cats.layout.push([k, v]);
    else if (vk.some(p => lo.indexOf(p) === 0)) cats.visual.push([k, v]);
    else if (tk.some(p => lo.indexOf(p) === 0)) cats.text.push([k, v]);
    else cats.other.push([k, v]);
  });
  const secs = [
    ['📐 布局', cats.layout], ['🎨 视觉', cats.visual],
    ['🔤 文字', cats.text], ['📦 其他', cats.other]
  ];
  E.styles.innerHTML = secs
    .filter(([, items]) => items.length)
    .map(([title, items]) =>
      '<div class="ee-sg">' +
      '<div class="ee-sg-title">' + title + '</div>' +
      items.map(([k, v]) =>
        '<div class="ee-sr">' +
        '<span class="ee-sr-prop">' + escapeHtml(k) + '</span>' +
        '<input class="ee-sr-val" value="' + escapeHtml(v) + '" data-prop="' + escapeHtml(k) + '">' +
        '</div>'
      ).join('') +
      '</div>'
    ).join('');

  E.styles.querySelectorAll('.ee-sr-val').forEach(inp => {
    inp.addEventListener('change', () => {
      if (!el) return;
      if (el.source === 'codePreview') {
        codeModify({ action: 'setInlineStyle', prop: inp.dataset.prop, value: inp.value });
      } else {
        post('modifyElement', {
          selector: el.selector,
          action: 'setInlineStyle',
          prop: inp.dataset.prop,
          value: inp.value
        });
      }
      updateStatus('样式 ' + inp.dataset.prop + ' 已更新', 'success');
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inp.blur();
      }
    });
  });
}

// ==================== 盒模型面板 ====================
function renderBoxModel(bm) {
  if (!bm) { E.boxModel.innerHTML = '<div class="ee-empty">无数据</div>'; return; }
  const rows = [
    ['Margin (外边距)', [
      Math.round(bm.marginTop), Math.round(bm.marginRight),
      Math.round(bm.marginBottom), Math.round(bm.marginLeft)
    ].join(' ')],
    ['Border (边框)', [
      Math.round(bm.borderTop), Math.round(bm.borderRight),
      Math.round(bm.borderBottom), Math.round(bm.borderLeft)
    ].join(' ')],
    ['Padding (内边距)', [
      Math.round(bm.paddingTop), Math.round(bm.paddingRight),
      Math.round(bm.paddingBottom), Math.round(bm.paddingLeft)
    ].join(' ')],
    ['Content (内容)', Math.round(bm.width) + '\u00D7' + Math.round(bm.height)],
    ['总尺寸', Math.round(bm.offsetWidth) + '\u00D7' + Math.round(bm.offsetHeight)],
  ];
  E.boxModel.innerHTML = rows.map(([label, val]) =>
    '<div class="ee-bm-row"><span>' + label + '</span><span>' + val + '</span></div>'
  ).join('');
}

// ==================== 子元素面板 ====================
function renderChildren(children) {
  if (!children || !children.length) {
    E.children.innerHTML = '<div class="ee-empty">无子元素</div>';
    return;
  }
  E.children.innerHTML = children.map((ch, i) =>
    '<div class="ee-child-row">' +
    '<span class="ee-child-tag">' + escapeHtml(ch.tag) + '</span>' +
    '<span class="ee-child-id">' + (ch.id ? '#' + escapeHtml(ch.id) : '') + '</span>' +
    '<span class="ee-child-cls">' + (ch.classes || []).map(c => '.' + escapeHtml(c)).join(' ') + '</span>' +
    '<button class="ee-btn ee-btn--secondary ee-btn--sm ee-child-sel">🔍 选择</button>' +
    '</div>'
  ).join('');
  E.children.querySelectorAll('.ee-child-sel').forEach((btn, i) => {
    btn.addEventListener('click', () => {
      if (!children[i]) return;
      if (el && el.source === 'codePreview') {
        // 代码模式：向预览 iframe 发送选中指令，由内置拾取脚本定位并高亮该子元素，
        // 再回传其完整信息。旧实现只提示"功能开发中"，属于名不副实。
        if (E.codePreview && E.codePreview.contentWindow) {
          E.codePreview.contentWindow.postMessage({
            action: 'codeSelectChild',
            data: { selector: children[i].selector }
          }, '*');
          updateStatus('已选中子元素: ' + children[i].tag, '');
        } else {
          showToast('请先在代码模式生成预览', 'error');
        }
      } else {
        post('getElementInfo', { selector: children[i].selector });
        updateStatus('正在选择子元素...', '');
      }
    });
  });
}

// ==================== DOM树面板 ====================
function renderDomTree(treeData) {
  if (!treeData || !treeData.children || !treeData.children.length) {
    E.domTree.innerHTML = '<div class="ee-empty">无数据</div>';
    return;
  }

  function build(node, depth) {
    depth = depth || 0;
    if (!node || depth > 8) return '';
    const kids = (node.children || []).map(c => build(c, depth + 1)).join('');
    const tag = node.tag || '';
    const id = node.id ? '#' + escapeHtml(node.id) : '';
    const cls = (node.classes || []).slice(0, 3).map(c => '.' + escapeHtml(c)).join('');
    const text = node.text ? ' "' + escapeHtml(node.text.substring(0, 30)) + '"' : '';
    return '<div class="ee-tn' + (depth > 3 ? ' ee-tnc' : '') + '" style="padding-left:' + (depth * 14) + 'px"' +
      ' data-tag="' + escapeHtml(tag) + '"' +
      ' data-id="' + escapeHtml(id.replace('#', '')) + '">' +
      '<span class="ee-tt">' + (kids ? '\u25B6' : ' ') + '</span>' +
      '<span class="ee-tta">' + escapeHtml(tag) + '</span>' +
      '<span class="ee-ti">' + escapeHtml(id + cls + text) + '</span>' +
      '</div>' + kids;
  }

  const root = treeData.children && treeData.children.length === 1
    ? treeData.children[0]
    : treeData;
  E.domTree.innerHTML = build(root, 0);

  E.domTree.querySelectorAll('.ee-tt').forEach(t => {
    t.addEventListener('click', (e) => {
      e.stopPropagation();
      const node = t.parentElement;
      const siblings = [];
      let sib = node.nextElementSibling;
      const myDepth = parseInt(node.style.paddingLeft, 10) || 0;
      while (sib && (parseInt(sib.style.paddingLeft, 10) || 0) > myDepth) {
        siblings.push(sib);
        sib = sib.nextElementSibling;
      }
      const collapsed = node.classList.contains('ee-tnc');
      if (collapsed) {
        node.classList.remove('ee-tnc');
        t.textContent = '\u25BC';
        siblings.forEach(s => s.style.display = '');
      } else {
        node.classList.add('ee-tnc');
        t.textContent = '\u25B6';
        siblings.forEach(s => s.style.display = 'none');
      }
    });
  });

  E.domTree.querySelectorAll('.ee-tta').forEach(tag => {
    tag.style.cursor = 'pointer';
    tag.addEventListener('click', (e) => {
      e.stopPropagation();
      const node = tag.parentElement;
      const tagName = node.dataset.tag;
      const idVal = node.dataset.id;
      let selector = tagName;
      if (idVal) selector += '#' + idVal;
      post('getElementInfo', { selector: selector });
      updateStatus('正在选择...', '');
    });
  });
}

// ==================== 内容编辑 ====================
function toggleHtmlEdit() {
  if (!el) return;
  const btn = $('btn-edit-html');
  if (btn.textContent.includes('编辑')) {
    E.htmlSource.readOnly = false;
    E.htmlSource.focus();
    btn.textContent = '💾 应用HTML';
    btn.classList.add('ee-btn--primary');
    btn.classList.remove('ee-btn--secondary');
    updateStatus('编辑模式：修改HTML后点击"应用HTML"保存', 'warn');
  } else {
    const newHtml = E.htmlSource.value;
    if (el.source === 'codePreview') {
      codeModify({ action: 'setHtml', value: newHtml });
    } else {
      post('modifyElement', { selector: el.selector, action: 'setHtml', value: newHtml });
    }
    E.htmlSource.readOnly = true;
    btn.textContent = '✏️ 编辑HTML';
    btn.classList.remove('ee-btn--primary');
    btn.classList.add('ee-btn--secondary');
    updateStatus('HTML已更新', 'success');
    if (el.source !== 'codePreview') setTimeout(refreshElement, 400);
  }
}

async function copyHtml() {
  if (!el || !el.outerHTML) return;
  try {
    await navigator.clipboard.writeText(el.outerHTML);
    showToast('HTML已复制', 'success');
  } catch(e) { showToast('复制失败', 'error'); }
}

function saveTextContent() {
  if (!el) return;
  const text = E.textContent.value;
  if (el.source === 'codePreview') {
    codeModify({ action: 'setText', value: text });
  } else {
    post('modifyElement', { selector: el.selector, action: 'setText', value: text });
  }
  updateStatus('文本内容已更新', 'success');
  if (el.source !== 'codePreview') setTimeout(refreshElement, 400);
}

async function copyText() {
  if (!el) return;
  try {
    await navigator.clipboard.writeText(E.textContent.value || el.text || '');
    showToast('文本已复制', 'success');
  } catch(e) { showToast('复制失败', 'error'); }
}

// ==================== 工具函数 ====================
function updateStatus(msg, type) {
  E.status.textContent = msg;
  E.status.className = 'ee-status';
  if (type) E.status.classList.add('ee-status--' + type);
}

function showToast(msg, type) {
  type = type || 'info';
  E.toast.textContent = msg;
  E.toast.className = 'ee-toast ee-toast--show ee-toast--' + type;
  setTimeout(() => E.toast.classList.remove('ee-toast--show'), 2500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==================== 启动 ====================
document.addEventListener('DOMContentLoaded', init);

})();