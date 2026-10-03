// ============================================================
// CinemaWorld · map-gen.js
// 自然语言 → AI 生成地图规则（文本）→ 解析 → 校验
// 依赖：core.js, ui.js, map-schema.js, map-parser.js
// 暴露：window.MapGenerator
// ============================================================

(function () {
    'use strict';

    const MapGenerator = {
        isGenerating: false,
        _lastRaw: '',

        async generate(options = {}) {
            if (this.isGenerating) {
                console.log('[MapGen] 正在生成中');
                return null;
            }
            this.isGenerating = true;

            try {
                const ctx = this._buildContext(options);
                const prompt = this._buildPrompt(ctx);

                console.log('[MapGen] 开始生成地图规则...');
                const raw = await window.generateFunctionalReply(prompt, 'map-generation');
                if (!raw) {
                    console.error('[MapGen] AI 返回为空');
                    return null;
                }
                this._lastRaw = raw;

                const parsed = window.MapParser.parse(raw);
                if (!parsed) {
                    console.error('[MapGen] 文本解析失败');
                    return null;
                }

                const normalized = window.MapSchema.normalize(parsed);
                const check = window.MapSchema.validate(normalized);

                console.log('[MapGen] 生成完成:', {
                    regions: normalized.regions.length,
                    connections: normalized.connections.length,
                    entities: normalized.entities.length,
                    items: normalized.entities.filter(e => e.kind === 'item').length,
                    pickable: normalized.entities.filter(e =>
                        String(e.fields?.['可拾取'] || '') === '是'
                    ).length,
                    errors: check.errors,
                    warnings: check.warnings,
                });

                normalized._check = check;
                normalized._rawText = raw;

                return normalized;

            } catch (e) {
                console.error('[MapGen] 生成失败:', e);
                return null;
            } finally {
                this.isGenerating = false;
            }
        },

        _buildContext(options) {
            const scene = window.LocationModalManager?.currentLocation;
            const worldState = window.CinemaWorld?.worldState || {};
        
            const parts = [];
        
            if (worldState.worldHistory?.summary) {
                parts.push(`【世界史】${worldState.worldHistory.summary}`);
            }
        
            // ★ 判断是否初次生成地图
            const existingMaps = Object.keys(worldState.maps || {});
            const isFirstMap = existingMaps.length === 0;
        
            if (scene) {
                if (isFirstMap) {
                    // ★ 初次生成：完整注入场景信息 + 承接提示
                    let sceneBlock = `【当前场景】\n名称: ${scene.name}`;
                    if (scene.description) sceneBlock += `\n描述: ${scene.description}`;
                    if (scene.environment) sceneBlock += `\n环境: ${scene.environment}`;
        
                    if (scene.sceneCharacters?.length) {
                        sceneBlock += `\n场景人物:\n`;
                        scene.sceneCharacters.forEach(c => {
                            const meta = [c.name];
                            if (c.gender) meta.push(c.gender);
                            if (c.mood) meta.push(c.mood);
                            if (c.favorability) meta.push(`好感度${c.favorability}`);
                            sceneBlock += `  - ${meta.join('，')}`;
                            if (c.description) sceneBlock += `：${c.description}`;
                            sceneBlock += `\n`;
                        });
                    }
        
                    if (scene.sceneItems?.length) {
                        sceneBlock += `\n场景实体:\n`;
                        scene.sceneItems.forEach(i => {
                            sceneBlock += `  - ${i.icon || '📦'} ${i.name}`;
                            if (i.description) sceneBlock += `：${i.description}`;
                            sceneBlock += `\n`;
                        });
                    }
        
                    if (scene.sceneActions?.length) {
                        sceneBlock += `\n场景行动:\n`;
                        scene.sceneActions.forEach(a => {
                            sceneBlock += `  - ${a.icon || '⚡'} ${a.name}`;
                            if (a.hint) sceneBlock += `：${a.hint}`;
                            sceneBlock += `\n`;
                        });
                    }
        
                    sceneBlock += `\n★ 这是玩家现在所在的场景，也是世界的第一张地图。`;
                    sceneBlock += `\n  - 场景名应该作为地图上的一个区域出现`;
                    sceneBlock += `\n  - 场景人物应该出现在地图的对应区域里`;
                    sceneBlock += `\n  - 场景实体应该出现在地图的对应区域里`;
                    sceneBlock += `\n  - 可以创建其他非主要角色的NPC。`;
        
                    parts.push(sceneBlock);
                } else {
                    // ★ 后续生成：只注入场景名和描述，不做承接
                    parts.push(`【当前场景】${scene.name}`);
                    if (scene.description) parts.push(`描述：${scene.description}`);
                    if (scene.environment) parts.push(`环境：${scene.environment}`);
                }
            }
        
            if (options.sceneName) parts.push(`【目标场景】${options.sceneName}`);
            if (options.sceneDesc) parts.push(`【场景描述】${options.sceneDesc}`);
            if (options.guide) parts.push(`【玩家要求】${options.guide}`);
            if (options.centerRegion) parts.push(`【中心区域】${options.centerRegion}`);
        
            const existing = (window.WorldManager?.getLocations?.() || []).map(s => s.name);
            if (existing.length > 0) {
                parts.push(`【已存在的场景】（避免重名）\n${existing.join('、')}`);
            }
        
            const mapNames = existingMaps;
            if (mapNames.length > 0) {
                parts.push(`【已存在的世界地图】（不要重复生成这些）\n${mapNames.join('、')}`);
            }
        
            if (options.bindScenes && options.bindScenes.length > 0) {
                parts.push(`【可绑定的场景】\n${options.bindScenes.join('、')}`);
            }
        
            return parts.join('\n\n');
        },

        _buildPrompt(ctx) {

            const playerBlock = PlayerStateManager.formatForPrompt();
        
            const worldCtx = StoryManager.buildContext(null, {
                parentStory: false, mainChars: true, scene: false, pendingEvents: false,
                digestFilter: {
                    sceneActions: false,
                    characters: false,
                    inventoryItems: false,
                },
                volumes: true, chapters: true,
            });
        
            return `你是一个"地图规则生成器"。你不画地图，你只输出结构化的地图规则文本。
程序会根据你的文本生成实际的网格地图、道路和实体摆放。

【世界历史】
${worldCtx}

${playerBlock}

${ctx}

【任务】
根据上下文，生成一个"区域图"。描述：
- 有哪些建筑模板（大建筑表）
- 有哪些区域（区域 = 一个可进入的小地点）
- 每个区域里有哪些建筑、装饰、地形
- 区域之间怎么连接
- 每个区域里有哪些实体（NPC / 物品 / 装备 / 标记 / 遭遇 / 出入口）
- 玩家从哪个区域开始

════════════════════════════════════════
【输出格式】（严格遵守）
════════════════════════════════════════
★ 段标题必须用【xxx】，不要改成其他写法。
★ 子段标题（NPC: / 物品: / 装备: / 出入口:）必须原样照抄。
★ 每行以 - 开头。
★ 方括号内用 | 分隔，键:值 格式。

【地图】
名称: 地图名
描述: 一句话描述
起点: 起点区域的id
🖼️ 背景: 背景图片名
🎵 音乐: 背景音乐名

【大建筑表】
★ 尺寸 2x2 ~ 6x6，不允许 1x1。
★ 定义"模板"，区域通过 [大建筑:民居×8] 引用。
★ 简单地图可以不写这一段，程序内置民居、商铺、市政厅等。

格式：
- 【id|名称|emoji|尺寸】：描述，[外墙:X|屋顶:Y|门:Z|门向:south|可进入:是/否|连接:Y]

示例：
- 【house|民居|🏠|2x2】：普通住宅，[外墙:砖墙|屋顶:红瓦|门:木门]
- 【shop|商铺|🏪|3x3】：小店，[外墙:木墙|屋顶:平顶|门:玻璃门|可进入:是|连接:商店内部]
- 【temple|神殿|⛩️|5x5】：古寺，[外墙:石墙|屋顶:尖顶|门:拱门|可进入:是]
- 【tower|高楼|🏢|6x6】：摩天楼，[外墙:玻璃幕墙|屋顶:现代顶|门:自动门]

【可用外墙】砖墙 / 石墙 / 水泥墙 / 木墙 / 白墙 / 玻璃幕墙 / 铁皮墙 / 瓷砖墙
【可用屋顶】红瓦 / 灰瓦 / 平顶 / 尖顶 / 玻璃顶 / 铁皮顶 / 茅草顶 / 现代顶
【可用门】木门 / 玻璃门 / 铁门 / 卷帘门 / 旋转门 / 自动门 / 双开门 / 拱门

【区域】
格式：
- 【id|名称|类型|尺寸|地形】：描述，[地形:甲、乙|装饰:丙、丁|迷你建筑:戊、己|大建筑:庚×N]

说明：
- 类型：自由描述（village / forest / ruins / market / temple / ...）
- 尺寸：tiny / small / medium / large / huge
- 地形：主要地面（可写多个，程序混合铺）
- 装饰：自然/散落装饰（树、花草、石头……）
- 迷你建筑：1×1 的小型设施（摊位、水井、信箱、路灯……）
- 大建筑：引用【大建筑表】的名字，可带 ×N 数量
- 方括号内四个字段全部可选
- 用你能想到的、最贴切的中文词

示例：
- 【village|村庄|village|medium|泥土】：宁静的村庄，[地形:泥土、草地|装饰:树、野花|迷你建筑:水井、信箱|大建筑:民居×8、商铺×2]
- 【forest|森林|forest|large|草地】：幽深的森林，[地形:草地、苔藓|装饰:枯树、藤蔓|迷你建筑:小祠|大建筑:无]
- 【market|集市|market|medium|石板】：热闹的集市，[地形:石板、泥土|装饰:树|迷你建筑:摊位、水井|大建筑:商铺×5]

【连接】
格式：
- 【from_id|to_id|方向|距离|种类】

字段：
- 方向：north / south / east / west / any
- 距离：near / medium / far
- 种类：road / path / door / portal

示例：
- 【village|forest|east|near|road】
- 【village|market|west|medium|path】

【实体】
NPC:
- 【id:xxx|name:xxx|emoji:xxx|kind:npc|region:区域id|pos:锚点名|blocking:yes|gender:男/女|mood:平静】：描述，[标签1、标签2]

decor:
- 【id:xxx|name:xxx|emoji:xxx|kind:decor|region:区域id|pos:锚点名|blocking:no|gender:-|mood:-】：描述，[标签1、标签2]

marker:
- 【id:xxx|name:xxx|emoji:xxx|kind:marker|region:区域id|pos:锚点名|blocking:no|gender:-|mood:-】：描述，[标签1]

encounter:
- 【id:xxx|name:xxx|emoji:xxx|kind:encounter|region:区域id|pos:锚点名|blocking:yes|gender:-|mood:-】：描述，[类型:遭遇|HP:50/50|攻击:9|防御:3|敏捷:4|技能:抓咬、拥挤|掉落:破衣物、零钱|数量:6]

示例：
- 【id:guard|name:守卫|emoji:💂|kind:npc|region:plaza|pos:fountain|blocking:yes|gender:男|mood:警惕】：站在喷泉旁的卫兵，[守卫、忠诚]
- 【id:notice|name:告示板|emoji:📜|kind:decor|region:plaza|pos:west|blocking:no|gender:-|mood:-】：广场西侧的木告示板，[装饰、信息]
- 【id:quest|name:任务点|emoji:❗|kind:marker|region:plaza|pos:east|blocking:no|gender:-|mood:-】：任务目标标记，[标记]
- 【id:zombie|name:街垒尸群|emoji:🧟|kind:encounter|region:checkpoint|pos:center|blocking:yes|gender:-|mood:-】：一群丧尸，[类型:遭遇|HP:50/50|攻击:9|数量:6]

★ 数量：只有 encounter 和群体 npc 写 数量:N。

物品:
- 【物品名|图标】：描述，[类型:物品类型|可拾取:是|区域:区域id|位置:锚点名|功能:一句话介绍|交互方式|效果:效果DSL|可堆叠:是|最大堆叠:N|货币种类:X|卖价:X]

装备:
- 【装备名|图标】：描述，[类型:武器/护甲/饰品/工具|可拾取:是|区域:区域id|位置:锚点名|货币种类:金钱|买价:X|卖价:X|属性:X|属性:Y]

示例：
- 【生锈的铁剑|⚔️】：斜靠在墙角，[类型:武器|可拾取:是|区域:plaza|位置:west|货币种类:金钱|买价:X|卖价:X|攻击:+X]
- 【红药水|🧪】：一瓶红色药剂，[类型:消耗品|可拾取:是|区域:tavern|位置:bar|功能:回复生命|效果:回复生命 X|可堆叠:是|货币种类:金钱|买价:X|卖价:X|最大堆叠:X]
- 【野花|🌸】：路边的小花，[类型:材料|可拾取:是|区域:forest|位置:edge|可堆叠:是|货币种类:金钱|买价:X|卖价:X|最大堆叠:X]
- 【守卫的盾牌|🛡️】：靠在门边的圆盾，[类型:护甲|可拾取:是|区域:plaza|位置:north|货币种类:金钱|买价:X|卖价:X|防御:+X|体力:+Y]

★ 物品必须包含 可拾取 / 区域 / 位置 三个字段。
★ 能拿走的写 可拾取:是，固定装置写 可拾取:否。
★ 每个物品必须写"效果"字段（供快捷使用系统消费），格式：

效果DSL:<动作><目标> <值>[; <动作><目标> <值>...]

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

★ "功能"是给人看的介绍，模糊、简短，不带具体数字：
- 恢复生命 / 回复体力 / 解除中毒 / 增加攻击 / 提供照明

出入口:
- 【id|名称|emoji|portal|区域id|锚点名|no|-|-】：描述，[目标类型:map/region|目标:Y|目标区域:Z|方向:both|提示:...]

示例：
- 【gate_north|北门|🚪|portal|plaza|north|no|-|-】：通往城外的门，[目标类型:map|目标:野外|目标区域:road|方向:both|提示:走出城门]
- 【shortcut|近道|🛤️|portal|plaza|east|no|-|-】：穿过小巷，[目标类型:region|目标:market|方向:both|提示:抄近道]

★ 每张地图至少 1 个通向其他地图的出入口（目标类型:map）。

════════════════════════════════════════
【可选值】
════════════════════════════════════════
区域类型：自由描述，参考 town / village / plaza / market / tavern / temple / forest / ruins / cave / camp / dungeon / road / field / mountain / lake / beach
区域尺寸：tiny / small / medium / large / huge
地形：自由描述，参考 草地 / 泥土 / 石板 / 木地板 / 沙地 / 岩石 / 苔藓 / 水 / 岩浆 / 雪地
连接方向：north / south / east / west / any
连接距离：near / medium / far
连接种类：road / path / door / portal
锚点名：center / north / south / east / west / entrance / corner / bar / counter / shelf / altar / fountain / clearing / fire / tent / start / end / deep / boss / edge

════════════════════════════════════════
【硬性规则】
════════════════════════════════════════
1. 区域数量 4-10 个
2. 起点区域必须在区域列表里
3. 连接必须让所有区域可达（从起点出发能走到任何一个区域）
4. 连接是双向的，只写一次（A→B 就够）
5. 大建筑表 0-10 个（简单地图可以不写）
6. NPC / decor / marker / encounter 共 3-10 个
7. 物品 / 装备 共 3-8 个
8. 每个区域至少有一个物品或 NPC
9. 玩家实体不写（程序自动生成）
10. 每个地图至少 1 个出入口，大地图 4-8 个
11. 出入口分布在不同的区域
12. 区域里写大建筑时，名字必须和【大建筑表】里的名字一致

【重要：不要生成返回原地图的出入口】
如果上下文里说明了"从某地图某区域通过某出入口进入"，
那么你生成的地图里【不要】再包含指回那张地图的出入口，
系统会自动注入返回 portal。你只管生成新地图本身的出入口。

现在请生成：
        `;
        },

        async regenerateWithFeedback(map, options = {}) {
            const check = map._check;
            if (!check) return this.generate(options);

            const feedback = [
                '上次生成的地图有以下问题，请修正后重新生成：',
                check.errors.length ? `【错误】\n${check.errors.map(e => '- ' + e).join('\n')}` : '',
                check.warnings.length ? `【警告】\n${check.warnings.map(w => '- ' + w).join('\n')}` : '',
            ].filter(Boolean).join('\n\n');

            return this.generate({
                ...options,
                guide: (options.guide || '') + '\n\n' + feedback,
            });
        },
    };

    window.MapGenerator = MapGenerator;
    console.log('[CinemaWorld] map-gen.js 已加载');
})();