/**
 * ToolCube - 颜色对比度（WCAG 2.1 对比度检查）
 *
 * 计算前景/背景色的对比度并给出 WCAG 等级判定。
 *
 * 算法依据 WCAG 2.1 规范：
 *   - 相对亮度 = 0.2126R + 0.7152G + 0.0722B，其中每个通道先做 sRGB 反伽马变换；
 *   - 对比度 = (L1 + 0.05) / (L2 + 0.05)，L1 取较亮的一方；
 *   - 阈值：普通文本 ≥4.5:1（AA）、≥7:1（AAA）；大文本（≥18pt 或 14pt 粗体）≥3:1。
 *
 * @version 1.3.0
 */

/** WCAG 等级判定阈值（自上而下取第一个满足的） */
const WCAG_THRESHOLDS = [
  { min: 7, label: '✅ AAA级 - 极佳', className: 'cc-level rating-aaa' },
  { min: 4.5, label: '✅ AA级 - 良好', className: 'cc-level rating-aa' },
  { min: 3, label: '⚠️ A级 - 勉强可读', className: 'cc-level rating-a' }
];
/** 未达到任何阈值时的判定 */
const WCAG_FAIL = { label: '❌ 不合格 - 难以阅读', className: 'cc-level rating-fail' };
/** 标准说明与示例文本 */
const WCAG_STANDARD_TEXT = 'WCAG标准: 大文本≥3:1 | 普通文本≥4.5:1 | AAA≥7:1';
const SAMPLE_LABELS = ['大文本', '普通文本', '图标'];
const PREVIEW_SAMPLE_TEXT = '示例文本 Sample';

/**
 * HEX 颜色转 RGB（支持 `#rgb` / `#rrggbb`，有无 `#` 均可）
 * @param {string} hex
 * @returns {{r:number,g:number,b:number}}
 */
function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.substr(0, 2), 16),
    g: parseInt(h.substr(2, 2), 16),
    b: parseInt(h.substr(4, 2), 16)
  };
}

/**
 * 单个 sRGB 通道的线性化（WCAG 规定的反伽马变换）
 * @param {number} channel 0-255
 * @returns {number} 0-1
 */
function linearizeChannel(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * 相对亮度（WCAG 定义）
 * @param {string} hex
 * @returns {number} 0-1
 */
function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  return 0.2126 * linearizeChannel(rgb.r)
    + 0.7152 * linearizeChannel(rgb.g)
    + 0.0722 * linearizeChannel(rgb.b);
}

/**
 * 对比度（结果恒 ≥1，与前景/背景的传入顺序无关）
 * @param {string} colorA
 * @param {string} colorB
 * @returns {number}
 */
function contrastRatio(colorA, colorB) {
  const l1 = Math.max(relativeLuminance(colorA), relativeLuminance(colorB));
  const l2 = Math.min(relativeLuminance(colorA), relativeLuminance(colorB));
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * 按对比度取 WCAG 等级
 * @param {number} ratio
 * @returns {{label:string, className:string}}
 */
function wcagLevel(ratio) {
  for (const t of WCAG_THRESHOLDS) {
    if (ratio >= t.min) return { label: t.label, className: t.className };
  }
  return { label: WCAG_FAIL.label, className: WCAG_FAIL.className };
}

document.addEventListener('DOMContentLoaded', () => {
  const bgColor = document.getElementById('bg-color');
  const textColor = document.getElementById('text-color');
  const bgHex = document.getElementById('bg-hex');
  const textHex = document.getElementById('text-hex');
  const previewBg = document.getElementById('preview-bg');
  const previewText = document.getElementById('preview-text');
  const scoreEl = document.getElementById('cc-score');
  const levelEl = document.getElementById('cc-level');
  const ratioEl = document.getElementById('cc-ratio');
  const samplesEl = document.getElementById('cc-samples');

  // 两个预览面板的样式（.cc-preview）是为「展示一段文字」而设计的（内边距 + 居中 + 18px 字号），
  // 但 HTML 中它们是空元素 —— 不填文字就只是两块纯色，看不到配色效果。
  // 这里补上示例文字：左格为「文字色画在背景色上」，右格为其反色，便于直接目视判断。
  previewBg.textContent = PREVIEW_SAMPLE_TEXT;
  previewText.textContent = PREVIEW_SAMPLE_TEXT;

  /** 重新计算并刷新界面 */
  function update() {
    const bg = bgColor.value;
    const fg = textColor.value;

    bgHex.value = bg.toUpperCase();
    textHex.value = fg.toUpperCase();

    previewBg.style.background = bg;
    previewBg.style.color = fg;
    previewText.style.background = fg;
    previewText.style.color = bg;

    const ratio = contrastRatio(fg, bg);
    scoreEl.textContent = ratio.toFixed(2);

    const level = wcagLevel(ratio);
    levelEl.textContent = level.label;
    levelEl.className = level.className;

    ratioEl.innerHTML = WCAG_STANDARD_TEXT;
    samplesEl.innerHTML = SAMPLE_LABELS.map(label =>
      '<div class=cc-sample style=background:' + bg + ';color:' + fg + '>'
      + label + ' (' + ratio.toFixed(1) + ':1)</div>'
    ).join('');
  }

  bgColor.addEventListener('input', update);
  textColor.addEventListener('input', update);

  // HEX 输入框：仅在输入完整合法的 6 位色值时同步，避免中途输入导致抖动
  bgHex.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(bgHex.value)) {
      bgColor.value = bgHex.value;
      update();
    }
  });
  textHex.addEventListener('input', () => {
    if (/^#[0-9a-fA-F]{6}$/.test(textHex.value)) {
      textColor.value = textHex.value;
      update();
    }
  });

  document.getElementById('btn-swap').addEventListener('click', () => {
    const tmp = bgColor.value;
    bgColor.value = textColor.value;
    textColor.value = tmp;
    update();
  });

  document.getElementById('btn-random').addEventListener('click', () => {
    const randomHex = () => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    bgColor.value = randomHex();
    textColor.value = randomHex();
    update();
  });

  document.getElementById('btn-copy-result').addEventListener('click', () => {
    navigator.clipboard
      .writeText('背景:' + bgColor.value + ' 文字:' + textColor.value + ' 对比度:' + scoreEl.textContent + ':1')
      .catch(() => {});
  });

  update();
});

// 主题切换：由侧边栏宿主下发
window.addEventListener('message', function (e) {
  if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）
  if (!e.data || e.source !== window.parent) return;
  if (e.data.action === 'setTheme' && e.data.data) {
    document.documentElement.setAttribute('data-theme', e.data.data.theme);
  }
});
