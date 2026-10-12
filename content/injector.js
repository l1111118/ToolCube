/**
 * ToolCube - Content Injector
 * 页面注入脚本，负责注入侧边栏和管理页面交互
 * @version 1.3.0
 */

(function() {
  'use strict';

  // 仅在顶层窗口运行，避免在 iframe 中创建多余的悬浮按钮和侧边栏
  if (window.top !== window.self) {
    return;
  }

  // 防止重复注入
  if (window.__toolboxInjected) {
    console.log('[ToolCube] Already injected, skipping...');
    return;
  }
  window.__toolboxInjected = true;

  // 检查扩展上下文是否仍然有效（扩展更新/重载后上下文会失效）
  function isContextValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // ==================== 配置常量 ====================
  const CONFIG = {
    SIDEBAR_ID: 'toolbox-sidebar',
    CONTAINER_ID: 'toolbox-container',
    IFRAME_ID: 'toolbox-iframe',
    TOGGLE_BTN_ID: 'toolbox-toggle-btn',
    DEFAULT_WIDTH: 400,
    MIN_WIDTH: 320,
    MAX_WIDTH: 800,
    ANIMATION_DURATION: 300
  };

  // ==================== 状态管理 ====================
  const state = {
    isOpen: false,
    width: CONFIG.DEFAULT_WIDTH,
    position: 'right',
    currentTool: null,
    isDragging: false,
    isResizing: false,
    masterEnabled: true, // 全局开关状态
    showFloatingBtn: true // 悬浮按钮显示状态（loadSettings 会覆盖）
  };

  // ==================== DOM 元素创建 ====================

  /**
   * 创建侧边栏容器
   */
  function createSidebar() {
    // 检查是否已存在
    if (document.getElementById(CONFIG.SIDEBAR_ID)) {
      return;
    }

    // 创建主容器
    const sidebar = document.createElement('div');
    sidebar.id = CONFIG.SIDEBAR_ID;
    sidebar.className = 'toolbox-sidebar toolbox-sidebar--closed';
    sidebar.style.cssText = `
      position: fixed;
      top: 0;
      ${state.position}: 0;
      width: ${state.width}px;
      height: 100vh;
      z-index: 2147483646;
      background: var(--toolbox-bg, #ffffff);
      border: none !important;
      outline: none !important;
      box-shadow: -2px 0 24px rgba(0, 0, 0, 0.1);
      transition: transform ${CONFIG.ANIMATION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      display: flex;
      flex-direction: column;
      border-radius: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
    `;

    // 创建iframe加载工具内容
    const iframe = document.createElement('iframe');
    iframe.id = CONFIG.IFRAME_ID;
    iframe.src = chrome.runtime.getURL('content/sidebar.html');
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: none;
      background: transparent;
    `;
    iframe.allow = 'clipboard-read; clipboard-write';

    // 创建调整大小的手柄
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'toolbox-resize-handle';
    resizeHandle.style.cssText = `
      position: absolute;
      top: 0;
      ${state.position === 'right' ? 'left' : 'right'}: 0;
      width: 4px;
      height: 100%;
      cursor: ${state.position === 'right' ? 'w-resize' : 'e-resize'};
      background: transparent;
      transition: background 0.2s;
      z-index: 10;
    `;

    // 调整大小事件
    resizeHandle.addEventListener('mousedown', initResize);
    resizeHandle.addEventListener('mouseenter', () => {
      resizeHandle.style.background = 'var(--toolbox-primary, #5b7fff)';
    });
    resizeHandle.addEventListener('mouseleave', () => {
      if (!state.isResizing) {
        resizeHandle.style.background = 'transparent';
      }
    });

    sidebar.appendChild(iframe);
    sidebar.appendChild(resizeHandle);

    // 拖拽关闭区域（点击外部关闭）
    const overlay = document.createElement('div');
    overlay.id = 'toolbox-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.3);
      z-index: 2147483645;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s, visibility 0.3s;
    `;
    overlay.addEventListener('click', closeSidebar);

    document.body.appendChild(overlay);
    document.body.appendChild(sidebar);

    // 加载设置
    loadSettings();

    console.log('[ToolCube] Sidebar created');
  }

  /**
   * 创建浮动切换按钮
   */
  function createToggleButton() {
    if (document.getElementById(CONFIG.TOGGLE_BTN_ID)) {
      return;
    }

    const btn = document.createElement('button');
    btn.id = CONFIG.TOGGLE_BTN_ID;
    btn.className = 'toolbox-toggle-btn';
    btn.innerHTML = '🔧';
    btn.title = 'ToolCube (点击打开 | 右键菜单 | Ctrl+Shift+B)';
    btn.style.cssText = `
      position: fixed;
      ${state.position}: 20px;
      bottom: 20px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: var(--toolbox-primary, #5b7fff);
      color: white;
      border: none;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      cursor: pointer;
      z-index: 2147483640;
      font-size: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
    `;

    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.1)';
      btn.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.4)';
    });

    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'scale(1)';
      btn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
    });

    // 使用闭包变量追踪是否刚刚被拖拽，避免首次点击被吞
    let suppressNextClick = false;

    // 左键点击打开/关闭ToolCube（仅非拖拽时）
    btn.addEventListener('click', (e) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      e.stopPropagation();
      toggleSidebar();
    });

    // 右键菜单
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showToggleButtonMenu(e);
    });

    // 拖拽功能
    makeDraggable(btn, () => { suppressNextClick = true; });

    document.body.appendChild(btn);

    // 恢复用户保存的位置
    applySavedButtonPosition(btn);

    console.log('[ToolCube] Toggle button created');
  }

  /**
   * 重置按钮位置到默认位置（右上/右下角）
   */
  function resetButtonPosition() {
    try {
      if (isContextValid()) {
        chrome.storage.local.remove('toolbox_button_position');
      }
      const btn = document.getElementById(CONFIG.TOGGLE_BTN_ID);
      if (btn) {
        btn.style.left = 'auto';
        btn.style.right = state.position === 'right' ? '20px' : 'auto';
        btn.style.left = state.position === 'left' ? '20px' : 'auto';
        btn.style.top = 'auto';
        btn.style.bottom = '20px';
      }
    } catch (error) {
      console.error('[ToolCube] Failed to reset button position:', error);
    }
  }

  /**
   * 恢复按钮保存位置
   */
  async function applySavedButtonPosition(btn) {
    try {
      if (!isContextValid()) return;
      const result = await chrome.storage.local.get('toolbox_button_position');
      const pos = result.toolbox_button_position;
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        btn.style.left = Math.max(0, Math.min(window.innerWidth - btn.offsetWidth, pos.left)) + 'px';
        btn.style.top = Math.max(0, Math.min(window.innerHeight - btn.offsetHeight, pos.top)) + 'px';
        btn.style.right = 'auto';
        btn.style.bottom = 'auto';
      }
    } catch (error) {
      console.error('[ToolCube] Failed to apply button position:', error);
    }
  }

  /**
   * 显示按钮右键菜单
   */
  function showToggleButtonMenu(e) {
    // 移除旧菜单
    const oldMenu = document.getElementById('toolbox-toggle-menu');
    if (oldMenu) oldMenu.remove();

    const menu = document.createElement('div');
    menu.id = 'toolbox-toggle-menu';
    // 关键：z-index 低于按钮（按钮是 2147483640），确保点击按钮不会被菜单拦截
    menu.style.cssText = `
      position: fixed;
      background: var(--toolbox-bg,#ffffff);
      border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      z-index: 2147483630;
      min-width: 160px;
      padding: 6px 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      opacity: 0;
      transition: opacity 0.12s;
    `;

    // 关闭按钮（叉号）- 放在菜单顶部右侧
    const closeX = document.createElement('span');
    closeX.innerHTML = '✕';
    closeX.title = '关闭菜单';
    closeX.style.cssText = `
      position: absolute;
      top: 6px;
      right: 8px;
      cursor: pointer;
      font-size: 14px;
      color: var(--toolbox-text-tertiary, #999);
      width: 20px;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      border: none;
      background: none;
      z-index: 2;
      transition: background 0.15s, color 0.15s;
    `;
    closeX.addEventListener('mouseenter', () => { closeX.style.background = 'var(--toolbox-bg-hover, rgba(0,0,0,0.06))'; closeX.style.color = 'var(--toolbox-text-primary, #333)'; });
    closeX.addEventListener('mouseleave', () => { closeX.style.background = 'none'; closeX.style.color = 'var(--toolbox-text-tertiary, #999)'; });
    closeX.addEventListener('click', (ev) => { ev.stopPropagation(); cleanupMenu(); });
    menu.appendChild(closeX);

    const items = [
      { label: '🔧 打开ToolCube', action: () => toggleSidebar() },
      { label: '⚙️ 设置', action: () => openSettings() },
      { label: '🧭 重置按钮位置', action: () => resetButtonPosition() },
    ];

    items.forEach((item, i) => {
      const div = document.createElement('div');
      div.textContent = item.label;
      div.style.cssText = `
        padding: 8px 36px 8px 16px;
        cursor: pointer;
        color: var(--toolbox-text-primary, #333);
        transition: background 0.15s;
      `;
      div.addEventListener('mouseenter', () => div.style.background = 'var(--toolbox-bg-hover, rgba(0,0,0,0.04))');
      div.addEventListener('mouseleave', () => div.style.background = 'transparent');
      div.addEventListener('click', (ev) => {
        ev.stopPropagation();
        item.action();
        cleanupMenu();
      });
      menu.appendChild(div);
    });

    document.body.appendChild(menu);

    // 计算菜单位置：默认在点击点右下方，若超出视口则自动调整
    // 同时确保菜单不会盖住悬浮按钮（按钮位置由 state.position + 右/下 20px 决定）
    const MENU_WIDTH = 180;
    const MENU_HEIGHT = 40 + items.length * 36;
    const btnRect = document.getElementById(CONFIG.TOGGLE_BTN_ID)?.getBoundingClientRect();
    const padding = 8;

    let left = e.clientX;
    let top = e.clientY;

    // 默认在光标右下方
    // 横向：右侧超出则改为左下
    if (left + MENU_WIDTH + padding > window.innerWidth) {
      left = e.clientX - MENU_WIDTH;
    }
    if (left < padding) left = padding;
    // 纵向：下方超出则向上展开
    if (top + MENU_HEIGHT + padding > window.innerHeight) {
      top = e.clientY - MENU_HEIGHT;
    }
    if (top < padding) top = padding;

    // 避免菜单覆盖按钮：若菜单矩形与按钮矩形重叠，则把菜单移动到按钮的另一侧
    if (btnRect) {
      const overlap = !(left + MENU_WIDTH < btnRect.left ||
                        left > btnRect.right ||
                        top + MENU_HEIGHT < btnRect.top ||
                        top > btnRect.bottom);
      if (overlap) {
        // 优先把菜单放到按钮上方；若上方空间不够则放到下方但避开按钮水平区域
        const aboveTop = btnRect.top - MENU_HEIGHT - padding;
        if (aboveTop >= padding) {
          top = aboveTop;
          // 水平居中于按钮
          left = Math.max(padding, Math.min(window.innerWidth - MENU_WIDTH - padding, btnRect.left + btnRect.width / 2 - MENU_WIDTH / 2));
        } else {
          // 放在按钮下方但水平错开
          top = btnRect.bottom + padding;
          // 选不重叠的一侧
          const rightSpace = window.innerWidth - btnRect.right;
          const leftSpace = btnRect.left;
          if (rightSpace >= MENU_WIDTH + padding * 2) {
            left = btnRect.right + padding;
          } else if (leftSpace >= MENU_WIDTH + padding * 2) {
            left = btnRect.left - MENU_WIDTH - padding;
          } else {
            left = Math.max(padding, Math.min(window.innerWidth - MENU_WIDTH - padding, btnRect.left + btnRect.width / 2 - MENU_WIDTH / 2));
          }
        }
      }
    }

    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // 触发淡入
    requestAnimationFrame(() => { menu.style.opacity = '1'; });

    // 使用 AbortController 统一管理菜单的全局监听器，避免泄漏
    const ac = new AbortController();
    menu.__toolboxAbort = ac;

    const closeMenu = (ev) => {
      // 如果点击在菜单内部，不关闭
      if (menu.contains(ev.target)) return;
      cleanupMenu();
    };

    function cleanupMenu() {
      if (!menu.isConnected) return;
      try { ac.abort(); } catch (_) {}
      menu.remove();
    }

    // 延迟一个 tick 再注册全局监听，避免当前右键事件的 click 立刻被消费
    setTimeout(() => {
      if (!menu.isConnected) return;
      document.addEventListener('click', closeMenu, { signal: ac.signal });
      document.addEventListener('contextmenu', cleanupMenu, { signal: ac.signal });
    }, 0);

    // 滚动或 resize 时也关闭菜单
    const onScrollOrResize = () => cleanupMenu();
    window.addEventListener('scroll', onScrollOrResize, { signal: ac.signal, capture: true });
    window.addEventListener('resize', onScrollOrResize, { signal: ac.signal });
  }

  // ==================== 拖拽功能 ====================

  /**
   * 使元素可拖拽
   * @param {HTMLElement} element - 要拖拽的元素
   * @param {Function} [onMoved] - 拖拽完成（发生了实际位移）后触发的回调
   */
  function makeDraggable(element, onMoved) {
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    let hasMoved = false;
    const DRAG_THRESHOLD = 5;

    element.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // 只响应左键

      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;

      const rect = element.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      element.style.cursor = 'grabbing';
      element.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      hasMoved = true;

      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;

      // 边界限制
      const maxLeft = window.innerWidth - element.offsetWidth;
      const maxTop = window.innerHeight - element.offsetHeight;

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      element.style.left = newLeft + 'px';
      element.style.right = 'auto';
      element.style.top = newTop + 'px';
      element.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        if (hasMoved) {
          // 通过回调通知调用方：刚刚发生了拖拽，需要吞掉紧随其后的 click
          try { if (typeof onMoved === 'function') onMoved(); } catch (_) {}
        }
        isDragging = false;
        hasMoved = false;
        element.style.cursor = 'pointer';
        element.style.transition = 'transform 0.2s, box-shadow 0.2s';

        // 保存位置
        saveButtonPosition();
      }
    });
  }

  /**
   * 调整大小初始化
   */
  function initResize(e) {
    state.isResizing = true;
    const startX = e.clientX;
    const startWidth = state.width;

    document.body.style.cursor = state.position === 'right' ? 'w-resize' : 'e-resize';
    document.body.style.userSelect = 'none';

    function onMouseMove(e) {
      if (!state.isResizing) return;

      const dx = state.position === 'right' 
        ? startX - e.clientX 
        : e.clientX - startX;

      let newWidth = startWidth + dx;
      newWidth = Math.max(CONFIG.MIN_WIDTH, Math.min(newWidth, CONFIG.MAX_WIDTH));

      state.width = newWidth;
      const sidebar = document.getElementById(CONFIG.SIDEBAR_ID);
      if (sidebar) {
        sidebar.style.width = newWidth + 'px';
      }
    }

    function onMouseUp() {
      state.isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      // 保存宽度设置
      saveSettings();
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // ==================== 侧边栏控制 ====================

  /**
   * 切换侧边栏显示
   */
  function toggleSidebar() {
    if (state.isOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  /**
   * 打开设置页面
   */
  function openSettings() {
    try {
      chrome.runtime.sendMessage({ action: 'openOptionsPage' }, (response) => {
        // 如果消息发送失败（扩展上下文失效等），尝试直接用 tabs API 打开
        if (chrome.runtime.lastError || !response || !response.success) {
          console.warn('[ToolCube] openOptionsPage via message failed, trying direct URL');
          window.open(chrome.runtime.getURL('options/options.html'), '_blank');
        }
      });
    } catch (e) {
      // sendMessage 本身抛异常时，直接打开URL
      try {
        window.open(chrome.runtime.getURL('options/options.html'), '_blank');
      } catch (e2) {
        console.error('[ToolCube] Failed to open settings:', e2);
      }
    }
  }

  /**
   * 打开侧边栏
   */
  function openSidebar() {
    createSidebar();

    const sidebar = document.getElementById(CONFIG.SIDEBAR_ID);
    const overlay = document.getElementById('toolbox-overlay');

    if (sidebar && overlay) {
      sidebar.classList.remove('toolbox-sidebar--closed');
      sidebar.classList.add('toolbox-sidebar--open');
      sidebar.style.transform = 'translateX(0)';

      overlay.style.opacity = '1';
      overlay.style.visibility = 'visible';

      state.isOpen = true;

      // 通知iframe侧边栏已打开
      const iframe = document.getElementById(CONFIG.IFRAME_ID);
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          action: 'sidebarOpened',
          data: { width: state.width }
        }, '*');
      }

      // 隐藏切换按钮
      const toggleBtn = document.getElementById(CONFIG.TOGGLE_BTN_ID);
      if (toggleBtn) {
        toggleBtn.style.display = 'none';
      }
    }
  }

  /**
   * 关闭侧边栏
   */
  function closeSidebar() {
    const sidebar = document.getElementById(CONFIG.SIDEBAR_ID);
    const overlay = document.getElementById('toolbox-overlay');

    if (sidebar && overlay) {
      const translateX = state.position === 'right' ? '100%' : '-100%';
      sidebar.style.transform = `translateX(${translateX})`;

      overlay.style.opacity = '0';
      overlay.style.visibility = 'hidden';

      state.isOpen = false;

      // 通知侧边栏 iframe 清理当前工具，避免后台持续运行
      const iframe = document.getElementById(CONFIG.IFRAME_ID);
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ action: 'sidebarClosed' }, '*');
      }

      // 显示切换按钮
      const toggleBtn = document.getElementById(CONFIG.TOGGLE_BTN_ID);
      if (toggleBtn) {
        toggleBtn.style.display = 'flex';
      }
    }
  }

  // ==================== 主题同步 ====================

  /**
   * 同步主题到宿主页面
   */
  function applyHostTheme(theme) {
    const isDark = theme === 'dark' || 
      (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    // 使用带命名空间的属性名 data-toolbox-theme，而不是通用的 data-theme。
    // 很多站点用 html[data-theme="dark"] 控制自身主题，扩展若写入同名属性会
    // 意外切换/破坏宿主站点样式。styles.css 中的深色变量选择器与此保持一致。
    document.documentElement.setAttribute('data-toolbox-theme', isDark ? 'dark' : 'light');
    
    // 同步侧边栏容器背景
    const sidebar = document.getElementById(CONFIG.SIDEBAR_ID);
    if (sidebar) {
      sidebar.style.background = isDark ? 'var(--toolbox-bg-secondary, #27272a)' : 'var(--toolbox-bg, #fefefe)';
    }
    // 同步切换按钮位置样式（暗色模式下按钮阴影更重）
    const toggleBtn = document.getElementById(CONFIG.TOGGLE_BTN_ID);
    if (toggleBtn) {
      toggleBtn.style.boxShadow = isDark 
        ? '0 4px 16px rgba(0, 0, 0, 0.5)' 
        : '0 4px 12px rgba(0, 0, 0, 0.3)';
    }
  }

  /**
   * 监听系统主题变化（auto模式）
   */
  const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeQuery.addEventListener('change', () => {
    // 重新读取设置看看是否是auto模式
    if (!isContextValid()) return;
    chrome.storage.local.get('toolbox_settings', (result) => {
      const settings = result.toolbox_settings || {};
      if (settings.theme === 'auto') {
        applyHostTheme('auto');
      }
    });
  });

  // ==================== 设置管理 ====================

  /**
   * 加载设置
   */
  async function loadSettings() {
    try {
      if (!isContextValid()) return;
      const result = await chrome.storage.local.get('toolbox_settings');
      const settings = result.toolbox_settings || {};

      state.width = settings.sidebarWidth || CONFIG.DEFAULT_WIDTH;
      state.position = settings.sidebarPosition || 'right';
      state.showFloatingBtn = settings.showFloatingBtn !== false;

      // 应用主题到宿主页面
      applyHostTheme(settings.theme || 'auto');

      // 应用设置到DOM
      const sidebar = document.getElementById(CONFIG.SIDEBAR_ID);
      if (sidebar) {
        sidebar.style.width = state.width + 'px';
        sidebar.style.left = state.position === 'left' ? '0' : 'auto';
        sidebar.style.right = state.position === 'right' ? '0' : 'auto';
      }
    } catch (error) {
      console.error('[ToolCube] Failed to load settings:', error);
    }
  }

  /**
   * 保存设置
   */
  async function saveSettings() {
    try {
      if (!isContextValid()) return;
      const result = await chrome.storage.local.get('toolbox_settings');
      const settings = result.toolbox_settings || {};

      settings.sidebarWidth = state.width;
      settings.sidebarPosition = state.position;

      await chrome.storage.local.set({ toolbox_settings: settings });
    } catch (error) {
      // 扩展上下文失效时静默忽略
    }
  }

  /**
   * 保存按钮位置
   */
  async function saveButtonPosition() {
    const btn = document.getElementById(CONFIG.TOGGLE_BTN_ID);
    if (!btn || !isContextValid()) return;

    const rect = btn.getBoundingClientRect();

    try {
      await chrome.storage.local.set({
        toolbox_button_position: { left: rect.left, top: rect.top }
      });
    } catch (error) {
      // 扩展上下文失效时静默忽略
    }
  }

  // ==================== 消息处理 ====================

  // 宿主页面(MAIN world)允许上报的状态类消息（白名单）
  // 控制类操作（openTool/captureScreenshot/masterSwitch*/videoUnlocker:scan 等）仅接受侧边栏 iframe 来源，
  // 防止恶意网页通过 postMessage 驱动扩展敏感动作
  const MAIN_WORLD_REPORT_ACTIONS = new Set([
    'videoStatus', 'detectVideosResult',
    'videoUnlocker:status', 'videoUnlocker:scanResult', 'videoUnlocker:pong',
    'videoUnlocker:extractUrlsResult', 'videoUnlocker:fullscreenResult', 'videoUnlocker:downloadResult',
    'apn:detectionTriggered', 'apn:log', 'apn:nextFound',
    'pageInfo', 'screenshotResult', 'elementSelected', 'selectionComplete',
    'toolboxMediaInfo', 'webVitals', 'videoUnlocker:downloadViaBg'
  ]);

  /**
   * 处理来自background和iframe的消息
   */
  function handleMessage(event) {
    // 验证消息来源
    const sidebarIframe = document.getElementById(CONFIG.IFRAME_ID);
    const fromSidebar = sidebarIframe && event.source === sidebarIframe.contentWindow;
    const fromMainWorld = event.source === window;
    if (!fromSidebar && !fromMainWorld) {
      return;
    }

    if (!event.data || typeof event.data !== 'object') return;
    // 跳过自己转发到 MAIN world 的消息（避免无限循环）
    if (event.data.__toolboxForwarded) return;
    const { action, data, __id } = event.data;
    if (!action) return;

    // 安全加固：宿主页面只能发送上报类消息；控制类操作仅接受侧边栏 iframe
    if (fromMainWorld && !MAIN_WORLD_REPORT_ACTIONS.has(action)) {
      return;
    }

    const expectResponse = !!__id;

    function reply(result) {
      if (!expectResponse) return;
      const iframe = document.getElementById(CONFIG.IFRAME_ID);
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ action: '__contentResponse', data: { __id, result } }, '*');
      }
    }

    switch (action) {
      case 'toggleSidebar':
        toggleSidebar();
        break;
      case 'openSidebar':
        openSidebar();
        break;
      case 'closeSidebar':
        closeSidebar();
        break;
      case 'openTool':
        openTool(data.toolId, data.params);
        break;
      case 'openToolWithData':
        openToolWithData(data.toolId, data.input);
        break;
      case 'focusSearch':
        focusSearch();
        break;
      case 'getSelectedText':
        getSelectedText();
        break;
      case 'resizeSidebar':
        resizeSidebar(data.width);
        break;
      case 'updatePosition':
        updatePosition(data.position);
        break;
      case 'setTheme':
        applyHostTheme(data.theme);
        break;
      case 'videoStatus':
        // 注：videoStatus 由下方 window message 监听器（MAIN world → sidebar）统一转发，
        // 此处若再转发会造成工具 iframe 收到双份状态，故不重复处理
        break;
      case 'getPageInfo':
        collectPageInfo();
        break;
      case 'pageInfo':
        // 转发页面信息到 sidebar iframe
        const iframe3 = document.getElementById(CONFIG.IFRAME_ID);
        if (iframe3 && iframe3.contentWindow) {
          iframe3.contentWindow.postMessage({ action: 'pageInfo', data }, '*');
        }
        break;
      case 'captureScreenshot':
        captureScreenshot(data);
        break;
      // 截图工具的「拖选区域」：此前并不存在，工具里的"截取选中区域"实际只是
      // 又截了一次可见区域，用户无法真正选择区域。
      case 'startRegionSelection':
        startRegionSelection();
        break;
      // 元素检查器相关
      case 'startElementSelection':
        startElementSelection();
        break;
      case 'getElementInfo':
        getElementInfo(data?.selector);
        break;
      case 'getDomTree':
        getDomTree();
        break;
      case 'modifyElement':
        modifyElement(data);
        break;
      case 'stopElementSelection':
        stopSelectionMode();
        sendToSidebar('selectionComplete',{});
        break;
      case 'highlightElement':
        highlightElement(data);
        break;
      case 'hideHighlight':
        clearHighlight();
        break;
      case 'deleteElement':
        deleteHostElement(data);
        break;
      case 'getEventListeners':
        getEventListenersHost(data);
        break;
      case 'checkLinkStatus':
        checkLinkStatusHost(data);
        break;
      case 'extractLinks':
        extractLinks();
        break;
      case 'extractColors':
        extractColors();
        break;
      case 'extractResources':
        extractResources(data && data.options);
        break;
      case 'clearNetworkCache':
        clearNetworkCache();
        break;
      case 'toggleLiveMonitor':
        __liveMonitorEnabled = !!(data && data.enabled);
        if (__liveMonitorEnabled) {
          ensureNetworkObserver();
          sendToSidebar('liveMonitorStarted', {});
        } else {
          sendToSidebar('liveMonitorStopped', {});
        }
        break;
      case 'securityScan_collectPageInfo':
          if (expectResponse) reply(collectSecurityPageInfo());
          break;
        case 'getNetworkAnalysis':
          if (expectResponse) reply(collectNetworkAnalysis());
          break;
      case 'collectWebVitals':
        collectWebVitals();
        break;
      case 'privacyScan':
        if (expectResponse) reply(privacyScanCollectPageInfo());
        break;
      case 'capturePageAsHtml':
        capturePageAsHtml(data);
        break;
      case 'getStorageSnapshot':
        if (expectResponse) reply(getStorageSnapshot(data?.kind || 'local'));
        else sendToSidebar('storageSnapshot', getStorageSnapshot(data?.kind || 'local'));
        break;
      case 'setStorageItem':
        if (expectResponse) reply({ op: 'set', kind: data.kind, key: data.key, ...setStorageItem(data.kind, data.key, data.value) });
        else sendToSidebar('storageOpResult', { op: 'set', kind: data.kind, key: data.key, ...setStorageItem(data.kind, data.key, data.value) });
        break;
      case 'removeStorageItem':
        if (expectResponse) reply({ op: 'remove', kind: data.kind, key: data.key, ...removeStorageItem(data.kind, data.key) });
        else sendToSidebar('storageOpResult', { op: 'remove', kind: data.kind, key: data.key, ...removeStorageItem(data.kind, data.key) });
        break;
      case 'clearStorage':
        if (expectResponse) reply({ op: 'clear', kind: data.kind, ...clearStorage(data.kind) });
        else sendToSidebar('storageOpResult', { op: 'clear', kind: data.kind, ...clearStorage(data.kind) });
        break;
      case 'startClipboardWatch':
        startClipboardWatch();
        break;
      case 'stopClipboardWatch':
        stopClipboardWatch();
        break;
      case 'showRuler':
        showRuler(data);
        break;
      case 'hideRuler':
        hideRuler();
        break;
      // 屏幕标尺扩展功能：颜色拾取、参考线、元素标注
      case 'startColorPick':
        startColorPick();
        break;
      case 'stopColorPick':
        stopColorPick();
        break;
      case 'addGuideLine':
        addGuideLine(data);
        break;
      case 'annotateElement':
        annotateElement(data);
        break;
      case 'clearAnnotations':
        clearAnnotations();
        break;
      case 'clearGuides':
        clearGuides();
        break;
      case 'masterSwitchOff':
        // 全局开关关闭：停止自身功能并广播到 MAIN world
        state.masterEnabled = false;
        // 隐藏悬浮按钮
        { const btn = document.getElementById(CONFIG.TOGGLE_BTN_ID);
          if (btn) btn.style.display = 'none'; }
        // 关闭侧边栏
        closeSidebar();
        window.postMessage({ action: 'masterSwitchOff', source: 'toolbox', __toolboxForwarded: true }, '*');
        break;
      case 'masterSwitchOn':
        // 全局开关开启：恢复自身功能并广播到 MAIN world
        state.masterEnabled = true;
        // 恢复时重新加载设置（确保 showFloatingBtn 等状态正确），然后恢复按钮
        loadSettings().then(() => {
          if (state.showFloatingBtn !== false) {
            let btn = document.getElementById(CONFIG.TOGGLE_BTN_ID);
            if (!btn) {
              createToggleButton();
            } else {
              btn.style.display = '';
            }
          }
        });
        window.postMessage({ action: 'masterSwitchOn', source: 'toolbox', __toolboxForwarded: true }, '*');
        break;
      case 'videoUnlocker:setConfig':
        // 转发视频解锁配置到 MAIN world（视频解锁脚本在 MAIN world 运行）
        window.postMessage({ action: 'videoUnlocker:setConfig', data, __toolboxForwarded: true }, '*');
        break;
      case 'videoUnlocker:scan':
      case 'videoUnlocker:seekTo':
      case 'videoUnlocker:getStatus':
      case 'videoUnlocker:extractUrls':
      case 'videoUnlocker:forceFullscreen':
      case 'videoUnlocker:downloadVideo':
        // 转发视频解锁操作到 MAIN world（视频解锁脚本在 MAIN world 运行）
        window.postMessage({ action, data, __toolboxForwarded: true }, '*');
        break;
      case 'setVideoSpeed':
        // 视频倍速设置 — 转发到 MAIN world（由 video-speed-injector.js 统一处理）
        // 不在 ISOLATED world 直接设置 playbackRate，避免绕过反篡改保护
        {
          const speed = (data && data.speed) || 1;
          window.postMessage({ action: 'setVideoSpeed', data: { speed }, __toolboxForwarded: true }, '*');
          // 回复当前状态
          const mediaElements = document.querySelectorAll('video, audio');
          const count = mediaElements.length;
          if (expectResponse) {
            reply({ count: count, speed: speed, panelVisible: count > 0 });
          }
        }
        break;
      case 'setTimeAccel':
        // 时间加速开关 — 转发到 MAIN world
        window.postMessage({ action: 'setTimeAccel', data, __toolboxForwarded: true }, '*');
        break;
      case 'setABLoop':
        // A-B 循环播放 — 转发到 MAIN world（由 video-speed-injector.js 处理）
        window.postMessage({ action: 'setABLoop', data, __toolboxForwarded: true }, '*');
        break;
      case 'setPreservesPitch':
        // 音频变调补偿 — 转发到 MAIN world（由 video-speed-injector.js 处理）
        window.postMessage({ action: 'setPreservesPitch', data, __toolboxForwarded: true }, '*');
        break;
      case 'enterPiP':
        // 画中画 — 转发到 MAIN world（由 video-speed-injector.js 处理）
        window.postMessage({ action: 'enterPiP', data, __toolboxForwarded: true }, '*');
        break;
      case 'detectVideos':
        // 检测页面中的视频/音频元素
        {
          const videos = [];
          document.querySelectorAll('video, audio').forEach(function(el) {
            try {
              videos.push({
                src: el.currentSrc || el.src || '',
                paused: el.paused,
                ended: el.ended,
                duration: isFinite(el.duration) ? el.duration : 0,
                currentTime: isFinite(el.currentTime) ? el.currentTime : 0,
                playbackRate: el.playbackRate || 1,
                volume: el.volume,
                muted: el.muted,
                videoWidth: el.videoWidth || 0,
                videoHeight: el.videoHeight || 0
              });
            } catch(e) {}
          });
          if (expectResponse) {
            reply({ count: videos.length, videos: videos });
          }
        }
        break;
      case 'getVideoStatus':
        // 获取视频/音频状态（详细信息）
        {
          const videos = [];
          document.querySelectorAll('video, audio').forEach(function(el) {
            try {
              videos.push({
                src: el.currentSrc || el.src || '',
                paused: el.paused,
                ended: el.ended,
                duration: isFinite(el.duration) ? el.duration : 0,
                currentTime: isFinite(el.currentTime) ? el.currentTime : 0,
                playbackRate: el.playbackRate || 1,
                volume: el.volume,
                muted: el.muted,
                videoWidth: el.videoWidth || 0,
                videoHeight: el.videoHeight || 0
              });
            } catch(e) {}
          });
          if (expectResponse) {
            reply({ count: videos.length, videos: videos, panelVisible: videos.length > 0 });
          }
        }
        break;
      case 'videoControl':
        // 视频控制操作：pause/play/seek/restart
        {
          const idx = (data && data.index !== undefined) ? data.index : -1;
          const ctrl = (data && data.ctrl) || '';
          const mediaElements = document.querySelectorAll('video, audio');
          const el = (idx >= 0 && idx < mediaElements.length) ? mediaElements[idx] : null;
          let result = { success: false, error: 'invalid index' };
          if (el) {
            try {
              switch (ctrl) {
                case 'pause':
                  el.pause();
                  result = { success: true };
                  break;
                case 'play':
                  el.play().catch(() => {});
                  result = { success: true };
                  break;
                case 'toggle':
                  if (el.paused) { el.play().catch(() => {}); } else { el.pause(); }
                  result = { success: true, paused: !el.paused };
                  break;
                case 'seek':
                  if (data.time !== undefined) { el.currentTime = Math.max(0, Math.min(data.time, el.duration || 0)); }
                  result = { success: true };
                  break;
                case 'restart':
                  el.currentTime = 0;
                  el.play().catch(() => {});
                  result = { success: true };
                  break;
                default:
                  result = { success: false, error: 'unknown ctrl: ' + ctrl };
              }
            } catch(e) {
              result = { success: false, error: e.message };
            }
          }
          if (expectResponse) reply(result);
        }
        break;
      default:
        // 未知消息类型，静默忽略
        break;
    }
  }

  /**
   * 打开指定工具
   */
  function openTool(toolId, params) {
    openSidebar();
    // 延迟发送，等待 iframe 完全加载
    setTimeout(() => {
      postToSidebarIframe({
        action: 'openTool',
        data: { toolId, params }
      });
    }, 100);
  }

  /**
   * 向侧边栏 iframe 发送消息，若未加载完成则等待 load 事件
   */
  function postToSidebarIframe(message) {
    const iframe = document.getElementById(CONFIG.IFRAME_ID);
    if (!iframe || !iframe.contentWindow) return;
    const send = () => iframe.contentWindow.postMessage(message, '*');
    if (iframe.contentDocument?.readyState === 'complete') {
      send();
    } else {
      iframe.addEventListener('load', send, { once: true });
    }
  }

  /**
   * 打开工具并传入数据
   */
  function openToolWithData(toolId, input) {
    openSidebar();
    postToSidebarIframe({
      action: 'openToolWithData',
      data: { toolId, input }
    });
  }

  /**
   * 聚焦搜索框
   */
  function focusSearch() {
    openSidebar();
    postToSidebarIframe({ action: 'focusSearch' });
  }

  /**
   * 获取选中的文本
   */
  function getSelectedText() {
    const selectedText = window.getSelection().toString();

    const iframe = document.getElementById(CONFIG.IFRAME_ID);
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        action: 'selectedText',
        data: selectedText
      }, '*');
    }
  }

  /**
   * 调整侧边栏大小
   */
  function resizeSidebar(width) {
    state.width = Math.max(CONFIG.MIN_WIDTH, Math.min(width, CONFIG.MAX_WIDTH));

    const sidebar = document.getElementById(CONFIG.SIDEBAR_ID);
    if (sidebar) {
      sidebar.style.width = state.width + 'px';
    }

    saveSettings();
  }

  /**
   * 更新侧边栏位置
   */
  function updatePosition(position) {
    state.position = position === 'left' ? 'left' : 'right';

    const sidebar = document.getElementById(CONFIG.SIDEBAR_ID);
    if (sidebar) {
      sidebar.style.left = state.position === 'left' ? '0' : 'auto';
      sidebar.style.right = state.position === 'right' ? '0' : 'auto';
    }

    saveSettings();
  }

  /**
   * 收集页面信息（SEO、结构、技术等）
   */
  function collectPageInfo() {
    const info = {
      url: window.location.href,
      hostname: window.location.hostname,
      protocol: window.location.protocol,
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      keywords: document.querySelector('meta[name="keywords"]')?.content || '',
      canonical: document.querySelector('link[rel="canonical"]')?.href || '',
      robots: document.querySelector('meta[name="robots"]')?.content || '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
      ogDescription: document.querySelector('meta[property="og:description"]')?.content || '',
      ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
      lang: document.documentElement.lang || '',
      charset: document.characterSet || '',
      viewport: document.querySelector('meta[name="viewport"]')?.content || '',
      favicon: document.querySelector('link[rel="icon"]')?.href || document.querySelector('link[rel="shortcut icon"]')?.href || '',
      h1Count: document.querySelectorAll('h1').length,
      h2Count: document.querySelectorAll('h2').length,
      // 增强：补全 H3-H6 计数（之前缺失导致前端始终显示 0）
      h3Count: document.querySelectorAll('h3').length,
      h4Count: document.querySelectorAll('h4').length,
      h5Count: document.querySelectorAll('h5').length,
      h6Count: document.querySelectorAll('h6').length,
      imgCount: document.querySelectorAll('img').length,
      imgNoAlt: document.querySelectorAll('img:not([alt])').length,
      linkCount: document.querySelectorAll('a').length,
      internalLinks: 0,
      externalLinks: 0,
      formCount: document.querySelectorAll('form').length,
      scriptCount: document.querySelectorAll('script').length,
      styleCount: document.querySelectorAll('link[rel="stylesheet"]').length,
      // 增强：DOM 节点数（在宿主页面统计而非工具 iframe，确保数据真实）
      domNodeCount: document.querySelectorAll('*').length,
      // 增强：ARIA 属性元素计数（必须在宿主页面统计）
      ariaElCount: document.querySelectorAll('[aria-label], [aria-labelledby], [role]').length,
      // 增强：技术栈检测（必须在宿主页面执行才能识别页面框架）
      techStack: detectTechStack(),
    };

    // 计算内外链接
    document.querySelectorAll('a[href]').forEach(a => {
      try {
        const url = new URL(a.href, window.location.href);
        if (url.hostname === window.location.hostname) {
          info.internalLinks++;
        } else {
          info.externalLinks++;
        }
      } catch(e) {
        info.internalLinks++;
      }
    });

    // Twitter Card 检测
    info.twitterCard = {
      card: document.querySelector('meta[name="twitter:card"]')?.content || '',
      title: document.querySelector('meta[name="twitter:title"]')?.content || '',
      description: document.querySelector('meta[name="twitter:description"]')?.content || '',
      image: document.querySelector('meta[name="twitter:image"]')?.content || '',
      site: document.querySelector('meta[name="twitter:site"]')?.content || '',
      creator: document.querySelector('meta[name="twitter:creator"]')?.content || ''
    };

    // 结构化数据 JSON-LD 检测
    info.jsonld = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
      try {
        const parsed = JSON.parse(s.textContent);
        if (Array.isArray(parsed)) {
          info.jsonld.push(...parsed);
        } else {
          info.jsonld.push(parsed);
        }
      } catch(e) { /* 忽略解析失败 */ }
    });

    // 内联CSS/JS统计
    let inlineCssCount = 0, inlineCssSize = 0;
    document.querySelectorAll('style').forEach(s => {
      inlineCssCount++;
      inlineCssSize += (s.textContent || '').length;
    });
    let inlineJsCount = 0, inlineJsSize = 0;
    document.querySelectorAll('script:not([src])').forEach(s => {
      inlineJsCount++;
      inlineJsSize += (s.textContent || '').length;
    });
    info.inlineCssCount = inlineCssCount;
    info.inlineCssSize = inlineCssSize;
    info.inlineJsCount = inlineJsCount;
    info.inlineJsSize = inlineJsSize;

    // 增强：Performance API 内存/导航统计（页面性能分析必需）
    try {
      const navEntry = performance.getEntriesByType('navigation')[0];
      if (navEntry) {
        info.performance = {
          dnsTime: Math.round((navEntry.domainLookupEnd - navEntry.domainLookupStart) || 0),
          tcpTime: Math.round((navEntry.connectEnd - navEntry.connectStart) || 0),
          ttfb: Math.round((navEntry.responseStart - navEntry.requestStart) || 0),
          domContentLoaded: Math.round(navEntry.domContentLoadedEventEnd || 0),
          loadComplete: Math.round(navEntry.loadEventEnd || 0),
          transferSize: navEntry.transferSize || 0,
          encodedBodySize: navEntry.encodedBodySize || 0,
          decodedBodySize: navEntry.decodedBodySize || 0,
          redirectCount: navEntry.redirectCount || 0,
          protocol: navEntry.nextHopProtocol || ''
        };
      }
      // 内存信息（仅 Chromium 支持）
      if (performance.memory) {
        info.memory = {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        };
      }
    } catch (e) {}

    // 增强：微数据/RDFa 结构化数据检测（补充 JSON-LD 之外的格式）
    try {
      const microdataItems = [];
      document.querySelectorAll('[itemtype]').forEach(el => {
        microdataItems.push({ type: el.getAttribute('itemtype'), scope: el.hasAttribute('itemscope') });
      });
      if (microdataItems.length) info.microdata = microdataItems;
      const rdfaCount = document.querySelectorAll('[typeof],[property],[vocab]').length;
      if (rdfaCount > 0) info.rdfaCount = rdfaCount;
    } catch (e) {}

    // 发送回 sidebar iframe
    const iframe = document.getElementById(CONFIG.IFRAME_ID);
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        action: 'pageInfo',
        data: info
      }, '*');
    }
  }

  /**
   * 截图当前页面
   * 通过 background service worker 调用 chrome.tabs.captureVisibleTab 获取真实像素截图
   * 远比 canvas 绘制 DOM 准确（可获取图片、canvas、视频等真实像素）
   * @param {Object} data - { mode: 'visible'|'fullpage'|'selection', format, quality }
   */
  async function captureScreenshot(data) {
    const mode = (data && data.mode) || 'visible';
    const format = (data && data.format) || 'png';
    const quality = (data && data.quality) || 92;

    // 发送结果回 sidebar iframe
    const sendResult = (result) => {
      const iframe = document.getElementById(CONFIG.IFRAME_ID);
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({
          action: 'screenshotResult',
          data: result
        }, '*');
      }
    };

    try {
      // 根据模式选择 background action
      // visible 和 selection 模式都先截取可见区域（selection 后续在工具中裁剪）
      const bgAction = (mode === 'fullpage') ? 'captureFullPage' : 'captureVisibleTab';

      chrome.runtime.sendMessage(
        { action: bgAction, data: { mode, format, quality } },
        (response) => {
          // 上下文可能失效，需检查 lastError
          if (chrome.runtime.lastError || !response || !response.success) {
            const err = (response && response.error) ||
                        (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
                        '截图失败，请重试';
            sendResult({ success: false, error: err });
            return;
          }

          // 全页面截图需要拼接分段数据
          if (response.needStitch && response.captures) {
            stitchFullPage(response).then(dataUrl => {
              sendResult({ success: true, dataUrl, mode });
            }).catch(e => {
              sendResult({ success: false, error: '全页拼接失败: ' + e.message });
            });
            return;
          }

          sendResult({ success: true, dataUrl: response.dataUrl, mode });
        }
      );
    } catch(e) {
      sendResult({ success: false, error: e.message });
    }
  }

  /**
   * 在宿主页面上启动「拖选区域」模式。
   *
   * 该能力此前并不存在：截图工具的「截取选中区域」只是把 mode 传成 'selection'，
   * 而 captureScreenshot 对 selection 与 visible 走的是同一条路径（都截可见区域），
   * 用户根本无法选择区域。这里补上真实的选区浮层。
   */
  function startRegionSelection() {
    if (document.getElementById('__toolbox_region_overlay')) return; // 已在选择中

    const overlay = document.createElement('div');
    overlay.id = '__toolbox_region_overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:rgba(0,0,0,0.25);';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:1px solid #3b82f6;background:rgba(59,130,246,0.18);display:none;pointer-events:none;z-index:2147483647;';
    const hint = document.createElement('div');
    hint.textContent = '拖拽选择截图区域，按 Esc 取消';
    hint.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;'
      + 'font:12px/1.6 sans-serif;padding:4px 10px;border-radius:4px;z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(overlay);
    document.documentElement.appendChild(box);
    document.documentElement.appendChild(hint);

    let startX = 0;
    let startY = 0;
    let dragging = false;

    const cleanup = () => {
      overlay.remove();
      box.remove();
      hint.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(); };
    document.addEventListener('keydown', onKey, true);

    overlay.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      box.style.display = 'block';
      box.style.left = startX + 'px';
      box.style.top = startY + 'px';
      box.style.width = '0px';
      box.style.height = '0px';
      e.preventDefault();
    });
    overlay.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      box.style.left = Math.min(startX, e.clientX) + 'px';
      box.style.top = Math.min(startY, e.clientY) + 'px';
      box.style.width = Math.abs(e.clientX - startX) + 'px';
      box.style.height = Math.abs(e.clientY - startY) + 'px';
    });
    overlay.addEventListener('mouseup', (e) => {
      if (!dragging) return;
      dragging = false;
      const rect = {
        x: Math.min(startX, e.clientX),
        y: Math.min(startY, e.clientY),
        width: Math.abs(e.clientX - startX),
        height: Math.abs(e.clientY - startY)
      };
      cleanup();
      if (rect.width < 4 || rect.height < 4) return; // 视为误触，忽略
      captureRegion(rect);
    });
  }

  /**
   * 截取宿主页面中的指定矩形区域。
   * @param {{x:number,y:number,width:number,height:number}} rect 视口 CSS 像素
   */
  function captureRegion(rect) {
    const sendResult = (result) => {
      const iframe = document.getElementById(CONFIG.IFRAME_ID);
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ action: 'screenshotResult', data: result }, '*');
      }
    };
    // captureVisibleTab 返回的是设备像素，选区需按 DPR 放大后再交给后台裁剪
    const dpr = window.devicePixelRatio || 1;
    const scaled = {
      x: Math.round(rect.x * dpr),
      y: Math.round(rect.y * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr)
    };
    chrome.runtime.sendMessage(
      { action: 'captureTabRegion', data: { rect: scaled, format: 'png', quality: 92 } },
      (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          sendResult({
            success: false,
            error: (response && response.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || '区域截图失败'
          });
          return;
        }
        if (response.needCrop && response.dataUrl) {
          // 后台缺少 OffscreenCanvas 时的降级路径：在页面侧裁剪
          cropDataUrl(response.dataUrl, scaled)
            .then(dataUrl => sendResult({ success: true, dataUrl, mode: 'selection' }))
            .catch(e => sendResult({ success: false, error: '裁剪失败: ' + e.message }));
          return;
        }
        sendResult({ success: true, dataUrl: response.dataUrl, mode: 'selection' });
      }
    );
  }

  /** 用 canvas 裁剪 dataURL（后台无法裁剪时的降级实现） */
  function cropDataUrl(dataUrl, rect) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, rect.width);
          canvas.height = Math.max(1, rect.height);
          canvas.getContext('2d').drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
          resolve(canvas.toDataURL('image/png'));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = dataUrl;
    });
  }

  /**
   * 拼接全页面截图（将分段截图合并为一张完整图片）
   * @param {Object} response - background 返回的分段数据
   * @returns {Promise<string>} 拼接后的 dataUrl
   */
  async function stitchFullPage(response) {
    const { captures, totalWidth, totalHeight, devicePixelRatio, format, quality } = response;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(totalWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(totalHeight * devicePixelRatio));
    const ctx = canvas.getContext('2d');

    // 依次加载每段截图并绘制到 canvas 对应位置
    for (const cap of captures) {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('图片加载失败'));
        im.src = cap.dataUrl;
      });
      ctx.drawImage(img, cap.x * devicePixelRatio, cap.y * devicePixelRatio);
    }

    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const q = (quality || 92) / 100;
    return canvas.toDataURL(mime, q);
  }

  // ==================== 元素编辑器（增强版） ====================

  let selectionOverlay = null;
  let selectionLabel = null;
  let selectionMode = false;
  let selectedElement = null;

  function startElementSelection() {
    selectionMode = true;
    if (!selectionOverlay) {
      selectionOverlay = document.createElement('div');
      selectionOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;border:2px solid var(--toolbox-primary, #5b7fff);background:rgba(91,127,255,0.08);transition:all 0.05s ease;display:none;border-radius:2px';
      document.body.appendChild(selectionOverlay);
    }
    if (!selectionLabel) {
      selectionLabel = document.createElement('div');
      selectionLabel.id = 'toolbox-selection-label';
      selectionLabel.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;background:var(--toolbox-bg-secondary,#27272a);color:var(--toolbox-text-primary,#fafafa);font-family:Consolas,monospace;font-size:11px;padding:4px 8px;border-radius:3px;white-space:nowrap;display:none;line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,.3);max-width:400px;overflow:hidden;text-overflow:ellipsis';
      document.body.appendChild(selectionLabel);
    }
    document.body.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onSelectionMove, true);
    document.addEventListener('mousedown', onSelectionClick, true);
    document.addEventListener('keydown', onSelectionKey, true);
  }

  function stopSelectionMode() {
    selectionMode = false;
    document.body.style.cursor = '';
    if (selectionOverlay) selectionOverlay.style.display = 'none';
    if (selectionLabel) selectionLabel.style.display = 'none';
    document.removeEventListener('mousemove', onSelectionMove, true);
    document.removeEventListener('mousedown', onSelectionClick, true);
    document.removeEventListener('keydown', onSelectionKey, true);
  }

  function getDeepestElement(x, y) {
    // Use elementsFromPoint to get ALL elements at the mouse position (sorted by z-order, topmost first)
    const els = document.elementsFromPoint(x, y);
    if (!els || els.length === 0) return null;
    // Skip toolbox UI elements
    for (const el of els) {
      if (el.id && (el.id.startsWith('toolbox-') || el.id.startsWith('toolbox_'))) continue;
      return el;
    }
    return els[0];
  }

  function onSelectionMove(e) {
    if (!selectionMode) return;
    const target = getDeepestElement(e.clientX, e.clientY);
    if (!target || target === document.documentElement) {
      if (selectionOverlay) selectionOverlay.style.display = 'none';
      if (selectionLabel) selectionLabel.style.display = 'none';
      return;
    }
    selectedElement = target;
    const rect = target.getBoundingClientRect();
    // Update overlay
    selectionOverlay.style.display = 'block';
    selectionOverlay.style.top = rect.top + 'px';
    selectionOverlay.style.left = rect.left + 'px';
    selectionOverlay.style.width = rect.width + 'px';
    selectionOverlay.style.height = rect.height + 'px';
    // Update floating label
    const tag = target.tagName.toLowerCase();
    const id = target.id ? '#' + target.id : '';
    const cls = Array.from(target.classList).slice(0, 3).map(c => '.' + c).join('');
    const dims = Math.round(rect.width) + '\u00D7' + Math.round(rect.height);
    selectionLabel.textContent = tag + id + cls + '  ' + dims;
    selectionLabel.style.display = 'block';
    // Position label above or below the element
    const labelH = 24;
    if (rect.top > labelH + 10) {
      selectionLabel.style.top = (rect.top - labelH - 4) + 'px';
    } else {
      selectionLabel.style.top = (rect.bottom + 4) + 'px';
    }
    selectionLabel.style.left = Math.max(0, rect.left) + 'px';
    e.preventDefault();
    e.stopPropagation();
  }

  function onSelectionClick(e) {
    if (!selectionMode) return;
    e.preventDefault();
    e.stopPropagation();
    stopSelectionMode();
    if (selectedElement) {
      sendElementInfo(selectedElement);
      // Also send a follow-up with computed styles after a short delay
      setTimeout(() => {
        const computed = collectComputedStyles(selectedElement);
        sendToSidebar('elementComputed', { styles: computed });
      }, 50);
    }
  }

  function onSelectionKey(e) {
    if (!selectionMode) return;
    if (e.key === 'Escape') {
      stopSelectionMode();
      if (selectionOverlay) selectionOverlay.style.display = 'none';
      sendToSidebar('selectionComplete', { cancelled: true });
      return;
    }
    // Arrow keys: navigate to parent/child/sibling
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || 
        e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      let nextEl = null;
      if (e.key === 'ArrowUp' && selectedElement && selectedElement.parentElement) {
        nextEl = selectedElement.parentElement;
        if (nextEl === document.body || nextEl === document.documentElement) nextEl = null;
      } else if (e.key === 'ArrowDown' && selectedElement && selectedElement.firstElementChild) {
        nextEl = selectedElement.firstElementChild;
      } else if (e.key === 'ArrowLeft' && selectedElement && selectedElement.previousElementSibling) {
        nextEl = selectedElement.previousElementSibling;
      } else if (e.key === 'ArrowRight' && selectedElement && selectedElement.nextElementSibling) {
        nextEl = selectedElement.nextElementSibling;
      }
      if (nextEl) {
        selectedElement = nextEl;
        const rect = nextEl.getBoundingClientRect();
        selectionOverlay.style.display = 'block';
        selectionOverlay.style.top = rect.top + 'px';
        selectionOverlay.style.left = rect.left + 'px';
        selectionOverlay.style.width = rect.width + 'px';
        selectionOverlay.style.height = rect.height + 'px';
        // Update label
        const tag = nextEl.tagName.toLowerCase();
        const id = nextEl.id ? '#' + nextEl.id : '';
        const cls = Array.from(nextEl.classList).slice(0, 3).map(c => '.' + c).join('');
        const dims = Math.round(rect.width) + '\u00D7' + Math.round(rect.height);
        selectionLabel.textContent = tag + id + cls + '  ' + dims;
        const labelH = 24;
        selectionLabel.style.top = (rect.top > labelH + 10 ? rect.top - labelH - 4 : rect.bottom + 4) + 'px';
        selectionLabel.style.left = Math.max(0, rect.left) + 'px';
      }
    }
    // Enter/Space to lock selection
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      stopSelectionMode();
      if (selectedElement) {
        sendElementInfo(selectedElement);
        setTimeout(() => {
          const computed = collectComputedStyles(selectedElement);
          sendToSidebar('elementComputed', { styles: computed });
        }, 50);
      }
    }
  }

  function getElementSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const path = [];
    while (el && el !== document.body && el !== document.documentElement) {
      let selector = el.tagName.toLowerCase();
      if (el.id) { path.unshift('#' + CSS.escape(el.id)); break; }
      if (el.className && typeof el.className === 'string') {
        const cls = el.className.trim().split(/\s+/).filter(c => c.length > 0 && !c.includes(':')).slice(0, 2);
        if (cls.length) selector += '.' + cls.map(c => CSS.escape(c)).join('.');
      }
      const parent = el.parentElement;
      if (parent) {
        // Use nth-of-type for more precise selection
        const sameTagSiblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (sameTagSiblings.length > 1) {
          const idx = sameTagSiblings.indexOf(el) + 1;
          selector += ':nth-of-type(' + idx + ')';
        }
      }
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(' > ') || 'body';
  }

  function collectElementInfo(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName.toLowerCase();
    const id = el.id || '';
    const classes = Array.from(el.classList || []);
    const attrs = {};
    Array.from(el.attributes || []).forEach(a => { attrs[a.name] = a.value; });
    const text = el.textContent ? el.textContent.trim().substring(0, 500) : '';
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    // 路径
    const path = [];
    let p = el;
    while (p && p !== document.body && p !== document.documentElement) {
      path.unshift({ tag: p.tagName.toLowerCase(), id: p.id || '', classes: Array.from(p.classList || []) });
      p = p.parentElement;
    }

    // 盒模型
    const boxModel = {
      width: rect.width, height: rect.height,
      offsetWidth: el.offsetWidth, offsetHeight: el.offsetHeight,
      marginTop: parseFloat(style.marginTop), marginRight: parseFloat(style.marginRight),
      marginBottom: parseFloat(style.marginBottom), marginLeft: parseFloat(style.marginLeft),
      borderTop: parseFloat(style.borderTopWidth), borderRight: parseFloat(style.borderRightWidth),
      borderBottom: parseFloat(style.borderBottomWidth), borderLeft: parseFloat(style.borderLeftWidth),
      paddingTop: parseFloat(style.paddingTop), paddingRight: parseFloat(style.paddingRight),
      paddingBottom: parseFloat(style.paddingBottom), paddingLeft: parseFloat(style.paddingLeft),
    };

    // 子元素摘要
    const children = [];
    Array.from(el.children).forEach(c => {
      children.push({
        tag: c.tagName.toLowerCase(),
        id: c.id || '',
        classes: Array.from(c.classList || []),
        selector: getElementSelector(c),
      });
    });

    return {
      tag, id, classes, attrs, text,
      textContent: el.textContent ? el.textContent.trim().substring(0, 5000) : '',
      selector: getElementSelector(el),
      outerHTML: el.outerHTML ? el.outerHTML.substring(0, 10000) : '',
      innerHTML: el.innerHTML ? el.innerHTML.substring(0, 10000) : '',
      path, boxModel, children,
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    };
  }

  function collectComputedStyles(el) {
    const style = window.getComputedStyle(el);
    const styles = {};
    const importantProps = [
      'display','position','width','height','max-width','max-height','min-width','min-height',
      'margin','margin-top','margin-right','margin-bottom','margin-left',
      'padding','padding-top','padding-right','padding-bottom','padding-left',
      'border','border-top','border-right','border-bottom','border-left',
      'border-radius','border-width','border-color','border-style',
      'background','background-color','background-image','background-size',
      'color','font-family','font-size','font-weight','font-style',
      'text-align','text-decoration','text-transform','line-height','letter-spacing',
      'opacity','visibility','overflow','overflow-x','overflow-y',
      'cursor','pointer-events','user-select',
      'box-shadow','transform','transition','animation',
      'flex','flex-direction','flex-wrap','justify-content','align-items','align-content',
      'grid','grid-template-columns','grid-template-rows','gap',
      'z-index','position','top','right','bottom','left',
      'outline','box-sizing','white-space','word-break','word-wrap',
      'vertical-align','float','clear',
    ];
    importantProps.forEach(p => {
      const v = style.getPropertyValue(p);
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') {
        styles[p] = v;
      }
    });
    return styles;
  }

  function collectDomTree(root, depth = 0, maxDepth = 6, maxChildren = 15) {
    if (!root || root.nodeType !== 1 || depth > maxDepth) return null;
    const node = {
      tag: root.tagName.toLowerCase(),
      id: root.id || '',
      classes: Array.from(root.classList || []),
      children: [],
    };
    const children = Array.from(root.children).slice(0, maxChildren);
    children.forEach(c => {
      const child = collectDomTree(c, depth + 1, maxDepth, 8);
      if (child) node.children.push(child);
    });
    if (root.childNodes && !root.children?.length) {
      for (const cn of root.childNodes) {
        if (cn.nodeType === 3 && cn.textContent.trim()) {
          node.text = cn.textContent.trim().substring(0, 50);
          break;
        }
      }
    }
    return node;
  }

  function sendElementInfo(el) {
    const info = collectElementInfo(el);
    const computed = collectComputedStyles(el);
    sendToSidebar('elementSelected', info);
    setTimeout(() => sendToSidebar('elementComputed', { styles: computed }), 100);
  }

  function getElementInfo(selector) {
    try {
      const el = selector ? document.querySelector(selector) : selectedElement;
      if (el) {
        selectedElement = el;
        sendElementInfo(el);
      }
    } catch(e) {
      sendToSidebar('elementSelected', { error: e.message });
    }
  }

  function getDomTree() {
    const tree = collectDomTree(document.body, 0, 5, 12);
    sendToSidebar('domTree', { children: tree ? [tree] : [] });
  }

  function modifyElement(data) {
    if (!data || !data.selector) return;
    try {
      const el = document.querySelector(data.selector);
      if (!el) return;
      const { action, attr, value, className, style, prop } = data;
      switch (action) {
        case 'setAttr': el.setAttribute(attr, value); break;
        case 'removeAttr': el.removeAttribute(attr); break;
        case 'addClass': el.classList.add(className); break;
        case 'removeClass': el.classList.remove(className); break;
        case 'setStyle': el.style.cssText = (value||'').replace(/^display:;?\s*$/,'display:;'); break;
        case 'setInlineStyle': if (prop) { el.style.setProperty(prop, value, 'important'); } break;
        case 'setHtml': el.innerHTML = value; break;
        case 'setText': el.textContent = value; break;
      }
      // 回传更新后的元素信息
      if (el) {
        selectedElement = el;
        setTimeout(() => sendElementInfo(el), 100);
      }
    } catch(e) {}
  }

  function sendToSidebar(action, data) {
    const iframe = document.getElementById(CONFIG.IFRAME_ID);
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({ action, data }, '*');
    }
  }

  let highlightOverlay = null;
  function highlightElement(data) {
    if (!data?.selector) return;
    try {
      const el = document.querySelector(data.selector);
      if (!el) return;
      if (!highlightOverlay) {
        highlightOverlay = document.createElement('div');
        highlightOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483644;border:3px solid var(--toolbox-error,#ff5722);background:rgba(255,87,34,0.1);display:none;border-radius:2px;transition:all 0.1s';
        document.body.appendChild(highlightOverlay);
      }
      if (data.show === false) { highlightOverlay.style.display = 'none'; return; }
      if (data.scroll) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const rect = el.getBoundingClientRect();
      highlightOverlay.style.top = rect.top + 'px';
      highlightOverlay.style.left = rect.left + 'px';
      highlightOverlay.style.width = rect.width + 'px';
      highlightOverlay.style.height = rect.height + 'px';
      highlightOverlay.style.display = 'block';
    } catch(e) {}
  }

  function clearHighlight() {
    if (highlightOverlay) highlightOverlay.style.display = 'none';
  }

  function deleteHostElement(data) {
    if (!data?.selector) return;
    try {
      const el = document.querySelector(data.selector);
      if (!el) return;
      el.remove();
      sendToSidebar('elementDeleted', { success: true });
      clearHighlight();
    } catch(e) {}
  }

  // 检测元素上的事件监听器（页面脚本无法直接读取通过 addEventListener 注册的监听器，
  // 仅能识别内联事件处理器与通过覆盖原型记录的监听器；这里返回最佳推断结果）
  function getEventListenersHost(data) {
    if (!data || !data.selector) {
      sendToSidebar('eventListenersResult', { listeners: [] });
      return;
    }
    try {
      const el = document.querySelector(data.selector);
      if (!el) {
        sendToSidebar('eventListenersResult', { listeners: [] });
        return;
      }
      const listeners = [];
      // 1) 内联事件处理器（onclick/onload 等）
      const inlineAttrs = ['onclick','ondblclick','onmousedown','onmouseup','onmouseover','onmouseout','onmousemove','onmouseenter','onmouseleave','onkeydown','onkeyup','onkeypress','oninput','onchange','onsubmit','onreset','onfocus','onblur','onscroll','onresize','onload','onerror','oncontextmenu','ondrag','ondragstart','ondragend','ondrop','onplay','onpause','onended','ontimeupdate','onvolumechange'];
      inlineAttrs.forEach(attr => {
        const fn = el.getAttribute(attr);
        if (fn != null) {
          listeners.push({ type: attr.substring(2), handler: 'inline: ' + (fn.length > 60 ? fn.substring(0, 60) + '...' : fn) });
        }
      });
      // 2) 若原型已被ToolCube记录（由其他注入脚本记录），尝试读取
      try {
        const stored = el.__toolboxEventListeners;
        if (Array.isArray(stored)) {
          stored.forEach(l => listeners.push({ type: l.type, handler: l.handler || 'addEventListener' }));
        }
      } catch(e) {}
      // 3) 根据标签推断常见事件
      const tag = el.tagName.toLowerCase();
      if (tag === 'a' && el.href) listeners.push({ type: 'click', handler: '链接默认行为' });
      if (tag === 'form') listeners.push({ type: 'submit', handler: '表单提交默认行为' });
      if (['input','select','textarea'].includes(tag)) listeners.push({ type: 'input', handler: '表单元素常见事件' });
      if (tag === 'button') listeners.push({ type: 'click', handler: '按钮常见事件' });
      if (tag === 'video' || tag === 'audio') listeners.push({ type: 'play/pause', handler: '媒体元素常见事件' });
      sendToSidebar('eventListenersResult', { selector: data.selector, listeners });
    } catch(e) {
      sendToSidebar('eventListenersResult', { listeners: [], error: e.message });
    }
  }

  function extractLinks() {
    const links = [];
    const hostname = window.location.hostname;
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href || a.getAttribute('href') || '';
      if (!href || href.startsWith('javascript:') || href === '#') return;
      try {
        const url = new URL(href, window.location.href);
        links.push({
          href: url.href,
          text: (a.textContent || '').trim().substring(0, 100) || href,
          type: url.hostname === hostname ? 'internal' : 'external',
          pageHost: hostname
        });
      } catch(e) {
        links.push({ href, text: (a.textContent || '').trim().substring(0, 100), type: 'unknown', pageHost: hostname });
      }
    });
    sendToSidebar('linkList', { links });
  }

  // 链接状态检测：经后台代理获取真实 HTTP 状态码。
  // 旧实现用 fetch(url, {mode:'no-cors'}) —— no-cors 响应是 opaque，读不到状态码，
  // 因此 404/500 等错误页面也会 resolve 成功，结果一律显示"可达"，属于误判。
  // 后台 fetch 不受页面 CORS 限制，能拿到真实状态码，据此区分可达与错误。
  function checkLinkStatusHost(data) {
    if (!data || !data.url) return;
    const url = data.url;
    chrome.runtime.sendMessage({ action: 'fetchHeaders', data: { url } }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        sendToSidebar('linkStatusResult', { url, status: 'error', code: 0 });
        return;
      }
      const code = typeof resp.status === 'number' ? resp.status : 0;
      // 4xx/5xx 视为链接错误；其余（含重定向后的 2xx/3xx）视为可达
      const status = (code >= 400) ? 'error' : 'ok';
      sendToSidebar('linkStatusResult', { url, status, code });
    });
  }

  async function extractColors() {
    const colorMap = {};
    const elements = document.querySelectorAll('*');
    const extractHex = (c) => {
      if (!c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent') return null;
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) return '#' + [m[1], m[2], m[3]].map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
      if (c.startsWith('#')) return c;
      return null;
    };
    // 分片处理：大页面 querySelectorAll('*') + getComputedStyle 很重，主动让出主线程
    const list = Array.prototype.slice.call(elements);
    const CHUNK = 500;
    for (let i = 0; i < list.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, list.length);
      for (let k = i; k < end; k++) {
        const el = list[k];
        try {
          const style = window.getComputedStyle(el);
          const bg = style.backgroundColor;
          const clr = style.color;
          const bd = style.borderColor;
          const hexBg = extractHex(bg);
          const hexClr = extractHex(clr);
          const hexBd = extractHex(bd);
          if (hexBg) { const key = 'bg:' + hexBg; colorMap[key] = { color: hexBg, type: 'bg', count: (colorMap[key]?.count || 0) + 1 }; }
          if (hexClr) { const key = 'text:' + hexClr; colorMap[key] = { color: hexClr, type: 'text', count: (colorMap[key]?.count || 0) + 1 }; }
          if (hexBd) { const key = 'border:' + hexBd; colorMap[key] = { color: hexBd, type: 'border', count: (colorMap[key]?.count || 0) + 1 }; }
        } catch(e) {}
      }
      if (end < list.length) {
        await new Promise(r => setTimeout(r, 0));
      }
    }
    sendToSidebar('colorList', { colors: Object.values(colorMap).sort((a, b) => b.count - a.count).slice(0, 50), cssVars: collectCssVarColors() });
  }

  // 收集页面中定义为颜色值的 CSS 自定义属性（CSS 变量）
  function collectCssVarColors() {
    const vars = [];
    const seen = new Set();
    // 颜色值正则：匹配 #hex / rgb() / rgba() / hsl() / hsla() / 命名颜色
    const colorRe = /^(#[0-9a-fA-F]{3,8}|rgb[a]?\(|hsl[a]?\(|transparent|currentColor|red|blue|green|black|white|gray|grey|yellow|orange|purple|pink|brown|cyan|magenta|navy|teal|olive|maroon|lime|aqua|silver|fuchsia)/i;
    try {
      // 优先从 :root 及所有元素的 computedStyle 中提取自定义属性
      const rootStyle = window.getComputedStyle(document.documentElement);
      // 遍历所有样式表收集变量定义
      for (let i = 0; i < document.styleSheets.length; i++) {
        try {
          const sheet = document.styleSheets[i];
          if (!sheet.cssRules) continue;
          for (let r = 0; r < sheet.cssRules.length; r++) {
            const rule = sheet.cssRules[r];
            if (!rule.style) continue;
            // 遍历规则中所有自定义属性
            for (let p = 0; p < rule.style.length; p++) {
              const prop = rule.style[p];
              if (!prop || !prop.startsWith('--')) continue;
              const val = rule.style.getPropertyValue(prop).trim();
              if (val && colorRe.test(val) && !seen.has(prop)) {
                seen.add(prop);
                vars.push({ name: prop, value: val });
              }
            }
          }
        } catch (e) { /* 跨域样式表无法访问，跳过 */ }
      }
      // 补充从 :root computedStyle 中获取的变量
      if (rootStyle) {
        const pseudoProps = ['--color', '--bg', '--background', '--text', '--border', '--primary', '--accent', '--link'];
        pseudoProps.forEach(prefix => {
          const val = rootStyle.getPropertyValue(prefix).trim();
          if (val && colorRe.test(val) && !seen.has(prefix)) {
            seen.add(prefix);
            vars.push({ name: prefix, value: val });
          }
        });
      }
    } catch (e) {}
    return vars;
  }

  // 标尺
  let rulerOverlay = null;
  function showRuler(data) {
    if (!rulerOverlay) {
      rulerOverlay = document.createElement('div');
      rulerOverlay.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483645;background:rgba(91,127,255,0.1);border:2px dashed var(--toolbox-primary, #5b7fff);pointer-events:none;';
      document.body.appendChild(rulerOverlay);
    }
    rulerOverlay.style.width = (data?.width || 400) + 'px';
    rulerOverlay.style.height = (data?.height || 200) + 'px';
    rulerOverlay.style.display = 'block';
  }
  function hideRuler() { if (rulerOverlay) rulerOverlay.style.display = 'none'; }

  // ==================== 屏幕标尺扩展功能 ====================
  // 颜色拾取模式：监听鼠标点击，采集像素颜色回传
  let colorPickActive = false;
  let colorPickOverlay = null;

  function startColorPick() {
    colorPickActive = true;
    document.body.style.cursor = 'crosshair';
    document.addEventListener('mousemove', onColorPickMove, true);
    document.addEventListener('click', onColorPickClick, true);
    document.addEventListener('keydown', onColorPickKey, true);
  }

  function stopColorPick() {
    colorPickActive = false;
    document.body.style.cursor = '';
    if (colorPickOverlay) { colorPickOverlay.style.display = 'none'; }
    document.removeEventListener('mousemove', onColorPickMove, true);
    document.removeEventListener('click', onColorPickClick, true);
    document.removeEventListener('keydown', onColorPickKey, true);
  }

  function onColorPickMove(e) {
    if (!colorPickActive) return;
    // 显示放大镜样式的预览框
    if (!colorPickOverlay) {
      colorPickOverlay = document.createElement('div');
      colorPickOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;width:80px;height:80px;border:2px solid #fff;box-shadow:0 0 0 1px #000,0 2px 8px rgba(0,0,0,.4);border-radius:4px;display:none;background-size:400% 400%;';
      document.body.appendChild(colorPickOverlay);
    }
    const color = samplePixelColor(e.clientX, e.clientY);
    colorPickOverlay.style.display = 'block';
    colorPickOverlay.style.left = (e.clientX + 16) + 'px';
    colorPickOverlay.style.top = (e.clientY + 16) + 'px';
    colorPickOverlay.style.background = color || '#fff';
  }

  function onColorPickClick(e) {
    if (!colorPickActive) return;
    e.preventDefault();
    e.stopPropagation();
    const color = samplePixelColor(e.clientX, e.clientY);
    stopColorPick();
    sendToSidebar('colorPickResult', { color: color || '#000000' });
  }

  function onColorPickKey(e) {
    if (!colorPickActive) return;
    if (e.key === 'Escape') {
      stopColorPick();
      sendToSidebar('colorPickResult', { cancelled: true });
    }
  }

  // 通过 canvas 采样指定坐标的像素颜色
  function samplePixelColor(x, y) {
    try {
      // 优先尝试通过元素背景色采集（canvas 截屏需要权限，这里降级使用元素背景色）
      const el = document.elementFromPoint(x, y);
      if (el) {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          return rgbToHex(bg);
        }
      }
      return '#ffffff';
    } catch (e) {
      return '#000000';
    }
  }

  function rgbToHex(rgb) {
    const m = rgb.match(/\d+/g);
    if (!m || m.length < 3) return '#000000';
    return '#' + m.slice(0, 3).map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
  }

  // ==================== 参考线 ====================
  const guideLines = [];

  function addGuideLine(data) {
    const direction = (data && data.direction) || 'horizontal';
    const color = (data && data.color) || '#4A90D9';
    const line = document.createElement('div');
    line.style.cssText = 'position:fixed;z-index:2147483644;pointer-events:auto;background:' + color + ';box-shadow:0 0 4px rgba(0,0,0,.3);';
    if (direction === 'horizontal') {
      line.style.left = '0';
      line.style.right = '0';
      line.style.top = '50%';
      line.style.height = '1px';
      line.style.cursor = 'ns-resize';
    } else {
      line.style.top = '0';
      line.style.bottom = '0';
      line.style.left = '50%';
      line.style.width = '1px';
      line.style.cursor = 'ew-resize';
    }
    document.body.appendChild(line);
    guideLines.push(line);
    // 启用拖动调整位置
    makeGuideDraggable(line, direction);
  }

  function makeGuideDraggable(line, direction) {
    let dragging = false;
    // 每条参考线在 document 上挂 mousemove/mouseup，若不移除会随"添加-清空参考线"
    // 的反复操作持续累积监听器。用 AbortController 统一释放（同一 signal 可一次注销全部）。
    const controller = new AbortController();
    const { signal } = controller;
    line.__toolboxGuideController = controller;

    line.addEventListener('mousedown', (e) => {
      dragging = true;
      e.preventDefault();
    }, { signal });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      if (direction === 'horizontal') {
        line.style.top = e.clientY + 'px';
      } else {
        line.style.left = e.clientX + 'px';
      }
    }, { signal });
    document.addEventListener('mouseup', () => { dragging = false; }, { signal });
    // 双击移除该参考线
    line.addEventListener('dblclick', () => {
      const idx = guideLines.indexOf(line);
      if (idx >= 0) guideLines.splice(idx, 1);
      controller.abort();
      line.remove();
    }, { signal });
  }

  function clearGuides() {
    guideLines.forEach(l => {
      try { l.__toolboxGuideController?.abort(); } catch (e) {}
      l.remove();
    });
    guideLines.length = 0;
  }

  // ==================== 元素尺寸标注 ====================
  const annotations = [];

  function annotateElement(data) {
    if (!data) return;
    // 通过 selector 定位元素并显示尺寸标签
    let target = null;
    if (data.selector) {
      try { target = document.querySelector(data.selector); } catch (e) {}
    }
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const label = document.createElement('div');
    label.style.cssText = 'position:fixed;z-index:2147483643;background:#E74C3C;color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;font-family:Consolas,monospace;pointer-events:none;box-shadow:0 1px 4px rgba(0,0,0,.3);';
    label.textContent = data.label || (Math.round(rect.width) + '×' + Math.round(rect.height));
    label.style.left = Math.max(0, rect.left) + 'px';
    label.style.top = Math.max(0, rect.top - 20) + 'px';
    document.body.appendChild(label);
    annotations.push(label);
  }

  function clearAnnotations() {
    annotations.forEach(a => a.remove());
    annotations.length = 0;
  }

  // ==================== 资源嗅探（极致级） ====================

  // 网络资源缓存 - 来自 PerformanceObserver
  const __networkResources = new Map();
  let __perfObserver = null;

  // 增量推送防抖定时器
  let __resourceUpdateTimer = null;
  // 待推送的增量资源列表
  const __pendingUpdateItems = [];
  // 实时监控开关
  let __liveMonitorEnabled = false;

  /**
   * 防抖增量推送到 sidebar：500ms 内合并多次资源发现
   */
  function __debouncedResourceUpdate() {
    if (!__liveMonitorEnabled) {
      __pendingUpdateItems.length = 0;
      return;
    }
    if (__resourceUpdateTimer) clearTimeout(__resourceUpdateTimer);
    __resourceUpdateTimer = setTimeout(() => {
      __resourceUpdateTimer = null;
      if (__pendingUpdateItems.length === 0) return;
      const newItems = __pendingUpdateItems.splice(0);
      sendToSidebar('resourceUpdate', {
        list: newItems,
        totalCount: __networkResources.size
      });
    }, 500);
  }

  /**
   * 将拦截到的资源加入 __networkResources 并触发防抖推送
   */
  function __addInterceptedResource(url, info) {
    if (!url || __networkResources.has(url)) return;
    const m = __classifyResource(url, info.initiatorType || '');
    if (!m) return;
    const entry = {
      url,
      type: m.type,
      subtype: m.subtype,
      initiatorType: info.initiatorType || 'intercept',
      transferSize: info.transferSize || 0,
      encodedBodySize: info.encodedBodySize || 0,
      decodedBodySize: info.decodedBodySize || 0,
      duration: info.duration || 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      source: info.source || 'intercept'
    };
    __networkResources.set(url, entry);
    __pendingUpdateItems.push(entry);
    __debouncedResourceUpdate();
  }

  // ==================== 网络资源收集 ====================
  // 注：早期版本在此 monkey-patch XHR/fetch/WebSocket，但 ISOLATED world 中这些原型
  // 是页面 MAIN world 的独立副本，宿主页面的真实请求不会被拦截（无效代码，已移除）。
  // 有效的资源收集依赖下方 PerformanceObserver（共享页面 performance 时间线）。

  function ensureNetworkObserver() {
    if (__perfObserver || !window.PerformanceObserver) return;
    try {
      __perfObserver = new PerformanceObserver((list) => {
        let hasNewMedia = false;
        for (const entry of list.getEntries()) {
          try {
            const url = entry.name;
            if (!url || url.startsWith('data:') || url.startsWith('blob:')) continue;
            // 仅缓存响应条目
            if (!['resource', 'navigation'].includes(entry.entryType)) continue;
            const initiatorType = entry.initiatorType || '';
            const transferSize = entry.transferSize || 0;
            const encodedBodySize = entry.encodedBodySize || 0;
            const decodedBodySize = entry.decodedBodySize || 0;
            const duration = Math.round(entry.duration || 0);
            const m = __classifyResource(url, initiatorType);
            if (!m) continue;
            // 同一 URL：保留 transferSize 最大的（资源可能被多次请求或重定向）
            const existing = __networkResources.get(url);
            const newSize = transferSize || encodedBodySize;
            const existingSize = existing ? (existing.transferSize || existing.encodedBodySize || 0) : 0;
            if (!existing || newSize >= existingSize) {
              const newEntry = {
                url, type: m.type, subtype: m.subtype, initiatorType,
                transferSize, encodedBodySize, decodedBodySize, duration,
                firstSeen: existing?.firstSeen || Date.now(),
                lastSeen: Date.now(),
                source: 'network'
              };
              __networkResources.set(url, newEntry);
              // 实时推送：检测到新的 video/audio/hls/dash 类型资源时增量推送
              if (!existing && ['video', 'audio'].includes(m.type)) {
                hasNewMedia = true;
                __pendingUpdateItems.push(newEntry);
              }
            }
          } catch (e) {}
        }
        // 防抖推送增量更新
        if (hasNewMedia) {
          __debouncedResourceUpdate();
        }
      });
      // buffered: true 捕获历史资源
      try { __perfObserver.observe({ type: 'resource', buffered: true }); } catch (e) { __perfObserver.observe({ entryTypes: ['resource'] }); }
      try { __perfObserver.observe({ type: 'navigation', buffered: true }); } catch (e) { __perfObserver.observe({ entryTypes: ['navigation'] }); }
    } catch (e) {
      console.warn('[ToolCube] PerfObserver init failed:', e);
    }
  }

  function __classifyResource(url, initiatorType) {
    const lower = url.toLowerCase().split('?')[0].split('#')[0];
    const ext = (lower.match(/\.([a-z0-9]{2,5})$/) || [,''])[1];
    const imgExt = ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif','heic','heif','tiff','tif','jxl'];
    const videoExt = ['mp4','webm','m4v','mov','mkv','avi','flv','f4v','wmv','ogv','ts','3gp','mpg','mpeg'];
    const audioExt = ['mp3','wav','ogg','m4a','flac','aac','opus','oga','wma','mid','midi'];
    const docExt = ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','rtf','csv','epub','mobi','azw3'];
    const fontExt = ['woff','woff2','ttf','otf','eot'];
    if (videoExt.includes(ext)) return { type: 'video', subtype: ext };
    if (audioExt.includes(ext)) return { type: 'audio', subtype: ext };
    if (imgExt.includes(ext)) return { type: 'image', subtype: ext };
    if (docExt.includes(ext)) return { type: 'document', subtype: ext };
    if (fontExt.includes(ext)) return { type: 'font', subtype: ext };
    if (lower.includes('.m3u8')) return { type: 'video', subtype: 'hls' };
    if (lower.includes('.mpd') || lower.includes('manifest')) return { type: 'video', subtype: 'dash' };
    // 主动通过 initiatorType 推测：HLS/DASH 流式资源常常无扩展名
    if (initiatorType === 'video' || initiatorType === 'audio' || initiatorType === 'xmlhttprequest') {
      // 检查是否为常见流式响应（兜底）
      if (lower.includes('m3u8') || lower.includes('mp4') || lower.includes('mpd')) return { type: 'video', subtype: 'media' };
    }
    if (initiatorType === 'video') return { type: 'video', subtype: ext || 'media' };
    if (initiatorType === 'audio') return { type: 'audio', subtype: ext || 'media' };
    if (initiatorType === 'img') return { type: 'image', subtype: ext || 'img' };
    if (initiatorType === 'link' || initiatorType === 'css' || initiatorType === 'script') return null;
    return null;
  }

  function __guessMimeFromUrl(url) {
    const lower = url.toLowerCase().split('?')[0].split('#')[0];
    if (/\.(jpe?g)$/i.test(lower)) return 'image/jpeg';
    if (/\.png$/i.test(lower)) return 'image/png';
    if (/\.gif$/i.test(lower)) return 'image/gif';
    if (/\.webp$/i.test(lower)) return 'image/webp';
    if (/\.svg$/i.test(lower)) return 'image/svg+xml';
    if (/\.avif$/i.test(lower)) return 'image/avif';
    if (/\.ico$/i.test(lower)) return 'image/x-icon';
    if (/\.bmp$/i.test(lower)) return 'image/bmp';
    if (/\.mp4$/i.test(lower)) return 'video/mp4';
    if (/\.webm$/i.test(lower)) return 'video/webm';
    if (/\.m4v$/i.test(lower)) return 'video/x-m4v';
    if (/\.mov$/i.test(lower)) return 'video/quicktime';
    if (/\.mkv$/i.test(lower)) return 'video/x-matroska';
    if (/\.ts$/i.test(lower)) return 'video/mp2t';
    if (/\.m3u8$/i.test(lower)) return 'application/vnd.apple.mpegurl';
    if (/\.mpd$/i.test(lower)) return 'application/dash+xml';
    if (/\.mp3$/i.test(lower)) return 'audio/mpeg';
    if (/\.wav$/i.test(lower)) return 'audio/wav';
    if (/\.ogg$/i.test(lower)) return 'audio/ogg';
    if (/\.m4a$/i.test(lower)) return 'audio/mp4';
    if (/\.flac$/i.test(lower)) return 'audio/flac';
    if (/\.aac$/i.test(lower)) return 'audio/aac';
    if (/\.opus$/i.test(lower)) return 'audio/opus';
    if (/\.pdf$/i.test(lower)) return 'application/pdf';
    if (/\.json$/i.test(lower)) return 'application/json';
    if (/\.xml$/i.test(lower)) return 'application/xml';
    if (/\.txt$/i.test(lower)) return 'text/plain';
    if (/\.csv$/i.test(lower)) return 'text/csv';
    if (/\.zip$/i.test(lower)) return 'application/zip';
    return 'application/octet-stream';
  }

  function __filenameFromUrl(url) {
    try {
      const u = new URL(url, location.href);
      const last = u.pathname.split('/').filter(Boolean).pop() || '';
      return decodeURIComponent(last.split('?')[0]) || 'unnamed';
    } catch (e) {
      return 'unnamed';
    }
  }

  function __pushUnique(map, key, item) {
    if (map.has(key)) {
      const cur = map.get(key);
      cur.refs = (cur.refs || 1) + 1;
      // 保留更精确的 size 信息
      if ((item.size || 0) > (cur.size || 0)) cur.size = item.size;
      if (item.width && !cur.width) cur.width = item.width;
      if (item.height && !cur.height) cur.height = item.height;
      // 保留时长、码率等元数据（优先保留非零值）
      if (item.duration && !cur.duration) cur.duration = item.duration;
      if (item.bitrate && !cur.bitrate) cur.bitrate = item.bitrate;
      if (item.codec && !cur.codec) cur.codec = item.codec;
      if (item.channels && !cur.channels) cur.channels = item.channels;
      if (item.sampleRate && !cur.sampleRate) cur.sampleRate = item.sampleRate;
      if (item.fps && !cur.fps) cur.fps = item.fps;
      if (item.playState && cur.playState !== 'playing') cur.playState = item.playState;
    } else {
      map.set(key, { ...item, refs: 1, firstSeen: Date.now() });
    }
  }

  async function extractResources(opts) {
    ensureNetworkObserver();
    const includeNetwork = !opts || opts.includeNetwork !== false;
    const includeDom = !opts || opts.includeDom !== false;
    const includeMeta = !opts || opts.includeMeta !== false;
    const dedupeMode = (opts && opts.dedupe) || 'exact'; // exact | host+path | aggressive
    const map = new Map();
    const keyOf = (u) => {
      try {
        const url = new URL(u, location.href);
        if (dedupeMode === 'exact') return url.href;
        if (dedupeMode === 'host+path') return url.origin + url.pathname;
        // aggressive: 去掉 path 中常见的尺寸/版本参数
        const lastPart = url.pathname.split('/').filter(Boolean).pop() || '';
        const cleaned = lastPart.replace(/[-_]\d{2,4}x\d{2,4}/i, '').replace(/[-_][a-f0-9]{6,12}/i, '');
        return url.origin + cleaned;
      } catch (e) { return u; }
    };

    // 分片遍历 + 主动让出主线程，避免大页面全量 getComputedStyle 冻结页面
    async function __forEachYield(elements, chunkSize, fn) {
      const list = Array.prototype.slice.call(elements);
      for (let i = 0; i < list.length; i += chunkSize) {
        const end = Math.min(i + chunkSize, list.length);
        for (let j = i; j < end; j++) {
          try { fn(list[j]); } catch (e) {}
        }
        if (end < list.length) {
          await new Promise(r => setTimeout(r, 0));
        }
      }
    }

    // 1) 网络资源（PerformanceObserver 缓存）
    if (includeNetwork) {
      for (const [url, info] of __networkResources) {
        if (!info.type) continue;
        const mime = __guessMimeFromUrl(url);
        const netItem = {
          url: (() => { try { return new URL(url, location.href).href; } catch (e) { return url; } })(),
          filename: __filenameFromUrl(url),
          type: info.type,
          subtype: info.subtype,
          mime,
          size: info.transferSize || info.encodedBodySize || 0,
          source: 'network',
          initiatorType: info.initiatorType,
          duration: info.duration,
          bitrate: 0
        };
        // 网络资源码率估算（基于传输大小和加载时长）
        if (info.transferSize > 0 && info.duration > 0) {
          netItem.bitrate = Math.round(info.transferSize * 8 / (info.duration / 1000) / 1000); // kbps
        }
        __pushUnique(map, keyOf(url), netItem);
      }
    }

    // 2) DOM 扫描
    if (includeDom) {
      // 2.1 <img>
      document.querySelectorAll('img').forEach(img => {
        const src = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy') || img.getAttribute('data-lazy-src');
        if (!src || src.startsWith('data:')) return;
        const url = (() => { try { return new URL(src, location.href).href; } catch (e) { return null; } })();
        if (!url) return;
        __pushUnique(map, keyOf(url), {
          url, type: 'image', subtype: 'img',
          mime: __guessMimeFromUrl(url),
          filename: __filenameFromUrl(url),
          size: img.naturalWidth && img.naturalHeight ? (img.naturalWidth * img.naturalHeight * 4) : 0,
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height,
          alt: img.alt || '',
          source: 'dom-img'
        });
        // 2.1.1 srcset 提取多个候选
        const srcset = img.getAttribute('srcset');
        if (srcset) {
          srcset.split(',').forEach(s => {
            const m = s.trim().match(/^(\S+)(?:\s+([\d.]+[wx]))?/);
            if (m && m[1]) {
              const u = (() => { try { return new URL(m[1], location.href).href; } catch (e) { return null; } })();
              if (u) __pushUnique(map, keyOf(u), {
                url: u, type: 'image', subtype: 'srcset',
                mime: __guessMimeFromUrl(u),
                filename: __filenameFromUrl(u),
                source: 'dom-srcset'
              });
            }
          });
        }
      });

      // 2.2 <picture> > <source>
      document.querySelectorAll('picture source, video source, audio source').forEach(s => {
        const src = s.src || s.getAttribute('src') || s.getAttribute('data-src');
        if (!src) return;
        const url = (() => { try { return new URL(src, location.href).href; } catch (e) { return null; } })();
        if (!url) return;
        const parentTag = s.parentElement?.tagName?.toLowerCase() || '';
        const type = parentTag === 'picture' ? 'image' : parentTag === 'video' ? 'video' : 'audio';
        const srcset = s.getAttribute('srcset');
        const mediaAttr = s.getAttribute('media') || '';
        const sType = s.getAttribute('type') || '';
        if (srcset) {
          srcset.split(',').forEach(p => {
            const m = p.trim().match(/^(\S+)(?:\s+([\d.]+[wx]))?/);
            if (m && m[1]) {
              const u = (() => { try { return new URL(m[1], location.href).href; } catch (e) { return null; } })();
              if (u) __pushUnique(map, keyOf(u), {
                url: u, type, subtype: parentTag + '-srcset',
                mime: sType || __guessMimeFromUrl(u), filename: __filenameFromUrl(u), source: 'dom-source',
                mediaQuery: mediaAttr, descriptor: m[2] || ''
              });
            }
          });
        } else {
          // 从父级 media 元素获取时长/分辨率
          const parentMedia = s.parentElement;
          const parentDuration = (parentMedia && isFinite(parentMedia.duration)) ? parentMedia.duration : 0;
          const parentWidth = (parentMedia && parentMedia.videoWidth) || 0;
          const parentHeight = (parentMedia && parentMedia.videoHeight) || 0;
          __pushUnique(map, keyOf(url), {
            url, type, subtype: parentTag || 'media',
            mime: sType || __guessMimeFromUrl(url),
            filename: __filenameFromUrl(url), source: 'dom-source',
            width: parentWidth, height: parentHeight,
            duration: parentDuration,
            mediaQuery: mediaAttr
          });
        }
      });

      // 2.3 <video> / <audio>
      document.querySelectorAll('video, audio').forEach(m => {
        const src = m.currentSrc || m.src;
        const tagName = m.tagName.toLowerCase();
        const isVideo = tagName === 'video';
        const isAudio = tagName === 'audio';
        if (src) {
          const url = (() => { try { return new URL(src, location.href).href; } catch (e) { return null; } })();
          if (url) {
            const playState = m.paused ? (m.ended ? 'ended' : 'paused') : 'playing';
            const item = {
              url, type: tagName, subtype: 'media-tag',
              mime: __guessMimeFromUrl(url), filename: __filenameFromUrl(url),
              source: 'dom-media',
              width: m.videoWidth || 0, height: m.videoHeight || 0,
              duration: isFinite(m.duration) ? m.duration : 0,
              playState,
              currentTime: isFinite(m.currentTime) ? m.currentTime : 0,
              volume: m.volume,
              muted: m.muted,
              autoplay: m.autoplay,
              loop: m.loop,
              playbackRate: m.playbackRate || 1
            };
            // 视频额外元数据
            if (isVideo && m.videoWidth) {
              item.fps = 30; // 默认估计，无API获取精确帧率
            }
            // 通过 transferSize/duration 估算码率
            if (m.duration > 0) {
              const netInfo = __networkResources.get(src);
              if (netInfo && netInfo.transferSize > 0) {
                item.bitrate = Math.round(netInfo.transferSize * 8 / m.duration / 1000); // kbps
              }
            }
            __pushUnique(map, keyOf(url), item);
          }
        }
        // 遍历 <source> 子元素获取更多格式
        m.querySelectorAll('source').forEach(s => {
          const sSrc = s.src || s.getAttribute('src');
          if (!sSrc || sSrc === src) return;
          const url = (() => { try { return new URL(sSrc, location.href).href; } catch (e) { return null; } })();
          if (!url) return;
          __pushUnique(map, keyOf(url), {
            url, type: tagName, subtype: 'media-source',
            mime: s.getAttribute('type') || __guessMimeFromUrl(url),
            filename: __filenameFromUrl(url), source: 'dom-source',
            width: isVideo ? (m.videoWidth || 0) : 0,
            height: isVideo ? (m.videoHeight || 0) : 0,
            duration: isFinite(m.duration) ? m.duration : 0,
            playState: m.paused ? 'paused' : 'playing'
          });
        });
        // poster
        if (m.tagName === 'VIDEO' && m.poster) {
          const url = (() => { try { return new URL(m.poster, location.href).href; } catch (e) { return null; } })();
          if (url) __pushUnique(map, keyOf(url), {
            url, type: 'image', subtype: 'video-poster',
            mime: __guessMimeFromUrl(url), filename: __filenameFromUrl(url), source: 'dom-poster'
          });
        }
      });

      // 2.4 background-image (computed + inline) — 分片处理避免大页面冻结
      const cssUrlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
      await __forEachYield(document.querySelectorAll('*'), 400, (el) => {
        // 内联 style
        const inline = el.getAttribute('style') || '';
        if (inline) {
          let m;
          while ((m = cssUrlRe.exec(inline)) !== null) {
            const raw = m[2];
            if (raw.startsWith('data:') || raw.startsWith('#')) continue;
            const url = (() => { try { return new URL(raw, location.href).href; } catch (e) { return null; } })();
            if (url) __pushUnique(map, keyOf(url), {
              url, type: 'image', subtype: 'inline-bg',
              mime: __guessMimeFromUrl(url), filename: __filenameFromUrl(url), source: 'css-inline'
            });
          }
        }
        // computed
        try {
          const cs = getComputedStyle(el);
          ['background-image','background','border-image','border-image-source','list-style-image','mask-image','-webkit-mask-image','cursor'].forEach(prop => {
            const v = cs.getPropertyValue(prop);
            if (!v || v === 'none' || v === 'normal') return;
            let m;
            const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
            while ((m = re.exec(v)) !== null) {
              const raw = m[2];
              if (raw.startsWith('data:') || raw.startsWith('#')) continue;
              const url = (() => { try { return new URL(raw, location.href).href; } catch (e) { return null; } })();
              if (url) __pushUnique(map, keyOf(url), {
                url, type: 'image', subtype: 'computed-bg',
                mime: __guessMimeFromUrl(url), filename: __filenameFromUrl(url), source: 'css-computed',
                cssProp: prop
              });
            }
          });
        } catch (e) {}
      });

      // 2.5 <a download> / <a href="...media...">
      document.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('data:')) return;
        const cls = __classifyResource(href, '');
        if (!cls) return;
        const url = (() => { try { return new URL(href, location.href).href; } catch (e) { return null; } })();
        if (url) __pushUnique(map, keyOf(url), {
          url, type: cls.type, subtype: cls.subtype || 'anchor',
          mime: __guessMimeFromUrl(url), filename: __filenameFromUrl(url),
          text: (a.textContent || '').trim().substring(0, 100),
          download: a.hasAttribute('download'),
          source: 'dom-anchor'
        });
      });

      // 2.6 <embed> / <object>
      document.querySelectorAll('embed, object').forEach(el => {
        const src = el.getAttribute('src') || el.getAttribute('data') || '';
        if (!src) return;
        const cls = __classifyResource(src, '');
        if (!cls) return;
        const url = (() => { try { return new URL(src, location.href).href; } catch (e) { return null; } })();
        if (url) __pushUnique(map, keyOf(url), {
          url, type: cls.type, subtype: cls.subtype || (el.tagName.toLowerCase()),
          mime: el.getAttribute('type') || __guessMimeFromUrl(url),
          filename: __filenameFromUrl(url), source: 'dom-embed'
        });
      });

      // 2.7 <iframe> 嵌入视频检测（YouTube / Bilibili 等）
      const videoIframePatterns = [
        { pattern: /youtube\.com\/embed\//i, platform: 'youtube' },
        { pattern: /youtu\.be\/embed\//i, platform: 'youtube' },
        { pattern: /youtube-nocookie\.com\/embed\//i, platform: 'youtube' },
        { pattern: /bilibili\.com\/player\//i, platform: 'bilibili' },
        { pattern: /player\.bilibili\.com/i, platform: 'bilibili' },
        { pattern: /vimeo\.com\/video\//i, platform: 'vimeo' },
        { pattern: /dailymotion\.com\/embed\//i, platform: 'dailymotion' },
        { pattern: /player\.twitch\.tv/i, platform: 'twitch' },
        { pattern: /open\.spotify\.com\/embed/i, platform: 'spotify' },
      ];
      document.querySelectorAll('iframe[src]').forEach(iframe => {
        const src = iframe.src || iframe.getAttribute('src') || '';
        if (!src) return;
        for (const { pattern, platform } of videoIframePatterns) {
          if (pattern.test(src)) {
            const url = (() => { try { return new URL(src, location.href).href; } catch (e) { return null; } })();
            if (url) __pushUnique(map, keyOf(url), {
              url, type: 'video', subtype: 'iframe-' + platform,
              mime: 'text/html', filename: __filenameFromUrl(url),
              source: 'dom-iframe',
              width: iframe.width || iframe.offsetWidth || 0,
              height: iframe.height || iframe.offsetHeight || 0
            });
            break;
          }
        }
      });

      // 2.8 <canvas> 元素标记
      document.querySelectorAll('canvas').forEach(canvas => {
        const id = canvas.id || '';
        const cls = Array.from(canvas.classList || []).slice(0, 3).join('.');
        __pushUnique(map, keyOf('canvas://' + (id || cls || canvas.offsetWidth + 'x' + canvas.offsetHeight) + '@' + (canvas.getBoundingClientRect().top + '')), {
          url: 'canvas://' + location.href + '#' + (id || 'canvas'),
          type: 'other', subtype: 'canvas',
          mime: '', filename: 'canvas' + (id ? '-' + id : ''),
          source: 'dom-canvas',
          width: canvas.width || canvas.offsetWidth || 0,
          height: canvas.height || canvas.offsetHeight || 0
        });
      });

      // 2.9 <link rel="preload"> / <link rel="prefetch"> 中的媒体资源
      document.querySelectorAll('link[rel="preload"], link[rel="prefetch"]').forEach(link => {
        const href = link.getAttribute('href') || '';
        if (!href || href.startsWith('data:')) return;
        const asVal = (link.getAttribute('as') || '').toLowerCase();
        // 仅关注 media 相关的 preload/prefetch
        if (asVal !== 'video' && asVal !== 'audio' && asVal !== 'image' && asVal !== 'media' && asVal !== 'font' && asVal !== 'fetch') return;
        const typeAttr = link.getAttribute('type') || '';
        const url = (() => { try { return new URL(href, location.href).href; } catch (e) { return null; } })();
        if (!url) return;
        // 判断资源类型
        let resType = 'other';
        let resSubtype = link.getAttribute('rel'); // preload or prefetch
        if (asVal === 'video' || asVal === 'media') { resType = 'video'; resSubtype += '-video'; }
        else if (asVal === 'audio') { resType = 'audio'; resSubtype += '-audio'; }
        else if (asVal === 'image') { resType = 'image'; resSubtype += '-image'; }
        else if (asVal === 'font') { resType = 'font'; resSubtype += '-font'; }
        else if (asVal === 'fetch') {
          // fetch 类型用 __classifyResource 二次判断
          const cls = __classifyResource(url, 'link');
          if (cls) { resType = cls.type; resSubtype = link.getAttribute('rel') + '-' + cls.subtype; }
          else return;
        }
        __pushUnique(map, keyOf(url), {
          url, type: resType, subtype: resSubtype,
          mime: typeAttr || __guessMimeFromUrl(url),
          filename: __filenameFromUrl(url), source: 'dom-link-' + link.getAttribute('rel')
        });
      });
    }

    // 3) Meta 标签 (og:image / twitter:image / apple-touch-icon / favicon)
    if (includeMeta) {
      const metaSelectors = [
        { sel: 'meta[property="og:image"]', sub: 'og-image' },
        { sel: 'meta[property="og:image:url"]', sub: 'og-image' },
        { sel: 'meta[property="og:video"]', sub: 'og-video' },
        { sel: 'meta[property="og:video:url"]', sub: 'og-video' },
        { sel: 'meta[property="og:audio"]', sub: 'og-audio' },
        { sel: 'meta[name="twitter:image"]', sub: 'twitter-image' },
        { sel: 'meta[name="twitter:image:src"]', sub: 'twitter-image' },
        { sel: 'meta[name="twitter:player:stream"]', sub: 'twitter-stream' },
        { sel: 'link[rel="apple-touch-icon"]', sub: 'apple-touch-icon' },
        { sel: 'link[rel="apple-touch-icon-precomposed"]', sub: 'apple-touch-icon' },
        { sel: 'link[rel="icon"]', sub: 'favicon' },
        { sel: 'link[rel="shortcut icon"]', sub: 'favicon' },
        { sel: 'link[rel="fluid-icon"]', sub: 'fluid-icon' },
        { sel: 'link[rel="manifest"]', sub: 'manifest' }
      ];
      metaSelectors.forEach(({ sel, sub }) => {
        document.querySelectorAll(sel).forEach(m => {
          const v = m.getAttribute('content') || m.getAttribute('href') || m.getAttribute('src') || '';
          if (!v || v.startsWith('data:')) return;
          const url = (() => { try { return new URL(v, location.href).href; } catch (e) { return null; } })();
          if (!url) return;
          let type = 'image';
          if (sub.includes('video') || sub.includes('stream')) type = 'video';
          else if (sub.includes('audio')) type = 'audio';
          else if (sub === 'manifest') type = 'document';
          __pushUnique(map, keyOf(url), {
            url, type, subtype: sub,
            mime: __guessMimeFromUrl(url), filename: __filenameFromUrl(url), source: 'meta'
          });
        });
      });
    }

    // 4) 数组化 + 排序
    const list = Array.from(map.values());
    list.sort((a, b) => {
      const order = { video: 0, audio: 1, image: 2, document: 3, font: 4, other: 9 };
      const oa = order[a.type] ?? 9, ob = order[b.type] ?? 9;
      if (oa !== ob) return oa - ob;
      return (b.size || 0) - (a.size || 0);
    });

    const summary = {
      total: list.length,
      video: list.filter(x => x.type === 'video').length,
      audio: list.filter(x => x.type === 'audio').length,
      image: list.filter(x => x.type === 'image').length,
      document: list.filter(x => x.type === 'document').length,
      font: list.filter(x => x.type === 'font').length
    };

    sendToSidebar('resourceList', { list, summary, pageUrl: location.href, pageTitle: document.title });
  }

  function clearNetworkCache() {
    __networkResources.clear();
  }

  // ==================== Web Vitals ====================
  function collectSecurityPageInfo() {
    const result = { mixedContent: [], forms: [], thirdPartyResources: [] };
    const pageHost = window.location.hostname;
    const isHttps = window.location.protocol === 'https:';

    // 混合内容检测（HTTPS 页面中的 HTTP 资源）
    if (isHttps) {
      const checkElements = [
        { sel: 'img[src^="http://"]', type: 'img' },
        { sel: 'script[src^="http://"]', type: 'script' },
        { sel: 'link[href^="http://"]', type: 'link' },
        { sel: 'iframe[src^="http://"]', type: 'iframe' },
        { sel: 'video[src^="http://"]', type: 'video' },
        { sel: 'audio[src^="http://"]', type: 'audio' },
        { sel: 'source[src^="http://"]', type: 'source' },
        { sel: 'embed[src^="http://"]', type: 'embed' },
      ];
      checkElements.forEach(({ sel, type }) => {
        document.querySelectorAll(sel).forEach(el => {
          const url = el.src || el.href || '';
          if (url) result.mixedContent.push({ type, url });
        });
      });
      // 内联样式中的 http:// 资源
      document.querySelectorAll('[style]').forEach(el => {
        const style = el.getAttribute('style') || '';
        const matches = style.match(/url\(\s*['"]?(http:\/\/[^'")]+)['"]?\s*\)/g);
        if (matches) {
          matches.forEach(m => {
            const url = m.replace(/url\(\s*['"]?/, '').replace(/['"]?\s*\)/, '');
            result.mixedContent.push({ type: 'inline-style', url });
          });
        }
      });
    }

    // 表单安全检测
    document.querySelectorAll('form[action]').forEach(form => {
      try {
        const actionUrl = new URL(form.action, window.location.href);
        if (actionUrl.protocol === 'http:') {
          result.forms.push({ action: form.action, method: form.method || 'GET' });
        }
      } catch (e) {}
    });

    // 第三方资源统计
    const domainMap = {};
    document.querySelectorAll('img[src], script[src], link[href], iframe[src]').forEach(el => {
      const src = el.src || el.href || '';
      if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;
      try {
        const url = new URL(src, window.location.href);
        if (url.hostname !== pageHost) {
          domainMap[url.hostname] = (domainMap[url.hostname] || 0) + 1;
        }
      } catch (e) {}
    });
    result.thirdPartyResources = Object.entries(domainMap).map(([domain, count]) => ({ domain, count }));

    return result;
  }

  function collectNetworkAnalysis() {
    const result = { resources: [], navigation: null };
    try {
      const entries = performance.getEntriesByType('resource');
      entries.forEach(entry => {
        result.resources.push({
          name: entry.name,
          initiatorType: entry.initiatorType,
          duration: Math.round(entry.duration),
          transferSize: entry.transferSize || 0,
          encodedBodySize: entry.encodedBodySize || 0,
          startTime: Math.round(entry.startTime),
          protocol: entry.nextHopProtocol || ''
        });
      });
    } catch (e) {}
    try {
      const navEntries = performance.getEntriesByType('navigation');
      if (navEntries.length > 0) {
        const nav = navEntries[0];
        result.navigation = {
          name: nav.name,
          duration: Math.round(nav.duration),
          transferSize: nav.transferSize || 0,
          domContentLoadedTime: Math.round(nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart),
          loadTime: Math.round(nav.loadEventEnd - nav.loadEventStart),
          protocol: nav.nextHopProtocol || ''
        };
      }
    } catch (e) {}
    return result;
  }

  // ==================== 隐私检测页面信息收集 ====================
  function privacyScanCollectPageInfo() {
    var result = {
      url: location.href,
      hostname: location.hostname,
      trackers: [],
      thirdPartyCookies: 0,
      firstPartyCookies: 0,
      localStorageKeys: 0,
      sessionStorageKeys: 0,
      fingerprintScripts: [],
      hasPrivacyPolicy: false,
      privacyPolicyUrl: '',
      thirdPartyRequests: [],
      resourceUrls: []
    };

    var trackerDomains = {
      'google-analytics.com': 'Google Analytics', 'googletagmanager.com': 'Google Tag Manager',
      'googleadservices.com': 'Google Ads', 'googlesyndication.com': 'Google AdSense',
      'doubleclick.net': 'DoubleClick', 'facebook.net': 'Facebook SDK',
      'facebook.com': 'Facebook Pixel', 'fbcdn.net': 'Facebook CDN',
      'hotjar.com': 'Hotjar', 'mixpanel.com': 'Mixpanel', 'amplitude.com': 'Amplitude',
      'segment.io': 'Segment', 'segment.com': 'Segment', 'intercom.io': 'Intercom',
      'intercomcdn.com': 'Intercom CDN', 'newrelic.com': 'New Relic', 'nr-data.net': 'New Relic Data',
      'sentry.io': 'Sentry', 'fullstory.com': 'FullStory', 'crazyegg.com': 'CrazyEgg',
      'optimizely.com': 'Optimizely', 'clarity.ms': 'Microsoft Clarity', 'hubspot.com': 'HubSpot',
      'scorecardresearch.com': 'ScorecardResearch', 'outbrain.com': 'Outbrain',
      'taboola.com': 'Taboola', 'adnxs.com': 'AppNexus', 'amazon-adsystem.com': 'Amazon Ads',
      'quantserve.com': 'Quantcast', 'moatads.com': 'Moat', 'rubiconproject.com': 'Rubicon Project',
      'pubmatic.com': 'PubMatic', 'openx.net': 'OpenX', 'criteo.com': 'Criteo',
      'adroll.com': 'AdRoll', 'pardot.com': 'Pardot', 'cdn.mxpnl.com': 'Mixpanel CDN',
      'mc.yandex.ru': 'Yandex Metrica', 'yandex.ru': 'Yandex', 'tiktok.com': 'TikTok Pixel',
      'ads.twitter.com': 'Twitter Ads', 'analytics.twitter.com': 'Twitter Analytics',
      'linkedin.com': 'LinkedIn Tracker', 'snap.licdn.com': 'LinkedIn Insight',
      'pinterest.com': 'Pinterest Tracker', 'ct.pinterest.com': 'Pinterest Conversion'
    };
    var fpPatterns = [
      { pattern: 'fingerprintjs', name: 'FingerprintJS' },
      { pattern: 'fp.js', name: 'FingerprintJS (fp.js)' },
      { pattern: 'clientjs', name: 'ClientJS' },
      { pattern: 'fingerprint2', name: 'Fingerprint2' },
      { pattern: 'canvas-fingerprint', name: 'Canvas Fingerprint' },
      { pattern: 'deviceprint', name: 'DevicePrint (Iovation)' },
      { pattern: 'threatmetrix', name: 'ThreatMetrix' },
      { pattern: 'botd', name: 'BotD' },
      { pattern: 'seon', name: 'SEON Fraud' }
    ];
    var pageHost = location.hostname;
    var allUrls = [];
    try { document.querySelectorAll('script[src]').forEach(function(el) { allUrls.push(el.src); }); } catch (e) {}
    try { document.querySelectorAll('iframe[src]').forEach(function(el) { allUrls.push(el.src); }); } catch (e) {}
    try { document.querySelectorAll('link[href]').forEach(function(el) { allUrls.push(el.href); }); } catch (e) {}
    try { document.querySelectorAll('img[src]').forEach(function(el) { allUrls.push(el.src); }); } catch (e) {}
    try { performance.getEntriesByType('resource').forEach(function(entry) { allUrls.push(entry.name); }); } catch (e) {}
    var inlineScripts = [];
    try { document.querySelectorAll('script:not([src])').forEach(function(el) { inlineScripts.push(el.textContent.substring(0, 2000).toLowerCase()); }); } catch (e) {}
    var uniqueUrls = Array.from(new Set(allUrls.filter(Boolean)));
    result.resourceUrls = uniqueUrls;
    var foundTrackers = {};
    uniqueUrls.forEach(function(url) {
      try {
        var urlHost = new URL(url).hostname;
        for (var domain in trackerDomains) {
          if (urlHost === domain || urlHost.endsWith('.' + domain)) {
            if (!foundTrackers[domain]) foundTrackers[domain] = { name: trackerDomains[domain], domain: domain, urls: [] };
            foundTrackers[domain].urls.push(url);
          }
        }
      } catch (e) {}
    });
    result.trackers = Object.values(foundTrackers);
    var thirdParty = [];
    uniqueUrls.forEach(function(url) {
      try {
        var urlHost = new URL(url).hostname;
        if (urlHost !== pageHost && !urlHost.endsWith('.' + pageHost)) thirdParty.push({ url: url, host: urlHost });
      } catch (e) {}
    });
    result.thirdPartyRequests = thirdParty;
    try { var cookies = document.cookie; if (cookies) result.firstPartyCookies = cookies.split(';').filter(function(c) { return c.trim(); }).length; } catch (e) {}
    try { result.localStorageKeys = localStorage.length; } catch (e) {}
    try { result.sessionStorageKeys = sessionStorage.length; } catch (e) {}
    var foundFp = {};
    uniqueUrls.forEach(function(url) { var lower = url.toLowerCase(); fpPatterns.forEach(function(fp) { if (lower.includes(fp.pattern) && !foundFp[fp.pattern]) foundFp[fp.pattern] = { name: fp.name, url: url }; }); });
    inlineScripts.forEach(function(text) { fpPatterns.forEach(function(fp) { if (text.includes(fp.pattern) && !foundFp[fp.pattern]) foundFp[fp.pattern] = { name: fp.name, url: '(inline script)' }; }); });
    result.fingerprintScripts = Object.values(foundFp);
    try {
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        var href = (links[i].getAttribute('href') || '').toLowerCase();
        var text = (links[i].textContent || '').toLowerCase();
        if (href.includes('privacy') || href.includes('privacypolicy') || text.includes('隐私') || text.includes('privacy policy') || text.includes('数据保护')) {
          result.hasPrivacyPolicy = true;
          result.privacyPolicyUrl = links[i].href;
          break;
        }
      }
    } catch (e) {}
    return result;
  }

  // ==================== Web Vitals 采集（模块级单例） ====================
  // 早期实现每次调用 collectWebVitals 都新建 4 个 PerformanceObserver 且从不 disconnect，
  // 工具里每点一次"刷新"就多 4 个常驻观察器，长期使用会持续累积内存与回调开销。
  // 改为单例：观察器只在首次采集时创建一次并持续累计指标，后续采集直接读取累计值。
  const __vitals = { lcp: 0, cls: 0, fid: 0, inp: 0, observers: [], isFirstCollection: true };

  function ensureVitalsObservers() {
    if (__vitals.observers.length > 0 || !window.PerformanceObserver) return;
    const add = (type, onEntries) => {
      try {
        const po = new PerformanceObserver((list) => {
          try { onEntries(list.getEntries()); } catch (e) {}
        });
        po.observe({ type, buffered: true });
        __vitals.observers.push(po);
      } catch (e) {
        // 当前浏览器不支持该 entry type（如 Firefox 的 'event'）时静默跳过
      }
    };
    add('largest-contentful-paint', (entries) => {
      const last = entries[entries.length - 1];
      if (last) __vitals.lcp = Math.max(__vitals.lcp, Math.round(last.startTime || last.renderTime || 0));
    });
    add('layout-shift', (entries) => {
      for (const entry of entries) {
        if (!entry.hadRecentInput) __vitals.cls += entry.value || 0;
      }
    });
    add('first-input', (entries) => {
      for (const entry of entries) {
        __vitals.fid = Math.max(__vitals.fid, Math.round(entry.processingStart - entry.startTime));
      }
    });
    add('event', (entries) => {
      for (const entry of entries) {
        // INP = max(processingStart - startTime, processingEnd - processingStart, duration)
        const delay = Math.round(entry.processingStart - entry.startTime);
        const processing = Math.round((entry.processingEnd || 0) - (entry.processingStart || 0));
        __vitals.inp = Math.max(__vitals.inp, Math.max(delay, processing, Math.round(entry.duration || 0)));
      }
    });
    __vitals.isFirstCollection = false;
  }

  function collectWebVitals() {
    const vitals = { lcp: 0, fid: 0, inp: 0, cls: 0, fcp: 0, ttfb: 0, navigation: null };
    // 已有性能条目
    try {
      const navEntry = performance.getEntriesByType('navigation')[0];
      if (navEntry) {
        vitals.ttfb = Math.round(navEntry.responseStart - navEntry.requestStart);
        vitals.navigation = {
          domContentLoaded: Math.round(navEntry.domContentLoadedEventEnd - navEntry.startTime),
          load: Math.round(navEntry.loadEventEnd - navEntry.startTime),
          domInteractive: Math.round(navEntry.domInteractive - navEntry.startTime),
          transferSize: navEntry.transferSize,
          encodedBodySize: navEntry.encodedBodySize
        };
      }
      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find(e => e.name === 'first-contentful-paint');
      if (fcp) vitals.fcp = Math.round(fcp.startTime);
    } catch (e) {}
    // 监听 LCP / FID / CLS / INP —— 通过模块级单例观察器累计，重复采集不会重复创建观察器
    const isFirstCollection = __vitals.isFirstCollection;
    ensureVitalsObservers();

    const flushVitals = () => {
      vitals.lcp = __vitals.lcp;
      vitals.cls = Math.round(__vitals.cls * 1000) / 1000;
      vitals.fid = __vitals.fid;
      vitals.inp = __vitals.inp;
      // 资源统计
      let resources = [];
      try { resources = performance.getEntriesByType('resource'); } catch (e) {}
      const slowResources = resources
        .filter(r => (r.duration || 0) > 200)
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 10)
        .map(r => ({ name: r.name, duration: Math.round(r.duration), size: r.transferSize || 0, type: r.initiatorType }));
      const totalSize = resources.reduce((s, r) => s + (r.transferSize || 0), 0);
      sendToSidebar('webVitals', {
        vitals,
        resources: { total: resources.length, totalSize, slow: slowResources },
        pageUrl: location.href,
        pageTitle: document.title
      });
    };

    // 首次采集时观察器刚创建，buffered 条目需要异步回填，故稍等一拍；
    // 后续采集直接读取已累计的值，不再产生额外延迟。
    if (isFirstCollection) {
      setTimeout(flushVitals, 500);
    } else {
      flushVitals();
    }
  }

  // 增强：在宿主页面上下文检测技术栈（在工具 iframe 内检测会失效）
  function detectTechStack() {
    const detected = [];
    try {
      if (document.querySelector('[data-reactroot], [data-reactid]') || document.querySelector('script[src*="react"]') || window.React || window.__REACT_DEVTOOLS_GLOBAL_HOOK__) detected.push('React');
      if (document.querySelector('[ng-version], [data-ng-app], [ng-app]') || document.querySelector('script[src*="angular"]') || window.ng) detected.push('Angular');
      if (document.querySelector('[data-v-], [data-server-rendered]') || document.querySelector('script[src*="vue"]') || window.Vue) detected.push('Vue.js');
      if (document.querySelector('script[src*="jquery"]') || window.jQuery || window.$) detected.push('jQuery');
      if (document.querySelector('script[src*="bootstrap"]') || document.querySelector('link[href*="bootstrap"]')) detected.push('Bootstrap');
      if (document.querySelector('script[src*="tailwind"]') || document.querySelector('link[href*="tailwind"]')) detected.push('Tailwind CSS');
      if (document.querySelector('link[href*="wp-content"]') || document.querySelector('meta[name="generator"][content*="WordPress"]')) detected.push('WordPress');
      if (document.querySelector('meta[name="generator"][content*="Next.js"]') || document.querySelector('[id*="__next"]') || document.querySelector('script[src*="_next/"]')) detected.push('Next.js');
      if (document.querySelector('script[src*="gtm.js"]') || document.querySelector('script[src*="googletagmanager"]')) detected.push('Google Tag Manager');
      if (document.querySelector('script[src*="google-analytics"]') || document.querySelector('script[src*="gtag"]') || window.ga || window.gtag) detected.push('Google Analytics');
      if (document.querySelector('meta[name="generator"][content*="Nuxt"]') || document.querySelector('[id*="__nuxt"]') || window.__NUXT__) detected.push('Nuxt.js');
      if (document.querySelector('script[src*="svelte"]') || document.querySelector('[class*="svelte-"]')) detected.push('Svelte');
      if (window.__PRELOADED_STATE__ || document.querySelector('script[src*="redux"]')) detected.push('Redux');
      if (document.querySelector('link[href*="font-awesome"]') || document.querySelector('i.fa, i.fas, i.far, i.fab')) detected.push('Font Awesome');
      if (document.querySelector('link[href*="materialize"]') || document.querySelector('script[src*="materialize"]')) detected.push('Materialize CSS');
      if (document.querySelector('link[href*="bulma"]')) detected.push('Bulma');
      if (document.querySelector('script[src*="lodash"]') || window._) detected.push('Lodash');
      if (document.querySelector('script[src*="moment.js"]') || window.moment) detected.push('Moment.js');
      if (document.querySelector('script[src*="axios"]') || window.axios) detected.push('Axios');
      if (document.querySelector('script[src*="gsap"]') || window.gsap) detected.push('GSAP');
      if (document.querySelector('script[src*="three.js"]') || window.THREE) detected.push('Three.js');
      if (document.querySelector('script[src*="d3.js"]') || window.d3) detected.push('D3.js');
      if (document.querySelector('script[src*="cloudflare"]') || document.querySelector('script[src*="cdn.cloudflare"]')) detected.push('Cloudflare');
      if (document.querySelector('meta[name="generator"][content*="Shopify"]') || document.querySelector('script[src*="shopify"]')) detected.push('Shopify');
      if (document.querySelector('meta[name="generator"][content*="Wix"]')) detected.push('Wix');
      if (document.querySelector('meta[name="generator"][content*="Squarespace"]')) detected.push('Squarespace');
      if (document.querySelector('meta[name="generator"][content*="Drupal"]')) detected.push('Drupal');
      if (document.querySelector('meta[name="generator"][content*="Joomla"]')) detected.push('Joomla');
      // 检测Service Worker / PWA
      if (navigator.serviceWorker && navigator.serviceWorker.controller) detected.push('PWA (Service Worker)');
      if (document.querySelector('link[rel="manifest"]')) detected.push('Web Manifest');
      // 检测 Web Components
      if (document.querySelector('[is], custom-elements') || window.customElements) {
        const customEls = Object.getOwnPropertyNames(window).filter(n => n.includes('-') && n === n.toLowerCase());
        if (customEls.length > 0) detected.push('Web Components');
      }
    } catch (e) {}
    return detected;
  }

  // ==================== 网页剪报 / 整页保存 ====================
  function capturePageAsHtml(opts) {
    const format = (opts && opts.format) || 'html'; // html | markdown | text
    const mode = (opts && opts.mode) || 'full';     // full | selection | article
    // 兼容工具发送的 downloadImages 与 inlineImages 两种参数名
    const inlineImages = !opts || (opts.inlineImages !== false && opts.downloadImages !== false);
    const maxImageBytes = (opts && opts.maxImageBytes) || 1.5 * 1024 * 1024;
    const title = document.title || 'untitled';
    const url = location.href;

    function toMarkdown(root) {
      // 极简 Markdown 转换
      function walk(node) {
        if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
        if (node.nodeType !== 1) return '';
        const tag = node.tagName.toLowerCase();
        if (['script','style','noscript','iframe','svg','canvas'].includes(tag)) return '';
        let inner = '';
        for (const c of node.childNodes) inner += walk(c);
        switch (tag) {
          case 'h1': return `\n# ${inner.trim()}\n\n`;
          case 'h2': return `\n## ${inner.trim()}\n\n`;
          case 'h3': return `\n### ${inner.trim()}\n\n`;
          case 'h4': return `\n#### ${inner.trim()}\n\n`;
          case 'h5': return `\n##### ${inner.trim()}\n\n`;
          case 'h6': return `\n###### ${inner.trim()}\n\n`;
          case 'p': return `\n${inner.trim()}\n\n`;
          case 'br': return '\n';
          case 'strong': case 'b': return `**${inner}**`;
          case 'em': case 'i': return `*${inner}*`;
          case 'code': return '`' + inner + '`';
          case 'pre': return `\n\`\`\`\n${inner}\n\`\`\`\n\n`;
          case 'blockquote': return inner.split('\n').filter(Boolean).map(l => '> ' + l).join('\n') + '\n\n';
          case 'a': {
            const href = node.getAttribute('href') || '';
            return href ? `[${inner.trim() || href}](${href})` : inner;
          }
          case 'img': {
            const src = node.getAttribute('src') || '';
            const alt = node.getAttribute('alt') || '';
            return src ? `![${alt}](${src})` : '';
          }
          case 'ul': return inner + '\n';
          case 'ol': return inner + '\n';
          case 'li': return `- ${inner.trim()}\n`;
          case 'hr': return '\n---\n\n';
          case 'table': return inner + '\n';
          case 'tr': return inner + '|\n';
          case 'th': case 'td': return `| ${inner.trim()} `;
          default: return inner;
        }
      }
      return walk(root).replace(/\n{3,}/g, '\n\n').trim() + '\n';
    }

    // 注：HTML 模式通过 <base href> 保留原图地址，无需内联大图（已移除无效的 inlineImagesIntoHTML）

    // 根据 mode 确定抓取的根节点
    function getCaptureRoot() {
      if (mode === 'selection') {
        // 选择区域模式：尝试使用页面当前选区
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const fragment = range.cloneContents();
          const container = document.createElement('div');
          container.appendChild(fragment);
          return container;
        }
        // 无选区则降级为正文
        return document.querySelector('article, main, [role="main"]') || document.body;
      }
      if (mode === 'article') {
        // 仅正文模式：优先 article/main 标签
        return document.querySelector('article, main, [role="main"]') || document.body;
      }
      return document.body;
    }

    let content = '';
    if (format === 'markdown') {
      const root = getCaptureRoot();
      content = toMarkdown(root);
    } else if (format === 'text') {
      // 纯文本格式：工具端会再次转换，这里返回 HTML 让工具处理
      const root = getCaptureRoot();
      const clone = root.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,iframe').forEach(el => el.remove());
      content = clone.innerHTML || '';
    } else {
      // html: 拷贝根节点并移除ToolCube注入的元素 + 内联核心样式
      const root = getCaptureRoot();
      const doctype = '<!DOCTYPE html>\n';
      const head = `<head><meta charset="utf-8"><title>${escapeHtml(title)}</title><base href="${escapeAttr(url)}">` +
                   `<meta name="toolbox-source" content="${escapeAttr(url)}">` +
                   `<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;line-height:1.6;max-width:900px;margin:24px auto;padding:0 16px;color:#222;}img{max-width:100%;height:auto;}pre{background:#f4f4f4;padding:12px;border-radius:6px;overflow-x:auto;}code{background:#f4f4f4;padding:2px 4px;border-radius:3px;}blockquote{border-left:3px solid #ddd;margin:0;padding:0 12px;color:#666;}</style></head>`;
      const clone = root.cloneNode(true);
      clone.querySelectorAll('[id^="toolbox-"], [id^="toolbox_"], .toolbox-sidebar, .toolbox-toggle-btn').forEach(el => el.remove());
      const body = '<body>' + clone.innerHTML + '</body>';
      content = doctype + '<html>' + head + body + '</html>';
    }

    function escapeHtml(s) { return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
    function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }

    sendToSidebar('pageCaptureResult', { format, content, title, url, size: content.length, mode });
  }

  // ==================== LocalStorage / SessionStorage ====================
  function getStorageSnapshot(kind) {
    try {
      const store = kind === 'session' ? sessionStorage : localStorage;
      const out = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        out.push({ key: k, value: store.getItem(k) });
      }
      return { success: true, kind, items: out, origin: location.origin };
    } catch (e) {
      return { success: false, kind, error: e.message, origin: location.origin };
    }
  }

  function setStorageItem(kind, key, value) {
    try {
      const store = kind === 'session' ? sessionStorage : localStorage;
      store.setItem(key, value);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function removeStorageItem(kind, key) {
    try {
      const store = kind === 'session' ? sessionStorage : localStorage;
      store.removeItem(key);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function clearStorage(kind) {
    try {
      const store = kind === 'session' ? sessionStorage : localStorage;
      store.clear();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ==================== 剪贴板自动记录（仅在前台询问后启用）===================
  // 通过消息 startClipboardWatch 启用，stopClipboardWatch 停用
  let __clipboardPoller = null;
  let __lastClipboardText = '';
  function startClipboardWatch() {
    if (__clipboardPoller) return;
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      sendToSidebar('clipboardError', { error: 'Clipboard API 不可用' });
      return;
    }
    __clipboardPoller = setInterval(async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text !== __lastClipboardText) {
          __lastClipboardText = text;
          sendToSidebar('clipboardUpdate', { text, ts: Date.now() });
        }
      } catch (e) {
        // 权限被拒，停止轮询
        stopClipboardWatch();
        sendToSidebar('clipboardError', { error: '剪贴板读取权限被拒绝' });
      }
    }, 1000);
  }
  function stopClipboardWatch() {
    if (__clipboardPoller) { clearInterval(__clipboardPoller); __clipboardPoller = null; }
  }

  // ==================== 键盘快捷键 ====================

  /**
   * 键盘事件处理
   *
   * 侧边栏的全局唤出由 manifest.json 的 commands（toggle-sidebar = Ctrl+Shift+B）负责，
   * 那是浏览器级快捷键：页面未聚焦时同样生效，且允许用户在浏览器设置里改键。
   * 早期这里额外实现了一个页面级 Ctrl+Shift+Y，与文档/清单中的 B 不一致，
   * 且会对**每个网站**劫持该组合键（keydown + preventDefault）。二者属于同一功能的重复实现，
   * 只会让用户困惑，故已移除；这里仅保留与侧边栏状态相关的 ESC。
   */
  function handleKeyDown(e) {
    // ESC 关闭侧边栏
    if (e.key === 'Escape' && state.isOpen) {
      closeSidebar();
    }
  }

  // ==================== 初始化 ====================

  /**
   * 初始化注入器
   */
  async function init() {
    console.log('[ToolCube] Content injector initializing...');

    // ===== 关键顺序：先同步注册全部消息监听器，再执行任何 await =====
    // background 在注入 content script 后仅等待约 100ms 就会发送 openSidebar / openTool。
    // 若把监听器注册放在 storage/settings 的 await 之后，这段窗口内到达的消息会因
    // "没有接收端"（Receiving end does not exist）而丢失，用户表现为首次点击侧边栏无反应。
    // 监听器内部在“调用时”才读取 state.masterEnabled，因此提前注册不影响全局开关语义。

    // 监听消息
    window.addEventListener('message', handleMessage);

    // 转发 MAIN world 消息到 sidebar（如 video-unlocker 响应）
    // MAIN world 脚本通过 window.postMessage 发送的响应无法被 sidebar 直接接收，
    // 需要 ISOLATED world 的 injector 转发
    window.addEventListener('message', function(e) {
      if (!e.data || typeof e.data !== 'object') return;
      // 跳过自己转发的消息（已由 handleMessage 处理）
      if (e.data.__toolboxForwarded) return;
      // 只转发来自 MAIN world 的消息（排除 sidebar iframe 和 tool iframe 的消息）
      const sidebarIframe = document.getElementById(CONFIG.IFRAME_ID);
      if (sidebarIframe && e.source === sidebarIframe.contentWindow) return;
      const action = e.data.action;
      // 转发 MAIN world 响应到 sidebar
      if (action === 'videoUnlocker:status' ||
          action === 'videoUnlocker:scanResult' ||
          action === 'videoUnlocker:pong' ||
          action === 'videoUnlocker:extractUrlsResult' ||
          action === 'videoUnlocker:fullscreenResult' ||
          action === 'videoUnlocker:downloadResult' ||
          action === 'videoStatus' ||
          action === 'detectVideosResult' ||
          action === 'apn:detectionTriggered' ||
          action === 'apn:log' ||
          action === 'apn:nextFound') {
        sendToSidebar(e.data);
      }
    });

    // ===== 监听器注册完毕，开始异步读取状态与设置 =====
    // 全局开关检查：若关闭则不创建UI，但消息监听器已注册，仍能接收 masterSwitchOn
    try {
      const masterResult = await chrome.storage.local.get('toolbox_master_enabled');
      state.masterEnabled = masterResult.toolbox_master_enabled !== false;
    } catch (e) {}
    console.log('[ToolCube] Master switch:', state.masterEnabled ? 'ON' : 'OFF');

    // 加载设置（特别是主题），确保宿主页面主题属性正确
    if (state.masterEnabled) {
      await loadSettings();
    }

    // 创建切换按钮（如果启用了悬浮按钮且全局开关开启）
    if (state.masterEnabled && state.showFloatingBtn !== false) {
      createToggleButton();
    }

    // 监听键盘事件
    document.addEventListener('keydown', handleKeyDown);

    // 监听来自background的消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const { action, data } = message;

      // 全局开关检查（白名单：UI入口操作 + 开关控制 不受全局开关限制）
      const UI_WHITELIST = new Set([
        'masterSwitchOff', 'masterSwitchOn',
        'toggleSidebar', 'openSidebar', 'focusSearch',
        '__getFullPageDimensions', '__scrollTo'
      ]);
      if (!UI_WHITELIST.has(action) && !state.masterEnabled) {
        sendResponse({ success: false, error: 'Master switch is off' });
        return true;
      }

      switch (action) {
        case 'masterSwitchOff':
          // 全局开关关闭（来自 background）：停止自身功能并广播到 MAIN world
          state.masterEnabled = false;
          { const btn = document.getElementById(CONFIG.TOGGLE_BTN_ID);
            if (btn) btn.style.display = 'none'; }
          closeSidebar();
          window.postMessage({ action: 'masterSwitchOff', source: 'toolbox', __toolboxForwarded: true }, '*');
          sendResponse({ success: true });
          break;
        case 'masterSwitchOn':
          // 全局开关开启（来自 background）：恢复自身功能并广播到 MAIN world
          state.masterEnabled = true;
          // 恢复时重新加载设置（确保 showFloatingBtn 等状态正确）
          loadSettings().then(() => {
            // 恢复悬浮按钮：如果按钮不存在（init时开关关闭未创建），则创建
            if (state.showFloatingBtn !== false) {
              let btn = document.getElementById(CONFIG.TOGGLE_BTN_ID);
              if (!btn) {
                createToggleButton();
              } else {
                btn.style.display = '';
              }
            }
          });
          window.postMessage({ action: 'masterSwitchOn', source: 'toolbox', __toolboxForwarded: true }, '*');
          sendResponse({ success: true });
          break;
        case 'toggleSidebar':
          toggleSidebar();
          sendResponse({ success: true });
          break;
        case 'openSidebar':
          openSidebar();
          sendResponse({ success: true });
          break;
        case 'openTool':
          openTool(data.toolId, data.params);
          sendResponse({ success: true });
          break;
        case 'openToolWithData':
          openToolWithData(data.toolId, data.input);
          sendResponse({ success: true });
          break;
        case 'focusSearch':
          focusSearch();
          sendResponse({ success: true });
          break;
        case 'getSelectedText':
          getSelectedText();
          sendResponse({ success: true, text: window.getSelection().toString() });
          break;
        // ===== 全页面截图支持：获取页面尺寸 =====
        case '__getFullPageDimensions':
          sendResponse({
            success: true,
            scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
            scrollHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1
          });
          break;
        // ===== 全页面截图支持：滚动到指定位置 =====
        case '__scrollTo':
          try {
            const sx = (data && data.x) || 0;
            const sy = (data && data.y) || 0;
            window.scrollTo(sx, sy);
            sendResponse({ success: true });
          } catch(e) {
            sendResponse({ success: false, error: e.message });
          }
          break;
        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }

      return true;
    });

    // 监听主题存储变化
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.toolbox_settings) {
        const newSettings = changes.toolbox_settings.newValue;
        if (newSettings && newSettings.theme) {
          applyHostTheme(newSettings.theme);
        }
      }
    });

    console.log('[ToolCube] Content injector initialized');
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
