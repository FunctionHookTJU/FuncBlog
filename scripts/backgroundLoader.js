/**
 * 背景图片分段式加载器
 * 优先加载最小尺寸图片，逐步加载大尺寸图片
 * 实现虚化过渡效果
 */
/* 站点根：从本脚本自身的 URL 反推（页面深度不同也能算对，且不写死域名） */
var SITE_ROOT = (function () {
    var RE = /\/scripts\/backgroundLoader\.js(?:[?#]|$)/;
    var s = document.currentScript;
    if (!s || !s.src || !RE.test(s.src)) {
        s = Array.prototype.slice.call(document.getElementsByTagName('script'))
            .filter(function (x) { return x.src && RE.test(x.src); }).pop();
    }
    if (!s || !s.src) return '';
    try { return new URL('..', s.src).href; } catch (e) { return ''; }
})();

class BackgroundLoader {
    constructor(options = {}) {
        this.images = [
            { name: 'background144p.webp', size: '144p' },
            { name: 'background360p.webp', size: '360p' },
            { name: 'background720p.webp', size: '720p' },
            { name: 'background1k.webp', size: '1k' },
            { name: 'background2k.webp', size: '2k' },
            { name: 'background4k.webp', size: '4k' }
        ];
        
        this.path = options.path || SITE_ROOT + 'assets/images/bg/';
        this.container = options.container || document.body;
        this.blurAmount = options.blurAmount || 0;
        this.transitionDuration = options.transitionDuration || 300;
        
        this.currentIndex = -1;
        this.loadedImages = [];
        this.isLoading = false;
        
        this.init();
    }
    
    init() {
        // 创建背景容器
        this.createBackgroundContainer();
        // 开始加载最小图片
        this.loadNext();
    }
    
    createBackgroundContainer() {
        // 创建主背景容器
        this.backgroundContainer = document.createElement('div');
        this.backgroundContainer.className = 'background-container';
        this.backgroundContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: -2;
            overflow: hidden;
        `;
        
        // 创建每张图片的图层
        this.images.forEach((image, index) => {
            const layer = document.createElement('div');
            layer.className = `background-layer layer-${index}`;
            layer.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-size: cover;
                background-position: center;
                background-repeat: no-repeat;
                opacity: 0;
                transition: opacity ${this.transitionDuration}ms ease-in-out;
            `;
            
            this.backgroundContainer.appendChild(layer);
        });
        
        this.container.appendChild(this.backgroundContainer);
    }
    
    loadNext() {
        if (this.currentIndex >= this.images.length - 1) {
            console.log('所有背景图片加载完成');
            return;
        }
        
        this.currentIndex++;
        const imageInfo = this.images[this.currentIndex];
        this.loadImage(imageInfo);
    }
    
    loadImage(imageInfo) {
        this.isLoading = true;
        const img = new Image();
        
        img.onload = () => {
            this.onImageLoad(imageInfo, img);
        };
        
        img.onerror = () => {
            console.warn(`加载图片失败: ${imageInfo.name}`);
            this.loadNext();
        };
        
        // 使用稳定 URL，允许浏览器与 CDN 正常缓存
        img.src = `${this.path}${imageInfo.name}`;
    }
    
    onImageLoad(imageInfo, img) {
        const layerIndex = this.images.indexOf(imageInfo);
        const layer = this.backgroundContainer.querySelector(`.layer-${layerIndex}`);
        
        if (layer) {
            layer.style.backgroundImage = `url(${img.src})`;
            layer.style.opacity = '1';
            
            console.log(`已加载 ${imageInfo.name} (${imageInfo.size})`);
            
            // 如果是第一张图片，设置为主背景
            if (layerIndex === 0) {
                this.setMainBackground(layer);
            }
            
            // 延迟一下再加载下一张，创造渐进效果
            setTimeout(() => {
                this.isLoading = false;
                this.loadNext();
            }, 200);
        }
    }
    
    setMainBackground(layer) {
        // 可以在这里添加一些特殊效果，比如淡入动画
        layer.style.animation = 'fadeIn 1s ease-in-out';
    }
    
    // 预加载所有图片（用于重新加载）
    preloadAll() {
        this.currentIndex = -1;
        this.loadedImages = [];
        
        // 隐藏所有图层
        const layers = this.backgroundContainer.querySelectorAll('.background-layer');
        layers.forEach(layer => {
            layer.style.opacity = '0';
            layer.style.filter = `blur(${this.blurAmount}px)`;
        });
        
        this.loadNext();
    }
    
    // 获取加载进度
    getProgress() {
        return {
            current: this.currentIndex + 1,
            total: this.images.length,
            percentage: Math.round(((this.currentIndex + 1) / this.images.length) * 100)
        };
    }
    
    // 销毁实例
    destroy() {
        if (this.backgroundContainer) {
            this.backgroundContainer.remove();
        }
    }
}

// 添加CSS动画
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: scale(1.1);
        }
        to {
            opacity: 1;
            transform: scale(1);
        }
    }
    
    .background-layer.loaded {
        animation: fadeIn 0.8s ease-in-out;
    }
`;
document.head.appendChild(style);

// 全局初始化函数
window.initBackgroundLoader = function(options = {}) {
    // 防止重复初始化
    if (window.backgroundLoader) {
        window.backgroundLoader.destroy();
    }
    
    window.backgroundLoader = new BackgroundLoader(options);
    return window.backgroundLoader;
};

// 获取加载进度
window.getBackgroundLoadProgress = function() {
    return window.backgroundLoader ? window.backgroundLoader.getProgress() : null;
};
