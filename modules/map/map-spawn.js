// ============================================================
// CinemaWorld · map-spawn.js
// 怪物刷新：进图时懒刷新
//   - 记录被消灭的 encounter
//   - 跨过刷新周期后重新生成
//   - 支持"血月"（特殊日期/天气时刷新翻倍）
// 依赖：map-environment.js（游戏时间）
// 暴露：window.MapSpawn
// ============================================================

(function () {
    'use strict';

    if (window.MapSpawn) return;

    const CONFIG = {
        // 默认刷新周期（游戏小时）
        defaultRefreshHours: 24,

        // 地图级最大存活数
        maxAlive: 8,

        // 血月判定
        bloodMoon: {
            // 满月日（每月）
            fullMoonDays: [15],
            // 或特定天气
            weathers: ['雷阵雨'],
            // 血月时刷新周期减半
            refreshMultiplier: 0.5,
            // 血月时刷怪数量翻倍
            countMultiplier: 2,
        },
    };

    const MapSpawn = {
        CONFIG,

        // ============================================================
        // 进图时调用：懒刷新
        // ============================================================
        onMapEnter(map) {
            if (!map?._generated) return;
            if (map._source === 'program') return;   // 程序生成的建筑内部不刷
            if (map.tags?.includes('no-spawn')) return;

            const nowMinutes = window.CinemaWorld?.worldState?.worldMinutes ?? 0;
            const isBloodMoon = this._isBloodMoon(map);

            // ---------- 1. 恢复"该刷但没刷"的怪 ----------
            const spawned = this._respawnAll(map, nowMinutes, isBloodMoon);

            // ---------- 2. 记录本次刷新的时间 ----------
            map._spawnState = map._spawnState || {};
            map._spawnState.lastCheckAt = nowMinutes;

            if (spawned > 0) {
                console.log(`[MapSpawn] ${map.name} 刷新了 ${spawned} 只怪` +
                    (isBloodMoon ? '（血月）' : ''));

                // 通知 3D
                window.CWNotify3D?.('entity-add');

                // 保存
                window.MapLauncher?._saveMapToWorld?.(map);
            }
        },

        // ============================================================
        // 记录一个 encounter 被消灭
        //   （由 map-interact.js / battle 结束回调触发）
        // ============================================================
        onEncounterDefeated(map, entity) {
            if (!map || !entity) return;
            if (entity.kind !== 'encounter') return;

            map._spawnState = map._spawnState || {};
            map._spawnState.defeated = map._spawnState.defeated || {};

            // 记录：名字 + 区域 + 消灭时间
            const key = `${entity.name}@${entity.region || 'unknown'}`;
            const now = window.CinemaWorld?.worldState?.worldMinutes ?? 0;

            map._spawnState.defeated[key] = {
                name: entity.name,
                emoji: entity.emoji,
                region: entity.region,
                position: entity.position,
                fields: { ...(entity.fields || {}) },   // ★ 保留原属性
                tags: [...(entity.tags || [])],
                count: entity.count || 1,
                countMode: entity.countMode || 'single',
                defeatedAt: now,
                description: entity.description || '',
                meta: { ...(entity.meta || {}) },
            };

            console.log(`[MapSpawn] 记录消灭: ${key}`);
        },

        // ============================================================
        // 检查是否有怪可以重生
        // ============================================================
        _respawnAll(map, nowMinutes, isBloodMoon) {
            const state = map._spawnState;
            if (!state?.defeated) return 0;

            const refreshHours = isBloodMoon
                ? CONFIG.defaultRefreshHours * CONFIG.bloodMoon.refreshMultiplier
                : CONFIG.defaultRefreshHours;
            const refreshMinutes = refreshHours * 60;

            let spawned = 0;

            // 当前存活数
            let alive = map.entities.filter(e =>
                e.kind === 'encounter' && e._placed && (e.count || 1) > 0
            ).reduce((sum, e) => sum + (e.count || 1), 0);

            for (const [key, record] of Object.entries(state.defeated)) {
                // 检查是否已刷新
                const elapsed = nowMinutes - record.defeatedAt;
                if (elapsed < refreshMinutes) continue;

                // 检查是否已经在地图上（防止重复刷）
                const exists = map.entities.some(e =>
                    e.kind === 'encounter' &&
                    e.name === record.name &&
                    e.region === record.region
                );
                if (exists) {
                    // 已经存在 → 从记录里删掉
                    delete state.defeated[key];
                    continue;
                }

                // 检查上限
                if (alive >= CONFIG.maxAlive) continue;

                // 生成
                const ent = this._buildRespawn(record, map, isBloodMoon);
                if (this._placeEntity(ent, map)) {
                    map.entities.push(ent);
                    spawned++;
                    alive += ent.count || 1;

                    // 从记录里删掉
                    delete state.defeated[key];
                }
            }

            return spawned;
        },

        // ============================================================
        // 构造重生实体
        // ============================================================
        _buildRespawn(record, map, isBloodMoon) {
            const countMul = isBloodMoon ? CONFIG.bloodMoon.countMultiplier : 1;
            const newCount = (record.count || 1) * countMul;

            return {
                id: `enc_${record.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: record.name,
                emoji: record.emoji || '👹',
                kind: 'encounter',
                region: record.region,
                position: record.position || 'center',
                blocking: true,
                isPlayer: false,
                tags: [...(record.tags || []), '重生'],
                description: record.description || '',
                meta: { ...(record.meta || {}) },
                status: '',
                effect: '',
                fields: {
                    ...(record.fields || {}),
                    '数量': String(newCount),
                },
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: newCount,
                countMode: newCount > 1 ? 'cluster' : 'single',
                stackable: false,
                maxStack: null,
                type: 'encounter',
            };
        },

        // ============================================================
        // 摆放（复用 MapLayout._resolvePosition）
        // ============================================================
        _placeEntity(ent, map) {
            if (!map._generated) return false;

            const used = new Set(
                map.entities.filter(e => e._placed).map(e => `${e.x},${e.y}`)
            );

            const pos = window.MapLayout?._resolvePosition?.(
                ent,
                map._generated.grid,
                map._generated.placements,
                used
            );

            if (pos) {
                ent.x = pos.x;
                ent.y = pos.y;
                ent._placed = true;
                return true;
            }

            // 兜底：全局扫描
            const grid = map._generated.grid;
            for (let y = 0; y < grid.length; y++) {
                for (let x = 0; x < grid[0].length; x++) {
                    const c = grid[y][x];
                    if (!c) continue;
                    if (!c.walkable) continue;
                    if (c.terrain === 'void') continue;
                    if (c.decor) continue;
                    if (c.portal) continue;
                    if (used.has(`${x},${y}`)) continue;

                    ent.x = x;
                    ent.y = y;
                    ent._placed = true;
                    return true;
                }
            }

            return false;
        },

        // ============================================================
        // 血月判定
        // ============================================================
        _isBloodMoon(map) {
            const env = window.CWEnv?.ensureEnvData?.(map);
            if (!env) return false;

            const weather = window.CWEnv?.readField?.(env, '天气') || '';
            if (CONFIG.bloodMoon.weathers.some(w => weather.includes(w))) {
                return true;
            }

            // 日期判定：每月 15 号
            const dateStr = window.CWEnv?.readField?.(env, '日期') || '';
            const m = dateStr.match(/(\d+)年(\d+)月(\d+)日/);
            if (m) {
                const day = parseInt(m[3]);
                if (CONFIG.bloodMoon.fullMoonDays.includes(day)) {
                    return true;
                }
            }

            return false;
        },

        // ============================================================
        // 清空刷新记录（调试用）
        // ============================================================
        clearState(map) {
            if (!map) return;
            map._spawnState = null;
            console.log(`[MapSpawn] 已清空 ${map.name} 的刷新状态`);
        },
    };

    window.MapSpawn = MapSpawn;
    console.log('[CinemaWorld] map-spawn.js 已加载');
})();