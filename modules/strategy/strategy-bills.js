// ============================================================
// CinemaWorld · strategy-bills.js
// 法案：提案 → 投票 → 落实期 → 稳定/倒退/废除
// 依赖：strategy.js, strategy-actions.js
// ============================================================

(function () {
    'use strict';

    const StrategyManager = window.StrategyManager;
    const ActionEngine = window.ActionEngine;
    const VisualNovelManager = window.VisualNovelManager;

    // ============================================================
    // 法案管理器
    // ============================================================
    const BillManager = {

        _generating: false,

        // ------------------------------------------------------------
        // 存储
        // ------------------------------------------------------------
        ensureStore() {
            const s = StrategyManager.ensureStore();
            if (!s.bills) s.bills = [];
            if (!s.billHistory) s.billHistory = [];
            return s;
        },

        getActiveBills() {
            return this.ensureStore().bills.filter(b =>
                b.state === 'active' || b.state === 'reverting'
            );
        },

        getProposedBills() {
            return this.ensureStore().bills.filter(b => b.state === 'proposed');
        },

        getBill(id) {
            return this.ensureStore().bills.find(b => b.id === id) || null;
        },

        // ------------------------------------------------------------
        // 生成法案（AI）
        // ------------------------------------------------------------
        async generateBills(context = '') {
            if (this._generating) return null;
            this._generating = true;
            try {
                const playerFaction = StrategyManager.getPlayerFaction();
                if (!playerFaction) return null;
                const p = StrategyManager.ensurePolitics();
                if (!p.initialized) return null;

                const factionText = StrategyManager._formatFactionFields(playerFaction);
                const politicsSummary = this._formatPoliticsForPrompt(p);

                const prompt = `你正在为一个视觉小说游戏生成"法案"。
法案是比普通行动更根本的东西，通过后会持续改变内政结构。
历史是螺旋上升的——通过的法案可能因为反对压力而倒退、废除，甚至留下历史伤痕。

【我方势力】
${playerFaction.icon} ${playerFaction.name}
${factionText}

【内政现状】
${politicsSummary}

${context ? `【玩家要求】\n${context}\n` : ''}

【任务】
生成 3 个法案，覆盖不同倾向（改革 / 保守 / 激进）。
每个法案必须包含：投票结构 + 落实效果 + 反对压力 + 事件 + 三种结局。

【输出格式】（严格遵守）

【法案名|图标|倾向】
描述: (一段话，说明法案要做什么)

投票:
- 支持: 阶级名、派系名、集团名（用顿号分隔，必须引用内政现状中存在的名字）
- 反对: 阶级名、派系名、集团名
- 阈值: 50

落实效果:
- 阶级名: 字段 +N（每回合）
- 派系名: 字段 +N（每回合）

反对压力:
- 阶级名|强度:N
- 派系名|强度:N

落实事件:
- 【事件名】：触发条件（如 反对压力 > 50），剧情（2-5行），效果（数值变化）

稳定结局:
剧情: (2-3行)
效果: (数值变化)

倒退结局:
剧情: (2-5行)
效果: (数值变化)

废除结局:
剧情: (2-5行)
效果: (数值变化)

---

【第二个法案...】
...

【第三个法案...】
...

【规则】
1. 投票的支持/反对必须引用内政现状中真实存在的阶级/派系/集团名。
2. 落实效果用「名字: 字段 +N」格式，字段可以是 政治力量/支持度/不满/觉悟/动员力/pop/wealthShare。
3. 反对压力强度 1-20，越高压力越大。
4. 落实事件的触发条件支持 JS 表达式，可用变量：backlash（反对压力累积值）、stability（稳定度）、turn。
5. 三种结局都要有，倒退结局要体现"历史螺旋"——不是归零，而是留下痕迹。
6. 稳定结局的效果通常是正面的、巩固的；倒退结局是混合的（部分保留+部分损失）；废除结局是全面回滚。
7. 所有描述用中文，30-100 字。

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'strategy-bills');
                if (!result) return null;
                return this._parseBills(result);
            } finally {
                this._generating = false;
            }
        },

        _formatPoliticsForPrompt(p) {
            const parts = [];

            // 阶级
            const classes = Object.values(p.classes);
            if (classes.length > 0) {
                parts.push(`阶级：`);
                for (const c of classes) {
                    parts.push(`- ${c.name}：人口 ${(c.pop*100).toFixed(1)}%，政治力量 ${c.politicalPower}，支持 ${c.support}，不满 ${c.discontent || 0}，觉悟 ${c.consciousness || 0}`);
                }
            }

            // 利益集团 + 派系
            const groups = Object.values(p.interestGroups);
            if (groups.length > 0) {
                parts.push(`利益集团与派系：`);
                for (const g of groups) {
                    parts.push(`- ${g.name}：政治力量 ${g.politicalPower}，支持 ${g.support}`);
                    for (const f of Object.values(g.factions || {})) {
                        parts.push(`  · ${f.name}（${f.stance || '中立'}）：政治力量 ${f.politicalPower}，支持 ${f.support}`);
                    }
                }
            }

            // 经济
            const eco = p.economy;
            if (eco) {
                parts.push(`经济：时期「${eco.period?.name || '未知'}」，所有制「${eco.production?.ownership?.type}」集中度 ${(eco.production?.ownership?.concentration*100).toFixed(0)}%，分配「${eco.production?.distribution?.type}」平等度 ${(eco.production?.distribution?.equality*100).toFixed(0)}%`);
            }

            return parts.join('\n');
        },

        // ------------------------------------------------------------
        // 解析法案
        // ------------------------------------------------------------
        _parseBills(text) {
            const store = this.ensureStore();
            const bills = [];

            // 按【...】标题切块
            const blocks = [];
            let cur = null;
            for (const raw of text.split('\n')) {
                const line = raw.trim();
                if (/^【[^】]+】\s*$/.test(line) && !/【效果|【剧情|【摘要/.test(line)) {
                    if (cur) blocks.push(cur);
                    cur = line;
                } else if (cur !== null) {
                    cur += '\n' + raw;
                }
            }
            if (cur) blocks.push(cur);

            for (const block of blocks) {
                const bill = this._parseBillBlock(block);
                if (bill) bills.push(bill);
            }

            // 保留已有的 active/reverting 法案，替换 proposed
            const oldActive = store.bills.filter(b =>
                b.state === 'active' || b.state === 'reverting' || b.state === 'stabilized'
            );
            store.bills = [...oldActive, ...bills];

            if (window.SaveManager) window.SaveManager.save();
            console.log(`[Bills] 生成了 ${bills.length} 个法案`);
            return bills;
        },

        _parseBillBlock(block) {
            const headM = block.match(/^【([^】]+)】/);
            if (!headM) return null;

            const parts = headM[1].split('|').map(s => s.trim());
            const name = parts[0] || '';
            if (!name) return null;

            let icon = '📜';
            if (parts[1]) {
                const e = window.WorldManager?._extractEmoji(parts[1]);
                if (e) icon = e;
            }
            const stance = parts[2] || '改革';

            const bill = {
                id: `bill_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                kind: 'bill',
                name, icon, stance,
                desc: '',
                vote: { supporters: [], opponents: [], threshold: 50, passed: null },
                ongoing: {
                    effects: [],
                    backlash: { sources: [], accumulated: 0, threshold: 100 },
                    stability: { base: 50, current: 50 },
                },
                ongoingEvents: [],
                onStabilize: {},
                onRevert: {},
                onRepeal: {},
                state: 'proposed',
                stateHistory: [],
                createdAt: Date.now(),
                passedAt: null,
                turnsInState: 0,
            };

            // 描述
            const descM = block.match(/描述[:：]\s*(.+)/);
            if (descM) bill.desc = descM[1].trim();

            // 投票
            const supM = block.match(/支持[:：]\s*(.+)/);
            if (supM) bill.vote.supporters = supM[1].split(/[、,，]/).map(s => {
                s = s.trim();
                return this._normalizeSource(s);
            }).filter(Boolean);
            const oppM = block.match(/反对[:：]\s*(.+)/);
            if (oppM) bill.vote.opponents = oppM[1].split(/[、,，]/).map(s => {
                s = s.trim();
                return this._normalizeSource(s);
            }).filter(Boolean);
            const thrM = block.match(/阈值[:：]\s*([\d.]+)/);
            if (thrM) bill.vote.threshold = parseFloat(thrM[1]) || 50;

            // 落实效果
            const effBlock = block.match(/落实效果[:：]?\s*\n([\s\S]*?)(?=反对压力|落实事件|稳定结局|$)/);
            if (effBlock) {
                for (const raw of effBlock[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const m = line.match(/^[-•]\s*(.+?)[:：]\s*(.+)$/);
                    if (!m) continue;
                    const target = m[1].trim();
                    const changes = this._parseChangeList(m[2].trim());
                    const source = this._normalizeSource(target);
                    for (const ch of changes) {
                        bill.ongoing.effects.push({
                            source,
                            field: ch.field,
                            op: ch.op,
                            value: ch.value,
                        });
                    }
                }
            }

            // 反对压力
            const backBlock = block.match(/反对压力[:：]?\s*\n([\s\S]*?)(?=落实事件|稳定结局|$)/);
            if (backBlock) {
                for (const raw of backBlock[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const m = line.match(/^[-•]\s*(.+?)\|强度[:：]\s*([\d.]+)$/);
                    if (!m) continue;
                    bill.ongoing.backlash.sources.push({
                        source: this._normalizeSource(m[1].trim()),
                        intensity: parseFloat(m[2]) || 5,
                    });
                }
            }

            // 落实事件
            const evBlock = block.match(/落实事件[:：]?\s*\n([\s\S]*?)(?=稳定结局|$)/);
            if (evBlock) {
                for (const raw of evBlock[1].split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const m = line.match(/^[-•]\s*【(.+?)】[：:]\s*([\s\S]*)$/);
                    if (!m) continue;
                    // 事件内容可能跨行，这里只取单行
                    const content = m[2];
                    const triggerM = content.match(/触发条件[:：]?\s*(.+?)(?=[，,。]|剧情[:：]|$)/);
                    const scriptM = content.match(/剧情[:：]?\s*(.+?)(?=效果[:：]|$)/);
                    const effM = content.match(/效果[:：]?\s*(.+)$/);

                    bill.ongoingEvents.push({
                        name: m[1].trim(),
                        trigger: triggerM ? triggerM[1].trim() : '',
                        script: scriptM ? scriptM[1].trim() : '',
                        effectPart: effM ? `【效果】\n${effM[1].trim()}` : '',
                        triggered: false,
                    });
                }
            }

            // 三种结局
            bill.onStabilize = this._parseEnding(block, '稳定结局');
            bill.onRevert    = this._parseEnding(block, '倒退结局');
            bill.onRepeal    = this._parseEnding(block, '废除结局');

            return bill;
        },

        _parseEnding(block, label) {
            const m = block.match(new RegExp(`${label}[:：]?\\s*\\n([\\s\\S]*?)(?=\\n【|$)`));
            if (!m) return {};
            const content = m[1];
            const scriptM = content.match(/剧情[:：]\s*([\s\S]*?)(?=效果[:：]|$)/);
            const effM = content.match(/效果[:：]\s*([\s\S]*?)$/);
            return {
                script: scriptM ? scriptM[1].trim() : '',
                effectPart: effM ? `【效果】\n${effM[1].trim()}` : '',
            };
        },

        // 名字 → source 字符串
        // AI 输出"农民"、"农民阶级"、"改革派"，我们尝试匹配已有数据
        _normalizeSource(name) {
            if (!name) return '';
            name = name.trim();

            // 已经是 "class:xxx" 格式
            if (/^(class|group|faction|faction_of):/.test(name)) return name;

            const p = StrategyManager.ensurePolitics();

            // 尝试阶级
            if (p.classes) {
                for (const cname of Object.keys(p.classes)) {
                    if (cname === name || cname.includes(name) || name.includes(cname)) {
                        return `class:${cname}`;
                    }
                }
            }

            // 尝试集团
            if (p.interestGroups) {
                for (const gname of Object.keys(p.interestGroups)) {
                    if (gname === name || gname.includes(name) || name.includes(gname)) {
                        return `group:${gname}`;
                    }
                }
                // 尝试派系
                for (const [gname, g] of Object.entries(p.interestGroups)) {
                    for (const fname of Object.keys(g.factions || {})) {
                        if (fname === name || fname.includes(name) || name.includes(fname)) {
                            return `faction:${fname}`;
                        }
                    }
                }
            }

            // 找不到，返回原样（运行时 _resolvePower 会返回 0）
            return `unknown:${name}`;
        },

        // "政治力量 +2, 支持 -3" → [{field, op, value}]
        _parseChangeList(text) {
            const out = [];
            const parts = text.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
            for (const part of parts) {
                // 支持 "政治力量 +2" / "兵力 -5万" / "人口 -5%"
                const m = part.match(/^(.+?)\s*([+\-])\s*(.+?)(%?)$/);
                if (m) {
                    const n = window.StrategyManager.normalizeNumber(m[3]);
                    if (isNaN(n.num)) continue;
                    out.push({
                        field: m[1].trim(),
                        op: m[2] === '+' ? 'add' : 'subtract',
                        value: m[4] === '%' ? n.num / 100 : n.num,
                    });
                    continue;
                }
                const m2 = part.match(/^(.+?)\s*=\s*(.+)$/);
                if (m2) {
                    const n = window.StrategyManager.normalizeNumber(m2[2]);
                    if (!isNaN(n.num)) out.push({ field: m2[1].trim(), op: 'set', value: n.num });
                }
            }
            return out;
        },

        // ------------------------------------------------------------
        // 发起投票
        // ------------------------------------------------------------
        async voteBill(billId) {
            const bill = this.getBill(billId);
            if (!bill || bill.state !== 'proposed') return null;

            const ctx = { politics: StrategyManager.ensurePolitics() };
            const result = ActionEngine.computeVote(bill, ctx);
            bill.vote.passed = result.pass;
            bill.vote.lastResult = result;

            if (result.pass) {
                bill.state = 'active';
                bill.passedAt = StrategyManager.ensureStore().turnCount;
                bill.stateHistory.push({
                    state: 'active',
                    turn: bill.passedAt,
                    reason: `投票通过（${result.forPct}%）`,
                });

                // 播放通过剧情
                const p = StrategyManager.ensurePolitics();
                const script = `【旁白】: 朝堂之上，${bill.name}以 ${result.forPct}% 的支持率通过。\n【旁白】: 历史的车轮开始转动。`;
                const dialogues = VisualNovelManager.parseScript(script);
                if (dialogues.length > 0) await VisualNovelManager.play(dialogues);
            } else {
                bill.state = 'rejected';
                bill.stateHistory.push({
                    state: 'rejected',
                    turn: StrategyManager.ensureStore().turnCount,
                    reason: `投票否决（${result.forPct}%）`,
                });

                // 播放否决剧情
                const script = `【旁白】: ${bill.name}以 ${result.forPct}% 的支持率被否决。\n【旁白】: 保守的力量暂时占了上风。`;
                const dialogues = VisualNovelManager.parseScript(script);
                if (dialogues.length > 0) await VisualNovelManager.play(dialogues);
            }

            if (window.SaveManager) window.SaveManager.save();
            return { bill, result };
        },

        // ------------------------------------------------------------
        // 每回合结算（由 StrategyManager.advanceTurn 调用）
        // ------------------------------------------------------------
        async settleTurn() {
            const store = this.ensureStore();
            const p = StrategyManager.ensurePolitics();
            const turn = store.turnCount;
            const crises = [];

            for (const bill of store.bills) {
                if (bill.state !== 'active' && bill.state !== 'reverting') continue;
                bill.turnsInState = (bill.turnsInState || 0) + 1;

                // 1. 应用落实效果
                await this._applyOngoingEffects(bill, p);

                // 2. 计算反对压力
                const backlashDelta = this._computeBacklashDelta(bill, p);
                bill.ongoing.backlash.accumulated += backlashDelta;

                // 3. 计算稳定度
                const stability = this._computeStability(bill, p);
                bill.ongoing.stability.current = stability;

                // 4. 触发事件
                await this._triggerEvents(bill, p);

                // 5. 判定状态转移
                const transition = this._checkTransition(bill, p, turn);
                if (transition) {
                    crises.push({
                        type: 'bill_state',
                        bill: bill.name,
                        state: transition,
                        desc: `《${bill.name}》${this._stateLabel(transition)}`,
                    });
                }
            }

            // 清理已结束的法案（保留历史）
            store.billHistory.push(...store.bills.filter(b =>
                ['stabilized', 'reverted', 'repealed', 'rejected'].includes(b.state) &&
                !b._archived
            ).map(b => { b._archived = true; return b; }));

            if (window.SaveManager) window.SaveManager.save();
            return crises;
        },

        async _applyOngoingEffects(bill, p) {
            for (const eff of bill.ongoing.effects) {
                const [type, name] = eff.source.split(':');
                let target = null;
                if (type === 'class')  target = p.classes?.[name];
                else if (type === 'group')  target = p.interestGroups?.[name];
                else if (type === 'faction') {
                    for (const g of Object.values(p.interestGroups || {})) {
                        if (g.factions?.[name]) { target = g.factions[name]; break; }
                    }
                }
                if (!target) continue;
                ActionEngine._applyNumeric(target, eff.field, eff.op, eff.value);
            }
        },

        _computeBacklashDelta(bill, p) {
            let delta = 0;
            for (const src of bill.ongoing.backlash.sources) {
                const power = ActionEngine._resolvePower(src.source, p);
                const support = ActionEngine._resolveSupport(src.source, p);
                delta += src.intensity * (power / 100) * (1 - support / 100);
            }
            return delta;
        },

        _computeStability(bill, p) {
            let stability = bill.ongoing.stability.base || 50;

            // 支持者的力量贡献
            for (const src of bill.vote.supporters) {
                const power = ActionEngine._resolvePower(src, p);
                const support = ActionEngine._resolveSupport(src, p);
                stability += (power / 100) * (support / 100) * 10;
            }

            // 反对压力的削减
            stability -= (bill.ongoing.backlash.accumulated || 0) * 0.5;

            // 规则修正（从 politics.rules.billRules 读，读不到用默认）
            const rules = p.rules?.billRules;
            if (rules?.stabilityBonus) stability += rules.stabilityBonus;

            return Math.max(0, Math.min(100, stability));
        },

        async _triggerEvents(bill, p) {
            for (const ev of bill.ongoingEvents) {
                if (ev.triggered) continue;
                if (!this._evalTrigger(ev.trigger, bill, p)) continue;

                ev.triggered = true;
                ev.triggeredAt = StrategyManager.ensureStore().turnCount;

                if (ev.script) {
                    const dialogues = VisualNovelManager.parseScript(ev.script);
                    if (dialogues.length > 0) await VisualNovelManager.play(dialogues);
                }
                if (ev.effectPart) {
                    await StrategyManager._applyStrategyEffect(ev.effectPart);
                }
            }
        },

        _evalTrigger(trigger, bill, p) {
            if (!trigger) return false;
            try {
                const vars = {
                    backlash: bill.ongoing.backlash.accumulated || 0,
                    stability: bill.ongoing.stability.current || 50,
                    turn: bill.turnsInState || 0,
                    totalTurn: StrategyManager.ensureStore().turnCount,
                };
                const expr = String(trigger)
                    .replace(/\bbacklash\b/g, vars.backlash)
                    .replace(/\bstability\b/g, vars.stability)
                    .replace(/\bturn\b/g, vars.turn)
                    .replace(/\btotalTurn\b/g, vars.totalTurn);
                // eslint-disable-next-line no-new-func
                return Function(`"use strict";return (${expr})`)();
            } catch (e) {
                return false;
            }
        },

        _checkTransition(bill, p, turn) {
            // 稳定条件从规则读，读不到用 fallback
            const rules = p.rules?.billRules || {};
            const stableTurns   = rules.stableTurns   ?? 5;
            const revertThresh  = rules.revertThreshold  ?? 100;
            const repealStab    = rules.repealStability   ?? 0;
            const stabilizeStab = rules.stabilizeStability ?? 80;
            const stabilizeBack = rules.stabilizeBacklash  ?? 20;

            // 已稳定
            if (bill.state === 'active' &&
                bill.turnsInState >= stableTurns &&
                bill.ongoing.backlash.accumulated < stabilizeBack &&
                bill.ongoing.stability.current >= stabilizeStab) {
                bill.state = 'stabilized';
                bill.stateHistory.push({
                    state: 'stabilized', turn,
                    reason: `稳定 ${bill.turnsInState} 回合后落实`,
                });
                this._playEnding(bill, 'onStabilize');
                return 'stabilized';
            }

            // 废除
            if (bill.ongoing.stability.current <= repealStab) {
                bill.state = 'repealed';
                bill.stateHistory.push({
                    state: 'repealed', turn,
                    reason: '稳定度归零，法案被废除',
                });
                this._playEnding(bill, 'onRepeal');
                return 'repealed';
            }

            // 倒退
            if (bill.ongoing.backlash.accumulated >= revertThresh && bill.state === 'active') {
                bill.state = 'reverting';
                bill.stateHistory.push({
                    state: 'reverting', turn,
                    reason: `反对压力达 ${revertThresh}`,
                });
                return 'reverting';
            }

            // 倒退期结束 → 判定：如果玩家压制住反对，回到 active；否则废除
            if (bill.state === 'reverting') {
                if (bill.ongoing.backlash.accumulated < revertThresh * 0.5 &&
                    bill.ongoing.stability.current > 40) {
                    bill.state = 'active';
                    bill.ongoing.backlash.accumulated = 0;  // 重置
                    bill.stateHistory.push({
                        state: 'active', turn,
                        reason: '危机化解，法案恢复落实',
                    });
                    return 'recovering';
                } else if (bill.turnsInState >= 3) {
                    bill.state = 'reverted';
                    bill.stateHistory.push({
                        state: 'reverted', turn,
                        reason: '倒退期未能扭转，法案被改回',
                    });
                    this._playEnding(bill, 'onRevert');
                    return 'reverted';
                }
            }

            return null;
        },

        async _playEnding(bill, key) {
            const ending = bill[key];
            if (!ending) return;

            // 应用历史记忆（让螺旋留下痕迹）
            this._recordHistoricalGrievance(bill, key);

            if (ending.script) {
                const dialogues = VisualNovelManager.parseScript(ending.script);
                if (dialogues.length > 0) await VisualNovelManager.play(dialogues);
            }
            if (ending.effectPart) {
                await StrategyManager._applyStrategyEffect(ending.effectPart);
            }
        },

        _recordHistoricalGrievance(bill, key) {
            const p = StrategyManager.ensurePolitics();
            // 倒退或废除时，给反对者/支持者留下历史记忆
            if (key === 'onRevert' || key === 'onRepeal') {
                for (const src of bill.vote.supporters) {
                    const [type, name] = src.split(':');
                    if (type !== 'class') continue;
                    const cls = p.classes[name];
                    if (!cls) continue;
                    if (!cls.historicalGrievances) cls.historicalGrievances = [];
                    cls.historicalGrievances.push({
                        bill: bill.name,
                        turn: StrategyManager.ensureStore().turnCount,
                        reason: key === 'onRevert' ? '被逼退' : '被废除',
                    });
                    // 历史记忆提高后续改革的动力
                    cls.support = Math.max(0, cls.support - 5);
                }
            }
        },

        _stateLabel(state) {
            return {
                stabilized: '落实稳定',
                reverted: '被迫倒退',
                repealed: '被废除',
                reverting: '进入倒退期',
                recovering: '危机化解',
            }[state] || state;
        },

        // ------------------------------------------------------------
        // 玩家干预（在倒退期可用）
        // ------------------------------------------------------------
        async intervene(billId, type) {
            const bill = this.getBill(billId);
            if (!bill || bill.state !== 'reverting') return null;

            const p = StrategyManager.ensurePolitics();
            const playerFaction = StrategyManager.getPlayerFaction();
            if (!playerFaction) return null;

            let result = null;

            switch (type) {
                case 'suppress':
                    // 镇压：消耗威望，降低反对压力
                    result = await this._interveneSuppress(bill, p, playerFaction);
                    break;
                case 'coopt':
                    // 拉拢：消耗粮草，提高反对源支持度
                    result = await this._interveneCoopt(bill, p, playerFaction);
                    break;
                case 'compromise':
                    // 妥协：降低法案效果，重置反对压力
                    result = await this._interveneCompromise(bill, p, playerFaction);
                    break;
            }

            if (window.SaveManager) window.SaveManager.save();
            return result;
        },

        async _interveneSuppress(bill, p, faction) {
            const cost = { 威望: 10 };
            ActionEngine._applyCost(cost, {});

            // 镇压降低反对压力
            bill.ongoing.backlash.accumulated = Math.max(0, bill.ongoing.backlash.accumulated - 30);

            // 但可能引发支持者不满
            for (const src of bill.vote.supporters) {
                const [type, name] = src.split(':');
                if (type === 'class' && p.classes[name]) {
                    p.classes[name].support = Math.max(0, p.classes[name].support - 3);
                }
            }

            const script = `【旁白】: 铁腕之下，反对的声音暂时被压了下去。\n【旁白】: 但民间的不满，也在悄然累积。`;
            const dialogues = VisualNovelManager.parseScript(script);
            if (dialogues.length > 0) await VisualNovelManager.play(dialogues);

            return { type: 'suppress', backlashDelta: -30 };
        },

        async _interveneCoopt(bill, p, faction) {
            const cost = { 粮草: 5000 };
            ActionEngine._applyCost(cost, {});

            // 拉拢：提高反对源的支持度
            for (const src of bill.ongoing.backlash.sources) {
                const [type, name] = src.source.split(':');
                if (type === 'class' && p.classes[name]) {
                    p.classes[name].support = Math.min(100, p.classes[name].support + 8);
                } else if (type === 'group' && p.interestGroups[name]) {
                    p.interestGroups[name].support = Math.min(100, p.interestGroups[name].support + 8);
                }
            }

            const script = `【旁白】: 赏赐、封地、爵位……皇帝的手段，从来不止一种。\n【旁白】: 反对者的声音，软了下来。`;
            const dialogues = VisualNovelManager.parseScript(script);
            if (dialogues.length > 0) await VisualNovelManager.play(dialogues);

            return { type: 'coopt' };
        },

        async _interveneCompromise(bill, p, faction) {
            // 妥协：效果减半，反对压力重置
            for (const eff of bill.ongoing.effects) {
                eff.value = eff.value * 0.5;
            }
            bill.ongoing.backlash.accumulated = 0;
            bill.ongoing.backlash.threshold = (bill.ongoing.backlash.threshold || 100) + 20;

            const script = `【旁白】: 法案被修改，范围缩小，力度减弱。\n【旁白】: 这是妥协的代价，也是生存的智慧。`;
            const dialogues = VisualNovelManager.parseScript(script);
            if (dialogues.length > 0) await VisualNovelManager.play(dialogues);

            return { type: 'compromise' };
        },
    };

    window.BillManager = BillManager;
    console.log('[CinemaWorld] strategy-bills.js 已加载');
})();