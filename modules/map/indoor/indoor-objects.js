// ============================================================
// CinemaWorld · indoor/indoor-objects.js
// 室内功能性家具：休息 / 娱乐 / 学习 / 仓储 / 宝箱
//   - 目录表：定义家具类型
//   - 运行时：交互逻辑（休息过时间、仓储、开箱）
//   - 摆放：build 后自动在区域里塞家具
//   - 2D：emoji 渲染；3D：程序绘制
//   - 交互：点击 → 弹面板，不走 AI 剧情
//
// 依赖：map-canvas.js, map-environment.js, player.js
// 暴露：window.IndoorObjects
// ============================================================

(function () {
    'use strict';

    if (window.IndoorObjects) return;

    // ============================================================
    // 0. 确定性随机数（同种子同序列）
    //    ★ 修复 BUG1：刷新后家具不再换位置
    // ============================================================
    function hashStr(s) {
        s = String(s ?? '');
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        return Math.abs(h) || 1;
    }

    function makeRng(seed) {
        let s = (seed >>> 0) || 1;
        return () => {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };
    }

    // ============================================================
    // 1. 家具目录
    // ============================================================
    const CATALOG = {
        // ---------- 休息 ----------
        bed: {
            id: 'bed', name: '床', emoji: '🛏️',
            size: { w: 2, h: 2 },
            type: 'rest',
            restore: { 生命: 100, 体力: 60, 精力: 40 },
            duration: 6,          // 游戏小时
            wall: true,           // 靠墙
            tags: ['家具', '休息'],
        },
        bed_double: {
            id: 'bed_double', name: '双人床', emoji: '🛏️',
            size: { w: 2, h: 3 },
            type: 'rest',
            restore: { 体力: 80, 精力: 60 },
            duration: 8,
            wall: true,
            tags: ['家具', '休息'],
        },
        sofa: {
            id: 'sofa', name: '沙发', emoji: '🛋️',
            size: { w: 2, h: 1 },
            type: 'rest',
            restore: { 体力: 20, 精力: 30 },
            duration: 2,
            wall: true,
            tags: ['家具', '休息'],
        },
        bench_wood: {
            id: 'bench_wood', name: '木长椅', emoji: '🪑',
            size: { w: 3, h: 1 },
            type: 'rest',
            restore: { 体力: 15, 精力: 15 },
            duration: 1,
            wall: true,
            tags: ['家具', '休息'],
        },
        rocking_chair: {
            id: 'rocking_chair', name: '摇椅', emoji: '🪑',
            size: { w: 1, h: 1 },
            type: 'rest',
            restore: { 体力: 20, 精力: 25 },
            duration: 2,
            wall: true,
            tags: ['家具', '休息'],
        },

        // ---------- 娱乐 ----------
        tv: {
            id: 'tv', name: '电视', emoji: '📺',
            size: { w: 2, h: 1 },
            type: 'entertain',
            restore: { 心情: 30 },
            duration: 2,
            xp: 0,
            wall: true,
            tags: ['家具', '娱乐'],
        },
        chess: {
            id: 'chess', name: '棋盘', emoji: '♟️',
            size: { w: 2, h: 2 },
            type: 'entertain',
            restore: { 心情: 25, 精力: 10 },
            duration: 1,
            xp: 5,               // ★ 娱乐也给点经验
            xpType: '智力',
            tags: ['家具', '娱乐'],
        },
        piano: {
            id: 'piano', name: '钢琴', emoji: '🎹',
            size: { w: 3, h: 2 },
            type: 'entertain',
            restore: { 心情: 40 },
            duration: 2,
            xp: 10,
            xpType: '魅力',
            wall: true,
            tags: ['家具', '娱乐'],
        },
        fireplace: {
            id: 'fireplace', name: '壁炉', emoji: '🔥',
            size: { w: 2, h: 1 },
            type: 'entertain',
            restore: { 心情: 20, 体力: 10 },
            duration: 1,
            wall: true,
            tags: ['家具', '娱乐'],
        },

        // ---------- 学习 ----------
        bookshelf: {
            id: 'bookshelf', name: '书架', emoji: '📚',
            size: { w: 2, h: 1 },
            type: 'study',
            restore: {},
            duration: 2,
            xp: 15,
            xpType: '学识',
            wall: true,
            tags: ['家具', '学习'],
        },
        desk: {
            id: 'desk', name: '书桌', emoji: '🪑',
            size: { w: 2, h: 1 },
            type: 'study',
            restore: { 精力: 10 },
            duration: 1,
            xp: 8,
            xpType: '学识',
            wall: true,
            tags: ['家具', '学习'],
        },
        desk_large: {
            id: 'desk_large', name: '大书桌', emoji: '🗄️',
            size: { w: 3, h: 2 },
            type: 'study',
            restore: { 精力: 15 },
            duration: 3,
            xp: 25,
            xpType: '学识',
            wall: true,
            tags: ['家具', '学习'],
        },

        // ---------- 仓储 ----------
        cabinet: {
            id: 'cabinet', name: '柜子', emoji: '🗄️',
            size: { w: 1, h: 1 },
            type: 'storage',
            capacity: 20,
            wall: true,
            tags: ['家具', '仓储'],
        },
        cabinet_tall: {
            id: 'cabinet_tall', name: '大衣柜', emoji: '🗄️',
            size: { w: 2, h: 1 },
            type: 'storage',
            capacity: 40,
            wall: true,
            tags: ['家具', '仓储'],
        },
        chest_wood: {
            id: 'chest_wood', name: '木箱', emoji: '📦',
            size: { w: 1, h: 1 },
            type: 'storage',
            capacity: 15,
            tags: ['家具', '仓储'],
        },
        barrel: {
            id: 'barrel', name: '酒桶', emoji: '🛢️',
            size: { w: 1, h: 1 },
            type: 'storage',
            capacity: 10,
            tags: ['家具', '仓储'],
        },

        // ---------- 宝箱 ----------
        treasure_chest: {
            id: 'treasure_chest', name: '宝箱', emoji: '🎁',
            size: { w: 1, h: 1 },
            type: 'chest',
            tags: ['家具', '宝箱'],
        },
        treasure_chest_gold: {
            id: 'treasure_chest_gold', name: '金宝箱', emoji: '💎',
            size: { w: 1, h: 1 },
            type: 'chest',
            tags: ['家具', '宝箱'],
        },
        // ---------- 合成台 ----------
        cooking_stove: {
            id: 'cooking_stove', name: '灶台', emoji: '🔥',
            size: { w: 2, h: 1 },
            type: 'craft',
            wall: true,
            tags: ['合成', '灶台'],
        },
        forge: {
            id: 'forge', name: '锻造炉', emoji: '⚒️',
            size: { w: 2, h: 2 },
            type: 'craft',
            wall: true,
            tags: ['合成', '锻造'],
        },
        alchemy_lab: {
            id: 'alchemy_lab', name: '炼金台', emoji: '🧪',
            size: { w: 2, h: 1 },
            type: 'craft',
            wall: true,
            tags: ['合成', '炼金'],
        },
        crafting_table: {
            id: 'crafting_table', name: '工作台', emoji: '🔨',
            size: { w: 2, h: 1 },
            type: 'craft',
            wall: true,
            tags: ['合成', '通用'],
        },
    };

    // ============================================================
    // 室外专用家具（独立于 CATALOG）
    // ============================================================
    const OUTDOOR_OBJECTS = {
        // ---------- 容器 ----------
        chest_wood: {
            id: 'chest_wood', name: '木箱', emoji: '📦',
            size: { w: 1, h: 1 },
            type: 'storage',
            capacity: 15,
            tags: ['容器'],
        },
        barrel: {
            id: 'barrel', name: '木桶', emoji: '🛢️',
            size: { w: 1, h: 1 },
            type: 'storage',
            capacity: 10,
            tags: ['容器'],
        },
        crate: {
            id: 'crate', name: '货箱', emoji: '📦',
            size: { w: 1, h: 1 },
            type: 'storage',
            capacity: 12,
            tags: ['容器'],
        },

        // ---------- 休息 ----------
        outdoor_bench: {
            id: 'outdoor_bench', name: '户外长椅', emoji: '🪑',
            size: { w: 1, h: 1 },
            type: 'rest',
            restore: { 体力: 15, 精力: 15 },
            duration: 1,
            tags: ['休息'],
        },
        stool: {
            id: 'stool', name: '板凳', emoji: '🪑',
            size: { w: 1, h: 1 },
            type: 'rest',
            restore: { 体力: 10 },
            duration: 1,
            tags: ['休息'],
        },
    };

    // ============================================================
    // 关键词匹配
    // ============================================================
    const KEYWORDS = {
        bed: ['床', '床铺'],
        bed_double: ['双人床', '大床'],
        sofa: ['沙发', '长椅', '软椅'],
        bench_wood: ['长凳', '长椅', '木凳'],
        rocking_chair: ['摇椅'],
        tv: ['电视', '电视机'],
        chess: ['棋', '棋盘', '象棋', '围棋'],
        piano: ['钢琴'],
        fireplace: ['壁炉', '火炉'],
        bookshelf: ['书架', '书柜', '藏书'],
        desk: ['书桌', '写字台'],
        desk_large: ['大书桌', '大写字台', '写字台'],
        cabinet: ['柜子', '橱柜', '储物柜'],
        cabinet_tall: ['衣柜', '大衣柜'],
        chest_wood: ['木箱', '箱子'],
        barrel: ['酒桶', '木桶'],
        treasure_chest: ['宝箱', '宝盒'],
        treasure_chest_gold: ['金宝箱', '黄金宝箱'],
    };

    // ============================================================
    // 主体
    // ============================================================
    const IndoorObjects = {
        CATALOG,
        KEYWORDS,

        _installed: false,

        // ============================================================
        // 安装
        // ============================================================
        install() {
            if (this._installed) return;
            this._installed = true;

            this._hookMapBuild();
            this._hookClick();

            console.log('[IndoorObjects] 已安装');
        },

        // ============================================================
        // 1. 劫持 MapLayout.build：build 后自动摆家具
        // ============================================================
        _hookMapBuild() {
            let tries = 0;
            const wait = setInterval(() => {
                if (window.MapLayout) {
                    clearInterval(wait);
                    this._installBuildHook();
                } else if (++tries > 100) {
                    clearInterval(wait);
                    console.warn('[IndoorObjects] 等待 MapLayout 超时');
                }
            }, 50);
        },

        _installBuildHook() {
            const ML = window.MapLayout;
            const originalBuild = ML.build.bind(ML);

            ML.build = async function (map) {
                const result = await originalBuild(map);

                // ★ 交给 _spawnFurniture 内部判断室内外
                try {
                    IndoorObjects._spawnFurniture(map);
                } catch (e) {
                    console.error('[IndoorObjects] _spawnFurniture 失败:', e);
                }

                return result;
            };

            console.log('[IndoorObjects] MapLayout.build 已劫持（build 后摆家具）');
        },

        // ============================================================
        // ★ 工具：重新生成地图时调用，清掉"已生成"标记
        // ============================================================
        resetGeneration(map) {
            if (!map) return;
            map._furnitureGenerated = false;
            console.log(`[IndoorObjects] ${map.name}: 家具生成标记已重置`);
        },

        // ============================================================
        // 2. 从 AI 生成的实体里识别家具，实例化
        // ============================================================
        _spawnFurniture(map) {
            if (!map._generated?.grid || !map._generated?.placements) return;

            // ★ 修复 BUG1：已生成过 → 直接跳过（刷新不再重摆）
            if (map._furnitureGenerated) {
                console.log(`[IndoorObjects] ${map.name}: 家具已生成过，跳过`);
                return;
            }

            const isIndoor = map.mapType === 'indoor'
                || map._source === 'program'
                || map._source === 'indoor'
                || map.tags?.includes('indoor');

            if (isIndoor) {
                this._spawnIndoorFurniture(map);
            } else {
                this._spawnOutdoorObjects(map);
            }

            // ★ 打标记
            map._furnitureGenerated = true;

            // ---------- 保存 ----------
            window.MapLauncher?._saveMapToWorld?.(map);
        },

        // ============================================================
        // 室内：按区域类型摆家具
        // ============================================================
        _spawnIndoorFurniture(map) {
            const grid = map._generated.grid;
            const placements = map._generated.placements;

            // AI 已经生成的 furniture
            const aiFurniture = (map.entities || []).filter(e =>
                e.kind === 'furniture' && e.indoor?.catalogId
            );
            for (const ent of aiFurniture) {
                this._placeFurniture(map, grid, placements, ent);
            }

            // 程序补：按区域类型自动摆
            for (const region of map.regions) {
                const rect = placements[region.id];
                if (!rect) continue;

                const existing = (map.entities || []).filter(e =>
                    e.kind === 'furniture' && e.region === region.id
                ).length;

                const want = Math.max(0, 2 - existing);
                if (want === 0) continue;

                this._autoPlaceInRegion(map, grid, rect, region, want);
            }
            this._spawnCraftingStations(map, grid, placements);
        },

        // ============================================================
        // 生成合成台：按区域名匹配 + 至少 1 个兜底
        // ============================================================
        _spawnCraftingStations(map, grid, placements) {
            // 检查是否已有（避免重复生成）
            const hasCraft = (map.entities || []).some(e =>
                e.kind === 'furniture' && e.indoor?.type === 'craft'
            );
            if (hasCraft) return;

            // 匹配规则：区域名 / 类型 → 合成台
            const MATCHES = [
                { re: /厨|灶/, catalogId: 'cooking_stove' },
                { re: /铁匠|锻造|工坊|铁铺/, catalogId: 'forge' },
                { re: /实验|炼金|药剂|炼丹/, catalogId: 'alchemy_lab' },
            ];

            const placed = new Set();   // catalogId → 已生成

            // 逐个区域尝试匹配
            for (const region of map.regions) {
                const rect = placements[region.id];
                if (!rect) continue;

                const text = (region.name || '') + ' ' + (region.type || '');

                for (const m of MATCHES) {
                    if (placed.has(m.catalogId)) continue;
                    if (!m.re.test(text)) continue;

                    const def = CATALOG[m.catalogId];
                    if (!def) continue;

                    const pos = this._findSpot(map, grid, rect, def.size, def);
                    if (!pos) continue;

                    const ent = this._makeFurnitureEntity(map, def, region.id, pos);
                    map.entities.push(ent);
                    placed.add(m.catalogId);
                    break;
                }
            }

            // 兜底：至少 1 个
            if (placed.size === 0) {
                const def = CATALOG.crafting_table;

                // 优先大厅/正厅/堂，其次卧室/寝室，最后第一个区域
                const fallbackRegions = [
                    ...map.regions.filter(r => /大厅|正厅|堂|客厅|主厅/.test((r.name || '') + (r.type || ''))),
                    ...map.regions.filter(r => /卧|寝/.test((r.name || '') + (r.type || ''))),
                    ...map.regions,
                ];

                for (const region of fallbackRegions) {
                    const rect = placements[region.id];
                    if (!rect) continue;

                    const pos = this._findSpot(map, grid, rect, def.size, def);
                    if (!pos) continue;

                    const ent = this._makeFurnitureEntity(map, def, region.id, pos);
                    map.entities.push(ent);
                    placed.add(def.id);
                    break;
                }
            }

            if (placed.size > 0) {
                console.log(`[IndoorObjects] ${map.name}: 合成台 ${[...placed].join(', ')}`);
            }
        },

        // ============================================================
        // 室外：少量容器 + 少量椅子
        // ============================================================
        _spawnOutdoorObjects(map) {
            const grid = map._generated.grid;
            const placements = map._generated.placements;
            const regionIds = Object.keys(placements);
            if (regionIds.length === 0) return;

            // ★ 检查已有：已经有任何户外对象 → 跳过
            const existing = (map.entities || []).filter(e =>
                e.kind === 'furniture' && e.indoor?.isOutdoor === true
            ).length;
            if (existing > 0) {
                console.log(`[IndoorObjects] ${map.name}: 已有 ${existing} 个户外对象，跳过`);
                return;
            }

            // ★ 确定性 RNG
            const rng = makeRng(hashStr((map.name || 'outdoor') + '|outdoor'));

            // 打乱区域顺序（确定性）
            const shuffled = [...regionIds].sort(() => rng() - 0.5);

            // 数量：每 2 个区域 1 个
            const baseCount = Math.max(1, Math.floor(regionIds.length / 2));

            // 容器候选
            const containerIds = ['chest_wood', 'barrel', 'crate'];
            // 椅子候选
            const chairIds = ['outdoor_bench', 'stool'];

            let placed = 0;

            // ---------- 容器 ----------
            for (let i = 0; i < baseCount && i < shuffled.length; i++) {
                const regionId = shuffled[i];
                const rect = placements[regionId];
                if (!rect) continue;

                const catalogId = containerIds[Math.floor(rng() * containerIds.length)];
                const def = OUTDOOR_OBJECTS[catalogId];
                if (!def) continue;

                // 打个标记，让 _fillStorage 知道是室外
                def._outdoor = true;

                const pos = this._findSpot(map, grid, rect, def.size, def);
                if (!pos) continue;

                const ent = this._makeFurnitureEntity(map, def, regionId, pos, i);
                map.entities.push(ent);
                placed++;
            }

            // ---------- 椅子 ----------
            for (let i = 0; i < baseCount && i < shuffled.length; i++) {
                const regionId = shuffled[i];
                const rect = placements[regionId];
                if (!rect) continue;

                const catalogId = chairIds[Math.floor(rng() * chairIds.length)];
                const def = OUTDOOR_OBJECTS[catalogId];
                if (!def) continue;

                def._outdoor = true;

                const pos = this._findSpot(map, grid, rect, def.size, def);
                if (!pos) continue;

                const ent = this._makeFurnitureEntity(map, def, regionId, pos, i);
                map.entities.push(ent);
                placed++;
            }

            console.log(`[IndoorObjects] ${map.name}: 室外生成 ${placed} 个对象`);
        },

        // ============================================================
        // 摆放一个 AI 生成的家具
        // ============================================================
        _placeFurniture(map, grid, placements, ent) {
            const catalogId = ent.indoor?.catalogId;
            const def = CATALOG[catalogId];
            if (!def) {
                console.warn(`[IndoorObjects] 未知家具类型: ${catalogId}`);
                return;
            }

            const rect = placements[ent.region];
            if (!rect) return;

            const size = def.size || { w: 1, h: 1 };

            // 如果 AI 已经指定了位置，就用它；否则随机找
            if (typeof ent.x === 'number' && typeof ent.y === 'number') {
                if (!this._canFit(grid, ent.x, ent.y, size, ent.id)) {
                    // 位置不行，重新找
                    const pos = this._findSpot(map, grid, rect, size, def);
                    if (!pos) { ent._placed = false; return; }
                    ent.x = pos.x;
                    ent.y = pos.y;
                    ent.indoor = ent.indoor || {};
                    ent.indoor.facing = pos.facing || null;
                }
            } else {
                const pos = this._findSpot(map, grid, rect, size, def);
                if (!pos) { ent._placed = false; return; }
                ent.x = pos.x;
                ent.y = pos.y;
                ent.indoor = ent.indoor || {};
                ent.indoor.facing = pos.facing || null;
            }

            ent.indoor = ent.indoor || {};
            ent.indoor.catalogId = catalogId;
            ent.indoor.type = def.type;
            ent.indoor.size = size;

            // ★ 占用格子
            for (let dy = 0; dy < size.h; dy++) {
                for (let dx = 0; dx < size.w; dx++) {
                    const cell = grid[ent.y + dy]?.[ent.x + dx];
                    if (!cell) continue;
                    cell.walkable = false;
                    cell.decor = {
                        type: 'furniture',
                        furnitureId: ent.id,
                        emoji: def.emoji,
                    };
                }
            }

            ent._placed = true;
        },

        // ============================================================
        // 自动摆放：按区域类型挑家具
        // ============================================================
        _autoPlaceInRegion(map, grid, rect, region, want) {
            const regionName = (region.name || '') + ' ' + (region.type || '');
            const candidates = this._pickCandidatesForRegion(regionName);

            for (let i = 0; i < want; i++) {
                const catalogId = candidates[i % candidates.length];
                const def = CATALOG[catalogId];
                if (!def) continue;

                const pos = this._findSpot(map, grid, rect, def.size, def);
                if (!pos) continue;

                // ★ 传 idx，保证 id 确定性
                const ent = this._makeFurnitureEntity(map, def, region.id, pos, i);
                map.entities.push(ent);
            }
        },

        _pickCandidatesForRegion(text) {
            const t = String(text || '');

            // 卧室 / 寝室
            if (/卧|寝|睡/.test(t)) {
                return ['bed', 'cabinet', 'desk', 'bookshelf', 'rocking_chair'];
            }
            // 客厅 / 大厅
            if (/客厅|大厅|堂/.test(t)) {
                return ['sofa', 'fireplace', 'cabinet', 'bench_wood', 'tv'];
            }
            // 书房 / 图书
            if (/书|图|学/.test(t)) {
                return ['bookshelf', 'desk', 'desk_large', 'rocking_chair'];
            }
            // 酒馆 / 客栈
            if (/酒|客栈|旅/.test(t)) {
                return ['barrel', 'cabinet', 'bench_wood', 'chest_wood'];
            }
            // 厨房
            if (/厨|灶/.test(t)) {
                return ['cabinet', 'barrel', 'chest_wood'];
            }
            // 仓库 / 储藏
            if (/仓|储|库/.test(t)) {
                return ['chest_wood', 'cabinet', 'barrel'];
            }
            // 默认
            return ['cabinet', 'bench_wood', 'chest_wood'];
        },

        // ============================================================
        // ★ 修复 BUG1：确定性 id
        // ============================================================
        _makeFurnitureEntity(map, def, regionId, pos, idx = 0) {
            const id = `furn_${map.name || 'map'}_${regionId}_${def.id}_${pos.x}_${pos.y}_${idx}`;
            const ent = {
                id,
                name: def.name,
                emoji: def.emoji,
                kind: 'furniture',
                region: regionId,
                position: 'center',
                blocking: true,
                isPlayer: false,
                tags: def.tags || [],
                description: '',
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
                type: 'furniture',

                x: pos.x,
                y: pos.y,
                _placed: true,

                // ★ 运行时数据
                indoor: {
                    catalogId: def.id,
                    type: def.type,
                    size: def.size,
                    facing: pos.facing || null,
                    isOutdoor: def._outdoor === true,
                    // rest / entertain / study
                    restore: def.restore || {},
                    duration: def.duration || 1,
                    xp: def.xp || 0,
                    xpType: def.xpType || null,
                    // storage
                    capacity: def.capacity || 0,
                    items: [],
                    // chest
                    loot: null,
                    opened: false,
                },
            };
            // ★ 仓储类家具初始库存
            if (def.type === 'storage') {
                this._fillStorage(ent, map, def);
            }

            // 占格
            for (let dy = 0; dy < def.size.h; dy++) {
                for (let dx = 0; dx < def.size.w; dx++) {
                    const cell = map._generated.grid[ent.y + dy]?.[ent.x + dx];
                    if (!cell) continue;
                    cell.walkable = false;
                    cell.decor = {
                        type: 'furniture',
                        furnitureId: ent.id,
                        emoji: def.emoji,
                    };
                }
            }

            return ent;
        },

        // ============================================================
        // ★ 修复 BUG1：仓储填充也用确定性 RNG
        // ============================================================
        _fillStorage(ent, map, def) {
            if (!ent.indoor) return;
            if (def.type !== 'storage') return;

            const itemTable = map.itemTable || {};
            const allItems = Object.values(itemTable);
            if (allItems.length === 0) return;

            // ★ 确定性 RNG（种子含 ent.id → 每个容器独立且稳定）
            const rng = makeRng(hashStr(
                (map.name || '') + '|' + ent.id + '|storage'
            ));

            // 概率：室内 50%，室外 100%
            const isOutdoor = def._outdoor === true;
            const fillChance = isOutdoor ? 1.0 : 0.5;
            if (rng() > fillChance) return;

            // 排除不该出现的物品
            const EXCLUDE_TYPES = /任务|唯一|剧情/;
            const pool = allItems.filter(it => {
                const t = it.fields?.['类型'] || '';
                return !EXCLUDE_TYPES.test(t);
            });
            if (pool.length === 0) return;

            // 随机 1-3 个物品
            const n = 1 + Math.floor(rng() * 3);
            for (let i = 0; i < n; i++) {
                const pick = pool[Math.floor(rng() * pool.length)];
                const count = 1 + Math.floor(rng() * 3);

                // 避免同物品重复堆叠
                const existing = ent.indoor.items.find(
                    it => it.name === pick.name && it.stackable
                );
                if (existing) {
                    existing.count = (existing.count || 1) + count;
                } else {
                    ent.indoor.items.push({
                        name: pick.name,
                        count,
                        icon: pick.emoji || '📦',
                        description: pick.description || '',
                        fields: { ...(pick.fields || {}) },
                        stackable: pick.fields?.['可堆叠'] === '是',
                        maxStack: parseInt(pick.fields?.['最大堆叠']) || null,
                        type: pick.fields?.['类型'] || 'item',
                    });
                }
            }
        },

        // ============================================================
        // ★ 修复 BUG2：_findSpot 确定性 RNG + 向内缩 1 格 + roadBuffer
        // ============================================================
        _findSpot(map, grid, rect, size, def) {
            const w = size.w || 1;
            const h = size.h || 1;

            // 家具靠墙 → 优先内墙位置
            if (def.wall) {
                const pos = this._findWallSpot(grid, rect, w, h, map, def);
                if (pos) return pos;
            }

            // ★ 向内缩 1 格，避开区域边缘（往往贴路）
            const inset = 1;
            const minX = rect.x + inset;
            const maxX = rect.x + rect.w - w - inset;
            const minY = rect.y + inset;
            const maxY = rect.y + rect.h - h - inset;

            // 区域太小 → 退化为原逻辑（但仍用确定性 RNG）
            if (maxX < minX || maxY < minY) {
                return this._findSpotLegacy(map, grid, rect, size, def);
            }

            // ★ 确定性 RNG
            const rng = makeRng(hashStr(
                (map?.name || '') + '|' + rect.x + ',' + rect.y + '|' + (def.id || '')
            ));

            for (let t = 0; t < 40; t++) {
                const x = minX + Math.floor(rng() * (maxX - minX + 1));
                const y = minY + Math.floor(rng() * (maxY - minY + 1));
                if (this._canFit(grid, x, y, size, null, { roadBuffer: true })) {
                    return { x, y, facing: null };
                }
            }
            return null;
        },

        // 退化版（区域太小时用）
        _findSpotLegacy(map, grid, rect, size, def) {
            const w = size.w || 1;
            const h = size.h || 1;

            const maxX = rect.x + rect.w - w - 1;
            const minX = rect.x + 1;
            const maxY = rect.y + rect.h - h - 1;
            const minY = rect.y + 1;
            if (maxX < minX || maxY < minY) return null;

            const rng = makeRng(hashStr(
                (map?.name || '') + '|legacy|' + rect.x + ',' + rect.y + '|' + (def.id || '')
            ));

            for (let t = 0; t < 40; t++) {
                const x = minX + Math.floor(rng() * (maxX - minX + 1));
                const y = minY + Math.floor(rng() * (maxY - minY + 1));
                if (this._canFit(grid, x, y, size)) {
                    return { x, y, facing: null };
                }
            }
            return null;
        },

        // ============================================================
        // ★ 修复 BUG2：_findWallSpot 向内缩 1 格 + 确定性打乱 + roadBuffer
        // ============================================================
        _findWallSpot(grid, rect, w, h, map = null, def = null) {
            const candidates = [];

            // ★ 向内缩 1 格作为墙位
            const inset = 1;
            const ix = rect.x + inset;
            const iy = rect.y + inset;
            const iw = rect.w - inset * 2;
            const ih = rect.h - inset * 2;
            if (iw < w || ih < h) return null;   // 区域太小，放弃靠墙

            // 上边（靠北墙）→ 正面朝南
            for (let x = ix; x <= ix + iw - w; x++) {
                candidates.push({ x, y: iy, facing: 'south' });
            }
            // 下边（靠南墙）→ 正面朝北
            for (let x = ix; x <= ix + iw - w; x++) {
                candidates.push({ x, y: iy + ih - h, facing: 'north' });
            }
            // 左边（靠西墙）→ 正面朝东
            for (let y = iy; y <= iy + ih - h; y++) {
                candidates.push({ x: ix, y, facing: 'east' });
            }
            // 右边（靠东墙）→ 正面朝西
            for (let y = iy; y <= iy + ih - h; y++) {
                candidates.push({ x: ix + iw - w, y, facing: 'west' });
            }

            // ★ 确定性打乱（用地图名 + 区域位置 + 家具 id 做种子）
            const rng = makeRng(hashStr(
                (map?.name || '') + '|' + rect.x + ',' + rect.y
                + '|' + (def?.id || '')
            ));
            for (let i = candidates.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
            }

            for (const pos of candidates) {
                if (this._canFit(grid, pos.x, pos.y, { w, h }, null, { roadBuffer: true })) {
                    return pos;
                }
            }
            return null;
        },

        // ============================================================
        // ★ 修复 BUG2：_canFit 加"外圈 1 格无 road"缓冲 + 多格实体 AABB
        // ============================================================
        _canFit(grid, x, y, size, ignoreId = null, opts = {}) {
            const w = size.w || 1;
            const h = size.h || 1;
            const needRoadBuffer = opts.roadBuffer !== false;  // 默认开启

            // ---------- 1. 占用格本身 ----------
            for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                    const cell = grid[y + dy]?.[x + dx];
                    if (!cell) return false;
                    if (cell.terrain === 'void') return false;
                    if (cell.terrain === 'wall') return false;
                    if (!cell.walkable) return false;
                    if (cell.road) return false;
                    if (cell.decor && cell.decor.furnitureId !== ignoreId) return false;
                    if (cell.portal) return false;
                }
            }

            // ---------- 2. ★ 路缓冲：外圈 1 格不能有 road ----------
            if (needRoadBuffer) {
                for (let gy = y - 1; gy <= y + h; gy++) {
                    for (let gx = x - 1; gx <= x + w; gx++) {
                        // 只检查外圈
                        const isInner = gx >= x && gx < x + w
                                     && gy >= y && gy < y + h;
                        if (isInner) continue;

                        const cell = grid[gy]?.[gx];
                        if (!cell) continue;
                        if (cell.road) return false;   // 贴路 → 不行
                    }
                }
            }

            // ---------- 3. 实体碰撞（多格实体按 AABB）----------
            const map = window.MapLauncher?.getMap?.();
            if (map) {
                for (const ent of map.entities) {
                    if (!ent._placed || ent.id === ignoreId) continue;

                    let ew = 1, eh = 1;
                    let ex, ey;

                    if (ent.kind === 'furniture') {
                        const s = ent.indoor?.size || { w: 1, h: 1 };
                        ew = s.w; eh = s.h;
                        ex = ent.x; ey = ent.y;
                    } else if (ent.kind === 'building' && ent.size) {
                        ew = ent.size.w; eh = ent.size.h;
                        ex = ent.anchor?.x; ey = ent.anchor?.y;
                        if (typeof ex !== 'number' || typeof ey !== 'number') continue;
                    } else if (typeof ent.x === 'number' && typeof ent.y === 'number') {
                        ex = ent.x; ey = ent.y;
                    } else {
                        continue;
                    }

                    // AABB
                    if (x < ex + ew && x + w > ex &&
                        y < ey + eh && y + h > ey) return false;
                }
            }
            return true;
        },

        // ============================================================
        // 3. 劫持点击：点家具 → 弹交互
        // ============================================================
        _hookClick() {
            let tries = 0;
            const wait = setInterval(() => {
                if (window.MapCanvas && window.MapEntityPanel) {
                    clearInterval(wait);
                    this._installClickHook();
                } else if (++tries > 100) {
                    clearInterval(wait);
                }
            }, 50);
        },

        _installClickHook() {
            const MEP = window.MapEntityPanel;
            const originalOpenDetail = MEP.openDetail.bind(MEP);

            MEP.openDetail = function (id) {
                const map = window.MapLauncher?.getMap?.();
                const ent = map?.entities?.find(e => e.id === id);

                // 家具 → 走专属面板
                if (ent && ent.kind === 'furniture' && ent.indoor) {
                    IndoorObjects.openFurniturePanel(ent);
                    return;
                }
                // 其他 → 原逻辑
                return originalOpenDetail(id);
            };

            console.log('[IndoorObjects] MapEntityPanel.openDetail 已劫持');
        },

        // ============================================================
        // 4. 家具面板
        // ============================================================
        openFurniturePanel(ent) {
            if (!ent?.indoor) return;
            const type = ent.indoor.type;

            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;
            modal.className = 'active';

            let bodyHTML = '';

            // ---------- 休息 / 娱乐 / 学习 ----------
            if (type === 'rest' || type === 'entertain' || type === 'study') {
                bodyHTML = this._renderRestPanel(ent);
            }
            // ---------- 仓储 ----------
            else if (type === 'storage') {
                bodyHTML = this._renderStoragePanel(ent);
            }
            // ---------- 宝箱 ----------
            else if (type === 'chest') {
                bodyHTML = this._renderChestPanel(ent);
            }
            // ---------- 合成台 ----------
            else if (type === 'craft') {
                // 交给 MapCrafting 处理
                if (window.MapCrafting) {
                    window.MapCrafting.open(ent);
                    return;
                }
                bodyHTML = `<div style="text-align:center;padding:20px;color:#888;">
                                合成系统未加载
                            </div>`;
            }
            modal.innerHTML = `
                <div class="cinemaworld-modal-title" style="font-size:22px;">
                    ${ent.emoji} ${ent.name}
                </div>
                ${bodyHTML}
            `;

            // 绑定按钮
            document.getElementById('cw-furn-close')?.addEventListener('click', () => {
                window.UIManager.closeModal();
            });

            // 休息按钮
            document.querySelectorAll('[data-furn-rest]').forEach(btn => {
                btn.onclick = () => this._doRest(ent);
            });

            // 仓储按钮
            document.getElementById('cw-furn-store')?.addEventListener('click', () => {
                this._doStoragePanel(ent, 'in');
            });
            document.getElementById('cw-furn-take')?.addEventListener('click', () => {
                this._doStoragePanel(ent, 'out');
            });

            // 开箱按钮
            document.getElementById('cw-furn-open')?.addEventListener('click', () => {
                this._doOpenChest(ent);
            });
        },

        _renderRestPanel(ent) {
            const r = ent.indoor;
            const restore = r.restore || {};
            const lines = [];
            for (const [k, v] of Object.entries(restore)) {
                lines.push(`${k} +${v}`);
            }
            if (r.xp) {
                lines.push(`经验 +${r.xp}${r.xpType ? `（${r.xpType}）` : ''}`);
            }

            const dur = r.duration || 1;
            const durText = dur >= 1 ? `${dur} 小时` : `${Math.round(dur * 60)} 分钟`;

            const nameMap = {
                rest: '休息',
                entertain: '娱乐',
                study: '学习',
            };
            const actionName = nameMap[r.type] || '使用';

            return `
                <div style="text-align:center;font-size:14px;color:#aaa;margin-bottom:16px;">
                    ${ent.description || ''}
                </div>
                <div style="padding:14px;background:rgba(120,150,255,.08);border-radius:10px;margin-bottom:16px;">
                    <div style="font-size:13px;color:#9ab0ff;margin-bottom:8px;">
                        ⏱ 耗时：${durText}
                    </div>
                    ${lines.length ? `
                        <div style="font-size:13px;color:#a8ffa8;">
                            ✨ ${lines.join(' · ')}
                        </div>
                    ` : ''}
                </div>
                <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary" data-furn-rest>
                        ${actionName}（${durText}）
                    </button>
                    <button class="cinemaworld-button" id="cw-furn-close">关闭</button>
                </div>
            `;
        },

        _renderStoragePanel(ent) {
            const r = ent.indoor;
            const items = r.items || [];
            const cap = r.capacity || 0;

            return `
                <div style="text-align:center;font-size:13px;color:#aaa;margin-bottom:16px;">
                    容量 ${items.length} / ${cap}
                </div>
                <div style="padding:12px;background:rgba(0,0,0,.2);border-radius:10px;
                    margin-bottom:16px;max-height:300px;overflow-y:auto;">
                    ${items.length === 0
                    ? '<div style="text-align:center;color:#666;padding:20px;">空空如也</div>'
                    : items.map((it, i) => `
                            <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;
                                border-bottom:1px solid rgba(255,255,255,.05);">
                                <span style="font-size:20px;">${it.icon || '📦'}</span>
                                <span style="flex:1;font-size:13px;color:#ddd;">${it.name}</span>
                                <span style="font-size:12px;color:#888;">×${it.count}</span>
                            </div>
                        `).join('')}
                </div>
                <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary" id="cw-furn-store">
                        📥 存入
                    </button>
                    <button class="cinemaworld-button" id="cw-furn-take">
                        📤 取出
                    </button>
                    <button class="cinemaworld-button" id="cw-furn-close">关闭</button>
                </div>
            `;
        },

        _renderChestPanel(ent) {
            const r = ent.indoor;
            if (r.opened) {
                return `
                    <div style="text-align:center;padding:30px 20px;">
                        <div style="font-size:56px;margin-bottom:12px;opacity:.5;">📭</div>
                        <div style="font-size:14px;color:#888;">已经打开过了</div>
                    </div>
                    <div style="text-align:center;margin-top:16px;">
                        <button class="cinemaworld-button" id="cw-furn-close">关闭</button>
                    </div>
                `;
            }

            return `
                <div style="text-align:center;padding:20px;">
                    <div style="font-size:64px;margin-bottom:12px;">🎁</div>
                    <div style="font-size:14px;color:#ffd76b;">尚未打开</div>
                </div>
                <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary" id="cw-furn-open">
                        📦 打开
                    </button>
                    <button class="cinemaworld-button" id="cw-furn-close">关闭</button>
                </div>
            `;
        },

        // ============================================================
        // 5. 休息：过时间 + 恢复
        // ============================================================
        _doRest(ent) {
            const r = ent.indoor;
            const player = window.PlayerStateManager?.player;
            if (!player) return;

            const dur = r.duration || 1;
            const restore = r.restore || {};

            // 恢复数值
            const restored = [];
            for (const [k, v] of Object.entries(restore)) {
                if (this._addPlayerStat(player, k, v)) {
                    restored.push(`${k} +${v}`);
                }
            }

            // 加经验
            if (r.xp) {
                window.PlayerStateManager?.addExperience?.(r.xp, r.xpType);
                restored.push(`经验 +${r.xp}`);
            }

            // 过时间
            const clock = window.EnvironmentClock;
            if (clock?.jumpTo) {
                const ws = window.CinemaWorld?.worldState;
                const cur = typeof ws?.worldMinutes === 'number' ? ws.worldMinutes : 0;
                clock.jumpTo(cur + dur * 60);
            }

            window.PlayerStateManager?.refreshAvatarArea?.();
            window.UIManager?.showText?.(
                `😴 休息了 ${dur} 小时 ${restored.length ? '· ' + restored.join(' · ') : ''}`,
                2500
            );

            window.UIManager.closeModal();
            if (window.SaveManager) window.SaveManager.save();
        },

        _addPlayerStat(player, key, value) {
            // 1. statusBar
            const bar = (player.statusBars || []).find(b =>
                b.key === key || b.label === key
            );
            if (bar) {
                bar.current = Math.min(bar.max, (Number(bar.current) || 0) + value);
                return true;
            }

            // 2. attributes
            if (player.attributes && player.attributes[key] !== undefined) {
                const v = player.attributes[key];
                if (typeof v === 'object') {
                    v.value = Math.min(v.max ?? Infinity, (Number(v.value) || 0) + value);
                } else {
                    player.attributes[key] = (Number(v) || 0) + value;
                }
                return true;
            }

            // 3. extraStats
            if (player.extraStats) {
                const ek = player.extraStats._order?.find(k =>
                    k === key || k.includes(key) || key.includes(k)
                );
                if (ek !== undefined) {
                    const raw = String(player.extraStats[ek] ?? '0');
                    const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                    if (m) {
                        const cur = parseFloat(m[1]);
                        const unit = m[2] || '';
                        player.extraStats[ek] = `${cur + value}${unit}`;
                        return true;
                    }
                }
            }

            // 4. 兜底：新建 extraStats
            if (player.extraStats) {
                if (!player.extraStats._order) player.extraStats._order = [];
                if (!player.extraStats._order.includes(key)) {
                    player.extraStats._order.push(key);
                }
                player.extraStats[key] = String(value);
                return true;
            }
            return false;
        },

        // ============================================================
        // 6. 仓储：存/取
        // ============================================================
        _doStoragePanel(ent, mode) {
            const player = window.PlayerStateManager?.player;
            if (!player) return;

            const r = ent.indoor;
            const isStore = mode === 'in';

            // 数据源
            const source = isStore
                ? (player.inventory || [])
                : (r.items || []);

            if (source.length === 0) {
                window.UIManager?.showText?.(isStore ? '背包是空的' : '仓库是空的', 1500);
                return;
            }

            // 检查容量
            const cap = r.capacity || 0;
            if (isStore && (r.items || []).length >= cap) {
                window.UIManager?.showText?.(`仓库已满（${cap} 格）`, 1500);
                return;
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';

            const title = isStore ? '📥 存入物品' : '📤 取出物品';
            const hint = isStore
                ? `仓库剩余空间：${cap - (r.items || []).length}`
                : `仓库物品：${(r.items || []).length} / ${cap}`;

            modal.innerHTML = `
                <div class="cinemaworld-modal-title" style="font-size:20px;">${title}</div>
                <div style="text-align:center;font-size:12px;color:#888;margin-bottom:14px;">
                    ${hint}
                </div>
                <div style="max-height:400px;overflow-y:auto;padding:8px;
                    background:rgba(0,0,0,.2);border-radius:10px;margin-bottom:14px;">
                    ${source.map((it, i) => `
                        <div class="cw-store-item" data-idx="${i}"
                            style="display:flex;align-items:center;gap:10px;padding:8px 10px;
                                border-radius:8px;cursor:pointer;margin-bottom:4px;
                                background:rgba(255,255,255,.03);">
                            <span style="font-size:24px;">${it.icon || '📦'}</span>
                            <span style="flex:1;font-size:13px;color:#ddd;">${it.name}</span>
                            <span style="font-size:12px;color:#888;">×${it.count || 1}</span>
                        </div>
                    `).join('')}
                </div>
                <div style="text-align:center;">
                    <button class="cinemaworld-button" id="cw-furn-close">返回</button>
                </div>
            `;

            // 点击物品
            modal.querySelectorAll('.cw-store-item').forEach(el => {
                el.onclick = () => {
                    const idx = parseInt(el.dataset.idx);
                    this._transferItem(ent, isStore, idx);
                    // 刷新面板
                    this._doStoragePanel(ent, mode);
                };
            });

            document.getElementById('cw-furn-close')?.addEventListener('click', () => {
                this.openFurniturePanel(ent);
            });
        },

        _transferItem(ent, isStore, idx) {
            const player = window.PlayerStateManager?.player;
            const r = ent.indoor;

            if (isStore) {
                // 背包 → 仓库
                const item = player.inventory?.[idx];
                if (!item) return;

                const cap = r.capacity || 0;
                if ((r.items || []).length >= cap) {
                    window.UIManager?.showText?.('仓库已满', 1200);
                    return;
                }

                // 从背包取出
                player.inventory.splice(idx, 1);

                // 加入仓库
                r.items = r.items || [];
                const existing = r.items.find(i => i.name === item.name && i.stackable);
                if (existing) {
                    existing.count = (existing.count || 1) + (item.count || 1);
                } else {
                    r.items.push({ ...item });
                }

                window.UIManager?.showText?.(`📥 存入 ${item.name}`, 1200);
            } else {
                // 仓库 → 背包
                const item = r.items?.[idx];
                if (!item) return;

                player.inventory = player.inventory || [];
                const slots = player.inventorySlots || 40;
                if (player.inventory.length >= slots) {
                    window.UIManager?.showText?.('背包已满', 1200);
                    return;
                }

                r.items.splice(idx, 1);

                const existing = player.inventory.find(i => i.name === item.name && i.stackable);
                if (existing) {
                    existing.count = (existing.count || 1) + (item.count || 1);
                } else {
                    player.inventory.push({ ...item });
                }

                window.UIManager?.showText?.(`📤 取出 ${item.name}`, 1200);
            }

            window.PlayerStateManager?.refreshAvatarArea?.();
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();
        },

        // ============================================================
        // 7. 宝箱
        // ============================================================
        async _doOpenChest(ent) {
            const r = ent.indoor;
            if (r.opened) return;

            // 首次打开 → 生成战利品
            if (!r.loot) {
                r.loot = this._generateLoot(ent);
            }

            // 加到背包
            const player = window.PlayerStateManager?.player;
            player.inventory = player.inventory || [];

            const got = [];
            for (const it of r.loot) {
                const existing = player.inventory.find(i =>
                    i.name === it.name && i.stackable
                );
                if (existing) {
                    existing.count = (existing.count || 1) + (it.count || 1);
                } else {
                    player.inventory.push({ ...it });
                }
                got.push(`${it.icon || '📦'} ${it.name} ×${it.count || 1}`);
            }

            r.opened = true;

            window.PlayerStateManager?.refreshAvatarArea?.();
            window.UIManager?.showText?.(
                `🎁 打开宝箱：${got.join('、')}`,
                3000
            );

            window.UIManager.closeModal();
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();

            // 2D 重绘（宝箱样式可能变）
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
        },

        _generateLoot(ent) {
            // 简单策略：金币 + 1-2 个消耗品
            const loot = [];

            // 金币
            const gold = 20 + Math.floor(Math.random() * 80);
            loot.push({
                name: '金币',
                count: gold,
                icon: '💰',
                description: '通用货币',
                stackable: true,
                type: 'item',
                fields: { '类型': '货币', '货币种类': '金钱' },
            });

            // 可能有个消耗品
            if (Math.random() < 0.6) {
                const items = [
                    { name: '红药水', icon: '🧪', desc: '回复生命' },
                    { name: '蓝药水', icon: '🧪', desc: '回复魔力' },
                    { name: '面包', icon: '🍞', desc: '回复体力' },
                ];
                const pick = items[Math.floor(Math.random() * items.length)];
                loot.push({
                    name: pick.name,
                    count: 1 + Math.floor(Math.random() * 2),
                    icon: pick.icon,
                    description: pick.desc,
                    stackable: true,
                    type: 'item',
                    fields: { '类型': '消耗品', '可堆叠': '是' },
                });
            }

            return loot;
        },
    };

    // ============================================================
    // 挂载 + 自动安装
    // ============================================================
    window.IndoorObjects = IndoorObjects;

    function boot() {
        IndoorObjects.install();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld] indoor/indoor-objects.js 已加载');
})();