// ============================================================
// CinemaWorld · strategy-actions-ui.js
// 行动/法案/诉求/决议/外交 的 UI
// 依赖：strategy-ui.js, strategy-actions.js, strategy-bills.js,
//       strategy-diplomacy.js, strategy-politics-act.js,
//       strategy-intent-ui.js
// ============================================================

(function () {
    'use strict';

    const StrategyUI = window.StrategyUIManager;
    if (!StrategyUI) {
        console.error('[ActionsUI] StrategyUIManager 未加载');
        return;
    }

    // 扩展 StrategyUIManager，不覆盖原有方法
    Object.assign(StrategyUI, {

        // ============================================================
        // 外交
        // ============================================================
        async onGenerateDiplomacy(factionId) {
            const target = window.StrategyManager.ensureStore().factions[factionId];
            if (!target) return;

            // ★ 意图输入
            const intent = await window.IntentUI.ask({
                key: `diplomacy_${factionId}`,
                title: '外交意图',
                icon: '🤝',
                subtitle: `针对 ${target.icon || ''} ${target.name || ''}`,
                placeholder: '例如：远交近攻，先稳住此国，集中力量对付东边的敌人',
                examples: [
                    { label: '远交近攻', text: '与此国结盟，孤立近邻' },
                    { label: '以夷制夷', text: '挑动此国与其他势力冲突，我方坐收渔利' },
                    { label: '示弱诱敌', text: '假意退让，诱使此国轻敌冒进' },
                    { label: '联姻结好', text: '通过联姻、人质等软化关系' },
                    { label: '强硬施压', text: '陈兵边境，以武力逼迫此国让步' },
                    { label: '挑拨离间', text: '在此国与其他势力之间制造裂痕' },
                ],
            });
            if (intent === null) return;   // 取消

            window.UIManager.showText('正在生成外交行动...', 1000);
            try {
                const actions = await window.DiplomacyManager.generateFor(factionId, intent || '');
                if (!actions || actions.length === 0) {
                    window.UIManager.showText('❌ 生成失败', 2000);
                    return;
                }
                window.UIManager.showText(`✅ 生成了 ${actions.length} 个外交行动`, 1500);
                this._renderDiplomacy(factionId);
            } catch (e) {
                console.error('[ActionsUI] 外交生成失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        _renderDiplomacy(factionId) {
            const f = window.StrategyManager.ensureStore().factions[factionId];
            if (!f) return;
            const actions = window.DiplomacyManager.getActions(factionId);
            const modal = document.getElementById('cinemaworld-modal');

            const actionsHTML = actions.length === 0
                ? `<div style="text-align:center;padding:30px;color:#888;">
                    还没有外交行动
                    <div style="margin-top:15px;">
                        <button class="cinemaworld-button primary"
                            onclick="StrategyUIManager.onGenerateDiplomacy('${factionId}')">
                            🤝 AI 生成外交行动
                        </button>
                    </div>
                   </div>`
                : actions.map(a => this._renderDiplomacyAction(a, factionId)).join('');

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🤝 对 ${f.icon} ${f.name} 的外交</div>
                <div class="cw-strategy-content">${actionsHTML}</div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary"
                        onclick="StrategyUIManager.onGenerateDiplomacy('${factionId}')">🔄 重新生成</button>
                    <button class="cinemaworld-button"
                        onclick="StrategyUIManager._currentTab='others'; StrategyUIManager.open();">← 返回</button>
                </div>`;
            modal.className = 'active cw-strategy-modal';
        },

        _renderDiplomacyAction(a, factionId) {
            const check = window.ActionEngine.computeCheck(a, {});
            const modsHTML = check.modifiers.length > 0
                ? check.modifiers.map(m => `
                    <div class="cw-strategy-turn-log-line" style="font-size:11px;">
                        ${this._escapeHtml(m.label)}
                        <span style="color:${m.effective > 0 ? '#7dd87d' : '#d87d7d'};">
                            ${m.effective > 0 ? '+' : ''}${m.effective}
                        </span>
                    </div>`).join('')
                : '<div style="font-size:11px;color:#666;">无修正</div>';

            const costHTML = Object.entries(a.cost || {}).map(([k, v]) =>
                `<span class="cw-strategy-chip small">${this._escapeHtml(k)} ${v > 0 ? '+' : ''}${v}</span>`
            ).join('');

            const isDone = a.status !== 'available';
            const statusLabel = a.status === 'success' ? '✅ 成功' :
                                a.status === 'failed' ? '❌ 失败' : '';

            // ★ 意图展示
            const intentHTML = a.intent
                ? `<div style="margin-top:6px;font-size:11px;color:#9ab0ff;line-height:1.5;">
                    💭 ${this._escapeHtml(a.intent)}
                   </div>`
                : '';

            return `
                <div class="cw-strategy-action-card ${isDone ? 'completed' : ''}">
                    <div class="cw-strategy-action-head">
                        <div class="cw-strategy-action-icon">${a.icon}</div>
                        <div class="cw-strategy-action-title">
                            <div class="cw-strategy-action-name">${this._escapeHtml(a.name)}</div>
                            ${a.hint ? `<div class="cw-strategy-action-hint">${this._escapeHtml(a.hint)}</div>` : ''}
                        </div>
                    </div>
                    ${costHTML ? `<div class="cw-strategy-chips">${costHTML}</div>` : ''}
                    ${intentHTML}

                    <div style="margin-top:8px;padding:8px;background:rgba(0,0,0,.2);border-radius:6px;">
                        <div style="font-size:12px;color:#9ab0ff;font-weight:600;margin-bottom:4px;">
                            成功率: <span style="color:#ffd76b;">${check.final}%</span>
                            <span style="color:#666;font-weight:400;">(基础 ${check.base})</span>
                        </div>
                        ${modsHTML}
                    </div>

                    <div style="text-align:center;margin-top:10px;">
                        ${isDone
                            ? `<span style="color:#666;font-size:12px;">${statusLabel}</span>`
                            : `<button class="cinemaworld-button primary" style="font-size:13px;padding:6px 18px;"
                                onclick="StrategyUIManager.onExecuteDiplomacy('${factionId}','${a.id}')">▶️ 执行</button>`}
                    </div>
                </div>`;
        },

        async onExecuteDiplomacy(factionId, actionId) {
            try {
                const result = await window.DiplomacyManager.execute(factionId, actionId);
                if (!result.ok) {
                    window.UIManager.showText(`❌ ${result.reason}`, 2000);
                    return;
                }
                window.UIManager.showText(
                    result.result.success ? '✅ 外交成功' : '❌ 外交失败',
                    1500
                );
                this._renderDiplomacy(factionId);
            } catch (e) {
                console.error('[ActionsUI] 外交执行失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        // ============================================================
        // 内政行动
        // ============================================================
        async onGeneratePoliticsActions() {
            // ★ 意图输入
            const intent = await window.IntentUI.ask({
                key: 'politics_actions',
                title: '内政意图',
                icon: '⚙️',
                placeholder: '例如：先削弱封建地主，再拉拢商人，为改革铺路',
                examples: [
                    { label: '削弱豪强', text: '打击地方豪强与旧贵族，加强中央集权' },
                    { label: '与民休息', text: '轻徭薄赋，恢复民生，提高农民支持' },
                    { label: '富国强兵', text: '发展生产，充实军备' },
                    { label: '拉一派打一派', text: '扶持改革派，压制守旧派' },
                    { label: '广开言路', text: '提拔寒门，扩大统治基础' },
                    { label: '清丈田亩', text: '重新丈量土地，清查隐田，增加税收' },
                ],
            });
            if (intent === null) return;

            window.UIManager.showText('正在生成内政行动...', 1000);
            try {
                const actions = await window.PoliticsActionManager.generateActions(intent || '');
                if (!actions || actions.length === 0) {
                    window.UIManager.showText('❌ 生成失败', 2000);
                    return;
                }
                window.UIManager.showText(`✅ 生成了 ${actions.length} 个内政行动`, 1500);
                this._renderPoliticsActions();
            } catch (e) {
                console.error('[ActionsUI] 内政行动生成失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        _renderPoliticsActions() {
            const all = window.PoliticsActionManager.ensureStore().politicsActions;
            const modal = document.getElementById('cinemaworld-modal');

            const html = all.length === 0
                ? `<div style="text-align:center;padding:30px;color:#888;">
                    <div style="margin-bottom:15px;">还没有内政行动</div>
                    <button class="cinemaworld-button primary"
                        onclick="StrategyUIManager.onGeneratePoliticsActions()">⚙️ AI 生成内政行动</button>
                   </div>`
                : all.map(a => this._renderPoliticsActionCard(a)).join('');

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚙️ 内政行动</div>
                <div class="cw-strategy-content">${html}</div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary"
                        onclick="StrategyUIManager.onGeneratePoliticsActions()">🔄 重新生成</button>
                    <button class="cinemaworld-button"
                        onclick="StrategyUIManager._currentTab='politics'; StrategyUIManager.open();">← 返回</button>
                </div>`;
            modal.className = 'active cw-strategy-modal';
        },

        _renderPoliticsActionCard(a) {
            const check = window.ActionEngine.computeCheck(a, {});
            const modsHTML = check.modifiers.length > 0
                ? check.modifiers.map(m => `
                    <div class="cw-strategy-turn-log-line" style="font-size:11px;">
                        ${this._escapeHtml(m.label)}
                        <span style="color:${m.effective > 0 ? '#7dd87d' : '#d87d7d'};">
                            ${m.effective > 0 ? '+' : ''}${m.effective}
                        </span>
                    </div>`).join('')
                : '<div style="font-size:11px;color:#666;">无修正</div>';

            const costHTML = Object.entries(a.cost || {}).map(([k, v]) =>
                `<span class="cw-strategy-chip small">${this._escapeHtml(k)} ${v > 0 ? '+' : ''}${v}</span>`
            ).join('');

            const isDone = a.status !== 'available';
            const statusLabel = a.status === 'success' ? '✅ 成功' :
                                a.status === 'failed' ? '❌ 失败' : '';

            const intentHTML = a.intent
                ? `<div style="margin-top:6px;font-size:11px;color:#9ab0ff;line-height:1.5;">
                    💭 ${this._escapeHtml(a.intent)}
                   </div>`
                : '';

            return `
                <div class="cw-strategy-action-card ${isDone ? 'completed' : ''}">
                    <div class="cw-strategy-action-head">
                        <div class="cw-strategy-action-icon">${a.icon}</div>
                        <div class="cw-strategy-action-title">
                            <div class="cw-strategy-action-name">${this._escapeHtml(a.name)}</div>
                            ${a.hint ? `<div class="cw-strategy-action-hint">${this._escapeHtml(a.hint)}</div>` : ''}
                        </div>
                    </div>
                    ${costHTML ? `<div class="cw-strategy-chips">${costHTML}</div>` : ''}
                    ${intentHTML}

                    <div style="margin-top:8px;padding:8px;background:rgba(0,0,0,.2);border-radius:6px;">
                        <div style="font-size:12px;color:#9ab0ff;font-weight:600;margin-bottom:4px;">
                            成功率: <span style="color:#ffd76b;">${check.final}%</span>
                        </div>
                        ${modsHTML}
                    </div>

                    <div style="text-align:center;margin-top:10px;">
                        ${isDone
                            ? `<span style="color:#666;font-size:12px;">${statusLabel}</span>`
                            : `<button class="cinemaworld-button primary" style="font-size:13px;padding:6px 18px;"
                                onclick="StrategyUIManager.onExecutePoliticsAction('${a.id}')">▶️ 执行</button>`}
                    </div>
                </div>`;
        },

        async onExecutePoliticsAction(actionId) {
            try {
                const result = await window.PoliticsActionManager.execute(actionId);
                if (!result.ok) {
                    window.UIManager.showText(`❌ ${result.reason}`, 2000);
                    return;
                }
                window.UIManager.showText(result.result.success ? '✅ 成功' : '❌ 失败', 1500);
                this._renderPoliticsActions();
            } catch (e) {
                console.error('[ActionsUI] 内政行动执行失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        // ============================================================
        // 法案
        // ============================================================
        async onGenerateBills() {
            // ★ 意图输入
            const intent = await window.IntentUI.ask({
                key: 'bills',
                title: '立法意图',
                icon: '📜',
                placeholder: '例如：推动男女平等，但先给地主留些余地，避免激烈反弹',
                examples: [
                    { label: '温和改革', text: '小步推进，给旧势力留缓冲' },
                    { label: '激进变法', text: '大刀阔斧，彻底改变旧制度' },
                    { label: '争取民心', text: '面向底层，扩大统治基础' },
                    { label: '巩固皇权', text: '强化中央集权，削弱地方' },
                    { label: '弥合裂痕', text: '安抚分裂的派系，寻求共识' },
                    { label: '以退为进', text: '先推容易通过的，攒威望再推难的' },
                ],
            });
            if (intent === null) return;

            window.UIManager.showText('正在生成法案...', 1200);
            try {
                const bills = await window.BillManager.generateBills(intent || '');
                if (!bills || bills.length === 0) {
                    window.UIManager.showText('❌ 生成失败', 2000);
                    return;
                }
                window.UIManager.showText(`✅ 生成了 ${bills.length} 个法案`, 1500);
                this._renderBills();
            } catch (e) {
                console.error('[ActionsUI] 法案生成失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        _renderBills() {
            const BM = window.BillManager;
            const proposed = BM.getProposedBills();
            const active = BM.getActiveBills();
            const store = BM.ensureStore();
            const history = store.bills.filter(b =>
                ['stabilized', 'reverted', 'repealed', 'rejected'].includes(b.state)
            );

            const modal = document.getElementById('cinemaworld-modal');
            const html = `
                ${proposed.length > 0 ? `
                    <div class="cw-strategy-section">
                        <div class="cw-strategy-section-title">📋 待表决 (${proposed.length})</div>
                        ${proposed.map(b => this._renderBillCard(b)).join('')}
                    </div>` : ''}

                ${active.length > 0 ? `
                    <div class="cw-strategy-section">
                        <div class="cw-strategy-section-title">🔥 落实中 (${active.length})</div>
                        ${active.map(b => this._renderBillCard(b)).join('')}
                    </div>` : ''}

                ${history.length > 0 ? `
                    <div class="cw-strategy-section">
                        <div class="cw-strategy-section-title">📜 历史 (${history.length})</div>
                        ${history.map(b => this._renderBillHistory(b)).join('')}
                    </div>` : ''}

                ${proposed.length + active.length + history.length === 0 ? `
                    <div style="text-align:center;padding:30px;color:#888;">
                        <div style="margin-bottom:15px;">还没有法案</div>
                        <button class="cinemaworld-button primary"
                            onclick="StrategyUIManager.onGenerateBills()">📜 AI 生成法案</button>
                    </div>` : ''}
            `;

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📜 法案</div>
                <div class="cw-strategy-content">${html}</div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary"
                        onclick="StrategyUIManager.onGenerateBills()">🔄 生成新法案</button>
                    <button class="cinemaworld-button"
                        onclick="StrategyUIManager._currentTab='politics'; StrategyUIManager.open();">← 返回</button>
                </div>`;
            modal.className = 'active cw-strategy-modal';
        },

        _renderBillCard(b) {
            const vote = window.ActionEngine.computeVote(b, {});
            const stateLabels = {
                proposed: '待表决',
                active: '落实中',
                reverting: '⚠️ 倒退危机',
                stabilized: '✅ 已稳定',
                reverted: '↩️ 已倒退',
                repealed: '❌ 已废除',
                rejected: '❌ 被否决',
            };
            const isActive = b.state === 'active' || b.state === 'reverting';

            const supportNames = b.vote.supporters.map(s => s.split(':')[1]).join('、');
            const opposeNames = b.vote.opponents.map(s => s.split(':')[1]).join('、');

            const stability = b.ongoing.stability.current || 0;
            const backlash = b.ongoing.backlash.accumulated || 0;
            const backlashMax = b.ongoing.backlash.threshold || 100;

            const effectsHTML = b.ongoing.effects.map(e => {
                const name = e.source.split(':')[1];
                return `<div class="cw-strategy-turn-log-line" style="font-size:11px;">
                    ${this._escapeHtml(name)}: ${this._escapeHtml(e.field)} ${e.op === 'add' ? '+' : '-'}${e.value}/回合
                </div>`;
            }).join('');

            // ★ 意图展示
            const intentHTML = b.intent
                ? `<div style="margin-top:6px;font-size:11px;color:#9ab0ff;line-height:1.5;">
                    💭 ${this._escapeHtml(b.intent)}
                   </div>`
                : '';

            return `
                <div class="cw-strategy-action-card" style="border-color:${b.state === 'reverting' ? '#d87d7d' : 'rgba(120,150,255,.18)'};">
                    <div class="cw-strategy-action-head">
                        <div class="cw-strategy-action-icon">${b.icon}</div>
                        <div class="cw-strategy-action-title">
                            <div class="cw-strategy-action-name">
                                ${this._escapeHtml(b.name)}
                                <span class="cw-strategy-title-badge small" style="margin-left:6px;">
                                    ${stateLabels[b.state] || b.state}
                                </span>
                            </div>
                            ${b.desc ? `<div class="cw-strategy-action-hint">${this._escapeHtml(b.desc)}</div>` : ''}
                        </div>
                    </div>
                    ${intentHTML}

                    <div style="margin-top:10px;padding:8px;background:rgba(0,0,0,.2);border-radius:6px;">
                        <div style="font-size:12px;color:#7dd87d;margin-bottom:4px;">
                            支持：${this._escapeHtml(supportNames) || '—'}
                        </div>
                        <div style="font-size:12px;color:#d87d7d;margin-bottom:6px;">
                            反对：${this._escapeHtml(opposeNames) || '—'}
                        </div>
                        <div style="font-size:12px;color:#9ab0ff;">
                            投票：<span style="color:${vote.pass ? '#7dd87d' : '#d87d7d'};">
                                ${vote.forPct}%
                            </span>
                            （阈值 ${vote.threshold}%）
                        </div>
                    </div>

                    ${isActive ? `
                    <div style="margin-top:10px;">
                        <div class="cw-strategy-field">
                            <div class="cw-strategy-field-label">
                                <span>稳定度</span>
                                <span>${Math.round(stability)}/100</span>
                            </div>
                            <div class="cw-strategy-bar">
                                <div class="cw-strategy-bar-fill" style="width:${stability}%;background:${stability > 60 ? '#7dd87d' : stability > 30 ? '#d8c07d' : '#d87d7d'}"></div>
                            </div>
                        </div>
                        <div class="cw-strategy-field">
                            <div class="cw-strategy-field-label">
                                <span>反对压力</span>
                                <span>${Math.round(backlash)}/${backlashMax}</span>
                            </div>
                            <div class="cw-strategy-bar">
                                <div class="cw-strategy-bar-fill" style="width:${Math.min(100, backlash / backlashMax * 100)}%;background:${backlash > backlashMax * 0.7 ? '#d87d7d' : '#d8c07d'}"></div>
                            </div>
                        </div>
                    </div>` : ''}

                    ${effectsHTML ? `
                    <div style="margin-top:8px;">
                        <div style="font-size:11px;color:#888;margin-bottom:4px;">每回合效果</div>
                        ${effectsHTML}
                    </div>` : ''}

                    <div style="text-align:center;margin-top:10px;display:flex;justify-content:center;gap:6px;flex-wrap:wrap;">
                        ${b.state === 'proposed'
                            ? `<button class="cinemaworld-button primary" style="font-size:13px;padding:6px 18px;"
                                onclick="StrategyUIManager.onVoteBill('${b.id}')">🗳️ 发起投票</button>`
                            : ''}
                        ${b.state === 'reverting'
                            ? `
                                <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;color:#d87d7d;"
                                    onclick="StrategyUIManager.onInterveneBill('${b.id}','suppress')">🛡️ 镇压</button>
                                <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;"
                                    onclick="StrategyUIManager.onInterveneBill('${b.id}','coopt')">🤝 拉拢</button>
                                <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;"
                                    onclick="StrategyUIManager.onInterveneBill('${b.id}','compromise')">⚖️ 妥协</button>
                            ` : ''}
                    </div>
                </div>`;
        },

        _renderBillHistory(b) {
            const stateLabels = {
                stabilized: '✅ 已稳定',
                reverted: '↩️ 已倒退',
                repealed: '❌ 已废除',
                rejected: '❌ 被否决',
            };
            return `
                <div class="cw-strategy-turn-log">
                    <div class="cw-strategy-turn-log-head">
                        <span>${b.icon} ${this._escapeHtml(b.name)}</span>
                        <span style="font-size:11px;color:#666;">${stateLabels[b.state] || b.state}</span>
                    </div>
                    ${b.stateHistory?.map(h => `
                        <div class="cw-strategy-turn-log-line" style="font-size:11px;">
                            第 ${h.turn} 回合：${this._escapeHtml(h.reason)}
                        </div>
                    `).join('') || ''}
                </div>`;
        },

        async onVoteBill(billId) {
            try {
                const result = await window.BillManager.voteBill(billId);
                if (!result) return;
                window.UIManager.showText(
                    result.result.pass ? '✅ 法案通过' : '❌ 法案被否决',
                    1500
                );
                this._renderBills();
            } catch (e) {
                console.error('[ActionsUI] 投票失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        async onInterveneBill(billId, type) {
            try {
                const result = await window.BillManager.intervene(billId, type);
                if (!result) {
                    window.UIManager.showText('❌ 干预失败', 2000);
                    return;
                }
                window.UIManager.showText('✅ 干预成功', 1500);
                this._renderBills();
            } catch (e) {
                console.error('[ActionsUI] 干预失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        // ============================================================
        // 阶级诉求
        // ============================================================
        async onGenerateDemands() {
            // ★ 意图输入
            const intent = await window.IntentUI.ask({
                key: 'demands',
                title: '诉求生成意图',
                icon: '⚠️',
                placeholder: '例如：让农民提出温和的经济诉求，让士人提出政治改革诉求',
                examples: [
                    { label: '经济为主', text: '以减税、赈灾、均田等经济诉求为主' },
                    { label: '政治诉求', text: '以参政、废特权、变法为主' },
                    { label: '激烈化', text: '让底层提出更激进的要求' },
                    { label: '分化', text: '不同阶级诉求互相冲突，方便借力打力' },
                    { label: '只针对某阶级', text: '只让农民阶级提出诉求' },
                ],
                allowEmpty: true,
            });
            if (intent === null) return;

            window.UIManager.showText('正在生成阶级诉求...', 1200);
            try {
                await window.PoliticsActionManager.generateDemands(intent || '');
                window.UIManager.showText('✅ 诉求已生成', 1500);
                this._renderDemands();
            } catch (e) {
                console.error('[ActionsUI] 诉求生成失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        _renderDemands() {
            const PAM = window.PoliticsActionManager;
            const p = window.StrategyManager.ensurePolitics();
            const store = PAM.ensureStore();
            const modal = document.getElementById('cinemaworld-modal');

            const classes = Object.values(p.classes || {});
            const hasAny = classes.some(c => (store.classDemands[c.name] || []).length > 0);

            const html = !hasAny
                ? `<div style="text-align:center;padding:30px;color:#888;">
                    <div style="margin-bottom:15px;">还没有阶级诉求</div>
                    <button class="cinemaworld-button primary"
                        onclick="StrategyUIManager.onGenerateDemands()">⚠️ AI 生成诉求</button>
                   </div>`
                : classes.map(c => {
                    const demands = store.classDemands[c.name] || [];
                    if (demands.length === 0) return '';
                    return `
                        <div class="cw-strategy-section">
                            <div class="cw-strategy-section-title">
                                ${c.icon || '👥'} ${this._escapeHtml(c.name)}
                                <span style="font-size:11px;color:#888;font-weight:400;margin-left:8px;">
                                    不满 ${c.discontent || 0} · 觉悟 ${c.consciousness || 0}
                                </span>
                            </div>
                            ${demands.map(d => this._renderDemandCard(c, d)).join('')}
                        </div>`;
                }).join('');

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚠️ 阶级诉求</div>
                <div class="cw-strategy-content">${html}</div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary"
                        onclick="StrategyUIManager.onGenerateDemands()">🔄 重新生成</button>
                    <button class="cinemaworld-button"
                        onclick="StrategyUIManager._currentTab='politics'; StrategyUIManager.open();">← 返回</button>
                </div>`;
            modal.className = 'active cw-strategy-modal';
        },

        _renderDemandCard(cls, d) {
            const deadline = d.deadline || 0;
            const deadlineColor = deadline <= 1 ? '#d87d7d' : deadline <= 2 ? '#d8c07d' : '#7dd87d';

            return `
                <div class="cw-strategy-action-card" style="border-color:${deadlineColor}44;">
                    <div class="cw-strategy-action-head">
                        <div class="cw-strategy-action-icon">${d.icon}</div>
                        <div class="cw-strategy-action-title">
                            <div class="cw-strategy-action-name">${this._escapeHtml(d.name)}</div>
                            <div class="cw-strategy-action-hint">
                                剩余 <span style="color:${deadlineColor};font-weight:700;">${deadline}</span> 回合
                            </div>
                        </div>
                    </div>
                    ${d.desc ? `<div class="cw-strategy-action-hint" style="margin-top:6px;">${this._escapeHtml(d.desc)}</div>` : ''}
                    <div style="text-align:center;margin-top:10px;display:flex;justify-content:center;gap:6px;flex-wrap:wrap;">
                        <button class="cinemaworld-button primary" style="font-size:12px;padding:5px 12px;"
                            onclick="StrategyUIManager.onHandleDemand('${this._escapeAttr(cls.name)}','${d.id}','satisfy')">✅ 满足</button>
                        <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;color:#888;"
                            onclick="StrategyUIManager.onHandleDemand('${this._escapeAttr(cls.name)}','${d.id}','ignore')">🚫 无视</button>
                        <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;color:#d87d7d;"
                            onclick="StrategyUIManager.onHandleDemand('${this._escapeAttr(cls.name)}','${d.id}','suppress')">⚔️ 镇压</button>
                    </div>
                </div>`;
        },

        async onHandleDemand(className, demandId, choice) {
            try {
                const result = await window.PoliticsActionManager.handleDemand(className, demandId, choice);
                if (!result) return;
                const label = choice === 'satisfy' ? '已满足' :
                              choice === 'ignore' ? '已无视' :
                              result.success ? '镇压成功' : '镇压失败';
                window.UIManager.showText(label, 1500);
                this._renderDemands();
            } catch (e) {
                console.error('[ActionsUI] 处理诉求失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        // ============================================================
        // 派系决议
        // ============================================================
        async onGenerateResolutions() {
            // ★ 意图输入
            const intent = await window.IntentUI.ask({
                key: 'resolutions',
                title: '决议生成意图',
                icon: '🗳️',
                placeholder: '例如：让改革派提出激进的变法决议，让守旧派反击',
                examples: [
                    { label: '激化矛盾', text: '让派系间冲突更激烈' },
                    { label: '温和过渡', text: '让派系提出温和可妥协的决议' },
                    { label: '军方主导', text: '让军功集团提出扩张、扩军类决议' },
                    { label: '文人主导', text: '让士人集团提出制度、礼法类决议' },
                    { label: '只针对某派系', text: '只让改革派提出决议' },
                ],
                allowEmpty: true,
            });
            if (intent === null) return;

            window.UIManager.showText('正在生成派系决议...', 1200);
            try {
                const res = await window.PoliticsActionManager.generateResolutions(intent || '');
                if (!res || res.length === 0) {
                    window.UIManager.showText('❌ 生成失败', 2000);
                    return;
                }
                window.UIManager.showText(`✅ 生成了 ${res.length} 个决议`, 1500);
                this._renderResolutions();
            } catch (e) {
                console.error('[ActionsUI] 决议生成失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        _renderResolutions() {
            const PAM = window.PoliticsActionManager;
            const resolutions = PAM.getResolutions();
            const modal = document.getElementById('cinemaworld-modal');

            const html = resolutions.length === 0
                ? `<div style="text-align:center;padding:30px;color:#888;">
                    <div style="margin-bottom:15px;">还没有派系决议</div>
                    <button class="cinemaworld-button primary"
                        onclick="StrategyUIManager.onGenerateResolutions()">🗳️ AI 生成决议</button>
                   </div>`
                : resolutions.map(r => this._renderResolutionCard(r)).join('');

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🗳️ 派系决议</div>
                <div class="cw-strategy-content">${html}</div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary"
                        onclick="StrategyUIManager.onGenerateResolutions()">🔄 重新生成</button>
                    <button class="cinemaworld-button"
                        onclick="StrategyUIManager._currentTab='politics'; StrategyUIManager.open();">← 返回</button>
                </div>`;
            modal.className = 'active cw-strategy-modal';
        },

        _renderResolutionCard(r) {
            const optionsHTML = ['支持', '反对', '搁置'].map(opt => {
                const o = r.options[opt];
                if (!o) return '';
                const check = window.ActionEngine.computeCheck(o, {});

                const modsHTML = check.modifiers.length > 0
                    ? check.modifiers.map(m => `
                        <div class="cw-strategy-turn-log-line" style="font-size:11px;">
                            ${this._escapeHtml(m.label)}
                            <span style="color:${m.effective > 0 ? '#7dd87d' : '#d87d7d'};">
                                ${m.effective > 0 ? '+' : ''}${m.effective}
                            </span>
                        </div>`).join('')
                    : '';

                return `
                    <div style="margin-top:8px;padding:8px;background:rgba(0,0,0,.2);border-radius:6px;">
                        <div style="font-size:12px;color:#9ab0ff;font-weight:600;margin-bottom:4px;">
                            ${opt}　成功率: <span style="color:#ffd76b;">${check.final}%</span>
                        </div>
                        ${modsHTML}
                        <div style="text-align:right;margin-top:4px;">
                            <button class="cinemaworld-button primary" style="font-size:11px;padding:4px 12px;"
                                onclick="StrategyUIManager.onHandleResolution('${this._escapeAttr(r.groupName)}','${r.id}','${opt}')">
                                ${opt}
                            </button>
                        </div>
                    </div>`;
            }).join('');

            const intentHTML = r.intent
                ? `<div style="margin-top:6px;font-size:11px;color:#9ab0ff;line-height:1.5;">
                    💭 ${this._escapeHtml(r.intent)}
                   </div>`
                : '';

            return `
                <div class="cw-strategy-action-card">
                    <div class="cw-strategy-action-head">
                        <div class="cw-strategy-action-icon">${r.icon}</div>
                        <div class="cw-strategy-action-title">
                            <div class="cw-strategy-action-name">${this._escapeHtml(r.name)}</div>
                            <div class="cw-strategy-action-hint">
                                ${this._escapeHtml(r.groupName)} · ${this._escapeHtml(r.factionName)}
                            </div>
                        </div>
                    </div>
                    ${r.desc ? `<div class="cw-strategy-action-hint" style="margin-top:6px;">${this._escapeHtml(r.desc)}</div>` : ''}
                    ${intentHTML}
                    ${optionsHTML}
                </div>`;
        },

        async onHandleResolution(groupName, resolutionId, choice) {
            try {
                const result = await window.PoliticsActionManager.handleResolution(groupName, resolutionId, choice);
                if (!result) return;
                window.UIManager.showText(
                    result.success ? `✅ ${choice}成功` : `❌ ${choice}失败`,
                    1500
                );
                this._renderResolutions();
            } catch (e) {
                console.error('[ActionsUI] 处理决议失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        // ============================================================
        // 工具：HTML 属性转义（用于 onclick 里的字符串）
        // ============================================================
        _escapeAttr(str) {
            return String(str)
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/&/g, '&amp;');
        },
    });

    console.log('[CinemaWorld] strategy-actions-ui.js 已加载');
})();