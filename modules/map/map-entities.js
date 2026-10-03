// ============================================================
// CinemaWorld · map-entities.js
// 地图实体面板 / 详情 / 编辑器
// 依赖：map-canvas.js, map-schema.js, interact.js（复用样式）
// 暴露：window.MapEntityPanel
// ============================================================

(function () {
    'use strict';
    // ★ 放大模态框工具
    function _bigModal(modal, opts = {}) {
        modal.className = 'active cw-map-entity-modal';
        modal.style.width = opts.width || 'min(1080px, 96vw)';
        modal.style.maxWidth = 'none';
        modal.style.maxHeight = '94vh';
        modal.style.padding = opts.padding || '24px 28px';
        modal.style.overflowY = 'auto';
        modal.style.boxSizing = 'border-box';
    }
    const MapEntityPanel = {
        _selectedId: null,

        // ============================================================
        // 1. 实体列表面板（按区域分组）
        // ============================================================
        openList() {
            const map = window.MapLauncher?.getMap?.();
            if (!map) {
                window.UIManager.showText('还没有地图', 1500);
                return;
            }

            const player = map.entities.find(e => e.isPlayer);
            const currentRegionId = player?.region;

            let html = `
                <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">📋 地图实体</div>
                <div style="font-size:13px;color:#888;text-align:center;margin-bottom:16px;">
                    共 ${map.regions.length} 个区域 · ${map.entities.filter(e => !e.isPlayer).length} 个实体
                </div>
                <div style="display:grid;gap:12px;max-height:60vh;overflow-y:auto;padding-right:4px;">`;

            for (const region of map.regions) {
                const ents = map.entities.filter(e => e.region === region.id && !e.isPlayer);
                const isCurrent = region.id === currentRegionId;

                html += `
                    <div style="background:${isCurrent ? 'rgba(120,150,255,.1)' : 'rgba(255,255,255,.03)'};
                        border:1px solid ${isCurrent ? 'rgba(120,150,255,.35)' : 'rgba(255,255,255,.06)'};
                        border-radius:12px;padding:14px 16px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                            <div style="font-size:15px;color:#7da8ff;font-weight:600;">
                                📍 ${region.name}
                                ${isCurrent ? '<span style="font-size:11px;color:#7dd87d;margin-left:8px;">[当前]</span>' : ''}
                            </div>
                            <div style="font-size:12px;color:#666;">${ents.length} 个</div>
                        </div>`;

                if (ents.length === 0) {
                    html += `<div style="font-size:13px;color:#555;padding:6px 0;">（无实体）</div>`;
                } else {
                    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">`;
                    for (const e of ents) {
                        const canPickup = String(e.fields?.['可拾取'] || '') === '是';
                        const pickupBadge = canPickup
                            ? `<span style="font-size:9px;color:#7dd87d;margin-left:4px;">可拾取</span>`
                            : '';

                        html += `
                            <div onclick="MapEntityPanel.openDetail('${e.id}')"
                                style="display:flex;align-items:center;gap:8px;padding:8px 10px;
                                    background:rgba(255,255,255,.04);border-radius:8px;cursor:pointer;
                                    transition:all .15s;"
                                onmouseover="this.style.background='rgba(120,150,255,.15)'"
                                onmouseout="this.style.background='rgba(255,255,255,.04)'">
                                <div style="font-size:22px;line-height:1;">${e.emoji}</div>
                                <div style="flex:1;min-width:0;">
                                    <div style="font-size:12px;color:#ddd;overflow:hidden;
                                        text-overflow:ellipsis;white-space:nowrap;">${e.name}</div>
                                    <div style="font-size:10px;color:#666;">
                                        ${this._kindLabel(e.kind)}${pickupBadge}
                                    </div>
                                </div>
                            </div>`;
                    }
                    html += `</div>`;
                }
                html += `</div>`;
            }

            html += `</div>
                <div style="text-align:center;margin-top:18px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" onclick="MapEntityPanel.openCreator()">➕ 新建实体</button>
                    <button class="cinemaworld-button" onclick="MapLauncher._closeSubPanel()">关闭</button>
                </div>`;

            window.MapLauncher._openSubPanel(html);
        },

        // ============================================================
        // 2. 实体详情面板
        // ============================================================
        openDetail(id) {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;
            const ent = map.entities.find(e => e.id === id);
            if (!ent) {
                window.MapLauncher?._closeSubPanel?.();
                return;
            }

            this._selectedId = id;

            const region = map.regions.find(r => r.id === ent.region);
            const isEncounter = this._isEncounter(ent);
            const badgeHTML = this._kindBadge(ent);

            const descHTML = ent.description ? `
                <div style="margin-bottom:12px;">
                    <div style="font-size:12px;color:#888;margin-bottom:6px;">📝 描述</div>
                    <div style="font-size:13px;color:#ccc;line-height:1.6;">${ent.description}</div>
                </div>` : '';

            const fieldsHTML = this._renderFields(ent);
            const extraHTML = this._renderExtraStats(ent);

            const tagsHTML = ent.tags?.length ? `
                <div style="margin-bottom:12px;">
                    <div style="font-size:12px;color:#888;margin-bottom:6px;">🏷️ 标签</div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;">
                        ${ent.tags.map(t => `<span style="padding:3px 10px;background:rgba(120,150,255,.15);
                            border:1px solid rgba(120,150,255,.3);border-radius:10px;
                            font-size:11px;color:#9ab0ff;">${t}</span>`).join('')}
                    </div>
                </div>` : '';

            const canPickup = this._canPickup(ent);

            // ★ 主线点判定
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            const isMainTarget = mq?.active && mq.status === 'active'
                && mq.target.kind === 'entity'
                && mq.target.entityId === id;

            // ★ 任务点判定
            const questId = ent.meta?.questId;
            const isQuestTarget = !!questId && window.MapQuestManager;

            // ★ 任务接取判定
            const offerQuestId = ent.meta?.questOffer;
            const offerQuest = offerQuestId && window.MapQuestManager
                ? window.MapQuestManager.getQuest(offerQuestId)
                : null;
            const canOfferQuest = offerQuest && offerQuest.status === 'offered';

            // ★★★ 新增：任务点（quest_point）判定 ★★★
            const isQuestPoint = ent.kind === 'quest_point' && ent.meta?.questId;
            const q = isQuestPoint
                ? window.MapQuestManager?.getQuest?.(ent.meta.questId)
                : null;

            // ============================================================
            // 主按钮 + 次级按钮
            // 优先级：任务点 > 拾取 > 接取任务 > 主线 > 遭遇 > 查看任务 > NPC对话 > 交互
            // ============================================================
            let primaryBtn = '';
            const secondaryBtns = [];

            // ---------- 任务点 ----------
            if (isQuestPoint) {
                if (!q) {
                    primaryBtn = `<button class="cinemaworld-button" disabled
                        style="opacity:.5;cursor:not-allowed;">
                        ⚠️ 任务数据丢失
                    </button>`;
                }
                else if (q.status === 'offered') {
                    primaryBtn = `<button class="cinemaworld-button primary"
                        style="background:linear-gradient(135deg,#ffd76b,#ffb84d);color:#2a1f0a;font-weight:600;"
                        onclick="MapEntityPanel._acceptQuestFromPoint('${q.id}')">
                        📜 接取任务
                    </button>`;
                }
                else if (q.status === 'active') {
                    primaryBtn = `<button class="cinemaworld-button primary"
                        style="background:linear-gradient(135deg,#7da8ff,#5b8bd9);"
                        onclick="MapQuestManager.openQuestDetail('${q.id}')">
                        📜 查看任务
                    </button>`;
                    secondaryBtns.push(`<button class="cinemaworld-button"
                        onclick="MapQuestManager._returnToMarker('${q.id}')">
                        📍 定位目标
                    </button>`);
                }
                else if (q.status === 'completed') {
                    primaryBtn = `<button class="cinemaworld-button" disabled
                        style="opacity:.5;cursor:not-allowed;">
                        ✅ 已完成
                    </button>`;
                }
            }
            // ---------- 拾取 ----------
            else if (canPickup) {
                primaryBtn = `<button class="cinemaworld-button primary"
                    onclick="MapPickup.pickup('${ent.id}')">🖐️ 拾取</button>`;

                if (isQuestTarget) {
                    secondaryBtns.push(`<button class="cinemaworld-button"
                        onclick="MapQuestManager.openQuestDetail('${questId}')">
                        📜 查看任务
                    </button>`);
                }
            }
            // ---------- 接取任务（NPC offer） ----------
            else if (canOfferQuest) {
                primaryBtn = `<button class="cinemaworld-button primary"
                    style="background:linear-gradient(135deg,#ffd76b,#ffb84d);color:#2a1f0a;font-weight:600;"
                    onclick="MapQuestManager.openQuestOffer('${offerQuestId}')">
                    📜 接取任务
                </button>`;

                if (ent.kind === 'npc') {
                    secondaryBtns.push(`<button class="cinemaworld-button"
                        onclick="MapInteract.talkTo('${ent.id}')">
                        💬 对话
                    </button>`);
                }
            }
            // ---------- 主线 ----------
            else if (isMainTarget) {
                primaryBtn = `<button class="cinemaworld-button primary"
                    style="background:linear-gradient(135deg,#ffb84d,#ff8a3d);"
                    onclick="MapInteract.triggerMainQuestEntity('${ent.id}')">
                    ⭐ 推进主线
                </button>`;

                if (isQuestTarget) {
                    secondaryBtns.push(`<button class="cinemaworld-button"
                        onclick="MapQuestManager.openQuestDetail('${questId}')">
                        📜 查看任务
                    </button>`);
                }
            }
            // ---------- 遭遇 ----------
            else if (isEncounter) {
                primaryBtn = `<button class="cinemaworld-button primary" style="background:#d87d7d;"
                    onclick="MapInteract.startBattle('${ent.id}')">
                    ⚔️ 遭遇
                </button>`;

                if (isQuestTarget) {
                    secondaryBtns.push(`<button class="cinemaworld-button"
                        onclick="MapQuestManager.openQuestDetail('${questId}')">
                        📜 查看任务
                    </button>`);
                }
            }
            // ---------- 查看任务 ----------
            else if (isQuestTarget) {
                primaryBtn = `<button class="cinemaworld-button primary"
                    style="background:linear-gradient(135deg,#7da8ff,#5b8bd9);"
                    onclick="MapQuestManager.openQuestDetail('${questId}')">
                    📜 查看任务
                </button>`;
            }
            // ---------- NPC 对话 ----------
            else if (ent.kind === 'npc') {
                primaryBtn = `<button class="cinemaworld-button primary"
                    onclick="MapInteract.talkTo('${ent.id}')">
                    💬 对话
                </button>`;
            }
            // ---------- 兜底：交互 ----------
            else {
                primaryBtn = `<button class="cinemaworld-button primary"
                    onclick="MapInteract.interactWith('${ent.id}')">
                    ✨ 交互
                </button>`;
            }

            const secondaryHTML = secondaryBtns.join('');

            // ★ 拾取/任务目标时，额外给"交互"按钮（任务点不给）
            const extraInteractBtn = (!isQuestPoint && (canPickup || isQuestTarget))
                ? `<button class="cinemaworld-button"
                    onclick="MapInteract.interactWith('${ent.id}')">
                    ✨ 交互
                </button>`
                : '';

            // ============================================================
            // 组装 HTML
            // ============================================================
            let html = `
                <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">
                    ${ent.emoji} ${ent.name}
                </div>
                <div style="display:flex;gap:14px;padding:14px;background:rgba(0,0,0,.2);
                    border-radius:10px;margin-bottom:12px;align-items:center;">
                    <div style="font-size:48px;flex-shrink:0;line-height:1;">${ent.emoji}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:16px;font-weight:bold;color:#e8d8a8;margin-bottom:4px;">
                            ${ent.name}
                        </div>
                        <div style="font-size:12px;color:#888;">
                            ${badgeHTML}
                            ${region ? ` · 📍 ${region.name}` : ''}
                            ${ent.position ? ` · ${ent.position}` : ''}
                        </div>
                    </div>
                </div>
                ${descHTML}
                ${isQuestPoint ? this._renderQuestPointInfo(q) : ''}
                ${fieldsHTML}
                ${extraHTML}
                ${tagsHTML}
                <div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    ${primaryBtn}
                    ${secondaryHTML}
                    ${extraInteractBtn}
                    ${!isQuestPoint && !ent.isPlayer && (ent.kind === 'npc' || ent.kind === 'encounter') ? `
                        <button class="cinemaworld-button"
                            onclick="MapEntityPanel.rerollSprite('${ent.id}')">🎲 换外观</button>
                    ` : ''}
                    ${!isQuestPoint ? `
                        <button class="cinemaworld-button"
                            onclick="MapEntityPanel.openEditor('${ent.id}')">✏️ 编辑</button>
                        <button class="cinemaworld-button" style="color:#d87d7d;"
                            onclick="MapEntityPanel.confirmDelete('${ent.id}')">🗑️ 删除</button>
                    ` : ''}
                    <button class="cinemaworld-button"
                        onclick="MapLauncher._closeSubPanel()">关闭</button>
                </div>
            `;

            window.MapLauncher._openSubPanel(html);
        },
        _renderQuestPointInfo(q) {
            if (!q) return '';

            const need = q.target.count || 1;
            const pct = Math.min(100, (q.current / need) * 100);
            const rewardsText = window.MapQuestManager?._formatRewards?.(q.rewards) || '无';

            const statusText = {
                offered: '可接取',
                active: '进行中',
                completed: '已完成',
            }[q.status] || q.status;

            const statusColor = {
                offered: '#ffd76b',
                active: '#7da8ff',
                completed: '#7dd87d',
            }[q.status] || '#888';

            return `
                <div style="margin-bottom:12px;padding:12px;background:rgba(255,215,100,.08);
                    border:1px solid rgba(255,215,100,.25);border-radius:10px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                        <span style="font-size:12px;color:#888;">状态</span>
                        <span style="font-size:12px;color:${statusColor};font-weight:600;">${statusText}</span>
                    </div>
                    ${q.progressType !== 'explore' && q.status !== 'offered' ? `
                        <div style="margin-bottom:8px;">
                            <div style="display:flex;justify-content:space-between;font-size:11px;
                                color:#888;margin-bottom:4px;">
                                <span>进度</span>
                                <span>${q.current}/${need}</span>
                            </div>
                            <div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;">
                                <div style="width:${pct}%;height:100%;background:#7da8ff;"></div>
                            </div>
                        </div>
                    ` : ''}
                    <div style="display:flex;justify-content:space-between;">
                        <span style="font-size:12px;color:#888;">奖励</span>
                        <span style="font-size:12px;color:#ffd76b;">${rewardsText}</span>
                    </div>
                </div>
            `;
        },
        async _acceptQuestFromPoint(questId) {
            const q = window.MapQuestManager?.getQuest?.(questId);
            if (!q) {
                window.UIManager?.showText?.('任务不存在', 1500);
                return;
            }

            if (q.status !== 'offered') {
                window.UIManager?.showText?.('任务无法接取', 1500);
                return;
            }

            // 关闭详情面板
            window.MapLauncher?._closeSubPanel?.();

            // 走 MapQuestManager.acceptQuest
            // acceptQuest 里会：播接取剧情 → status=active → 落任务实体
            await window.MapQuestManager.acceptQuest(questId);

            // 接取后，任务点会被移到"进行中"状态
            // 如果玩家还想看，重新打开详情（可选）
            // 这里先不重开，等 VN 播完再说
        },
        // 单个实体换外观
        rerollSprite(id) {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;
            const ent = map.entities.find(e => e.id === id);
            if (!ent) return;

            ent.meta = ent.meta || {};
            ent.meta._spriteSeed = Math.floor(Math.random() * 1e9);

            // 如果之前手动指定过 spriteIndex，清掉，让 hash 重新决定
            delete ent.meta.spriteIndex;
            delete ent.meta.spriteImage;

            // 重绘
            if (window.MapCanvas?.canvas) {
                window.MapCanvas._render();
            }

            // 刷新详情面板（让用户看到新外观，虽然面板里没画精灵，但至少不报错）
            this.openDetail(id);
            window.UIManager.showText('🎲 已换外观', 1000);
        },
        _canPickup(ent) {
            if (!ent?.fields) return false;
            return String(ent.fields['可拾取'] || '').trim() === '是';
        },
        // ---------- 异步加载 NPC 头像 ----------
        async _asyncLoadAvatar(ent) {
            if (ent.kind !== 'npc') return;
            if (!window.SpriteManager) return;

            const state = window.SpriteManager.pickSpriteState?.({ name: ent.name, mood: ent.meta?.mood });
            const url = window.SpriteManager.getCachedSpriteWithState?.(ent.name, state)
                || window.SpriteManager.getCachedSprite?.(ent.name);
            if (url) {
                this._applyAvatar(url);
                return;
            }

            try {
                const loaded = await window.SpriteManager.ensureSpriteWithState?.(
                    ent.name, ent.meta?.gender || '未知', state || '默认'
                );
                if (loaded) this._applyAvatar(loaded);
            } catch (e) { /* 静默 */ }
        },

        _applyAvatar(url) {
            const el = document.querySelector('[data-map-entity-avatar]');
            if (!el) return;
            el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="">`;
            el.style.background = 'transparent';
        },

        // ============================================================
        // 3. 渲染辅助
        // ============================================================
        _kindLabel(kind) {
            return {
                npc: 'NPC',
                item: '物品',
                building: '建筑',
                marker: '标记',
                quest_point: '任务点',      // ★
                player: '玩家',
            }[kind] || kind;
        },

        _kindBadge(ent) {
            // ★ 可拾取优先显示
            const isPickup = String(ent.fields?.['可拾取'] || '') === '是';
            if (isPickup) {
                return '<span class="cw-inv-detail-badge" style="color:#7dd87d;">🖐️ 可拾取</span>';
            }

            if (this._isEncounter(ent)) {
                return '<span class="cw-inv-detail-badge cw-badge-encounter">⚔️ 遭遇</span>';
            }

            const map = {
                npc: { text: 'NPC', color: '#9ab0ff' },
                item: { text: '物品', color: '#ffcf80' },
                building: { text: '建筑', color: '#a8d8a8' },
                marker: { text: '标记', color: '#d8a8ff' },
                quest_point: { text: '任务点', color: '#ffd76b' },   // ★
                player: { text: '玩家', color: '#7dd87d' },
            };
            const info = map[ent.kind] || { text: ent.kind, color: '#888' };
            return `<span style="font-size:11px;color:${info.color};">${info.text}</span>`;
        },

        _renderFields(ent) {
            const rows = [];
            const HIDE = [
                '图标', 'icon', '类型', '可拾取', '可堆叠', '最大堆叠',
                '数量', '区域', '位置',
            ];

            if (ent.status) {
                rows.push(`<div class="cw-inv-detail-attr">
                    <span class="key">状态</span><span class="val">${ent.status}</span>
                </div>`);
            }
            if (ent.effect) {
                rows.push(`<div class="cw-inv-detail-attr">
                    <span class="key">功能</span><span class="val">${ent.effect}</span>
                </div>`);
            }

            for (const [k, v] of Object.entries(ent.fields || {})) {
                if (k.startsWith('_pos')) continue;
                if (HIDE.includes(k)) continue;
                const isBonus = /^[+\-]?\d+(\.\d+)?%?$/.test(String(v).trim());
                rows.push(`<div class="cw-inv-detail-attr">
                    <span class="key">${k}</span>
                    <span class="val ${isBonus ? 'bonus' : ''}">${v}</span>
                </div>`);
            }

            if (rows.length === 0) return '';
            return `<div class="cw-inv-detail-section">
                <div class="cw-inv-detail-section-label">📋 属性</div>
                ${rows.join('')}
            </div>`;
        },

        _renderExtraStats(ent) {
            const extra = ent.extraStats;
            if (!extra || !extra._order || extra._order.length === 0) return '';

            let html = '';
            for (const k of extra._order) {
                const v = extra[k];
                if (v === undefined || v === '') continue;

                // X/Y 数值条
                const barMatch = String(v).match(/^(\d+)\s*\/\s*(\d+)([\s\S]*)$/);
                if (barMatch) {
                    const cur = parseInt(barMatch[1]);
                    const max = parseInt(barMatch[2]);
                    const tail = (barMatch[3] || '').trim();
                    const pct = max > 0 ? Math.min(100, cur / max * 100) : 0;
                    html += `
                        <div style="margin-bottom:10px;">
                            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                                <span style="color:#ccc;">${k}</span>
                                <span style="color:#888;font-family:monospace;">${cur}/${max}</span>
                            </div>
                            <div style="height:6px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;">
                                <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#7da8ff,#a8c4ff);"></div>
                            </div>
                            ${tail ? `<div style="font-size:11px;color:#888;margin-top:4px;">${tail}</div>` : ''}
                        </div>`;
                } else {
                    html += `
                        <div style="display:flex;justify-content:space-between;padding:6px 0;
                            font-size:13px;border-bottom:1px solid rgba(255,255,255,.04);">
                            <span style="color:#ccc;">${k}</span>
                            <span style="color:#ffd76b;font-weight:600;">${v}</span>
                        </div>`;
                }
            }

            if (!html) return '';
            return `<div class="cw-inv-detail-section">
                <div class="cw-inv-detail-section-label">📊 数据</div>
                ${html}
            </div>`;
        },

        _isEncounter(ent) {
            if (!ent?.fields) return false;
            const t = String(ent.fields['类型'] || '').trim();
            return /遭遇|encounter|enemy|敌人|敌对/i.test(t);
        },

        // ============================================================
        // 4. 编辑器
        // ============================================================
        openEditor(id) {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;
            const ent = map.entities.find(e => e.id === id);
            if (!ent) return;

            let extraText = '';
            if (ent.extraStats?._order) {
                extraText = ent.extraStats._order
                    .filter(k => ent.extraStats[k] !== undefined && ent.extraStats[k] !== '')
                    .map(k => `${k}: ${ent.extraStats[k]}`)
                    .join('\n');
            }

            let fieldsText = '';
            for (const [k, v] of Object.entries(ent.fields || {})) {
                if (k.startsWith('_pos')) continue;
                fieldsText += `${k}: ${v}\n`;
            }

            const html = `
                <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">✏️ 编辑实体</div>
                <div style="display:grid;gap:12px;">
                    <div style="display:grid;grid-template-columns:70px 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">图标</div>
                            <input type="text" id="cw-map-ent-emoji" value="${ent.emoji}"
                                style="width:100%;box-sizing:border-box;padding:10px;text-align:center;
                                    background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                    border-radius:8px;color:#fff;font-size:36px;">
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">名字</div>
                            <input type="text" id="cw-map-ent-name" value="${this._escAttr(ent.name)}"
                                style="width:100%;box-sizing:border-box;padding:10px;
                                    background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                    border-radius:8px;color:#fff;font-size:14px;">
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">类型</div>
                            <select id="cw-map-ent-kind"
                                style="width:100%;padding:8px;border-radius:8px;background:rgba(0,0,0,.3);
                                    color:#fff;border:1px solid rgba(255,255,255,.15);">
                                ${['npc', 'item', 'building', 'marker', 'portal'].map(k =>
                `<option value="${k}" ${ent.kind === k ? 'selected' : ''}>${this._kindLabel(k)}</option>`
            ).join('')}
                            </select>
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">所在区域</div>
                            <select id="cw-map-ent-region"
                                style="width:100%;padding:8px;border-radius:8px;background:rgba(0,0,0,.3);
                                    color:#fff;border:1px solid rgba(255,255,255,.15);">
                                ${map.regions.map(r =>
                `<option value="${r.id}" ${ent.region === r.id ? 'selected' : ''}>${r.name}</option>`
            ).join('')}
                            </select>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">位置（锚点）</div>
                            <input type="text" id="cw-map-ent-position" value="${this._escAttr(ent.position || 'center')}"
                                style="width:100%;box-sizing:border-box;padding:10px;
                                    background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                    border-radius:8px;color:#fff;font-size:13px;">
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">阻挡通行</div>
                            <label style="display:flex;align-items:center;gap:12px;padding:14px;
                                background:rgba(0,0,0,.3);border-radius:8px;
                                border:1px solid rgba(255,255,255,.15);cursor:pointer;">
                                <input type="checkbox" id="cw-map-ent-blocking" ${ent.blocking ? 'checked' : ''}
                                    style="width:16px;height:16px;accent-color:#667eea;">
                                <span style="font-size:13px;color:#ccc;">不可通行</span>
                            </label>
                        </div>
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">描述</div>
                        <textarea id="cw-map-ent-desc"
                            style="width:100%;box-sizing:border-box;padding:10px;
                                background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                border-radius:8px;color:#fff;font-size:13px;
                                min-height:60px;resize:vertical;">${ent.description || ''}</textarea>
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">标签（、分隔）</div>
                        <input type="text" id="cw-map-ent-tags" value="${this._escAttr((ent.tags || []).join('、'))}"
                            style="width:100%;box-sizing:border-box;padding:10px;
                                background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                border-radius:8px;color:#fff;font-size:13px;">
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">属性字段（每行 键:值）</div>
                        <textarea id="cw-map-ent-fields"
                            style="width:100%;box-sizing:border-box;padding:10px;
                                background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                border-radius:8px;color:#fff;font-size:13px;
                                min-height:80px;resize:vertical;font-family:monospace;">${fieldsText}</textarea>
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">额外数据（每行 键:值）</div>
                        <textarea id="cw-map-ent-extra"
                            style="width:100%;box-sizing:border-box;padding:10px;
                                background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                border-radius:8px;color:#fff;font-size:13px;
                                min-height:80px;resize:vertical;font-family:monospace;">${extraText}</textarea>
                    </div>
                </div>
                <div style="text-align:center;margin-top:18px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary"
                        onclick="MapEntityPanel.saveEditor('${ent.id}')">✅ 保存</button>
                    <button class="cinemaworld-button"
                        onclick="MapEntityPanel.openDetail('${ent.id}')">← 返回</button>
                    <button class="cinemaworld-button"
                        onclick="MapLauncher._closeSubPanel()">关闭</button>
                </div>`;

            window.MapLauncher._openSubPanel(html);
        },

        saveEditor(id) {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;
            const ent = map.entities.find(e => e.id === id);
            if (!ent) return;

            ent.emoji = document.getElementById('cw-map-ent-emoji').value.trim() || '❓';
            ent.name = document.getElementById('cw-map-ent-name').value.trim() || ent.name;
            ent.kind = document.getElementById('cw-map-ent-kind').value;
            ent.region = document.getElementById('cw-map-ent-region').value;
            ent.position = document.getElementById('cw-map-ent-position').value.trim() || 'center';
            ent.blocking = document.getElementById('cw-map-ent-blocking').checked;
            ent.description = document.getElementById('cw-map-ent-desc').value.trim();
            ent.tags = document.getElementById('cw-map-ent-tags').value
                .split(/[、,，]/).map(t => t.trim()).filter(Boolean);

            // fields
            ent.fields = {};
            for (const line of document.getElementById('cw-map-ent-fields').value.split('\n')) {
                const clean = line.trim();
                if (!clean) continue;
                const kv = clean.match(/^(.+?)[:：]\s*(.+)$/);
                if (kv) ent.fields[kv[1].trim()] = kv[2].trim();
            }

            // extraStats
            ent.extraStats = { _order: [], _raw: '' };
            for (const line of document.getElementById('cw-map-ent-extra').value.split('\n')) {
                const clean = line.trim();
                if (!clean) continue;
                const kv = clean.match(/^(.+?)[:：]\s*(.+)$/);
                if (kv) {
                    const k = kv[1].trim();
                    ent.extraStats[k] = kv[2].trim();
                    ent.extraStats._order.push(k);
                }
            }

            // 重摆位置（因为 region / position / blocking 可能变了）
            this._replaceEntity(map, ent);
            window.CWNotify3D?.('entity-update', { entityId: id });
            window.UIManager.showText('实体已保存', 1200);
            window.MapEntityPanel.openDetail(id);
            if (window.CharacterRegistry?.syncFromMap) {
                window.CharacterRegistry.syncFromMap(map);
            }
            if (window.SceneAvatarBarManager) {
                window.SceneAvatarBarManager.build();
            }
            if (window.SaveManager) window.SaveManager.save();
        },

        // 重新计算实体在地图上的坐标
        _replaceEntity(map, ent) {
            if (!map._generated) return;

            // 先从占用里释放旧位置
            const used = new Set();
            for (const e of map.entities) {
                if (e._placed && e !== ent) used.add(`${e.x},${e.y}`);
            }

            const pos = window.MapLayout._resolvePosition(
                ent, map, map._generated.grid, map._generated.placements, used
            );
            if (pos) {
                ent.x = pos.x;
                ent.y = pos.y;
                ent._placed = true;
            } else {
                ent._placed = false;
            }
        },

        // ============================================================
        // 5. 新建 / 删除
        // ============================================================
        openCreator() {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;

            const html = `
                <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">➕ 新建地图实体</div>
                <div style="display:grid;gap:12px;">
                    <div style="display:grid;grid-template-columns:70px 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">图标</div>
                            <input type="text" id="cw-new-ent-emoji" value="📦"
                                style="width:100%;box-sizing:border-box;padding:10px;text-align:center;
                                    background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                    border-radius:8px;color:#fff;font-size:36px;">
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">名字</div>
                            <input type="text" id="cw-new-ent-name" value="新实体"
                                style="width:100%;box-sizing:border-box;padding:10px;
                                    background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                    border-radius:8px;color:#fff;font-size:14px;">
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">类型</div>
                            <select id="cw-new-ent-kind"
                                style="width:100%;padding:8px;border-radius:8px;background:rgba(0,0,0,.3);
                                    color:#fff;border:1px solid rgba(255,255,255,.15);">
                                <option value="npc">NPC</option>
                                <option value="item">物品</option>
                                <option value="building">建筑</option>
                                <option value="marker">标记</option>
                                <option value="portal">出入口</option>
                            </select>
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">区域</div>
                            <select id="cw-new-ent-region"
                                style="width:100%;padding:8px;border-radius:8px;background:rgba(0,0,0,.3);
                                    color:#fff;border:1px solid rgba(255,255,255,.15);">
                                ${map.regions.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">位置（锚点）</div>
                        <input type="text" id="cw-new-ent-position" value="center"
                            style="width:100%;box-sizing:border-box;padding:10px;
                                background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                border-radius:8px;color:#fff;font-size:13px;">
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">描述</div>
                        <textarea id="cw-new-ent-desc"
                            style="width:100%;box-sizing:border-box;padding:10px;
                                background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                border-radius:8px;color:#fff;font-size:13px;
                                min-height:60px;resize:vertical;"></textarea>
                    </div>
                </div>
                <div style="text-align:center;margin-top:18px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary"
                        onclick="MapEntityPanel.createNew()">✅ 创建</button>
                    <button class="cinemaworld-button"
                        onclick="MapLauncher._closeSubPanel()">取消</button>
                </div>`;

            window.MapLauncher._openSubPanel(html);
        },

        createNew() {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;

            const name = document.getElementById('cw-new-ent-name').value.trim();
            if (!name) { alert('名字不能为空'); return; }

            const id = `ent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

            const ent = {
                id,
                name,
                emoji: document.getElementById('cw-new-ent-emoji').value.trim() || '📦',
                kind: document.getElementById('cw-new-ent-kind').value,
                region: document.getElementById('cw-new-ent-region').value,
                position: document.getElementById('cw-new-ent-position').value.trim() || 'center',
                blocking: true,
                isPlayer: false,
                tags: [],
                description: document.getElementById('cw-new-ent-desc').value.trim(),
                meta: {},
                status: '',
                effect: '',
                fields: {},
                interactions: [],
                extraStats: { _order: [], _raw: '' },
            };

            this._replaceEntity(map, ent);
            map.entities.push(ent);

            window.UIManager.showText(`已创建实体「${name}」`, 1200);
            window.MapEntityPanel.openDetail(id);
            window.CWNotify3D?.('entity-add');
            if (window.CharacterRegistry?.syncFromMap) {
                window.CharacterRegistry.syncFromMap(map);
            }
            if (window.SceneAvatarBarManager) {
                window.SceneAvatarBarManager.build();
            }

            if (window.SaveManager) window.SaveManager.save();
        },

        confirmDelete(id) {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;
            const ent = map.entities.find(e => e.id === id);
            if (!ent) return;

            if (!confirm(`确定删除实体「${ent.name}」吗？`)) return;

            const idx = map.entities.findIndex(e => e.id === id);
            map.entities.splice(idx, 1);
            window.CWNotify3D?.('entity-remove', { entityId: id });
            window.UIManager.showText(`已删除「${ent.name}」`, 1200);
            window.MapLauncher._closeSubPanel();
            if (window.CharacterRegistry?.syncFromMap) {
                window.CharacterRegistry.syncFromMap(map);
            }
            if (window.SceneAvatarBarManager) {
                window.SceneAvatarBarManager.build();
            }
            if (window.SaveManager) window.SaveManager.save();
        },

        _escAttr(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, "\\'")
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
    };

    window.MapEntityPanel = MapEntityPanel;
    console.log('[CinemaWorld] map-entities.js 已加载');
})();