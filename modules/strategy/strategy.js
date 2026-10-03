// ============================================================
// CinemaWorld · strategy.js
// 战略层：势力 / 地区 / 战略行动 / 回合推进 / 战略规则 / 内政
// 依赖：core.js, world.js, player.js, story.js, interact.js
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const WorldManager = window.WorldManager;
    const PlayerStateManager = window.PlayerStateManager;
    const StoryManager = window.StoryManager;
    const EffectSystem = window.EffectSystem;
    const VisualNovelManager = window.VisualNovelManager;
    const MusicManager = window.MusicManager;
    // ==================== 数字归一化工具 ====================
    const CN_NUM = {
        '零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
        '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
        '百': 100, '千': 1000, '万': 10000, '亿': 100000000,
    };

    // 中文数字段 → 数字
    function cnToNumber(s) {
        if (!s) return NaN;
        // 纯中文数字（含十百千万亿）
        if (/^[零一二两三四五六七八九十百千万亿]+$/.test(s)) {
            let total = 0, section = 0, num = 0;
            for (const ch of s) {
                if (ch === '亿') {
                    section = (section + num) * 100000000;
                    total += section; section = 0; num = 0;
                } else if (ch === '万') {
                    section = (section + num) * 10000;
                    total += section; section = 0; num = 0;
                } else if (ch === '千') { section += (num || 1) * 1000; num = 0; }
                else if (ch === '百') { section += (num || 1) * 100; num = 0; }
                else if (ch === '十') { section += (num || 1) * 10; num = 0; }
                else { num = CN_NUM[ch] ?? 0; }
            }
            return total + section + num;
        }
        return NaN;
    }

    // 归一化：'5万' → 50000, '五万' → 50000, '3.2万' → 32000
    // 返回 { num: number, unit: string } —— unit 是"担/石/人"这类非量词后缀
    function normalizeNumber(str) {
        const raw = String(str).trim();

        // ① 尝试 "数字+量词" 形式：5万 / 3.2万 / 五万 / 1.2亿
        let m = raw.match(/^([\d.]+)\s*(亿|千万|百万|万|千|百)?(.*)$/);
        if (m && m[1]) {
            const n = parseFloat(m[1]);
            const mult = { '亿': 1e8, '千万': 1e7, '百万': 1e6, '万': 1e4, '千': 1e3, '百': 1e2 }[m[2]] || 1;
            return { num: n * mult, unit: (m[3] || '').trim() };
        }

        // ② 纯中文数字：五万 / 三千 / 十二万
        m = raw.match(/^([零一二两三四五六七八九十百千万亿]+)(.*)$/);
        if (m) {
            const n = cnToNumber(m[1]);
            if (!isNaN(n)) return { num: n, unit: (m[2] || '').trim() };
        }

        // ③ 纯数字 + 单位：50000担
        m = raw.match(/^(-?[\d.]+)\s*(.*)$/);
        if (m) return { num: parseFloat(m[1]), unit: (m[2] || '').trim() };

        // ④ 无法解析
        return { num: NaN, unit: raw };
    }
    // ==================== 战略数据管理器 ====================
    const StrategyManager = {
        _generating: false,
        normalizeNumber(str) { return normalizeNumber(str); },
        cnToNumber(s) { return cnToNumber(s); },
        // ---------- 存储 ----------
        ensureStore() {
            if (!CinemaWorld.worldState.strategy) {
                CinemaWorld.worldState.strategy = {
                    factions: {},
                    regions: {},
                    actions: [],
                    rules: { raw: '', parsed: null },
                    turnCount: 0,
                    turnLog: [],
                    initialized: false,
                    contextEnabled: true,
                    autoTurnOnStory: true,
                    politics: null,
                };
            }
            const s = CinemaWorld.worldState.strategy;
            if (!s.factions) s.factions = {};
            if (!s.regions) s.regions = {};
            if (!s.actions) s.actions = [];
            if (!s.rules) s.rules = { raw: '', parsed: null };
            if (typeof s.turnCount !== 'number') s.turnCount = 0;
            if (!Array.isArray(s.turnLog)) s.turnLog = [];
            if (typeof s.contextEnabled !== 'boolean') s.contextEnabled = true;
            if (typeof s.autoTurnOnStory !== 'boolean') s.autoTurnOnStory = true;
            if (!s.politics) s.politics = null;

            // 迁移：旧存档势力补齐 leader/delegation
            for (const f of Object.values(s.factions)) {
                if (f.leader === undefined) f.leader = null;
                if (!Array.isArray(f.delegation)) f.delegation = [];
            }

            return s;
        },

        // ---------- 查询 ----------
        getPlayerFaction() {
            const s = this.ensureStore();
            return Object.values(s.factions).find(f => f.isPlayer) || null;
        },
        getOtherFactions() {
            const s = this.ensureStore();
            return Object.values(s.factions).filter(f => !f.isPlayer);
        },
        getAllFactions() {
            return Object.values(this.ensureStore().factions);
        },
        getRegions() {
            return Object.values(this.ensureStore().regions);
        },
        getAction(id) {
            return this.ensureStore().actions.find(a => a.id === id) || null;
        },
        getAvailableActions() {
            return this.ensureStore().actions.filter(a => a.status === 'available');
        },
        isInitialized() {
            return this.ensureStore().initialized;
        },

        // ---------- 修改势力/地区数据 ----------
        changeFactionField(factionId, key, op, value) {
            const s = this.ensureStore();
            const f = s.factions[factionId];
            if (!f) return null;
            return this._changeField(f.fields, key, op, value);
        },
        changeRegionField(regionId, key, op, value) {
            const s = this.ensureStore();
            const r = s.regions[regionId];
            if (!r) return null;
            return this._changeField(r.fields, key, op, value);
        },
        _changeField(fields, key, op, value) {
            if (!fields) return null;
            if (!fields._order) fields._order = [];
        
            const parsed = normalizeNumber(value);
            if (isNaN(parsed.num)) return null;   // 解析不了就别改
        
            if (fields[key] === undefined) {
                fields._order.push(key);
                fields[key] = `${parsed.num}${parsed.unit}`;
                return { key, before: null, after: fields[key], isNew: true };
            }
        
            const raw = String(fields[key]);
            const before = raw;
        
            // 条形值：70/100
            const barMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)([\s\S]*)$/);
            if (barMatch) {
                let cur = parseFloat(barMatch[1]);
                const max = parseFloat(barMatch[2]);
                const tail = barMatch[3] || '';
                const n = parsed.num;
                if (op === 'add') cur += n;
                else if (op === 'subtract') cur -= n;
                else if (op === 'set') cur = n;
                cur = Math.max(0, Math.min(max, cur));
                fields[key] = `${cur}/${max}${tail}`;
                return { key, before, after: fields[key], beforeNum: parseFloat(barMatch[1]), afterNum: cur };
            }
        
            // 普通数值：50000担
            const numMatch = raw.match(/^(-?\d+(?:\.\d+)?)([\s\S]*)$/);
            if (numMatch) {
                let cur = parseFloat(numMatch[1]);
                const unit = numMatch[2] || '';
                const n = parsed.num;
                if (op === 'add') cur += n;
                else if (op === 'subtract') cur -= n;
                else if (op === 'set') cur = n;
                cur = Math.max(0, cur);
                fields[key] = `${cur}${unit}`;
                return { key, before, after: fields[key], beforeNum: parseFloat(numMatch[1]), afterNum: cur };
            }
        
            if (op === 'set') {
                fields[key] = `${parsed.num}${parsed.unit}`;
                return { key, before, after: fields[key] };
            }
            return null;
        },

        // ---------- 关系 ----------
        changeRelation(fromFactionId, toFactionName, delta) {
            const s = this.ensureStore();
            const f = s.factions[fromFactionId];
            if (!f) return null;
            if (!f.relations) f.relations = {};
            if (!f.relations[toFactionName]) {
                f.relations[toFactionName] = { value: 0, status: '中立' };
            }
            const r = f.relations[toFactionName];
            r.value = Math.max(-100, Math.min(100, (r.value || 0) + delta));
            r.status = this._relationStatus(r.value);

            const target = Object.values(s.factions).find(x => x.name === toFactionName);
            if (target) {
                if (!target.relations) target.relations = {};
                const myName = f.name;
                if (!target.relations[myName]) {
                    target.relations[myName] = { value: 0, status: '中立' };
                }
                target.relations[myName].value = r.value;
                target.relations[myName].status = r.status;
            }
            return r;
        },
        _relationStatus(v) {
            if (v >= 70) return '盟友';
            if (v >= 30) return '友好';
            if (v >= -30) return '中立';
            if (v >= -70) return '敌对';
            return '死敌';
        },

        // ============================================================
        // 通用：按缩进切块
        // ============================================================
        _splitBlocks(text, prefixRe) {
            const blocks = [];
            let cur = null;
            for (const raw of text.split('\n')) {
                const line = raw.replace(/\s+$/, '');
                if (!line.trim()) continue;
                const indent = line.match(/^\s*/)[0].length;
                if (indent === 0 && prefixRe.test(line.trim())) {
                    if (cur !== null) blocks.push(cur);
                    cur = line.trim();
                    continue;
                }
                if (cur !== null) cur += '\n' + line;
            }
            if (cur !== null) blocks.push(cur);
            return blocks;
        },

        // ============================================================
        // 通用：解析 "【键:值|键:值】：描述"
        // ============================================================
        _parseStructLine(line) {
            if (!line) return null;
            let clean = line.trim().replace(/^[-•]\s*/, '');
            const m = clean.match(/^[\[【]([^\]】]+)[\]】]\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;
            const fields = { _order: [] };
            this._parseFieldString(m[1], fields);
            return { fields, description: m[2].trim() };
        },
        _parseStructLines(text) {
            const out = [];
            if (!text) return out;
            for (const raw of text.split('\n')) {
                const line = raw.trim();
                if (!line) continue;
                if (!/^[-•]?\s*[\[【]/.test(line)) continue;
                const parsed = this._parseStructLine(line);
                if (parsed) out.push(parsed);
            }
            return out;
        },

        // ============================================================
        // 生成：世界（势力 + 地区 + 规则）
        // ============================================================
        async generateWorld(context = '') {
            if (this._generating) return null;
            this._generating = true;
            try {
                
            const worldCtx = StoryManager.buildContext(null, {
                parentStory: false, mainChars: true, scene: false,
                pendingEvents: false, interactionDigests: false,
                world:              true,
                worldHistory:       true,
                volumes:            true,
                chapters:           true,
                chapter:            true,
            });
                const scene = window.LocationModalManager?.currentLocation;

                let prompt = `你正在为一个视觉小说游戏生成"战略层"数据。
这一层独立于具体剧情，描述的是势力、地区、和它们的运作规则。

【世界上下文】
${worldCtx}

${scene ? `【当前场景】\n${scene.name}${scene.description ? '：' + scene.description : ''}` : ''}

${context ? `【玩家要求】\n${context}\n` : ''}

【任务】
根据世界背景，生成：
1. 我方势力（玩家所属）
2. 2-4 个其他势力
3. 2-4 个地区
4. 战略规则（数据字段定义 + 更新规则）

【输出格式】（严格遵守）

【我方势力】
名字: (势力名)
图标: (一个 emoji)
描述: (一段话)
数据:【键:值|键:值】

领袖:
- 【名字:XXX|性别:X|头衔:XXX|忠诚:XX|野心:XX|威望:XX|能力:XX】：领袖描述

代表团:
- 【名字:XXX|性别:X|头衔:XXX|忠诚:XX|能力:XX|立场:主战】：成员描述
- 【名字:XXX|性别:X|头衔:XXX|忠诚:XX|能力:XX|立场:主和】：成员描述

【其他势力】
- 【势力名|图标】：描述，数据:【键:值|键:值】
  领袖:
  - 【名字:XXX|性别:X|头衔:XXX|忠诚:XX|野心:XX|威望:XX|能力:XX】：领袖描述
  代表团:
  - 【名字:XXX|性别:X|头衔:XXX|忠诚:XX|能力:XX|立场:主战】：成员描述
- 【势力名2|图标】：描述，数据:【键:值】

【地区】
- 【地区名|图标|键:值|键:值】：描述，数据:【键:值|键:值】
  势力分布:
  - 【势力名|键:值|键:值】
  - 【势力名|键:值|键:值】
- 【地区名2|图标】：描述，数据:【键:值|键:值】
  势力分布:
  - 【势力名|键:值】

【战略规则】
势力数据字段: (列出我方势力的数据键，用、分隔，人口、兵力这类基本数据要包含在内。)
地区数据字段: (列出地区的数据键，用、分隔)
可行动类型: (如 外交、军事、内政、谍报、经济)
更新规则:
  - (字段名): 什么情况 +N，什么情况 -N
回合规则:
  - 一段主线剧情 = 1 回合
  - 每回合我方势力自然变化：粮草 -兵力/100，民心 -1
  - 其他势力每回合各执行 1 个行动

【格式硬性要求】
1. 所有结构化数据必须放在 【 】 里，用 | 分隔，用 : 分隔键值。
2. 领袖和代表团成员必须用 "- 【名字:...|...】：描述" 的格式。
3. 势力分布必须逐行，每行一个势力，格式 "- 【势力名|键:值|键:值】"。
4. 地区名和图标必须放在同一行开头的 【地区名|图标】 里。
5. 描述里不要出现 | 和 【 】，避免解析歧义。

【示例】（科幻世界观）
【我方势力】
名字: 新曙光议会
图标: 🚀
描述: 由幸存者建立的议会制政权，控制着三个殖民站，正面临资源枯竭的危机。
数据:【舰队:12|燃料:45000/60000|民心:72/100|威望:58|控制区:3|科技:45/100】

领袖:
- 【名字:林远|性别:男|头衔:议长|忠诚:90|野心:20|威望:75|能力:80】：冷静务实的老兵。

代表团:
- 【名字:苏离|性别:女|头衔:军事主管|忠诚:85|能力:88|立场:主战】：主张对赤铁军团先发制人。
- 【名字:陈默|性别:男|头衔:外交官|忠诚:78|能力:82|立场:主和】：主张与虚空商会谈判。

【其他势力】
- 【赤铁军团|⚔️】：残暴的军事独裁者，数据:【舰队:20|燃料:80000/80000|民心:40/100|威望:70】
  领袖:
  - 【名字:铁牙|性别:男|头衔:军团统帅|忠诚:100|野心:95|威望:90|能力:85】：铁腕统治者。
  代表团:
  - 【名字:骨锤|性别:男|头衔:作战参谋|忠诚:88|能力:70|立场:主战】：狂热的扩张派。
- 【虚空商会|💰】：中立的星际贸易组织，数据:【财富:999999|舰队:5|民心:0/100】

【地区】
- 【三号殖民站|🏙️|人口:85000|产出:1200/月】：最大的农业殖民站，数据:【民心:68/100|守军:2000】
  势力分布:
  - 【新曙光议会|控制:85|守军:2000】
  - 【赤铁军团|渗透:5】
- 【旧地球轨道|🌍|人口:12000|产出:0】：废弃的母星轨道，数据:【民心:30/100|守军:15000】
  势力分布:
  - 【赤铁军团|控制:95|舰队:18】

【战略规则】
势力数据字段: 舰队、燃料、民心、威望、控制区、科技
地区数据字段: 人口、产出、民心、守军
可行动类型: 外交、军事、内政、谍报、经济
更新规则:
  - 舰队: 军事行动消耗 1~5，造船 +1~+3
  - 燃料: 每回合自然 -200，每次军事行动 -1000~-5000
  - 民心: 惠民 +5，苛政 -10，战争 -3/回合
  - 威望: 胜利 +10，失败 -15，外交成功 +5
  - 科技: 科研 +1/回合
回合规则:
  - 一段主线剧情 = 1 回合
  - 每回合我方势力自然变化：燃料 -200，科技 +1
  - 其他势力每回合各执行 1 个行动

请开始生成：
`;

                const result = await window.generateFunctionalReply(prompt, 'strategy-world');
                if (!result) return null;
                return this._parseWorld(result);
            } finally {
                this._generating = false;
            }
        },

        _buildWorldContext() {
            const parts = [];
            const wh = CinemaWorld.worldState.worldHistory;
            if (wh?.summary) parts.push(`【世界史】${wh.summary}`);

            const player = PlayerStateManager.player;
            if (player.name) parts.push(`【玩家】${player.name}`);
            if (player.profile) parts.push(`【玩家设定】${player.profile}`);

            const mains = window.CharacterRegistry?.getMainCharacters?.() || [];
            if (mains.length > 0) {
                parts.push(`【主要角色】\n${mains.map(c => `- ${c.name}：${c.description || ''}`).join('\n')}`);
            }

            if (CinemaWorld.worldState.entities?.length > 0) {
                const locs = CinemaWorld.worldState.entities
                    .filter(e => e.type === 'location')
                    .slice(0, 5)
                    .map(e => `- ${e.name}`);
                if (locs.length > 0) parts.push(`【已有场景】\n${locs.join('\n')}`);
            }

            return parts.join('\n\n') || '（这是一个全新的世界）';
        },

        // ============================================================
        // 解析世界
        // ============================================================
        _parseWorld(text) {
            const store = this.ensureStore();
            store.factions = {};
            store.regions = {};
            store.actions = [];

            // 我方势力
            const playerMatch = text.match(/【我方势力】([\s\S]*?)(?=【其他势力】|【地区】|【战略规则】|$)/);
            if (playerMatch) {
                const f = this._parsePlayerFaction(playerMatch[1]);
                if (f) store.factions[f.id] = f;
            }

            // 其他势力
            const othersMatch = text.match(/【其他势力】([\s\S]*?)(?=【地区】|【战略规则】|$)/);
            if (othersMatch) {
                const blocks = this._splitBlocks(othersMatch[1], /^-\s*【/);
                for (const block of blocks) {
                    const f = this._parseOtherFaction(block);
                    if (f) store.factions[f.id] = f;
                }
            }

            // 地区
            const regionsMatch = text.match(/【地区】([\s\S]*?)(?=【战略规则】|$)/);
            if (regionsMatch) {
                const blocks = this._splitBlocks(regionsMatch[1], /^-\s*【/);
                for (const block of blocks) {
                    const r = this._parseRegion(block);
                    if (r) store.regions[r.id] = r;
                }
            }

            // 规则
            const rulesMatch = text.match(/【战略规则】([\s\S]*?)$/);
            if (rulesMatch) {
                store.rules.raw = '【战略规则】' + rulesMatch[1];
                store.rules.parsed = this._parseRules(rulesMatch[1]);
            }

            this._initRelations();
            store.initialized = true;
            store.turnCount = 0;

            if (window.SaveManager) window.SaveManager.save();
            console.log('[Strategy] 世界已生成:', {
                factions: Object.keys(store.factions).length,
                regions: Object.keys(store.regions).length,
            });
            return store;
        },

        _parsePlayerFaction(text) {
            const f = {
                id: `faction_${Date.now()}_player`,
                name: '',
                icon: '👑',
                isPlayer: true,
                description: '',
                fields: { _order: [] },
                leader: null,
                delegation: [],
                relations: {},
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const nameM = text.match(/名字[:：]\s*(.+)/);
            if (nameM) f.name = nameM[1].trim();
            const iconM = text.match(/图标[:：]\s*(.+)/);
            if (iconM) {
                const e = WorldManager._extractEmoji(iconM[1]);
                if (e) f.icon = e;
            }
            const descM = text.match(/描述[:：]\s*([^\n]+)/);
            if (descM) f.description = descM[1].trim();
            const dataM = text.match(/数据[:：]\s*[\[【]([^\]】]+)[\]】]/);
            if (dataM) this._parseFieldString(dataM[1], f.fields);

            const leaderBlockM = text.match(/领袖[:：]\s*\n?([\s\S]*?)(?=\n\s*代表团[:：]|\n\s*数据[:：]|$)/);
            if (leaderBlockM) f.leader = this._parseLeader(leaderBlockM[1]);

            const delegationBlockM = text.match(/代表团[:：]\s*\n?([\s\S]*?)(?=\n\s*数据[:：]|\n\s*领袖[:：]|$)/);
            if (delegationBlockM) f.delegation = this._parseDelegation(delegationBlockM[1]);

            if (!f.name) return null;
            return f;
        },

        _parseOtherFaction(text) {
            let clean = text.trim().replace(/^[-•]\s*/, '');
            const lines = clean.split('\n');
            const firstLine = lines[0].trim();
            const restText = lines.slice(1).join('\n');

            const f = {
                id: `faction_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: '',
                icon: '🏰',
                isPlayer: false,
                description: '',
                fields: { _order: [] },
                leader: null,
                delegation: [],
                relations: {},
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const nameM = firstLine.match(/^【(.+?)】/);
            if (!nameM) return null;
            const nameParts = nameM[1].split('|').map(s => s.trim());
            f.name = nameParts[0] || '';
            if (nameParts[1]) {
                const e = WorldManager._extractEmoji(nameParts[1]);
                if (e) f.icon = e;
            }

            const afterName = firstLine.substring(nameM[0].length).replace(/^[：:]\s*/, '');
            const dataM = afterName.match(/数据[:：]\s*[\[【]([^\]】]+)[\]】]/);
            if (dataM) this._parseFieldString(dataM[1], f.fields);

            let desc = afterName;
            if (dataM) desc = desc.substring(0, dataM.index);
            f.description = desc.replace(/[，,]\s*$/, '').trim();

            const leaderBlockM = restText.match(/领袖[:：]\s*\n?([\s\S]*?)(?=\n\s*代表团[:：]|$)/);
            if (leaderBlockM) f.leader = this._parseLeader(leaderBlockM[1]);

            const delegationBlockM = restText.match(/代表团[:：]\s*\n?([\s\S]*?)$/);
            if (delegationBlockM) f.delegation = this._parseDelegation(delegationBlockM[1]);

            if (!f.name) return null;
            return f;
        },

        _parseLeader(text) {
            if (!text) return null;
            const items = this._parseStructLines(text);
            if (items.length === 0) return null;
            const parsed = items[0];
            const f = parsed.fields;

            const leader = {
                name: f['名字'] || '',
                gender: f['性别'] || '',
                title: f['头衔'] || '',
                description: parsed.description,
                fields: { _order: [] },
            };
            for (const k of f._order) {
                if (k === '名字' || k === '性别' || k === '头衔') continue;
                leader.fields[k] = f[k];
                leader.fields._order.push(k);
            }
            return leader.name ? leader : null;
        },

        _parseDelegation(text) {
            const out = [];
            if (!text) return out;
            const items = this._parseStructLines(text);
            for (const parsed of items) {
                const f = parsed.fields;
                const member = {
                    name: f['名字'] || '',
                    gender: f['性别'] || '',
                    title: f['头衔'] || '',
                    description: parsed.description,
                    fields: { _order: [] },
                    stance: '中立',
                };
                for (const k of f._order) {
                    if (k === '名字' || k === '性别' || k === '头衔') continue;
                    member.fields[k] = f[k];
                    member.fields._order.push(k);
                }
                if (member.fields['立场']) member.stance = member.fields['立场'];
                if (member.name) out.push(member);
            }
            return out;
        },

        _parseRegion(text) {
            const r = {
                id: `region_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: '',
                icon: '🏔️',
                description: '',
                fields: { _order: [] },
                factionPresence: {},
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            const firstLine = text.split('\n')[0].trim();
            const nameM = firstLine.match(/^[-•]?\s*【(.+?)】/);
            if (!nameM) return null;

            const parts = nameM[1].split('|').map(s => s.trim());
            r.name = parts[0] || '';
            if (parts[1]) {
                const e = WorldManager._extractEmoji(parts[1]);
                if (e) r.icon = e;
            }

            for (let i = 1; i < parts.length; i++) {
                const p = parts[i];
                if (!p) continue;
                if (i === 1 && WorldManager._extractEmoji(p)) continue;
                const kv = p.match(/^(.+?)[:：]\s*(.+)$/);
                if (kv) {
                    const k = kv[1].trim();
                    r.fields[k] = kv[2].trim();
                    r.fields._order.push(k);
                }
            }

            const afterName = firstLine.substring(nameM[0].length).replace(/^[：:]\s*/, '');
            const dataM = afterName.match(/数据[:：]\s*[\[【]([^\]】]+)[\]】]/);
            if (dataM) this._parseFieldString(dataM[1], r.fields);

            let desc = afterName;
            if (dataM) desc = desc.substring(0, dataM.index);
            r.description = desc.replace(/[，,]\s*$/, '').trim();

            // 势力分布
            const presStart = text.indexOf('势力分布');
            if (presStart !== -1) {
                const presText = text.substring(presStart);
                for (const raw of presText.split('\n')) {
                    const line = raw.trim();
                    if (!/^[-•]\s*【/.test(line)) continue;
                    this._parsePresenceLine(line, r.factionPresence);
                }
            }

            if (!r.name) return null;
            return r;
        },

        _parsePresenceLine(line, target) {
            const m = line.trim().match(/^[-•]?\s*[\[【]([^\]】]+)[\]】]/);
            if (!m) return;
            const parts = m[1].split('|').map(s => s.trim());
            const name = parts[0] || '';
            if (!name) return;

            const fields = { _order: [] };
            for (let i = 1; i < parts.length; i++) {
                const p = parts[i];
                if (!p) continue;
                const kv = p.match(/^(.+?)[:：]\s*(.+)$/);
                if (kv) {
                    const k = kv[1].trim();
                    fields[k] = kv[2].trim();
                    fields._order.push(k);
                }
            }
            target[name] = fields;
        },

        _parseFieldString(str, target) {
            const parts = str.split('|').map(s => s.trim()).filter(Boolean);
            for (const p of parts) {
                const kv = p.match(/^(.+?)[:：]\s*(.+)$/);
                if (!kv) continue;
                const k = kv[1].trim();
                const v = kv[2].trim();
        
                // 归一化：如果是 "70/100" 这种条形值，分别处理两段
                const barM = v.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)(.*)$/);
                if (barM) {
                    const left = normalizeNumber(barM[1]);
                    const right = normalizeNumber(barM[2]);
                    target[k] = `${left.num}/${right.num}${barM[3] || ''}`;
                } else {
                    const n = normalizeNumber(v);
                    target[k] = isNaN(n.num) ? v : `${n.num}${n.unit}`;
                }
                target._order.push(k);
            }
        },
        
        _parseRules(text) {
            const rules = {
                factionFields: [],
                regionFields: [],
                actionTypes: [],
                updateRules: [],
                turnRules: [],
            };
            const factionM = text.match(/势力数据字段[:：]\s*(.+)/);
            if (factionM) rules.factionFields = factionM[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
            const regionM = text.match(/地区数据字段[:：]\s*(.+)/);
            if (regionM) rules.regionFields = regionM[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
            const actionM = text.match(/可行动类型[:：]\s*(.+)/);
            if (actionM) rules.actionTypes = actionM[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);

            const updateSection = text.match(/更新规则[:：]?\s*([\s\S]*?)(?=回合规则|$)/);
            if (updateSection) {
                for (const raw of updateSection[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const body = line.substring(1).trim();
                    const m = body.match(/^(.+?)[:：]\s*(.+)$/);
                    if (m) rules.updateRules.push({ field: m[1].trim(), text: m[2].trim() });
                }
            }
            const turnSection = text.match(/回合规则[:：]?\s*([\s\S]*?)$/);
            if (turnSection) {
                for (const raw of turnSection[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    rules.turnRules.push({ text: line.substring(1).trim() });
                }
            }
            return rules;
        },

        _initRelations() {
            const store = this.ensureStore();
            const all = Object.values(store.factions);
            for (const f of all) {
                if (!f.relations) f.relations = {};
                for (const other of all) {
                    if (other.id === f.id) continue;
                    if (!f.relations[other.name]) {
                        f.relations[other.name] = { value: 0, status: '中立' };
                    }
                }
            }
        },

        // ============================================================
        // 生成：我方势力行动
        // ============================================================
        async generateActions(context = '') {
            if (this._generating) return null;
            const store = this.ensureStore();
            const playerFaction = this.getPlayerFaction();
            if (!playerFaction) return null;

            this._generating = true;
            try {
                const factionText = this._formatFactionFields(playerFaction);
                const othersText = this.getOtherFactions()
                    .map(f => `- ${f.icon} ${f.name}：${this._formatFactionFields(f)}`)
                    .join('\n');
                const regionsText = this.getRegions()
                    .map(r => `- ${r.icon} ${r.name}：${this._formatRegionFields(r)}`)
                    .join('\n');
                const rulesText = store.rules.raw || '（无规则）';
                const playerBlock = PlayerStateManager.formatForPrompt();

                const prompt = `你正在为一个视觉小说游戏生成"战略行动"。
玩家可以执行这些行动，来改变势力数据、地区数据、以及与其他势力的关系。

【我方势力】
${playerFaction.icon} ${playerFaction.name}
${factionText}

【其他势力】
${othersText || '（无）'}

【地区】
${regionsText || '（无）'}

【战略规则】
${rulesText}

${playerBlock}

${context ? `【玩家指定方向】（必须遵守）\n${context}\n` : ''}

【任务】
根据当前局势，生成 3-6 个我方可以执行的战略行动。
每个行动必须包含：行动本体 + 效果 + 剧情脚本。

【输出格式】（严格遵守，每个行动是一个独立块）

- 【行动名|图标】：描述，[类型:军事|目标:北境|消耗:兵力-2000,粮草-3000]
  【效果】
  目标: 我方势力
  数值变化: 兵力 -2000，威望 +5
  势力数据:
  - 北境: 驻军 -500，民心 -5
  实体变化:
  - 获得【北境控制权|🏔️】：[类型:地区控制|状态:已占领]

  【剧情】
  【旁白】: 大军开拔，旌旗蔽日……
  【我方将领|显示|中|男|振奋】: 出发！
  【旁白】: 三天后，北境的城墙出现在视野里。

  【摘要】
  （1-2 句话总结这个行动的结果）

【规则】
1. 行动必须符合我方势力的当前状态
2. 效果可以是：数值变化、势力数据、地区数据、关系变化、实体变化
3. 数值变化的目标可以是"我方势力"或"玩家"
4. 关系变化格式：关系变化: 南方商会 +10
5. 剧情 5-10 行
6. 每个行动的效果必须由【战略规则】支撑
7. 消耗写清楚

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'strategy-actions');
                if (!result) return null;
                const actions = this._parseActions(result);
                store.actions = actions;
                if (window.SaveManager) window.SaveManager.save();
                return actions;
            } finally {
                this._generating = false;
            }
        },

        _formatFactionFields(f) {
            if (!f.fields || !f.fields._order) return '（无数据）';
            return f.fields._order
                .filter(k => f.fields[k] !== undefined && f.fields[k] !== '')
                .map(k => `${k}: ${f.fields[k]}`)
                .join(' | ');
        },
        _formatRegionFields(r) {
            if (!r.fields || !r.fields._order) return '（无数据）';
            return r.fields._order
                .filter(k => r.fields[k] !== undefined && r.fields[k] !== '')
                .map(k => `${k}: ${r.fields[k]}`)
                .join(' | ');
        },

        _parseActions(text) {
            const actions = [];
            const blocks = [];
            let cur = null;
            for (const raw of text.split('\n')) {
                const line = raw.trim();
                if (line.startsWith('- 【')) {
                    if (cur) blocks.push(cur);
                    cur = line.substring(1).trim();
                } else if (cur !== null) {
                    cur += '\n' + raw;
                }
            }
            if (cur) blocks.push(cur);
            for (const block of blocks) {
                const action = this._parseActionBlock(block);
                if (action) actions.push(action);
            }
            return actions;
        },

        _parseActionBlock(block) {
            const firstLine = block.split('\n')[0];
            const nameM = firstLine.match(/^【(.+?)】/);
            if (!nameM) return null;

            const nameParts = nameM[1].split('|').map(s => s.trim());
            const action = {
                id: `saction_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: nameParts[0] || '',
                icon: '⚡',
                hint: '',
                meta: {},
                status: 'available',
                count: 0,
                effectPart: '',
                sceneUpdatePart: '',
                script: '',
                summary: '',
                createdAt: Date.now(),
            };
            if (nameParts[1]) {
                const e = WorldManager._extractEmoji(nameParts[1]);
                if (e) action.icon = e;
            }

            const afterName = firstLine.substring(nameM[0].length).replace(/^[：:]\s*/, '');
            const bracketM = afterName.match(/^([\s\S]*?)\s*[\[【]([^\]】]+)[\]】]\s*$/);
            if (bracketM) {
                action.hint = bracketM[1].trim();
                for (const f of bracketM[2].split('|')) {
                    const kv = f.match(/^(.+?)[:：]\s*(.+)$/);
                    if (kv) action.meta[kv[1].trim()] = kv[2].trim();
                }
            } else {
                action.hint = afterName.trim();
            }

            const effM = block.match(/【效果】([\s\S]*?)(?=【剧情】|【场景更新】|【摘要】|$)/);
            if (effM) action.effectPart = '【效果】' + effM[1];
            const updM = block.match(/【场景更新】([\s\S]*?)(?=【剧情】|【摘要】|$)/);
            if (updM) action.sceneUpdatePart = '【场景更新】' + updM[1];
            const scriptM = block.match(/【剧情】([\s\S]*?)(?=【效果】|【场景更新】|【摘要】|$)/);
            if (scriptM) action.script = scriptM[1].trim();
            const sumM = block.match(/【摘要】([\s\S]*?)$/);
            if (sumM) action.summary = sumM[1].trim();

            if (!action.name) return null;
            return action;
        },

        // ============================================================
        // 执行行动
        // ============================================================
        async executeAction(actionId) {
            const store = this.ensureStore();
            const action = this.getAction(actionId);
            if (!action) return { ok: false, reason: '行动不存在' };
            if (action.status !== 'available') return { ok: false, reason: '该行动已不可用' };

            if (action.script) {
                const dialogues = VisualNovelManager.parseScript(action.script);
                if (dialogues.length > 0) {
                    await window.UIManager.showText(`正在执行：${action.name}`, 1000);
                    await VisualNovelManager.play(dialogues);
                }
            }
            if (action.effectPart) {
                await new Promise(r => setTimeout(r, 300));
                await this._applyStrategyEffect(action.effectPart);
            }
            if (action.sceneUpdatePart) {
                await new Promise(r => setTimeout(r, 300));
                const update = StoryManager.parseSceneUpdate(action.sceneUpdatePart);
                if (update) await StoryManager.applySceneUpdate(update);
            }

            action.status = 'completed';
            action.count++;
            action.completedAt = Date.now();

            if (window.InteractionHistoryManager) {
                window.InteractionHistoryManager.add({
                    type: 'strategy',
                    target: action.name,
                    targetMeta: { icon: action.icon },
                    scene: '(战略层)',
                    playerInput: action.name,
                    script: action.script,
                    effect: action.effectPart || null,
                    summary: action.summary,
                });
            }
            if (window.SaveManager) window.SaveManager.save();
            return { ok: true, action };
        },

        async _applyStrategyEffect(effectText) {
            const changes = [];

            const factionDataM = effectText.match(/势力数据[:：]\s*([\s\S]*?)(?=实体变化|关系变化|地区数据|$)/);
            if (factionDataM) {
                for (const raw of factionDataM[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const m = line.match(/^[-•]\s*(.+?)[:：]\s*(.+)$/);
                    if (!m) continue;
                    changes.push(...this._applyFieldChanges(m[1].trim(), m[2].trim(), 'faction'));
                }
            }
            const regionDataM = effectText.match(/地区数据[:：]\s*([\s\S]*?)(?=实体变化|关系变化|势力数据|$)/);
            if (regionDataM) {
                for (const raw of regionDataM[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const m = line.match(/^[-•]\s*(.+?)[:：]\s*(.+)$/);
                    if (!m) continue;
                    changes.push(...this._applyFieldChanges(m[1].trim(), m[2].trim(), 'region'));
                }
            }
            const relM = effectText.match(/关系变化[:：]\s*([\s\S]*?)(?=实体变化|势力数据|地区数据|$)/);
            if (relM) {
                for (const raw of relM[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const m = line.match(/^[-•]\s*(.+?)\s*([+\-])\s*(\d+)$/);
                    if (!m) continue;
                    const targetName = m[1].trim();
                    const delta = m[2] === '+' ? parseInt(m[3]) : -parseInt(m[3]);
                    const playerFaction = this.getPlayerFaction();
                    if (playerFaction) {
                        const r = this.changeRelation(playerFaction.id, targetName, delta);
                        if (r) changes.push(`🤝 与${targetName}关系: ${r.value} (${r.status})`);
                    }
                }
            }

            const numberM = effectText.match(/数值变化[:：]\s*([\s\S]*?)(?=实体变化|势力数据|地区数据|关系变化|$)/);
            const itemM = effectText.match(/实体变化[:：]\s*([\s\S]*?)(?=数值变化|势力数据|地区数据|关系变化|$)/);

            if (numberM) {
                const targetM = effectText.match(/目标[:：]\s*(.+)/);
                const targetName = targetM ? targetM[1].trim() : '玩家';
                if (targetName === '玩家') {
                    const synthetic = `【效果】\n目标: 玩家\n数值变化: ${numberM[1].trim()}`;
                    const results = EffectSystem.applyFromNarrative(synthetic);
                    const text = EffectSystem.formatResults(results);
                    if (text) changes.push(text.trim());
                } else {
                    changes.push(...this._applyFieldChanges(targetName, numberM[1].trim(), 'faction'));
                }
            }
            if (itemM) {
                const synthetic = `【效果】\n实体变化:\n${itemM[1].trim()}`;
                const results = EffectSystem.applyFromNarrative(synthetic);
                const text = EffectSystem.formatResults(results);
                if (text) changes.push(text.trim());
            }

            if (changes.length > 0) {
                await window.UIManager.showText('\n' + changes.join('\n'), 4000);
            }
            return changes;
        },

        _applyFieldChanges(targetName, text, type) {
            const results = [];
            const store = this.ensureStore();
            let target = null;
            if (type === 'faction') {
                target = Object.values(store.factions).find(f => f.name === targetName);
                if (!target && /我方势力|我方/.test(targetName)) target = this.getPlayerFaction();
            } else if (type === 'region') {
                target = Object.values(store.regions).find(r => r.name === targetName);
            }
            if (!target) return results;

            const parts = text.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
            for (const part of parts) {
                let m = part.match(/^(.+?)\s*([+\-])\s*(\d+(?:\.\d+)?)$/);
                if (m) {
                    const key = m[1].trim();
                    const op = m[2] === '+' ? 'add' : 'subtract';
                    const val = parseFloat(m[3]);
                    const res = this._changeField(target.fields, key, op, val);
                    if (res) results.push(`📊 ${target.name} ${key}: ${res.before} → ${res.after}`);
                    continue;
                }
                m = part.match(/^(.+?)\s+set\s+(.+)$/i);
                if (m) {
                    const key = m[1].trim();
                    const val = m[2].trim();
                    const res = this._changeField(target.fields, key, 'set', val);
                    if (res) results.push(`📊 ${target.name} ${key}: ${res.before} → ${res.after}`);
                }
            }
            target.updatedAt = Date.now();
            return results;
        },

        // ============================================================
        // 回合推进
        // ============================================================
        async advanceTurn(trigger = 'story') {
            const store = this.ensureStore();
            if (!store.initialized) return null;

            const available = this.getAvailableActions();
            if (available.length > 0 && trigger === 'auto') return null;
            if (this._generating) return null;
            this._generating = true;

            try {
                store.turnCount++;
                const turnLog = {
                    turn: store.turnCount,
                    timestamp: Date.now(),
                    trigger,
                    factionChanges: [],
                    otherActions: [],
                    politicsCrisis: [],
                    narratives: [],
                };

                // 1. 自然变化
                turnLog.factionChanges = await this._applyNaturalChanges();

                // 1.5 ★ 内政结算
                const p = this.ensurePolitics();
                if (p.initialized) {
                    const crises = this.settlePoliticsTurn();
                    if (crises.length > 0) {
                        turnLog.politicsCrisis = crises;
                        console.log(`[Strategy] 本回合社会危机: ${crises.length} 个`);
                    }
                }
                // 1.6 ★ 法案结算
                if (window.BillManager) {
                    const billCrises = await window.BillManager.settleTurn();
                    if (billCrises.length > 0) {
                        turnLog.billCrisis = billCrises;
                        console.log(`[Strategy] 本回合法案事件: ${billCrises.length} 个`);
                    }
                }

                // 1.7 ★ 诉求结算
                if (window.PoliticsActionManager) {
                    const expired = window.PoliticsActionManager.settleDemands();
                    if (expired.length > 0) {
                        turnLog.demandExpired = expired;
                    }
                }
                // 1.8 ★ 军事结算
                if (window.MilitaryManager) {
                    const militaryResult = await window.MilitaryManager.settleTurn();
                    if (militaryResult.events.length > 0) {
                        turnLog.military = militaryResult.events;
                        console.log(`[Strategy] 本回合军事事件: ${militaryResult.events.length} 个`);
                    }
                }
                // 2. 其他势力行动
                const otherActions = await this._generateOtherFactionActions();
                turnLog.otherActions = otherActions;

                // 3. 逐个执行
                for (const act of otherActions) {
                    if (act.script) {
                        const dialogues = VisualNovelManager.parseScript(act.script);
                        if (dialogues.length > 0) {
                            await new Promise(r => setTimeout(r, 200));
                            await VisualNovelManager.play(dialogues);
                        }
                    }
                    if (act.effectPart) {
                        await new Promise(r => setTimeout(r, 300));
                        await this._applyStrategyEffect(act.effectPart);
                    }
                }

                store.turnLog.push(turnLog);
                if (store.turnLog.length > 20) store.turnLog = store.turnLog.slice(-20);

                store.actions = [];
                await this.generateActions();

                if (window.SaveManager) window.SaveManager.save();
                return turnLog;
            } finally {
                this._generating = false;
            }
        },

        async _applyNaturalChanges() {
            const store = this.ensureStore();
            const rules = store.rules.parsed;
            if (!rules || !rules.turnRules) return [];
            const changes = [];
            const playerFaction = this.getPlayerFaction();
            if (!playerFaction) return changes;

            for (const rule of rules.turnRules) {
                const text = rule.text;
                const m = text.match(/^(.+?)\s*([+\-])\s*(.+?)$/);
                if (!m) continue;
                const key = m[1].trim();
                const op = m[2] === '+' ? 'add' : 'subtract';
                const value = this._evalNaturalExpr(m[3].trim(), playerFaction);
                if (value === null || isNaN(value)) continue;
                const res = this._changeField(playerFaction.fields, key, op, Math.abs(value));
                if (res) changes.push(`${key}: ${res.before} → ${res.after}`);
            }
            playerFaction.updatedAt = Date.now();
            return changes;
        },

        _evalNaturalExpr(expr, faction) {
            const parsed = normalizeNumber(expr);
            if (!isNaN(parsed.num) && !parsed.unit) return parsed.num;

            const m = expr.match(/^(.+?)\s*[\/\*]\s*(.+)$/);
            if (m) {
                const key = m[1].trim();
                const n = normalizeNumber(m[2]).num;
                if (isNaN(n)) return null;
                const raw = String(faction.fields[key] ?? '0');
                const val = parseFloat(raw.match(/^-?\d+(?:\.\d+)?/)?.[0] || '0');
                if (expr.includes('/')) return val / n;
                return val * n;
            }
            return null;
        },

        async _generateOtherFactionActions() {
            const store = this.ensureStore();
            const others = this.getOtherFactions();
            if (others.length === 0) return [];

            const playerFaction = this.getPlayerFaction();
            const othersText = others.map(f => {
                const fields = this._formatFactionFields(f);
                const rel = playerFaction?.relations?.[f.name];
                const relText = rel ? `（与我方关系: ${rel.value} ${rel.status}）` : '';
                return `- ${f.icon} ${f.name}${relText}\n  ${fields}`;
            }).join('\n');

            const regionsText = this.getRegions().map(r =>
                `- ${r.icon} ${r.name}：${this._formatRegionFields(r)}`
            ).join('\n');

            const rulesText = store.rules.raw || '';

            const prompt = `你正在为一个视觉小说游戏推进"战略回合"。
现在是第 ${store.turnCount + 1} 回合，其他势力各自执行 1 个行动。

【我方势力】
${playerFaction?.icon || ''} ${playerFaction?.name || '（无）'}
${playerFaction ? this._formatFactionFields(playerFaction) : ''}

【其他势力】
${othersText}

【地区】
${regionsText || '（无）'}

【战略规则】
${rulesText}

【任务】
让每个其他势力执行 1 个符合它利益和当前局势的行动。

【输出格式】（每个势力一个块）

【势力名】
行动: (行动名)
目标: (针对谁/哪个地区)
效果: (数值变化，格式：键 +N 或 键 -N，用顿号分隔)
剧情: (2-5 行 VN 脚本)
关系变化: (与我方的关系变化，如 +5 或 -10；没有则不写)

【规则】
1. 关系好的势力可能合作、援助；关系差的可能挑衅、进攻
2. 行动效果要符合势力的数据
3. 剧情 2-5 行即可
4. 不要捏造不存在的势力

请开始生成：`;

            const result = await window.generateFunctionalReply(prompt, 'strategy-turn');
            if (!result) return [];
            return this._parseOtherActions(result);
        },

        _parseOtherActions(text) {
            const actions = [];
            const blocks = [];
            let cur = null;
            for (const raw of text.split('\n')) {
                const line = raw.trim();
                if (/^【.+?】\s*$/.test(line) && !/^【效果】|【剧情】|【摘要】/.test(line)) {
                    if (cur) blocks.push(cur);
                    cur = line;
                } else if (cur !== null) {
                    cur += '\n' + raw;
                }
            }
            if (cur) blocks.push(cur);

            for (const block of blocks) {
                const nameM = block.match(/^【(.+?)】/);
                if (!nameM) continue;
                const factionName = nameM[1].trim();
                const actionM = block.match(/行动[:：]\s*(.+)/);
                const targetM = block.match(/目标[:：]\s*(.+)/);
                const effectM = block.match(/效果[:：]\s*(.+)/);
                const scriptM = block.match(/剧情[:：]\s*([\s\S]*?)(?=关系变化|$)/);
                const relM = block.match(/关系变化[:：]\s*(.+)/);

                let effectPart = '【效果】\n';
                if (effectM) effectPart += `势力数据:\n- ${factionName}: ${effectM[1].trim()}\n`;
                if (relM) effectPart += `关系变化:\n- ${relM[1].trim()}\n`;

                actions.push({
                    factionName,
                    actionName: actionM ? actionM[1].trim() : '行动',
                    target: targetM ? targetM[1].trim() : '',
                    effectPart,
                    script: scriptM ? scriptM[1].trim() : '',
                });
            }
            return actions;
        },

        // ============================================================
        // 地区访问 → 生成场景
        // ============================================================
        async visitRegion(regionId) {
            const store = this.ensureStore();
            const region = store.regions[regionId];
            if (!region) return null;

            const existing = WorldManager.findEntity(region.name);
            if (existing) {
                await window.LocationModalManager.doEnterScene(existing);
                return existing;
            }

            await window.UIManager.showText(`正在前往【${region.name}】...`, 1500);
            const text = await this._generateSceneForRegion(region);
            if (!text) {
                await window.UIManager.showText('❌ 场景生成失败', 2000);
                return null;
            }
            const created = WorldManager.addScene(text);
            if (!created) {
                await window.UIManager.showText('❌ 场景解析失败', 2000);
                return null;
            }
            created.name = region.name;
            created.regionId = region.id;
            await window.LocationModalManager.doEnterScene(created);
            if (window.SaveManager) window.SaveManager.save();
            return created;
        },

        async _generateSceneForRegion(region) {
            const parts = [];
            parts.push(`【地区】${region.icon} ${region.name}`);
            if (region.description) parts.push(`描述：${region.description}`);
            parts.push(`数据：${this._formatRegionFields(region)}`);
            if (region.factionPresence) {
                const presText = Object.entries(region.factionPresence)
                    .map(([name, fields]) => {
                        const f = fields._order?.map(k => `${k}: ${fields[k]}`).join(' | ') || '';
                        return `- ${name}：${f}`;
                    }).join('\n');
                if (presText) parts.push(`势力分布：\n${presText}`);
            }

            const worldCtx = StoryManager.buildContext(null, {
                parentStory: false, mainChars: true, scene: false,
                pendingEvents: false, volumes: false, interactionDigests: false,
            });
            const playerBlock = PlayerStateManager.formatForPrompt();

            const prompt = `你正在为视觉小说游戏生成一个"地区场景"。
玩家从战略面板访问了这个地区，需要生成一个可以探索的具体场景。

【世界上下文】
${worldCtx}

【地区信息】
${parts.join('\n\n')}

${playerBlock}

【任务】
根据地区信息，生成一个具体的场景。

【输出格式】

*【场景名】*
描述：(详细描述)
环境：(环境特征)
环境数据:[时间:X|天气:X|温度:X|...]
背景：(中文图片名)
🎵 音乐：(曲名)

场景人物：
- 【人物名|性别|心情|好感度|状态|主次】：描述，[标签]

场景实体：
- 【实体名|图标】：描述，[类型|状态|功能|交互方式|图标]

场景行动：
- 【行动名|图标|once/repeat】：描述

请开始生成：`;

            return await window.generateFunctionalReply(prompt, 'strategy-region-scene');
        },

        // ============================================================
        // ============================================================
        // 内政系统
        // ============================================================
        // ============================================================

        ensurePolitics() {
            const s = this.ensureStore();
            if (!s.politics) {
                s.politics = {
                    regime: {
                        representative: { name: '', type: '', desc: '' },
                        executive: { name: '', type: '', desc: '' },
                        legitimacy: '',
                    },
                    economy: null,
                    classes: {},
                    interestGroups: {},
                    rules: null,
                    initialized: false,
                    history: [],
                };
            }
            const p = s.politics;
            if (!p.regime) p.regime = { representative: { name: '', type: '', desc: '' }, executive: { name: '', type: '', desc: '' }, legitimacy: '' };
            if (!p.classes) p.classes = {};
            if (!p.interestGroups) p.interestGroups = {};
            if (!Array.isArray(p.history)) p.history = [];
            if (!p.economy) p.economy = this._defaultEconomy();
            if (!p.rules) p.rules = this._defaultPoliticsRules();
            if (!p.mechanics) {
                p.mechanics = {
                    wealthChange: {
                        baseRate: 0.005,
                        coefficients: {
                            ownershipConcentration: -0.5,
                            distributionEquality: 0.3,
                            politicalBias: 0.5,
                        },
                        periodMultipliers: {
                            'stable': 1.0,
                        },
                    },
                    mechanisms: [],
                };
            }
            return p;
        },

        _defaultEconomy() {
            return {
                totalPop: 1000000,
                capacityFactor: 1.5,
                totalWealth: 0,
                subsistence: 100,
                history: [],
        
                production: {
                    productivity: { tech: 30, landYield: 100, industry: 0, custom: {} },
                    ownership: { type: '未定义', concentration: 0.5, assets: [] },
                    distribution: { type: '未定义', equality: 0.5, rules: [] },
                },
        
                // ★ 规范
                legalNorm: {
                    strength: 0.5,
                    nature: '过渡性',
                    role: '促进',
                    rules: [],
                    contradictions: [],
                },
        
                period: {
                    name: '稳定时期',
                    type: 'stable',
                    desc: '',
                    wealthMultiplier: 1.0,
                    specialRules: [],
                },
            };
        },

        _defaultPoliticsRules() {
            return {
                wealthFormula: {
                    relationBonus: {},
                    exponent: 1.0,
                    minSharePerPop: 0.3,
                },
                livingFormula: { subsistence: 100 },
                discontentFormula: {
                    weights: {
                        absolutePoverty: 1.2,
                        relativeDeprivation: 0.4,
                        politicalGap: 0.3,
                        exploitation: 1.0,
                        inertia: 0.3,
                    },
                    enabled: {
                        absolutePoverty: true,
                        relativeDeprivation: true,
                        politicalGap: true,
                        exploitation: true,
                        inertia: true,
                    },
                },
                consciousnessFormula: {
                    eduFactorBase: 0.5,
                    eduFactorTechWeight: 0.5,
                    multiplier: 1.5,
                    enabled: true,
                },
                wealthFormula: { relationBonus: {}, exponent: 1.0, minSharePerPop: 0.8 },
                livingFormula: { subsistence: 100 },
                rebellionRules: {
                    conditions: {
                        discontent: { min: 70 },
                        consciousness: { min: 60 },
                        pop: { min: 0.2 },
                    },
                    outcomes: [
                        { type: 'suppress', chance: 0.5 },
                        { type: 'success', chance: 0.3 },
                        { type: 'compromise', chance: 0.2 },
                    ],
                },
                turnRules: [
                    { field: 'tech', op: 'add', value: 0.2 },
                ],
                meta: { worldview: '通用', generatedAt: Date.now() },
            };
        },

        // ---------- 生成内政 ----------
        async generatePolitics(context = '') {
            if (this._generating) return null;
            const playerFaction = this.getPlayerFaction();
            if (!playerFaction) return null;

            this._generating = true;
            try {
                const worldCtx = StoryManager.buildContext(null, {
                    parentStory: false, mainChars: true, scene: false,
                    pendingEvents: false, interactionDigests: false,
                    world:              true,
                    worldHistory:       true,
                    volumes:            true,
                    chapters:           true,
                    chapter:            true,
                });
                const factionText = this._formatFactionFields(playerFaction);

                const prompt = `你正在为一个视觉小说游戏生成"内政结构"。
这是战略层的子模块，描述一个势力的：
1. 政治结构（政治代表 + 行政机构 + 统治合法性）
2. 经济基础（生产力 + 生产关系）
3. 阶级与阶层（从下到上的社会结构）
4. 利益集团与派系（政治博弈）
5. 内政规则（代码会按规则结算，不写死）

【世界上下文】
${worldCtx}

【我方势力】
${playerFaction.icon} ${playerFaction.name}
${factionText}
${playerFaction.description ? '描述：' + playerFaction.description : ''}

${context ? `【玩家要求】\n${context}\n` : ''}

【输出格式】（严格遵守）

【政治结构】
政治代表: 【名字:XXX|类型:世袭/民选/推举/武力|描述:一段话】
行政机构: 【名字:XXX|类型:首辅负责制/内阁制/委员会制|描述:一段话】
统治合法性: (天命所归 / 民选授权 / 武力镇压 / 传统惯例)

【经济基础】
人口总数: X
生产力: 【技术水平:X|土地产出:Y|工业化:X】
所有制: 【类型:自由定义|集中度:X】
分配关系: 【类型:自由定义|平等度:Y】
社会总产出: 【基准产能:X|生存线:Y】

【规范】
规范强度: 70
规范性质: 过渡性
历史作用: 促进

具体规范:
- 【按劳分配|分配|60】：多劳多得，不劳动者不得食
- 【铁的纪律纪|服从|80】：成员必须服从组织决定
- 【公共财产神圣|财产|90】：侵吞公产者严惩

内在矛盾:
- 强制劳动与自觉劳动的张力
- 组织和个人的张力

【规则】
- 规范强度 0-100：
  - 0-20 = 自觉劳动，无需强制（共产主义）
  - 20-40 = 社会舆论为主
  - 40-70 = 制度约束为主
  - 70-90 = 强制力为主
  - 90-100 = 极权
- 规范性质：
  - 对立 = 规范保护少数人，与人民对立
  - 过渡性 = 规范为更高平等做准备，但仍有矛盾
  - 服务性 = 规范为人民服务
  - 消失中 = 人们自觉劳动，规范正在消亡
  - 彻底消失 = 没有这个规范

- 历史作用：阻碍 / 促进 / 中性
- 具体规范 2-4 条
- 内在矛盾 1-4 条

【当前时期】
当前时期: X
时期说明: 一段话
时期财富倍率: X
时期财富上限: Y%

【财富变化机制】
财富变化基础速率: X
财富变化系数: 【政治力量偏差:X|所有制集中度:Y|分配平等度:Z】

再分配机制:
- 【名称|触发条件|效果】
- 【名称|触发条件|效果】
- 【名称|触发条件|效果】

【规则】
- 人口总数：绝对数字
- 生产力三要素：技术水平 0-100、土地产出 100 为基准、工业化 0-100
- 所有制：
  - 类型：自由定义（如私有制、公有制、集体所有制、神权所有制、虫巢所有制）
  - 集中度 0-100：生产资料集中程度，越高越集中
- 分配关系：
  - 类型：自由定义（如按资分配、按劳分配、按需分配、按权分配、按血统分配）
  - 平等度 0-100：越高越平均
- 当前时期：AI 自由定义，可以用任何名字
  - 时期财富倍率：0-2，越低财富变化越慢
  - 时期财富上限：0.1%-5%，每回合 wealthShare 最大变动
- 财富变化系数：
  - 政治力量偏差：正值表示政治力量高的阶级获益
  - 所有制集中度：负值表示集中度越高，财富越向高 power 阶级流动
  - 分配平等度：正值表示平等度越高，财富越向低 wealth 阶级流动
- 再分配机制：自由定义，每条格式 【名称|触发条件|效果】
  - 触发条件用 JS 表达式，可用变量：period、regime.type、ownership.type
  - 效果支持：highWealth/lowWealth/all，加减数值

【阶级】
- 【阶级名|图标|人口:X%|政治力量:Y|支持度:Z|动员力:W】
  描述: (一段话)
  - 【阶层名|占本阶级:X%|政治力量:Y|支持度:Z】：描述
  - 【阶层名|占本阶级:X%|政治力量:Y|支持度:Z】：描述
- 【阶级名2|图标|人口:X%|政治力量:Y|支持度:Z|动员力:W】
  描述: (一段话)
  - 【阶层名|占本阶级:X%|政治力量:Y|支持度:Z】：描述

【利益集团】
- 【集团名|图标|政治力量:X|支持度:Y】：描述
  成员:
  - 【阶级名.阶层名|权重:X】
  - 【阶级名.阶层名|权重:Y】
  派系:
  - 【派系名|图标|政治力量:X|支持度:Y|立场:守旧/变法/中立/激进|对立:另一派系名】：描述
    成员:
    - 【阶级名.阶层名|权重:X】
    - 【阶级名.阶层名|权重:Y】
  - 【派系名|图标|政治力量:X|支持度:Y|立场:守旧/变法/中立/激进|对立:另一派系名】：描述
    成员:
    - 【阶级名.阶层名|权重:X】
- 【集团名2|图标|政治力量:X|支持度:Y】：描述
  成员:
  - 【阶级名.阶层名|权重:X】

【内政规则】（必须输出，代码会按这个执行）

1. 生产关系系数（决定财富分配）
格式：- 【阶级名|系数:X】
例如：
- 【阶级A|系数:X】
- 【阶级B|系数:Y】
- 【阶级C|系数:Z】

2. 财富分配公式参数
格式：【政治力量指数:X|最低人口占有:Y】
例如：【政治力量指数:X|最低人口占有:Y】

3. 生存线
格式：【每人每回合最低消耗:X】
例如：【每人每回合最低消耗:X】

4. 不满度因子（每个因子 0-2，0 表示禁用）
格式：【绝对贫困:N|相对剥夺:N|政治无权:N|剥削:N|历史惯性:N】
例如：【绝对贫困:1.4|相对剥夺:1.0|政治无权:0.8|剥削:0|历史惯性:1.2】

【重要】根据你的生产关系，决定哪些因子该禁用：
- 按需分配 / 真正实现的共产主义社会 → 剥削 写 0（社会不存在剥削）
- 私有制 / 按资分配 → 剥削 写 1.0-1.5（剥削是主要矛盾）
- 神权 / 血统制 → 政治无权 写 1.5（出身决定一切）
- 平等社会 → 相对剥夺 写 0.2 以下（人人平等，无剥夺感）
- 等级森严 → 相对剥夺 写 1.0 以上
- 其他 → 根据剧情和背景而定。

5. 阶级觉悟公式
格式：【教育系数:X|科技权重:Y|倍率:Z】
例如：【教育系数:X|科技权重:Y|倍率:Z】
如果该世界观没有“觉悟”概念（如虫族），倍率写 0

6. 起义触发阈值
格式：【不满度:X|觉悟:Y|人口:Z】
例如：【不满度:X|觉悟:Y|人口:Z】

7. 每回合自然变化
格式：- 【字段:操作:值】
操作可以是 add / subtract / set
例如：
- 【技术水平:add:X】
- 【土地产出:add:Y】

【规则要求】
1. 阶级 3-5 个，每个阶级 2-4 个阶层。
2. 阶级的“人口”是占全国比例，加起来约 100%。
3. 政治力量 0-100，反映该阶级/集团在当前统治体系中的实际影响力。
4. 支持度 0-100，反映对统治者的支持。
5. 动员力 0-100，反映该阶级能提供的兵源潜力。
6. 利益集团 2-4 个，每个集团 1-3 个派系。
7. 集团的“成员”引用阶级.阶层，权重加起来约 100。
8. 派系的“对立”引用同集团内其他派系名。
9. 系数、权重、阈值必须符合世界观。如果某个概念不存在，权重写 0。
10. 所有数值必须可计算，不要写文字。
11. 所有描述用中文，30-80 字。

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'strategy-politics');
                if (!result) return null;
                return this._parsePolitics(result);
            } finally {
                this._generating = false;
            }
        },

        // ---------- 解析内政 ----------
        _parsePolitics(text) {
            const p = this.ensurePolitics();
            p.classes = {};
            p.interestGroups = {};
            p.history = [];
            p.regime = {
                representative: { name: '', type: '', desc: '' },
                executive: { name: '', type: '', desc: '' },
                legitimacy: '',
            };
            p.economy = this._defaultEconomy();

            // 政治结构
            const repM = text.match(/政治代表[:：]\s*【([^】]+)】/);
            if (repM) {
                const obj = {};
                const parts = repM[1].split('|').map(s => s.trim());
                for (let i = 0; i < parts.length; i++) {
                    const pt = parts[i];
                    if (!pt) continue;
                    const kv = pt.match(/^(.+?)[:：]\s*(.+)$/);
                    if (kv) {
                        obj[kv[1].trim()] = kv[2].trim();
                    } else if (i === 0) {
                        // ★ 第一个字段没有冒号 → 当成名字
                        obj['名字'] = pt;
                    }
                }
                p.regime.representative = {
                    name: obj['名字'] || obj['名称'] || '',
                    type: obj['类型'] || '',
                    desc: obj['描述'] || '',
                };
            }

            // 行政机构
            const execM = text.match(/行政机构[:：]\s*【([^】]+)】/);
            if (execM) {
                const obj = {};
                const parts = execM[1].split('|').map(s => s.trim());
                for (let i = 0; i < parts.length; i++) {
                    const pt = parts[i];
                    if (!pt) continue;
                    const kv = pt.match(/^(.+?)[:：]\s*(.+)$/);
                    if (kv) {
                        obj[kv[1].trim()] = kv[2].trim();
                    } else if (i === 0) {
                        obj['名字'] = pt;
                    }
                }
                p.regime.executive = {
                    name: obj['名字'] || obj['名称'] || '',
                    type: obj['类型'] || '',
                    desc: obj['描述'] || '',
                };
            }
            const legM = text.match(/统治合法性[:：]\s*(.+)/);
            if (legM) p.regime.legitimacy = legM[1].trim();

            // 经济基础
            const popM = text.match(/人口总数[:：]\s*([\d,，]+)/);
            if (popM) p.economy.totalPop = parseInt(popM[1].replace(/[,，]/g, '')) || 1000000;

            const prodM = text.match(/生产力[:：]\s*【([^】]+)】/);
            if (prodM) {
                for (const pt of prodM[1].split('|').map(s => s.trim())) {
                    const kv = pt.match(/^(.+?)[:：]\s*(.+)$/);
                    if (!kv) continue;
                    const k = kv[1].trim(), v = kv[2].trim();
                    if (k === '技术水平') p.economy.production.productivity.tech = parseFloat(v) || 30;
                    else if (k === '土地产出') p.economy.production.productivity.landYield = parseFloat(v) || 100;
                    else if (k === '工业化') p.economy.production.productivity.industry = parseFloat(v) || 0;
                }
            }

            // 所有制
            const ownM = text.match(/所有制[:：]\s*【([^】]+)】/);
            if (ownM) {
                for (const pt of ownM[1].split('|').map(s => s.trim())) {
                    const kv = pt.match(/^(.+?)[:：]\s*(.+)$/);
                    if (!kv) continue;
                    const k = kv[1].trim(), v = kv[2].trim();
                    if (k === '类型') p.economy.production.ownership.type = v;
                    else if (k === '集中度') p.economy.production.ownership.concentration = parseFloat(v) / 100 || 0.5;
                }
            }

            // 分配关系
            const distM = text.match(/分配关系[:：]\s*【([^】]+)】/);
            if (distM) {
                for (const pt of distM[1].split('|').map(s => s.trim())) {
                    const kv = pt.match(/^(.+?)[:：]\s*(.+)$/);
                    if (!kv) continue;
                    const k = kv[1].trim(), v = kv[2].trim();
                    if (k === '类型') p.economy.production.distribution.type = v;
                    else if (k === '平等度') p.economy.production.distribution.equality = parseFloat(v) / 100 || 0.5;
                }
            }
            // ========== 规范 ==========
            const lnStrengthM = text.match(/规范强度[:：]\s*([\d.]+)/);
            if (lnStrengthM) p.economy.legalNorm.strength = parseFloat(lnStrengthM[1]) / 100 || 0.5;

            const lnNatureM = text.match(/规范性质[:：]\s*(.+)/);
            if (lnNatureM) p.economy.legalNorm.nature = lnNatureM[1].trim();

            const lnRoleM = text.match(/历史作用[:：]\s*(.+)/);
            if (lnRoleM) p.economy.legalNorm.role = lnRoleM[1].trim();

            // 具体规范
            const lnRulesM = text.match(/具体规范[:：]?\s*\n([\s\S]*?)(?=内在矛盾|【|$)/);
            if (lnRulesM) {
                p.economy.legalNorm.rules = [];
                for (const raw of lnRulesM[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const m = line.match(/^[-•]\s*【(.+?)\|(.+?)\|([\d.]+)】[：:]?\s*(.*)$/);
                    if (m) {
                        p.economy.legalNorm.rules.push({
                            name: m[1].trim(),
                            type: m[2].trim(),
                            strength: parseFloat(m[3]) / 100 || 0.5,
                            desc: m[4].trim(),
                        });
                    }
                }
            }

            // 内在矛盾
            const lnContraM = text.match(/内在矛盾[:：]?\s*\n([\s\S]*?)(?=【|$)/);
            if (lnContraM) {
                p.economy.legalNorm.contradictions = [];
                for (const raw of lnContraM[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    p.economy.legalNorm.contradictions.push(line.substring(1).trim());
                }
            }
            // 当前时期
            const periodM = text.match(/当前时期[:：]\s*(.+)/);
            if (periodM) {
                const raw = periodM[1].trim();
                p.economy.period = p.economy.period || {};
                p.economy.period.name = raw;
                // 内部标识（AI 可给，也可以推断）
                p.economy.period.type = raw;   // 直接用名字做 type
                // 财富倍率
                p.economy.period.wealthMultiplier = 1.0;
            }

            const periodMultM = text.match(/时期财富倍率[:：]\s*([\d.]+)/);
            if (periodMultM) p.economy.period.wealthMultiplier = parseFloat(periodMultM[1]) || 1.0;

            const periodCapM = text.match(/时期财富上限[:：]\s*([\d.]+)%/);
            if (periodCapM) p.economy.period.wealthChangeCap = parseFloat(periodCapM[1]) / 100 || 0.02;

            const periodDescM = text.match(/时期说明[:：]\s*(.+)/);
            if (periodDescM) p.economy.period.desc = periodDescM[1].trim();

            // 财富变化速率
            const rateM = text.match(/财富变化基础速率[:：]\s*([\d.]+)/);
            if (rateM) {
                p.mechanics = p.mechanics || {};
                p.mechanics.wealthChange = p.mechanics.wealthChange || {};
                p.mechanics.wealthChange.baseRate = parseFloat(rateM[1]) || 0.005;
            }

            // 系数
            const coefM = text.match(/财富变化系数[:：]\s*【([^】]+)】/);
            if (coefM) {
                p.mechanics = p.mechanics || {};
                p.mechanics.wealthChange = p.mechanics.wealthChange || {};
                p.mechanics.wealthChange.coefficients = p.mechanics.wealthChange.coefficients || {};
                for (const pt of coefM[1].split('|').map(s => s.trim())) {
                    const kv = pt.match(/^(.+?)[:：]\s*(.+)$/);
                    if (!kv) continue;
                    p.mechanics.wealthChange.coefficients[kv[1].trim()] = parseFloat(kv[2]) || 0;
                }
            }

            // 再分配机制
            const mechBlockM = text.match(/再分配机制[:：]?\s*\n([\s\S]*?)(?=\n【|$)/);
            if (mechBlockM) {
                p.mechanics = p.mechanics || {};
                p.mechanics.mechanisms = [];
                for (const raw of mechBlockM[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const m = line.match(/^[-•]\s*【(.+?)\|(.+?)\|(.+?)】/);
                    if (m) {
                        p.mechanics.mechanisms.push({
                            name: m[1].trim(),
                            trigger: m[2].trim(),
                            effect: m[3].trim(),
                            desc: m[3].trim(),
                        });
                    }
                }
            }

            // 阶级
            const classBlockM = text.match(/【阶级】([\s\S]*?)(?=【利益集团】|【内政规则】|$)/);
            if (classBlockM) {
                let curClass = null;
                for (const raw of classBlockM[1].split('\n')) {
                    const line = raw.replace(/\s+$/, '');
                    const indent = line.match(/^\s*/)[0].length;
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    if (indent === 0 && /^[-•]\s*【/.test(trimmed)) {
                        const cls = this._parseClassLine(trimmed);
                        if (cls) { p.classes[cls.name] = cls; curClass = cls; }
                        continue;
                    }
                    if (indent > 0 && /^[-•]\s*【/.test(trimmed) && curClass) {
                        const st = this._parseStratumLine(trimmed);
                        if (st) curClass.strata[st.name] = st;
                        continue;
                    }
                    if (indent > 0 && /^描述[:：]/.test(trimmed) && curClass) {
                        curClass.description = trimmed.replace(/^描述[:：]\s*/, '');
                    }
                }
            }

            // ========== 利益集团 ==========
            const igBlockM = text.match(/【利益集团】([\s\S]*?)(?=【内政规则】|$)/);
            if (igBlockM) {
                const lines = igBlockM[1].split('\n');
                let curGroup = null;
                let curFaction = null;
                let section = '';   // 'groupMembers' | 'groupFactions' | 'factionMembers'

                for (const raw of lines) {
                    const line = raw.replace(/\s+$/, '');
                    const trimmed = line.trim();
                    if (!trimmed) continue;

                    // 判断缩进层级（用非空格字符的起始位置）
                    const indent = line.search(/\S/);

                    // 1. 顶级集团：缩进 0
                    if (indent === 0 && /^[-•]\s*【/.test(trimmed)) {
                        const g = this._parseInterestGroupLine(trimmed);
                        if (g) {
                            p.interestGroups[g.name] = g;
                            curGroup = g;
                            curFaction = null;
                            section = '';
                        }
                        continue;
                    }

                    // 2. 缩进 1 级：集团的属性（成员: / 派系:）
                    if (indent > 0 && indent < 4) {
                        if (trimmed === '成员:') { section = 'groupMembers'; continue; }
                        if (trimmed === '派系:') { section = 'groupFactions'; continue; }
                    }

                    // 3. 缩进 1 级 + 【...】：派系
                    if (indent > 0 && indent < 4 && /^[-•]\s*【/.test(trimmed) && section === 'groupFactions') {
                        const f = this._parseFactionLine(trimmed);
                        if (f) {
                            curGroup.factions[f.name] = f;
                            curFaction = f;
                            section = '';   // 重置，等下面遇到 "成员:"
                        }
                        continue;
                    }

                    // 4. 缩进 2 级：派系的属性（成员:）
                    if (indent >= 4 && trimmed === '成员:' && curFaction) {
                        section = 'factionMembers';
                        continue;
                    }

                    // 5. 缩进 1 级 + 成员引用：集团成员
                    if (section === 'groupMembers' && indent > 0 && /^[-•]\s*【/.test(trimmed) && curGroup) {
                        const m = this._parseMemberRef(trimmed);
                        if (m) curGroup.members.push(m);
                        continue;
                    }

                    // 6. 缩进 2 级 + 成员引用：派系成员
                    if (section === 'factionMembers' && indent >= 4 && /^[-•]\s*【/.test(trimmed) && curFaction) {
                        const m = this._parseMemberRef(trimmed);
                        if (m) curFaction.members.push(m);
                        continue;
                    }
                }
            }

            // 规则
            p.rules = this._parsePoliticsRules(text);

            // 派生计算
            this._recalcPolitics();
            this.computeTotalWealth();
            this.computeWealthShares();
            this.computeLivingStandards();
            this.computeDiscontent();
            this.computeClassConsciousness();

            p.initialized = true;
            if (window.SaveManager) window.SaveManager.save();
            console.log('[Strategy] 内政已生成:', {
                classes: Object.keys(p.classes).length,
                groups: Object.keys(p.interestGroups).length,
                rules: p.rules ? 'ok' : 'missing',
            });
            return p;
        },

        _parseClassLine(line) {
            const m = line.trim().match(/^[-•]?\s*【(.+?)】\s*[：:]?\s*(.*)$/);
            if (!m) return null;
            const parts = m[1].split('|').map(s => s.trim());
            const name = parts[0] || '';
            if (!name) return null;

            const cls = {
                name, icon: '👥', pop: 0, politicalPower: 0, support: 50,
                mobilization: 0, description: m[2] || '', fields: { _order: [] }, strata: {},
            };
            for (let i = 1; i < parts.length; i++) {
                const pt = parts[i];
                if (!pt) continue;
                if (i === 1) {
                    const e = WorldManager._extractEmoji(pt);
                    if (e && !pt.includes(':')) { cls.icon = e; continue; }
                }
                const kv = pt.match(/^(.+?)[:：]\s*(.+)$/);
                if (!kv) continue;
                const k = kv[1].trim();
                const v = kv[2].trim();
                if (k === '人口') cls.pop = parseFloat(v) / 100 || 0;
                else if (k === '政治力量') cls.politicalPower = parseFloat(v) || 0;
                else if (k === '支持度') cls.support = parseFloat(v) || 0;
                else if (k === '动员力') cls.mobilization = parseFloat(v) || 0;
                else { cls.fields[k] = v; cls.fields._order.push(k); }
            }
            return cls;
        },

        _parseStratumLine(line) {
            const m = line.trim().match(/^[-•]?\s*【(.+?)】\s*[：:]?\s*(.*)$/);
            if (!m) return null;
            const parts = m[1].split('|').map(s => s.trim());
            const name = parts[0] || '';
            if (!name) return null;
            const st = {
                name, icon: '👤', share: 0, politicalPower: 0, support: 50,
                description: m[2] || '', fields: { _order: [] },
            };
            for (let i = 1; i < parts.length; i++) {
                const pt = parts[i];
                if (!pt) continue;
                const kv = pt.match(/^(.+?)[:：]\s*(.+)$/);
                if (!kv) continue;
                const k = kv[1].trim();
                const v = kv[2].trim();
                if (k === '占本阶级') st.share = parseFloat(v) / 100 || 0;
                else if (k === '政治力量') st.politicalPower = parseFloat(v) || 0;
                else if (k === '支持度') st.support = parseFloat(v) || 0;
                else { st.fields[k] = v; st.fields._order.push(k); }
            }
            return st;
        },

        _parseInterestGroupLine(line) {
            const m = line.trim().match(/^[-•]?\s*【(.+?)】\s*[：:]?\s*(.*)$/);
            if (!m) return null;
            const parts = m[1].split('|').map(s => s.trim());
            const name = parts[0] || '';
            if (!name) return null;
            const g = {
                name, icon: '🏛️', politicalPower: 0, support: 50,
                description: m[2] || '', fields: { _order: [] }, members: [], factions: {},
            };
            for (let i = 1; i < parts.length; i++) {
                const pt = parts[i];
                if (!pt) continue;
                if (i === 1) {
                    const e = WorldManager._extractEmoji(pt);
                    if (e && !pt.includes(':')) { g.icon = e; continue; }
                }
                const kv = pt.match(/^(.+?)[:：]\s*(.+)$/);
                if (!kv) continue;
                const k = kv[1].trim();
                const v = kv[2].trim();
                if (k === '政治力量') g.politicalPower = parseFloat(v) || 0;
                else if (k === '支持度') g.support = parseFloat(v) || 0;
                else { g.fields[k] = v; g.fields._order.push(k); }
            }
            return g;
        },

        _parseFactionLine(line) {
            const m = line.trim().match(/^[-•]?\s*【(.+?)】\s*[：:]?\s*(.*)$/);
            if (!m) return null;
            const parts = m[1].split('|').map(s => s.trim());
            const name = parts[0] || '';
            if (!name) return null;
            const f = {
                name, icon: '⚔️', politicalPower: 0, support: 50,
                stance: '', opposes: [], description: m[2] || '', fields: { _order: [] }, members: [],
            };
            for (let i = 1; i < parts.length; i++) {
                const pt = parts[i];
                if (!pt) continue;
                if (i === 1) {
                    const e = WorldManager._extractEmoji(pt);
                    if (e && !pt.includes(':')) { f.icon = e; continue; }
                }
                const kv = pt.match(/^(.+?)[:：]\s*(.+)$/);
                if (!kv) continue;
                const k = kv[1].trim();
                const v = kv[2].trim();
                if (k === '政治力量') f.politicalPower = parseFloat(v) || 0;
                else if (k === '支持度') f.support = parseFloat(v) || 0;
                else if (k === '立场') f.stance = v;
                else if (k === '对立') f.opposes = v.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
                else { f.fields[k] = v; f.fields._order.push(k); }
            }
            return f;
        },

        _parseMemberRef(line) {
            const m = line.trim().match(/^[-•]?\s*【(.+?)】/);
            if (!m) return null;
            const parts = m[1].split('|').map(s => s.trim());
            const ref = parts[0] || '';
            if (!ref) return null;
            const [cls, stratum] = ref.split('.').map(s => s.trim());
            let weight = 100;
            for (let i = 1; i < parts.length; i++) {
                const kv = parts[i].match(/^(.+?)[:：]\s*(.+)$/);
                if (kv && kv[1].trim() === '权重') weight = parseFloat(kv[2]) || 0;
            }
            return { class: cls, stratum, weight };
        },

        _parsePoliticsRules(text) {
            const rules = this._defaultPoliticsRules();
            rules.wealthFormula.relationBonus = {};

            // 1. 生产关系系数
            const bonusSection = text.match(/生产关系系数[:：]?\s*([\s\S]*?)(?=\n\s*\d\.|【政治力量指数|【每人每回合|【绝对贫困|【教育系数|【不满度:|每回合自然变化|$)/);
            if (bonusSection) {
                for (const raw of bonusSection[1].split('\n')) {
                    const line = raw.trim();
                    const m = line.match(/^[-•]?\s*【(.+?)\|系数[:：]\s*([\d.]+)】/);
                    if (m) rules.wealthFormula.relationBonus[m[1].trim()] = parseFloat(m[2]) || 1.0;
                }
            }

            // 2. 财富分配公式
            const wealthM = text.match(/【政治力量指数[:：]\s*([\d.]+)\|最低人口占有[:：]\s*([\d.]+)】/);
            if (wealthM) {
                rules.wealthFormula.exponent = parseFloat(wealthM[1]) || 1.0;
                rules.wealthFormula.minSharePerPop = parseFloat(wealthM[2]) || 0.3;
            }

            // 3. 生存线
            const subM = text.match(/【每人每回合最低消耗[:：]\s*([\d.]+)】/);
            if (subM) rules.livingFormula.subsistence = parseFloat(subM[1]) || 100;

            // 4. 不满度权重
            const disM = text.match(/【绝对贫困[:：]\s*([\d.]+)\|相对剥夺[:：]\s*([\d.]+)\|政治无权[:：]\s*([\d.]+)\|剥削[:：]\s*([\d.]+)\|历史惯性[:：]\s*([\d.]+)】/);
            if (disM) {
                rules.discontentFormula.weights = {
                    absolutePoverty: parseFloat(disM[1]) || 0,
                    relativeDeprivation: parseFloat(disM[2]) || 0,
                    politicalGap: parseFloat(disM[3]) || 0,
                    exploitation: parseFloat(disM[4]) || 0,
                    inertia: parseFloat(disM[5]) || 0,
                };
                // 期望落差权重（默认 0.5）
                rules.discontentFormula.weights.aspirationGap = 0.5;
                rules.discontentFormula.enabled.aspirationGap = true;
                for (const k of Object.keys(rules.discontentFormula.weights)) {
                    rules.discontentFormula.enabled[k] = rules.discontentFormula.weights[k] > 0;
                }
            }

            // 5. 觉悟公式
            const consM = text.match(/【教育系数[:：]\s*([\d.]+)\|科技权重[:：]\s*([\d.]+)\|倍率[:：]\s*([\d.]+)】/);
            if (consM) {
                rules.consciousnessFormula.eduFactorBase = parseFloat(consM[1]) || 0.5;
                rules.consciousnessFormula.eduFactorTechWeight = parseFloat(consM[2]) || 0.5;
                rules.consciousnessFormula.multiplier = parseFloat(consM[3]) || 0;
                rules.consciousnessFormula.enabled = rules.consciousnessFormula.multiplier > 0;
            }

            // 6. 起义阈值
            const rebM = text.match(/【不满度[:：]\s*([\d.]+)\|觉悟[:：]\s*([\d.]+)\|人口[:：]\s*([\d.]+)】/);
            if (rebM) {
                rules.rebellionRules.conditions = {
                    discontent: { min: parseFloat(rebM[1]) || 70 },
                    consciousness: { min: parseFloat(rebM[2]) || 60 },
                    pop: { min: parseFloat(rebM[3]) || 0.2 },
                };
            }

            // 7. 每回合自然变化
            const turnSection = text.match(/每回合自然变化[:：]?\s*([\s\S]*?)(?=$)/);
            if (turnSection) {
                rules.turnRules = [];
                for (const raw of turnSection[1].split('\n')) {
                    const line = raw.trim();
                    const m = line.match(/^[-•]?\s*【(.+?)[:：]\s*(add|subtract|set)[:：]\s*([\d.]+)】/);
                    if (m) rules.turnRules.push({ field: m[1].trim(), op: m[2], value: parseFloat(m[3]) });
                }
                if (rules.turnRules.length === 0) {
                    rules.turnRules = [{ field: 'tech', op: 'add', value: 0.2 }];
                }
            }

            rules.meta = { worldview: 'AI 生成', generatedAt: Date.now() };
            return rules;
        },

        _findStratum(className, stratumName) {
            const p = this.ensurePolitics();
            const c = p.classes[className];
            if (!c) return null;
            return c.strata[stratumName] || null;
        },

        _recalcPolitics() {
            const p = this.ensurePolitics();
            let totalPop = 0;
            for (const c of Object.values(p.classes)) totalPop += c.pop;
            if (totalPop > 0 && Math.abs(totalPop - 1) > 0.05) {
                for (const c of Object.values(p.classes)) c.pop = c.pop / totalPop;
            }
        },

        // ---------- 经济与动力学 ----------
        computeTotalWealth() {
            const p = this.ensurePolitics();
            const eco = p.economy;
            const prod = eco.production;
            const subsistence = p.rules?.livingFormula?.subsistence ?? 100;
        
            const totalPop = eco.totalPop || 1000000;
        
            const techFactor = 0.5 + (prod.productivity.tech || 0) / 100;
            const yieldFactor = (prod.productivity.landYield || 100) / 100;
            const industryFactor = 1 + (prod.productivity.industry || 0) / 100;
        
            const capacityFactor = eco.capacityFactor ?? 1.5;
        
            const baseOutput = totalPop * subsistence * capacityFactor;
            eco.totalWealth = Math.round(baseOutput * techFactor * yieldFactor * industryFactor);
            return eco.totalWealth;
        },

        computeWealthShares() {
            const p = this.ensurePolitics();
            const classes = Object.values(p.classes);
            if (classes.length === 0) return;
        
            const prod = p.economy.production;
            const mech = p.mechanics.wealthChange;
            const period = p.economy.period;
        
            // ★ 首次生成：直接采用 AI 给的 wealthShare
            let firstTime = false;
            if (classes.every(c => c.wealthShare === undefined)) {
                firstTime = true;
                for (const c of classes) {
                    c.wealthShare = c.baseWealthShare ?? c.wealthShare ?? (1 / classes.length);
                    c.baseWealthShare = c.wealthShare;
                }
            }
        
            if (firstTime) return;
        
            // ========== 每回合变化 ==========
            const coef = mech.coefficients || {};
            const baseRate = mech.baseRate ?? 0.005;
            const periodMult = period.wealthMultiplier ?? 1.0;
        
            // 平均政治力量
            let totalPower = 0;
            for (const c of classes) totalPower += c.politicalPower;
            const avgPower = totalPower / classes.length;
        
            // 所有制：集中度越高，财富越向高 power 阶级倾斜
            const ownershipCoef = (prod.ownership.concentration ?? 0.5) * (coef.ownershipConcentration ?? -0.5);
        
            // 分配：平等度越高，财富越向低 wealth 阶级倾斜
            const distributionCoef = (prod.distribution.equality ?? 0.5) * (coef.distributionEquality ?? 0.3);
        
            for (const c of classes) {
                // ① 政治力量偏差
                const powerBias = (c.politicalPower - avgPower) / 100;
        
                // ② 所有制影响：生产资料集中 → 高 power 阶级获益
                const ownershipBias = powerBias * ownershipCoef;
        
                // ③ 分配关系影响：平等度 → 低 wealth 阶级获益
                const wealthAvg = 1 / classes.length;
                const distributionBias = (wealthAvg - c.wealthShare) * distributionCoef;
        
                // ④ 综合变化量
                let delta = (powerBias * (coef.politicalBias ?? 0.5) + ownershipBias + distributionBias)
                            * baseRate * periodMult;
        
                // ⑤ 应用时期上限
                const cap = this._getWealthChangeCap(c, period);
                delta = Math.max(-cap, Math.min(cap, delta));
        
                // ⑥ 应用机制（再分配）
                delta += this._applyMechanisms(c, p, classes);
        
                // ⑦ 应用
                c.wealthShare = Math.max(0.01, c.wealthShare + delta);
        
                // 记录趋势
                c.wealthTrend = delta > 0.001 ? 1 : delta < -0.001 ? -1 : 0;
            }
        
            // 归一化
            let total = classes.reduce((s, c) => s + c.wealthShare, 0);
            for (const c of classes) c.wealthShare = c.wealthShare / total;
        },
        
        _getWealthChangeCap(cls, period) {
            // 优先从 period 读
            if (period.wealthChangeCap !== undefined) return period.wealthChangeCap;
            // 否则从 mechanisms 里找
            const p = this.ensurePolitics();
            for (const m of p.mechanics.mechanisms || []) {
                if (m.effect?.includes?.('wealthChangeCap')) {
                    const capM = String(m.effect).match(/wealthChangeCap\s*=\s*([\d.]+)/);
                    if (capM && m.trigger && this._evalTrigger(m.trigger, p)) {
                        return parseFloat(capM[1]);
                    }
                }
            }
            // 默认
            return 0.02;
        },
        
        _applyMechanisms(cls, p, classes) {
            let delta = 0;
            const sorted = classes.slice().sort((a, b) => b.wealthShare - a.wealthShare);
            const top = sorted.slice(0, Math.ceil(sorted.length / 3));
            const bottom = sorted.slice(-Math.ceil(sorted.length / 3));
        
            for (const m of p.mechanics?.mechanisms || []) {
                if (!this._evalTrigger(m.trigger, p)) continue;
                const eff = String(m.effect || '');
        
                // 解析每个 "target op value" 子句
                // 支持：highWealth / lowWealth / all
                // 支持：+= / -= / + / - / = 
                const clauses = eff.split(/[,，]/).map(s => s.trim()).filter(Boolean);
                for (const clause of clauses) {
                    const m2 = clause.match(/^(highWealth|lowWealth|all)\s*([+\-]?=|\+|\-)\s*([\d.]+)$/);
                    if (!m2) continue;
        
                    const target = m2[1];
                    const op = m2[2];
                    const value = parseFloat(m2[3]) || 0;
        
                    let applies = false;
                    if (target === 'highWealth') applies = top.includes(cls);
                    else if (target === 'lowWealth') applies = bottom.includes(cls);
                    else if (target === 'all') applies = true;
        
                    if (!applies) continue;
        
                    // op 解析
                    if (op === '+=' || op === '+') delta += value;
                    else if (op === '-=' || op === '-') delta -= value;
                    else if (op === '=') {
                        // 设置为某个值（罕见）
                        cls.wealthShare = value;
                    }
                }
            }
            return delta;
        },
        
        _evalTrigger(trigger, p) {
            if (!trigger) return true;
            try {
                // 安全替换：把 period.xxx 替换成实际值
                const expr = String(trigger)
                    .replace(/period/g, JSON.stringify(p.economy.period?.type || 'stable'))
                    .replace(/regime\.type/g, JSON.stringify(p.regime?.representative?.type || ''))
                    .replace(/ownership\.type/g, JSON.stringify(p.economy.production?.ownership?.type || ''))
                    .replace(/===/g, '===')
                    .replace(/includes\(/g, '.includes(');
                // eslint-disable-next-line no-new-func
                return Function(`"use strict";return (${expr})`)();
            } catch (e) {
                return false;
            }
        },

        computeLivingStandards() {
            const p = this.ensurePolitics();
            const eco = p.economy;
            const prod = eco.production || {};
            const productivity = prod.productivity || {};
        
            const totalWealth = eco.totalWealth;
            const totalPop = eco.totalPop || 1000000;
            const subsistence = p.rules?.livingFormula?.subsistence ?? 100;
        
            // ★ 生存线不做 tech 调整
            for (const c of Object.values(p.classes)) {
                const popAbs = c.pop * totalPop;
                const wealth = c.wealthShare * totalWealth;
                const perCapita = popAbs > 0 ? wealth / popAbs : 0;
                c.livingStandard = perCapita / subsistence;
                c.popAbs = popAbs;
        
                // ★ 计算期望
                c.aspiration = 1 + (productivity.tech || 0) / 100;
        
                // ★ 满意度 = 生活水平 / 期望
                c.satisfaction = c.livingStandard / c.aspiration;
            }
        },

        computeDiscontent() {
            const p = this.ensurePolitics();
            const rules = p.rules;
            const w = rules.discontentFormula?.weights || {};
            const enabled = rules.discontentFormula?.enabled || {};
            const classes = Object.values(p.classes);
        
            const ownership = p.economy.production?.ownership || {};
            const distribution = p.economy.production?.distribution || {};
            const legalNorm = p.economy.legalNorm || { strength: 0.5, nature: '过渡性' };
        
            const ownershipFairness = 1 - (ownership.concentration ?? 0.5);
            const distributionFairness = distribution.equality ?? 0.5;
            const fairness = (ownershipFairness + distributionFairness) / 2;
        
            const natureFactor = {
                '对立': +0.3,
                '过渡性': -0.1,
                '服务性': -0.3,
                '消失中': 0,
            }[legalNorm.nature] || 0;
            const legalNormImpact = natureFactor * (legalNorm.strength ?? 0.5);
        
            const exploitationDampen = 1 - fairness * 0.7;
            const deprivationDampen = 1 - fairness * 0.5;
        
            let avgLS = 0, totalPop = 0;
            for (const c of classes) {
                avgLS += (c.livingStandard || 1) * c.pop;
                totalPop += c.pop;
            }
            avgLS = totalPop > 0 ? avgLS / totalPop : 1;
        
            for (const c of classes) {
                const ls = c.livingStandard || 1;
                const aspiration = c.aspiration || 1.2;
                let score = 0;
        
                // ① 绝对贫困
                if (enabled.absolutePoverty && ls < 1) {
                    score += (1 - ls) * 120 * (w.absolutePoverty ?? 1.2);
                }
        
                // ② 相对剥夺
                if (enabled.relativeDeprivation && avgLS > ls) {
                    score += (avgLS - ls) * 40 * (w.relativeDeprivation ?? 0.4) * deprivationDampen;
                }
        
                // ③ 政治无权
                if (enabled.politicalGap) {
                    const expected = c.pop * 100;
                    if (c.politicalPower < expected) {
                        score += (expected - c.politicalPower) * 0.3 * (w.politicalGap ?? 0.3);
                    }
                }
        
                // ④ 剥削
                if (enabled.exploitation) {
                    const expected = c.pop;
                    if (c.wealthShare < expected) {
                        score += (expected - c.wealthShare) * 100 * (w.exploitation ?? 1.0) * exploitationDampen;
                    }
                }
        
                // ⑤ 历史惯性
                if (enabled.inertia) {
                    score += (c.discontent || 0) * (w.inertia ?? 0.3);
                }
        
                // ★ ⑥ 期望落差（新加）
                if (ls < aspiration) {
                    score += (aspiration - ls) * 25 * (w.aspirationGap ?? 0.5);
                }
        
                // 法权规范影响
                score += score * legalNormImpact;
        
                c.discontent = Math.min(100, Math.max(0, Math.round(score)));
                c.support = Math.max(0, 100 - c.discontent);
            }
        },

        computeClassConsciousness() {
            const p = this.ensurePolitics();
            const rules = p.rules;
            const f = rules.consciousnessFormula;
            if (!f || !f.enabled) {
                for (const c of Object.values(p.classes)) c.consciousness = 0;
                return;
            }
            const eduFactor = f.eduFactorBase + (p.economy.production.productivity.tech / 100) * f.eduFactorTechWeight;
            for (const c of Object.values(p.classes)) {
                c.consciousness = Math.min(100, Math.round(
                    (c.discontent || 0) * c.pop * eduFactor * f.multiplier
                ));
            }
        },

        // ---------- 每回合结算 ----------
        settlePoliticsTurn() {
            const p = this.ensurePolitics();
            const eco = p.economy;

            // 1. 生产力自然增长（按 rules.turnRules）
            for (const r of p.rules.turnRules || []) {
                if (r.field === 'tech') eco.production.productivity.tech = Math.max(0, Math.min(100, eco.production.productivity.tech + (r.op === 'add' ? r.value : -r.value)));
                else if (r.field === 'landYield') eco.production.productivity.landYield = Math.max(0, Math.min(200, eco.production.productivity.landYield + (r.op === 'add' ? r.value : -r.value)));
                else if (r.field === 'industry') eco.production.productivity.industry = Math.max(0, Math.min(100, eco.production.productivity.industry + (r.op === 'add' ? r.value : -r.value)));
            }

            // 2-6. 重新计算
            this.computeTotalWealth();
            this.computeWealthShares();
            this.computeLivingStandards();
            this.computeDiscontent();
            this.computeClassConsciousness();

            // 7. 记录
            eco.history.push({
                turn: this.ensureStore().turnCount,
                totalWealth: eco.totalWealth,
                classes: Object.values(p.classes).map(c => ({
                    name: c.name,
                    wealthShare: c.wealthShare,
                    livingStandard: c.livingStandard,
                    discontent: c.discontent,
                    consciousness: c.consciousness,
                })),
            });
            if (eco.history.length > 50) eco.history = eco.history.slice(-50);

            // 8. 检测危机
            return this.detectCrisis();
        },

        detectCrisis() {
            const p = this.ensurePolitics();
            const rules = p.rules;
            const cond = rules.rebellionRules?.conditions || {};
            const crises = [];

            for (const c of Object.values(p.classes)) {
                const dcMin = cond.discontent?.min ?? 70;
                const consMin = cond.consciousness?.min ?? 60;
                const popMin = cond.pop?.min ?? 0.2;

                if (c.discontent >= dcMin && (c.consciousness || 0) >= consMin && c.pop >= popMin) {
                    crises.push({
                        type: 'rebellion',
                        class: c.name,
                        severity: Math.round(c.discontent * (c.consciousness || 0) / 100),
                        desc: `${c.name}阶级揭竿而起`,
                    });
                } else if (c.discontent > 50 && c.pop > 0.1) {
                    crises.push({
                        type: 'unrest',
                        class: c.name,
                        severity: Math.round(c.discontent / 2),
                        desc: `${c.name}阶级怨声载道`,
                    });
                }
            }

            const groups = Object.values(p.interestGroups);
            for (const g of groups) {
                const factions = Object.values(g.factions);
                if (factions.length >= 2) {
                    const sorted = factions.slice().sort((a, b) => b.politicalPower - a.politicalPower);
                    const diff = sorted[0].politicalPower - sorted[sorted.length - 1].politicalPower;
                    if (diff < 5 && sorted[0].politicalPower > 20) {
                        crises.push({
                            type: 'faction_struggle',
                            group: g.name,
                            severity: 30,
                            desc: `${g.name}内部派系势均力敌`,
                        });
                    }
                }
            }

            const regimeSupport = this.getRegimeSupport();
            if (regimeSupport < 30) {
                crises.push({
                    type: 'legitimacy',
                    severity: Math.round(100 - regimeSupport),
                    desc: `统治合法性动摇，支持度 ${regimeSupport}`,
                });
            }

            return crises;
        },

        getRegimeSupport() {
            const p = this.ensurePolitics();
            let totalPower = 0;
            let weighted = 0;
            for (const g of Object.values(p.interestGroups)) {
                totalPower += g.politicalPower;
                weighted += g.politicalPower * g.support;
            }
            return totalPower > 0 ? Math.round(weighted / totalPower * 10) / 10 : 50;
        },

        getDominantGroups(topN = 3) {
            const p = this.ensurePolitics();
            return Object.values(p.interestGroups)
                .sort((a, b) => b.politicalPower - a.politicalPower)
                .slice(0, topN);
        },

        // ============================================================
        // 上下文注入
        // ============================================================
        formatForPrompt() {
            const store = this.ensureStore();
            if (!store.initialized) return '';
            const parts = [];

            const playerFaction = this.getPlayerFaction();
            if (playerFaction) {
                parts.push(`【我方势力】${playerFaction.icon} ${playerFaction.name}`);
                parts.push(`数据：${this._formatFactionFields(playerFaction)}`);
                if (playerFaction.relations && Object.keys(playerFaction.relations).length > 0) {
                    const rels = Object.entries(playerFaction.relations)
                        .map(([name, r]) => `${name}(${r.value} ${r.status})`)
                        .join('、');
                    parts.push(`关系：${rels}`);
                }
            }

            const others = this.getOtherFactions();
            if (others.length > 0) {
                parts.push(`【其他势力】`);
                for (const f of others) {
                    parts.push(`- ${f.icon} ${f.name}：${this._formatFactionFields(f)}`);
                }
            }

            const regions = this.getRegions();
            if (regions.length > 0) {
                parts.push(`【地区】`);
                for (const r of regions) {
                    parts.push(`- ${r.icon} ${r.name}：${this._formatRegionFields(r)}`);
                }
            }

            // 内政
            const p = this.ensurePolitics();
            if (p.initialized) {
                parts.push(`【内政·政治结构】`);
                if (p.regime.representative.name)
                    parts.push(`政治代表：${p.regime.representative.name}（${p.regime.representative.type}）`);
                if (p.regime.executive.name)
                    parts.push(`行政机构：${p.regime.executive.name}（${p.regime.executive.type}）`);
                if (p.regime.legitimacy) parts.push(`统治合法性：${p.regime.legitimacy}`);

                const dominants = this.getDominantGroups(3);
                if (dominants.length > 0) {
                    parts.push(`【内政·主要集团】`);
                    for (const g of dominants) {
                        parts.push(`- ${g.icon} ${g.name}：政治力量 ${g.politicalPower}，支持度 ${g.support}`);
                    }
                }
                parts.push(`【内政·统治支持度】${this.getRegimeSupport()}`);
            }

            return parts.join('\n');
        },

        // ============================================================
        // 重置
        // ============================================================
        reset() {
            const s = this.ensureStore();
            s.factions = {};
            s.regions = {};
            s.actions = [];
            s.rules = { raw: '', parsed: null };
            s.turnCount = 0;
            s.turnLog = [];
            s.initialized = false;
            s.politics = null;
            s.campaigns = [];
            s.bills = [];
            s.billHistory = [];
            s.diplomacyActions = {};
            s.politicsActions = [];
            s.classDemands = {};
            s.factionResolutions = {};
            s.ongoingCampaigns = [];
            s.militaryHistory = [];
            if (window.SaveManager) window.SaveManager.save();
        },
    };

    window.StrategyManager = StrategyManager;
    console.log('[CinemaWorld] strategy.js 已加载');
})();