// ============================================================
// CinemaWorld · map-3d-style.js
// 地图风格 → 视觉参数（三级覆盖：建筑 > 区域 > 地图）
// 暴露：window.Map3DStyle
// ============================================================

(function () {
    'use strict';

    if (window.Map3DStyle) return;

    // ============================================================
    // 风格预设表
    // ============================================================
    const STYLES = {
        '中式传统': {
            ambient: 0xfff0e0, sunColor: 0xffe8c0,
            fogColor: 0x2a2018, bgColor: 0x1a1410,
            groundTint: { r: 1.00, g: 0.95, b: 0.85 },
            buildingBias: ['wood', 'brick', 'stone'],
        },
        '欧式中世纪': {
            ambient: 0xc8c0b0, sunColor: 0xe8dcc0,
            fogColor: 0x2a2820, bgColor: 0x1a1814,
            groundTint: { r: 0.95, g: 0.92, b: 0.85 },
            buildingBias: ['stone', 'brick', 'wood'],
        },
        '现代': {
            ambient: 0xf0f4ff, sunColor: 0xffffff,
            fogColor: 0x1a2030, bgColor: 0x0d1220,
            groundTint: { r: 0.95, g: 0.98, b: 1.00 },
            buildingBias: ['glass', 'concrete', 'metal'],
        },
        '赛博朋克': {
            ambient: 0x4a3a6a, sunColor: 0xff80c0,
            fogColor: 0x1a0a2a, bgColor: 0x0a0512,
            groundTint: { r: 0.85, g: 0.80, b: 1.10 },
            buildingBias: ['neon', 'circuit', 'glass', 'metal'],
        },
        '日式传统': {
            ambient: 0xfff4e8, sunColor: 0xffe8d0,
            fogColor: 0x2a2820, bgColor: 0x1a1814,
            groundTint: { r: 1.00, g: 0.96, b: 0.88 },
            buildingBias: ['wood', 'brick', 'stone'],
        },
        '工业': {
            ambient: 0x908880, sunColor: 0xc8b8a0,
            fogColor: 0x2a2824, bgColor: 0x181614,
            groundTint: { r: 0.90, g: 0.88, b: 0.85 },
            buildingBias: ['metal', 'concrete', 'brick'],
        },
        '沙漠': {
            ambient: 0xffe0a0, sunColor: 0xffe8b0,
            fogColor: 0x4a3a20, bgColor: 0x2a2010,
            groundTint: { r: 1.15, g: 1.00, b: 0.70 },
            buildingBias: ['stone', 'concrete', 'brick'],
        },
        '极地': {
            ambient: 0xd8e8ff, sunColor: 0xe8f4ff,
            fogColor: 0x2a3040, bgColor: 0x18202a,
            groundTint: { r: 0.90, g: 0.95, b: 1.10 },
            buildingBias: ['stone', 'wood', 'metal'],
        },
        '默认': {
            ambient: 0xffffff, sunColor: 0xfff4e0,
            fogColor: 0x0d0d18, bgColor: 0x0d0d18,
            groundTint: { r: 1, g: 1, b: 1 },
            buildingBias: null,
        },
    };

    // ============================================================
    // 区域类型 → 风格（当地图风格没写时兜底）
    // ============================================================
    const REGION_TYPE_STYLE = {
        '村庄': '中式传统',
        '森林': '中式传统',
        '田野': '中式传统',
        '山地': '欧式中世纪',
        '遗迹': '欧式中世纪',
        '神殿': '欧式中世纪',
        '集市': '欧式中世纪',
        '洞穴': '工业',
        '营地': '工业',
        '道路': '工业',
        '沙滩': '沙漠',
        '湖泊': '现代',
        '房间': '现代',
        '走廊': '现代',
        '大厅': '现代',
        '迷宫': '赛博朋克',
    };

    const Map3DStyle = {
        _mapStyle: STYLES['默认'],
        _mapStyleName: '默认',

        // 当前生效的风格（可能是地图 / 区域 / 建筑的）
        _current: STYLES['默认'],
        _currentName: '默认',

        // ============================================================
        // 设置地图全局风格（进图时调一次）
        // ============================================================
        setMapStyle(map) {
            const raw = map?.style;
            let name = '默认';
            if (raw) {
                if (typeof raw === 'string') name = raw;
                else name = raw.name || raw.id || '默认';
            }
            this._mapStyleName = name;
            this._mapStyle = STYLES[name] || STYLES['默认'];
            this._currentName = name;
            this._current = this._mapStyle;
            console.log(`[Map3DStyle] 地图风格: ${name}`);
            return this._current;
        },

        // ============================================================
        // ★ 三级覆盖：取某实体的最终风格
        //   priority: 建筑.style > 区域.type 映射 > 地图.style
        // ============================================================
        resolveForEntity(ent, map) {
            // 1. 实体自带 style（建筑模板）
            if (ent?.style && STYLES[ent.style]) {
                return { name: ent.style, ...STYLES[ent.style], source: 'building' };
            }

            // 2. 区域类型映射
            const regionName = ent?.region;
            if (regionName && map?.regions) {
                const region = map.regions.find(r => r.name === regionName);
                if (region?.type && REGION_TYPE_STYLE[region.type]) {
                    const sname = REGION_TYPE_STYLE[region.type];
                    return { name: sname, ...STYLES[sname], source: 'region' };
                }
            }

            // 3. 地图全局
            return {
                name: this._mapStyleName,
                ...this._mapStyle,
                source: 'map',
            };
        },

        // ============================================================
        // 切换"当前生效"的风格（用于 ground / building 生成时查询）
        // ============================================================
        push(styleObj) {
            if (!styleObj) return;
            this._current = styleObj;
            this._currentName = styleObj.name || this._mapStyleName;
        },

        pop() {
            this._current = this._mapStyle;
            this._currentName = this._mapStyleName;
        },

        get() { return this._current; },
        getName() { return this._currentName; },
        getMapStyle() { return this._mapStyle; },

        // ============================================================
        // 地形色偏移（乘）
        // ============================================================
        tintColor(hex) {
            const t = this._current.groundTint;
            if (!t) return hex;
            const r = Math.min(255, ((hex >> 16) & 0xff) * t.r) | 0;
            const g = Math.min(255, ((hex >> 8) & 0xff) * t.g) | 0;
            const b = Math.min(255, (hex & 0xff) * t.b) | 0;
            return (r << 16) | (g << 8) | b;
        },

        getBuildingBias() {
            return this._current.buildingBias || null;
        },

        // ============================================================
        // 把地图风格应用到场景
        // ============================================================
        applyMapStyleToScene(THREE, scene, ambient, sun) {
            const s = this._mapStyle;
            if (scene.background?.isColor) scene.background.setHex(s.bgColor);
            if (scene.fog) scene.fog.color.setHex(s.fogColor);
            if (ambient) ambient.color.setHex(s.ambient);
            if (sun) sun.color.setHex(s.sunColor);
            console.log(`[Map3DStyle] 场景应用: ${this._mapStyleName}`);
        },

        listNames() {
            return Object.keys(STYLES).filter(k => k !== '默认');
        },

        STYLES,
        REGION_TYPE_STYLE,
    };

    window.Map3DStyle = Map3DStyle;
    console.log('[CinemaWorld] map-3d-style.js 已加载');
})();