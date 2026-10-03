// ============================================================
// CinemaWorld · map-pickup.js
// 拾取：地图实体 / 场景实体 → 背包
// 依赖：map-canvas.js, map-entities.js, interact.js
// 暴露：window.MapPickup
// ============================================================

(function () {
    'use strict';

    const MapPickup = {
        // ============================================================
        // 判定
        // ============================================================
        canPickup(ent) {
            if (!ent?.fields) return false;
            return String(ent.fields['可拾取'] || '').trim() === '是';
        },

        // ============================================================
        // 主入口：地图实体拾取
        // ============================================================
        async pickup(entityId) {
            const map = window.MapLauncher?.getMap?.();
            const ent = map?.entities?.find(e => e.id === entityId);
            if (!ent) return;

            if (!this.canPickup(ent)) {
                window.UIManager.showText('这个东西不能拾取', 1500);
                return;
            }

            const count = ent.count || 1;
            const name = ent.name;

            const ok = await this._confirm(ent, count);
            if (!ok) return;

            const added = this._addToInventory(ent, count);
            if (!added) {
                window.UIManager.showText('背包已满或添加失败', 2000);
                window.MapLauncher._closeSubPanel();
                return;
            }

            const idx = map.entities.findIndex(e => e.id === entityId);
            if (idx > -1) map.entities.splice(idx, 1);

            // ★ 通知 3D
            window.CWNotify3D?.('entity-remove', { entityId });

            if (window.MapCanvas?.canvas) {
                window.MapCanvas._render();
            }

            window.UIManager.showText(
                `🖐️ 拾取了 ${ent.emoji} ${name}${count > 1 ? ' ×' + count : ''}`,
                2000
            );
            // ★ 新增：通知任务系统
            if (window.MapQuestManager) {
                try {
                    window.MapQuestManager.onItemPicked(name, count);
                } catch (e) {
                    console.error('[MapPickup] 任务进度更新失败:', e);
                }
            }
            if (window.InteractionHistoryManager) {
                window.InteractionHistoryManager.add({
                    type: 'mapPickup',
                    target: name,
                    targetMeta: { icon: ent.emoji, count },
                    scene: map.regions.find(r => r.id === ent.region)?.name || '(地图)',
                    playerInput: `拾取 ${name}`,
                    script: `（拾取）你捡起了 ${ent.emoji} ${name}。`,
                    effect: null,
                    summary: `拾取了 ${name}${count > 1 ? ' ×' + count : ''}`,
                });
            }

            if (window.MapPortraitLayer?._currentEntityId === entityId) {
                window.MapPortraitLayer.hide();
            }

            if (window.MapCanvas?.canvas) {
                window.MapCanvas._render();
            }

            map._rawText = null;
            if (window.SaveManager) window.SaveManager.save();

            // ★ 回到地图
            window.MapLauncher._closeSubPanel();
        },

        // ============================================================
        // 加入背包
        // ============================================================
        _addToInventory(ent, count) {
            const player = window.PlayerStateManager?.player;
            if (!player) return false;

            player.inventory = player.inventory || [];

            const slots = player.inventorySlots || 40;
            const stackable = ent.stackable === true;
            const maxStack = ent.maxStack || null;

            const item = {
                name: ent.name,
                count: count,
                icon: ent.emoji || '📦',
                description: ent.description || '',
                status: ent.status || '',
                effect: ent.effect || '',
                stackable,
                maxStack,
                type: ent.type || 'item',
                fields: this._cleanFields(ent.fields || {}),
                interactions: ent.interactions || [],
            };

            // 已有同名物品 → 叠加
            const existing = player.inventory.find(i => i.name === item.name);
            if (existing && stackable) {
                existing.count = (existing.count || 1) + count;
                if (window.PlayerStateManager.refreshAvatarArea) {
                    window.PlayerStateManager.refreshAvatarArea();
                }
                return true;
            }

            // 背包满了
            if (player.inventory.length >= slots) {
                return false;
            }

            player.inventory.push(item);

            if (window.PlayerStateManager.refreshAvatarArea) {
                window.PlayerStateManager.refreshAvatarArea();
            }
            return true;
        },

        // 清掉内部字段（不展示在背包里）
        _cleanFields(fields) {
            const out = {};
            const HIDE = ['可拾取', '可堆叠', '最大堆叠', '数量'];
            for (const [k, v] of Object.entries(fields)) {
                if (k.startsWith('_pos')) continue;
                if (HIDE.includes(k)) continue;
                out[k] = v;
            }
            return out;
        },

        // ============================================================
        // 确认框
        // ============================================================
        _confirm(ent, count) {
            return new Promise((resolve) => {
                const player = window.PlayerStateManager?.player;
                const slots = player?.inventorySlots || 40;
                const used = (player?.inventory || []).length;
                const existing = player?.inventory?.find(i => i.name === ent.name);
                const canStack = existing && ent.stackable === true;
                const full = !canStack && used >= slots;

                const html = `
                    <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">🖐️ 拾取物品</div>
                    <div style="display:flex;gap:14px;padding:14px;background:rgba(0,0,0,.2);
                        border-radius:10px;margin-bottom:12px;align-items:center;">
                        <div style="font-size:48px;flex-shrink:0;line-height:1;">${ent.emoji}</div>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:16px;font-weight:bold;color:#e8d8a8;">
                                ${ent.name}${count > 1 ? ` ×${count}` : ''}
                            </div>
                            <div style="font-size:12px;color:#888;margin-top:4px;">
                                ${ent.description || '无描述'}
                            </div>
                        </div>
                    </div>
                    ${full ? `
                        <div style="padding:10px 14px;background:rgba(216,125,125,.12);
                            border:1px solid rgba(216,125,125,.35);border-radius:10px;
                            font-size:13px;color:#ffb8b8;margin-bottom:12px;">
                            ⚠️ 背包已满（${used}/${slots}），无法拾取
                        </div>
                    ` : `
                        <div style="font-size:12px;color:#888;margin-bottom:12px;">
                            背包 ${used}/${slots}${canStack ? '（将叠加）' : ''}
                        </div>
                    `}
                    <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                        <button class="cinemaworld-button primary" id="cw-pickup-confirm"
                            ${full ? 'disabled style="opacity:.4;cursor:not-allowed;"' : ''}>
                            ✅ 拾取
                        </button>
                        <button class="cinemaworld-button" id="cw-pickup-cancel">取消</button>
                    </div>`;

                window.MapLauncher._openSubPanel(html);

                document.getElementById('cw-pickup-confirm').onclick = () => {
                    resolve(true);
                };
                document.getElementById('cw-pickup-cancel').onclick = () => {
                    window.MapLauncher._closeSubPanel();
                    resolve(false);
                };
            });
        },

        // ============================================================
        // 场景实体拾取（和地图实体共用同一套背包逻辑）
        // ============================================================
        async pickupFromScene(sceneItemIndex) {
            const scene = window.LocationModalManager?.currentLocation;
            const item = scene?.sceneItems?.[sceneItemIndex];
            if (!item) return;

            if (String(item.fields?.['可拾取'] || '') !== '是') {
                window.UIManager.showText('这个物品不能拾取', 1500);
                return;
            }

            const ent = {
                name: item.name,
                emoji: item.icon || '📦',
                description: item.description,
                status: item.status,
                effect: item.effect,
                type: item.type || 'item',
                fields: item.fields || {},
                interactions: item.interactions || [],
                stackable: item.stackable,
                maxStack: item.maxStack,
            };

            const ok = await this._confirm(ent, item.count || 1);
            if (!ok) return;

            const added = this._addToInventory(ent, item.count || 1);
            if (!added) return;

            // 从场景移除
            scene.sceneItems.splice(sceneItemIndex, 1);
            if (window.SceneEditorManager) {
                window.SceneEditorManager._rebuildRaw(scene);
            }

            window.UIManager.showText(`🖐️ 拾取了 ${item.name}`, 2000);

            if (window.InteractionHistoryManager) {
                window.InteractionHistoryManager.add({
                    type: 'scenePickup',
                    target: item.name,
                    targetMeta: { icon: item.icon, count: item.count || 1 },
                    scene: scene.name,
                    playerInput: `拾取 ${item.name}`,
                    script: `（拾取）你捡起了 ${item.icon || '📦'} ${item.name}。`,
                    effect: null,
                    summary: `拾取了 ${item.name}`,
                });
            }

            if (window.SceneItemBrowserManager?.openBrowser) {
                window.SceneItemBrowserManager.openBrowser(true);
            }
            if (window.SaveManager) window.SaveManager.save();
        },
    };

    window.MapPickup = MapPickup;
    console.log('[CinemaWorld] map-pickup.js 已加载');
})();