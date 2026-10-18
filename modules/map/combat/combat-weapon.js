// ============================================================
// CinemaWorld · combat-weapon.js
// 即时战斗 · 武器数据层
// ============================================================

(function () {
    'use strict';

    const CombatWeapon = {
        extractSecondBracket(line) {
            if (!line) return null;
            const s = String(line);
            const all = [...s.matchAll(/[\[【]([^\[\]【】]*)[\]】]/g)];
            if (all.length < 2) return null;
            return all[all.length - 1][1].trim();
        },

        parseCombatFields(text) {
            if (!text) return null;

            const kv = {};
            for (const pair of String(text).split('|')) {
                const m = pair.match(/^(.+?)\s*[:：]\s*(.+)$/);
                if (m) kv[m[1].trim()] = m[2].trim();
            }

            let type = kv['攻击方式'] || '近战';
            if (!['近战', '远程'].includes(type)) {
                if (/远程|弓|枪|射|range|ranged/i.test(type)) type = '远程';
                else type = '近战';
            }

            const distStr = String(kv['攻击距离'] || '').trim();
            let range;
            if (!distStr) {
                range = { min: 1, max: type === '远程' ? 5 : 1 };
            } else {
                const m = distStr.match(/^(\d+)\s*[-~到—～]\s*(\d+)$/);
                if (m) {
                    range = {
                        min: Math.max(1, parseInt(m[1])),
                        max: Math.max(1, parseInt(m[2])),
                    };
                } else {
                    const n = parseInt(distStr.replace(/[^\d]/g, ''));
                    if (isNaN(n) || n < 1) {
                        range = { min: 1, max: type === '远程' ? 5 : 1 };
                    } else {
                        range = type === '远程'
                            ? { min: 1, max: n }
                            : { min: 1, max: 1 };
                    }
                }
            }

            if (range.min > range.max) range.min = range.max;

            const interval = this._parseNumber(kv['攻击间隔'], type === '远程' ? 1200 : 800);
            const twoHanded = this._toBool(kv['占用双手']);
            let dualWield = this._toBool(kv['可双持']);
            if (twoHanded) dualWield = false;

            return {
                type,
                range,
                interval,
                twoHanded,
                dualWield,
            };
        },

        getCombatData(equipment) {
            if (!equipment) return null;
            if (equipment.combat) return equipment.combat;

            const typeField = String(equipment.fields?.['类型'] || equipment.type || '').trim();
            const isWeapon = /武器|weapon|武器类/i.test(typeField);

            if (!isWeapon) return null;

            return {
                type: '近战',
                range: { min: 1, max: 1 },
                interval: 800,
                twoHanded: false,
                dualWield: false,
                _fallback: true,
            };
        },

        isCombatWeapon(equipment) {
            return this.getCombatData(equipment) !== null;
        },

        getAttackTargets(player, facing, combatData, map) {
            if (!player || !combatData || !map?._generated) {
                return { cells: [], entities: [] };
            }

            const grid = map._generated.grid;
            const px = player.x;
            const py = player.y;

            if (combatData.type === '近战') {
                const dir = this._facingToDir(facing);
                const tx = px + dir.x;
                const ty = py + dir.y;

                const cells = [{ x: tx, y: ty }];
                const entities = this._collectEntitiesAt(map, cells);
                return { cells, entities };
            }

            if (combatData.type === '远程') {
                const dir = this._facingToDir(facing);
                const cells = [];

                const min = combatData.range.min;
                const max = combatData.range.max;

                for (let d = 1; d <= max; d++) {
                    const tx = px + dir.x * d;
                    const ty = py + dir.y * d;

                    if (ty < 0 || ty >= grid.length) break;
                    if (tx < 0 || tx >= grid[0].length) break;

                    const cell = grid[ty][tx];
                    if (!cell) break;

                    if (cell.terrain === 'void') break;
                    if (!cell.walkable && !this._isPassableForShot(cell)) break;

                    if (d >= min) {
                        cells.push({ x: tx, y: ty });
                    }
                }

                const entities = this._collectEntitiesAt(map, cells);
                return { cells, entities };
            }

            return { cells: [], entities: [] };
        },

        getFirstEntityInLine(player, facing, combatData, map) {
            const { cells, entities } = this.getAttackTargets(player, facing, combatData, map);
            if (entities.length === 0) return null;
            return entities[0];
        },

        _facingToDir(facing) {
            switch (facing) {
                case 'up': return { x: 0, y: -1 };
                case 'down': return { x: 0, y: 1 };
                case 'left': return { x: -1, y: 0 };
                case 'right': return { x: 1, y: 0 };
                default: return { x: 0, y: 1 };
            }
        },

        _isPassableForShot(cell) {
            if (cell.decor && ['plant', 'flower', 'bush'].includes(cell.decor.type)) {
                return true;
            }
            return false;
        },

        _collectEntitiesAt(map, cells) {
            if (!cells || cells.length === 0) return [];
            if (!map.entities) return [];

            const cellSet = new Set(cells.map(c => `${c.x},${c.y}`));
            const result = [];

            for (const ent of map.entities) {
                if (!ent._placed) continue;
                if (ent.isPlayer) continue;
                if (typeof ent.x !== 'number' || typeof ent.y !== 'number') continue;

                const key = `${ent.x},${ent.y}`;
                if (!cellSet.has(key)) continue;

                if (!this._isAttackable(ent)) continue;

                const idx = cells.findIndex(c => c.x === ent.x && c.y === ent.y);
                result.push({ entity: ent, _order: idx });
            }

            result.sort((a, b) => a._order - b._order);
            return result.map(r => r.entity);
        },

        _isAttackable(ent) {
            if (!ent) return false;
            if (ent.isPlayer) return false;

            // ★ 队友不可被玩家攻击
            if (ent.isCompanion) return false;
            if (ent.kind === 'companion') return false;

            if (ent.kind === 'encounter') return true;
            if (ent.kind === 'npc') return true;

            if (ent.fields?.['HP'] || ent.fields?.['生命'] || ent.fields?.['生命值']) {
                return true;
            }

            if (String(ent.fields?.['可攻击'] || '') === '是') return true;

            return false;
        },

        _parseNumber(v, dflt) {
            if (v === undefined || v === null || v === '') return dflt;
            const n = parseInt(String(v).replace(/[^\d]/g, ''));
            return isNaN(n) ? dflt : n;
        },

        _toBool(v) {
            if (v === true) return true;
            if (v === false || v === undefined || v === null) return false;
            const s = String(v).trim().toLowerCase();
            return ['是', 'yes', 'true', '1', 'y', '可', '能'].includes(s);
        },

        debug(equipment) {
            const data = this.getCombatData(equipment);
            if (!data) {
                console.log('[CombatWeapon]', equipment?.name, '→ 非武器');
                return;
            }
            console.log('[CombatWeapon]', equipment.name, {
                type: data.type,
                range: `${data.range.min}~${data.range.max}`,
                interval: `${data.interval}ms`,
                twoHanded: data.twoHanded,
                dualWield: data.dualWield,
                fallback: !!data._fallback,
            });
        },
    };

    window.CombatWeapon = CombatWeapon;
    console.log('[CinemaWorld] combat-weapon.js 已加载');
})();