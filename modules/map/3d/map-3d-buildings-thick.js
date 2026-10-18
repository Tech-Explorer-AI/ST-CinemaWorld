// ============================================================
// CinemaWorld · map-3d-buildings-thick.js
// 建筑立体化：Sprite → Box
//   - 纯程序化纹理（canvas 生成，无外部图片）
//   - 风格：木纹 / 砖纹 / 石纹 / 瓦片 / 金属 / 电路 / 玻璃 / 霓虹
//   - 高度按占地自适应
//   - 兜底按名字 hash 随机选风格（同名稳定）
// 通过覆盖 MapCanvas3D._buildBuilding 实现，不改动原文件
// 暴露：window.Map3DBuildingsThick
// ============================================================

(function () {
    'use strict';

    if (window.Map3DBuildingsThick) return;

    // ---------- 可调参数 ----------
    const HEIGHT_RATIO = 0.6;
    const MIN_HEIGHT = 1.5;
    const BOX_INSET = 0.98;
    const TEX_SIZE = 64;

    // ============================================================
    // 工具
    // ============================================================
    function rgbStr(r, g, b) {
        return `rgb(${r | 0},${g | 0},${b | 0})`;
    }
    function scaleRGB(hex, factor) {
        const r = Math.max(0, Math.min(255, ((hex >> 16) & 0xff) * factor));
        const g = Math.max(0, Math.min(255, ((hex >> 8) & 0xff) * factor));
        const b = Math.max(0, Math.min(255, (hex & 0xff) * factor));
        return [r, g, b];
    }
    function scaleHex(hex, factor) {
        const [r, g, b] = scaleRGB(hex, factor);
        return ((r | 0) << 16) | ((g | 0) << 8) | (b | 0);
    }
    function hashStr(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        return Math.abs(h);
    }

    // ============================================================
    // 纹理绘制函数
    // ============================================================

    // ---------- 砖纹 ----------
    function drawBrick(ctx, baseHex) {
        const S = TEX_SIZE;
        const [r, g, b] = scaleRGB(baseHex, 1.0);
        const [dr, dg, db] = scaleRGB(baseHex, 0.5);

        ctx.fillStyle = rgbStr(dr, dg, db);
        ctx.fillRect(0, 0, S, S);

        ctx.fillStyle = rgbStr(r, g, b);
        const bw = S / 4;
        const bh = S / 8;
        for (let row = 0; row < S / bh; row++) {
            const offset = (row % 2) * (bw / 2);
            for (let col = -1; col < S / bw + 1; col++) {
                ctx.fillRect(col * bw + offset + 1, row * bh + 1, bw - 2, bh - 2);
            }
        }
    }

    // ---------- 木纹 ----------
    function drawWood(ctx, baseHex) {
        const S = TEX_SIZE;
        const [r, g, b] = scaleRGB(baseHex, 1.0);

        ctx.fillStyle = rgbStr(r, g, b);
        ctx.fillRect(0, 0, S, S);

        const plankH = S / 6;
        for (let row = 0; row < 6; row++) {
            const shade = 0.85 + (row % 3) * 0.08;
            ctx.fillStyle = rgbStr(...scaleRGB(baseHex, shade));
            ctx.fillRect(0, row * plankH + 1, S, plankH - 2);

            // 竖向木纹
            ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 0.65));
            ctx.lineWidth = 1;
            for (let k = 0; k < 3; k++) {
                const x = 4 + k * (S / 3);
                ctx.beginPath();
                ctx.moveTo(x, row * plankH + 2);
                ctx.lineTo(x + 2, row * plankH + plankH - 2);
                ctx.stroke();
            }

            // 板缝
            ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 0.5));
            ctx.beginPath();
            ctx.moveTo(0, row * plankH + plankH - 1);
            ctx.lineTo(S, row * plankH + plankH - 1);
            ctx.stroke();
        }
    }

    // ---------- 石纹 ----------
    function drawStone(ctx, baseHex) {
        const S = TEX_SIZE;
        const rnd = (() => {
            let s = 777;
            return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
        })();
    
        ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 1.0));
        ctx.fillRect(0, 0, S, S);
    
        // 表面颗粒
        for (let i = 0; i < 150; i++) {
            const shade = 0.85 + rnd() * 0.3;
            ctx.fillStyle = rgbStr(...scaleRGB(baseHex, shade));
            ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
        }
    
        // 裂纹
        ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 0.6));
        ctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) {
            let x = rnd() * S, y = rnd() * S;
            ctx.beginPath();
            ctx.moveTo(x, y);
            for (let seg = 0; seg < 4; seg++) {
                x += (rnd() - 0.5) * 15;
                y += (rnd() - 0.5) * 15;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    
        // 边缘
        ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 1.3));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 1); ctx.lineTo(S, 1);
        ctx.moveTo(1, 0); ctx.lineTo(1, S);
        ctx.stroke();
    
        ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 0.55));
        ctx.beginPath();
        ctx.moveTo(0, S - 1); ctx.lineTo(S, S - 1);
        ctx.moveTo(S - 1, 0); ctx.lineTo(S - 1, S);
        ctx.stroke();
    }

    // ---------- 瓦片纹（屋顶）----------
    function drawTile(ctx, baseHex) {
        const S = TEX_SIZE;
        const [r, g, b] = scaleRGB(baseHex, 1.0);

        ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 0.5));
        ctx.fillRect(0, 0, S, S);

        const tileW = S / 4;
        const tileH = S / 4;
        for (let row = 0; row < 4; row++) {
            const offset = (row % 2) * (tileW / 2);
            for (let col = -1; col < 4 + 1; col++) {
                const shade = 0.9 + ((row + col) % 3) * 0.05;
                ctx.fillStyle = rgbStr(...scaleRGB(baseHex, shade));
                ctx.fillRect(col * tileW + offset + 1, row * tileH + 1, tileW - 2, tileH - 2);
            }
        }
    }

    // ---------- 金属板 ----------
    function drawMetal(ctx, baseHex) {
        const S = TEX_SIZE;
        const rnd = (() => {
            let s = 999;
            return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
        })();
    
        // 底色
        ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 1.0));
        ctx.fillRect(0, 0, S, S);
    
        // ★ 竖向高光带（不是满屏噪点）
        const grad = ctx.createLinearGradient(0, 0, S, 0);
        grad.addColorStop(0, `rgba(255,255,255,0.15)`);
        grad.addColorStop(0.3, `rgba(255,255,255,0.02)`);
        grad.addColorStop(0.7, `rgba(0,0,0,0.05)`);
        grad.addColorStop(1, `rgba(255,255,255,0.1)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, S, S);
    
        // 少量噪声
        for (let i = 0; i < 40; i++) {
            ctx.fillStyle = rgbStr(...scaleRGB(baseHex, rnd() > 0.5 ? 1.1 : 0.9));
            ctx.fillRect(rnd() * S, rnd() * S, 1, 1);
        }
    
        // ★ 四边金属接缝
        ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 0.6));
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, S - 2, S - 2);
    
        // 四角铆钉
        const r = 2.5;
        ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 0.7));
        for (const [cx, cy] of [
            [6, 6], [S - 6, 6], [6, S - 6], [S - 6, S - 6],
        ]) {
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
            // 高光
            ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 1.4));
            ctx.beginPath();
            ctx.arc(cx - 1, cy - 1, 1, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 0.7));
        }
    }

    // ---------- 电路板 ----------
    function drawCircuit(ctx, baseHex) {
        const S = TEX_SIZE;
        const rnd = (() => {
            let s = 4242;
            return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
        })();
    
        // 深色底
        ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 0.4));
        ctx.fillRect(0, 0, S, S);
    
        // ★ 中央一块大芯片
        const chipW = S * 0.5;
        const chipH = S * 0.5;
        const cx = (S - chipW) / 2;
        const cy = (S - chipH) / 2;
    
        ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 0.7));
        ctx.fillRect(cx, cy, chipW, chipH);
    
        // 芯片边框
        ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 1.4));
        ctx.lineWidth = 2;
        ctx.strokeRect(cx, cy, chipW, chipH);
    
        // 芯片上的小点（引脚）
        ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 1.6));
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                ctx.beginPath();
                ctx.arc(
                    cx + 6 + i * (chipW - 12) / 2,
                    cy + 6 + j * (chipH - 12) / 2,
                    1.5, 0, Math.PI * 2
                );
                ctx.fill();
            }
        }
    
        // ★ 从芯片辐射出的走线
        ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 1.3));
        ctx.lineWidth = 1;
        const lines = 8;
        for (let i = 0; i < lines; i++) {
            const a = (i / lines) * Math.PI * 2 + 0.3;
            ctx.beginPath();
            ctx.moveTo(S / 2, S / 2);
            const x1 = S / 2 + Math.cos(a) * (S * 0.4);
            const y1 = S / 2 + Math.sin(a) * (S * 0.4);
            ctx.lineTo(x1, y1);
            ctx.stroke();
    
            // 端点小圆
            ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 1.6));
            ctx.beginPath();
            ctx.arc(x1, y1, 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
    
        // ★ 边缘发光
        ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 1.2));
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
    }

    // ---------- 玻璃幕墙 ----------
    function drawGlass(ctx, baseHex) {
        const S = TEX_SIZE;
    
        // 底色（深蓝）
        ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 0.6));
        ctx.fillRect(0, 0, S, S);
    
        // ★ 一整块玻璃（不是 4×4）
        // 斜向高光带
        const grad = ctx.createLinearGradient(0, S, S, 0);
        grad.addColorStop(0, `rgba(255,255,255,0.0)`);
        grad.addColorStop(0.4, `rgba(255,255,255,0.15)`);
        grad.addColorStop(0.5, `rgba(255,255,255,0.25)`);
        grad.addColorStop(0.6, `rgba(255,255,255,0.15)`);
        grad.addColorStop(1, `rgba(255,255,255,0.0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, S, S);
    
        // 反射的天空色（顶部偏亮）
        const sky = ctx.createLinearGradient(0, 0, 0, S);
        sky.addColorStop(0, `rgba(180,220,255,0.2)`);
        sky.addColorStop(0.5, `rgba(180,220,255,0.05)`);
        sky.addColorStop(1, `rgba(0,0,0,0.1)`);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, S, S);
    
        // ★ 玻璃边框（现代幕墙一定有铝框）
        ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 0.3));
        ctx.lineWidth = 3;
        ctx.strokeRect(1.5, 1.5, S - 3, S - 3);
    
        // 内侧高光（左/上）
        ctx.strokeStyle = `rgba(255,255,255,0.5)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(3, S - 3);
        ctx.lineTo(3, 3);
        ctx.lineTo(S - 3, 3);
        ctx.stroke();
    }

    // ---------- 霓虹科技板 ----------
    function drawNeon(ctx, baseHex) {
        const S = TEX_SIZE;

        // 深底
        ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 0.2));
        ctx.fillRect(0, 0, S, S);

        // 发光格
        const cw = S / 4;
        for (let row = 0; row < 4; row++) {
            for (let col = 0; col < 4; col++) {
                // 部分格子亮
                const lit = ((row * 4 + col) % 3) === 0;
                if (lit) {
                    const [r, g, b] = scaleRGB(baseHex, 1.8);
                    ctx.fillStyle = rgbStr(r, g, b);
                    ctx.fillRect(col * cw + 3, row * cw + 3, cw - 6, cw - 6);
                } else {
                    const [r, g, b] = scaleRGB(baseHex, 0.5);
                    ctx.fillStyle = rgbStr(r, g, b);
                    ctx.fillRect(col * cw + 3, row * cw + 3, cw - 6, cw - 6);
                }
            }
        }

        // 网格线
        ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 0.3));
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            ctx.beginPath();
            ctx.moveTo(i * cw, 0);
            ctx.lineTo(i * cw, S);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i * cw);
            ctx.lineTo(S, i * cw);
            ctx.stroke();
        }
    }

    // ---------- 混凝土 ----------
    function drawConcrete(ctx, baseHex) {
        const S = TEX_SIZE;
        const rnd = (() => {
            let s = 333;
            return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
        })();
    
        ctx.fillStyle = rgbStr(...scaleRGB(baseHex, 1.0));
        ctx.fillRect(0, 0, S, S);
    
        // 细噪点
        for (let i = 0; i < 200; i++) {
            const shade = 0.9 + rnd() * 0.2;
            ctx.fillStyle = rgbStr(...scaleRGB(baseHex, shade));
            ctx.fillRect(rnd() * S, rnd() * S, 1, 1);
        }
    
        // ★ 边缘接缝（细线）
        ctx.strokeStyle = rgbStr(...scaleRGB(baseHex, 0.75));
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0.75, 0.75, S - 1.5, S - 1.5);
    }

    // ============================================================
    // 纹理缓存
    // ============================================================
    const _texCache = new Map();

    function getTexture(T, kind, baseHex) {
        // ★ 应用当前风格染色
        const tintedHex = window.Map3DStyle
            ? window.Map3DStyle.tintColor(baseHex)
            : baseHex;

        const key = `${kind}|${tintedHex}`;
        if (_texCache.has(key)) return _texCache.get(key);

        const c = document.createElement('canvas');
        c.width = TEX_SIZE;
        c.height = TEX_SIZE;
        const ctx = c.getContext('2d');

        switch (kind) {
            case 'brick': drawBrick(ctx, tintedHex); break;
            case 'wood': drawWood(ctx, tintedHex); break;
            case 'stone': drawStone(ctx, tintedHex); break;
            case 'tile': drawTile(ctx, tintedHex); break;
            case 'metal': drawMetal(ctx, tintedHex); break;
            case 'circuit': drawCircuit(ctx, tintedHex); break;
            case 'glass': drawGlass(ctx, tintedHex); break;
            case 'neon': drawNeon(ctx, tintedHex); break;
            case 'concrete': drawConcrete(ctx, tintedHex); break;
            default: {
                const [r, g, b] = scaleRGB(tintedHex, 1.0);
                ctx.fillStyle = rgbStr(r, g, b);
                ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
            }
        }

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

    // ============================================================
    // 建筑风格预设（16 种 + 特殊匹配）
    // ============================================================
    const PRESETS = [
        // ---------- 传统 ----------
        { kind: 'wood', wallHex: 0x8a6a4a, roofHex: 0x6a4a3a, tag: '木屋' },
        { kind: 'wood', wallHex: 0x9a7a5a, roofHex: 0x5a4a3a, tag: '深木' },
        { kind: 'wood', wallHex: 0xa08868, roofHex: 0x6a5a48, tag: '黄木' },
        { kind: 'brick', wallHex: 0xa8604a, roofHex: 0x7a3a2a, tag: '红砖' },
        { kind: 'brick', wallHex: 0xb87858, roofHex: 0x8a4a3a, tag: '浅砖' },
        { kind: 'brick', wallHex: 0x986050, roofHex: 0x5a3028, tag: '暗砖' },
        { kind: 'stone', wallHex: 0xa8a8b0, roofHex: 0x6a6a80, tag: '青石' },
        { kind: 'stone', wallHex: 0xb8b0a0, roofHex: 0x7a7a80, tag: '暖石' },
        { kind: 'concrete', wallHex: 0xa0a0a0, roofHex: 0x707078, tag: '混凝土' },

        // ---------- 科技 ----------
        { kind: 'metal', wallHex: 0x8890a0, roofHex: 0x5a5a68, tag: '金属' },
        { kind: 'metal', wallHex: 0x707888, roofHex: 0x4a4a58, tag: '暗金属' },
        { kind: 'circuit', wallHex: 0x2a4a3a, roofHex: 0x1a3a2a, tag: '电路板' },
        { kind: 'glass', wallHex: 0x4a80c0, roofHex: 0x2a4a80, tag: '玻璃幕墙' },
        { kind: 'glass', wallHex: 0x5a90c8, roofHex: 0x3a5a90, tag: '天蓝玻璃' },
        { kind: 'neon', wallHex: 0x8a3ac8, roofHex: 0x5a1a8a, tag: '紫霓虹' },
        { kind: 'neon', wallHex: 0x3ac8c8, roofHex: 0x1a8a8a, tag: '青霓虹' },
        { kind: 'concrete', wallHex: 0x808888, roofHex: 0x505860, tag: '现代灰' },
    ];

    // ============================================================
    // 建筑风格选择
    // ============================================================
    function pickBuildingStyle(ent, fallbackColor) {
        const name = (ent.name || '') + ' ' + (ent.tags || []).join(' ');

        // ---------- 科技关键词优先 ----------
        if (/实验室|研究所|工厂|电站|服务器|科技|赛博|机甲|laser|tech|lab|factory|reactor|cyber/.test(name)) {
            return { kind: 'circuit', wallHex: 0x2a4a3a, roofHex: 0x1a3a2a };
        }
        if (/玻璃|幕墙|大厦|写字楼|塔|中心|商务|CBD|glass|tower/.test(name)) {
            return { kind: 'glass', wallHex: 0x4a80c0, roofHex: 0x2a4a80 };
        }
        if (/霓虹|夜店|酒吧|娱乐|livehouse|夜总|迪厅|neon|club/.test(name)) {
            return { kind: 'neon', wallHex: 0x8a3ac8, roofHex: 0x5a1a8a };
        }
        if (/工厂|车间|仓库|车间|码头|warehouse|depot/.test(name)) {
            return { kind: 'metal', wallHex: 0x8890a0, roofHex: 0x5a5a68 };
        }

        // ---------- 传统关键词 ----------
        if (/木屋|小屋|棚屋|茅屋|民居|house|客栈|旅店|inn|cabin|亭|舍/.test(name)) {
            return { kind: 'wood', wallHex: 0x8a6a4a, roofHex: 0x6a4a3a };
        }
        if (/砖|瓦房|house_brick|杂货|面包|药铺|铁匠|烟囱/.test(name)) {
            return { kind: 'brick', wallHex: 0xa8604a, roofHex: 0x7a3a2a };
        }
        if (/市政|教堂|钟楼|图书馆|temple|chapel|townhall|stone|祠|庙|塔|府/.test(name)) {
            return { kind: 'stone', wallHex: 0xa8a8b0, roofHex: 0x6a6a80 };
        }
        if (/商店|咖啡馆|shop|cafe|酒馆|tavern|bar|铺|店|馆|楼|厦/.test(name)) {
            return { kind: 'wood', wallHex: 0xa08060, roofHex: 0x5a4a3a };
        }
        const bias = window.Map3DStyle?.getBuildingBias?.();
        if (bias && bias.length > 0) {
            const candidates = PRESETS.filter(p => bias.includes(p.kind));
            if (candidates.length > 0) {
                const h = hashStr(ent.name || ent.id || '');
                return candidates[h % candidates.length];
            }
        }
        // ---------- 兜底：hash 随机 ----------
        const h = hashStr(ent.name || ent.id || '');
        return PRESETS[h % PRESETS.length];
    }

    // ============================================================
    // 新 _buildBuilding
    // ============================================================
    function buildBuilding(ent) {
        const T = this.THREE;
        if (!ent.anchor || !ent.size) return;
        const map = window.MapLauncher?.getMap?.();
    
        // ★ 解析建筑风格
        const styleObj = window.Map3DStyle?.resolveForEntity(ent, map);
        window.Map3DStyle?.push(styleObj);
    
        const tileSize = this._tileSize;
        const w = ent.size.w * tileSize;
        const h = ent.size.h * tileSize;
    
        const cx = ent.anchor.x + ent.size.w / 2 - 0.5;
        const cy = ent.anchor.y + ent.size.h / 2 - 0.5;
        const pos = this._gridToWorld(cx, cy);
    
        // ★★★ 关键修复 1：取格子高度
        //   用"多格平均高度"作为建筑基准（跨多格时不会悬空或深埋）
        const groundY = _getBuildingGroundY(this, map, ent);
    
        // ---------- 1. 占位底 ----------
        const markGeo = new T.PlaneGeometry(w - 0.04, h - 0.04);
        markGeo.rotateX(-Math.PI / 2);
        const markMat = new T.MeshBasicMaterial({
            color: 0xa88a5a, transparent: true, opacity: 0.35, depthWrite: false,
        });
        const mark = new T.Mesh(markGeo, markMat);
        mark.position.set(pos.x, groundY + 0.04, pos.z);   // ★ 用 groundY
        mark.renderOrder = -2;
        this._entityGroup.add(mark);
    
        const edgeGeo = new T.EdgesGeometry(markGeo);
        const edgeMat = new T.LineBasicMaterial({
            color: 0x6a4a2a, transparent: true, opacity: 0.5,
        });
        const edges = new T.LineSegments(edgeGeo, edgeMat);
        edges.position.set(pos.x, groundY + 0.05, pos.z);   // ★ 用 groundY
        edges.renderOrder = -1;
        this._entityGroup.add(edges);
    
        // ---------- 2. Box 建筑主体 ----------
        const boxW = w * BOX_INSET;
        const boxD = h * BOX_INSET;
        const avgSide = (boxW + boxD) / 2;
        const WALL_HEIGHT = Math.max(MIN_HEIGHT, avgSide * HEIGHT_RATIO);
    
        const boxGeo = new T.BoxGeometry(boxW, WALL_HEIGHT, boxD);
    
        const fallbackColor = this._buildingColor(ent);
        const style = pickBuildingStyle(ent, fallbackColor);
    
        // 纹理（不变）
        const wallTex = getTexture(T, style.kind, style.wallHex).clone();
        wallTex.needsUpdate = true;
        wallTex.repeat.set(
            Math.max(1, Math.round(boxW / 1.2)),
            Math.max(1, Math.round(WALL_HEIGHT / 1.2))
        );
    
        const roofKind = (style.kind === 'glass' || style.kind === 'neon' || style.kind === 'circuit' || style.kind === 'metal')
            ? style.kind
            : 'tile';
        const roofTex = getTexture(T, roofKind, style.roofHex).clone();
        roofTex.needsUpdate = true;
        roofTex.repeat.set(
            Math.max(1, Math.round(boxW / 1.5)),
            Math.max(1, Math.round(boxD / 1.5))
        );
    
        const wallMat = new T.MeshBasicMaterial({ map: wallTex });
        const wallMat2 = new T.MeshBasicMaterial({ map: wallTex });
        const roofMat = new T.MeshBasicMaterial({ map: roofTex });
        const bottomMat = new T.MeshBasicMaterial({
            color: scaleHex(style.wallHex, 0.4),
        });
    
        const buildingMesh = new T.Mesh(boxGeo, [
            wallMat, wallMat2, roofMat, bottomMat, wallMat, wallMat2,
        ]);
        // ★★★ 关键修复 2：从 groundY 起算
        buildingMesh.position.set(pos.x, groundY + WALL_HEIGHT / 2, pos.z);
        buildingMesh.userData._entityId = ent.id;
        buildingMesh.userData._isBuilding = true;
        buildingMesh.userData._baseGroundY = groundY;   // ★ 记录，供后面同步
        this._entityGroup.add(buildingMesh);
    
        // ---------- 3. 门标记 ----------
        let doorData = null;
        if (ent.entrance) {
            // ★ 门也要用门格的 groundY，不是建筑的
            const doorGroundY = _getBuildingGroundY(this, map, ent, 'entrance');
            doorData = this._buildBuildingEntrance
                ? this._buildBuildingEntrance(ent)
                : null;
        }
    
        // ---------- 4. 记录 ----------
        this._entityNodes.set(ent.id, {
            sprite: buildingMesh,
            mark,
            edges,
            doorData,
            _isBuilding: true,
            _groundY: groundY,              // ★ 供 _syncNodeAttachments 用
            _groundYTarget: groundY,
        });
    
        console.log(
            `[BuildingsThick] 建筑: ${ent.name} @ (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}), ` +
            `groundY=${groundY.toFixed(2)}, 风格=${style.kind}${style.tag ? '/' + style.tag : ''}, ` +
            `尺寸 ${ent.size.w}×${ent.size.h}, Box ${boxW.toFixed(1)}×${WALL_HEIGHT.toFixed(1)}×${boxD.toFixed(1)}`
        );
    }
    
    // ============================================================
    // ★ 新增：取建筑基准高度
    //   跨多格时，取所有覆盖格子的平均高度
    //   这样建筑不会悬空（取最小）也不会深埋（取最大）
    // ============================================================
    function _getBuildingGroundY(ctx, map, ent, mode = 'center') {
        if (!map?._generated?.grid) return 0;
    
        const grid = map._generated.grid;
        const W = grid[0].length;
        const H = grid.length;
        const ts = ctx._tileSize || 1;
    
        // 取格子的世界 y（用 Map3DGround 的标准）
        const getCellY = (gx, gy) => {
            if (gx < 0 || gx >= W || gy < 0 || gy >= H) return null;
            const cell = grid[gy]?.[gx];
            if (!cell || cell.terrain === 'void') return null;
            return window.Map3DGround?.getCellWorldY
                ? window.Map3DGround.getCellWorldY(map, gx, gy)
                : (cell.height || 0) * (window.Map3DGround?.HEIGHT_UNIT ?? 0.5);
        };
    
        // ---------- 模式 1：门格高度 ----------
        if (mode === 'entrance' && ent.entrance) {
            const y = getCellY(ent.entrance.x, ent.entrance.y);
            return y ?? 0;
        }
    
        // ---------- 模式 2：所有覆盖格子的平均 ----------
        const { x, y } = ent.anchor;
        const { w, h } = ent.size;
        let sum = 0;
        let count = 0;
    
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                const cellY = getCellY(x + dx, y + dy);
                if (cellY === null) continue;
                sum += cellY;
                count++;
            }
        }
    
        return count > 0 ? sum / count : 0;
    }

    // ============================================================
    // 安装 / 卸载
    // ============================================================
    const Map3DBuildingsThick = {
        installed: false,
        HEIGHT_RATIO,
        BOX_INSET,
        PRESETS,

        install() {
            if (this.installed) return false;
            const MC = window.MapCanvas3D;
            if (!MC) {
                console.warn('[BuildingsThick] MapCanvas3D 未就绪');
                return false;
            }
            this._original = MC._buildBuilding;
            MC._buildBuilding = buildBuilding;
            this.installed = true;
            console.log('[BuildingsThick] 已接管 _buildBuilding（程序化纹理建筑）');
            return true;
        },

        uninstall() {
            if (!this.installed) return;
            const MC = window.MapCanvas3D;
            if (MC && this._original) MC._buildBuilding = this._original;
            this.installed = false;
        },

        clearCache() {
            _texCache.clear();
            console.log('[BuildingsThick] 纹理缓存已清空');
        },
    };

    window.Map3DBuildingsThick = Map3DBuildingsThick;

    if (window.MapCanvas3D) {
        Map3DBuildingsThick.install();
    } else {
        let tries = 0;
        const timer = setInterval(() => {
            if (window.MapCanvas3D) {
                clearInterval(timer);
                Map3DBuildingsThick.install();
            } else if (++tries > 50) {
                clearInterval(timer);
                console.warn('[BuildingsThick] 等待 MapCanvas3D 超时');
            }
        }, 50);
    }

    console.log('[CinemaWorld] map-3d-buildings-thick.js 已加载');
})();