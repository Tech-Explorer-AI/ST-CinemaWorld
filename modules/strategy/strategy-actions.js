// ============================================================
// CinemaWorld · strategy-actions.js
// 行动引擎：概率结算 / 法案投票 / 螺旋倒退 / 通用执行
// 依赖：strategy.js, core.js, world.js, story.js
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const VisualNovelManager = window.VisualNovelManager;

    // ============================================================
    // ActionEngine：所有行动/法案/决议的统一执行器
    // ============================================================
    const ActionEngine = {

        // ------------------------------------------------------------
        // 1. 概率计算（纯百分比）
        // ------------------------------------------------------------
        computeCheck(action, ctx) {
            const base = action.check?.base ?? 50;
            const mods = [];
            let value = base;

            for (const m of action.check?.modifiers || []) {
                const power = this._resolvePower(m.source, ctx);
                const support = this._resolveSupport(m.source, ctx);
                // 修正 = 基础值 × 力量权重 × 支持度因子
                // 支持度因子：0.3（完全反对）→ 1.7（完全支持）
                const supportFactor = 0.3 + (support / 100) * 1.4;
                const effective = m.value * (power / 100) * supportFactor;
                if (Math.abs(effective) > 0.5) {
                    mods.push({
                        label: m.label || m.source,
                        source: m.source,
                        base: m.value,
                        effective: Math.round(effective * 10) / 10,
                        power, support,
                    });
                    value += effective;
                }
            }

            value = Math.max(5, Math.min(95, value));
            return { final: Math.round(value), base, modifiers: mods };
        },

        // ------------------------------------------------------------
        // 2. 掷骰
        // ------------------------------------------------------------
        roll(check) {
            return Math.random() * 100 < check.final;
        },

        // ------------------------------------------------------------
        // 3. 执行一次行动
        // ------------------------------------------------------------
        async execute(action, ctx) {
            // 扣成本
            if (action.cost) {
                this._applyCost(action.cost, ctx);
            }

            // 计算并掷骰
            const check = this.computeCheck(action, ctx);
            const success = this.roll(check);

            // 应用效果
            const branch = success ? (action.onSuccess || {}) : (action.onFailure || {});
            await this._applyBranch(branch, ctx);

            return { success, check, branch };
        },

        // ------------------------------------------------------------
        // 4. 应用分支（脚本 + 效果 + 场景更新）
        // ------------------------------------------------------------
        async _applyBranch(branch, ctx) {
            if (!branch) return;

            // 剧情
            if (branch.script) {
                const dialogues = VisualNovelManager.parseScript(branch.script);
                if (dialogues.length > 0) {
                    await VisualNovelManager.play(dialogues);
                }
            }

            // 效果
            if (branch.effectPart && window.StrategyManager) {
                await window.StrategyManager._applyStrategyEffect(branch.effectPart);
            }

            // 场景更新
            if (branch.sceneUpdatePart && window.StoryManager) {
                const update = window.StoryManager.parseSceneUpdate(branch.sceneUpdatePart);
                if (update) await window.StoryManager.applySceneUpdate(update);
            }

            // 内政数据处理（新增：内政行动专用）
            if (branch.politicsEffect && window.StrategyManager) {
                await this._applyPoliticsEffect(branch.politicsEffect, ctx);
            }
        },

        // ------------------------------------------------------------
        // 5. 成本应用（对我方势力字段）
        // ------------------------------------------------------------
        _applyCost(cost, ctx) {
            const playerFaction = window.StrategyManager?.getPlayerFaction();
            if (!playerFaction) return;
            for (const [key, value] of Object.entries(cost)) {
                const n = window.StrategyManager.normalizeNumber(value);
                if (isNaN(n.num)) continue;
                const op = n.num < 0 ? 'subtract' : 'add';
                window.StrategyManager._changeField(
                    playerFaction.fields, key, op, Math.abs(n.num)
                );
            }
        },

        // ------------------------------------------------------------
        // 6. 内政效果应用（结构化，非 effectPart 解析）
        // ------------------------------------------------------------
        async _applyPoliticsEffect(effect, ctx) {
            const SM = window.StrategyManager;
            if (!SM) return;
            const p = SM.ensurePolitics();

            // effect 结构：
            // {
            //   classes: [{ name, field, op, value }],
            //   groups:  [{ name, field, op, value }],
            //   factions:[{ group, name, field, op, value }],
            //   economy: [{ path, op, value }],
            // }
            if (effect.classes) {
                for (const c of effect.classes) {
                    const cls = p.classes[c.name];
                    if (!cls) continue;
                    this._applyNumeric(cls, c.field, c.op, c.value);
                }
            }
            if (effect.groups) {
                for (const g of effect.groups) {
                    const grp = p.interestGroups[g.name];
                    if (!grp) continue;
                    this._applyNumeric(grp, g.field, g.op, g.value);
                }
            }
            if (effect.factions) {
                for (const f of effect.factions) {
                    const grp = p.interestGroups[f.group];
                    if (!grp?.factions?.[f.name]) continue;
                    this._applyNumeric(grp.factions[f.name], f.field, f.op, f.value);
                }
            }
            if (effect.economy) {
                for (const e of effect.economy) {
                    const target = this._resolvePath(p.economy, e.path);
                    if (target && typeof target === 'object') {
                        this._applyNumeric(target, e.field, e.op, e.value);
                    }
                }
            }

            // 重算派生
            SM.computeWealthShares?.();
            SM.computeLivingStandards?.();
            SM.computeDiscontent?.();
            SM.computeClassConsciousness?.();
        },

        _applyNumeric(obj, field, op, value) {
            if (obj[field] === undefined) return;
            const cur = parseFloat(obj[field]) || 0;
            let next;
            if (op === 'add') next = cur + value;
            else if (op === 'subtract') next = cur - value;
            else if (op === 'set') next = value;
            else if (op === 'multiply') next = cur * value;
            else next = cur;

            // 特殊字段边界
            if (['politicalPower', 'support', 'mobilization', 'efficiency'].includes(field)) {
                next = Math.max(0, Math.min(100, next));
            } else if (field === 'pop' || field === 'share' || field === 'wealthShare') {
                next = Math.max(0, Math.min(1, next));
            } else if (field === 'discontent' || field === 'consciousness') {
                next = Math.max(0, Math.min(100, next));
            }
            obj[field] = next;
        },

        _resolvePath(obj, path) {
            return path.split('.').reduce((o, k) => o?.[k], obj);
        },

        // ------------------------------------------------------------
        // 7. 来源解析（修正项用）
        // ------------------------------------------------------------
        _resolvePower(source, ctx) {
            if (!source) return 0;
            const [type, name] = source.split(':');
            const p = window.StrategyManager?.ensurePolitics();
            if (!p) return 0;

            if (type === 'class')  return p.classes?.[name]?.politicalPower ?? 0;
            if (type === 'group')  return p.interestGroups?.[name]?.politicalPower ?? 0;
            if (type === 'faction') {
                for (const g of Object.values(p.interestGroups || {})) {
                    if (g.factions?.[name]) return g.factions[name].politicalPower ?? 0;
                }
            }
            if (type === 'faction_of') {
                const [grpName, facName] = name.split('.');
                return p.interestGroups?.[grpName]?.factions?.[facName]?.politicalPower ?? 0;
            }
            return 0;
        },

        _resolveSupport(source, ctx) {
            if (!source) return 50;
            const [type, name] = source.split(':');
            const p = window.StrategyManager?.ensurePolitics();
            if (!p) return 50;

            if (type === 'class')  return p.classes?.[name]?.support ?? 50;
            if (type === 'group')  return p.interestGroups?.[name]?.support ?? 50;
            if (type === 'faction') {
                for (const g of Object.values(p.interestGroups || {})) {
                    if (g.factions?.[name]) return g.factions[name].support ?? 50;
                }
            }
            if (type === 'faction_of') {
                const [grpName, facName] = name.split('.');
                return p.interestGroups?.[grpName]?.factions?.[facName]?.support ?? 50;
            }
            return 50;
        },

        // ------------------------------------------------------------
        // 8. 法案投票计算
        // ------------------------------------------------------------
        computeVote(bill, ctx) {
            const supporters = bill.vote?.supporters || [];
            const opponents  = bill.vote?.opponents  || [];

            let forPower = 0, againstPower = 0;
            const forDetails = [], againstDetails = [];

            for (const s of supporters) {
                const power = this._resolvePower(s, ctx);
                forPower += power;
                forDetails.push({ source: s, power });
            }
            for (const o of opponents) {
                const power = this._resolvePower(o, ctx);
                againstPower += power;
                againstDetails.push({ source: o, power });
            }

            const total = forPower + againstPower;
            const forPct = total > 0 ? (forPower / total) * 100 : 50;
            const threshold = bill.vote?.threshold ?? 50;

            return {
                forPower, againstPower, total,
                forPct: Math.round(forPct * 10) / 10,
                threshold,
                pass: forPct >= threshold,
                details: { forDetails, againstDetails },
            };
        },
    };

    window.ActionEngine = ActionEngine;
    console.log('[CinemaWorld] strategy-actions.js 已加载');
})();