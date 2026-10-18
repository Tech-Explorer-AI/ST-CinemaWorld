// ============================================================
// CinemaWorld · companion/companion-ui.js
// UI 层：手机 App 队伍列表 / 详情 / 养成面板 / 行动执行
//         + 独立模态框（从地图打开队友）
//         + 召唤入口（详情页顶部）
//
// 依赖：companion-core.js, companion-ai.js, ui.js（部分）
// 暴露：window.CompanionUI
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const CharacterRegistry = window.CharacterRegistry;
    const PlayerStateManager = window.PlayerStateManager;

    const CompanionManager = window.CompanionManager;
    const BondManager = window.BondManager;
    const CompanionAIManager = window.CompanionAIManager;
    const COOLDOWN_TYPES = window.CompanionConstants?.COOLDOWN_TYPES || {};

    const CompanionUI = {
        currentView: 'list',
        currentMemberName: null,

        render(view = null) {
            if (view) this.currentView = view;

            switch (this.currentView) {
                case 'detail': return this.renderDetail();
                default: return this.renderList();
            }
        },

        // ============================================================
        // 手机 App · 队伍列表
        // ============================================================
        renderList() {
            const members = CompanionManager.getAll();

            let html = `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>队伍</span>
                </div>
                <div class="cw-phone-app-body cw-companion-body">`;

            if (members.length === 0) {
                html += `
                    <div class="cw-companion-empty">
                        <div class="cw-companion-empty-icon">👥</div>
                        <div class="cw-companion-empty-text">还没有队友</div>
                        <div class="cw-companion-empty-hint">
                            在地图或场景里遇到 NPC 时<br>
                            点击「邀请同行」
                        </div>
                    </div>`;
            } else {
                for (const bond of members) {
                    html += this._renderMemberCard(bond);
                }
            }

            html += `</div>`;
            return html;
        },

        _renderMemberCard(bond) {
            const record = CharacterRegistry.get(bond.name);
            const stage = BondManager.getCurrentStage(bond);

            // ★ 列表卡片只展示养成属性的前 3 个
            const statsHTML = (bond.bondStatsOrder || []).slice(0, 3).map(key => {
                const s = bond.bondStats[key];
                if (!s) return '';

                const levelInfo = BondManager.getStatLevelInfo(bond, key);
                const cap = BondManager.getStatCap(bond, key);
                const isCapped = cap !== null && (Number(s.value) || 0) >= cap;

                let pct = 0;
                if (levelInfo) {
                    pct = (s.value % levelInfo.levelMax) / levelInfo.levelMax * 100;
                } else if (typeof s.max === 'number' && s.max > 0) {
                    pct = Math.min(100, (s.value / s.max) * 100);
                }

                return `
                    <div class="cw-companion-stat-mini ${isCapped ? 'capped' : ''}">
                        <span class="cw-companion-stat-icon">${s.emoji || '·'}</span>
                        <span class="cw-companion-stat-val">${Math.round(s.value)}</span>
                        ${levelInfo ? `<span class="cw-companion-stat-lv">Lv.${levelInfo.level}</span>` : ''}
                        ${isCapped ? '<span class="cw-companion-stat-lock">🔒</span>' : ''}
                        ${pct > 0 ? `
                            <div class="cw-companion-stat-bar">
                                <div class="cw-companion-stat-fill" style="width:${pct}%"></div>
                            </div>
                        ` : ''}
                    </div>`;
            }).join('');

            const avatarHTML = this._pickAvatar(record, bond.name);

            const p = bond.profile;
            const subLine = p?.personality || p?.mood || (stage ? stage.desc : '');

            // ★ 可触发阶段标记
            const pending = BondManager.getPendingStage(bond);
            const pendingBadge = pending
                ? `<span class="cw-companion-pending-badge">🎬</span>`
                : '';

            // ★ 已召唤标记
            const isSummoned = !!bond.summon?.active;
            const summonBadge = isSummoned
                ? `<span class="cw-companion-summoned-badge">🎯</span>`
                : '';

            return `
                <div class="cw-companion-card" onclick="CompanionUI.openDetail('${this._attr(bond.name)}')">
                    <div class="cw-companion-card-avatar" data-companion-avatar="${this._attr(bond.name)}">
                        ${avatarHTML}
                    </div>
                    <div class="cw-companion-card-main">
                        <div class="cw-companion-card-name">${this._escape(bond.name)}${pendingBadge}${summonBadge}</div>
                        <div class="cw-companion-card-stage">${stage ? stage.name : '初识'} · ${this._escape(subLine)}</div>
                        <div class="cw-companion-card-stats">${statsHTML}</div>
                    </div>
                    <div class="cw-companion-card-arrow">›</div>
                </div>`;
        },

        openDetail(name) {
            this.currentMemberName = name;
            this.currentView = 'detail';
            PhoneUIManager.render();
        },

        backToList() {
            this.currentView = 'list';
            this.currentMemberName = null;
            PhoneUIManager.render();
        },

        // ============================================================
        // 手机 App · 详情页
        // ============================================================
        renderDetail() {
            const name = this.currentMemberName;
            const bond = BondManager.getBond(name);
            const record = CharacterRegistry.get(name);
            if (!bond || !record) {
                return `<div class="cw-companion-empty"><div>队友不存在</div></div>`;
            }

            return `
                <div class="cw-companion-detail">
                    <div class="cw-phone-app-header">
                        <button class="cw-phone-back" onclick="CompanionUI.backToList()">←</button>
                        <span>${this._escape(name)}</span>
                        <button class="cw-phone-header-action"
                            onclick="CompanionUI.openMenu('${this._attr(name)}')">⋯</button>
                    </div>

                    <div class="cw-phone-app-body cw-companion-detail-body">
                        ${this._renderDetailInner(name)}
                    </div>
                </div>`;
        },

        // ============================================================
        // 独立模态框
        // ============================================================
        openModalDetail(name) {
            const bond = BondManager.getBond(name);
            const record = CharacterRegistry.get(name);
            if (!bond || !record) {
                window.UIManager?.showText?.('队友不存在', 1500);
                return;
            }

            this.currentMemberName = name;
            this.currentView = 'modal-detail';

            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            modal.className = 'active';
            modal.style.width = 'min(880px, 96vw)';
            modal.style.maxWidth = 'none';
            modal.style.maxHeight = '94vh';
            modal.style.padding = '0';
            modal.style.overflowY = 'auto';
            modal.style.boxSizing = 'border-box';
            modal.style.background = 'transparent';
            modal.style.boxShadow = 'none';

            modal.innerHTML = `
                <div class="cw-companion-modal-card">
                    <div class="cw-companion-modal-header">
                        <span class="cw-companion-modal-title">🤝 ${this._escape(name)}</span>
                        <button class="cw-companion-modal-close"
                            onclick="CompanionUI.closeModalDetail()">✕</button>
                    </div>
                    <div class="cw-companion-modal-body">
                        ${this._renderDetailInner(name)}
                    </div>
                </div>
            `;
        },

        closeModalDetail() {
            const modal = document.getElementById('cinemaworld-modal');
            if (modal) {
                modal.classList.remove('active');
                modal.innerHTML = '';
                modal.style.width = '';
                modal.style.maxWidth = '';
                modal.style.maxHeight = '';
                modal.style.padding = '';
                modal.style.overflowY = '';
                modal.style.boxSizing = '';
                modal.style.background = '';
                modal.style.boxShadow = '';
            }
            this.currentView = 'list';
            this.currentMemberName = null;
        },

        // ============================================================
        // 详情内容
        // ============================================================
        _renderDetailInner(name) {
            const bond = BondManager.getBond(name);
            const record = CharacterRegistry.get(name);
            if (!bond || !record) return '';

            const stage = BondManager.getCurrentStage(bond);

            const profileHTML = this._renderProfile(bond);

            // ★ 召唤状态栏
            const summonHTML = this._renderSummonButton(name, bond);

            // ★ 通用属性卡片渲染器
            const renderStatCard = (s, key, kind) => {
                const levelInfo = BondManager.getStatLevelInfo(bond, key);
                const cap = kind === 'bondStats' ? BondManager.getStatCap(bond, key) : null;
                const isCapped = cap !== null && (Number(s.value) || 0) >= cap;

                if (levelInfo) {
                    const totalMax = levelInfo.totalMax;
                    const pct = (s.value % levelInfo.levelMax) / levelInfo.levelMax * 100;
                    const isMaxLevel = levelInfo.level >= levelInfo.maxLevel
                        && (s.value % levelInfo.levelMax) === 0;

                    return `
                        <div class="cw-companion-stat-card ${isMaxLevel ? 'max' : ''} ${isCapped ? 'capped' : ''}">
                            <div class="cw-companion-stat-card-head">
                                <span class="cw-companion-stat-card-icon">${s.emoji || '·'}</span>
                                <span class="cw-companion-stat-card-label">${this._escape(s.label || key)}</span>
                                <span class="cw-companion-stat-card-value">
                                    ${Math.round(s.value)}
                                    <span class="max"> / ${totalMax}</span>
                                </span>
                            </div>
                            ${s.desc ? `<div class="cw-companion-stat-card-desc">${this._escape(s.desc)}</div>` : ''}
                            <div class="cw-companion-stat-card-level">
                                <span class="lv">Lv.${levelInfo.level}</span>
                                <span class="name">${this._escape(levelInfo.name)}</span>
                                <span class="max-level">/ 共 ${levelInfo.maxLevel} 级</span>
                            </div>
                            <div class="cw-companion-stat-card-bar">
                                <div class="cw-companion-stat-card-fill" style="width:${pct}%"></div>
                            </div>
                            ${levelInfo.desc ? `<div class="cw-companion-stat-card-level-desc">${this._escape(levelInfo.desc)}</div>` : ''}
                            ${isCapped ? `
                                <div class="cw-companion-stat-card-cap-warn">
                                    🔒 已达当前阶段上限 ${cap}（进入下一阶段可继续提升）
                                </div>
                            ` : ''}
                        </div>`;
                }

                const hasMax = typeof s.max === 'number' && s.max > 0;
                const pct = hasMax ? Math.min(100, (s.value / s.max) * 100) : 0;

                return `
                    <div class="cw-companion-stat-card ${isCapped ? 'capped' : ''}">
                        <div class="cw-companion-stat-card-head">
                            <span class="cw-companion-stat-card-icon">${s.emoji || '·'}</span>
                            <span class="cw-companion-stat-card-label">${this._escape(s.label || key)}</span>
                            <span class="cw-companion-stat-card-value">
                                ${Math.round(s.value)}${hasMax ? `<span class="max"> / ${s.max}</span>` : ''}
                            </span>
                        </div>
                        ${s.desc ? `<div class="cw-companion-stat-card-desc">${this._escape(s.desc)}</div>` : ''}
                        ${hasMax ? `
                            <div class="cw-companion-stat-card-bar">
                                <div class="cw-companion-stat-card-fill" style="width:${pct}%"></div>
                            </div>
                        ` : ''}
                        ${isCapped ? `
                            <div class="cw-companion-stat-card-cap-warn">
                                🔒 已达当前阶段上限 ${cap}（进入下一阶段可继续提升）
                            </div>
                        ` : ''}
                    </div>`;
            };

            // ★ 角色属性
            const statsHTML = (bond.statsOrder || []).map(key => {
                const s = bond.stats[key];
                if (!s) return '';
                return renderStatCard(s, key, 'stats');
            }).join('');

            // ★ 养成属性
            const bondStatsHTML = (bond.bondStatsOrder || []).map(key => {
                const s = bond.bondStats[key];
                if (!s) return '';
                return renderStatCard(s, key, 'bondStats');
            }).join('');

            // ★ 行动
            const actionsHTML = (bond.actions || []).map(a => {
                const check = BondManager.canPerformAction(bond, a.id);
                const available = check.ok;

                const costText = Object.entries(a.cost || {})
                    .map(([k, v]) => `${k}×${v}`).join('、');
                const effectText = Object.entries(a.effects || {})
                    .map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`).join('、');
                const cdText = COOLDOWN_TYPES[a.cooldown] || '';

                let badgeHTML = '';
                if (!available) {
                    if (check.reason === 'capped') {
                        badgeHTML = '<span class="cw-companion-action-cd capped">🔒 已达上限</span>';
                    } else {
                        badgeHTML = '<span class="cw-companion-action-cd">已用</span>';
                    }
                }

                return `
                    <div class="cw-companion-action-row">
                        <button class="cw-companion-action-btn ${available ? '' : 'disabled'}"
                            onclick="CompanionUI.doAction('${this._attr(name)}', '${this._attr(a.id)}')"
                            ${available ? '' : 'disabled'}>
                            <span class="cw-companion-action-icon">${a.emoji || '⚡'}</span>
                            <div class="cw-companion-action-info">
                                <div class="cw-companion-action-name">${this._escape(a.name)}</div>
                                <div class="cw-companion-action-meta">
                                    ${this._escape(a.desc || '')}
                                </div>
                                <div class="cw-companion-action-sub">
                                    ${cdText}
                                    ${costText ? ' · 消耗 ' + this._escape(costText) : ''}
                                    ${effectText ? ' · ' + this._escape(effectText) : ''}
                                </div>
                            </div>
                            ${badgeHTML}
                        </button>
                        <button class="cw-companion-quick-btn ${available ? '' : 'disabled'}"
                            onclick="CompanionUI.doQuickAction('${this._attr(name)}', '${this._attr(a.id)}')"
                            ${available ? '' : 'disabled'}
                            title="快速行动（不生成剧情）">
                            <span class="icon">⚡</span>
                            <span>快行</span>
                        </button>
                    </div>`;
            }).join('');

            // ★ 阶段剧情块
            const pending = BondManager.getPendingStage(bond);

            const curIdx = bond.stages.findIndex(s => s.id === bond.currentStageId);
            const futureIdx = pending
                ? bond.stages.findIndex(s => s.id === pending.id) + 1
                : curIdx + 1;
            const future = bond.stages[futureIdx] || null;

            let stageStoryHTML = '';

            if (pending) {
                const condText = this._formatStageCondition(pending.minStat || {});
                stageStoryHTML = `
                    <div class="cw-companion-stage-block ready">
                        <div class="cw-companion-stage-info">
                            <div class="cw-companion-stage-name">🎬 可进入：${this._escape(pending.name)}</div>
                            <div class="cw-companion-stage-desc">${this._escape(pending.desc || '')}</div>
                            <div class="cw-companion-stage-cond">
                                条件已满足：${this._escape(condText || '无')} ✅
                            </div>
                        </div>
                        <button class="cw-companion-stage-btn"
                            onclick="CompanionUI.triggerStageStory('${this._attr(name)}', '${this._attr(pending.id)}')">
                            🎬 触发剧情
                        </button>
                    </div>`;
            } else if (future) {
                const condMet = BondManager._matchStage(bond, future);
                const condText = this._formatStageCondition(future.minStat || {});
                stageStoryHTML = `
                    <div class="cw-companion-stage-block">
                        <div class="cw-companion-stage-info">
                            <div class="cw-companion-stage-name">下一阶段：${this._escape(future.name)}</div>
                            <div class="cw-companion-stage-desc">${this._escape(future.desc || '')}</div>
                            <div class="cw-companion-stage-cond">
                                需要：${this._escape(condText || '无')}
                                ${condMet ? ' ✅' : ' ⏳'}
                            </div>
                        </div>
                    </div>`;
            }

            const avatarHTML = this._pickAvatar(record, name);

            return `
                <div class="cw-companion-portrait" data-companion-avatar="${this._attr(name)}">
                    ${avatarHTML}
                </div>

                ${summonHTML}

                <div class="cw-companion-stage-current">
                    <span class="cw-companion-stage-current-icon">🎖️</span>
                    <span class="cw-companion-stage-current-name">${stage ? this._escape(stage.name) : '初识'}</span>
                    <span class="cw-companion-stage-current-desc">${stage ? this._escape(stage.desc) : ''}</span>
                </div>

                ${profileHTML}

                <div class="cw-companion-section">
                    <div class="cw-companion-section-title">⚔️ 角色属性</div>
                    ${statsHTML
                        ? `<div class="cw-companion-stats-grid">${statsHTML}</div>`
                        : '<div class="cw-companion-empty-line">（无角色属性）</div>'}
                </div>

                <div class="cw-companion-section">
                    <div class="cw-companion-section-title">📊 养成属性</div>
                    ${bondStatsHTML
                        ? `<div class="cw-companion-stats-grid">${bondStatsHTML}</div>`
                        : '<div class="cw-companion-empty-line">（无养成属性）</div>'}
                </div>

                <div class="cw-companion-section">
                    <div class="cw-companion-section-title">⚡ 养成行动</div>
                    ${actionsHTML || '<div class="cw-companion-empty-line">（无可用行动）</div>'}
                </div>

                ${stageStoryHTML}
            `;
        },

        _formatStageCondition(minStat) {
            const parts = [];
            for (const [k, cond] of Object.entries(minStat)) {
                const sub = [];
                if (cond.level !== undefined) sub.push(`Lv.${cond.level}`);
                if (cond.value !== undefined) sub.push(`≥${cond.value}`);
                parts.push(`${k} ${sub.join(' 且 ')}`);
            }
            return parts.join('、') || '无';
        },

        // ============================================================
        // ★ 召唤状态栏
        // ============================================================
        _renderSummonButton(name, bond) {
            if (!window.CompanionSummonManager) return '';
        
            const playMode = window.CinemaWorld?.worldState?.playMode;
            const currentMap = window.MapLauncher?.getMap?.();
            const summon = bond.summon || {};
        
            // ★ 关键：只有"当前地图 + active"才算在地图上
            const isActiveHere = !!(
                summon.active &&
                currentMap &&
                summon.mapName === currentMap.name
            );
            const isActiveElsewhere = !!(
                summon.active &&
                currentMap &&
                summon.mapName &&
                summon.mapName !== currentMap.name
            );
        
            const cooldownUntil = summon.cooldownUntil || 0;
            const now = Date.now();
        
            // ---------- 在当前地图上 ----------
            if (isActiveHere) {
                return `
                    <div class="cw-companion-summon-bar active">
                        <div class="cw-companion-summon-status">
                            <span class="cw-companion-summon-icon">🎯</span>
                            <span class="cw-companion-summon-text">已在地图上，跟随中</span>
                        </div>
                        <div class="cw-companion-summon-actions">
                            <button class="cw-companion-summon-btn secondary"
                                onclick="CompanionUI._goToCompanionOnMap('${this._attr(name)}')">
                                📍 定位
                            </button>
                            <button class="cw-companion-summon-btn danger"
                                onclick="CompanionUI._recallCompanion('${this._attr(name)}')">
                                📦 收回
                            </button>
                        </div>
                    </div>
                `;
            }
        
            // ---------- 冷却中 ----------
            if (cooldownUntil > now) {
                const remain = cooldownUntil - now;
                const remainText = this._formatRemain(remain);
        
                return `
                    <div class="cw-companion-summon-bar cooldown">
                        <div class="cw-companion-summon-status">
                            <span class="cw-companion-summon-icon">🔒</span>
                            <span class="cw-companion-summon-text">冷却中（剩余 ${remainText}）</span>
                        </div>
                        <div class="cw-companion-summon-actions">
                            <button class="cw-companion-summon-btn" disabled>冷却中</button>
                        </div>
                    </div>
                `;
            }
        
            // ---------- 不在地图模式 ----------
            if (playMode !== 'map') {
                return `
                    <div class="cw-companion-summon-bar disabled">
                        <div class="cw-companion-summon-status">
                            <span class="cw-companion-summon-icon">🎯</span>
                            <span class="cw-companion-summon-text">请先进入地图</span>
                        </div>
                        <div class="cw-companion-summon-actions">
                            <button class="cw-companion-summon-btn" disabled>召唤</button>
                        </div>
                    </div>
                `;
            }
        
            // ---------- 在别的地图上 ----------
            if (isActiveElsewhere) {
                return `
                    <div class="cw-companion-summon-bar disabled">
                        <div class="cw-companion-summon-status">
                            <span class="cw-companion-summon-icon">📍</span>
                            <span class="cw-companion-summon-text">在【${summon.mapName}】上</span>
                        </div>
                        <div class="cw-companion-summon-actions">
                            <button class="cw-companion-summon-btn"
                                onclick="CompanionUI._forceRecallCompanion('${this._attr(name)}')">
                                📦 收回
                            </button>
                        </div>
                    </div>
                `;
            }
        
            // ---------- 可召唤 ----------
            return `
                <div class="cw-companion-summon-bar ready">
                    <div class="cw-companion-summon-status">
                        <span class="cw-companion-summon-icon">🎯</span>
                        <span class="cw-companion-summon-text">可以召唤</span>
                    </div>
                    <div class="cw-companion-summon-actions">
                        <button class="cw-companion-summon-btn primary"
                            onclick="CompanionUI._summonCompanion('${this._attr(name)}')">
                            🎯 召唤
                        </button>
                    </div>
                </div>
            `;
        },
        _forceRecallCompanion(name) {
            const bond = BondManager.getBond(name);
            if (!bond) return;
        
            if (!confirm(`确定收回「${name}」？\n\n她/他目前在【${bond.summon?.mapName || '别的地图'}】上。`)) return;
        
            const currentMap = window.MapLauncher?.getMap?.();
        
            // ★ 只清状态，不删别的地图实体（别的地图实体在切图时会清）
            bond.summon = bond.summon || {};
            bond.summon.active = false;
            bond.summon.entityId = null;
            bond.summon.mapName = null;
        
            CompanionManager.save();
            window.UIManager?.showText?.(`📦 ${name} 已收回`, 2000);
            this._rerenderCurrentView();
        },
        _summonCompanion(name) {
            if (!window.CompanionSummonManager) return;
        
            const check = window.CompanionSummonManager.canSummon(name);
            if (!check.ok) {
                window.UIManager?.showText?.(check.message || '无法召唤', 2000);
                return;
            }
        
            window.CompanionSummonUI?.openSummonPanel?.(name);
        },
        // ★ 召唤（弹面板）
        _summonCompanion(name) {
            if (!window.CompanionSummonManager) return;

            const check = window.CompanionSummonManager.canSummon(name);
            if (!check.ok) {
                window.UIManager?.showText?.(check.message || '无法召唤', 2000);
                return;
            }

            // 弹召唤面板
            window.CompanionSummonUI?.openSummonPanel?.(name);
        },

        // ★ 收回
        _recallCompanion(name) {
            if (!window.CompanionSummonManager) return;

            if (!confirm(`确定收回「${name}」？\n\n她/他会从地图上消失，但随时可以再次召唤。`)) return;

            window.CompanionSummonManager.recall(name);
            this._rerenderCurrentView();
        },

        // ★ 定位到地图上的队友
        _goToCompanionOnMap(name) {
            const ent = window.CompanionSummonManager?.getCompanionEntity?.(name);
            if (!ent || !window.MapCanvas) {
                window.UIManager?.showText?.('队友不在当前地图', 1500);
                return;
            }

            // 关闭手机
            if (window.PhoneUIManager?.close) {
                window.PhoneUIManager.close();
            }

            // 相机移到队友
            setTimeout(() => {
                const canvas = window.MapCanvas;
                const viewW = canvas._cssW / canvas.config.tileSize;
                const viewH = canvas._cssH / canvas.config.tileSize;
                canvas.camera.x = Math.max(0, ent.x - viewW / 2);
                canvas.camera.y = Math.max(0, ent.y - viewH / 2);
                canvas._render();

                window.UIManager?.showText?.(`📍 队友「${name}」在这里`, 2000);
            }, 200);
        },

        // ★ 格式化剩余时间
        _formatRemain(ms) {
            if (ms <= 0) return '0 秒';
            const sec = Math.floor(ms / 1000);
            if (sec < 60) return `${sec} 秒`;
            const min = Math.floor(sec / 60);
            if (min < 60) return `${min} 分钟`;
            const hour = Math.floor(min / 60);
            if (hour < 24) return `${hour} 小时`;
            const day = Math.floor(hour / 24);
            return `${day} 天`;
        },

        // ============================================================
        // 档案渲染
        // ============================================================
        _renderProfile(bond) {
            const p = bond?.profile;
            if (!p) return '';

            const rows = [];
            if (p.gender) rows.push({ key: '性别', val: p.gender });
            if (p.age) rows.push({ key: '年龄', val: p.age });
            if (p.personality) rows.push({ key: '性格', val: p.personality });
            if (p.mood) rows.push({ key: '心情', val: p.mood });
            if (p.status) rows.push({ key: '状态', val: p.status });
            if (p.appearance) rows.push({ key: '外貌', val: p.appearance });
            if (p.outfit) rows.push({ key: '穿着', val: p.outfit });

            for (const k of (p._extraOrder || [])) {
                if (p._extra?.[k]) rows.push({ key: k, val: p._extra[k] });
            }

            const tableHTML = rows.length > 0
                ? `<div class="cw-companion-profile-table">
                     ${rows.map(r => `
                        <div class="cw-companion-profile-row">
                            <span class="cw-companion-profile-key">${this._escape(r.key)}</span>
                            <span class="cw-companion-profile-val">${this._escape(r.val)}</span>
                        </div>
                     `).join('')}
                   </div>`
                : '<div class="cw-companion-empty-line">（暂无档案）</div>';

            const bgHTML = p.background
                ? `<div class="cw-companion-bg">
                     <div class="cw-companion-bg-label">📜 背景故事</div>
                     <div class="cw-companion-bg-text">${this._escape(p.background)}</div>
                   </div>`
                : '';

            const exps = (p.experiences || []).slice(-5).reverse();
            const expHTML = exps.length > 0
                ? `<div class="cw-companion-exp">
                     <div class="cw-companion-exp-label">📖 经历</div>
                     ${exps.map(e => `
                        <div class="cw-companion-exp-item">
                            <div class="cw-companion-exp-title">${this._escape(e.title || '')}</div>
                            <div class="cw-companion-exp-text">${this._escape(e.text || '')}</div>
                        </div>
                     `).join('')}
                   </div>`
                : '';

            return `
                <div class="cw-companion-section">
                    <div class="cw-companion-section-title">👤 档案</div>
                    ${tableHTML}
                    ${bgHTML}
                    ${expHTML}
                </div>`;
        },

        // ============================================================
        // 执行养成行动
        // ============================================================
        async doAction(name, actionId) {
            const bond = BondManager.getBond(name);
            const action = BondManager.getAction(bond, actionId);
            if (!bond || !action) return;

            const check = BondManager.canPerformAction(bond, actionId);
            if (!check.ok) {
                window.UIManager?.showText?.(check.message, 1500);
                return;
            }

            const costCheck = this._checkCost(action.cost);
            if (!costCheck.ok) {
                window.UIManager?.showText?.(costCheck.message, 2000);
                return;
            }

            const ok = await this._confirmAction(action);
            if (!ok) return;

            this._payCost(action.cost);

            window.UIManager?.showText?.(`正在生成剧情...`, 800);

            const story = await CompanionAIManager.generateActionStory(name, actionId);

            if (!story) {
                window.UIManager?.showText?.('剧情生成失败', 1500);
                this._refundCost(action.cost);
                return;
            }

            BondManager.markActionUsed(bond, actionId);

            const applied = this._applyStoryEffects(bond, action, story);

            BondManager._log(bond, `${action.emoji} ${action.name}`);
            BondManager.recalcStage(bond);

            await this._playStory(story);

            if (applied.changes.length > 0) {
                const text = applied.changes.map(c => `${c.key} ${c.delta > 0 ? '+' : ''}${c.delta}`).join('、');
                await window.UIManager?.showText?.(`✨ ${text}`, 2000);
            }

            CompanionManager.save();
            this._rerenderCurrentView();
        },

        // ============================================================
        // 快速行动
        // ============================================================
        async doQuickAction(name, actionId) {
            const bond = BondManager.getBond(name);
            const action = BondManager.getAction(bond, actionId);
            if (!bond || !action) return;

            const check = BondManager.canPerformAction(bond, actionId);
            if (!check.ok) {
                window.UIManager?.showText?.(check.message, 1500);
                return;
            }

            const costCheck = this._checkCost(action.cost);
            if (!costCheck.ok) {
                window.UIManager?.showText?.(costCheck.message, 2000);
                return;
            }

            const ok = await this._confirmQuickAction(action);
            if (!ok) return;

            this._payCost(action.cost);
            BondManager.markActionUsed(bond, actionId);

            const changes = [];
            for (const [key, delta] of Object.entries(action.effects || {})) {
                if (BondManager.addStatValue(bond, key, delta)) {
                    changes.push({ key, delta });
                }
            }

            BondManager._log(bond, `⚡ ${action.name}（快速）`);
            BondManager.recalcStage(bond);

            if (changes.length > 0) {
                const text = changes.map(c => `${c.key} ${c.delta > 0 ? '+' : ''}${c.delta}`).join('、');
                window.UIManager?.showText?.(`⚡ ${action.name}：${text}`, 2000);
            } else {
                window.UIManager?.showText?.(`⚡ ${action.name} 已执行`, 1500);
            }

            CompanionManager.save();
            this._rerenderCurrentView();
        },

        // ============================================================
        // 触发阶段剧情
        // ============================================================
        async triggerStageStory(name, stageId) {
            const bond = BondManager.getBond(name);
            const stage = BondManager.getStage(bond, stageId);
            if (!bond || !stage) return;

            if (!BondManager.canTriggerStageStory(bond, stageId)) {
                window.UIManager?.showText?.('条件未满足', 1500);
                return;
            }

            const ok = await this._confirmStageStory(stage);
            if (!ok) return;

            window.UIManager?.showText?.('正在生成剧情...', 800);

            const story = await CompanionAIManager.generateStageStory(name, stageId);
            if (!story) {
                window.UIManager?.showText?.('剧情生成失败', 1500);
                return;
            }

            BondManager._log(bond, `🎬 触发阶段剧情：${stage.name}`);

            this._applyStoryEffects(bond, { effects: {} }, story);

            BondManager.addExperience(bond, {
                title: `阶段进展 · ${stage.name}`,
                text: stage.desc || '',
                source: 'stage',
                chapterId: window.StoryManager?.currentChapter?.id || null,
            });

            await this._playStory(story);
            this._writeDigest(name, story, `阶段剧情：${stage.name}`);

            const entered = await BondManager.enterStage(bond, stageId);
            if (entered) {
                window.UIManager?.showText?.(`🎖️ 关系进入「${stage.name}」`, 2500);
            }

            CompanionManager.save();
            this._rerenderCurrentView();
        },

        _rerenderCurrentView() {
            if (this.currentView === 'modal-detail') {
                this.openModalDetail(this.currentMemberName);
            } else {
                this.render('detail');
            }
        },

        // ============================================================
        // 菜单 / 日志 / 里程碑 / 私聊 / 离队
        // ============================================================
        openMenu(name) {
            const bond = BondManager.getBond(name);
            const record = CharacterRegistry.get(name);
            if (!bond || !record) return;

            // ★ 召唤相关菜单项
            let summonMenuItem = '';
            if (window.CompanionSummonManager) {
                const summon = bond.summon || {};
                if (summon.active) {
                    summonMenuItem = `
                        <div class="cw-social-menu-item" onclick="CompanionUI.openChat('${this._attr(name)}'); UIManager.closeModal();">
                            💬 私聊
                        </div>
                        <div class="cw-social-menu-item" style="color:#ffb8b8;" onclick="UIManager.closeModal(); CompanionUI._recallCompanion('${this._attr(name)}');">
                            📦 从地图收回
                        </div>
                    `;
                } else {
                    summonMenuItem = `
                        <div class="cw-social-menu-item" onclick="CompanionUI.openChat('${this._attr(name)}'); UIManager.closeModal();">
                            💬 私聊
                        </div>
                        <div class="cw-social-menu-item" style="color:#7dd87d;" onclick="UIManager.closeModal(); CompanionUI._summonCompanion('${this._attr(name)}');">
                            🎯 召唤到地图
                        </div>
                    `;
                }
            } else {
                summonMenuItem = `
                    <div class="cw-social-menu-item" onclick="CompanionUI.openChat('${this._attr(name)}'); UIManager.closeModal();">
                        💬 私聊
                    </div>
                `;
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚙️ ${this._escape(name)}</div>
                <div class="cw-social-chat-menu">
                    ${summonMenuItem}
                    <div class="cw-social-menu-item" onclick="UIManager.closeModal(); CompanionUI.openLog('${this._attr(name)}');">
                        📜 日志
                    </div>
                    <div class="cw-social-menu-item" onclick="UIManager.closeModal(); CompanionUI.openMilestones('${this._attr(name)}');">
                        🏆 里程碑
                    </div>
                    <div class="cw-social-menu-item danger" onclick="UIManager.closeModal(); CompanionUI.confirmLeave('${this._attr(name)}');">
                        🚪 离队
                    </div>
                </div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },

        openLog(name) {
            const bond = BondManager.getBond(name);
            if (!bond) return;

            const logs = (bond.log || []).slice(-30).reverse();
            const logsHTML = logs.length > 0
                ? logs.map(l => {
                    const d = new Date(l.ts);
                    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                    return `<div class="cw-companion-log-line">
                        <span class="cw-companion-log-time">${t}</span>
                        <span class="cw-companion-log-text">${this._escape(l.text)}</span>
                    </div>`;
                }).join('')
                : '<div class="cw-companion-empty-line">暂无日志</div>';

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📜 ${this._escape(name)} 的日志</div>
                <div style="max-height:60vh;overflow-y:auto;padding:8px;background:rgba(0,0,0,.2);border-radius:10px;">
                    ${logsHTML}
                </div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },

        openMilestones(name) {
            const bond = BondManager.getBond(name);
            if (!bond) return;

            const ms = (bond.milestones || []).slice().reverse();
            const msHTML = ms.length > 0
                ? ms.map(m => {
                    const d = new Date(m.ts);
                    const t = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                    const icon = m.type === 'levelup' ? '⭐' : (m.type === 'stage' ? '🎖️' : '📌');
                    return `
                        <div class="cw-companion-milestone-item">
                            <div class="cw-companion-milestone-head">
                                <span class="cw-companion-milestone-icon">${icon}</span>
                                <span class="cw-companion-milestone-title">${this._escape(m.title)}</span>
                                <span class="cw-companion-milestone-time">${t}</span>
                            </div>
                            ${m.detail ? `<div class="cw-companion-milestone-detail">${this._escape(m.detail)}</div>` : ''}
                        </div>`;
                }).join('')
                : '<div class="cw-companion-empty-line">还没有里程碑</div>';

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🏆 ${this._escape(name)} 的里程碑</div>
                <div style="max-height:60vh;overflow-y:auto;padding:8px;background:rgba(0,0,0,.2);border-radius:10px;">
                    ${msHTML}
                </div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },

        openChat(name) {
            const conv = window.SocialDataManager?.ensureSingleChat?.(name);
            if (!conv) {
                window.UIManager?.showText?.('社交系统未加载', 1500);
                return;
            }
            window.UIManager.closeModal();

            if (window.PhoneUIManager) {
                window.PhoneUIManager.openApp('social');
            }
            if (window.SocialAppUI) {
                window.SocialAppUI.openChat(conv.id);
            }
        },

        confirmLeave(name) {
            const ok = confirm(`确定让「${name}」离开队伍吗？\n\n（养成记录会保留，可以再邀请回来）`);
            if (!ok) return;

            window.UIManager.closeModal();
            this._doLeave(name);
        },

        async _doLeave(name) {
            const reason = prompt('（可选）告诉她你的理由：', '') || '';

            window.UIManager?.showText?.('正在生成剧情...', 800);

            const story = await CompanionAIManager.generateLeaveStory(name, reason);

            const result = CompanionManager.leave(name);
            if (!result.ok) {
                window.UIManager?.showText?.(result.message, 1500);
                return;
            }

            if (story) {
                await this._playStory(story);
            }

            window.UIManager?.showText?.(`🚪 ${name} 离开了队伍`, 2000);

            this.currentView = 'list';
            this.currentMemberName = null;
            this.render('list');
        },

        // ============================================================
        // 成本
        // ============================================================
        _checkCost(cost) {
            if (!cost || Object.keys(cost).length === 0) return { ok: true };
            const player = PlayerStateManager.player;
            if (!player) return { ok: false, message: '玩家未加载' };

            for (const [key, value] of Object.entries(cost)) {
                const need = Number(value) || 0;

                const bar = (player.statusBars || []).find(b =>
                    b.key === key || b.key.includes(key) || key.includes(b.key)
                );
                if (bar) {
                    if ((Number(bar.current) || 0) < need) {
                        return { ok: false, message: `${key}不足（需 ${need}）` };
                    }
                    continue;
                }

                const extra = player.extraStats;
                if (extra && Array.isArray(extra._order)) {
                    const ek = extra._order.find(k =>
                        k === key || k.includes(key) || key.includes(k)
                    );
                    if (ek !== undefined) {
                        const cur = parseFloat(String(extra[ek] ?? '0').replace(/[^\d.\-]/g, '')) || 0;
                        if (cur < need) return { ok: false, message: `${key}不足（需 ${need}）` };
                        continue;
                    }
                }

                const item = (player.inventory || []).find(i => i.name === key);
                if (!item || (item.count || 1) < need) {
                    return { ok: false, message: `${key}不足` };
                }
            }
            return { ok: true };
        },

        _payCost(cost) {
            if (!cost) return;
            const player = PlayerStateManager.player;
            if (!player) return;

            for (const [key, value] of Object.entries(cost)) {
                const need = Number(value) || 0;

                const bar = (player.statusBars || []).find(b =>
                    b.key === key || b.key.includes(key) || b.key.includes(b.key)
                );
                if (bar) {
                    bar.current = Math.max(0, (Number(bar.current) || 0) - need);
                    continue;
                }

                const extra = player.extraStats;
                if (extra && Array.isArray(extra._order)) {
                    const ek = extra._order.find(k =>
                        k === key || k.includes(key) || k.includes(k)
                    );
                    if (ek !== undefined) {
                        const raw = String(extra[ek] ?? '0');
                        const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                        const cur = m ? parseFloat(m[1]) : 0;
                        const unit = m ? (m[2] || '') : '';
                        extra[ek] = `${Math.max(0, cur - need)}${unit}`;
                        continue;
                    }
                }

                const item = (player.inventory || []).find(i => i.name === key);
                if (item) {
                    item.count = (item.count || 1) - need;
                    if (item.count <= 0) {
                        const idx = player.inventory.indexOf(item);
                        if (idx > -1) player.inventory.splice(idx, 1);
                    }
                }
            }

            PlayerStateManager.refreshAvatarArea?.();
        },

        _refundCost(cost) {
            if (!cost) return;
            const player = PlayerStateManager.player;
            if (!player) return;

            for (const [key, value] of Object.entries(cost)) {
                const back = Number(value) || 0;

                const bar = (player.statusBars || []).find(b =>
                    b.key === key || b.key.includes(key) || b.key.includes(b.key)
                );
                if (bar) {
                    bar.current = Math.min(bar.max, (Number(bar.current) || 0) + back);
                    continue;
                }

                const extra = player.extraStats;
                if (extra && Array.isArray(extra._order)) {
                    const ek = extra._order.find(k =>
                        k === key || k.includes(key) || k.includes(k)
                    );
                    if (ek !== undefined) {
                        const raw = String(extra[ek] ?? '0');
                        const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                        const cur = m ? parseFloat(m[1]) : 0;
                        const unit = m ? (m[2] || '') : '';
                        extra[ek] = `${cur + back}${unit}`;
                        continue;
                    }
                }

                const item = (player.inventory || []).find(i => i.name === key);
                if (item) {
                    item.count = (item.count || 1) + back;
                } else {
                    player.inventory.push({
                        name: key, count: back,
                        icon: '📦', description: '', fields: {}, type: 'item',
                    });
                }
            }

            PlayerStateManager.refreshAvatarArea?.();
        },

        // ============================================================
        // 应用剧情效果
        // ============================================================
        _applyStoryEffects(bond, action, storyText) {
            const changes = [];

            for (const [key, delta] of Object.entries(action.effects || {})) {
                if (BondManager.addStatValue(bond, key, delta)) {
                    changes.push({ key, delta });
                }
            }

            const effectM = storyText.match(/【效果】\s*([\s\S]*?)(?=\n【|$)/);
            if (effectM) {
                const body = effectM[1];

                const numM = body.match(/数值变化\s*[:：]\s*(.+)/);
                if (numM) {
                    const parts = numM[1].split(/[，,、\/／]/).map(s => s.trim());
                    for (const p of parts) {
                        const m = p.match(/^(.+?)\s*([+\-])\s*(\d+)$/);
                        if (!m) continue;
                        const key = m[1].trim();
                        const delta = (m[2] === '-' ? -1 : 1) * parseInt(m[3]);
                        if (BondManager.addStatValue(bond, key, delta)) {
                            changes.push({ key, delta });
                        }
                    }
                }

                const profileM = body.match(/档案更新\s*[:：]\s*([\s\S]*?)(?=\n(?:经历|【|$))/);
                if (profileM) {
                    const lines = profileM[1].split('\n').map(l => l.trim()).filter(Boolean);
                    const updates = {};
                    for (const line of lines) {
                        const kv = line.match(/^[-•]?\s*([^:：]+?)\s*[:：]\s*(.+)$/);
                        if (kv) updates[kv[1].trim()] = kv[2].trim();
                    }
                    if (Object.keys(updates).length > 0) {
                        BondManager.applyProfileUpdates(bond, updates);
                    }
                }

                const expM = body.match(/经历\s*[:：]\s*([\s\S]*?)(?=\n(?:档案更新|【|$))/);
                if (expM) {
                    const lines = expM[1].split('\n').map(l => l.trim()).filter(Boolean);
                    for (const line of lines) {
                        const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]?\s*(.+)$/);
                        if (!m) continue;
                        BondManager.addExperience(bond, {
                            title: m[1].trim(),
                            text: m[2].trim(),
                            source: 'action',
                            chapterId: window.StoryManager?.currentChapter?.id || null,
                        });
                    }
                }
            }

            return { changes };
        },

        // ============================================================
        // 播放剧情
        // ============================================================
        async _playStory(storyText) {
            const script = storyText.replace(/【效果】[\s\S]*?(?=\n【|$)/, '')
                .replace(/【摘要】[\s\S]*?(?=\n【|$)/, '')
                .replace(/RESULT\s*[:：]\s*(ACCEPT|REJECT)/gi, '')
                .trim();

            if (window.MusicManager) {
                await window.MusicManager.applyMusicMarker(storyText);
            }

            const dialogues = window.VisualNovelManager?.parseScript(script) || [];
            if (dialogues.length > 0) {
                await window.VisualNovelManager.play(dialogues);
            } else {
                await window.UIManager?.showText?.(script, 5000);
            }

            if (window.MusicManager) {
                await window.MusicManager.clearOverrideMusic();
            }
        },

        _writeDigest(name, storyText, source) {
            const summaryM = storyText.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
            if (!summaryM) return;
            const summary = summaryM[1].trim();
            if (!summary) return;

            const chapterId = window.StoryManager?.currentChapter?.id || null;

            if (window.InteractionHistoryManager) {
                window.InteractionHistoryManager.add({
                    type: 'companion',
                    target: name,
                    targetMeta: { source },
                    scene: '(队伍)',
                    playerInput: source,
                    script: '',
                    effect: null,
                    summary,
                    chapterId,
                });
            }

            if (window.InteractionDigestManager) {
                window.InteractionDigestManager.add({
                    targetType: 'item',
                    target: `队伍:${name}`,
                    source: 'companion',
                    summary,
                    chapterId,
                });
            }
        },

        // ============================================================
        // 确认框
        // ============================================================
        _confirmAction(action) {
            return new Promise(resolve => {
                const costText = Object.entries(action.cost || {})
                    .map(([k, v]) => `${k}×${v}`).join('、') || '无';
                const effectText = Object.entries(action.effects || {})
                    .map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`).join('、') || '无';

                const modal = document.getElementById('cinemaworld-modal');
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">${action.emoji} ${this._escape(action.name)}</div>
                    <div class="cw-companion-confirm-body">
                        <div class="cw-companion-confirm-row">
                            <span>描述</span><span>${this._escape(action.desc || '')}</span>
                        </div>
                        <div class="cw-companion-confirm-row">
                            <span>消耗</span><span>${this._escape(costText)}</span>
                        </div>
                        <div class="cw-companion-confirm-row">
                            <span>效果</span><span style="color:#7dd87d;">${this._escape(effectText)}</span>
                        </div>
                    </div>
                    <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;">
                        <button class="cinemaworld-button primary" id="cw-companion-go">确认</button>
                        <button class="cinemaworld-button" id="cw-companion-cancel">取消</button>
                    </div>`;
                modal.className = 'active';

                document.getElementById('cw-companion-go').onclick = () => {
                    window.UIManager.closeModal();
                    resolve(true);
                };
                document.getElementById('cw-companion-cancel').onclick = () => {
                    window.UIManager.closeModal();
                    resolve(false);
                };
            });
        },

        _confirmQuickAction(action) {
            return new Promise(resolve => {
                const costText = Object.entries(action.cost || {})
                    .map(([k, v]) => `${k}×${v}`).join('、') || '无';
                const effectText = Object.entries(action.effects || {})
                    .map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`).join('、') || '无';

                const modal = document.getElementById('cinemaworld-modal');
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">⚡ 快速行动</div>
                    <div class="cw-companion-confirm-body">
                        <div class="cw-companion-confirm-row">
                            <span>行动</span><span>${action.emoji} ${this._escape(action.name)}</span>
                        </div>
                        <div class="cw-companion-confirm-row">
                            <span>消耗</span><span>${this._escape(costText)}</span>
                        </div>
                        <div class="cw-companion-confirm-row">
                            <span>效果</span><span style="color:#7dd87d;">${this._escape(effectText)}</span>
                        </div>
                    </div>
                    <div class="cw-companion-confirm-hint">
                        ⚡ 快速行动不会生成剧情，<br>
                        只应用数值变化。
                    </div>
                    <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;">
                        <button class="cinemaworld-button primary" id="cw-companion-go">确认</button>
                        <button class="cinemaworld-button" id="cw-companion-cancel">取消</button>
                    </div>`;
                modal.className = 'active';

                document.getElementById('cw-companion-go').onclick = () => {
                    window.UIManager.closeModal();
                    resolve(true);
                };
                document.getElementById('cw-companion-cancel').onclick = () => {
                    window.UIManager.closeModal();
                    resolve(false);
                };
            });
        },

        _confirmStageStory(stage) {
            return new Promise(resolve => {
                const modal = document.getElementById('cinemaworld-modal');
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">🎬 ${this._escape(stage.name)}</div>
                    <div class="cw-companion-confirm-body">
                        <div class="cw-companion-confirm-row">
                            <span>阶段</span><span>${this._escape(stage.name)}</span>
                        </div>
                        <div class="cw-companion-confirm-row">
                            <span>描述</span><span>${this._escape(stage.desc || '')}</span>
                        </div>
                    </div>
                    <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;">
                        <button class="cinemaworld-button primary" id="cw-companion-go">触发</button>
                        <button class="cinemaworld-button" id="cw-companion-cancel">取消</button>
                    </div>`;
                modal.className = 'active';

                document.getElementById('cw-companion-go').onclick = () => {
                    window.UIManager.closeModal();
                    resolve(true);
                };
                document.getElementById('cw-companion-cancel').onclick = () => {
                    window.UIManager.closeModal();
                    resolve(false);
                };
            });
        },

        // ============================================================
        // 头像
        // ============================================================
        _pickAvatar(record, fallbackName = '') {
            if (!record && fallbackName) {
                if (typeof SpriteManager !== 'undefined') {
                    SpriteManager.ensureSprite(fallbackName, '默认').then(url => {
                        if (!url) return;
                        document.querySelectorAll(`[data-companion-avatar="${CSS.escape(fallbackName)}"]`).forEach(el => {
                            el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
                        });
                    });
                }
                return fallbackName.charAt(0);
            }
            if (!record) return '👤';

            const name = record.name;
            const normName = record._normalizedName
                || (window.CharacterRegistry?.normalizeName?.(name)) || name;

            let url = null;
            if (typeof SpriteManager !== 'undefined') {
                url = SpriteManager.getCachedSprite(name);
                if (!url) url = SpriteManager.getCachedSprite(normName);
            }

            if (url) {
                return `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
            }

            if (typeof SpriteManager !== 'undefined') {
                SpriteManager.ensureSprite(name, record.gender).then(loadedUrl => {
                    if (!loadedUrl) return;
                    document.querySelectorAll(`[data-companion-avatar="${CSS.escape(name)}"]`).forEach(el => {
                        el.innerHTML = `<img src="${loadedUrl}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
                    });
                });
            }

            return record.gender === '女' ? '👩' : record.gender === '男' ? '👨' : '👤';
        },

        // ============================================================
        // 工具
        // ============================================================
        _escape(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
        _attr(str) {
            return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        },
    };

    window.CompanionUI = CompanionUI;
    console.log('[CinemaWorld/companion] companion-ui.js 已加载');
})();