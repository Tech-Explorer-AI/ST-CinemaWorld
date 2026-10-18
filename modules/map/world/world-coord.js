// ============================================================
// CinemaWorld · world-coord.js
// 世界坐标系：从 WorldGraph 推导每张地图的 (x, y, z) 坐标
//   - 惰性计算，连接变化时局部/全量重算
//   - 允许坐标重叠（AI 折叠地图时不会崩）
//   - 为未来开放世界预留 findByCoord / findNeighbors 接口
// 依赖：WorldGraph, WorldDirection
// 暴露：window.WorldCoord
// ============================================================

(function () {
    'use strict';

    if (window.WorldCoord) return;

    const GRAPH = () => window.WorldGraph;
    const DIR = () => window.WorldDirection;

    // ============================================================
    // 配置
    // ============================================================
    const CONFIG = {
        // 坐标轴原点
        ORIGIN: { x: 0, y: 0, z: 0 },

        // 是否允许坐标重叠
        allowOverlap: true,

        // 自动重算触发（连接变化时）
        autoRecompute: true,

        // 是否在控制台打印详细日志
        verbose: false,
    };

    // ============================================================
    // 主体
    // ============================================================
    const WorldCoord = {
        CONFIG,

        // ============================================================
        // 存储：worldState.worldCoords = { [mapName]: { x, y, z } }
        // ============================================================
        _store() {
            const ws = window.CinemaWorld?.worldState;
            if (!ws) return null;
            ws.worldCoords = ws.worldCoords || {};
            return ws.worldCoords;
        },

        // ============================================================
        // 查询接口
        // ============================================================

        // 取单张地图坐标
        get(mapName) {
            const store = this._store();
            if (!store) return null;
            const c = store[mapName];
            if (!c) return null;
            return { x: c.x || 0, y: c.y || 0, z: c.z || 0 };
        },

        // 取所有坐标（可用于 UI 遍历）
        getAll() {
            const store = this._store();
            return store ? { ...store } : {};
        },

        // 坐标 → 地图名列表（可能多个，允许重叠）
        findByCoord(coord) {
            const store = this._store();
            if (!store) return [];
            const key = this._coordKey(coord);
            const out = [];
            for (const [name, c] of Object.entries(store)) {
                if (this._coordKey(c) === key) out.push(name);
            }
            return out;
        },

        // 坐标 → 单个地图名（取第一个，忽略重叠）
        findByCoordOne(coord) {
            const list = this.findByCoord(coord);
            return list[0] || null;
        },

        // 两个地图之间的"方位差"
        //   返回 { dx, dy, dz } 或 null
        deltaBetween(fromName, toName) {
            const a = this.get(fromName);
            const b = this.get(toName);
            if (!a || !b) return null;
            return {
                dx: b.x - a.x,
                dy: b.y - a.y,
                dz: b.z - a.z,
            };
        },

        // 两张地图是否在同一坐标（重叠）
        isOverlapping(nameA, nameB) {
            const a = this.get(nameA);
            const b = this.get(nameB);
            if (!a || !b) return false;
            return a.x === b.x && a.y === b.y && a.z === b.z;
        },

        // ============================================================
        // 坐标边界（用于 UI 网格）
        // ============================================================
        bounds() {
            const store = this._store();
            if (!store) return null;

            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            let count = 0;

            for (const c of Object.values(store)) {
                if (!c) continue;
                const x = c.x || 0;
                const y = c.y || 0;
                const z = c.z || 0;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (z < minZ) minZ = z;
                if (z > maxZ) maxZ = z;
                count++;
            }

            if (count === 0) return null;
            return {
                minX, maxX, minY, maxY, minZ, maxZ,
                width: maxX - minX + 1,
                height: maxY - minY + 1,
                depth: maxZ - minZ + 1,
                count,
            };
        },

        // ============================================================
        // 坐标计算
        // ============================================================

        // 全量重算（BFS）
        //   anchorName: 可选，指定锚点（默认出生图）
        recomputeAll(anchorName) {
            const graph = GRAPH();
            const store = this._store();
            if (!graph || !store) return { ok: false };

            const allNodes = graph.list();
            if (allNodes.length === 0) {
                console.log('[WorldCoord] 没有地图，跳过');
                return { ok: true, count: 0 };
            }

            // ---------- 1. 清空 ----------
            for (const name of Object.keys(store)) {
                delete store[name];
            }

            // ---------- 2. 选锚点 ----------
            const anchor = anchorName || this._pickAnchor(allNodes.map(n => n.name));
            const anchorNode = graph.get(anchor);
            if (!anchorNode) {
                console.warn(`[WorldCoord] 锚点不存在: ${anchor}`);
                return { ok: false };
            }

            // 锚点坐标 = 原点
            store[anchor] = { ...CONFIG.ORIGIN };
            if (CONFIG.verbose) console.log(`[WorldCoord] 锚点: ${anchor} → (0, 0, 0)`);

            // ---------- 3. BFS 推坐标 ----------
            const visited = new Set([anchor]);
            const queue = [anchor];
            let assigned = 1;

            while (queue.length > 0) {
                const cur = queue.shift();
                const curNode = graph.get(cur);
                const curCoord = store[cur];
                if (!curNode || !curCoord) continue;

                for (const [dir, info] of Object.entries(curNode.exits || {})) {
                    const next = info.target;
                    if (!next) continue;

                    const nextNode = graph.get(next);
                    if (!nextNode) continue;

                    // 室内图不参与坐标系统
                    if (!this._isCoordEnabled(next, nextNode)) continue;

                    // 已访问：校验一致性
                    if (visited.has(next)) {
                        const existing = store[next];
                        if (existing) {
                            const expected = this._stepCoord(curCoord, dir);
                            if (!this._coordEqual(existing, expected)) {
                                if (CONFIG.verbose) {
                                    console.warn(
                                        `[WorldCoord] 坐标不一致: ${next} ` +
                                        `已有 (${existing.x},${existing.y},${existing.z})，` +
                                        `但从 ${cur} 的 ${dir} 推出 ` +
                                        `(${expected.x},${expected.y},${expected.z})`
                                    );
                                }
                            }
                        }
                        continue;
                    }

                    // 计算新坐标
                    const nextCoord = this._stepCoord(curCoord, dir);

                    // ★ 允许重叠：不检查是否已被占用
                    store[next] = nextCoord;
                    visited.add(next);
                    queue.push(next);
                    assigned++;

                    if (CONFIG.verbose) {
                        console.log(
                            `[WorldCoord] ${cur} --${dir}--> ${next} ` +
                            `(${nextCoord.x}, ${nextCoord.y}, ${nextCoord.z})`
                        );
                    }
                }
            }

            // ---------- 4. 孤立图（无连接的图）----------
            for (const node of allNodes) {
                if (store[node.name]) continue;
                if (!this._isCoordEnabled(node.name, node)) continue;

                // 孤立图先给原点，但标为 _isolated
                store[node.name] = { ...CONFIG.ORIGIN, _isolated: true };
                assigned++;
                if (CONFIG.verbose) {
                    console.log(`[WorldCoord] ${node.name} 是孤立图，坐标暂设 (0,0,0)`);
                }
            }

            // ---------- 5. 统计重叠 ----------
            const overlaps = this._detectOverlaps();

            console.log(
                `[WorldCoord] 坐标重算完成: ${assigned} 张地图` +
                (overlaps.length > 0 ? `，${overlaps.length} 处重叠` : '')
            );

            return {
                ok: true,
                count: assigned,
                anchor,
                overlaps,
            };
        },

        // 单张图坐标查询（不存在则局部计算）
        ensure(mapName) {
            if (!mapName) return null;
            let c = this.get(mapName);
            if (c) return c;

            // 未计算 → 全量重算一次
            this.recomputeAll();
            return this.get(mapName);
        },

        // ============================================================
        // 内部工具
        // ============================================================

        // 从坐标 + 方向 → 新坐标
        _stepCoord(coord, dir) {
            const d = DIR().normalize(dir);
            if (!d) return { x: coord.x || 0, y: coord.y || 0, z: coord.z || 0 };

            const off = DIR().offset(d);   // { x: -1/0/1, y: -1/0/1 }
            return {
                x: (coord.x || 0) + (off.x || 0),
                y: (coord.y || 0) + (off.y || 0),
                z: coord.z || 0,
            };
        },

        // 坐标相等判断（忽略 _isolated 等内部字段）
        _coordEqual(a, b) {
            if (!a || !b) return false;
            return a.x === b.x && a.y === b.y && a.z === b.z;
        },

        // 坐标 → 字符串 key
        _coordKey(coord) {
            if (!coord) return '?';
            return `${coord.x || 0},${coord.y || 0},${coord.z || 0}`;
        },

        // 选锚点
        _pickAnchor(candidateNames) {
            const ws = window.CinemaWorld?.worldState;

            // 1. 出生图（最高优先级，永久锁定）
            const origin = ws?._originMapName;
            if (origin && candidateNames.includes(origin)) return origin;

            // 2. 玩家当前图
            const current = ws?.currentMapName;
            if (current && candidateNames.includes(current)) return current;

            // 3. 最早创建的图
            const graph = GRAPH();
            const store = graph?._store?.() || {};
            let oldest = candidateNames[0];
            let minTime = Infinity;
            for (const name of candidateNames) {
                const t = store[name]?.createdAt || 0;
                if (t < minTime) {
                    minTime = t;
                    oldest = name;
                }
            }
            return oldest;
        },

        // 是否参与坐标系统
        _isCoordEnabled(mapName, node) {
            if (!mapName) return false;

            // 建筑实例（名字带 @）
            if (mapName.includes('@')) return false;

            // 未生成的图（程序还没创建）
            const ws = window.CinemaWorld?.worldState;
            const mapData = ws?.maps?.[mapName];
            if (!mapData) {
                // 图还没生成 → 先不参与（等生成后再补）
                return false;
            }

            // 程序生成（如建筑内部）
            if (mapData._source === 'program') return false;
            if (mapData.tags?.includes('no-coord')) return false;

            // 室内图
            if (mapData.mapType === 'indoor') return false;

            return true;
        },

        // 检测重叠
        _detectOverlaps() {
            const store = this._store();
            if (!store) return [];

            const map = new Map();
            for (const [name, c] of Object.entries(store)) {
                const key = this._coordKey(c);
                if (!map.has(key)) map.set(key, []);
                map.get(key).push(name);
            }

            const out = [];
            for (const [key, names] of map) {
                if (names.length > 1) {
                    out.push({ coordKey: key, names });
                }
            }
            return out;
        },

        // ============================================================
        // 出生图锁定
        // ============================================================
        lockOrigin(mapName) {
            const ws = window.CinemaWorld?.worldState;
            if (!ws) return false;
            if (ws._originMapName) {
                if (CONFIG.verbose) {
                    console.log(`[WorldCoord] 出生图已锁定: ${ws._originMapName}`);
                }
                return false;
            }
            if (!mapName) return false;
            ws._originMapName = mapName;
            console.log(`[WorldCoord] 锁定出生图: ${mapName}`);
            return true;
        },

        // ============================================================
        // 调试 / 展示
        // ============================================================
        dump() {
            const store = this._store();
            if (!store) return;
            const lines = [];
            for (const [name, c] of Object.entries(store)) {
                lines.push(`  ${name.padEnd(20)} (${c.x}, ${c.y}, ${c.z})` +
                    (c._isolated ? ' [孤立]' : ''));
            }
            console.log(`[WorldCoord] 共 ${lines.length} 张地图:\n${lines.join('\n')}`);
        },

        // 手动清空
        clear() {
            const ws = window.CinemaWorld?.worldState;
            if (ws) ws.worldCoords = {};
            console.log('[WorldCoord] 坐标已清空');
        },

        // ============================================================
        // 未来接口（预留）
        // ============================================================

        // 找某坐标的邻居地图（东南西北）
        //   返回 { east: '地图名'|null, south: ..., ... }
        findNeighborsAt(coord) {
            const out = {};
            const dirs = ['north', 'south', 'east', 'west',
                'northeast', 'southeast', 'southwest', 'northwest'];

            for (const dir of dirs) {
                const off = DIR().offset(dir);
                const targetCoord = {
                    x: (coord.x || 0) + (off.x || 0),
                    y: (coord.y || 0) + (off.y || 0),
                    z: coord.z || 0,
                };
                const names = this.findByCoord(targetCoord);
                out[dir] = names.length > 0 ? names : null;
            }
            return out;
        },
        // world-coord.js 里加

        // ============================================================
        // 把一张地图纳入坐标系统
        //   - 如果它已有坐标 → 不动
        //   - 如果它没有坐标 → 触发一次全量重算
        //   - 如果是全新世界 → 把它设为原点
        // ============================================================
        register(mapName) {
            if (!mapName) return null;

            const store = this._store();
            if (!store) return null;

            // ★ 加：如果已存在，直接返回
            if (store[mapName]) return store[mapName];

            // ★ 加：检查是否应该参与坐标
            const ws = window.CinemaWorld?.worldState;
            const mapData = ws?.maps?.[mapName];
            if (mapData && !this._isCoordEnabled(mapName, null)) {
                console.log(`[WorldCoord] ${mapName} 不参与坐标系统，跳过注册`);
                return null;
            }

            // ---------- 全新世界：第一张图设为原点 ----------
            if (Object.keys(store).length === 0) {
                // 锁定出生图（如果还没锁）
                this.lockOrigin(mapName);

                store[mapName] = { ...CONFIG.ORIGIN };
                console.log(`[WorldCoord] 注册第一张地图: ${mapName} → (0, 0, 0)`);
                return store[mapName];
            }

            // ---------- 已有其它图：尝试从 graph 推导 ----------
            //   先看 graph 里有没有这张图的连接信息
            const graph = GRAPH();
            const node = graph?.get?.(mapName);

            if (!node || Object.keys(node.exits || {}).length === 0) {
                // 孤立图 → 也给 (0,0,0)，标记 _isolated
                store[mapName] = { ...CONFIG.ORIGIN, _isolated: true };
                console.log(`[WorldCoord] 注册孤立地图: ${mapName}（暂设原点）`);
                return store[mapName];
            }

            // 有连接 → 全量重算
            this.recomputeAll();
            return this.get(mapName);
        },
        // 找两张图之间的"最短路径方向序列"
        //   BFS 找路径，返回 [{ dir, nextMap }, ...] 或 null
        findPath(fromName, toName) {
            if (fromName === toName) return [];

            const graph = GRAPH();
            if (!graph) return null;

            const from = graph.get(fromName);
            const to = graph.get(toName);
            if (!from || !to) return null;

            const queue = [[fromName, []]];
            const visited = new Set([fromName]);

            while (queue.length > 0) {
                const [cur, path] = queue.shift();
                const node = graph.get(cur);
                if (!node) continue;

                for (const [dir, info] of Object.entries(node.exits || {})) {
                    const next = info.target;
                    if (!next || visited.has(next)) continue;

                    const newPath = [...path, { dir, nextMap: next }];
                    if (next === toName) return newPath;

                    visited.add(next);
                    queue.push([next, newPath]);
                }
            }
            return null;
        },
    };

    // ============================================================
    // 挂载
    // ============================================================
    window.WorldCoord = WorldCoord;

    // ============================================================
    // 自动安装：监听 graph 变化
    // ============================================================
    function boot() {
        // 等 WorldGraph 就绪
        let tries = 0;
        const timer = setInterval(() => {
            if (window.WorldGraph && window.WorldDirection) {
                clearInterval(timer);
                _installHooks();
            } else if (++tries > 100) {
                clearInterval(timer);
                console.warn('[WorldCoord] 等待依赖超时');
            }
        }, 100);
    }

    function _installHooks() {
        const G = window.WorldGraph;
        if (!G || G._coordHooked) return;
        G._coordHooked = true;

        // ---------- 劫持 connect ----------
        const origConnect = G.connect.bind(G);
        G.connect = function (...args) {
            const result = origConnect(...args);
            if (result.ok && WorldCoord.CONFIG.autoRecompute) {
                try {
                    WorldCoord.recomputeAll();
                } catch (e) {
                    console.error('[WorldCoord] connect 后重算失败:', e);
                }
            }
            return result;
        };

        // ---------- 劫持 disconnect ----------
        const origDisconnect = G.disconnect.bind(G);
        G.disconnect = function (...args) {
            const result = origDisconnect(...args);
            if (result.ok && WorldCoord.CONFIG.autoRecompute) {
                try {
                    WorldCoord.recomputeAll();
                } catch (e) {
                    console.error('[WorldCoord] disconnect 后重算失败:', e);
                }
            }
            return result;
        };

        // ---------- 劫持 rebuildFromMaps ----------
        const origRebuild = G.rebuildFromMaps.bind(G);
        G.rebuildFromMaps = function (...args) {
            const result = origRebuild(...args);
            if (WorldCoord.CONFIG.autoRecompute) {
                try {
                    WorldCoord.recomputeAll();
                } catch (e) {
                    console.error('[WorldCoord] rebuild 后重算失败:', e);
                }
            }
            return result;
        };

        console.log('[WorldCoord] 已挂到 WorldGraph 上');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld] world-coord.js 已加载');
})();