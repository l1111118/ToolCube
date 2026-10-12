/**
 * ToolCube - 用户协议与首次使用管理
 * @version 1.3.0
 */

import { getI18n, TERMS } from './i18n.js';

const STORAGE_KEY = 'toolbox_terms_v1';
const FIRST_RUN_KEY = 'toolbox_first_run_done_v1';

export class TermsManager {
  constructor() {
    this.i18n = getI18n();
  }

  /**
   * 是否已同意协议（首次使用判定）
   * @returns {Promise<boolean>}
   */
  async hasAccepted() {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const data = result[STORAGE_KEY];
      if (!data) return false;
      return data.accepted === true;
    } catch (e) {
      console.error('[Terms] hasAccepted error:', e);
      return false;
    }
  }

  /**
   * 同意协议
   */
  async accept() {
    const locale = this.i18n.getCurrentLocale();
    const data = {
      accepted: true,
      acceptedAt: Date.now(),
      version: 1,
      locale
    };
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
      await chrome.storage.local.set({ [FIRST_RUN_KEY]: true });
      return true;
    } catch (e) {
      console.error('[Terms] accept error:', e);
      return false;
    }
  }

  /**
   * 不同意协议（清除记录，下次启动会再次弹窗）
   */
  async reject() {
    try {
      await chrome.storage.local.remove([STORAGE_KEY, FIRST_RUN_KEY]);
      return true;
    } catch (e) {
      console.error('[Terms] reject error:', e);
      return false;
    }
  }

  /**
   * 获取当前应显示的协议文案（根据浏览器语言自动选择）
   * @returns {{ content: string, locale: string }}
   */
  getTermsContent() {
    const locale = this.i18n.getCurrentLocale();
    const content = TERMS[locale] || TERMS['en'];
    const localeName = this.i18n.getTermsLocale();
    return { content, locale, localeName };
  }

  /**
   * 是否检测到"首次使用"
   * 规则：从未记录过协议同意状态 OR 数据被清除
   */
  async isFirstRun() {
    return !(await this.hasAccepted());
  }
}

/**
 * 渲染用户协议弹窗
 * @param {Object} options
 * @param {Function} options.onAgree - 同意回调
 * @param {Function} options.onDisagree - 不同意回调
 * @returns {HTMLElement}
 */
export function renderTermsModal({ onAgree, onDisagree }) {
  const i18n = getI18n();
  const { content, localeName } = (new TermsManager()).getTermsContent();

  const overlay = document.createElement('div');
  overlay.className = 'terms-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'terms-title');

  // 锁定背景滚动
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  overlay.innerHTML = `
    <div class="terms-modal">
      <div class="terms-modal__header">
        <div class="terms-modal__title-wrap">
          <span class="terms-modal__icon">📋</span>
          <h2 class="terms-modal__title" id="terms-title">${escapeHtml(i18n.t('terms.title', '用户协议'))}</h2>
        </div>
        <div class="terms-modal__lang-badge" title="协议语言">${escapeHtml(localeName)}</div>
      </div>
      <p class="terms-modal__subtitle">${escapeHtml(i18n.t('terms.subtitle', '使用前请阅读并同意以下协议条款'))}</p>
      <div class="terms-modal__body" id="terms-body" tabindex="0">
        <pre class="terms-modal__content">${escapeHtml(content)}</pre>
      </div>
      <div class="terms-modal__hint" id="terms-scroll-hint">${escapeHtml(i18n.t('terms.scrollHint', '请向下滚动阅读完整协议'))}</div>
      <div class="terms-modal__footer">
        <button type="button" class="terms-modal__btn terms-modal__btn--disagree" id="terms-btn-disagree">
          ${escapeHtml(i18n.t('terms.disagree', '不同意'))}
        </button>
        <button type="button" class="terms-modal__btn terms-modal__btn--agree" id="terms-btn-agree" disabled>
          ${escapeHtml(i18n.t('terms.agree', '同意'))}
        </button>
      </div>
      <p class="terms-modal__notice">${escapeHtml(i18n.t('terms.notice', '点击「不同意」将无法使用本扩展程序'))}</p>
    </div>
  `;

  const body = overlay.querySelector('#terms-body');
  const agreeBtn = overlay.querySelector('#terms-btn-agree');
  const disagreeBtn = overlay.querySelector('#terms-btn-disagree');
  const hint = overlay.querySelector('#terms-scroll-hint');

  // 滚动到底部后启用「同意」按钮
  function checkScroll() {
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 8;
    if (atBottom) {
      agreeBtn.disabled = false;
      hint.style.display = 'none';
    } else {
      agreeBtn.disabled = true;
      hint.style.display = '';
    }
  }
  body.addEventListener('scroll', checkScroll);
  // 初始检测（短内容时无需滚动）
  // 使用 setTimeout 确保 DOM 渲染完成
  setTimeout(checkScroll, 50);

  agreeBtn.addEventListener('click', async () => {
    const tm = new TermsManager();
    await tm.accept();
    document.body.style.overflow = prevOverflow;
    overlay.remove();
    if (typeof onAgree === 'function') onAgree();
  });

  disagreeBtn.addEventListener('click', async () => {
    const tm = new TermsManager();
    await tm.reject();
    document.body.style.overflow = prevOverflow;
    overlay.remove();
    if (typeof onDisagree === 'function') onDisagree();
  });

  // 阻止点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      // 不允许点击外部关闭
      e.stopPropagation();
    }
  });

  return overlay;
}

/**
 * 锁定主界面的样式（不同意时显示）
 */
export function showLockedScreen() {
  const i18n = getI18n();
  const lock = document.createElement('div');
  lock.className = 'terms-locked-screen';
  lock.innerHTML = `
    <div class="terms-locked-screen__inner">
      <div class="terms-locked-screen__icon">🔒</div>
      <h2 class="terms-locked-screen__title">${escapeHtml(i18n.t('locked.title', '未同意用户协议'))}</h2>
      <p class="terms-locked-screen__desc">${escapeHtml(i18n.t('locked.desc', '您需要先同意用户协议才能使用本扩展程序'))}</p>
      <button type="button" class="terms-locked-screen__btn" id="terms-reopen">
        ${escapeHtml(i18n.t('locked.btn', '阅读并同意协议'))}
      </button>
    </div>
  `;
  lock.querySelector('#terms-reopen').addEventListener('click', () => {
    window.location.reload();
  });
  document.body.appendChild(lock);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export default TermsManager;
