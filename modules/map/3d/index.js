// ============================================================
// CinemaWorld · map/3d 子模块聚合加载器
// 依赖：主入口 index.js 已挂好 window.CWLoader
// ============================================================

(function () {
    'use strict';

    if (window.CinemaWorldMap3DLoader) return;

    if (!window.CWLoader) {
        console.error('[CinemaWorld/map/3d] CWLoader 未加载');
        window.CinemaWorldMap3DLoader = Promise.resolve();
        return;
    }

    const MODULES = [
        'map/3d/three-loader.js',
        'map/3d/map-3d-textures.js', 
        'map/3d/map-3d-assets.js',
        'map/3d/map-3d-camera.js',
        'map/3d/map-3d-canvas.js',
        'map/3d/map-3d-sky.js',
        'map/3d/map-3d-interact.js',
        'map/3d/map-3d-ui.js',
    ];

    window.CinemaWorldMap3DLoader = window.CWLoader.loadAll(MODULES);
})();