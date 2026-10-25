/**
 * 站点外壳行为（静态 header 版）
 *
 * 从 scripts/header.js 拆出来的：header.js 原先既负责「生成并插入 header 的 HTML」
 * 又负责「绑定交互」。现在 header 由 tools/site_shell.py 在构建期直接写进页面
 * （首屏就有，不闪），这个脚本只负责剩下的行为部分。
 *
 * 用法（放在 <head> 里，audioPlayer.js 之后）：
 *   <script src="[前缀]scripts/site-shell.js" defer></script>
 *
 * 做两件事：
 *   1. 移动端菜单展开/收起
 *   2. 派发 headerLoaded 事件（scripts/audioPlayer.js 靠它重绑静音/切源按钮；
 *      setupEventListeners 内部会 cloneNode 去重，重复触发无副作用）
 */
(function () {
    'use strict';

    var VERSION = '2.0.0';

    function ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    function setupMobileMenu() {
        var btn = document.getElementById('mobile-menu-btn');
        var navLinks = document.querySelector('.nav-links');
        if (!btn || !navLinks) return;

        btn.addEventListener('click', function () {
            btn.classList.toggle('active');
            navLinks.classList.toggle('mobile-open');
        });

        navLinks.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', function () {
                btn.classList.remove('active');
                navLinks.classList.remove('mobile-open');
            });
        });
    }

    ready(function () {
        setupMobileMenu();
        window.dispatchEvent(new CustomEvent('headerLoaded', { detail: { version: VERSION } }));
    });
})();
