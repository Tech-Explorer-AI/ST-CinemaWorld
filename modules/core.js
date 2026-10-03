// ============================================================
// CinemaWorld · core.js
// 底层核心：全局状态 / 角色档案 / 角色名同步 / 骰子 / 语义
// 依赖：无（除浏览器原生 API）
// ============================================================

(function () {
    'use strict';

    // ==================== 全局状态 ====================
    const CinemaWorld = {
        isGenerating: false,
        worldState: {
            entities: [],      // 场景实体（只有 type === 'location' 的）
            narrativeLog: [],  // 剧情日志
            characters: {},
            interactions: [],
            spriteAssignments: {},
            worldHistory: { summary: '', updatedAt: null, eraCount: 0 },
            mainQuest: null,
            playMode: 'scene',
            // ★ 新增
            combat: {
                activeCombat: null,
                battleRules: null,
                battlePackages: {},      // 旧：整包缓存（保留兼容）
                battleSkeletons: {},     // ★ 新：战斗骨架缓存（按敌人名字）
                history: [],
            }
        },
        ui: {
            currentLocation: null, // 当前所在场景名（唯一权威来源）
        },

        currentAIChatName: 'AI',
        currentUserName: '主人公',
    };

    // ==================== 人物档案管理器 ====================
    // ==================== 人物档案管理器 ====================
    const CharacterRegistry = {
        // ★ 名字归一化：去掉所有空白、全角空格、零宽字符
        normalizeName(name) {
            return String(name || '')
                .replace(/[\s\u3000\u200b\u200c\u200d\ufeff]/g, '')
                .trim();
        },

        // ★ 内部：用归一化名字拿记录
        _getRecord(name) {
            const norm = this.normalizeName(name);
            if (!norm) return null;
            return CinemaWorld.worldState.characters?.[norm] || null;
        },
        // ============================================================
        // ★ 全量同步：进入/离开地图时调一次
        //   - 新 NPC 注册
        //   - 已存在 NPC 补充字段
        //   - 从地图上被删掉的 NPC → 标记 isPresent = false
        // ============================================================
        syncFromMap(map) {
            if (!map?.entities) return { added: 0, updated: 0, left: 0 };

            const mapName = map.name || '';
            const inMap = new Set();     // 归一化名字
            let added = 0;
            let updated = 0;

            // 1. 遍历地图上的 NPC
            for (const ent of map.entities) {
                if (!ent || ent.isPlayer) continue;
                if (ent.kind !== 'npc') continue;
                if (!ent.name) continue;

                const normName = this.normalizeName(ent.name);
                if (!normName) continue;
                inMap.add(normName);

                const existed = !!CinemaWorld.worldState.characters[normName];
                const record = this.registerFromMapEntity(ent, mapName);

                if (record) {
                    // ★ 覆盖式更新：地图上的这些字段就是"当前真相"
                    record.gender = record.gender || ent.meta?.gender || ent.fields?.['性别'] || '';
                    record.mood = ent.meta?.mood || ent.fields?.['心情'] || record.mood || '';
                    record.status = ent.status || record.status || '';
                    record.favorability = ent.fields?.['好感度'] || record.favorability || '';
                    if (ent.description) record.description = ent.description;
                    if (ent.tags?.length) record.tags = ent.tags;

                    // 标记来源和位置
                    record.lastScene = mapName;
                    record.lastSeenAt = Date.now();
                    record.isPresent = true;
                    record.source = record.source || 'map';

                    if (existed) updated++;
                    else added++;
                }
            }

            // 2. 反向清理：档案里标着 source='map'、lastScene=当前地图、但地图上已没了的
            let left = 0;
            for (const record of Object.values(CinemaWorld.worldState.characters || {})) {
                if (record.source !== 'map') continue;
                if (record.lastScene !== mapName) continue;

                const normName = this.normalizeName(record.name);
                if (!normName) continue;
                if (inMap.has(normName)) continue;

                // 地图上没了 → 标记离开
                record.isPresent = false;
                record.lastSeenAt = Date.now();
                left++;
            }

            if (added || updated || left) {
                console.log(`[CharacterRegistry] syncFromMap(${mapName}): +${added} ~${updated} -${left}`);
            }

            return { added, updated, left };
        },
        // 从场景同步角色到档案
        syncFromScene(scene) {
            if (!scene?.sceneCharacters) return;
            for (const ch of scene.sceneCharacters) {
                if (!ch.name) continue;
                this.upsert(ch, scene.name, true);
            }
        },

        // 人物离开场景
        markLeft(name, sceneName) {
            const record = this._getRecord(name);
            if (!record) return;
            record.isPresent = false;
            record.lastSeenAt = Date.now();
            const stillInScene = CinemaWorld.worldState.entities.some(
                s => s.type === 'location' && s.sceneCharacters?.some(
                    c => this.normalizeName(c.name) === this.normalizeName(name)
                )
            );
            record.isPresent = stillInScene;
        },

        // 人物加入场景
        markJoined(name, sceneName) {
            const record = this._getRecord(name);
            if (!record) return;
            record.isPresent = true;
            record.lastScene = sceneName;
            record.lastSeenAt = Date.now();
            if (!record.appearances.includes(sceneName)) {
                record.appearances.push(sceneName);
            }
        },

        // 创建或更新档案
        upsert(ch, sceneName, isPresent) {
            if (!ch?.name) return null;

            const normName = this.normalizeName(ch.name);
            if (!normName) return null;

            const chars = CinemaWorld.worldState.characters;
            const existing = chars[normName];

            if (!existing) {
                // ★ 新档案：key 用归一化名字，name 保留原始
                chars[normName] = {
                    name: ch.name,
                    _normalizedName: normName,
                    _aliases: [ch.name],

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
                    lastScene: sceneName,
                    appearances: [sceneName],
                    isPresent: isPresent,
                    extraStats: { _order: [], _raw: '' },
                };
                return chars[normName];
            }

            // ---------- 已有档案：合并 ----------
            if (ch.gender) existing.gender = ch.gender;
            if (ch.mood) existing.mood = ch.mood;
            if (ch.favorability) existing.favorability = ch.favorability;
            if (ch.status) existing.status = ch.status;
            if (ch.tags?.length) existing.tags = ch.tags;
            if (ch.description) existing.description = ch.description;
            existing.lastSeenAt = Date.now();

            if (!existing.extraStats) {
                existing.extraStats = { _order: [], _raw: '' };
            }

            // role：只在玩家没手动改过时被 AI 覆盖
            if (ch.role && existing.roleChangedBy !== 'player') {
                existing.role = ch.role;
                existing.roleChangedBy = 'auto';
            }

            if (isPresent) {
                existing.isPresent = true;
                existing.lastScene = sceneName;
                if (!existing.appearances.includes(sceneName)) {
                    existing.appearances.push(sceneName);
                }
            }

            // ★ 记录别名
            existing._aliases = existing._aliases || [];
            if (!existing._aliases.includes(ch.name)) {
                existing._aliases.push(ch.name);
            }
            if (!existing._normalizedName) existing._normalizedName = normName;

            return existing;
        },

        // 获取全部
        getAll() {
            return Object.values(CinemaWorld.worldState.characters || {});
        },

        // ★ 按归一化名字查
        get(name) {
            return this._getRecord(name);
        },

        // ★ 查找别名（给立绘/显示用）
        findByAlias(name) {
            const norm = this.normalizeName(name);
            const chars = CinemaWorld.worldState.characters || {};
            if (chars[norm]) return chars[norm];
            // 兜底：遍历 _aliases
            for (const rec of Object.values(chars)) {
                if (rec._aliases?.some(a => this.normalizeName(a) === norm)) {
                    return rec;
                }
            }
            return null;
        },

        // 获取主要角色
        getMainCharacters() {
            return this.getAll().filter(c => c.role === 'main');
        },

        // 获取次要角色
        getMinorCharacters() {
            return this.getAll().filter(c => c.role === 'minor');
        },

        // 获取路人
        getNpcCharacters() {
            return this.getAll().filter(c => c.role === 'npc');
        },

        // ★ 玩家手动设置角色定位
        setRole(name, role) {
            const record = this._getRecord(name);
            if (!record) return false;
            if (!['main', 'minor', 'npc'].includes(role)) return false;
            record.role = role;
            record.roleChangedBy = 'player';
            return true;
        },

        // 从场景移除时同步
        removeFromScene(scene, name) {
            if (!scene?.sceneCharacters) return;
            const norm = this.normalizeName(name);
            const idx = scene.sceneCharacters.findIndex(
                c => this.normalizeName(c.name) === norm
            );
            if (idx > -1) scene.sceneCharacters.splice(idx, 1);
            this.markLeft(name, scene.name);
        },

        // 首次建立时：从所有已有场景导入
        rebuildFromScenes() {
            const scenes = CinemaWorld.worldState.entities.filter(e => e.type === 'location');
            for (const scene of scenes) {
                if (scene.sceneCharacters) {
                    for (const ch of scene.sceneCharacters) {
                        if (ch.name) {
                            this.upsert(
                                ch,
                                scene.name,
                                scene.name === CinemaWorld.ui.currentLocation
                            );
                        }
                    }
                }
            }
        },

        // ============================================================
        // ★ 新增：从地图实体注册
        // ============================================================
        registerFromMapEntity(ent, mapName) {
            if (!ent?.name) return null;
            if (ent.isPlayer) return null;
            if (ent.kind !== 'npc') return null;

            const normName = this.normalizeName(ent.name);
            if (!normName) return null;

            const chars = CinemaWorld.worldState.characters;
            const existing = chars[normName];

            // ---------- 已有 → 补充缺失字段 ----------
            if (existing) {
                if (!existing.gender && ent.meta?.gender) existing.gender = ent.meta.gender;
                if (!existing.mood && ent.meta?.mood) existing.mood = ent.meta.mood;
                if (!existing.status && ent.status) existing.status = ent.status;
                if (!existing.description && ent.description) existing.description = ent.description;
                if ((!existing.tags || existing.tags.length === 0) && ent.tags?.length) {
                    existing.tags = ent.tags;
                }
                if (!existing.lastScene && mapName) existing.lastScene = mapName;

                // 记录别名
                existing._aliases = existing._aliases || [];
                if (!existing._aliases.includes(ent.name)) {
                    existing._aliases.push(ent.name);
                }

                return existing;
            }

            // ---------- 新建 ----------
            chars[normName] = {
                name: ent.name,
                _normalizedName: normName,
                _aliases: [ent.name],

                gender: ent.meta?.gender || ent.fields?.['性别'] || '',
                mood: ent.meta?.mood || ent.fields?.['心情'] || '',
                favorability: ent.fields?.['好感度'] || '',
                status: ent.status || '',
                tags: ent.tags || [],
                description: ent.description || '',
                role: ent.meta?.role || 'minor',
                roleChangedBy: 'auto',

                firstSeenAt: Date.now(),
                lastSeenAt: Date.now(),
                lastScene: mapName || '',
                appearances: mapName ? [mapName] : [],
                isPresent: true,

                source: 'map',
                extraStats: { _order: [], _raw: '' },
            };

            return chars[normName];
        },

        // ★ 扫一张地图，把所有 NPC 注册进来
        registerMapEntities(map) {
            if (!map?.entities) return 0;

            let count = 0;
            for (const ent of map.entities) {
                if (!ent || ent.isPlayer) continue;
                if (ent.kind !== 'npc') continue;
                if (!ent.name) continue;

                const normName = this.normalizeName(ent.name);
                const existed = !!CinemaWorld.worldState.characters[normName];

                this.registerFromMapEntity(ent, map.name);

                if (!existed) count++;
            }

            if (count > 0) {
                console.log(`[CharacterRegistry] 从【${map.name}】注册了 ${count} 个新角色`);
            }
            return count;
        },

        // ★ 按名字注册（通用）
        registerByName(name, extra = {}) {
            const normName = this.normalizeName(name);
            if (!normName) return null;

            const chars = CinemaWorld.worldState.characters;
            const existing = chars[normName];

            if (existing) {
                for (const [k, v] of Object.entries(extra)) {
                    if (v === undefined || v === null || v === '') continue;
                    if (existing[k] === undefined || existing[k] === '' ||
                        (Array.isArray(existing[k]) && existing[k].length === 0)) {
                        existing[k] = v;
                    }
                }
                existing._aliases = existing._aliases || [];
                if (!existing._aliases.includes(name)) {
                    existing._aliases.push(name);
                }
                return existing;
            }

            chars[normName] = {
                name,
                _normalizedName: normName,
                _aliases: [name],
                gender: extra.gender || '',
                mood: extra.mood || '',
                favorability: extra.favorability || '',
                status: extra.status || '',
                tags: extra.tags || [],
                description: extra.description || '',
                role: extra.role || 'minor',
                roleChangedBy: 'auto',
                firstSeenAt: Date.now(),
                lastSeenAt: Date.now(),
                lastScene: extra.lastScene || '',
                appearances: extra.lastScene ? [extra.lastScene] : [],
                isPresent: true,
                extraStats: { _order: [], _raw: '' },
            };
            return chars[normName];
        },

        // ============================================================
        // ★ 迁移：把旧存档里"原始名字做 key"的数据，转成"归一化名字做 key"
        // ============================================================
        migrateOldData() {
            const chars = CinemaWorld.worldState.characters || {};
            const migrated = {};

            for (const [oldKey, record] of Object.entries(chars)) {
                const normName = this.normalizeName(record.name || oldKey);
                if (!normName) continue;

                if (migrated[normName]) {
                    // 合并重复的
                    const existing = migrated[normName];
                    existing._aliases = existing._aliases || [];
                    if (!existing._aliases.includes(record.name)) {
                        existing._aliases.push(record.name);
                    }
                    // 补缺
                    for (const [k, v] of Object.entries(record)) {
                        if (k === 'name' || k === '_aliases') continue;
                        if (v === undefined || v === null || v === '') continue;
                        if (existing[k] === undefined || existing[k] === '') {
                            existing[k] = v;
                        }
                    }
                } else {
                    record._normalizedName = normName;
                    record._aliases = record._aliases || [record.name || oldKey];
                    migrated[normName] = record;
                }
            }

            CinemaWorld.worldState.characters = migrated;
            console.log('[CharacterRegistry] 旧数据迁移完成，共', Object.keys(migrated).length, '个角色');
        },
    };

    // ==================== 角色名工具 ====================
    const CharacterNameManager = {
        getAIName() {
            const ctx = SillyTavern.getContext();
            if (ctx && ctx.chat) {
                for (let i = ctx.chat.length - 1; i >= 0; i--) {
                    const msg = ctx.chat[i];
                    if (!msg.is_user && msg.name && !['AI', '助手', '系统'].includes(msg.name)) {
                        CinemaWorld.currentAIChatName = msg.name;
                        return msg.name;
                    }
                }
            }
            return CinemaWorld.currentAIChatName;
        },
        getUserName() {
            const ctx = SillyTavern.getContext();
            if (ctx && ctx.chat) {
                for (let i = ctx.chat.length - 1; i >= 0; i--) {
                    const msg = ctx.chat[i];
                    if (msg.is_user && msg.name) {
                        CinemaWorld.currentUserName = msg.name;
                        return msg.name;
                    }
                }
            }
            return CinemaWorld.currentUserName;
        },
        sync() {
            this.getAIName();
            this.getUserName();
            if (typeof PlayerStateManager !== 'undefined') {
                PlayerStateManager.syncPlayerName();
            }
        }
    };

    // ==================== 骰子引擎 ====================
    // 支持：d20、3d6、2d10、d100、d20+5、d20+力量、(d20+d20)/2
    const DiceEngine = {
        // 求值一个可能包含骰子的表达式
        // context: { 属性名: 数值, 派生名: 数值, 常数... }
        // 求值一个可能包含骰子的表达式
        // context: { 属性名: 数值, 派生名: 数值, 敌人: Proxy, 我方: Proxy, ... }
        roll(expr, context = {}) {
            if (!expr) return 0;
            let work = String(expr);

            // ============================================================
            // 1. 替换 {键名} → context[键名]
            //    支持 {敌人.防御} 命名空间语法
            // ============================================================
            work = work.replace(/\{([^}]+)\}/g, (m, key) => {
                const k = key.trim();

                // ---------- 命名空间：a.b ----------
                if (k.includes('.')) {
                    const [ns, attr] = k.split('.');
                    const obj = context[ns];
                    let v;
                    if (obj && typeof obj === 'object') {
                        v = obj[attr];
                    } else {
                        v = context[k];
                    }
                    if (v === undefined || v === null) v = 0;
                    if (typeof v === 'object') v = v.value ?? v.current ?? 0;
                    v = Number(v) || 0;
                    return String(v);
                }

                // ---------- 普通属性 ----------
                let v = context[k];
                if (v === undefined || v === null) v = 0;
                if (typeof v === 'object') {
                    if (typeof v.valueOf === 'function' && v.valueOf() !== v) {
                        v = v.valueOf();
                    } else {
                        v = v.value ?? v.current ?? 0;
                    }
                }
                v = Number(v) || 0;
                return String(v);
            });

            // ============================================================
            // 2. 替换裸命名空间：敌人.防御 / 我方.攻击 / 玩家.敏捷
            //    （AI 有时会忘记写 {}）
            // ============================================================
            work = work.replace(
                /(敌人|我方|玩家)\.([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*)/g,
                (m, ns, attr) => {
                    const obj = context[ns];
                    let v;
                    if (obj && typeof obj === 'object') {
                        v = obj[attr];
                    }
                    if (v === undefined || v === null) v = 0;
                    if (typeof v === 'object') v = v.value ?? v.current ?? 0;
                    v = Number(v) || 0;
                    return String(v);
                }
            );

            work = work.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
            // =============== =============================================
            // 3. 替换骰子表达式 MdN / dN
            // ============================================================
            work = work.replace(/(\d*)d(\d+)/gi, (match, count, sides) => {
                const n = count ? parseInt(count) : 1;
                const s = parseInt(sides);
                let sum = 0;
                for (let i = 0; i < n; i++) {
                    sum += Math.floor(Math.random() * s) + 1;
                }
                return String(sum);
            });

            // ============================================================
            // 4. 数学求值
            // ============================================================
            return this._evaluateMath(work, context);
        },

        // 纯数学求值（不含骰子），也会替换属性名
        _evaluateMath(expr, context) {
            if (!expr) return 0;

            let safe = String(expr)
                .replace(/[×✕]/g, '*')
                .replace(/[÷]/g, '/')
                .replace(/（/g, '(')
                .replace(/）/g, ')');

            safe = safe.replace(/(\d+(?:\.\d+)?)\s*%/g, '($1/100)');
            // ============================================================
            // 1. 白名单函数名（不允许被当属性替换）
            // ============================================================
            const BUILTIN_FUNCTIONS = new Set([
                'max', 'min', 'abs', 'round', 'floor', 'ceil',
                'sqrt', 'pow', 'sin', 'cos', 'tan', 'log', 'exp',
            ]);

            // ============================================================
            // 2. 提取标识符，替换成数值
            // ============================================================
            const identRegex = /([\u4e00-\u9fa5A-Za-z_][\u4e00-\u9fa5A-Za-z0-9_]*)/g;
            const ids = new Set();
            let m;
            while ((m = identRegex.exec(safe)) !== null) {
                const id = m[1];
                if (/^\d/.test(id)) continue;
                if (BUILTIN_FUNCTIONS.has(id)) continue;
                ids.add(id);
            }

            const sortedIds = Array.from(ids).sort((a, b) => b.length - a.length);
            for (const id of sortedIds) {
                let v = context[id];
                if (v === undefined || v === null) v = 0;
                if (typeof v === 'object') {
                    if (typeof v.valueOf === 'function' && v.valueOf() !== v) {
                        v = v.valueOf();
                    } else {
                        v = v.value ?? v.current ?? 0;
                    }
                }
                v = Number(v) || 0;
                const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                safe = safe.replace(new RegExp(escaped, 'g'), String(v));
            }

            // ============================================================
            // 3. 安全检查
            // ============================================================
            if (!/^[\d\s+\-*/().,]+$/.test(safe)) {
                console.warn('[DiceEngine] 非法表达式:', safe);
                return 0;
            }

            // ============================================================
            // 4. 第一遍：直接求值
            // ============================================================
            try {
                // eslint-disable-next-line no-new-func
                const result = Function(`"use strict"; return (${safe})`)();
                if (typeof result === 'number' && isFinite(result)) {
                    return result;
                }
            } catch (e) {
                console.warn('[DiceEngine] 表达式有语法错误，尝试修复:', safe);
            }

            // ============================================================
            // 5. 第二遍：括号配对修复
            // ============================================================
            const fixed = this._fixParentheses(safe);
            if (fixed !== safe) {
                try {
                    // eslint-disable-next-line no-new-func
                    const result = Function(`"use strict"; return (${fixed})`)();
                    if (typeof result === 'number' && isFinite(result)) {
                        console.log('[DiceEngine] 修复后成功:', fixed, '=', result);
                        return result;
                    }
                } catch (e2) {
                    console.warn('[DiceEngine] 括号修复后仍失败:', fixed);
                }
            }

            // ============================================================
            // 6. 第三遍：剥离所有括号，降级求值
            // ============================================================
            const noParens = safe.replace(/[()]/g, '');
            if (/^[\d\s+\-*/.]+$/.test(noParens)) {
                try {
                    // eslint-disable-next-line no-new-func
                    const result = Function(`"use strict"; return (${noParens})`)();
                    if (typeof result === 'number' && isFinite(result)) {
                        console.warn('[DiceEngine] 括号已剥离，降级求值:', noParens, '=', result);
                        return result;
                    }
                } catch (e3) {
                    console.error('[DiceEngine] 剥离括号后仍失败:', noParens);
                }
            }

            // ============================================================
            // 7. 彻底放弃
            // ============================================================
            console.error('[DiceEngine] 求值失败，返回 0。原始表达式:', expr, '当前:', safe);
            return 0;
        },

        // ★ 修复括号配对：多余的右括号丢弃，缺失的右括号补齐
        _fixParentheses(expr) {
            let open = 0;
            let result = '';

            for (let i = 0; i < expr.length; i++) {
                const ch = expr[i];
                if (ch === '(') {
                    open++;
                    result += ch;
                } else if (ch === ')') {
                    if (open > 0) {
                        open--;
                        result += ch;
                    }
                    // else：多余的右括号，直接丢弃
                } else {
                    result += ch;
                }
            }

            // 补齐缺失的右括号
            while (open > 0) {
                result += ')';
                open--;
            }

            return result;
        },

        // 判断一个表达式里是否含骰子
        hasDice(expr) {
            return /\d*d\d+/i.test(String(expr || ''));
        },

        // 只掷骰子、不代入属性，用于展示"自然骰"
        rollNatural(expr) {
            const m = String(expr || '').match(/(\d*)d(\d+)/i);
            if (!m) return null;
            const sides = parseInt(m[2]);
            return Math.floor(Math.random() * sides) + 1;
        },
    };

    // ==================== 语义识别器 ====================
    // 把玩家数据里"通用语义"的属性识别出来，供引擎消费
    const SemanticTagger = {
        patterns: {
            hp: /生命|血量|气血|生命值|HP|hp/,
            energy: /体力|精力|气力|耐力|行动力/,
            exp: /经验|EXP|exp|历练/,
            level: /等级|Lv|LV|lv|级别/,
            gold: /金币|金钱|铜钱|银两|金/,
            hunger: /饥饿|饱食|食欲|饱腹/,
        },

        // 只识别玩家（角色暂不需要硬编码钩子）
        tag(player) {
            const tags = {};
            if (!player) return tags;

            // 1. 扫描数值条
            for (const bar of player.statusBars || []) {
                for (const [sem, re] of Object.entries(this.patterns)) {
                    if (tags[sem]) continue;
                    if (re.test(bar.key)) {
                        tags[sem] = {
                            source: 'bar',
                            ref: bar,
                            key: bar.key,
                            get current() { return bar.current; },
                            get max() { return bar.max; },
                        };
                        break;
                    }
                }
            }

            // 2. 扫描额外数据（金币、等级常在这里）
            const extra = player.extraStats;
            if (extra && extra._order) {
                for (const k of extra._order) {
                    for (const [sem, re] of Object.entries(this.patterns)) {
                        if (tags[sem]) continue;
                        if (re.test(k)) {
                            tags[sem] = {
                                source: 'extra',
                                ref: extra,
                                key: k,
                                get value() {
                                    const raw = String(extra[k] ?? '');
                                    const num = raw.match(/^(-?\d+(?:\.\d+)?)/);
                                    return num ? parseFloat(num[1]) : 0;
                                },
                                set value(v) {
                                    const raw = String(extra[k] ?? '');
                                    const unit = raw.replace(/^-?\d+(?:\.\d+)?/, '');
                                    extra[k] = `${v}${unit}`;
                                },
                            };
                            break;
                        }
                    }
                }
            }

            return tags;
        },

        // 判断某个 key 是否属于某语义
        is(key, sem) {
            const re = this.patterns[sem];
            return re ? re.test(key) : false;
        },
    };

    // ==================== 挂载到 window ====================
    window.CinemaWorld = CinemaWorld;
    window.CharacterRegistry = CharacterRegistry;
    window.CharacterNameManager = CharacterNameManager;
    window.DiceEngine = DiceEngine;
    window.SemanticTagger = SemanticTagger;
    window.BackgroundGenerator = window.BackgroundGenerator || null;

    console.log('[CinemaWorld] core.js 已加载');
})();