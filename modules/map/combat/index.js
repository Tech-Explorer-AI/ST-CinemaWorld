// ============================================================
// CinemaWorld · combat/index.js
// 即时战斗 · 聚合加载器
// ============================================================

(function () {
    'use strict';

    if (window.CinemaWorldCombatLoader) return;

    if (!window.CWLoader) {
        console.error('[CinemaWorld/combat] CWLoader 未加载');
        window.CinemaWorldCombatLoader = Promise.resolve();
        return;
    }

    const MODULES = [
        'map/combat/combat-weapon.js',
        'map/combat/combat-state.js',
        'map/combat/combat-resolver.js',
        'map/combat/combat-render.js',
        'map/combat/combat-render-3d.js',
        'map/combat/combat-gen.js',
        'map/combat/combat-ai.js',
        'map/combat/combat-ui.js',
        'map/combat/combat-init.js',
    ];

    window.CinemaWorldCombatLoader = window.CWLoader.loadAll(MODULES);
})();