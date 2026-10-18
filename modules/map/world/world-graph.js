// ============================================================
// CinemaWorld · world-graph.js
// 世界地图网：地图之间的连接 + 坐标缓存
//   - connect(mapA, dir, mapB) 双向建立
//   - 一致性校验（防冲突）
//   - 坐标缓存（用于世界地图 UI，可选）
// 不碰地图本体，不碰 portal，只管"关系"
// 暴露：window.WorldGraph
// ============================================================

(function () {
    'use strict';

    if (window.WorldGraph) return;

    const DIR = () => window.WorldDirection;

    const WorldGraph = {
        // ============================================================
        // 存储结构（挂在 worldState 上，随存档一起走）
        // ============================================================
        // worldState.worldGraph = {
        //     '小镇': {
        //         name: '小镇',
        //         coord: { x: 0, y: 0 },       // 可选，仅 UI 用
        //         exits: {
        //             east: { target: '森林', kind: 'road', label: '东门' },
        //         },
        //     },
        // }

        _store() {
            const ws = window.CinemaWorld?.worldState;
            if (!ws) return null;
            ws.worldGraph = ws.worldGraph || {};
            return ws.worldGraph;
        },

        // ============================================================
        // 查询
        // ============================================================
        get(name) {
            const store = this._store();
            return store?.[name] || null;
        },

        has(name) {
            return !!this.get(name);
        },

        // 该地图某个方向的邻居
        getNeighbor(name, dir) {
            const node = this.get(name);
            if (!node) return null;
            const d = DIR().normalize(dir);
            if (!d) return null;
            return node.exits?.[d]?.target || null;
        },

        // 该地图所有已有邻居
        getNeighbors(name) {
            const node = this.get(name);
            if (!node) return {};
            const out = {};
            for (const [dir, info] of Object.entries(node.exits || {})) {
                out[dir] = info.target;
            }
            return out;
        },

        // 两个地图之间是否相连
        isLinked(a, b) {
            const na = this.get(a);
            if (!na) return false;
            for (const info of Object.values(na.exits || {})) {
                if (info.target === b) return true;
            }
            return false;
        },

        // ============================================================
        // 节点管理
        // ============================================================
        ensure(name, options = {}) {
            const store = this._store();
            if (!store) return null;

            if (!store[name]) {
                store[name] = {
                    name,
                    coord: options.coord || null,
                    exits: {},
                    createdAt: Date.now(),
                };
            }
            return store[name];
        },

        // ============================================================
        // 核心：双向连接
        //   connect('小镇', 'east', '森林')
        //   → 小镇.exits.east = { target: '森林' }
        //   → 森林.exits.west = { target: '小镇' }
        // ============================================================
        connect(nameA, dir, nameB, meta = {}) {
            if (!nameA || !nameB) return { ok: false, reason: 'missing-name' };
            if (nameA === nameB) return { ok: false, reason: 'self-link' };

            const dA = DIR().normalize(dir);
            if (!dA) return { ok: false, reason: 'bad-direction' };
            const dB = DIR().opposite(dA);

            const store = this._store();
            if (!store) return { ok: false, reason: 'no-world-state' };

            // ---------- 冲突检测 ----------
            const nodeA = this.ensure(nameA);
            const nodeB = this.ensure(nameB);

            const existA = nodeA.exits?.[dA];
            const existB = nodeB.exits?.[dB];

            // A 的那个方向已经通向别人
            if (existA && existA.target && existA.target !== nameB) {
                return {
                    ok: false,
                    reason: 'conflict',
                    message: `${nameA} 的${DIR().cn(dA)}边已经通向【${existA.target}】`,
                    existing: existA.target,
                };
            }
            // B 的反方向已经通向别人
            if (existB && existB.target && existB.target !== nameA) {
                return {
                    ok: false,
                    reason: 'conflict',
                    message: `${nameB} 的${DIR().cn(dB)}边已经通向【${existB.target}】`,
                    existing: existB.target,
                };
            }

            // ---------- 双向写入 ----------
            nodeA.exits[dA] = {
                target: nameB,
                kind: meta.kind || 'road',
                label: meta.label || `${DIR().cn(dA)}门`,
                linkedAt: Date.now(),
            };
            nodeB.exits[dB] = {
                target: nameA,
                kind: meta.kind || 'road',
                label: meta.label || `${DIR().cn(dB)}门`,
                linkedAt: Date.now(),
            };

            // ---------- 坐标缓存 ----------
            this._updateCoord(nameA);
            this._updateCoord(nameB);

            console.log(
                `[WorldGraph] 连接建立：${nameA} ←${DIR().cn(dA)}→ ${nameB}`
            );
            return { ok: true, direction: dA, opposite: dB };
        },

        // ============================================================
        // 断开连接
        // ============================================================
        disconnect(nameA, dir) {
            const dA = DIR().normalize(dir);
            if (!dA) return { ok: false };

            const store = this._store();
            const nodeA = store?.[nameA];
            if (!nodeA) return { ok: false };

            const info = nodeA.exits?.[dA];
            if (!info) return { ok: false };

            const nameB = info.target;
            delete nodeA.exits[dA];

            // 清理 B 的反向
            if (nameB) {
                const nodeB = store[nameB];
                const dB = DIR().opposite(dA);
                if (nodeB?.exits?.[dB]?.target === nameA) {
                    delete nodeB.exits[dB];
                }
            }

            return { ok: true, removed: nameB };
        },

        // ============================================================
        // 坐标缓存
        //   规则：
        //     相邻两张图的坐标差 = 方向偏移
        //     坐标是从任意一张"锚点图"出发推导出来的
        //   只用于世界地图 UI，不参与逻辑
        // ============================================================
        _updateCoord(name) {
            const store = this._store();
            const node = store?.[name];
            if (!node) return;

            // 已经有坐标 → 不动
            if (node.coord) return;

            // 找一个有坐标的邻居
            for (const [dir, info] of Object.entries(node.exits || {})) {
                const neighbor = store[info.target];
                if (neighbor?.coord) {
                    // 我的坐标 = 邻居的坐标 + 方向偏移
                    const off = DIR().offset(dir);
                    node.coord = {
                        x: neighbor.coord.x + off.x,
                        y: neighbor.coord.y + off.y,
                    };
                    console.log(`[WorldGraph] ${name} 坐标推导: (${node.coord.x}, ${node.coord.y})`);
                    return;
                }
            }

            // 没有可参考的邻居 → 默认 (0,0)
            node.coord = { x: 0, y: 0 };
        },

        // 手动设定坐标（调试用）
        setCoord(name, x, y) {
            const node = this.ensure(name);
            if (node) node.coord = { x, y };
        },

        // ============================================================
        // 一致性校验
        //   - 每条连接都应该是双向的
        //   - 坐标不应该冲突
        // ============================================================
        validate() {
            const store = this._store();
            const errors = [];
            const warnings = [];

            if (!store) return { ok: true, errors, warnings };

            // ---------- 1. 双向一致性 ----------
            for (const [nameA, nodeA] of Object.entries(store)) {
                for (const [dirA, infoA] of Object.entries(nodeA.exits || {})) {
                    const nameB = infoA.target;
                    if (!nameB) continue;

                    const nodeB = store[nameB];
                    if (!nodeB) {
                        errors.push(`${nameA} 通向【${nameB}】，但【${nameB}】不存在`);
                        continue;
                    }

                    const dirB = DIR().opposite(dirA);
                    const backLink = nodeB.exits?.[dirB];
                    if (!backLink || backLink.target !== nameA) {
                        errors.push(
                            `${nameA}.${dirA} → ${nameB} 缺少反向连接`
                        );
                    }
                }
            }

            // ---------- 2. 坐标冲突 ----------
            const coordMap = new Map();
            for (const [name, node] of Object.entries(store)) {
                if (!node.coord) continue;
                const key = `${node.coord.x},${node.coord.y}`;
                if (coordMap.has(key)) {
                    warnings.push(
                        `坐标冲突:【${name}】和【${coordMap.get(key)}】都在 (${key})`
                    );
                } else {
                    coordMap.set(key, name);
                }
            }

            return {
                ok: errors.length === 0,
                errors,
                warnings,
                count: Object.keys(store).length,
            };
        },

        // ============================================================
        // 工具
        // ============================================================
        list() {
            const store = this._store();
            return Object.values(store || {});
        },

        clear() {
            const ws = window.CinemaWorld?.worldState;
            if (ws) ws.worldGraph = {};
        },

        // 从地图列表全量重建（迁移旧存档）
        rebuildFromMaps() {
            const ws = window.CinemaWorld?.worldState;
            if (!ws?.maps) return { ok: false };

            this.clear();

            for (const [mapName, mapData] of Object.entries(ws.maps)) {
                // 跳过实例（建筑内部）
                if (mapName.includes('@')) continue;
                this.ensure(mapName);
            }

            // 从 portal 里恢复连接（旧格式兼容）
            let recovered = 0;
            for (const [mapName, mapData] of Object.entries(ws.maps)) {
                if (mapName.includes('@')) continue;
                const portals = (mapData.entities || []).filter(e => e.kind === 'portal');
                for (const p of portals) {
                    const target = p.fields?.['目标'];
                    if (!target) continue;
                    if (target.includes('@')) continue;   // 建筑内部不算

                    // 从 portal 的位置推断方向
                    const dir = this._inferDirectionFromPortal(mapData, p);
                    if (!dir) continue;

                    const result = this.connect(mapName, dir, target, {
                        kind: p.fields?.['类型'] || 'road',
                        label: p.name,
                    });
                    if (result.ok) recovered++;
                }
            }
            setTimeout(() => {
                window.WorldCoord?.recomputeAll?.();
            }, 0);
            console.log(`[WorldGraph] 从旧存档恢复 ${recovered} 条连接`);
            return { ok: true, recovered };
        },

        // 从 portal 位置推断方向（边缘位置）
        _inferDirectionFromPortal(mapData, portal) {
            const generated = mapData._generated;
            if (!generated?.width) return null;

            const x = portal.x;
            const y = portal.y;
            if (typeof x !== 'number' || typeof y !== 'number') return null;

            const W = generated.width;
            const H = generated.height;

            const rx = x / W;
            const ry = y / H;

            // 找最接近的边缘
            const margin = 0.15;
            const nearTop = ry < margin;
            const nearBottom = ry > 1 - margin;
            const nearLeft = rx < margin;
            const nearRight = rx > 1 - margin;

            if (nearTop && nearLeft) return DIR().DIRS.NW;
            if (nearTop && nearRight) return DIR().DIRS.NE;
            if (nearBottom && nearLeft) return DIR().DIRS.SW;
            if (nearBottom && nearRight) return DIR().DIRS.SE;
            if (nearTop) return DIR().DIRS.N;
            if (nearBottom) return DIR().DIRS.S;
            if (nearLeft) return DIR().DIRS.W;
            if (nearRight) return DIR().DIRS.E;

            return null;
        },
    };

    window.WorldGraph = WorldGraph;
    console.log('[CinemaWorld] world-graph.js 已加载');
})();