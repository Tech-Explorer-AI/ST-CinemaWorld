// ============================================================
// CinemaWorld · main-quest.js
// 主线任务：生成 / 落地 / 应用推进
// 依赖：map-canvas.js (MapLayout), story.js, map-schema.js
// 暴露：window.MainQuestManager
// ============================================================

(function () {
    'use strict';

    const MainQuestManager = {
        _generating: false,

        // ============================================================
        // ★ 地图生成完成时的钩子（由 MapLayout.build 调用）
        // ============================================================
        async onMapBuilt(map) {
            console.log('[MainQuest] onMapBuilt 被调用, map:', map.name);
        
            // ★ 程序生成的地图，不生成/落地主线
            if (map.tags?.includes('no-mainquest')) {
                console.log(`[MainQuest] ${map.name} 标记 no-mainquest，跳过`);
                return;
            }
            if (map._source === 'program') {
                console.log(`[MainQuest] ${map.name} 是程序生成的，跳过`);
                return;
            }
        
            const ws = window.CinemaWorld?.worldState;
            if (!ws) return;
        
            const mq = ws.mainQuest;
            console.log('[MainQuest] 当前 mq:', mq);
        
            if (mq?.active && mq.target.mapName === map.name) {
                const t = mq.target;
                let landed = false;
        
                if (t.kind === 'entity' && t.entityId) {
                    landed = map.entities.some(e => e.id === t.entityId);
                } else if (t.kind === 'portal' && t.portalId) {
                    landed = map.entities.some(e => e.id === t.portalId);
                } else if (t.kind === 'cell' && t.x !== null) {
                    landed = true;
                }
        
                if (!landed) {
                    await this.landMainQuest(map);
                }
                return;
            }
        
            if (!mq || !mq.active) {
                await this.ensureInitialMainQuest(map);
                return;
            }
        },

        // ============================================================
        // ★ 生成初始主线
        // ============================================================
        async ensureInitialMainQuest(map) {
            console.log('[MainQuest] ensureInitialMainQuest 被调用, map:', map.name);
        
            if (this._generating) {
                console.log('[MainQuest] 正在生成中，跳过');
                return;
            }
        
            const ws = window.CinemaWorld.worldState;
            if (ws.mainQuest?.active) {
                console.log('[MainQuest] 已有激活主线，跳过');
                return;
            }
            if (!map) return;
        
            this._generating = true;
        
            try {
                await window.UIManager.showText('正在生成主线...', 1000);
        
                const quest = await this._generateInitialMainQuest(map);
                if (!quest) {
                    console.warn('[MainQuest] 初始主线生成失败');
                    return;
                }
        
                console.log('[MainQuest] 主线生成成功:', quest);
                await this.applyAdvance(quest);
            } finally {
                this._generating = false;
            }
        },

        // ============================================================
        // ★ 落地主线（目标地图已生成，但主线点还没落到具体位置）
        // ============================================================
        async landMainQuest(map) {
            const ws = window.CinemaWorld.worldState;
            const mq = ws.mainQuest;
            if (!mq?.active) return;

            const quest = await this._generateLanding(map, mq);
            if (!quest) {
                await this._fallbackLanding(map, mq);
                return;
            }

            await this.applyAdvance(quest);
        },

        // ============================================================
        // ★ 应用 AI 输出的【主线推进】
        // ============================================================
        async applyAdvance(advance) {
            if (!advance) return;

            const ws = window.CinemaWorld.worldState;
            const map = window.MapLauncher?.getMap?.();

            // ---------- 目标地图不是当前地图 → 只记指针 ----------
            if (!map || map.name !== advance.mapName) {
                ws.mainQuest = {
                    active: true,
                    title: advance.title,
                    hint: advance.hint,
                    target: {
                        kind: advance.kind,
                        mapName: advance.mapName,
                        regionId: advance.regionId,
                        entityId: null,
                        portalId: null,
                        x: null, y: null,
                    },
                    createdAt: Date.now(),
                    status: 'active',
                };
                await window.UIManager.showText(
                    `⭐ 主线更新：${advance.title}\n（在【${advance.mapName}】）\n${advance.hint}`,
                    3000
                );
                if (window.SaveManager) window.SaveManager.save();
                return;
            }

            // ---------- 校验 regionId ----------
            if (advance.regionId && map.regions) {
                const exists = map.regions.some(r => r.id === advance.regionId);
                if (!exists) {
                    console.warn('[MainQuest] 区域 id 不存在:', advance.regionId, '，兜底到 startRegion');
                    advance.regionId = map.startRegion;
                }
            }

            // ---------- 落点 1：格子 ----------
            if (advance.kind === 'cell') {
                let rect = map._generated?.placements?.[advance.regionId];
                if (!rect) {
                    rect = map._generated?.placements?.[map.startRegion];
                    console.warn('[MainQuest] 区域不存在，兜底到 startRegion');
                }
                if (!rect) {
                    console.warn('[MainQuest] 落地失败：没有可用区域');
                    return;
                }
                const anchor = window.MapLayout._anchorToXY(advance.position || 'center', rect);
                ws.mainQuest = {
                    active: true,
                    title: advance.title,
                    hint: advance.hint,
                    target: {
                        kind: 'cell',
                        mapName: map.name,
                        regionId: advance.regionId,
                        x: anchor.x,
                        y: anchor.y,
                        entityId: null,
                        portalId: null,
                    },
                    createdAt: Date.now(),
                    status: 'active',
                };
            }

            // ---------- 落点 2：实体 ----------
            else if (advance.kind === 'entity') {
                let ent = map.entities.find(e => e.name === advance.entityName);
                if (!ent) {
                    ent = this._createMarkerEntity(map, advance);
                    map.entities.push(ent);
                }
                ws.mainQuest = {
                    active: true,
                    title: advance.title,
                    hint: advance.hint,
                    target: {
                        kind: 'entity',
                        mapName: map.name,
                        regionId: advance.regionId,
                        entityId: ent.id,
                        portalId: null,
                        x: null, y: null,
                    },
                    createdAt: Date.now(),
                    status: 'active',
                };
            }

            // ---------- 落点 3：出入口 ----------
            else if (advance.kind === 'portal') {
                let portal = map.entities.find(e =>
                    e.kind === 'portal' && e.name === advance.portalName
                );
                if (!portal) {
                    portal = this._createPortal(map, advance);
                    map.entities.push(portal);
                }
                ws.mainQuest = {
                    active: true,
                    title: advance.title,
                    hint: advance.hint,
                    target: {
                        kind: 'portal',
                        mapName: advance.targetMap || map.name,   // ★ 优先用目标地图
                        regionId: advance.regionId,
                        entityId: null,
                        portalId: portal.id,
                        x: null, y: null,
                    },
                    createdAt: Date.now(),
                    status: 'active',
                };
            }

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            window.MapLauncher?._saveMapToWorld?.(map);
            window.CWNotify3D?.('all');
            await window.UIManager.showText(
                `⭐ 主线更新：${advance.title}\n${advance.hint}`,
                3000
            );
            if (window.SaveManager) window.SaveManager.save();
        },

        // ============================================================
        // 内部：AI 生成初始主线
        // ============================================================
        async _generateInitialMainQuest(map) {
            const ws = window.CinemaWorld.worldState;
            const player = window.PlayerStateManager.player;

            const worldCtx = [];
            if (ws.worldHistory?.summary) {
                worldCtx.push(`【世界史】${ws.worldHistory.summary}`);
            }
            if (window.StoryManager) {
                const ctx = window.StoryManager.buildContext(null, {
                    parentStory: false, mainChars: false, scene: false,
                    interactionDigests: false, volumes: false,
                    chapters: false, pendingEvents: false,
                });
                if (ctx) worldCtx.push(ctx);
            }

            const regionList = (map.regions || [])
                .map(r => `- ${r.id}(${r.name})`)
                .join('\n');

            const prompt = `你正在为一个视觉小说游戏生成"开局主线任务"。

【世界与玩家上下文】
${worldCtx.join('\n\n') || '（全新世界）'}

【当前地图】
名称: ${map.name}
${map.description ? `描述: ${map.description}` : ''}
区域列表（★ 输出【主线推进】时必须使用以下 id，不要翻译，不要自己编）:
${regionList}

【玩家】
名字: ${player.name || '主人公'}
${player.profile || '（无特别设定）'}

【任务】
生成一个合适的开局主线任务。它应该：
- 简单、明确、容易理解
- 能引导玩家熟悉这个世界和地图
- 有继续发展的空间
- 符合世界的氛围

【输出格式】（严格遵守）
【主线推进】
目标: (一句话任务名)
提示: (一句话提示玩家去哪儿)
落点: 格子 或 实体 或 出入口
地图: ${map.name}
区域: (★ 必须从上面的区域列表里选 id)
位置: (落点=格子时填锚点名)
实体名: (落点=实体时填)
实体图标: (落点=实体时填 emoji)
实体描述: (落点=实体时填)
出入口名: (落点=出入口时填)
出入口描述: (落点=出入口时填)
目标地图: (落点=出入口时填)

请开始生成：
`;

            const result = await window.generateFunctionalReply(prompt, 'initial-main-quest');
            if (!result) return null;

            const mqMatch = result.match(/【主线推进】([\s\S]*?)(?=【|$)/);
            if (!mqMatch) return null;

            return window.StoryManager._parseMainQuestAdvance(mqMatch[1]);
        },

        // ============================================================
        // 内部：AI 生成跨地图落点
        // ============================================================
        async _generateLanding(map, mq) {
            const regionList = (map.regions || [])
                .map(r => `- ${r.id}(${r.name})`)
                .join('\n');

            const prompt = `你正在为视觉小说游戏落地一个主线任务。

【主线任务】
标题: ${mq.title}
提示: ${mq.hint}

【目标地图】
名称: ${map.name}
${map.description ? `描述: ${map.description}` : ''}
区域列表（★ 必须使用以下 id）:
${regionList}

【任务】
为这个主线任务在这张地图上选一个落点。

【输出格式】
【主线推进】
目标: ${mq.title}
提示: ${mq.hint}
落点: 格子 或 实体 或 出入口
地图: ${map.name}
区域: (★ 必须用区域列表里的 id)
位置: (落点=格子时填锚点名)
实体名: (落点=实体时填)
实体图标: (落点=实体时填 emoji)
实体描述: (落点=实体时填)
出入口名: (落点=出入口时填)
出入口描述: (落点=出入口时填)
目标地图: (落点=出入口时填)

请开始生成：
`;

            const result = await window.generateFunctionalReply(prompt, 'main-quest-landing');
            if (!result) return null;

            const mqMatch = result.match(/【主线推进】([\s\S]*?)(?=【|$)/);
            if (!mqMatch) return null;

            return window.StoryManager._parseMainQuestAdvance(mqMatch[1]);
        },

        // ============================================================
        // 内部：兜底落地
        // ============================================================
        async _fallbackLanding(map, mq) {
            const region = map.regions?.[0];
            if (!region) return;
            const rect = map._generated?.placements?.[region.id];
            if (!rect) return;

            const anchor = window.MapLayout._anchorToXY('center', rect);
            window.CinemaWorld.worldState.mainQuest.target = {
                kind: 'cell',
                mapName: map.name,
                regionId: region.id,
                x: anchor.x,
                y: anchor.y,
                entityId: null,
                portalId: null,
            };

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            console.log('[MainQuest] 兜底落地到', region.id, anchor);
        },

        // ============================================================
        // 内部：创建 marker 实体
        // ============================================================
        _createMarkerEntity(map, advance) {
            const regionId = advance.regionId || map.startRegion;
            const regionExists = map.regions?.some(r => r.id === regionId);

            const ent = {
                id: `ent_mq_${Date.now()}`,
                name: advance.entityName,
                emoji: advance.entityIcon || '📌',
                kind: 'marker',
                region: regionExists ? regionId : map.startRegion,
                position: 'center',
                blocking: false,
                isPlayer: false,
                tags: ['主线'],
                description: advance.entityDesc || '',
                meta: {}, status: '', effect: '',
                fields: {}, interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1, countMode: 'single',
                stackable: false, maxStack: null,
                type: 'marker',
            };
            const used = new Set(
                map.entities.filter(e => e._placed).map(e => `${e.x},${e.y}`)
            );
            const pos = window.MapLayout._resolvePosition(
                ent, map._generated.grid, map._generated.placements, used
            );
            if (pos) { ent.x = pos.x; ent.y = pos.y; ent._placed = true; }
            return ent;
        },
        // ============================================================
        // ★ 生成新地图（供【生成地图】块调用）
        // ============================================================
        async generateNewMap(req) {
            if (!req || !req.name) return null;

            const ws = window.CinemaWorld.worldState;

            // 已经存在 → 不重复生成
            if (ws.maps?.[req.name]) {
                console.log('[MainQuest] 地图已存在:', req.name);
                return ws.maps[req.name];
            }

            await window.UIManager.showText(`正在生成【${req.name}】...`, 1500);

            try {
                const currentMap = window.MapLauncher?.getMap?.();

                // 组装 guide
                const guide = [
                    req.reference || '',
                    req.description ? `地图描述：${req.description}` : '',
                    `这是玩家即将前往的新地图，承接当前剧情。`,
                    currentMap ? `玩家从【${currentMap.name}】进入。` : '',
                ].filter(Boolean).join('\n');

                // 调 MapGenerator 生成地图规则
                const newMap = await window.MapGenerator.generate({
                    guide,
                    sceneName: req.name,
                    sceneDesc: req.description || '',
                });

                if (!newMap) {
                    console.warn('[MainQuest] 新地图生成失败');
                    return null;
                }

                // 强制地图名
                newMap.name = req.name;
                newMap.id = `map_${req.name}`;

                // 构建地图网格
                window.MapLayout.build(newMap);

                // 写入世界仓库
                ws.maps = ws.maps || {};
                ws.maps[req.name] = window.MapSchema.serialize(newMap);

                // ★ 注入反向 portal（让玩家能回来）
                if (currentMap) {
                    this._injectReturnPortal(newMap, currentMap, req.name);
                }

                console.log('[MainQuest] 新地图生成完成:', req.name);
                if (window.SaveManager) window.SaveManager.save();
                return newMap;

            } catch (e) {
                console.error('[MainQuest] 生成新地图失败:', e);
                return null;
            }
        },
        // ============================================================
        // ★ 在新地图上注入返回 portal
        // ============================================================
        _injectReturnPortal(newMap, currentMap, newMapName) {
            if (!newMap.entities) newMap.entities = [];

            // 检查是否已存在
            const exists = newMap.entities.some(e =>
                e.kind === 'portal' &&
                e.fields?.['目标'] === currentMap.name
            );
            if (exists) return;

            // 找进入区域（用 startRegion 兜底）
            const enterRegionId = newMap.startRegion || newMap.regions?.[0]?.id;
            if (!enterRegionId) return;

            const returnPortal = {
                id: `portal_back_${Date.now()}`,
                name: `返回${currentMap.name}`,
                emoji: '🔙',
                kind: 'portal',
                region: enterRegionId,
                position: 'entrance',
                blocking: false,
                isPlayer: false,
                tags: ['返回'],
                description: `回到【${currentMap.name}】`,
                meta: {}, status: '', effect: '',
                fields: {
                    '目标类型': 'map',
                    '目标': currentMap.name,
                    '目标区域': 'entrance',
                    '目标锚点': 'entrance',
                    '方向': 'both',
                    '提示': `回到【${currentMap.name}】`,
                },
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1, countMode: 'single',
                stackable: false, maxStack: null,
                type: 'portal',
            };

            // 摆放
            const used = new Set(
                newMap.entities.filter(e => e._placed).map(e => `${e.x},${e.y}`)
            );
            const pos = window.MapLayout._resolvePosition(
                returnPortal, newMap._generated.grid, newMap._generated.placements, used
            );
            if (pos) {
                returnPortal.x = pos.x;
                returnPortal.y = pos.y;
                returnPortal._placed = true;
            }

            newMap.entities.push(returnPortal);
            console.log('[MainQuest] 已在新地图注入返回 portal →', currentMap.name);
        },
        // ============================================================
        // 内部：创建 portal
        // ============================================================
        _createPortal(map, advance) {
            const regionId = advance.regionId || map.startRegion;
            const regionExists = map.regions?.some(r => r.id === regionId);

            const portal = {
                id: `portal_mq_${Date.now()}`,
                name: advance.portalName,
                emoji: '🚪',
                kind: 'portal',
                region: regionExists ? regionId : map.startRegion,
                position: 'edge',
                blocking: false,
                isPlayer: false,
                tags: ['主线'],
                description: advance.portalDesc || '',
                meta: {}, status: '', effect: '',
                fields: {
                    '目标类型': advance.targetMap ? 'map' : 'region',
                    '目标': advance.targetMap || advance.regionId,
                    '目标区域': 'entrance',
                    '目标锚点': 'entrance',
                    '方向': 'both',
                    '提示': advance.hint,
                },
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1, countMode: 'single',
                stackable: false, maxStack: null,
                type: 'portal',
            };
            const used = new Set(
                map.entities.filter(e => e._placed).map(e => `${e.x},${e.y}`)
            );
            const pos = window.MapLayout._resolvePosition(
                portal, map._generated.grid, map._generated.placements, used
            );
            if (pos) { portal.x = pos.x; portal.y = pos.y; portal._placed = true; }
            return portal;
        },
    };

    window.MainQuestManager = MainQuestManager;
    console.log('[CinemaWorld] main-quest.js 已加载');
})();