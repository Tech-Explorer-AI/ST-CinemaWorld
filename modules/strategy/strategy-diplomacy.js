// ============================================================
// CinemaWorld · strategy-diplomacy.js
// 外交：针对单个势力的行动生成与执行
// 依赖：strategy.js, strategy-actions.js
// ============================================================

(function () {
    'use strict';

    const StrategyManager = window.StrategyManager;
    const ActionEngine = window.ActionEngine;
    const VisualNovelManager = window.VisualNovelManager;

    const DiplomacyManager = {
        _generating: false,

        // ------------------------------------------------------------
        // 存储
        // ------------------------------------------------------------
        ensureStore() {
            const s = StrategyManager.ensureStore();
            if (!s.diplomacyActions) s.diplomacyActions = {};   // { factionId: [actions] }
            return s;
        },

        getActions(factionId) {
            return this.ensureStore().diplomacyActions[factionId] || [];
        },

        getAction(factionId, actionId) {
            return this.getActions(factionId).find(a => a.id === actionId) || null;
        },

        // ------------------------------------------------------------
        // 生成：针对某势力
        // ------------------------------------------------------------
        async generateFor(factionId, context = '') {
            if (this._generating) return null;
            const target = StrategyManager.ensureStore().factions[factionId];
            if (!target) return null;

            this._generating = true;
            try {
                const playerFaction = StrategyManager.getPlayerFaction();
                const p = StrategyManager.ensurePolitics();

                const rel = playerFaction?.relations?.[target.name] || { value: 0, status: '中立' };
                const myFields = StrategyManager._formatFactionFields(playerFaction);
                const targetFields = StrategyManager._formatFactionFields(target);
                const politicsText = this._formatPoliticsForPrompt(p);

                const prompt = `你正在为一个视觉小说游戏生成"外交行动"。
玩家将针对「${target.name}」发起外交，每个行动有成功率，失败也有后果。

【我方势力】
${playerFaction?.icon} ${playerFaction?.name}
${myFields}
${playerFaction?.description ? '描述：' + playerFaction.description : ''}

【目标势力】
${target.icon} ${target.name}
${targetFields}
${target.description ? '描述：' + target.description : ''}
与我国关系：${rel.value}（${rel.status}）

【我方内政】
${politicsText}

${context ? `【玩家要求】\n${context}\n` : ''}

【任务】
生成 5 个针对「${target.name}」的外交行动。

【输出格式】（严格遵守，每个行动一个块）

- 【行动名|图标】：描述，[类型:外交|消耗:粮草-1000,威望-5]
  成功率: 55
  修正:
  - 主战派支持 +15
  - 主和派反对 -10
  - 商人阶级支持 +8
  成功效果:
  关系变化: ${target.name} +15
  势力数据:
  - ${target.name}: 粮草 -2000
  我方势力:
  - 威望 +5
  成功剧情:
  【旁白】: 使者带着厚礼进入${target.name}的王庭……
  【对方领袖|显示|中|男|犹豫】: 此事……容我再想想。
  失败效果:
  关系变化: ${target.name} -10
  我方势力:
  - 威望 -5
  失败剧情:
  【旁白】: 使者被赶出了城门。
  【对方将领|显示|中|男|愤怒】: 滚回去告诉你的主子！

【规则】
1. 行动名要具体，如"派遣密使"、"边境陈兵"、"联姻提议"、"贸易协定"、"煽动叛乱"。
2. 修正项必须引用【我方内政】中真实存在的派系/阶级/集团名。
3. 成功率 5-95 之间。
4. 消耗要合理（粮草/威望/兵力等，引用我方势力数据中存在的字段）。
5. 成功/失败效果都要有，剧情 3-6 行。
6. 关系变化格式：关系变化: ${target.name} +N 或 -N。
7. 所有描述用中文。

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'strategy-diplomacy');
                if (!result) return null;

                const actions = this._parseActions(result, factionId);
                this.ensureStore().diplomacyActions[factionId] = actions;

                if (window.SaveManager) window.SaveManager.save();
                return actions;
            } finally {
                this._generating = false;
            }
        },

        _formatPoliticsForPrompt(p) {
            if (!p?.initialized) return '（无内政数据）';
            const parts = [];

            const groups = Object.values(p.interestGroups || {});
            if (groups.length > 0) {
                parts.push('利益集团与派系：');
                for (const g of groups) {
                    parts.push(`- ${g.name}（政治力量 ${g.politicalPower}，支持 ${g.support}）`);
                    for (const f of Object.values(g.factions || {})) {
                        parts.push(`  · ${f.name}（${f.stance || '中立'}，力量 ${f.politicalPower}，支持 ${f.support}）`);
                    }
                }
            }

            const classes = Object.values(p.classes || {});
            if (classes.length > 0) {
                parts.push('阶级：');
                for (const c of classes.slice(0, 6)) {
                    parts.push(`- ${c.name}（政治力量 ${c.politicalPower}，支持 ${c.support}）`);
                }
            }

            return parts.join('\n');
        },

        // ------------------------------------------------------------
        // 解析
        // ------------------------------------------------------------
        _parseActions(text, factionId) {
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
                const a = this._parseActionBlock(block, factionId);
                if (a) actions.push(a);
            }
            return actions;
        },

        _parseActionBlock(block, factionId) {
            const firstLine = block.split('\n')[0];
            const nameM = firstLine.match(/^【(.+?)】/);
            if (!nameM) return null;

            const nameParts = nameM[1].split('|').map(s => s.trim());
            const action = {
                id: `dip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                kind: 'diplomacy',
                targetFactionId: factionId,
                name: nameParts[0] || '',
                icon: '🤝',
                hint: '',
                meta: {},
                cost: {},
                check: { base: 50, modifiers: [] },
                onSuccess: {},
                onFailure: {},
                status: 'available',
                createdAt: Date.now(),
            };
            if (nameParts[1]) {
                const e = window.WorldManager?._extractEmoji(nameParts[1]);
                if (e) action.icon = e;
            }

            // 第一行：[类型:外交|消耗:...]
            const afterName = firstLine.substring(nameM[0].length).replace(/^[：:]\s*/, '');
            const bracketM = afterName.match(/^([\s\S]*?)\s*[\[【]([^\]】]+)[\]】]\s*$/);
            if (bracketM) {
                action.hint = bracketM[1].trim();
                for (const f of bracketM[2].split('|')) {
                    const kv = f.match(/^(.+?)[:：]\s*(.+)$/);
                    if (!kv) continue;
                    const k = kv[1].trim(), v = kv[2].trim();
                    if (k === '消耗') {
                        action.cost = this._parseCost(v);
                    } else {
                        action.meta[k] = v;
                    }
                }
            } else {
                action.hint = afterName.trim();
            }

            // 成功率
            const rateM = block.match(/成功率[:：]\s*([\d.]+)/);
            if (rateM) action.check.base = parseFloat(rateM[1]) || 50;

            // 修正项
            const modBlock = block.match(/修正[:：]?\s*\n([\s\S]*?)(?=成功效果|失败效果|$)/);
            if (modBlock) {
                for (const raw of modBlock[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const m = line.match(/^[-•]\s*(.+?)\s*([+\-])\s*(\d+(?:\.\d+)?)$/);
                    if (!m) continue;
                    const label = m[1].trim();
                    const value = m[2] === '+' ? parseFloat(m[3]) : -parseFloat(m[3]);
                    action.check.modifiers.push({
                        label,
                        source: this._guessSource(label),
                        value,
                    });
                }
            }

            // 成功/失败效果
            action.onSuccess = this._parseBranch(block, '成功');
            action.onFailure = this._parseBranch(block, '失败');

            return action.name ? action : null;
        },

        _parseCost(text) {
            const cost = {};
            const parts = text.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
            for (const part of parts) {
                const m = part.match(/^(.+?)\s*([+\-])\s*(.+)$/);
                if (!m) continue;
                const n = window.StrategyManager.normalizeNumber(m[3]);
                if (isNaN(n.num)) continue;
                cost[m[1].trim()] = m[2] === '+' ? n.num : -n.num;
            }
            return cost;
        },

        // 尝试从 label 猜出 source（主战派 → faction:主战派）
        _guessSource(label) {
            const p = StrategyManager.ensurePolitics();
            if (!p) return `unknown:${label}`;

            // 去掉"支持"、"反对"等后缀
            const clean = label.replace(/[支持反对力量]/g, '').trim();

            for (const g of Object.values(p.interestGroups || {})) {
                for (const fname of Object.keys(g.factions || {})) {
                    if (fname.includes(clean) || clean.includes(fname)) {
                        return `faction:${fname}`;
                    }
                }
            }
            for (const cname of Object.keys(p.classes || {})) {
                if (cname.includes(clean) || clean.includes(cname)) {
                    return `class:${cname}`;
                }
            }
            for (const gname of Object.keys(p.interestGroups || {})) {
                if (gname.includes(clean) || clean.includes(gname)) {
                    return `group:${gname}`;
                }
            }
            return `unknown:${label}`;
        },

        _parseBranch(block, label) {
            // label: '成功' | '失败'
            const isSuccess = label === '成功';
        
            // 1. 先定位 "X效果" 到 "下一个终止点" 之间的内容
            //    成功效果 → 终止于 失败效果 / 块尾
            //    失败效果 → 终止于 块尾
            const effStart = block.indexOf(`${label}效果`);
            if (effStart === -1) return {};
        
            // 找结束位置
            let effEnd = block.length;
            if (isSuccess) {
                const failIdx = block.indexOf('失败效果', effStart + label.length + 2);
                if (failIdx !== -1) effEnd = failIdx;
            }
            const content = block.substring(effStart + `${label}效果`.length, effEnd)
                .replace(/^[：:]\s*\n?/, '');   // 去掉 "成功效果:" 后的冒号
        
            // 2. 从 content 里切出剧情
            //    成功剧情 / 失败剧情 都只到 content 末尾（因为 content 已经被裁到下一个效果之前）
            const scriptKey = `${label}剧情`;
            const scriptIdx = content.indexOf(scriptKey);
            let script = '';
            let effText = content;
        
            if (scriptIdx !== -1) {
                effText = content.substring(0, scriptIdx).trim();
                script = content.substring(scriptIdx + scriptKey.length)
                    .replace(/^[：:]\s*\n?/, '')
                    .trim();
            }
        
            const effectPart = effText ? `【效果】\n${effText}` : '';
            return { script, effectPart };
        },

        // ------------------------------------------------------------
        // 执行
        // ------------------------------------------------------------
        async execute(factionId, actionId) {
            const action = this.getAction(factionId, actionId);
            if (!action) return { ok: false, reason: '行动不存在' };
            if (action.status !== 'available') return { ok: false, reason: '该行动已执行' };

            const ctx = { politics: StrategyManager.ensurePolitics() };
            const result = await ActionEngine.execute(action, ctx);

            action.status = result.success ? 'success' : 'failed';
            action.executedAt = Date.now();
            action.lastResult = result;

            if (window.InteractionHistoryManager) {
                window.InteractionHistoryManager.add({
                    type: 'strategy-diplomacy',
                    target: action.name,
                    targetMeta: { icon: action.icon },
                    scene: '(外交)',
                    playerInput: action.name,
                    summary: `${result.success ? '成功' : '失败'}（成功率 ${result.check.final}%）`,
                });
            }

            if (window.SaveManager) window.SaveManager.save();
            return { ok: true, result, action };
        },
    };

    window.DiplomacyManager = DiplomacyManager;
    console.log('[CinemaWorld] strategy-diplomacy.js 已加载');
})();