// ============================================================
// CinemaWorld · map-decor.js
// 装饰 / 迷你建筑 / 大建筑表 / 关键词匹配 / 分布规则
// 依赖：map-tiles.js, map-schema.js
// 暴露：window.MapDecor
// ============================================================

(function () {
    'use strict';

    // ============================================================
    // 1. 词库表
    // ============================================================

    // ---------- 地形关键词表 ----------
    const TERRAIN_KEYWORDS = {
        // 户外地面
        grass:        ['草', '草地', '草原', '草坪'],
        tall_grass:   ['深草', '长草', '荒草'],
        dry_grass:    ['干草', '枯黄'],
        dirt:         ['泥土', '土', '泥地', '泥泞'],
        sand:         ['沙', '沙地', '沙滩', '砂石', '砂土', '沙子'],
        snow:         ['雪', '雪地', '积雪'],
        gravel:       ['砾石', '碎石', '碎石地', '碎砾', '石砾', '砾'],
        dirt_path:    ['土路', '泥路'],
        // 铺装地面
        stone:        ['石板', '石地', '石路', '铺装', '青石', '石阶'],
        cobblestone:  ['鹅卵石', '旧石路', '老街', '卵石'],
        asphalt:      ['柏油', '沥青', '马路'],
        concrete:     ['水泥', '混凝土', '水泥地'],
        brick:        ['砖', '红砖', '砖地'],
        tile:         ['瓷砖', '地砖'],
        wooden_deck:  ['木栈道', '木桥', '木板', '栈桥', '木地'],
        pebble_path:  ['鹅卵石小径', '小径'],
        // 室内
        wood:         ['木地板', '木地板', '木制地板'],
        marble:       ['大理石', '华贵', '殿堂'],
        carpet:       ['地毯', '红毯'],
        gray_carpet:  ['灰地毯'],
        ceramic:      ['陶瓷'],
        concrete_floor: ['水泥地板'],
        parquet:      ['拼木', '拼花'],
        patterned_tile: ['花纹地砖', '花砖'],
        // 墙面
        wall:         ['砖墙', '墙'],
        stone_wall:   ['石墙'],
        concrete_wall:['水泥墙'],
        wood_wall:    ['木墙'],
        white_wall:   ['白墙'],
        glass_wall:   ['玻璃幕墙'],
        metal_wall:   ['铁皮墙', '金属墙'],
        tile_wall:    ['瓷砖墙'],
        // 水面
        water:        ['水', '河', '湖', '溪', '海面', '水面', '池'],
        deep_water:   ['深水'],
        sea:          ['海', '海水'],
        lake:         ['湖', '湖泊'],
        river:        ['河', '河流'],
        ripple:       ['波纹', '水波'],
        underwater:   ['水下'],
        waterfall:    ['瀑布'],
        // 自然边缘
        grass_edge:   ['草边'],
        shore:        ['岸边', '水岸', '滩涂', '滩', '海滩'],
        beach_edge:   ['沙滩边缘'],
        snow_edge:    ['雪边'],
        rocky_ground: ['岩地', '岩石地面', '岩石', '岩'],
        cliff_top:    ['崖顶', '山顶'],
        mud_edge:     ['泥边'],
        fallen_leaves:['落叶', '枯叶', '落花', '花瓣'],
        // 特殊
        lava:         ['岩浆', '熔岩', '火'],
        swamp:        ['沼泽', '湿地', '泥沼'],
        ice:          ['冰', '冰面', '结冰'],
        snow_field:   ['雪原'],
        moss:         ['苔藓', '苔', '青苔', '青苔地'],
        vine_ground:  ['藤蔓', '藤'],
        flower_field: ['花田', '花海', '花地'],
        dead_grass:   ['枯草', '荒草'],
        // 界面
        void:         ['虚空'],
        white_floor:  ['纯白地', '白砂', '白沙'],
        gray_floor:   ['纯灰地'],
        checkerboard: ['棋盘格'],
        warning:      ['警告条纹'],
        metal_floor:  ['金属地板'],
        glowing_floor:['发光地板'],
        transparent:  ['透明'],
    };

    // ---------- 装饰关键词表（大类） ----------
    const DECOR_KEYWORDS = {
        // 自然
        tree:  ['树', '林', '乔木', '樱花', '樱', '梅', '松', '竹', '柳', '枯树', '古树'],
        plant: ['花', '草', '植', '藤', '芦苇', '苔', '莲', '竹叶', '野花', '灌木', '丛'],
        rock:  ['石', '岩', '碎', '瓦', '砾', '石块', '碎石', '岩石'],

        // 街道
        lamp:  ['路灯', '街灯'],
        bench: ['长椅', '凳', '椅', '石凳', '木凳'],
        trash: ['垃圾桶', '垃圾'],
        sign:  ['告示', '路标', '牌', '标语', '木牌', '告示板', '布幌子', '幌子'],
    };

    // ---------- 装饰变体关键词（细分） ----------
    const DECOR_VARIANT_KEYWORDS = {
        tree: [
            { v: 0, keywords: ['普通', '绿树', '橡树'] },
            { v: 2, keywords: ['松', '松树', '针叶', '云杉'] },
            { v: 4, keywords: ['枯', '枯树', '死树'] },
            { v: 6, keywords: ['樱', '樱花', '粉'] },
            { v: 7, keywords: ['梅', '梅花'] },
        ],
        plant: [
            { v: 8,  keywords: ['花', '野花', '鲜花'] },
            { v: 12, keywords: ['灌木', '丛', '矮树'] },
        ],
        rock: [
            { v: 16, keywords: ['小石', '碎', '石子'] },
            { v: 18, keywords: ['大石', '巨石', '岩'] },
        ],
    };

    // ---------- 迷你建筑表（1×1） ----------
    const MINI_BUILDING_CATALOG = {
        kiosk:        { name: '摊位',   emoji: '🏪', decorType: 'small_building', variant: 0, blocking: true,  keywords: ['摊位', '小摊', '货摊', '摊贩'] },
        well:         { name: '水井',   emoji: '⛲', decorType: 'small_building', variant: 1, blocking: true,  keywords: ['水井', '井', '古井'] },
        stone_lantern:{ name: '石灯笼', emoji: '🏮', decorType: 'small_building', variant: 2, blocking: true,  keywords: ['石灯笼', '灯笼'] },
        shrine:       { name: '小祠',   emoji: '⛩️', decorType: 'small_building', variant: 3, blocking: true,  keywords: ['小祠', '神龛', '小庙'] },
        tent:         { name: '帐篷',   emoji: '⛺', decorType: 'small_building', variant: 4, blocking: true,  keywords: ['帐篷', '营地'] },
        shed:         { name: '棚屋',   emoji: '🛖', decorType: 'small_building', variant: 5, blocking: true,  keywords: ['棚屋', '棚子', '小屋', '棚'] },
        stall:        { name: '货摊',   emoji: '🛒', decorType: 'small_building', variant: 6, blocking: true,  keywords: ['货摊', '商铺小摊'] },
        mailbox:      { name: '信箱',   emoji: '📮', decorType: 'mailbox',       variant: 0, blocking: true,  keywords: ['信箱', '邮筒'] },
        hydrant:      { name: '消防栓', emoji: '🚒', decorType: 'hydrant',       variant: 0, blocking: true,  keywords: ['消防栓', '消防'] },
        bus_stop:     { name: '公交站', emoji: '🚌', decorType: 'bus_stop',      variant: 0, blocking: false, keywords: ['公交站', '车站', '候车'] },
        lamp:         { name: '路灯',   emoji: '💡', decorType: 'lamp',          variant: 0, blocking: true,  keywords: ['路灯', '街灯'] },
        signboard:    { name: '木牌',   emoji: '🪧', decorType: 'sign',          variant: 0, blocking: false, keywords: ['木牌', '告示板', '告示牌'] },
        mooring:      { name: '系船桩', emoji: '🪵', decorType: 'rock',          variant: 3, blocking: false, keywords: ['系船桩', '船桩', '缆绳'] },
        net_rack:     { name: '晾网架', emoji: '🎣', decorType: 'small_building', variant: 7, blocking: true,  keywords: ['晾网架', '渔网', '晾网'] },
        water_tub:    { name: '水缸',   emoji: '🏺', decorType: 'small_building', variant: 4, blocking: true,  keywords: ['水缸', '缸', '木桶', '桶'] },
        wood_bench:   { name: '长椅',   emoji: '🪑', decorType: 'bench',         variant: 0, blocking: false, keywords: ['长椅', '石凳', '木凳'] },
        water_basin:  { name: '水钵',   emoji: '⛲', decorType: 'small_building', variant: 1, blocking: true,  keywords: ['水钵', '手水舍'] },
        flags:        { name: '旗杆',   emoji: '🚩', decorType: 'small_building', variant: 6, blocking: true,  keywords: ['旗杆', '旗'] },
    };

    // ---------- 大建筑部件表 ----------
    const BUILDING_PARTS = {
        wall: [
            { key: 'brick_wall',    name: '砖墙',     variant: 0, keywords: ['砖', '红砖'] },
            { key: 'stone_wall',    name: '石墙',     variant: 1, keywords: ['石', '石砌'] },
            { key: 'concrete_wall', name: '水泥墙',   variant: 2, keywords: ['水泥', '混凝土'] },
            { key: 'wood_wall',     name: '木墙',     variant: 3, keywords: ['木', '木板'] },
            { key: 'white_wall',    name: '白墙',     variant: 4, keywords: ['白', '刷白'] },
            { key: 'glass_wall',    name: '玻璃幕墙', variant: 5, keywords: ['玻璃', '幕墙'] },
            { key: 'metal_wall',    name: '铁皮墙',   variant: 6, keywords: ['铁', '金属'] },
            { key: 'tile_wall',     name: '瓷砖墙',   variant: 7, keywords: ['瓷砖', '瓷'] },
        ],
        roof: [
            { key: 'red_roof',     name: '红瓦',   variant: 0, keywords: ['红瓦', '红顶'] },
            { key: 'gray_roof',    name: '灰瓦',   variant: 1, keywords: ['灰瓦', '灰顶'] },
            { key: 'flat_roof',    name: '平顶',   variant: 2, keywords: ['平顶', '现代'] },
            { key: 'pointed_roof', name: '尖顶',   variant: 3, keywords: ['尖顶', '塔'] },
            { key: 'glass_roof',   name: '玻璃顶', variant: 4, keywords: ['玻璃顶'] },
            { key: 'metal_roof',   name: '铁皮顶', variant: 5, keywords: ['铁皮顶', '金属顶'] },
            { key: 'thatch_roof',  name: '茅草顶', variant: 6, keywords: ['茅草', '草顶'] },
            { key: 'modern_roof',  name: '现代顶', variant: 7, keywords: ['现代', '简约'] },
        ],
        door: [
            { key: 'wood_door',      name: '木门',   variant: 0, keywords: ['木门'] },
            { key: 'glass_door',     name: '玻璃门', variant: 1, keywords: ['玻璃门'] },
            { key: 'iron_door',      name: '铁门',   variant: 2, keywords: ['铁门'] },
            { key: 'rolling_door',   name: '卷帘门', variant: 3, keywords: ['卷帘'] },
            { key: 'revolving_door', name: '旋转门', variant: 4, keywords: ['旋转'] },
            { key: 'auto_door',      name: '自动门', variant: 5, keywords: ['自动'] },
            { key: 'double_door',    name: '双开门', variant: 6, keywords: ['双开', '对开'] },
            { key: 'arch_door',      name: '拱门',   variant: 7, keywords: ['拱门', '拱形'] },
        ],
    };

    // ---------- 大建筑默认表 ----------
    const DEFAULT_BUILDING_CATALOG = {
        house: {
            name: '民居', emoji: '🏠', size: { w: 2, h: 2 },
            wallTile: 'brick_wall', roofTile: 'red_roof', doorTile: 'wood_door',
            doorSide: 'south', enterable: false,
            keywords: ['民居', '住宅', '小屋', '房子'],
        },
        shop: {
            name: '商铺', emoji: '🏪', size: { w: 3, h: 3 },
            wallTile: 'wood_wall', roofTile: 'flat_roof', doorTile: 'glass_door',
            doorSide: 'south', enterable: true,
            keywords: ['商铺', '商店', '小店', '店铺', '铺子'],
        },
        townhall: {
            name: '市政厅', emoji: '🏛️', size: { w: 5, h: 5 },
            wallTile: 'stone_wall', roofTile: 'pointed_roof', doorTile: 'double_door',
            doorSide: 'south', enterable: true,
            keywords: ['市政厅', '政府', '议会'],
        },
        tower: {
            name: '高楼', emoji: '🏢', size: { w: 5, h: 5 },
            wallTile: 'glass_wall', roofTile: 'modern_roof', doorTile: 'auto_door',
            doorSide: 'south', enterable: true,
            keywords: ['高楼', '大厦', '摩天', '塔楼'],
        },
        factory: {
            name: '工厂', emoji: '🏭', size: { w: 4, h: 4 },
            wallTile: 'concrete_wall', roofTile: 'metal_roof', doorTile: 'rolling_door',
            doorSide: 'south', enterable: true,
            keywords: ['工厂', '车间'],
        },
        temple: {
            name: '神殿', emoji: '⛩️', size: { w: 4, h: 4 },
            wallTile: 'stone_wall', roofTile: 'pointed_roof', doorTile: 'arch_door',
            doorSide: 'south', enterable: true,
            keywords: ['神殿', '神庙', '教堂', '寺庙'],
        },
    };

    // ---------- 装饰角色分类 ----------
    const DECOR_TYPE_ROLE = {
        tree: 'natural',
        plant: 'natural',
        rock: 'natural',
        lamp: 'facility',
        bench: 'facility',
        trash: 'facility',
        sign: 'facility',
        small_building: 'landmark',
        mailbox: 'facility',
        hydrant: 'facility',
        bus_stop: 'facility',
    };

    // ---------- 装饰 → 兼容地形白名单 ----------
    const DECOR_TERRAIN_AFFINITY = {
        tree:  ['grass', 'tall_grass', 'dirt', 'moss', 'flower_field', 'snow', 'dead_grass', 'fallen_leaves', 'grass_edge'],
        plant: ['grass', 'tall_grass', 'dirt', 'moss', 'flower_field', 'shore', 'sand', 'fallen_leaves'],
        rock:  ['stone', 'gravel', 'rock', 'dirt', 'snow', 'sand', 'rocky_ground', 'mud_edge', 'cliff_top', 'pebble_path'],
        lamp:  ['stone', 'cobblestone', 'concrete', 'brick', 'asphalt', 'tile'],
        bench: ['stone', 'grass', 'cobblestone', 'concrete', 'dirt'],
        trash: ['stone', 'cobblestone', 'concrete'],
        sign:  ['stone', 'dirt', 'grass', 'cobblestone', 'concrete'],
        small_building: ['stone', 'dirt', 'grass', 'cobblestone', 'concrete', 'sand', 'wooden_deck'],
        mailbox: ['stone', 'cobblestone', 'concrete'],
        hydrant: ['stone', 'cobblestone', 'concrete', 'asphalt'],
        bus_stop: ['stone', 'cobblestone', 'concrete', 'asphalt'],
    };

    // ============================================================
    // 2. 主体
    // ============================================================

    const MapDecor = {
        TERRAIN_KEYWORDS,
        DECOR_KEYWORDS,
        DECOR_VARIANT_KEYWORDS,
        MINI_BUILDING_CATALOG,
        BUILDING_PARTS,
        DEFAULT_BUILDING_CATALOG,
        DECOR_TYPE_ROLE,
        DECOR_TERRAIN_AFFINITY,

        _customTerrain: {},
        _customDecor: {},
        _customMini: {},
        _customBuilding: {},

        // ============================================================
        // 词库管理
        // ============================================================
        setCustomTerrain(dict) { this._customTerrain = dict || {}; },
        setCustomDecor(dict) { this._customDecor = dict || {}; },
        setCustomMini(dict) { this._customMini = dict || {}; },
        setCustomBuilding(dict) { this._customBuilding = dict || {}; },
        resetCustom() {
            this._customTerrain = {};
            this._customDecor = {};
            this._customMini = {};
            this._customBuilding = {};
        },

        _terrainTable() { return { ...TERRAIN_KEYWORDS, ...this._customTerrain }; },
        _decorTable() { return { ...DECOR_KEYWORDS, ...this._customDecor }; },
        _miniTable() { return { ...MINI_BUILDING_CATALOG, ...this._customMini }; },
        _buildingTable() { return { ...DEFAULT_BUILDING_CATALOG, ...this._customBuilding }; },

        // ============================================================
        // 匹配
        // ============================================================
        matchTerrain(word) {
            return this._matchByKeywords(word, this._terrainTable());
        },

        matchDecor(word) {
            const type = this._matchByKeywords(word, this._decorTable());
            if (!type) return null;
            let variant = null;
            const variantRules = DECOR_VARIANT_KEYWORDS[type];
            if (variantRules) {
                variant = this._matchVariant(word, variantRules);
            }
            return { type, variant };
        },

        matchMini(word) {
            const table = this._miniTable();
            let bestKey = null;
            let bestLen = 0;

            for (const [key, def] of Object.entries(table)) {
                for (const kw of (def.keywords || [])) {
                    if (word.includes(kw) && kw.length > bestLen) {
                        bestKey = key;
                        bestLen = kw.length;
                    }
                }
                if (def.name && word.includes(def.name) && def.name.length > bestLen) {
                    bestKey = key;
                    bestLen = def.name.length;
                }
            }
            if (!bestKey) return null;
            return { key: bestKey, def: table[bestKey] };
        },

        matchBuilding(word) {
            const table = this._buildingTable();
            let bestKey = null;
            let bestLen = 0;

            for (const [key, def] of Object.entries(table)) {
                for (const kw of (def.keywords || [])) {
                    if (word.includes(kw) && kw.length > bestLen) {
                        bestKey = key;
                        bestLen = kw.length;
                    }
                }
                if (def.name && word.includes(def.name) && def.name.length > bestLen) {
                    bestKey = key;
                    bestLen = def.name.length;
                }
            }
            if (!bestKey) return null;
            return { key: bestKey, def: table[bestKey] };
        },

        matchBuildingPart(kind, word) {
            const list = BUILDING_PARTS[kind];
            if (!list) return null;
            let best = null;
            let bestLen = 0;
            for (const part of list) {
                for (const kw of (part.keywords || [])) {
                    if (word.includes(kw) && kw.length > bestLen) {
                        best = part;
                        bestLen = kw.length;
                    }
                }
                if (word.includes(part.name) && part.name.length > bestLen) {
                    best = part;
                    bestLen = part.name.length;
                }
            }
            return best;
        },

        _matchByKeywords(word, table) {
            if (!word) return null;
            let best = null;
            let bestLen = 0;

            for (const [key, value] of Object.entries(table)) {
                const list = Array.isArray(value) ? value : (value.keywords || []);
                for (const kw of list) {
                    if (word.includes(kw) && kw.length > bestLen) {
                        best = key;
                        bestLen = kw.length;
                    }
                }
            }
            return best;
        },

        _matchVariant(word, rules) {
            let best = null;
            let bestLen = 0;
            for (const rule of rules) {
                for (const kw of (rule.keywords || [])) {
                    if (word.includes(kw) && kw.length > bestLen) {
                        best = rule.v;
                        bestLen = kw.length;
                    }
                }
            }
            return best;
        },

        // ============================================================
        // 区域清单 → 资源清单
        // ============================================================
        resolveRegionSpec(regionSpec) {
            const out = { terrains: [], decors: [], minis: [], buildings: [] };

            for (const w of (regionSpec.terrains || [])) {
                const key = this.matchTerrain(w);
                if (key) out.terrains.push({ raw: w, key });
            }

            for (const w of (regionSpec.decors || [])) {
                const m = this.matchDecor(w);
                if (m) out.decors.push({ raw: w, type: m.type, variant: m.variant });
            }

            for (const w of (regionSpec.minis || [])) {
                const m = this.matchMini(w);
                if (m) out.minis.push({ raw: w, key: m.key, def: m.def });
            }

            for (const w of (regionSpec.buildings || [])) {
                const { name, count } = this._parseCount(w);
                const m = this.matchBuilding(name);
                if (m) out.buildings.push({ raw: w, key: m.key, def: m.def, count });
            }

            return out;
        },

        _parseCount(text) {
            const m = String(text).match(/^(.+?)\s*[×xX*]\s*(\d+)$/);
            if (m) return { name: m[1].trim(), count: parseInt(m[2]) };
            return { name: String(text).trim(), count: 1 };
        },

        // ============================================================
        // 3. 装饰布局生成
        // ============================================================
        decorateRegion(grid, regionRect, resources, ctx) {
            const { rng, isRoadAt, isBuildingAt } = ctx;

            // 1. 地形（主地形 + 副地形扩散）
            this._applyTerrains(grid, regionRect, resources.terrains, rng);

            // 2. 距离场
            const distField = this._buildDistanceField(grid, regionRect, {
                isRoadAt, isBuildingAt,
            });

            // 3. 装饰按角色分层
            const placed = [];

            this._placeNaturalDecors(grid, regionRect, resources.decors, distField, rng, placed);
            this._placeFacilities(grid, regionRect, resources.decors, distField, rng, placed);
            this._placeLandmarks(grid, regionRect, resources.minis, distField, rng, placed);
        },
        

        // ---------- 地形 ----------
        _applyTerrains(grid, rect, terrains, rng) {
            // 没有地形清单：兜底 stone
            if (!terrains || terrains.length === 0) {
                const presets = window.MapSchema?.TERRAIN_PRESET || {};
                const preset = presets['stone'] || { walkable: true, emoji: '⬜' };
                for (let y = rect.y; y < rect.y + rect.h; y++) {
                    for (let x = rect.x; x < rect.x + rect.w; x++) {
                        const cell = grid[y]?.[x];
                        if (!cell) continue;
                        if (cell.regionId) continue;
                        cell.terrain = 'stone';
                        cell.regionId = rect.regionId || null;
                        cell.walkable = preset.walkable ?? true;
                        cell.emoji = preset.emoji || '⬜';
                    }
                }
                return;
            }

            const presets = window.MapSchema?.TERRAIN_PRESET || {};

            // 主地形铺满
            const main = terrains[0];
            const mainPreset = presets[main.key];
            if (!mainPreset) return;

            for (let y = rect.y; y < rect.y + rect.h; y++) {
                for (let x = rect.x; x < rect.x + rect.w; x++) {
                    const cell = grid[y]?.[x];
                    if (!cell) continue;
                    if (cell.regionId) continue;

                    cell.terrain = main.key;
                    cell.regionId = rect.regionId || null;
                    cell.walkable = mainPreset.walkable;
                    cell.emoji = mainPreset.emoji;
                }
            }

            // 副地形：种子点扩散（只长在通行性一致的地形上）
            if (terrains.length <= 1) return;

            const area = rect.w * rect.h;
            for (let i = 1; i < terrains.length; i++) {
                const sub = terrains[i];
                const subPreset = presets[sub.key];
                if (!subPreset) continue;

                const seedCount = Math.max(1, Math.min(4, Math.floor(area / 200)));

                for (let s = 0; s < seedCount; s++) {
                    const sx = rect.x + 1 + Math.floor(rng() * Math.max(1, rect.w - 2));
                    const sy = rect.y + 1 + Math.floor(rng() * Math.max(1, rect.h - 2));
                    this._floodFill(grid, sx, sy, 2 + Math.floor(rng() * 2), rect, sub.key, subPreset);
                }
            }
        },

        // ---------- BFS 扩散（修孤岛） ----------
        _floodFill(grid, sx, sy, radius, rect, terrainKey, preset) {
            const seedCell = grid[sy]?.[sx];
            if (!seedCell) return;

            const seedWalkable = seedCell.walkable;

            // 通行性不同 → 不铺
            if (seedWalkable !== preset.walkable) return;

            const queue = [[sx, sy, 0]];
            const visited = new Set([`${sx},${sy}`]);
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

            while (queue.length > 0) {
                const [x, y, d] = queue.shift();

                if (x < rect.x || x >= rect.x + rect.w) continue;
                if (y < rect.y || y >= rect.y + rect.h) continue;

                const cell = grid[y]?.[x];
                if (!cell) continue;

                if (cell.walkable !== seedWalkable) continue;

                cell.terrain = terrainKey;
                cell.emoji = preset.emoji;

                if (d >= radius) continue;

                for (const [dx, dy] of dirs) {
                    const nx = x + dx, ny = y + dy;
                    const key = `${nx},${ny}`;
                    if (visited.has(key)) continue;
                    visited.add(key);
                    queue.push([nx, ny, d + 1]);
                }
            }
        },

        // ---------- 距离场 ----------
        _buildDistanceField(grid, rect, ctx) {
            const W = rect.w, H = rect.h;
            const distRoad = this._makeField(W, H);
            const distBuilding = this._makeField(W, H);

            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const gx = rect.x + x;
                    const gy = rect.y + y;
                    if (ctx.isRoadAt(gx, gy)) distRoad[y][x] = 0;
                    if (ctx.isBuildingAt(gx, gy)) distBuilding[y][x] = 0;
                }
            }

            this._bfsSpread(distRoad, W, H);
            this._bfsSpread(distBuilding, W, H);

            return { distRoad, distBuilding };
        },

        _makeField(W, H) {
            const f = [];
            for (let y = 0; y < H; y++) {
                const row = [];
                for (let x = 0; x < W; x++) row.push(Infinity);
                f.push(row);
            }
            return f;
        },

        _bfsSpread(field, W, H) {
            const queue = [];
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    if (field[y][x] === 0) queue.push([x, y]);
                }
            }

            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            let head = 0;

            while (head < queue.length) {
                const [x, y] = queue[head++];
                const d = field[y][x];

                for (const [dx, dy] of dirs) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                    if (field[ny][nx] <= d + 1) continue;
                    field[ny][nx] = d + 1;
                    queue.push([nx, ny]);
                }
            }
        },

        // ---------- 自然装饰（3×3 簇） ----------
        _placeNaturalDecors(grid, rect, decors, distField, rng, placed) {
            if (!decors || decors.length === 0) return;

            const naturals = decors.filter(d =>
                (DECOR_TYPE_ROLE[d.type] || 'natural') === 'natural'
            );
            if (naturals.length === 0) return;

            // 限制种类：一个区域最多 2 种
            const picked = this._pickN(naturals, 2, rng);

            const area = rect.w * rect.h;
            // 每种的簇数：小区域 1 簇，大区域 2~3 簇
            const clusterCount = Math.max(1, Math.min(3, Math.floor(area / 200)));

            for (const d of picked) {
                for (let c = 0; c < clusterCount; c++) {
                    const seed = this._findSeed(grid, rect, distField, rng, placed, 3, d);
                    if (!seed) continue;
                    this._growCluster3x3(grid, seed, d, rng, placed);
                }
            }
        },

        // ---------- 3×3 簇生成 ----------
        _growCluster3x3(grid, seed, decor, rng, placed) {
            const R = 1;

            for (let dy = -R; dy <= R; dy++) {
                for (let dx = -R; dx <= R; dx++) {
                    const x = seed.x + dx;
                    const y = seed.y + dy;
                    const cell = grid[y]?.[x];
                    if (!cell) continue;
                    if (cell.terrain === 'void') continue;
                    if (cell.road || cell.decor) continue;
                    if (!cell.walkable) continue;

                    // 地形兼容
                    if (!this._isDecorTerrainCompatible(decor.type, cell.terrain)) continue;

                    // 70% 概率放置
                    if (rng() > 0.7) continue;

                    this._applyDecorCell(cell, decor, rng);
                    placed.push({ x, y });
                }
            }
        },

        // ---------- 街道设施（沿路） ----------
        _placeFacilities(grid, rect, decors, distField, rng, placed) {
            if (!decors || decors.length === 0) return;

            const facilities = decors.filter(d =>
                DECOR_TYPE_ROLE[d.type] === 'facility'
            );
            if (facilities.length === 0) return;

            const candidates = [];
            for (let y = 0; y < rect.h; y++) {
                for (let x = 0; x < rect.w; x++) {
                    const dRoad = distField.distRoad[y]?.[x];
                    if (dRoad !== 1 && dRoad !== 2) continue;
                    const gx = rect.x + x, gy = rect.y + y;
                    const cell = grid[gy]?.[gx];
                    if (!cell) continue;
                    if (cell.terrain === 'void') continue;
                    if (cell.road || cell.decor) continue;
                    if (!cell.walkable) continue;
                    candidates.push({ x: gx, y: gy });
                }
            }

            if (candidates.length === 0) return;

            const maxCount = Math.min(3, Math.floor(candidates.length / 3));
            const shuffled = this._shuffle(candidates, rng);

            const placedFacilities = [];
            let count = 0;

            for (const pos of shuffled) {
                if (count >= maxCount) break;

                let tooClose = false;
                for (const p of placedFacilities) {
                    if (Math.abs(p.x - pos.x) + Math.abs(p.y - pos.y) < 4) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;

                const cell = grid[pos.y]?.[pos.x];
                if (!cell) continue;

                const d = facilities[Math.floor(rng() * facilities.length)];
                if (!this._isDecorTerrainCompatible(d.type, cell.terrain)) continue;

                this._applyDecorCell(cell, d, rng);
                placed.push(pos);
                placedFacilities.push(pos);
                count++;
            }
        },

        // ---------- 迷你建筑（地标） ----------
        _placeLandmarks(grid, rect, minis, distField, rng, placed) {
            if (!minis || minis.length === 0) return;

            const area = rect.w * rect.h;
            const maxCount = Math.min(3, Math.max(1, Math.floor(area / 100)));

            const placedLandmarks = [];

            for (let i = 0; i < maxCount; i++) {
                const pos = this._findLandmarkPos(grid, rect, distField, rng, placedLandmarks);
                if (!pos) continue;

                const m = minis[Math.floor(rng() * minis.length)];
                const cell = grid[pos.y]?.[pos.x];
                if (!cell) continue;

                if (!this._isDecorTerrainCompatible(m.def.decorType, cell.terrain)) continue;

                cell.decor = {
                    type: m.def.decorType,
                    variant: m.def.variant,
                    miniBuilding: m.key,
                };
                if (m.def.blocking) cell.walkable = false;

                placed.push(pos);
                placedLandmarks.push(pos);
            }
        },

        // ---------- 工具 ----------
        _isDecorTerrainCompatible(decorType, terrain) {
            const allowed = DECOR_TERRAIN_AFFINITY[decorType];
            if (!allowed) return true;
            return allowed.includes(terrain);
        },

        _findSeed(grid, rect, distField, rng, placed, minDist, decor) {
            const maxTry = 30;
            for (let t = 0; t < maxTry; t++) {
                const x = rect.x + 1 + Math.floor(rng() * Math.max(1, rect.w - 2));
                const y = rect.y + 1 + Math.floor(rng() * Math.max(1, rect.h - 2));

                const cell = grid[y]?.[x];
                if (!cell) continue;
                if (cell.terrain === 'void') continue;
                if (cell.road || cell.decor) continue;
                if (!cell.walkable) continue;

                const dx = x - rect.x, dy = y - rect.y;
                const dRoad = distField.distRoad[dy]?.[dx] ?? Infinity;
                const dBldg = distField.distBuilding[dy]?.[dx] ?? Infinity;
                if (dRoad <= 1) continue;
                if (dBldg <= 1) continue;

                if (decor && !this._isDecorTerrainCompatible(decor.type, cell.terrain)) continue;

                let tooClose = false;
                for (const p of placed) {
                    if (Math.abs(p.x - x) + Math.abs(p.y - y) < minDist) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;

                return { x, y };
            }
            return null;
        },

        _findLandmarkPos(grid, rect, distField, rng, placedLandmarks) {
            const maxTry = 20;
            for (let t = 0; t < maxTry; t++) {
                const x = rect.x + 1 + Math.floor(rng() * Math.max(1, rect.w - 2));
                const y = rect.y + 1 + Math.floor(rng() * Math.max(1, rect.h - 2));

                const cell = grid[y]?.[x];
                if (!cell) continue;
                if (cell.terrain === 'void') continue;
                if (cell.road || cell.decor) continue;
                if (!cell.walkable) continue;

                const dx = x - rect.x, dy = y - rect.y;
                const dRoad = distField.distRoad[dy]?.[dx] ?? Infinity;
                const dBldg = distField.distBuilding[dy]?.[dx] ?? Infinity;
                if (dRoad < 1 || dRoad > 4) continue;
                if (dBldg <= 1) continue;

                let tooClose = false;
                for (const p of placedLandmarks) {
                    if (Math.abs(p.x - x) + Math.abs(p.y - y) < 5) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;

                return { x, y };
            }
            return null;
        },

        _applyDecorCell(cell, decor, rng) {
            const variants = window.MapTiles?.DECOR_INDEX?.[decor.type];
            if (!variants) return;

            // 地形兼容检查（双保险）
            if (!this._isDecorTerrainCompatible(decor.type, cell.terrain)) return;

            let variant;
            if (decor.variant !== null && decor.variant !== undefined) {
                variant = decor.variant;
            } else {
                variant = Math.floor(rng() * 8);
            }

            const blocking = ['tree', 'rock', 'small_building'].includes(decor.type);

            cell.decor = { type: decor.type, variant };
            if (blocking) cell.walkable = false;
        },

        _pickN(arr, n, rng) {
            if (arr.length <= n) return [...arr];
            const copy = [...arr];
            const out = [];
            for (let i = 0; i < n; i++) {
                const idx = Math.floor(rng() * copy.length);
                out.push(copy.splice(idx, 1)[0]);
            }
            return out;
        },

        _shuffle(arr, rng) {
            const copy = [...arr];
            for (let i = copy.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [copy[i], copy[j]] = [copy[j], copy[i]];
            }
            return copy;
        },
    };

    window.MapDecor = MapDecor;
    console.log('[CinemaWorld] map-decor.js 已加载');
})();