// ============================================================
// CinemaWorld · combat-ai.js
// 即时战斗 · 敌人 AI
//   - 索敌：玩家/队友靠近 or 被打 → aggro
//   - 追击：朝目标移动
//   - 攻击：按自己的 CD 打目标
//   - 放弃：目标跑远 → 冷却，之后可重新 aggro
//
// 依赖：CombatWeapon, CombatResolver, MapCanvas
// 暴露：window.CombatAI
// ============================================================

(function () {
    'use strict';

    const CombatAI = {
        _running: false,
        _lastTick: 0,
        _cooldowns: {},
        _aggroCooldowns: {},

        CONFIG: {
            detectRadius: 4,
            abandonRadius: 12,
            abandonCooldown: 3000,
            moveCooldown: 600,
            fleeCooldown: 800,
        },

        init() {
            if (this._running) return;
            this._running = true;
            this._lastTick = performance.now();
            this._loop();
            console.log('[CombatAI] 已启动');
        },

        _loop() {
            if (!this._running) return;

            const now = performance.now();
            const dt = Math.min(100, now - this._lastTick);
            this._lastTick = now;

            try {
                this._tick(dt);
            } catch (e) {
                console.error('[CombatAI] tick 异常:', e);
            }

            requestAnimationFrame(() => this._loop());
        },

        // ============================================================
        // 主循环
        // ============================================================
        _tick(dt) {
            const playMode = window.CinemaWorld?.worldState?.playMode;
            if (playMode !== 'map') return;

            const combatMode = window.CinemaWorld?.worldState?.settings?.combatMode;
            if (combatMode !== 'realtime') return;

            if (window.CinemaWorld?.ui?.modalOpen) return;

            const map = window.MapLauncher?.getMap?.();
            const player = window.MapCanvas?.player;
            if (!map || !player) return;

            for (const key of Object.keys(this._cooldowns)) {
                if (this._cooldowns[key] > 0) {
                    this._cooldowns[key] = Math.max(0, this._cooldowns[key] - dt);
                }
            }
            for (const key of Object.keys(this._aggroCooldowns)) {
                if (this._aggroCooldowns[key] > 0) {
                    this._aggroCooldowns[key] = Math.max(0, this._aggroCooldowns[key] - dt);
                }
            }

            for (const ent of map.entities) {
                if (ent.kind !== 'encounter') continue;
                if (!ent._placed) continue;
                if (this._isDead(ent)) continue;

                const dist = Math.abs(ent.x - player.x) + Math.abs(ent.y - player.y);
                const attackCd = this._cooldowns[ent.id] || 0;
                const aggroCd = this._aggroCooldowns[ent.id] || 0;

                // 未 aggro：检查是否主动发现玩家
                if (!ent.meta?._combatAggro) {
                    if (aggroCd > 0) continue;

                    if (dist <= this.CONFIG.detectRadius) {
                        ent.meta = ent.meta || {};
                        ent.meta._combatAggro = true;
                        ent.meta._combatAggroAt = Date.now();
                        console.log(`[CombatAI] ${ent.name} 发现玩家，进入战斗`);
                    }
                    continue;
                }

                // 已 aggro：检查是否放弃
                if (dist > this.CONFIG.abandonRadius) {
                    ent.meta._combatAggro = false;
                    this._aggroCooldowns[ent.id] = this.CONFIG.abandonCooldown;
                    console.log(`[CombatAI] ${ent.name} 玩家跑远，进入冷却`);
                    continue;
                }

                if (attackCd > 0) continue;

                const interval = this._getAttackInterval(ent);
                const combat = ent.combat || this._parseEnemyCombat(ent);
                const maxRange = combat.range.max;
                const minRange = combat.range.min;

                // ★ 选目标：记仇的队友 → 比玩家近的队友 → 玩家
                const target = this._pickCombatTarget(ent, map, player);
                const targetDist = Math.abs(ent.x - target.x) + Math.abs(ent.y - target.y);

                // ---------- 近战 ----------
                if (combat.type === '近战') {
                    if (targetDist <= maxRange) {
                        this._enemyAttack(ent, target, map);
                        this._cooldowns[ent.id] = interval;
                    } else {
                        const moved = this._stepToward(ent, target, map);
                        if (moved) this._cooldowns[ent.id] = this.CONFIG.moveCooldown;
                    }
                    continue;
                }

                // ---------- 远程 ----------
                if (targetDist <= maxRange && targetDist >= minRange) {
                    this._enemyAttack(ent, target, map);
                    this._cooldowns[ent.id] = interval;
                }
                else if (targetDist < minRange) {
                    const fled = this._stepAway(ent, target, map);
                    if (fled) this._cooldowns[ent.id] = this.CONFIG.fleeCooldown;
                }
                else {
                    const moved = this._stepToward(ent, target, map);
                    if (moved) this._cooldowns[ent.id] = this.CONFIG.moveCooldown;
                }
            }
        },

        // ============================================================
        // 选目标
        // ============================================================
        _pickCombatTarget(enemy, map, player) {
            // 1. 记仇目标
            if (enemy.meta?._combatTargetId) {
                const t = map.entities.find(e => e.id === enemy.meta._combatTargetId);
                if (t && t._placed && !this._isTargetDead(t)) return t;
                delete enemy.meta._combatTargetId;
            }

            // 2. 最近的队友（比玩家近 2 格以上才优先）
            let best = player;
            let bestDist = Math.abs(enemy.x - player.x) + Math.abs(enemy.y - player.y);

            for (const e of map.entities) {
                if (!e.isCompanion || !e._placed) continue;
                if (this._isTargetDead(e)) continue;

                const d = Math.abs(enemy.x - e.x) + Math.abs(enemy.y - e.y);
                if (d < bestDist - 2) {
                    bestDist = d;
                    best = e;
                }
            }
            return best;
        },

        _isTargetDead(ent) {
            if (ent.isCompanion) {
                const hp = window.CompanionCombatAI?.getCompanionHp?.(ent);
                return !hp || hp.current <= 0;
            }
            return this._isDead(ent);
        },

        // ============================================================
        // 敌人攻击
        // ============================================================
        _enemyAttack(ent, target, map) {
            const combat = ent.combat || this._parseEnemyCombat(ent);
            const dist = Math.abs(ent.x - target.x) + Math.abs(ent.y - target.y);

            if (dist > combat.range.max) return;

            // ★★★ 目标是队友 ★★★
            if (target.isCompanion) {
                this._enemyAttackCompanion(ent, target, combat, map);
                return;
            }

            // ---------- 打玩家 ----------
            const enemyStats = this._buildEnemyStats(ent);
            const playerStats = this._buildPlayerStats();

            const hit = this._rollHit(enemyStats, playerStats);
            if (!hit) {
                window.CombatRender?.popupAt?.(target.x, target.y, 'MISS', 'miss');
                return;
            }

            const isCrit = Math.random() < (enemyStats.critRate || 0);

            let dmg = Math.max(1, Math.round(
                (enemyStats.attack || 10) - (playerStats.defense || 0)
            ));
            if (isCrit) dmg = Math.round(dmg * 1.5);

            this._damagePlayer(target, dmg);

            window.CombatRender?.popupAt?.(
                target.x, target.y,
                `-${dmg}`,
                isCrit ? 'crit' : 'damage'
            );

            if (combat.type === '远程' && window.CombatRender?.drawProjectile) {
                const cells = this._lineCells(ent.x, ent.y, target.x, target.y);
                window.CombatRender.drawProjectile(
                    { x: ent.x, y: ent.y },
                    this._dirFromTo(ent.x, ent.y, target.x, target.y),
                    cells
                );
            }

            window.BattleEffectManager?.shake?.('.cw-map-canvas-container', 'light');

            console.log(`[CombatAI] ${ent.name} 对玩家造成 ${dmg} 伤害（${combat.type}）`);
        },

        // ============================================================
        // 敌人攻击队友
        // ============================================================
        _enemyAttackCompanion(enemy, comp, combat, map) {
            const hp = window.CompanionCombatAI?.getCompanionHp?.(comp);
            if (!hp || hp.current <= 0) return;

            const enemyStats = this._buildEnemyStats(enemy);
            const name = comp.meta?.companionName;
            const compData = window.CompanionEquipmentManager?.deriveCombatData?.(name);
            if (!compData) return;

            const compStats = {
                name: comp.name,
                attack: compData.attack,
                defense: compData.defense,
                speed: compData.speed,
                critRate: compData.critRate || 0.05,
                critDamage: compData.critDamage || 1.5,
                extra: {},
            };

            const hit = this._rollHit(enemyStats, compStats);
            if (!hit) {
                window.CombatRender?.popupAt?.(comp.x, comp.y, 'MISS', 'miss');
                return;
            }

            const isCrit = Math.random() < (enemyStats.critRate || 0);
            let dmg = Math.max(1, Math.round((enemyStats.attack || 10) - (compData.defense || 0)));
            if (isCrit) dmg = Math.round(dmg * 1.5);

            // ★ 传 enemy 作为 attacker → 触发队友反击逻辑
            window.CompanionCombatAI.applyDamageToCompanion(comp, dmg, map, enemy);

            if (combat.type === '远程' && window.CombatRender?.drawProjectile) {
                const cells = this._lineCells(enemy.x, enemy.y, comp.x, comp.y);
                window.CombatRender.drawProjectile(
                    { x: enemy.x, y: enemy.y },
                    this._dirFromTo(enemy.x, enemy.y, comp.x, comp.y),
                    cells
                );
            }

            window.BattleEffectManager?.shake?.('.cw-map-canvas-container', 'light');

            console.log(`[CombatAI] ${enemy.name} → ${comp.name} ${dmg}${isCrit ? '(暴击)' : ''}`);
        },

        // ============================================================
        // 由 CombatResolver 调用：被打 → 进入战斗
        // ============================================================
        onEnemyAggro(ent) {
            if (!ent) return;
            ent.meta = ent.meta || {};
            ent.meta._combatAggro = true;
            ent.meta._combatAggroAt = Date.now();
            delete this._aggroCooldowns[ent.id];
            console.log(`[CombatAI] ${ent.name} 进入战斗`);
        },

        // ============================================================
        // 移动
        // ============================================================
        _stepToward(ent, target, map) {
            const dx = target.x - ent.x;
            const dy = target.y - ent.y;

            const moves = [];
            if (Math.abs(dx) >= Math.abs(dy)) {
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
            } else {
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
            }
            if (dx !== 0 && dy !== 0) moves.push([Math.sign(dx), Math.sign(dy)]);

            const grid = map._generated?.grid;
            if (!grid) return false;

            for (const [mx, my] of moves) {
                const nx = ent.x + mx;
                const ny = ent.y + my;

                if (nx < 0 || nx >= grid[0].length) continue;
                if (ny < 0 || ny >= grid.length) continue;

                const cell = grid[ny][nx];
                if (!cell || !cell.walkable) continue;
                if (cell.terrain === 'void') continue;

                const blocked = map.entities.some(e =>
                    e !== ent && e._placed && e.x === nx && e.y === ny &&
                    e.blocking && !e.isPlayer
                );
                if (blocked) continue;

                if (window.MapCanvas?.startVisualMove) {
                    window.MapCanvas.startVisualMove(
                        ent,
                        ent._visualX ?? ent.x,
                        ent._visualY ?? ent.y,
                        nx, ny
                    );
                }
                ent.x = nx;
                ent.y = ny;
                if (window.MapCanvas3D?._running) {
                    window.MapCanvas3D.syncEntity(ent);
                }
                return true;
            }

            return false;
        },

        _stepAway(ent, target, map) {
            const dx = ent.x - target.x;
            const dy = ent.y - target.y;

            const moves = [];
            if (Math.abs(dx) >= Math.abs(dy)) {
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
            } else {
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
            }

            const grid = map._generated?.grid;
            if (!grid) return false;

            for (const [mx, my] of moves) {
                const nx = ent.x + mx;
                const ny = ent.y + my;

                if (nx < 0 || nx >= grid[0].length) continue;
                if (ny < 0 || ny >= grid.length) continue;

                const cell = grid[ny][nx];
                if (!cell || !cell.walkable) continue;
                if (cell.terrain === 'void') continue;

                const blocked = map.entities.some(e =>
                    e !== ent && e._placed && e.x === nx && e.y === ny && e.blocking
                );
                if (blocked) continue;

                if (window.MapCanvas?.startVisualMove) {
                    window.MapCanvas.startVisualMove(
                        ent,
                        ent._visualX ?? ent.x,
                        ent._visualY ?? ent.y,
                        nx, ny
                    );
                }
                ent.x = nx;
                ent.y = ny;
                if (window.MapCanvas3D?._running) {
                    window.MapCanvas3D.syncEntity(ent);
                }
                return true;
            }
            return false;
        },

        // ============================================================
        // 射线工具
        // ============================================================
        _lineCells(x1, y1, x2, y2) {
            const cells = [];
            const dx = Math.abs(x2 - x1);
            const dy = Math.abs(y2 - y1);
            const sx = x1 < x2 ? 1 : -1;
            const sy = y1 < y2 ? 1 : -1;
            let err = dx - dy;
            let x = x1, y = y1;
            let guard = 0;

            while (guard++ < 100) {
                if (x !== x1 || y !== y1) cells.push({ x, y });
                if (x === x2 && y === y2) break;
                const e2 = 2 * err;
                if (e2 > -dy) { err -= dy; x += sx; }
                if (e2 < dx) { err += dx; y += sy; }
            }
            return cells;
        },

        _dirFromTo(x1, y1, x2, y2) {
            const dx = x2 - x1;
            const dy = y2 - y1;
            if (Math.abs(dx) >= Math.abs(dy)) {
                return dx > 0 ? 'right' : 'left';
            }
            return dy > 0 ? 'down' : 'up';
        },

        // ============================================================
        // 玩家受伤
        // ============================================================
        _damagePlayer(player, dmg) {
            const ps = window.PlayerStateManager?.player;
            if (!ps) return;

            const hpBar = (ps.statusBars || []).find(b => /生命|血量|HP/i.test(b.key));
            if (hpBar) {
                hpBar.current = Math.max(0, hpBar.current - dmg);
            }

            window.PlayerStateManager.refreshAvatarArea();

            if (hpBar && hpBar.current <= 0) {
                this._onPlayerDeath();
            }
        },

        _onPlayerDeath() {
            console.log('[CombatAI] 玩家倒下');
            window.UIManager?.showText?.('💀 你倒下了...', 3000);
            window.CombatState?.exitAimed?.();
        },

        // ============================================================
        // 属性构建
        // ============================================================
        _buildEnemyStats(ent) {
            const f = ent.fields || {};

            let hp = { current: 100, max: 100 };
            const hpStr = String(f['HP'] || f['生命'] || f['生命值'] || '').trim();
            const m = hpStr.match(/^(\d+)\s*\/\s*(\d+)$/);
            if (m) {
                hp = { current: parseInt(m[1]), max: parseInt(m[2]) };
            } else if (hpStr) {
                const n = parseInt(hpStr.replace(/[^\d]/g, ''));
                if (!isNaN(n) && n > 0) hp = { current: n, max: n };
            }

            const attack = parseInt(f['攻击'] || f['攻击力'] || f['力量'] || f['攻击强度']) || 10;
            const defense = parseInt(f['防御'] || f['防御力'] || f['护甲'] || f['体质']) || 5;
            const speed = parseInt(f['敏捷'] || f['速度'] || f['先攻'] || f['闪避']) || 10;

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

            const base = {
                name: ent.name,
                hp,
                attack,
                defense,
                speed,
                critRate: 0,
                critDamage: 1.5,
                extra,
            };

            let result = base;
            if (window.TagEffectManager?.applyAttributeModifiers) {
                try {
                    result = window.TagEffectManager.applyAttributeModifiers(base, ent.statusTags || []);
                } catch (e) { /* 忽略 */ }
            }

            result.extra = { ...extra };
            for (const [k, v] of Object.entries(result)) {
                if (!['name', 'hp', 'attack', 'defense', 'speed', 'critRate', 'critDamage', 'extra'].includes(k)) {
                    result.extra[k] = v;
                }
            }

            return result;
        },

        _buildPlayerStats() {
            if (window.BattleManager?.getPlayerStats) {
                try {
                    return window.BattleManager.getPlayerStats();
                } catch (e) { /* 兜底 */ }
            }
            const ps = window.PlayerStateManager?.player;
            const bonuses = ps?.equipment?.bonuses || {};
            return {
                attack: 10,
                defense: (bonuses['防御'] || 0) + 5,
                speed: 10,
                critRate: 0,
                critDamage: 1.5,
            };
        },

        _parseEnemyCombat(ent) {
            if (!ent) return null;

            if (ent.combat && ent.combat.type) return ent.combat;

            const f = ent.fields || {};
            const fieldAttackType = f['攻击方式'];
            const fieldAttackRange = f['攻击距离'];
            const fieldAttackInterval = f['攻击间隔'];
            const fieldTwoHanded = f['占用双手'];

            if (fieldAttackType || fieldAttackRange || fieldAttackInterval) {
                const text = [
                    fieldAttackType ? `攻击方式:${fieldAttackType}` : '',
                    fieldAttackRange ? `攻击距离:${fieldAttackRange}` : '',
                    fieldAttackInterval ? `攻击间隔:${fieldAttackInterval}` : '',
                    fieldTwoHanded ? `占用双手:${fieldTwoHanded}` : '',
                ].filter(Boolean).join('|');

                if (window.CombatWeapon?.parseCombatFields) {
                    const parsed = window.CombatWeapon.parseCombatFields(text);
                    if (parsed) {
                        ent.combat = parsed;
                        return parsed;
                    }
                }
            }

            if (ent._rawLine && window.CombatWeapon?.extractSecondBracket) {
                const text = window.CombatWeapon.extractSecondBracket(ent._rawLine);
                if (text) {
                    const parsed = window.CombatWeapon.parseCombatFields(text);
                    if (parsed) {
                        ent.combat = parsed;
                        return parsed;
                    }
                }
            }

            const guessed = this._guessEnemyCombat(ent);
            ent.combat = guessed;
            return guessed;
        },

        _guessEnemyCombat(ent) {
            const text = [
                ent.name || '',
                ent.description || '',
                ent.status || '',
                ent.effect || '',
                (ent.tags || []).join(' '),
                ...(Object.values(ent.fields || {}).map(v => String(v))),
            ].join(' ');

            const isRanged = /弓|枪|弩|炮|法|术|射|箭|远程|投掷|法术|咒|火球|冰锥|毒液喷/.test(text);
            const isMelee = /爪|牙|咬|拳|近战|刀|剑|斧|锤|棍|棒|触手|撕|扑/.test(text);

            let type = '近战';
            if (isRanged && !isMelee) type = '远程';
            else if (isRanged && isMelee) type = '远程';

            let range = type === '近战' ? { min: 1, max: 1 } : { min: 2, max: 8 };

            let interval = 1500;
            if (/鼠|兔|猫|蝠|蜂|蚊|虫|小妖|小怪|幼/.test(text)) interval = 1000;
            else if (/精英|强|猛|凶|狂|暴/.test(text)) interval = 1200;
            else if (/巨|大|王|龙|Boss|boss|领主|首脑|魔|神/.test(text)) interval = 2200;

            const speed = parseInt((ent.fields || {})['敏捷']) || 0;
            if (speed > 15) interval = Math.round(interval * 0.8);
            else if (speed > 10) interval = Math.round(interval * 0.9);
            else if (speed < 5) interval = Math.round(interval * 1.2);

            return {
                type,
                range,
                interval,
                twoHanded: false,
                dualWield: false,
                _guessed: true,
            };
        },

        _getAttackRange(ent) {
            const combat = ent.combat || this._parseEnemyCombat(ent);
            return combat?.range?.max || 1;
        },

        _getAttackInterval(ent) {
            const combat = ent.combat || this._parseEnemyCombat(ent);
            return combat?.interval || 1500;
        },

        _rollHit(attacker, target) {
            return Math.random() < 0.85;
        },

        _isDead(ent) {
            const f = ent.fields || {};
            const hpStr = f['HP'] || f['生命'] || f['生命值'] || '100/100';
            const m = String(hpStr).match(/^(\d+)\s*\/\s*(\d+)$/);
            if (m) return parseInt(m[1]) <= 0;
            return false;
        },

        stop() {
            this._running = false;
        },

        reset() {
            this._cooldowns = {};
            this._aggroCooldowns = {};
        },
    };

    window.CombatAI = CombatAI;
    console.log('[CinemaWorld] combat-ai.js 已加载');
})();