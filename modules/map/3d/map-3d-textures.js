// ============================================================
// CinemaWorld · map-3d-textures.js
// 2D 图集 → 3D 纹理切片
// 暴露：window.Map3DTextures
// ============================================================

(function () {
    'use strict';

    // ---------- 路径推导 ----------
    const BASE_PATH = (() => {
        const cur = document.currentScript;
        if (cur && cur.src) {
            return cur.src.replace(/modules\/map\/3d\/map-3d-textures\.js.*$/, '');
        }
        return 'scripts/extensions/third-party/ST-CinemaWorld-main/';
    })();

    const Map3DTextures = {
        // ============================================================
        // 图集配置
        // ============================================================
        ATLASES: {
            terrain: {
                src: BASE_PATH + 'images/地图/地形.png',
                cols: 8, rows: 8,
                tileW: 32, tileH: 32,
            },
            decor: {
                src: BASE_PATH + 'images/地图/装饰.png',
                cols: 8, rows: 8,
                tileW: 32, tileH: 32,
            },
            building_2x2: {
                src: BASE_PATH + 'images/地图/建筑_2x2.png',
                cols: 4, rows: 4,
                tileW: 64, tileH: 64,
            },
            building_3x3: {
                src: BASE_PATH + 'images/地图/建筑_3x3.png',
                cols: 3, rows: 3,
                tileW: 85, tileH: 85,
            },
            building_4x4: {
                src: BASE_PATH + 'images/地图/建筑_4x4.png',
                cols: 2, rows: 2,
                tileW: 128, tileH: 128,
            },
            sprite_common: {
                src: BASE_PATH + 'images/地图/角色精灵1.png',
                cols: 8, rows: 8,
                tileW: 32, tileH: 32,
            },
            sprite_male: {
                src: BASE_PATH + 'images/地图/男1.PNG',
                cols: 4, rows: 4,
                tileW: 64, tileH: 64,
            },
            sprite_female: {
                src: BASE_PATH + 'images/地图/女1.PNG',
                cols: 4, rows: 4,
                tileW: 64, tileH: 64,
            },
            player: {
                src: BASE_PATH + 'images/地图/玩家.png',
                cols: 2, rows: 2,
                tileW: 256, tileH: 256,
            },
        },

        // ============================================================
        // 运行时状态
        // ============================================================
        _images: {},        // key → HTMLImageElement
        _loadPromises: {},
        _textureCache: new Map(),   // 缓存切好的 THREE.Texture

        // ============================================================
        // 加载
        // ============================================================
        async load() {
            const tasks = [];
            for (const [key, cfg] of Object.entries(this.ATLASES)) {
                tasks.push(this._loadImage(key, cfg));
            }
            await Promise.all(tasks);
            console.log('[Map3DTextures] 所有图集已加载');
            return true;
        },

        _loadImage(key, cfg) {
            if (this._loadPromises[key]) return this._loadPromises[key];

            this._loadPromises[key] = new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => {
                    this._images[key] = img;
                    console.log(`[Map3DTextures] ${key} 已加载: ${img.width}×${img.height}`);
                    resolve(img);
                };
                img.onerror = () => {
                    console.warn(`[Map3DTextures] ${key} 加载失败: ${cfg.src}`);
                    resolve(null);
                };
                img.src = cfg.src;
            });

            return this._loadPromises[key];
        },

        ready(key) {
            return !!this._images[key];
        },

        // ============================================================
        // 核心：从图集取一个 tile 的纹理
        // ============================================================
        getTileTexture(atlasKey, col, row) {
            const cacheKey = `${atlasKey}|${col}|${row}`;
            if (this._textureCache.has(cacheKey)) {
                return this._textureCache.get(cacheKey);
            }
        
            const img = this._images[atlasKey];
            const cfg = this.ATLASES[atlasKey];
            if (!img || !cfg) return null;
        
            const THREE = window.THREE;
            if (!THREE) return null;
        
            const tex = new THREE.Texture(img);
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
        
            // ★ 加速采样：用 NearestMipmapLinear 代替 LinearMipmapLinear
            //   （mipmap 层级之间插值，但采样点用最近邻 → 更快）
            tex.minFilter = THREE.NearestMipmapLinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
        
            if (THREE.SRGBColorSpace) {
                tex.colorSpace = THREE.SRGBColorSpace;
            }
        
            tex.repeat.set(1 / cfg.cols, 1 / cfg.rows);
            tex.offset.set(
                col / cfg.cols,
                1 - (row + 1) / cfg.rows
            );
        
            tex.userData = {
                tileW: img.width / cfg.cols,
                tileH: img.height / cfg.rows,
                atlasW: img.width,
                atlasH: img.height,
                col, row,
                atlasKey,
            };
        
            tex.needsUpdate = true;
            this._textureCache.set(cacheKey, tex);
            return tex;
        },
        
        getFullTexture(url) {
            const cacheKey = `full|${url}`;
            if (this._textureCache.has(cacheKey)) {
                return this._textureCache.get(cacheKey);
            }
        
            const THREE = window.THREE;
            if (!THREE) return null;
        
            const loader = new THREE.TextureLoader();
            const tex = loader.load(url, (img) => {
                // ★ 立绘加载完 → 缩小到 384（降显存）
                const MAX_SIZE = 384;
                if (img.width > MAX_SIZE || img.height > MAX_SIZE) {
                    const ratio = Math.min(MAX_SIZE / img.width, MAX_SIZE / img.height);
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.floor(img.width * ratio);
                    canvas.height = Math.floor(img.height * ratio);
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
                    const newTex = new THREE.CanvasTexture(canvas);
                    newTex.minFilter = THREE.NearestMipmapLinearFilter;
                    newTex.magFilter = THREE.LinearFilter;
                    newTex.generateMipmaps = true;
                    newTex.needsUpdate = true;
                    if (THREE.SRGBColorSpace) newTex.colorSpace = THREE.SRGBColorSpace;
        
                    // 替换缓存
                    this._textureCache.set(cacheKey, newTex);
        
                    // ★ 更新所有已用这张纹理的 sprite
                    if (window.MapCanvas3D?._entityNodes) {
                        for (const [, node] of window.MapCanvas3D._entityNodes) {
                            if (node.sprite?.material?.map === tex) {
                                node.sprite.material.map = newTex;
                                node.sprite.material.needsUpdate = true;
                            }
                            if (node.outline?.material?.map === tex) {
                                node.outline.material.map = newTex;
                                node.outline.material.needsUpdate = true;
                            }
                        }
                    }
        
                    // 释放旧纹理
                    tex.dispose?.();
                }
            });
        
            tex.minFilter = THREE.NearestMipmapLinearFilter;   // ★ 快速采样
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = true;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
        
            if (THREE.SRGBColorSpace) {
                tex.colorSpace = THREE.SRGBColorSpace;
            }
        
            this._textureCache.set(cacheKey, tex);
            return tex;
        },

        // ============================================================
        // 语义 API：给"地形名" → 纹理
        // 复用 map-tiles.js 里的 TERRAIN_INDEX
        // ============================================================
        getTerrainTexture(terrain) {
            const idx = window.MapTiles?.TERRAIN_INDEX?.[terrain];
            if (idx === undefined) return null;
            return this._getIndexedTexture('terrain', idx);
        },

        // ============================================================
        // 语义 API：给"装饰 + 变体" → 纹理
        // 复用 map-tiles.js 里的 DECOR_INDEX
        // ============================================================
        getDecorTexture(decor) {
            if (!decor) return null;

            const entry = window.MapTiles?.DECOR_INDEX?.[decor.type];
            if (entry === undefined) return null;

            let idx;
            if (Array.isArray(entry)) {
                const v = (decor.variant ?? 0) % entry.length;
                idx = entry[v];
            } else {
                idx = entry;
            }
            return this._getIndexedTexture('decor', idx);
        },

        // ============================================================
        // 语义 API：给"建筑 + 尺寸" → 纹理
        // 用 map-buildings.js 的 TYPES 定义
        // ============================================================
        getBuildingTexture(ent) {
            if (!ent) return null;
        
            let typeKey = ent._spriteType;
            if (!typeKey && window.MapBuildings?.matchType) {
                typeKey = window.MapBuildings.matchType(ent.name, {
                    category: window.MapCanvas?._guessBuildingCategory?.(ent),
                    seed: ent.name,
                });
                ent._spriteType = typeKey;
            }
        
            if (!typeKey) return null;
        
            const def = window.MapBuildings?.TYPES?.[typeKey];
            if (!def) return null;
        
            const size = ent.size || { w: 3, h: 3 };
            const atlasKey = this._pickBuildingAtlas(size.w, size.h);
            if (!atlasKey) return null;
        
            // ★★★ 用 cropTileTexture 而不是 getTileTexture
            return this.cropTileTexture(atlasKey, def.col, def.row);
        },
        // ============================================================
// ★ 从图集切出一格，生成"独立纹理"
//   （Sprite 不读 offset/repeat，必须切成独立纹理才能正确显示单格）
// ============================================================
cropTileTexture(atlasKey, col, row) {
    const cfg = this.ATLASES[atlasKey];
    if (!cfg) {
        console.warn('[Map3DTextures] 图集不存在:', atlasKey);
        return null;
    }

    // 越界取模
    col = ((col % cfg.cols) + cfg.cols) % cfg.cols;
    row = ((row % cfg.rows) + cfg.rows) % cfg.rows;

    const cacheKey = `crop|${atlasKey}|${col}|${row}`;
    if (this._textureCache.has(cacheKey)) {
        return this._textureCache.get(cacheKey);
    }

    const img = this._images[atlasKey];
    if (!img) {
        console.warn('[Map3DTextures] 图集未加载:', atlasKey);
        return null;
    }

    const THREE = window.THREE;
    if (!THREE) return null;

    // 计算单格尺寸
    const tileW = Math.floor(img.width / cfg.cols);
    const tileH = Math.floor(img.height / cfg.rows);

    // 用 canvas 切出单格
    const canvas = document.createElement('canvas');
    canvas.width = tileW;
    canvas.height = tileH;
    const ctx = canvas.getContext('2d');

    // 关掉平滑（像素风更清晰）
    // ctx.imageSmoothingEnabled = false;

    ctx.drawImage(
        img,
        col * tileW, row * tileH, tileW, tileH,   // 源区域
        0, 0, tileW, tileH                         // 目标区域
    );

    // 生成独立纹理
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;

    if (THREE.SRGBColorSpace) {
        tex.colorSpace = THREE.SRGBColorSpace;
    }

    tex.needsUpdate = true;

    // 记录元数据（spriteScaleFromTexture 会读）
    tex.userData = {
        tileW,
        tileH,
        atlasW: img.width,
        atlasH: img.height,
        col, row,
        atlasKey,
        isCropped: true,
    };

    this._textureCache.set(cacheKey, tex);
    return tex;
},
        _pickBuildingAtlas(w, h) {
            if (w <= 2 && h <= 2) return 'building_2x2';
            if (w <= 3 && h <= 3) return 'building_3x3';
            if (w <= 4 && h <= 4) return 'building_4x4';
            // 更大的建筑 → 用 4x4 拉伸
            return 'building_4x4';
        },

        // ============================================================
        // 语义 API：给"角色" → 纹理
        // 用 map-sprites.js 的 resolveSprite 逻辑
        // ============================================================
        getCharacterTexture(ent) {
            if (!ent) return null;
        
            // ★★★ 玩家：按当前朝向取
            if (ent.isPlayer) {
                const srcRect = window.MapSprites?.getPlayerSourceRect?.();
                const cfg = window.MapSprites?.playerConfig;
                if (srcRect && cfg) {
                    const pad = cfg.pad || 0;
                    const col = Math.floor(srcRect.sx / (cfg.tileW + pad));
                    const row = Math.floor(srcRect.sy / (cfg.tileH + pad));
                    return this.getTileTexture('player', col, row);
                }
                // 兜底：默认朝下 = (0, 0)
                return this.getTileTexture('player', 0, 0);
            }
        
            // NPC / 遭遇
            const resolved = window.MapSprites?.resolveSprite?.(ent);
            if (!resolved) return null;
        
            const atlasKey = resolved.imageKey === 'male' ? 'sprite_male'
                : resolved.imageKey === 'female' ? 'sprite_female'
                    : 'sprite_common';
        
            const idx = resolved.index;
            const cfg = this.ATLASES[atlasKey];
            if (!cfg) return null;
        
            const col = idx % cfg.cols;
            const row = Math.floor(idx / cfg.cols);
        
            return this.getTileTexture(atlasKey, col, row);
        },

        // ============================================================
        // 通用：索引 → 纹理
        // ============================================================
        _getIndexedTexture(atlasKey, idx) {
            const cfg = this.ATLASES[atlasKey];
            if (!cfg) return null;
            const col = idx % cfg.cols;
            const row = Math.floor(idx / cfg.cols);
            return this.getTileTexture(atlasKey, col, row);
        },

        // ============================================================
        // 清缓存（切地图/重载时调）
        // ============================================================
        clearCache() {
            this._textureCache.clear();
            console.log('[Map3DTextures] 纹理缓存已清空');
        },
    };

    window.Map3DTextures = Map3DTextures;
    console.log('[CinemaWorld] map-3d-textures.js 已加载');
})();