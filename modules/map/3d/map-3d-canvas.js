// ============================================================
// CinemaWorld · map-3d-canvas.js
// Three.js 渲染器：把现有 2D 格子地图渲染成 3D 场景
// 暴露：window.MapCanvas3D
// ============================================================

(function () {
    'use strict';

    const MapCanvas3D = {
        THREE: null,
        scene: null,
        renderer: null,
        container: null,
        _running: false,
        _rafId: null,

        // 世界对象容器
        _groundGroup: null,
        _decorGroup: null,
        _entityGroup: null,
        _plotGroup: null,

        // 地图尺寸（格子单位）
        _mapW: 0,
        _mapH: 0,
        _tileSize: 1,

        // 玩家
        _playerSprite: null,
        _playerData: null,

        // 缓存：entId → { sprite, shadow }
        _entityNodes: new Map(),
        // 缓存：plotId → { plane, cropSprites[] }
        _plotNodes: new Map(),
        // 缓存：地形材质
        _terrainMaterials: new Map(),

        // ============================================================
        // 初始化
        // ============================================================
        async init(container, map, options = {}) {
            console.log('[3D init] 开始, map:', map?.name);
            console.log('[3D init] map._generated:', !!map?._generated);
            console.log('[3D init] grid 尺寸:',
                map?._generated?.grid?.[0]?.length,
                'x',
                map?._generated?.grid?.length);

            if (!map?._generated?.grid) {
                console.warn('[MapCanvas3D] 地图数据不完整');
                return false;
            }
            // ---------- 数据校验 ----------
            if (!map?._generated?.grid) {
                console.warn('[MapCanvas3D] 地图数据不完整');
                return false;
            }

            this.THREE = window.THREE;
            if (!this.THREE) {
                console.warn('[MapCanvas3D] THREE 未加载');
                return false;
            }

            // ---------- 加载 2D 图集 → 3D 纹理 ----------
            if (window.Map3DTextures) {
                await window.Map3DTextures.load();
            }

            this.container = container;
            this._mapW = map._generated.grid[0].length;
            this._mapH = map._generated.grid.length;
            this._tileSize = options.tileSize || 1;

            // ============================================================
            // 1. 场景
            // ============================================================
            this.scene = new this.THREE.Scene();
            this.scene.background = new this.THREE.Color(0x0d0d18);
            this.scene.fog = new this.THREE.Fog(0x0d0d18, 40, 90);
            // ★ 程序化天空
            if (window.Map3DSky) {
                window.Map3DSky.init(this.THREE, this.scene);
            }
            // ============================================================
            // 2. 渲染器
            // ============================================================
            // ★ 用 getBoundingClientRect 拿准确尺寸
            const rect = container.getBoundingClientRect();
            const W = Math.floor(rect.width) || container.clientWidth || 900;
            const H = Math.floor(rect.height) || container.clientHeight || 600;

            this.renderer = new this.THREE.WebGLRenderer({
                antialias: false,
                alpha: false,
                powerPreference: 'high-performance',
                stencil: false,
            });

            const pixelCount = W * H;
            const RENDER_SCALE = pixelCount > 2_000_000 ? 0.65 : 0.8;
            const rw = Math.floor(W * RENDER_SCALE);
            const rh = Math.floor(H * RENDER_SCALE);

            this.renderer.setSize(rw, rh, false);
            this.renderer.setPixelRatio(1);

            // ★ canvas 铺满容器（CSS 层面）
            const canvasEl = this.renderer.domElement;
            canvasEl.style.width = '100%';
            canvasEl.style.height = '100%';
            canvasEl.style.display = 'block';
            this.renderer.shadowMap.enabled = false;     // ★ 关闭阴影
            // ★ 不再需要 shadowMap.type

            // 输出色彩空间
            if (this.THREE.SRGBColorSpace) {
                this.renderer.outputColorSpace = this.THREE.SRGBColorSpace;
            } else if (this.THREE.sRGBEncoding !== undefined) {
                this.renderer.outputEncoding = this.THREE.sRGBEncoding;
            }

            container.innerHTML = '';
            container.appendChild(this.renderer.domElement);

            // ============================================================
            // 3. 光照
            // ============================================================
            const ambient = new this.THREE.AmbientLight(0xffffff, 0.9);
            this.scene.add(ambient);

            const sun = new this.THREE.DirectionalLight(0xfff4e0, 1.2);
            sun.position.set(30, 45, 20);
            sun.castShadow = false;     // ★ 关闭阴影
            this.scene.add(sun);

            this._sun = sun;
            this._ambient = ambient;
            // ============================================================
            // 3.5 程序化天空（进图时应用 + 每游戏小时检查）
            // ============================================================
            if (window.Map3DSky) {
                window.Map3DSky.init(this.THREE, this.scene, ambient, sun);
            }

            // ============================================================
            // 3.6 ★ 监听游戏小时（每小时检查一次时段是否变化）
            // ============================================================
            this._onEnvHour = () => {
                window.Map3DSky?.checkNow?.();
            };
            window.addEventListener('cw:env-hour', this._onEnvHour);
            // ============================================================
            // 4. 分组
            // ============================================================
            this._groundGroup = new this.THREE.Group();
            this._decorGroup = new this.THREE.Group();
            this._entityGroup = new this.THREE.Group();
            this._plotGroup = new this.THREE.Group();

            this.scene.add(this._groundGroup);
            this.scene.add(this._decorGroup);
            this.scene.add(this._entityGroup);
            this.scene.add(this._plotGroup);

            // ============================================================
            // 5. 相机（★ 必须在 overlay 之前）
            // ============================================================
            const aspect = W / H;
            window.Map3DCamera.init(this.THREE, aspect);
            this._camera = window.Map3DCamera.camera;

            // ★ 相机加入场景（这样它的子对象才会被渲染）
            this.scene.add(this._camera);

            await this._preloadPortraits(map);
            // ============================================================
            // 7. 渲染内容
            // ============================================================
            this._buildGround(map);
            this._buildDecor(map);
            this._buildEntities(map);
            this._buildPlots(map);

            // ============================================================
            // 8. 玩家 & 相机初始位置
            // ============================================================
            if (this._playerData) {
                const pos = this._gridToWorld(this._playerData.x, this._playerData.y);
                window.Map3DCamera.snapToPlayer(new this.THREE.Vector3(pos.x, 0, pos.z));
            }

            // ============================================================
            // 9. 事件绑定
            // ============================================================
            this._bindResize();
            this._bindInvalidateEvent();

            // ============================================================
            // 10. 启动
            // ============================================================
            this._running = true;
            this._loop();

            console.log('[MapCanvas3D] 已初始化:', map.name, `${this._mapW}x${this._mapH}`);
            return true;
        },
        // ============================================================
        // ★ 预加载立绘：等所有 NPC 立绘加载完
        // ============================================================
        async _preloadPortraits(map) {
            const sprites = window.MapSprites;
            if (!sprites) return;

            const targets = [];
            for (const ent of map.entities) {
                if (ent.kind !== 'npc' && ent.kind !== 'encounter') continue;
                if (ent.isPlayer) continue;
                targets.push(ent);
            }

            if (targets.length === 0) return;

            console.log(`[MapCanvas3D] 预加载 ${targets.length} 个 NPC 立绘...`);

            // 1. 触发加载
            for (const ent of targets) {
                sprites.requestPortraitLoad?.(ent);
            }

            // 2. 等待所有立绘就绪（或超时）
            const deadline = Date.now() + 3000;   // 最多等 3 秒
            await new Promise((resolve) => {
                const check = () => {
                    let ready = 0;
                    for (const ent of targets) {
                        const url = sprites.getPortraitSync?.(ent);
                        if (url) ready++;
                    }
                    if (ready >= targets.length || Date.now() > deadline) {
                        console.log(`[MapCanvas3D] 立绘就绪: ${ready}/${targets.length}`);
                        resolve();
                    } else {
                        setTimeout(check, 100);
                    }
                };
                check();
            });
        },
        // ============================================================
        // 格子 → 世界坐标
        // ============================================================
        _gridToWorld(gx, gy) {
            return {
                x: (gx - this._mapW / 2 + 0.5) * this._tileSize,
                z: (gy - this._mapH / 2 + 0.5) * this._tileSize,
            };
        },

        // 世界坐标 → 格子
        worldToGrid(wx, wz) {
            return {
                gx: Math.floor(wx / this._tileSize + this._mapW / 2),
                gy: Math.floor(wz / this._tileSize + this._mapH / 2),
            };
        },

        // ============================================================
        // 地形
        // ============================================================
        _buildGround(map) {
            const T = this.THREE;
            const grid = map._generated.grid;
            const W = this._mapW;
            const H = this._mapH;

            const useRealTextures = window.Map3DTextures?.ready('terrain');

            // 收集所有 tile（含地形 + 道路），一次遍历
            const terrainCells = [];   // { x, y, key }
            const roadCells = [];      // { x, y, key }

            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const cell = grid[y][x];
                    if (!cell) continue;

                    // 地形
                    if (cell.terrain && cell.terrain !== 'void') {
                        terrainCells.push({ x, y, key: cell.terrain });
                    }
                    // 道路（覆盖在地形上方）
                    if (cell.road) {
                        roadCells.push({ x, y, key: cell.road });
                    }
                }
            }

            // ---------- 地形层 ----------
            const tileGeo = new T.PlaneGeometry(this._tileSize, this._tileSize);
            tileGeo.rotateX(-Math.PI / 2);

            const terrainMatFactory = (key) => {
                if (useRealTextures) {
                    const tex = window.Map3DTextures.getTerrainTexture(key);
                    if (tex) {
                        return new T.MeshStandardMaterial({
                            map: tex,
                        });
                    }
                }
                const color = window.Map3DAssets.terrainColor(key);
                if (color === null) return null;
                return new T.MeshStandardMaterial({
                    color,
                });
            };

            this._buildChunkedLayer(terrainCells, tileGeo, terrainMatFactory, 0, this._groundGroup);

            // ---------- 道路层 ----------
            const roadMatFactory = (key) => {
                if (useRealTextures) {
                    const tex = window.Map3DTextures.getTerrainTexture(key);
                    if (tex) {
                        return new T.MeshStandardMaterial({
                            map: tex,
                            polygonOffset: true,
                            polygonOffsetFactor: -1,
                            polygonOffsetUnits: -1,
                        });
                    }
                }
                const color = key === 'path' ? 0x9a7a4a : 0x8a8a8a;
                return new T.MeshStandardMaterial({
                    color,
                    polygonOffset: true,
                    polygonOffsetFactor: -1,
                    polygonOffsetUnits: -1,
                });
            };

            this._buildChunkedLayer(roadCells, tileGeo, roadMatFactory, 0.01, this._groundGroup);

            console.log(
                `[MapCanvas3D] 地形 ${terrainCells.length} 格, 道路 ${roadCells.length} 格, ` +
                `切块大小 ${this.CHUNK_SIZE}`
            );
        },

        // ============================================================
        // ★ 核心：分块渲染
        //   cells: [{ x, y, key }]
        //   geo: 共用的 tile 几何体（会被复用）
        //   matFactory: (key) => Material
        //   yOffset: 抬升高度（道路用 0.01）
        // ============================================================
        CHUNK_SIZE: 32,   // 每块 16×16 格

        _buildChunkedLayer(cells, geo, matFactory, yOffset, parentGroup) {
            const T = this.THREE;
            if (!cells || cells.length === 0) return;

            const CHUNK = this.CHUNK_SIZE;

            // ---------- 1. 按 (chunk, key) 分组 ----------
            // 结构: Map<"cx,cy", Map<key, [{x,y}]>>
            const chunkMap = new Map();

            for (const c of cells) {
                const cx = Math.floor(c.x / CHUNK);
                const cy = Math.floor(c.y / CHUNK);
                const ckey = cx + ',' + cy;

                let bucket = chunkMap.get(ckey);
                if (!bucket) {
                    bucket = new Map();
                    chunkMap.set(ckey, bucket);
                }
                if (!bucket.has(c.key)) bucket.set(c.key, []);
                bucket.get(c.key).push(c);
            }

            // ---------- 2. 材质缓存（同 key 共用同一材质实例）----------
            const matCache = new Map();
            const getMat = (key) => {
                if (matCache.has(key)) return matCache.get(key);
                const m = matFactory(key);
                matCache.set(key, m);
                return m;
            };

            // ---------- 3. 逐块创建 InstancedMesh ----------
            const dummy = new T.Object3D();
            let meshCount = 0;
            let instanceCount = 0;

            for (const [ckey, bucket] of chunkMap) {
                for (const [key, tiles] of bucket) {
                    const mat = getMat(key);
                    if (!mat) continue;

                    const inst = new T.InstancedMesh(geo, mat, tiles.length);
                    inst.receiveShadow = true;

                    // 计算这块的 AABB（用于剔除）
                    let minX = Infinity, maxX = -Infinity;
                    let minZ = Infinity, maxZ = -Infinity;

                    for (let i = 0; i < tiles.length; i++) {
                        const t = tiles[i];
                        const pos = this._gridToWorld(t.x, t.y);
                        dummy.position.set(pos.x, yOffset, pos.z);
                        dummy.updateMatrix();
                        inst.setMatrixAt(i, dummy.matrix);

                        if (pos.x < minX) minX = pos.x;
                        if (pos.x > maxX) maxX = pos.x;
                        if (pos.z < minZ) minZ = pos.z;
                        if (pos.z > maxZ) maxZ = pos.z;

                        instanceCount++;
                    }
                    inst.instanceMatrix.needsUpdate = true;

                    // ★★★ 关键：手动设置包围盒/球，让 frustumCulled 真正生效
                    const halfTile = this._tileSize / 2;
                    inst.boundingBox = new T.Box3(
                        new T.Vector3(minX - halfTile, -0.01, minZ - halfTile),
                        new T.Vector3(maxX + halfTile, 0.01, maxZ + halfTile)
                    );
                    inst.boundingSphere = inst.boundingBox.getBoundingSphere(new T.Sphere());
                    inst.frustumCulled = true;

                    parentGroup.add(inst);
                    meshCount++;
                }
            }

            console.log(
                `[MapCanvas3D] 分块层: ${meshCount} 个 InstancedMesh, ` +
                `${instanceCount} 个实例, 每块 ${CHUNK}×${CHUNK}`
            );
        },

        // ============================================================
        // ★ 新增：渲染道路层
        // ============================================================
        _buildRoads(map) {
            const T = this.THREE;
            const grid = map._generated.grid;

            const useRealTextures = window.Map3DTextures?.ready('terrain');

            // 按 road 类型分组
            const roadBuckets = {};   // 'road' / 'path' → [{x,y}]

            for (let y = 0; y < grid.length; y++) {
                for (let x = 0; x < grid[y].length; x++) {
                    const cell = grid[y][x];
                    if (!cell?.road) continue;
                    const type = cell.road;   // 'road' | 'path'
                    if (!roadBuckets[type]) roadBuckets[type] = [];
                    roadBuckets[type].push({ x, y });
                }
            }

            const roadGeo = new T.PlaneGeometry(this._tileSize, this._tileSize);
            roadGeo.rotateX(-Math.PI / 2);

            for (const [roadType, tiles] of Object.entries(roadBuckets)) {
                let mat;

                // ★ 优先用真实纹理（MapTiles 里有 road / path 的 tile 索引）
                if (useRealTextures) {
                    const tex = window.Map3DTextures.getTerrainTexture(roadType);
                    if (tex) {
                        mat = new T.MeshStandardMaterial({
                            map: tex,
                            roughness: 0.95,
                            metalness: 0,
                            polygonOffset: true,              // ★ 防止 z-fighting
                            polygonOffsetFactor: -1,
                            polygonOffsetUnits: -1,
                        });
                    }
                }

                // 兜底：颜色
                if (!mat) {
                    const color = roadType === 'path' ? 0x9a7a4a : 0x8a8a8a;
                    mat = new T.MeshStandardMaterial({
                        color,
                        roughness: 0.95,
                        metalness: 0,
                        polygonOffset: true,
                        polygonOffsetFactor: -1,
                        polygonOffsetUnits: -1,
                    });
                }

                const inst = new T.InstancedMesh(roadGeo, mat, tiles.length);
                inst.receiveShadow = true;

                const dummy = new T.Object3D();
                tiles.forEach((t, i) => {
                    const pos = this._gridToWorld(t.x, t.y);
                    // ★ 抬高一点点，避免和地形 z-fighting
                    dummy.position.set(pos.x, 0.01, pos.z);
                    dummy.updateMatrix();
                    inst.setMatrixAt(i, dummy.matrix);
                });
                inst.instanceMatrix.needsUpdate = true;
                this._groundGroup.add(inst);

                console.log(`[MapCanvas3D] 道路层 ${roadType}: ${tiles.length} 格`);
            }
        },

        // ============================================================
        // 装饰
        // ============================================================
        _buildDecor(map) {
            const T = this.THREE;
            const grid = map._generated.grid;
            const useRealTextures = window.Map3DTextures?.ready('decor');

            for (let y = 0; y < grid.length; y++) {
                for (let x = 0; x < grid[y].length; x++) {
                    const cell = grid[y][x];
                    if (!cell?.decor) continue;
                    if (cell.decor.buildingId) continue;

                    let mat;

                    // ★ 优先真实纹理
                    if (useRealTextures) {
                        const tex = window.Map3DTextures.getDecorTexture(cell.decor);
                        if (tex) {
                            mat = new T.SpriteMaterial({
                                map: tex,
                                transparent: true,
                                depthWrite: false,
                                alphaTest: 0.05,
                            });
                        }
                    }

                    // 兜底：emoji
                    if (!mat) {
                        const emoji = window.Map3DAssets.decorEmoji(cell.decor);
                        if (!emoji) continue;
                        const emojiTex = window.Map3DAssets.emojiToTexture(emoji, T);
                        mat = new T.SpriteMaterial({
                            map: emojiTex,
                            transparent: true,
                            depthWrite: false,
                            alphaTest: 0.1,
                        });
                    }

                    const sprite = new T.Sprite(mat);
                    sprite.scale.set(1.2, 1.2, 1);
                    const pos = this._gridToWorld(x, y);
                    sprite.position.set(pos.x, 0.6, pos.z);
                    this._decorGroup.add(sprite);

                }
            }
        },

        // ============================================================
        // 实体（NPC / 玩家 / 物品 / 建筑）
        // ============================================================
        _buildEntities(map) {
            for (const ent of map.entities) {
                if (ent.kind === 'building') {
                    if (ent.anchor && ent.size) this._buildBuilding(ent);
                    continue;
                }
                if (!ent._placed) continue;
                if (ent.x === undefined || ent.y === undefined) continue;
                this._buildOneEntity(ent);
            }
        },
        _buildOneEntity(ent) {
            const T = this.THREE;

            const isPlayer = !!ent.isPlayer;
            const isNPC = ent.kind === 'npc';
            const isEncounter = ent.kind === 'encounter';
            const isQuestPoint = ent.kind === 'quest_point';
            const isDecor = ent.kind === 'decor';

            const pickupField = ent.fields?.['可拾取'];
            const isPickable = pickupField === true
                || pickupField === '是'
                || String(pickupField || '').trim() === '是';

            const baseScale = isPlayer ? 2.0
                : (isEncounter ? 2.2 : 1.8);

            // ---------- 主 sprite ----------
            const mat = window.Map3DAssets.entitySpriteMaterial(ent, T);
            const sprite = new T.Sprite(mat);
            sprite.userData._entityId = ent.id;

            const { sw, sh } = window.Map3DAssets.spriteScaleFromTexture(mat, baseScale);
            sprite.scale.set(sw, sh, 1);

            const pos = this._gridToWorld(ent.x, ent.y);
            sprite.position.set(pos.x, sh / 2, pos.z);

            // ---------- 地面光圈 ----------
            const ringStyle = window.Map3DAssets.getGroundRingStyle(ent);
            let ring = null;
            if (ringStyle) {
                const ringMat = window.Map3DAssets.makeGroundRingMaterial(
                    T, ringStyle.color, ringStyle.opacity
                );
                const ringGeo = new T.PlaneGeometry(
                    ringStyle.radius * 2, ringStyle.radius * 2
                );
                ringGeo.rotateX(-Math.PI / 2);
                ring = new T.Mesh(ringGeo, ringMat);
                ring.position.set(pos.x, 0.06, pos.z);
                ring.userData._pulse = !!ringStyle.pulse;
                this._entityGroup.add(ring);
            }

            // ---------- 名字标签 ----------
            let nameLabel = null;
            const isPortal = ent.kind === 'portal';

            if (isNPC || isEncounter || isDecor || isPickable || isPortal) {
                nameLabel = window.Map3DAssets.makeTextSprite(T, ent.name, {
                    fontSize: 28,
                    bgColor: isPortal ? 'rgba(20, 50, 50, 0.85)'
                        : (isPickable ? 'rgba(20, 35, 60, 0.85)'
                            : (isDecor ? 'rgba(30, 25, 45, 0.85)'
                                : (isEncounter ? 'rgba(60, 20, 20, 0.85)'
                                    : 'rgba(40, 30, 10, 0.85)'))),
                    borderColor: isPortal ? 'rgba(140, 255, 220, 0.9)'
                        : (isPickable ? 'rgba(90, 176, 255, 0.9)'
                            : (isDecor ? 'rgba(180, 144, 255, 0.9)'
                                : (isEncounter ? 'rgba(255, 140, 140, 0.9)'
                                    : 'rgba(255, 215, 140, 0.9)'))),
                    textColor: isPortal ? '#a8ffe0'
                        : (isPickable ? '#5ab0ff'
                            : (isDecor ? '#d0b0ff'
                                : (isEncounter ? '#ffb8b8' : '#ffd76b'))),
                });
                if (nameLabel) {
                    nameLabel.position.set(pos.x, sh + 0.3, pos.z);
                    this._entityGroup.add(nameLabel);
                }
            }

            // ---------- 头顶标记 ----------
            let markSprite = null;
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            const isMainTarget = mq?.active && mq.status === 'active'
                && mq.target.kind === 'entity'
                && mq.target.entityId === ent.id;

            if (isMainTarget || isQuestPoint) {
                const tex = window.Map3DAssets.emojiToTexture('❗', T, 128);
                const mMat = new T.SpriteMaterial({
                    map: tex, transparent: true, depthWrite: false, alphaTest: 0.05,
                });
                markSprite = new T.Sprite(mMat);
                markSprite.scale.set(0.7, 0.7, 1);
                markSprite.userData._baseScale = 0.7;
                markSprite.position.set(pos.x, sh + 1.0, pos.z);
                markSprite.userData._baseY = sh + 1.0;
                this._entityGroup.add(markSprite);
            } else if (isPickable) {
                const tex = window.Map3DAssets.emojiToTexture('🖐️', T, 128);
                const mMat = new T.SpriteMaterial({
                    map: tex, transparent: true, depthWrite: false, alphaTest: 0.05,
                });
                markSprite = new T.Sprite(mMat);
                markSprite.scale.set(0.6, 0.6, 1);
                markSprite.userData._baseScale = 0.7;
                markSprite.position.set(pos.x, sh + 0.9, pos.z);
                markSprite.userData._baseY = sh + 0.9;
                this._entityGroup.add(markSprite);
            }

            // ---------- 玩家光圈 ----------
            let playerRing = null;
            if (isPlayer) {
                const prGeo = new T.PlaneGeometry(1.6, 1.6);
                prGeo.rotateX(-Math.PI / 2);
                const prMat = window.Map3DAssets.makeGroundRingMaterial(T, 0x6688ff, 0.55);
                playerRing = new T.Mesh(prGeo, prMat);
                playerRing.position.set(pos.x, 0.05, pos.z);
                playerRing.userData._pulse = true;
                this._entityGroup.add(playerRing);

                this._playerSprite = sprite;
                this._playerData = ent;
            }

            // ---------- 加入场景 ----------
            this._entityGroup.add(sprite);

            this._entityNodes.set(ent.id, {
                sprite, ring, nameLabel, markSprite, playerRing,
                baseScale,
                _sized: false,
                _facing: isPlayer ? null : undefined,
            });
        },
        _buildBuilding(ent) {
            const T = this.THREE;
            if (!ent.anchor || !ent.size) return;

            const w = ent.size.w * this._tileSize;
            const h = ent.size.h * this._tileSize;

            const cx = ent.anchor.x + ent.size.w / 2 - 0.5;
            const cy = ent.anchor.y + ent.size.h / 2 - 0.5;
            const pos = this._gridToWorld(cx, cy);

            // ============================================================
            // 1. 占位底（土黄）
            // ============================================================
            const markGeo = new T.PlaneGeometry(w - 0.04, h - 0.04);
            markGeo.rotateX(-Math.PI / 2);
            const markMat = new T.MeshBasicMaterial({
                color: 0xa88a5a,
                transparent: true,
                opacity: 0.35,
                depthWrite: false,
            });
            const mark = new T.Mesh(markGeo, markMat);
            mark.position.set(pos.x, 0.04, pos.z);
            mark.renderOrder = -2;
            this._entityGroup.add(mark);

            // 边框
            const edgeGeo = new T.EdgesGeometry(markGeo);
            const edgeMat = new T.LineBasicMaterial({
                color: 0x6a4a2a,
                transparent: true,
                opacity: 0.5,
            });
            const edges = new T.LineSegments(edgeGeo, edgeMat);
            edges.position.set(pos.x, 0.05, pos.z);
            edges.renderOrder = -1;
            this._entityGroup.add(edges);

            // ============================================================
            // 2. 建筑 sprite —— 优先纹理，兜底 Box
            // ============================================================
            const tex = window.Map3DTextures?.getBuildingTexture(ent);
            let sprite;

            if (tex) {
                // 优先：用纹理 sprite
                const mat = new T.SpriteMaterial({
                    map: tex,
                    transparent: true,
                    depthWrite: false,
                    alphaTest: 0.02,
                });
                sprite = new T.Sprite(mat);
                sprite.scale.set(w, h, 1);
                sprite.position.set(pos.x, h / 2, pos.z);
                sprite.userData._entityId = ent.id;
                sprite.userData._isBuilding = true;
                this._entityGroup.add(sprite);
            } else {
                // 兜底：Box + emoji
                console.warn('[MapCanvas3D] 建筑纹理缺失，用 Box:', ent.name);

                const height = 1.2;
                const geo = new T.BoxGeometry(w * 0.9, height, h * 0.9);
                const color = this._buildingColor(ent);
                const mat = new T.MeshStandardMaterial({ color, roughness: 0.8 });
                sprite = new T.Mesh(geo, mat);
                sprite.position.set(pos.x, height / 2, pos.z);
                sprite.userData._entityId = ent.id;

                this._entityGroup.add(sprite);

                // 顶部 emoji
                const emoji = ent.emoji || '🏠';
                const emojiTex = window.Map3DAssets.emojiToTexture(emoji, T);
                const spriteMat = new T.SpriteMaterial({
                    map: emojiTex,
                    transparent: true,
                    depthWrite: false,
                });
                const emojiSprite = new T.Sprite(spriteMat);
                emojiSprite.scale.set(1.5, 1.5, 1);
                emojiSprite.position.set(pos.x, height + 0.8, pos.z);
                this._entityGroup.add(emojiSprite);
            }

            // ============================================================
            // 3. 门标记
            // ============================================================
            let doorData = null;
            if (ent.entrance) {
                doorData = this._buildBuildingEntrance(ent);
            }

            // ============================================================
            // 5. 记录
            // ============================================================
            this._entityNodes.set(ent.id, {
                sprite,
                mark,
                edges,
                doorData,
                _isBuilding: true,      // ★ 标记是建筑，方便剔除逻辑跳过
            });

            console.log(`[MapCanvas3D] 建筑: ${ent.name} @ (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}), tex=${!!tex}`);
        },

        // ============================================================
        // 画门标记（发光圈 + 建筑名）
        // ============================================================
        _buildBuildingEntrance(ent) {
            const T = this.THREE;
            const entrance = ent.entrance;
            if (!entrance) return null;

            const epos = this._gridToWorld(entrance.x, entrance.y);

            // 青绿光圈（静态）
            const ringGeo = new T.PlaneGeometry(1.6, 1.6);
            ringGeo.rotateX(-Math.PI / 2);
            const ringMat = window.Map3DAssets.makeGroundRingMaterial(T, 0x8cffdc, 0.75);
            const ring = new T.Mesh(ringGeo, ringMat);
            ring.position.set(epos.x, 0.07, epos.z);
            ring.userData._isBuildingEntrance = true;
            ring.userData._buildingId = ent.id;
            ring.userData._buildingName = ent.name;
            this._entityGroup.add(ring);

            // 名字标签
            const nameLabel = window.Map3DAssets.makeTextSprite(T, ent.name, {
                fontSize: 28,
                bgColor: 'rgba(20, 50, 50, 0.85)',
                borderColor: 'rgba(140, 255, 220, 0.9)',
                textColor: '#a8ffe0',
            });
            if (nameLabel) {
                nameLabel.position.set(epos.x, 1.5, epos.z);
                nameLabel.userData._isBuildingEntrance = true;
                nameLabel.userData._buildingId = ent.id;
                nameLabel.userData._buildingName = ent.name;
                this._entityGroup.add(nameLabel);
            }

            console.log(`[MapCanvas3D] 门: ${ent.name} @ (${entrance.x}, ${entrance.y})`);

            return { ring, nameLabel };
        },

        // ============================================================
        // 工具：文字 sprite（渲染文字到 canvas）
        // ============================================================
        _makeTextSprite(text, THREE) {
            if (!text) return null;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.font = 'bold 32px sans-serif';
            const tw = ctx.measureText(text).width;

            canvas.width = Math.ceil(tw + 24);
            canvas.height = 48;

            const ctx2 = canvas.getContext('2d');
            // 背景
            ctx2.fillStyle = 'rgba(20, 40, 40, 0.85)';
            ctx2.beginPath();
            ctx2.roundRect(0, 0, canvas.width, canvas.height, 8);
            ctx2.fill();
            // 边框
            ctx2.strokeStyle = 'rgba(140, 255, 220, 0.9)';
            ctx2.lineWidth = 2;
            ctx2.stroke();
            // 文字
            ctx2.font = 'bold 28px sans-serif';
            ctx2.textAlign = 'center';
            ctx2.textBaseline = 'middle';
            ctx2.fillStyle = '#a8ffe0';
            ctx2.fillText(text, canvas.width / 2, canvas.height / 2);

            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;

            const mat = new T.MeshLambertMaterial({
                map: tex,
            });
            return new THREE.Sprite(mat);
        },
        _updateSmoothPositions(dt) {
            if (dt === undefined) dt = 1 / 60;
            const map = window.MapLauncher?.getMap?.();
            if (!map?._generated) return;

            // ★ 按时间算系数
            const kPos = 1 - Math.pow(0.5, dt / 0.05);   // 半衰期 50ms

            // ---------- 玩家 ----------
            if (this._playerData) {
                const p = this._playerData;
                const node = this._entityNodes.get(p.id);
                if (node?.sprite) {
                    const target = this._gridToWorld(p.x, p.y);
                    node.sprite.position.x += (target.x - node.sprite.position.x) * kPos;
                    node.sprite.position.z += (target.z - node.sprite.position.z) * kPos;

                    this._ensureSpriteSized(node);

                    const facing = window.MapSprites?.playerFacing || 'down';
                    if (node._facing !== facing) {
                        node._facing = facing;
                        this._refreshPlayerFacing(node);
                    }

                    this._syncNodeAttachments(node);
                }
            }

            // ---------- NPC / 其他 ----------
            for (const ent of map.entities) {
                if (ent.isPlayer) continue;
                if (!ent._placed) continue;
                if (ent.kind === 'building') continue;

                const node = this._entityNodes.get(ent.id);
                if (!node?.sprite) continue;

                const target = this._gridToWorld(ent.x, ent.y);
                node.sprite.position.x += (target.x - node.sprite.position.x) * kPos;
                node.sprite.position.z += (target.z - node.sprite.position.z) * kPos;

                this._ensureSpriteSized(node);
                this._syncNodeAttachments(node);
            }
        },

        // ============================================================
        // 同步所有附属元素位置 + 脉动
        // ============================================================
        _syncNodeAttachments(node) {
            if (!node?.sprite) return;

            const sx = node.sprite.position.x;
            const sz = node.sprite.position.z;
            const sh = node.sprite.scale.y;

            // 地面光圈
            if (node.ring) {
                node.ring.position.x = sx;
                node.ring.position.z = sz;
                // ★ 删掉脉动，固定 scale
                const baseR = node.ring.userData._baseRadius || 1;
                node.ring.scale.set(1, 1, 1);
            }

            // 玩家光圈
            if (node.playerRing) {
                node.playerRing.position.x = sx;
                node.playerRing.position.z = sz;
                node.playerRing.scale.set(1, 1, 1);
            }

            // 名字标签
            if (node.nameLabel) {
                node.nameLabel.position.x = sx;
                node.nameLabel.position.z = sz;
                node.nameLabel.position.y = sh + 0.3;
            }

            // 头顶标记
            if (node.markSprite) {
                node.markSprite.position.x = sx;
                node.markSprite.position.z = sz;
                // ★ 删掉浮动
                const baseY = node.markSprite.userData._baseY || (sh + 1.0);
                node.markSprite.position.y = baseY;
                // ★ 删掉脉动，固定 scale（保留初始 scale）
                const s = node.markSprite.userData._baseScale || 0.7;
                node.markSprite.scale.set(s, s, 1);
            }

        },

        // ★ 玩家朝向变化 → 换材质
        _refreshPlayerFacing(node) {
            const T = this.THREE;
            const sprite = node.sprite;

            const srcRect = window.MapSprites?.getPlayerSourceRect?.();
            const cfg = window.MapSprites?.playerConfig;
            if (!srcRect || !cfg) {
                console.warn('[MapCanvas3D] 无法取玩家源图:', { srcRect, cfg });
                return;
            }

            const pad = cfg.pad || 0;
            const col = Math.floor(srcRect.sx / (cfg.tileW + pad));
            const row = Math.floor(srcRect.sy / (cfg.tileH + pad));

            const tex = window.Map3DTextures?.getTileTexture('player', col, row);
            if (!tex) {
                console.warn('[MapCanvas3D] 玩家纹理取不到:', col, row);
                return;
            }

            const oldMat = sprite.material;
            sprite.material = new T.SpriteMaterial({
                map: tex,
                transparent: true,
                depthWrite: false,
                alphaTest: 0.05,
            });

            // 玩家尺寸固定（正方形）
            const baseScale = node.baseScale || 1.5;
            sprite.scale.set(baseScale, baseScale, 1);
            sprite.position.y = baseScale / 2;

            if (oldMat && oldMat.map !== tex) {
                oldMat.dispose();
            }

            console.log(
                `[MapCanvas3D] 玩家朝向: ${window.MapSprites.playerFacing} → (col=${col}, row=${row})`
            );
        },

        // 异步纹理加载完后重算尺寸（立绘等）
        _ensureSpriteSized(node) {
            if (node._sized) return;
            if (!node.sprite?.material?.map?.image) return;

            const img = node.sprite.material.map.image;
            if (!img.naturalWidth || !img.naturalHeight) return;

            node._sized = true;

            const { sw, sh } = window.Map3DAssets.spriteScaleFromTexture(
                node.sprite.material,
                node.baseScale || 1.2
            );
            node.sprite.scale.set(sw, sh, 1);
            node.sprite.position.y = sh / 2;

            // ★ 同步名字标签
            if (node.nameLabel) {
                node.nameLabel.position.y = sh + 0.3;
            }

            // ★ 同步头顶 ❗
            if (node.markSprite) {
                const baseY = sh + 1.0;
                node.markSprite.userData._baseY = baseY;
                node.markSprite.position.y = baseY;
            }
        },
        _buildingColor(ent) {
            const name = (ent.name || '') + ' ' + (ent._spriteType || '');
            if (/民居|house|木屋|小屋/.test(name)) return 0xb08868;
            if (/商店|shop|铺/.test(name)) return 0xc8a060;
            if (/教堂|庙|temple|祠/.test(name)) return 0xa8a8c8;
            if (/市政|政府|tower|楼/.test(name)) return 0x9a9ab0;
            return 0xa89878;
        },

        _makePlayerRing(radius) {
            const T = this.THREE;
            const geo = new T.RingGeometry(radius * 0.7, radius, 32);
            geo.rotateX(-Math.PI / 2);
            const mat = new T.MeshBasicMaterial({
                color: 0x7da8ff,
                transparent: true,
                opacity: 0.7,
                side: T.DoubleSide,
                depthWrite: false,
            });
            return new T.Mesh(geo, mat);
        },

        // ============================================================
        // 玩法区
        // ============================================================
        _buildPlots(map) {
            if (!map._plots) return;
            const T = this.THREE;

            for (const plot of Object.values(map._plots)) {
                this._buildOnePlot(plot);
            }
        },

        _buildOnePlot(plot) {
            const T = this.THREE;
            const { x, y, w, h } = plot.bounds;

            // 覆盖平面
            const geo = new T.PlaneGeometry(w * this._tileSize, h * this._tileSize);
            geo.rotateX(-Math.PI / 2);
            const color = this._parsePlotColor(plot.color);
            const mat = new T.MeshBasicMaterial({
                color,
                transparent: true,
                opacity: 0.22,
                depthWrite: false,
            });
            const plane = new T.Mesh(geo, mat);

            const centerX = x + w / 2 - 0.5;
            const centerY = y + h / 2 - 0.5;
            const pos = this._gridToWorld(centerX, centerY);
            plane.position.set(pos.x, 0.08, pos.z);
            plane.userData._plotId = plot.id;
            this._plotGroup.add(plane);

            // 边框
            const edges = new T.EdgesGeometry(geo);
            const lineMat = new T.LineBasicMaterial({ color: 0x88ff88, transparent: true, opacity: 0.6 });
            const line = new T.LineSegments(edges, lineMat);
            line.position.copy(plane.position);
            this._plotGroup.add(line);

            // 作物图标
            const cropSprites = [];
            this._refreshPlotCrops(plot, cropSprites);

            this._plotNodes.set(plot.id, { plane, line, cropSprites });
        },

        _refreshPlotCrops(plot, spriteArray) {
            const T = this.THREE;
            // 清掉旧的
            for (const s of spriteArray) this._plotGroup.remove(s);
            spriteArray.length = 0;

            if (plot.status !== 'growing' && plot.status !== 'ready') return;
            const crop = plot.rules?.crops?.[plot.cropId];
            if (!crop) return;

            const stages = crop.stages || [crop.emoji || '🌱'];
            const idx = plot.status === 'ready'
                ? stages.length - 1
                : Math.min(
                    Math.floor((plot.progress || 0) * stages.length),
                    stages.length - 1
                );
            const icon = stages[idx];

            const tex = window.Map3DAssets.emojiToTexture(icon, T);
            const { x, y, w, h } = plot.bounds;

            for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                    const mat = new T.SpriteMaterial({
                        map: tex,
                        transparent: true,
                        depthWrite: false,
                        alphaTest: 0.1,
                    });
                    const s = new T.Sprite(mat);
                    s.scale.set(0.7, 0.7, 1);
                    const pos = this._gridToWorld(x + dx, y + dy);
                    s.position.set(pos.x, 0.5, pos.z);
                    s.userData._plotId = plot.id;
                    this._plotGroup.add(s);
                    spriteArray.push(s);
                }
            }
        },

        _parsePlotColor(rgba) {
            if (!rgba) return 0x88d888;
            const m = String(rgba).match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (!m) return 0x88d888;
            return (parseInt(m[1]) << 16) | (parseInt(m[2]) << 8) | parseInt(m[3]);
        },

        // ============================================================
        // 同步接口（供逻辑层调用）
        // ============================================================
        syncPlayer(ent) {
            if (!ent) return;
            const node = this._entityNodes.get(ent.id);
            if (!node) return;
            const pos = this._gridToWorld(ent.x, ent.y);
            node.sprite.position.x = pos.x;
            node.sprite.position.z = pos.z;

            if (node.sprite.userData._ring) {
                node.sprite.userData._ring.position.x = pos.x;
                node.sprite.userData._ring.position.z = pos.z;
            }
            // 相机跟随
            window.Map3DCamera.setTarget(pos.x, 0.5, pos.z);
        },

        syncEntity(ent) {
            if (!ent) return;
            const node = this._entityNodes.get(ent.id);
            if (!node) return;
            const pos = this._gridToWorld(ent.x, ent.y);
            node.sprite.position.x = pos.x;
            node.sprite.position.z = pos.z;

        },

        syncPlot(plot) {
            const node = this._plotNodes.get(plot.id);
            if (!node) return;
            this._refreshPlotCrops(plot, node.cropSprites);
        },
        // 在 map-3d-canvas.js 的 _loop 里加
        _updateInfo() {
            const el = document.getElementById('cw-3d-info');
            if (!el) return;

            const facing = window.MapSprites?.playerFacing || '?';
            const yaw = window.Map3DCamera?._smoothYaw ?? 0;
            const deg = (yaw * 180 / Math.PI).toFixed(0);
            const player = this._playerData;
            if (!player) { el.textContent = ''; return; }

            el.textContent =
                `朝向: ${facing} | 相机: ${deg}°\n` +
                `玩家: (${player.x}, ${player.y})`;
        },
        // ============================================================
        // 主循环
        // ============================================================
        _loop() {
            if (!this._running) return;

            const now = performance.now();

            const player = this._playerData;
            const playerMoving = player?._visualToX !== undefined;

            const cameraMoving =
                window.Map3DCamera._snapTargetYaw !== null ||
                Math.abs(window.Map3DCamera._yaw - window.Map3DCamera._smoothYaw) > 0.01;

            const idle = !playerMoving && !cameraMoving;
            const interval = idle ? 50 : 16;
            if (now - (this._lastFrame || 0) < interval) {
                this.rafId = requestAnimationFrame(() => this._loop());
                return;
            }
            const dt = Math.min(0.1, (now - (this._lastFrame || now)) / 1000);
            this._lastFrame = now;

            // ★★★ 新增：驱动 2D 的移动逻辑（输入解析 + _tryMove）
            //     必须在 camera.update 之前，让相机能跟上最新位置
            try {
                window.MapCanvas?._updateMovementOnly?.(now);
            } catch (e) {
                console.error('[MapCanvas3D] 驱动 2D 移动失败:', e);
            }

            window.Map3DCamera.update(dt);
            // ★ 天空跟随 + 时间
            if (window.Map3DSky) {
                window.Map3DSky.follow(this._camera);
                window.Map3DSky.tick(now / 1000);
            }
            this._updateSmoothPositions(dt);   // ← 也传 dt
            this._updateInfo();
            this._updateDayNight();

            this._cullFrameCount = (this._cullFrameCount || 0) + 1;
            if (this._cullFrameCount >= 5) {
                this._cullFrameCount = 0;
                this._updateCulling();
            }

            try {
                this.renderer.render(this.scene, this._camera);
            } catch (e) {
                console.error('[MapCanvas3D] 渲染失败:', e);
                this._running = false;
                return;
            }

            this.rafId = requestAnimationFrame(() => this._loop());
        },
        // ============================================================
        // ★ 更新昼夜滤镜
        // ============================================================
        // ============================================================
        // ★ 更新昼夜滤镜（DOM 叠加，0 GPU 开销）
        // ============================================================
        _updateDayNight() {
            const el = document.getElementById('cw-3d-night');
            if (!el) return;

            const filter = window.DayNightFilter?.getCurrent?.();

            if (!filter || filter.alpha <= 0.01) {
                if (el.style.display !== 'none') el.style.display = 'none';
                return;
            }

            const { r, g, b, alpha } = filter;
            const bg = `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;

            // 只在颜色变化时更新 DOM（避免每帧 style 重排）
            if (el.dataset.bg !== bg) {
                el.dataset.bg = bg;
                el.style.background = bg;
            }
            if (el.style.display !== 'block') el.style.display = 'block';
        },
        // ============================================================
        // 事件监听
        // ============================================================
        _bindInvalidateEvent() {
            if (this._invalidateBound) return;
            this._invalidateBound = true;

            this._onInvalidate = (e) => {
                const { type, entityId, plotId } = e.detail || {};
                try {
                    this._handleInvalidate(type, entityId, plotId);
                } catch (err) {
                    console.error('[MapCanvas3D] 处理失效事件失败:', err);
                }
            };

            window.addEventListener('cw:3d-invalidate', this._onInvalidate);
            console.log('[MapCanvas3D] 已监听数据失效事件');
        },

        _unbindInvalidateEvent() {
            if (!this._invalidateBound) return;
            this._invalidateBound = false;
            if (this._onInvalidate) {
                window.removeEventListener('cw:3d-invalidate', this._onInvalidate);
                this._onInvalidate = null;
            }
        },

        // ============================================================
        // 处理失效事件
        // ============================================================
        _handleInvalidate(type, entityId, plotId) {
            const map = window.MapLauncher?.getMap?.();
            if (!map?._generated) return;

            switch (type) {
                case 'entity-add':
                    this._syncAddEntities();
                    break;

                case 'entity-remove':
                    if (entityId) this._removeEntityNode(entityId);
                    else this._syncRemoveEntities();
                    break;

                case 'entity-update':
                    if (entityId) this._updateEntityNode(entityId);
                    break;

                case 'plot-update':
                    if (plotId) this._updatePlotNode(plotId);
                    break;

                case 'all':
                    this._syncAllEntities();
                    this._syncAllPlots();
                    break;

                default:
                    // 兜底全量
                    this._syncAllEntities();
                    break;
            }
        },

        // ============================================================
        // 全量同步实体
        // ============================================================
        _syncAllEntities() {
            const map = window.MapLauncher?.getMap?.();
            if (!map?._generated) return;

            const currentIds = new Set();
            for (const ent of map.entities) {
                if (ent.kind === 'building') continue;
                if (!ent._placed) continue;
                if (ent.x === undefined || ent.y === undefined) continue;
                currentIds.add(ent.id);
            }

            // 删除不在 map 里的
            for (const id of [...this._entityNodes.keys()]) {
                if (!currentIds.has(id)) this._removeEntityNode(id);
            }

            // 补建 map 里没有的
            let added = 0;
            for (const ent of map.entities) {
                if (ent.kind === 'building') continue;
                if (!ent._placed) continue;
                if (ent.x === undefined || ent.y === undefined) continue;
                if (this._entityNodes.has(ent.id)) continue;
                this._buildOneEntity(ent);
                added++;
            }

            if (added > 0) {
                console.log(`[MapCanvas3D] 全量同步: 补建 ${added} 个`);
            }
        },

        // ============================================================
        // 只添加
        // ============================================================
        _syncAddEntities() {
            const map = window.MapLauncher?.getMap?.();
            if (!map?._generated) return;

            let added = 0;
            for (const ent of map.entities) {
                if (ent.kind === 'building') continue;
                if (!ent._placed) continue;
                if (ent.x === undefined || ent.y === undefined) continue;
                if (this._entityNodes.has(ent.id)) continue;
                this._buildOneEntity(ent);
                added++;
            }

            if (added > 0) {
                console.log(`[MapCanvas3D] 新增 ${added} 个实体`);
            }
        },

        // ============================================================
        // 只删除
        // ============================================================
        _syncRemoveEntities() {
            const map = window.MapLauncher?.getMap?.();
            if (!map?._generated) return;

            const currentIds = new Set(
                map.entities
                    .filter(e => e.kind !== 'building' && e._placed
                        && e.x !== undefined && e.y !== undefined)
                    .map(e => e.id)
            );

            let removed = 0;
            for (const id of [...this._entityNodes.keys()]) {
                if (!currentIds.has(id)) {
                    this._removeEntityNode(id);
                    removed++;
                }
            }

            if (removed > 0) {
                console.log(`[MapCanvas3D] 移除 ${removed} 个实体`);
            }
        },

        // ============================================================
        // 删除一个实体节点及其所有附属对象
        // ============================================================
        _removeEntityNode(id) {
            const node = this._entityNodes.get(id);
            if (!node) return;

            const G = this._entityGroup;
            const removeFromGroup = (obj) => {
                if (!obj) return;
                G.remove(obj);
                if (obj.geometry) obj.geometry.dispose?.();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => {
                            m.map?.dispose?.();
                            m.dispose?.();
                        });
                    } else {
                        obj.material.map?.dispose?.();
                        obj.material.dispose?.();
                    }
                }
            };

            removeFromGroup(node.sprite);
            removeFromGroup(node.outline);
            removeFromGroup(node.ring);
            removeFromGroup(node.nameLabel);
            removeFromGroup(node.markSprite);
            removeFromGroup(node.playerRing);
            removeFromGroup(node.mark);
            removeFromGroup(node.edges);

            if (node.doorData) {
                removeFromGroup(node.doorData.ring);
                removeFromGroup(node.doorData.doorSprite);
                removeFromGroup(node.doorData.nameLabel);
            }

            this._entityNodes.delete(id);
        },

        // ============================================================
        // 更新单个实体（删旧建新）
        // ============================================================
        _updateEntityNode(entityId) {
            const map = window.MapLauncher?.getMap?.();
            const ent = map?.entities?.find(e => e.id === entityId);
            if (!ent) {
                this._removeEntityNode(entityId);
                return;
            }

            this._removeEntityNode(entityId);

            if (ent.kind === 'building') {
                if (ent.anchor && ent.size) this._buildBuilding(ent);
            } else {
                if (ent._placed && ent.x !== undefined && ent.y !== undefined) {
                    this._buildOneEntity(ent);
                }
            }
        },

        // ============================================================
        // 更新玩法区
        // ============================================================
        _updatePlotNode(plotId) {
            const map = window.MapLauncher?.getMap?.();
            const plot = map?._plots?.[plotId];
            if (!plot) return;

            const node = this._plotNodes.get(plotId);
            if (!node) return;

            if (node.cropSprites) {
                for (const s of node.cropSprites) {
                    this._plotGroup.remove(s);
                    s.material?.map?.dispose?.();
                    s.material?.dispose?.();
                }
                node.cropSprites.length = 0;
            } else {
                node.cropSprites = [];
            }

            this._refreshPlotCrops(plot, node.cropSprites);
        },

        _syncAllPlots() {
            const map = window.MapLauncher?.getMap?.();
            if (!map?._plots) return;

            for (const plotId of Object.keys(map._plots)) {
                this._updatePlotNode(plotId);
            }
        },
        // ============================================================
        // ★ 新增：视距剔除 + 远处简化
        //   - 超过 FAR_DIST 的实体不渲染（省 draw call）
        //   - 超过 NEAR_DIST 的实体不画描边/光晕（省 draw call）
        // ============================================================
        _updateCulling() {
            if (!this._camera) return;

            const camPos = this._camera.position;
            const NEAR_DIST = 24;    // 近距离：显示所有装饰
            const FAR_DIST = 32;     // 超远距离：不渲染
            const NEAR_DIST_SQ = NEAR_DIST * NEAR_DIST;
            const FAR_DIST_SQ = FAR_DIST * FAR_DIST;

            for (const [id, node] of this._entityNodes) {
                if (!node.sprite) continue;

                const dx = node.sprite.position.x - camPos.x;
                const dz = node.sprite.position.z - camPos.z;
                const distSq = dx * dx + dz * dz;

                // ---------- 超远 → 全部隐藏 ----------
                const visible = distSq <= FAR_DIST_SQ;

                if (node.sprite.visible !== visible) {
                    node.sprite.visible = visible;
                }

                if (!visible) {
                    if (node.outline) node.outline.visible = false;
                    if (node.ring) node.ring.visible = false;
                    if (node.groundShadow) node.groundShadow.visible = false;

                    continue;
                }

                // ---------- 远距离 → 隐藏装饰 ----------
                const showDeco = distSq <= NEAR_DIST_SQ;
                if (node.outline) node.outline.visible = showDeco;
                if (node.ring) node.ring.visible = showDeco;
                if (node.groundShadow) node.groundShadow.visible = showDeco;
                // 影子视觉重要，一直显示
            }
        },

        // ============================================================
        // 尺寸
        // ============================================================
        _bindResize() {
            this._onResize = () => {
                if (!this.renderer || !this._camera || !this.container) return;

                const rect = this.container.getBoundingClientRect();
                const W = Math.floor(rect.width);
                const H = Math.floor(rect.height);

                if (W < 100 || H < 100) return;

                this.renderer.setSize(W, H);
                this._camera.aspect = W / H;
                this._camera.updateProjectionMatrix();

                // ★ 保持 CSS 铺满
                const canvasEl = this.renderer.domElement;
                canvasEl.style.width = '100%';
                canvasEl.style.height = '100%';
            };

            window.addEventListener('resize', this._onResize);

            // ★ ResizeObserver 监听容器尺寸变化
            if (window.ResizeObserver) {
                this._resizeObserver = new ResizeObserver(() => {
                    this._onResize();
                });
                this._resizeObserver.observe(this.container);
            }
        },

        _unbindResize() {
            if (this._onResize) {
                window.removeEventListener('resize', this._onResize);
                this._onResize = null;
            }
            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
                this._resizeObserver = null;
            }
        },

        // ============================================================
        // 销毁
        // ============================================================
        destroy() {
            this._running = false;
            if (this._rafId) cancelAnimationFrame(this._rafId);
            if (this._onResize) window.removeEventListener('resize', this._onResize);
            this._unbindInvalidateEvent();

            // ★ 移除小时监听
            if (this._onEnvHour) {
                window.removeEventListener('cw:env-hour', this._onEnvHour);
                this._onEnvHour = null;
            }

            // ★ 销毁天空
            window.Map3DSky?.destroy();
            // 清空缓存
            this._entityNodes.clear();
            this._plotNodes.clear();
            this._terrainMaterials.clear();

            // 销毁 Three.js
            if (this.scene) {
                this.scene.traverse((obj) => {
                    if (obj.geometry) obj.geometry.dispose?.();
                    if (obj.material) {
                        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.());
                        else obj.material.dispose?.();
                    }
                });
            }
            if (this.renderer) {
                this.renderer.dispose();
                this.renderer.domElement?.remove();
            }

            window.Map3DCamera.destroy();

            this.scene = null;
            this.renderer = null;
            this._camera = null;
            this.container = null;
            this._playerSprite = null;
            this._playerData = null;

            console.log('[MapCanvas3D] 已销毁');
        },
    };

    window.MapCanvas3D = MapCanvas3D;
    console.log('[CinemaWorld] map-3d-canvas.js 已加载');
})();