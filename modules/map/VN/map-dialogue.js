// ============================================================
// CinemaWorld · map-dialogue.js
// 地图对话 · 脚本生成模式
// 特性：玩家不嘴替 / 历史回看 / 背景切换 / BGM 切换 / TTS
// 依赖：map-interact.js, story.js, ui.js, world.js
// 暴露：window.MapDialogue
//
// ★ 设计：每轮脚本直接交给 VisualNovelManager.play() 播放
//   播完（自然结束或玩家点跳过）后进入玩家回合。
//   TTS / 打字机 / advance / skip 全部复用 VN 原生逻辑。
// ============================================================

(function () {
    'use strict';

    const MapDialogue = {
        // ============================================================
        // 状态
        // ============================================================
        _active: false,
        _entityId: null,
        _entity: null,
        _region: null,
        _map: null,
        _chapterId: null,

        _scriptLines: [],
        _playerMessages: [],
        _roundPlayerMessages: [],

        _openingGuide: '',

        _history: [],
        _historyVisible: false,

        _isGenerating: false,

        _useCompactContext: false,
        _compactContext: '',

        _sessionId: null,
        _startedAt: 0,

        // ============================================================
        // 入口
        // ============================================================
        async start(entityId, opts = {}) {
            if (this._active) {
                window.UIManager?.showText?.('已经有一场对话在进行中', 1500);
                return;
            }

            const map = window.MapLauncher?.getMap?.();
            const ent = map?.entities?.find(e => e.id === entityId);
            if (!ent) return;

            if (window.MusicManager) {
                try { await window.MusicManager.clearScopedMusic('dialogue'); } catch (e) { }
            }

            this._active = true;
            this._entityId = entityId;
            this._entity = ent;
            this._map = map;
            this._region = map.regions?.find(r => r.id === ent.region) || null;
            this._chapterId = window.StoryManager?.currentChapter?.id || null;
            this._scriptLines = [];
            this._playerMessages = [];
            this._roundPlayerMessages = [];
            this._history = [];
            this._historyVisible = false;
            this._isGenerating = false;
            this._sessionId = `dlg_${Date.now()}`;
            this._startedAt = Date.now();
            this._ending = false;   // ← 加这一行

            this._openingGuide = (opts.openingGuide || '').trim();

            if (opts.compactContext) {
                await this._prepareCompactContext();
            } else {
                this._useCompactContext = false;
                this._compactContext = '';
            }

            await this._applyInitialDialogueMusic();

            this._renderUI();
            await this._generateNextRound(true);
        },

        // ============================================================
        // 摘要模式上下文
        // ============================================================
        async _prepareCompactContext() {
            this._useCompactContext = true;
            await window.UIManager?.showText?.('正在准备对话上下文…', 1200);

            const ent = this._entity;
            const fullCtx = this._buildFullContext();

            const prompt = `你正在为视觉小说游戏准备一段"对话上下文摘要"。
请把下面这段复杂上下文，压缩成一段紧凑的、只保留与「${ent.name}」对话相关信息的前情提要。

【世界历史】
${fullCtx}

【本轮对话对象】
${ent.name}（${ent.kind}）${ent.description ? '：' + ent.description : ''}

【压缩要求】
1. 只保留：世界观简介、玩家当前处境、玩家与 ${ent.name} 的关系/过往、当前场景氛围、可能相关的主线/支线
2. 去掉：与本次对话无关的角色、不相关的历史、无关的物品
3. 用第三人称、像"前情提要"一样陈述
4. 控制在 300 字以内
5. 不要加任何前缀（不要写"摘要："）

请直接输出：`;

            const result = await window.generateFunctionalReply(prompt, 'dialogue-compact-context');
            this._compactContext = result?.trim() || fullCtx;
            console.log('[MapDialogue] 摘要模式上下文:', this._compactContext.slice(0, 200));
        },

        // ============================================================
        // 生成下一轮
        // ============================================================
        async _generateNextRound(isFirst = false) {
            if (this._isGenerating) return;
            this._isGenerating = true;

            try {
                this._showThinking();

                const prompt = this._buildScriptPrompt(isFirst);
                const result = await window.generateFunctionalReply(prompt, 'map-dialogue-round');

                this._hideThinking();

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
                console.error('[MapDialogue] 生成失败:', e);
                this._hideThinking();
                window.UIManager?.showText?.('生成失败：' + e.message, 2500);
                if (this._active) this._enterPlayerTurn();
            } finally {
                this._isGenerating = false;
            }
        },

        // ============================================================
        // Prompt 构建
        // ============================================================
        _buildScriptPrompt(isFirst) {
            const map = this._map;
            const ent = this._entity;
            const region = this._region;
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

            const companionBlock = this._buildCompanionBlock();
            const questBlock = this._buildQuestBlock();
            const openingGuideBlock = (isFirst && this._openingGuide)
                ? `\n【玩家的描述】\n${this._openingGuide}\n`
                : '';

            const taskLine = isFirst
                ? `生成一段【开场对话】：从 ${ent.name} 或环境/旁白开始，让玩家自然进入对话。`
                : `继续生成对话：从上一轮结束的地方继续，轮流说话，直到自然轮到玩家（不要在玩家回合替玩家说话）。`;

            return `你正在扮演一个视觉小说游戏。玩家在地图上遇到了一个 NPC，现在开始对话。

${ctxBlock}
${openingGuideBlock}
【地图】${map.name}${map.description ? '\n' + map.description : ''}
【当前区域】${region?.name || '未知'}${region?.description ? '：' + region.description : ''}

【对话对象】
名称：${ent.name}
类型：${ent.kind}
${ent.description ? `描述：${ent.description}` : ''}
${ent.status ? `状态：${ent.status}` : ''}
${ent.effect ? `功能：${ent.effect}` : ''}
${this._formatEntityFields(ent)}

${companionBlock}
${questBlock}

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


【背景/音乐使用建议】
- 如果 ${ent.name} 有鲜明人设，首次出场时推荐给她/他一个专属 BGM（如"${ent.name}主题"）
- 如果情绪明显转变（如平静→紧张），写 🎵 音乐 切换
- 没有变化就不要写，避免频繁切换打断沉浸
- 找不到对应资源时，系统会自动保持上一个背景/音乐

【规则】
1. 绝对不要替${playerName}说话！${playerName}会自己说。轮到${playerName}时，你就停。
2. 只能使用当前场景/对话中出现的角色（${ent.name}、${playerName}、旁白${this._buildNearbyNames()}）
3. 每段输出 3-10 行，控制在"${playerName}该说话了"这个自然停顿点
4. 说话者"显示"，其他"隐藏"（如果场景里有多人）
5. 旁白用来描述环境、心理、动作，不要代替${playerName}做决定
6. 状态字段可以写心情（如"微笑"、"紧张"），用于立绘表情
7. 不要输出【效果】【场景更新】【选项】等块——本模式只生成对话
8. 如果对话自然结束（如角色告别），可以用旁白收尾，但不要在${playerName}还没说话时强行结束

【示例】
🎵 音乐: ${ent.name}主题
背景: 茶室
【${ent.name}|显示|中|${ent.meta?.gender || '未知'}|微笑】: 你来啦。
【旁白】: 她放下手里的书，抬头看向你。
【${ent.name}|显示|中|${ent.meta?.gender || '未知'}|平静】: 有什么事吗？

请开始生成：`;
        },

        _buildNearbyNames() {
            const map = this._map;
            const region = this._region;
            if (!map || !region) return '';
            const siblings = map.entities.filter(e =>
                e.region === region.id && e.id !== this._entityId && !e.isPlayer
                && (e.kind === 'npc' || e.isCompanion)
            );
            return siblings.length > 0
                ? '、' + siblings.map(s => s.name).join('、')
                : '';
        },

        _buildCompanionBlock() {
            const ent = this._entity;
            if (!ent.isCompanion && ent.kind !== 'companion') return '';
            const companionName = ent.meta?.companionName || ent.name;
            if (!window.BondManager) return '';
            const bond = window.BondManager.getBond?.(companionName);
            if (!bond) return '';

            const lines = [`【队友档案】${companionName}`];
            const p = bond.profile || {};
            if (p.gender) lines.push(`- 性别：${p.gender}`);
            if (p.personality) lines.push(`- 性格：${p.personality}`);
            if (p.background) lines.push(`- 背景：${p.background}`);

            const stage = window.BondManager.getCurrentStage?.(bond);
            if (stage) lines.push(`- 关系：${stage.name}`);

            return lines.join('\n');
        },

        _buildQuestBlock() {
            const ent = this._entity;
            const questId = ent.meta?.questId;
            if (!questId || !window.MapQuestManager) return '';
            const q = window.MapQuestManager.getQuest?.(questId);
            if (!q) return '';
            return `【相关任务】${q.title}（${q.status}）\n${q.description || ''}`;
        },

        _formatEntityFields(ent) {
            const lines = [];
            for (const [k, v] of Object.entries(ent.fields || {})) {
                if (k.startsWith('_pos')) continue;
                if (['图标', 'icon', '类型', '可拾取', '可堆叠', '最大堆叠'].includes(k)) continue;
                lines.push(`${k}：${v}`);
            }
            return lines.length > 0 ? '\n' + lines.join('\n') : '';
        },

        _buildFullContext() {
            try {
                return window.MapInteract._buildContextParts(this._map, this._entity, this._region);
            } catch (e) {
                return '';
            }
        },

        _formatScriptLine(l) {
            if (l.role === 'narrator') {
                return `【旁白】: ${l.content}`;
            }
            if (l.role === 'player') {
                return `【${this._getPlayerName()}|显示|中|未知|】: ${l.content}`;
            }
            const meta = [
                l.character,
                l.visibility === 'hidden' ? '隐藏' : '显示',
                l.position === 'left' ? '左' : l.position === 'right' ? '右' : '中',
                l.gender || '未知',
                l.state || '',
            ].join('|');
            return `【${meta}】: ${l.content}`;
        },

        // ============================================================
        // 解析
        // ============================================================
        _parseScriptRound(text) {
            const out = { lines: [], music: null, background: null };

            const musicMatch = text.match(/🎵\s*音乐\s*[:：]\s*(.+)/);
            if (musicMatch) out.music = musicMatch[1].trim();

            const bgMatch = text.match(/(?:【背景】|^背景)\s*[:：]\s*(.+)$/m);
            if (bgMatch) out.background = bgMatch[1].trim();

            // ★ 预处理：把压成一行的多个【xxx】拆开
            const normalizedText = this._splitInlineDialogues(text);

            const dialogues = window.VisualNovelManager.parseScript(normalizedText);

            for (const d of dialogues) {
                const isNarrator = ['旁白', '系统', 'narrator'].includes(d.character);
                const isPlayer = ['玩家', '我', '主人公', 'player'].includes(d.character)
                    || d.character === this._getPlayerName();

                if (isPlayer) {
                    console.warn('[MapDialogue] AI 尝试替玩家说话，已丢弃:', d.content);
                    continue;
                }

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
        // 播放一轮脚本 —— 完全交给 VN.play
        // ============================================================
        async _playScriptRound(parsed) {
            if (parsed.lines.length === 0) return;

            this._scriptLines.push(...parsed.lines);

            if (parsed.background) await this._applyRoundBackground(parsed.background);
            if (parsed.music) await this._applyRoundMusic(parsed.music);

            const startIdx = this._scriptLines.length - parsed.lines.length;

            const vnDialogues = parsed.lines.map((l, i) => {
                const base = { __ttsIndex: startIdx + i };
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

            // 记录历史
            vnDialogues.forEach(d => this._pushHistory(d));

            // ★ 直接交给 VN.play
            //   内部：TTS 补丁自动启动流水线、打字机、advance、skip、end 全部原生
            await window.VisualNovelManager.play(vnDialogues);
        },

        // ============================================================
        // 轮到玩家
        // ============================================================
        _enterPlayerTurn() {
            if (!this._active) return;
            this._setButtonsDisabled(false);   // ★ 新增
            this._showPlayerInput();
            this._ensurePlayerSpriteOnStage();
        },

        async _enterPlayerTurn() {
            if (!this._active) return;
            this._setButtonsDisabled(false);
            this._showPlayerInput();
            await this._ensureCharacterSpritesOnStage();
        },

        async _ensureCharacterSpritesOnStage() {
            const VN = window.VisualNovelManager;
            const SpriteMgr = window.SpriteManager;
            if (!VN || !SpriteMgr) return;

            const ent = this._entity;
            if (!ent) return;

            const layer = document.getElementById('cinemaworld-vn-layer');
            if (!layer) return;

            // VN 层激活（VN.play 的 end 会隐藏）
            if (!layer.classList.contains('active')) {
                await VN._applyVNBackground?.();
                layer.classList.add('active');
                const sceneSprites = document.getElementById('cinemaworld-scene-sprites');
                if (sceneSprites) sceneSprites.classList.add('vn-active');
            }

            // 玩家回合前：清一下旧立绘，重新摆
            VN.clearSprites?.();
            VN._slots = { left: null, center: null, right: null };

            // 1. NPC → center
            const npcUrl = await SpriteMgr.get(ent.name, ent.meta?.gender, '默认');
            if (npcUrl) {
                const centerSlot = document.querySelector('.cinemaworld-sprite-slot[data-position="center"]');
                if (centerSlot) {
                    centerSlot.innerHTML = `<img class="cinemaworld-sprite visible" src="${npcUrl}" alt="${ent.name}">`;
                    centerSlot.dataset.characterName = ent.name;
                    centerSlot.dataset.spriteState = '默认';
                    VN._slots.center = ent.name;
                }
            }

            // 2. 玩家 → right
            const playerUrl = await SpriteMgr.getPlayerSpriteState?.('默认');
            if (playerUrl) {
                const rightSlot = document.querySelector('.cinemaworld-sprite-slot[data-position="right"]');
                if (rightSlot) {
                    rightSlot.innerHTML = `<img class="cinemaworld-sprite visible" src="${playerUrl}" alt="玩家">`;
                    rightSlot.dataset.characterName = '玩家';
                    rightSlot.dataset.spriteState = '默认';
                    VN._slots.right = '玩家';
                }
            }

            // 高亮玩家（因为轮到玩家）
            VN._applyHighlight?.('玩家');
        },
        // ============================================================
        // UI 渲染
        // ============================================================
        _renderUI() {
            const VN = window.VisualNovelManager;
            if (VN && !document.getElementById('cinemaworld-vn-layer')) {
                VN.createLayer();
            }

            const layer = document.getElementById('cinemaworld-vn-layer');
            if (!layer) return;

            this._injectStyles();

            let inputBar = document.getElementById('cw-dialogue-player-bar');
            if (!inputBar) {
                inputBar = document.createElement('div');
                inputBar.id = 'cw-dialogue-player-bar';
                inputBar.className = 'cw-dialogue-player-bar';
                inputBar.innerHTML = `
                    <div class="cw-dialogue-player-history" id="cw-dialogue-player-history"></div>
                    <div class="cw-dialogue-player-input-wrap">
                        <textarea id="cw-dialogue-player-input"
                            class="cw-dialogue-player-input"
                            placeholder="轮到你说话了…"
                            rows="1"></textarea>
                        <div class="cw-dialogue-player-btns">
                            <button class="cw-dialogue-btn" data-act="history" title="查看对话历史">📜 历史</button>
                            <button class="cw-dialogue-btn" data-act="ai">🤖 AI帮答</button>
                            <button class="cw-dialogue-btn" data-act="submit">📤 提交</button>
                            <button class="cw-dialogue-btn primary" data-act="send">💬 发送</button>
                            <button class="cw-dialogue-btn danger" data-act="end">⏹ 结束</button>
                        </div>
                    </div>
                `;
                layer.appendChild(inputBar);
                this._bindPlayerBarEvents(inputBar);
            }

            this._ensureHistoryFab();
            this._renderPlayerHistory();
        },

        _ensureHistoryFab() {
            if (document.getElementById('cw-dialogue-history-fab')) return;
            const layer = document.getElementById('cinemaworld-vn-layer');
            if (!layer) return;
            const fab = document.createElement('button');
            fab.id = 'cw-dialogue-history-fab';
            fab.className = 'cw-dialogue-history-fab';
            fab.innerHTML = '📜';
            fab.title = '对话历史';
            fab.addEventListener('click', (e) => {
                e.stopPropagation();
                this._toggleHistoryPanel();
            });
            layer.appendChild(fab);
        },

        _bindPlayerBarEvents(bar) {
            const input = bar.querySelector('#cw-dialogue-player-input');
            const btns = bar.querySelectorAll('.cw-dialogue-btn');

            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = Math.min(160, input.scrollHeight) + 'px';
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (e.ctrlKey || e.metaKey) this._onSend();
                    else this._onSubmit();
                }
            });

            btns.forEach(b => {
                b.addEventListener('click', () => {
                    const act = b.dataset.act;
                    if (act === 'ai') this._onAIHelp();
                    else if (act === 'submit') this._onSubmit();
                    else if (act === 'send') this._onSend();
                    else if (act === 'end') this._onEnd();
                    else if (act === 'history') this._toggleHistoryPanel();
                });
            });
        },

        _showPlayerInput() {
            const bar = document.getElementById('cw-dialogue-player-bar');
            if (!bar) return;
            bar.classList.add('active');

            const dialogBox = document.getElementById('cinemaworld-dialogue-box');
            if (dialogBox) dialogBox.classList.remove('active');

            const input = bar.querySelector('#cw-dialogue-player-input');
            if (input) setTimeout(() => input.focus(), 50);
        },

        _hidePlayerInput() {
            document.getElementById('cw-dialogue-player-bar')?.classList.remove('active');
        },

        _renderPlayerHistory() {
            const el = document.getElementById('cw-dialogue-player-history');
            if (!el) return;

            const list = this._roundPlayerMessages || [];

            if (list.length === 0) {
                el.innerHTML = '';
                el.classList.remove('has-bubbles');
                return;
            }

            el.classList.add('has-bubbles');
            el.innerHTML = list.map(m =>
                `<div class="cw-dialogue-player-bubble">${this._escape(m)}</div>`
            ).join('');
            el.scrollTop = el.scrollHeight;
        },

        _setButtonsDisabled(disabled) {
            const bar = document.getElementById('cw-dialogue-player-bar');
            if (!bar) return;
            bar.querySelectorAll('.cw-dialogue-btn').forEach(b => {
                if (b.dataset.act === 'end' || b.dataset.act === 'history') return;
                b.disabled = disabled;
            });
        },

        _showThinking() {
            this._hideThinking();
            const el = document.createElement('div');
            el.id = 'cw-dialogue-thinking';
            el.className = 'cw-dialogue-thinking';
            el.textContent = '对方正在回应…';
            const layer = document.getElementById('cinemaworld-vn-layer');
            if (layer) layer.appendChild(el);
        },

        _hideThinking() {
            document.getElementById('cw-dialogue-thinking')?.remove();
        },

        // ============================================================
        // 玩家动作
        // ============================================================
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
                console.error('[MapDialogue] 提交失败:', e);
                input.value = text;
                window.UIManager?.showText?.('提交失败：' + e.message, 2000);
            }
        },

        _commitPlayerMessage(text) {
            const playerName = this._getPlayerName();

            if (!Array.isArray(this._roundPlayerMessages)) this._roundPlayerMessages = [];
            if (!Array.isArray(this._playerMessages)) this._playerMessages = [];
            if (!Array.isArray(this._scriptLines)) this._scriptLines = [];
            if (!Array.isArray(this._history)) this._history = [];

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

            this._renderPlayerHistory();
            if (this._historyVisible) this._renderHistoryPanel();

            // ★ 玩家提交的 TTS（独立于 VN 的 TTS 流水线）
            this._speakPlayerLine(text);
        },

        async _onAIHelp() {
            if (this._isGenerating) return;
            const input = document.getElementById('cw-dialogue-player-input');
            if (!input) return;

            this._setButtonsDisabled(true);
            this._showThinking();

            try {
                const prompt = this._buildAIHelpPrompt();
                const result = await window.generateFunctionalReply(prompt, 'dialogue-ai-help');
                this._hideThinking();
                this._setButtonsDisabled(false);

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
                this._hideThinking();
                this._setButtonsDisabled(false);
                console.error('[MapDialogue] AI帮答失败:', e);
            }
        },

        _buildAIHelpPrompt() {
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

【对话对象】${ent.name}（${ent.kind}）${ent.description ? '：' + ent.description : ''}

【最近对话】
${scriptBlock}

${playerBlock ? `【${playerName}已经说过的】\n${playerBlock}\n` : ''}

【任务】
根据当前对话氛围，替${playerName}想一句自然的回应。
要求：
1. 只输出一句话，不要旁白、不要动作描写（除非用括号简短表示）
2. 要符合"${playerName}"的立场和已知信息
3. 可以提问、回应、表达情绪、推进话题
4. 不要替 ${ent.name} 说话
5. 不要加任何前缀（不要写"${playerName}："）

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

                this._hidePlayerInput();
                this._setButtonsDisabled(true);

                this._roundPlayerMessages = [];
                this._renderPlayerHistory();

                this._resetVNLayerBetweenRounds();

                await this._generateNextRound(false);
            } catch (e) {
                console.error('[MapDialogue] 发送失败:', e);
                window.UIManager?.showText?.('发送失败：' + e.message, 2500);
                this._showPlayerInput();
            } finally {
                // ★ 如果对话还在活跃，确保按钮复位（_enterPlayerTurn 也会调，
                //   但 finally 覆盖异常路径）
                if (this._active) {
                    this._setButtonsDisabled(false);
                }
            }
        },

        _resetVNLayerBetweenRounds() {
            // VN.play 结束后已经 end() 了（VN 层隐藏，立绘清空）
            // 但对话框、输入条可能残留，清理一下，让下一轮 play 干净
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
            if (!this._active) return;

            const confirmEnd = confirm('结束这场对话？将生成交互摘要并记录。');
            if (!confirmEnd) return;

            this._hidePlayerInput();
            this._setButtonsDisabled(true);

            this._roundPlayerMessages = [];
            this._renderPlayerHistory();

            await this._endAndSummarize();
        },

        // ============================================================
        // 收尾
        // ============================================================
        async _endAndSummarize() {
            if (this._ending) return;
            this._ending = true;
            this._active = false;

            this._hidePlayerInput();
            this._hideThinking();
            this._setButtonsDisabled(true);

            // ★ 快照脚本（cleanup 会清 _history）
            const playerName = this._getPlayerName();
            const fullScript = this._history.map(h => {
                if (h.role === 'narrator') return `【旁白】: ${h.content}`;
                if (h.role === 'player') return `【${playerName}】: ${h.content}`;
                return `【${h.character}】: ${h.content}`;
            }).join('\n');

            // ★ 先清场，再做慢操作（避免 VN 层残留/并发问题）
            await this._cleanupVN();

            // ★ 生成【效果】+【摘要】
            await window.UIManager?.showText?.('正在结算这场对话…', 1500);
            let closingText = '';
            try {
                closingText = await this._generateClosing(fullScript);
            } catch (e) {
                console.error('[MapDialogue] 收尾生成失败:', e);
            }

            const { effectBlock, summary } = this._parseClosing(closingText);

            // ★ 应用效果：完全交给 EffectSystem
            if (effectBlock && window.EffectSystem) {
                try {
                    const results = window.EffectSystem.applyFromNarrative(effectBlock);
                    const text = window.EffectSystem.formatResults(results);
                    if (text) await window.UIManager.showText(text, 3500);
                } catch (e) {
                    console.error('[MapDialogue] 效果应用失败:', e);
                }
            }

            // ★ 记录历史（effect 传原文，供回看/重放）
            this._recordToHistory(fullScript, summary, effectBlock);

            // ★ 存入摘要管理器（key 与 map-interact 一致）
            if (summary && window.InteractionDigestManager) {
                window.InteractionDigestManager.add({
                    targetType: 'item',
                    target: `地图:${this._entity.name}`,
                    source: 'mapEntity',
                    summary: summary,
                    chapterId: this._chapterId,
                });
            }

            await window.UIManager?.showText?.(
                summary ? `对话结束\n\n${summary}` : '对话结束',
                3000
            );

            // ★ 刷新地图（效果可能改了实体状态/头像）
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            if (window.MapCanvas?._refreshAvatarBar) window.MapCanvas._refreshAvatarBar();

            this._ending = false;
            if (window.SaveManager) window.SaveManager.save();
        },
        // ============================================================
        // ★ 公共 API：给外部模块（如 map-mainquest-dialogue）复用 UI 框架
        //   不改变任何原有逻辑，只是把私有 UI 方法包装成可调用的入口
        // ============================================================

        /**
         * 为外部对话模块渲染 UI 框架
         * @param {object} target - 外部模块实例（需实现 _onSubmit / _onSend / _onAIHelp / _onEnd 等方法）
         */
        renderUIFor(target) {
            const VN = window.VisualNovelManager;
            if (VN && !document.getElementById('cinemaworld-vn-layer')) {
                VN.createLayer();
            }
            const layer = document.getElementById('cinemaworld-vn-layer');
            if (!layer) return;

            this._injectStyles();

            let inputBar = document.getElementById('cw-dialogue-player-bar');
            if (!inputBar) {
                inputBar = document.createElement('div');
                inputBar.id = 'cw-dialogue-player-bar';
                inputBar.className = 'cw-dialogue-player-bar';
                inputBar.innerHTML = `
            <div class="cw-dialogue-player-history" id="cw-dialogue-player-history"></div>
            <div class="cw-dialogue-player-input-wrap">
                <textarea id="cw-dialogue-player-input"
                    class="cw-dialogue-player-input"
                    placeholder="轮到你说话了…"
                    rows="1"></textarea>
                <div class="cw-dialogue-player-btns">
                <button class="cw-dialogue-btn" data-act="history" title="查看对话历史">📜 历史</button>
                    <button class="cw-dialogue-btn" data-act="ai">🤖 AI帮答</button>
                    <button class="cw-dialogue-btn" data-act="submit">📤 提交</button>
                    <button class="cw-dialogue-btn primary" data-act="send">💬 发送</button>
                    <button class="cw-dialogue-btn danger" data-act="end">⏹ 结束</button>
                </div>
            </div>
        `;
                layer.appendChild(inputBar);

                // 绑定事件，全部转发到 target
                const input = inputBar.querySelector('#cw-dialogue-player-input');
                input.addEventListener('input', () => {
                    input.style.height = 'auto';
                    input.style.height = Math.min(160, input.scrollHeight) + 'px';
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (e.ctrlKey || e.metaKey) target._onSend();
                        else target._onSubmit();
                    }
                });
                inputBar.querySelectorAll('.cw-dialogue-btn').forEach(b => {
                    b.addEventListener('click', () => {
                        const act = b.dataset.act;
                        if (act === 'ai') target._onAIHelp();
                        else if (act === 'submit') target._onSubmit();
                        else if (act === 'send') target._onSend();
                        else if (act === 'end') target._onEnd();
                        else if (act === 'history') target._toggleHistoryPanel?.();
                    });
                });
            }

            this._ensureHistoryFab();

            // 触发一次"玩家气泡历史"的渲染（target 要有 _roundPlayerMessages）
            this.renderPlayerHistoryFor(target);
        },

        /**
         * 渲染玩家回合气泡（外部 target 使用）
         */
        renderPlayerHistoryFor(target) {
            const el = document.getElementById('cw-dialogue-player-history');
            if (!el) return;
            const list = target._roundPlayerMessages || [];
            if (list.length === 0) {
                el.innerHTML = '';
                el.classList.remove('has-bubbles');
                return;
            }
            el.classList.add('has-bubbles');
            el.innerHTML = list.map(m =>
                `<div class="cw-dialogue-player-bubble">${this._escape(m)}</div>`
            ).join('');
            el.scrollTop = el.scrollHeight;
        },

        /**
         * 设置按钮禁用状态（外部 target 使用）
         */
        setButtonsDisabledFor(target, disabled) {
            const bar = document.getElementById('cw-dialogue-player-bar');
            if (!bar) return;
            bar.querySelectorAll('.cw-dialogue-btn').forEach(b => {
                if (b.dataset.act === 'end' || b.dataset.act === 'history') return;
                b.disabled = disabled;
            });
        },

        /**
         * 显示玩家输入栏（外部 target 使用）
         */
        showPlayerInputFor(target) {
            const bar = document.getElementById('cw-dialogue-player-bar');
            if (!bar) return;
            bar.classList.add('active');
            const dialogBox = document.getElementById('cinemaworld-dialogue-box');
            if (dialogBox) dialogBox.classList.remove('active');
            const input = bar.querySelector('#cw-dialogue-player-input');
            if (input) setTimeout(() => input.focus(), 50);
        },

        /**
         * 隐藏玩家输入栏（外部 target 使用）
         */
        hidePlayerInputFor(target) {
            document.getElementById('cw-dialogue-player-bar')?.classList.remove('active');
        },

        /**
         * 显示"思考中"提示
         */
        showThinkingFor(target) {
            this._hideThinking();
            const el = document.createElement('div');
            el.id = 'cw-dialogue-thinking';
            el.className = 'cw-dialogue-thinking';
            el.textContent = '对方正在回应…';
            const layer = document.getElementById('cinemaworld-vn-layer');
            if (layer) layer.appendChild(el);
        },

        /**
         * 隐藏"思考中"
         */
        hideThinkingFor(target) {
            document.getElementById('cw-dialogue-thinking')?.remove();
        },

        /**
         * 清场（外部 target 使用）
         */
        async cleanupVNFor(target) {
            const VN = window.VisualNovelManager;

            try { window.TTSPlayer?.abort?.(); } catch (e) { }

            if (VN) {
                try { VN.stop?.(); } catch (e) { }
                try { VN.clearSprites?.(); } catch (e) { }
            }

            const layer = document.getElementById('cinemaworld-vn-layer');
            if (layer) layer.classList.remove('active');
            const dialogBox = document.getElementById('cinemaworld-dialogue-box');
            if (dialogBox) dialogBox.classList.remove('active');
            const sceneSprites = document.getElementById('cinemaworld-scene-sprites');
            if (sceneSprites) sceneSprites.classList.remove('vn-active');
            VN?._hideVNBackground?.();

            if (window.MusicManager) {
                try { await window.MusicManager.clearScopedMusic('dialogue'); } catch (e) { }
            }

            this._hideHistoryPanel();
            document.getElementById('cw-dialogue-player-bar')?.remove();
            document.getElementById('cw-dialogue-history-fab')?.remove();
            document.getElementById('cw-dialogue-history-panel')?.remove();

            if (VN?.end) {
                try { await VN.end(); } catch (e) { }
            }
            if (VN) {
                try { VN.clearSprites?.(); } catch (e) { }
            }
            if (layer) layer.classList.remove('active');
            if (dialogBox) dialogBox.classList.remove('active');
            if (sceneSprites) sceneSprites.classList.remove('vn-active');
            VN?._hideVNBackground?.();

            requestAnimationFrame(() => {
                if (VN) {
                    try { VN.clearSprites?.(); } catch (e) { }
                }
                document.getElementById('cinemaworld-vn-layer')?.classList.remove('active');
                document.getElementById('cinemaworld-dialogue-box')?.classList.remove('active');
                document.getElementById('cinemaworld-scene-sprites')?.classList.remove('vn-active');
                VN?._hideVNBackground?.();
            });
        },

        /**
         * 切换背景/音乐（复用逻辑）
         */
        applyRoundBackgroundFor(target, name) {
            return this._applyRoundBackground(name);
        },

        applyRoundMusicFor(target, name) {
            return this._applyRoundMusic(name);
        },

        /**
         * 切分压行的对话（复用逻辑）
         */
        splitInlineDialoguesFor(target, text) {
            return this._splitInlineDialogues(text);
        },
        // ============================================================
        // 收尾生成：一次性让 AI 输出【效果】+【摘要】
        // 效果块直接交给 EffectSystem.applyFromNarrative() 解析，
        // 本文件不重复解析
        // ============================================================
        async _generateClosing(fullScript) {
            const playerName = this._getPlayerName();
            const ent = this._entity;
            const region = this._region;
            const map = this._map;

            // ---------- 组装上下文 ----------
            const ctxParts = [];

            let mapCtx = `【当前地图】${map?.name || '未知'}`;
            if (map?.description) mapCtx += `\n${map.description}`;
            if (region) {
                mapCtx += `\n【当前区域】${region.name}`;
                if (region.description) mapCtx += `\n${region.description}`;
            }
            ctxParts.push(mapCtx);

            if (window.PlayerStateManager?.formatForPrompt) {
                ctxParts.push(`【玩家信息】\n${window.PlayerStateManager.formatForPrompt()}`);
            }

            // 对话对象档案
            let entBlock = `【对话对象】\n名称：${ent.name}\n类型：${ent.kind}`;
            if (ent.description) entBlock += `\n描述：${ent.description}`;
            if (ent.status) entBlock += `\n状态：${ent.status}`;
            if (ent.effect) entBlock += `\n功能：${ent.effect}`;
            for (const [k, v] of Object.entries(ent.fields || {})) {
                if (k.startsWith('_pos')) continue;
                if (['图标', 'icon', '类型', '可拾取', '可堆叠', '最大堆叠'].includes(k)) continue;
                entBlock += `\n${k}：${v}`;
            }
            if ((ent.isCompanion || ent.kind === 'companion') && window.BondManager) {
                const cname = ent.meta?.companionName || ent.name;
                const bond = window.BondManager.getBond?.(cname);
                if (bond) {
                    const p = bond.profile || {};
                    if (p.gender) entBlock += `\n性别：${p.gender}`;
                    if (p.personality) entBlock += `\n性格：${p.personality}`;
                    if (p.background) entBlock += `\n背景：${p.background}`;
                    const stage = window.BondManager.getCurrentStage?.(bond);
                    if (stage) entBlock += `\n关系：${stage.name}`;
                }
            }
            ctxParts.push(entBlock);

            if (window.InteractionDigestManager && this._chapterId) {
                try {
                    const digestText = window.InteractionDigestManager.formatForCharacterPrompt(
                        ent.name, this._chapterId
                    );
                    if (digestText) ctxParts.push(`【与 ${ent.name} 的过往交互】\n${digestText}`);
                } catch (e) { }
            }

            if (this._openingGuide) {
                ctxParts.push(`【玩家开场语境】\n${this._openingGuide}`);
            }
            if (this._playerMessages.length > 0) {
                ctxParts.push(`【${playerName}本轮全部发言】\n${this._playerMessages.join('\n')}`);
            }

            // ---------- Prompt ----------
            // ★ 效果块格式严格按 EffectSystem.parseEffects 的识别要求
            const prompt = `你是视觉小说游戏的结算助手。玩家刚完成一段对话，请根据完整对话内容，生成【效果】和【摘要】两块。

${ctxParts.join('\n\n')}

【完整对话】
${fullScript}

===== 输出格式（严格遵守）=====

【效果】
（可选。仅当对话导致实际数据变化时才写，没有变化就整块省略）

目标: 玩家
数值变化: 键名 +N
实体变化:
- 获得【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
- 失去【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
- 获得状态 状态名
- 移除状态 状态名

【摘要】
（3-5 句，一段话）

===== 规则 =====

【效果】判定：
- 只有对话内容真的改变了某个数值/物品/状态，才写对应行；没有就整块省略
- 典型触发场景：
  · 角色给玩家某物 → 实体变化里写 获得【物品名|图标】：...
  · 玩家交给角色某物 → 实体变化里写 失去【物品名|图标】：...
  · 玩家情绪/身体状态改变 → 数值变化里写 理智-5 / 体力-3
  · 角色对玩家施加/解除 buff → 实体变化里写 获得状态 xxx / 移除状态 xxx
  · 角色好感度变化 → 数值变化里写 好感度+10
- 别瞎编。没有依据的变化不写。

【效果】里的目标：
- 目标只写"玩家"或"${ent.name}"，不要引入第三方
- 如果变化发生在 ${ent.name} 身上，目标写"${ent.name}"
- 如果变化发生在玩家身上，目标写"玩家"

【效果】里的实体变化行格式（示例）：
- 获得【旧书|📖】：一本发黄的书，[类型:物品|可拾取:是|可堆叠:否]
- 获得【生锈的钥匙|🔑】：沉甸甸的铜钥匙，[类型:物品|可拾取:是]
- 获得状态 眩晕
- 移除状态 疲劳

★ 关键：获得物品时必须写完整格式（方括号内 键:值），否则玩家拿到的是空壳。
★ 普通物品：至少写 [类型:物品]
★ 装备物品：写明属性字段，如 [类型:武器|攻击:+5|暴击:+10%]

【摘要】要求：
1. 说清前因：${playerName}为什么来找 ${ent.name}
2. 说清过程：${playerName}说了什么/做了什么、态度如何
3. 说清 ${ent.name} 的反应：态度变化、关键回应
4. 说清结果：有没有达成约定/透露信息/关系变化
5. 如果有悬念/追问没聊完，必须写出来
6. 一段话 3-5 句，不分点，不要加前缀，不罗列原话

请开始输出：`;

            const result = await window.generateFunctionalReply(prompt, 'dialogue-closing');
            return result?.trim() || '';
        },
        // ============================================================
        // 只做"切块"：从 AI 输出里切出【效果】块原文 + 【摘要】文本
        // 效果块不在这里解析——原样交给 EffectSystem.applyFromNarrative
        // ============================================================
        _parseClosing(closingText) {
            if (!closingText) return { effectBlock: '', summary: '' };

            // 摘要
            const summaryMatch = closingText.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
            const summary = summaryMatch ? summaryMatch[1].trim() : '';

            // 效果块（原样截取，含【效果】标签，交给 EffectSystem 处理）
            const effMatch = closingText.match(/【效果】[\s\S]*?(?=\n【|$)/);
            const effectBlock = effMatch ? effMatch[0].trim() : '';

            return { effectBlock, summary };
        },
        _recordToHistory(fullScript, summary, effectBlock) {
            if (!window.InteractionHistoryManager) return;

            window.InteractionHistoryManager.add({
                type: 'mapEntity',
                target: this._entity?.name || `对话 (${this._sessionId})`,
                targetMeta: {
                    entityId: this._entity?.id || null,
                    mode: 'dialogue-script',
                    useCompactContext: this._useCompactContext,
                },
                scene: this._region?.name || '(地图)',
                playerInput: this._playerMessages.join(' / ') || '（玩家没有说话）',
                script: fullScript,
                effect: effectBlock || null,
                summary: summary || '（未生成摘要）',
            });
        },
        async _cleanupVN() {
            const VN = window.VisualNovelManager;

            // ① 立即停掉所有异步流
            try { window.TTSPlayer?.abort?.(); } catch (e) { }

            // ② VN 停播（同步）
            if (VN) {
                try { VN.stop?.(); } catch (e) { }
                try { VN.clearSprites?.(); } catch (e) { }
            }

            // ③ 隐藏 VN 层/对话框（同步，立即生效）
            const layer = document.getElementById('cinemaworld-vn-layer');
            if (layer) layer.classList.remove('active');

            const dialogBox = document.getElementById('cinemaworld-dialogue-box');
            if (dialogBox) dialogBox.classList.remove('active');

            const sceneSprites = document.getElementById('cinemaworld-scene-sprites');
            if (sceneSprites) sceneSprites.classList.remove('vn-active');

            VN?._hideVNBackground?.();

            // ④ 清 BGM（异步，await 一下让状态干净）
            if (window.MusicManager) {
                try {
                    await window.MusicManager.clearScopedMusic('dialogue');
                } catch (e) {
                    console.warn('[MapDialogue] 清 BGM 失败:', e);
                }
            }

            // ⑤ 移除本模块自己注入的 DOM
            this._hideHistoryPanel();
            document.getElementById('cw-dialogue-player-bar')?.remove();
            document.getElementById('cw-dialogue-history-fab')?.remove();
            document.getElementById('cw-dialogue-history-panel')?.remove();

            // ⑥ ★ 兜底：VN.end() 异步，结束后再强清一次 DOM
            //    因为 VN.end() 内部可能有 TTS 回调/动画回调，会在几帧后再改 DOM
            if (VN?.end) {
                try { await VN.end(); } catch (e) { }
            }
            // 再清一次，防止 VN.end 的回调重写了 DOM
            if (VN) {
                try { VN.clearSprites?.(); } catch (e) { }
            }
            if (layer) layer.classList.remove('active');
            if (dialogBox) dialogBox.classList.remove('active');
            if (sceneSprites) sceneSprites.classList.remove('vn-active');
            VN?._hideVNBackground?.();

            // ⑦ 最后再清 state（这时才清 history，不影响前面已快照的 fullScript）
            this._history = [];
            this._historyVisible = false;
            this._scriptLines = [];
            this._playerMessages = [];
            this._roundPlayerMessages = [];

            // ⑧ 下一帧再兜底一次（有些动画 end 事件在 requestAnimationFrame 里触发）
            requestAnimationFrame(() => {
                if (VN) {
                    try { VN.clearSprites?.(); } catch (e) { }
                }
                document.getElementById('cinemaworld-vn-layer')?.classList.remove('active');
                document.getElementById('cinemaworld-dialogue-box')?.classList.remove('active');
                document.getElementById('cinemaworld-scene-sprites')?.classList.remove('vn-active');
                VN?._hideVNBackground?.();
            });
        },

        // ============================================================
        // 背景 / 音乐
        // ============================================================
        async _applyInitialDialogueMusic() {
            if (!window.MusicManager) return;

            const musicName = window.MusicManager.mapMusic
                || window.MusicManager.baseMusic
                || null;

            if (musicName) {
                await window.MusicManager.setScopedMusic('dialogue', musicName);
                console.log('[MapDialogue] 初始 BGM:', musicName);
            }
        },

        async _applyRoundBackground(name) {
            if (!name) return;
            if (!window.BackgroundManager) return;

            const url = await window.BackgroundManager.find(name);
            if (!url) {
                console.log(`[MapDialogue] 背景 "${name}" 不存在，保持当前背景`);
                return;
            }

            console.log(`[MapDialogue] 切换背景: ${name}`);

            if (window.BackgroundManager.apply) {
                await window.BackgroundManager.apply(name);
            }

            const vnBg = document.getElementById('cinemaworld-vn-background');
            if (vnBg) {
                const current = vnBg.style.backgroundImage || '';
                const next = `url('${url}')`;
                if (current !== next) {
                    vnBg.style.transition = 'opacity .4s';
                    vnBg.style.opacity = '0';
                    setTimeout(() => {
                        vnBg.style.backgroundImage = next;
                        vnBg.style.backgroundSize = 'cover';
                        vnBg.style.backgroundPosition = 'center';
                        vnBg.style.opacity = '1';
                    }, 400);
                }
            }
        },

        async _applyRoundMusic(name) {
            if (!name) return;
            if (!window.MusicManager) return;

            const url = await window.MusicManager.find(name);
            if (!url) {
                console.log(`[MapDialogue] 音乐 "${name}" 不存在，保持当前 BGM`);
                return;
            }

            try {
                await window.MusicManager.setScopedMusic('dialogue', name);
                console.log(`[MapDialogue] 切换 BGM: ${name}`);
            } catch (e) {
                console.warn('[MapDialogue] 切 BGM 失败:', e);
            }
        },

        // ============================================================
        // 历史
        // ============================================================
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

        _toggleHistoryPanel() {
            if (this._historyVisible) this._hideHistoryPanel();
            else this._showHistoryPanel();
        },

        _showHistoryPanel() {
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
                document.getElementById('cinemaworld-vn-layer').appendChild(panel);

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
                if (h.role === 'narrator') {
                    html += `<div class="cw-dlg-h-narrator">${this._escape(h.content)}</div>`;
                    lastSpeaker = null;
                    continue;
                }

                if (h.role === 'player') {
                    html += `
                        <div class="cw-dlg-h-row is-player">
                            <div class="cw-dlg-h-bubble">${this._escape(h.content)}</div>
                        </div>`;
                    lastSpeaker = h.character;
                    continue;
                }

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

            body.querySelectorAll('.cw-dlg-h-avatar').forEach(el => {
                const name = el.dataset.hAvatar;
                if (!name) return;
                el.setAttribute('data-h-avatar', name);
            });

            if (atBottom) body.scrollTop = body.scrollHeight;
        },

        _getHistoryAvatar(name) {
            if (window.SpriteManager) {
                const url = window.SpriteManager.getCachedSprite?.(name);
                if (url) {
                    return `<img src="${url}" alt="">`;
                }
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
        // 玩家提交的 TTS（独立于 VN 的 TTS 流水线）
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
                    console.warn('[MapDialogue] 玩家 TTS 失败:', e);
                }
            })();
        },

        // ============================================================
        // 样式
        // ============================================================
        _injectStyles() {
            if (document.getElementById('cw-dialogue-styles-v4')) return;
            document.getElementById('cw-dialogue-styles')?.remove();
            document.getElementById('cw-dialogue-styles-v2')?.remove();
            document.getElementById('cw-dialogue-styles-v3')?.remove();

            const s = document.createElement('style');
            s.id = 'cw-dialogue-styles-v4';
            s.textContent = `
.cw-dialogue-player-bar {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    width: min(860px, 94%);
    display: none;
    flex-direction: column;
    gap: 10px;
    z-index: 20;
}
.cw-dialogue-player-bar.active { display: flex; }

.cw-dialogue-player-history {
    display: none;
    flex-direction: column;
    gap: 8px;
    max-height: 160px;
    overflow-y: auto;
    padding: 0 6px;
    scrollbar-width: thin;
}
.cw-dialogue-player-history.has-bubbles { display: flex; }

.cw-dialogue-player-bubble {
    align-self: flex-end;
    max-width: 70%;
    padding: 10px 16px;
    background: rgba(58, 74, 130, 0.95);        /* ← 深蓝实色 */
    border: 1px solid rgba(140, 168, 255, 0.6); /* ← 边框更亮 */
    border-radius: 16px 16px 4px 16px;
    color: #f0f4ff;                              /* ← 文字更亮 */
    font-size: 15px;
    line-height: 1.6;
    word-break: break-word;
    animation: cwDlgBubbleIn .2s ease;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);  /* ← 阴影更深，气泡浮起来 */
}
@keyframes cwDlgBubbleIn {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
}

.cw-dialogue-player-input-wrap {
    background: rgba(20, 24, 40, .92);
    border: 1.5px solid rgba(120,150,255,.4);
    border-radius: 16px;
    padding: 14px 16px 12px;
    backdrop-filter: blur(8px);
    box-shadow: 0 8px 32px rgba(0,0,0,.5);
    transition: border-color .2s, box-shadow .2s;
}
.cw-dialogue-player-input-wrap:focus-within {
    border-color: rgba(120,150,255,.7);
    box-shadow: 0 8px 32px rgba(0,0,0,.5), 0 0 0 3px rgba(120,150,255,.15);
}

.cw-dialogue-player-input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: #eaf0ff;
    font-size: 16px;
    line-height: 1.65;
    resize: none;
    min-height: 28px;
    max-height: 160px;
    overflow-y: auto;
    font-family: inherit;
    padding: 4px 2px;
}
.cw-dialogue-player-input::placeholder {
    color: rgba(180,190,220,.5);
    font-size: 15px;
}

.cw-dialogue-player-btns {
    display: flex;
    gap: 10px;
    margin-top: 12px;
    justify-content: flex-end;
    flex-wrap: wrap;
}
.cw-dialogue-btn {
    padding: 9px 18px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,.18);
    background: rgba(255,255,255,.08);
    color: #e0e6ff;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all .15s;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 4px;
}
.cw-dialogue-btn:hover {
    background: rgba(120,150,255,.22);
    border-color: rgba(120,150,255,.55);
    transform: translateY(-1px);
}
.cw-dialogue-btn.primary {
    background: linear-gradient(135deg, #667eea, #764ba2);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
    box-shadow: 0 4px 14px rgba(102,126,234,.4);
}
.cw-dialogue-btn.primary:hover {
    filter: brightness(1.12);
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(102,126,234,.55);
}
.cw-dialogue-btn.danger {
    color: #ffaaaa;
    border-color: rgba(255,150,150,.3);
}
.cw-dialogue-btn.danger:hover {
    background: rgba(255,120,120,.18);
    border-color: rgba(255,120,120,.5);
}
.cw-dialogue-btn[disabled] {
    opacity: .4;
    cursor: not-allowed;
    pointer-events: none;
    transform: none;
}

.cw-dialogue-thinking {
    position: absolute;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 18px;
    background: rgba(0,0,0,.7);
    border-radius: 20px;
    color: #9ab0ff;
    font-size: 12px;
    z-index: 21;
    display: flex;
    gap: 6px;
    align-items: center;
}
.cw-dialogue-thinking::after {
    content: '';
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(154,176,255,.3);
    border-top-color: #9ab0ff;
    border-radius: 50%;
    animation: cwDlgSpin .8s linear infinite;
}
@keyframes cwDlgSpin { to { transform: rotate(360deg); } }

.cw-dialogue-history-fab {
    position: absolute;
    top: 16px;
    right: 16px;
    width: 40px;
    height: 40px;
    border-radius: 20px;
    border: 1px solid rgba(255,255,255,.2);
    background: rgba(20, 24, 40, .7);
    color: #fff;
    font-size: 18px;
    cursor: pointer;
    z-index: 30;
    backdrop-filter: blur(6px);
    transition: all .15s;
    display: flex;
    align-items: center;
    justify-content: center;
}
.cw-dialogue-history-fab:hover {
    background: rgba(120,150,255,.4);
    border-color: rgba(120,150,255,.6);
    transform: scale(1.08);
}

.cw-dialogue-history-panel {
    position: absolute;
    inset: 0;
    background: rgba(10, 12, 20, .88);
    backdrop-filter: blur(8px);
    z-index: 40;
    display: none;
    align-items: center;
    justify-content: center;
    animation: cwHistFadeIn .2s ease;
}
.cw-dialogue-history-panel.active { display: flex; }

@keyframes cwHistFadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}

.cw-dialogue-history-inner {
    width: min(720px, 92%);
    max-height: 86vh;
    background: rgba(20, 24, 40, .95);
    border: 1px solid rgba(120,150,255,.3);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,.6);
}

.cw-dialogue-history-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 20px;
    border-bottom: 1px solid rgba(255,255,255,.08);
    font-size: 15px;
    font-weight: 600;
    color: #a8c4ff;
}
.cw-dialogue-history-close {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: none;
    background: rgba(255,255,255,.08);
    color: #ccc;
    font-size: 16px;
    cursor: pointer;
    transition: all .15s;
}
.cw-dialogue-history-close:hover {
    background: rgba(255,120,120,.25);
    color: #fff;
}

.cw-dialogue-history-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scrollbar-width: thin;
    scrollbar-color: rgba(120,150,255,.4) transparent;
}
.cw-dialogue-history-body::-webkit-scrollbar {
    width: 8px;
}
.cw-dialogue-history-body::-webkit-scrollbar-thumb {
    background: rgba(120,150,255,.3);
    border-radius: 4px;
}

.cw-dialogue-history-empty {
    text-align: center;
    color: #666;
    padding: 60px 20px;
    font-size: 13px;
}

.cw-dlg-h-narrator {
    font-style: italic;
    color: #9ab0ff;
    font-size: 13px;
    text-align: center;
    padding: 4px 0;
    line-height: 1.7;
}

.cw-dlg-h-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
}
.cw-dlg-h-row.is-player {
    justify-content: flex-end;
}

.cw-dlg-h-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    overflow: hidden;
    flex-shrink: 0;
    background: rgba(120,150,255,.2);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #a8c4ff;
    font-size: 14px;
    font-weight: 600;
}
.cw-dlg-h-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center top;
}

.cw-dlg-h-col {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-width: 72%;
}

.cw-dlg-h-name {
    font-size: 12px;
    color: #9ab0ff;
    font-weight: 600;
}
.cw-dlg-h-state {
    font-weight: 400;
    color: #7a8090;
    font-style: italic;
}

.cw-dlg-h-bubble {
    padding: 8px 14px;
    background: rgba(255,255,255,.06);
    border: 1px solid rgba(255,255,255,.1);
    border-radius: 4px 12px 12px 12px;
    color: #e0e6ff;
    font-size: 13px;
    line-height: 1.6;
    word-break: break-word;
    white-space: pre-wrap;
}

.cw-dlg-h-row.is-player .cw-dlg-h-bubble {
    background: rgba(120,150,255,.25);
    border: 1px solid rgba(120,150,255,.45);
    border-radius: 12px 4px 12px 12px;
    color: #e6ecff;
}
`;
            document.head.appendChild(s);
        },
        // ============================================================
        // ★ 把 AI 压成一行的多个【xxx】: 拆成独立行
        // ============================================================
        _splitInlineDialogues(text) {
            if (!text) return '';

            // 按行处理
            return String(text).split('\n').map(line => {
                const trimmed = line.trim();
                if (!trimmed) return line;

                // 快速判断：这一行有几个【xxx】: 标记
                // 用全局正则找出所有 "【...】:" 的位置
                const markerRegex = /【[^】]+】\s*[:：]/g;
                const markers = [];
                let m;
                while ((m = markerRegex.exec(trimmed)) !== null) {
                    markers.push({
                        start: m.index,
                        end: m.index + m[0].length,
                        raw: m[0],
                    });
                }

                // 只有 1 个标记 → 正常行，原样返回
                if (markers.length <= 1) return line;

                // ★ 多个标记 → 拆分
                // 按标记的 start 位置切开
                // 每一段 = [start_i, start_{i+1})，但要把"标记本身"留在段的开头
                const parts = [];
                for (let i = 0; i < markers.length; i++) {
                    const start = markers[i].start;
                    const end = i + 1 < markers.length ? markers[i + 1].start : trimmed.length;
                    let segment = trimmed.substring(start, end).trim();

                    // 去掉末尾的标点残留（"，" "。" 等连接符）
                    segment = segment.replace(/[，,、]\s*$/, '');

                    if (segment) parts.push(segment);
                }

                return parts.join('\n');
            }).join('\n');
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

        isActive() {
            return this._active;
        },
    };

    window.MapDialogue = MapDialogue;
    console.log('[CinemaWorld] map-dialogue.js 已加载');
})();