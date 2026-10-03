// ============================================================
// CinemaWorld · map-farm.js
// 种植引擎 + 商店 + 农田 UI
//   - 未配置 plot → 显示"生成/套模板"界面
//   - 已配置 plot → 正常耕作
//
// 依赖：map-plot.js, map-environment.js, player.js, ui.js
//
// 暴露：window.MapFarmManager, window.MapFarmUI
// ============================================================

(function () {
    'use strict';

    const MapFarmManager = {


        // ============================================================
        // 时间推进
        // ============================================================
        onHourTick(map) {
            const plots = map?._plots;
            if (!plots) return;

            let changed = 0;
            for (const plot of Object.values(plots)) {
                if (plot.type !== 'farm') continue;
                if (!plot.rules) continue;      // 未配置 → 跳过
                try {
                    if (this._tickPlot(map, plot)) changed++;
                } catch (e) {
                    console.error(`[MapFarm] plot ${plot.id} tick 异常:`, e);
                }
            }

            if (changed > 0) {
                window.MapPlotManager?.markDirty?.();
                window.MapLauncher?._saveMapToWorld?.(map);
                window.MapFarmUI?.refresh?.();
            }
        },

                // ============================================================
        // 单 plot tick
        // ★ 多 plot 修复：
        //   1. 开头做 env 数据清洗（数值化、去重、补全、钳制）
        //   2. crop 找不到时重置为 idle
        //   3. progress 数值保护
        // ============================================================
        _tickPlot(map, plot) {
            const rule = plot.rules;
            if (!rule) return false;

            // ============================================================
            // ★ 0. env 数据清洗
            // ============================================================
            if (!plot.env || typeof plot.env !== 'object') {
                plot.env = { _order: [] };
            }
            const env = plot.env;

            if (!Array.isArray(env._order)) env._order = [];
            env._order = [...new Set(env._order)].filter(k => !k.startsWith('_'));

            // 逐个清洗：数值化 + 钳制
            for (const key of env._order) {
                const def = rule.env?.[key];
                if (!def) continue;

                let v = env[key];
                if (typeof v !== 'number' || !isFinite(v)) {
                    const fallback = (typeof def.default === 'number') ? def.default : 0;
                    console.warn(`[MapFarm] plot ${plot.id} env.${key}=${v} 非法，重置为 ${fallback}`);
                    v = fallback;
                }
                const min = (typeof def.min === 'number') ? def.min : 0;
                const max = (typeof def.max === 'number') ? def.max : 100;
                env[key] = Math.max(min, Math.min(max, v));
            }

            // 去掉规则里已不存在的 key
            env._order = env._order.filter(k => rule.env?.[k]);

            // 补上规则里有但 env 里没有的 key
            for (const [key, def] of Object.entries(rule.env || {})) {
                if (env[key] === undefined) {
                    env[key] = (typeof def.default === 'number') ? def.default : 0;
                    env._order.push(key);
                }
            }

            // progress 数值保护
            plot.progress = Math.max(0, Math.min(1, Number(plot.progress) || 0));

            // ============================================================
            // 1. 时间差
            // ============================================================
            const now = this._readTotalMinutes(map);
            const last = (typeof plot.lastTickAt === 'number') ? plot.lastTickAt : now;

            // ★ lastTickAt 是未来值（被污染）→ 纠正
            if (last > now) {
                console.warn(`[MapFarm] plot ${plot.id} lastTickAt=${last} > now=${now}，纠正`);
                plot.lastTickAt = now;
                return false;
            }

            const hoursSince = (now - last) / 60;
            if (hoursSince <= 0) return false;

            const daysSince = hoursSince / 24;
            let changed = false;

            // ============================================================
            // 2. 环境自然衰减（按天）
            // ============================================================
            for (const key of env._order) {
                const def = rule.env?.[key];
                if (!def || !def.decay) continue;
                const delta = def.decay * daysSince;
                if (!isFinite(delta)) continue;
                env[key] = Math.max(def.min ?? 0, Math.min(def.max ?? 100, env[key] + delta));
                changed = true;
            }

            // ============================================================
            // 3. 环境规则
            // ============================================================
            this._applyEnvRules(map, plot, hoursSince, rule);

            // ============================================================
            // 4. 商店补货
            // ============================================================
            this._tickShopRestock(plot, now);

            // ============================================================
            // 5. 生长
            // ============================================================
            if (plot.status === 'growing' && plot.cropId) {
                const crop = rule.crops?.[plot.cropId];
                if (!crop) {
                    // ★ crop 找不到 → 重置
                    console.warn(`[MapFarm] plot ${plot.id} cropId=${plot.cropId} 在规则里不存在，重置为 idle`);
                    plot.status = 'idle';
                    plot.cropId = null;
                    plot.progress = 0;
                    changed = true;
                } else {
                    let speedMult = 1;
                    if (plot._speedBoost && plot._speedBoost.untilAt > now) {
                        speedMult = plot._speedBoost.multiplier;
                    } else if (plot._speedBoost) {
                        delete plot._speedBoost;
                    }

                    const isProtected = plot._protectedUntilAt && plot._protectedUntilAt > now;
                    if (plot._protectedUntilAt && plot._protectedUntilAt <= now) {
                        delete plot._protectedUntilAt;
                    }

                    const growHours = (typeof crop.growHours === 'number' && crop.growHours > 0)
                        ? crop.growHours : 72;

                    const ok = this._checkCropEnv(plot, crop);
                    if (!ok && !isProtected) {
                        plot._stressCount = (plot._stressCount || 0) + hoursSince;
                        if (plot._stressCount >= 24) {
                            plot.status = 'dead';
                            this._log(plot, `💀 ${crop.name} 因环境不适枯死`);
                            changed = true;
                        } else if (plot._stressCount >= 6) {
                            if (!plot._stressWarned) {
                                this._log(plot, `⚠️ ${crop.name} 环境不适，${(24 - plot._stressCount).toFixed(0)} 小时后枯死`);
                                plot._stressWarned = true;
                            }
                        }
                        const rate = (1 / growHours) * speedMult * 0.5;
                        plot.progress = Math.min(1, plot.progress + rate * hoursSince);
                        if (plot.progress >= 1) {
                            plot.status = 'ready';
                            plot.progress = 1;
                        }
                        changed = true;
                    } else {
                        plot._stressCount = 0;
                        plot._stressWarned = false;
                        const rate = (1 / growHours) * speedMult;
                        plot.progress = Math.min(1, plot.progress + rate * hoursSince);
                        if (plot.progress >= 1) {
                            plot.status = 'ready';
                            plot.progress = 1;
                            this._log(plot, `🌾 ${crop.name} 成熟了`);
                            window.CWNotify3D?.('plot-update', { plotId: plot.id });
                        }
                        changed = true;
                    }
                }
            }

            // ★ 最终数值保护
            plot.progress = Math.max(0, Math.min(1, Number(plot.progress) || 0));

            plot.lastTickAt = now;
            return changed;
        },
                // ============================================================
        // ★ 补算一个 plot：按 delta 小时一次性推进
        // ★ 多 plot 修复：与 _tickPlot 一致的 env 清洗 + crop 校验
        // ============================================================
        _catchUpPlot(plot, hoursDelta, mapEnv, map) {
            const rule = plot.rules;
            if (!rule) return false;

            // ============================================================
            // ★ 0. env 数据清洗（和 _tickPlot 一致）
            // ============================================================
            if (!plot.env || typeof plot.env !== 'object') {
                plot.env = { _order: [] };
            }
            const env = plot.env;

            if (!Array.isArray(env._order)) env._order = [];
            env._order = [...new Set(env._order)].filter(k => !k.startsWith('_'));

            for (const key of env._order) {
                const def = rule.env?.[key];
                if (!def) continue;
                let v = env[key];
                if (typeof v !== 'number' || !isFinite(v)) {
                    v = (typeof def.default === 'number') ? def.default : 0;
                }
                const min = (typeof def.min === 'number') ? def.min : 0;
                const max = (typeof def.max === 'number') ? def.max : 100;
                env[key] = Math.max(min, Math.min(max, v));
            }

            env._order = env._order.filter(k => rule.env?.[k]);
            for (const [key, def] of Object.entries(rule.env || {})) {
                if (env[key] === undefined) {
                    env[key] = (typeof def.default === 'number') ? def.default : 0;
                    env._order.push(key);
                }
            }

            plot.progress = Math.max(0, Math.min(1, Number(plot.progress) || 0));

            const daysDelta = hoursDelta / 24;
            let changed = false;

            // ---------- 1. 环境自然衰减（按天） ----------
            for (const key of env._order) {
                const def = rule.env?.[key];
                if (!def || !def.decay) continue;
                const before = env[key];
                env[key] = Math.max(def.min ?? 0, Math.min(def.max ?? 100,
                    env[key] + def.decay * daysDelta));
                if (env[key] !== before) changed = true;
            }

            // ---------- 2. 环境规则（按天） ----------
            const now = (typeof mapEnv?._runtime?.totalMinutes === 'number')
                ? mapEnv._runtime.totalMinutes : 0;

            for (const r of rule.envRules || []) {
                if (!this._matchEnvCondition(r.when, mapEnv)) continue;
                for (const eff of r.effects || []) {
                    if (eff.type === 'fieldDelta' && eff.field) {
                        const def = rule.env?.[eff.field];
                        if (env[eff.field] !== undefined) {
                            env[eff.field] = Math.max(def?.min ?? 0, Math.min(def?.max ?? 100,
                                env[eff.field] + eff.value * daysDelta));
                            changed = true;
                        }
                    }
                }
            }

            // ---------- 3. 作物生长（按小时） ----------
            if (plot.status === 'growing' && plot.cropId) {
                const crop = rule.crops?.[plot.cropId];
                if (!crop) {
                    console.warn(`[MapFarm] catchUp plot ${plot.id} cropId=${plot.cropId} 不存在，重置为 idle`);
                    plot.status = 'idle';
                    plot.cropId = null;
                    plot.progress = 0;
                    changed = true;
                } else {
                    let speedMult = 1;
                    if (plot._speedBoost && plot._speedBoost.untilAt > now) {
                        speedMult = plot._speedBoost.multiplier;
                    } else if (plot._speedBoost) {
                        delete plot._speedBoost;
                    }

                    const isProtected = plot._protectedUntilAt && plot._protectedUntilAt > now;
                    if (plot._protectedUntilAt && plot._protectedUntilAt <= now) {
                        delete plot._protectedUntilAt;
                    }

                    const growHours = (typeof crop.growHours === 'number' && crop.growHours > 0)
                        ? crop.growHours : 72;

                    const ok = this._checkCropEnv(plot, crop);
                    if (!ok && !isProtected) {
                        plot._stressCount = (plot._stressCount || 0) + hoursDelta;
                        if (plot._stressCount >= 24) {
                            plot.status = 'dead';
                            this._log(plot, `💀 ${crop.name} 因环境不适枯死（你不在时）`);
                            changed = true;
                        } else if (plot._stressCount >= 6 && !plot._stressWarned) {
                            this._log(plot, `⚠️ ${crop.name} 环境不适，${(24 - plot._stressCount).toFixed(1)} 小时后枯死`);
                            plot._stressWarned = true;
                        }

                        const rate = (1 / growHours) * speedMult * 0.5;
                        plot.progress = Math.min(1, plot.progress + rate * hoursDelta);
                        if (plot.progress >= 1) {
                            plot.status = 'ready';
                            plot.progress = 1;
                        }
                        changed = true;
                    } else {
                        plot._stressCount = 0;
                        plot._stressWarned = false;

                        const rate = (1 / growHours) * speedMult;
                        const before = plot.progress;
                        plot.progress = Math.min(1, before + rate * hoursDelta);

                        if (plot.progress >= 1) {
                            plot.status = 'ready';
                            plot.progress = 1;
                            this._log(plot, `🌾 ${crop.name} 在你不在时成熟了`);
                        } else if (plot.progress > before) {
                            const hoursPassed = (plot.progress - before) / rate;
                            if (hoursPassed > 6) {
                                this._log(plot, `🌿 ${crop.name} 生长了 ${hoursPassed.toFixed(1)} 小时（${Math.round(plot.progress * 100)}%）`);
                            }
                        }
                        changed = true;
                    }
                }
            }

            // ---------- 4. 商店补货 ----------
            this._tickShopRestock(plot, now);

            // ---------- 5. 更新 lastTickAt（用 _readTotalMinutes 保证与 tick 一致） ----------
            plot.lastTickAt = this._readTotalMinutes(map);

            // 最终数值保护
            plot.progress = Math.max(0, Math.min(1, Number(plot.progress) || 0));

            return changed;
        },
        // ============================================================
        // 计算每个环境属性的"每天变化速率"
        // 包含：自然衰减 + 当前生效的环境规则
        // 返回：{ moisture: -35, fertility: -5, ... }（单位：每天）
        // ============================================================
        getEnvRates(plot) {
            const rule = plot.rules;
            if (!rule) return {};

            const rates = {};

            // 1. 自然衰减（★ 存的就是每天）
            for (const [key, def] of Object.entries(rule.env || {})) {
                rates[key] = def.decay || 0;
            }

            // 2. 环境规则（每天）
            const map = window.MapLauncher?.getMap?.();
            const mapEnv = window.CWEnv?.ensureEnvData?.(map);
            if (!mapEnv) return rates;

            for (const r of rule.envRules || []) {
                if (!this._matchEnvCondition(r.when, mapEnv)) continue;
                for (const eff of r.effects || []) {
                    if (eff.type === 'fieldDelta' && eff.field) {
                        if (rates[eff.field] !== undefined) {
                            rates[eff.field] += eff.value;
                        } else {
                            rates[eff.field] = eff.value;
                        }
                    }
                }
            }

            return rates;
        },
        _checkCropEnv(plot, crop) {
            const req = crop.envReq || {};
            for (const [key, cond] of Object.entries(req)) {
                const v = Number(plot.env[key]) || 0;
                if (typeof cond.min === 'number' && v < cond.min) return false;
                if (typeof cond.max === 'number' && v > cond.max) return false;
            }
            return true;
        },

        // ============================================================
        // 环境规则
        // ============================================================
        _applyEnvRules(map, plot, hours, rule) {
            const rules = rule.envRules;
            if (!rules?.length) return;

            const mapEnv = window.CWEnv?.ensureEnvData?.(map);
            if (!mapEnv) return;

            const active = [];
            for (const r of rules) {
                if (!this._matchEnvCondition(r.when, mapEnv)) continue;
                active.push(r);
                for (const eff of r.effects || []) {
                    this._applyEnvEffect(plot, eff, hours, rule);
                }
            }
            plot._activeEnvRules = active;
        },

        _matchEnvCondition(cond, env) {
            if (!cond) return false;
            const val = env[cond.key];
            if (val === undefined || val === '') return false;

            switch (cond.op) {
                case '=':
                case '==':
                    return String(val).trim() === String(cond.value).trim();
                case 'contains':
                    return String(val).includes(String(cond.value));
                case '>': case '>=': case '<': case '<=': {
                    const a = parseFloat(String(val).replace(/[^\d.\-]/g, ''));
                    const b = parseFloat(cond.value);
                    if (isNaN(a) || isNaN(b)) return false;
                    if (cond.op === '>') return a > b;
                    if (cond.op === '>=') return a >= b;
                    if (cond.op === '<') return a < b;
                    if (cond.op === '<=') return a <= b;
                }
            }
            return false;
        },

        _applyEnvEffect(plot, eff, hours, rule) {
            const days = hours / 24;
            switch (eff.type) {
                case 'fieldDelta':
                    if (plot.env[eff.field] !== undefined) {
                        const def = rule.env?.[eff.field];
                        const cur = Number(plot.env[eff.field]) || 0;
                        const delta = Number(eff.value) || 0;
                        plot.env[eff.field] = Math.max(def?.min ?? 0, Math.min(def?.max ?? 100,
                            cur + delta * days));
                    }
                    break;
                case 'fieldMultiplier':
                    if (plot.env[eff.field] !== undefined) {
                        const def = rule.env?.[eff.field];
                        const cur = Number(plot.env[eff.field]) || 0;
                        const mult = Number(eff.value) || 1;
                        plot.env[eff.field] = Math.max(def?.min ?? 0, Math.min(def?.max ?? 100,
                            cur * mult));
                    }
                    break;
            }
        },

        // ============================================================
        // 玩家动作
        // ============================================================
        executeAction(plotId, actionId) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot) return { ok: false, message: '区域不存在' };
            if (!plot.rules) return { ok: false, message: '区域未配置' };

            const rule = plot.rules;
            const action = rule.actions?.[actionId];
            if (!action) return { ok: false, message: '动作不存在' };

            const cellCount = (plot.bounds.w || 1) * (plot.bounds.h || 1);
            const totalCost = this._scaleCost(action.cost, cellCount);

            const check = this._checkCost(totalCost, plot);
            if (!check.ok) return check;

            const payResult = this._payCost(totalCost, plot);
            if (!payResult.ok) return payResult;

            const messages = [];
            for (const [key, val] of Object.entries(action.effect || {})) {
                if (plot.env[key] === undefined) continue;
                const def = rule.env?.[key];
                const old = plot.env[key];
                const nv = Math.max(def?.min ?? 0, Math.min(def?.max ?? 100, old + val));
                plot.env[key] = nv;
                messages.push(`${def?.label || key} ${nv - old >= 0 ? '+' : ''}${(nv - old).toFixed(0)}`);
            }

            this._log(plot, `${action.emoji} ${action.name}：${messages.join('、')}`);
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();

            if (payResult.warnings?.length) {
                window.UIManager?.showText?.(`💸 ${payResult.warnings.join('；')}`, 2500);
            }

            return { ok: true, message: `${action.name}成功` };
        },

        // ============================================================
        // 种植 / 收获
        // ============================================================
        plant(plotId, cropId) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot) return { ok: false, message: '区域不存在' };
            if (!plot.rules) return { ok: false, message: '区域未配置' };

            if (plot.status === 'growing') return { ok: false, message: '已经种了东西' };
            if (plot.status === 'ready') return { ok: false, message: '先收获' };

            const crop = plot.rules.crops?.[cropId];
            if (!crop) return { ok: false, message: '作物不存在' };

            const cellCount = (plot.bounds.w || 1) * (plot.bounds.h || 1);
            const totalCost = this._scaleCost(crop.cost, cellCount);

            const check = this._checkCost(totalCost, plot);
            if (!check.ok) return check;

            const payResult = this._payCost(totalCost, plot);
            if (!payResult.ok) return payResult;

            plot.status = 'growing';
            plot.cropId = cropId;
            plot.progress = 0;
            plot._stressCount = 0;
            plot._stressWarned = false;
            plot.plantedAt = this._readTotalMinutes(window.MapLauncher.getMap());
            plot.lastTickAt = plot.plantedAt;
            const costText = Object.entries(totalCost).map(([k, v]) => `${k}×${v}`).join('、');
            this._log(plot, `🌱 种下了 ${crop.name}（${cellCount} 格，成本 ${costText}）`);
            window.CWNotify3D?.('plot-update', { plotId: plot.id });
            window.MapPlotManager?.markDirty?.();
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();

            return { ok: true, message: `种下了 ${crop.name}` };
        },

        harvest(plotId) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot) return { ok: false, message: '区域不存在' };
            if (!plot.rules) return { ok: false, message: '区域未配置' };
            if (plot.status !== 'ready') return { ok: false, message: '还不能收获' };

            const crop = plot.rules.crops?.[plot.cropId];
            if (!crop) return { ok: false, message: '作物数据丢失' };

            const yieldData = crop.yield;
            if (!yieldData) return { ok: false, message: '没有产出' };

            const cellCount = (plot.bounds.w || 1) * (plot.bounds.h || 1);
            const count = (yieldData.count || 1) * cellCount;

            const productTemplate = plot.rules.products?.[yieldData.item];
            const player = window.PlayerStateManager?.player;
            if (!player) return { ok: false, message: '玩家未加载' };
            player.inventory = player.inventory || [];

            const existing = player.inventory.find(i => i.name === yieldData.item);
            if (existing) {
                existing.count = (existing.count || 1) + count;
            } else {
                const fields = productTemplate?.fields
                    ? { ...productTemplate.fields }
                    : { '类型': '材料', '可堆叠': '是', '货币种类': '金钱', '卖价': '5' };

                player.inventory.push({
                    name: yieldData.item,
                    count,
                    icon: productTemplate?.icon || crop.emoji || '📦',
                    description: productTemplate?.description || `${crop.name}的产物`,
                    fields,
                    interactions: [],
                    type: productTemplate?.type || 'item',
                    stackable: productTemplate?.stackable !== false,
                });
            }

            plot.status = 'idle';
            plot.cropId = null;
            plot.progress = 0;

            if (plot.env.fertility !== undefined) {
                plot.env.fertility = Math.max(0, plot.env.fertility - 10);
            }
            window.CWNotify3D?.('plot-update', { plotId: plot.id });
            this._log(plot, `📦 收获了 ${count} 个${yieldData.item}`);
            window.PlayerStateManager.refreshAvatarArea?.();

            window.MapPlotManager?.markDirty?.();
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();

            return { ok: true, message: `收获了 ${count} 个${yieldData.item}` };
        },

        // ============================================================
        // 成本
        // ============================================================
        _scaleCost(unitCost, cellCount) {
            if (!unitCost) return {};
            const NO_SCALE = ['体力', '精力', '气力', '耐力', '生命', '血量', 'HP'];
            const out = {};
            for (const [k, v] of Object.entries(unitCost)) {
                out[k] = NO_SCALE.includes(k) ? v : v * cellCount;
            }
            return out;
        },

        _checkCost(cost, plot) {
            if (!cost) return { ok: true };
            const player = window.PlayerStateManager?.player;
            if (!player) return { ok: false, message: '玩家未加载' };

            for (const [key, value] of Object.entries(cost)) {
                const need = Number(value) || 0;

                const bar = (player.statusBars || []).find(b =>
                    b.key === key || b.key.includes(key) || key.includes(b.key)
                );
                if (bar) {
                    if ((Number(bar.current) || 0) < need) return { ok: false, message: `${key}不足` };
                    continue;
                }

                const extra = player.extraStats;
                if (extra && Array.isArray(extra._order)) {
                    const ek = extra._order.find(k =>
                        k === key || k.includes(key) || key.includes(k)
                    );
                    if (ek !== undefined) {
                        const cur = parseFloat(String(extra[ek] ?? '0').replace(/[^\d.\-]/g, '')) || 0;
                        if (cur < need) return { ok: false, message: `${key}不足（需 ${need}）` };
                        continue;
                    }
                }

                const item = (player.inventory || []).find(i => i.name === key);
                if (!item || (item.count || 1) < need) {
                    return { ok: false, message: `${key}不足` };
                }
            }
            return { ok: true };
        },

        _payCost(cost, plot) {
            if (!cost) return { ok: true, warnings: [] };
            const player = window.PlayerStateManager?.player;
            if (!player) return { ok: false, message: '玩家未加载' };

            const warnings = [];
            for (const [key, value] of Object.entries(cost)) {
                const need = Number(value) || 0;

                const bar = (player.statusBars || []).find(b =>
                    b.key === key || b.key.includes(key) || key.includes(b.key)
                );
                if (bar) {
                    bar.current = Math.max(0, (Number(bar.current) || 0) - need);
                    continue;
                }

                const extra = player.extraStats;
                if (extra && Array.isArray(extra._order)) {
                    const ek = extra._order.find(k =>
                        k === key || k.includes(key) || key.includes(k)
                    );
                    if (ek !== undefined) {
                        const raw = String(extra[ek] ?? '0');
                        const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                        const cur = m ? parseFloat(m[1]) : 0;
                        const unit = m ? (m[2] || '') : '';
                        extra[ek] = `${Math.max(0, cur - need)}${unit}`;
                        continue;
                    }
                }

                const item = (player.inventory || []).find(i => i.name === key);
                if (item) {
                    item.count = (item.count || 1) - need;
                    if (item.count <= 0) {
                        const idx = player.inventory.indexOf(item);
                        if (idx > -1) player.inventory.splice(idx, 1);
                    }
                }
            }

            window.PlayerStateManager.refreshAvatarArea?.();
            return { ok: true, warnings };
        },

                // ============================================================
        // 商店：补货
        // ★ 多 plot 修复：shopState.items 改成 { [id]: state } 对象结构
        //   旧存档如果是数组，会自动迁移
        // ============================================================
        _tickShopRestock(plot, now) {
            const shop = plot.shop;
            if (!shop?.items?.length) return;

            // ---------- 初始化 / 迁移 ----------
            if (!plot.shopState || typeof plot.shopState !== 'object') {
                plot.shopState = { items: {} };
            }
            // 旧格式（数组）→ 迁移到对象
            if (Array.isArray(plot.shopState.items)) {
                const migrated = {};
                for (const s of plot.shopState.items) {
                    if (s?.id) migrated[s.id] = s;
                }
                plot.shopState.items = migrated;
            }
            if (!plot.shopState.items || typeof plot.shopState.items !== 'object') {
                plot.shopState.items = {};
            }

            // ---------- 逐个 item 检查 ----------
            for (const def of shop.items) {
                if (!def?.id) continue;

                let state = plot.shopState.items[def.id];
                if (!state) {
                    // 新 item → 初始化（满库存）
                    const maxStock = (typeof def.maxStock === 'number') ? def.maxStock
                        : (typeof def.stock === 'number') ? def.stock : 0;
                    plot.shopState.items[def.id] = {
                        id: def.id,
                        stock: maxStock,
                        lastRestockAt: now,
                    };
                    continue;
                }

                // 数值保护
                if (typeof state.stock !== 'number' || !isFinite(state.stock)) {
                    state.stock = 0;
                }
                if (typeof state.lastRestockAt !== 'number' || !isFinite(state.lastRestockAt)) {
                    state.lastRestockAt = now;
                }

                const maxStock = (typeof def.maxStock === 'number') ? def.maxStock
                    : (typeof def.stock === 'number') ? def.stock : 0;

                if (state.stock >= maxStock) continue;

                const hoursSince = (now - state.lastRestockAt) / 60;
                const interval = (typeof def.restockInterval === 'number' && def.restockInterval > 0)
                    ? def.restockInterval : 24;

                if (hoursSince >= interval) {
                    state.stock = maxStock;
                    state.lastRestockAt = now;
                    this._log(plot, `🏪 ${def.name} 补货`);
                }
            }
        },

        // ============================================================
        // 商店：购买
        // ============================================================
        buyShopItem(plotId, itemId) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot) return { ok: false, message: '区域不存在' };
            if (!plot.shop) return { ok: false, message: '这个区域没有商店' };

            const itemDef = plot.shop.items.find(i => i.id === itemId);
            if (!itemDef) return { ok: false, message: '商品不存在' };

            if (!plot.shopState) this._tickShopRestock(plot, this._readTotalMinutes(window.MapLauncher.getMap()));

            const state = plot.shopState.items.find(s => s.id === itemId);
            if (!state || state.stock <= 0) return { ok: false, message: '已售罄' };

            const player = window.PlayerStateManager?.player;
            const extra = player?.extraStats;
            const goldKey = extra?._order?.find(k => /金币|金钱|钱/.test(k)) || '金钱';
            const raw = String(extra?.[goldKey] ?? '0');
            const cur = parseFloat(raw.match(/^(-?\d+(?:\.\d+)?)/)?.[1] || '0');
            if (cur < itemDef.price) {
                return { ok: false, message: `金钱不足（需 ${itemDef.price}）` };
            }

            const unit = raw.match(/([^\d.\-]*)$/)?.[1] || '';
            extra[goldKey] = `${cur - itemDef.price}${unit}`;

            state.stock -= 1;

            const result = this._applyShopEffect(plot, itemDef.effect);

            this._log(plot, `🛒 买下 ${itemDef.name}（${result.message || ''}）`);
            window.PlayerStateManager.refreshAvatarArea?.();
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();

            return { ok: true, message: `买下 ${itemDef.name}`, effect: result };
        },

        _applyShopEffect(plot, effect) {
            if (!effect) return {};
            const now = this._readTotalMinutes(window.MapLauncher?.getMap?.());

            switch (effect.type) {
                case 'env': {
                    const def = plot.rules.env?.[effect.target];
                    if (plot.env[effect.target] === undefined) {
                        return { message: `${effect.target} 不存在` };
                    }
                    const old = plot.env[effect.target];
                    const nv = Math.max(def?.min ?? 0, Math.min(def?.max ?? 100, old + effect.value));
                    plot.env[effect.target] = nv;
                    return { message: `${def?.label || effect.target} +${(nv - old).toFixed(0)}` };
                }
                case 'recover': {
                    const player = window.PlayerStateManager?.player;
                    const bar = player?.statusBars?.find(b =>
                        b.key === effect.target || b.key.includes(effect.target)
                    );
                    if (bar) {
                        const old = bar.current;
                        bar.current = Math.min(bar.max, bar.current + effect.value);
                        return { message: `${effect.target} +${(bar.current - old).toFixed(0)}` };
                    }
                    return { message: `${effect.target} 不存在` };
                }
                case 'speed': {
                    plot._speedBoost = {
                        multiplier: effect.multiplier,
                        untilAt: now + effect.duration * 60,
                    };
                    return { message: `生长 ×${effect.multiplier}（${effect.duration}h）` };
                }
                case 'protect': {
                    plot._protectedUntilAt = now + effect.duration * 60;
                    return { message: `保护 ${effect.duration}h` };
                }
                case 'cure': {
                    const player = window.PlayerStateManager?.player;
                    if (player?.status) {
                        const idx = player.status.findIndex(s => s.name === effect.target);
                        if (idx > -1) {
                            player.status.splice(idx, 1);
                            return { message: `治愈 ${effect.target}` };
                        }
                    }
                    return { message: `无 ${effect.target} 状态` };
                }
                case 'item': {
                    const player = window.PlayerStateManager?.player;
                    if (player) {
                        player.inventory = player.inventory || [];
                        const ex = player.inventory.find(i => i.name === effect.target);
                        if (ex) ex.count = (ex.count || 1) + effect.value;
                        else player.inventory.push({
                            name: effect.target, count: effect.value,
                            icon: '📦', description: '', fields: {}, type: 'item',
                        });
                        return { message: `获得 ${effect.target}×${effect.value}` };
                    }
                    return { message: '玩家未加载' };
                }
            }
            return {};
        },

        getShopState(plot) {
            const shop = plot.shop;
            if (!shop) return null;

            if (!plot.shopState) {
                this._tickShopRestock(plot, this._readTotalMinutes(window.MapLauncher.getMap()));
            }

            // ★ 从对象结构里取
            const stateMap = (plot.shopState && typeof plot.shopState.items === 'object'
                && !Array.isArray(plot.shopState.items))
                ? plot.shopState.items
                : {};

            return {
                name: shop.name,
                emoji: shop.emoji,
                items: shop.items.map(def => {
                    const state = stateMap[def.id];
                    const maxStock = (typeof def.maxStock === 'number') ? def.maxStock
                        : (typeof def.stock === 'number') ? def.stock : 0;
                    return {
                        ...def,
                        maxStock,
                        stock: (state && typeof state.stock === 'number') ? state.stock : maxStock,
                    };
                }),
            };
        },

        // ============================================================
        // 日志
        // ============================================================
        _log(plot, text) {
            if (!plot.log) plot.log = [];
            plot.log.push({ ts: Date.now(), text });
            if (plot.log.length > 50) plot.log = plot.log.slice(-50);
        },

        _readTotalMinutes(map) {
            try {
                if (window.CWEnv?.parseTotalMinutes && window.CWEnv?.ensureEnvData) {
                    const env = window.CWEnv.ensureEnvData(map);
                    const t = window.CWEnv.parseTotalMinutes(env);
                    if (typeof t === 'number') return t;
                }
            } catch (e) { /* 忽略 */ }
            return 0;
        },
    };

    // ============================================================
    // UI
    // ============================================================
    const MapFarmUI = {
        _currentPlotId: null,
        _tab: 'status',

        open(plotId) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot) return;
            this._currentPlotId = plotId;
            this._tab = 'status';
            this._render();
        },

        close() {
            this._currentPlotId = null;
            window.UIManager.closeModal();
        },

        refresh() {
            if (!this._currentPlotId) return;
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal || !modal.classList.contains('active')) return;
            const oldScroll = modal.querySelector('.cw-farm-tab-body')?.scrollTop || 0;
            this._render();
            const newBody = modal.querySelector('.cw-farm-tab-body');
            if (newBody) newBody.scrollTop = oldScroll;
        },

        _getPlot() {
            return window.MapPlotManager?.getPlotById?.(this._currentPlotId);
        },

        _render() {
            const plot = this._getPlot();
            if (!plot) { this.close(); return; }

            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            // ★ 未配置 → 显示配置界面
            if (!plot.rules) {
                modal.className = 'active cw-farm-modal';
                modal.innerHTML = this._renderEmpty(plot);
                return;
            }

            modal.className = 'active cw-farm-modal';
            modal.innerHTML = `
                <div class="cw-farm-root">
                    ${this._renderHeader(plot)}
                    <div class="cw-farm-body">
                        ${this._renderLeft(plot)}
                        ${this._renderRight(plot)}
                    </div>
                </div>`;
        },

        // ============================================================
        // 空状态（未配置）
        // ============================================================
        _renderEmpty(plot) {
            return `
                <div class="cw-farm-root">
                    <div class="cw-farm-header">
                        <div class="cw-farm-header-left">
                            <div class="cw-farm-icon">🌱</div>
                            <div>
                                <div class="cw-farm-title">${plot.name}</div>
                                <div class="cw-farm-subtitle">尚未配置</div>
                            </div>
                        </div>
                        <div class="cw-farm-header-right">
                            <button class="cw-farm-close" onclick="MapFarmUI.close()">✕</button>
                        </div>
                    </div>
                    <div style="text-align:center;padding:50px 20px;">
                        <div style="font-size:64px;margin-bottom:16px;">🌱</div>
                        <div style="font-size:16px;color:#fff;margin-bottom:8px;">这块地还没有配置</div>
                        <div style="font-size:13px;color:#888;line-height:1.8;margin-bottom:24px;">
                            让 AI 根据世界观、地图环境生成<br>
                            环境属性、动作、作物、商店
                        </div>
                        <div style="margin-bottom:16px;">
                            <textarea id="cw-farm-first-guide" class="cinemaworld-textarea"
                                placeholder="额外要求（可选）：例如 种小麦的普通农田"
                                style="min-height:80px;max-width:400px;margin:0 auto;"></textarea>
                        </div>
                        <button class="cinemaworld-button primary" id="cw-farm-first-gen"
                            onclick="MapFarmUI._doFirstGenerate()">
                            🤖 让 AI 生成配置
                        </button>
                        <div style="margin-top:16px;">
                            <button class="cinemaworld-button" onclick="MapFarmUI._useTemplate()">
                                📦 使用已有模板
                            </button>
                        </div>
                    </div>
                </div>`;
        },

        async _doFirstGenerate() {
            const guide = document.getElementById('cw-farm-first-guide')?.value.trim() || '';
            const btn = document.getElementById('cw-farm-first-gen');
            if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 生成中...'; }

            const plotId = this._currentPlotId;
            const result = await window.MapFarmGenerator.generate(plotId, { guide });

            if (result) {
                this._render();
            } else {
                if (btn) { btn.disabled = false; btn.innerHTML = '🤖 让 AI 生成配置'; }
            }
        },

        _useTemplate() {
            const plot = this._getPlot();
            if (!plot) return;

            const templates = window.MapPlotTemplate.listByType(plot.type);
            if (templates.length === 0) {
                window.UIManager?.showText?.('模板库为空', 1500);
                return;
            }

            let html = `<div class="cinemaworld-modal-title">📦 选择模板</div>
                <div style="display:grid;gap:10px;max-height:60vh;overflow-y:auto;">`;

            for (const t of templates) {
                html += `
                    <div class="cw-plot-card" onclick="MapFarmUI._applyTemplate('${t.id}')">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="font-size:28px;">${t.emoji || '📐'}</div>
                            <div style="flex:1;">
                                <div style="font-size:14px;color:#fff;font-weight:600;">${t.name}</div>
                                <div style="font-size:11px;color:#888;">${t.description || ''}</div>
                            </div>
                        </div>
                    </div>`;
            }
            html += `</div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="MapFarmUI._render()">返回</button>
                </div>`;

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = html;
        },

        _applyTemplate(tplId) {
            const plot = this._getPlot();
            const tpl = window.MapPlotTemplate.get(tplId);
            if (!plot || !tpl) return;

            plot.rules = JSON.parse(JSON.stringify(tpl.rules));
            plot.shop = JSON.parse(JSON.stringify(tpl.shop));
            plot.emoji = tpl.emoji || '🌾';
            plot.color = tpl.color || 'rgba(120,200,120,0.30)';

            // ★ 用统一方法初始化 env
            plot.env = { _order: [] };
            for (const [key, def] of Object.entries(plot.rules.env || {})) {
                const v = (typeof def.default === 'number') ? def.default : 0;
                const min = (typeof def.min === 'number') ? def.min : 0;
                const max = (typeof def.max === 'number') ? def.max : 100;
                plot.env[key] = Math.max(min, Math.min(max, v));
                plot.env._order.push(key);
            }
            plot.shopState = null;

            // ★ 作物校验
            if ((plot.status === 'growing' || plot.status === 'ready')
                && !plot.rules.crops?.[plot.cropId]) {
                plot.status = 'idle';
                plot.cropId = null;
                plot.progress = 0;
            }

            window.MapPlotManager?.markDirty?.();
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();

            this._tab = 'status';
            this._render();
        },

        // ============================================================
        // 主界面
        // ============================================================
        _renderHeader(plot) {
            const statusText = {
                idle: '🌱 空地',
                growing: '🌿 生长中',
                ready: '🌾 可收获',
                dead: '💀 荒废',
            }[plot.status] || plot.status;

            return `
                <div class="cw-farm-header">
                    <div class="cw-farm-header-left">
                        <div class="cw-farm-icon">${plot.emoji || '🌾'}</div>
                        <div>
                            <div class="cw-farm-title">${plot.name}</div>
                            <div class="cw-farm-subtitle">${plot.bounds.w} × ${plot.bounds.h} 格</div>
                        </div>
                    </div>
                    <div class="cw-farm-header-right">
                        <div class="cw-farm-status ${plot.status}">${statusText}</div>
                        <button class="cw-farm-close" onclick="MapFarmUI.close()">✕</button>
                    </div>
                </div>`;
        },

        _renderLeft(plot) {
            const rule = plot.rules || {};
            const rates = MapFarmManager.getEnvRates(plot);

            const envHTML = (plot.env._order || []).map(key => {
                const def = rule.env?.[key] || {};
                const val = plot.env[key];
                const min = def.min ?? 0;
                const max = def.max ?? 100;
                const pct = Math.max(0, Math.min(100, (val - min) / (max - min) * 100));

                // 速率显示（★ 按天）
                const rate = rates[key] ?? 0;
                let rateText = '';
                let rateColor = '#888';
                if (Math.abs(rate) >= 0.01) {
                    rateText = `${rate > 0 ? '+' : ''}${rate.toFixed(1)}/天`;
                    rateColor = rate > 0 ? '#7dd87d' : '#ffb0b0';
                }

                return `
                    <div class="cw-farm-env-row">
                        <div class="cw-farm-env-label">
                            <span>${def.emoji || '·'}</span>
                            <span>${def.label || key}</span>
                        </div>
                        <div class="cw-farm-env-bar">
                            <div class="cw-farm-env-fill" style="width:${pct}%"></div>
                        </div>
                        <div class="cw-farm-env-value">${Math.round(val)}</div>
                        <div class="cw-farm-env-rate" style="color:${rateColor};">${rateText}</div>
                    </div>`;
            }).join('');

            let cropHTML = '';
            if (plot.status === 'growing' && plot.cropId) {
                cropHTML = this._renderCropPanel(plot, 'growing');
            } else if (plot.status === 'ready' && plot.cropId) {
                cropHTML = this._renderCropPanel(plot, 'ready');
            } else if (plot.status === 'dead') {
                cropHTML = `<div class="cw-farm-crop dead">💀 作物枯死，请重新种植</div>`;
            } else {
                cropHTML = `<div class="cw-farm-crop empty">🌱 空地</div>`;
            }

            return `
                <div class="cw-farm-left">
                    <div class="cw-farm-section">
                        <div class="cw-farm-section-title">🌍 环境</div>
                        ${envHTML || '<div class="cw-farm-empty">无环境数据</div>'}
                    </div>
                    <div class="cw-farm-section">
                        <div class="cw-farm-section-title">🌾 当前作物</div>
                        ${cropHTML}
                    </div>
                </div>`;
        },
        // ============================================================
        // ★ 新增：作物面板（带生长条件检查）
        // ============================================================
        _renderCropPanel(plot, state) {
            const rule = plot.rules;
            const crop = rule.crops?.[plot.cropId];
            if (!crop) return '';

            const pct = Math.round((plot.progress || 0) * 100);

            const stages = crop.stages || [crop.emoji || '🌱'];
            const stageIdx = state === 'ready'
                ? stages.length - 1
                : Math.min(Math.floor((plot.progress || 0) * stages.length), stages.length - 1);
            const stageIcon = stages[stageIdx];

            // 生长条件检查
            const envReq = crop.envReq || {};
            let condHTML = '';
            let allOk = true;
            for (const [key, cond] of Object.entries(envReq)) {
                const def = rule.env?.[key] || {};
                const v = plot.env[key];
                let ok = true;
                let condText = '';
                if (cond.min !== undefined && cond.max !== undefined) {
                    condText = `${cond.min}~${cond.max}`;
                    ok = v >= cond.min && v <= cond.max;
                } else if (cond.min !== undefined) {
                    condText = `≥${cond.min}`;
                    ok = v >= cond.min;
                } else if (cond.max !== undefined) {
                    condText = `≤${cond.max}`;
                    ok = v <= cond.max;
                }
                if (!ok) allOk = false;

                condHTML += `
            <div class="cw-farm-cond-row">
                <span class="cw-farm-cond-key">${def.emoji || ''} ${def.label || key}</span>
                <span class="cw-farm-cond-req">${condText}</span>
                <span class="cw-farm-cond-cur ${ok ? 'ok' : 'bad'}">${Math.round(v)} ${ok ? '✓' : '✗'}</span>
            </div>`;
            }

            const remainHours = state === 'growing'
                ? Math.max(0, Math.ceil((1 - (plot.progress || 0)) * crop.growHours))
                : 0;

            return `
        <div class="cw-farm-crop ${state}">
            <div class="cw-farm-crop-icon">${stageIcon}</div>
            <div class="cw-farm-crop-name">${crop.name}</div>
            <div class="cw-farm-crop-progress">
                <div class="cw-farm-crop-bar" style="width:${pct}%"></div>
            </div>
            <div class="cw-farm-crop-pct">
                ${state === 'ready' ? '✨ 已成熟' : `${pct}% · 剩余 ${remainHours} 小时`}
            </div>

            ${condHTML ? `
                <div class="cw-farm-cond-block">
                    <div class="cw-farm-cond-title">生长条件</div>
                    ${condHTML}
                    ${!allOk && state === 'growing' ? `
                        <div class="cw-farm-cond-warn">⚠️ 环境不适宜，长时间会枯死</div>
                    ` : ''}
                </div>
            ` : ''}
        </div>`;
        },
        _renderRight(plot) {
            const tabs = [
                { id: 'status', label: '⚡ 动作' },
                { id: 'seeds', label: '🌱 种子' },
                { id: 'shop', label: '🏪 商店' },
                { id: 'log', label: '📜 日志' },
                { id: 'config', label: '⚙️ 配置' },
            ];

            let body = '';
            switch (this._tab) {
                case 'status': body = this._renderActions(plot); break;
                case 'seeds': body = this._renderSeeds(plot); break;
                case 'shop': body = this._renderShop(plot); break;
                case 'log': body = this._renderLog(plot); break;
                case 'config': body = this._renderConfig(plot); break;
            }

            return `
                <div class="cw-farm-right">
                    <div class="cw-farm-tabs">
                        ${tabs.map(t => `
                            <button class="cw-farm-tab ${this._tab === t.id ? 'active' : ''}"
                                onclick="MapFarmUI.switchTab('${t.id}')">${t.label}</button>
                        `).join('')}
                    </div>
                    <div class="cw-farm-tab-body">${body}</div>
                </div>`;
        },

        _renderActions(plot) {
            const rule = plot.rules;
            const actions = rule.actions || {};
            if (Object.keys(actions).length === 0) {
                return `<div class="cw-farm-empty">没有可用动作</div>`;
            }

            const cellCount = (plot.bounds.w || 1) * (plot.bounds.h || 1);
            let html = '';

            for (const [id, act] of Object.entries(actions)) {
                const totalCost = MapFarmManager._scaleCost(act.cost, cellCount);
                const cost = Object.entries(totalCost).map(([k, v]) => `${k}×${v}`).join('、');

                // 效果预览：当前 → 之后
                const effectPreviews = [];
                for (const [key, val] of Object.entries(act.effect || {})) {
                    const def = rule.env?.[key] || {};
                    const cur = plot.env[key];
                    const nv = Math.max(def.min ?? 0, Math.min(def.max ?? 100, cur + val));
                    effectPreviews.push(
                        `${def.emoji || ''}${def.label || key} ${Math.round(cur)}→${Math.round(nv)} (${val > 0 ? '+' : ''}${val})`
                    );
                }

                html += `
                    <button class="cw-farm-action-btn"
                        onclick="MapFarmUI._doAction('${id}')">
                        <div class="cw-farm-action-icon">${act.emoji || '⚡'}</div>
                        <div class="cw-farm-action-info">
                            <div class="cw-farm-action-name">${act.name}</div>
                            <div class="cw-farm-action-meta">
                                ${cost ? `消耗：${cost}` : '无消耗'}
                            </div>
                            ${effectPreviews.length ? `
                                <div class="cw-farm-action-effect">
                                    ${effectPreviews.join(' · ')}
                                </div>
                            ` : ''}
                        </div>
                    </button>`;
            }

            if (plot.status === 'ready') {
                html += `
                    <button class="cw-farm-action-btn primary"
                        onclick="MapFarmUI._doHarvest()">
                        <div class="cw-farm-action-icon">📦</div>
                        <div class="cw-farm-action-info">
                            <div class="cw-farm-action-name">收获</div>
                            <div class="cw-farm-action-meta">把作物收进背包</div>
                        </div>
                    </button>`;
            }

            return html;
        },

        _renderSeeds(plot) {
            if (plot.status === 'growing' || plot.status === 'ready') {
                return `<div class="cw-farm-empty">当前正在种植中，无法播种</div>`;
            }

            const crops = plot.rules.crops || {};
            if (Object.keys(crops).length === 0) {
                return `<div class="cw-farm-empty">没有可用种子</div>`;
            }

            const cellCount = (plot.bounds.w || 1) * (plot.bounds.h || 1);
            let html = '';

            for (const [id, crop] of Object.entries(crops)) {
                const totalCost = MapFarmManager._scaleCost(crop.cost, cellCount);
                const cost = Object.entries(totalCost).map(([k, v]) => `${k}×${v}`).join('、');
                const totalYield = (crop.yield?.count || 1) * cellCount;
                const yieldText = crop.yield ? `${crop.yield.item}×${totalYield}` : '';

                html += `
                    <button class="cw-farm-seed-btn"
                        onclick="MapFarmUI._showSeedDetail('${id}')">
                        <div class="cw-farm-seed-icon">${crop.emoji || '🌱'}</div>
                        <div class="cw-farm-seed-info">
                            <div class="cw-farm-seed-name">${crop.name}</div>
                            <div class="cw-farm-seed-meta">
                                ${cost ? `成本：${cost}` : ''}
                                ${cost ? ' · ' : ''}生长：${crop.growHours}小时
                                ${yieldText ? ` · 产出：${yieldText}` : ''}
                            </div>
                        </div>
                    </button>`;
            }
            return html;
        },
        _showSeedDetail(cropId) {
            const plot = this._getPlot();
            if (!plot) return;
            const crop = plot.rules.crops?.[cropId];
            if (!crop) return;

            const rule = plot.rules;
            const cellCount = (plot.bounds.w || 1) * (plot.bounds.h || 1);

            const totalCost = MapFarmManager._scaleCost(crop.cost, cellCount);
            const costText = Object.entries(totalCost).map(([k, v]) => `${k}×${v}`).join('、');

            const totalYield = (crop.yield?.count || 1) * cellCount;
            const yieldText = crop.yield ? `${crop.yield.item} × ${totalYield}` : '';

            let envReqHTML = '';
            for (const [key, cond] of Object.entries(crop.envReq || {})) {
                const def = rule.env?.[key] || {};
                const cur = plot.env[key];
                let condText = '';
                let ok = true;
                if (cond.min !== undefined && cond.max !== undefined) {
                    condText = `${cond.min} ~ ${cond.max}`;
                    ok = cur >= cond.min && cur <= cond.max;
                } else if (cond.min !== undefined) {
                    condText = `≥ ${cond.min}`;
                    ok = cur >= cond.min;
                } else if (cond.max !== undefined) {
                    condText = `≤ ${cond.max}`;
                    ok = cur <= cond.max;
                }
                envReqHTML += `
                    <div class="cw-seed-detail-row">
                        <span class="key">${def.emoji || ''} ${def.label || key}</span>
                        <span class="req">${condText}</span>
                        <span class="cur ${ok ? 'ok' : 'bad'}">当前 ${Math.round(cur)} ${ok ? '✓' : '✗'}</span>
                    </div>`;
            }

            const stages = crop.stages || [crop.emoji || '🌱'];
            const stagesHTML = stages.map((s, i) =>
                `<span style="font-size:24px;opacity:${i === 0 ? 1 : 0.7};">${s}</span>`
            ).join('<span style="color:#556;margin:0 4px;">→</span>');

            const canPlant = plot.status === 'idle' || plot.status === 'dead';

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🌱 种植详情</div>
        
                <div style="text-align:center;padding:12px 0 20px;">
                    <div style="font-size:56px;margin-bottom:8px;">${crop.emoji || '🌱'}</div>
                    <div style="font-size:18px;color:#fff;font-weight:700;">${crop.name}</div>
                </div>
        
                <div class="cw-seed-detail-section">
                    <div class="cw-seed-detail-label">阶段</div>
                    <div style="text-align:center;padding:8px 0;">
                        ${stagesHTML}
                    </div>
                </div>
        
                <div class="cw-seed-detail-section">
                    <div class="cw-seed-detail-label">🌿 生长条件</div>
                    ${envReqHTML || '<div style="color:#888;font-size:12px;">无特殊要求</div>'}
                </div>
        
                <div class="cw-seed-detail-section">
                    <div class="cw-seed-detail-label">⏱ 生长周期</div>
                    <div class="cw-seed-detail-row">
                        <span class="key">总时长</span>
                        <span class="req">${crop.growHours} 小时</span>
                    </div>
                </div>
        
                <div class="cw-seed-detail-section">
                    <div class="cw-seed-detail-label">💰 成本</div>
                    <div class="cw-seed-detail-row">
                        <span class="key">整块地（${cellCount} 格）</span>
                        <span class="req">${costText || '免费'}</span>
                    </div>
                </div>
        
                <div class="cw-seed-detail-section">
                    <div class="cw-seed-detail-label">📦 收获</div>
                    <div class="cw-seed-detail-row">
                        <span class="key">整块地</span>
                        <span class="req">${yieldText}</span>
                    </div>
                    <div class="cw-seed-detail-row" style="font-size:11px;color:#888;">
                        <span class="key">每格</span>
                        <span class="req">${crop.yield?.item} × ${crop.yield?.count || 1}</span>
                    </div>
                </div>
        
                <div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    ${canPlant
                    ? `<button class="cinemaworld-button primary" onclick="MapFarmUI._confirmPlant('${cropId}')">
                               ✅ 种下（${costText || '免费'}）
                           </button>`
                    : `<button class="cinemaworld-button" disabled style="opacity:.5;cursor:not-allowed;">
                               当前无法种植
                           </button>`}
                    <button class="cinemaworld-button" onclick="MapFarmUI._render()">返回</button>
                </div>
            `;
        },
        _confirmPlant(cropId) {
            const result = MapFarmManager.plant(this._currentPlotId, cropId);
            if (result.ok) {
                window.UIManager?.showText?.(`✅ ${result.message}`, 1500);
                this._tab = 'status';
            } else {
                window.UIManager?.showText?.(`❌ ${result.message}`, 1500);
            }
            this._render();
        },
        _renderShop(plot) {
            const shop = MapFarmManager.getShopState(plot);
            if (!shop || !shop.items?.length) {
                return `<div class="cw-farm-empty">这个区域没有商店</div>`;
            }

            const player = window.PlayerStateManager?.player;
            const extra = player?.extraStats;
            const goldKey = extra?._order?.find(k => /金币|金钱|钱/.test(k)) || '金钱';
            const gold = parseFloat(String(extra?.[goldKey] ?? '0').match(/^(-?\d+(?:\.\d+)?)/)?.[1] || '0');

            let html = `
                <div class="cw-farm-shop-head">
                    <span>${shop.emoji} ${shop.name}</span>
                    <span style="color:#ffd76b;">💰 ${Math.round(gold)}</span>
                </div>`;

            for (const item of shop.items) {
                const canAfford = gold >= item.price;
                const outOfStock = item.stock <= 0;

                html += `
                    <button class="cw-farm-shop-btn ${outOfStock ? 'out' : ''} ${canAfford ? '' : 'poor'}"
                        onclick="MapFarmUI._doBuy('${item.id}')"
                        ${outOfStock ? 'disabled' : ''}>
                        <div class="cw-farm-shop-icon">${item.icon}</div>
                        <div class="cw-farm-shop-info">
                            <div class="cw-farm-shop-name">${item.name}</div>
                            <div class="cw-farm-shop-meta">
                                ${this._effectText(item.effect)}
                            </div>
                            <div class="cw-farm-shop-stock">
                                库存 ${item.stock}/${item.maxStock}
                            </div>
                        </div>
                        <div class="cw-farm-shop-price">
                            ${outOfStock ? '售罄' : `💰${item.price}`}
                        </div>
                    </button>`;
            }

            return html;
        },

        _effectText(effect) {
            if (!effect) return '';
            switch (effect.type) {
                case 'env': return `改变环境 ${effect.target}+${effect.value}`;
                case 'recover': return `恢复 ${effect.target}+${effect.value}`;
                case 'speed': return `生长 ×${effect.multiplier}（${effect.duration}h）`;
                case 'protect': return `保护 ${effect.duration}h`;
                case 'cure': return `治愈 ${effect.target}`;
                case 'item': return `获得 ${effect.target}×${effect.value}`;
            }
            return '';
        },

        _renderLog(plot) {
            const log = (plot.log || []).slice(-30).reverse();
            if (log.length === 0) return `<div class="cw-farm-empty">暂无日志</div>`;

            return log.map(l => {
                const d = new Date(l.ts);
                const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                return `<div class="cw-farm-log-line">
                    <span class="cw-farm-log-time">${t}</span>
                    <span class="cw-farm-log-text">${l.text}</span>
                </div>`;
            }).join('');
        },

        // ============================================================
        // 配置 tab
        // ============================================================
        _renderConfig(plot) {
            const crops = Object.values(plot.rules?.crops || {});
            const actions = Object.values(plot.rules?.actions || {});

            let html = `
                <div style="font-size:12px;color:#888;margin-bottom:12px;">
                    当前配置：${crops.length} 种作物 · ${actions.length} 个动作
                </div>

                <div style="font-size:13px;color:#9ab0ff;margin-bottom:6px;">可种作物</div>
                ${crops.map(c => `
                    <div style="font-size:12px;color:#ccc;padding:4px 0;">
                        ${c.emoji} ${c.name} · ${c.growHours}h · ${c.yield?.item}×${c.yield?.count}/格
                    </div>
                `).join('')}

                <div style="font-size:13px;color:#9ab0ff;margin:14px 0 6px;">动作</div>
                ${actions.map(a => `
                    <div style="font-size:12px;color:#ccc;padding:4px 0;">
                        ${a.emoji} ${a.name}
                    </div>
                `).join('')}

                <div style="text-align:center;margin-top:20px;display:flex;flex-direction:column;gap:8px;align-items:center;">
                    <button class="cinemaworld-button" onclick="MapFarmUI._saveAsTemplate()" style="width:200px;">
                        📦 另存为模板
                    </button>
                    <button class="cinemaworld-button" onclick="MapFarmUI._aiRegenerate()" style="width:200px;color:#a8d8ff;">
                        🤖 AI 重新生成
                    </button>
                </div>`;

            return html;
        },

        _saveAsTemplate() {
            const plot = this._getPlot();
            if (!plot?.rules) return;

            const name = prompt('模板名称：', plot.name);
            if (!name) return;
            const desc = prompt('模板描述（可选）：', '') || '';

            window.MapPlotTemplate.register({
                name,
                type: plot.type,
                emoji: plot.emoji || '🌾',
                color: plot.color || 'rgba(120,200,120,0.30)',
                description: desc,
                rules: JSON.parse(JSON.stringify(plot.rules)),
                shop: JSON.parse(JSON.stringify(plot.shop)),
                source: 'manual',
                createdAt: Date.now(),
            });

            window.UIManager?.showText?.(`✅ 已保存为模板「${name}」`, 2000);
        },

        _aiRegenerate() {
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🤖 AI 重新生成配置</div>
                <div style="text-align:center;padding:8px 0 12px;color:#aaa;font-size:13px;line-height:1.7;">
                    让 AI 重新生成环境、动作、作物、商店。<br>
                    <span style="color:#ffd76b;">⚠️ 会覆盖当前配置</span>
                </div>
                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:6px;">额外要求（可选）</div>
                    <textarea id="cw-farm-ai-guide" class="cinemaworld-textarea"
                        placeholder="例如：种灵草的田，出产的灵草可以炼丹..."
                        style="min-height:80px;"></textarea>
                </div>
                <div style="text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" id="cw-farm-ai-go">✨ 生成并应用</button>
                    <button class="cinemaworld-button" onclick="MapFarmUI._render()">取消</button>
                </div>`;

            document.getElementById('cw-farm-ai-go').onclick = () => this._doRegenerate();
        },

        async _doRegenerate() {
            const guide = document.getElementById('cw-farm-ai-guide')?.value.trim() || '';
            const btn = document.getElementById('cw-farm-ai-go');
            if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 生成中...'; }

            const result = await window.MapFarmGenerator.generate(this._currentPlotId, { guide });
            if (result) {
                this._tab = 'status';
                this._render();
            } else {
                this._render();
            }
        },

        // ============================================================
        // 交互
        // ============================================================
        switchTab(tab) {
            this._tab = tab;
            this._render();
        },

        _doAction(actionId) {
            const result = MapFarmManager.executeAction(this._currentPlotId, actionId);
            window.UIManager?.showText?.(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`, 1500);
            this._render();
        },

        _doPlant(cropId) {
            const result = MapFarmManager.plant(this._currentPlotId, cropId);
            if (result.ok) {
                window.UIManager?.showText?.(`✅ ${result.message}`, 1500);
                this._tab = 'status';
            } else {
                window.UIManager?.showText?.(`❌ ${result.message}`, 1500);
            }
            this._render();
        },

        _doHarvest() {
            const result = MapFarmManager.harvest(this._currentPlotId);
            window.UIManager?.showText?.(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`, 1800);
            this._render();
        },

        _doBuy(itemId) {
            const result = MapFarmManager.buyShopItem(this._currentPlotId, itemId);
            window.UIManager?.showText?.(result.ok ? `✅ ${result.message}` : `❌ ${result.message}`, 1500);
            this._render();
        },
    };

    // ============================================================
    // 挂载 + 事件
    // ============================================================
    window.MapFarmManager = MapFarmManager;
    window.MapFarmUI = MapFarmUI;

    // ★ 玩家进入地图 → 补算所有 plot
    window.addEventListener('cw:map-catchup', (e) => {
        const { map, env, deltaMinutes } = e.detail || {};
        if (!map || !deltaMinutes || deltaMinutes <= 0) return;

        const plots = map._plots;
        if (!plots) return;

        const hoursDelta = deltaMinutes / 60;

        let changed = 0;
        for (const plot of Object.values(plots)) {
            if (plot.type !== 'farm') continue;
            if (!plot.rules) continue;

            // ★ 一次性补算：把 hoursDelta 拆成"按天衰减 + 按小时生长"
            if (MapFarmManager._catchUpPlot(plot, hoursDelta, env, map)) {
                changed++;
            }
        }

        if (changed > 0) {
            window.MapPlotManager?.markDirty?.();
            window.MapFarmUI?.refresh?.();
            window.MapLauncher?._saveMapToWorld?.(map);
            if (window.SaveManager) window.SaveManager.save();
        }
    });

    // 保留 hour 事件用于 UI 刷新（可选）
    // ★ 每小时 tick：推进当前地图的农田（玩家在地图上时实时生长）
    window.addEventListener('cw:env-hour', () => {
        const map = window.MapLauncher?.getMap?.();
        if (!map) return;
        MapFarmManager.onHourTick(map);
        window.MapFarmUI?.refresh?.();
    });

    console.log('[CinemaWorld] map-farm.js 已加载');
})();