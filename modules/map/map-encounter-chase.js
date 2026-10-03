// ============================================================
// CinemaWorld · map-encounter-chase.js
// 地图遭遇实体主动追击玩家：
//   - 玩家进入索敌范围 → 遭遇实体朝玩家移动
//   - 进入交战距离 → 触发战斗（走 EncounterManager）
//   - 玩家跑远 → 放弃，返回原位附近
//   - 战斗结束 → 给个短冷却，不会立刻又追上来
//
// 依赖：map-environment.js（cw:env-minute）
//       map-canvas.js（MapCanvas / MapLauncher）
//       battle.js（EncounterManager / BattleManager）
//
// 暴露：window.MapEncounterChase
// ============================================================

(function () {
    'use strict';

    const CONFIG = {
        // ★ 索敌范围（曼哈顿距离）：玩家进入 → 开始追
        detectRadius: 8,

        // ★ 交战范围：追到这么近 → 触发战斗
        engageRadius: 1,

        // ★ 放弃范围：玩家跑出这么远 → 不追了
        abandonRadius: 15,

        // 每 N 游戏分钟移动一步
        stepIntervalMinutes: 3,

        // 战斗结束后的冷却（游戏分钟）
        postBattleCooldown: 60,

        // 放弃后的冷却（游戏分钟）：不会立刻再追
        postAbandonCooldown: 30,

        // 同一时间最多几个遭遇在追
        maxChasing: 3,

        // 追击时是否暂停漫步（避免被 wander 甩开）
        // （本模块不直接控制 wander，见文末说明）
        // 由 map-npc-wander 的 _canWander 排除——通过实体上的 meta 标记
        chaseFlagKey: '_encounterChasing',
    };

    const MapEncounterChase = {
        CONFIG,

        _inited: false,

        _state: {
            // { entityId: { startedAt, lastStepAt, gaveUpReason } }
            chasing: {},
            cooldowns: {},   // { entityId: 冷却结束的游戏分钟 }
        },

        // ============================================================
        // 初始化
        // ============================================================
        init() {
            if (this._inited) return;
            this._inited = true;

            window.addEventListener('cw:env-minute', () => this._onMinute());

            // 战斗结束钩子
            window.addEventListener('cw:battle-end', (e) => this._onBattleEnd(e.detail));

            console.log('[EncounterChase] 已初始化');
        },

        // ============================================================
        // 分钟 tick：核心追击循环
        // ============================================================
        _onMinute() {
            const playMode = window.CinemaWorld?.worldState?.playMode;
            if (playMode !== 'map') return;

            const canvas = window.MapCanvas;
            const map = window.MapLauncher?.getMap?.();
            if (!canvas?.player || !map?._generated) return;

            // 正在战斗/剧情 → 不动
            if (window.BattleManager?.isActive?.()) return;
            if (window.VisualNovelManager?.isPlaying) return;

            const grid = map._generated.grid;
            const now = this._readTotalMinutes(map);

            // ---------- 1. 更新每个追者 ----------
            for (const entId of Object.keys(this._state.chasing)) {
                this._updateChaser(entId, map, grid, now);
            }

            // ---------- 2. 尝试招募新追者 ----------
            if (Object.keys(this._state.chasing).length < CONFIG.maxChasing) {
                this._tryRecruitChasers(map, grid, now);
            }

            // ---------- 3. 重绘（只有移动才重绘） ----------
            if (this._dirty) {
                this._dirty = false;
                if (window.MapCanvas?.canvas) window.MapCanvas._render();
                window.MapLauncher?._saveMapToWorld?.(map);
            }
        },

        // ============================================================
        // 更新单个追者
        // ============================================================
        _updateChaser(entId, map, grid, now) {
            const canvas = window.MapCanvas;
            const ent = map.entities.find(e => e.id === entId);
            if (!ent || !ent._placed) {
                this._dropChaser(entId, map, 'entity-gone');
                return;
            }

            const px = canvas.player.x;
            const py = canvas.player.y;
            const dist = Math.abs(ent.x - px) + Math.abs(ent.y - py);

            // ---------- 玩家跑远 → 放弃 ----------
            if (dist > CONFIG.abandonRadius) {
                this._dropChaser(entId, map, 'abandoned');
                this._state.cooldowns[entId] = now + CONFIG.postAbandonCooldown;
                console.log(`[EncounterChase] ${ent.name} 放弃追击（玩家跑远）`);
                return;
            }

            // ---------- 已经贴脸 → 触发战斗 ----------
            if (dist <= CONFIG.engageRadius) {
                this._startBattle(ent, map);
                return;
            }

            // ---------- 节流：两次移动之间至少 N 分钟 ----------
            const info = this._state.chasing[entId];
            if (now - info.lastStepAt < CONFIG.stepIntervalMinutes) return;
            info.lastStepAt = now;

            // ---------- 走一步 ----------
            const moved = this._stepToward(ent, px, py, map, grid);
            if (moved) this._dirty = true;
        },

        // ============================================================
        // 招募新追者
        // ============================================================
        _tryRecruitChasers(map, grid, now) {
            const canvas = window.MapCanvas;
            const px = canvas.player.x;
            const py = canvas.player.y;

            // 已经在追的 id 集合
            const chasingIds = new Set(Object.keys(this._state.chasing));

            const candidates = [];

            for (const ent of map.entities) {
                if (!this._isChaseable(ent)) continue;
                if (chasingIds.has(ent.id)) continue;

                // 冷却中
                const cd = this._state.cooldowns[ent.id];
                if (cd && now < cd) continue;

                const dist = Math.abs(ent.x - px) + Math.abs(ent.y - py);
                if (dist > CONFIG.detectRadius) continue;
                if (dist <= CONFIG.engageRadius) {
                    // 就在脸上，直接战斗
                    this._startBattle(ent, map);
                    return;
                }

                candidates.push({ ent, dist });
            }

            if (candidates.length === 0) return;

            // 按距离排序，选最近的几个
            candidates.sort((a, b) => a.dist - b.dist);
            const slots = CONFIG.maxChasing - Object.keys(this._state.chasing).length;
            const picked = candidates.slice(0, slots);

            for (const { ent } of picked) {
                this._state.chasing[ent.id] = {
                    startedAt: now,
                    lastStepAt: now,
                };
                // ★ 给实体打标记：wander 会跳过这个 NPC
                ent.meta = ent.meta || {};
                ent.meta[CONFIG.chaseFlagKey] = true;

                console.log(`[EncounterChase] ${ent.name} 开始追击玩家`);

                // 立即走一步
                this._stepToward(ent, px, py, map, grid);
                this._dirty = true;
            }
        },

        // ============================================================
        // 判定：这个实体能被追吗
        // ============================================================
        _isChaseable(ent) {
            if (!ent) return false;
            if (!ent._placed) return false;
            if (ent.isPlayer) return false;
            if (ent.kind !== 'encounter') return false;
            if (typeof ent.x !== 'number' || typeof ent.y !== 'number') return false;

            // 死了/空了
            if (ent.count !== undefined && ent.count <= 0) return false;

            // 主线/任务目标不动（避免破坏任务流程）
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            if (mq?.active && mq.status === 'active'
                && mq.target.kind === 'entity'
                && mq.target.entityId === ent.id) {
                return false;
            }
            if (ent.meta?.questId || ent.meta?.questTarget) return false;

            // 显式禁止
            if (ent.tags?.includes('不追击') || ent.tags?.includes('固定')) return false;

            return true;
        },

        // ============================================================
        // 朝玩家走一步
        // ============================================================
        _stepToward(ent, px, py, map, grid) {
            const dx = px - ent.x;
            const dy = py - ent.y;

            // 差值大的轴优先，斜向兜底
            const moves = [];
            if (Math.abs(dx) >= Math.abs(dy)) {
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
            } else {
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
            }
            if (dx !== 0 && dy !== 0) moves.push([Math.sign(dx), Math.sign(dy)]);

            const occupied = this._buildOccupied(map.entities);

            for (const [mx, my] of moves) {
                const nx = ent.x + mx;
                const ny = ent.y + my;
                if (!this._canStandOn(nx, ny, ent, map, grid, occupied)) continue;

                // 视觉补间
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

                // 更新区域
                const cell = grid[ny]?.[nx];
                if (cell?.regionId && cell.regionId !== ent.region) {
                    ent.region = cell.regionId;
                }

                return true;
            }

            return false;
        },

        _buildOccupied(entities) {
            const set = new Set();
            for (const e of entities) {
                if (!e._placed) continue;
                if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
                if (e.kind === 'building') continue;
                set.add(`${e.x},${e.y}`);
            }
            return set;
        },

        _canStandOn(x, y, ent, map, grid, occupied) {
            if (y < 0 || y >= grid.length) return false;
            if (x < 0 || x >= grid[0].length) return false;

            const cell = grid[y][x];
            if (!cell) return false;
            if (!cell.walkable) return false;
            if (cell.terrain === 'void') return false;
            if (cell.decor) return false;
            if (cell.portal) return false;

            // 被其他实体占了，但玩家例外（要能贴上玩家）
            if (occupied.has(`${x},${y}`)) {
                const player = window.MapCanvas?.player;
                if (player && player.x === x && player.y === y) {
                    // 目标就是玩家 → 允许
                } else {
                    return false;
                }
            }

            // 不跨区域（可选，注释掉允许跨区追击）
            // if (cell.regionId && ent.region && cell.regionId !== ent.region) return false;

            return true;
        },

        // ============================================================
        // 触发战斗
        // ============================================================
        async _startBattle(ent, map) {
            // 立刻从追者列表里拿掉，避免重复触发
            this._dropChaser(ent.id, map, 'engaged');

            // 冷却也要打上（不管战斗结果）
            const now = this._readTotalMinutes(map);
            this._state.cooldowns[ent.id] = now + CONFIG.postBattleCooldown;

            if (!window.EncounterManager) {
                console.warn('[EncounterChase] EncounterManager 未加载');
                return;
            }

            // 记录一下"是追击触发的"，战斗中/结束后可用
            ent.meta = ent.meta || {};
            ent.meta._battleTriggeredByChase = true;

            console.log(`[EncounterChase] ${ent.name} 追上玩家，触发战斗`);

            // 交给 EncounterManager（和玩家主动点击遭遇实体走同一条路）
            try {
                await window.EncounterManager.startEncounter(ent.id, {
                    fromMap: true,
                    byChase: true,
                });
            } catch (e) {
                console.error('[EncounterChase] 触发战斗失败:', e);
            }

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            window.MapLauncher?._saveMapToWorld?.(map);
        },

        // ============================================================
        // 移除追者
        // ============================================================
        _dropChaser(entId, map, reason = '') {
            const info = this._state.chasing[entId];
            if (!info) return;

            delete this._state.chasing[entId];

            // 清掉实体上的标记
            const ent = map?.entities?.find(e => e.id === entId);
            if (ent?.meta) {
                ent.meta[CONFIG.chaseFlagKey] = false;
            }

            console.log(`[EncounterChase] 停止追击 ${entId} (${reason})`);
        },

        // ============================================================
        // 战斗结束回调
        // ============================================================
        _onBattleEnd(detail) {
            // detail 由 battle.js 决定是否有；保守处理
            const entId = detail?.enemyEntityId || detail?.entityId;
            if (!entId) return;

            const map = window.MapLauncher?.getMap?.();
            if (!map) return;

            // 冷却再压一遍，防止战斗结束后立刻被重新招募
            const now = this._readTotalMinutes(map);
            this._state.cooldowns[entId] = now + CONFIG.postBattleCooldown;
        },

        // ============================================================
        // 工具
        // ============================================================
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

        // ============================================================
        // 切地图时重置
        // ============================================================
        resetState() {
            const map = window.MapLauncher?.getMap?.();
            if (map?.entities) {
                for (const e of map.entities) {
                    if (e.meta?.[CONFIG.chaseFlagKey]) {
                        e.meta[CONFIG.chaseFlagKey] = false;
                    }
                }
            }
            this._state.chasing = {};
            // 冷却保留（跨地图依然记仇）
            this._dirty = false;
        },

        _dirty: false,
    };

    window.MapEncounterChase = MapEncounterChase;

    function boot() {
        MapEncounterChase.init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld] map-encounter-chase.js 已加载');
})();