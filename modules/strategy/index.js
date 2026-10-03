// ============================================================
// CinemaWorld - strategy 目录聚合加载器
// 依赖：主入口 index.js 已挂好 window.CWLoader
// ============================================================

(function () {
    'use strict';

    if (window.CinemaWorldStrategyLoader) return;   // 防重复

    if (!window.CWLoader) {
        console.error('[CinemaWorld/strategy] CWLoader 未加载，无法加载 strategy 模块');
        window.CinemaWorldStrategyLoader = Promise.resolve();
        return;
    }

    // ★ 严格按依赖顺序排列（路径相对 modules/）
    const MODULES = [
        'strategy/strategy.js',
        'strategy/strategy-actions.js',
        'strategy/strategy-bills.js',
        'strategy/strategy-diplomacy.js',
        'strategy/strategy-politics-act.js',
        'strategy/strategy-military.js',
        'strategy/strategy-ui.js',
        'strategy/strategy-intent-ui.js',
        'strategy/strategy-actions-ui.js',
        'strategy/strategy-military-ui.js',
    ];

    window.CinemaWorldStrategyLoader = window.CWLoader.loadAll(MODULES);
})();