// ============================================================
// CinemaWorld · map-resource.js
// 资源点：通用"消耗 → 产出"交互
//   - 快速交互（不走 AI）
//   - 次数与刷新
//   - 概率产出
// 依赖：map-canvas.js, map-interact.js, map-pickup.js
// 暴露：window.MapResource
// ============================================================

(function () {
    'use strict';

    const MapResource = {
        // ============================================================
        // 快速交互（主入口）
        // ============================================================
        async quickInteract(entityId) {
            const map = window.MapLauncher?.getMap?.();
            const ent = map?.entities?.find(e => e.id === entityId);
            if (!ent || ent.kind !== 'resource_point') return;

            // ---------- 1. 刷新次数 ----------
            const now = this._readGameMinutes(map);
            this.refreshUses(ent, now);

            // ---------- 2. 检查次数 ----------
            const uses = ent.resource?.uses;
            if (uses && uses.max > 0 && uses.current <= 0) {
                window.UIManager?.showText?.(`${ent.name} 暂时枯竭了`, 1500);
                return;
            }

            // ---------- 3. 检查消耗 ----------
            const cost = ent.resource?.cost || {};
            const player = window.PlayerStateManager?.player;
            if (!this.canAfford(player, cost)) {
                const missing = this._getMissingCost(player, cost);
                window.UIManager?.showText?.(`缺少：${missing}`, 1500);
                return;
            }

            // ---------- 4. 确认框（可选，可去掉） ----------
            const ok = await this._confirm(ent, cost);
            if (!ok) return;

            // ---------- 5. 扣消耗 ----------
            this.payCost(player, cost);

            // ---------- 6. 掷产出 ----------
            const rewards = this.rollRewards(ent.resource?.rewards || []);

            // ---------- 7. 加入背包 ----------
            const added = [];
            for (const r of rewards) {
                const success = this._addToInventory(r.item, r.count);
                if (success) added.push(`${r.item} ×${r.count}`);
            }

            // ---------- 8. 扣次数 ----------
            if (uses && uses.max > 0) {
                uses.current -= 1;
            }

            // ---------- 9. 反馈 ----------
            if (added.length > 0) {
                window.UIManager?.showText?.(
                    `${ent.resource.actionEmoji || '✨'} 获得：${added.join('、')}`,
                    2000
                );
            } else {
                window.UIManager?.showText?.('什么都没得到……', 1500);
            }

            // ---------- 10. 记录 + 保存 ----------
            this._logHistory(ent, cost, added);
            window.MapLauncher?._saveMapToWorld?.(map);
            if (window.SaveManager) window.SaveManager.save();

            // ---------- 11. 重绘 ----------
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            window.CWNotify3D?.('entity-update', { entityId });
        },

        // ============================================================
        // 次数刷新（懒更新）
        // ============================================================
        refreshUses(ent, nowMinutes) {
            const uses = ent.resource?.uses;
            if (!uses || uses.max <= 0) return;
            if (!uses.refreshHours || uses.refreshHours <= 0) return;

            if (typeof uses.lastRefreshAt !== 'number') {
                uses.lastRefreshAt = nowMinutes;
                return;
            }

            const periodMinutes = uses.refreshHours * 60;
            const elapsed = nowMinutes - uses.lastRefreshAt;
            const periods = Math.floor(elapsed / periodMinutes);

            if (periods <= 0) return;

            const refreshCount = uses.refreshCountPerPeriod || 1;
            const before = uses.current;
            uses.current = Math.min(uses.max, uses.current + periods * refreshCount);
            uses.lastRefreshAt += periods * periodMinutes;

            if (uses.current > before) {
                console.log(`[Resource] ${ent.name} 恢复 ${uses.current - before} 次`);
            }
        },

        // ============================================================
        // 消耗检查
        // ============================================================
        canAfford(player, cost) {
            if (!player) return false;
            for (const [key, amount] of Object.entries(cost || {})) {
                if (!this._hasResource(player, key, amount)) return false;
            }
            return true;
        },

        _hasResource(player, key, amount) {
            // 1. 内置属性（体力、金钱等 statusBar）
            const bar = (player.statusBars || []).find(b => b.key === key);
            if (bar) return bar.current >= amount;

            // 2. attributes
            if (player.attributes?.[key] !== undefined) {
                const v = player.attributes[key];
                const num = typeof v === 'object' ? v.value : v;
                return (Number(num) || 0) >= amount;
            }

            // 3. 物品
            const item = (player.inventory || []).find(i => i.name === key);
            if (item) return (item.count || 1) >= amount;

            // 4. extraStats
            const extra = player.extraStats?.[key];
            if (extra !== undefined) {
                const num = parseFloat(String(extra));
                if (!isNaN(num)) return num >= amount;
            }

            return false;
        },

        _getMissingCost(player, cost) {
            const missing = [];
            for (const [key, amount] of Object.entries(cost || {})) {
                if (!this._hasResource(player, key, amount)) {
                    missing.push(`${key}×${amount}`);
                }
            }
            return missing.join('、');
        },

        // ============================================================
        // 扣消耗
        // ============================================================
        payCost(player, cost) {
            if (!player) return;
            for (const [key, amount] of Object.entries(cost || {})) {
                this._consumeResource(player, key, amount);
            }
            window.PlayerStateManager?.refreshAvatarArea?.();
        },

        _consumeResource(player, key, amount) {
            // 1. statusBar
            const bar = (player.statusBars || []).find(b => b.key === key);
            if (bar) {
                bar.current = Math.max(0, bar.current - amount);
                return;
            }

            // 2. attributes
            if (player.attributes?.[key] !== undefined) {
                const v = player.attributes[key];
                if (typeof v === 'object') {
                    v.value = Math.max(0, (Number(v.value) || 0) - amount);
                } else {
                    player.attributes[key] = Math.max(0, (Number(v) || 0) - amount);
                }
                return;
            }

            // 3. 物品
            const itemIdx = (player.inventory || []).findIndex(i => i.name === key);
            if (itemIdx >= 0) {
                const item = player.inventory[itemIdx];
                item.count = (item.count || 1) - amount;
                if (item.count <= 0) player.inventory.splice(itemIdx, 1);
                return;
            }

            // 4. extraStats
            if (player.extraStats?.[key] !== undefined) {
                const raw = String(player.extraStats[key]);
                const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                if (m) {
                    const cur = parseFloat(m[1]);
                    player.extraStats[key] = `${Math.max(0, cur - amount)}${m[2]}`;
                }
            }
        },

        // ============================================================
        // 掷产出
        // ============================================================
        rollRewards(rewards) {
            const out = [];
            for (const r of rewards || []) {
                const chance = typeof r.chance === 'number' ? r.chance : 1.0;
                if (Math.random() < chance) {
                    out.push({ item: r.item, count: r.count || 1 });
                }
            }
            return out;
        },

        // ============================================================
        // 加入背包
        // ============================================================
        _addToInventory(itemName, count) {
            const player = window.PlayerStateManager?.player;
            if (!player) return false;

            player.inventory = player.inventory || [];

            // 查物品表拿定义
            const map = window.MapLauncher?.getMap?.();
            const def = map?.itemTable?.[itemName];

            const existing = player.inventory.find(i => i.name === itemName);
            if (existing && (def?.fields?.['可堆叠'] === '是' || existing.stackable)) {
                existing.count = (existing.count || 1) + count;
                window.PlayerStateManager?.refreshAvatarArea?.();
                return true;
            }

            const slots = player.inventorySlots || 40;
            if (player.inventory.length >= slots) {
                console.warn('[Resource] 背包已满');
                return false;
            }

            player.inventory.push({
                name: itemName,
                count,
                icon: def?.emoji || '📦',
                description: def?.description || '',
                fields: { ...(def?.fields || {}) },
                interactions: [],
                status: '', effect: def?.fields?.['效果'] || '',
                stackable: def?.fields?.['可堆叠'] === '是',
                maxStack: parseInt(def?.fields?.['最大堆叠']) || null,
                type: def?.fields?.['类型'] || '物品',
            });

            window.PlayerStateManager?.refreshAvatarArea?.();
            return true;
        },

        // ============================================================
        // 确认框
        // ============================================================
        _confirm(ent, cost) {
            return new Promise((resolve) => {
                const r = ent.resource || {};
                const costStr = Object.entries(cost || {})
                    .map(([k, v]) => `${k} ×${v}`)
                    .join('、');
                const uses = r.uses;

                const usesText = (uses && uses.max > 0)
                    ? `<div style="text-align:center;font-size:12px;color:#ffd76b;margin-bottom:12px;">
                         剩余次数：${uses.current} / ${uses.max}
                         ${uses.refreshHours ? `（每 ${uses.refreshHours} 小时恢复）` : ''}
                       </div>`
                    : '';

                const html = `
                    <div class="cinemaworld-modal-title" style="font-size:22px;">
                        ${r.actionEmoji || '✨'} ${r.actionName || '互动'}
                    </div>
                    <div style="text-align:center;padding:14px;color:#aaa;font-size:14px;
                        background:rgba(0,0,0,.2);border-radius:10px;margin-bottom:12px;">
                        ${ent.description || ''}
                    </div>
                    ${usesText}
                    ${costStr ? `
                        <div style="text-align:center;font-size:13px;color:#ffb8b8;margin-bottom:14px;">
                            消耗：${costStr}
                        </div>
                    ` : ''}
                    <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                        <button class="cinemaworld-button primary" id="cw-resource-go">
                            ${r.actionEmoji || '✨'} ${r.actionName || '确认'}
                        </button>
                        <button class="cinemaworld-button" id="cw-resource-cancel">
                            取消
                        </button>
                    </div>
                `;

                window.MapLauncher?._openSubPanel?.(html);

                document.getElementById('cw-resource-go').onclick = () => {
                    window.MapLauncher?._closeSubPanel?.();
                    resolve(true);
                };
                document.getElementById('cw-resource-cancel').onclick = () => {
                    window.MapLauncher?._closeSubPanel?.();
                    resolve(false);
                };
            });
        },

        // ============================================================
        // 读取当前游戏时间
        // ============================================================
        _readGameMinutes(map) {
            try {
                if (window.CWEnv?.parseTotalMinutes && window.CWEnv?.ensureEnvData) {
                    const env = window.CWEnv.ensureEnvData(map);
                    const t = window.CWEnv.parseTotalMinutes(env);
                    if (typeof t === 'number') return t;
                }
            } catch (e) { /* 忽略 */ }
            return 0;
        },

        _logHistory(ent, cost, added) {
            if (!window.InteractionHistoryManager) return;
            window.InteractionHistoryManager.add({
                type: 'resource',
                target: ent.name,
                targetMeta: { entityId: ent.id },
                scene: ent.region || '',
                playerInput: ent.resource?.actionName || '互动',
                script: `（${ent.resource?.actionName || '互动'}）${ent.description || ''}`,
                effect: added.join('、'),
                summary: `在 ${ent.name} ${ent.resource?.actionName || '互动'}，获得 ${added.join('、')}`,
            });
        },
    };

    window.MapResource = MapResource;
    console.log('[CinemaWorld] map-resource.js 已加载');
})();