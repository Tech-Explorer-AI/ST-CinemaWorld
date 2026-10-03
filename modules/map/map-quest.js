// ============================================================
// CinemaWorld · map-quest.js
// 地图任务系统：创建 / 追踪 / 结算 / 连锁 / 摘要
// 依赖：map-canvas.js, map-schema.js, story.js
// 暴露：window.MapQuestManager
// ============================================================

(function () {
    'use strict';

    const MapQuestManager = {
        _generating: false,
        _maxActivePerMap: 4,
        _maxActiveInContext: 5,

        // ============================================================
        // 1. 地图生成时：随机散布任务
        // ============================================================
        async generateMapQuests(map) {
            if (!map) return;
            if (this._generating) return;

            // ★ 程序生成的地图 → 不生成任务
            if (map._source === 'program') {
                console.log(`[MapQuest] ${map.name} 是程序生成的，跳过任务`);
                return;
            }
            // ★ 显式标记 → 不生成任务
            if (map.tags?.includes('no-quest')) {
                console.log(`[MapQuest] ${map.name} 标记 no-quest，跳过任务`);
                return;
            }

            const ws = window.CinemaWorld?.worldState;
            if (!ws) return;

            ws.quests = ws.quests || {};

            const existing = Object.values(ws.quests).filter(
                q => q.mapName === map.name && q.status !== 'completed'
            ).length;

            if (existing >= this._maxActivePerMap) {
                console.log(`[MapQuest] ${map.name} 已有 ${existing} 个任务，跳过`);
                return;
            }

            if (map.regions.length < 2) return;

            this._generating = true;
            try {
                const quests = await this._generateQuestsForMap(map);
                if (!quests || quests.length === 0) return;

                for (const spec of quests) {
                    this.createQuest(spec, map);
                }
                console.log(`[MapQuest] ${map.name} 生成了 ${quests.length} 个任务`);
            } finally {
                this._generating = false;
            }
        },

        // ============================================================
        // 2. AI 生成地图任务链
        // ============================================================
        async _generateQuestsForMap(map) {
            const ws = window.CinemaWorld.worldState;
            const player = window.PlayerStateManager?.player;

            const ctx = [];
            if (ws.worldHistory?.summary) {
                ctx.push(`【世界史】${ws.worldHistory.summary}`);
            }
            if (window.StoryManager) {
                const c = window.StoryManager.buildContext(null, {
                    parentStory: false, mainChars: false, scene: false,
                    interactionDigests: true, volumes: false,
                    chapters: false, pendingEvents: false,
                });
                if (c) ctx.push(c);
            }

            const regions = (map.regions || [])
                .map(r => `- ${r.id}（${r.name}，${r.type}）`)
                .join('\n');

            const entities = (map.entities || [])
                .filter(e => !e.isPlayer && e.kind !== 'building')
                .slice(0, 30)
                .map(e => `- ${e.emoji} ${e.name}（${e.kind}，区域:${e.region}）`)
                .join('\n');

            const prompt = `你正在为一个视觉小说游戏的地图生成"地图任务"。

【世界与玩家上下文】
${ctx.join('\n\n') || '（全新世界）'}

【当前地图】
名称: ${map.name}
${map.description ? `描述: ${map.description}` : ''}

区域列表（★ 必须使用以下 id，不要翻译，不要自己编）:
${regions}

地图上已有的实体：
${entities || '（无）'}

【任务】
生成 1-2 个地图任务。不要多。
- 与地图的氛围、NPC、实体相关
- 有明确的进度目标
- 完成后有奖励
- 简单、清晰、容易理解
- 不要和主线冲突

【输出格式】（严格遵守）
★ 每个任务由四部分组成：任务头、接取剧情、完成剧情、任务奖励。
★ 段落标题必须原样照抄，脚本直接换行写，不要塞进方括号。

【地图任务】
- 【id|标题|emoji|类型】：描述，[地图:${map.name}|区域:区域id|位置:锚点名|进度:P]

接取任务剧情：
【人物名|显示|中|性别|状态】: 内容
【旁白】: 内容
（4-8 行）

完成任务剧情：
【人物名|显示|中|性别|状态】: 内容
【旁白】: 内容
（3-6 行）

任务奖励：
物品：
- 【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|其他]
- 【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|属性:X|属性:Y]
数值变化：金钱+12，经验+8

【类型】
- explore：探索型（到达某处）
- collect：收集型（收集 N 个物品）
- kill：击杀型（击败 N 个敌人）
- interact：交互型（与某实体交互）

【进度写法】
- 探索 → 进度:探索
- 收集 → 进度:收集:物品名×N
- 击杀 → 进度:击杀:敌名×N
- 交互 → 进度:交互:实体名

【奖励写法】
★ 奖励分两块：物品 + 数值变化。
★ 物品行必须和场景实体格式完全一致，方括号里写完整字段。
★ 数值变化写 "金钱+N" / "经验+N"，用逗号分隔。
★ 关键：获得物品时必须写完整格式（方括号内 键:值），否则玩家拿到的是空壳。
★ 可装备物品：写明属性字段，如 [类型:武器|攻击:+X|暴击:+Y%]
★ 可消耗物品：写明功能，如 [类型:消耗品|功能:回复 X 点生命|可堆叠]
★ 普通物品：至少写 [类型:物品] 和图标

示例：
- 获得【生锈的铁剑|⚔️】：锈迹斑斑的短剑，[类型:武器|货币种类:金钱|买价:X|卖价:X|攻击:+X|暴击:+Y%]
- 获得【红药水|🧪】：一瓶红色药剂，[类型:消耗品|功能:回复 X 点生命|可堆叠|货币种类:金钱|买价:X|卖价:X]
- 获得【黑面包|🍞】：还热乎，[类型:食物|功能:回复 X 点体力|可堆叠|货币种类:金钱|买价:X|卖价:X]：
- 【矿石碎片|🪨】：闪着微光的碎矿石，[类型:材料|可堆叠:是|最大堆叠:X]


数值示例：
数值变化：金钱+12，经验+8

【完整示例】
【地图任务】
- 【mine_lost_pick|断柄矿镐|⛏️|collect】：侧巷塌方处埋着老矿工阿岩的旧镐头，他念叨着那把镐柄上刻着他媳妇的名字。[地图:${map.name}|区域:side_gallery|位置:塌方处|进度:收集:断柄矿镐×1]

接取任务剧情：
【老矿工阿岩|显示|中|男|疲惫】: 那把镐……柄上刻着我家婆娘的名字。
【旁白】: 阿岩用袖口擦了擦额头的汗，望向侧巷塌方的方向。
【老矿工阿岩|显示|中|男|忧伤】: 塌了三年了，我一次都没敢进去。
【玩家|显示|中|男|平静】: 我去帮你看看。

完成任务剧情：
【老矿工阿岩|显示|中|男|意外】: 这……真是那把镐？
【旁白】: 阿岩接过断柄矿镐，指尖抚过柄上模糊的刻痕。
【老矿工阿岩|显示|中|男|开心】: 谢了，探客。这点矿石碎片你拿着。

任务奖励：
物品：
- 【矿石碎片|🪨】：闪着微光的碎矿石，[类型:材料|可堆叠:是|最大堆叠:20]
数值变化：金钱+12，经验+8

请开始生成：
`;

            const result = await window.generateFunctionalReply(prompt, 'map-quests');
            if (!result) return null;

            return this._parseQuestBlock(result);
        },

        // ============================================================
        // 3. 解析 AI 输出的任务块
        // ============================================================
        _parseQuestBlock(text) {
            const specs = [];
            const lines = text.split('\n');

            let inBlock = false;
            let currentSpec = null;
            let currentField = null;   // 'script' | 'completeScript' | 'rewardLines'
            let currentValue = [];

            const flushField = () => {
                if (currentSpec && currentField) {
                    if (currentField === 'rewardLines') {
                        currentSpec.rewardLines = currentValue.slice();
                    } else {
                        let val = currentValue.join('\n').trim();
                        val = val.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
                        currentSpec[currentField] = val;
                    }
                }
                currentField = null;
                currentValue = [];
            };

            const flushSpec = () => {
                flushField();
                if (currentSpec) specs.push(currentSpec);
                currentSpec = null;
            };

            for (const raw of lines) {
                const line = raw;
                const trimmed = line.trim();

                if (!trimmed) {
                    if (currentField) currentValue.push('');
                    continue;
                }

                if (/【地图任务】/.test(trimmed)) {
                    inBlock = true;
                    continue;
                }
                if (!inBlock) continue;

                // ★ 段落标题
                const headerMatch = trimmed.match(/^(接取任务剧情|完成任务剧情|任务奖励)\s*[:：]?\s*$/);
                if (headerMatch && currentSpec) {
                    flushField();
                    const h = headerMatch[1];
                    if (h === '接取任务剧情') currentField = 'script';
                    else if (h === '完成任务剧情') currentField = 'completeScript';
                    else if (h === '任务奖励') currentField = 'rewardLines';
                    currentValue = [];
                    continue;
                }

                // ★ 新任务（区分"任务头"和"奖励物品行"）
                if (/^-\s*【/.test(trimmed)) {
                    // ★ 在 rewardLines 段内，且不是任务头 → 当作奖励物品
                    if (currentField === 'rewardLines') {
                        const isTaskLine = /\[[^\]]*进度[：:][^\]]*\]/.test(trimmed);
                        if (!isTaskLine) {
                            currentValue.push(line);
                            continue;
                        }
                    }

                    flushSpec();
                    currentSpec = this._parseQuestLine(trimmed);
                    continue;
                }

                // ★ 收集段落内容
                if (currentField) {
                    currentValue.push(line);
                    continue;
                }
            }

            flushSpec();

            console.log(`[MapQuest] 解析出 ${specs.length} 个任务`);
            return specs;
        },

        _parseQuestLine(raw) {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.replace(/^[-•]\s*/, '').trim();
            const m = content.match(/^【([^】]+)】\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;

            const meta = m[1].split('|').map(s => s.trim());
            const id = meta[0];
            const title = meta[1] || id;
            const emoji = this._extractEmoji(meta[2]) || '📜';
            const type = (meta[3] || 'explore').toLowerCase();

            const rest = m[2] || '';
            const { description, fields } = this._splitDescAndFields(rest);

            return {
                id: `quest_${id}`,
                title,
                emoji,
                type,
                description,
                mapName: fields['地图'] || null,
                regionId: fields['区域'] || null,
                position: fields['位置'] || 'center',
                progressText: fields['进度'] || '探索',

                // ★ 奖励改为从"任务奖励"段落读，这里不再有
                rewardLines: [],         // 由 _parseQuestBlock 回填
                itemRewards: [],         // 解析后的物品
                numberRewards: [],       // 解析后的数值

                story: description,
                script: '',
                completeScript: '',
                summary: description,
            };
        },
        _parseRewardLines(lines) {
            const itemRewards = [];
            const numberRewards = [];

            if (!lines || lines.length === 0) {
                return { itemRewards, numberRewards };
            }

            let mode = null;   // 'item' | 'number'

            // ★ 辅助：解析一行数值变化
            const parseNumberLine = (text) => {
                const parts = String(text).split(/[，,、\/／]/).map(s => s.trim()).filter(Boolean);
                for (const p of parts) {
                    const m = p.match(/^(.+?)\s*[+\-＋－]\s*(\d+)\s*$/);
                    if (m) {
                        numberRewards.push({
                            key: m[1].trim(),
                            delta: parseInt(m[2]),
                        });
                    }
                }
            };

            for (const raw of lines) {
                const line = String(raw).trim();
                if (!line) continue;

                // ---------- 段落标记 ----------
                if (/^物品\s*[:：]?\s*$/.test(line)) { mode = 'item'; continue; }

                // ★ 数值变化：同行可能带值，也可能后面跟
                const numHeader = line.match(/^数值变化\s*[:：]\s*(.*)$/);
                if (numHeader) {
                    mode = 'number';
                    const val = (numHeader[1] || '').trim();
                    if (val) parseNumberLine(val);
                    continue;
                }
                if (/^数值\s*[:：]?\s*$/.test(line)) { mode = 'number'; continue; }

                // ---------- 数值行 ----------
                if (mode === 'number') {
                    // 可能带 - 前缀
                    const clean = line.replace(/^[-•]\s*/, '');
                    parseNumberLine(clean);
                    continue;
                }

                // ---------- 物品行 ----------
                if (/^[-•]\s*【/.test(line) || /^【/.test(line)) {
                    const clean = line.replace(/^[-•]\s*/, '');
                    const item = window.WorldManager?.parseItemLine?.(clean);
                    if (item && item.name) {
                        itemRewards.push({
                            name: item.name,
                            icon: item.icon || '📦',
                            description: item.description || '',
                            fields: item.fields || {},
                            interactions: item.interactions || [],
                            status: item.status || '',
                            effect: item.effect || '',
                            stackable: item.stackable,
                            maxStack: item.maxStack,
                            type: item.type || 'item',
                            count: item.count || 1,
                        });
                    } else {
                        console.warn('[MapQuest] 奖励物品解析失败:', clean);
                    }
                    continue;
                }

                // ---------- 兜底：没段落标记的裸数值行 ----------
                const looseNum = line.match(/^(.+?)\s*[+\-＋－]\s*(\d+)\s*$/);
                if (looseNum) {
                    numberRewards.push({
                        key: looseNum[1].trim(),
                        delta: parseInt(looseNum[2]),
                    });
                    continue;
                }
            }

            console.log('[MapQuest] 奖励解析:', { itemRewards, numberRewards });
            return { itemRewards, numberRewards };
        },

        // ★ 归一化：为逻辑键找玩家数据里的真实键
        _resolveRewardKey(logicalKey) {
            const player = window.PlayerStateManager?.player;
            if (!player) return null;

            // 清洗：去掉 emoji、空格、单位
            const clean = (s) => String(s || '')
                .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
                .replace(/\s+/g, '')
                .trim()
                .toLowerCase();

            const target = clean(logicalKey);

            // 同义词表：逻辑键 → 可能的写法
            const SYNONYMS = {
                '经验': ['经验', '经验值', 'exp', 'experience', '阅历'],
                '金钱': ['金钱', '钱', '金币', '货币', '铜钱', '银两', '元', '信用点', '声望'],
            };

            // 构建匹配词列表
            const candidates = new Set([target]);
            for (const [canon, list] of Object.entries(SYNONYMS)) {
                if (list.includes(target) || canon === target) {
                    list.forEach(w => candidates.add(clean(w)));
                    candidates.add(clean(canon));
                }
            }

            const matches = (realKey) => {
                const c = clean(realKey);
                if (!c) return false;
                if (candidates.has(c)) return true;
                // 包含匹配：realKey 里含候选词，或候选词含 realKey
                for (const cand of candidates) {
                    if (!cand) continue;
                    if (c.includes(cand) || cand.includes(c)) return true;
                }
                return false;
            };

            // 1. statusBars
            for (const bar of player.statusBars || []) {
                if (matches(bar.key)) {
                    return { scope: 'statusBar', ref: bar, key: bar.key };
                }
            }

            // 2. attributes
            for (const key of Object.keys(player.attributes || {})) {
                if (matches(key)) {
                    return { scope: 'attribute', key };
                }
            }

            // 3. derivedStats.computed
            const computed = player.derivedStats?.computed || {};
            for (const key of Object.keys(computed)) {
                if (matches(key)) {
                    return { scope: 'derived', key };
                }
            }

            // 4. extraStats
            const extra = player.extraStats;
            if (extra && Array.isArray(extra._order)) {
                for (const key of extra._order) {
                    if (matches(key)) {
                        return { scope: 'extra', key };
                    }
                }
            }

            return null;
        },

        _splitDescAndFields(text) {
            const s = String(text || '').trim();
            let description = s;
            const fields = {};

            const bracketRegex = /[\[【]([\s\S]*?)[\]】]/g;
            let bm;
            const brackets = [];
            while ((bm = bracketRegex.exec(s)) !== null) {
                brackets.push({ inner: bm[1], index: bm.index });
            }

            if (brackets.length > 0) {
                description = s.substring(0, brackets[0].index).trim()
                    .replace(/^[，,、\s]+|[，,、\s]+$/g, '');

                for (const b of brackets) {
                    for (const pair of b.inner.split('|')) {
                        const kv = pair.match(/^([^:：]+?)[:：]\s*([\s\S]+)$/);
                        if (kv) {
                            fields[kv[1].trim()] = kv[2].trim();
                        }
                    }
                }
            }

            return { description, fields };
        },

        _extractEmoji(s) {
            if (!s) return '';
            const m = String(s).match(
                /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
            );
            return m ? m[0] : '';
        },
        _attachToOfferer(quest, map) {
            const npcName = quest.offererName;
            if (!npcName) return;

            const npc = map.entities.find(e =>
                e.kind === 'npc' && e.name === npcName
            );

            if (!npc) {
                console.warn(`[MapQuest] 找不到任务提供者「${npcName}」，改为自动接取`);
                quest.status = 'active';
                this._spawnQuestEntities(quest, map);
                if (quest.script) this._playIntro(quest);
                return;
            }

            npc.meta = npc.meta || {};
            npc.meta.questOffer = quest.id;
            console.log(`[MapQuest] 任务「${quest.title}」已挂到「${npcName}」`);
        },
        async acceptQuest(questId) {
            const q = this.getQuest(questId);
            if (!q) return;

            if (q.status !== 'offered') {
                window.UIManager?.showText?.('任务无法接取', 1500);
                return;
            }

            q.status = 'active';

            // ★ 播接取剧情
            if (q.script) {
                await this._playIntro(q);
            }

            // ★ 落任务实体（收集物 / 敌人 / 交互目标）
            const map = window.MapLauncher?.getMap?.();
            if (map && map.name === q.mapName) {
                this._spawnQuestEntities(q, map);
            }

            window.UIManager?.showText?.(`📜 已接取：${q.title}`, 2000);

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            if (window.SaveManager) window.SaveManager.save();
        },
        openQuestOffer(questId) {
            const q = this.getQuest(questId);
            if (!q || q.status !== 'offered') return;

            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">${q.emoji} ${q.title}</div>
                <div style="font-size:13px;color:#aaa;line-height:1.7;margin-bottom:14px;
                    padding:12px;background:rgba(0,0,0,.2);border-radius:10px;">
                    ${q.description}
                </div>
                <div style="font-size:12px;color:#888;margin-bottom:14px;
                    padding:10px;background:rgba(120,150,255,.06);border-radius:8px;">
                    <div style="margin-bottom:4px;">📋 进度：${q.target.count || 1}</div>
                    <div>🎁 奖励：${this._formatRewards(q) || '无'}</div>
                </div>
                <div style="text-align:center;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary"
                        onclick="MapQuestManager.acceptQuest('${questId}')">
                        ✅ 接取
                    </button>
                    <button class="cinemaworld-button"
                        onclick="UIManager.closeModal()">
                        暂不接取
                    </button>
                </div>
            `;
        },
        // ============================================================
        // 4. 从 spec 创建任务
        // ============================================================
        createQuest(spec, map, isPending = false) {
            const ws = window.CinemaWorld.worldState;
            ws.quests = ws.quests || {};

            if (ws.quests[spec.id]) {
                console.log('[MapQuest] 任务已存在:', spec.id);
                return ws.quests[spec.id];
            }

            const progress = this._parseProgress(spec.progressText);
            const { itemRewards, numberRewards } = this._parseRewardLines(spec.rewardLines || []);

            const quest = {
                id: spec.id,
                title: spec.title,
                emoji: spec.emoji,
                description: spec.description,
                summary: spec.summary || spec.description,
                type: spec.type,

                mapName: spec.mapName || map?.name || null,
                regionId: spec.regionId || map?.startRegion || null,
                position: spec.position || 'center',

                progressType: progress.type,
                target: progress.target,
                current: 0,

                // ★ 新奖励结构
                itemRewards,       // [{name, icon, fields, ...}]
                numberRewards,     // [{key, delta}]

                script: spec.script || '',
                completeScript: spec.completeScript || '',
                story: spec.story || spec.description || '',

                status: 'offered',
                createdAt: Date.now(),
                completedAt: null,
            };

            if (map && quest.mapName === map.name) {
                this._spawnQuestPoint(quest, map);
            }

            ws.quests[spec.id] = quest;

            if (window.SaveManager) window.SaveManager.save();
            return quest;
        },

        // ============================================================
        // 5. 进度解析
        // ============================================================
        _parseProgress(text) {
            const s = String(text || '').trim();

            if (/^探索/.test(s)) {
                return { type: 'explore', target: { kind: 'region' } };
            }

            if (/^收集/.test(s)) {
                // ★ 支持多个物品：收集:甲×3，乙×1，丙×2
                const body = s.replace(/^收集[:：]\s*/, '');
                const items = [];
                const re = /([^，,、×xX*]+?)\s*[×xX*]\s*(\d+)/g;
                let m;
                while ((m = re.exec(body)) !== null) {
                    items.push({
                        itemName: m[1].trim(),
                        count: parseInt(m[2]),
                        current: 0,
                    });
                }
                if (items.length === 0) {
                    const single = body.match(/^([^，,、]+)/);
                    if (single) items.push({ itemName: single[1].trim(), count: 1, current: 0 });
                }

                return {
                    type: 'collect',
                    target: {
                        items,                                     // ★ 主字段
                        itemName: items[0]?.itemName || '',        // 兼容旧字段
                        count: items.reduce((a, b) => a + b.count, 0),
                    },
                };
            }

            if (/^击杀/.test(s)) {
                const m = s.match(/击杀[:：]\s*(.+?)\s*[×xX*]\s*(\d+)/);
                return {
                    type: 'kill',
                    target: {
                        enemyName: m ? m[1].trim() : '',
                        count: m ? parseInt(m[2]) : 1,
                    },
                };
            }

            if (/^交互/.test(s)) {
                const m = s.match(/交互[:：]\s*(.+)/);
                return {
                    type: 'interact',
                    target: { entityName: m ? m[1].trim() : '' },
                };
            }

            return { type: 'explore', target: { kind: 'region' } };
        },
        _spawnQuestPoint(quest, map) {
            if (!map._generated) return;

            // ★ regionId 兜底
            let regionId = quest.regionId;
            if (!map._generated.placements?.[regionId]) {
                const byName = map.regions.find(r =>
                    r.name === quest.regionId || r.name.includes(quest.regionId)
                );
                if (byName) regionId = byName.id;
                else regionId = map.startRegion;
                quest.regionId = regionId;
            }

            const rect = map._generated.placements?.[regionId];
            if (!rect) return;

            const ent = {
                id: `quest_point_${quest.id}`,
                name: quest.title,
                emoji: quest.emoji || '❗',
                kind: 'quest_point',           // ★ 新类型
                region: regionId,
                position: quest.position || 'center',
                blocking: false,
                isPlayer: false,
                tags: ['任务点'],
                description: quest.description,
                meta: {
                    questId: quest.id,
                    questPoint: true,
                },
                status: '',
                effect: '',
                fields: {},
                interactions: [{ name: '接取任务', hint: quest.description }],
                extraStats: { _order: [], _raw: '' },
                count: 1,
                countMode: 'single',
                stackable: false,
                maxStack: null,
                type: 'quest_point',
            };

            const used = new Set(
                map.entities.filter(e => e._placed).map(e => `${e.x},${e.y}`)
            );
            const pos = window.MapLayout._resolvePosition(
                ent, map._generated.grid, map._generated.placements, used
            );
            if (pos) {
                ent.x = pos.x;
                ent.y = pos.y;
                ent._placed = true;
                map.entities.push(ent);
                console.log(`[MapQuest] 任务点「${quest.title}」已落点: ${regionId}(${pos.x},${pos.y})`);
            }
            // _spawnQuestPoint 里 pos === null 时
            if (!pos) {
                console.warn(`[MapQuest]「${quest.title}」区域 ${regionId} 被覆盖，兜底到全局扫描`);
                outer: for (let y = 0; y < grid.length; y++) {
                    for (let x = 0; x < grid[0].length; x++) {
                        const c = grid[y][x];
                        if (!c || !c.walkable) continue;
                        if (c.terrain === 'void') continue;
                        if (!c.regionId) continue;
                        if (c.decor && c.decor.type !== 'plant') continue;
                        if (c.portal) continue;
                        if (used.has(`${x},${y}`)) continue;
                        pos = { x, y };
                        ent.region = c.regionId;
                        quest.regionId = c.regionId;
                        break outer;
                    }
                }
            }
            window.CWNotify3D?.('entity-add');
        },
        _parseRewards(text) {
            const rewards = [];
            if (!text) return rewards;

            const parts = String(text).split(/[、,，]/).map(s => s.trim()).filter(Boolean);
            for (const part of parts) {
                const m = part.match(/^(.+?)\s*[×xX*]\s*(\d+)$/);
                if (!m) continue;
                const name = m[1].trim();
                const count = parseInt(m[2]);

                if (name === '经验' || name === 'exp') {
                    rewards.push({ type: 'exp', value: count });
                } else {
                    rewards.push({ type: 'item', name, count });
                }
            }
            return rewards;
        },

        // ============================================================
        // 6. 落点实体化
        // ============================================================
        _spawnQuestEntities(quest, map) {
            if (!map._generated) return;

            let regionId = quest.regionId;
            if (!map._generated.placements?.[regionId]) {
                const byName = map.regions.find(r =>
                    r.name === quest.regionId || r.name.includes(quest.regionId)
                );
                if (byName) regionId = byName.id;
                else regionId = map.startRegion;
                quest.regionId = regionId;
            }

            const rect = map._generated.placements?.[regionId];
            if (!rect) return;

            if (quest.progressType === 'collect') {
                this._spawnCollectItems(quest, map, rect, regionId);
            }
            if (quest.progressType === 'kill' && quest.target.enemyName) {
                this._spawnEnemies(quest, map, rect, regionId);
            }
            if (quest.progressType === 'explore') {
                // 探索型：不额外落点，走任务点本身
            }
            if (quest.progressType === 'interact') {
                this._attachInteractTarget(quest, map, rect, regionId);
            }
            window.CWNotify3D?.('entity-add');
        },

        // ★ 交互型：优先挂到现有实体上，找不到才 spawn marker
        _attachInteractTarget(quest, map, rect, regionId) {
            const targetName = quest.target.entityName;
            if (!targetName) {
                console.warn('[MapQuest] 交互型任务没有目标实体名:', quest.title);
                return;
            }

            // 1. 地图上已有同名实体
            const existing = map.entities.find(e =>
                e.name === targetName && !e.isPlayer && e.kind !== 'building'
            );

            if (existing) {
                existing.meta = existing.meta || {};
                existing.meta.questId = quest.id;
                existing.meta.questTarget = true;
                existing.tags = existing.tags || [];
                if (!existing.tags.includes('任务')) existing.tags.push('任务');
                console.log(`[MapQuest] 交互目标「${targetName}」已挂到现有实体`);
                return;
            }

            // 2. 没有 → spawn marker
            console.warn(`[MapQuest] 找不到交互目标「${targetName}」，生成 marker`);
            this._spawnQuestMarker(quest, map, rect, regionId);
        },

        _spawnCollectItems(quest, map, rect, regionId) {
            const items = quest.target.items || [
                { itemName: quest.target.itemName, count: quest.target.count, current: 0 }
            ];

            for (const spec of items) {
                if (!spec.itemName) continue;
                const needed = spec.count || 1;
                const itemName = spec.itemName;

                // ★ 只统计"可拾取"的同名物品
                const existing = map.entities.filter(e =>
                    e.kind === 'item' &&
                    e.name === itemName &&
                    String(e.fields?.['可拾取'] || '') === '是'
                ).length;

                const toSpawn = Math.max(0, needed - existing);
                if (toSpawn === 0) continue;

                for (let i = 0; i < toSpawn; i++) {
                    const ent = {
                        id: `quest_item_${quest.id}_${this._hashName(itemName)}_${i}_${Date.now()}`,
                        name: itemName,
                        emoji: this._guessItemEmoji(itemName),
                        kind: 'item',
                        region: regionId,                   // ★ 用兜底后的 regionId
                        position: quest.position || 'center',
                        blocking: false,
                        isPlayer: false,
                        tags: ['任务物品'],
                        description: `任务【${quest.title}】需要的物品`,
                        meta: { questId: quest.id },
                        status: '',
                        effect: '',
                        fields: {
                            '类型': '任务',
                            '可拾取': '是',
                        },
                        interactions: [],
                        extraStats: { _order: [], _raw: '' },
                        count: 1,
                        countMode: 'single',
                        stackable: false,
                        maxStack: null,
                        type: 'item',
                    };

                    const used = new Set(
                        map.entities.filter(e => e._placed).map(e => `${e.x},${e.y}`)
                    );
                    const pos = window.MapLayout._resolvePosition(
                        ent, map._generated.grid, map._generated.placements, used
                    );
                    if (pos) {
                        ent.x = pos.x;
                        ent.y = pos.y;
                        ent._placed = true;
                        map.entities.push(ent);
                    } else {
                        console.warn(`[MapQuest] 任务物品「${itemName}」第 ${i} 个摆放失败`);
                    }
                }
            }
        },

        // ★ 根据物品名猜 emoji
        _guessItemEmoji(name) {
            if (/贝壳|海螺|螺/.test(name)) return '🐚';
            if (/羽毛|羽/.test(name)) return '🪶';
            if (/玻璃|碎片/.test(name)) return '🔷';
            if (/花/.test(name)) return '🌸';
            if (/药|水/.test(name)) return '🧪';
            if (/剑|刀|武器/.test(name)) return '⚔️';
            if (/盾|护甲/.test(name)) return '🛡️';
            return '📦';
        },

        _spawnEnemies(quest, map, rect, regionId) {
            const needed = quest.target.count;
            const enemyName = quest.target.enemyName;

            const existing = map.entities
                .filter(e => e.kind === 'encounter' && e.name === enemyName)
                .reduce((sum, e) => sum + (e.count || 1), 0);

            const toSpawn = Math.max(0, needed - existing);
            if (toSpawn === 0) return;

            const ent = {
                id: `quest_enemy_${quest.id}_${Date.now()}`,
                name: enemyName,
                emoji: '👹',
                kind: 'encounter',
                region: regionId,                   // ★ 用兜底后的 regionId
                position: 'center',
                blocking: true,
                isPlayer: false,
                tags: ['任务敌人'],
                description: `任务【${quest.title}】的目标`,
                meta: { questId: quest.id },
                status: '',
                effect: '',
                fields: {
                    '类型': '遭遇',
                    'HP': '30/30',
                    '攻击': '5',
                    '防御': '2',
                    '敏捷': '3',
                    '数量': String(toSpawn),
                },
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count: toSpawn,
                countMode: 'cluster',
                stackable: false,
                maxStack: null,
                type: 'encounter',
            };

            const used = new Set(
                map.entities.filter(e => e._placed).map(e => `${e.x},${e.y}`)
            );
            const pos = window.MapLayout._resolvePosition(
                ent, map._generated.grid, map._generated.placements, used
            );
            if (pos) {
                ent.x = pos.x;
                ent.y = pos.y;
                ent._placed = true;
                map.entities.push(ent);
            } else {
                console.warn(`[MapQuest] 任务敌人「${enemyName}」摆放失败`);
            }
        },

        _spawnQuestMarker(quest, map, rect, regionId) {
            const displayName = (quest.progressType === 'interact' && quest.target.entityName)
                ? quest.target.entityName
                : quest.title;

            const ent = {
                id: `quest_marker_${quest.id}`,
                name: displayName,
                emoji: quest.emoji || '❓',
                kind: 'marker',
                region: regionId,                   // ★ 用兜底后的 regionId
                position: quest.position || 'center',
                blocking: false,
                isPlayer: false,
                tags: ['任务'],
                description: quest.description,
                meta: {
                    questId: quest.id,
                    questTarget: true,
                    questTitle: quest.title,
                },
                status: '',
                effect: '',
                fields: {},
                interactions: quest.progressType === 'explore'
                    ? [{ name: '探索此地', hint: '环顾四周，看看这里有什么' }]
                    : [],
                extraStats: { _order: [], _raw: '' },
                count: 1,
                countMode: 'single',
                stackable: false,
                maxStack: null,
                type: 'marker',
            };

            const used = new Set(
                map.entities.filter(e => e._placed).map(e => `${e.x},${e.y}`)
            );
            const pos = window.MapLayout._resolvePosition(
                ent, map._generated.grid, map._generated.placements, used
            );
            if (pos) {
                ent.x = pos.x;
                ent.y = pos.y;
                ent._placed = true;
                map.entities.push(ent);
            } else {
                console.warn(`[MapQuest] 任务 marker「${displayName}」摆放失败`);
            }
        },

        // ============================================================
        // 7. 进度追踪
        // ============================================================
        onItemPicked(itemName, count = 1) {
            const ws = window.CinemaWorld?.worldState;
            if (!ws?.quests) return;

            for (const q of Object.values(ws.quests)) {
                if (q.status !== 'active') continue;
                if (q.progressType !== 'collect') continue;

                // ★ 多物品模式
                if (q.target.items?.length) {
                    const spec = q.target.items.find(it => it.itemName === itemName);
                    if (!spec) continue;
                    spec.current = (spec.current || 0) + count;

                    // 全部子项都满了 → 完成
                    const allDone = q.target.items.every(
                        it => (it.current || 0) >= it.count
                    );
                    if (allDone) {
                        this.completeQuest(q);
                    } else {
                        // 显示进度
                        const text = q.target.items.map(it =>
                            `${it.itemName} ${it.current || 0}/${it.count}`
                        ).join('，');
                        window.UIManager?.showText?.(`任务【${q.title}】 ${text}`, 1500);
                    }
                    continue;
                }

                // ★ 旧单物品模式（兼容）
                if (q.target.itemName !== itemName) continue;
                q.current += count;
                this._checkComplete(q);
            }
        },

        onEnemyKilled(enemyName, count = 1) {
            const ws = window.CinemaWorld?.worldState;
            if (!ws?.quests) return;

            for (const q of Object.values(ws.quests)) {
                if (q.status !== 'active') continue;
                if (q.progressType !== 'kill') continue;
                if (q.target.enemyName !== enemyName) continue;

                q.current += count;
                this._checkComplete(q);
            }
        },

        onEntityInteracted(entity) {
            const ws = window.CinemaWorld?.worldState;
            if (!ws?.quests) return;

            for (const q of Object.values(ws.quests)) {
                if (q.status !== 'active') continue;
                if (q.progressType !== 'interact') continue;

                // ★ 双匹配：名字匹配 或 questId 匹配
                const nameMatch = q.target.entityName === entity.name;
                const questIdMatch = entity.meta?.questId === q.id;

                if (!nameMatch && !questIdMatch) continue;

                q.current = 1;
                this._checkComplete(q);
            }
        },

        onRegionEntered(regionId) {
            const ws = window.CinemaWorld?.worldState;
            if (!ws?.quests) return;

            for (const q of Object.values(ws.quests)) {
                if (q.status !== 'active') continue;
                if (q.progressType !== 'explore') continue;
                if (q.regionId !== regionId) continue;

                q.current = 1;
                this._checkComplete(q);
            }
        },

        _checkComplete(q) {
            const need = q.target.count || 1;
            if (q.current >= need) {
                this.completeQuest(q);
            } else {
                window.UIManager?.showText?.(
                    `任务【${q.title}】 ${q.current}/${need}`,
                    1500
                );
            }
        },

        // ============================================================
        // 8. 完成结算
        // ============================================================
        async completeQuest(quest) {
            if (!quest || quest.status === 'completed') return;

            quest.status = 'completed';
            quest.completedAt = Date.now();

            const map = window.MapLauncher?.getMap?.();

            // 移除任务点 + marker
            if (map?.entities) {
                for (let i = map.entities.length - 1; i >= 0; i--) {
                    const e = map.entities[i];
                    if (e.meta?.questId === quest.id &&
                        (e.kind === 'quest_point' || e.kind === 'marker')) {
                        map.entities.splice(i, 1);
                    }
                }
            }
            // ★ 通知 3D 全量同步
            window.CWNotify3D?.('all');
            // 关面板
            if (window.MapEntityPanel?._selectedId && map?.entities) {
                const stillExists = map.entities.some(
                    e => e.id === window.MapEntityPanel._selectedId
                );
                if (!stillExists) {
                    window.MapEntityPanel._selectedId = null;
                    window.MapLauncher?._closeSubPanel?.();
                }
            }

            // 发奖励
            const rewardText = this._formatRewards(quest);
            if (rewardText) {
                await window.UIManager?.showText?.(`🎁 任务奖励\n${rewardText}`, 2500);
            }
            this._applyRewards(quest);

            // ★ 播完成剧情（用 try/finally 保证关闭）
            try {
                if (quest.completeScript || quest.story) {
                    await this._playComplete(quest);
                }
            } catch (e) {
                console.error('[MapQuest] 播放完成剧情失败:', e);
            } finally {
                // ★ 强制关闭 VN 层
                window.VisualNovelManager?.hide?.();
                window.VisualNovelManager?.close?.();
                window.VisualNovelManager?._hideLayer?.();
            }

            this._writeDigest(quest);

            window.UIManager?.showText?.(`✅ 任务完成：${quest.title}`, 2500);

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            if (window.SaveManager) window.SaveManager.save();
        },

        async _activateNextQuest(nextId) {
            const ws = window.CinemaWorld?.worldState;
            const next = ws?.quests?.[nextId];

            if (!next) {
                console.warn('[MapQuest] 后续任务不存在:', nextId);
                return;
            }
            if (next.status !== 'pending') {
                console.log('[MapQuest] 后续任务状态不是 pending，跳过:', nextId, next.status);
                return;
            }

            next.status = 'active';

            const map = window.MapLauncher?.getMap?.();
            if (map && map.name === next.mapName) {
                this._spawnQuestEntities(next, map);
            }

            window.UIManager?.showText?.(
                `📜 新任务：${next.title}\n${next.description}`,
                3000
            );

            if (next.story) {
                this._playIntro(next);
            }

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            if (window.SaveManager) window.SaveManager.save();

            console.log('[MapQuest] 后续任务已激活:', next.title);
        },

        _applyRewards(quest) {
            const player = window.PlayerStateManager?.player;
            if (!player) return;

            // ---------- 1. 物品奖励 ----------
            if (quest.itemRewards?.length) {
                player.inventory = player.inventory || [];
                for (const r of quest.itemRewards) {
                    const existing = player.inventory.find(i => i.name === r.name);
                    if (existing && r.stackable) {
                        existing.count = (existing.count || 1) + (r.count || 1);
                    } else {
                        player.inventory.push({
                            name: r.name,
                            count: r.count || 1,
                            icon: r.icon || '📦',
                            description: r.description || '',
                            fields: { ...(r.fields || {}) },
                            interactions: [...(r.interactions || [])],
                            status: r.status || '',
                            effect: r.effect || '',
                            stackable: r.stackable === true,
                            maxStack: r.maxStack || null,
                            type: r.type || 'item',
                        });
                    }
                }
            }

            // ---------- 2. 数值奖励 ----------
            if (quest.numberRewards?.length) {
                for (const r of quest.numberRewards) {
                    this._applyNumberReward(r.key, r.delta);
                }
            }

            window.PlayerStateManager?.refreshAvatarArea?.();
        },
        // ★ 应用一条数值奖励
        _applyNumberReward(logicalKey, delta) {
            const player = window.PlayerStateManager?.player;
            if (!player) return;

            const resolved = this._resolveRewardKey(logicalKey);

            // ---------- 1. 命中 statusBar ----------
            if (resolved?.scope === 'statusBar') {
                const bar = resolved.ref;
                const before = bar.current;
                bar.current = Math.max(0, Math.min(bar.max, bar.current + delta));
                console.log(`[MapQuest] 数值奖励 ${logicalKey}(${bar.key}) ${before}→${bar.current}`);
                window.PlayerStateManager.refreshAvatarArea();
                return;
            }

            // ---------- 2. 命中 attribute ----------
            if (resolved?.scope === 'attribute') {
                const attr = player.attributes[resolved.key];
                if (typeof attr === 'object') {
                    const before = Number(attr.value) || 0;
                    attr.value = before + delta;
                    console.log(`[MapQuest] 数值奖励 ${logicalKey}(${resolved.key}) ${before}→${attr.value}`);
                } else {
                    const before = Number(attr) || 0;
                    player.attributes[resolved.key] = before + delta;
                }
                window.PlayerStateManager.refreshAvatarArea();
                return;
            }

            // ---------- 3. 命中 derived ----------
            if (resolved?.scope === 'derived') {
                const d = player.derivedStats.computed[resolved.key];
                if (d) {
                    const before = d.current;
                    d.current = (d.current || 0) + delta;
                    console.log(`[MapQuest] 数值奖励 ${logicalKey}(${resolved.key}) ${before}→${d.current}`);
                }
                window.PlayerStateManager.refreshAvatarArea();
                return;
            }

            // ---------- 4. 命中 extraStats ----------
            if (resolved?.scope === 'extra') {
                this._addToExtraStats(resolved.key, delta);
                return;
            }

            // ---------- 5. 没找到 → 新建到 extraStats ----------
            // ★ 归一化显示名：经验 → 经验，金钱 → 金钱
            const displayKey = this._normalizeRewardDisplayName(logicalKey);
            this._addToExtraStats(displayKey, delta);
        },

        // ★ 写 extraStats（支持 "12" / "12金币" / "12/100" 三种格式）
        _addToExtraStats(key, delta) {
            const player = window.PlayerStateManager?.player;
            if (!player) return;

            player.extraStats = player.extraStats || { _order: [], _raw: '' };
            const extra = player.extraStats;

            if (extra[key] === undefined) {
                extra._order = extra._order || [];
                if (!extra._order.includes(key)) extra._order.push(key);
                extra[key] = String(delta);
                console.log(`[MapQuest] 数值奖励 新建 ${key} = ${delta}`);
                window.PlayerStateManager.refreshAvatarArea();
                return;
            }

            const raw = String(extra[key]);

            // 带单位的：12金币 / 12 元
            const unitMatch = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
            if (unitMatch && unitMatch[2]) {
                const cur = parseFloat(unitMatch[1]);
                const unit = unitMatch[2];
                extra[key] = `${cur + delta}${unit}`;
                console.log(`[MapQuest] 数值奖励 ${key} ${cur}→${cur + delta}${unit}`);
                window.PlayerStateManager.refreshAvatarArea();
                return;
            }

            // 纯数字
            const num = parseFloat(raw);
            if (!isNaN(num)) {
                extra[key] = String(num + delta);
                console.log(`[MapQuest] 数值奖励 ${key} ${num}→${num + delta}`);
                window.PlayerStateManager.refreshAvatarArea();
                return;
            }

            // 兜底：改成新值
            extra[key] = String(delta);
            window.PlayerStateManager.refreshAvatarArea();
        },

        // ★ 归一化显示名
        _normalizeRewardDisplayName(logicalKey) {
            const s = String(logicalKey || '').trim()
                .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
                .trim()
                .toLowerCase();

            if (/经验|exp|experience/.test(s)) return '经验';
            if (/金钱|金币|货币|钱|银两|铜钱|元|信用点|声望/.test(s)) return '金钱';
            return logicalKey;
        },
        // ============================================================
        // 9. 摘要
        // ============================================================
        _writeDigest(quest) {
            const map = window.MapLauncher?.getMap?.();
            const region = map?.regions?.find(r => r.id === quest.regionId);
            const chapterId = window.StoryManager?.currentChapter?.id || null;

            const summary = quest.summary || `完成任务【${quest.title}】`;

            if (window.InteractionHistoryManager) {
                window.InteractionHistoryManager.add({
                    type: 'quest',
                    target: quest.title,
                    targetMeta: { questId: quest.id, questType: quest.progressType },
                    scene: region?.name || '(地图)',
                    playerInput: quest.description,
                    script: quest.story || '',
                    effect: this._formatRewards(quest),
                    summary,
                    chapterId,
                });
            }

            if (window.InteractionDigestManager) {
                window.InteractionDigestManager.add({
                    targetType: 'item',
                    target: quest.title,
                    source: 'quest',
                    summary,
                    chapterId,
                });
            }
        },
        _hashName(name) {
            let h = 0;
            const s = String(name || '');
            for (let i = 0; i < s.length; i++) {
                h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            }
            return Math.abs(h).toString(36);
        },
        _formatRewards(quest) {
            if (!quest) return '';
            const parts = [];

            if (quest.itemRewards?.length) {
                for (const r of quest.itemRewards) {
                    parts.push(`${r.icon || '📦'} ${r.name} ×${r.count || 1}`);
                }
            }

            if (quest.numberRewards?.length) {
                for (const r of quest.numberRewards) {
                    const resolved = this._resolveRewardKey(r.key);
                    let displayKey;
                    if (resolved?.scope === 'statusBar') displayKey = resolved.ref.key;
                    else if (resolved?.scope === 'attribute' || resolved?.scope === 'derived' || resolved?.scope === 'extra') {
                        displayKey = resolved.key;
                    } else {
                        displayKey = this._normalizeRewardDisplayName(r.key);
                    }
                    parts.push(`${displayKey} +${r.delta}`);
                }
            }

            return parts.join('，');
        },

        // ============================================================
        // 10. 剧情播放
        // ============================================================
        async _playIntro(quest) {
            if (!quest) return;

            if (quest.script) {
                const normalized = this._normalizeScript(quest.script);
                const dialogues = window.VisualNovelManager.parseScript(normalized);

                if (dialogues.length > 0) {
                    try {
                        await window.VisualNovelManager.play(dialogues);
                        return;
                    } catch (e) {
                        console.warn('[MapQuest] VN 播放失败，降级:', e);
                    }
                }
                console.warn('[MapQuest] parseScript 返回空，原始 script:', quest.script);
            }

            if (quest.story) {
                await window.UIManager?.showText?.(
                    `📜 ${quest.title}\n\n${quest.story}`,
                    3000
                );
            }
        },

        async _playComplete(quest) {
            if (!quest) return;

            if (quest.completeScript) {
                const normalized = this._normalizeScript(quest.completeScript);
                const dialogues = window.VisualNovelManager.parseScript(normalized);

                if (dialogues.length > 0) {
                    try {
                        await window.VisualNovelManager.play(dialogues);
                        return;
                    } catch (e) {
                        console.warn('[MapQuest] 完成 VN 播放失败，降级:', e);
                    } finally {
                        // ★ 强制关闭 VN 层
                        window.VisualNovelManager?.hide?.();
                        window.VisualNovelManager?.close?.();
                    }
                }
            }

            const text = quest.summary || quest.story;
            if (text) {
                await window.UIManager?.showText?.(
                    `✅ ${quest.title}\n\n${text}`,
                    3000
                );
            }
        },

        _normalizeScript(raw) {
            if (!raw) return '';
            let s = String(raw);

            // 字面转义 → 真字符
            s = s.replace(/\\\\n/g, '\n').replace(/\\n/g, '\n');
            s = s.replace(/\\r/g, '').replace(/\\t/g, ' ');

            // 逐行 trim
            s = s.split('\n').map(l => l.trim()).join('\n');
            s = s.replace(/\n{3,}/g, '\n\n');

            // 保险丝：整段一行 → 拆开
            if (!s.includes('\n') && /【[^】]+】\s*[:：]/.test(s)) {
                s = s.replace(/([^\n])\s*【/g, '$1\n【');
            }

            // 旁白补全
            s = s.split('\n').map(line => {
                const m = line.match(/^【旁白】\s*[:：]\s*(.*)$/);
                if (m) return `【旁白|显示|中|-|-】: ${m[1]}`;
                return line;
            }).join('\n');

            return s.trim();
        },

        // ============================================================
        // 11. 上下文打包
        // ============================================================
        getActiveQuestsText(mapName = null) {
            const ws = window.CinemaWorld?.worldState;
            if (!ws?.quests) return '';

            const quests = Object.values(ws.quests)
                .filter(q => q.status === 'active')
                .filter(q => !mapName || q.mapName === mapName)
                .slice(0, this._maxActiveInContext);

            if (quests.length === 0) return '';

            const lines = quests.map(q => {
                const need = q.target.count || 1;
                const progress = q.progressType === 'explore' ? '' : `（${q.current}/${need}）`;
                return `- ${q.title}${progress}：${q.description}`;
            });

            return `【进行中的任务】\n${lines.join('\n')}`;
        },

        // ============================================================
        // 12. UI
        // ============================================================
        openQuestList() {
            const ws = window.CinemaWorld?.worldState;
            const quests = Object.values(ws?.quests || {});

            if (quests.length === 0) {
                window.UIManager?.showText?.('暂无任务', 1500);
                return;
            }

            const active = quests.filter(q => q.status === 'active');
            const pending = quests.filter(q => q.status === 'pending');
            const done = quests.filter(q => q.status === 'completed');

            let html = `
                <div style="font-size:20px;font-weight:bold;margin-bottom:16px;">
                    📜 任务列表
                </div>
                <div style="font-size:12px;color:#888;margin-bottom:14px;text-align:center;">
                    进行中 ${active.length} · 待解锁 ${pending.length} · 已完成 ${done.length}
                </div>
                <div style="display:grid;gap:10px;max-height:60vh;overflow-y:auto;">
            `;

            for (const q of active) {
                html += this._renderQuestItem(q, 'active');
            }
            for (const q of pending) {
                html += this._renderQuestItem(q, 'pending');
            }
            for (const q of done) {
                html += this._renderQuestItem(q, 'done');
            }

            html += `</div>
                <div style="text-align:center;margin-top:18px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;

            const modal = document.getElementById('cinemaworld-modal');
            if (modal) {
                modal.className = 'active';
                modal.innerHTML = html;
            }
        },
        openQuestDetail(questId) {
            const q = this.getQuest(questId);
            if (!q) {
                window.UIManager?.showText?.('任务不存在', 1500);
                return;
            }

            const map = window.MapLauncher?.getMap?.();
            const region = map?.regions?.find(r => r.id === q.regionId);

            const statusText = {
                active: '进行中',
                offered: '可接取',
                pending: '待解锁',
                completed: '已完成',
            }[q.status] || q.status;

            const rewardsText = this._formatRewards(q) || '无';

            const modal = document.getElementById('cinemaworld-modal');
            if (!modal) return;

            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">${q.emoji} ${q.title}</div>
                <div style="font-size:13px;color:#aaa;line-height:1.7;margin-bottom:14px;
                    padding:12px;background:rgba(0,0,0,.2);border-radius:10px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                        <span style="color:#888;">状态</span>
                        <span>${statusText}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                        <span style="color:#888;">地点</span>
                        <span>${region?.name || '未知'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                        <span style="color:#888;">进度</span>
                        <span>${q.current}/${q.target.count || 1}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:#888;">奖励</span>
                        <span style="color:#ffd76b;">${rewardsText}</span>
                    </div>
                </div>
                ${q.description ? `
                    <div style="font-size:13px;color:#ccc;line-height:1.7;margin-bottom:14px;">
                        ${q.description}
                    </div>
                ` : ''}
                ${q.story ? `
                    <div style="font-size:12px;color:#888;line-height:1.6;padding:10px;
                        background:rgba(120,150,255,.06);border-radius:8px;margin-bottom:14px;">
                        ${q.story}
                    </div>
                ` : ''}
                <div style="text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" onclick="MapQuestManager._returnToMarker('${q.id}')">← 返回实体</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>
            `;
        },
        // map-quest.js 里，或者 SaveManager.apply 之后
        _migrateOldQuests() {
            const ws = window.CinemaWorld?.worldState;
            if (!ws?.quests) return;

            for (const q of Object.values(ws.quests)) {
                if (q.itemRewards || q.numberRewards) continue;   // 新格式，跳过
                if (!q.rewards?.length) continue;

                q.itemRewards = [];
                q.numberRewards = [];

                for (const r of q.rewards) {
                    if (r.type === 'item') {
                        q.itemRewards.push({
                            name: r.name,
                            count: r.count,
                            icon: '📦',
                            description: '',
                            fields: {},
                            type: 'item',
                        });
                    } else if (r.type === 'exp') {
                        q.numberRewards.push({
                            key: '经验',
                            delta: r.value,
                        });
                    }
                }

                delete q.rewards;
            }
        },
        _returnToMarker(questId) {
            const q = this.getQuest(questId);
            if (!q) { UIManager.closeModal(); return; }

            const map = window.MapLauncher?.getMap?.();
            if (!map) { UIManager.closeModal(); return; }

            // 找对应 marker
            const marker = map.entities.find(e =>
                e.meta?.questId === questId && e.kind === 'marker'
            );
            if (marker) {
                window.MapEntityPanel?.openDetail?.(marker.id);
                return;
            }

            // 或者找对应 item / encounter
            const anyEnt = map.entities.find(e => e.meta?.questId === questId);
            if (anyEnt) {
                window.MapEntityPanel?.openDetail?.(anyEnt.id);
                return;
            }

            UIManager.closeModal();
        },
        _renderQuestItem(q, status) {
            const need = q.target.count || 1;
            const pct = Math.min(100, (q.current / need) * 100);
            const statusColor = status === 'done' ? '#7dd87d' : '#7da8ff';
            const opacity = status === 'done' ? '0.6' : status === 'pending' ? '0.5' : '1';
            const badge = status === 'done'
                ? '<span style="color:#7dd87d;font-size:11px;margin-left:6px;">✓ 已完成</span>'
                : status === 'pending'
                    ? '<span style="color:#888;font-size:11px;margin-left:6px;">🔒 待解锁</span>'
                    : '';

            // ★ 奖励文本
            const rewardText = this._formatRewards(q);

            return `
                <div style="padding:12px 16px;background:rgba(255,255,255,.04);
                    border:1px solid rgba(255,255,255,.08);border-radius:10px;
                    opacity:${opacity};">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                        <div style="font-size:24px;">${q.emoji}</div>
                        <div style="flex:1;">
                            <div style="font-size:14px;color:#fff;font-weight:600;">
                                ${q.title}${badge}
                            </div>
                            <div style="font-size:12px;color:#888;margin-top:2px;">
                                ${q.description}
                            </div>
                        </div>
                    </div>
                    ${status === 'active' && q.progressType !== 'explore' ? `
                        <div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;">
                            <div style="width:${pct}%;height:100%;background:${statusColor};"></div>
                        </div>
                        <div style="font-size:11px;color:#666;margin-top:4px;text-align:right;">
                            ${q.current}/${need}
                        </div>
                    ` : ''}
                    ${rewardText ? `
                        <div style="font-size:11px;color:#ffd76b;margin-top:6px;">
                            🎁 ${rewardText}
                        </div>
                    ` : ''}
                </div>`;
        },

        // ============================================================
        // 13. 查询接口
        // ============================================================
        getQuest(id) {
            return window.CinemaWorld?.worldState?.quests?.[id] || null;
        },

        isQuestCompleted(id) {
            const q = this.getQuest(id);
            return q?.status === 'completed';
        },

        areQuestsCompleted(ids) {
            if (!Array.isArray(ids)) return true;
            return ids.every(id => this.isQuestCompleted(id));
        },
        // ============================================================
        // 14. 清空所有任务
        // ============================================================
        clearAllQuests() {
            const ws = window.CinemaWorld?.worldState;
            if (!ws) return;

            const count = Object.keys(ws.quests || {}).length;
            if (count === 0) {
                window.UIManager?.showText?.('没有任务可清空', 1500);
                return;
            }

            ws.quests = {};
            ws._mapQuestGenerated = {};   // ★ 同时清掉"已生成"标记

            // 清掉地图上的任务实体
            const map = window.MapLauncher?.getMap?.();
            if (map) {
                map.entities = map.entities.filter(e =>
                    !(e.meta?.questId)
                );
            }

            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            if (window.SaveManager) window.SaveManager.save();

            window.UIManager?.showText?.(`已清空 ${count} 个任务`, 2000);
            console.log('[MapQuest] 已清空所有任务');
        },
    };

    window.MapQuestManager = MapQuestManager;
    console.log('[CinemaWorld] map-quest.js 已加载');
})();