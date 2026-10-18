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
        
            // ============================================================
            // ★ 场景注入：只在"初次生成地图"时做
            //   后续生成地图时，玩家已经在地图系统里，场景不再相关
            // ============================================================
            if (isFirstMap && scene) {
                // 初次生成地图：把当前场景当"世界第一张地图"
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
            }
            // ★ 后续生成地图：不注入 scene
            //   玩家已经在地图系统里，"当前场景"是过时的信息
        
            // ============================================================
            // 后续生成：注入"当前地图"上下文
            // ============================================================
            const fromMap = options.fromMap;
            const fromDir = options.fromDir;
        
            if (fromMap && !isFirstMap) {
                const fromMapData = worldState.maps?.[fromMap];
                const fromMapDesc = fromMapData?.description || '';
                const fromMapType = fromMapData?.mapType || 'outdoor';
        
                parts.push(
                    `【来源地图】\n` +
                    `名称: ${fromMap}\n` +
                    (fromMapDesc ? `描述: ${fromMapDesc}\n` : '') +
                    `类型: ${fromMapType === 'indoor' ? '室内' : '室外'}`
                );
            }
        
            // ============================================================
            // 其它参数
            // ============================================================
            if (options.sceneName) parts.push(`【目标场景】${options.sceneName}`);
            if (options.sceneDesc) parts.push(`【场景描述】${options.sceneDesc}`);
            if (options.guide) parts.push(`【玩家要求】${options.guide}`);
            if (options.centerRegion) parts.push(`【中心区域】${options.centerRegion}`);
        
            // ★ 已有场景列表（仅初次生成时有意义，后续可以不要）
            if (isFirstMap) {
                const existing = (window.WorldManager?.getLocations?.() || []).map(s => s.name);
                if (existing.length > 0) {
                    parts.push(`【已存在的场景】（避免重名）\n${existing.join('、')}`);
                }
            }
        
            // ★ 已有地图列表
            const mapNames = existingMaps;
            if (mapNames.length > 0) {
                parts.push(`【已存在的世界地图】（不要重复生成这些）\n${mapNames.join('、')}`);
            }
        
            // ★ 空间上下文（已有）
            if (options.fromMap && options.fromDir) {
                const DIR = window.WorldDirection;
                const fromCn = DIR?.cn(options.fromDir) || options.fromDir;
                const entryCn = DIR?.cn(DIR?.opposite(options.fromDir)) || '?';
        
                parts.push(
                    `【空间上下文】\n` +
                    `玩家从【${options.fromMap}】的${fromCn}方向进入。\n` +
                    `★ 这张新地图必须有一个【${entryCn}门】，通向【${options.fromMap}】。\n` +
                    `★ 方向规则：${fromCn} ↔ ${entryCn}（相反方向）。\n` +
                    `★ 【空间】段里，${entryCn} 这一项必须写【${options.fromMap}】，不要写"未知"。`
                );
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
根据上下文，生成一个"地图规则"。描述：
- 这张地图的类型（室外 / 室内）
- 地图在世界中的方向出入口（东南西北 + 斜角）
- 地形与高度
- 建筑风格
- 区域（区域 = 一个可进入的小地点）
- 每个区域里有哪些建筑、装饰、地形
- 区域之间怎么连接
- 每个区域里有哪些实体
- 玩家从哪个区域开始

【总则】（务必先读）
★ 全部用中文。不要写英文 id、不要写拼音、不要写代码。
★ 任何东西都用"名字"作为唯一标记。
★ 如果同名（比如两个"守卫"），程序会自动用"名字@区域"区分，你不用担心。
★ 段标题必须用【xxx】。
★ 每行以 - 开头。
★ 方括号内用 | 分隔，键:值 格式。

【地图】
名称: 地图名
描述: 一句话描述
类型: 室外 或 室内
起点: 起点区域的名字
🖼️ 背景: 背景图片名
🎵 音乐: 背景音乐名

说明：
- 室外 = 开阔、有路、有自然地形（城镇、森林、野外、道路）
- 室内 = 房间、墙壁、走廊、迷宫（建筑内部、洞穴、地牢、遗迹）
- 起点区域的名字必须出现在【区域】段里

【地图风格】
格式：
- 【风格名|氛围词1、氛围词2、氛围词3】

示例：
- 【中式传统|古典、温暖、木石结构】
- 【欧式中世纪|厚重、灰暗、石砌】
- 【现代|简洁、明亮、玻璃钢材】
- 【赛博朋克|霓虹、金属、高对比】
- 【日式传统|素雅、木格、纸门】
- 【工业|粗糙、铁锈、机械】
- 【沙漠|干燥、土黄、风沙】
- 【极地|寒冷、冰蓝、雪白】

可选风格（也可以自创）：
中式传统 / 欧式中世纪 / 现代 / 赛博朋克 / 日式传统 / 工业 / 沙漠 / 极地

说明：
- 地图风格是这张地图所有建筑的默认风格
- 建筑可以在自己的行里覆盖

【空间】
★ 说明这张地图在世界中的方向出入口。
★ 每个方向最多一个出入口。
★ 方向是绝对的：东就是东，北就是北。
★ 相邻地图的方向永远相反：东↔西、北↔南、东北↔西南、东南↔西北。

格式：
方向: 通向地图名 或 未知
...

示例：
【空间】
东: 未知
北: 未知
西: 商业街

或：
【空间】
北: 未知
东北: 未知

说明：
- "未知" = 程序会生成新地图
- 通向已知地图 = 直接连到已有地图（写地图名）
- 如果玩家"从某方向进入"这张地图，反方向的出入口是【必须】的
- 其余方向可以自由添加

【出入口】
★ 每个方向最多一个。可选段：如果【空间】段已经说明了，这里只写名字和描述。

格式：
- 【方向|种类|名字】：描述

方向：东 / 东北 / 南 / 东南 / 西 / 西南 / 北 / 西北
种类：道路 / 小径 / 门 / 传送门 / 阶梯 / 梯子

示例：
- 【东|道路|东门】：通往城外的大路，两侧是低矮的石墙
- 【北|小径|北边小径】：蜿蜒向上的山道，路边有野花
- 【南|阶梯|南侧阶梯】：向下延伸的石阶，能看到远处的灯火

【高度】
★ 只对室外地图有意义，室内地图一般高度为 0。
★ 高度是整数（格数），0 = 地面，1 = 高 1 格，-1 = 坑。
★ 玩家只能走高度差 ≤ 1 的格子。

格式：
名称: 整数
...

示例：
【高度】
基准: 0
山区: 2
河谷: -1
山脚: 1

说明：
- 简单地图可以完全不写这一段，程序默认全 0
- 如果写了，在区域段里用 [高度:名称] 引用

【大建筑表】
★ 尺寸 2x2 ~ 6x6，不允许 1x1。
★ 定义"模板"，区域通过 [大建筑:民居×8] 引用。
★ 简单地图可以不写这一段，程序内置民居、商铺、市政厅等。

格式：
- 【名称|图标|尺寸】：描述，[外墙:X|屋顶:Y|门:Z|门向:南|风格:S|层数:N|可进入:是|连接:内部地图名]

示例：
- 【民居|🏠|2x2】：普通住宅，[外墙:砖墙|屋顶:红瓦|门:木门|风格:中式传统]
- 【商铺|🏪|3x3】：小店，[外墙:木墙|屋顶:平顶|门:玻璃门|风格:现代|可进入:是|连接:商店内部]
- 【神殿|⛩️|5x5】：古寺，[外墙:石墙|屋顶:尖顶|门:拱门|风格:日式传统|可进入:是]
- 【高楼|🏢|6x6】：摩天楼，[外墙:玻璃幕墙|屋顶:现代顶|门:自动门|风格:现代|层数:12]

【可用外墙】
砖墙 / 石墙 / 水泥墙 / 木墙 / 白墙 / 玻璃幕墙 / 铁皮墙 / 瓷砖墙 / 金属板墙 / 岩壁 / 藤蔓墙

【可用屋顶】
红瓦 / 灰瓦 / 平顶 / 尖顶 / 玻璃顶 / 铁皮顶 / 茅草顶 / 现代顶 / 坡顶 / 圆顶 / 尖塔顶

【可用门】
木门 / 玻璃门 / 铁门 / 卷帘门 / 旋转门 / 自动门 / 双开门 / 拱门 / 石门 / 木栅门 / 帘门

【区域】
格式：
- 【名称|类型|尺寸|地形】：描述，[地形:甲、乙|装饰:丙、丁|迷你建筑:戊、己|大建筑:庚×N|高度:xx]

说明：
- 类型：自由描述（村庄 / 森林 / 遗迹 / 集市 / 神殿 / 房间 / 走廊 / 大厅）
- 尺寸：极小 / 小 / 中 / 大 / 巨大
- 地形：主要地面（可写多个，程序混合铺）
- 装饰：自然/散落装饰（树、花草、石头……）
- 迷你建筑：1×1 的小型设施（摊位、水井、信箱、路灯……）
- 大建筑：引用【大建筑表】的名字，可带 ×N 数量
- 高度：引用【高度】段的名称，不写则用基准
- 方括号内字段全部可选

室外示例：
- 【村庄|村庄|中|泥土】：宁静的村庄，[地形:泥土、草地|装饰:橡树、野花|迷你建筑:水井、信箱|大建筑:民居×8、商铺×2|高度:山脚]
- 【森林|森林|大|草地】：幽深的森林，[地形:草地、苔藓|装饰:桦树、藤蔓|迷你建筑:小祠|高度:山区]

室内示例：
- 【正厅|大厅|小|木地板】：宽敞的大厅，[地形:木地板|装饰:地毯]
- 【走廊|走廊|极小|瓷砖】：长长的走廊，[地形:瓷砖]
- 【卧室|房间|小|木地板】：简朴的卧室，[地形:木地板|迷你建筑:床、柜子]

【连接】
格式：
- 【起点区域|终点区域|方向|距离|种类】

字段：
- 方向：东 / 南 / 西 / 北 / 任意
- 距离：近 / 中 / 远
- 种类：道路 / 小径 / 门 / 传送门

示例：
- 【村庄|森林|东|近|道路】
- 【村庄|集市|西|中|小径】
- 【正厅|走廊|南|近|门】

【物品表】
★ 这张地图里所有物品/装备的定义池。
★ 敌人掉落、地图摆放、未来采集，都从这里查。
★ 不写位置，只写物品本身。

格式：
- 【物品名|图标】：描述，[类型:xxx|可拾取:是|效果:效果DSL|可堆叠:是|最大堆叠:N|货币种类:X|买价:X|卖价:X]
- 【装备名|图标】：描述，[类型:武器/护甲/饰品/工具|可拾取:是|属性:X|属性:Y|货币种类:X|买价:X|卖价:X]

效果DSL：<动作><目标> <值>[; <动作><目标> <值>...]

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

示例：
- 【红药水|🧪】：一瓶红色药剂，[类型:消耗品|可拾取:是|功能:回复生命|效果:回复生命 X|可堆叠:是|最大堆叠:X|货币种类:金钱|买价:X|卖价:X]
- 【生锈的铁剑|⚔️】：斜靠在墙角的旧剑，[类型:武器|可拾取:是|攻击:+X|货币种类:金钱|买价:X|卖价:X]
- 【兽皮|🟫】：一块厚实的狼皮，[类型:材料|可拾取:是|可堆叠:是|最大堆叠:X|货币种类:金钱|买价:X|卖价:X]

【实体】
★ 引用格式：所有实体用【名字|图标|类型|区域|锚点|阻挡|性别|心情|主次】的位置化格式。

NPC:
- 【守卫|💂|npc|广场|喷泉|阻挡|男|警惕|路人】：站在喷泉旁的卫兵，[守卫、忠诚]

装饰:
- 【告示板|📜|装饰|广场|西|不阻挡|-|-|-】：广场西侧的木告示板，[装饰、信息]

标记:
- 【任务点|❗|标记|广场|东|不阻挡|-|-|-】：任务目标标记，[标记]

遭遇:
- 【街垒尸群|🧟|遭遇|检查站|中央|阻挡|-|-|-】：一群丧尸，[类型:遭遇|HP:50/50|攻击:9|防御:3|攻击方式:近战|攻击距离:1|攻击间隔:1500|掉落:红药水|金钱:5|经验:3|数量:6]

物品:
- 【红药水|酒馆|吧台】：1

装备:
- 【生锈的铁剑|⚔️】：描述，[类型:武器|可拾取:是|区域:广场|位置:西|货币种类:金钱|买价:X|卖价:X|攻击:+X|暴击:+Y%]

资源点:
- 【名字|图标|资源点|区域|锚点】：描述，[类型:采集|消耗:体力×3|产出:物品表中的物品×Y|概率:物品表中的物品×Y:5%|次数:3|刷新:24小时|交互名:交互名|交互图标:🖐️]

示例：
- 【老苹果树|🍎|资源点|村庄|北】：村口的老树，[类型:采集|消耗:体力×3|产出:苹果×1|概率:金苹果×1:5%|次数:3|刷新:24小时|交互名:采摘]
- 【渔点|🎣|资源点|河边|西】：水波荡漾的浅滩，[类型:采集|消耗:体力×2|消耗:鱼饵×1|产出:鲫鱼×1|概率:鲤鱼×1:20%|次数:5|刷新:6小时|交互名:垂钓]
- 【矿脉|⛏️|资源点|山洞|深处】：闪光的岩壁，[类型:采集|消耗:体力×8|产出:铁矿石×2|概率:宝石×1:10%|次数:2|刷新:72小时|交互名:挖掘]

出入口:
- 【东|道路|东门】：通往城外的大路，[未知:是]
- 【北|阶梯|北侧阶梯】：向下的石阶，[目标:地窖]

实体字段说明：
- 名字：中文名，唯一标记
- 图标：1 个 emoji
- 类型：npc / 装饰 / 标记 / 遭遇 / 物品 / 装备 / 出入口
- 区域：区域的名字
- 锚点：中央 / 北 / 南 / 东 / 西 / 入口 / 角落 / 吧台 / 柜台 / 货架 / 祭坛 / 喷泉 / 空地 / 火堆 / 帐篷 / 起点 / 终点 / 深处 / 首领区 / 边缘
- 阻挡：阻挡 / 不阻挡
- 性别：男 / 女 / -（非 NPC 写 -）
- 心情：平静 / 警惕 / 开心 / 忧伤 / 愤怒 / -（非 NPC 写 -）
- 主次：主要 / 次要 / 路人 / -（非 NPC 写 -）

遭遇属性示例：
【类型:遭遇|HP:X/Y|攻击:X|防御:X|敏捷:X|攻击方式:近战|攻击距离:1|攻击间隔:1200|技能:技能名1、技能名2|掉落:物品名|金钱:15|经验:8|数量:6】

敌人数值参考：
- 杂兵：血量低，攻击比玩家防御弱很多
- 小怪：血量中，攻击可破玩家防御
- 精英：血量高，攻击约为玩家防御的 2 倍
- BOSS：血量很高，攻击约为玩家防御的 3 倍
- 所有怪物的防御不能高于玩家攻击的一半，否则玩家无法战胜
- 想增加交战时间，提高血量，不要提高防御

【可选值】
地图类型：室外 / 室内
建筑风格：中式传统 / 欧式中世纪 / 现代 / 赛博朋克 / 日式传统 / 工业 / 沙漠 / 极地
区域类型：村庄 / 森林 / 遗迹 / 集市 / 神殿 / 房间 / 走廊 / 大厅 / 洞穴 / 营地 / 迷宫 / 道路 / 田野 / 山地 / 湖泊 / 沙滩
区域尺寸：极小 / 小 / 中 / 大 / 巨大
地形：草地 / 泥土 / 石板 / 木地板 / 沙地 / 岩石 / 苔藓 / 水 / 岩浆 / 雪地 / 瓷砖 / 地毯
连接方向：东 / 南 / 西 / 北 / 任意
连接距离：近 / 中 / 远
连接种类：道路 / 小径 / 门 / 传送门
方向：东 / 东北 / 南 / 东南 / 西 / 西南 / 北 / 西北

【硬性规则】
1. 区域数量 4-10 个（室内可以 6-15 个）
2. 起点区域必须在区域列表里
3. 连接必须让所有区域可达
4. 连接是双向的，只写一次（A→B 就够）
5. 大建筑表 0-10 个
6. NPC / 装饰 / 标记 / 遭遇 共 3-10 个
7. 物品 / 装备 共 3-8 个
8. 每个区域至少有一个物品或 NPC
9. 玩家实体不写（程序自动生成）
10. 每张地图至少 1 个出入口
11. 出入口分布在不同的区域
12. 区域里写大建筑时，名字必须和【大建筑表】里的名字一致
13. 如果上下文说明了"从某方向进入这张地图"，
那个反方向的出入口必须存在
14. 室内地图必须写【地图】段的 类型: 室内
15. 室外地图如果地形有高低，必须写【高度】段

【重要：不要生成返回原地图的出入口】
如果上下文里说明了"从某地图某方向进入"，
你生成的地图里【不要】再包含指回那张地图的出入口，
系统会自动注入返回 portal。
你只管生成新地图本身的出入口。

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