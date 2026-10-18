// ============================================================
// CinemaWorld · map-3d-props.js
// 程序化 3D 装饰：树 / 灌木 / 石头 / 路灯
// InstancedMesh 分组渲染
// 暴露：window.Map3DProps
// ============================================================

(function () {
    'use strict';

    if (window.Map3DProps) return;

    // ============================================================
    // 可调参数
    // ============================================================
    const CFG = {
        // ---------- 通用树参数 ----------
        trunkRadius: 0.15,
        trunkSides: 6,
        crownSides: 7,

        // ★ 12 种树的配置表
        //   height: 树高（世界单位）
        //   trunk:  树干颜色
        //   crown:  树冠颜色（null 表示无树冠，如枯树）
        treeVariants: {
            oak:    { height: 3.2, trunk: 0x6a4a2a, crown: 0x4a8a3a },
            birch:  { height: 3.4, trunk: 0xe8e0d0, crown: 0x7a9a4a },
            pine:   { height: 3.8, trunk: 0x4a3a2a, crown: 0x2a5a3a },
            maple:  { height: 3.0, trunk: 0x8a6a4a, crown: 0xc85a2a },
            willow: { height: 3.0, trunk: 0x7a6a5a, crown: 0x6a9a5a },
            fir:    { height: 4.2, trunk: 0x3a2a1a, crown: 0x1a4a2a },
            sakura: { height: 2.9, trunk: 0x5a3a2a, crown: 0xf4b8d0 },
            plum:   { height: 2.9, trunk: 0x5a3a2a, crown: 0xd898a8 },
            bamboo: { height: 3.5, trunk: 0x9aa85a, crown: 0x6a8a3a },
            palm:   { height: 4.0, trunk: 0x8a6a4a, crown: 0x4a9a4a },
            dead:   { height: 3.0, trunk: 0x5a5a5a, crown: null },
            banyan: { height: 3.6, trunk: 0x5a4a3a, crown: 0x3a6a2a },
        },

        // 兼容旧字段（其他模块可能引用）
        oakHeight: 3.2,
        pineHeight: 3.8,
        sakuraHeight: 2.9,
        plumHeight: 2.9,
        deadHeight: 3.0,

        crownColor: {
            oak: 0x4a8a3a,
            pine: 0x2a5a3a,
            sakura: 0xf4b8d0,
            plum: 0xd898a8,
        },
        trunkColor: {
            oak: 0x6a4a2a,
            pine: 0x4a3a2a,
            sakura: 0x5a3a2a,
            plum: 0x5a3a2a,
            dead: 0x4a3a2a,
        },

        // ---------- 灌木 ----------
        bushHeight: 0.55,
        bushRadius: 0.45,
        bushSides: 6,
        bushVariants: 3,

        bushColor: {
            0: 0x4a8a3a,
            1: 0x5aa048,
            2: 0x3a7a30,
        },

        // ---------- 石头 ----------
        rockRadius: 0.35,
        rockSides: 0,
        rockColor: {
            0: 0x8a8a8a,
            1: 0x7a7a72,
            2: 0x9a9088,
        },

        // ---------- 路灯 ----------
        lampHeight: 3.2,
        lampPoleRadius: 0.06,
        lampHeadSize: 0.18,
        lampPoleColor: 0x2a2a2e,
        lampHeadColor: 0xffe8a0,

        // ---------- 通用 ----------
        randomOffset: 0.28,
        randomRotate: true,
        randomScaleMin: 0.85,
        randomScaleMax: 1.15,

        useLighting: true,

        bushRandomOffset: 0.15,
        bushRandomScaleMin: 0.7,
        bushRandomScaleMax: 1.4,
    };

    // ============================================================
    // 主模块
    // ============================================================
    const Props = {
        THREE: null,

        _geoCache: new Map(),
        _meshGroups: [],
        _lights: [],

        // ============================================================
        // 主入口：一次生成所有装饰
        // ============================================================
        buildAll(THREE, scene, map, options = {}) {
            this.THREE = THREE;

            const grid = map._generated?.grid;
            if (!grid) {
                console.warn('[Map3DProps] 地图数据缺失');
                return;
            }

            const W = grid[0].length;
            const H = grid.length;
            const ts = options.tileSize || 1;
            const HEIGHT_UNIT = window.Map3DGroundProgram?.HEIGHT_UNIT
                ?? window.Map3DGround?.HEIGHT_UNIT
                ?? 0.5;

            // ---------- 随机种子（同图同布局）----------
            let seed = 12345;
            const rng = () => {
                seed = (seed * 9301 + 49297) % 233280;
                return seed / 233280;
            };

            // ---------- 收集所有装饰 ----------
            const buckets = new Map();

            const push = (key, inst) => {
                if (!buckets.has(key)) buckets.set(key, []);
                buckets.get(key).push(inst);
            };

            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const cell = grid[y][x];
                    if (!cell?.decor) continue;

                    const type = cell.decor.type;
                    const variant = cell.decor.variant ?? 0;

                    const wx = (x - W / 2 + 0.5) * ts;
                    const wz = (y - H / 2 + 0.5) * ts;
                    const h = typeof cell.height === 'number' ? cell.height : 0;
                    const wy = h * HEIGHT_UNIT;

                    const rot = CFG.randomRotate ? rng() * Math.PI * 2 : 0;
                    const sc = CFG.randomScaleMin
                        + rng() * (CFG.randomScaleMax - CFG.randomScaleMin);
                    const off = CFG.randomOffset * ts;
                    const ox = (rng() - 0.5) * 2 * off;
                    const oz = (rng() - 0.5) * 2 * off;

                    if (type === 'tree') {
                        push(`tree:${variant}`, {
                            x: wx + ox,
                            y: wy,
                            z: wz + oz,
                            rot,
                            scale: sc,
                        });
                    } else if (type === 'plant') {
                        const bvar = Math.floor(rng() * CFG.bushVariants);
                        const bsc = CFG.bushRandomScaleMin
                            + rng() * (CFG.bushRandomScaleMax - CFG.bushRandomScaleMin);
                        const boff = CFG.bushRandomOffset * ts;
                        push(`bush:${bvar}`, {
                            x: wx + (rng() - 0.5) * 2 * boff,
                            y: wy,
                            z: wz + (rng() - 0.5) * 2 * boff,
                            rot: rng() * Math.PI * 2,
                            scale: bsc,
                        });
                    } else if (type === 'rock') {
                        push(`rock:${variant}`, {
                            x: wx + ox,
                            y: wy,
                            z: wz + oz,
                            rot,
                            scale: sc,
                        });
                    } else if (type === 'lamp') {
                        push(`lamp:0`, {
                            x: wx,
                            y: wy,
                            z: wz,
                            rot,
                            scale: 1.0,
                        });
                    }
                }
            }

            // ---------- 生成每种装饰的 InstancedMesh ----------
            let totalGroups = 0;

            for (const [key, instances] of buckets) {
                if (instances.length === 0) continue;

                const parts = this._getParts(THREE, key);
                if (!parts || parts.length === 0) continue;

                for (const part of parts) {
                    const im = new THREE.InstancedMesh(
                        part.geo,
                        part.mat,
                        instances.length
                    );
                    im.frustumCulled = false;
                    im.name = `${key}_${part.name}`;

                    const dummy = new THREE.Object3D();
                    for (let i = 0; i < instances.length; i++) {
                        const inst = instances[i];
                        dummy.position.set(inst.x, inst.y, inst.z);
                        dummy.rotation.set(0, inst.rot, 0);
                        dummy.scale.setScalar(inst.scale);
                        dummy.updateMatrix();
                        im.setMatrixAt(i, dummy.matrix);
                    }
                    im.instanceMatrix.needsUpdate = true;
                    scene.add(im);
                    this._meshGroups.push(im);
                    totalGroups++;
                }

                // ---------- 路灯特殊处理：加光源 ----------
                if (key === 'lamp:0') {
                    for (const inst of instances) {
                        const light = new THREE.PointLight(
                            CFG.lampHeadColor,
                            0.6,
                            6,
                            2
                        );
                        light.position.set(inst.x, inst.y + CFG.lampHeight, inst.z);
                        scene.add(light);
                        this._lights.push(light);
                    }
                }
            }

            console.log(
                `[Map3DProps] ${buckets.size} 种装饰, ${totalGroups} 个 draw call`
            );
        },

        // ============================================================
        // 分派：key → 几何体 + 材质列表
        // ============================================================
        _getParts(THREE, key) {
            if (this._geoCache.has(key)) return this._geoCache.get(key);

            let parts = null;

            if (key.startsWith('tree:')) {
                const variant = parseInt(key.split(':')[1]);
                parts = this._makeTreeParts(THREE, variant);
            } else if (key.startsWith('bush:')) {
                const variant = parseInt(key.split(':')[1]);
                parts = this._makeBushParts(THREE, variant);
            } else if (key.startsWith('rock:')) {
                const variant = parseInt(key.split(':')[1]);
                parts = this._makeRockParts(THREE, variant);
            } else if (key === 'lamp:0') {
                parts = this._makeLampParts(THREE);
            }

            this._geoCache.set(key, parts);
            return parts;
        },

        // ============================================================
        // ★ 树种分派（12 种）
        //   0 橡树  1 白桦  2 松树  3 枫树
        //   4 柳树  5 杉树  6 樱花  7 梅花
        //   8 竹子  9 椰子树 10 枯树 11 榕树
        // ============================================================
        _makeTreeParts(THREE, variant) {
            const parts = [];

            const NAME_MAP = {
                0: 'oak',
                1: 'birch',
                2: 'pine',
                3: 'maple',
                4: 'willow',
                5: 'fir',
                6: 'sakura',
                7: 'plum',
                8: 'bamboo',
                9: 'palm',
                10: 'dead',
                11: 'banyan',
            };

            const name = NAME_MAP[variant] || 'oak';

            if (name === 'bamboo') {
                this._buildBamboo(THREE, parts);
            } else {
                this._buildTree(THREE, parts, name);
            }

            return parts;
        },

        // ============================================================
        // 通用树生成器
        // ============================================================
        _buildTree(THREE, parts, kind) {
            const cfg = CFG.treeVariants[kind];
            if (!cfg) return;

            // ---------- 树干 ----------
            const trunkRadius = kind === 'palm' ? CFG.trunkRadius * 0.9 : CFG.trunkRadius;
            parts.push({
                name: 'trunk',
                geo: this._makeTrunkGeo(THREE, cfg.height, trunkRadius),
                mat: this._makeMat(THREE, cfg.trunk),
            });

            // ---------- 无树冠（枯树）----------
            if (!cfg.crown) {
                const branches = [
                    { angle: 0.4, dir: 0.7, y: cfg.height * 0.55, len: cfg.height * 0.35 },
                    { angle: 2.5, dir: 0.6, y: cfg.height * 0.65, len: cfg.height * 0.30 },
                    { angle: 4.2, dir: 0.8, y: cfg.height * 0.45, len: cfg.height * 0.25 },
                    { angle: 5.5, dir: 0.5, y: cfg.height * 0.75, len: cfg.height * 0.20 },
                ];
                for (const b of branches) {
                    const branch = new THREE.CylinderGeometry(
                        CFG.trunkRadius * 0.25,
                        CFG.trunkRadius * 0.5,
                        b.len, 4, 1, false
                    );
                    branch.translate(0, b.len / 2, 0);
                    branch.rotateZ(b.dir);
                    branch.rotateY(b.angle);
                    branch.translate(0, b.y, 0);
                    parts.push({
                        name: 'branch',
                        geo: branch,
                        mat: this._makeMat(THREE, cfg.trunk),
                    });
                }
                return;
            }

            // ---------- 树冠 ----------
            let crownGeo;

            switch (kind) {
                case 'pine':
                case 'fir':
                    crownGeo = this._makePineCrownGeo(THREE, cfg.height);
                    break;
                case 'willow':
                    crownGeo = this._makeWillowCrownGeo(THREE, cfg.height);
                    break;
                case 'palm':
                    crownGeo = this._makePalmCrownGeo(THREE, cfg.height);
                    break;
                case 'banyan':
                    crownGeo = this._makeBanyanCrownGeo(THREE, cfg.height);
                    break;
                case 'sakura':
                case 'plum':
                    crownGeo = this._makeSakuraCrownGeo(THREE, cfg.height);
                    break;
                default:
                    crownGeo = this._makeOakCrownGeo(THREE, cfg.height);
                    break;
            }

            parts.push({
                name: 'crown',
                geo: crownGeo,
                mat: this._makeMat(THREE, cfg.crown),
            });
        },

        // ============================================================
        // 竹子（多根细杆 + 顶部叶子）
        // ============================================================
        _buildBamboo(THREE, parts) {
            const cfg = CFG.treeVariants.bamboo;

            // 4 根竹杆
            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2;
                const r = 0.12;
                const stalk = new THREE.CylinderGeometry(
                    0.04, 0.05, cfg.height, 5, 1, false
                );
                stalk.translate(
                    Math.cos(a) * r,
                    cfg.height / 2,
                    Math.sin(a) * r
                );
                parts.push({
                    name: `stalk_${i}`,
                    geo: stalk,
                    mat: this._makeMat(THREE, cfg.trunk),
                });
            }

            // 顶部叶子（锥体）
            const leaf = new THREE.ConeGeometry(0.5, 0.8, 5);
            leaf.translate(0, cfg.height + 0.2, 0);
            parts.push({
                name: 'leaf',
                geo: leaf,
                mat: this._makeMat(THREE, cfg.crown),
            });
        },

        // ============================================================
        // 树干（通用）
        // ============================================================
        _makeTrunkGeo(THREE, height, radius) {
            const geo = new THREE.CylinderGeometry(
                radius * 0.75, radius, height, CFG.trunkSides, 1, false
            );
            geo.translate(0, height / 2, 0);
            return geo;
        },

        // ============================================================
        // 橡树冠（多球堆积）
        // ============================================================
        _makeOakCrownGeo(THREE, treeHeight) {
            const parts = [];
            const mainR = treeHeight * 0.42;

            const main = new THREE.SphereGeometry(mainR, CFG.crownSides, 6);
            main.translate(0, treeHeight - mainR * 0.6, 0);
            parts.push(main);

            const offsets = [
                { x: mainR * 0.6, y: treeHeight - mainR * 1.1, z: 0, r: mainR * 0.55 },
                { x: -mainR * 0.5, y: treeHeight - mainR * 1.2, z: mainR * 0.4, r: mainR * 0.5 },
                { x: 0, y: treeHeight - mainR * 1.4, z: -mainR * 0.5, r: mainR * 0.45 },
            ];
            for (const o of offsets) {
                const s = new THREE.SphereGeometry(o.r, CFG.crownSides, 5);
                s.translate(o.x, o.y, o.z);
                parts.push(s);
            }

            return this._mergeGeometries(THREE, parts);
        },

        // ============================================================
        // 松树 / 杉树冠（多层圆锥）
        // ============================================================
        _makePineCrownGeo(THREE, treeHeight) {
            const parts = [];
            const baseR = treeHeight * 0.32;
            const layers = [
                { y: treeHeight * 0.35, r: baseR, h: treeHeight * 0.35 },
                { y: treeHeight * 0.55, r: baseR * 0.75, h: treeHeight * 0.30 },
                { y: treeHeight * 0.75, r: baseR * 0.5, h: treeHeight * 0.28 },
            ];
            for (const l of layers) {
                const cone = new THREE.ConeGeometry(l.r, l.h, CFG.crownSides);
                cone.translate(0, l.y, 0);
                parts.push(cone);
            }
            return this._mergeGeometries(THREE, parts);
        },

        // ============================================================
        // 樱花 / 梅花冠（主球 + 4 个副球）
        // ============================================================
        _makeSakuraCrownGeo(THREE, treeHeight) {
            const parts = [];
            const mainR = treeHeight * 0.48;
            const main = new THREE.SphereGeometry(mainR, CFG.crownSides + 1, 6);
            main.translate(0, treeHeight - mainR * 0.5, 0);
            parts.push(main);

            for (let i = 0; i < 4; i++) {
                const a = (i / 4) * Math.PI * 2;
                const r = mainR * 0.5;
                const s = new THREE.SphereGeometry(r, CFG.crownSides, 5);
                s.translate(
                    Math.cos(a) * mainR * 0.7,
                    treeHeight - mainR * 0.7 + Math.sin(i) * 0.1,
                    Math.sin(a) * mainR * 0.7
                );
                parts.push(s);
            }
            return this._mergeGeometries(THREE, parts);
        },

        // ============================================================
        // ★ 柳树冠（主球 + 多根下垂枝条）
        // ============================================================
        _makeWillowCrownGeo(THREE, treeHeight) {
            const parts = [];
            const mainR = treeHeight * 0.35;

            // 主球
            const main = new THREE.SphereGeometry(mainR, CFG.crownSides, 5);
            main.translate(0, treeHeight - mainR * 0.6, 0);
            parts.push(main);

            // 下垂枝条（细圆锥，倒挂）
            const strands = 6;
            for (let i = 0; i < strands; i++) {
                const a = (i / strands) * Math.PI * 2;
                const len = treeHeight * 0.5;
                const strand = new THREE.ConeGeometry(0.12, len, 4);
                // 倒挂
                strand.rotateX(Math.PI);
                strand.translate(
                    Math.cos(a) * mainR * 0.9,
                    treeHeight - mainR * 0.7 - len / 2,
                    Math.sin(a) * mainR * 0.9
                );
                parts.push(strand);
            }

            return this._mergeGeometries(THREE, parts);
        },

        // ============================================================
        // ★ 椰子树冠（大叶扇）
        // ============================================================
        _makePalmCrownGeo(THREE, treeHeight) {
            const parts = [];
            const leafCount = 6;
            const leafLen = treeHeight * 0.35;

            for (let i = 0; i < leafCount; i++) {
                const a = (i / leafCount) * Math.PI * 2;
                const leaf = new THREE.ConeGeometry(0.25, leafLen, 4);
                // 平躺
                leaf.rotateZ(Math.PI / 2);
                // 朝外
                leaf.rotateY(a);
                // 略微抬高
                leaf.rotateX(-0.3);
                leaf.translate(
                    Math.cos(a) * leafLen * 0.5,
                    treeHeight + 0.1,
                    Math.sin(a) * leafLen * 0.5
                );
                parts.push(leaf);
            }

            return this._mergeGeometries(THREE, parts);
        },

        // ============================================================
        // ★ 榕树冠（大球 + 气根）
        // ============================================================
        _makeBanyanCrownGeo(THREE, treeHeight) {
            const parts = [];
            const mainR = treeHeight * 0.5;

            // 主冠
            const main = new THREE.SphereGeometry(mainR, 8, 6);
            main.translate(0, treeHeight - mainR * 0.4, 0);
            parts.push(main);

            // 气根（从树冠垂下的细圆柱）
            const roots = 5;
            for (let i = 0; i < roots; i++) {
                const a = (i / roots) * Math.PI * 2;
                const rLen = treeHeight * 0.5;
                const root = new THREE.CylinderGeometry(0.05, 0.08, rLen, 4);
                // 让圆柱的底部对齐到树冠下方
                root.translate(0, -rLen / 2, 0);
                root.translate(
                    Math.cos(a) * mainR * 0.7,
                    treeHeight - mainR * 0.4,
                    Math.sin(a) * mainR * 0.7
                );
                parts.push(root);
            }

            return this._mergeGeometries(THREE, parts);
        },

        // ============================================================
        // 枯树（无冠，只有主干 + 分枝）
        //   ★ 保留此方法，供 case 10 使用
        // ============================================================
        _makeDeadTreeGeo(THREE, treeHeight) {
            const parts = [];

            const trunk = new THREE.CylinderGeometry(
                CFG.trunkRadius * 0.6,
                CFG.trunkRadius * 1.1,
                treeHeight,
                5, 1, false
            );
            trunk.translate(0, treeHeight / 2, 0);
            parts.push(trunk);

            const branches = [
                { angle: 0.4, dir: 0.7, y: treeHeight * 0.55, len: treeHeight * 0.4 },
                { angle: 2.5, dir: 0.6, y: treeHeight * 0.65, len: treeHeight * 0.35 },
                { angle: 4.2, dir: 0.8, y: treeHeight * 0.45, len: treeHeight * 0.3 },
                { angle: 5.5, dir: 0.5, y: treeHeight * 0.75, len: treeHeight * 0.25 },
            ];
            for (const b of branches) {
                const branch = new THREE.CylinderGeometry(
                    CFG.trunkRadius * 0.25,
                    CFG.trunkRadius * 0.5,
                    b.len, 4, 1, false
                );
                branch.translate(0, b.len / 2, 0);
                branch.rotateZ(b.dir);
                branch.rotateY(b.angle);
                branch.translate(0, b.y, 0);
                parts.push(branch);
            }

            return this._mergeGeometries(THREE, parts);
        },

        // ============================================================
        // 灌木（低多边形球 + 顶部小球）
        // ============================================================
        _makeBushParts(THREE, variant) {
            const parts = [];

            const color = CFG.bushColor[variant] ?? CFG.bushColor[0];

            const geo = new THREE.IcosahedronGeometry(CFG.bushRadius, 0);
            geo.scale(1, CFG.bushHeight / CFG.bushRadius * 0.5, 1);
            geo.translate(0, CFG.bushHeight / 2, 0);

            parts.push({
                name: 'bush',
                geo,
                mat: this._makeMat(THREE, color),
            });

            const top = new THREE.IcosahedronGeometry(CFG.bushRadius * 0.6, 0);
            top.scale(1, 0.7, 1);
            top.translate(
                CFG.bushRadius * 0.3,
                CFG.bushHeight * 0.8,
                -CFG.bushRadius * 0.2
            );
            parts.push({
                name: 'bush_top',
                geo: top,
                mat: this._makeMat(THREE, color),
            });

            return parts;
        },

        // ============================================================
        // 石头（低多边形 ico 球 + 随机变形）
        // ============================================================
        _makeRockParts(THREE, variant) {
            const geo = new THREE.IcosahedronGeometry(CFG.rockRadius, 0);

            const seed = 1000 + variant * 17;
            let s = seed;
            const rng = () => {
                s = (s * 9301 + 49297) % 233280;
                return s / 233280;
            };
            const pos = geo.attributes.position;
            for (let i = 0; i < pos.count; i++) {
                const x = pos.getX(i);
                const y = pos.getY(i);
                const z = pos.getZ(i);
                const f = 0.7 + rng() * 0.6;
                pos.setXYZ(i, x * f, y * f * 0.8, z * f);
            }
            geo.computeVertexNormals();
            geo.translate(0, CFG.rockRadius * 0.6, 0);

            const color = CFG.rockColor[variant % 3] ?? CFG.rockColor[0];

            return [{
                name: 'rock',
                geo,
                mat: this._makeMat(THREE, color),
            }];
        },

        // ============================================================
        // 路灯（杆 + 灯头）
        // ============================================================
        _makeLampParts(THREE) {
            const parts = [];

            const pole = new THREE.CylinderGeometry(
                CFG.lampPoleRadius,
                CFG.lampPoleRadius * 1.2,
                CFG.lampHeight,
                6, 1, false
            );
            pole.translate(0, CFG.lampHeight / 2, 0);

            parts.push({
                name: 'pole',
                geo: pole,
                mat: this._makeMat(THREE, CFG.lampPoleColor),
            });

            const head = new THREE.SphereGeometry(CFG.lampHeadSize, 8, 6);
            head.translate(0, CFG.lampHeight + CFG.lampHeadSize * 0.5, 0);

            const headMat = new THREE.MeshBasicMaterial({
                color: CFG.lampHeadColor,
            });

            parts.push({
                name: 'head',
                geo: head,
                mat: headMat,
            });

            return parts;
        },

        // ============================================================
        // 材质
        // ============================================================
        _makeMat(THREE, color) {
            if (CFG.useLighting) {
                // ★ 用 Standard 材质，加一点 emissive 保底
                return new THREE.MeshStandardMaterial({
                    color,
                    roughness: 0.85,
                    metalness: 0,
                    emissive: color,          // 用原色做 emissive
                    emissiveIntensity: 0.0,   // 白天 0，夜晚由 _updateNightGlow 动态调
                });
            }
            return new THREE.MeshBasicMaterial({ color });
        },

        // ============================================================
        // 几何合并
        // ============================================================
        _mergeGeometries(THREE, geos) {
            if (geos.length === 0) return null;
            if (geos.length === 1) return geos[0];

            const merged = new THREE.BufferGeometry();
            const positions = [];
            const normals = [];
            const uvs = [];
            const indices = [];
            let vOffset = 0;

            for (const g of geos) {
                const pos = g.attributes.position.array;
                const nor = g.attributes.normal?.array || [];
                const uv = g.attributes.uv?.array || [];
                const idx = g.index ? g.index.array : null;

                for (let i = 0; i < pos.length; i++) positions.push(pos[i]);
                for (let i = 0; i < nor.length; i++) normals.push(nor[i]);
                for (let i = 0; i < uv.length; i++) uvs.push(uv[i]);

                const vCount = pos.length / 3;
                if (idx) {
                    for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vOffset);
                } else {
                    for (let i = 0; i < vCount; i++) indices.push(i + vOffset);
                }
                vOffset += vCount;

                g.dispose();
            }

            merged.setAttribute('position',
                new THREE.Float32BufferAttribute(positions, 3));
            if (normals.length > 0) {
                merged.setAttribute('normal',
                    new THREE.Float32BufferAttribute(normals, 3));
            } else {
                merged.computeVertexNormals();
            }
            if (uvs.length > 0) {
                merged.setAttribute('uv',
                    new THREE.Float32BufferAttribute(uvs, 2));
            }
            merged.setIndex(indices);
            merged.computeBoundingSphere();
            return merged;
        },

        // ============================================================
        // 销毁
        // ============================================================
        destroy(scene) {
            for (const mesh of this._meshGroups) {
                scene.remove(mesh);
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(m => m.dispose());
                } else {
                    mesh.material?.dispose?.();
                }
                mesh.dispose?.();
            }
            this._meshGroups = [];

            for (const light of this._lights) {
                scene.remove(light);
            }
            this._lights = [];

            for (const parts of this._geoCache.values()) {
                if (!parts) continue;
                for (const p of parts) {
                    p.geo?.dispose?.();
                    p.mat?.dispose?.();
                }
            }
            this._geoCache.clear();

            console.log('[Map3DProps] 已销毁');
        },

        CFG,
    };

    window.Map3DProps = Props;
    console.log('[CinemaWorld] map-3d-props.js 已加载');
})();