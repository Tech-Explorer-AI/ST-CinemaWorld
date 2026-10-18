// ============================================================
// CinemaWorld · combat-gen.js
// 按需生成装备的即时战斗数据
//   - 单件生成
//   - 批量生成
//   - 直接写入 item.combat
//
// 依赖：CombatWeapon, generateFunctionalReply
// 暴露：window.CombatGen
// ============================================================

(function () {
    'use strict';

    const CombatGen = {
        _running: false,

        // ============================================================
        // 单件生成
        // ============================================================
        async generateOne(index, source = 'inventory') {
            if (this._running) {
                window.UIManager?.showText?.('正在生成中，请稍候...', 1500);
                return;
            }

            const player = window.PlayerStateManager?.player;
            if (!player) return;

            let item;
            if (source === 'inventory') {
                item = player.inventory?.[index];
            } else if (source === 'equipment') {
                item = window.EquipmentManager?.ensureStructure?.()?.slots?.[index];
            }

            if (!item) return;

            if (!this._isWeapon(item)) {
                window.UIManager?.showText?.('这不是武器', 1500);
                return;
            }

            this._running = true;

            try {
                await window.UIManager?.showText?.(
                    `⚔️ 正在生成【${item.name}】的战斗数据...`,
                    1200
                );

                const combatText = await this._callAI(item);
                if (!combatText) {
                    window.UIManager?.showText?.('生成失败', 1500);
                    return;
                }

                const parsed = window.CombatWeapon.parseCombatFields(combatText);
                if (!parsed) {
                    window.UIManager?.showText?.('解析失败', 1500);
                    return;
                }

                item.combat = parsed;

                window.UIManager?.showText?.(
                    `✅ ${item.name}\n${combatText}`,
                    2500
                );

                this._refreshUI(source);

                if (window.SaveManager) window.SaveManager.save();

                console.log('[CombatGen] 已生成:', item.name, parsed);
            } finally {
                this._running = false;
            }
        },

        // ============================================================
        // 批量生成（装备栏 + 背包）
        // ============================================================
        async generateAll() {
            if (this._running) {
                window.UIManager?.showText?.('正在生成中，请稍候...', 1500);
                return;
            }

            const player = window.PlayerStateManager?.player;
            if (!player) return;

            // 收集所有"是武器但没 combat"的装备
            const targets = [];

            // 装备栏
            const eq = window.EquipmentManager?.ensureStructure?.();
            if (eq?.slots) {
                for (let i = 0; i < eq.slots.length; i++) {
                    const item = eq.slots[i];
                    if (!item) continue;
                    if (!this._isWeapon(item)) continue;
                    if (item.combat) continue;
                    targets.push({ item, source: 'equipment', index: i });
                }
            }

            // 背包
            if (player.inventory) {
                for (let i = 0; i < player.inventory.length; i++) {
                    const item = player.inventory[i];
                    if (!item) continue;
                    if (!this._isWeapon(item)) continue;
                    if (item.combat) continue;
                    targets.push({ item, source: 'inventory', index: i });
                }
            }

            if (targets.length === 0) {
                window.UIManager?.showText?.('没有需要生成的武器', 1500);
                return;
            }

            const ok = confirm(
                `找到 ${targets.length} 件武器需要生成战斗数据。\n\n` +
                targets.map(t => `· ${t.item.icon || '⚔️'} ${t.item.name}`).join('\n') +
                `\n\n开始生成？`
            );
            if (!ok) return;

            this._running = true;

            try {
                let done = 0;
                let failed = 0;

                for (const t of targets) {
                    try {
                        await window.UIManager?.showText?.(
                            `⚔️ 生成中 (${done + 1}/${targets.length})：${t.item.name}`,
                            600
                        );

                        const combatText = await this._callAI(t.item);
                        if (!combatText) {
                            failed++;
                            continue;
                        }

                        const parsed = window.CombatWeapon.parseCombatFields(combatText);
                        if (!parsed) {
                            failed++;
                            continue;
                        }

                        t.item.combat = parsed;
                        done++;

                        console.log(`[CombatGen] ✅ ${t.item.name} →`, parsed);

                        if (window.SaveManager) window.SaveManager.save();

                        await new Promise(r => setTimeout(r, 300));

                    } catch (e) {
                        console.error('[CombatGen] 单件失败:', t.item.name, e);
                        failed++;
                    }
                }

                window.UIManager?.showText?.(
                    `✅ 完成：成功 ${done}，失败 ${failed}`,
                    2500
                );

                this._refreshUI('all');

            } finally {
                this._running = false;
            }
        },

        // ============================================================
        // 调用 AI
        // ============================================================
        async _callAI(item) {
            const prompt = this._buildPrompt(item);
            const result = await window.generateFunctionalReply(prompt, 'combat-gen');
            if (!result) return null;

            const m = result.match(/[\[【]([^\[\]【】]+)[\]】]/);
            if (!m) {
                console.warn('[CombatGen] 没找到方括号:', result);
                return null;
            }
            return m[1].trim();
        },

        _buildPrompt(item) {
            const fields = item.fields || {};
            const fieldLines = Object.entries(fields)
                .filter(([k]) => !['图标', 'icon'].includes(k))
                .map(([k, v]) => `- ${k}：${v}`)
                .join('\n');

            return `你正在给一件武器生成即时战斗数据。

武器：
- 名称：${item.name}
- 描述：${item.description || '（无）'}
- 类型：${fields['类型'] || item.type || '武器'}
${fieldLines ? '\n其他属性：\n' + fieldLines : ''}

请生成这件武器的即时战斗参数。

【输出格式】（严格遵守，不要解释，不要多余文字）
[攻击方式:X|攻击距离:Y|攻击间隔:Z|占用双手:W|可双持:V]

【字段规则】
- 攻击方式：近战 或 远程
- 攻击距离：
  - 近战固定写 1
  - 远程写区间（如 3-10）或单值（如 5）
- 攻击间隔：毫秒，近战建议 600-1000，远程建议 1000-1500
- 占用双手：是 / 否（大剑、长矛、弓、法杖一般写"是"；短剑、单手剑写"否"）
- 可双持：是 / 否（只有短匕、手枪类单手小武器写"是"，其他写"否"）

【参考】
- 匕首/短剑 → [攻击方式:近战|攻击距离:1|攻击间隔:400|占用双手:否|可双持:是]
- 长剑/铁剑 → [攻击方式:近战|攻击距离:1|攻击间隔:800|占用双手:否|可双持:否]
- 大剑/双手斧 → [攻击方式:近战|攻击距离:1|攻击间隔:1200|占用双手:是|可双持:否]
- 弓/长枪 → [攻击方式:远程|攻击距离:3-10|攻击间隔:1200|占用双手:是|可双持:否]
- 手枪 → [攻击方式:远程|攻击距离:1-8|攻击间隔:600|占用双手:否|可双持:是]

请直接输出一行，从 [ 开始到 ] 结束：
`;
        },

        // ============================================================
        // 刷新界面
        // ============================================================
        _refreshUI(source) {
            if (source === 'equipment' || source === 'all') {
                if (window.InventoryManager?.openEquipment) {
                    window.InventoryManager.openEquipment();
                }
            }
            if (source === 'inventory' || source === 'all') {
                if (window.InventoryManager?.open) {
                    window.InventoryManager.open();
                }
            }
            window.PlayerStateManager?.refreshAvatarArea?.();
        },

        // ============================================================
        // 工具
        // ============================================================
        _isWeapon(item) {
            const typeField = String(item?.fields?.['类型'] || item?.type || '').trim();
            return /武器|weapon/i.test(typeField);
        },

        // 是否需要生成（给 UI 用）
        needsCombatData(item) {
            if (!item) return false;
            if (!this._isWeapon(item)) return false;
            return !item.combat;
        },

        // 是否已经有 combat（给 UI 用）
        hasCombatData(item) {
            if (!item) return false;
            return this._isWeapon(item) && !!item.combat;
        },

        // 渲染战斗数据的小组件（给 UI 复用）
        renderCombatInfo(item) {
            if (!this.hasCombatData(item)) return '';
            const d = item.combat;
            return `
                <div style="margin-bottom:10px;padding:10px 12px;
                    background:rgba(216,125,125,.08);
                    border:1px solid rgba(216,125,125,.3);
                    border-radius:8px;">
                    <div style="font-size:11px;color:#ff9999;font-weight:600;
                        margin-bottom:6px;letter-spacing:.5px;">⚔️ 即时战斗</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;
                        gap:4px 12px;font-size:11px;color:#ccc;">
                        <div>方式：<b style="color:#fff;">${d.type}</b></div>
                        <div>距离：<b style="color:#fff;">${d.range.min}~${d.range.max}</b></div>
                        <div>间隔：<b style="color:#fff;">${d.interval}ms</b></div>
                        <div>双手：<b style="color:${d.twoHanded ? '#ff9090' : '#8f8'};">${d.twoHanded ? '是' : '否'}</b></div>
                        <div>双持：<b style="color:${d.dualWield ? '#8f8' : '#888'};">${d.dualWield ? '是' : '否'}</b></div>
                    </div>
                </div>`;
        },

        // 渲染"需要生成"提示（给 UI 复用）
        renderMissingHint() {
            return `
                <div style="margin-bottom:10px;padding:10px 12px;
                    background:rgba(216,125,125,.08);
                    border:1px solid rgba(216,125,125,.3);
                    border-radius:8px;">
                    <div style="font-size:11px;color:#ff9999;
                        margin-bottom:6px;line-height:1.5;">
                        ⚠️ 这件武器还没有即时战斗数据
                    </div>
                </div>`;
        },
    };

    window.CombatGen = CombatGen;
    console.log('[CinemaWorld] combat-gen.js 已加载');
})();