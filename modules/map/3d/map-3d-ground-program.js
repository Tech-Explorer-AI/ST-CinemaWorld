// ============================================================
// CinemaWorld · map-3d-ground-program.js
// 地形程序纹理（参数化原型 + 矩形合并 + 每格独立厚度）
// 通过覆盖 MapCanvas3D._buildGround 实现
// 暴露：window.Map3DGroundProgram / window.Map3DGround
// ============================================================

(function () {
    'use strict';

    if (window.Map3DGroundProgram) return;

    // ---------- 可调参数 ----------
    const TERRAIN_THICKNESS = 1.0;   // ★ 每格地形厚度（真正生效）
    const ROAD_THICKNESS = 0.15;   // ★ 每格道路厚度
    const HEIGHT_UNIT = 1.0;    // ★ 1 层高度 = 0.5 世界单位
    const ROAD_LIFT = 0.15;   // 道路顶面比地形顶面高多少
    const TERRAIN_SIDE_DARK = 0.55;
    const ROAD_SIDE_DARK = 0.55;
    const TEX_SIZE = 64;
    const TILE_SCALE = 1.0;

    // ============================================================
    // 全局高度 API（供 canvas / 其他模块调用）
    // ============================================================
    const Map3DGround = {
        HEIGHT_UNIT,
        TERRAIN_THICKNESS,
        ROAD_THICKNESS,

        // 取某格高度（整数层数）
        getCellHeight(map, gx, gy) {
            const cell = map?._generated?.grid?.[gy]?.[gx];
            if (!cell) return 0;
            return typeof cell.height === 'number' ? cell.height : 0;
        },

        // 层数 → 世界 y
        heightToWorldY(h) {
            return (h || 0) * HEIGHT_UNIT;
        },

        // 便捷：直接取世界 y
        getCellWorldY(map, gx, gy) {
            return this.heightToWorldY(this.getCellHeight(map, gx, gy));
        },
    };
    window.Map3DGround = Map3DGround;

    // ============================================================
    // 工具
    // ============================================================
    function rgbStr(r, g, b) { return `rgb(${r | 0},${g | 0},${b | 0})`; }
    function scaleRGB(hex, factor) {
        return [
            Math.max(0, Math.min(255, ((hex >> 16) & 0xff) * factor)),
            Math.max(0, Math.min(255, ((hex >> 8) & 0xff) * factor)),
            Math.max(0, Math.min(255, (hex & 0xff) * factor)),
        ];
    }
    function scaleHex(hex, factor) {
        const [r, g, b] = scaleRGB(hex, factor);
        return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
    }
    function makeRng(seed) {
        let s = seed >>> 0;
        return () => {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };
    }

    // ============================================================
    // 原型
    // ============================================================
    function protoGrass(ctx, S, hex, p = {}) {
        const bladeDensity = p.bladeDensity ?? 80;
        const bladeLen = p.bladeLen ?? 3;
        const rnd = makeRng(p.seed ?? 1234);
        ctx.fillStyle = rgbStr(...scaleRGB(hex, p.baseShade ?? 1.0));
        ctx.fillRect(0, 0, S, S);
        for (let i = 0; i < bladeDensity; i++) {
            const x = rnd() * S, y = rnd() * S;
            const shade = 0.75 + rnd() * 0.5;
            ctx.strokeStyle = rgbStr(...scaleRGB(hex, shade));
            ctx.lineWidth = 1;
            const len = bladeLen * (0.7 + rnd() * 0.6);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + rnd() * 2 - 1, y - len);
            ctx.stroke();
        }
        for (let i = 0; i < 30; i++) {
            ctx.fillStyle = rgbStr(...scaleRGB(hex, rnd() > 0.5 ? 1.2 : 0.75));
            ctx.fillRect(rnd() * S, rnd() * S, 1, 1);
        }
    }

    function protoDirt(ctx, S, hex, p = {}) {
        const rnd = makeRng(p.seed ?? 2345);
        ctx.fillStyle = rgbStr(...scaleRGB(hex, 1.0));
        ctx.fillRect(0, 0, S, S);
        const density = p.density ?? 200;
        for (let i = 0; i < density; i++) {
            const x = rnd() * S, y = rnd() * S;
            const shade = 0.7 + rnd() * 0.6;
            const size = 1 + rnd() * (p.grainSize ?? 1.5);
            ctx.fillStyle = rgbStr(...scaleRGB(hex, shade));
            ctx.fillRect(x, y, size, size);
        }
        const cracks = p.cracks ?? 3;
        ctx.strokeStyle = rgbStr(...scaleRGB(hex, 0.55));
        ctx.lineWidth = 1;
        for (let k = 0; k < cracks; k++) {
            const x0 = rnd() * S, y0 = rnd() * S;
            ctx.beginPath();
            ctx.moveTo(x0, y0);
            ctx.lineTo(x0 + rnd() * 12 - 6, y0 + rnd() * 12 - 6);
            ctx.stroke();
        }
    }

    function protoSand(ctx, S, hex, p = {}) {
        const rnd = makeRng(p.seed ?? 3456);
        ctx.fillStyle = rgbStr(...scaleRGB(hex, 1.0));
        ctx.fillRect(0, 0, S, S);
        for (let i = 0; i < 300; i++) {
            ctx.fillStyle = rgbStr(...scaleRGB(hex, 0.9 + rnd() * 0.2));
            ctx.fillRect(rnd() * S, rnd() * S, 1, 1);
        }
        if (p.waves !== false) {
            ctx.strokeStyle = rgbStr(...scaleRGB(hex, 0.85));
            ctx.lineWidth = 1;
            for (let k = 0; k < 3; k++) {
                const y0 = rnd() * S;
                ctx.beginPath();
                for (let x = 0; x <= S; x += 4) {
                    const y = y0 + Math.sin((x / S) * Math.PI * 4) * 1.5;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
        }
    }

    function protoSnow(ctx, S, hex, p = {}) {
        const rnd = makeRng(p.seed ?? 4567);
        ctx.fillStyle = rgbStr(...scaleRGB(hex, 1.0));
        ctx.fillRect(0, 0, S, S);
        for (let i = 0; i < 50; i++) {
            ctx.fillStyle = rgbStr(...scaleRGB(hex, 0.93));
            ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
        }
        for (let i = 0; i < (p.highlights ?? 15); i++) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(rnd() * S, rnd() * S, 1, 1);
        }
        if (p.cracks) {
            ctx.strokeStyle = rgbStr(...scaleRGB(hex, 0.75));
            ctx.lineWidth = 1;
            for (let k = 0; k < 4; k++) {
                const x0 = rnd() * S, y0 = rnd() * S;
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x0 + rnd() * 20 - 10, y0 + rnd() * 20 - 10);
                ctx.stroke();
            }
        }
    }

    function protoStone(ctx, S, hex, p = {}) {
        // ★ 整个 canvas 就是"一块石板"
        const rnd = makeRng(p.seed ?? 5678);

        // 底色
        const [r, g, b] = scaleRGB(hex, 1.0);
        ctx.fillStyle = rgbStr(r, g, b);
        ctx.fillRect(0, 0, S, S);

        // 表面噪点（细腻，不是格子）
        for (let i = 0; i < 120; i++) {
            const x = rnd() * S;
            const y = rnd() * S;
            const shade = 0.9 + rnd() * 0.2;
            ctx.fillStyle = rgbStr(...scaleRGB(hex, shade));
            ctx.fillRect(x, y, 1, 1);
        }

        // 大理石纹路（斜线）
        if (p.marble) {
            ctx.strokeStyle = rgbStr(...scaleRGB(hex, 1.15));
            ctx.lineWidth = 1;
            for (let k = 0; k < 3; k++) {
                ctx.beginPath();
                let x = rnd() * S;
                let y = 0;
                ctx.moveTo(x, y);
                while (y < S) {
                    x += (rnd() - 0.5) * 8;
                    y += 4;
                    ctx.lineTo(x, y);
                }
                ctx.stroke();
            }
        }

        // ★ 边缘描边（左/上亮，右/下暗 —— 立体感）
        ctx.strokeStyle = rgbStr(...scaleRGB(hex, 1.25));
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0.5, S);
        ctx.lineTo(0.5, 0.5);
        ctx.lineTo(S, 0.5);
        ctx.stroke();

        ctx.strokeStyle = rgbStr(...scaleRGB(hex, 0.7));
        ctx.beginPath();
        ctx.moveTo(S - 0.5, 0);
        ctx.lineTo(S - 0.5, S - 0.5);
        ctx.lineTo(0, S - 0.5);
        ctx.stroke();
    }

    function protoPaved(ctx, S, hex, p = {}) {
        const rnd = makeRng(p.seed ?? 6789);

        // 底色
        ctx.fillStyle = rgbStr(...scaleRGB(hex, 1.0));
        ctx.fillRect(0, 0, S, S);

        // 表面轻微噪点
        for (let i = 0; i < 60; i++) {
            const shade = 0.94 + rnd() * 0.12;
            ctx.fillStyle = rgbStr(...scaleRGB(hex, shade));
            ctx.fillRect(rnd() * S, rnd() * S, 1, 1);
        }

        // 斜向高光（模拟光照）
        const grad = ctx.createLinearGradient(0, 0, S, S);
        grad.addColorStop(0, `rgba(255,255,255,0.05)`);
        grad.addColorStop(0.5, `rgba(255,255,255,0)`);
        grad.addColorStop(1, `rgba(0,0,0,0.05)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, S, S);

        // ★ 边缘接缝：左/上亮，右/下暗
        ctx.strokeStyle = rgbStr(...scaleRGB(hex, 0.6));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(S, 0);
        ctx.moveTo(0, 0);
        ctx.lineTo(0, S);
        ctx.stroke();

        ctx.strokeStyle = rgbStr(...scaleRGB(hex, 1.3));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(S, 0);
        ctx.lineTo(S, S);
        ctx.moveTo(0, S);
        ctx.lineTo(S, S);
        ctx.stroke();

        // ★ 图案（如果有）
        if (p.pattern === 'checker') {
            // 棋盘：4×4 小格
            const n = 4, step = S / n;
            for (let row = 0; row < n; row++) {
                for (let col = 0; col < n; col++) {
                    if ((row + col) % 2 === 0) {
                        ctx.fillStyle = rgbStr(...scaleRGB(hex, 0.7));
                        ctx.fillRect(col * step, row * step, step, step);
                    }
                }
            }
        }
    }

    function protoWood(ctx, S, hex, p = {}) {
        const rnd = makeRng(p.seed ?? 7890);

        ctx.fillStyle = rgbStr(...scaleRGB(hex, 1.0));
        ctx.fillRect(0, 0, S, S);

        // ★ 一整块：从中间劈开成 2-3 条木纹（不是 6 条）
        const planks = 3;
        const plankH = S / planks;

        for (let row = 0; row < planks; row++) {
            // 每条木板轻微色差
            const shade = 0.92 + rnd() * 0.12;
            ctx.fillStyle = rgbStr(...scaleRGB(hex, shade));
            ctx.fillRect(0, row * plankH + 1, S, plankH - 2);

            // 木纹曲线
            ctx.strokeStyle = rgbStr(...scaleRGB(hex, 0.7));
            ctx.lineWidth = 1;
            for (let k = 0; k < 4; k++) {
                const y0 = row * plankH + 4 + k * (plankH / 5);
                ctx.beginPath();
                for (let x = 0; x <= S; x += 4) {
                    const y = y0 + Math.sin((x / S) * Math.PI * 2 + row) * 1.5;
                    if (x === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                ctx.stroke();
            }

            // 木板缝（黑线）
            ctx.strokeStyle = rgbStr(...scaleRGB(hex, 0.4));
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, row * plankH);
            ctx.lineTo(S, row * plankH);
            ctx.stroke();
        }
    }

    function protoWater(ctx, S, hex, p = {}) {
        const rnd = makeRng(p.seed ?? 8901);
        ctx.fillStyle = rgbStr(...scaleRGB(hex, 1.0));
        ctx.fillRect(0, 0, S, S);
        const waves = p.waves ?? 4;
        for (let k = 0; k < waves; k++) {
            const y0 = rnd() * S;
            ctx.strokeStyle = rgbStr(...scaleRGB(hex, 1.3));
            ctx.lineWidth = 1;
            ctx.beginPath();
            for (let x = 0; x <= S; x += 4) {
                const y = y0 + Math.sin((x / S) * Math.PI * 2 + k) * 1.5;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        for (let i = 0; i < 25; i++) {
            ctx.fillStyle = rgbStr(...scaleRGB(hex, 1.6));
            ctx.fillRect(rnd() * S, rnd() * S, 1, 1);
        }
    }

    function protoWall(ctx, S, hex, p = {}) {
        protoPaved(ctx, S, hex, { ...p, pattern: 'brick' });
    }

    function protoLava(ctx, S, hex, p = {}) {
        const rnd = makeRng(p.seed ?? 9012);
        ctx.fillStyle = rgbStr(...scaleRGB(hex, 0.4));
        ctx.fillRect(0, 0, S, S);
        for (let i = 0; i < 15; i++) {
            const x = rnd() * S, y = rnd() * S, r = 3 + rnd() * 6;
            const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
            const [r1, g1, b1] = scaleRGB(hex, 1.5);
            const [r2, g2, b2] = scaleRGB(hex, 0.5);
            grd.addColorStop(0, `rgba(${r1 | 0},${g1 | 0},${b1 | 0},1)`);
            grd.addColorStop(1, `rgba(${r2 | 0},${g2 | 0},${b2 | 0},0)`);
            ctx.fillStyle = grd;
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
    }

    function protoSwamp(ctx, S, hex, p = {}) {
        const rnd = makeRng(p.seed ?? 123);
        ctx.fillStyle = rgbStr(...scaleRGB(hex, 1.0));
        ctx.fillRect(0, 0, S, S);
        for (let i = 0; i < 40; i++) {
            ctx.fillStyle = rgbStr(...scaleRGB(hex, 0.6));
            ctx.beginPath();
            ctx.arc(rnd() * S, rnd() * S, 1 + rnd() * 3, 0, Math.PI * 2);
            ctx.fill();
        }
        for (let i = 0; i < 20; i++) {
            ctx.fillStyle = rgbStr(...scaleRGB(hex, 1.2));
            ctx.fillRect(rnd() * S, rnd() * S, 1, 1);
        }
    }

    function protoFlower(ctx, S, hex, p = {}) {
        protoGrass(ctx, S, hex, { ...p, bladeDensity: 60 });
        const rnd = makeRng(p.seed ?? 456);
        const colors = ['#ff6688', '#ffdd44', '#aabbff', '#ffffff'];
        for (let i = 0; i < 25; i++) {
            ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
            ctx.fillRect(rnd() * S, rnd() * S, 2, 2);
        }
    }

    // ============================================================
    // 配方
    // ============================================================
    const RECIPES = {
        grass: { proto: 'grass', hex: 0x5a8a3a, bladeDensity: 80 },
        tall_grass: { proto: 'grass', hex: 0x4a7a2a, bladeDensity: 150, bladeLen: 6 },
        dry_grass: { proto: 'grass', hex: 0xa8a05a, bladeDensity: 60, bladeLen: 3 },
        dirt: { proto: 'dirt', hex: 0x8a6a3a },
        sand: { proto: 'sand', hex: 0xd8c68a },
        snow: { proto: 'snow', hex: 0xe8e8f0 },
        gravel: { proto: 'stone', hex: 0x9a9a9a, cols: 6, rows: 6 },
        dirt_path: { proto: 'dirt', hex: 0x9a7a4a, cracks: 1 },
        stone: { proto: 'stone', hex: 0x8a8a8a, cols: 3, rows: 3 },
        cobblestone: { proto: 'stone', hex: 0x9a9a9a, cols: 5, rows: 5, variance: 0.4 },
        asphalt: { proto: 'paved', hex: 0x444444, pattern: 'grid', cells: 4 },
        concrete: { proto: 'paved', hex: 0xa0a0a0, pattern: 'grid', cells: 4 },
        brick: { proto: 'paved', hex: 0x9a5a4a, pattern: 'brick' },
        tile: { proto: 'paved', hex: 0x8ab0c0, pattern: 'grid', cells: 4 },
        wooden_deck: { proto: 'wood', hex: 0x8a6a3a, planks: 4 },
        pebble_path: { proto: 'stone', hex: 0xa8a8a8, cols: 8, rows: 8, variance: 0.2 },
        wood: { proto: 'wood', hex: 0xc09060, planks: 6 },
        marble: { proto: 'paved', hex: 0xf0f0f0, pattern: 'grid', cells: 2 },
        carpet: { proto: 'paved', hex: 0x8a2a2a, pattern: 'grid', cells: 8 },
        gray_carpet: { proto: 'paved', hex: 0x707070, pattern: 'grid', cells: 8 },
        ceramic: { proto: 'paved', hex: 0xd0e0f0, pattern: 'grid', cells: 4 },
        concrete_floor: { proto: 'paved', hex: 0x909090, pattern: 'grid', cells: 4 },
        parquet: { proto: 'wood', hex: 0xa07050, planks: 8 },
        patterned_tile: { proto: 'paved', hex: 0xc0a080, pattern: 'checker', cells: 4 },
        wall: { proto: 'wall', hex: 0x8a5a4a },
        stone_wall: { proto: 'wall', hex: 0x8a8a8a },
        concrete_wall: { proto: 'wall', hex: 0xa0a0a0 },
        wood_wall: { proto: 'wall', hex: 0x8a6a3a },
        white_wall: { proto: 'wall', hex: 0xe8e8e8 },
        glass_wall: { proto: 'paved', hex: 0xa0d0f0, pattern: 'grid', cells: 3 },
        metal_wall: { proto: 'paved', hex: 0x9098a0, pattern: 'grid', cells: 4 },
        tile_wall: { proto: 'wall', hex: 0xa0c0d0 },
        water: { proto: 'water', hex: 0x3a6aaa },
        deep_water: { proto: 'water', hex: 0x2a4a8a, waves: 2 },
        sea: { proto: 'water', hex: 0x2a5a9a },
        lake: { proto: 'water', hex: 0x3a6aaa },
        river: { proto: 'water', hex: 0x3a6aaa, waves: 6 },
        ripple: { proto: 'water', hex: 0x5a8aca, waves: 6 },
        underwater: { proto: 'water', hex: 0x1a3a6a, waves: 1 },
        waterfall: { proto: 'water', hex: 0x6ab0d0, waves: 8 },
        grass_edge: { proto: 'grass', hex: 0x5a8a3a, bladeDensity: 40 },
        shore: { proto: 'sand', hex: 0xd8c68a, waves: true },
        beach_edge: { proto: 'sand', hex: 0xe0d0a0 },
        snow_edge: { proto: 'snow', hex: 0xe0e0e8, highlights: 5 },
        rocky_ground: { proto: 'stone', hex: 0x8a8a8a, cols: 2, rows: 2, variance: 0.5 },
        cliff_top: { proto: 'stone', hex: 0x7a7a7a, cols: 2, rows: 2 },
        mud_edge: { proto: 'dirt', hex: 0x6a5a3a, density: 150 },
        fallen_leaves: { proto: 'grass', hex: 0xa88040, bladeDensity: 20, bladeLen: 2 },
        lava: { proto: 'lava', hex: 0xff4400 },
        swamp: { proto: 'swamp', hex: 0x4a6a3a },
        ice: { proto: 'snow', hex: 0xc8e0f0, cracks: true },
        snow_field: { proto: 'snow', hex: 0xe0e8f0 },
        moss: { proto: 'grass', hex: 0x5a7a3a, bladeDensity: 60, bladeLen: 2 },
        vine_ground: { proto: 'grass', hex: 0x3a6a2a, bladeDensity: 100, bladeLen: 5 },
        flower_field: { proto: 'flower', hex: 0x7aaa4a },
        dead_grass: { proto: 'grass', hex: 0x8a7a5a, bladeDensity: 40, bladeLen: 3 },
        void: { proto: 'paved', hex: 0x000000, pattern: 'grid', cells: 1 },
        white_floor: { proto: 'paved', hex: 0xffffff, pattern: 'grid', cells: 4 },
        gray_floor: { proto: 'paved', hex: 0x888888, pattern: 'grid', cells: 4 },
        checkerboard: { proto: 'paved', hex: 0xffffff, pattern: 'checker', cells: 4 },
        warning: { proto: 'paved', hex: 0xffcc00, pattern: 'checker', cells: 8 },
        metal_floor: { proto: 'paved', hex: 0x9098a0, pattern: 'grid', cells: 8 },
        glowing_floor: { proto: 'paved', hex: 0xaaffff, pattern: 'grid', cells: 4 },
        transparent: { proto: 'paved', hex: 0xc0c0c0, pattern: 'grid', cells: 2 },
        rock: { proto: 'stone', hex: 0x8a8a8a, cols: 2, rows: 2 },
        tree: { proto: 'grass', hex: 0x4a6a2a, bladeDensity: 100 },
        road: { proto: 'paved', hex: 0x8a8a8a, pattern: 'grid', cells: 4 },
        path: { proto: 'dirt', hex: 0x9a7a4a },
        floor: { proto: 'wood', hex: 0xa08060, planks: 6 },
    };

    const PROTOS = {
        grass: protoGrass,
        dirt: protoDirt,
        sand: protoSand,
        snow: protoSnow,
        stone: protoStone,
        paved: protoPaved,
        wood: protoWood,
        water: protoWater,
        wall: protoWall,
        lava: protoLava,
        swamp: protoSwamp,
        flower: protoFlower,
    };

    // ============================================================
    // 纹理缓存
    // ============================================================
    const _texCache = new Map();
    // ============================================================
    // getTerrainTex 加 tint 参数
    // ============================================================
    function getTerrainTex(T, terrain, tintRGB) {
        const tkey = tintRGB
            ? `${tintRGB.r.toFixed(2)},${tintRGB.g.toFixed(2)},${tintRGB.b.toFixed(2)}`
            : 'def';
        const key = `terrain|${terrain}|${tkey}`;
        if (_texCache.has(key)) return _texCache.get(key);

        const recipe = RECIPES[terrain];
        if (!recipe) return null;
        const proto = PROTOS[recipe.proto];
        if (!proto) return null;

        // ★ 应用 tint
        let hex = recipe.hex;
        if (tintRGB) {
            const r = Math.min(255, ((hex >> 16) & 0xff) * tintRGB.r) | 0;
            const g = Math.min(255, ((hex >> 8) & 0xff) * tintRGB.g) | 0;
            const b = Math.min(255, (hex & 0xff) * tintRGB.b) | 0;
            hex = (r << 16) | (g << 8) | b;
        }

        const c = document.createElement('canvas');
        c.width = c.height = TEX_SIZE;
        const ctx = c.getContext('2d');
        proto(ctx, TEX_SIZE, hex, recipe);

        const tex = new T.CanvasTexture(c);
        tex.wrapS = T.RepeatWrapping;
        tex.wrapT = T.RepeatWrapping;
        tex.magFilter = T.NearestFilter;
        tex.minFilter = T.NearestFilter;
        tex.generateMipmaps = false;
        if (T.SRGBColorSpace) tex.colorSpace = T.SRGBColorSpace;
        tex.needsUpdate = true;

        _texCache.set(key, tex);
        return tex;
    }

    const _sideMatCache = new Map();
    function getSideMat(T, color) {
        if (_sideMatCache.has(color)) return _sideMatCache.get(color);
        const m = new T.MeshBasicMaterial({ color });
        _sideMatCache.set(color, m);
        return m;
    }

    // ============================================================
    // 矩形合并
    // ============================================================
    function mergeRects(grid, W, H, matchFn) {
        const visited = new Uint8Array(W * H);
        const rects = [];
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const idx = y * W + x;
                if (visited[idx]) continue;
                const key = matchFn(x, y);
                if (key === null) continue;

                let w = 1;
                while (x + w < W) {
                    const i2 = y * W + (x + w);
                    if (visited[i2]) break;
                    if (matchFn(x + w, y) !== key) break;
                    w++;
                }

                let h = 1;
                outer:
                while (y + h < H) {
                    for (let dx = 0; dx < w; dx++) {
                        const i2 = (y + h) * W + (x + dx);
                        if (visited[i2]) break outer;
                        if (matchFn(x + dx, y + h) !== key) break outer;
                    }
                    h++;
                }

                for (let dy = 0; dy < h; dy++) {
                    for (let dx = 0; dx < w; dx++) {
                        visited[(y + dy) * W + (x + dx)] = 1;
                    }
                }
                rects.push({ x, y, w, h, key });
            }
        }
        return rects;
    }

    // ============================================================
    // 新 _buildGround：每格独立厚度
    // ============================================================
    function buildGround(map) {
        const T = this.THREE;
        const grid = map._generated.grid;
        const W = this._mapW;
        const H = this._mapH;
        const ts = this._tileSize;
        const offX = W / 2;
        const offY = H / 2;
        // ★ 扫描全局最低高度
        let minHeight = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const cell = grid[y][x];
                if (!cell || cell.terrain === 'void') continue;
                const h = typeof cell.height === 'number' ? cell.height : 0;
                if (h < minHeight) minHeight = h;
            }
        }
        const globalBottomY = (minHeight - 1) * HEIGHT_UNIT;
        console.log(`[GroundProgram] 全局最低高度=${minHeight}, 底线 y=${globalBottomY}`);
        // ---------- 1. 矩形合并 ----------
        // ★ key 里带高度，不同高度不合并
        const terrainRects = mergeRects(grid, W, H, (x, y) => {
            const cell = grid[y][x];
            if (!cell) return null;
            const t = cell.terrain;
            if (!t || t === 'void') return null;
            const h = typeof cell.height === 'number' ? cell.height : 0;
            return `${t}|${h}`;
        });

        const roadRects = mergeRects(grid, W, H, (x, y) => {
            const cell = grid[y][x];
            if (!cell) return null;
            if (!cell.road) return null;
            const h = typeof cell.height === 'number' ? cell.height : 0;
            return `${cell.road}|${h}`;
        });

        console.log(
            `[GroundProgram] 地形合并: ${terrainRects.length} 个矩形 ` +
            `(原 ${W * H} 格), 道路: ${roadRects.length} 个`
        );

        // ---------- 2. 地形 ----------
        const terrainGeo = new T.BoxGeometry(1, 1, 1);

        // 墙高：地形顶面 + WALL_EXTRA（单位：格宽）
        const WALL_EXTRA = 1;

        for (const rect of terrainRects) {
            const [terrainKey, heightStr] = String(rect.key).split('|');
            const height = parseInt(heightStr) || 0;

            const tex = getTerrainTex(T, terrainKey);
            if (!tex) continue;

            const worldW = rect.w * ts;
            const worldD = rect.h * ts;
            const repeatX = rect.w;
            const repeatY = rect.h;

            const topTex = tex.clone();
            topTex.needsUpdate = true;
            topTex.repeat.set(repeatX, repeatY);

            const topMat = new T.MeshBasicMaterial({ map: topTex });

            const recipe = RECIPES[terrainKey];
            const sideHex = recipe ? scaleHex(recipe.hex, TERRAIN_SIDE_DARK) : 0x4a4a4a;
            const sideMat = getSideMat(T, sideHex);

            const cx = (rect.x + rect.w / 2 - offX) * ts;
            const cz = (rect.y + rect.h / 2 - offY) * ts;

            // ★★★ 关键改动：判断是否墙
            const isWall = terrainKey === 'wall'
                || terrainKey === 'stone_wall'
                || terrainKey === 'brick_wall'
                || terrainKey === 'wood_wall'
                || terrainKey === 'concrete_wall'
                || terrainKey.endsWith('_wall');

            let topY, bottomY, boxH, cy;
            if (isWall) {
                // 墙：地形顶面 + WALL_EXTRA 格
                topY = height * HEIGHT_UNIT + WALL_EXTRA * ts;
            } else {
                // 普通地形：地形顶面
                topY = height * HEIGHT_UNIT;
            }
            bottomY = minHeight * HEIGHT_UNIT - TERRAIN_THICKNESS;
            boxH = topY - bottomY;
            cy = (topY + bottomY) / 2;

            const mesh = new T.Mesh(terrainGeo, [
                sideMat, sideMat, topMat, sideMat, sideMat, sideMat,
            ]);
            mesh.position.set(cx, cy, cz);
            mesh.scale.set(worldW, boxH, worldD);
            this._groundGroup.add(mesh);
        }

        // ---------- 3. 道路 ----------
        const roadGeo = new T.BoxGeometry(1, 1, 1);

        for (const rect of roadRects) {
            const [roadKey, heightStr] = String(rect.key).split('|');
            const height = parseInt(heightStr) || 0;

            const tex = getTerrainTex(T, roadKey);
            if (!tex) continue;

            const worldW = rect.w * ts;
            const worldD = rect.h * ts;
            const repeatX = worldW / TILE_SCALE;
            const repeatY = worldD / TILE_SCALE;

            const topTex = tex.clone();
            topTex.needsUpdate = true;
            topTex.repeat.set(repeatX, repeatY);

            const topMat = new T.MeshBasicMaterial({ map: topTex });

            const recipe = RECIPES[roadKey];
            const sideHex = recipe ? scaleHex(recipe.hex, ROAD_SIDE_DARK) : 0x333333;
            const sideMat = getSideMat(T, sideHex);

            const cx = (rect.x + rect.w / 2 - offX) * ts;
            const cz = (rect.y + rect.h / 2 - offY) * ts;

            // ★ 道路顶面比地形高 ROAD_LIFT，独立厚度
            const topY = height * HEIGHT_UNIT + ROAD_LIFT;
            const bottomY = topY - ROAD_THICKNESS;
            const boxH = ROAD_THICKNESS;
            const cy = (topY + bottomY) / 2;

            const mesh = new T.Mesh(roadGeo, [
                sideMat, sideMat, topMat, sideMat, sideMat, sideMat,
            ]);
            mesh.position.set(cx, cy, cz);
            mesh.scale.set(worldW, boxH, worldD);
            this._groundGroup.add(mesh);
        }

        console.log(
            `[GroundProgram] 已生成 ${terrainRects.length} 地形 + ${roadRects.length} 道路 ` +
            `(厚度 地形=${TERRAIN_THICKNESS}, 道路=${ROAD_THICKNESS}, 层高=${HEIGHT_UNIT})`
        );
    }

    // ============================================================
    // 安装
    // ============================================================
    const Map3DGroundProgram = {
        installed: false,
        RECIPES,
        HEIGHT_UNIT,
        TERRAIN_THICKNESS,
        ROAD_THICKNESS,
        _getTerrainTex: getTerrainTex,

        install() {
            if (this.installed) return false;
            const MC = window.MapCanvas3D;
            if (!MC) return false;
            this._original = MC._buildGround;
            MC._buildGround = buildGround;
            this.installed = true;
            
            // ★ 如果 3D 场景已经建过，强制重建地形
            if (MC.scene && MC._groundGroup) {
                try {
                    // 清掉旧地形
                    while (MC._groundGroup.children.length > 0) {
                        const child = MC._groundGroup.children[0];
                        MC._groundGroup.remove(child);
                        child.geometry?.dispose?.();
                        if (Array.isArray(child.material)) {
                            child.material.forEach(m => m.dispose?.());
                        } else {
                            child.material?.dispose?.();
                        }
                    }
                    // 重建
                    MC._buildGround(window.MapLauncher?.getMap?.());
                    console.log('[GroundProgram] 场景已存在，地形已重建');
                } catch (e) {
                    console.error('[GroundProgram] 重建地形失败:', e);
                }
            }
            
            return true;
        },
        uninstall() {
            if (!this.installed) return;
            const MC = window.MapCanvas3D;
            if (MC && this._original) MC._buildGround = this._original;
            this.installed = false;
        },
        clearCache() {
            _texCache.clear();
            _sideMatCache.clear();
        },
    };

    window.Map3DGroundProgram = Map3DGroundProgram;

    if (window.MapCanvas3D) {
        Map3DGroundProgram.install();
    } else {
        let tries = 0;
        const timer = setInterval(() => {
            if (window.MapCanvas3D) {
                clearInterval(timer);
                Map3DGroundProgram.install();
            } else if (++tries > 50) {
                clearInterval(timer);
                console.warn('[GroundProgram] 等待 MapCanvas3D 超时');
            }
        }, 50);
    }

    console.log('[CinemaWorld] map-3d-ground-program.js 已加载');
})();