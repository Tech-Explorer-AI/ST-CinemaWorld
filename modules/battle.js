// ============================================================
// CinemaWorld · battle.js
// 战斗系统：切片 / 敌人 / 规则 / 内核 / UI / 特效
// 依赖：core.js, world.js, player.js, rules.js, interact.js
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const WorldManager = window.WorldManager;
    const DiceEngine = window.DiceEngine;
    const PlayerStateManager = window.PlayerStateManager;
    const TagEffectManager = window.TagEffectManager;
    const DerivedStatsEngine = window.DerivedStatsEngine;
    const SpriteManager = window.SpriteManager;
    const MusicManager = window.MusicManager;

    // ============================================================
    // 战斗包切片器
    // ============================================================
    const BattlePackageSlicer = {
        TAGS: [
            '战前剧情', '战斗规则', '战斗行动',
            '战后剧情·胜利', '战后剧情·失败',
            '战斗奖励', '场景更新', '胜利摘要',
        ],

        MUSIC_TAGS: ['战前音乐', '战中音乐', '战后音乐'],

        slice(text) {
            const sections = {};
            if (!text || typeof text !== 'string') return sections;

            const tagPattern = this.TAGS
                .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('|');

            const musicPattern = this.MUSIC_TAGS
                .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                .join('|');
            const stopPattern = `${tagPattern}|${musicPattern}`;

            const regex = new RegExp(
                `(?:^|\\n)【(${tagPattern})】[ \\t]*\\n?([\\s\\S]*?)(?=\\n【(?:${stopPattern})】|$)`,
                'g'
            );

            let m;
            while ((m = regex.exec(text)) !== null) {
                const tag = m[1].trim();
                let content = m[2].replace(/^\s*\n/, '').replace(/\s+$/, '');
                if (!content) continue;
                if (sections[tag]) sections[tag] += '\n' + content;
                else sections[tag] = content;
            }

            sections.__music = this._parseMusic(text);

            return sections;
        },

        _parseMusic(text) {
            const result = { 战前音乐: '', 战中音乐: '', 战后音乐: '' };
            if (!text) return result;

            let musicBlock = text;
            const blockMatch = text.match(/【音乐提示】\s*([\s\S]*?)(?=\n【[^】|]+】|$)/);
            if (blockMatch) {
                musicBlock = blockMatch[1];
            }

            for (const tag of this.MUSIC_TAGS) {
                const re = new RegExp(`${tag}\\s*[:：]\\s*([^\\n]*)`);
                const m = musicBlock.match(re);
                if (m) {
                    let v = m[1].trim();
                    v = v.replace(/[（(][^）)]*[）)]/g, '').trim();
                    v = v.replace(/^["'「『]|["'」』]$/g, '').trim();
                    if (/^(无|留空|none|no|空|—|-)$/i.test(v)) v = '';
                    result[tag] = v;
                }
            }

            return result;
        },

        debug(text) {
            const s = this.slice(text);
            const keys = Object.keys(s).filter(k => k !== '__music');
            console.log('[BattlePackageSlicer] 切出', keys.length, '块:',
                keys.map(k => `${k}(${s[k].length}字)`).join(', '));
            console.log('[BattlePackageSlicer] 音乐:', s.__music);
            return s;
        },
    };

    // ============================================================
    // 敌人数据转换
    // ============================================================
        // ============================================================
    // 敌人数据转换
    // ============================================================
    const EnemyBuilder = {
        fromSceneItem(item) {
            if (!item) return null;
            const f = item.fields || {};

            // ---------- 保留原始字段，构建 stats ----------
            const stats = {};
            const specialKeys = new Set([
                '类型', '状态', '功能', '图标', 'icon', '交互', '交互方式',
                '技能', '技能列表', '掉落', '战利品',
            ]);

            let hp = { current: 100, max: 100 };
            let hpKey = 'HP';

            for (const [k, v] of Object.entries(f)) {
                if (k.startsWith('_pos')) continue;
                if (specialKeys.has(k)) continue;

                // ---------- HP 特殊处理 ----------
                if (/^(HP|生命|生命值|血量|气血)$/i.test(k)) {
                    const m = String(v).match(/^(\d+)\s*\/\s*(\d+)$/);
                    if (m) {
                        hp = { current: parseInt(m[1]), max: parseInt(m[2]) };
                        hpKey = k;
                        continue;
                    }
                    const n = parseInt(String(v).replace(/[^\d]/g, ''));
                    if (!isNaN(n) && n > 0) {
                        hp = { current: n, max: n };
                        hpKey = k;
                        continue;
                    }
                }

                // ---------- 其他字段：能解析成数字就存数字 ----------
                const rawStr = String(v).trim();
                const num = parseFloat(rawStr.replace(/[^\d.\-]/g, ''));
                if (!isNaN(num) && /^[+\-]?\d/.test(rawStr)) {
                    stats[k] = num;
                } else {
                    stats[k] = v;
                }
            }

            // ---------- 默认槽位 ----------
            const attack  = this._pick(stats, ['攻击', '攻击力', '力量', '攻击强度'], 10);
            const defense = this._pick(stats, ['防御', '防御力', '护甲', '体质'], 5);
            const speed   = this._pick(stats, ['敏捷', '速度', '先攻', '闪避'], 10);

            // ---------- 额外属性（UI 展示 + 公式引用）----------
            const extra = {};
            const order = [];
            const slotKeys = new Set([
                '攻击', '攻击力', '力量', '攻击强度',
                '防御', '防御力', '护甲', '体质',
                '敏捷', '速度', '先攻', '闪避',
            ]);
            for (const [k, v] of Object.entries(stats)) {
                if (slotKeys.has(k)) continue;
                extra[k] = v;
                order.push(k);
            }

            const skills = this.parseSkills(f['技能'] || f['技能列表']);
            const drops = this.parseDrops(f['掉落'] || f['战利品']);

            let icon = item.icon;
            if (!icon || icon === '📦') {
                icon = WorldManager._extractEmoji(item.name)
                    || WorldManager._extractEmoji(item.description)
                    || '👹';
            }

            // 兜底旧 extraStats（保持向后兼容）
            const extraStats = { _order: [], _raw: '' };
            for (const [k, v] of Object.entries(extra)) {
                extraStats[k] = String(v);
                extraStats._order.push(k);
            }
            extraStats._raw = extraStats._order.map(k => `${k}:${extraStats[k]}`).join('|');

            return {
                id: `enemy_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: item.name,
                icon,
                description: item.description || '',
                stats: {
                    hp,
                    attack,
                    defense,
                    speed,
                    extra,
                    _order: order,
                    _hpKey: hpKey,
                },
                skills,
                drops,
                extraStats,
                statusTags: [],
                isAlive: hp.current > 0,
                sourceItemName: item.name,
                createdAt: Date.now(),
            };
        },

        // ★ 从候选键里挑第一个有值的
        _pick(stats, keys, dflt) {
            for (const k of keys) {
                if (stats[k] !== undefined && stats[k] !== '') {
                    const n = parseFloat(String(stats[k]).replace(/[^\d.\-]/g, ''));
                    if (!isNaN(n)) return n;
                }
            }
            return dflt;
        },

        parseSkills(raw) {
            if (!raw) return [];
            const parts = String(raw)
                .split(/[、,，;；]/)
                .map(s => s.trim())
                .filter(Boolean);

            return parts.map(p => {
                const skill = {
                    name: p,
                    type: 'skill',
                    cooldown: 0,
                    usesLeft: null,
                    formula: null,
                    cost: {},          // 消耗自身资源
                    effects: [],       // 附加效果
                    hint: '',
                    icon: '⚡',
                };

                // ---------- 名字 + 括号说明 ----------
                const m = p.match(/^(.+?)\s*[（(](.+)[)）]\s*$/);
                if (!m) {
                    // 没括号：纯名字，尝试从名字猜类型
                    skill.type = this._guessSkillType(skill.name);
                    skill.icon = this._guessSkillIcon(skill.type);
                    return skill;
                }

                skill.name = m[1].trim();
                skill.hint = m[2].trim();

                // ---------- 冷却 ----------
                const cd = skill.hint.match(/每\s*(\d+)\s*回合/);
                if (cd) skill.cooldown = parseInt(cd[1]);

                // ---------- 次数 ----------
                const uses = skill.hint.match(/限\s*(\d+)\s*次|次数[:：]?\s*(\d+)/);
                if (uses) skill.usesLeft = parseInt(uses[1] || uses[2]);

                // ---------- 类型 ----------
                skill.type = this._guessSkillType(skill.name + ' ' + skill.hint);
                skill.icon = this._guessSkillIcon(skill.type);

                // ---------- 公式（优先显式，否则从倍率抠） ----------
                const explicitFormula = skill.hint.match(/公式[:：]\s*([^，,；;）)]+)/);
                if (explicitFormula) {
                    skill.formula = explicitFormula[1].trim();
                } else {
                    const mult = skill.hint.match(/[×xX*]\s*(\d+(?:\.\d+)?)/);
                    if (mult) {
                        // ★ 根据类型选默认公式模板
                        if (skill.type === 'heal') {
                            skill.formula = `{攻击} * ${mult[1]}`;
                        } else if (skill.type === 'magic') {
                            // 魔法类优先用灵力/智力
                            skill.formula = `({灵力} || {智力} || {攻击}) * ${mult[1]}`;
                        } else {
                            skill.formula = `{攻击} * ${mult[1]}`;
                        }
                    }
                }

                // ---------- 消耗 ----------
                // 消耗:HP:20 或 消耗HP:20 或 消耗:20
                const costMatch = skill.hint.match(/消耗\s*([\u4e00-\u9fa5A-Za-z]+)?\s*[:：]?\s*(\d+)/);
                if (costMatch) {
                    const costKey = costMatch[1] || 'HP';
                    skill.cost[costKey] = parseInt(costMatch[2]);
                }

                // ---------- 附加效果 ----------
                // 效果:玩家攻击-30%|持续2回合
                const effectMatch = skill.hint.match(/效果[:：]\s*([^，,；;）)]+)/);
                if (effectMatch) {
                    skill.effects = this._parseSkillEffects(effectMatch[1].trim());
                } else {
                    // 从关键词提取常见效果
                    if (/吸血|汲取生命|吸取/.test(skill.hint)) {
                        skill.effects.push({ type: 'drain', ratio: 0.5 });
                    }
                    if (/眩晕|昏眩|定身/.test(skill.hint)) {
                        skill.effects.push({
                            type: 'debuff_player',
                            name: '眩晕',
                            effect: { 跳过回合: true },
                            duration: 1,
                        });
                    }
                    if (/中毒|剧毒/.test(skill.hint)) {
                        skill.effects.push({
                            type: 'debuff_player',
                            name: '中毒',
                            effect: { 每回合: { 生命: -5 } },
                            duration: 3,
                        });
                    }
                    if (/燃烧|灼烧/.test(skill.hint)) {
                        skill.effects.push({
                            type: 'debuff_player',
                            name: '燃烧',
                            effect: { 每回合: { 生命: -8 } },
                            duration: 2,
                        });
                    }
                    if (/狂暴|强化|战意/.test(skill.hint)) {
                        skill.effects.push({
                            type: 'buff_self',
                            name: '狂暴',
                            effect: { 属性: { 攻击: 0.5 } },
                            duration: 3,
                        });
                    }
                    if (/回复|治疗|自愈/.test(skill.hint)) {
                        skill.type = 'heal';
                        skill.icon = '💚';
                    }
                }

                return skill;
            });
        },

        // ★ 从名字/描述猜技能类型
        _guessSkillType(text) {
            const s = String(text);
            if (/治疗|回复|自愈|回血|治愈|恢复/.test(s)) return 'heal';
            if (/防御|格挡|护盾|铁壁|硬化/.test(s)) return 'defend';
            if (/眩晕|定身|恐惧|沉默|束缚|debuff|削弱/.test(s)) return 'debuff';
            if (/狂暴|强化|战意|buff|增伤/.test(s)) return 'buff';
            if (/吸血|汲取|吸取|drain/.test(s)) return 'drain';
            if (/召唤|分身|援军/.test(s)) return 'summon';
            if (/火|冰|雷|风|光|暗|魔法|法术|咒/.test(s)) return 'magic';
            return 'skill';
        },

        // ★ 类型对应图标
        _guessSkillIcon(type) {
            switch (type) {
                case 'heal':   return '💚';
                case 'defend': return '🛡';
                case 'debuff': return '🌀';
                case 'buff':   return '🔥';
                case 'drain':  return '🩸';
                case 'summon': return '👥';
                case 'magic':  return '✨';
                default:       return '⚔️';
            }
        },

        // ★ 解析效果字符串 → 结构化
        // 输入："玩家攻击-30%|持续2回合" 或 "自身防御+50%|持续3回合"
        _parseSkillEffects(str) {
            const effects = [];

            // 按 | 拆：主效果 + 修饰
            const parts = String(str).split('|').map(s => s.trim()).filter(Boolean);
            let main = parts[0] || '';
            let duration = 3;

            for (const p of parts.slice(1)) {
                const dm = p.match(/持续\s*(\d+)\s*回合/);
                if (dm) duration = parseInt(dm[1]);
            }

            // 主效果：目标 + 属性 + 增减
            // 玩家攻击-30% / 自身防御+50% / 敌人速度-5
            const m = main.match(/^(玩家|自身|敌人|目标)([\u4e00-\u9fa5A-Za-z]+)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*(%|％)?$/);
            if (m) {
                const target = m[1];
                const attr = m[2];
                const sign = m[3] === '-' ? -1 : 1;
                let val = parseFloat(m[4]);
                if (m[5]) val = val / 100;
                else if (val >= 2) val = val / 100;

                let type = 'debuff_player';
                if (target === '自身') type = 'buff_self';
                else if (target === '敌人') type = 'debuff_enemy';

                effects.push({
                    type,
                    name: `${attr}${sign > 0 ? '提升' : '削弱'}`,
                    effect: { 属性: { [attr]: sign * val } },
                    duration,
                });
            } else if (/眩晕|定身/.test(main)) {
                effects.push({
                    type: 'debuff_player',
                    name: '眩晕',
                    effect: { 跳过回合: true },
                    duration: 1,
                });
            } else if (/吸血|汲取/.test(main)) {
                effects.push({ type: 'drain', ratio: 0.5 });
            }

            return effects;
        },

        parseDrops(raw) {
            if (!raw) return [];
            const parts = String(raw)
                .split(/[、,，;；]/)
                .map(s => s.trim())
                .filter(Boolean);

            return parts.map(p => {
                const m = p.match(/^(.+?)\s*[×xX*]\s*(\d+)\s*$/);
                if (m) {
                    return { name: m[1].trim(), count: parseInt(m[2]) };
                }
                return { name: p, count: 1 };
            });
        },
    };

    // ============================================================
    // 战斗规则管理
    // ============================================================
    const BattleRuleManager = {
        DEFAULT_RULES: {
            damageFormula: '{攻击} - {防御}',
            hitFormula: null,
            hitThreshold: 0,
            critFormula: 'd20',
            critThreshold: 20,
            critMultiplier: 1.5,
            critRateCap: 0.8,
            initiativeFormula: 'd20 + {敏捷}',
            victoryCondition: 'enemy_hp_zero',
            defeatCondition: 'player_hp_zero',
            attrMap: {
                attack: '攻击',
                defense: '防御',
                speed: '敏捷',
                hp: '生命值',
            },
            raw: '',
        },

        parse(text) {
            if (!text || typeof text !== 'string') return null;

            const rules = {
                ...this.DEFAULT_RULES,
                attrMap: { ...this.DEFAULT_RULES.attrMap },
                raw: text,
            };

            const get = (label) => {
                const re = new RegExp(`${label}[:：]\\s*(.+)`);
                const m = text.match(re);
                return m ? m[1].trim() : '';
            };

            const dmg = get('伤害公式');
            if (dmg) rules.damageFormula = dmg;

            const hit = get('命中判定');
            if (hit) {
                const m = hit.match(/^(.+?)\s*(?:>=|≥)\s*(\d+)$/);
                if (m) {
                    rules.hitFormula = m[1].trim();
                    rules.hitThreshold = parseInt(m[2]);
                } else {
                    rules.hitFormula = hit;
                    rules.hitThreshold = 10;
                }
            }

            const crit = get('暴击');
            if (crit) {
                const m = crit.match(/伤害?\s*[×xX*]\s*(\d+(?:\.\d+)?)/);
                if (m) rules.critMultiplier = parseFloat(m[1]);
                const cap = crit.match(/上限\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%?/);
                if (cap) {
                    const n = parseFloat(cap[1]);
                    rules.critRateCap = n > 1 ? n / 100 : n;
                }
            }

            const init = get('先攻');
            if (init) rules.initiativeFormula = init;

            const vic = get('胜利条件');
            if (vic) {
                if (/敌人?\s*HP\s*归零|敌人死亡|全灭/i.test(vic)) rules.victoryCondition = 'enemy_hp_zero';
                else rules.victoryCondition = vic;
            }

            const def = get('失败条件');
            if (def) {
                if (/玩家?\s*HP\s*归零|玩家死亡/i.test(def)) rules.defeatCondition = 'player_hp_zero';
                else rules.defeatCondition = def;
            }

            const cap = get('暴击率上限');
            if (cap) {
                const n = parseFloat(cap.replace(/[^\d.]/g, ''));
                if (!isNaN(n)) rules.critRateCap = n > 1 ? n / 100 : n;
            }

            // ★ 属性映射：支持任意属性名
            const mapStr = get('属性映射');
            if (mapStr) {
                const pairs = mapStr.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
                for (const p of pairs) {
                    const m = p.match(/^(.+?)\s*[=＝]\s*(.+)$/);
                    if (!m) continue;
                    const key = m[1].trim();
                    const val = m[2].trim();
                    if (/^攻击|attack$/i.test(key))   rules.attrMap.attack  = val;
                    else if (/^防御|defense$/i.test(key)) rules.attrMap.defense = val;
                    else if (/^敏捷|速度|speed$/i.test(key)) rules.attrMap.speed = val;
                    else if (/^生命|HP$/i.test(key))      rules.attrMap.hp      = val;
                }
            }

            // ★ 特殊判定（供未来扩展）
            const special = get('特殊判定');
            if (special) {
                rules.specialChecks = special
                    .split(/[;；]/)
                    .map(s => s.trim())
                    .filter(Boolean);
            }

            console.log('[BattleRuleManager] 规则已解析:', rules);
            return rules;
        },

        getCurrent() {
            return CinemaWorld.worldState.combat?.battleRules || null;
        },

        save(rules) {
            if (!CinemaWorld.worldState.combat) {
                CinemaWorld.worldState.combat = { activeCombat: null, battleRules: null, history: [] };
            }
            CinemaWorld.worldState.combat.battleRules = rules;
            if (window.SaveManager) window.SaveManager.save();
        },

        needsGeneration() {
            if (CinemaWorld.worldState.gameRules) {
                const hasCombatRule = /【战斗规则】/.test(CinemaWorld.worldState.gameRules);
                if (hasCombatRule && this.getCurrent()) {
                    return false;
                }
            }
            return !this.getCurrent();
        }
    };

    // ============================================================
    // 战斗特效管理器
    // ============================================================
    const BattleEffectManager = {
        popup(targetSelector, text, type = 'damage') {
            const target = document.querySelector(targetSelector);
            if (!target) {
                console.warn('[BattleFX] target not found:', targetSelector);
                return;
            }

            const rect = target.getBoundingClientRect();
            const el = document.createElement('div');
            el.className = `cw-battle-popup cw-battle-popup-${type}`;
            el.textContent = text;
            el.style.left = `${rect.left + rect.width / 2}px`;
            el.style.top = `${rect.top + rect.height * 0.3}px`;
            el.style.opacity = '1';

            document.body.appendChild(el);

            setTimeout(() => el.remove(), 1800);
        },

        shake(targetSelector, intensity = 'medium') {
            const target = document.querySelector(targetSelector);
            if (!target) return;

            const cls = `cw-shake-${intensity}`;
            target.classList.remove('cw-shake-light', 'cw-shake-medium', 'cw-shake-heavy');
            void target.offsetWidth;
            target.classList.add(cls);

            setTimeout(() => target.classList.remove(cls), 600);
        },

        flash(targetSelector, color = 'red') {
            const target = document.querySelector(targetSelector);
            if (!target) return;

            const cls = color === 'red' ? 'cw-flash-red' : 'cw-flash-green';
            target.classList.remove('cw-flash-red', 'cw-flash-green');
            void target.offsetWidth;
            target.classList.add(cls);

            setTimeout(() => target.classList.remove(cls), 600);
        },

        shakeScreen(intensity = 'medium') {
            const container = document.querySelector('.cw-battle-container');
            if (!container) return;
            this.shake('.cw-battle-container', intensity);
        },

        flashScreen(color = 'red') {
            const overlay = document.createElement('div');
            overlay.className = `cw-battle-screen-flash cw-battle-screen-flash-${color}`;
            document.body.appendChild(overlay);
            overlay.addEventListener('animationend', () => overlay.remove());
        },

        killEnemy(targetSelector) {
            const target = document.querySelector(targetSelector);
            if (!target) return;
            target.classList.add('cw-enemy-dying');
        },

        impact(targetSelector) {
            const target = document.querySelector(targetSelector);
            if (!target) return;

            const rect = target.getBoundingClientRect();
            const wave = document.createElement('div');
            wave.className = 'cw-battle-impact';
            wave.style.left = `${rect.left + rect.width / 2}px`;
            wave.style.top = `${rect.top + rect.height / 2}px`;
            document.body.appendChild(wave);
            wave.addEventListener('animationend', () => wave.remove());
        },
    };

    // ============================================================
    // 战斗内核
    // ============================================================
    const BattleManager = {
        _runtime: {
            defending: false,
            playerCooldowns: {},
            enemyCooldowns: {},
        },

        startBattle(pkg, enemyItemName) {
            const scene = window.LocationModalManager.currentLocation;
            const player = PlayerStateManager.player;

            const enemy = pkg.enemy;

            const playerStats = this.getPlayerStats();

            const initiative = this.rollInitiative(playerStats, enemy);
            const playerFirst = initiative.player >= initiative.enemy;

            const combat = {
                id: `combat_${Date.now()}`,
                startedAt: Date.now(),
                sceneName: scene?.name || '',
                enemyItemName,
                enemies: [enemy],
                actionPool: pkg.actionPool,
                rules: pkg.rules,
                turn: 1,
                phase: 'player',
                log: [],
                result: null,
                package: {
                    preScript:      pkg.sections['战前剧情'] || '',
                    victoryScript:  pkg.sections['战后剧情·胜利'] || '',
                    defeatScript:   pkg.sections['战后剧情·失败'] || '',
                    rewards:        pkg.sections['战斗奖励'] || '',
                    sceneUpdate:    pkg.sections['场景更新'] || '',
                    victorySummary: pkg.sections['胜利摘要'] || '',
                    preMusic:       pkg.sections.__music?.战前音乐 || '',
                    battleMusic:    pkg.sections.__music?.战中音乐 || '',
                    postMusic:      pkg.sections.__music?.战后音乐 || '',
                },
                playerFirst,
            };

            if (!CinemaWorld.worldState.combat) {
                CinemaWorld.worldState.combat = { activeCombat: null, battleRules: null, history: [] };
            }
            CinemaWorld.worldState.combat.activeCombat = combat;

            this._runtime = {
                defending: false,
                playerCooldowns: {},
                enemyCooldowns: {},
            };

            const normalizeTags = (tags) => (tags || []).map(t => {
                if (typeof t === 'object' && t.name) return t;
                const name = String(t);
                const effect = TagEffectManager.getEffect(name);
                return {
                    name,
                    effect: effect || null,
                    duration: effect?.持续 ?? null,
                };
            });

            PlayerStateManager.player.tags = normalizeTags(PlayerStateManager.player.tags);
            for (const e of combat.enemies) {
                e.statusTags = normalizeTags(e.statusTags);
            }

            this.log(`⚔️ 战斗开始！`);
            this.log(`先攻判定：${playerFirst ? '你先出手' : '敌人先出手'}`);

            if (window.SaveManager) window.SaveManager.save();
            return combat;
        },

        getActive() {
            return CinemaWorld.worldState.combat?.activeCombat || null;
        },

        getPlayerStats() {
            const player = PlayerStateManager.player;
            const rules = this.getActive()?.rules || BattleRuleManager.DEFAULT_RULES;
            const bonuses = player.equipment?.bonuses || {};
            const attrMap = rules.attrMap || {};

            // ---------- 基础属性 ----------
            const attrContext = {};
            for (const [k, v] of Object.entries(player.attributes || {})) {
                const base = typeof v === 'object' ? (v.value ?? 0) : Number(v) || 0;
                attrContext[k] = base + (bonuses[k] || 0);
            }

            // ---------- 派生属性 ----------
            const computed = player.derivedStats?.computed || {};
            const derived = {};
            for (const [k, v] of Object.entries(computed)) {
                derived[k] = typeof v === 'object' ? (v.current ?? 0) : Number(v) || 0;
            }

            // ---------- 数值条 ----------
            const bars = player.statusBars || [];
            let hp = { current: 100, max: 100 };
            const hpBar = bars.find(b => /生命|血量|HP|hp|气血/i.test(b.key));
            if (hpBar) hp = { current: hpBar.current, max: hpBar.max };

            // ---------- 额外属性池 ----------
            // ★ 顺序（后面的不覆盖前面的）：
            //   派生 < 基础 < 装备（仅补缺） < 额外数据（仅补缺） < 数值条
            //
            // ★ 关键修复：不要再把 bonuses 裸塞进去覆盖 derived
            //   因为 DerivedStatsEngine._buildContext 里 ctx[k] = base + bonuses[k]，
            //   derived[k] 已经"包含"了装备加成。
            //   如果 bonuses[k] 在 derived 里已有同名键，再塞一遍就会覆盖派生值
            //   （导致 {近战攻击} 取到 4 而不是 22）
            const allAttrs = {
                ...derived,
                ...attrContext,
            };

            // 装备加成：只补派生和基础里都没有的键
            for (const [k, v] of Object.entries(bonuses)) {
                if (allAttrs[k] === undefined) {
                    allAttrs[k] = v;
                }
            }

            // 额外数据（玩家面板那些自由键，比如"混沌:15"、"魅力:10"）
            const extraStats = player.extraStats;
            if (extraStats && Array.isArray(extraStats._order)) {
                for (const k of extraStats._order) {
                    if (allAttrs[k] !== undefined) continue;
                    const raw = String(extraStats[k] ?? '');
                    const m = raw.match(/^(-?\d+(?:\.\d+)?)/);
                    if (m) allAttrs[k] = parseFloat(m[1]);
                }
            }

            // 数值条（当前值）
            for (const bar of bars) {
                if (bar.key) allAttrs[bar.key] = bar.current;
                if (bar.key && bar.max !== undefined) allAttrs[bar.key + '上限'] = bar.max;
            }

            // ---------- 默认槽位查找 ----------
            // ★ 关键修复：基础属性优先于派生属性
            const findValue = (keys, dflt) => {
                for (const k of keys) {
                    if (k && attrContext[k] !== undefined) return attrContext[k];
                    if (k && derived[k] !== undefined) return derived[k];
                }
                return dflt;
            };

            const attackKey  = attrMap.attack  || '攻击';
            const defenseKey = attrMap.defense || '防御';
            const speedKey   = attrMap.speed   || '敏捷';

            const stats = {
                name: player.name || '主人公',
                hp,
                attack:  findValue([attackKey, '攻击', '攻击力', '力量'], 10),
                defense: findValue([defenseKey, '防御', '防御力', '护甲', '体质'], 5),
                speed:   findValue([speedKey, '敏捷', '速度', '先攻'], 10),
                critRate:   this._findCritRate(player, derived, attrContext, bonuses),
                critDamage: this._findCritDamage(player, derived, attrContext, bonuses),

                extra: allAttrs,

                _hpBarRef: hpBar || null,
                _derived: derived,
                _attrs: attrContext,
            };

            const tags = player.tags || [];
            const withMods = TagEffectManager.applyAttributeModifiers(stats, tags);

            withMods.extra = stats.extra;
            withMods._hpBarRef = stats._hpBarRef;
            withMods._derived = stats._derived;
            withMods._attrs = stats._attrs;
            withMods.critRate = stats.critRate;
            withMods.critDamage = stats.critDamage;

            console.log('[Battle] 玩家战斗属性:', {
                attack: withMods.attack,
                defense: withMods.defense,
                speed: withMods.speed,
                extra: {
                    混沌: allAttrs['混沌'],
                    魅力: allAttrs['魅力'],
                    幸运: allAttrs['幸运'],
                },
            });

            return withMods;
        },

        _findCritRate(player, derived, attrContext, bonuses) {
            const KEYS = ['暴击率', '暴击', '会心', '会心率', '暴击几率', 'critRate', 'crit'];

            for (const k of KEYS) {
                if (derived[k] !== undefined) return Number(derived[k]) || 0;
            }
            for (const k of KEYS) {
                if (attrContext[k] !== undefined) return Number(attrContext[k]) || 0;
            }
            for (const k of KEYS) {
                if (bonuses[k] !== undefined) return Number(bonuses[k]) || 0;
            }
            const extra = player.extraStats;
            if (extra && extra._order) {
                for (const k of KEYS) {
                    if (extra[k] !== undefined) {
                        const m = String(extra[k]).match(/-?\d+(?:\.\d+)?/);
                        if (m) return parseFloat(m[0]) || 0;
                    }
                }
            }
            return 0;
        },

        _findCritDamage(player, derived, attrContext, bonuses) {
            const KEYS = ['暴击伤害', '暴击倍率', 'critDamage', 'critMult'];
            for (const k of KEYS) {
                if (derived[k] !== undefined) return Number(derived[k]) || 1.5;
                if (attrContext[k] !== undefined) return Number(attrContext[k]) || 1.5;
                if (bonuses[k] !== undefined) return Number(bonuses[k]) || 1.5;
            }
            const extra = player.extraStats;
            if (extra && extra._order) {
                for (const k of KEYS) {
                    if (extra[k] !== undefined) {
                        const m = String(extra[k]).match(/-?\d+(?:\.\d+)?/);
                        if (m) {
                            let v = parseFloat(m[0]);
                            if (v < 10) v = v;
                            else v = v / 100;
                            return v || 1.5;
                        }
                    }
                }
            }
            return 1.5;
        },

        rollInitiative(playerStats, enemy) {
            const rules = this.getActive()?.rules || BattleRuleManager.DEFAULT_RULES;
            const formula = rules.initiativeFormula || 'd20 + {敏捷}';
            const p = DiceEngine.roll(formula, { 敏捷: playerStats.speed });
            const e = DiceEngine.roll(formula, { 敏捷: enemy.stats.speed });
            return { player: p, enemy: e };
        },

        log(text) {
            const combat = this.getActive();
            if (!combat) return;
            combat.log.push({ text, turn: combat.turn, ts: Date.now() });
            if (combat.log.length > 100) combat.log = combat.log.slice(-100);
        },

        rollHit(attackerStats, targetStats, attackerSide = 'player') {
            const rules = this.getActive()?.rules || BattleRuleManager.DEFAULT_RULES;
            if (!rules.hitFormula) return true;

            const atkSpeed = attackerStats.speed ?? 10;
            const defSpeed = targetStats.speed ?? 10;

            const roll = DiceEngine.roll(rules.hitFormula, { 敏捷: atkSpeed });
            const threshold = rules.hitThreshold + Math.floor((defSpeed - atkSpeed) / 2);

            const hit = roll >= threshold;
            this.log(hit
                ? `🎯 命中判定：${roll} >= ${threshold}，命中`
                : `💨 命中判定：${roll} < ${threshold}，闪避`
            );
            return hit;
        },

        rollCrit(attackerStats) {
            const rules = this.getActive()?.rules || BattleRuleManager.DEFAULT_RULES;

            let critRate = 0;
            if (attackerStats && attackerStats.critRate !== undefined) {
                critRate = attackerStats.critRate;
            }

            let rate = critRate;
            if (rate > 1) rate = rate / 100;
            const cap = rules.critRateCap ?? 0.8;
            rate = Math.max(0, Math.min(cap, rate));

            if (rate <= 0) return false;

            const isCrit = Math.random() < rate;
            if (isCrit) {
                this.log(`💥 暴击！（${(rate * 100).toFixed(0)}%）`);
            }
            return isCrit;
        },

        calcDamage(formula, attackerStats, targetStats, isDefending = false) {
            const combat = this.getActive();
            const rules = combat?.rules || BattleRuleManager.DEFAULT_RULES;
            const f = formula || rules.damageFormula;

            const attackerExtra = attackerStats.extra || {};
            const targetExtra   = targetStats.extra   || {};

            // ---------- 构建 ctx（顺序同 _calcDamageDetailed）----------
            const ctx = {};

            for (const [k, v] of Object.entries(attackerExtra)) ctx[k] = v;
            for (const [k, v] of Object.entries(targetExtra)) {
                if (ctx[k] === undefined) ctx[k] = v;
            }
            for (const [k, v] of Object.entries(attackerExtra)) ctx[`a_${k}`] = v;
            for (const [k, v] of Object.entries(targetExtra)) ctx[`d_${k}`] = v;

            // ★ 默认槽位最后写入
            ctx['攻击'] = playerStats.attack;
            ctx['防御'] = enemyStats ? enemyStats.defense : 0;   // ★ 改成敌人防御
            ctx['敏捷'] = playerStats.speed;
            ctx['速度'] = playerStats.speed;
            ctx['生命'] = playerStats.hp?.max || 100;
            ctx['attack']  = playerStats.attack;
            ctx['defense'] = enemyStats ? enemyStats.defense : 0; // ★
            ctx['speed']   = playerStats.speed;
            ctx['hp']      = playerStats.hp?.max || 100;

            ctx['敌人'] = new Proxy({}, {
                get(_, p) {
                    if (p in targetExtra) return targetExtra[p];
                    if (p === '攻击') return targetStats.attack;
                    if (p === '防御') return targetStats.defense;
                    if (p === '敏捷') return targetStats.speed;
                    if (p === '生命' || p === 'HP' || p === 'hp') return targetStats.hp?.max || 100;
                    return 0;
                }
            });
            ctx['我方'] = new Proxy({}, {
                get(_, p) {
                    if (p in attackerExtra) return attackerExtra[p];
                    if (p === '攻击') return attackerStats.attack;
                    if (p === '防御') return attackerStats.defense;
                    if (p === '敏捷') return attackerStats.speed;
                    if (p === '生命' || p === 'HP' || p === 'hp') return attackerStats.hp?.max || 100;
                    return 0;
                }
            });

            let dmg = DiceEngine.roll(f, ctx);
            dmg = Math.max(1, Math.round(dmg));

            if (isDefending) {
                dmg = Math.max(1, Math.round(dmg * 0.5));
                this.log(`🛡️ 防御减伤 50%`);
            }

            return dmg;
        },

        async playerAction(actionId, targetId = null) {
            const combat = this.getActive();
            if (!combat || combat.phase !== 'player') return;

            const action = combat.actionPool.find(a => a.id === actionId);
            if (!action) return { error: '行动不存在' };

            const enemy = combat.enemies.find(e => e.id === targetId && e.isAlive)
                       || combat.enemies.find(e => e.isAlive);
            if (!enemy) return { error: '没有可攻击的敌人' };

            const cd = this._runtime.playerCooldowns[actionId] || 0;
            if (cd > 0) {
                return { error: `${action.name} 冷却中（剩 ${cd} 回合）` };
            }

            if (action.usesLeft !== null && action.usesLeft <= 0) {
                return { error: `${action.name} 已用完` };
            }

            if (!this.checkAndPayCost(action.cost)) {
                return { error: '资源不足' };
            }

            this.log(`━━━ 回合 ${combat.turn} ━━━`);
            this.log(`▶ 你使用【${action.name}】`);

            let result = '';

            switch (action.type) {
                case 'attack':
                case 'skill':
                    result = await this._doAttack(action, enemy);
                    break;
                case 'heal':
                    await this._doHeal(action);
                    break;
                case 'defend':
                    this._runtime.defending = true;
                    this.log(`🛡️ 你摆出防御姿态，本回合受到的伤害减半`);
                    break;
                case 'flee':
                    const fled = await this._doFlee(enemy);
                    if (fled) return this.endBattle('fled');
                    break;
                case 'item':
                    this.log(`（道具行动暂未实现）`);
                    break;
                default:
                    result = await this._doAttack(action, enemy);
            }

            if (action.usesLeft !== null) action.usesLeft--;
            if (action.cooldown > 0) {
                this._runtime.playerCooldowns[actionId] = action.cooldown + 1;
            }

            if (this._allEnemiesDead()) {
                return this.endBattle('victory');
            }

            await this._endPlayerTurn();
            return { ok: true };
        },
        // ★ 带详细过程的命中判定
                // ★ 带详细过程的命中判定
                _rollHitDetailed(attackerStats, targetStats) {
                    const rules = this.getActive()?.rules || BattleRuleManager.DEFAULT_RULES;
                    if (!rules.hitFormula) {
                        return { hit: true, detail: '（必中）' };
                    }
        
                    const atkSpeed = attackerStats.speed ?? 10;
                    const defSpeed = targetStats.speed ?? 10;
        
                    const attackerExtra = attackerStats.extra || {};
                    const targetExtra   = targetStats.extra   || {};
        
                    // ---------- 同 calcDamage 的 ctx 构建顺序 ----------
                    const ctx = {};
                    for (const [k, v] of Object.entries(attackerExtra)) ctx[k] = v;
                    for (const [k, v] of Object.entries(targetExtra)) {
                        if (ctx[k] === undefined) ctx[k] = v;
                    }
                    for (const [k, v] of Object.entries(attackerExtra)) ctx[`a_${k}`] = v;
                    for (const [k, v] of Object.entries(targetExtra)) ctx[`d_${k}`] = v;
        
                    // 默认槽位最后写入
                    ctx['攻击'] = attackerStats.attack;
                    ctx['防御'] = targetStats.defense;
                    ctx['敏捷'] = atkSpeed;
                    ctx['速度'] = atkSpeed;
                    ctx['生命'] = attackerStats.hp?.max || 100;
                    ctx['attack']  = attackerStats.attack;
                    ctx['defense'] = targetStats.defense;
                    ctx['speed']   = atkSpeed;
                    ctx['hp']      = attackerStats.hp?.max || 100;
        
                    ctx['敌人'] = new Proxy({}, {
                        get(_, p) {
                            if (p in targetExtra) return targetExtra[p];
                            if (p === '攻击') return targetStats.attack;
                            if (p === '防御') return targetStats.defense;
                            if (p === '敏捷' || p === '速度') return defSpeed;
                            return 0;
                        }
                    });
                    ctx['我方'] = new Proxy({}, {
                        get(_, p) {
                            if (p in attackerExtra) return attackerExtra[p];
                            if (p === '攻击') return attackerStats.attack;
                            if (p === '防御') return attackerStats.defense;
                            if (p === '敏捷' || p === '速度') return atkSpeed;
                            return 0;
                        }
                    });
        
                    let roll;
                    try {
                        roll = DiceEngine.roll(rules.hitFormula, ctx);
                    } catch (e) {
                        roll = 10;
                    }
        
                    const threshold = rules.hitThreshold + Math.floor((defSpeed - atkSpeed) / 2);
                    const hit = roll >= threshold;
        
                    const formulaDisplay = rules.hitFormula.replace(
                        /\{([^}]+)\}/g,
                        (_, key) => {
                            if (key.includes('.')) {
                                const [side, attr] = key.split('.');
                                const obj = side === '敌人' ? ctx['敌人'] : ctx['我方'];
                                return `${attr}(${obj[attr]})`;
                            }
                            const v = ctx[key];
                            return `${key}(${v === undefined ? '?' : v})`;
                        }
                    );
        
                    return {
                        hit,
                        roll,
                        threshold,
                        detail: `${formulaDisplay} = ${roll} ${hit ? '≥' : '<'} ${threshold}，${hit ? '命中' : '闪避'}`,
                    };
                },
        // ★ 带详细过程的伤害计算
                // ★ 带详细过程的伤害计算
                _calcDamageDetailed(formula, attackerStats, targetStats, isDefending = false) {
                    const combat = this.getActive();
                    const rules = combat?.rules || BattleRuleManager.DEFAULT_RULES;
                    const f = formula || rules.damageFormula;
        
                    // ============================================================
                    // 1. 先构建"额外属性池"（不含默认槽位）
                    // ============================================================
                    const attackerExtra = attackerStats.extra || {};
                    const targetExtra   = targetStats.extra   || {};
        
                    // ============================================================
                    // 2. 构建最终 ctx
                    //    顺序（后面的覆盖前面的）：
                    //      a. 额外属性（裸名）
                    //      b. a_ / d_ 前缀版本
                    //      c. 默认槽位（★ 最优先，绝不允许被覆盖）
                    // ============================================================
                    const ctx = {};
        
                    // a. 攻击方的额外属性（裸名）
                    for (const [k, v] of Object.entries(attackerExtra)) {
                        ctx[k] = v;
                    }
                    // a2. 防御方的额外属性（裸名，会被攻击方同名覆盖）
                    for (const [k, v] of Object.entries(targetExtra)) {
                        if (ctx[k] === undefined) ctx[k] = v;
                    }
        
                    // b. a_ / d_ 前缀版本
                    for (const [k, v] of Object.entries(attackerExtra)) {
                        ctx[`a_${k}`] = v;
                    }
                    for (const [k, v] of Object.entries(targetExtra)) {
                        ctx[`d_${k}`] = v;
                    }
        
                    // c. ★ 默认槽位最后写入，永不被覆盖
                    ctx['攻击'] = attackerStats.attack;
                    ctx['防御'] = targetStats.defense;
                    ctx['敏捷'] = attackerStats.speed;
                    ctx['生命'] = attackerStats.hp?.max || 100;
                    ctx['attack']  = attackerStats.attack;
                    ctx['defense'] = targetStats.defense;
                    ctx['speed']   = attackerStats.speed;
                    ctx['hp']      = attackerStats.hp?.max || 100;
        
                    // ============================================================
                    // 3. 特殊命名空间
                    // ============================================================
                    ctx['敌人'] = new Proxy({}, {
                        get(_, p) {
                            if (p in targetExtra) return targetExtra[p];
                            if (p === '攻击') return targetStats.attack;
                            if (p === '防御') return targetStats.defense;
                            if (p === '敏捷') return targetStats.speed;
                            if (p === '生命' || p === 'HP' || p === 'hp') {
                                return targetStats.hp?.max || 100;
                            }
                            return 0;
                        }
                    });
                    ctx['我方'] = new Proxy({}, {
                        get(_, p) {
                            if (p in attackerExtra) return attackerExtra[p];
                            if (p === '攻击') return attackerStats.attack;
                            if (p === '防御') return attackerStats.defense;
                            if (p === '敏捷') return attackerStats.speed;
                            if (p === '生命' || p === 'HP' || p === 'hp') {
                                return attackerStats.hp?.max || 100;
                            }
                            return 0;
                        }
                    });
        
                    // ============================================================
                    // 4. 求值
                    // ============================================================
                    let value;
                    let detail;
                    try {
                        value = DiceEngine.roll(f, ctx);
        
                        // 公式展示：把 {属性} 替换成实际值
                        detail = f.replace(/\{([^}]+)\}/g, (_, key) => {
                            if (key.includes('.')) {
                                const [side, attr] = key.split('.');
                                const obj = side === '敌人' ? ctx['敌人'] : ctx['我方'];
                                return `${attr}(${obj[attr]})`;
                            }
                            const v = ctx[key];
                            return `${key}(${v === undefined ? '?' : v})`;
                        });
                        detail = `${detail} = ${value}`;
                    } catch (e) {
                        console.warn('[Battle] 伤害公式失败:', f, e);
                        value = Math.max(1, (attackerStats.attack || 10) - (targetStats.defense || 0));
                        detail = `（公式错误，回退默认 ${value}）`;
                    }
        
                    value = Math.max(1, Math.round(value));
        
                    if (isDefending) {
                        value = Math.max(1, Math.round(value * 0.5));
                        detail += ` → 防御减伤 50% → ${value}`;
                    }
        
                    return { value, detail };
                },
        // ★ 应用技能的附加效果（buff/debuff/状态/资源消耗）
        async _applyActionEffects(effects, playerStats, enemy, enemyStats) {
            for (const eff of effects) {
                switch (eff.type) {
                    case 'debuff_enemy': {
                        // 给敌人加状态
                        enemy.statusTags = enemy.statusTags || [];
                        const tag = {
                            name: eff.name,
                            effect: eff.effect || null,
                            duration: eff.duration ?? 3,
                        };
                        enemy.statusTags.push(tag);
                        this.log(`✨ ${enemy.name} 获得状态「${eff.name}」`);
                        break;
                    }
                    case 'buff_self': {
                        // 给玩家加状态
                        const player = PlayerStateManager.player;
                        player.tags = player.tags || [];
                        player.tags.push({
                            name: eff.name,
                            effect: eff.effect || null,
                            duration: eff.duration ?? 3,
                        });
                        PlayerStateManager.refreshAvatarArea();
                        this.log(`✨ 你获得状态「${eff.name}」`);
                        break;
                    }
                    case 'damage_other': {
                        // 扣其他数值条（如理智）
                        const player = PlayerStateManager.player;
                        const bar = (player.statusBars || []).find(b =>
                            b.key.includes(eff.barKey) || eff.barKey.includes(b.key)
                        );
                        if (bar) {
                            const before = bar.current;
                            bar.current = Math.max(0, bar.current - eff.value);
                            this.log(`📉 ${bar.key}: ${before} → ${bar.current}`);
                            PlayerStateManager.refreshAvatarArea();
                        }
                        break;
                    }
                    case 'heal_other': {
                        const player = PlayerStateManager.player;
                        const bar = (player.statusBars || []).find(b =>
                            b.key.includes(eff.barKey) || eff.barKey.includes(b.key)
                        );
                        if (bar) {
                            const before = bar.current;
                            bar.current = Math.min(bar.max, bar.current + eff.value);
                            this.log(`📈 ${bar.key}: ${before} → ${bar.current}`);
                            PlayerStateManager.refreshAvatarArea();
                        }
                        break;
                    }
                }
            }
        },
        async _doAttack(action, enemy) {
            const playerStats = this.getPlayerStats();
            const combat = this.getActive();
            const enemyStats = this._buildEnemyStats(enemy);

            const enemySel = '.cw-battle-panel-enemy';
            const playerSel = '.cw-battle-panel-player';

            // ---------- 命中判定 ----------
            const hitCheck = this._rollHitDetailed(playerStats, enemyStats);
            if (!hitCheck.hit) {
                this.log(`💨 ${enemy.name} 闪避了你的攻击！`);
                this.log(`  🎯 ${hitCheck.detail}`);
                BattleEffectManager.popup(enemySel, 'MISS', 'miss');
                return;
            }
            this.log(`🎯 命中判定：${hitCheck.detail}`);

            // ---------- 暴击判定 ----------
            const isCrit = this.rollCrit(playerStats);

            // ---------- 伤害公式（带详细展开） ----------
            const formula = action.formula || combat.rules.damageFormula;
            const dmgResult = this._calcDamageDetailed(formula, playerStats, enemyStats);

            let dmg = dmgResult.value;
            if (isCrit) {
                const baseMult = combat.rules.critMultiplier || 1.5;
                const playerMult = playerStats.critDamage || baseMult;
                const mult = playerMult || baseMult;
                dmg = Math.round(dmg * mult);
                this.log(`💥 暴击！伤害 ×${mult.toFixed(2)}`);
            }

            this.log(`📐 伤害公式：${dmgResult.detail}`);
            this.log(`💥 你对 ${enemy.name} 造成 ${dmg} 点伤害（剩余 HP ${Math.max(0, enemy.stats.hp.current - dmg)}/${enemy.stats.hp.max}）`);

            // ---------- 应用伤害 ----------
            enemy.stats.hp.current = Math.max(0, enemy.stats.hp.current - dmg);

            // ---------- 特效 ----------
            if (isCrit) {
                BattleEffectManager.shakeScreen('heavy');
                BattleEffectManager.impact(enemySel);
                BattleEffectManager.popup(enemySel, `-${dmg}`, 'crit');
            } else {
                BattleEffectManager.shake(enemySel, 'light');
                BattleEffectManager.flash(enemySel, 'red');
                BattleEffectManager.popup(enemySel, `-${dmg}`, 'damage');
            }

            // ---------- 附加效果（新增）----------
            if (action.effects && action.effects.length > 0) {
                await this._applyActionEffects(action.effects, playerStats, enemy, enemyStats);
            }

            // ---------- 死亡 ----------
            if (enemy.stats.hp.current <= 0) {
                enemy.isAlive = false;
                this.log(`☠️ ${enemy.name} 倒下了！`);
                BattleEffectManager.killEnemy(enemySel);
                BattleEffectManager.flashScreen('red');
            }

            BattleUIManager.render();
        },

        async _doHeal(action) {
            const playerStats = this.getPlayerStats();
            const hpBar = playerStats._hpBarRef;

            if (!hpBar) {
                this.log(`❌ 你没有生命值，无法治疗`);
                return;
            }

            if (hpBar.current >= hpBar.max) {
                this.log(`💚 你的生命值已满，治疗没有效果`);
                return;
            }

            const formula = action.formula || '{体质} * 2';
            const context = {
                攻击: playerStats.attack,
                防御: playerStats.defense,
                敏捷: playerStats.speed,
                ...(playerStats._attrs || {}),
                ...(playerStats._derived || {}),
            };

            let healAmount;
            try {
                healAmount = DiceEngine.roll(formula, context);
            } catch (e) {
                console.warn('[Battle] 治疗公式失败:', formula, e);
                healAmount = 20;
            }
            healAmount = Math.max(1, Math.round(healAmount || 0));

            const before = hpBar.current;
            hpBar.current = Math.min(hpBar.max, hpBar.current + healAmount);
            const actual = hpBar.current - before;

            PlayerStateManager.refreshAvatarArea();
            const playerSel = '.cw-battle-panel-player';
            BattleEffectManager.flash(playerSel, 'green');
            BattleEffectManager.popup(playerSel, `+${actual}`, 'heal');
            BattleUIManager.render();
            this.log(`💚 你恢复了 ${actual} 点生命（${before} → ${hpBar.current}/${hpBar.max}）`);
        },

        async _doFlee(enemy) {
            const playerStats = this.getPlayerStats();
            const formula = 'd20 + {敏捷}';
            const roll = DiceEngine.roll(formula, { 敏捷: playerStats.speed });
            const threshold = 10 + Math.floor((enemy.stats.speed - playerStats.speed) / 2);

            if (roll >= threshold) {
                this.log(`🏃 逃跑成功！（${roll} >= ${threshold}）`);
                return true;
            }
            this.log(`❌ 逃跑失败（${roll} < ${threshold}）`);
            return false;
        },

        checkAndPayCost(cost) {
            if (!cost || Object.keys(cost).length === 0) return true;
            const player = PlayerStateManager.player;

            for (const [key, val] of Object.entries(cost)) {
                const bar = (player.statusBars || []).find(b => b.key === key || b.key.includes(key));
                if (bar) {
                    if (bar.current < val) return false;
                } else if (player.extraStats?.[key] !== undefined) {
                    const num = parseFloat(String(player.extraStats[key]).replace(/[^\d.-]/g, ''));
                    if (isNaN(num) || num < val) return false;
                } else {
                    return false;
                }
            }

            for (const [key, val] of Object.entries(cost)) {
                const bar = (player.statusBars || []).find(b => b.key === key || b.key.includes(key));
                if (bar) {
                    bar.current = Math.max(0, bar.current - val);
                } else if (player.extraStats?.[key] !== undefined) {
                    const raw = String(player.extraStats[key]);
                    const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                    if (m) {
                        const after = Math.max(0, parseFloat(m[1]) - val);
                        player.extraStats[key] = `${after}${m[2] || ''}`;
                    }
                }
            }
            PlayerStateManager.refreshAvatarArea();
            return true;
        },

        async _endPlayerTurn() {
            const combat = this.getActive();
            if (!combat || combat.result) return;

            await this._applyPerTurnEffects(PlayerStateManager.player, '玩家');

            for (const k of Object.keys(this._runtime.playerCooldowns)) {
                this._runtime.playerCooldowns[k] = Math.max(0, this._runtime.playerCooldowns[k] - 1);
            }

            combat.phase = 'enemy';
            BattleUIManager.render();
            await new Promise(r => setTimeout(r, 600));

            for (const enemy of combat.enemies.filter(e => e.isAlive)) {
                await this._enemyTurn(enemy);
                if (this._playerDead()) {
                    return this.endBattle('defeat');
                }
            }

            for (const enemy of combat.enemies.filter(e => e.isAlive)) {
                await this._applyPerTurnEffects(enemy, enemy.name, 'statusTags');
            }

            this._tickDurations(PlayerStateManager.player, 'tags');
            for (const enemy of combat.enemies) {
                this._tickDurations(enemy, 'statusTags');
            }

            combat.turn++;
            combat.phase = 'player';
            this._runtime.defending = false;

            BattleUIManager.render();
            if (window.SaveManager) window.SaveManager.save();
        },

        async _applyPerTurnEffects(target, label, tagsKey = 'tags') {
            const tags = target[tagsKey] || [];
            const effects = TagEffectManager.getPerTurnEffects(tags);
            if (effects.length === 0) return;

            const bars = target.statusBars || [];
            const extra = target.extraStats;

            for (const eff of effects) {
                for (const [key, value] of Object.entries(eff.changes)) {
                    const bar = bars.find(b => b.key === key || b.key.includes(key));
                    if (bar) {
                        const before = bar.current;
                        bar.current = Math.max(0, Math.min(bar.max, bar.current + value));
                        const diff = bar.current - before;
                        if (diff !== 0) {
                            const sign = diff > 0 ? '+' : '';
                            this.log(`☠️ ${label} 因「${eff.tagName}」${sign}${diff} ${bar.key}`);
                        }
                        continue;
                    }

                    if (extra && extra[key] !== undefined) {
                        const raw = String(extra[key]);
                        const m = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                        if (m) {
                            const before = parseFloat(m[1]);
                            const unit = m[2] || '';
                            const after = Math.max(0, before + value);
                            extra[key] = `${after}${unit}`;
                            const diff = after - before;
                            if (diff !== 0) {
                                const sign = diff > 0 ? '+' : '';
                                this.log(`☠️ ${label} 因「${eff.tagName}」${sign}${diff} ${key}`);
                            }
                        }
                    }
                }
            }

            if (typeof PlayerStateManager !== 'undefined') {
                PlayerStateManager.refreshAvatarArea();
            }
        },

        _tickDurations(target, tagsKey = 'tags') {
            const tags = target[tagsKey];
            if (!Array.isArray(tags)) return;

            const newTags = [];
            for (const tag of tags) {
                if (typeof tag === 'string') {
                    newTags.push(tag);
                    continue;
                }
                if (tag.duration === null || tag.duration === undefined) {
                    newTags.push(tag);
                    continue;
                }
                tag.duration -= 1;
                if (tag.duration <= 0) {
                    this.log(`✨ ${tag.name} 效果结束`);
                    continue;
                }
                newTags.push(tag);
            }

            if (newTags.length !== tags.length) {
                target[tagsKey] = newTags;
                if (typeof PlayerStateManager !== 'undefined') {
                    PlayerStateManager.refreshAvatarArea();
                }
            }
        },

        async _enemyTurn(enemy) {
            const combat = this.getActive();
            if (!combat) return;

            const enemySel = '.cw-battle-panel-enemy';
            const playerSel = '.cw-battle-panel-player';

            // ---------- 状态检查 ----------
            if (TagEffectManager.shouldSkipTurn(enemy.statusTags || [])) {
                this.log(`💫 ${enemy.name} 因状态无法行动`);
                BattleEffectManager.popup(enemySel, '无法行动', 'info');
                BattleUIManager.render();
                await new Promise(r => setTimeout(r, 400));
                return;
            }

            const playerStats = this.getPlayerStats();
            const enemyStats = this._buildEnemyStats(enemy);

            // ---------- 选技能 ----------
            let action = null;
            const availSkills = (enemy.skills || []).filter(s => {
                const key = `${enemy.id}_${s.name}`;
                const cd = this._runtime.enemyCooldowns[key] || 0;
                if (cd > 0) return false;
                if (s.usesLeft !== null && s.usesLeft <= 0) return false;
                // ★ 消耗检查
                if (s.cost && Object.keys(s.cost).length > 0) {
                    for (const [k, v] of Object.entries(s.cost)) {
                        const bar = this._findTargetBar(enemy, k);
                        if (!bar || bar.current < v) return false;
                    }
                }
                return true;
            });

            // 30% 概率用技能（原来 50% 太多，敌人一直放技能）
            if (availSkills.length > 0 && Math.random() < 0.35) {
                action = availSkills[Math.floor(Math.random() * availSkills.length)];
            }

            const label = action ? `【${action.name}】${action.icon || ''}` : '普通攻击';

            BattleEffectManager.shake(enemySel, 'light');
            BattleUIManager.render();
            await new Promise(r => setTimeout(r, 350));

            this.log(`◀ ${enemy.name} 使用${label}`);
            if (action?.hint) {
                this.log(`  💬 ${action.hint}`);
            }

            // ---------- 技能分支 ----------
            if (action) {
                // 支付消耗
                if (action.cost && Object.keys(action.cost).length > 0) {
                    for (const [k, v] of Object.entries(action.cost)) {
                        const bar = this._findTargetBar(enemy, k);
                        if (bar) {
                            bar.current = Math.max(0, bar.current - v);
                            this.log(`  💠 ${enemy.name} 消耗 ${k} ${v}`);
                        }
                    }
                }

                switch (action.type) {
                    case 'heal':
                        await this._enemyHeal(enemy, enemyStats, action);
                        break;
                    case 'defend':
                        await this._enemyDefend(enemy, action);
                        break;
                    case 'buff':
                        await this._enemyBuffSelf(enemy, action);
                        break;
                    case 'debuff':
                        await this._enemyDebuffPlayer(playerStats, action, playerSel);
                        break;
                    case 'drain':
                        await this._enemyDrain(enemy, enemyStats, playerStats, action, playerSel, enemySel);
                        break;
                    case 'summon':
                        this.log(`  ⚠️ 召唤暂未实现，视为普通攻击`);
                        await this._enemyBasicAttack(enemy, enemyStats, playerStats, action, playerSel, enemySel);
                        break;
                    case 'magic':
                    case 'skill':
                    default:
                        await this._enemyBasicAttack(enemy, enemyStats, playerStats, action, playerSel, enemySel);
                        break;
                }

                // 冷却与次数
                const key = `${enemy.id}_${action.name}`;
                if (action.cooldown > 0) {
                    this._runtime.enemyCooldowns[key] = action.cooldown + 1;
                }
                if (action.usesLeft !== null) action.usesLeft--;

            } else {
                // 普攻
                await this._enemyBasicAttack(enemy, enemyStats, playerStats, null, playerSel, enemySel);
            }

            // 冷却衰减
            for (const k of Object.keys(this._runtime.enemyCooldowns)) {
                if (k.startsWith(enemy.id + '_')) {
                    this._runtime.enemyCooldowns[k] = Math.max(0, this._runtime.enemyCooldowns[k] - 1);
                }
            }

            BattleUIManager.render();
            await new Promise(r => setTimeout(r, 500));
        },

        // ★ 找目标身上的数值条
        _findTargetBar(target, key) {
            if (target.stats?.hp && /^hp$|生命|血量/i.test(key)) {
                return target.stats.hp;
            }
            const bars = target.statusBars || [];
            return bars.find(b => b.key === key || b.key.includes(key) || key.includes(b.key)) || null;
        },

        // ---------- 敌人·普通攻击 ----------
        async _enemyBasicAttack(enemy, enemyStats, playerStats, action, playerSel, enemySel) {
            const formula = action?.formula || null;

            // 命中
            const hitCheck = this._rollHitDetailed(enemyStats, playerStats);
            if (!hitCheck.hit) {
                this.log(`  💨 你闪避了 ${enemy.name} 的攻击`);
                this.log(`  🎯 ${hitCheck.detail}`);
                BattleEffectManager.popup(playerSel, 'MISS', 'miss');
                return;
            }
            this.log(`  🎯 ${hitCheck.detail}`);

            // 暴击
            const isCrit = this.rollCrit(enemyStats);

            // 伤害
            const dmgResult = this._calcDamageDetailed(formula, enemyStats, playerStats, this._runtime.defending);
            let dmg = dmgResult.value;

            if (isCrit) {
                const critMult = this.getActive()?.rules?.critMultiplier || 1.5;
                dmg = Math.round(dmg * critMult);
                this.log(`  💥 暴击！伤害 ×${critMult.toFixed(2)}`);
            }

            this.log(`  📐 ${dmgResult.detail}`);

            // 应用
            this._applyDamageToPlayer(playerStats, dmg);
            this.log(`  💥 对你造成 ${dmg} 点伤害`);

            // 特效
            if (isCrit) {
                BattleEffectManager.shakeScreen('heavy');
                BattleEffectManager.flashScreen('red');
                BattleEffectManager.impact(playerSel);
                BattleEffectManager.flash(playerSel, 'red');
                BattleEffectManager.popup(playerSel, `-${dmg}`, 'crit');
            } else {
                BattleEffectManager.shake(playerSel, action ? 'medium' : 'light');
                BattleEffectManager.flash(playerSel, 'red');
                BattleEffectManager.popup(playerSel, `-${dmg}`, 'damage');
            }

            // 附加效果
            if (action?.effects && action.effects.length > 0) {
                await this._applyEnemyActionEffects(action.effects, enemy, playerStats, playerSel, enemySel, dmg);
            }

            // 危险提示
            const hpBar = playerStats._hpBarRef;
            if (hpBar && hpBar.max > 0 && hpBar.current / hpBar.max < 0.3 && hpBar.current > 0) {
                BattleEffectManager.popup(playerSel, '危险！', 'info');
                BattleEffectManager.flashScreen('red');
            }
        },

        // ---------- 敌人·治疗 ----------
        async _enemyHeal(enemy, enemyStats, action) {
            const enemySel = '.cw-battle-panel-enemy';
            const formula = action.formula || '{攻击} * 2';

            let heal;
            try {
                const ctx = {
                    攻击: enemyStats.attack,
                    防御: enemyStats.defense,
                    敏捷: enemyStats.speed,
                    生命: enemyStats.hp?.max || 100,
                    ...(enemyStats.extra || {}),
                };
                heal = DiceEngine.roll(formula, ctx);
            } catch (e) {
                heal = 20;
            }
            heal = Math.max(1, Math.round(heal));

            const hp = enemy.stats.hp;
            const before = hp.current;
            hp.current = Math.min(hp.max, hp.current + heal);
            const actual = hp.current - before;

            this.log(`  💚 ${enemy.name} 恢复了 ${actual} 点生命（${before} → ${hp.current}/${hp.max}）`);

            BattleEffectManager.flash(enemySel, 'green');
            BattleEffectManager.popup(enemySel, `+${actual}`, 'heal');
        },

        // ---------- 敌人·防御 ----------
        async _enemyDefend(enemy, action) {
            const enemySel = '.cw-battle-panel-enemy';
            this.log(`  🛡️ ${enemy.name} 摆出防御姿态，本回合受到的伤害减半`);

            // 给敌人加一个"防御"状态（持续到本回合结束）
            enemy.statusTags = enemy.statusTags || [];
            enemy.statusTags.push({
                name: '防御',
                effect: { 属性: { 防御: 1.0 } },   // +100% 防御
                duration: 1,
            });

            BattleEffectManager.flash(enemySel, 'green');
            BattleEffectManager.popup(enemySel, '🛡', 'info');
        },

        // ---------- 敌人·自我增益 ----------
        async _enemyBuffSelf(enemy, action) {
            const enemySel = '.cw-battle-panel-enemy';
            enemy.statusTags = enemy.statusTags || [];

            // 从 action.effects 里取 buff
            const buffs = (action.effects || []).filter(e => e.type === 'buff_self');
            if (buffs.length === 0) {
                // 没有结构化效果，就用通用 buff
                enemy.statusTags.push({
                    name: action.name,
                    effect: { 属性: { 攻击: 0.5 } },
                    duration: 3,
                });
                this.log(`  🔥 ${enemy.name} 进入强化状态`);
            } else {
                for (const b of buffs) {
                    enemy.statusTags.push({
                        name: b.name,
                        effect: b.effect,
                        duration: b.duration ?? 3,
                    });
                    this.log(`  🔥 ${enemy.name} 获得状态「${b.name}」`);
                }
            }

            BattleEffectManager.flash(enemySel, 'green');
            BattleEffectManager.popup(enemySel, 'BUF', 'heal');
        },

        // ---------- 敌人·削弱玩家 ----------
        async _enemyDebuffPlayer(playerStats, action, playerSel) {
            const player = PlayerStateManager.player;
            player.tags = player.tags || [];

            const debuffs = (action.effects || []).filter(e => e.type === 'debuff_player');
            if (debuffs.length === 0) {
                player.tags.push({
                    name: action.name,
                    effect: { 属性: { 防御: -0.3 } },
                    duration: 2,
                });
                this.log(`  🌀 你获得状态「${action.name}」`);
            } else {
                for (const d of debuffs) {
                    player.tags.push({
                        name: d.name,
                        effect: d.effect,
                        duration: d.duration ?? 3,
                    });
                    this.log(`  🌀 你获得状态「${d.name}」`);
                }
            }

            PlayerStateManager.refreshAvatarArea();
            BattleEffectManager.flash(playerSel, 'red');
            BattleEffectManager.popup(playerSel, 'DEBUF', 'crit');
        },

        // ---------- 敌人·吸血 ----------
        async _enemyDrain(enemy, enemyStats, playerStats, action, playerSel, enemySel) {
            // 先走一次普通攻击
            await this._enemyBasicAttack(enemy, enemyStats, playerStats, action, playerSel, enemySel);

            // 然后回血
            const drainEffect = (action.effects || []).find(e => e.type === 'drain');
            const ratio = drainEffect?.ratio ?? 0.5;

            const hpBar = playerStats._hpBarRef;
            if (!hpBar) return;

            const enemyHp = enemy.stats.hp;
            const heal = Math.round((enemyHp.max - enemyHp.current) * ratio * 0.5);
            if (heal > 0) {
                const before = enemyHp.current;
                enemyHp.current = Math.min(enemyHp.max, enemyHp.current + heal);
                const actual = enemyHp.current - before;
                if (actual > 0) {
                    this.log(`  🩸 ${enemy.name} 汲取了 ${actual} 点生命`);
                    BattleEffectManager.popup(enemySel, `+${actual}`, 'heal');
                }
            }
        },

        // ---------- 敌人·通用效果应用 ----------
        async _applyEnemyActionEffects(effects, enemy, playerStats, playerSel, enemySel, dmg) {
            const player = PlayerStateManager.player;

            for (const eff of effects) {
                switch (eff.type) {
                    case 'debuff_player': {
                        player.tags = player.tags || [];
                        player.tags.push({
                            name: eff.name,
                            effect: eff.effect,
                            duration: eff.duration ?? 3,
                        });
                        this.log(`  🌀 你获得状态「${eff.name}」`);
                        PlayerStateManager.refreshAvatarArea();
                        break;
                    }
                    case 'buff_self': {
                        enemy.statusTags = enemy.statusTags || [];
                        enemy.statusTags.push({
                            name: eff.name,
                            effect: eff.effect,
                            duration: eff.duration ?? 3,
                        });
                        this.log(`  🔥 ${enemy.name} 获得状态「${eff.name}」`);
                        break;
                    }
                    case 'drain': {
                        const enemyHp = enemy.stats.hp;
                        const heal = Math.round(dmg * (eff.ratio ?? 0.5));
                        const before = enemyHp.current;
                        enemyHp.current = Math.min(enemyHp.max, enemyHp.current + heal);
                        const actual = enemyHp.current - before;
                        if (actual > 0) {
                            this.log(`  🩸 ${enemy.name} 汲取了 ${actual} 点生命`);
                            BattleEffectManager.popup(enemySel, `+${actual}`, 'heal');
                        }
                        break;
                    }
                }
            }
        },

        // ---------- 玩家受伤的统一处理 ----------
        _applyDamageToPlayer(playerStats, dmg) {
            const hpBar = playerStats._hpBarRef;
            if (hpBar) {
                hpBar.current = Math.max(0, hpBar.current - dmg);
            } else if (playerStats.hp) {
                playerStats.hp.current = Math.max(0, playerStats.hp.current - dmg);
            }
            PlayerStateManager.refreshAvatarArea();
        },

        // ★ 新增：把敌人 stats 构建成和玩家同构的结构
        _buildEnemyStats(enemy) {
            const base = enemy.stats || {};
            const extra = base.extra || {};
            const withMods = TagEffectManager.applyAttributeModifiers(base, enemy.statusTags || []);

            // 合并额外属性 + 状态修正
            const mergedExtra = { ...extra };
            for (const [k, v] of Object.entries(withMods)) {
                if (['hp', 'attack', 'defense', 'speed', 'extra', '_order', '_hpKey'].includes(k)) continue;
                mergedExtra[k] = v;
            }

            return {
                name: enemy.name,
                hp: base.hp,
                attack:  withMods.attack  ?? base.attack  ?? 10,
                defense: withMods.defense ?? base.defense ?? 5,
                speed:   withMods.speed   ?? base.speed   ?? 10,
                critRate:   base.critRate   || 0,
                critDamage: base.critDamage || 1.5,
                extra: mergedExtra,
            };
        },

        _allEnemiesDead() {
            const combat = this.getActive();
            return combat && combat.enemies.every(e => !e.isAlive);
        },

        _playerDead() {
            const stats = this.getPlayerStats();
            const hp = stats._hpBarRef ? stats._hpBarRef.current : stats.hp.current;
            return hp <= 0;
        },

        async endBattle(result) {
            const combat = this.getActive();
            if (!combat) return;

            combat.result = result;
            combat.phase = 'ended';
            combat.endedAt = Date.now();

            this.log(`━━━ 战斗结束：${result === 'victory' ? '胜利' : result === 'defeat' ? '失败' : '逃跑'} ━━━`);

            BattleUIManager.render();

            if (window.SaveManager) window.SaveManager.save();

            await new Promise(r => setTimeout(r, 800));

            await this._postBattle(combat);
        },

        async _applyBattleRewards(rewardText) {
            if (!rewardText || !rewardText.trim()) return;

            const lines = rewardText.split('\n');
            const itemLines = [];
            const effectLines = [];
            let inItemSection = false;

            for (const raw of lines) {
                const line = raw.trim();
                if (!line) continue;

                if (/^物品[:：]?\s*$/.test(line)) {
                    inItemSection = true;
                    continue;
                }

                if (inItemSection) {
                    if (line.startsWith('-') || line.startsWith('•')) {
                        itemLines.push(line.replace(/^[-•]\s*/, ''));
                    }
                    else if (/^[\u4e00-\u9fa5A-Za-z]+\s*[+\-]\s*\d+/.test(line)
                          || /^(获得|移除)状态/.test(line)) {
                        inItemSection = false;
                        effectLines.push(line);
                    }
                    continue;
                }

                effectLines.push(line);
            }

            for (const line of effectLines) {
                const numMatch = line.match(/^(.+?)\s*([+\-＋－])\s*(\d+)\s*$/);
                if (numMatch) {
                    const sign = /[+＋]/.test(numMatch[2]) ? '+' : '-';
                    const eff = `【效果】\n目标: 玩家\n数值变化: ${numMatch[1].trim()} ${sign}${numMatch[3]}`;
                    const results = window.EffectSystem.applyFromNarrative(eff);
                    const txt = window.EffectSystem.formatResults(results);
                    if (txt) await window.UIManager.showText(txt, 2500);
                    continue;
                }

                const gainItemMatch = line.match(/^获得\s+(.+?)(?:\s*[x×]\s*(\d+))?$/);
                if (gainItemMatch) {
                    const eff = `【效果】\n目标: 玩家\n实体变化: 获得 ${gainItemMatch[1].trim()} x${gainItemMatch[2] || 1}`;
                    const results = window.EffectSystem.applyFromNarrative(eff);
                    const txt = window.EffectSystem.formatResults(results);
                    if (txt) await window.UIManager.showText(txt, 2500);
                    continue;
                }

                const statusMatch = line.match(/^(获得状态|移除状态)\s+(.+)$/);
                if (statusMatch) {
                    const eff = `【效果】\n目标: 玩家\n实体变化: ${statusMatch[1]} ${statusMatch[2].trim()}`;
                    const results = window.EffectSystem.applyFromNarrative(eff);
                    const txt = window.EffectSystem.formatResults(results);
                    if (txt) await window.UIManager.showText(txt, 2500);
                    continue;
                }
            }

            if (itemLines.length === 0) return;

            const player = PlayerStateManager.player;
            player.inventory = player.inventory || [];

            const obtainedList = [];

            for (const line of itemLines) {
                const item = WorldManager.parseItemLine(line);
                if (!item || !item.name) continue;

                let count = 1;
                const countFromName = item.name.match(/^(.*?)\s*[×xX]\s*(\d+)\s*$/);
                if (countFromName) {
                    item.name = countFromName[1].trim();
                    count = parseInt(countFromName[2]) || 1;
                } else if (item.fields && item.fields['数量'] !== undefined) {
                    const n = parseInt(String(item.fields['数量']).replace(/[^\d]/g, ''));
                    if (!isNaN(n) && n > 0) count = n;
                    delete item.fields['数量'];
                }

                const trailing = item.name.match(/^(.*?)\|([×xX]\d+)$/);
                if (trailing) {
                    item.name = trailing[1].trim();
                    count = parseInt(trailing[2].replace(/[^\d]/g, '')) || count;
                }

                const existing = player.inventory.find(i => i.name === item.name);
                if (existing) {
                    existing.count = (existing.count || 1) + count;
                    if (!existing.fields || Object.keys(existing.fields).length === 0) {
                        existing.fields = item.fields || {};
                    }
                    if (!existing.icon || existing.icon === '📦') {
                        existing.icon = item.icon || existing.icon;
                    }
                    if (!existing.description && item.description) {
                        existing.description = item.description;
                    }
                } else {
                    player.inventory.push({
                        name: item.name,
                        count,
                        icon: item.icon || '📦',
                        description: item.description || '',
                        fields: item.fields || {},
                        interactions: item.interactions || [],
                        status: item.status || '',
                        effect: item.effect || '',
                        type: item.type || 'item',
                        stackable: item.stackable || false,
                        maxStack: item.maxStack || null,
                    });
                }

                obtainedList.push(`${item.icon || '📦'} ${item.name} ×${count}`);
            }

            if (obtainedList.length > 0) {
                await window.UIManager.showText(
                    `📦 获得战利品：\n${obtainedList.join('\n')}`,
                    3500
                );
                PlayerStateManager.refreshAvatarArea();
            }
        },

        async _postBattle(combat) {
            const player = PlayerStateManager.player;
            const result = combat.result;
            const pkg = combat.package;

            BattleUIManager.close();

            if (pkg.postMusic && pkg.postMusic !== '无') {
                await MusicManager.setOverrideMusic(pkg.postMusic);
            }

            const scriptText = result === 'victory' ? pkg.victoryScript
                             : result === 'defeat'  ? pkg.defeatScript
                             : '';
            if (scriptText) {
                const dialogues = window.VisualNovelManager.parseScript(scriptText);
                if (dialogues.length > 0) {
                    await window.VisualNovelManager.play(dialogues);
                } else {
                    await window.UIManager.showText(scriptText, 4000);
                }
            }

            if (result === 'victory') {
                // ★ 先记录战斗摘要（此时敌人实体还在 scene.sceneItems 里）
                //   如果放到 applySceneUpdate 之后，敌人可能已被移除，_findEnemyItem 会返回 null
                await this._recordVictorySummary(combat, pkg);
            
                // 再应用奖励
                if (pkg.rewards && pkg.rewards.trim() && pkg.rewards.trim() !== '无') {
                    await this._applyBattleRewards(pkg.rewards);
                }
            
                // 最后应用场景更新（可能会移除敌人实体）
                if (pkg.sceneUpdate && pkg.sceneUpdate.trim()) {
                    const update = window.StoryManager.parseSceneUpdate(`【场景更新】\n${pkg.sceneUpdate}`);
                    if (update) await window.StoryManager.applySceneUpdate(update);
                }
            }

            CinemaWorld.worldState.combat.history = CinemaWorld.worldState.combat.history || [];
            CinemaWorld.worldState.combat.history.push({
                id: combat.id,
                enemyName: combat.enemies[0]?.name || '未知',
                result,
                turns: combat.turn,
                endedAt: combat.endedAt,
                sceneName: combat.sceneName,
            });
            if (CinemaWorld.worldState.combat.history.length > 50) {
                CinemaWorld.worldState.combat.history = CinemaWorld.worldState.combat.history.slice(-50);
            }

            CinemaWorld.worldState.combat.activeCombat = null;

            if (result === 'victory' && combat.enemyItemName) {
                const store = CinemaWorld.worldState.combat.battlePackages;
                if (store && store[combat.enemyItemName]) {
                    delete store[combat.enemyItemName];
                    console.log(`[Battle] 已清空战斗缓存: ${combat.enemyItemName}`);
                }
            }
            this._runtime = { defending: false, playerCooldowns: {}, enemyCooldowns: {} };

            if (pkg.postMusic && pkg.postMusic !== '无') {
                await MusicManager.clearOverrideMusic();
            }

            if (window.SaveManager) window.SaveManager.save();

            await window.UIManager.showText(
                result === 'victory' ? '✅ 战斗胜利' :
                result === 'defeat'  ? '💀 战斗失败' :
                '🏃 逃离了战斗',
                2000
            );
        },

        async _recordVictorySummary(combat, pkg) {
            // 1. 检查敌人是否标记了"加入上下文"
            const enemyItem = this._findEnemyItem(combat.enemyItemName);
            if (!enemyItem) {
                console.log(`[Battle] 找不到敌人实体【${combat.enemyItemName}】，跳过摘要记录`);
                return;
            }

            const inContext = enemyItem.fields?.['加入上下文'] === '是';
            if (!inContext) {
                console.log(`[Battle] 敌人【${combat.enemyItemName}】未标记"加入上下文"，跳过摘要记录`);
                return;
            }

            // 2. 提取胜利摘要（去掉音乐标记）
            const summary = this._cleanVictorySummary(pkg.victorySummary);
            if (!summary) {
                console.log(`[Battle] 敌人【${combat.enemyItemName}】的胜利摘要为空，跳过`);
                return;
            }

            // 3. 写入交互摘要系统（供主线剧情使用）
            //    ★ 复用"场景实体"通道：source='sceneItem'，key=敌人实体名
            //    这样它会自然出现在【本章与场景实体的交互】里
            const chapterId = window.StoryManager?.currentChapter?.id || null;
            window.InteractionDigestManager.add({
                targetType: 'item',
                target: combat.enemyItemName,
                source: 'sceneItem',
                summary: summary,
                chapterId,
            });

            // 4. 同时写入交互历史（可在场景实体历史面板查看）
            window.InteractionHistoryManager.add({
                type: 'sceneItem',
                target: combat.enemyItemName,
                targetMeta: {
                    enemyName: combat.enemies[0]?.name,
                    turns: combat.turn,
                    isBattle: true,
                },
                scene: combat.sceneName,
                playerInput: '战斗',
                script: (combat.log || []).map(l => l.text).join('\n'),
                effect: pkg.rewards || null,
                summary: summary,
            });

            console.log(`[Battle] 已记录【${combat.enemyItemName}】的战斗摘要到上下文`);
        },
        
                // ★ 根据敌人名字找场景实体
                _findEnemyItem(enemyName) {
                    if (!enemyName) return null;
                    const scene = window.LocationModalManager?.currentLocation;
                    if (!scene) return null;
                    return scene.sceneItems?.find(i => i.name === enemyName) || null;
                },
        
                // ★ 清洗胜利摘要：去掉音乐提示块、代码块等
                _cleanVictorySummary(raw) {
                    if (!raw) return '';
                    let text = String(raw).trim();
        
                    // 去掉【音乐提示】及其内容（到下一个【标签】或结尾）
                    text = text.replace(/【音乐提示】[\s\S]*?(?=\n【|$)/g, '');
        
                    // 去掉代码块标记
                    text = text.replace(/```[\s\S]*?```/g, '');
        
                    // 去掉可能残留的 "🎵 音乐: xxx" 行
                    text = text.replace(/^\s*🎵\s*音乐[:：].*$/gm, '');
        
                    // 去掉单独一行的"战前音乐/战中音乐/战后音乐:"（如果 AI 漏了标题）
                    text = text.replace(/^\s*(战前音乐|战中音乐|战后音乐)[:：].*$/gm, '');
        
                    // 去掉多余空行
                    text = text.replace(/\n{3,}/g, '\n\n').trim();
        
                    return text;
                },
    };
    
    // ============================================================
    // 战斗界面
    // ============================================================
    const BattleUIManager = {
        open(combat) {
            this._injectStyles();
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active cw-battle-modal';
            modal.innerHTML = this._render(combat);
        },

        render() {
            const combat = BattleManager.getActive();
            if (!combat) return;
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active cw-battle-modal';
            modal.innerHTML = this._render(combat);

            const logBody = document.getElementById('cw-battle-log-body');
            if (logBody) {
                logBody.scrollTop = logBody.scrollHeight;
            }
        },

        close() {
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = '';
            modal.innerHTML = '';
            modal.classList.remove('active');
        },

        _render(combat) {
            const player = PlayerStateManager.player;
            const playerStats = BattleManager.getPlayerStats();
            const enemy = combat.enemies[0];

            const pHp = playerStats._hpBarRef
                ? { current: playerStats._hpBarRef.current, max: playerStats._hpBarRef.max }
                : playerStats.hp;

            const isEnded = combat.phase === 'ended';
            const isPlayerTurn = combat.phase === 'player' && !isEnded;

            const leftHTML = this._renderPlayerPanel(player, playerStats, pHp, combat);
            const centerHTML = this._renderCenterPanel(combat, isPlayerTurn, isEnded);
            const rightHTML = this._renderEnemyPanel(enemy);

            return `
                <div class="cw-battle-container">
                    <div class="cw-battle-header">
                        <div class="cw-battle-header-left">回合 ${combat.turn}</div>
                        <div class="cw-battle-header-center">
                            ${isPlayerTurn ? '🎯 你的回合'
                                : isEnded ? (combat.result === 'victory' ? '✅ 战斗胜利'
                                    : combat.result === 'defeat' ? '💀 战斗失败'
                                    : '🏃 已逃离')
                                : '⚔️ 敌人回合'}
                        </div>
                        <div class="cw-battle-header-right">
                            <button class="cw-battle-rule-btn" onclick="BattleUIManager.openRuleEditor()" title="查看战斗规则">⚙️</button>
                        </div>
                    </div>

                    <div class="cw-battle-body">
                        <div class="cw-battle-col cw-battle-col-left">
                            ${leftHTML}
                        </div>
                        <div class="cw-battle-col cw-battle-col-center">
                            ${centerHTML}
                        </div>
                        <div class="cw-battle-col cw-battle-col-right">
                            ${rightHTML}
                        </div>
                    </div>
                </div>`;
        },

        _renderPlayerPanel(player, playerStats, hp, combat) {
            const spriteUrl = SpriteManager.playerSprite;

            let spriteHTML;
            if (typeof spriteUrl === 'string') {
                spriteHTML = `<img src="${spriteUrl}" alt="${player.name}" class="cw-battle-sprite-img">`;
            } else if (spriteUrl === null) {
                spriteHTML = `<div class="cw-battle-sprite-placeholder">${player.name.charAt(0)}</div>`;
            } else {
                spriteHTML = `<div class="cw-battle-sprite-placeholder">${player.name.charAt(0)}</div>`;
                SpriteManager.getPlayerSprite().then(url => {
                    if (BattleManager.getActive()) {
                        BattleUIManager.render();
                    }
                });
            }

            const hpPct = hp.max > 0 ? Math.max(0, (hp.current / hp.max) * 100) : 0;

            const otherBars = (player.statusBars || [])
                .filter(b => !/生命|血量|HP|hp|气血/i.test(b.key))
                .slice(0, 3);

            const tagsHTML = this._renderTags(player.tags || [], {
                maxShow: 6,
                filterBattleOnly: true,
                styleClass: '',
            });

            let critHTML = '';
            if (playerStats.critRate) {
                let r = playerStats.critRate;
                if (r > 1) r = r / 100;
                critHTML = `
                    <div class="cw-battle-attr">
                        <span class="cw-battle-attr-label">💥 暴击</span>
                        <span class="cw-battle-attr-value">${(r * 100).toFixed(0)}%</span>
                    </div>`;
            }

            return `
                <div class="cw-battle-panel cw-battle-panel-player">
                    <div class="cw-battle-sprite-wrap">
                        ${spriteHTML}
                    </div>
                    <div class="cw-battle-panel-name">${player.name}</div>

                    <div class="cw-battle-stat-row">
                        <span class="cw-battle-stat-icon">❤️</span>
                        <div class="cw-battle-stat-bar">
                            <div class="cw-battle-stat-fill hp" style="width:${hpPct}%;"></div>
                        </div>
                        <span class="cw-battle-stat-num">${hp.current}/${hp.max}</span>
                    </div>

                    ${otherBars.map(b => {
                        const pct = b.max > 0 ? Math.max(0, (b.current / b.max) * 100) : 0;
                        return `
                            <div class="cw-battle-stat-row">
                                <span class="cw-battle-stat-icon">${b.icon || '•'}</span>
                                <div class="cw-battle-stat-bar">
                                    <div class="cw-battle-stat-fill other" style="width:${pct}%;"></div>
                                </div>
                                <span class="cw-battle-stat-num">${b.current}/${b.max}</span>
                            </div>`;
                    }).join('')}

                    <div class="cw-battle-attrs">
                        <div class="cw-battle-attr">
                            <span class="cw-battle-attr-label">⚔️ 攻击</span>
                            <span class="cw-battle-attr-value">${Math.round(playerStats.attack)}</span>
                        </div>
                        <div class="cw-battle-attr">
                            <span class="cw-battle-attr-label">🛡 防御</span>
                            <span class="cw-battle-attr-value">${Math.round(playerStats.defense)}</span>
                        </div>
                        <div class="cw-battle-attr">
                            <span class="cw-battle-attr-label">💨 敏捷</span>
                            <span class="cw-battle-attr-value">${Math.round(playerStats.speed)}</span>
                        </div>
                        ${critHTML}
                    </div>

                    ${tagsHTML}
                </div>`;
        },

        _renderEnemyPanel(enemy) {
            if (!enemy) return '';

            const hp = enemy.stats.hp;
            const hpPct = hp.max > 0 ? Math.max(0, (hp.current / hp.max) * 100) : 0;
            const dead = !enemy.isAlive;

            const iconHTML = `<div class="cw-battle-sprite-icon">${enemy.icon || '👹'}</div>`;

            const statusHTML = this._renderTags(enemy.statusTags || [], {
                maxShow: 4,
                filterBattleOnly: false,
                styleClass: 'cw-battle-tag-status',
            });

            const skillsHTML = (enemy.skills || []).length > 0
                ? this._renderSkillTags(enemy.skills, 3)
                : '';

            const tagsHTML = (statusHTML || skillsHTML)
                ? `<div class="cw-battle-tags">${statusHTML}${skillsHTML}</div>`
                : '';

            // ★ 动态属性格：默认 3 个 + 额外属性
            const extra = enemy.stats.extra || {};
            const order = enemy.stats._order || [];

            const cells = [
                { label: '⚔️ 攻击', value: enemy.stats.attack },
                { label: '🛡 防御', value: enemy.stats.defense },
                { label: '💨 敏捷', value: enemy.stats.speed },
            ];

            // 额外属性里挑出"看起来是数值"的，最多再展示 3 个
            const numericExtras = order
                .filter(k => typeof extra[k] === 'number')
                .slice(0, 3);

            for (const k of numericExtras) {
                cells.push({
                    label: `✨ ${k}`,
                    value: extra[k],
                });
            }

            const attrsHTML = cells.map(c => `
                <div class="cw-battle-attr">
                    <span class="cw-battle-attr-label">${c.label}</span>
                    <span class="cw-battle-attr-value">${
                        typeof c.value === 'number' ? Math.round(c.value) : c.value
                    }</span>
                </div>
            `).join('');

            return `
                <div class="cw-battle-panel cw-battle-panel-enemy ${dead ? 'dead' : ''}">
                    <div class="cw-battle-sprite-wrap">
                        ${iconHTML}
                    </div>
                    <div class="cw-battle-panel-name">${enemy.name}${dead ? '（已倒下）' : ''}</div>

                    <div class="cw-battle-stat-row">
                        <span class="cw-battle-stat-icon">❤️</span>
                        <div class="cw-battle-stat-bar">
                            <div class="cw-battle-stat-fill hp-enemy" style="width:${hpPct}%;"></div>
                        </div>
                        <span class="cw-battle-stat-num">${hp.current}/${hp.max}</span>
                    </div>

                    <div class="cw-battle-attrs">
                        ${attrsHTML}
                    </div>

                    ${tagsHTML}
                </div>`;
        },

        _renderTags(tags, options = {}) {
            if (!tags || tags.length === 0) return '';

            const {
                maxShow = 6,
                filterBattleOnly = false,
                styleClass = '',
            } = options;

            let list = tags;
            if (filterBattleOnly) {
                list = tags.filter(t => {
                    if (typeof t === 'string') return false;
                    const e = t.effect;
                    return e && (e.属性 || e.每回合 || e.跳过回合);
                });
            }

            if (list.length === 0) return '';

            const shown = list.slice(0, maxShow);
            const more = list.length - maxShow;

            return shown.map(t => {
                const name = typeof t === 'string' ? t : t.name;
                const duration = typeof t === 'object' && t.duration
                    ? ` · ${t.duration}`
                    : '';

                let tip = name;
                if (typeof t === 'object' && t.effect) {
                    const parts = [];
                    if (t.effect.属性) {
                        for (const [k, v] of Object.entries(t.effect.属性)) {
                            const sign = v > 0 ? '+' : '';
                            parts.push(`${k} ${sign}${(v * 100).toFixed(0)}%`);
                        }
                    }
                    if (t.effect.每回合) {
                        for (const [k, v] of Object.entries(t.effect.每回合)) {
                            const sign = v > 0 ? '+' : '';
                            parts.push(`每回合 ${k} ${sign}${v}`);
                        }
                    }
                    if (t.effect.跳过回合) parts.push('跳过回合');
                    if (parts.length > 0) {
                        tip = `${name}\n${parts.join('\n')}`;
                    }
                }

                const cls = styleClass ? ` ${styleClass}` : '';
                return `<span class="cw-battle-tag${cls}" title="${this._escapeAttr(tip)}">${name}${duration}</span>`;
            }).join('') + (more > 0
                ? `<span class="cw-battle-tag cw-battle-tags-more" title="还有 ${more} 个">+${more}</span>`
                : '');
        },

        _renderSkillTags(skills, maxShow = 3) {
            if (!skills || skills.length === 0) return '';
            const shown = skills.slice(0, maxShow);
            const more = skills.length - maxShow;

            return shown.map(s => {
                // ★ 拼接详细提示
                const tipLines = [];
                tipLines.push(`${s.icon || '⚡'} ${s.name}`);

                // 类型标签
                const typeLabels = {
                    attack: '攻击',
                    heal:   '治疗',
                    defend: '防御',
                    buff:   '强化',
                    debuff: '削弱',
                    drain:  '吸血',
                    magic:  '法术',
                    skill:  '技能',
                };
                if (typeLabels[s.type]) {
                    tipLines.push(`类型：${typeLabels[s.type]}`);
                }

                if (s.hint) tipLines.push(s.hint);
                if (s.formula) tipLines.push(`公式：${s.formula}`);
                if (s.cooldown > 0) tipLines.push(`冷却：${s.cooldown} 回合`);
                if (s.usesLeft !== null) tipLines.push(`次数：${s.usesLeft}`);
                if (s.cost && Object.keys(s.cost).length > 0) {
                    tipLines.push(`消耗：${Object.entries(s.cost).map(([k, v]) => `${k} ${v}`).join('，')}`);
                }

                const typeClass = `cw-battle-tag-skill-${s.type || 'skill'}`;
                return `<span class="cw-battle-tag cw-battle-tag-skill ${typeClass}" 
                              title="${this._escapeAttr(tipLines.join('\n'))}">
                    ${s.icon || ''} ${s.name}
                    ${s.cooldown > 0 ? `<span class="cw-battle-tag-cd">CD${s.cooldown}</span>` : ''}
                </span>`;
            }).join('') + (more > 0
                ? `<span class="cw-battle-tag cw-battle-tags-more" title="还有 ${more} 个技能">+${more}</span>`
                : '');
        },

        _escapeAttr(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\n/g, '&#10;');
        },

        _renderCenterPanel(combat, isPlayerTurn, isEnded) {
            const logHTML = combat.log.slice(-20).map(l =>
                `<div class="cw-battle-log-line">${l.text}</div>`
            ).join('');

            let actionsHTML;
            if (isEnded) {
                actionsHTML = `
                    <div class="cw-battle-end-text">
                        ${combat.result === 'victory' ? '✅ 战斗胜利'
                            : combat.result === 'defeat' ? '💀 战斗失败'
                            : '🏃 已逃离'}
                    </div>`;
            } else if (isPlayerTurn) {
                actionsHTML = this._renderActions(combat);
            } else {
                actionsHTML = `<div class="cw-battle-end-text">⏳ 敌人回合...</div>`;
            }

            return `
                <div class="cw-battle-log-panel">
                    <div class="cw-battle-log-title">📜 战斗日志</div>
                    <div class="cw-battle-log-body" id="cw-battle-log-body">
                        ${logHTML || '<div class="cw-battle-log-line" style="color:#666;">战斗开始</div>'}
                    </div>
                </div>
                <div class="cw-battle-actions-panel">
                    ${actionsHTML}
                </div>`;
        },

        openRuleEditor() {
            if (document.getElementById('cw-battle-rule-overlay')) return;

            const combat = BattleManager.getActive();
            if (!combat) return;

            const rules = combat.rules || BattleRuleManager.getCurrent() || BattleRuleManager.DEFAULT_RULES;
            const source = CinemaWorld.worldState.gameRules
                ? '（来自游戏规则）'
                : '（默认规则）';

            const displayText = rules.raw || this._rulesToText(rules);

            const overlay = document.createElement('div');
            overlay.id = 'cw-battle-rule-overlay';
            overlay.innerHTML = `
                <div class="cw-battle-rule-panel">
                    <div class="cw-battle-rule-title">⚙️ 战斗规则 ${source}</div>
                    <div class="cw-battle-rule-hint">
                        ⓘ 战斗规则定义在游戏规则里，如需修改请到「手机 → 规则」中编辑。
                    </div>
                    <pre class="cw-battle-rule-preview">${displayText.replace(/</g, '&lt;')}</pre>
                    <div class="cw-battle-rule-actions">
                        <button class="cinemaworld-button" onclick="BattleUIManager.closeRuleEditor()">关闭</button>
                    </div>
                </div>`;
            document.getElementById('cinemaworld-container').appendChild(overlay);
        },

        closeRuleEditor() {
            const el = document.getElementById('cw-battle-rule-overlay');
            if (el) el.remove();
        },

        saveRuleEdit() {
            const text = document.getElementById('cw-battle-rule-input')?.value.trim();
            if (!text) { this.closeRuleEditor(); return; }

            const rules = BattleRuleManager.parse(text);
            if (!rules) { window.UIManager.showText('解析失败', 2000); return; }

            rules.raw = text;

            BattleRuleManager.save(rules);
            const combat = BattleManager.getActive();
            if (combat) combat.rules = rules;

            this.closeRuleEditor();
            window.UIManager.showText('✅ 战斗规则已更新', 1500);
        },

        _rulesToText(rules) {
            if (!rules) return '';
            return [
                `伤害公式: ${rules.damageFormula || '{攻击} - {防御}'}`,
                `命中判定: ${rules.hitFormula ? `${rules.hitFormula} >= ${rules.hitThreshold}` : '（必中）'}`,
                `暴击: ${rules.critFormula} >= ${rules.critThreshold}，伤害 ×${rules.critMultiplier}`,
                `先攻: ${rules.initiativeFormula}`,
                `胜利条件: ${rules.victoryCondition}`,
                `失败条件: ${rules.defeatCondition}`,
            ].join('\n');
        },

        _renderActions(combat) {
            const actions = combat.actionPool || [];
            if (actions.length === 0) {
                return `<div style="color:#888;text-align:center;">无可用的行动</div>`;
            }

            const enemy = combat.enemies.find(e => e.isAlive);
            const playerStats = BattleManager.getPlayerStats();
            const enemyStats = enemy ? BattleManager._buildEnemyStats(enemy) : null;

            return `
                <div class="cw-battle-action-grid">
                    ${actions.map(a => this._renderOneAction(a, enemy, playerStats, enemyStats)).join('')}
                </div>`;
        },
        // ★ 单个行动按钮（默认简洁，悬浮显示详情）
        _renderOneAction(a, enemy, playerStats, enemyStats) {
            const combat = BattleManager.getActive();  
            const cd = BattleManager._runtime.playerCooldowns[a.id] || 0;
            const used = a.usesLeft !== null && a.usesLeft <= 0;
            const disabled = cd > 0 || used;

            let healDisabled = false;
            if (a.type === 'heal') {
                if (playerStats._hpBarRef && playerStats._hpBarRef.current >= playerStats._hpBarRef.max) {
                    healDisabled = true;
                }
            }
            const finalDisabled = disabled || healDisabled;

            const typeClass = `cw-battle-action-${a.type || 'skill'}`;

            // 底部小标记
            const badges = [];
            if (cd > 0) badges.push(`<span class="cw-battle-action-cd">CD ${cd}</span>`);
            if (a.usesLeft !== null) badges.push(`<span class="cw-battle-action-uses">×${a.usesLeft}</span>`);
            if (a.sourceEquipment) badges.push(`<span class="cw-battle-action-source">${a.sourceEquipment}</span>`);

            // 悬浮提示内容
            const tooltipHTML = this._buildActionTooltip(a, playerStats, enemyStats);

            return `
                <button class="cw-battle-action ${typeClass} ${finalDisabled ? 'disabled' : ''}"
                    ${finalDisabled ? 'disabled' : ''}
                    onclick="BattleUIManager._chooseAction('${a.id}', '${enemy?.id || ''}')">
                    <div class="cw-battle-action-main">
                        <div class="cw-battle-action-icon">${a.icon || '⚔️'}</div>
                        <div class="cw-battle-action-name">${a.name}</div>
                    </div>
                    ${badges.length > 0 ? `
                        <div class="cw-battle-action-meta">
                            ${badges.join('')}
                        </div>
                    ` : ''}

                    <div class="cw-battle-action-tooltip">
                        ${tooltipHTML}
                    </div>
                </button>`;
        },

        // ★ 构建悬浮提示 HTML
        _buildActionTooltip(a, playerStats, enemyStats) {
            const lines = [];

            // ---------- 描述 ----------
            if (a.description) {
                lines.push(`
                    <div class="cw-tip-desc">${this._escapeAttr(a.description)}</div>
                `);
            }

            // ---------- 消耗 ----------
            if (a.cost && Object.keys(a.cost).length > 0) {
                const costText = Object.entries(a.cost).map(([k, v]) => `${k} ${v}`).join('，');
                lines.push(`
                    <div class="cw-tip-row">
                        <span class="cw-tip-label">💠 消耗</span>
                        <span class="cw-tip-value cw-tip-cost">${costText}</span>
                    </div>
                `);
            }

            // ---------- 公式 ----------
            let formulaText = '';
            let estimateText = '';

            if (a.type === 'attack' || a.type === 'skill' || a.type === 'magic') {
                const formula = a.formula || BattleRuleManager.DEFAULT_RULES.damageFormula;
                formulaText = this._formatFormulaForDisplay(formula, playerStats, enemyStats);
                const est = this._estimateDamage(formula, playerStats, enemyStats);
                if (est) estimateText = est;
            } else if (a.type === 'heal') {
                const formula = a.formula || '{攻击} * 2';
                formulaText = this._formatFormulaForDisplay(formula, playerStats, enemyStats);
                const est = this._estimateDamage(formula, playerStats, enemyStats);
                if (est) estimateText = est;
            }

            if (formulaText) {
                lines.push(`
                    <div class="cw-tip-row">
                        <span class="cw-tip-label">📐 公式</span>
                        <span class="cw-tip-value cw-tip-formula">${formulaText}</span>
                    </div>
                `);
            }
            if (estimateText) {
                lines.push(`
                    <div class="cw-tip-row">
                        <span class="cw-tip-label">📊 预估</span>
                        <span class="cw-tip-value cw-tip-estimate">${estimateText}</span>
                    </div>
                `);
            }

            // ---------- 命中 ----------
            const rules = BattleRuleManager.getCurrent() || BattleRuleManager.DEFAULT_RULES;
            if (rules.hitFormula && (a.type === 'attack' || a.type === 'skill' || a.type === 'magic')) {
                const hitDisplay = this._formatFormulaForDisplay(rules.hitFormula, playerStats, enemyStats);
                lines.push(`
                    <div class="cw-tip-row">
                        <span class="cw-tip-label">🎯 命中</span>
                        <span class="cw-tip-value">${hitDisplay} ≥ ${rules.hitThreshold}</span>
                    </div>
                `);
            }

            // ---------- 效果 ----------
            if (a.effects && a.effects.length > 0) {
                const effText = a.effects.map(e => {
                    if (e.type === 'debuff_enemy') return `敌人获得「${e.name}」`;
                    if (e.type === 'buff_self')   return `自身获得「${e.name}」`;
                    if (e.type === 'drain')       return `吸取生命`;
                    return e.name || e.type;
                }).join('；');
                lines.push(`
                    <div class="cw-tip-row">
                        <span class="cw-tip-label">✨ 效果</span>
                        <span class="cw-tip-value cw-tip-effect">${effText}</span>
                    </div>
                `);
            }

            // ---------- CD / 次数 ----------
            const metaParts = [];
            if (a.cooldown > 0) metaParts.push(`冷却 ${a.cooldown} 回合`);
            if (a.usesLeft !== null) metaParts.push(`剩余 ${a.usesLeft} 次`);
            if (metaParts.length > 0) {
                lines.push(`
                    <div class="cw-tip-row">
                        <span class="cw-tip-label">⏱</span>
                        <span class="cw-tip-value">${metaParts.join(' · ')}</span>
                    </div>
                `);
            }

            if (lines.length === 0) {
                return `<div class="cw-tip-desc" style="color:#666;">（无额外信息）</div>`;
            }

            return lines.join('');
        },

        // ★ 把公式里的 {属性} 替换成实际值，展示给玩家
        _formatFormulaForDisplay(formula, playerStats, enemyStats) {
            if (!formula) return '';
            const ctx = this._buildFormulaContext(formula, playerStats, enemyStats, 3);

            return formula.replace(/\{([^}]+)\}/g, (_, key) => {
                if (key.includes('.')) {
                    const [side, attr] = key.split('.');
                    const obj = side === '敌人' ? ctx['敌人'] : ctx['我方'];
                    const v = obj[attr];
                    return `${attr}(${v === undefined ? 0 : v})`;
                }
                const v = ctx[key];
                return `${key}(${v === undefined ? 0 : v})`;
            });
        },

        // ★ 估算伤害范围（最小骰值 / 最大骰值各算一次）
        _estimateDamage(formula, playerStats, enemyStats) {
            if (!formula) return null;
            try {
                const ctxMin = this._buildFormulaContext(formula, playerStats, enemyStats, 1);
                const ctxMax = this._buildFormulaContext(formula, playerStats, enemyStats, 6);
                const min = DiceEngine.roll(formula, ctxMin);
                const max = DiceEngine.roll(formula, ctxMax);
                return `${Math.max(1, Math.round(min))} ~ ${Math.max(1, Math.round(max))}`;
            } catch (e) {
                console.warn('[BattleUI] 预估失败:', formula, e);
                return null;
            }
        },

        // ★ 构建公式上下文（把玩家的所有属性塞进去）
                // ★ 构建公式上下文（与 BattleManager._calcDamageDetailed 完全一致的顺序）
                _buildFormulaContext(formula, playerStats, enemyStats, diceMin) {
                    const attackerExtra = playerStats.extra || {};
                    const targetExtra   = enemyStats?.extra || {};
        
                    // ============================================================
                    // 顺序（后面的覆盖前面的）：
                    //   a. 攻击方额外属性（裸名）
                    //   b. 防御方额外属性（裸名，不覆盖攻击方同名）
                    //   c. a_ / d_ 前缀版本
                    //   d. ★ 默认槽位（最优先，绝不被覆盖）
                    // ============================================================
                    const ctx = {};
        
                    // a. 攻击方额外属性（裸名）
                    for (const [k, v] of Object.entries(attackerExtra)) {
                        ctx[k] = v;
                    }
                    // b. 防御方额外属性（裸名，被攻击方同名覆盖则跳过）
                    for (const [k, v] of Object.entries(targetExtra)) {
                        if (ctx[k] === undefined) ctx[k] = v;
                    }
                    // c. 前缀版本
                    for (const [k, v] of Object.entries(attackerExtra)) {
                        ctx[`a_${k}`] = v;
                    }
                    for (const [k, v] of Object.entries(targetExtra)) {
                        ctx[`d_${k}`] = v;
                    }
        
                    // d. ★ 默认槽位最后写入
                    ctx['攻击'] = playerStats.attack;
                    ctx['防御'] = playerStats.defense;
                    ctx['敏捷'] = playerStats.speed;
                    ctx['速度'] = playerStats.speed;
                    ctx['生命'] = playerStats.hp?.max || 100;
                    ctx['attack']  = playerStats.attack;
                    ctx['defense'] = playerStats.defense;
                    ctx['speed']   = playerStats.speed;
                    ctx['hp']      = playerStats.hp?.max || 100;
        
                    // ---------- 命名空间 ----------
                    ctx['敌人'] = new Proxy({}, {
                        get(_, p) {
                            if (!enemyStats) return 0;
                            if (p in targetExtra) return targetExtra[p];
                            if (p === '攻击') return enemyStats.attack;
                            if (p === '防御') return enemyStats.defense;
                            if (p === '敏捷' || p === '速度') return enemyStats.speed;
                            if (p === '生命' || p === 'HP' || p === 'hp') {
                                return enemyStats.hp?.max || 100;
                            }
                            return 0;
                        }
                    });
                    ctx['我方'] = new Proxy({}, {
                        get(_, p) {
                            if (p in attackerExtra) return attackerExtra[p];
                            if (p === '攻击') return playerStats.attack;
                            if (p === '防御') return playerStats.defense;
                            if (p === '敏捷' || p === '速度') return playerStats.speed;
                            if (p === '生命' || p === 'HP' || p === 'hp') {
                                return playerStats.hp?.max || 100;
                            }
                            return 0;
                        }
                    });
        
                    return ctx;
                },

        async _chooseAction(actionId, targetId) {
            const combat = BattleManager.getActive();
            if (!combat || combat.phase !== 'player') return;

            const btn = document.querySelector(`.cw-battle-action[onclick*="${actionId}"]`);
            if (btn) btn.classList.add('selected');

            await new Promise(r => setTimeout(r, 200));

            const result = await BattleManager.playerAction(actionId, targetId);
            if (result?.error) {
                await window.UIManager.showText(`❌ ${result.error}`, 2000);
            }
        },

        _injectStyles() {
            // ★ CSS 已移至 style.css
            if (window.CinemaWorldCSS) window.CinemaWorldCSS.ensure();
        },
    };

    // ==================== 挂载到 window ====================
    window.BattlePackageSlicer = BattlePackageSlicer;
    window.EnemyBuilder = EnemyBuilder;
    window.BattleRuleManager = BattleRuleManager;
    window.BattleEffectManager = BattleEffectManager;
    window.BattleManager = BattleManager;
    window.BattleUIManager = BattleUIManager;

    console.log('[CinemaWorld] battle.js 已加载');
})();