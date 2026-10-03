// ============================================================
// CinemaWorld · map-plot.js
// 玩法区（Plot）：区域级经营单元
//   - 划地：三点定框（起点 → 定宽 → 定高 → 确认）
//   - 配置：rules / shop 直接存在 plot 上，创建后由 AI 生成或套用模板
//   - 模板：MapPlotTemplate（从已有地块"另存为模板"）
//   - 渲染：离屏缓存作物层 + 边框 + 徽章 + 名称 + 状态指示
//
// 依赖：map-canvas.js, ui.js
//
// 暴露：window.MapPlotManager, window.MapPlotTemplate
// ============================================================

(function () {
    'use strict';

    // ============================================================
    // 模板库
    // ============================================================
    const MapPlotTemplate = {
        // 内置模板
        BUILTIN: {
            'tpl_village_wheat': {
                name: '村庄麦田',
                type: 'farm',
                emoji: '🌾',
                color: 'rgba(120,200,120,0.30)',
                description: '一个平和的农耕配置，适合村庄与郊野',
                rules: {
                    env: {
                        moisture: { key: 'moisture', label: '湿度', emoji: '💧', default: 60, decay: -2, min: 0, max: 100 },
                        fertility: { key: 'fertility', label: '肥力', emoji: '🌱', default: 80, decay: 0, min: 0, max: 100 },
                    },
                    actions: {
                        water: { key: 'water', name: '浇水', emoji: '💧', cost: { 体力: 3 }, effect: { moisture: +40 } },
                        fertilize: { key: 'fertilize', name: '施肥', emoji: '🌱', cost: { 体力: 5, 金钱: 3 }, effect: { fertility: +30 } },
                        till: { key: 'till', name: '松土', emoji: '⛏️', cost: { 体力: 4 }, effect: { moisture: +10, fertility: +5 } },
                    },
                    crops: {
                        wheat: {
                            id: 'wheat', name: '小麦', emoji: '🌾',
                            cost: { 金钱: 1 }, growHours: 72,
                            envReq: { moisture: { min: 40, max: 90 }, fertility: { min: 30 } },
                            yield: { item: '小麦', count: 3 },
                            stages: ['🌱', '🌿', '🌾'],
                        },
                        corn: {
                            id: 'corn', name: '玉米', emoji: '🌽',
                            cost: { 金钱: 2 }, growHours: 96,
                            envReq: { moisture: { min: 50, max: 90 }, fertility: { min: 40 } },
                            yield: { item: '玉米', count: 5 },
                            stages: ['🌱', '🌿', '🌽'],
                        },
                    },
                    products: {
                        '小麦': {
                            name: '小麦', icon: '🌾', description: '金黄饱满的麦粒',
                            type: 'item', stackable: true, maxStack: 99,
                            fields: { '类型': '材料', '可堆叠': '是', '最大堆叠': '99', '货币种类': '金钱', '买价': '2', '卖价': '3' },
                        },
                        '玉米': {
                            name: '玉米', icon: '🌽', description: '饱满的玉米棒',
                            type: 'item', stackable: true, maxStack: 99,
                            fields: { '类型': '材料', '可堆叠': '是', '最大堆叠': '99', '货币种类': '金钱', '买价': '4', '卖价': '5' },
                        },
                    },
                    envRules: [
                        { when: { key: '天气', op: 'contains', value: '雨' }, effects: [{ type: 'fieldDelta', field: 'moisture', value: +30 }] },
                    ],
                },
                shop: {
                    name: '村庄杂货铺',
                    emoji: '🏪',
                    items: [
                        { id: 'well_water', name: '井水', icon: '💧', description: '新鲜的井水', price: 2, stock: 20, maxStock: 20, restockInterval: 6, effect: { type: 'env', target: 'moisture', value: 30 } },
                        { id: 'rough_fert', name: '粗肥', icon: '🌱', description: '农田常用的肥料', price: 5, stock: 10, maxStock: 10, restockInterval: 24, effect: { type: 'env', target: 'fertility', value: 30 } },
                        { id: 'tea_snack', name: '茶点', icon: '🍵', description: '农人自制的茶点', price: 8, stock: 5, maxStock: 5, restockInterval: 24, effect: { type: 'recover', target: '体力', value: 50 } },
                        { id: 'spirit_spring', name: '灵泉水', icon: '✨', description: '据说能让庄稼长得更快', price: 30, stock: 2, maxStock: 2, restockInterval: 72, effect: { type: 'speed', multiplier: 2, duration: 6 } },
                    ],
                },
            },
        },

        // localStorage 独立存储 key
        LS_KEY: '__cw_plot_templates',

        // ============================================================
        // 初始化（兼容老代码调用，实际逻辑在 _ensureInit）
        // ============================================================
        init() {
            this._ensureInit();
            const count = Object.keys(window.CinemaWorld?.worldState?._plotTemplates || {}).length;
            console.log('[PlotTemplate] 已初始化，模板数:', count);
        },

        // ============================================================
        // 确保 worldState 里有 _plotTemplates，并从 localStorage 补齐
        // ============================================================
        _ensureInit() {
            const ws = window.CinemaWorld?.worldState;
            if (!ws) return;

            if (!ws._plotTemplates || typeof ws._plotTemplates !== 'object') {
                ws._plotTemplates = {};
            }

            // 从 localStorage 读
            let stored = {};
            try {
                const raw = localStorage.getItem(this.LS_KEY);
                if (raw) stored = JSON.parse(raw) || {};
            } catch (e) { /* 忽略 */ }

            // 补齐：worldState 里没有的，从 localStorage 拉过来
            for (const [id, tpl] of Object.entries(stored)) {
                if (!ws._plotTemplates[id]) {
                    ws._plotTemplates[id] = tpl;
                }
            }

            // 内置模板永远补齐
            for (const [id, def] of Object.entries(this.BUILTIN)) {
                if (!ws._plotTemplates[id]) {
                    ws._plotTemplates[id] = { ...def, id, source: 'builtin', createdAt: Date.now() };
                }
            }
        },

        // ============================================================
        // 把自定义模板写进 localStorage（内置不写，反正每次会补）
        // ============================================================
        _persistToLocalStorage() {
            try {
                const ws = window.CinemaWorld?.worldState;
                if (!ws?._plotTemplates) return;

                const custom = {};
                for (const [id, tpl] of Object.entries(ws._plotTemplates)) {
                    if (tpl.source !== 'builtin') {
                        custom[id] = tpl;
                    }
                }
                localStorage.setItem(this.LS_KEY, JSON.stringify(custom));
            } catch (e) {
                console.warn('[PlotTemplate] localStorage 保存失败:', e);
            }
        },

        // ============================================================
        // 查询
        // ============================================================
        get(id) {
            this._ensureInit();
            return window.CinemaWorld?.worldState?._plotTemplates?.[id] || null;
        },

        list() {
            this._ensureInit();
            return Object.values(window.CinemaWorld?.worldState?._plotTemplates || {});
        },

        listByType(type) {
            return this.list().filter(t => t.type === type);
        },

        // ============================================================
        // 注册
        // ============================================================
        register(tpl) {
            this._ensureInit();

            if (!tpl.id) {
                tpl.id = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            }

            const ws = window.CinemaWorld?.worldState;
            if (!ws) {
                console.error('[PlotTemplate] CinemaWorld.worldState 不存在');
                return null;
            }

            if (!ws._plotTemplates) ws._plotTemplates = {};
            ws._plotTemplates[tpl.id] = tpl;

            // ★ 同步到 localStorage
            this._persistToLocalStorage();

            return tpl.id;
        },

        // ============================================================
        // 删除
        // ============================================================
        delete(id) {
            this._ensureInit();

            const ws = window.CinemaWorld?.worldState;
            if (ws?._plotTemplates) {
                delete ws._plotTemplates[id];
                this._persistToLocalStorage();
            }
            return { ok: true };
        },

        // ============================================================
        // 清空（重置世界时调）
        // ============================================================
        clearCustom() {
            try {
                localStorage.removeItem(this.LS_KEY);
            } catch (e) { /* 忽略 */ }

            const ws = window.CinemaWorld?.worldState;
            if (ws?._plotTemplates) {
                // 只保留 builtin
                const builtin = {};
                for (const [id, tpl] of Object.entries(ws._plotTemplates)) {
                    if (tpl.source === 'builtin') builtin[id] = tpl;
                }
                ws._plotTemplates = builtin;
            }
        },
    };

    // ============================================================
    // Plot 主体
    // ============================================================
    const MapPlotManager = {
        _selectMode: {
            active: false, stage: 'idle',
            p1: null, p2: null, p3: null,
            hoverX: null, hoverY: null,
        },

        _selectedPlotId: null,

        _plotCacheCanvas: null,
        _plotCacheDirty: true,

        // ============================================================
        // 初始化
        // ============================================================
        init() {
            MapPlotTemplate.init();

            window.addEventListener('cw:map-closed', () => {
                this.cancelSelection();
                this._hideInfoCard();
                this._plotCacheDirty = true;
            });

            console.log('[MapPlot] 已初始化');
        },

        // ============================================================
        // 划地模式
        // ============================================================
        enterSelectMode() {
            const map = window.MapLauncher?.getMap?.();
            if (!map?._generated) {
                window.UIManager?.showText?.('请先打开地图', 1500);
                return;
            }

            this._selectMode = {
                active: true, stage: 'p1',
                p1: null, p2: null, p3: null,
                hoverX: null, hoverY: null,
            };

            window.MapLauncher?._closeSubPanel?.();
            this._hideInfoCard();
            this._showHint();

            const canvas = window.MapCanvas?.canvas;
            if (canvas) canvas.style.cursor = 'crosshair';
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
        },

        cancelSelection() {
            this._selectMode = {
                active: false, stage: 'idle',
                p1: null, p2: null, p3: null,
                hoverX: null, hoverY: null,
            };
            this._hideHint();
            const canvas = window.MapCanvas?.canvas;
            if (canvas) canvas.style.cursor = 'pointer';
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
        },

        onMouseMove(gx, gy) {
            if (!this._selectMode.active) return false;
            this._selectMode.hoverX = gx;
            this._selectMode.hoverY = gy;
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            return true;
        },

        onMouseLeave() {
            if (!this._selectMode.active) return;
            this._selectMode.hoverX = null;
            this._selectMode.hoverY = null;
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
        },

        onClick(gx, gy) {
            if (!this._selectMode.active) return false;
            const sm = this._selectMode;

            if (sm.stage === 'p1') {
                sm.p1 = { x: gx, y: gy };
                sm.stage = 'p2';
                this._updateHint();
                window.UIManager?.showText?.('已选起点，点击第二格确定长度', 1800);
                if (window.MapCanvas?.canvas) window.MapCanvas._render();
                return true;
            }

            if (sm.stage === 'p2') {
                const w = Math.abs(gx - sm.p1.x) + 1;
                if (w < 2) { window.UIManager?.showText?.('长度至少 2 格', 1500); return true; }
                sm.p2 = { x: gx, y: sm.p1.y };
                sm.stage = 'p3';
                this._updateHint();
                window.UIManager?.showText?.(`长度 ${w} 格，点击第三格确定宽度`, 1800);
                if (window.MapCanvas?.canvas) window.MapCanvas._render();
                return true;
            }

            if (sm.stage === 'p3') {
                const h = Math.abs(gy - sm.p1.y) + 1;
                if (h < 2) { window.UIManager?.showText?.('宽度至少 2 格', 1500); return true; }
                sm.p3 = { x: sm.p1.x, y: gy };
                sm.stage = 'p4';
                this._updateHint();
                const w = Math.abs(sm.p2.x - sm.p1.x) + 1;
                window.UIManager?.showText?.(`已选 ${w}×${h}，再点一次确认`, 2000);
                if (window.MapCanvas?.canvas) window.MapCanvas._render();
                return true;
            }

            if (sm.stage === 'p4') {
                this._openCreateDialog();
                return true;
            }

            return false;
        },

        onMouseDown() { return false; },
        onMouseUp() { return false; },

        _showHint() {
            this._hideHint();
            const el = document.createElement('div');
            el.id = 'cw-plot-select-hint';
            el.className = 'cw-plot-hint';
            document.body.appendChild(el);
            this._updateHint();
        },

        _updateHint() {
            const el = document.getElementById('cw-plot-select-hint');
            if (!el) return;
            const sm = this._selectMode;
            let text = '';

            if (sm.stage === 'p1') text = '点击第一格：选择矩形起点';
            else if (sm.stage === 'p2') {
                const w = sm.hoverX !== null ? Math.abs(sm.hoverX - sm.p1.x) + 1 : 1;
                text = `点击第二格：确定长度（当前 ${w} 格）`;
            } else if (sm.stage === 'p3') {
                const w = Math.abs(sm.p2.x - sm.p1.x) + 1;
                const h = sm.hoverY !== null ? Math.abs(sm.hoverY - sm.p1.y) + 1 : 1;
                text = `点击第三格：确定宽度（${w} × ${h}）`;
            } else if (sm.stage === 'p4') {
                const w = Math.abs(sm.p2.x - sm.p1.x) + 1;
                const h = Math.abs(sm.p3.y - sm.p1.y) + 1;
                text = `已选 ${w} × ${h}，点击第四格确认创建`;
            }

            el.innerHTML = `
                <span style="margin-right:8px;font-size:16px;">📐</span>
                <span>${text}</span>
                <button onclick="MapPlotManager.cancelSelection()"
                    style="margin-left:12px;padding:4px 10px;background:rgba(255,255,255,.15);
                    border:none;border-radius:6px;color:#fff;cursor:pointer;font-size:12px;
                    font-family:inherit;">取消</button>`;
        },

        _hideHint() {
            document.getElementById('cw-plot-select-hint')?.remove();
        },

        _computeBounds() {
            const sm = this._selectMode;
            if (!sm.p1) return null;
            const p2x = sm.p2 ? sm.p2.x : sm.p1.x;
            const p3y = sm.p3 ? sm.p3.y : sm.p1.y;
            const x1 = Math.min(sm.p1.x, p2x);
            const x2 = Math.max(sm.p1.x, p2x);
            const y1 = Math.min(sm.p1.y, p3y);
            const y2 = Math.max(sm.p1.y, p3y);
            return { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
        },

        // ============================================================
        // 创建对话框
        // ============================================================
        _openCreateDialog() {
            const bounds = this._computeBounds();
            if (!bounds) return;

            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            const templates = MapPlotTemplate.listByType('farm');

            let tplSelectHTML = '';
            if (templates.length > 0) {
                tplSelectHTML = `
                    <div id="cw-plot-template-wrap" style="display:none;margin-top:8px;">
                        <select id="cw-plot-template" class="cinemaworld-textarea"
                            style="padding:10px 12px;min-height:auto;width:100%;">
                            ${templates.map(t => `<option value="${t.id}">${t.emoji || '📐'} ${t.name}</option>`).join('')}
                        </select>
                    </div>`;
            }

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📐 划定玩法区</div>
                <div style="font-size:13px;color:#aaa;line-height:1.7;margin-bottom:14px;
                    padding:12px;background:rgba(120,150,255,.08);border-radius:10px;">
                    范围：<b>${bounds.w} × ${bounds.h}</b> 格
                </div>

                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:6px;">名称</div>
                    <input type="text" id="cw-plot-name" class="cinemaworld-textarea"
                        placeholder="例如：老王家的田"
                        style="min-height:auto;padding:10px 14px;width:100%;box-sizing:border-box;">
                </div>

                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:6px;">备注（可选）</div>
                    <textarea id="cw-plot-notes" class="cinemaworld-textarea"
                        placeholder="这块地的故事、归属..."
                        style="min-height:60px;"></textarea>
                </div>

                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:6px;">配置方式</div>
                    <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;
                        background:rgba(255,255,255,.04);border-radius:8px;cursor:pointer;
                        border:1px solid rgba(120,150,255,.25);margin-bottom:6px;">
                        <input type="radio" name="cw-plot-mode" value="ai" checked>
                        <span style="font-size:20px;">🤖</span>
                        <div style="flex:1;">
                            <div style="font-size:13px;color:#fff;font-weight:600;">AI 生成</div>
                            <div style="font-size:11px;color:#888;">创建后立刻让 AI 生成配置</div>
                        </div>
                    </label>
                    ${templates.length > 0 ? `
                    <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;
                        background:rgba(255,255,255,.04);border-radius:8px;cursor:pointer;
                        border:1px solid rgba(255,255,255,.08);">
                        <input type="radio" name="cw-plot-mode" value="template">
                        <span style="font-size:20px;">📦</span>
                        <div style="flex:1;">
                            <div style="font-size:13px;color:#fff;font-weight:600;">使用模板</div>
                            <div style="font-size:11px;color:#888;">从已有模板复制配置</div>
                        </div>
                    </label>
                    ${tplSelectHTML}
                    ` : ''}
                </div>

                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:6px;">
                        额外要求（可选，AI 生成时用）
                    </div>
                    <textarea id="cw-plot-guide" class="cinemaworld-textarea"
                        placeholder="例如：种小麦和玉米的普通农田"
                        style="min-height:60px;"></textarea>
                </div>

                <div style="text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="MapPlotManager._confirmCreate()">
                        ✅ 创建
                    </button>
                    <button class="cinemaworld-button" onclick="MapPlotManager.cancelSelection()">
                        取消
                    </button>
                </div>`;

            // 监听模式切换
            modal.querySelectorAll('input[name="cw-plot-mode"]').forEach(r => {
                r.addEventListener('change', () => {
                    const wrap = document.getElementById('cw-plot-template-wrap');
                    if (wrap) wrap.style.display = r.value === 'template' && r.checked ? 'block' : 'none';
                });
            });

            modal.className = 'active';
        },

        _confirmCreate() {
            const bounds = this._computeBounds();
            if (!bounds) return;

            const name = document.getElementById('cw-plot-name')?.value.trim() || '未命名玩法区';
            const notes = document.getElementById('cw-plot-notes')?.value.trim() || '';
            const modeRadio = document.querySelector('input[name="cw-plot-mode"]:checked');
            const mode = modeRadio?.value || 'ai';
            const guide = document.getElementById('cw-plot-guide')?.value.trim() || '';
            const templateId = mode === 'template'
                ? document.getElementById('cw-plot-template')?.value
                : null;

            const plot = this._createPlot({
                name, type: 'farm', notes, bounds,
                templateId,
            });

            window.UIManager.closeModal();
            this.cancelSelection();

            if (plot) {
                // ★ 新建的 plot 一定要清空商店状态（防止 id 撞车）
                plot.shopState = null;

                setTimeout(() => {
                    window.MapFarmUI?.open?.(plot.id);
                }, 300);
            }
        },

        // ============================================================
        // 创建 Plot
        // ============================================================
        _createPlot({ name, type, notes, bounds, templateId }) {
            const map = window.MapLauncher?.getMap?.();
            if (!map?._generated) return null;

            map._plots = map._plots || {};

            const id = `plot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const now = this._readTotalMinutes(map);

            const plot = {
                id, name, type, notes, bounds,
                regionId: this._inferRegion(map, bounds),
                createdAt: now,

                rules: null,
                shop: null,
                emoji: '🌾',
                color: 'rgba(120,200,120,0.30)',

                env: { _order: [] },
                status: 'idle',
                cropId: null,
                progress: 0,
                lastTickAt: now,
                log: [],
                objects: [],
                shopState: null,
            };

            // 用模板 → 复制
            if (templateId) {
                const tpl = MapPlotTemplate.get(templateId);
                if (tpl) {
                    plot.rules = JSON.parse(JSON.stringify(tpl.rules));
                    plot.shop = JSON.parse(JSON.stringify(tpl.shop));
                    plot.emoji = tpl.emoji || '🌾';
                    plot.color = tpl.color || 'rgba(120,200,120,0.30)';
                    this._initEnvFromRules(plot);
                    plot.shopState = null;
                }
            }

            map._plots[id] = plot;
            this._applyPlotToGrid(map, plot);
            this.markDirty();

            window.MapLauncher?._saveMapToWorld?.(map);
            if (window.SaveManager) window.SaveManager.save();

            console.log(`[MapPlot] 已创建：${name}`);
            window.UIManager?.showText?.(`📐 已创建「${name}」`, 2000);

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            return plot;
        },

        _initEnvFromRules(plot) {
            plot.env = { _order: [] };
            if (!plot.rules?.env) return;
            for (const [key, def] of Object.entries(plot.rules.env)) {
                const v = (typeof def.default === 'number') ? def.default : 0;
                const min = (typeof def.min === 'number') ? def.min : 0;
                const max = (typeof def.max === 'number') ? def.max : 100;
                plot.env[key] = Math.max(min, Math.min(max, v));
                plot.env._order.push(key);
            }
        },

        _inferRegion(map, bounds) {
            const cx = bounds.x + Math.floor(bounds.w / 2);
            const cy = bounds.y + Math.floor(bounds.h / 2);
            const cell = map._generated?.grid?.[cy]?.[cx];
            return cell?.regionId || map.startRegion;
        },

        _applyPlotToGrid(map, plot) {
            const grid = map._generated?.grid;
            if (!grid) return;
            const { x, y, w, h } = plot.bounds;
            for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                    const cell = grid[y + dy]?.[x + dx];
                    if (!cell) continue;
                    if (cell.terrain === 'void') continue;
                    if (cell.portal) continue;
                    cell.plotId = plot.id;
                }
            }
        },

        // ============================================================
        // 删除 Plot
        // ============================================================
        deletePlot(plotId) {
            const map = window.MapLauncher?.getMap?.();
            if (!map?._plots?.[plotId]) {
                console.warn('[MapPlot] 目标 plot 不存在:', plotId);
                return;
            }
        
            const plot = map._plots[plotId];
        
            // ★ 二次确认（带名字）
            if (!confirm(`确定删除玩法区「${plot.name}」吗？\n\n这会清除：\n- 该地块的作物\n- 配置的规则和商店\n- 该地块上的所有数据\n\n此操作不可撤销。`)) {
                return;
            }
        
            // 1. 从 grid 清掉 plotId
            const grid = map._generated?.grid;
            if (grid) {
                const { x, y, w, h } = plot.bounds;
                for (let dy = 0; dy < h; dy++) {
                    for (let dx = 0; dx < w; dx++) {
                        const cell = grid[y + dy]?.[x + dx];
                        if (cell && cell.plotId === plotId) {
                            delete cell.plotId;
                        }
                    }
                }
            }
        
            // 2. 从 map._plots 移除
            delete map._plots[plotId];
        
            // 3. 清缓存
            this.markDirty();
        
            // 4. 写回世界仓库
            window.MapLauncher?._saveMapToWorld?.(map);
            if (window.SaveManager) window.SaveManager.save();
        
            // 5. 关面板
            this._selectedPlotId = null;
            this._hideInfoCard();
        
            // 6. 提示 + 重绘
            window.UIManager?.showText?.(`🗑️ 已删除「${plot.name}」`, 1800);
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
        
            console.log(`[MapPlot] 已删除 plot: ${plotId}`);
        },

        // ============================================================
        // 选中 / 信息卡
        // ============================================================
        selectPlot(plotId) {
            this._selectedPlotId = (this._selectedPlotId === plotId) ? null : plotId;
            if (window.MapCanvas?.canvas) window.MapCanvas._render();

            if (this._selectedPlotId) this._showInfoCard(this._selectedPlotId);
            else this._hideInfoCard();
        },

        _showInfoCard(plotId) {
            this._hideInfoCard();
            const map = window.MapLauncher?.getMap?.();
            const plot = map?._plots?.[plotId];
            if (!plot) return;
        
            const { x, y, w, h } = plot.bounds;
            const el = document.createElement('div');
            el.id = 'cw-plot-info-card';
            el.className = 'cw-plot-info-card';
        
            const statusText = {
                idle: '空地', growing: '生长中', ready: '可收获', dead: '荒废',
            }[plot.status] || plot.status;
        
            const configured = !!plot.rules;
        
            el.innerHTML = `
                <div class="cw-plot-info-header">
                    <span class="cw-plot-info-emoji">${plot.emoji || '🌾'}</span>
                    <span class="cw-plot-info-name">${this._esc(plot.name)}</span>
                    <button class="cw-plot-info-close" onclick="MapPlotManager.selectPlot(null)">✕</button>
                </div>
                <div class="cw-plot-info-body">
                    <div class="cw-plot-info-row"><span>范围</span><span>${w} × ${h}</span></div>
                    <div class="cw-plot-info-row"><span>状态</span><span>${configured ? statusText : '未配置'}</span></div>
                    ${plot.notes ? `<div class="cw-plot-info-notes">${this._esc(plot.notes)}</div>` : ''}
                </div>
                <div class="cw-plot-info-actions">
                    <button onclick="MapPlotManager._focusPlot('${plotId}')">📍 定位</button>
                    <button onclick="UIManager.closeModal(); MapFarmUI.open('${plotId}')">
                        ${configured ? '🌱 进入' : '⚙️ 配置'}
                    </button>
                    <button class="danger" onclick="MapPlotManager.deletePlot('${plotId}')">🗑️ 删除</button>
                </div>`;
            document.body.appendChild(el);
        },

        _hideInfoCard() {
            document.getElementById('cw-plot-info-card')?.remove();
        },

        _focusPlot(plotId) {
            const map = window.MapLauncher?.getMap?.();
            const plot = map?._plots?.[plotId];
            if (!plot) return;
            const { x, y, w, h } = plot.bounds;
            if (window.MapCanvas) {
                const viewW = window.MapCanvas._cssW / window.MapCanvas.config.tileSize;
                const viewH = window.MapCanvas._cssH / window.MapCanvas.config.tileSize;
                window.MapCanvas.camera.x = Math.max(0, (x + w / 2) - viewW / 2);
                window.MapCanvas.camera.y = Math.max(0, (y + h / 2) - viewH / 2);
                window.MapCanvas._render();
            }
            window.UIManager.closeModal();
        },

        // ============================================================
        // 列表
        // ============================================================
        openList() {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;
            const plots = Object.values(map._plots || {});
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;
        
            let html = `<div class="cinemaworld-modal-title">📐 玩法区列表</div>
                <div style="font-size:12px;color:#888;text-align:center;margin-bottom:14px;">
                    共 ${plots.length} 个玩法区
                </div>`;
        
            if (plots.length === 0) {
                html += `<div style="text-align:center;padding:40px 20px;color:#666;font-size:14px;">
                    还没有划定的玩法区。<br>
                    <span style="font-size:12px;">点击「📐 划新地」开始圈一块地。</span>
                </div>`;
            } else {
                html += `<div style="display:grid;gap:10px;max-height:60vh;overflow-y:auto;">`;
                for (const plot of plots) {
                    const { w, h } = plot.bounds;
                    const configured = !!plot.rules;
                    html += `
                        <div class="cw-plot-card" style="display:flex;align-items:center;gap:12px;">
                            <div style="flex:1;display:flex;align-items:center;gap:12px;cursor:pointer;"
                                onclick="UIManager.closeModal(); MapPlotManager._focusPlot('${plot.id}'); MapPlotManager.selectPlot('${plot.id}');">
                                <div style="font-size:28px;">${plot.emoji || '🌾'}</div>
                                <div style="flex:1;min-width:0;">
                                    <div style="font-size:14px;color:#fff;font-weight:600;">${this._esc(plot.name)}</div>
                                    <div style="font-size:11px;color:#888;margin-top:3px;">
                                        ${w}×${h} · ${configured ? '已配置' : '<span style="color:#ffd76b;">未配置</span>'}
                                    </div>
                                </div>
                            </div>
                            <button class="cinemaworld-button" style="padding:6px 10px;font-size:12px;color:#d87d7d;"
                                onclick="event.stopPropagation(); MapPlotManager.deletePlot('${plot.id}'); MapPlotManager.openList();">
                                🗑️
                            </button>
                        </div>`;
                }
                html += `</div>`;
            }
        
            html += `
                <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="UIManager.closeModal(); MapPlotManager.enterSelectMode();">
                        📐 划新地
                    </button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal(); MapPlotTemplateUI.open();">
                        📦 模板库
                    </button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
        
            modal.className = 'active';
            modal.innerHTML = html;
        },

        // ============================================================
        // 缓存
        // ============================================================
        markDirty() {
            this._plotCacheDirty = true;
        },

        _bakePlotLayer(map) {
            if (!map?._generated) return;

            const BASE_TS = 64;   // ★ 固定基准，与运行时 tileSize 解耦
            const mapW = map._generated.width;
            const mapH = map._generated.height;
            const w = mapW * BASE_TS;
            const h = mapH * BASE_TS;

            if (!this._plotCacheCanvas
                || this._plotCacheCanvas.width !== w
                || this._plotCacheCanvas.height !== h) {
                this._plotCacheCanvas = document.createElement('canvas');
                this._plotCacheCanvas.width = w;
                this._plotCacheCanvas.height = h;
            }

            const ctx = this._plotCacheCanvas.getContext('2d');
            ctx.clearRect(0, 0, w, h);

            for (const plot of Object.values(map._plots || {})) {
                this._drawPlotCropsToCache(ctx, plot, BASE_TS);   // ★ 用 BASE_TS
            }

            this._plotCacheDirty = false;
        },

        _drawPlotCropsToCache(ctx, plot, tileSize) {
            const { x, y, w, h } = plot.bounds;

            // 未配置 / 未种植 → 耕地底色
            if (!plot.rules || plot.status === 'idle' || plot.status === 'dead') {
                const idleColor = plot.status === 'dead'
                    ? 'rgba(80, 50, 30, 0.55)'
                    : (plot.rules ? 'rgba(139, 90, 43, 0.35)' : 'rgba(100, 100, 100, 0.2)');
                ctx.fillStyle = idleColor;
                for (let dy = 0; dy < h; dy++) {
                    for (let dx = 0; dx < w; dx++) {
                        ctx.fillRect(
                            (x + dx) * tileSize + 2,
                            (y + dy) * tileSize + 2,
                            tileSize - 4, tileSize - 4
                        );
                    }
                }
                return;
            }

            const crop = plot.rules.crops?.[plot.cropId];
            if (!crop) return;

            const stages = (crop.stages && crop.stages.length)
                ? crop.stages
                : [crop.emoji || '🌱'];

            let stageIdx;
            if (plot.status === 'ready') {
                stageIdx = stages.length - 1;
            } else {
                stageIdx = Math.min(
                    Math.floor((plot.progress || 0) * stages.length),
                    stages.length - 1
                );
            }
            const icon = stages[stageIdx];

            ctx.fillStyle = 'rgba(139, 90, 43, 0.30)';
            for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                    ctx.fillRect(
                        (x + dx) * tileSize + 2,
                        (y + dy) * tileSize + 2,
                        tileSize - 4, tileSize - 4
                    );
                }
            }

            ctx.font = `${Math.floor(tileSize * 0.55)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = plot.status === 'ready' ? 1 : 0.9;
            for (let dy = 0; dy < h; dy++) {
                for (let dx = 0; dx < w; dx++) {
                    const cx = (x + dx) * tileSize + tileSize / 2;
                    const cy = (y + dy) * tileSize + tileSize / 2;
                    ctx.fillText(icon, cx, cy);
                }
            }
            ctx.globalAlpha = 1;

            if (plot.status === 'ready') {
                ctx.save();
                ctx.globalAlpha = 0.15;
                ctx.fillStyle = '#ffd76b';
                for (let dy = 0; dy < h; dy++) {
                    for (let dx = 0; dx < w; dx++) {
                        ctx.fillRect((x + dx) * tileSize, (y + dy) * tileSize, tileSize, tileSize);
                    }
                }
                ctx.restore();
            }
        },

        // ============================================================
        // 渲染
        // ============================================================
        render(ctx, camera, tileSize, cssW, cssH) {
            const map = window.MapLauncher?.getMap?.();
            const now = performance.now();
        
            if (map?._plots && Object.keys(map._plots).length > 0) {
                if (this._plotCacheDirty) {
                    this._bakePlotLayer(map);   // ★ 不再传 tileSize
                }
                if (this._plotCacheCanvas) {
                    const BASE_TS = 64;
                    const scale = tileSize / BASE_TS;
                    const sx = camera.x * BASE_TS;
                    const sy = camera.y * BASE_TS;
                    const sw = cssW / scale;
                    const sh = cssH / scale;
                    ctx.drawImage(
                        this._plotCacheCanvas,
                        sx, sy, sw, sh,
                        0, 0, cssW, cssH
                    );
                }
            }
        
            if (map?._plots) {
                for (const plot of Object.values(map._plots)) {
                    this._renderPlotOutline(ctx, plot, camera, tileSize, cssW, cssH, now);
                }
            }
        
            if (this._selectMode.active) {
                this._renderSelectPreview(ctx, camera, tileSize, now);
            }
        },

        _renderPlotOutline(ctx, plot, camera, tileSize, cssW, cssH, now) {
            const { x, y, w, h } = plot.bounds;
            const dx = (x - camera.x) * tileSize;
            const dy = (y - camera.y) * tileSize;
            const dw = w * tileSize;
            const dh = h * tileSize;

            if (dx + dw < -tileSize || dx > cssW + tileSize) return;
            if (dy + dh < -tileSize || dy > cssH + tileSize) return;

            const color = plot.color || 'rgba(120,200,120,0.30)';
            const isSelected = this._selectedPlotId === plot.id;
            const configured = !!plot.rules;

            ctx.save();

            // 未配置 → 灰色虚线边框
            ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.15)');
            ctx.fillRect(dx, dy, dw, dh);

            if (configured) {
                ctx.strokeStyle = color.replace(/[\d.]+\)$/, isSelected ? '1)' : '0.85)');
                ctx.lineWidth = isSelected ? 3 : 2;
                if (isSelected) {
                    ctx.setLineDash([]);
                    ctx.shadowColor = color.replace(/[\d.]+\)$/, '0.8)');
                    ctx.shadowBlur = 12;
                } else {
                    ctx.setLineDash([8, 4]);
                }
            } else {
                // 未配置 → 灰白虚线
                ctx.strokeStyle = isSelected
                    ? 'rgba(255,255,255,0.9)'
                    : 'rgba(200,200,200,0.6)';
                ctx.lineWidth = isSelected ? 3 : 2;
                ctx.setLineDash([6, 4]);
            }

            ctx.strokeRect(dx, dy, dw, dh);
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;

            // 四角
            const cs = Math.min(tileSize * 0.5, dw * 0.15, dh * 0.15);
            ctx.fillStyle = configured
                ? color.replace(/[\d.]+\)$/, '0.95)')
                : 'rgba(200,200,200,0.7)';
            const corners = [[dx, dy, 1, 1], [dx + dw, dy, -1, 1], [dx, dy + dh, 1, -1], [dx + dw, dy + dh, -1, -1]];
            for (const [cx, cy, sx, sy] of corners) {
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + cs * sx, cy);
                ctx.lineTo(cx, cy + cs * sy);
                ctx.closePath();
                ctx.fill();
            }

            // 徽章
            const badge = Math.floor(tileSize * 0.7);
            const bx = dx + 6, by = dy + 6;
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(bx, by, badge, badge, 8);
                ctx.fill();
            } else {
                ctx.fillRect(bx, by, badge, badge);
            }
            ctx.strokeStyle = configured
                ? color.replace(/[\d.]+\)$/, '1)')
                : 'rgba(200,200,200,0.8)';
            ctx.lineWidth = 2;
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(bx, by, badge, badge, 8);
                ctx.stroke();
            } else {
                ctx.strokeRect(bx, by, badge, badge);
            }

            ctx.font = `${Math.floor(badge * 0.6)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(configured ? (plot.emoji || '🌾') : '❓', bx + badge / 2, by + badge / 2);

            // 成熟指示
            if (plot.status === 'ready') {
                const pulse = 1 + Math.sin(now / 300) * 0.2;
                const r = tileSize * 0.3 * pulse;
                const cx2 = dx + dw - r - 6;
                const cy2 = dy + r + 6;
                const grad = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, r * 2);
                grad.addColorStop(0, 'rgba(255,220,100,0.95)');
                grad.addColorStop(0.5, 'rgba(255,180,60,0.5)');
                grad.addColorStop(1, 'rgba(255,180,60,0)');
                ctx.beginPath();
                ctx.arc(cx2, cy2, r * 2, 0, Math.PI * 2);
                ctx.fillStyle = grad;
                ctx.fill();
                ctx.font = `${Math.floor(tileSize * 0.5)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
                ctx.fillText('🌾', cx2, cy2);
            }

            // 名称
            if (plot.name) {
                ctx.font = `bold ${Math.floor(tileSize * 0.28)}px sans-serif`;
                const tw = ctx.measureText(plot.name).width;
                const boxW = tw + 12;
                const boxH = tileSize * 0.38;
                const lbx = dx + 6;
                const lby = by + badge + 4;
                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                if (ctx.roundRect) {
                    ctx.beginPath();
                    ctx.roundRect(lbx, lby, boxW, boxH, 4);
                    ctx.fill();
                } else {
                    ctx.fillRect(lbx, lby, boxW, boxH);
                }
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(plot.name, lbx + 6, lby + boxH / 2);
            }

            ctx.restore();
        },

        _renderSelectPreview(ctx, camera, tileSize, now) {
            const sm = this._selectMode;
            const pulse = 0.25 + Math.sin(now / 400) * 0.1;
            const gridToPx = (gx, gy) => ({
                px: (gx - camera.x) * tileSize,
                py: (gy - camera.y) * tileSize,
            });

            if (sm.stage === 'p1') {
                if (sm.hoverX === null) return;
                const { px, py } = gridToPx(sm.hoverX, sm.hoverY);
                ctx.save();
                ctx.strokeStyle = 'rgba(120,150,255,0.95)';
                ctx.lineWidth = 3;
                ctx.setLineDash([6, 4]);
                ctx.strokeRect(px + 2, py + 2, tileSize - 4, tileSize - 4);
                ctx.restore();
                return;
            }

            if (sm.stage === 'p2') {
                if (!sm.p1) return;
                this._drawSelectCell(ctx, sm.p1.x, sm.p1.y, camera, tileSize, 'p1');
                if (sm.hoverX === null) return;
                const x1 = Math.min(sm.p1.x, sm.hoverX);
                const x2 = Math.max(sm.p1.x, sm.hoverX);
                const w = x2 - x1 + 1;
                const { px, py } = gridToPx(x1, sm.p1.y);
                const dw = w * tileSize;
                ctx.save();
                ctx.fillStyle = `rgba(120,150,255,${pulse})`;
                ctx.fillRect(px, py, dw, tileSize);
                ctx.strokeStyle = 'rgba(120,150,255,1)';
                ctx.lineWidth = 3;
                ctx.setLineDash([8, 4]);
                ctx.strokeRect(px, py, dw, tileSize);
                ctx.setLineDash([]);
                ctx.restore();
                this._drawSizeLabel(ctx, px + dw / 2, py - 6, `${w}`, tileSize, 'rgba(60,80,160,0.95)');
                return;
            }

            if (sm.stage === 'p3') {
                if (!sm.p1 || !sm.p2) return;
                this._drawSelectCell(ctx, sm.p1.x, sm.p1.y, camera, tileSize, 'p1');
                this._drawSelectCell(ctx, sm.p2.x, sm.p2.y, camera, tileSize, 'p2');
                const x1 = Math.min(sm.p1.x, sm.p2.x);
                const x2 = Math.max(sm.p1.x, sm.p2.x);
                const w = x2 - x1 + 1;
                const { px, py } = gridToPx(x1, sm.p1.y);
                const dw = w * tileSize;
                ctx.save();
                ctx.strokeStyle = 'rgba(120,150,255,1)';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(px, py + tileSize / 2);
                ctx.lineTo(px + dw, py + tileSize / 2);
                ctx.stroke();
                ctx.restore();
                if (sm.hoverY !== null) {
                    const y1 = Math.min(sm.p1.y, sm.hoverY);
                    const y2 = Math.max(sm.p1.y, sm.hoverY);
                    const h = y2 - y1 + 1;
                    const { px: rpx, py: rpy } = gridToPx(x1, y1);
                    const rdh = h * tileSize;
                    ctx.save();
                    ctx.fillStyle = `rgba(120,150,255,${pulse})`;
                    ctx.fillRect(rpx, rpy, dw, rdh);
                    ctx.strokeStyle = 'rgba(120,150,255,1)';
                    ctx.lineWidth = 3;
                    ctx.setLineDash([8, 4]);
                    ctx.strokeRect(rpx, rpy, dw, rdh);
                    ctx.setLineDash([]);
                    ctx.restore();
                    this._drawSizeLabel(ctx, rpx + dw / 2, rpy - 8, `${w} × ${h}`, tileSize, 'rgba(60,80,160,0.95)');
                }
                return;
            }

            if (sm.stage === 'p4') {
                if (!sm.p1 || !sm.p2 || !sm.p3) return;
                const x1 = Math.min(sm.p1.x, sm.p2.x);
                const x2 = Math.max(sm.p1.x, sm.p2.x);
                const y1 = Math.min(sm.p1.y, sm.p3.y);
                const y2 = Math.max(sm.p1.y, sm.p3.y);
                const w = x2 - x1 + 1;
                const h = y2 - y1 + 1;
                const { px, py } = gridToPx(x1, y1);
                const dw = w * tileSize;
                const dh = h * tileSize;
                ctx.save();
                ctx.fillStyle = `rgba(120,200,120,${pulse})`;
                ctx.fillRect(px, py, dw, dh);
                ctx.strokeStyle = 'rgba(120,200,120,1)';
                ctx.lineWidth = 3;
                ctx.shadowColor = 'rgba(120,200,120,0.8)';
                ctx.shadowBlur = 12;
                ctx.strokeRect(px, py, dw, dh);
                ctx.shadowBlur = 0;
                ctx.restore();
                this._drawSelectCell(ctx, sm.p1.x, sm.p1.y, camera, tileSize, 'p1');
                this._drawSelectCell(ctx, sm.p2.x, sm.p2.y, camera, tileSize, 'p2');
                this._drawSelectCell(ctx, sm.p3.x, sm.p3.y, camera, tileSize, 'p3');
                this._drawSizeLabel(ctx, px + dw / 2, py - 8, `${w} × ${h} · 再点一次确认`, tileSize, 'rgba(60,140,80,0.95)');
            }
        },

        _drawSelectCell(ctx, gx, gy, camera, tileSize, type) {
            const px = (gx - camera.x) * tileSize + tileSize / 2;
            const py = (gy - camera.y) * tileSize + tileSize / 2;
            const colors = {
                p1: { fill: 'rgba(255,200,80,0.95)', ring: 'rgba(255,180,40,1)', label: '1' },
                p2: { fill: 'rgba(120,200,255,0.95)', ring: 'rgba(80,160,255,1)', label: '2' },
                p3: { fill: 'rgba(255,140,200,0.95)', ring: 'rgba(255,100,180,1)', label: '3' },
            };
            const c = colors[type] || colors.p1;
            ctx.save();
            ctx.beginPath();
            ctx.arc(px, py, tileSize * 0.32, 0, Math.PI * 2);
            ctx.fillStyle = c.fill;
            ctx.fill();
            ctx.strokeStyle = c.ring;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.font = `bold ${Math.floor(tileSize * 0.4)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#fff';
            ctx.fillText(c.label, px, py);
            ctx.restore();
        },

        _drawSizeLabel(ctx, cx, cy, text, tileSize, bgColor) {
            ctx.save();
            ctx.font = `bold ${Math.floor(tileSize * 0.32)}px sans-serif`;
            const tw = ctx.measureText(text).width;
            const boxW = tw + 18;
            const boxH = tileSize * 0.46;
            const bx = cx - boxW / 2;
            const by = cy - boxH - 4;
            ctx.fillStyle = bgColor || 'rgba(60,80,160,0.95)';
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(bx, by, boxW, boxH, 6);
                ctx.fill();
            } else {
                ctx.fillRect(bx, by, boxW, boxH);
            }
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, cx, by + boxH / 2);
            ctx.restore();
        },

        // ============================================================
        // 对外 API
        // ============================================================
        getPlotAt(map, x, y) {
            if (!map?._plots) return null;
        
            // 1. 正常路径：cell.plotId
            const cell = map._generated?.grid?.[y]?.[x];
            if (cell?.plotId) {
                const plot = map._plots[cell.plotId];
                if (plot) return plot;
            }
        
            // 2. 兜底：遍历所有 plot，看哪个 bounds 包含 (x, y)
            for (const plot of Object.values(map._plots)) {
                const b = plot.bounds;
                if (!b) continue;
                if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) {
                    // ★ 顺手修复 grid 绑定
                    if (cell && !cell.plotId) {
                        cell.plotId = plot.id;
                    }
                    return plot;
                }
            }
        
            return null;
        },

        getPlotById(plotId) {
            const map = window.MapLauncher?.getMap?.();
            return map?._plots?.[plotId] || null;
        },

        getRuleOf(plot) {
            return plot?.rules || {};
        },

        getShopOf(plot) {
            return plot?.shop || null;
        },

        _readTotalMinutes(map) {
            try {
                if (window.CWEnv?.parseTotalMinutes && window.CWEnv?.ensureEnvData) {
                    const env = window.CWEnv.ensureEnvData(map);
                    const t = window.CWEnv.parseTotalMinutes(env);
                    if (typeof t === 'number') return t;
                }
            } catch (e) { /* 忽略 */ }
            return 0;
        },

        _esc(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        },
    };

    // ============================================================
    // 模板库 UI
    // ============================================================
    const MapPlotTemplateUI = {
        open() {
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            const templates = MapPlotTemplate.list();
            let html = `<div class="cinemaworld-modal-title">📦 模板库</div>
                <div style="font-size:12px;color:#888;text-align:center;margin-bottom:14px;">
                    共 ${templates.length} 个模板
                </div>`;

            if (templates.length === 0) {
                html += `<div style="text-align:center;padding:40px 20px;color:#666;font-size:14px;">
                    还没有保存的模板。<br>
                    <span style="font-size:12px;">在农田面板的「📖 规则」里点「另存为模板」。</span>
                </div>`;
            } else {
                html += `<div style="display:grid;gap:10px;max-height:60vh;overflow-y:auto;">`;
                for (const t of templates) {
                    const cropCount = Object.keys(t.rules?.crops || {}).length;
                    html += `
                        <div class="cw-plot-card" style="cursor:default;">
                            <div style="display:flex;align-items:center;gap:12px;">
                                <div style="font-size:28px;">${t.emoji || '📐'}</div>
                                <div style="flex:1;min-width:0;">
                                    <div style="font-size:14px;color:#fff;font-weight:600;">${this._esc(t.name)}</div>
                                    <div style="font-size:11px;color:#888;margin-top:3px;">
                                        ${t.source === 'builtin' ? '📦 内置' : '💾 自建'} · ${cropCount} 种作物
                                    </div>
                                    ${t.description ? `<div style="font-size:11px;color:#666;margin-top:3px;">${this._esc(t.description)}</div>` : ''}
                                </div>
                                ${t.source === 'builtin' ? '' : `
                                    <button class="cinemaworld-button" style="padding:6px 12px;font-size:12px;color:#d87d7d;"
                                        onclick="MapPlotTemplateUI.deleteTemplate('${t.id}')">🗑️</button>
                                `}
                            </div>
                        </div>`;
                }
                html += `</div>`;
            }

            html += `<div style="text-align:center;margin-top:16px;">
                <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
            </div>`;

            modal.className = 'active';
            modal.innerHTML = html;
        },

        deleteTemplate(id) {
            const t = MapPlotTemplate.get(id);
            if (!t) return;
            if (!confirm(`确定删除模板「${t.name}」吗？`)) return;
            MapPlotTemplate.delete(id);
            window.SaveManager?.save?.();
            this.open();
        },

        _esc(s) {
            return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
    };

    // ============================================================
    // 挂载
    // ============================================================
    window.MapPlotManager = MapPlotManager;
    window.MapPlotTemplate = MapPlotTemplate;
    window.MapPlotTemplateUI = MapPlotTemplateUI;

    function boot() { MapPlotManager.init(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();

    console.log('[CinemaWorld] map-plot.js 已加载');
})();