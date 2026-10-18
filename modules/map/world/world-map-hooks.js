// ============================================================
// CinemaWorld · world-map-hooks.js
// 粘合层：劫持现有流程，接入世界地图网
//   - MapLayout.build：build 后处理 exits
//   - MapInteract.enterPortal：走向未知方向时生成新地图
//   - MapGenerator.generate：注入世界上下文
// 依赖：WorldDirection + WorldGraph + WorldExits
// 暴露：window.WorldMapHooks
// ============================================================

(function () {
    'use strict';

    if (window.WorldMapHooks) return;

    const DIR = () => window.WorldDirection;
    const GRAPH = () => window.WorldGraph;
    const EXITS = () => window.WorldExits;

    const WorldMapHooks = {
        _installed: false,

        // ============================================================
        // 安装
        // ============================================================
        install() {
            if (this._installed) return;

            // 等各模块就绪
            let tries = 0;
            const wait = setInterval(() => {
                if (window.MapLayout && window.MapInteract && window.WorldDirection) {
                    clearInterval(wait);
                    this._installHooks();
                    this._installed = true;
                    console.log('[WorldMapHooks] 已安装');
                } else if (++tries > 100) {
                    clearInterval(wait);
                    console.warn('[WorldMapHooks] 等待依赖超时');
                }
            }, 50);
        },

        _installHooks() {
            this._hookMapLayout();
            this._hookEnterPortal();
            this._hookMapGenerator();
            this._hookMapLauncher();
        },

        // ============================================================
        // 1. 劫持 MapLayout.build
        //    build 完之后：
        //      - 保底：如果有"从哪来"的上下文 → 添加入口
        //      - 落点：把 exits 变成 portal 实体
        //      - 记录：写入世界网
        // ============================================================
        _hookMapLayout() {
            const ML = window.MapLayout;
            const originalBuild = ML.build.bind(ML);

            ML.build = async function (map) {
                // 先跑原逻辑
                const result = await originalBuild(map);

                try {
                    await WorldMapHooks._afterMapBuilt(map);
                } catch (e) {
                    console.error('[WorldMapHooks] _afterMapBuilt 失败:', e);
                }

                return result;
            };
        },

        async _afterMapBuilt(map) {
            if (!map) return;

            // ---------- 1. 保底：从哪来 ----------
            const pending = map._pendingEntry;

            if (pending && pending.fromDir && pending.fromMap) {
                // 新生成的地图，有明确来处
                EXITS().ensureEntryExit(map, pending.fromDir, pending.fromMap);
                delete map._pendingEntry;
            } else {
                // ★ 没有明确来处：也要确保有出口
                this._ensureExitFallback(map);
            }

            // ---------- 2. 规范化 exits（AI 可能写了各种方向名）----------
            this._normalizeExits(map);

            if (map.heightMap) {
                this._applyHeightToGrid(map);
            }

            // ---------- 3. 落点到网格 ----------
            EXITS().placeExitsOnGrid(map);

            // ---------- 4. 写入世界网 ----------
            this._syncToGraph(map);
            window.WorldCoord?.register?.(map.name);
            // ---------- 5. 保存 ----------
            window.MapLauncher?._saveMapToWorld?.(map);
        },
        // ============================================================
        // ★ 没有明确来处时，也确保有出口
        //   - 如果 map.exits 为空 → 补南北两个方向
        //   - 如果 map.exits 只有一个 → 补反方向
        // ============================================================
        _ensureExitFallback(map) {
            if (!map) return;

            map.exits = map.exits || {};
            const dirs = Object.keys(map.exits);

            // ---------- 情况 1：完全没出入口 ----------
            if (dirs.length === 0) {
                // 补南北（默认）
                map.exits['north'] = {
                    kind: '道路',
                    label: '北门',
                    target: null,
                    isFallback: true,
                };
                map.exits['south'] = {
                    kind: '道路',
                    label: '南门',
                    target: null,
                    isFallback: true,
                };
                // ★ 补完后重新落点
                if (window.WorldExits?.placeExitsOnGrid) {
                    window.WorldExits.placeExitsOnGrid(map);
                }
                console.log(`[WorldMapHooks] ${map.name} 无出入口，兜底补南北门`);
                return;
            }

            // ---------- 情况 2：只有一个出入口 ----------
            if (dirs.length === 1) {
                const only = dirs[0];
                const mirror = DIR().opposite(only);
                if (mirror && !map.exits[mirror]) {
                    map.exits[mirror] = {
                        kind: '道路',
                        label: `${DIR().cn(mirror)}门`,
                        target: null,
                        isFallback: true,
                    };
                    console.log(`[WorldMapHooks] ${map.name} 只有 ${only}，兜底补 ${mirror}`);
                }
            }
        },
        _applyHeightToGrid(map) {
            const grid = map._generated?.grid;
            if (!grid) return;

            const base = map.heightMap?._base ?? 0;

            // 1. 默认全部 base
            for (const row of grid) {
                for (const cell of row) {
                    cell.height = base;
                }
            }

            // 2. 区域级高度覆盖
            for (const region of map.regions || []) {
                if (!region.heightRef) continue;
                const h = map.heightMap[region.heightRef];
                if (typeof h !== 'number') continue;

                const rect = map._generated?.placements?.[region.id];
                if (!rect) continue;

                for (let y = rect.y; y < rect.y + rect.h; y++) {
                    for (let x = rect.x; x < rect.x + rect.w; x++) {
                        const cell = grid[y]?.[x];
                        if (cell) cell.height = h;
                    }
                }
            }

            // 3. ★★★ 道路坡道化 ★★★
            if (typeof window.MapLayout?._flattenRoads === 'function') {
                try {
                    window.MapLayout._flattenRoads(grid);
                } catch (e) {
                    console.error('[WorldMapHooks] 道路坡道化失败:', e);
                }
            }

            // 统计
            const count = {};
            for (const row of grid) {
                for (const cell of row) {
                    const h = cell.height ?? 0;
                    count[h] = (count[h] || 0) + 1;
                }
            }
            console.log(`[WorldMapHooks] ${map.name} 高度分布:`, count);
        },
        _normalizeExits(map) {
            if (!map.exits) {
                map.exits = {};
                return;
            }

            const normalized = {};
            for (const [rawDir, info] of Object.entries(map.exits)) {
                const d = DIR().normalize(rawDir);
                if (!d) {
                    console.warn(`[WorldMapHooks] 未知方向: ${rawDir}`);
                    continue;
                }
                normalized[d] = {
                    kind: info.kind || 'road',
                    label: info.label || `${DIR().cn(d)}门`,
                    target: info.target || null,
                };
            }
            map.exits = normalized;
        },

        _syncToGraph(map) {
            if (!map?.exits) return;

            GRAPH().ensure(map.name);

            for (const [dir, info] of Object.entries(map.exits)) {
                if (!info.target) continue;
                const result = GRAPH().connect(map.name, dir, info.target, {
                    kind: info.kind,
                    label: info.label,
                });
                if (!result.ok) {
                    console.warn(`[WorldMapHooks] 连接失败:`, result.message || result.reason);
                }
            }
        },

        // ============================================================
        // 2. 劫持 MapInteract.enterPortal
        //    从"走向未知"变成"生成新地图并连接"
        // ============================================================
        _hookEnterPortal() {
            const MI = window.MapInteract;
            const originalEnterPortal = MI.enterPortal.bind(MI);

            MI.enterPortal = async function (entityId) {
                const map = window.MapLauncher?.getMap?.();
                const portal = map?.entities?.find(e => e.id === entityId);
                if (!portal) return originalEnterPortal(entityId);

                // ★ 用多种标识判断（避免存档丢 _systemExit）
                const isWorldExit = portal._systemExit === true
                    || portal.meta?.worldExit === true
                    || portal.tags?.includes('世界出入口');

                if (!isWorldExit) {
                    return originalEnterPortal(entityId);
                }

                // 已有目标 → 走原有跳转
                const target = portal.fields?.['目标'];
                if (target) {
                    return originalEnterPortal(entityId);
                }

                // 未探索 → 生成新地图
                return WorldMapHooks._exploreUnknown(map, portal);
            };
        },

        // ============================================================
        // 走向未知方向 → 生成新地图 → 连接 → 进入
        // ============================================================
        // ============================================================
        // 走向未知方向 → 生成新地图 → 预览确认 → 连接 → 进入
        // ============================================================
        async _exploreUnknown(currentMap, portal) {
            const dir = portal.meta?.direction;
            if (!dir) {
                window.UIManager?.showText?.('这个方向走不通', 1500);
                return;
            }

            const cn = DIR().cn(dir);

            // ---------- 1. 确认 + 玩家指定内容 ----------
            const confirmResult = await WorldMapHooks._confirmExplore(currentMap, portal, dir);
            if (!confirmResult.ok) return;

            const playerGuide = confirmResult.guide || '';

            // ---------- 2. 循环：生成 → 预览 → 确认/重生成 ----------
            let newMap = null;
            while (true) {
                // 显示生成中
                window.MapLauncher?._openSubPanel?.(`
            <div class="cinemaworld-modal-title" style="font-size:22px;">
                🗺️ 探索${cn}方
            </div>
            <div style="text-align:center;padding:40px 20px;">
                <div style="font-size:56px;margin-bottom:16px;">⏳</div>
                <div style="color:#aaa;font-size:14px;">正在生成地图...</div>
                <div style="font-size:11px;color:#666;margin-top:12px;">
                    ${playerGuide ? `目标：${playerGuide}` : 'AI 正在自由发挥'}
                </div>
            </div>
        `);

                newMap = await WorldMapHooks._generateNeighborMap(
                    currentMap, portal, dir, playerGuide
                );

                if (!newMap) {
                    window.UIManager?.showText?.('❌ 生成失败', 2000);
                    return;
                }

                // 预览
                const previewResult = await WorldMapHooks._showMapPreview(newMap);

                if (previewResult === true) break;         // 确认
                if (previewResult === 'regen') continue;   // 重新生成
                return;                                     // 取消
            }

            // ---------- 3. 建立双向连接 ----------
            const conn = GRAPH().connect(currentMap.name, dir, newMap.name, {
                kind: portal.fields?.['类型'] || 'road',
                label: portal.name,
            });
            if (!conn.ok) {
                console.error('[WorldMapHooks] 连接失败:', conn);
                window.UIManager?.showText?.(`连接失败: ${conn.message || conn.reason}`, 2500);
                return;
            }

            // ---------- 4. 同步更新 currentMap.exits ----------
            currentMap.exits = currentMap.exits || {};
            currentMap.exits[dir] = currentMap.exits[dir] || {};
            currentMap.exits[dir].target = newMap.name;
            currentMap.exits[dir].kind = portal.fields?.['类型'] || '道路';
            currentMap.exits[dir].label = portal.name;
            delete currentMap.exits[dir].isMirror;
            delete currentMap.exits[dir].isFallback;

            // ---------- 5. 同步更新 portal 自身 + 所在格子 ----------
            portal.fields = portal.fields || {};
            portal.fields['目标'] = newMap.name;
            portal.fields['目标类型'] = 'map';
            portal.fields['提示'] = `前往【${newMap.name}】`;
            portal.description = `通向【${newMap.name}】`;

            portal.tags = Array.isArray(portal.tags) ? portal.tags : [];
            portal.tags = portal.tags.filter(t => !/^目标[:：]/.test(t));
            portal.tags.push(`目标:${newMap.name}`);

            const grid = currentMap._generated?.grid;
            if (grid && typeof portal.x === 'number' && typeof portal.y === 'number') {
                const cell = grid[portal.y]?.[portal.x];
                if (cell?.portal) {
                    cell.portal.mapName = newMap.name;
                    cell.portal.label = portal.name;
                }
            }

            // ---------- 6. 挂 _pendingEntry，build 新地图 ----------
            newMap._pendingEntry = {
                fromDir: DIR().opposite(dir),
                fromMap: currentMap.name,
            };

            await window.MapLayout.build(newMap);

            // ---------- 7. 写入世界仓库 ----------
            window.MapLauncher._saveMapToWorld(currentMap);
            window.MapLauncher.registerMap(newMap);

            // ---------- 8. 进入新地图 ----------
            await WorldMapHooks._enterMap(newMap, DIR().opposite(dir));

            window.UIManager?.showText?.(`🗺️ 进入【${newMap.name}】`, 2000);
            if (window.SaveManager) window.SaveManager.save();
        },
        // ============================================================
        // 显示 AI 生成结果，让玩家预览/编辑/确认
        //   返回:
        //     true    → 玩家确认进入
        //     'regen' → 玩家要求重新生成
        //     false   → 玩家取消
        // ============================================================
        _showMapPreview(newMap) {
            return new Promise((resolve) => {
                const rawText = newMap._rawText || '';

                const html = `
            <div class="cinemaworld-modal-title" style="font-size:22px;">
                🗺️ 生成完成：${WorldMapHooks._escapeHTML(newMap.name)}
            </div>
            <div style="font-size:12px;color:#888;margin-bottom:10px;text-align:center;">
                你可以查看和编辑 AI 生成的地图规则，然后决定是否进入。
            </div>

            <div style="margin-bottom:12px;">
                <textarea id="cw-map-preview-text"
                    style="width:100%;box-sizing:border-box;min-height:340px;
                        font-family:monospace;font-size:12px;padding:12px;
                        background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                        border-radius:8px;color:#ccc;resize:vertical;"
                >${WorldMapHooks._escapeHTML(rawText)}</textarea>
            </div>

            <div style="text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                <button class="cinemaworld-button primary" id="cw-explore-enter">
                    ✅ 进入地图
                </button>
                <button class="cinemaworld-button" id="cw-explore-regen">
                    🔄 重新生成
                </button>
                <button class="cinemaworld-button" id="cw-explore-cancel2">
                    ❌ 取消
                </button>
            </div>
        `;

                window.MapLauncher?._openSubPanel?.(html);

                // ---------- ✅ 进入：解析 textarea → 覆盖 newMap ----------
                document.getElementById('cw-explore-enter').onclick = () => {
                    const text = document.getElementById('cw-map-preview-text').value;

                    try {
                        const parsed = window.MapParser.parse(text);
                        if (!parsed) {
                            window.UIManager?.showText?.('❌ 解析失败，请检查格式', 2000);
                            return;
                        }

                        const editedMap = window.MapSchema.normalize(parsed);
                        if (!editedMap) {
                            window.UIManager?.showText?.('❌ 归一化失败', 2000);
                            return;
                        }

                        // ★ 保留原地图名（防止 AI 把名字改了）
                        editedMap.name = newMap.name;
                        editedMap.id = newMap.id;

                        // ★ 保留原始文本，后续查看/调试用
                        editedMap._rawText = text;

                        // ★ 覆盖 newMap（保留对象引用，因为调用方持有它）
                        //   先清掉新 map 的所有键，再赋新的
                        for (const key of Object.keys(newMap)) {
                            delete newMap[key];
                        }
                        Object.assign(newMap, editedMap);

                        window.MapLauncher?._closeSubPanel?.();
                        resolve(true);

                    } catch (e) {
                        console.error('[WorldMapHooks] 解析编辑后的地图失败:', e);
                        window.UIManager?.showText?.('❌ 解析失败: ' + e.message, 2500);
                    }
                };

                // ---------- 🔄 重新生成 ----------
                document.getElementById('cw-explore-regen').onclick = () => {
                    if (!confirm('确定重新生成？当前编辑将被丢弃。')) return;
                    window.MapLauncher?._closeSubPanel?.();
                    resolve('regen');
                };

                // ---------- ❌ 取消 ----------
                document.getElementById('cw-explore-cancel2').onclick = () => {
                    window.MapLauncher?._closeSubPanel?.();
                    resolve(false);
                };
            });
        },
        // ============================================================
        // HTML 转义（用于 textarea 内容）
        // ============================================================
        _escapeHTML(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
        // world-map-hooks.js

        // ============================================================
        // 走向未知方向前的确认框（带"指定内容"输入框）
        // ============================================================
        _confirmExplore(currentMap, portal, dir) {
            return new Promise((resolve) => {
                const cn = DIR().cn(dir);
                const html = `
            <div class="cinemaworld-modal-title" style="font-size:22px;">
                ${portal.emoji} ${portal.name}
            </div>
            <div style="text-align:center;padding:16px;color:#aaa;font-size:14px;
                line-height:1.8;">
                你站在【${currentMap.name}】的${cn}边。<br>
                ${portal.description || ''}
            </div>
            <div style="text-align:center;font-size:12px;color:#888;
                padding:10px;background:rgba(120,150,255,.06);
                border-radius:8px;margin-bottom:14px;">
                这一方向还未探索。<br>
                走过去会生成一张新的地图。
            </div>

            <!-- ★ 玩家指定内容 -->
            <div style="margin-bottom:14px;">
                <div style="font-size:13px;color:#aaa;margin-bottom:6px;">
                    你想去什么样的地方？（可选）
                </div>
                <textarea class="cinemaworld-textarea" id="cw-explore-guide"
                    placeholder="例如：&#10;- 学院的图书馆&#10;- 一个被遗弃的温室&#10;- 通往城镇的官道&#10;（留空则完全由 AI 自由发挥）"
                    style="min-height:100px;width:100%;box-sizing:border-box;"></textarea>
            </div>

            <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                <button class="cinemaworld-button primary" id="cw-explore-go">
                    走${cn}边
                </button>
                <button class="cinemaworld-button" id="cw-explore-cancel">
                    留下
                </button>
            </div>
        `;

                window.MapLauncher?._openSubPanel?.(html);

                document.getElementById('cw-explore-go').onclick = () => {
                    const guide = document.getElementById('cw-explore-guide')?.value.trim() || '';
                    window.MapLauncher?._closeSubPanel?.();
                    resolve({ ok: true, guide });
                };
                document.getElementById('cw-explore-cancel').onclick = () => {
                    window.MapLauncher?._closeSubPanel?.();
                    resolve({ ok: false, guide: '' });
                };
            });
        },

        // ============================================================
        // 生成邻居地图（纯生成，不 build，不预览，不写世界）
        //   playerGuide: 玩家在确认框里填的目标描述
        // ============================================================
        async _generateNeighborMap(currentMap, portal, exitDir, playerGuide = '') {
            const cn = DIR().cn(exitDir);
            const entryDir = DIR().opposite(exitDir);
            const entryCn = DIR().cn(entryDir);

            try {
                // ---------- 组装 guide ----------
                const guideLines = [
                    `玩家从【${currentMap.name}】的${cn}方向走出去。`,
                    portal.description ? `出入口描述：${portal.description}` : '',
                    playerGuide ? `★ 玩家希望这里是：${playerGuide}` : '',
                    `★ 这张新地图必须有【${entryCn}门】，通向【${currentMap.name}】。`,
                    `★ 世界方向规则：${cn} ↔ ${entryCn}`,
                ].filter(Boolean);

                // ---------- 调 AI ----------
                const newMap = await window.MapGenerator.generate({
                    guide: guideLines.join('\n'),
                    sceneName: null,
                    sceneDesc: portal.description || '',
                    fromMap: currentMap.name,
                    fromDir: exitDir,
                });

                if (!newMap) return null;

                // ============================================================
                // ★ 强制改名：防止同名冲突
                // ============================================================
                const ws = window.CinemaWorld?.worldState;
                let finalName = newMap.name || '未知区域';

                // 1. 和当前来源地图同名 → 加方向后缀
                if (finalName === currentMap.name) {
                    finalName = `${finalName}·${cn}郊`;
                    console.warn(`[WorldMapHooks] 新地图与来源同名，改名: ${finalName}`);
                }

                // 2. 和已有地图同名 → 加序号
                if (ws?.maps?.[finalName]) {
                    let i = 2;
                    const baseName = finalName;
                    while (ws.maps[`${baseName}(${i})`]) i++;
                    finalName = `${baseName}(${i})`;
                    console.warn(`[WorldMapHooks] 新地图名字冲突，改名: ${finalName}`);
                }

                newMap.name = finalName;
                newMap.id = `map_${finalName}`;

                return newMap;

            } catch (e) {
                console.error('[WorldMapHooks] 生成邻居地图失败:', e);
                return null;
            }
        },

        // ============================================================
        // 进入地图 + 玩家落点
        // ============================================================
        async _enterMap(map, entryDir) {
            const currentMap = window.MapLauncher?.getMap?.();

            // 存当前地图
            if (currentMap) window.MapLauncher._saveMapToWorld(currentMap);

            // 切换
            window.UIManager?.closeModal?.();
            if (window.MapCanvas?.canvas) window.MapCanvas.destroy();

            window.MapLauncher._map = map;

            // 挂起 pendingEntry，让渲染时落点用
            map._entryPoint = EXITS().getEntryPoint(map, entryDir);

            window.MapLauncher._renderMapWindow();

            // 玩家落点
            setTimeout(() => {
                const player = window.MapCanvas?.player;
                if (!player) return;
                const p = map._entryPoint;
                if (p) {
                    player.x = p.x;
                    player.y = p.y;
                    window.MapCanvas._centerCameraOnPlayer(true);
                }
                delete map._entryPoint;
            }, 100);
        },

        // ============================================================
        // 3. 劫持 MapGenerator.generate
        //    生成前注入世界上下文
        // ============================================================
        _hookMapGenerator() {
            const MG = window.MapGenerator;
            const originalGenerate = MG.generate.bind(MG);

            MG.generate = async function (options = {}) {
                // ★ 不再手动拼 guide，让 _buildContext 处理
                return originalGenerate(options);
            };
        },

        // ============================================================
        // 4. 劫持 MapLauncher（旧存档迁移 + 关闭时保存图）
        // ============================================================
        _hookMapLauncher() {
            const ML = window.MapLauncher;
            if (!ML) return;

            // 首次打开地图时，从旧存档重建世界网
            const originalOpen = ML.open.bind(ML);
            ML.open = async function (options = {}) {
                WorldMapHooks._ensureGraphFromSave();
                return originalOpen(options);
            };
        },

        _ensureGraphFromSave() {
            const ws = window.CinemaWorld?.worldState;
            if (!ws) return;
            if (ws._worldGraphMigrated) return;

            const graph = GRAPH();
            const isEmpty = graph.list().length === 0;

            if (isEmpty && ws.maps && Object.keys(ws.maps).length > 0) {
                console.log('[WorldMapHooks] 检测到旧存档，重建世界网');
                graph.rebuildFromMaps();
            }

            ws._worldGraphMigrated = true;
        },

        // ============================================================
        // 手动 API
        // ============================================================

        // 在当前地图上添加一个新出入口
        async addExitToCurrent(dir, options = {}) {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return { ok: false };

            const result = EXITS().createExit(map, dir, options.target || null, options);
            if (!result.ok) return result;

            // 重新落点
            EXITS().placeExitsOnGrid(map);

            // 同步到 graph
            if (result.exit.target) {
                GRAPH().connect(map.name, dir, result.exit.target, {
                    kind: result.exit.kind,
                    label: result.exit.label,
                });
            }

            window.MapLauncher._saveMapToWorld(map);
            window.CWNotify3D?.('all');
            return result;
        },

        // 从当前地图移除某个方向的出入口
        removeExitFromCurrent(dir) {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;

            GRAPH().disconnect(map.name, dir);
            EXITS().removeExit(map, dir);
            window.MapLauncher._saveMapToWorld(map);
            window.CWNotify3D?.('all');
        },

        // 一致性校验
        validate() {
            return GRAPH().validate();
        },
    };

    window.WorldMapHooks = WorldMapHooks;

    // 自动安装
    function boot() {
        WorldMapHooks.install();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld] world-map-hooks.js 已加载');
})();