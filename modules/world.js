// ============================================================
// CinemaWorld · world.js
// 世界数据管理 / 背景 / 音乐 / 立绘
// 依赖：core.js
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const CharacterRegistry = window.CharacterRegistry;

    // ==================== 世界数据管理 ====================
    const WorldManager = {
        // 添加场景（唯一的添加入口）
        addScene(text) {
            const scene = this.parseScene(text);
            if (!scene.name) return null;
            CinemaWorld.worldState.entities.push(scene);

            // ★ 注册角色
            if (typeof CharacterRegistry !== 'undefined') {
                CharacterRegistry.syncFromScene(scene);
            }

            this.addToNarrativeLog(`[创建场景] ${scene.name}`);
            return scene;
        },

        // 解析场景文本
        // 格式：
        // 【场景名】
        // 描述：(...)
        // 环境：(...)
        // 场景人物：
        // - 【人物名】：(描述)，(性别|心情|好感度|状态)，(标签1、标签2)
        // 场景物品：
        // - 【物品名】：(描述)，(状态)
        parseScene(text) {
            const scene = {
                raw: text,
                name: '',
                type: 'location',
                description: '',
                environment: '',
                background: '',
                music: '',
                environmentData: null,
                sceneCharacters: [],
                sceneItems: [],
                statusBar: {},
                sceneActions: [],
                activeLayers: ['identity'],
                isActive: false,
            };

            const nameMatch = text.match(/^\*?【(.+?)】\*?/m);
            if (nameMatch) scene.name = nameMatch[1].trim();

            const lines = text.split('\n');
            let section = 'general';

            for (let raw of lines) {
                const line = raw.trim();
                if (!line) continue;

                // ★ section 切换：同时兼容"物品"和"实体"
                if (/^场景人物[:：]?$/.test(line)) { section = 'characters'; continue; }
                if (/^场景(物品|实体)[:：]?$/.test(line)) { section = 'items'; continue; }
                if (/^场景实体[:：]?$/.test(line)) { section = 'items'; continue; }
                if (/^场景行动[:：]?$/.test(line)) { section = 'actions'; continue; }

                // 描述
                let m = line.match(/^描述[:：]\s*[（(](.+)[)）]\s*$/);
                if (m) { scene.description = m[1].trim(); continue; }

                // 环境
                m = line.match(/^环境[:：]\s*[（(](.+)[)）]\s*$/);
                if (m) { scene.environment = m[1].trim(); continue; }

                m = line.match(/^环境数据[:：]\s*[\[【](.+?)[\]】]\s*$/);
                if (m) {
                    scene.environmentData = this._parseEnvData(m[1]);
                    continue;
                }

                // 背景
                m = line.match(/^(?:背景|背景图片)[:：]\s*(.+)$/);
                if (m) { scene.background = m[1].trim().replace(/[（()）]/g, ''); continue; }

                // 音乐
                m = line.match(/^🎵?\s*音乐[:：]\s*(.+)$/);
                if (m) { scene.music = m[1].trim().replace(/[（()）]/g, ''); continue; }

                // 列表项
                if (section === 'characters' && line.startsWith('-')) {
                    const ch = this.parseCharacterLine(line.substring(1).trim());
                    if (ch && ch.name) scene.sceneCharacters.push(ch);
                    continue;
                }
                if (section === 'items' && line.startsWith('-')) {
                    const it = this.parseItemLine(line.substring(1).trim());
                    if (it && it.name) scene.sceneItems.push(it);
                    continue;
                }
                if (section === 'actions' && line.startsWith('-')) {
                    const act = this.parseActionLine(line.substring(1).trim());
                    if (act && act.name) scene.sceneActions.push(act);
                    continue;
                }
                // 其他键值对
                m = line.match(/^(.+?)[:：]\s*[（(](.+)[)）]\s*$/);
                if (m && m[1].length < 20) {
                    scene.statusBar[m[1].trim()] = m[2].trim();
                }
            }

            if (scene.sceneCharacters.length > 0 || scene.sceneItems.length > 0) {
                scene.activeLayers.push('content');
            }

            return scene;
        },

        // ★ 把环境数据格式化成一行文本，供所有 prompt 复用
        getEnvDataText(scene) {
            const env = scene?.environmentData;
            if (!env || !env._order || env._order.length === 0) {
                return '（暂无环境数据）';
            }
            const text = env._order
                .filter(k => env[k] !== undefined && env[k] !== '')
                .map(k => `${k}:${env[k]}`)
                .join(' | ');
            return text || '（暂无环境数据）';
        },

        // ★ 提取字符串里的第一个 emoji（含变体选择符、ZWJ、肤色、键帽等）
        _extractEmoji(str) {
            if (!str) return null;
            const s = String(str).trim();
            if (!s) return null;

            // 单行正则：覆盖常用 emoji 区块 + 组合修饰符
            const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{1F000}-\u{1F2FF}\u{1F900}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}][\u{FE0F}\u{200D}\u{20E3}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{1F3FB}-\u{1F3FF}]*/u;

            const m = s.match(emojiRegex);
            return m ? m[0].trim() : null;
        },

        // ★ 万能解析：任意 键:值 | 键:值 | 键:值
        _parseEnvData(raw) {
            const env = { _raw: raw, _order: [] };
            const parts = raw.split('|').map(s => s.trim()).filter(Boolean);
            for (const p of parts) {
                const kv = p.match(/^(.+?)[:：]\s*(.+)$/);
                if (kv) {
                    const key = kv[1].trim();
                    env[key] = kv[2].trim();
                    env._order.push(key);
                } else {
                    // 没有冒号的裸词，也保留（如 "阴天"）
                    env[p] = '';
                    env._order.push(p);
                }
            }
            return env;
        },

        // 解析场景行动行
        // - 【行动名|图标|once】：描述       → 一次性
        // - 【行动名|图标|repeat】：描述     → 可重复
        // - 【行动名|图标】：描述            → 默认（AI 自行判断）
        parseActionLine(text) {
            const act = {
                raw: text,
                name: '',
                hint: '',
                icon: '⚡',
                type: 'auto',      // ★ 新增：'once' | 'repeat' | 'auto'
                count: 0,          // ★ 新增：已执行次数
                status: 'available', // ★ 新增：'available' | 'exhausted'
            };

            const nameMatch = text.match(/^【(.+?)】/);
            if (!nameMatch) return act;

            const parts = nameMatch[1].split('|').map(s => s.trim());
            act.name = parts[0] || '';

            // 图标
            if (parts[1]) {
                const emoji = this._extractEmoji(parts[1]);
                if (emoji) act.icon = emoji;
            }

            // ★ 类型
            if (parts[2]) {
                const t = parts[2].toLowerCase();
                if (/once|一次|单次/.test(t)) act.type = 'once';
                else if (/repeat|重复|多次/.test(t)) act.type = 'repeat';
            }

            const colonIdx = text.search(/[:：]/);
            if (colonIdx > -1) {
                act.hint = text.substring(colonIdx + 1).trim();
            }

            if (act.icon === '⚡' && act.hint) {
                const emoji = this._extractEmoji(act.hint);
                if (emoji) act.icon = emoji;
            }

            return act;
        },

        // 解析人物行：格式：【名字|性别|心情|好感度|状态|主次】：描述，[标签1、标签2]
        parseCharacterLine(text) {
            const ch = {
                raw: text,
                name: '',
                type: 'character',
                description: '',
                gender: '',
                mood: '',
                favorability: '',
                status: '',
                role: 'minor',
                tags: [],
            };

            const metaMatch = text.match(/【(.+?)】/);
            if (!metaMatch) return ch;

            // ★ 剥掉每个字段内可能带的 "字段名:" 前缀
            const stripPrefix = (val, ...names) => {
                if (!val) return val;
                let v = String(val).trim();
                for (const n of names) {
                    const re = new RegExp(`^${n}\\s*[:：]\\s*`);
                    if (re.test(v)) {
                        v = v.replace(re, '').trim();
                        break;
                    }
                }
                return v;
            };

            const meta = metaMatch[1].split('|').map(s => s.trim());

            ch.name         = stripPrefix(meta[0] || '', '名字', '姓名', 'name');
            ch.gender       = stripPrefix(meta[1] || '', '性别', 'gender');
            ch.mood         = stripPrefix(meta[2] || '', '心情', '情绪', 'mood');
            ch.favorability = stripPrefix(meta[3] || '', '好感度', '好感', 'favorability', 'fav');
            ch.status       = stripPrefix(meta[4] || '', '状态', 'status');

            // 好感度只保留开头的数字
            if (ch.favorability) {
                const m = String(ch.favorability).match(/^(-?\d+)/);
                if (m) ch.favorability = m[1];
            }

            // 第 6 个字段：主次
            if (meta[5]) {
                const roleStr = meta[5].trim();
                if (/主要|核心|主角|main/i.test(roleStr)) ch.role = 'main';
                else if (/次要|配角|minor/i.test(roleStr)) ch.role = 'minor';
                else if (/路人|npc|背景/i.test(roleStr)) ch.role = 'npc';
            }

            // ★ 关键修复：从 metaMatch[0] 之后开始找冒号
            //   metaMatch[0] = "【织|女|平静|好感度:100|正常|主要】"
            //   metaMatch.index = 该匹配在 text 里的起始位置
            //   所以从 metaMatch.index + metaMatch[0].length 往后找第一个冒号
            const afterMeta = text.substring(metaMatch.index + metaMatch[0].length);
            const colonIdx = afterMeta.search(/[:：]/);
            if (colonIdx === -1) return ch;

            // ★ 注意：content 的起点要加上 afterMeta 相对 text 的偏移
            let content = afterMeta.substring(colonIdx + 1).trim();

            // 提取标签
            const tagsMatch = content.match(/[\[【]([^\]】]+)[\]】]/);
            if (tagsMatch) {
                ch.tags = tagsMatch[1]
                    .split(/[、,，]/)
                    .map(t => t.trim())
                    .filter(Boolean);
                content = content.replace(tagsMatch[0], '').trim();
            }

            ch.description = content.replace(/[，,、\s]+$/g, '').trim();

            return ch;
        },

        parseItemLine(text) {
            const it = {
                raw: text,
                name: '',
                type: 'entity',
                icon: '📦',
                description: '',
                fields: {},
                interactions: [],
                status: '',
                effect: '',
                stackable: false,
                maxStack: null,
                count: 1,
            };

            // ========== 名字解析 ==========
            const nameMatch = text.match(/^【(.+?)】/);
            if (nameMatch) {
                const nameParts = nameMatch[1].split('|').map(s => s.trim());
                it.name = nameParts[0] || '';

                if (nameParts.length > 1) {
                    const extraParts = nameParts.slice(1);
                    let iconFromName = null;
                    const restParts = [];

                    for (const v of extraParts) {
                        if (!v) continue;
                        // 第一个纯 emoji → 当图标
                        if (!iconFromName) {
                            const emoji = this._extractEmoji(v);
                            // ★ 只有当整段 v 就是一个 emoji 时才当图标，避免误吞名字
                            if (emoji && v.replace(emoji, '').trim() === '') {
                                iconFromName = emoji;
                                continue;
                            }
                        }
                        restParts.push(v);
                    }

                    if (iconFromName) it.icon = iconFromName;

                    restParts.forEach((v, i) => {
                        it.fields[`_pos${i + 1}`] = v;
                    });
                }
            }

            const afterName = nameMatch
                ? text.substring(nameMatch[0].length).replace(/^[：:]\s*/, '')
                : text;

            // ========== 方括号字段解析 ==========
            const bracketMatch = afterName.match(/^([\s\S]*?)\s*[\[【]([^\]】]+)[\]】]\s*$/);

            if (bracketMatch) {
                const descPart = bracketMatch[1].trim();
                const fields = bracketMatch[2].split('|').map(s => s.trim());

                it.description = descPart;

                fields.forEach((f, i) => {
                    if (!f) return;
                    const kv = f.match(/^(.+?)[:：]\s*(.+)$/);
                    if (kv) {
                        const key = kv[1].trim();
                        const value = kv[2].trim();
                        it.fields[key] = value;

                        // 交互方式
                        if (['交互', '交互方式', '互动', '互动方式', '操作', 'actions', 'interactions'].includes(key)) {
                            it.interactions = this._parseInteractions(value);
                        }

                        if (key === '状态') it.status = value;
                        if (key === '功能') it.effect = value;
                        if (key === '可堆叠') {
                            if (/^(否|不可|false|no)$/i.test(value)) it.stackable = false;
                            else if (/^(是|可|true|yes)$/i.test(value)) it.stackable = true;
                            else {
                                const n = parseInt(value);
                                if (!isNaN(n) && n > 1) { it.stackable = true; it.maxStack = n; }
                            }
                        }
                        if (key === '数量') {
                            const n = parseInt(value);
                            if (!isNaN(n) && n > 0) it.count = n;
                        }
                        if (key === '类型') it.type = value;
                        if (key === '图标' || key === 'icon') {
                            const icon = this._extractEmoji(value);
                            if (icon) it.icon = icon;
                        }
                    } else {
                        it.fields[`_pos${i + 1}`] = f;
                        if (i === 0 && !it.status) it.status = f;
                    }
                });

                const descEmoji = this._extractEmoji(it.description);
                if (descEmoji && it.icon === '📦') it.icon = descEmoji;

                // ★ 统一拆容器字段
                this._expandAggregateFields(it);
                return it;
            }

            // ========== 没方括号的兜底 ==========
            it.description = afterName.trim();
            const emoji = this._extractEmoji(it.name) || this._extractEmoji(it.description);
            if (emoji) it.icon = emoji;

            // ★ 统一拆容器字段
            this._expandAggregateFields(it);
            return it;
        },

        // ★ 拆分 AI 塞进一个字段的多个属性
        // 处理 "属性:体力:+80、攻击:+5、暴击:+10%" 这种
        _expandAggregateFields(it) {
            const AGGREGATE_KEYS = ['属性', '加成', '效果数值', '数值', '加成属性'];
            let changed = false;

            for (const aggKey of AGGREGATE_KEYS) {
                const raw = it.fields[aggKey];
                if (raw === undefined) continue;

                delete it.fields[aggKey];
                changed = true;

                const parts = String(raw)
                    .split(/[、,，;；|]/)
                    .map(s => s.trim())
                    .filter(Boolean);

                for (const part of parts) {
                    // 去掉开头可能的 "-" 或 "•"
                    const clean = part.replace(/^[-•·]\s*/, '').trim();
                    const kv = clean.match(/^(.+?)[:：]\s*(.+)$/);
                    if (kv) {
                        const k = kv[1].trim();
                        const v = kv[2].trim();
                        if (it.fields[k] === undefined) {
                            it.fields[k] = v;
                        } else {
                            // 已存在 → 尝试数值叠加
                            const oldStr = String(it.fields[k]);
                            const oldNum = parseFloat(oldStr.replace(/[^\d.\-+]/g, ''));
                            const newNum = parseFloat(v.replace(/[^\d.\-+]/g, ''));
                            if (!isNaN(oldNum) && !isNaN(newNum)) {
                                const unit = /%/.test(v) ? '%' : (/[a-zA-Z]/.test(v) ? v.replace(/[^a-zA-Z]/g, '') : '');
                                const sum = oldNum + newNum;
                                it.fields[k] = `${sum >= 0 ? '+' : ''}${sum}${unit}`;
                            }
                            // 非数值 → 跳过（保留原值）
                        }
                    }
                    // 裸词 → 跳过（不写入，避免污染）
                }
            }

            return changed;
        },

        // ★ 解析交互方式字符串
        _parseInteractions(value) {
            if (!value) return [];
            // 先按分隔符切
            const parts = value.split(/[、,，;；|]/).map(s => s.trim()).filter(Boolean);
            return parts.map(p => {
                // 支持 "名称:说明" 或 "名称(说明)"
                let name = p, hint = '';
                let m = p.match(/^(.+?)[:：]\s*(.+)$/);
                if (m) { name = m[1].trim(); hint = m[2].trim(); }
                else {
                    m = p.match(/^(.+?)\s*[（(](.+)[)）]\s*$/);
                    if (m) { name = m[1].trim(); hint = m[2].trim(); }
                }
                return { name, hint };
            });
        },

        // 按名称查找场景
        findEntity(name) {
            return CinemaWorld.worldState.entities.find(e => e.name === name);
        },

        // 获取所有场景（就是所有 entities，因为只存场景）
        getLocations() {
            return CinemaWorld.worldState.entities.filter(e => e.type === 'location');
        },

        // 添加剧情日志
        addToNarrativeLog(text) {
            CinemaWorld.worldState.narrativeLog.push({
                text,
                timestamp: Date.now(),
            });
        },

        // 获取世界状态文本（用于AI上下文）
        getWorldStateText() {
            let text = '';
            for (const entity of CinemaWorld.worldState.entities) {
                text += entity.raw + '\n\n';
            }
            return text;
        },
    };

    // ==================== 背景管理器 ====================
    const BackgroundManager = {
        // 路径候选
        basePaths: [
            'scripts/extensions/third-party/CinemaWorld/images/背景图片/',
            'images/背景图片/',
            './images/背景图片/',
        ],

        // 缓存：已确认存在的文件
        cache: {},
        // 当前背景
        current: null,
        // 已加载的图片元素（用于预加载）
        preloaded: {},

        // 尝试查找背景图片
        async find(name) {
            if (!name) return null;
            if (name in this.cache) return this.cache[name];

            const exts = ['png', 'jpg', 'jpeg', 'webp'];
            for (const base of this.basePaths) {
                for (const ext of exts) {
                    const path = `${base}${name}.${ext}`;
                    if (await this.exists(path)) {
                        this.cache[name] = path;
                        return path;
                    }
                }
            }
            this.cache[name] = null;
            return null;
        },

        // 检查文件存在
        exists(url) {
            return new Promise(resolve => {
                const img = new Image();
                const timer = setTimeout(() => resolve(false), 800);
                img.onload = () => { clearTimeout(timer); resolve(true); };
                img.onerror = () => { clearTimeout(timer); resolve(false); };
                img.src = url;
            });
        },

        // 应用背景（带淡入淡出）
        async apply(name, fade = true) {
            // 如果名字为空，只清除
            if (!name) {
                this.clear();
                return;
            }

            // 同名跳过
            if (this.current === name) return;

            const url = await this.find(name);
            if (!url) {
                console.log(`[CinemaWorld] 未找到背景: ${name}`);
                return;
            }

            this.current = name;
            const bgLayer = document.getElementById('cinemaworld-background');
            if (!bgLayer) return;

            // 创建新层做淡入
            const newLayer = document.createElement('div');
            newLayer.style.cssText = `
                position:absolute;top:0;left:0;width:100%;height:100%;
                background-image:url('${url}');
                background-size:cover;
                background-position:center;
                transition:opacity 0.8s ease;
                opacity:0;
                z-index:0;
            `;
            bgLayer.appendChild(newLayer);

            // 强制 reflow 后淡入
            void newLayer.offsetWidth;
            newLayer.style.opacity = '1';

            // 淡出旧层
            if (fade) {
                Array.from(bgLayer.children).forEach(child => {
                    if (child !== newLayer) {
                        child.style.opacity = '0';
                        setTimeout(() => child.remove(), 800);
                    }
                });
            } else {
                // 立即移除旧的
                Array.from(bgLayer.children).forEach(child => {
                    if (child !== newLayer) child.remove();
                });
            }

            console.log(`[CinemaWorld] 背景已切换到: ${name}`);
        },

        // 清除背景
        clear() {
            const bgLayer = document.getElementById('cinemaworld-background');
            if (bgLayer) bgLayer.innerHTML = '';
            this.current = null;
        },

        // 预加载
        preload(name) {
            if (this.preloaded[name]) return;
            this.find(name).then(url => {
                if (url) {
                    const img = new Image();
                    img.src = url;
                    this.preloaded[name] = img;
                }
            });
        },
    };

    // ==================== 音乐管理器 ====================
    const MusicManager = {
        enabled: false,
        basePaths: [
            'scripts/extensions/third-party/CinemaWorld/music/',
            'music/',
            './music/',
        ],
        cache: {},
    
        // 场景音乐（底层）
        baseMusic: null,
        // ★ 改成按 scope 存储的 override 集合
        //   { "story": "剧情曲", "battle": "战斗曲" }
        overrideScopes: {},
        // 当前生效的 override 曲名（缓存，避免每次重算）
        _currentOverride: null,
    
        currentMusic: null,
        volume: 0.5,
        audio: null,
        ready: false,
    
        init() {
            if (!this.audio) {
                this.audio = new Audio();
                this.audio.loop = true;
                this.audio.volume = this.volume;
            }
            const unlock = () => {
                this.ready = true;
                if (this.enabled && this.currentMusic && this.audio.paused) {
                    this.audio.play().catch(() => {});
                }
                document.removeEventListener('click', unlock);
                document.removeEventListener('keydown', unlock);
            };
            document.addEventListener('click', unlock);
            document.addEventListener('keydown', unlock);
        },
    
        setEnabled(on) {
            this.enabled = !!on;
            if (this.enabled) {
                if (this.currentMusic) {
                    if (this.audio && this.audio.paused && this.ready) {
                        this.audio.play().catch(() => {});
                    }
                } else {
                    this._playEffective();
                }
            } else {
                if (this.audio) this.audio.pause();
            }
        },
    
        // ============ 路径查找 ============
        async find(name) {
            if (!name) return null;
            if (name in this.cache) return this.cache[name];
            const exts = ['mp3', 'ogg', 'wav', 'm4a'];
            for (const base of this.basePaths) {
                for (const ext of exts) {
                    const path = `${base}${name}.${ext}`;
                    if (await this.exists(path)) {
                        this.cache[name] = path;
                        return path;
                    }
                }
            }
            this.cache[name] = null;
            return null;
        },
    
        exists(url) {
            return new Promise(resolve => {
                fetch(url, { method: 'HEAD' })
                    .then(res => resolve(res.ok))
                    .catch(() => resolve(false));
            });
        },
    
        // ============ 场景音乐 ============
        async setSceneMusic(name) {
            this.baseMusic = name;
            // 场景音乐变了，重新算一次"有效曲目"
            await this._playEffective();
        },
    
        // ============ 作用域 override（新 API）============
        /**
         * 设置一个作用域的 override
         * @param {string} scope  作用域 ID，比如 'story'、'battle'、'interaction'
         * @param {string} name   曲名
         */
        async setScopedMusic(scope, name) {
            if (!scope) scope = 'default';
            if (name) {
                this.overrideScopes[scope] = name;
            } else {
                delete this.overrideScopes[scope];
            }
            await this._playEffective();
        },
    
        /**
         * 清除某个作用域的 override
         * @param {string} scope
         */
        async clearScopedMusic(scope) {
            if (!scope) scope = 'default';
            delete this.overrideScopes[scope];
            await this._playEffective();
        },
    
        /**
         * 清除所有 override（慎用，用来兜底）
         */
        async clearAllOverrides() {
            this.overrideScopes = {};
            await this._playEffective();
        },
    
        // ============ 向后兼容（旧的 API）============
        async setOverrideMusic(name) {
            // 旧 API 映射到 'default' scope
            return this.setScopedMusic('default', name);
        },
    
        async clearOverrideMusic() {
            return this.clearScopedMusic('default');
        },
    
        // ============ 核心：算出应该播什么 ============
        _getEffectiveMusic() {
            // 优先取最后一个 override（按插入顺序）
            const scopes = Object.keys(this.overrideScopes);
            if (scopes.length > 0) {
                const lastScope = scopes[scopes.length - 1];
                return this.overrideScopes[lastScope];
            }
            return this.baseMusic;
        },
    
        async _playEffective() {
            const target = this._getEffectiveMusic();
            this._currentOverride = target;
            if (target) {
                await this.play(target);
            } else {
                this.stop();
            }
        },
    
        // ============ 播放 ============
        async play(name) {
            if (!name) return this.stop();
    
            // 相同曲目正在播 → 跳过
            if (this.currentMusic === name && this.audio && !this.audio.paused) {
                return;
            }
    
            const url = await this.find(name);
            if (!url) {
                console.log(`[CinemaWorld] 未找到音乐: ${name}`);
                // ★ 找不到也要把 currentMusic 设成 name，避免反复重试
                this.currentMusic = name;
                return;
            }
    
            this.currentMusic = name;
            this.audio.src = url;
    
            if (!this.enabled) {
                console.log(`[CinemaWorld] 音乐已准备（插件未激活）: ${name}`);
                return;
            }
    
            if (this.ready) {
                try {
                    await this.audio.play();
                    console.log(`[CinemaWorld] 音乐已播放: ${name}`);
                } catch (e) {
                    console.log(`[CinemaWorld] 播放失败（等待用户交互）: ${name}`);
                }
            } else {
                console.log(`[CinemaWorld] 音乐已准备（等待用户交互）: ${name}`);
            }
        },
    
        stop() {
            if (this.audio) {
                this.audio.pause();
                this.audio.src = '';
            }
            this.currentMusic = null;
        },
    
        setVolume(v) {
            this.volume = Math.max(0, Math.min(1, v));
            if (this.audio) this.audio.volume = this.volume;
        },
    
        // ============ 音乐标记解析 ============
        parseMusicMarkers(text) {
            const markers = [];
            const regex = /🎵\s*音乐[:：]\s*(.+)/g;
            let m;
            while ((m = regex.exec(text)) !== null) {
                markers.push(m[1].trim());
            }
            return markers;
        },
    
        async applyMusicMarker(text) {
            const markers = this.parseMusicMarkers(text);
            if (markers.length > 0) {
                await this.setScopedMusic('default', markers[0]);
                return true;
            }
            return false;
        },
    };

    // ==================== 立绘管理器 ====================
    const SpriteManager = {
        cache: {},
        randomPoolCache: {},
        characterSpriteMap: {},
        _characterType: {},

        basePaths: [
            'scripts/extensions/third-party/CinemaWorld/images/立绘/',
            'images/立绘/',
            './images/立绘/',
        ],
        // ★ 玩家路径
        playerPaths: [
            'scripts/extensions/third-party/CinemaWorld/images/玩家/',
            'images/玩家/',
            './images/玩家/',
        ],

        extensions: ['png', 'webp', 'jpg', 'jpeg'],
        randomRange: { min: 1, max: 200 },
        missLimit: 3,

        // ★ 玩家立绘缓存
        playerSprite: undefined,  // undefined=未查, null=无, string=url
        playerAvatar: undefined,

        // SpriteManager 里
        _existsCache: {},        // { url: true | false }
        _existsPending: {},      // { url: Promise }
        // ★ 判定一个角色的立绘类型
        //   返回 'exact' | 'random' | 'none'
        async _detectCharacterType(name, gender) {
            if (this._characterType[name]) return this._characterType[name];

            const stdGender = this.normalizeGender(gender);

            // 1. 尝试查"默认状态"的专属立绘
            //    只在 base/性别/名字/ 或 base/名字/ 目录下探测，不看状态
            const hasExact = await this._hasExactSprite(name, stdGender);

            if (hasExact) {
                this._characterType[name] = 'exact';
                console.log(`[CinemaWorld] ${name} → 专属立绘`);
                return 'exact';
            }

            // 2. 专属没有 → 看是否已经分配了随机池图
            const saved = CinemaWorld.worldState.spriteAssignments?.[name];
            if (saved) {
                this._characterType[name] = 'random';
                console.log(`[CinemaWorld] ${name} → 随机池（已分配）`);
                return 'random';
            }

            // 3. 尝试分配随机池
            //    pickRandom 会走 buildRandomPool，如果池子非空就抽一张
            const picked = await this.pickRandom(gender);
            if (picked) {
                if (!CinemaWorld.worldState.spriteAssignments) {
                    CinemaWorld.worldState.spriteAssignments = {};
                }
                CinemaWorld.worldState.spriteAssignments[name] = picked;
                this._characterType[name] = 'random';
                console.log(`[CinemaWorld] ${name} → 随机池（新分配 ${picked}）`);
                return 'random';
            }

            // 4. 什么都没有
            this._characterType[name] = 'none';
            console.log(`[CinemaWorld] ${name} → 无立绘`);
            return 'none';
        },

        // ★ 只探测"角色目录本身"是否存在，不关心状态
        async _hasExactSprite(name, gender) {
            const folder = this.normalizeGender(gender);
            const dirs = [folder, '默认', ''];

            for (const base of this.basePaths) {
                for (const dir of dirs) {
                    for (const ext of this.extensions) {
                        const dirPart = dir ? `${dir}/` : '';
                        // 只测默认名字：base/{dir}/{name}.png
                        const path = `${base}${dirPart}${name}.${ext}`;
                        if (await this.exists(path)) return true;

                        // 或者 base/{dir}/{name}/默认.png
                        const path2 = `${base}${dirPart}${name}/默认.${ext}`;
                        if (await this.exists(path2)) return true;
                    }
                }
            }
            return false;
        },
        exists(url) {
            // 命中缓存
            if (url in this._existsCache) {
                return Promise.resolve(this._existsCache[url]);
            }
            // 正在探测
            if (url in this._existsPending) {
                return this._existsPending[url];
            }

            const p = new Promise(resolve => {
                const img = new Image();
                const timer = setTimeout(() => {
                    img.onload = img.onerror = null;
                    this._existsCache[url] = false;
                    delete this._existsPending[url];
                    resolve(false);
                }, 1500);
                img.onload = () => {
                    clearTimeout(timer);
                    this._existsCache[url] = true;
                    delete this._existsPending[url];
                    resolve(true);
                };
                img.onerror = () => {
                    clearTimeout(timer);
                    this._existsCache[url] = false;
                    delete this._existsPending[url];
                    resolve(false);
                };
                img.src = url;
            });

            this._existsPending[url] = p;
            return p;
        },
        normalizeGender(g) {
            if (!g) return '默认';
            const s = String(g).toLowerCase();
            if (s.includes('女') || s.includes('female') || s === 'f') return '女';
            if (s.includes('男') || s.includes('male') || s === 'm') return '男';
            return '默认';
        },

        // ============ 状态立绘：归一化 ============
        _normalizeState(state) {
            if (!state) return '默认';
            return String(state).trim() || '默认';
        },
        // ★ 通知某个角色的场景立绘刷新（数据层只调用，不管有没有立绘层）
        notifySceneSpriteUpdate(characterName, state = null) {
            if (!characterName) return;
            if (typeof window.SceneSpriteLayerManager === 'undefined') return;

            // 只在当前场景才刷
            const scene = window.LocationModalManager?.currentLocation;
            if (!scene) return;
            const char = scene.sceneCharacters?.find(c => c.name === characterName);
            if (!char) return;

            const finalState = state || this.pickSpriteState(char);
            window.SceneSpriteLayerManager.refreshSpriteFor(characterName, finalState)
                .catch(e => console.warn('[CinemaWorld] 刷新立绘失败:', e));
        },

        // ★ 通知所有角色（场景切换或全局状态变化后）
        notifyAllSceneSpritesUpdate() {
            if (typeof window.SceneSpriteLayerManager === 'undefined') return;
            const scene = window.LocationModalManager?.currentLocation;
            if (!scene) return;
            for (const char of (scene.sceneCharacters || [])) {
                const state = this.pickSpriteState(char);
                window.SceneSpriteLayerManager.refreshSpriteFor(char.name, state)
                    .catch(() => {});
            }
        },
        // ★ 决定"这一刻该用哪个状态"
        // 优先级：显式指定 > 战斗 > tags第一个 > mood > 默认
        pickSpriteState(character, context = {}) {
            if (!character) return '默认';

            // 1. 显式指定（脚本第 5 字段）
            if (context.explicitState) {
                const s = this._extractStateName(context.explicitState);
                if (s) return s;
            }

            // 2. 战斗上下文
            if (context.inBattle) return '战斗';

            // 3. mood（心情优先，最常用）
            const moodState = this._extractStateName(character.mood);
            if (moodState) return moodState;

            // 4. tags（异常状态兜底）
            const tags = character.tags || [];
            for (const t of tags) {
                const s = this._extractStateName(t);
                if (s && s !== '[object Object]' && !s.includes('[object')) {
                    return s;
                }
            }

            // 5. 兜底
            return '默认';
        },
        _extractStateName(v) {
            if (!v) return '';
            if (typeof v === 'string') {
                const s = v.trim();
                return (s === '[object Object]' || s.includes('[object')) ? '' : s;
            }

            if (typeof v === 'object') {
                for (const k of ['name', 'value', 'key', 'label', 'text']) {
                    if (v[k] !== undefined && v[k] !== null && v[k] !== '') {
                        const s = String(v[k]).trim();
                        if (s && s !== '[object Object]' && !s.includes('[object')) {
                            return s;
                        }
                    }
                }
                return '';
            }

            const s = String(v).trim();
            return (s === '[object Object]' || s.includes('[object')) ? '' : s;
        },
        // ★ 从任意文本里提取【可选状态列表】（供 prompt 用）
        extractSpriteStateList(text) {
            if (!text) return null;
            const m = String(text).match(/【可选状态列表】\s*[:：]?\s*\n?\s*\[([^\]]+)\]/);
            if (!m) return null;
            const list = m[1].split('|').map(s => s.trim()).filter(Boolean);
            return list.length ? list : null;
        },

        exists(url) {
            return new Promise(resolve => {
                const img = new Image();
                const timer = setTimeout(() => {
                    img.onload = img.onerror = null;
                    resolve(false);
                }, 1500);
                img.onload = () => { clearTimeout(timer); resolve(true); };
                img.onerror = () => { clearTimeout(timer); resolve(false); };
                img.src = url;
            });
        },

        // ============ 玩家立绘/头像 ============
        async findPlayerFile(filename) {
            for (const base of this.playerPaths) {
                for (const ext of this.extensions) {
                    const path = `${base}${filename}.${ext}`;
                    if (await this.exists(path)) return path;
                }
            }
            return null;
        },

        async getPlayerSprite() {
            if (this.playerSprite !== undefined) return this.playerSprite;
            this.playerSprite = await this.findPlayerFile('player');
            if (this.playerSprite) {
                console.log(`[CinemaWorld] 玩家立绘: ${this.playerSprite}`);
            }
            return this.playerSprite;
        },

        async getPlayerAvatar() {
            if (this.playerAvatar !== undefined) return this.playerAvatar;
            this.playerAvatar = await this.findPlayerFile('头像')
                             || await this.findPlayerFile('avatar');
            if (this.playerAvatar) {
                console.log(`[CinemaWorld] 玩家头像: ${this.playerAvatar}`);
            }
            return this.playerAvatar;
        },

        // ★ 玩家状态立绘：images/玩家/开心.png
        async getPlayerSpriteState(state = '默认') {
            const stdState = this._normalizeState(state);
            if (stdState === '默认') return this.getPlayerSprite();

            const cacheKey = `player_${stdState}`;
            if (cacheKey in this.cache) return this.cache[cacheKey];

            let url = null;
            for (const base of this.playerPaths) {
                for (const ext of this.extensions) {
                    const path = `${base}${stdState}.${ext}`;
                    if (await this.exists(path)) { url = path; break; }
                }
                if (url) break;
            }

            // fallback 到默认
            if (!url) url = await this.getPlayerSprite();

            this.cache[cacheKey] = url;
            return url;
        },

        async getAny(name, gender) {
            // 玩家角色名
            if (['玩家', '我', '主人公', 'player'].includes(name)) {
                return await this.getPlayerSprite();
            }
            return await this.get(name, gender);
        },

                // 精确匹配（支持状态子目录）
        // 查找顺序：
        //   base/性别/名字/状态.ext      ← 新结构
        //   base/性别/名字/默认.ext
        //   base/性别/名字.ext            ← 旧结构
        //   base/默认/名字/状态.ext
        //   base/默认/名字/默认.ext
        //   base/默认/名字.ext
        //   base/名字/状态.ext
        //   base/名字.ext
        async findExact(name, gender, state = '默认') {
            const folder = this.normalizeGender(gender);
            const dirs = [folder, '默认', ''];

            // 状态 fallback 链：指定 → 默认 → 无状态（旧结构）
            const states = (state && state !== '默认')
                ? [state, '默认', '']
                : ['默认', ''];

            for (const base of this.basePaths) {
                for (const dir of dirs) {
                    for (const st of states) {
                        for (const ext of this.extensions) {
                            const dirPart = dir ? `${dir}/` : '';
                            const path = st
                                ? `${base}${dirPart}${name}/${st}.${ext}`
                                : `${base}${dirPart}${name}.${ext}`;
                            if (await this.exists(path)) {
                                console.log(`[CinemaWorld] 立绘匹配: ${path}`);
                                return path;
                            }
                        }
                    }
                }
            }
            return null;
        },

        // ★ 构建随机池
        async buildRandomPool(gender) {
            const folder = this.normalizeGender(gender);

            // 缓存命中
            if (this.randomPoolCache[folder]) {
                return this.randomPoolCache[folder];
            }

            console.log(`[CinemaWorld] 开始扫描随机立绘池: ${folder}`);

            // ★ 先确定哪个 basePath 可用（测试第一个文件）
            let validBase = null;
            for (const base of this.basePaths) {
                const testPath = `${base}${folder}/1.png`;
                const ok = await this.exists(testPath);
                if (ok) {
                    validBase = base;
                    console.log(`[CinemaWorld] 找到可用 basePath: ${base}`);
                    break;
                }
            }

            if (!validBase) {
                console.log(`[CinemaWorld] 直接测试失败，尝试探测各 base`);
                for (const base of this.basePaths) {
                    for (let i = 1; i <= 5; i++) {
                        for (const ext of this.extensions) {
                            const path = `${base}${folder}/${i}.${ext}`;
                            if (await this.exists(path)) {
                                validBase = base;
                                console.log(`[CinemaWorld] 探测到可用 basePath: ${base}`);
                                break;
                            }
                        }
                        if (validBase) break;
                    }
                    if (validBase) break;
                }
            }

            if (!validBase) {
                console.log(`[CinemaWorld] 未找到可用的立绘目录 (${folder})`);
                this.randomPoolCache[folder] = [];
                return [];
            }

            // ★ 扫描池
            const pool = [];
            let misses = 0;
            const { min, max } = this.randomRange;

            for (let i = min; i <= max; i++) {
                let found = false;
                for (const ext of this.extensions) {
                    const path = `${validBase}${folder}/${i}.${ext}`;
                    if (await this.exists(path)) {
                        pool.push(path);
                        found = true;
                        break;
                    }
                }

                if (found) {
                    misses = 0;
                } else {
                    misses++;
                    if (misses >= this.missLimit) {
                        console.log(`[CinemaWorld] 连续${this.missLimit}次未命中，停止扫描`);
                        break;
                    }
                }
            }

            console.log(`[CinemaWorld] 随机立绘池扫描完成 (${folder}): ${pool.length}个`);
            this.randomPoolCache[folder] = pool;
            return pool;
        },

        async pickRandom(gender) {
            const pool = await this.buildRandomPool(gender);
            if (pool.length === 0) return null;

            // ★ 已分配的（全部，不分性别，避免男女人物撞到同一个文件）
            const assigned = new Set(
                Object.values(CinemaWorld.worldState.spriteAssignments || {})
            );

            // 过滤掉已分配的
            const available = pool.filter(p => !assigned.has(p));

            if (available.length === 0) {
                // 池子被抽干了，允许重复（或者干脆返回 null）
                console.warn(`[CinemaWorld] ${gender} 立绘池已耗尽，允许重复`);
                return pool[Math.floor(Math.random() * pool.length)];
            }

            const picked = available[Math.floor(Math.random() * available.length)];
            return picked;
        },

        async get(name, gender, state = '默认') {
            const stdState = this._normalizeState(state);
            const key = `${name}_${gender}_${stdState}`;
            if (key in this.cache) return this.cache[key];
        
            // 玩家特殊处理
            if (['玩家', '我', '主人公', 'player'].includes(name)) {
                const url = await this.getPlayerSpriteState(stdState);
                this.cache[key] = url;
                return url;
            }
        
            // ★ 判定角色类型（首次调用时探测一次，之后走缓存）
            const charType = await this._detectCharacterType(name, gender);
        
            // ★ 随机池角色：只有一张图，任何状态都返回它
            if (charType === 'random') {
                const url = CinemaWorld.worldState.spriteAssignments?.[name] || null;
                this.cache[key] = url;
                return url;
            }
        
            // ★ 无立绘
            if (charType === 'none') {
                this.cache[key] = null;
                return null;
            }
        
            // ★ 专属立绘：走原有的状态检索
            // 1. 精确匹配（带状态 fallback）
            let url = await this.findExact(name, gender, stdState);
        
            // 2. 非默认状态找不到 → 退回默认
            if (!url && stdState !== '默认') {
                url = await this.get(name, gender, '默认');
            }
        
            this.cache[key] = url;
            return url;
        },
        // ★ 同步查询（只读缓存，不打网络）
        getCachedSprite(name) {
            // 1. 映射表优先
            if (this.characterSpriteMap[name]) return this.characterSpriteMap[name];

            // 2. cache 里精确匹配（key 是 name_gender 格式）
            const prefix = name + '_';
            for (const key in this.cache) {
                if (key === name || key.startsWith(prefix)) {
                    return this.cache[key];
                }
            }
            return null;
        },

        // ★ 同步查询某个状态下的立绘（只读缓存，不打网络）
        getCachedSpriteWithState(name, state = '默认') {
            const stdState = this._normalizeState(state);
            const prefix = `${name}_`;
        
            // ★ 随机池角色：任何状态都用默认那张
            if (this._characterType[name] === 'random') {
                return CinemaWorld.worldState.spriteAssignments?.[name]
                    || this.characterSpriteMap[name]
                    || null;
            }
        
            // 1. 精确 key
            for (const key in this.cache) {
                if (key.startsWith(prefix) && key.endsWith(`_${stdState}`)) {
                    return this.cache[key];
                }
            }
        
            // 2. 默认状态兜底
            if (stdState !== '默认') {
                for (const key in this.cache) {
                    if (key.startsWith(prefix) && key.endsWith('_默认')) {
                        return this.cache[key];
                    }
                }
            }
        
            // 3. 旧映射表兜底
            return this.characterSpriteMap[name] || null;
        },

        // ★ 异步确保带状态的立绘已加载
        async ensureSpriteWithState(name, gender, state = '默认') {
            const stdState = this._normalizeState(state);
            const url = await this.get(name, gender, stdState);
        
            if (stdState === '默认' && url) {
                this.characterSpriteMap[name] = url;
            }
            return url;
        },

        // ★ 异步获取并写入映射（用于预热）
        async ensureSprite(name, gender) {
            if (this.characterSpriteMap[name]) return this.characterSpriteMap[name];
            const url = await this.get(name, gender);   // state 默认
            this.characterSpriteMap[name] = url;
            return url;
        },

        // ★ 批量预热（进入通讯录时调用）
        async preloadAll(characters) {
            for (const ch of characters) {
                if (!this.characterSpriteMap[ch.name]) {
                    await this.ensureSprite(ch.name, ch.gender);
                }
            }
        },

        async buildMapping(characters) {
            for (const ch of characters) {
                // 1. 默认状态必预热
                if (!this.characterSpriteMap[ch.name]) {
                    const url = await this.get(ch.name, ch.gender, '默认');
                    if (url) this.characterSpriteMap[ch.name] = url;
                }
        
                // ★ 2. 只有专属立绘才预热状态
                const charType = this._characterType[ch.name];
                if (charType === 'exact') {
                    const priority = this.pickSpriteState(ch);
                    if (priority !== '默认') {
                        await this.get(ch.name, ch.gender, priority);
                    }
                }
            }
            console.log('[CinemaWorld] 立绘映射已更新:', this.characterSpriteMap);
        },

        getFromMapping(name) {
            return this.characterSpriteMap[name] || null;
        },

        // ★ 手动探测工具（用于调试）
        async diagnose(gender = '男') {
            const folder = this.normalizeGender(gender);
            console.log(`=== 诊断立绘文件夹: ${folder} ===`);
            for (const base of this.basePaths) {
                console.log(`测试 basePath: ${base}`);
                for (let i = 1; i <= 5; i++) {
                    for (const ext of this.extensions) {
                        const path = `${base}${folder}/${i}.${ext}`;
                        const ok = await this.exists(path);
                        if (ok) {
                            console.log(`  ✅ 命中: ${path}`);
                            return path;
                        }
                    }
                }
                console.log(`  ❌ 未命中任何文件`);
            }
            return null;
        },
    };

    // ==================== 挂载到 window ====================
    window.WorldManager = WorldManager;
    window.BackgroundManager = BackgroundManager;
    window.MusicManager = MusicManager;
    window.SpriteManager = SpriteManager;

    console.log('[CinemaWorld] world.js 已加载');
})();