// ============================================================
// CinemaWorld · map-manager.js
// 世界地图列表 / 查看 / 删除 / 定位
// + 建筑规则库（预览 / 查看 / 删除 / 重置）
// 依赖：map-canvas.js, map-schema.js
// 暴露：window.MapManagerPanel
// ============================================================

(function () {
    'use strict';

    const MapManagerPanel = {
        // ============================================================
        // 地图列表
        // ============================================================
        open() {
            const store = window.CinemaWorld?.worldState?.maps || {};
            const names = Object.keys(store).filter(k => !k.includes('@'));   // ★ 排除实例
            const currentName = window.CinemaWorld?.worldState?.currentMapName;

            let html = `
                <div style="font-size:20px;font-weight:bold;margin-bottom:6px;">
                    🗺️ 世界地图
                </div>
                <div style="font-size:13px;color:#888;text-align:center;margin-bottom:18px;">
                    共 ${names.length} 张地图
                    ${currentName ? ` · 当前：<span style="color:#7da8ff;">${currentName}</span>` : ''}
                </div>
            `;

            if (names.length === 0) {
                html += `
                    <div style="text-align:center;padding:40px 20px;color:#666;font-size:14px;">
                        还没有任何地图。<br>
                        <span style="font-size:12px;">关闭后进入游戏，走到出入口会自动生成。</span>
                    </div>
                `;
            } else {
                html += `<div style="display:grid;gap:10px;max-height:60vh;overflow-y:auto;padding-right:4px;">`;

                for (const name of names) {
                    const data = store[name];
                    const isCurrent = name === currentName;
                    const regionCount = data.regions?.length || 0;
                    const entityCount = data.entities?.filter(e => !e.isPlayer).length || 0;
                    const portalCount = data.entities?.filter(e => e.kind === 'portal').length || 0;
                    const childCount = data.childMaps ? Object.keys(data.childMaps).length : 0;

                    html += `
                        <div style="background:${isCurrent ? 'rgba(120,150,255,.12)' : 'rgba(255,255,255,.03)'};
                            border:1px solid ${isCurrent ? 'rgba(120,150,255,.4)' : 'rgba(255,255,255,.06)'};
                            border-radius:12px;padding:14px 16px;">
                            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                                <div style="flex:1;min-width:0;">
                                    <div style="font-size:15px;color:#fff;font-weight:600;margin-bottom:4px;">
                                        ${this._esc(data.name || name)}
                                        ${isCurrent ? '<span style="font-size:11px;color:#7dd87d;margin-left:6px;">[当前]</span>' : ''}
                                    </div>
                                    <div style="font-size:12px;color:#888;margin-bottom:6px;">
                                        ${this._esc(data.description || '无描述')}
                                    </div>
                                    <div style="font-size:11px;color:#666;">
                                        ${regionCount} 个区域 · ${entityCount} 个实体 · ${portalCount} 个出入口
                                        ${childCount > 0 ? ` · ${childCount} 个子地图` : ''}
                                    </div>
                                </div>
                                <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
                                    <button class="cinemaworld-button" style="font-size:12px;padding:6px 12px;"
                                        onclick="MapManagerPanel.inspect('${this._escAttr(name)}')">
                                        🔍 查看
                                    </button>
                                    <button class="cinemaworld-button" style="font-size:12px;padding:6px 12px;color:#d87d7d;"
                                        onclick="MapManagerPanel.confirmDelete('${this._escAttr(name)}')">
                                        🗑️ 删除
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }

                html += `</div>`;
            }

            html += `
                <div style="text-align:center;margin-top:18px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" id="cw-map-open-rules"
                        style="color:#a8d8ff;">
                        📜 规则库
                    </button>
                    <button class="cinemaworld-button" style="color:#d87d7d;"
                        onclick="MapManagerPanel.confirmClearAll()">
                        🧹 清空所有地图
                    </button>
                    <button class="cinemaworld-button" onclick="MapManagerPanel.close()">关闭</button>
                </div>
            `;

            this._showModal(html);

            // 绑定规则库按钮
            document.getElementById('cw-map-open-rules')?.addEventListener('click', () => {
                this.openRules();
            });
        },

        // ============================================================
        // 查看某张地图详情
        // ============================================================
        inspect(name) {
            const store = window.CinemaWorld?.worldState?.maps || {};
            const data = store[name];
            if (!data) {
                window.UIManager.showText('地图不存在', 1500);
                return;
            }

            let regionList = '';
            for (const r of (data.regions || [])) {
                const ents = (data.entities || []).filter(e => e.region === r.id && !e.isPlayer);
                regionList += `
                    <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                        <div style="font-size:13px;color:#7da8ff;">
                            📍 ${this._esc(r.name)} <span style="color:#666;font-size:11px;">(${r.type})</span>
                        </div>
                        ${ents.length > 0 ? `
                            <div style="font-size:11px;color:#888;margin-top:4px;">
                                ${ents.map(e => `${e.emoji}${this._esc(e.name)}`).join(' · ')}
                            </div>
                        ` : `<div style="font-size:11px;color:#555;margin-top:4px;">（无实体）</div>`}
                    </div>
                `;
            }

            const playerPos = data._playerPos;

            const html = `
                <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">
                    🗺️ ${this._esc(data.name || name)}
                </div>
                <div style="font-size:13px;color:#aaa;margin-bottom:14px;padding:10px;
                    background:rgba(0,0,0,.2);border-radius:8px;">
                    ${this._esc(data.description || '无描述')}
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
                    <div style="text-align:center;padding:10px;background:rgba(120,150,255,.08);border-radius:8px;">
                        <div style="font-size:20px;color:#7da8ff;font-weight:bold;">${(data.regions || []).length}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">区域</div>
                    </div>
                    <div style="text-align:center;padding:10px;background:rgba(120,150,255,.08);border-radius:8px;">
                        <div style="font-size:20px;color:#7da8ff;font-weight:bold;">${(data.entities || []).filter(e => !e.isPlayer).length}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">实体</div>
                    </div>
                    <div style="text-align:center;padding:10px;background:rgba(120,150,255,.08);border-radius:8px;">
                        <div style="font-size:20px;color:#7da8ff;font-weight:bold;">${(data.connections || []).length}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">连接</div>
                    </div>
                </div>
                ${playerPos ? `
                    <div style="font-size:12px;color:#888;margin-bottom:12px;">
                        📍 上次离开位置：(${playerPos.x}, ${playerPos.y})
                    </div>
                ` : ''}
                <div style="font-size:12px;color:#888;margin-bottom:6px;">区域详情：</div>
                <div style="max-height:40vh;overflow-y:auto;padding:4px 12px;
                    background:rgba(0,0,0,.15);border-radius:8px;">
                    ${regionList || '<div style="padding:20px;text-align:center;color:#555;">无区域</div>'}
                </div>
                <div style="text-align:center;margin-top:18px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary"
                        onclick="MapManagerPanel.jumpTo('${this._escAttr(name)}')">
                        🚀 传送过去
                    </button>
                    <button class="cinemaworld-button" onclick="MapManagerPanel.open()">← 返回列表</button>
                </div>
            `;

            this._showModal(html);
        },

        // ============================================================
        // 传送到某张地图
        // ============================================================
        async jumpTo(name) {
            const map = window.MapLauncher.findMapInWorld?.(name);
            if (!map) {
                window.UIManager.showText('地图读取失败', 2000);
                return;
            }

            if (window.MapLauncher._map) {
                window.MapLauncher._saveMapToWorld(window.MapLauncher._map);
            }

            window.UIManager.closeModal();
            if (window.MapCanvas.canvas) window.MapCanvas.destroy();

            window.MapLauncher._map = map;
            window.MapLauncher._renderMapModal(document.getElementById('cinemaworld-modal'));

            window.UIManager.showText(`🚀 传送至【${name}】`, 1500);
            if (window.SaveManager) window.SaveManager.save();
        },

        // ============================================================
        // 删除单张
        // ============================================================
        confirmDelete(name) {
            const store = window.CinemaWorld?.worldState?.maps || {};
            const data = store[name];
            if (!data) return;
        
            const isCurrent = window.CinemaWorld?.worldState?.currentMapName === name;
        
            if (!confirm(`确定删除地图「${name}」吗？\n\n` +
                `区域 ${data.regions?.length || 0} 个 · 实体 ${data.entities?.filter(e => !e.isPlayer).length || 0} 个\n` +
                (isCurrent ? '\n⚠️ 这是当前地图，删除后需要重新生成。' : '')
            )) return;
        
            // ★ 1. 收集这张地图里所有 plot 用过的模板 id
            const plotsInMap = data._plots || {};
            const usedTemplateIds = new Set();
            // 注意：plot 本身不存 templateId，只有 ruleId 是历史字段
            // 但 plot 有 name/emoji 等，无法反查"来自哪个模板"
            // 所以这里只能做"孤儿清理"：扫描所有自定义模板，如果没有任何 plot 引用 → 不删（保守）
            
            // ---------- 删除地图 ----------
            delete store[name];
        
            // ---------- 清理其他地图里指向这张地图的 portal ----------
            const cleaned = [];
            for (const otherName of Object.keys(store)) {
                const other = store[otherName];
                if (!other.entities) continue;
                const before = other.entities.length;
                other.entities = other.entities.filter(e =>
                    !(e.kind === 'portal' && e.fields?.['目标'] === name)
                );
                if (other.entities.length !== before) cleaned.push(otherName);
            }
        
            // ---------- 清理其他地图的 childMaps ----------
            for (const otherName of Object.keys(store)) {
                const other = store[otherName];
                if (other.childMaps && other.childMaps[name]) {
                    delete other.childMaps[name];
                }
            }
        
            // ---------- 当前地图删除后的处理 ----------
            if (isCurrent) {
                window.CinemaWorld.worldState.currentMapName = null;
        
                const mq = window.CinemaWorld.worldState.mainQuest;
                if (mq?.target?.mapName === name) {
                    window.CinemaWorld.worldState.mainQuest = null;
                    console.log(`[MapManager] 删除地图「${name}」时清空主线`);
                }
        
                if (window.MapCanvas.canvas) {
                    window.MapCanvas.destroy();
                }
                window.MapLauncher._map = null;
            }
        
            // ★ 2. 清理孤儿模板（可选）
            //    如果某模板的所有使用它的 plot 都随着地图消失了，就删掉它
            this._cleanOrphanTemplates();
        
            console.log(`[MapManager] 删除地图: ${name}`, cleaned.length ? `（清理了 ${cleaned.length} 张地图里的返回 portal）` : '');
            window.UIManager.showText(`已删除地图「${name}」`, 1500);
        
            if (window.SaveManager) window.SaveManager.save();
            this.open();
        },
        
        // ============================================================
        // ★ 新增：清理孤儿模板
        //   规则：如果某自定义模板的"最后使用它的地图"被删了，就删模板
        //   简化版：只要没有任何地图里的 plot 引用它，就删
        // ============================================================
        _cleanOrphanTemplates() {
            if (!window.MapPlotTemplate) return;
            
            const store = window.CinemaWorld?.worldState?.maps || {};
            
            // 收集所有地图里 plots 用到的模板 id
            // ★ plot 不直接记 templateId（它只有 rules 和 shop），
            //    所以这里用"同名模板 + 相同 crops 数量"做启发式匹配是不准的。
            //
            // 最简单可靠的做法：**不自动清模板**
            // 让玩家手动在模板库里删。
            //
            // 或者：
            // 如果 worldState.maps 里一张地图都没有（所有地图都删了）
            // → 清空模板库
            const mapNames = Object.keys(store).filter(k => !k.includes('@'));
            if (mapNames.length === 0) {
                console.log('[MapManager] 所有地图已清空，清理自定义模板');
                window.MapPlotTemplate.clearCustom?.();
            }
        },

        // ============================================================
        // 清空所有地图
        // ============================================================
        confirmClearAll() {
            const store = window.CinemaWorld?.worldState?.maps || {};
            const names = Object.keys(store).filter(k => !k.includes('@'));
            if (names.length === 0) {
                window.UIManager.showText('没有地图可清空', 1500);
                return;
            }
        
            if (!confirm(`确定清空全部 ${names.length} 张地图吗？\n\n` +
                `这会删除：\n- 所有地图数据\n- 所有地图上的实体、物品、NPC 状态\n- 所有建筑实例\n\n` +
                `规则库、背包、角色状态、场景不受影响。\n\n此操作不可撤销。`
            )) return;
        
            if (!confirm(`真的确定？再确认一次。`)) return;
        
            window.CinemaWorld.worldState.maps = {};
            window.CinemaWorld.worldState.currentMapName = null;
            window.CinemaWorld.worldState.mainQuest = null;
        
            if (window.MapCanvas.canvas) {
                window.MapCanvas.destroy();
            }
            window.MapLauncher._map = null;
        
            // ★ 清空所有地图 → 清空所有自定义模板
            if (window.MapPlotTemplate) {
                window.MapPlotTemplate.clearCustom?.();
                console.log('[MapManager] 已清空所有地图，自定义模板已清理');
            }
        
            console.log(`[MapManager] 清空所有地图（${names.length} 张）`);
            window.UIManager.showText(`已清空 ${names.length} 张地图`, 2000);
        
            if (window.SaveManager) window.SaveManager.save();
            this.open();
        },

        // ============================================================
        // ★ 规则库：列表
        // ============================================================
        openRules() {
            const rules = window.MapLauncher?.listRules?.() || [];
            const instanceKeys = Object.keys(window.CinemaWorld?.worldState?.maps || {})
                .filter(k => k.includes('@'));

            let html = `
                <div style="font-size:20px;font-weight:bold;margin-bottom:6px;">
                    📜 建筑规则库
                </div>
                <div style="font-size:13px;color:#888;text-align:center;margin-bottom:18px;">
                    共 ${rules.length} 条规则 · ${instanceKeys.length} 个实例
                </div>
            `;

            if (rules.length === 0) {
                html += `
                    <div style="text-align:center;padding:40px 20px;color:#666;font-size:14px;">
                        还没有任何规则。<br>
                        <span style="font-size:12px;">进入建筑时会自动生成。</span>
                    </div>
                `;
            } else {
                html += `<div style="display:grid;gap:10px;max-height:60vh;overflow-y:auto;padding-right:4px;">`;

                for (const rule of rules) {
                    const instanceCount = instanceKeys.filter(k => k.startsWith(rule.name + '@')).length;
                    const regionCount = rule.regions?.length || 0;
                    const entityCount = rule.entities?.filter(e => !e.isPlayer).length || 0;

                    html += `
                        <div style="background:rgba(255,255,255,.03);
                            border:1px solid rgba(255,255,255,.06);
                            border-radius:12px;padding:14px 16px;">
                            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
                                <div style="flex:1;min-width:0;">
                                    <div style="font-size:15px;color:#fff;font-weight:600;margin-bottom:4px;">
                                        ${this._esc(rule.name)}
                                    </div>
                                    <div style="font-size:12px;color:#888;margin-bottom:6px;">
                                        ${this._esc(rule.description || '无描述')}
                                    </div>
                                    <div style="font-size:11px;color:#666;">
                                        ${regionCount} 个区域 · ${entityCount} 个实体模板 · ${instanceCount} 个实例
                                    </div>
                                </div>
                                <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
                                    <button class="cinemaworld-button" style="font-size:12px;padding:6px 12px;"
                                        onclick="MapManagerPanel.inspectRule('${this._escAttr(rule.name)}')">
                                        🔍 查看
                                    </button>
                                    <button class="cinemaworld-button" style="font-size:12px;padding:6px 12px;color:#d87d7d;"
                                        onclick="MapManagerPanel.confirmDeleteRule('${this._escAttr(rule.name)}')">
                                        🗑️ 删除
                                    </button>
                                </div>
                            </div>
                        </div>
                    `;
                }

                html += `</div>`;
            }

            html += `
                <div style="text-align:center;margin-top:18px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" style="color:#d87d7d;"
                        onclick="MapManagerPanel.confirmClearAllRules()">
                        🧹 清空所有规则
                    </button>
                    <button class="cinemaworld-button" onclick="MapManagerPanel.open()">← 返回地图</button>
                </div>
            `;

            this._showModal(html);
        },

        // ============================================================
        // ★ 规则库：查看详情
        // ============================================================
        inspectRule(ruleName) {
            const rule = window.MapLauncher?.getRule?.(ruleName);
            if (!rule) {
                window.UIManager.showText('规则不存在', 1500);
                return;
            }

            // 区域列表
            let regionList = '';
            for (const r of (rule.regions || [])) {
                const ents = (rule.entities || []).filter(e => e.region === r.id && !e.isPlayer);
                regionList += `
                    <div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05);">
                        <div style="font-size:13px;color:#7da8ff;">
                            📍 ${this._esc(r.name)}
                            <span style="color:#666;font-size:11px;">(${r.type})</span>
                        </div>
                        ${ents.length > 0 ? `
                            <div style="font-size:11px;color:#888;margin-top:4px;">
                                ${ents.map(e => `${e.emoji}${this._esc(e.name)}`).join(' · ')}
                            </div>
                        ` : `<div style="font-size:11px;color:#555;margin-top:4px;">（无实体）</div>`}
                    </div>
                `;
            }

            // 实体模板
            let entityList = '';
            for (const e of (rule.entities || [])) {
                if (e.isPlayer) continue;
                const countStr = (e.count && e.count > 1) ? ` ×${e.count}` : '';
                entityList += `
                    <div style="display:flex;align-items:center;gap:8px;
                        padding:6px 10px;background:rgba(255,255,255,.03);
                        border-radius:6px;font-size:12px;color:#ccc;">
                        <span style="font-size:18px;">${e.emoji}</span>
                        <span style="flex:1;">${this._esc(e.name)}${countStr}</span>
                        <span style="font-size:10px;color:#666;">${e.kind}</span>
                    </div>
                `;
            }

            const rawText = rule._rawText || '（无）';
            const instanceKeys = Object.keys(window.CinemaWorld?.worldState?.maps || {})
                .filter(k => k.startsWith(ruleName + '@'));

            const html = `
                <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">
                    📜 ${this._esc(rule.name)}
                </div>
                <div style="font-size:13px;color:#aaa;margin-bottom:14px;padding:10px;
                    background:rgba(0,0,0,.2);border-radius:8px;">
                    ${this._esc(rule.description || '无描述')}
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
                    <div style="text-align:center;padding:10px;background:rgba(120,150,255,.08);border-radius:8px;">
                        <div style="font-size:20px;color:#7da8ff;font-weight:bold;">${(rule.regions || []).length}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">区域</div>
                    </div>
                    <div style="text-align:center;padding:10px;background:rgba(120,150,255,.08);border-radius:8px;">
                        <div style="font-size:20px;color:#7da8ff;font-weight:bold;">${(rule.entities || []).filter(e => !e.isPlayer).length}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">实体模板</div>
                    </div>
                    <div style="text-align:center;padding:10px;background:rgba(120,150,255,.08);border-radius:8px;">
                        <div style="font-size:20px;color:#7da8ff;font-weight:bold;">${instanceKeys.length}</div>
                        <div style="font-size:11px;color:#888;margin-top:2px;">实例</div>
                    </div>
                </div>

                <div style="font-size:13px;color:#aaa;margin-bottom:6px;">📍 区域结构：</div>
                <div style="max-height:30vh;overflow-y:auto;padding:4px 12px;
                    background:rgba(0,0,0,.15);border-radius:8px;margin-bottom:14px;">
                    ${regionList || '<div style="padding:20px;text-align:center;color:#555;">无区域</div>'}
                </div>

                <div style="font-size:13px;color:#aaa;margin-bottom:6px;">🎭 实体模板（实例化时随机）：</div>
                <div style="max-height:30vh;overflow-y:auto;display:grid;gap:6px;
                    padding:10px;background:rgba(0,0,0,.15);border-radius:8px;margin-bottom:14px;">
                    ${entityList || '<div style="padding:20px;text-align:center;color:#555;">无实体</div>'}
                </div>

                <div style="font-size:13px;color:#aaa;margin-bottom:6px;">📄 原始 AI 文本：</div>
                <textarea readonly style="width:100%;box-sizing:border-box;min-height:120px;
                    font-family:monospace;font-size:11px;padding:10px;
                    background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                    border-radius:8px;color:#ccc;resize:vertical;">${this._esc(rawText)}</textarea>

                <div style="text-align:center;margin-top:18px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" style="color:#d87d7d;"
                        onclick="MapManagerPanel.resetRuleInstances('${this._escAttr(rule.name)}')">
                        🔄 重置所有实例
                    </button>
                    <button class="cinemaworld-button" onclick="MapManagerPanel.openRules()">← 返回列表</button>
                </div>
            `;

            this._showModal(html);
        },

        // ============================================================
        // ★ 规则库：重置实例
        // ============================================================
        resetRuleInstances(ruleName) {
            const ws = window.CinemaWorld?.worldState;
            if (!ws?.maps) return;

            const prefix = ruleName + '@';
            const toDelete = Object.keys(ws.maps).filter(k => k.startsWith(prefix));

            if (toDelete.length === 0) {
                window.UIManager.showText('没有实例可重置', 1500);
                return;
            }

            if (!confirm(`确定重置 ${toDelete.length} 个实例？\n下次进入建筑会重新随机。`)) return;

            for (const k of toDelete) {
                delete ws.maps[k];
            }

            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText(`已重置 ${toDelete.length} 个实例`, 1500);
            this.inspectRule(ruleName);
        },

        // ============================================================
        // ★ 规则库：删除单条
        // ============================================================
        confirmDeleteRule(ruleName) {
            const rule = window.MapLauncher?.getRule?.(ruleName);
            if (!rule) return;

            const ws = window.CinemaWorld?.worldState;
            const prefix = ruleName + '@';
            const instanceCount = Object.keys(ws?.maps || {}).filter(k => k.startsWith(prefix)).length;

            if (!confirm(`确定删除规则「${ruleName}」？\n\n` +
                `区域 ${rule.regions?.length || 0} 个 · 实体模板 ${rule.entities?.filter(e => !e.isPlayer).length || 0} 个\n` +
                (instanceCount > 0 ? `\n⚠️ 关联的 ${instanceCount} 个实例也会一起删除。` : '')
            )) return;

            window.MapLauncher.deleteRule(ruleName);

            if (instanceCount > 0) {
                for (const k of Object.keys(ws.maps || {})) {
                    if (k.startsWith(prefix)) delete ws.maps[k];
                }
            }

            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText(`已删除规则「${ruleName}」`, 1500);
            this.openRules();
        },

        // ============================================================
        // ★ 规则库：清空所有
        // ============================================================
        confirmClearAllRules() {
            const rules = window.MapLauncher?.listRules?.() || [];
            if (rules.length === 0) {
                window.UIManager.showText('没有规则可清空', 1500);
                return;
            }

            if (!confirm(`确定清空全部 ${rules.length} 条规则？\n\n` +
                `这会删除：\n- 所有建筑规则\n- 所有关联实例\n\n此操作不可撤销。`
            )) return;

            if (!confirm('真的确定？再确认一次。')) return;

            const ws = window.CinemaWorld?.worldState;
            if (ws) {
                ws.mapRules = {};
                for (const k of Object.keys(ws.maps || {})) {
                    if (k.includes('@')) delete ws.maps[k];
                }
            }

            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText(`已清空 ${rules.length} 条规则`, 2000);
            this.openRules();
        },

        // ============================================================
        // 工具
        // ============================================================
        close() {
            if (window.MapLauncher?._subState) {
                window.MapLauncher._closeSubPanel();
            } else {
                window.UIManager.closeModal();
            }
        },

        _showModal(html) {
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;
            modal.className = 'active';
            modal.style.width = 'min(860px, 96vw)';
            modal.style.maxWidth = 'none';
            modal.style.maxHeight = '92vh';
            modal.style.padding = '24px 28px';
            modal.style.overflowY = 'auto';
            modal.style.boxSizing = 'border-box';
            modal.innerHTML = html;
        },

        _esc(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },

        _escAttr(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
    };

    window.MapManagerPanel = MapManagerPanel;
    console.log('[CinemaWorld] map-manager.js 已加载');
})();