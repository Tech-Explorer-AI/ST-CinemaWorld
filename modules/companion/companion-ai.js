// ============================================================
// CinemaWorld · companion/companion-ai.js
// AI 层：初始化 / 行动剧情 / 入队 / 离队 / 阶段剧情
//
// 依赖：core.js, world.js, player.js, story.js, ui.js（部分）
//       companion-core.js
// 暴露：window.CompanionAIManager
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const CharacterRegistry = window.CharacterRegistry;
    const PlayerStateManager = window.PlayerStateManager;

    const CompanionManager = window.CompanionManager;
    const BondManager = window.BondManager;
    const PROFILE_KEY_MAP = window.CompanionConstants?.PROFILE_KEY_MAP || {};

    const CompanionAIManager = {
        isGenerating: false,

        // ============================================================
        // 1. 初始化养成数据
        // ============================================================
        async initBondData(name) {
            if (this.isGenerating) return false;
            this.isGenerating = true;
            try {
                const record = CharacterRegistry.get(name);
                if (!record) return false;

                const worldCtx = window.StoryManager?.buildContext(null, {
                    parentStory: false,
                    mainChars: false,
                    scene: false,
                    interactionDigests: false,
                    volumes: true,
                    chapters: true,
                    pendingEvents: false,
                    companions: false,
                }) || '';

                const charBlock = this._buildCharBlock(record);

                const prompt = `你正在为视觉小说游戏设计一个"队友养成系统"。

【世界背景】
${worldCtx}

【队友档案】
${charBlock}

【任务】
为这个队友设计一套完整的档案 + 养成数据。它将决定这个角色在玩家身边的所有表现。

【输出格式】（严格遵守，七个区块都要写）

【信息位】
- 性别：（男 / 女 / 其他）
- 年龄：（数字或"看起来X岁"）
- 性格：（一句话概括，如"冷淡但心软"）
- 当前心情：（如"平静" / "疲惫" / "警惕"）
- 外貌：（发色发型、瞳色眼睛、体型、特征……一两句）
- 穿着：（当前穿的衣着，一两句）
- 背景故事：（2-4 句。他从哪来，经历过什么，为什么在这里）
- 健康状态：（正常 / 受伤 / 生病……）

（以上 7 个是约定字段，都要写。
 此外可以自由追加任何能让人物更真实的字段，比如：
 - 身高 ， - 体重 ， - 三围 ， - 爱好 ， - 口头禅 ， - 习惯 ， - 讨厌的东西……
  以上示例都需要写，以丰富角色的内容，当然还可以添加更多字段。）

【经历】
- 【经历的标题】：一段 2-3 句的经历概述。

（1-3 条。是角色【过往】的重要经历，不是和玩家的互动。）

【角色属性】
- 【键名|图标|描述】：初始 N（范围）

（角色属性。常见：HP、力量、敏捷、体质、灵力、魔力、意志、幸运……
 数值由角色的种族 / 职业 / 定位决定。
 不写范围 = 纯数值（如力量、敏捷）；写了范围 = 有软上限（如 HP 0~500）。
 ★ 角色属性【不受阶段锁限制】，可以随战斗成长。）

示例：
- 【HP|❤️|生命值】：初始 100（0~500）
- 【力量|💪|物理攻击强度】：初始 8
- 【敏捷|🏃|闪避与先攻】：初始 10
- 【体质|🛡️|防御与抗性】：初始 6

【养成属性】
- 【键名|图标|描述】：初始 N（范围）

（【养成属性。常见：好感度、符合世界观的能力属性、特殊属性，演员有演技，战士有武艺...诸如此类...）
 ★ 每个属性必须写范围，例如 (0~100) 或 (0~500)。
 ★ 养成属性【受阶段上限限制】，需要触发阶段剧情才能继续提升。
 ★ 至少写"好感度"。）

★ 如果这个角色有成长系统，建议加：
 - 【等级|⭐|角色成长等级】：初始 1（不写范围）
 - 【经验|✨|升级所需经验】：初始 0（不写范围）

示例：
- 【好感度|💗|她与你的关系深浅】：初始 10（0~500）
- 【等级|⭐|角色成长等级】：初始 1
- 【经验|✨|升级所需经验】：初始 0

【升级规则】
- 【属性名】：每级 N，最多 M 级
  - 1 级「名字」：描述
  - 2 级「名字」：描述
  ...
  （可选）升级奖励：属性名+N、属性名+N

（等级名和描述要贴合角色和世界观。满级后该属性不再涨。
 升级规则的 M × N 必须 ≤ 属性的范围上限，否则玩家永远到不了最高级。

 可以给【角色属性】或【养成属性】里任意需要等级的属性写。

 建议：
 - 【养成属性】的"好感度 / 经验"通常有等级
 - 【角色属性】通常没有等级，直接当数值用
 - 【等级】本身不需要升级规则（它的值由经验升级时增加）

 ★ 升级奖励：可选。写"升级时给其他属性加多少"。
   格式："升级奖励：目标属性+数值、目标属性+数值"
   典型用法：经验升级时给角色属性加成。
   例如经验每升 1 级，等级+1，HP+20，力量+2。）

示例：
- 【好感度】：每级 100，最多 5 级
  - 1 级「陌生」：客套的点头之交
  - 2 级「熟悉」：愿意聊些日常
  - 3 级「亲近」：愿意说心里话
  - 4 级「亲密」：把你当自己人
  - 5 级「挚爱」：心甘情愿

- 【经验】：每级 100，最多 20 级
  - 1 级「初出茅庐」：刚刚起步
  - 2 级「小有名气」：小有成就
  - 3 级「独当一面」：能独挑大梁
  - 4 级「身经百战」：经验丰富
  - 5 级「传奇」：名震一方
  升级奖励：等级+1、HP+20、力量+2、敏捷+1

【养成行动】
- 【id|名称|图标】：[描述:xxx|冷却:每天|消耗:体力×5|效果:属性名+N、属性名+N]

（3-5 个。冷却只填 "每天" / "每小时" / "无限制"。
 ★ 效果里的属性名可以是【角色属性】或【养成属性】里的任意属性，但是一般不会通过这里直接增加角色属性，特别是力量这些数值。
 ★ 如果角色有【经验】属性，行动的效果里可以加"经验+N"（N 在 10~30 之间），
   让角色通过日常互动慢慢成长。）

示例：
- 【chat|闲聊|💬】：[描述:找个地方坐下来聊聊|冷却:每天|消耗:体力×5|效果:好感度+5、经验+10]
- 【gift|送礼|🎁】：[描述:送她一件合心意的小礼物|冷却:每天|消耗:金钱×20|效果:好感度+10、经验+15]
- 【train|切磋|⚔️】：[描述:和她过过招|冷却:每天|消耗:体力×10|效果:默契+8、好感度+2、经验+30]


【阶段】

- 【id|名称】：[条件:属性名≥N级|上限:属性名=A、属性名=B|描述:一句话]

（3-4 个。从低到高排列。

 ★ 条件：支持等级（属性名≥N级）和数值（属性名≥N），可混合。
   第一个阶段条件填"好感度≥1级"。

 ★ 上限（可选）：本阶段该属性的最大值。超过会被"锁住"，直到进入下个阶段。
   - ★ 只对【养成属性】生效，【角色属性】不受上限限制
   - 建议上限 = 下个阶段的解锁门槛 × 1.2 ~ 1.5
   - 例如下阶段需要好感度≥2级（200），本阶段上限写 250 左右
   - 不写上限 = 不锁（属性可以一直涨到范围上限）
   - 上限只对本阶段生效，进入下阶段自动放开）

示例：
- 【stranger|初识】：[条件:好感度≥1级|上限:好感度=150|描述:还不太熟]
- 【friend|朋友】：[条件:好感度≥2级|上限:好感度=350、信任=80|描述:愿意跟你并肩]
- 【close|挚友】：[条件:好感度≥4级、信任≥50|上限:好感度=500|描述:性命相托]


【要求】

- 信息位要贴合世界背景和角色定位
- 经历是"过去"，不要写"今天遇到了玩家"
- 升级规则的等级名要有诗意，从陌生到深交
- 行动要有角色特色
- 消耗只从"体力 / 金钱"里选
- 效果数值 3~15 之间（经验的数值可以到 10~30）
- 阶段上限要合理，不要太低（卡死）也不要太高（无意义）

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'companion-init-bond');
                if (!result) return false;

                const parsed = this._parseBondData(result);
                if (!parsed) return false;

                const bond = BondManager.ensureBond(name);
                if (!bond) return false;

                BondManager.applyAIData(bond, parsed);
                bond._initialized = true;

                BondManager._log(bond, `📖 养成系统已建立`);
                CompanionManager.save();

                console.log(`[CompanionAI] ${name} 养成数据初始化完成`, parsed);
                return true;
            } catch (e) {
                console.error('[CompanionAI] initBondData 异常:', e);
                return false;
            } finally {
                this.isGenerating = false;
            }
        },

        // ============================================================
        // 2. 解析养成数据
        // ============================================================
        _parseBondData(text) {
            const sections = {};
            let current = null;
            for (const line of String(text).split('\n')) {
                const t = line.trim();
                const secMatch = t.match(/^【(.+?)】\s*$/);
                if (secMatch) {
                    current = secMatch[1].trim();
                    sections[current] = sections[current] || [];
                    continue;
                }
                if (current && t) sections[current].push(t);
            }

            const out = {
                profile: {
                    gender: '',
                    age: '',
                    personality: '',
                    mood: '',
                    appearance: '',
                    background: '',
                    status: '',
                    _extra: {},
                    _extraOrder: [],
                },
                experiences: [],
                stats: {},           // ★ 角色属性
                bondStats: {},       // ★ 养成属性
                levelRules: {},
                actions: [],
                stages: [],
            };

            // ---------- 信息位 ----------
            for (const line of (sections['信息位'] || [])) {
                const m = line.match(/^[-•]?\s*([^:：]+?)\s*[:：]\s*(.+)$/);
                if (!m) continue;
                const key = m[1].trim();
                const val = m[2].trim();
                if (!key || !val) continue;

                const mapped = PROFILE_KEY_MAP[key];
                if (mapped) {
                    out.profile[mapped] = val;
                } else {
                    out.profile._extra[key] = val;
                    if (!out.profile._extraOrder.includes(key)) {
                        out.profile._extraOrder.push(key);
                    }
                }
            }

            // ---------- 经历 ----------
            for (const line of (sections['经历'] || [])) {
                const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]?\s*(.+)$/);
                if (!m) continue;
                const title = m[1].trim();
                const text = m[2].trim();
                if (!title) continue;
                out.experiences.push({ title, text });
            }

            // ---------- ★ 角色属性 ----------
            const parseStatLine = (line) => {
                const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*(.+)$/);
                if (!m) return null;
                const meta = m[1].split('|').map(s => s.trim());
                const key = meta[0];
                const emoji = meta[1] || '·';
                const desc = meta[2] || '';
                const body = m[2];

                const rangeM = body.match(/[（(]?\s*(\d+)\s*[~\-]\s*(\d+)\s*[）)]?/);
                const initM = body.match(/初始\s*(\d+)/);

                return {
                    key,
                    value: initM ? parseInt(initM[1]) : 0,
                    min: 0,
                    max: rangeM ? parseInt(rangeM[2]) : null,
                    label: key,
                    emoji: emoji,
                    desc: desc,
                };
            };

            for (const line of (sections['角色属性'] || [])) {
                const s = parseStatLine(line);
                if (s) out.stats[s.key] = s;
            }

            // ---------- ★ 养成属性 ----------
            for (const line of (sections['养成属性'] || [])) {
                const s = parseStatLine(line);
                if (s) out.bondStats[s.key] = s;
            }

            // ---------- 升级规则 ----------
            const ruleLines = sections['升级规则'] || [];
            let curStat = null;

            for (const rawLine of ruleLines) {
                const line = rawLine.trim();
                if (!line) continue;

                // 属性头
                const headM = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*每级\s*(\d+)\s*[，,]\s*最多\s*(\d+)\s*级/);
                if (headM) {
                    curStat = headM[1].trim();
                    out.levelRules[curStat] = {
                        levelMax: parseInt(headM[2]),
                        maxLevel: parseInt(headM[3]),
                        levels: [],
                        onLevelUp: [],   // ★ 新增
                    };
                    continue;
                }

                if (curStat) {
                    // ★ 升级奖励
                    const rewardM = line.match(/^[-•]?\s*升级奖励\s*[:：]\s*(.+)$/);
                    if (rewardM) {
                        const parts = rewardM[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
                        for (const p of parts) {
                            const em = p.match(/^(.+?)\s*([+\-])\s*(\d+)$/);
                            if (em) {
                                out.levelRules[curStat].onLevelUp.push({
                                    target: em[1].trim(),
                                    delta: (em[2] === '-' ? -1 : 1) * parseInt(em[3]),
                                });
                            }
                        }
                        continue;
                    }

                    // 等级名
                    const lvM = line.match(/^[-•]?\s*(\d+)\s*级\s*[「"']([^」"']+)[」"']\s*[:：]?\s*(.*)$/);
                    if (lvM) {
                        out.levelRules[curStat].levels.push({
                            level: parseInt(lvM[1]),
                            name: lvM[2].trim(),
                            desc: (lvM[3] || '').trim(),
                        });
                    }
                }
            }

            // ---------- 养成行动 ----------
            for (const line of (sections['养成行动'] || [])) {
                const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*(.+)$/);
                if (!m) continue;
                const meta = m[1].split('|').map(s => s.trim());
                const id = meta[0];
                const name = meta[1] || id;
                const emoji = meta[2] || '⚡';
                const body = m[2];

                const bracketM = body.match(/[\[【]([^\]】]+)[\]】]/);
                if (!bracketM) continue;

                let desc = '', cooldown = 'daily';
                const cost = {};
                const effects = {};

                for (const f of bracketM[1].split('|')) {
                    const kv = f.match(/^(.+?)\s*[:：]\s*(.+)$/);
                    if (!kv) continue;
                    const k = kv[1].trim();
                    const v = kv[2].trim();

                    if (k === '描述') desc = v;
                    else if (k === '冷却') {
                        if (/小时/.test(v)) cooldown = 'hourly';
                        else if (/无|不/.test(v)) cooldown = 'none';
                        else cooldown = 'daily';
                    } else if (k === '消耗') {
                        for (const p of v.split(/[、,，]/)) {
                            const cm = p.match(/^(.+?)\s*[×xX*]\s*(\d+)$/);
                            if (cm) cost[cm[1].trim()] = parseInt(cm[2]);
                        }
                    } else if (k === '效果') {
                        for (const p of v.split(/[、,，]/)) {
                            const em = p.match(/^(.+?)\s*([+\-])\s*(\d+)$/);
                            if (em) {
                                effects[em[1].trim()] = (em[2] === '-' ? -1 : 1) * parseInt(em[3]);
                            }
                        }
                    }
                }

                out.actions.push({ id, name, emoji, desc, cost, effects, cooldown });
            }

            // ---------- 阶段 ----------
            for (const line of (sections['阶段'] || [])) {
                const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*(.+)$/);
                if (!m) continue;
                const meta = m[1].split('|').map(s => s.trim());
                const id = meta[0];
                const name = meta[1] || id;
                const body = m[2];

                const bracketM = body.match(/[\[【]([^\]】]+)[\]】]/);
                if (!bracketM) continue;

                let desc = '';
                const minStat = {};
                const caps = {};

                for (const f of bracketM[1].split('|')) {
                    const kv = f.match(/^(.+?)\s*[:：]\s*(.+)$/);
                    if (!kv) continue;
                    const k = kv[1].trim();
                    const v = kv[2].trim();

                    if (k === '描述') {
                        desc = v;
                    } else if (k === '条件') {
                        for (const p of v.split(/[、,，]/)) {
                            const lvM = p.match(/^(.+?)\s*[≥>=]+\s*(\d+)\s*级\s*$/);
                            if (lvM) {
                                const key = lvM[1].trim();
                                if (!minStat[key]) minStat[key] = {};
                                minStat[key].level = parseInt(lvM[2]);
                                continue;
                            }
                            const valM = p.match(/^(.+?)\s*[≥>=]+\s*(\d+)\s*$/);
                            if (valM) {
                                const key = valM[1].trim();
                                if (!minStat[key]) minStat[key] = {};
                                minStat[key].value = parseInt(valM[2]);
                            }
                        }
                    } else if (k === '上限') {
                        for (const p of v.split(/[、,，]/)) {
                            const kv2 = p.match(/^(.+?)\s*[=＝]\s*(\d+)$/);
                            if (kv2) {
                                caps[kv2[1].trim()] = parseInt(kv2[2]);
                            }
                        }
                    }
                }

                out.stages.push({ id, name, desc, minStat, caps });
            }

            // ★ 至少要有"养成属性"里的好感度
            if (Object.keys(out.bondStats).length === 0) return null;
            return out;
        },

        // ============================================================
        // 3. 生成行动剧情
        // ============================================================
        async generateActionStory(name, actionId) {
            if (this.isGenerating) return null;
            this.isGenerating = true;
            try {
                const record = CharacterRegistry.get(name);
                const bond = BondManager.getBond(name);
                const action = BondManager.getAction(bond, actionId);
                if (!record || !bond || !action) return null;

                const charBlock = this._buildCharBlock(record);
                const profileBlock = this._buildProfileBlock(bond);
                const bondBlock = this._buildBondBlock(bond);
                const playerBlock = PlayerStateManager.formatForPrompt();
                const interactionBlock = this._buildInteractionBlock(name);

                const worldCtx = window.StoryManager?.buildContext(null, {
                    parentStory: false,
                    mainChars: false,
                    scene: true,
                    interactionDigests: true,
                    volumes: false,
                    chapters: false,
                    pendingEvents: false,
                    companions: false,
                }) || '';

                const effectsText = Object.entries(action.effects || {})
                    .map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`)
                    .join('、');

                const prompt = `你正在为视觉小说游戏生成一段"队友养成互动"剧情。

【世界背景】
${worldCtx}

${playerBlock}

【队友档案】
${charBlock}

${profileBlock}

【当前养成状态】
${bondBlock}

${interactionBlock}

【本次互动】
类型：${action.emoji} ${action.name}
描述：${action.desc}
基础效果：${effectsText || '无'}

【任务】
生成一段 5-10 行的 VN 剧情，描述这次互动的过程。
- 要自然，像日常，不要像任务
- 要符合角色当前的关系阶段和心情
- 可以有打闹、吐槽、沉默、小情绪
- 不要让角色一上来就很亲热（关系没到）
- 结尾自然一点，不要强行升华

【输出格式】
每行：【角色名|显示/隐藏|左/中/右|性别|状态】: 内容
旁白：【旁白】: 内容

档案更新:（可选，剧情让角色的性格/心情/状态/外貌发生变化时才写）
- 字段名：新值

经历:（可选，这段互动值得长期记录时才写）
- 【标题】：2-3 句简述

【摘要】
（2-3 句。作为后续上下文）

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'companion-action-story');
                if (!result) return null;

                return result;
            } finally {
                this.isGenerating = false;
            }
        },

        // ============================================================
        // 4. 生成入队剧情
        // ============================================================
        async generateJoinStory(name) {
            if (this.isGenerating) return null;
            this.isGenerating = true;
            try {
                const record = CharacterRegistry.get(name);
                if (!record) return null;

                const charBlock = this._buildCharBlock(record);
                const playerBlock = PlayerStateManager.formatForPrompt();
                const interactionBlock = this._buildInteractionBlock(name);

                const worldCtx = window.StoryManager?.buildContext(null, {
                    parentStory: false,
                    mainChars: false,
                    scene: true,
                    interactionDigests: true,
                    volumes: false,
                    chapters: false,
                    pendingEvents: false,
                    companions: false,
                }) || '';

                const prompt = `你正在为视觉小说游戏生成一段"邀请 NPC 加入队伍"的剧情。

【世界背景】
${worldCtx}

${playerBlock}

【目标 NPC】
${charBlock}

${interactionBlock}

【任务】
生成一段 8-15 行的 VN 剧情，描述玩家邀请这个 NPC 一起行动的过程。

要求：
- 根据好感度/关系阶段，NPC 的回应要有区分度
- 要自然，不要像在发任务
- 可以有一段沉默、一个眼神、一句迟疑
- 结尾要明确表示"答应"或"拒绝"

【输出格式】
每行：【角色名|显示/隐藏|左/中/右|性别|状态】: 内容
旁白：【旁白】: 内容

结尾必须有一行（单独一行，无其他内容）：
RESULT: ACCEPT
或
RESULT: REJECT

【摘要】
（2-3 句。作为后续上下文）

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'companion-join-story');
                if (!result) return null;

                const resultM = result.match(/RESULT\s*[:：]\s*(ACCEPT|REJECT)/i);
                const accepted = resultM ? resultM[1].toUpperCase() === 'ACCEPT' : false;

                return { raw: result, accepted };
            } finally {
                this.isGenerating = false;
            }
        },

        // ============================================================
        // 5. 生成离队剧情
        // ============================================================
        async generateLeaveStory(name, reason = '') {
            if (this.isGenerating) return null;
            this.isGenerating = true;
            try {
                const record = CharacterRegistry.get(name);
                const bond = BondManager.getBond(name);
                if (!record || !bond) return null;

                const charBlock = this._buildCharBlock(record);
                const profileBlock = this._buildProfileBlock(bond);
                const bondBlock = this._buildBondBlock(bond);
                const playerBlock = PlayerStateManager.formatForPrompt();

                const prompt = `你正在为视觉小说游戏生成一段"队友离队"的剧情。

【玩家】
${playerBlock}

【队友档案】
${charBlock}

${profileBlock}

【当前养成状态】
${bondBlock}

【玩家说的理由】
${reason || '（没有明确理由）'}

【任务】
生成一段 6-12 行的 VN 剧情，描述这个队友离开队伍的过程。
- 要符合当前的关系阶段
- 可以不舍、可以洒脱、可以赌气
- 不要强行挽留，也不要强行离别
- 要留一点余韵（可能再见面）

【输出格式】
每行：【角色名|显示/隐藏|左/中/右|性别|状态】: 内容
旁白：【旁白】: 内容

【摘要】
（2-3 句。作为后续上下文）

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'companion-leave-story');
                if (!result) return null;

                return result;
            } finally {
                this.isGenerating = false;
            }
        },

        // ============================================================
        // 6. 生成阶段剧情
        // ============================================================
        async generateStageStory(name, stageId) {
            if (this.isGenerating) return null;
            this.isGenerating = true;
            try {
                const record = CharacterRegistry.get(name);
                const bond = BondManager.getBond(name);
                const stage = BondManager.getStage(bond, stageId);
                if (!record || !bond || !stage) return null;

                const charBlock = this._buildCharBlock(record);
                const profileBlock = this._buildProfileBlock(bond);
                const bondBlock = this._buildBondBlock(bond);
                const playerBlock = PlayerStateManager.formatForPrompt();
                const interactionBlock = this._buildInteractionBlock(name);

                const worldCtx = window.StoryManager?.buildContext(null, {
                    parentStory: false,
                    mainChars: false,
                    scene: true,
                    interactionDigests: true,
                    volumes: true,
                    chapters: true,
                    pendingEvents: false,
                    companions: false,
                }) || '';

                const prompt = `你正在为视觉小说游戏生成一段"关系阶段剧情"。

【世界背景】
${worldCtx}

${playerBlock}

【队友档案】
${charBlock}

${profileBlock}

【当前养成状态】
${bondBlock}

${interactionBlock}

【本次要进入的阶段】
${stage.name}：${stage.desc}

【任务】
生成一段 12-25 行的 VN 剧情，是玩家和这个角色关系的"里程碑"。
- 要有明确的"关系进展"的感觉
- 可以是某件小事，但意义不同
- 可以有一个小小的仪式感
- 不要过度煽情，要克制
- 结尾要让人感觉"从今天开始，不一样了"

【输出格式】
每行：【角色名|显示/隐藏|左/中/右|性别|状态】: 内容
旁白：【旁白】: 内容

档案更新:（可选）
- 字段名：新值

【摘要】
（3-4 句。作为长期上下文，会写入世界史）

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'companion-stage-story');
                if (!result) return null;

                return result;
            } finally {
                this.isGenerating = false;
            }
        },

        // ============================================================
        // 7. 上下文构建
        // ============================================================
        _buildCharBlock(record) {
            if (!record) return '（无档案）';
            const parts = [`名称：${record.name}`];
            if (record.gender) parts.push(`性别：${record.gender}`);
            if (record.mood) parts.push(`心情：${record.mood}`);
            if (record.status) parts.push(`状态：${record.status}`);
            if (record.description) parts.push(`简介：${record.description}`);
            if (record.tags?.length) {
                const tags = record.tags.map(t => typeof t === 'string' ? t : t.name).join('、');
                parts.push(`标签：${tags}`);
            }
            return parts.join('\n');
        },

        _buildProfileBlock(bond) {
            const p = bond?.profile;
            if (!p) return '';

            const rows = [];
            if (p.gender) rows.push(`- 性别：${p.gender}`);
            if (p.age) rows.push(`- 年龄：${p.age}`);
            if (p.personality) rows.push(`- 性格：${p.personality}`);
            if (p.mood) rows.push(`- 当前心情：${p.mood}`);
            if (p.appearance) rows.push(`- 外貌：${p.appearance}`);
            if (p.outfit) rows.push(`- 穿着：${p.outfit}`);
            if (p.status) rows.push(`- 健康状态：${p.status}`);

            for (const k of (p._extraOrder || [])) {
                if (p._extra?.[k]) rows.push(`- ${k}：${p._extra[k]}`);
            }

            if (p.background) rows.push(`- 背景故事：${p.background}`);

            const exps = (p.experiences || []).slice(-5);
            const expLines = exps.map(e => `- 【${e.title}】：${e.text}`);

            const parts = [];
            if (rows.length > 0) {
                parts.push(`【档案】\n${rows.join('\n')}`);
            }
            if (expLines.length > 0) {
                parts.push(`【重要经历】\n${expLines.join('\n')}`);
            }
            return parts.join('\n\n');
        },

        _buildBondBlock(bond) {
            if (!bond) return '（未初始化）';
            const parts = [];

            // ★ 角色属性
            if (bond.statsOrder?.length) {
                parts.push('【角色属性】');
                for (const key of bond.statsOrder) {
                    const s = bond.stats[key];
                    if (!s) continue;
                    const levelInfo = BondManager.getStatLevelInfo(bond, key);
                    let line = `- ${s.label || key}：${s.value}`;
                    if (levelInfo) {
                        line += `（Lv.${levelInfo.level}「${levelInfo.name}」/ 共 ${levelInfo.maxLevel} 级）`;
                    } else {
                        const hasMax = typeof s.max === 'number' && s.max > 0;
                        if (hasMax) line += `/${s.max}`;
                    }
                    if (s.emoji) line += ` ${s.emoji}`;
                    parts.push(line);
                }
            }

            // ★ 养成属性
            if (bond.bondStatsOrder?.length) {
                parts.push('【养成属性】');
                for (const key of bond.bondStatsOrder) {
                    const s = bond.bondStats[key];
                    if (!s) continue;
                    const levelInfo = BondManager.getStatLevelInfo(bond, key);
                    const cap = BondManager.getStatCap(bond, key);

                    let line = `- ${s.label || key}：${s.value}`;
                    if (levelInfo) {
                        line += `（Lv.${levelInfo.level}「${levelInfo.name}」/ 共 ${levelInfo.maxLevel} 级）`;
                    } else {
                        const hasMax = typeof s.max === 'number' && s.max > 0;
                        if (hasMax) line += `/${s.max}`;
                    }
                    if (cap !== null) {
                        line += ` [本阶段上限 ${cap}]`;
                    }
                    if (s.emoji) line += ` ${s.emoji}`;
                    parts.push(line);
                }
            }

            const cur = BondManager.getCurrentStage(bond);
            const next = BondManager.getPendingStage(bond);
            if (cur) parts.push(`\n【当前关系】${cur.name}：${cur.desc}`);
            if (next) {
                const cond = this._formatStageCondition(next.minStat || {});
                parts.push(`【可进入】${next.name}（${cond}）`);
            }

            const ms = (bond.milestones || []).slice(-3);
            if (ms.length > 0) {
                parts.push('\n【近期里程碑】');
                for (const m of ms) {
                    parts.push(`- ${m.title}`);
                }
            }

            return parts.join('\n');
        },

        _formatStageCondition(minStat) {
            const parts = [];
            for (const [k, cond] of Object.entries(minStat)) {
                const sub = [];
                if (cond.level !== undefined) sub.push(`Lv.${cond.level}`);
                if (cond.value !== undefined) sub.push(`≥${cond.value}`);
                parts.push(`${k} ${sub.join(' 且 ')}`);
            }
            return parts.join('、') || '无';
        },

        _buildInteractionBlock(name) {
            const ctx = window.StoryManager?.buildContext(null, {
                world: false, worldHistory: false,
                volumes: false, chapters: false, chapter: false,
                parentStory: false, scene: false,
                mainChars: false, pendingEvents: false,
                interactionDigests: true,
                companions: false,
                digestFilter: {
                    characters: true,
                    sceneItems: false,
                    inventoryItems: false,
                    sceneActions: false,
                    characterFilter: 'onlySelf',
                    targetName: name,
                },
            }) || '';

            if (!ctx.trim()) return '';

            const lines = ctx.split('\n');
            const out = [];
            let skipping = true;
            for (const line of lines) {
                const t = line.trim();
                if (skipping) {
                    if (!t || /^【本章交互历史】/.test(t) || /^【本章与角色的交互】/.test(t)) continue;
                    skipping = false;
                }
                out.push(line);
            }
            const body = out.join('\n').trim();
            if (!body) return '';
            return `【与玩家的近期互动】\n${body}`;
        },
    };

    window.CompanionAIManager = CompanionAIManager;
    console.log('[CinemaWorld/companion] companion-ai.js 已加载');
})();