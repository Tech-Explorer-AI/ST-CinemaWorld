// ============================================================
// CinemaWorld · world-exits.js
// 出入口：位置生成 + 双向保底 + 落点 + 校验
// 依赖：WorldDirection + WorldGraph
// 暴露：window.WorldExits
// ============================================================

(function () {
    'use strict';

    if (window.WorldExits) return;

    const DIR = () => window.WorldDirection;
    const GRAPH = () => window.WorldGraph;

    const WorldExits = {
        // ============================================================
        // 生成一个"保底出入口"（东来西必有）
        //   map        当前地图
        //   fromDir    "玩家从哪个方向来的"
        //              例：玩家从小镇东门进入森林 → 森林的入口方向是 west
        //   fromMap    来的地图名
        // ============================================================
        // world-exits.js 的 ensureEntryExit
        // ============================================================
        // 保底出入口（东来西必有）
        //   - 保证入口方向存在
        //   - 保证镜像方向（反方向）存在
        //     如果地图只有一个出入口，玩家就没法继续探索
        // ============================================================
        ensureEntryExit(map, fromDir, fromMap) {
            if (!map) return null;
            const d = DIR().normalize(fromDir);
            if (!d) return null;

            map.exits = map.exits || {};

            // ---------- 1. 入口方向 ----------
            if (map.exits[d]) {
                map.exits[d].target = map.exits[d].target || fromMap;
                map.exits[d].isEntry = true;
            } else {
                map.exits[d] = {
                    kind: '道路',
                    label: `${DIR().cn(d)}门`,
                    target: fromMap,
                    isEntry: true,
                };
                console.log(`[WorldExits] ${map.name} 保底添加入口：${d} → ${fromMap}`);
            }

            // ---------- 2. ★ 镜像方向（反方向）----------
            const mirrorDir = DIR().opposite(d);

            if (!map.exits[mirrorDir]) {
                map.exits[mirrorDir] = {
                    kind: '道路',
                    label: `${DIR().cn(mirrorDir)}门`,
                    target: null,               // 未知，玩家探索时生成
                    isMirror: true,             // 标记：镜像保底
                };
                console.log(`[WorldExits] ${map.name} 保底添加镜像出口：${mirrorDir} → 未知`);
            }

            return map.exits[d];
        },

        // ============================================================
        // 生成一个"主动出口"（AI 想加的门）
        //   会检查：这个方向是否已经被占
        // ============================================================
        createExit(map, dir, target = null, meta = {}) {
            if (!map) return { ok: false };
            const d = DIR().normalize(dir);
            if (!d) return { ok: false, reason: 'bad-direction' };

            map.exits = map.exits || {};

            if (map.exits[d] && map.exits[d].target) {
                return {
                    ok: false,
                    reason: 'occupied',
                    existing: map.exits[d].target,
                };
            }

            map.exits[d] = {
                kind: meta.kind || 'road',
                label: meta.label || `${DIR().cn(d)}门`,
                target,
            };
            return { ok: true, exit: map.exits[d] };
        },

        // ============================================================
        // 一致性校验：每个出入口必须有反向
        //   情况 1: A.east.target = 'B' 且 B.west.target = 'A'  ✓
        //   情况 2: A.east.target = 'B' 但 B.west 不存在         ✗ 需补
        //   情况 3: A.east.target = null（未探索）                ✓ 允许
        // ============================================================
        validateMutual(map, allMaps) {
            if (!map?.exits) return { ok: true, fixed: [] };

            const fixed = [];
            const mapName = map.name;

            for (const [dir, info] of Object.entries(map.exits)) {
                if (!info.target) continue;   // 未探索，跳过

                const targetName = info.target;
                const targetMap = allMaps?.[targetName];
                if (!targetMap) {
                    // 目标地图不存在 → 清掉 target，变成"未探索"
                    info.target = null;
                    fixed.push(`清理死链: ${mapName}.${dir} → ${targetName}（目标不存在）`);
                    continue;
                }

                // 反向方向
                const backDir = DIR().opposite(dir);
                const backExit = targetMap.exits?.[backDir];

                if (!backExit) {
                    // 目标地图没有反向 → 补
                    targetMap.exits = targetMap.exits || {};
                    targetMap.exits[backDir] = {
                        kind: info.kind || 'road',
                        label: `${DIR().cn(backDir)}门`,
                        target: mapName,
                    };
                    fixed.push(`补反向: ${targetName}.${backDir} → ${mapName}`);
                } else if (backExit.target !== mapName) {
                    // 反向指向了别人 → 报告冲突（不自动改，避免连锁错误）
                    console.warn(
                        `[WorldExits] 冲突: ${targetName}.${backDir} 指向【${backExit.target}】，` +
                        `但 ${mapName}.${dir} 指向【${targetName}】`
                    );
                }
            }

            return { ok: true, fixed };
        },

        // ============================================================
        // 把出入口"落"到地图网格上
        //   根据方向找边缘最近的可走格，放一个 portal 实体
        //   ★ 两轮放置：先按方向，找不到的放宽到任意可走格
        // ============================================================
        placeExitsOnGrid(map) {
            if (!map?._generated?.grid) return;
            if (!map.exits) return;

            const grid = map._generated.grid;
            const H = grid.length;
            const W = grid[0].length;

            // ★ 清理所有系统生成的出入口（用多种标识，避免存档丢字段）
            map.entities = (map.entities || []).filter(e => {
                if (e.kind !== 'portal') return true;
                if (e._systemExit === true) return false;
                if (e.meta?.worldExit === true) return false;
                if (e.tags?.includes('世界出入口')) return false;
                return true;   // AI 自己放的 portal，保留
            });

            // ★ 已分配的格子（避免两个 portal 抢同一格）
            const usedCells = new Set();

            // ★ 两轮：第一轮严格按方向，第二轮放宽
            const pending = [];

            for (const [dir, info] of Object.entries(map.exits)) {
                const pos = this._findEdgeCell(map, dir, usedCells);
                if (!pos) {
                    pending.push({ dir, info });
                    console.warn(`[WorldExits] ${map.name} 的 ${dir} 方向暂时找不到边缘格，延后处理`);
                    continue;
                }
                usedCells.add(`${pos.x},${pos.y}`);
                this._placeOneExit(map, dir, info, pos);
            }

            // ★ 第二轮：放宽限制，允许放到任意可走格
            for (const { dir, info } of pending) {
                const pos = this._findAnyCell(map, usedCells);
                if (!pos) {
                    console.error(`[WorldExits] ${map.name} 的 ${dir} 方向彻底找不到位置，放弃`);
                    continue;
                }
                usedCells.add(`${pos.x},${pos.y}`);
                console.warn(`[WorldExits] ${map.name} 的 ${dir} 方向放宽到 (${pos.x},${pos.y})`);
                this._placeOneExit(map, dir, info, pos);
            }

            console.log(`[WorldExits] ${map.name} 落地了 ${Object.keys(map.exits).length} 个出入口`);
        },

        // ---------- ★ 抽出来：放一个出口 ----------
        _placeOneExit(map, dir, info, pos) {
            const grid = map._generated.grid;
            const ent = this._buildPortalEntity(map, dir, info, pos);
            map.entities.push(ent);

            const cell = grid[pos.y]?.[pos.x];
            if (cell) {
                cell.walkable = true;
                cell.portal = {
                    kind: 'world_exit',
                    direction: dir,
                    exitId: ent.id,
                    mapName: info.target || null,
                    label: info.label || `${DIR().cn(dir)}门`,
                };
            }
        },

        // ---------- 找边缘格（★ 加 usedCells 参数）----------
        _findEdgeCell(map, dir, usedCells) {
            const grid = map._generated.grid;
            const H = grid.length;
            const W = grid[0].length;

            // 收集所有被实体占用的格
            const occupied = new Set(usedCells || []);
            for (const e of (map.entities || [])) {
                if (!e._placed) continue;
                if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
                if (e.kind === 'portal' && e._systemExit) continue;
                occupied.add(`${e.x},${e.y}`);
            }

            const rel = DIR().edgePos(dir);
            const targetX = Math.floor(rel.x * (W - 1));
            const targetY = Math.floor(rel.y * (H - 1));

            // ★ 第一轮：20 格内找
            let pos = this._spiralSearch(grid, targetX, targetY, W, H, 20, occupied);
            if (pos) return pos;

            // ★ 兜底：扩大到 40 格
            pos = this._spiralSearch(grid, targetX, targetY, W, H, 40, occupied);
            if (pos) {
                console.warn(`[WorldExits] ${dir} 方向扩到 40 格才找到`);
                return pos;
            }

            return null;
        },

        _spiralSearch(grid, cx, cy, W, H, maxR, occupied) {
            for (let r = 0; r <= maxR; r++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const x = cx + dx;
                        const y = cy + dy;
                        if (x < 0 || x >= W || y < 0 || y >= H) continue;

                        if (occupied && occupied.has(`${x},${y}`)) continue;

                        const cell = grid[y][x];
                        if (!cell) continue;
                        if (cell.terrain === 'void') continue;
                        if (!cell.walkable && cell.terrain === 'wall') continue;
                        if (cell.decor && cell.decor.type === 'tree') continue;
                        if (cell.portal) continue;
                        if (cell.decor?.buildingId) continue;

                        return { x, y };
                    }
                }
            }
            return null;
        },

        // ---------- ★ 新增：任意可走格（第二轮兜底）----------
        _findAnyCell(map, usedCells) {
            const grid = map._generated.grid;
            const H = grid.length;
            const W = grid[0].length;

            // 先试从中心向外螺旋
            const cx = Math.floor(W / 2);
            const cy = Math.floor(H / 2);
            let pos = this._spiralSearch(grid, cx, cy, W, H, Math.max(W, H), usedCells);
            if (pos) return pos;

            // 再全局扫描
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    if (usedCells && usedCells.has(`${x},${y}`)) continue;
                    const cell = grid[y][x];
                    if (!cell) continue;
                    if (cell.terrain === 'void') continue;
                    if (!cell.walkable) continue;
                    if (cell.decor && cell.decor.type !== 'plant') continue;
                    if (cell.decor?.buildingId) continue;
                    if (cell.portal) continue;
                    return { x, y };
                }
            }
            return null;
        },

        // ---------- 构造 portal 实体（保持不变）----------
        _buildPortalEntity(map, dir, info, pos) {
            const cn = DIR().cn(dir);
            return {
                id: `exit_${map.name}_${dir}_${Date.now().toString(36)}`,
                name: info.label || `${cn}门`,
                emoji: '🚪',
                kind: 'portal',
                region: null,
                position: 'center',
                blocking: false,
                isPlayer: false,
                tags: [
                    '世界出入口',
                    `方向:${dir}`,
                    // ★ 顺手把 target 塞进 tags，作为存档兜底
                    info.target ? `目标:${info.target}` : `未知:${dir}`,
                ],
                description: info.target
                    ? `通向【${info.target}】`
                    : `通往未知的${cn}方`,
                meta: {
                    worldExit: true,
                    direction: dir,
                },
                _systemExit: true,
                status: '',
                effect: '',
                fields: {
                    '目标类型': 'map',
                    '目标': info.target || null,
                    '目标区域': null,
                    '目标锚点': 'center',
                    '方向': dir,
                    '提示': info.target
                        ? `前往【${info.target}】`
                        : `走向未知的${cn}方`,
                },
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1,
                countMode: 'single',
                stackable: false,
                maxStack: null,
                type: 'portal',

                x: pos.x,
                y: pos.y,
                _placed: true,
                _systemExit: true,
            };
        },

        // ---------- 构造 portal 实体 ----------
        _buildPortalEntity(map, dir, info, pos) {
            const cn = DIR().cn(dir);
            return {
                id: `exit_${map.name}_${dir}_${Date.now().toString(36)}`,
                name: info.label || `${cn}门`,
                emoji: '🚪',
                kind: 'portal',
                region: null,
                position: 'center',
                blocking: false,
                isPlayer: false,
                tags: ['世界出入口', `方向:${dir}`],
                description: info.target
                    ? `通向【${info.target}】`
                    : `通往未知的${cn}方`,
                meta: {
                    worldExit: true,
                    direction: dir,
                },
                _systemExit: true,
                status: '',
                effect: '',
                fields: {
                    '目标类型': 'map',
                    '目标': info.target || null,
                    '目标区域': null,
                    '目标锚点': 'center',
                    '方向': dir,
                    '提示': info.target
                        ? `前往【${info.target}】`
                        : `走向未知的${cn}方`,
                },
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1,
                countMode: 'single',
                stackable: false,
                maxStack: null,
                type: 'portal',

                // 坐标 + 标记
                x: pos.x,
                y: pos.y,
                _placed: true,
                _systemExit: true,
            };
        },

        // ============================================================
        // 玩家从 A 的 dir 方向出去 → 应落在 B 的哪个方向
        // ============================================================
        entryDirection(exitDir) {
            return DIR().opposite(exitDir);
        },

        // 找到目标地图对应方向的落点
        getEntryPoint(targetMap, entryDir) {
            if (!targetMap?._generated?.placements) return null;

            const d = DIR().normalize(entryDir);
            if (!d) return null;

            // 优先找该方向的实际出入口
            const exit = targetMap.exits?.[d];
            if (exit) {
                const portal = (targetMap.entities || []).find(e =>
                    e.kind === 'portal' &&
                    e._systemExit &&
                    e.meta?.direction === d
                );
                if (portal && typeof portal.x === 'number') {
                    return { x: portal.x, y: portal.y };
                }
            }

            // 兜底：找地图边缘的任意可走格
            const grid = targetMap._generated.grid;
            const H = grid.length;
            const W = grid[0].length;
            const rel = DIR().edgePos(d);
            const tx = Math.floor(rel.x * (W - 1));
            const ty = Math.floor(rel.y * (H - 1));

            const pos = this._spiralSearch(grid, tx, ty, W, H, 25);
            return pos || { x: Math.floor(W / 2), y: Math.floor(H / 2) };
        },

        // ============================================================
        // 清理：从 map 里移除某个方向的出入口
        // ============================================================
        removeExit(map, dir) {
            if (!map?.exits) return;
            const d = DIR().normalize(dir);
            if (!d) return;

            delete map.exits[d];

            // 移除对应的 portal 实体
            map.entities = (map.entities || []).filter(e => {
                if (e.kind !== 'portal') return true;
                if (!e._systemExit) return true;
                if (e.meta?.direction === d) return false;
                return true;
            });
        },
    };

    window.WorldExits = WorldExits;
    console.log('[CinemaWorld] world-exits.js 已加载');
})();