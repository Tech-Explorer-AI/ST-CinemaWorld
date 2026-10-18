// ============================================================
// CinemaWorld · indoor/map-walls.js
// 室内墙壁（2D 侧）：
//   区域矩形外扩一圈的 void 格 → terrain='wall'
//
// 3D 高度由 map-3d-ground-program.js 的 buildGround 处理
// （它识别 terrain.endsWith('_wall') 并直接加高）
//
// 通过劫持 MapLayout.build 实现，不改动 map-canvas.js
//
// 暴露：window.MapWalls
// ============================================================

(function () {
    'use strict';

    if (window.MapWalls) return;

    // ============================================================
    // 配置
    // ============================================================
    const CONFIG = {
        // 只对室内地图加墙
        onlyIndoor: true,

        // 区域外扩圈数
        //   1 = 贴一圈（区域之间需要留空才有效果）
        //   2+ = 多圈
        wallRange: 1,

        verbose: true,
    };

    // ============================================================
    // 主体
    // ============================================================
    const MapWalls = {
        CONFIG,
        _installed: false,

        // ============================================================
        // 安装
        // ============================================================
        install() {
            if (this._installed) return;

            let tries = 0;
            const wait = setInterval(() => {
                if (window.MapLayout) {
                    clearInterval(wait);
                    this._hookMapLayout();
                    this._installed = true;
                    console.log('[MapWalls] 已安装');
                } else if (++tries > 100) {
                    clearInterval(wait);
                    console.warn('[MapWalls] 等待 MapLayout 超时');
                }
            }, 50);
        },

        // ============================================================
        // 劫持 MapLayout.build
        // ============================================================
        _hookMapLayout() {
            const ML = window.MapLayout;
            const originalBuild = ML.build.bind(ML);

            ML.build = async function (map) {
                const result = await originalBuild(map);

                if (map && map._generated?.grid && map._generated?.placements) {
                    try {
                        MapWalls._carveWalls(
                            map,
                            map._generated.grid,
                            map._generated.placements
                        );
                    } catch (e) {
                        console.error('[MapWalls] _carveWalls 失败:', e);
                    }
                }

                return result;
            };

            console.log('[MapWalls] MapLayout.build 已劫持');
        },

        // ============================================================
        // 加墙
        // ============================================================
        _carveWalls(map, grid, placements) {
            if (!map) return;

            // 只对室内地图
            const isIndoor = map.mapType === 'indoor'
                || map._source === 'program'
                || map._source === 'indoor'
                || map.tags?.includes('indoor');
            if (CONFIG.onlyIndoor && !isIndoor) return;

            const H = grid.length;
            const W = grid[0].length;
            const rects = Object.values(placements || {});
            if (rects.length === 0) return;

            const R = CONFIG.wallRange;
            let placed = 0;
            let skipped = 0;

            for (const rect of rects) {
                // 外扩 R 圈
                for (let gy = rect.y - R; gy <= rect.y + rect.h + R - 1; gy++) {
                    for (let gx = rect.x - R; gx <= rect.x + rect.w + R - 1; gx++) {

                        // 跳过内圈（区域本身）
                        const isInner = gx >= rect.x && gx < rect.x + rect.w
                                     && gy >= rect.y && gy < rect.y + rect.h;
                        if (isInner) continue;

                        if (gx < 0 || gx >= W || gy < 0 || gy >= H) continue;

                        const cell = grid[gy][gx];
                        if (!cell) continue;

                        // 只处理 void
                        if (cell.terrain !== 'void') {
                            skipped++;
                            continue;
                        }

                        cell.terrain = 'wall';
                        cell.walkable = false;
                        cell.emoji = '🧱';
                        placed++;
                    }
                }
            }

            if (CONFIG.verbose) {
                console.log(
                    `[MapWalls] ${map.name}: 加墙 ${placed} 格，跳过 ${skipped} 格`
                );
            }
        },

        // ============================================================
        // 工具：强制重建当前地图
        // ============================================================
        rebuildCurrentMap() {
            const map = window.MapLauncher?.getMap?.();
            if (!map) {
                console.warn('[MapWalls] 没有当前地图');
                return;
            }
            map._generated = null;
            // ★ 新增：重置家具生成标记
            window.IndoorObjects?.resetGeneration?.(map);
            if (window.MapCanvas?.canvas) window.MapCanvas.destroy();
            window.MapLauncher._renderMapWindow();
            console.log('[MapWalls] 已强制重建当前地图');
        },
    };

    // ============================================================
    // 挂载 + 自动安装
    // ============================================================
    window.MapWalls = MapWalls;

    function boot() {
        MapWalls.install();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld] indoor/map-walls.js 已加载');
})();