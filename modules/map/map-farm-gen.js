// ============================================================
// CinemaWorld · map-farm-gen.js
// 农田规则 + 商店的 AI 生成器
//
// 依赖：map-plot.js（MapRuleLibrary）
//       ui.js（generateFunctionalReply）
//
// 暴露：window.MapFarmGenerator
// ============================================================

(function () {
    'use strict';

    const MapFarmGenerator = {
        isGenerating: false,

        async generate(plotId, options = {}) {
            if (this.isGenerating) {
                window.UIManager?.showText?.('正在生成中...', 1200);
                return null;
            }

            const plot = window.MapPlotManager?.getPlotById?.(plotId);
            if (!plot) { window.UIManager?.showText?.('区域不存在', 1500); return null; }

            const map = window.MapLauncher?.getMap?.();
            if (!map) return null;

            this.isGenerating = true;
            try {
                const prompt = this._buildPrompt(plot, map, options);

                window.UIManager?.showText?.('🤖 AI 正在生成农田规则...', 2500);

                const result = await window.generateFunctionalReply(prompt, 'farm-rule-gen');
                if (!result) { window.UIManager?.showText?.('❌ 生成失败', 2000); return null; }

                // ★ 解析
                const parsed = this._parse(result);
                if (!parsed) { window.UIManager?.showText?.('❌ 解析失败', 2000); return null; }

                // ★ 校验
                this._validate(parsed);

                // ★ 写入 plot
                this._applyToPlot(plot, parsed);

                window.MapLauncher?._saveMapToWorld?.(map);
                if (window.SaveManager) window.SaveManager.save();

                window.UIManager?.showText?.('✅ 配置已生成', 2000);
                console.log('[MapFarmGen] 生成完成:', parsed);

                return parsed;

            } catch (e) {
                console.error('[MapFarmGen] 生成异常:', e);
                window.UIManager?.showText?.('❌ 生成失败：' + e.message, 2500);
                return null;
            } finally {
                this.isGenerating = false;
            }
        },
        _applyToPlot(plot, parsed) {
            plot.rules = {
                env: parsed.rules.env,
                actions: parsed.rules.actions,
                crops: parsed.rules.crops,
                products: parsed.rules.products,
                envRules: parsed.rules.envRules,
            };
            plot.shop = parsed.shop;
            plot.emoji = parsed.emoji || '🌾';
            plot.color = 'rgba(120,200,120,0.30)';

            // ★ 重建 env（旧值仅当类型合法时才沿用）
            const oldEnv = (plot.env && typeof plot.env === 'object') ? plot.env : {};
            const newEnv = { _order: [] };
            for (const [key, def] of Object.entries(plot.rules.env)) {
                const oldVal = oldEnv[key];
                let val;
                if (typeof oldVal === 'number' && isFinite(oldVal)) {
                    val = oldVal;
                } else {
                    val = (typeof def.default === 'number') ? def.default : 0;
                }
                // 钳制
                const min = (typeof def.min === 'number') ? def.min : 0;
                const max = (typeof def.max === 'number') ? def.max : 100;
                newEnv[key] = Math.max(min, Math.min(max, val));
                newEnv._order.push(key);
            }
            plot.env = newEnv;

            // ★ 商店状态清空（因为 item id 会换）
            plot.shopState = null;

            // ★ 作物校验：cropId 在规则里找不到 → 重置
            if ((plot.status === 'growing' || plot.status === 'ready')
                && !plot.rules.crops?.[plot.cropId]) {
                console.warn(`[MapFarmGen] plot ${plot.id} 的 cropId=${plot.cropId} 在新规则里不存在，重置为 idle`);
                plot.status = 'idle';
                plot.cropId = null;
                plot.progress = 0;
            }

            // ★ progress 数值保护
            plot.progress = Math.max(0, Math.min(1, Number(plot.progress) || 0));

            window.MapPlotManager?.markDirty?.();
        },
        // ============================================================
        // 组装提示词
        // ============================================================
        _buildPrompt(plot, map, options) {
            const parts = [];

            // 世界背景
            if (window.StoryManager) {
                const ctx = window.StoryManager.buildContext(null, {
                    parentStory: false, mainChars: false, scene: false,
                    interactionDigests: false,
                    volumes: true, chapters: true, pendingEvents: false,
                });
                if (ctx) parts.push(`【世界背景】\n${ctx}`);
            }

            // 地图信息
            const region = (map.regions || []).find(r => r.id === plot.regionId);
            let mapCtx = `【地图】${map.name}`;
            if (map.description) mapCtx += `\n${map.description}`;
            if (region) mapCtx += `\n【所属区域】${region.name}（${region.type}）`;
            if (region?.description) mapCtx += `\n${region.description}`;
            parts.push(mapCtx);

            // 地图环境数据
            if (window.CWEnv) {
                const mapEnv = window.CWEnv.ensureEnvData(map);
                if (mapEnv?._order?.length) {
                    const envText = mapEnv._order
                        .filter(k => mapEnv[k] !== undefined && mapEnv[k] !== '')
                        .map(k => `${k}：${mapEnv[k]}`)
                        .join('\n');
                    parts.push(`【当前地图环境】（★ 生成规则时必须参考）\n${envText}`);
                }
            }

            // 地块信息
            parts.push([
                `【玩法区】`,
                `名称：${plot.name}`,
                `类型：${plot.type}`,
                `尺寸：${plot.bounds.w} × ${plot.bounds.h} 格`,
                plot.notes ? `备注：${plot.notes}` : '',
            ].filter(Boolean).join('\n'));

            // 玩家信息
            if (window.PlayerStateManager?.player) {
                parts.push(window.PlayerStateManager.formatForPrompt());
            }

            // 额外要求
            if (options.guide) {
                parts.push(`【额外要求】\n${options.guide}`);
            }

            // 任务说明
            parts.push(this._buildTaskPrompt());

            return parts.join('\n\n');
        },

        _buildTaskPrompt() {
            return `
════════════════════════════════════════
【任务】
为这个玩法区生成完整的种植规则 + 商店。必须符合世界背景与地图环境。

【输出格式】（严格遵守，六个区块，全部要写）

【规则名称】
名称：xxx
描述：xxx
图标：🌾

【环境属性】
每行一个：
- 【键名|显示名|图标】：初始值，每天衰减，范围 min~max

示例：
- 【moisture|土壤湿度|💧】：初始 60，每天 -40，范围 0~100
- 【fertility|土壤肥力|🌱】：初始 80，每天 0，范围 0~100
- 【temperature|温度|🌡️】：初始 20，每天 0，范围 -20~50

要求： 
- 属性 2-4 个
- 键名用英文小写
- 值符合世界观

【区域动作】
每行一个：
- 【键名|显示名|图标】：[消耗:体力×N|效果:属性+N、属性-N]

示例：
- 【water|浇水|💧】：[消耗:体力×3|效果:moisture+X]
- 【dewater|排水|💧】：[消耗:体力×3|效果:moisture-Y]
- 【fertilize|施肥|🌱】：[消耗:体力×5、金钱×3|效果:fertility+X]

要求：
- 动作 3-5 个
- ★ 效果加减号必须是 +N 或 -N（N 是具体数字，不要写 X 或变量）
- 效果里的属性名必须来自【环境属性】

【可种作物】
每行一个：
- 【作物id|名称|图标】：[成本:金钱×N|生长:N小时|环境条件|产物:物品名|产量:N|阶段:🌱、🌿、🌾]

示例：
- 【wheat|小麦|🌾】：[成本:金钱×1|生长:72小时|湿度:40~90|肥力:30+|产物:小麦|产量:3|阶段:🌱、🌿、🌾]
- 【rice|水稻|🌾】：[成本:金钱×2|生长:96小时|湿度:60~100|肥力:30+|产物:大米|产量:5|阶段:🌱、🌿、🌾]

★ 重要：
- "成本"和"产量"都是【每格】的（程序会乘以格子数）
- 数值不要太大（每格 1-15 个为宜）
- "环境条件"里的属性名必须来自【环境属性】
- "产物"必须是【产物表】里的物品名
- "阶段"是 3-5 个图标（顿号分隔），从种子到成熟
- 生长慢的产量高，生长快的产量低
- 不要所有作物都一样，要有差异化

【产物表】
每行一个，完整物品格式：
- 【物品名|图标】：描述，[类型|状态|功能|效果|可堆叠|货币种类:X|买价:X|卖价:X]

示例：
- 【小麦|🌾】：金黄饱满的麦粒，[类型:材料|可堆叠:是|最大堆叠:99|货币种类:金钱|买价:2|卖价:3]
- 【面包|🍞】：刚出炉的麦香面包，[类型:食物|功能:回复体力|效果:回复体力 20|可堆叠:是|最大堆叠:20|货币种类:金钱|买价:8|卖价:12]

要求：
- 必须覆盖所有种子的"产物"字段提到的物品
- 消耗品要写"功能"和"效果"
- 必须有"买价"和"卖价"

效果 DSL 格式：
效果DSL:<动作><目标> <值>[; <动作><目标> <值>...]
动作：回复/提升/设置/减少/永久/状态/移除/增益
无效果的物品写"效果:无"

【环境规则】
每行一个：
- [环境条件] → [效果]

环境条件：键名 = 值 / 键名 包含 值 / 键名 > 数字 / 键名 < 数字
效果：属性名 +N/天 / 属性名 -N/天 / 属性名 衰减 ×N / 生长 ×N

示例：
- 天气 包含 雨 → moisture +60/天
- 季节 包含 冬 → moisture -30/天
- 天气 包含 晴 → moisture -60/天

要求：
- 环境规则 2-6 条
- 条件里的键名必须来自【当前地图环境】
- 效果里的属性名必须来自【环境属性】

【补给商店】
商店卖"能改变田地状态或帮助玩家"的物品（不卖种子）。

每行一个：
- 【物品名|图标】：描述，[价格:金钱×N|库存:N|补货:N小时|效果:效果代码]

效果代码（必填其一）：
- env:<属性名>:<值>      改变环境属性
- recover:<属性名>:<值>  恢复玩家状态（体力/生命等）
- speed:<倍率>:<小时>    加速生长
- protect:<小时>         保护不被枯死
- cure:<状态名>          治疗状态
- item:<物品名>:<数量>   直接给物品

示例：
- 【井水|💧】：新鲜的井水，[价格:金钱×2|库存:20|补货:6小时|效果:env:moisture:30]
- 【粗肥|🌱】：农田常用的肥料，[价格:金钱×5|库存:10|补货:24小时|效果:env:fertility:30]
- 【茶点|🍵】：农人自制的茶点，[价格:金钱×8|库存:5|补货:24小时|效果:recover:体力:50]
- 【灵泉水|✨】：据说能让庄稼长得更快，[价格:金钱×30|库存:2|补货:72小时|效果:speed:2:6]
- 【驱虫香|🕯️】：点燃后害虫不敢靠近，[价格:金钱×15|库存:3|补货:24小时|效果:protect:12]

要求：
- 商品 4-8 个
- 至少 1 个 env 类型（必需品）
- 至少 1 个 recover 类型（帮续航）
- 1-2 个增强型（speed/protect/cure）
- 价格有梯度、库存有限、补货周期合理
- env 效果里的属性名必须来自【环境属性】

════════════════════════════════════════
【硬性约束】
1. 所有"产物:XXX"里的 XXX 必须在【产物表】里定义
2. 所有作物环境条件的属性名必须在【环境属性】里定义
3. 所有环境规则的条件键名必须来自【当前地图环境】
4. 所有环境规则、商店效果的属性名必须来自【环境属性】
5. 键名用英文小写，显示名用中文
6. 数值要平衡（成本 × 2~3 ≈ 收益）

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
                emoji: '🌾',
                rules: { env: {}, actions: {}, crops: {}, products: {}, envRules: [] },
                shop: { name: '补给站', emoji: '🏪', items: [] },
            };

            // 规则名称
            for (const line of (sections['规则名称'] || [])) {
                const nm = line.match(/^名称\s*[:：]\s*(.+)$/);
                const dm = line.match(/^描述\s*[:：]\s*(.+)$/);
                const em = line.match(/^图标\s*[:：]\s*(.+)$/);
                if (nm) result.name = nm[1].trim();
                if (dm) result.description = dm[1].trim();
                if (em) result.emoji = this._extractEmoji(em[1]) || result.emoji;
            }

            // 环境属性
            for (const line of (sections['环境属性'] || [])) {
                const p = this._parseEnvLine(line);
                if (p) result.rules.env[p.key] = p;
            }

            // 区域动作
            for (const line of (sections['区域动作'] || [])) {
                const a = this._parseActionLine(line);
                if (a) result.rules.actions[a.key] = a;
            }

            // 可种作物
            for (const line of (sections['可种作物'] || [])) {
                const c = this._parseCropLine(line);
                if (c) result.rules.crops[c.id] = c;
            }

            // 产物表
            for (const line of (sections['产物表'] || [])) {
                const cleaned = line.replace(/^[-•]\s*/, '').trim();
                if (!cleaned.startsWith('【')) continue;
                const item = window.WorldManager?.parseItemLine?.(cleaned);
                if (item && item.name) {
                    result.rules.products[item.name] = {
                        name: item.name,
                        icon: item.icon || '📦',
                        description: item.description || '',
                        type: item.type || 'item',
                        stackable: item.stackable !== false,
                        maxStack: item.maxStack || 99,
                        fields: { ...(item.fields || {}) },
                    };
                }
            }

            // 环境规则
            for (const line of (sections['环境规则'] || [])) {
                const r = this._parseEnvRuleLine(line);
                if (r) result.rules.envRules.push(r);
            }

            // 商店
            for (const line of (sections['补给商店'] || [])) {
                const item = this._parseShopLine(line);
                if (item) result.shop.items.push(item);
            }

            return result;
        },

        _extractEmoji(s) {
            if (!s) return null;
            const m = String(s).match(
                /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
            );
            return m ? m[0] : null;
        },

        _parseEnvLine(line) {
            const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*(.+)$/);
            if (!m) return null;
            const meta = m[1].split('|').map(s => s.trim());
            const key = meta[0];
            const label = meta[1] || key;
            const emoji = meta[2] || '·';
            const body = m[2];

            const initM = body.match(/初始\s*(-?\d+(?:\.\d+)?)/);
            // ★ 匹配"每天"或"每小时"
            let decayM = body.match(/每天\s*([+\-]?\d+(?:\.\d+)?)/);
            if (!decayM) {
                // 兼容"每小时" → 转成每天
                const hourlyM = body.match(/每小时\s*([+\-]?\d+(?:\.\d+)?)/);
                if (hourlyM) {
                    const hourly = parseFloat(hourlyM[1]);
                    decayM = [null, String(hourly * 24)];
                }
            }
            const rangeM = body.match(/范围\s*(-?\d+(?:\.\d+)?)\s*[~\-]\s*(-?\d+(?:\.\d+)?)/);

            return {
                key, label, emoji,
                default: initM ? parseFloat(initM[1]) : 50,
                decay: decayM ? parseFloat(decayM[1]) : 0,   // ★ 存的是每天
                min: rangeM ? parseFloat(rangeM[1]) : 0,
                max: rangeM ? parseFloat(rangeM[2]) : 100,
            };
        },

        _parseActionLine(line) {
            const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*(.+)$/);
            if (!m) return null;
            const meta = m[1].split('|').map(s => s.trim());
            const key = meta[0];
            const name = meta[1] || key;
            const emoji = meta[2] || '⚡';
            const body = m[2];

            const bracketM = body.match(/[\[【]([^\]】]+)[\]】]/);
            if (!bracketM) return null;

            const cost = {};
            const effect = {};

            for (const f of bracketM[1].split('|')) {
                const kv = f.match(/^(.+?)\s*[:：]\s*(.+)$/);
                if (!kv) continue;
                const k = kv[1].trim();
                const v = kv[2].trim();

                if (k === '消耗') {
                    for (const p of v.split(/[、,，]/)) {
                        const cm = p.match(/^(.+?)\s*[×xX*]\s*(\d+)$/);
                        if (cm) cost[cm[1].trim()] = parseInt(cm[2]);
                    }
                } else if (k === '效果') {
                    for (const p of v.split(/[、,，;；]/)) {
                        const em = p.match(/^(\S+?)\s*([+\-])\s*(\d+(?:\.\d+)?)$/);
                        if (em) effect[em[1].trim()] = (em[2] === '-' ? -1 : 1) * parseFloat(em[3]);
                    }
                }
            }

            return { key, name, emoji, cost, effect };
        },

        _parseCropLine(line) {
            const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*(.+)$/);
            if (!m) return null;
            const meta = m[1].split('|').map(s => s.trim());
            const id = meta[0];
            const name = meta[1] || id;
            const emoji = meta[2] || '🌱';
            const body = m[2];

            const bracketM = body.match(/[\[【]([^\]】]+)[\]】]/);
            if (!bracketM) return null;

            const cost = {};
            const envReq = {};
            let growHours = 72, yieldItem = '', yieldCount = 3;
            let stages = [emoji];

            for (const f of bracketM[1].split('|')) {
                const kv = f.match(/^(.+?)\s*[:：]\s*(.+)$/);
                if (!kv) continue;
                const k = kv[1].trim();
                const v = kv[2].trim();

                if (k === '成本') {
                    for (const p of v.split(/[、,，]/)) {
                        const cm = p.match(/^(.+?)\s*[×xX*]\s*(\d+)$/);
                        if (cm) cost[cm[1].trim()] = parseInt(cm[2]);
                    }
                } else if (k === '生长') {
                    const gm = v.match(/(\d+)/);
                    if (gm) growHours = parseInt(gm[1]);
                } else if (k === '产物') {
                    yieldItem = v.trim();
                } else if (k === '产量') {
                    const ym = v.match(/(\d+)/);
                    if (ym) yieldCount = parseInt(ym[1]);
                } else if (k === '阶段') {
                    const list = v.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
                    if (list.length >= 2) stages = list;
                } else {
                    // 环境条件
                    const rangeM = v.match(/^(-?\d+(?:\.\d+)?)\s*[~\-]\s*(-?\d+(?:\.\d+)?)$/);
                    if (rangeM) {
                        envReq[k] = { min: parseFloat(rangeM[1]), max: parseFloat(rangeM[2]) };
                    } else {
                        const minM = v.match(/^(\d+)\s*\+$/);
                        if (minM) envReq[k] = { min: parseFloat(minM[1]) };
                    }
                }
            }

            return {
                id, name, emoji, cost, growHours, envReq,
                yield: { item: yieldItem, count: yieldCount }, stages
            };
        },

        _parseEnvRuleLine(line) {
            const m = line.match(/^[-•]?\s*(.+?)\s*→\s*(.+)$/);
            if (!m) return null;
            const when = this._parseEnvCondition(m[1].trim());
            const effects = this._parseEnvEffects(m[2].trim());
            if (!when || !effects.length) return null;
            return { when, effects };
        },

        _parseEnvCondition(text) {
            let m = text.match(/^(\S+?)\s*包含\s*(.+)$/);
            if (m) return { key: m[1].trim(), op: 'contains', value: m[2].trim() };

            m = text.match(/^(\S+?)\s*(>=|<=|==|=|>|<)\s*(.+)$/);
            if (m) {
                const key = m[1].trim();
                let op = m[2];
                if (op === '==') op = '=';
                let value = m[3].trim();
                if (['>', '>=', '<', '<='].includes(op)) {
                    const n = parseFloat(value.replace(/[^\d.\-]/g, ''));
                    if (isNaN(n)) return null;
                    value = n;
                }
                return { key, op, value };
            }
            return null;
        },

        _parseEnvEffects(text) {
            const effects = [];
            let m;

            // ★ 匹配"每天"
            m = text.match(/^(\S+?)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*\/\s*(天|day)/);
            if (m) {
                effects.push({
                    type: 'fieldDelta',
                    field: m[1].trim(),
                    value: (m[2] === '-' ? -1 : 1) * parseFloat(m[3]),
                });
                return effects;
            }

            // 兼容旧"每小时"
            m = text.match(/^(\S+?)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*\/\s*(小时|h)/);
            if (m) {
                // 每小时 → 转成每天
                effects.push({
                    type: 'fieldDelta',
                    field: m[1].trim(),
                    value: (m[2] === '-' ? -1 : 1) * parseFloat(m[3]) * 24,
                });
                return effects;
            }

            m = text.match(/^(\S+?)\s*衰减\s*[×xX*]\s*(\d+(?:\.\d+)?)$/);
            if (m) {
                effects.push({
                    type: 'fieldMultiplier',
                    field: m[1].trim(),
                    value: parseFloat(m[2]),
                });
                return effects;
            }

            m = text.match(/^生长\s*[×xX*]\s*(\d+(?:\.\d+)?)$/);
            if (m) {
                effects.push({ type: 'growMultiplier', value: parseFloat(m[1]) });
                return effects;
            }

            return effects;
        },

        _parseShopLine(line) {
            const m = line.match(/^[-•]?\s*【([^】]+)】\s*[:：]\s*(.+)$/);
            if (!m) return null;
            const meta = m[1].split('|').map(s => s.trim());
            const name = meta[0];
            const icon = meta[1] || '📦';
            const body = m[2];

            const bracketM = body.match(/[\[【]([^\]】]+)[\]】]/);
            if (!bracketM) return null;

            const fields = {};
            for (const f of bracketM[1].split('|')) {
                const kv = f.match(/^(.+?)\s*[:：]\s*(.+)$/);
                if (kv) fields[kv[1].trim()] = kv[2].trim();
            }

            const priceM = String(fields['价格'] || '').match(/(\d+)/);
            const stockM = String(fields['库存'] || '').match(/(\d+)/);
            const restockM = String(fields['补货'] || '').match(/(\d+)/);

            const effect = this._parseShopEffect(fields['效果']);
            if (!effect) return null;

            const price = priceM ? parseInt(priceM[1]) : 10;
            const stock = stockM ? parseInt(stockM[1]) : 5;
            const restock = restockM ? parseInt(restockM[1]) : 24;

            // 从描述里取文字
            const desc = body.replace(bracketM[0], '').replace(/^[，,。、\s]+/, '').trim();

            return {
                id: `item_${name}_${Math.random().toString(36).slice(2, 6)}`,
                name,
                icon: this._extractEmoji(icon) || '📦',
                description: desc || '',
                price,
                stock,
                maxStock: stock,
                restockInterval: restock,
                effect,
            };
        },

        _parseShopEffect(text) {
            if (!text) return null;
            const parts = String(text).split(':').map(s => s.trim());
            if (parts.length < 2) return null;

            const type = parts[0].toLowerCase();
            switch (type) {
                case 'env':
                    return { type: 'env', target: parts[1], value: parseFloat(parts[2] || '30') };
                case 'recover':
                    return { type: 'recover', target: parts[1], value: parseFloat(parts[2] || '30') };
                case 'speed':
                    return { type: 'speed', multiplier: parseFloat(parts[1] || '2'), duration: parseFloat(parts[2] || '6') };
                case 'protect':
                    return { type: 'protect', duration: parseFloat(parts[1] || '12') };
                case 'cure':
                    return { type: 'cure', target: parts[1] };
                case 'item':
                    return { type: 'item', target: parts[1], value: parseFloat(parts[2] || '1') };
            }
            return null;
        },

                // ============================================================
        // 校验 + 兜底
        // 关键：AI 会用中文显示名（"湿度"、"肥力"）引用属性，
        //       这里统一翻译成真实键名（moisture、fertility）
        //
        // ★ 多 plot 修复：
        //   1. label/emoji 去重，避免两个属性共享同一个显示名
        //   2. normalizeKey 精确优先，多命中放弃，绝不猜
        // ============================================================
        _validate(parsed) {
            const { rules, shop } = parsed;

            if (!parsed.name) parsed.name = '未命名规则';

            // ============================================================
            // ★ 0. label / emoji 去重（必须在建反查表之前）
            // ============================================================
            {
                const seenLabels = new Map();
                const seenEmojis = new Map();

                for (const [key, def] of Object.entries(rules.env || {})) {
                    // ---- label 去重 ----
                    let label = String(def.label || key).trim() || key;
                    if (seenLabels.has(label)) {
                        let n = 2;
                        while (seenLabels.has(`${label}${n}`)) n++;
                        const oldLabel = label;
                        label = `${label}${n}`;
                        console.warn(`[MapFarmGen] 属性 ${key} 的 label "${oldLabel}" 重复，改为 "${label}"`);
                    }
                    def.label = label;
                    seenLabels.set(label, key);

                    // ---- emoji 去重（emoji 允许为空） ----
                    let emoji = String(def.emoji || '').trim();
                    if (emoji) {
                        if (seenEmojis.has(emoji)) {
                            // emoji 撞车时直接清空，避免 normalizeKey 模糊匹配错乱
                            console.warn(`[MapFarmGen] 属性 ${key} 的 emoji "${emoji}" 与 ${seenEmojis.get(emoji)} 重复，已清空`);
                            def.emoji = '';
                            emoji = '';
                        } else {
                            seenEmojis.set(emoji, key);
                        }
                    }
                }
            }

            // ============================================================
            // ★ 1. 构建"显示名 → 键名"的反查表
            // ============================================================
            const nameToKey = {};
            for (const [key, def] of Object.entries(rules.env || {})) {
                nameToKey[key] = key;                          // 英文 key → 自己
                if (def.label) nameToKey[String(def.label).trim()] = key;
                if (def.emoji) nameToKey[String(def.emoji).trim()] = key;
            }

            // 归一化函数：把任意写法翻译成真实 key
            // ★ 精确优先，多命中放弃，绝不猜
            const normalizeKey = (raw) => {
                if (!raw) return null;
                const s = String(raw).trim();
                if (!s) return null;

                // 1. 精确命中 key
                if (rules.env[s] !== undefined) return s;

                // 2. 精确命中显示名/图标
                const exactHits = [];
                for (const [name, key] of Object.entries(nameToKey)) {
                    if (!name) continue;
                    if (name === s) exactHits.push(key);
                }
                const exactUniq = [...new Set(exactHits)];
                if (exactUniq.length === 1) return exactUniq[0];
                if (exactUniq.length > 1) {
                    console.warn(`[MapFarmGen] "${s}" 精确匹配到多个属性 ${exactUniq.join(',')}，放弃转换`);
                    return null;
                }

                // 3. 模糊匹配（包含关系）
                const fuzzyHits = [];
                for (const [name, key] of Object.entries(nameToKey)) {
                    if (!name) continue;
                    if (s.includes(name) || name.includes(s)) fuzzyHits.push(key);
                }
                const fuzzyUniq = [...new Set(fuzzyHits)];
                if (fuzzyUniq.length === 1) return fuzzyUniq[0];
                if (fuzzyUniq.length > 1) {
                    console.warn(`[MapFarmGen] "${s}" 模糊匹配到多个属性 ${fuzzyUniq.join(',')}，放弃转换`);
                    return null;
                }

                return null;
            };

            // ============================================================
            // ★ 2. 转换：作物 envReq
            // ============================================================
            for (const [cropId, crop] of Object.entries(rules.crops || {})) {
                const newReq = {};
                for (const [rawKey, cond] of Object.entries(crop.envReq || {})) {
                    const realKey = normalizeKey(rawKey);
                    if (realKey) {
                        newReq[realKey] = cond;
                    } else {
                        console.warn(`[MapFarmGen] 作物 ${cropId} 引用了未知属性 "${rawKey}"，已忽略`);
                    }
                }
                crop.envReq = newReq;
            }

            // ============================================================
            // ★ 3. 转换：动作 effect
            // ============================================================
            for (const [actId, act] of Object.entries(rules.actions || {})) {
                const newEff = {};
                for (const [rawKey, val] of Object.entries(act.effect || {})) {
                    const realKey = normalizeKey(rawKey);
                    if (realKey) {
                        newEff[realKey] = val;
                    } else {
                        console.warn(`[MapFarmGen] 动作 ${actId} 引用了未知属性 "${rawKey}"，已忽略`);
                    }
                }
                act.effect = newEff;
            }

            // ============================================================
            // ★ 4. 转换：环境规则 effects[].field
            // ============================================================
            for (const r of rules.envRules || []) {
                r.effects = (r.effects || []).map(eff => {
                    if (eff.field) {
                        const realKey = normalizeKey(eff.field);
                        if (realKey) {
                            eff.field = realKey;
                            return eff;
                        }
                        console.warn(`[MapFarmGen] 环境规则引用了未知属性 "${eff.field}"，已忽略`);
                        return null;
                    }
                    return eff;   // 没有 field 的效果（如 growMultiplier）保留
                }).filter(Boolean);
            }
            rules.envRules = (rules.envRules || []).filter(r => (r.effects || []).length > 0);

            // ============================================================
            // ★ 5. 转换：商店 effect.target（仅 env 类型）
            // ============================================================
            for (const item of shop.items || []) {
                if (item.effect?.type === 'env' && item.effect.target) {
                    const realKey = normalizeKey(item.effect.target);
                    if (realKey) {
                        item.effect.target = realKey;
                    } else {
                        console.warn(`[MapFarmGen] 商店 ${item.name} 引用了未知属性 "${item.effect.target}"，已忽略`);
                        item.effect = null;
                    }
                }
            }
            shop.items = (shop.items || []).filter(it => it.effect);

            // ============================================================
            // 6. 校验：产物是否齐全
            // ============================================================
            const envKeys = new Set(Object.keys(rules.env));
            const productNames = new Set(Object.keys(rules.products));

            for (const [cropId, crop] of Object.entries(rules.crops || {})) {
                for (const ek of Object.keys(crop.envReq || {})) {
                    if (!envKeys.has(ek)) {
                        console.warn(`[MapFarmGen] 作物 ${cropId} 引用了不存在的属性 ${ek}`);
                        delete crop.envReq[ek];
                    }
                }
                const item = crop.yield?.item;
                if (item && !productNames.has(item)) {
                    console.warn(`[MapFarmGen] 作物 ${cropId} 的产物 "${item}" 未定义，自动补全`);
                    rules.products[item] = {
                        name: item,
                        icon: crop.emoji || '📦',
                        description: `${crop.name}的产物`,
                        type: 'item',
                        stackable: true,
                        maxStack: 99,
                        fields: {
                            '类型': '材料', '可堆叠': '是', '最大堆叠': '99',
                            '货币种类': '金钱', '买价': '2', '卖价': '5',
                        },
                    };
                    productNames.add(item);
                }
            }

            // ============================================================
            // 7. 兜底
            // ============================================================
            if (Object.keys(rules.env).length === 0) {
                console.warn('[MapFarmGen] 环境属性为空，使用默认');
                rules.env = {
                    moisture: { key: 'moisture', label: '湿度', emoji: '💧', default: 60, decay: -2, min: 0, max: 100 },
                    fertility: { key: 'fertility', label: '肥力', emoji: '🌱', default: 80, decay: 0, min: 0, max: 100 },
                };
            }

            if (Object.keys(rules.actions).length === 0) {
                rules.actions = {
                    water: { key: 'water', name: '浇水', emoji: '💧', cost: { 体力: 3 }, effect: { moisture: +40 } },
                };
            }

            if (Object.keys(rules.crops).length === 0) {
                rules.crops = {
                    wheat: {
                        id: 'wheat', name: '小麦', emoji: '🌾',
                        cost: { 金钱: 1 }, growHours: 72,
                        envReq: { moisture: { min: 40, max: 90 }, fertility: { min: 30 } },
                        yield: { item: '小麦', count: 3 },
                        stages: ['🌱', '🌿', '🌾'],
                    },
                };
                if (!rules.products['小麦']) {
                    rules.products['小麦'] = {
                        name: '小麦', icon: '🌾', description: '金黄饱满的麦粒',
                        type: 'item', stackable: true, maxStack: 99,
                        fields: { '类型': '材料', '可堆叠': '是', '最大堆叠': '99', '货币种类': '金钱', '买价': '2', '卖价': '3' },
                    };
                }
            }

            if (shop.items.length === 0) {
                shop.items = [
                    {
                        id: 'water_item', name: '井水', icon: '💧', description: '新鲜的井水',
                        price: 2, stock: 20, maxStock: 20, restockInterval: 6,
                        effect: { type: 'env', target: 'moisture', value: 30 }
                    },
                ];
            }

            console.log('[MapFarmGen] 校验完成:', {
                env: Object.keys(rules.env),
                actions: Object.keys(rules.actions),
                crops: Object.keys(rules.crops),
                products: Object.keys(rules.products),
                envRules: rules.envRules.length,
                shopItems: shop.items.length,
            });
        },
    };

    window.MapFarmGenerator = MapFarmGenerator;
    console.log('[CinemaWorld] map-farm-gen.js 已加载');
})();