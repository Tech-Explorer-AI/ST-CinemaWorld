// ============================================================
// CinemaWorld · ui.js
// 顶层 UI：AI 生成 / 主界面 / VN / 手机 / 玩家创建 / 启动
// 依赖：core.js, world.js, player.js, scene.js, story.js,
//       rules.js, interact.js, battle.js, simulation.js
// ============================================================

(function () {
    'use strict';

    // ==================== 核心 AI 生成函数 ====================
    // 说明：
    // - generateFunctionalReply: 功能性生成，不污染对话上下文
    // - generateDialogueReply: 对话式生成，会带上下文（用于角色深度对话，目前暂未使用）

    async function generateFunctionalReply(prompt, purpose = 'functional') {
        if (CinemaWorld.isGenerating) {
            console.log('[CinemaWorld] AI正在生成中，请稍后');
            return null;
        }
        CinemaWorld.isGenerating = true;
        try {
            CharacterNameManager.sync();
            const aiName = CinemaWorld.currentAIChatName;
            const userName = (typeof PlayerStateManager !== 'undefined' && PlayerStateManager.player?.name)
            ? PlayerStateManager.player.name
            : CinemaWorld.currentUserName;

            console.log(`[CinemaWorld] 功能性生成: ${purpose} (AI=${aiName})`);

            const context = SillyTavern.getContext();
            if (!context || !context.generateQuietPrompt) {
                console.error('[CinemaWorld] 无法调用 generateQuietPrompt');
                return null;
            }

            // ★ 用"虚拟消息数组"构建，完全参考 generateAIReply
            const messages = [
                { role: 'system', content: prompt },
            ];

            const fullPrompt = messages.map(m => {
                if (m.role === 'system') return `\n系统:${m.content}，注：玩家的名字是${userName}`;
                if (m.role === 'assistant') return `\n${aiName}:${m.content}`;
                if (m.role === 'user') return `\n${userName}:${m.content}`;
                return `${m.content}`;
            }).join('');

            const result = await context.generateQuietPrompt({
                quietPrompt: `${fullPrompt}\n]\nAI:
                `
            });

            if (result) {
                console.log(`[CinemaWorld] 生成完成: ${purpose}`);
                return result;
            }
            return null;
        } catch (error) {
            console.error('[CinemaWorld] 生成失败:', error);
            return null;
        } finally {
            CinemaWorld.isGenerating = false;
        }
    }

    // ==================== UI 管理器 ====================
    const UIManager = {
        init() {
            this.createStyles();
            this.createMainContainer();
            this.createFloatingButtons();
            PlayerStateManager.init();
            SceneSpriteLayerManager.init();  // ★
            SceneAvatarBarManager.init();    // ★
            VisualNovelManager.init();
            MusicManager.init();
        },

        createStyles() {
            CinemaWorldCSS.ensure();
        },

        // 打开模态框（统一入口）
        // 会自动重置 class，防止上一次的专属 class 残留
        openModal(extraClass = '') {
            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return null;
            modal.className = extraClass ? `active ${extraClass}` : 'active';
            return modal;
        },

        // 关闭模态框（彻底清空）
        closeModal() {
            const modal = document.getElementById('cinemaworld-modal');
            if (modal) modal.className = '';
        },

        createMainContainer() {
            if (document.getElementById('cinemaworld-container')) return;
            const container = document.createElement('div');
            container.id = 'cinemaworld-container';
            container.innerHTML = `
                <div id="cinemaworld-background"></div>
                <div id="cinemaworld-worldstate"></div>
                <div id="cinemaworld-content"></div>
                <div id="cinemaworld-text-area"></div>
                <div id="cinemaworld-floating-buttons"></div>
                <div id="cinemaworld-scene-actions"></div>
                <div id="cinemaworld-modal"></div>`;

            document.body.appendChild(container);
        },

        createFloatingButtons() {
            const container = document.getElementById('cinemaworld-floating-buttons');
            container.innerHTML = '';
            container.classList.remove('more-expanded');

            const inScene = !!CinemaWorld.ui.currentLocation;

            let highFreq = [];
            let lowFreq = [];

            if (inScene) {
                highFreq = [
                    { icon: '🎒', label: '背包', action: 'inventory' },
                    { icon: '📖', label: '剧情', action: 'story' },
                    { icon: '📦', label: '场景实体', action: 'scene-items' },
                ];
                lowFreq = [
                    { icon: '📚', label: '章节', action: 'chapters' },
                    { icon: '👥', label: '场景人物', action: 'scene-characters' },
                    { icon: '📍', label: '场景切换', action: 'location' },
                    { icon: '🚪', label: '离开场景', action: 'exit-location' },
                ];
            } else {
                highFreq = [
                    { icon: '📍', label: '选择场景', action: 'location' },
                    { icon: '⚙️', label: '设置', action: 'settings' },
                    { icon: '❌', label: '退出', action: 'exit' },
                ];
            }

            // ★ 高频按钮
            highFreq.forEach(btn => {
                const button = document.createElement('button');
                button.className = 'cinemaworld-fab';
                button.innerHTML = btn.icon;
                button.title = btn.label;
                button.addEventListener('click', (e) => {
                    e.stopPropagation();               // ★ 防止 document 收起逻辑误伤
                    this.handleButtonClick(btn.action);
                });
                container.appendChild(button);
            });

            // ★ 低频：更多 + 扇形
            if (lowFreq.length > 0) {
                const moreBtn = document.createElement('button');
                moreBtn.className = 'cinemaworld-fab cinemaworld-fab-more';
                moreBtn.innerHTML = '⋯';
                moreBtn.title = '更多';
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    container.classList.toggle('more-expanded');
                });
                container.appendChild(moreBtn);

                const fan = document.createElement('div');
                fan.className = 'cinemaworld-fab-fan';

                lowFreq.forEach((btn, i) => {
                    const button = document.createElement('button');
                    button.className = 'cinemaworld-fab cinemaworld-fab-fan-item';
                    button.innerHTML = btn.icon;
                    button.title = btn.label;
                    button.style.setProperty('--fan-i', i);
                    // ★ 分母保护，只有 1 个时也正常
                    button.style.setProperty('--fan-total', Math.max(2, lowFreq.length));

                    button.addEventListener('click', (e) => {
                        e.stopPropagation();           // ★ 关键
                        container.classList.remove('more-expanded');
                        this.handleButtonClick(btn.action);
                    });
                    fan.appendChild(button);
                });

                container.appendChild(fan);
            }

            // ★ 收起逻辑：只监听一次
            if (!container._collapseBound) {
                container._collapseBound = true;
                document.addEventListener('click', (e) => {
                    // 点击在浮动按钮区内部 → 不收起
                    if (e.target.closest('#cinemaworld-floating-buttons')) return;
                    container.classList.remove('more-expanded');
                });
            }
        },

        handleButtonClick(action) {
            switch (action) {
                case 'inventory': InventoryManager.open(); break;
                case 'story': StoryManager.openStoryList(); break;
                case 'chapters': StoryManager.openChapterList(); break;
                case 'scene-characters': SceneCharacterBrowserManager.openBrowser(); break;
                case 'scene-items': SceneItemBrowserManager.openBrowser(); break;
                case 'location': LocationModalManager.openLocationBrowser(); break;
                case 'exit-location': LocationModalManager.exitCurrentLocation(); break;
                case 'settings': this.openSettings(); break;
                case 'exit': this.exitCinemaWorld(); break;
            }
        },

        openSettings() {
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚙️ 设置</div>
                <div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" onclick="SaveManager.exportSave()">💾 导出存档</button>
                    <button class="cinemaworld-button" onclick="SaveManager.importSave()">📥 导入存档</button>
                    <button class="cinemaworld-button" onclick="UIManager.resetWorld()">🔄 重置世界</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },

        saveSettings() {
            const name = document.getElementById('world-name-input').value.trim();
            if (name) CinemaWorld.worldState.name = name;
            SaveManager.save();
            this.updateWorldStateDisplay();
            this.closeModal();
        },

        resetWorld() {
            if (!confirm('确定要重置世界吗？所有数据将丢失！')) return;

            // ★ 使用 SaveManager 的统一空模板
            CinemaWorld.worldState = SaveManager.getEmptyWorldState();
            PlayerStateManager.player = SaveManager.getEmptyPlayer();
            PlayerStateManager.player.name = CinemaWorld.currentUserName || '主人公';

            CinemaWorld.ui.currentLocation = null;
            LocationModalManager.currentLocation = null;

            StoryManager.storyList = [];
            StoryManager.chapters = [];
            StoryManager.currentChapter = null;
            StoryManager.currentStory = null;
            StoryManager.volumes = [];
            StoryManager.currentVolume = null;
            StoryManager._listIndex = 0;

            // ★ 清空规则引擎
            if (typeof RuleEngine !== 'undefined') {
                RuleEngine.parse('');
            }
            if (typeof BattleRuleManager !== 'undefined') {
                BattleRuleManager.save({ ...BattleRuleManager.DEFAULT_RULES });
            }
            if (typeof TagEffectManager !== 'undefined') {
                TagEffectManager.syncFromRules();
            }

            // ★ 清空视觉层
            BackgroundManager.clear();
            MusicManager.setSceneMusic(null);
            MusicManager.clearOverrideMusic();
            SceneSpriteLayerManager.clear();
            SceneAvatarBarManager.clear();

            // ★ 清空运行时缓存
            if (typeof SpriteManager !== 'undefined') {
                SpriteManager.cache = {};
                SpriteManager.characterSpriteMap = {};
                SpriteManager.randomPoolCache = {};
                SpriteManager.playerSprite = undefined;
                SpriteManager.playerAvatar = undefined;
            }
            if (typeof BattleManager !== 'undefined') {
                BattleManager._runtime = { defending: false, playerCooldowns: {}, enemyCooldowns: {} };
            }

            SaveManager.deleteSave();
            PlayerStateManager.refreshAvatarArea();
            this.createFloatingButtons();
            this.updateWorldStateDisplay();
            this.closeModal();
            SceneActionManager.refresh();
            StartupManager.checkInitialization();
        },

        async showText(text, duration = 3000) {
            const el = document.getElementById('cinemaworld-text-area');
            el.innerHTML = text.replace(/\n/g, '<br>');
            el.classList.add('visible');
            if (duration > 0) {
                await new Promise(r => setTimeout(r, duration));
                el.classList.remove('visible');
            }
        },

        updateWorldStateDisplay() {
            const el = document.getElementById('cinemaworld-worldstate');
            if (!el) return;

            const cur = CinemaWorld.ui.currentLocation;
            const scene = cur ? WorldManager.findEntity(cur) : null;

            if (!scene) {
                el.innerHTML = `<div style="color:#666;font-style:italic;">未进入场景</div>`;
                return;
            }

            const collapsed = this._wsCollapsed;
            const toggleIcon = collapsed ? '▶' : '▼';
            const hasDesc = !!(scene.description && scene.description.trim());

            // 标题行：📍 场景名 + 描述按钮 + 收起 + 编辑
            let html = `
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="font-weight:700;font-size:16px;color:#fff;letter-spacing:.3px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        📍 ${scene.name}
                    </div>
                    ${hasDesc ? `<button class="cw-ws-btn cw-ws-btn-desc" onclick="UIManager.showSceneDescription()" title="查看场景描述">❗</button>` : ''}
                    <button class="cw-ws-btn" onclick="UIManager.toggleWorldState()" title="收起/展开">${toggleIcon}</button>
                    <button class="cw-ws-btn" onclick="UIManager.editEnvData()" title="编辑环境数据">✏️</button>
                </div>`;

            if (collapsed) {
                el.innerHTML = html;
                return;
            }

            // ★ 环境数据（描述不再这里渲染）
            const env = scene.environmentData;
            if (env && env._order && env._order.length > 0) {
                const iconMap = {
                    '时间':'🕐','天气':'🌤','温度':'🌡','风力':'💨','季节':'🍃',
                    '湿度':'💧','能见度':'👁','日期':'📅','月相':'🌙','潮汐':'🌊',
                };
                const lines = env._order
                    .filter(k => env[k] !== undefined && env[k] !== '')
                    .map(k => {
                        const icon = iconMap[k] || '·';
                        return `<div style="display:flex;gap:6px;">
                            <span style="color:#9ab0ff;flex-shrink:0;">${icon} ${k}</span>
                            <span style="color:#ddd;flex:1;text-align:right;">${env[k]}</span>
                        </div>`;
                    });

                if (lines.length > 0) {
                    html += `
                        <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.15);
                            max-height:180px;overflow-y:auto;font-size:12px;line-height:1.9;">
                            ${lines.join('')}
                        </div>`;
                }
            }

            el.innerHTML = html;
        },

        // 弹出场景描述
        showSceneDescription() {
            const cur = CinemaWorld.ui.currentLocation;
            const scene = cur ? WorldManager.findEntity(cur) : null;
            if (!scene || !scene.description) return;

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📍 ${scene.name}</div>
                <div style="font-size:14px;line-height:1.9;color:#ddd;
                    padding:14px;background:rgba(0,0,0,.25);border-radius:10px;
                    max-height:60vh;overflow-y:auto;white-space:pre-wrap;">${scene.description}</div>
                <div style="text-align:center;margin-top:18px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },

        // 收起/展开状态栏
        _wsCollapsed: false,
        toggleWorldState() {
            this._wsCollapsed = !this._wsCollapsed;
            this.updateWorldStateDisplay();
        },

        // 手动编辑环境数据
        editEnvData() {
            const cur = CinemaWorld.ui.currentLocation;
            const scene = cur ? WorldManager.findEntity(cur) : null;
            if (!scene) return;

            // 把当前环境数据拼成可编辑文本
            const env = scene.environmentData;
            let text = '';
            if (env && env._order) {
                text = env._order
                    .filter(k => env[k] !== undefined && env[k] !== '')
                    .map(k => `${k}: ${env[k]}`)
                    .join('\n');
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">✏️ 编辑环境数据</div>
                <div style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.6;">
                    每行一个「键: 值」，键名可自由增删。<br>
                    例如：<code>时间: 清晨7:00</code>、<code>天气: 暴雨</code>
                </div>
                <textarea class="cinemaworld-textarea" id="cw-env-edit-input"
                    style="min-height:220px;font-family:monospace;">${text}</textarea>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button primary" onclick="UIManager.saveEnvData()">保存</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;
            modal.className = 'active';
        },

        // 保存环境数据
        saveEnvData() {
            const input = document.getElementById('cw-env-edit-input')?.value || '';
            const cur = CinemaWorld.ui.currentLocation;
            const scene = cur ? WorldManager.findEntity(cur) : null;
            if (!scene) return;

            const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
            const newEnv = { _order: [], _raw: '' };

            for (const line of lines) {
                const kv = line.match(/^(.+?)[:：]\s*(.+)$/);
                if (!kv) continue;
                const key = kv[1].trim();
                const value = kv[2].trim();
                if (!key) continue;
                newEnv[key] = value;
                newEnv._order.push(key);
            }

            newEnv._raw = newEnv._order.map(k => `${k}:${newEnv[k]}`).join('|');
            scene.environmentData = newEnv;

            this.closeModal();
            this.updateWorldStateDisplay();
            SaveManager.save();
        },

        exitCinemaWorld() {
            document.getElementById('cinemaworld-container').classList.remove('active');
            MusicManager.setEnabled(false);   // ★
            SaveManager.save();
        },

        async enterCinemaWorld() {
            document.getElementById('cinemaworld-container').classList.add('active');
            this.updateWorldStateDisplay();

            MusicManager.setEnabled(true);    // ★ 先开音乐门禁

            const curScene = LocationModalManager.currentLocation;
            if (curScene && !SceneSpriteLayerManager.slots.length) {
                await LocationModalManager.restoreScene(curScene);
            }

            StartupManager.checkInitialization();
        },
    };

    // ==================== 视觉小说界面 ====================
    const VisualNovelManager = {
        dialogueQueue: [],
        isPlaying: false,
        typewriterTimer: null,
        _playResolve: null,
        _currentDialogue: null,
        // ★ 记录每个位置上当前是谁
        _slots: { left: null, center: null, right: null },

        init() {
            this.createLayer();
            this.addStyles();
        },

        createLayer() {
            if (document.getElementById('cinemaworld-vn-layer')) return;
            const container = document.getElementById('cinemaworld-container');
            const layer = document.createElement('div');
            layer.id = 'cinemaworld-vn-layer';
            layer.innerHTML = `
                <div id="cinemaworld-sprite-layer">
                    <div class="cinemaworld-sprite-slot" data-position="left"></div>
                    <div class="cinemaworld-sprite-slot" data-position="center"></div>
                    <div class="cinemaworld-sprite-slot" data-position="right"></div>
                </div>
                <div id="cinemaworld-dialogue-box">
                    <div id="cinemaworld-speaker-name"></div>
                    <div id="cinemaworld-dialogue-text"></div>
                    <div id="cinemaworld-dialogue-hint">点击继续 ▶</div>
                    <button id="cinemaworld-vn-skip" title="跳过本段剧情">⏭ 跳过</button>
                </div>`;
            container.appendChild(layer);
            layer.addEventListener('click', () => this.advance());

            // ★ 跳过按钮：阻止冒泡，避免被 layer 的 advance 吞掉
            const skipBtn = layer.querySelector('#cinemaworld-vn-skip');
            skipBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.skip();
            });
        },

        addStyles() {
            CinemaWorldCSS.ensure();
        },

        parseScript(text) {
            const out = [];
            const rawLines = text.split('\n');
        
            // ★ 预处理：合并"角色行 + 下一行以冒号开头"的跨行格式
            const mergedLines = [];
            for (let i = 0; i < rawLines.length; i++) {
                const cur = rawLines[i].trim();
                if (!cur) continue;
        
                // 当前行是【xxx】格式（角色行），且不含冒号
                const isCharLine = /^【.+?】\s*$/.test(cur);
        
                if (isCharLine && i + 1 < rawLines.length) {
                    const next = rawLines[i + 1].trim();
                    // 下一行以冒号开头 → 合并
                    if (/^[:：]/.test(next)) {
                        mergedLines.push(cur + next);
                        i++;   // 跳过下一行
                        continue;
                    }
                }
        
                mergedLines.push(cur);
            }
        
            // ★ 正式解析（单行格式）
            for (const line of mergedLines) {
                const m = line.match(/^【(.+?)】\s*[:：]\s*(.+)$/);
                if (!m) continue;
        
                const meta = m[1].split('|').map(s => s.trim());
                const name = meta[0] || '未知';
                const vis = meta[1] || '显示';
                const posStr = meta[2] || '中';
                const extra = meta[3] || '';
                const state = meta[4] || '';
        
                let pos = 'center';
                if (posStr.includes('左')) pos = 'left';
                else if (posStr.includes('右')) pos = 'right';
        
                out.push({
                    character: name,
                    visibility: vis.includes('隐藏') ? 'hidden' : 'visible',
                    position: pos,
                    extraInfo: extra,
                    state,
                    content: m[2].trim(),
                });
            }
            return out;
        },

        async play(dialogues) {
            if (this.isPlaying) this.stop();
            this.dialogueQueue = [...dialogues];
            this.isPlaying = true;

            const playPromise = new Promise(resolve => { this._playResolve = resolve; });

            // ★ 隐藏场景立绘层
            const sceneSprites = document.getElementById('cinemaworld-scene-sprites');
            if (sceneSprites) sceneSprites.classList.add('vn-active');

            document.getElementById('cinemaworld-vn-layer').classList.add('active');
            this.clearSprites();
            this._slots = { left: null, center: null, right: null };

            this.playNext();
            await playPromise;
        },

        async playNext() {
            if (this.dialogueQueue.length === 0) {
                await this.end();
                return;
            }
            const d = this.dialogueQueue.shift();
            await this.updateSprite(d);
            await this.showDialogue(d);
        },

        async updateSprite(d) {
            const slot = document.querySelector(`.cinemaworld-sprite-slot[data-position="${d.position}"]`);
            if (!slot) return;

            const isPlayer = ['玩家', '我', '主人公', 'player'].includes(d.character);
            const isNarrator = ['旁白', '系统', 'narrator'].includes(d.character);
            const slotKey = d.position;
            const currentOccupant = this._slots[slotKey];
            if (isNarrator) {
                slot.innerHTML = '';
                delete slot.dataset.characterName;
                this._slots[d.position] = null;
                this._applyHighlight(d.character);
                return;
            }

            // 如果这个位置已经是这个角色
            if (currentOccupant === d.character) {
                const existing = slot.querySelector('.cinemaworld-sprite, .cinemaworld-sprite-placeholder');
                if (existing) {
                    // ★ 先算这一行要用的状态
                    const state = d.state || this._pickStateFor(d.character);
                    const imgEl = slot.querySelector('.cinemaworld-sprite-img, img.cinemaworld-sprite');

                    // ★ 如果状态变了 → 需要换图，走重建逻辑
                    const prevState = slot.dataset.spriteState || '默认';
                    const stateChanged = (state !== prevState);

                    if (!stateChanged && imgEl) {
                        // 状态没变，只切显隐/高亮
                        if (d.visibility === 'hidden') {
                            existing.classList.add('hidden-state');
                            existing.classList.remove('visible');
                        } else {
                            existing.classList.remove('hidden-state');
                            existing.classList.add('visible');
                        }
                        this._applyHighlight(d.character);
                        return;
                    }

                    // ★ 状态变了 → 让下面重建逻辑接手
                    // （不 return，_slots 不清空，但会重建 img）
                    if (!stateChanged && !imgEl) {
                        // 无 img（占位符）且状态未变 → 也只切显隐
                        if (d.visibility === 'hidden') {
                            existing.classList.add('hidden-state');
                            existing.classList.remove('visible');
                        } else {
                            existing.classList.remove('hidden-state');
                            existing.classList.add('visible');
                        }
                        this._applyHighlight(d.character);
                        return;
                    }
                    // 继续往下走
                } else {
                    this._slots[slotKey] = null;
                }
            }

            // ★ 计算这一刻该用哪个状态
            const state = d.state || this._pickStateFor(d.character);

            const url = isPlayer
                ? await SpriteManager.getPlayerSpriteState(state)
                : await SpriteManager.get(d.character, d.extraInfo || '默认', state);

            slot.innerHTML = '';
            slot.dataset.characterName = d.character;
            slot.dataset.spriteState = state;    // ★ 记录状态，下次比对
            this._slots[slotKey] = d.character;

            // 玩家不显示时清空
            if (isPlayer && d.visibility === 'hidden') {
                slot.innerHTML = '';
                this._slots[slotKey] = null;
                return;
            }

            if (url) {
                const img = document.createElement('img');
                img.className = 'cinemaworld-sprite ' + (d.visibility === 'visible' ? 'visible' : 'hidden-state');
                img.src = url;
                img.alt = d.character;
                slot.appendChild(img);
            } else {
                // 无立绘 → 占位
                const ph = document.createElement('div');
                ph.className = 'cinemaworld-sprite-placeholder';
                if (d.visibility === 'hidden') {
                    ph.style.opacity = '.4';
                    ph.style.filter = 'grayscale(100%)';
                }
                ph.innerHTML = `<div class="cinemaworld-sprite-placeholder-name">${d.character}</div>`;
                slot.appendChild(ph);
            }

            // ★ 应用高亮
            this._applyHighlight(d.character);
        },

        // ★ 从当前场景查这个角色的默认立绘状态
        _pickStateFor(characterName) {
            if (['玩家', '我', '主人公', 'player'].includes(characterName)) {
                return '默认';
            }
            const scene = window.LocationModalManager?.currentLocation;
            const char = scene?.sceneCharacters?.find(c => c.name === characterName);
            if (!char) return '默认';
            return SpriteManager.pickSpriteState(char);
        },

        // ★ 高亮当前说话者，其他变暗
        _applyHighlight(speakerName) {
            document.querySelectorAll('.cinemaworld-sprite-slot').forEach(slot => {
                const name = slot.dataset.characterName;
                const el = slot.querySelector('.cinemaworld-sprite, .cinemaworld-sprite-placeholder');
                if (!el) return;

                el.classList.remove('is-speaking', 'is-listening');

                if (name === speakerName) {
                    // ★ 兜底：说话者绝不能是隐藏态
                    el.classList.remove('hidden-state');
                    el.classList.add('visible');
                    el.classList.add('is-speaking');
                } else {
                    el.classList.add('is-listening');
                }
            });
        },

        async showDialogue(d) {
            this._currentDialogue = d;
            const box = document.getElementById('cinemaworld-dialogue-box');
            const nameEl = document.getElementById('cinemaworld-speaker-name');
            const textEl = document.getElementById('cinemaworld-dialogue-text');
            box.classList.add('active');
            const isNarrator = ['旁白', '系统', 'narrator'].includes(d.character);
            box.classList.add('active');

            if (isNarrator) {
                nameEl.textContent = '';
                nameEl.style.display = 'none';
                textEl.style.fontStyle = 'italic';
                textEl.style.color = '#b8b8c8';
                textEl.style.textAlign = 'center';
            } else {
                nameEl.textContent = d.character;
                nameEl.style.display = '';
                textEl.style.fontStyle = '';
                textEl.style.color = '';
                textEl.style.textAlign = '';
            }
            // ★ 玩家名字替换
            const displayName = ['玩家', '我', '主人公', 'player'].includes(d.character)
                ? PlayerStateManager.player.name
                : d.character;
            nameEl.textContent = displayName;

            textEl.textContent = '';
            textEl.classList.add('cinemaworld-typing');

            await new Promise(resolve => {
                let i = 0;
                const type = () => {
                    if (i < d.content.length) {
                        textEl.textContent += d.content.charAt(i++);
                        this.typewriterTimer = setTimeout(type, 30);
                    } else resolve();
                };
                type();
            });
            textEl.classList.remove('cinemaworld-typing');
            this._currentDialogue = null;
        },

        advance() {
            if (!this.isPlaying) return;
            const textEl = document.getElementById('cinemaworld-dialogue-text');
            if (textEl.classList.contains('cinemaworld-typing')) {
                if (this.typewriterTimer) clearTimeout(this.typewriterTimer);
                textEl.classList.remove('cinemaworld-typing');
                if (this._currentDialogue) {
                    textEl.textContent = this._currentDialogue.content;
                }
                return;
            }
            this.playNext();
        },

        async end() {
            this.isPlaying = false;
            document.getElementById('cinemaworld-dialogue-box').classList.remove('active');
            await new Promise(r => setTimeout(r, 500));
            this.clearSprites();
            document.getElementById('cinemaworld-vn-layer').classList.remove('active');

            const sceneSprites = document.getElementById('cinemaworld-scene-sprites');
            if (sceneSprites) sceneSprites.classList.remove('vn-active');

            if (this._playResolve) {
                this._playResolve();
                this._playResolve = null;
            }
        },

        clearSprites() {
            document.querySelectorAll('.cinemaworld-sprite-slot').forEach(s => {
                s.innerHTML = '';
                delete s.dataset.characterName;
            });
            this._slots = { left: null, center: null, right: null };
        },
        // ★ 跳过整段 VN：立刻结束播放，resolve play()
        async skip() {
            if (!this.isPlaying) return;

            // 清空队列 + 停掉打字机
            this.dialogueQueue = [];
            if (this.typewriterTimer) {
                clearTimeout(this.typewriterTimer);
                this.typewriterTimer = null;
            }

            // 直接走收尾流程（会 resolve _playResolve）
            await this.end();

            console.log('[CinemaWorld] VN 已跳过');
        },
        stop() {
            this.dialogueQueue = [];
            this.isPlaying = false;
            if (this.typewriterTimer) clearTimeout(this.typewriterTimer);
            if (this._playResolve) {
                this._playResolve();
                this._playResolve = null;
            }
            document.getElementById('cinemaworld-dialogue-box').classList.remove('active');
            this.clearSprites();
            document.getElementById('cinemaworld-vn-layer').classList.remove('active');
            const sceneSprites = document.getElementById('cinemaworld-scene-sprites');
            if (sceneSprites) sceneSprites.classList.remove('vn-active');
        },
    };

    // ==================== 手机界面管理器 ====================
    const PhoneUIManager = {
        // 当前打开的"应用"
        currentApp: null,
        // 是否打开
        isOpen: false,
        // 打开好友详情
        viewingFriend: null,

        // 打开手机
        open() {
            this.isOpen = true;
            this.currentApp = null;
            this.viewingFriend = null;
            this.render();
        },

        // 关闭手机
        close() {
            this.isOpen = false;
            const modal = document.getElementById('cinemaworld-modal');
            if (modal) {
                modal.className = '';  // ★ 清空类，恢复默认
                modal.innerHTML = '';
            }
        },

        // 渲染主界面
        render() {
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active cw-phone-modal';
            modal.innerHTML = `
                <div class="cw-phone">
                    ${this.renderStatusBar()}
                    <div class="cw-phone-screen">
                        ${this.currentApp ? this.renderApp() : this.renderHome()}
                    </div>
                    ${this.renderNavigation()}
                </div>`;

            // 注入样式（只注入一次）
            this.injectStyles();
        },

        // 状态栏
        renderStatusBar() {
            const time = this.getGameTime();
            return `
                <div class="cw-phone-statusbar">
                    <div class="cw-phone-statusbar-left">
                        <span>${time}</span>
                    </div>
                    <div class="cw-phone-statusbar-right">
                        <span>📶</span>
                        <span>🔋</span>
                    </div>
                </div>`;
        },
        
        // ★ 游戏时间：优先读当前场景的 environmentData.时间
        //   没有则退化为"现实时间"
        getGameTime() {
            const scene = window.LocationModalManager?.currentLocation;
            const env = scene?.environmentData;
        
            if (env && env._order && env._order.includes('时间')) {
                const t = String(env['时间'] || '').trim();
                if (t) return t;
            }
        
            // 兜底：现实时间
            const now = new Date();
            return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        },

        // 主屏幕（应用网格）
        renderHome() {
            const friends = this.getAllFriends();
            const unread = friends.reduce((sum, f) => sum + Math.min(f.interactions.length, 9), 0);

            const apps = [
                { id: 'social', icon: '📱', name: '社交', badge: this._getSocialBadge() },
                { id: 'bond', icon: '💫', name: '羁绊', badge: 0 },
                { id: 'contacts', icon: '💬', name: '通讯录', badge: unread },
                { id: 'story', icon: '📖', name: '剧情', badge: 0 },
                { id: 'bggen', icon: '🎨', name: '生图管理', badge: 0 },
                { id: 'scene', icon: '📍', name: '地图', badge: 0 },
                { id: 'bag', icon: '🎒', name: '背包', badge: 0 },
                { id: 'shop', icon: '🏪', name: '商店', badge: 0 },
                { id: 'rules', icon: '⚙️', name: '规则', badge: 0 },
                { id: 'settings', icon: '🔧', name: '设置', badge: 0 },
            ];

            return `
                <div class="cw-phone-wallpaper">
                    <div class="cw-phone-time">
                        <div class="cw-phone-clock">${this.getClockTime()}</div>
                        <div class="cw-phone-date">${this.getDateString()}</div>
                    </div>
                    <div class="cw-phone-apps">
                        ${apps.map(app => `
                            <div class="cw-phone-app" onclick="PhoneUIManager.openApp('${app.id}')">
                                <div class="cw-phone-app-icon">
                                    ${app.icon}
                                    ${app.badge > 0 ? `<div class="cw-phone-badge">${app.badge > 99 ? '99+' : app.badge}</div>` : ''}
                                </div>
                                <div class="cw-phone-app-name">${app.name}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>`;
        },

        // 打开应用
        openApp(appId) {
            this.currentApp = appId;
            this.viewingFriend = null;
            this.render();
        },
        _getSocialBadge() {
            if (typeof SocialDataManager === 'undefined') return 0;
            const store = SocialDataManager.ensureStore();
            return (store.unread.total || 0) + (store.unread.moments || 0);
        },
        renderShopApp() {
            const shops = ShopManager.getAll();
            let html = `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>商店</span>
                </div>
                <div class="cw-phone-app-body">`;

            if (shops.length === 0) {
                html += `
                    <div style="text-align:center;padding:60px 20px;">
                        <div style="font-size:48px;margin-bottom:15px;">🏪</div>
                        <div style="color:#666;margin-bottom:20px;">还没有遇到过任何商店</div>
                        <button class="cw-phone-rule-btn primary"
                            onclick="PhoneUIManager.close(); ShopManager.generateAndOpen()">
                            ➕ AI生成一个商店
                        </button>
                    </div>`;
            } else {
                for (const s of shops) {
                    html += `
                        <div class="cw-contact-item"
                             onclick="PhoneUIManager.close(); ShopManager.open('${s.id}')"
                             style="cursor:pointer;">
                            <div class="cw-contact-avatar"
                                style="background:linear-gradient(135deg,#ffb84d,#ff8a3d);font-size:22px;">
                                ${s.icon || '🏪'}
                            </div>
                            <div class="cw-contact-info">
                                <div class="cw-contact-name">${s.name}</div>
                                <div class="cw-contact-sub">
                                    ${s.stock?.length || 0} 件商品 · ${s.currency || '金币'}
                                </div>
                            </div>
                        </div>`;
                }
                html += `
                    <div style="text-align:center;margin-top:20px;">
                        <button class="cw-phone-rule-btn primary"
                            onclick="PhoneUIManager.close(); ShopManager.generateAndOpen()">
                            ➕ AI生成新商店
                        </button>
                    </div>`;
            }

            html += `</div>`;
            return html;
        },

        // 渲染当前应用
        renderApp() {
            switch (this.currentApp) {
                case 'contacts': return this.renderContactsApp();
                case 'story': return this.renderStoryApp();
                case 'social': return SocialAppUI.render();
                case 'bond': return BondUI.render();
                case 'scene': return this.renderSceneApp();
                case 'shop': return this.renderShopApp();
                case 'bag': return this.renderBagApp();
                case 'rules': return this.renderRulesApp();      // ★ 加这一行
                case 'bggen': return BackgroundGenAppUI.render();
                case 'settings': return this.renderSettingsApp();
                default: return '<div style="padding:20px;color:#fff;">未知应用</div>';
            }
        },

        // ========== 规则 App ==========
        renderRulesApp() {
            const rules = RuleEngine?.rules;
            const hasRules = !!(rules?.raw && rules.raw.trim());

            if (!hasRules) {
                return `
                    <div class="cw-phone-app-header">
                        <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                        <span>游戏规则</span>
                    </div>
                    <div class="cw-phone-app-body" style="text-align:center;padding:60px 20px;">
                        <div style="font-size:48px;margin-bottom:15px;">⚙️</div>
                        <div style="color:#666;margin-bottom:20px;">尚未定义游戏规则</div>
                        <button class="cw-phone-rule-btn primary"
                            onclick="PhoneUIManager.openRuleEditor()">➕ 生成规则</button>
                    </div>`;
            }

            // 已定义 → 概览
            let html = `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>游戏规则</span>
                </div>
                <div class="cw-phone-app-body">`;

            // 派生规则
            if (rules.derived?.length) {
                html += `
                    <div class="cw-phone-rule-section">
                        <div class="cw-phone-rule-section-title">派生规则</div>
                        ${rules.derived.map(r => `
                            <div class="cw-phone-rule-line">
                                <span class="cw-phone-rule-key">${r.name}</span>
                                <span class="cw-phone-rule-formula">${r.expr}</span>
                            </div>
                        `).join('')}
                    </div>`;
            }

            // 触发规则
            if (rules.triggers?.length) {
                html += `
                    <div class="cw-phone-rule-section">
                        <div class="cw-phone-rule-section-title">触发规则</div>
                        ${rules.triggers.map(t => {
                            const cond = t.condition.type === 'full' ? `${t.condition.barKey} 满`
                                    : t.condition.type === 'empty' ? `${t.condition.barKey} 空`
                                    : `${t.condition.barKey} ${t.condition.op} ${t.condition.value}`;
                            const acts = t.actions.map(a => {
                                if (a.type === 'attrChange') return `${a.target} ${a.op}${a.value}`;
                                if (a.type === 'gainItem') return `获得 ${a.name}`;
                                if (a.type === 'gainStatus') return `状态: ${a.name}`;
                                if (a.type === 'triggerEvent') {
                                    return a.detail ? `触发 ${a.name}（${a.detail}）` : `触发 ${a.name}`;
                                }
                                if (a.type === 'resetBar') return `${a.barKey} 归零`;
                                return '';
                            }).filter(Boolean).join('；');
                            return `
                                <div class="cw-phone-rule-trigger">
                                    <span class="cw-phone-rule-cond">${cond}</span>
                                    <span class="cw-phone-rule-arrow">→</span>
                                    <span class="cw-phone-rule-act">${acts}</span>
                                </div>`;
                        }).join('')}
                    </div>`;
            }

            // 升级规则（兼容旧字段）
            if (rules.levelUp?.length) {
                html += `
                    <div class="cw-phone-rule-section">
                        <div class="cw-phone-rule-section-title">升级规则</div>
                        <div class="cw-phone-rule-text">
                            ${rules.levelUp.map(a => `${a.target} ${a.op}${a.value}`).join('；')}
                        </div>
                    </div>`;
            }

            // 操作按钮
            html += `
                <div class="cw-phone-rule-actions">
                    <button class="cw-phone-rule-btn primary"
                        onclick="PhoneUIManager.openRuleEditor()">✏️ 编辑规则</button>
                    <button class="cw-phone-rule-btn"
                        onclick="PhoneUIManager.regenerateRules()">🔄 AI重新生成</button>
                </div>
                </div>`;

            return html;
        },

        // 打开规则编辑器（模态框）
        openRuleEditor() {
            this.close();
            if (typeof RuleCreationManager === 'undefined') {
                UIManager.showText('规则系统未加载', 2000);
                return;
            }
            RuleCreationManager.openEditor();
        },

        // AI 重新生成规则
        regenerateRules() {
            this.close();
            if (typeof RuleCreationManager === 'undefined') {
                UIManager.showText('规则系统未加载', 2000);
                return;
            }
            RuleCreationManager.showCreationModal(null);
        },

        // ========== 通讯录 App ==========
        renderContactsApp() {
            if (this.viewingFriend) {
                return this.renderFriendDetail(this.viewingFriend);
            }

            const friends = this.getAllFriends();
            const currentScene = CinemaWorld.ui.currentLocation;

            if (friends.length === 0) {
                return `
                    <div class="cw-phone-app-header">
                        <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                        <span>通讯录</span>
                    </div>
                    <div class="cw-phone-app-body" style="text-align:center;padding:60px 20px;">
                        <div style="font-size:48px;margin-bottom:15px;">📭</div>
                        <div style="color:#666;">还没有遇到过任何人</div>
                    </div>`;
            }

            // ★ 筛选
            const filter = this._contactFilter || 'all';
            let filtered = friends;
            if (filter === 'main')  filtered = friends.filter(f => f.role === 'main');
            if (filter === 'minor') filtered = friends.filter(f => f.role === 'minor');
            if (filter === 'npc')   filtered = friends.filter(f => f.role === 'npc');

            // 计数
            const counts = {
                all:   friends.length,
                main:  friends.filter(f => f.role === 'main').length,
                minor: friends.filter(f => f.role === 'minor').length,
                npc:   friends.filter(f => f.role === 'npc').length,
            };

            // 筛选 tab
            const tabsHTML = `
                <div class="cw-contact-tabs">
                    <button class="cw-contact-tab ${filter === 'all' ? 'active' : ''}"
                        onclick="PhoneUIManager.setFilter('all')">全部 ${counts.all}</button>
                    <button class="cw-contact-tab ${filter === 'main' ? 'active' : ''}"
                        onclick="PhoneUIManager.setFilter('main')">⭐主要 ${counts.main}</button>
                    <button class="cw-contact-tab ${filter === 'minor' ? 'active' : ''}"
                        onclick="PhoneUIManager.setFilter('minor')">👤次要 ${counts.minor}</button>
                    <button class="cw-contact-tab ${filter === 'npc' ? 'active' : ''}"
                        onclick="PhoneUIManager.setFilter('npc')">🏷️路人 ${counts.npc}</button>
                </div>`;

            let html = `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>通讯录 (${friends.length})</span>
                </div>
                ${tabsHTML}
                <div class="cw-phone-app-body">`;

            if (filtered.length === 0) {
                html += `<div style="text-align:center;padding:40px 20px;color:#666;">此分类下暂无角色</div>`;
            } else if (filter === 'all') {
                // 全部 → 按在场/不在场分组
                const inScene = filtered.filter(f => f.lastScene === currentScene);
                const outScene = filtered.filter(f => f.lastScene !== currentScene);

                if (inScene.length > 0) {
                    html += `<div class="cw-contacts-group-label">当前场景 · ${currentScene}</div>`;
                    for (const f of inScene) html += this.renderContactItem(f, true);
                }
                if (outScene.length > 0) {
                    html += `<div class="cw-contacts-group-label">其他</div>`;
                    for (const f of outScene) html += this.renderContactItem(f, false);
                }
            } else {
                // 指定分类 → 直接列
                for (const f of filtered) {
                    const isInScene = f.lastScene === currentScene;
                    html += this.renderContactItem(f, isInScene);
                }
            }

            html += `</div>`;
            return html;
        },

        renderContactItem(f, isInScene) {
            const initial = f.name.charAt(0);
            const genderColor = f.gender === '女' ? '#f28' : f.gender === '男' ? '#28f' : '#888';
            const unreadCount = f.interactions.length;

            const fav = parseInt(f.favorability);
            const favPct = isNaN(fav) ? 0 : Math.min(100, fav);
            const state = SpriteManager.pickSpriteState(f);
            const spriteUrl = SpriteManager.getCachedSpriteWithState(f.name, state)
                           || SpriteManager.getCachedSprite(f.name);
            const avatarHTML = spriteUrl
                ? `<img src="${spriteUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${f.name}">`
                : initial;

            if (!spriteUrl) {
                SpriteManager.ensureSpriteWithState(f.name, f.gender, state).then((url) => {
                    if (!url) return;
                    const el = document.querySelector(`[data-contact-avatar="${f.name}"]`);
                    if (el) {
                        el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${f.name}">`;
                        el.style.background = 'transparent';
                    }
                });
            }

            // ★ 角色徽章
            const roleBadge = f.role === 'main' ? '⭐'
                            : f.role === 'npc'  ? '🏷️'
                            : '';

            return `
                <div class="cw-contact-item" onclick="PhoneUIManager.viewFriend('${f.name.replace(/'/g, "\\'")}')">
                    <div class="cw-contact-avatar" data-contact-avatar="${f.name}"
                        style="background:${spriteUrl ? 'transparent' : genderColor};">
                        ${avatarHTML}
                        ${isInScene ? '<div class="cw-contact-online"></div>' : ''}
                    </div>
                    <div class="cw-contact-info">
                        <div class="cw-contact-name">
                            ${roleBadge ? `<span style="margin-right:4px;">${roleBadge}</span>` : ''}${f.name}
                        </div>
                        <div class="cw-contact-sub">${f.status || f.description?.substring(0, 20) || '暂无状态'}</div>
                    </div>
                    <div class="cw-contact-right">
                        ${!isNaN(fav) ? `
                            <div class="cw-contact-fav">♥ ${fav}</div>
                            <div class="cw-contact-favbar">
                                <div style="width:${favPct}%;"></div>
                            </div>
                        ` : ''}
                        ${unreadCount > 0 ? `<div class="cw-contact-count">${unreadCount}</div>` : ''}
                    </div>
                </div>`;
        },

        // ========== 好友详情 ==========
        viewFriend(name) {
            this.viewingFriend = name;
            this.render();
        },

        renderFriendDetail(name) {
            const friend = this.getAllFriends().find(f => f.name === name);
            if (!friend) {
                return `<div style="padding:20px;color:#fff;">找不到 ${name}</div>`;
            }

            const initial = friend.name.charAt(0);
            const isInCurrentScene = friend.lastScene === CinemaWorld.ui.currentLocation;
            const role = friend.role || 'minor';

            // ★ 头像：优先用立绘
            const state = SpriteManager.pickSpriteState(friend);
            const spriteUrl = SpriteManager.getCachedSpriteWithState(friend.name, state)
                           || SpriteManager.getCachedSprite(friend.name);
            const avatarHTML = spriteUrl
                ? `<img src="${spriteUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${friend.name}">`
                : initial;
            const avatarBg = spriteUrl
                ? 'transparent'
                : 'linear-gradient(135deg, #667eea, #764ba2)';

            // ★ 没有立绘时异步加载并替换
            if (!spriteUrl) {
                SpriteManager.ensureSpriteWithState(friend.name, friend.gender, state).then((url) => {
                    if (!url) return;
                    const el = document.querySelector('[data-friend-detail-avatar]');
                    if (el) {
                        el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${friend.name}">`;
                        el.style.background = 'transparent';
                    }
                });
            }

            return `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.backToContacts()">←</button>
                    <span>${friend.name}</span>
                </div>
                <div class="cw-phone-app-body">
                    <div class="cw-friend-profile">
                        <div class="cw-friend-avatar" data-friend-detail-avatar
                            style="background:${avatarBg};">
                            ${avatarHTML}
                        </div>
                        <div class="cw-friend-name">${friend.name}</div>
                        <div class="cw-friend-tags">
                            ${friend.gender ? `<span class="cw-friend-tag">${friend.gender}</span>` : ''}
                            ${friend.mood ? `<span class="cw-friend-tag">${friend.mood}</span>` : ''}
                            ${(friend.tags || []).map(t => {
                                const name = typeof t === 'string' ? t : t.name;
                                return `<span class="cw-friend-tag cw-friend-tag-special">${name}</span>`;
                            }).join('')}
                        </div>
                    </div>

                    <div class="cw-friend-section">
                        <div class="cw-friend-section-title">角色定位</div>
                        <div class="cw-role-switcher">
                            <button class="cw-role-btn ${role === 'main' ? 'active' : ''}"
                                onclick="PhoneUIManager.setRole('${friend.name.replace(/'/g, "\\'")}', 'main')">
                                ⭐ 主要
                            </button>
                            <button class="cw-role-btn ${role === 'minor' ? 'active' : ''}"
                                onclick="PhoneUIManager.setRole('${friend.name.replace(/'/g, "\\'")}', 'minor')">
                                👤 次要
                            </button>
                            <button class="cw-role-btn ${role === 'npc' ? 'active' : ''}"
                                onclick="PhoneUIManager.setRole('${friend.name.replace(/'/g, "\\'")}', 'npc')">
                                🏷️ 路人
                            </button>
                        </div>
                        <div class="cw-role-hint">
                            ${role === 'main' ? '⭐ 主要角色会参与主线剧情，可远程登场。'
                            : role === 'npc'  ? '🏷️ 路人是背景人物，不参与主线。'
                            : '👤 次要角色只在自己场景出现，不主动参与主线。'}
                        </div>
                    </div>

                    <div class="cw-friend-section">
                        <div class="cw-friend-section-title">状态</div>
                        <div class="cw-friend-status">${friend.status || '暂无'}</div>
                    </div>

                    <div class="cw-friend-section">
                        <div class="cw-friend-section-title">简介</div>
                        <div class="cw-friend-desc">${friend.description || '暂无'}</div>
                    </div>

                    <div class="cw-friend-section">
                        <div class="cw-friend-section-title">关系</div>
                        <div class="cw-friend-stats">
                            <div class="cw-friend-stat">
                                <div class="cw-friend-stat-value">${friend.favorability || '?'}</div>
                                <div class="cw-friend-stat-label">好感度</div>
                            </div>
                            <div class="cw-friend-stat">
                                <div class="cw-friend-stat-value">${friend.interactions.length}</div>
                                <div class="cw-friend-stat-label">交互次数</div>
                            </div>
                        </div>
                    </div>

                    <div class="cw-friend-section">
                        <div class="cw-friend-section-title">最后位置</div>
                        <div class="cw-friend-status">
                            📍 ${friend.lastScene}${isInCurrentScene ? ' <span style="color:#7da8ff;">[当前场景]</span>' : ''}
                        </div>
                    </div>

                    <div class="cw-friend-actions">
                        <button class="cw-friend-action-btn primary"
                            onclick="PhoneUIManager.interactWithFriend('${friend.name.replace(/'/g, "\\'")}')">
                            💬 交互
                        </button>
                        <button class="cw-friend-action-btn"
                            onclick="PhoneUIManager.viewHistory('${friend.name.replace(/'/g, "\\'")}')">
                            📜 交互历史
                        </button>
                    </div>
                </div>`;
        },

        backToContacts() {
            this.viewingFriend = null;
            this.render();
        },

        // ★ 筛选
        _contactFilter: 'all',
        setFilter(filter) {
            this._contactFilter = filter;
            this.render();
        },

        // ★ 设置角色定位
        setRole(name, role) {
            const ok = CharacterRegistry.setRole(name, role);
            if (!ok) {
                UIManager.showText('设置失败', 1500);
                return;
            }
            SaveManager.save();
            const roleName = role === 'main' ? '主要' : role === 'minor' ? '次要' : '路人';
            UIManager.showText(`已将 ${name} 设为${roleName}角色`, 2000);
            this.render();
        },

        // ========== 其他 App 的占位 ==========
        renderStoryApp() {
            return `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>剧情</span>
                </div>
                <div class="cw-phone-app-body" style="text-align:center;padding:60px 20px;">
                    <div style="font-size:48px;margin-bottom:15px;">📖</div>
                    <div style="color:#666;">请从主界面打开剧情列表</div>
                </div>`;
        },
        renderSceneApp() {
            return `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>地图</span>
                </div>
                <div class="cw-phone-app-body" style="text-align:center;padding:60px 20px;">
                    <div style="font-size:48px;margin-bottom:15px;">📍</div>
                    <div style="color:#666;">敬请期待</div>
                </div>`;
        },
        renderBagApp() {
            return `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>背包</span>
                </div>
                <div class="cw-phone-app-body" style="text-align:center;padding:60px 20px;">
                    <div style="font-size:48px;margin-bottom:15px;">🎒</div>
                    <div style="color:#666;">请从主界面打开背包</div>
                </div>`;
        },
        renderSettingsApp() {
            return `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>设置</span>
                </div>
                <div class="cw-phone-app-body" style="text-align:center;padding:60px 20px;">
                    <div style="font-size:48px;margin-bottom:15px;">⚙️</div>
                    <div style="color:#666;">敬请期待</div>
                </div>`;
        },

        // ========== 导航栏 ==========
        renderNavigation() {
            return `
                <div class="cw-phone-nav">
                    <button class="cw-phone-nav-btn" onclick="PhoneUIManager.goHome()" title="主屏">🏠</button>
                    <button class="cw-phone-nav-btn" onclick="PhoneUIManager.goBack()" title="返回">◀</button>
                    <button class="cw-phone-nav-btn" onclick="PhoneUIManager.close()" title="关闭">✕</button>
                </div>`;
        },

        goHome() {
            this.currentApp = null;
            this.viewingFriend = null;
            this.render();
        },
        goBack() {
            if (this.viewingFriend) {
                this.viewingFriend = null;
            } else if (this.currentApp) {
                this.currentApp = null;
            }
            this.render();
        },

        // ========== 交互功能 ==========

        // 从手机界面直接发起交互
        async interactWithFriend(name) {
            // 检查角色是否在当前场景
            const scene = LocationModalManager.currentLocation;
            if (!scene) {
                await UIManager.showText('你不在任何场景中', 2000);
                return;
            }

            const charIndex = scene.sceneCharacters.findIndex(c => c.name === name);
            if (charIndex === -1) {
                await UIManager.showText(`${name} 不在当前场景`, 2000);
                return;
            }

            // 关闭手机
            this.close();

            // 调用现有人物交互
            CharacterInteractionManager.open(charIndex);
        },

        // 查看交互历史
        viewHistory(name) {
            this.close();
            InteractionHistoryManager.openHistoryModal('character', name);
        },

        // ========== 数据 ==========
        getAllFriends() {
            const all = CharacterRegistry.getAll();

            const history = CinemaWorld.worldState.interactions || [];
            const interactionMap = {};
            for (const rec of history) {
                if (rec.type === 'character') {
                    if (!interactionMap[rec.target]) interactionMap[rec.target] = [];
                    interactionMap[rec.target].push(rec);
                }
            }

            return all.map(f => ({
                ...f,
                interactions: interactionMap[f.name] || [],
            })).sort((a, b) => {
                // 排序：主要 > 次要 > 路人，然后当前在场，然后好感度，最后最近见面
                const roleOrder = { main: 0, minor: 1, npc: 2 };
                const ra = roleOrder[a.role] ?? 1;
                const rb = roleOrder[b.role] ?? 1;
                if (ra !== rb) return ra - rb;
                if (a.isPresent !== b.isPresent) return a.isPresent ? -1 : 1;
                const fa = parseInt(a.favorability) || 0;
                const fb = parseInt(b.favorability) || 0;
                if (fb !== fa) return fb - fa;
                return (b.lastSeenAt || 0) - (a.lastSeenAt || 0);
            });
        },

        // ========== 工具 ==========
        getClockTime() {
            const scene = window.LocationModalManager?.currentLocation;
            const env = scene?.environmentData;
        
            if (env && env._order && env._order.includes('时间')) {
                const t = String(env['时间'] || '').trim();
                if (t) {
                    // 场景时间是 "清晨7:00" 这种描述 → 尝试抠出 HH:MM
                    const m = t.match(/(\d{1,2})[:：](\d{2})/);
                    if (m) return `${String(m[1]).padStart(2,'0')}:${m[2]}`;
                    // 抠不出来 → 直接显示原文（"清晨"、"黄昏"）
                    return t;
                }
            }
        
            const d = new Date();
            return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        },
        
        getDateString() {
            const scene = window.LocationModalManager?.currentLocation;
            const env = scene?.environmentData;
        
            // 场景里有"日期"字段 → 优先用
            if (env && env._order && env._order.includes('日期')) {
                const d = String(env['日期'] || '').trim();
                if (d) return d;
            }
        
            // 兜底：现实日期
            const d = new Date();
            const weekdays = ['日','一','二','三','四','五','六'];
            return `${d.getMonth()+1}月${d.getDate()}日 星期${weekdays[d.getDay()]}`;
        },

        // ========== 样式 ==========
        injectStyles() {
            CinemaWorldCSS.ensure();
        },
    };

    // ==================== 玩家创建管理器 ====================
    const PlayerCreationManager = {
        // 快捷标签（点击填入文本框）
        quickTags: {
            '性别': ['男性', '女性', '其他'],
            '年龄段': ['少年 (12-17)', '青年 (18-25)', '成年 (26-40)', '中年 (41-55)'],
            '性格': ['冷静理性', '热血冲动', '温柔内向', '开朗外向', '神秘寡言', '腹黑多谋'],
            '背景': ['失忆者', '流浪者', '退役士兵', '学者', '贵族后裔', '普通市民'],
        },

        // 显示创建模态框
        // onComplete: 可选回调，生成完成后调用
        showCreationModal(onComplete = null) {
            this._onComplete = onComplete;
            const modal = document.getElementById('cinemaworld-modal');

            // 当前名字（默认用玩家的真实用户名，或已有的自定义名）
            const currentName = PlayerStateManager.player.name || CinemaWorld.currentUserName || '主人公';

            // 快捷标签 HTML
            let tagsHTML = '';
            for (const [category, tags] of Object.entries(this.quickTags)) {
                tagsHTML += `
                    <div style="margin-bottom:10px;">
                        <div style="font-size:12px;color:#888;margin-bottom:5px;">${category}</div>
                        <div style="display:flex;flex-wrap:wrap;gap:6px;">
                            ${tags.map(t => `
                                <button class="cw-quick-tag"
                                    onclick="PlayerCreationManager.appendTag('${t}')">
                                    ${t}
                                </button>
                            `).join('')}
                        </div>
                    </div>`;
            }

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🎭 创建你的角色</div>

                <div style="text-align:center;padding:5px 0 20px;color:#aaa;font-size:13px;line-height:1.7;">
                    在进入这个世界之前，先定义你是谁。<br>
                    <span style="color:#7da8ff;">你可以自由描述，也可以点击下方标签快速填入。</span>
                </div>

                <!-- ★ 名字输入 -->
                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">你的名字：</div>
                    <input type="text" class="cinemaworld-textarea" id="player-creation-name"
                        value="${currentName.replace(/"/g, '&quot;')}"
                        placeholder="例如：探客"
                        style="min-height:auto;padding:10px 14px;font-size:15px;font-weight:600;">
                </div>

                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">角色设定：</div>
                    <textarea class="cinemaworld-textarea" id="player-creation-input"
                        placeholder="例如：&#10;性别：男&#10;年龄：22&#10;性格：冷静、寡言，但对朋友很讲义气&#10;外貌：黑色短发，左眼有一道旧疤&#10;背景：曾在军队服役，因某次任务失败而退役"
                        style="min-height:180px;"></textarea>
                </div>

                <div style="margin-bottom:15px;">
                    <div style="font-size:12px;color:#888;margin-bottom:10px;">快速填入：</div>
                    ${tagsHTML}
                </div>

                <div id="player-creation-result" style="display:none;margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                        AI 生成结果（可编辑）：
                    </div>
                    <textarea class="cinemaworld-textarea" id="player-generated-text"
                        style="min-height:280px;"></textarea>
                    <div style="font-size:11px;color:#666;margin-top:6px;line-height:1.5;">
                        💡 状态栏格式：<br>
                        ❤️ 体力：100/100<br>
                        💪 力量：X|描述
                    </div>
                </div>

                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" id="generate-player-btn"
                        onclick="PlayerCreationManager.generate()">🤖 AI生成玩家状态</button>
                    <button class="cinemaworld-button primary" id="confirm-player-btn"
                        onclick="PlayerCreationManager.confirm()" style="display:none;">✅ 进入世界</button>
                    <button class="cinemaworld-button" onclick="PlayerCreationManager.skip()">跳过</button>
                </div>`;
            modal.className = 'active';
        },

        // 点击快捷标签 → 追加到文本框
        appendTag(tag) {
            const input = document.getElementById('player-creation-input');
            if (!input) return;
            const cur = input.value;
            // 如果最后不是换行，就加换行
            const prefix = cur && !cur.endsWith('\n') ? '\n' : '';
            input.value = cur + prefix + tag;
            input.focus();
            input.scrollTop = input.scrollHeight;
        },

        // AI 生成玩家状态
        async generate() {
            const nameInput = document.getElementById('player-creation-name')?.value.trim() || '';
            const input = document.getElementById('player-creation-input').value.trim();
            const btn = document.getElementById('generate-player-btn');
            btn.disabled = true;
            btn.innerHTML = '⏳ 生成中...';

            const scene = LocationModalManager.currentLocation;
            const worldCtx = [];
            if (CinemaWorld.worldState.name) {
                worldCtx.push(`世界名：${CinemaWorld.worldState.name}`);
            }
            const wh = CinemaWorld.worldState.worldHistory;
            if (wh.summary) {
                worldCtx.push(`世界史：${wh.summary}`);
            }
            if (scene) {
                worldCtx.push(`初始场景：${scene.name}`);
                if (scene.description) worldCtx.push(`场景描述：${scene.description}`);
                if (scene.environment) worldCtx.push(`环境：${scene.environment}`);
            }

            const prompt = `你正在为一个视觉小说游戏生成玩家角色的状态栏。

【世界背景】
${worldCtx.length > 0 ? worldCtx.join('\n') : '（这是一个全新的世界，尚未定义具体世界观）'}

【玩家名字】
${nameInput || '（未指定，请用"主人公"）'}

【玩家设定】
${input || '（玩家没有特别设定，请生成一个符合世界观、适合作为主角的通用角色）'}

【任务】
根据玩家设定和世界背景，生成一个完整的玩家角色状态。

【输出格式】
严格按以下格式输出：

【人物状态】
 ❤️ 生命值：X/Y
 💛 体力：X/Y
 ⭐ 经验值：X/Y
（根据场景需要生成多个数值条，也可以放进来，用emoji图标开头）

【角色属性】
💪 力量：X|描述（例如力拔山兮气盖世啊，时不利兮雅不逝啊之类的，描述可以好玩一点）
🏃 敏捷：X|描述
🌟 等级：X|描述
（除以上外，生成多个属性，格式：图标 名称：数值|描述）

【物品栏】
【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
（生成 1-4 个物品）

【装备栏】
【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]
（生成 0-2 个初始装备，符合玩家设定和世界观。没有就不写这一块）
注意：
1. 物品必须严格按上面的格式，方括号内字段用 | 分隔
2. 可堆叠填"是"或"否"
3. 图标字段只填一个 emoji，不要文字
4. ★ 属性字段写法：键名:值，例如 攻击:+5|防御:+3|暴击:+10%
    - 属性字段写法：键名:值
    - 值必须是 "数字"、"±数字"、"数字%" 之一
    - ★ 数值条类字段（如体力、理智、经验）只写"上限加成"，
    直接写裸名即可，例如"体力:+50"表示体力上限+50
    - 不要写"体力回复 +50"这类当前值加成，装备系统不处理
    - ★ 系统会自动识别"体力上限"、"最大体力"等同义写法并归一化
    - 这些字段装备后会生效，直接叠加到玩家属性上
    - 非属性字段（类型、状态、图标等）不会生效，只是展示
5. 所有数值要符合当前世界状态和角色设定，数值要精确，不能有？，不明等等模糊的表述

【状态】
（可以生成 0-3 个初始状态标签，如"轻伤"、"疲惫"，一行一个）
【额外数据】
数据1: X
数据2: Y
（可选。用来记录玩法相关的数值，要符合背景还有剧情，如金钱、声望、罪孽...，
但是不同背景和剧情，
这些不是固定的，有的不需要罪孽，不需要声望，甚至不需要金钱。
键名自由发挥，格式必须是"键: 值"，一行一个。没有就不写这一块。）

【要求】
1. 数值条必须符合世界观和角色设定（例如：军人出身体力高、学者理智高）
2. 属性数值一般在 1-20 之间
3. 物品必须严格按上面的格式，方括号内 6 个字段用 | 分隔
4. 可拾取/可堆叠填"是"或"否"（玩家背包物品一般都可拾取）
5. 图标字段只填一个 emoji，不要文字
6. 属性/数值/物品都要贴合玩家设定的性格、背景、年龄

请开始生成：
`;

            const result = await generateFunctionalReply(prompt, 'player-creation');
            btn.disabled = false;
            btn.innerHTML = '🤖 AI生成玩家状态';

            if (result) {
                document.getElementById('player-generated-text').value = result;
                document.getElementById('player-creation-result').style.display = 'block';
                document.getElementById('confirm-player-btn').style.display = 'inline-block';
            }
        },

        // 确认 → 解析并应用，然后关闭
        confirm() {
            const nameInput = document.getElementById('player-creation-name')?.value.trim() || '';
            const rawInput = document.getElementById('player-creation-input').value.trim();
            const generatedText = document.getElementById('player-generated-text')?.value.trim();

            // ★ 保存名字
            if (nameInput) {
                PlayerStateManager.player.name = nameInput;
                PlayerStateManager.player.nameCustomized = true;
                CinemaWorld.currentUserName = nameInput;   // 同步给 AI 上下文
                PlayerStateManager.refreshAvatarArea();
            }

            // 保存原始设定
            if (rawInput) {
                PlayerStateManager.player.profile = rawInput;
            }

            // 应用 AI 生成的状态
            if (generatedText) {
                PlayerStateManager.updateFromText(generatedText);
            }

            UIManager.closeModal();
            SaveManager.save();

            if (typeof this._onComplete === 'function') {
                const cb = this._onComplete;
                this._onComplete = null;
                cb();
            }
        },

        // 跳过 → 用默认值，直接进入
        skip() {
            const nameInput = document.getElementById('player-creation-name')?.value.trim() || '';
            const rawInput = document.getElementById('player-creation-input').value.trim();

            // ★ 保存名字
            if (nameInput) {
                PlayerStateManager.player.name = nameInput;
                PlayerStateManager.player.nameCustomized = true;
                CinemaWorld.currentUserName = nameInput;
                PlayerStateManager.refreshAvatarArea();
            }

            if (rawInput) {
                PlayerStateManager.player.profile = rawInput;
            }

            UIManager.closeModal();
            SaveManager.save();

            if (typeof this._onComplete === 'function') {
                const cb = this._onComplete;
                this._onComplete = null;
                cb();
            }
        },
    };

    // ==================== 启动流程 ====================
    const StartupManager = {
        checkInitialization() {
            const scenes = WorldManager.getLocations();
            if (scenes.length === 0) {
                this.showInitialCreation();
                return false;
            }
            if (!CinemaWorld.ui.currentLocation) {
                this.showSceneSelection();
                return false;
            }
            return true;
        },

        showInitialCreation() {
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🌅 欢迎来到 CinemaWorld</div>
                <div style="text-align:center;padding:20px 0;color:#aaa;font-size:14px;line-height:1.8;">
                    这是一片空白的世界。<br>一切都将从你的第一个场景开始。<br><br>
                    <span style="color:#7da8ff;">先创建一个场景，作为世界的起点。</span>
                </div>
                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">描述初始场景（可选）：</div>
                    <textarea class="cinemaworld-textarea" id="initial-scene-guide"
                        placeholder="例如：一个宁静的小村庄..." style="min-height:100px;"></textarea>
                </div>
                <div id="initial-scene-result" style="display:none;margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">AI生成结果（可编辑）：</div>
                    <textarea class="cinemaworld-textarea" id="initial-scene-text" style="min-height:250px;"></textarea>
                </div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" id="gen-initial-btn" onclick="StartupManager.generateInitial()">🤖 生成初始场景</button>
                    <button class="cinemaworld-button" id="confirm-initial-btn" onclick="StartupManager.confirmInitial()" style="display:none;">✅ 进入这个世界</button>
                </div>`;
            modal.className = 'active';
        },

        async generateInitial() {
            const guide = document.getElementById('initial-scene-guide').value.trim();
            const btn = document.getElementById('gen-initial-btn');
            btn.disabled = true;
            btn.innerHTML = '⏳ 生成中...';

            // StartupManager.generateInitial
            const prompt = `请生成一个场景，作为整个视觉小说世界的初始起点。

${guide ? `用户的要求：${guide}` : '这是一个全新的世界，请创建适合作为故事开端的场景。'}

严格使用以下格式：

*【场景名】*
描述：(场景的详细描述)
环境：(场景的环境特征)
环境数据:[时间:具体时间|天气:具体天气|温度:具体温度|风力:具体风力|湿度:具体湿度|...]
背景：(中文背景图片文件名)
🎵 音乐：(中文背景音乐文件名)

场景人物：
- 【人物名|性别|心情|好感度|状态|主次】：人物描述，[标签1、标签2]

场景实体：
- 【实体名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
如果是物品(物品也是一种实体）：
- 【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]

★ 特殊场景实体类型：
以下类型有专用系统，必须严格使用对应字段：

【经营实体】（农田、牧场、商店、工厂、矿场等可持续运营的场所）
- 【名称|图标】：描述，[类型:经营|经营类型:农田|其他字段...]
  说明：经营类型可写 农田/牧场/商店/工厂/矿场/鱼塘 等，系统会据此生成经营系统。

【商店实体】（买卖物品的场所）
- 【名称|图标】：描述，[类型:商店|货币:金币|收购:是|其他字段...]
  说明：系统会据此生成一个商店，玩家点击可直接进入购买/出售界面。

★ 当场景氛围适合（如村子、集市、店铺、农场）时，可以主动生成 1 个经营或商店实体。

场景行动：
- 【行动名|图标|once】：这个行动能做什么
- 【行动名|图标|repeat】：...

（2-5 个。是玩家在当前场景可以主动做的事，而不是场景里已有的角色/实体。
 这些行动应该：
 - 结合场景氛围和当前局势
 - 可以影响主线（
 - 可以只是氛围探索
  - 不要和场景角色/实体的交互重复，场景实体已有的内容，场景行动无需再有，也无须通过这里进行交互
 - once：一次性行动，做完就消失（如"打开那个箱子"、"查看信号"）
 - repeat：可重复行动，但每次结果可能不同（如"站在窗边发呆"、"练习剑术"）
 - 不填：由系统按行动性质自动判断
 判断原则：
 - 探索型/推进型行动 → once
 - 氛围型/练习型行动 → repeat
 如果这个场景确实没什么可做的，可以不写这一块。）

字段说明：
0. ★ 环境数据必须用"键:值"格式，用 | 分隔。键名必须写出来，例如：
[时间:具体时间|天气:具体天气|温度:具体温度|风力:具体风力|湿度:具体湿度|...]
你可以根据背景和剧情自由添加任何键：时间、天气、温度、风力、湿度、能见度、
季节、月相、潮汐、日期、声望……系统都能存能显。
1. 描述：实体的外观、位置、给人的感觉（实体可以是物品、建筑、植物、家具、机关、载具、自然景观等任何东西）
2. 类型：物品/建筑/植物/家具/机关/载具/自然物/…（由你自行判断，不要局限于"物品"）
3. 状态：当前状态（如"未拆封"、"车钥匙插在门上"、"半开着"），无则留空
4. 功能：能做什么（如"可驾驶"、"可阅读"、"可攀爬"），无则留空
5. 交互方式：列出这个实体可以进行的交互，用顿号分隔。可以是 1 种，也可以多种。
    例如：
    - 一扇木门：[类型:建筑|交互方式:推开、敲门、踹开|图标:🚪]
    - 一棵老树：[类型:植物|交互方式:观察、攀爬、乘凉|图标:🌳]
    - 一台旧钢琴：[类型:家具|交互方式:弹奏、观察、擦拭|图标:🎹]
    - 一块石碑：[类型:石碑|交互方式:观察、触摸、解读|图标:🗿]
    如果这个实体确实没什么可交互的，可以不写这个字段。
6. 图标：只填一个 emoji，不要文字
7. ★ 你还可以自由添加其他字段（如"材质"、"年代"、"危险度"、"气味"），格式为 键:值
8. 所有数值要符合当前世界状态和角色设定

主次：填"主要"、"次要"或"路人"
    - 主要：与主线剧情相关的核心角色（1-2个）
    - 次要：有名字、有档案的配角
    - 路人：一次性背景人物
要求：
1. 适合作为故事起点
2. 人物1-3个关键角色
3. 实体1-3个与剧情相关
4. 自然，具有故事潜力
5. 背景和音乐用简短英文/拼音
`;

            const result = await generateFunctionalReply(prompt, 'initial-scene');
            btn.disabled = false;
            btn.innerHTML = '🤖 生成初始场景';

            if (result) {
                document.getElementById('initial-scene-text').value = result;
                document.getElementById('initial-scene-result').style.display = 'block';
                document.getElementById('confirm-initial-btn').style.display = 'inline-block';
            }
        },

        async confirmInitial() {
            const text = document.getElementById('initial-scene-text').value.trim();
            if (!text) { alert('请先生成场景'); return; }
            const scene = WorldManager.addScene(text);
            if (!scene) { alert('创建失败'); return; }

            UIManager.closeModal();
            await LocationModalManager.doEnterScene(scene, { showText: false });

            UIManager.createFloatingButtons();
            UIManager.updateWorldStateDisplay();

            await UIManager.showText(
                `【${scene.name}】\n\n${scene.description || ''}\n\n这个世界开始了。`,
                4000
            );

            SaveManager.save();

            // ★ 先让玩家创建自己，再进剧情
            PlayerCreationManager.showCreationModal(() => {
                setTimeout(() => {
                    RuleCreationManager.showCreationModal(() => {
                        setTimeout(() => StoryManager.createStory(), 500);
                    });
                }, 500);
            });
        },

        showSceneSelection() {
            const scenes = WorldManager.getLocations();
            const modal = document.getElementById('cinemaworld-modal');
            let html = `<div class="cinemaworld-modal-title">📍 选择当前场景</div>
                <div style="margin-bottom:15px;color:#aaa;font-size:13px;text-align:center;">选择你当前所在的位置</div>
                <div style="display:grid;gap:10px;max-height:400px;overflow-y:auto;">`;
            scenes.forEach(s => {
                html += `<div style="background:rgba(255,255,255,.05);border-radius:10px;padding:15px;cursor:pointer;"
                         onclick="StartupManager.selectScene('${s.name}')"
                         onmouseover="this.style.background='rgba(255,255,255,.1)'"
                         onmouseout="this.style.background='rgba(255,255,255,.05)'">
                    <div style="font-weight:bold;font-size:15px;margin-bottom:5px;">📍 【${s.name}】</div>
                    <div style="font-size:13px;color:#aaa;">${s.description?.substring(0, 80) || '无描述'}</div>
                </div>`;
            });
            html += `</div>`;
            modal.innerHTML = html;
            modal.className = 'active';
        },

        async selectScene(name) {
            const scene = WorldManager.findEntity(name);
            if (!scene) return;

            UIManager.closeModal();
            await LocationModalManager.doEnterScene(scene);

            UIManager.createFloatingButtons();
            UIManager.updateWorldStateDisplay();
            SaveManager.save();
        },
    };

    // ==================== 挂载到 window ====================
    window.UIManager = UIManager;
    window.VisualNovelManager = VisualNovelManager;
    window.PhoneUIManager = PhoneUIManager;
    window.PlayerCreationManager = PlayerCreationManager;
    window.StartupManager = StartupManager;
    window.generateFunctionalReply = generateFunctionalReply;

    console.log('[CinemaWorld] ui.js 已加载');
})();