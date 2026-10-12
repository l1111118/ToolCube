/**
 * Video Enhancer - 视频增强兼容性脚本 (Firefox 版)
 * Firefox 不支持 world: 'MAIN'，通过自注入机制将脚本注入到 MAIN world
 * 强制启用视频控件、画中画、全屏等被网站禁用的功能
 */
(function() {
  'use strict';

  // Firefox MAIN world 自注入检测
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    // 当前运行在 ISOLATED world，需要自注入到 MAIN world
    // 全局开关检查：若关闭则完全不注入，等同于扩展不存在
    chrome.storage.local.get('toolbox_master_enabled', function(masterResult) {
      if (masterResult.toolbox_master_enabled === false) return;
      const scriptUrl = chrome.runtime.getURL('content/video-enhancer.js');
      const s = document.createElement('script');
      s.src = scriptUrl;
      (document.documentElement || document.head).prepend(s);
      s.onload = () => s.remove();
    });
    return;
  }

  // 以下代码运行在 MAIN world
  if (window.__toolboxVideoEnhancer) return;
  window.__toolboxVideoEnhancer = true;

  // 全局开关状态（MAIN world 无法访问 chrome.storage，通过消息同步）
  var enhancerActive = true;
  window.addEventListener('message', function(e) {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.action === 'masterSwitchOff') {
      enhancerActive = false;
    } else if (e.data.action === 'masterSwitchOn') {
      enhancerActive = true;
    }
  });

  function enhanceVideo(video) {
    if (!enhancerActive) return; // 全局开关关闭时不增强
    // 强制 controlsList 不包含 nofullscreen
    try {
      if (video.controlsList && video.controlsList.contains('nofullscreen')) {
        video.controlsList.remove('nofullscreen');
      }
    } catch (e) {}

    // 移除禁止画中画属性
    video.removeAttribute('disablepictureinpicture');
    delete video.disablePictureInPicture;

    // 移除禁止远程播放属性
    video.removeAttribute('disableremoteplayback');
    delete video.disableRemotePlayback;

    // 强制显示控件（如果网站隐藏了控件）
    if (!video.hasAttribute('controls') && video.src) {
      video.setAttribute('controls', '');
    }

    // 添加移动端兼容属性
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
  }

  function enhanceAllVideos(root) {
    const videos = root.querySelectorAll('video');
    videos.forEach(enhanceVideo);
  }

  // 增强视频元素的属性和控件可用性（不劫持 pause/play 以避免干扰网站正常逻辑）

  // 拦截 controlsList 的 setter，阻止设置 nofullscreen
  // 注意：所有原型改写都必须在生效时检查 enhancerActive，
  // 否则全局开关关闭后这些改写仍会持续作用于页面，违背"关闭后等同于扩展不存在"的约定。
  try {
    const controlsListDesc = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, 'controlsList');
    if (controlsListDesc && controlsListDesc.set) {
      const origSetter = controlsListDesc.set;
      Object.defineProperty(HTMLVideoElement.prototype, 'controlsList', {
        get: controlsListDesc.get,
        set: function(val) {
          if (!enhancerActive) return origSetter.call(this, val);
          // 移除 nofullscreen
          if (typeof val === 'string' && val.includes('nofullscreen')) {
            val = val.replace(/nofullscreen/g, '').replace(/^\s+|\s+$/g, '');
          }
          return origSetter.call(this, val);
        },
        configurable: true
      });
    }
  } catch (e) {}

  // 拦截 setAttribute 对关键属性的设置
  const origSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (!enhancerActive) return origSetAttribute.call(this, name, value);
    if (this instanceof HTMLVideoElement) {
      // 阻止设置 disablePictureInPicture
      if (name === 'disablepictureinpicture' || name === 'disablePictureInPicture') {
        return;
      }
      // 阻止设置 disableRemotePlayback
      if (name === 'disableremoteplayback' || name === 'disableRemotePlayback') {
        return;
      }
      // 清理 controlsList 中的 nofullscreen（属性名大小写不敏感，需同时匹配两种写法）
      if ((name === 'controlsList' || name === 'controlslist') && typeof value === 'string' && value.includes('nofullscreen')) {
        value = value.replace(/nofullscreen/g, '').replace(/^\s+|\s+$/g, '');
      }
    }
    return origSetAttribute.call(this, name, value);
  };

  // DOMContentLoaded 时处理已有视频
  function processExisting() {
    enhanceAllVideos(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', processExisting);
  } else {
    processExisting();
  }

  // MutationObserver 监听新增视频元素
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.tagName === 'VIDEO') {
            enhanceVideo(node);
          }
          if (node.querySelectorAll) {
            enhanceAllVideos(node);
          }
          // Shadow DOM
          if (node.shadowRoot) {
            enhanceAllVideos(node.shadowRoot);
          }
        }
      }
    }
    // 也处理属性变化
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLVideoElement) {
        enhanceVideo(mutation.target);
      }
    }
  });

  // 等待 documentElement 存在后观察
  function startObserver() {
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['controlsList', 'disablepictureinpicture', 'disableremoteplayback', 'controls']
      });
    } else {
      setTimeout(startObserver, 50);
    }
  }
  startObserver();
})();
