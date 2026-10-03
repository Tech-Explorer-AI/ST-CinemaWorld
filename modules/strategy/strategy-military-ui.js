// ============================================================
// CinemaWorld · strategy-military-ui.js
// 军事面板 UI：战役生成 / 执行 / 结果展示
// 依赖：strategy-ui.js, strategy-military.js
// ============================================================

(function () {
    'use strict';

    const StrategyUI = window.StrategyUIManager;
    if (!StrategyUI) {
        console.error('[MilitaryUI] StrategyUIManager 未加载');
        return;
    }

    Object.assign(StrategyUI, {

        // ============================================================
        // 打开战役面板
        // ============================================================
        async _renderMilitaryCampaigns(targetType, targetId) {
            const campaigns = window.MilitaryManager.getCampaignsByTarget(targetType, targetId);
            const modal = document.getElementById('cinemaworld-modal');
            const target = targetType === 'faction'
                ? window.StrategyManager.ensureStore().factions[targetId]
                : window.StrategyManager.ensureStore().regions[targetId];
            if (!target) return;

            const playerFaction = window.StrategyManager.getPlayerFaction();
            const playerTroops = window.MilitaryEngine.getTroops(playerFaction);

            const html = campaigns.length === 0
                ? `<div style="text-align:center;padding:30px;color:#888;">
                    <div style="margin-bottom:15px;">还没有军事行动</div>
                    <button class="cinemaworld-button primary"
                        onclick="StrategyUIManager.onGenerateMilitary('${targetType}','${targetId}')">
                        ⚔️ AI 生成军事行动
                    </button>
                   </div>`
                : campaigns.map(c => this._renderCampaignCard(c)).join('');

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚔️ 对 ${target.icon} ${target.name} 的军事</div>
                <div style="text-align:center;font-size:12px;color:#888;margin-bottom:10px;">
                    我方总兵力：<span style="color:#ffd76b;font-weight:700;">${playerTroops}</span>
                </div>
                <div class="cw-strategy-content">${html}</div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary"
                        onclick="StrategyUIManager.onGenerateMilitary('${targetType}','${targetId}')">🔄 重新生成</button>
                    <button class="cinemaworld-button"
                        onclick="StrategyUIManager._currentTab='${targetType === 'faction' ? 'others' : 'regions'}'; StrategyUIManager.open();">← 返回</button>
                </div>`;
            modal.className = 'active cw-strategy-modal';
        },

        _renderCampaignCard(c) {
            const typeLabels = {
                attack: '夺取', raid: '劫掠', annex: '吞并',
                siege: '围攻', defend: '防守',
            };
            const typeLabel = typeLabels[c.type] || c.type;

            // 填充预览（攻守数据）
            const store = window.StrategyManager.ensureStore();
            const playerFaction = window.StrategyManager.getPlayerFaction();
            const tempCampaign = JSON.parse(JSON.stringify(c));
            tempCampaign.forces.attacker.factionId = playerFaction.id;
            tempCampaign.forces.attacker.morale = window.MilitaryEngine.getMorale(playerFaction);
            tempCampaign.forces.attacker.militaryTech = window.MilitaryEngine.getMilitaryTech(playerFaction);
            if (!tempCampaign.forces.attacker.troops) {
                tempCampaign.forces.attacker.troops = Math.min(
                    window.MilitaryEngine.getTroops(playerFaction),
                    Math.round(window.MilitaryEngine.getTroops(playerFaction) * 0.5)
                );
            }
            // 填充守方
            window.MilitaryManager._fillDefender(tempCampaign);

            const preview = window.MilitaryEngine.computePreview(tempCampaign);

            const modsHTML = preview.modifiers.slice(0, 6).map(m => `
                <div class="cw-strategy-turn-log-line" style="font-size:11px;">
                    ${m.label}
                    <span style="color:${m.value > 0 ? '#7dd87d' : '#d87d7d'};">
                        ${m.value > 0 ? '+' : ''}${m.value}
                    </span>
                </div>`).join('');

            const costHTML = Object.entries(c.cost || {}).map(([k, v]) =>
                `<span class="cw-strategy-chip small">${k} ${v > 0 ? '+' : ''}${v}</span>`
            ).join('');

            const isDone = c.status !== 'planned';
            const resultLabel = isDone
                ? (c.outcome?.winner === 'attacker' ? '✅ 我军胜利' : '❌ 我军失利')
                : '';

            return `
                <div class="cw-strategy-action-card" style="border-color:rgba(216,125,125,.3);">
                    <div class="cw-strategy-action-head">
                        <div class="cw-strategy-action-icon">${c.icon}</div>
                        <div class="cw-strategy-action-title">
                            <div class="cw-strategy-action-name">
                                ${c.name}
                                <span class="cw-strategy-title-badge small" style="margin-left:6px;color:#ffb8b8;border-color:rgba(216,125,125,.4);">
                                    ${typeLabel}
                                </span>
                            </div>
                            ${c.hint ? `<div class="cw-strategy-action-hint">${c.hint}</div>` : ''}
                        </div>
                    </div>

                    ${costHTML ? `<div class="cw-strategy-chips">${costHTML}</div>` : ''}

                    <div style="margin-top:10px;padding:8px;background:rgba(0,0,0,.2);border-radius:6px;">
                        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                            <span style="color:#9ab0ff;">我军 <b>${c.forces.attacker.troops || preview.atkPower}</b> 兵</span>
                            <span style="color:#d87d7d;">敌军 <b>${tempCampaign.forces.defender.troops || 0}</b> 兵</span>
                        </div>
                        ${c.forces.attacker.commander ? `<div style="font-size:11px;color:#888;margin-bottom:4px;">
                            将领：${c.forces.attacker.commander}
                        </div>` : ''}
                        <div style="font-size:12px;color:#9ab0ff;font-weight:600;margin:6px 0 4px;">
                            预估胜率: <span style="color:#ffd76b;font-size:14px;">${preview.winChance}%</span>
                        </div>
                        ${modsHTML}
                        <div style="font-size:11px;color:#888;margin-top:6px;">
                            预估损失：我方 ${preview.attackerLoss.min}-${preview.attackerLoss.max}，
                            敌方 ${preview.defenderLoss.min}-${preview.defenderLoss.max}
                        </div>
                    </div>

                    <div style="text-align:center;margin-top:10px;">
                        ${isDone
                            ? `<span style="color:#666;font-size:12px;">${resultLabel}</span>`
                            : `<button class="cinemaworld-button primary" style="font-size:13px;padding:6px 18px;color:#ffb8b8;border-color:rgba(216,125,125,.4);"
                                onclick="StrategyUIManager.onExecuteCampaign('${c.id}')">⚔️ 出战</button>`}
                    </div>
                </div>`;
        },

        // ============================================================
        // 生成战役
        // ============================================================
        async onGenerateMilitary(targetType, targetId) {
            const target = targetType === 'faction'
                ? window.StrategyManager.ensureStore().factions[targetId]
                : window.StrategyManager.ensureStore().regions[targetId];

            const intent = await window.IntentUI.ask({
                key: `military_${targetId}`,
                title: '军事意图',
                icon: '⚔️',
                subtitle: `针对 ${target?.icon || ''} ${target?.name || ''}`,
                placeholder: '例如：正面佯攻，主力从侧翼穿插，包围敌军',
                examples: [
                    { label: '正面强攻', text: '集中兵力正面突破，速战速决' },
                    { label: '战略穿插', text: '主力绕道，切断敌人退路' },
                    { label: '围点打援', text: '围困要塞，伏击援军' },
                    { label: '声东击西', text: '佯攻一处，主力突袭另一处' },
                    { label: '坚壁清野', text: '诱敌深入，断其粮道' },
                    { label: '闪电突袭', text: '轻兵急进，一举夺城' },
                    { label: '稳扎稳打', text: '步步为营，减少损失' },
                ],
            });
            if (intent === null) return;
            window.UIManager.showText('正在生成军事行动...', 1000);
            try {
                const campaigns = await window.MilitaryManager.generateCampaigns(
                    targetType, targetId, intent
                );
                if (!campaigns || campaigns.length === 0) {
                    window.UIManager.showText('❌ 生成失败', 2000);
                    return;
                }
                window.UIManager.showText(`✅ 生成了 ${campaigns.length} 个军事行动`, 1500);
                this._renderMilitaryCampaigns(targetType, targetId);
            } catch (e) {
                console.error('[MilitaryUI] 生成失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        // ============================================================
        // 执行战役
        // ============================================================
        async onExecuteCampaign(campaignId) {
            try {
                const result = await window.MilitaryManager.executeCampaign(campaignId);
                if (!result.ok) {
                    window.UIManager.showText(`❌ ${result.reason}`, 2000);
                    return;
                }
                this._renderCampaignResult(result.campaign, result.result);
            } catch (e) {
                console.error('[MilitaryUI] 战役执行失败:', e);
                window.UIManager.showText(`❌ ${e.message}`, 3000);
            }
        },

        _renderCampaignResult(campaign, result) {
            const modal = document.getElementById('cinemaworld-modal');
            const win = result.winner === 'attacker';
            const color = win ? '#7dd87d' : '#d87d7d';
            const title = win ? '✅ 我军胜利' : '❌ 我军失利';

            modal.innerHTML = `
                <div class="cinemaworld-modal-title" style="color:${color};">⚔️ ${title}</div>
                <div style="text-align:center;font-size:14px;color:#ddd;margin-bottom:15px;">
                    ${campaign.name}
                </div>

                <div class="cw-strategy-section">
                    <div class="cw-strategy-section-title">📊 战果</div>
                    <div class="cw-strategy-field-row">
                        <span class="key">我军损失</span>
                        <span class="val" style="color:#d87d7d;">${result.attackerLoss}</span>
                    </div>
                    <div class="cw-strategy-field-row">
                        <span class="key">敌军损失</span>
                        <span class="val" style="color:#7dd87d;">${result.defenderLoss}</span>
                    </div>
                    <div class="cw-strategy-field-row">
                        <span class="key">胜负判定</span>
                        <span class="val" style="color:${color};">${result.roll.toFixed(1)} / ${result.preview.winChance}%</span>
                    </div>
                </div>

                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button primary" onclick="StrategyUIManager.close()">关闭</button>
                </div>`;
            modal.className = 'active';
        },

        // ============================================================
        // 军事历史
        // ============================================================
        _renderMilitaryHistory() {
            const history = window.MilitaryManager.ensureStore().militaryHistory;
            const modal = document.getElementById('cinemaworld-modal');

            const html = history.length === 0
                ? `<div style="text-align:center;padding:30px;color:#888;">还没有军事记录</div>`
                : history.slice().reverse().map(h => {
                    const labels = {
                        campaign: '⚔️ 战役',
                        region_captured: '🏴 占领',
                        faction_destroyed: '💀 灭亡',
                        faction_collapsed: '💥 崩溃',
                        enemy_attack: '🛡️ 遇袭',
                    };
                    const label = labels[h.type] || h.type;
                    let desc = '';
                    if (h.type === 'campaign') desc = `${h.name} · ${h.winner === 'attacker' ? '我军胜' : '我军败'}`;
                    else if (h.type === 'region_captured') desc = `${h.region} 被 ${h.by} 占领`;
                    else if (h.type === 'faction_destroyed') desc = `${h.faction} 被 ${h.by} 灭亡`;
                    else if (h.type === 'faction_collapsed') desc = `${h.faction} 崩溃`;
                    else if (h.type === 'enemy_attack') desc = `${h.attacker} 进攻 ${h.region}（${h.winner === 'attacker' ? '失守' : '击退'}）`;

                    return `<div class="cw-strategy-turn-log">
                        <div class="cw-strategy-turn-log-head">
                            <span>${label}</span>
                            <span style="font-size:11px;color:#666;">第 ${h.turn} 回合</span>
                        </div>
                        <div class="cw-strategy-turn-log-line">${desc}</div>
                    </div>`;
                }).join('');

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📜 军事历史</div>
                <div class="cw-strategy-content">${html}</div>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button" onclick="StrategyUIManager._currentTab='turn'; StrategyUIManager.open();">← 返回</button>
                </div>`;
            modal.className = 'active cw-strategy-modal';
        },
    });

    console.log('[CinemaWorld] strategy-military-ui.js 已加载');
})();