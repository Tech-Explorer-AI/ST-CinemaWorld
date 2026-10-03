// ============================================================
// CinemaWorld · rules.js
// 规则引擎 / 触发器 / 游戏钩子 / 规则创建 UI
// 依赖：core.js, player.js
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const DiceEngine = window.DiceEngine;
    const SemanticTagger = window.SemanticTagger;
    const PlayerStateManager = window.PlayerStateManager;
    const DerivedStatsEngine = window.DerivedStatsEngine;

    // ==================== 规则引擎 ====================
    const RuleEngine = {
        rules: {
            // ★ 只保留三个真正被消费的字段
            derived: [],    // [{ name, expr }]
            levelUp: [],    // [{ target, op, value }]
            triggers: [],   // [{ condition, actions }]
            // 以下为展示用
            name: '',
            core: '',
            attributes: [],
            custom: [],
            raw: '',
        },

        // 解析 AI 生成的规则文本
        parse(text) {
            if (!text || typeof text !== 'string') {
                this.rules = {
                    name: '', core: '', attributes: [],
                    derived: [], levelUp: [], triggers: [],
                    custom: [], raw: '',
                };
                return;
            }

            const rules = {
                name: '', core: '', attributes: [],
                derived: [], levelUp: [], triggers: [],
                custom: [], raw: text,
            };

            // 提取区块
            const section = (title) => {
                const re = new RegExp(`【${title}】\\s*([\\s\\S]*?)(?=\\n【|$)`);
                const m = text.match(re);
                return m ? m[1].trim() : '';
            };

            // ---------- 战斗规则 ----------
            const combatSection = section('战斗规则');
            if (combatSection && typeof window.BattleRuleManager !== 'undefined') {
                const combatRules = window.BattleRuleManager.parse(combatSection);
                if (combatRules) {
                    combatRules.raw = combatSection;
                    rules.combat = combatRules;
                    window.BattleRuleManager.save(combatRules);
                }
            } else if (typeof window.BattleRuleManager !== 'undefined') {
                // ★ 游戏规则里没有战斗规则 → 清掉，回退到默认
                const defaultRules = { ...window.BattleRuleManager.DEFAULT_RULES };
                window.BattleRuleManager.save(defaultRules);
            }

            // ========== 展示用字段 ==========
            rules.name = section('游戏名称').split('\n')[0].trim();
            rules.core = section('核心机制');
            rules.attributes = section('属性定义')
                .split('\n')
                .map(l => l.replace(/^[-•*]\s*/, '').trim())
                .filter(Boolean);
            rules.custom = section('自定义机制')
                .split('\n')
                .map(l => l.replace(/^[-•*]\s*/, '').trim())
                .filter(Boolean);

            // ========== 逻辑字段 ==========

            // ---------- 派生规则 ----------
            section('派生规则').split('\n').forEach(line => {
                const clean = line.replace(/^[-•*]\s*/, '').trim();
                if (!clean) return;
                const m = clean.match(/^(.+?)\s*[=＝]\s*(.+)$/);
                if (m) {
                    let expr = m[2].trim();

                    // ★ 删除中文括号及之后的内容
                    expr = expr.replace(/[（(][^）)]*[）)]/g, '').trim();

                    // ★ 只删"末尾的裸中文说明"，保留"运算符 + 中文属性名"的正常结尾
                    //   例：`力量 × 1 + 农活 × 1 （基础）` → 括号已删，无中文尾巴
                    //   例：`力量 + 农活`            → 末尾"农活"前面是"+"，保留
                    //   例：`等级 × 10 攻击力`        → 末尾"攻击力"前面是数字，删掉
                    const cnTailMatch = expr.match(/[\u4e00-\u9fa5]+$/);
                    if (cnTailMatch) {
                        const cnStart = expr.length - cnTailMatch[0].length;
                        const before = expr.substring(0, cnStart).replace(/\s+$/, '');
                        const lastChar = before.slice(-1);

                        if (/[+\-*/×÷]/.test(lastChar)) {
                            // 前面是运算符 → 中文是属性名，保留
                        } else if (/[\d)]/.test(lastChar) || before === '') {
                            // 前面是数字/右括号/空 → 是说明文字，删掉
                            expr = before;
                        }
                        // 其他情况（前面是中文、字母）→ 保守保留
                    }

                    expr = expr.trim();

                    if (expr) {
                        rules.derived.push({ name: m[1].trim(), expr });
                    }
                }
            });

            // ---------- 升级规则 ----------
            section('升级规则').split('\n').forEach(line => {
                const clean = line.replace(/^[-•*]\s*/, '').trim();
                if (!clean) return;
                clean.split(/[;；,，]/).map(s => s.trim()).filter(Boolean).forEach(act => {
                    const m = act.match(/^(.+?)\s*([+\-])\s*(\d+)$/);
                    if (m) {
                        rules.levelUp.push({
                            target: m[1].trim(),
                            op: m[2],
                            value: parseInt(m[3]),
                        });
                    }
                });
            });

            // ---------- 触发规则 ----------
            section('触发规则').split('\n').forEach(line => {
                const clean = line.replace(/^[-•*]\s*/, '').trim();
                if (!clean) return;

                const m = clean.match(/^(.+?)\s*(?:→|->|=>)\s*(.+)$/);
                if (!m) return;

                const condStr = m[1].trim();
                const actStr = m[2].trim();

                // 解析条件
                let condition = null;
                let cm = condStr.match(/^\[?(.+?)\]?\s*(满|空)$/);
                if (cm) {
                    condition = { barKey: cm[1].trim(), type: cm[2] === '满' ? 'full' : 'empty' };
                } else {
                    cm = condStr.match(/^\[?(.+?)\]?\s*(>=|<=|>|<|==)\s*(\d+)$/);
                    if (cm) {
                        condition = {
                            barKey: cm[1].trim(),
                            type: 'compare',
                            op: cm[2],
                            value: parseInt(cm[3]),
                        };
                    }
                }
                if (!condition) return;

                // 解析动作
                const actions = [];
                actStr.split(/[;；,，]/).map(s => s.trim()).filter(Boolean).forEach(act => {
                    // 属性名 +N / -N
                    let am = act.match(/^(.+?)\s*([+\-])\s*(\d+)$/);
                    if (am) {
                        actions.push({
                            type: 'attrChange',
                            target: am[1].trim(),
                            op: am[2],
                            value: parseInt(am[3]),
                        });
                        return;
                    }
                    // 获得物品 xxx
                    am = act.match(/^获得物品\s+(.+)$/);
                    if (am) {
                        actions.push({ type: 'gainItem', name: am[1].trim() });
                        return;
                    }
                    // 获得状态 xxx
                    am = act.match(/^获得状态\s+(.+)$/);
                    if (am) {
                        actions.push({ type: 'gainStatus', name: am[1].trim() });
                        return;
                    }
                    // RuleEngine.parse 里，触发规则的 action 解析处
                    am = act.match(/^触发事件\s+(.+)$/);
                    if (am) {
                        const raw = am[1].trim();
                        const pipeIdx = raw.indexOf('|');
                        if (pipeIdx > -1) {
                            actions.push({
                                type: 'triggerEvent',
                                name: raw.substring(0, pipeIdx).trim(),
                                detail: raw.substring(pipeIdx + 1).trim(),
                            });
                        } else {
                            actions.push({ type: 'triggerEvent', name: raw, detail: '' });
                        }
                        return;
                    }
                    // 归零
                    am = act.match(/^\[?(.+?)?\]?\s*归零$/);
                    if (am) {
                        actions.push({
                            type: 'resetBar',
                            barKey: am[1] ? am[1].trim() : condition.barKey,
                        });
                        return;
                    }
                });

                if (actions.length > 0) {
                    rules.triggers.push({ condition, actions });
                }
            });

            this.rules = rules;
            console.log('[RuleEngine] 规则已解析:', {
                derived: rules.derived.length,
                levelUp: rules.levelUp.length,
                triggers: rules.triggers.length,
            });

            // ★ 顺带解析时间规则
            if (typeof TimeRuleEngine !== 'undefined') {
                try {
                    TimeRuleEngine.parse(text);
                } catch (e) {
                    console.error('[RuleEngine] 时间规则解析失败:', e);
                }
            }

            return rules;
        },

        // 获取用于 prompt 的规则文本（原文，让 AI 遵循）
        getPromptText() {
            return this.rules.raw || '';
        },

        // 把属性表转成 context（用于判定和派生）
        buildContext(player, extra = {}) {
            const ctx = { ...extra };
            const attrs = player?.attributes || {};
            const bonuses = player?.equipment?.bonuses || {};
            for (const [k, v] of Object.entries(attrs)) {
                const base = typeof v === 'object' ? (v.value ?? 0) : Number(v) || 0;
                ctx[k] = base + (bonuses[k] || 0);
            }
            const computed = player?.derivedStats?.computed || {};
            for (const [k, v] of Object.entries(computed)) {
                ctx[k] = typeof v === 'object' ? (v.current ?? 0) : Number(v) || 0;
            }

            // ★ 把额外数据也加进去（只收"纯数值开头"的）
            //   优先级最低，前面已有的键不会被覆盖
            const extraStats = player?.extraStats;
            if (extraStats && Array.isArray(extraStats._order)) {
                for (const k of extraStats._order) {
                    if (ctx[k] !== undefined) continue;          // 属性/派生优先
                    const raw = String(extraStats[k] ?? '');
                    const m = raw.match(/^(-?\d+(?:\.\d+)?)/);    // 匹配开头的数字
                    if (m) {
                        ctx[k] = parseFloat(m[1]);
                    }
                }
            }

            return ctx;
        },

        // 执行升级：返回变化列表
        applyLevelUp(player) {
            const results = [];

            for (const action of this.rules.levelUp) {
                const { target, op, value } = action;
                const delta = op === '+' ? value : -value;

                // 1. 角色属性（力量、敏捷等）→ 改 value
                const attr = player.attributes?.[target];
                if (attr !== undefined) {
                    const before = typeof attr === 'object' ? (attr.value ?? 0) : Number(attr) || 0;
                    const after = Math.max(0, before + delta);
                    if (typeof attr === 'object') attr.value = after;
                    else player.attributes[target] = after;
                    results.push({ target, field: 'value', before, after, diff: after - before });
                    continue;
                }

                // 2. 数值条 → ★ 改 base（上限涨）
                const bars = player.statusBars || [];
                const bar = bars.find(b =>
                    b.key === target ||
                    b.key.includes(target) ||
                    target.includes(b.key)
                );
                if (bar) {
                    const before = bar.base ?? bar.max ?? 0;
                    bar.base = Math.max(0, before + delta);
                    results.push({
                        target: bar.key,
                        field: 'base',
                        before,
                        after: bar.base,
                        diff: bar.base - before,
                    });
                    continue;
                }

                // 3. 额外数据（等级、金钱等）→ 改文本值
                const extra = player.extraStats;
                if (extra && extra[target] !== undefined) {
                    const raw = String(extra[target]);
                    const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                    if (m) {
                        const before = parseFloat(m[1]);
                        const unit = m[2] || '';
                        const after = Math.max(0, before + delta);
                        extra[target] = `${after}${unit}`;
                        results.push({ target, field: 'extra', before, after, diff: after - before });
                    }
                    continue;
                }

                console.warn(`[RuleEngine] 升级目标未找到: ${target}`);
            }

            // 重算派生（max 会自动 = base + 派生值）
            if (typeof DerivedStatsEngine !== 'undefined') {
                DerivedStatsEngine.recompute(player);
            }

            console.log('[RuleEngine] 升级应用结果:', results);
            return results;
        },

        // 检查玩家是否存活
        isAlive(player) {
            const bars = player?.statusBars || [];
            const hp = bars.find(b => /生命|血量|HP|hp/i.test(b.key));
            if (!hp) return true;
            return hp.current > 0;
        },
    };

    // ==================== 游戏钩子 ====================
    const GameplayHooks = {
        config: {
            hpZero:     true,
            expFull:    true,
        },

        _lastFire: {},

        _canFire(key, ms = 2000) {
            const now = Date.now();
            if (this._lastFire[key] && now - this._lastFire[key] < ms) return false;
            this._lastFire[key] = now;
            return true;
        },

        // 主入口：数值变化后调用
        async afterNumberChange(player, changedBar) {
            const tags = SemanticTagger.tag(player);
            console.log('[GameplayHooks] 语义标签:', Object.keys(tags));

            // 1. 生命归零
            if (this.config.hpZero && tags.hp && tags.hp.current <= 0) {
                await this.onZeroHp(player, tags);
            }

            // 2. 经验满
            if (this.config.expFull && tags.exp && tags.exp.max > 0
                && tags.exp.current >= tags.exp.max) {
                await this.onFullExp(player, tags);
            }
        },

        // 生命归零
        async onZeroHp(player, tags) {
            if (!this._canFire('hpZero')) return;

            if (!CinemaWorld.worldState.pendingEvents) CinemaWorld.worldState.pendingEvents = [];
            const exists = CinemaWorld.worldState.pendingEvents.some(
                e => e.name === '生命归零' && !e.processed
            );
            if (exists) return;

            CinemaWorld.worldState.pendingEvents.push({
                name: '生命归零',
                detail: '玩家生命值降到 0。请根据游戏规则决定后果：昏迷、濒死、死亡、还是被救起。',
                timestamp: Date.now(),
                processed: false,
            });

            await window.UIManager.showText('💀 你的生命值归零……\n世界陷入黑暗。', 3000);
            console.log('[GameplayHooks] 生命归零事件已记录');
        },

        // 经验满 → 升级
        async onFullExp(player, tags) {
            if (!this._canFire('expFull')) return;

            const exp = tags.exp.ref;
            const expMax = exp.max || 100;
            const expCur = exp.current;

            const overflow = expCur - expMax;
            let levelUps = 1;
            let nextNeed = expMax;
            let remain = overflow;
            while (remain >= nextNeed && nextNeed > 0) {
                remain -= nextNeed;
                levelUps++;
            }

            let levelBefore = null;
            let levelAfter = null;

            if (tags.level) {
                levelBefore = tags.level.source === 'extra'
                    ? tags.level.value
                    : parseInt(tags.level.ref.current) || 1;
                levelAfter = levelBefore + levelUps;

                if (tags.level.source === 'extra') {
                    tags.level.value = levelAfter;
                } else {
                    tags.level.ref.current = levelAfter;
                }
            }

            // 如果有规则里的升级动作，执行
            if (typeof RuleEngine !== 'undefined' && RuleEngine.rules.levelUp?.length > 0) {
                for (let i = 0; i < levelUps; i++) {
                    RuleEngine.applyLevelUp(player);
                }
            } else {
                console.log('[GameplayHooks] 无升级规则，只提升等级');
            }

            if (remain > 0) {
                exp.current = remain;
            } else {
                exp.current = 0;
            }

            DerivedStatsEngine.recompute(player);

            CinemaWorld.worldState.pendingEvents = CinemaWorld.worldState.pendingEvents || [];
            CinemaWorld.worldState.pendingEvents.push({
                name: '升级',
                detail: `玩家升级了 ${levelUps} 级${levelBefore !== null ? `（Lv.${levelBefore} → Lv.${levelAfter}）` : ''}。`,
                timestamp: Date.now(),
                processed: false,
            });

            const levelText = levelBefore !== null
                ? `Lv.${levelBefore} → Lv.${levelAfter}`
                : `+${levelUps} 级`;
            await window.UIManager.showText(`⭐ 升级！${levelText}`, 3500);

            PlayerStateManager.refreshAvatarArea();
            window.UIManager.updateWorldStateDisplay();

            console.log(`[GameplayHooks] 经验满，升级 ${levelUps} 次`);
        },

        // 获取待处理事件（供主线生成时消费）
        consumePendingEvents() {
            const events = CinemaWorld.worldState.pendingEvents || [];
            const pending = events.filter(e => !e.processed);
            pending.forEach(e => { e.processed = true; });
            return pending;
        },
    };

    // ==================== 触发规则执行器 ====================
    const TriggerExecutor = {
        _queue: [],
        _running: false,
        _currentRun: null,

        _fireLog: {},
        _FIRE_COOLDOWN: 1500,

        // ---------- 主入口 ----------
        async processTriggers(changedBar, player) {
            const triggers = RuleEngine.rules.triggers || [];
            if (triggers.length === 0) {
                console.log('[TriggerExecutor] 无触发规则');
                return;
            }

            const matched = this._matchTriggers(triggers, changedBar, player);
            if (matched.length === 0) return;

            console.log(`[TriggerExecutor] 命中 ${matched.length} 条触发规则`);

            for (const t of matched) {
                this._queue.push({ trigger: t, player });
            }

            if (this._running) {
                return this._currentRun;
            }
            this._running = true;
            this._currentRun = this._runQueueLoop();
            try {
                await this._currentRun;
            } finally {
                this._running = false;
                this._currentRun = null;
            }
        },

        // ---------- 匹配 ----------
        _matchTriggers(triggers, changedBar, player) {
            const matched = [];
            for (const t of triggers) {
                if (!this._conditionMatch(t.condition, player)) continue;

                const fireKey = `${t.condition.barKey}_${t.condition.type}_${t.condition.value || ''}`;
                const now = Date.now();
                if (this._fireLog[fireKey] && now - this._fireLog[fireKey] < this._FIRE_COOLDOWN) {
                    console.log(`[TriggerExecutor] 冷却中，跳过: ${fireKey}`);
                    continue;
                }
                this._fireLog[fireKey] = now;

                matched.push(t);
            }
            return matched;
        },

        _conditionMatch(cond, player) {
            const bar = this._findBar(cond.barKey, player);
            if (!bar) {
                console.log(`[TriggerExecutor] 找不到数值条: ${cond.barKey}`);
                return false;
            }
        
            switch (cond.type) {
                case 'full':
                    // ★ 只有"有上限"的条才能判满
                    //    - statusBars：有 max
                    //    - extraStats 里的 X/Y：有 max
                    //    - extraStats 里的纯数字：max = null，不支持"满"
                    if (bar.max === null || bar.max === undefined) {
                        console.warn(`[TriggerExecutor]「${cond.barKey}」无上限，不支持"满"条件`);
                        return false;
                    }
                    return bar.current >= bar.max;
        
                case 'empty':
                    return bar.current <= 0;
        
                case 'compare': {
                    const v = bar.current;
                    const target = cond.value;
                    switch (cond.op) {
                        case '>=': return v >= target;
                        case '<=': return v <= target;
                        case '>':  return v > target;
                        case '<':  return v < target;
                        case '==': return v === target;
                    }
                    return false;
                }
            }
            return false;
        },

        // ---------- 找数值条（支持额外数据）----------
        _findBar(key, player) {
            // 1. 数值条
            const bars = player.statusBars || [];
            const bar = bars.find(b =>
                b.key === key ||
                b.key.includes(key) ||
                key.includes(b.key)
            );
            if (bar) return bar;

            // 2. 额外数据
            const extra = player.extraStats;
            if (extra && extra[key] !== undefined) {
                const raw = String(extra[key]).trim();

                // ★ 先试 X/Y 格式
                const barMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(.*)$/);
                if (barMatch) {
                    return {
                        key: key,
                        current: parseFloat(barMatch[1]),
                        max: parseFloat(barMatch[2]),
                        _isExtra: true,
                        _isExtraBar: true,        // 标记它是"额外数据里的数值条"
                        _unit: barMatch[3] || '',
                        _ref: extra,
                    };
                }

                // 再试纯数字
                const numMatch = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                if (numMatch) {
                    return {
                        key: key,
                        current: parseFloat(numMatch[1]),
                        max: null,                // ★ 改成 null，明确"无上限"
                        _isExtra: true,
                        _isExtraBar: false,
                        _unit: numMatch[2] || '',
                        _ref: extra,
                    };
                }
            }

            return null;
        },

        // ---------- 队列循环 ----------
        async _runQueueLoop() {
            while (this._queue.length > 0) {
                const { trigger, player } = this._queue.shift();
                await this._executeOne(trigger, player);
                await new Promise(r => setTimeout(r, 300));
            }
        },

        // ---------- 执行单条 ----------
        async _executeOne(trigger, player) {
            const condText = this._formatCondition(trigger.condition);
            console.log(`[TriggerExecutor] 执行触发: ${condText}`);

            await window.UIManager.showText(`⚡ 触发规则\n${condText}`, 2000);

            const programActions = [];
            const eventActions = [];
            for (const act of trigger.actions) {
                if (act.type === 'triggerEvent') {
                    eventActions.push(act);
                } else {
                    programActions.push(act);
                }
            }

            if (programActions.length > 0) {
                const changes = await this._executeProgramActions(programActions, player);
                if (changes.length > 0) {
                    await window.UIManager.showText(changes.join('\n'), 3000);
                }
            }

            for (const act of eventActions) {
                await this._executeEventAction(act, player, trigger);
            }
        },

        // ---------- 程序 actions ----------
        async _executeProgramActions(actions, player) {
            const changes = [];

            for (const act of actions) {
                switch (act.type) {
                    case 'attrChange': {
                        const result = this._changeAttribute(act, player);
                        if (result) changes.push(result);
                        break;
                    }
                    case 'resetBar': {
                        const bar = this._findBar(act.barKey, player);
                        if (bar) {
                            const before = bar.current;
                            if (bar._isExtra) {
                                // ★ 额外数据：根据是否有 max 决定写回格式
                                if (bar._isExtraBar) {
                                    bar._ref[bar.key] = `0/${bar.max}${bar._unit || ''}`;
                                } else {
                                    bar._ref[bar.key] = `0${bar._unit || ''}`;
                                }
                            } else {
                                bar.current = 0;
                            }
                            changes.push(`📊 ${bar.key}: ${before} → 0`);
                        }
                        break;
                    }
                    case 'gainItem': {
                        player.inventory = player.inventory || [];
                        const ex = player.inventory.find(i => i.name === act.name);
                        if (ex) {
                            ex.count = (ex.count || 1) + 1;
                        } else {
                            player.inventory.push({
                                name: act.name,
                                count: 1,
                                icon: '📦',
                                description: '（由触发规则获得）',
                            });
                        }
                        changes.push(`📦 获得 ${act.name}`);
                        break;
                    }
                    case 'gainStatus': {
                        player.tags = player.tags || [];
                        if (!player.tags.includes(act.name)) {
                            player.tags.push(act.name);
                            changes.push(`✨ 获得状态 ${act.name}`);
                        }
                        break;
                    }
                }
            }

            if (changes.length > 0) {
                DerivedStatsEngine.recompute(player);
                PlayerStateManager.refreshAvatarArea();
                window.UIManager.updateWorldStateDisplay();
            }

            return changes;
        },

        // ---------- 改属性 ----------
        _changeAttribute(act, player) {
            const { target, op, value } = act;
            const delta = op === '+' ? value : -value;

            // 1. 属性表
            const attr = player.attributes?.[target];
            if (attr !== undefined) {
                const before = typeof attr === 'object' ? (attr.value ?? 0) : Number(attr) || 0;
                const after = Math.max(0, before + delta);
                if (typeof attr === 'object') attr.value = after;
                else player.attributes[target] = after;
                return `📊 ${target}: ${before} → ${after}`;
            }

            // 2. 数值条
            const bar = this._findBar(target, player);
            if (bar && !bar._isExtra) {
                const before = bar.current;
                bar.current = Math.max(0, Math.min(bar.max, before + delta));
                return `📊 ${bar.key}: ${before} → ${bar.current}`;
            }

            // 3. 额外数据
            const extra = player.extraStats;
            if (extra && extra[target] !== undefined) {
                const raw = String(extra[target]);
                const barMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(.*)$/);
                if (barMatch) {
                    const before = parseFloat(barMatch[1]);
                    const max = parseFloat(barMatch[2]);
                    const tail = barMatch[3] || '';
                    const after = Math.max(0, Math.min(max, before + delta));
                    extra[target] = `${after}/${max}${tail}`;
                    return `📊 ${target}: ${before}/${max} → ${after}/${max}`;
                }

                const numMatch = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                if (numMatch) {
                    const before = parseFloat(numMatch[1]);
                    const unit = numMatch[2] || '';
                    const after = Math.max(0, before + delta);
                    extra[target] = `${after}${unit}`;
                    return `📊 ${target}: ${before} → ${after}`;
                }
            }

            return null;
        },

        // ---------- 事件 action（走 AI）----------
        async _executeEventAction(act, player, trigger) {
            const eventName = act.name;
            const eventDetail = act.detail || '';   // ★ 新增
            const condText = this._formatCondition(trigger.condition);

            console.log(`[TriggerExecutor] 事件触发: ${eventName}`);

            CinemaWorld.worldState.pendingEvents = CinemaWorld.worldState.pendingEvents || [];
            CinemaWorld.worldState.pendingEvents.push({
                name: eventName,
                detail: eventDetail
                    ? `由触发规则引发：${condText} → ${eventName}\n${eventDetail}`
                    : `由触发规则引发：${condText} → ${eventName}`,
                timestamp: Date.now(),
                processed: false,
            });

            await window.UIManager.showText(`🌀 事件触发：${eventName}`, 2000);

            const story = await this._generateEventStory(eventName, trigger, player, eventDetail);

            if (!story) {
                await window.UIManager.showText(`（事件「${eventName}」已记录，将在后续剧情中展开）`, 2500);
                return;
            }

            if (story.dialogues.length > 0) {
                await window.VisualNovelManager.play(story.dialogues);
            } else if (story.rawScript) {
                await window.UIManager.showText(story.rawScript, 5000);
            }

            // ★ 应用效果（数值、物品、状态）
            if (story.effectPart) {
                await new Promise(r => setTimeout(r, 300));
                const results = window.EffectSystem.applyFromNarrative(story.effectPart);
                const effectText = window.EffectSystem.formatResults(results);
                if (effectText) await window.UIManager.showText(effectText, 4000);
            }

            // ★ 应用场景更新
            if (story.sceneUpdates && story.sceneUpdates.length > 0) {
                for (const up of story.sceneUpdates) {
                    await window.StoryManager.applySceneUpdate(up);
                }
            }
        },

        // ---------- 事件剧情生成 ----------
        async _generateEventStory(eventName, trigger, player) {
            console.log(`[TriggerExecutor] 开始生成事件剧情: ${eventName}`);

            const scene = window.LocationModalManager?.currentLocation;
            const condText = this._formatCondition(trigger.condition);

            console.log(`[TriggerExecutor] 当前场景:`, scene?.name || '(无)');
            const sceneCtx = window.InventoryManager.buildSceneContext(scene);
            const ctx = window.StoryManager.buildContext(null, {
                parentStory: false,
                mainChars: true,
                scene: false,
                pendingEvents: false,
                volumes: false,
                interactionDigests: false,
            });

            const playerBlock = PlayerStateManager.formatForPrompt();

            const prompt = `你正在为视觉小说游戏生成一段"触发事件"的剧情脚本。

【世界与当前状态】
${ctx}

【场景上下文】
${sceneCtx}

★ 当前环境数据：${window.WorldManager.getEnvDataText(scene)}

${playerBlock}

【触发事件】
事件名称：${eventName}
触发条件：${condText}
说明：这是由游戏规则自动触发的事件，不是玩家主动选择的结果。

【任务】
生成一段剧情脚本，描述这个事件如何发生、玩家如何经历它。

【重要约束】
1. ★ 不要修改玩家的任何属性数值（生命值、体力、理智等）——程序已经处理了
2. ★ 只能修改：场景实体、场景环境、NPC 的状态/心情/好感度
3. ★ 只能使用当前场景已有的人物，不要凭空创造角色
4. 生成 5-10 行对话/旁白

【音乐提示】
🎵 音乐: (可选，符合氛围的音乐名)

【输出格式】
每一行是一个对话或旁白：
【角色名|显示/隐藏|位置|性别】: 对话/旁白内容

规则：
1. 位置只能是：左、中、右
2. 正在说话/动作的角色用"显示"，其他用"隐藏"
3. 旁白用【旁白】
4. 场景人物：${scene?.sceneCharacters?.map(c => c.name).join('、') || '（无）'}

实体变化:
- 获得【物品名|图标】：描述，[类型|状态|功能|交互方式|效果:效果DSL|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 失去【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
- 获得状态 状态名（可选效果，| 分隔：攻击-20%|持续3回合）
- 移除状态 状态名

★ 关键：获得物品时必须写完整格式（方括号内 键:值），否则玩家拿到的是空壳。
★ 可装备物品：写明属性字段，如 [类型:武器|攻击:+5|暴击:+10%]
★ 可消耗物品：写明功能，如 [类型:消耗品|功能:回复 50 点生命|可堆叠]
★ 普通物品：至少写 [类型:物品] 和图标
效果DSL:<动作><目标> <值>[; <动作><目标> <值>...]
动作：
- 回复：当前值+N，不超上限（如"回复生命 X"）
- 提升：上限+N，当前值同步+N（如"提升生命上限 X"）
- 设置：当前值=N（如"设置生命 X"）
- 减少：当前值-N（如"减少理智 Y"）
- 永久：永久改变属性（如"永久力量 X"）
- 状态：加状态（如"状态中毒 X"）
- 移除：移除状态（如"移除中毒"）
- 增益：临时属性加成（如"增益攻击 X Y回合"）

值可以是数字或百分比：回复生命 X / 回复生命 X%
多效果用分号分隔：回复生命 X; 回复体力 X
无效果的物品写 效果:无

示例：
- 【生锈的铁剑|⚔️】：斜靠在墙角，[类型:武器|可拾取:是|货币种类:金钱|买价:X|卖价:X|攻击:+X]
- 【红药水|🧪】：一瓶红色药剂，[类型:消耗品|可拾取:是|功能:回复生命|效果:回复生命 X|可堆叠:是|货币种类:金钱|买价:X|卖价:X|最大堆叠:X]
- 【野花|🌸】：路边的小花，[类型:材料|可拾取:是|可堆叠:是|货币种类:金钱|买价:X|卖价:X|最大堆叠:X]
- 【守卫的盾牌|🛡️】：靠在门边的圆盾，[类型:护甲|可拾取:是|货币种类:金钱|买价:X|卖价:X|防御:+X|体力:+Y]

【场景更新】（可选，只有需要改场景时才写）
场景: (场景名)
环境数据:
- 键: 值
修改人物：
- 【人物名】：心情|新心情
移除人物: 名字
新增实体：
- 【实体名|图标】：描述，[类型|状态|功能|交互方式|其他]
如果是物品则是（物品也是一种实体）:
- 【物品名|图标】：描述，[类型|状态|功能|交互方式|效果:效果DSL|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]
新增遭遇实体：
- 【敌人名|图标】：描述，[类型:遭遇|HP:当前/最大|攻击:X|防御:X|敏捷:X|技能:X|掉落:X]
（★ 当事件引发了战斗时使用。
  不涉及战斗就不写。）

★可以生成多个遭遇实体。

移除实体: 名字
修改实体：
- 【实体名】：状态→新状态

【摘要】
（1-2 句话总结这个事件，供后续剧情参考）

请开始生成：`;

            const result = await window.generateFunctionalReply(prompt, 'trigger-event');
            console.log(`[TriggerExecutor] AI 返回:`, result ? `${result.substring(0, 80)}...` : 'null');

            if (!result) return null;

            // ---------- 切摘要 ----------
            const summaryMatch = result.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
            const digestSummary = summaryMatch ? summaryMatch[1].trim() : '';

            const withoutDigest = result.replace(/【摘要】[\s\S]*?(?=\n【|$)/, '').trim();

            // ---------- 切效果 / 场景更新 / 脚本 ----------
            const effectIdx = withoutDigest.indexOf('【效果】');
            const updateIdx = withoutDigest.indexOf('【场景更新】');

            // 收集所有块的位置，按先后排序
            const blockPoints = [];
            if (effectIdx >= 0) blockPoints.push({ key: 'effect', idx: effectIdx });
            if (updateIdx >= 0) blockPoints.push({ key: 'update', idx: updateIdx });
            blockPoints.sort((a, b) => a.idx - b.idx);

            // 脚本 = 从开头到第一个块
            const scriptEnd = blockPoints.length > 0 ? blockPoints[0].idx : withoutDigest.length;
            const scriptText = withoutDigest.substring(0, scriptEnd).trim();

            // 提取每个块的内容
            let effectPart = '';
            let sceneUpdatePart = '';
            for (let i = 0; i < blockPoints.length; i++) {
                const start = blockPoints[i].idx;
                const end = i + 1 < blockPoints.length ? blockPoints[i + 1].idx : withoutDigest.length;
                const part = withoutDigest.substring(start, end);
                if (blockPoints[i].key === 'effect') effectPart = part;
                else if (blockPoints[i].key === 'update') sceneUpdatePart = part;
            }

            // ---------- 音乐 ----------
            await window.MusicManager.applyMusicMarker(result);

            // ---------- 解析场景更新 ----------
            let sceneUpdate = null;
            if (sceneUpdatePart) {
                sceneUpdate = window.StoryManager.parseSceneUpdate(sceneUpdatePart);
            }

            // ---------- 解析脚本 ----------
            const dialogues = window.VisualNovelManager.parseScript(scriptText);
            console.log(`[TriggerExecutor] 解析出 ${dialogues.length} 行对话`);

            // ---------- 记录历史（先记录，等播放完再应用效果） ----------
            window.InteractionHistoryManager.add({
                type: 'triggerEvent',
                target: eventName,
                targetMeta: { condition: condText },
                scene: scene?.name || '(无场景)',
                playerInput: `（规则触发：${condText}）`,
                script: scriptText,
                effect: effectPart || null,
                summary: digestSummary,
            });

            await window.MusicManager.clearOverrideMusic();

            return {
                dialogues,
                sceneUpdates: sceneUpdate ? [sceneUpdate] : [],
                effectPart: effectPart || '',      // ★ 新增：带回去
                summary: digestSummary,
                rawScript: scriptText,
            };
        },

        // ---------- 格式化条件 ----------
        _formatCondition(cond) {
            switch (cond.type) {
                case 'full':    return `${cond.barKey} 满`;
                case 'empty':   return `${cond.barKey} 空`;
                case 'compare': return `${cond.barKey} ${cond.op} ${cond.value}`;
            }
            return cond.barKey;
        },
    };

    // ==================== 规则创建管理器 ====================
    const RuleCreationManager = {
        _onComplete: null,

        showCreationModal(onComplete = null) {
            this._onComplete = onComplete;
            const modal = document.getElementById('cinemaworld-modal');
            const scene = window.LocationModalManager?.currentLocation;
            const player = PlayerStateManager.player;

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚙️ 定义游戏规则</div>
                <div style="text-align:center;padding:5px 0 18px;color:#aaa;font-size:13px;line-height:1.7;">
                    这一步定义这个世界的运作方式。<br>
                    <span style="color:#7da8ff;">可以描述判定方式、属性体系、战斗逻辑、升级机制。</span><br>
                    留空则由 AI 自动生成。
                </div>

                <div style="margin-bottom:12px;padding:10px;background:rgba(120,150,255,.08);
                    border-radius:8px;font-size:12px;color:#bbb;line-height:1.6;">
                    <div style="color:#7da8ff;margin-bottom:4px;">当前世界</div>
                    ${scene ? `📍 ${scene.name}` : '（无）'}<br>
                    <div style="color:#7da8ff;margin:6px 0 4px;">玩家属性</div>
                    ${Object.entries(player.attributes || {}).map(([k, v]) =>
                        `${k}: ${typeof v === 'object' ? v.value : v}`
                    ).join(' · ') || '（无）'}
                </div>

                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">规则指导（可选）：</div>
                    <textarea class="cinemaworld-textarea" id="rule-guide-input"
                        placeholder="例如：&#10;- 想要 D20 判定系统&#10;- 力量/敏捷/智力/体质四种属性&#10;- 战斗看攻防差&#10;- 每次升级随机加一点属性"
                        style="min-height:120px;"></textarea>
                </div>

                <div id="rule-generation-result" style="display:none;margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">AI 生成结果（可编辑）：</div>
                    <textarea class="cinemaworld-textarea" id="rule-generated-text"
                        style="min-height:360px;font-family:monospace;"></textarea>
                </div>

                <div style="text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" id="gen-rule-btn"
                        onclick="RuleCreationManager.generate()">🤖 生成规则</button>
                    <button class="cinemaworld-button primary" id="confirm-rule-btn"
                        onclick="RuleCreationManager.confirm()" style="display:none;">✅ 确认并开始</button>
                    <button class="cinemaworld-button"
                        onclick="RuleCreationManager.skip()">跳过（用默认规则）</button>
                </div>`;
            modal.className = 'active';
        },

        async generate() {
            const guide = document.getElementById('rule-guide-input')?.value.trim() || '';
            const btn = document.getElementById('gen-rule-btn');
            btn.disabled = true;
            btn.innerHTML = '⏳ 生成中...';

            const scene = window.LocationModalManager?.currentLocation;
            const player = PlayerStateManager.player;
            const wh = CinemaWorld.worldState.worldHistory;

            const ctxParts = [];
            if (wh?.summary) ctxParts.push(`世界史：${wh.summary}`);
            if (scene) {
                ctxParts.push(`初始场景：${scene.name}`);
                if (scene.description) ctxParts.push(`场景描述：${scene.description}`);
            }
            if (player.profile) ctxParts.push(`玩家设定：${player.profile}`);
            const attrText = Object.entries(player.attributes || {})
                .map(([k, v]) => `${k}: ${typeof v === 'object' ? v.value : v}`).join('、');
            if (attrText) ctxParts.push(`当前属性：${attrText}`);
            const barText = (player.statusBars || [])
                .map(b => `${b.key} ${b.current}/${b.max}`).join('、');
            if (barText) ctxParts.push(`当前状态条：${barText}`);
            const extra = player.extraStats;
            if (extra && extra._order && extra._order.length > 0) {
                const extraText = extra._order
                    .filter(k => extra[k] !== undefined && extra[k] !== '')
                    .map(k => `${k}: ${extra[k]}`)
                    .join('、');
                if (extraText) ctxParts.push(`额外数据：${extraText}`);
            }
            const sceneCtx = InventoryManager.buildSceneContext(scene);

            const prompt = `你正在为一个视觉小说 RPG 游戏生成"运行规则"。
这些规则会作为整个游戏的系统基础，贯穿始终。

【世界与玩家上下文】
${ctxParts.join('\n')}

【场景上下文】
${sceneCtx}

★ 环境数据：${WorldManager.getEnvDataText(scene)}

${guide ? `【玩家希望的规则方向】\n${guide}\n` : ''}

【输出格式】（严格遵守，用 markdown 风格的区块）

【派生规则】
派生名 = 表达式
派生名 = 表达式
（表达式可用：属性名、等级、常数、四则运算。
 示例：生命值 = 体质 × 5 + 等级 × 10）

【升级规则】
（经验满时触发，用"属性 +N"格式，分号分隔：
 等级 +1；生命值 +10；力量 +1）

【触发规则】
（定义"某个数值条满/空/达到阈值时，会发生什么"。
 每行一条，格式：条件 → 动作

 条件写法：
   [条名]满 或 [条名]空 或 [条名]>=数值 或 [条名]<=数值
 动作写法：
   属性名 +N ； 属性名 -N ； 获得物品 xxx ； 触发事件 事件名|事件描述

 示例：
   经验满 → 等级+1；力量+1；经验归零
   生命值空 → 触发死亡
   饱食度空 → 生命值-10；获得状态 饥饿
   中毒>=100 → 生命值-30；中毒归零
   声望>=100 → 触发事件 晋升；力量+1
   
 注意：
 - 只有需要触发的数值条才写在这里，没写的条满/空都不会有任何效果
 - "归零"表示把该条 current 重置为 0
 - 触发事件 事件名|事件描述 会在剧情里作为特殊事件被 AI 处理
 - 一条数值条可以同时有多个触发（满了和空了分开写）
 ★ 获得状态时带效果，格式：获得状态 名字（效果1|效果2|...）
   效果字段：
   - 属性修正：攻击-20% / 防御+30% / 敏捷+5
   - 每回合：生命-5 / 体力-3
   - 持续：持续3回合
   - 特殊：跳过回合

   示例：
   获得状态 中毒（生命-5|持续3回合）
   获得状态 狂暴（攻击+50%|防御-30%）
   获得状态 眩晕（跳过回合|持续1回合）

【战斗规则】
伤害公式: {攻击} - {防御}
命中判定: d20 + {属性名} >= 12
暴击: 必中，伤害 × 暴击伤害
暴击率上限: 80%
先攻: d20 + {属性名}
胜利条件: 敌人 HP 归零
失败条件: 玩家 HP 归零
属性映射: 攻击=攻击，防御=防御，敏捷=敏捷，生命=生命值，X=Y,

（这一段定义战斗的运作方式。每行一个键值对，用"键: 值"格式。
★ 只在需要战斗的世界观里写这一段，纯剧情/日常向的世界可以不写。
★ 属性映射必须使用玩家【属性定义】里已有的属性名，
   不能凭空发明。如果玩家没有对应属性，用默认名（攻击/防御/敏捷/生命值）。

字段说明：
- 伤害公式：用 {属性名} 引用属性。支持四则运算、括号、骰子（如 d6、2d10）
  ★ 可以引用玩家和敌人的任意属性，例如：
    {攻击} * (1 + {灵力}/100) - {防御}
    2d6 + {灵力} * 1.5 - {敌人.抗性}
  ★ 用 {敌人.属性名} 引用敌人的额外属性（如果敌人有的话）
  ★ 用 {我方.属性名} 明确引用攻击方的属性（默认裸名就是攻击方）
- 命中判定：d20 + {敏捷} >= N。不判定写"必中"
- 暴击：写"伤害 ×数字"，表示没有"暴击伤害"属性时的默认倍率。
  "上限 XX%"表示暴击率的最大值（默认 80%）。
  ★ 暴击率本身来自玩家的属性/派生属性，不在规则里写。
- 暴击率上限：玩家暴击率的上限，默认 80%（小数 0.8）
- 先攻：决定谁先出手
- 胜利/失败条件：固定写"敌人 HP 归零"/"玩家 HP 归零"
- 属性映射：把战斗公式里的通用名（攻击/防御/敏捷/生命）映射到玩家实际属性名
  ★ 如果你的世界用"灵力"代替"攻击"，可以写：
    属性映射: 攻击=灵力，防御=体质，敏捷=身法，生命=生命值
- 特殊判定（可选）：定义额外的判定线，例如：
    特殊判定: 理智对抗: d20 + {意志} >= 敌人.恐惧
    特殊判定: 魅力说服: d20 + {魅力} >= 敌人.意志
）

【时间规则】
名称: (世界观下的纪年名，如"蓬莱历"、"星海纪")
时间结构: 1年=12月, 1月=30天, 1天=24小时
基准流速: 1现实秒 = 1游戏分钟
起始时间: X年X月X日 HH:MM
时段划分:
- 清晨: 5-8
- 白天: 8-16
- 黄昏: 16-19
- 夜晚: 19-23
- 深夜: 23-5
季节系统: 春(3-5)、夏(6-8)、秋(9-11)、冬(12-2)
派生规则:
- 温度 = 季节基础 + 时段修正 + 天气修正
- 湿度 = 天气基础 + 时段修正
- 风力 = 天气基础 + 随机
节日:
- 1月1日 元日（全城庆祝，商店关闭）
- 3月15日 花祭（樱花开，NPC 白天外出）
- 7月7日 星祭（夜晚放灯，NPC 夜里活动）
- 12月30日 岁末（年终结算，NPC 盘点）
特殊日期:
- 每月15日：月圆之夜（事件可触发）
- 每季最后一天：季节交替（天气更剧烈）
天气池:
春: 晴、多云、小雨、雾
夏: 晴、雷阵雨、大雨
秋: 晴、多云、小雨
冬: 晴、小雪、大雪
时段影响:
- 夜晚（19-5）：NPC 不外出，商店关闭
- 深夜（23-5）：玩家理智缓慢下降
- 黄昏（16-19）：NPC 归家，好感度对话更易触发
事件钩子:
- 每日 6:00 → 触发事件 日出
- 每月1日 8:00 → 触发事件 月初
- 节日当天 0:00 → 触发事件 节日
叙述提示: (一段话描述这个世界的时间氛围)

规则要符合当前世界观和剧情背景。
时间流速、节日、季节、时段都可以自由设计。
如果世界观没有明确的时间体系（如现代都市），可以用简化版：
1年=12月, 1月=30天, 1天=24小时, 1现实秒=1游戏分钟。

【约束】
2. 派生表达式只能使用【属性定义】里列出的属性名、常数、四则运算
3. 不要生成未定义的属性
4. 机制不要过于复杂，每一条都要可用


请生成：`;

            const result = await window.generateFunctionalReply(prompt, 'rule-generation');
            btn.disabled = false;
            btn.innerHTML = '🤖 生成规则';

            if (result) {
                document.getElementById('rule-generated-text').value = result;
                document.getElementById('rule-generation-result').style.display = 'block';
                document.getElementById('confirm-rule-btn').style.display = 'inline-block';
            }
        },

        confirm() {
            const text = document.getElementById('rule-generated-text')?.value.trim() || '';
            if (text) {
                // ★ 清空旧派生，完全以新规则为准
                PlayerStateManager.player.derivedStats = { rules: [], computed: {} };
                (PlayerStateManager.player.statusBars || []).forEach(b => { b.derivedExpr = null; });

                RuleEngine.parse(text);
                CinemaWorld.worldState.gameRules = text;
                DerivedStatsEngine.syncFromRules(PlayerStateManager.player);
                DerivedStatsEngine.recompute(PlayerStateManager.player);
            }
            PlayerStateManager.refreshAvatarArea();
            window.UIManager.updateWorldStateDisplay();
            window.SceneAvatarBarManager.buildForScene(window.LocationModalManager?.currentLocation);
            window.SceneActionManager.refresh();
            window.UIManager.closeModal();
            if (window.SaveManager) window.SaveManager.save();
            if (typeof this._onComplete === 'function') {
                const cb = this._onComplete;
                this._onComplete = null;
                cb();
            }
        },

        skip() {
            CinemaWorld.worldState.gameRules = '';
            window.UIManager.closeModal();
            if (window.SaveManager) window.SaveManager.save();
            if (typeof this._onComplete === 'function') {
                const cb = this._onComplete;
                this._onComplete = null;
                cb();
            }
        },

        // 查看/编辑当前规则
        openEditor() {
            const modal = document.getElementById('cinemaworld-modal');
            const current = CinemaWorld.worldState.gameRules || '';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚙️ 游戏规则</div>
                <div style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.6;">
                    保存后会重新解析规则，并同步派生属性。
                </div>
                <textarea class="cinemaworld-textarea" id="rule-edit-input"
                    style="min-height:400px;font-family:monospace;">${current}</textarea>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary" onclick="RuleCreationManager.saveEdit()">保存</button>
                    <button class="cinemaworld-button" onclick="RuleCreationManager.regenerate()">🔄 AI重新生成</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;
            modal.className = 'active';
        },

        saveEdit() {
            const text = document.getElementById('rule-edit-input')?.value.trim() || '';
            CinemaWorld.worldState.gameRules = text;
            RuleEngine.parse(text);
            DerivedStatsEngine.syncFromRules(PlayerStateManager.player);
            DerivedStatsEngine.recompute(PlayerStateManager.player);
            window.UIManager.updateWorldStateDisplay();
            PlayerStateManager.refreshAvatarArea();
            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.closeModal();
        },

        regenerate() {
            window.UIManager.closeModal();
            this.showCreationModal(null);
        },
    };
        // ==================== 时间规则引擎 ====================
        const TimeRuleEngine = {
            rules: {
                name: '',
                structure: {
                    hoursPerDay: 24,
                    daysPerMonth: 30,
                    monthsPerYear: 12,
                    startDate: { year: 1, month: 1, day: 1, hour: 6, minute: 0 },
                },
                speed: { minutesPerRealSecond: 1 },
                phases: [],
                seasons: [],
                derived: [],
                festivals: [],
                specialDates: [],
                weatherPool: {},
                phaseEffects: [],
                eventHooks: [],
                narrative: '',
                raw: '',
            },
    
            // ---------- 解析 ----------
            parse(text) {
                if (!text || typeof text !== 'string') {
                    this._reset();
                    return this.rules;
                }
    
                const rules = {
                    name: '',
                    structure: {
                        hoursPerDay: 24,
                        daysPerMonth: 30,
                        monthsPerYear: 12,
                        startDate: { year: 1, month: 1, day: 1, hour: 6, minute: 0 },
                    },
                    speed: { minutesPerRealSecond: 1 },
                    phases: [],
                    seasons: [],
                    derived: [],
                    festivals: [],
                    specialDates: [],
                    weatherPool: {},
                    phaseEffects: [],
                    eventHooks: [],
                    narrative: '',
                    raw: text,
                };
    
                // 只解析【时间规则】这一段
                const re = /【时间规则】\s*([\s\S]*?)(?=\n【|$)/;
                const m = text.match(re);
                if (!m) {
                    this.rules = rules;
                    console.log('[TimeRuleEngine] 未找到【时间规则】段，使用默认');
                    return rules;
                }
                const block = m[1];
    
                // 辅助：抽取子段
                const sub = (title) => {
                    const r = new RegExp(`${title}\\s*[:：]?\\s*([\\s\\S]*?)(?=\\n\\S+\\s*[:：]|\\n-\\s*\\S+\\s*[:：]|$)`);
                    const mm = block.match(r);
                    return mm ? mm[1].trim() : '';
                };
    
                // ---------- 名称 ----------
                const nameM = block.match(/^名称\s*[:：]\s*(.+)$/m);
                if (nameM) rules.name = nameM[1].trim();
    
                // ---------- 时间结构 ----------
                const structM = block.match(/^时间结构\s*[:：]\s*(.+)$/m);
                if (structM) {
                    const s = structM[1];
                    const yearM = s.match(/1\s*年\s*=\s*(\d+)\s*月/);
                    const monthM = s.match(/1\s*月\s*=\s*(\d+)\s*天/);
                    const dayM = s.match(/1\s*天\s*=\s*(\d+)\s*小时/);
                    if (yearM) rules.structure.monthsPerYear = parseInt(yearM[1]);
                    if (monthM) rules.structure.daysPerMonth = parseInt(monthM[1]);
                    if (dayM) rules.structure.hoursPerDay = parseInt(dayM[1]);
                }
    
                // ---------- 起始时间 ----------
                const startM = block.match(/^起始时间\s*[:：]\s*(.+)$/m);
                if (startM) {
                    const sm = startM[1].match(/(\d+)\s*年\s*(\d+)\s*月\s*(\d+)\s*日\s*(\d+)\s*[:：]\s*(\d+)/);
                    if (sm) {
                        rules.structure.startDate = {
                            year: parseInt(sm[1]),
                            month: parseInt(sm[2]),
                            day: parseInt(sm[3]),
                            hour: parseInt(sm[4]),
                            minute: parseInt(sm[5]),
                        };
                    }
                }
    
                // ---------- 流速 ----------
                const speedM = block.match(/^基准流速\s*[:：]\s*(.+)$/m);
                if (speedM) {
                    const s = speedM[1];
                    // 支持：1现实秒 = 1游戏分钟
                    const m1 = s.match(/1\s*现实秒\s*=\s*(\d+(?:\.\d+)?)\s*游戏分钟/);
                    if (m1) {
                        rules.speed.minutesPerRealSecond = parseFloat(m1[1]);
                    } else {
                        // 兜底：X现实分钟 = Y游戏小时/天
                        const m2 = s.match(/(\d+(?:\.\d+)?)\s*现实(分钟|小时|秒)\s*=\s*(\d+(?:\.\d+)?)\s*游戏(分钟|小时|天)/);
                        if (m2) {
                            const realUnit = m2[2];
                            const gameUnit = m2[4];
                            let realSec = parseFloat(m2[1]);
                            if (realUnit === '分钟') realSec *= 60;
                            if (realUnit === '小时') realSec *= 3600;
    
                            let gameMin = parseFloat(m2[3]);
                            if (gameUnit === '小时') gameMin *= 60;
                            if (gameUnit === '天') gameMin *= 1440;
    
                            rules.speed.minutesPerRealSecond = gameMin / realSec;
                        }
                    }
                }
    
                // ---------- 时段划分 ----------
                const phaseM = block.match(/时段划分\s*[:：]?\s*\n([\s\S]*?)(?=\n\S+\s*[:：]|\n【|$)/);
                if (phaseM) {
                    for (const line of phaseM[1].split('\n')) {
                        const clean = line.replace(/^[-•*]\s*/, '').trim();
                        if (!clean) continue;
                        const pm = clean.match(/^([^:：]+?)\s*[:：]\s*(\d+)\s*[-~到至]\s*(\d+)/);
                        if (pm) {
                            rules.phases.push({
                                name: pm[1].trim(),
                                start: parseInt(pm[2]),
                                end: parseInt(pm[3]),
                            });
                        }
                    }
                }
    
                // ---------- 季节系统 ----------
                const seasonM = block.match(/季节系统\s*[:：]\s*(.+)$/m);
                if (seasonM) {
                    const s = seasonM[1];
                    // 春(3-5)、夏(6-8) 或 春（3、4、5）
                    const re2 = /([春夏秋冬])\s*[（(]([^）)]+)[）)]/g;
                    let sm2;
                    while ((sm2 = re2.exec(s)) !== null) {
                        const name = sm2[1];
                        const inner = sm2[2];
                        const months = [];
                        // 支持 "3-5" 和 "3、4、5" 两种写法
                        if (/-/.test(inner)) {
                            const rangeM = inner.match(/(\d+)\s*[-~]\s*(\d+)/);
                            if (rangeM) {
                                const a = parseInt(rangeM[1]);
                                const b = parseInt(rangeM[2]);
                                for (let i = a; i <= b; i++) months.push(i);
                            }
                        } else {
                            inner.split(/[,，、]/).forEach(x => {
                                const n = parseInt(x.trim());
                                if (!isNaN(n)) months.push(n);
                            });
                        }
                        if (months.length > 0) {
                            rules.seasons.push({ name, months });
                        }
                    }
                }
                // 兜底：如果 AI 没写季节系统，用默认四季
                if (rules.seasons.length === 0) {
                    rules.seasons = [
                        { name: '春', months: [3, 4, 5] },
                        { name: '夏', months: [6, 7, 8] },
                        { name: '秋', months: [9, 10, 11] },
                        { name: '冬', months: [12, 1, 2] },
                    ];
                }
    
                // ---------- 派生规则 ----------
                const derivedM = block.match(/派生规则\s*[:：]?\s*\n([\s\S]*?)(?=\n\S+\s*[:：]|\n【|$)/);
                if (derivedM) {
                    for (const line of derivedM[1].split('\n')) {
                        const clean = line.replace(/^[-•*]\s*/, '').trim();
                        if (!clean) continue;
                        const dm = clean.match(/^(.+?)\s*[=＝]\s*(.+)$/);
                        if (dm) {
                            rules.derived.push({
                                name: dm[1].trim(),
                                expr: dm[2].trim(),
                            });
                        }
                    }
                }
    
                // ---------- 节日 ----------
                const festivalM = block.match(/节日\s*[:：]?\s*\n([\s\S]*?)(?=\n\S+\s*[:：]|\n【|$)/);
                if (festivalM) {
                    for (const line of festivalM[1].split('\n')) {
                        const clean = line.replace(/^[-•*]\s*/, '').trim();
                        if (!clean) continue;
                        // 支持：1月1日 元日（全城庆祝，商店关闭）
                        //      1月1日 元日：全城庆祝，商店关闭
                        const fm = clean.match(/^(\d+)\s*月\s*(\d+)\s*日\s+([^（(：:]+?)\s*[（(：:]\s*(.+?)[）)]?\s*$/);
                        if (fm) {
                            let effectsStr = fm[4].trim();
                            // 去掉尾部可能残留的 ）
                            effectsStr = effectsStr.replace(/[)）]\s*$/, '').trim();
                            rules.festivals.push({
                                month: parseInt(fm[1]),
                                day: parseInt(fm[2]),
                                name: fm[3].trim(),
                                effects: effectsStr.split(/[、,，]/).map(x => x.trim()).filter(Boolean),
                            });
                        }
                    }
                }
    
                // ---------- 特殊日期 ----------
                const specialM = block.match(/特殊日期\s*[:：]?\s*\n([\s\S]*?)(?=\n\S+\s*[:：]|\n【|$)/);
                if (specialM) {
                    for (const line of specialM[1].split('\n')) {
                        const clean = line.replace(/^[-•*]\s*/, '').trim();
                        if (!clean) continue;
    
                        // 每月X日：名称（事件）
                        const mm = clean.match(/^每?月\s*(\d+)\s*日\s*[:：]\s*(.+?)\s*[（(]\s*(.+?)[）)]/);
                        if (mm) {
                            rules.specialDates.push({
                                rule: 'monthly',
                                day: parseInt(mm[1]),
                                name: mm[2].trim(),
                                event: mm[3].trim(),
                            });
                            continue;
                        }
                        // 每季最后一天：名称（事件）
                        const em = clean.match(/^每季(?:最后一天|末)\s*[:：]\s*(.+?)\s*[（(]\s*(.+?)[）)]/);
                        if (em) {
                            rules.specialDates.push({
                                rule: 'seasonEnd',
                                name: em[1].trim(),
                                event: em[2].trim(),
                            });
                        }
                    }
                }
    
                // ---------- 天气池 ----------
                const weatherM = block.match(/天气池\s*[:：]?\s*\n([\s\S]*?)(?=\n\S+\s*[:：]|\n【|$)/);
                if (weatherM) {
                    for (const line of weatherM[1].split('\n')) {
                        const clean = line.replace(/^[-•*]\s*/, '').trim();
                        if (!clean) continue;
                        const wm = clean.match(/^([春夏秋冬])\s*[:：]\s*(.+)$/);
                        if (wm) {
                            rules.weatherPool[wm[1]] = wm[2].split(/[、,，]/).map(x => x.trim()).filter(Boolean);
                        }
                    }
                }
    
                // ---------- 时段影响 ----------
                const phaseEffM = block.match(/时段影响\s*[:：]?\s*\n([\s\S]*?)(?=\n\S+\s*[:：]|\n【|$)/);
                if (phaseEffM) {
                    for (const line of phaseEffM[1].split('\n')) {
                        const clean = line.replace(/^[-•*]\s*/, '').trim();
                        if (!clean) continue;
                        // 夜晚（19-5）：NPC 不外出，商店关闭
                        const pm = clean.match(/^([^\s（(]+)\s*[（(]\s*([^）)]+)[）)]\s*[:：]\s*(.+)$/);
                        if (pm) {
                            rules.phaseEffects.push({
                                phase: pm[1].trim(),
                                timeRange: pm[2].trim(),
                                effects: pm[3].split(/[、,，]/).map(x => x.trim()).filter(Boolean),
                            });
                        }
                    }
                }
    
                // ---------- 事件钩子 ----------
                const hookM = block.match(/事件钩子\s*[:：]?\s*\n([\s\S]*?)(?=\n\S+\s*[:：]|\n【|$)/);
                if (hookM) {
                    for (const line of hookM[1].split('\n')) {
                        const clean = line.replace(/^[-•*]\s*/, '').trim();
                        if (!clean) continue;
                        // 每日 6:00 → 触发事件 日出
                        // 每月1日 8:00 → 触发事件 月初
                        // 节日当天 0:00 → 触发事件 节日
                        const hm = clean.match(/^(每日|每月\d*日|每周\d|节日当天|季节交替)\s*(\d+)?\s*[:：]\s*(\d+)?\s*→\s*触发事件\s*(.+)$/);
                        if (hm) {
                            rules.eventHooks.push({
                                when: hm[1].trim(),
                                hour: hm[2] !== undefined ? parseInt(hm[2]) : 0,
                                minute: hm[3] !== undefined ? parseInt(hm[3]) : 0,
                                event: hm[4].trim(),
                            });
                        } else {
                            // 兜底：不带时间
                            const hm2 = clean.match(/^(每日|每月\d*日|节日当天|季节交替)\s*→\s*触发事件\s*(.+)$/);
                            if (hm2) {
                                rules.eventHooks.push({
                                    when: hm2[1].trim(),
                                    hour: 0,
                                    minute: 0,
                                    event: hm2[2].trim(),
                                });
                            }
                        }
                    }
                }
    
                // ---------- 叙述提示 ----------
                const narrM = block.match(/叙述提示\s*[:：]\s*([\s\S]*?)$/);
                if (narrM) rules.narrative = narrM[1].trim();
    
                this.rules = rules;
                console.log('[TimeRuleEngine] 时间规则已解析:', {
                    name: rules.name,
                    speed: rules.speed.minutesPerRealSecond,
                    phases: rules.phases.length,
                    seasons: rules.seasons.length,
                    festivals: rules.festivals.length,
                    specialDates: rules.specialDates.length,
                    weatherPool: Object.keys(rules.weatherPool).length,
                    phaseEffects: rules.phaseEffects.length,
                    eventHooks: rules.eventHooks.length,
                });
                return rules;
            },
    
            _reset() {
                this.rules = {
                    name: '',
                    structure: {
                        hoursPerDay: 24,
                        daysPerMonth: 30,
                        monthsPerYear: 12,
                        startDate: { year: 1, month: 1, day: 1, hour: 6, minute: 0 },
                    },
                    speed: { minutesPerRealSecond: 1 },
                    phases: [],
                    seasons: [],
                    derived: [],
                    festivals: [],
                    specialDates: [],
                    weatherPool: {},
                    phaseEffects: [],
                    eventHooks: [],
                    narrative: '',
                    raw: '',
                };
            },
    
            // ---------- 查询接口 ----------
    
            // 根据小时返回时段
            getPhase(hour) {
                for (const p of this.rules.phases) {
                    if (p.start < p.end) {
                        if (hour >= p.start && hour < p.end) return p;
                    } else {
                        if (hour >= p.start || hour < p.end) return p;
                    }
                }
                return null;
            },
    
            // 根据月份返回季节
            getSeason(month) {
                for (const s of this.rules.seasons) {
                    if (s.months.includes(month)) return s;
                }
                return null;
            },
    
            // 是否是节日
            getFestival(month, day) {
                return this.rules.festivals.find(f => f.month === month && f.day === day) || null;
            },
    
            // 特殊日期
            getSpecialDates(month, day) {
                const out = [];
                for (const sd of this.rules.specialDates) {
                    if (sd.rule === 'monthly' && sd.day === day) {
                        out.push(sd);
                    }
                    if (sd.rule === 'seasonEnd') {
                        const season = this.getSeason(month);
                        if (season) {
                            const lastMonth = season.months[season.months.length - 1];
                            const daysInMonth = this.rules.structure.daysPerMonth;
                            if (month === lastMonth && day === daysInMonth) {
                                out.push(sd);
                            }
                        }
                    }
                }
                return out;
            },
    
            // 天气池
            getWeatherPool(seasonName) {
                return this.rules.weatherPool[seasonName] || null;
            },
    
            // 事件钩子检查
            // hour, minute: 当前时间
            // date: { year, month, day }
            checkEventHooks(hour, minute, date) {
                const out = [];
                for (const h of this.rules.eventHooks) {
                    if (h.hour !== hour) continue;
                    if (h.minute && h.minute !== minute) continue;
    
                    if (h.when === '每日') {
                        out.push(h);
                    } else if (h.when.startsWith('每月')) {
                        const dayM = h.when.match(/每月(\d*)日/);
                        const targetDay = dayM && dayM[1] ? parseInt(dayM[1]) : 1;
                        if (date.day === targetDay) out.push(h);
                    } else if (h.when.startsWith('每周')) {
                        // 简化：每 7 天
                        const dayInWeek = ((date.day - 1) % 7) + 1;
                        if (dayInWeek === 1) out.push(h);
                    } else if (h.when === '节日当天') {
                        const fest = this.getFestival(date.month, date.day);
                        if (fest) out.push({ ...h, festival: fest });
                    } else if (h.when === '季节交替') {
                        const specials = this.getSpecialDates(date.month, date.day);
                        if (specials.some(s => s.rule === 'seasonEnd')) out.push(h);
                    }
                }
                return out;
            },
    
            // 给 AI 用的文本
            getPromptText() {
                if (!this.rules.name) return '';
                const r = this.rules;
                const lines = [];
                lines.push(`【时间规则：${r.name}】`);
                if (r.narrative) lines.push(r.narrative);
                if (r.phases.length) {
                    lines.push('时段：' + r.phases.map(p => `${p.name}(${p.start}-${p.end})`).join('、'));
                }
                if (r.festivals.length) {
                    lines.push('节日：' + r.festivals.map(f => `${f.month}月${f.day}日${f.name}`).join('、'));
                }
                return lines.join('\n');
            },
        };
    // ==================== 挂载到 window ====================
    window.RuleEngine = RuleEngine;
    window.GameplayHooks = GameplayHooks;
    window.TriggerExecutor = TriggerExecutor;
    window.RuleCreationManager = RuleCreationManager;
    window.TimeRuleEngine = TimeRuleEngine;   // ★ 新增
    console.log('[CinemaWorld] rules.js 已加载');
})();