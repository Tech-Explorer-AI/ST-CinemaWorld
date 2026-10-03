// ============================================================
// CinemaWorld - 公共脚本加载器
// 供主入口与各子目录 index.js 复用
// ============================================================

(function () {
    'use strict';

    if (window.CWLoader) return;   // 防重复

    // 用当前脚本的 src 反推自己所在目录
    function selfDir() {
        const cur = document.currentScript;
        if (cur && cur.src) return cur.src.replace(/[^/]*$/, '');

        // 兜底：遍历所有 script 找 loader.js
        for (const s of document.querySelectorAll('script[src]')) {
            if (/modules\/loader\.js/.test(s.src)) return s.src.replace(/[^/]*$/, '');
        }
        return 'scripts/extensions/third-party/ST-CinemaWorld-main/modules/';
    }

    const BASE = selfDir();

    /**
     * 加载单个脚本
     * @param {string} filename 相对 BASE 的路径，可含子目录，如 'map/map-gen.js'
     * @param {string} keyPrefix data-cw-module 去重前缀，默认空
     * @returns {Promise<void>}
     */
    function load(filename, keyPrefix = '') {
        return new Promise((resolve) => {
            const key = keyPrefix + filename;
            if (document.querySelector(`script[data-cw-module="${key}"]`)) {
                resolve();
                return;
            }

            const s = document.createElement('script');
            s.src = BASE + filename;
            s.dataset.cwModule = key;
            s.onload = () => {
                console.log(`[CinemaWorld] 模块已加载: ${key}`);
                resolve();
            };
            s.onerror = () => {
                console.error(`[CinemaWorld] 模块加载失败: ${key}`);
                resolve();  // 不阻塞
            };
            document.head.appendChild(s);
        });
    }

    /**
     * 按顺序加载一组脚本
     * @param {string[]} list 文件名数组
     * @param {string} keyPrefix 去重前缀
     * @returns {Promise<void>}
     */
    async function loadAll(list, keyPrefix = '') {
        for (const f of list) {
            await load(f, keyPrefix);
        }
    }

    window.CWLoader = { BASE, load, loadAll };
})();