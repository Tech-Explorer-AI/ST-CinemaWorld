// ============================================================
// CinemaWorld · map-mainquest-dialogue.js
// 主线剧情 · 脚本对话模式
// 特性：
//   - 对话轮次纯对话（不产生效果/选项/主线推进）
//   - 结束时一次性生成：全局效果 + 选项 + 主线推进 + 切换地图 + 摘要
//   - 选项应用 + 全局效果应用 + 主线推进落地
//   - 对话脚本存历史，可随时重放
// 依赖：map-dialogue.js, map-interact.js, main-quest.js, story.js, ui.js, interact.js
// 暴露：window.MapMainQuestDialogue
// ============================================================

(function () {
    'use strict';

    const MapMainQuestDialogue = {
        // ============================================================
        // 状态
        // ============================================================
        _active: false,
        _ending: false,
        _mainQuest: null,
        _entity: null,
        _map: null,
        _chapterId: null,
        _targetKind: null,

        _scriptLines: [],
        _playerMessages: [],
        _roundPlayerMessages: [],
        _history: [],
        _historyVisible: false,
        _openingGuide: '',
        _playerInput: '',
        _useCompactContext: false,
        _compactContext: '',

        _isGenerating: false,
        _sessionId: null,
        _startedAt: 0,
        _parentStory: null,
        // 结算数据（结束时填充）
        _pendingEffect: '',
        _pendingOptions: [],
        _pendingMainQuestAdvance: null,
        _pendingNewMapRequest: null,
        _pendingSummary: '',
        _pendingStoryTitle: '', 

        // ============================================================
        // 入口
        // ============================================================
        async start(mainQuest, opts = {}) {
            if (this._active) {
                window.UIManager?.showText?.('已经有对话在进行中', 1500);
                return;
            }
            if (window.MapDialogue?.isActive?.()) {
                window.UIManager?.showText?.('请先结束当前的对话', 1500);
                return;
            }

            const map = window.MapLauncher?.getMap?.();
            const entity = opts.entity || null;
            this._parentStory = opts.parentStory || null;
            this._active = true;
            this._ending = false;
            this._mainQuest = mainQuest;
            this._entity = entity;
            this._map = map;
            this._chapterId = window.StoryManager?.currentChapter?.id || null;
            this._targetKind = opts.targetKind || 'manual';
            this._playerInput = opts.playerInput || '';
            this._openingGuide = (opts.openingGuide || '').trim();
            this._sessionId = `mqdlg_${Date.now()}`;
            this._startedAt = Date.now();

            this._scriptLines = [];
            this._playerMessages = [];
            this._roundPlayerMessages = [];
            this._history = [];
            this._isGenerating = false;
            this._historyVisible = false;

            this._pendingEffect = '';
            this._pendingOptions = [];
            this._pendingMainQuestAdvance = null;
            this._pendingNewMapRequest = null;
            this._pendingSummary = '';

            if (opts.compactContext) {
                await this._prepareCompactContext();
            } else {
                this._useCompactContext = false;
                this._compactContext = '';
            }

            await this._applyInitialMusic();

            // ★ 用 MapDialogue 的公共 UI API
            window.MapDialogue.renderUIFor(this);

            await this._generateNextRound(true);
        },

        isActive() { return this._active; },

        // ============================================================
        // 摘要模式上下文
        // ============================================================
        async _prepareCompactContext() {
            this._useCompactContext = true;
            await window.UIManager?.showText?.('正在准备对话上下文…', 1200);

            const mq = this._mainQuest;
            const fullCtx = this._buildFullContext();

            const prompt = `你正在为视觉小说游戏准备一段"主线剧情对话"的上下文摘要。
把下面这段完整上下文压缩成只保留与主线「${mq.title}」相关的前情提要。

【完整上下文】
${fullCtx}

【当前主线】
标题: ${mq.title}
提示: ${mq.hint || ''}

【压缩要求】
1. 保留：世界观、玩家处境、当前主线目标、与主线相关的关键角色与过往
2. 去掉：与主线无关的支线、无关角色、无关物品
3. 第三人称，"前情提要"式陈述
4. 300 字以内
5. 不要加任何前缀

请直接输出：`;

            const result = await window.generateFunctionalReply(prompt, 'mq-dialogue-compact-context');
            this._compactContext = result?.trim() || fullCtx;
        },
        // ============================================================
// 历史面板（主线独立实现）
// ============================================================
_toggleHistoryPanel() {
    if (this._historyVisible) this._hideHistoryPanel();
    else this._showHistoryPanel();
},

_showHistoryPanel() {
    const layer = document.getElementById('cinemaworld-vn-layer');
    if (!layer) return;

    this._historyVisible = true;

    let panel = document.getElementById('cw-dialogue-history-panel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'cw-dialogue-history-panel';
        panel.className = 'cw-dialogue-history-panel';
        panel.innerHTML = `
            <div class="cw-dialogue-history-inner">
                <div class="cw-dialogue-history-head">
                    <span>📜 对话历史</span>
                    <button class="cw-dialogue-history-close" id="cw-dialogue-history-close">✕</button>
                </div>
                <div class="cw-dialogue-history-body" id="cw-dialogue-history-body"></div>
            </div>
        `;
        layer.appendChild(panel);

        panel.querySelector('#cw-dialogue-history-close').addEventListener('click', (e) => {
            e.stopPropagation();
            this._hideHistoryPanel();
        });
        panel.addEventListener('click', (e) => {
            if (e.target === panel) this._hideHistoryPanel();
        });
    }

    panel.classList.add('active');
    this._renderHistoryPanel();
},

_hideHistoryPanel() {
    this._historyVisible = false;
    document.getElementById('cw-dialogue-history-panel')?.classList.remove('active');
},

_renderHistoryPanel() {
    const body = document.getElementById('cw-dialogue-history-body');
    if (!body) return;

    // 首次渲染或已在底部时，渲染后滚到底
    const isFirstRender = !body.dataset.rendered;
    const atBottom = isFirstRender ||
        (body.scrollHeight - body.scrollTop - body.clientHeight < 40);

    if (this._history.length === 0) {
        body.innerHTML = `<div class="cw-dialogue-history-empty">还没有对话</div>`;
        return;
    }

    let html = '';
    let lastSpeaker = null;

    for (const h of this._history) {
        // 旁白
        if (h.role === 'narrator') {
            html += `<div class="cw-dlg-h-narrator">${this._escape(h.content)}</div>`;
            lastSpeaker = null;
            continue;
        }

        // 玩家
        if (h.role === 'player') {
            html += `
                <div class="cw-dlg-h-row is-player">
                    <div class="cw-dlg-h-bubble">${this._escape(h.content)}</div>
                </div>`;
            lastSpeaker = h.character;
            continue;
        }

        // NPC
        const showName = lastSpeaker !== h.character;
        const avatar = this._getHistoryAvatar(h.character);

        html += `
            <div class="cw-dlg-h-row is-npc">
                <div class="cw-dlg-h-avatar" data-h-avatar="${this._escape(h.character)}">${avatar}</div>
                <div class="cw-dlg-h-col">
                    ${showName
                        ? `<div class="cw-dlg-h-name">${this._escape(h.character)}${h.state ? ` <span class="cw-dlg-h-state">· ${this._escape(h.state)}</span>` : ''}</div>`
                        : ''}
                    <div class="cw-dlg-h-bubble">${this._escape(h.content)}</div>
                </div>
            </div>`;
        lastSpeaker = h.character;
    }

    body.innerHTML = html;
    body.dataset.rendered = '1';

    // 异步补头像
    body.querySelectorAll('.cw-dlg-h-avatar').forEach(el => {
        const name = el.dataset.hAvatar;
        if (!name) return;
        window.SpriteManager?.ensureSprite?.(name).then(url => {
            if (!url) return;
            document.querySelectorAll(`[data-h-avatar="${CSS.escape(name)}"]`).forEach(e => {
                e.innerHTML = `<img src="${url}" alt="">`;
            });
        });
    });

    if (atBottom) body.scrollTop = body.scrollHeight;
},

_getHistoryAvatar(name) {
    if (window.SpriteManager) {
        const url = window.SpriteManager.getCachedSprite?.(name);
        if (url) return `<img src="${url}" alt="">`;
        window.SpriteManager.ensureSprite?.(name).then(url => {
            if (!url) return;
            document.querySelectorAll(`[data-h-avatar="${CSS.escape(name)}"]`).forEach(el => {
                el.innerHTML = `<img src="${url}" alt="">`;
            });
        });
    }
    return `<span>${(name || '?').charAt(0)}</span>`;
},
        // ============================================================
        // 完整上下文
        // ============================================================
        _buildFullContext() {
            const parts = [];

            // ========== 通用剧情上下文（复用 StoryManager.buildContext） ==========
            if (window.StoryManager) {
                try {
                    const ctx = window.StoryManager.buildContext(this._parentStory, {
                        world: true,
                        worldHistory: true,
                        volumes: true,
                        chapters: true,
                        chapter: true,
                        parentStory: true,
                        interactionDigests: false,   // ★ 关掉全量，单独注入
                        scene: true,                 // ★ map 模式会注入地图上下文
                        mainChars: true,
                        pendingEvents: true,
                        companions: true,
                    });
                    if (ctx) parts.push(ctx);
                } catch (e) {
                    console.warn('[MapMainQuestDialogue] buildContext 失败:', e);
                }
            }

            // ========== 当前主线 ==========
            const mq = this._mainQuest;
            if (mq) {
                let mqBlock = `【当前主线】\n标题: ${mq.title}\n提示: ${mq.hint || ''}`;
                parts.push(mqBlock);
            }

            // ========== 触发点（如果有 entity） ==========
            if (this._entity) {
                let entBlock = `【触发点】\n名称: ${this._entity.name}\n类型: ${this._entity.kind}`;
                if (this._entity.description) entBlock += `\n描述: ${this._entity.description}`;
                if (this._entity.status) entBlock += `\n状态: ${this._entity.status}`;
                parts.push(entBlock);

                // 与这个实体的历史交互
                if (window.InteractionDigestManager && this._chapterId) {
                    try {
                        let digest = '';
                        if (typeof window.InteractionDigestManager.formatForMapEntityPrompt === 'function') {
                            digest = window.InteractionDigestManager.formatForMapEntityPrompt(
                                this._entity.name, this._chapterId
                            );
                        }
                        if (!digest && typeof window.InteractionDigestManager.formatForCharacterPrompt === 'function') {
                            digest = window.InteractionDigestManager.formatForCharacterPrompt(
                                this._entity.name, this._chapterId
                            );
                        }
                        if (digest) {
                            parts.push(`【与 ${this._entity.name} 的过往交互】\n${digest}`);
                        }
                    } catch (e) { }
                }
            }

            // ========== 玩家状态 ==========
            if (window.PlayerStateManager?.formatForPrompt) {
                parts.push(`【玩家状态】\n${window.PlayerStateManager.formatForPrompt()}`);
            }

            return parts.join('\n\n');
        },

        _getCurrentRegion() {
            const map = this._map;
            if (!map) return null;
            // 优先用玩家当前所在区域
            const canvas = window.MapCanvas;
            const player = canvas?.player;
            if (player && map._generated?.grid) {
                const cell = map._generated.grid[player.y]?.[player.x];
                if (cell?.regionId) {
                    return map.regions?.find(r => r.id === cell.regionId) || null;
                }
            }
            // 兜底：主线目标区域
            const regionId = this._mainQuest?.target?.regionId;
            if (regionId) return map.regions?.find(r => r.id === regionId) || null;
            // 再兜底：起点
            return map.regions?.find(r => r.id === map.startRegion) || null;
        },

        async _applyInitialMusic() {
            if (!window.MusicManager) return;
            const musicName = window.MusicManager.mapMusic
                || window.MusicManager.baseMusic
                || null;
            if (musicName) {
                await window.MusicManager.setScopedMusic('dialogue', musicName);
            }
        },

        // ============================================================
        // 生成下一轮对话（纯对话）
        // ============================================================
        async _generateNextRound(isFirst = false) {
            if (this._isGenerating) return;
            this._isGenerating = true;

            try {
                window.MapDialogue.showThinkingFor(this);
                const prompt = this._buildScriptPrompt(isFirst);
                const result = await window.generateFunctionalReply(prompt, 'mq-dialogue-round');
                window.MapDialogue.hideThinkingFor(this);

                if (!result) {
                    await window.UIManager?.showText?.('生成失败，可以重试或结束', 2000);
                    if (this._active) this._enterPlayerTurn();
                    return;
                }

                const parsed = this._parseScriptRound(result);
                await this._playScriptRound(parsed);

                if (this._active) {
                    this._enterPlayerTurn();
                }
            } catch (e) {
                console.error('[MapMainQuestDialogue] 生成失败:', e);
                window.MapDialogue.hideThinkingFor(this);
                window.UIManager?.showText?.('生成失败：' + e.message, 2500);
                if (this._active) this._enterPlayerTurn();
            } finally {
                this._isGenerating = false;
            }
        },

        // ============================================================
        // 对话 prompt（纯对话）
        // ============================================================
        _buildScriptPrompt(isFirst) {
            const mq = this._mainQuest;
            const map = this._map;
            const ent = this._entity;
            const playerName = this._getPlayerName();

            const ctxBlock = (this._useCompactContext && this._compactContext)
                ? `【前情提要】\n${this._compactContext}`
                : this._buildFullContext();

            const scriptBlock = this._scriptLines.length > 0
                ? this._scriptLines.map(l => this._formatScriptLine(l)).join('\n')
                : '';

            const playerBlock = this._playerMessages.length > 0
                ? this._playerMessages.map(m => `【${playerName}|显示|中|未知|】: ${m}`).join('\n')
                : '';

            const openingBlock = isFirst && (this._openingGuide || this._playerInput)
                ? `\n【玩家的描述】（这是玩家自己描述的，务必尊重，不要违背）\n${this._openingGuide || this._playerInput}\n`
                : '';

            const targetBlock = ent
                ? `【触发点】\n名称: ${ent.name}\n类型: ${ent.kind}\n${ent.description ? `描述: ${ent.description}\n` : ''}`
                : `【触发点】\n（${this._targetKind === 'cell' ? '格子触发' : '主线触发'}）\n`;

            const taskLine = isFirst
                ? `生成主线剧情的【开场对话】：玩家刚刚触发了主线目标，主线正在推进。从环境/相关角色/旁白开始。`
                : `继续生成主线剧情对话：从上一轮结束的地方继续，推动主线发展，直到自然轮到玩家。`;

            return `你正在为视觉小说游戏生成一段【主线剧情对话】。
这是一段真正的对话，${playerName}会自己说话，你绝对不要替${playerName}说话。

${ctxBlock}

${openingBlock}
【当前主线】
标题: ${mq.title}
提示: ${mq.hint || ''}

${targetBlock}

【已进行的对话】
${scriptBlock || '（尚未开始）'}

【${playerName}已说的话】
${playerBlock || '（还没有说话）'}

【本段任务】
${taskLine}

【输出格式】（严格遵守）
🎵 音乐：曲名
背景：背景图片名
每行: 【角色名|显示/隐藏|左/中/右|性别|状态】: 内容
旁白: 【旁白】: 内容

【规则】
1. 绝对不要替${playerName}说话！${playerName}会自己说。轮到${playerName}时，你就停。
2. 只能使用当前场景/对话中出现的角色
3. 每段输出 3-12 行，控制在"${playerName}该说话了"这个自然停顿点
4. 说话者"显示"，其他"隐藏"
5. 旁白用来描述环境、心理、动作，不要代替${playerName}做决定
6. 状态字段可以写心情（用于立绘表情）
7. ★ 只输出对话。不要输出【效果】【选项】【主线推进】【切换地图】【场景更新】——这些会在对话结束时统一结算。
8. 如果对话自然到达一个关键决策点（需要玩家做重要选择），可以用旁白暗示"该做决定了"，但不要替玩家做决定
9. 如果对话自然结束（如角色告别），可以用旁白收尾，但不要在${playerName}还没说话时强行结束

【示例】
🎵 音乐: 紧张
【${ent?.name || '守护者'}|显示|中|未知|警戒】: 你终于来了。
【旁白】: 他缓缓抬起手，将剑横在身前。
【${ent?.name || '守护者'}|显示|中|未知|平静】: 想过去，得先过我这一关。

请开始生成：`;
        },

        // ============================================================
        // 解析对话轮次（只解析对话）
        // ============================================================
        _parseScriptRound(text) {
            const out = { lines: [], music: null, background: null };

            const musicMatch = text.match(/🎵\s*音乐\s*[:：]\s*(.+)/);
            if (musicMatch) out.music = musicMatch[1].trim();

            const bgMatch = text.match(/(?:【背景】|^背景)\s*[:：]\s*(.+)$/m);
            if (bgMatch) out.background = bgMatch[1].trim();

            // 只截取对话部分（丢弃任何可能混入的其他块）
            let bodyText = text
                .replace(/【效果】[\s\S]*?(?=\n【|$)/g, '')
                .replace(/【选项】[\s\S]*?(?=\n【|$)/g, '')
                .replace(/【主线推进】[\s\S]*?(?=\n【|$)/g, '')
                .replace(/【切换地图】[\s\S]*?(?=\n【|$)/g, '')
                .replace(/【场景更新】[\s\S]*?(?=\n【|$)/g, '')
                .replace(/【摘要】[\s\S]*?(?=\n【|$)/g, '')
                .trim();

            const normalized = window.MapDialogue._splitInlineDialogues
                ? window.MapDialogue._splitInlineDialogues(bodyText)
                : bodyText;

            const dialogues = window.VisualNovelManager.parseScript(normalized);
            const playerName = this._getPlayerName();

            for (const d of dialogues) {
                const isNarrator = ['旁白', '系统', 'narrator'].includes(d.character);
                const isPlayer = ['玩家', '我', '主人公', 'player'].includes(d.character)
                    || d.character === playerName;
                if (isPlayer) continue;

                out.lines.push({
                    role: isNarrator ? 'narrator' : 'npc',
                    character: d.character,
                    visibility: d.visibility,
                    position: d.position,
                    gender: d.extraInfo,
                    state: d.state,
                    content: d.content,
                });
            }

            return out;
        },

        // ============================================================
        // 播放一轮
        // ============================================================
        async _playScriptRound(parsed) {
            if (parsed.lines.length === 0) return;
            this._scriptLines.push(...parsed.lines);

            if (parsed.background) {
                await window.MapDialogue._applyRoundBackground(parsed.background);
            }
            if (parsed.music) {
                await window.MapDialogue._applyRoundMusic(parsed.music);
            }

            // ★ 记录本轮起始索引（供 TTS 关联）
            const startIdx = this._scriptLines.length - parsed.lines.length;

            const vnDialogues = parsed.lines.map((l, i) => {
                const base = { __ttsIndex: startIdx + i };   // ★ 关键
                if (l.role === 'narrator') {
                    return {
                        ...base,
                        character: '旁白',
                        visibility: 'visible',
                        position: 'center',
                        extraInfo: '',
                        state: '',
                        content: l.content,
                    };
                }
                return {
                    ...base,
                    character: l.character,
                    visibility: l.visibility,
                    position: l.position,
                    extraInfo: l.gender,
                    state: l.state,
                    content: l.content,
                };
            });

            vnDialogues.forEach(d => this._pushHistory(d));
            await window.VisualNovelManager.play(vnDialogues);
        },

        _formatScriptLine(l) {
            if (l.role === 'narrator') return `【旁白】: ${l.content}`;
            if (l.role === 'player') return `【${this._getPlayerName()}|显示|中|未知|】: ${l.content}`;
            const meta = [
                l.character,
                l.visibility === 'hidden' ? '隐藏' : '显示',
                l.position === 'left' ? '左' : l.position === 'right' ? '右' : '中',
                l.gender || '未知',
                l.state || '',
            ].join('|');
            return `【${meta}】: ${l.content}`;
        },

        _pushHistory(d) {
            const isNarrator = ['旁白', '系统', 'narrator'].includes(d.character);
            const isPlayer = ['玩家', '我', '主人公', 'player'].includes(d.character)
                || d.character === this._getPlayerName();

            this._history.push({
                id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                role: isNarrator ? 'narrator' : (isPlayer ? 'player' : 'npc'),
                character: isNarrator ? '旁白' : (isPlayer ? this._getPlayerName() : d.character),
                content: d.content,
                gender: d.extraInfo || '',
                state: d.state || '',
                timestamp: Date.now(),
                isPlayer,
            });
        },

        // ============================================================
        // 玩家回合
        // ============================================================
        async _enterPlayerTurn() {
            if (!this._active) return;
            window.MapDialogue.setButtonsDisabledFor(this, false);

            // ★ 先确保 layer 激活 + 立绘就位
            await this._ensureCharacterSpritesOnStage().catch(e =>
                console.warn('[MapMainQuestDialogue] 立绘加载失败:', e)
            );

            // ★ 再显示输入栏
            window.MapDialogue.showPlayerInputFor(this);
        },

        async _ensureCharacterSpritesOnStage() {
            const VN = window.VisualNovelManager;
            const SpriteMgr = window.SpriteManager;
            if (!VN || !SpriteMgr) return;
        
            const layer = document.getElementById('cinemaworld-vn-layer');
            if (!layer) return;
        
            // ★ 无论如何先激活 layer（否则输入栏看不见）
            if (!layer.classList.contains('active')) {
                await VN._applyVNBackground?.();
                layer.classList.add('active');
                const sceneSprites = document.getElementById('cinemaworld-scene-sprites');
                if (sceneSprites) sceneSprites.classList.add('vn-active');
            }
        
            const ent = this._entity;
        
            // ★ 不清空立绘，只确保两件事：
            //   - 如果有 entity，center 槽位有 NPC 立绘
            //   - right 槽位有玩家立绘
        
            // 1. NPC → center（如果 slot 里不是这个 NPC 才重新加载）
            if (ent) {
                const centerSlot = document.querySelector('.cinemaworld-sprite-slot[data-position="center"]');
                if (centerSlot && centerSlot.dataset.characterName !== ent.name) {
                    try {
                        const npcUrl = await SpriteMgr.get(ent.name, ent.meta?.gender, '默认');
                        if (npcUrl) {
                            centerSlot.innerHTML = `<img class="cinemaworld-sprite visible" src="${npcUrl}" alt="${ent.name}">`;
                            centerSlot.dataset.characterName = ent.name;
                            centerSlot.dataset.spriteState = '默认';
                            VN._slots.center = ent.name;
                        }
                    } catch (e) {
                        console.warn('[MapMainQuestDialogue] 加载 NPC 立绘失败:', e);
                    }
                }
            }
        
            // 2. 玩家 → right（如果 slot 里不是"玩家"才重新加载）
            const rightSlot = document.querySelector('.cinemaworld-sprite-slot[data-position="right"]');
            if (rightSlot && rightSlot.dataset.characterName !== '玩家') {
                try {
                    const playerUrl = await SpriteMgr.getPlayerSpriteState?.('默认');
                    if (playerUrl) {
                        rightSlot.innerHTML = `<img class="cinemaworld-sprite visible" src="${playerUrl}" alt="玩家">`;
                        rightSlot.dataset.characterName = '玩家';
                        rightSlot.dataset.spriteState = '默认';
                        VN._slots.right = '玩家';
                    }
                } catch (e) {
                    console.warn('[MapMainQuestDialogue] 加载玩家立绘失败:', e);
                }
            }
        
            // ★ 高亮玩家
            VN._applyHighlight?.('玩家');
        },
        
        async _onSubmit() {
            const input = document.getElementById('cw-dialogue-player-input');
            if (!input) return;
            const text = input.value.trim();
            if (!text) return;
            try {
                input.value = '';
                input.style.height = 'auto';
                this._commitPlayerMessage(text);
            } catch (e) {
                console.error('[MapMainQuestDialogue] 提交失败:', e);
                input.value = text;
            }
        },

        _commitPlayerMessage(text) {
            const playerName = this._getPlayerName();
            this._playerMessages.push(text);
            this._scriptLines.push({
                role: 'player',
                character: playerName,
                content: text,
            });
            this._roundPlayerMessages.push(text);
            this._history.push({
                id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                role: 'player',
                character: playerName,
                content: text,
                gender: '',
                state: '',
                timestamp: Date.now(),
                isPlayer: true,
            });
            this._speakPlayerLine(text); 
            window.MapDialogue.renderPlayerHistoryFor(this);
            if (this._historyVisible) this._renderHistoryPanel();
        },
                // ============================================================
        // 玩家输入行的 TTS（独立于 VN 的 TTS 流水线）
        // ============================================================
        _speakPlayerLine(text) {
            if (!window.TTSConfig?.get?.().enabled) return;
            if (!window.TTSCore || !window.TTSRouter) return;

            (async () => {
                try {
                    const voiceRef = await window.TTSRouter.resolve({
                        character: this._getPlayerName(),
                        content: text,
                    });
                    const blob = await window.TTSCore.synthesize(text, voiceRef, {});
                    if (blob && !blob.__error) {
                        await window.TTSCore.playBlob(blob, {});
                    }
                } catch (e) {
                    console.warn('[MapMainQuestDialogue] 玩家 TTS 失败:', e);
                }
            })();
        },
        async _onAIHelp() {
            if (this._isGenerating) return;
            const input = document.getElementById('cw-dialogue-player-input');
            if (!input) return;

            window.MapDialogue.setButtonsDisabledFor(this, true);
            window.MapDialogue.showThinkingFor(this);

            try {
                const prompt = this._buildAIHelpPrompt();
                const result = await window.generateFunctionalReply(prompt, 'mq-dialogue-ai-help');
                window.MapDialogue.hideThinkingFor(this);
                window.MapDialogue.setButtonsDisabledFor(this, false);

                if (result) {
                    const clean = result.trim()
                        .replace(/^【[^】]+】\s*[:：]\s*/, '')
                        .replace(/^玩家\s*[:：]\s*/, '')
                        .replace(new RegExp(`^${this._escapeRegex(this._getPlayerName())}\\s*[:：]\\s*`), '')
                        .trim();
                    input.value = clean;
                    input.focus();
                    input.dispatchEvent(new Event('input'));
                }
            } catch (e) {
                window.MapDialogue.hideThinkingFor(this);
                window.MapDialogue.setButtonsDisabledFor(this, false);
                console.error('[MapMainQuestDialogue] AI帮答失败:', e);
            }
        },

        _buildAIHelpPrompt() {
            const mq = this._mainQuest;
            const ent = this._entity;
            const playerName = this._getPlayerName();
            const recent = this._scriptLines.slice(-20);
            const scriptBlock = recent.map(l => this._formatScriptLine(l)).join('\n');
            const playerBlock = this._playerMessages.length > 0
                ? this._playerMessages.map(m => `${playerName}：${m}`).join('\n')
                : '';

            const ctxBlock = this._useCompactContext
                ? `【前情提要】\n${this._compactContext}`
                : this._buildFullContext();

            return `你正在为视觉小说游戏生成"${playerName}此刻可以说什么"的一句话选项。

${ctxBlock}

【当前主线】${mq.title} - ${mq.hint}
${ent ? `【对话对象】${ent.name}（${ent.kind}）${ent.description ? '：' + ent.description : ''}` : ''}

【最近对话】
${scriptBlock}

${playerBlock ? `【${playerName}已经说过的】\n${playerBlock}\n` : ''}

【任务】
根据当前对话氛围，替${playerName}想一句自然的回应。
要求：
1. 只输出一句话，不要旁白、不要动作描写（除非用括号简短表示）
2. 要符合"${playerName}"的立场和已知信息
3. 可以提问、回应、表达情绪、推进话题
4. 不要替 ${ent?.name || '对方'} 说话
5. 不要加任何前缀

请直接输出这一句话：`;
        },

        async _onSend() {
            if (this._isGenerating) return;
            const input = document.getElementById('cw-dialogue-player-input');
            if (!input) return;
            const text = input.value.trim();

            try {
                if (text) {
                    input.value = '';
                    input.style.height = 'auto';
                    this._commitPlayerMessage(text);
                }

                if (this._playerMessages.length === 0) {
                    window.UIManager?.showText?.('先说点什么吧', 1200);
                    return;
                }

                window.MapDialogue.hidePlayerInputFor(this);
                window.MapDialogue.setButtonsDisabledFor(this, true);

                this._roundPlayerMessages = [];
                window.MapDialogue.renderPlayerHistoryFor(this);

                this._resetVNLayerBetweenRounds();

                await this._generateNextRound(false);
            } catch (e) {
                console.error('[MapMainQuestDialogue] 发送失败:', e);
                window.UIManager?.showText?.('发送失败：' + e.message, 2500);
                window.MapDialogue.showPlayerInputFor(this);
            } finally {
                if (this._active) {
                    window.MapDialogue.setButtonsDisabledFor(this, false);
                }
            }
        },

        _resetVNLayerBetweenRounds() {
            const VN = window.VisualNovelManager;
            if (!VN) return;
            try { VN.stop?.(); } catch (e) { }
            VN.clearSprites?.();
            const dialogBox = document.getElementById('cinemaworld-dialogue-box');
            if (dialogBox) dialogBox.classList.remove('active');
            const layer = document.getElementById('cinemaworld-vn-layer');
            if (layer) layer.classList.remove('active');
            const sceneSprites = document.getElementById('cinemaworld-scene-sprites');
            if (sceneSprites) sceneSprites.classList.remove('vn-active');
        },

        async _onEnd() {
            if (!this._active || this._ending) return;
            // ★ 主线对话：直接结束，不弹确认
            window.MapDialogue.hidePlayerInputFor(this);
            window.MapDialogue.setButtonsDisabledFor(this, true);
            this._roundPlayerMessages = [];
            window.MapDialogue.renderPlayerHistoryFor(this);

            await this._endAndSettle();
        },
 
        // ============================================================
        // ★ 结束 + 结算
        // ============================================================
        async _endAndSettle() {
            if (this._ending) return;
            this._ending = true;
            this._active = false;

            // 1. 快照完整对话脚本
            const playerName = this._getPlayerName();
            const fullScript = this._history.map(h => {
                if (h.role === 'narrator') return `【旁白】: ${h.content}`;
                if (h.role === 'player') return `【${playerName}】: ${h.content}`;
                return `【${h.character}】: ${h.content}`;
            }).join('\n');
            this._hideHistoryPanel();
            // 2. 先清场
            await window.MapDialogue.cleanupVNFor(this);

            // 3. AI 结算（生成效果+选项+主线推进+摘要）
            await window.UIManager?.showText?.('正在结算主线对话…', 1500);
            let settlementText = '';
            try {
                settlementText = await this._generateSettlement(fullScript);
            } catch (e) {
                console.error('[MapMainQuestDialogue] 结算生成失败:', e);
            }

            const settlement = this._parseSettlement(settlementText);
            this._pendingEffect = settlement.effectBlock;
            this._pendingOptions = settlement.options;
            this._pendingMainQuestAdvance = settlement.mainQuestAdvance;
            this._pendingNewMapRequest = settlement.newMapRequest;
            this._pendingSummary = settlement.summary;
            this._pendingStoryTitle = settlement.storyTitle;   // ★ 新增

            // 4. 如果有选项 → 弹面板让玩家选
            let chosenOption = null;
            if (this._pendingOptions.length > 0) {
                chosenOption = await this._showOptionsPanel(this._pendingOptions);
            }

            // 5. ★ 构建一张"completed"剧情卡，写入 storyList
            //    这一步让剧情列表能看到 + 主线上下文能读到
            const story = this._buildStoryCard(fullScript, chosenOption);

            // 6. ★ 应用选项效果（如果有）
            if (chosenOption && chosenOption.effectText && window.EffectSystem) {
                try {
                    const results = window.EffectSystem.applyFromNarrative(chosenOption.effectText);
                    const text = window.EffectSystem.formatResults(results);
                    if (text) await window.UIManager.showText(text, 3500);
                } catch (e) {
                    console.error('[MapMainQuestDialogue] 选项效果应用失败:', e);
                }
            }

            // 7. ★ 应用全局效果
            if (this._pendingEffect && window.EffectSystem) {
                try {
                    const results = window.EffectSystem.applyFromNarrative(this._pendingEffect);
                    const text = window.EffectSystem.formatResults(results);
                    if (text) await window.UIManager.showText(text, 3500);
                } catch (e) {
                    console.error('[MapMainQuestDialogue] 全局效果应用失败:', e);
                }
            }

            // 8. ★ 调 StoryManager.completeStory 走标准化流程
            //    内部会：应用【主线推进】+ 生成新地图 + 章节滚动 + 回地图
            //    注意：completeStory 里读的是 story.mainQuestAdvance / story.newMapRequest
            //    所以我们要把结算结果挂到 story 上
            story.mainQuestAdvance = this._pendingMainQuestAdvance;
            story.newMapRequest = this._pendingNewMapRequest;

            if (window.StoryManager) {
                try {
                    await window.StoryManager.completeStory(story);
                } catch (e) {
                    console.error('[MapMainQuestDialogue] completeStory 失败:', e);
                }
            }

            // 9. 记录交互历史（含对话脚本，供重放）
            this._recordToHistory(fullScript, chosenOption, story.id);

            // 10. 记录摘要到 digest（"地图:XXX" key）
            if (this._pendingSummary && window.InteractionDigestManager) {
                const targetName = this._entity?.name || this._mainQuest?.title || '主线';
                window.InteractionDigestManager.add({
                    targetType: 'item',
                    target: `地图:${targetName}`,
                    source: 'mapEntity',
                    summary: this._pendingSummary,
                    chapterId: this._chapterId,
                });
            }

            // 11. 显示摘要
            if (this._pendingSummary) {
                await window.UIManager?.showText?.(
                    `主线对话结束\n\n${this._pendingSummary}`,
                    3000
                );
            }

            // 12. 刷新地图
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            if (window.MapCanvas?._refreshAvatarBar) window.MapCanvas._refreshAvatarBar();

            this._ending = false;
            if (window.SaveManager) window.SaveManager.save();
        },
                // ============================================================
        // ★ 把整段对话封装成一张"已完成"的剧情卡
        //    写入 StoryManager.storyList，让：
        //    - 剧情列表能看到
        //    - 主线上下文能读到（buildContext 的 chapter 层）
        //    - 可以重放
        // ============================================================
        _buildStoryCard(fullScript, chosenOption) {
            const SM = window.StoryManager;

            // 保证有当前章节
            if (!SM.currentChapter) {
                window.ChapterManager.createChapter(`第${SM.chapters.length + 1}章`);
            }

            // 把对话历史转成 dialogues 格式（供重放）
            const dialogues = this._history.map(h => ({
                character: h.character,
                visibility: 'visible',
                position: 'center',
                extraInfo: h.gender || '',
                state: h.state || '',
                content: h.content,
            }));

            const storyId = `story_mq_${Date.now()}`;
            const chapterId = SM.currentChapter?.id || null;

            const story = {
                id: storyId,
                parentId: this._parentStory?.id || null,
                chapterId,
                order: SM.storyList.filter(s => s.chapterId === chapterId).length + 1,
                createdAt: Date.now(),
                completedAt: Date.now(),
                status: 'completed',                     // ★ 已完成
                title: this._pendingStoryTitle
                    || `主线对话 · ${this._entity?.name || this._mainQuest?.title || '未知'}`,
                type: '主线',
                scene: this._map?.name || '',
                summary: this._pendingSummary || '',
                dialogues,
                raw: fullScript,
                options: this._pendingOptions || [],
                chosenOption: chosenOption ? {
                    key: chosenOption.key,
                    text: chosenOption.text,
                    custom: chosenOption.custom || false,
                } : null,
                // ★ 标记来源，方便调试和特殊处理
                _source: 'main-quest-dialogue',
                _entityId: this._entity?.id || null,
                _mainQuestTitle: this._mainQuest?.title || null,
                _played: true,                           // 已经"播放"过（就是这段对话本身）
                _sceneSwitchHandled: true,
                _appliedEffects: {},
            };

            // 写入 storyList
            SM.storyList.push(story);

            // 写入当前章节
            if (SM.currentChapter) {
                SM.currentChapter.storyIds.push(storyId);
                SM.currentChapter.events.push({
                    type: 'story-complete',
                    storyId,
                    title: story.title,
                    summary: this._pendingSummary || `主线对话完成`,
                    timestamp: Date.now(),
                });
            }

            console.log('[MapMainQuestDialogue] 已写入剧情卡:', story.title, storyId);
            return story;
        },
        // ============================================================
        // ★ AI 结算：效果+选项+主线推进+切换地图+摘要
        // ============================================================
        async _generateSettlement(fullScript) {
            const mq = this._mainQuest;
            const map = this._map;
            const ent = this._entity;
            const playerName = this._getPlayerName();

            // ---------- 上下文组装 ----------
            const parts = [];

            // 世界/章节上下文（复用 StoryManager，但关掉 interactionDigests 避免污染）
            if (window.StoryManager) {
                const ctx = window.StoryManager.buildContext(null, {
                    parentStory: false,
                    mainChars: true,
                    scene: false,
                    interactionDigests: false,
                    volumes: false,
                    chapters: false,
                    pendingEvents: false,
                });
                if (ctx) parts.push(ctx);
            }

            // 玩家状态
            if (window.PlayerStateManager?.formatForPrompt) {
                parts.push(`【玩家状态】\n${window.PlayerStateManager.formatForPrompt()}`);
            }

            // 当前地图完整上下文（区域列表、连接、实体、出入口）
            if (map) {
                let mapCtx = `【当前地图】\n名称: ${map.name}\n`;
                if (map.description) mapCtx += `描述: ${map.description}\n`;

                if (map.regions?.length) {
                    mapCtx += `\n地图区域列表（★ 输出【主线推进】时必须使用这些 id）:\n`;
                    map.regions.forEach(r => {
                        mapCtx += `  - ${r.id}（${r.name}）\n`;
                    });
                }

                if (map.connections?.length) {
                    mapCtx += `\n区域连接关系:\n`;
                    map.connections.forEach(c => {
                        const fromRegion = map.regions?.find(r => r.id === c.from);
                        const toRegion = map.regions?.find(r => r.id === c.to);
                        if (fromRegion && toRegion) {
                            mapCtx += `  - ${fromRegion.name}(${c.from}) ↔ ${toRegion.name}(${c.to})\n`;
                        }
                    });
                }

                const visibleEntities = (map.entities || []).filter(e =>
                    e._placed && !e.isPlayer && e.kind !== 'portal'
                );
                if (visibleEntities.length > 0) {
                    mapCtx += `\n地图实体:\n`;
                    visibleEntities.slice(0, 20).forEach(e => {
                        mapCtx += `  - ${e.emoji || '📦'} ${e.name}（${e.kind}）`;
                        if (e.region) mapCtx += ` @${e.region}`;
                        mapCtx += '\n';
                    });
                }

                const portals = (map.entities || []).filter(e =>
                    e._placed && e.kind === 'portal' && !e.tags?.includes('主线')
                );
                if (portals.length) {
                    mapCtx += `\n已有出入口:\n`;
                    portals.forEach(p => {
                        const fromRegion = map.regions?.find(r => r.id === p.region);
                        mapCtx += `  - ${p.emoji || '🚪'} ${p.name}`;
                        if (fromRegion) mapCtx += ` @${fromRegion.name}(${p.region})`;
                        const f = p.fields || {};
                        if (f['目标类型'] === 'map') {
                            mapCtx += ` → 地图「${f['目标']}」`;
                        } else if (f['目标类型'] === 'region') {
                            const tr = map.regions?.find(r => r.id === f['目标']);
                            mapCtx += ` → ${tr?.name || f['目标']}(${f['目标']})`;
                        }
                        mapCtx += '\n';
                    });
                }

                parts.push(mapCtx);
            }

            // 当前主线
            parts.push(`【当前主线】\n标题: ${mq.title}\n提示: ${mq.hint || ''}`);

            // 对话对象
            if (ent) {
                let entBlock = `【对话对象】\n名称: ${ent.name}\n类型: ${ent.kind}`;
                if (ent.description) entBlock += `\n描述: ${ent.description}`;
                if (ent.status) entBlock += `\n状态: ${ent.status}`;
                parts.push(entBlock);
            }

            // 与对话对象的历史交互
            if (window.InteractionDigestManager && ent && this._chapterId) {
                try {
                    const digest = window.InteractionDigestManager.formatForMapEntityPrompt
                        ? window.InteractionDigestManager.formatForMapEntityPrompt(ent.name, this._chapterId)
                        : '';
                    if (digest) parts.push(`【与 ${ent.name} 的过往交互】\n${digest}`);
                } catch (e) { }
            }
            if (this._parentStory) {
                let pBlock = `【本剧情的上一步】\n标题: ${this._parentStory.title}`;
                if (this._parentStory.summary) pBlock += `\n摘要: ${this._parentStory.summary}`;
                if (this._parentStory.chosenOption) {
                    pBlock += `\n玩家选择: ${this._parentStory.chosenOption.text}`;
                }
                parts.push(pBlock);
            }
            const prompt = `你正在为视觉小说游戏的【主线剧情对话】做结算。
玩家刚刚结束了与 ${ent?.name || '某人'} 的一段对话。请根据完整对话内容，生成：全局效果、选项、主线推进、切换地图（可选）、摘要。

${parts.join('\n\n')}

【完整对话】
${fullScript}

===== 输出格式（严格遵守）=====
【剧情】
标题: (这段主线对话的标题，简短有力，如"禁书区的钥匙"、"走廊尽头的低语")
🎵 音乐: (可选，这段对话的氛围音乐)

【效果】
（可选，全局效果。仅当对话导致实际数据变化时才写，没有变化就整块省略）
目标: 玩家
数值变化: 键名 +N
实体变化:
- 获得【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
- 失去【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
- 获得状态 状态名
- 移除状态 状态名

【选项】（2-4 个，每个选项后紧跟一个【效果】块；如果这段对话没什么好选的，整块省略）
A. 选项内容
【效果】
目标: 玩家
数值变化: 键名 +N
实体变化:
- 获得【物品名|图标】：描述，[...]

B. 选项内容
【效果】
目标: 玩家
数值变化: 键名 +N

【主线推进】（★ 必须输出这一块，除非主线彻底结束）
目标: (下一步主线目标的名字)
提示: (一句话提示玩家去哪儿)
落点: 格子 或 实体 或 出入口
地图: (地图名，必须用【当前地图】里的名称)
区域: (★ 必须用地图区域列表里的 id，不要翻译，不要自己编)
位置: (落点=格子时填，锚点名如 center/north/south/east/west/entrance)
实体名: (落点=实体时填)
实体图标: (落点=实体时填一个 emoji)
实体描述: (落点=实体时填)
出入口名: (落点=出入口时填)
出入口描述: (落点=出入口时填)
目标地图: (落点=出入口时填，不填表示指向已有出入口)

★ 如果主线彻底结束，不写这一块。

【切换地图】（★ 可选，仅当主线推进需要一张当前不存在的新地图时输出）
名称: (新地图的名字)
描述: (一句话，这张地图的氛围)
参考: (为什么需要这张地图，和当前剧情的关系)

★ 如果下一步主线在已有地图里，不写这一块。
★ 如果写了【切换地图】，【主线推进】里的"目标地图"应该引用这个名称。

【摘要】
（3-5 句，一段话）

===== 规则 =====

【效果】全局效果判定：
- 只有对话内容真的改变了某个数值/物品/状态，才写对应行；没有就整块省略
- 典型场景：角色给玩家物品、玩家失去物品、玩家情绪/身体变化、角色好感度变化
- 不要瞎编

【选项】要求：
- 2-4 个选项，每个选项代表玩家"完成这段对话后的后续行动"
- 每个选项后面必须紧跟一个【效果】块
- 选项本身是"玩家该做什么"，不是"玩家说了什么"
- 如果选项不产生数据变化，写 数值变化: 无
- 如果这段对话没什么好选的（比如只是交代信息），整个【选项】块省略

【主线推进】要求：
- 必须写，除非主线彻底结束（玩家已完成了最终目标）
- 目标/提示要承接这段对话的结果
- 落点/地图/区域严格按当前地图数据来
- 如果下一步要跨越到一张新地图，同时输出【切换地图】
- 不要把"落点"落到已经存在的、同名的实体上（除非那个实体就是目标）

【摘要】要求：
1. 说清前因：玩家为什么来
2. 说清过程：玩家说了什么/做了什么
3. 说清结果：对话的结论、约定、或冲突
4. 如果主线有推进，写清楚下一步目标是什么
5. 一段话 3-5 句，不分点，不要加前缀

请开始输出：`;

            const result = await window.generateFunctionalReply(prompt, 'mq-dialogue-settlement');
            return result?.trim() || '';
        },

        // ============================================================
        // ★ 解析结算文本
        // ============================================================
        _parseSettlement(text) {
            const out = {
                effectBlock: '',
                options: [],
                mainQuestAdvance: null,
                newMapRequest: null,
                summary: '',
                storyTitle: '',  
            };
            if (!text) return out;

            const titleMatch = text.match(/【剧情】[\s\S]*?标题[:：]\s*(.+)/);
            if (titleMatch) out.storyTitle = titleMatch[1].trim();

            // 摘要
            const summaryMatch = text.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
            if (summaryMatch) out.summary = summaryMatch[1].trim();

            // 效果（全局）
            const effMatch = text.match(/【效果】[\s\S]*?(?=\n【|$)/);
            if (effMatch) {
                // 只有选项之前的效果才视为全局；如果效果出现在【选项】之后，被选项解析处理
                const idxEff = text.indexOf(effMatch[0]);
                const idxOpt = text.indexOf('【选项】');
                if (idxOpt < 0 || idxEff < idxOpt) {
                    out.effectBlock = effMatch[0].trim();
                }
            }

            // 选项（含每项后的效果）
            const optMatch = text.match(/【选项】([\s\S]*?)(?=\n【主线推进】|\n【切换地图】|\n【摘要】|$)/);
            if (optMatch) {
                out.options = this._parseOptionsWithEffects(optMatch[1]);
            }

            // 切换地图
            const nmMatch = text.match(/【切换地图】([\s\S]*?)(?=\n【|$)/);
            if (nmMatch && window.StoryManager?._parseNewMapRequest) {
                out.newMapRequest = window.StoryManager._parseNewMapRequest(nmMatch[1]);
            }

            // 主线推进
            const mqMatch = text.match(/【主线推进】([\s\S]*?)(?=\n【|$)/);
            if (mqMatch && window.StoryManager?._parseMainQuestAdvance) {
                out.mainQuestAdvance = window.StoryManager._parseMainQuestAdvance(mqMatch[1]);
            }

            return out;
        },

        // 解析带效果的选项
        _parseOptionsWithEffects(optionText) {
            const options = [];
            const blockRegex = /([A-Z])[.、]\s*([\s\S]*?)(?=(?:[A-Z][.、]\s)|$)/g;
            let m;
            while ((m = blockRegex.exec(optionText)) !== null) {
                const key = m[1];
                const body = m[2].trim();
                if (!body) continue;

                const effectMatch = body.match(/【效果】([\s\S]*?)(?=【|$)/);
                let optText = body;
                if (effectMatch) {
                    optText = optText.replace(effectMatch[0], '');
                }
                optText = optText.replace(/\s+/g, ' ').trim();

                options.push({
                    key,
                    text: optText,
                    effectText: effectMatch ? '【效果】' + effectMatch[1] : '',
                });
            }
            return options;
        },

        // ============================================================
        // ★ 选项面板（选项 + 自定义输入 + 跳过）
        // ============================================================
        _showOptionsPanel(options) {
            return new Promise(resolve => {
                const modal = document.getElementById('cinemaworld-modal');
                if (!modal) return resolve(null);

                const optionsHTML = options.map(o => `
                    <div class="cinemaworld-option-item"
                        onclick="MapMainQuestDialogue._resolveOptionPick('${o.key}')">
                        <span class="cinemaworld-option-key">${o.key}</span>
                        <span class="cinemaworld-option-text">${this._escape(o.text)}</span>
                    </div>
                `).join('');

                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📖 主线抉择</div>
                    <div style="margin-bottom:20px;color:#aaa;font-size:14px;text-align:center;">
                        选择你的下一步行动
                    </div>
                    <div style="display:flex;flex-direction:column;gap:10px;">${optionsHTML}</div>

                    <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1);">
                        <div style="font-size:13px;color:#aaa;margin-bottom:8px;">
                            ✍️ 或者，自己决定要做什么：
                        </div>
                        <textarea class="cinemaworld-textarea" id="cw-mq-custom-input"
                            placeholder="例如：我决定什么都不做，静静观察他的反应。&#10;（输入内容会作为后续剧情上下文）"
                            style="min-height:80px;"></textarea>
                        <div style="text-align:center;margin-top:10px;">
                            <button class="cinemaworld-button primary"
                                onclick="MapMainQuestDialogue._resolveCustomOption()">
                                ✅ 确认这个行动
                            </button>
                        </div>
                    </div>

                    <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);">
                        <button class="cinemaworld-button" onclick="MapMainQuestDialogue._resolveSkip()"
                            style="color:#d87d7d;border-color:rgba(216,125,125,.4);">
                            ⏭ 跳过（不选择）
                        </button>
                    </div>
                `;
                modal.className = 'active';

                // 保存 resolve 回调
                this._optionResolve = (picked) => {
                    modal.innerHTML = '';
                    modal.className = '';
                    resolve(picked);
                };

                // 注入选项样式（复用 story.js 的）
                if (!document.getElementById('cinemaworld-option-styles')) {
                    const s = document.createElement('style');
                    s.id = 'cinemaworld-option-styles';
                    s.textContent = `
                        .cinemaworld-option-item{padding:16px 20px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:15px;}
                        .cinemaworld-option-item:hover{background:rgba(120,150,255,.15);border-color:rgba(120,150,255,.4);transform:translateX(5px);}
                        .cinemaworld-option-key{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-weight:bold;color:#fff;flex-shrink:0;}
                        .cinemaworld-option-text{font-size:14px;color:#e0e0e0;line-height:1.5;}
                    `;
                    document.head.appendChild(s);
                }
            });
        },

        _resolveOptionPick(key) {
            if (!this._optionResolve) return;
            const picked = key
                ? (this._pendingOptions || []).find(o => o.key === key)
                : null;
            this._optionResolve(picked);
            this._optionResolve = null;
        },
        // ★ 自定义输入
        _resolveCustomOption() {
            if (!this._optionResolve) return;
            const input = document.getElementById('cw-mq-custom-input')?.value.trim();
            if (!input) {
                window.UIManager?.showText?.('请输入你想做的事', 1500);
                return;
            }
            const custom = {
                key: 'CUSTOM',
                text: input,
                custom: true,
                effectText: '',
            };
            this._optionResolve(custom);
            this._optionResolve = null;
        },

        // ★ 跳过
        _resolveSkip() {
            if (!this._optionResolve) return;
            this._optionResolve(null);
            this._optionResolve = null;
        },

        // ============================================================
        // ★ 主线推进
        // ============================================================
        async _applyMainQuestAdvance() {
            const playMode = window.CinemaWorld?.worldState?.playMode;
            if (playMode !== 'map' || !window.MainQuestManager) return;

            // 1. 生成新地图（如果 AI 输出了【切换地图】）
            if (this._pendingNewMapRequest) {
                try {
                    await window.MainQuestManager.generateNewMap(this._pendingNewMapRequest);
                } catch (e) {
                    console.error('[MapMainQuestDialogue] 生成新地图失败:', e);
                }
            }

            // 2. 应用主线推进
            if (this._pendingMainQuestAdvance) {
                try {
                    await window.MainQuestManager.applyAdvance(this._pendingMainQuestAdvance);
                } catch (e) {
                    console.error('[MapMainQuestDialogue] 主线推进应用失败:', e);
                }
            } else {
                // AI 没输出【主线推进】→ 主线结束
                window.CinemaWorld.worldState.mainQuest = null;
                console.log('[MapMainQuestDialogue] 主线已结束');
                await window.UIManager?.showText?.('⭐ 主线已完成', 2000);
            }
        },

        // ============================================================
        // 记录历史
        // ============================================================
        _recordToHistory(fullScript, chosenOption, storyId) {
            if (!window.InteractionHistoryManager) return;

            const dialogueSnapshot = this._history.map(h => ({
                character: h.character,
                role: h.role,
                content: h.content,
                gender: h.gender,
                state: h.state,
                isPlayer: h.isPlayer,
            }));

            window.InteractionHistoryManager.add({
                type: 'mapEntity',
                target: this._entity?.name || `主线对话 (${this._sessionId})`,
                targetMeta: {
                    entityId: this._entity?.id || null,
                    mode: 'main-quest-dialogue',
                    mainQuestTitle: this._mainQuest?.title,
                    chosenOption: chosenOption ? chosenOption.text : null,
                    useCompactContext: this._useCompactContext,
                    _dialogues: dialogueSnapshot,
                    _storyId: storyId || null,       // ★ 关联的剧情卡 id
                },
                scene: this._map?.name || '(地图)',
                playerInput: this._playerMessages.join(' / ') || '（玩家没有说话）',
                script: fullScript,
                effect: this._pendingEffect || null,
                summary: this._pendingSummary || '（未生成摘要）',
            });
        },

        // ============================================================
        // 工具
        // ============================================================
        _getPlayerName() {
            return window.PlayerStateManager?.player?.name || '玩家';
        },

        _escape(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        },

        _escapeRegex(str) {
            return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        },
    };

    window.MapMainQuestDialogue = MapMainQuestDialogue;
    console.log('[CinemaWorld] map-mainquest-dialogue.js 已加载');
})();