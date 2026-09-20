// ============================================================
// CinemaWorld · simulation.js
// 模拟经营：AI 生成 / 运行时引擎 / 界面
// 依赖：core.js, world.js, player.js
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const WorldManager = window.WorldManager;
    const PlayerStateManager = window.PlayerStateManager;

    // ============================================================
    // 模拟经营内容生成器
    // ============================================================
    const SimulationGenerator = {
        async generate(entityName, type, guide = '') {
            const scene = window.LocationModalManager.currentLocation;
            const playerBlock = PlayerStateManager.formatForPrompt();
            const worldCtx = window.StoryManager.buildContext(null, {
                parentStory: false, mainChars: false, scene: true,
                interactionDigests: false, volumes: false, chapters: false,
                pendingEvents: false,
            });

            const prompt = `你正在为视觉小说游戏设计一个「模拟经营」场景实体。

【世界背景】
${worldCtx}

${playerBlock}

【实体信息】
名称：${entityName}
经营类型：${type}
${guide ? `额外要求：${guide}` : ''}

━━━ 任务 ━━━
设计一个 ${type} 的完整经营系统。

━━━ 输出格式（严格遵守！必须包含所有区块） ━━━

【格子模板】
字段名:初始值:最小值:最大值
（每行一个。例如 肥力:5:0:20）
（字段名、数量、上下限完全由你根据经营类型决定。3-6 个字段）

【槽位类型】
- 槽位名|图标|完成标签|进行标签|模式
（1-3 个。模式只能是以下三种之一：
  grow=生长型（投入后经过时间长大，产出物品。如作物、养殖）
  consume=消耗型（投入后随时间被消耗，自动加钱。如商店、自动贩卖机）
 例如：作物|🌱|成熟|生长中|grow）

【行为】
- 【行为名|图标】：一句话说明，[目标:cell|消耗:体力:2|效果:湿度+15|冷却:3]
（4-8 个。目标只能是 cell（任意格）、slot（有东西的格）、empty（空格子）
 消耗和效果的格式：键:值 或 键+值 / 键-值，用 | 分隔多个）
（★ 特殊行为：繁殖 → 目标必须写 slot；宰杀 → 目标必须写 slot）

【时间规则】
字段名 每N秒 ±值
（每行一条。例如：湿度 每8秒 -1）

【完成规则】
槽位名: 高产条件: 字段≥X 且 字段≥X | 普产条件: 字段≥X | 倍率: 2/1.0/0.5
（每个槽位类型定义一条）

【环境规则】
根据当前场景的环境数据，生成"环境如何影响这个经营系统"的规则。
当前环境数据：${WorldManager.getEnvDataText(scene)}

输出格式（每行一条）：
- [环境条件] → [效果]

环境条件写法：
  键名 = 值        （精确匹配）
  键名 包含 值     （模糊匹配）
  键名 > 数字      （数值比较）
  键名 < 数字

效果写法：
  字段 +N/秒        （某个格子字段按秒增减）
  字段衰减 ×N       （字段的自然衰减倍率）
  生长 ×N           （grow 槽位进度倍率）
  销售速度 ×N           （consume 槽位速度倍率）
  产量 ×N           （产出物数量倍率）
  消耗 ×N           （成本/消耗倍率）

示例：
- 天气 包含 雨 → 湿度 +2/秒
- 时间 包含 夜 → 生长 ×10
- 时间 包含 白天 → 销售速度 ×0.5
- 风力 > 6 → 产量 ×1.2
- 湿度 > 80 → 湿度衰减 ×0.3
- 温度 < 5 → 生长 ×0.5

（例如有的植物，白天生长速度，那就倍率低，夜晚生长速度慢，那就倍率高...总之，规则要符合直觉，符合背景以及剧情）

【内容物】
（★★★ 最重要的一段，必须严格遵守格式 ★★★）

━━━ grow 型槽位的内容物 ━━━
必须成对定义"投入品"和"产出物"两条：

- 【种子/幼苗名|图标】：描述，[类型:槽位名|耗时:Xs|高产条件:肥力≥X,湿度≥X|产出:产出物名×Y|货币种类:X|售价:X|回收价:X]
- 【产出物名|图标】：产出物的完整描述，[类型:产物|货币种类:X|售价:X|回收价:X|效果:体力+X|描述:可食用]

━━━ consume 型槽位的内容物 ━━━
只需要定义商品，不需要写"产出"字段：

- 【商品名|图标】：描述，[类型:槽位名|货币种类:X|售价:X|回收价:X|销售次数:20|销售速度:20s|进价:3]

★ "销售次数" = 上架后能卖几次，不是玩家买到手多少个。
  玩家买 1 件商品 = 得到 1 个"销售单元"，上架后从销售次数开始递减。
★ 不要用"库存"这个词，用"销售次数"。

━━━ 牧场类（grow 型 + 牲畜）━━━

牲畜类物品有特殊的字段：
- 生长时间：从幼年到成年的时间
- 成年后：长大后变成什么物品（必须也在 stocks 里定义）
- 副产品：成年后持续产出，格式 "物品名:间隔秒数:每次数量"，多个用逗号分隔
- 繁殖产出：生出什么（幼崽物品名）
- 繁殖冷却：多少秒才能再繁殖一次
- 宰杀产出：宰杀时的掉落，格式 "物品名×数量"，多个用逗号分隔

★ 牧场关键点：
  1. 繁殖行为必须是目标 slot 型（对成年动物使用）
  2. 繁殖需要有空闲格子，系统会自动在空格生成幼崽
  3. 副产品和主进度并行，牛长大不影响产奶
  4. 宰杀会清空格子，所以不能反悔
  5. 牲畜类的"槽位类型"必须包含"成年后"字段用于区分幼年/成年
【内容物】（牲畜类完整格式）

- 【幼崽名|图标】：描述，[类型:牲畜|货币种类:X|生长时间:Xs|成年后:成年体名|售价:X|回收价:X]
- 【成年体名|图标】：描述，[类型:牲畜|货币种类:X|副产品:产物名:Xs:Y,产物名:Xs:Y|繁殖产出:幼崽名|繁殖冷却:Xs|宰杀产出:物品名×Y,物品名×Y|售价:X|回收价:X]
- 【饲料|图标】：描述，[类型:商品|货币种类:X|销售次数:X|销售速度:Xs|进价:X|售价:X|回收价:X]
- 【副产品1|图标】：描述，[类型:产物|货币种类:X|售价:X|回收价:X|效果:X]
- 【副产品2|图标】：描述，[类型:产物|货币种类:X|售价:X|回收价:X|效果:X]
- 【宰杀产物1|图标】：描述，[类型:产物|货币种类:X|售价:X|回收价:X]
- 【宰杀产物2|图标】：描述，[类型:产物|货币种类:X|售价:X|回收价:X]

━━━ ★★★ 内容物约束（违反会导致玩家收到"空壳物品"）★★★ ━━━
0. 产出物的数值设计：回收价 * 产出 一定要比售价高（不然为什么搞赔钱的呢？），回收价低的，产量要高，回收价高的，产量可以低，也可以解锁高价值作物。
1. 凡是出现在"产出:XXX"里的 XXX，必须作为独立条目在内容物里定义
2. 产出物必须有：图标、类型（写"产物"）、描述、售价
3. 产出物的属性应该符合世界观（食材、材料、道具、装备…）
4. 商店类型（consume）不需要产出物
5. 4-8 个内容物条目，覆盖整个经营循环
6. 牧场类必须包含：幼崽、成年体、饲料、副产品、宰杀产物

请生成：`;

            const result = await window.generateFunctionalReply(prompt, 'simulation-generation');
            if (!result) return null;

            const sim = this._parse(result, type);
            sim.cells = [];
            const tpl = sim.cellTemplate;
            for (let i = 0; i < 25; i++) {
                sim.cells.push({
                    id: `cell_${i}`,
                    fields: { ...tpl.fields },
                    _order: [...tpl._order],
                    slot: null,
                    meta: {},
                });
            }
            return sim;
        },

        _parse(text, type) {
            const sim = {
                initialized: true,
                type,
                cellTemplate: { fields: {}, _order: [], bounds: {} },
                slotTypes: {},
                cells: [],
                actions: [],
                rules: { time: [], completion: [] },
                stocks: [],
                envRules: [], 
                lastTick: Date.now(),
            };

            const lines = String(text || '').split('\n').map(l => l.trim());
            const sections = {};
            let current = null;
            for (const line of lines) {
                const secMatch = line.match(/^【(.+?)】\s*$/);
                if (secMatch) {
                    current = secMatch[1].trim();
                    sections[current] = sections[current] || [];
                    continue;
                }
                if (current) sections[current].push(line);
            }

            // ---------- 格子模板 ----------
            for (const line of (sections['格子模板'] || [])) {
                if (!line) continue;
                const m = line.match(/^([^:：]+)[:：]\s*([^:：]+?)(?:[:：]\s*([^:：]+?)[:：]\s*([^:：]+?))?\s*$/);
                if (!m) continue;
                const key = m[1].trim();
                const val = m[2].trim();
                sim.cellTemplate.fields[key] = val;
                sim.cellTemplate._order.push(key);
                if (m[3] !== undefined && m[4] !== undefined) {
                    const lo = parseFloat(m[3]);
                    const hi = parseFloat(m[4]);
                    if (!isNaN(lo) && !isNaN(hi)) sim.cellTemplate.bounds[key] = [lo, hi];
                }
            }

            // ---------- 槽位类型 ----------
            for (const line of (sections['槽位类型'] || [])) {
                if (!line || !line.startsWith('-')) continue;
                const m = line.match(/^-\s*([^|]+)\|([^|]+)\|([^|]+)(?:\|([^|]+))?(?:\|([^|]+))?/);
                if (!m) continue;
                const slotName = m[1].trim();
                sim.slotTypes[slotName] = {
                    icon: m[2].trim(),
                    doneLabel: m[3].trim(),
                    runningLabel: (m[4] || '进行中').trim(),
                    mode: (m[5] || 'grow').trim().toLowerCase(),
                };
            }

            // ---------- 行为 ----------
            for (const line of (sections['行为'] || [])) {
                if (!line || !line.startsWith('-')) continue;
                const a = this._parseAction(line);
                if (a) sim.actions.push(a);
            }

            // ---------- 时间规则 ----------
            for (const line of (sections['时间规则'] || [])) {
                if (!line) continue;
                const m = line.match(/^(\S+?)\s*每\s*(\d+)\s*秒\s*([+\-])\s*(\d+)/);
                if (!m) continue;
                sim.rules.time.push({
                    key: m[1].trim(),
                    interval: parseInt(m[2]),
                    delta: (m[3] === '-' ? -1 : 1) * parseInt(m[4]),
                });
            }

            // ---------- 完成规则 ----------
            for (const line of (sections['完成规则'] || [])) {
                if (!line) continue;
                const m = line.match(/^(\S+?)\s*[:：]\s*(.+)$/);
                if (!m) continue;
                const slotType = m[1].trim();
                const body = m[2];
                const rule = {
                    slotType, high: [], normal: [],
                    multipliers: { high: 1.5, normal: 1.0, low: 0.5 },
                };
                const highM = body.match(/高产条件\s*[:：]\s*([^|]+?)(?=\s*[|｜]|$)/);
                if (highM) rule.high = this._parseConditions(highM[1]);
                const normalM = body.match(/普产条件\s*[:：]\s*([^|]+?)(?=\s*[|｜]|$)/);
                if (normalM) rule.normal = this._parseConditions(normalM[1]);
                const multM = body.match(/倍率\s*[:：]\s*([\d.\s\/]+)/);
                if (multM) {
                    const nums = multM[1].split('/').map(s => parseFloat(s.trim()));
                    if (!isNaN(nums[0])) rule.multipliers.high = nums[0];
                    if (!isNaN(nums[1])) rule.multipliers.normal = nums[1];
                    if (!isNaN(nums[2])) rule.multipliers.low = nums[2];
                }
                sim.rules.completion.push(rule);
            }

            // 解析【环境规则】
            for (const line of (sections['环境规则'] || [])) {
                if (!line.startsWith('-')) continue;
                const m = line.match(/^-\s*(.+?)\s*→\s*(.+)$/);
                if (!m) continue;

                const when = this.parseEnvCondition(m[1].trim());      // ★ this.
                const effect = this.parseEnvEffect(m[2].trim());        // ★ this.
                if (!when || !effect) continue;

                sim.envRules.push({
                    id: `envrule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    when,
                    effect,
                    active: false,
                });
            }

            // ---------- 内容物 ----------
            for (const line of (sections['内容物'] || [])) {
                if (!line || !line.startsWith('-')) continue;
                const cleaned = line.replace(/^-\s*/, '').replace(/\s*\+\s*$/, '');
                const item = WorldManager.parseItemLine(cleaned);
                if (item && item.name) sim.stocks.push(item);
            }

            // ---------- 校验：产出物是否齐全 ----------
            const definedNames = new Set(sim.stocks.map(s => s.name));
            const missingOutputs = new Set();

            for (const item of sim.stocks) {
                const outStr = item.fields?.产出 || '';
                for (const p of outStr.split(/[，,、\s]+/).filter(Boolean)) {
                    const m = p.match(/^(.+?)[×xX*](\d+)$/);
                    const name = m ? m[1].trim() : p.trim();
                    if (name && !definedNames.has(name)) missingOutputs.add(name);
                }

                const adultName = item.fields?.成年后;
                if (adultName && !definedNames.has(String(adultName).trim())) {
                    missingOutputs.add(String(adultName).trim());
                }

                const sec = item.fields?.副产品;
                if (sec) {
                    for (const p of String(sec).split(/[，,、]/)) {
                        const m = p.match(/^(.+?)[:：]/);
                        if (m && !definedNames.has(m[1].trim())) {
                            missingOutputs.add(m[1].trim());
                        }
                    }
                }

                const offName = item.fields?.繁殖产出;
                if (offName && !definedNames.has(String(offName).trim())) {
                    missingOutputs.add(String(offName).trim());
                }

                const sl = item.fields?.宰杀产出;
                if (sl) {
                    for (const p of String(sl).split(/[，,、]/)) {
                        const m = p.match(/^(.+?)[×xX*](\d+)$/);
                        const name = m ? m[1].trim() : p.trim();
                        if (name && !definedNames.has(name)) missingOutputs.add(name);
                    }
                }
            }

            for (const name of missingOutputs) {
                console.warn(`[SimulationGenerator] 产出物"${name}"未定义，自动创建兜底条目`);
                sim.stocks.push({
                    name,
                    icon: '📦',
                    description: `（自动生成）${name}`,
                    fields: {
                        类型: '产物',
                        售价: '5',
                        描述: `来自${type}的产出`,
                    },
                    interactions: [],
                    type: 'item',
                    count: 1,
                });
            }

            console.log('[SimulationGenerator] 解析结果:', {
                cellTemplate: sim.cellTemplate._order,
                slotTypes: Object.keys(sim.slotTypes).map(k => `${k}(${sim.slotTypes[k].mode})`),
                actions: sim.actions.length,
                timeRules: sim.rules.time.length,
                completionRules: sim.rules.completion.length,
                stocks: sim.stocks.length,
                autoFixedOutputs: Array.from(missingOutputs),
            });

            return sim;
        },

        _parseAction(line) {
            const m = line.match(/^-\s*【(.+?)】\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;
            const parts = m[1].split('|').map(s => s.trim());
            const action = {
                id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: parts[0] || '行为',
                icon: parts[1] || '⚡',
                hint: '',
                target: 'cell',
                cost: {},
                effects: [],
                cooldown: 0,
                special: null,
            };

            if (/繁殖|生育|产仔|配种/.test(action.name)) action.special = 'breed';
            else if (/宰杀|屠宰|宰了|杀/.test(action.name)) action.special = 'slaughter';

            let rest = m[2].trim();
            const bracket = rest.match(/[\[【]([^\]】]+)[\]】]/);
            if (bracket) {
                rest = rest.replace(bracket[0], '').trim();
                for (const f of bracket[1].split('|')) {
                    const kv = f.match(/^(.+?)\s*[:：]\s*(.+)$/);
                    if (!kv) continue;
                    const k = kv[1].trim();
                    const v = kv[2].trim();
                    if (k === '目标') action.target = v;
                    else if (k === '冷却') action.cooldown = parseInt(v) || 0;
                    else if (k === '消耗') Object.assign(action.cost, this._parseKV(v));
                    else if (k === '效果') {
                        for (const [key, val] of Object.entries(this._parseKV(v))) {
                            action.effects.push({ type: 'fieldDelta', key, value: val });
                        }
                    }
                }
            }
            action.hint = rest.replace(/^[，,。、\s]+/, '').trim();
            return action;
        },

        _parseKV(str) {
            const out = {};
            if (!str) return out;
            for (const p of String(str).split(/[，,、\s]+/).filter(Boolean)) {
                let m = p.match(/^(.+?)\s*[:：]\s*([+\-]?\d+(?:\.\d+)?)$/);
                if (m) { out[m[1].trim()] = parseFloat(m[2]); continue; }
                m = p.match(/^(.+?)\s*([+\-])\s*(\d+(?:\.\d+)?)$/);
                if (m) out[m[1].trim()] = (m[2] === '-' ? -1 : 1) * parseFloat(m[3]);
            }
            return out;
        },

        _parseConditions(str) {
            const out = [];
            if (!str) return out;
            for (const p of String(str).split(/\s*(?:且|&&|and|,|，|、)\s*/).filter(Boolean)) {
                const m = p.match(/^(\S+?)\s*(≥|>=|>|≤|<=|<|=|==)\s*(-?\d+(?:\.\d+)?)/);
                if (m) out.push({ key: m[1].trim(), op: m[2], value: parseFloat(m[3]) });
            }
            return out;
        },
        // ============================================================
        // ★ 解析环境规则：条件部分
        // 支持写法：
        //   键名 = 值         精确匹配
        //   键名 == 值
        //   键名 包含 值       模糊匹配
        //   键名 > 数字
        //   键名 >= 数字
        //   键名 < 数字
        //   键名 <= 数字
        // 返回：{ key, op, value } 或 null
        // ============================================================
        parseEnvCondition(text) {
            if (!text) return null;
            const s = String(text).trim();

            // 包含
            let m = s.match(/^(\S+?)\s*包含\s*(.+)$/);
            if (m) {
                return { key: m[1].trim(), op: 'contains', value: m[2].trim() };
            }

            // 比较运算符
            m = s.match(/^(\S+?)\s*(>=|<=|==|=|>|<)\s*(.+)$/);
            if (m) {
                const key = m[1].trim();
                let op = m[2];
                let value = m[3].trim();

                // 归一化 == 和 =
                if (op === '==') op = '=';

                // 数值比较时把 value 转成数字
                if (['>', '>=', '<', '<='].includes(op)) {
                    const n = parseFloat(value.replace(/[^\d.\-]/g, ''));
                    if (isNaN(n)) return null;
                    value = n;
                }

                return { key, op, value };
            }

            return null;
        },

        // ============================================================
        // ★ 解析环境规则：效果部分
        // 支持写法：
        //   字段 +N/秒           → fieldInterval
        //   字段 -N/5秒
        //   字段 衰减 ×N         → fieldModifier
        //   生长 ×N              → timeScale（target=grow）
        //   生长 ×N（夜间）       → timeScale（target=grow）  ← 括号内容忽略
        //   售卖 ×N              → consumeModifier（target=consume）
        //   产量 ×N              → outputMultiplier
        //   消耗 ×N              → consumeModifier（同售卖）
        // 返回：effect 对象 或 null
        // ============================================================
        parseEnvEffect(text) {
            if (!text) return null;
            // 去掉末尾括号注释（如 "生长 ×10（夜间）"）
            let s = String(text).trim().replace(/[（(][^）)]*[）)]\s*$/, '').trim();

            // ---------- 1. 字段 +N/秒 类型 ----------
            // 匹配：字段名 +3/秒、字段名 -2/5s、字段名 +1/分钟
            let m = s.match(/^(\S+?)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*\/\s*(\d*)\s*(秒|s|分|min|分钟)?$/i);
            if (m) {
                const field = m[1].trim();
                const sign = m[2] === '-' ? -1 : 1;
                const delta = sign * parseFloat(m[3]);
                const intervalNum = m[4] ? parseInt(m[4]) : 1;
                const unit = m[5] || '秒';
                const interval = /分|min/i.test(unit)
                    ? intervalNum * 60
                    : intervalNum;

                return {
                    type: 'fieldInterval',
                    field,
                    delta,
                    interval: Math.max(1, interval),
                };
            }

            // ---------- 2. ×N 类型（倍率） ----------
            // 匹配：xxx ×N 或 xxx ×N.N
            m = s.match(/^(.+?)\s*[×xX*]\s*(\d+(?:\.\d+)?)$/);
            if (m) {
                const label = m[1].trim();
                const mult = parseFloat(m[2]);
                if (isNaN(mult) || mult <= 0) return null;

                // 归一化 label → type/target
                // 生长 / 成长 / 作物 / grow
                if (/生长|成长|作物|grow/i.test(label)) {
                    return { type: 'timeScale', target: 'grow', multiplier: mult };
                }
                // 牲畜 / 繁殖 / 养殖
                if (/牲畜|繁殖|养殖|breed/i.test(label)) {
                    return { type: 'timeScale', target: 'grow', multiplier: mult };
                }
                // 售卖 / 销售 / 消耗 / consume
                if (/售卖|销售|消耗|销售速度|consume/i.test(label)) {
                    return { type: 'consumeModifier', target: 'consume', multiplier: mult };
                }
                // 产量 / 产出 / 收获
                if (/产量|产出|收获|output/i.test(label)) {
                    return { type: 'outputMultiplier', multiplier: mult };
                }
                // 衰减 / decay
                if (/衰减|decay/i.test(label)) {
                    // 需要字段名，如 "湿度 衰减 ×0.3"
                    // 这里 label 里已经吞了，回退处理
                    return null;
                }
                // 无法识别 → 忽略
                return null;
            }

            // ---------- 3. 字段 衰减 ×N ----------
            m = s.match(/^(\S+?)\s*衰减\s*[×xX*]\s*(\d+(?:\.\d+)?)$/);
            if (m) {
                const field = m[1].trim();
                const mult = parseFloat(m[2]);
                if (isNaN(mult) || mult <= 0) return null;
                return { type: 'fieldModifier', field, multiplier: mult };
            }

            // 没识别出来
            return null;
        },
    };

    // ============================================================
    // 模拟经营运行时引擎
    // ============================================================
    const SimulationEngine = {
        _timer: null,
        _activeEntityName: null,
        OFFLINE_CAP_SEC: 3600,
        SECONDARY_CAP: 99,

        start(entityName) {
            this._activeEntityName = entityName;
        
            const entity = this._resolveEntity(entityName);
            if (entity?.simulation) {
                const sim = entity.simulation;
        
                // ★ 旧存档兜底：补 envRules
                if (!Array.isArray(sim.envRules)) {
                    sim.envRules = [];
                }
        
                // ★ 启动时立刻评估一次环境
                const scene = window.LocationModalManager?.currentLocation;
                if (scene) this.reevaluateEnvRules(sim, scene);
        
                const now = Date.now();
                const elapsed = Math.min(
                    Math.floor((now - (sim.lastTick || now)) / 1000),
                    this.OFFLINE_CAP_SEC
                );
                if (elapsed > 5) {
                    this._applyElapsed(sim, elapsed, true);
                    sim.lastTick = now;
                }
            }
        
            if (this._timer) clearInterval(this._timer);
            this._timer = setInterval(() => this.tick(), 1000);
        },

        stop() {
            if (this._timer) clearInterval(this._timer);
            this._timer = null;

            const entity = this._resolveEntity(this._activeEntityName);
            if (entity?.simulation) {
                this._flushPending(entity.simulation);
                entity.simulation.lastTick = Date.now();
            }

            this._activeEntityName = null;
        },

        tick() {
            const entityName = this._activeEntityName;
            if (!entityName) return;
            const entity = this._resolveEntity(entityName);
            if (!entity?.simulation) return;
            const sim = entity.simulation;
        
            const now = Date.now();
            const elapsed = Math.floor((now - (sim.lastTick || now)) / 1000);
            if (elapsed <= 0) { sim.lastTick = now; return; }
        
            // ★ 环境规则：每秒重新评估一次（开销可忽略）
            //    因为场景可能在别处被改了环境数据，我们这里兜底。
            const scene = window.LocationModalManager?.currentLocation;
            if (scene) this.reevaluateEnvRules(sim, scene);
        
            const changed = this._applyElapsed(sim, elapsed, false);
            sim.lastTick = now;
        
            if (changed) {
                SimulationUIManager.refresh();
                if (window.SaveManager) window.SaveManager.save();
            }
        },
        // ============================================================
        // ★ 环境规则：条件匹配
        // ============================================================
        _matchEnvCondition(cond, env) {
            if (!cond || !env) return false;

            const val = env[cond.key];
            if (val === undefined || val === '') return false;

            switch (cond.op) {
                case '=':
                case '==':
                    return String(val).trim() === String(cond.value).trim();

                case 'contains':
                    return String(val).includes(String(cond.value));

                case '>':
                case '>=':
                case '<':
                case '<=': {
                    const a = parseFloat(String(val).replace(/[^\d.\-]/g, ''));
                    const b = parseFloat(cond.value);
                    if (isNaN(a) || isNaN(b)) return false;
                    if (cond.op === '>')  return a >  b;
                    if (cond.op === '>=') return a >= b;
                    if (cond.op === '<')  return a <  b;
                    if (cond.op === '<=') return a <= b;
                    return false;
                }

                case 'range': {
                    const a = parseFloat(String(val).replace(/[^\d.\-]/g, ''));
                    if (isNaN(a)) return false;
                    return a >= cond.min && a <= cond.max;
                }
            }
            return false;
        },

        // ============================================================
        // ★ 环境规则：重新评估所有规则的 active 状态
        // ============================================================
        reevaluateEnvRules(sim, scene) {
            if (!sim?.envRules?.length) return;

            const env = scene?.environmentData;
            if (!env) {
                sim.envRules.forEach(r => { r.active = false; });
                return;
            }

            let changed = false;
            for (const rule of sim.envRules) {
                const before = !!rule.active;
                rule.active = this._matchEnvCondition(rule.when, env);
                if (before !== rule.active) {
                    changed = true;
                    const label = this._formatEnvRuleLabel(rule);
                    this._log(sim, rule.active
                        ? `✅ 环境规则生效：${label}`
                        : `⛔ 环境规则失效：${label}`);
                }
            }
            return changed;
        },

        // 格式化规则标签（给日志和 UI 用）
        _formatEnvRuleLabel(rule) {
            const when = rule.when;
            let condText = '';
            switch (when.op) {
                case '=': case '==': condText = `${when.key} = ${when.value}`; break;
                case 'contains':     condText = `${when.key} 包含 ${when.value}`; break;
                default:             condText = `${when.key} ${when.op} ${when.value}`; break;
            }

            const eff = rule.effect;
            let effText = '';
            switch (eff.type) {
                case 'fieldInterval':
                    effText = `${eff.field} ${eff.delta > 0 ? '+' : ''}${eff.delta}/${eff.interval}s`;
                    break;
                case 'fieldModifier':
                    effText = `${eff.field} 衰减 ×${eff.multiplier}`;
                    break;
                case 'timeScale':
                    effText = `${eff.target || '全部'} 生长 ×${eff.multiplier}`;
                    break;
                case 'outputMultiplier':
                    effText = `产量 ×${eff.multiplier}`;
                    break;
                case 'consumeModifier':
                    effText = `售卖 ×${eff.multiplier}`;
                    break;
                default:
                    effText = eff.type;
            }
            return `${condText} → ${effText}`;
        },

        // ============================================================
        // ★ 环境规则：取某个字段的衰减倍率
        // ============================================================
        _getFieldDecayScale(sim, fieldKey) {
            let scale = 1;
            for (const r of (sim.envRules || [])) {
                if (!r.active) continue;
                if (r.effect.type !== 'fieldModifier') continue;
                if (r.effect.field !== fieldKey) continue;
                scale *= r.effect.multiplier;
            }
            return scale;
        },

        // ============================================================
        // ★ 环境规则：取进度流速倍率
        // ============================================================
        _getProgressScale(sim, slot) {
            let scale = 1;
            for (const r of (sim.envRules || [])) {
                if (!r.active) continue;
                if (r.effect.type !== 'timeScale') continue;
                if (r.effect.target && r.effect.target !== slot.mode) continue;
                scale *= r.effect.multiplier;
            }
            return scale;
        },

        // ============================================================
        // ★ 环境规则：取产出倍率
        // ============================================================
        _getOutputMultiplier(sim, slot) {
            let mult = 1;
            for (const r of (sim.envRules || [])) {
                if (!r.active) continue;
                if (r.effect.type !== 'outputMultiplier') continue;
                if (r.effect.target && r.effect.target !== slot.slotType) continue;
                mult *= r.effect.multiplier;
            }
            return mult;
        },

        // ============================================================
        // ★ 环境规则：取售卖倍率
        // ============================================================
        _getConsumeScale(sim, slot) {
            let scale = 1;
            for (const r of (sim.envRules || [])) {
                if (!r.active) continue;
                if (r.effect.type !== 'consumeModifier') continue;
                if (r.effect.target && r.effect.target !== slot.slotType) continue;
                scale *= r.effect.multiplier;
            }
            return scale;
        },

        // ============================================================
        // ★ 环境规则：收集当前生效的规则（给 UI 用）
        // ============================================================
        getActiveEnvRules(sim) {
            if (!sim?.envRules) return [];
            return sim.envRules
                .filter(r => r.active)
                .map(r => ({ ...r, label: this._formatEnvRuleLabel(r) }));
        },
        _applyElapsed(sim, elapsed, silent) {
            let changed = false;

            // ---------- 1. 时间规则（基础 + 环境）----------
            // 先合并一次规则列表，避免每个 cell 重复过滤
            const envFieldRules = (sim.envRules || [])
                .filter(r => r.active && r.effect.type === 'fieldInterval')
                .map(r => ({
                    key: r.effect.field,
                    interval: r.effect.interval,
                    delta: r.effect.delta,
                    _fromEnv: true,
                }));

            const allTimeRules = [
                ...(sim.rules.time || []),
                ...envFieldRules,
            ];

            for (const cell of sim.cells) {
                cell.meta = cell.meta || {};
                cell.meta.timeAnchors = cell.meta.timeAnchors || {};

                for (const rule of allTimeRules) {
                    const anchor = cell.meta.timeAnchors[rule.key] || sim.lastTick;
                    const since = Math.floor((Date.now() - anchor) / 1000);
                    const times = Math.floor(since / rule.interval);
                    if (times <= 0) continue;

                    // ★ 环境规则：字段衰减倍率
                    let delta = rule.delta;
                    if (!rule._fromEnv) {
                        // 基础规则可以被"衰减倍率"影响
                        const decayScale = this._getFieldDecayScale(sim, rule.key);
                        delta = rule.delta * decayScale;
                    }

                    const before = parseFloat(cell.fields[rule.key]) || 0;
                    this._applyFieldDelta(cell, rule.key, delta * times, sim);
                    const after = parseFloat(cell.fields[rule.key]) || 0;
                    const diff = after - before;

                    if (diff !== 0 && !silent) {
                        const tag = rule._fromEnv ? '🌤 ' : '';
                        // ★ 加 groupKey
                        this._log(
                            sim,
                            `${tag}${rule.key} ${diff > 0 ? '+' : ''}${diff.toFixed(1)}`,
                            `field:${rule.key}:${diff > 0 ? '+' : '-'}`,
                            { field: rule.key, delta: diff }
                        );
                    }
                    cell.meta.timeAnchors[rule.key] = Date.now();
                    changed = true;
                }
            }

            // ---------- 2. slot 处理 ----------
            for (let i = 0; i < sim.cells.length; i++) {
                const cell = sim.cells[i];
                const slot = cell.slot;
                if (!slot) continue;

                if (slot.mode === 'consume') {
                    if (slot.state !== 'running') continue;

                    // ★ 环境规则：售卖速度倍率
                    const sellScale = this._getConsumeScale(sim, slot);

                    slot.meta = slot.meta || { lastSellAt: Date.now() };
                    const since = Math.floor((Date.now() - (slot.meta.lastSellAt || Date.now())) / 1000);
                    const sold = Math.min(slot.stock, Math.floor(since / slot.interval * sellScale));
                    if (sold <= 0) continue;

                    slot.stock -= sold;
                    slot.meta.lastSellAt = Date.now();

                    if (slot.price > 0) {
                        const gain = slot.price * sold;
                        sim.pending.money += gain;
                        // ★ 加 groupKey，按"格子 + 商品名"折叠
                        this._log(
                            sim,
                            sellScale !== 1
                                ? `🌤 ${slot.itemName} 卖出 ${sold} 个（×${sellScale.toFixed(1)}），+${gain}`
                                : `${slot.itemName} 卖出 ${sold} 个，+${gain}`,
                            `sell:${slot.itemName}:${slot.slotType}`,
                            { itemName: slot.itemName, count: sold, gain }
                        );
                    }

                    if (slot.stock <= 0) {
                        slot.state = 'done';
                        this._log(sim, `📭 ${slot.itemName} 售罄`);
                    }
                    changed = true;

                } else {
                    // ★ 环境规则：进度流速倍率
                    const progressScale = this._getProgressScale(sim, slot);

                    if (slot.state === 'running') {
                        slot.progress.cur += elapsed * progressScale;
                        if (slot.progress.cur >= slot.progress.total) {
                            slot.progress.cur = slot.progress.total;
                            this._finishSlot(cell, sim, i);
                        }
                    }

                    if (slot.secondary) {
                        const now = Date.now();
                        const since = Math.floor((now - (slot.secondary.lastTick || now)) / 1000);
                        if (since > 0) {
                            // ★ 环境规则：副产品也受"生长"倍率影响
                            const secondaryScale = this._getProgressScale(sim, slot);
                            for (const r of slot.secondary.rate) {
                                const times = Math.floor(since / r.interval * secondaryScale);
                                if (times <= 0) continue;
                                const cur = slot.secondary.accumulate[r.key] || 0;
                                slot.secondary.accumulate[r.key] = Math.min(
                                    this.SECONDARY_CAP,
                                    cur + r.count * times
                                );
                            }
                            slot.secondary.lastTick = now;
                        }
                    }
                    changed = true;
                }
            }

            // ---------- 3. 冷却递减 ----------
            for (const cell of sim.cells) {
                if (!cell.meta?.cooldowns) continue;
                for (const k of Object.keys(cell.meta.cooldowns)) {
                    cell.meta.cooldowns[k] = Math.max(0, cell.meta.cooldowns[k] - elapsed);
                }
            }

            // ---------- 4. pending 日志限长 ----------
            if (sim.pending.log.length > 100) {
                sim.pending.log = sim.pending.log.slice(-100);
            }

            return changed;
        },

        async place(entityName, cellIndex, item) {
            const { sim, cell } = this._resolve(entityName, cellIndex);
            if (!sim || !cell) return { ok: false, reason: '参数错误' };
            if (cell.slot) return { ok: false, reason: '格子已被占用' };
        
            const t = String(item.fields?.类型 || '').trim();
            let slotType = null;
            for (const key of Object.keys(sim.slotTypes || {})) {
                if (t === key || t.includes(key) || key.includes(t)) { slotType = key; break; }
            }
            if (!slotType) return { ok: false, reason: `无法识别类型：${t || '（空）'}` };
        
            const stDef = sim.slotTypes[slotType];
        
            if (!this._consumeFromPlayer(item, 1)) {
                return { ok: false, reason: '物品不足' };
            }
        
            if (stDef.mode === 'consume') {
                const stock = parseInt(String(
                    item.fields?.销售次数 || item.fields?.默认库存 || item.fields?.库存 || '10'
                ).replace(/\D/g, '')) || 10;
                const price = parseFloat(String(item.fields?.售价 || '0').replace(/[^\d.]/g, '')) || 0;
                const interval = this._parseDuration(
                    item.fields?.销售速度 || item.fields?.耗时 || '20s'
                );
        
                cell.slot = {
                    mode: 'consume',
                    itemName: item.name,
                    icon: item.icon,
                    slotType,
                    stock,
                    maxStock: stock,
                    price,
                    interval,
                    state: 'running',
                    sourceItem: JSON.parse(JSON.stringify(item)),
                    meta: { lastSellAt: Date.now() },
                };
                this._log(sim, `📦 ${item.name} 上架（可售 ${stock} 次，售价 ${price}）`);
        
            } else {
                const total = this._parseDuration(
                    item.fields?.耗时 || item.fields?.生长时间 || '60s'
                );
        
                const isYoung = !!item.fields?.成年后;
        
                cell.slot = {
                    mode: stDef.mode,
                    itemName: item.name,
                    icon: item.icon,
                    slotType,
                    progress: { cur: 0, total },
                    state: 'running',
                    outputs: {},
                    sourceItem: JSON.parse(JSON.stringify(item)),
        
                    stage: isYoung ? 'young' : 'adult',
                    secondary: this._parseSecondary(item),
                    breed: this._parseBreed(item),
                };
        
                if (total <= 0) this._finishSlot(cell, sim, cellIndex);
                this._log(sim, `🌱 放入 ${item.name}` + (total > 0 ? `（${total}秒）` : ''));
            }
        
            // ★ 环境规则：放入时立即评估一次当前环境
            const scene = window.LocationModalManager?.currentLocation;
            if (scene && Array.isArray(sim.envRules) && sim.envRules.length > 0) {
                // 记录评估前的状态，用于识别"刚被激活"的规则
                const beforeActive = sim.envRules.map(r => !!r.active);
        
                this.reevaluateEnvRules(sim, scene);
        
                // 把"刚激活"的规则提示给玩家
                sim.envRules.forEach((r, i) => {
                    if (r.active && !beforeActive[i]) {
                        this._log(sim, `🌤 当前环境触发：${this._formatEnvRuleLabel(r)}`);
                    }
                });
            }
        
            SimulationUIManager.refresh();
            if (window.SaveManager) window.SaveManager.save();
            return { ok: true };
        },

        async collect(entityName, cellIndex) {
            const { sim, cell } = this._resolve(entityName, cellIndex);
            if (!sim || !cell) return { ok: false };
            const slot = cell.slot;
            if (!slot) return { ok: false };

            if (slot.stage === 'adult' && slot.secondary) {
                return this._collectSecondary(sim, cell, slot);
            }

            if (slot.mode === 'consume') return this._removeSlot(entityName, cellIndex);

            if (slot.state !== 'done') return { ok: false, reason: '还没完成' };

            const player = PlayerStateManager.player;
            const obtained = [];
            for (const [name, data] of Object.entries(slot.outputs || {})) {
                const ex = player.inventory.find(i => i.name === name);
                if (ex) {
                    ex.count = (ex.count || 1) + data.count;
                } else {
                    player.inventory.push({
                        name,
                        count: data.count,
                        icon: data.icon,
                        description: data.description,
                        fields: data.fields,
                        interactions: data.interactions || [],
                        type: data.type,
                        stackable: data.stackable || false,
                    });
                }
                obtained.push(`${data.icon} ${name}×${data.count}`);
            }

            cell.slot = null;
            PlayerStateManager.refreshAvatarArea();

            const text = obtained.join('、') || '（无产出）';
            this._log(sim, `📦 收取：${text}`);
            SimulationUIManager.refresh();
            if (window.SaveManager) window.SaveManager.save();
            return { ok: true };
        },

        _collectSecondary(sim, cell, slot) {
            const accum = slot.secondary.accumulate || {};
            const keys = Object.keys(accum).filter(k => accum[k] > 0);
            if (keys.length === 0) {
                return { ok: false, reason: '没有可收取的副产品' };
            }

            const player = PlayerStateManager.player;
            const obtained = [];
            for (const k of keys) {
                const count = accum[k];
                const template = (sim.stocks || []).find(s => s.name === k);
                const ex = player.inventory.find(i => i.name === k);
                if (ex) {
                    ex.count = (ex.count || 1) + count;
                } else {
                    player.inventory.push({
                        name: k,
                        count,
                        icon: template?.icon || '📦',
                        description: template?.description || '',
                        fields: { ...(template?.fields || {}) },
                        interactions: template?.interactions || [],
                        type: template?.type || 'item',
                    });
                }
                obtained.push(`${template?.icon || '📦'} ${k}×${count}`);
                delete accum[k];
            }

            PlayerStateManager.refreshAvatarArea();
            this._log(sim, `📦 收取副产：${obtained.join('、')}`);
            SimulationUIManager.refresh();
            if (window.SaveManager) window.SaveManager.save();
            return { ok: true, outputs: obtained };
        },

        async _removeSlot(entityName, cellIndex) {
            const { sim, cell } = this._resolve(entityName, cellIndex);
            if (!cell?.slot) return { ok: false };
            const slot = cell.slot;

            if (slot.mode === 'consume') {
                const template = slot.sourceItem || {};
                const player = PlayerStateManager.player;

                const ex = player.inventory.find(i => i.name === slot.itemName);
                if (ex) {
                    ex.count = (ex.count || 1) + 1;
                } else {
                    player.inventory.push({
                        name: slot.itemName,
                        count: 1,
                        icon: slot.icon,
                        description: template.description || '',
                        fields: { ...(template.fields || {}) },
                        interactions: template.interactions || [],
                        type: template.type || 'item',
                    });
                }
                PlayerStateManager.refreshAvatarArea();

                const sold = (slot.maxStock || 0) - (slot.stock || 0);
                this._log(sim, `📤 ${slot.itemName} 下架` +
                    (slot.stock > 0 ? `（剩余 ${slot.stock} 未售）` : '（已售罄）') +
                    (sold > 0 ? `，已售 ${sold}` : ''));
            }

            cell.slot = null;
            SimulationUIManager.refresh();
            if (window.SaveManager) window.SaveManager.save();
            return { ok: true };
        },

        async executeAction(entityName, actionId, cellIndex) {
            const { sim, cell } = this._resolve(entityName, cellIndex);
            if (!sim || !cell) return { ok: false };
            const action = sim.actions.find(a => a.id === actionId);
            if (!action) return { ok: false, reason: '行为不存在' };

            cell.meta = cell.meta || {};
            cell.meta.cooldowns = cell.meta.cooldowns || {};
            const cd = cell.meta.cooldowns[actionId] || 0;
            if (cd > 0) return { ok: false, reason: `冷却中（剩 ${cd}s）` };

            if (action.target === 'slot' && !cell.slot) return { ok: false, reason: '需要格子里有东西' };
            if (action.target === 'empty' && cell.slot) return { ok: false, reason: '需要空格子' };

            if (action.special === 'breed' || action.name === '繁殖') {
                return this._doBreed(sim, cell, action, cellIndex);
            }

            if (action.special === 'slaughter' || action.name === '宰杀') {
                return this._doSlaughter(sim, cell, action, cellIndex);
            }

            const payResult = this._payCost(sim, cell, action.cost);
            if (!payResult.ok) return payResult;

            for (const eff of action.effects || []) {
                this._applyEffect(sim, cell, eff);
            }
            if (action.cooldown > 0) cell.meta.cooldowns[actionId] = action.cooldown;

            this._log(sim, `${action.icon} ${action.name}`);
            SimulationUIManager.refresh();
            if (window.SaveManager) window.SaveManager.save();
            return { ok: true };
        },

        _doBreed(sim, cell, action, cellIndex) {
            const slot = cell.slot;
            if (!slot) return { ok: false, reason: '格子里没有动物' };
            if (!slot.breed) return { ok: false, reason: '这个动物不能繁殖' };
            if (slot.stage !== 'adult') return { ok: false, reason: '还没成年' };

            const now = Date.now();
            const since = slot.breed.lastBreedAt
                ? Math.floor((now - slot.breed.lastBreedAt) / 1000)
                : Infinity;
            if (since < slot.breed.cooldown) {
                return { ok: false, reason: `繁殖冷却中（剩 ${slot.breed.cooldown - since}s）` };
            }

            const payResult = this._payCost(sim, cell, action.cost);
            if (!payResult.ok) return payResult;

            const emptyIdx = sim.cells.findIndex(c => !c.slot);
            if (emptyIdx === -1) {
                return { ok: false, reason: '没有空格子容纳新生动物' };
            }

            const offspringName = slot.breed.offspringName;
            const template = (sim.stocks || []).find(s => s.name === offspringName);
            if (!template) {
                return { ok: false, reason: `找不到幼崽模板：${offspringName}` };
            }

            const emptyCell = sim.cells[emptyIdx];
            const total = this._parseDuration(template.fields?.生长时间 || '180s');
            const isYoung = !!template.fields?.成年后;

            emptyCell.slot = {
                mode: 'grow',
                itemName: template.name,
                icon: template.icon || '🐄',
                slotType: slot.slotType,
                progress: { cur: 0, total },
                state: 'running',
                outputs: {},
                sourceItem: JSON.parse(JSON.stringify(template)),
                stage: isYoung ? 'young' : 'adult',
                secondary: this._parseSecondary(template),
                breed: this._parseBreed(template),
            };

            slot.breed.lastBreedAt = now;
            this._log(sim, `🐄 ${slot.itemName} 生下了 ${offspringName}！`);
            SimulationUIManager.refresh();
            if (window.SaveManager) window.SaveManager.save();
            return { ok: true };
        },

        _doSlaughter(sim, cell, action, cellIndex) {
            const slot = cell.slot;
            if (!slot) return { ok: false, reason: '格子里没有动物' };

            const raw = slot.sourceItem?.fields?.宰杀产出;
            if (!raw) return { ok: false, reason: '这个动物不能宰杀' };

            const payResult = this._payCost(sim, cell, action.cost);
            if (!payResult.ok) return payResult;

            const player = PlayerStateManager.player;
            const obtained = [];
            for (const p of String(raw).split(/[，,、]/)) {
                const m = p.match(/^(.+?)[×xX*](\d+)$/);
                const name = m ? m[1].trim() : p.trim();
                const count = m ? parseInt(m[2]) : 1;
                if (!name) continue;

                const template = (sim.stocks || []).find(s => s.name === name);
                const ex = player.inventory.find(i => i.name === name);
                if (ex) {
                    ex.count = (ex.count || 1) + count;
                } else {
                    player.inventory.push({
                        name,
                        count,
                        icon: template?.icon || '📦',
                        description: template?.description || '',
                        fields: { ...(template?.fields || {}) },
                        interactions: template?.interactions || [],
                        type: template?.type || 'item',
                    });
                }
                obtained.push(`${template?.icon || '📦'} ${name}×${count}`);
            }

            const deadName = slot.itemName;
            cell.slot = null;
            PlayerStateManager.refreshAvatarArea();
            this._log(sim, `🔪 宰杀了 ${deadName}，获得 ${obtained.join('、')}`);
            SimulationUIManager.refresh();
            if (window.SaveManager) window.SaveManager.save();
            return { ok: true };
        },

        _finishSlot(cell, sim, cellIndex) {
            const slot = cell.slot;
            if (!slot || slot.state === 'done') return;

            if (slot.stage === 'young' && slot.sourceItem?.fields?.成年后) {
                const adultName = String(slot.sourceItem.fields.成年后).trim();
                const adultTemplate = (sim.stocks || []).find(s => s.name === adultName);

                slot.itemName = adultName;
                slot.icon = adultTemplate?.icon || slot.icon;
                slot.sourceItem = adultTemplate
                    ? JSON.parse(JSON.stringify(adultTemplate))
                    : slot.sourceItem;
                slot.stage = 'adult';
                slot.state = 'running';
                slot.progress.cur = 0;
                slot.progress.total = 0;

                slot.secondary = this._parseSecondary(slot.sourceItem);
                slot.breed = this._parseBreed(slot.sourceItem);

                this._log(sim, `🐄 ${adultName} 长大了！`);
                return;
            }

            slot.state = 'done';
            slot.judgeResult = this._judgeSlot(cell, slot, sim);
            slot.outputs = this._calcOutputs(cell, slot, sim, slot.judgeResult);

            const stDef = sim.slotTypes[slot.slotType] || {};
            const flag = slot.judgeResult === 'high' ? '（高产）'
           : slot.judgeResult === 'low' ? '（低产）' : '';

            // ★ 环境规则：产出倍率（用于日志展示）
            const envMult = this._getOutputMultiplier(sim, slot);
            const envFlag = envMult !== 1 ? ` 🌤×${envMult.toFixed(1)}` : '';

            this._log(sim, `${slot.icon} ${slot.itemName} ${stDef.doneLabel || '完成'}${flag}${envFlag}`);

            if (!sim.pending.matureCells.includes(cellIndex)) {
                sim.pending.matureCells.push(cellIndex);
            }
        },

        _judgeSlot(cell, slot, sim) {
            const item = slot.sourceItem || {};
            const highCond = SimulationGenerator._parseConditions(item.fields?.高产条件 || '');
            const normalCond = SimulationGenerator._parseConditions(item.fields?.普产条件 || '');
            const globalRule = (sim.rules.completion || []).find(r => r.slotType === slot.slotType);
            const high = highCond.length ? highCond : (globalRule?.high || []);
            const normal = normalCond.length ? normalCond : (globalRule?.normal || []);
            if (high.length && this._checkConds(cell, high)) return 'high';
            if (normal.length && this._checkConds(cell, normal)) return 'normal';
            if (high.length || normal.length) return 'low';
            return 'normal';
        },

        _calcOutputs(cell, slot, sim, level) {
            const item = slot.sourceItem || {};
            const rule = (sim.rules.completion || []).find(r => r.slotType === slot.slotType);
            const outputStr = item.fields?.产出 || rule?.output || '';
            const mult = rule?.multipliers?.[level]
                ?? (level === 'high' ? 1.5 : level === 'low' ? 0.5 : 1.0);
        
            // ★ 环境规则：产出倍率
            const envMult = this._getOutputMultiplier(sim, slot);
            const finalMult = mult * envMult;
        
            const outputs = {};
        
            for (const p of String(outputStr).split(/[，,、\s]+/).filter(Boolean)) {
                const m = p.match(/^(.+?)[×xX*](\d+)$/);
                const name = m ? m[1].trim() : p.trim();
                let count = m ? parseInt(m[2]) : 1;
                count = Math.round(count * finalMult);
                if (level === 'low') count = Math.max(1, count);
                // 环境倍率不应该把产量压到 0
                count = Math.max(1, count);
        
                const template = (sim.stocks || []).find(s => s.name === name);
                outputs[name] = {
                    count,
                    icon: template?.icon || '📦',
                    description: template?.description || '',
                    fields: { ...(template?.fields || {}) },
                    interactions: template?.interactions || [],
                    type: template?.type || 'item',
                    stackable: template?.stackable || false,
                };
            }
        
            // ★ 环境倍率较大时，在日志里体现
            if (envMult !== 1 && Object.keys(outputs).length > 0) {
                const detail = Object.entries(outputs)
                    .map(([n, d]) => `${n}×${d.count}`)
                    .join('、');
                this._log(sim, `🌤 环境加成 ×${envMult.toFixed(1)}：${detail}`);
            }
        
            return outputs;
        },

        _parseSecondary(item) {
            const raw = item?.fields?.副产品;
            if (!raw) return null;

            const rate = [];
            for (const p of String(raw).split(/[，,、]/)) {
                const m = p.match(/^(.+?)[:：]\s*(\d+)\s*s?\s*[:：]\s*(\d+)$/);
                if (m) {
                    rate.push({
                        key: m[1].trim(),
                        interval: parseInt(m[2]),
                        count: parseInt(m[3]),
                    });
                }
            }
            if (rate.length === 0) return null;

            return {
                accumulate: {},
                lastTick: Date.now(),
                rate,
            };
        },

        _parseBreed(item) {
            const offspring = item?.fields?.繁殖产出;
            if (!offspring) return null;

            const cdStr = item.fields?.繁殖冷却 || '600s';
            const cd = this._parseDuration(cdStr);

            return {
                offspringName: String(offspring).trim(),
                cooldown: cd,
                lastBreedAt: null,
            };
        },

        _flushPending(sim) {
            if (!sim.pending) return;
            const player = PlayerStateManager.player;

            if (sim.pending.money > 0) {
                const extra = player.extraStats;
                const key = extra._order.find(k => /金币|金钱|钱/.test(k)) || '金币';
                if (extra[key] === undefined) {
                    extra._order.push(key);
                    extra[key] = '0';
                }
                const raw = String(extra[key]);
                const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                const cur = m ? parseFloat(m[1]) : 0;
                const unit = m ? (m[2] || '') : '';
                extra[key] = `${Math.round((cur + sim.pending.money) * 100) / 100}${unit}`;
            }

            for (const [name, count] of Object.entries(sim.pending.gains || {})) {
                const ex = player.inventory.find(i => i.name === name);
                if (ex) ex.count = (ex.count || 1) + count;
                else player.inventory.push({
                    name, count, icon: '📦',
                    description: '', fields: {}, type: 'item',
                });
            }

            sim.pending.money = 0;
            sim.pending.gains = {};
            sim.pending.matureCells = [];

            PlayerStateManager.refreshAvatarArea();
        },

        flushNow() {
            const entity = this._resolveEntity(this._activeEntityName);
            if (!entity?.simulation) return { money: 0, gains: {} };
            const sim = entity.simulation;
            const summary = {
                money: sim.pending.money,
                gains: { ...sim.pending.gains },
            };
            this._flushPending(sim);
            SimulationUIManager.refresh();
            if (window.SaveManager) window.SaveManager.save();
            return summary;
        },

        // ============================================================
        // ★ 日志：写入时折叠
        // ============================================================
        // 参数：
        //   text      — 展示文本
        //   groupKey  — 折叠标识（可选）。同 key 的"最近一条"会被合并。
        //               不传则用 text 当 key。
        //   meta      — 附加数据（可选），如 { cellIndex, delta }
        // ============================================================
        _log(sim, text, groupKey = null, meta = null) {
            if (!sim.pending) {
                sim.pending = { money: 0, gains: {}, matureCells: [], log: [] };
            }

            const now = Date.now();
            const key = groupKey || text;
            const log = sim.pending.log;
            const last = log[log.length - 1];

            // ★ 尝试合并到"最后一条"
            if (last && last.groupKey === key) {
                // 不合并的例外：如果最后一条是"合并项"且距现在超过 N 秒
                // （防止"湿度+3"连续几小时挂在一条上，看不出时间跨度）
                const FOLD_WINDOW_MS = 5000;
                if (now - (last.lastTs || last.ts) <= FOLD_WINDOW_MS) {
                    last.count = (last.count || 1) + 1;
                    last.lastTs = now;
                    return;
                }
            }

            // 新起一条
            log.push({
                ts: now,
                lastTs: now,
                text,
                count: 1,
                groupKey: key,
                meta: meta || null,
            });

            // 限长（保留最近 100 条）
            if (log.length > 100) {
                sim.pending.log = log.slice(-100);
            }
        },

        _resolveEntity(name) {
            const scene = window.LocationModalManager.currentLocation;
            return scene?.sceneItems?.find(i => i.name === name);
        },

        _resolve(entityName, cellIndex) {
            const entity = this._resolveEntity(entityName);
            const sim = entity?.simulation;
            const cell = sim?.cells?.[cellIndex];
            return { entity, sim, cell };
        },

        _applyEffect(sim, cell, eff) {
            switch (eff.type) {
                case 'fieldDelta':
                    this._applyFieldDelta(cell, eff.key, eff.value, sim);
                    break;
                case 'slotProgress':
                    if (cell.slot && cell.slot.mode !== 'consume') {
                        cell.slot.progress.cur = Math.max(0, Math.min(
                            cell.slot.progress.total,
                            cell.slot.progress.cur + eff.value
                        ));
                    }
                    break;
            }
        },

        _applyFieldDelta(cell, key, delta, sim) {
            if (cell.fields[key] === undefined) {
                cell.fields[key] = '0';
                cell._order.push(key);
            }
            const cur = parseFloat(cell.fields[key]) || 0;
            let next = cur + delta;
            const bound = sim.cellTemplate?.bounds?.[key];
            if (bound) next = Math.max(bound[0] ?? 0, Math.min(bound[1] ?? 999999, next));
            else next = Math.max(0, next);
            cell.fields[key] = String(Math.round(next * 100) / 100);
        },

        _payCost(sim, cell, cost) {
            if (!cost) return { ok: true };
            const player = PlayerStateManager.player;
            const plan = [];

            for (const [k, v] of Object.entries(cost)) {
                if (v <= 0) continue;

                const pBar = player.statusBars?.find(b => b.key === k || b.key.includes(k));
                if (pBar) {
                    if (pBar.current < v) return { ok: false, reason: `${k} 不足` };
                    plan.push({ type: 'playerBar', ref: pBar, value: v });
                    continue;
                }

                if (cell.fields[k] !== undefined) {
                    const cur = parseFloat(cell.fields[k]) || 0;
                    if (cur < v) return { ok: false, reason: `${k} 不足` };
                    plan.push({ type: 'cellField', cell, key: k, value: v });
                    continue;
                }

                const pItem = player.inventory?.find(i => i.name === k);
                if (pItem && (pItem.count || 1) >= v) {
                    plan.push({ type: 'playerInv', item: pItem, value: v });
                    continue;
                }

                return { ok: false, reason: `${k} 不足` };
            }

            for (const step of plan) {
                if (step.type === 'playerBar') {
                    step.ref.current = Math.max(0, step.ref.current - step.value);
                } else if (step.type === 'cellField') {
                    this._applyFieldDelta(step.cell, step.key, -step.value, sim);
                } else if (step.type === 'playerInv') {
                    step.item.count -= step.value;
                    if (step.item.count <= 0) {
                        const i = player.inventory.indexOf(step.item);
                        if (i > -1) player.inventory.splice(i, 1);
                    }
                }
            }
            PlayerStateManager.refreshAvatarArea();
            return { ok: true };
        },

        _consumeFromPlayer(item, count) {
            const player = PlayerStateManager.player;
            const ex = player.inventory?.find(i => i === item || i.name === item.name);
            if (!ex || (ex.count || 1) < count) return false;
            ex.count -= count;
            if (ex.count <= 0) {
                const i = player.inventory.indexOf(ex);
                if (i > -1) player.inventory.splice(i, 1);
            }
            PlayerStateManager.refreshAvatarArea();
            return true;
        },

        _parseDuration(str) {
            const s = String(str || '');
            const m = s.match(/(\d+)\s*(秒|s|分|min|分钟)?/i);
            if (!m) return 60;
            const n = parseInt(m[1]);
            const unit = m[2] || '秒';
            return /分|min/i.test(unit) ? n * 60 : n;
        },

        _checkConds(cell, conds) {
            return conds.every(c => {
                const cur = parseFloat(cell.fields[c.key]) || 0;
                switch (c.op) {
                    case '≥': case '>=': return cur >= c.value;
                    case '>': return cur > c.value;
                    case '≤': case '<=': return cur <= c.value;
                    case '<': return cur < c.value;
                    case '=': case '==': return cur === c.value;
                }
                return false;
            });
        },
    };

    // ============================================================
    // 模拟经营界面
    // ============================================================
    const SimulationUIManager = {
        _currentEntityName: null,
        _selectedCell: null,
        _rightTab: 'detail',

        _pending: {
            type: null,
            item: null,
            action: null,
        },

        open(entityName) {
            this._currentEntityName = entityName;
            this._selectedCell = null;
            this._rightTab = 'detail';
            this._pending = { type: null, item: null, action: null };
            this._render();
            SimulationEngine.start(entityName);
        },

        close() {
            SimulationEngine.stop();
            this._currentEntityName = null;
            window.UIManager.closeModal();
        },

        refresh() {
            if (!this._currentEntityName) return;
            const root = document.getElementById('cw-sim-root');
            if (!root) return;

            const leftScroll = root.querySelector('.cw-sim-left')?.scrollTop || 0;
            const rightScroll = root.querySelector('.cw-sim-right-body')?.scrollTop || 0;

            this._render(true);

            const newRoot = document.getElementById('cw-sim-root');
            if (!newRoot) return;
            const newLeft = newRoot.querySelector('.cw-sim-left');
            const newRight = newRoot.querySelector('.cw-sim-right-body');
            if (newLeft && leftScroll) newLeft.scrollTop = leftScroll;
            if (newRight && rightScroll) newRight.scrollTop = rightScroll;
        },

        _getSim() {
            const scene = window.LocationModalManager.currentLocation;
            const entity = scene?.sceneItems?.find(i => i.name === this._currentEntityName);
            return entity?.simulation || null;
        },

        _getEntity() {
            const scene = window.LocationModalManager.currentLocation;
            return scene?.sceneItems?.find(i => i.name === this._currentEntityName);
        },

        _render(keepState = false) {
            const entity = this._getEntity();
            if (!entity) return;

            if (!entity.simulation?.initialized) {
                this._renderInitPrompt(entity);
                return;
            }

            const sim = entity.simulation;
            if (!sim.pending) sim.pending = { money: 0, gains: {}, matureCells: [], log: [] };

            if (!keepState) {
                this._selectedCell = null;
                this._rightTab = 'detail';
                this._pending = { type: null, item: null, action: null };
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active cw-sim-modal';
            modal.innerHTML = `
                <div id="cw-sim-root">
                    ${this._renderHeader(entity, sim)}
                    ${this._renderPendingBanner()}
                    <div class="cw-sim-main">
                        <div class="cw-sim-left">${this._renderGrid(sim)}</div>
                        <div class="cw-sim-right">${this._renderRightPanel(sim)}</div>
                    </div>
                </div>`;
            this._injectStyles();
        },

        _renderHeader(entity, sim) {
            const money = sim.pending.money || 0;

            const harvestable = sim.cells.filter(c =>
                c.slot && c.slot.mode !== 'consume' && c.slot.state === 'done' && !c.slot.secondary
            ).length;
            const removable = sim.cells.filter(c =>
                c.slot && c.slot.mode === 'consume'
            ).length;

            return `
                <div class="cw-sim-header">
                    <div class="cw-sim-header-left">
                        <div class="cw-sim-icon">${entity.icon || '🏭'}</div>
                        <div>
                            <div class="cw-sim-title">${entity.name}</div>
                            <div class="cw-sim-subtitle">
                                ${sim.type} · ${sim.cells.length} 格 · 实时流逝
                            </div>
                        </div>
                    </div>
                    <div class="cw-sim-header-right">
                        ${money > 0 ? `
                            <button class="cw-sim-flush-btn" onclick="SimulationUIManager.flushPending()">
                                💰 结算 <strong>+${money}</strong>
                            </button>` : ''}
                        ${harvestable > 0 ? `
                            <button class="cw-sim-batch-btn harvest"
                                onclick="SimulationUIManager.batchCollect()"
                                title="收取所有已完成格子">
                                🌾 一键收取
                                <span class="batch-count">${harvestable}</span>
                            </button>` : ''}
                        ${removable > 0 ? `
                            <button class="cw-sim-batch-btn remove"
                                onclick="SimulationUIManager.batchRemove()"
                                title="下架所有商店格，剩余库存退回背包">
                                📤 一键下架
                                <span class="batch-count">${removable}</span>
                            </button>` : ''}
                        <button class="cw-sim-icon-btn" onclick="SimulationUIManager._openRules()" title="规则">📜</button>
                        <button class="cw-sim-icon-btn" onclick="SimulationUIManager._resetSim()" title="重新生成">🔄</button>
                        <button class="cw-sim-icon-btn cw-sim-close" onclick="SimulationUIManager.close()" title="关闭">✕</button>
                    </div>
                </div>`;
        },

        _renderPendingBanner() {
            const p = this._pending;
            if (!p.type) return '';

            if (p.type === 'place') {
                return `
                    <div class="cw-sim-pending-banner place">
                        <span class="pending-icon">📦</span>
                        <span>准备放入：<strong>${p.item.icon || '📦'} ${p.item.name}</strong> ×${p.item.count || 1}</span>
                        <span class="pending-hint">点击左侧空格子放入</span>
                        <button class="pending-cancel" onclick="SimulationUIManager._clearPending()">✖ 取消</button>
                    </div>`;
            }
            if (p.type === 'action') {
                return `
                    <div class="cw-sim-pending-banner action">
                        <span class="pending-icon">⚡</span>
                        <span>准备施放：<strong>${p.action.icon} ${p.action.name}</strong></span>
                        <span class="pending-hint">点击左侧目标格子施放</span>
                        <button class="pending-cancel" onclick="SimulationUIManager._clearPending()">✖ 取消</button>
                    </div>`;
            }
            return '';
        },

        _clearPending() {
            this._pending = { type: null, item: null, action: null };
            this._render(true);
        },

        _renderGrid(sim) {
            return `
                <div class="cw-sim-grid">
                    ${sim.cells.map((cell, i) => this._cellHTML(sim, cell, i)).join('')}
                </div>`;
        },

        _cellHTML(sim, cell, index) {
            const sel = this._selectedCell === index ? 'selected' : '';
            const slot = cell.slot;
            const stDef = slot ? (sim.slotTypes?.[slot.slotType] || {}) : null;

            const p = this._pending;
            let highlight = '';
            if (p.type === 'place' && !slot) highlight = 'ready-place';
            else if (p.type === 'action') {
                const a = p.action;
                if (a.target === 'cell') highlight = 'ready-action';
                else if (a.target === 'slot' && slot) highlight = 'ready-action';
                else if (a.target === 'empty' && !slot) highlight = 'ready-action';
            }

            let inner = '';
            let stateClass = '';
            let cornerBadge = '';

            if (!slot) {
                inner = `<div class="cw-sim-cell-empty-dot"></div>`;
            } else if (slot.mode === 'consume') {
                const pct = slot.maxStock > 0 ? (slot.stock / slot.maxStock) * 100 : 0;
                inner = `
                    <div class="cw-sim-cell-icon">${slot.icon}</div>
                    <svg class="cw-sim-cell-ring" viewBox="0 0 44 44">
                        <circle class="ring-bg" cx="22" cy="22" r="19"></circle>
                        <circle class="ring-fg" cx="22" cy="22" r="19"
                            style="stroke-dasharray:${(2 * Math.PI * 19).toFixed(1)};
                                   stroke-dashoffset:${(2 * Math.PI * 19 * (1 - pct / 100)).toFixed(1)};"></circle>
                    </svg>
                    <div class="cw-sim-cell-stock-num">${slot.stock}</div>`;
                stateClass = slot.state === 'done' ? 'state-done' : 'state-running';
                cornerBadge = `<div class="cw-sim-cell-badge running-badge">💰</div>`;
            } else {
                const pct = slot.progress.total > 0 ? (slot.progress.cur / slot.progress.total) * 100 : 0;
                const circumference = 2 * Math.PI * 19;

                let secondaryBadge = '';
                if (slot.secondary) {
                    const accum = slot.secondary.accumulate || {};
                    const total = Object.values(accum).reduce((a, b) => a + b, 0);
                    if (total > 0) {
                        secondaryBadge = `<div class="cw-sim-cell-secondary">📦${total}</div>`;
                    }
                }

                inner = `
                    <div class="cw-sim-cell-icon">${slot.icon}</div>
                    ${slot.progress.total > 0 ? `
                        <svg class="cw-sim-cell-ring" viewBox="0 0 44 44">
                            <circle class="ring-bg" cx="22" cy="22" r="19"></circle>
                            <circle class="ring-fg ${slot.state === 'done' ? 'ring-done' : ''}"
                                cx="22" cy="22" r="19"
                                style="stroke-dasharray:${circumference.toFixed(1)};
                                       stroke-dashoffset:${(circumference * (1 - pct / 100)).toFixed(1)};"></circle>
                        </svg>
                    ` : ''}
                    ${secondaryBadge}`;

                stateClass = slot.state === 'done' ? 'state-done' : 'state-running';

                if (slot.state === 'done') {
                    cornerBadge = `<div class="cw-sim-cell-badge done-badge">✓</div>`;
                } else if (slot.stage === 'young') {
                    cornerBadge = `<div class="cw-sim-cell-badge young-badge">幼</div>`;
                } else if (slot.stage === 'adult' && slot.breed) {
                    cornerBadge = `<div class="cw-sim-cell-badge adult-badge">成</div>`;
                }
            }

            return `
                <div class="cw-sim-cell ${sel} ${slot ? 'occupied' : 'empty'} ${stateClass} ${highlight}"
                    onclick="SimulationUIManager.clickCell(${index})"
                    title="格子 ${index + 1}${slot ? ' · ' + slot.itemName : ' · 空'}">
                    ${cornerBadge}
                    ${inner}
                </div>`;
        },

        clickCell(index) {
            const sim = this._getSim();
            const cell = sim?.cells?.[index];
            if (!cell) return;

            const p = this._pending;

            if (p.type === 'place') {
                if (cell.slot) { window.UIManager.showText('这个格子已经被占用了', 1200); return; }
                const item = p.item;
                this._pending = { type: null, item: null, action: null };
                SimulationEngine.place(this._currentEntityName, index, item)
                    .then(r => {
                        if (!r.ok) window.UIManager.showText(`❌ ${r.reason || '放入失败'}`, 1500);
                        this._render(true);
                    });
                return;
            }

            if (p.type === 'action') {
                const a = p.action;
                if (a.target === 'slot' && !cell.slot) { window.UIManager.showText('这个行为需要格子里有东西', 1200); return; }
                if (a.target === 'empty' && cell.slot) { window.UIManager.showText('这个行为需要空格子', 1200); return; }
                this._pending = { type: null, item: null, action: null };
                SimulationEngine.executeAction(this._currentEntityName, a.id, index)
                    .then(r => {
                        if (!r.ok && r.reason) window.UIManager.showText(`❌ ${r.reason}`, 1500);
                        this._render(true);
                    });
                return;
            }

            this._selectedCell = index;
            this._rightTab = 'detail';
            this._render(true);
        },

        async _quickCollect(index) {
            const sim = this._getSim();
            const cell = sim?.cells?.[index];
            if (!cell?.slot) return;

            const result = await SimulationEngine.collect(this._currentEntityName, index);
            if (result?.ok !== false) {
                window.UIManager.showText(`📦 收取成功`, 1200);
            } else if (result?.reason) {
                window.UIManager.showText(`❌ ${result.reason}`, 1500);
            }
            this._render(true);
        },

        async _quickRemove(index) {
            const sim = this._getSim();
            const cell = sim?.cells?.[index];
            if (!cell?.slot) return;

            const stock = cell.slot.stock || 0;
            const name = cell.slot.itemName;

            await SimulationEngine._removeSlot(this._currentEntityName, index);
            if (stock > 0) {
                window.UIManager.showText(`📤 已下架 ${name}，退回 ${stock} 个`, 1500);
            } else {
                window.UIManager.showText(`📤 已下架 ${name}`, 1200);
            }
            this._render(true);
        },

        async _doAction(actionId, cellIndex) {
            const result = await SimulationEngine.executeAction(
                this._currentEntityName, actionId, cellIndex
            );
            if (!result.ok && result.reason) {
                window.UIManager.showText(`❌ ${result.reason}`, 1500);
            }
            this._render(true);
        },

        async batchCollect() {
            const sim = this._getSim();
            if (!sim) return;

            const targets = [];
            sim.cells.forEach((c, i) => {
                if (c.slot && c.slot.mode !== 'consume' && c.slot.state === 'done' && !c.slot.secondary) {
                    targets.push(i);
                }
            });
            if (targets.length === 0) return;

            const summary = {};
            for (const i of targets) {
                const cell = sim.cells[i];
                const outputs = cell.slot.outputs || {};
                for (const [name, data] of Object.entries(outputs)) {
                    summary[name] = (summary[name] || 0) + data.count;
                }
                await SimulationEngine.collect(this._currentEntityName, i);
            }

            const text = Object.entries(summary)
                .map(([name, count]) => `${name}×${count}`)
                .join('、');

            window.UIManager.showText(`📦 一键收取：${text}`, 2000);
            this._render(true);
            if (window.SaveManager) window.SaveManager.save();
        },

        async batchRemove() {
            const sim = this._getSim();
            if (!sim) return;

            const targets = [];
            sim.cells.forEach((c, i) => {
                if (c.slot && c.slot.mode === 'consume') targets.push(i);
            });
            if (targets.length === 0) return;

            const summary = {};
            let totalStock = 0;
            for (const i of targets) {
                const cell = sim.cells[i];
                const slot = cell.slot;
                if (slot.stock > 0) {
                    summary[slot.itemName] = (summary[slot.itemName] || 0) + slot.stock;
                    totalStock += slot.stock;
                }
                await SimulationEngine._removeSlot(this._currentEntityName, i);
            }

            const text = Object.entries(summary)
                .map(([name, count]) => `${name}×${count}`)
                .join('、');

            if (totalStock > 0) {
                window.UIManager.showText(`📤 一键下架，退回：${text}`, 2000);
            } else {
                window.UIManager.showText(`📤 一键下架完成`, 1500);
            }
            this._render(true);
            if (window.SaveManager) window.SaveManager.save();
        },

        _renderRightPanel(sim) {
            const tabs = [
                { id: 'detail',    label: '🔍', title: '详情' },
                { id: 'actions',   label: '⚡', title: '行为' },
                { id: 'inventory', label: '🎒', title: '背包' },
                { id: 'shop',      label: '🛒', title: '商店' },
                { id: 'log',       label: '📜', title: '日志' },
            ];

            return `
                <div class="cw-sim-right-tabs">
                    ${tabs.map(t => `
                        <button class="cw-sim-right-tab ${this._rightTab === t.id ? 'active' : ''}"
                            onclick="SimulationUIManager.switchRight('${t.id}')"
                            title="${t.title}">
                            <span class="tab-icon">${t.label}</span>
                            <span class="tab-title">${t.title}</span>
                            ${t.id === 'inventory' ? this._invCountBadge(sim) : ''}
                        </button>
                    `).join('')}
                </div>
                <div class="cw-sim-right-body">
                    ${this._renderRightBody(sim)}
                </div>`;
        },

        _invCountBadge(sim) {
            const player = PlayerStateManager.player;
            const placeable = (player.inventory || []).filter(it =>
                (it.count || 1) > 0 && this._canPlace(it, sim)
            );
            if (placeable.length === 0) return '';
            return `<span class="cw-sim-tab-badge">${placeable.length}</span>`;
        },

        switchRight(tab) {
            this._rightTab = tab;
            this._render(true);
        },

        _renderRightBody(sim) {
            switch (this._rightTab) {
                case 'detail': return this._renderDetail(sim);
                case 'actions': return this._renderActions(sim);
                case 'inventory': return this._renderInventory(sim);
                case 'shop': return this._renderShop(sim);
                case 'log': return this._renderLog(sim);
            }
            return '';
        },

        _renderDetail(sim) {
            if (this._selectedCell === null) {
                if (this._pending.type === 'place') {
                    return `
                        <div class="cw-sim-empty-state">
                            <div class="cw-sim-empty-icon">👆</div>
                            <div>准备放入</div>
                            <div class="cw-sim-empty-sub">
                                <strong>${this._pending.item.icon} ${this._pending.item.name}</strong>
                            </div>
                            <div class="cw-sim-empty-sub">点击左侧空格子放入</div>
                            <button class="cinemaworld-button" style="margin-top:12px;"
                                onclick="SimulationUIManager._clearPending()">取消</button>
                        </div>`;
                }
                if (this._pending.type === 'action') {
                    return `
                        <div class="cw-sim-empty-state">
                            <div class="cw-sim-empty-icon">⚡</div>
                            <div>准备施放</div>
                            <div class="cw-sim-empty-sub">
                                <strong>${this._pending.action.icon} ${this._pending.action.name}</strong>
                            </div>
                            <div class="cw-sim-empty-sub">点击左侧目标格子施放</div>
                            <button class="cinemaworld-button" style="margin-top:12px;"
                                onclick="SimulationUIManager._clearPending()">取消</button>
                        </div>`;
                }
                return `
                    <div class="cw-sim-empty-state">
                        <div class="cw-sim-empty-icon">👆</div>
                        <div>点击左侧格子查看详情</div>
                        <div class="cw-sim-empty-sub">从「🎒 背包」选物品 → 点格子放入</div>
                        <div class="cw-sim-empty-sub">从「⚡ 行为」选行为 → 点格子施放</div>
                    </div>`;
            }

            const cell = sim.cells[this._selectedCell];
            if (!cell) return `<div class="cw-sim-empty-state">格子不存在</div>`;

            const attrs = (cell._order || []).map(k =>
                `<div class="cw-sim-detail-attr">
                    <span class="attr-key">${k}</span>
                    <span class="attr-val">${cell.fields[k] ?? '-'}</span>
                </div>`
            ).join('');

            const slot = cell.slot;
            let slotHTML = '';
            if (slot) {
                const fields = Object.entries(slot.sourceItem?.fields || {})
                    .filter(([k]) => !['图标', 'icon'].includes(k))
                    .slice(0, 6)
                    .map(([k, v]) => `
                        <div class="cw-sim-detail-attr">
                            <span class="attr-key">${k}</span>
                            <span class="attr-val">${v}</span>
                        </div>`).join('');

                if (slot.mode === 'consume') {
                    slotHTML = `
                        <div class="cw-sim-detail-slot">
                            <div class="cw-sim-detail-slot-head">
                                <span class="cw-sim-detail-slot-icon">${slot.icon}</span>
                                <div>
                                    <div class="cw-sim-detail-slot-name">${slot.itemName}</div>
                                    <div class="cw-sim-detail-slot-tag">上架销售中</div>
                                </div>
                            </div>
                            <div class="cw-sim-detail-slot-stats">
                                <div><span>可售</span><strong>${slot.stock}/${slot.maxStock}</strong></div>
                                <div><span>售价</span><strong>💰${slot.price}</strong></div>
                                <div><span>周期</span><strong>${slot.interval}s</strong></div>
                            </div>
                            ${fields ? `<div class="cw-sim-detail-slot-fields">${fields}</div>` : ''}
                        </div>`;
                } else {
                    const pct = slot.progress.total > 0
                        ? Math.round((slot.progress.cur / slot.progress.total) * 100) : 0;

                    const stageLabel = slot.stage === 'young' ? '🐣 幼年'
                                     : slot.stage === 'adult' ? '✅ 成年'
                                     : (slot.state === 'done' ? '✅ 已完成' : '⏳ 进行中');

                    slotHTML = `
                        <div class="cw-sim-detail-slot">
                            <div class="cw-sim-detail-slot-head">
                                <span class="cw-sim-detail-slot-icon">${slot.icon}</span>
                                <div>
                                    <div class="cw-sim-detail-slot-name">${slot.itemName}</div>
                                    <div class="cw-sim-detail-slot-tag">${stageLabel}</div>
                                </div>
                            </div>
                            ${slot.progress.total > 0 ? `
                                <div class="cw-sim-detail-progress">
                                    <div class="cw-sim-detail-progress-bar">
                                        <div style="width:${pct}%;" class="${slot.state === 'done' ? 'bar-done' : ''}"></div>
                                    </div>
                                    <div class="cw-sim-detail-progress-text">
                                        ${slot.progress.cur}/${slot.progress.total}s · ${pct}%
                                    </div>
                                </div>
                            ` : ''}
                            ${fields ? `<div class="cw-sim-detail-slot-fields">${fields}</div>` : ''}
                        </div>`;

                    if (slot.secondary) {
                        const accum = slot.secondary.accumulate || {};
                        const accumulated = Object.entries(accum).filter(([k, v]) => v > 0);
                        const rates = slot.secondary.rate.map(r =>
                            `${r.key} 每${r.interval}s +${r.count}`
                        ).join('、');

                        slotHTML += `<div class="cw-sim-detail-section" style="margin-top:10px;">
                            <div class="cw-sim-detail-section-label">📦 副产品</div>
                            ${accumulated.length > 0
                                ? accumulated.map(([k, v]) => `
                                    <div class="cw-sim-detail-attr">
                                        <span class="attr-key">${k}</span>
                                        <span class="attr-val" style="color:#ffcf80;">${v}</span>
                                    </div>`).join('')
                                : '<div style="font-size:12px;color:#666;">暂无累积</div>'}
                            <div style="font-size:11px;color:#888;margin-top:6px;">⏱ ${rates}</div>
                        </div>`;
                    }
                }
            }

            let btn = '';
            if (slot) {
                if (slot.mode === 'consume') {
                    btn = `<button class="cw-sim-detail-action"
                        onclick="SimulationUIManager._quickRemove(${this._selectedCell})">
                        📤 下架（退回 ${slot.stock} 个）
                    </button>`;
                } else {
                    if (slot.stage === 'adult' && slot.secondary) {
                        const accum = slot.secondary.accumulate || {};
                        const total = Object.values(accum).reduce((a, b) => a + b, 0);
                        if (total > 0) {
                            btn += `<button class="cw-sim-detail-action primary"
                                onclick="SimulationUIManager._quickCollect(${this._selectedCell})">
                                📦 收副产（${total} 件）
                            </button>`;
                        }
                    }

                    if (slot.stage === 'adult' && slot.breed) {
                        const now = Date.now();
                        const since = slot.breed.lastBreedAt
                            ? Math.floor((now - slot.breed.lastBreedAt) / 1000)
                            : Infinity;
                        const canBreed = since >= slot.breed.cooldown;
                        const cdLeft = canBreed ? 0 : slot.breed.cooldown - since;

                        if (canBreed) {
                            const breedAction = sim.actions.find(a =>
                                a.special === 'breed' || a.name === '繁殖'
                            );
                            if (breedAction) {
                                btn += `<button class="cw-sim-detail-action"
                                    onclick="SimulationUIManager._doAction('${breedAction.id}', ${this._selectedCell})">
                                    🐄 繁殖（生 ${slot.breed.offspringName}）
                                </button>`;
                            }
                        } else {
                            btn += `<button class="cw-sim-detail-action disabled" disabled>
                                🐄 繁殖冷却中（${cdLeft}s）
                            </button>`;
                        }
                    }

                    if (slot.sourceItem?.fields?.宰杀产出) {
                        const slaughterAction = sim.actions.find(a =>
                            a.special === 'slaughter' || a.name === '宰杀'
                        );
                        if (slaughterAction) {
                            btn += `<button class="cw-sim-detail-action danger"
                                onclick="SimulationUIManager._doAction('${slaughterAction.id}', ${this._selectedCell})">
                                🔪 宰杀
                            </button>`;
                        }
                    }

                    if (slot.state === 'done' && !slot.secondary) {
                        btn += `<button class="cw-sim-detail-action primary"
                            onclick="SimulationUIManager._quickCollect(${this._selectedCell})">
                            📦 收取
                        </button>`;
                    }
                }
            } else {
                const player = PlayerStateManager.player;
                const placeable = (player.inventory || []).filter(it =>
                    (it.count || 1) > 0 && this._canPlace(it, sim)
                );
                if (placeable.length > 0) {
                    btn = `<button class="cw-sim-detail-action"
                        onclick="SimulationUIManager.switchRight('inventory')">
                        🎒 从背包放入
                    </button>`;
                }
            }

            return `
                <div class="cw-sim-detail-page">
                    <div class="cw-sim-detail-title">格子 ${this._selectedCell + 1}</div>
                    <div class="cw-sim-detail-section">
                        <div class="cw-sim-detail-section-label">土地属性</div>
                        ${attrs}
                    </div>
                    ${slotHTML}
                    ${btn}
                </div>`;
        },

        _renderActions(sim) {
            if (!sim.actions?.length) {
                return `
                    <div class="cw-sim-empty-state">
                        <div class="cw-sim-empty-icon">⚡</div>
                        <div>没有可用的行为</div>
                        <div class="cw-sim-empty-sub">试试"重新生成"</div>
                    </div>`;
            }
            return `
                <div class="cw-sim-action-cards">
                    ${sim.actions.map(a => this._actionCardHTML(a)).join('')}
                </div>`;
        },

        _actionCardHTML(action) {
            const isSelected = this._pending.type === 'action' && this._pending.action?.id === action.id;

            const costRows = Object.entries(action.cost || {}).map(([k, v]) =>
                `<div class="cw-sim-action-detail-row">
                    <span class="detail-label">消耗</span>
                    <span class="detail-value cost">${k} ${v > 0 ? '−' + v : '+' + Math.abs(v)}</span>
                </div>`
            ).join('');

            const effectRows = (action.effects || []).map(e => {
                const sign = e.value > 0 ? '+' : '';
                const color = e.value > 0 ? 'gain' : 'loss';
                return `<div class="cw-sim-action-detail-row">
                    <span class="detail-label">效果</span>
                    <span class="detail-value ${color}">${e.key} ${sign}${e.value}</span>
                </div>`;
            }).join('');

            const targetText = action.target === 'empty' ? '空格子'
                            : action.target === 'slot' ? '有东西的格子'
                            : '任意格子';

            let specialTag = '';
            if (action.special === 'breed') {
                specialTag = `<span class="cw-sim-tag tag-seed" style="margin-left:4px;">繁殖</span>`;
            } else if (action.special === 'slaughter') {
                specialTag = `<span class="cw-sim-tag" style="background:rgba(216,74,74,.2);color:#ffb8b8;margin-left:4px;">宰杀</span>`;
            }

            return `
                <div class="cw-sim-action-card ${isSelected ? 'selected' : ''}"
                    onclick="SimulationUIManager.selectAction('${action.id}')">
                    <div class="cw-sim-action-card-head">
                        <span class="cw-sim-action-card-icon">${action.icon}</span>
                        <div class="cw-sim-action-card-title">
                            <div class="cw-sim-action-card-name">
                                ${action.name}${specialTag}
                            </div>
                            ${action.hint ? `<div class="cw-sim-action-card-hint">${action.hint}</div>` : ''}
                        </div>
                        ${isSelected ? `<span class="cw-sim-action-card-check">✓</span>` : ''}
                    </div>
                    <div class="cw-sim-action-card-details">
                        <div class="cw-sim-action-detail-row">
                            <span class="detail-label">目标</span>
                            <span class="detail-value">${targetText}</span>
                        </div>
                        ${costRows}
                        ${effectRows}
                        ${action.cooldown > 0 ? `
                            <div class="cw-sim-action-detail-row">
                                <span class="detail-label">冷却</span>
                                <span class="detail-value cooldown">${action.cooldown}s</span>
                            </div>
                        ` : ''}
                    </div>
                    <div class="cw-sim-action-card-foot">
                        ${isSelected
                            ? `<span class="foot-hint">已选中 → 点左侧格子施放</span>`
                            : `<span class="foot-hint idle">点击选中</span>`}
                    </div>
                </div>`;
        },

        selectAction(actionId) {
            const sim = this._getSim();
            const action = sim?.actions.find(a => a.id === actionId);
            if (!action) return;

            if (this._pending.type === 'action' && this._pending.action?.id === actionId) {
                this._pending = { type: null, item: null, action: null };
                this._render(true);
                return;
            }

            this._pending = { type: 'action', item: null, action };
            this._render(true);
        },

        _renderInventory(sim) {
            const player = PlayerStateManager.player;
            const allInv = (player.inventory || []).filter(it => (it.count || 1) > 0);
            const placeable = allInv.filter(it => this._canPlace(it, sim));
            const others = allInv.filter(it => !this._canPlace(it, sim));

            if (allInv.length === 0) {
                return `
                    <div class="cw-sim-empty-state">
                        <div class="cw-sim-empty-icon">🎒</div>
                        <div>背包是空的</div>
                        <div class="cw-sim-empty-sub">去「🛒 商店」买些东西吧</div>
                    </div>`;
            }

            let html = '';

            if (placeable.length > 0) {
                html += `<div class="cw-sim-inv-section">
                    <div class="cw-sim-inv-section-title">
                        ✅ 可用于「${sim.type}」
                        <span class="cw-sim-inv-section-count">${placeable.length}</span>
                    </div>
                    ${placeable.map(it => this._invItemHTML(it, sim, true)).join('')}
                </div>`;
            }

            if (others.length > 0) {
                html += `<div class="cw-sim-inv-section">
                    <div class="cw-sim-inv-section-title muted">
                        🚫 不适用
                        <span class="cw-sim-inv-section-count">${others.length}</span>
                    </div>
                    ${others.map(it => this._invItemHTML(it, sim, false)).join('')}
                </div>`;
            }

            return html;
        },

        _invItemHTML(item, sim, usable) {
            const isSelected = this._pending.type === 'place'
                && this._pending.item
                && this._pending.item.name === item.name;

            const type = String(item.fields?.类型 || '');
            const dur = item.fields?.耗时 || item.fields?.生长时间 || '';
            const out = item.fields?.产出 || '';
            const sec = item.fields?.副产品 || '';
            const stock = item.fields?.销售次数 || item.fields?.库存 || '';
            const price = item.fields?.售价 || '';
            const offspring = item.fields?.繁殖产出 || '';

            let typeTag = '';
            if (/产物/.test(type)) typeTag = `<span class="cw-sim-tag tag-product">产物</span>`;
            else if (/商品/.test(type)) typeTag = `<span class="cw-sim-tag tag-goods">商品</span>`;
            else if (/种子|作物/.test(type)) typeTag = `<span class="cw-sim-tag tag-seed">种子</span>`;
            else if (/牲畜/.test(type)) typeTag = `<span class="cw-sim-tag" style="background:rgba(180,140,220,.2);color:#c8a8ff;">牲畜</span>`;
            else if (type) typeTag = `<span class="cw-sim-tag">${type}</span>`;

            const clickHandler = usable
                ? `onclick="SimulationUIManager.selectItemForPlace('${this._escapeAttr(item.name)}')"`
                : '';

            return `
                <div class="cw-sim-inv-card ${isSelected ? 'selected' : ''} ${usable ? '' : 'disabled'}"
                    ${clickHandler}>
                    <div class="cw-sim-inv-card-icon">${item.icon || '📦'}</div>
                    <div class="cw-sim-inv-card-info">
                        <div class="cw-sim-inv-card-name-row">
                            <span class="cw-sim-inv-card-name">${item.name}</span>
                            ${typeTag}
                        </div>
                        <div class="cw-sim-inv-card-desc">${item.description || ''}</div>
                        <div class="cw-sim-inv-card-tags">
                            <span class="cw-sim-mini-tag">×${item.count || 1}</span>
                            ${dur ? `<span class="cw-sim-mini-tag">⏱ ${dur}</span>` : ''}
                            ${out ? `<span class="cw-sim-mini-tag">→ ${out}</span>` : ''}
                            ${sec ? `<span class="cw-sim-mini-tag">🥛 ${sec}</span>` : ''}
                            ${offspring ? `<span class="cw-sim-mini-tag">🐄 ${offspring}</span>` : ''}
                            ${stock ? `<span class="cw-sim-mini-tag">📦 ${stock}</span>` : ''}
                            ${price ? `<span class="cw-sim-mini-tag">💰 ${price}</span>` : ''}
                        </div>
                    </div>
                    ${isSelected ? `<div class="cw-sim-inv-card-mark">待放入</div>` : ''}
                </div>`;
        },

        selectItemForPlace(itemName) {
            const player = PlayerStateManager.player;
            const item = (player.inventory || []).find(it => it.name === itemName);
            if (!item) return;

            if (this._pending.type === 'place' && this._pending.item?.name === itemName) {
                this._pending = { type: null, item: null, action: null };
                this._render(true);
                return;
            }

            this._pending = { type: 'place', item, action: null };
            this._render(true);
        },

        _renderShop(sim) {
            const stocks = sim.stocks || [];
            const player = PlayerStateManager.player;
            const currencyKey = this._findCurrencyKey();
            const raw = String(player.extraStats?.[currencyKey] ?? '0');
            const gold = parseFloat(raw.replace(/[^\d.\-]/g, '')) || 0;

            if (stocks.length === 0) {
                return `
                    <div class="cw-sim-empty-state">
                        <div class="cw-sim-empty-icon">🛒</div>
                        <div>商店没有内容物</div>
                        <div class="cw-sim-empty-sub">试试"重新生成"</div>
                    </div>`;
            }

            return `
                <div class="cw-sim-shop-header">
                    <span>可用资金</span>
                    <strong>💰 ${gold}</strong>
                </div>
                <div class="cw-sim-shop-list">
                    ${stocks.map((item, i) => this._shopItemHTML(item, i, gold)).join('')}
                </div>`;
        },

        _shopItemHTML(item, index, gold) {
            const price = parseFloat(String(item.fields?.售价 ?? '0').replace(/[^\d.\-]/g, '')) || 0;
            const canAfford = gold >= price;
            const type = String(item.fields?.类型 || '');
            const isProduct = /产物/.test(type);
            const dur = item.fields?.耗时 || item.fields?.生长时间 || '';
            const out = item.fields?.产出 || '';
            const sec = item.fields?.副产品 || '';
            const effect = item.fields?.效果 || '';

            let typeTag = '';
            if (isProduct) typeTag = `<span class="cw-sim-tag tag-product">产物</span>`;
            else if (/商品/.test(type)) typeTag = `<span class="cw-sim-tag tag-goods">商品</span>`;
            else if (/种子|作物/.test(type)) typeTag = `<span class="cw-sim-tag tag-seed">种子</span>`;
            else if (/牲畜/.test(type)) typeTag = `<span class="cw-sim-tag" style="background:rgba(180,140,220,.2);color:#c8a8ff;">牲畜</span>`;
            else if (type) typeTag = `<span class="cw-sim-tag">${type}</span>`;

            return `
                <div class="cw-sim-shop-item ${canAfford ? '' : 'disabled'}"
                    onclick="SimulationUIManager._buyStock(${index})">
                    <div class="cw-sim-shop-icon">${item.icon || '📦'}</div>
                    <div class="cw-sim-shop-info">
                        <div class="cw-sim-shop-name-row">
                            <span class="cw-sim-shop-name">${item.name}</span>
                            ${typeTag}
                        </div>
                        <div class="cw-sim-shop-desc">${item.description || ''}</div>
                        <div class="cw-sim-shop-tags">
                            ${dur ? `<span class="cw-sim-mini-tag">⏱ ${dur}</span>` : ''}
                            ${out ? `<span class="cw-sim-mini-tag">→ ${out}</span>` : ''}
                            ${sec ? `<span class="cw-sim-mini-tag">🥛 ${sec}</span>` : ''}
                            ${effect ? `<span class="cw-sim-mini-tag tag-effect">✨ ${effect}</span>` : ''}
                        </div>
                    </div>
                    <div class="cw-sim-shop-buy">
                        <div class="cw-sim-shop-price">💰${price}</div>
                        <div class="cw-sim-shop-btn ${canAfford ? '' : 'no-money'}">
                            ${canAfford ? '购买' : '缺钱'}
                        </div>
                    </div>
                </div>`;
        },

        _buyStock(index) {
            const sim = this._getSim();
            if (!sim) return;
            const item = sim.stocks[index];
            if (!item) return;
            const price = parseFloat(String(item.fields?.售价 ?? '0').replace(/[^\d.\-]/g, '')) || 0;
            const currencyKey = this._findCurrencyKey();
            const player = PlayerStateManager.player;
            const raw = String(player.extraStats?.[currencyKey] ?? '0');
            const gold = parseFloat(raw.replace(/[^\d.\-]/g, '')) || 0;

            if (gold < price) { window.UIManager.showText('❌ 钱不够', 1200); return; }

            const unitMatch = raw.match(/([^\d.\-]*)$/);
            const unit = unitMatch ? unitMatch[1] : '';
            player.extraStats[currencyKey] = `${Math.max(0, gold - price)}${unit}`;

            const ex = player.inventory.find(i => i.name === item.name);
            if (ex) ex.count = (ex.count || 1) + 1;
            else player.inventory.push({
                name: item.name,
                count: 1,
                icon: item.icon || '📦',
                description: item.description || '',
                fields: { ...(item.fields || {}) },
                interactions: item.interactions || [],
                type: 'item',
            });

            PlayerStateManager.refreshAvatarArea();
            this._render(true);
            if (window.SaveManager) window.SaveManager.save();
        },

        _findCurrencyKey() {
            const extra = PlayerStateManager.player.extraStats;
            if (!extra?._order) return '金币';
            return extra._order.find(k => /金币|金钱|钱/.test(k)) || '金币';
        },

        _renderLog(sim) {
            const raw = (sim.pending?.log || []).slice(-100);
        
            if (raw.length === 0) {
                return `
                    <div class="cw-sim-empty-state">
                        <div class="cw-sim-empty-icon">📭</div>
                        <div>暂无日志</div>
                        <div class="cw-sim-empty-sub">卖出、成熟、属性变化会记录在这里</div>
                    </div>`;
            }
        
            // ★ 渲染时兜底折叠：把"相邻、同 groupKey"的再压一遍
            //    （防止旧存档或外部写入的条目没走 _log）
            const collapsed = this._collapseLogs(raw);
        
            // 倒序（最新的在上面）
            const displayed = collapsed.slice(-50).reverse();
        
            return `
                <div class="cw-sim-log-list">
                    ${displayed.map(l => this._renderLogLine(l)).join('')}
                </div>`;
        },
        _collapseLogs(logs) {
            const out = [];
            for (const l of logs) {
                const key = l.groupKey || l.text;
                const last = out[out.length - 1];
        
                // 相邻 + 同 key + 5 秒内 → 合并
                if (last
                    && (last.groupKey || last.text) === key
                    && (l.ts - (last.lastTs || last.ts)) <= 5000) {
                    last.count = (last.count || 1) + (l.count || 1);
                    last.lastTs = Math.max(last.lastTs || 0, l.ts);
                    // 合并 meta（用于后续显示总数）
                    if (l.meta && last.meta) {
                        for (const k of Object.keys(l.meta)) {
                            if (typeof l.meta[k] === 'number' && typeof last.meta[k] === 'number') {
                                last.meta[k] += l.meta[k];
                            }
                        }
                    }
                    continue;
                }
        
                out.push({
                    ...l,
                    count: l.count || 1,
                });
            }
            return out;
        },
        
        _renderLogLine(l) {
            const timeStr = this._fmtTime(l.ts);
            const count = l.count || 1;
        
            let text = l.text;
        
            if (count > 1 && l.meta) {
                // ★ 卖出类：显示总计
                if (l.meta.itemName && l.meta.count !== undefined && l.meta.gain !== undefined) {
                    const totalCount = l.meta.count;
                    const totalGain = l.meta.gain;
                    text = `${l.meta.itemName} 卖出 ${totalCount} 个，+${totalGain}`;
                    if (count > 1) {
                        text += `（合并 ${count} 次）`;
                    }
                }
                // ★ 字段类：显示累计
                else if (l.meta.field && l.meta.delta !== undefined) {
                    const total = l.meta.delta;
                    const sign = total > 0 ? '+' : '';
                    text = `${l.meta.field} ${sign}${total.toFixed(1)}`;
                    if (count > 1) {
                        text += `（合并 ${count} 次）`;
                    }
                }
                // 兜底：文本 ×N
                else {
                    text = `${l.text} ×${count}`;
                }
            } else if (count > 1) {
                text = `${l.text} ×${count}`;
            }
        
            return `
                <div class="cw-sim-log-line">
                    <span class="cw-sim-log-time">${timeStr}</span>
                    <span class="cw-sim-log-text">${text}</span>
                </div>`;
        },
        
        // 如果原文本里已经有 ×N 或数字，尽量精简
        _stripCount(text) {
            // 目前原样返回，交给调用方保证 text 里没有动态数字。
            // 如果将来 text 里带动态数字，可以在这里统一处理。
            return text;
        },
        _fmtTime(ts) {
            const d = new Date(ts);
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
        },

        async flushPending() {
            const summary = SimulationEngine.flushNow();
            if (summary.money > 0) {
                window.UIManager.showText(`💰 结算 +${summary.money}`, 1500);
            }
        },

        _canPlace(item, sim) {
            const t = String(item.fields?.类型 || '').trim();
            if (!t) return false;
            for (const key of Object.keys(sim.slotTypes || {})) {
                if (t === key || t.includes(key) || key.includes(t)) return true;
            }
            return false;
        },

        _escapeAttr(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, "\\'")
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },

        _openRules() {
            const sim = this._getSim();
            if (!sim) return;
            const modal = document.getElementById('cinemaworld-modal');
            const oldClass = modal.className;
            const oldHTML = modal.innerHTML;

            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📜 经营规则</div>
                <div class="cw-sim-rules-scroll">${this._renderRulesHTML(sim)}</div>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button" id="cw-sim-rules-close">关闭</button>
                </div>`;

            document.getElementById('cw-sim-rules-close').onclick = () => {
                modal.className = oldClass;
                modal.innerHTML = oldHTML;
            };
        },

        _renderRulesHTML(sim) {
            let html = '';
            if (sim.cellTemplate) {
                html += `<div class="cw-sim-rule-section">
                    <div class="cw-sim-rule-title">格子模板</div>
                    ${sim.cellTemplate._order.map(k => {
                        const b = sim.cellTemplate.bounds[k];
                        return `<div class="cw-sim-rule-line">
                            <span>${k}</span>
                            <span>初始 ${sim.cellTemplate.fields[k]}${b ? ` · ${b[0]}~${b[1]}` : ''}</span>
                        </div>`;
                    }).join('')}
                </div>`;
            }
            if (Object.keys(sim.slotTypes).length) {
                html += `<div class="cw-sim-rule-section">
                    <div class="cw-sim-rule-title">槽位类型</div>
                    ${Object.entries(sim.slotTypes).map(([k, v]) =>
                        `<div class="cw-sim-rule-line">
                            <span>${v.icon} ${k}</span>
                            <span>模式:${v.mode} · 完成→${v.doneLabel}</span>
                        </div>`
                    ).join('')}
                </div>`;
            }
            if (sim.rules.time?.length) {
                html += `<div class="cw-sim-rule-section">
                    <div class="cw-sim-rule-title">时间规则</div>
                    ${sim.rules.time.map(r =>
                        `<div class="cw-sim-rule-line">
                            <span>${r.key}</span>
                            <span>每 ${r.interval}s ${r.delta > 0 ? '+' : ''}${r.delta}</span>
                        </div>`
                    ).join('')}
                </div>`;
            }
            if (sim.rules.completion?.length) {
                html += `<div class="cw-sim-rule-section">
                    <div class="cw-sim-rule-title">完成规则</div>
                    ${sim.rules.completion.map(r => `
                        <div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.05);">
                            <div style="color:#7da8ff;font-size:12px;font-weight:600;margin-bottom:4px;">${r.slotType}</div>
                            ${r.high.length ? `<div class="cw-sim-rule-line"><span>高产</span><span>${r.high.map(c => `${c.key}${c.op}${c.value}`).join(' 且 ')}</span></div>` : ''}
                            ${r.normal.length ? `<div class="cw-sim-rule-line"><span>普产</span><span>${r.normal.map(c => `${c.key}${c.op}${c.value}`).join(' 且 ')}</span></div>` : ''}
                            <div class="cw-sim-rule-line"><span>倍率</span><span>${r.multipliers.high}/${r.multipliers.normal}/${r.multipliers.low}</span></div>
                        </div>
                    `).join('')}
                </div>`;
            }
            
            // ★ 新增：环境规则
            if (sim.envRules?.length) {
                html += `<div class="cw-sim-rule-section">
                    <div class="cw-sim-rule-title">环境规则</div>
                    ${sim.envRules.map(r => {
                        const when = r.when;
                        let condText = '';
                        switch (when.op) {
                            case '=': case '==': condText = `${when.key} = ${when.value}`; break;
                            case 'contains':     condText = `${when.key} 包含 ${when.value}`; break;
                            default:             condText = `${when.key} ${when.op} ${when.value}`; break;
                        }
                        const eff = r.effect;
                        let effText = '';
                        switch (eff.type) {
                            case 'fieldInterval':
                                effText = `${eff.field} ${eff.delta > 0 ? '+' : ''}${eff.delta}/${eff.interval}s`;
                                break;
                            case 'fieldModifier':
                                effText = `${eff.field} 衰减 ×${eff.multiplier}`;
                                break;
                            case 'timeScale':
                                effText = `${eff.target || '全部'} 生长 ×${eff.multiplier}`;
                                break;
                            case 'outputMultiplier':
                                effText = `产量 ×${eff.multiplier}`;
                                break;
                            case 'consumeModifier':
                                effText = `售卖 ×${eff.multiplier}`;
                                break;
                            default:
                                effText = eff.type;
                        }
                        const activeIcon = r.active ? '✅' : '⭕';
                        return `<div class="cw-sim-rule-line">
                            <span>${activeIcon} ${condText}</span>
                            <span>${effText}</span>
                        </div>`;
                    }).join('')}
                </div>`;
            }
            
            return html || '<div style="text-align:center;color:#666;">暂无规则</div>';
        },

        _renderInitPrompt(entity) {
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            const existing = entity.simulation?.type || entity.fields?.经营类型 || '农田';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">${entity.icon || '🏭'} ${entity.name}</div>
                <div style="text-align:center;padding:20px;color:#aaa;">
                    这个实体还没有初始化经营系统。<br>请选择经营类型。
                </div>
                <div style="margin:15px 0;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:6px;">经营类型：</div>
                    <input type="text" class="cinemaworld-textarea" id="cw-sim-type"
                        value="${existing}" style="min-height:auto;padding:10px;">
                </div>
                <div style="margin:15px 0;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:6px;">额外要求（可选）：</div>
                    <textarea class="cinemaworld-textarea" id="cw-sim-guide"
                        placeholder="例如：一个种小麦和玉米的小农田" style="min-height:80px;"></textarea>
                </div>
                <div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary" id="cw-sim-gen">🤖 AI 生成</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;
            modal.className = 'active';

            document.getElementById('cw-sim-gen').onclick = async () => {
                const type = document.getElementById('cw-sim-type').value.trim() || '农田';
                const guide = document.getElementById('cw-sim-guide').value.trim();
                const btn = document.getElementById('cw-sim-gen');
                btn.disabled = true;
                btn.innerHTML = '⏳ 生成中...';

                const sim = await SimulationGenerator.generate(entity.name, type, guide);
                if (!sim) {
                    window.UIManager.showText('❌ 生成失败', 2000);
                    btn.disabled = false;
                    btn.innerHTML = '🤖 AI 生成';
                    return;
                }
                sim.pending = { money: 0, gains: {}, matureCells: [], log: [] };
                sim.lastTick = Date.now();
                entity.simulation = sim;
                entity.fields = entity.fields || {};
                entity.fields['类型'] = '经营';
                entity.fields['经营类型'] = type;
                if (window.SaveManager) window.SaveManager.save();
                window.UIManager.showText(`✅ 经营系统已生成`, 2000);
                this.open(entity.name);
            };
        },

        _resetSim() {
            const entity = this._getEntity();
            if (!entity) return;
            if (!confirm('重新生成会丢失当前所有格子状态，确定吗？')) return;
            entity.simulation = null;
            this._render();
        },

        _injectStyles() {
            // ★ CSS 已移至 style.css
            if (window.CinemaWorldCSS) window.CinemaWorldCSS.ensure();
        },
    };

    // ==================== 挂载到 window ====================
    window.SimulationGenerator = SimulationGenerator;
    window.SimulationEngine = SimulationEngine;
    window.SimulationUIManager = SimulationUIManager;

    console.log('[CinemaWorld] simulation.js 已加载');
})();