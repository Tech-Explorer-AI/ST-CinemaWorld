// ============================================================
// CinemaWorld · social.js
// 虚拟社交：单聊 / 群聊 / 朋友圈动态 / 评论点赞
// 依赖：core.js, world.js, player.js, story.js, ui.js（部分）
// 加载顺序：建议在 story.js 之后、ui.js 之前
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const CharacterRegistry = window.CharacterRegistry;
    const PlayerStateManager = window.PlayerStateManager;

    // ==================== 数据结构管理 ====================
    const SocialDataManager = {
        // ---------- 初始化 ----------
        ensureStore() {
            if (!CinemaWorld.worldState.social) {
                CinemaWorld.worldState.social = {
                    conversations: {},
                    moments: [],
                    unread: { total: 0, moments: 0 },
                    settings: {
                        maxMessagesPerConversation: 200,   // 单会话保留上限
                        compactThreshold: 30,               // 超过多少条触发压缩
                        compactKeep: 12,                    // 压缩后保留最近多少条
                        autoReplyChance: 0.3,               // 打开会话时角色主动说话概率
                    },
                };
            }
            const s = CinemaWorld.worldState.social;
            if (!s.conversations) s.conversations = {};
            if (!Array.isArray(s.moments)) s.moments = [];
            if (!s.unread) s.unread = { total: 0, moments: 0 };
            if (!s.settings) s.settings = { maxMessagesPerConversation: 200, compactThreshold: 30, compactKeep: 12, autoReplyChance: 0.3 };
            return s;
        },
        // ★ 取某个角色最近的动态
        getRecentMomentsByAuthor(authorName, limit = 5) {
            const store = this.ensureStore();
            return store.moments
                .filter(m => m.author === authorName)
                .slice(0, limit);   // moments 已经是 unshift，最新的在前面
        },

        // ★ 取全局最近的动态（不含指定作者）
        getRecentGlobalMoments(limit = 8, excludeAuthor = null) {
            const store = this.ensureStore();
            return store.moments
                .filter(m => m.author !== excludeAuthor)
                .slice(0, limit);
        },
        // ---------- 会话 ----------
        getConversation(id) {
            return this.ensureStore().conversations[id] || null;
        },
        removeMoment(momentId) {
            const store = this.ensureStore();
            const idx = store.moments.findIndex(m => m.id === momentId);
            if (idx === -1) return false;
            store.moments.splice(idx, 1);
            this.save();
            return true;
        },
        
        clearMoments() {
            const store = this.ensureStore();
            store.moments = [];
            store.unread.moments = 0;
            this.save();
        },
        getAllConversations() {
            const store = this.ensureStore();
            return Object.values(store.conversations).sort(
                (a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0)
            );
        },

        // 创建或获取单聊
        ensureSingleChat(characterName) {
            const id = `chat_${characterName}`;
            const store = this.ensureStore();
            if (store.conversations[id]) return store.conversations[id];

            const record = CharacterRegistry.get(characterName);
            const conv = {
                id,
                type: 'single',
                name: characterName,
                members: [characterName],
                avatar: this._pickAvatar(record),
                createdAt: Date.now(),
                lastMessageAt: 0,
                unreadCount: 0,
                messages: [],
                compactSummary: '',
                compactUntilIndex: 0,
                autoTriggered: false,
            };
            store.conversations[id] = conv;
            this.save();
            return conv;
        },

        // 创建群聊
        createGroupChat(name, members, topic = '') {
            const id = `group_${name}_${Date.now()}`;
            const store = this.ensureStore();

            const conv = {
                id,
                type: 'group',
                name,
                members: [...new Set(members)].filter(Boolean),
                avatar: '👥',
                topic,
                createdAt: Date.now(),
                lastMessageAt: 0,
                unreadCount: 0,
                messages: [],
                compactSummary: '',
                compactUntilIndex: 0,
            };
            store.conversations[id] = conv;
            this.save();
            return conv;
        },

        deleteConversation(id) {
            const store = this.ensureStore();
            if (store.conversations[id]) {
                delete store.conversations[id];
                this._recalcUnread();
                this.save();
            }
        },

        // ---------- 消息 ----------
        addMessage(conversationId, message) {
            const conv = this.getConversation(conversationId);
            if (!conv) return null;

            const msg = {
                id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                sender: message.sender || '系统',
                content: message.content || '',
                timestamp: message.timestamp || Date.now(),
                type: message.type || 'text',
                meta: message.meta || {},
            };
            conv.messages.push(msg);
            conv.lastMessageAt = msg.timestamp;

            // 玩家以外的人发的 → 未读 +1
            if (msg.sender !== '玩家' && msg.sender !== '系统') {
                conv.unreadCount = (conv.unreadCount || 0) + 1;
            }

            // 超过上限 → 触发压缩
            const limit = this.ensureStore().settings.maxMessagesPerConversation;
            if (conv.messages.length > limit) {
                this._trimConversation(conv);
            }

            this._recalcUnread();
            this.save();
            return msg;
        },

        addMessages(conversationId, messages) {
            return messages.map(m => this.addMessage(conversationId, m)).filter(Boolean);
        },

        // 裁剪（保留最近的，老的丢进 compact 里由 AI 压缩）
        _trimConversation(conv) {
            const settings = this.ensureStore().settings;
            const keep = settings.compactKeep;
            const cut = conv.messages.length - keep;
            if (cut <= 0) return;
            conv.messages = conv.messages.slice(cut);
            conv.compactUntilIndex = (conv.compactUntilIndex || 0) + cut;
        },

        // 标记会话已读
        markRead(conversationId) {
            const conv = this.getConversation(conversationId);
            if (!conv) return;
            conv.unreadCount = 0;
            this._recalcUnread();
            this.save();
        },

        markAllRead() {
            const store = this.ensureStore();
            Object.values(store.conversations).forEach(c => { c.unreadCount = 0; });
            store.unread.moments = 0;
            this._recalcUnread();
            this.save();
        },

        _recalcUnread() {
            const store = this.ensureStore();
            let total = 0;
            for (const c of Object.values(store.conversations)) {
                total += c.unreadCount || 0;
            }
            store.unread.total = total;
        },

        // ---------- 朋友圈动态 ----------
        addMoment(moment) {
            const store = this.ensureStore();
            const m = {
                id: `moment_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                author: moment.author || '某人',
                content: moment.content || '',
                images: moment.images || [],
                createdAt: moment.createdAt || Date.now(),
                likes: moment.likes || [],
                comments: moment.comments || [],
                seenByPlayer: false,
            };
            store.moments.unshift(m);

            // 上限
            if (store.moments.length > 100) {
                store.moments = store.moments.slice(0, 100);
            }

            store.unread.moments = (store.unread.moments || 0) + 1;
            this.save();
            return m;
        },

        addComment(momentId, comment) {
            const store = this.ensureStore();
            const m = store.moments.find(x => x.id === momentId);
            if (!m) return null;
            const c = {
                id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                author: comment.author || '某人',
                content: comment.content || '',
                replyTo: comment.replyTo || null,
                timestamp: Date.now(),
            };
            m.comments.push(c);
            this.save();
            return c;
        },

        toggleLike(momentId, who) {
            const store = this.ensureStore();
            const m = store.moments.find(x => x.id === momentId);
            if (!m) return false;
            const idx = m.likes.indexOf(who);
            if (idx > -1) {
                m.likes.splice(idx, 1);
            } else {
                m.likes.push(who);
            }
            this.save();
            return true;
        },

        getMoments(limit = 30) {
            return this.ensureStore().moments.slice(0, limit);
        },

        markMomentsSeen() {
            const store = this.ensureStore();
            store.unread.moments = 0;
            store.moments.forEach(m => { m.seenByPlayer = true; });
            this.save();
        },
            // ★ HTML 转义，防止名字里的特殊字符破坏 DOM
        _escape(str) {
            if (str === undefined || str === null) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        },
        // ---------- 工具 ----------
        _pickAvatar(record) {
            if (!record) return '👤';
        
            const name = record.name;
            if (!name) return '👤';
        
            // 1. 同步拿缓存
            let url = null;
            if (typeof SpriteManager !== 'undefined') {
                url = SpriteManager.getCachedSprite(name);
            }
        
            if (url) {
                return `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${this._escape(name)}">`;
            }
        
            // 2. 没有 → 异步预热，拿到后替换这个元素
            if (typeof SpriteManager !== 'undefined' && record.gender !== undefined) {
                SpriteManager.ensureSprite(name, record.gender).then((loadedUrl) => {
                    if (!loadedUrl) return;
                    // 用 data 属性找所有该角色的头像
                    document.querySelectorAll(`[data-social-avatar="${CSS.escape(name)}"]`).forEach(el => {
                        el.innerHTML = `<img src="${loadedUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${this._escape(name)}">`;
                        el.style.background = 'transparent';
                    });
                });
            }
        
            // 3. 兜底：emoji
            return record.gender === '女' ? '👩' : record.gender === '男' ? '👨' : '👤';
        },

        save() {
            if (window.SaveManager) window.SaveManager.save();
        },

        // 根据角色名构造聊天显示名（群聊时用）
        displaySender(name) {
            if (!name) return '某人';
            if (['玩家', '我', '主人公', 'player'].includes(name)) {
                return PlayerStateManager.player?.name || '我';
            }
            return name;
        },
    };

    // ==================== AI 生成 ====================
    const SocialAIManager = {
        isGenerating: false,
        // ★ 构建"作者历史"块
        _buildAuthorHistoryBlock(authorName) {
            const recent = SocialDataManager.getRecentMomentsByAuthor(authorName, 5);
            if (recent.length === 0) return '';

            const lines = recent.map((m, i) => {
                const time = this._formatShortTime(m.createdAt);
                return `${i + 1}. [${time}] ${m.content}`;
            }).join('\n');

            return `【${authorName} 最近发过的动态】（避免重复同样的话题/情绪）
        ${lines}`;
        },

        // ★ 构建"全局最近动态"块
        _buildGlobalHistoryBlock(excludeAuthor = null) {
            const recent = SocialDataManager.getRecentGlobalMoments(8, excludeAuthor);
            if (recent.length === 0) return '';

            const lines = recent.map(m => `· ${m.author}：${m.content}`).join('\n');

            return `【最近大家发过的动态】（避免和其他人撞话题）
        ${lines}`;
        },

        // ★ 简化的时间格式化（只给 AI 看，不用太精确）
        _formatShortTime(ts) {
            if (!ts) return '';
            const d = new Date(ts);
            const now = Date.now();
            const diff = now - ts;
            if (diff < 60 * 60 * 1000) return '刚刚';
            if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`;
            if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}天前`;
            return `${d.getMonth()+1}/${d.getDate()}`;
        },
        // ---------- 构建上下文 ----------
        _buildCharacterBlock(characterName) {
            const ch = CharacterRegistry.get(characterName);
            if (!ch) return `名称：${characterName}\n（无档案）`;

            const parts = [`名称：${ch.name}`];
            if (ch.gender) parts.push(`性别：${ch.gender}`);
            if (ch.mood) parts.push(`心情：${ch.mood}`);
            if (ch.status) parts.push(`状态：${ch.status}`);
            if (ch.favorability) parts.push(`好感度：${ch.favorability}`);
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

            return parts.join('\n');
        },
        _buildPlayerInteractionBlock(authorName) {
            const ctx = window.StoryManager?.buildContext(null, {
                world: false, worldHistory: false, volumes: false, chapters: false,
                chapter: false, parentStory: false, scene: true,
                mainChars: false, pendingEvents: false,
                interactionDigests: true,
                digestFilter: {
                    characters: true,
                    sceneItems: false, inventoryItems: false, sceneActions: false,
                    characterFilter: 'onlySelf',
                    targetName: authorName,
                },
            }) || '';
        
            if (!ctx.trim()) return '';
        
            // ★ 剥掉前两行标题（【本章交互历史】和【本章与角色的交互】）
            const lines = ctx.split('\n');
            const contentLines = [];
            let skipping = true;
            for (const line of lines) {
                const t = line.trim();
                if (skipping) {
                    // 跳过空行和两个标题行
                    if (!t || /^【本章交互历史】/.test(t) || /^【本章与角色的交互】/.test(t)) {
                        continue;
                    }
                    skipping = false;
                }
                contentLines.push(line);
            }
        
            const body = contentLines.join('\n').trim();
            if (!body) return '';
        
            return `【${authorName} 与玩家的近期互动】\n${body}`;
        },
        _buildHistoryBlock(conv) {
            const parts = [];

            // 早期摘要
            if (conv.compactSummary) {
                parts.push(`【早期聊天摘要】\n${conv.compactSummary}`);
            }

            // 最近消息
            const recent = conv.messages.slice(-20);
            if (recent.length > 0) {
                const lines = recent.map(m => {
                    const sender = SocialDataManager.displaySender(m.sender);
                    return `${sender}：${m.content}`;
                });
                parts.push(`【最近的聊天记录】\n${lines.join('\n')}`);
            }

            return parts.join('\n\n');
        },

        // ---------- 生成单聊回复 ----------
        async generateSingleReply(conv, playerMessage) {
            if (this.isGenerating) return null;
            this.isGenerating = true;
            try {
                const characterName = conv.members[0];
                const charBlock = this._buildCharacterBlock(characterName);
                const historyBlock = this._buildHistoryBlock(conv);
                const playerBlock = PlayerStateManager.formatForPrompt();

                const worldCtx = window.StoryManager?.buildContext(null, {
                    parentStory: false,
                    worldHistory:true,
                    mainChars: false,
                    scene: true,
                    interactionDigests: false,
                    volumes: true,
                    chapter: true,
                    chapters: true,
                    pendingEvents: false,
                }) || '';

                const now = new Date();
                const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

                const prompt = `你正在为视觉小说游戏生成一段"手机聊天"内容。这是角色在剧情之外的生活片段，是主线的补充。

【世界背景】
${worldCtx}

${playerBlock}

【对方角色】
${charBlock}

【聊天对象】
玩家（${PlayerStateManager.player?.name || '主人公'}）

${historyBlock}

【玩家刚刚说】
${playerMessage || '（玩家没有主动说话，只是打开了聊天窗口，请你自然地发起或继续话题）'}

【任务】
生成 ${characterName} 的回复。可以是一条，也可以是多条（2-4 条，用换行分隔）。
像真人发微信一样自然：
- 可以有语气词、表情、断句
- 可以连续发几条短消息
- 可以提到自己的日常（吃什么、在哪、在做什么）
- 可以引用之前聊过的内容
- 可以反问玩家
- 不要过于礼貌客套，要像熟人聊天
- 不要每一句都带表情，要自然

【当前时间】${timeStr}

【输出格式】（严格遵守）
只输出聊天内容，每条一行，以 【角色名】: 开头
例如：
【${characterName}】: 在的在的
【${characterName}】: 刚忙完，怎么了？
【${characterName}】: 你今天有空吗，我这边有点事想跟你说

注意：
- 不要输出旁白、场景描写、心理活动
- 不要输出"系统"消息
- 最多 4 条

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'social-single-reply');
                if (!result) return null;

                return this._parseReplyLines(result, characterName);
            } finally {
                this.isGenerating = false;
            }
        },

        // ---------- 生成群聊回复 ----------
        async generateGroupReply(conv, playerMessage) {
            if (this.isGenerating) return null;
            this.isGenerating = true;
            try {
                const members = conv.members || [];
                const memberBlocks = members.map(m => this._buildCharacterBlock(m)).join('\n\n---\n\n');
                const historyBlock = this._buildHistoryBlock(conv);
                const playerBlock = PlayerStateManager.formatForPrompt();

                const worldCtx = window.StoryManager?.buildContext(null, {
                    parentStory: false,
                    mainChars: false,
                    scene: true,
                    interactionDigests: false,
                    volumes: false,
                    chapters: false,
                    pendingEvents: false,
                }) || '';

                const now = new Date();
                const timeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

                const prompt = `你正在为视觉小说游戏生成一段"群聊"内容。这是角色们在剧情之外的生活片段，是主线的补充。

【世界背景】
${worldCtx}

${playerBlock}

【群聊名称】
${conv.name}

【群公告 / 话题】
${conv.topic || '（无）'}

【群成员】
${memberBlocks}

【群主】
玩家（${PlayerStateManager.player?.name || '主人公'}）

${historyBlock}

【玩家刚刚说】
${playerMessage || '（玩家没有主动说话，只是打开了群聊，请你自然地让群聊继续或发起新话题）'}

【任务】
生成接下来群聊里的对话。要求：
- 2-5 个成员的发言，按顺序
- 每个成员可以发 1-2 条消息
- 成员之间可以互相接话、吐槽、回应
- 不是每个人都必须说话（现实群里就是这样）
- 可以有人发完就"潜水"
- 语气要自然，像真人群聊
- 可以有人 @玩家
- 可以有人在群里分享日常
- 要符合每个角色的性格

【当前时间】${timeStr}

【输出格式】（严格遵守）
每条一行，以 【角色名】: 开头
例如：
【张三】: 我刚到家，路上堵死了
【李四】: 哈哈哈哈谁让你不坐地铁
【王五】: @${PlayerStateManager.player?.name || '主人公'} 你今晚有空吗
【张三】: 对了老王你那个东西找到了没

注意：
- 不要输出旁白
- 不要输出"系统"消息
- 总消息数控制在 3-10 条之间

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'social-group-reply');
                if (!result) return null;

                return this._parseReplyLines(result, null, members);
            } finally {
                this.isGenerating = false;
            }
        },

        // ---------- 解析回复 ----------
        _parseReplyLines(text, singleName = null, allowedNames = null) {
            const out = [];
            for (const raw of String(text).split('\n')) {
                const line = raw.trim();
                if (!line) continue;
                const m = line.match(/^【(.+?)】\s*[:：]\s*(.+)$/);
                if (!m) continue;
                const sender = m[1].trim();
                const content = m[2].trim();
                if (!content) continue;

                // 单聊强制用对方名字
                if (singleName) {
                    out.push({ sender: singleName, content, type: 'text' });
                    continue;
                }

                // 群聊校验成员
                if (allowedNames && !allowedNames.includes(sender)) {
                    // 不是群成员 → 忽略
                    continue;
                }
                out.push({ sender, content, type: 'text' });
            }
            return out;
        },

        // ---------- 生成朋友圈动态 ----------
        async generateMoment(authorName = null) {
            if (this.isGenerating) return null;
            this.isGenerating = true;
            try {
                const characters = CharacterRegistry.getAll()
                    .filter(c => c.role !== 'npc' || Math.random() < 0.3);
                if (characters.length === 0) return null;
        
                let author;
                if (authorName) {
                    author = CharacterRegistry.get(authorName);
                } else {
                    author = characters[Math.floor(Math.random() * characters.length)];
                }
                if (!author) return null;
        
                const otherNames = characters
                    .filter(c => c.name !== author.name)
                    .slice(0, 6)
                    .map(c => c.name);
        
                const worldCtx = window.StoryManager?.buildContext(null, {
                    parentStory: false,
                    worldHistory:true,
                    mainChars: false,
                    scene: false,
                    interactionDigests: true,
                    volumes: true,
                    chapter: true,
                    chapters: true,
                    pendingEvents: false,
                }) || '';
        
                const charBlock = this._buildCharacterBlock(author.name);
                const playerBlock = PlayerStateManager.formatForPrompt();
        
                // ★ 新增：注入历史
                const authorHistoryBlock = this._buildAuthorHistoryBlock(author.name);
                const globalHistoryBlock = this._buildGlobalHistoryBlock(author.name);
                const playerInteractionBlock = this._buildPlayerInteractionBlock(author.name);
                const prompt = `你正在为视觉小说游戏生成一条"朋友圈动态"。
        
【世界背景】
${worldCtx}

${playerBlock}

【发动态的人】
${charBlock}

${playerInteractionBlock}

【可评论的其他角色】
${otherNames.join('、') || '（无）'}

${globalHistoryBlock}

【任务】
1. 生成 ${author.name} 发的一条**新的**朋友圈动态（1-3 句话，像真人的朋友圈）
2. 生成 0-3 条其他角色的评论（自然、简短、像真人评论）

【动态内容要求】
- 反映角色的**当前**状态：心情、位置、正在做的事
- 要和【${author.name} 最近发过的动态】**有变化**——不要重复同样的话题、同样的情绪、同样的场景
- 如果之前发过"今天加班"，这次可以是"终于下班了"，或者聊别的
- 要符合角色性格
- 可以是高兴的、吐槽的、感慨的、无聊的
- 不要总是正能量，要真实
- 可以带 emoji，但不要太多（0-2 个）

【评论要求】
- 1-2 句话，简短
- 可以调侃、共鸣、追问
- 可以有人不评论
- 评论者必须是上面列出的角色之一
- 不要和【最近大家发过的动态】里的评论重复

【输出格式】（严格遵守）
第一行是动态内容：
MOMENT: 动态正文

然后每条评论一行：
COMMENT: 角色名|评论内容

如果没有评论就不写 COMMENT 行。

【示例】
MOMENT: 今天加班到现在，累死了 😩
COMMENT: 李四|哈哈哈活该，谁让你摸鱼
COMMENT: 王五|注意身体啊，别太拼了

请开始生成：`;
        
                const result = await window.generateFunctionalReply(prompt, 'social-moment');
                if (!result) return null;

                // 解析
                const momentMatch = result.match(/^MOMENT[:：]\s*(.+)$/m);
                if (!momentMatch) return null;

                const content = momentMatch[1].trim();
                const comments = [];

                const cmtRegex = /^COMMENT[:：]\s*(.+?)\|(.+)$/gm;
                let cm;
                while ((cm = cmtRegex.exec(result)) !== null) {
                    const cmtAuthor = cm[1].trim();
                    const cmtContent = cm[2].trim();
                    if (!cmtContent) continue;
                    if (!otherNames.includes(cmtAuthor)) continue;
                    comments.push({
                        author: cmtAuthor,
                        content: cmtContent,
                        replyTo: null,
                    });
                }

                return { author: author.name, content, comments };
            } finally {
                this.isGenerating = false;
            }
        },

        // ---------- 生成评论回复（玩家评论后，作者/其他人回应） ----------
        async generateCommentReplies(moment, playerComment) {
            if (this.isGenerating) return null;
            this.isGenerating = true;
            try {
                const characters = CharacterRegistry.getAll();
                const others = characters
                    .filter(c => c.name !== moment.author)
                    .slice(0, 5)
                    .map(c => c.name);
        
                const charBlock = this._buildCharacterBlock(moment.author);
        
                const prevComments = (moment.comments || [])
                    .slice(-5)
                    .map(c => `${c.author}：${c.content}`)
                    .join('\n');
        
                // ★ 新增：全局最近评论（用来避免重复）
                const store = SocialDataManager.ensureStore();
                const recentComments = [];
                for (const m of store.moments.slice(0, 10)) {
                    for (const c of (m.comments || []).slice(-3)) {
                        recentComments.push(`${c.author}：${c.content}`);
                        if (recentComments.length >= 15) break;
                    }
                    if (recentComments.length >= 15) break;
                }

                const recentCommentsBlock = recentComments.length > 0
                    ? `【最近大家发过的评论】（避免重复说类似的）
        ${recentComments.map(c => `· ${c}`).join('\n')}`
                    : '';
        
                const prompt = `你正在为视觉小说游戏的"朋友圈"生成评论互动。
        
【动态作者】
${charBlock}

【动态内容】
${moment.content}

${prevComments ? `【已有的评论】\n${prevComments}\n` : ''}

${recentCommentsBlock}

【玩家刚评论】
${PlayerStateManager.player?.name || '主人公'}：${playerComment}

【可选评论者】
${moment.author}、${others.join('、')}

【任务】
生成 1-3 条回应评论。规则：
- 动态作者可以回复玩家
- 其他角色也可以来评论
- 要自然，像真人
- 可以有人调侃，有人附和
- **不要和【最近大家发过的评论】重复**（"哈哈"、"牛"、"加油"这种尽量换别的说法）
- 也可以作者不回复（如果内容不值得回）

【输出格式】（严格遵守）
每条一行：
COMMENT: 角色名|评论内容

【示例】
COMMENT: ${moment.author.name}|哈哈谢谢
COMMENT: 李四|哇这个我也想去

请开始生成：`;
        
                const result = await window.generateFunctionalReply(prompt, 'social-comment-reply');
                if (!result) return null;

                const comments = [];
                const cmtRegex = /^COMMENT[:：]\s*(.+?)\|(.+)$/gm;
                let cm;
                while ((cm = cmtRegex.exec(result)) !== null) {
                    const author = cm[1].trim();
                    const content = cm[2].trim();
                    if (!content) continue;
                    if (author !== moment.author && !others.includes(author)) continue;
                    comments.push({ author, content, replyTo: '玩家' });
                }
                return comments;
            } finally {
                this.isGenerating = false;
            }
        },

        // ---------- 主动发消息（玩家未说话时） ----------
        async generateProactiveMessage(conv) {
            if (conv.type === 'single') {
                return await this.generateSingleReply(conv, '');
            }
            return await this.generateGroupReply(conv, '');
        },
    };

    // ==================== 手机内社交 App UI ====================
    const SocialAppUI = {
        currentView: 'list',        // list | chat | moment
        currentConversationId: null,
        currentMomentId: null,

        // ---------- 入口：渲染整个 App ----------
        render(view = null) {
            if (view) this.currentView = view;

            switch (this.currentView) {
                case 'chat': return this.renderChat();
                case 'moment': return this.renderMomentDetail();
                default: return this.renderList();
            }
        },

        // ---------- 会话列表 ----------
        renderList() {
            const convs = SocialDataManager.getAllConversations();
            const moments = SocialDataManager.getMoments(30);
            const store = SocialDataManager.ensureStore();

            const totalUnread = store.unread.total || 0;
            const momentUnread = store.unread.moments || 0;

            let html = `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>社交</span>
                    <button class="cw-phone-header-action" onclick="SocialAppUI.openCreateMenu()" title="新建">＋</button>
                </div>

                <div class="cw-social-tabs">
                    <button class="cw-social-tab ${this._tab === 'moments' ? 'active' : ''}"
                        onclick="SocialAppUI.switchTab('moments')">
                        动态 ${momentUnread > 0 ? `<span class="cw-social-tab-badge">${momentUnread}</span>` : ''}
                    </button>
                    <button class="cw-social-tab ${this._tab !== 'moments' ? 'active' : ''}"
                        onclick="SocialAppUI.switchTab('chats')">
                        聊天 ${totalUnread > 0 ? `<span class="cw-social-tab-badge">${totalUnread}</span>` : ''}
                    </button>
                </div>

                <div class="cw-phone-app-body cw-social-body">`;

            if (this._tab === 'moments') {
                html += this._renderMomentsList(moments);
            } else {
                html += this._renderConversationsList(convs);
            }

            html += `</div>`;
            return html;
        },

        _tab: 'chats',

        switchTab(tab) {
            this._tab = tab;
            if (tab === 'moments') {
                SocialDataManager.markMomentsSeen();
            }
            PhoneUIManager.render();
        },

        _renderConversationsList(convs) {
            if (convs.length === 0) {
                return `
                    <div class="cw-social-empty">
                        <div class="cw-social-empty-icon">💬</div>
                        <div class="cw-social-empty-text">还没有聊天</div>
                        <div class="cw-social-empty-hint">点击右上角 ＋ 开始</div>
                    </div>`;
            }

            let html = '';
            for (const conv of convs) {
                const last = conv.messages[conv.messages.length - 1];
                const lastText = last
                    ? `${SocialDataManager.displaySender(last.sender)}：${last.content}`
                    : '（还没有消息）';

                const timeStr = last ? this._formatTime(last.timestamp) : '';
                const unread = conv.unreadCount || 0;

                const avatarHTML = this._renderAvatar(conv);

                html += `
                    <div class="cw-social-conv-item" onclick="SocialAppUI.openChat('${conv.id}')">
                        <div class="cw-social-conv-avatar">${avatarHTML}</div>
                        <div class="cw-social-conv-main">
                            <div class="cw-social-conv-top">
                                <span class="cw-social-conv-name">
                                    ${conv.type === 'group' ? '👥 ' : ''}${conv.name}
                                </span>
                                <span class="cw-social-conv-time">${timeStr}</span>
                            </div>
                            <div class="cw-social-conv-preview">
                                ${this._escape(lastText)}
                            </div>
                        </div>
                        ${unread > 0 ? `<div class="cw-social-conv-badge">${unread > 99 ? '99+' : unread}</div>` : ''}
                    </div>`;
            }
            return html;
        },

        _renderMomentsList(moments) {
            let html = `
                <div class="cw-social-moments-header">
                    <button class="cw-social-moments-refresh" onclick="SocialAppUI.refreshMoments()">
                        🔄 刷新动态
                    </button>
                    ${moments.length > 0 ? `
                        <button class="cw-social-moments-clear" onclick="SocialAppUI.confirmClearMoments()">
                            🗑️ 清空
                        </button>
                    ` : ''}
                </div>`;

            if (moments.length === 0) {
                html += `
                    <div class="cw-social-empty">
                        <div class="cw-social-empty-icon">🌤️</div>
                        <div class="cw-social-empty-text">暂无动态</div>
                        <div class="cw-social-empty-hint">点击上方刷新试试</div>
                    </div>`;
                return html;
            }

            for (const m of moments) {
                html += this._renderMomentCard(m);
            }
            return html;
        },

        confirmClearMoments() {
            const store = SocialDataManager.ensureStore();
            const count = store.moments.length;
            if (count === 0) return;
            if (!confirm(`确定清空全部 ${count} 条动态吗？\n\n此操作不可撤销。`)) return;
        
            SocialDataManager.clearMoments();
            PhoneUIManager.render();
            window.UIManager.showText(`已清空 ${count} 条动态`, 1500);
        },
        _attr(str) {
            return String(str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        },
        openMomentMenu(momentId) {
            const store = SocialDataManager.ensureStore();
            const m = store.moments.find(x => x.id === momentId);
            if (!m) return;
        
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚙️ 操作</div>
                <div class="cw-social-chat-menu">
                    <div class="cw-social-menu-item danger"
                        onclick="SocialAppUI.deleteMoment('${this._attr(momentId)}')">
                        🗑️ 删除这条动态
                    </div>
                </div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },
        
        deleteMoment(momentId) {
            const store = SocialDataManager.ensureStore();
            const m = store.moments.find(x => x.id === momentId);
            if (!m) return;
            if (!confirm(`确定删除「${m.author}」的这条动态吗？`)) return;
        
            SocialDataManager.removeMoment(momentId);
            window.UIManager.closeModal();
            PhoneUIManager.render();
            window.UIManager.showText('已删除', 1200);
        },
        _displayAuthor(name) {
            if (!name) return '某人';
            if (['玩家', '我', '主人公', 'player'].includes(name)) {
                return PlayerStateManager.player?.name || '玩家';
            }
            return name;
        },
        _renderMomentCard(m) {
            const ch = CharacterRegistry.get(m.author);
            const avatar = this._pickAvatar(ch, m.author); 
            const timeStr = this._formatTime(m.createdAt);
            const liked = m.likes.includes('玩家');
        
            const commentsHTML = (m.comments || []).slice(0, 5).map(c => `
                <div class="cw-social-comment">
                    <span class="cw-social-comment-author">${this._escape(this._displayAuthor(c.author))}${c.replyTo ? ` 回复 ${this._escape(this._displayAuthor(c.replyTo))}` : ''}：</span>
                    <span class="cw-social-comment-content">${this._escape(c.content)}</span>
                </div>
            `).join('');
        
            return `
                <div class="cw-social-moment" data-moment-id="${this._attr(m.id)}">
                    <div class="cw-social-moment-head">
                        <div class="cw-social-moment-avatar">${avatar}</div>
                        <div class="cw-social-moment-author">
                            <div class="cw-social-moment-name">${this._escape(m.author)}</div>
                            <div class="cw-social-moment-time">${timeStr}</div>
                        </div>
                        <button class="cw-social-moment-menu"
                            onclick="event.stopPropagation(); SocialAppUI.openMomentMenu('${this._attr(m.id)}')"
                            title="更多">⋯</button>
                    </div>
                    <div class="cw-social-moment-content">${this._escape(m.content).replace(/\n/g, '<br>')}</div>
                    <div class="cw-social-moment-actions">
                        <button class="cw-social-moment-like ${liked ? 'liked' : ''}"
                            onclick="SocialAppUI.toggleLike('${this._attr(m.id)}')">
                            ${liked ? '❤️' : '🤍'} ${m.likes.length > 0 ? m.likes.length : ''}
                        </button>
                        <button class="cw-social-moment-comment-btn"
                            onclick="SocialAppUI.openMomentDetail('${this._attr(m.id)}')">
                            💬 ${m.comments.length > 0 ? m.comments.length : '评论'}
                        </button>
                    </div>
                    ${m.likes.length > 0 ? `
                        <div class="cw-social-moment-likes">
                            ❤️ ${m.likes.map(l => this._escape(l)).join('、')}
                        </div>
                    ` : ''}
                    ${commentsHTML ? `<div class="cw-social-moment-comments">${commentsHTML}</div>` : ''}
                    <div class="cw-social-moment-comment-input">
                        <input type="text" placeholder="写评论..."
                            id="cw-moment-input-${this._attr(m.id)}"
                            onkeydown="if(event.key==='Enter') SocialAppUI.submitComment('${this._attr(m.id)}')">
                        <button onclick="SocialAppUI.submitComment('${this._attr(m.id)}')">发送</button>
                    </div>
                </div>`;
        },

        // ---------- 聊天页面 ----------
        openChat(conversationId) {
            const conv = SocialDataManager.getConversation(conversationId);
            if (!conv) return;
        
            this.currentConversationId = conversationId;
            this.currentView = 'chat';
            SocialDataManager.markRead(conversationId);
            PhoneUIManager.render();
            setTimeout(() => this._scrollChatToBottom(), 50);
        
            if (conv.messages.length < 2 && !conv._proactiveDone) {
                this._triggerProactive(conv);
            }
        },
        
        async _triggerProactive(conv) {
            conv._proactiveDone = true;
            SocialDataManager.save();
        
            this._showTypingIndicator();
        
            const replies = await SocialAIManager.generateProactiveMessage(conv);
        
            this._hideTypingIndicator();
        
            if (!replies || replies.length === 0) return;
        
            for (const r of replies) {
                SocialDataManager.addMessage(conv.id, r);
                await new Promise(res => setTimeout(res, 500));
                if (this.currentView === 'chat' && this.currentConversationId === conv.id) {
                    this._refreshChatBody();
                }
            }
        },

        renderChat() {
            const conv = SocialDataManager.getConversation(this.currentConversationId);
            if (!conv) {
                return `<div class="cw-social-empty"><div>会话不存在</div></div>`;
            }
        
            const messagesHTML = conv.messages.map(m => this._renderMessage(m, conv)).join('');
        
            // ★ 单聊：显示对方的状态；群聊：显示人数
            let headerSub = '';
            if (conv.type === 'group') {
                headerSub = `${conv.members.length + 1} 人`;
            } else {
                const ch = CharacterRegistry.get(conv.members[0]);
                if (ch) {
                    const parts = [];
                    if (ch.mood) parts.push(ch.mood);
                    if (ch.status) parts.push(ch.status);
                    headerSub = parts.join(' · ');
                }
            }
        
            return `
                <div class="cw-social-chat-page">
                    <div class="cw-phone-app-header cw-social-chat-header">
                        <button class="cw-phone-back" onclick="SocialAppUI.backToList()">←</button>
                        <div class="cw-social-chat-title">
                            <div class="cw-social-chat-name">${this._escape(conv.name)}</div>
                            ${headerSub ? `<div class="cw-social-chat-sub">${this._escape(headerSub)}</div>` : ''}
                        </div>
                        <button class="cw-phone-header-action"
                            onclick="SocialAppUI.openChatMenu('${conv.id}')" title="设置">⋯</button>
                    </div>
        
                    ${conv.type === 'group' && conv.topic ? `
                        <div class="cw-social-chat-topic">
                            📢 ${this._escape(conv.topic)}
                        </div>
                    ` : ''}
        
                    <div class="cw-social-chat-body" id="cw-social-chat-body">
                        ${messagesHTML || '<div class="cw-social-chat-empty">还没有消息，说点什么吧</div>'}
                    </div>
        
                    <div class="cw-social-chat-input-bar">
                        <input type="text" id="cw-social-chat-input"
                            placeholder="说点什么..."
                            onkeydown="if(event.key==='Enter') SocialAppUI.sendMessage()">
                        <button onclick="SocialAppUI.sendMessage()">发送</button>
                    </div>
                </div>`;
        },

        _renderMessage(m, conv) {
            const isPlayer = m.sender === '玩家';
            const isSystem = m.sender === '系统';
            const displayName = SocialDataManager.displaySender(m.sender);
            const timeStr = this._formatTime(m.timestamp);
        
            // ---- 系统消息：居中灰色小字 ----
            if (isSystem) {
                return `
                    <div class="cw-social-msg-system">
                        <span>${this._escape(m.content)}</span>
                    </div>`;
            }
        
            // ---- 头像 ----
            let avatarHTML = '';
            if (isPlayer) {
                const avatarUrl = SpriteManager?.playerAvatar;
                if (avatarUrl) {
                    avatarHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="玩家">`;
                } else {
                    avatarHTML = PlayerStateManager.player?.name?.charAt(0) || '我';
                    // 异步加载头像，加载完替换
                    if (typeof SpriteManager !== 'undefined') {
                        SpriteManager.getPlayerAvatar().then(url => {
                            if (!url) return;
                            document.querySelectorAll('.cw-social-msg-avatar-player').forEach(el => {
                                el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="玩家">`;
                            });
                        });
                    }
                }
            } else {
                const ch = CharacterRegistry.get(m.sender);
                // 角色侧
                avatarHTML = ch
                ? `<span data-social-avatar="${ch.name}">${this._pickAvatar(ch)}</span>`
                : '👤';
            }
        
            // ---- 单聊里"角色"侧不显示名字；群聊里角色侧显示名字 ----
            const showNameOnOther = conv.type === 'group';
        
            // ---- 玩家侧 ----
            if (isPlayer) {
                return `
                    <div class="cw-social-msg is-player">
                        <div class="cw-social-msg-content">
                            <div class="cw-social-msg-bubble">${this._escape(m.content).replace(/\n/g, '<br>')}</div>
                        </div>
                        <div class="cw-social-msg-avatar cw-social-msg-avatar-player">${avatarHTML}</div>
                    </div>`;
            }
        
            // ---- 角色侧 ----
            return `
                <div class="cw-social-msg is-other">
                    <div class="cw-social-msg-avatar">${avatarHTML}</div>
                    <div class="cw-social-msg-content">
                        ${showNameOnOther ? `<div class="cw-social-msg-name">${this._escape(displayName)}</div>` : ''}
                        <div class="cw-social-msg-bubble">${this._escape(m.content).replace(/\n/g, '<br>')}</div>
                    </div>
                </div>`;
        },

        // ---------- 发送消息 ----------
        async sendMessage() {
            const input = document.getElementById('cw-social-chat-input');
            if (!input) return;
            const text = input.value.trim();
            if (!text) return;
        
            const conv = SocialDataManager.getConversation(this.currentConversationId);
            if (!conv) return;
        
            input.value = '';
            input.disabled = true;
        
            // 添加玩家消息
            SocialDataManager.addMessage(conv.id, {
                sender: '玩家',
                content: text,
                type: 'text',
            });
        
            // ★ 只刷新消息区
            this._refreshChatBody();
        
            // 显示"正在输入"
            this._showTypingIndicator();
        
            try {
                let replies;
                if (conv.type === 'group') {
                    replies = await SocialAIManager.generateGroupReply(conv, text);
                } else {
                    replies = await SocialAIManager.generateSingleReply(conv, text);
                }
        
                this._hideTypingIndicator();
        
                if (!replies || replies.length === 0) {
                    input.disabled = false;
                    return;
                }
        
                for (const r of replies) {
                    SocialDataManager.addMessage(conv.id, r);
                    await new Promise(res => setTimeout(res, 400 + Math.random() * 600));
                    if (this.currentView === 'chat' && this.currentConversationId === conv.id) {
                        this._refreshChatBody();
                    }
                }
        
                input.disabled = false;
                input.focus();
            } catch (e) {
                console.error('[CinemaWorld] 社交消息生成失败:', e);
                this._hideTypingIndicator();
                input.disabled = false;
                SocialDataManager.addMessage(conv.id, {
                    sender: '系统',
                    content: '（消息发送失败）',
                    type: 'system',
                });
                this._refreshChatBody();
            }
        },
        // 把 render() 里聊天相关的部分抽出来
        _refreshChatBody() {
            const conv = SocialDataManager.getConversation(this.currentConversationId);
            if (!conv) return;
            const body = document.getElementById('cw-social-chat-body');
            if (!body) return;

            const messagesHTML = conv.messages.map(m => this._renderMessage(m, conv)).join('');
            body.innerHTML = messagesHTML || '<div class="cw-social-chat-empty">还没有消息，说点什么吧</div>';
            this._scrollChatToBottom();
        },

// sendMessage 里改：把 PhoneUIManager.render() 换成 this._refreshChatBody()
        _showTypingIndicator() {
            const body = document.getElementById('cw-social-chat-body');
            if (!body) return;
            const el = document.createElement('div');
            el.id = 'cw-social-typing';
            el.className = 'cw-social-typing';
            el.innerHTML = `<span></span><span></span><span></span>`;
            body.appendChild(el);
            this._scrollChatToBottom();
        },

        _hideTypingIndicator() {
            const el = document.getElementById('cw-social-typing');
            if (el) el.remove();
        },

        _scrollChatToBottom() {
            const body = document.getElementById('cw-social-chat-body');
            if (body) {
                body.scrollTop = body.scrollHeight;
            }
        },

        backToList() {
            this.currentView = 'list';
            this.currentConversationId = null;
            PhoneUIManager.render();
        },

        // ---------- 新建会话 ----------
        openCreateMenu() {
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">➕ 新建</div>
                <div class="cw-social-create-grid">
                    <div class="cw-social-create-card" onclick="SocialAppUI.openNewSingle()">
                        <div class="cw-social-create-icon">👤</div>
                        <div class="cw-social-create-name">单聊</div>
                        <div class="cw-social-create-hint">和某个角色私聊</div>
                    </div>
                    <div class="cw-social-create-card" onclick="SocialAppUI.openNewGroup()">
                        <div class="cw-social-create-icon">👥</div>
                        <div class="cw-social-create-name">群聊</div>
                        <div class="cw-social-create-hint">拉几个角色一起聊</div>
                    </div>
                </div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;
            modal.className = 'active';
        },

        // 新建单聊
        openNewSingle() {
            const chars = CharacterRegistry.getAll()
                .filter(c => c.role !== 'npc')
                .sort((a, b) => {
                    const order = { main: 0, minor: 1, npc: 2 };
                    return (order[a.role] || 1) - (order[b.role] || 1);
                });

            if (chars.length === 0) {
                window.UIManager.showText('还没有认识的角色', 2000);
                return;
            }

            const modal = document.getElementById('cinemaworld-modal');
            let html = `<div class="cinemaworld-modal-title">👤 和谁聊？</div>
                <div class="cw-social-char-list">`;

            for (const c of chars) {
                const avatar = this._pickAvatar(c);
                const roleTag = { main: '⭐', minor: '', npc: '🏷️' }[c.role] || '';
                html += `
                    <div class="cw-social-char-item" onclick="SocialAppUI.createSingle('${c.name.replace(/'/g, "\\'")}')">
                        <div class="cw-social-char-avatar">${avatar}</div>
                        <div class="cw-social-char-info">
                            <div class="cw-social-char-name">${roleTag}${this._escape(c.name)}</div>
                            <div class="cw-social-char-sub">${this._escape(c.status || c.description || '')}</div>
                        </div>
                    </div>`;
            }

            html += `</div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;

            modal.innerHTML = html;
            modal.className = 'active';
        },

        createSingle(name) {
            const conv = SocialDataManager.ensureSingleChat(name);
            window.UIManager.closeModal();

            // 切到聊天页
            this.currentView = 'chat';
            this.currentConversationId = conv.id;
            SocialDataManager.markRead(conv.id);
            PhoneUIManager.render();
            setTimeout(() => this._scrollChatToBottom(), 50);

            // 主动开场
            if (conv.messages.length === 0) {
                this._triggerProactive(conv);
            }
        },

        // 新建群聊
        openNewGroup() {
            const chars = CharacterRegistry.getAll()
                .filter(c => c.role !== 'npc');

            if (chars.length === 0) {
                window.UIManager.showText('还没有认识的角色', 2000);
                return;
            }

            this._newGroupSelected = new Set();

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = this._renderNewGroupModal();
            modal.className = 'active';
        },

        _renderNewGroupModal() {
            const chars = CharacterRegistry.getAll().filter(c => c.role !== 'npc');
            let html = `
                <div class="cinemaworld-modal-title">👥 新建群聊</div>

                <div class="cw-social-form-row">
                    <div class="cw-social-form-label">群名</div>
                    <input type="text" id="cw-new-group-name" class="cinemaworld-textarea"
                        placeholder="例如：冒险小队" style="min-height:auto;padding:8px 12px;">
                </div>

                <div class="cw-social-form-row">
                    <div class="cw-social-form-label">群公告（可选）</div>
                    <input type="text" id="cw-new-group-topic" class="cinemaworld-textarea"
                        placeholder="例如：讨论下次去哪冒险" style="min-height:auto;padding:8px 12px;">
                </div>

                <div class="cw-social-form-label" style="margin-top:12px;">选择成员（至少 1 人）</div>
                <div class="cw-social-char-list" id="cw-new-group-chars">`;

            for (const c of chars) {
                const avatar = this._pickAvatar(c);
                const roleTag = { main: '⭐', minor: '', npc: '🏷️' }[c.role] || '';
                const selected = this._newGroupSelected.has(c.name);
                html += `
                    <div class="cw-social-char-item ${selected ? 'selected' : ''}"
                        data-char-name="${c.name}"
                        onclick="SocialAppUI.toggleGroupMember('${c.name.replace(/'/g, "\\'")}')">
                        <div class="cw-social-char-avatar">${avatar}</div>
                        <div class="cw-social-char-info">
                            <div class="cw-social-char-name">${roleTag}${this._escape(c.name)}</div>
                            <div class="cw-social-char-sub">${this._escape(c.status || c.description || '')}</div>
                        </div>
                        <div class="cw-social-char-check">${selected ? '✓' : ''}</div>
                    </div>`;
            }

            html += `</div>
                <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary" onclick="SocialAppUI.createGroup()">创建</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;

            return html;
        },

        toggleGroupMember(name) {
            if (this._newGroupSelected.has(name)) {
                this._newGroupSelected.delete(name);
            } else {
                this._newGroupSelected.add(name);
            }

            // 只更新 UI
            document.querySelectorAll('#cw-new-group-chars .cw-social-char-item').forEach(el => {
                const n = el.dataset.charName;
                const selected = this._newGroupSelected.has(n);
                el.classList.toggle('selected', selected);
                const check = el.querySelector('.cw-social-char-check');
                if (check) check.textContent = selected ? '✓' : '';
            });
        },

        createGroup() {
            const name = document.getElementById('cw-new-group-name')?.value.trim() || '群聊';
            const topic = document.getElementById('cw-new-group-topic')?.value.trim() || '';
            const members = Array.from(this._newGroupSelected);

            if (members.length === 0) {
                alert('请至少选择 1 个成员');
                return;
            }

            const conv = SocialDataManager.createGroupChat(name, members, topic);
            window.UIManager.closeModal();

            // 加一条系统消息
            SocialDataManager.addMessage(conv.id, {
                sender: '系统',
                content: `群聊已创建：${name}`,
                type: 'system',
            });

            this.currentView = 'chat';
            this.currentConversationId = conv.id;
            PhoneUIManager.render();
            setTimeout(() => this._scrollChatToBottom(), 50);

            // 让群里有人说第一句
            setTimeout(() => this._triggerProactive(conv), 500);
        },

        // ---------- 聊天菜单 ----------
        openChatMenu(conversationId) {
            const conv = SocialDataManager.getConversation(conversationId);
            if (!conv) return;

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚙️ ${this._escape(conv.name)}</div>
                <div class="cw-social-chat-menu">
                    ${conv.type === 'group' ? `
                        <div class="cw-social-menu-item" onclick="SocialAppUI.editGroupTopic('${conv.id}')">
                            📢 编辑群公告
                        </div>
                        <div class="cw-social-menu-item" onclick="SocialAppUI.editGroupMembers('${conv.id}')">
                            👥 管理成员
                        </div>
                    ` : ''}
                    <div class="cw-social-menu-item" onclick="SocialAppUI.clearMessages('${conv.id}')">
                        🗑️ 清空聊天记录
                    </div>
                    <div class="cw-social-menu-item danger" onclick="SocialAppUI.deleteChat('${conv.id}')">
                        ❌ 删除会话
                    </div>
                </div>
                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.className = 'active';
        },

        clearMessages(conversationId) {
            const conv = SocialDataManager.getConversation(conversationId);
            if (!conv) return;
            if (!confirm('确定清空这个会话的所有消息吗？')) return;

            conv.messages = [];
            conv.compactSummary = '';
            conv.compactUntilIndex = 0;
            conv.unreadCount = 0;
            SocialDataManager.save();
            window.UIManager.closeModal();
            window.UIManager.showText('已清空聊天记录', 1500);
            PhoneUIManager.render();
        },

        deleteChat(conversationId) {
            const conv = SocialDataManager.getConversation(conversationId);
            if (!conv) return;
            if (!confirm(`确定删除会话「${conv.name}」吗？`)) return;

            SocialDataManager.deleteConversation(conversationId);
            window.UIManager.closeModal();
            this.currentView = 'list';
            this.currentConversationId = null;
            PhoneUIManager.render();
        },

        editGroupTopic(conversationId) {
            const conv = SocialDataManager.getConversation(conversationId);
            if (!conv) return;

            const topic = prompt('输入新的群公告：', conv.topic || '');
            if (topic === null) return;
            conv.topic = topic.trim();
            SocialDataManager.save();
            window.UIManager.closeModal();
            PhoneUIManager.render();
        },

        editGroupMembers(conversationId) {
            const conv = SocialDataManager.getConversation(conversationId);
            if (!conv) return;

            const chars = CharacterRegistry.getAll().filter(c => c.role !== 'npc');
            this._editGroupMembers = new Set(conv.members);

            const modal = document.getElementById('cinemaworld-modal');
            let html = `<div class="cinemaworld-modal-title">👥 管理成员</div>
                <div class="cw-social-char-list">`;

            for (const c of chars) {
                const avatar = this._pickAvatar(c);
                const selected = this._editGroupMembers.has(c.name);
                html += `
                    <div class="cw-social-char-item ${selected ? 'selected' : ''}"
                        data-char-name="${c.name}"
                        onclick="SocialAppUI.toggleEditMember('${c.name.replace(/'/g, "\\'")}')">
                        <div class="cw-social-char-avatar">${avatar}</div>
                        <div class="cw-social-char-info">
                            <div class="cw-social-char-name">${this._escape(c.name)}</div>
                        </div>
                        <div class="cw-social-char-check">${selected ? '✓' : ''}</div>
                    </div>`;
            }

            html += `</div>
                <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary" onclick="SocialAppUI.saveGroupMembers('${conversationId}')">保存</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;

            modal.innerHTML = html;
            modal.className = 'active';
        },

        toggleEditMember(name) {
            if (this._editGroupMembers.has(name)) {
                this._editGroupMembers.delete(name);
            } else {
                this._editGroupMembers.add(name);
            }
            document.querySelectorAll('.cw-social-char-item').forEach(el => {
                const n = el.dataset.charName;
                const selected = this._editGroupMembers.has(n);
                el.classList.toggle('selected', selected);
                const check = el.querySelector('.cw-social-char-check');
                if (check) check.textContent = selected ? '✓' : '';
            });
        },

        saveGroupMembers(conversationId) {
            const conv = SocialDataManager.getConversation(conversationId);
            if (!conv) return;
            const members = Array.from(this._editGroupMembers);
            if (members.length === 0) {
                alert('至少保留 1 个成员');
                return;
            }
            conv.members = members;
            SocialDataManager.save();
            window.UIManager.closeModal();
            PhoneUIManager.render();
        },

        // ---------- 朋友圈交互 ----------
        async refreshMoments() {
            if (SocialAIManager.isGenerating) return;
        
            // ★ 弹选人框
            this._openMomentAuthorPicker();
        },
        
        _openMomentAuthorPicker() {
            const chars = CharacterRegistry.getAll()
                .filter(c => c.role !== 'npc')
                .sort((a, b) => {
                    const order = { main: 0, minor: 1, npc: 2 };
                    return (order[a.role] || 1) - (order[b.role] || 1);
                });
        
            if (chars.length === 0) {
                window.UIManager.showText('还没有认识的角色', 1500);
                return;
            }
        
            // 记住上次的选择
            this._momentAuthors = this._momentAuthors || new Set();
        
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📝 发动态</div>
                <div style="text-align:center;padding:0 0 12px;color:#aaa;font-size:13px;line-height:1.6;">
                    选择 1 个或多个角色，<br>
                    他们各自会发一条动态。
                </div>
        
                <div class="cw-social-moment-picker-hint">
                    <span class="cw-social-picker-label">已选：</span>
                    <span id="cw-moment-picker-selected">（未选）</span>
                </div>
        
                <div class="cw-social-char-list cw-social-moment-picker-list">
                    ${chars.map(c => {
                        const avatar = this._pickAvatar(c, c.name);
                        const roleTag = { main: '⭐', minor: '', npc: '🏷️' }[c.role] || '';
                        const selected = this._momentAuthors.has(c.name);
                        const safeName = this._escape(c.name);
                        const attrName = this._attr(c.name);
                        return `
                            <div class="cw-social-char-item ${selected ? 'selected' : ''}"
                                data-char-name="${safeName}"
                                onclick="SocialAppUI._toggleMomentAuthor('${attrName}')">
                                <div class="cw-social-char-avatar" data-social-avatar="${safeName}">
                                    ${avatar}
                                </div>
                                <div class="cw-social-char-info">
                                    <div class="cw-social-char-name">${roleTag}${safeName}</div>
                                    <div class="cw-social-char-sub">${this._escape(c.status || c.description || '')}</div>
                                </div>
                                <div class="cw-social-char-check">${selected ? '✓' : ''}</div>
                            </div>`;
                    }).join('')}
                </div>
        
                <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary"
                        onclick="SocialAppUI._confirmMomentAuthors()">
                        ✨ 生成动态
                    </button>
                    <button class="cinemaworld-button"
                        onclick="SocialAppUI._randomizeMomentAuthors()">
                        🎲 随机
                    </button>
                    <button class="cinemaworld-button"
                        onclick="SocialAppUI._resetMomentAuthors()">
                        清空
                    </button>
                    <button class="cinemaworld-button"
                        onclick="UIManager.closeModal()">
                        取消
                    </button>
                </div>`;
        
            modal.className = 'active';
            this._updateMomentPickerSelected();
        },
        _randomizeMomentAuthors() {
            const chars = CharacterRegistry.getAll()
                .filter(c => c.role !== 'npc');
        
            if (chars.length === 0) return;
        
            const current = this._momentAuthors || new Set();
        
            // 如果有剩余可换的，就在"未选中"的里抽
            const available = chars.filter(c => !current.has(c.name));
        
            // 全都选过了，或者本来就没选 → 从全池抽
            const pool = available.length >= 2 ? available : chars;
        
            const max = Math.min(3, pool.length);
            const count = 1 + Math.floor(Math.random() * max);
        
            // Fisher-Yates
            const shuffled = [...pool];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
        
            // ★ 替换（不是追加）——随机是"换一批"
            this._momentAuthors = new Set(shuffled.slice(0, count).map(c => c.name));
        
            this._openMomentAuthorPicker();
        },
        _toggleMomentAuthor(name) {
            if (!this._momentAuthors) this._momentAuthors = new Set();
            if (this._momentAuthors.has(name)) {
                this._momentAuthors.delete(name);
            } else {
                this._momentAuthors.add(name);
            }
        
            // 局部更新
            document.querySelectorAll('.cw-social-moment-picker-list .cw-social-char-item').forEach(el => {
                const n = el.dataset.charName;
                const selected = this._momentAuthors.has(n);
                el.classList.toggle('selected', selected);
                const check = el.querySelector('.cw-social-char-check');
                if (check) check.textContent = selected ? '✓' : '';
            });
        
            this._updateMomentPickerSelected();
        },
        
        _updateMomentPickerSelected() {
            const el = document.getElementById('cw-moment-picker-selected');
            if (!el) return;
            const arr = Array.from(this._momentAuthors || []);
            el.textContent = arr.length > 0 ? arr.join('、') : '（未选）';
        },
        
        _resetMomentAuthors() {
            this._momentAuthors = new Set();
            this._openMomentAuthorPicker();   // 重新渲染
        },
        
        async _confirmMomentAuthors() {
            const authors = Array.from(this._momentAuthors || []);
            if (authors.length === 0) {
                window.UIManager.showText('请至少选择 1 个角色', 1500);
                return;
            }
        
            window.UIManager.closeModal();
        
            // ★ 逐个生成
            let successCount = 0;
            for (const name of authors) {
                if (SocialAIManager.isGenerating) {
                    // 上一个还没生成完，等一下
                    while (SocialAIManager.isGenerating) {
                        await new Promise(r => setTimeout(r, 200));
                    }
                }
        
                window.UIManager.showText(`正在生成 ${name} 的动态...`, 800);
        
                const moment = await SocialAIManager.generateMoment(name);
                if (!moment) {
                    console.warn(`[CinemaWorld] ${name} 的动态生成失败`);
                    continue;
                }
        
                SocialDataManager.addMoment({
                    author: moment.author,
                    content: moment.content,
                    comments: moment.comments.map(c => ({
                        id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        author: c.author,
                        content: c.content,
                        timestamp: Date.now(),
                    })),
                });
        
                successCount++;
        
                // 刷新 UI（每生成一条就更新）
                if (SocialAppUI._tab === 'moments') {
                    PhoneUIManager.render();
                }
            }
        
            // 清空选择
            this._momentAuthors = new Set();
        
            if (successCount === 0) {
                window.UIManager.showText('生成失败', 1500);
            } else {
                window.UIManager.showText(`已生成 ${successCount} 条动态`, 1500);
            }
        },

        toggleLike(momentId) {
            SocialDataManager.toggleLike(momentId, '玩家');
            PhoneUIManager.render();
        },

        async submitComment(momentId) {
            const input = document.getElementById(`cw-moment-input-${momentId}`);
            if (!input) return;
            const text = input.value.trim();
            if (!text) return;

            input.value = '';
            input.disabled = true;

            SocialDataManager.addComment(momentId, {
                author: '玩家',
                content: text,
            });

            PhoneUIManager.render();

            // AI 生成回应
            const store = SocialDataManager.ensureStore();
            const moment = store.moments.find(m => m.id === momentId);
            if (!moment) return;

            const replies = await SocialAIManager.generateCommentReplies(moment, text);
            if (replies && replies.length > 0) {
                for (const r of replies) {
                    SocialDataManager.addComment(momentId, r);
                    await new Promise(res => setTimeout(res, 500));
                    PhoneUIManager.render();
                }
            }
        },

        openMomentDetail(momentId) {
            this.currentView = 'moment';
            this.currentMomentId = momentId;
            PhoneUIManager.render();
        },

        renderMomentDetail() {
            const store = SocialDataManager.ensureStore();
            const m = store.moments.find(x => x.id === this.currentMomentId);
            if (!m) {
                return `<div class="cw-social-empty"><div>动态不存在</div></div>`;
            }

            return `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="SocialAppUI.backToList()">←</button>
                    <span>动态详情</span>
                </div>
                <div class="cw-phone-app-body">
                    ${this._renderMomentCard(m)}
                </div>`;
        },

        // ---------- 工具 ----------
        _pickAvatar(record, fallbackName = '') {
            // ★ 1. 没有档案 → 用名字首字占位
            if (!record && fallbackName) {
                if (typeof SpriteManager !== 'undefined') {
                    SpriteManager.ensureSprite(fallbackName, '默认').then((url) => {
                        if (!url) return;
                        document.querySelectorAll(`[data-social-avatar="${CSS.escape(fallbackName)}"]`).forEach(el => {
                            el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${this._escape(fallbackName)}">`;
                            el.style.background = 'transparent';
                        });
                    });
                }
                return fallbackName.charAt(0);
            }
        
            if (!record) return '👤';
        
            const name = record.name;
        
            // ★ 2. 同步拿缓存
            let url = null;
            if (typeof SpriteManager !== 'undefined') {
                url = SpriteManager.getCachedSprite(name);
            }
        
            if (url) {
                return `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${this._escape(name)}">`;
            }
        
            // ★ 3. 异步预热
            if (typeof SpriteManager !== 'undefined') {
                SpriteManager.ensureSprite(name, record.gender).then((loadedUrl) => {
                    if (!loadedUrl) return;
                    document.querySelectorAll(`[data-social-avatar="${CSS.escape(name)}"]`).forEach(el => {
                        el.innerHTML = `<img src="${loadedUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${this._escape(name)}">`;
                        el.style.background = 'transparent';
                    });
                });
            }
        
            // ★ 4. 兜底 emoji
            return record.gender === '女' ? '👩' : record.gender === '男' ? '👨' : '👤';
        },

        _renderAvatar(conv) {
            if (conv.type === 'group') {
                return `<div class="cw-social-conv-avatar-group">👥</div>`;
            }
            const ch = CharacterRegistry.get(conv.name);
            return `<span data-social-avatar="${conv.name}">${this._pickAvatar(ch)}</span>`;
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
                .replace(/>/g, '&gt;');
        },
    };

    // ==================== 挂载 ====================
    window.SocialDataManager = SocialDataManager;
    window.SocialAIManager = SocialAIManager;
    window.SocialAppUI = SocialAppUI;

    console.log('[CinemaWorld] social.js 已加载');
})();