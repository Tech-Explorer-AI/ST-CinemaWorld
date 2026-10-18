// ============================================================
// CinemaWorld · combat-render.js
// 即时战斗 · 2D 渲染
// ============================================================

(function () {
    'use strict';

    const CombatRender = {
        _popups: [],
        _projectiles: [],

        render(ctx, camera, tileSize, cssW, cssH) {
            if (window.CombatState?.isAimed?.()) {
                this._renderAttackRange(ctx, camera, tileSize);
            }

            this._renderEnemyAggroMarkers(ctx, camera, tileSize, cssW, cssH);
            this._renderProjectiles(ctx, camera, tileSize);
            this._renderPopups(ctx, camera, tileSize);
            this._renderCompanionHpBars(ctx, camera, tileSize, cssW, cssH);
        },

        _renderAttackRange(ctx, camera, tileSize) {
            const map = window.MapLauncher?.getMap?.();
            const player = window.MapCanvas?.player;
            if (!map || !player) return;

            const main = window.EquipmentManager?.getMainWeapon?.();
            const off = window.EquipmentManager?.getOffWeapon?.();
            const facing = window.MapSprites?.playerFacing || 'down';

            const weapons = [];
            if (main) {
                const d = window.CombatWeapon.getCombatData(main);
                if (d) weapons.push({ weapon: main, data: d, isMain: true });
            }
            if (off) {
                const d = window.CombatWeapon.getCombatData(off);
                if (d) weapons.push({ weapon: off, data: d, isMain: false });
            }

            if (weapons.length === 0) return;

            const now = performance.now();
            const pulse = 0.35 + Math.sin(now / 300) * 0.15;

            const cellMap = new Map();

            for (const w of weapons) {
                const targets = window.CombatWeapon.getAttackTargets(
                    player, facing, w.data, map
                );

                for (const c of targets.cells) {
                    const key = `${c.x},${c.y}`;
                    if (!cellMap.has(key)) {
                        cellMap.set(key, { x: c.x, y: c.y, isMain: w.isMain });
                    }
                }
            }

            ctx.save();
            for (const cell of cellMap.values()) {
                const px = (cell.x - camera.x) * tileSize;
                const py = (cell.y - camera.y) * tileSize;

                const color = cell.isMain
                    ? `rgba(255, 80, 80, ${pulse})`
                    : `rgba(255, 160, 60, ${pulse})`;
                const strokeColor = cell.isMain
                    ? 'rgba(255, 120, 120, 0.9)'
                    : 'rgba(255, 200, 120, 0.9)';

                ctx.fillStyle = color;
                ctx.fillRect(px, py, tileSize, tileSize);

                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = 2;
                ctx.strokeRect(px + 1, py + 1, tileSize - 2, tileSize - 2);
            }
            ctx.restore();
        },

        _renderEnemyAggroMarkers(ctx, camera, tileSize, cssW, cssH) {
            const map = window.MapLauncher?.getMap?.();
            if (!map?.entities) return;

            const now = performance.now();

            for (const ent of map.entities) {
                if (ent.kind !== 'encounter') continue;
                if (!ent._placed) continue;
                if (!ent.meta?._combatAggro) continue;

                const px = (ent.x - camera.x) * tileSize + tileSize / 2;
                const py = (ent.y - camera.y) * tileSize + tileSize / 2;

                if (px < -tileSize || px > cssW + tileSize) continue;
                if (py < -tileSize || py > cssH + tileSize) continue;

                const pulse = 1 + Math.sin(now / 250) * 0.15;
                const r = tileSize * 0.35 * pulse;
                const cy = py - tileSize * 0.65;

                ctx.save();

                const glow = ctx.createRadialGradient(px, cy, 0, px, cy, r * 2);
                glow.addColorStop(0, 'rgba(255, 80, 80, 0.85)');
                glow.addColorStop(0.5, 'rgba(255, 60, 60, 0.4)');
                glow.addColorStop(1, 'rgba(255, 60, 60, 0)');
                ctx.beginPath();
                ctx.arc(px, cy, r * 2, 0, Math.PI * 2);
                ctx.fillStyle = glow;
                ctx.fill();

                ctx.beginPath();
                ctx.arc(px, cy, r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255, 90, 90, 0.92)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255, 40, 40, 1)';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.font = `${Math.floor(tileSize * 0.42)}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#fff';
                ctx.fillText('❗', px, cy);

                ctx.restore();
            }
        },

        drawProjectile(player, facing, cells) {
            if (!cells || cells.length === 0) return;

            const last = cells[cells.length - 1];
            this._projectiles.push({
                from: { x: player.x, y: player.y },
                to: { x: last.x, y: last.y },
                createdAt: performance.now(),
                duration: 200,
                color: 'rgba(255, 220, 100, 0.9)',
            });

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
        },

        _renderProjectiles(ctx, camera, tileSize) {
            const now = performance.now();
            const alive = [];

            for (const p of this._projectiles) {
                const t = (now - p.createdAt) / p.duration;
                if (t >= 1) continue;

                alive.push(p);

                const alpha = 1 - t;
                const fromX = (p.from.x - camera.x) * tileSize + tileSize / 2;
                const fromY = (p.from.y - camera.y) * tileSize + tileSize / 2;
                const toX = (p.to.x - camera.x) * tileSize + tileSize / 2;
                const toY = (p.to.y - camera.y) * tileSize + tileSize / 2;

                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 3;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(fromX, fromY);
                ctx.lineTo(toX, toY);
                ctx.stroke();

                ctx.beginPath();
                ctx.arc(toX, toY, 5, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
                ctx.restore();
            }

            this._projectiles = alive;
        },

        popupAt(gridX, gridY, text, type = 'damage') {
            this._popups.push({
                x: gridX,
                y: gridY,
                text: String(text),
                type,
                createdAt: performance.now(),
                duration: 1200,
            });

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
        },

        popupAtCompat(gridX, gridY, args) {
            const text = args[1] || '?';
            const type = args[2] || 'damage';
            this.popupAt(gridX, gridY, text, type);
        },

        _renderPopups(ctx, camera, tileSize) {
            const now = performance.now();
            const alive = [];

            for (const p of this._popups) {
                const t = (now - p.createdAt) / p.duration;
                if (t >= 1) continue;

                alive.push(p);

                const alpha = t < 0.7 ? 1 : (1 - (t - 0.7) / 0.3);
                const offsetY = t * 40;

                const px = (p.x - camera.x) * tileSize + tileSize / 2;
                const py = (p.y - camera.y) * tileSize + tileSize / 2 - offsetY;

                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.font = `bold ${Math.floor(tileSize * 0.5)}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                const colors = {
                    damage: '#ff5050',
                    crit: '#ffd700',
                    heal: '#50ff80',
                    miss: '#cccccc',
                    info: '#88bbff',
                    'companion-damage': '#7da8ff',
                    'companion-hurt': '#ff9090',
                };
                const color = colors[p.type] || colors.damage;

                ctx.strokeStyle = 'rgba(0,0,0,0.85)';
                ctx.lineWidth = 4;
                ctx.strokeText(p.text, px, py);

                ctx.fillStyle = color;
                ctx.fillText(p.text, px, py);

                ctx.restore();
            }

            this._popups = alive;
        },

        // ============================================================
        // 队友血条
        // ============================================================
        _renderCompanionHpBars(ctx, camera, tileSize, cssW, cssH) {
            const map = window.MapLauncher?.getMap?.();
            if (!map?.entities) return;

            for (const ent of map.entities) {
                if (!ent.isCompanion) continue;
                if (!ent._placed) continue;

                const vx = ent._visualX ?? ent.x;
                const vy = ent._visualY ?? ent.y;
                const px = (vx - camera.x) * tileSize + tileSize / 2;
                const py = (vy - camera.y) * tileSize + tileSize / 2;

                if (px < -tileSize * 2 || px > cssW + tileSize * 2) continue;
                if (py < -tileSize * 2 || py > cssH + tileSize * 2) continue;

                const hp = window.CompanionCombatAI?.getCompanionHp?.(ent);
                if (!hp) continue;

                const barW = tileSize * 0.9;
                const barH = 5;
                const barX = px - barW / 2;
                const barY = py - tileSize * 0.85;

                ctx.save();

                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

                const pct = Math.max(0, Math.min(1, hp.current / hp.max));
                const color = pct > 0.5 ? '#7dd87d'
                    : pct > 0.25 ? '#ffd76b'
                        : '#ff6060';

                ctx.fillStyle = color;
                ctx.fillRect(barX, barY, barW * pct, barH);

                ctx.strokeStyle = 'rgba(180,220,255,0.6)';
                ctx.lineWidth = 1;
                ctx.strokeRect(barX - 0.5, barY - 0.5, barW + 1, barH + 1);

                ctx.restore();
            }
        },

        _renderCooldownUI() { /* 已废弃 */ },

        clear() {
            this._popups = [];
            this._projectiles = [];
        },
    };

    window.CombatRender = CombatRender;
    console.log('[CinemaWorld] combat-render.js 已加载');
})();