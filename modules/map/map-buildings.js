// ============================================================
// CinemaWorld · map-buildings.js
// 建筑精灵：加载 / 匹配 / 绘制
// 暴露：window.MapBuildings
// ============================================================

(function () {
    'use strict';

    const BASE_PATH = (() => {
        const cur = document.currentScript;
        if (cur && cur.src) {
            return cur.src.replace(/modules\/map\/map-buildings\.js.*$/, '');
        }
        for (const s of document.querySelectorAll('script[src]')) {
            if (/map-buildings\.js/.test(s.src)) {
                return s.src.replace(/modules\/map\/map-buildings\.js.*$/, '');
            }
        }
        return 'scripts/extensions/third-party/CinemaWorld/';
    })();

    const MapBuildings = {
        // ---------- 精灵表配置 ----------
        // key: 建筑尺寸 '2x2' / '3x3' / ...
        // 每个表：4×4，按类型分行
        // ---------- 建筑尺寸 → 用哪张精灵表 ----------
        // 2x2 → 2x2
        // 3x3 → 3x3
        // 4x4 → 4x4
        // 5x5 → 4x4（拉伸）
        // 6x6 → 4x4（拉伸）
        SIZE_FALLBACK: {
            '2x2': '2x2',
            '3x3': '3x3',
            '4x4': '4x4',
            '5x5': '4x4',
            '6x6': '4x4',
        },

        // 解析尺寸字符串 → 用哪张表
        resolveSheetKey(w, h) {
            const key = `${w}x${h}`;
            return this.SIZE_FALLBACK[key] || '2x2';
        },
        sheets: {
            '2x2': {
                src: BASE_PATH + 'images/地图/建筑_2x2.png',
                cols: 4,
                rows: 4,
                tileW: 64,
                tileH: 64,
                gridSize: 2,      // ★ 占 2×2 格
            },
            '3x3': {
                src: BASE_PATH + 'images/地图/建筑_3x3.png',
                cols: 3,
                rows: 3,
                tileW: 85,
                tileH: 85,
                gridSize: 3,
            },
            '4x4': {
                src: BASE_PATH + 'images/地图/建筑_4x4.png',
                cols: 2,
                rows: 2,
                tileW: 128,
                tileH: 128,
                gridSize: 4,
            },
        },

        // ---------- 类型 → (行, 列) ----------
        // 行：0=民居 1=商业 2=公共 3=特殊
        // 列：0-3 是该行里的 4 个变体
        TYPES: {
            // ---------- 民居 ----------
            house_small: { row: 0, col: 0, name: '小木屋', category: '民居' },
            house_brick: { row: 0, col: 1, name: '砖瓦房', category: '民居' },
            house_two: { row: 0, col: 2, name: '两层小楼', category: '民居' },
            house_chimney: { row: 0, col: 3, name: '带烟囱的房子', category: '民居' },

            // ---------- 商业 ----------
            shop_small: { row: 1, col: 0, name: '小商店', category: '商业' },
            cafe: { row: 1, col: 1, name: '咖啡馆', category: '商业' },
            bakery: { row: 1, col: 2, name: '面包店', category: '商业' },
            grocery: { row: 1, col: 3, name: '杂货铺', category: '商业' },

            // ---------- 公共 ----------
            clock_tower: { row: 2, col: 0, name: '钟楼', category: '公共' },
            chapel: { row: 2, col: 1, name: '小教堂', category: '公共' },
            townhall: { row: 2, col: 2, name: '市政厅', category: '公共' },
            library: { row: 2, col: 3, name: '图书馆', category: '公共' },

            // ---------- 特殊 ----------
            inn: { row: 3, col: 0, name: '旅店', category: '特殊' },
            blacksmith: { row: 3, col: 1, name: '铁匠铺', category: '特殊' },
            apothecary: { row: 3, col: 2, name: '药铺', category: '特殊' },
            tavern: { row: 3, col: 3, name: '酒馆', category: '特殊' },
        },

        // ---------- 关键词匹配（名称 → 建筑 key）----------
        KEYWORDS: {
            house_small: ['小木屋', '木屋', '小屋', '茅屋', '棚屋'],
            house_brick: ['砖瓦房', '砖房', '瓦房', '民居', '住宅', '房子'],
            house_two: ['两层小楼', '两层', '小楼', '双层'],
            house_chimney: ['烟囱', '带烟囱'],

            shop_small: ['小商店', '商店', '小店'],
            cafe: ['咖啡馆', '咖啡', '茶馆', '茶肆'],
            bakery: ['面包店', '面包', '糕点', '饼店'],
            grocery: ['杂货铺', '杂货', '杂货店', '小卖部'],

            clock_tower: ['钟楼', '钟塔', '塔楼'],
            chapel: ['小教堂', '教堂', '礼拜堂', '神社', '小祠'],
            townhall: ['市政厅', '政府', '议会', '衙署'],
            library: ['图书馆', '藏书楼', '书阁'],

            inn: ['旅店', '客栈', '旅馆', '驿站'],
            blacksmith: ['铁匠铺', '铁匠', '铁铺', '锻造'],
            apothecary: ['药铺', '药房', '药堂', '医馆'],
            tavern: ['酒馆', '酒吧', '酒肆', '酒楼'],
        },

        // ---------- 状态 ----------
        images: {},       // key → HTMLImageElement
        loaded: {},       // key → boolean
        _loadPromises: {},

        // ============================================================
        // 加载
        // ============================================================
        load() {
            const promises = [];
            for (const [key, cfg] of Object.entries(this.sheets)) {
                promises.push(this._loadSheet(key, cfg));
            }
            return Promise.all(promises);
        },

        _loadSheet(key, cfg) {
            if (this._loadPromises[key]) return this._loadPromises[key];

            this._loadPromises[key] = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.images[key] = img;
                    this.loaded[key] = true;
                    console.log(`[MapBuildings] 精灵表 ${key} 已加载:`, img.width, 'x', img.height);
                    resolve(img);
                };
                img.onerror = () => {
                    console.warn(`[MapBuildings] 精灵表 ${key} 加载失败:`, cfg.src);
                    this.loaded[key] = false;
                    resolve(null);
                };
                img.src = cfg.src;
            });
            return this._loadPromises[key];
        },

        ready(sheetKey = '2x2') {
            return !!this.loaded[sheetKey];
        },
        // ============================================================
        // 随机拿一个建筑类型
        //   category: 可选，'民居' / '商业' / '公共' / '特殊'
        //   seed: 可选，传字符串则用哈希（同一建筑每次随机结果一致）
        // ============================================================
        pickRandom(category = null, seed = null) {
            // 1. 候选池
            let keys = Object.keys(this.TYPES);
            if (category) {
                keys = keys.filter(k => this.TYPES[k].category === category);
            }
            if (keys.length === 0) keys = Object.keys(this.TYPES);

            // 2. 有 seed → 哈希取固定一个
            if (seed) {
                const h = this._hash(seed);
                return keys[h % keys.length];
            }

            // 3. 无 seed → 真随机
            return keys[Math.floor(Math.random() * keys.length)];
        },

        _hash(str) {
            let h = 0;
            const s = String(str || '');
            for (let i = 0; i < s.length; i++) {
                h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            }
            return Math.abs(h);
        },
        // ============================================================
        // 匹配：根据建筑名找类型
        // ============================================================
        matchType(name, options = {}) {
            if (!name) return this._fallback(options);

            const s = String(name).trim();

            // 1. 直接按 key 匹配
            if (this.TYPES[s]) return s;

            // 2. 按 name 精确匹配
            for (const [key, def] of Object.entries(this.TYPES)) {
                if (def.name === s) return key;
            }

            // 3. 关键词匹配（长关键词优先）
            let best = null;
            let bestLen = 0;
            for (const [key, kws] of Object.entries(this.KEYWORDS)) {
                for (const kw of kws) {
                    if (s.includes(kw) && kw.length > bestLen) {
                        best = key;
                        bestLen = kw.length;
                    }
                }
            }
            if (best) return best;

            // 4. ★ 匹配不到 → 兜底
            return this._fallback(options, name);
        },

        // 兜底策略
        _fallback(options = {}, seed = null) {
            // a. 指定了 category → 按类别随机
            if (options.category) {
                return this.pickRandom(options.category, seed);
            }

            // b. 没指定 → 全表随机
            return this.pickRandom(null, seed);
        },

        // ============================================================
        // 获取源图坐标
        // ============================================================
        getSourceRect(typeKey, sheetKey = '2x2') {
            const def = this.TYPES[typeKey];
            if (!def) return null;
        
            const cfg = this.sheets[sheetKey];
            if (!cfg) return null;
        
            // ★ 越界取模，让 4 列的 TYPES 能映射到 3 列的 3x3 表
            const col = def.col % cfg.cols;
            const row = def.row % cfg.rows;
        
            return {
                sx: col * cfg.tileW,
                sy: row * cfg.tileH,
                sw: cfg.tileW,
                sh: cfg.tileH,
            };
        },

        getImage(gridSize = '2x2') {
            return this.images[gridSize] || null;
        },
        
        // ============================================================
        // 绘制：把一个建筑画在网格上
        // ============================================================
        draw(ctx, ent, camera, tileSize, cssW, cssH) {
            if (!ent || !ent.anchor || !ent.size) return false;
        
            const sheetKey = this.resolveSheetKey(ent.size.w, ent.size.h);
            const img = this.getImage(sheetKey);
            if (!img) return false;
        
            let typeKey = ent._spriteType;
            if (!typeKey) {
                typeKey = this.matchType(ent.name, {
                    category: this.guessCategory(ent.name),
                    seed: ent.name,
                });
                ent._spriteType = typeKey;
            }
            if (!typeKey) return false;
        
            const src = this.getSourceRect(typeKey, sheetKey);
            if (!src) return false;
        
            const dx = (ent.anchor.x - camera.x) * tileSize;
            const dy = (ent.anchor.y - camera.y) * tileSize;
            const dw = ent.size.w * tileSize;
            const dh = ent.size.h * tileSize;
        
            if (dx + dw < -tileSize || dx > cssW + tileSize) return false;
            if (dy + dh < -tileSize || dy > cssH + tileSize) return false;
        
            // ============================================================
            // ★ 2. 建筑精灵
            // ============================================================
            ctx.drawImage(img, src.sx, src.sy, src.sw, src.sh, dx, dy, dw, dh);
            
        
            return true;
        },
        
    };

    window.MapBuildings = MapBuildings;
    console.log('[CinemaWorld] map-buildings.js 已加载，BASE_PATH =', BASE_PATH);
})();