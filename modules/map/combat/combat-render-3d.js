// ============================================================
// CinemaWorld · combat-render-3d.js
// 即时战斗 · 3D 渲染
// ============================================================

(function () {
    'use strict';

    const CombatRender3D = {
        _inited: false,

        _rangeMeshes: [],
        _aggroSprites: new Map(),
        _popups: [],
        _projectiles: [],
        _companionHpSprites: new Map(),

        init() {
            if (this._inited) return;
            this._inited = true;

            if (window.CombatRender && !window.CombatRender._popupHijacked) {
                window.CombatRender._popupHijacked = true;
                const orig = window.CombatRender.popupAt.bind(window.CombatRender);
                window.CombatRender.popupAt = function (x, y, text, type) {
                    if (window.MapCanvas3D?._running) {
                        return window.CombatRender3D?.popupAt?.(x, y, text, type);
                    }
                    return orig(x, y, text, type);
                };
                console.log('[CombatRender3D] 已劫持 CombatRender.popupAt');
            }

            if (window.CombatRender && !window.CombatRender._projHijacked) {
                window.CombatRender._projHijacked = true;
                const orig = window.CombatRender.drawProjectile.bind(window.CombatRender);
                window.CombatRender.drawProjectile = function (player, facing, cells) {
                    if (window.MapCanvas3D?._running) {
                        if (!cells || cells.length === 0) return;
                        const last = cells[cells.length - 1];
                        return window.CombatRender3D?.drawProjectile?.(
                            { x: player.x, y: player.y },
                            { x: last.x, y: last.y }
                        );
                    }
                    return orig(player, facing, cells);
                };
                console.log('[CombatRender3D] 已劫持 CombatRender.drawProjectile');
            }

            console.log('[CombatRender3D] 已初始化');
        },

        facingToWorld(facing) {
            if (!window.MapCanvas3D?._running) return facing;

            const cam = window.Map3DCamera;
            if (!cam) return facing;

            const fwd = cam.getForward();
            const right = cam.getRight();

            let wx = 0, wz = 0;
            switch (facing) {
                case 'up':    wx = fwd.x;    wz = fwd.z;    break;
                case 'down':  wx = -fwd.x;   wz = -fwd.z;   break;
                case 'right': wx = right.x;  wz = right.z;  break;
                case 'left':  wx = -right.x; wz = -right.z; break;
                default:      wx = fwd.x;    wz = fwd.z;
            }

            if (Math.abs(wx) >= Math.abs(wz)) {
                return wx > 0 ? 'right' : 'left';
            }
            return wz > 0 ? 'down' : 'up';
        },

        _getPlayerFacing() {
            const raw = window.MapSprites?.playerFacing || 'down';
            return this.facingToWorld(raw);
        },

        render() {
            const T = window.THREE;
            const M3 = window.MapCanvas3D;
            if (!T || !M3?.scene) return;

            if (!window.CombatState?.isAimed?.()) {
                this._clearAll();
                this._renderCompanionHpBars();
                return;
            }

            this._renderAttackRange();
            this._renderAggroMarkers();
            this._renderProjectiles();
            this._renderPopups();
            this._renderCompanionHpBars();
        },

        _renderAttackRange() {
            const T = window.THREE;
            const M3 = window.MapCanvas3D;
            const player = M3._playerData;
            const map = window.MapLauncher?.getMap?.();
            if (!player || !map) return;

            for (const m of this._rangeMeshes) {
                M3.scene.remove(m);
                m.geometry?.dispose?.();
                m.material?.dispose?.();
            }
            this._rangeMeshes = [];

            const main = window.EquipmentManager?.getMainWeapon?.();
            const off = window.EquipmentManager?.getOffWeapon?.();
            const facing = this._getPlayerFacing();

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
            const pulse = 0.3 + Math.sin(now / 300) * 0.15;

            for (const w of weapons) {
                const targets = window.CombatWeapon.getAttackTargets(
                    player, facing, w.data, map
                );
                const color = w.isMain ? 0xff5050 : 0xffa040;

                for (const cell of targets.cells) {
                    const cpos = M3._gridToWorld(cell.x, cell.y);

                    const geo = new T.PlaneGeometry(
                        M3._tileSize * 0.9,
                        M3._tileSize * 0.9
                    );
                    geo.rotateX(-Math.PI / 2);

                    const mat = new T.MeshBasicMaterial({
                        color,
                        transparent: true,
                        opacity: pulse,
                        depthWrite: false,
                    });
                    const mesh = new T.Mesh(geo, mat);
                    mesh.position.set(cpos.x, 0.12, cpos.z);
                    mesh.renderOrder = 5;
                    M3.scene.add(mesh);
                    this._rangeMeshes.push(mesh);
                }
            }
        },

        _renderAggroMarkers() {
            const T = window.THREE;
            const M3 = window.MapCanvas3D;
            const map = window.MapLauncher?.getMap?.();
            if (!map?.entities) return;

            const now = performance.now();
            const pulse = 1 + Math.sin(now / 250) * 0.15;

            const aggroIds = new Set();

            for (const ent of map.entities) {
                if (ent.kind !== 'encounter') continue;
                if (!ent._placed) continue;
                if (!ent.meta?._combatAggro) continue;

                aggroIds.add(ent.id);

                let sprite = this._aggroSprites.get(ent.id);
                if (!sprite) {
                    const tex = window.Map3DAssets?.emojiToTexture?.('❗', T, 128);
                    if (!tex) continue;

                    const mat = new T.SpriteMaterial({
                        map: tex,
                        transparent: true,
                        depthWrite: false,
                        alphaTest: 0.05,
                    });
                    sprite = new T.Sprite(mat);
                    sprite.renderOrder = 100;
                    M3.scene.add(sprite);
                    this._aggroSprites.set(ent.id, sprite);
                }

                const pos = M3._gridToWorld(ent.x, ent.y);
                sprite.position.set(pos.x, 2.4, pos.z);
                sprite.scale.set(0.8 * pulse, 0.8 * pulse, 1);
            }

            for (const [id, sprite] of this._aggroSprites) {
                if (!aggroIds.has(id)) {
                    M3.scene.remove(sprite);
                    sprite.material?.map?.dispose?.();
                    sprite.material?.dispose?.();
                    this._aggroSprites.delete(id);
                }
            }
        },

        // ============================================================
        // 队友血条
        // ============================================================
        _renderCompanionHpBars() {
            const T = window.THREE;
            const M3 = window.MapCanvas3D;
            const map = window.MapLauncher?.getMap?.();
            if (!T || !M3?.scene || !map?.entities) return;

            const aliveIds = new Set();

            for (const ent of map.entities) {
                if (!ent.isCompanion || !ent._placed) continue;

                const hp = window.CompanionCombatAI?.getCompanionHp?.(ent);
                if (!hp) continue;

                aliveIds.add(ent.id);

                const pct = Math.max(0, Math.min(1, hp.current / hp.max));
                const color = pct > 0.5 ? '#7dd87d'
                    : pct > 0.25 ? '#ffd76b'
                        : '#ff6060';
                const key = `${Math.round(pct * 20)}|${color}`;

                let sprite = this._companionHpSprites.get(ent.id);
                if (!sprite || sprite._key !== key) {
                    if (sprite) {
                        M3.scene.remove(sprite);
                        sprite.material?.map?.dispose?.();
                        sprite.material?.dispose?.();
                    }
                    const tex = this._makeHpBarTexture(pct, color);
                    if (!tex) continue;
                    const mat = new T.SpriteMaterial({
                        map: tex, transparent: true,
                        depthWrite: false, depthTest: false,
                    });
                    sprite = new T.Sprite(mat);
                    sprite.renderOrder = 200;
                    sprite.scale.set(1.2, 0.25, 1);
                    sprite._key = key;
                    M3.scene.add(sprite);
                    this._companionHpSprites.set(ent.id, sprite);
                }

                const pos = M3._gridToWorld(ent.x, ent.y);
                sprite.position.set(pos.x, 4.15, pos.z);
            }

            for (const [id, sprite] of this._companionHpSprites) {
                if (!aliveIds.has(id)) {
                    M3.scene.remove(sprite);
                    sprite.material?.map?.dispose?.();
                    sprite.material?.dispose?.();
                    this._companionHpSprites.delete(id);
                }
            }
        },

        _makeHpBarTexture(pct, color) {
            const T = window.THREE;
            const W = 128, H = 24;
            const canvas = document.createElement('canvas');
            canvas.width = W; canvas.height = H;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, 0, W, H);

            ctx.fillStyle = color;
            ctx.fillRect(2, 2, (W - 4) * pct, H - 4);

            ctx.strokeStyle = 'rgba(180,220,255,0.85)';
            ctx.lineWidth = 2;
            ctx.strokeRect(1, 1, W - 2, H - 2);

            const tex = new T.CanvasTexture(canvas);
            tex.minFilter = T.LinearFilter;
            tex.magFilter = T.LinearFilter;
            if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
            return tex;
        },

        drawProjectile(fromGrid, toGrid) {
            const T = window.THREE;
            const M3 = window.MapCanvas3D;
            if (!M3?.scene) return;

            const from = M3._gridToWorld(fromGrid.x, fromGrid.y);
            const to = M3._gridToWorld(toGrid.x, toGrid.y);

            const geometry = new T.BufferGeometry().setFromPoints([
                new T.Vector3(from.x, 0.6, from.z),
                new T.Vector3(to.x, 0.6, to.z),
            ]);
            const material = new T.LineBasicMaterial({
                color: 0xffdc64,
                transparent: true,
                opacity: 0.9,
            });
            const line = new T.Line(geometry, material);
            line.renderOrder = 50;
            M3.scene.add(line);

            this._projectiles.push({
                line,
                createdAt: performance.now(),
                duration: 200,
            });
        },

        _renderProjectiles() {
            const M3 = window.MapCanvas3D;
            const now = performance.now();
            const alive = [];

            for (const p of this._projectiles) {
                const t = (now - p.createdAt) / p.duration;
                if (t >= 1) {
                    M3.scene.remove(p.line);
                    p.line.geometry?.dispose?.();
                    p.line.material?.dispose?.();
                    continue;
                }
                p.line.material.opacity = (1 - t) * 0.9;
                alive.push(p);
            }

            this._projectiles = alive;
        },

        popupAt(gridX, gridY, text, type = 'damage') {
            const T = window.THREE;
            const M3 = window.MapCanvas3D;
            if (!M3?.scene) return;

            const tex = this._makeTextTexture(text, type);
            if (!tex) return;

            const mat = new T.SpriteMaterial({
                map: tex,
                transparent: true,
                depthWrite: false,
                depthTest: false,
            });
            const sprite = new T.Sprite(mat);
            sprite.scale.set(1.6, 0.8, 1);
            sprite.renderOrder = 9999;

            const pos = M3._gridToWorld(gridX, gridY);
            sprite.position.set(pos.x, 1.6, pos.z);
            M3.scene.add(sprite);

            this._popups.push({
                sprite,
                createdAt: performance.now(),
                duration: 1200,
                baseY: 1.6,
            });
        },

        _makeTextTexture(text, type) {
            const T = window.THREE;
            const fontSize = 64;
            const padding = 20;

            const measure = document.createElement('canvas').getContext('2d');
            measure.font = `bold ${fontSize}px sans-serif`;
            const tw = measure.measureText(text).width;

            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(tw + padding * 2);
            canvas.height = Math.ceil(fontSize * 1.4);

            const ctx = canvas.getContext('2d');
            const colors = {
                damage: '#ff5050',
                crit: '#ffd700',
                heal: '#50ff80',
                miss: '#cccccc',
                info: '#88bbff',
                'companion-damage': '#7da8ff',
                'companion-hurt': '#ff9090',
            };
            const color = colors[type] || colors.damage;

            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.lineWidth = 6;
            ctx.strokeStyle = 'rgba(0,0,0,0.9)';
            ctx.strokeText(text, canvas.width / 2, canvas.height / 2);

            ctx.fillStyle = color;
            ctx.fillText(text, canvas.width / 2, canvas.height / 2);

            const tex = new T.CanvasTexture(canvas);
            tex.minFilter = T.LinearFilter;
            tex.magFilter = T.LinearFilter;
            if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
            return tex;
        },

        _renderPopups() {
            const M3 = window.MapCanvas3D;
            const now = performance.now();
            const alive = [];

            for (const p of this._popups) {
                const t = (now - p.createdAt) / p.duration;
                if (t >= 1) {
                    M3.scene.remove(p.sprite);
                    p.sprite.material?.map?.dispose?.();
                    p.sprite.material?.dispose?.();
                    continue;
                }

                p.sprite.position.y = p.baseY + t * 1.5;
                p.sprite.material.opacity = t < 0.7 ? 1 : (1 - (t - 0.7) / 0.3);
                alive.push(p);
            }

            this._popups = alive;
        },

        _clearAll() {
            const M3 = window.MapCanvas3D;
            if (!M3?.scene) return;

            for (const m of this._rangeMeshes) {
                M3.scene.remove(m);
                m.geometry?.dispose?.();
                m.material?.dispose?.();
            }
            this._rangeMeshes = [];

            for (const [, s] of this._aggroSprites) {
                M3.scene.remove(s);
                s.material?.map?.dispose?.();
                s.material?.dispose?.();
            }
            this._aggroSprites.clear();

            for (const p of this._popups) {
                M3.scene.remove(p.sprite);
                p.sprite.material?.map?.dispose?.();
                p.sprite.material?.dispose?.();
            }
            this._popups = [];

            for (const p of this._projectiles) {
                M3.scene.remove(p.line);
                p.line.geometry?.dispose?.();
                p.line.material?.dispose?.();
            }
            this._projectiles = [];

            for (const [, s] of this._companionHpSprites) {
                M3.scene.remove(s);
                s.material?.map?.dispose?.();
                s.material?.dispose?.();
            }
            this._companionHpSprites.clear();
        },

        clear() {
            this._clearAll();
        },

        destroy() {
            this._clearAll();
            this._inited = false;
            console.log('[CombatRender3D] 已销毁');
        },
    };

    window.CombatRender3D = CombatRender3D;
    console.log('[CinemaWorld] combat-render-3d.js 已加载');
})();