// ============================================================
// CinemaWorld · combat-resolver.js
// 即时战斗 · 结算
//   - 复用 BattleManager 的命中/伤害公式
//   - 飘字 + 震动 + 闪红
//   - 敌人受伤 / 死亡
//
// 依赖：CombatWeapon, BattleManager, BattleEffectManager,
//       PlayerStateManager, TagEffectManager
// 暴露：window.CombatResolver
// ============================================================

(function () {
    'use strict';

    const CombatResolver = {

        // ============================================================
        // 主入口：一次攻击
        // ============================================================
        async executeAttack({ weapon, combatData, player, facing, map }) {
            if (!player || !combatData || !map) return;

            // ---------- 1. 计算命中格子 ----------
            const targets = window.CombatWeapon.getAttackTargets(
                player, facing, combatData, map
            );

            // ---------- 2. 播放攻击特效 ----------
            this._playAttackEffect(player, facing, combatData, targets);

            // ---------- 3. 没有目标 → 空挥 ----------
            if (targets.entities.length === 0) {
                this._playMissEffect(player, combatData);
                return;
            }

            // ---------- 4. 拿玩家战斗属性 ----------
            const playerStats = this._buildPlayerStats();

            // ---------- 5. 逐个目标结算 ----------
            for (const ent of targets.entities) {
                // ★ 队友不结算
                if (ent.kind === 'companion') continue;

                await this._resolveHit(weapon, combatData, playerStats, ent, map);

                if (combatData.type === '近战') break;
                if (combatData.type === '远程') break;
            }
        },

        // ============================================================
        // 对单个目标结算
        // ============================================================
        async _resolveHit(weapon, combatData, playerStats, target, map) {
            // ---------- 1. 命中判定 ----------
            const enemyStats = this._buildEnemyStats(target);
            const hitCheck = this._rollHit(playerStats, enemyStats);

            if (!hitCheck.hit) {
                window.CombatRender?.popupAt?.(target.x, target.y, 'MISS', 'miss');
                this._log(`💨 ${target.name} 闪避了`);
                return;
            }

            // ---------- 2. 暴击判定 ----------
            const isCrit = this._rollCrit(playerStats);

            // ---------- 3. 伤害计算 ----------
            const dmgResult = this._calcDamage(playerStats, enemyStats);
            let dmg = dmgResult.value;

            if (isCrit) {
                const critMult = playerStats.critDamage || 1.5;
                dmg = Math.round(dmg * critMult);
            }

            // ---------- 4. 应用伤害 ----------
            const applied = this._applyDamageToEnemy(target, dmg);

            // ---------- 5. 飘字 + 震屏 ----------
            if (isCrit) {
                window.CombatRender?.popupAt?.(target.x, target.y, `-${dmg}`, 'crit');
                window.BattleEffectManager?.shake?.('.cw-map-canvas-container', 'medium');
            } else {
                window.CombatRender?.popupAt?.(target.x, target.y, `-${dmg}`, 'damage');
                window.BattleEffectManager?.shake?.('.cw-map-canvas-container', 'light');
            }

            this._log(`⚔️ ${weapon.name} 对 ${target.name} 造成 ${dmg} 伤害${isCrit ? '（暴击）' : ''}`);

            // ---------- 6. 死亡处理 ----------
            if (applied.hp <= 0) {
                await this._handleEnemyDeath(target, map);
            }

            // ---------- 7. 敌人 aggro ----------
            this._markEnemyAggro(target);
        },

        // ============================================================
        // 玩家战斗属性（复用 BattleManager 的逻辑）
        // ============================================================
        _buildPlayerStats() {
            // 优先用 BattleManager.getPlayerStats（已经处理了装备/派生/标签）
            if (window.BattleManager?.getPlayerStats) {
                try {
                    return window.BattleManager.getPlayerStats();
                } catch (e) {
                    console.warn('[CombatResolver] getPlayerStats 失败，走兜底:', e);
                }
            }

            // 兜底：手工构建
            const player = window.PlayerStateManager?.player;
            if (!player) {
                return {
                    name: '玩家',
                    attack: 10,
                    defense: 5,
                    speed: 10,
                    critRate: 0,
                    critDamage: 1.5,
                    hp: { current: 100, max: 100 },
                    extra: {},
                };
            }

            const bonuses = player.equipment?.bonuses || {};
            const hpBar = (player.statusBars || []).find(b => /生命|血量|HP/i.test(b.key));

            return {
                name: player.name || '玩家',
                attack: (player.attributes?.力量?.value ?? 10) + (bonuses['攻击'] || 0),
                defense: (player.attributes?.体质?.value ?? 5) + (bonuses['防御'] || 0),
                speed: (player.attributes?.敏捷?.value ?? 10) + (bonuses['敏捷'] || 0),
                critRate: bonuses['暴击率'] || 0,
                critDamage: bonuses['暴击伤害'] || 1.5,
                hp: hpBar ? { current: hpBar.current, max: hpBar.max } : { current: 100, max: 100 },
                extra: {},
                _hpBarRef: hpBar || null,
            };
        },

        // ============================================================
        // 敌人战斗属性
        // ============================================================
        _buildEnemyStats(target) {
            // ★ 地图敌人的数据在 fields 里，直接读
            const f = target.fields || {};
            const hp = this._parseHP(f['HP'] || f['生命'] || f['生命值'] || '100/100');

            // 额外属性
            const extra = {};
            const SKIP = new Set([
                '类型', '状态', '功能', '图标', 'icon', '交互', '交互方式',
                '技能', '技能列表', '掉落', '战利品', '数量',
                '攻击', '攻击力', '力量', '攻击强度',
                '防御', '防御力', '护甲', '体质',
                '敏捷', '速度', '先攻', '闪避',
                'HP', '生命', '生命值', '血量', '气血',
                '攻击方式', '攻击距离', '攻击间隔',
                '金钱', '经验',
            ]);

            for (const [k, v] of Object.entries(f)) {
                if (k.startsWith('_pos')) continue;
                if (SKIP.has(k)) continue;
                const raw = String(v).trim();
                const num = parseFloat(raw.replace(/[^\d.\-]/g, ''));
                if (!isNaN(num) && /^[+\-]?\d/.test(raw)) {
                    extra[k] = num;
                } else {
                    extra[k] = v;
                }
            }

            return {
                name: target.name,
                hp,
                attack: parseInt(f['攻击'] || f['攻击力'] || f['力量'] || f['攻击强度']) || 10,
                defense: parseInt(f['防御'] || f['防御力'] || f['护甲'] || f['体质']) || 5,
                speed: parseInt(f['敏捷'] || f['速度'] || f['先攻'] || f['闪避']) || 10,
                critRate: 0,
                critDamage: 1.5,
                extra,
            };
        },

        _parseHP(str) {
            const m = String(str).match(/^(\d+)\s*\/\s*(\d+)$/);
            if (m) return { current: parseInt(m[1]), max: parseInt(m[2]) };
            const n = parseInt(String(str).replace(/[^\d]/g, ''));
            if (!isNaN(n) && n > 0) return { current: n, max: n };
            return { current: 100, max: 100 };
        },

        // ============================================================
        // 命中判定（复用 BattleRuleManager）
        // ============================================================
        _rollHit(attackerStats, targetStats) {
            // 没有命中公式 → 必中
            const rules = window.BattleRuleManager?.getCurrent?.()
                || window.BattleRuleManager?.DEFAULT_RULES;

            if (!rules?.hitFormula) {
                return { hit: true, detail: '必中' };
            }

            // 用 BattleManager 的详细判定（如果可用）
            if (window.BattleManager?._rollHitDetailed) {
                try {
                    return window.BattleManager._rollHitDetailed(attackerStats, targetStats);
                } catch (e) { /* 继续 */ }
            }

            // 兜底：简单判定
            const roll = Math.random() * 20 + 1;
            const atkSpeed = attackerStats.speed || 10;
            const defSpeed = targetStats.speed || 10;
            const threshold = 10 + Math.floor((defSpeed - atkSpeed) / 2);
            return { hit: roll >= threshold, roll, threshold };
        },

        _rollCrit(attackerStats) {
            if (window.BattleManager?.rollCrit) {
                try {
                    return window.BattleManager.rollCrit(attackerStats);
                } catch (e) { /* 继续 */ }
            }

            let rate = attackerStats.critRate || 0;
            if (rate > 1) rate = rate / 100;
            rate = Math.max(0, Math.min(0.8, rate));
            return Math.random() < rate;
        },

        _calcDamage(attackerStats, targetStats) {
            const rules = window.BattleRuleManager?.getCurrent?.()
                || window.BattleRuleManager?.DEFAULT_RULES;
            const formula = rules?.damageFormula || '{攻击} - {防御}';

            if (window.BattleManager?._calcDamageDetailed) {
                try {
                    return window.BattleManager._calcDamageDetailed(
                        formula, attackerStats, targetStats
                    );
                } catch (e) { /* 继续 */ }
            }

            // 兜底：简单公式
            const dmg = Math.max(1, Math.round(
                (attackerStats.attack || 10) - (targetStats.defense || 0)
            ));
            return { value: dmg, detail: `${attackerStats.attack} - ${targetStats.defense} = ${dmg}` };
        },

        // ============================================================
        // 应用伤害到敌人
        // ============================================================
        _applyDamageToEnemy(target, dmg) {
            const f = target.fields || {};
            const hpKey = f['HP'] !== undefined ? 'HP'
                : f['生命'] !== undefined ? '生命'
                    : f['生命值'] !== undefined ? '生命值'
                        : 'HP';

            const hp = this._parseHP(f[hpKey] || '100/100');
            hp.current = Math.max(0, hp.current - dmg);
            target.fields[hpKey] = `${hp.current}/${hp.max}`;

            // 同步 target.stats.hp（如果 BattleManager._buildEnemyStats 用过）
            if (target.stats?.hp) {
                target.stats.hp.current = hp.current;
            }

            return { hp: hp.current, max: hp.max };
        },

        // ============================================================
        // 敌人死亡
        // ============================================================
        async _handleEnemyDeath(target, map) {
            console.log(`[CombatResolver] ${target.name} 被击杀`);
            this._giveKillRewards(target, map);
            // ---------- 1. 集群减数 ----------
            if (target.countMode === 'cluster' && target.count > 1) {
                target.count -= 1;

                // 恢复 HP（集群里的下一个）
                const f = target.fields || {};
                const hpKey = f['HP'] !== undefined ? 'HP'
                    : f['生命'] !== undefined ? '生命'
                        : f['生命值'] !== undefined ? '生命值' : 'HP';
                const hp = this._parseHP(f[hpKey] || '100/100');
                target.fields[hpKey] = `${hp.max}/${hp.max}`;
                if (target.stats?.hp) target.stats.hp.current = hp.max;

                window.UIManager?.showText?.(`${target.name} 还剩 ${target.count} 个`, 1500);
            } else {
                // 单个 → 从地图移除
                const idx = map.entities.findIndex(e => e.id === target.id);
                if (idx > -1) map.entities.splice(idx, 1);
                window.CWNotify3D?.('entity-remove', { entityId: target.id });
            }

            // ---------- 2. 触发任务进度 ----------
            if (window.MapQuestManager?.onEnemyKilled) {
                try {
                    window.MapQuestManager.onEnemyKilled(target.name, 1);
                } catch (e) { /* 忽略 */ }
            }
            if (window.MapQuestManager?.onEnemyKilled) {
                try {
                    window.BattleManager?._onBattleEnd?.({
                        result: 'victory',
                        enemyItemName: target.name,
                    });
                } catch (e) { /* 忽略 */ }
            }

            // ---------- 3. 重绘 + 存档 ----------
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            window.MapLauncher?._saveMapToWorld?.(map);
            if (window.SaveManager) window.SaveManager.save();
        },
        // ============================================================
        // 击杀奖励：金钱 / 经验 / 掉落物品
        // ============================================================
        _giveKillRewards(target, map) {
            const player = window.PlayerStateManager?.player;
            if (!player) return;

            const f = target.fields || {};

            // ---------- 1. 金钱 ----------
            const money = parseInt(f['金钱']) || 0;
            if (money > 0) {
                this._addExtraStat(player, '金钱', money);
            }

            // ---------- 2. 经验 ----------
            const exp = parseInt(f['经验']) || 0;
            if (exp > 0) {
                this._addExtraStat(player, '经验', exp);
            }

            // ---------- 3. 掉落物品 ----------
            const dropStr = String(f['掉落'] || '').trim();

            const obtained = [];
            const rewardTable = map.itemTable || {};

            if (dropStr) {
                const dropItems = dropStr.split(/[、,，]/).map(s => s.trim()).filter(Boolean);

                for (const entry of dropItems) {
                    const m = entry.match(/^(.+?)\s*[×xX*]\s*(\d+)\s*$/);
                    const itemName = m ? m[1].trim() : entry;
                    const count = m ? parseInt(m[2]) : 1;

                    const def = this._findItemDef(map, itemName);

                    if (def) {
                        this._addItemToInventory(player, {
                            name: def.name,
                            icon: def.emoji || '📦',
                            description: def.description || '',
                            fields: def.fields || {},
                            interactions: def.interactions || [],
                            status: def.status || '',
                            effect: def.effect || '',
                            stackable: def.stackable,
                            maxStack: def.maxStack,
                            type: def.type || 'item',
                            count: count,
                        });
                        obtained.push(`${def.emoji || '📦'} ${def.name} ×${count}`);
                    } else {
                        // 奖励表没找到 → 空壳兜底
                        this._addItemToInventory(player, {
                            name: itemName,
                            icon: '📦',
                            description: '',
                            fields: {},
                            interactions: [],
                            status: '',
                            effect: '',
                            stackable: true,
                            maxStack: 99,
                            type: '物品',
                            count: count,
                        });
                        obtained.push(`📦 ${itemName} ×${count}`);
                        console.warn(`[CombatResolver] 奖励表里没找到 "${itemName}"，用了空壳`);
                    }
                }
            }

            // ---------- 4. UI 提示 ----------
            const messages = [];
            if (money > 0) messages.push(`💰 金钱 +${money}`);
            if (exp > 0) messages.push(`⭐ 经验 +${exp}`);
            if (obtained.length > 0) messages.push(`📦 获得：\n${obtained.join('\n')}`);

            if (messages.length > 0) {
                window.UIManager?.showText?.(
                    `击败 ${target.name}\n${messages.join('\n')}`,
                    3000
                );
            }

            window.PlayerStateManager?.refreshAvatarArea?.();
        },
        _findItemDef(map, nameOrId) {
            if (!map?.itemTable) return null;
            // 按 id
            if (map.itemTable[nameOrId]) return map.itemTable[nameOrId];
            // 按名字
            for (const entry of Object.values(map.itemTable)) {
                if (entry.name === nameOrId) return entry;
            }
            return null;
        },
        _addExtraStat(player, key, delta) {
            if (window.MapQuestManager?._applyNumberReward) {
                window.MapQuestManager._applyNumberReward(key, delta);
                return;
            }
            player.extraStats = player.extraStats || { _order: [], _raw: '' };
            const extra = player.extraStats;
            if (extra[key] === undefined) {
                if (!extra._order.includes(key)) extra._order.push(key);
                extra[key] = String(delta);
            } else {
                const raw = String(extra[key]);
                const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                if (m) {
                    const cur = parseFloat(m[1]);
                    extra[key] = `${cur + delta}${m[2] || ''}`;
                } else {
                    extra[key] = String(delta);
                }
            }
        },

        _addItemToInventory(player, item) {
            player.inventory = player.inventory || [];
            const existing = player.inventory.find(i => i.name === item.name);

            if (existing && item.stackable) {
                existing.count = (existing.count || 1) + (item.count || 1);
                return;
            }

            const slots = player.inventorySlots || 40;
            if (player.inventory.length >= slots) {
                window.UIManager?.showText?.('⚠️ 背包已满，部分奖励丢失', 2000);
                return;
            }

            player.inventory.push({
                name: item.name,
                count: item.count || 1,
                icon: item.icon || '📦',
                description: item.description || '',
                fields: item.fields || {},
                interactions: item.interactions || [],
                status: item.status || '',
                effect: item.effect || '',
                stackable: item.stackable === true,
                maxStack: item.maxStack || null,
                type: item.type || 'item',
            });
        },
        // ============================================================
        // 标记敌人进入战斗（AI 会读这个标记）
        // ============================================================
        _markEnemyAggro(target) {
            target.meta = target.meta || {};
            target.meta._combatAggro = true;
            target.meta._combatAggroAt = Date.now();

            // 通知 AI 模块
            window.CombatAI?.onEnemyAggro?.(target);
        },

        // ============================================================
        // 特效
        // ============================================================
        _playAttackEffect(player, facing, combatData, targets) {
            // 近战：玩家抖动一下
            if (combatData.type === '近战') {
                const sel = '.cw-map-canvas-container, #cw-map-canvas';
                window.BattleEffectManager?.shake?.(sel, 'light');
            }

            // 远程：画射线
            if (combatData.type === '远程' && targets.cells.length > 0) {
                window.CombatRender?.drawProjectile?.(
                    player, facing, targets.cells
                );
            }
        },

        _playMissEffect(player, combatData) {
            // 空挥
            if (combatData.type === '近战') {
                window.CombatRender?.flashMeleeMiss?.(player);
            }
        },

        _log(text) {
            console.log('[CombatResolver]', text);
        },
    };

    window.CombatResolver = CombatResolver;
    console.log('[CinemaWorld] combat-resolver.js 已加载');
})();