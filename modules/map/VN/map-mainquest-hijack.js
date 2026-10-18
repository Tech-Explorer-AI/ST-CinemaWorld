// ============================================================
// CinemaWorld · map-mainquest-hijack.js
// 主线触发劫持层
//
// 设计原则：
//   - 有主线时：所有剧情围绕主线推进（快速推进 / 脚本对话）
//   - 无主线时：仍允许创建自由剧情（快速生成），脚本对话不开放
//   - 绝不在无地图/无主线时自动生成初始主线
//
// 劫持入口：
//   1. MapInteract.triggerMainQuestEntity  —— 地图任务点（实体）
//   2. MapInteract.triggerMainQuestCell    —— 地图任务点（格子）
//   3. MapInteract.enterPortal             —— 主线出入口（portal 分支）
//   4. StoryManager.createStory            —— 浮动按钮"新剧情"/"继续剧情"
//
// 依赖：map-interact.js, story.js, main-quest.js, map-dialogue.js, map-mainquest-dialogue.js
// 暴露：window.MapMainQuestHijack
// ============================================================

(function () {
    'use strict';

    if (window.MapMainQuestHijack) return;

    const Hijack = {
        _installed: false,
        _originals: {},

        // ============================================================
        // 安装 / 卸载
        // ============================================================
        install() {
            if (this._installed) return;

            if (!window.MapInteract) {
                console.warn('[MapMainQuestHijack] MapInteract 未加载，跳过安装');
                return;
            }
            if (!window.StoryManager) {
                console.warn('[MapMainQuestHijack] StoryManager 未加载，跳过安装');
                return;
            }

            // 1. 地图任务点（实体）
            this._originals.triggerMainQuestEntity = window.MapInteract.triggerMainQuestEntity;
            window.MapInteract.triggerMainQuestEntity = (entityId) =>
                this._hijackEntityTrigger(entityId);

            // 2. 地图任务点（格子）
            this._originals.triggerMainQuestCell = window.MapInteract.triggerMainQuestCell;
            window.MapInteract.triggerMainQuestCell = (mq) =>
                this._hijackCellTrigger(mq);

            // 3. 主线出入口
            this._originals.enterPortal = window.MapInteract.enterPortal;
            window.MapInteract.enterPortal = (entityId) =>
                this._hijackEnterPortal(entityId);

            // 4. 浮动按钮剧情入口
            this._originals.createStory = window.StoryManager.createStory;
            window.StoryManager.createStory = (userPrompt, parentStory, options) =>
                this._hijackCreateStory(userPrompt, parentStory, options);

            // 5. 浮动按钮剧情列表（补"无章节"时的创建入口）
            this._originals.openStoryList = window.StoryManager.openStoryList;
            window.StoryManager.openStoryList = () => this._hijackOpenStoryList();

            this._installed = true;
            console.log('[MapMainQuestHijack] 已安装');
        },

        uninstall() {
            if (!this._installed) return;
            if (this._originals.openStoryList) {
                window.StoryManager.openStoryList = this._originals.openStoryList;
            }
            if (this._originals.triggerMainQuestEntity) {
                window.MapInteract.triggerMainQuestEntity = this._originals.triggerMainQuestEntity;
            }
            if (this._originals.triggerMainQuestCell) {
                window.MapInteract.triggerMainQuestCell = this._originals.triggerMainQuestCell;
            }
            if (this._originals.enterPortal) {
                window.MapInteract.enterPortal = this._originals.enterPortal;
            }
            if (this._originals.createStory) {
                window.StoryManager.createStory = this._originals.createStory;
            }

            this._originals = {};
            this._installed = false;
            console.log('[MapMainQuestHijack] 已卸载');
        },
        // ============================================================
        // 劫持：剧情列表
        //   原本"无章节"时只有"关闭"按钮 → 补一个"新建章节"
        //   有章节 → 走原函数（原函数里的"创建新剧情"按钮会被
        //   createStory 劫持层接管，正常工作）
        // ============================================================
        async _hijackOpenStoryList() {
            const SM = window.StoryManager;
            const playMode = window.CinemaWorld?.worldState?.playMode || 'scene';
            const scene = window.LocationModalManager.currentLocation;

            // 场景模式下没有场景 → 让原函数处理
            if (playMode === 'scene' && !scene) {
                return this._originals.openStoryList?.call(SM);
            }

            const chapter = SM.currentChapter;

            // ★ 无章节：自定义渲染
            if (!chapter) {
                const modal = document.getElementById('cinemaworld-modal');
                modal.innerHTML = `
            <div class="cinemaworld-modal-title">📚 剧情列表</div>
            <div style="text-align:center;padding:40px 20px;color:#888;">
                <div style="font-size:40px;margin-bottom:15px;">📖</div>
                <div style="margin-bottom:12px;font-size:14px;">当前没有章节</div>
                <div style="font-size:12px;color:#666;margin-bottom:20px;">
                    创建第一个章节来开始记录剧情
                </div>
                <button class="cinemaworld-button primary"
                    onclick="MapMainQuestHijack._createFirstChapter()">
                    ➕ 新建章节
                </button>
            </div>
            <div style="text-align:center;margin-top:20px;">
                <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
            </div>
        `;
                modal.className = 'active';
                return;
            }

            // ★ 有章节 → 走原函数
            return this._originals.openStoryList?.call(SM);
        },

        _createFirstChapter() {
            const SM = window.StoryManager;
            window.UIManager.closeModal();

            // 确保有当前卷
            if (!SM.currentVolume) {
                window.ChapterManager.startNewVolume();
            }

            const newChapter = window.ChapterManager.createChapter(
                `第${SM.chapters.length + 1}章`
            );

            window.UIManager.showText(`已创建章节：${newChapter.title}`, 1500);

            // 重开剧情列表 → 走"有章节 + 无剧情"分支（有"创建新剧情"）
            setTimeout(() => this._hijackOpenStoryList(), 200);
        },
        // ============================================================
        // 劫持：实体触发
        // ============================================================
        async _hijackEntityTrigger(entityId) {
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            if (!mq?.active || mq.status !== 'active') return;

            const map = window.MapLauncher.getMap();
            const ent = map?.entities?.find(e => e.id === entityId);
            if (!ent) return;

            await this._dispatchTrigger({
                entity: ent,
                targetKind: 'entity',
                map,
                mq,
            });
        },

        // ============================================================
        // 劫持：格子触发
        // ============================================================
        async _hijackCellTrigger(mq) {
            if (!mq?.active || mq.status !== 'active') return;

            const map = window.MapLauncher.getMap();
            await this._dispatchTrigger({
                entity: null,
                targetKind: 'cell',
                map,
                mq,
            });
        },

        // ============================================================
        // 劫持：出入口（仅主线分支）
        // ============================================================
        async _hijackEnterPortal(entityId) {
            const map = window.MapLauncher?.getMap?.();
            const portal = map?.entities?.find(e => e.id === entityId);
            if (!portal || portal.kind !== 'portal') {
                return this._originals.enterPortal?.call(window.MapInteract, entityId);
            }

            const mq = window.CinemaWorld?.worldState?.mainQuest;
            const isMainPortal = mq?.active && mq.status === 'active'
                && mq.target?.kind === 'portal'
                && mq.target?.portalId === entityId;

            if (!isMainPortal) {
                return this._originals.enterPortal?.call(window.MapInteract, entityId);
            }

            await this._dispatchTrigger({
                entity: portal,
                targetKind: 'portal',
                map,
                mq,
            });
        },

        // ============================================================
        // 劫持：浮动按钮剧情入口
        //   ★ 无主线时不再自动生成初始主线
        //   ★ 无主线时允许"快速生成"自由剧情
        //   ★ 无主线时不开放"脚本对话"
        // ============================================================
        // ============================================================
        // 劫持：浮动按钮剧情入口
        //   - 场景模式：不劫持（走原 createStory，自由剧情）
        //   - 地图模式 + 无主线：不劫持（走原 createStory，让玩家自己决定）
        //   - 地图模式 + 有主线：弹模式选择框
        // ============================================================
        async _hijackCreateStory(userPrompt, parentStory, options) {
            // ---------- 内部回流：快速模式 ----------
            if (options && options._hijackQuickMode) {
                return this._createStoryDirect({
                    mainQuest: options.mainQuest,
                    targetEntity: options.targetEntity || null,
                    targetKind: options.targetKind || 'manual',
                    playerInput: options.playerInput || '',
                    parentStory: parentStory || null,
                });
            }

            // ---------- 内部回流：对话模式 ----------
            if (options && options._hijackDialogueMode) {
                return this._runDialogueDirect({
                    mainQuest: options.mainQuest,
                    entity: options.entity || null,
                    targetKind: options.targetKind || 'manual',
                    playerInput: options.playerInput || '',
                    parentStory: parentStory || null,
                });
            }

            // ---------- 检查 playMode ----------
            const playMode = window.CinemaWorld?.worldState?.playMode || 'scene';

            // ★ 场景模式：不劫持，走原逻辑
            if (playMode === 'scene') {
                return this._originals.createStory?.call(
                    window.StoryManager, userPrompt, parentStory, options
                );
            }

            // ---------- 地图模式 ----------
            const mq = window.CinemaWorld?.worldState?.mainQuest;

            // ★ 地图模式但没有主线 → 不劫持，走原逻辑
            //    （主线由 MainQuestManager.onMapBuilt 在首次地图加载时自动生成，
            //      不需要在这里重复生成）
            if (!mq?.active) {
                return this._originals.createStory?.call(
                    window.StoryManager, userPrompt, parentStory, options
                );
            }

            // ---------- 地图模式 + 有主线 → 弹模式选择框 ----------
            const targetName = parentStory
                ? `继续：${parentStory.title || '上一段剧情'}`
                : '当前剧情';

            const choice = await this._askMode(mq, targetName);
            if (!choice) return;

            mq.status = 'triggered';

            if (choice.mode === 'quick') {
                return this._createStoryDirect({
                    mainQuest: mq,
                    targetEntity: null,
                    targetKind: 'manual',
                    playerInput: choice.input,
                    parentStory: parentStory || null,
                });
            } else if (choice.mode === 'dialogue') {
                return this._runDialogueDirect({
                    mainQuest: mq,
                    entity: null,
                    targetKind: 'manual',
                    playerInput: choice.input,
                    parentStory: parentStory || null,
                });
            }
        },

        // ============================================================
        // 统一触发流程（地图触发点）
        // ============================================================
        async _dispatchTrigger({ entity, targetKind, map, mq }) {
            const targetName = entity?.name
                || (targetKind === 'cell' ? '这里' : '某个地点');

            const choice = await this._askMode(mq, targetName, false);
            if (!choice) return;

            mq.status = 'triggered';

            window.MapLauncher._closeSubPanel?.();
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            window.MapLauncher._saveMapToWorld?.(map);

            if (choice.mode === 'quick') {
                return this._createStoryDirect({
                    mainQuest: mq,
                    targetEntity: entity,
                    targetKind,
                    playerInput: choice.input,
                    parentStory: null,
                });
            } else if (choice.mode === 'dialogue') {
                return this._runDialogueDirect({
                    mainQuest: mq,
                    entity,
                    targetKind,
                    playerInput: choice.input,
                    parentStory: null,
                });
            }
        },

        // ============================================================
        // 模式选择框（唯一模态框）
        //   ★ mq 可为 null
        //   ★ 无主线时只显示"快速生成"
        // ============================================================
        _askMode(mq, targetName, isContinue = false) {
            return new Promise((resolve) => {
                const hasMainQuest = !!mq?.active;

                const title = hasMainQuest
                    ? `⭐ ${this._esc(mq.title)}`
                    : (isContinue ? '📖 继续剧情' : '📖 创建新剧情');

                const hintHTML = hasMainQuest
                    ? `<div style="text-align:center;padding:14px;color:#ffd76b;font-size:14px;
                        background:rgba(255,215,100,.08);border-radius:10px;margin-bottom:16px;">
                        ${this._esc(mq.hint || '')}
                    </div>`
                    : '';

                const dialogueBtnHTML = hasMainQuest
                    ? `<button class="cinemaworld-button primary" id="cw-mq-dialogue"
                            style="background:linear-gradient(135deg,#7da8ff,#5b8bd9);">
                            💬 脚本对话
                        </button>`
                    : '';

                const gridCols = hasMainQuest ? '1fr 1fr' : '1fr';

                const html = `
                    <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">
                        ${title}
                    </div>
                    ${hintHTML}
                    <div style="text-align:center;font-size:13px;color:#aaa;margin-bottom:16px;">
                        📍 ${this._esc(targetName)}
                    </div>
                    <div style="margin-bottom:16px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:6px;">
                            你想怎么做？（可选）
                        </div>
                        <textarea class="cinemaworld-textarea" id="cw-mq-input"
                            placeholder="例如：我深吸一口气，推开了门。&#10;（留空则由 AI 自行开场）"
                            style="min-height:80px;width:100%;box-sizing:border-box;"></textarea>
                    </div>

                    <div style="font-size:12px;color:#888;text-align:center;margin-bottom:10px;">
                        选择推进方式
                    </div>
                    <div style="display:grid;grid-template-columns:${gridCols};gap:10px;margin-bottom:16px;">
                        <button class="cinemaworld-button primary" id="cw-mq-quick"
                            style="background:linear-gradient(135deg,#ffb84d,#ff8a3d);">
                            ⚡ ${hasMainQuest ? '快速推进' : '快速生成'}
                        </button>
                        ${dialogueBtnHTML}
                    </div>
                    <div style="text-align:center;">
                        <button class="cinemaworld-button" id="cw-mq-cancel">暂不</button>
                    </div>
                `;

                this._openModal(html);

                const getInput = () =>
                    document.getElementById('cw-mq-input')?.value.trim() || '';

                document.getElementById('cw-mq-quick').onclick = () => {
                    this._closeModal();
                    resolve({ mode: 'quick', input: getInput() });
                };
                document.getElementById('cw-mq-dialogue')?.addEventListener('click', () => {
                    this._closeModal();
                    resolve({ mode: 'dialogue', input: getInput() });
                });
                document.getElementById('cw-mq-cancel').onclick = () => {
                    this._closeModal();
                    resolve(null);
                };
            });
        },

        // ============================================================
        // 快速模式：直接生成完整剧情卡 → playStory → 选项 → 效果 → 主线推进
        //   ★ 不要求有主线
        // ============================================================
        async _createStoryDirect({
            mainQuest,
            targetEntity,
            targetKind,
            playerInput,
            parentStory,
        }) {
            const SM = window.StoryManager;
            const mq = mainQuest || window.CinemaWorld?.worldState?.mainQuest || null;

            // 保证有当前章节
            if (!SM.currentChapter) {
                window.ChapterManager.createChapter(`第${SM.chapters.length + 1}章`);
            }

            await window.UIManager.showText(
                mq?.active ? '正在生成主线剧情…' : '正在生成剧情…',
                1200
            );

            let rawText;
            try {
                const prompt = this._buildStoryPrompt({
                    parentStory,
                    mainQuest: mq,
                    targetEntity,
                    targetKind,
                    playerInput,
                });
                rawText = await window.generateFunctionalReply(prompt, 'story-generation');
            } catch (e) {
                console.error('[MapMainQuestHijack] 生成剧情失败:', e);
                await window.UIManager.showText('生成失败：' + e.message, 3000);
                return;
            }

            if (!rawText) {
                await window.UIManager.showText('剧情生成失败', 2000);
                return;
            }

            await this._parseAndPlayStory(rawText, parentStory);
        },

        // ============================================================
        // 解析并播放
        // ============================================================
        async _parseAndPlayStory(rawText, parentStory) {
            const SM = window.StoryManager;
            const story = SM.parseStory(rawText);
            if (!story) {
                await window.UIManager.showText('剧情格式错误', 2000);
                return;
            }

            story.id = `story_${Date.now()}`;
            story.parentId = parentStory?.id || null;
            story.chapterId = SM.currentChapter?.id || null;
            story.order = SM.storyList.filter(s => s.chapterId === story.chapterId).length + 1;
            story.createdAt = Date.now();
            story.status = 'active';
            story.chosenOption = null;
            story._played = false;
            story._sceneSwitchHandled = false;
            story._appliedEffects = {};

            SM.storyList.push(story);
            if (SM.currentChapter) {
                SM.currentChapter.storyIds.push(story.id);
                SM.currentChapter.events.push({
                    type: 'story-create',
                    storyId: story.id,
                    title: story.title,
                    summary: `创建剧情: ${story.title}`,
                    timestamp: Date.now(),
                });
            }

            await SM.playStory(story);
            if (window.SaveManager) window.SaveManager.save();
        },

        // ============================================================
        // 脚本对话模式
        //   ★ 必须有主线（无主线时 UI 上不显示按钮，这里是二重保护）
        // ============================================================
        async _runDialogueDirect({
            mainQuest,
            entity,
            targetKind,
            playerInput,
            parentStory,
        }) {
            if (!window.MapMainQuestDialogue) {
                await window.UIManager.showText('脚本对话模式未加载', 2000);
                return;
            }

            const mq = mainQuest || window.CinemaWorld?.worldState?.mainQuest;
            if (!mq?.active) {
                await window.UIManager.showText('脚本对话模式需要主线', 2000);
                return;
            }

            await window.MapMainQuestDialogue.start(mq, {
                entity: entity || null,
                targetKind: targetKind || 'manual',
                playerInput: playerInput || '',
                openingGuide: playerInput || '',
                compactContext: false,
                parentStory: parentStory || null,
            });
        },

        // ============================================================
        // 构建剧情 prompt
        //   ★ 无主线时：不输出主线推进 / 切换地图块
        // ============================================================
        _buildStoryPrompt({
            parentStory,
            mainQuest,
            targetEntity,
            targetKind,
            playerInput,
        }) {
            const SM = window.StoryManager;
            const context = SM.buildContext(parentStory, { companions: true });
            const scene = window.LocationModalManager.currentLocation;
            const envLine = window.WorldManager.getEnvDataText(scene);
            const playerBlock = window.PlayerStateManager.formatForPrompt();
            const playMode = window.CinemaWorld?.worldState?.playMode || 'scene';

            const mq = mainQuest;
            const hasMainQuest = !!mq?.active;
            const storyKind = hasMainQuest ? '主线剧情' : '剧情';

            // 场景切换（仅 scene 模式）
            const sceneSwitchBlock = playMode === 'scene' ? `
【场景切换】（可选，玩家移动到新地点时写）
目标场景: 场景名
预制人物: [人物1, 人物2]
预制物品: [物品1, 物品2]
原因: 切换原因
（场景切换和场景更新可以同时存在）
` : '';

            // 场景更新（仅 scene 模式）
            const sceneUpdateBlock = playMode === 'scene' ? `
【场景更新】（可选，只有场景变化才写，没变化完全省略）
场景: (场景名)
环境数据: 
- 已有键:新值   （只改已有键，不发明新键）
新增人物: 
- 【名|性别|心情|好感度|状态|主次】：描述，[标签]
修改人物: 
- 【名】：心情|新值   （字段限：心情/状态/描述/标签）
移除人物: 名1、名2
新增实体: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
物品: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
装备: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]
移除实体: 名1、名2
修改实体: 
- 【名】：状态→新状态
场景状态: 
- 键: 值
` : '';

            // 主线上下文（仅 map 模式 + 有主线）
            const mainQuestContextBlock = (playMode === 'map' && hasMainQuest) ? `
【当前主线任务】
标题: ${mq.title}
提示: ${mq.hint || ''}
${targetEntity ? `触发点: ${targetEntity.name}（${targetEntity.kind}）` : ''}
${targetKind === 'cell' ? '触发点: 玩家走到了一处关键位置' : ''}
${playerInput ? `玩家行动: ${playerInput}` : ''}
` : '';

            // 切换地图（仅 map 模式 + 有主线）
            const newMapBlock = (playMode === 'map' && hasMainQuest) ? `
【切换地图】（★ 可选，仅当主线推进需要一张当前不存在的新地图时输出）
名称: (新地图的名字)
描述: (一句话，这张地图的氛围)
参考: (为什么需要这张地图，和当前剧情的关系)

★ 如果下一步主线在已有地图里，不写这一块。
★ 如果写了【切换地图】，【主线推进】里的"目标地图"应该引用这个名称。
` : '';

            // 主线推进输出格式（仅 map 模式 + 有主线）
            const mainQuestOutputBlock = (playMode === 'map' && hasMainQuest) ? `
【主线推进】（★ 主线任务必须输出这一块，除非主线彻底结束）
目标: (下一步主线目标的名字)
提示: (一句话提示玩家去哪儿)
落点: 格子 或 实体 或 出入口
地图: (地图名，必须用【当前地图】里的名称)
区域: (★ 必须用【地图区域列表】里的 id，不要翻译，不要自己编)
位置: (落点=格子时填，锚点名如 center/north/south/east/west/entrance)
实体名: (落点=实体时填)
实体图标: (落点=实体时填一个 emoji)
实体描述: (落点=实体时填)
出入口名: (落点=出入口时填)
出入口描述: (落点=出入口时填)
目标地图: (落点=出入口时填，不填表示指向已有出入口)

★ 如果主线彻底结束，不写这一块。
★ 如果下一步目标在当前地图之外，还是写出来，程序会记下指针。
` : '';

            // 上一步剧情
            const parentStoryBlock = parentStory ? `
【本剧情的上一步】
标题: ${parentStory.title}
${parentStory.summary ? `摘要: ${parentStory.summary}` : ''}
${parentStory.chosenOption ? `玩家选择: ${parentStory.chosenOption.text}` : ''}
` : '';

            return `你是视觉小说剧本作家。生成一段${storyKind}。

【世界状态】
${context}

${parentStoryBlock}

★ 环境数据：${envLine}

${playerBlock}

${mainQuestContextBlock}

【剧情要求】
${playerInput || (hasMainQuest
                    ? '根据当前世界状态和主线任务，生成一段推进主线的剧情。'
                    : '根据当前世界状态，生成一段自然推进的剧情。')}

【输出格式】（严格遵守）

【剧情】
类型: ${hasMainQuest ? '主线' : '剧情'}
标题: (剧情标题)
场景: (当前场景名，切换则写新场景名)
🎵 音乐: (可选，如"日常"、"紧张"、"温馨")

【摘要】
(2-4 句。谁出场、发生什么、达成什么、玩家选择导致什么。作为下次生成的上下文)

【对话】
【人物名|显示/隐藏|左/中/右|性别|状态】: 内容
【玩家|显示|中|性别|状态】: 内容
【旁白】: 环境描写或心理活动

【效果】
目标: 玩家 或 角色名
数值变化: 键名 +N  或  键名 -N
实体变化:
- 获得【物品名|图标】：描述，[类型|状态|功能:一句话介绍|交互方式|效果:效果DSL|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 失去【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
- 获得状态 状态名
- 移除状态 状态名

★ 关键：获得物品时必须写完整格式（方括号内 键:值），否则玩家拿到的是空壳。
★ 可装备物品：写明属性字段，如 [类型:武器|攻击:+5|暴击:+10%]
★ 可消耗物品：写明功能，如 [类型:消耗品|功能:回复 50 点生命|可堆叠]

说明：效果DSL:<动作><目标> <值>[; <动作><目标> <值>...]

动作：
- 回复：当前值+N，不超上限（如"回复生命 X"）
- 提升：上限+N，当前值同步+N（如"提升生命上限 X"）
- 设置：当前值=N（如"设置生命 X"）
- 减少：当前值-N（如"减少理智 Y"）
- 永久：永久改变属性（如"永久力量 X"）
- 状态：加状态（如"状态中毒 X"）
- 移除：移除状态（如"移除中毒"）
- 增益：临时属性加成（如"增益攻击 X Y回合"）

值可以是数字或百分比：回复生命 X / 回复生命 X%
多效果用分号分隔：回复生命 X; 回复体力 X
无效果的物品写 效果:无

【选项】（2-4 个，每个选项后紧跟唯一一个【效果】块）
A. 选项内容
B. 选项内容

${sceneUpdateBlock}
${sceneSwitchBlock}
${mainQuestOutputBlock}
${newMapBlock}

【规则】
1. 对话行: 说话者"显示"，其他"隐藏"；玩家写【玩家|显示|中|性别】
2. 场景更新只写"变化"的
3. 效果块可影响玩家或场景NPC。目标必须写在场景上下文里出现过的角色名。一次最多 2-3 个效果块
4. 每个选项后紧跟唯一一个【效果】块
5. 【摘要】必须写在【对话】之前
${playMode === 'map' ? '6. × 不要输出【场景切换】或【场景更新】（当前是地图模式）' : ''}

请开始生成：
`;
        },

        // ============================================================
        // 工具
        // ============================================================
        _openModal(html) {
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) {
                console.warn('[MapMainQuestHijack] 找不到 modal');
                return;
            }
            modal.className = 'active';
            modal.style.width = '';
            modal.style.maxWidth = '';
            modal.style.maxHeight = '92vh';
            modal.style.padding = '';
            modal.style.overflowY = 'auto';
            modal.style.boxSizing = 'border-box';
            modal.innerHTML = html;
        },

        _closeModal() {
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;
            modal.className = '';
            modal.innerHTML = '';
            modal.style.width = '';
            modal.style.maxWidth = '';
            modal.style.maxHeight = '';
            modal.style.padding = '';
            modal.style.overflowY = '';
            modal.style.boxSizing = '';
        },

        _esc(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
    };

    // ============================================================
    // 自动安装
    // ============================================================
    (function autoInstall() {
        if (window.MapInteract && window.StoryManager) {
            Hijack.install();
        } else {
            let retries = 0;
            const timer = setInterval(() => {
                retries++;
                if (window.MapInteract && window.StoryManager) {
                    clearInterval(timer);
                    Hijack.install();
                } else if (retries >= 50) {
                    clearInterval(timer);
                    console.warn('[MapMainQuestHijack] 依赖模块加载超时，未安装');
                }
            }, 100);
        }
    })();

    window.MapMainQuestHijack = Hijack;
    console.log('[CinemaWorld] map-mainquest-hijack.js 已加载');
})();