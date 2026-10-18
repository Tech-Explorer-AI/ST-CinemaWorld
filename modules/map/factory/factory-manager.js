// ============================================================
// CinemaWorld · factory-manager.js
// 工厂 tick / 模拟 / 建筑放置 / 拆除 / 资源取用
//
// ★ 性能模型：工厂只在【打开界面时】计算
//   - 不挂全局 cw:env-minute
//   - FactoryUI 打开时调 tickOne(plotId)
//   - 界面开着时，FactoryUI 每分钟再调 tickOne
//   - 关闭时最后补算一次
//   - 其他工厂完全不计算
//
// 依赖：factory-schema.js, factory-gen.js
//       map-plot.js（MapPlotManager）
//
// 暴露：window.FactoryManager
// ============================================================

(function () {
    'use strict';

    const FactoryManager = {
        CONFIG: {
            batchMinutes: 60,       // 一次最多模拟 60 分钟
            maxSimulateMinutes: 60 * 24 * 30,   // 单次补算上限 30 天
        },

        // ============================================================
        // ★ 核心入口：只 tick 指定的工厂
        //   由 FactoryUI 调用
        // ============================================================
        tickOne(plotId) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot?.factory) return false;
            if (plot.type !== 'factory') return false;
            if (!plot.rules) return false;

            const ws = window.CinemaWorld?.worldState;
            const now = (typeof ws?.worldMinutes === 'number') ? ws.worldMinutes : 0;

            const delta = now - (plot.factory.lastTickAt || 0);
            if (delta <= 0) return false;

            // 单次补算上限（防止时间戳异常导致爆算）
            const safeDelta = Math.min(delta, this.CONFIG.maxSimulateMinutes);

            this._runSimulation(plot, safeDelta);
            plot.factory.lastTickAt = now;

            if (delta > this.CONFIG.maxSimulateMinutes) {
                console.warn(
                    `[Factory] ${plot.name} 补算被截断：` +
                    `${(delta / 60 / 24).toFixed(1)}天 → ` +
                    `${(this.CONFIG.maxSimulateMinutes / 60 / 24).toFixed(1)}天`
                );
            }

            return true;
        },

        // ============================================================
        // 批量模拟（分批跑，避免一次跑太多）
        // ============================================================
        _runSimulation(plot, minutes) {
            let remain = minutes;
            while (remain > 0) {
                const batch = Math.min(remain, this.CONFIG.batchMinutes);
                this._simulate(plot, batch);
                remain -= batch;
            }
        },

        // ============================================================
        // 单批模拟
        // ============================================================
        _simulate(plot, minutes) {
            const f = plot.factory;
            const rules = plot.rules;
            if (!f || !rules) return;

            this._updatePower(f, rules, minutes);
            this._tickExtractors(f, rules, minutes);
            this._tickProcessors(f, rules, minutes);
        },

        // ---------- 电力 ----------
        _updatePower(f, rules, minutes) {
            let gen = 0, con = 0;

            // 发电机（顺便烧燃料）
            for (const b of Object.values(f.buildings)) {
                const t = rules.buildingTypes[b.type];
                if (!t || t.kind !== 'power') continue;

                if (t.fuelType) {
                    const need = (t.fuelPerMinute || 0) * minutes;
                    const have = f.storage[t.fuelType] || 0;
                    if (have >= need) {
                        f.storage[t.fuelType] -= need;
                        f.stats.totalConsumed[t.fuelType] =
                            (f.stats.totalConsumed[t.fuelType] || 0) + need;
                        b.powered = true;
                        gen += t.powerOutput || 0;
                    } else {
                        b.powered = false;
                    }
                } else {
                    b.powered = true;
                    gen += t.powerOutput || 0;
                }
            }

            // 耗电
            for (const b of Object.values(f.buildings)) {
                const t = rules.buildingTypes[b.type];
                if (!t || t.kind === 'power') continue;
                con += t.powerDraw || 0;
            }

            f.power.generated = gen;
            f.power.consumed = con;

            const enough = gen >= con;
            for (const b of Object.values(f.buildings)) {
                const t = rules.buildingTypes[b.type];
                if (!t || t.kind === 'power') continue;
                b.powered = enough;
            }
        },

        // ---------- 采集 ----------
        _tickExtractors(f, rules, minutes) {
            for (const b of Object.values(f.buildings)) {
                const t = rules.buildingTypes[b.type];
                if (!t || t.kind !== 'extractor') continue;
                if (!b.powered) continue;

                const outType = t.outputType;
                if (!outType) continue;

                const cap = f.storageCapacity[outType];
                const cur = f.storage[outType] || 0;
                if (cap !== undefined && cur >= cap) {
                    b.blocked = true;
                    continue;
                }

                b.blocked = false;
                const produced = (t.ratePerMinute || 1) * minutes;
                this._addToStorage(f, outType, produced);
                f.stats.totalProduced[outType] =
                    (f.stats.totalProduced[outType] || 0) + produced;
            }
        },

        // ---------- 加工 ----------
        _tickProcessors(f, rules, minutes) {
            for (const b of Object.values(f.buildings)) {
                const t = rules.buildingTypes[b.type];
                if (!t || t.kind !== 'processor') continue;
                if (!b.powered) continue;
                if (!b.recipeId) continue;

                const recipe = t.recipes?.[b.recipeId];
                if (!recipe) continue;

                const cycles = minutes / (recipe.durationMinutes || 5);
                b.progress = (b.progress || 0) + cycles;

                let guard = 0;
                while (b.progress >= 1 && guard++ < 10000) {
                    const canProduce = Object.entries(recipe.input || {}).every(
                        ([item, need]) => (f.storage[item] || 0) >= need
                    );
                    if (!canProduce) {
                        b.progress = 1 - 1e-6;
                        b.blocked = true;
                        break;
                    }

                    const wouldOverflow = Object.entries(recipe.output || {}).some(
                        ([item, out]) => {
                            const cap = f.storageCapacity[item];
                            if (cap === undefined) return false;
                            const cur = f.storage[item] || 0;
                            return cur + out > cap + 1e-6;
                        }
                    );
                    if (wouldOverflow) {
                        b.progress = 1 - 1e-6;
                        b.blocked = true;
                        break;
                    }

                    for (const [item, need] of Object.entries(recipe.input || {})) {
                        f.storage[item] -= need;
                        f.stats.totalConsumed[item] =
                            (f.stats.totalConsumed[item] || 0) + need;
                    }
                    for (const [item, out] of Object.entries(recipe.output || {})) {
                        this._addToStorage(f, item, out);
                        f.stats.totalProduced[item] =
                            (f.stats.totalProduced[item] || 0) + out;
                    }

                    b.progress -= 1;
                    b.blocked = false;
                }
            }
        },

        // ---------- 工具 ----------
        _addToStorage(f, item, amount) {
            if (!item || amount <= 0) return;
            f.storage[item] = (f.storage[item] || 0) + amount;
            const cap = f.storageCapacity[item];
            if (cap !== undefined && f.storage[item] > cap) {
                f.storage[item] = cap;
            }
        },

        _recalcCapacity(f, rules) {
            const cap = {};

            for (const [key, def] of Object.entries(rules.resourceTypes || {})) {
                cap[key] = def.baseCapacity
                    ?? window.FactorySchema.BASE_CAPACITY;
            }

            for (const b of Object.values(f.buildings)) {
                const t = rules.buildingTypes[b.type];
                if (t?.kind !== 'storage') continue;
                for (const [item, amount] of Object.entries(t.capacity || {})) {
                    cap[item] = (cap[item] || 0) + amount;
                }
            }

            f.storageCapacity = cap;

            for (const [item, c] of Object.entries(cap)) {
                if ((f.storage[item] || 0) > c) {
                    f.storage[item] = c;
                }
            }
        },

        _log(plot, text) {
            if (!plot.log) plot.log = [];
            plot.log.push({ ts: Date.now(), text });
            if (plot.log.length > 50) plot.log = plot.log.slice(-50);
        },

        // ============================================================
        // 建筑放置
        // ============================================================
        placeBuilding(plotId, { typeKey, x, y }) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot?.factory) return { ok: false, message: '工厂不存在' };

            const rules = plot.rules;
            const t = rules.buildingTypes[typeKey];
            if (!t) return { ok: false, message: '建筑类型不存在' };

            const f = plot.factory;

            if (!window.FactorySchema.canPlace(f, x, y, t.size || 1)) {
                return { ok: false, message: '位置被占用或越界' };
            }

            const costCheck = this._checkCost(f, t.cost);
            if (!costCheck.ok) return costCheck;

            this._payCost(f, t.cost);

            const id = `bld_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const bld = {
                id,
                type: typeKey,
                x, y,
                size: t.size || 1,
                powered: false,
                progress: 0,
                blocked: false,
            };

            if (t.kind === 'processor') {
                const firstRecipe = Object.keys(t.recipes || {})[0];
                if (firstRecipe) bld.recipeId = firstRecipe;
            }

            f.buildings[id] = bld;
            window.FactorySchema.markBuilding(f, bld);

            this._recalcCapacity(f, rules);

            window.MapPlotManager?.markDirty?.();
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();

            return { ok: true, buildingId: id };
        },

        removeBuilding(plotId, buildingId) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot?.factory) return { ok: false };

            const f = plot.factory;
            const bld = f.buildings[buildingId];
            if (!bld) return { ok: false };

            window.FactorySchema.clearBuilding(f, bld);
            delete f.buildings[buildingId];

            this._recalcCapacity(f, plot.rules);

            window.MapPlotManager?.markDirty?.();
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();

            return { ok: true };
        },

        setRecipe(plotId, buildingId, recipeId) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot?.factory) return { ok: false };

            const bld = plot.factory.buildings[buildingId];
            if (!bld) return { ok: false };

            const t = plot.rules.buildingTypes[bld.type];
            if (!t?.recipes?.[recipeId]) return { ok: false, message: '配方不存在' };

            bld.recipeId = recipeId;
            bld.progress = 0;
            bld.blocked = false;

            window.MapPlotManager?.markDirty?.();
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();

            return { ok: true };
        },

        // ============================================================
        // 成本：金钱走玩家钱包，资源走工厂库存
        // ============================================================
        _checkCost(f, cost) {
            if (!cost || Object.keys(cost).length === 0) return { ok: true };

            const missing = [];
            for (const [key, need] of Object.entries(cost)) {
                if (key === '金钱') {
                    const gold = this._getPlayerGold();
                    if (gold < need) missing.push(`金钱(需 ${need})`);
                    continue;
                }
                const have = f.storage[key] || 0;
                if (have < need) missing.push(`${key}(需 ${need})`);
            }

            if (missing.length > 0) {
                return { ok: false, message: `资源不足：${missing.join('、')}` };
            }
            return { ok: true };
        },

        _payCost(f, cost) {
            if (!cost) return;
            for (const [key, need] of Object.entries(cost)) {
                if (key === '金钱') {
                    this._payPlayerGold(need);
                    continue;
                }
                f.storage[key] = Math.max(0, (f.storage[key] || 0) - need);
            }
        },

        _getPlayerGold() {
            const player = window.PlayerStateManager?.player;
            const extra = player?.extraStats;
            if (!extra?._order) return 0;
            const key = extra._order.find(k => /金钱|金币|钱/.test(k));
            if (!key) return 0;
            const raw = String(extra[key] ?? '0');
            return parseFloat(raw.match(/^(-?\d+(?:\.\d+)?)/)?.[1] || '0');
        },

        _payPlayerGold(amount) {
            const player = window.PlayerStateManager?.player;
            const extra = player?.extraStats;
            if (!extra?._order) return;
            const key = extra._order.find(k => /金钱|金币|钱/.test(k));
            if (!key) return;
            const raw = String(extra[key] ?? '0');
            const cur = parseFloat(raw.match(/^(-?\d+(?:\.\d+)?)/)?.[1] || '0');
            const unit = raw.match(/([^\d.\-]*)$/)?.[1] || '';
            extra[key] = `${Math.max(0, cur - amount)}${unit}`;
            window.PlayerStateManager?.refreshAvatarArea?.();
        },

        // ============================================================
        // 玩家取走资源
        // ============================================================
        takeResource(plotId, resourceKey, amount) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot?.factory) return { ok: false, message: '工厂不存在' };

            const f = plot.factory;
            const rules = plot.rules;
            const rDef = rules.resourceTypes[resourceKey];
            if (!rDef) return { ok: false, message: '资源不存在' };

            const have = f.storage[resourceKey] || 0;
            const take = Math.min(have, amount);
            if (take <= 0) return { ok: false, message: '没有可取的资源' };

            const player = window.PlayerStateManager?.player;
            if (!player) return { ok: false, message: '玩家未加载' };

            player.inventory = player.inventory || [];

            const itemFields = Object.assign({}, rDef.itemFields || {});

            if (!itemFields['类型']) itemFields['类型'] = '材料';
            if (!itemFields['可堆叠']) itemFields['可堆叠'] = '是';
            if (!itemFields['最大堆叠']) itemFields['最大堆叠'] = '99';
            if (!itemFields['货币种类']) itemFields['货币种类'] = '金钱';
            if (!itemFields['卖价']) itemFields['卖价'] = 'Y';
            if (!itemFields['买价']) itemFields['买价'] = 'X';
            if (!itemFields['效果']) itemFields['效果'] = '无';
            if (!itemFields['状态']) itemFields['状态'] = '-';
            if (!itemFields['功能']) itemFields['功能'] = '—';
            if (!itemFields['交互方式']) itemFields['交互方式'] = '查看、丢弃';

            const stackable = String(itemFields['可堆叠']).trim() === '是';
            const maxStackM = String(itemFields['最大堆叠'] || '').match(/(\d+)/);
            const maxStack = maxStackM ? parseInt(maxStackM[1]) : null;

            const item = {
                name: rDef.label || resourceKey,
                count: take,
                icon: rDef.emoji || '📦',
                description: rDef.description || '',
                fields: itemFields,
                interactions: this._parseInteractions(itemFields['交互方式']),
                status: itemFields['状态'] === '-' ? '' : itemFields['状态'],
                effect: itemFields['效果'] === '无' ? '' : itemFields['效果'],
                stackable,
                maxStack,
                type: 'item',
            };

            if (stackable) {
                const existing = player.inventory.find(i => i.name === item.name);
                if (existing) {
                    existing.count = (existing.count || 1) + take;
                    f.storage[resourceKey] -= take;
                    window.PlayerStateManager?.refreshAvatarArea?.();
                    window.MapPlotManager?.markDirty?.();
                    window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
                    if (window.SaveManager) window.SaveManager.save();
                    return { ok: true, taken: take };
                }
            }

            const slots = player.inventorySlots || 40;
            if (player.inventory.length >= slots) {
                return { ok: false, message: '背包已满' };
            }

            player.inventory.push(item);
            f.storage[resourceKey] -= take;

            window.PlayerStateManager?.refreshAvatarArea?.();
            window.MapPlotManager?.markDirty?.();
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();

            return { ok: true, taken: take };
        },

        _parseInteractions(text) {
            if (!text || text === '-') return [];
            return String(text)
                .split(/[、,，\/]/)
                .map(s => s.trim())
                .filter(Boolean)
                .map(name => ({ name, hint: '' }));
        },

        takeAll(plotId) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot?.factory) return { ok: false };

            const f = plot.factory;
            let total = 0;
            for (const key of Object.keys(f.storage)) {
                const amt = f.storage[key] || 0;
                if (amt <= 0) continue;
                const r = this.takeResource(plotId, key, amt);
                if (r.ok) total += r.taken;
            }
            return { ok: true, taken: total };
        },

        // ============================================================
        // 兼容：如果有外部系统调 onMinute，也让它只处理"当前打开的工厂"
        // （保留但不再挂全局事件）
        // ============================================================
        onMinute(map) {
            const openPlotId = window.FactoryUI?._plotId;
            if (openPlotId) {
                this.tickOne(openPlotId);
            }
        },
    };

    window.FactoryManager = FactoryManager;

    // ★ 不再挂全局 cw:env-minute
    // ★ 不再挂 cw:map-catchup（工厂由 FactoryUI 按需触发）

    console.log('[CinemaWorld] factory-manager.js 已加载');
})();