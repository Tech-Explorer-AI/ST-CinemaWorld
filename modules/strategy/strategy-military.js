// ============================================================
// CinemaWorld · strategy-military.js
// 军事：战役生成 / 战斗计算 / 占领 / 势力消亡 / 每回合结算
// 依赖：strategy.js, strategy-actions.js, core.js, world.js, story.js
// ============================================================

(function () {
    'use strict';

    const StrategyManager = window.StrategyManager;
    const ActionEngine = window.ActionEngine;
    const VisualNovelManager = window.VisualNovelManager;

    // ============================================================
    // 军事引擎：战力计算 / 胜负 / 战损
    // ============================================================
    const MilitaryEngine = {

        // ------------------------------------------------------------
        // 1. 读取势力兵力
        // ------------------------------------------------------------
        getTroops(faction) {
            if (!faction) return 0;
            const fields = faction.fields || {};
            for (const key of ['兵力', '军队', '部队', '军力', '兵力值', '兵力总数']) {
                if (fields[key] !== undefined) {
                    const n = window.StrategyManager.normalizeNumber(fields[key]);
                    if (!isNaN(n.num)) return n.num;
                }
            }
            return faction.military?.troops ?? 5000;
        },

        getMorale(faction) {
            if (!faction) return 70;
            const fields = faction.fields || {};
            for (const key of ['士气', '民心', '军心']) {
                if (fields[key] !== undefined) {
                    const n = window.StrategyManager.normalizeNumber(fields[key]);
                    if (!isNaN(n.num)) return Math.min(100, n.num);
                }
            }
            return faction.military?.morale ?? 70;
        },

        getMilitaryTech(faction) {
            if (!faction) return 30;
            const fields = faction.fields || {};
            for (const key of ['军事科技', '科技', '军备']) {
                if (fields[key] !== undefined) {
                    const n = window.StrategyManager.normalizeNumber(fields[key]);
                    if (!isNaN(n.num)) return Math.min(100, n.num);
                }
            }
            return faction.military?.militaryTech ?? 30;
        },

        getWarExhaustion(factionId) {
            const f = StrategyManager.ensureStore().factions[factionId];
            return f?.military?.warExhaustion ?? 0;
        },

        // ------------------------------------------------------------
        // 2. 将领能力
        // ------------------------------------------------------------
        getCommanderAbility(commanderName, factionId) {
            if (!commanderName) return 50;
            const f = StrategyManager.ensureStore().factions[factionId];
            if (!f?.delegation) return 50;
            const member = f.delegation.find(m => m.name === commanderName);
            if (!member) return 50;
            const fields = member.fields || {};
            for (const key of ['能力', '统率', '武力', '军略']) {
                if (fields[key] !== undefined) {
                    const m = String(fields[key]).match(/^(\d+(?:\.\d+)?)/);
                    if (m) return Math.min(100, parseFloat(m[1]));
                }
            }
            return 50;
        },

        // ------------------------------------------------------------
        // 3. 地区防御信息
        // ------------------------------------------------------------
        getRegionDefense(region) {
            if (!region) return { garrison: 0, fortification: 1.0, terrain: '未知', terrainModifier: 1.0 };

            if (region.military && region.military.garrison !== undefined) {
                return {
                    garrison: region.military.garrison,
                    fortification: region.military.fortification ?? 1.0,
                    terrain: region.military.terrain ?? '未知',
                    terrainModifier: region.military.terrainModifier ?? 1.0,
                };
            }

            let garrison = 0;
            let fortification = 1.0;
            if (region.factionPresence) {
                for (const [, fields] of Object.entries(region.factionPresence)) {
                    if (fields.守军) {
                        const n = window.StrategyManager.normalizeNumber(fields.守军);
                        if (!isNaN(n.num)) garrison += n.num;
                    }
                    if (fields.控制) {
                        const n = window.StrategyManager.normalizeNumber(fields.控制);
                        if (!isNaN(n.num) && n.num > 50) fortification = 1.5;
                    }
                }
            }
            if (region.fields?.守军) {
                const n = window.StrategyManager.normalizeNumber(region.fields.守军);
                if (!isNaN(n.num)) garrison = n.num;
            }

            return { garrison, fortification, terrain: '未知', terrainModifier: 1.0 };
        },

        // ------------------------------------------------------------
        // 4. 计算单侧战力
        // ------------------------------------------------------------
        computePower(side, context = {}) {
            let power = side.troops || 0;
            let multiplier = 1.0;
            const details = [];

            // ① 将领能力
            if (side.commander) {
                const ability = this.getCommanderAbility(side.commander, side.factionId);
                const factor = 0.8 + (ability / 100) * 0.4;   // 0.8 ~ 1.2
                multiplier *= factor;
                details.push({ label: `将领 ${side.commander}`, value: Math.round((factor - 1) * 100) });
            }

            // ② 士气
            const morale = side.morale ?? 70;
            const moraleFactor = 0.7 + (morale / 100) * 0.6;   // 0.7 ~ 1.3
            multiplier *= moraleFactor;
            details.push({ label: `士气 ${morale}`, value: Math.round((moraleFactor - 1) * 100) });

            // ③ 防御方加成
            if (side.isDefender) {
                const defense = side.defense ?? 1.0;
                multiplier *= defense;
                details.push({ label: `防御 ×${defense.toFixed(1)}`, value: Math.round((defense - 1) * 100) });
            }

            // ④ 军事科技
            const tech = side.militaryTech ?? this.getMilitaryTech(
                StrategyManager.ensureStore().factions[side.factionId]
            );
            const techFactor = 0.9 + (tech / 100) * 0.2;   // 0.9 ~ 1.1
            multiplier *= techFactor;
            details.push({ label: `军事科技 ${tech}`, value: Math.round((techFactor - 1) * 100) });

            // ⑤ 战争疲劳
            const exhaustion = side.warExhaustion ?? this.getWarExhaustion(side.factionId);
            const exhaustFactor = 1 - (exhaustion / 100) * 0.3;   // 0.7 ~ 1.0
            multiplier *= exhaustFactor;
            if (exhaustion > 0) {
                details.push({ label: `战争疲劳 ${exhaustion}`, value: Math.round((exhaustFactor - 1) * 100) });
            }

            const finalPower = Math.round(power * multiplier);
            return { power: finalPower, rawPower: power, multiplier, details };
        },

        // ------------------------------------------------------------
        // 5. 战役预估（UI 展示 + 执行时复用）
        // ------------------------------------------------------------
        computePreview(campaign, context = {}) {
            const attacker = campaign.forces.attacker;
            const defender = campaign.forces.defender;

            const atkResult = this.computePower(attacker, context);
            const defResult = this.computePower({ ...defender, isDefender: true }, context);

            const total = atkResult.power + defResult.power;
            const atkRatio = total > 0 ? atkResult.power / total : 0.5;

            // 胜率压缩到 5-95
            let winChance = atkRatio * 100;
            winChance = Math.max(5, Math.min(95, winChance));

            // 战损：势均力敌损失大
            const intensity = total > 0
                ? Math.min(atkResult.power, defResult.power) / Math.max(atkResult.power, defResult.power)
                : 0.5;
            const lossFactor = 0.15 + intensity * 0.35;

            const attackerLossMin = Math.round(attacker.troops * lossFactor * 0.5);
            const attackerLossMax = Math.round(attacker.troops * lossFactor * 1.2);
            const defenderLossMin = Math.round(defender.troops * lossFactor * 0.5);
            const defenderLossMax = Math.round(defender.troops * lossFactor * 1.2);

            // 修正项明细
            const modifiers = [];
            for (const d of atkResult.details) {
                modifiers.push({ label: `我方·${d.label}`, value: d.value });
            }
            for (const d of defResult.details) {
                modifiers.push({ label: `敌方·${d.label}`, value: -d.value });
            }

            return {
                winChance: Math.round(winChance),
                atkPower: atkResult.power,
                defPower: defResult.power,
                attackerLoss: { min: attackerLossMin, max: attackerLossMax },
                defenderLoss: { min: defenderLossMin, max: defenderLossMax },
                modifiers,
            };
        },

        // ------------------------------------------------------------
        // 6. 结算战役
        // ------------------------------------------------------------
        resolve(campaign, context = {}) {
            const preview = this.computePreview(campaign, context);
            const roll = Math.random() * 100;
            const winner = roll < preview.winChance ? 'attacker' : 'defender';

            // 战损
            const attackerLoss = Math.round(
                preview.attackerLoss.min +
                Math.random() * (preview.attackerLoss.max - preview.attackerLoss.min)
            );
            const defenderLoss = Math.round(
                preview.defenderLoss.min +
                Math.random() * (preview.defenderLoss.max - preview.defenderLoss.min)
            );

            return {
                winner,
                roll,
                preview,
                attackerLoss: Math.min(attackerLoss, campaign.forces.attacker.troops),
                defenderLoss: Math.min(defenderLoss, campaign.forces.defender.troops),
            };
        },
    };

    // ============================================================
    // 战役管理器
    // ============================================================
    const MilitaryManager = {
        _generating: false,

        // ------------------------------------------------------------
        // 存储
        // ------------------------------------------------------------
        ensureStore() {
            const s = StrategyManager.ensureStore();
            if (!s.campaigns) s.campaigns = [];           // 待执行的战役
            if (!s.ongoingCampaigns) s.ongoingCampaigns = [];  // 进行中的多回合战役
            if (!s.militaryHistory) s.militaryHistory = [];
            return s;
        },

        getCampaign(id) {
            const store = this.ensureStore();
            return store.campaigns.find(c => c.id === id)
                || store.ongoingCampaigns.find(c => c.id === id)
                || null;
        },

        getCampaignsByTarget(targetType, targetId) {
            return this.ensureStore().campaigns.filter(c =>
                c.target?.[targetType === 'faction' ? 'factionId' : 'regionId'] === targetId &&
                c.status === 'planned'
            );
        },

        // ------------------------------------------------------------
        // 生成战役
        // ------------------------------------------------------------
        async generateCampaigns(targetType, targetId, context = '') {
            if (this._generating) return null;
            this._generating = true;

            try {
                const store = StrategyManager.ensureStore();
                const target = targetType === 'faction'
                    ? store.factions[targetId]
                    : store.regions[targetId];
                if (!target) return null;

                const playerFaction = StrategyManager.getPlayerFaction();
                if (!playerFaction) return null;

                const playerTroops = MilitaryEngine.getTroops(playerFaction);
                const playerMorale = MilitaryEngine.getMorale(playerFaction);
                const playerTech = MilitaryEngine.getMilitaryTech(playerFaction);

                const targetTroops = targetType === 'faction'
                    ? MilitaryEngine.getTroops(target)
                    : MilitaryEngine.getRegionDefense(target).garrison;

                const regions = StrategyManager.getRegions();
                const regionsText = regions.map(r => {
                    const def = MilitaryEngine.getRegionDefense(r);
                    return `- ${r.icon} ${r.name}：守军 ${def.garrison}，防御 ×${def.fortification.toFixed(1)}，地形 ${def.terrain}`;
                }).join('\n');

                const delegationText = (playerFaction.delegation || []).map(m =>
                    `- ${m.name}（${m.title || ''}，能力 ${m.fields?.能力 || 50}，立场 ${m.stance || '中立'}）`
                ).join('\n') || '（无代表团）';

                const targetDesc = targetType === 'faction'
                    ? `目标势力：${target.icon} ${target.name}\n${StrategyManager._formatFactionFields(target)}\n兵力：${targetTroops}，士气：${MilitaryEngine.getMorale(target)}`
                    : `目标地区：${target.icon} ${target.name}\n${StrategyManager._formatRegionFields(target)}`;

                const prompt = `你正在为一个视觉小说游戏生成"军事行动"。
军事行动消耗兵力，夺取地区，甚至消灭势力。失败会损兵折将。

【我方势力】
${playerFaction.icon} ${playerFaction.name}
${StrategyManager._formatFactionFields(playerFaction)}
军事：兵力 ${playerTroops}，士气 ${playerMorale}，军事科技 ${playerTech}

【目标】
${targetDesc}

【相关地区】
${regionsText || '（无）'}

【我方代表团（可选将领）】
${delegationText}

${context ? `【玩家要求】\n${context}\n` : ''}

【任务】
生成 3-4 个军事行动，覆盖不同规模。

【输出格式】（严格遵守）

- 【行动名|图标】：描述，[类型:attack|目标:目标名|消耗:兵力-5000,粮草-3000]
  将领: 将领名
  兵力投入: 5000
  成功剧情:
  【旁白】: 大军压境，旌旗蔽日……
  【我方将领|显示|中|男|振奋】: 冲锋！
  成功效果:
  地区数据:
  - 地区名: 控制权 → 我方
  势力数据:
  - 我方势力: 兵力 -1200, 威望 +10
  失败剧情:
  【旁白】: 城墙上箭如雨下……
  失败效果:
  势力数据:
  - 我方势力: 兵力 -2000, 威望 -15

【规则】
1. 类型：attack（夺取）/ raid（劫掠）/ annex（吞并势力）。
2. 兵力投入不能超过我方总兵力 ${playerTroops}。
3. 将领必须从上方代表团中选择，或写"（无）"。
4. 成功效果必须包含：地区占领（attack/annex）或资源缴获（raid），以及兵力损失。
5. 失败效果必须包含：兵力损失、威望下降。
6. 剧情 3-8 行。
7. 所有描述用中文。

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'strategy-military');
                if (!result) return null;

                const campaigns = this._parseCampaigns(result, targetType, targetId);
                if (campaigns.length === 0) return null;

                // 保留已执行的，替换同目标的 planned
                store.campaigns = [
                    ...store.campaigns.filter(c =>
                        !(c.target?.[targetType === 'faction' ? 'factionId' : 'regionId'] === targetId
                          && c.status === 'planned')
                    ),
                    ...campaigns,
                ];

                if (window.SaveManager) window.SaveManager.save();
                return campaigns;
            } finally {
                this._generating = false;
            }
        },

        // ------------------------------------------------------------
        // 解析战役
        // ------------------------------------------------------------
        _parseCampaigns(text, targetType, targetId) {
            const campaigns = [];
            const blocks = [];
            let cur = null;
            for (const raw of text.split('\n')) {
                const line = raw.trim();
                if (line.startsWith('- 【')) {
                    if (cur) blocks.push(cur);
                    cur = line.substring(1).trim();
                } else if (cur !== null) {
                    cur += '\n' + raw;
                }
            }
            if (cur) blocks.push(cur);

            for (const block of blocks) {
                const c = this._parseCampaignBlock(block, targetType, targetId);
                if (c) campaigns.push(c);
            }
            return campaigns;
        },

        _parseCampaignBlock(block, targetType, targetId) {
            const firstLine = block.split('\n')[0];
            const nameM = firstLine.match(/^【(.+?)】/);
            if (!nameM) return null;

            const parts = nameM[1].split('|').map(s => s.trim());
            const campaign = {
                id: `camp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                kind: 'military',
                name: parts[0] || '',
                icon: '⚔️',
                type: 'attack',
                hint: '',
                target: { regionId: null, factionId: null, name: '' },
                forces: {
                    attacker: {
                        factionId: StrategyManager.getPlayerFaction()?.id,
                        troops: 0,
                        commander: null,
                        morale: 70,
                    },
                    defender: {
                        factionId: null,
                        troops: 0,
                        commander: null,
                        defense: 1.0,
                        morale: 70,
                    },
                },
                onSuccess: {},
                onFailure: {},
                status: 'planned',
                createdAt: Date.now(),
            };
            if (parts[1]) {
                const e = window.WorldManager?._extractEmoji(parts[1]);
                if (e) campaign.icon = e;
            }

            // 第一行括号元数据
            const afterName = firstLine.substring(nameM[0].length).replace(/^[：:]\s*/, '');
            const bracketM = afterName.match(/^([\s\S]*?)\s*[\[【]([^\]】]+)[\]】]\s*$/);
            if (bracketM) {
                campaign.hint = bracketM[1].trim();
                for (const f of bracketM[2].split('|')) {
                    const kv = f.match(/^(.+?)[:：]\s*(.+)$/);
                    if (!kv) continue;
                    const k = kv[1].trim();
                    const v = kv[2].trim();
                    if (k === '类型') campaign.type = this._normalizeType(v);
                    else if (k === '目标') campaign.target.name = v;
                    else if (k === '消耗') campaign.cost = this._parseCost(v);
                }
            } else {
                campaign.hint = afterName.trim();
            }

            // 默认目标
            if (targetType === 'faction') campaign.target.factionId = targetId;
            else campaign.target.regionId = targetId;

            // 将领
            const cmdM = block.match(/将领[:：]\s*(.+)/);
            if (cmdM) {
                const name = cmdM[1].trim();
                if (name && name !== '（无）' && name !== '(无)') {
                    campaign.forces.attacker.commander = name;
                }
            }

            // 兵力投入
            const troopsM = block.match(/兵力投入[:：]\s*([\d,，]+)/);
            if (troopsM) {
                campaign.forces.attacker.troops = parseInt(troopsM[1].replace(/[,，]/g, '')) || 0;
            }

            // 成功/失败分支
            campaign.onSuccess = this._parseBranch(block, '成功');
            campaign.onFailure = this._parseBranch(block, '失败');

            if (!campaign.name) return null;
            return campaign;
        },

        _normalizeType(v) {
            v = v.toLowerCase();
            if (v.includes('raid') || v.includes('劫')) return 'raid';
            if (v.includes('annex') || v.includes('吞并') || v.includes('灭')) return 'annex';
            if (v.includes('siege') || v.includes('围')) return 'siege';
            if (v.includes('defend') || v.includes('守')) return 'defend';
            return 'attack';
        },

        _parseCost(text) {
            const cost = {};
            const parts = text.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
            for (const part of parts) {
                const m = part.match(/^(.+?)\s*([+\-])\s*(.+)$/);
                if (!m) continue;
                const n = window.StrategyManager.normalizeNumber(m[3]);
                if (isNaN(n.num)) continue;
                cost[m[1].trim()] = m[2] === '+' ? n.num : -n.num;
            }
            return cost;
        },

        // 关键：修复版 _parseBranch（用 indexOf 而非动态正则）
        _parseBranch(block, label) {
            const isSuccess = label === '成功';

            const effStart = block.indexOf(`${label}效果`);
            if (effStart === -1) return {};

            let effEnd = block.length;
            if (isSuccess) {
                const failIdx = block.indexOf('失败效果', effStart + label.length + 2);
                if (failIdx !== -1) effEnd = failIdx;
            }
            const content = block.substring(effStart + `${label}效果`.length, effEnd)
                .replace(/^[：:]\s*\n?/, '');

            const scriptKey = `${label}剧情`;
            const scriptIdx = content.indexOf(scriptKey);
            let script = '';
            let effText = content;

            if (scriptIdx !== -1) {
                effText = content.substring(0, scriptIdx).trim();
                script = content.substring(scriptIdx + scriptKey.length)
                    .replace(/^[：:]\s*\n?/, '')
                    .trim();
            }

            const effectPart = effText ? `【效果】\n${effText}` : '';
            return { script, effectPart };
        },

        // ------------------------------------------------------------
        // 执行战役
        // ------------------------------------------------------------
        async executeCampaign(campaignId) {
            const campaign = this.getCampaign(campaignId);
            if (!campaign) return { ok: false, reason: '战役不存在' };
            if (campaign.status !== 'planned') return { ok: false, reason: '战役已执行' };

            const store = StrategyManager.ensureStore();
            const playerFaction = StrategyManager.getPlayerFaction();

            // 1. 填充攻方数据
            campaign.forces.attacker.factionId = playerFaction.id;
            if (!campaign.forces.attacker.morale) {
                campaign.forces.attacker.morale = MilitaryEngine.getMorale(playerFaction);
            }

            // 2. 填充守方数据
            this._fillDefender(campaign);

            // 3. 校验兵力
            const playerTroops = MilitaryEngine.getTroops(playerFaction);
            if (campaign.forces.attacker.troops <= 0) {
                campaign.forces.attacker.troops = Math.min(playerTroops, Math.round(playerTroops * 0.5));
            }
            if (campaign.forces.attacker.troops > playerTroops) {
                campaign.forces.attacker.troops = playerTroops;
            }

            // 4. 计算预估
            campaign.preview = MilitaryEngine.computePreview(campaign);

            // 5. 消耗
            if (campaign.cost) {
                ActionEngine._applyCost(campaign.cost, {});
            }

            // 6. 结算
            const result = MilitaryEngine.resolve(campaign);
            campaign.outcome = result;
            campaign.resolvedAt = Date.now();

            // 7. 应用战斗结果（消耗兵力 + 播放剧情 + 效果）
            await this._applyOutcome(campaign, result);

            campaign.status = 'resolved';

            // 8. 记录历史
            store.militaryHistory.push({
                type: 'campaign',
                name: campaign.name,
                campaignType: campaign.type,
                winner: result.winner,
                turn: store.turnCount,
                timestamp: Date.now(),
            });

            if (window.SaveManager) window.SaveManager.save();
            return { ok: true, campaign, result };
        },

        _fillDefender(campaign) {
            const store = StrategyManager.ensureStore();

            if (campaign.target.regionId) {
                const region = store.regions[campaign.target.regionId];
                if (region) {
                    const def = MilitaryEngine.getRegionDefense(region);
                    campaign.forces.defender.troops = def.garrison;
                    campaign.forces.defender.defense = def.fortification;
                    // 找控制方
                    const controllerName = this._findControllerName(region);
                    if (controllerName) {
                        const controller = Object.values(store.factions).find(f => f.name === controllerName);
                        if (controller) {
                            campaign.forces.defender.factionId = controller.id;
                            campaign.forces.defender.morale = MilitaryEngine.getMorale(controller);
                            campaign.forces.defender.militaryTech = MilitaryEngine.getMilitaryTech(controller);
                        }
                    }
                    if (!campaign.forces.defender.troops) {
                        campaign.forces.defender.troops = 500;
                    }
                }
            } else if (campaign.target.factionId) {
                const faction = store.factions[campaign.target.factionId];
                if (faction) {
                    campaign.forces.defender.factionId = faction.id;
                    campaign.forces.defender.troops = Math.round(MilitaryEngine.getTroops(faction) * 0.7);
                    campaign.forces.defender.morale = MilitaryEngine.getMorale(faction);
                    campaign.forces.defender.militaryTech = MilitaryEngine.getMilitaryTech(faction);
                    campaign.forces.defender.defense = faction.military?.defense ?? 1.3;
                }
            }
        },

        _findControllerName(region) {
            if (!region.factionPresence) return null;
            let bestName = null;
            let bestControl = 0;
            for (const [name, fields] of Object.entries(region.factionPresence)) {
                const n = fields.控制 ? window.StrategyManager.normalizeNumber(fields.控制) : { num: 0 };
                const ctrl = isNaN(n.num) ? 0 : n.num;
                if (ctrl > bestControl) {
                    bestControl = ctrl;
                    bestName = name;
                }
            }
            return bestName;
        },

        // ------------------------------------------------------------
        // 应用战役结果
        // ------------------------------------------------------------
        async _applyOutcome(campaign, result) {
            const store = StrategyManager.ensureStore();
            const branch = result.winner === 'attacker'
                ? campaign.onSuccess
                : campaign.onFailure;

            // 1. 播放剧情
            if (branch.script) {
                const dialogues = VisualNovelManager.parseScript(branch.script);
                if (dialogues.length > 0) await VisualNovelManager.play(dialogues);
            }

            // 2. 我方兵力损失
            const playerFaction = StrategyManager.getPlayerFaction();
            if (playerFaction && result.attackerLoss > 0) {
                StrategyManager._changeField(
                    playerFaction.fields, '兵力', 'subtract', result.attackerLoss
                );
                // 如果兵力字段不存在，写到 military
                if (playerFaction.fields.兵力 === undefined) {
                    playerFaction.military = playerFaction.military || {};
                    playerFaction.military.troops =
                        Math.max(0, (playerFaction.military.troops || 0) - result.attackerLoss);
                }
            }

            // 3. 敌方兵力损失
            if (campaign.forces.defender.factionId && result.defenderLoss > 0) {
                const defFaction = store.factions[campaign.forces.defender.factionId];
                if (defFaction) {
                    StrategyManager._changeField(
                        defFaction.fields, '兵力', 'subtract', result.defenderLoss
                    );
                    if (defFaction.fields.兵力 === undefined) {
                        defFaction.military = defFaction.military || {};
                        defFaction.military.troops =
                            Math.max(0, (defFaction.military.troops || 0) - result.defenderLoss);
                    }
                }
            }

            // 4. 应用剧情的效果
            if (branch.effectPart) {
                await StrategyManager._applyStrategyEffect(branch.effectPart);
            }

            // 5. 特殊处理：占领 / 劫掠 / 吞并
            if (result.winner === 'attacker') {
                if (campaign.type === 'attack' || campaign.type === 'annex' || campaign.type === 'siege') {
                    if (campaign.target.regionId) {
                        await this.captureRegion(campaign.target.regionId, playerFaction.id, campaign);
                    }
                }
                if (campaign.type === 'raid' && campaign.target.regionId) {
                    await this._applyRaid(campaign);
                }
                if (campaign.type === 'annex' && campaign.target.factionId) {
                    await this.destroyFaction(campaign.target.factionId, playerFaction.id, campaign);
                }
            } else {
                // 防守方胜利 → 攻方必须撤退，不改控制权
            }

            // 6. 战争疲劳
            this._addWarExhaustion(playerFaction.id, 5);
            if (campaign.forces.defender.factionId) {
                this._addWarExhaustion(campaign.forces.defender.factionId, 3);
            }
        },

        // ------------------------------------------------------------
        // 占领地区
        // ------------------------------------------------------------
        async captureRegion(regionId, winnerFactionId, campaign) {
            const store = StrategyManager.ensureStore();
            const region = store.regions[regionId];
            const winner = store.factions[winnerFactionId];
            if (!region || !winner) return;

            region.military = region.military || {};
            region.military.controller = winnerFactionId;
            region.military.garrison = Math.round(campaign.forces.attacker.troops * 0.3);
            region.military.fortification = 1.2;

            // 更新 factionPresence
            if (!region.factionPresence) region.factionPresence = {};
            region.factionPresence[winner.name] = {
                _order: ['控制', '守军'],
                控制: '100',
                守军: String(region.military.garrison),
            };

            // 降低原控制方的控制度
            for (const [name, fields] of Object.entries(region.factionPresence)) {
                if (name === winner.name) continue;
                if (fields.控制) {
                    const n = window.StrategyManager.normalizeNumber(fields.控制);
                    const cur = isNaN(n.num) ? 0 : n.num;
                    const next = Math.max(0, cur - 50);
                    fields.控制 = String(next);
                    if (next === 0) delete region.factionPresence[name];
                }
            }

            region.updatedAt = Date.now();

            // 记录
            store.militaryHistory.push({
                type: 'region_captured',
                region: region.name,
                by: winner.name,
                turn: store.turnCount,
                timestamp: Date.now(),
            });

            await window.UIManager.showText(`🏴 ${region.name} 已被 ${winner.name} 占领`, 2500);
        },

        // ------------------------------------------------------------
        // 劫掠
        // ------------------------------------------------------------
        async _applyRaid(campaign) {
            const store = StrategyManager.ensureStore();
            const region = store.regions[campaign.target.regionId];
            const playerFaction = StrategyManager.getPlayerFaction();
            if (!region || !playerFaction) return;

            // 缴获资源
            const loot = Math.round(campaign.forces.attacker.troops * 0.5);
            StrategyManager._changeField(playerFaction.fields, '粮草', 'add', loot);

            // 地区民心下降
            if (region.fields?.民心) {
                StrategyManager._changeField(region.fields, '民心', 'subtract', 10);
            }
            region.military = region.military || {};
            region.military.garrison = Math.max(0, (region.military.garrison || 0) - Math.round(campaign.forces.defender.troops * 0.5));

            await window.UIManager.showText(`💰 劫掠所得：粮草 +${loot}`, 2000);
        },

        // ------------------------------------------------------------
        // 消灭势力
        // ------------------------------------------------------------
        async destroyFaction(factionId, winnerId, campaign) {
            const store = StrategyManager.ensureStore();
            const faction = store.factions[factionId];
            const winner = store.factions[winnerId];
            if (!faction || !winner) return;

            // 1. 所有该势力的地区转给胜方
            for (const region of Object.values(store.regions)) {
                if (region.military?.controller === factionId ||
                    this._findControllerName(region) === faction.name) {
                    region.military = region.military || {};
                    region.military.controller = winnerId;
                    if (!region.factionPresence) region.factionPresence = {};
                    region.factionPresence[winner.name] = {
                        _order: ['控制'],
                        控制: '100',
                    };
                    delete region.factionPresence[faction.name];
                }
            }

            // 2. 标记势力为灭亡（不删除）
            faction.destroyed = true;
            faction.destroyedAt = store.turnCount;
            faction.destroyedBy = winnerId;

            // 3. 清理关系
            for (const f of Object.values(store.factions)) {
                if (f.relations?.[faction.name]) delete f.relations[faction.name];
            }

            // 4. 记录
            store.militaryHistory.push({
                type: 'faction_destroyed',
                faction: faction.name,
                by: winner.name,
                turn: store.turnCount,
                timestamp: Date.now(),
            });

            // 5. 剧情
            const script = `【旁白】: ${faction.name}的旗帜在最后的城头落下。\n【旁白】: 一个时代结束了。`;
            const dialogues = VisualNovelManager.parseScript(script);
            if (dialogues.length > 0) await VisualNovelManager.play(dialogues);

            await window.UIManager.showText(`💀 ${faction.name} 已灭亡`, 3000);
        },

        // ------------------------------------------------------------
        // 战争疲劳
        // ------------------------------------------------------------
        _addWarExhaustion(factionId, delta) {
            const store = StrategyManager.ensureStore();
            const f = store.factions[factionId];
            if (!f) return;
            f.military = f.military || {};
            f.military.warExhaustion = Math.max(0, Math.min(100, (f.military.warExhaustion || 0) + delta));
        },

        // ------------------------------------------------------------
        // 每回合结算
        // ------------------------------------------------------------
        async settleTurn() {
            const store = this.ensureStore();
            const events = [];

            // 1. 战争疲劳自然恢复
            for (const f of Object.values(store.factions)) {
                if (f.destroyed) continue;
                if (!f.military) f.military = {};
                if (f.military.warExhaustion > 0) {
                    f.military.warExhaustion = Math.max(0, f.military.warExhaustion - 2);
                }
            }

            // 2. 兵力为 0 的势力 → 自动崩溃
            for (const f of Object.values(store.factions)) {
                if (f.isPlayer || f.destroyed) continue;
                const troops = MilitaryEngine.getTroops(f);
                if (troops <= 0) {
                    const playerFaction = StrategyManager.getPlayerFaction();
                    if (playerFaction) {
                        await this.destroyFaction(f.id, playerFaction.id, {
                            name: '兵力崩溃',
                            forces: { attacker: { troops: 0 } },
                        });
                        events.push({
                            type: 'faction_collapsed',
                            faction: f.name,
                            desc: `${f.name}兵力枯竭，政权崩溃`,
                        });
                    }
                }
            }

            // 3. 敌方 AI 主动进攻
            const enemyAttacks = await this._generateEnemyAttacks();
            for (const atk of enemyAttacks) {
                const result = await this._resolveEnemyAttack(atk);
                if (result) events.push(result);
            }

            return { events };
        },

        // ------------------------------------------------------------
        // 敌方 AI 主动进攻
        // ------------------------------------------------------------
        async _generateEnemyAttacks() {
            const store = StrategyManager.ensureStore();
            const playerFaction = StrategyManager.getPlayerFaction();
            if (!playerFaction) return [];

            // 关系差、兵力足的势力可能进攻
            const enemies = Object.values(store.factions).filter(f => {
                if (f.isPlayer || f.destroyed) return false;
                const rel = playerFaction.relations?.[f.name];
                const troops = MilitaryEngine.getTroops(f);
                return (rel?.value ?? 0) < -20 && troops > 500;
            });
            if (enemies.length === 0) return [];

            const playerRegions = Object.values(store.regions).filter(r => {
                return this._findControllerName(r) === playerFaction.name;
            });
            if (playerRegions.length === 0) return [];

            const prompt = `你正在为一个视觉小说游戏判断"敌方是否发动军事进攻"。

【我方势力】
${playerFaction.icon} ${playerFaction.name}
兵力：${MilitaryEngine.getTroops(playerFaction)}

【潜在敌方】
${enemies.map(f => `- ${f.icon} ${f.name}：兵力 ${MilitaryEngine.getTroops(f)}，关系 ${playerFaction.relations?.[f.name]?.value || 0}`).join('\n')}

【我方地区】
${playerRegions.map(r => `- ${r.icon} ${r.name}：守军 ${MilitaryEngine.getRegionDefense(r).garrison}`).join('\n')}

【任务】
选择 0-2 个势力，让它们对我方某地区发动进攻。
如果没有合理的进攻，输出"无"。

【输出格式】

【势力名】
目标地区: 地区名
兵力投入: N
进攻理由: 一段话
剧情:
【旁白】: ...

如果没有进攻，只输出：
无

请开始生成：`;

            const result = await window.generateFunctionalReply(prompt, 'strategy-military-ai');
            if (!result || result.trim() === '无') return [];

            return this._parseEnemyAttacks(result, enemies, playerRegions);
        },

        _parseEnemyAttacks(text, enemies, playerRegions) {
            const attacks = [];
            const blocks = [];
            let cur = null;
            for (const raw of text.split('\n')) {
                const line = raw.trim();
                if (/^【[^】]+】\s*$/.test(line) && !/【旁白/.test(line)) {
                    if (cur) blocks.push(cur);
                    cur = line;
                } else if (cur !== null) {
                    cur += '\n' + raw;
                }
            }
            if (cur) blocks.push(cur);

            for (const block of blocks) {
                const nameM = block.match(/^【(.+?)】/);
                if (!nameM) continue;
                const attacker = enemies.find(f => f.name === nameM[1].trim());
                if (!attacker) continue;

                const regionM = block.match(/目标地区[:：]\s*(.+)/);
                const troopsM = block.match(/兵力投入[:：]\s*([\d,，]+)/);
                const scriptM = block.match(/剧情[:：]\s*([\s\S]*?)$/);

                const region = playerRegions.find(r => r.name === regionM?.[1]?.trim());
                if (!region) continue;

                attacks.push({
                    attackerId: attacker.id,
                    attackerName: attacker.name,
                    regionId: region.id,
                    regionName: region.name,
                    troops: parseInt(troopsM?.[1]?.replace(/[,，]/g, '') || '1000'),
                    script: scriptM ? scriptM[1].trim() : '',
                });
            }
            return attacks;
        },

        async _resolveEnemyAttack(atk) {
            const store = StrategyManager.ensureStore();
            const attacker = store.factions[atk.attackerId];
            const region = store.regions[atk.regionId];
            const playerFaction = StrategyManager.getPlayerFaction();
            if (!attacker || !region || !playerFaction) return null;

            const campaign = {
                id: `enemy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: `${attacker.name} 进攻 ${region.name}`,
                type: 'attack',
                forces: {
                    attacker: {
                        factionId: attacker.id,
                        troops: atk.troops,
                        morale: MilitaryEngine.getMorale(attacker),
                        militaryTech: MilitaryEngine.getMilitaryTech(attacker),
                    },
                    defender: {
                        factionId: playerFaction.id,
                        troops: MilitaryEngine.getRegionDefense(region).garrison,
                        morale: MilitaryEngine.getMorale(playerFaction),
                        militaryTech: MilitaryEngine.getMilitaryTech(playerFaction),
                        defense: MilitaryEngine.getRegionDefense(region).fortification,
                    },
                },
            };

            const result = MilitaryEngine.resolve(campaign);

            // 播放剧情
            if (atk.script) {
                const dialogues = VisualNovelManager.parseScript(atk.script);
                if (dialogues.length > 0) await VisualNovelManager.play(dialogues);
            }

            // 结果
            if (result.winner === 'attacker') {
                // 敌方占领我方地区
                region.military = region.military || {};
                region.military.controller = attacker.id;
                if (!region.factionPresence) region.factionPresence = {};
                region.factionPresence[attacker.name] = { _order: ['控制'], 控制: '100' };
                delete region.factionPresence[playerFaction.name];

                await window.UIManager.showText(`💥 ${region.name} 失守！`, 2500);
            } else {
                // 我方守住了
                await window.UIManager.showText(`🛡️ 击退了 ${attacker.name} 的进攻`, 2500);
            }

            // 兵力损失
            StrategyManager._changeField(playerFaction.fields, '兵力', 'subtract', result.defenderLoss);
            StrategyManager._changeField(attacker.fields, '兵力', 'subtract', result.attackerLoss);

            store.militaryHistory.push({
                type: 'enemy_attack',
                attacker: attacker.name,
                region: region.name,
                winner: result.winner,
                turn: store.turnCount,
                timestamp: Date.now(),
            });

            return {
                type: 'enemy_attack',
                attacker: attacker.name,
                region: region.name,
                winner: result.winner,
                desc: `${attacker.name} 进攻 ${region.name}（${result.winner === 'attacker' ? '我方失守' : '我方击退'}）`,
            };
        },
    };

    window.MilitaryEngine = MilitaryEngine;
    window.MilitaryManager = MilitaryManager;
    console.log('[CinemaWorld] strategy-military.js 已加载');
})();