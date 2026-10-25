/**
 * 图片墙：数据驱动渲染 + 瀑布流 + 灯箱
 *
 * 用法：
 *   1. 在 pages/picture.html 里放两个空容器（如 <div id="maodie-gallery"></div>、
 *      <div id="mocai-gallery"></div>）和一个灯箱结构（见页面模板）。
 *   2. 本脚本扫描下面的 GALLERIES 配置，用 JS 循环生成 <img>，避免手写整段 HTML。
 *   3. 加图 / 删图 / 改顺序，只需改对应 files 数组，不用动页面结构。
 *
 * 依赖：无。纯原生，无框架。
 */
(function () {
    'use strict';

    // 图片根路径：从本脚本自身的 URL 反推站点根，不依赖页面深度，也不走 jsDelivr
    var SITE_ROOT = (function () {
        var RE = /\/scripts\/pictureGallery\.js(?:[?#]|$)/;
        var s = document.currentScript;
        if (!s || !s.src || !RE.test(s.src)) {
            s = Array.prototype.slice.call(document.getElementsByTagName('script'))
                .filter(function (x) { return x.src && RE.test(x.src); }).pop();
        }
        if (!s || !s.src) return '';
        try { return new URL('..', s.src).href; } catch (e) { return ''; }
    })();
    var CDN = SITE_ROOT + 'assets/images/';

    // 每套图的配置
    //  - containerId: 页面里挂载点的 id
    //  - subdir: 图片在 CDN 下的子目录（assets/images/ 之下）
    //  - label: alt / 说明的前缀，用于生成可读且不重复的文字
    //  - files: 文件名数组，按展示顺序
    var GALLERIES = [
        {
            containerId: 'qiyi-gallery',
            subdir: 'qiyi',
            label: '奇异搞笑',
            files: [
                'qy_1.jpg', 'qy_2.png', 'qy_3.gif', 'qy_4.jpg',
                'qy_5.gif', 'qy_6.gif', 'qy_7.gif', 'qy_8.gif'
            ]
        },
        {
            containerId: 'maodie-gallery',
            subdir: 'maodie',
            label: '耄耋图',
            files: [
                'md_1.gif', 'md_1.jpg', 'md_2.gif', 'md_2.jpg', 'md_3.jpg',
                'next (1).png', 'next (1).jpeg', 'next (2).jpeg', 'next (3).jpeg',
                'next (4).jpeg', 'next (1).gif', 'next (5).jpeg', 'next (6).jpeg',
                'next (7).jpeg', 'next (8).jpeg', 'next (2).gif', 'next (3).gif',
                'next (4).gif', 'next (9).jpeg', 'danceInf.gif', 'catty.gif',
                '28.gif', '29.gif', '1.jpg', '2.jpg', '3.gif', '4.jpg', '5.jpg',
                '6.jpg', '7.jpg', '8.jpg', '9.jpg', '10.jpg', '11.jpg', '12.jpg',
                '13.jpg', '14.jpg', '15.jpg', '16.jpg', '17.jpg', '18.jpg', '19.jpg',
                '20.jpg', '21.jpg', '22.jpg', '23.jpg', '24.gif', '25.jpg', '26.jpg',
                '27.jpg', 'hit.gif', '30.jpeg'
            ]
        },
        {
            containerId: 'mocai-gallery',
            subdir: 'mocai',
            label: '魔法少女图',
            files: [
                '3 (1).png', '3 (1).jpeg', '3 (2).jpeg',
                '1 (1).gif', '1 (1).jpeg', '1 (1).png', '1 (1).webp',
                '1 (10).jpeg', '1 (10).png', '1 (11).jpeg', '1 (11).png',
                '1 (12).jpeg', '1 (13).jpeg', '1 (14).jpeg', '1 (15).jpeg',
                '1 (16).jpeg', '1 (17).jpeg', '1 (18).jpeg', '1 (19).jpeg',
                '1 (2).jpeg', '1 (2).png', '1 (2).webp', '1 (20).jpeg',
                '1 (21).jpeg', '1 (22).jpeg', '1 (3).jpeg', '1 (3).png',
                '1 (4).jpeg', '1 (4).png', '1 (5).jpeg', '1 (5).png',
                '1 (6).jpeg', '1 (6).png', '1 (7).jpeg', '1 (7).png',
                '1 (8).jpeg', '1 (8).png', '1 (9).jpeg', '1 (9).png',
                '1234.gif',
                '2 (1).jpeg', '2 (1).png', '2 (1).jpg',
                '2 (2).jpeg', '2 (2).jpg', '2 (2).png',
                '2 (3).jpeg', '2 (3).png', '2 (4).jpeg', '2 (4).png',
                '2 (5).jpeg', '2 (5).png', '2 (6).jpeg', '2 (7).jpeg',
                '2 (8).jpeg', '2 (9).jpeg', '2 (10).jpeg', '2 (11).jpeg',
                '2 (12).jpeg', '2 (13).jpeg'
            ]
        }
    ];

    // ---- 渲染 ----

    function renderGallery(config) {
        var container = document.getElementById(config.containerId);
        if (!container) return [];

        container.classList.add('gallery-masonry');
        var items = [];

        config.files.forEach(function (file, i) {
            var src = CDN + config.subdir + '/' + file;
            var alt = config.label + ' ' + (i + 1);

            var item = document.createElement('div');
            item.className = 'gallery-item';
            item.tabIndex = 0;
            item.setAttribute('role', 'button');
            item.setAttribute('aria-label', '查看大图：' + alt);

            var img = document.createElement('img');
            img.src = src;
            img.alt = alt;
            img.loading = 'lazy';
            img.decoding = 'async';

            item.appendChild(img);
            container.appendChild(item);

            items.push({ src: src, alt: alt, el: item });
        });

        return items;
    }

    function bindItem(item, items, i) {
        var open = function () { openLightbox(items, i); };
        item.el.addEventListener('click', open);
        item.el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
    }

    // ---- 灯箱 ----

    var lightboxEl, lightboxImg, lbCaption, lbCounter, lbPrev, lbNext, lbClose;
    var gallery = [];
    var currentIndex = 0;
    var lastFocused = null;

    function initLightbox() {
        lightboxEl = document.getElementById('gallery-lightbox');
        if (!lightboxEl) return;

        lightboxImg = lightboxEl.querySelector('.lightbox-img');
        lbCaption = lightboxEl.querySelector('.lightbox-caption');
        lbCounter = lightboxEl.querySelector('.lightbox-counter');
        lbPrev = lightboxEl.querySelector('.lightbox-prev');
        lbNext = lightboxEl.querySelector('.lightbox-next');
        lbClose = lightboxEl.querySelector('.lightbox-close');

        lbClose.addEventListener('click', closeLightbox);
        lbPrev.addEventListener('click', function (e) { e.stopPropagation(); showPrev(); });
        lbNext.addEventListener('click', function (e) { e.stopPropagation(); showNext(); });
        lightboxEl.addEventListener('click', function (e) {
            if (e.target === lightboxEl) closeLightbox();
        });
        document.addEventListener('keydown', onKeydown);
    }

    function openLightbox(items, index) {
        if (!lightboxEl) return;
        gallery = items;
        currentIndex = index;
        lastFocused = document.activeElement;
        updateLightbox();
        lightboxEl.classList.add('open');
        document.body.style.overflow = 'hidden';
        lbClose.focus();
    }

    function closeLightbox() {
        if (!lightboxEl) return;
        lightboxEl.classList.remove('open');
        document.body.style.overflow = '';
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    function updateLightbox() {
        var item = gallery[currentIndex];
        if (!item) return;
        lightboxImg.src = item.src;
        lightboxImg.alt = item.alt;
        lbCaption.textContent = item.alt;
        lbCounter.textContent = (currentIndex + 1) + ' / ' + gallery.length;
        lbPrev.disabled = currentIndex === 0;
        lbNext.disabled = currentIndex === gallery.length - 1;
    }

    function showPrev() {
        if (currentIndex > 0) { currentIndex -= 1; updateLightbox(); }
    }

    function showNext() {
        if (currentIndex < gallery.length - 1) { currentIndex += 1; updateLightbox(); }
    }

    function onKeydown(e) {
        if (!lightboxEl || !lightboxEl.classList.contains('open')) return;
        if (e.key === 'Escape') closeLightbox();
        else if (e.key === 'ArrowLeft') showPrev();
        else if (e.key === 'ArrowRight') showNext();
    }

    // ---- 启动 ----

    function init() {
        GALLERIES.forEach(function (g) {
            var items = renderGallery(g);
            items.forEach(function (it, i) { bindItem(it, items, i); });
        });
        initLightbox();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
