// ============================================================
// CinemaWorld · companion/companion-core.js
// 数据层：常量 / CompanionManager（队伍）/ BondManager（养成）
//   - 角色属性（stats）：战斗用，无阶段锁，无里程碑
//   - 养成属性（bondStats）：关系用，有阶段锁，写里程碑
//   - 属性等级系统（累计型，等级动态计算）
//   - 属性描述
//   - 阶段锁数值（caps，只对 bondStats 生效）
//   - 阶段手动进入（pendingStageId + enterStage）
//   - 里程碑日志
//
// 依赖：core.js, world.js, player.js
// 暴露：window.CompanionManager, window.BondManager, window.CompanionConstants
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const CharacterRegistry = window.CharacterRegistry;

    // ============================================================
    // 0. 常量
    // ============================================================
    const COOLDOWN_TYPES = {
        daily: '每天一次',
        hourly: '每小时一次',
        none: '无限制',
    };

    const PROFILE_KEY_MAP = {
        '性别': 'gender',
        '年龄': 'age',
        '性格': 'personality',
        '当前心情': 'mood',
        '心情': 'mood',
        '外貌': 'appearance',
        '穿着': 'outfit',
        '背景故事': 'background',
        '背景': 'background',
        '健康状态': 'status',
        '状态': 'status',
    };

    // ============================================================
    // 1. 数据层：CompanionManager
    // ============================================================
    const CompanionManager = {
        ensureStore() {
            const ws = CinemaWorld.worldState;
            if (!ws.party) {
                ws.party = { members: [] };
            }
            if (!ws.companionBonds) {
                ws.companionBonds = {};
            }
            if (!Array.isArray(ws.party.members)) ws.party.members = [];
            return ws.party;
        },

        getAll() {
            const party = this.ensureStore();
            return party.members.map(name => BondManager.getBond(name)).filter(Boolean);
        },

        getMemberNames() {
            return this.ensureStore().members.slice();
        },

        isMember(name) {
            const norm = CharacterRegistry.normalizeName(name);
            if (!norm) return false;
            return this.ensureStore().members.includes(norm);
        },

        getSize() {
            return this.ensureStore().members.length;
        },

        async join(name, options = {}) {
            const norm = CharacterRegistry.normalizeName(name);
            if (!norm) return { ok: false, message: '角色名无效' };

            const record = CharacterRegistry.get(norm);
            if (!record) return { ok: false, message: '角色不存在' };

            if (this.isMember(norm)) {
                return { ok: false, message: `${record.name} 已经在队伍里了` };
            }

            this.ensureStore().members.push(norm);

            const bond = BondManager.ensureBond(norm, {
                joinedFrom: options.joinedFrom || '',
            });

            bond.joinedAt = Date.now();
            bond.leftAt = null;

            if (!bond._initialized) {
                const ok = await window.CompanionAIManager.initBondData(norm);
                if (!ok) {
                    BondManager.applyFallbackData(norm);
                }
                bond._initialized = true;
            }

            record.isCompanion = true;
            // join() 里，this.save() 之前加：
            const map = window.MapLauncher?.getMap?.();
            if (map && window.CinemaWorld?.worldState?.playMode === 'map') {
                this.syncToMap(map);
            }
            this.save();
            console.log(`[Companion] ${record.name} 入队，当前 ${this.getSize()} 人`);
            return { ok: true, message: `${record.name} 加入队伍` };
        },

        leave(name) {
            const norm = CharacterRegistry.normalizeName(name);
            if (!norm) return { ok: false, message: '角色名无效' };
        
            const idx = this.ensureStore().members.indexOf(norm);
            if (idx === -1) return { ok: false, message: '不在队伍里' };
        
            this.ensureStore().members.splice(idx, 1);
        
            const bond = BondManager.getBond(norm);
            const record = CharacterRegistry.get(norm);
        
            if (bond) {
                bond.leftAt = Date.now();
                // ★ 清召唤状态
                bond.summon = bond.summon || {};
                bond.summon.active = false;
                bond.summon.entityId = null;
                bond.summon.mapName = null;
            }
            if (record) record.isCompanion = false;
        
            // ============================================================
            // ★ 处理地图实体
            // ============================================================
            this._restoreCompanionToNPCOnMap(norm, record);
        
            this.save();
            console.log(`[Companion] ${record?.name || norm} 离队，剩余 ${this.getSize()} 人`);
            return { ok: true, message: `${record?.name || norm} 离开了队伍` };
        },
        
        // ============================================================
        // ★ 离队时，把队友变回普通 NPC
        //   - 当前地图上有队友实体 → 降级
        //   - 当前地图上没队友实体 → 在玩家附近生成一个 NPC
        //   - 别的地图上有队友实体 → 删除（避免残留）
        // ============================================================
        _restoreCompanionToNPCOnMap(norm, record) {
            const ws = CinemaWorld.worldState;
            const playMode = ws?.playMode;
        
            // ---------- 1. 别的地图：删掉队友实体 ----------
            for (const [mapName, mapData] of Object.entries(ws.maps || {})) {
                if (!Array.isArray(mapData.entities)) continue;
                mapData.entities = mapData.entities.filter(e => {
                    if (e.kind !== 'companion') return true;
                    const n = e._companionName
                        || CharacterRegistry.normalizeName(e.name);
                    return n !== norm;
                });
            }
        
            // ---------- 2. 当前地图 ----------
            const currentMap = window.MapLauncher?.getMap?.();
            if (!currentMap?.entities || playMode !== 'map') {
                // 不在地图模式 → 标记待生成，下次进图时补
                if (bond) {
                    // 用一个临时字段记录
                    // 也可以放进 record.meta 里，但 bond 更合适（bond 是队友数据）
                }
                return;
            }
        
            // 找当前地图里的队友实体
            let ent = currentMap.entities.find(e =>
                e.kind === 'companion' &&
                (e._companionName === norm ||
                    CharacterRegistry.normalizeName(e.name) === norm)
            );
        
            if (ent) {
                // ---------- 降级为 NPC ----------
                this._demoteEntityToNPC(ent, norm, record);
                window.CWNotify3D?.('entity-update', { entityId: ent.id });
                return;
            }
        
            // ---------- 地图上没实体 → 生成 NPC ----------
            const player = currentMap.entities.find(e => e.isPlayer);
            if (!player) return;
        
            const spawn = this._spawnNPCFromCompanion(currentMap, player, norm, record);
            if (spawn) {
                currentMap.entities.push(spawn);
                window.CWNotify3D?.('entity-add');
                console.log(`[Companion] ${record?.name || norm} 离队，在玩家附近生成了 NPC`);
            }
        },
        
        _demoteEntityToNPC(ent, norm, record) {
            ent.kind = 'npc';
            ent.isCompanion = false;
            delete ent._companionName;
            delete ent._combat;
            delete ent._combatHp;
            delete ent._combatState;
            ent.blocking = true;
            ent.type = 'npc';
            ent.tags = (ent.tags || []).filter(t => t !== '队友');
            if (ent.meta) {
                delete ent.meta.companionName;
                // ★ 保留 gender / mood / _spriteSeed
            }
            ent.id = ent.id.startsWith('companion_')
                ? `npc_${norm}_${Date.now()}`
                : ent.id;
        },
        
        _spawnNPCFromCompanion(map, player, norm, record) {
            const pos = this._findSpotNearPlayer(map, player);
            if (!pos) {
                console.warn(`[Companion] 找不到空位生成离队 NPC：${norm}`);
                return null;
            }
        
            const bond = BondManager.getBond(norm);
            const profile = bond?.profile || {};
        
            return {
                id: `npc_${norm}_${Date.now()}`,
                name: record?.name || norm,
                emoji: record?.emoji || (profile.gender === '女' ? '👩' : profile.gender === '男' ? '👨' : '🧑'),
                kind: 'npc',
                isCompanion: false,
                region: player.region,
                position: 'center',
                x: pos.x,
                y: pos.y,
                _placed: true,
                _visualX: pos.x,
                _visualY: pos.y,
                blocking: true,
                isPlayer: false,
                tags: [],
                description: profile.background || record?.description || '',
                meta: {
                    gender: profile.gender || record?.gender || '其他',
                    mood: profile.mood || record?.mood || '平静',
                    _spriteSeed: Math.floor(Math.random() * 1e9),
                    _fromCompanion: true,   // ★ 标记：由队友转化而来
                },
                status: profile.status || record?.status || '',
                effect: '',
                fields: {},
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1,
                countMode: 'single',
                stackable: false,
                maxStack: null,
                type: 'npc',
            };
        },
        
        // 复用 _findSpotNearPlayer（如果已有）
        _findSpotNearPlayer(map, player) {
            const grid = map._generated?.grid;
            if (!grid) return null;
        
            const occupied = new Set(
                map.entities
                    .filter(e => e._placed && typeof e.x === 'number')
                    .map(e => `${e.x},${e.y}`)
            );
        
            for (let r = 1; r <= 8; r++) {
                const ring = [];
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        ring.push([dx, dy]);
                    }
                }
                ring.sort(() => Math.random() - 0.5);
        
                for (const [dx, dy] of ring) {
                    const x = player.x + dx;
                    const y = player.y + dy;
                    if (y < 0 || y >= grid.length) continue;
                    if (x < 0 || x >= grid[0].length) continue;
                    const cell = grid[y][x];
                    if (!cell?.walkable) continue;
                    if (cell.decor) continue;
                    if (cell.portal) continue;
                    if (cell.terrain === 'void') continue;
                    if (occupied.has(`${x},${y}`)) continue;
                    return { x, y };
                }
            }
            return null;
        },

        serialize() {
            const ws = CinemaWorld.worldState;
            return {
                members: (ws.party?.members || []).slice(),
                bonds: JSON.parse(JSON.stringify(ws.companionBonds || {})),  // ★ 深拷贝
            };
        },

        restore(data) {
            const ws = CinemaWorld.worldState;
            if (!data) return;

            if (!ws.party) ws.party = { members: [] };
            if (!ws.companionBonds) ws.companionBonds = {};

            if (Array.isArray(data.members)) {
                ws.party.members = data.members.slice();
            }

            let bondsData = data.bonds;
            if ((!bondsData || Object.keys(bondsData).length === 0) && ws.bonds) {
                const looksLikeCompanion = Object.values(ws.bonds).some(b =>
                    b && (b.profile || b.stats || b._initialized !== undefined)
                );
                if (looksLikeCompanion) {
                    bondsData = ws.bonds;
                    console.log('[Companion] 从旧字段 bonds 迁移队友数据');
                }
            }

            if (bondsData && typeof bondsData === 'object') {
                ws.companionBonds = bondsData;
            }

            // ★ 归一化：补全 equipment / summon，同时清理脏 entityId
            for (const bond of Object.values(ws.companionBonds)) {
                if (bond) BondManager._normalizeBond(bond);

                // ★ 召唤状态校验：mapName / entityId 一定要和当前地图对得上
                //   这里先不做地图级校验，等地图 restore 时再修正
            }

            this._sanitize();

            for (const name of ws.party.members) {
                const record = CharacterRegistry.get(name);
                if (record) record.isCompanion = true;
            }

            // ★ 注意：不再无条件调用 syncToMap
            //   由 MapLauncher._loadMapFromWorld 负责调用（见下文）
            console.log(`[Companion] 已恢复队伍：${ws.party.members.length} 人`);
        },

        _sanitize() {
            const ws = CinemaWorld.worldState;
            const chars = ws.characters || {};
            const bonds = ws.companionBonds || {};
            const members = ws.party.members || [];

            const valid = [];
            const removed = [];

            for (const norm of members) {
                const record = chars[norm];
                const bond = bonds[norm];

                if (!record) { removed.push(norm); continue; }
                if (!bond) { removed.push(norm); continue; }
                if (!bond._initialized) {
                    removed.push(norm);
                    delete bonds[norm];
                    continue;
                }
                const hasAny = (bond.bondStatsOrder?.length || bond.statsOrder?.length);
                if (!hasAny) {
                    removed.push(norm);
                    delete bonds[norm];
                    continue;
                }

                valid.push(norm);
            }

            ws.party.members = valid;

            if (removed.length > 0) {
                console.log(`[Companion] 清理无效队员 ${removed.length} 个：`, removed);
            }
        },

        clear() {
            const ws = CinemaWorld.worldState;
            ws.party = { members: [] };
            ws.companionBonds = {};
            for (const record of Object.values(ws.characters || {})) {
                record.isCompanion = false;
            }
            this.save();
        },
        // ============================================================
        // 同步队伍成员到地图实体
        //   ★ 只处理"已召唤"的队友
        //   - summon.active === true → 在地图上：升级/生成实体
        //   - summon.active === false → 不在地图上：把已有实体降级或移除
        // ============================================================
        syncToMap(map, options = {}) {
            if (!map?.entities || !map?._generated) return 0;
        
            const members = this.getMemberNames();
            if (members.length === 0) return 0;
        
            const player = map.entities.find(e => e.isPlayer);
            if (!player) return 0;
        
            let changed = 0;
            const mapName = map.name;
        
            for (const norm of members) {
                const record = CharacterRegistry.get(norm);
                if (!record) continue;
        
                const bond = BondManager.getBond(norm);
                if (!bond) continue;
        
                // ★ 判断该队友是否"应该"出现在这张地图上
                const shouldBeOnMap =
                    bond.summon?.active === true &&
                    bond.summon?.mapName === mapName;
        
                // 找地图里已有的队友实体
                let ent = map.entities.find(e =>
                    !e.isPlayer &&
                    e.kind === 'companion' &&
                    e._companionName === norm
                );
        
                if (!ent) {
                    ent = map.entities.find(e =>
                        !e.isPlayer &&
                        e.kind === 'companion' &&
                        CharacterRegistry.normalizeName(e.name) === norm
                    );
                }
        
                if (shouldBeOnMap) {
                    // ---------- 应该在地图上 ----------
                    if (ent) {
                        // 已有 → 刷新字段
                        ent._companionName = norm;
                        ent.kind = 'companion';
                        ent.isCompanion = true;
                        ent.blocking = false;
                        ent.tags = Array.isArray(ent.tags) ? ent.tags : [];
                        if (!ent.tags.includes('队友')) ent.tags.push('队友');
                        ent.type = 'companion';
                        ent.meta = ent.meta || {};
                        ent.meta.companionName = norm;
                        bond.summon.entityId = ent.id;
        
                        // 距离太远 → 拉近
                        const dist = Math.abs(ent.x - player.x) + Math.abs(ent.y - player.y);
                        if (dist > 8) {
                            const pos = this._findSpotNearPlayer(map, player);
                            if (pos) {
                                ent.x = pos.x;
                                ent.y = pos.y;
                                ent._placed = true;
                                ent._visualX = pos.x;
                                ent._visualY = pos.y;
                                changed++;
                            }
                        }
                    } else {
                        // ★ 没有实体 → 直接生成（不再升级同名 NPC）
                        //   理由：升级同名 NPC 会把"路人 NPC"变成队友，语义错乱
                        const spawn = this._spawnCompanionEntity(record, map, player);
                        if (spawn) {
                            map.entities.push(spawn);
                            bond.summon.entityId = spawn.id;
                            changed++;
                        }
                    }
                } else {
                    // ---------- 不应该在地图上 → 直接移除 ----------
                    if (ent) {
                        const idx = map.entities.indexOf(ent);
                        if (idx > -1) {
                            map.entities.splice(idx, 1);
                            window.CWNotify3D?.('entity-remove', { entityId: ent.id });
                            changed++;
                        }
                        if (bond.summon) {
                            bond.summon.entityId = null;
                        }
                    }
                }
            }
        
            if (changed > 0) {
                console.log(`[Companion] syncToMap: ${changed} 处变更`);
                window.CWNotify3D?.('all');
                if (window.MapCanvas?.canvas) window.MapCanvas._render();
            }
            return changed;
        },

        // ★ 升级 NPC → 队友
        _promoteNPCToCompanion(ent, norm, bond) {
            ent.kind = 'companion';
            ent.isCompanion = true;
            ent._companionName = norm;
            ent.blocking = false;
            ent.tags = Array.isArray(ent.tags) ? ent.tags : [];
            if (!ent.tags.includes('队友')) ent.tags.push('队友');
            ent.type = 'companion';
            ent.meta = ent.meta || {};
            ent.meta.companionName = norm;
            ent.meta.gender = bond.profile?.gender || ent.meta.gender || '';
            ent.meta.mood = bond.profile?.mood || ent.meta.mood || '';
            ent._combat = { lastAttackAt: 0, targetId: null };
        },

        // ★ 队友 → 普通 NPC（保留地图存在，但不再是队友）
        _demoteCompanionToNPC(ent, norm) {
            ent.kind = 'npc';
            ent.isCompanion = false;
            delete ent._companionName;
            ent.tags = Array.isArray(ent.tags)
                ? ent.tags.filter(t => t !== '队友')
                : [];
            ent.type = 'npc';
            if (ent.meta) {
                delete ent.meta.companionName;
            }
            // 清掉战斗 HP 缓存
            delete ent._combatHp;
            delete ent._combat;
        },

        _spawnCompanionEntity(record, map, player) {
            const pos = this._findSpotNearPlayer(map, player);
            if (!pos) {
                console.warn(`[Companion] 找不到空位生成 ${record.name}`);
                return null;
            }

            const norm = record._normalizedName || record.name;

            return {
                id: `companion_${norm}`,
                name: record.name,
                emoji: record.emoji || (record.gender === '女' ? '👩' : record.gender === '男' ? '👨' : '🧑'),
                kind: 'companion',
                isCompanion: true,
                _companionName: norm,          // ★ 关键：加这个字段
                region: player.region,
                position: 'center',
                x: pos.x,
                y: pos.y,
                _placed: true,
                _visualX: pos.x,
                _visualY: pos.y,
                blocking: false,                // ★ 队友不阻挡
                isPlayer: false,
                tags: ['队友'],
                description: record.description || '',
                meta: {
                    companionName: norm,
                    gender: record.gender || '其他',
                    mood: record.mood || '平静',
                    _spriteSeed: Math.floor(Math.random() * 1e9),
                },
                status: record.status || '',
                effect: '',
                fields: {},
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1,
                countMode: 'single',
                stackable: false,
                maxStack: null,
                type: 'companion',
                _combat: { lastAttackAt: 0, targetId: null },
            };
        },

        _findSpotNearPlayer(map, player) {
            const grid = map._generated?.grid;
            if (!grid) return null;

            const occupied = new Set(
                map.entities
                    .filter(e => e._placed && typeof e.x === 'number')
                    .map(e => `${e.x},${e.y}`)
            );

            for (let r = 1; r <= 8; r++) {
                const ring = [];
                for (let dy = -r; dy <= r; dy++) {
                    for (let dx = -r; dx <= r; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        ring.push([dx, dy]);
                    }
                }
                // 随机打散，避免所有队友挤在一侧
                ring.sort(() => Math.random() - 0.5);

                for (const [dx, dy] of ring) {
                    const x = player.x + dx;
                    const y = player.y + dy;
                    if (y < 0 || y >= grid.length) continue;
                    if (x < 0 || x >= grid[0].length) continue;
                    const cell = grid[y][x];
                    if (!cell?.walkable) continue;
                    if (cell.decor) continue;
                    if (cell.portal) continue;
                    if (cell.terrain === 'void') continue;
                    if (occupied.has(`${x},${y}`)) continue;
                    return { x, y };
                }
            }
            return null;
        },
        save() {
            if (window.SaveManager) window.SaveManager.save();
        },
    };

    // ============================================================
    // 2. 养成层：BondManager
    // ============================================================
    const BondManager = {
        ensureStore() {
            const ws = CinemaWorld.worldState;
            if (!ws.companionBonds) ws.companionBonds = {};
            return ws.companionBonds;
        },

        getBond(name) {
            const norm = CharacterRegistry.normalizeName(name);
            if (!norm) return null;
            return this.ensureStore()[norm] || null;
        },
        // ★ 兜底：确保战斗核心属性存在
        ensureBaselineStats(bond) {
            if (!bond) return;

            if (!bond.stats || typeof bond.stats !== 'object') {
                bond.stats = {};
            }
            if (!Array.isArray(bond.statsOrder)) {
                bond.statsOrder = Object.keys(bond.stats);
            }

            // ---------- 战斗核心属性 ----------
            const BASELINE = {
                'HP': { value: 100, max: 100, min: 0, label: 'HP', emoji: '❤️', desc: '生命值' },
                '攻击': { value: 5, max: null, min: 0, label: '攻击', emoji: '⚔️', desc: '物理攻击强度' },
                '防御': { value: 3, max: null, min: 0, label: '防御', emoji: '🛡️', desc: '物理防御力' },
                '敏捷': { value: 5, max: null, min: 0, label: '敏捷', emoji: '🏃', desc: '先攻与闪避' },
                '攻击间隔': { value: 1200, max: null, min: 200, label: '攻击间隔', emoji: '⏱️', desc: '两次攻击之间的毫秒数' },
                '攻击距离': { value: 1, max: null, min: 1, label: '攻击距离', emoji: '📏', desc: '攻击范围（格）' },
            };

            for (const [key, def] of Object.entries(BASELINE)) {
                if (!bond.stats[key]) {
                    // 完全缺失 → 补上
                    bond.stats[key] = { ...def };
                    bond.statsOrder.push(key);
                    console.log(`[Companion] ${bond.name} 兜底属性：${key} = ${def.value}`);
                } else {
                    // 存在 → 检查 value 是否合法
                    const s = bond.stats[key];
                    const v = Number(s.value);
                    if (!isFinite(v)) {
                        s.value = def.value;
                        console.warn(`[Companion] ${bond.name} 属性 ${key} 非法，重置为 ${def.value}`);
                    }
                    // 兜底字段
                    if (typeof s.label !== 'string' || !s.label) s.label = def.label;
                    if (typeof s.emoji !== 'string' || !s.emoji) s.emoji = def.emoji;
                    if (typeof s.desc !== 'string') s.desc = def.desc || '';
                    if (typeof s.min !== 'number') s.min = def.min;
                    if (s.max === undefined) s.max = def.max;
                }
            }

            // ---------- 养成核心属性：好感度 ----------
            if (!bond.bondStats || typeof bond.bondStats !== 'object') {
                bond.bondStats = {};
            }
            if (!Array.isArray(bond.bondStatsOrder)) {
                bond.bondStatsOrder = Object.keys(bond.bondStats);
            }

            if (!bond.bondStats['好感度']) {
                bond.bondStats['好感度'] = {
                    value: 0, max: 100, min: 0,
                    label: '好感度', emoji: '💗', desc: '她与你的关系深浅',
                };
                bond.bondStatsOrder.unshift('好感度');   // 放到最前
                console.log(`[Companion] ${bond.name} 兜底养成属性：好感度`);
            }

            // 确保"HP" 的 max 有值
            const hp = bond.stats['HP'];
            if (hp && (typeof hp.max !== 'number' || hp.max <= 0)) {
                hp.max = Math.max(100, Number(hp.value) || 100);
            }
        },
        ensureBond(name, options = {}) {
            const norm = CharacterRegistry.normalizeName(name);
            if (!norm) return null;

            const store = this.ensureStore();
            if (!store[norm]) {
                const record = CharacterRegistry.get(norm);
                store[norm] = {
                    name: record?.name || name,
                    _normalizedName: norm,

                    joinedAt: null,
                    leftAt: null,
                    joinedFrom: options.joinedFrom || '',
                    _initialized: false,

                    profile: this._emptyProfile(),

                    // ★ 角色属性（战斗用）
                    stats: {},
                    statsOrder: [],

                    // ★ 养成属性（关系用）
                    bondStats: {},
                    bondStatsOrder: [],

                    actions: [],

                    stages: [],
                    currentStageId: null,
                    pendingStageId: null,

                    rules: {
                        levelRules: {},
                    },

                    milestones: [],

                    log: [],

                    // ★ 装备：1 武器槽 + 3 通用槽
                    equipment: {
                        weapon: null,
                        armor: null,       // 护甲槽
                        accessory1: null,  // 饰品槽 1
                        accessory2: null,  // 饰品槽 2
                    },

                    // ★ 召唤状态
                    summon: {
                        active: false,
                        mapName: null,
                        entityId: null,
                        lastSummonedAt: null,
                        lastDefeatedAt: null,
                        cooldownUntil: null,
                    },

                    _combat: null,
                    _business: null,
                    _skills: null,

                    createdAt: Date.now(),
                };
            } else {
                this._normalizeBond(store[norm]);
            }
            return store[norm];
        },

        _emptyProfile() {
            return {
                gender: '',
                age: '',
                personality: '',
                mood: '',
                appearance: '',
                outfit: '',
                background: '',
                status: '',
                _extra: {},
                _extraOrder: [],
                experiences: [],
            };
        },

        _normalizeBond(bond) {
            if (!bond) return;

            if (!bond.profile || typeof bond.profile !== 'object') {
                bond.profile = this._emptyProfile();
            } else {
                const p = bond.profile;
                if (typeof p.gender !== 'string') p.gender = '';
                if (typeof p.age !== 'string') p.age = String(p.age || '');
                if (typeof p.personality !== 'string') p.personality = '';
                if (typeof p.mood !== 'string') p.mood = '';
                if (typeof p.appearance !== 'string') p.appearance = '';
                if (typeof p.outfit !== 'string') p.outfit = '';
                if (typeof p.background !== 'string') p.background = '';
                if (typeof p.status !== 'string') p.status = '';
                if (!p._extra || typeof p._extra !== 'object') p._extra = {};
                if (!Array.isArray(p._extraOrder)) p._extraOrder = Object.keys(p._extra);
                if (!Array.isArray(p.experiences)) p.experiences = [];
            }

            // ============================================================
            // ★ 迁移：老存档的 stats 是养成属性 → 移到 bondStats
            // ============================================================
            if (!bond.bondStats || typeof bond.bondStats !== 'object') {
                bond.bondStats = bond.stats || {};
            }
            if (!Array.isArray(bond.bondStatsOrder)) {
                bond.bondStatsOrder = bond.statsOrder || Object.keys(bond.bondStats);
            }

            // ★ 新的 stats 是角色属性（老存档没有就是空）
            if (!bond.stats || typeof bond.stats !== 'object') {
                bond.stats = {};
            }
            if (!Array.isArray(bond.statsOrder)) {
                bond.statsOrder = Object.keys(bond.stats);
            }

            // 属性字段兜底
            for (const s of Object.values(bond.stats)) {
                if (s && typeof s === 'object' && typeof s.desc !== 'string') s.desc = '';
            }
            for (const s of Object.values(bond.bondStats)) {
                if (s && typeof s === 'object' && typeof s.desc !== 'string') s.desc = '';
            }

            if (!Array.isArray(bond.actions)) bond.actions = [];
            if (!Array.isArray(bond.stages)) bond.stages = [];
            if (!Array.isArray(bond.log)) bond.log = [];

            for (const stage of bond.stages) {
                if (!stage) continue;
                if (!stage.caps || typeof stage.caps !== 'object') {
                    stage.caps = {};
                }
            }

            if (!bond.rules || typeof bond.rules !== 'object') {
                bond.rules = { levelRules: {} };
            }
            if (!bond.rules.levelRules || typeof bond.rules.levelRules !== 'object') {
                bond.rules.levelRules = {};
            }

            if (!Array.isArray(bond.milestones)) bond.milestones = [];

            if (bond.pendingStageId === undefined) {
                bond.pendingStageId = null;
            }

            // ★ 补：equipment 兜底（1 武器 + 3 通用槽）
            if (!bond.equipment || typeof bond.equipment !== 'object') {
                bond.equipment = {};
            }
            if (bond.equipment.weapon === undefined) bond.equipment.weapon = null;
            if (bond.equipment.armor === undefined) bond.equipment.armor = null;
            if (bond.equipment.accessory1 === undefined) bond.equipment.accessory1 = null;
            if (bond.equipment.accessory2 === undefined) bond.equipment.accessory2 = null;

            // ★ 兼容老存档：如果只有 weapon / 没有通用槽字段，上面已补齐

            // ★ 补：summon 兜底
            if (!bond.summon || typeof bond.summon !== 'object') {
                bond.summon = {
                    active: false, mapName: null, entityId: null,
                    lastSummonedAt: null, lastDefeatedAt: null, cooldownUntil: null,
                };
            } else {
                if (bond.summon.active === undefined) bond.summon.active = false;
                if (bond.summon.entityId === undefined) bond.summon.entityId = null;
                if (bond.summon.mapName === undefined) bond.summon.mapName = null;
                if (bond.summon.cooldownUntil === undefined) bond.summon.cooldownUntil = null;
                if (bond.summon.lastSummonedAt === undefined) bond.summon.lastSummonedAt = null;
                if (bond.summon.lastDefeatedAt === undefined) bond.summon.lastDefeatedAt = null;
            }

        },

        // ============================================================
        // ★ 属性：判断 key 属于哪类
        // ============================================================
        _getStatBucket(bond, key) {
            if (!bond || !key) return null;
            if (bond.stats?.[key] !== undefined) return 'stats';
            if (bond.bondStats?.[key] !== undefined) return 'bondStats';
            return null;
        },

        // ============================================================
        // 属性操作（自动识别 stats / bondStats）
        // ============================================================
        getStat(bond, key) {
            const bucket = this._getStatBucket(bond, key);
            if (!bucket) return null;
            return bond[bucket][key];
        },

        getStatValue(bond, key) {
            const s = this.getStat(bond, key);
            return s ? (Number(s.value) || 0) : 0;
        },

        isStatUpgradable(bond, key) {
            return !!(bond?.rules?.levelRules?.[key]);
        },

        getStatLevel(bond, key) {
            const rule = bond.rules?.levelRules?.[key];
            if (!rule) return null;

            const s = this.getStat(bond, key);
            if (!s) return 1;

            const levelMax = rule.levelMax || 100;
            const maxLevel = rule.maxLevel || 99;

            const level = Math.floor((Number(s.value) || 0) / levelMax) + 1;
            return Math.min(level, maxLevel);
        },

        getStatLevelInfo(bond, key) {
            const rule = bond.rules?.levelRules?.[key];
            if (!rule) return null;

            const level = this.getStatLevel(bond, key) || 1;
            const levelMax = rule.levelMax || 100;
            const maxLevel = rule.maxLevel || 99;
            const levels = rule.levels || [];

            const curInfo = levels.find(l => l.level === level);
            const totalMax = levelMax * maxLevel;

            return {
                level,
                maxLevel,
                levelMax,
                totalMax,
                name: curInfo?.name || `Lv.${level}`,
                desc: curInfo?.desc || '',
            };
        },

        // ★ 阶段 cap 只对养成属性生效
        getStatCap(bond, key) {
            if (this._getStatBucket(bond, key) !== 'bondStats') return null;

            const stage = this.getCurrentStage(bond);
            if (!stage?.caps) return null;
            const v = stage.caps[key];
            return (typeof v === 'number' && v > 0) ? v : null;
        },

        isStatCapped(bond, key) {
            const cap = this.getStatCap(bond, key);
            if (cap === null) return false;
            const s = this.getStat(bond, key);
            if (!s) return false;
            return (Number(s.value) || 0) >= cap;
        },

        setStatValue(bond, key, value) {
            const s = this.getStat(bond, key);
            if (!s) return false;

            const min = (typeof s.min === 'number') ? s.min : 0;
            const v = Number(value) || 0;

            const hasRule = this.isStatUpgradable(bond, key);

            if (hasRule) {
                s.value = Math.max(min, v);
            } else if (typeof s.max === 'number' && s.max > 0) {
                s.value = Math.max(min, Math.min(s.max, v));
            } else {
                s.value = Math.max(min, v);
            }
            return true;
        },

        addStatValue(bond, key, delta) {
            const s = this.getStat(bond, key);
            if (!s) return false;

            const bucket = this._getStatBucket(bond, key);

            const oldValue = Number(s.value) || 0;
            let newValue = oldValue + delta;

            // ★ 只有养成属性检查阶段 cap
            if (bucket === 'bondStats' && delta > 0) {
                const cap = this.getStatCap(bond, key);
                if (cap !== null) {
                    if (oldValue >= cap) {
                        return false;
                    }
                    newValue = Math.min(newValue, cap);
                }
            }

            this.setStatValue(bond, key, newValue);
            this._checkLevelUp(bond, key, oldValue, Number(s.value) || 0);

            // 数值变化后重新计算 pending 阶段
            this.recalcStage(bond);

            return true;
        },

        // ★ 只有养成属性写里程碑
        _checkLevelUp(bond, key, oldValue, newValue) {
            const rule = bond.rules?.levelRules?.[key];
            if (!rule) return;

            const bucket = this._getStatBucket(bond, key);
            if (bucket !== 'bondStats') return;

            const levelMax = rule.levelMax || 100;
            const maxLevel = rule.maxLevel || 99;

            const oldLevel = Math.min(Math.floor(oldValue / levelMax) + 1, maxLevel);
            const newLevel = Math.min(Math.floor(newValue / levelMax) + 1, maxLevel);

            if (newLevel <= oldLevel) return;

            const s = this.getStat(bond, key);
            const label = s?.label || key;

            for (let lv = oldLevel + 1; lv <= newLevel; lv++) {
                const info = (rule.levels || []).find(l => l.level === lv);
                this.addMilestone(bond, {
                    type: 'levelup',
                    title: `${label} 达到 ${lv} 级「${info?.name || '未知'}」`,
                    detail: info?.desc || '',
                });

                // ★ 应用升级奖励
                if (Array.isArray(rule.onLevelUp) && rule.onLevelUp.length > 0) {
                    this._applyLevelUpEffects(bond, rule.onLevelUp, lv);
                }
            }
        },

        // ★ 新增：应用升级奖励
        _applyLevelUpEffects(bond, effects, newLevel) {
            const applied = [];

            for (const eff of effects) {
                if (!eff?.target) continue;

                const delta = Number(eff.delta) || 0;
                if (delta === 0) continue;

                const s = this.getStat(bond, eff.target);
                if (!s) {
                    console.warn(`[Companion] 升级奖励：找不到属性 ${eff.target}`);
                    continue;
                }

                const oldValue = Number(s.value) || 0;
                const newValue = oldValue + delta;

                // ★ 只 set，不走 addStatValue（避免递归触发升级）
                this.setStatValue(bond, eff.target, newValue);

                applied.push(`${s.label || eff.target} ${delta > 0 ? '+' : ''}${delta}`);
            }

            if (applied.length > 0) {
                this._log(bond, `⭐ 升级奖励：${applied.join('、')}`);
            }
        },

        // ============================================================
        // 里程碑
        // ============================================================
        addMilestone(bond, ms) {
            if (!bond) return null;
            if (!Array.isArray(bond.milestones)) bond.milestones = [];

            const entry = {
                id: `ms_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                ts: Date.now(),
                type: ms.type || 'event',
                title: ms.title || '',
                detail: ms.detail || '',
                chapterId: ms.chapterId || null,
            };
            bond.milestones.push(entry);

            if (bond.milestones.length > 100) {
                bond.milestones = bond.milestones.slice(-100);
            }
            return entry;
        },

        // ============================================================
        // 行动
        // ============================================================
        getAction(bond, actionId) {
            if (!bond?.actions) return null;
            return bond.actions.find(a => a.id === actionId) || null;
        },

        isActionAvailable(bond, actionId) {
            const action = this.getAction(bond, actionId);
            if (!action) return false;
            if (action.cooldown === 'none') return true;
            if (!action.lastUsedAt) return true;

            const totalMin = this._readTotalMinutes();
            const lastMin = this._parseTotalMinutes(action.lastUsedAt);
            if (lastMin === null) return true;

            if (action.cooldown === 'daily') {
                const lastDay = Math.floor(lastMin / 1440);
                const curDay = Math.floor(totalMin / 1440);
                return curDay > lastDay;
            }
            if (action.cooldown === 'hourly') {
                const lastHour = Math.floor(lastMin / 60);
                const curHour = Math.floor(totalMin / 60);
                return curHour > lastHour;
            }
            return true;
        },

        isActionCapped(bond, actionId) {
            const action = this.getAction(bond, actionId);
            if (!action) return false;

            const effects = action.effects || {};
            const positiveKeys = Object.entries(effects)
                .filter(([k, v]) => v > 0)
                .map(([k]) => k);

            if (positiveKeys.length === 0) return false;

            // ★ 只检查养成属性的 cap
            return positiveKeys.every(k =>
                this._getStatBucket(bond, k) === 'bondStats'
                    ? this.isStatCapped(bond, k)
                    : false   // 角色属性不受 cap 限制
            );
        },

        canPerformAction(bond, actionId) {
            if (!this.isActionAvailable(bond, actionId)) {
                return { ok: false, reason: 'cooldown', message: '冷却中' };
            }
            if (this.isActionCapped(bond, actionId)) {
                return { ok: false, reason: 'capped', message: '已达当前上限' };
            }
            return { ok: true };
        },

        markActionUsed(bond, actionId) {
            const action = this.getAction(bond, actionId);
            if (!action) return;
            action.lastUsedAt = this._formatTotalMinutes(this._readTotalMinutes());
        },

        // ============================================================
        // 阶段
        // ============================================================
        getStage(bond, stageId) {
            if (!bond?.stages) return null;
            return bond.stages.find(s => s.id === stageId) || null;
        },

        getCurrentStage(bond) {
            if (!bond) return null;
            return this.getStage(bond, bond.currentStageId);
        },

        getPendingStage(bond) {
            if (!bond?.pendingStageId) return null;
            return this.getStage(bond, bond.pendingStageId);
        },

        _matchStage(bond, stage) {
            if (!stage?.minStat) return true;

            for (const [k, cond] of Object.entries(stage.minStat)) {
                const s = this.getStat(bond, k);
                if (!s) return false;

                if (cond.level !== undefined) {
                    const curLevel = this.getStatLevel(bond, k) || 1;
                    if (curLevel < cond.level) return false;
                }

                if (cond.value !== undefined) {
                    if ((Number(s.value) || 0) < cond.value) return false;
                }
            }
            return true;
        },

        recalcStage(bond) {
            if (!bond?.stages?.length) return null;

            if (!bond.currentStageId) {
                bond.currentStageId = bond.stages[0].id;
            }

            const curIdx = bond.stages.findIndex(s => s.id === bond.currentStageId);
            const curStage = curIdx >= 0 ? bond.stages[curIdx] : bond.stages[0];

            let nextReachable = null;
            for (let i = curIdx + 1; i < bond.stages.length; i++) {
                if (this._matchStage(bond, bond.stages[i])) {
                    nextReachable = bond.stages[i];
                } else {
                    break;
                }
            }

            bond.pendingStageId = nextReachable?.id || null;
            return curStage;
        },

        async enterStage(bond, stageId) {
            const stage = this.getStage(bond, stageId);
            if (!stage) {
                console.warn(`[Companion] enterStage: 阶段 ${stageId} 不存在`);
                return false;
            }

            if (bond.pendingStageId !== stageId) {
                console.warn(`[Companion] enterStage: ${stageId} 不是当前可进入的阶段（pending=${bond.pendingStageId}）`);
                return false;
            }

            bond.currentStageId = stageId;
            bond.pendingStageId = null;
            stage.storyTriggered = true;

            this.addMilestone(bond, {
                type: 'stage',
                title: `关系进入「${stage.name}」`,
                detail: stage.desc || '',
            });
            this._log(bond, `🎖️ 关系进展：${stage.name}`);

            this.recalcStage(bond);

            console.log(`[Companion] ${bond.name} 进入阶段：${stage.name}`);
            return true;
        },

        getNextStage(bond) {
            if (!bond?.stages?.length) return null;
            const curIdx = bond.stages.findIndex(s => s.id === bond.currentStageId);
            if (curIdx < 0 || curIdx >= bond.stages.length - 1) return null;
            return bond.stages[curIdx + 1];
        },

        canTriggerStageStory(bond, stageId) {
            const stage = this.getStage(bond, stageId);
            if (!stage) return false;
            if (stage.storyTriggered) return false;
            if (bond.pendingStageId !== stageId) return false;
            return this._matchStage(bond, stage);
        },

        // ============================================================
        // 日志
        // ============================================================
        _log(bond, text) {
            if (!bond.log) bond.log = [];
            bond.log.push({ ts: Date.now(), text });
            if (bond.log.length > 100) bond.log = bond.log.slice(-100);
        },

        // ============================================================
        // 经历
        // ============================================================
        addExperience(bond, exp) {
            if (!bond) return null;
            bond.profile = bond.profile || this._emptyProfile();
            bond.profile.experiences = bond.profile.experiences || [];

            const entry = {
                id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                ts: Date.now(),
                chapterId: exp.chapterId || null,
                title: exp.title || '无题',
                text: exp.text || '',
                source: exp.source || 'manual',
            };
            bond.profile.experiences.push(entry);

            if (bond.profile.experiences.length > 200) {
                bond.profile.experiences = bond.profile.experiences.slice(-200);
            }
            return entry;
        },

        // ============================================================
        // 档案更新
        // ============================================================
        applyProfileUpdates(bond, updates) {
            if (!bond || !updates || typeof updates !== 'object') return false;

            bond.profile = bond.profile || this._emptyProfile();
            const p = bond.profile;
            let changed = false;

            for (const [key, val] of Object.entries(updates)) {
                if (!val) continue;

                const mapped = PROFILE_KEY_MAP[key] || key;
                if (['gender', 'age', 'personality', 'mood', 'appearance', 'outfit', 'background', 'status'].includes(mapped)) {
                    if (p[mapped] !== val) {
                        p[mapped] = val;
                        changed = true;
                    }
                } else {
                    p._extra = p._extra || {};
                    p._extraOrder = p._extraOrder || [];
                    if (p._extra[key] !== val) {
                        p._extra[key] = val;
                        if (!p._extraOrder.includes(key)) p._extraOrder.push(key);
                        changed = true;
                    }
                }
            }
            return changed;
        },

        // ============================================================
        // 应用 AI 生成的数据
        // ============================================================
        applyAIData(bond, data) {
            if (!data) return;

            // ---------- profile ----------
            if (data.profile && typeof data.profile === 'object') {
                bond.profile = bond.profile || this._emptyProfile();
                const p = bond.profile;
                const src = data.profile;

                if (src.gender) p.gender = src.gender;
                if (src.age) p.age = src.age;
                if (src.personality) p.personality = src.personality;
                if (src.mood) p.mood = src.mood;
                if (src.appearance) p.appearance = src.appearance;
                if (src.outfit) p.outfit = src.outfit;
                if (src.background) p.background = src.background;
                if (src.status) p.status = src.status;

                if (src._extra && typeof src._extra === 'object') {
                    p._extra = p._extra || {};
                    p._extraOrder = p._extraOrder || [];
                    for (const [k, v] of Object.entries(src._extra)) {
                        p._extra[k] = v;
                        if (!p._extraOrder.includes(k)) p._extraOrder.push(k);
                    }
                }
            }

            // ---------- experiences ----------
            if (Array.isArray(data.experiences)) {
                for (const exp of data.experiences) {
                    if (!exp?.title) continue;
                    this.addExperience(bond, {
                        title: exp.title,
                        text: exp.text || '',
                        source: 'init',
                    });
                }
            }

            // ---------- ★ 角色属性（stats） ----------
            if (data.stats && typeof data.stats === 'object') {
                bond.stats = {};
                bond.statsOrder = [];
                for (const [key, def] of Object.entries(data.stats)) {
                    bond.stats[key] = {
                        value: Number(def.value) || 0,
                        max: (typeof def.max === 'number' && def.max > 0) ? def.max : null,
                        min: Number(def.min) || 0,
                        label: def.label || key,
                        emoji: def.emoji || '·',
                        desc: def.desc || '',
                    };
                    bond.statsOrder.push(key);
                }
            }

            // ---------- ★ 养成属性（bondStats） ----------
            if (data.bondStats && typeof data.bondStats === 'object') {
                bond.bondStats = {};
                bond.bondStatsOrder = [];
                for (const [key, def] of Object.entries(data.bondStats)) {
                    bond.bondStats[key] = {
                        value: Number(def.value) || 0,
                        max: (typeof def.max === 'number' && def.max > 0) ? def.max : null,
                        min: Number(def.min) || 0,
                        label: def.label || key,
                        emoji: def.emoji || '·',
                        desc: def.desc || '',
                    };
                    bond.bondStatsOrder.push(key);
                }
            }

            // ---------- levelRules ----------
            if (data.levelRules && typeof data.levelRules === 'object') {
                bond.rules = bond.rules || { levelRules: {} };
                bond.rules.levelRules = data.levelRules;
            }

            // ---------- actions ----------
            if (Array.isArray(data.actions)) {
                bond.actions = data.actions.map(a => ({
                    id: a.id,
                    name: a.name,
                    emoji: a.emoji || '⚡',
                    desc: a.desc || '',
                    cost: a.cost || {},
                    effects: a.effects || {},
                    cooldown: a.cooldown || 'daily',
                    lastUsedAt: null,
                }));
            }

            // ---------- stages ----------
            if (Array.isArray(data.stages)) {
                bond.stages = data.stages.map(s => ({
                    id: s.id,
                    name: s.name,
                    desc: s.desc || '',
                    minStat: s.minStat || {},
                    caps: s.caps || {},
                    storyTriggered: false,
                }));
            }
            // ★ 兜底属性
            this.ensureBaselineStats(bond);
            bond.currentStageId = null;
            bond.pendingStageId = null;
            this.recalcStage(bond);
        },

        // ============================================================
        // 兜底数据
        // ============================================================
        applyFallbackData(name) {
            const bond = this.ensureBond(name);
            if (!bond) return;

            const record = CharacterRegistry.get(name);

            bond.profile = bond.profile || this._emptyProfile();
            const p = bond.profile;
            p.gender = p.gender || record?.gender || '';
            p.mood = p.mood || record?.mood || '';
            p.status = p.status || record?.status || '';
            p.background = p.background || record?.description || '';

            // ★ 角色属性兜底
            bond.stats = {
                'HP': { value: 100, max: 100, min: 0, label: 'HP', emoji: '❤️', desc: '生命值' },
                '力量': { value: 8, max: null, min: 0, label: '力量', emoji: '💪', desc: '物理攻击强度' },
                '敏捷': { value: 10, max: null, min: 0, label: '敏捷', emoji: '🏃', desc: '闪避与先攻' },
                '体质': { value: 6, max: null, min: 0, label: '体质', emoji: '🛡️', desc: '防御与抗性' },
            };
            bond.statsOrder = ['HP', '力量', '敏捷', '体质'];

            // ★ 养成属性兜底
            bond.bondStats = {
                '好感度': { value: 10, max: 100, min: 0, label: '好感度', emoji: '💗', desc: '她与你的关系深浅' },
                '信任': { value: 5, max: 100, min: 0, label: '信任', emoji: '🤝', desc: '她是否愿意把背后交给你' },
            };
            bond.bondStatsOrder = ['好感度', '信任'];

            // 升级规则：好感度
            bond.rules = {
                levelRules: {
                    '好感度': {
                        levelMax: 100,
                        maxLevel: 5,
                        levels: [
                            { level: 1, name: '陌生', desc: '客套的点头之交' },
                            { level: 2, name: '熟悉', desc: '愿意聊些日常' },
                            { level: 3, name: '亲近', desc: '愿意说心里话' },
                            { level: 4, name: '亲密', desc: '把你当自己人' },
                            { level: 5, name: '挚爱', desc: '心甘情愿' },
                        ],
                    },
                },
            };

            bond.actions = [
                {
                    id: 'chat',
                    name: '闲聊',
                    emoji: '💬',
                    desc: '找个地方坐下来聊聊',
                    cost: { '体力': 5 },
                    effects: { '好感度': +5 },
                    cooldown: 'daily',
                    lastUsedAt: null,
                },
                {
                    id: 'gift',
                    name: '送礼',
                    emoji: '🎁',
                    desc: '送对方一件小礼物',
                    cost: { '金钱': 20 },
                    effects: { '好感度': +10 },
                    cooldown: 'daily',
                    lastUsedAt: null,
                },
            ];

            bond.stages = [
                {
                    id: 'stranger', name: '初识', desc: '还不太熟',
                    minStat: { '好感度': { level: 1 } },
                    caps: { '好感度': 150 },
                    storyTriggered: false,
                },
                {
                    id: 'friend', name: '朋友', desc: '愿意跟你并肩',
                    minStat: { '好感度': { level: 2 } },
                    caps: { '好感度': 350 },
                    storyTriggered: false,
                },
                {
                    id: 'close', name: '挚友', desc: '性命相托',
                    minStat: { '好感度': { level: 4 }, '信任': { value: 50 } },
                    caps: { '好感度': 500 },
                    storyTriggered: false,
                },
            ];

            bond.currentStageId = null;
            bond.pendingStageId = null;
            this.recalcStage(bond);

            bond._initialized = true;
        },

        // ============================================================
        // 时间工具
        // ============================================================
        _readTotalMinutes() {
            try {
                if (window.CWEnv?.parseTotalMinutes && window.CWEnv?.ensureEnvData) {
                    const map = window.MapLauncher?.getMap?.();
                    const env = window.CWEnv.ensureEnvData(map);
                    const t = window.CWEnv.parseTotalMinutes(env);
                    if (typeof t === 'number') return t;
                }
            } catch (e) { /* 忽略 */ }
            return Math.floor(Date.now() / 60000);
        },

        _parseTotalMinutes(str) {
            if (typeof str === 'number') return str;
            if (!str) return null;
            const m = String(str).match(/^(\d+)$/);
            return m ? parseInt(m[1]) : null;
        },

        _formatTotalMinutes(total) {
            return String(Math.floor(total));
        },
    };

    // ============================================================
    // 挂载
    // ============================================================
    window.CompanionManager = CompanionManager;
    window.BondManager = BondManager;

    window.CompanionConstants = {
        COOLDOWN_TYPES,
        PROFILE_KEY_MAP,
    };

        // ============================================================
    // CompanionContext：上下文构建器
    //   供 story.js 的 buildContext 调用
    //   - buildRosterBlock()  → L0 名单（所有队友一句话简介）
    //   - buildFocusBlock(name) → 专注档案（某个队友的详细数据）
    // ============================================================
    const CompanionContext = {
        // ============================================================
        // L0 名单
        // ============================================================
        buildRosterBlock() {
            const bonds = CompanionManager.getAll();
            if (!bonds || bonds.length === 0) return '';

            const lines = [];
            lines.push('【同行者】');
            lines.push('（这些角色目前与玩家同行，可以在剧情中自然出现、对话、行动。）');

            for (const bond of bonds) {
                if (!bond) continue;

                const record = CharacterRegistry.get(bond.name);
                const stage = BondManager.getCurrentStage(bond);
                const profile = bond.profile || {};

                const parts = [];
                if (profile.gender) parts.push(profile.gender);
                if (stage) parts.push(`关系:${stage.name}`);
                if (profile.mood) parts.push(`心情:${profile.mood}`);

                const onMap = bond.summon?.active ? ' [已召唤]' : '';

                let line = `  · ${bond.name}${onMap}`;
                if (parts.length) line += `（${parts.join('，')}）`;

                const brief = profile.personality
                    || profile.background?.substring(0, 40)
                    || record?.description?.substring(0, 40);
                if (brief) line += `：${brief}`;

                lines.push(line);
            }

            return lines.join('\n');
        },

        // ============================================================
        // 专注档案
        // ============================================================
        buildFocusBlock(name) {
            if (!name) return '';
            const bond = BondManager.getBond(name);
            if (!bond) return '';

            const record = CharacterRegistry.get(name);
            const profile = bond.profile || {};
            const stage = BondManager.getCurrentStage(bond);

            const lines = [];
            lines.push(`【队友档案：${bond.name}】`);

            if (profile.gender) lines.push(`- 性别：${profile.gender}`);
            if (profile.age) lines.push(`- 年龄：${profile.age}`);
            if (profile.personality) lines.push(`- 性格：${profile.personality}`);
            if (profile.mood) lines.push(`- 当前心情：${profile.mood}`);
            if (profile.appearance) lines.push(`- 外貌：${profile.appearance}`);
            if (profile.outfit) lines.push(`- 穿着：${profile.outfit}`);
            if (profile.status) lines.push(`- 健康状态：${profile.status}`);
            if (profile.background) lines.push(`- 背景故事：${profile.background}`);

            if (stage) {
                lines.push(`- 当前关系：${stage.name}（${stage.desc || ''}）`);
            }

            if (bond.bondStatsOrder?.length) {
                lines.push('- 养成属性：');
                for (const key of bond.bondStatsOrder) {
                    const s = bond.bondStats[key];
                    if (!s) continue;
                    const levelInfo = BondManager.getStatLevelInfo(bond, key);
                    let line = `  · ${s.label || key}：${s.value}`;
                    if (levelInfo) line += `（Lv.${levelInfo.level}「${levelInfo.name}」）`;
                    lines.push(line);
                }
            }

            const exps = (profile.experiences || []).slice(-5);
            if (exps.length > 0) {
                lines.push('- 重要经历：');
                for (const e of exps) {
                    lines.push(`  · 【${e.title}】：${e.text}`);
                }
            }

            return lines.join('\n');
        },
    };

    window.CompanionContext = CompanionContext;

    CompanionManager.ensureStore();
    BondManager.ensureStore();

    console.log('[CinemaWorld/companion] companion-core.js 已加载');
})();