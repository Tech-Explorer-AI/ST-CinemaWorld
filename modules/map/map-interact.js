// ============================================================
// CinemaWorld · map-interact.js
// 地图实体交互：对话 / 使用 / 战斗入口 / 出入口
// 依赖：map-canvas.js, map-entities.js, interact.js, story.js
// 暴露：window.MapInteract
// ============================================================

(function () {
    'use strict';

    const MapInteract = {
        isGenerating: false,

        // ============================================================
        // 1. 对话（NPC）
        // ============================================================
        async talkTo(entityId) {
            const map = window.MapLauncher?.getMap?.();
            const ent = map?.entities?.find(e => e.id === entityId);
            if (!ent) return;

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">💬 与 ${ent.name} 对话</div>
                <div style="margin-bottom:15px;color:#aaa;font-size:13px;
                    padding:10px;background:rgba(0,0,0,.2);border-radius:8px;">
                    ${ent.description || ''}
                </div>
                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                        你想说什么 / 做什么？
                    </div>
                    <textarea class="cinemaworld-textarea" id="cw-map-interact-input"
                        placeholder="例如：'你好，我是路过这里的旅人。'&#10;（留空则由对方主动开口）"
                        style="min-height:120px;"></textarea>
                </div>
                <div style="text-align:center;">
                    <button class="cinemaworld-button primary"
                        onclick="MapInteract._doTalk('${entityId}')">
                        💬 开始对话
                    </button>
                    <button class="cinemaworld-button"
                        onclick="MapEntityPanel.openDetail('${entityId}')">返回</button>
                </div>`;
            if (window.MapQuestManager) {
                window.MapQuestManager.onEntityInteracted(ent);
            }
        },

        async _doTalk(entityId) {
            if (this.isGenerating) return;
            this.isGenerating = true;

            try {
                const map = window.MapLauncher?.getMap?.();
                const ent = map?.entities?.find(e => e.id === entityId);
                if (!ent) {
                    window.MapLauncher?._closeSubPanel?.();
                    return;
                }

                const input = document.getElementById('cw-map-interact-input')?.value.trim() || '';
                const action = input || '（玩家没有特别说什么，请基于当前环境自然地展开一段简短的对话）';

                const chapterId = window.StoryManager?.currentChapter?.id || null;
                const region = map.regions.find(r => r.id === ent.region);

                const contextParts = this._buildContextParts(map, ent, region);

                const prompt = `你正在扮演一个视觉小说游戏。玩家在地图上遇到了一个 NPC，现在开始对话。
        
        ${contextParts}
        
        【目标对象】
        名称：${ent.name}
        类型：${ent.kind}
        描述：${ent.description || ''}
        ${ent.tags?.length ? `标签：${ent.tags.join('、')}` : ''}
        ${this._formatEntityStats(ent)}
        
        【玩家行动】
        ${action}
        
        【任务】
        生成一段玩家和 ${ent.name} 的对话脚本。
        
        【输出格式】
        每行: 【人物名|显示/隐藏|左/中/右|性别|状态】: 内容
        旁白: 【旁白】: 内容
        （6-12 句。状态可以是心情或状态列表中的内容）
        
        【规则】
        - 说话者"显示"，其他"隐藏"
        - 玩家若要说话也写
        - 音乐(可选): 🎵 音乐: 曲名
        
        【效果】（可选，造成数据变化才写）
        目标: ${ent.name} 或 玩家
        数值变化: 键名 +N  或  键名 -N
        实体变化:
        - 获得【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
        - 失去【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
        - 获得状态 状态名（可选效果，| 分隔：攻击-20%|持续3回合）
        - 移除状态 状态名
        
        ★ 关键：获得物品时必须写完整格式（方括号内 键:值），否则玩家拿到的是空壳。
        ★ 可装备物品：写明属性字段，如 [类型:武器|攻击:+5|暴击:+10%]
        ★ 可消耗物品：写明功能，如 [类型:消耗品|功能:回复 50 点生命|可堆叠]
        
        【摘要】
        （2-3 句。玩家做了什么/说了什么、${ent.name} 的反应与态度变化。作为后续交互和主线的上下文）
        
        请开始生成：
        `;

                window.UIManager.closeModal();
                await window.UIManager.showText('正在生成对话...', 1000);

                const result = await window.generateFunctionalReply(prompt, 'map-talk');
                if (!result) return;

                await this._processResult(result, {
                    type: 'mapEntity',
                    target: ent.name,
                    entityId: ent.id,
                    scene: region?.name || '(地图)',
                    playerInput: input,
                    chapterId,
                });

            } catch (e) {
                console.error('[MapInteract] _doTalk 异常:', e);
                window.MapLauncher?._closeSubPanel?.();
            } finally {
                this.isGenerating = false;
            }
        },

        // ============================================================
        // 2. 通用交互（物品 / 建筑 / 标记）
        // ============================================================
        async interactWith(entityId) {
            const map = window.MapLauncher?.getMap?.();
            const ent = map?.entities?.find(e => e.id === entityId);
            if (!ent) {
                window.MapLauncher?._closeSubPanel?.();
                return;
            }
            // ★ 任务点：直接接取
            if (ent.kind === 'quest_point' && ent.meta?.questId) {
                const q = window.MapQuestManager?.getQuest?.(ent.meta.questId);
                if (q?.status === 'offered') {
                    window.MapLauncher._closeSubPanel();
                    await window.MapQuestManager.acceptQuest(q.id);
                    return;
                }
                if (q?.status === 'active') {
                    window.MapQuestManager.openQuestDetail(q.id);
                    return;
                }
            }
            // ★ 探索型任务 marker：直接推进
            if (ent.kind === 'marker' && ent.meta?.questTarget) {
                const q = window.MapQuestManager?.getQuest?.(ent.meta.questId);
                if (q?.progressType === 'explore' && q.status === 'active') {
                    window.MapLauncher._closeSubPanel();
                    window.MapQuestManager.onExploreReached(q, ent);
                    return;
                }
            }

            const interactions = ent.interactions || [];
            let modesHTML = '';

            if (interactions.length > 0) {
                const allModes = [
                    ...interactions.map((inter, i) => ({ ...inter, _index: i, _free: false })),
                    { name: '自由发挥', hint: '不按预设，用自己的方式互动', _index: -1, _free: true },
                ];
                modesHTML = `
                    <div style="margin-bottom:15px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:8px;">
                            选择交互方式（可不选，直接输入）：
                        </div>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;
                            max-height:240px;overflow-y:auto;">
                            ${allModes.map(m => `
                                <div class="cw-interact-mode" data-index="${m._index}"
                                    onclick="MapInteract._selectMode(${m._index})"
                                    style="display:flex;align-items:center;gap:8px;padding:10px 14px;
                                        background:rgba(255,255,255,.05);
                                        border:1px solid rgba(255,255,255,.1);
                                        border-radius:8px;cursor:pointer;transition:all .2s;">
                                    <span style="font-size:16px;">${m._free ? '✍️' : '✨'}</span>
                                    <div style="flex:1;">
                                        <div style="font-size:13px;color:#fff;font-weight:600;">${m.name}</div>
                                        ${m.hint ? `<div style="font-size:11px;color:#888;">${m.hint}</div>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
            } else {
                modesHTML = `
                    <div style="font-size:12px;color:#888;padding:8px 0;margin-bottom:12px;">
                        这个实体没有预设的交互方式，你可以自由描述想做什么。
                    </div>`;
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">✨ 与 ${ent.name} 交互</div>
                <div style="margin-bottom:15px;color:#aaa;font-size:13px;
                    padding:10px;background:rgba(0,0,0,.2);border-radius:8px;">
                    ${ent.description || ''}
                </div>
                ${modesHTML}
                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                        ${interactions.length > 0 ? '补充描述（可选）：' : '你想做什么？'}
                    </div>
                    <textarea class="cinemaworld-textarea" id="cw-map-interact-input"
                        placeholder="例如：我仔细看看它的背面..."
                        style="min-height:80px;"></textarea>
                </div>
                <div style="text-align:center;">
                    <button class="cinemaworld-button primary"
                        onclick="MapInteract._doInteract('${entityId}')">
                        确认
                    </button>
                    <button class="cinemaworld-button"
                        onclick="MapEntityPanel.openDetail('${entityId}')">返回</button>
                </div>`;

            this._selectedModeIndex = interactions.length > 0 ? 0 : -1;
            if (interactions.length > 0) {
                setTimeout(() => this._selectMode(0), 0);
            }
            if (window.MapQuestManager) {
                window.MapQuestManager.onEntityInteracted(ent);
            }
        },

        _selectedModeIndex: -1,

        _selectMode(index) {
            this._selectedModeIndex = index;
            document.querySelectorAll('.cw-interact-mode').forEach(el => {
                const isSelected = parseInt(el.dataset.index) === index;
                el.style.background = isSelected ? 'rgba(120,150,255,.3)' : 'rgba(255,255,255,.05)';
                el.style.borderColor = isSelected ? 'rgba(120,150,255,.7)' : 'rgba(255,255,255,.1)';
            });
        },

        async _doInteract(entityId) {
            if (this.isGenerating) return;
            this.isGenerating = true;

            try {
                const map = window.MapLauncher?.getMap?.();
                const ent = map?.entities?.find(e => e.id === entityId);
                if (!ent) {
                    window.MapLauncher?._closeSubPanel?.();
                    return;
                }

                // ★ 探索型任务 marker：直接推进，不进 AI 流程
                if (ent.kind === 'marker' && ent.meta?.questTarget) {
                    const q = window.MapQuestManager?.getQuest?.(ent.meta.questId);
                    if (q?.progressType === 'explore' && q.status === 'active') {
                        window.MapLauncher._closeSubPanel();
                        window.MapQuestManager.onExploreReached(q, ent);
                        return;
                    }
                }

                const input = document.getElementById('cw-map-interact-input')?.value.trim() || '';
                const interactions = ent.interactions || [];

                let modeLabel = '自由交互';
                let modeLine = '';
                if (interactions.length > 0 && this._selectedModeIndex >= 0) {
                    const inter = interactions[this._selectedModeIndex];
                    if (inter) {
                        modeLabel = inter.name;
                        modeLine = `${inter.name}${inter.hint ? '（' + inter.hint + '）' : ''}`;
                    }
                }

                const chapterId = window.StoryManager?.currentChapter?.id || null;
                const region = map.regions.find(r => r.id === ent.region);

                const contextParts = this._buildContextParts(map, ent, region);

                const prompt = `你正在为视觉小说游戏生成一段"与地图实体交互"的剧情脚本。
        
        ${contextParts}
        
        【交互目标】
        名称：${ent.name}
        类型：${ent.kind}
        描述：${ent.description || ''}
        ${this._formatEntityStats(ent)}
        
        【交互方式】
        ${modeLine || '（玩家自由发挥）'}
        ${input ? `玩家补充：${input}` : ''}
        
        【任务】
        生成一段脚本，描述玩家${modeLabel}这个实体的过程和结果。
        
        【输出格式】
        每行: 【角色名|显示/隐藏|左/中/右|性别|状态】: 内容
        旁白: 【旁白】: 内容
        （5-10 行）
        
        规则：
        - 说话者"显示"，其他"隐藏"
        - 只能使用场景中出现的角色
        - 音乐(可选): 🎵 音乐: 曲名
        
        【效果】（可选，交互造成数据变化才写）
        目标: 玩家
        数值变化: 键名 +N  或  键名 -N
        实体变化:
        - 获得【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
        - 失去【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
        - 获得状态 状态名
        - 移除状态 状态名
        
        ★ 拿起/带走：写"获得 物品名 x1"，系统会自动移入背包
        ★ 无法移动的实体（建筑/大树/固定装置）：剧情里说"动不了"，不给【效果】
        ★ 交互消耗了实体：写"失去 该实体"
        
        【场景更新】（可选，只有场景变化才写）
        环境数据:
        - 已有键:新值
        移除实体: 名字
        修改实体:
        - 【实体名】：状态→新状态
        
        【摘要】
        （2-3 句。玩家如何交互、产生什么后果。作为后续上下文）
        
        请开始生成：
        `;

                window.UIManager.closeModal();
                await window.UIManager.showText(`正在${modeLabel} ${ent.name}...`, 1000);

                const result = await window.generateFunctionalReply(prompt, 'map-interact');
                if (!result) return;

                await this._processResult(result, {
                    type: 'mapEntity',
                    target: ent.name,
                    entityId: ent.id,
                    scene: region?.name || '(地图)',
                    playerInput: `${modeLabel}${input ? '：' + input : ''}`,
                    chapterId,
                });

            } catch (e) {
                console.error('[MapInteract] _doInteract 异常:', e);
                window.MapLauncher?._closeSubPanel?.();
            } finally {
                this.isGenerating = false;
            }
        },

        // ============================================================
        // ============================================================
        // 3. 出入口（Portal）
        // ============================================================
        async enterPortal(entityId) {
            const map = window.MapLauncher?.getMap?.();
            const portal = map?.entities?.find(e => e.id === entityId);
            if (!portal || portal.kind !== 'portal') return;

            // ★ 主线点判定
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            const isMainPortal = mq?.active && mq.status === 'active'
                && mq.target.kind === 'portal'
                && mq.target.portalId === entityId;

            // ★ 兜底：fields 为空时，从 tags 里再捞一次
            let fields = portal.fields || {};
            if (!fields['目标'] && portal.tags?.length) {
                const recovered = {};
                for (const tag of portal.tags) {
                    const kv = String(tag).match(/^(.+?)[:：]\s*(.+)$/);
                    if (kv) recovered[kv[1].trim()] = kv[2].trim();
                }
                if (Object.keys(recovered).length > 0) {
                    fields = { ...recovered, ...fields };
                    portal.fields = fields;
                    console.log('[MapInteract] portal fields 从 tags 恢复:', fields);
                }
            }

            const targetType = fields['目标类型'] || 'map';
            const target = fields['目标'];
            const targetRegion = fields['目标区域'];
            const targetAnchor = fields['目标锚点'] || 'entrance';
            const hint = fields['提示'] || portal.description || '';

            if (!target) {
                console.warn('[MapInteract] portal 缺少目标:', portal.id, fields);
                window.UIManager.showText('这个出入口没有通向任何地方', 1500);
                return;
            }

            // ============================================================
            // ★ 主线点：走专属流程
            // ============================================================
            if (isMainPortal) {
                // 1. 弹主线确认框（带文本框）
                const result = await this._confirmMainQuestPortal(portal, mq);
                if (!result.ok) return;

                // 2. 标记主线点已触发
                mq.status = 'triggered';

                // 3. 关闭面板 + 刷新地图
                window.MapLauncher._closeSubPanel();
                if (window.MapCanvas?.canvas) {
                    window.MapCanvas._render();
                }
                window.MapLauncher._saveMapToWorld(map);

                // 4. 走主线剧情流程
                await this._proceedMainQuest({
                    kind: 'portal',
                    entity: portal,
                    playerInput: result.input,
                    map,
                });
                return;
            }

            // ============================================================
            // 普通出入口：走原有流程
            // ============================================================
            const result = await this._confirmPortal(portal, target, hint);
            if (!result.ok) return;

            if (result.input) {
                const played = await this._playTransition(portal, target, result.input, map);
                if (!played) return;
            }

            if (targetType === 'region') {
                await this._enterPortalRegion(portal, target, targetAnchor);
            } else {
                await this._enterPortalMap(portal, target, targetRegion, targetAnchor);
            }
        },
        // ============================================================
        // ★ 主线点：出入口确认框
        // ============================================================
        _confirmMainQuestPortal(portal, mq) {
            return new Promise((resolve) => {
                const html = `
            <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">
                ⭐ ${mq.title}
            </div>
            <div style="text-align:center;padding:14px;color:#ffd76b;font-size:14px;
                background:rgba(255,215,100,.08);border-radius:10px;margin-bottom:16px;">
                ${mq.hint || ''}
            </div>
            <div style="text-align:center;font-size:13px;color:#aaa;margin-bottom:16px;">
                📍 ${portal.name}
            </div>
            <div style="margin-bottom:16px;">
                <div style="font-size:13px;color:#aaa;margin-bottom:6px;">
                    你想怎么做？（可选）
                </div>
                <textarea class="cinemaworld-textarea" id="cw-mq-portal-input"
                    placeholder="例如：我深吸一口气，走向那条路。&#10;（留空则直接推进）"
                    style="min-height:90px;width:100%;box-sizing:border-box;"></textarea>
            </div>
            <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                <button class="cinemaworld-button primary" id="cw-mq-portal-confirm"
                    style="background:linear-gradient(135deg,#ffb84d,#ff8a3d);">
                    ⭐ 继续主线
                </button>
                <button class="cinemaworld-button" id="cw-mq-portal-cancel">暂不</button>
            </div>`;

                window.MapLauncher._openSubPanel(html);

                document.getElementById('cw-mq-portal-confirm').onclick = () => {
                    const input = document.getElementById('cw-mq-portal-input')?.value.trim() || '';
                    resolve({ ok: true, input });
                };
                document.getElementById('cw-mq-portal-cancel').onclick = () => {
                    window.MapLauncher._closeSubPanel();
                    resolve({ ok: false, input: '' });
                };
            });
        },
        // ============================================================
        // ★ 主线点：走主线剧情流程
        // ============================================================
        async _proceedMainQuest({ kind, entity, playerInput, map }) {
            const mq = window.CinemaWorld.worldState.mainQuest;

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            if (map) window.MapLauncher._saveMapToWorld(map);

            await window.StoryManager.createStory('', null, {
                isMainQuest: true,
                mainQuest: mq,
                targetEntity: entity,
                targetKind: kind,
                playerInput,
            });
        },
        // ============================================================
        // ★ 建筑入口：目标就是建筑名，当一张地图处理
        // ============================================================
        async enterBuilding(buildingId, buildingName) {
            if (!buildingId) return;

            const currentMap = window.MapLauncher.getMap();
            if (!currentMap) return;

            const mapName = buildingName || '建筑';

            // 世界仓库里有 → 直接确认进
            let targetMap = window.MapLauncher.findMapInWorld?.(mapName);

            if (targetMap) {
                // ★ 确认窗口（已有地图）
                const ok = await this._confirmEnter(mapName, true);
                if (!ok) return;

                const portalLike = {
                    id: buildingId,
                    name: mapName,
                    emoji: '🚪',
                    region: currentMap._currentRegionId,
                    position: 'center',
                    _isBuilding: true,          // ★ 标记：建筑内部
                };
                this._openTargetMap(portalLike, targetMap, null, 'entrance');
                return;
            }

            // ★ 没有地图 → 确认 + 生成 + 预览
            const ok = await this._confirmEnter(mapName, false);
            if (!ok) return;

            const portalLike = {
                id: buildingId,
                name: mapName,
                emoji: '🚪',
                description: `${mapName}的内部`,
                region: currentMap._currentRegionId,
                position: 'center',
                _isBuilding: true,              // ★ 标记：建筑内部
            };

            await this._generateAndPreviewMap(portalLike, mapName, null, 'entrance');
        },
        _confirmEnter(mapName, hasMap) {
            return new Promise((resolve) => {
                const html = `
                    <div class="cinemaworld-modal-title" style="font-size:22px;">
                        🚪 进入【${mapName}】
                    </div>
                    <div style="font-size:14px;color:#aaa;line-height:1.8;margin-bottom:16px;
                        padding:14px;background:rgba(0,0,0,.2);border-radius:10px;text-align:center;">
                        ${hasMap
                        ? '内部地图已存在，即将打开。'
                        : '内部地图还没有生成。<br>将调用 AI 创建，可能需要几秒钟。'}
                    </div>
                    <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                        <button class="cinemaworld-button primary" id="cw-enter-confirm">
                            ${hasMap ? '进入' : '生成并进入'}
                        </button>
                        <button class="cinemaworld-button" id="cw-enter-cancel">取消</button>
                    </div>
                `;

                window.MapLauncher._openSubPanel(html);

                document.getElementById('cw-enter-confirm').onclick = () => {
                    window.MapLauncher._closeSubPanel();
                    resolve(true);
                };
                document.getElementById('cw-enter-cancel').onclick = () => {
                    window.MapLauncher._closeSubPanel();
                    resolve(false);
                };
            });
        },
        async _generateAndPreviewMap(portal, mapName, targetRegion, targetAnchor) {
            const currentMap = window.MapLauncher.getMap();

            // ★ 显示生成中
            window.MapLauncher._openSubPanel(`
                <div class="cinemaworld-modal-title" style="font-size:22px;">
                    🗺️ 生成【${mapName}】
                </div>
                <div style="text-align:center;padding:40px 20px;">
                    <div style="font-size:56px;margin-bottom:16px;">⏳</div>
                    <div style="color:#aaa;font-size:14px;">正在调用 AI 生成地图...</div>
                    <div style="color:#666;font-size:12px;margin-top:10px;">
                        这可能需要几秒钟
                    </div>
                </div>
            `);

            try {
                const guide = [
                    `从【${currentMap.name}】的【${portal.region}】区域，通过「${portal.name}」进入。`,
                    portal.description ? `出入口描述：${portal.description}` : '',
                    `目标地图名：${mapName}`,
                    targetRegion ? `目标地图的起始区域：${targetRegion}` : '',
                ].filter(Boolean).join('\n');

                const newMap = await window.MapGenerator.generate({
                    guide,
                    sceneName: mapName,
                    sceneDesc: portal.description || '',
                });

                if (!newMap) {
                    window.UIManager.showText('❌ 地图生成失败', 2000);
                    window.MapLauncher._closeSubPanel();
                    return;
                }

                // ★ 建筑内部：打标记，跳过主线和地图任务
                if (portal._isBuilding) {
                    newMap._source = 'program';
                    newMap.tags = newMap.tags || [];
                    if (!newMap.tags.includes('no-quest')) newMap.tags.push('no-quest');
                    if (!newMap.tags.includes('no-mainquest')) newMap.tags.push('no-mainquest');
                    console.log(`[MapInteract] 【${mapName}】标记为程序生成，跳过任务`);
                }

                // ★ 拿到原始文本
                const rawText = newMap._rawText || this._mapToText?.(newMap) || '';

                // ★ 弹出预览
                this._showMapPreview(rawText, newMap, mapName, portal, targetRegion, targetAnchor);

            } catch (e) {
                console.error('[MapInteract] 地图生成失败:', e);
                window.UIManager.showText('❌ 地图生成失败：' + e.message, 3000);
                window.MapLauncher._closeSubPanel();
            }
        },
        _showMapPreview(rawText, generatedMap, mapName, portal, targetRegion, targetAnchor) {
            const html = `
                <div class="cinemaworld-modal-title" style="font-size:22px;">
                    🗺️ 生成完成：${mapName}
                </div>
                <div style="font-size:12px;color:#888;margin-bottom:10px;">
                    你可以查看和编辑 AI 生成的地图规则，然后决定是否进入。
                </div>
                <div style="margin-bottom:12px;">
                    <textarea id="cw-map-preview-text"
                        style="width:100%;box-sizing:border-box;min-height:340px;
                            font-family:monospace;font-size:12px;padding:12px;
                            background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                            border-radius:8px;color:#ccc;resize:vertical;"
                        >${this._escapeHTML(rawText)}</textarea>
                </div>
                <div style="text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" id="cw-map-preview-enter">
                        ✅ 进入地图
                    </button>
                    <button class="cinemaworld-button" id="cw-map-preview-regen">
                        🔄 重新生成
                    </button>
                    <button class="cinemaworld-button" id="cw-map-preview-cancel">
                        ❌ 取消
                    </button>
                </div>
            `;

            window.MapLauncher._openSubPanel(html);

            // ✅ 进入地图：解析当前 textarea 文本 → 进入
            document.getElementById('cw-map-preview-enter').onclick = async () => {
                const text = document.getElementById('cw-map-preview-text').value;
                const editedMap = this._parseAndNormalizeMap(text, mapName);

                if (!editedMap) {
                    window.UIManager.showText('❌ 解析失败，请检查格式', 2000);
                    return;
                }

                // 保存并进入
                await this._commitAndEnter(editedMap, portal, targetRegion, targetAnchor);
            };

            // 🔄 重新生成：重新调 AI
            document.getElementById('cw-map-preview-regen').onclick = async () => {
                if (!confirm('确定重新生成？当前编辑将被丢弃。')) return;
                await this._generateAndPreviewMap(portal, mapName, targetRegion, targetAnchor);
            };

            // ❌ 取消
            document.getElementById('cw-map-preview-cancel').onclick = () => {
                window.MapLauncher._closeSubPanel();
            };
        },
        async _commitAndEnter(map, portal, targetRegion, targetAnchor) {
            const currentMap = window.MapLauncher.getMap();

            map.name = portal.name;
            map.id = `map_${portal.name}`;

            // ★ 建筑内部：打标记，跳过主线和地图任务
            if (portal._isBuilding) {
                map._source = 'program';
                map.tags = map.tags || [];
                if (!map.tags.includes('no-quest')) map.tags.push('no-quest');
                if (!map.tags.includes('no-mainquest')) map.tags.push('no-mainquest');
                console.log(`[MapInteract] 【${map.name}】标记为程序生成，跳过任务`);
            }

            // 注入反向 portal
            this._injectReturnPortal(map, currentMap, portal, targetRegion);

            // 存当前地图位置
            window.MapLauncher._saveMapToWorld(currentMap);

            // 存新地图
            window.MapLauncher.registerMap(map);
            currentMap.childMaps = currentMap.childMaps || {};
            currentMap.childMaps[map.name] = { name: map.name };

            // 构建网格（会用 _source/tags 判断是否生成任务）
            window.MapLayout.build(map);

            // 清掉临时玩家位置
            map._savedCamera = null;
            map._savedRegionId = null;

            window.UIManager.closeModal();
            if (window.MapCanvas.canvas) window.MapCanvas.destroy();

            window.MapLauncher._map = map;
            window.MapLauncher._renderMapWindow();

            // 玩家落地
            setTimeout(() => {
                const regionId = targetRegion || map.startRegion;
                const rect = map._generated?.placements?.[regionId];
                if (rect && window.MapCanvas.player) {
                    const anchor = window.MapLayout._anchorToXY(targetAnchor || 'center', rect);
                    window.MapCanvas.player.x = anchor.x;
                    window.MapCanvas.player.y = anchor.y;
                    window.MapCanvas._centerCameraOnPlayer(true);
                    window.MapCanvas._currentRegionId = regionId;
                }
            }, 100);

            window.UIManager.showText(`🗺️ 进入【${map.name}】`, 2000);
            if (window.SaveManager) window.SaveManager.save();
        },
        _parseAndNormalizeMap(text, fallbackName) {
            try {
                const parsed = window.MapParser.parse(text);
                if (!parsed) return null;

                const map = window.MapSchema.normalize(parsed);
                if (!map) return null;

                // 名字兜底
                if (!map.name || map.name === '无名区域') {
                    map.name = fallbackName;
                }

                return map;
            } catch (e) {
                console.error('[MapInteract] 解析地图文本失败:', e);
                return null;
            }
        },
        _escapeHTML(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
        // ============================================================
        // ★ 主线点触发：实体
        // ============================================================
        async triggerMainQuestEntity(entityId) {
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            if (!mq?.active || mq.status !== 'active') return;

            const map = window.MapLauncher.getMap();
            const ent = map?.entities?.find(e => e.id === entityId);
            if (!ent) return;

            // 弹文本框确认
            const result = await this._confirmMainQuest({
                title: mq.title,
                hint: mq.hint,
                targetName: ent.name,
            });
            if (!result.ok) return;

            // 标记
            mq.status = 'triggered';

            // 走主线流程
            await this._proceedMainQuest({
                kind: 'entity',
                entity: ent,
                playerInput: result.input,
                map,
            });
        },

        // ============================================================
        // ★ 主线点触发：格子（由 MapCanvas 调用）
        // ============================================================
        async triggerMainQuestCell(mq) {
            if (!mq?.active) return;

            const map = window.MapLauncher.getMap();

            // 弹文本框确认（此时 status 已经是 triggered）
            const result = await this._confirmMainQuest({
                title: mq.title,
                hint: mq.hint,
                targetName: '这里',
            });
            if (!result.ok) {
                // 取消 → 回滚 status
                mq.status = 'active';
                return;
            }

            // 走主线流程
            await this._proceedMainQuest({
                kind: 'cell',
                entity: null,
                playerInput: result.input,
                map,
            });
        },

        // ============================================================
        // ★ 通用：主线点确认框（带文本框）
        // ============================================================
        _confirmMainQuest({ title, hint, targetName }) {
            return new Promise((resolve) => {
                const html = `
            <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">
                ⭐ ${title}
            </div>
            <div style="text-align:center;padding:14px;color:#ffd76b;font-size:14px;
                background:rgba(255,215,100,.08);border-radius:10px;margin-bottom:16px;">
                ${hint || ''}
            </div>
            <div style="text-align:center;font-size:13px;color:#aaa;margin-bottom:16px;">
                📍 ${targetName}
            </div>
            <div style="margin-bottom:16px;">
                <div style="font-size:13px;color:#aaa;margin-bottom:6px;">
                    你想怎么做？（可选）
                </div>
                <textarea class="cinemaworld-textarea" id="cw-mainquest-input"
                    placeholder="例如：我深吸一口气，推开了门。&#10;（留空则直接推进）"
                    style="min-height:90px;width:100%;box-sizing:border-box;"></textarea>
            </div>
            <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                <button class="cinemaworld-button primary" id="cw-mainquest-confirm"
                    style="background:linear-gradient(135deg,#ffb84d,#ff8a3d);">
                    ⭐ 继续主线
                </button>
                <button class="cinemaworld-button" id="cw-mainquest-cancel">暂不</button>
            </div>`;

                window.MapLauncher._openSubPanel(html);

                document.getElementById('cw-mainquest-confirm').onclick = () => {
                    const input = document.getElementById('cw-mainquest-input')?.value.trim() || '';
                    window.MapLauncher._closeSubPanel();
                    resolve({ ok: true, input });
                };
                document.getElementById('cw-mainquest-cancel').onclick = () => {
                    window.MapLauncher._closeSubPanel();
                    resolve({ ok: false, input: '' });
                };
            });
        },

        // ============================================================
        // ★ 通用：走主线流程
        // ============================================================
        async _proceedMainQuest({ kind, entity, playerInput, map }) {
            const mq = window.CinemaWorld.worldState.mainQuest;

            // 立刻刷新地图（金色标记消失）
            if (window.MapCanvas?.canvas) {
                window.MapCanvas._render();
            }

            // 存一下地图（status 变了）
            window.MapLauncher._saveMapToWorld(map);

            // 生成主线剧情
            await window.StoryManager.createStory('', null, {
                isMainQuest: true,
                mainQuest: mq,
                targetEntity: entity,
                targetKind: kind,
                playerInput,
            });
        },
        // ============================================================
        // ★ 过渡剧情：玩家描述 → AI 生成脚本 → 播放
        // 返回 true = 继续进入，false = 取消
        // ============================================================
        async _playTransition(portal, targetName, playerInput, currentMap) {
            if (this.isGenerating) return false;
            this.isGenerating = true;

            const region = currentMap.regions.find(r => r.id === portal.region);
            const chapterId = window.StoryManager?.currentChapter?.id || null;

            // ---------- 组装上下文 ----------
            const contextParts = [];

            if (window.StoryManager) {
                const ctx = window.StoryManager.buildContext(null, {
                    parentStory: false,
                    mainChars: true,
                    scene: false,
                    interactionDigests: true,
                    volumes: false,
                    chapters: false,
                    pendingEvents: false,
                });
                if (ctx) contextParts.push(ctx);
            }

            let mapCtx = `【当前地图】${currentMap.name || ''}\n`;
            if (currentMap.description) mapCtx += `${currentMap.description}\n`;
            mapCtx += `\n【当前位置】${region?.name || '未知区域'}`;
            if (region?.description) mapCtx += `\n${region.description}`;

            const siblings = currentMap.entities.filter(e =>
                e.region === region?.id && e.id !== portal.id && !e.isPlayer
            );
            if (siblings.length > 0) {
                mapCtx += `\n\n【附近的其他实体】`;
                for (const s of siblings) {
                    mapCtx += `\n- ${s.emoji} ${s.name}（${s.kind}）${s.description ? '：' + s.description : ''}`;
                }
            }
            contextParts.push(mapCtx);

            if (window.PlayerStateManager) {
                contextParts.push(window.PlayerStateManager.formatForPrompt());
            }

            // ---------- 组装提示词 ----------
            const prompt = `你正在为视觉小说游戏生成一段"地图过渡"剧情。

${contextParts.join('\n\n')}

【过渡事件】
玩家站在「${portal.emoji} ${portal.name}」前。
出入口描述：${portal.description || '（无）'}
${portal.fields?.['提示'] ? `提示：${portal.fields['提示']}` : ''}
即将前往：${targetName}

【玩家行动】
${playerInput}

【任务】
生成一段 5-10 行的脚本，描述玩家${playerInput ? '『' + playerInput + '』' : ''}穿过这个出入口、进入${targetName}的过渡过程。

【输出格式】
每行: 【角色名|显示/隐藏|左/中/右|性别|状态】: 内容
旁白: 【旁白】: 内容

规则：
- 说话者"显示"，其他"隐藏"
- 只能使用当前场景出现的角色
- 音乐(可选): 🎵 音乐: 曲名
- 结尾要自然过渡到"进入${targetName}"的氛围

【摘要】
（2-3 句。玩家如何穿过出入口、前往哪里。作为后续上下文）

请开始生成：
`;

            // ---------- 生成 ----------
            window.MapLauncher._closeSubPanel();
            await window.UIManager.showText('正在生成过渡...', 800);

            try {
                const result = await window.generateFunctionalReply(prompt, 'map-transition');
                if (!result) return true;   // 生成失败 → 直接进入，不阻塞

                // 解析
                const summaryMatch = result.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
                const digestSummary = summaryMatch ? summaryMatch[1].trim() : '';
                const withoutDigest = result.replace(/【摘要】[\s\S]*?(?=\n【|$)/, '').trim();

                // 音乐
                if (window.MusicManager) {
                    await window.MusicManager.applyMusicMarker(result);
                }

                // 播放
                const dialogues = window.VisualNovelManager.parseScript(withoutDigest);
                if (dialogues.length > 0) {
                    await window.VisualNovelManager.play(dialogues);
                } else {
                    await window.UIManager.showText(withoutDigest, 4000);
                }

                // 记录
                if (window.InteractionHistoryManager) {
                    window.InteractionHistoryManager.add({
                        type: 'mapTransition',
                        target: portal.name,
                        targetMeta: { portalId: portal.id, toMap: targetName },
                        scene: region?.name || '(地图)',
                        playerInput,
                        script: withoutDigest,
                        effect: null,
                        summary: digestSummary,
                    });
                }

                if (digestSummary && window.InteractionDigestManager) {
                    window.InteractionDigestManager.add({
                        targetType: 'item',
                        target: `地图过渡:${portal.name}`,
                        source: 'mapTransition',
                        summary: digestSummary,
                        chapterId,
                    });
                }

                if (window.MusicManager) await window.MusicManager.clearOverrideMusic();

                return true;

            } catch (e) {
                console.error('[MapInteract] 过渡生成失败:', e);
                return true;   // 失败也继续进入，不卡玩家
            } finally {
                this.isGenerating = false;
            }
        },
        // ---------- 确认框（带文本输入）----------
        _confirmPortal(portal, target, hint) {
            return new Promise((resolve) => {
                const html = `
                    <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">
                        ${portal.emoji} ${portal.name}
                    </div>
                    <div style="text-align:center;padding:16px;color:#aaa;font-size:14px;">
                        ${hint || portal.description || ''}
                    </div>
                    <div style="text-align:center;font-size:13px;color:#7da8ff;margin-bottom:16px;">
                        前往：${target}
                    </div>
                    <div style="margin-bottom:16px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:6px;">
                            你想怎么过去？（可选）
                        </div>
                        <textarea class="cinemaworld-textarea" id="cw-portal-input"
                            placeholder="例如：我快步穿过城门，警惕地环顾四周。&#10;（留空则直接前往）"
                            style="min-height:90px;width:100%;box-sizing:border-box;"></textarea>
                    </div>
                    <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                        <button class="cinemaworld-button primary" id="cw-portal-confirm">前往</button>
                        <button class="cinemaworld-button" id="cw-portal-cancel">留下</button>
                    </div>`;

                window.MapLauncher._openSubPanel(html);

                document.getElementById('cw-portal-confirm').onclick = () => {
                    const input = document.getElementById('cw-portal-input')?.value.trim() || '';
                    resolve({ ok: true, input });
                };
                document.getElementById('cw-portal-cancel').onclick = () => {
                    window.MapLauncher._closeSubPanel();
                    resolve({ ok: false, input: '' });
                };
            });
        },

        // ---------- 通向另一张地图（★ 关键改动）----------
        async _enterPortalMap(portal, mapName, targetRegion, targetAnchor) {
            const currentMap = window.MapLauncher.getMap();

            // ★ 1. 先从世界仓库找（这是唯一的真相来源）
            let targetMap = window.MapLauncher.findMapInWorld?.(mapName);

            // 2. 世界仓库没有 → 再试 WorldManager（兼容旧数据）
            if (!targetMap) {
                const wmMap = window.WorldManager?.findEntity?.(mapName);
                if (wmMap && Array.isArray(wmMap.regions) && wmMap.regions.length > 0) {
                    const normalized = window.MapSchema.normalize(wmMap);
                    if (!normalized._generated) window.MapLayout.build(normalized);
                    // 顺手写进世界仓库
                    window.MapLauncher.registerMap(normalized);
                    targetMap = normalized;
                }
            }

            // 3. 找到了 → 直接打开（恢复上次位置）
            if (targetMap) {
                return this._openTargetMap(portal, targetMap, targetRegion, targetAnchor);
            }

            // 4. 没有 → 生成新地图
            await this._generateMapForPortal(portal, mapName, targetRegion, targetAnchor);
        },

        // ---------- 打开已有地图（★ 保留玩家上次位置）----------
        _openTargetMap(portal, targetMap, targetRegion, targetAnchor) {
            const currentMap = window.MapLauncher.getMap();

            // ★ 离开当前地图前，先把当前位置存进世界
            window.MapLauncher._saveMapToWorld(currentMap);

            const normalized = window.MapSchema.normalize(targetMap);
            if (!normalized._generated) {
                window.MapLayout.build(normalized);
            }

            // 记录返回点
            normalized._returnPortal = {
                fromMap: currentMap.name,
                fromRegion: portal.region,
                fromAnchor: portal.position,
            };

            window.UIManager.closeModal();
            if (window.MapCanvas.canvas) window.MapCanvas.destroy();

            window.MapLauncher._map = normalized;
            window.MapLauncher._renderMapModal(document.getElementById('cinemaworld-modal'));

            // ★ 玩家落地：
            //   - 如果 map 里有保存的位置（_playerPos），MapLayout 已经恢复过了
            //   - 只有显式指定了 targetRegion / targetAnchor 才覆盖
            setTimeout(() => {
                const player = window.MapCanvas.player;
                if (!player) return;

                // 有保存位置 → 保持不动，只对齐 region
                if (normalized._savedRegionId) {
                    window.MapCanvas._currentRegionId = normalized._savedRegionId;
                    window.MapCanvas._centerCameraOnPlayer(true);
                    return;
                }

                // 没有保存位置 → 按 targetRegion 落地
                const regionId = targetRegion || normalized.startRegion;
                const rect = normalized._generated?.placements?.[regionId];
                if (rect) {
                    const anchor = window.MapLayout._anchorToXY(targetAnchor || 'center', rect);
                    player.x = anchor.x;
                    player.y = anchor.y;
                    window.MapCanvas._centerCameraOnPlayer(true);
                    window.MapCanvas._currentRegionId = regionId;
                }
            }, 100);
            setTimeout(() => {
                window.StoryManager?._tryLandMainQuest?.(normalized);
            }, 150);
            window.UIManager.showText(`🚪 进入【${targetMap.name}】`, 1500);
            if (window.SaveManager) window.SaveManager.save();
        },

        // ---------- 生成新地图（★ 关键改动：加反向 portal）----------
        async _generateMapForPortal(portal, mapName, targetRegion, targetAnchor) {
            const currentMap = window.MapLauncher.getMap();
            const modal = document.getElementById('cinemaworld-modal');

            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🗺️ 生成地图</div>
                <div style="text-align:center;padding:30px;color:#aaa;font-size:14px;">
                    <div style="font-size:48px;margin-bottom:16px;">${portal.emoji}</div>
                    <div>正在生成【${mapName}】...</div>
                    <div style="font-size:12px;color:#666;margin-top:12px;">AI 正在根据出入口描述生成地图规则</div>
                </div>
            `;

            try {
                // ★ 主线上下文
                const mq = window.CinemaWorld?.worldState?.mainQuest;
                const mainQuestGuide = (mq?.active && mq.target.mapName === mapName)
                    ? `【当前主线】\n目标: ${mq.title}\n提示: ${mq.hint}\n★ 这个地图是主线目标所在地，请为它设计合理的落点。`
                    : '';
                const guide = [
                    `从【${currentMap.name}】的【${portal.region}】区域，通过「${portal.name}」进入。`,
                    portal.description ? `出入口描述：${portal.description}` : '',
                    `目标地图名：${mapName}`,
                    targetRegion ? `目标地图的起始区域：${targetRegion}` : '',
                ].filter(Boolean).join('\n');

                const newMap = await window.MapGenerator.generate({
                    guide,
                    sceneName: mapName,
                    sceneDesc: portal.description || '',
                });

                if (!newMap) {
                    window.UIManager.showText('❌ 地图生成失败', 2000);
                    window.MapLauncher._renderMapModal(modal);
                    return;
                }

                newMap.name = mapName;
                newMap.id = `map_${mapName}`;

                // ★ 关键：在新地图里注入一个反向 portal，指回原地图
                this._injectReturnPortal(newMap, currentMap, portal, targetRegion);

                // ★ 先把当前地图的玩家位置存起来
                window.MapLauncher._saveMapToWorld(currentMap);

                // 写入世界仓库（唯一真相来源）
                window.MapLauncher.registerMap(newMap);
                currentMap.childMaps = currentMap.childMaps || {};
                currentMap.childMaps[mapName] = { name: mapName };

                window.MapLayout.build(newMap);

                // 清掉生成时的临时玩家位置（让玩家从入口区域开始）
                newMap._savedCamera = null;
                newMap._savedRegionId = null;

                window.UIManager.closeModal();
                if (window.MapCanvas.canvas) window.MapCanvas.destroy();

                window.MapLauncher._map = newMap;
                window.MapLauncher._renderMapModal(document.getElementById('cinemaworld-modal'));

                setTimeout(() => {
                    const regionId = targetRegion || newMap.startRegion;
                    const rect = newMap._generated?.placements?.[regionId];
                    if (rect && window.MapCanvas.player) {
                        const anchor = window.MapLayout._anchorToXY(targetAnchor || 'center', rect);
                        window.MapCanvas.player.x = anchor.x;
                        window.MapCanvas.player.y = anchor.y;
                        window.MapCanvas._centerCameraOnPlayer(true);
                        window.MapCanvas._currentRegionId = regionId;
                    }
                }, 100);
                setTimeout(() => {
                    window.StoryManager?._tryLandMainQuest?.(normalized);
                }, 150);
                window.UIManager.showText(`🗺️ 进入【${mapName}】`, 2000);
                if (window.SaveManager) window.SaveManager.save();

            } catch (e) {
                console.error('[MapInteract] 地图生成失败:', e);
                window.UIManager.showText('❌ 地图生成失败：' + e.message, 3000);
                window.MapLauncher._renderMapModal(modal);
            }
        },

        // ---------- 在目标地图里注入反向 portal ----------
        _injectReturnPortal(newMap, currentMap, sourcePortal, targetRegion) {
            if (!newMap.entities) newMap.entities = [];

            // 反向 portal 要落在"进入区域"（targetRegion 或起点）
            const enterRegionId = targetRegion || newMap.startRegion;
            const enterRegion = newMap.regions.find(r => r.id === enterRegionId);
            if (!enterRegion) return;

            // 检查新地图里是否已经有一个指回 currentMap 的 portal
            const exists = newMap.entities.some(e =>
                e.kind === 'portal' &&
                e.fields?.['目标'] === currentMap.name
            );
            if (exists) return;

            const returnPortal = {
                id: `portal_back_${currentMap.name}_${Date.now()}`,
                name: `返回${currentMap.name}`,
                emoji: '🔙',
                kind: 'portal',
                region: enterRegionId,
                position: 'entrance',
                blocking: false,
                isPlayer: false,
                tags: ['返回'],
                description: `回到【${currentMap.name}】`,
                meta: {},
                status: '',
                effect: '',
                fields: {
                    '目标类型': 'map',
                    '目标': currentMap.name,
                    '目标区域': sourcePortal.region || currentMap.startRegion,
                    '目标锚点': sourcePortal.position || 'center',
                    '方向': 'both',
                    '提示': `沿原路返回【${currentMap.name}】`,
                },
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: 1,
                stackable: false,
                maxStack: null,
                type: 'portal',
            };

            newMap.entities.push(returnPortal);
            console.log(`[MapInteract] 已在【${newMap.name}】注入返回 portal → ${currentMap.name}`);
        },

        // ---------- 通向当前地图的另一个区域 ----------
        async _enterPortalRegion(portal, regionId, targetAnchor) {
            const map = window.MapLauncher.getMap();
            const rect = map._generated?.placements?.[regionId];
            if (!rect) {
                window.UIManager.showText(`区域「${regionId}」不存在`, 2000);
                window.MapLauncher._closeSubPanel();
                return;
            }

            const anchor = window.MapLayout._anchorToXY(targetAnchor || 'center', rect);

            if (window.MapCanvas.player) {
                window.MapCanvas.player.x = anchor.x;
                window.MapCanvas.player.y = anchor.y;
                window.MapCanvas._centerCameraOnPlayer(true);
                window.MapCanvas._currentRegionId = regionId;
                window.MapCanvas._lastPortalId = null;
            }

            if (window.MapLauncher._subState) {
                window.MapLauncher._subState.playerX = anchor.x;
                window.MapLauncher._subState.playerY = anchor.y;
                window.MapLauncher._subState.currentRegionId = regionId;
                const viewW = window.MapCanvas._cssW / window.MapCanvas.config.tileSize;
                const viewH = window.MapCanvas._cssH / window.MapCanvas.config.tileSize;
                const g = map._generated.grid;
                window.MapLauncher._subState.cameraX = Math.max(0, Math.min(g[0].length - viewW, anchor.x - viewW / 2));
                window.MapLauncher._subState.cameraY = Math.max(0, Math.min(g.length - viewH, anchor.y - viewH / 2));
            }

            window.MapLauncher._closeSubPanel();
            window.UIManager.showText(`🚪 前往【${map.regions.find(r => r.id === regionId)?.name || regionId}】`, 1500);
            if (window.SaveManager) window.SaveManager.save();
        },

        // ============================================================
        // 4. 战斗入口
        // ============================================================
        async startBattle(entityId) {
            const map = window.MapLauncher?.getMap?.();
            const ent = map?.entities?.find(e => e.id === entityId);
            if (!ent) return;

            if (!window.EncounterManager) {
                window.UIManager.showText('战斗系统未加载', 2000);
                return;
            }

            // ★ 直接交给 EncounterManager
            await window.EncounterManager.startEncounter(entityId, { fromMap: true });
        },

        _toBattleItem(ent) {
            return {
                name: ent.name,
                icon: ent.emoji || '👹',
                description: ent.description || '',
                fields: { ...(ent.fields || {}) },
                status: ent.status || '',
                effect: ent.effect || '',
                interactions: ent.interactions || [],
                type: 'entity',
                count: 1,
            };
        },

        // ============================================================
        // 5. 结果处理
        // ============================================================
        async _processResult(result, meta) {
            const summaryMatch = result.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
            const digestSummary = summaryMatch ? summaryMatch[1].trim() : '';
            const withoutDigest = result.replace(/【摘要】[\s\S]*?(?=\n【|$)/, '').trim();

            const updateIdx = withoutDigest.indexOf('【场景更新】');
            const effectIdx = withoutDigest.indexOf('【效果】');
            const cutPoints = [updateIdx, effectIdx].filter(i => i >= 0);
            const scriptEnd = cutPoints.length > 0 ? Math.min(...cutPoints) : withoutDigest.length;
            const scriptText = withoutDigest.substring(0, scriptEnd).trim();

            let sceneUpdatePart = '';
            let effectPart = '';
            if (updateIdx >= 0) {
                const nextBlock = effectIdx > updateIdx ? effectIdx : withoutDigest.length;
                sceneUpdatePart = withoutDigest.substring(updateIdx, nextBlock);
            }
            if (effectIdx >= 0) {
                const nextBlock = updateIdx > effectIdx ? updateIdx : withoutDigest.length;
                effectPart = withoutDigest.substring(effectIdx, nextBlock);
            }

            if (window.MusicManager) {
                await window.MusicManager.applyMusicMarker(result);
            }

            const dialogues = window.VisualNovelManager.parseScript(scriptText);
            if (dialogues.length > 0) {
                await window.VisualNovelManager.play(dialogues);
            } else {
                await window.UIManager.showText(scriptText, 5000);
            }

            if (effectPart && window.EffectSystem) {
                await new Promise(r => setTimeout(r, 300));
                const results = window.EffectSystem.applyFromNarrative(effectPart);
                const text = window.EffectSystem.formatResults(results);
                if (text) await window.UIManager.showText(text, 4000);
            }

            // ★ 场景更新前检查实体是否还在
            const map = window.MapLauncher?.getMap?.();
            const targetStillExists = meta.entityId
                ? map?.entities?.some(e => e.id === meta.entityId)
                : true;

            if (sceneUpdatePart && targetStillExists) {
                await new Promise(r => setTimeout(r, 300));
                await this._applyMapUpdate(sceneUpdatePart, meta.entityId);
            } else if (sceneUpdatePart) {
                console.warn('[MapInteract] 目标实体已不存在，跳过场景更新');
            }

            if (window.InteractionHistoryManager) {
                window.InteractionHistoryManager.add({
                    type: meta.type,
                    target: meta.target,
                    targetMeta: { entityId: meta.entityId },
                    scene: meta.scene,
                    playerInput: meta.playerInput,
                    script: scriptText,
                    effect: effectPart || null,
                    summary: digestSummary,
                });
            }

            if (digestSummary && window.InteractionDigestManager) {
                window.InteractionDigestManager.add({
                    targetType: 'item',
                    target: `地图:${meta.target}`,
                    source: 'mapEntity',
                    summary: digestSummary,
                    chapterId: meta.chapterId,
                });
            }

            if (window.MusicManager) await window.MusicManager.clearOverrideMusic();
            if (window.SaveManager) window.SaveManager.save();

            // ★ 集群实体减数：先查存在性
            // 集群实体减数
            if (meta.entityId) {
                const ent = map?.entities?.find(e => e.id === meta.entityId);
                if (ent && ent.countMode === 'cluster' && ent.count > 1) {
                    ent.count -= 1;
                    console.log(`[MapInteract] 集群实体 ${ent.name} 剩余 ${ent.count}`);
                    window.MapPortraitLayer?.hide?.();
                }
            }

            if (window.MapCanvas?.canvas) {
                window.MapCanvas._render();
            }

            // ★ 刷新右上角头像栏
            if (window.MapCanvas?._refreshAvatarBar) {
                window.MapCanvas._refreshAvatarBar();
            }
        },

        // ============================================================
        // 6. 地图场景更新
        // ============================================================
        async _applyMapUpdate(updateText, sourceEntityId) {
            const map = window.MapLauncher?.getMap?.();
            if (!map) return;

            const removeMatch = updateText.match(/移除(?:实体|物品)[:：]?\s*([^\n]+)/);
            if (removeMatch) {
                const names = removeMatch[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
                for (const name of names) {
                    const idx = map.entities.findIndex(e => e.name === name && !e.isPlayer);
                    if (idx > -1) {
                        map.entities.splice(idx, 1);
                        console.log(`[MapInteract] 移除实体: ${name}`);
                    }
                }
            }

            const modifyRegex = /修改(?:实体|物品)[:：]?\s*([\s\S]*?)(?=\n(?:新增|移除|场景状态|环境数据|$)|$)/g;
            let m;
            while ((m = modifyRegex.exec(updateText)) !== null) {
                const lines = m[1].split('\n').map(l => l.trim()).filter(Boolean);
                for (const line of lines) {
                    const clean = line.replace(/^[-•]\s*/, '');
                    const kv = clean.match(/^[【\[]?(.+?)[】\]]?[：:]\s*(.+?)→(.+)$/);
                    if (!kv) continue;
                    const name = kv[1].trim();
                    const newVal = kv[3].trim();
                    const ent = map.entities.find(e => e.name === name);
                    if (ent) {
                        ent.status = newVal;
                        console.log(`[MapInteract] 实体状态更新: ${name} → ${newVal}`);
                    }
                }
            }

            const addRegex = /新增(?:实体|物品|遭遇)[:：]?\s*([\s\S]*?)(?=\n(?:移除|修改|场景状态|环境数据|$)|$)/g;
            while ((m = addRegex.exec(updateText)) !== null) {
                const lines = m[1].split('\n').map(l => l.trim()).filter(Boolean);
                for (const line of lines) {
                    if (!line.startsWith('-')) continue;
                    const clean = line.substring(1).trim();
                    const parsed = window.WorldManager?.parseItemLine?.(clean);
                    if (!parsed || !parsed.name) continue;

                    const newEnt = {
                        id: `ent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        name: parsed.name,
                        emoji: parsed.icon || '📦',
                        kind: 'item',
                        region: map.entities.find(e => e.id === sourceEntityId)?.region || map.regions[0].id,
                        position: 'center',
                        blocking: false,
                        isPlayer: false,
                        tags: [],
                        description: parsed.description || '',
                        meta: {},
                        status: parsed.status || '',
                        effect: parsed.effect || '',
                        fields: parsed.fields || {},
                        interactions: parsed.interactions || [],
                        extraStats: { _order: [], _raw: '' },
                    };

                    window.MapEntityPanel._replaceEntity(map, newEnt);
                    map.entities.push(newEnt);
                    console.log(`[MapInteract] 新增实体: ${newEnt.name}`);
                }
            }

            const envRegex = /环境数据[:：]?\s*([\s\S]*?)(?=\n【|\n(?:移除|新增|修改|场景状态|$)|$)/;
            const envMatch = updateText.match(envRegex);
            if (envMatch) {
                map._environment = map._environment || {};
                for (const line of envMatch[1].split('\n')) {
                    const clean = line.replace(/^[-•]\s*/, '').trim();
                    const kv = clean.match(/^(.+?)[:：]\s*(.+)$/);
                    if (kv) map._environment[kv[1].trim()] = kv[2].trim();
                }
            }
            window.CWNotify3D?.('all');
            // ★ 实体变动后，存一次
            window.MapLauncher._saveMapToWorld(map);
        },

        // ============================================================
        // 7. 上下文组装
        // ============================================================
        _buildContextParts(map, ent, region) {
            const parts = [];

            if (window.StoryManager) {
                const ctx = window.StoryManager.buildContext(null, {
                    parentStory: false,
                    mainChars: true,
                    scene: false,
                    interactionDigests: true,
                    volumes: false,
                    chapters: false,
                    pendingEvents: false,
                });
                if (ctx) parts.push(ctx);
            }

            let mapCtx = `【地图】${map.name || ''}\n`;
            if (map.description) mapCtx += `${map.description}\n`;
            mapCtx += `\n【当前位置】${region?.name || '未知区域'}`;
            if (region?.description) mapCtx += `\n${region.description}`;

            const siblings = map.entities.filter(e =>
                e.region === region?.id && e.id !== ent.id && !e.isPlayer
            );
            if (siblings.length > 0) {
                mapCtx += `\n\n【附近的其他实体】`;
                for (const s of siblings) {
                    mapCtx += `\n- ${s.emoji} ${s.name}（${s.kind}）${s.description ? '：' + s.description : ''}`;
                }
            }

            parts.push(mapCtx);

            if (window.PlayerStateManager) {
                parts.push(window.PlayerStateManager.formatForPrompt());
            }

            return parts.join('\n\n');
        },

        _formatEntityStats(ent) {
            const lines = [];
            if (ent.status) lines.push(`状态：${ent.status}`);
            if (ent.effect) lines.push(`功能：${ent.effect}`);

            for (const [k, v] of Object.entries(ent.fields || {})) {
                if (k.startsWith('_pos')) continue;
                if (['图标', 'icon', '类型', '状态', '功能'].includes(k)) continue;
                lines.push(`${k}：${v}`);
            }

            const extra = ent.extraStats;
            if (extra?._order?.length) {
                for (const k of extra._order) {
                    if (extra[k] !== undefined && extra[k] !== '') {
                        lines.push(`${k}：${extra[k]}`);
                    }
                }
            }

            return lines.length > 0 ? '\n' + lines.join('\n') : '';
        },
    };

    // ============================================================
    // ★ 战斗结束回调：地图实体 + 场景实体都处理
    // ============================================================
    if (window.BattleManager) {
        window.BattleManager._onBattleEnd = function (combat) {
            if (!combat || combat.result !== 'victory') return;
            if (!combat.enemyItemName) return;

            // ---------- 1. 地图实体 ----------
            const map = window.MapLauncher?.getMap?.();
            if (map) {
                const ent = map.entities.find(e =>
                    e.name === combat.enemyItemName &&
                    e.countMode === 'cluster' &&
                    e.count > 1
                );
                if (ent) {
                    ent.count -= 1;
                    console.log(`[MapInteract] 地图集群实体 ${ent.name} 剩余 ${ent.count}`);

                    if (ent.count <= 0) {
                        const idx = map.entities.findIndex(e => e.id === ent.id);
                        if (idx > -1) map.entities.splice(idx, 1);
                        window.UIManager.showText(`${ent.name} 已被清除`, 1500);
                    } else {
                        window.UIManager.showText(`${ent.name} 还剩 ${ent.count} 个`, 1500);
                    }

                    if (window.MapCanvas?.canvas) window.MapCanvas._render();
                    window.MapLauncher?._saveMapToWorld?.(map);
                }
            }

            // ---------- 2. 场景实体 ----------
            const scene = window.LocationModalManager?.currentLocation;
            if (scene?.sceneItems) {
                const idx = scene.sceneItems.findIndex(i => i.name === combat.enemyItemName);
                if (idx > -1) {
                    const item = scene.sceneItems[idx];
                    if ((item.count || 1) > 1) {
                        item.count -= 1;
                    } else {
                        scene.sceneItems.splice(idx, 1);
                    }
                    if (window.SceneEditorManager?._rebuildRaw) {
                        window.SceneEditorManager._rebuildRaw(scene);
                    }
                }
            }
        };
    }


    window.MapInteract = MapInteract;
    console.log('[CinemaWorld] map-interact.js 已加载');
})();