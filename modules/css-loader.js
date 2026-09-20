// css-loader.js
(function () {
    'use strict';

    const CinemaWorldCSS = {
        _loaded: false,
        _loading: null,
        PATH: 'scripts/extensions/third-party/CinemaWorld/style.css',

        ensure() {
            if (this._loaded) return Promise.resolve();
            if (this._loading) return this._loading;

            this._loading = new Promise((resolve) => {
                const exist = document.querySelector('link[data-cw-css="1"]');
                if (exist) {
                    this._loaded = true;
                    resolve();
                    return;
                }

                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = this.PATH;
                link.dataset.cwCss = '1';
                link.onload = () => {
                    this._loaded = true;
                    console.log('[CinemaWorld] style.css 已加载');
                    resolve();
                };
                link.onerror = () => {
                    console.error('[CinemaWorld] style.css 加载失败:', this.PATH);
                    resolve();
                };
                document.head.appendChild(link);
            });

            return this._loading;
        }
    };

    window.CinemaWorldCSS = CinemaWorldCSS;
})();