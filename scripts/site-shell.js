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
 *   1. 移动端菜单展开/收起（点击按钮、点链接、点外部、按 Esc、转到桌面宽度都会收）
 *   2. 派发 headerLoaded 事件（scripts/audioPlayer.js 靠它重绑静音/切源按钮；
 *      setupEventListeners 内部会 cloneNode 去重，重复触发无副作用）
 */
(function () {
    'use strict';

    var VERSION = '2.1.0';

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

        function isOpen() {
            return navLinks.classList.contains('mobile-open');
        }

        function setOpen(open) {
            navLinks.classList.toggle('mobile-open', open);
            btn.classList.toggle('active', open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', '打开导航菜单');

        btn.addEventListener('click', function (e) {
            // 阻止冒泡，否则会被下面的「点外部关闭」立刻关掉
            e.stopPropagation();
            setOpen(!isOpen());
        });

        navLinks.querySelectorAll('a').forEach(function (link) {
            link.addEventListener('click', function () {
                setOpen(false);
            });
        });

        // 点抽屉外面关闭
        document.addEventListener('click', function (e) {
            if (!isOpen()) return;
            if (navLinks.contains(e.target) || btn.contains(e.target)) return;
            setOpen(false);
        });

        // Esc 关闭
        document.addEventListener('keydown', function (e) {
            if ((e.key === 'Escape' || e.key === 'Esc') && isOpen()) {
                setOpen(false);
                btn.focus();
            }
        });

        // 视口回到桌面宽度时把状态清干净，避免「看不见但仍占着类名 / 锁着滚动」
        if (window.matchMedia) {
            var mq = window.matchMedia('(min-width: 901px)');
            var sync = function () { if (mq.matches) setOpen(false); };
            if (mq.addEventListener) mq.addEventListener('change', sync);
            else if (mq.addListener) mq.addListener(sync);
        }
    }

    ready(function () {
        setupMobileMenu();
        window.dispatchEvent(new CustomEvent('headerLoaded', { detail: { version: VERSION } }));
    });
})();
