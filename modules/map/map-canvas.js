// ============================================================
// CinemaWorld · map-canvas.js
// 程序生成网格 / 实体摆放 / Canvas 渲染 / 玩家移动
// 依赖：map-schema.js, map-gen.js
// 暴露：window.MapLayout, window.MapCanvas, window.MapLauncher
// ============================================================

(function () {
    'use strict';

    // ============================================================
    // 1. 布局器：区域图 → 网格
    // ============================================================
    const MapLayout = {
        _rng(seed) {
            let a = seed >>> 0;
            return function () {
                a |= 0; a = (a + 0x6D2B79F5) | 0;
                let t = Math.imul(a ^ (a >>> 15), 1 | a);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
            };
        },
        _rand: Math.random,

        async build(map) {
            this._rand = this._rng((map.seed >>> 0) || 1);

            const grid = this._createGrid(map);
            const placements = this._placeRegions(map, grid);

            // ★ 区域地形 + 装饰：走 MapDecor
            for (const region of map.regions) {
                const rect = placements[region.id];
                if (!rect) continue;

                // ★ 关键：把 regionId 塞进 rect
                const rectWithId = { ...rect, regionId: region.id };

                const spec = {
                    terrains: region.terrains?.length
                        ? region.terrains
                        : (region.terrain ? [region.terrain] : []),
                    decors: region.decors || [],
                    minis: region.minis || [],
                    buildings: region.buildings || [],
                };

                const resources = window.MapDecor.resolveRegionSpec(spec);

                window.MapDecor.decorateRegion(grid, rectWithId, resources, {   // ★ 用 rectWithId
                    rng: this._rand,
                    isRoadAt: (x, y) => false,
                    isBuildingAt: (x, y) => false,
                });
            }
            this._carveConnections(grid, map.connections, placements);
            this._clearDecorOnRoads(grid);
            this._placeBuildings(map, grid, placements);
            this._placeEntities(map, grid, placements);

            map._generated = {
                grid,
                placements,
                width: grid[0].length,
                height: grid.length,
            };

            // ★ 先主线，后地图任务（串行，避免 AI 锁冲突）
            if (window.MainQuestManager) {
                try {
                    await window.MainQuestManager.onMapBuilt(map);
                } catch (e) {
                    console.error('[MapLayout] MainQuestManager.onMapBuilt 失败:', e);
                }
            }

            if (window.MapQuestManager) {
                try {
                    await window.MapQuestManager.generateMapQuests(map);
                } catch (e) {
                    console.error('[MapLayout] MapQuestManager.generateMapQuests 失败:', e);
                }
            }

            return map._generated;
        },
        _clearDecorOnRoads(grid) {
            for (let y = 0; y < grid.length; y++) {
                for (let x = 0; x < grid[0].length; x++) {
                    const cell = grid[y][x];
                    if (cell.road && cell.decor) {
                        cell.decor = null;
                        // 道路可通行
                        cell.walkable = true;
                    }
                }
            }
        },
        // ============================================================
        // 网格
        // ============================================================
        _createGrid(map) {
            const n = map.regions.length;
            const bCount = map.entities.filter(e => e.kind === 'building').length;

            let W, H;
            if (n <= 4) { W = 50; H = 38; }
            else if (n <= 8) { W = 70; H = 52; }
            else if (n <= 15) { W = 110; H = 82; }
            else { W = 180; H = 135; }

            const extra = Math.ceil(Math.sqrt(bCount) * 8);
            W = Math.min(W + extra, 300);
            H = Math.min(H + extra, 200);

            const grid = [];
            for (let y = 0; y < H; y++) {
                const row = [];
                for (let x = 0; x < W; x++) {
                    row.push({
                        terrain: 'void',
                        road: null,
                        decor: null,
                        regionId: null,
                        walkable: false,
                        emoji: '⬛',
                    });
                }
                grid.push(row);
            }
            return grid;
        },

        // ============================================================
        // 区域摆放
        // ============================================================
        _placeRegions(map, grid) {
            if (map.regions.length >= 12) return this._placeRegionsGrid(map, grid);
            return this._placeRegionsTree(map, grid);
        },

        _placeRegionsGrid(map, grid) {
            const W = grid[0].length;
            const H = grid.length;
            const regions = map.regions.slice();

            const cols = Math.max(2, Math.ceil(Math.sqrt(regions.length * (W / H))));
            const rows = Math.max(2, Math.ceil(regions.length / cols));
            const cellW = Math.floor(W / cols);
            const cellH = Math.floor(H / rows);

            const placements = {};

            regions.forEach((region, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const cellX = col * cellW;
                const cellY = row * cellH;

                const size = window.MapSchema.sizeToNumber(region.size);
                const w = Math.min(size, cellW - 4);
                const h = Math.min(Math.round(size * 0.75), cellH - 4);

                const cx = cellX + cellW / 2;
                const cy = cellY + cellH / 2;
                const x = Math.max(1, Math.round(cx - w / 2));
                const y = Math.max(1, Math.round(cy - h / 2));

                placements[region.id] = { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
            });

            return placements;
        },

        _placeRegionsTree(map, grid) {
            const W = grid[0].length;
            const H = grid.length;
            const cx = W / 2;
            const cy = H / 2;
            const placements = {};

            const regions = map.regions.slice();
            const center = regions.shift();
            if (center) placements[center.id] = this._regionRect(center, cx, cy);

            const placed = new Set(center ? [center.id] : []);
            const queue = center ? [center.id] : [];

            while (queue.length > 0 && placed.size < map.regions.length) {
                const cur = queue.shift();
                const neighbors = map.connections
                    .filter(c => c.from === cur || c.to === cur)
                    .map(c => c.from === cur ? c.to : c.from)
                    .filter(id => !placed.has(id));

                for (const nid of neighbors) {
                    const region = map.regions.find(r => r.id === nid);
                    if (!region) continue;

                    const conn = map.connections.find(
                        c => (c.from === cur && c.to === nid) || (c.to === cur && c.from === nid)
                    );
                    const dir = conn?.direction || 'any';
                    const dist = { near: 1, medium: 1.6, far: 2.4 }[conn?.distance] || 1.4;

                    const curRect = placements[cur];
                    const size = window.MapSchema.sizeToNumber(region.size);
                    const offset = Math.round(size * dist * 0.6);

                    let nx = curRect.x + curRect.w / 2;
                    let ny = curRect.y + curRect.h / 2;

                    if (dir === 'north') ny -= offset;
                    else if (dir === 'south') ny += offset;
                    else if (dir === 'east') nx += offset;
                    else if (dir === 'west') nx -= offset;
                    else {
                        const a = this._rand() * Math.PI * 2;
                        nx += Math.cos(a) * offset;
                        ny += Math.sin(a) * offset;
                    }

                    const rect = this._regionRect(region, nx, ny, W, H);
                    if (this._overlaps(rect, placements, 2)) {
                        const a = this._rand() * Math.PI * 2;
                        Object.assign(rect, this._regionRect(
                            region,
                            curRect.x + curRect.w / 2 + Math.cos(a) * offset,
                            curRect.y + curRect.h / 2 + Math.sin(a) * offset,
                            W, H
                        ));
                    }

                    placements[nid] = rect;
                    placed.add(nid);
                    queue.push(nid);
                }

                // 兜底：孤立区域
                if (queue.length === 0 && placed.size < map.regions.length) {
                    for (const r of map.regions) {
                        if (placed.has(r.id)) continue;

                        // ★ 尝试多次，找一个不重叠的位置
                        let rect = null;
                        for (let attempt = 0; attempt < 30; attempt++) {
                            const a = this._rand() * Math.PI * 2;
                            const rr = 15 + this._rand() * 25;
                            const candidate = this._regionRect(
                                r, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, W, H
                            );
                            if (!this._overlaps(candidate, placements, 3)) {
                                rect = candidate;
                                break;
                            }
                        }

                        // ★ 30 次都失败 → 强行放在地图边缘
                        if (!rect) {
                            console.warn(`[MapLayout] 区域 ${r.id} 找不到空位，放到地图边缘`);
                            const size = window.MapSchema.sizeToNumber(r.size);
                            rect = this._regionRect(r, size, size, W, H);
                        }

                        placements[r.id] = rect;
                        placed.add(r.id);
                        queue.push(r.id);
                    }
                }
            }

            return placements;
        },

        _regionRect(region, cx, cy, maxW, maxH) {
            const size = window.MapSchema.sizeToNumber(region.size);
            const w = size;
            const h = Math.max(6, Math.round(size * 0.75));
            let x = Math.round(cx - w / 2);
            let y = Math.round(cy - h / 2);
            if (maxW) x = Math.max(1, Math.min(maxW - w - 1, x));
            if (maxH) y = Math.max(1, Math.min(maxH - h - 1, y));
            return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
        },

        _overlaps(rect, placements, pad = 0) {
            for (const o of Object.values(placements)) {
                if (rect.x < o.x + o.w + pad &&
                    rect.x + rect.w + pad > o.x &&
                    rect.y < o.y + o.h + pad &&
                    rect.y + rect.h + pad > o.y) return true;
            }
            return false;
        },

        // ============================================================
        // 道路
        // ============================================================
        _carveConnections(grid, connections, placements) {
            for (const conn of connections) {
                const a = placements[conn.from];
                const b = placements[conn.to];
                if (!a || !b) continue;

                const ax = Math.round(a.cx);
                const ay = Math.round(a.cy);
                const bx = Math.round(b.cx);
                const by = Math.round(b.cy);

                const path = this._aStar(grid, ax, ay, bx, by);
                if (path && path.length) {
                    for (const p of path) {
                        const cell = grid[p.y]?.[p.x];
                        if (!cell || cell.terrain === 'void') continue;
                        cell.road = (conn.kind === 'path') ? 'path' : 'road';
                        cell.walkable = true;
                    }
                } else {
                    this._forceLine(grid, ax, ay, bx, by, conn.kind);
                }
            }
        },

        _aStar(grid, sx, sy, tx, ty) {
            const W = grid[0].length;
            const H = grid.length;
            const key = (x, y) => x + ',' + y;
            const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);

            const open = [];
            const closed = new Set();
            const cameFrom = new Map();
            const gScore = new Map();

            const startKey = key(sx, sy);
            gScore.set(startKey, 0);
            open.push({ x: sx, y: sy, f: h(sx, sy) });

            let guard = 0;
            while (open.length && guard++ < 20000) {
                open.sort((a, b) => a.f - b.f);
                const cur = open.shift();
                const curKey = key(cur.x, cur.y);

                if (cur.x === tx && cur.y === ty) {
                    const path = [];
                    let k = curKey;
                    while (k) {
                        const [x, y] = k.split(',').map(Number);
                        path.unshift({ x, y });
                        k = cameFrom.get(k);
                    }
                    return path;
                }

                closed.add(curKey);

                for (const n of [
                    { x: cur.x + 1, y: cur.y },
                    { x: cur.x - 1, y: cur.y },
                    { x: cur.x, y: cur.y + 1 },
                    { x: cur.x, y: cur.y - 1 },
                ]) {
                    if (n.x < 0 || n.x >= W || n.y < 0 || n.y >= H) continue;
                    const nKey = key(n.x, n.y);
                    if (closed.has(nKey)) continue;

                    const cell = grid[n.y][n.x];
                    if (cell.terrain === 'void') continue;

                    let cost = 1;
                    if (cell.terrain === 'water') cost = 20;
                    if (cell.terrain === 'wall') cost = 30;
                    if (cell.terrain === 'rock') cost = 10;
                    if (cell.terrain === 'tree') cost = 15;

                    const g = (gScore.get(curKey) || 0) + cost;
                    if (g < (gScore.get(nKey) ?? Infinity)) {
                        cameFrom.set(nKey, curKey);
                        gScore.set(nKey, g);
                        open.push({ x: n.x, y: n.y, f: g + h(n.x, n.y) });
                    }
                }
            }
            return null;
        },

        _forceLine(grid, x0, y0, x1, y1, kind) {
            let x = x0, y = y0;
            let guard = 0;
            while ((x !== x1 || y !== y1) && guard++ < 500) {
                this._forceCell(grid, x, y, kind);
                if (x !== x1) x += Math.sign(x1 - x);
                else if (y !== y1) y += Math.sign(y1 - y);
            }
            this._forceCell(grid, x1, y1, kind);
        },

        _forceCell(grid, x, y, kind) {
            if (y < 0 || y >= grid.length) return;
            if (x < 0 || x >= grid[0].length) return;
            const cell = grid[y][x];
            if (cell.terrain === 'void' || cell.terrain === 'wall' || cell.terrain === 'water') {
                cell.terrain = 'stone';
            }
            cell.road = (kind === 'path') ? 'path' : 'road';
            cell.walkable = true;
        },

        // ============================================================
        // 建筑
        // ============================================================
        _placeBuildings(map, grid, placements) {
            // ★ 合并建筑表：默认 + AI 定义
            const catalog = {
                ...(window.MapDecor?.DEFAULT_BUILDING_CATALOG || {}),
                ...(map.buildingCatalog || {}),
            };

            // ★ 是否走新格式：任一区域有 buildings 清单
            const useNewFormat = map.regions.some(r => r.buildings && r.buildings.length > 0);

            if (useNewFormat) {
                this._placeBuildingsNew(map, grid, placements, catalog);
            } else {
                this._placeBuildingsLegacy(map, grid, placements);
            }
        },

        // ★ 新格式：从 region.buildings 清单生成
        _placeBuildingsNew(map, grid, placements, catalog) {
            const all = [];
            const usedRects = [];

            for (const region of map.regions) {
                const rect = placements[region.id];
                if (!rect) continue;

                const list = region.buildings || [];

                for (const spec of list) {
                    // 跳过占位词
                    if (/^(无|没有|none|n\/a|-|—+)$/i.test(String(spec).trim())) continue;

                    const { name, count } = this._parseBuildingCount(spec);

                    // 匹配模板
                    const key = this._matchBuildingKey(name, catalog);
                    if (!key) {
                        console.warn('[MapCanvas] 大建筑匹配失败:', name);
                        continue;
                    }

                    const tmpl = catalog[key];

                    // 生成 count 个实例
                    for (let i = 0; i < count; i++) {
                        const inst = this._instantiateBuilding(tmpl, region.id);
                        if (this._placeOneBuilding(grid, placements, inst, usedRects, i)) {
                            all.push(inst);
                        }
                    }
                }
            }

            // 清掉旧的 building（兼容旧存档）
            map.entities = map.entities.filter(e => e.kind !== 'building');
            map.entities.push(...all);

            console.log(`[MapCanvas] 大建筑已摆放: ${all.length} 个`);
        },

        // ★ 旧格式：从 map.entities 里取（兼容）
        _placeBuildingsLegacy(map, grid, placements) {
            const buildings = map.entities.filter(e =>
                e.kind === 'building' &&
                e.size && e.size.w > 0 && e.size.h > 0
            );
            if (buildings.length === 0) return;

            const templates = buildings.filter(e => e.isTemplate);
            const singles = buildings.filter(e => !e.isTemplate);

            const all = [];
            const usedRects = [];

            const flat = [
                ...singles.map(b => ({ ...b, _count: 1 })),
                ...templates.map(b => ({ ...b, _count: b.spawnCount || b.count || 1 })),
            ];
            flat.sort((a, b) => {
                const sa = (a.size.w || 3) * (a.size.h || 3);
                const sb = (b.size.w || 3) * (b.size.h || 3);
                return sb - sa;
            });

            for (const tmpl of flat) {
                const total = tmpl._count;

                if (total <= 1) {
                    const inst = { ...tmpl };
                    if (this._placeOneBuilding(grid, placements, inst, usedRects, 0)) {
                        all.push(inst);
                    }
                } else {
                    for (let i = 0; i < total; i++) {
                        const inst = {
                            ...tmpl,
                            id: `${tmpl.id}_${i + 1}`,
                            isTemplate: false,
                            count: 1,
                        };
                        if (this._placeOneBuilding(grid, placements, inst, usedRects, i)) {
                            all.push(inst);
                        }
                    }
                }
            }

            map.entities = map.entities.filter(e => e.kind !== 'building');
            map.entities.push(...all);
        },

        // ★ 解析 "商铺×5" / "商铺 x 5" / "商铺*5" / "商铺"（默认 1）
        _parseBuildingCount(spec) {
            const s = String(spec).trim();
            const m = s.match(/^(.+?)\s*[×xX*]\s*(\d+)$/);
            if (m) {
                return { name: m[1].trim(), count: parseInt(m[2]) };
            }
            return { name: s, count: 1 };
        },

        // ★ 从 catalog 里匹配建筑模板（按名字或关键词）
        _matchBuildingKey(name, catalog) {
            if (!name) return null;
            const word = String(name).trim();

            // 1. 直接按 key 匹配
            if (catalog[word]) return word;

            // 2. 按 name 匹配
            for (const [key, def] of Object.entries(catalog)) {
                if (def.name === word) return key;
            }

            // 3. 按 keywords 匹配（长关键词优先）
            let best = null;
            let bestLen = 0;
            for (const [key, def] of Object.entries(catalog)) {
                for (const kw of (def.keywords || [])) {
                    if (word.includes(kw) && kw.length > bestLen) {
                        best = key;
                        bestLen = kw.length;
                    }
                }
                if (def.name && word.includes(def.name) && def.name.length > bestLen) {
                    best = key;
                    bestLen = def.name.length;
                }
            }
            return best;
        },
        _guessBuildingCategory(tmpl) {
            const name = (tmpl.name || '') + ' ' + (tmpl.keywords || []).join(' ');

            if (/民居|住宅|房子|小屋|木屋|棚屋|农舍/.test(name)) return '民居';
            if (/商店|商铺|店|铺|商|市场|集市|摊位/.test(name)) return '商业';
            if (/市政|政府|钟楼|教堂|祠|庙|图书馆|书院|学校|医院/.test(name)) return '公共';
            if (/旅店|客栈|旅馆|铁匠|药铺|酒馆|酒吧/.test(name)) return '特殊';

            // 猜不到 → null，全表随机
            return null;
        },
        // ★ 把一个建筑模板实例化成可摆放的实体
        _instantiateBuilding(tmpl, regionId) {
            // ★ 匹配或随机
            let spriteType = null;
            if (window.MapBuildings) {
                spriteType = window.MapBuildings.matchType(tmpl.name, {
                    category: this._guessBuildingCategory(tmpl),
                });
            }
            return {
                id: `${tmpl.id || tmpl.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: tmpl.name,
                emoji: tmpl.emoji || '🏠',
                kind: 'building',
                region: regionId,
                size: tmpl.size || { w: 3, h: 3 },
                entranceDir: tmpl.doorSide || 'south',
                wallTile: tmpl.wallTile || null,
                roofTile: tmpl.roofTile || null,
                doorTile: tmpl.doorTile || null,
                linkedRegion: tmpl.linkedRegion || null,
                _spriteType: window.MapBuildings?.matchType?.(tmpl.name) || null,
                linkedScene: null,
                isTemplate: false,
                blocking: true,
                isPlayer: false,
                tags: tmpl.tags || [],
                description: tmpl.description || '',
                meta: {},
                status: '',
                effect: '',
                fields: {},
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1,
                countMode: 'single',
                stackable: false,
                maxStack: null,
                type: 'building',
                anchor: null,
                entrance: null,
            };
        },

        _spreadBuildings(grid, placements, tmpl, total, usedRects) {
            const insts = [];
            const rect = placements[tmpl.region];
            if (!rect) return insts;

            for (let i = 0; i < total; i++) {
                const inst = {
                    ...tmpl,
                    id: `${tmpl.id}_${i + 1}`,
                    isTemplate: false,
                    _templateId: tmpl.id,
                    count: 1,
                    countMode: 'single',
                    spawnCount: 1,
                };
                if (this._placeOneBuilding(grid, placements, inst, usedRects, i)) {
                    insts.push(inst);
                }
            }
            return insts;
        },

        _placeOneBuilding(grid, placements, b, usedRects, seq) {
            if (!b.size) b.size = { w: 3, h: 3 };
            b.count = 1;
            b.countMode = 'single';

            const rect = placements[b.region];
            if (!rect) { b._placed = false; return false; }

            const pos = this._findSpot(grid, rect, b.size, usedRects, seq);
            if (!pos) { b._placed = false; return false; }

            b.anchor = { x: pos.x, y: pos.y };
            if (pos.entranceDir) b.entranceDir = pos.entranceDir;

            const isTiny = b.size.w <= 1 && b.size.h <= 1;

            // 占格
            for (let dy = 0; dy < b.size.h; dy++) {
                for (let dx = 0; dx < b.size.w; dx++) {
                    const cx = pos.x + dx;
                    const cy = pos.y + dy;
                    if (cy < 0 || cy >= grid.length || cx < 0 || cx >= grid[0].length) continue;
                    const cell = grid[cy][cx];
                    const isEdge = dx === 0 || dx === b.size.w - 1 ||
                        dy === 0 || dy === b.size.h - 1;
                    cell.decor = { type: isEdge ? 'wall' : 'roof', buildingId: b.id };
                    cell.walkable = false;
                }
            }

            // 1×1：无门
            if (isTiny) {
                b.entrance = null;
                b._placed = true;
                usedRects.push({ x: pos.x, y: pos.y, w: b.size.w, h: b.size.h });
                return true;
            }

            // 2×2+：门
            const entrance = this._computeEntrance(b, grid);
            if (entrance) {
                b.entrance = entrance;
                const ec = grid[entrance.y]?.[entrance.x];
                if (ec) {
                    ec.decor = { type: 'door', buildingId: b.id };
                    ec.walkable = true;
                    ec.portal = {
                        kind: 'building',
                        buildingId: b.id,
                        buildingName: b.name,      // ★ 目标就是建筑名
                        target: b.name,            // ★ 目标就是建筑名
                        targetType: 'map',         // ★ 当一张地图处理
                        hint: `进入${b.name}`,
                    };
                }
            }

            usedRects.push({ x: pos.x, y: pos.y, w: b.size.w, h: b.size.h });
            b._placed = true;
            return true;
        },

        _findSpot(grid, regionRect, size, usedRects, seq) {
            return this._spotAlongRoad(grid, regionRect, size, usedRects, seq)
                || this._spotSpiral(grid, regionRect, size, usedRects, seq)
                || this._spotRandom(grid, regionRect, size, usedRects);
        },

        _spotAlongRoad(grid, regionRect, size, usedRects, seq) {
            const roads = [];
            for (let y = regionRect.y; y < regionRect.y + regionRect.h; y++) {
                for (let x = regionRect.x; x < regionRect.x + regionRect.w; x++) {
                    if (grid[y]?.[x]?.road) roads.push({ x, y });
                }
            }
            if (!roads.length) return null;

            const start = (seq * 3) % roads.length;
            const dirs = [
                { dx: 1, dy: 0, entrance: 'west' },
                { dx: -1, dy: 0, entrance: 'east' },
                { dx: 0, dy: 1, entrance: 'north' },
                { dx: 0, dy: -1, entrance: 'south' },
            ];

            for (let i = 0; i < roads.length; i++) {
                const road = roads[(start + i) % roads.length];
                for (const d of dirs) {
                    let bx, by;
                    if (d.dx === 1) { bx = road.x + 1; by = road.y - Math.floor(size.h / 2); }
                    else if (d.dx === -1) { bx = road.x - size.w; by = road.y - Math.floor(size.h / 2); }
                    else if (d.dy === 1) { bx = road.x - Math.floor(size.w / 2); by = road.y + 1; }
                    else { bx = road.x - Math.floor(size.w / 2); by = road.y - size.h; }

                    if (bx < regionRect.x || bx + size.w > regionRect.x + regionRect.w) continue;
                    if (by < regionRect.y || by + size.h > regionRect.y + regionRect.h) continue;

                    if (this._rectFree(grid, bx, by, size.w, size.h, usedRects)) {
                        return { x: bx, y: by, entranceDir: d.entrance };
                    }
                }
            }
            return null;
        },

        _spotSpiral(grid, regionRect, size, usedRects, seq) {
            const minX = regionRect.x + 2;
            const maxX = regionRect.x + regionRect.w - size.w - 2;
            const minY = regionRect.y + 2;
            const maxY = regionRect.y + regionRect.h - size.h - 2;
            if (maxX < minX || maxY < minY) return null;

            const spanX = maxX - minX + 1;
            const spanY = maxY - minY + 1;
            const offX = (seq * 7) % spanX;
            const offY = (seq * 11) % spanY;

            for (let r = 0; r < Math.max(spanX, spanY); r++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const x = minX + ((offX + dx) % spanX + spanX) % spanX;
                        const y = minY + ((offY + dy) % spanY + spanY) % spanY;
                        if (this._rectFree(grid, x, y, size.w, size.h, usedRects)) {
                            return { x, y };
                        }
                    }
                }
            }
            return null;
        },

        _spotRandom(grid, regionRect, size, usedRects) {
            const minX = regionRect.x + 2;
            const maxX = regionRect.x + regionRect.w - size.w - 2;
            const minY = regionRect.y + 2;
            const maxY = regionRect.y + regionRect.h - size.h - 2;
            if (maxX < minX || maxY < minY) return null;

            const spanX = maxX - minX + 1;
            const spanY = maxY - minY + 1;

            for (let t = 0; t < 80; t++) {
                const x = minX + Math.floor(this._rand() * spanX);
                const y = minY + Math.floor(this._rand() * spanY);
                if (this._rectFree(grid, x, y, size.w, size.h, usedRects)) {
                    return { x, y };
                }
            }
            return null;
        },

        _rectFree(grid, x, y, w, h, usedRects) {
            for (const r of usedRects) {
                if (x < r.x + r.w + 1 && x + w + 1 > r.x &&
                    y < r.y + r.h + 1 && y + h + 1 > r.y) return false;
            }
            for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                    const cx = x + dx, cy = y + dy;
                    if (cy < 0 || cy >= grid.length || cx < 0 || cx >= grid[0].length) return false;
                    const cell = grid[cy][cx];
                    if (cell.terrain === 'void' || cell.terrain === 'water') return false;
                    if (cell.road || cell.decor) return false;
                }
            }
            return true;
        },

        _computeEntrance(b, grid) {
            const { x, y } = b.anchor;
            const { w, h } = b.size;
            const dir = b.entranceDir || 'south';

            let ex, ey;
            switch (dir) {
                case 'north': ex = x + Math.floor(w / 2); ey = y - 1; break;
                case 'south': ex = x + Math.floor(w / 2); ey = y + h; break;
                case 'west': ex = x - 1; ey = y + Math.floor(h / 2); break;
                case 'east': ex = x + w; ey = y + Math.floor(h / 2); break;
                default: ex = x + Math.floor(w / 2); ey = y + h;
            }
            if (ey < 0 || ey >= grid.length || ex < 0 || ex >= grid[0].length) return null;

            const cell = grid[ey][ex];
            if (!cell.walkable) { cell.terrain = 'stone'; cell.walkable = true; }
            cell.road = cell.road || 'path';
            return { x: ex, y: ey, dir };
        },


        // ============================================================
        // 实体
        // ============================================================
        _placeEntities(map, grid, placements) {
            const used = new Set();

            const player = map.entities.find(e => e.isPlayer);
            if (player) {
                const pos = this._resolvePosition(player, grid, placements, used);
                if (pos) {
                    player.x = pos.x; player.y = pos.y;
                    used.add(`${pos.x},${pos.y}`);
                    player._placed = true;
                } else {
                    const safe = this._safeSpot(grid, used);
                    if (safe) {
                        player.x = safe.x; player.y = safe.y;
                        used.add(`${safe.x},${safe.y}`);
                        player._placed = true;
                    } else {
                        player._placed = false;
                    }
                }
            }

            for (const ent of map.entities) {
                if (ent.isPlayer) continue;
                if (ent.kind === 'building') continue;

                // ★ 精灵 seed：只写一次，之后固定
                if (ent.meta && ent.meta._spriteSeed === undefined) {
                    ent.meta._spriteSeed = Math.floor(Math.random() * 1e9);
                }

                const pos = this._resolvePosition(ent, grid, placements, used);
                if (pos) {
                    ent.x = pos.x;
                    ent.y = pos.y;
                    used.add(`${pos.x},${pos.y}`);
                    ent._placed = true;
                } else {
                    ent._placed = false;
                }
            }
        },

        _safeSpot(grid, used) {
            for (let y = 0; y < grid.length; y++) {
                for (let x = 0; x < grid[0].length; x++) {
                    const cell = grid[y][x];
                    if (cell.terrain === 'void') continue;
                    if (!cell.walkable) continue;
                    if (cell.decor || cell.portal) continue;
                    if (used.has(`${x},${y}`)) continue;
                    return { x, y };
                }
            }
            return null;
        },

        _resolvePosition(ent, grid, placements, used) {
            if (ent.kind === 'building') return null;
            if (!ent.region) return null;

            const rect = placements[ent.region];
            if (!rect) return null;

            const regionId = ent.region;

            const anchor = this._anchorToXY(ent.position || 'center', rect);
            if (anchor && this._isFree(anchor.x, anchor.y, grid, used, regionId)) return anchor;

            for (let r = 1; r <= 6; r++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const x = anchor.x + dx, y = anchor.y + dy;
                        if (this._inside(x, y, rect)
                            && this._isFree(x, y, grid, used, regionId)) {
                            return { x, y };
                        }
                    }
                }
            }

            for (let t = 0; t < 80; t++) {
                const x = rect.x + 1 + Math.floor(this._rand() * Math.max(1, rect.w - 2));
                const y = rect.y + 1 + Math.floor(this._rand() * Math.max(1, rect.h - 2));
                if (this._isFree(x, y, grid, used, regionId)) return { x, y };
            }

            for (let y = rect.y; y < rect.y + rect.h; y++) {
                for (let x = rect.x; x < rect.x + rect.w; x++) {
                    if (this._isFree(x, y, grid, used, regionId)) return { x, y };
                }
            }
            return null;
        },

        _anchorToXY(name, rect) {
            const cx = Math.round(rect.cx);
            const cy = Math.round(rect.cy);
            const M = {
                center: [cx, cy], fountain: [cx, cy], altar: [cx, cy],
                clearing: [cx, cy], fire: [cx, cy], middle: [cx, cy],
                desk: [cx, cy], meeting: [cx, cy], classroom: [cx, cy],
                yard: [cx, cy], ward: [cx, cy], platform: [cx, cy],
                bench: [cx, cy], pond: [cx, cy],
                north: [cx, rect.y + 1],
                south: [cx, rect.y + rect.h - 2],
                east: [rect.x + rect.w - 2, cy],
                west: [rect.x + 1, cy],
                entrance: [cx, rect.y + rect.h - 2],
                back: [cx, rect.y + 1],
                left: [rect.x + 1, cy],
                right: [rect.x + rect.w - 2, cy],
                corner: [rect.x + 1, rect.y + 1],
                bar: [cx, rect.y + 1],
                table: [cx - 2, cy],
                counter: [cx, rect.y + 1],
                shelf: [rect.x + rect.w - 2, cy],
                start: [rect.x + 1, cy],
                end: [rect.x + rect.w - 2, cy],
                edge: [rect.x + 1, cy],
                deep: [cx, rect.y + 1],
                boss: [cx, rect.y + 1],
                tent: [rect.x + 2, cy],
                peak: [cx, rect.y + 1],
                base: [cx, rect.y + rect.h - 2],
                shore: [rect.x + 1, cy],
                kitchen: [rect.x + rect.w - 2, rect.y + 1],
                office: [rect.x + rect.w - 2, cy],
                exit: [rect.x + rect.w - 2, cy],
                balcony: [cx, rect.y + 1],
            };
            const p = M[name] || M.center;
            return { x: p[0], y: p[1] };
        },

        _inside(x, y, rect) {
            return x >= rect.x && x < rect.x + rect.w &&
                y >= rect.y && y < rect.y + rect.h;
        },

        _isFree(x, y, grid, used, regionId = null) {
            if (y < 0 || y >= grid.length) return false;
            if (x < 0 || x >= grid[0].length) return false;
            const cell = grid[y][x];
            if (cell.terrain === 'void') return false;
            if (!cell.walkable) return false;
            if (cell.regionId === null) return false;

            // ★ 新增：如果指定了 regionId，格子必须属于这个区域
            if (regionId && cell.regionId !== regionId) return false;

            if (cell.decor && cell.decor.type !== 'plant') return false;
            if (used.has(`${x},${y}`)) return false;
            return true;
        },
    };

    // ============================================================
    // 2. 渲染器
    // ============================================================
    const MapCanvas = {
        canvas: null,
        ctx: null,
        config: {
            tileSize: 48,
            baseTileSize: 48,
            minTileSize: 16,
            maxTileSize: 196,
            zoomStep: 4,
            viewTilesW: 22,
            viewTilesH: 13,
            moveCooldown: 110,
            cameraEase: 0.18,
            bgColor: '#0d0d18',
            fontSizeRatio: 0.78,
        },
        map: null,
        player: null,
        camera: { x: 0, y: 0 },
        keys: {},
        lastMoveTime: 0,
        rafId: null,
        _running: false,
        _clickPath: [],
        _onEntityNear: null,
        _cssW: 0,
        _cssH: 0,
        _currentRegionId: null,
        _titleTimer: null,
        _hintTimer: null,
        _regionTimer: null,

        init(container, map, options = {}) {
            this.config = { ...this.config, ...(options.config || {}) };
            this._onEntityNear = options.onEntityNear || null;

            if (!map._generated) MapLayout.build(map);
            this.map = map;
            this.player = map.entities.find(e => e.isPlayer);
            // ★ 初始化视觉位置
            if (this.player) {
                this.player._visualX = this.player.x;
                this.player._visualY = this.player.y;
            }
            const old = document.getElementById('cw-map-canvas');
            if (old) old.remove();

            // ★ 按容器实际尺寸
            const containerEl = container || document.body;
            const rect = containerEl.getBoundingClientRect();
            let cssW = Math.floor(rect.width);
            let cssH = Math.floor(rect.height);

            // 兜底（容器尺寸可能为 0，比如隐藏状态）
            if (cssW < 100 || cssH < 100) {
                const isMobile = window.innerWidth <= 640;
                const vw = isMobile ? 11 : this.config.viewTilesW;
                const vh = isMobile ? 7 : this.config.viewTilesH;
                cssW = this.config.baseTileSize * vw;
                cssH = this.config.baseTileSize * vh;
            }

            const maxPixels = 1920 * 1080 * 2;   // 约 400 万像素上限
            let dpr = window.devicePixelRatio || 1;
            if (cssW * dpr * cssH * dpr > maxPixels) {
                dpr = Math.sqrt(maxPixels / (cssW * cssH));
            }

            const canvas = document.createElement('canvas');
            canvas.id = 'cw-map-canvas';
            // CSS 尺寸铺满容器
            canvas.style.width = '70%';
            canvas.style.height = '70%';
            canvas.style.maxWidth = '100%';
            canvas.style.maxHeight = '100%';

            // 绘图缓冲区按实际像素
            canvas.width = cssW * dpr;
            canvas.height = cssH * dpr;
            canvas.style.display = 'block';
            canvas.style.background = this.config.bgColor;
            canvas.style.borderRadius = '12px';
            canvas.style.boxShadow = '0 8px 32px rgba(0,0,0,.5)';
            canvas.style.touchAction = 'none';
            canvas.style.cursor = 'pointer';
            canvas.style.maxWidth = '100%';

            (container || document.body).appendChild(canvas);

            this.canvas = canvas;
            this.ctx = canvas.getContext('2d', { alpha: false });
            this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            this._cssW = cssW;
            this._cssH = cssH;

            window.MapSprites?.clearPortraitRequests?.();
            this._portraitImages?.clear?.();

            this._centerCameraOnPlayer(true);
            this._bindEvents();
            this._bindResize();

            window.MapPortraitLayer?.init?.();
            window.MapTiles?.load();
            window.MapBuildings?.load();
            window.MapSprites?.load();
            window.MapSprites?.loadMale();
            window.MapSprites?.loadFemale();
            window.MapSprites?.loadPlayer();

            this._running = true;
            this._loop();

            console.log('[MapCanvas] 地图已就绪:', map._generated.width, 'x', map._generated.height);
            return this;
        },
        _bindResize() {
            this._onResize = () => {
                if (!this.canvas) return;
                const container = this.canvas.parentElement;
                if (!container) return;

                const rect = container.getBoundingClientRect();
                const cssW = Math.floor(rect.width);
                const cssH = Math.floor(rect.height);

                if (cssW < 100 || cssH < 100) return;   // 隐藏状态跳过

                const dpr = window.devicePixelRatio || 1;
                this.canvas.width = cssW * dpr;
                this.canvas.height = cssH * dpr;

                this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                this._cssW = cssW;
                this._cssH = cssH;

                // 重算相机边界
                this._clampCamera();
            };

            window.addEventListener('resize', this._onResize);

            // ★ 用 ResizeObserver 监听容器尺寸变化（比 window resize 更准）
            if (window.ResizeObserver) {
                this._resizeObserver = new ResizeObserver(() => {
                    this._onResize();
                });
                const container = this.canvas?.parentElement;
                if (container) this._resizeObserver.observe(container);
            }
        },

        _unbindResize() {
            if (this._onResize) {
                window.removeEventListener('resize', this._onResize);
                this._onResize = null;
            }
            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
                this._resizeObserver = null;
            }
        },
        destroy() {
            this._running = false;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this._unbindEvents();
            this._unbindResize();
            if (this.canvas?.parentElement) this.canvas.parentElement.removeChild(this.canvas);
            this.canvas = null;
            this.ctx = null;
            window.MapPortraitLayer?.hide?.();

            // ★ 清理立绘缓存
            this._portraitImages?.clear();
            window.MapSprites?.clearPortraitRequests?.();
        },

        _bindEvents() {
            this._onKeyDown = (e) => {
                const k = e.key.toLowerCase();
                if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
                    this.keys[k] = true;
                    e.preventDefault();
                }
            };
            this._onKeyUp = (e) => { this.keys[e.key.toLowerCase()] = false; };
            this._onClick = (e) => this._handleClick(e);
            this._onWheel = (e) => {
                e.preventDefault();
                if (e.deltaY < 0) this.zoomIn(); else this.zoomOut();
            };
            this._onKeyZoom = (e) => {
                if (!(e.ctrlKey || e.metaKey)) return;
                if (e.key === '=' || e.key === '+') { this.zoomIn(); e.preventDefault(); }
                else if (e.key === '-' || e.key === '_') { this.zoomOut(); e.preventDefault(); }
                else if (e.key === '0') { this.resetZoom(); e.preventDefault(); }
            };

            window.addEventListener('keydown', this._onKeyDown);
            window.addEventListener('keyup', this._onKeyUp);
            window.addEventListener('keydown', this._onKeyZoom);
            this.canvas.addEventListener('click', this._onClick);
            this.canvas.addEventListener('wheel', this._onWheel, { passive: false });

            // ============================================================
            // ★ 划地相关（新增）
            // ============================================================

            // 鼠标移动 → 更新悬停格子
            this._onPlotMouseMove = (e) => {
                if (!window.MapPlotManager?._selectMode?.active) return;
                const { gx, gy } = this._eventToGrid(e);
                window.MapPlotManager.onMouseMove(gx, gy);
            };

            // 鼠标离开 → 清悬停
            this._onPlotMouseLeave = () => {
                window.MapPlotManager?.onMouseLeave?.();
            };

            // 点击 → 走三点定框（捕获阶段，优先于普通 click）
            this._onPlotClick = (e) => {
                if (!window.MapPlotManager?._selectMode?.active) return;
                e.stopPropagation();
                e.preventDefault();
                const { gx, gy } = this._eventToGrid(e);
                window.MapPlotManager.onClick(gx, gy);
            };

            // 触摸结束（手机）→ 同点击
            this._onPlotTouchEnd = (e) => {
                if (!window.MapPlotManager?._selectMode?.active) return;
                const t = e.changedTouches[0];
                if (!t) return;
                e.preventDefault();
                const { gx, gy } = this._eventToGrid({ clientX: t.clientX, clientY: t.clientY });
                window.MapPlotManager.onClick(gx, gy);
            };

            this.canvas.addEventListener('mousemove', this._onPlotMouseMove);
            this.canvas.addEventListener('mouseleave', this._onPlotMouseLeave);
            this.canvas.addEventListener('click', this._onPlotClick, true);   // ★ 捕获阶段
            this.canvas.addEventListener('touchend', this._onPlotTouchEnd, { passive: false });
        },
        // ★ 从鼠标/触摸事件算格子坐标
        _eventToGrid(e) {
            const rect = this.canvas.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const scaleX = this._cssW / rect.width;
            const scaleY = this._cssH / rect.height;
            const gx = Math.floor(px * scaleX / this.config.tileSize + this.camera.x);
            const gy = Math.floor(py * scaleY / this.config.tileSize + this.camera.y);
            return { gx, gy };
        },
        _unbindEvents() {
            window.removeEventListener('keydown', this._onKeyDown);
            window.removeEventListener('keyup', this._onKeyUp);
            window.removeEventListener('keydown', this._onKeyZoom);
            if (this.canvas) {
                this.canvas.removeEventListener('click', this._onClick);
                this.canvas.removeEventListener('wheel', this._onWheel);

                // ★ 划地相关解绑
                this.canvas.removeEventListener('mousemove', this._onPlotMouseMove);
                this.canvas.removeEventListener('mouseleave', this._onPlotMouseLeave);
                this.canvas.removeEventListener('click', this._onPlotClick, true);
                this.canvas.removeEventListener('touchend', this._onPlotTouchEnd);
            }
        },

        _handleClick(e) {
            // ★ 划地模式下：由 MapPlotManager 处理，不在这里处理
            if (window.MapPlotManager?._selectMode?.active) return;

            const rect = this.canvas.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const scaleX = this._cssW / rect.width;
            const scaleY = this._cssH / rect.height;
            const gx = Math.floor(px * scaleX / this.config.tileSize + this.camera.x);
            const gy = Math.floor(py * scaleY / this.config.tileSize + this.camera.y);

            // ★★★ 0. Plot 点击优先（已创建的玩法区） ★★★
            if (window.MapPlotManager) {
                const plot = window.MapPlotManager.getPlotAt(this.map, gx, gy);
                if (plot) {
                    window.MapPlotManager.selectPlot(plot.id);
                    return;
                } else if (window.MapPlotManager._selectedPlotId) {
                    // 点空白 → 取消选中
                    window.MapPlotManager.selectPlot(null);
                }
            }

            // ★★★ 1. 主线点优先 ★★★
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            if (mq?.active && mq.status === 'active') {
                if (mq.target.kind === 'entity' && mq.target.entityId) {
                    const mainEnt = this.map.entities.find(e =>
                        e._placed && e.id === mq.target.entityId &&
                        e.x === gx && e.y === gy
                    );
                    if (mainEnt) {
                        window.MapInteract?.triggerMainQuestEntity?.(mainEnt.id);
                        return;
                    }
                }
                if (mq.target.kind === 'cell' &&
                    mq.target.x === gx && mq.target.y === gy &&
                    mq.target.mapName === this.map.name) {
                    // 已在 _checkMainQuestCell 里触发，不重复
                }
            }

            // 2. portal 优先
            const cell = this.map._generated.grid[gy]?.[gx];
            if (cell?.portal) {
                if (cell.portal.kind === 'building') {
                    window.MapInteract?.enterBuilding?.(
                        cell.portal.buildingId,
                        cell.portal.buildingName
                    );
                    return;
                }
            }

            // 3. 实体
            const ent = this.getEntityAt(gx, gy);
            if (ent && ent.kind === 'portal') {
                window.MapInteract?.enterPortal?.(ent.id);
                return;
            }
            if (ent && !ent.isPlayer) {
                window.MapEntityPanel?.openDetail?.(ent.id);
                return;
            }

            // 4. 走路径
            this._setClickPath(gx, gy);
        },

        // ============================================================
        // 缩放
        // ============================================================
        setZoom(newTs) {
            const { minTileSize, maxTileSize } = this.config;
            const ts = Math.max(minTileSize, Math.min(maxTileSize, newTs));
            if (ts === this.config.tileSize) return;

            const oldTs = this.config.tileSize;
            const cx = this.camera.x + (this._cssW / 2) / oldTs;
            const cy = this.camera.y + (this._cssH / 2) / oldTs;

            this.config.tileSize = ts;
            this.camera.x = cx - (this._cssW / 2) / ts;
            this.camera.y = cy - (this._cssH / 2) / ts;
            this._clampCamera();
        },
        zoomIn() { this.setZoom(this.config.tileSize + this.config.zoomStep); },
        zoomOut() { this.setZoom(this.config.tileSize - this.config.zoomStep); },
        resetZoom() { this.setZoom(this.config.baseTileSize); },

        _clampCamera() {
            const ts = this.config.tileSize;
            const viewW = this._cssW / ts;
            const viewH = this._cssH / ts;
            const g = this.map._generated.grid;
            const mapW = g[0].length;
            const mapH = g.length;

            this.camera.x = viewW >= mapW
                ? (mapW - viewW) / 2
                : Math.max(0, Math.min(mapW - viewW, this.camera.x));

            this.camera.y = viewH >= mapH
                ? (mapH - viewH) / 2
                : Math.max(0, Math.min(mapH - viewH, this.camera.y));
        },

        // ============================================================
        // 移动
        // ============================================================
        _setClickPath(tx, ty) {
            if (!this._isWalkable(tx, ty)) return;
            const path = [];
            let x = this.player.x, y = this.player.y;
            let guard = 0;
            while ((x !== tx || y !== ty) && guard++ < 200) {
                if (x !== tx) x += (tx > x ? 1 : -1);
                else if (y !== ty) y += (ty > y ? 1 : -1);
                if (!this._isWalkable(x, y)) break;
                path.push({ x, y });
            }
            this._clickPath = path;
        },

        _tryMove(dx, dy) {
            const nx = this.player.x + dx;
            const ny = this.player.y + dy;
            if (!this._isWalkable(nx, ny)) return false;

            // 视觉补间：记录起点和目标
            const oldVX = this.player._visualX ?? this.player.x;
            const oldVY = this.player._visualY ?? this.player.y;
            this.player._visualFromX = oldVX;
            this.player._visualFromY = oldVY;
            this.player._visualToX = nx;
            this.player._visualToY = ny;
            this.player._visualStartTime = performance.now();

            // 逻辑位置瞬间更新
            this.player.x = nx;
            this.player.y = ny;

            // ★★★ 朝向：优先用"相机相对朝向"
            if (this._pendingFacing) {
                window.MapSprites?.setPlayerFacing(this._pendingFacing);
                this._pendingFacing = null;
            } else {
                // 2D 模式 / 点击路径：按格子方向
                if (dx > 0) window.MapSprites?.setPlayerFacing('right');
                else if (dx < 0) window.MapSprites?.setPlayerFacing('left');
                else if (dy > 0) window.MapSprites?.setPlayerFacing('down');
                else if (dy < 0) window.MapSprites?.setPlayerFacing('up');
            }

            if (window.MapCanvas3D?._running) {
                window.MapCanvas3D.syncPlayer(this.player);
            }

            // ★ 同步到 3D（如果开着）
            if (window.MapCanvas3D?._running) {
                window.MapCanvas3D.syncPlayer(this.player);
            }

            this._clickPath = [];
            this._checkInteraction();
            this._checkRegionChange();
            this._checkMainQuestCell();

            this._updateNearbyAfterMove();
            return true;
        },
        // ============================================================
        // ★ 新增：移动后更新立绘层
        //   只用"玩家走一格"的频率（~10 次/秒），不用每帧
        // ============================================================
        _updateNearbyAfterMove() {
            const layer = window.MapPortraitLayer;
            if (!layer) return;

            const R = layer.NEAR_RADIUS || 2;
            const R2 = R * R;
            const px = this.player.x;
            const py = this.player.y;

            let best = null;
            let bestD2 = R2;

            for (const ent of this.map.entities) {
                if (ent.isPlayer) continue;
                if (ent.kind !== 'npc') continue;
                if (!ent._placed) continue;

                const dx = ent.x - px;
                const dy = ent.y - py;
                const d2 = dx * dx + dy * dy;

                if (d2 <= bestD2) {
                    bestD2 = d2;
                    best = ent;
                }
            }

            // ★ 走一格算一次，只调一次 showEntity
            layer.showEntity(best, best ? Math.sqrt(bestD2) : Infinity);
        },
        // ============================================================
        // ★ 检查格子落点
        // ============================================================
        _checkMainQuestCell() {
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            if (!mq?.active || mq.status !== 'active') return;
            if (mq.target.kind !== 'cell') return;
            if (mq.target.mapName !== this.map.name) return;
            if (this.player.x !== mq.target.x || this.player.y !== mq.target.y) return;

            // 防抖：标记为 triggered，防止重复
            mq.status = 'triggered';

            // 弹确认框
            window.MapInteract?.triggerMainQuestCell?.(mq);
        },
        _isWalkable(x, y) {
            const g = this.map._generated.grid;
            if (y < 0 || y >= g.length) return false;
            if (x < 0 || x >= g[0].length) return false;
            const cell = g[y][x];
            if (!cell.walkable) return false;
            const blocker = this.map.entities.find(
                e => e._placed && e.blocking && e.x === x && e.y === y
            );
            return !blocker;
        },

        _checkInteraction() {
            const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
            for (const [dx, dy] of dirs) {
                const ent = this.map.entities.find(
                    e => e._placed && !e.isPlayer &&
                        e.x === this.player.x + dx && e.y === this.player.y + dy
                );
                if (ent) {
                    this._onEntityNear?.(ent);
                    window.dispatchEvent(new CustomEvent('cw:map-entity-near', { detail: ent }));
                    return;
                }
            }
        },

        _checkRegionChange() {
            const g = this.map._generated.grid;
            const cell = g[this.player.y]?.[this.player.x];
            const regionId = cell?.regionId;
            if (regionId && regionId !== this._currentRegionId) {
                this._currentRegionId = regionId;
                const region = this.map.regions.find(r => r.id === regionId);
                window.dispatchEvent(new CustomEvent('cw:map-region-change', { detail: region }));
            }
            if (window.MapQuestManager) {
                window.MapQuestManager.onRegionEntered(regionId);
            }
        },

        _centerCameraOnPlayer(instant) {
            const viewW = this._cssW / this.config.tileSize;
            const viewH = this._cssH / this.config.tileSize;
            const g = this.map._generated.grid;
            const mapW = g[0].length;
            const mapH = g.length;

            // ★ 用视觉位置，相机跟随更平滑
            const px = this.player._visualX ?? this.player.x;
            const py = this.player._visualY ?? this.player.y;

            let tx, ty;
            tx = viewW >= mapW
                ? (mapW - viewW) / 2
                : Math.max(0, Math.min(mapW - viewW, px - viewW / 2));
            ty = viewH >= mapH
                ? (mapH - viewH) / 2
                : Math.max(0, Math.min(mapH - viewH, py - viewH / 2));

            if (instant) {
                this.camera.x = tx;
                this.camera.y = ty;
            } else {
                this.camera.x += (tx - this.camera.x) * this.config.cameraEase;
                this.camera.y += (ty - this.camera.y) * this.config.cameraEase;
            }
        },

        // ============================================================
        // 主循环
        // ============================================================
        _dirty: true,           // 需要重绘
        _lastRenderTime: 0,
        _idleRenderInterval: 100,   // 空闲时 10fps

        _loop() {
            if (!this._running) return;

            // ★★★ 3D 模式：2D 主循环空转，只保留 rAF（移动逻辑由 3D 主循环驱动）
            if (window.MapCanvas3D?._running === true) {
                this.rafId = requestAnimationFrame(() => this._loop());
                return;
            }

            // ---------- 2D 正常流程 ----------
            this._update();

            const now = performance.now();
            const idle = !this._isMoving && !this._cameraMoving && !this._hasAnimations;
            const interval = idle ? this._idleRenderInterval : 16;

            if (this._dirty || now - this._lastRenderTime >= interval) {
                if (this._renderEnabled !== false) {
                    this._render();
                    this._lastRenderTime = now;
                    this._dirty = false;
                }
            }

            this.rafId = requestAnimationFrame(() => this._loop());
        },

        _update() {
            const now = performance.now();

            // ★ 更新所有实体的视觉补间
            this._updateVisualPosition(this.player, now);
            for (const ent of this.map.entities) {
                if (ent.isPlayer) continue;
                if (ent._visualToX === undefined) continue;
                this._updateVisualPosition(ent, now);
            }

            if (now - this.lastMoveTime >= this.config.moveCooldown) {
                this._handleInputAndMove(now);
            }

            this._centerCameraOnPlayer(false);

            const moving = !!(
                this.keys['arrowup'] || this.keys['arrowdown'] ||
                this.keys['arrowleft'] || this.keys['arrowright'] ||
                this.keys['w'] || this.keys['a'] || this.keys['s'] || this.keys['d'] ||
                this._clickPath.length > 0
            );
            window.MapSprites?.updatePlayerAnimation(16.67, moving);
        },
        _updateMovementOnly(now) {
            if (!this._running) return;
            if (!this.player) return;
            if (now - this.lastMoveTime < this.config.moveCooldown) return;
            this._handleInputAndMove(now);
            // ★ 立绘由 _tryMove 内部处理
        },
        // ============================================================
        // ★ 抽取：输入解析 + 移动（2D/3D 共用）
        // ============================================================
        _handleInputAndMove(now) {
            let dx = 0, dy = 0;

            // ============================================================
            // ★ 3D 越肩视角：WASD = 相机相对方向
            // ============================================================
            if (window.MapCanvas3D?._running && window.Map3DCamera) {
                const fwd = window.Map3DCamera.getForward();
                const right = window.Map3DCamera.getRight();

                let inputX = 0, inputZ = 0;
                if (this.keys['w'] || this.keys['arrowup']) inputZ += 1;
                if (this.keys['s'] || this.keys['arrowdown']) inputZ -= 1;
                if (this.keys['d'] || this.keys['arrowright']) inputX += 1;
                if (this.keys['a'] || this.keys['arrowleft']) inputX -= 1;

                if (inputX || inputZ) {
                    const wx = fwd.x * inputZ + right.x * inputX;
                    const wz = fwd.z * inputZ + right.z * inputX;

                    if (Math.abs(wx) >= Math.abs(wz)) {
                        dx = Math.sign(wx);
                        dy = 0;
                    } else {
                        dx = 0;
                        dy = Math.sign(wz);
                    }

                    let facing = null;
                    if (inputZ > 0) facing = 'up';
                    else if (inputZ < 0) facing = 'down';
                    else if (inputX > 0) facing = 'right';
                    else if (inputX < 0) facing = 'left';

                    this._pendingFacing = facing;
                }
            }
            // ============================================================
            // ★ 2D 模式：WASD 直接对应格子方向
            // ============================================================
            else {
                if (this.keys['arrowup'] || this.keys['w']) dy = -1;
                else if (this.keys['arrowdown'] || this.keys['s']) dy = 1;
                else if (this.keys['arrowleft'] || this.keys['a']) dx = -1;
                else if (this.keys['arrowright'] || this.keys['d']) dx = 1;
            }

            // 移动
            if (dx || dy) {
                if (this._tryMove(dx, dy)) this.lastMoveTime = now;
            }
            // 点击路径
            else if (this._clickPath.length) {
                const next = this._clickPath[0];
                if (next.x === this.player.x && next.y === this.player.y) {
                    this._clickPath.shift();
                } else {
                    const sx = Math.sign(next.x - this.player.x);
                    const sy = Math.sign(next.y - this.player.y);
                    if (!this._tryMove(sx, sy)) this._clickPath = [];
                    else this.lastMoveTime = now;
                }
            }
        },
        // ============================================================
        // ★ 从 3D 切回 2D 时复位
        // ============================================================
        resumeFrom3D() {
            this._renderEnabled = true;
            this._dirty = true;

            // 强制重算 2D 相机位置
            try {
                this._centerCameraOnPlayer(true);
            } catch (e) {
                console.warn('[MapCanvas] 复位相机失败:', e);
            }

            // 玩家动画归位
            try {
                window.MapSprites?.updatePlayerAnimation?.(0, false);
            } catch (e) { }

            // 确保 rAF 在跑
            if (!this._running) {
                this._running = true;
                this._loop();
            }

            if (this.canvas) {
                this.canvas.style.display = 'block';
                this.canvas.style.visibility = 'visible';
            }
        },
        _findNearestWalkable(tx, ty) {
            if (this._isWalkable(tx, ty)) return { x: tx, y: ty };

            // 螺旋找最近
            for (let r = 1; r <= 10; r++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const nx = tx + dx, ny = ty + dy;
                        if (this._isWalkable(nx, ny)) return { x: nx, y: ny };
                    }
                }
            }
            return null;
        },
        // ============================================================
        // ★ 视觉位置补间：逻辑位置已切换，渲染位置平滑跟上
        // ============================================================
        _updateVisualPosition(ent, now) {
            if (!ent || ent._visualToX === undefined) return;

            const DURATION = this.config.moveCooldown;
            const t = Math.min(1, (now - ent._visualStartTime) / DURATION);

            // ease-in-out
            const eased = t < 0.5
                ? 2 * t * t
                : 1 - Math.pow(-2 * t + 2, 2) / 2;

            ent._visualX = ent._visualFromX + (ent._visualToX - ent._visualFromX) * eased;
            ent._visualY = ent._visualFromY + (ent._visualToY - ent._visualFromY) * eased;

            if (t >= 1) {
                ent._visualX = ent._visualToX;
                ent._visualY = ent._visualToY;
                ent._visualToX = undefined;
                ent._visualToY = undefined;
            }
        },

        // ★ 给外部模块（如 NPC 漫游）调用：触发一次补间
        startVisualMove(ent, fromX, fromY, toX, toY) {
            if (!ent) return;
            ent._visualFromX = fromX;
            ent._visualFromY = fromY;
            ent._visualToX = toX;
            ent._visualToY = toY;
            ent._visualStartTime = performance.now();

            // 如果之前没有视觉位置，用起点初始化
            if (ent._visualX === undefined) ent._visualX = fromX;
            if (ent._visualY === undefined) ent._visualY = fromY;
        },

        // ============================================================
        // 渲染
        // ============================================================
        _render() {
            const ctx = this.ctx;
            const ts = this.config.tileSize;
            const g = this.map._generated.grid;
            const camX = this.camera.x;
            const camY = this.camera.y;

            const viewW = Math.ceil(this._cssW / ts) + 1;
            const viewH = Math.ceil(this._cssH / ts) + 1;
            const startX = Math.floor(camX);
            const startY = Math.floor(camY);

            ctx.fillStyle = this.config.bgColor;
            ctx.fillRect(0, 0, this._cssW, this._cssH);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `${Math.floor(ts * this.config.fontSizeRatio)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;

            const tiles = window.MapTiles;
            const useTiles = tiles?.ready();
            const useDecor = tiles?.decorReady();

            // ---------- 层 0：地形 ----------
            for (let y = startY; y < startY + viewH; y++) {
                for (let x = startX; x < startX + viewW; x++) {
                    if (y < 0 || y >= g.length) continue;
                    if (x < 0 || x >= g[0].length) continue;
                    const cell = g[y][x];
                    if (cell.terrain === 'void') continue;

                    // 层 0：地形
                    const px = Math.round((x - camX) * ts);
                    const py = Math.round((y - camY) * ts);

                    if (useTiles) {
                        const src = tiles.getTerrainRect(cell.terrain);
                        if (src) {
                            ctx.drawImage(
                                tiles.terrainImage,
                                src.sx, src.sy, src.sw, src.sh,
                                px, py, ts + 1, ts + 1       // ★ +1
                            );
                            continue;
                        }
                    }
                    ctx.fillText(cell.emoji, px + ts / 2, py + ts / 2);
                }
            }

            // ---------- 层 1：道路 ----------
            if (useTiles) {
                for (let y = startY; y < startY + viewH; y++) {
                    for (let x = startX; x < startX + viewW; x++) {
                        if (y < 0 || y >= g.length) continue;
                        if (x < 0 || x >= g[0].length) continue;
                        const cell = g[y][x];
                        if (!cell.road) continue;

                        // 层 1：道路
                        const px = Math.round((x - camX) * ts);
                        const py = Math.round((y - camY) * ts);
                        const src = tiles.getTerrainRect(cell.road);
                        if (src) {
                            ctx.drawImage(
                                tiles.terrainImage,
                                src.sx, src.sy, src.sw, src.sh,
                                px, py, ts + 1, ts + 1
                            );
                        }
                    }
                }
            }

            // ---------- 层 2：装饰（非建筑） ----------
            if (useDecor) {
                for (let y = startY; y < startY + viewH; y++) {
                    for (let x = startX; x < startX + viewW; x++) {
                        if (y < 0 || y >= g.length) continue;
                        if (x < 0 || x >= g[0].length) continue;
                        const cell = g[y][x];
                        if (!cell.decor || cell.decor.buildingId) continue;

                        const px = (x - camX) * ts;
                        const py = (y - camY) * ts;
                        const src = tiles.getDecorRect(cell.decor);
                        if (src) {
                            const drawH = ts * 1.15;
                            const dx = px + ts / 2 - drawH / 2;
                            const dy = py + ts - drawH;
                            ctx.drawImage(tiles.decorImage, src.sx, src.sy, src.sw, src.sh, dx, dy, drawH, drawH);
                        }
                    }
                }
            }

            // ---------- 层 2.5：建筑（独立遍历） ----------
            for (const ent of this.map.entities) {
                if (ent.kind !== 'building') continue;
                if (!ent.anchor || !ent.size) continue;

                const bx = (ent.anchor.x - camX) * ts;
                const by = (ent.anchor.y - camY) * ts;
                const bw = ent.size.w * ts;
                const bh = ent.size.h * ts;

                if (bx + bw < -ts || bx > this._cssW + ts) continue;
                if (by + bh < -ts || by > this._cssH + ts) continue;

                this._drawBuilding(ctx, ent, bx, by, bw, bh, ts, tiles, useDecor, camX, camY);

                // ★ 门标记：光圈 + 名字
                if (ent.entrance) {
                    this._drawDoorMarker(ctx, ent, ts, camX, camY, performance.now());
                }
            }
            // ---------- 层 3：实体（按 y 排序，y 大的先画）----------
            const now = performance.now();

            const visibleEntities = [];
            for (const ent of this.map.entities) {
                if (ent.kind === 'building') continue;
                if (!ent._placed) continue;
                // ★ 上方多留 3 格（精灵溢出），下方多留 1 格
                if (ent.x < startX - 2 || ent.x > startX + viewW + 2) continue;
                if (ent.y < startY - 3 || ent.y > startY + viewH + 1) continue;
                visibleEntities.push(ent);
            }
            // y 小的先画（在后方），y 大的后画（挡住前面的）
            visibleEntities.sort((a, b) => {
                if (a.y !== b.y) return a.y - b.y;
                return a.x - b.x;
            });

            for (const ent of visibleEntities) {
                // ★ 用视觉位置渲染
                const vx = ent._visualX ?? ent.x;
                const vy = ent._visualY ?? ent.y;
                const px = Math.round((vx - camX) * ts + ts / 2);
                const py = Math.round((vy - camY) * ts + ts / 2);
                this._drawEntity(ctx, ent, px, py, ts, now, camX, camY);
            }
            // ★ 主线点：格子落点
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            if (mq?.active && mq.status === 'active'
                && mq.target.kind === 'cell'
                && mq.target.mapName === this.map.name) {
                const cx = (mq.target.x - camX) * ts + ts / 2;
                const cy = (mq.target.y - camY) * ts + ts / 2;
                // 可视范围内才画
                if (cx > -ts && cx < this._cssW + ts && cy > -ts && cy < this._cssH + ts) {
                    this._drawMainQuestMarker(ctx, cx, cy, ts, now, mq.title);
                }
            }

            if (window.MapPlotManager) {
                window.MapPlotManager.render(ctx, this.camera, ts, this._cssW, this._cssH);
            }

            this._renderDayNight(ctx);
        },

        // ============================================================
        // 建筑绘制
        // ============================================================
        _drawBuilding(ctx, ent, bx, by, bw, bh, ts, tiles, useDecor, camX, camY) {
            const size = ent.size;
            const isTiny = size.w <= 1 && size.h <= 1;
            // ============================================================
            // ★ 占位区域标记（在画建筑之前铺底色）
            // ============================================================
            if (!isTiny) {
                ctx.save();

                const x = bx + 1;
                const y = by + 1;
                const w = bw - 2;
                const h = bh - 2;

                // ---------- 1. 淡青底（极淡）----------
                ctx.fillStyle = 'rgba(120, 220, 240, 0.06)';
                ctx.fillRect(x, y, w, h);

                // ---------- 2. 细边框 ----------
                ctx.strokeStyle = 'rgba(120, 220, 240, 0.35)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

                // ---------- 3. 四角 L 型角标（发光）----------
                const cornerLen = Math.min(w, h) * 0.22;
                ctx.strokeStyle = 'rgba(140, 255, 220, 0.95)';
                ctx.lineWidth = 2;
                ctx.lineCap = 'round';
                ctx.shadowColor = 'rgba(140, 255, 220, 0.9)';
                ctx.shadowBlur = 6;

                // 左上
                ctx.beginPath();
                ctx.moveTo(x, y + cornerLen);
                ctx.lineTo(x, y);
                ctx.lineTo(x + cornerLen, y);
                ctx.stroke();

                // 右上
                ctx.beginPath();
                ctx.moveTo(x + w - cornerLen, y);
                ctx.lineTo(x + w, y);
                ctx.lineTo(x + w, y + cornerLen);
                ctx.stroke();

                // 左下
                ctx.beginPath();
                ctx.moveTo(x, y + h - cornerLen);
                ctx.lineTo(x, y + h);
                ctx.lineTo(x + cornerLen, y + h);
                ctx.stroke();

                // 右下
                ctx.beginPath();
                ctx.moveTo(x + w - cornerLen, y + h);
                ctx.lineTo(x + w, y + h);
                ctx.lineTo(x + w, y + h - cornerLen);
                ctx.stroke();

                ctx.shadowBlur = 0;

                // ---------- 4. 边框上的小刻度点（科技感）----------
                ctx.fillStyle = 'rgba(140, 255, 220, 0.6)';
                const dotSize = 1.5;
                const dotStep = 12;
                // 上边
                for (let px = x + cornerLen + dotStep; px < x + w - cornerLen; px += dotStep) {
                    ctx.fillRect(px - dotSize / 2, y - dotSize / 2, dotSize, dotSize);
                }
                // 下边
                for (let px = x + cornerLen + dotStep; px < x + w - cornerLen; px += dotStep) {
                    ctx.fillRect(px - dotSize / 2, y + h - dotSize / 2, dotSize, dotSize);
                }
                // 左边
                for (let py = y + cornerLen + dotStep; py < y + h - cornerLen; py += dotStep) {
                    ctx.fillRect(x - dotSize / 2, py - dotSize / 2, dotSize, dotSize);
                }
                // 右边
                for (let py = y + cornerLen + dotStep; py < y + h - cornerLen; py += dotStep) {
                    ctx.fillRect(x + w - dotSize / 2, py - dotSize / 2, dotSize, dotSize);
                }

                ctx.restore();
            }
            // ============================================================
            // ★ 1. 尝试用建筑精灵
            // ============================================================
            if (!isTiny && window.MapBuildings) {
                const sheetKey = window.MapBuildings.resolveSheetKey(size.w, size.h);

                if (window.MapBuildings.ready(sheetKey)) {
                    const drawn = window.MapBuildings.draw(
                        ctx, ent,
                        { x: camX, y: camY },
                        ts,
                        this._cssW,
                        this._cssH
                    );

                    if (drawn) {
                        // 画门的光圈
                        if (ent.entrance) {
                            this._drawEntranceGlow(ctx, ent, ts, camX, camY);
                        }
                        return;
                    }
                }
            }

            // ============================================================
            // ★ 2. 瓦片拼合（兜底）
            // ============================================================
            if (isTiny) {
                if (useDecor) {
                    let src = tiles.getDecorRect({ type: ent.wallTile || 'small_building', variant: 0 });
                    if (!src) src = tiles.getDecorRect({ type: 'small_building', variant: 0 });
                    if (src) {
                        const drawH = ts * 1.15;
                        const dx = bx + ts / 2 - drawH / 2;
                        const dy = by + ts - drawH;
                        ctx.drawImage(tiles.decorImage, src.sx, src.sy, src.sw, src.sh, dx, dy, drawH, drawH);
                        return;
                    }
                }
                ctx.font = `${Math.floor(ts * 0.9)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
                ctx.fillText(ent.emoji || '🏠', bx + ts / 2, by + ts / 2);
                return;
            }

            if (useDecor) {
                // 外墙
                let wallSrc = tiles.getDecorRect({ type: ent.wallTile || 'wall', variant: 0 });
                if (!wallSrc) wallSrc = tiles.getDecorRect({ type: 'wall', variant: 0 });
                if (wallSrc) {
                    for (let dy = 0; dy < size.h; dy++) {
                        for (let dx = 0; dx < size.w; dx++) {
                            ctx.drawImage(
                                tiles.decorImage,
                                wallSrc.sx, wallSrc.sy, wallSrc.sw, wallSrc.sh,
                                bx + dx * ts, by + dy * ts, ts, ts
                            );
                        }
                    }
                }

                // 屋顶
                const roofType = ent.roofTile || 'roof';
                if (roofType && roofType !== 'none' && size.w > 2 && size.h > 2) {
                    let roofSrc = tiles.getDecorRect({ type: roofType, variant: 0 });
                    if (!roofSrc) roofSrc = tiles.getDecorRect({ type: 'roof', variant: 0 });
                    if (roofSrc) {
                        for (let dy = 1; dy < size.h - 1; dy++) {
                            for (let dx = 1; dx < size.w - 1; dx++) {
                                ctx.drawImage(
                                    tiles.decorImage,
                                    roofSrc.sx, roofSrc.sy, roofSrc.sw, roofSrc.sh,
                                    bx + dx * ts, by + dy * ts, ts, ts
                                );
                            }
                        }
                    }
                }

                // 门
                if (ent.entrance) {
                    let doorSrc = tiles.getDecorRect({ type: ent.doorTile || 'door', variant: 0 });
                    if (!doorSrc) doorSrc = tiles.getDecorRect({ type: 'door', variant: 0 });
                    if (doorSrc) {
                        const dx = (ent.entrance.x - camX) * ts;
                        const dy = (ent.entrance.y - camY) * ts;
                        ctx.drawImage(tiles.decorImage, doorSrc.sx, doorSrc.sy, doorSrc.sw, doorSrc.sh, dx, dy, ts, ts);
                    }
                }
            } else {
                // 兜底：矩形 + emoji
                ctx.fillStyle = 'rgba(60,60,90,0.75)';
                ctx.fillRect(bx, by, bw, bh);
                ctx.strokeStyle = 'rgba(160,180,255,0.6)';
                ctx.lineWidth = 2;
                ctx.strokeRect(bx, by, bw, bh);

                ctx.font = `${Math.floor(ts * 0.9)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
                ctx.fillText(ent.emoji || '🏠', bx + bw / 2, by + bh / 2);
            }

            // 门的光圈
            if (ent.entrance) {
                this._drawEntranceGlow(ctx, ent, ts, camX, camY);
            }
        },

        // ★ 抽出来：门的光圈
        _drawEntranceGlow(ctx, ent, ts, camX, camY) {
            const ex = (ent.entrance.x - camX) * ts + ts / 2;
            const ey = (ent.entrance.y - camY) * ts + ts / 2;
            const now = performance.now();
            const r = ts * 0.35 * (1 + Math.sin(now / 400) * 0.2);
            const grd = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * 1.8);
            grd.addColorStop(0, 'rgba(140,255,220,0.7)');
            grd.addColorStop(0.5, 'rgba(80,200,180,0.3)');
            grd.addColorStop(1, 'rgba(80,200,180,0)');
            ctx.beginPath();
            ctx.arc(ex, ey, r * 1.8, 0, Math.PI * 2);
            ctx.fillStyle = grd;
            ctx.fill();
        },
        // ============================================================
        // ★ 门标记：脉动光圈 + 建筑名标签 + 🚪
        // ============================================================
        _drawDoorMarker(ctx, ent, ts, camX, camY, now) {
            const ex = (ent.entrance.x - camX) * ts + ts / 2;
            const ey = (ent.entrance.y - camY) * ts + ts / 2;

            // ---------- 1. 脉动光圈 ----------
            const r = ts * 0.5;

            const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, r * 2);
            glow.addColorStop(0, 'rgba(140,255,220,0.85)');
            glow.addColorStop(0.4, 'rgba(80,200,180,0.5)');
            glow.addColorStop(1, 'rgba(80,200,180,0)');
            ctx.beginPath();
            ctx.arc(ex, ey, r * 2, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();

            // 内圈
            ctx.beginPath();
            ctx.arc(ex, ey, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(180,255,230,0.6)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(220,255,245,0.95)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // ---------- 2. 🚪 图标 ----------
            ctx.font = `${Math.floor(ts * 0.55)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🚪', ex, ey);

            // ---------- 3. 名字标签 ----------
            const label = ent.name || '入口';
            ctx.font = `bold ${Math.floor(ts * 0.26)}px sans-serif`;
            const tw = ctx.measureText(label).width;
            const padX = 8;
            const boxW = tw + padX * 2;
            const boxH = ts * 0.38;

            // 标签放在门上方（避免和建筑名重叠）
            const bx = ex - boxW / 2;
            const by = ey - ts * 0.75 - boxH;

            // 背板
            ctx.fillStyle = 'rgba(20,40,40,0.85)';
            ctx.strokeStyle = 'rgba(140,255,220,0.8)';
            ctx.lineWidth = 1.5;
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(bx, by, boxW, boxH, 6);
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.fillRect(bx, by, boxW, boxH);
                ctx.strokeRect(bx, by, boxW, boxH);
            }

            // 文字
            ctx.fillStyle = '#a8ffe0';
            ctx.fillText(label, ex, by + boxH / 2);

            // ---------- 4. 上下浮动的小箭头（提示可进入） ----------
            const arrowY = ey - ts * 0.55;
            ctx.fillStyle = 'rgba(180,255,230,0.9)';
            ctx.beginPath();
            ctx.moveTo(ex, arrowY + 6);
            ctx.lineTo(ex - 6, arrowY - 4);
            ctx.lineTo(ex + 6, arrowY - 4);
            ctx.closePath();
            ctx.fill();
        },
        // ============================================================
        // 实体绘制
        // ============================================================
        _drawEntity(ctx, ent, px, py, ts, now, camX, camY) {
            const useSprites = window.MapSprites?.ready();

            // ★ 主线点判定
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            const isMainEntity = mq?.active && mq.status === 'active'
                && mq.target.kind === 'entity'
                && mq.target.entityId === ent.id;

            // ---------- 玩家 ----------
            if (ent.isPlayer) {
                const radius = ts * 0.52

                const glow = ctx.createRadialGradient(px, py, 0, px, py, radius * 1.6);
                glow.addColorStop(0, 'rgba(120,160,255,0.55)');
                glow.addColorStop(0.5, 'rgba(102,126,234,0.35)');
                glow.addColorStop(1, 'rgba(102,126,234,0)');
                ctx.beginPath();
                ctx.arc(px, py, radius * 1.6, 0, Math.PI * 2);
                ctx.fillStyle = glow;
                ctx.fill();

                const pSrc = window.MapSprites?.getPlayerSourceRect();
                if (pSrc && window.MapSprites.playerLoaded) {
                    const drawH = ts * 1.2;
                    const drawW = drawH * (pSrc.sw / pSrc.sh);
                    ctx.drawImage(
                        window.MapSprites.playerImage,
                        pSrc.sx, pSrc.sy, pSrc.sw, pSrc.sh,
                        px - drawW / 2, py + ts / 2 - drawH, drawW, drawH
                    );
                } else {
                    ctx.beginPath();
                    ctx.arc(px, py, radius, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(140,170,255,1)';
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(200,220,255,0.95)';
                    ctx.lineWidth = 2.5;
                    ctx.stroke();
                    ctx.font = `${Math.floor(ts * 1.05)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
                    ctx.fillText(ent.emoji, px, py);
                }
                return;
            }
            // ★ 任务点（内联判断）
            if (ent.kind === 'quest_point') {
                const r = ts * 0.55

                // 外层金色光晕
                const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 2.2);
                glow.addColorStop(0, 'rgba(255,215,100,0.95)');
                glow.addColorStop(0.4, 'rgba(255,180,60,0.55)');
                glow.addColorStop(1, 'rgba(255,180,60,0)');
                ctx.beginPath();
                ctx.arc(px, py, r * 2.2, 0, Math.PI * 2);
                ctx.fillStyle = glow;
                ctx.fill();

                // 内圈实心圆
                ctx.beginPath();
                ctx.arc(px, py, r * 0.8, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,200,80,0.9)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,240,180,1)';
                ctx.lineWidth = 2;
                ctx.stroke();

                // ❗ 图标
                ctx.font = `${Math.floor(ts * 0.7)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(ent.emoji || '❗', px, py);

                // 名字标签
                if (ent.name) {
                    const label = ent.name;
                    ctx.font = `bold ${Math.floor(ts * 0.26)}px sans-serif`;
                    const tw = ctx.measureText(label).width;
                    const boxW = tw + 14;
                    const boxH = ts * 0.36;
                    const bx = px - boxW / 2;
                    const by = py - ts * 0.75 - boxH;

                    ctx.fillStyle = 'rgba(60,40,10,0.9)';
                    ctx.strokeStyle = 'rgba(255,215,100,0.9)';
                    ctx.lineWidth = 1.5;
                    if (ctx.roundRect) {
                        ctx.beginPath();
                        ctx.roundRect(bx, by, boxW, boxH, 6);
                        ctx.fill();
                        ctx.stroke();
                    } else {
                        ctx.fillRect(bx, by, boxW, boxH);
                        ctx.strokeRect(bx, by, boxW, boxH);
                    }

                    ctx.fillStyle = '#ffd76b';
                    ctx.fillText(label, px, by + boxH / 2);
                }

                // 浮动三角
                const arrowY = py - ts * 0.55 + Math.sin(now / 300) * 3;
                ctx.fillStyle = 'rgba(255,220,140,0.95)';
                ctx.beginPath();
                ctx.moveTo(px, arrowY + 6);
                ctx.lineTo(px - 6, arrowY - 4);
                ctx.lineTo(px + 6, arrowY - 4);
                ctx.closePath();
                ctx.fill();

                return;
            }
            // ---------- 非玩家 ----------
            // ★ 只有 npc / encounter 才画精灵 / 立绘，其他一律走 emoji
            const SPRITE_KINDS = ['npc', 'encounter'];
            const allowSprite = SPRITE_KINDS.includes(ent.kind);

            const spriteSrc = (useSprites && allowSprite)
                ? window.MapSprites.getSourceRectForEntity(ent)
                : null;
            const hasSprite = !!spriteSrc;
            let spriteTopY = py - ts * 0.55;   // 默认兜底

            // ★ 立绘优先：只有 npc / encounter 才尝试
            let portraitUrl = null;
            if (allowSprite) {
                portraitUrl = window.MapSprites?.getPortraitSync?.(ent) || null;
                if (!portraitUrl) {
                    // 未命中 → 触发异步加载，本帧继续用精灵 / emoji 兜底
                    window.MapSprites?.requestPortraitLoad?.(ent);
                }
            }
            const portraitImg = portraitUrl ? this._getPortraitImage(portraitUrl) : null;
            // ★ 追击中标记：头顶飘一个愤怒符号
            if (ent.kind === 'encounter' && ent.meta?._encounterChasing) {
                this._drawChasingMarker(ctx, px, spriteTopY, ts, now);
            }
            // ============================================================
            // 绘制主图标：立绘 > 精灵 > emoji
            // ============================================================
            if (portraitImg) {
                // ---------- ① 立绘 ----------
                // 光圈（贴地）
                if (ent.kind === 'npc' || ent.kind === 'encounter') {
                    const glowR = ts * 0.75;
                    const glowY = py + ts * 0.35;
                    const color = ent.kind === 'npc'
                        ? ['rgba(255,215,120,0.55)', 'rgba(255,215,120,0.25)', 'rgba(255,215,120,0)']
                        : ['rgba(255,120,120,0.55)', 'rgba(255,120,120,0.25)', 'rgba(255,120,120,0)'];
                    const grd = ctx.createRadialGradient(px, glowY, 0, px, glowY, glowR);
                    grd.addColorStop(0, color[0]);
                    grd.addColorStop(0.6, color[1]);
                    grd.addColorStop(1, color[2]);
                    ctx.beginPath();
                    ctx.ellipse(px, glowY, glowR, glowR * 0.45, 0, 0, Math.PI * 2);
                    ctx.fillStyle = grd;
                    ctx.fill();
                }

                // 立绘按"大精灵"规格画
                const drawH = ts * 1.2;
                const drawW = ts * 0.8;
                const drawX = px - drawW / 2;
                const drawY = py + ts / 2 - drawH;
                spriteTopY = drawY;

                this._drawPortraitSprite(ctx, ent, drawX, drawY, drawW, drawH, portraitImg);

            } else if (hasSprite) {
                // ---------- ② 精灵 ----------
                const isBig = window.MapSprites?.isBigSprite?.(ent) === true;

                if (ent.kind === 'npc' || ent.kind === 'encounter') {
                    // 光圈：贴地（脚底）
                    const glowR = isBig ? ts * 0.75 : ts * 0.55;
                    const glowY = py + ts * 0.35;
                    const color = ent.kind === 'npc'
                        ? ['rgba(255,215,120,0.55)', 'rgba(255,215,120,0.25)', 'rgba(255,215,120,0)']
                        : ['rgba(255,120,120,0.55)', 'rgba(255,120,120,0.25)', 'rgba(255,120,120,0)'];
                    const grd = ctx.createRadialGradient(px, glowY, 0, px, glowY, glowR);
                    grd.addColorStop(0, color[0]);
                    grd.addColorStop(0.6, color[1]);
                    grd.addColorStop(1, color[2]);
                    ctx.beginPath();
                    ctx.ellipse(px, glowY, glowR, glowR * 0.45, 0, 0, Math.PI * 2);
                    ctx.fillStyle = grd;
                    ctx.fill();
                }

                const img = window.MapSprites.getImageForEntity(ent);
                if (img) {
                    if (isBig) {
                        const drawH = ts * 1.4;
                        const drawW = ts * 1.4;
                        const drawX = px - drawW / 2;
                        const drawY = py + ts / 2 - drawH;
                        spriteTopY = drawY;

                        ctx.drawImage(img, spriteSrc.sx, spriteSrc.sy, spriteSrc.sw, spriteSrc.sh,
                            drawX, drawY, drawW, drawH);
                    } else {
                        const drawH = ts * 1.15;
                        const drawW = drawH * (spriteSrc.sw / spriteSrc.sh);
                        const drawX = px - drawW / 2;
                        const drawY = py + ts / 2 - drawH;
                        spriteTopY = drawY;

                        ctx.drawImage(img, spriteSrc.sx, spriteSrc.sy, spriteSrc.sw, spriteSrc.sh,
                            drawX, drawY, drawW, drawH);
                    }
                }

            } else {
                // ---------- ③ 无精灵：emoji 兜底 ----------
                if (ent.kind === 'decor') {
                    ctx.font = `${Math.floor(ts * 0.92)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
                    ctx.fillText(ent.emoji, px, py);
                } else if (ent.kind === 'npc') {
                    ctx.beginPath();
                    ctx.arc(px, py + ts * 0.05, ts * 0.42, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255,210,120,0.1)';
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255,215,140,0.7)';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();

                    ctx.font = `${Math.floor(ts * 0.92)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
                    ctx.fillText(ent.emoji, px, py);
                } else {
                    ctx.font = `${Math.floor(ts * 0.92)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
                    ctx.fillText(ent.emoji, px, py);
                }
            }

            // ---------- 集群（仅 npc / encounter） ----------
            const isCluster = ent.countMode === 'cluster' && ent.count > 1 &&
                (ent.kind === 'npc' || ent.kind === 'encounter');
            if (isCluster) {
                const extra = Math.min(ent.count - 1, 4);
                const radius = ts * 0.55;
                ctx.globalAlpha = 0.55;
                ctx.font = `${Math.floor(ts * 0.6)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
                for (let i = 0; i < extra; i++) {
                    const a = (Math.PI * 2 / extra) * i + (now / 1200);
                    ctx.fillText(ent.emoji, px + Math.cos(a) * radius, py + Math.sin(a) * radius);
                }
                ctx.globalAlpha = 1;
            }

            // ---------- 名字 ----------
            if (ent.name) {
                // ★ 有立绘 or 大精灵 → 名字放脚下
                const isBig = window.MapSprites?.isBigSprite?.(ent) === true || !!portraitImg;
                const label = ent.name;
                ctx.font = `bold ${Math.floor(ts * 0.26)}px sans-serif`;
                const tw = ctx.measureText(label).width;
                const boxW = tw + 10;
                const boxH = ts * 0.34;
                const bx = px - boxW / 2;
                const by = isBig
                    ? py + ts * 0.42
                    : py + ts * 0.36;

                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                if (ctx.roundRect) {
                    ctx.beginPath();
                    ctx.roundRect(bx, by, boxW, boxH, 5);
                    ctx.fill();
                } else {
                    ctx.fillRect(bx, by, boxW, boxH);
                }

                ctx.fillStyle = ent.kind === 'npc' ? '#ffe6a8' : '#d8e0ff';
                ctx.fillText(label, px, by + boxH / 2);
            }

            // ★ 主线点金色标记
            if (isMainEntity) {
                this._drawMainQuestMarker(ctx, px, py - ts * 0.7, ts, now, ent.name);
            }

            // ---------- 数量角标 ----------
            if (isCluster) {
                const text = `×${ent.count}`;
                ctx.font = `bold ${Math.floor(ts * 0.3)}px sans-serif`;
                const tw = ctx.measureText(text).width;
                const bw = tw + 8;
                const bh = ts * 0.34;
                const bx = px + ts * 0.18;
                const by = py - ts * 0.36;

                ctx.fillStyle = 'rgba(216,125,125,0.92)';
                if (ctx.roundRect) {
                    ctx.beginPath();
                    ctx.roundRect(bx, by, bw, bh, 6);
                    ctx.fill();
                } else {
                    ctx.fillRect(bx, by, bw, bh);
                }
                ctx.fillStyle = '#fff';
                ctx.fillText(text, bx + bw / 2, by + bh / 2);
            }
            // ★ 靠近中标记：头顶飘一个手
            if (ent.kind === 'npc' && ent.meta?._approachingPlayer) {
                this._drawApproachingMarker(ctx, px, spriteTopY, ts, now);
            }
            // ---------- NPC 头顶标记 ----------
            if (ent.kind === 'npc') {
                const dotY = spriteTopY - ts * 0.05;   // ★ 固定，去掉 sin
                ctx.beginPath();
                ctx.arc(px, dotY, 6, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,215,100,0.25)';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(px, dotY, 3.5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,230,150,1)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }

            // ---------- Portal 光圈 ----------
            if (ent.kind === 'portal') {
                const r = ts * 0.45;
                const glow = ctx.createRadialGradient(px, py, 0, px, py, r * 1.8);
                glow.addColorStop(0, 'rgba(120,255,220,0.7)');
                glow.addColorStop(0.5, 'rgba(80,200,180,0.35)');
                glow.addColorStop(1, 'rgba(80,200,180,0)');
                ctx.beginPath();
                ctx.arc(px, py, r * 1.8, 0, Math.PI * 2);
                ctx.fillStyle = glow;
                ctx.fill();

                ctx.beginPath();
                ctx.arc(px, py, r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(140,255,220,0.85)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(200,255,240,0.95)';
                ctx.lineWidth = 2;
                ctx.stroke();

                // ★ 主线点判定
                const mq2 = window.CinemaWorld?.worldState?.mainQuest;
                if (mq2?.active && mq2.status === 'active'
                    && mq2.target.kind === 'portal'
                    && mq2.target.portalId === ent.id) {
                    this._drawMainQuestMarker(ctx, px, py - ts * 0.7, ts, now, mq2.title);
                }
            }
        },
        _drawChasingMarker(ctx, px, topY, ts, now) {
            const baseY = topY - ts * 0.5;

            // 红色光晕
            const r = ts * 0.3;
            const glow = ctx.createRadialGradient(px, baseY, 0, px, baseY, r * 2);
            glow.addColorStop(0, 'rgba(255,100,100,0.9)');
            glow.addColorStop(0.5, 'rgba(255,80,80,0.4)');
            glow.addColorStop(1, 'rgba(255,80,80,0)');
            ctx.beginPath();
            ctx.arc(px, baseY, r * 2, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();

            // 圆底
            ctx.beginPath();
            ctx.arc(px, baseY, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,140,140,0.95)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,60,60,1)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // 💢 图标
            ctx.font = `${Math.floor(ts * 0.34)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('💢', px, baseY);

            // 三角指向
            ctx.beginPath();
            ctx.moveTo(px - 4, baseY + r + 1);
            ctx.lineTo(px + 4, baseY + r + 1);
            ctx.lineTo(px, baseY + r + 6);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255,60,60,1)';
            ctx.fill();
        },
        // ============================================================
        // ★ 靠近中标记：头顶的"想聊聊"气泡
        // ============================================================
        _drawApproachingMarker(ctx, px, topY, ts, now) {
            const baseY = topY - ts * 0.55;

            // 光晕
            const r = ts * 0.28;
            const glow = ctx.createRadialGradient(px, baseY, 0, px, baseY, r * 2);
            glow.addColorStop(0, 'rgba(255,220,120,0.85)');
            glow.addColorStop(0.5, 'rgba(255,180,60,0.35)');
            glow.addColorStop(1, 'rgba(255,180,60,0)');
            ctx.beginPath();
            ctx.arc(px, baseY, r * 2, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();

            // 圆底
            ctx.beginPath();
            ctx.arc(px, baseY, r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,230,150,0.95)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,180,60,1)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // 👋 图标
            ctx.font = `${Math.floor(ts * 0.32)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('👋', px, baseY);

            // 小三角指向 NPC
            ctx.beginPath();
            ctx.moveTo(px - 4, baseY + r + 1);
            ctx.lineTo(px + 4, baseY + r + 1);
            ctx.lineTo(px, baseY + r + 6);
            ctx.closePath();
            ctx.fillStyle = 'rgba(255,180,60,1)';
            ctx.fill();
        },
        // ============================================================
        // ★ 立绘绘制：cover 裁切 + 圆角 + 描边
        // ============================================================
        _drawPortraitSprite(ctx, ent, drawX, drawY, drawW, drawH, img) {
            const iw = img.naturalWidth || img.width;
            const ih = img.naturalHeight || img.height;
            if (!iw || !ih) return;

            // 目标区域宽高比
            const targetRatio = drawW / drawH;
            const imgRatio = iw / ih;

            let sx, sy, sw, sh;
            if (imgRatio > targetRatio) {
                // 图更宽 → 裁左右
                sh = ih;
                sw = ih * targetRatio;
                sx = (iw - sw) / 2;
                sy = 0;
            } else {
                // 图更高 → 裁上下（偏上，保留头部）
                sw = iw;
                sh = iw / targetRatio;
                sx = 0;
                sy = Math.max(0, (ih - sh) * 0.15);
            }

            // 圆角矩形裁切
            const r = Math.min(drawW, drawH) * 0.18;
            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(drawX, drawY, drawW, drawH, r);
            } else {
                ctx.rect(drawX, drawY, drawW, drawH);
            }
            ctx.clip();
            ctx.drawImage(img, sx, sy, sw, sh, drawX, drawY, drawW, drawH);
            ctx.restore();

            // 描边
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(drawX, drawY, drawW, drawH, r);
            } else {
                ctx.rect(drawX, drawY, drawW, drawH);
            }
            ctx.strokeStyle = ent.kind === 'npc'
                ? 'rgba(255,215,140,0.9)'
                : 'rgba(255,140,140,0.9)';
            ctx.lineWidth = 2;
            ctx.stroke();
        },

        // ★ 立绘 Image 缓存：url → HTMLImageElement
        _portraitImages: new Map(),

        _getPortraitImage(url) {
            if (!url) return null;

            const cached = this._portraitImages.get(url);
            if (cached) {
                return (cached.complete && cached.naturalWidth > 0) ? cached : null;
            }

            const img = new Image();
            img.onerror = () => { this._portraitImages.delete(url); };
            img.src = url;
            this._portraitImages.set(url, img);

            return (img.complete && img.naturalWidth > 0) ? img : null;
        },
        // ============================================================
        // ★ 昼夜滤镜：只读缓存，零计算
        //   缓存由 DayNightFilter 在 cw:env-hour 时更新
        // ============================================================
        // 一次性缓存
        _dayNightTextureCache: null,
        _dayNightTextureKey: null,

        _renderDayNight(ctx) {
            const playMode = window.CinemaWorld?.worldState?.playMode;
            if (playMode !== 'map') return;

            const filter = window.DayNightFilter?.getCurrent?.();
            if (!filter) return;

            const { r, g, b, alpha } = filter;
            if (alpha <= 0.01) return;

            // 颜色或 alpha 变化不大时，用缓存贴图
            const key = `${r}|${g}|${b}`;
            if (this._dayNightTextureKey !== key) {
                // 生成一次 128×128 的径向渐变
                const size = 128;
                const cv = document.createElement('canvas');
                cv.width = cv.height = size;
                const c = cv.getContext('2d');
                const grd = c.createRadialGradient(
                    size / 2, size / 2, 0,
                    size / 2, size / 2, size / 2
                );
                // 注意：alpha 分开处理，贴图只存颜色 + 渐变透明度
                grd.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.85)`);
                grd.addColorStop(1, `rgba(${r}, ${g}, ${b}, 1)`);
                c.fillStyle = grd;
                c.fillRect(0, 0, size, size);

                this._dayNightTextureCache = cv;
                this._dayNightTextureKey = key;
            }

            // ★ 用 globalAlpha 控制 alpha，贴图缩放填充
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            ctx.globalAlpha = alpha;
            ctx.drawImage(
                this._dayNightTextureCache,
                0, 0, this._cssW, this._cssH
            );
            ctx.restore();
        },
        // ============================================================
        // ★ 主线点金色标记
        // ============================================================
        _drawMainQuestMarker(ctx, x, y, ts, now, label) {
            const r = ts * 0.35;   // ★ 固定

            // 金色光晕
            const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
            glow.addColorStop(0, 'rgba(255,220,100,0.9)');
            glow.addColorStop(0.4, 'rgba(255,180,60,0.5)');
            glow.addColorStop(1, 'rgba(255,180,60,0)');
            ctx.beginPath();
            ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();

            // ❗ 图标
            ctx.font = `${Math.floor(ts * 0.6)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('❗', x, y);

            // 标题标签
            if (label) {
                ctx.font = `bold ${Math.floor(ts * 0.24)}px sans-serif`;
                const tw = ctx.measureText(label).width;
                const boxW = tw + 12;
                const boxH = ts * 0.34;
                const bx = x - boxW / 2;
                const by = y - ts * 0.7;

                ctx.fillStyle = 'rgba(60,40,10,0.9)';
                ctx.strokeStyle = 'rgba(255,215,100,0.9)';
                ctx.lineWidth = 1.5;
                if (ctx.roundRect) {
                    ctx.beginPath();
                    ctx.roundRect(bx, by, boxW, boxH, 5);
                    ctx.fill();
                    ctx.stroke();
                } else {
                    ctx.fillRect(bx, by, boxW, boxH);
                    ctx.strokeRect(bx, by, boxW, boxH);
                }
                ctx.fillStyle = '#ffd76b';
                ctx.fillText(label, x, by + boxH / 2);
            }
        },
        // ============================================================
        // 对外 API
        // ============================================================
        getPlayer() {
            return this.player ? { x: this.player.x, y: this.player.y } : null;
        },

        getCurrentRegion() {
            if (!this._currentRegionId) return null;
            return this.map.regions.find(r => r.id === this._currentRegionId) || null;
        },

        addEntity(ent) {
            const placed = MapLayout._resolvePosition(
                ent, this.map._generated.grid, this.map._generated.placements, new Set()
            );
            if (placed) {
                ent.x = placed.x; ent.y = placed.y; ent._placed = true;
            }
            this.map.entities.push(ent);
            window.MapLauncher?._saveMap?.();
        },

        removeEntity(id) {
            const idx = this.map.entities.findIndex(e => e.id === id);
            if (idx >= 0) this.map.entities.splice(idx, 1);
            window.MapLauncher?._saveMap?.();
        },

        getEntityAt(x, y) {
            return this.map.entities.find(e => e._placed && e.x === x && e.y === y);
        },
    };

    // ============================================================
    // 3. 启动器
    // ============================================================
    const MapLauncher = {
        _map: null,
        _subState: null,

        _getMapStore() {
            const ws = window.CinemaWorld?.worldState;
            if (!ws) return null;
            ws.maps = ws.maps || {};
            ws.mapRules = ws.mapRules || {};
            return ws.maps;
        },

        _getRuleStore() {
            const ws = window.CinemaWorld?.worldState;
            if (!ws) return null;
            ws.mapRules = ws.mapRules || {};
            return ws.mapRules;
        },

        saveRule(ruleName, rule) {
            const store = this._getRuleStore();
            if (!store) return;
            store[ruleName] = {
                name: ruleName,
                description: rule.description || '',
                regions: rule.regions,
                connections: rule.connections,
                entities: rule.entities,
                _rawText: rule._rawText || null,
                _savedAt: Date.now(),
            };
        },

        getRule(ruleName) {
            const store = this._getRuleStore();
            return store ? store[ruleName] || null : null;
        },

        listRules() {
            const store = this._getRuleStore();
            return store ? Object.values(store) : [];
        },

        deleteRule(ruleName) {
            const store = this._getRuleStore();
            if (store) delete store[ruleName];
        },

        reset() {
            if (window.MapCanvas?.canvas) {
                try { window.MapCanvas.destroy(); } catch (e) { }
            }
            this._map = null;
            this._subState = null;
            const ws = window.CinemaWorld?.worldState;
            if (ws) {
                ws.maps = {};
                ws.currentMapName = null;
            }
        },

        // ============================================================
        // 存档 / 读档
        // ============================================================
        _saveMapToWorld(map) {
            const store = this._getMapStore();
            if (!store || !map) return;

            if (!map.id || /^map_\d+$/.test(map.id)) map.id = `map_${map.name}`;

            const serialized = window.MapSchema.serialize(map);
            if (window.MapCanvas?.player && window.MapCanvas.map === map) {
                serialized._playerPos = {
                    x: window.MapCanvas.player.x,
                    y: window.MapCanvas.player.y,
                };
                serialized._camera = {
                    x: window.MapCanvas.camera.x,
                    y: window.MapCanvas.camera.y,
                    tileSize: window.MapCanvas.config.tileSize,
                };
                serialized._currentRegionId = window.MapCanvas._currentRegionId || null;
            }

            store[map.name] = serialized;
            window.CinemaWorld.worldState.currentMapName = map.name;
        },

        _loadMapFromWorld(name) {
            const store = this._getMapStore();
            if (!store) return null;
            const data = store[name];
            if (!data) return null;

            try {
                const map = window.MapSchema.deserialize(data, window.WorldManager);
                if (!map) return null;
                if (!map._generated) window.MapLayout.build(map);
                // ★ 重建 plotId → grid 绑定
                if (map._plots && window.MapPlotManager) {
                    for (const plot of Object.values(map._plots)) {
                        window.MapPlotManager._applyPlotToGrid(map, plot);
                    }
                    window.MapPlotManager.markDirty();
                }
                // _loadMapFromWorld 里，deserialize 之后
                if (window.CWEnv && map._environment) {
                    // 不立即 catchUp，等 _renderMapWindow 里再算
                    // 但保证 env 结构完整
                    window.CWEnv.ensureEnvData(map);
                }
                if (data._playerPos && map.entities) {
                    const player = map.entities.find(e => e.isPlayer);
                    if (player && map._generated) {
                        player.x = data._playerPos.x;
                        player.y = data._playerPos.y;
                        player._placed = true;
                    }
                }
                map._savedCamera = data._camera || null;
                map._savedRegionId = data._currentRegionId || null;
                return map;
            } catch (e) {
                console.warn('[MapLauncher] 地图读取失败:', e);
                return null;
            }
        },

        // ============================================================
        // 打开
        // ============================================================
        async open(options = {}) {
            if (this._map && !options.forceRegenerate) {
                this._renderMapWindow();
                return;
            }

            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            if (!options.forceRegenerate) {
                const ws = window.CinemaWorld?.worldState;
                const currentName = ws?.currentMapName;
                if (currentName) {
                    const map = this._loadMapFromWorld(currentName);
                    if (map) {
                        this._map = map;
                        this._renderMapModal(modal);
                        return;
                    }
                }
            }

            if (!options.forceRegenerate) {
                if (this._restoreFromScene()) {
                    this._saveMapToWorld(this._map);
                    this._renderMapModal(modal);
                    return;
                }
            }

            this._renderGenerateModal(modal, options);
        },

        _saveMap() {
            if (!this._map) return;
            this._saveMapToWorld(this._map);
            if (window.SaveManager) window.SaveManager.save();
        },

        _restoreFromScene() {
            const sceneName = window.CinemaWorld?.ui?.currentLocation;
            if (!sceneName) return false;
            const scene = window.WorldManager?.findEntity?.(sceneName);
            if (!scene?.map) return false;

            try {
                const map = window.MapSchema.deserialize(scene.map, window.WorldManager);
                if (!map) return false;
                this._map = map;
                if (!map._generated) window.MapLayout.build(map);
                return true;
            } catch (e) {
                return false;
            }
        },
        _renderMapModal(modal) {
            // ★ 兼容旧调用：现在转发到地图窗口
            this._renderMapWindow();
        },
        // ============================================================
        // 子面板
        // ============================================================
        _openSubPanel(html) {
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            // ★ modal 直接打开，叠在地图上
            modal.className = 'active';
            modal.innerHTML = html;
        },

        _closeSubPanel() {
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            // ★ 只关 modal，地图还在下面
            modal.classList.remove('active');
            modal.innerHTML = '';
            modal.style.width = '';
            modal.style.maxWidth = '';
            modal.style.maxHeight = '';
            modal.style.padding = '';
            modal.style.overflowY = '';
            modal.style.boxSizing = '';
        },

        _saveMapState() {
            if (!window.MapCanvas?.canvas) return null;
            return {
                map: this._map,
                playerX: window.MapCanvas.player?.x,
                playerY: window.MapCanvas.player?.y,
                cameraX: window.MapCanvas.camera?.x,
                cameraY: window.MapCanvas.camera?.y,
                currentRegionId: window.MapCanvas._currentRegionId,
            };
        },

        _restoreMapState(state) {
            if (!state || !state.map) return;
            this._map = state.map;
            this._renderMapModal(document.getElementById('cinemaworld-modal'));

            setTimeout(() => {
                if (window.MapCanvas.player) {
                    window.MapCanvas.player.x = state.playerX;
                    window.MapCanvas.player.y = state.playerY;
                    window.MapCanvas.camera.x = state.cameraX;
                    window.MapCanvas.camera.y = state.cameraY;
                    window.MapCanvas._currentRegionId = state.currentRegionId;
                    window.MapCanvas._centerCameraOnPlayer(true);
                }
            }, 0);
        },

        // ============================================================
        // 进入场景
        // ============================================================
        async _enterSceneFromMap() {
            const map = this._map;
            if (!map) return;

            const region = window.MapCanvas.getCurrentRegion();
            if (!region) {
                window.UIManager.showText('你不在任何区域', 1500);
                return;
            }

            if (region.sceneName) {
                const scene = window.WorldManager.findEntity(region.sceneName);
                if (scene) { this._openSceneFromMap(scene, region); return; }
                region.sceneName = null;
            }

            await this._generateSceneForRegion(map, region);
        },

        _openSceneFromMap(scene, region) {
            window.CinemaWorld.worldState.playMode = 'scene';
            // ★ 清地图音乐
            if (window.MusicManager) {
                window.MusicManager.setMapMusic(null);
            }

            const map = this._map;
            scene.mapRef = { mapName: map.name, regionId: region.id, exitAnchor: 'entrance' };
            map.scenes = map.scenes || {};
            map.scenes[scene.name] = scene;

            this._saveMapToWorld(map);
            window.UIManager.closeModal();
            if (window.MapCanvas.canvas) window.MapCanvas.destroy();
            window.LocationModalManager.doEnterScene(scene);
            if (window.SaveManager) window.SaveManager.save();
        },

        async _generateSceneForRegion(map, region) {
            window.CinemaWorld.worldState.playMode = 'scene';
            if (window.MusicManager) {
                window.MusicManager.setMapMusic(null);
            }
            const modal = document.getElementById('cinemaworld-modal');
            const prompt = this._buildScenePromptFromMap(map, region);

            modal.className = 'active';
            modal.style.width = 'min(960px, 96vw)';
            modal.style.maxWidth = 'none';
            modal.style.maxHeight = '94vh';
            modal.style.padding = '24px 28px';
            modal.style.overflowY = 'auto';
            modal.style.boxSizing = 'border-box';

            modal.innerHTML = `
                <div class="cinemaworld-modal-title" style="font-size:22px;">🏠 生成场景</div>
                <div style="font-size:13px;color:#aaa;line-height:1.7;margin-bottom:14px;
                    padding:12px;background:rgba(120,150,255,.08);border-radius:10px;">
                    为区域 <b style="color:#7da8ff;">${region.name}</b> 生成一个室内/近景场景。<br>
                    AI 会延续这个区域已有的 NPC 和物品。
                </div>
                <div style="font-size:13px;color:#888;margin-bottom:14px;">⏳ 正在生成中...</div>
            `;

            try {
                const raw = await window.generateFunctionalReply(prompt, 'scene-generation');
                if (!raw) {
                    window.UIManager.showText('❌ 场景生成失败', 2000);
                    this._renderMapModal(modal);
                    return;
                }

                const scene = window.WorldManager.parseScene(raw);
                if (!scene || !scene.name) {
                    window.UIManager.showText('❌ 场景解析失败', 2000);
                    this._renderMapModal(modal);
                    return;
                }

                let sceneName = scene.name;
                let suffix = 1;
                while (window.WorldManager.findEntity(sceneName)) {
                    sceneName = `${scene.name}(${suffix++})`;
                }
                scene.name = sceneName;

                scene.mapRef = { mapName: map.name, regionId: region.id, exitAnchor: 'entrance' };
                window.WorldManager.addSceneFromParsed(scene);

                region.sceneName = scene.name;
                map.scenes = map.scenes || {};
                map.scenes[scene.name] = scene;

                this._saveMapToWorld(map);
                if (window.SaveManager) window.SaveManager.save();

                window.UIManager.closeModal();
                if (window.MapCanvas.canvas) window.MapCanvas.destroy();
                await window.LocationModalManager.doEnterScene(scene);
                window.UIManager.showText(`🏠 进入【${scene.name}】`, 2000);
            } catch (e) {
                console.error('[MapLauncher] 场景生成失败:', e);
                window.UIManager.showText('❌ 场景生成失败：' + e.message, 3000);
                this._renderMapModal(modal);
            }
        },

        _buildScenePromptFromMap(map, region) {
            const parts = [];
            parts.push(`你正在为视觉小说游戏生成一个场景。`);
            parts.push(`\n【所属地图】${map.name}`);
            if (map.description) parts.push(`地图描述：${map.description}`);
            parts.push(`\n【当前区域】${region.name}（${region.type}）`);
            if (region.description) parts.push(`区域描述：${region.description}`);
            if (region.terrain) parts.push(`地形：${region.terrain}`);

            const ents = map.entities.filter(e =>
                e.region === region.id && !e.isPlayer && e.kind !== 'portal'
            );
            if (ents.length) {
                parts.push(`\n【这个区域已有的实体】（生成场景时必须延续它们）`);
                for (const e of ents) {
                    if (e.kind === 'npc') {
                        if (!e.name || /路人|村民|行人|群众|士兵甲|卫兵甲/.test(e.name)) continue;
                        parts.push(`- 人物：${e.emoji} ${e.name}（${e.meta?.gender || '未知'}，${e.meta?.mood || '平静'}）`);
                        if (e.description) parts.push(`  描述：${e.description}`);
                    } else if (e.kind === 'item') {
                        parts.push(`- 物品：${e.emoji} ${e.name}`);
                        if (e.description) parts.push(`  描述：${e.description}`);
                    } else if (e.kind === 'marker') {
                        parts.push(`- 标记：${e.emoji} ${e.name}`);
                    }
                }
            }

            parts.push(`\n【任务】`);
            parts.push(`为这个区域生成一个室内/近景场景。`);
            parts.push(`- 场景名用「${region.name}-室内」这样的格式`);
            parts.push(`- 场景人物必须包含上面列出的 NPC，可以再加 1-2 个新角色`);
            parts.push(`- 场景实体要延续上面的物品和标记`);
            parts.push(`- 场景氛围要和区域的类型、地形、描述一致`);
            parts.push(`\n【输出格式】`);
            parts.push(`严格使用以下格式：

*【场景名】*
描述：(场景的详细描述)
环境：(场景的环境特征)
环境数据:[时间:具体时间|天气:具体天气|温度:具体温度]
背景：(背景图片名)
🎵 音乐：音乐名

场景人物：
- 【人物名|性别|心情|好感度|状态|主次】：人物描述，[标签1、标签2]

场景实体：
- 【实体名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]

场景行动：
- 【行动名|图标|once】：这个行动能做什么

请开始生成：`);

            return parts.join('\n');
        },

        // ============================================================
        // 生成面板
        // ============================================================
        _renderGenerateModal(modal, options) {
            const scene = window.LocationModalManager?.currentLocation;
            const savedGuide = options.guide || '';

            modal.className = 'active cw-map-modal';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title" style="font-size:22px;">🗺️ 生成地图</div>
                <div style="font-size:13px;color:#aaa;line-height:1.7;margin-bottom:14px;
                    padding:12px;background:rgba(120,150,255,.08);border-radius:10px;">
                    AI 只生成<b>地图规则</b>（区域、连接、实体）。<br>
                    实际的网格、道路、实体摆放由程序完成。
                </div>
                ${scene ? `<div style="font-size:13px;color:#888;margin-bottom:14px;">
                    📍 当前场景：<span style="color:#7da8ff;">${scene.name}</span>
                </div>` : ''}
                <div style="margin-bottom:14px;">
                    <div style="font-size:14px;color:#aaa;margin-bottom:6px;">描述你想要的地图（可选）：</div>
                    <textarea class="cinemaworld-textarea" id="cw-map-guide"
                        placeholder="例如：&#10;- 一个被森林包围的小镇，中央有广场&#10;- 附近有酒馆、商店、守卫塔"
                        style="min-height:110px;font-size:14px;">${savedGuide}</textarea>
                </div>
                <div id="cw-map-result" style="display:none;margin-bottom:14px;">
                    <div style="font-size:14px;color:#aaa;margin-bottom:6px;">AI 返回的地图规则（可编辑）：</div>
                    <textarea class="cinemaworld-textarea" id="cw-map-text"
                        style="min-height:340px;font-family:monospace;font-size:12px;"></textarea>
                </div>
                <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" id="cw-map-gen-btn">🤖 AI 生成地图规则</button>
                    <button class="cinemaworld-button primary" id="cw-map-confirm-btn" style="display:none;">✅ 生成地图并进入</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;

            document.getElementById('cw-map-gen-btn').onclick = () => this._generate();
            document.getElementById('cw-map-confirm-btn').onclick = () => this._confirm();
        },

        async _generate() {
            const btn = document.getElementById('cw-map-gen-btn');
            const guide = document.getElementById('cw-map-guide')?.value.trim() || '';
            btn.disabled = true;
            btn.innerHTML = '⏳ 生成中...';

            try {
                const map = await window.MapGenerator.generate({ guide });
                if (!map) {
                    window.UIManager.showText('❌ 地图规则生成失败', 2000);
                    return;
                }
                this._pendingMap = map;
                document.getElementById('cw-map-text').value = map._rawText || this._mapToText(map);
                document.getElementById('cw-map-result').style.display = 'block';
                document.getElementById('cw-map-confirm-btn').style.display = 'inline-block';

                if (map._check && !map._check.ok) {
                    window.UIManager.showText(
                        `⚠️ 地图有 ${map._check.errors.length} 个问题，可编辑后确认`, 3000
                    );
                }
            } finally {
                btn.disabled = false;
                btn.innerHTML = '🤖 AI 生成地图规则';
            }
        },

        async _confirm() {
            const textarea = document.getElementById('cw-map-text');
            if (!textarea) return;

            const parsed = window.MapParser.parse(textarea.value);
            if (!parsed) { alert('解析失败：请检查格式'); return; }

            const map = window.MapSchema.normalize(parsed);
            const check = window.MapSchema.validate(map);
            if (!check.ok) {
                if (!confirm('地图有以下问题，仍要继续吗？\n\n' + check.errors.join('\n'))) return;
            }

            window.MapLayout.build(map);
            this._ensureExitPortal(map);
            this._map = map;
            this._saveMapToWorld(map);

            window.UIManager.closeModal();
            this._renderMapModal(document.getElementById('cinemaworld-modal'));
            window.UIManager.showText(`🗺️ 地图「${map.name}」已生成`, 2000);
        },

        // ============================================================
        // 自动补出入口
        // ============================================================
        _ensureExitPortal(map) {
            if (!map?.entities) return;
            const hasMapPortal = map.entities.some(e =>
                e.kind === 'portal' && e.fields?.['目标类型'] === 'map'
            );
            if (hasMapPortal) return;

            const usedRegions = new Set(
                map.entities.filter(e => e.kind === 'portal').map(e => e.region)
            );
            let region = map.regions.find(r => !usedRegions.has(r.id))
                || map.regions[map.regions.length - 1];
            if (!region) return;

            const targetMapName = `${map.name}_外`;

            const portal = {
                id: `portal_auto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: '通往远方的小路',
                emoji: '🚪',
                kind: 'portal',
                region: region.id,
                position: 'edge',
                blocking: false,
                isPlayer: false,
                tags: ['自动生成'],
                description: '一条通向未知区域的小路，隐约能看到远处的轮廓。',
                meta: {}, status: '', effect: '',
                fields: {
                    '目标类型': 'map',
                    '目标': targetMapName,
                    '目标区域': 'entrance',
                    '目标锚点': 'entrance',
                    '方向': 'both',
                    '提示': '沿小路走向未知',
                },
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1, countMode: 'single', stackable: false, maxStack: null,
                type: 'portal',
            };

            // 立刻摆放
            const grid = map._generated?.grid;
            const placements = map._generated?.placements;
            if (grid && placements) {
                const used = new Set(
                    map.entities.filter(e => e._placed).map(e => `${e.x},${e.y}`)
                );
                const pos = MapLayout._resolvePosition(portal, grid, placements, used);
                if (pos) {
                    portal.x = pos.x; portal.y = pos.y; portal._placed = true;
                } else {
                    portal._placed = false;
                }
            }

            map.entities.push(portal);
        },

        // ============================================================
        // 地图面板
        // ============================================================
        _renderMapWindow() {
            window.CinemaWorld.worldState.playMode = 'map';
            window.Map3DUI?.onMapWillChange?.();
            if (window.CWEnv) {
                window.CWEnv.initMapEnvironment(this._map);
            }

            const win = document.getElementById('cinemaworld-map-window');
            if (!win) return;

            this._applyMapBackground(this._map);

            win.innerHTML = `
                <div style="position:relative;width:100%;height:100%;display:flex;
                    flex-direction:column;align-items:center;justify-content:center;
                    padding:16px;box-sizing:border-box;">
        
                    <!-- ★ 地图容器（占满剩余空间） -->
                    <div id="cw-map-canvas-container"
                         style="display:flex;justify-content:center;align-items:center;
                                width:100%;height:100%;overflow:hidden;
                                flex:1;min-height:0;"></div>
        
                    <!-- ★ 浮动标题（3 秒后消失） -->
                    <div id="cw-map-title-float" style="
                        position:absolute;top:20px;left:50%;
                        transform:translate(-50%,-10px);
                        padding:10px 24px;
                        background:rgba(20,22,34,.92);
                        border:1px solid rgba(140,180,255,.35);
                        border-radius:12px;
                        box-shadow:0 8px 24px rgba(0,0,0,.5);
                        backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
                        color:#fff;z-index:100;opacity:0;
                        transition:opacity .4s ease,transform .4s ease;
                        pointer-events:none;text-align:center;max-width:80%;
                    ">
                        <div style="font-size:16px;font-weight:700;">🗺️ <span id="cw-map-title-text"></span></div>
                        <div id="cw-map-desc-text" style="font-size:12px;color:#8898b8;margin-top:4px;"></div>
                    </div>
        
                    <!-- ★ 操作提示（首次进图显示 4 秒） -->
                    <div id="cw-map-hint-float" style="
                        position:absolute;top:50%;left:50%;
                        transform:translate(-50%,-50%) scale(.95);
                        padding:14px 26px;
                        background:rgba(20,22,34,.88);
                        border:1px solid rgba(140,180,255,.25);
                        border-radius:10px;
                        color:#a8c4ff;font-size:13px;line-height:1.9;text-align:center;
                        backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
                        box-shadow:0 8px 24px rgba(0,0,0,.5);
                        z-index:100;opacity:0;
                        transition:opacity .4s ease,transform .4s ease;
                        pointer-events:none;
                    ">
                        <div style="font-size:15px;color:#fff;margin-bottom:6px;font-weight:600;">🎮 操作提示</div>
                        <div>方向键 / WASD 移动 · 点击寻路</div>
                        <div>靠近 NPC 交互 · 滚轮缩放</div>
                    </div>
        
                    <!-- ★ 当前区域（切区域浮 2 秒） -->
                    <div id="cw-map-current-region" style="
                        position:absolute;top:20px;right:20px;
                        padding:8px 16px;
                        background:rgba(20,22,34,.9);
                        border:1px solid rgba(125,168,255,.4);
                        border-radius:10px;
                        color:#7da8ff;font-size:13px;font-weight:600;
                        backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
                        box-shadow:0 4px 16px rgba(0,0,0,.4);
                        z-index:100;opacity:0;
                        transform:translateX(8px);
                        transition:opacity .35s ease,transform .35s ease;
                        pointer-events:none;white-space:nowrap;
                    "></div>
        
                    <!-- ★ 底部按钮栏 -->
                    <div style="text-align:center;display:flex;justify-content:center;
                                gap:8px;flex-wrap:wrap;margin-top:10px;">
                        <button id="cw-map-zoom-in" class="cinemaworld-button"
                            style="width:40px;height:40px;padding:0;font-size:20px;">＋</button>
                        <button id="cw-map-zoom-out" class="cinemaworld-button"
                            style="width:40px;height:40px;padding:0;font-size:20px;">－</button>
                        <button id="cw-map-zoom-reset" class="cinemaworld-button"
                            style="width:40px;height:40px;padding:0;font-size:14px;">⟲</button>
                        <button class="cinemaworld-button primary" id="cw-map-enter-scene-btn">🏠 进入场景</button>
                        <button class="cinemaworld-button" id="cw-map-quests-btn">📜 任务</button>
                        <button class="cinemaworld-button" id="cw-map-reroll-btn">🎲 刷新外观</button>
                        <button class="cinemaworld-button" id="cw-map-list-btn">📋 实体列表</button>
                        <button class="cinemaworld-button" id="cw-map-plot-btn">📐 划地</button>
                        <button class="cinemaworld-button" id="cw-map-world-btn">🗺️ 世界地图</button>
                        <button class="cinemaworld-button" onclick="MapLauncher.closeMap()">关闭地图</button>
                    </div>
                </div>
            `;

            // ============================================================
            // 按钮绑定
            // ============================================================
            document.getElementById('cw-map-zoom-in')?.addEventListener('click', () => window.MapCanvas.zoomIn());
            document.getElementById('cw-map-zoom-out')?.addEventListener('click', () => window.MapCanvas.zoomOut());
            document.getElementById('cw-map-zoom-reset')?.addEventListener('click', () => window.MapCanvas.resetZoom());

            document.getElementById('cw-map-quests-btn')?.addEventListener('click', () => {
                window.MapQuestManager?.openQuestList?.();
            });
            document.getElementById('cw-map-world-btn')?.addEventListener('click', () => {
                window.MapManagerPanel?.open?.();
            });
            document.getElementById('cw-map-plot-btn')?.addEventListener('click', () => {
                window.MapPlotManager?.openList?.();
            });
            document.getElementById('cw-map-list-btn')?.addEventListener('click', () => {
                if (window.MapEntityPanel?.openList) window.MapEntityPanel.openList();
                else this._showEntityList();
            });
            document.getElementById('cw-map-reroll-btn')?.addEventListener('click', () => {
                if (!confirm('刷新整张地图所有 NPC 的外观？')) return;
                window.MapSprites?.rerollAll?.(this._map);
                window.UIManager.showText('🎲 已刷新整张地图外观', 1500);
            });

            // 进入场景按钮
            const enterBtn = document.getElementById('cw-map-enter-scene-btn');
            if (enterBtn) {
                const update = () => {
                    const region = window.MapCanvas.getCurrentRegion();
                    if (!region) {
                        enterBtn.textContent = '🏠 进入场景';
                        enterBtn.disabled = true;
                        enterBtn.style.opacity = '0.5';
                        return;
                    }
                    enterBtn.disabled = false;
                    enterBtn.style.opacity = '1';
                    if (region.sceneName && window.WorldManager.findEntity(region.sceneName)) {
                        enterBtn.textContent = `🏠 进入「${region.sceneName}」`;
                    } else {
                        enterBtn.textContent = `🏠 生成「${region.name}」场景`;
                    }
                };
                update();
                this._regionHandlerForBtn && window.removeEventListener('cw:map-region-change', this._regionHandlerForBtn);
                this._regionHandlerForBtn = update;
                window.addEventListener('cw:map-region-change', this._regionHandlerForBtn);
                enterBtn.onclick = () => this._enterSceneFromMap();
            }

            // ============================================================
            // 2D canvas
            // ============================================================
            const container = document.getElementById('cw-map-canvas-container');
            if (window.MapCanvas.canvas) window.MapCanvas.destroy();
            window.MapCanvas.init(container, this._map, {
                onEntityNear: (ent) => this._onEntityNear(ent),
            });

            window.MapNPCWander?.resetApproachState?.();

            if (window.CharacterRegistry?.syncFromMap) {
                window.CharacterRegistry.syncFromMap(this._map);
            }
            if (window.SceneAvatarBarManager) {
                window.SceneAvatarBarManager.build();
            }
            if (window.CWEnv) {
                window.CWEnv.initMapEnvironment(this._map);
                window.DayNightFilter?.refresh?.();
            }

            // 恢复相机
            if (this._map._savedCamera?.tileSize) {
                window.MapCanvas.config.tileSize = this._map._savedCamera.tileSize;
            }
            if (this._map._savedCamera) {
                window.MapCanvas.camera.x = this._map._savedCamera.x;
                window.MapCanvas.camera.y = this._map._savedCamera.y;
                window.MapCanvas._centerCameraOnPlayer(true);
            }
            if (this._map._savedRegionId) {
                window.MapCanvas._currentRegionId = this._map._savedRegionId;
                const region = this._map.regions.find(r => r.id === this._map._savedRegionId);
                const el = document.getElementById('cw-map-current-region');
                if (el && region) {
                    el.textContent = `📍 ${region.name}（${region.type}）`;
                }
            }

            // 区域切换监听
            this._bindRegionHandler();

            // ============================================================
            // ★ 浮动标题（3 秒）
            // ============================================================
            const titleFloat = document.getElementById('cw-map-title-float');
            const titleText = document.getElementById('cw-map-title-text');
            const descText = document.getElementById('cw-map-desc-text');
            if (titleFloat && titleText) {
                titleText.textContent = this._map.name || '';
                descText.textContent = this._map.description || '';

                requestAnimationFrame(() => {
                    titleFloat.style.opacity = '1';
                    titleFloat.style.transform = 'translate(-50%, 0)';
                });

                if (this._titleTimer) clearTimeout(this._titleTimer);
                this._titleTimer = setTimeout(() => {
                    titleFloat.style.opacity = '0';
                    titleFloat.style.transform = 'translate(-50%, -10px)';
                }, 3000);
            }

            // ============================================================
            // ★ 操作提示（首次进图）
            // ============================================================
            const hintFloat = document.getElementById('cw-map-hint-float');
            if (hintFloat && !localStorage.getItem('cw_map_hint_shown')) {
                requestAnimationFrame(() => {
                    hintFloat.style.opacity = '1';
                    hintFloat.style.transform = 'translate(-50%, -50%) scale(1)';
                });
                if (this._hintTimer) clearTimeout(this._hintTimer);
                this._hintTimer = setTimeout(() => {
                    hintFloat.style.opacity = '0';
                    hintFloat.style.transform = 'translate(-50%, -50%) scale(0.95)';
                    localStorage.setItem('cw_map_hint_shown', '1');
                }, 4000);
            }

            // 音乐
            if (window.MusicManager && this._map) {
                window.MusicManager.setMapMusic(this._map.music || null);
            }

            // 广播
            window.dispatchEvent(new CustomEvent('cw:map-opened', {
                detail: { map: this._map }
            }));
            window.Map3DUI?.onMapChanged?.();
            // 显示窗口
            win.classList.add('active');
        },

        async _applyMapBackground(map) {
            if (!map) return;

            // 1. 优先用生成的背景
            if (map.generatedBackgroundId && window.BackgroundGenerator) {
                const ok = await window.BackgroundGenerator.restoreMapBackground(map);
                if (ok) return;
            }

            // 2. 用地图自带的 background 字段
            if (map.background && window.BackgroundManager) {
                await window.BackgroundManager.apply(map.background);
                return;
            }

            // 3. 没有 → 清空
            if (window.BackgroundManager) {
                window.BackgroundManager.clear();
            }
        },
        _bindRegionHandler() {
            this._regionHandler && window.removeEventListener('cw:map-region-change', this._regionHandler);

            this._regionHandler = (e) => {
                const region = e.detail;
                const el = document.getElementById('cw-map-current-region');
                if (!el || !region) return;

                el.textContent = `📍 ${region.name}（${region.type}）`;
                el.style.opacity = '1';
                el.style.transform = 'translateX(0)';

                if (this._regionTimer) clearTimeout(this._regionTimer);
                this._regionTimer = setTimeout(() => {
                    el.style.opacity = '0';
                    el.style.transform = 'translateX(8px)';
                }, 2000);
            };

            window.addEventListener('cw:map-region-change', this._regionHandler);
        },

        closeMap() {
            // ★ 先把地图环境写回场景
            this._syncMapEnvToScene();
            if (this._titleTimer) clearTimeout(this._titleTimer);
            if (this._hintTimer) clearTimeout(this._hintTimer);
            if (this._regionTimer) clearTimeout(this._regionTimer);
            // 切回场景模式
            if (window.CinemaWorld) {
                window.CinemaWorld.worldState.playMode = 'scene';
            }
            this._saveMap();
            if (window.MusicManager) {
                window.MusicManager.setMapMusic(null);
            }
            const win = document.getElementById('cinemaworld-map-window');
            if (win) win.classList.remove('active');
            if (window.MapCanvas.canvas) window.MapCanvas.destroy();

            // 刷新头像栏（之前加过）
            if (window.SceneAvatarBarManager) {
                window.SceneAvatarBarManager.build();
            }
            window.dispatchEvent(new CustomEvent('cw:map-closed'));
        },

        // ★ 新增：地图环境 → 场景环境
        _syncMapEnvToScene() {
            const map = this._map;
            const scene = window.LocationModalManager?.currentLocation;
            if (!map || !scene) return;

            const env = window.CWEnv?.ensureEnvData?.(map);
            if (!env?._order?.length) return;

            scene.environmentData = scene.environmentData || { _order: [], _raw: '' };
            const target = scene.environmentData;

            // 把地图环境的字段全量覆盖到场景（不删场景独有字段）
            for (const k of env._order) {
                if (k.startsWith('_')) continue;
                if (env[k] === undefined || env[k] === '') continue;
                target[k] = env[k];
                if (!target._order.includes(k)) target._order.push(k);
            }

            // 重建 _raw
            target._raw = target._order
                .filter(k => target[k] !== undefined && target[k] !== '')
                .map(k => `${k}:${target[k]}`)
                .join('|');

            console.log('[MapLauncher] 地图环境已写回场景:', scene.name);
        },

        _onEntityNear(ent) {
            const el = document.getElementById('cw-map-current-region');
            if (el) el.textContent = `👋 附近：${ent.name}（${ent.kind}）`;
        },

        _showEntityList() {
            const map = this._map;
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active cw-map-modal';

            let html = `<div class="cinemaworld-modal-title" style="font-size:22px;">📋 地图实体</div>`;
            html += `<div style="display:grid;gap:10px;max-height:65vh;overflow-y:auto;">`;

            for (const region of map.regions) {
                const ents = map.entities.filter(e => e.region === region.id && !e.isPlayer);
                if (ents.length === 0) continue;
                html += `
                    <div style="background:rgba(255,255,255,.04);border-radius:12px;padding:14px;">
                        <div style="font-size:14px;color:#7da8ff;margin-bottom:10px;">📍 ${region.name}</div>
                        <div style="display:flex;flex-wrap:wrap;gap:8px;">
                            ${ents.map(e => `<div style="padding:8px 12px;background:rgba(255,255,255,.06);
                                border-radius:8px;font-size:13px;color:#ddd;">${e.emoji} ${e.name}</div>`).join('')}
                        </div>
                    </div>`;
            }

            html += `</div>
                <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button" onclick="MapLauncher._renderMapModal(document.getElementById('cinemaworld-modal'))">← 返回地图</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.innerHTML = html;
        },

        _mapToText(map) {
            const lines = [];
            lines.push('【地图】');
            lines.push(`名称: ${map.name}`);
            if (map.description) lines.push(`描述: ${map.description}`);
            if (map.startRegion) lines.push(`起点: ${map.startRegion}`);
            lines.push('');
            lines.push('【区域】');
            for (const r of map.regions) {
                const tags = r.tags?.length ? `，[${r.tags.join('、')}]` : '';
                lines.push(`- 【${r.id}|${r.name}|${r.type}|${r.size}|${r.terrain}】：${r.description || ''}${tags}`);
            }
            lines.push('');
            if (map.connections.length) {
                lines.push('【连接】');
                for (const c of map.connections) {
                    lines.push(`- 【${c.from}|${c.to}|${c.direction}|${c.distance}|${c.kind}】`);
                }
                lines.push('');
            }
            lines.push('【实体】');
            const player = map.entities.find(e => e.isPlayer);
            if (player) {
                lines.push(`- 【player|玩家|${player.emoji}|player|${player.region}|${player.position}|no|-|-】：玩家，[]`);
            }
            for (const e of map.entities) {
                if (e.isPlayer || e.kind === 'building' || e.kind === 'item') continue;
                const tags = e.tags?.length ? `，[${e.tags.join('、')}]` : '';
                const block = e.blocking ? 'yes' : 'no';
                lines.push(`- 【${e.id}|${e.name}|${e.emoji}|${e.kind}|${e.region || ''}|${e.position}|${block}|${e.meta?.gender || '-'}|${e.meta?.mood || '-'}】：${e.description || ''}${tags}`);
            }
            return lines.join('\n');
        },

        getMap() { return this._map; },

        setMap(map) {
            this._map = window.MapSchema.normalize(map);
            if (!this._map._generated) window.MapLayout.build(this._map);
            this._saveMapToWorld(this._map);
        },

        findMapInWorld(name) { return this._loadMapFromWorld(name); },

        registerMap(map) {
            if (map?.name) this._saveMapToWorld(map);
        },
    };
    // ============================================================
    // ★ 全局工具：通知 3D 数据变化
    //   type:
    //     'entity-add'     新增实体
    //     'entity-remove'  删除实体（需 entityId）
    //     'entity-update'  更新实体（需 entityId）
    //     'plot-update'    更新玩法区（需 plotId）
    //     'all'            全量同步
    // ============================================================
    window.CWNotify3D = function (type, payload = {}) {
        if (!window.MapCanvas3D?._running) return;
        try {
            window.dispatchEvent(new CustomEvent('cw:3d-invalidate', {
                detail: { type, ...payload }
            }));
        } catch (e) {
            console.warn('[CWNotify3D] 广播失败:', e);
        }
    };
    window.MapLayout = MapLayout;
    window.MapCanvas = MapCanvas;
    window.MapLauncher = MapLauncher;

    console.log('[CinemaWorld] map-canvas.js 已加载');
})();