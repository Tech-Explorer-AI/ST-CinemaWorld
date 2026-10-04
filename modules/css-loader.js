// css-loader.js
(function () {
    'use strict';

    // 从 CWLoader.BASE 反推插件根目录
    // CWLoader.BASE = "<插件根>/modules/"
    // 所以插件根 = BASE 去掉末尾的 "modules/"
    function resolvePluginRoot() {
        if (window.CWLoader && typeof window.CWLoader.BASE === 'string') {
            return window.CWLoader.BASE.replace(/modules\/$/, '');
        }
        // 兜底：如果 CWLoader 还没挂上（理论上不会，css-loader 是第一个加载的）
        // 用当前脚本自己的 src 反推
        const cur = document.currentScript;
        if (cur && cur.src) {
            return cur.src.replace(/modules\/css-loader\.js.*$/, '');
        }
        // 最后兜底：用你实际的目录名
        return 'scripts/extensions/third-party/ST-CinemaWorld-main/';
    }

    const CinemaWorldCSS = {
        _loaded: false,
        _loading: null,

        get PATH() {
            return resolvePluginRoot() + 'style.css';
        },

        ensure() {
            if (this._loaded) return Promise.resolve();
            if (this._loading) return this._loading;

            const href = this.PATH;

            this._loading = new Promise((resolve) => {
                const exist = document.querySelector('link[data-cw-css="1"]');
                if (exist) {
                    this._loaded = true;
                    resolve();
                    return;
                }

                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = href;
                link.dataset.cwCss = '1';
                link.onload = () => {
                    this._loaded = true;
                    console.log('[CinemaWorld] style.css 已加载:', href);
                    resolve();
                };
                link.onerror = () => {
                    console.error('[CinemaWorld] style.css 加载失败:', href);
                    resolve();
                };
                document.head.appendChild(link);
            });

            return this._loading;
        }
    };

    window.CinemaWorldCSS = CinemaWorldCSS;
})();