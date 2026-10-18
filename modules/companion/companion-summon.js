// ============================================================
// CinemaWorld · companion/companion-summon.js
// 召唤：把队友实体化到地图上，跟随玩家、可装备、可收回
//
// 【功能】
//   - 召唤 / 收回
//   - 跟随玩家（普通状态）
//   - 战斗状态（锁定敌人 → 追击 → 攻击）
//   - 装备（武器槽）→ 决定战斗方式
//   - 换地图迁移
//   - 被消灭后冷却
//
// 依赖：companion-core.js, companion-ui.js,
//       map-canvas.js, map-entities.js, map-sprites.js, ui.js,
//       combat-weapon.js, combat-resolver.js, combat-render.js
// 暴露：window.CompanionSummonManager,
//       window.CompanionFollowAI,
//       window.CompanionEquipmentManager,
//       window.CompanionSummonUI,
//       window.CompanionCombatAI
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const CharacterRegistry = window.CharacterRegistry;
    const PlayerStateManager = window.PlayerStateManager;
    const CompanionManager = window.CompanionManager;
    const BondManager = window.BondManager;

    // ============================================================
    // 0. 常量
    // ============================================================
    const CONST = {
        SUMMON_COOLDOWN_MS: 24 * 60 * 60 * 1000,
        MAX_COMPANIONS_ON_MAP: 10,

        // ---------- 跟随 ----------
        FOLLOW_MAX_DISTANCE: 8,           // 普通状态：超过这个距离瞬移
        FOLLOW_KEEP_DISTANCE: 2,          // 普通状态：保持这个距离
        MOVE_INTERVAL_MS: 120,

        // ---------- 战斗 ----------
        COMBAT_TICK_MS: 300,
        DETECT_RADIUS: 5,                 // 索敌半径

        // ★ 战斗状态下的阈值
        COMBAT_FOLLOW_MAX_DISTANCE: 20,   // 战斗中允许远离玩家 20 格
        COMBAT_LEASH_DISTANCE: 15,        // 距离玩家超过 15 格 → 解除战斗，强制拉回
        COMBAT_ENGAGE_MAX_DISTANCE: 12,   // 敌人离玩家超过 12 格 → 队友也不追

        // ★ 战斗状态持续多久不战斗就自动退出（毫秒）
        COMBAT_IDLE_TIMEOUT: 5000,
    };

    // ============================================================
    // 1. 工具
    // ============================================================
    const Utils = {
        manhattan(x1, y1, x2, y2) {
            return Math.abs(x1 - x2) + Math.abs(y1 - y2);
        },

        findNearbyFree(map, px, py, occupied, maxRadius = 6) {
            if (!map?._generated?.grid) return null;
            const grid = map._generated.grid;
            const H = grid.length;
            const W = grid[0].length;

            const tryCell = (x, y) => {
                if (x < 0 || x >= W) return false;
                if (y < 0 || y >= H) return false;
                const cell = grid[y][x];
                if (!cell) return false;
                if (!cell.walkable) return false;
                if (cell.terrain === 'void') return false;
                if (cell.decor && cell.decor.type !== 'plant') return false;
                if (cell.portal) return false;
                if (occupied.has(`${x},${y}`)) return false;
                return true;
            };

            for (let r = 1; r <= maxRadius; r++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const x = px + dx;
                        const y = py + dy;
                        if (tryCell(x, y)) return { x, y };
                    }
                }
            }
            return null;
        },

        findApproachCell(map, ent, tx, ty, occupied) {
            if (!map?._generated?.grid) return null;
            const grid = map._generated.grid;
            const H = grid.length;
            const W = grid[0].length;

            const tryCell = (x, y) => {
                if (x < 0 || x >= W) return false;
                if (y < 0 || y >= H) return false;
                const cell = grid[y][x];
                if (!cell) return false;
                if (!cell.walkable) return false;
                if (cell.terrain === 'void') return false;
                if (cell.decor && cell.decor.type !== 'plant') return false;
                if (cell.portal) return false;
                if (occupied.has(`${x},${y}`)) return false;
                return true;
            };

            const candidates = [];
            for (let r = 1; r <= 4; r++) {
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const x = tx + dx;
                        const y = ty + dy;
                        if (tryCell(x, y)) {
                            const d = Utils.manhattan(ent.x, ent.y, x, y);
                            candidates.push({ x, y, d });
                        }
                    }
                }
                if (candidates.length > 0) break;
            }

            if (candidates.length === 0) return null;
            candidates.sort((a, b) => a.d - b.d);
            return candidates[0];
        },

        buildOccupied(map) {
            const set = new Set();
            for (const e of map.entities || []) {
                if (!e._placed) continue;
                if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
                if (e.kind === 'building') continue;
                set.add(`${e.x},${e.y}`);
            }
            return set;
        },
    };

    // ============================================================
    // 2. 装备管理器
    // ============================================================
    const CompanionEquipmentManager = {
        // ============================================================
        // 装备槽定义
        //   - weapon: 决定战斗方式（type / range / interval）
        //   - armor / accessory1 / accessory2: 只加属性，不影响武器行为
        // ============================================================
        SLOTS: {
            weapon: {
                label: '武器',
                emoji: '⚔️',
                // 武器槽：接受武器类
                acceptTypes: /武器|剑|刀|斧|枪|弓|杖|匕首|弩|炮/,
                // 是否影响战斗方式
                definesCombat: true,
            },
            armor: {
                label: '护甲',
                emoji: '🛡️',
                // 护甲槽：接受护甲/衣物/防具/盾/武器（武器当属性加成）
                acceptTypes: /护甲|防具|盾|甲|衣|袍|服|披风|斗篷|头盔|靴|手套|武器|剑|刀|斧|枪|弓|杖|匕首|弩|炮/,
                definesCombat: false,
            },
            accessory1: {
                label: '饰品 I',
                emoji: '💍',
                // 饰品槽：接受饰品/戒指/项链/护符/宝石/武器（武器当属性加成）
                acceptTypes: /饰品|戒|环|项链|护符|宝石|玉佩|符|铭牌|武器|剑|刀|斧|枪|弓|杖|匕首|弩|炮/,
                definesCombat: false,
            },
            accessory2: {
                label: '饰品 II',
                emoji: '📿',
                acceptTypes: /饰品|戒|环|项链|护符|宝石|玉佩|符|铭牌|武器|剑|刀|斧|枪|弓|杖|匕首|弩|炮/,
                definesCombat: false,
            },
        },

        ensureEquipment(name) {
            const bond = BondManager.getBond(name);
            if (!bond) return null;
        
            if (!bond.equipment || typeof bond.equipment !== 'object') {
                bond.equipment = {};
            }
            for (const slot of Object.keys(this.SLOTS)) {
                if (bond.equipment[slot] === undefined) {
                    bond.equipment[slot] = null;
                }
            }
            return bond.equipment;
        },
        
        getEquipment(name) {
            const bond = BondManager.getBond(name);
            if (!bond) {
                return { weapon: null, armor: null, accessory1: null, accessory2: null };
            }
            if (!bond.equipment) {
                bond.equipment = { weapon: null, armor: null, accessory1: null, accessory2: null };
            }
            return bond.equipment;
        },

        canEquip(item, slot) {
            const slotDef = this.SLOTS[slot];
            if (!slotDef) return { ok: false, message: '槽位不存在' };
            if (!item) return { ok: false, message: '物品为空' };
        
            const type = String(item.fields?.['类型'] || item.type || '');
            if (!slotDef.acceptTypes.test(type)) {
                return { ok: false, message: `${slotDef.label}槽不接受这种类型（当前：${type}）` };
            }
            return { ok: true };
        },

        equipFromInventory(name, itemIndex, slot = 'weapon') {
            const player = PlayerStateManager.player;
            const bond = BondManager.getBond(name);
            if (!player || !bond) return { ok: false, message: '数据未加载' };
        
            const item = player.inventory?.[itemIndex];
            if (!item) return { ok: false, message: '背包物品不存在' };
        
            const can = this.canEquip(item, slot);
            if (!can.ok) return can;
        
            this.ensureEquipment(name);
        
            const old = bond.equipment[slot];
            if (old) this._returnToInventory(old);
        
            player.inventory.splice(itemIndex, 1);
        
            bond.equipment[slot] = {
                name: item.name,
                icon: item.icon || '📦',
                description: item.description || '',
                type: item.type || 'item',
                fields: JSON.parse(JSON.stringify(item.fields || {})),
                // ★ 只有武器槽保留 combat 数据（通用槽丢弃）
                combat: (slot === 'weapon' && item.combat)
                    ? JSON.parse(JSON.stringify(item.combat))
                    : null,
                stackable: false,
            };
        
            PlayerStateManager.refreshAvatarArea?.();
            CompanionManager.save();
            CompanionSummonManager.refreshEntityData(name);
        
            console.log(`[CompanionEquip] ${name} 装备了 ${item.name}（${slot}）`);
            return { ok: true, message: `${name} 装备了 ${item.icon || ''}${item.name}` };
        },
        
        unequip(name, slot = 'weapon') {
            const bond = BondManager.getBond(name);
            if (!bond) return { ok: false, message: '队友不存在' };
        
            this.ensureEquipment(name);
        
            const item = bond.equipment[slot];
            if (!item) return { ok: false, message: '该槽位没有装备' };
        
            const player = PlayerStateManager.player;
            if (player) {
                this._returnToInventory(item);
                PlayerStateManager.refreshAvatarArea?.();
            }
        
            bond.equipment[slot] = null;
            CompanionManager.save();
        
            CompanionSummonManager.refreshEntityData(name);
        
            console.log(`[CompanionEquip] ${name} 卸下了 ${item.name}（${slot}）`);
            return { ok: true, message: `已卸下 ${item.icon || ''}${item.name}` };
        },

        _returnToInventory(equipItem) {
            const player = PlayerStateManager.player;
            if (!player) return;

            if (!Array.isArray(player.inventory)) player.inventory = [];

            const restored = {
                name: equipItem.name,
                count: 1,
                icon: equipItem.icon || '📦',
                description: equipItem.description || '',
                fields: JSON.parse(JSON.stringify(equipItem.fields || {})),
                combat: equipItem.combat ? JSON.parse(JSON.stringify(equipItem.combat)) : undefined,
                type: equipItem.type || 'item',
                stackable: false,
                maxStack: null,
                interactions: [],
            };

            player.inventory.push(restored);
        },

        // ============================================================
        // 派生战斗数据
        // ============================================================
        deriveCombatData(name) {
            const bond = BondManager.getBond(name);
            if (!bond) return null;
        
            const stats = bond.stats || {};
            const getStat = (k) => Number(stats[k]?.value) || 0;
        
            const rules = window.BattleRuleManager?.getCurrent?.() || {};
            const attrMap = rules.属性映射 || {
                '攻击': '力量',
                '防御': '体质',
                '敏捷': '敏捷',
                '生命': 'HP',
            };
        
            const fallbackLevel = Math.floor(getStat('好感度') / 10) + 1;
        
            let baseAttack = getStat(attrMap['攻击']) || getStat('力量');
            let baseDefense = getStat(attrMap['防御']) || getStat('体质');
            let baseSpeed = getStat(attrMap['敏捷']) || getStat('敏捷');
            let baseHP = getStat(attrMap['生命']) || getStat('HP');
        
            if (baseAttack <= 0) baseAttack = 8 + fallbackLevel * 2;
            if (baseDefense <= 0) baseDefense = 4 + fallbackLevel;
            if (baseSpeed <= 0) baseSpeed = 8 + fallbackLevel;
            if (baseHP <= 0) baseHP = 60 + fallbackLevel * 10;
        
            const equip = this.getEquipment(name);
        
            // ============================================================
            // ★ 遍历所有槽，累加属性
            //   - weapon: 影响战斗方式 + 加属性
            //   - armor / accessory1 / accessory2: 只加属性
            // ============================================================
            let bonusAttack = 0;
            let bonusDefense = 0;
            let bonusSpeed = 0;
            let bonusHP = 0;
            let bonusCritRate = 0;
            let bonusCritDamage = 0;
        
            for (const slotKey of Object.keys(this.SLOTS)) {
                const item = equip[slotKey];
                if (!item) continue;
        
                const bonus = this._extractItemBonuses(item);
                bonusAttack += bonus.attack;
                bonusDefense += bonus.defense;
                bonusSpeed += bonus.speed;
                bonusHP += bonus.hp;
                bonusCritRate += bonus.critRate;
                bonusCritDamage += bonus.critDamage;
            }
        
            // ============================================================
            // 武器决定战斗方式
            // ============================================================
            const weapon = equip.weapon;
            let weaponCombat = null;
        
            if (weapon) {
                if (weapon.combat) {
                    weaponCombat = weapon.combat;
                } else if (window.CombatWeapon?.getCombatData) {
                    weaponCombat = window.CombatWeapon.getCombatData(weapon);
                }
            }
        
            // ---------- 空手 ----------
            if (!weapon) {
                return {
                    name: bond.name,
                    attack: baseAttack + bonusAttack,
                    defense: baseDefense + bonusDefense,
                    speed: baseSpeed + bonusSpeed,
                    hp: { current: baseHP + bonusHP, max: baseHP + bonusHP },
                    critRate: 0.05 + bonusCritRate,
                    critDamage: 1.5 + bonusCritDamage,
                    type: '近战',
                    range: { min: 1, max: 1 },
                    interval: 900,
                    weapon: null,
                    canAttack: false,
                    extra: {},
                    // ★ 装备快照（给 UI 用）
                    equipmentSnapshot: this._makeEquipmentSnapshot(equip),
                };
            }
        
            // ---------- 有武器 ----------
            const type = weaponCombat?.type || '近战';
            const range = weaponCombat?.range || { min: 1, max: 1 };
            const interval = weaponCombat?.interval || (type === '远程' ? 1200 : 800);
        
            return {
                name: bond.name,
                attack: baseAttack + bonusAttack,
                defense: baseDefense + bonusDefense,
                speed: baseSpeed + bonusSpeed,
                hp: { current: baseHP + bonusHP, max: baseHP + bonusHP },
                critRate: 0.05 + bonusCritRate,
                critDamage: 1.5 + bonusCritDamage,
                type,
                range,
                interval,
                weapon: {
                    name: weapon.name,
                    icon: weapon.icon,
                    combatType: type,
                    range,
                    interval,
                },
                canAttack: true,
                extra: {},
                equipmentSnapshot: this._makeEquipmentSnapshot(equip),
            };
        },
        
        // ============================================================
        // ★ 从单件装备提取属性加成
        //   - 优先读 fields 里的关键词（攻击/防御/敏捷/生命/暴击率/暴击伤害）
        //   - 兼容 "+5" / "5" / "5%" 各种写法
        // ============================================================
        _extractItemBonuses(item) {
            const result = {
                attack: 0,
                defense: 0,
                speed: 0,
                hp: 0,
                critRate: 0,
                critDamage: 0,
            };
            if (!item?.fields) return result;
        
            for (const [k, v] of Object.entries(item.fields)) {
                const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
                if (isNaN(n)) continue;
        
                const key = String(k);
        
                // 攻击
                if (/攻击|攻击力|力量/.test(key)) {
                    result.attack += n;
                    continue;
                }
                // 防御
                if (/防御|防御力|护甲|体质|抗性/.test(key)) {
                    result.defense += n;
                    continue;
                }
                // 敏捷 / 速度
                if (/敏捷|速度|闪避|先攻/.test(key)) {
                    result.speed += n;
                    continue;
                }
                // 生命 / HP
                if (/生命|血量|HP|气血/.test(key)) {
                    result.hp += n;
                    continue;
                }
                // 暴击率
                if (/暴击率|暴击几率|会心/.test(key)) {
                    // 百分比：5% → 0.05；数字 5 → 0.05
                    const rate = /%/.test(String(v)) ? n / 100 : (n > 1 ? n / 100 : n);
                    result.critRate += rate;
                    continue;
                }
                // 暴击伤害
                if (/暴击伤害|暴伤|会心伤害/.test(key)) {
                    // 150% → 1.5；数字 1.5 → 1.5
                    const cd = /%/.test(String(v)) ? n / 100 : n;
                    result.critDamage += (cd > 0 ? cd : 0);
                    continue;
                }
            }
        
            return result;
        },
        
        // ============================================================
        // ★ 装备快照（给 UI 显示用）
        // ============================================================
        _makeEquipmentSnapshot(equip) {
            const snapshot = {};
            for (const slotKey of Object.keys(this.SLOTS)) {
                const item = equip[slotKey];
                snapshot[slotKey] = item ? {
                    name: item.name,
                    icon: item.icon || '📦',
                    type: item.type || '',
                    fields: item.fields || {},
                } : null;
            }
            return snapshot;
        },

        canAttack(name) {
            const equip = this.getEquipment(name);
            return !!equip.weapon;
        },
    };

    // ============================================================
    // 3. 主管理器：召唤 / 收回 / 迁移
    // ============================================================
    const CompanionSummonManager = {
        _tickTimer: null,

        init() {
            window.addEventListener('cw:map-opened', () => this.onMapChanged());
            this._startLoop();
            console.log('[CompanionSummon] 已初始化');
        },

        _startLoop() {
            if (this._tickTimer) return;

            let lastFollow = 0;
            let lastCombat = 0;

            const loop = () => {
                const now = performance.now();

                if (now - lastFollow >= CONST.MOVE_INTERVAL_MS) {
                    lastFollow = now;
                    try { window.CompanionFollowAI?.tick?.(); } catch (e) { /* 忽略 */ }
                }

                if (now - lastCombat >= CONST.COMBAT_TICK_MS) {
                    lastCombat = now;
                    try { window.CompanionCombatAI?.tick?.(); } catch (e) { /* 忽略 */ }
                }

                this._tickTimer = requestAnimationFrame(loop);
            };

            this._tickTimer = requestAnimationFrame(loop);
        },

        canSummon(name) {
            const norm = CharacterRegistry.normalizeName(name);
            const bond = BondManager.getBond(norm);
        
            if (!bond) {
                return { ok: false, reason: 'no_bond', message: '队友不存在' };
            }
        
            if (bond.summon?.cooldownUntil && bond.summon.cooldownUntil > Date.now()) {
                const remain = bond.summon.cooldownUntil - Date.now();
                return {
                    ok: false,
                    reason: 'cooldown',
                    remain,
                    message: `冷却中（剩余 ${this._formatRemain(remain)}）`,
                };
            }
        
            const playMode = CinemaWorld.worldState?.playMode;
            if (playMode !== 'map') {
                return { ok: false, reason: 'not_map', message: '请先进入地图' };
            }
        
            const map = window.MapLauncher?.getMap?.();
            if (!map) {
                return { ok: false, reason: 'no_map', message: '地图未加载' };
            }
        
            // ★ active 且 mapName 是当前地图 → 已在地图上
            if (bond.summon?.active && bond.summon.mapName === map.name) {
                return { ok: false, reason: 'already_summoned', message: '已经在地图上了' };
            }
        
            const existing = map.entities.find(e =>
                !e.isPlayer &&
                CharacterRegistry.normalizeName(e.name) === norm
            );
            if (existing) {
                return { ok: true, reason: 'existing', existing };
            }
        
            const onMapCount = CompanionManager.getAll().filter(b =>
                b.summon?.active && b.summon?.mapName === map.name
            ).length;
            if (onMapCount >= CONST.MAX_COMPANIONS_ON_MAP) {
                return { ok: false, reason: 'too_many', message: `地图上最多 ${CONST.MAX_COMPANIONS_ON_MAP} 个队友` };
            }
        
            return { ok: true };
        },

        async summon(name) {
            const norm = CharacterRegistry.normalizeName(name);
            const check = this.canSummon(norm);
        
            if (!check.ok) {
                window.UIManager?.showText?.(check.message || '无法召唤', 2000);
                return false;
            }
        
            const map = window.MapLauncher?.getMap?.();
            const canvas = window.MapCanvas;
            if (!map || !canvas?.player) return false;
        
            if (check.reason === 'existing') {
                return this._adoptExisting(check.existing, norm);
            }
        
            const bond = BondManager.getBond(norm);
            const ent = this._buildEntity(bond);
        
            const occupied = Utils.buildOccupied(map);
            const pos = Utils.findNearbyFree(map, canvas.player.x, canvas.player.y, occupied);
            if (!pos) {
                window.UIManager?.showText?.('玩家附近没有空位', 2000);
                return false;
            }
        
            ent.x = pos.x;
            ent.y = pos.y;
            ent._placed = true;
            ent._visualX = pos.x;
            ent._visualY = pos.y;
        
            map.entities.push(ent);
        
            bond.summon = bond.summon || {};
            bond.summon.active = true;
            bond.summon.mapName = map.name;   // ★ 当前地图
            bond.summon.entityId = ent.id;
            bond.summon.lastSummonedAt = Date.now();
        
            CompanionManager.save();
        
            window.CWNotify3D?.('entity-add');
            if (canvas.canvas) canvas._render();
        
            window.UIManager?.showText?.(`🎯 ${bond.name} 已加入战场`, 2000);
            console.log(`[CompanionSummon] ${bond.name} 召唤到地图 ${map.name} @(${pos.x},${pos.y})`);
        
            return true;
        },

        _adoptExisting(existing, norm) {
            const bond = BondManager.getBond(norm);
            if (!bond) return false;

            const map = window.MapLauncher?.getMap?.();
            if (!map) return false;

            if (existing.isCompanion && existing.kind === 'companion') {
                bond.summon = bond.summon || {};
                bond.summon.active = true;
                bond.summon.mapName = map.name;
                bond.summon.entityId = existing.id;

                CompanionManager.save();
                window.UIManager?.showText?.(`🎯 ${bond.name} 已在地图上（跟随中）`, 2000);
                return true;
            }

            existing.isCompanion = true;
            existing.kind = 'companion';
            existing._companionName = norm;
            existing.blocking = false;
            existing.meta = existing.meta || {};
            existing.meta.companionName = norm;
            existing._combat = { lastAttackAt: 0, targetId: null };
            existing._combatState = null;
            existing.tags = [...(existing.tags || []), '队友'];

            bond.summon = bond.summon || {};
            bond.summon.active = true;
            bond.summon.mapName = map.name;
            bond.summon.entityId = existing.id;
            bond.summon.lastSummonedAt = Date.now();

            CompanionManager.save();

            window.CWNotify3D?.('entity-update', { entityId: existing.id });
            if (window.MapCanvas?.canvas) window.MapCanvas._render();

            window.UIManager?.showText?.(`🎯 ${bond.name} 加入了队伍（原有 NPC 转化）`, 2000);
            return true;
        },

        _buildEntity(bond) {
            const norm = bond._normalizedName;
            const p = bond.profile || {};

            return {
                id: `companion_${norm}_${Date.now()}`,
                name: bond.name,
                emoji: '🤝',
                kind: 'companion',
                isCompanion: true,
                _companionName: norm,
                region: null,
                position: 'center',
                blocking: false,
                isPlayer: false,
                tags: ['队友'],
                description: p.background || '',
                meta: {
                    companionName: norm,
                    gender: p.gender || '',
                    mood: p.mood || '',
                },
                status: '',
                effect: '',
                fields: {
                    '类型': '队友',
                },
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1,
                countMode: 'single',
                stackable: false,
                maxStack: null,
                type: 'companion',

                _combat: {
                    lastAttackAt: 0,
                    targetId: null,
                },
                // ★ 战斗状态
                _combatState: null,

                _visualX: null,
                _visualY: null,
                _visualFromX: null,
                _visualFromY: null,
                _visualToX: null,
                _visualToY: null,
                _visualStartTime: 0,
                _lastMoveAt: 0,
            };
        },

        recall(name) {
            const norm = CharacterRegistry.normalizeName(name);
            const bond = BondManager.getBond(norm);
            if (!bond) return false;
        
            // ★ 遍历所有地图，删掉该队友的实体
            const ws = CinemaWorld.worldState;
            let removed = 0;
            for (const [mapName, mapData] of Object.entries(ws.maps || {})) {
                if (!Array.isArray(mapData.entities)) continue;
                const before = mapData.entities.length;
                mapData.entities = mapData.entities.filter(e => {
                    if (e.kind !== 'companion') return true;
                    const n = e._companionName
                        || CharacterRegistry.normalizeName(e.name);
                    return n !== norm;
                });
                removed += before - mapData.entities.length;
            }
        
            // ★ 如果当前地图也开着，同步一下
            const currentMap = window.MapLauncher?.getMap?.();
            if (currentMap) {
                const before = currentMap.entities.length;
                currentMap.entities = currentMap.entities.filter(e => {
                    if (e.kind !== 'companion') return true;
                    const n = e._companionName
                        || CharacterRegistry.normalizeName(e.name);
                    return n !== norm;
                });
                if (currentMap.entities.length !== before) {
                    removed += before - currentMap.entities.length;
                }
            }
        
            bond.summon = bond.summon || {};
            bond.summon.active = false;
            bond.summon.entityId = null;
            bond.summon.mapName = null;
        
            CompanionManager.save();
        
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            window.CWNotify3D?.('entity-remove');
        
            window.UIManager?.showText?.(`📦 ${bond.name} 已收回`, 2000);
            console.log(`[CompanionSummon] ${bond.name} 已收回，清理 ${removed} 个实体`);
            return true;
        },

        isOnMap(name) {
            const norm = CharacterRegistry.normalizeName(name);
            const bond = BondManager.getBond(norm);
            if (!bond?.summon?.active) return false;

            const map = window.MapLauncher?.getMap?.();
            if (!map) return false;

            if (bond.summon.mapName !== map.name) return false;

            return !!map.entities.find(e => e.id === bond.summon.entityId);
        },

        getCompanionEntity(name) {
            const norm = CharacterRegistry.normalizeName(name);
            const bond = BondManager.getBond(norm);
            if (!bond?.summon?.active) return null;

            const map = window.MapLauncher?.getMap?.();
            if (!map) return null;

            return map.entities.find(e => e.id === bond.summon.entityId) || null;
        },

        refreshEntityData(name) {
            const ent = this.getCompanionEntity(name);
            if (!ent) return;

            const bond = BondManager.getBond(name);
            if (!bond) return;

            ent.meta = ent.meta || {};
            ent.meta.gender = bond.profile?.gender || '';
            ent.meta.mood = bond.profile?.mood || '';
            ent.description = bond.profile?.background || '';

            if (ent._combatHp) {
                const data = CompanionEquipmentManager.deriveCombatData(name);
                if (data) {
                    const oldMax = ent._combatHp.max;
                    ent._combatHp.max = data.hp.max;
                    if (oldMax !== data.hp.max) {
                        ent._combatHp.current = Math.min(
                            ent._combatHp.current, data.hp.max
                        );
                    }
                }
            }

            window.CWNotify3D?.('entity-update', { entityId: ent.id });
        },

        onMapChanged() {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;
        
            const ws = CinemaWorld.worldState;
            const mapName = map.name;
        
            // ============================================================
            // ★ 1. 收集所有召唤中的队友
            // ============================================================
            const activeBonds = CompanionManager.getAll().filter(b =>
                b.summon?.active === true
            );
        
            // ============================================================
            // ★ 2. 把它们的 mapName 全部改成新地图
            //    （不管之前在哪个地图，都跟着玩家过来）
            // ============================================================
            for (const bond of activeBonds) {
                if (bond.summon.mapName !== mapName) {
                    console.log(
                        `[CompanionSummon] ${bond.name} 跟随玩家：` +
                        `${bond.summon.mapName || '(无)'} → ${mapName}`
                    );
                    bond.summon.mapName = mapName;
                    bond.summon.entityId = null;   // 待重建
                }
            }
        
            // ============================================================
            // ★ 3. 从所有"非当前地图"的地图数据里，删掉这些队友实体
            // ============================================================
            const activeNorms = new Set(activeBonds.map(b => b._normalizedName));
        
            for (const [otherMapName, mapData] of Object.entries(ws.maps || {})) {
                if (otherMapName === mapName) continue;
                if (!Array.isArray(mapData.entities)) continue;
        
                const before = mapData.entities.length;
                mapData.entities = mapData.entities.filter(e => {
                    if (e.kind !== 'companion') return true;
                    const norm = e._companionName
                        || CharacterRegistry.normalizeName(e.name);
                    if (!norm) return true;
                    // 该队友现在是 active 的 → 从旧地图移除
                    if (activeNorms.has(norm)) return false;
                    return true;
                });
        
                if (mapData.entities.length !== before) {
                    console.log(
                        `  - 从【${otherMapName}】移除 ${before - mapData.entities.length} 个队友实体`
                    );
                }
            }
        
            // ============================================================
            // ★ 4. 处理当前地图上的队友实体
            // ============================================================
            for (const bond of activeBonds) {
                const norm = bond._normalizedName;
                const eid = bond.summon.entityId;
        
                // 找当前地图里的队友实体
                let ent = eid ? map.entities.find(e => e.id === eid) : null;
        
                if (!ent) {
                    // 兼容：老版本可能没写 _companionName
                    ent = map.entities.find(e =>
                        e.kind === 'companion' &&
                        (e._companionName === norm ||
                            CharacterRegistry.normalizeName(e.name) === norm)
                    );
                }
        
                if (ent) {
                    // 已有实体 → 校正字段 + 刷新 HP
                    ent._companionName = norm;
                    ent.isCompanion = true;
                    ent.kind = 'companion';
                    ent.blocking = false;
                    ent.tags = Array.isArray(ent.tags) ? ent.tags : [];
                    if (!ent.tags.includes('队友')) ent.tags.push('队友');
                    ent.meta = ent.meta || {};
                    ent.meta.companionName = norm;
        
                    // ★ HP 回满（换地图 = 休息）
                    ent._combatHp = null;
                    ent._combatState = null;
        
                    bond.summon.entityId = ent.id;
                } else {
                    // 没有实体 → 交给 syncToMap 重建
                    bond.summon.entityId = null;
                }
            }
        
            // ============================================================
            // ★ 5. 清理"未召唤"的队友实体（降级或移除）
            // ============================================================
            for (const ent of map.entities) {
                if (ent.kind !== 'companion') continue;
        
                const norm = ent._companionName
                    || CharacterRegistry.normalizeName(ent.name);
                if (!norm) continue;
        
                const bond = BondManager.getBond(norm);
                const shouldBeHere = bond?.summon?.active === true
                    && bond.summon.mapName === mapName;
        
                if (!shouldBeHere) {
                    // 队友已收回 / 不是 active → 从当前地图移除
                    const idx = map.entities.indexOf(ent);
                    if (idx > -1) {
                        map.entities.splice(idx, 1);
                        window.CWNotify3D?.('entity-remove', { entityId: ent.id });
                    }
                }
            }
        
            // ============================================================
            // ★ 6. syncToMap 补建缺失的队友实体
            // ============================================================
            CompanionManager.syncToMap(map);
        
            CompanionManager.save();
            window.CWNotify3D?.('all');
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
        
            console.log(
                `[CompanionSummon] 地图切换到 ${mapName}，` +
                `携带 ${activeBonds.length} 个队友`
            );
        },

        onCompanionDefeated(name) {
            const norm = CharacterRegistry.normalizeName(name);
            const bond = BondManager.getBond(norm);
            if (!bond) return;
        
            // ★ 遍历所有地图删实体
            const ws = CinemaWorld.worldState;
            for (const mapData of Object.values(ws.maps || {})) {
                if (!Array.isArray(mapData.entities)) continue;
                mapData.entities = mapData.entities.filter(e => {
                    if (e.kind !== 'companion') return true;
                    const n = e._companionName
                        || CharacterRegistry.normalizeName(e.name);
                    return n !== norm;
                });
            }
            const currentMap = window.MapLauncher?.getMap?.();
            if (currentMap) {
                currentMap.entities = currentMap.entities.filter(e => {
                    if (e.kind !== 'companion') return true;
                    const n = e._companionName
                        || CharacterRegistry.normalizeName(e.name);
                    return n !== norm;
                });
            }
        
            bond.summon = bond.summon || {};
            bond.summon.active = false;
            bond.summon.entityId = null;
            bond.summon.mapName = null;
            bond.summon.lastDefeatedAt = Date.now();
            bond.summon.cooldownUntil = Date.now() + CONST.SUMMON_COOLDOWN_MS;
        
            CompanionManager.save();
        
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            window.CWNotify3D?.('entity-remove');
        
            window.UIManager?.showText?.(
                `💀 ${bond.name} 被消灭，${this._formatRemain(CONST.SUMMON_COOLDOWN_MS)} 后可再次召唤`,
                3000
            );
        
            console.log(`[CompanionSummon] ${bond.name} 被消灭，进入冷却`);
        },

        _formatRemain(ms) {
            if (ms <= 0) return '0 秒';
            const sec = Math.floor(ms / 1000);
            if (sec < 60) return `${sec} 秒`;
            const min = Math.floor(sec / 60);
            if (min < 60) return `${min} 分钟`;
            const hour = Math.floor(min / 60);
            if (hour < 24) return `${hour} 小时`;
            const day = Math.floor(hour / 24);
            return `${day} 天`;
        },
    };

    // ============================================================
    // 4. 跟随 AI
    //   ★ 只处理"没有战斗状态"的队友
    //   ★ 额外：检查战斗状态的"勒绳"（玩家跑太远 → 解除战斗）
    // ============================================================
    const CompanionFollowAI = {
        tick() {
            const playMode = CinemaWorld.worldState?.playMode;
            if (playMode !== 'map') return;

            const canvas = window.MapCanvas;
            const map = window.MapLauncher?.getMap?.();
            if (!canvas?.player || !map?._generated) return;

            const modal = document.getElementById('cinemaworld-modal');
            if (modal?.classList.contains('active')) return;
            if (window.VisualNovelManager?.isPlaying) return;

            const combatMode = CinemaWorld.worldState?.settings?.combatMode;
            if (combatMode !== 'realtime' && window.BattleManager?.isActive?.()) return;

            const now = performance.now();
            const occupied = Utils.buildOccupied(map);
            const px = canvas.player.x;
            const py = canvas.player.y;

            occupied.delete(`${px},${py}`);

            for (const ent of map.entities) {
                if (!ent.isCompanion || !ent._placed) continue;

                // ★★★ 有战斗状态的队友 → 由 CombatAI 负责移动
                if (this._isInCombat(ent)) continue;

                if (now - (ent._lastMoveAt || 0) < CONST.MOVE_INTERVAL_MS) continue;

                const dist = Utils.manhattan(ent.x, ent.y, px, py);

                if (dist > CONST.FOLLOW_MAX_DISTANCE) {
                    this._teleportNear(ent, canvas.player, map, occupied);
                    ent._lastMoveAt = now;
                    continue;
                }

                if (dist <= CONST.FOLLOW_KEEP_DISTANCE) continue;

                const target = Utils.findApproachCell(map, ent, px, py, occupied);
                if (!target) continue;

                const moved = this._stepToward(ent, target.x, target.y, map, occupied);
                if (moved) ent._lastMoveAt = now;
            }

            // ★ 额外：战斗状态检查（解除/超时）
            this._checkCombatStates(map, canvas.player);
        },

        // ★ 是否处于战斗状态
        _isInCombat(ent) {
            const cs = ent._combatState;
            if (!cs || !cs.targetId) return false;

            const map = window.MapLauncher?.getMap?.();
            const target = map?.entities?.find(e => e.id === cs.targetId);

            if (!target || target._placed === false) {
                ent._combatState = null;
                return false;
            }

            // 超时无交战 → 退出
            const idleMs = performance.now() - (cs.lastEngagedAt || cs.lockedAt || 0);
            if (idleMs > CONST.COMBAT_IDLE_TIMEOUT) {
                ent._combatState = null;
                return false;
            }

            return true;
        },

        // ★ 检查所有队友的战斗状态（勒绳）
        _checkCombatStates(map, player) {
            const px = player.x;
            const py = player.y;

            for (const ent of map.entities) {
                if (!ent.isCompanion || !ent._placed) continue;

                const cs = ent._combatState;
                if (!cs) continue;

                // 目标没了 → 清
                const target = map.entities.find(e => e.id === cs.targetId);
                if (!target || target._placed === false) {
                    ent._combatState = null;
                    continue;
                }

                // ★ 玩家跑太远 → 解除战斗，强制拉回
                const distToPlayer = Utils.manhattan(ent.x, ent.y, px, py);
                if (distToPlayer > CONST.COMBAT_LEASH_DISTANCE) {
                    console.log(
                        `[CompanionFollow] ${ent.name} 距玩家 ${distToPlayer} 格，` +
                        `强制解除战斗（目标 ${target.name}）`
                    );
                    ent._combatState = null;

                    const occupied = Utils.buildOccupied(map);
                    this._teleportNear(ent, player, map, occupied);
                    ent._lastMoveAt = performance.now();

                    window.UIManager?.showText?.(`📦 ${ent.name} 撤离战斗`, 1200);
                }
            }
        },

        _teleportNear(ent, player, map, occupied) {
            const pos = Utils.findNearbyFree(map, player.x, player.y, occupied);
            if (!pos) return;

            if (window.MapCanvas?.startVisualMove) {
                window.MapCanvas.startVisualMove(
                    ent,
                    ent._visualX ?? ent.x,
                    ent._visualY ?? ent.y,
                    pos.x, pos.y
                );
            }

            ent.x = pos.x;
            ent.y = pos.y;

            const cell = map._generated.grid[pos.y]?.[pos.x];
            if (cell?.regionId) ent.region = cell.regionId;

            window.CWNotify3D?.('entity-update', { entityId: ent.id });
        },

        _stepToward(ent, tx, ty, map, occupied) {
            const dx = tx - ent.x;
            const dy = ty - ent.y;

            const moves = [];
            if (Math.abs(dx) >= Math.abs(dy)) {
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
            } else {
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
            }

            for (const [mx, my] of moves) {
                const nx = ent.x + mx;
                const ny = ent.y + my;

                if (!this._canStandOn(nx, ny, map, occupied)) continue;

                if (window.MapCanvas?.startVisualMove) {
                    window.MapCanvas.startVisualMove(
                        ent,
                        ent._visualX ?? ent.x,
                        ent._visualY ?? ent.y,
                        nx, ny
                    );
                }

                occupied.delete(`${ent.x},${ent.y}`);
                ent.x = nx;
                ent.y = ny;
                occupied.add(`${nx},${ny}`);

                const cell = map._generated.grid[ny]?.[nx];
                if (cell?.regionId) ent.region = cell.regionId;

                window.CWNotify3D?.('entity-update', { entityId: ent.id });
                return true;
            }
            return false;
        },

        _canStandOn(x, y, map, occupied) {
            const grid = map._generated?.grid;
            if (!grid) return false;

            if (y < 0 || y >= grid.length) return false;
            if (x < 0 || x >= grid[0].length) return false;

            const cell = grid[y][x];
            if (!cell) return false;
            if (!cell.walkable) return false;
            if (cell.terrain === 'void') return false;
            if (cell.decor && cell.decor.type !== 'plant') return false;
            if (cell.portal) return false;
            if (occupied.has(`${x},${y}`)) return false;

            return true;
        },
    };

    // ============================================================
    // 5. 战斗 AI
    //   ★ 用 _combatState 锁定目标
    //   ★ 战斗状态由 FollowAI 的勒绳逻辑控制
    // ============================================================
    const CompanionCombatAI = {
        _cooldowns: {},
        _lastTick: 0,

        tick() {
            const playMode = CinemaWorld.worldState?.playMode;
            if (playMode !== 'map') return;

            const combatMode = CinemaWorld.worldState?.settings?.combatMode;
            if (combatMode !== 'realtime') return;

            const modal = document.getElementById('cinemaworld-modal');
            if (modal?.classList.contains('active')) return;
            if (window.VisualNovelManager?.isPlaying) return;

            const canvas = window.MapCanvas;
            const map = window.MapLauncher?.getMap?.();
            if (!canvas?.player || !map?._generated) return;

            const now = performance.now();
            const dt = this._lastTick ? Math.min(100, now - this._lastTick) : 300;
            this._lastTick = now;

            for (const k of Object.keys(this._cooldowns)) {
                if (this._cooldowns[k] > 0) {
                    this._cooldowns[k] = Math.max(0, this._cooldowns[k] - dt);
                }
            }

            for (const ent of map.entities) {
                if (!ent.isCompanion || !ent._placed) continue;
                try {
                    this._tickCompanion(ent, map, canvas.player, now);
                } catch (e) {
                    console.error('[CompanionCombatAI] tick 异常:', e);
                }
            }
        },

        _tickCompanion(ent, map, player, now) {
            const name = ent.meta?.companionName;
            if (!name) return;

            const cd = this._cooldowns[ent.id] || 0;
            if (cd > 0) return;

            const data = CompanionEquipmentManager.deriveCombatData(name);
            if (!data) return;
            if (!data.canAttack) return;

            // ============================================================
            // ★ 1. 已有战斗目标 → 继续
            // ============================================================
            if (ent._combatState?.targetId) {
                const locked = map.entities.find(e => e.id === ent._combatState.targetId);

                if (!locked || !locked._placed || this._isEnemyDead(locked)) {
                    ent._combatState = null;
                } else {
                    // ★ 目标离玩家太远 → 放弃（避免队友追到天涯海角）
                    const targetToPlayer = Utils.manhattan(
                        locked.x, locked.y, player.x, player.y
                    );
                    if (targetToPlayer > CONST.COMBAT_ENGAGE_MAX_DISTANCE) {
                        console.log(
                            `[CompanionCombat] ${ent.name} 放弃 ${locked.name}（离玩家太远）`
                        );
                        ent._combatState = null;
                    } else {
                        this._engageTarget(ent, locked, data, map, player);
                        ent._combatState.lastEngagedAt = now;
                        return;
                    }
                }
            }

            // ============================================================
            // ★ 2. 没有战斗目标 → 索敌
            // ============================================================
            const enemy = this._findNearestEnemy(ent, map, CONST.DETECT_RADIUS);
            if (!enemy) return;

            // ★ 检查敌人是否离玩家太远
            const enemyToPlayer = Utils.manhattan(enemy.x, enemy.y, player.x, player.y);
            if (enemyToPlayer > CONST.COMBAT_ENGAGE_MAX_DISTANCE) {
                return;
            }

            // ★ 锁定
            ent._combatState = {
                targetId: enemy.id,
                lockedAt: now,
                lastEngagedAt: now,
            };

            console.log(`[CompanionCombat] ${ent.name} 锁定目标：${enemy.name}`);

            this._engageTarget(ent, enemy, data, map, player);
        },

        // ★ 对单个目标的移动+攻击逻辑
        _engageTarget(ent, enemy, data, map, player) {
            const dist = Utils.manhattan(ent.x, ent.y, enemy.x, enemy.y);

            // ---------- 在射程内 → 攻击 ----------
            if (dist <= data.range.max && dist >= data.range.min) {
                this._attack(ent, enemy, data, map);
                this._cooldowns[ent.id] = data.interval || 900;
                return;
            }

            // ---------- 太远 → 靠近 ----------
            if (dist > data.range.max) {
                const occupied = Utils.buildOccupied(map);
                const target = Utils.findApproachCell(map, ent, enemy.x, enemy.y, occupied);
                if (target) {
                    const moved = CompanionFollowAI._stepToward(
                        ent, target.x, target.y, map, occupied
                    );
                    if (moved) {
                        ent._lastMoveAt = performance.now();
                        this._cooldowns[ent.id] = CONST.MOVE_INTERVAL_MS;
                    }
                }
                return;
            }

            // ---------- 太近（远程）→ 后退 ----------
            if (data.type === '远程' && dist < data.range.min) {
                const occupied = Utils.buildOccupied(map);
                const target = this._findFleeCell(ent, enemy, map, occupied);
                if (target) {
                    const moved = CompanionFollowAI._stepToward(
                        ent, target.x, target.y, map, occupied
                    );
                    if (moved) {
                        ent._lastMoveAt = performance.now();
                        this._cooldowns[ent.id] = CONST.MOVE_INTERVAL_MS;
                    }
                }
            }
        },

        _findNearestEnemy(ent, map, radius) {
            let best = null, bestDist = radius + 1;
            for (const e of map.entities) {
                if (e.kind !== 'encounter') continue;
                if (!e._placed) continue;
                if (this._isEnemyDead(e)) continue;

                const d = Utils.manhattan(ent.x, ent.y, e.x, e.y);
                if (d < bestDist) {
                    bestDist = d;
                    best = e;
                }
            }
            return best;
        },

        _isEnemyDead(enemy) {
            const f = enemy.fields || {};
            const hpStr = f['HP'] || f['生命'] || f['生命值'] || '100/100';
            const m = String(hpStr).match(/^(\d+)\s*\/\s*(\d+)$/);
            if (m) return parseInt(m[1]) <= 0;
            return false;
        },

        _findFleeCell(ent, enemy, map, occupied) {
            const dx = ent.x - enemy.x;
            const dy = ent.y - enemy.y;

            const moves = [];
            if (Math.abs(dx) >= Math.abs(dy)) {
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
            } else {
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
            }

            for (const [mx, my] of moves) {
                const nx = ent.x + mx;
                const ny = ent.y + my;
                if (CompanionFollowAI._canStandOn(nx, ny, map, occupied)) {
                    return { x: nx, y: ny };
                }
            }
            return null;
        },

        _attack(comp, enemy, data, map) {
            const compStats = {
                name: comp.name,
                attack: data.attack,
                defense: data.defense,
                speed: data.speed,
                critRate: data.critRate || 0.05,
                critDamage: data.critDamage || 1.5,
                extra: {},
            };

            const enemyStats = window.CombatResolver?._buildEnemyStats?.(enemy)
                || this._buildEnemyStatsFallback(enemy);

            const hitCheck = window.CombatResolver?._rollHit?.(compStats, enemyStats)
                || { hit: Math.random() < 0.85 };
            if (!hitCheck.hit) {
                window.CombatRender?.popupAt?.(enemy.x, enemy.y, 'MISS', 'miss');
                return;
            }

            const dmgResult = window.CombatResolver?._calcDamage?.(compStats, enemyStats)
                || { value: Math.max(1, compStats.attack - enemyStats.defense) };
            let dmg = dmgResult.value;

            const isCrit = Math.random() < (compStats.critRate || 0);
            if (isCrit) dmg = Math.round(dmg * (compStats.critDamage || 1.5));

            this._applyDamageToEnemy(enemy, dmg);

            window.CombatRender?.popupAt?.(
                enemy.x, enemy.y, `-${dmg}`,
                isCrit ? 'crit' : 'companion-damage'
            );

            if (data.type === '远程' && window.CombatRender?.drawProjectile) {
                const cells = window.CombatAI?._lineCells?.(comp.x, comp.y, enemy.x, enemy.y) || [];
                const dir = window.CombatAI?._dirFromTo?.(comp.x, comp.y, enemy.x, enemy.y) || 'right';
                window.CombatRender.drawProjectile(
                    { x: comp.x, y: comp.y },
                    dir,
                    cells
                );
            }

            enemy.meta = enemy.meta || {};
            enemy.meta._combatAggro = true;
            enemy.meta._combatTargetId = comp.id;
            enemy.meta._combatAggroAt = Date.now();

            console.log(`[CompanionCombatAI] ${comp.name} → ${enemy.name} ${dmg}${isCrit ? '(暴击)' : ''}`);

            if (this._readEnemyHP(enemy) <= 0) {
                Promise.resolve(
                    window.CombatResolver?._handleEnemyDeath?.(enemy, map)
                ).catch(e => console.error('[CompanionCombatAI] 击杀处理失败:', e));
            }
        },

        _buildEnemyStatsFallback(enemy) {
            const f = enemy.fields || {};
            return {
                name: enemy.name,
                hp: { current: 100, max: 100 },
                attack: parseInt(f['攻击'] || f['攻击力']) || 10,
                defense: parseInt(f['防御'] || f['防御力']) || 5,
                speed: parseInt(f['敏捷'] || f['速度']) || 10,
                critRate: 0,
                critDamage: 1.5,
                extra: {},
            };
        },

        _readEnemyHP(enemy) {
            const f = enemy.fields || {};
            const hpKey = f['HP'] !== undefined ? 'HP'
                : f['生命'] !== undefined ? '生命'
                    : f['生命值'] !== undefined ? '生命值' : 'HP';
            const hpStr = f[hpKey] || '100/100';
            const m = String(hpStr).match(/^(\d+)\s*\/\s*(\d+)$/);
            return m ? parseInt(m[1]) : 100;
        },

        _applyDamageToEnemy(enemy, dmg) {
            const f = enemy.fields || {};
            const hpKey = f['HP'] !== undefined ? 'HP'
                : f['生命'] !== undefined ? '生命'
                    : f['生命值'] !== undefined ? '生命值' : 'HP';

            const hpStr = f[hpKey] || '100/100';
            const m = String(hpStr).match(/^(\d+)\s*\/\s*(\d+)$/);
            let cur = 100, max = 100;
            if (m) { cur = parseInt(m[1]); max = parseInt(m[2]); }

            cur = Math.max(0, cur - dmg);
            enemy.fields[hpKey] = `${cur}/${max}`;
            if (enemy.stats?.hp) enemy.stats.hp.current = cur;
        },

        // ---------- 队友受伤（供 combat-ai.js 调用） ----------
        applyDamageToCompanion(comp, dmg, map, attacker) {
            const name = comp.meta?.companionName;
            if (!name) return;

            const data = CompanionEquipmentManager.deriveCombatData(name);
            if (!data) return;

            if (!comp._combatHp) {
                comp._combatHp = { current: data.hp.max, max: data.hp.max };
            }
            if (comp._combatHp.max !== data.hp.max) {
                comp._combatHp.max = data.hp.max;
                if (comp._combatHp.current > data.hp.max) {
                    comp._combatHp.current = data.hp.max;
                }
            }

            comp._combatHp.current = Math.max(0, comp._combatHp.current - dmg);

            window.CombatRender?.popupAt?.(
                comp.x, comp.y, `-${dmg}`, 'companion-hurt'
            );

            // ★ 被打 → 强制进入战斗状态（反击）
            if (attacker && attacker._placed) {
                if (!comp._combatState || comp._combatState.targetId !== attacker.id) {
                    comp._combatState = {
                        targetId: attacker.id,
                        lockedAt: performance.now(),
                        lastEngagedAt: performance.now(),
                    };
                    console.log(`[CompanionCombat] ${comp.name} 被打，反击 ${attacker.name}`);
                } else {
                    comp._combatState.lastEngagedAt = performance.now();
                }
            }

            console.log(`[CompanionCombatAI] ${comp.name} 受到 ${dmg} 伤害（HP ${comp._combatHp.current}/${comp._combatHp.max}）`);

            if (comp._combatHp.current <= 0) {
                CompanionSummonManager.onCompanionDefeated(name);
                if (window.CompanionCombatAI?._cooldowns) {
                    delete window.CompanionCombatAI._cooldowns[comp.id];
                }
            }
        },

        getCompanionHp(comp) {
            const name = comp.meta?.companionName;
            if (!name) return null;
            const data = CompanionEquipmentManager.deriveCombatData(name);
            if (!data) return null;

            if (!comp._combatHp) {
                comp._combatHp = { current: data.hp.max, max: data.hp.max };
            }
            return comp._combatHp;
        },

        reset() {
            this._cooldowns = {};
        },
    };

    // ============================================================
    // 6. UI
    // ============================================================
    const CompanionSummonUI = {
        openSummonPanel(name) {
            const norm = CharacterRegistry.normalizeName(name);
            const bond = BondManager.getBond(norm);
            if (!bond) {
                window.UIManager?.showText?.('队友不存在', 1500);
                return;
            }

            const check = CompanionSummonManager.canSummon(norm);
            const playMode = CinemaWorld.worldState?.playMode;

            let statusText = '';
            let statusColor = '#888';
            let btnHTML = '';

            if (playMode !== 'map') {
                statusText = '请先进入地图';
                statusColor = '#d8c07d';
                btnHTML = `<button class="cinemaworld-button" disabled style="opacity:.5;">🚫 需要地图</button>`;
            } else if (bond.summon?.active) {
                statusText = '已在地图上（跟随中）';
                statusColor = '#7dd87d';
                btnHTML = `<button class="cinemaworld-button" style="color:#d87d7d;" onclick="CompanionSummonManager.recall('${this._attr(norm)}'); CompanionSummonUI.openSummonPanel('${this._attr(norm)}');">📦 收回</button>`;
            } else if (check.reason === 'cooldown') {
                statusText = `冷却中（剩余 ${CompanionSummonManager._formatRemain(check.remain)}）`;
                statusColor = '#d87d7d';
                btnHTML = `<button class="cinemaworld-button" disabled style="opacity:.5;">🔒 冷却中</button>`;
            } else if (!check.ok) {
                statusText = check.message || '无法召唤';
                statusColor = '#d87d7d';
                btnHTML = `<button class="cinemaworld-button" disabled style="opacity:.5;">🚫 ${this._esc(check.message || '')}</button>`;
            } else if (check.reason === 'existing') {
                statusText = '地图上已存在同名实体';
                statusColor = '#d8c07d';
                btnHTML = `<button class="cinemaworld-button primary" onclick="CompanionSummonManager.summon('${this._attr(norm)}').then(ok => { if(ok) UIManager.closeModal(); })">🤝 让它跟随</button>`;
            } else {
                statusText = '可召唤';
                statusColor = '#7dd87d';
                btnHTML = `<button class="cinemaworld-button primary" onclick="CompanionSummonManager.summon('${this._attr(norm)}').then(ok => { if(ok) UIManager.closeModal(); })">🎯 召唤到地图</button>`;
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🎯 召唤到地图</div>
                <div class="cw-companion-confirm-body">
                    <div class="cw-companion-confirm-row">
                        <span>队友</span><span>${this._esc(bond.name)}</span>
                    </div>
                    <div class="cw-companion-confirm-row">
                        <span>状态</span><span style="color:${statusColor};">${this._esc(statusText)}</span>
                    </div>
                    <div class="cw-companion-confirm-row">
                        <span>地图上限</span><span>${CONST.MAX_COMPANIONS_ON_MAP} 人</span>
                    </div>
                </div>
                <div class="cw-companion-confirm-hint">
                    🎯 召唤后队友会跟随你移动。<br>
                    ⚔️ 空手不能攻击，给队友装备武器可参战。<br>
                    📦 随时可以收回。被消灭后 24 小时冷却。
                </div>
                <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    ${btnHTML}
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },

        openEquipmentPanel(name) {
            const norm = CharacterRegistry.normalizeName(name);
            const bond = BondManager.getBond(norm);
            if (!bond) {
                window.UIManager.showText('队友不存在', 1500);
                return;
            }
        
            CompanionEquipmentManager.ensureEquipment(norm);
            const equip = CompanionEquipmentManager.getEquipment(norm);
            const player = PlayerStateManager.player;
        
            // ============================================================
            // 各槽位的可用物品
            // ============================================================
            const getItemsForSlot = (slotKey) => {
                const slotDef = CompanionEquipmentManager.SLOTS[slotKey];
                if (!slotDef) return [];
                return (player?.inventory || [])
                    .map((item, index) => ({ item, index }))
                    .filter(({ item }) => {
                        const t = String(item.fields?.['类型'] || item.type || '');
                        return slotDef.acceptTypes.test(t);
                    });
            };
        
            // ============================================================
            // 渲染单个槽位
            // ============================================================
            const renderSlot = (slotKey) => {
                const slotDef = CompanionEquipmentManager.SLOTS[slotKey];
                const item = equip[slotKey];
        
                if (item) {
                    return `
                        <div class="cw-summon-equip-slot filled" data-slot="${slotKey}">
                            <div class="cw-summon-equip-slot-label">${slotDef.emoji} ${slotDef.label}</div>
                            <div class="cw-summon-equip-slot-icon">${item.icon || '📦'}</div>
                            <div class="cw-summon-equip-slot-info">
                                <div class="cw-summon-equip-slot-name">${this._esc(item.name)}</div>
                                <div class="cw-summon-equip-slot-desc">${this._esc(item.description || '')}</div>
                                ${this._renderItemBonusPreview(item)}
                            </div>
                            <button class="cinemaworld-button" style="color:#d87d7d;padding:6px 12px;font-size:12px;"
                                onclick="CompanionEquipmentManager.unequip('${this._attr(norm)}', '${slotKey}'); CompanionSummonUI.openEquipmentPanel('${this._attr(norm)}');">
                                卸下
                            </button>
                        </div>
                    `;
                }
        
                return `
                    <div class="cw-summon-equip-slot empty" data-slot="${slotKey}">
                        <div class="cw-summon-equip-slot-label">${slotDef.emoji} ${slotDef.label}</div>
                        <div class="cw-summon-equip-slot-icon">${slotDef.emoji}</div>
                        <div class="cw-summon-equip-slot-info">
                            <div class="cw-summon-equip-slot-name">（空）</div>
                            <div class="cw-summon-equip-slot-desc">${
                                slotKey === 'weapon'
                                    ? '武器决定战斗方式，空手不能攻击'
                                    : '放入装备提升属性'
                            }</div>
                        </div>
                    </div>
                `;
            };
        
            // ============================================================
            // 战斗属性预览
            // ============================================================
            const combatData = CompanionEquipmentManager.deriveCombatData(norm);
            const statsPreviewHTML = combatData ? `
                <div class="cw-summon-stats-preview">
                    <div class="cw-summon-stats-title">⚔️ 战斗属性总览</div>
                    <div class="cw-summon-stats-grid">
                        <div><span>攻击</span><b>${combatData.attack}</b></div>
                        <div><span>防御</span><b>${combatData.defense}</b></div>
                        <div><span>敏捷</span><b>${combatData.speed}</b></div>
                        <div><span>生命</span><b>${combatData.hp.max}</b></div>
                        <div><span>暴击率</span><b>${(combatData.critRate * 100).toFixed(1)}%</b></div>
                        <div><span>暴击伤害</span><b>${(combatData.critDamage * 100).toFixed(0)}%</b></div>
                    </div>
                    ${combatData.weapon ? `
                        <div class="cw-summon-weapon-badge">
                            武器：${combatData.weapon.icon || ''}${this._esc(combatData.weapon.name)}
                            · ${combatData.type} · 距离 ${combatData.range.min}~${combatData.range.max} · ${combatData.interval}ms
                        </div>
                    ` : `
                        <div class="cw-summon-weapon-badge warn">⚠️ 未装备武器，无法战斗</div>
                    `}
                </div>
            ` : '';
        
            // ============================================================
            // 背包列表（按当前选中的槽位过滤）
            // ============================================================
            const renderInventoryForSlot = (slotKey) => {
                const items = getItemsForSlot(slotKey);
                if (items.length === 0) {
                    return `<div class="cw-companion-empty-line">背包里没有可装备的物品</div>`;
                }
                return items.map(({ item, index }) => `
                    <div class="cw-summon-weapon-row">
                        <div class="cw-summon-weapon-icon">${item.icon || '📦'}</div>
                        <div class="cw-summon-weapon-info">
                            <div class="cw-summon-weapon-name">${this._esc(item.name)}</div>
                            <div class="cw-summon-weapon-desc">${this._esc(item.description || '')}</div>
                            ${this._renderItemBonusPreview(item)}
                        </div>
                        <button class="cinemaworld-button primary" style="padding:6px 12px;font-size:12px;"
                            onclick="CompanionEquipmentManager.equipFromInventory('${this._attr(norm)}', ${index}, '${slotKey}'); CompanionSummonUI.openEquipmentPanel('${this._attr(norm)}');">
                            装备
                        </button>
                    </div>
                `).join('');
            };
        
            // ============================================================
            // 拼装面板
            // ============================================================
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚔️ 装备 - ${this._esc(bond.name)}</div>
        
                <div class="cw-summon-equip-section">
                    <div class="cw-summon-equip-section-title">装备槽</div>
                    <div class="cw-summon-equip-slots">
                        ${renderSlot('weapon')}
                        ${renderSlot('armor')}
                        ${renderSlot('accessory1')}
                        ${renderSlot('accessory2')}
                    </div>
                </div>
        
                ${statsPreviewHTML}
        
                <div class="cw-summon-equip-section">
                    <div class="cw-summon-equip-section-title">
                        背包
                        <div class="cw-summon-slot-tabs">
                            ${Object.entries(CompanionEquipmentManager.SLOTS).map(([k, def]) => `
                                <button class="cw-summon-slot-tab ${k === 'weapon' ? 'active' : ''}"
                                    data-tab="${k}"
                                    onclick="CompanionSummonUI._switchSlotTab('${this._attr(norm)}', '${k}')">
                                    ${def.emoji} ${def.label}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <div id="cw-summon-inventory-list" class="cw-summon-inventory-list">
                        ${renderInventoryForSlot('weapon')}
                    </div>
                </div>
        
                <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },
        
        // ============================================================
        // ★ 切换背包 tab
        // ============================================================
        _switchSlotTab(name, slotKey) {
            const listEl = document.getElementById('cw-summon-inventory-list');
            if (!listEl) return;
        
            const player = PlayerStateManager.player;
            const slotDef = CompanionEquipmentManager.SLOTS[slotKey];
            if (!slotDef) return;
        
            const items = (player?.inventory || [])
                .map((item, index) => ({ item, index }))
                .filter(({ item }) => {
                    const t = String(item.fields?.['类型'] || item.type || '');
                    return slotDef.acceptTypes.test(t);
                });
        
            let html = '';
            if (items.length === 0) {
                html = `<div class="cw-companion-empty-line">背包里没有可装备的物品</div>`;
            } else {
                html = items.map(({ item, index }) => `
                    <div class="cw-summon-weapon-row">
                        <div class="cw-summon-weapon-icon">${item.icon || '📦'}</div>
                        <div class="cw-summon-weapon-info">
                            <div class="cw-summon-weapon-name">${this._esc(item.name)}</div>
                            <div class="cw-summon-weapon-desc">${this._esc(item.description || '')}</div>
                            ${this._renderItemBonusPreview(item)}
                        </div>
                        <button class="cinemaworld-button primary" style="padding:6px 12px;font-size:12px;"
                            onclick="CompanionEquipmentManager.equipFromInventory('${this._attr(name)}', ${index}, '${slotKey}'); CompanionSummonUI.openEquipmentPanel('${this._attr(name)}');">
                            装备
                        </button>
                    </div>
                `).join('');
            }
        
            listEl.innerHTML = html;
        
            // 更新 tab 高亮
            document.querySelectorAll('.cw-summon-slot-tab').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.tab === slotKey);
            });
        },
        
        // ============================================================
        // ★ 渲染单件物品的属性加成预览
        // ============================================================
        _renderItemBonusPreview(item) {
            if (!item?.fields) return '';
            const bonuses = CompanionEquipmentManager._extractItemBonuses(item);
        
            const parts = [];
            if (bonuses.attack) parts.push(`攻击+${bonuses.attack}`);
            if (bonuses.defense) parts.push(`防御+${bonuses.defense}`);
            if (bonuses.speed) parts.push(`敏捷+${bonuses.speed}`);
            if (bonuses.hp) parts.push(`生命+${bonuses.hp}`);
            if (bonuses.critRate) parts.push(`暴击+${(bonuses.critRate * 100).toFixed(1)}%`);
            if (bonuses.critDamage) parts.push(`暴伤+${(bonuses.critDamage * 100).toFixed(0)}%`);
        
            if (parts.length === 0) return '';
        
            return `<div class="cw-summon-item-bonus">${parts.map(p =>
                `<span>${p}</span>`
            ).join('')}</div>`;
        },

        renderEntityDetailButtons(ent) {
            const name = ent.meta?.companionName;
            if (!name) return '';

            return `
                <button class="cinemaworld-button primary"
                    onclick="CompanionSummonUI.openEquipmentPanel('${this._attr(name)}')">
                    ⚔️ 装备
                </button>
                <button class="cinemaworld-button"
                    onclick="CompanionUI.openModalDetail('${this._attr(name)}')">
                    📊 队友详情
                </button>
                <button class="cinemaworld-button" style="color:#d87d7d;"
                    onclick="if(confirm('收回队友？')) { CompanionSummonManager.recall('${this._attr(name)}'); MapLauncher._closeSubPanel(); }">
                    📦 收回
                </button>
            `;
        },

        _esc(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
        _attr(s) {
            return String(s || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        },
    };

    // ============================================================
    // 7. 挂载 & 初始化
    // ============================================================
    window.CompanionSummonManager = CompanionSummonManager;
    window.CompanionFollowAI = CompanionFollowAI;
    window.CompanionCombatAI = CompanionCombatAI;
    window.CompanionEquipmentManager = CompanionEquipmentManager;
    window.CompanionSummonUI = CompanionSummonUI;

    function boot() {
        CompanionSummonManager.init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld/companion] companion-summon.js 已加载');
})();