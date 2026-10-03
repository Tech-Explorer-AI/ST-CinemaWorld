// ============================================================
// CinemaWorld · map-schema.js
// 地图数据结构 / 校验 / 归一化
// 依赖：无
// 暴露：window.MapSchema
// ============================================================

(function () {
    'use strict';

    // ============================================================
    // 地形类型 → 默认 emoji + 是否可走
    // 共 64 种，对齐 8×8 地形图集（索引 0~63）
    // ============================================================
    const TERRAIN_PRESET = {
        // ---------- 第 1 行（0~7）：户外地面 ----------
        grass: { emoji: '🌿', walkable: true, name: '草地' },
        tall_grass: { emoji: '🌾', walkable: true, name: '深草' },
        dry_grass: { emoji: '🍂', walkable: true, name: '干草' },
        dirt: { emoji: '🟫', walkable: true, name: '泥地' },
        sand: { emoji: '🟨', walkable: true, name: '沙地' },
        snow: { emoji: '❄️', walkable: true, name: '雪地' },
        gravel: { emoji: '🪨', walkable: true, name: '碎石地' },
        dirt_path: { emoji: '🟤', walkable: true, name: '土路' },

        // ---------- 第 2 行（8~15）：铺装地面 ----------
        stone: { emoji: '⬜', walkable: true, name: '石板路' },
        cobblestone: { emoji: '🪨', walkable: true, name: '鹅卵石路' },
        asphalt: { emoji: '⬛', walkable: true, name: '沥青路' },
        concrete: { emoji: '🔲', walkable: true, name: '水泥地' },
        brick: { emoji: '🧱', walkable: true, name: '红砖地' },
        tile: { emoji: '🔷', walkable: true, name: '瓷砖地' },
        wooden_deck: { emoji: '🟫', walkable: true, name: '木栈道' },
        pebble_path: { emoji: '⚪', walkable: true, name: '鹅卵石小径' },

        // ---------- 第 3 行（16~23）：室内地面 ----------
        wood: { emoji: '🟧', walkable: true, name: '木地板' },
        marble: { emoji: '⬜', walkable: true, name: '大理石' },
        carpet: { emoji: '🟥', walkable: true, name: '红地毯' },
        gray_carpet: { emoji: '⬜', walkable: true, name: '灰地毯' },
        ceramic: { emoji: '🔷', walkable: true, name: '瓷砖' },
        concrete_floor: { emoji: '🔲', walkable: true, name: '水泥地' },
        parquet: { emoji: '🟫', walkable: true, name: '拼木地板' },
        patterned_tile: { emoji: '🔶', walkable: true, name: '花纹地砖' },

        // ---------- 第 4 行（24~31）：墙面 ----------
        wall: { emoji: '🧱', walkable: false, name: '砖墙' },
        stone_wall: { emoji: '🪨', walkable: false, name: '石墙' },
        concrete_wall: { emoji: '⬜', walkable: false, name: '水泥墙' },
        wood_wall: { emoji: '🟫', walkable: false, name: '木墙' },
        white_wall: { emoji: '⬜', walkable: false, name: '白墙' },
        glass_wall: { emoji: '🪟', walkable: false, name: '玻璃幕墙' },
        metal_wall: { emoji: '⬜', walkable: false, name: '铁皮墙' },
        tile_wall: { emoji: '🔷', walkable: false, name: '瓷砖墙' },

        // ---------- 第 5 行（32~39）：水面 ----------
        water: { emoji: '🌊', walkable: false, name: '浅水' },
        deep_water: { emoji: '🌊', walkable: false, name: '深水' },
        sea: { emoji: '🌊', walkable: false, name: '海水' },
        lake: { emoji: '💧', walkable: false, name: '湖水' },
        river: { emoji: '🏞️', walkable: false, name: '河水' },
        ripple: { emoji: '💧', walkable: false, name: '水面波纹' },
        underwater: { emoji: '🌊', walkable: false, name: '水下' },
        waterfall: { emoji: '💦', walkable: false, name: '瀑布' },

        // ---------- 第 6 行（40~47）：自然边缘 ----------
        grass_edge: { emoji: '🌿', walkable: true, name: '草地边缘' },
        shore: { emoji: '🏖️', walkable: true, name: '水岸' },
        beach_edge: { emoji: '🏖️', walkable: true, name: '沙滩边缘' },
        snow_edge: { emoji: '❄️', walkable: true, name: '雪地边缘' },
        rocky_ground: { emoji: '🪨', walkable: true, name: '岩石地面' },
        cliff_top: { emoji: '⛰️', walkable: false, name: '山崖顶' },
        mud_edge: { emoji: '🟫', walkable: true, name: '泥地边缘' },
        fallen_leaves: { emoji: '🍂', walkable: true, name: '落叶地面' },

        // ---------- 第 7 行（48~55）：特殊地面 ----------
        lava: { emoji: '🔥', walkable: false, name: '岩浆' },
        swamp: { emoji: '🟢', walkable: false, name: '沼泽' },
        ice: { emoji: '🧊', walkable: true, name: '冰面' },
        snow_field: { emoji: '❄️', walkable: true, name: '雪原' },
        moss: { emoji: '🟢', walkable: true, name: '苔藓' },
        vine_ground: { emoji: '🌿', walkable: true, name: '藤蔓地面' },
        flower_field: { emoji: '🌸', walkable: true, name: '花草地' },
        dead_grass: { emoji: '🍂', walkable: true, name: '枯草地' },

        // ---------- 第 8 行（56~63）：界面用地面 ----------
        void: { emoji: '⬛', walkable: false, name: '虚空' },
        white_floor: { emoji: '⬜', walkable: true, name: '纯白地面' },
        gray_floor: { emoji: '🔘', walkable: true, name: '纯灰地面' },
        checkerboard: { emoji: '🏁', walkable: true, name: '棋盘格' },
        warning: { emoji: '⚠️', walkable: true, name: '警告条纹' },
        metal_floor: { emoji: '⬜', walkable: true, name: '金属地板' },
        glowing_floor: { emoji: '💡', walkable: true, name: '发光地板' },
        transparent: { emoji: '⬜', walkable: true, name: '透明格' },

        // ---------- 兼容旧名 ----------
        rock: { emoji: '🪨', walkable: false, name: '岩石' },
        tree: { emoji: '🌳', walkable: false, name: '树' },
        road: { emoji: '🔳', walkable: true, name: '道路' },
        path: { emoji: '🟩', walkable: true, name: '小径' },
        floor: { emoji: '⬜', walkable: true, name: '地板' },
    };

    // ============================================================
    // 区域类型 → 默认尺寸 / 地形 / 内部锚点
    // ============================================================
    const REGION_PRESET = {
        // ---------- 通用 ----------
        town: { size: 'large', terrain: 'stone', anchors: ['center', 'north', 'south', 'east', 'west'] },
        plaza: { size: 'large', terrain: 'stone', anchors: ['center', 'north', 'south', 'east', 'west'] },
        street: { size: 'medium', terrain: 'stone', anchors: ['start', 'middle', 'end'] },
        building: { size: 'medium', terrain: 'floor', anchors: ['entrance', 'center', 'back', 'left', 'right'] },
        room: { size: 'small', terrain: 'floor', anchors: ['entrance', 'center', 'corner'] },
        road: { size: 'small', terrain: 'road', anchors: ['start', 'middle', 'end'] },

        // ---------- 现代 ----------
        apartment: { size: 'medium', terrain: 'floor', anchors: ['entrance', 'center', 'balcony'] },
        office: { size: 'medium', terrain: 'floor', anchors: ['entrance', 'desk', 'meeting'] },
        shop: { size: 'small', terrain: 'floor', anchors: ['entrance', 'counter', 'shelf'] },
        cafe: { size: 'small', terrain: 'wood', anchors: ['entrance', 'bar', 'table'] },
        restaurant: { size: 'medium', terrain: 'wood', anchors: ['entrance', 'bar', 'table', 'kitchen'] },
        school: { size: 'large', terrain: 'floor', anchors: ['entrance', 'classroom', 'yard'] },
        hospital: { size: 'large', terrain: 'floor', anchors: ['entrance', 'ward', 'office'] },
        station: { size: 'medium', terrain: 'stone', anchors: ['entrance', 'platform', 'exit'] },
        park: { size: 'large', terrain: 'grass', anchors: ['center', 'bench', 'pond'] },
        parking: { size: 'medium', terrain: 'stone', anchors: ['entrance', 'center'] },
        alley: { size: 'small', terrain: 'stone', anchors: ['start', 'end'] },

        // ---------- 自然 ----------
        forest: { size: 'large', terrain: 'grass', anchors: ['center', 'clearing', 'edge'] },
        field: { size: 'large', terrain: 'dirt', anchors: ['center', 'edge'] },
        lake: { size: 'large', terrain: 'water', anchors: ['center', 'shore'] },
        mountain: { size: 'large', terrain: 'rock', anchors: ['center', 'peak', 'base'] },
        cave: { size: 'medium', terrain: 'rock', anchors: ['entrance', 'center', 'deep'] },
        beach: { size: 'large', terrain: 'sand', anchors: ['center', 'shore'] },
        camp: { size: 'small', terrain: 'dirt', anchors: ['center', 'fire', 'tent'] },

        // ---------- 兜底 ----------
        default: { size: 'medium', terrain: 'stone', anchors: ['center', 'north', 'south', 'east', 'west'] },
    };

    // ============================================================
    // 尺寸映射
    // ============================================================
    const SIZE_MAP = {
        tiny: 6,
        small: 10,
        medium: 16,
        large: 24,
        huge: 32,
    };

    // ============================================================
    // 地图分级（按区域数）
    // ============================================================
    const MAP_TIER = {
        small: { maxRegions: 4, minW: 40, minH: 30 },
        medium: { maxRegions: 8, minW: 60, minH: 45 },
        large: { maxRegions: 15, minW: 100, minH: 75 },
        huge: { maxRegions: 30, minW: 160, minH: 120 },
    };

    // ============================================================
    // 建筑尺寸预制
    // ============================================================
    const BUILDING_SIZE = {
        '1x1': { w: 1, h: 1 },
        '2x2': { w: 2, h: 2 },
        '3x3': { w: 3, h: 3 },
        '4x4': { w: 4, h: 4 },
        '5x5': { w: 5, h: 5 },
        '6x6': { w: 6, h: 6 },
    };

    // 布尔归一化
    const TRUE_VALUES = ['是', 'yes', 'true', '1', 'y', '可', '能'];

    // ============================================================
    // MapSchema
    // ============================================================
    const MapSchema = {
        TERRAIN_PRESET,
        REGION_PRESET,
        SIZE_MAP,
        MAP_TIER,
        BUILDING_SIZE,

        // ============================================================
        // 归一化
        // ============================================================
        normalize(raw) {
            const map = {
                id: raw.id || `map_${Date.now()}`,
                name: raw.name || '无名区域',
                description: raw.description || '',
                background: raw.background || '',
                music: raw.music || '',
                seed: raw.seed ?? Math.floor(Math.random() * 1e9),
                startRegion: raw.startRegion || null,
                regions: [],
                connections: [],
                entities: [],
                scenes: raw.scenes || {},
                buildingCatalog: raw.buildingCatalog || {},
        
                // ★ 玩法区（plot）
                _plots: (raw._plots && typeof raw._plots === 'object')
                    ? JSON.parse(JSON.stringify(raw._plots))
                    : {},
        
                _environment: {},
                _generated: null,
                _rawText: raw._rawText || null,
        
                _source: raw._source || null,
                tags: Array.isArray(raw.tags) ? raw.tags : [],
            };
        
            // ---------- regions ----------
            const regions = Array.isArray(raw.regions) ? raw.regions : [];
            for (const r of regions) {
                if (!r || !r.id) continue;
                const size = r.size || 'medium';
                const terrain = r.terrain || 'stone';
        
                map.regions.push({
                    id: String(r.id),
                    name: r.name || r.id,
                    type: r.type || 'default',
                    size,
                    terrain,
                    shape: r.shape || 'rect',
                    tags: Array.isArray(r.tags) ? r.tags : [],
                    description: r.description || '',
                    anchors: r.anchors || ['center', 'north', 'south', 'east', 'west'],
                    sceneName: r.sceneName || null,
        
                    terrains: Array.isArray(r.terrains) ? r.terrains : [],
                    decors: Array.isArray(r.decors) ? r.decors : [],
                    minis: Array.isArray(r.minis) ? r.minis : [],
                    buildings: Array.isArray(r.buildings) ? r.buildings : [],
                });
            }
        
            // 起点兜底
            if (!map.startRegion || !map.regions.some(r => r.id === map.startRegion)) {
                map.startRegion = map.regions[0]?.id || null;
            }
        
            // ---------- connections ----------
            const conns = Array.isArray(raw.connections) ? raw.connections : [];
            for (const c of conns) {
                if (!c || !c.from || !c.to) continue;
                if (c.from === c.to) continue;
                map.connections.push({
                    from: String(c.from),
                    to: String(c.to),
                    direction: c.direction || 'any',
                    distance: c.distance || 'medium',
                    kind: c.kind || 'road',
                });
            }
        
            // ---------- entities ----------
            const ents = Array.isArray(raw.entities) ? raw.entities : [];
            for (const e of ents) {
                if (!e || !e.id) continue;
        
                const normalized = {
                    id: String(e.id),
                    name: e.name || e.id,
                    emoji: e.emoji || '❓',
                    kind: e.kind || 'npc',
                    region: e.region || null,
                    position: e.position || 'center',
                    blocking: e.blocking !== false,
                    isPlayer: !!e.isPlayer,
                    tags: Array.isArray(e.tags) ? e.tags : [],
                    description: e.description || '',
                    meta: e.meta || {},
        
                    status: e.status || '',
                    effect: e.effect || '',
                    fields: (e.fields && typeof e.fields === 'object') ? e.fields : {},
                    interactions: Array.isArray(e.interactions) ? e.interactions : [],
                    extraStats: e.extraStats || { _order: [], _raw: '' },
                    count: typeof e.count === 'number' ? e.count : 1,
                    countMode: e.countMode || (
                        (e.kind === 'encounter' || e.kind === 'npc') && (e.count || 1) > 1
                            ? 'cluster'
                            : 'single'
                    ),
                    stackable: !!e.stackable,
                    maxStack: e.maxStack || null,
                    type: e.type || 'entity',
                };
        
                if (e.kind === 'building') {
                    normalized.anchor = e.anchor || null;
                    normalized.size = e.size || { w: 3, h: 3 };
                    normalized.entrance = e.entrance || null;
                    normalized.entranceDir = e.entranceDir || 'south';
                    normalized.linkedRegion = e.linkedRegion || null;
                    normalized.linkedScene = e.linkedScene || null;
                    normalized.isTemplate = !!e.isTemplate;
                    normalized.wallTile = e.wallTile || null;
                    normalized.roofTile = e.roofTile || null;
                    normalized.doorTile = e.doorTile || null;
                    normalized.spawnCount = e.spawnCount || e.count || 1;
                    normalized.isTiny = (normalized.size.w <= 1 && normalized.size.h <= 1);
                    if (normalized.isTiny) {
                        normalized.linkedRegion = null;
                        normalized.linkedScene = null;
                    }
                }
        
                if (e.kind === 'decor') {
                    normalized.size = e.size || { w: 1, h: 1 };
                    normalized.decorType = e.decorType || 'building';
                    normalized.variant = e.variant ?? 0;
                    normalized.anchor = e.anchor || null;
                }
        
                map.entities.push(normalized);
            }
        
            // 保证有玩家
            if (!map.entities.some(e => e.isPlayer)) {
                map.entities.push({
                    id: 'player',
                    name: '玩家',
                    emoji: '🧍',
                    kind: 'player',
                    region: map.startRegion,
                    position: 'center',
                    blocking: false,
                    isPlayer: true,
                    tags: [],
                    description: '',
                    meta: {},
                    status: '',
                    effect: '',
                    fields: {},
                    interactions: [],
                    extraStats: { _order: [], _raw: '' },
                    count: 1,
                    stackable: false,
                    maxStack: null,
                    type: 'player',
                });
            } else {
                const p = map.entities.find(e => e.isPlayer);
                if (map.startRegion) p.region = map.startRegion;
            }
        
            // 所有实体兜底 region
            for (const e of map.entities) {
                if (!e.region && map.startRegion) {
                    e.region = map.startRegion;
                }
            }
        
            return map;
        },

        // ============================================================
        // 序列化
        // ============================================================
        serialize(map) {
            if (!map) return null;
            const out = JSON.parse(JSON.stringify(map, (key, value) => {
                if ((key === 'scenes' || key === 'childMaps') && value && typeof value === 'object') {
                    const names = {};
                    for (const [k, v] of Object.entries(value)) {
                        names[k] = typeof v === 'object' ? { name: v.name } : v;
                    }
                    return names;
                }
                return value;
            }));
            delete out._generated;
            delete out._check;
            delete out._rawText;
        
            // ★ 显式保留背景字段（防止被意外 strip）
            out.generatedBackgroundId = map.generatedBackgroundId || null;
            out.generatedBackgroundPrompt = map.generatedBackgroundPrompt || null;
            out.generatedBackgroundAt = map.generatedBackgroundAt || null;
        
            return out;
        },

        // ============================================================
        // 反序列化
        // ============================================================
        deserialize(data, worldManager) {
            if (!data) return null;
            const map = this.normalize(data);

            // 用名字找回场景真身
            if (map.scenes) {
                const real = {};
                for (const [k, v] of Object.entries(map.scenes)) {
                    const scene = worldManager?.findEntity?.(k);
                    if (scene && !Array.isArray(scene.regions)) {
                        real[k] = scene;
                    }
                }
                map.scenes = real;
            }

            // 用名字找回子地图真身
            if (map.childMaps) {
                const real = {};
                for (const [k, v] of Object.entries(map.childMaps)) {
                    const child = worldManager?.getMap?.(k);
                    if (child) real[k] = child;
                }
                map.childMaps = real;
            }

            return map;
        },

        // ============================================================
        // 校验
        // ============================================================
        validate(map) {
            const errors = [];
            const warnings = [];

            if (!map.regions.length) errors.push('地图没有任何区域');

            const ids = new Set(map.regions.map(r => r.id));
            if (ids.size !== map.regions.length) errors.push('区域 id 有重复');

            for (const c of map.connections) {
                if (!ids.has(c.from)) errors.push(`连接引用了不存在的区域: ${c.from}`);
                if (!ids.has(c.to)) errors.push(`连接引用了不存在的区域: ${c.to}`);
            }

            if (map.regions.length > 1) {
                const start = map.startRegion || map.regions[0].id;
                const reached = new Set([start]);
                let changed = true;
                while (changed) {
                    changed = false;
                    for (const c of map.connections) {
                        if (reached.has(c.from) && !reached.has(c.to)) {
                            reached.add(c.to); changed = true;
                        }
                        if (reached.has(c.to) && !reached.has(c.from)) {
                            reached.add(c.from); changed = true;
                        }
                    }
                }
                for (const r of map.regions) {
                    if (!reached.has(r.id)) warnings.push(`区域「${r.name}」不可达`);
                }
            }

            for (const e of map.entities) {
                if (e.region && !ids.has(e.region)) {
                    warnings.push(`实体「${e.name}」引用了不存在的区域: ${e.region}`);
                }
            }

            // 出入口检查
            const portals = map.entities.filter(e => e.kind === 'portal');
            const mapPortals = portals.filter(e => e.fields?.['目标类型'] === 'map');

            if (portals.length === 0) {
                warnings.push('这张地图没有任何出入口，玩家无法离开');
            } else if (mapPortals.length === 0) {
                warnings.push('这张地图没有通向其他地图的出入口，可能成为死胡同');
            }

            return { ok: errors.length === 0, errors, warnings };
        },

        // ============================================================
        // 工具
        // ============================================================
        sizeToNumber(size) {
            return SIZE_MAP[size] || SIZE_MAP.medium;
        },

        getTerrainPreset(name) {
            return TERRAIN_PRESET[name] || TERRAIN_PRESET.stone;
        },

        getRegionPreset(type) {
            return { size: 'medium', terrain: 'stone', anchors: ['center', 'north', 'south', 'east', 'west'] };
        },

        isTrue(v) {
            if (v === true) return true;
            if (v === false || v === undefined || v === null) return false;
            const s = String(v).trim().toLowerCase();
            return TRUE_VALUES.includes(s);
        },
    };

    window.MapSchema = MapSchema;
    console.log('[CinemaWorld] map-schema.js 已加载');
})();