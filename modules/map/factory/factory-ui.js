// ============================================================
// CinemaWorld · factory-ui.js
// 工厂界面：网格 / 建筑栏 / 详情面板 / 资源面板
//
// ★ 性能模型：
//   - 打开时 tick 一次（补齐 delta）
//   - 界面开着时每分钟 tick 一次
//   - 关闭时最后 tick 一次
//   - 其他工厂不受影响
//
// 依赖：factory-manager.js, factory-gen.js, map-plot.js
// 暴露：window.FactoryUI
// ============================================================

(function () {
    'use strict';

    const FactoryUI = {
        _plotId: null,
        _placingType: null,
        _tickHandler: null,
        _resizeObserver: null,
        _windowResizeHandler: null,
        _modalObserver: null,

        // ============================================================
        // 打开 / 关闭
        // ============================================================
        open(plotId) {
            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot) return;

            if (plot.type !== 'factory') {
                window.UIManager?.showText?.('这不是工厂玩法区', 1500);
                return;
            }

            // ★ 如果之前有打开的工厂 → 先补算它
            if (this._plotId && this._plotId !== plotId) {
                window.FactoryManager?.tickOne?.(this._plotId);
            }

            this._plotId = plotId;
            this._placingType = null;

            // 未配置 → 空状态
            if (!plot.rules || !plot.factory) {
                this._renderEmpty(plot);
                this._initGlobalClose();
                return;
            }

            // ★ 打开时补算到当前时刻
            window.FactoryManager?.tickOne?.(plotId);

            this._render();
            this._initGlobalClose();
            this._startRealtimeTick();
        },

        close() {
            // ★ 停掉实时 tick
            this._stopRealtimeTick();

            // ★ 关闭前最后补算一次（保证存档数据准确）
            if (this._plotId) {
                window.FactoryManager?.tickOne?.(this._plotId);
            }

            // 清理 resize
            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
                this._resizeObserver = null;
            }
            if (this._windowResizeHandler) {
                window.removeEventListener('resize', this._windowResizeHandler);
                this._windowResizeHandler = null;
            }

            this._plotId = null;
            this._placingType = null;
            window.UIManager?.closeModal();
        },

        refresh() {
            if (!this._plotId) return;
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal?.classList.contains('active')) return;
            this._render();
        },

        // ============================================================
        // ★ 实时 tick：界面开着时每分钟补算
        // ============================================================
        _startRealtimeTick() {
            this._stopRealtimeTick();

            this._tickHandler = () => {
                if (!this._plotId) return;

                const plot = window.MapPlotManager?.getPlotById?.(this._plotId);
                if (!plot?.factory) return;

                const changed = window.FactoryManager?.tickOne?.(this._plotId);
                if (changed) {
                    this._refreshDynamic(plot);
                }
            };

            window.addEventListener('cw:env-minute', this._tickHandler);
        },

        _stopRealtimeTick() {
            if (this._tickHandler) {
                window.removeEventListener('cw:env-minute', this._tickHandler);
                this._tickHandler = null;
            }
        },

        // ============================================================
        // ★ 监听 modal 被外部关闭
        // ============================================================
        _initGlobalClose() {
            if (this._modalObserver) return;

            this._modalObserver = new MutationObserver(() => {
                const modal = document.getElementById('cinemaworld-modal');
                if (!modal) return;

                // modal 被关闭，但 FactoryUI 还认为自己开着
                if (!modal.classList.contains('active') && this._plotId) {
                    this._stopRealtimeTick();

                    if (this._plotId) {
                        window.FactoryManager?.tickOne?.(this._plotId);
                    }

                    if (this._resizeObserver) {
                        this._resizeObserver.disconnect();
                        this._resizeObserver = null;
                    }
                    if (this._windowResizeHandler) {
                        window.removeEventListener('resize', this._windowResizeHandler);
                        this._windowResizeHandler = null;
                    }

                    this._plotId = null;
                    this._placingType = null;
                }
            });

            this._modalObserver.observe(document.body, {
                subtree: true,
                attributes: true,
                attributeFilter: ['class'],
            });
        },

        // ============================================================
        // 空状态（未配置）
        // ============================================================
        _renderEmpty(plot) {
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            modal.className = 'active cw-factory-modal';
            modal.style.width = 'min(900px, 96vw)';
            modal.style.maxWidth = 'none';
            modal.style.maxHeight = '94vh';
            modal.style.padding = '24px 28px';
            modal.style.overflowY = 'auto';
            modal.style.boxSizing = 'border-box';

            modal.innerHTML = `
                <div style="font-size:22px;font-weight:bold;margin-bottom:16px;">
                    🏭 ${plot.name}
                </div>
                <div style="text-align:center;padding:40px 20px;">
                    <div style="font-size:64px;margin-bottom:16px;">🏭</div>
                    <div style="font-size:16px;color:#fff;margin-bottom:8px;">
                        这座工厂还没有配置
                    </div>
                    <div style="font-size:13px;color:#888;line-height:1.8;margin-bottom:24px;">
                        让 AI 根据世界观、地图环境生成<br>
                        资源类型、建筑、配方
                    </div>
                    <div style="margin-bottom:16px;">
                        <textarea id="cw-factory-first-guide" class="cinemaworld-textarea"
                            placeholder="额外要求（可选）：例如 一座小型果汁加工厂"
                            style="min-height:80px;max-width:400px;margin:0 auto;">${plot._pendingGuide || ''}</textarea>
                    </div>
                    <button class="cinemaworld-button primary" id="cw-factory-first-gen"
                        onclick="FactoryUI._doFirstGenerate()">
                        🤖 让 AI 生成配置
                    </button>
                    <div style="margin-top:16px;">
                        <button class="cinemaworld-button" onclick="FactoryUI.close()">
                            关闭
                        </button>
                    </div>
                </div>
            `;
        },

        async _doFirstGenerate() {
            const guide = document.getElementById('cw-factory-first-guide')?.value.trim() || '';
            const btn = document.getElementById('cw-factory-first-gen');
            if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 生成中...'; }

            const result = await window.FactoryGenerator.generate(this._plotId, { guide });
            if (result) {
                const plot = window.MapPlotManager?.getPlotById?.(this._plotId);
                if (plot) delete plot._pendingGuide;

                // 生成完 → 初始化 lastTickAt 为当前时刻
                const ws = window.CinemaWorld?.worldState;
                const now = (typeof ws?.worldMinutes === 'number') ? ws.worldMinutes : 0;
                if (plot?.factory) plot.factory.lastTickAt = now;

                this._render();
                this._startRealtimeTick();
            } else {
                if (btn) { btn.disabled = false; btn.innerHTML = '🤖 让 AI 生成配置'; }
            }
        },

        // ============================================================
        // 主界面
        // ============================================================
        _render() {
            const plot = window.MapPlotManager?.getPlotById?.(this._plotId);
            if (!plot?.rules || !plot?.factory) {
                this.close();
                return;
            }

            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            modal.className = 'active cw-factory-modal';
            modal.style.width = 'min(1100px, 96vw)';
            modal.style.maxWidth = 'none';
            modal.style.maxHeight = '94vh';
            modal.style.padding = '0';
            modal.style.overflowY = 'hidden';
            modal.style.boxSizing = 'border-box';

            modal.innerHTML = `
                <div class="cw-factory-root">
                    ${this._renderHeader(plot)}
                    <div class="cw-factory-body">
                        ${this._renderGrid(plot)}
                        ${this._renderSidebar(plot)}
                    </div>
                    ${this._renderFooter(plot)}
                </div>
            `;

            this._injectStyles();
            this._bindGrid(plot);

            requestAnimationFrame(() => {
                this._layoutGrid(plot);
                this._bindResize(plot);
            });
        },

        // ============================================================
        // ★ 动态刷新（只更新会变的部分）
        // ============================================================
        _refreshDynamic(plot) {
            const f = plot.factory;
            const rules = plot.rules;

            // 资源行
            for (const [key, def] of Object.entries(rules.resourceTypes)) {
                const row = document.querySelector(`.cw-factory-res-row[data-key="${key}"]`);
                if (!row) continue;

                const cur = Math.round(f.storage[key] || 0);
                const cap = f.storageCapacity[key] ?? '∞';
                const amountEl = row.querySelector('.cw-factory-res-amount');
                if (amountEl) {
                    amountEl.innerHTML = `${cur}<span class="cap">/${cap}</span>`;
                }
                const fillEl = row.querySelector('.cw-factory-res-fill');
                if (fillEl && typeof cap === 'number' && cap > 0) {
                    fillEl.style.width = `${Math.min(100, cur / cap * 100)}%`;
                }
            }

            // 电力
            const powerEls = document.querySelectorAll('.cw-factory-power');
            powerEls.forEach(el => {
                if (el.dataset.type === 'gold') {
                    const gold = window.FactoryManager?._getPlayerGold?.() ?? 0;
                    el.textContent = `💰 ${Math.round(gold)}`;
                } else if (!el.dataset.type) {
                    el.textContent = `⚡ ${Math.round(f.power.generated)} / ${Math.round(f.power.consumed)}`;
                }
            });

            // 建筑状态标记
            for (const [bid, bld] of Object.entries(f.buildings)) {
                const el = document.querySelector(`.cw-factory-building[data-bid="${bid}"]`);
                if (!el) continue;

                const t = rules.buildingTypes[bld.type];
                if (!t) continue;

                const blockedEl = el.querySelector('.cw-factory-blocked');
                const nopowerEl = el.querySelector('.cw-factory-nopower');

                if (bld.blocked && !blockedEl) {
                    el.insertAdjacentHTML('beforeend', '<div class="cw-factory-blocked">⚠</div>');
                } else if (!bld.blocked && blockedEl) {
                    blockedEl.remove();
                }

                const needPower = (t.powerDraw || 0) > 0;
                if (!bld.powered && needPower && !nopowerEl) {
                    el.insertAdjacentHTML('beforeend', '<div class="cw-factory-nopower">⚡✕</div>');
                } else if ((bld.powered || !needPower) && nopowerEl) {
                    nopowerEl.remove();
                }
            }

            // 累计产出
            const statsEl = document.querySelector('.cw-factory-stats');
            if (statsEl) {
                const stats = [];
                for (const [key, amt] of Object.entries(f.stats.totalProduced || {})) {
                    if (amt <= 0) continue;
                    const def = rules.resourceTypes[key];
                    if (!def) continue;
                    stats.push(`${def.emoji} ${Math.round(amt)}`);
                }
                statsEl.innerHTML = `<span style="color:#888;">累计产出：</span>${stats.length ? stats.join(' · ') : '—'}`;
            }
        },

        // ============================================================
        // 渲染方法
        // ============================================================
        _renderHeader(plot) {
            const f = plot.factory;
            const gold = window.FactoryManager?._getPlayerGold?.() ?? 0;

            return `
                <div class="cw-factory-header">
                    <div class="cw-factory-header-left">
                        <div class="cw-factory-icon">${plot.emoji || '🏭'}</div>
                        <div>
                            <div class="cw-factory-title">${this._esc(plot.name)}</div>
                            <div class="cw-factory-subtitle">
                                ${f.width} × ${f.height} · ${Object.keys(f.buildings).length} 个建筑
                            </div>
                        </div>
                    </div>
                    <div class="cw-factory-header-right">
                        <div class="cw-factory-power">
                            ⚡ ${Math.round(f.power.generated)} / ${Math.round(f.power.consumed)}
                        </div>
                        <div class="cw-factory-power" data-type="gold"
                            style="color:#ffd76b;border-color:rgba(255,215,100,.25);background:rgba(255,215,100,.08);">
                            💰 ${Math.round(gold)}
                        </div>
                        <button class="cw-factory-close" onclick="FactoryUI.close()">✕</button>
                    </div>
                </div>
            `;
        },

        _renderGrid(plot) {
            const f = plot.factory;
            const rules = plot.rules;

            let cellsHTML = '';
            for (let y = 0; y < f.height; y++) {
                for (let x = 0; x < f.width; x++) {
                    const cell = f.cells[y][x];
                    let inner = '';
                    let cls = 'cw-factory-cell';
                    let style = '';

                    if (cell.building) {
                        const bld = f.buildings[cell.building.id];
                        const t = rules.buildingTypes[bld.type];
                        const size = bld.size || 1;
                        cls += ' has-building';
                        cls += ` kind-${t.kind}`;
                        style = `grid-column: ${x + 1} / span ${size}; grid-row: ${y + 1} / span ${size};`;
                        inner = `
                            <div class="cw-factory-building"
                                data-bid="${bld.id}"
                                title="${this._esc(t.name)}">
                                <div class="cw-factory-building-emoji">${t.emoji}</div>
                                <div class="cw-factory-building-name">${this._esc(t.name)}</div>
                                ${bld.blocked ? '<div class="cw-factory-blocked">⚠</div>' : ''}
                                ${!bld.powered && t.powerDraw > 0 ? '<div class="cw-factory-nopower">⚡✕</div>' : ''}
                            </div>
                        `;
                    } else if (cell.occupiedBy) {
                        continue;
                    } else {
                        inner = `<div class="cw-factory-empty"></div>`;
                    }

                    cellsHTML += `
                        <div class="${cls}" data-x="${x}" data-y="${y}" style="${style}">
                            ${inner}
                        </div>
                    `;
                }
            }

            return `
                <div class="cw-factory-grid-wrap" id="cw-factory-grid-wrap">
                    <div class="cw-factory-grid" id="cw-factory-grid"
                        style="
                            grid-template-columns: repeat(${f.width}, var(--cw-cell-size, 48px));
                            grid-template-rows: repeat(${f.height}, var(--cw-cell-size, 48px));
                        ">
                        ${cellsHTML}
                    </div>
                </div>
            `;
        },

        // ============================================================
        // ★ 计算格子尺寸，保证不溢出
        // ============================================================
        _layoutGrid(plot) {
            const wrap = document.getElementById('cw-factory-grid-wrap');
            const grid = document.getElementById('cw-factory-grid');
            if (!wrap || !grid) return;

            const f = plot.factory;

            const wrapRect = wrap.getBoundingClientRect();
            const style = window.getComputedStyle(wrap);
            const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);

            const availW = wrapRect.width - padX;
            const availH = wrapRect.height - padY;

            if (availW <= 0 || availH <= 0) return;

            const gap = 2;
            const cols = f.width;
            const rows = f.height;

            const cellW = (availW - gap * (cols - 1)) / cols;
            const cellH = (availH - gap * (rows - 1)) / rows;

            let cellSize = Math.floor(Math.min(cellW, cellH));

            const MIN_CELL = 20;
            const MAX_CELL = 96;
            cellSize = Math.max(MIN_CELL, Math.min(MAX_CELL, cellSize));

            grid.style.setProperty('--cw-cell-size', `${cellSize}px`);

            const emojiSize = Math.max(10, Math.floor(cellSize * 0.5));
            const nameSize = Math.max(7, Math.floor(cellSize * 0.22));
            grid.style.setProperty('--cw-emoji-size', `${emojiSize}px`);
            grid.style.setProperty('--cw-name-size', `${nameSize}px`);
        },

        _bindResize(plot) {
            if (this._resizeObserver) {
                this._resizeObserver.disconnect();
                this._resizeObserver = null;
            }

            const wrap = document.getElementById('cw-factory-grid-wrap');
            if (!wrap) return;

            if (window.ResizeObserver) {
                this._resizeObserver = new ResizeObserver(() => {
                    this._layoutGrid(plot);
                });
                this._resizeObserver.observe(wrap);
            }

            if (!this._windowResizeHandler) {
                this._windowResizeHandler = () => {
                    const p = window.MapPlotManager?.getPlotById?.(this._plotId);
                    if (p) this._layoutGrid(p);
                };
                window.addEventListener('resize', this._windowResizeHandler);
            }
        },

        _renderSidebar(plot) {
            return `
                <div class="cw-factory-sidebar">
                    ${this._renderResources(plot)}
                    ${this._renderBuildingList(plot)}
                </div>
            `;
        },

        _renderResources(plot) {
            const f = plot.factory;
            const rules = plot.rules;
            const rows = [];

            for (const [key, def] of Object.entries(rules.resourceTypes)) {
                const cur = Math.round(f.storage[key] || 0);
                const cap = f.storageCapacity[key] ?? '∞';
                const pct = (typeof cap === 'number' && cap > 0)
                    ? Math.min(100, cur / cap * 100)
                    : 0;

                rows.push(`
                    <div class="cw-factory-res-row" data-key="${key}">
                        <div class="cw-factory-res-emoji">${def.emoji}</div>
                        <div class="cw-factory-res-info">
                            <div class="cw-factory-res-name">${this._esc(def.label)}</div>
                            <div class="cw-factory-res-bar">
                                <div class="cw-factory-res-fill"
                                    style="width:${pct}%;background:${def.color || '#7da8ff'};"></div>
                            </div>
                        </div>
                        <div class="cw-factory-res-amount">${cur}<span class="cap">/${cap}</span></div>
                        <button class="cw-factory-res-take"
                            title="取走"
                            onclick="FactoryUI._take('${key}')">↗</button>
                    </div>
                `);
            }

            return `
                <div class="cw-factory-section">
                    <div class="cw-factory-section-title">📦 资源</div>
                    ${rows.join('') || '<div class="cw-factory-empty-tip">暂无资源</div>'}
                    <button class="cw-factory-take-all" onclick="FactoryUI._takeAll()">
                        📤 全部取走
                    </button>
                </div>
            `;
        },

        _renderBuildingList(plot) {
            const rules = plot.rules;
            const groups = {
                extractor: { label: '⛏️ 采集', items: [] },
                processor: { label: '🔥 加工', items: [] },
                storage: { label: '📦 仓库', items: [] },
                power: { label: '⚡ 能源', items: [] },
            };

            for (const [key, def] of Object.entries(rules.buildingTypes)) {
                const g = groups[def.kind];
                if (g) g.items.push({ key, def });
            }

            let html = '';
            for (const [kind, g] of Object.entries(groups)) {
                if (g.items.length === 0) continue;
                html += `<div class="cw-factory-build-group">${g.label}</div>`;
                for (const { key, def } of g.items) {
                    const costText = Object.entries(def.cost || {})
                        .map(([k, v]) => `${k}×${v}`).join('、') || '免费';

                    html += `
                        <div class="cw-factory-build-item ${this._placingType === key ? 'active' : ''}"
                            onclick="FactoryUI._startPlace('${key}')">
                            <div class="cw-factory-build-emoji">${def.emoji}</div>
                            <div class="cw-factory-build-info">
                                <div class="cw-factory-build-name">${this._esc(def.name)}</div>
                                <div class="cw-factory-build-meta">
                                    ${def.size}×${def.size} · ${costText}
                                    ${def.powerDraw ? ` · ⚡${def.powerDraw}` : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }
            }

            return `
                <div class="cw-factory-section">
                    <div class="cw-factory-section-title">
                        🏗️ 建筑
                        ${this._placingType
                            ? `<button class="cw-factory-cancel-place"
                                onclick="FactoryUI._cancelPlace()">取消放置</button>`
                            : ''}
                    </div>
                    <div class="cw-factory-build-list">${html}</div>
                </div>
            `;
        },

        _renderFooter(plot) {
            const f = plot.factory;
            const rules = plot.rules;

            const stats = [];
            for (const [key, amt] of Object.entries(f.stats.totalProduced || {})) {
                if (amt <= 0) continue;
                const def = rules.resourceTypes[key];
                if (!def) continue;
                stats.push(`${def.emoji} ${Math.round(amt)}`);
            }

            return `
                <div class="cw-factory-footer">
                    <div class="cw-factory-stats">
                        <span style="color:#888;">累计产出：</span>
                        ${stats.length ? stats.join(' · ') : '—'}
                    </div>
                    <button class="cinemaworld-button"
                        onclick="FactoryUI._openLog()">📜 日志</button>
                </div>
            `;
        },

        // ============================================================
        // 交互
        // ============================================================
        _bindGrid(plot) {
            const grid = document.querySelector('.cw-factory-grid');
            if (!grid) return;

            grid.addEventListener('click', (e) => {
                const cellEl = e.target.closest('.cw-factory-cell');
                if (!cellEl) return;

                const x = parseInt(cellEl.dataset.x);
                const y = parseInt(cellEl.dataset.y);

                if (this._placingType) {
                    this._doPlace(plot, x, y);
                    return;
                }

                const bldEl = cellEl.querySelector('.cw-factory-building');
                if (bldEl) {
                    const bid = bldEl.dataset.bid;
                    this._openBuildingDetail(plot, bid);
                    return;
                }
            });

            grid.addEventListener('contextmenu', (e) => {
                const cellEl = e.target.closest('.cw-factory-cell');
                if (!cellEl) return;
                e.preventDefault();

                const x = parseInt(cellEl.dataset.x);
                const y = parseInt(cellEl.dataset.y);
                const cell = plot.factory.cells[y]?.[x];
                if (!cell?.building && !cell?.occupiedBy) return;

                const bid = cell.building?.id || cell.occupiedBy;
                this._confirmRemove(plot, bid);
            });
        },

        _startPlace(typeKey) {
            this._placingType = typeKey;
            this._render();
        },

        _cancelPlace() {
            this._placingType = null;
            this._render();
        },

        _doPlace(plot, x, y) {
            const r = window.FactoryManager.placeBuilding(this._plotId, {
                typeKey: this._placingType,
                x, y,
            });

            if (r.ok) {
                window.UIManager?.showText?.('✅ 已放置', 1000);
                this._render();
            } else {
                window.UIManager?.showText?.(`❌ ${r.message}`, 1800);
            }
        },

        _openBuildingDetail(plot, buildingId) {
            const f = plot.factory;
            const bld = f.buildings[buildingId];
            if (!bld) return;

            const t = plot.rules.buildingTypes[bld.type];
            if (!t) return;

            let bodyHTML = '';

            if (t.kind === 'processor') {
                const recipeList = Object.values(t.recipes || {});
                bodyHTML = `
                    <div class="cw-factory-detail-section">
                        <div class="cw-factory-detail-label">配方</div>
                        ${recipeList.map(r => `
                            <div class="cw-factory-recipe ${bld.recipeId === r.id ? 'active' : ''}"
                                onclick="FactoryUI._setRecipe('${buildingId}', '${r.id}')">
                                <div class="cw-factory-recipe-name">${this._esc(r.name)}</div>
                                <div class="cw-factory-recipe-io">
                                    ${this._formatIO(r.input)} → ${this._formatIO(r.output)}
                                    <span class="dur">${r.durationMinutes}分钟</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="cw-factory-detail-section">
                        <div class="cw-factory-detail-label">状态</div>
                        <div class="cw-factory-detail-row">
                            <span>进度</span>
                            <span>${Math.round((bld.progress || 0) * 100)}%</span>
                        </div>
                        <div class="cw-factory-detail-row">
                            <span>电力</span>
                            <span style="color:${bld.powered ? '#7dd87d' : '#d87d7d'};">
                                ${bld.powered ? '正常' : '断电'}
                            </span>
                        </div>
                        ${bld.blocked ? `
                            <div class="cw-factory-detail-warn">
                                ⚠ ${this._blockReason(plot, bld)}
                            </div>
                        ` : ''}
                    </div>
                `;
            } else if (t.kind === 'extractor') {
                const outDef = plot.rules.resourceTypes[t.outputType];
                bodyHTML = `
                    <div class="cw-factory-detail-section">
                        <div class="cw-factory-detail-label">产出</div>
                        <div class="cw-factory-detail-row">
                            <span>${outDef?.emoji || ''} ${outDef?.label || t.outputType}</span>
                            <span>${t.ratePerMinute}/分钟</span>
                        </div>
                        <div class="cw-factory-detail-row">
                            <span>电力</span>
                            <span style="color:${bld.powered ? '#7dd87d' : '#d87d7d'};">
                                ${bld.powered ? '正常' : '断电'}
                            </span>
                        </div>
                    </div>
                `;
            } else if (t.kind === 'storage') {
                bodyHTML = `
                    <div class="cw-factory-detail-section">
                        <div class="cw-factory-detail-label">容量加成</div>
                        ${Object.entries(t.capacity || {}).map(([k, v]) => `
                            <div class="cw-factory-detail-row">
                                <span>${plot.rules.resourceTypes[k]?.emoji || ''} ${plot.rules.resourceTypes[k]?.label || k}</span>
                                <span>+${v}</span>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else if (t.kind === 'power') {
                bodyHTML = `
                    <div class="cw-factory-detail-section">
                        <div class="cw-factory-detail-label">供电</div>
                        <div class="cw-factory-detail-row">
                            <span>输出</span>
                            <span>⚡ ${t.powerOutput}</span>
                        </div>
                        ${t.fuelType ? `
                            <div class="cw-factory-detail-row">
                                <span>燃料</span>
                                <span>${plot.rules.resourceTypes[t.fuelType]?.emoji || ''} ${t.fuelPerMinute.toFixed(2)}/分钟</span>
                            </div>
                        ` : ''}
                        <div class="cw-factory-detail-row">
                            <span>状态</span>
                            <span style="color:${bld.powered ? '#7dd87d' : '#d87d7d'};">
                                ${bld.powered ? '运行中' : '缺燃料'}
                            </span>
                        </div>
                    </div>
                `;
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active cw-factory-modal';
            modal.style.padding = '24px 28px';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">${t.emoji} ${this._esc(t.name)}</div>
                <div style="font-size:13px;color:#aaa;margin-bottom:14px;
                    padding:10px;background:rgba(0,0,0,.2);border-radius:8px;">
                    ${this._esc(t.description || '')}
                </div>
                ${bodyHTML}
                <div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button" style="color:#d87d7d;"
                        onclick="FactoryUI._confirmRemoveById('${buildingId}')">
                        🗑️ 拆除
                    </button>
                    <button class="cinemaworld-button" onclick="FactoryUI._render()">← 返回</button>
                </div>
            `;
        },

        _blockReason(plot, bld) {
            const t = plot.rules.buildingTypes[bld.type];
            const r = t.recipes?.[bld.recipeId];
            if (!r) return '无配方';

            const f = plot.factory;
            for (const [item, need] of Object.entries(r.input || {})) {
                if ((f.storage[item] || 0) < need) {
                    const def = plot.rules.resourceTypes[item];
                    return `缺少 ${def?.label || item}（需 ${need}）`;
                }
            }
            for (const [item, out] of Object.entries(r.output || {})) {
                const cap = f.storageCapacity[item];
                if (cap !== undefined && (f.storage[item] || 0) + out > cap) {
                    const def = plot.rules.resourceTypes[item];
                    return `${def?.label || item} 已满`;
                }
            }
            return '已阻塞';
        },

        _formatIO(obj) {
            return Object.entries(obj || {})
                .map(([k, v]) => `${k}×${v}`)
                .join('+') || '—';
        },

        _setRecipe(buildingId, recipeId) {
            const r = window.FactoryManager.setRecipe(this._plotId, buildingId, recipeId);
            if (r.ok) {
                window.UIManager?.showText?.('✅ 已切换配方', 1000);
                this._render();
            } else {
                window.UIManager?.showText?.(`❌ ${r.message}`, 1500);
            }
        },

        _confirmRemoveById(buildingId) {
            const plot = window.MapPlotManager?.getPlotById?.(this._plotId);
            if (!plot) return;
            this._confirmRemove(plot, buildingId);
        },

        _confirmRemove(plot, buildingId) {
            const bld = plot.factory.buildings[buildingId];
            if (!bld) return;
            const t = plot.rules.buildingTypes[bld.type];

            if (!confirm(`确定拆除「${t.name}」吗？\n（不返还造价）`)) return;

            window.FactoryManager.removeBuilding(this._plotId, buildingId);
            window.UIManager?.showText?.('🗑️ 已拆除', 1200);
            this._render();
        },

        _take(resourceKey) {
            const plot = window.MapPlotManager?.getPlotById?.(this._plotId);
            if (!plot) return;

            const cur = Math.floor(plot.factory.storage[resourceKey] || 0);
            if (cur <= 0) {
                window.UIManager?.showText?.('没有可取的资源', 1200);
                return;
            }

            const input = prompt(`取走多少？（现有 ${cur}）`, String(cur));
            if (input === null) return;
            const amount = parseInt(input);
            if (!amount || amount <= 0) return;

            const r = window.FactoryManager.takeResource(this._plotId, resourceKey, amount);
            if (r.ok) {
                window.UIManager?.showText?.(`📤 取走 ${r.taken}`, 1500);
                this._render();
            } else {
                window.UIManager?.showText?.(`❌ ${r.message}`, 1500);
            }
        },

        _takeAll() {
            const r = window.FactoryManager.takeAll(this._plotId);
            if (r.ok && r.taken > 0) {
                window.UIManager?.showText?.(`📤 取走 ${r.taken} 个资源`, 1800);
                this._render();
            } else {
                window.UIManager?.showText?.('没有可取的资源', 1200);
            }
        },

        _openLog() {
            const plot = window.MapPlotManager?.getPlotById?.(this._plotId);
            if (!plot) return;
            const log = (plot.log || []).slice(-30).reverse();

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active cw-factory-modal';
            modal.style.padding = '24px 28px';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📜 工厂日志</div>
                <div style="max-height:60vh;overflow-y:auto;padding:10px;
                    background:rgba(0,0,0,.2);border-radius:8px;">
                    ${log.length === 0
                        ? '<div style="text-align:center;color:#666;padding:20px;">暂无日志</div>'
                        : log.map(l => {
                            const d = new Date(l.ts);
                            const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                            return `<div style="font-size:12px;padding:4px 0;">
                                <span style="color:#666;margin-right:8px;">${t}</span>
                                <span style="color:#ccc;">${this._esc(l.text)}</span>
                            </div>`;
                        }).join('')}
                </div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="FactoryUI._render()">← 返回</button>
                </div>
            `;
        },

        // ============================================================
        // 样式
        // ============================================================
        _injectStyles() {
            if (document.getElementById('cw-factory-styles')) return;
            const s = document.createElement('style');
            s.id = 'cw-factory-styles';
            s.textContent = `
                .cw-factory-root {
                    display: flex;
                    flex-direction: column;
                    height: 92vh;
                    max-height: 92vh;
                    color: #ddd;
                    font-family: inherit;
                }
                .cw-factory-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 24px;
                    border-bottom: 1px solid rgba(255,255,255,.08);
                    flex-shrink: 0;
                }
                .cw-factory-header-left {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .cw-factory-icon { font-size: 32px; }
                .cw-factory-title { font-size: 18px; font-weight: 700; color: #fff; }
                .cw-factory-subtitle { font-size: 12px; color: #888; margin-top: 2px; }
                .cw-factory-header-right {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .cw-factory-power {
                    font-size: 13px;
                    color: #ffd76b;
                    background: rgba(255,215,100,.08);
                    border: 1px solid rgba(255,215,100,.25);
                    border-radius: 8px;
                    padding: 6px 12px;
                }
                .cw-factory-close {
                    background: none; border: none; color: #888;
                    font-size: 20px; cursor: pointer; padding: 4px 8px;
                }
                .cw-factory-close:hover { color: #fff; }

                .cw-factory-body {
                    display: flex;
                    flex: 1;
                    min-height: 0;
                    padding: 16px;
                    gap: 16px;
                }
                .cw-factory-grid-wrap {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(0,0,0,.25);
                    border-radius: 12px;
                    padding: 16px;
                    overflow: hidden;
                    min-width: 0;
                    min-height: 0;
                }
                .cw-factory-grid {
                    display: grid;
                    gap: 2px;
                    background: rgba(255,255,255,.03);
                    padding: 4px;
                    border-radius: 8px;
                    width: max-content;
                    height: max-content;
                }
                .cw-factory-cell {
                    background: rgba(255,255,255,.04);
                    border: 1px solid rgba(255,255,255,.06);
                    border-radius: 4px;
                    position: relative;
                    cursor: pointer;
                    transition: background .15s;
                    box-sizing: border-box;
                    overflow: hidden;
                }
                .cw-factory-cell:hover { background: rgba(120,150,255,.12); }
                .cw-factory-cell.has-building { cursor: pointer; }
                .cw-factory-cell.kind-extractor { background: rgba(100,180,100,.15); }
                .cw-factory-cell.kind-processor { background: rgba(220,140,80,.15); }
                .cw-factory-cell.kind-storage { background: rgba(120,150,200,.15); }
                .cw-factory-cell.kind-power { background: rgba(255,215,100,.15); }
                .cw-factory-empty { width: 100%; height: 100%; }
                .cw-factory-building {
                    width: 100%; height: 100%;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 1px;
                    padding: 2px;
                    box-sizing: border-box;
                    overflow: hidden;
                }
                .cw-factory-building-emoji {
                    font-size: var(--cw-emoji-size, 22px);
                    line-height: 1;
                }
                .cw-factory-building-name {
                    font-size: var(--cw-name-size, 10px);
                    color: #ccc;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 100%;
                }
                .cw-factory-blocked {
                    position: absolute; top: 2px; right: 2px;
                    font-size: 12px; color: #d87d7d;
                }
                .cw-factory-nopower {
                    position: absolute; top: 2px; left: 2px;
                    font-size: 10px; color: #ff8a8a;
                }

                .cw-factory-sidebar {
                    width: 320px;
                    flex-shrink: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    overflow-y: auto;
                }
                .cw-factory-section {
                    background: rgba(255,255,255,.03);
                    border: 1px solid rgba(255,255,255,.06);
                    border-radius: 10px;
                    padding: 12px;
                }
                .cw-factory-section-title {
                    font-size: 13px;
                    font-weight: 600;
                    color: #9ab0ff;
                    margin-bottom: 10px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .cw-factory-res-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 6px 0;
                    border-bottom: 1px solid rgba(255,255,255,.04);
                }
                .cw-factory-res-row:last-child { border-bottom: none; }
                .cw-factory-res-emoji { font-size: 20px; flex-shrink: 0; }
                .cw-factory-res-info { flex: 1; min-width: 0; }
                .cw-factory-res-name { font-size: 12px; color: #ddd; margin-bottom: 3px; }
                .cw-factory-res-bar {
                    height: 3px;
                    background: rgba(255,255,255,.08);
                    border-radius: 2px;
                    overflow: hidden;
                }
                .cw-factory-res-fill { height: 100%; transition: width .3s; }
                .cw-factory-res-amount {
                    font-size: 12px; color: #ffd76b;
                    font-family: monospace;
                    flex-shrink: 0;
                }
                .cw-factory-res-amount .cap { color: #555; }
                .cw-factory-res-take {
                    background: rgba(120,150,255,.15);
                    border: 1px solid rgba(120,150,255,.3);
                    color: #9ab0ff;
                    border-radius: 6px;
                    width: 24px; height: 24px;
                    cursor: pointer;
                    font-size: 12px;
                    flex-shrink: 0;
                }
                .cw-factory-res-take:hover { background: rgba(120,150,255,.3); }

                .cw-factory-take-all {
                    width: 100%;
                    margin-top: 8px;
                    padding: 8px;
                    background: rgba(120,150,255,.15);
                    border: 1px solid rgba(120,150,255,.3);
                    border-radius: 6px;
                    color: #9ab0ff;
                    cursor: pointer;
                    font-size: 12px;
                    font-family: inherit;
                }
                .cw-factory-take-all:hover { background: rgba(120,150,255,.3); }

                .cw-factory-build-group {
                    font-size: 11px;
                    color: #888;
                    margin: 8px 0 4px 0;
                }
                .cw-factory-build-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 10px;
                    background: rgba(255,255,255,.04);
                    border: 1px solid transparent;
                    border-radius: 8px;
                    cursor: pointer;
                    margin-bottom: 4px;
                    transition: all .15s;
                }
                .cw-factory-build-item:hover { background: rgba(120,150,255,.15); }
                .cw-factory-build-item.active {
                    border-color: rgba(120,150,255,.7);
                    background: rgba(120,150,255,.2);
                }
                .cw-factory-build-emoji { font-size: 22px; }
                .cw-factory-build-info { flex: 1; min-width: 0; }
                .cw-factory-build-name { font-size: 12px; color: #ddd; }
                .cw-factory-build-meta { font-size: 10px; color: #888; margin-top: 2px; }
                .cw-factory-cancel-place {
                    background: rgba(216,125,125,.15);
                    border: 1px solid rgba(216,125,125,.3);
                    color: #ffb8b8;
                    border-radius: 4px;
                    padding: 2px 8px;
                    font-size: 10px;
                    cursor: pointer;
                    font-family: inherit;
                }

                .cw-factory-footer {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 12px 24px;
                    border-top: 1px solid rgba(255,255,255,.08);
                    flex-shrink: 0;
                }
                .cw-factory-stats {
                    font-size: 12px;
                    color: #ddd;
                }

                .cw-factory-detail-section { margin-bottom: 14px; }
                .cw-factory-detail-label {
                    font-size: 12px; color: #888;
                    margin-bottom: 6px;
                }
                .cw-factory-detail-row {
                    display: flex;
                    justify-content: space-between;
                    padding: 5px 0;
                    font-size: 13px;
                    border-bottom: 1px solid rgba(255,255,255,.04);
                }
                .cw-factory-detail-warn {
                    padding: 8px 10px;
                    background: rgba(216,125,125,.12);
                    border: 1px solid rgba(216,125,125,.3);
                    border-radius: 6px;
                    font-size: 12px;
                    color: #ffb8b8;
                    margin-top: 8px;
                }
                .cw-factory-recipe {
                    padding: 8px 10px;
                    background: rgba(255,255,255,.04);
                    border: 1px solid transparent;
                    border-radius: 8px;
                    margin-bottom: 6px;
                    cursor: pointer;
                }
                .cw-factory-recipe:hover { background: rgba(120,150,255,.12); }
                .cw-factory-recipe.active {
                    border-color: rgba(120,150,255,.7);
                    background: rgba(120,150,255,.15);
                }
                .cw-factory-recipe-name { font-size: 13px; color: #fff; margin-bottom: 3px; }
                .cw-factory-recipe-io { font-size: 11px; color: #888; }
                .cw-factory-recipe-io .dur { color: #666; margin-left: 8px; }
                .cw-factory-empty-tip {
                    font-size: 12px; color: #666; text-align: center; padding: 12px;
                }

                @media (max-width: 800px) {
                    .cw-factory-body { flex-direction: column; }
                    .cw-factory-sidebar { width: 100%; max-height: 40vh; }
                }
            `;
            document.head.appendChild(s);
        },

        _esc(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
    };

    window.FactoryUI = FactoryUI;
    console.log('[CinemaWorld] factory-ui.js 已加载');
})();