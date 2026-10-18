// ============================================================
// CinemaWorld · world-direction.js
// 8 方向常量 + 反向 + 镜像 + 坐标偏移
// 纯函数，无依赖，可独立测试
// 暴露：window.WorldDirection
// ============================================================

(function () {
    'use strict';

    if (window.WorldDirection) return;

    // ---------- 8 方向常量 ----------
    const DIRS = {
        N:  'north',
        NE: 'northeast',
        E:  'east',
        SE: 'southeast',
        S:  'south',
        SW: 'southwest',
        W:  'west',
        NW: 'northwest',
    };

    // 按圆周顺序（顺时针）
    const ORDER = [DIRS.N, DIRS.NE, DIRS.E, DIRS.SE, DIRS.S, DIRS.SW, DIRS.W, DIRS.NW];

    // 反向表（镜像）
    const OPPOSITE = {
        [DIRS.N]:  DIRS.S,
        [DIRS.S]:  DIRS.N,
        [DIRS.E]:  DIRS.W,
        [DIRS.W]:  DIRS.E,
        [DIRS.NE]: DIRS.SW,
        [DIRS.SW]: DIRS.NE,
        [DIRS.SE]: DIRS.NW,
        [DIRS.NW]: DIRS.SE,
    };

    // 坐标偏移（y 轴向上为正，屏幕坐标里 y 增大是向南）
    //   north: (0, -1)   northeast: (1, -1)
    const OFFSET = {
        [DIRS.N]:  { x: 0,  y: -1 },
        [DIRS.NE]: { x: 1,  y: -1 },
        [DIRS.E]:  { x: 1,  y: 0  },
        [DIRS.SE]: { x: 1,  y: 1  },
        [DIRS.S]:  { x: 0,  y: 1  },
        [DIRS.SW]: { x: -1, y: 1  },
        [DIRS.W]:  { x: -1, y: 0  },
        [DIRS.NW]: { x: -1, y: -1 },
    };

    // 出入口在地图边缘的相对位置（0~1）
    const EDGE_POS = {
        [DIRS.N]:  { x: 0.5,  y: 0    },
        [DIRS.NE]: { x: 0.9,  y: 0.05 },
        [DIRS.E]:  { x: 1.0,  y: 0.5  },
        [DIRS.SE]: { x: 0.9,  y: 0.95 },
        [DIRS.S]:  { x: 0.5,  y: 1.0  },
        [DIRS.SW]: { x: 0.1,  y: 0.95 },
        [DIRS.W]:  { x: 0.0,  y: 0.5  },
        [DIRS.NW]: { x: 0.1,  y: 0.05 },
    };

    // 中文名
    const NAME_CN = {
        [DIRS.N]:  '北',
        [DIRS.NE]: '东北',
        [DIRS.E]:  '东',
        [DIRS.SE]: '东南',
        [DIRS.S]:  '南',
        [DIRS.SW]: '西南',
        [DIRS.W]:  '西',
        [DIRS.NW]: '西北',
    };

    // 别名（兼容 AI 可能写出的各种写法）
    const ALIASES = {
        '北': DIRS.N, 'north': DIRS.N, 'n': DIRS.N, '上': DIRS.N,
        '东北': DIRS.NE, 'northeast': DIRS.NE, 'ne': DIRS.NE, '右上': DIRS.NE,
        '东': DIRS.E, 'east': DIRS.E, 'e': DIRS.E, '右': DIRS.E,
        '东南': DIRS.SE, 'southeast': DIRS.SE, 'se': DIRS.SE, '右下': DIRS.SE,
        '南': DIRS.S, 'south': DIRS.S, 's': DIRS.S, '下': DIRS.S,
        '西南': DIRS.SW, 'southwest': DIRS.SW, 'sw': DIRS.SW, '左下': DIRS.SW,
        '西': DIRS.W, 'west': DIRS.W, 'w': DIRS.W, '左': DIRS.W,
        '西北': DIRS.NW, 'northwest': DIRS.NW, 'nw': DIRS.NW, '左上': DIRS.NW,
    };

    const WorldDirection = {
        DIRS,
        ORDER,
        OPPOSITE,
        OFFSET,
        EDGE_POS,
        NAME_CN,
        ALIASES,

        // ---------- 规范化方向名 ----------
        normalize(input) {
            if (!input) return null;
            const s = String(input).trim().toLowerCase();
            return ALIASES[s] || null;
        },

        // ---------- 反向 ----------
        opposite(dir) {
            const d = this.normalize(dir);
            return d ? OPPOSITE[d] : null;
        },

        // ---------- 坐标偏移 ----------
        offset(dir) {
            const d = this.normalize(dir);
            return d ? { ...OFFSET[d] } : { x: 0, y: 0 };
        },

        // ---------- 边缘位置 ----------
        edgePos(dir) {
            const d = this.normalize(dir);
            return d ? { ...EDGE_POS[d] } : { x: 0.5, y: 0.5 };
        },

        // ---------- 中文名 ----------
        cn(dir) {
            const d = this.normalize(dir);
            return d ? NAME_CN[d] : '';
        },

        // ---------- 是否是斜角 ----------
        isDiagonal(dir) {
            const d = this.normalize(dir);
            return d === DIRS.NE || d === DIRS.SE || d === DIRS.SW || d === DIRS.NW;
        },

        // ---------- 是否是正交方向 ----------
        isCardinal(dir) {
            const d = this.normalize(dir);
            return d === DIRS.N || d === DIRS.E || d === DIRS.S || d === DIRS.W;
        },

        // ---------- 给定两个坐标，算方向 ----------
        fromDelta(dx, dy) {
            for (const d of ORDER) {
                const o = OFFSET[d];
                if (o.x === dx && o.y === dy) return d;
            }
            return null;
        },

        // ---------- 列出所有方向 ----------
        all() {
            return [...ORDER];
        },

        // ---------- 列出正交方向 ----------
        cardinals() {
            return [DIRS.N, DIRS.E, DIRS.S, DIRS.W];
        },

        // ---------- 列出斜角方向 ----------
        diagonals() {
            return [DIRS.NE, DIRS.SE, DIRS.SW, DIRS.NW];
        },
    };

    window.WorldDirection = WorldDirection;
    console.log('[CinemaWorld] world-direction.js 已加载');
})();