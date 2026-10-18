// ============================================================
// CinemaWorld · factory-schema.js
// 工厂数据结构 / 创建 / 归一化 / 校验
//
// 核心抽象：
//   - 资源（resource）：一切可数的东西，原料/产物/燃料/货币等价物
//   - 建筑（building）：extractor / processor / storage / power
//   - 配方（recipe）：输入资源 → 输出资源
//
// 依赖：无
// 暴露：window.FactorySchema
// ============================================================

(function () {
    'use strict';

    const FactorySchema = {
        // 建筑种类
        KIND: {
            EXTRACTOR: 'extractor',
            PROCESSOR: 'processor',
            STORAGE: 'storage',
            POWER: 'power',
        },

        // 基础容量（每个资源的默认上限）
        BASE_CAPACITY: 100,

        // ============================================================
        // 创建空白工厂
        // ============================================================
        createEmpty(plot) {
            const w = Math.max(1, plot.bounds?.w || 3);
            const h = Math.max(1, plot.bounds?.h || 3);

            const cells = [];
            for (let y = 0; y < h; y++) {
                const row = [];
                for (let x = 0; x < w; x++) {
                    row.push({
                        building: null,       // { id, type, x, y, size } | null（左上角）
                        occupiedBy: null,     // 'bld_xxx' | null（被占用的副格）
                        occupiedOffset: null, // { dx, dy } | null
                    });
                }
                cells.push(row);
            }

            const ws = window.CinemaWorld?.worldState;
            const now = (typeof ws?.worldMinutes === 'number') ? ws.worldMinutes : 0;

            return {
                width: w,
                height: h,
                cells,
                buildings: {},
                storage: {},
                storageCapacity: {},
                power: { generated: 0, consumed: 0 },
                lastTickAt: now,
                stats: {
                    totalProduced: {},
                    totalConsumed: {},
                },
            };
        },

        // ============================================================
        // 归一化（用于读档）
        // ============================================================
        normalize(factory, plot) {
            if (!factory || typeof factory !== 'object') {
                return this.createEmpty(plot || { bounds: { w: 3, h: 3 } });
            }

            const w = Math.max(1, factory.width || plot?.bounds?.w || 3);
            const h = Math.max(1, factory.height || plot?.bounds?.h || 3);

            // 重建 cells（防止旧存档缺格）
            const cells = [];
            for (let y = 0; y < h; y++) {
                const row = [];
                for (let x = 0; x < w; x++) {
                    const old = factory.cells?.[y]?.[x];
                    row.push({
                        building: old?.building || null,
                        occupiedBy: old?.occupiedBy || null,
                        occupiedOffset: old?.occupiedOffset || null,
                    });
                }
                cells.push(row);
            }

            const ws = window.CinemaWorld?.worldState;
            const now = (typeof ws?.worldMinutes === 'number') ? ws.worldMinutes : 0;

            return {
                width: w,
                height: h,
                cells,
                buildings: factory.buildings || {},
                storage: factory.storage || {},
                storageCapacity: factory.storageCapacity || {},
                power: factory.power || { generated: 0, consumed: 0 },
                lastTickAt: (typeof factory.lastTickAt === 'number') ? factory.lastTickAt : now,
                stats: {
                    totalProduced: factory.stats?.totalProduced || {},
                    totalConsumed: factory.stats?.totalConsumed || {},
                },
            };
        },

        // ============================================================
        // 校验（针对 AI 生成的 rules）
        // ============================================================
        validateRules(rules) {
            const errors = [];
            const warnings = [];

            if (!rules) {
                errors.push('rules 为空');
                return { ok: false, errors, warnings };
            }

            const resourceKeys = new Set(Object.keys(rules.resourceTypes || {}));
            const buildingKeys = new Set(Object.keys(rules.buildingTypes || {}));

            if (resourceKeys.size === 0) {
                errors.push('没有声明任何资源类型');
            }
            if (buildingKeys.size === 0) {
                errors.push('没有声明任何建筑类型');
            }

            // 检查建筑
            for (const [key, def] of Object.entries(rules.buildingTypes || {})) {
                if (!def.name) warnings.push(`建筑 ${key} 缺少 name`);
                if (!def.kind) errors.push(`建筑 ${key} 缺少 kind`);
                if (!Object.values(this.KIND).includes(def.kind)) {
                    errors.push(`建筑 ${key} 的 kind "${def.kind}" 非法`);
                }
                if (!def.size || def.size < 1) {
                    def.size = 1;   // 兜底
                }

                if (def.kind === 'processor') {
                    if (!def.recipes || Object.keys(def.recipes).length === 0) {
                        errors.push(`加工机 ${key} 没有配方`);
                    }
                    for (const [rkey, r] of Object.entries(def.recipes || {})) {
                        for (const item of Object.keys(r.input || {})) {
                            if (!resourceKeys.has(item)) {
                                errors.push(`配方 ${key}.${rkey} 的输入资源 "${item}" 未声明`);
                            }
                        }
                        for (const item of Object.keys(r.output || {})) {
                            if (!resourceKeys.has(item)) {
                                errors.push(`配方 ${key}.${rkey} 的输出资源 "${item}" 未声明`);
                            }
                        }
                    }
                }

                if (def.kind === 'power') {
                    if (def.fuelType && !resourceKeys.has(def.fuelType)) {
                        errors.push(`发电机 ${key} 的燃料 "${def.fuelType}" 未声明`);
                    }
                }

                if (def.kind === 'storage') {
                    for (const item of Object.keys(def.capacity || {})) {
                        if (!resourceKeys.has(item)) {
                            warnings.push(`仓库 ${key} 声明了未定义资源 "${item}" 的容量`);
                        }
                    }
                }
            }

            return { ok: errors.length === 0, errors, warnings };
        },

        // ============================================================
        // 工具
        // ============================================================
        isInside(f, x, y) {
            return x >= 0 && x < f.width && y >= 0 && y < f.height;
        },

        // 判断建筑能否放在 (x, y)
        canPlace(f, x, y, size) {
            for (let dy = 0; dy < size; dy++) {
                for (let dx = 0; dx < size; dx++) {
                    const cx = x + dx, cy = y + dy;
                    if (!this.isInside(f, cx, cy)) return false;
                    const cell = f.cells[cy][cx];
                    if (cell.building || cell.occupiedBy) return false;
                }
            }
            return true;
        },

        // 在网格上写入建筑占位
        markBuilding(f, bld) {
            const size = bld.size || 1;
            for (let dy = 0; dy < size; dy++) {
                for (let dx = 0; dx < size; dx++) {
                    const cell = f.cells[bld.y + dy][bld.x + dx];
                    if (dx === 0 && dy === 0) {
                        cell.building = {
                            id: bld.id, type: bld.type,
                            x: bld.x, y: bld.y, size,
                        };
                    } else {
                        cell.occupiedBy = bld.id;
                        cell.occupiedOffset = { dx, dy };
                    }
                }
            }
        },

        // 从网格上清除建筑占位
        clearBuilding(f, bld) {
            const size = bld.size || 1;
            for (let dy = 0; dy < size; dy++) {
                for (let dx = 0; dx < size; dx++) {
                    const cell = f.cells[bld.y + dy]?.[bld.x + dx];
                    if (!cell) continue;
                    cell.building = null;
                    cell.occupiedBy = null;
                    cell.occupiedOffset = null;
                }
            }
        },
    };

    window.FactorySchema = FactorySchema;
    console.log('[CinemaWorld] factory-schema.js 已加载');
})();