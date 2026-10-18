// ============================================================
// CinemaWorld · map-3d-props-extra.js
// 扩展 Map3DProps：程序化 3D 装饰（路牌、垃圾桶、长椅、邮箱…）
//
// 通过覆盖 Map3DProps._getParts 实现
// 暴露：window.Map3DPropsExtra
// ============================================================

(function () {
    'use strict';

    if (window.Map3DPropsExtra) return;

    const PropsExtra = {
        installed: false,

        install() {
            if (this.installed) return false;
            const P = window.Map3DProps;
            if (!P) {
                console.warn('[PropsExtra] Map3DProps 未就绪');
                return false;
            }

            // 保存原方法
            this._originalGetParts = P._getParts.bind(P);

            // 覆盖：先尝试自己的，失败走原来的
            P._getParts = function (THREE, key) {
                const mine = PropsExtra._getParts(THREE, key);
                if (mine) return mine;
                return PropsExtra._originalGetParts(THREE, key);
            };

            // 扩大 buildAll 识别的类型
            this._patchBuildAll(P);

            this.installed = true;
            console.log('[PropsExtra] 已安装');
            return true;
        },

        uninstall() {
            if (!this.installed) return;
            const P = window.Map3DProps;
            if (P && this._originalGetParts) {
                P._getParts = this._originalGetParts;
            }
            this.installed = false;
        },

        // ============================================================
        // 扩展 buildAll：识别更多 decor.type
        // ============================================================
        _patchBuildAll(P) {
            // 保存原 buildAll
            if (P._originalBuildAll) return;
            P._originalBuildAll = P.buildAll.bind(P);

            P.buildAll = function (THREE, scene, map, options = {}) {
                // 先收集所有类型的装饰（包括新的），但原 buildAll 只处理它认识的
                // 我们用 hack 的方式：临时改一下 grid，把新类型改成原 buildAll 认识的名字？
                // 不行，太脏。
                
                // 更好的方式：直接复制原 buildAll 的逻辑，扩展类型
                // 但那需要重写整个函数，太长。
                
                // 折中：先让原 buildAll 跑（它处理 tree/plant/rock/lamp），
                // 然后我们额外处理新类型（sign/trash/bench/mailbox/...）
                const result = P._originalBuildAll(THREE, scene, map, options);
                
                try {
                    PropsExtra._buildExtra(THREE, scene, map, options);
                } catch (e) {
                    console.error('[PropsExtra] _buildExtra 失败:', e);
                }
                
                return result;
            };
        },

        // ============================================================
        // 额外处理：新类型的装饰
        // ============================================================
        _buildExtra(THREE, scene, map, options) {
            const grid = map._generated?.grid;
            if (!grid) return;

            const W = grid[0].length;
            const H = grid.length;
            const ts = options.tileSize || 1;
            const HU = window.Map3DGroundProgram?.HEIGHT_UNIT
                ?? window.Map3DGround?.HEIGHT_UNIT
                ?? 0.5;

            // 新类型
            const EXTRA_TYPES = new Set([
                'sign', 'trash', 'bench', 'mailbox',
                'hydrant', 'bus_stop', 'flower',
            ]);

            // 收集
            const buckets = new Map();

            for (let gy = 0; gy < H; gy++) {
                for (let gx = 0; gx < W; gx++) {
                    const cell = grid[gy][gx];
                    if (!cell?.decor) continue;
                    if (!EXTRA_TYPES.has(cell.decor.type)) continue;
                    if (cell.decor.buildingId) continue;

                    const wx = (gx - W / 2 + 0.5) * ts;
                    const wz = (gy - H / 2 + 0.5) * ts;
                    const h = typeof cell.height === 'number' ? cell.height : 0;
                    const wy = h * HU;

                    const key = `${cell.decor.type}:${cell.decor.variant ?? 0}`;
                    if (!buckets.has(key)) buckets.set(key, []);
                    buckets.get(key).push({ x: wx, y: wy, z: wz });
                }
            }

            // 生成
            const P = window.Map3DProps;
            let totalGroups = 0;

            for (const [key, instances] of buckets) {
                const parts = this._getParts(THREE, key);
                if (!parts || parts.length === 0) continue;

                for (const part of parts) {
                    const im = new THREE.InstancedMesh(
                        part.geo, part.mat, instances.length
                    );
                    im.frustumCulled = false;

                    const dummy = new THREE.Object3D();
                    for (let i = 0; i < instances.length; i++) {
                        const inst = instances[i];
                        dummy.position.set(inst.x, inst.y, inst.z);
                        dummy.rotation.set(0, 0, 0);
                        dummy.scale.setScalar(1);
                        dummy.updateMatrix();
                        im.setMatrixAt(i, dummy.matrix);
                    }
                    im.instanceMatrix.needsUpdate = true;
                    scene.add(im);
                    P._meshGroups.push(im);
                    totalGroups++;
                }
            }

            if (totalGroups > 0) {
                console.log(`[PropsExtra] ${buckets.size} 种新装饰, ${totalGroups} 个 draw call`);
            }
        },

        // ============================================================
        // 分派：key → 几何体 + 材质列表
        // ============================================================
        _getParts(THREE, key) {
            if (!key) return null;

            const [type, variantStr] = key.split(':');
            const variant = parseInt(variantStr) || 0;

            switch (type) {
                case 'sign':     return this._makeSignParts(THREE, variant);
                case 'trash':    return this._makeTrashParts(THREE, variant);
                case 'bench':    return this._makeBenchParts(THREE, variant);
                case 'mailbox':  return this._makeMailboxParts(THREE, variant);
                case 'hydrant':  return this._makeHydrantParts(THREE, variant);
                case 'bus_stop': return this._makeBusStopParts(THREE, variant);
                case 'flower': return this._makeFlowerParts(THREE, variant);
                default: return null;
            }
        },

        // ============================================================
        // 材质工具
        // ============================================================
        _mat(THREE, color) {
            const P = window.Map3DProps;
            if (P?._makeMat) return P._makeMat(THREE, color);
            return new THREE.MeshLambertMaterial({ color });
        },

        // ============================================================
        // 路牌：柱子 + 牌子
        // ============================================================
        _makeSignParts(THREE, variant) {
            const parts = [];
            const poleH = 1.6;

            // 柱子
            const pole = new THREE.CylinderGeometry(0.04, 0.05, poleH, 6);
            pole.translate(0, poleH / 2, 0);
            parts.push({
                name: 'pole',
                geo: pole,
                mat: this._mat(THREE, 0x6a5a4a),
            });

            // 牌子（方板）
            const boardW = 0.7, boardH = 0.5;
            const board = new THREE.BoxGeometry(boardW, boardH, 0.04);
            board.translate(0, poleH, 0);
            parts.push({
                name: 'board',
                geo: board,
                mat: this._mat(THREE, 0xd8c8a8),
            });

            // 牌子上加一条横幅装饰
            const stripe = new THREE.BoxGeometry(boardW * 0.9, 0.06, 0.05);
            stripe.translate(0, poleH - boardH * 0.25, 0);
            parts.push({
                name: 'stripe',
                geo: stripe,
                mat: this._mat(THREE, 0x8a5a3a),
            });

            return parts;
        },

        // ============================================================
        // 垃圾桶：圆柱 + 盖子
        // ============================================================
        _makeTrashParts(THREE, variant) {
            const parts = [];
            const r = 0.22;
            const h = 0.7;

            // 桶身
            const body = new THREE.CylinderGeometry(r, r * 0.9, h, 8);
            body.translate(0, h / 2, 0);
            parts.push({
                name: 'body',
                geo: body,
                mat: this._mat(THREE, 0x3a4a3a),
            });

            // 盖子
            const lid = new THREE.CylinderGeometry(r * 1.1, r * 1.1, 0.08, 8);
            lid.translate(0, h + 0.04, 0);
            parts.push({
                name: 'lid',
                geo: lid,
                mat: this._mat(THREE, 0x2a3a2a),
            });

            // 顶上的小把手
            const handle = new THREE.BoxGeometry(0.08, 0.05, 0.08);
            handle.translate(0, h + 0.1, 0);
            parts.push({
                name: 'handle',
                geo: handle,
                mat: this._mat(THREE, 0x5a5a5a),
            });

            // 桶身上的两条箍
            const ring1 = new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.04, 8);
            ring1.translate(0, h * 0.25, 0);
            parts.push({
                name: 'ring1',
                geo: ring1,
                mat: this._mat(THREE, 0x2a3a2a),
            });
            const ring2 = new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.04, 8);
            ring2.translate(0, h * 0.75, 0);
            parts.push({
                name: 'ring2',
                geo: ring2,
                mat: this._mat(THREE, 0x2a3a2a),
            });

            return parts;
        },

        // ============================================================
        // 长椅：座板 + 靠背 + 腿
        // ============================================================
        _makeBenchParts(THREE, variant) {
            const parts = [];
            const w = 1.2, d = 0.4;
            const seatH = 0.4;

            // 座板
            const seat = new THREE.BoxGeometry(w, 0.06, d);
            seat.translate(0, seatH, 0);
            parts.push({
                name: 'seat',
                geo: seat,
                mat: this._mat(THREE, 0x8a6a4a),
            });

            // 靠背
            const back = new THREE.BoxGeometry(w, 0.4, 0.05);
            back.translate(0, seatH + 0.25, -d / 2 + 0.03);
            parts.push({
                name: 'back',
                geo: back,
                mat: this._mat(THREE, 0x8a6a4a),
            });

            // 靠背的横条（两条）
            for (let i = 0; i < 2; i++) {
                const bar = new THREE.BoxGeometry(w * 0.95, 0.04, 0.04);
                bar.translate(0, seatH + 0.12 + i * 0.18, -d / 2 + 0.06);
                parts.push({
                    name: `backbar${i}`,
                    geo: bar,
                    mat: this._mat(THREE, 0x6a4a3a),
                });
            }

            // 4 条腿
            const legW = 0.06;
            const legH = seatH;
            for (const lx of [-1, 1]) {
                for (const lz of [-1, 1]) {
                    const leg = new THREE.BoxGeometry(legW, legH, legW);
                    leg.translate(
                        lx * (w / 2 - legW),
                        legH / 2,
                        lz * (d / 2 - legW)
                    );
                    parts.push({
                        name: `leg_${lx}_${lz}`,
                        geo: leg,
                        mat: this._mat(THREE, 0x5a4a3a),
                    });
                }
            }

            return parts;
        },

        // ============================================================
        // 邮箱：圆柱 + 顶盖 + 旗子
        // ============================================================
        _makeMailboxParts(THREE, variant) {
            const parts = [];

            // 柱子
            const poleH = 1.0;
            const pole = new THREE.CylinderGeometry(0.04, 0.05, poleH, 6);
            pole.translate(0, poleH / 2, 0);
            parts.push({
                name: 'pole',
                geo: pole,
                mat: this._mat(THREE, 0x5a5a5a),
            });

            // 箱体（半圆柱）
            const bodyR = 0.18;
            const bodyL = 0.4;
            const body = new THREE.CylinderGeometry(
                bodyR, bodyR, bodyL, 8, 1, false,
                0, Math.PI   // 半圆
            );
            body.rotateZ(Math.PI / 2);
            body.rotateY(Math.PI / 2);
            body.translate(0, poleH + bodyR * 0.5, 0);
            parts.push({
                name: 'body',
                geo: body,
                mat: this._mat(THREE, 0xc84a4a),
            });

            // 底座
            const base = new THREE.BoxGeometry(bodyL, 0.04, bodyR * 2);
            base.translate(0, poleH, 0);
            parts.push({
                name: 'base',
                geo: base,
                mat: this._mat(THREE, 0xa03a3a),
            });

            // 旗子（举起状态）
            const flag = new THREE.BoxGeometry(0.04, 0.12, 0.04);
            flag.translate(bodyL / 2 + 0.05, poleH + 0.1, 0);
            parts.push({
                name: 'flag',
                geo: flag,
                mat: this._mat(THREE, 0xffcc00),
            });

            return parts;
        },
        _makeFlowerParts(THREE, variant) {
            const parts = [];
            const colors = [0xff6688, 0xffdd44, 0xaabbff, 0xffffff];
            const color = colors[variant % colors.length];
            
            // 茎
            const stem = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4);
            stem.translate(0, 0.15, 0);
            parts.push({
                name: 'stem',
                geo: stem,
                mat: this._mat(THREE, 0x3a6a2a),
            });
            
            // 花瓣（多个小球拼）
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2;
                const petal = new THREE.SphereGeometry(0.05, 6, 4);
                petal.scale(1, 0.5, 1);
                petal.translate(Math.cos(a) * 0.06, 0.32, Math.sin(a) * 0.06);
                parts.push({
                    name: `petal_${i}`,
                    geo: petal,
                    mat: this._mat(THREE, color),
                });
            }
            
            // 花心
            const center = new THREE.SphereGeometry(0.03, 6, 4);
            center.translate(0, 0.34, 0);
            parts.push({
                name: 'center',
                geo: center,
                mat: this._mat(THREE, 0xffcc00),
            });
            
            return parts;
        },
        // ============================================================
        // 消防栓：圆柱 + 顶球 + 两侧凸起
        // ============================================================
        _makeHydrantParts(THREE, variant) {
            const parts = [];
            const r = 0.1;
            const h = 0.5;

            // 主体
            const body = new THREE.CylinderGeometry(r, r * 1.1, h, 8);
            body.translate(0, h / 2, 0);
            parts.push({
                name: 'body',
                geo: body,
                mat: this._mat(THREE, 0xc83030),
            });

            // 顶盖
            const top = new THREE.CylinderGeometry(r * 1.3, r * 1.3, 0.06, 8);
            top.translate(0, h, 0);
            parts.push({
                name: 'top',
                geo: top,
                mat: this._mat(THREE, 0xa02020),
            });

            // 顶部小球
            const knob = new THREE.SphereGeometry(0.05, 8, 6);
            knob.translate(0, h + 0.08, 0);
            parts.push({
                name: 'knob',
                geo: knob,
                mat: this._mat(THREE, 0x802020),
            });

            // 两个侧边出口
            for (const sign of [-1, 1]) {
                const out = new THREE.CylinderGeometry(0.04, 0.05, 0.08, 6);
                out.rotateZ(Math.PI / 2);
                out.translate(sign * (r + 0.04), h * 0.6, 0);
                parts.push({
                    name: `out_${sign}`,
                    geo: out,
                    mat: this._mat(THREE, 0x802020),
                });
            }

            return parts;
        },

        // ============================================================
        // 公交站：柱子 + 棚顶 + 站牌
        // ============================================================
        _makeBusStopParts(THREE, variant) {
            const parts = [];
            const poleH = 2.4;

            // 两根柱子
            for (const sign of [-1, 1]) {
                const pole = new THREE.CylinderGeometry(0.05, 0.06, poleH, 6);
                pole.translate(sign * 0.7, poleH / 2, 0);
                parts.push({
                    name: `pole_${sign}`,
                    geo: pole,
                    mat: this._mat(THREE, 0x4a4a5a),
                });
            }

            // 棚顶
            const roof = new THREE.BoxGeometry(1.8, 0.08, 0.6);
            roof.translate(0, poleH, 0);
            parts.push({
                name: 'roof',
                geo: roof,
                mat: this._mat(THREE, 0x3a4a5a),
            });

            // 站牌（侧面的方板）
            const board = new THREE.BoxGeometry(0.04, 0.4, 0.3);
            board.translate(-0.7, poleH - 0.3, 0);
            parts.push({
                name: 'board',
                geo: board,
                mat: this._mat(THREE, 0xd8d8e8),
            });

            // 牌子上的横线（装饰）
            for (let i = 0; i < 3; i++) {
                const line = new THREE.BoxGeometry(0.05, 0.03, 0.24);
                line.translate(-0.68, poleH - 0.2 - i * 0.08, 0);
                parts.push({
                    name: `line_${i}`,
                    geo: line,
                    mat: this._mat(THREE, 0x3a4a5a),
                });
            }

            return parts;
        },
    };

    window.Map3DPropsExtra = PropsExtra;

    // 自动安装
    if (window.Map3DProps) {
        PropsExtra.install();
    } else {
        let tries = 0;
        const timer = setInterval(() => {
            if (window.Map3DProps) {
                clearInterval(timer);
                PropsExtra.install();
            } else if (++tries > 50) {
                clearInterval(timer);
                console.warn('[PropsExtra] 等待 Map3DProps 超时');
            }
        }, 50);
    }

    console.log('[CinemaWorld] map-3d-props-extra.js 已加载');
})();

// 在 map-3d-props-extra.js 里追加
(function () {
    'use strict';
    if (window.Map3DDecorDisabler) return;

    const Disabler = {
        installed: false,
        install() {
            if (this.installed) return;
            const MC = window.MapCanvas3D;
            if (!MC) return;

            // 保存原 _buildDecor
            this._original = MC._buildDecor;
            // 覆盖成空
            MC._buildDecor = function (map) {
                // ★ 2D 像素贴图装饰不再生成
                //   所有装饰由 Map3DProps / Map3DPropsExtra / Map3DFurniture 处理
                return;
            };
            this.installed = true;
            console.log('[DecorDisabler] _buildDecor 已禁用（改用 3D 程序化）');
        },
        uninstall() {
            const MC = window.MapCanvas3D;
            if (MC && this._original) MC._buildDecor = this._original;
            this.installed = false;
        },
    };

    window.Map3DDecorDisabler = Disabler;

    if (window.MapCanvas3D) {
        Disabler.install();
    } else {
        let tries = 0;
        const timer = setInterval(() => {
            if (window.MapCanvas3D) {
                clearInterval(timer);
                Disabler.install();
            } else if (++tries > 50) clearInterval(timer);
        }, 50);
    }
})();