// ============================================================
// CinemaWorld · companion 子模块聚合加载器
// 依赖：主入口 index.js 已挂好 window.CWLoader
// ============================================================

(function () {
    'use strict';

    if (window.CinemaWorldCompanionLoader) return;

    if (!window.CWLoader) {
        console.error('[CinemaWorld/companion] CWLoader 未加载');
        window.CinemaWorldCompanionLoader = Promise.resolve();
        return;
    }

    const MODULES = [
        'companion/companion-core.js',
        'companion/companion-ai.js',
        'companion/companion-ui.js',
        'companion/companion-invite.js',
        'companion/companion-summon.js', 
    ];

    window.CinemaWorldCompanionLoader = window.CWLoader.loadAll(MODULES);
})();