// ============================================================
// CinemaWorld · factory-gen.js
// AI 生成工厂规则：资源 / 建筑 / 配方
//
// 依赖：map-plot.js（MapPlotManager）
//       ui.js（generateFunctionalReply）
//       world.js（parseItemLine）
//
// 暴露：window.FactoryGenerator
// ============================================================

(function () {
    'use strict';

    const FactoryGenerator = {
        isGenerating: false,

        async generate(plotId, options = {}) {
            if (this.isGenerating) {
                window.UIManager?.showText?.('正在生成中...', 1200);
                return null;
            }

            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot) {
                window.UIManager?.showText?.('玩法区不存在', 1500);
                return null;
            }

            const map = window.MapLauncher?.getMap?.();
            if (!map) return null;

            this.isGenerating = true;
            try {
                const prompt = this._buildPrompt(plot, map, options);
                window.UIManager?.showText?.('🤖 AI 正在生成工厂规则...', 2500);

                const result = await window.generateFunctionalReply(prompt, 'factory-gen');
                if (!result) {
                    window.UIManager?.showText?.('❌ 生成失败', 2000);
                    return null;
                }

                const parsed = this._parse(result);
                if (!parsed) {
                    window.UIManager?.showText?.('❌ 解析失败', 2000);
                    return null;
                }

                const check = window.FactorySchema.validateRules(parsed.rules);
                if (!check.ok) {
                    console.warn('[FactoryGen] 校验错误:', check.errors);
                    window.UIManager?.showText?.(
                        `⚠️ 规则有问题，已尽量兜底：${check.errors[0] || ''}`,
                        3000
                    );
                }
                if (check.warnings.length > 0) {
                    console.warn('[FactoryGen] 校验警告:', check.warnings);
                }

                this._applyToPlot(plot, parsed);

                window.MapLauncher?._saveMapToWorld?.(map);
                if (window.SaveManager) window.SaveManager.save();

                window.UIManager?.showText?.('✅ 工厂已配置', 2000);
                console.log('[FactoryGen] 生成完成:', parsed);
                return parsed;

            } catch (e) {
                console.error('[FactoryGen] 生成异常:', e);
                window.UIManager?.showText?.('❌ 生成失败：' + e.message, 2500);
                return null;
            } finally {
                this.isGenerating = false;
            }
        },

        // ============================================================
        // 提示词
        // ============================================================
        _buildPrompt(plot, map, options) {
            const parts = [];

            if (window.StoryManager) {
                const ctx = window.StoryManager.buildContext(null, {
                    parentStory: false, mainChars: false, scene: false,
                    interactionDigests: false,
                    volumes: true, chapters: true, pendingEvents: false,
                });
                if (ctx) parts.push(`【世界背景】\n${ctx}`);
            }

            const region = (map.regions || []).find(r => r.id === plot.regionId);
            let mapCtx = `【地图】${map.name}`;
            if (map.description) mapCtx += `\n${map.description}`;
            if (region) mapCtx += `\n【所属区域】${region.name}（${region.type}）`;
            if (region?.description) mapCtx += `\n${region.description}`;
            parts.push(mapCtx);

            if (window.CWEnv) {
                const env = window.CWEnv.ensureEnvData(map);
                if (env?._order?.length) {
                    const envText = env._order
                        .filter(k => env[k] !== undefined && env[k] !== '')
                        .map(k => `${k}：${env[k]}`)
                        .join('\n');
                    parts.push(`【当前地图环境】（生成时必须参考）\n${envText}`);
                }
            }

            parts.push([
                `【工厂玩法区】`,
                `名称：${plot.name}`,
                `尺寸：${plot.bounds.w} × ${plot.bounds.h} 格`,
                `可用格子：${plot.bounds.w * plot.bounds.h} 格`,
                plot.notes ? `备注：${plot.notes}` : '',
            ].filter(Boolean).join('\n'));

            if (window.PlayerStateManager?.player) {
                parts.push(window.PlayerStateManager.formatForPrompt());
            }

            if (options.guide) {
                parts.push(`【额外要求】\n${options.guide}`);
            }

            parts.push(this._buildTaskPrompt(plot));

            return parts.join('\n\n');
        },

        _buildTaskPrompt(plot) {
            return `
════════════════════════════════════════
【任务】
为这个工厂玩法区生成完整的规则。

【核心概念】
- 资源（resource）：工厂内部的实物，如水果、煤炭、铁锭、木板。
  ★ 资源里不要包含"金钱"，金钱是玩家货币，不是工厂资源。
- 建筑（building）：玩家放在格子上的设施。共 4 类：
  - extractor（采集）：自动"产出"某个资源，不需要输入
  - processor（加工）：按配方把若干输入资源变成输出资源
  - storage（仓库）：提高资源容量上限
  - power（能源）：提供电力，可能消耗燃料
- 配方（recipe）：输入 → 输出，是 processor 的核心。

★ 工厂不限于"矿物+冶炼"。可以是果汁厂、木材厂、纺织厂、药铺等。
  请根据世界背景和工厂名自由发挥。

════════════════════════════════════════
【输出格式】（严格遵守，四个区块，全部要写）

【工厂规则】
名称：xxx
描述：xxx
图标：🏭

【资源类型】
每行一个，声明所有工厂会用到的实物资源（原料 + 产物 + 燃料）。
★ 每个资源必须写完整的物品字段，取走时会直接作为物品进入玩家背包。

格式：
- 【键名|显示名|emoji|颜色】：描述，[类型:材料/食物/消耗品/武器/护甲/饰品/工具/燃料|状态:-|功能:一句话介绍|交互方式:使用、丢弃|效果:效果DSL|可堆叠:是/否|最大堆叠:N|货币种类:金钱|买价:N|卖价:N|库存:-]

★ 字段说明：
- 类型：物品在背包里的大类。原料用"材料"，能吃能喝的用"食物/消耗品"，能装备的用"武器/护甲/饰品/工具"，燃料用"材料"
- 状态：通常写 -
- 功能：一句话介绍，模糊、简短，不带具体数字。如"回复体力"、"解除中毒"、"增加攻击"
- 交互方式：玩家能对这个物品做什么。顿号分隔。常用：使用、装备、丢弃、查看、食用、饮用
- 效果：效果DSL，见下方说明。没有效果的写"无"
- 可堆叠：是/否
- 最大堆叠：可堆叠时写数字，否则写 -
- 货币种类：一般写"金钱"（这是物品属性，不是工厂资源）
- 买价 / 卖价：数字
- 库存：一般写 -

效果DSL格式：
效果DSL:<动作><目标> <值>[; <动作><目标> <值>...]

动作：
- 回复：当前值+N，不超上限（如"回复体力 20"）
- 提升：上限+N，当前值同步+N（如"提升体力上限 10"）
- 设置：当前值=N（如"设置体力 50"）
- 减少：当前值-N（如"减少理智 5"）
- 永久：永久改变属性（如"永久力量 2"）
- 状态：加状态（如"状态中毒 3"）
- 移除：移除状态（如"移除中毒"）
- 增益：临时属性加成（如"增益攻击 5 3回合"）

值可以是数字或百分比。多效果用分号分隔。无效果的物品写 效果:无

示例（果汁厂）：
- 【fruit|水果|🍎|#e05050】：新鲜采摘的水果，[类型:食物|状态:-|功能:回复体力|交互方式:食用、丢弃|效果:回复体力 15|可堆叠:是|最大堆叠:50|货币种类:金钱|买价:3|卖价:5|库存:-]
- 【juice|果汁|🧃|#ffa040】：清甜的水果饮品，[类型:食物|状态:-|功能:回复体力|交互方式:饮用、丢弃|效果:回复体力 30|可堆叠:是|最大堆叠:30|货币种类:金钱|买价:8|卖价:12|库存:-]
- 【premium_juice|精制果汁|✨🧃|#ffd76b】：加了糖的果汁，[类型:食物|状态:-|功能:回复体力与理智|交互方式:饮用、丢弃|效果:回复体力 50; 回复理智 10|可堆叠:是|最大堆叠:20|货币种类:金钱|买价:20|卖价:30|库存:-]
- 【coal|煤炭|🪨|#2a2a2a】：燃料，[类型:材料|状态:-|功能:提供燃料|交互方式:查看、丢弃|效果:无|可堆叠:是|最大堆叠:999|货币种类:金钱|买价:1|卖价:1|库存:-]

★ 要求：
- 资源 3-6 个
- 键名用英文小写
- 颜色用 #RRGGBB
- 至少 1 个"原料"，至少 1 个"产物"
- ★ 不要生成"金钱"、"金币"、"货币"这类资源键

【建筑】
每行一个，声明所有可放置的建筑：
- 【键名|显示名|emoji|种类|尺寸】：描述，[造价:金钱×N、资源×N|耗电:N|...]

不同种类的额外字段：
- extractor：额外写 [产出:资源键名|速率:N/分钟]
- processor：额外写 [配方:配方id1、配方id2]（配方在下一个区块定义）
- storage：额外写 [容量:资源键名×N、资源键名×N]
- power：额外写 [输出:N|燃料:资源键名×N/小时]（燃料可选，不写就是不耗燃料）

★ 造价可以包含"金钱×N"（走玩家钱包），也可以包含资源（走工厂库存），两者可混用。

示例（果汁厂）：
- 【fruit_picker|果农|🧑‍🌾|extractor|1x1】：手动采集水果，[造价:金钱×20|产出:fruit|速率:2/分钟|耗电:0]
- 【juicer|榨汁机|🧃|processor|2x2】：把水果榨成果汁，[造价:金钱×120、fruit×5|耗电:8|配方:juice_basic]
- 【crate|木箱|📦|storage|2x2】：储存原料和产品，[造价:金钱×30|容量:fruit×300、juice×200]
- 【hand_crank|手摇发电机|⚡|power|2x2】：人力发电，[造价:金钱×80|输出:15|耗电:0]

要求：
- 建筑 4-8 个
- 必须包含至少 1 个 extractor、1 个 processor
- 至少 1 个 power（否则耗电建筑无法运行）
- 尺寸 1x1 / 2x2 / 3x3 都可

【配方】
每行一个，声明所有 processor 的配方：
- 【配方id|显示名】：描述，[输入:资源键名×N、资源键名×N|输出:资源键名×N|时长:N分钟]

示例（果汁厂）：
- 【juice_basic|榨果汁】：把水果压榨成果汁，[输入:fruit×3|输出:juice×1|时长:3分钟]
- 【juice_premium|精制果汁】：加了糖的果汁更受欢迎，[输入:fruit×5、sugar×1|输出:premium_juice×1|时长:8分钟]

要求：
- 配方 2-5 个
- "输入"和"输出"的资源键名必须在【资源类型】里声明
- 配方id 必须和【建筑】里 processor 引用的配方id 一致
- 时长 1-30 分钟

════════════════════════════════════════
【硬性约束】
1. 所有配方里的资源键名必须在【资源类型】里定义
2. 所有 processor 的"配方"字段引用的 id 必须在【配方】里定义
3. power 的"燃料"必须是【资源类型】里的资源
4. extractor 的"产出"必须是【资源类型】里的资源
5. 键名用英文小写
6. 数值要平衡：采集速率 × 加工输入 ≈ 加工速率

现在开始生成：
`;
        },

        // ============================================================
        // 解析
        // ============================================================
        _parse(text) {
            if (!text) return null;

            const sections = {};
            let current = null;
            for (const line of String(text).split('\n')) {
                const t = line.trim();
                const secMatch = t.match(/^【(.+?)】\s*$/);
                if (secMatch) {
                    current = secMatch[1].trim();
                    sections[current] = sections[current] || [];
                    continue;
                }
                if (current && t) sections[current].push(t);
            }

            const result = {
                name: '',
                description: '',
                emoji: '🏭',
                rules: {
                    resourceTypes: {},
                    buildingTypes: {},
                    recipes: {},
                },
            };

            for (const line of (sections['工厂规则'] || [])) {
                const nm = line.match(/^名称\s*[:：]\s*(.+)$/);
                const dm = line.match(/^描述\s*[:：]\s*(.+)$/);
                const em = line.match(/^图标\s*[:：]\s*(.+)$/);
                if (nm) result.name = nm[1].trim();
                if (dm) result.description = dm[1].trim();
                if (em) result.emoji = this._extractEmoji(em[1]) || result.emoji;
            }

            for (const line of (sections['资源类型'] || [])) {
                const r = this._parseResourceLine(line);
                if (r) result.rules.resourceTypes[r.key] = r;
            }

            for (const line of (sections['配方'] || [])) {
                const rec = this._parseRecipeLine(line);
                if (rec) result.rules.recipes[rec.id] = rec;
            }

            for (const line of (sections['建筑'] || [])) {
                const b = this._parseBuildingLine(line, result.rules.recipes);
                if (b) result.rules.buildingTypes[b.key] = b;
            }

            this._fallback(result);

            return result;
        },

        _extractEmoji(s) {
            if (!s) return null;
            const m = String(s).match(
                /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
            );
            return m ? m[0] : null;
        },

        // ---- 资源行 ----
        _parseResourceLine(line) {
            const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*([\s\S]*)$/);
            if (!m) return null;

            const meta = m[1].split('|').map(s => s.trim());
            const key = meta[0];
            if (!key) return null;

            // 过滤掉"金钱"作为资源键
            if (/^(金钱|金币|货币|gold|money|coin)$/i.test(key)) {
                console.warn(`[FactoryGen] 忽略金钱资源: ${key}`);
                return null;
            }

            const label = meta[1] || key;
            const emoji = this._extractEmoji(meta[2]) || '📦';
            const color = (meta[3] && /^#/.test(meta[3])) ? meta[3] : '#888888';

            const body = m[2];
            const bracketM = body.match(/[\[【]([^\]】]+)[\]】]/);
            const fields = {};
            if (bracketM) {
                for (const pair of bracketM[1].split('|')) {
                    const kv = pair.match(/^(.+?)\s*[:：]\s*(.+)$/);
                    if (kv) fields[kv[1].trim()] = kv[2].trim();
                }
            }

            const desc = body.replace(/[\[【][^\]】]*[\]】]/g, '').replace(/^[，,。、\s]+/, '').trim();

            const typeRaw = String(fields['类型'] || '材料').trim();
            let category = 'material';
            if (/产物/.test(typeRaw)) category = 'product';
            else if (/燃料/.test(typeRaw)) category = 'fuel';

            const itemFields = this._buildItemFields({ typeRaw, fields });

            const capSrc = fields['初始容量'] || fields['最大堆叠'] || '';
            const capM = String(capSrc).match(/(\d+)/);
            const baseCapacity = capM ? parseInt(capM[1]) : 200;

            return {
                key,
                label,
                emoji,
                color,
                category,
                baseCapacity,
                description: desc,
                itemFields,    // ★ 包含货币种类
            };
        },

        // ---- 配方行 ----
        _parseRecipeLine(line) {
            const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*([\s\S]*)$/);
            if (!m) return null;

            const meta = m[1].split('|').map(s => s.trim());
            const id = meta[0];
            if (!id) return null;

            const name = meta[1] || id;
            const body = m[2];
            const bracketM = body.match(/[\[【]([^\]】]+)[\]】]/);
            if (!bracketM) return null;

            const fields = {};
            for (const pair of bracketM[1].split('|')) {
                const kv = pair.match(/^(.+?)\s*[:：]\s*(.+)$/);
                if (kv) fields[kv[1].trim()] = kv[2].trim();
            }

            const input = this._parseResourceAmounts(fields['输入']);
            const output = this._parseResourceAmounts(fields['输出']);

            const dm = String(fields['时长'] || '').match(/(\d+(?:\.\d+)?)/);
            const durationMinutes = dm ? parseFloat(dm[1]) : 5;

            return {
                id,
                name,
                description: body.replace(/[\[【][^\]】]*[\]】]/g, '').replace(/^[，,。、\s]+/, '').trim(),
                input,
                output,
                durationMinutes,
            };
        },

        // "资源×N、资源×N" → { 资源: N }
        // ★ 这里不过滤金钱（配方里不该有金钱，但如果有也保留，让 validate 报错）
        _parseResourceAmounts(text) {
            const out = {};
            if (!text || text === '-') return out;
            const parts = String(text).split(/[、,，]/).map(s => s.trim()).filter(Boolean);
            for (const p of parts) {
                const m = p.match(/^(.+?)\s*[×xX*]\s*(\d+(?:\.\d+)?)$/);
                if (m) {
                    out[m[1].trim()] = parseFloat(m[2]);
                } else {
                    out[p] = 1;
                }
            }
            return out;
        },

        // ---- 建筑行 ----
        _parseBuildingLine(line, recipes) {
            const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*([\s\S]*)$/);
            if (!m) return null;

            const meta = m[1].split('|').map(s => s.trim());
            const key = meta[0];
            if (!key) return null;

            const name = meta[1] || key;
            const emoji = this._extractEmoji(meta[2]) || '🏭';
            const kind = (meta[3] || 'processor').trim().toLowerCase();
            const sizeRaw = (meta[4] || '1x1').trim();
            const sizeM = sizeRaw.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
            const size = sizeM ? parseInt(sizeM[1]) : 1;

            const body = m[2];
            const bracketM = body.match(/[\[【]([^\]】]+)[\]】]/);
            if (!bracketM) return null;

            const fields = {};
            for (const pair of bracketM[1].split('|')) {
                const kv = pair.match(/^(.+?)\s*[:：]\s*(.+)$/);
                if (kv) fields[kv[1].trim()] = kv[2].trim();
            }

            // 造价：金钱×N、资源×N 都保留
            const cost = this._parseResourceAmounts(fields['造价']);

            const powerM = String(fields['耗电'] || '').match(/(\d+(?:\.\d+)?)/);
            const powerDraw = powerM ? parseFloat(powerM[1]) : 0;

            const def = {
                key, name, emoji, kind, size,
                cost,
                powerDraw,
                description: body.replace(/[\[【][^\]】]*[\]】]/g, '').replace(/^[，,。、\s]+/, '').trim(),
            };

            switch (kind) {
                case 'extractor': {
                    def.outputType = (fields['产出'] || '').trim();
                    const rM = String(fields['速率'] || '').match(/(\d+(?:\.\d+)?)/);
                    def.ratePerMinute = rM ? parseFloat(rM[1]) : 1;
                    break;
                }
                case 'processor': {
                    const recipeIds = String(fields['配方'] || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean);
                    def._recipeIds = recipeIds;
                    break;
                }
                case 'storage': {
                    def.capacity = this._parseResourceAmounts(fields['容量']);
                    break;
                }
                case 'power': {
                    const oM = String(fields['输出'] || '').match(/(\d+(?:\.\d+)?)/);
                    def.powerOutput = oM ? parseFloat(oM[1]) : 10;

                    if (fields['燃料']) {
                        const fm = String(fields['燃料']).match(/^(.+?)\s*[×xX*]\s*(\d+(?:\.\d+)?)/);
                        if (fm) {
                            def.fuelType = fm[1].trim();
                            const perHour = parseFloat(fm[2]);
                            def.fuelPerMinute = perHour / 60;
                        }
                    }
                    break;
                }
            }

            return def;
        },

        // ★ 构造完整物品字段（保留货币种类）
        _buildItemFields({ typeRaw, fields }) {
            const out = {};

            out['类型'] = this._normalizeItemType(typeRaw);

            out['状态'] = (fields['状态'] && fields['状态'] !== '-')
                ? fields['状态']
                : '-';

            const func = fields['功能'];
            out['功能'] = (func && func !== '-') ? func : '—';

            const interactions = fields['交互方式'];
            out['交互方式'] = (interactions && interactions !== '-')
                ? interactions
                : '查看、丢弃';

            const effect = fields['效果'];
            out['效果'] = (effect && effect !== '-' && effect !== '无')
                ? effect
                : '无';

            const stackableRaw = fields['可堆叠'];
            const stackable = /^(是|yes|true|1|可)$/i.test(String(stackableRaw || '').trim())
                || !stackableRaw;
            out['可堆叠'] = stackable ? '是' : '否';

            if (stackable) {
                const maxM = String(fields['最大堆叠'] || '').match(/(\d+)/);
                out['最大堆叠'] = maxM ? maxM[1] : '99';
            } else {
                out['最大堆叠'] = '-';
            }

            // ★ 货币种类：保留（商店定价用）
            const currency = fields['货币种类'];
            out['货币种类'] = (currency && currency !== '-')
                ? currency
                : '金钱';

            const buyM = String(fields['买价'] || '').match(/(\d+)/);
            const sellM = String(fields['卖价'] || '').match(/(\d+)/);
            out['买价'] = buyM ? buyM[1] : 'X';
            out['卖价'] = sellM ? sellM[1] : 'Y';

            const stock = fields['库存'];
            out['库存'] = (stock && stock !== '-') ? stock : '-';

            const EQUIP_KEYS = ['攻击', '防御', '敏捷', '暴击', '命中', '闪避',
                '体力', '生命', '魔力', '智力', '力量', '精神'];
            for (const k of EQUIP_KEYS) {
                if (fields[k] !== undefined) out[k] = fields[k];
            }

            for (const [k, v] of Object.entries(fields)) {
                if (out[k] !== undefined) continue;
                if (['初始容量', '速率'].includes(k)) continue;
                out[k] = v;
            }

            return out;
        },

        _normalizeItemType(typeRaw) {
            const t = String(typeRaw || '').trim();
            if (!t) return '材料';
            if (/^原料$/.test(t)) return '材料';
            if (/^产物$/.test(t)) return '物品';
            if (/^燃料$/.test(t)) return '材料';
            return t;
        },

        _fallback(result) {
            const r = result.rules;

            if (Object.keys(r.resourceTypes).length === 0) {
                r.resourceTypes = {
                    material: {
                        key: 'material', label: '原料', emoji: '📦',
                        color: '#8a6a4a', category: 'material',
                        baseCapacity: 200, description: '基础原料',
                        itemFields: {
                            '类型': '材料', '状态': '-', '功能': '—',
                            '交互方式': '查看、丢弃', '效果': '无',
                            '可堆叠': '是', '最大堆叠': '99',
                            '货币种类': '金钱', '买价': '1', '卖价': '2', '库存': '-',
                        },
                    },
                    product: {
                        key: 'product', label: '产品', emoji: '🔩',
                        color: '#c0c0c0', category: 'product',
                        baseCapacity: 200, description: '加工产物',
                        itemFields: {
                            '类型': '物品', '状态': '-', '功能': '—',
                            '交互方式': '查看、丢弃', '效果': '无',
                            '可堆叠': '是', '最大堆叠': '99',
                            '货币种类': '金钱', '买价': '5', '卖价': '8', '库存': '-',
                        },
                    },
                };
            }

            const hasExtractor = Object.values(r.buildingTypes).some(b => b.kind === 'extractor');
            if (!hasExtractor) {
                const firstMaterial = Object.values(r.resourceTypes).find(x => x.category === 'material');
                if (firstMaterial) {
                    r.buildingTypes.simple_extractor = {
                        key: 'simple_extractor',
                        name: '采集机', emoji: '⛏️',
                        kind: 'extractor', size: 1,
                        cost: { '金钱': 30 },
                        powerDraw: 0,
                        outputType: firstMaterial.key,
                        ratePerMinute: 1,
                        description: `采集${firstMaterial.label}`,
                    };
                }
            }

            const hasProcessor = Object.values(r.buildingTypes).some(b => b.kind === 'processor');
            if (!hasProcessor && Object.keys(r.recipes).length > 0) {
                const firstRecipe = Object.values(r.recipes)[0];
                r.buildingTypes.simple_processor = {
                    key: 'simple_processor',
                    name: '加工机', emoji: '🔥',
                    kind: 'processor', size: 2,
                    cost: { '金钱': 100 },
                    powerDraw: 5,
                    _recipeIds: [firstRecipe.id],
                    description: '基础加工',
                };
            }

            const anyPowerDraw = Object.values(r.buildingTypes).some(
                b => (b.powerDraw || 0) > 0
            );
            const hasPower = Object.values(r.buildingTypes).some(b => b.kind === 'power');
            if (anyPowerDraw && !hasPower) {
                r.buildingTypes.simple_power = {
                    key: 'simple_power',
                    name: '发电机', emoji: '⚡',
                    kind: 'power', size: 2,
                    cost: { '金钱': 150 },
                    powerDraw: 0,
                    powerOutput: 20,
                    description: '基础供电',
                };
            }
        },

        _applyToPlot(plot, parsed) {
            const rules = parsed.rules;

            for (const b of Object.values(rules.buildingTypes)) {
                if (b.kind !== 'processor') continue;
                const resolved = {};
                for (const rid of (b._recipeIds || [])) {
                    if (rules.recipes[rid]) {
                        resolved[rid] = rules.recipes[rid];
                    } else {
                        console.warn(`[FactoryGen] 建筑 ${b.key} 引用了不存在的配方 ${rid}`);
                    }
                }
                if (Object.keys(resolved).length === 0 && Object.keys(rules.recipes).length > 0) {
                    const firstId = Object.keys(rules.recipes)[0];
                    resolved[firstId] = rules.recipes[firstId];
                }
                b.recipes = resolved;
                delete b._recipeIds;
            }

            plot.rules = rules;
            plot.emoji = parsed.emoji || '🏭';
            plot.color = 'rgba(180, 140, 80, 0.30)';

            if (!plot.factory) {
                plot.factory = window.FactorySchema.createEmpty(plot);
            }
            window.FactoryManager?._recalcCapacity?.(plot.factory, rules);

            window.MapPlotManager?.markDirty?.();
        },
    };

    window.FactoryGenerator = FactoryGenerator;
    console.log('[CinemaWorld] factory-gen.js 已加载');
})();