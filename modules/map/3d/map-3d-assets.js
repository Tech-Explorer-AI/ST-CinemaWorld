// ============================================================
// CinemaWorld · map-3d-assets.js
// 纹理缓存：emoji → canvas → Texture
// 暴露：window.Map3DAssets
// ============================================================

(function () {
    'use strict';

    const Map3DAssets = {
        _emojiCache: new Map(),
        _spriteCache: new Map(),

        // ---------- emoji → Canvas ----------
        emojiToCanvas(emoji, size = 128) {
            const key = `${emoji}|${size}`;
            if (this._emojiCache.has(key)) return this._emojiCache.get(key);

            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, size, size);
            ctx.font = `${Math.floor(size * 0.8)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(emoji || '❓', size / 2, size / 2 + size * 0.05);

            this._emojiCache.set(key, canvas);
            return canvas;
        },

        // ---------- emoji → THREE.Texture ----------
        emojiToTexture(emoji, THREE, size = 128) {
            const key = `tex|${emoji}|${size}`;
            if (this._spriteCache.has(key)) return this._spriteCache.get(key);

            const canvas = this.emojiToCanvas(emoji, size);
            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.anisotropy = 1;

            this._spriteCache.set(key, tex);
            return tex;
        },

        // ---------- 生成影子贴图 ----------
        shadowTexture(THREE, size = 64) {
            const key = `shadow|${size}`;
            if (this._spriteCache.has(key)) return this._spriteCache.get(key);

            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');

            const g = ctx.createRadialGradient(
                size / 2, size / 2, 0,
                size / 2, size / 2, size / 2
            );
            g.addColorStop(0, 'rgba(0,0,0,0.7)');
            g.addColorStop(0.5, 'rgba(0,0,0,0.35)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, size, size);

            const tex = new THREE.CanvasTexture(canvas);
            this._spriteCache.set(key, tex);
            return tex;
        },

        // ---------- 地形 → 颜色 ----------
        terrainColor(terrain) {
            const colors = {
                grass: 0x5a8a3a, tall_grass: 0x4a7a2a, dry_grass: 0xa8a05a,
                dirt: 0x8a6a3a, dirt_path: 0x9a7a4a,
                sand: 0xd8c68a, snow: 0xe8e8f0, gravel: 0x9a9a9a,
                stone: 0x8a8a8a, cobblestone: 0x9a9a9a,
                asphalt: 0x444444, concrete: 0xa0a0a0,
                brick: 0x9a5a4a, tile: 0x8ab0c0, wooden_deck: 0x8a6a3a,
                water: 0x3a6aaa, deep_water: 0x2a4a8a,
                sea: 0x2a5a9a, lake: 0x3a6aaa, river: 0x3a6aaa,
                lava: 0xff4400, swamp: 0x4a6a3a, ice: 0xc8e0f0,
                moss: 0x5a7a3a, flower_field: 0xa8c878,
                void: null,
            };
            return colors[terrain] ?? 0x5a5a5a;
        },

        // ---------- 装饰 → emoji ----------
        decorEmoji(decor) {
            if (!decor) return null;
            const base = {
                tree: ['🌳', '🌲', '🎄', '🌴'],
                plant: ['🌿', '🌱', '☘️', '🌾'],
                rock: ['🪨', '⛰️', '🗿'],
                small_building: ['🏠', '🏚️', '⛺'],
                lamp: ['💡'],
                bench: ['🪑'],
                trash: ['🗑️'],
                sign: ['🪧'],
                mailbox: ['📮'],
                hydrant: ['🚒'],
                bus_stop: ['🚌'],
            };
            const list = base[decor.type];
            if (!list) return null;
            const v = decor.variant ?? 0;
            return list[v % list.length];
        },

        clear() {
            this._emojiCache.clear();
            this._spriteCache.clear();
        },
        // ============================================================
        // 新增：为实体生成 Sprite 材质（优先真实纹理）
        // ============================================================
        entitySpriteMaterial(ent, THREE) {
            // ★★★ 优先立绘（NPC / 遭遇）
            if (ent.kind === 'npc' || ent.kind === 'encounter') {
                const portraitUrl = window.MapSprites?.getPortraitSync?.(ent);
                if (portraitUrl) {
                    const tex = window.Map3DTextures?.getFullTexture?.(portraitUrl);
                    if (tex) {
                        return new THREE.SpriteMaterial({
                            map: tex,
                            transparent: true,
                            depthWrite: false,
                            alphaTest: 0.05,
                        });
                    }
                } else {
                    // 触发异步加载，下次渲染就有立绘了
                    window.MapSprites?.requestPortraitLoad?.(ent);
                }
            }

            // 次选：精灵图集（玩家 / NPC / 遭遇）
            let tex = null;
            if (ent.isPlayer || ent.kind === 'npc' || ent.kind === 'encounter') {
                tex = window.Map3DTextures?.getCharacterTexture(ent);
            }

            if (tex) {
                return new THREE.SpriteMaterial({
                    map: tex,
                    transparent: true,
                    depthWrite: false,
                    alphaTest: 0.05,
                });
            }

            // 兜底：emoji
            const emoji = ent.emoji || '❓';
            const emojiTex = this.emojiToTexture(emoji, THREE);
            return new THREE.SpriteMaterial({
                map: emojiTex,
                transparent: true,
                depthWrite: false,
                alphaTest: 0.1,
            });
        },

        // ★ 新增工具：按纹理实际宽高比，算 sprite 世界尺寸
        //   baseScale：以"高度"为基准（世界单位）
        // map-3d-assets.js
        spriteScaleFromTexture(mat, baseScale) {
            const tex = mat?.map;
            if (!tex) return { sw: baseScale, sh: baseScale };

            let tileW, tileH;

            // ★ 情况 1：切片纹理（有 userData）
            if (tex.userData?.tileW && tex.userData?.tileH) {
                tileW = tex.userData.tileW;
                tileH = tex.userData.tileH;
            }
            // ★ 情况 2：完整纹理（立绘）
            else if (tex.image?.naturalWidth && tex.image?.naturalHeight) {
                tileW = tex.image.naturalWidth;
                tileH = tex.image.naturalHeight;
            }
            // 兜底
            else {
                return { sw: baseScale, sh: baseScale };
            }

            const aspect = tileW / tileH;

            let sw, sh;
            // ★ 关键：图集切片通常是"正方形"（256×256），立绘是"竖长条"
            //   如果 aspect ≈ 1 → 用基准尺寸
            //   如果 aspect < 0.8 → 竖长图（立绘）→ 按比例放大
            //   如果 aspect > 1.2 → 横长图 → 按比例放大
            if (aspect >= 0.8 && aspect <= 1.2) {
                // 正方形（图集切片）
                sw = baseScale;
                sh = baseScale;
            } else {
                // 竖长或横长（立绘）
                if (aspect < 1) {
                    // 竖长：以高为基准
                    sh = baseScale * 1.7;
                    sw = sh * aspect;
                } else {
                    // 横长：以宽为基准
                    sw = baseScale * 1.7;
                    sh = sw / aspect;
                }
            }

            return { sw, sh };
        },
        // 在 Map3DAssets 对象里加
        _emojiTextureCache: new Map(),

        emojiToTexture(emoji, THREE, size = 128) {
            const key = `${emoji}|${size}`;
            if (this._emojiTextureCache.has(key)) {
                return this._emojiTextureCache.get(key);
            }

            const canvas = this.emojiToCanvas(emoji, size);
            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.anisotropy = 1;

            this._emojiTextureCache.set(key, tex);
            return tex;
        },
        // ============================================================
        // 新增：地形的纹理（用 Map3DTextures）
        // ============================================================
        terrainTexture(terrain, THREE) {
            return window.Map3DTextures?.getTerrainTexture(terrain) || null;
        },

        // ============================================================
        // 新增：装饰的纹理
        // ============================================================
        decorTexture(decor, THREE) {
            return window.Map3DTextures?.getDecorTexture(decor) || null;
        },

        // ============================================================
        // 新增：建筑的纹理
        // ============================================================
        buildingTexture(ent, THREE) {
            return window.Map3DTextures?.getBuildingTexture(ent) || null;
        },
        // ============================================================
        // 地面光圈材质（径向渐变）
        // ============================================================
        makeGroundRingMaterial(THREE, color = 0xffd76b, opacity = 0.35) {
            const size = 128;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = size;
            const ctx = canvas.getContext('2d');

            const r = (color >> 16) & 255;
            const g = (color >> 8) & 255;
            const b = color & 255;

            const grad = ctx.createRadialGradient(
                size / 2, size / 2, size * 0.1,
                size / 2, size / 2, size * 0.5
            );
            grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${opacity})`);
            grad.addColorStop(0.55, `rgba(${r}, ${g}, ${b}, ${opacity * 0.7})`);
            grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            ctx.fill();

            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;

            return new THREE.MeshBasicMaterial({
                map: tex,
                transparent: true,
                depthWrite: false,
            });
        },

        // ============================================================
        // 光环样式（根据实体类型返回颜色/透明度）
        // ============================================================
        getGroundRingStyle(ent) {
            if (!ent) return null;

            // 主线目标
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            if (mq?.active && mq.status === 'active'
                && mq.target.kind === 'entity'
                && mq.target.entityId === ent.id) {
                return { color: 0xff9a3d, opacity: 0.65, radius: 1.4, pulse: true };
            }

            // 任务点
            if (ent.kind === 'quest_point') {
                return { color: 0xffd76b, opacity: 0.6, radius: 1.1, pulse: true };
            }

            // ★★★ 装饰实体 —— 紫色光圈
            if (ent.kind === 'decor') {
                return { color: 0xb090ff, opacity: 0.45, radius: 0.7 };
            }

            // NPC
            if (ent.kind === 'npc') {
                return { color: 0xffd76b, opacity: 0.45, radius: 0.9 };
            }

            // 遭遇
            if (ent.kind === 'encounter') {
                return { color: 0xff5555, opacity: 0.55, radius: 1.0, pulse: true };
            }

            // 可拾取物品
            if (ent.kind === 'item' && String(ent.fields?.['可拾取'] || '') === '是') {
                return { color: 0x5ab0ff, opacity: 0.5, radius: 0.7 };
            }
            // ★★★ AI 生成的门（portal 实体）—— 青绿色
            if (ent.kind === 'portal') {
                return { color: 0x8cffdc, opacity: 0.7, radius: 0.9, pulse: true };
            }
            return null;
        },

        // ============================================================
        // 文字 sprite（带圆角背景）
        // ============================================================
        makeTextSprite(THREE, text, options = {}) {
            if (!text) return null;

            const fontSize = options.fontSize || 32;
            const padding = 16;
            const bgColor = options.bgColor || 'rgba(20, 40, 40, 0.85)';
            const borderColor = options.borderColor || 'rgba(140, 255, 220, 0.9)';
            const textColor = options.textColor || '#a8ffe0';

            // 量文字宽度
            const measure = document.createElement('canvas').getContext('2d');
            measure.font = `bold ${fontSize}px sans-serif`;
            const tw = measure.measureText(text).width;

            const canvas = document.createElement('canvas');
            canvas.width = Math.ceil(tw + padding * 2);
            canvas.height = Math.ceil(fontSize * 1.6);

            const ctx = canvas.getContext('2d');
            const w = canvas.width;
            const h = canvas.height;
            const r = 10;

            // 圆角背景
            ctx.fillStyle = bgColor;
            ctx.beginPath();
            ctx.moveTo(r, 0);
            ctx.lineTo(w - r, 0);
            ctx.arcTo(w, 0, w, r, r);
            ctx.lineTo(w, h - r);
            ctx.arcTo(w, h, w - r, h, r);
            ctx.lineTo(r, h);
            ctx.arcTo(0, h, 0, h - r, r);
            ctx.lineTo(0, r);
            ctx.arcTo(0, 0, r, 0, r);
            ctx.closePath();
            ctx.fill();

            // 边框
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 2;
            ctx.stroke();

            // 文字
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = textColor;
            ctx.fillText(text, w / 2, h / 2);

            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;

            const mat = new THREE.SpriteMaterial({
                map: tex,
                transparent: true,
                depthWrite: false,
            });

            const sprite = new THREE.Sprite(mat);
            // 世界尺寸：字体高约 0.5 单位
            const worldH = 0.5;
            const worldW = worldH * (canvas.width / canvas.height);
            sprite.scale.set(worldW, worldH, 1);
            return sprite;
        },

        // ============================================================
        // 描边材质（黑边）
        // ============================================================
        makeOutlineMaterial(originalMat, THREE) {
            if (!originalMat?.map) return null;
            return new THREE.SpriteMaterial({
                map: originalMat.map,
                transparent: true,
                depthWrite: false,
                alphaTest: 0.05,
                color: 0x000000,
            });
        },
    };

    window.Map3DAssets = Map3DAssets;
    console.log('[CinemaWorld] map-3d-assets.js 已加载');
})();