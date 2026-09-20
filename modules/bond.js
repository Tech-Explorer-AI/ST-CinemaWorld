// ============================================================
// CinemaWorld · bond.js
// 羁绊剧情：角色 × 角色的互动小剧场
// 依赖：core.js, world.js, player.js, story.js
// 加载顺序：social.js 之后、ui.js 之前
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const CharacterRegistry = window.CharacterRegistry;
    const PlayerStateManager = window.PlayerStateManager;

    // ==================== 数据管理 ====================
    const BondDataManager = {
        ensureStore() {
            if (!CinemaWorld.worldState.bonds) {
                CinemaWorld.worldState.bonds = {};
            }
            const store = CinemaWorld.worldState.bonds;
        
            // ★ 迁移：把 key 从 "张三_李四" 改成 "bond_张三_李四"
            let migrated = false;
            for (const key of Object.keys(store)) {
                const bond = store[key];
                if (!bond || typeof bond !== 'object') continue;
                // 如果 key 不等于 bond.id，把 key 改成 bond.id
                if (bond.id && key !== bond.id) {
                    store[bond.id] = bond;
                    delete store[key];
                    migrated = true;
                    console.log(`[CinemaWorld] bonds key 迁移: ${key} → ${bond.id}`);
                }
            }
            if (migrated && window.SaveManager) {
                window.SaveManager.save();
            }
        
            return store;
        },

        // 生成 key（成员名字典序）
        _makeKey(members) {
            return [...members].sort().join('_');
        },

        // 获取或创建一条羁绊记录
        ensureBond(members) {
            if (!members || members.length < 2) return null;
            const key = this._makeKey(members);      // "张三_李四"
            const id = `bond_${key}`;                // "bond_张三_李四"
            const store = this.ensureStore();
        
            if (!store[id]) {
                store[id] = {
                    id,                               // ★ id 和 key 一致
                    key,                              // ★ 保留原始 key 备用
                    members: [...members].sort(),
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    count: 0,
                    episodes: [],
                    compactSummary: '',
                    compactUntilIndex: 0,
                };
                this.save();
            }
            return store[id];
        },
        
        getBond(members) {
            if (!members || members.length < 2) return null;
            const key = this._makeKey(members);
            return this.ensureStore()[`bond_${key}`] || null;
        },

        getBond(members) {
            if (!members || members.length < 2) return null;
            const key = this._makeKey(members);
            return this.ensureStore()[key] || null;
        },

        getAllBonds() {
            return Object.values(this.ensureStore())
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        },

        // 添加一集
        addEpisode(members, episode) {
            const bond = this.ensureBond(members);
            if (!bond) return null;

            const ep = {
                id: `ep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                title: episode.title || '无题',
                summary: episode.summary || '',
                music: episode.music || '',         // ★ 新增
                dialogues: episode.dialogues || [],
                raw: episode.raw || '',
                createdAt: Date.now(),
            };
            bond.episodes.push(ep);
            bond.count = (bond.count || 0) + 1;
            bond.updatedAt = Date.now();
            this.save();

            this._compactBond(bond).catch(e => {
                console.error('[CinemaWorld] 羁绊压缩失败:', e);
            });

            return ep;
        },

        removeEpisode(bondKey, episodeId) {
            const store = this.ensureStore();
            const bond = store[bondKey];
            if (!bond) return false;
            const idx = bond.episodes.findIndex(e => e.id === episodeId);
            if (idx === -1) return false;
            bond.episodes.splice(idx, 1);
            this.save();
            return true;
        },

        removeBond(bondKey) {
            const store = this.ensureStore();
            if (store[bondKey]) {
                delete store[bondKey];
                this.save();
                return true;
            }
            return false;
        },

        // 早期 episodes 压缩
        async _compactBond(bond) {
            const THRESHOLD = 6;
            const KEEP = 3;
            if (bond.episodes.length <= THRESHOLD) return;

            const needCompact = bond.episodes.length - KEEP;
            const toCompact = bond.episodes.slice(0, needCompact);
            if (toCompact.length === 0) return;

            const memberNames = bond.members.join('、');
            const prev = bond.compactSummary ? `【已有回顾】\n${bond.compactSummary}\n\n` : '';
            const newText = toCompact.map((e, i) => `${i + 1}. ${e.title}：${e.summary}`).join('\n');

            const prompt = `请把以下 ${memberNames} 之间发生过的多次互动，压缩成一段自然连贯的回顾。这段回顾会作为后续生成他们互动的上下文。

${prev}【新增互动】
${newText}

要求：
1. 保留：关系变化、关键事件、共同经历、未解悬念
2. 一段话，100-150 字
3. 不要重复已有回顾
4. 直接输出回顾内容，不加前缀`;

            const result = await window.generateFunctionalReply(prompt, 'bond-compact');
            if (!result) return;

            bond.compactSummary = result.trim();
            bond.compactUntilIndex = (bond.compactUntilIndex || 0) + needCompact;
            bond.episodes = bond.episodes.slice(needCompact);
            this.save();
        },

        save() {
            if (window.SaveManager) window.SaveManager.save();
        },
    };

    // ==================== AI 生成 ====================
    const BondAIManager = {
        isGenerating: false,

        _buildCharacterBlock(name) {
            const ch = CharacterRegistry.get(name);
            if (!ch) return `名称：${name}\n（无档案）`;

            const parts = [`名称：${ch.name}`];
            if (ch.gender) parts.push(`性别：${ch.gender}`);
            if (ch.mood) parts.push(`心情：${ch.mood}`);
            if (ch.status) parts.push(`状态：${ch.status}`);
            if (ch.favorability) parts.push(`对玩家好感度：${ch.favorability}`);
            if (ch.role) {
                const roleName = { main: '主要角色', minor: '次要角色', npc: '路人' }[ch.role] || ch.role;
                parts.push(`定位：${roleName}`);
            }
            if (ch.tags?.length) {
                const tagText = ch.tags.map(t => typeof t === 'string' ? t : t.name).join('、');
                parts.push(`标签：${tagText}`);
            }
            if (ch.description) parts.push(`简介：${ch.description}`);
            if (ch.lastScene) parts.push(`最近位置：${ch.lastScene}`);

            // ★ 拉一个他们和玩家相关的最近交互（可选，让羁绊更贴合主线）
            const digest = window.InteractionDigestManager?.getForCharacter(ch.name, null, 2);
            if (digest?.compact) {
                parts.push(`与玩家的近期互动：${digest.compact}`);
            }

            return parts.join('\n');
        },

        _buildBondHistoryBlock(bond) {
            const parts = [];
            if (bond.compactSummary) {
                parts.push(`【他们之前的互动回顾】\n${bond.compactSummary}`);
            }
            const recent = bond.episodes.slice(-3);
            if (recent.length > 0) {
                const lines = recent.map(e => `· ${e.title}：${e.summary}`).join('\n');
                parts.push(`【最近几次互动】\n${lines}`);
            }
            return parts.join('\n\n');
        },

        async generate(members, options = {}) {
            if (this.isGenerating) return null;
            this.isGenerating = true;
            try {
                const { theme = '' } = options;
                const bond = BondDataManager.ensureBond(members);
                const memberCount = members.length;

                const memberBlocks = members.map(m => this._buildCharacterBlock(m)).join('\n\n---\n\n');
                const historyBlock = this._buildBondHistoryBlock(bond);
                const worldCtx = window.StoryManager?.buildContext(null, {
                    parentStory: false,
                    mainChars: false,
                    scene: true,
                    interactionDigests: false,
                    volumes: true,
                    chapters: true,
                    pendingEvents: false,
                }) || '';

                const playerBlock = PlayerStateManager.formatForPrompt();

                // ★ 生成限制：让 AI 知道该写什么
                const memberNameList = members.join('、');
                const isGroup = memberCount > 2;

                const prompt = `你正在为视觉小说游戏生成一段"羁绊剧情"——**角色与角色之间**发生的生活片段（玩家不在场）。

【世界背景】
${worldCtx}

${playerBlock}

【参与角色】
${memberBlocks}

${historyBlock}

【本次羁绊剧情要求】
${theme ? `主题：${theme}` : `主题：由你自由发挥，写一段 ${memberNameList} 之间自然发生的日常小事或对话。`}

【任务】
生成一段 ${memberNameList} ${isGroup ? '多人' : '两人'}之间发生的小剧场。

【内容要求】
1. 玩家不在场，这是 ${memberNameList} 自己的故事
2. 场景由你决定（食堂、街角、深夜的房间、训练场...），要符合角色的身份和世界观
3. 剧情要"小而真实"——一次偶遇、一场闲聊、一次帮助、一次小摩擦，不要写大事件
4. 要有具体细节：吃了什么、什么天气、说到哪句话
5. 角色之间的对话要像真人，有停顿、有语气词、有沉默
6. 不需要"总结升华"——不要硬凹主题，日常就是日常
7. 如果是 3 人以上，要注意群体对话的节奏（有人主说、有人旁听、有人插嘴）

【输出格式】（严格遵守）

【标题】
（4-8 字的短标题，例如"深夜食堂的偶遇"）

🎵 音乐: 音乐

【脚本】
【角色名|显示/隐藏|左/中/右|性别|状态】: 内容
【旁白】: 内容

规则：
- 每行以【人名】开头
- 第 2 字段：显示/隐藏（说话者显示，其他隐藏）
- 第 3 字段：左/中/右（位置）
- 第 4 字段：性别
- 第 5 字段：状态（可选，如"微笑"、"生气"）
- 旁白用【旁白】，显示环境、动作、心理
- 5-12 行，不要过长

【摘要】
（2-3 句。这次互动中发生了什么、两人关系有何变化。会作为下次生成的上下文。）

【示例】
【标题】
深夜食堂的偶遇

🎵 音乐: 音乐

【脚本】
【旁白】: 深夜两点，那家二十四小时营业的小食堂里，只有两盏灯亮着。
【张三|显示|左|男|疲惫】: 老板，来一碗面。
【李四|显示|右|女|惊讶】: 咦？这个点还能碰到你。
【张三|显示|左|男|愣住】: ……你也来了。
【旁白】: 两人默默地坐下，各自低头吃面，偶尔抬头看对方一眼。
【李四|显示|右|女|轻笑】: 你最近是不是又熬夜了？黑眼圈都出来了。
【张三|显示|左|男|苦笑】: 你不也一样。

【摘要】
张三和李四在深夜食堂偶遇，两人都处于疲惫状态。李四主动打破沉默，调侃张三熬夜，气氛缓和。两人没有深谈，但彼此的状态都被对方看在眼里。

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'bond-episode');
                if (!result) return null;

                return this._parseResult(result);
            } finally {
                this.isGenerating = false;
            }
        },

        _parseResult(text) {
            const out = { title: '', summary: '', dialogues: [], raw: text };

            // ---------- 0. 音乐 ----------
            const musicMatch = text.match(/🎵\s*音乐[:：]\s*([^\n]+)/);
            if (musicMatch) out.music = musicMatch[1].trim();

            // ---------- 1. 标题 ----------
            const titleMatch = text.match(/【标题】\s*\n?\s*([^\n]+)/);
            if (titleMatch) out.title = titleMatch[1].trim();
        
            // ---------- 2. 摘要 ----------
            // 摘要从 【摘要】 开始，到下一个顶层标签（【脚本】/【标题】等）或文末
            const summaryMatch = text.match(/【摘要】\s*\n?\s*([\s\S]*?)(?=\n【(?:标题|脚本|效果|场景更新|摘要)】|$)/);
            if (summaryMatch) out.summary = summaryMatch[1].trim();
        
            // ---------- 3. 脚本 ----------
            // 脚本从 【脚本】 开始，到下一个顶层标签（【摘要】/【标题】等）或文末
            // 注意：不能用 \n【 当分界，因为脚本每行都是 【角色】: 内容
            const scriptMatch = text.match(/【脚本】\s*\n?\s*([\s\S]*?)(?=\n【(?:标题|摘要|效果|场景更新|状态|选项)】|$)/);
            if (scriptMatch) {
                out.dialogues = window.VisualNovelManager.parseScript(scriptMatch[1]);
            }
        
            // ---------- 4. 兜底 1：脚本块没解析出 → 整段解析 ----------
            if (out.dialogues.length === 0) {
                const textWithoutMusic = text.replace(/🎵\s*音乐[:：][^\n]*\n?/g, '');
                out.dialogues = window.VisualNovelManager.parseScript(textWithoutMusic);
                if (out.dialogues.length > 0) {
                    console.warn('[CinemaWorld] 脚本标签内解析为空，已用整段兜底');
                }
            }
        
            // ---------- 5. 兜底 2：还是空 → 宽松格式 ----------
            if (out.dialogues.length === 0) {
                const looseLines = [];
                for (const raw of text.split('\n')) {
                    const line = raw.trim();
                    if (!line) continue;
                    if (/^(【标题】|【摘要】|【脚本】|【效果】|【场景更新】)/.test(line)) continue;
        
                    let m = line.match(/^【(.+?)】\s*[:：]\s*(.+)$/);
                    if (m) {
                        const meta = m[1].split('|').map(s => s.trim());
                        looseLines.push({
                            character: meta[0] || '未知',
                            visibility: meta[1]?.includes('隐藏') ? 'hidden' : 'visible',
                            position: meta[2]?.includes('左') ? 'left'
                                     : meta[2]?.includes('右') ? 'right' : 'center',
                            extraInfo: meta[3] || '',
                            state: meta[4] || '',
                            content: m[2].trim(),
                        });
                        continue;
                    }
        
                    // 宽松：角色名: 内容
                    m = line.match(/^([\u4e00-\u9fa5A-Za-z·]{1,15})\s*[:：]\s*(.+)$/);
                    if (m) {
                        looseLines.push({
                            character: m[1].trim(),
                            visibility: 'visible',
                            position: 'center',
                            extraInfo: '',
                            state: '',
                            content: m[2].trim(),
                        });
                    }
                }
                if (looseLines.length > 0) {
                    out.dialogues = looseLines;
                    console.warn('[CinemaWorld] 已用宽松格式解析，共', looseLines.length, '行');
                }
            }
        
            return out;
        },
    };

    // ==================== UI ====================
    const BondUI = {
        // 当前状态
        currentView: 'list',           // list | detail | create | episode
        currentBondKey: null,
        currentEpisodeId: null,
        _selectedMembers: null,        // Set，用于创建时

        // ---------- 主入口 ----------
        render(view = null) {
            if (view) this.currentView = view;
            switch (this.currentView) {
                case 'detail':  return this.renderDetail();
                case 'create':  return this.renderCreate();
                case 'episode': return this.renderEpisode();
                default:        return this.renderList();
            }
        },
        _attr(str) {
            return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        },
        // ---------- 列表页 ----------
        renderList() {
            const bonds = BondDataManager.getAllBonds();

            let html = `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>羁绊</span>
                    <button class="cw-phone-header-action"
                        onclick="BondUI.openCreate()" title="新建">＋</button>
                </div>
                <div class="cw-phone-app-body cw-bond-body">`;

            if (bonds.length === 0) {
                html += `
                    <div class="cw-social-empty">
                        <div class="cw-social-empty-icon">💫</div>
                        <div class="cw-social-empty-text">还没有羁绊剧情</div>
                        <div class="cw-social-empty-hint">点击右上角 ＋ 开始</div>
                    </div>`;
            } else {
                for (const bond of bonds) {
                    html += this._renderBondCard(bond);
                }
            }

            html += `</div>`;
            return html;
        },

        _renderBondCard(bond) {
            const memberNames = bond.members.join(' · ');
            const episodeCount = bond.episodes.length;
            const totalCount = bond.count || episodeCount;

            // 头像（最多显示 3 个）
            const avatars = bond.members.slice(0, 3).map(name => {
                const ch = CharacterRegistry.get(name);
                return `<div class="cw-bond-avatar" data-bond-avatar="${name}">${this._pickAvatar(ch, name)}</div>`;
            }).join('');

            const moreBadge = bond.members.length > 3
                ? `<div class="cw-bond-avatar cw-bond-avatar-more">+${bond.members.length - 3}</div>`
                : '';

            return `
                <div class="cw-bond-card" onclick="BondUI.openDetail('${bond.id}')">
                    <div class="cw-bond-card-avatars">
                        ${avatars}${moreBadge}
                    </div>
                    <div class="cw-bond-card-main">
                        <div class="cw-bond-card-names">${this._escape(memberNames)}</div>
                        <div class="cw-bond-card-meta">
                            ${totalCount > 0 ? `${totalCount} 段互动` : '还没有互动'}
                        </div>
                    </div>
                    <div class="cw-bond-card-arrow">›</div>
                </div>`;
        },

        // ---------- 详情页 ----------
        openDetail(bondId) {
            this.currentBondKey = bondId;
            this.currentView = 'detail';
            PhoneUIManager.render();
        },

        renderDetail() {
            const store = BondDataManager.ensureStore();
            const bond = store[this.currentBondKey];
            if (!bond) {
                return `<div class="cw-social-empty"><div>羁绊不存在</div></div>`;
            }

            const memberNames = bond.members.join(' · ');
            const avatars = bond.members.map(name => {
                const ch = CharacterRegistry.get(name);
                return `<div class="cw-bond-avatar cw-bond-avatar-lg" data-bond-avatar="${name}">${this._pickAvatar(ch, name)}</div>`;
            }).join('');

            let html = `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="BondUI.backToList()">←</button>
                    <div class="cw-social-chat-title">
                        <div class="cw-social-chat-name">${this._escape(memberNames)}</div>
                        <div class="cw-social-chat-sub">${bond.count || 0} 段互动</div>
                    </div>
                    <button class="cw-phone-header-action"
                        onclick="BondUI.openMenu('${bond.id}')" title="设置">⋯</button>
                </div>
                <div class="cw-phone-app-body cw-bond-body">

                    <div class="cw-bond-members-row">
                        ${avatars}
                    </div>

                    ${bond.compactSummary ? `
                        <div class="cw-bond-compact">
                            <div class="cw-bond-compact-label">📜 过往回顾</div>
                            <div class="cw-bond-compact-text">${this._escape(bond.compactSummary)}</div>
                        </div>
                    ` : ''}

                    <div class="cw-bond-section-title">
                        🎬 互动记录 (${bond.episodes.length})
                    </div>

                    <div class="cw-bond-episodes">`;

            if (bond.episodes.length === 0) {
                html += `<div class="cw-bond-empty-episodes">还没有互动，点击下方按钮开始</div>`;
            } else {
                // 倒序显示
                for (const ep of [...bond.episodes].reverse()) {
                    html += this._renderEpisodeCard(ep, bond.id);
                }
            }

            html += `
                    </div>

                    <div class="cw-bond-actions">
                        <button class="cw-bond-btn primary"
                            onclick="BondUI.startNewEpisode('${bond.id}')">
                            ✨ 生成新互动
                        </button>
                    </div>
                </div>`;

            return html;
        },

        _renderEpisodeCard(ep, bondId) {
            const timeStr = this._formatTime(ep.createdAt);
            return `
                <div class="cw-bond-episode">
                    <div class="cw-bond-episode-main"
                        onclick="BondUI.openEpisode('${this._attr(bondId)}', '${this._attr(ep.id)}')">
                        <div class="cw-bond-episode-head">
                            <div class="cw-bond-episode-title">${this._escape(ep.title)}</div>
                            <div class="cw-bond-episode-time">${timeStr}</div>
                        </div>
                        <div class="cw-bond-episode-summary">${this._escape(ep.summary)}</div>
                    </div>
                    <button class="cw-bond-episode-replay"
                        onclick="event.stopPropagation(); BondUI.replayEpisode('${this._attr(bondId)}', '${this._attr(ep.id)}')"
                        title="重放（VN 模式）">▶️</button>
                </div>`;
        },
        // ★ 重放某一集（复用 _playEpisodeInVN）
        async replayEpisode(bondId, episodeId) {
            const store = BondDataManager.ensureStore();
            const bond = store[bondId];
            if (!bond) return;
            const ep = bond.episodes.find(e => e.id === episodeId);
            if (!ep || !ep.dialogues?.length) {
                window.UIManager.showText('这一集没有可重放的内容', 1500);
                return;
            }

            await this._playEpisodeInVN(bondId, episodeId, ep.dialogues);
        },
        // ---------- 单集查看 ----------
        openEpisode(bondId, episodeId) {
            this.currentBondKey = bondId;
            this.currentEpisodeId = episodeId;
            this.currentView = 'episode';
            PhoneUIManager.render();
        },

        renderEpisode() {
            const store = BondDataManager.ensureStore();
            const bond = store[this.currentBondKey];
            if (!bond) return `<div>羁绊不存在</div>`;
            const ep = bond.episodes.find(e => e.id === this.currentEpisodeId);
            if (!ep) return `<div>剧情不存在</div>`;

            const dialoguesHTML = ep.dialogues.map(d => {
                const isNarrator = ['旁白', '系统', 'narrator'].includes(d.character);
                if (isNarrator) {
                    return `
                        <div class="cw-bond-dialogue-narrator">
                            ${this._escape(d.content)}
                        </div>`;
                }
                return `
                    <div class="cw-bond-dialogue">
                        <div class="cw-bond-dialogue-name">${this._escape(d.character)}</div>
                        <div class="cw-bond-dialogue-text">${this._escape(d.content)}</div>
                    </div>`;
            }).join('');

            return `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="BondUI.backToDetail()">←</button>
                    <span>${this._escape(ep.title)}</span>
                    <button class="cw-phone-header-action"
                        onclick="BondUI.openEpisodeMenu('${this._attr(bond.id)}', '${this._attr(ep.id)}')" title="更多">⋯</button>
                </div>
                <div class="cw-phone-app-body cw-bond-body">
                    <div class="cw-bond-episode-full">
                        ${dialoguesHTML}
                    </div>
                    <div class="cw-bond-actions">
                        <button class="cw-bond-btn primary"
                            onclick="BondUI.replayEpisode('${this._attr(bond.id)}', '${this._attr(ep.id)}')">
                            ▶️ 重放（VN 模式）
                        </button>
                    </div>
                </div>`;
        },

        // ---------- 创建页 ----------
        openCreate() {
            this.currentView = 'create';
            this._selectedMembers = new Set();
            PhoneUIManager.render();
        },

        renderCreate() {
            const chars = CharacterRegistry.getAll()
                .filter(c => c.role !== 'npc')
                .sort((a, b) => {
                    const order = { main: 0, minor: 1, npc: 2 };
                    return (order[a.role] || 1) - (order[b.role] || 1);
                });

            if (chars.length < 2) {
                return `
                    <div class="cw-phone-app-header">
                        <button class="cw-phone-back" onclick="BondUI.backToList()">←</button>
                        <span>新建羁绊</span>
                    </div>
                    <div class="cw-phone-app-body cw-bond-body">
                        <div class="cw-social-empty">
                            <div class="cw-social-empty-icon">👥</div>
                            <div class="cw-social-empty-text">至少需要 2 个角色</div>
                            <div class="cw-social-empty-hint">去剧情里认识更多人吧</div>
                        </div>
                    </div>`;
            }

            let html = `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="BondUI.backToList()">←</button>
                    <span>新建羁绊</span>
                </div>
                <div class="cw-phone-app-body cw-bond-body">

                    <div class="cw-bond-create-hint">
                        选择 <strong>2 个或以上</strong>角色，生成他们之间的一段互动剧情。
                    </div>

                    <div class="cw-bond-create-selected">
                        <span class="cw-bond-create-selected-label">已选：</span>
                        <span id="cw-bond-selected-names">（至少 2 个）</span>
                    </div>

                    <div class="cw-bond-char-list">`;

            for (const c of chars) {
                const avatar = this._pickAvatar(c, c.name);
                const roleTag = { main: '⭐', minor: '', npc: '🏷️' }[c.role] || '';
                const selected = this._selectedMembers.has(c.name);
                const safeName = this._escape(c.name);
                const attrName = this._attr(c.name);
            
                html += `
                    <div class="cw-bond-char-item ${selected ? 'selected' : ''}"
                        data-char-name="${safeName}"
                        onclick="BondUI.toggleMember('${attrName}')">
                        <div class="cw-bond-char-avatar" data-bond-avatar="${safeName}">
                            ${avatar}
                        </div>
                        <div class="cw-bond-char-info">
                            <div class="cw-bond-char-name">${roleTag}${safeName}</div>
                            <div class="cw-bond-char-sub">${this._escape(c.status || c.description || '')}</div>
                        </div>
                        <div class="cw-bond-char-check">${selected ? '✓' : ''}</div>
                    </div>`;
            }

            html += `
                    </div>

                    <div class="cw-bond-theme-row">
                        <div class="cw-bond-theme-label">主题（可选）</div>
                        <input type="text" id="cw-bond-theme-input"
                            placeholder="例如：一起值夜班 / 雨天的争执 / 生日"
                            class="cinemaworld-textarea"
                            style="min-height:auto;padding:10px 14px;">
                    </div>

                    <div class="cw-bond-create-actions">
                        <button class="cw-bond-btn primary"
                            onclick="BondUI.confirmCreate()">
                            ✨ 生成互动剧情
                        </button>
                    </div>
                </div>`;

            return html;
        },

        toggleMember(name) {
            if (this._selectedMembers.has(name)) {
                this._selectedMembers.delete(name);
            } else {
                this._selectedMembers.add(name);
            }
            // 局部更新
            document.querySelectorAll('.cw-bond-char-item').forEach(el => {
                const n = el.dataset.charName;
                const selected = this._selectedMembers.has(n);
                el.classList.toggle('selected', selected);
                const check = el.querySelector('.cw-bond-char-check');
                if (check) check.textContent = selected ? '✓' : '';
            });
            // 更新已选列表
            const namesEl = document.getElementById('cw-bond-selected-names');
            if (namesEl) {
                const arr = Array.from(this._selectedMembers);
                namesEl.textContent = arr.length > 0 ? arr.join('、') : '（至少 2 个）';
            }
        },

        async confirmCreate() {
            const members = Array.from(this._selectedMembers);
            if (members.length < 2) {
                alert('请至少选择 2 个角色');
                return;
            }
        
            const theme = document.getElementById('cw-bond-theme-input')?.value.trim() || '';
        
            const bond = BondDataManager.ensureBond(members);
            this.currentBondKey = bond.id;
            this.currentView = 'detail';
            PhoneUIManager.render();
        
            window.UIManager.showText('正在生成羁绊剧情...', 1000);
        
            const result = await BondAIManager.generate(members, { theme });
            if (!result || !result.dialogues?.length) {
                window.UIManager.showText('生成失败', 2000);
                return;
            }
        
            const ep = BondDataManager.addEpisode(members, {
                title: result.title,
                summary: result.summary,
                music: result.music,               // ★ 新增
                dialogues: result.dialogues,
                raw: result.raw,
            });
        
            window.UIManager.showText(`✨ ${result.title}`, 1500);
        
            // ★ 生成成功后自动播放 VN
            await this._playEpisodeInVN(bond.id, ep.id, result.dialogues);
        },

        // ---------- 从已有羁绊触发新一集 ----------
        async startNewEpisode(bondId) {
            const store = BondDataManager.ensureStore();
            const bond = store[bondId];
            if (!bond) return;

            // 弹窗问主题
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">✨ 新互动</div>
                <div style="margin-bottom:12px;color:#aaa;font-size:13px;text-align:center;">
                    ${this._escape(bond.members.join('、'))}
                </div>
                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">主题（可选）：</div>
                    <input type="text" id="cw-bond-new-ep-theme" class="cinemaworld-textarea"
                        placeholder="留空由 AI 自由发挥"
                        style="min-height:auto;padding:10px 14px;">
                </div>
                <div style="text-align:center;">
                    <button class="cinemaworld-button primary"
                        onclick="BondUI.doStartNewEpisode('${bondId}')">✨ 生成</button>
                    <button class="cinemaworld-button"
                        onclick="UIManager.closeModal()">取消</button>
                </div>`;
            modal.className = 'active';
        },

        async doStartNewEpisode(bondId) {
            const theme = document.getElementById('cw-bond-new-ep-theme')?.value.trim() || '';
            window.UIManager.closeModal();
        
            const store = BondDataManager.ensureStore();
            const bond = store[bondId];
            if (!bond) return;
        
            window.UIManager.showText('正在生成...', 1000);
        
            const result = await BondAIManager.generate(bond.members, { theme });
            if (!result || !result.dialogues?.length) {
                window.UIManager.showText('生成失败', 2000);
                return;
            }
        
            const ep = BondDataManager.addEpisode(bond.members, {
                title: result.title,
                summary: result.summary,
                music: result.music,               // ★ 新增
                dialogues: result.dialogues,
                raw: result.raw,
            });
        
            window.UIManager.showText(`✨ ${result.title}`, 1500);
        
            // ★ 生成成功后自动播放 VN
            await this._playEpisodeInVN(bond.id, ep.id, result.dialogues);
        },
        // ★ 在 VN 里播放一集（关闭手机 → 播 → 恢复手机 + 定位到该集）
        async _playEpisodeInVN(bondId, episodeId, dialogues) {
            // 预热默认立绘
            const names = new Set(
                dialogues.map(d => d.character)
                    .filter(n => n && !['旁白', '系统'].includes(n))
            );
            for (const name of names) {
                const ch = CharacterRegistry.get(name);
                if (ch) {
                    try {
                        await SpriteManager.get(name, ch.gender, '默认');
                    } catch (e) { /* 忽略 */ }
                }
            }

            // ★ 设置羁绊音乐
            const store = BondDataManager.ensureStore();
            const bond = store[bondId];
            const ep = bond?.episodes?.find(e => e.id === episodeId);
            const music = ep?.music;

            if (music) {
                try {
                    await window.MusicManager.setScopedMusic('bond', music);
                } catch (e) {
                    console.warn('[CinemaWorld] 羁绊音乐设置失败:', e);
                }
            }

            PhoneUIManager.close();
            try {
                await window.VisualNovelManager.play(dialogues);
            } catch (e) {
                console.error('[CinemaWorld] 羁绊 VN 播放失败:', e);
            } finally {
                // ★ 清除羁绊音乐，让场景音乐接管
                try {
                    await window.MusicManager.clearScopedMusic('bond');
                } catch (e) { /* 忽略 */ }
            }

            PhoneUIManager.isOpen = true;
            PhoneUIManager.currentApp = 'bond';
            PhoneUIManager.viewingFriend = null;
            BondUI.currentBondKey = bondId;
            BondUI.currentEpisodeId = episodeId;
            BondUI.currentView = 'episode';
            PhoneUIManager.render();
        },
        // ---------- 菜单 ----------
        openMenu(bondId) {
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚙️ 设置</div>
                <div class="cw-social-chat-menu">
                    <div class="cw-social-menu-item"
                        onclick="BondUI.startNewEpisode('${bondId}'); UIManager.closeModal();">
                        ✨ 生成新互动
                    </div>
                    <div class="cw-social-menu-item danger"
                        onclick="BondUI.confirmDeleteBond('${bondId}')">
                        🗑️ 删除整个羁绊
                    </div>
                </div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },

        confirmDeleteBond(bondId) {
            const store = BondDataManager.ensureStore();
            const bond = store[bondId];
            if (!bond) return;
            if (!confirm(`确定删除「${bond.members.join('、')}」的所有羁绊剧情吗？`)) return;

            BondDataManager.removeBond(bondId);
            window.UIManager.closeModal();
            this.currentView = 'list';
            this.currentBondKey = null;
            PhoneUIManager.render();
        },

        openEpisodeMenu(bondId, episodeId) {
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚙️ 操作</div>
                <div class="cw-social-chat-menu">
                    <div class="cw-social-menu-item"
                        onclick="BondUI.deleteEpisode('${bondId}', '${episodeId}')">
                        🗑️ 删除这一集
                    </div>
                </div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },

        deleteEpisode(bondId, episodeId) {
            if (!confirm('确定删除这一集吗？')) return;
            BondDataManager.removeEpisode(bondId, episodeId);
            window.UIManager.closeModal();
            this.currentView = 'detail';
            this.currentEpisodeId = null;
            PhoneUIManager.render();
        },

        // ---------- 导航 ----------
        backToList() {
            this.currentView = 'list';
            this.currentBondKey = null;
            this.currentEpisodeId = null;
            PhoneUIManager.render();
        },

        backToDetail() {
            this.currentView = 'detail';
            this.currentEpisodeId = null;
            PhoneUIManager.render();
        },

        // ---------- 工具 ----------
        _pickAvatar(ch, fallbackName = '') {
            // 无档案但有名字 → 用首字占位，同时尝试预热
            if (!ch && fallbackName) {
                if (typeof SpriteManager !== 'undefined') {
                    SpriteManager.ensureSprite(fallbackName, '默认').then((url) => {
                        if (!url) return;
                        document.querySelectorAll(`[data-bond-avatar="${CSS.escape(fallbackName)}"]`).forEach(el => {
                            el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="${this._escape(fallbackName)}">`;
                            el.style.background = 'transparent';
                        });
                    });
                }
                return fallbackName.charAt(0);
            }
        
            if (!ch) return '👤';
            const name = ch.name;
        
            // 同步拿缓存
            let url = null;
            if (typeof SpriteManager !== 'undefined') {
                url = SpriteManager.getCachedSprite(name);
            }
        
            if (url) {
                return `<img src="${url}" style="width:100%;height:100%;object-fit:cover;" alt="${this._escape(name)}">`;
            }
        
            // 异步预热
            if (typeof SpriteManager !== 'undefined') {
                SpriteManager.ensureSprite(name, ch.gender).then((loadedUrl) => {
                    if (!loadedUrl) return;
                    document.querySelectorAll(`[data-bond-avatar="${CSS.escape(name)}"]`).forEach(el => {
                        el.innerHTML = `<img src="${loadedUrl}" style="width:100%;height:100%;object-fit:cover;" alt="${this._escape(name)}">`;
                        el.style.background = 'transparent';
                    });
                });
            }
        
            return ch.gender === '女' ? '👩' : ch.gender === '男' ? '👨' : '👤';
        },

        _formatTime(ts) {
            if (!ts) return '';
            const d = new Date(ts);
            const now = new Date();
            const diff = now - d;
            if (diff < 60 * 1000) return '刚刚';
            if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
            if (diff < 24 * 60 * 60 * 1000) return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            if (diff < 7 * 24 * 60 * 60 * 1000) {
                const days = ['日','一','二','三','四','五','六'];
                return `周${days[d.getDay()]}`;
            }
            return `${d.getMonth()+1}/${d.getDate()}`;
        },

        _escape(str) {
            return String(str || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },
    };

    // ==================== 挂载 ====================
    window.BondDataManager = BondDataManager;
    window.BondAIManager = BondAIManager;
    window.BondUI = BondUI;

    console.log('[CinemaWorld] bond.js 已加载');
})();