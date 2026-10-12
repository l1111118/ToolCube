/**
 * Text Diff Tool - 文本差异对比
 * 基于LCS算法进行逐行对比
 */
document.addEventListener('DOMContentLoaded', () => {
  const leftInput = document.getElementById('input-left');
  const rightInput = document.getElementById('input-right');
  const output = document.getElementById('diff-output');
  const stats = document.getElementById('diff-stats');

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function linesEqual(a, b, ignoreCase) {
    if (ignoreCase) return a.toLowerCase() === b.toLowerCase();
    return a === b;
  }

  /**
   * 精确 LCS 的 DP 表规模上限（单元格数）。
   * 超过该规模时内存占用与耗时都会急剧上升（4000×4000 已是 1600 万格），
   * 此时给出明确提示，而不是让界面长时间卡死。
   */
  const MAX_DIFF_CELLS = 16000000;

  /**
   * 逐行 LCS
   *
   * 优化 1：先剥离公共前缀与公共后缀 —— 这两部分必然可以出现在某个最优 LCS 中，
   *   因此可以安全地在剩余部分上求 LCS 再拼回。典型"只改了几行"的场景下，
   *   中间部分极小，复杂度接近 O(n)，避免了对整篇文本做 O(m·n) 计算。
   * 优化 2：DP 使用扁平 Uint32Array 而非「二维普通数组」，
   *   省去 m+1 个内层数组对象与大量 double 装箱，内存与 GC 压力显著下降。
   *
   * @param {string[]} a
   * @param {string[]} b
   * @param {boolean} ignoreCase
   * @returns {{lcs: string[]|null, tooLarge: boolean}}
   */
  function buildLCS(a, b, ignoreCase) {
    let start = 0;
    while (start < a.length && start < b.length && linesEqual(a[start], b[start], ignoreCase)) start++;

    let endA = a.length, endB = b.length;
    while (endA > start && endB > start && linesEqual(a[endA - 1], b[endB - 1], ignoreCase)) { endA--; endB--; }

    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    const m = midA.length, n = midB.length;

    let midLcs = [];
    if (m > 0 && n > 0) {
      if (m * n > MAX_DIFF_CELLS) return { lcs: null, tooLarge: true };
      const width = n + 1;
      const dp = new Uint32Array((m + 1) * width);
      for (let i = 1; i <= m; i++) {
        const rowBase = i * width;
        const prevBase = (i - 1) * width;
        for (let j = 1; j <= n; j++) {
          if (linesEqual(midA[i - 1], midB[j - 1], ignoreCase)) {
            dp[rowBase + j] = dp[prevBase + j - 1] + 1;
          } else {
            const up = dp[prevBase + j];
            const left = dp[rowBase + j - 1];
            dp[rowBase + j] = up >= left ? up : left;
          }
        }
      }
      // 回溯构建 LCS
      let i = m, j = n;
      while (i > 0 && j > 0) {
        if (linesEqual(midA[i - 1], midB[j - 1], ignoreCase)) {
          midLcs.unshift(midA[i - 1]);
          i--; j--;
        } else if (dp[(i - 1) * width + j] >= dp[i * width + j - 1]) {
          i--;
        } else {
          j--;
        }
      }
    }

    return { lcs: a.slice(0, start).concat(midLcs, a.slice(endA)), tooLarge: false };
  }

  /**
   * 折叠行内空白（含不换行空格）并去除每行首尾空白，保留换行结构。
   * 用于「忽略空白差异」：只忽略缩进与多余空格，不改变行数。
   */
  function normalizeWhitespace(text) {
    return text
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
      .join('\n')
      .trim();
  }

  function performDiff() {
    const textL = leftInput.value;
    const textR = rightInput.value;
    const ignoreCase = document.getElementById('ignore-case').checked;
    const ignoreWhitespace = document.getElementById('ignore-whitespace').checked;

    let leftText = textL;
    let rightText = textR;

    if (ignoreWhitespace) {
      // 只折叠「行内」空白并去掉行首尾空白，必须保留换行结构。
      // 旧实现用 /\s+/g 连换行一起折叠，整个文本被压成一行，逐行对比因此完全失效。
      leftText = normalizeWhitespace(leftText);
      rightText = normalizeWhitespace(rightText);
    }

    const linesL = leftText.split('\n');
    const linesR = rightText.split('\n');
    const lcsResult = buildLCS(linesL, linesR, ignoreCase);
    if (lcsResult.tooLarge) {
      output.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tt-text-muted)">'
        + `文本差异过大（${linesL.length} 行 × ${linesR.length} 行），超出精确对比范围。<br>`
        + '请缩小对比范围，或先精简两侧内容后重试。</div>';
      stats.textContent = '';
      return;
    }
    const lcs = lcsResult.lcs;

    const result = [];
    let added = 0, removed = 0;
    let i = 0, j = 0, k = 0;

    while (i < linesL.length || j < linesR.length) {
      if (k < lcs.length && i < linesL.length && j < linesR.length &&
          linesEqual(linesL[i], linesR[j], ignoreCase)) {
        result.push(`<div class="diff-line" style="color:var(--tt-text)">  ${esc(linesL[i])}</div>`);
        i++; j++; k++;
      } else if (k < lcs.length && i < linesL.length &&
                 !linesEqual(linesL[i], lcs[k], ignoreCase)) {
        result.push(`<div class="diff-line diff-line--removed">- ${esc(linesL[i])}</div>`);
        removed++; i++;
      } else if (j < linesR.length) {
        result.push(`<div class="diff-line diff-line--added">+ ${esc(linesR[j])}</div>`);
        added++; j++;
      } else if (i < linesL.length) {
        result.push(`<div class="diff-line diff-line--removed">- ${esc(linesL[i])}</div>`);
        removed++; i++;
      } else {
        break;
      }
    }

    if (result.length === 0) {
      output.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tt-text-muted)">两个文本完全相同</div>';
    } else {
      output.innerHTML = result.join('');
    }

    stats.textContent = `增加: ${added}行 | 删除: ${removed}行 | 变化: ${added + removed}行`;
  }

  document.getElementById('btn-diff').addEventListener('click', performDiff);
  document.getElementById('btn-swap').addEventListener('click', () => {
    const tmp = leftInput.value;
    leftInput.value = rightInput.value;
    rightInput.value = tmp;
  });
  document.getElementById('btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.innerText);
    } catch(e) {}
  });
  document.getElementById('btn-clear').addEventListener('click', () => {
    leftInput.value = '';
    rightInput.value = '';
    output.innerHTML = '<div style="text-align:center;padding:40px;color:var(--tt-text-muted)">输入两个文本后点击对比差异</div>';
    stats.textContent = '';
  });
  document.getElementById('btn-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      rightInput.value = text;
    } catch(e) {}
  });

  // 主题切换
  window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return; // 只接受来自本扩展的页面（防止被第三方站点嵌入后驱动）

    if (!e.data || e.source !== window.parent) return;
    if (e.data && e.data.action === 'setTheme' && e.data.data) {
      document.documentElement.setAttribute('data-theme', e.data.data.theme);
    }
    if (e.data && e.data.action === 'setData' && typeof e.data.data === 'string') {
      leftInput.value = e.data.data;
      leftInput.dispatchEvent(new Event('input'));
    }
  });
});
