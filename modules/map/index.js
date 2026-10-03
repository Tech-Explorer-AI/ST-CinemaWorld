// ============================================================
// CinemaWorld - map 目录聚合加载器
// 依赖：主入口 index.js 已挂好 window.CWLoader
// CWLoader.BASE 指向 modules/，本文件只需给出相对 modules/ 的路径
// ============================================================

(function () {
    'use strict';

    if (window.CinemaWorldMapLoader) return;   // 防重复

    if (!window.CWLoader) {
        console.error('[CinemaWorld/map] CWLoader 未加载，无法加载 map 模块');
        window.CinemaWorldMapLoader = Promise.resolve();
        return;
    }

    // ★ 严格按依赖顺序排列（路径相对 modules/）
    const MODULES = [
        'map/map-parser.js',
        'map/map-schema.js',
        'map/map-tiles.js',
        'map/map-gen.js',
        'map/map-entities.js',
        'map/map-buildings.js',
        'map/map-sprites.js',
        'map/map-interact.js',
        'map/map-portrait.js',
        'map/map-manager.js',
        'map/map-pickup.js',
        'map/map-decor.js',
        'map/map-environment.js',
        'map/map-npc-wander.js',
        'map/map-encounter-chase.js',
        'map/map-plot.js',              
        'map/map-farm.js',
        'map/map-farm-gen.js',
        'map/map-quest.js',
        'map/main-quest.js',
        'map/map-canvas.js',
        'map/3d/index.js',
    ];

    // 用 'map/' 前缀 + 完整相对路径做去重 key
    window.CinemaWorldMapLoader = window.CWLoader.loadAll(MODULES);
})();