/**
 * ToolCube - 字符串统计
 *
 * 统计一段文本的 10 项指标：总字符数、字符数（无空格）、单词数、行数、句子数、
 * UTF-8 字节数、中文字符数、数字个数、空格数、特殊字符数。
 *
 * 统计逻辑集中在纯函数 `analyzeText` 中（不触碰 DOM），既便于单测，也避免
 * 渲染与计算混在一起。测试见 `tools/_test-string-counter.mjs`。
 *
 * @version 1.3.0
 */

/** 指标键 → 页面元素 id（`stat-` + 键） */
const METRIC_KEYS = [
  'chars', 'nospace', 'words', 'lines', 'sentences',
  'bytes', 'chinese', 'digits', 'spaces', 'specials'
];

/** 中文字符范围（CJK 统一表意文字基本区） */
const CJK_RE = /[\u4e00-\u9fff]/g;
/** 句子切分：以 . ! ? 结尾的片段 */
const SENTENCE_RE = /[^.!?]+[.!?]+/g;
/** 特殊字符：既不是字母数字下划线、也不是空白、也不是中文 */
const SPECIAL_RE = /[^\w\s\u4e00-\u9fff]/g;

/**
 * 统计文本的各项指标
 * @param {string} text
 * @returns {{chars:number,nospace:number,words:number,lines:number,sentences:number,bytes:number,chinese:number,digits:number,spaces:number,specials:number}}
 */
function analyzeText(text) {
  const t = String(text == null ? '' : text);
  const countOf = (re) => {
    const m = t.match(re);
    return m ? m.length : 0;
  };
  return {
    chars: t.length,
    nospace: t.replace(/\s/g, '').length,
    // 空文本（或纯空白）词数为 0，避免 split 后得到 1
    words: t.trim() ? t.trim().split(/\s+/).length : 0,
    // 空文本行数为 0，非空按换行符切分（无换行则为 1 行）
    lines: t ? t.split('\n').length : 0,
    sentences: countOf(SENTENCE_RE),
    // 字节数按 UTF-8 计算（中文 3 字节、emoji 4 字节），与「字符数」区分开
    bytes: new TextEncoder().encode(t).length,
    chinese: countOf(CJK_RE),
    digits: countOf(/\d/g),
    spaces: countOf(/\s/g),
    specials: countOf(SPECIAL_RE)
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('input-area');
  const inputStatus = document.getElementById('input-status');
  const autoButton = document.getElementById('btn-auto');
  let autoEnabled = false;

  /** 计算并写入界面 */
  function render() {
    const text = input.value;
    const stats = analyzeText(text);
    for (const key of METRIC_KEYS) {
      document.getElementById('stat-' + key).textContent = stats[key];
    }
    inputStatus.textContent = text.length + '字符';
  }

  document.getElementById('btn-count').addEventListener('click', render);

  autoButton.addEventListener('click', () => {
    autoEnabled = !autoEnabled;
    autoButton.textContent = autoEnabled ? '🔄自动统计(开)' : '🔄自动统计';
    if (autoEnabled) render();
  });

  input.addEventListener('input', () => {
    if (autoEnabled) render();
    // 状态栏始终跟随输入更新，即使未开启自动统计
    inputStatus.textContent = input.value.length + '字符';
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    input.value = '';
    render();
  });

  document.getElementById('btn-paste').addEventListener('click', () => {
    navigator.clipboard.readText().then((text) => {
      input.value = text;
      render();
    }).catch(() => {});
  });

  document.getElementById('btn-copy-stats').addEventListener('click', () => {
    const lines = METRIC_KEYS.map((key) => {
      const el = document.getElementById('stat-' + key);
      const label = el.parentElement.querySelector('.stat-label').textContent;
      return label + ': ' + el.textContent;
    });
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
  });

  render();
});

// 主题切换与外部数据注入：由侧边栏宿主下发
window.addEventListener('message', function (e) {
  if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）
  if (!e.data || e.source !== window.parent) return;
  if (e.data.action === 'setTheme' && e.data.data) {
    document.documentElement.setAttribute('data-theme', e.data.data.theme);
  }
  if (e.data.action === 'setData') {
    const el = document.getElementById('input-area');
    if (el && typeof e.data.data === 'string') {
      el.value = e.data.data;
      el.dispatchEvent(new Event('input'));
    }
  }
});
