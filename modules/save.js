// ============================================================
// CinemaWorld · save.js
// 存档系统：序列化 / 迁移 / 归一化 / 应用 / 导入导出
// 依赖：core.js, world.js, player.js, scene.js, story.js,
//       rules.js, interact.js, battle.js, simulation.js, ui.js
// ★ 必须最后加载
// ============================================================

(function () {
    'use strict';

    const SaveManager = {
        SAVE_KEY: 'CinemaWorld_save',
        VERSION: 4,
        timer: null,
        _applying: false,

        // ========== 空模板（唯一权威来源） ==========
        getEmptyWorldState() {
            return {
                // ★ 兼容老代码：世界名（可选）
                name: '',

                entities: [],
                narrativeLog: [],
                characters: {},
                interactions: [],
                interactionDigests: { byCharacter: {}, byItem: {} },
                spriteAssignments: {},
                worldHistory: { summary: '', updatedAt: null, eraCount: 0 },
                gameRules: '',
                combat: {
                    activeCombat: null,
                    battleRules: null,
                    battlePackages: {},      // ★ 修复 1：战斗包缓存
                    history: [],
                },
                bonds: {},
                shops: {},                    // ★ 修复 2：商店
                pendingEvents: [],            // ★ 修复 3a：待处理事件
                pendingUpdates: [],           // ★ 修复 3b：待应用场景更新
                social: {
                    conversations: {},
                    moments: [],
                    unread: { total: 0, moments: 0 },
                    settings: {
                        maxMessagesPerConversation: 200,
                        compactThreshold: 30,
                        compactKeep: 12,
                        autoReplyChance: 0.3,
                    },
                },
            };
        },

        getEmptyPlayer() {
            return {
                name: CinemaWorld.currentUserName || '主人公',
                profile: '',
                statusBars: [],
                attributes: {},
                inventory: [],
                inventorySlots: 40,
                tags: [],
                extraStats: { _order: [], _raw: '' },
                nameCustomized: false,
                equipment: {
                    slots: new Array(6).fill(null),
                    bonuses: {},
                    _appliedExpand: 0,        // ★ 修复 4
                    stackCount: {},           // ★ 修复 4
                },
                derivedStats: { rules: [], computed: {} },
            };
        },

        // ========== 初始化 ==========
        init() {
            if (this.timer) clearInterval(this.timer);
            this.timer = setInterval(() => this.save(), 30000);
        },

        // ============================================================
        // 序列化：把当前内存状态打包成存档对象
        // ============================================================
        serialize() {
            // 深拷贝，避免把运行时引用写进存档
            const safeClone = (obj) => {
                try {
                    return JSON.parse(JSON.stringify(obj ?? null));
                } catch (e) {
                    console.warn('[CinemaWorld] 序列化失败，使用空值:', e);
                    return null;
                }
            };

            return {
                _meta: {
                    version: this.VERSION,
                    timestamp: Date.now(),
                    app: 'CinemaWorld',
                },
                cinema: {
                    worldState: safeClone(CinemaWorld.worldState) || this.getEmptyWorldState(),
                    ui: { currentLocation: CinemaWorld.ui.currentLocation || null },
                    currentAIChatName: CinemaWorld.currentAIChatName || 'AI',
                    currentUserName: CinemaWorld.currentUserName || '主人公',
                },
                player: {
                    data: safeClone(PlayerStateManager.player) || this.getEmptyPlayer(),
                    displayedBars: Array.isArray(PlayerStateManager.displayedBars)
                        ? [...PlayerStateManager.displayedBars]
                        : [0, 1],
                },
                story: {
                    storyList: safeClone(StoryManager.storyList) || [],
                    chapters: safeClone(StoryManager.chapters) || [],
                    currentChapter: safeClone(StoryManager.currentChapter),
                    currentStory: safeClone(StoryManager.currentStory),
                    volumes: safeClone(StoryManager.volumes) || [],
                    currentVolume: safeClone(StoryManager.currentVolume),
                    _listIndex: typeof StoryManager._listIndex === 'number'
                        ? StoryManager._listIndex : 0,
                },
            };
        },

        // ============================================================
        // 版本迁移
        // ============================================================
        MIGRATIONS: {
            // v1 / v2 / v3 → v4
            1: (d) => SaveManager._migrateV3ToV4(d),
            2: (d) => SaveManager._migrateV3ToV4(d),
            3: (d) => SaveManager._migrateV3ToV4(d),
        },

        _migrateV3ToV4(d) {
            // 旧结构：{ version, timestamp, world, player, displayedBars,
            //           currentScene, storyList, chapters, currentChapter,
            //           volumes, currentVolume }
            // 统一映射到新的 v4 外壳，内部字段交给 _normalize 补齐
            const oldVersion = d.version || d._meta?.version || 1;
            return {
                _meta: {
                    version: 4,
                    timestamp: d.timestamp || Date.now(),
                    app: 'CinemaWorld',
                    migratedFrom: oldVersion,
                },
                cinema: {
                    worldState: d.world || {},
                    ui: { currentLocation: d.currentScene || null },
                    currentAIChatName: d.currentAIChatName || 'AI',
                    currentUserName: d.currentUserName || '主人公',
                },
                player: {
                    data: d.player || {},
                    displayedBars: d.displayedBars || [0, 1],
                },
                story: {
                    storyList: d.storyList || [],
                    chapters: d.chapters || [],
                    currentChapter: d.currentChapter || null,
                    currentStory: d.currentStory || null,
                    volumes: d.volumes || [],
                    currentVolume: d.currentVolume || null,
                    _listIndex: typeof d._listIndex === 'number' ? d._listIndex : 0,
                },
            };
        },

        _migrate(data) {
            if (!data || typeof data !== 'object') return null;

            // 识别版本
            let version = data._meta?.version ?? data.version ?? 1;

            // 已经是 v4 结构，直接返回
            if (version >= this.VERSION && data.cinema && data.player && data.story) {
                return data;
            }

            // 逐版本升级
            while (version < this.VERSION) {
                const fn = this.MIGRATIONS[version];
                if (typeof fn === 'function') {
                    data = fn(data);
                }
                version++;
            }
            return data;
        },

        // ============================================================
        // 深度归一化：把任意结构补齐成标准 v4
        // ============================================================
        _normalize(data) {
            // ---------- meta ----------
            const meta = {
                version: this.VERSION,
                timestamp: data._meta?.timestamp || Date.now(),
                app: 'CinemaWorld',
                migratedFrom: data._meta?.migratedFrom || null,
            };

            // ---------- cinema ----------
            const ws = data.cinema?.worldState || {};
            const currentLocation = data.cinema?.ui?.currentLocation || null;

            const worldState = {
                // ★ 修复 7：世界名
                name: typeof ws.name === 'string' ? ws.name : '',

                entities: Array.isArray(ws.entities) ? ws.entities : [],
                narrativeLog: Array.isArray(ws.narrativeLog) ? ws.narrativeLog : [],
                characters: (ws.characters && typeof ws.characters === 'object') ? ws.characters : {},
                interactions: Array.isArray(ws.interactions) ? ws.interactions : [],
                interactionDigests: this._normalizeDigests(ws.interactionDigests),
                spriteAssignments: (ws.spriteAssignments && typeof ws.spriteAssignments === 'object')
                    ? ws.spriteAssignments : {},
                worldHistory: this._normalizeWorldHistory(ws.worldHistory),
                gameRules: typeof ws.gameRules === 'string' ? ws.gameRules : '',
                combat: this._normalizeCombat(ws.combat),
                shops: (ws.shops && typeof ws.shops === 'object') ? ws.shops : {},
                pendingEvents: Array.isArray(ws.pendingEvents) ? ws.pendingEvents : [],
                pendingUpdates: Array.isArray(ws.pendingUpdates) ? ws.pendingUpdates : [],
                bonds: this._normalizeBonds(ws.bonds), 
            };

            // 补齐缺失的人物档案
            this._backfillCharacters(worldState, currentLocation);

            // 归一化所有场景角色的 tags（旧存档可能是字符串数组）
            for (const scene of worldState.entities) {
                if (Array.isArray(scene.sceneCharacters)) {
                    for (const ch of scene.sceneCharacters) {
                        ch.tags = this._normalizeTags(ch.tags);
                        if (!ch.extraStats) ch.extraStats = { _order: [], _raw: '' };
                    }
                }
            }

            const cinema = {
                worldState,
                ui: { currentLocation },
                currentAIChatName: data.cinema?.currentAIChatName || 'AI',
                currentUserName: data.cinema?.currentUserName || '主人公',
            };

            // ---------- player ----------
            const pRaw = data.player?.data || {};
            const player = {
                ...this.getEmptyPlayer(),
                ...pRaw,
                name: typeof pRaw.name === 'string' && pRaw.name ? pRaw.name
                    : (data.cinema?.currentUserName || '主人公'),
                profile: typeof pRaw.profile === 'string' ? pRaw.profile : '',
                statusBars: Array.isArray(pRaw.statusBars) ? pRaw.statusBars : [],
                attributes: (pRaw.attributes && typeof pRaw.attributes === 'object') ? pRaw.attributes : {},
                inventory: Array.isArray(pRaw.inventory) ? pRaw.inventory : [],
                inventorySlots: (typeof pRaw.inventorySlots === 'number' && pRaw.inventorySlots >= 1)
                ? pRaw.inventorySlots : 40,
                tags: this._normalizeTags(pRaw.tags),
                extraStats: this._normalizeExtra(pRaw.extraStats),
                nameCustomized: !!pRaw.nameCustomized,
                equipment: this._normalizeEquipment(pRaw.equipment),
                derivedStats: this._normalizeDerived(pRaw.derivedStats),
            };

            const playerSection = {
                data: player,
                displayedBars: Array.isArray(data.player?.displayedBars)
                    ? data.player.displayedBars : [0, 1],
            };

            const social = this._normalizeSocial(ws.social);
            // ... 加入 worldState 对象
            worldState.social = social;

            // ---------- story ----------
            const sRaw = data.story || {};
            const story = {
                storyList: Array.isArray(sRaw.storyList) ? sRaw.storyList : [],
                chapters: Array.isArray(sRaw.chapters) ? sRaw.chapters : [],
                currentChapter: sRaw.currentChapter || null,
                currentStory: sRaw.currentStory || null,
                volumes: Array.isArray(sRaw.volumes) ? sRaw.volumes : [],
                currentVolume: sRaw.currentVolume || null,
                _listIndex: typeof sRaw._listIndex === 'number' ? sRaw._listIndex : 0,
            };

            return { _meta: meta, cinema, player: playerSection, story };
        },

        _normalizeBonds(raw) {
            const out = {};
            if (!raw || typeof raw !== 'object') return out;
        
            for (const [key, bond] of Object.entries(raw)) {
                if (!bond || typeof bond !== 'object') continue;
                if (!Array.isArray(bond.members) || bond.members.length < 2) continue;
        
                out[key] = {
                    id: bond.id || `bond_${key}`,
                    members: bond.members.slice(),
                    createdAt: bond.createdAt || Date.now(),
                    updatedAt: bond.updatedAt || Date.now(),
                    count: typeof bond.count === 'number' ? bond.count : (bond.episodes?.length || 0),
                    episodes: Array.isArray(bond.episodes) ? bond.episodes.map(e => ({
                        id: e.id || `ep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        title: e.title || '无题',
                        summary: e.summary || '',
                        dialogues: Array.isArray(e.dialogues) ? e.dialogues : [],
                        raw: e.raw || '',
                        createdAt: e.createdAt || Date.now(),
                    })) : [],
                    compactSummary: bond.compactSummary || '',
                    compactUntilIndex: typeof bond.compactUntilIndex === 'number'
                        ? bond.compactUntilIndex : 0,
                };
            }
            return out;
        },

        _normalizeSocial(raw) {
            const out = {
                conversations: {},
                moments: [],
                unread: { total: 0, moments: 0 },
                settings: {
                    maxMessagesPerConversation: 200,
                    compactThreshold: 30,
                    compactKeep: 12,
                    autoReplyChance: 0.3,
                },
            };
            if (!raw || typeof raw !== 'object') return out;
        
            // conversations
            if (raw.conversations && typeof raw.conversations === 'object') {
                for (const [id, conv] of Object.entries(raw.conversations)) {
                    out.conversations[id] = {
                        id: conv.id || id,
                        type: conv.type || 'single',
                        name: conv.name || '',
                        members: Array.isArray(conv.members) ? conv.members : [],
                        avatar: conv.avatar || '👤',
                        topic: conv.topic || '',
                        createdAt: conv.createdAt || Date.now(),
                        lastMessageAt: conv.lastMessageAt || 0,
                        unreadCount: conv.unreadCount || 0,
                        messages: Array.isArray(conv.messages) ? conv.messages : [],
                        compactSummary: conv.compactSummary || '',
                        compactUntilIndex: conv.compactUntilIndex || 0,
                        autoTriggered: !!conv.autoTriggered,
                        _proactiveDone: !!conv._proactiveDone,
                    };
                }
            }
        
            // moments
            if (Array.isArray(raw.moments)) {
                out.moments = raw.moments.map(m => ({
                    id: m.id || `moment_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    author: m.author || '某人',
                    content: m.content || '',
                    images: Array.isArray(m.images) ? m.images : [],
                    createdAt: m.createdAt || Date.now(),
                    likes: Array.isArray(m.likes) ? m.likes : [],
                    comments: Array.isArray(m.comments) ? m.comments : [],
                    seenByPlayer: !!m.seenByPlayer,
                }));
            }
        
            // unread
            if (raw.unread) {
                out.unread.total = raw.unread.total || 0;
                out.unread.moments = raw.unread.moments || 0;
            }
        
            // settings
            if (raw.settings) {
                Object.assign(out.settings, raw.settings);
            }
        
            return out;
        },
        // ---------- 归一化辅助 ----------
        _normalizeDigests(raw) {
            const out = { byCharacter: {}, byItem: {} };
            if (!raw || typeof raw !== 'object') return out;

            // byCharacter：新结构 {lines, summary, compactUntilIndex, chapterId, lastActiveAt}
            //              旧结构 [ {id, summary, chapterId, ...}, ... ]
            const charRaw = (raw.byCharacter && typeof raw.byCharacter === 'object') ? raw.byCharacter : {};
            for (const [name, bucket] of Object.entries(charRaw)) {
                if (Array.isArray(bucket)) {
                    // 旧结构：用最后一条的 createdAt 作为 lastActiveAt
                    const lastCreatedAt = bucket.length > 0
                        ? (bucket[bucket.length - 1]?.createdAt || 0)
                        : 0;
                    out.byCharacter[name] = {
                        lines: [],
                        summary: bucket.map(d => d.summary).filter(Boolean).join('；'),
                        compactUntilIndex: 0,
                        chapterId: bucket[0]?.chapterId || null,
                        lastActiveAt: lastCreatedAt,        // ★ 新增
                        _legacyItems: bucket,
                    };
                } else if (bucket && typeof bucket === 'object') {
                    out.byCharacter[name] = {
                        lines: Array.isArray(bucket.lines) ? bucket.lines : [],
                        summary: typeof bucket.summary === 'string' ? bucket.summary : '',
                        compactUntilIndex: typeof bucket.compactUntilIndex === 'number'
                            ? bucket.compactUntilIndex : 0,
                        chapterId: bucket.chapterId || null,
                        // ★ 兼容旧存档：没有 lastActiveAt 就补 0
                        lastActiveAt: typeof bucket.lastActiveAt === 'number'
                            ? bucket.lastActiveAt : 0,
                        _legacyItems: Array.isArray(bucket._legacyItems) ? bucket._legacyItems : [],
                    };
                }
            }

            // byItem：{compact, compactUntilId, items}
            const itemRaw = (raw.byItem && typeof raw.byItem === 'object') ? raw.byItem : {};
            for (const [name, bucket] of Object.entries(itemRaw)) {
                if (Array.isArray(bucket)) {
                    out.byItem[name] = { compact: '', compactUntilId: null, items: bucket };
                } else if (bucket && typeof bucket === 'object') {
                    out.byItem[name] = {
                        compact: typeof bucket.compact === 'string' ? bucket.compact : '',
                        compactUntilId: bucket.compactUntilId || null,
                        items: Array.isArray(bucket.items) ? bucket.items : [],
                    };
                }
            }
            return out;
        },

        _normalizeWorldHistory(raw) {
            if (!raw || typeof raw !== 'object') {
                return { summary: '', updatedAt: null, eraCount: 0 };
            }
            return {
                summary: typeof raw.summary === 'string' ? raw.summary : '',
                updatedAt: raw.updatedAt || null,
                eraCount: typeof raw.eraCount === 'number' ? raw.eraCount : 0,
            };
        },

        _normalizeCombat(raw) {
            if (!raw || typeof raw !== 'object') {
                return { activeCombat: null, battleRules: null, battlePackages: {}, history: [] };
            }
            return {
                activeCombat: raw.activeCombat || null,
                battleRules: raw.battleRules || null,
                battlePackages: (raw.battlePackages && typeof raw.battlePackages === 'object')
                    ? raw.battlePackages : {},
                history: Array.isArray(raw.history) ? raw.history : [],
            };
        },

        _normalizeTags(tags) {
            if (!Array.isArray(tags)) return [];
            return tags.map(t => {
                if (typeof t === 'object' && t && t.name) {
                    return {
                        name: t.name,
                        effect: t.effect || null,
                        duration: typeof t.duration === 'number' ? t.duration : null,
                    };
                }
                const name = String(t);
                const effect = (typeof TagEffectManager !== 'undefined')
                    ? TagEffectManager.getEffect(name) : null;
                return {
                    name,
                    effect: effect || null,
                    duration: effect?.持续 ?? null,
                };
            }).filter(t => t.name);
        },

        _normalizeExtra(raw) {
            if (!raw || typeof raw !== 'object') return { _order: [], _raw: '' };
            const extra = { _order: [], _raw: '' };
            const order = Array.isArray(raw._order) ? raw._order : [];
            // 先按 _order 顺序
            for (const k of order) {
                if (k === '_order' || k === '_raw') continue;
                if (raw[k] === undefined) continue;
                extra[k] = raw[k];
                extra._order.push(k);
            }
            // 再补充 _order 没列到的键
            for (const [k, v] of Object.entries(raw)) {
                if (k === '_order' || k === '_raw') continue;
                if (extra._order.includes(k)) continue;
                extra[k] = v;
                extra._order.push(k);
            }
            extra._raw = extra._order.map(k => `${k}:${extra[k]}`).join('|');
            return extra;
        },

        _normalizeEquipment(raw) {
            if (!raw || typeof raw !== 'object') {
                return {
                    slots: new Array(6).fill(null),
                    bonuses: {},
                    _appliedExpand: 0,
                    stackCount: {},
                };
            }
            return {
                slots: Array.isArray(raw.slots) ? raw.slots : new Array(6).fill(null),
                bonuses: (raw.bonuses && typeof raw.bonuses === 'object') ? raw.bonuses : {},
                // ★ 修复 5：确保 _appliedExpand 是数字（防止 undefined 引起 delta 误判）
                _appliedExpand: typeof raw._appliedExpand === 'number' ? raw._appliedExpand : 0,
                stackCount: (raw.stackCount && typeof raw.stackCount === 'object') ? raw.stackCount : {},
            };
        },

        _normalizeDerived(raw) {
            if (!raw || typeof raw !== 'object') {
                return { rules: [], computed: {} };
            }
            return {
                rules: Array.isArray(raw.rules) ? raw.rules : [],
                computed: (raw.computed && typeof raw.computed === 'object') ? raw.computed : {},
            };
        },

        _backfillCharacters(worldState, currentLocation) {
            if (!worldState.characters) worldState.characters = {};
            if (Object.keys(worldState.characters).length > 0) return;

            // 从场景重建
            for (const scene of worldState.entities) {
                if (scene.type !== 'location') continue;
                if (!Array.isArray(scene.sceneCharacters)) continue;
                for (const ch of scene.sceneCharacters) {
                    if (!ch.name) continue;
                    if (worldState.characters[ch.name]) continue;
                    worldState.characters[ch.name] = {
                        name: ch.name,
                        gender: ch.gender || '',
                        mood: ch.mood || '',
                        favorability: ch.favorability || '',
                        status: ch.status || '',
                        tags: ch.tags || [],
                        description: ch.description || '',
                        role: ch.role || 'minor',
                        roleChangedBy: 'auto',
                        firstSeenAt: Date.now(),
                        lastSeenAt: Date.now(),
                        lastScene: scene.name,
                        appearances: [scene.name],
                        isPresent: scene.name === currentLocation,
                        extraStats: { _order: [], _raw: '' },
                    };
                }
            }
        },

        // ============================================================
        // 应用：把归一化后的存档写入所有模块
        // ============================================================
        apply(data) {
            this._applying = true;
            try {
                // ---------- 1. 清理运行时状态 ----------
                if (typeof BattleManager !== 'undefined') {
                    BattleManager._runtime = { defending: false, playerCooldowns: {}, enemyCooldowns: {} };
                }
                // save.js · apply() 里清 SpriteManager 时
                if (typeof SpriteManager !== 'undefined') {
                    SpriteManager.cache = {};
                    SpriteManager.characterSpriteMap = {};
                    SpriteManager.randomPoolCache = {};
                    SpriteManager._characterType = {};      // ★ 新增
                    SpriteManager.playerSprite = undefined;
                    SpriteManager.playerAvatar = undefined;
                    // 注意：_existsCache 不清，因为文件存在性不变
                }
                if (typeof BackgroundManager !== 'undefined') {
                    BackgroundManager.cache = {};
                    BackgroundManager.current = null;
                }
                if (typeof MusicManager !== 'undefined') {
                    MusicManager.cache = {};
                    MusicManager.currentMusic = null;
                    MusicManager.baseMusic = null;
                    MusicManager.overrideMusic = null;
                }

                // ---------- 2. 应用 cinema ----------
                CinemaWorld.worldState = data.cinema.worldState;
                CinemaWorld.ui.currentLocation = data.cinema.ui.currentLocation;
                CinemaWorld.currentAIChatName = data.cinema.currentAIChatName;
                CinemaWorld.currentUserName = data.cinema.currentUserName;

                // ---------- 3. 应用 player ----------
                PlayerStateManager.player = data.player.data;
                PlayerStateManager.displayedBars = data.player.displayedBars;

                // ---------- 4. 应用 story ----------
                StoryManager.storyList = data.story.storyList;
                StoryManager.chapters = data.story.chapters;
                StoryManager.currentChapter = data.story.currentChapter;
                StoryManager.currentStory = data.story.currentStory;
                StoryManager.volumes = data.story.volumes;
                StoryManager.currentVolume = data.story.currentVolume;
                StoryManager._listIndex = data.story._listIndex;

                // currentVolume 重绑
                if (data.story.currentVolume?.id) {
                    StoryManager.currentVolume =
                        StoryManager.volumes.find(v => v.id === data.story.currentVolume.id)
                        || data.story.currentVolume;
                } else {
                    StoryManager.currentVolume = null;
                }

                // ---------- 5. 重建规则引擎 ----------
                const rulesText = data.cinema.worldState.gameRules || '';
                if (typeof RuleEngine !== 'undefined') {
                    RuleEngine.parse(rulesText);
                }
                if (typeof TagEffectManager !== 'undefined') {
                    TagEffectManager.syncFromRules();
                }

                // ---------- 6. 重建战斗规则 ----------
                const battleRules = data.cinema.worldState.combat?.battleRules;
                if (battleRules && typeof BattleRuleManager !== 'undefined') {
                    // 已经是解析好的对象，直接用
                    BattleRuleManager.save(battleRules);
                }

                // ---------- 7. 同步角色名 ----------
                if (typeof CharacterNameManager !== 'undefined') {
                    CharacterNameManager.sync();
                }

                // ---------- 8. 重算装备加成 + 派生属性 ----------
                if (typeof EquipmentManager !== 'undefined') {
                    EquipmentManager.recomputeBonuses();
                }
                if (typeof DerivedStatsEngine !== 'undefined') {
                    DerivedStatsEngine.recompute(PlayerStateManager.player);
                }

                // ---------- 9. 定位当前场景 ----------
                const curName = CinemaWorld.ui.currentLocation;
                const curScene = curName ? WorldManager.findEntity(curName) : null;
                LocationModalManager.currentLocation = curScene;

            } finally {
                this._applying = false;
            }
        },

        // ============================================================
        // 刷新全部 UI
        // ============================================================
        async refreshAllUI() {
            // 关闭所有模态框
            if (typeof UIManager !== 'undefined') {
                UIManager.closeModal();
            }

            // 手机界面
            if (typeof PhoneUIManager !== 'undefined' && PhoneUIManager.isOpen) {
                PhoneUIManager.close();
            }

            // 战斗叠加层
            if (typeof BattleUIManager !== 'undefined') {
                const ruleOverlay = document.getElementById('cw-battle-rule-overlay');
                if (ruleOverlay) ruleOverlay.remove();
                BattleUIManager.close();
            }

            // 头像区
            if (typeof PlayerStateManager !== 'undefined') {
                PlayerStateManager.refreshAvatarArea();
            }

            // 世界状态
            if (typeof UIManager !== 'undefined') {
                UIManager.updateWorldStateDisplay();
                UIManager.createFloatingButtons();
            }

            // 场景视觉层
            const curScene = LocationModalManager.currentLocation;
            if (curScene && typeof LocationModalManager !== 'undefined') {
                await LocationModalManager.restoreScene(curScene);
                if (typeof SceneActionManager !== 'undefined') {
                    SceneActionManager.refresh();
                }
            } else {
                if (typeof BackgroundManager !== 'undefined') BackgroundManager.clear();
                if (typeof MusicManager !== 'undefined') MusicManager.setSceneMusic(null);
                if (typeof SceneSpriteLayerManager !== 'undefined') SceneSpriteLayerManager.clear();
                if (typeof SceneAvatarBarManager !== 'undefined') SceneAvatarBarManager.clear();
                if (typeof SceneActionManager !== 'undefined') SceneActionManager.refresh();
            }

            // 场景头像栏（如果存在当前场景）
            if (curScene && typeof SceneAvatarBarManager !== 'undefined') {
                SceneAvatarBarManager.buildForScene(curScene);
            }
        },

        // ============================================================
        // 保存 / 加载
        // ============================================================
        save() {
            if (this._applying) return false;
            try {
                const data = this.serialize();
                localStorage.setItem(this.SAVE_KEY, JSON.stringify(data));
                return true;
            } catch (e) {
                console.error('[CinemaWorld] 保存失败:', e);
                return false;
            }
        },

        load() {
            try {
                const str = localStorage.getItem(this.SAVE_KEY);
                if (!str) return false;

                const parsed = JSON.parse(str);
                const migrated = this._migrate(parsed);
                if (!migrated) {
                    console.warn('[CinemaWorld] 存档迁移失败');
                    return false;
                }
                const normalized = this._normalize(migrated);
                this.apply(normalized);

                console.log('[CinemaWorld] 存档已加载');
                return true;
            } catch (e) {
                console.error('[CinemaWorld] 加载失败:', e);
                return false;
            }
        },

        deleteSave() {
            try {
                localStorage.removeItem(this.SAVE_KEY);
                return true;
            } catch (e) {
                console.error('[CinemaWorld] 删除存档失败:', e);
                return false;
            }
        },

        // ============================================================
        // 导出：从内存序列化（保证是最新的）
        // ============================================================
        exportSave() {
            try {
                // ★ 直接从内存构造，而不是读 localStorage
                //    避免 30s 自动保存还没触发导致导出旧数据
                const data = this.serialize();

                const json = JSON.stringify(data, null, 2);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;

                // ★ 文件名：章节名 + 进度 + 时间戳
                const chapterName = this._getCurrentChapterNameForFileName();
                const progress = this._getProgressString();

                // 文件名带时间戳
                const d = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
                a.download = `CinemaWorld_${chapterName}${progress}_v${this.VERSION}_${stamp}.json`;

                a.click();
                URL.revokeObjectURL(url);

                return true;
            } catch (e) {
                console.error('[CinemaWorld] 导出失败:', e);
                alert('导出失败：' + e.message);
                return false;
            }
        },

        // ★ 新增：获取当前章节名（用于文件名），做安全处理
        _getCurrentChapterNameForFileName() {
            const ch = StoryManager.currentChapter;

            // 没章节 → 用占位名
            if (!ch || !ch.title) return '无章节';

            // 移除文件名不允许的字符：\ / : * ? " < > |
            // 同时去掉首尾空格和点号
            let safe = String(ch.title)
                .replace(/[\\/:*?"<>|]/g, '_')   // 非法字符 → 下划线
                .replace(/\s+/g, ' ')             // 连续空白压成一个空格
                .trim()
                .replace(/^\.+|\.+$/g, '');       // 去首尾点

            // 限制长度，避免超长文件名
            if (safe.length > 40) safe = safe.slice(0, 40);

            // 兜底：清洗后为空
            return safe || '无章节';
        },

        // ★ 新增：获取进度字符串（本章 x/y · 总计 n 段）
        _getProgressString() {
            const ch = StoryManager.currentChapter;
            const allStories = StoryManager.storyList || [];

            // 本次完成的总段数（所有章节）
            const totalDone = allStories.filter(s => s.status === 'completed').length;

            // 本章数据
            let chapterProgress = '';
            if (ch) {
                const ROLLOVER_THRESHOLD = 8;  // 与 story.js 里保持一致

                // 本章已完成的剧情数
                const chapterStories = allStories.filter(s => s.chapterId === ch.id);
                const chapterDone = chapterStories.filter(s => s.status === 'completed').length;

                // 显示：本章已完成/滚动阈值
                chapterProgress = `_${chapterDone}of${ROLLOVER_THRESHOLD}`;
            }

            return `${chapterProgress}_总${totalDone}段`;
        },

        // ============================================================
        // 导入：文件 → 迁移 → 归一化 → 预览 → 应用 → 刷新
        // ============================================================
        importSave() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';

            input.onchange = (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = async (ev) => {
                    // ---------- 1. 解析 ----------
                    let parsed;
                    try {
                        parsed = JSON.parse(ev.target.result);
                    } catch (err) {
                        alert('❌ 文件不是有效的 JSON：\n' + err.message);
                        return;
                    }

                    // ---------- 2. 迁移 + 归一化 ----------
                    let normalized;
                    try {
                        const migrated = this._migrate(parsed);
                        if (!migrated) {
                            alert('❌ 无法识别存档结构（可能不是 CinemaWorld 的存档）');
                            return;
                        }
                        normalized = this._normalize(migrated);
                    } catch (err) {
                        console.error('[CinemaWorld] 导入解析失败:', err);
                        alert('❌ 存档解析失败：\n' + err.message);
                        return;
                    }

                    // ---------- 3. 预览 + 确认 ----------
                    const ok = await this._confirmImport(normalized);
                    if (!ok) return;

                    // ---------- 4. 应用 ----------
                    try {
                        this.apply(normalized);
                    } catch (err) {
                        console.error('[CinemaWorld] 应用存档失败:', err);
                        alert('❌ 应用存档失败：\n' + err.message);
                        return;
                    }

                    // ---------- 5. 保存到 localStorage ----------
                    this.save();

                    // ---------- 6. 刷新 UI ----------
                    await this.refreshAllUI();

                    if (typeof UIManager !== 'undefined') {
                        await UIManager.showText('✅ 存档导入成功', 2000);
                    }
                };

                reader.onerror = () => {
                    alert('❌ 读取文件失败');
                };

                reader.readAsText(file);
            };

            input.click();
        },

        // ---------- 导入确认弹窗 ----------
        _confirmImport(data) {
            return new Promise((resolve) => {
                const modal = document.getElementById('cinemaworld-modal');
                if (!modal) {
                    // 兜底：没有模态框就用原生 confirm
                    resolve(confirm('确定要导入这个存档吗？\n\n导入会完全覆盖当前所有数据。'));
                    return;
                }

                const meta = data._meta || {};
                const dateStr = meta.timestamp
                    ? new Date(meta.timestamp).toLocaleString()
                    : '未知';

                // 统计信息
                const ws = data.cinema?.worldState || {};
                const sceneCount = ws.entities?.length || 0;
                const charCount = Object.keys(ws.characters || {}).length;
                const chapterCount = data.story?.chapters?.length || 0;
                const volumeCount = data.story?.volumes?.length || 0;
                const storyCount = data.story?.storyList?.length || 0;
                const playerName = data.player?.data?.name || '未知';
                const curScene = data.cinema?.ui?.currentLocation || '（无）';

                const versionText = meta.migratedFrom
                    ? `v${meta.version}（从 v${meta.migratedFrom} 迁移）`
                    : `v${meta.version}`;

                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📥 导入存档</div>

                    <div style="font-size:13px;color:#ccc;line-height:1.9;padding:14px 16px;
                        background:rgba(255,255,255,.04);border-radius:10px;margin-bottom:14px;">
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:#888;">存档时间</span><span>${dateStr}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:#888;">版本</span><span>${versionText}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:#888;">玩家</span><span>${playerName}</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:#888;">场景</span><span>${sceneCount} 个</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:#888;">角色</span><span>${charCount} 个</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:#888;">章节 / 卷</span><span>${chapterCount} 章 / ${volumeCount} 卷</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:#888;">剧情卡</span><span>${storyCount} 段</span>
                        </div>
                        <div style="display:flex;justify-content:space-between;">
                            <span style="color:#888;">当前场景</span><span>${curScene}</span>
                        </div>
                    </div>

                    <div style="padding:12px 14px;background:rgba(216,125,125,.12);
                        border:1px solid rgba(216,125,125,.35);border-radius:10px;
                        font-size:13px;color:#ffb8b8;margin-bottom:16px;line-height:1.6;">
                        ⚠️ 导入会<strong>完全覆盖</strong>当前的所有数据，且无法撤销。<br>
                        建议先导出当前存档作为备份。
                    </div>

                    <div style="text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                        <button class="cinemaworld-button" id="cw-import-backup">💾 备份当前</button>
                        <button class="cinemaworld-button primary" id="cw-import-confirm">✅ 确认覆盖</button>
                        <button class="cinemaworld-button" id="cw-import-cancel">✖ 取消</button>
                    </div>
                `;

                modal.className = 'active';

                const cleanup = () => {
                    modal.classList.remove('active');
                    modal.innerHTML = '';
                };

                document.getElementById('cw-import-backup').onclick = () => {
                    this.exportSave();
                    if (typeof UIManager !== 'undefined') {
                        UIManager.showText('当前存档已备份', 1500);
                    }
                };
                document.getElementById('cw-import-confirm').onclick = () => {
                    cleanup();
                    resolve(true);
                };
                document.getElementById('cw-import-cancel').onclick = () => {
                    cleanup();
                    resolve(false);
                };
            });
        },
    };

    // ==================== 挂载到 window ====================
    window.SaveManager = SaveManager;

    console.log('[CinemaWorld] save.js 已加载');
})();