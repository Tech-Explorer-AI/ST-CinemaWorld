// ============================================================
// CinemaWorld · strategy-politics-act.js
// 内政行动 / 阶级诉求 / 派系决议
// 依赖：strategy.js, strategy-actions.js
// ============================================================

(function () {
    'use strict';

    const StrategyManager = window.StrategyManager;
    const ActionEngine = window.ActionEngine;
    const VisualNovelManager = window.VisualNovelManager;

    const PoliticsActionManager = {
        _generating: false,

        // ------------------------------------------------------------
        // 存储
        // ------------------------------------------------------------
        ensureStore() {
            const s = StrategyManager.ensureStore();
            if (!s.politicsActions) s.politicsActions = [];
            if (!s.classDemands)   s.classDemands   = {};   // { className: [demands] }
            if (!s.factionResolutions) s.factionResolutions = {}; // { groupName: [resolutions] }
            return s;
        },

        // ============================================================
        // 一、内政行动
        // ============================================================
        getActions() {
            return this.ensureStore().politicsActions.filter(a => a.status === 'available');
        },

        getAction(id) {
            return this.ensureStore().politicsActions.find(a => a.id === id) || null;
        },

        async generateActions(context = '') {
            if (this._generating) return null;
            const p = StrategyManager.ensurePolitics();
            if (!p.initialized) return null;

            this._generating = true;
            try {
                const playerFaction = StrategyManager.getPlayerFaction();
                const factionText = StrategyManager._formatFactionFields(playerFaction);
                const politicsText = this._formatPoliticsForPrompt(p);

                const prompt = `你正在为一个视觉小说游戏生成"内政行动"。
内政行动会改变内政数据（阶级、派系、经济），有成功率，失败也有后果。

【我方势力】
${playerFaction?.icon} ${playerFaction?.name}
${factionText}

【内政现状】
${politicsText}

${context ? `【玩家要求】\n${context}\n` : ''}

【任务】
生成 5 个内政行动，覆盖不同方向（经济 / 阶级 / 派系 / 改革 / 镇压）。

【输出格式】（严格遵守）

- 【行动名|图标】：描述，[类型:内政|消耗:粮草-3000,威望-5]
  成功率: 55
  修正:
  - 农民阶级支持 +15
  - 封建地主反对 -20
  成功效果:
  内政变化:
  - 阶级:农民: 支持度 +10
  - 阶级:封建地主: 政治力量 -5
  - 派系:改革派: 政治力量 +5
  成功剧情:
  【旁白】: 一道诏书从宫中发出……
  失败效果:
  内政变化:
  - 阶级:封建地主: 不满 +15
  我方势力:
  - 威望 -10
  失败剧情:
  【旁白】: 诏书被地方官员阳奉阴违……

【规则】
1. 行动要具体，如"丈量土地"、"减免赋税"、"提拔寒门"、"裁撤冗员"、"兴修水利"。
2. 修正项必须引用【内政现状】中真实存在的阶级/派系/集团名。
3. 成功率 5-95。
4. 消耗引用我方势力字段。
5. 内政变化格式：阶级:名字: 字段 +N 或 派系:名字: 字段 +N 或 集团:名字: 字段 +N。
   - 字段可以是：政治力量、支持度、不满、觉悟、动员力、pop、wealthShare、efficiency。
   - pop/wealthShare 用百分比，如 人口 -5%。
6. 成功/失败剧情 3-6 行。

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'strategy-politics-actions');
                if (!result) return null;
                const actions = this._parseActions(result);

                // 保留已执行的，替换可用的
                const store = this.ensureStore();
                const done = store.politicsActions.filter(a => a.status !== 'available');
                store.politicsActions = [...done, ...actions];

                if (window.SaveManager) window.SaveManager.save();
                return actions;
            } finally {
                this._generating = false;
            }
        },

        _formatPoliticsForPrompt(p) {
            const parts = [];
            const classes = Object.values(p.classes || {});
            if (classes.length > 0) {
                parts.push('阶级：');
                for (const c of classes) {
                    parts.push(`- ${c.name}：政治力量 ${c.politicalPower}，支持 ${c.support}，不满 ${c.discontent || 0}，动员力 ${c.mobilization}，人口 ${(c.pop*100).toFixed(1)}%`);
                }
            }
            const groups = Object.values(p.interestGroups || {});
            if (groups.length > 0) {
                parts.push('利益集团与派系：');
                for (const g of groups) {
                    parts.push(`- ${g.name}：政治力量 ${g.politicalPower}，支持 ${g.support}`);
                    for (const f of Object.values(g.factions || {})) {
                        parts.push(`  · ${f.name}（${f.stance || '中立'}）：力量 ${f.politicalPower}，支持 ${f.support}`);
                    }
                }
            }
            return parts.join('\n');
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
                const a = this._parseActionBlock(block);
                if (a) actions.push(a);
            }
            return actions;
        },

        _parseActionBlock(block) {
            const firstLine = block.split('\n')[0];
            const nameM = firstLine.match(/^【(.+?)】/);
            if (!nameM) return null;

            const parts = nameM[1].split('|').map(s => s.trim());
            const action = {
                id: `pol_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                kind: 'domestic',
                name: parts[0] || '',
                icon: '⚙️',
                hint: '',
                meta: {},
                cost: {},
                check: { base: 50, modifiers: [] },
                onSuccess: {},
                onFailure: {},
                status: 'available',
                createdAt: Date.now(),
            };
            if (parts[1]) {
                const e = window.WorldManager?._extractEmoji(parts[1]);
                if (e) action.icon = e;
            }

            const afterName = firstLine.substring(nameM[0].length).replace(/^[：:]\s*/, '');
            const bracketM = afterName.match(/^([\s\S]*?)\s*[\[【]([^\]】]+)[\]】]\s*$/);
            if (bracketM) {
                action.hint = bracketM[1].trim();
                for (const f of bracketM[2].split('|')) {
                    const kv = f.match(/^(.+?)[:：]\s*(.+)$/);
                    if (!kv) continue;
                    if (kv[1].trim() === '消耗') action.cost = this._parseCost(kv[2].trim());
                    else action.meta[kv[1].trim()] = kv[2].trim();
                }
            } else {
                action.hint = afterName.trim();
            }

            const rateM = block.match(/成功率[:：]\s*([\d.]+)/);
            if (rateM) action.check.base = parseFloat(rateM[1]) || 50;

            const modBlock = block.match(/修正[:：]?\s*\n([\s\S]*?)(?=成功效果|失败效果|$)/);
            if (modBlock) {
                for (const raw of modBlock[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const m = line.match(/^[-•]\s*(.+?)\s*([+\-])\s*(\d+(?:\.\d+)?)$/);
                    if (!m) continue;
                    action.check.modifiers.push({
                        label: m[1].trim(),
                        source: this._guessSource(m[1].trim()),
                        value: m[2] === '+' ? parseFloat(m[3]) : -parseFloat(m[3]),
                    });
                }
            }

            action.onSuccess = this._parseBranch(block, '成功');
            action.onFailure = this._parseBranch(block, '失败');
            return action.name ? action : null;
        },

        _parseCost(text) {
            const cost = {};
            for (const part of text.split(/[、,，]/).map(s => s.trim()).filter(Boolean)) {
                const m = part.match(/^(.+?)\s*([+\-])\s*(\d+(?:\.\d+)?)$/);
                if (m) cost[m[1].trim()] = m[2] === '+' ? parseFloat(m[3]) : -parseFloat(m[3]);
            }
            return cost;
        },

        _guessSource(label) {
            const p = StrategyManager.ensurePolitics();
            if (!p) return `unknown:${label}`;
            const clean = label.replace(/[支持反对力量阶级]/g, '').trim();
            for (const g of Object.values(p.interestGroups || {})) {
                for (const fname of Object.keys(g.factions || {})) {
                    if (fname.includes(clean) || clean.includes(fname)) return `faction:${fname}`;
                }
            }
            for (const cname of Object.keys(p.classes || {})) {
                if (cname.includes(clean) || clean.includes(cname)) return `class:${cname}`;
            }
            for (const gname of Object.keys(p.interestGroups || {})) {
                if (gname.includes(clean) || clean.includes(gname)) return `group:${gname}`;
            }
            return `unknown:${label}`;
        },

        _parseBranch(block, label) {
            const nextLabel = label === '成功' ? '失败效果' : '【|$';
            const m = block.match(new RegExp(`${label}效果[:：]?\\s*\\n([\\s\\S]*?)(?=${nextLabel})`));
            if (!m) return {};
            const content = m[1];

            // 内政变化
            const politicsEffect = { classes: [], groups: [], factions: [], economy: [] };
            const polBlock = content.match(/内政变化[:：]?\s*\n([\s\S]*?)(?=我方势力|势力数据|${label}剧情|$)/);
            if (polBlock) {
                for (const raw of polBlock[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const parsed = this._parsePoliticsChangeLine(line);
                    if (parsed) {
                        if (parsed.type === 'class') politicsEffect.classes.push(parsed.data);
                        else if (parsed.type === 'group') politicsEffect.groups.push(parsed.data);
                        else if (parsed.type === 'faction') politicsEffect.factions.push(parsed.data);
                        else if (parsed.type === 'economy') politicsEffect.economy.push(parsed.data);
                    }
                }
            }

            // 剧情
            const scriptM = content.match(new RegExp(`${label}剧情[:：]\\s*([\\s\\S]*?)(?=失败效果|失败剧情|【|$)`));
            const script = scriptM ? scriptM[1].trim() : '';

            // 剩余效果拼成 effectPart（我方势力变化等）
            let effText = content
                .replace(new RegExp(`内政变化[:：]?[\\s\\S]*?(?=我方势力|势力数据|${label}剧情|$)`), '')
                .replace(new RegExp(`${label}剧情[:：][\\s\\S]*$`), '')
                .trim();
            const effectPart = effText ? `【效果】\n${effText}` : '';

            return { script, effectPart, politicsEffect };
        },

        // "- 阶级:农民: 支持度 +10"
        // "- 派系:改革派: 政治力量 +5"
        _parsePoliticsChangeLine(line) {
            const m = line.match(/^[-•]\s*(阶级|集团|派系|经济)[:：]\s*(.+?)[:：]\s*(.+)$/);
            if (!m) return null;
            const type = { '阶级': 'class', '集团': 'group', '派系': 'faction', '经济': 'economy' }[m[1]];
            const name = m[2].trim();
            const changes = this._parseChangeList(m[3].trim());

            if (type === 'economy') {
                return { type, data: changes.map(c => ({ path: name, ...c })) };
            }

            return {
                type,
                data: changes.map(c => ({ name, field: c.field, op: c.op, value: c.value })),
            };
        },

        _parseChangeList(text) {
            const out = [];
            for (const part of text.split(/[、,，]/).map(s => s.trim()).filter(Boolean)) {
                const m = part.match(/^(.+?)\s*([+\-])\s*(\d+(?:\.\d+)?)%?$/);
                if (m) {
                    const isPercent = part.endsWith('%');
                    let v = parseFloat(m[3]);
                    if (isPercent) v = v / 100;
                    out.push({
                        field: m[1].trim(),
                        op: m[2] === '+' ? 'add' : 'subtract',
                        value: v,
                    });
                }
            }
            return out;
        },

        async execute(actionId) {
            const action = this.getAction(actionId);
            if (!action) return { ok: false, reason: '行动不存在' };
            if (action.status !== 'available') return { ok: false, reason: '该行动已执行' };

            const ctx = { politics: StrategyManager.ensurePolitics() };
            const result = await ActionEngine.execute(action, ctx);

            action.status = result.success ? 'success' : 'failed';
            action.executedAt = Date.now();
            action.lastResult = result;

            if (window.InteractionHistoryManager) {
                window.InteractionHistoryManager.add({
                    type: 'strategy-domestic',
                    target: action.name,
                    targetMeta: { icon: action.icon },
                    scene: '(内政)',
                    playerInput: action.name,
                    summary: `${result.success ? '成功' : '失败'}（成功率 ${result.check.final}%）`,
                });
            }

            if (window.SaveManager) window.SaveManager.save();
            return { ok: true, result, action };
        },

        // ============================================================
        // 二、阶级诉求
        // ============================================================
        getDemands(className) {
            return this.ensureStore().classDemands[className] || [];
        },

        getAllDemands() {
            const all = [];
            const store = this.ensureStore();
            for (const [cls, list] of Object.entries(store.classDemands)) {
                for (const d of list) all.push({ ...d, className: cls });
            }
            return all;
        },

        async generateDemands(context = '') {
            if (this._generating) return null;
            const p = StrategyManager.ensurePolitics();
            if (!p.initialized) return null;

            this._generating = true;
            try {
                const classes = Object.values(p.classes);
                const classText = classes.map(c =>
                    `- ${c.name}（政治力量 ${c.politicalPower}，支持 ${c.support}，不满 ${c.discontent || 0}，觉悟 ${c.consciousness || 0}，人口 ${(c.pop*100).toFixed(1)}%）`
                ).join('\n');

                const prompt = `你正在为一个视觉小说游戏生成"阶级诉求"。
每个阶级会根据自身状态提出诉求，玩家可以满足、无视或镇压。

【阶级现状】
${classText}

${context ? `【玩家要求】\n${context}\n` : ''}

【任务】
为每个阶级生成 1-2 个诉求。

【输出格式】（严格遵守）

【阶级名】
- 【诉求名|图标】：描述
  满足效果:
  - 阶级:本阶级: 支持度 +15
  - 我方势力: 粮草 -5000
  无视后果:
  - 阶级:本阶级: 不满 +10
  镇压成功率: 40
  镇压成功:
  - 阶级:本阶级: 不满 +20, 政治力量 -10
  镇压失败:
  - 阶级:本阶级: 不满 +40, 政治力量 +10

【规则】
1. 诉求要符合阶级状态：
   - 不满高 → 诉求激烈（"降低赋税"、"开仓放粮"）
   - 觉悟高 → 政治诉求（"扩大参政"、"废除特权"）
   - 政治力量低 → 诉求温和（"请求减税"）
2. 满足效果要有代价（消耗我方资源）。
3. 镇压成功率 5-95，镇压成功也会引起不满。
4. 每个诉求必须引用本阶级名。
5. 所有描述用中文。

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'strategy-demands');
                if (!result) return null;

                const demands = this._parseDemands(result);
                const store = this.ensureStore();
                for (const [cls, list] of Object.entries(demands)) {
                    store.classDemands[cls] = list;
                }

                if (window.SaveManager) window.SaveManager.save();
                return demands;
            } finally {
                this._generating = false;
            }
        },

        _parseDemands(text) {
            const result = {};
            const classBlocks = [];
            let cur = null;
            for (const raw of text.split('\n')) {
                const line = raw.trim();
                if (/^【[^】]+】\s*$/.test(line) && !/【诉求/.test(line)) {
                    if (cur) classBlocks.push(cur);
                    cur = { name: line.match(/^【(.+?)】/)[1], content: '' };
                } else if (cur !== null) {
                    cur.content += '\n' + raw;
                }
            }
            if (cur) classBlocks.push(cur);

            for (const cb of classBlocks) {
                result[cb.name] = this._parseDemandList(cb.content);
            }
            return result;
        },

        _parseDemandList(content) {
            const demands = [];
            const blocks = [];
            let cur = null;
            for (const raw of content.split('\n')) {
                const line = raw.trim();
                if (line.startsWith('- 【')) {
                    if (cur) blocks.push(cur);
                    cur = line;
                } else if (cur !== null) {
                    cur += '\n' + raw;
                }
            }
            if (cur) blocks.push(cur);

            for (const block of blocks) {
                const headM = block.match(/^[-•]\s*【(.+?)】/);
                if (!headM) continue;
                const parts = headM[1].split('|').map(s => s.trim());
                const demand = {
                    id: `demand_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    name: parts[0] || '',
                    icon: '⚠️',
                    desc: '',
                    satisfy: { effectPart: '', politicsEffect: { classes: [], groups: [], factions: [] } },
                    ignore: { effectPart: '', politicsEffect: { classes: [], groups: [], factions: [] } },
                    suppress: {
                        check: { base: 40, modifiers: [] },
                        onSuccess: { effectPart: '', politicsEffect: { classes: [], groups: [], factions: [] } },
                        onFailure: { effectPart: '', politicsEffect: { classes: [], groups: [], factions: [] } },
                    },
                    deadline: 0,
                    createdAt: Date.now(),
                };
                if (parts[1]) {
                    const e = window.WorldManager?._extractEmoji(parts[1]);
                    if (e) demand.icon = e;
                }

                const descM = block.match(/】[：:]\s*(.+)/);
                if (descM) demand.desc = descM[1].trim();

                // 满足效果
                const satM = block.match(/满足效果[:：]?\s*\n([\s\S]*?)(?=无视后果|镇压成功率|$)/);
                if (satM) {
                    const parsed = this._parseEffectBlock(satM[1]);
                    demand.satisfy = parsed;
                }

                // 无视后果
                const ignM = block.match(/无视后果[:：]?\s*\n([\s\S]*?)(?=镇压成功率|镇压成功|$)/);
                if (ignM) {
                    const parsed = this._parseEffectBlock(ignM[1]);
                    demand.ignore = parsed;
                }

                // 镇压
                const supM = block.match(/镇压成功率[:：]\s*([\d.]+)/);
                if (supM) demand.suppress.check.base = parseFloat(supM[1]) || 40;

                const supOkM = block.match(/镇压成功[:：]?\s*\n([\s\S]*?)(?=镇压失败|$)/);
                if (supOkM) {
                    const parsed = this._parseEffectBlock(supOkM[1]);
                    demand.suppress.onSuccess = parsed;
                }
                const supFailM = block.match(/镇压失败[:：]?\s*\n([\s\S]*?)$/);
                if (supFailM) {
                    const parsed = this._parseEffectBlock(supFailM[1]);
                    demand.suppress.onFailure = parsed;
                }

                demands.push(demand);
            }
            return demands;
        },

        _parseEffectBlock(text) {
            const politicsEffect = { classes: [], groups: [], factions: [], economy: [] };
            let otherText = '';
            for (const raw of text.split('\n')) {
                const line = raw.trim();
                if (!line.startsWith('-')) continue;
                const parsed = this._parsePoliticsChangeLine(line);
                if (parsed) {
                    if (parsed.type === 'class') politicsEffect.classes.push(...parsed.data);
                    else if (parsed.type === 'group') politicsEffect.groups.push(...parsed.data);
                    else if (parsed.type === 'faction') politicsEffect.factions.push(...parsed.data);
                    else if (parsed.type === 'economy') politicsEffect.economy.push(...parsed.data);
                } else {
                    otherText += line + '\n';
                }
            }
            return {
                effectPart: otherText ? `【效果】\n${otherText}` : '',
                politicsEffect,
            };
        },

        // 动态 deadline
        computeDeadline(className) {
            const p = StrategyManager.ensurePolitics();
            const cls = p.classes[className];
            if (!cls) return 5;
            const dc = cls.discontent || 0;
            return Math.max(1, Math.floor(5 - dc / 25));
        },

        // 玩家处理诉求
        async handleDemand(className, demandId, choice) {
            const store = this.ensureStore();
            const demands = store.classDemands[className] || [];
            const demand = demands.find(d => d.id === demandId);
            if (!demand) return null;

            const ctx = { politics: StrategyManager.ensurePolitics() };
            let result = null;

            if (choice === 'satisfy') {
                result = { success: true, branch: demand.satisfy };
                await ActionEngine._applyBranch(demand.satisfy, ctx);
            } else if (choice === 'ignore') {
                result = { success: true, branch: demand.ignore };
                await ActionEngine._applyBranch(demand.ignore, ctx);
            } else if (choice === 'suppress') {
                const success = ActionEngine.roll(demand.suppress.check);
                const branch = success ? demand.suppress.onSuccess : demand.suppress.onFailure;
                result = { success, branch, check: demand.suppress.check };
                await ActionEngine._applyBranch(branch, ctx);
            }

            // 移除诉求
            store.classDemands[className] = demands.filter(d => d.id !== demandId);

            if (window.SaveManager) window.SaveManager.save();
            return result;
        },

        // 每回合结算诉求（deadline）
        settleDemands() {
            const store = this.ensureStore();
            const p = StrategyManager.ensurePolitics();
            const expired = [];

            for (const [cls, list] of Object.entries(store.classDemands)) {
                const remain = [];
                for (const d of list) {
                    d.deadline--;
                    if (d.deadline <= 0) {
                        // 自动恶化
                        const classObj = p.classes[cls];
                        if (classObj) {
                            classObj.discontent = Math.min(100, (classObj.discontent || 0) + 15);
                        }
                        expired.push({ className: cls, demand: d });
                    } else {
                        remain.push(d);
                    }
                }
                store.classDemands[cls] = remain;
            }
            return expired;
        },

        // ============================================================
        // 三、派系决议
        // ============================================================
        getResolutions() {
            return Object.values(this.ensureStore().factionResolutions).flat();
        },

        async generateResolutions(context = '') {
            if (this._generating) return null;
            const p = StrategyManager.ensurePolitics();
            if (!p.initialized) return null;

            this._generating = true;
            try {
                const groups = Object.values(p.interestGroups);
                const groupText = groups.map(g => {
                    const facs = Object.values(g.factions || {});
                    return `- ${g.name}（力量 ${g.politicalPower}，支持 ${g.support}）\n` +
                        facs.map(f => `  · ${f.name}（${f.stance || '中立'}，力量 ${f.politicalPower}，支持 ${f.support}）`).join('\n');
                }).join('\n');

                const prompt = `你正在为一个视觉小说游戏生成"派系决议"。
派系会主动发起决议，玩家可以选择支持 / 反对 / 搁置。

【利益集团与派系】
${groupText}

${context ? `【玩家要求】\n${context}\n` : ''}

【任务】
为每个主要派系生成 1 个决议。

【输出格式】（严格遵守）

【集团名|派系名|图标】
决议: 决议名
描述: 一段话
支持:
  成功率: 60
  修正:
  - 农民阶级支持 +15
  - 封建地主反对 -20
  效果:
  - 派系:本派系: 政治力量 +10, 支持 +5
  剧情:
  【旁白】: 朝堂上，改革派大臣慷慨陈词……
反对:
  成功率: 50
  修正:
  - 封建地主支持 +20
  效果:
  - 派系:本派系: 政治力量 -5, 支持 -5
  剧情:
  【旁白】: 反对的声音更加强烈……
搁置:
  成功率: 80
  修正:
  - 中立派支持 +10
  效果:
  - 派系:本派系: 支持 -3
  剧情:
  【旁白】: 皇帝将奏折放在一边，不置可否。

【规则】
1. 决议要符合派系立场（守旧派提保守决议，改革派提改革决议）。
2. 修正项引用真实存在的阶级/派系/集团名。
3. 三种选项的成功率 5-95。
4. 效果引用真实存在的名字。
5. 所有描述用中文。

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'strategy-resolutions');
                if (!result) return null;

                const resolutions = this._parseResolutions(result);
                const store = this.ensureStore();
                // 按集团分组
                for (const r of resolutions) {
                    if (!store.factionResolutions[r.groupName]) store.factionResolutions[r.groupName] = [];
                    store.factionResolutions[r.groupName].push(r);
                }

                if (window.SaveManager) window.SaveManager.save();
                return resolutions;
            } finally {
                this._generating = false;
            }
        },

        _parseResolutions(text) {
            const resolutions = [];
            const blocks = [];
            let cur = null;
            for (const raw of text.split('\n')) {
                const line = raw.trim();
                if (/^【[^】]+】\s*$/.test(line)) {
                    if (cur) blocks.push(cur);
                    cur = line;
                } else if (cur !== null) {
                    cur += '\n' + raw;
                }
            }
            if (cur) blocks.push(cur);

            for (const block of blocks) {
                const r = this._parseResolutionBlock(block);
                if (r) resolutions.push(r);
            }
            return resolutions;
        },

        _parseResolutionBlock(block) {
            const headM = block.match(/^【(.+?)】/);
            if (!headM) return null;
            const parts = headM[1].split('|').map(s => s.trim());
            const groupName = parts[0] || '';
            const factionName = parts[1] || '';
            let icon = '🗳️';
            if (parts[2]) {
                const e = window.WorldManager?._extractEmoji(parts[2]);
                if (e) icon = e;
            }

            const nameM = block.match(/决议[:：]\s*(.+)/);
            const descM = block.match(/描述[:：]\s*(.+)/);

            const res = {
                id: `res_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                groupName, factionName, icon,
                name: nameM ? nameM[1].trim() : '决议',
                desc: descM ? descM[1].trim() : '',
                options: {},
                createdAt: Date.now(),
            };

            for (const opt of ['支持', '反对', '搁置']) {
                const optBlock = block.match(new RegExp(`${opt}[:：]?\\s*\\n([\\s\\S]*?)(?=\\n(?:支持|反对|搁置)[:：]|$)`));
                if (!optBlock) continue;

                const content = optBlock[1];
                const rateM = content.match(/成功率[:：]\s*([\d.]+)/);
                const check = { base: rateM ? parseFloat(rateM[1]) : 50, modifiers: [] };

                const modM = content.match(/修正[:：]?\s*\n([\s\S]*?)(?=效果|剧情|$)/);
                if (modM) {
                    for (const raw of modM[1].split('\n')) {
                        const line = raw.trim();
                        if (!line.startsWith('-')) continue;
                        const m = line.match(/^[-•]\s*(.+?)\s*([+\-])\s*(\d+(?:\.\d+)?)$/);
                        if (!m) continue;
                        check.modifiers.push({
                            label: m[1].trim(),
                            source: this._guessSource(m[1].trim()),
                            value: m[2] === '+' ? parseFloat(m[3]) : -parseFloat(m[3]),
                        });
                    }
                }

                const effM = content.match(/效果[:：]?\s*\n([\s\S]*?)(?=剧情|$)/);
                const scriptM = content.match(/剧情[:：]\s*([\s\S]*?)$/);

                const politicsEffect = { classes: [], groups: [], factions: [], economy: [] };
                if (effM) {
                    const parsed = this._parseEffectBlock(effM[1]);
                    Object.assign(politicsEffect, parsed.politicsEffect);
                }

                res.options[opt] = {
                    check,
                    script: scriptM ? scriptM[1].trim() : '',
                    effectPart: '',
                    politicsEffect,
                };
            }

            return res;
        },

        async handleResolution(groupName, resolutionId, choice) {
            const store = this.ensureStore();
            const list = store.factionResolutions[groupName] || [];
            const res = list.find(r => r.id === resolutionId);
            if (!res) return null;

            const option = res.options[choice];
            if (!option) return null;

            const ctx = { politics: StrategyManager.ensurePolitics() };
            const success = ActionEngine.roll(option.check);
            const branch = option;   // 决议只有一套效果（成功/失败共用）

            if (branch.script) {
                const dialogues = VisualNovelManager.parseScript(branch.script);
                if (dialogues.length > 0) await VisualNovelManager.play(dialogues);
            }
            if (branch.politicsEffect) {
                await ActionEngine._applyPoliticsEffect(branch.politicsEffect, ctx);
            }
            if (branch.effectPart) {
                await StrategyManager._applyStrategyEffect(branch.effectPart);
            }

            // 移除决议
            store.factionResolutions[groupName] = list.filter(r => r.id !== resolutionId);

            if (window.SaveManager) window.SaveManager.save();
            return { success, choice, resolution: res };
        },
    };

    window.PoliticsActionManager = PoliticsActionManager;
    console.log('[CinemaWorld] strategy-politics-act.js 已加载');
})();