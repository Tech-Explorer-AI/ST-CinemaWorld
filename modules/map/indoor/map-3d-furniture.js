// ============================================================
// CinemaWorld · indoor/map-3d-furniture.js
// 3D 程序化家具：每个家具用几何体拼出来
//   - 劫持 MapCanvas3D._buildOneEntity
//   - 遇到 furniture 走专属绘制
//   - size.w × size.h 控制占地
//
// 暴露：window.Map3DFurniture
// ============================================================

(function () {
    'use strict';

    if (window.Map3DFurniture) return;

    // ============================================================
    // 材质缓存
    // ============================================================
    const _matCache = new Map();
    function getMat(T, color, opts = {}) {
        const key = `${color}|${JSON.stringify(opts)}`;
        if (_matCache.has(key)) return _matCache.get(key);
        const m = new T.MeshLambertMaterial({ color, ...opts });
        _matCache.set(key, m);
        return m;
    }

    // ============================================================
    // 颜色
    // ============================================================
    const COLORS = {
        wood_dark:  0x6a4a2a,
        wood_light: 0x8a6a3a,
        wood_pale:  0xa88a5a,
        fabric_red: 0x8a3a3a,
        fabric_blu: 0x3a4a7a,
        fabric_grn: 0x3a6a3a,
        metal:      0x8888a0,
        metal_dark: 0x4a4a5a,
        gold:       0xd8a840,
        glass:      0x88b8d8,
        white:      0xe8e0d0,
        black:      0x2a2a2a,
    };

    // ============================================================
    // 几何工具
    // ============================================================
    function makeBox(T, w, h, d, color, x = 0, y = 0, z = 0) {
        const geo = new T.BoxGeometry(w, h, d);
        const mat = getMat(T, color);
        const mesh = new T.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        return mesh;
    }

    function makeCylinder(T, rTop, rBot, h, color, segments = 12, x = 0, y = 0, z = 0) {
        const geo = new T.CylinderGeometry(rTop, rBot, h, segments);
        const mat = getMat(T, color);
        const mesh = new T.Mesh(geo, mat);
        mesh.position.set(x, y, z);
        return mesh;
    }

    // ============================================================
    // 家具生成器：每种家具返回一个 Group
    //   W = size.w * tileSize（世界宽）
    //   D = size.h * tileSize（世界深）
    //   tileSize 用来参考比例
    // ============================================================
    const BUILDERS = {
        // ---------- 床 ----------
        bed(group, T, W, D, t) {
            // 床垫
            group.add(makeBox(T, W, t * 0.3, D, COLORS.white, 0, t * 0.15, 0));
            // 床头（靠后，D 的一侧）
            group.add(makeBox(T, W, t * 0.7, t * 0.3, COLORS.wood_dark, 0, t * 0.35, -D / 2 + t * 0.15));
            // 枕头
            group.add(makeBox(T, W * 0.7, t * 0.15, t * 0.4, COLORS.white, 0, t * 0.37, -D / 2 + t * 0.5));
            // 床尾木框
            group.add(makeBox(T, W, t * 0.4, t * 0.2, COLORS.wood_dark, 0, t * 0.2, D / 2 - t * 0.1));
        },

        bed_double(group, T, W, D, t) {
            this.bed(group, T, W, D, t);
            // 多一个枕头
            group.add(makeBox(T, W * 0.35, t * 0.15, t * 0.4, COLORS.white, -W * 0.2, t * 0.37, -D / 2 + t * 0.5));
            group.add(makeBox(T, W * 0.35, t * 0.15, t * 0.4, COLORS.white, W * 0.2, t * 0.37, -D / 2 + t * 0.5));
        },

        // ---------- 沙发 ----------
        sofa(group, T, W, D, t) {
            group.add(makeBox(T, W, t * 0.35, D, COLORS.fabric_red, 0, t * 0.25, 0));          // 座
            group.add(makeBox(T, W, t * 0.6, t * 0.25, COLORS.fabric_red, 0, t * 0.6, -D / 2 + t * 0.12));  // 靠背
            group.add(makeBox(T, t * 0.25, t * 0.5, D, COLORS.fabric_red, -W / 2 + t * 0.12, t * 0.4, 0));  // 左扶手
            group.add(makeBox(T, t * 0.25, t * 0.5, D, COLORS.fabric_red, W / 2 - t * 0.12, t * 0.4, 0));   // 右扶手
        },

        // ---------- 椅子 ----------
        rocking_chair(group, T, W, D, t) {
            group.add(makeBox(T, W * 0.8, t * 0.15, D * 0.8, COLORS.wood_light, 0, t * 0.35, 0));          // 座
            group.add(makeBox(T, W * 0.8, t * 0.7, t * 0.15, COLORS.wood_light, 0, t * 0.7, -D / 2 + t * 0.15)); // 靠背
            // 腿
            const legW = t * 0.08;
            const legH = t * 0.35;
            for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                group.add(makeBox(T, legW, legH, legW, COLORS.wood_dark, lx * (W * 0.35), t * 0.175, lz * (D * 0.35)));
            }
        },

        bench_wood(group, T, W, D, t) {
            group.add(makeBox(T, W, t * 0.15, D, COLORS.wood_light, 0, t * 0.4, 0));         // 座板
            group.add(makeBox(T, W, t * 0.6, t * 0.12, COLORS.wood_light, 0, t * 0.65, -D / 2 + t * 0.1)); // 靠背
            // 腿
            for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                group.add(makeBox(T, t * 0.1, t * 0.4, t * 0.1, COLORS.wood_dark, lx * (W * 0.4), t * 0.2, lz * (D * 0.35)));
            }
        },

        // ---------- 柜子 ----------
        cabinet(group, T, W, D, t) {
            group.add(makeBox(T, W, t * 1.8, D, COLORS.wood_dark, 0, t * 0.9, 0));
            // 把手
            group.add(makeBox(T, t * 0.08, t * 0.15, t * 0.05, COLORS.metal, W * 0.35, t * 1.0, D / 2 + 0.01));
            group.add(makeBox(T, t * 0.08, t * 0.15, t * 0.05, COLORS.metal, -W * 0.05, t * 1.0, D / 2 + 0.01));
            // 分层线
            group.add(makeBox(T, W, t * 0.05, D + 0.01, COLORS.wood_pale, 0, t * 1.2, 0));
        },

        cabinet_tall(group, T, W, D, t) {
            group.add(makeBox(T, W, t * 2.2, D, COLORS.wood_dark, 0, t * 1.1, 0));
            group.add(makeBox(T, W * 0.9, t * 0.05, D + 0.01, COLORS.wood_pale, 0, t * 1.4, 0));
            group.add(makeBox(T, t * 0.1, t * 0.2, t * 0.05, COLORS.gold, -W * 0.4, t * 1.6, D / 2 + 0.01));
            group.add(makeBox(T, t * 0.1, t * 0.2, t * 0.05, COLORS.gold, W * 0.4, t * 1.6, D / 2 + 0.01));
        },

        // ---------- 宝箱 ----------
        treasure_chest(group, T, W, D, t) {
            // 底部箱体
            group.add(makeBox(T, W * 0.9, t * 0.5, D * 0.9, COLORS.wood_dark, 0, t * 0.25, 0));
            // 盖（用小 Box 拼成弧形）
            group.add(makeBox(T, W * 0.9, t * 0.15, D * 0.9, COLORS.wood_dark, 0, t * 0.575, 0));
            group.add(makeBox(T, W * 0.75, t * 0.15, D * 0.75, COLORS.wood_dark, 0, t * 0.7, 0));
            group.add(makeBox(T, W * 0.5, t * 0.1, D * 0.5, COLORS.wood_dark, 0, t * 0.82, 0));
            // 金属边框
            group.add(makeBox(T, W * 0.95, t * 0.05, D * 0.05, COLORS.metal, 0, t * 0.55, 0));
            // 锁
            group.add(makeBox(T, t * 0.2, t * 0.2, t * 0.1, COLORS.gold, 0, t * 0.4, D / 2 * 0.9));
        },

        treasure_chest_gold(group, T, W, D, t) {
            this.treasure_chest(group, T, W, D, t);
            // 加金色装饰
            group.add(makeBox(T, W * 0.4, t * 0.08, t * 0.08, COLORS.gold, 0, t * 0.75, 0));
            group.add(makeBox(T, t * 0.08, t * 0.08, D * 0.4, COLORS.gold, 0, t * 0.75, 0));
        },

        // ---------- 学习 ----------
        bookshelf(group, T, W, D, t) {
            // 外壳
            group.add(makeBox(T, W, t * 1.8, D, COLORS.wood_dark, 0, t * 0.9, 0));
            // 隔板
            for (let i = 1; i <= 3; i++) {
                group.add(makeBox(T, W * 0.95, t * 0.04, D * 0.95, COLORS.wood_pale, 0, t * (0.45 * i), 0));
            }
            // 书（用小彩色 Box 填格子）
            const bookColors = [0xa84040, 0x4060a0, 0x40a060, 0xa060a0, 0xc08040];
            for (let shelf = 0; shelf < 3; shelf++) {
                const y = t * (0.25 + shelf * 0.45);
                for (let b = 0; b < 5; b++) {
                    const bx = -W * 0.35 + b * t * 0.13;
                    const color = bookColors[Math.floor(Math.random() * bookColors.length)];
                    group.add(makeBox(T, t * 0.1, t * 0.35, D * 0.6, color, bx, y, 0));
                }
            }
        },

        desk(group, T, W, D, t) {
            // 桌面
            group.add(makeBox(T, W, t * 0.1, D, COLORS.wood_light, 0, t * 0.75, 0));
            // 4 条腿
            const legH = t * 0.75;
            for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                group.add(makeBox(T, t * 0.1, legH, t * 0.1, COLORS.wood_dark, lx * (W * 0.4), t * 0.375, lz * (D * 0.35)));
            }
        },

        desk_large(group, T, W, D, t) {
            this.desk(group, T, W, D, t);
            // 书架附件
            group.add(makeBox(T, W * 0.3, t * 0.7, D * 0.3, COLORS.wood_dark, -W * 0.3, t * 1.15, -D * 0.3));
        },

        // ---------- 娱乐 ----------
        tv(group, T, W, D, t) {
            // 屏幕（薄 Box）
            group.add(makeBox(T, W * 0.9, t * 1.2, t * 0.1, COLORS.black, 0, t * 1.0, 0));
            // 屏幕反光（浅色小 Box 在正面）
            group.add(makeBox(T, W * 0.7, t * 0.9, 0.01, COLORS.glass, 0, t * 1.0, t * 0.06));
            // 支架
            group.add(makeBox(T, t * 0.2, t * 0.4, t * 0.2, COLORS.metal_dark, 0, t * 0.2, 0));
        },

        chess(group, T, W, D, t) {
            // 桌面
            group.add(makeBox(T, W * 0.8, t * 0.1, D * 0.8, COLORS.wood_light, 0, t * 0.75, 0));
            // 棋盘格（黑白小方块）
            const gridN = 4;
            const cellSize = W * 0.7 / gridN;
            for (let gy = 0; gy < gridN; gy++) {
                for (let gx = 0; gx < gridN; gx++) {
                    const isWhite = (gx + gy) % 2 === 0;
                    const color = isWhite ? COLORS.white : COLORS.black;
                    group.add(makeBox(
                        T, cellSize, t * 0.02, cellSize, color,
                        -W * 0.35 + gx * cellSize + cellSize / 2,
                        t * 0.81,
                        -D * 0.35 + gy * cellSize + cellSize / 2
                    ));
                }
            }
            // 4 条腿
            for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
                group.add(makeBox(T, t * 0.08, t * 0.7, t * 0.08, COLORS.wood_dark, lx * (W * 0.3), t * 0.35, lz * (D * 0.3)));
            }
        },

        piano(group, T, W, D, t) {
            // 主体
            group.add(makeBox(T, W, t * 0.8, D, COLORS.black, 0, t * 0.4, 0));
            // 键盘
            group.add(makeBox(T, W * 0.95, t * 0.1, D * 0.25, COLORS.white, 0, t * 0.85, D * 0.35));
            // 黑键
            for (let i = 0; i < 8; i++) {
                group.add(makeBox(T, t * 0.05, t * 0.03, t * 0.15, COLORS.black,
                    -W * 0.4 + i * (W * 0.8 / 8) + W * 0.05, t * 0.9, D * 0.35));
            }
            // 谱架
            group.add(makeBox(T, W * 0.9, t * 0.4, t * 0.05, COLORS.black, 0, t * 1.1, -D * 0.3));
        },

        fireplace(group, T, W, D, t) {
            // 底座
            group.add(makeBox(T, W, t * 1.5, D * 0.8, COLORS.metal_dark, 0, t * 0.75, 0));
            // 火（发光的橙色）
            const fireMat = new T.MeshBasicMaterial({ color: 0xff8844 });
            const fire = new T.Mesh(new T.BoxGeometry(W * 0.6, t * 0.6, D * 0.4), fireMat);
            fire.position.set(0, t * 0.3, D * 0.15);
            group.add(fire);
            // 顶部装饰
            group.add(makeBox(T, W, t * 0.2, D * 0.8, COLORS.wood_dark, 0, t * 1.6, 0));
        },

        // ---------- 仓储 ----------
        chest_wood(group, T, W, D, t) {
            group.add(makeBox(T, W * 0.9, t * 0.5, D * 0.9, COLORS.wood_dark, 0, t * 0.25, 0));
            group.add(makeBox(T, W * 0.95, t * 0.05, D * 0.05, COLORS.wood_pale, 0, t * 0.55, 0));
            group.add(makeBox(T, W * 0.9, t * 0.15, D * 0.9, COLORS.wood_dark, 0, t * 0.6, 0));
        },

        barrel(group, T, W, D, t) {
            const r = Math.min(W, D) / 2 * 0.8;
            // 木桶主体
            const barrel = makeCylinder(T, r * 0.85, r * 0.85, t * 1.2, COLORS.wood_dark, 16, 0, t * 0.6, 0);
            group.add(barrel);
            // 金属箍
            group.add(makeCylinder(T, r * 0.9, r * 0.9, t * 0.1, COLORS.metal, 16, 0, t * 0.2, 0));
            group.add(makeCylinder(T, r * 0.9, r * 0.9, t * 0.1, COLORS.metal, 16, 0, t * 1.0, 0));
        },
    };

    // ============================================================
    // 主体
    // ============================================================
    const Map3DFurniture = {
        _installed: false,

        install() {
            if (this._installed) return;

            let tries = 0;
            const wait = setInterval(() => {
                if (window.MapCanvas3D) {
                    clearInterval(wait);
                    this._hook();
                    this._installed = true;
                    console.log('[Map3DFurniture] 已安装');
                } else if (++tries > 100) {
                    clearInterval(wait);
                    console.warn('[Map3DFurniture] 等待 MapCanvas3D 超时');
                }
            }, 50);
        },

        _hook() {
            const MC = window.MapCanvas3D;

            // 保存原方法
            const originalBuildOne = MC._buildOneEntity.bind(MC);
            const originalRemoveNode = MC._removeEntityNode.bind(MC);

            // 劫持：遇到家具走专属绘制
            MC._buildOneEntity = function (ent) {
                if (ent.kind === 'furniture' && ent.indoor) {
                    return Map3DFurniture._buildFurniture.call(this, ent);
                }
                return originalBuildOne(ent);
            };

            // 劫持：删除节点时也清掉 Group
            MC._removeEntityNode = function (id) {
                const node = this._entityNodes.get(id);
                if (node?.furnitureGroup) {
                    this._entityGroup.remove(node.furnitureGroup);
                    node.furnitureGroup.traverse(obj => {
                        obj.geometry?.dispose?.();
                    });
                }
                return originalRemoveNode(id);
            };

            console.log('[Map3DFurniture] MapCanvas3D 已劫持');
        },

        // ============================================================
        // 构建家具
        // ============================================================
        _buildFurniture(ent) {
            const T = this.THREE;
            const map = window.MapLauncher?.getMap?.();
            const t = this._tileSize;
        
            const size = ent.indoor.size || { w: 1, h: 1 };
            const W = size.w * t;
            const D = size.h * t;
        
            // 世界坐标（家具左上角格子中心 → 家具中心）
            const centerX = ent.x + size.w / 2 - 0.5;
            const centerY = ent.y + size.h / 2 - 0.5;
            const pos = this._gridToWorld(centerX, centerY);
            const groundY = this._getCellWorldY(map, ent.x, ent.y);
        
            // 创建 Group
            const group = new T.Group();
            group.position.set(pos.x, groundY, pos.z);
            group.userData._entityId = ent.id;
        
            // ★ 朝向
            const facing = ent.indoor.facing;
            if (facing) {
                const rotMap = {
                    south: 0,
                    north: Math.PI,
                    east: Math.PI / 2,
                    west: -Math.PI / 2,
                };
                group.rotation.y = rotMap[facing] ?? 0;
            }
        
            // 调 builder
            const catalogId = ent.indoor.catalogId;
            const builder = BUILDERS[catalogId];
            if (builder) {
                try {
                    builder.call(BUILDERS, group, T, W, D, t);
                } catch (e) {
                    console.error(`[Map3DFurniture] ${catalogId} 构建失败:`, e);
                }
            } else {
                // 兜底：一个简单的 Box
                group.add(makeBox(T, W * 0.8, t * 0.5, D * 0.8, COLORS.wood_light, 0, t * 0.25, 0));
            }
        
            this._entityGroup.add(group);
        
            // 记录节点
            this._entityNodes.set(ent.id, {
                furnitureGroup: group,
                _isFurniture: true,
                _groundY: groundY,
                _groundYTarget: groundY,
                baseScale: 1,
            });
        },
    };

    window.Map3DFurniture = Map3DFurniture;

    function boot() {
        Map3DFurniture.install();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld] indoor/map-3d-furniture.js 已加载');
})();