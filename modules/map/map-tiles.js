// ============================================================
// CinemaWorld · map-tiles.js
// 瓦片图集：地形层 + 装饰层
// 依赖：无
// 暴露：window.MapTiles
// ============================================================

(function () {
    'use strict';

    // ---------- 路径推导 ----------
    const BASE_PATH = (() => {
        const cur = document.currentScript;
        if (cur && cur.src) {
            return cur.src.replace(/modules\/map\/map-tiles\.js.*$/, '');
        }
        for (const s of document.querySelectorAll('script[src]')) {
            if (/map-tiles\.js/.test(s.src)) {
                return s.src.replace(/modules\/map\/map-tiles\.js.*$/, '');
            }
        }
        return 'scripts/extensions/third-party/ST-CinemaWorld-main/';
    })();

    const MapTiles = {
        // ============================================================
        // 配置
        // ============================================================

        // 地形图集（8×8 = 64 格）
        terrainConfig: {
            src: BASE_PATH + 'images/地图/地形.png',
            tileSize: 32,
            cols: 8,
            rows: 8,
            pad: 0,
        },

        // 装饰图集（8×8 = 64 格）
        decorConfig: {
            src: BASE_PATH + 'images/地图/装饰.png',
            tileSize: 32,
            cols: 8,
            rows: 8,
            pad: 0,
        },

        // ============================================================
        // 状态
        // ============================================================
        terrainImage: null,
        terrainLoaded: false,
        _terrainLoadPromise: null,

        decorImage: null,
        decorLoaded: false,
        _decorLoadPromise: null,

        // ============================================================
        // 地形 → 图集索引（0~63）
        // 按 8×8 地形图集的实际排列
        // ============================================================
        TERRAIN_INDEX: {
            // 第 1 行：户外地面
            grass: 0, tall_grass: 1, dry_grass: 2, dirt: 3,
            sand: 4, snow: 5, gravel: 6, dirt_path: 7,

            // 第 2 行：铺装地面
            stone: 8, cobblestone: 9, asphalt: 10, concrete: 11,
            brick: 12, tile: 13, wooden_deck: 14, pebble_path: 15,

            // 第 3 行：室内地面
            wood: 16, marble: 17, carpet: 18, gray_carpet: 19,
            ceramic: 20, concrete_floor: 21, parquet: 22, patterned_tile: 23,

            // 第 4 行：墙面
            wall: 24, stone_wall: 25, concrete_wall: 26, wood_wall: 27,
            white_wall: 28, glass_wall: 29, metal_wall: 30, tile_wall: 31,

            // 第 5 行：水面
            water: 32, deep_water: 33, sea: 34, lake: 35,
            river: 36, ripple: 37, underwater: 38, waterfall: 39,

            // 第 6 行：自然边缘
            grass_edge: 40, shore: 41, beach_edge: 42, snow_edge: 43,
            rocky_ground: 44, cliff_top: 45, mud_edge: 46, fallen_leaves: 47,

            // 第 7 行：特殊地面
            lava: 48, swamp: 49, ice: 50, snow_field: 51,
            moss: 52, vine_ground: 53, flower_field: 54, dead_grass: 55,

            // 第 8 行：界面用地面
            void: 56, white_floor: 57, gray_floor: 58, checkerboard: 59,
            warning: 60, metal_floor: 61, glowing_floor: 62, transparent: 63,

            // ---------- 兼容旧名 ----------
            rock: 44,        // → rocky_ground
            tree: 40,        // → grass_edge（装饰层的树才是真的树）
            road: 8,         // → stone
            path: 15,        // → pebble_path
            floor: 16,       // → wood
        },

        // ============================================================
        // 装饰 → 图集索引（0~63）
        // 按 8×8 装饰图集的实际排列
        // ============================================================
        DECOR_INDEX: {
            // 第 1 行：树木（8 种）
            tree:    [0, 1, 2, 3, 4, 5, 6, 7],

            // 第 2 行：植物（8 种）
            plant:   [8, 9, 10, 11, 12, 13, 14, 15],
            flower:  [8, 9, 10, 11],
            bush:    [12, 13, 14, 15],

            // 第 3 行：自然物（8 种）
            rock:    [16, 17, 18, 19, 20, 21, 22, 23],
            stone:   [16, 17, 18],

            // 第 4 行：小建筑（8 种）
            small_building: [24, 25, 26, 27, 28, 29, 30, 31],
            kiosk:   24,
            cabin:   28,

            // 第 5 行：建筑外墙（8 种，可平铺）
            wall:    [32, 33, 34, 35, 36, 37, 38, 39],
            brick_wall: 32,
            stone_wall: 33,
            concrete_wall: 34,
            wood_wall: 35,
            white_wall: 36,
            glass_wall: 37,
            metal_wall: 38,
            tile_wall: 39,

            // 第 6 行：建筑屋顶（8 种，可平铺）
            roof:    [40, 41, 42, 43, 44, 45, 46, 47],
            red_roof: 40,
            gray_roof: 41,
            flat_roof: 42,
            pointed_roof: 43,
            glass_roof: 44,
            metal_roof: 45,
            thatch_roof: 46,
            modern_roof: 47,

            // 第 7 行：门与入口（8 种）
            door:    [48, 49, 50, 51, 52, 53, 54, 55],
            wood_door: 48,
            glass_door: 49,
            iron_door: 50,
            rolling_door: 51,
            revolving_door: 52,
            auto_door: 53,
            double_door: 54,
            arch_door: 55,

            // 第 8 行：街道设施与家具（8 种）
            lamp:    56,
            bench:   57,
            trash:   58,
            mailbox: 59,
            bus_stop: 60,
            hydrant: 61,
            table:   62,
            chair:   63,
        },

        // ============================================================
        // 加载：地形图集
        // ============================================================
        loadTerrain() {
            if (this._terrainLoadPromise) return this._terrainLoadPromise;
            this._terrainLoadPromise = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.terrainImage = img;
                    this.terrainLoaded = true;
                    console.log('[MapTiles] 地形图集已加载:', img.width, 'x', img.height);
                    resolve(img);
                };
                img.onerror = () => {
                    console.error('[MapTiles] 地形图集加载失败:', this.terrainConfig.src);
                    this.terrainLoaded = false;
                    resolve(null);
                };
                img.src = this.terrainConfig.src;
            });
            return this._terrainLoadPromise;
        },

        // ============================================================
        // 加载：装饰图集
        // ============================================================
        loadDecor() {
            if (this._decorLoadPromise) return this._decorLoadPromise;
            this._decorLoadPromise = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.decorImage = img;
                    this.decorLoaded = true;
                    console.log('[MapTiles] 装饰图集已加载:', img.width, 'x', img.height);
                    resolve(img);
                };
                img.onerror = () => {
                    console.error('[MapTiles] 装饰图集加载失败:', this.decorConfig.src);
                    this.decorLoaded = false;
                    resolve(null);
                };
                img.src = this.decorConfig.src;
            });
            return this._decorLoadPromise;
        },

        // 兼容旧接口：一次加载两张
        load() {
            return Promise.all([this.loadTerrain(), this.loadDecor()]);
        },

        // ============================================================
        // 就绪检查
        // ============================================================
        ready() {
            return this.terrainLoaded && !!this.terrainImage;
        },

        decorReady() {
            return this.decorLoaded && !!this.decorImage;
        },

        // ============================================================
        // 地形：索引 → 源图坐标
        // ============================================================
        getTerrainRect(terrain) {
            if (!terrain) return null;
            const idx = this.TERRAIN_INDEX[terrain];
            if (idx === undefined || idx < 0) return null;
            return this._indexToRect(idx, this.terrainConfig);
        },

        // ============================================================
        // 装饰：类型 + 变体 → 源图坐标
        // decor = { type: 'tree', variant: 3 }
        // ============================================================
        getDecorRect(decor) {
            if (!decor) return null;

            const entry = this.DECOR_INDEX[decor.type];
            if (entry === undefined) return null;

            let idx;
            if (Array.isArray(entry)) {
                // 数组 → 用 variant 选
                const v = (decor.variant ?? 0) % entry.length;
                idx = entry[v];
            } else {
                // 单值
                idx = entry;
            }

            if (idx === undefined || idx < 0) return null;
            return this._indexToRect(idx, this.decorConfig);
        },

        // ============================================================
        // 索引 → 源图矩形（通用）
        // ============================================================
        _indexToRect(index, config) {
            const { tileSize, cols, pad } = config;
            const col = index % cols;
            const row = Math.floor(index / cols);
            return {
                sx: col * (tileSize + pad),
                sy: row * (tileSize + pad),
                sw: tileSize,
                sh: tileSize,
            };
        },

        // ============================================================
        // 兼容旧接口（单图集时代）
        // 老代码调 tiles.getSourceRect(terrain) → 转发到地形
        // ============================================================
        getSourceRect(terrain) {
            return this.getTerrainRect(terrain);
        },

        // 兼容：老的 tiles.image
        get image() {
            return this.terrainImage;
        },
    };

    window.MapTiles = MapTiles;
    console.log('[CinemaWorld] map-tiles.js 已加载，BASE_PATH =', BASE_PATH);
})();