// ============================================================
// CinemaWorld · three-loader.js
// 按需加载 Three.js：优先本地，本地失败 → CDN 兜底
// 暴露：window.CWThree
// ============================================================

(function () {
    'use strict';

    if (window.CWThree) return;

    // ---------- 路径推导 ----------
    const BASE_PATH = (() => {
        const cur = document.currentScript;
        if (cur && cur.src) {
            return cur.src.replace(/modules\/map\/3d\/three-loader\.js.*$/, '');
        }
        // 兜底
        for (const s of document.querySelectorAll('script[src]')) {
            if (/three-loader\.js/.test(s.src)) {
                return s.src.replace(/modules\/map\/3d\/three-loader\.js.*$/, '');
            }
        }
        return 'scripts/extensions/third-party/ST-CinemaWorld-main/';
    })();

    // ---------- 加载源列表 ----------
    // ★ 优先本地，失败后依次尝试 CDN
    const SOURCES = [
        {
            label: '本地',
            url: BASE_PATH + 'libs/three.min.js',
        },
        {
            label: 'jsdelivr',
            url: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js',
        },
        {
            label: 'unpkg',
            url: 'https://unpkg.com/three@0.160.0/build/three.min.js',
        },
        {
            label: 'cdnjs',
            url: 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r160/three.min.js',
        },
    ];

    const CWThree = {
        _loadPromise: null,
        _loadedFrom: null,

        isLoaded() {
            return typeof window.THREE !== 'undefined';
        },

        // 返回 Promise<THREE>
        load() {
            if (this.isLoaded()) return Promise.resolve(window.THREE);
            if (this._loadPromise) return this._loadPromise;

            this._loadPromise = new Promise((resolve, reject) => {
                let idx = 0;

                const tryNext = () => {
                    if (idx >= SOURCES.length) {
                        reject(new Error('Three.js 所有源均加载失败'));
                        return;
                    }

                    const src = SOURCES[idx++];
                    console.log(`[CWThree] 尝试加载: ${src.label} → ${src.url}`);

                    const s = document.createElement('script');
                    s.src = src.url;
                    s.async = true;

                    // 本地加载 5 秒超时（避免文件不存在时卡住）
                    // CDN 加载 15 秒超时
                    const timeout = src.label === '本地' ? 5000 : 15000;
                    const timer = setTimeout(() => {
                        console.warn(`[CWThree] ${src.label} 加载超时`);
                        s.remove();
                        tryNext();
                    }, timeout);

                    s.onload = () => {
                        clearTimeout(timer);
                        if (this.isLoaded()) {
                            this._loadedFrom = src.label;
                            console.log(`[CWThree] ✅ Three.js 已加载 (来源: ${src.label})`);
                            resolve(window.THREE);
                        } else {
                            console.warn(`[CWThree] ${src.label} 加载了但 THREE 未定义`);
                            s.remove();
                            tryNext();
                        }
                    };

                    s.onerror = () => {
                        clearTimeout(timer);
                        console.warn(`[CWThree] ${src.label} 加载失败`);
                        s.remove();
                        tryNext();
                    };

                    document.head.appendChild(s);
                };

                tryNext();
            });

            return this._loadPromise;
        },

        // ★ 获取当前加载来源（调试用）
        getLoadedFrom() {
            return this._loadedFrom;
        },
    };

    window.CWThree = CWThree;
    console.log('[CinemaWorld] three-loader.js 已加载');
})();