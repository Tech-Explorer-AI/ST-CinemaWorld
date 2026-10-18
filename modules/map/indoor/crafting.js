// ============================================================
// CinemaWorld · map/crafting.js
// 合成系统：
//   - 扫描合成台周围 R 范围的室外地图资源点 → 材料池
//   - AI 根据材料池生成配方 → 缓存到合成台实体
//   - 玩家从背包扣材料 → 合成产物
//
// 依赖：map-canvas.js, map-environment.js
// 暴露：window.MapCrafting
// ============================================================

(function () {
    'use strict';

    if (window.MapCrafting) return;

    const CONFIG = {
        radius: 1,              // ★ 坐标系上的 Chebyshev 半径
        maxRecipes: 12,         // 单次生成配方上限
        verbose: true,
    };

    const MapCrafting = {
        CONFIG,
        isGenerating: false,

        _currentStation: null,

        // ============================================================
        // 对外入口：打开合成面板
        // ============================================================
        async open(stationEnt) {
            if (!stationEnt?.indoor) {
                window.UIManager?.showText?.('这个不是合成台', 1500);
                return;
            }
            if (stationEnt.indoor.type !== 'craft') {
                window.UIManager?.showText?.('这个不是合成台', 1500);
                return;
            }

            this._currentStation = stationEnt;

            // 没有配方 → 生成
            if (!stationEnt.indoor.recipes || stationEnt.indoor.recipes.length === 0) {
                await this._generateRecipes(stationEnt);
            }

            this._render();
        },

        // ============================================================
        // 收集材料池：扫描合成台周围 R 范围的室外地图资源点
        // ============================================================
        collectMaterials(stationEnt, radius = null) {
            const R = radius ?? CONFIG.radius;
            const map = window.MapLauncher?.getMap?.();
            if (!map) return new Map();
        
            // 找到合成台对应的"室外锚点地图"
            const anchorName = this._resolveOutdoorAnchor(map);
            if (!anchorName) {
                console.warn('[MapCrafting] 找不到室外锚点地图:', map.name);
                return new Map();
            }
        
            // ★ 用 WorldGraph 的 BFS 找范围内的地图（不依赖坐标）
            const mapNamesInRange = this._collectMapNamesInRange(anchorName, R);
        
            if (CONFIG.verbose) {
                console.log(`[MapCrafting] 材料池扫描 ${anchorName} 周围 R=${R}:`, mapNamesInRange);
            }
        
            const ws = window.CinemaWorld?.worldState;
            if (!ws?.maps) return new Map();
        
            // 扫描资源点
            const materials = new Map();
        
            for (const mapName of mapNamesInRange) {
                const mapData = ws.maps[mapName];
                if (!mapData?.entities) continue;
        
                for (const ent of mapData.entities) {
                    if (ent.kind !== 'resource_point') continue;
                    const rewards = ent.resource?.rewards || [];
                    for (const r of rewards) {
                        if (!r.item) continue;
        
                        if (!materials.has(r.item)) {
                            materials.set(r.item, {
                                item: r.item,
                                icon: r.icon || '📦',
                                sources: [],
                            });
                        }
                        materials.get(r.item).sources.push({
                            mapName,
                            resourceName: ent.name,
                            chance: r.chance ?? 1.0,
                            count: r.count ?? 1,
                        });
                    }
                }
            }
        
            if (CONFIG.verbose) {
                console.log(`[MapCrafting] 材料池 ${materials.size} 种:`, [...materials.keys()]);
            }
        
            return materials;
        },

        // ============================================================
        // 解析"室外锚点地图"：室内→父地图，室外→自己
        // ============================================================
        _resolveOutdoorAnchor(map) {
            if (!map) return null;
        
            // 1. 显式字段
            if (map._parentMap) return map._parentMap;
        
            // 2. 室外图 → 就是自己
            const isIndoor = map.mapType === 'indoor'
                || map._source === 'program'
                || map._source === 'indoor'
                || map.tags?.includes('indoor');
            if (!isIndoor) return map.name;
        
            // 3. 室内 → 从 portal 反查父地图
            const portals = (map.entities || []).filter(e =>
                e.kind === 'portal' && e.fields?.['目标']
            );
            if (portals.length === 0) return null;
        
            // 优先找名字含"返回"的
            const returnPortal = portals.find(p => /返回|回/.test(p.name || ''));
            if (returnPortal) return returnPortal.fields['目标'];
        
            // 兜底：第一个带"目标"的 portal
            return portals[0].fields['目标'];
        },

        // ============================================================
        // 生成配方（AI）
        // ============================================================
        async _generateRecipes(stationEnt) {
            if (this.isGenerating) return;
            this.isGenerating = true;

            try {
                const map = window.MapLauncher?.getMap?.();
                const materials = this.collectMaterials(stationEnt);

                if (materials.size === 0) {
                    // 没有材料池 → 生成默认配方
                    stationEnt.indoor.recipes = this._defaultRecipes();
                    window.UIManager?.showText?.('周围没有资源点，使用默认配方', 2000);
                    return;
                }

                const prompt = this._buildPrompt(stationEnt, map, materials);
                window.UIManager?.showText?.('🤖 AI 正在生成配方...', 2500);

                const raw = await window.generateFunctionalReply(prompt, 'crafting-recipe');
                if (!raw) {
                    stationEnt.indoor.recipes = this._defaultRecipes();
                    return;
                }

                const recipes = this._parseRecipes(raw, materials);
                if (recipes.length === 0) {
                    stationEnt.indoor.recipes = this._defaultRecipes();
                    return;
                }

                stationEnt.indoor.recipes = recipes;
                window.MapLauncher?._saveMapToWorld?.(map);
                if (window.SaveManager) window.SaveManager.save();

                console.log(`[MapCrafting] 生成 ${recipes.length} 个配方`);

            } catch (e) {
                console.error('[MapCrafting] 生成配方失败:', e);
                stationEnt.indoor.recipes = this._defaultRecipes();
            } finally {
                this.isGenerating = false;
            }
        },

        // ============================================================
        // 组装 AI 提示词
        // ============================================================
        _buildPrompt(stationEnt, map, materials) {
            const parts = [];
        
            // 合成台信息
            parts.push(`【合成台】${stationEnt.name}（${stationEnt.indoor.catalogId}）`);
            if (stationEnt.description) parts.push(`描述：${stationEnt.description}`);
        
            // 所在地图
            const anchorName = this._resolveOutdoorAnchor(map);
            parts.push(`【所处位置】地图：${map.name}${anchorName && anchorName !== map.name ? `（室外锚点：${anchorName}）` : ''}`);
        
            // 材料池
            const matList = [...materials.values()];
            parts.push(`【可用材料池】（${matList.length} 种）\n` +
                matList.map(m => {
                    const src = m.sources.slice(0, 2).map(s => `${s.mapName}/${s.resourceName}`).join('、');
                    return `- ${m.item}（来源：${src}${m.sources.length > 2 ? ' 等' : ''}）`;
                }).join('\n')
            );
        
            // 玩家信息
            if (window.PlayerStateManager?.player) {
                parts.push(window.PlayerStateManager.formatForPrompt());
            }
        
            // 任务
            parts.push(`
【任务】
基于【可用材料池】，生成一组"合成配方"。配方必须符合世界观、合成台类型、周围环境。

【输出格式】
每个配方占【两行】，缺一不可：

- 【配方名|图标】：一句话描述，[材料:材料A×N、材料B×N|产出:N]
- 产物：【物品名|图标】：一句话描述，[类型:xxx|效果:xxx|可堆叠:是/否|最大堆叠:N|货币种类:X|买价:X|卖价:X]

【字段说明】
- 配方名：中文，简短（3-6 字）
- 图标：1 个 emoji
- 配方描述：一句话，20 字以内
- 材料：2-3 样，用 、 分隔，格式"材料名×数量"。材料名必须来自【可用材料池】
- 产出：产出数量（通常 1）

【产物的完整格式】（★ 必须遵守）
产物行的格式是：
- 产物：【物品名|图标】：描述，[类型:xxx|可堆叠:是/否|货币种类:X|买价:X|卖价:X|其他字段...]

按【产物类型】填不同字段：

--- 消耗品（食物、药水、卷轴）---
[类型:消耗品|功能:回复体力|效果:回复体力 20|可堆叠:是|最大堆叠:20|货币种类:金钱|买价:5|卖价:3]

效果DSL语法：
- 回复生命 X / 回复体力 X / 回复精神 X
- 提升生命上限 X / 提升攻击 X
- 状态中毒 X / 移除中毒
- 增益攻击 X Y回合
- 无效果写"效果:无"

--- 武器 ---
[类型:武器|攻击:+8|暴击:+5%|可堆叠:否|货币种类:金钱|买价:50|卖价:25]

--- 护甲 ---
[类型:护甲|防御:+5|可堆叠:否|货币种类:金钱|买价:40|卖价:20]

--- 饰品 ---
[类型:饰品|属性:敏捷+3|可堆叠:否|货币种类:金钱|买价:80|卖价:40]

--- 工具 ---
[类型:工具|功能:采集|效果:无|可堆叠:否|货币种类:金钱|买价:30|卖价:15]

--- 材料 ---
[类型:材料|可堆叠:是|最大堆叠:99|货币种类:金钱|买价:2|卖价:1]

【硬性约束】
1. ★ 材料名【必须】来自【可用材料池】，不能凭空捏造
2. ★ 每个配方必须有一行"产物：..."，用完整物品格式
3. ★ 数值要有梯度：
    - 普通物品：攻击/防御/效果 1-10，买价 5-30
    - 稀有物品：攻击/防御/效果 10-30，买价 30-100
    - 不要所有配方都出稀有物品，5-12 个配方里 1-2 个稀有即可
4. 材料 2-3 种，数量 1-5 个
5. 配方 5-12 个
6. 配方要符合合成台类型：
    - 灶台 → 食物、饮料
    - 锻造炉 → 武器、护甲、金属工具
    - 炼金台 → 药水、卷轴、毒药
    - 工作台 → 工具、杂项、木制品

【示例】（格式参考，材料名必须来自材料池）
- 【面包|🍞】：香气扑鼻的面包，[材料:小麦×3、水×1|产出:1]
- 产物：【面包|🍞】：刚出炉的麦香面包，[类型:消耗品|功能:回复体力|效果:回复体力 20|可堆叠:是|最大堆叠:20|货币种类:金钱|买价:5|卖价:3]

- 【铁剑|⚔️】：一把坚固的铁剑，[材料:铁矿石×3、木棍×1|产出:1]
- 产物：【铁剑|⚔️】：锻造出的锋利武器，[类型:武器|攻击:+8|可堆叠:否|货币种类:金钱|买价:50|卖价:25]

- 【红药水|🧪】：恢复生命的药水，[材料:草药×2、水×1|产出:1]
- 产物：【红药水|🧪】：一瓶鲜红的药水，[类型:消耗品|功能:回复生命|效果:回复生命 30|可堆叠:是|最大堆叠:10|货币种类:金钱|买价:20|卖价:10]

现在开始生成：
        `);
        
            return parts.join('\n\n');
        },

        // ============================================================
        // 解析 AI 返回
        // ============================================================
        _parseRecipes(text, materials) {
            const recipes = [];
            const lines = String(text || '').split('\n');
        
            let current = null;   // 当前正在解析的配方
        
            for (const raw of lines) {
                const line = raw.trim();
                if (!line) continue;
        
                // ---------- 产物行 ----------
                const productM = line.match(/^[-•]?\s*产物\s*[:：]\s*(.+)$/);
                if (productM) {
                    if (!current) {
                        console.warn('[MapCrafting] 产物行没有对应的配方，跳过');
                        continue;
                    }
        
                    const itemLine = productM[1].trim();
        
                    // 用 WorldManager 的标准解析
                    const item = window.WorldManager?.parseItemLine?.(itemLine);
                    if (!item || !item.name) {
                        console.warn('[MapCrafting] 产物行解析失败:', itemLine);
                        continue;
                    }
        
                    // ★ 用产物定义覆盖 result
                    current.result = {
                        item: item.name,
                        count: current.result?.count || 1,
                        icon: item.icon || current.result?.icon || '📦',
                        description: item.description || '',
                        fields: { ...(item.fields || {}) },
                        stackable: item.stackable === true,
                        maxStack: item.maxStack || null,
                        type: item.fields?.['类型'] || 'item',
                    };
        
                    continue;
                }
        
                // ---------- 配方行 ----------
                if (!line.startsWith('-')) continue;
        
                const m = line.match(/^-\s*【([^】]+)】\s*[:：]\s*(.+)$/);
                if (!m) continue;
        
                const meta = m[1].split('|').map(s => s.trim());
                const name = meta[0];
                const emoji = this._extractEmoji(meta[1]) || '📦';
                const body = m[2];
        
                const bracketM = body.match(/[\[【]([^\]】]+)[\]】]/);
                if (!bracketM) continue;
        
                const fields = {};
                for (const f of bracketM[1].split('|')) {
                    const kv = f.match(/^(.+?)\s*[:：]\s*(.+)$/);
                    if (kv) fields[kv[1].trim()] = kv[2].trim();
                }
        
                // 材料
                const matStr = fields['材料'] || '';
                const matList = [];
                for (const p of matStr.split(/[、,，]/)) {
                    const cm = p.match(/^(.+?)\s*[×xX*]\s*(\d+)$/);
                    if (!cm) continue;
                    const itemName = cm[1].trim();
                    const count = parseInt(cm[2]);
        
                    // ★ 校验材料在材料池里
                    if (!materials.has(itemName)) {
                        console.warn(`[MapCrafting] 配方 ${name} 引用了不存在的材料 ${itemName}，跳过`);
                        continue;
                    }
                    matList.push({ item: itemName, count });
                }
                if (matList.length === 0) {
                    console.warn(`[MapCrafting] 配方 ${name} 没有有效材料，跳过`);
                    current = null;
                    continue;
                }
        
                // 产物名（先存着，如果后面有"产物："行会覆盖）
                const resultItem = (fields['产物'] || '').trim();
                const resultCount = parseInt(fields['产出']) || 1;
        
                // 描述
                const desc = body.replace(bracketM[0], '').replace(/^[，,。、\s]+/, '').trim();
        
                // ★ 创建配方（产物先用简化版，等"产物："行来覆盖）
                current = {
                    id: `recipe_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    name,
                    emoji,
                    description: desc,
                    materials: matList,
                    result: resultItem ? {
                        item: resultItem,
                        count: resultCount,
                        icon: emoji,
                        description: desc,
                        fields: {},
                        stackable: false,
                        maxStack: null,
                        type: 'item',
                    } : null,
                };
        
                recipes.push(current);
            }
        
            // ★ 过滤掉没有产物的配方
            return recipes.filter(r => r.result && r.result.item).slice(0, CONFIG.maxRecipes);
        },

        _defaultRecipes() {
            return [
                {
                    id: 'recipe_default_bread',
                    name: '简餐',
                    emoji: '🍞',
                    description: '粗糙但顶饱',
                    materials: [],
                    result: { item: '面包', count: 1 },
                },
            ].filter(r => r.materials.length === 0 ? false : true);  // 材料为空 → 不显示
        },

        _extractEmoji(s) {
            if (!s) return null;
            const m = String(s).match(
                /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
            );
            return m ? m[0] : null;
        },
        _collectMapNamesInRange(anchorName, radius) {
            // 用 WorldGraph 的 BFS，不用坐标
            const graph = window.WorldGraph;
            if (!graph) {
                return [anchorName];
            }
        
            const visited = new Set([anchorName]);
            const queue = [{ name: anchorName, dist: 0 }];
            const result = [anchorName];
        
            while (queue.length > 0) {
                const { name, dist } = queue.shift();
                if (dist >= radius) continue;
        
                const node = graph.get(name);
                if (!node) continue;
        
                for (const info of Object.values(node.exits || {})) {
                    const next = info.target;
                    if (!next || visited.has(next)) continue;
                    visited.add(next);
                    queue.push({ name: next, dist: dist + 1 });
                    result.push(next);
                }
            }
        
            return result;
        },
        // ============================================================
        // UI
        // ============================================================
        _render() {
            const ent = this._currentStation;
            if (!ent) return;

            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;
            modal.className = 'active';

            const materials = this.collectMaterials(ent);
            const recipes = ent.indoor.recipes || [];
            const player = window.PlayerStateManager?.player;

            // 玩家材料统计
            const playerMats = new Map();
            for (const item of (player?.inventory || [])) {
                const mat = materials.get(item.name);
                if (mat) {
                    playerMats.set(item.name, item.count || 1);
                }
            }

            const recipesHTML = recipes.length === 0
                ? `<div style="text-align:center;padding:40px;color:#666;">暂无可合成配方</div>`
                : recipes.map(r => this._renderRecipeCard(r, playerMats, player)).join('');

            modal.innerHTML = `
                <div class="cinemaworld-modal-title" style="font-size:22px;">
                    ${ent.emoji} ${ent.name}
                </div>
                <div style="text-align:center;font-size:12px;color:#888;margin-bottom:14px;">
                    🔧 合成面板
                </div>

                <!-- 材料池 -->
                <div style="font-size:12px;color:#9ab0ff;margin-bottom:8px;">
                    📦 附近材料池（${materials.size} 种）
                </div>
                <div style="background:rgba(0,0,0,.2);padding:10px;border-radius:10px;
                    margin-bottom:16px;max-height:120px;overflow-y:auto;">
                    ${materials.size === 0
                    ? '<div style="color:#666;text-align:center;padding:8px;">周围没有资源点</div>'
                    : [...materials.values()].map(m => {
                        const have = playerMats.get(m.item) || 0;
                        return `<span style="display:inline-block;padding:3px 8px;margin:2px;
                            background:${have > 0 ? 'rgba(120,200,120,.2)' : 'rgba(255,255,255,.06)'};
                            border:1px solid ${have > 0 ? 'rgba(120,200,120,.5)' : 'rgba(255,255,255,.1)'};
                            border-radius:6px;font-size:11px;color:${have > 0 ? '#a8ffa8' : '#888'};">
                            ${m.item}${have > 0 ? ` ×${have}` : ''}
                        </span>`;
                    }).join('')
                }
                </div>

                <!-- 配方列表 -->
                <div style="font-size:12px;color:#9ab0ff;margin-bottom:8px;">
                    ⚒️ 配方（${recipes.length}）
                </div>
                <div style="max-height:400px;overflow-y:auto;">
                    ${recipesHTML}
                </div>

                <!-- 底部按钮 -->
                <div style="text-align:center;margin-top:16px;display:flex;
                    justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" onclick="MapCrafting._regenerate()"
                        style="color:#a8d8ff;">
                        🤖 重新生成配方
                    </button>
                    <button class="cinemaworld-button" onclick="MapCrafting.close()">
                        关闭
                    </button>
                </div>
            `;
        },

        _renderRecipeCard(recipe, playerMats, player) {
            // 检查材料
            const matRows = recipe.materials.map(m => {
                const have = playerMats.get(m.item) || 0;
                const ok = have >= m.count;
                return `<span style="font-size:11px;color:${ok ? '#a8ffa8' : '#ffb0b0'};margin-right:10px;">
                    ${m.item} ${have}/${m.count}
                </span>`;
            }).join('');
        
            const canCraft = recipe.materials.every(m =>
                (playerMats.get(m.item) || 0) >= m.count
            );
        
            // ★ 产物信息（如果 fields 里有内容，显示出来）
            const r = recipe.result || {};
            const rFields = r.fields || {};
            const KEY_FIELDS = ['类型', '攻击', '防御', '效果', '功能', '属性'];
            const fieldLines = KEY_FIELDS
                .map(k => rFields[k] ? `${k}:${rFields[k]}` : '')
                .filter(Boolean)
                .join(' · ');
        
            return `
                <div style="padding:12px;margin-bottom:8px;background:rgba(255,255,255,.04);
                    border:1px solid ${canCraft ? 'rgba(120,200,120,.3)' : 'rgba(255,255,255,.08)'};
                    border-radius:10px;">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                        <span style="font-size:28px;">${recipe.emoji}</span>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:14px;color:#fff;font-weight:600;">
                                ${recipe.name}
                            </div>
                            <div style="font-size:11px;color:#888;">
                                ${recipe.description || ''}
                            </div>
                        </div>
                        <span style="font-size:12px;color:#9ab0ff;">
                            → ${r.icon || '📦'} ${r.item} ×${r.count}
                        </span>
                    </div>
                    ${fieldLines ? `
                        <div style="font-size:11px;color:#7da8ff;margin-bottom:8px;">
                            ${fieldLines}
                        </div>
                    ` : ''}
                    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">
                        ${matRows}
                    </div>
                    <div style="text-align:right;">
                        <button class="cinemaworld-button ${canCraft ? 'primary' : ''}"
                            ${canCraft ? '' : 'disabled'}
                            style="padding:6px 14px;font-size:12px;
                                ${canCraft ? '' : 'opacity:.5;cursor:not-allowed;'}"
                            onclick="MapCrafting._craft('${recipe.id}')">
                            🔨 合成
                        </button>
                    </div>
                </div>
            `;
        },

        // ============================================================
        // 执行合成
        // ============================================================
        _craft(recipeId) {
            const ent = this._currentStation;
            if (!ent?.indoor?.recipes) return;
        
            const recipe = ent.indoor.recipes.find(r => r.id === recipeId);
            if (!recipe) return;
            if (!recipe.result?.item) {
                window.UIManager?.showText?.('配方数据不完整', 1500);
                return;
            }
        
            const player = window.PlayerStateManager?.player;
            if (!player) return;
        
            player.inventory = player.inventory || [];
        
            // 检查材料
            for (const m of recipe.materials) {
                const item = player.inventory.find(i => i.name === m.item);
                if (!item || (item.count || 1) < m.count) {
                    window.UIManager?.showText?.(`缺少 ${m.item} ×${m.count}`, 1500);
                    return;
                }
            }
        
            // 扣材料
            for (const m of recipe.materials) {
                const item = player.inventory.find(i => i.name === m.item);
                if (!item) continue;
                item.count -= m.count;
                if (item.count <= 0) {
                    const idx = player.inventory.indexOf(item);
                    player.inventory.splice(idx, 1);
                }
            }
        
            // ★ 加产物（用完整字段）
            const r = recipe.result;
            const existing = r.stackable
                ? player.inventory.find(i => i.name === r.item && i.stackable)
                : null;
        
            if (existing) {
                existing.count = (existing.count || 1) + r.count;
            } else {
                player.inventory.push({
                    name: r.item,
                    count: r.count,
                    icon: r.icon || recipe.emoji || '📦',
                    description: r.description || recipe.description || '',
                    fields: { ...(r.fields || {}) },       // ★ 完整字段
                    interactions: [],
                    status: '',
                    effect: r.fields?.['效果'] || '',
                    stackable: r.stackable === true,
                    maxStack: r.maxStack || null,
                    type: r.type || r.fields?.['类型'] || 'item',
                });
            }
        
            window.PlayerStateManager?.refreshAvatarArea?.();
            window.UIManager?.showText?.(
                `🔨 合成 ${recipe.name} → ${r.item} ×${r.count}`,
                2000
            );
        
            window.MapLauncher?._saveMapToWorld?.(window.MapLauncher.getMap());
            if (window.SaveManager) window.SaveManager.save();
        
            // 刷新面板
            this._render();
        },

        // ============================================================
        // 重新生成配方
        // ============================================================
        async _regenerate() {
            const ent = this._currentStation;
            if (!ent) return;

            if (!confirm('重新生成配方？当前配方会被覆盖。')) return;

            ent.indoor.recipes = [];
            await this._generateRecipes(ent);
            this._render();
        },

        close() {
            this._currentStation = null;
            window.UIManager?.closeModal?.();
        },
    };

    window.MapCrafting = MapCrafting;
    console.log('[CinemaWorld] map/crafting.js 已加载');
})();