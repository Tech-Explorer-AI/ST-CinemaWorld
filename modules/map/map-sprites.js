// ============================================================
// CinemaWorld · map-sprites.js
// 角色精灵图集：
//   - 角色精灵1.png   → 兜底（动物/怪物/职业/中性/其他），8×8，128×128/格
//   - 男1.PNG         → 男性 NPC，4×4，256×256/格
//   - 女1.PNG         → 女性 NPC，4×4，256×256/格
//   - 玩家.png        → 玩家（2×2，上下左右）
// 依赖：无
// 暴露：window.MapSprites
// ============================================================

(function () {
    'use strict';

    // ---------- 路径推导 ----------
    const BASE_PATH = (() => {
        const cur = document.currentScript;
        if (cur && cur.src) {
            return cur.src.replace(/modules\/map\/map-sprites\.js.*$/, '');
        }
        for (const s of document.querySelectorAll('script[src]')) {
            if (/map-sprites\.js/.test(s.src)) {
                return s.src.replace(/modules\/map\/map-sprites\.js.*$/, '');
            }
        }
        return 'scripts/extensions/third-party/ST-CinemaWorld-main/';
    })();

    // ---------- 关键词表 ----------
    const ANIMAL_KEYWORDS = [
        '猫', '喵', '狸花', '橘猫', '黑猫', '白猫', '小猫', 'cat', 'kitten',
        '狗', '犬', '汪', '柴犬', '狼', '狼狗', 'dog', 'puppy', 'wolf',
        '鹿', '羊', '牛', '马', '驴', '骡', '猪', '兔', 'deer', 'sheep', 'cow', 'horse', 'pig', 'rabbit',
        '熊', '虎', '豹', '狮', 'bear', 'tiger', 'leopard', 'lion',
        '鼠', '松鼠', '刺猬', '狐', '狐狸', '猴', 'mouse', 'squirrel', 'fox', 'monkey',
        '鸟', '鹰', '鸦', '鸽', '鸡', '鸭', '鹅', '麻雀', 'owl', 'bird', 'eagle',
        '蛇', '蛙', '龟', '蜥蜴', 'snake', 'frog', 'turtle', 'lizard',
        '蜘蛛', '蜜蜂', '蝴蝶', 'spider', 'bee', 'butterfly',
    ];

    const JOB_KEYWORDS = [
        '铁匠', '铁工', 'smith', 'blacksmith',
        '药剂', '炼金', 'alchemist',
        '守卫', '卫兵', 'guard',
        '法师', '巫师', '术士', 'mage', 'wizard', 'warlock',
        '牧师', '神父', '修女', 'priest', 'nun',
        '盗贼', '小偷', 'thief', 'rogue',
        '农民', '农夫', 'farmer',
        '贵族', '领主', 'noble', 'lord',
        '吟游', 'bard',
        '僧侣', 'monk',
        '猎户', '猎人', 'hunter',
        '水手', '船长', 'sailor', 'captain',
    ];

    const MapSprites = {
        // ============================================================
        // 配置
        // ============================================================

        // 兜底图集（动物 / 怪物 / 职业 / 中性 / 其他）：8×8
        config: {
            src: BASE_PATH + 'images/地图/角色精灵1.png',
            tileSize: 32,
            cols: 8,
            rows: 8,
            pad: 0,
        },

        // 男性 NPC 专用图集：4×4，1024×1024，每格 256×256
        maleConfig: {
            src: BASE_PATH + 'images/地图/男1.PNG',
            tileSize: 64,
            cols: 4,
            rows: 4,
            pad: 0,
        },

        // 女性 NPC 专用图集：4×4，1024×1024，每格 256×256
        femaleConfig: {
            src: BASE_PATH + 'images/地图/女1.PNG',
            tileSize: 64,
            cols: 4,
            rows: 4,
            pad: 0,
        },

        // 玩家图集：2×2 = 4 格，512×512，每格 256×256
        playerConfig: {
            src: BASE_PATH + 'images/地图/玩家.png',
            sheetWidth: 512,
            sheetHeight: 512,
            cols: 2,
            rows: 2,
            tileW: 256,
            tileH: 256,
            pad: 0,
        },

        // ============================================================
        // 状态
        // ============================================================
        image: null,
        loaded: false,
        _loadPromise: null,

        maleImage: null,
        maleLoaded: false,
        _maleLoadPromise: null,

        femaleImage: null,
        femaleLoaded: false,
        _femaleLoadPromise: null,

        playerImage: null,
        playerLoaded: false,
        _playerLoadPromise: null,

        // 玩家动画状态
        _playerFrame: 0,
        _playerFrameTimer: 0,
        playerFacing: 'down',
        playerMoving: false,

        // 玩家方向 → (row, col)：2×2
        DIR_POS: {
            down: { row: 0, col: 0 },
            up: { row: 0, col: 1 },
            left: { row: 1, col: 0 },
            right: { row: 1, col: 1 },
        },

        // 兜底图集：每行索引范围（8×8）
        ROWS: {
            male: [0, 1, 2, 3, 4, 5, 6, 7],
            female: [8, 9, 10, 11, 12, 13, 14, 15],
            neutral: [16, 17, 18, 19, 20, 21, 22, 23],
            job: [24, 25, 26, 27, 28, 29, 30, 31],
            animal: [32, 33, 34, 35, 36, 37, 38, 39],
            monster: [40, 41, 42, 43, 44, 45, 46, 47],
        },

        // ============================================================
        // 加载：兜底图集
        // ============================================================
        load() {
            if (this._loadPromise) return this._loadPromise;
            this._loadPromise = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.image = img;
                    this.loaded = true;
                    console.log('[MapSprites] 角色精灵已加载:', img.width, 'x', img.height);
                    resolve(img);
                };
                img.onerror = () => {
                    console.error('[MapSprites] 角色精灵加载失败:', this.config.src);
                    this.loaded = false;
                    resolve(null);
                };
                img.src = this.config.src;
            });
            return this._loadPromise;
        },

        ready() {
            return this.loaded && !!this.image;
        },

        // ★ 整张地图刷新外观
        rerollAll(map, { force = false } = {}) {
            if (!map?.entities) return 0;
            let count = 0;
            for (const ent of map.entities) {
                if (ent.isPlayer) continue;
                ent.meta = ent.meta || {};
                ent.meta._spriteSeed = Math.floor(Math.random() * 1e9);
                if (force) {
                    delete ent.meta.spriteIndex;
                    delete ent.meta.spriteImage;
                }
                count++;
            }
            if (window.MapCanvas?.canvas) {
                window.MapCanvas._render();
            }
            console.log(`[MapSprites] 已刷新 ${count} 个实体的外观`);
            return count;
        },
        // ============================================================
        // ★ 立绘桥接：让地图 NPC 优先用 SpriteManager 的立绘
        // ============================================================

        // 已触发过异步加载的 key 集合，避免每帧重复请求
        _portraitLoadRequested: new Set(),

        // 构造传给 SpriteManager 的伪角色对象
        // （SpriteManager.pickSpriteState 只读 name/mood/tags）
        _portraitPseudoChar(ent) {
            return {
                name: ent.name,
                mood: ent.meta?.mood || ent.fields?.['心情'] || '',
                tags: ent.tags || [],
                status: ent.status || '',
                explicitState: ent.meta?._vnState || null,   // 预留给"某次对话指定状态"
            };
        },

        // 该实体是否参与"立绘优先"（只对 NPC / 遭遇）
        _canUsePortrait(ent) {
            if (!ent || ent.isPlayer) return false;
            return ent.kind === 'npc' || ent.kind === 'encounter';
        },

        // ★ 同步查：返回立绘 URL 或 null（不发起网络请求）
        getPortraitSync(ent) {
            if (!this._canUsePortrait(ent)) return null;
            if (!window.SpriteManager) return null;

            const pseudo = this._portraitPseudoChar(ent);
            const state = window.SpriteManager.pickSpriteState?.(pseudo) || '默认';

            return window.SpriteManager.getCachedSpriteWithState?.(ent.name, state)
                || window.SpriteManager.getCachedSprite?.(ent.name)
                || null;
        },

        // ★ 异步触发：每实体每状态只请求一次，加载完下一帧自动显示
        requestPortraitLoad(ent) {
            if (!this._canUsePortrait(ent)) return;
            if (!window.SpriteManager) return;

            const pseudo = this._portraitPseudoChar(ent);
            const state = window.SpriteManager.pickSpriteState?.(pseudo) || '默认';
            const key = `${ent.name}|${state}`;

            if (this._portraitLoadRequested.has(key)) return;
            this._portraitLoadRequested.add(key);

            const gender = ent.meta?.gender || ent.fields?.['性别'] || '未知';

            Promise.resolve(
                window.SpriteManager.ensureSpriteWithState?.(ent.name, gender, state)
            ).catch(() => { });
        },

        // ★ 清空请求记录（切换地图时调用，避免旧地图的状态污染新地图）
        clearPortraitRequests() {
            this._portraitLoadRequested.clear();
        },
        _spriteKey(ent) {
            const id = String(ent.id || '');
            const name = String(ent.name || '');
            const seq = ent.meta?._spriteSeq ?? 0;
            const seed = ent.meta?._spriteSeed ?? 0;
            return `${id}|${name}|${seq}|${seed}`;
        },

        // ============================================================
        // 加载：男性
        // ============================================================
        loadMale() {
            if (this._maleLoadPromise) return this._maleLoadPromise;
            this._maleLoadPromise = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.maleImage = img;
                    this.maleLoaded = true;
                    console.log('[MapSprites] 男性精灵已加载:', img.width, 'x', img.height);
                    resolve(img);
                };
                img.onerror = () => {
                    console.error('[MapSprites] 男性精灵加载失败:', this.maleConfig.src);
                    this.maleLoaded = false;
                    resolve(null);
                };
                img.src = this.maleConfig.src;
            });
            return this._maleLoadPromise;
        },

        // ============================================================
        // 加载：女性
        // ============================================================
        loadFemale() {
            if (this._femaleLoadPromise) return this._femaleLoadPromise;
            this._femaleLoadPromise = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.femaleImage = img;
                    this.femaleLoaded = true;
                    console.log('[MapSprites] 女性精灵已加载:', img.width, 'x', img.height);
                    resolve(img);
                };
                img.onerror = () => {
                    console.error('[MapSprites] 女性精灵加载失败:', this.femaleConfig.src);
                    this.femaleLoaded = false;
                    resolve(null);
                };
                img.src = this.femaleConfig.src;
            });
            return this._femaleLoadPromise;
        },

        // ============================================================
        // 加载：玩家
        // ============================================================
        loadPlayer() {
            if (this._playerLoadPromise) return this._playerLoadPromise;
            this._playerLoadPromise = new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.playerImage = img;
                    this.playerLoaded = true;

                    const { cols, rows } = this.playerConfig;
                    this.playerConfig.sheetWidth = img.width;
                    this.playerConfig.sheetHeight = img.height;
                    this.playerConfig.tileW = Math.floor(img.width / cols);
                    this.playerConfig.tileH = Math.floor(img.height / rows);

                    console.log('[MapSprites] 玩家精灵已加载:', img.width, 'x', img.height,
                        '→ 每格', this.playerConfig.tileW, 'x', this.playerConfig.tileH);
                    resolve(img);
                };
                img.onerror = () => {
                    console.error('[MapSprites] 玩家精灵加载失败:', this.playerConfig.src);
                    this.playerLoaded = false;
                    resolve(null);
                };
                img.src = this.playerConfig.src;
            });
            return this._playerLoadPromise;
        },

        playerReady() {
            return this.playerLoaded && !!this.playerImage;
        },

        // ============================================================
        // 玩家：朝向 / 帧 / 源图坐标
        // ============================================================
        setPlayerFacing(facing) {
            if (this.DIR_POS[facing] !== undefined) {
                this.playerFacing = facing;
            }
        },

        updatePlayerAnimation(dt, moving) {
            this.playerMoving = moving;
            if (!moving) {
                this._playerFrame = 0;
                this._playerFrameTimer = 0;
                return;
            }
            this._playerFrameTimer += dt;
            const FRAME_DURATION = 150;
            if (this._playerFrameTimer >= FRAME_DURATION) {
                this._playerFrameTimer -= FRAME_DURATION;
                this._playerFrame = (this._playerFrame + 1) % 3;
            }
        },

        getPlayerSourceRect() {
            if (!this.playerLoaded) return null;
            const { tileW, tileH, pad } = this.playerConfig;
            const pos = this.DIR_POS[this.playerFacing] || this.DIR_POS.down;
            return {
                sx: Math.round(pos.col * (tileW + pad)),
                sy: Math.round(pos.row * (tileH + pad)),
                sw: tileW,
                sh: tileH,
            };
        },

        // ============================================================
        // NPC：解析用哪张图 + 哪个索引
        //   返回 { imageKey: 'male'|'female'|'base', index } 或 null
        //   ★ 男1/女1 是 4×4 = 16 格
        //   ★ 兜底是 8×8 = 64 格，按行分类
        // ============================================================
        resolveSprite(ent) {
            if (!ent) return null;

            // 1. 手动指定
            if (typeof ent.meta?.spriteIndex === 'number' && ent.meta.spriteIndex >= 0) {
                const imageKey = ent.meta.spriteImage || 'base';
                if (imageKey === 'male' && !this.maleLoaded) { /* fall through */ }
                else if (imageKey === 'female' && !this.femaleLoaded) { /* fall through */ }
                else {
                    return { imageKey, index: ent.meta.spriteIndex };
                }
            }

            // 2. 玩家不走这张
            if (ent.isPlayer || ent.kind === 'player') return null;

            // 3. 怪物 / 遭遇 → 兜底怪物行
            if (ent.kind === 'encounter') {
                const idx = this._pickFromRow('monster', ent);
                return idx >= 0 ? { imageKey: 'base', index: idx } : null;
            }

            // 4. NPC
            if (ent.kind === 'npc') {
                const text = `${ent.name || ''} ${ent.description || ''} ${(ent.tags || []).join(' ')}`;

                // 4a. 动物 → 兜底动物行
                if (ANIMAL_KEYWORDS.some(k => text.includes(k))) {
                    const idx = this._pickFromRow('animal', ent);
                    return idx >= 0 ? { imageKey: 'base', index: idx } : null;
                }

                // 4b. 性别 → 男/女专用图集（4×4 = 16 格）
                const gender = this.detectGender(ent);
                if (gender === '男' && this.maleLoaded) {
                    return { imageKey: 'male', index: this._pickFromGrid16(ent) };
                }
                if (gender === '女' && this.femaleLoaded) {
                    return { imageKey: 'female', index: this._pickFromGrid16(ent) };
                }

                // 4c. 职业 → 兜底职业行
                if (JOB_KEYWORDS.some(k => text.includes(k))) {
                    const idx = this._pickFromRow('job', ent);
                    return idx >= 0 ? { imageKey: 'base', index: idx } : null;
                }

                // 4d. 兜底 → 中性行
                const idx = this._pickFromRow('neutral', ent);
                return idx >= 0 ? { imageKey: 'base', index: idx } : null;
            }

            // 5. 其他 kind
            return null;
        },

        // 性别识别
        detectGender(ent) {
            const g = ent.meta?.gender;
            if (g === '男' || g === '女') return g;

            const fg = ent.fields?.['性别'];
            if (fg === '男' || fg === '女') return fg;

            const text = `${ent.name || ''} ${ent.description || ''} ${(ent.tags || []).join(' ')}`;
            if (/少女|女子|女孩|女士|夫人|老婆|婆婆|妈妈|姐姐|妹妹|她|女/.test(text)) return '女';
            if (/少年|男子|男孩|先生|老爷|公公|爸爸|哥哥|弟弟|他|男/.test(text)) return '男';
            return '其他';
        },

        // 从某一行稳定挑一个索引（兜底图集 8×8）
        _pickFromRow(rowName, ent) {
            const arr = this.ROWS[rowName];
            if (!arr || arr.length === 0) return -1;
            const h = this._hash(this._spriteKey(ent));
            return arr[h % arr.length];
        },

        // ★ 从 4×4 = 16 格稳定挑一个（男1/女1）
        _pickFromGrid16(ent) {
            const h = this._hash(this._spriteKey(ent));
            return h % 16;
        },

        _hash(s) {
            let h = 0;
            for (let i = 0; i < s.length; i++) {
                h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            }
            return Math.abs(h);
        },

        // ============================================================
        // 源图坐标
        // ============================================================

        // 兜底图集：索引 → 坐标（128×128）
        getSourceRect(index) {
            if (index < 0) return null;
            const { tileSize, cols, pad } = this.config;
            const col = index % cols;
            const row = Math.floor(index / cols);
            return {
                sx: col * (tileSize + pad),
                sy: row * (tileSize + pad),
                sw: tileSize,
                sh: tileSize,
            };
        },

        // 实体 → 源图坐标（自动选图）
        getSourceRectForEntity(ent) {
            const resolved = this.resolveSprite(ent);
            if (!resolved) return null;

            const { imageKey, index } = resolved;
            const cfg = imageKey === 'male' ? this.maleConfig
                : imageKey === 'female' ? this.femaleConfig
                    : this.config;

            if (index < 0) return null;
            const { tileSize, cols, pad } = cfg;
            const col = index % cols;
            const row = Math.floor(index / cols);
            return {
                sx: col * (tileSize + pad),
                sy: row * (tileSize + pad),
                sw: tileSize,
                sh: tileSize,
            };
        },

        // 实体 → 该用哪张图
        getImageForEntity(ent) {
            const resolved = this.resolveSprite(ent);
            if (!resolved) return null;
            if (resolved.imageKey === 'male') return this.maleImage;
            if (resolved.imageKey === 'female') return this.femaleImage;
            return this.image;
        },

        // ★ 该实体的精灵是否应该"超出格子"绘制（人形大图）
        isBigSprite(ent) {
            const resolved = this.resolveSprite(ent);
            if (!resolved) return false;
            return resolved.imageKey === 'male' || resolved.imageKey === 'female';
        },
    };

    window.MapSprites = MapSprites;
    console.log('[CinemaWorld] map-sprites.js 已加载，BASE_PATH =', BASE_PATH);
})();