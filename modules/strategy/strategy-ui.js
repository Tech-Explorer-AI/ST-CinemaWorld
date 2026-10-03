// ============================================================
// CinemaWorld · strategy-ui.js
// 战略面板 UI（含内政 · 阶级社会 + 无阶级社会）
// 依赖：strategy.js, ui.js
// ============================================================

(function () {
    'use strict';

    const StrategyUIManager = {
        _currentTab: 'faction',

        // ============================================================
        // 打开 / 关闭
        // ============================================================
        open() {
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;
            if (!window.StrategyManager.isInitialized()) {
                this._renderWelcome(modal);
                return;
            }
            this._render(modal);
        },

        close() {
            window.UIManager.closeModal();
        },

        _renderWelcome(modal) {
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🗺️ 战略面板</div>

                <div style="text-align:center;padding:20px 0;color:#aaa;font-size:14px;line-height:1.8;">
                    战略层是独立于剧情的势力博弈系统。<br>
                    你会拥有一个势力，和其他势力、地区进行外交、军事、经济博弈。<br><br>
                    <span style="color:#7da8ff;">先让 AI 根据当前世界生成势力与地区。</span>
                </div>

                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                        势力方向（可选）：
                    </div>
                    <textarea class="cinemaworld-textarea" id="cw-strategy-guide"
                        placeholder="例如：&#10;- 我是一个小门派，周围有三大势力环伺&#10;- 我们是末日幸存者营地，资源极度短缺&#10;- 星际殖民时代，我是三个殖民站的联合议会&#10;- 我是虫群意志，正在向星海扩张"
                        style="min-height:100px;"></textarea>
                </div>

                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" id="cw-strategy-gen-btn"
                        onclick="StrategyUIManager.onGenerateWorld()">
                        🤖 AI 生成势力与地区
                    </button>
                    <button class="cinemaworld-button" onclick="StrategyUIManager.close()">✖ 取消</button>
                </div>`;
            modal.className = 'active';
        },

        async onGenerateWorld() {
            const guide = document.getElementById('cw-strategy-guide')?.value.trim() || '';
            const btn = document.getElementById('cw-strategy-gen-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 生成中...'; }
            try {
                const result = await window.StrategyManager.generateWorld(guide);
                if (!result) {
                    window.UIManager.showText('❌ 生成失败', 2000);
                    if (btn) { btn.disabled = false; btn.innerHTML = '🤖 AI 生成势力与地区'; }
                    return;
                }
                window.UIManager.showText('✅ 战略层已生成', 1500);
                this.open();
            } catch (e) {
                console.error('[StrategyUI] 生成失败:', e);
                window.UIManager.showText(`❌ 生成失败：${e.message}`, 3000);
                if (btn) { btn.disabled = false; btn.innerHTML = '🤖 AI 生成势力与地区'; }
            }
        },

        // ============================================================
        // 主面板
        // ============================================================
        _render(modal) {
            const store = window.StrategyManager.ensureStore();
            const tabs = [
                { id: 'faction',  label: '👑 我方' },
                { id: 'others',   label: '🏰 其他势力' },
                { id: 'regions',  label: '🗺️ 地区' },
                { id: 'actions',  label: '⚡ 行动', badge: store.actions.filter(a => a.status === 'available').length },
                { id: 'politics', label: '🏛️ 内政' },
                { id: 'rules',    label: '📜 规则' },
                { id: 'turn',     label: '🔄 回合' },
            ];

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">
                    🗺️ 战略面板
                    <span style="font-size:12px;color:#888;margin-left:8px;font-weight:normal;">
                        第 ${store.turnCount} 回合
                    </span>
                </div>

                <div class="cw-strategy-tabs">
                    ${tabs.map(t => `
                        <button class="cw-strategy-tab ${this._currentTab === t.id ? 'active' : ''}"
                            onclick="StrategyUIManager.switchTab('${t.id}')">
                            ${t.label}
                            ${t.badge ? `<span class="cw-strategy-badge">${t.badge}</span>` : ''}
                        </button>
                    `).join('')}
                </div>

                <div class="cw-strategy-content">
                    ${this._renderTab()}
                </div>

                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" onclick="StrategyUIManager.onReset()"
                        style="color:#d87d7d;border-color:rgba(216,125,125,.4);">🔄 重置战略层</button>
                    <button class="cinemaworld-button" onclick="StrategyUIManager.close()">关闭</button>
                </div>
            `;
            modal.className = 'active cw-strategy-modal';
        },

        switchTab(tab) {
            this._currentTab = tab;
            this._render(document.getElementById('cinemaworld-modal'));
        },

        _renderTab() {
            switch (this._currentTab) {
                case 'faction':  return this._renderFactionTab();
                case 'others':   return this._renderOthersTab();
                case 'regions':  return this._renderRegionsTab();
                case 'actions':  return this._renderActionsTab();
                case 'politics': return this._renderPoliticsTab();
                case 'rules':    return this._renderRulesTab();
                case 'turn':     return this._renderTurnTab();
                default: return '';
            }
        },

        // ============================================================
        // 我方势力
        // ============================================================
        _renderFactionTab() {
            const f = window.StrategyManager.getPlayerFaction();
            if (!f) return `<div style="text-align:center;padding:40px;color:#888;">找不到我方势力</div>`;

            let leaderHTML = '';
            if (f.leader) {
                const lf = (f.leader.fields?._order || [])
                    .filter(k => f.leader.fields[k] !== undefined && f.leader.fields[k] !== '')
                    .map(k => `<span class="cw-strategy-chip small">${k}: ${f.leader.fields[k]}</span>`).join('');
                leaderHTML = `
                    <div class="cw-strategy-section">
                        <div class="cw-strategy-section-title">👑 势力领袖</div>
                        <div class="cw-strategy-leader">
                            <div class="cw-strategy-leader-icon">${f.leader.icon || '👤'}</div>
                            <div class="cw-strategy-leader-info">
                                <div class="cw-strategy-leader-name">
                                    ${f.leader.name}
                                    ${f.leader.title ? `<span class="cw-strategy-title-badge">${f.leader.title}</span>` : ''}
                                    ${f.leader.gender ? `<span class="cw-strategy-gender">${f.leader.gender}</span>` : ''}
                                </div>
                                ${f.leader.description ? `<div class="cw-strategy-leader-desc">${f.leader.description}</div>` : ''}
                                ${lf ? `<div class="cw-strategy-chips" style="margin-top:6px;">${lf}</div>` : ''}
                            </div>
                        </div>
                    </div>`;
            }

            let delegationHTML = '';
            if (f.delegation && f.delegation.length > 0) {
                delegationHTML = `
                    <div class="cw-strategy-section">
                        <div class="cw-strategy-section-title">👥 代表团 (${f.delegation.length})</div>
                        ${f.delegation.map((m, i) => this._renderDelegationMember(m, i, f.id)).join('')}
                    </div>`;
            }

            let fieldsHTML = '';
            if (f.fields && f.fields._order) {
                for (const k of f.fields._order) {
                    const v = f.fields[k];
                    if (v === undefined || v === '') continue;
                    const barM = String(v).match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(.*)$/);
                    if (barM) {
                        const cur = parseFloat(barM[1]);
                        const max = parseFloat(barM[2]);
                        const pct = max > 0 ? Math.min(100, cur / max * 100) : 0;
                        fieldsHTML += `
                            <div class="cw-strategy-field">
                                <div class="cw-strategy-field-label">
                                    <span>${k}</span>
                                    <span>${cur}/${max}${barM[3] || ''}</span>
                                </div>
                                <div class="cw-strategy-bar">
                                    <div class="cw-strategy-bar-fill" style="width:${pct}%"></div>
                                </div>
                            </div>`;
                    } else {
                        fieldsHTML += `<div class="cw-strategy-field-row">
                            <span class="key">${k}</span><span class="val">${v}</span>
                        </div>`;
                    }
                }
            }

            let relHTML = '';
            if (f.relations && Object.keys(f.relations).length > 0) {
                relHTML = `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🤝 外交关系</div>
                    ${Object.entries(f.relations).map(([name, r]) => {
                        const pct = (r.value + 100) / 2;
                        const color = r.value >= 30 ? '#7dd87d' : r.value >= -30 ? '#d8c07d' : '#d87d7d';
                        return `<div class="cw-strategy-field">
                            <div class="cw-strategy-field-label">
                                <span>${name}</span>
                                <span style="color:${color};">${r.value} · ${r.status}</span>
                            </div>
                            <div class="cw-strategy-bar">
                                <div class="cw-strategy-bar-fill" style="width:${pct}%;background:${color}"></div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>`;
            }

            return `
                <div class="cw-strategy-header">
                    <div class="cw-strategy-header-icon">${f.icon}</div>
                    <div class="cw-strategy-header-info">
                        <div class="cw-strategy-header-name">${f.name}</div>
                        <div class="cw-strategy-header-desc">${f.description || ''}</div>
                    </div>
                </div>

                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">📊 势力数据</div>
                    ${fieldsHTML || '<div style="color:#666;">暂无数据</div>'}
                </div>
                ${leaderHTML}
                ${delegationHTML}
                ${relHTML}
                <div style="text-align:center;margin-top:12px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="StrategyUIManager.onGenerateActions()">⚡ 生成行动</button>
                    <button class="cinemaworld-button" onclick="StrategyUIManager.onEditFaction()">✏️ 编辑数据</button>
                </div>`;
        },

        _renderDelegationMember(m, index, factionId) {
            const stanceClass = { '主战': 'cw-stance-war', '主和': 'cw-stance-peace', '中立': 'cw-stance-neutral', '阴谋': 'cw-stance-plot' }[m.stance] || 'cw-stance-neutral';
            const fields = (m.fields?._order || [])
                .filter(k => k !== '立场' && m.fields[k] !== undefined && m.fields[k] !== '')
                .map(k => `<span class="cw-strategy-chip small">${k}: ${m.fields[k]}</span>`).join('');
            return `
                <div class="cw-strategy-delegate" onclick="StrategyUIManager.onViewDelegate('${factionId}', '${m.name.replace(/'/g, "\\'")}')">
                    <div class="cw-strategy-delegate-icon">${m.icon || '👤'}</div>
                    <div class="cw-strategy-delegate-info">
                        <div class="cw-strategy-delegate-name">
                            ${m.name}
                            ${m.title ? `<span class="cw-strategy-title-badge small">${m.title}</span>` : ''}
                            <span class="cw-strategy-stance ${stanceClass}">${m.stance}</span>
                        </div>
                        ${m.description ? `<div class="cw-strategy-delegate-desc">${m.description}</div>` : ''}
                        ${fields ? `<div class="cw-strategy-chips" style="margin-top:4px;">${fields}</div>` : ''}
                    </div>
                </div>`;
        },

        onViewDelegate(factionId, memberName) {
            const f = window.StrategyManager.ensureStore().factions[factionId];
            if (!f) return;
            const m = f.delegation?.find(x => x.name === memberName);
            if (!m) return;
            const fields = (m.fields?._order || [])
                .filter(k => m.fields[k] !== undefined && m.fields[k] !== '')
                .map(k => `<div class="cw-strategy-field-row"><span class="key">${k}</span><span class="val">${m.fields[k]}</span></div>`).join('');
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">${m.icon || '👤'} ${m.name}</div>
                ${m.title ? `<div style="text-align:center;color:#7da8ff;font-size:13px;margin-bottom:10px;">${m.title}</div>` : ''}
                ${m.description ? `<div style="padding:12px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:12px;font-size:13px;color:#ddd;line-height:1.7;">${m.description}</div>` : ''}
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">📊 数据</div>
                    ${fields || '<div style="color:#666;">暂无数据</div>'}
                </div>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button" onclick="StrategyUIManager.open()">← 返回</button>
                </div>`;
            modal.className = 'active';
        },

        // ============================================================
        // 其他势力
        // ============================================================
        _renderOthersTab() {
            const others = window.StrategyManager.getOtherFactions();
            const playerFaction = window.StrategyManager.getPlayerFaction();
            if (others.length === 0) return `<div style="text-align:center;padding:40px;color:#888;">还没有其他势力</div>`;

            return others.map(f => {
                const rel = playerFaction?.relations?.[f.name];
                const relColor = rel?.value >= 30 ? '#7dd87d' : rel?.value >= -30 ? '#d8c07d' : '#d87d7d';
                const fields = (f.fields?._order || [])
                    .filter(k => f.fields[k] !== undefined && f.fields[k] !== '')
                    .map(k => `<span class="cw-strategy-chip">${k}: ${f.fields[k]}</span>`).join('');
                const leaderLine = f.leader ? `<div class="cw-strategy-card-sub" style="color:#9ab0ff;margin-top:4px;">👑 ${f.leader.name}${f.leader.title ? ` · ${f.leader.title}` : ''}</div>` : '';
                const delegationLine = (f.delegation?.length > 0) ? `<div class="cw-strategy-card-sub" style="color:#888;margin-top:2px;">👥 代表团 ${f.delegation.length} 人</div>` : '';

                return `
                    <div class="cw-strategy-card">
                        <div class="cw-strategy-card-head">
                            <div class="cw-strategy-card-icon">${f.icon}</div>
                            <div class="cw-strategy-card-title">
                                <div class="cw-strategy-card-name">${f.name}</div>
                                ${rel ? `<div class="cw-strategy-card-sub" style="color:${relColor};">
                                    与我国：${rel.value} · ${rel.status}
                                    ${leaderLine}${delegationLine}
                                </div>` : `${leaderLine}${delegationLine}`}
                            </div>
                        </div>
                        ${f.description ? `<div class="cw-strategy-card-desc">${f.description}</div>` : ''}
                        ${fields ? `<div class="cw-strategy-chips">${fields}</div>` : ''}
                        <div style="text-align:center;margin-top:10px;">
                            <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;"
                                onclick="StrategyUIManager.onViewFactionDetail('${f.id}')">🔍 详情</button>
                                <button class="cinemaworld-button primary" style="font-size:12px;padding:5px 12px;"
        onclick="StrategyUIManager._renderDiplomacy('${f.id}')">🤝 外交</button>
                            <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;color:#ffb8b8;border-color:rgba(216,125,125,.4);"
                            onclick="StrategyUIManager._renderMilitaryCampaigns('faction','${f.id}')">⚔️ 军事</button>
                        </div>
                    </div>`;
            }).join('');
        },

        // ============================================================
        // 地区
        // ============================================================
        _renderRegionsTab() {
            const regions = window.StrategyManager.getRegions();
            if (regions.length === 0) return `<div style="text-align:center;padding:40px;color:#888;">还没有地区</div>`;

            return regions.map(r => {
                const fields = (r.fields?._order || [])
                    .filter(k => r.fields[k] !== undefined && r.fields[k] !== '')
                    .map(k => `<span class="cw-strategy-chip">${k}: ${r.fields[k]}</span>`).join('');

                let presHTML = '';
                if (r.factionPresence && Object.keys(r.factionPresence).length > 0) {
                    presHTML = `<div class="cw-strategy-presence">
                        <div class="cw-strategy-presence-title">势力分布</div>
                        ${Object.entries(r.factionPresence).map(([name, fields]) => {
                            const text = (fields._order || [])
                                .filter(k => fields[k] !== undefined && fields[k] !== '')
                                .map(k => `${k}: ${fields[k]}`).join(' · ');
                            return `<div class="cw-strategy-presence-row">
                                <span class="name">${name}</span>
                                <span class="vals">${text}</span>
                            </div>`;
                        }).join('')}
                    </div>`;
                }

                return `
                    <div class="cw-strategy-card">
                        <div class="cw-strategy-card-head">
                            <div class="cw-strategy-card-icon">${r.icon}</div>
                            <div class="cw-strategy-card-title">
                                <div class="cw-strategy-card-name">${r.name}</div>
                            </div>
                        </div>
                        ${r.description ? `<div class="cw-strategy-card-desc">${r.description}</div>` : ''}
                        ${fields ? `<div class="cw-strategy-chips">${fields}</div>` : ''}
                        ${presHTML}
                        <div style="text-align:center;margin-top:10px;display:flex;justify-content:center;gap:6px;flex-wrap:wrap;">
                            <button class="cinemaworld-button primary" style="font-size:12px;padding:5px 12px;"
                                onclick="StrategyUIManager.onVisitRegion('${r.id}')">🚶 访问</button>
                            <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;color:#ffb8b8;border-color:rgba(216,125,125,.4);"
                                onclick="StrategyUIManager._renderMilitaryCampaigns('region','${r.id}')">⚔️ 进攻</button>
                            <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;"
                                onclick="StrategyUIManager.onEditRegion('${r.id}')">✏️ 编辑</button>
                        </div>
                    </div>`;
            }).join('');
        },

        // ============================================================
        // 行动
        // ============================================================
        _renderActionsTab() {
            const actions = window.StrategyManager.getAvailableActions();
            const allActions = window.StrategyManager.ensureStore().actions;

            if (allActions.length === 0) {
                return `
                    <div style="text-align:center;padding:20px 0 15px;color:#888;">
                        <div style="font-size:36px;margin-bottom:10px;">⚡</div>
                        <div style="font-size:14px;color:#aaa;">还没有战略行动</div>
                    </div>
        
                    <div style="margin-bottom:12px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                            📝 行动方向（可选）：
                        </div>
                        <textarea class="cinemaworld-textarea" id="cw-actions-guide"
                            placeholder="例如：&#10;- 优先外交，与南方商会结盟&#10;- 优先军事，北征扫平铁锈帮&#10;- 优先内政，恢复农业生产&#10;- 优先谍报，渗透金帝中枢&#10;- 混合：先外交稳住西边，再北伐"
                            style="min-height:100px;font-size:13px;"></textarea>
                    </div>
        
                    <div style="text-align:center;margin-top:12px;">
                        <button class="cinemaworld-button primary"
                            onclick="StrategyUIManager.onGenerateActions()">
                            ⚡ 生成行动
                        </button>
                    </div>
                `;
            }

            let html = '';
                if (actions.length === 0) {
                    html += `<div style="text-align:center;padding:20px;color:#888;font-size:13px;">
                        所有行动都已执行完毕<br>
                        <span style="font-size:12px;color:#666;">推进回合后会有新行动</span>
                    </div>`;
                } else {
                    html += actions.map(a => this._renderActionCard(a)).join('');
                }

            html += `
                <div style="margin-top:12px;margin-bottom:8px;">
                    <div style="font-size:12px;color:#888;margin-bottom:5px;">📝 重新生成时的方向（可选）：</div>
                    <textarea class="cinemaworld-textarea" id="cw-actions-guide"
                        placeholder="例如：优先外交 / 优先军事 / 优先内政"
                        style="min-height:60px;font-size:12px;"></textarea>
                </div>

                <div style="text-align:center;margin-top:12px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="StrategyUIManager.onGenerateActions()">🔄 重新生成行动</button>
                    <button class="cinemaworld-button" onclick="StrategyUIManager.onAdvanceTurn()">🔄 推进回合</button>
                </div>
            `;
            return html;
        },

        _renderActionCard(a) {
            const metaChips = Object.entries(a.meta || {})
                .filter(([k]) => k !== '图标')
                .map(([k, v]) => `<span class="cw-strategy-chip small">${k}: ${v}</span>`).join('');
            const isCompleted = a.status === 'completed';
            return `
                <div class="cw-strategy-action-card ${isCompleted ? 'completed' : ''}">
                    <div class="cw-strategy-action-head">
                        <div class="cw-strategy-action-icon">${a.icon}</div>
                        <div class="cw-strategy-action-title">
                            <div class="cw-strategy-action-name">${a.name}</div>
                            ${a.hint ? `<div class="cw-strategy-action-hint">${a.hint}</div>` : ''}
                        </div>
                    </div>
                    ${metaChips ? `<div class="cw-strategy-chips">${metaChips}</div>` : ''}
                    <div style="text-align:center;margin-top:10px;">
                        ${isCompleted
                            ? `<span style="color:#666;font-size:12px;">✅ 已完成</span>`
                            : `<button class="cinemaworld-button primary" style="font-size:13px;padding:6px 18px;"
                                onclick="StrategyUIManager.onExecuteAction('${a.id}')">▶️ 执行</button>`}
                    </div>
                </div>`;
        },

        // ============================================================
        // 内政 ★
        // ============================================================
        _renderPoliticsTab() {
            const p = window.StrategyManager.ensurePolitics();
            if (!p.initialized) {
                return `
                    <div style="text-align:center;padding:10px 0 15px;color:#888;">
                        <div style="font-size:36px;margin-bottom:10px;">🏛️</div>
                        <div style="font-size:14px;color:#aaa;line-height:1.7;">
                            AI 会根据你的势力判断社会形态<br>
                            并生成对应的内政结构
                        </div>
                    </div>
        
                    <div style="margin-bottom:12px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                            📝 内政方向（可选，越具体越好）：
                        </div>
                        <textarea class="cinemaworld-textarea" id="cw-politics-guide"
                            placeholder="例如：&#10;- 这是一个封建王朝，土地兼并严重，农民起义前夜&#10;- 这是一个社会主义时期，按劳分配为主，规范强&#10;- 这是一个虫群文明，虫母是唯一意志，工蜂/兵蜂分工明确&#10;- 这是一个星际资本主义，资本家与工人矛盾尖锐&#10;- 这是一个刚革命成功的公社，物资匮乏但平等度高"
                            style="min-height:120px;font-size:13px;"></textarea>
                        <div style="font-size:11px;color:#666;margin-top:4px;line-height:1.5;">
                            可以指定：社会形态 / 生产关系 / 当前时期 / 主要矛盾 / 特殊规则
                        </div>
                    </div>
        
                    <div style="text-align:center;margin-top:15px;">
                        <button class="cinemaworld-button primary" id="cw-politics-gen-btn"
                            onclick="StrategyUIManager.onGeneratePolitics()">
                            🏛️ AI 生成内政结构
                        </button>
                    </div>
                `;
            }

            const isClassless = p.socialForm?.type === 'classless';

            return `
                ${this._renderSocialFormCard(p)}
                ${this._renderRegimeCard(p)}
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🎯 政治操作</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="cinemaworld-button primary" style="flex:1;min-width:120px;"
                            onclick="StrategyUIManager._renderPoliticsActions()">⚙️ 内政行动</button>
                        <button class="cinemaworld-button primary" style="flex:1;min-width:120px;"
                            onclick="StrategyUIManager._renderBills()">📜 法案</button>
                        <button class="cinemaworld-button" style="flex:1;min-width:120px;"
                            onclick="StrategyUIManager._renderDemands()">⚠️ 阶级诉求</button>
                        <button class="cinemaworld-button" style="flex:1;min-width:120px;"
                            onclick="StrategyUIManager._renderResolutions()">🗳️ 派系决议</button>
                    </div>
                </div>
                ${this._renderEconomyCard(p)}
                ${this._renderLegalNormCard(p)}
                ${isClassless ? this._renderFunctionsTree(p) : this._renderClassesTree(p)}
                ${isClassless ? this._renderFunctionsAnalysis(p) : this._renderInterestGroups(p)}
                ${!isClassless ? this._renderSocialContradictions(p) : ''}
                ${this._renderPeriodMechanisms(p)}
                <div style="text-align:center;margin-top:12px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="StrategyUIManager.onGeneratePolitics()">🔄 重新生成内政</button>
                    ${!isClassless ? `<button class="cinemaworld-button" onclick="StrategyUIManager.onEditPolitics()">✏️ 编辑阶级</button>` : ''}
                </div>`;
        },

        _renderSocialFormCard(p) {
            const form = p.socialForm;
            if (!form) return '';
            const isClassless = form.type === 'classless';
            const color = isClassless ? '#7dd87d' : '#7da8ff';
            const label = isClassless ? '无阶级社会' : '阶级社会';

            return `
                <div class="cw-strategy-section" style="background:linear-gradient(135deg,rgba(120,80,180,.12),rgba(80,120,180,.08));border-color:${color}44;">
                    <div class="cw-politics-economy-row">
                        <span class="key">社会形态</span>
                        <span class="val" style="color:${color};font-weight:700;">${label}</span>
                    </div>
                    ${form.subtype ? `<div class="cw-politics-economy-row">
                        <span class="key">子类型</span>
                        <span class="val">${form.subtype}</span>
                    </div>` : ''}
                    ${form.desc ? `<div class="cw-politics-period-desc" style="margin-top:6px;">${form.desc}</div>` : ''}
                </div>`;
        },

        _renderRegimeCard(p) {
            const r = p.regime;
            const isClassless = p.socialForm?.type === 'classless';
            const support = window.StrategyManager.getRegimeSupport();
            const supportColor = support >= 60 ? '#7dd87d' : support >= 40 ? '#d8c07d' : '#d87d7d';

            return `
                <div class="cw-strategy-header">
                    <div class="cw-strategy-header-icon">🏛️</div>
                    <div class="cw-strategy-header-info">
                        <div class="cw-strategy-header-name">政治结构</div>
                        ${!isClassless ? `<div class="cw-strategy-header-desc">
                            统治支持度：<span style="color:${supportColor};font-weight:700;">${support}</span>
                        </div>` : ''}
                    </div>
                </div>

                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">👑 政治代表</div>
                    <div class="cw-politics-regime-row">
                        <div class="cw-politics-regime-name">${r.representative.name || '—'}</div>
                        <div class="cw-politics-regime-type">${r.representative.type || ''}</div>
                        ${r.representative.desc ? `<div class="cw-politics-regime-desc">${r.representative.desc}</div>` : ''}
                    </div>
                </div>

                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🏢 行政机构</div>
                    <div class="cw-politics-regime-row">
                        <div class="cw-politics-regime-name">${r.executive.name || '—'}</div>
                        <div class="cw-politics-regime-type">${r.executive.type || ''}</div>
                        ${r.executive.desc ? `<div class="cw-politics-regime-desc">${r.executive.desc}</div>` : ''}
                    </div>
                </div>

                ${r.legitimacy ? `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">⚖️ 统治合法性</div>
                    <div style="font-size:14px;color:#c8d8ff;padding:4px 0;">${r.legitimacy}</div>
                </div>` : ''}`;
        },

        _renderEconomyCard(p) {
            const eco = p?.economy || {};
            const prod = eco.production || {};
            const productivity = prod.productivity || { tech: 30, landYield: 100, industry: 0 };
            const ownership = prod.ownership || { type: '未定义', concentration: 0.5 };
            const distribution = prod.distribution || { type: '未定义', equality: 0.5 };
            const period = eco.period || { name: '稳定时期', type: 'stable', desc: '', wealthMultiplier: 1.0 };
            const legalNorm = eco.legalNorm || { strength: 0.5, nature: '过渡性' };

            const ownershipFairness = 1 - (ownership.concentration || 0.5);
            const distributionFairness = distribution.equality || 0.5;
            const fairness = (ownershipFairness + distributionFairness) / 2;

            return `
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">⚙️ 经济基础</div>

                    <div class="cw-politics-economy-row">
                        <span class="key">当前时期</span>
                        <span class="val" style="color:#ff9a5a;">${period.name || '—'}</span>
                    </div>
                    ${period.desc ? `<div class="cw-politics-period-desc">${period.desc}</div>` : ''}
                    <div class="cw-politics-economy-row">
                        <span class="key">总人口</span>
                        <span class="val">${this._formatNumber(eco.totalPop || 1000000)}</span>
                    </div>

                    <div class="cw-politics-economy-row" style="margin-top:8px;">
                        <span class="key">生产力</span>
                        <span class="val"></span>
                    </div>
                    ${this._renderBar('技术水平', productivity.tech || 0, '#7da8ff')}
                    ${this._renderBar('土地产出', (productivity.landYield || 100) / 2, '#7dd87d')}
                    ${this._renderBar('工业化', productivity.industry || 0, '#d8c07d')}

                    <div class="cw-politics-economy-row" style="margin-top:8px;">
                        <span class="key">所有制</span>
                        <span class="val">${ownership.type || '未定义'}</span>
                    </div>
                    ${this._renderBar('集中度', (ownership.concentration || 0) * 100, '#d87d7d')}

                    <div class="cw-politics-economy-row" style="margin-top:8px;">
                        <span class="key">分配关系</span>
                        <span class="val">${distribution.type || '未定义'}</span>
                    </div>
                    ${this._renderBar('平等度', (distribution.equality || 0) * 100, '#7dd87d')}

                    <div class="cw-politics-economy-row" style="margin-top:8px;">
                        <span class="key"规范</span>
                        <span class="val">${legalNorm.nature || '—'}</span>
                    </div>
                    ${this._renderBar('强度', (legalNorm.strength || 0) * 100, '#a06cd5')}

                    <div class="cw-politics-economy-row" style="margin-top:8px;">
                        <span class="key">综合公平性</span>
                        <span class="val" style="color:${fairness > 0.6 ? '#7dd87d' : fairness > 0.3 ? '#d8c07d' : '#d87d7d'};">
                            ${(fairness * 100).toFixed(0)}%
                        </span>
                    </div>

                    <div class="cw-politics-economy-row" style="margin-top:8px;">
                        <span class="key">社会总产出</span>
                        <span class="val" style="color:#ffd76b;">${this._formatNumber(eco.totalWealth || 0)}</span>
                    </div>
                </div>`;
        },

        _renderLegalNormCard(p) {
            const ln = p?.economy?.legalNorm;
            if (!ln) return '';

            const natureColor = {
                '对立': '#d87d7d', '过渡性': '#d8c07d',
                '服务性': '#7dd87d', '消失中': '#7da8ff',
            }[ln.nature] || '#aab';

            return `
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">⚖️规范</div>

                    <div class="cw-politics-economy-row">
                        <span class="key">性质</span>
                        <span class="val" style="color:${natureColor};">${ln.nature || '—'}</span>
                    </div>
                    <div class="cw-politics-economy-row">
                        <span class="key">历史作用</span>
                        <span class="val">${ln.role || '—'}</span>
                    </div>
                    ${this._renderBar('规范强度', (ln.strength || 0) * 100, '#a06cd5')}

                    ${(ln.rules?.length > 0) ? `
                    <div class="cw-politics-mech-subtitle">具体规范</div>
                    ${ln.rules.map(r => `
                        <div class="cw-politics-mechanism">
                            <div class="cw-politics-mechanism-name">${r.name} <span style="color:#888;font-size:11px;">(${r.type})</span></div>
                            ${r.desc ? `<div class="cw-politics-mechanism-effect">${r.desc}</div>` : ''}
                        </div>
                    `).join('')}` : ''}

                    ${(ln.contradictions?.length > 0) ? `
                    <div class="cw-politics-mech-subtitle">内在矛盾</div>
                    ${ln.contradictions.map(c => `
                        <div class="cw-politics-contradiction neutral" style="margin-top:4px;">⚠️ ${c}</div>
                    `).join('')}` : ''}
                </div>`;
        },

        // ========== 阶级树 ==========
        _renderClassesTree(p) {
            const classes = Object.values(p.classes);
            if (classes.length === 0) {
                return `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">👥 阶级</div>
                    <div style="color:#666;">暂无阶级数据</div>
                </div>`;
            }
            return `
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">👥 阶级与阶层</div>
                    ${classes.map(c => this._renderClassNode(c)).join('')}
                </div>`;
        },

        _renderClassNode(c) {
            const popPct = ((c.pop || 0) * 100).toFixed(1);
            const wealthPct = ((c.wealthShare || 0) * 100).toFixed(1);
            const ls = c.livingStandard || 1;
            const lsColor = ls >= 1.5 ? '#7dd87d' : ls >= 1 ? '#d8c07d' : '#d87d7d';
            const discontent = c.discontent || 0;
            const dcColor = discontent >= 70 ? '#d87d7d' : discontent >= 40 ? '#d8c07d' : '#7dd87d';
            const consciousness = c.consciousness || 0;
            const strata = Object.values(c.strata || {});

            const trendArrow = c.wealthTrend === 1 ? '↑' : c.wealthTrend === -1 ? '↓' : '→';
            const trendColor = c.wealthTrend === 1 ? '#7dd87d' : c.wealthTrend === -1 ? '#d87d7d' : '#888';

            return `
                <div class="cw-politics-class">
                    <div class="cw-politics-class-head">
                        <div class="cw-politics-class-icon">${c.icon || '👥'}</div>
                        <div class="cw-politics-class-info">
                            <div class="cw-politics-class-name">${c.name}</div>
                            <div class="cw-politics-class-meta">
                                人口 ${popPct}% · 财富 ${wealthPct}% <span style="color:${trendColor};">${trendArrow}</span> · 政治力量 ${c.politicalPower}
                            </div>
                        </div>
                    </div>

                    ${c.description ? `<div class="cw-politics-class-desc">${c.description}</div>` : ''}

                    ${this._renderBar('生活水平', Math.min(100, ls * 50), lsColor, `×${ls.toFixed(2)}`)}
                    ${c.aspiration ? this._renderBar('生活期望', Math.min(100, c.aspiration * 50), '#888', `×${c.aspiration.toFixed(2)}`) : ''}
                    ${this._renderBar('不满度', discontent, dcColor)}
                    ${this._renderBar('阶级觉悟', consciousness, '#d87dff')}
                    ${this._renderBar('动员力', c.mobilization || 0, '#d8c07d')}

                    ${this._renderClassContradiction(c)}

                    ${strata.length > 0 ? `
                        <div class="cw-politics-strata">
                            ${strata.map(s => this._renderStratumRow(s)).join('')}
                        </div>
                    ` : ''}
                </div>`;
        },

        _renderStratumRow(s) {
            const sharePct = ((s.share || 0) * 100).toFixed(1);
            return `
                <div class="cw-politics-stratum">
                    <div class="cw-politics-stratum-name">${s.icon || '👤'} ${s.name}</div>
                    <div class="cw-politics-stratum-meta">
                        占 ${sharePct}% · 政治力量 ${s.politicalPower || 0} · 支持 ${s.support || 0}
                    </div>
                    ${s.description ? `<div class="cw-politics-stratum-desc">${s.description}</div>` : ''}
                </div>`;
        },

        _renderClassContradiction(c) {
            const popPct = (c.pop || 0) * 100;
            const wealthPct = (c.wealthShare || 0) * 100;
            const gap = wealthPct - popPct;
            if (Math.abs(gap) < 5) {
                return `<div class="cw-politics-contradiction neutral">⚖️ 财富分配与人口比例基本匹配</div>`;
            }
            if (gap < -5) {
                const severity = gap < -30 ? '严重' : gap < -15 ? '明显' : '轻微';
                return `<div class="cw-politics-contradiction exploited">
                    人口占 ${popPct.toFixed(1)}%，占有 ${wealthPct.toFixed(1)}% 财富（${severity}）
                </div>`;
            }
            return `<div class="cw-politics-contradiction exploiting">
                人口占 ${popPct.toFixed(1)}%，占有 ${wealthPct.toFixed(1)}% 财富
            </div>`;
        },

        // ========== 职能树（无阶级社会） ==========
        _renderFunctionsTree(p) {
            const functions = Object.values(p.functions || {});
            if (functions.length === 0) {
                return `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🧬 职能</div>
                    <div style="color:#666;">暂无职能数据</div>
                </div>`;
            }
            return `
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🧬 职能分工</div>
                    ${functions.map(f => this._renderFunctionNode(f)).join('')}
                </div>`;
        },

        _renderFunctionNode(f) {
            const popPct = ((f.pop || 0) * 100).toFixed(1);
            const resourcePct = ((f.resourceShare || 0) * 100).toFixed(1);
            const ls = f.livingStandard || 1;
            const lsColor = ls >= 1.5 ? '#7dd87d' : ls >= 1 ? '#d8c07d' : '#d87d7d';
            const eff = (f.efficiency || 0) * 100;
            const effColor = eff >= 80 ? '#7dd87d' : eff >= 50 ? '#d8c07d' : '#d87d7d';
            const subs = Object.values(f.subFunctions || {});

            return `
                <div class="cw-politics-class">
                    <div class="cw-politics-class-head">
                        <div class="cw-politics-class-icon">${f.icon || '🧬'}</div>
                        <div class="cw-politics-class-info">
                            <div class="cw-politics-class-name">${f.name}</div>
                            <div class="cw-politics-class-meta">
                                人口 ${popPct}% · 资源占比 ${resourcePct}%
                            </div>
                        </div>
                    </div>

                    ${f.desc ? `<div class="cw-politics-class-desc">${f.desc}</div>` : ''}

                    ${this._renderBar('生活水平', Math.min(100, ls * 50), lsColor, `×${ls.toFixed(2)}`)}
                    ${this._renderBar('职能效率', eff, effColor)}

                    ${subs.length > 0 ? `
                        <div class="cw-politics-strata">
                            ${subs.map(s => `
                                <div class="cw-politics-stratum">
                                    <div class="cw-politics-stratum-name">${s.name}</div>
                                    <div class="cw-politics-stratum-meta">
                                        占 ${((s.share || 0) * 100).toFixed(1)}% · 效率 ${((s.efficiency || 0) * 100).toFixed(0)}%
                                    </div>
                                    ${s.desc ? `<div class="cw-politics-stratum-desc">${s.desc}</div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>`;
        },

        _renderFunctionsAnalysis(p) {
            const functions = Object.values(p.functions || {});
            if (functions.length === 0) return '';

            const totalResource = functions.reduce((s, f) => s + (f.resourceShare || 0), 0);
            const avgEfficiency = functions.reduce((s, f) => s + (f.efficiency || 0), 0) / functions.length;

            return `
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🧬 职能分析</div>

                    <div class="cw-politics-contradiction-row">
                        <span class="key">职能总数</span>
                        <span class="val">${functions.length}</span>
                    </div>
                    <div class="cw-politics-contradiction-row">
                        <span class="key">总资源占比</span>
                        <span class="val">${(totalResource * 100).toFixed(1)}%</span>
                    </div>
                    <div class="cw-politics-contradiction-row">
                        <span class="key">平均效率</span>
                        <span class="val">${(avgEfficiency * 100).toFixed(0)}%</span>
                    </div>

                    ${totalResource < 0.9 ? `
                    <div class="cw-politics-contradiction exploited">
                        ⚠️ 资源分配不足，职能运转受限
                    </div>` : `<div class="cw-politics-contradiction neutral">
                        ✅ 职能分配合理，运作正常
                    </div>`}
                </div>`;
        },

        // ========== 利益集团 ==========
        _renderInterestGroups(p) {
            const groups = Object.values(p.interestGroups);
            if (groups.length === 0) {
                return `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🎭 利益集团</div>
                    <div style="color:#666;">暂无利益集团</div>
                </div>`;
            }
            const sorted = groups.slice().sort((a, b) => b.politicalPower - a.politicalPower);
            return `
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🎭 利益集团 (${groups.length})</div>
                    ${sorted.map(g => this._renderInterestGroupCard(g)).join('')}
                </div>`;
        },

        _renderInterestGroupCard(g) {
            const factions = Object.values(g.factions || {});
            const supportColor = g.support >= 60 ? '#7dd87d' : g.support >= 40 ? '#d8c07d' : '#d87d7d';
            const validMembers = (g.members || []).filter(m => m.valid !== false);

            return `
                <div class="cw-politics-group">
                    <div class="cw-politics-group-head">
                        <div class="cw-politics-group-icon">${g.icon}</div>
                        <div class="cw-politics-group-title">
                            <div class="cw-politics-group-name">${g.name}</div>
                            <div class="cw-politics-group-meta">
                                政治力量 ${g.politicalPower} · 
                                <span style="color:${supportColor};">支持 ${g.support}</span>
                            </div>
                        </div>
                    </div>
                    ${g.description ? `<div class="cw-politics-group-desc">${g.description}</div>` : ''}

                    ${validMembers.length > 0 ? `
                        <div class="cw-politics-group-subtitle">成员阶层</div>
                        <div class="cw-strategy-chips">
                            ${validMembers.map(m => `
                                <span class="cw-strategy-chip small">${m.class}.${m.stratum} (${m.weight}%)</span>
                            `).join('')}
                        </div>
                    ` : ''}

                    ${factions.length > 0 ? `
                        <div class="cw-politics-group-subtitle">内部派系</div>
                        ${factions.map(f => this._renderFactionCard(f, g)).join('')}
                    ` : ''}
                </div>`;
        },

        _renderFactionCard(f, group) {
            const opposes = f.opposes || [];
            const stanceColor = {
                '守旧': '#d8c07d', '变法': '#7da8ff', '主战': '#d87d7d',
                '主和': '#7dd87d', '激进': '#d87d7d', '中立': '#aab',
            }[f.stance] || '#aab';

            const validMembers = (f.members || []).filter(m => m.valid !== false);

            return `
                <div class="cw-politics-faction">
                    <div class="cw-politics-faction-head">
                        <div class="cw-politics-faction-icon">${f.icon}</div>
                        <div class="cw-politics-faction-title">
                            <div class="cw-politics-faction-name">
                                ${f.name}
                                ${f.stance ? `<span class="cw-strategy-title-badge small" style="color:${stanceColor};border-color:${stanceColor}66;">${f.stance}</span>` : ''}
                            </div>
                            <div class="cw-politics-faction-meta">
                                政治力量 ${f.politicalPower} · 支持 ${f.support}
                            </div>
                        </div>
                    </div>
                    ${f.description ? `<div class="cw-politics-faction-desc">${f.description}</div>` : ''}
                    ${validMembers.length > 0 ? `
                        <div class="cw-strategy-chips">
                            ${validMembers.map(m => `<span class="cw-strategy-chip small">${m.class}.${m.stratum} (${m.weight}%)</span>`).join('')}
                        </div>
                    ` : ''}
                    ${opposes.length > 0 ? `
                        <div class="cw-politics-faction-opposes">⚔️ 对立：${opposes.join('、')}</div>
                    ` : ''}
                </div>`;
        },

        // ========== 社会矛盾 ==========
        _renderSocialContradictions(p) {
            const classes = Object.values(p.classes);
            if (classes.length === 0) return '';

            const mostDiscontent = classes.slice().sort((a, b) => (b.discontent || 0) - (a.discontent || 0))[0];
            const richest = classes.slice().sort((a, b) => (b.wealthShare || 0) - (a.wealthShare || 0))[0];
            const ruling = classes.slice().sort((a, b) => b.politicalPower - a.politicalPower)[0];

            return `
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">⚔️ 社会矛盾</div>

                    ${ruling ? `<div class="cw-politics-contradiction-row">
                        <span class="key">统治阶级</span>
                        <span class="val">${ruling.icon} ${ruling.name}</span>
                    </div>` : ''}

                    ${richest ? `<div class="cw-politics-contradiction-row">
                        <span class="key">最富裕</span>
                        <span class="val">${richest.icon} ${richest.name} (${((richest.wealthShare||0)*100).toFixed(1)}%)</span>
                    </div>` : ''}

                    ${mostDiscontent && mostDiscontent.discontent > 30 ? `<div class="cw-politics-contradiction-row">
                        <span class="key">最不满</span>
                        <span class="val" style="color:#d87d7d;">
                            ${mostDiscontent.icon} ${mostDiscontent.name} (${mostDiscontent.discontent})
                        </span>
                    </div>` : ''}

                    ${this._renderContradictionAnalysis(p)}
                </div>`;
        },

        _renderContradictionAnalysis(p) {
            const classes = Object.values(p.classes);
            const messages = [];

            for (const c of classes) {
                const ls = c.livingStandard || 1;
                const dc = c.discontent || 0;
                const cons = c.consciousness || 0;
                if (ls < 0.8) messages.push(`⚠️ <strong>${c.name}</strong>生活水平仅 ${ls.toFixed(2)}，濒临饥荒`);
                if (dc > 70 && cons > 60) messages.push(`🔥 <strong>${c.name}</strong>不满 ${dc}、觉悟 ${cons}，具备起义条件`);
                else if (dc > 50) messages.push(`⚡ <strong>${c.name}</strong>不满 ${dc}，可能爆发骚乱`);
            }

            if (messages.length === 0) {
                return `<div style="font-size:12px;color:#7dd87d;margin-top:8px;">✅ 当前社会矛盾可控</div>`;
            }
            return `<div style="font-size:12px;color:#d8c07d;margin-top:8px;line-height:1.7;">
                ${messages.map(m => `<div>${m}</div>`).join('')}
            </div>`;
        },

        // ========== 时期与机制 ==========
        _renderPeriodMechanisms(p) {
            const period = p?.economy?.period;
            const mech = p?.mechanics;
            if (!period && !mech) return '';

            return `
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">⚖️ 时期与机制</div>

                    ${period ? `<div class="cw-politics-period">
                        <div class="cw-politics-period-name">${period.name || '—'}</div>
                        ${period.desc ? `<div class="cw-politics-period-desc">${period.desc}</div>` : ''}
                        <div class="cw-politics-period-meta">
                            财富倍率 ×${period.wealthMultiplier ?? 1.0}
                            ${period.wealthChangeCap !== undefined ? ` · 上限 ${(period.wealthChangeCap * 100).toFixed(2)}%/回合` : ''}
                        </div>
                    </div>` : ''}

                    ${mech?.wealthChange ? `
                    <div class="cw-politics-mech-subtitle">财富变化公式</div>
                    <div class="cw-rule-formula">
                        delta = (政治偏差 × ${mech.wealthChange.coefficients?.politicalBias ?? 0.5}
                        + 所有制 × ${mech.wealthChange.coefficients?.ownershipConcentration ?? -0.5}
                        + 分配 × ${mech.wealthChange.coefficients?.distributionEquality ?? 0.3})
                        × ${mech.wealthChange.baseRate ?? 0.005} × 时期倍率
                    </div>` : ''}

                    ${(mech?.mechanisms?.length > 0) ? `
                    <div class="cw-politics-mech-subtitle">再分配机制</div>
                    ${mech.mechanisms.map(m => `
                        <div class="cw-politics-mechanism">
                            <div class="cw-politics-mechanism-name">${m.name || '—'}</div>
                            ${m.trigger ? `<div class="cw-politics-mechanism-trigger">触发：${m.trigger}</div>` : ''}
                            ${m.effect ? `<div class="cw-politics-mechanism-effect">效果：${m.effect}</div>` : ''}
                        </div>
                    `).join('')}` : ''}
                </div>`;
        },

        // ============================================================
        // 规则面板 ★
        // ============================================================
        _renderRulesTab() {
            const store = window.StrategyManager.ensureStore();
            const politics = window.StrategyManager.ensurePolitics();

            const hasStrategy = store.rules && (store.rules.raw || store.rules.parsed);
            const hasPolitics = politics.initialized && politics.rules;

            if (!hasStrategy && !hasPolitics) {
                return `<div style="text-align:center;padding:40px 20px;color:#888;">
                    <div style="font-size:40px;margin-bottom:15px;">📜</div>
                    <div>还没有任何规则</div>
                    <div style="font-size:12px;color:#666;margin-top:8px;">
                        先到「👑 我方」生成战略层，再到「🏛️ 内政」生成内政结构
                    </div>
                </div>`;
            }

            return `
                ${hasStrategy ? this._renderStrategyRules(store) : ''}
                ${hasPolitics ? this._renderPoliticsRulesFull(politics) : ''}`;
        },

        _renderStrategyRules(store) {
            const rules = store.rules.parsed || {};
            const raw = store.rules.raw || '';
            return `
                <div class="cw-strategy-header">
                    <div class="cw-strategy-header-icon">📜</div>
                    <div class="cw-strategy-header-info">
                        <div class="cw-strategy-header-name">战略规则</div>
                        <div class="cw-strategy-header-desc">AI 生成，决定势力、地区、回合如何运作</div>
                    </div>
                </div>

                ${rules.factionFields?.length > 0 ? `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">📊 势力数据字段</div>
                    <div class="cw-strategy-chips">${rules.factionFields.map(f => `<span class="cw-strategy-chip">${f}</span>`).join('')}</div>
                </div>` : ''}

                ${rules.regionFields?.length > 0 ? `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🗺️ 地区数据字段</div>
                    <div class="cw-strategy-chips">${rules.regionFields.map(f => `<span class="cw-strategy-chip">${f}</span>`).join('')}</div>
                </div>` : ''}

                ${rules.actionTypes?.length > 0 ? `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">⚡ 可行动类型</div>
                    <div class="cw-strategy-chips">${rules.actionTypes.map(t => `<span class="cw-strategy-chip">${t}</span>`).join('')}</div>
                </div>` : ''}

                ${rules.updateRules?.length > 0 ? `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🔄 更新规则</div>
                    <div class="cw-rule-list">
                        ${rules.updateRules.map(r => `
                            <div class="cw-rule-item">
                                <div class="cw-rule-item-field">${r.field}</div>
                                <div class="cw-rule-item-text">${r.text}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>` : ''}

                ${rules.turnRules?.length > 0 ? `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">⏭️ 回合规则</div>
                    <div class="cw-rule-list">
                        ${rules.turnRules.map(r => `<div class="cw-rule-item">
                            <div class="cw-rule-item-text">${r.text}</div>
                        </div>`).join('')}
                    </div>
                </div>` : ''}

                ${raw ? `<details class="cw-strategy-section" style="cursor:pointer;">
                    <summary class="cw-strategy-section-title" style="cursor:pointer;">📄 原始文本（点击展开）</summary>
                    <pre class="cw-rule-raw">${this._escapeHtml(raw)}</pre>
                </details>` : ''}`;
        },

        _renderPoliticsRulesFull(politics) {
            const r = politics.rules;
            if (!r) return '';

            return `
                <div class="cw-strategy-header">
                    <div class="cw-strategy-header-icon">⚙️</div>
                    <div class="cw-strategy-header-info">
                        <div class="cw-strategy-header-name">内政规则</div>
                        <div class="cw-strategy-header-desc">AI 生成，决定财富分配、不满度、觉悟、起义如何结算</div>
                    </div>
                </div>

                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">💰 财富分配公式</div>
                    <div class="cw-rule-kv">
                        <div class="cw-rule-kv-row"><span class="key">政治力量指数</span><span class="val">${r.wealthFormula.exponent}</span></div>
                        <div class="cw-rule-kv-row"><span class="key">最低人口占有</span><span class="val">${r.wealthFormula.minSharePerPop}</span></div>
                    </div>
                    <div class="cw-rule-formula">
                        wealthShare = power<sup>${r.wealthFormula.exponent}</sup> × 系数，然后归一化
                    </div>

                    ${Object.keys(r.wealthFormula.relationBonus || {}).length > 0 ? `
                    <div class="cw-politics-mech-subtitle" style="margin-top:12px;">生产关系系数</div>
                    <div class="cw-rule-list">
                        ${Object.entries(r.wealthFormula.relationBonus).map(([k, v]) => `
                            <div class="cw-rule-item">
                                <div class="cw-rule-item-field">${k}</div>
                                <div class="cw-rule-item-text">×${v}</div>
                            </div>
                        `).join('')}
                    </div>` : ''}
                </div>

                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🏠 生活水平公式</div>
                    <div class="cw-rule-kv">
                        <div class="cw-rule-kv-row"><span class="key">生存线</span><span class="val">${r.livingFormula.subsistence}</span></div>
                    </div>
                    <div class="cw-rule-formula">
                        livingStandard = (wealthShare × 社会总产出) / 人口 / 生存线
                    </div>
                </div>

                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">😠 不满度公式</div>
                    <div class="cw-rule-list">
                        ${['absolutePoverty','relativeDeprivation','politicalGap','exploitation','inertia','aspirationGap'].map(k => {
                            const label = {
                                absolutePoverty: '绝对贫困', relativeDeprivation: '相对剥夺',
                                politicalGap: '政治无权', exploitation: '剥削',
                                inertia: '历史惯性', aspirationGap: '期望落差',
                            }[k];
                            const w = r.discontentFormula.weights[k] ?? 0;
                            const en = r.discontentFormula.enabled[k];
                            return `<div class="cw-rule-item">
                                <div class="cw-rule-item-field">${label}</div>
                                <div class="cw-rule-item-text">
                                    权重 ${w} ${en ? '' : '（已禁用）'}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                    <div class="cw-rule-formula">
                        discontent = Σ(因子 × 权重)，上限 100
                    </div>
                </div>

                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">💡 阶级觉悟公式</div>
                    ${r.consciousnessFormula.enabled ? `
                        <div class="cw-rule-kv">
                            <div class="cw-rule-kv-row"><span class="key">教育系数</span><span class="val">${r.consciousnessFormula.eduFactorBase}</span></div>
                            <div class="cw-rule-kv-row"><span class="key">科技权重</span><span class="val">${r.consciousnessFormula.eduFactorTechWeight}</span></div>
                            <div class="cw-rule-kv-row"><span class="key">倍率</span><span class="val">${r.consciousnessFormula.multiplier}</span></div>
                        </div>
                        <div class="cw-rule-formula">
                            consciousness = discontent × 人口 × 教育系数 × 倍率
                        </div>
                    ` : `<div class="cw-rule-disabled">该世界观没有"阶级觉悟"概念</div>`}
                </div>

                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">🔥 起义触发条件</div>
                    <div class="cw-rule-kv">
                        <div class="cw-rule-kv-row"><span class="key">不满度 ≥</span><span class="val" style="color:#d87d7d;">${r.rebellionRules.conditions.discontent.min}</span></div>
                        <div class="cw-rule-kv-row"><span class="key">觉悟 ≥</span><span class="val" style="color:#d87d7d;">${r.rebellionRules.conditions.consciousness.min}</span></div>
                        <div class="cw-rule-kv-row"><span class="key">人口占比 ≥</span><span class="val" style="color:#d87d7d;">${r.rebellionRules.conditions.pop.min}</span></div>
                    </div>
                    <div class="cw-rule-formula">全部满足时触发起义</div>
                </div>

                ${r.turnRules?.length > 0 ? `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">⏭️ 每回合自然变化</div>
                    <div class="cw-rule-list">
                        ${r.turnRules.map(t => `<div class="cw-rule-item">
                            <div class="cw-rule-item-field">${t.field}</div>
                            <div class="cw-rule-item-text">
                                ${t.op === 'add' ? '+' : t.op === 'subtract' ? '-' : '='} ${t.value}
                            </div>
                        </div>`).join('')}
                    </div>
                </div>` : ''}

                ${r.meta ? `<div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">ℹ️ 元数据</div>
                    <div class="cw-rule-kv">
                        <div class="cw-rule-kv-row"><span class="key">世界观</span><span class="val">${r.meta.worldview || '—'}</span></div>
                        <div class="cw-rule-kv-row"><span class="key">生成时间</span><span class="val">${r.meta.generatedAt ? new Date(r.meta.generatedAt).toLocaleString() : '—'}</span></div>
                    </div>
                </div>` : ''}`;
        },

        // ============================================================
        // 回合
        // ============================================================
        _renderTurnTab() {
            const store = window.StrategyManager.ensureStore();
            const log = store.turnLog || [];

            const logHTML = log.length === 0
                ? `<div style="text-align:center;padding:30px;color:#888;font-size:13px;">还没有回合记录</div>`
                : log.slice().reverse().map(t => this._renderTurnLogEntry(t)).join('');

            return `
                <div class="cw-strategy-settings">
                    <div class="cw-strategy-setting-row">
                        <div class="cw-strategy-setting-label">
                            <div class="cw-strategy-setting-title">📖 加入剧情上下文</div>
                            <div class="cw-strategy-setting-desc">
                                开启后，主线剧情生成时会把战略局势一起发给 AI。
                            </div>
                        </div>
                        <label class="cw-strategy-switch">
                            <input type="checkbox" ${store.contextEnabled ? 'checked' : ''}
                                onchange="StrategyUIManager.onToggleContext(this.checked)">
                            <span class="cw-strategy-switch-slider"></span>
                        </label>
                    </div>

                    <div class="cw-strategy-setting-row">
                        <div class="cw-strategy-setting-label">
                            <div class="cw-strategy-setting-title">⏭️ 一段剧情 = 一回合</div>
                            <div class="cw-strategy-setting-desc">
                                开启后，每完成一段主线剧情，自动推进战略回合。
                            </div>
                        </div>
                        <label class="cw-strategy-switch">
                            <input type="checkbox" ${store.autoTurnOnStory ? 'checked' : ''}
                                onchange="StrategyUIManager.onToggleAutoTurn(this.checked)">
                            <span class="cw-strategy-switch-slider"></span>
                        </label>
                    </div>
                </div>

                <div style="text-align:center;margin:16px 0;">
                    <button class="cinemaworld-button primary" onclick="StrategyUIManager.onAdvanceTurn()">🔄 手动推进回合</button>
                </div>
                <div style="text-align:center;margin:16px 0;">
                    <button class="cinemaworld-button" onclick="StrategyUIManager._renderMilitaryHistory()">📜 军事历史</button>
                </div>
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">📜 回合历史</div>
                    ${logHTML}
                </div>`;
        },

        _renderTurnLogEntry(t) {
            return `
                <div class="cw-strategy-turn-log">
                    <div class="cw-strategy-turn-log-head">
                        <span>第 ${t.turn} 回合</span>
                        <span style="font-size:11px;color:#666;">${new Date(t.timestamp).toLocaleString()}</span>
                    </div>

                    ${t.factionChanges?.length > 0 ? `<div class="cw-strategy-turn-log-section">
                        <div class="cw-strategy-turn-log-label">📊 势力变化</div>
                        ${t.factionChanges.map(c => `<div class="cw-strategy-turn-log-line">${c}</div>`).join('')}
                    </div>` : ''}

                    ${t.politicsCrisis?.length > 0 ? `<div class="cw-strategy-turn-log-section">
                        <div class="cw-strategy-turn-log-label">⚔️ 社会危机</div>
                        ${t.politicsCrisis.map(cr => `<div class="cw-strategy-turn-log-line" style="color:#ffb8b8;">
                            <strong>${cr.type}</strong> ${cr.desc}
                        </div>`).join('')}
                    </div>` : ''}

                    ${t.otherActions?.length > 0 ? `<div class="cw-strategy-turn-log-section">
                        <div class="cw-strategy-turn-log-label">🌍 其他势力行动</div>
                        ${t.otherActions.map(a => `<div class="cw-strategy-turn-log-line">
                            <strong>${a.factionName}</strong> ${a.actionName}
                            ${a.target ? `→ ${a.target}` : ''}
                        </div>`).join('')}
                    </div>` : ''}
                </div>`;
        },

        onToggleContext(enabled) {
            const store = window.StrategyManager.ensureStore();
            store.contextEnabled = !!enabled;
            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText(enabled ? '📖 战略局势将注入主线剧情' : '📖 不再注入', 1500);
        },

        onToggleAutoTurn(enabled) {
            const store = window.StrategyManager.ensureStore();
            store.autoTurnOnStory = !!enabled;
            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText(enabled ? '⏭️ 每段剧情自动推进回合' : '⏭️ 不再自动推进', 1500);
        },

        // ============================================================
        // 事件
        // ============================================================
        async onGenerateActions() {
            const guide = document.getElementById('cw-actions-guide')?.value.trim() || '';
            window.UIManager.showText('正在生成战略行动...', 1000);
            try {
                const actions = await window.StrategyManager.generateActions(guide);
                if (!actions || actions.length === 0) {
                    window.UIManager.showText('❌ 生成失败', 2000);
                    return;
                }
                window.UIManager.showText(`✅ 生成了 ${actions.length} 个行动`, 1500);
                this._currentTab = 'actions';
                this.open();
            } catch (e) {
                console.error('[StrategyUI] 生成行动失败:', e);
                window.UIManager.showText(`❌ 生成失败：${e.message}`, 3000);
            }
        },

        async onExecuteAction(actionId) {
            try {
                const result = await window.StrategyManager.executeAction(actionId);
                if (!result.ok) {
                    window.UIManager.showText(`❌ ${result.reason}`, 2000);
                    return;
                }
                this.open();
            } catch (e) {
                console.error('[StrategyUI] 执行行动失败:', e);
                window.UIManager.showText(`❌ 执行失败：${e.message}`, 3000);
            }
        },

        async onAdvanceTurn() {
            const store = window.StrategyManager.ensureStore();
            const available = window.StrategyManager.getAvailableActions();
            if (available.length > 0) {
                if (!confirm(`还有 ${available.length} 个行动未执行，确定推进回合吗？`)) return;
            }
            window.UIManager.showText(`正在推进第 ${store.turnCount + 1} 回合...`, 1200);
            try {
                const log = await window.StrategyManager.advanceTurn('manual');
                if (!log) {
                    window.UIManager.showText('❌ 推进失败', 2000);
                    return;
                }
                window.UIManager.showText(`✅ 第 ${log.turn} 回合完成`, 1500);
                this._currentTab = 'turn';
                this.open();
            } catch (e) {
                console.error('[StrategyUI] 推进回合失败:', e);
                window.UIManager.showText(`❌ 推进失败：${e.message}`, 3000);
            }
        },

        async onVisitRegion(regionId) {
            window.UIManager.closeModal();
            try {
                await window.StrategyManager.visitRegion(regionId);
            } catch (e) {
                console.error('[StrategyUI] 访问地区失败:', e);
                window.UIManager.showText(`❌ 访问失败：${e.message}`, 3000);
            }
        },

        onEditFaction() {
            const f = window.StrategyManager.getPlayerFaction();
            if (!f) return;
            this._openFieldEditor(`编辑势力：${f.name}`, f.fields, (newFields) => {
                f.fields = newFields;
                f.updatedAt = Date.now();
                if (window.SaveManager) window.SaveManager.save();
                this.open();
            });
        },

        onEditRegion(regionId) {
            const r = window.StrategyManager.ensureStore().regions[regionId];
            if (!r) return;
            this._openFieldEditor(`编辑地区：${r.name}`, r.fields, (newFields) => {
                r.fields = newFields;
                r.updatedAt = Date.now();
                if (window.SaveManager) window.SaveManager.save();
                this.open();
            });
        },

        _openFieldEditor(title, fields, onSave) {
            const text = (fields._order || [])
                .filter(k => fields[k] !== undefined && fields[k] !== '')
                .map(k => `${k}: ${fields[k]}`).join('\n');

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">✏️ ${title}</div>
                <div style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.6;">
                    每行一个「键: 值」。数值支持 <code>100</code> 或 <code>70/100</code>。
                </div>
                <textarea class="cinemaworld-textarea" id="cw-strategy-field-edit"
                    style="min-height:280px;font-family:monospace;">${text}</textarea>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary" id="cw-strategy-field-save">保存</button>
                    <button class="cinemaworld-button" id="cw-strategy-field-cancel">取消</button>
                </div>`;

            const parse = (str) => {
                const out = { _order: [] };
                for (const raw of str.split('\n')) {
                    const line = raw.trim();
                    if (!line) continue;
                    const m = line.match(/^(.+?)[:：]\s*(.+)$/);
                    if (!m) continue;
                    out[m[1].trim()] = m[2].trim();
                    out._order.push(m[1].trim());
                }
                return out;
            };

            document.getElementById('cw-strategy-field-save').onclick = () => {
                onSave(parse(document.getElementById('cw-strategy-field-edit').value));
            };
            document.getElementById('cw-strategy-field-cancel').onclick = () => this.open();
            modal.className = 'active';
        },

        onViewFactionDetail(factionId) {
            const f = window.StrategyManager.ensureStore().factions[factionId];
            if (!f) return;
            const fields = (f.fields?._order || [])
                .filter(k => f.fields[k] !== undefined && f.fields[k] !== '')
                .map(k => `<div class="cw-strategy-field-row"><span class="key">${k}</span><span class="val">${f.fields[k]}</span></div>`).join('');
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">${f.icon} ${f.name}</div>
                ${f.description ? `<div style="padding:12px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:12px;font-size:13px;color:#ddd;line-height:1.7;">${f.description}</div>` : ''}
                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">📊 数据</div>
                    ${fields || '<div style="color:#666;">暂无数据</div>'}
                </div>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button" onclick="StrategyUIManager._currentTab='others'; StrategyUIManager.open();">← 返回</button>
                </div>`;
            modal.className = 'active';
        },

        // ============================================================
        // 内政事件
        // ============================================================
        async onGeneratePolitics() {
            const guide = document.getElementById('cw-politics-guide')?.value.trim() || '';
            const btn = document.getElementById('cw-politics-gen-btn');
            if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 生成中...'; }
        
            window.UIManager.showText('正在生成内政结构...', 1200);
            try {
                const result = await window.StrategyManager.generatePolitics(guide);
                if (!result) {
                    window.UIManager.showText('❌ 生成失败', 2000);
                    if (btn) { btn.disabled = false; btn.innerHTML = '🏛️ AI 生成内政结构'; }
                    return;
                }
                window.UIManager.showText('✅ 内政结构已生成', 1500);
                this._currentTab = 'politics';
                this.open();
            } catch (e) {
                console.error('[StrategyUI] 生成内政失败:', e);
                window.UIManager.showText(`❌ 生成失败：${e.message}`, 3000);
                if (btn) { btn.disabled = false; btn.innerHTML = '🏛️ AI 生成内政结构'; }
            }
        },

        onEditPolitics() {
            const p = window.StrategyManager.ensurePolitics();
            if (!p.initialized) return;
            if (p.socialForm?.type === 'classless') return;

            const lines = [];
            for (const c of Object.values(p.classes)) {
                lines.push(`${c.name}|人口:${((c.pop||0)*100).toFixed(1)}%|政治力量:${c.politicalPower}|支持度:${c.support}|动员力:${c.mobilization}`);
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">✏️ 编辑阶级数据</div>
                <div style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.6;">
                    每行一个阶级，格式：<br>
                    <code>阶级名|人口:N%|政治力量:N|支持度:N|动员力:N</code>
                </div>
                <textarea class="cinemaworld-textarea" id="cw-politics-edit"
                    style="min-height:220px;font-family:monospace;">${lines.join('\n')}</textarea>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary" id="cw-politics-save">保存</button>
                    <button class="cinemaworld-button" id="cw-politics-cancel">取消</button>
                </div>`;

            document.getElementById('cw-politics-save').onclick = () => {
                const str = document.getElementById('cw-politics-edit').value;
                for (const raw of str.split('\n')) {
                    const line = raw.trim();
                    if (!line) continue;
                    const parts = line.split('|');
                    const name = parts[0].trim();
                    const c = p.classes[name];
                    if (!c) continue;
                    for (let i = 1; i < parts.length; i++) {
                        const kv = parts[i].match(/^(.+?)[:：]\s*(.+)$/);
                        if (!kv) continue;
                        const k = kv[1].trim(), v = kv[2].trim();
                        if (k === '人口') c.pop = parseFloat(v) / 100 || 0;
                        else if (k === '政治力量') c.politicalPower = parseFloat(v) || 0;
                        else if (k === '支持度') c.support = parseFloat(v) || 0;
                        else if (k === '动员力') c.mobilization = parseFloat(v) || 0;
                    }
                }
                window.StrategyManager.computeWealthShares();
                window.StrategyManager.computeLivingStandards();
                window.StrategyManager.computeDiscontent();
                window.StrategyManager.computeClassConsciousness();
                if (window.SaveManager) window.SaveManager.save();
                window.UIManager.showText('✅ 已保存', 1200);
                this.open();
            };
            document.getElementById('cw-politics-cancel').onclick = () => this.open();
            modal.className = 'active';
        },

        // ============================================================
        // 重置
        // ============================================================
        onReset() {
            if (!confirm('确定重置战略层吗？\n\n所有势力、地区、行动、内政记录都会被清除。')) return;
            window.StrategyManager.reset();
            if (window.IntentUI) window.IntentUI.clearMemory();   // ← 新增
            window.UIManager.showText('战略层已重置', 1500);
            this._currentTab = 'faction';
            this.open();
        },

        // ============================================================
        // 工具
        // ============================================================
        _renderBar(label, value, color, suffix = '') {
            const pct = Math.min(100, Math.max(0, value));
            return `
                <div class="cw-strategy-field" style="margin-top:6px;">
                    <div class="cw-strategy-field-label">
                        <span>${label}</span>
                        <span>${suffix || value}</span>
                    </div>
                    <div class="cw-strategy-bar">
                        <div class="cw-strategy-bar-fill" style="width:${pct}%;background:${color}"></div>
                    </div>
                </div>`;
        },

        _formatNumber(n) {
            if (!n && n !== 0) return '—';
            if (n >= 1e12) return (n / 1e12).toFixed(2) + ' 万亿';
            if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿';
            if (n >= 1e4) return (n / 1e4).toFixed(2) + ' 万';
            return String(n);
        },

        _escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },
    };

    window.StrategyUIManager = StrategyUIManager;
    console.log('[CinemaWorld] strategy-ui.js 已加载');
})();