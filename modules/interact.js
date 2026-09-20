// ============================================================
// CinemaWorld · interact.js
// 效果系统 / 角色交互 / 场景浏览器 / 遭遇 / 背包 / 商店
// 依赖：core.js, world.js, player.js, rules.js, story.js, scene.js
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const WorldManager = window.WorldManager;
    const PlayerStateManager = window.PlayerStateManager;
    const EquipmentManager = window.EquipmentManager;
    const CharacterRegistry = window.CharacterRegistry;
    const StoryManager = window.StoryManager;
    const InteractionHistoryManager = window.InteractionHistoryManager;
    const InteractionDigestManager = window.InteractionDigestManager;
    const SpriteManager = window.SpriteManager;
    const MusicManager = window.MusicManager;
    const VisualNovelManager = window.VisualNovelManager;

        // ==================== 效果系统 ====================
        const EffectSystem = {
            // 应用叙事文本中的效果
            applyFromNarrative(text) {
                const effects = this.parseEffects(text);
                if (effects.length === 0) return [];
                console.log('[CinemaWorld] 解析到效果:', effects);
                const results = this.applyEffects(effects);
                console.log('[CinemaWorld] 应用结果:', results);
                return results;
            },
    
            parseEffects(text) {
                const effects = [];
                const blocks = text.match(/【效果】([\s\S]*?)(?=【(?:效果|场景更新|场景切换|选项|摘要|音乐提示|规则|对话|剧情)】|$)/g);
                if (!blocks) return effects;
            
                for (const block of blocks) {
                    const lines = block.replace(/【效果】/, '').trim().split('\n');
                    const effect = { target: '玩家', numberChanges: [], itemChanges: [], statusChanges: [] };
            
                    let currentKey = null;
                    let currentValue = [];
            
                    const flush = () => {
                        if (!currentKey) return;
                        const value = currentValue.join('\n').trim();
                        currentValue = [];
            
                        if (currentKey === 'target') {
                            if (value) effect.target = value;
                        } else if (currentKey === 'number') {
                            this._parseNumberChanges(value, effect);
                        } else if (currentKey === 'entity') {
                            this._parseEntityChanges(value, effect);
                        }
                        currentKey = null;
                    };
            
                    // ★ 标题行 → 字段名的映射
                    const TITLE_KEYS = {
                        '目标': 'target',
                        'target': 'target',
                        '数值变化': 'number',
                        '数值': 'number',
                        '实体变化': 'entity',
                        '物品变化': 'entity',
                    };
            
                    for (let raw of lines) {
                        const line = raw.trim();
                        if (!line) continue;
            
                        // ---------- 1. 先判断是不是标题行 ----------
                        //    标题行 = `字段名:` 或 `字段名：`，冒号后为空
                        const isTitle = /^(目标|target|数值变化|数值|实体变化|物品变化)\s*[:：]\s*$/.test(line);
            
                        if (isTitle) {
                            flush();
                            const titleKey = line.replace(/[:：]\s*$/, '').trim();
                            currentKey = TITLE_KEYS[titleKey] || null;
                            continue;                       // ★ 标题行不 push 任何值
                        }
            
                        // ---------- 2. 带值的键值行 ----------
                        //    必须不是列表项（- 开头），且冒号后有内容
                        const isListItem = /^[-•*]\s/.test(line);
                        const kv = !isListItem ? line.match(/^(.+?)\s*[:：]\s*(.+)$/) : null;
            
                        if (kv && TITLE_KEYS[kv[1].trim()]) {
                            flush();
                            const key = TITLE_KEYS[kv[1].trim()];
                            currentKey = key;
                            currentValue.push(kv[2].trim());   // 同行值
                            continue;
                        }
            
                        // ---------- 3. 其他情况：续行 ----------
                        if (currentKey) {
                            currentValue.push(line);
                        }
                    }
                    flush();
            
                    effects.push(effect);
                }
                return effects;
            },
            
            // ★ 解析数值变化块（按行 + 顿号混合切分）
            _parseNumberChanges(value, effect) {
                if (!value) return;
            
                // 先按行切，再对每行按 、,， 切
                const parts = value.split('\n')
                    .flatMap(line => line.split(/[、,，]/))
                    .map(v => v.trim())
                    .filter(Boolean);
            
                for (const c of parts) {
                    const p = this.parseNumberChange(c);
                    if (p) effect.numberChanges.push(p);
                }
            },
            
            // ★ 解析实体变化块（★ 严格按行切分，不被中文逗号切碎）
            _parseEntityChanges(value, effect) {
                console.log('[DEBUG] _parseEntityChanges 收到的 value =', JSON.stringify(value));
                if (!value) return;
                // ★ 关键：按行切分，只保留以 - / • / * 开头的行
                const lines = value.split('\n')
                    .map(l => l.trim())
                    .filter(Boolean);
            
                // 如果整块没有任何列表前缀，就退化成一个整体去解析
                const hasListPrefix = lines.some(l => /^[-•*]\s/.test(l));
            
                let candidates;
                if (hasListPrefix) {
                    candidates = lines
                        .filter(l => /^[-•*]\s/.test(l))
                        .map(l => l.replace(/^[-•*]\s*/, '').trim())
                        .filter(Boolean);
                } else {
                    // 没有列表前缀 → 可能是 AI 偷懒写了单行
                    candidates = [value.replace(/\n/g, ' ').trim()];
                }
            
                let lastType = null;
            
                for (const c of candidates) {
                    let p = this.parseEntityChange(c);
            
                    // ★ 续行兜底：本行没识别出动词，但上一行有 → 补动词再试
                    if (!p && lastType) {
                        const verbMap = {
                            'obtain': '获得',
                            'lose': '失去',
                            'addStatus': '获得状态',
                            'removeStatus': '移除状态',
                        };
                        const verb = verbMap[lastType];
                        if (verb) {
                            p = this.parseEntityChange(`${verb} ${c}`);
                        }
                    }
            
                    if (p) {
                        lastType = p.type;
                        if (p.type === 'obtain' || p.type === 'lose') {
                            effect.itemChanges.push(p);
                        } else {
                            effect.statusChanges.push(p);
                        }
                    }
                }
            },
    
            parseNumberChange(text) {
                let m = text.match(/^(.+?)\s*([+\-])\s*(\d+)$/);
                if (m) return { key: m[1].trim(), operation: m[2] === '+' ? 'add' : 'subtract', value: parseInt(m[3]) };
                m = text.match(/^(.+?)\s*=\s*(\d+)$/);
                if (m) return { key: m[1].trim(), operation: 'set', value: parseInt(m[2]) };
                return null;
            },
    
            parseEntityChange(text) {
                let m;

                // ============================================================
                // ★ 新格式优先：完整的物品行
                //   获得【铁剑|⚔️】：锋利的短剑，[类型:武器|攻击:+5]
                //   失去【铁剑|⚔️】：...
                // ============================================================
                const fullMatch = text.match(/^(获得|失去|丢弃|消耗|拾取|拿到)\s*(【[\s\S]+)$/);
                if (fullMatch) {
                    const verb = fullMatch[1];
                    const itemLine = fullMatch[2].trim();

                    const parsed = window.WorldManager.parseItemLine(itemLine);
                    if (parsed && parsed.name) {
                        const count = parsed.count || 1;

                        if (/^(获得|拾取|拿到)$/.test(verb)) {
                            return {
                                type: 'obtain',
                                name: parsed.name,
                                count,
                                icon: parsed.icon || '📦',
                                description: parsed.description || '',
                                fields: parsed.fields || {},
                                interactions: parsed.interactions || [],
                                status: parsed.status || '',
                                effect: parsed.effect || '',
                                stackable: parsed.stackable,
                                maxStack: parsed.maxStack,
                                raw: itemLine,
                            };
                        } else {
                            return {
                                type: 'lose',
                                name: parsed.name,
                                count,
                                raw: itemLine,
                            };
                        }
                    }
                    // 完整行解析失败 → 继续走旧格式
                }

                // ============================================================
                // 状态类
                // ============================================================
                m = text.match(/^(?:获得状态|附加状态|附加)\s*(.+?)(?:\s*[x×]\s*\d+)?$/);
                if (m) {
                    const parsed = this._parseTagWithEffect(m[1].trim());
                    return { type: 'addStatus', name: parsed.name, effect: parsed.effect };
                }

                m = text.match(/^(?:移除状态|解除状态|解除)\s*(.+?)(?:\s*[x×]\s*\d+)?$/);
                if (m) {
                    const name = m[1].trim().replace(/[（(].*?[)）]\s*$/, '');
                    return { type: 'removeStatus', name };
                }

                // ============================================================
                // 旧格式：只有名字和数量
                // ============================================================
                m = text.match(/^(?:获得|拾取|拿到)\s*(.+?)\s*(?:[x×个]\s*)?(\d+)?$/);
                if (m) {
                    let name = m[1].trim();
                    let icon = '📦';
                    const iconMatch = name.match(/^(.+?)\s*[（(]([^）)]+)[)）]\s*$/);
                    if (iconMatch) {
                        name = iconMatch[1].trim();
                        const emoji = iconMatch[2].match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
                        if (emoji) icon = emoji[0];
                    }
                    return {
                        type: 'obtain',
                        name,
                        count: parseInt(m[2]) || 1,
                        icon,
                        description: '',
                        fields: {},
                        interactions: [],
                        status: '',
                        effect: '',
                    };
                }

                m = text.match(/^(?:失去|丢弃|消耗)\s*(.+?)\s*(?:[x×个]\s*)?(\d+)?$/);
                if (m) {
                    return { type: 'lose', name: m[1].trim(), count: parseInt(m[2]) || 1 };
                }

                return null;
            },
    
            // ★ 解析 "名字（效果1|效果2）"
            _parseTagWithEffect(raw) {
                const m = String(raw).match(/^(.+?)\s*[（(](.+?)[)）]\s*$/);
                if (!m) {
                    return { name: String(raw).trim(), effect: null };
                }
                const name = m[1].trim();
                const effectText = m[2].trim();
                const effect = this._parseEffectText(effectText);
                return { name, effect };
            },
    
            // ★ 解析效果文本（用 | 分隔）
            _parseEffectText(text) {
                const effect = {};
                const parts = String(text).split('|').map(s => s.trim()).filter(Boolean);
    
                for (const part of parts) {
                    if (/^跳过回合/.test(part)) { effect.跳过回合 = true; continue; }
    
                    const durMatch = part.match(/^持续\s*(\d+)\s*回合/);
                    if (durMatch) { effect.持续 = parseInt(durMatch[1]); continue; }
    
                    const ptMatch = part.match(/^每回合\s*([\u4e00-\u9fa5A-Za-z]+)\s*([+\-]?\d+(?:\.\d+)?)$/);
                    if (ptMatch) {
                        if (!effect.每回合) effect.每回合 = {};
                        effect.每回合[ptMatch[1].trim()] = parseFloat(ptMatch[2]);
                        continue;
                    }
    
                    const attrMatch = part.match(/^([\u4e00-\u9fa5A-Za-z]+)\s*([+\-])\s*(\d+(?:\.\d+)?)\s*(%|％)?$/);
                    if (attrMatch) {
                        const attr = attrMatch[1].trim();
                        const sign = attrMatch[2] === '-' ? -1 : 1;
                        let value = parseFloat(attrMatch[3]);
                        if (attrMatch[4]) value = value / 100;
                        else if (value >= 2) value = value / 100;
                        if (!effect.属性) effect.属性 = {};
                        effect.属性[attr] = (effect.属性[attr] || 0) + sign * value;
                        continue;
                    }
                }
    
                return Object.keys(effect).length > 0 ? effect : null;
            },
    
            applyEffects(effects) {
                const results = [];
                for (const effect of effects) {
                    const target = this.resolveTarget(effect.target);
                    if (!target) {
                        results.push({ success: false, reason: `找不到目标: ${effect.target}` });
                        continue;
                    }
                    effect.numberChanges.forEach(c => results.push(this.applyNumberChange(target, c)));
                    effect.itemChanges.forEach(c => results.push(this.applyItemChange(target, c)));
                    effect.statusChanges.forEach(c => results.push(this.applyStatusChange(target, c)));
                }
                return results;
            },
    
            resolveTarget(name) {
                if (!name) return null;
                
                // ★ 兼容玩家名字、AI 名字
                const playerName = PlayerStateManager.player?.name;
                const userName = CinemaWorld.currentUserName;
                const aiName = CinemaWorld.currentAIChatName;
                
                if (['玩家', '我', 'player', '自己', '自身'].includes(name)
                    || name === playerName
                    || name === userName
                    || name === aiName) {
                    return { type: 'player', ref: PlayerStateManager.player };
                }
                
                const scene = window.LocationModalManager.currentLocation;
                if (scene && scene.sceneCharacters) {
                    const ch = scene.sceneCharacters.find(c => c.name === name || name.includes(c.name));
                    if (ch) return { type: 'character', ref: ch };
                }
                return null;
            },
    
            applyNumberChange(target, change) {
                const result = { success: false, type: 'number', barName: change.key };
    
                // ★ 场景角色
                if (target.type === 'character') {
                    const keyMap = {
                        '好感度': 'favorability',
                        '好感': 'favorability',
                        '心情': 'mood',
                        '状态': 'status',
                    };
                    const field = keyMap[change.key] || null;
    
                    // ---------- 1. 已知字段 ----------
                    if (field) {
                        if (field === 'mood' || field === 'status') {
                            if (change.operation !== 'set') {
                                result.reason = `${change.key} 是文本字段，只支持赋值`;
                                return result;
                            }
                            result.before = { current: target.ref[field] };
                            target.ref[field] = String(change.value);
                            result.after = { current: target.ref[field] };
                            result.success = true;
        
                            // ★ 新增：mood 变化 → 刷立绘
                            if (field === 'mood') {
                                window.SpriteManager?.notifySceneSpriteUpdate(target.ref.name);
                            }
                            return result;
                        }
    
                        const raw = target.ref.favorability;
                        let cur = parseInt(raw);
                        if (isNaN(cur)) cur = 0;
                        const before = cur;
    
                        switch (change.operation) {
                            case 'add':      cur += change.value; break;
                            case 'subtract': cur -= change.value; break;
                            case 'set':      cur = change.value;  break;
                        }
                        cur = Math.max(0, cur);
    
                        result.before = { current: before };
                        target.ref.favorability = String(cur);
                        result.after = { current: cur };
                        result.success = true;
                        result.barName = '好感度';
                        // 好感度变化不影响立绘，不刷
                        return result;
                    }
    
                    // ---------- 2. 未知字段 → extraStats ----------
                    if (!target.ref.extraStats) {
                        target.ref.extraStats = { _order: [], _raw: '' };
                    }
                    const extra = target.ref.extraStats;
    
                    if (extra[change.key] === undefined) {
                        extra._order = extra._order || [];
                        extra._order.push(change.key);
                        extra[change.key] = String(change.value);
                        result.before = { current: 0 };
                        result.after = { current: change.value };
                        result.success = true;
                        result.barName = change.key;
                        return result;
                    }
    
                    const raw = String(extra[change.key]);
    
                    const barMatch = raw.match(/^(\d+)\s*\/\s*(\d+)([\s\S]*)$/);
                    if (barMatch) {
                        let cur = parseInt(barMatch[1]);
                        const max = parseInt(barMatch[2]);
                        const tail = barMatch[3] || '';
                        const before = cur;
    
                        switch (change.operation) {
                            case 'add':      cur += change.value; break;
                            case 'subtract': cur -= change.value; break;
                            case 'set':      cur = change.value;  break;
                        }
                        cur = Math.max(0, Math.min(max, cur));
    
                        extra[change.key] = `${cur}/${max}${tail}`;
                        result.before = { current: before, max };
                        result.after = { current: cur, max };
                        result.success = true;
                        result.barName = change.key;
                        return result;
                    }
    
                    const numMatch = raw.match(/^(-?\d+(?:\.\d+)?)([\s\S]*)$/);
                    if (numMatch) {
                        let cur = parseFloat(numMatch[1]);
                        const unit = numMatch[2] || '';
                        const before = cur;
    
                        switch (change.operation) {
                            case 'add':      cur += change.value; break;
                            case 'subtract': cur -= change.value; break;
                            case 'set':      cur = change.value;  break;
                        }
                        cur = Math.max(0, cur);
    
                        extra[change.key] = `${cur}${unit}`;
                        result.before = { current: before };
                        result.after = { current: cur };
                        result.success = true;
                        result.barName = change.key;
                        return result;
                    }
    
                    if (change.operation === 'set') {
                        result.before = { current: raw };
                        extra[change.key] = String(change.value);
                        result.after = { current: change.value };
                        result.success = true;
                        result.barName = change.key;
                        return result;
                    }
    
                    result.reason = `${change.key} 是文本字段，只支持赋值`;
                    return result;
                }
    
                // ==================== 玩家 ====================
    
                const extra = target.ref.extraStats;
                if (extra && extra[change.key] !== undefined) {
                    const raw = String(extra[change.key]);
                    const numMatch = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
                    if (numMatch) {
                        let cur = parseFloat(numMatch[1]);
                        const unit = numMatch[2] || '';
                        const before = cur;
                        switch (change.operation) {
                            case 'add':      cur += change.value; break;
                            case 'subtract': cur -= change.value; break;
                            case 'set':      cur = change.value;  break;
                        }
                        result.before = { current: before };
                        extra[change.key] = `${cur}${unit}`;
                        result.after = { current: cur };
                        result.success = true;
                        result.barName = change.key;
                        if (target.type === 'player') PlayerStateManager.refreshAvatarArea();
                        return result;
                    } else {
                        if (change.operation === 'set') {
                            result.before = { current: raw };
                            extra[change.key] = String(change.value);
                            result.after = { current: change.value };
                            result.success = true;
                            result.barName = change.key;
                            return result;
                        }
                        result.reason = `${change.key} 是文本字段，只支持赋值`;
                        return result;
                    }
                }
    
                const derived = target.ref.derivedStats?.computed;
                if (derived && derived[change.key]) {
                    const d = derived[change.key];
                    const before = d.current;
                    switch (change.operation) {
                        case 'add':      d.current = d.max !== undefined ? Math.min(d.max, d.current + change.value) : d.current + change.value; break;
                        case 'subtract': d.current = Math.max(0, d.current - change.value); break;
                        case 'set':      d.current = change.value; break;
                    }
                    result.before = { current: before };
                    result.after = { current: d.current, max: d.max };
                    result.success = true;
                    result.barName = change.key;
                    if (target.type === 'player') PlayerStateManager.refreshAvatarArea();
                    return result;
                }
    
                const bars = target.ref.statusBars || [];
                const bar = bars.find(b => b.key === change.key || b.key.includes(change.key) || change.key.includes(b.key));
                if (!bar) {
                    result.reason = `找不到数值条: ${change.key}`;
                    return result;
                }
                result.before = { current: bar.current, max: bar.max };
                result.barName = bar.key;
                switch (change.operation) {
                    case 'add': bar.current = Math.min(bar.max, bar.current + change.value); break;
                    case 'subtract': bar.current = Math.max(0, bar.current - change.value); break;
                    case 'set': bar.current = Math.min(bar.max, Math.max(0, change.value)); break;
                }
                result.after = { current: bar.current, max: bar.max };
                result.success = true;
    
                if (target.type === 'player') {
                    PlayerStateManager.refreshAvatarArea();
    
                    window.GameplayHooks.afterNumberChange(target.ref, bar).catch(e =>
                        console.error('[GameplayHooks] 执行失败:', e)
                    );
    
                    window.TriggerExecutor.processTriggers(bar, target.ref).catch(e =>
                        console.error('[TriggerExecutor] 执行失败:', e)
                    );
                }
                return result;
            },
    
            applyItemChange(target, change) {
                const result = {
                    success: false,
                    type: 'item',
                    item: change.name,
                    operation: change.type,
                    count: change.count,
                };
    
                if (change.type === 'obtain') {
                    if (target.type !== 'player') {
                        result.reason = '只有玩家有物品栏';
                        return result;
                    }

                    const curScene = window.LocationModalManager.currentLocation;
                    let sceneItem = null;
                    if (curScene && curScene.sceneItems) {
                        const idx = curScene.sceneItems.findIndex(i => i.name === change.name);
                        if (idx > -1) {
                            sceneItem = curScene.sceneItems[idx];
                            curScene.sceneItems.splice(idx, 1);
                            console.log(`[CinemaWorld] 从场景移除: ${change.name}`);
                        }
                    }

                    const inv = target.ref.inventory || [];
                    const ex = inv.find(i => i.name === change.name);

                    // ★ 字段优先级：change 自带 > 场景物品 > 空
                    const finalFields = (change.fields && Object.keys(change.fields).length > 0)
                        ? change.fields
                        : (sceneItem?.fields || {});

                    const finalInteractions = (change.interactions && change.interactions.length > 0)
                        ? change.interactions
                        : (sceneItem?.interactions || []);

                    const finalIcon = change.icon || sceneItem?.icon || '📦';
                    const finalDesc = change.description || sceneItem?.description || '';
                    const finalStatus = change.status || sceneItem?.status || '';
                    const finalEffect = change.effect || sceneItem?.effect || '';
                    const finalStackable = change.stackable ?? sceneItem?.stackable ?? false;
                    const finalMaxStack = change.maxStack ?? sceneItem?.maxStack ?? null;
                    const finalType = sceneItem?.type || change.type || 'item';

                    if (ex) {
                        ex.count += change.count;
                        result.before = ex.count - change.count;
                        result.after = ex.count;

                        // ★ 已有物品但字段空 → 用新字段补上
                        if (Object.keys(ex.fields || {}).length === 0 && Object.keys(finalFields).length > 0) {
                            ex.fields = finalFields;
                        }
                        if ((!ex.interactions || ex.interactions.length === 0) && finalInteractions.length > 0) {
                            ex.interactions = finalInteractions;
                        }
                        if ((!ex.icon || ex.icon === '📦') && finalIcon !== '📦') {
                            ex.icon = finalIcon;
                        }
                        if (!ex.description && finalDesc) {
                            ex.description = finalDesc;
                        }
                        if (!ex.status && finalStatus) ex.status = finalStatus;
                        if (!ex.effect && finalEffect) ex.effect = finalEffect;
                    } else {
                        inv.push({
                            name: change.name,
                            count: change.count,
                            description: finalDesc,
                            icon: finalIcon,
                            fields: { ...finalFields },
                            interactions: [...finalInteractions],
                            status: finalStatus,
                            effect: finalEffect,
                            stackable: finalStackable,
                            maxStack: finalMaxStack,
                            type: finalType,
                        });
                        result.before = 0;
                        result.after = change.count;
                    }
                    result.success = true;
                    result.from = sceneItem ? 'scene→inventory' : 'effect→inventory';
                    return result;
                }
    
                if (change.type === 'lose') {
                    const consumed = this._loseFromInventory(target, change);
                    if (consumed) {
                        result.success = true;
                        result.from = 'inventory';
                        result.before = consumed.before;
                        result.after = consumed.after;
                        return result;
                    }
    
                    const sceneResult = this._loseFromScene(change);
                    if (sceneResult) {
                        result.success = true;
                        result.from = 'scene';
                        result.sceneName = sceneResult.sceneName;
                        result.before = sceneResult.before;
                        result.after = sceneResult.after;
                        return result;
                    }
    
                    result.reason = `背包和场景中都没有物品: ${change.name}`;
                    return result;
                }
    
                return result;
            },
    
            _loseFromInventory(target, change) {
                if (target.type !== 'player') return null;
                const inv = target.ref.inventory || [];
                const ex = inv.find(i => i.name === change.name || i.name.includes(change.name));
                if (!ex) return null;
    
                const before = ex.count;
                ex.count -= change.count;
                if (ex.count <= 0) {
                    inv.splice(inv.indexOf(ex), 1);
                }
                return { before, after: Math.max(0, ex.count) };
            },
    
            _loseFromScene(change) {
                const scenes = [];
                const cur = window.LocationModalManager.currentLocation;
                if (cur) scenes.push(cur);
                for (const s of WorldManager.getLocations()) {
                    if (s !== cur) scenes.push(s);
                }
    
                for (const scene of scenes) {
                    const items = scene.sceneItems || [];
                    const idx = items.findIndex(i => i.name === change.name || i.name.includes(change.name));
                    if (idx > -1) {
                        const item = items[idx];
                        const before = item.count || 1;
                        const after = before - change.count;
    
                        if (after <= 0) {
                            items.splice(idx, 1);
                        } else {
                            item.count = after;
                        }
    
                        if (scene === cur) {
                            window.SceneItemBrowserManager.openBrowser?.();
                        }
                        return { before, after: Math.max(0, after), sceneName: scene.name };
                    }
                }
                return null;
            },
    
            applyStatusChange(target, change) {
                const result = {
                    success: false,
                    type: 'status',
                    status: change.name,
                    operation: change.type,
                };
    
                const tags = target.ref.tags || (target.ref.tags = []);
                const getName = (t) => typeof t === 'string' ? t : t.name;
    
                if (change.type === 'addStatus') {
                    const exists = tags.some(t => getName(t) === change.name);
                    if (exists) {
                        result.reason = '状态已存在';
                        return result;
                    }
    
                    let effect = change.effect;
                    if (!effect && typeof window.TagEffectManager !== 'undefined') {
                        effect = window.TagEffectManager.getEffect(change.name);
                    }
    
                    const duration = effect?.持续 ?? null;
    
                    tags.push({
                        name: change.name,
                        effect: effect || null,
                        duration: duration,
                    });
    
                    result.success = true;
                    result.effect = effect;
                    result.duration = duration;
    
                } else if (change.type === 'removeStatus') {
                    const idx = tags.findIndex(t => getName(t) === change.name);
                    if (idx > -1) {
                        tags.splice(idx, 1);
                        result.success = true;
                    } else {
                        result.reason = '状态不存在';
                    }
                }
    
                if (target.type === 'character' && typeof CharacterRegistry !== 'undefined') {
                    CharacterRegistry.upsert(target.ref, window.LocationModalManager.currentLocation?.name || '', true);
    
                // ★ 新增：状态变化 → 刷立绘
                if (result.success) {
                    window.SpriteManager?.notifySceneSpriteUpdate(target.ref.name);
                }
                }
    
                if (target.type === 'player' && typeof PlayerStateManager !== 'undefined') {
                    PlayerStateManager.refreshAvatarArea();
                    // ★ 新增：玩家状态变化 → 刷玩家场景立绘（如有）
                    window.SpriteManager?.notifySceneSpriteUpdate(PlayerStateManager.player.name);
                }
    
                return result;
            },
    
            formatResults(results) {
                if (!results || results.length === 0) return '';
                let text = '\n\n【数据变化】\n';
                let hasContent = false;
                for (const r of results) {
                    if (!r.success) continue;
                    hasContent = true;
                    if (r.type === 'number') {
                        const diff = r.after.current - r.before.current;
                        const sign = diff >= 0 ? '+' : '';
                        if (r.after.max !== undefined) {
                            text += `📊 ${r.barName}: ${r.before.current} → ${r.after.current} (${sign}${diff})\n`;
                        } else {
                            text += `📊 ${r.barName}: ${r.before.current} → ${r.after.current} (${sign}${diff})\n`;
                        }
                    } else if (r.type === 'item') {
                        text += `📦 ${r.operation === 'obtain' ? '获得' : '失去'} ${r.item} × ${r.count}\n`;
                    } else if (r.type === 'status') {
                        if (r.operation === 'addStatus') {
                            let line = `✨ 获得状态: ${r.status}`;
                            if (r.duration) line += `（${r.duration}回合）`;
                            text += line + '\n';
                        } else {
                            text += `✨ 移除状态: ${r.status}\n`;
                        }
                    }
                }
                return hasContent ? text : '';
            },
        };

    // ==================== 人物交互 ====================
    const CharacterInteractionManager = {
        open(characterIndex) {
            const scene = window.LocationModalManager.currentLocation;
            const ch = scene?.sceneCharacters?.[characterIndex];
            if (!ch) return;
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">💬 与 ${ch.name} 交互</div>
                <div style="margin-bottom:15px;color:#aaa;font-size:13px;padding:10px;background:rgba(0,0,0,.2);border-radius:8px;">
                    ${ch.description || ''}
                </div>
                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">你想说什么 / 做什么？</div>
                    <textarea class="cinemaworld-textarea" id="character-interact-input" 
                        placeholder="例如：'你好，我是路过这里的旅人。'&#10;（留空则由角色主动开口）"
                        style="min-height:120px;"></textarea>
                </div>
                <div style="text-align:center;">
                    <button class="cinemaworld-button primary" onclick="CharacterInteractionManager.start(${characterIndex})">💬 开始对话</button>
                    <button class="cinemaworld-button" onclick="SceneCharacterBrowserManager.openBrowser()">返回</button>
                </div>`;
            modal.className = 'active';
        },

        async start(characterIndex) {
            const input = document.getElementById('character-interact-input').value.trim();
            const action = input || '（玩家没有特别说什么，请基于当前场景自然地展开一段简短的对话）';
            const scene = window.LocationModalManager.currentLocation;
            const ch = scene.sceneCharacters[characterIndex];
            if (!ch) return;

            const chapterId = StoryManager.currentChapter?.id || null;

            const charStatus = [];
            if (ch.gender) charStatus.push(`性别: ${ch.gender}`);
            if (ch.mood) charStatus.push(`心情: ${ch.mood}`);
            if (ch.favorability) charStatus.push(`好感度: ${ch.favorability}`);
            if (ch.status) charStatus.push(`状态: ${ch.status}`);
            if (ch.tags?.length) charStatus.push(`标签: ${ch.tags.join('、')}`);

            const playerBlock = PlayerStateManager.formatForPrompt();

            const worldCtx = StoryManager.buildContext(null, {
                mainChars: false, scene: false, pendingEvents: false,
                digestFilter: {
                    sceneItems: false,
                    sceneActions: false,
                    inventoryItems: false,
                    characterFilter: 'onlySelf',
                    targetName: ch.name,
                },
                volumes: true,
            });

            const prompt = `你正在扮演一个视觉小说游戏。

★ 环境数据：${WorldManager.getEnvDataText(scene)}

${playerBlock}

【目标对象】
名称：${ch.name}
描述：${ch.description || ''}
${charStatus.join('\n')}

【玩家行动】
${action}

【任务】
生成一段玩家和 ${ch.name} 的对话脚本。

【输出格式】
每行: 【人物名|显示/隐藏|左/中/右|性别|状态】: 内容
旁白: 【旁白】: 内容
（6-12 句。状态可以是心情或状态列表中的内容）

【规则】
- 说话者"显示"，其他"隐藏"
- 玩家若要说话也写，不需要立绘
- 音乐(可选): 🎵 音乐: 曲名

【效果】（可选，造成数据变化才写）
目标: ${ch.name} 或 玩家
数值变化: 键名 +N  或  键名 -N
实体变化:
- 获得【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 失去【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
- 获得状态 状态名（可选效果，| 分隔：攻击-20%|持续3回合）
- 移除状态 状态名

★ 关键：获得物品时必须写完整格式（方括号内 键:值），否则玩家拿到的是空壳。
★ 可装备物品：写明属性字段，如 [类型:武器|攻击:+5|暴击:+10%]
★ 可消耗物品：写明功能，如 [类型:消耗品|功能:回复 50 点生命|可堆叠]
★ 普通物品：至少写 [类型:物品] 和图标

示例：
- 获得【生锈的铁剑|⚔️】：锈迹斑斑的短剑，[类型:武器|攻击:+3|图标:⚔️]
- 获得【红药水|🧪】：一瓶红色药剂，[类型:消耗品|功能:回复 30 点生命|可堆叠]
- 获得【黑面包|🍞】：还热乎，[类型:食物|功能:回复 10 点体力|可堆叠]
- 获得【金币|🪙】：[类型:货币|货币种类:金币]

【场景更新】（可选，行动改变场景才写）
场景: 场景名
环境数据: 
- 已有键:新值   （只改已有键，不发明新键）
新增人物: 
- 【名|性别|心情|好感度|状态|主次】：描述，[标签]
修改人物: 
- 【名】：心情|新值   （字段限：心情/状态/描述/标签）
移除人物: 名1、名2
新增实体:
 - 【名|图标】：描述，[类型|状态|功能|交互方式|其他]
物品: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
装备: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]
移除实体: 名1、名2
修改实体:
 - 【名】：状态→新状态
新增行动: 
- 【行动名|图标|once】：描述
移除行动: 行动名

【摘要】
（2-3 句。玩家做了什么/说了什么、${ch.name} 的反应与态度变化。作为后续交互和主线的上下文）

【世界历史】
${worldCtx}

请开始生成：
`;

            window.UIManager.closeModal();
            await window.UIManager.showText('正在生成对话...', 1000);
            const result = await window.generateFunctionalReply(prompt, 'character-interaction');
            if (!result) return;

            const summaryMatch = result.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
            const digestSummary = summaryMatch ? summaryMatch[1].trim() : '';

            const withoutDigest = result.replace(/【摘要】[\s\S]*?(?=\n【|$)/, '').trim();

            const updateIdx = withoutDigest.indexOf('【场景更新】');
            const effectIdx = withoutDigest.indexOf('【效果】');

            const cutPoints = [updateIdx, effectIdx].filter(i => i >= 0);
            const scriptEnd = cutPoints.length > 0 ? Math.min(...cutPoints) : withoutDigest.length;
            const dialogueText = withoutDigest.substring(0, scriptEnd).trim();

            let sceneUpdatePart = '';
            let effectPart = '';

            if (updateIdx >= 0) {
                const nextBlock = effectIdx > updateIdx ? effectIdx : withoutDigest.length;
                sceneUpdatePart = withoutDigest.substring(updateIdx, nextBlock);
            }
            if (effectIdx >= 0) {
                const nextBlock = updateIdx > effectIdx ? updateIdx : withoutDigest.length;
                effectPart = withoutDigest.substring(effectIdx, nextBlock);
            }

            await MusicManager.applyMusicMarker(result);

            const dialogues = window.VisualNovelManager.parseScript(dialogueText);
            if (dialogues.length === 0) {
                await MusicManager.clearOverrideMusic();
                await window.UIManager.showText('对话生成失败，格式错误', 2000);
                return;
            }

            await window.VisualNovelManager.play(dialogues);

            if (effectPart) {
                await new Promise(r => setTimeout(r, 300));
                const results = EffectSystem.applyFromNarrative(effectPart);
                const text = EffectSystem.formatResults(results);
                if (text) await window.UIManager.showText(text, 4000);
            }
            if (sceneUpdatePart) {
                await new Promise(r => setTimeout(r, 300));
                const update = StoryManager.parseSceneUpdate(sceneUpdatePart);
                if (update) {
                    await StoryManager.applySceneUpdate(update);
                }
            }
            window.SpriteManager?.notifySceneSpriteUpdate(ch.name);
            const cleanDialogue = dialogueText
                .split('\n')
                .filter(l => !/^🎵\s*音乐[:：]/.test(l.trim()))
                .join('\n')
                .trim();

            if (cleanDialogue) {
                InteractionDigestManager.addCharacterLines(ch.name, cleanDialogue, chapterId);
            }

            await MusicManager.clearOverrideMusic();

            InteractionHistoryManager.add({
                type: 'character',
                target: ch.name,
                targetMeta: {
                    gender: ch.gender,
                    mood: ch.mood,
                    favorability: ch.favorability,
                    status: ch.status,
                },
                scene: scene.name,
                playerInput: input,
                script: dialogueText,
                effect: effectPart || null,
                summary: digestSummary,
            });

            WorldManager.addToNarrativeLog(`[交互] 与 ${ch.name}`);
            if (window.SaveManager) window.SaveManager.save();
        },
    };

    // ==================== 场景人物浏览器 ====================
    const SceneCharacterBrowserManager = {
        openBrowser() {
            const scene = window.LocationModalManager.currentLocation;
            if (!scene) { alert('请先进入场景'); return; }
            const chars = scene.sceneCharacters || [];
            const modal = document.getElementById('cinemaworld-modal');

            if (chars.length === 0) {
                modal.innerHTML = `<div class="cinemaworld-modal-title">👥 场景人物</div>
                    <div style="text-align:center;padding:50px 20px;color:#888;">
                        <div style="font-size:40px;margin-bottom:15px;">🌫️</div><div>暂无人物</div>
                    </div>
                    <div style="text-align:center;margin-top:20px;"><button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button></div>`;
                modal.className = 'active';
                return;
            }

            let html = `<div class="cinemaworld-modal-title">👥 场景人物 · 【${scene.name}】</div><div style="display:grid;gap:12px;">`;
            chars.forEach((c, i) => { html += this.cardHTML(c, i); });
            html += `</div>
                <div style="text-align:center;margin-top:20px;"><button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button></div>`;
            modal.innerHTML = html;
            modal.className = 'active';
        },

        openHistoryFor(name) {
            InteractionHistoryManager.openHistoryModal('character', name);
        },

        cardHTML(char, index) {
            const state = SpriteManager.pickSpriteState(char);
            const spriteUrl = SpriteManager.getCachedSpriteWithState(char.name, state)
                           || SpriteManager.getCachedSprite(char.name)
                           || SpriteManager.getFromMapping(char.name);
            const avatarInner = spriteUrl
                ? `<img src="${spriteUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${char.name}">`
                : char.name.charAt(0);
            const avatarBg = spriteUrl ? 'transparent' : 'linear-gradient(135deg,#667eea,#764ba2)';

            if (!spriteUrl) {
                SpriteManager.ensureSpriteWithState(char.name, char.gender, state).then((url) => {
                    if (!url) return;
                    const el = document.querySelector(`[data-char-avatar="${char.name}"]`);
                    if (el) {
                        el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="${char.name}">`;
                        el.style.background = 'transparent';
                    }
                });
            }

            return `
                <div style="background:linear-gradient(135deg,rgba(40,40,60,.6),rgba(30,30,50,.8));border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px;transition:all .2s ease;"
                     onmouseover="this.style.borderColor='rgba(255,255,255,.2)'"
                     onmouseout="this.style.borderColor='rgba(255,255,255,.08)'">
                    <span data-char-avatar="${char.name}" 
                          style="width:48px;height:48px;border-radius:50%;overflow:hidden;background:${avatarBg};display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;font-weight:bold;flex-shrink:0;">${avatarInner}</span>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:16px;font-weight:bold;color:#fff;">${char.name}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button class="cinemaworld-button primary" 
                            style="font-size:12px;padding:6px 12px;margin:0;"
                            onclick="CharacterInteractionManager.open(${index})"
                            title="交互">💬</button>
                        <button class="cinemaworld-button" 
                            style="font-size:12px;padding:6px 12px;margin:0;"
                            onclick="InteractionHistoryManager.openHistoryModal('character', '${char.name.replace(/'/g, "\\\\'")}')"
                            title="历史">📜</button>
                        <button class="cinemaworld-button" 
                        style="font-size:12px;padding:6px 12px;margin:0;"
                        onclick="ClickRuleManager.openPanel('${char.name.replace(/'/g, "\\\\'")}')"
                        title="点击反应">👆</button>
                        <button class="cinemaworld-button" 
                            style="font-size:12px;padding:6px 12px;margin:0;"
                            onclick="SceneCharacterBrowserManager.viewDetail(${index})"
                            title="详情">🔍</button>
                    </div>
                </div>`;
        },

        viewDetail(index) {
            const scene = window.LocationModalManager.currentLocation;
            const char = scene?.sceneCharacters?.[index];
            if (!char) return;

            const modal = document.getElementById('cinemaworld-modal');

            const moodColors = {
                '开心': '#7dd87d', '高兴': '#7dd87d', '喜悦': '#7dd87d',
                '平静': '#7da8d8', '冷静': '#7da8d8', '中性': '#a0a0a0',
                '忧郁': '#9b7dd8', '悲伤': '#9b7dd8', '愤怒': '#d87d7d',
                '生气': '#d87d7d', '紧张': '#d8c07d', '焦虑': '#d8c07d',
                '警惕': '#d8a87d', '似笑非笑': '#c8a8d8',
            };
            const moodColor = moodColors[char.mood] || '#a0a0a0';

            let favColor = '#a0a0a0';
            const favNum = parseInt(char.favorability);
            if (!isNaN(favNum)) {
                if (favNum >= 70) favColor = '#7dd87d';
                else if (favNum >= 40) favColor = '#d8c07d';
                else if (favNum >= 10) favColor = '#d8a87d';
                else favColor = '#d87d7d';
            }

            const state = SpriteManager.pickSpriteState(char);
            const spriteUrl = SpriteManager.getCachedSpriteWithState(char.name, state)
                           || SpriteManager.getCachedSprite(char.name)
                           || SpriteManager.getFromMapping(char.name);
            const avatarInner = spriteUrl
                ? `<img src="${spriteUrl}" style="width:100%;height:100%;object-fit:cover;" alt="${char.name}">`
                : char.name.charAt(0);
            const avatarBg = spriteUrl ? 'transparent' : 'linear-gradient(135deg,#667eea,#764ba2)';

            if (!spriteUrl) {
                SpriteManager.ensureSpriteWithState(char.name, char.gender, state).then((url) => {
                    if (!url) return;
                    const el = document.querySelector('[data-detail-avatar]');
                    if (el) {
                        el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`;
                        el.style.background = 'transparent';
                    }
                });
            }

            const tagsHTML = (char.tags || []).map(t => {
                const name = typeof t === 'string' ? t : t.name;
                const dur = (typeof t === 'object' && t.duration)
                    ? `<span style="color:#888;font-size:10px;margin-left:4px;">${t.duration}回合</span>`
                    : '';
                return `<span style="display:inline-block;padding:4px 12px;margin:3px 4px 3px 0;background:rgba(120,150,255,.15);border:1px solid rgba(120,150,255,.3);border-radius:12px;font-size:12px;color:#9ab0ff;">${name}${dur}</span>`;
            }).join('');

            const interactions = (CinemaWorld.worldState.interactions || [])
                .filter(r => r.type === 'character' && r.target === char.name);

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">👤 ${char.name}</div>

                <div style="display:flex;flex-direction:column;align-items:center;padding:10px 0 20px;">
                    <div data-detail-avatar style="width:120px;height:120px;border-radius:50%;overflow:hidden;background:${avatarBg};display:flex;align-items:center;justify-content:center;color:#fff;font-size:48px;font-weight:bold;box-shadow:0 8px 24px rgba(102,126,234,.35);">
                        ${avatarInner}
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;">
                    ${char.gender ? `
                        <div style="background:rgba(255,255,255,.05);border-radius:10px;padding:12px;">
                            <div style="font-size:11px;color:#888;margin-bottom:4px;">性别</div>
                            <div style="font-size:15px;color:#fff;font-weight:bold;">${char.gender}</div>
                        </div>
                    ` : ''}
                    ${char.mood ? `
                        <div style="background:rgba(255,255,255,.05);border-radius:10px;padding:12px;">
                            <div style="font-size:11px;color:#888;margin-bottom:4px;">心情</div>
                            <div style="font-size:15px;color:${moodColor};font-weight:bold;">${char.mood}</div>
                        </div>
                    ` : ''}
                    ${char.favorability ? `
                        <div style="background:rgba(255,255,255,.05);border-radius:10px;padding:12px;">
                            <div style="font-size:11px;color:#888;margin-bottom:4px;">好感度</div>
                            <div style="font-size:15px;color:${favColor};font-weight:bold;">${char.favorability}</div>
                        </div>
                    ` : ''}
                    <div style="background:rgba(255,255,255,.05);border-radius:10px;padding:12px;">
                        <div style="font-size:11px;color:#888;margin-bottom:4px;">交互次数</div>
                        <div style="font-size:15px;color:#7da8ff;font-weight:bold;">${interactions.length}</div>
                    </div>
                </div>

                ${char.status ? `
                    <div style="background:rgba(255,255,255,.03);border-radius:10px;padding:12px;margin-bottom:12px;">
                        <div style="font-size:11px;color:#888;margin-bottom:6px;">当前状态</div>
                        <div style="font-size:13px;color:#ddd;line-height:1.7;font-style:italic;">💭 ${char.status}</div>
                    </div>
                ` : ''}

                ${char.description ? `
                    <div style="background:rgba(255,255,255,.03);border-radius:10px;padding:12px;margin-bottom:12px;">
                        <div style="font-size:11px;color:#888;margin-bottom:6px;">人物描述</div>
                        <div style="font-size:13px;color:#ddd;line-height:1.8;">${char.description}</div>
                    </div>
                ` : ''}

                ${tagsHTML ? `
                    <div style="background:rgba(255,255,255,.03);border-radius:10px;padding:12px;margin-bottom:12px;">
                        <div style="font-size:11px;color:#888;margin-bottom:6px;">标签</div>
                        <div>${tagsHTML}</div>
                    </div>
                ` : ''}

                ${(() => {
                    const extra = char.extraStats;
                    if (!extra || !extra._order || extra._order.length === 0) return '';
                    let extraHTML = '';
                    for (const k of extra._order) {
                        const v = extra[k];
                        if (v === undefined || v === '') continue;

                        const barMatch = String(v).match(/^(\d+)\s*\/\s*(\d+)([\s\S]*)$/);
                        if (barMatch) {
                            const cur = parseInt(barMatch[1]);
                            const max = parseInt(barMatch[2]);
                            const tail = (barMatch[3] || '').trim();
                            const pct = max > 0 ? Math.min(100, cur / max * 100) : 0;
                            extraHTML += `
                                <div style="margin-bottom:10px;">
                                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
                                        <span style="color:#ccc;">${k}</span>
                                        <span style="color:#888;font-family:monospace;">${cur}/${max}</span>
                                    </div>
                                    <div style="height:6px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden;">
                                        <div style="width:${pct}%;height:100%;background:linear-gradient(90deg,#7da8ff,#a8c4ff);border-radius:3px;transition:width .3s ease;"></div>
                                    </div>
                                    ${tail ? `<div style="font-size:11px;color:#888;margin-top:4px;">${tail}</div>` : ''}
                                </div>`;
                        } else {
                            extraHTML += `
                                <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid rgba(255,255,255,.04);">
                                    <span style="color:#ccc;">${k}</span>
                                    <span style="color:#ffd76b;font-weight:600;">${v}</span>
                                </div>`;
                        }
                    }
                    return `
                        <div style="background:rgba(255,255,255,.03);border-radius:10px;padding:12px;margin-bottom:20px;">
                            <div style="font-size:11px;color:#888;margin-bottom:8px;">📊 数据</div>
                            ${extraHTML}
                        </div>`;
                })()}

                <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="CharacterInteractionManager.open(${index})">💬 交互</button>
                    <button class="cinemaworld-button" onclick="SceneCharacterBrowserManager.openHistoryFor('${char.name.replace(/'/g, "\\'")}')">📜 历史</button>
                    <button class="cinemaworld-button" onclick="ClickRuleManager.openPanel('${char.name.replace(/'/g, "\\'")}')">👆 点击反应</button>
                    <button class="cinemaworld-button" onclick="SceneCharacterBrowserManager.openBrowser()">← 返回</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>
            `;
        },
    };

        // ==================== 场景物品浏览器 ====================
            // ==================== 场景物品浏览器 ====================
    const SceneItemBrowserManager = {
        _selectedIndex: 0,

        // ---------- 主入口 ----------
        openBrowser(keepIndex = false) {
            const scene = window.LocationModalManager.currentLocation;
            if (!scene) { alert('请先进入场景'); return; }

            const items = scene.sceneItems || [];
            const modal = document.getElementById('cinemaworld-modal');

            // 空场景 → 单独渲染
            if (items.length === 0) {
                this._renderEmpty(modal, scene);
                return;
            }

            // 修正选中索引
            if (!keepIndex || this._selectedIndex >= items.length) {
                this._selectedIndex = 0;
            }
            if (this._selectedIndex < 0) this._selectedIndex = 0;

            // 切到与背包一致的容器 class，复用左右布局样式
            modal.className = 'active cw-inv-modal';
            modal.innerHTML = this._renderHTML(scene, items);
        },

        // ---------- 空场景 ----------
        _renderEmpty(modal, scene) {
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📦 场景实体 · 【${scene.name}】</div>
                ${this._renderToolbar(scene)}
                <div style="text-align:center;padding:40px 20px;color:#888;">
                    <div style="font-size:40px;margin-bottom:15px;">📭</div>
                    <div>暂无实体</div>
                    <div style="font-size:12px;color:#666;margin-top:8px;">
                        点击上方"➕ 创建实体"添加一个
                    </div>
                </div>
                <div style="text-align:center;margin-top:20px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
        },

        // ---------- 顶部工具栏 ----------
        _renderToolbar(scene) {
            return `
                <div style="display:flex;justify-content:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary"
                        style="font-size:13px;"
                        onclick="SceneItemBrowserManager.openCreateMenu()">
                        ➕ 创建实体
                    </button>
                    <button class="cinemaworld-button"
                        style="font-size:13px;"
                        onclick="SceneEditorManager.openItems('${scene.name}')">
                        ✏️ 批量编辑
                    </button>
                    <button class="cinemaworld-button" onclick="CityBuilderUIManager.open()">🏙️ 城市</button>
                    <button class="cinemaworld-button"
                        style="font-size:13px;"
                        onclick="SimulationUIManager._openCreateSimulation()">
                        🏭 创建经营实体
                    </button>
                </div>`;
        },

        // ---------- 主布局 ----------
        _renderHTML(scene, items) {
            const selected = items[this._selectedIndex];

            return `
                <div class="cinemaworld-modal-title">
                    📦 场景实体 · 【${scene.name}】 (${items.length})
                </div>
                ${this._renderToolbar(scene)}

                <div class="cw-inv-layout">
                    <div class="cw-inv-left cw-scene-items-left">
                        <div class="cw-inv-grid">
                            ${this._renderGrid(items)}
                        </div>
                    </div>
                    <div class="cw-inv-right">
                        ${this._renderDetailPanel(scene, selected, this._selectedIndex)}
                    </div>
                </div>

                <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
        },

        // ---------- 左侧：格子（数量按实体数渲染）----------
        _renderGrid(items) {
            let html = '';
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const isSelected = i === this._selectedIndex;
                const isEncounter = window.EncounterManager.isEncounter(item);
                const isSimulation = (item.fields?.['类型'] === '经营') || item.simulation?.initialized;
                const icon = item.icon || '📦';
                const inContext = item.fields?.['加入上下文'] === '是';

                const extraClass = isEncounter ? 'cw-scene-item-encounter'
                                 : isSimulation ? 'cw-scene-item-sim'
                                 : '';

                let badge = '';
                if (isEncounter) {
                    badge = `<div class="cw-inv-slot-badge cw-badge-encounter">⚔️</div>`;
                } else if (isSimulation) {
                    badge = `<div class="cw-inv-slot-badge cw-badge-sim">🏭</div>`;
                }

                html += `
                    <div class="cw-inv-slot ${isSelected ? 'selected' : ''} ${extraClass}"
                        onclick="SceneItemBrowserManager.selectItem(${i})"
                        title="${this._escapeAttr(item.name)}">
                        ${badge}
                        <div class="cw-inv-slot-icon">${icon}</div>
                    </div>`;
            }
            return html;
        },

        // ---------- 右侧：详情面板 ----------
        _renderDetailPanel(scene, item, index) {
            if (!item) {
                return `
                    <div class="cw-inv-empty-detail">
                        <div class="cw-inv-empty-icon">👈</div>
                        <div class="cw-inv-empty-text">选择左侧格子查看实体</div>
                    </div>`;
            }

            const isEncounter = window.EncounterManager.isEncounter(item);
            const isSimulation = (item.fields?.['类型'] === '经营') || item.simulation?.initialized;
            const icon = item.icon || '📦';

            // 类型徽章
            let typeBadge = '';
            if (isEncounter) {
                typeBadge = `<span class="cw-inv-detail-badge cw-badge-encounter">⚔️ 遭遇</span>`;
            } else if (isSimulation) {
                typeBadge = `<span class="cw-inv-detail-badge cw-badge-sim">🏭 经营</span>`;
            }

            // 描述
            const descHTML = item.description
                ? `<div class="cw-inv-detail-section">
                    <div class="cw-inv-detail-section-label">📝 描述</div>
                    <div class="cw-inv-detail-desc">${item.description}</div>
                   </div>`
                : '';

            // 字段
            const fieldRows = [];
            if (item.status) {
                fieldRows.push(`
                    <div class="cw-inv-detail-attr">
                        <span class="key">状态</span>
                        <span class="val">${item.status}</span>
                    </div>`);
            }
            if (item.effect) {
                fieldRows.push(`
                    <div class="cw-inv-detail-attr">
                        <span class="key">功能</span>
                        <span class="val">${item.effect}</span>
                    </div>`);
            }
            for (const [k, v] of Object.entries(item.fields || {})) {
                if (k.startsWith('_pos')) continue;
                if (['状态', '功能', '图标', 'icon', '类型'].includes(k)) continue;
                const isCombat = isEncounter && /HP|攻击|防御|敏捷|技能|掉落|生命|速度/i.test(k);
                fieldRows.push(`
                    <div class="cw-inv-detail-attr">
                        <span class="key">${k}</span>
                        <span class="val ${isCombat ? 'bonus' : ''}">${v}</span>
                    </div>`);
            }

            const fieldsHTML = fieldRows.length > 0
                ? `<div class="cw-inv-detail-section">
                    <div class="cw-inv-detail-section-label">📋 属性</div>
                    ${fieldRows.join('')}
                   </div>`
                : '';

            // 交互方式
            let interactionsHTML = '';
            if (item.interactions && item.interactions.length > 0) {
                const chips = item.interactions.map(inter => `
                    <span class="cw-inv-chip">
                        ${inter.name}
                        ${inter.hint ? `<span class="hint">${inter.hint}</span>` : ''}
                    </span>`).join('');
                interactionsHTML = `<div class="cw-inv-detail-section">
                    <div class="cw-inv-detail-section-label">⚡ 交互方式</div>
                    <div class="cw-inv-detail-chips">${chips}</div>
                </div>`;
            }

            // 主操作按钮
            let primaryBtn = '';
            if (isEncounter) {
                primaryBtn = `<button class="cw-inv-action-btn primary cw-btn-danger"
                    onclick="EncounterManager.startEncounter(${index})">
                    ⚔️ 遭遇
                </button>`;
            } else if (isSimulation) {
                primaryBtn = `<button class="cw-inv-action-btn primary cw-btn-sim"
                    onclick="SimulationUIManager.open('${this._escapeAttr(item.name)}')">
                    🏭 经营
                </button>`;
            } else {
                primaryBtn = `<button class="cw-inv-action-btn primary"
                    onclick="SceneItemBrowserManager.useItem(${index})">
                    ✨ 交互
                </button>`;
            }
            // ★ 新增：遭遇实体的"加入上下文"开关
            const inContext = item.fields?.['加入上下文'] === '是';
            const contextToggleHTML = isEncounter ? `
                <label class="cw-inv-action-btn full-width"
                    style="cursor:pointer;user-select:none;
                        color:${inContext ? '#9ee89e' : '#888'};
                        background:${inContext ? 'rgba(80,216,120,.12)' : 'rgba(255,255,255,.04)'};
                        border-color:${inContext ? 'rgba(80,216,120,.45)' : 'rgba(255,255,255,.12)'};"
                    title="勾选后，战斗胜利的摘要会写入主线上下文">
                    <input type="checkbox"
                        ${inContext ? 'checked' : ''}
                        style="cursor:pointer;accent-color:#4a9d5c;width:14px;height:14px;margin-right:6px;"
                        onchange="SceneItemBrowserManager.toggleContextFlag(${index}, this.checked)">
                    📝 加入上下文
                </label>
            ` : '';
            const historyType = isEncounter ? 'battle' : 'sceneItem';
            const safeName = this._escapeAttr(item.name);

            return `
                <div class="cw-inv-detail">
                    <div class="cw-inv-detail-head">
                        <div class="cw-inv-detail-icon">${icon}</div>
                        <div class="cw-inv-detail-meta">
                            <div class="cw-inv-detail-name">${item.name}</div>
                            <div class="cw-inv-detail-count">
                                ${typeBadge || `第 ${index + 1} / ${scene.sceneItems.length} 项`}
                            </div>
                        </div>
                    </div>
                    ${descHTML}
                    ${fieldsHTML}
                    ${interactionsHTML}
                    <div class="cw-inv-actions">
                        ${primaryBtn}
                        <button class="cw-inv-action-btn"
                            onclick="InteractionHistoryManager.openHistoryModal('${historyType}', '${safeName}')">
                            📜 历史
                        </button>
                        ${contextToggleHTML}
                        <button class="cw-inv-action-btn danger full-width"
                            onclick="SceneItemBrowserManager.confirmDelete(${index})">
                            🗑️ 删除
                        </button>
                    </div>
                </div>`;
        },

        // ---------- 选中 ----------
        selectItem(index) {
            this._selectedIndex = index;
            this.openBrowser(true);
        },
        // ---------- 切换"加入上下文"开关 ----------
        toggleContextFlag(index, checked) {
            const scene = window.LocationModalManager.currentLocation;
            if (!scene) return;
            const item = scene.sceneItems?.[index];
            if (!item) return;

            item.fields = item.fields || {};
            if (checked) {
                item.fields['加入上下文'] = '是';
            } else {
                delete item.fields['加入上下文'];
            }

            if (typeof window.SceneEditorManager !== 'undefined') {
                window.SceneEditorManager._rebuildRaw(scene);
            }

            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText(
                checked
                    ? `已开启【${item.name}】的上下文记录`
                    : `已关闭【${item.name}】的上下文记录`,
                1200
            );
            // 重渲染以更新颜色/勾选状态
            this.openBrowser(true);
        },
        // ---------- 交互（原逻辑保留）----------
        async useItem(index) {
            const scene = window.LocationModalManager.currentLocation;
            const item = scene.sceneItems[index];
            if (!item) return;
            const modal = document.getElementById('cinemaworld-modal');

            let fieldsHTML = '';
            if (item.status) fieldsHTML += `<span style="color:#887;">状态：</span>${item.status}<br>`;
            if (item.effect) fieldsHTML += `<span style="color:#888;">功能：</span>${item.effect}<br>`;
            for (const [key, value] of Object.entries(item.fields || {})) {
                if (key.startsWith('_pos')) continue;
                if (['状态', '功能', '图标', 'icon', '交互', '交互方式', '互动', '互动方式', '操作'].includes(key)) continue;
                fieldsHTML += `<span style="color:#888;">${key}：</span>${value}<br>`;
            }

            const interactions = item.interactions || [];
            let modesHTML = '';
            if (interactions.length > 0) {
                const allModes = [
                    ...interactions.map((inter, i) => ({ ...inter, _index: i, _free: false })),
                    { name: '自由发挥', hint: '不按预设，用自己的方式互动', _index: -1, _free: true },
                ];
                modesHTML = `
                    <div style="margin-bottom:15px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:8px;">选择交互方式（可不选，直接输入）：</div>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;max-height:240px;overflow-y:auto;">
                            ${allModes.map(m => `
                                <div class="cw-interact-mode" data-index="${m._index}"
                                    onclick="SceneItemBrowserManager.selectMode(${m._index})"
                                    style="display:flex;align-items:center;gap:8px;padding:10px 14px;
                                        background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
                                        border-radius:8px;cursor:pointer;transition:all .2s;"
                                    onmouseover="this.style.background='rgba(120,150,255,.15)'"
                                    onmouseout="if(!this.classList.contains('selected'))this.style.background='rgba(255,255,255,.05)'">
                                    <span style="font-size:16px;">${m._free ? '✍️' : '✨'}</span>
                                    <div style="flex:1;">
                                        <div style="font-size:13px;color:#fff;font-weight:600;">${m.name}</div>
                                        ${m.hint ? `<div style="font-size:11px;color:#888;">${m.hint}</div>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                modesHTML = `
                    <div style="font-size:12px;color:#888;padding:8px 0;margin-bottom:12px;">
                        这个实体没有预设的交互方式，你可以自由描述想做什么。
                    </div>`;
            }

            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">✨ 与 ${item.name} 交互</div>
                <div style="margin-bottom:15px;color:#aaa;font-size:13px;padding:10px;background:rgba(0,0,0,.2);border-radius:8px;">
                    ${item.description || ''}
                    ${fieldsHTML ? `<div style="margin-top:6px;">${fieldsHTML}</div>` : ''}
                </div>
                ${modesHTML}
                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                        ${interactions.length > 0 ? '补充描述（可选）：' : '你想做什么？'}
                    </div>
                    <textarea class="cinemaworld-textarea" id="scene-item-use-input"
                        placeholder="${interactions.length > 0 ? '例如：我想仔细看看它的背面...' : '例如：我试着把它翻过来看看底部'}"
                        style="min-height:60px;"></textarea>
                </div>
                <div style="text-align:center;">
                    <button class="cinemaworld-button primary" onclick="SceneItemBrowserManager.doUse(${index})">确认</button>
                    <button class="cinemaworld-button" onclick="SceneItemBrowserManager.openBrowser(true)">返回</button>
                </div>`;

            if (interactions.length > 0) {
                this._selectedModeIndex = 0;
                setTimeout(() => this.selectMode(0), 0);
            } else {
                this._selectedModeIndex = -1;
            }
        },

        _selectedModeIndex: -1,

        selectMode(index) {
            this._selectedModeIndex = index;
            document.querySelectorAll('.cw-interact-mode').forEach(el => {
                const isSelected = parseInt(el.dataset.index) === index;
                el.classList.toggle('selected', isSelected);
                el.style.background = isSelected ? 'rgba(120,150,255,.3)' : 'rgba(255,255,255,.05)';
                el.style.borderColor = isSelected ? 'rgba(120,150,255,.7)' : 'rgba(255,255,255,.1)';
            });
        },

        async doUse(index) {
            const scene = window.LocationModalManager.currentLocation;
            const item = scene.sceneItems[index];
            if (!item) return;

            const chapterId = StoryManager.currentChapter?.id || null;

            const input = document.getElementById('scene-item-use-input').value.trim();
            const interactions = item.interactions || [];

            let modeLabel = '自由交互';
            let modeLine = '';
            if (interactions.length > 0 && this._selectedModeIndex >= 0) {
                const inter = interactions[this._selectedModeIndex];
                if (inter) {
                    modeLabel = inter.name;
                    modeLine = `${inter.name}${inter.hint ? '（' + inter.hint + '）' : ''}`;
                }
            }

            const sceneCtx = InventoryManager.buildSceneContext(scene);
            const playerBlock = PlayerStateManager.formatForPrompt();

            const worldCtx = StoryManager.buildContext(null, {
                parentStory: false, mainChars: false, scene: false, pendingEvents: false,
                digestFilter: {
                    sceneActions: false,
                    characters: false,
                    inventoryItems: false,
                },
                volumes: false, chapters: false,
            });

            await window.UIManager.showText(`正在${modeLabel} ${item.name}...`, 1000);

            const entityFields = Object.entries(item.fields || {})
                .filter(([k]) => !k.startsWith('_pos') && !['状态', '功能', '图标', 'icon', '交互', '交互方式', '互动', '互动方式', '操作'].includes(k))
                .map(([k, v]) => `${k}：${v}`)
                .join('\n');

            const prompt = `你正在为视觉小说游戏生成一段"与场景实体交互"的剧情脚本。

【世界历史】
${worldCtx}

【场景上下文】
${sceneCtx}

★ 环境数据：${WorldManager.getEnvDataText(scene)}

${playerBlock}

【交互目标】
名称：${item.name}
描述：${item.description || '无'}
${item.status ? `状态：${item.status}` : ''}
${item.effect ? `功能：${item.effect}` : ''}
${entityFields}

【交互方式】
${modeLine || '（玩家自由发挥）'}
${input ? `玩家补充：${input}` : ''}

【任务】
生成一段脚本，描述玩家${modeLabel}这个实体的过程和结果。

【输出格式】
每行: 【角色名|显示/隐藏|左/中/右|性别|状态】: 内容
旁白: 【旁白】: 内容
（5-10 行。状态可以是心情或状态列表中的内容）

规则：
- 说话者"显示"，其他"隐藏"
- 只能使用【场景上下文】中列出的角色
- 人物性别从上下文获取
- 音乐(可选): 🎵 音乐: 曲名

★ 实体类型：可能是物品/建筑/植物/家具/机关，根据名称描述自然判断
★ 玩家方式不合理时（如对石头说话），写"你试着对它说话，但它毫无反应"之类

【效果】（可选，交互造成数据变化才写）
目标: 玩家
数值变化: 键名 +N  或  键名 -N
实体变化:
- 获得【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 失去【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
- 获得状态 状态名（可选效果，| 分隔：攻击-20%|持续3回合）
- 移除状态 状态名

★ 关键：获得物品时必须写完整格式（方括号内 键:值），否则玩家拿到的是空壳。
★ 可装备物品：写明属性字段，如 [类型:武器|攻击:+5|暴击:+10%]
★ 可消耗物品：写明功能，如 [类型:消耗品|功能:回复 50 点生命|可堆叠]
★ 普通物品：至少写 [类型:物品] 和图标

示例：
- 获得【生锈的铁剑|⚔️】：锈迹斑斑的短剑，[类型:武器|攻击:+3|图标:⚔️]
- 获得【红药水|🧪】：一瓶红色药剂，[类型:消耗品|功能:回复 30 点生命|可堆叠]
- 获得【黑面包|🍞】：还热乎，[类型:食物|功能:回复 10 点体力|可堆叠]
- 获得【金币|🪙】：[类型:货币|货币种类:金币]

状态效果(可选，| 分隔)：攻击-20% / 防御+30% / 每回合:生命-5 / 持续:3回合 / 跳过回合
示例：获得状态 中毒（生命-5|持续3回合）

★ 拿起/带走：写"获得 物品名 x1"，系统会自动移入背包
★ 无法移动的实体（建筑/大树/固定装置）：剧情里说"动不了"，不给【效果】
★ 交互消耗了实体：写"失去 该实体"

【场景更新】（可选，只有场景变化才写）
环境数据: 
- 已有键:新值   （只改已有键，不发明新键）
新增实体:
 - 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
物品: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
装备: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]
新增遭遇(写入新增实体，类型必须写"遭遇"): 
- 【名|图标】：描述，[类型:遭遇|HP:当前/最大|攻击:X|防御:X|敏捷:X|技能:X|掉落:X]
新增行动: 
- 【行动名|图标|once】：描述
（once 一次性 / repeat 可重复；玩家有了新"可做的事"时写）
移除行动: 行动名1、行动名2
（行动失去意义时写）

【禁止】
× 捏造场景里没有的角色（要引入就用"旁白"描述路人，不取名）
× 场景更新时新发明环境数据键

场景人物: ${scene?.sceneCharacters?.map(c => c.name).join('、') || '（无）'}
场景实体: ${scene?.sceneItems?.map(i => i.name).join('、') || '（无）'}

【摘要】
（2-3 句。玩家如何交互、产生什么后果、是否有意外/悬念。作为后续交互和主线的上下文。）

请开始生成：
`;

            const result = await window.generateFunctionalReply(prompt, 'use-scene-item');
            if (!result) return;

            const summaryMatch = result.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
            const digestSummary = summaryMatch ? summaryMatch[1].trim() : '';

            const withoutDigest = result.replace(/【摘要】[\s\S]*?(?=\n【|$)/, '').trim();

            const updateIdx = withoutDigest.indexOf('【场景更新】');
            const effectIdx = withoutDigest.indexOf('【效果】');
            const cutPoints = [updateIdx, effectIdx].filter(i => i >= 0);
            const scriptEnd = cutPoints.length > 0 ? Math.min(...cutPoints) : withoutDigest.length;
            const scriptText = withoutDigest.substring(0, scriptEnd).trim();

            let sceneUpdatePart = '';
            let effectPart = '';
            if (updateIdx >= 0) {
                const nextBlock = effectIdx > updateIdx ? effectIdx : withoutDigest.length;
                sceneUpdatePart = withoutDigest.substring(updateIdx, nextBlock);
            }
            if (effectIdx >= 0) {
                const nextBlock = updateIdx > effectIdx ? updateIdx : withoutDigest.length;
                effectPart = withoutDigest.substring(effectIdx, nextBlock);
            }

            await MusicManager.applyMusicMarker(result);

            const dialogues = window.VisualNovelManager.parseScript(scriptText);
            window.UIManager.closeModal();

            if (dialogues.length > 0) {
                await window.VisualNovelManager.play(dialogues);
            } else {
                await window.UIManager.showText(scriptText, 5000);
            }

            if (effectPart) {
                await new Promise(r => setTimeout(r, 300));
                const results = EffectSystem.applyFromNarrative(effectPart);
                const text = EffectSystem.formatResults(results);
                if (text) await window.UIManager.showText(text, 4000);
            }
            if (sceneUpdatePart) {
                await new Promise(r => setTimeout(r, 300));
                const update = StoryManager.parseSceneUpdate(sceneUpdatePart);
                if (update) await StoryManager.applySceneUpdate(update);
            }
            if (digestSummary) {
                InteractionDigestManager.add({
                    targetType: 'item',
                    target: item.name,
                    source: 'sceneItem',
                    summary: digestSummary,
                    chapterId,
                });
            }

            InteractionHistoryManager.add({
                type: 'sceneItem',
                target: item.name,
                targetMeta: { status: item.status, mode: modeLabel },
                scene: scene.name,
                playerInput: `${modeLabel}${input ? '：' + input : ''}`,
                script: scriptText,
                effect: effectPart || null,
                summary: digestSummary,
            });

            await MusicManager.clearOverrideMusic();
            if (window.SaveManager) window.SaveManager.save();

            // ★ 交互结束 → 回到左右布局并保留选中
            this.openBrowser(true);
        },

        // ---------- AI 生成遭遇实体（原逻辑保留）----------
        openEncounterGenerate() {
            const scene = window.LocationModalManager.currentLocation;
            if (!scene) { alert('请先进入场景'); return; }

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚔️ AI 生成遭遇实体</div>
                <div style="text-align:center;padding:5px 0 18px;color:#aaa;font-size:13px;line-height:1.7;">
                    AI 会根据当前场景、剧情和玩家数据，<br>
                    生成一个符合世界观的敌人。
                </div>

                <div style="margin-bottom:12px;padding:10px;background:rgba(216,74,74,.1);
                     border:1px solid rgba(216,74,74,.25);border-radius:8px;font-size:12px;
                     color:#bbb;line-height:1.6;">
                    <div style="color:#ffb8b8;margin-bottom:4px;">当前场景</div>
                    📍 ${scene.name}
                    ${scene.description ? `<div style="color:#888;margin-top:4px;">${scene.description.substring(0, 80)}...</div>` : ''}
                </div>

                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                        想要什么样的敌人？（可选）
                    </div>
                    <textarea class="cinemaworld-textarea" id="cw-encounter-guide"
                        placeholder="例如：&#10;- 一个落单的强盗&#10;- 森林里的野兽&#10;- 追随玩家而来的刺客&#10;（留空则由 AI 根据场景自由生成）"
                        style="min-height:80px;"></textarea>
                </div>

                <div id="cw-encounter-result" style="display:none;margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                        AI 生成结果（可编辑）：
                    </div>
                    <textarea class="cinemaworld-textarea" id="cw-encounter-text"
                        style="min-height:260px;font-family:monospace;font-size:12px;"></textarea>
                    <div style="font-size:11px;color:#666;margin-top:6px;line-height:1.5;">
                        💡 格式：<br>
                        - 【名字|图标】：描述，[类型:遭遇|HP:X/Y|攻击:X|防御:X|敏捷:X|技能:X|掉落:X]
                    </div>
                </div>

                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" id="cw-encounter-gen-btn"
                        onclick="SceneItemBrowserManager.generateEncounter()">
                        🤖 AI 生成
                    </button>
                    <button class="cinemaworld-button primary" id="cw-encounter-confirm-btn"
                        onclick="SceneItemBrowserManager.confirmEncounter()" style="display:none;">
                        ✅ 创建
                    </button>
                    <button class="cinemaworld-button" onclick="SceneItemBrowserManager.openCreateMenu()">← 返回</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;
        },

        async generateEncounter() {
            const scene = window.LocationModalManager.currentLocation;
            if (!scene) return;

            const guide = document.getElementById('cw-encounter-guide').value.trim();
            const btn = document.getElementById('cw-encounter-gen-btn');
            btn.disabled = true;
            btn.innerHTML = '⏳ 生成中...';

            try {
                const worldCtx = StoryManager.buildContext(null, {
                    parentStory: false,
                    mainChars: true,
                    scene: true,
                    interactionDigests: true,
                    volumes: false,
                    chapters: false,
                    pendingEvents: false,
                });
                const playerBlock = PlayerStateManager.formatForPrompt();
                const envLine = WorldManager.getEnvDataText(scene);

                const existingItems = (scene.sceneItems || []).map(i => i.name).join('、') || '（无）';

                const playerAttrs = Object.entries(PlayerStateManager.player.attributes || {})
                    .map(([k, v]) => `${k}: ${typeof v === 'object' ? v.value : v}`)
                    .join('、') || '（无）';

                const prompt = `你正在为视觉小说 RPG 游戏生成一个"遭遇实体"（敌人）。

【世界背景】
${worldCtx}

【当前场景】
名称：${scene.name}
${scene.description ? `描述：${scene.description}` : ''}
${scene.environment ? `环境：${scene.environment}` : ''}
★ 当前环境数据：${envLine}
场景已有实体：${existingItems}

${playerBlock}

【玩家属性参考】
${playerAttrs}

【生成要求】
${guide || '根据当前场景和剧情，生成一个合理的敌人。'}

【输出格式】（严格遵守）
- 【名字|图标】：描述，[类型:遭遇|HP:当前/最大|攻击:X|防御:X|敏捷:X|技能:X|掉落:X]

字段说明：
1. 名字：敌人名（符合世界观）
2. 图标：一个 emoji（如 👹、🐺、🗡️、💀、👤）
3. 描述：敌人的外观、气质、当前状态
4. 类型：必须写"遭遇"（这是系统识别标记）
5. HP：当前/最大。根据玩家实力调整，普通敌人 50-150
6. 攻击：普通攻击力。参考玩家属性，普通敌人 10-25
7. 防御：减伤。普通敌人 5-15
8. 敏捷：影响先攻/闪避。普通敌人 5-20
9. 技能：敌人的特殊技能，用顿号分隔，可带说明
   例如：重劈（每3回合，伤害×1.5）、怒吼、回血
10. 掉落：击败后玩家获得的物品，顿号分隔，可带 ×N
    例如：金币×50、生锈的大刀×1

【重要】
1. 数值要合理——敌人不能强到玩家必输，也不能弱到毫无挑战
2. 描述要符合当前场景的氛围（如果在森林里，可以是野兽；在城里，可以是刺客）
3. 技能 1-3 个即可，不要太复杂
4. 掉落 0-3 件，符合敌人身份

【示例】
- 【落单的强盗|🗡️】：一个衣衫褴褛的强盗，手里握着一把生锈的短刀，眼神警惕，[类型:遭遇|HP:80/80|攻击:15|防御:6|敏捷:12|技能:偷袭（首回合伤害×1.5）、求饶|掉落:铜币×20、生锈的短刀×1]

请生成（只输出一行）：
`;

                const result = await window.generateFunctionalReply(prompt, 'encounter-generation');
                btn.disabled = false;
                btn.innerHTML = '🤖 AI 生成';

                if (!result) {
                    window.UIManager.showText('❌ 生成失败', 2000);
                    return;
                }

                let clean = result.trim()
                    .replace(/^```[\s\S]*?\n/, '')
                    .replace(/\n```\s*$/, '')
                    .trim();

                document.getElementById('cw-encounter-text').value = clean;
                document.getElementById('cw-encounter-result').style.display = 'block';
                document.getElementById('cw-encounter-confirm-btn').style.display = 'inline-block';

            } catch (e) {
                console.error('[Encounter] 生成失败:', e);
                btn.disabled = false;
                btn.innerHTML = '🤖 AI 生成';
                window.UIManager.showText(`❌ 生成失败：${e.message}`, 3000);
            }
        },

        confirmEncounter() {
            const scene = window.LocationModalManager.currentLocation;
            if (!scene) return;

            const text = document.getElementById('cw-encounter-text').value.trim();
            if (!text) { alert('内容不能为空'); return; }

            const lineMatch = text.match(/-\s*(【.+】\s*[：:][\s\S]*?)(?=\n-|\n*$)/);
            const line = lineMatch ? lineMatch[1].trim() : text.trim();

            const item = WorldManager.parseItemLine(line);
            if (!item || !item.name) {
                alert('解析失败：未识别出实体名字。请检查格式是否为\n- 【名字|图标】：描述，[类型:遭遇|HP:X/Y|...]');
                return;
            }

            item.fields = item.fields || {};
            if (!/遭遇/.test(item.fields['类型'] || '')) {
                item.fields['类型'] = '遭遇';
            }

            if (!item.fields['HP']) item.fields['HP'] = '100/100';
            if (!item.fields['攻击']) item.fields['攻击'] = '10';
            if (!item.fields['防御']) item.fields['防御'] = '5';
            if (!item.fields['敏捷']) item.fields['敏捷'] = '10';

            item.type = 'entity';
            item.count = 1;

            scene.sceneItems = scene.sceneItems || [];
            if (scene.sceneItems.some(i => i.name === item.name)) {
                if (!confirm(`场景里已经有叫「${item.name}」的实体了，继续创建吗？`)) return;
            }
            scene.sceneItems.push(item);

            if (typeof window.SceneEditorManager !== 'undefined') {
                window.SceneEditorManager._rebuildRaw(scene);
            }

            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText(`已创建遭遇实体【${item.name}】`, 1500);
            this._selectedIndex = scene.sceneItems.length - 1;
            this.openBrowser(true);
        },

        // ---------- 保存新实体（普通）----------
        saveNewEntity(type) {
            const scene = window.LocationModalManager.currentLocation;
            if (!scene) { alert('请先进入场景'); return; }

            const icon = document.getElementById('cw-ce-icon').value.trim() || '📦';
            const name = document.getElementById('cw-ce-name').value.trim();
            const desc = document.getElementById('cw-ce-desc').value.trim();
            const extraRaw = document.getElementById('cw-ce-extra').value.trim();

            if (!name) { alert('名字不能为空'); return; }

            const fields = { '类型': '实体' };

            if (extraRaw) {
                for (const line of extraRaw.split('\n')) {
                    const clean = line.trim();
                    if (!clean) continue;
                    const kv = clean.match(/^(.+?)[:：]\s*(.+)$/);
                    if (kv) fields[kv[1].trim()] = kv[2].trim();
                }
            }

            const newItem = {
                name, icon,
                description: desc,
                status: '', effect: '',
                fields, interactions: [],
                type: 'entity', count: 1,
            };

            scene.sceneItems = scene.sceneItems || [];
            if (scene.sceneItems.some(i => i.name === name)) {
                if (!confirm(`场景里已经有叫「${name}」的实体了，继续创建吗？`)) return;
            }
            scene.sceneItems.push(newItem);

            if (typeof window.SceneEditorManager !== 'undefined') {
                window.SceneEditorManager._rebuildRaw(scene);
            }

            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText(`已创建实体【${name}】`, 1500);
            this._selectedIndex = scene.sceneItems.length - 1;
            this.openBrowser(true);
        },

        // ---------- 删除 ----------
        confirmDelete(index) {
            const scene = window.LocationModalManager.currentLocation;
            if (!scene || !scene.sceneItems?.[index]) return;
            const item = scene.sceneItems[index];
            if (!confirm(`确定删除【${item.name}】吗？`)) return;

            scene.sceneItems.splice(index, 1);

            if (typeof window.SceneEditorManager !== 'undefined') {
                window.SceneEditorManager._rebuildRaw(scene);
            }

            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText(`已删除【${item.name}】`, 1500);

            // 修正选中索引
            if (this._selectedIndex >= scene.sceneItems.length) {
                this._selectedIndex = Math.max(0, scene.sceneItems.length - 1);
            }
            this.openBrowser(true);
        },

        // ---------- 创建表单 ----------
        openCreateForm(type) {
            if (type === 'encounter') {
                return this.openEncounterGenerate();
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📦 创建场景实体</div>

                <div style="display:grid;gap:12px;">
                    <div style="display:grid;grid-template-columns:70px 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">图标</div>
                            <input type="text" id="cw-ce-icon" value="📦"
                                style="width:100%;box-sizing:border-box;padding:10px;text-align:center;
                                    background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                    border-radius:8px;color:#fff;font-size:22px;">
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">名字</div>
                            <input type="text" id="cw-ce-name" value="测试实体"
                                style="width:100%;box-sizing:border-box;padding:10px;
                                    background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                    border-radius:8px;color:#fff;font-size:14px;">
                        </div>
                    </div>

                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">描述</div>
                        <textarea id="cw-ce-desc"
                            style="width:100%;box-sizing:border-box;padding:10px;
                                background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                border-radius:8px;color:#fff;font-size:13px;
                                min-height:70px;resize:vertical;">一件普通的物品。</textarea>
                    </div>

                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">
                            其他字段（可选，每行一个 键:值）
                        </div>
                        <textarea id="cw-ce-extra"
                            placeholder="类型: 经营&#10材质: 木头&#10;年代: 2024"
                            style="width:100%;box-sizing:border-box;padding:10px;
                                background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);
                                border-radius:8px;color:#fff;font-size:13px;
                                min-height:60px;resize:vertical;font-family:monospace;"></textarea>
                    </div>
                </div>

                <div style="text-align:center;margin-top:18px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary"
                        onclick="SceneItemBrowserManager.saveNewEntity('normal')">
                        ✅ 创建
                    </button>
                    <button class="cinemaworld-button" onclick="SceneItemBrowserManager.openCreateMenu()">← 返回</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;
        },

        // ---------- 创建类型选择 ----------
        openCreateMenu() {
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">➕ 创建实体</div>
                <div style="text-align:center;padding:10px 0 20px;color:#aaa;font-size:13px;line-height:1.7;">
                    选择要创建的实体类型
                </div>
                <div style="display:grid;gap:12px;">

                    <div class="cw-create-entity-card"
                        onclick="SceneItemBrowserManager.openCreateForm('normal')"
                        style="background:linear-gradient(135deg,rgba(50,45,35,.6),rgba(35,30,25,.85));
                             border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:20px;
                             cursor:pointer;transition:all .2s ease;">
                        <div style="display:flex;align-items:center;gap:14px;">
                            <div style="font-size:36px;flex-shrink:0;">📦</div>
                            <div style="flex:1;">
                                <div style="font-size:16px;font-weight:bold;color:#e8d8a8;margin-bottom:4px;">
                                    普通场景实体
                                </div>
                                <div style="font-size:12px;color:#aaa;line-height:1.5;">
                                    可交互的物品、建筑、植物、家具、机关等。
                                    手动填写。
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="cw-create-entity-card"
                        onclick="SceneItemBrowserManager.openEncounterGenerate()"
                        style="background:linear-gradient(135deg,rgba(70,30,30,.65),rgba(45,20,20,.9));
                             border:1px solid rgba(216,74,74,.35);border-radius:12px;padding:20px;
                             cursor:pointer;transition:all .2s ease;">
                        <div style="display:flex;align-items:center;gap:14px;">
                            <div style="font-size:36px;flex-shrink:0;">⚔️</div>
                            <div style="flex:1;">
                                <div style="font-size:16px;font-weight:bold;color:#ffb8b8;margin-bottom:4px;">
                                    遭遇实体（AI 生成）
                                </div>
                                <div style="font-size:12px;color:#aaa;line-height:1.5;">
                                    根据当前场景、剧情、玩家数据，AI 生成一个符合世界观的敌人。
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
                <div style="text-align:center;margin-top:20px;">
                    <button class="cinemaworld-button" onclick="SceneItemBrowserManager.openBrowser(true)">← 返回</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;

            if (!document.getElementById('cw-create-entity-styles')) {
                const s = document.createElement('style');
                s.id = 'cw-create-entity-styles';
                s.textContent = `
                    .cw-create-entity-card:hover {
                        transform: translateY(-2px);
                        filter: brightness(1.15);
                        box-shadow: 0 6px 20px rgba(0,0,0,.5);
                    }
                `;
                document.head.appendChild(s);
            }
        },

        // ---------- 工具 ----------
        _escapeAttr(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, "\\'")
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
    };
    
        // ==================== 遭遇管理器（战斗包生成） ====================
        const EncounterManager = {
            isGenerating: false,
    
            // ---------- 判断一个场景实体是否是遭遇实体 ----------
            isEncounter(item) {
                if (!item?.fields) return false;
                const t = String(item.fields['类型'] || '').trim();
                return /遭遇|encounter|enemy|敌人|敌对/i.test(t);
            },
    
            // ---------- 生成战斗包 ----------
            async generateBattlePackage(enemyItem) {
                if (this.isGenerating) {
                    console.log('[EncounterManager] 正在生成中，请稍后');
                    return null;
                }
                this.isGenerating = true;
    
                try {
                    const scene = window.LocationModalManager.currentLocation;
                    const player = PlayerStateManager.player;
    
                    const worldCtx = StoryManager.buildContext(null, {
                        parentStory: false,
                        mainChars: false,
                        scene: false,
                        interactionDigests: true,
                        volumes: true,
                        chapters: true,
                        pendingEvents: false,
                    });
    
                    const playerBlock = PlayerStateManager.formatForPrompt();
                    const sceneCtx = InventoryManager.buildSceneContext(scene);
                    const envLine = WorldManager.getEnvDataText(scene);
    
                    const enemyBlock = this._buildEnemyBlock(enemyItem);
    
                    const existingRules = window.BattleRuleManager.getCurrent();
                    const rulesBlock = existingRules
                        ? `【已有战斗规则】（战斗规则已由游戏规则统一定义，本次不需要生成）\n${existingRules.raw || '(默认规则)'}`
                        : `【战斗规则】\n（暂无战斗规则，将使用系统默认规则）`;
    
                    const equippedItems = (player.equipment?.slots || []).filter(Boolean);
                    const equipBlock = equippedItems.length > 0
                        ? equippedItems.map(item => {
                            const f = item.fields || {};
                            const fieldLines = Object.entries(f)
                                .filter(([k]) => !k.startsWith('_pos'))
                                .filter(([k]) => !['图标', 'icon', '货币种类'].includes(k))
                                .map(([k, v]) => `${k}:${v}`)
                                .join(' | ');
                            return `- ${item.icon || '⚔️'} ${item.name}${item.description ? `（${item.description}）` : ''}${fieldLines ? `\n  [${fieldLines}]` : ''}`;
                        }).join('\n')
                        : '（玩家没有装备任何物品）';
    
                    // ★ 动态收集玩家属性
                    const playerAttrs = Object.keys(player.attributes || {});
                    const playerBars = (player.statusBars || []).map(b => b.key);
                    const playerDerived = Object.keys(player.derivedStats?.computed || {});
                    const allKnownAttrs = [...new Set([
                        ...playerAttrs,
                        ...playerBars,
                        ...playerDerived,
                    ])];

                    const attrHint = `
【玩家可用属性名】
- 基础属性：${playerAttrs.join('、') || '（无）'}
- 数值条：${playerBars.join('、') || '（无）'}
- 派生属性：${playerDerived.join('、') || '（无）'}
（以上是系统识别到的所有属性，战斗公式里可以引用它们）

【重要·敌人属性设计】
你不必局限于 HP/攻击/防御/敏捷。
你可以为敌人定义任何符合它本质的属性字段，系统会自动把它们传给战斗公式。

建议根据敌人类型选择：
- 战士类：攻击、防御、敏捷、力量、体质
- 法师/幽灵类：灵力、抗性、意志、恐惧、精神
- 社交/权谋类：魅力、威严、意志、洞察、贿赂
- 野兽类：敏捷、撕咬、皮糙、兽性
- 机械类：装甲、过载、火力、稳定

【示例·传统战士】
- 【山贼头目|🗡️】：...，[类型:遭遇|HP:120/120|攻击:18|防御:12|敏捷:8|意志:15|技能:重劈|掉落:金币×50]

【示例·精神系敌人】
- 【低语者|👁️】：一个不可名状的存在，[类型:遭遇|HP:80/80|攻击:5|防御:3|敏捷:15|恐惧:25|理智伤害:10|技能:精神冲击|掉落:破碎的记忆×1]

【示例·社交系敌人】
- 【傲慢的贵族|🎩】：...，[类型:遭遇|HP:60/60|攻击:8|防御:15|敏捷:12|魅力:30|社交值:50|技能:嘲讽、贿赂|掉落:金币×100]
`;

                const prompt = `你正在为视觉小说 RPG 游戏生成一场完整的战斗。

【世界背景】
${worldCtx}

【当前场景】
${sceneCtx}

★ 环境数据：${envLine}

${playerBlock}

${attrHint}

【敌人数据】
${enemyBlock}

${rulesBlock}

【战斗规则参考】
- 伤害公式：${(window.BattleRuleManager.getCurrent()?.damageFormula) || '{攻击} - {防御}'}
- 命中判定：${(window.BattleRuleManager.getCurrent()?.hitFormula) || '（无，必中）'}
- 先攻：${(window.BattleRuleManager.getCurrent()?.initiativeFormula) || 'd20 + {敏捷}'}
- 属性映射：${JSON.stringify(window.BattleRuleManager.getCurrent()?.attrMap || {})}

【任务】
生成一场完整战斗包：战前剧情、战斗行动、战后剧情、战斗奖励、场景更新、胜利摘要。

【输出格式】（严格遵守，标签独占一行，标签内不能含 | 符号）

【战前剧情】
【旁白】: 环境描写或战斗开场
【敌人名|显示|中|性别|状态】: 敌人的台词
【玩家|显示|中|性别|状态】: 玩家的台词
（3-6 行。状态可以是心情或状态列表中的内容）

【玩家当前装备】
${equipBlock}

★ 主动装备（武器/法器/召唤物）→ 额外生成 1 个行动，字段加"来源:装备名"
★ 被动装备（护甲/饰品/背包）→ 不生成行动

【战斗行动】
- 【行动名|图标】：描述，[类型:技能|冷却:X|次数:X|公式:...|效果:...]

（3-6 个）

公式写法：
- 可用玩家任意属性、敌人属性 {敌人.防御}
- 支持骰子/四则运算/括号：2d6 + {攻击} * 1.5 - {敌人.防御}
- 支持 max/min：max(1, {攻击} - {防御})

效果(可选，; 分隔)：自身攻击+30%;持续:2回合 / 敌人防御-50%;持续:3回合
类型(可选)：attack / skill / heal / defend / flee

行动设计（冷却/次数/倍率三选二）：
- 大招：高倍率 + 高冷却 + 不限次
- 小技能：低倍率 + 低冷却 + 不限次
- 装备技能：高倍率 + 无冷却 + 限次
- 角色自带技能 → 冷却型；装备带来的行动 → 次数型
- 攻击倍率必须 >= 1.0（低于 1.0 不如普攻）
- 治疗公式：{体质/智力/感知} * N，小治疗 N=1.5~2.5，大治疗 N=3.0~5.0

【战后剧情·胜利】
【旁白】: 敌人倒下的描写
【玩家|显示|中|性别】: 胜利的台词
（2-5 行）

【战后剧情·失败】
【旁白】: 玩家倒下的描写
【敌人名|显示|中|性别】: 嘲讽或收尾
（2-5 行）

【战斗奖励】（仅胜利时应用，无则写"无"）
数值行：金币 +X / 经验 +X / 声望 -X
状态行：获得状态 轻伤 / 移除状态 中毒
物品行：物品:
- 【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|卖价:X|其他]
- 【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|卖价:X|属性:X|属性:Y]

状态效果(可选，| 分隔)：攻击-20% / 防御+30% / 每回合:生命-5 / 持续:3回合 / 跳过回合
示例：获得状态 中毒（生命-5|持续3回合）

【场景更新】（可选，战斗改变了场景才写）
移除实体: ${enemyItem.name}
新增实体: - 【山贼的尸首|💀】：倒在血泊中，[类型:实体|状态:已死亡]

【胜利摘要】
（2-3 句。玩家如何获胜、获得什么、有什么后果。仅胜利时录入）

【音乐提示】
战前音乐: (曲名，无则写"无")
战中音乐: (曲名，无则写"无")
战后音乐: (曲名，无则写"无")

请开始生成：
`;
    
                    console.log('[EncounterManager] 开始生成战斗包...');
                    const raw = await window.generateFunctionalReply(prompt, 'battle-package');
                    if (!raw) {
                        console.error('[EncounterManager] AI 返回为空');
                        return null;
                    }
    
                    const sections = window.BattlePackageSlicer.slice(raw);
                    console.log('[EncounterManager] 切片结果:', Object.keys(sections));
    
                    const enemy = window.EnemyBuilder.fromSceneItem(enemyItem);
                    if (!enemy) {
                        console.error('[EncounterManager] 敌人构建失败');
                        return null;
                    }
    
                    const actionPool = this.parseActions(sections['战斗行动'] || '');
    
                    let rules = window.BattleRuleManager.getCurrent() || { ...window.BattleRuleManager.DEFAULT_RULES };
    
                    return {
                        raw,
                        sections,
                        enemy,
                        actionPool,
                        rules,
                        enemyItemName: enemyItem.name,
                    };
    
                } catch (e) {
                    console.error('[EncounterManager] 生成失败:', e);
                    return null;
                } finally {
                    this.isGenerating = false;
                }
            },
    
            // ---------- 构建敌人数据块 ----------
            _buildEnemyBlock(item) {
                const f = item.fields || {};
                const lines = [];
                lines.push(`名称：${item.name}`);
                lines.push(`图标：${item.icon || '👹'}`);
                if (item.description) lines.push(`描述：${item.description}`);
                for (const [k, v] of Object.entries(f)) {
                    if (k.startsWith('_pos')) continue;
                    if (['类型', '图标', 'icon'].includes(k)) continue;
                    lines.push(`${k}：${v}`);
                }
                return lines.join('\n');
            },
    
            async startEncounter(sceneItemIndex) {
                const scene = window.LocationModalManager.currentLocation;
                if (!scene) return;
                const item = scene.sceneItems?.[sceneItemIndex];
                if (!item) return;
    
                if (this.isGenerating) {
                    await window.UIManager.showText('正在生成战斗...', 1000);
                    return;
                }
    
                const cached = this._getCachedPackage(item.name);
                if (cached) {
                    window.UIManager.closeModal();
                    await this._openPreviewModal(item, cached, true);
                    return;
                }
    
                window.UIManager.closeModal();
    
                if (window.BattleRuleManager.needsGeneration()) {
                    await window.UIManager.showText('首次战斗，正在生成战斗规则...', 1500);
                }
    
                await window.UIManager.showText('正在生成战斗...', 1000);
    
                const pkg = await this.generateBattlePackage(item);
                if (!pkg) {
                    await window.UIManager.showText('❌ 战斗生成失败', 2000);
                    return;
                }
    
                await this._openPreviewModal(item, pkg, false);
            },
    
            // ★ 打开战斗包预览（可编辑）
            async _openPreviewModal(item, pkg, fromCache) {
                const modal = document.getElementById('cinemaworld-modal');
                const sections = pkg.sections;
    
                const rawText = pkg.raw || this._buildRawFromSections(sections);
    
                const tags = Object.keys(sections).filter(k => k !== '__music');
                const tagBadges = tags.map(t =>
                    `<span class="cw-battle-preview-badge">${t}</span>`
                ).join('');
    
                const music = sections.__music || {};
                const musicHTML = [
                    music.战前音乐 ? `战前: ${music.战前音乐}` : '',
                    music.战中音乐 ? `战中: ${music.战中音乐}` : '',
                    music.战后音乐 ? `战后: ${music.战后音乐}` : '',
                ].filter(Boolean).join(' / ');
    
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">⚔️ 战斗预览 · ${item.name}</div>
    
                    <div style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.7;">
                        ${fromCache
                            ? '📦 已使用缓存内容。修改会覆盖缓存。'
                            : '🆕 AI 刚生成的内容。确认后才会开始战斗。'}
                    </div>
    
                    <div class="cw-battle-preview-badges">
                        ${tagBadges}
                    </div>
    
                    ${musicHTML ? `
                        <div class="cw-battle-preview-music">
                            🎵 ${musicHTML}
                        </div>
                    ` : ''}
    
                    <div style="margin-bottom:12px;">
                        <div style="font-size:12px;color:#aaa;margin-bottom:5px;">
                            完整内容（可编辑）：
                        </div>
                        <textarea class="cinemaworld-textarea" id="cw-battle-preview-input"
                            style="min-height:400px;font-family:monospace;font-size:12px;">${rawText.replace(/</g, '&lt;')}</textarea>
                    </div>
    
                    <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                        <button class="cinemaworld-button primary cw-battle-preview-btn"
                            data-action="confirm">
                            ⚔️ 开始战斗
                        </button>
                        <button class="cinemaworld-button cw-battle-preview-btn"
                            data-action="regenerate"
                            ${fromCache ? 'style="color:#ffcf80;border-color:rgba(255,207,128,.4);"' : ''}>
                            🔄 重新生成
                        </button>
                        <button class="cinemaworld-button cw-battle-preview-btn"
                            data-action="clear">
                            🗑️ 清空缓存
                        </button>
                        <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                    </div>`;
    
                modal.querySelectorAll('.cw-battle-preview-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const action = btn.dataset.action;
                        if (action === 'confirm') {
                            this._confirmPreview(item.name);
                        } else if (action === 'regenerate') {
                            this._regenerateFromPreview(item.name);
                        } else if (action === 'clear') {
                            this._clearCache(item.name);
                        }
                    });
                });
    
                modal.className = 'active';
            },
    
            // ★ 确认预览 → 解析 → 保存缓存 → 开始战斗
            async _confirmPreview(enemyName) {
                const textarea = document.getElementById('cw-battle-preview-input');
                if (!textarea) return;
    
                const editedText = textarea.value.trim();
                if (!editedText) { alert('内容不能为空'); return; }
    
                const scene = window.LocationModalManager.currentLocation;
                const item = scene?.sceneItems?.find(i => i.name === enemyName);
                if (!item) { alert('找不到敌人实体'); return; }
    
                const sections = window.BattlePackageSlicer.slice(editedText);
                const enemy = window.EnemyBuilder.fromSceneItem(item);
                if (!enemy) { alert('敌人解析失败'); return; }
    
                const actionPool = this.parseActions(sections['战斗行动'] || '');
    
                let rules = window.BattleRuleManager.getCurrent();
                if (!rules) {
                    if (sections['战斗规则'] && sections['战斗规则'].trim()) {
                        rules = window.BattleRuleManager.parse(sections['战斗规则']);
                    } else {
                        rules = { ...window.BattleRuleManager.DEFAULT_RULES };
                    }
                    window.BattleRuleManager.save(rules);
                }
    
                const pkg = {
                    raw: editedText,
                    sections,
                    enemy,
                    actionPool,
                    rules,
                    enemyItemName: enemyName,
                    cachedAt: Date.now(),
                };
    
                this._setCachedPackage(enemyName, pkg);
    
                window.UIManager.closeModal();
                await this._launchBattle(item, pkg);
            },
    
            // ★ 实际启动战斗
            async _launchBattle(item, pkg) {
                if (pkg.sections.__music?.战前音乐) {
                    await MusicManager.setOverrideMusic(pkg.sections.__music.战前音乐);
                }
                if (pkg.sections['战前剧情']) {
                    // ★ 改用 window.VisualNovelManager
                    const dialogues = window.VisualNovelManager.parseScript(pkg.sections['战前剧情']);
                    if (dialogues.length > 0) {
                        await window.VisualNovelManager.play(dialogues);
                    }
                }
                if (pkg.sections.__music?.战中音乐) {
                    await MusicManager.setOverrideMusic(pkg.sections.__music.战中音乐);
                }
            
                const combat = window.BattleManager.startBattle(pkg, item.name);
                window.BattleUIManager.open(combat);
            
                if (window.SaveManager) window.SaveManager.save();
            },
    
            // ★ 获取缓存的战斗包
            _getCachedPackage(enemyName) {
                const store = CinemaWorld.worldState.combat?.battlePackages;
                if (!store) return null;
                const cached = store[enemyName];
                if (!cached) return null;
    
                if (!cached.raw || !cached.sections) {
                    console.warn(`[Encounter] 缓存不完整: ${enemyName}`);
                    return null;
                }
    
                return cached;
            },
    
            // ★ 写入缓存
            _setCachedPackage(enemyName, pkg) {
                if (!CinemaWorld.worldState.combat) {
                    CinemaWorld.worldState.combat = { activeCombat: null, battleRules: null, history: [] };
                }
                if (!CinemaWorld.worldState.combat.battlePackages) {
                    CinemaWorld.worldState.combat.battlePackages = {};
                }
                CinemaWorld.worldState.combat.battlePackages[enemyName] = {
                    raw: pkg.raw,
                    sections: pkg.sections,
                    enemy: pkg.enemy,
                    actionPool: pkg.actionPool,
                    rules: pkg.rules,
                    enemyItemName: enemyName,
                    cachedAt: Date.now(),
                };
                if (window.SaveManager) window.SaveManager.save();
            },
    
            // ★ 清除单个缓存
            _clearCache(enemyName) {
                const store = CinemaWorld.worldState.combat?.battlePackages;
                if (store && store[enemyName]) {
                    delete store[enemyName];
                    if (window.SaveManager) window.SaveManager.save();
                    window.UIManager.showText(`已清空【${enemyName}】的战斗缓存`, 1500);
                }
            },
    
            // ★ 重新生成
            async _regenerateFromPreview(enemyName) {
                const scene = window.LocationModalManager.currentLocation;
                const item = scene?.sceneItems?.find(i => i.name === enemyName);
                if (!item) return;
    
                this._clearCache(enemyName);
    
                await window.UIManager.showText('正在重新生成...', 1000);
                const pkg = await this.generateBattlePackage(item);
                if (!pkg) {
                    await window.UIManager.showText('❌ 生成失败', 2000);
                    return;
                }
    
                await this._openPreviewModal(item, pkg, false);
            },
    
            // ★ 从 sections 重建 raw
            _buildRawFromSections(sections) {
                const parts = [];
                for (const [tag, content] of Object.entries(sections)) {
                    if (tag === '__music') continue;
                    parts.push(`【${tag}】\n${content}`);
                }
                const music = sections.__music || {};
                if (music.战前音乐 || music.战中音乐 || music.战后音乐) {
                    parts.push(`【音乐提示】\n战前音乐: ${music.战前音乐 || '无'}\n战中音乐: ${music.战中音乐 || '无'}\n战后音乐: ${music.战后音乐 || '无'}`);
                }
                return parts.join('\n\n');
            },
    
            // ---------- 解析战斗行动 ----------
            parseActions(text) {
                if (!text) return this._defaultActions();
                const actions = [];

                for (let raw of text.split('\n')) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const content = line.substring(1).trim();

                    const nameMatch = content.match(/^【(.+?)】/);
                    if (!nameMatch) continue;
                    const nameParts = nameMatch[1].split('|').map(s => s.trim());
                    const name = nameParts[0] || '';
                    if (!name) continue;

                    const action = {
                        id: `action_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                        name,
                        icon: '⚔️',
                        type: 'attack',
                        description: '',
                        cost: {},
                        cooldown: 0,
                        usesLeft: null,
                        formula: null,
                        hint: '',
                        effects: [],   // ★ 附加效果
                    };

                    if (nameParts[1]) {
                        const emoji = nameParts[1].match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
                        if (emoji) action.icon = emoji[0];
                    }

                    const afterName = content.substring(nameMatch[0].length).replace(/^[：:]\s*/, '');
                    const bracketMatch = afterName.match(/^([\s\S]*?)\s*[\[【]([^\]】]+)[\]】]\s*$/);
                    if (bracketMatch) {
                        action.description = bracketMatch[1].trim();
                        const fields = bracketMatch[2].split('|').map(s => s.trim());
                        for (const fld of fields) {
                            const kv = fld.match(/^(.+?)[:：]\s*(.+)$/);
                            if (!kv) continue;
                            const k = kv[1].trim();
                            const v = kv[2].trim();

                            if (k === '类型') action.type = this._normalizeType(v);
                            else if (k === '冷却') {
                                const n = parseInt(v);
                                if (!isNaN(n)) action.cooldown = n;
                            }
                            else if (k === '次数') {
                                const n = parseInt(v);
                                if (!isNaN(n)) action.usesLeft = n;
                            }
                            else if (k === '公式') action.formula = v;
                            else if (k === '消耗') {
                                // 消耗:魔力:15 或 消耗:魔力15
                                const cm = v.match(/^(.+?)[:：]?\s*(\d+)$/);
                                if (cm) action.cost[cm[1].trim()] = parseInt(cm[2]);
                            }
                            else if (k === '效果') {
                                // 效果:敌人攻击-50%|持续:1回合
                                action.effects = this._parseEffects(v);
                            }
                            else if (k === '来源') {
                                action.sourceEquipment = v;
                            }
                        }
                    } else {
                        action.description = afterName.trim();
                    }

                    if (action.type === 'attack') {
                        if (/普通攻击|攻击/.test(name)) action.type = 'attack';
                        else if (/治疗|回复|恢复|治愈/.test(name)) action.type = 'heal';
                        else if (/防御|格挡|闪避/.test(name)) action.type = 'defend';
                        else if (/逃跑|撤退|脱离/.test(name)) action.type = 'flee';
                        else if (/道具|物品/.test(name)) action.type = 'item';
                        else action.type = 'skill';
                    }

                    actions.push(action);
                }

                if (!actions.some(a => a.type === 'attack')) {
                    actions.unshift(this._basicAttack());
                }
                if (!actions.some(a => a.type === 'flee')) {
                    actions.push(this._fleeAction());
                }

                return actions;
            },

            // ★ 解析效果字符串
            _parseEffects(str) {
                const effects = [];
                const parts = String(str).split(/[;；]/).map(s => s.trim()).filter(Boolean);

                for (const part of parts) {
                    // 敌人攻击-50% 持续1回合
                    let m = part.match(/^敌人(.+?)([+\-])(\d+)(?:%|％)?(?:\s*持续\s*(\d+)\s*回合)?$/);
                    if (m) {
                        const attr = m[1].trim();
                        const sign = m[2] === '-' ? -1 : 1;
                        let val = parseFloat(m[3]);
                        if (part.includes('%') || part.includes('％')) val = val / 100;
                        else if (val >= 2) val = val / 100;
                        effects.push({
                            type: 'debuff_enemy',
                            name: `虚弱·${attr}`,
                            effect: { 属性: { [attr]: sign * val } },
                            duration: m[4] ? parseInt(m[4]) : 3,
                        });
                        continue;
                    }
                    // 自己获得状态 xxx
                    m = part.match(/^自身?(?:获得)?(.+?)(?:，|,|$)/);
                    if (m && /获得|buff|加/.test(part)) {
                        effects.push({
                            type: 'buff_self',
                            name: m[1].trim(),
                            duration: 3,
                        });
                    }
                }
                return effects;
            },
    
            _normalizeType(v) {
                const s = String(v).toLowerCase();
                if (/治疗|heal|恢复|回复|治愈/.test(s)) return 'heal';
                if (/攻击|attack/.test(s)) return 'attack';
                if (/防御|defend|格挡/.test(s)) return 'defend';
                if (/技能|skill/.test(s)) return 'skill';
                if (/道具|item/.test(s)) return 'item';
                if (/逃跑|flee|撤退/.test(s)) return 'flee';
                return 'skill';
            },
    
            _basicAttack() {
                return {
                    id: 'action_basic_attack',
                    name: '普通攻击',
                    icon: '⚔️',
                    type: 'attack',
                    description: '普通攻击',
                    cost: {},
                    cooldown: 0,
                    usesLeft: null,
                    formula: null,
                    hint: '',
                };
            },

            _defendAction() {
                return {
                    id: 'action_defend',
                    name: '防御',
                    icon: '🛡️',
                    type: 'defend',
                    description: '本回合减伤 50%',
                    cost: {},
                    cooldown: 0,
                    usesLeft: null,
                    formula: null,
                    hint: '',
                };
            },
    
            _fleeAction() {
                return {
                    id: 'action_flee',
                    name: '逃跑',
                    icon: '🏃',
                    type: 'flee',
                    description: '尝试脱离战斗',
                    cost: {},
                    cooldown: 0,
                    usesLeft: null,
                    formula: null,
                    hint: '',
                };
            },
    
            _defaultActions() {
                return [
                    this._basicAttack(),
                    _defendAction(),
                    this._fleeAction(),
                    
                ];
            },
        };
    
    // ==================== 背包管理器 ====================
    const InventoryManager = {
        selectedIndex: 0,
        SLOT_COUNT: 40,
        _equipSelectedIndex: 0,
        _selectedModeIndex: -1,

        addStyles() {
            // ★ CSS 已移至 style.css
            if (window.CinemaWorldCSS) window.CinemaWorldCSS.ensure();
        },

        open() {
            this.addStyles();
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active cw-inv-modal';
            modal.innerHTML = this.generateHTML();
        },

        generateHTML() {
            const inv = PlayerStateManager.player.inventory || [];
            const slotCount = this._getSlotCount();
        
            // ★ 空背包的处理保持不变
            if (inv.length === 0 && slotCount === 0) {
                // ... 原有空状态 HTML
            }
        
            // ★ 选中索引修正
            if (this.selectedIndex >= slotCount) this.selectedIndex = 0;
            if (this.selectedIndex < 0) this.selectedIndex = 0;
        
            const selected = inv[this.selectedIndex];
        
            // ★ 格子渲染：上限 = slotCount
            let gridHTML = '';
            for (let i = 0; i < slotCount; i++) {
                const item = inv[i];
                if (item) {
                    const isSelected = i === this.selectedIndex;
                    const icon = item.icon || '📦';
                    const count = item.count || 1;
                    const countClass = count >= 100 ? 'many' : '';
                    gridHTML += `
                        <div class="cw-inv-slot ${isSelected ? 'selected' : ''}"
                            onclick="InventoryManager.selectItem(${i})"
                            title="${this._escapeAttr(item.name)} ×${count}">
                            <div class="cw-inv-slot-icon">${icon}</div>
                            ${count > 1 ? `<div class="cw-inv-slot-count ${countClass}">${count > 999 ? '999+' : count}</div>` : ''}
                        </div>`;
                } else {
                    gridHTML += `<div class="cw-inv-slot empty"></div>`;
                }
            }
        
            return `
                <div class="cinemaworld-modal-title">🎒 背包 (${inv.length}/${slotCount})</div>
        
                ${this._renderSlotToolbar()}
        
                <div class="cw-inv-layout">
                    <div class="cw-inv-left">
                        <div class="cw-inv-grid">
                            ${gridHTML}
                        </div>
                    </div>
                    <div class="cw-inv-right">
                        ${this._renderDetailPanel(selected)}
                    </div>
                </div>
        
                <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="ShopManager.openList()">🏪 商店</button>
                    <button class="cinemaworld-button primary" onclick="InventoryManager.openEquipment()">⚔️ 装备栏</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
        },
        _renderSlotToolbar() {
            const slotCount = this._getSlotCount();
            return `
                <div style="display:flex;justify-content:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;"
                        onclick="InventoryManager.expandSlots(1)">
                        ➕ 扩容 +1
                    </button>
                    <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;"
                        onclick="InventoryManager.expandSlots(6)">
                        ➕ 扩容 +6
                    </button>
                    <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;"
                        onclick="InventoryManager.promptSetSlotCount()">
                        ✏️ 自定义
                    </button>
                    ${slotCount > 1 ? `
                        <button class="cinemaworld-button"
                            style="font-size:12px;padding:5px 12px;color:#d87d7d;"
                            onclick="InventoryManager.shrinkSlots(1)">
                            ➖ 缩容
                        </button>
                    ` : ''}
                </div>`;
        },
        // ---------- 格子数管理 ----------
        _getSlotCount() {
            const n = PlayerStateManager.player.inventorySlots;
            if (typeof n !== 'number' || n < 1) {
                PlayerStateManager.player.inventorySlots = 40;
                return 40;
            }
            return n;
        },

        _setSlotCount(n) {
            n = Math.max(1, Math.floor(n) || 1);
            PlayerStateManager.player.inventorySlots = n;
            if (this.selectedIndex >= n) {
                this.selectedIndex = Math.max(0, n - 1);
            }
            if (window.SaveManager) window.SaveManager.save();
            return n;
        },

        expandSlots(n = 1) {
            const cur = this._getSlotCount();
            this._setSlotCount(cur + n);
            this.open();
        },

        shrinkSlots(n = 1) {
            const cur = this._getSlotCount();
            const next = Math.max(1, cur - n);

            // ★ 缩容前检查：超出格子数的物品会被丢弃吗？
            const inv = PlayerStateManager.player.inventory || [];
            const overflow = inv.slice(next);
            if (overflow.length > 0) {
                const names = overflow.map(i => `${i.icon || '📦'} ${i.name}×${i.count || 1}`).join('\n');
                if (!confirm(`缩容后，以下 ${overflow.length} 件物品会超出格子数：\n\n${names}\n\n继续吗？`)) {
                    return;
                }
            }

            this._setSlotCount(next);
            this.open();
        },

        promptSetSlotCount() {
            const cur = this._getSlotCount();
            const input = prompt(`输入背包格子数（当前 ${cur}）：`, cur);
            if (input === null) return;
            const n = parseInt(input);
            if (isNaN(n) || n < 1) { alert('请输入 ≥ 1 的数字'); return; }

            // 缩容同样提醒
            if (n < cur) {
                const inv = PlayerStateManager.player.inventory || [];
                const overflow = inv.slice(n);
                if (overflow.length > 0) {
                    const names = overflow.map(i => `${i.icon || '📦'} ${i.name}×${i.count || 1}`).join('\n');
                    if (!confirm(`缩容后，以下 ${overflow.length} 件物品会超出格子数：\n\n${names}\n\n继续吗？`)) {
                        return;
                    }
                }
            }

            this._setSlotCount(n);
            this.open();
        },
        _renderDetailPanel(item) {
            if (!item) {
                return `
                    <div class="cw-inv-empty-detail">
                        <div class="cw-inv-empty-icon">👈</div>
                        <div class="cw-inv-empty-text">选择左侧格子查看物品</div>
                    </div>`;
            }

            const icon = item.icon || '📦';
            const count = item.count || 1;

            const descHTML = item.description
                ? `<div class="cw-inv-detail-section">
                    <div class="cw-inv-detail-section-label">📝 描述</div>
                    <div class="cw-inv-detail-desc">${item.description}</div>
                   </div>`
                : '';

            let fieldsHTML = '';
            if (item.fields && Object.keys(item.fields).length > 0) {
                const rows = [];
                for (const [k, v] of Object.entries(item.fields)) {
                    if (k.startsWith('_pos')) continue;
                    if (['图标', 'icon'].includes(k)) continue;
                    if (v === undefined || v === '' || v === null) continue;
                    const isBonus = /^[+\-]?\d+(\.\d+)?%?$/.test(String(v).trim());
                    rows.push(`
                        <div class="cw-inv-detail-attr">
                            <span class="key">${k}</span>
                            <span class="val ${isBonus ? 'bonus' : ''}">${v}</span>
                        </div>`);
                }
                if (rows.length > 0) {
                    fieldsHTML = `<div class="cw-inv-detail-section">
                        <div class="cw-inv-detail-section-label">📋 属性</div>
                        ${rows.join('')}
                    </div>`;
                }
            }

            let interactionsHTML = '';
            if (item.interactions && item.interactions.length > 0) {
                const chips = item.interactions.map(inter => `
                    <span class="cw-inv-chip">
                        ${inter.name}
                        ${inter.hint ? `<span class="hint">${inter.hint}</span>` : ''}
                    </span>`).join('');
                interactionsHTML = `<div class="cw-inv-detail-section">
                    <div class="cw-inv-detail-section-label">⚡ 交互方式</div>
                    <div class="cw-inv-detail-chips">${chips}</div>
                </div>`;
            }

            return `
                <div class="cw-inv-detail">
                    <div class="cw-inv-detail-head">
                        <div class="cw-inv-detail-icon">${icon}</div>
                        <div class="cw-inv-detail-meta">
                            <div class="cw-inv-detail-name">${item.name}</div>
                            <div class="cw-inv-detail-count">数量：<strong>${count}</strong></div>
                        </div>
                    </div>
                    ${descHTML}
                    ${fieldsHTML}
                    ${interactionsHTML}
                    <div class="cw-inv-actions">
                        <button class="cw-inv-action-btn primary"
                            onclick="EquipmentManager.openEquipDialog(${this.selectedIndex})">
                            ⚔️ 装备
                        </button>
                        <button class="cw-inv-action-btn"
                            onclick="InventoryManager.useItem(${this.selectedIndex})">
                            ✨ 使用
                        </button>
                        <button class="cw-inv-action-btn"
                            onclick="InteractionHistoryManager.openHistoryModal('inventoryItem', '${this._escapeAttr(item.name)}')">
                            📜 历史
                        </button>
                        <button class="cw-inv-action-btn"
                            onclick="InventoryManager.inspectItem(${this.selectedIndex})">
                            🔍 查看
                        </button>
                        <button class="cw-inv-action-btn danger full-width"
                            onclick="InventoryManager.openDiscardDialog(${this.selectedIndex})">
                            🗑️ 丢弃
                        </button>
                    </div>
                </div>`;
        },

        selectItem(i) {
            this.selectedIndex = i;
            const modal = document.getElementById('cinemaworld-modal');
            if (modal && modal.classList.contains('active')) {
                modal.innerHTML = this.generateHTML();
            }
        },

        // ============================================================
        // 丢弃（数量选择）
        // ============================================================
        openDiscardDialog(index) {
            const inv = PlayerStateManager.player.inventory || [];
            const item = inv[index];
            if (!item) return;

            const maxCount = item.count || 1;

            this._openQuantityDialog({
                title: '🗑️ 丢弃物品',
                item,
                maxCount,
                confirmLabel: '确认丢弃',
                confirmClass: 'danger',
                onConfirm: (n) => this._doDiscard(index, n),
            });
        },

        _doDiscard(index, count) {
            const inv = PlayerStateManager.player.inventory;
            const item = inv[index];
            if (!item) return;

            const itemName = item.name;
            item.count = (item.count || 1) - count;

            if (item.count <= 0) {
                inv.splice(index, 1);
                if (this.selectedIndex >= inv.length) {
                    this.selectedIndex = Math.max(0, inv.length - 1);
                }
            }

            PlayerStateManager.refreshAvatarArea();
            this.open();
            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText(`已丢弃 ${itemName} ×${count}`, 1200);
        },

        dropItem(index) {
            this.openDiscardDialog(index);
        },

        // ============================================================
        // 使用
        // ============================================================
        useItem(index) {
            const inv = PlayerStateManager.player.inventory || [];
            const item = inv[index];
            if (!item) return;

            const isStackable = (item.count || 1) > 1 && (item.stackable === true || item.maxStack > 1);

            if (!isStackable) {
                this._proceedUseItemFlow(index);
                return;
            }

            this._openQuantityDialog({
                title: '✨ 使用物品',
                item,
                maxCount: item.count || 1,
                confirmLabel: '确认使用',
                confirmClass: '',
                onConfirm: (n) => {
                    this._proceedUseItemFlow(index);
                },
            });
        },

        _proceedUseItemFlow(index) {
            const inv = PlayerStateManager.player.inventory || [];
            const item = inv[index];
            if (!item) return;

            const scene = window.LocationModalManager.currentLocation;
            const characters = scene?.sceneCharacters || [];

            if (!scene || characters.length === 0) {
                return this._proceedUseItem(index, null);
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">✨ 使用 ${item.name}</div>
                <div style="font-size:13px;color:#aaa;margin-bottom:15px;padding:10px;background:rgba(0,0,0,.2);border-radius:8px;">
                    ${item.description || '一件普通的物品。'}
                </div>
                <div style="font-size:13px;color:#aaa;margin-bottom:8px;">对谁使用？</div>
                <div style="display:grid;gap:8px;">
                    <div class="cinemaworld-button"
                         style="text-align:left;padding:12px 16px;"
                         onclick="InventoryManager._proceedUseItem(${index}, null)">
                        <span style="margin-right:8px;">👤</span>对自己使用
                    </div>
                    ${characters.map((c, i) => `
                        <div class="cinemaworld-button"
                             style="text-align:left;padding:12px 16px;"
                             onclick="InventoryManager._proceedUseItem(${index}, ${i})">
                            <span style="margin-right:8px;">👥</span>对 ${c.name} 使用
                        </div>
                    `).join('')}
                </div>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button" onclick="InventoryManager.open()">返回</button>
                </div>
            `;
            modal.className = 'active';
        },

        async _proceedUseItem(index, targetCharIndex) {
            const item = PlayerStateManager.player.inventory[index];
            if (!item) return;

            const scene = window.LocationModalManager.currentLocation;
            const targetChar = (targetCharIndex !== null && scene)
                ? scene.sceneCharacters?.[targetCharIndex]
                : null;

            const modal = document.getElementById('cinemaworld-modal');

            const interactions = item.interactions || [];
            let modesHTML = '';
            if (interactions.length > 0) {
                const allModes = [
                    ...interactions.map((inter, i) => ({ ...inter, _index: i, _free: false })),
                    { name: '自由发挥', hint: '不按预设，用自己的方式使用', _index: -1, _free: true },
                ];
                modesHTML = `
                    <div style="margin-bottom:15px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:8px;">选择使用方式（可不选，直接输入）：</div>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;max-height:240px;overflow-y:auto;">
                            ${allModes.map(m => `
                                <div class="cw-interact-mode" data-index="${m._index}"
                                    onclick="InventoryManager.selectMode(${m._index})"
                                    style="display:flex;align-items:center;gap:8px;padding:10px 14px;
                                        background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);
                                        border-radius:8px;cursor:pointer;transition:all .2s;"
                                    onmouseover="this.style.background='rgba(120,150,255,.15)'"
                                    onmouseout="if(!this.classList.contains('selected'))this.style.background='rgba(255,255,255,.05)'">
                                    <span style="font-size:16px;">${m._free ? '✍️' : '✨'}</span>
                                    <div style="flex:1;">
                                        <div style="font-size:13px;color:#fff;font-weight:600;">${m.name}</div>
                                        ${m.hint ? `<div style="font-size:11px;color:#888;">${m.hint}</div>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                modesHTML = `
                    <div style="font-size:12px;color:#888;padding:8px 0;margin-bottom:12px;">
                        这个物品没有预设的使用方式，你可以自由描述。
                    </div>`;
            }

            const targetLine = targetChar
                ? `<div style="font-size:13px;color:#9ab0ff;margin-bottom:12px;">
                       🎯 目标：<strong>${targetChar.name}</strong>
                   </div>`
                : `<div style="font-size:13px;color:#9ab0ff;margin-bottom:12px;">
                       🎯 目标：<strong>自己</strong>
                   </div>`;

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">✨ 使用 ${item.name}</div>
                <div style="margin-bottom:15px;color:#aaa;font-size:13px;padding:10px;background:rgba(0,0,0,.2);border-radius:8px;">
                    ${item.description || '一件普通的物品。'}
                    ${item.status ? `<br><span style="color:#887;">状态：${item.status}</span>` : ''}
                    ${item.effect ? `<br><span style="color:#9ab0ff;">功能：${item.effect}</span>` : ''}
                    ${item.count > 1 ? `<br><span style="color:#888;">数量：${item.count}</span>` : ''}
                </div>
                ${targetLine}
                ${modesHTML}
                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                        ${interactions.length > 0 ? '补充描述（可选）：' : '如何使用？'}
                    </div>
                    <textarea class="cinemaworld-textarea" id="item-use-input"
                        placeholder="${interactions.length > 0 ? '例如：我想仔细看看它的背面...' : '例如：喝下它'}"
                        style="min-height:80px;"></textarea>
                </div>
                <div style="text-align:center;">
                    <button class="cinemaworld-button primary"
                        onclick="InventoryManager.doUseItem(${index}, ${targetCharIndex === null ? 'null' : targetCharIndex})">
                        确认使用
                    </button>
                    <button class="cinemaworld-button" onclick="InventoryManager.open()">返回</button>
                </div>`;
            modal.className = 'active';

            if (interactions.length > 0) {
                this._selectedModeIndex = 0;
                setTimeout(() => this.selectMode(0), 0);
            } else {
                this._selectedModeIndex = -1;
            }
        },

        selectMode(index) {
            this._selectedModeIndex = index;
            document.querySelectorAll('.cw-interact-mode').forEach(el => {
                const isSelected = parseInt(el.dataset.index) === index;
                el.classList.toggle('selected', isSelected);
                el.style.background = isSelected ? 'rgba(120,150,255,.3)' : 'rgba(255,255,255,.05)';
                el.style.borderColor = isSelected ? 'rgba(120,150,255,.7)' : 'rgba(255,255,255,.1)';
            });
        },

        async doUseItem(index, targetCharIndex = null) {
            const item = PlayerStateManager.player.inventory[index];
            if (!item) return;
            const input = document.getElementById('item-use-input')?.value.trim() || '';
            const scene = window.LocationModalManager.currentLocation;
            const targetChar = (targetCharIndex !== null && scene)
                ? scene.sceneCharacters?.[targetCharIndex]
                : null;

            const interactions = item.interactions || [];
            let modeLabel = '直接使用';
            let modeLine = '';
            if (interactions.length > 0 && this._selectedModeIndex >= 0) {
                const inter = interactions[this._selectedModeIndex];
                if (inter) {
                    modeLabel = inter.name;
                    modeLine = `${inter.name}${inter.hint ? '（' + inter.hint + '）' : ''}`;
                }
            }

            const sceneCtx = this.buildSceneContext(scene);
            const playerBlock = PlayerStateManager.formatForPrompt();
            const chapterId = StoryManager.currentChapter?.id || null;
            const worldCtx = StoryManager.buildContext(null, {
                parentStory: false, mainChars: false, scene: false,
                interactionDigests: false, volumes: false, chapters: false,
                pendingEvents: false,
            });

            let targetBlock = '';
            if (targetChar) {
                const extras = targetChar.extraStats || {};
                const extraLines = (extras._order || [])
                    .filter(k => extras[k] !== undefined && extras[k] !== '')
                    .map(k => `  · ${k}: ${extras[k]}`)
                    .join('\n');
                targetBlock = `
【使用目标】
名称：${targetChar.name}
${targetChar.gender ? `性别：${targetChar.gender}` : ''}
${targetChar.mood ? `心情：${targetChar.mood}` : ''}
${targetChar.favorability ? `好感度：${targetChar.favorability}` : ''}
${targetChar.status ? `状态：${targetChar.status}` : ''}
${targetChar.description ? `描述：${targetChar.description}` : ''}
${extraLines ? `当前数据：\n${extraLines}` : ''}`;
            } else {
                targetBlock = `【使用目标】\n玩家自己`;
            }

            await window.UIManager.showText(`正在对 ${targetChar ? targetChar.name : '自己'} 使用 ${item.name}...`, 1000);

            const prompt = `视觉小说物品使用脚本生成。

【世界历史】
${worldCtx}

【场景上下文】
${sceneCtx}

★环境数据：${WorldManager.getEnvDataText(scene)}

${playerBlock}

${targetBlock}

【使用物品】
${item.name}${item.count > 1 ? ` ×${item.count}` : ''}
描述：${item.description || '无'}
${item.status ? `状态：${item.status}` : ''}
${item.effect ? `功能：${item.effect}` : ''}
使用方式：${modeLine || input || '直接使用'}
${input && modeLine ? `玩家补充：${input}` : ''}

【任务】
生成使用此物品的脚本，5-10 行。

【输出格式】
每行：【角色名|显示/隐藏|左/中/右|性别|状态】: 内容


注意：状态可以是心情，也可以是状态列表定义的内容，例如开心，位置只能是左/中/右。
【音乐提示】🎵 音乐: (音乐名)

━━━ 可选区块（有变化才写） ━━━

【效果】
目标: ${targetChar ? targetChar.name : '玩家'}
数值变化: 键名 +N  或  键名 -N
实体变化:
- 获得【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 失去【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
- 获得状态 状态名（可选效果，| 分隔：攻击-20%|持续3回合）
- 移除状态 状态名

★ 关键：获得物品时必须写完整格式（方括号内 键:值），否则玩家拿到的是空壳。
★ 可装备物品：写明属性字段，如 [类型:武器|攻击:+5|暴击:+10%]
★ 可消耗物品：写明功能，如 [类型:消耗品|功能:回复 50 点生命|可堆叠]
★ 普通物品：至少写 [类型:物品] 和图标

示例：
- 获得【生锈的铁剑|⚔️】：锈迹斑斑的短剑，[类型:武器|攻击:+3|图标:⚔️]
- 获得【红药水|🧪】：一瓶红色药剂，[类型:消耗品|功能:回复 30 点生命|可堆叠]
- 获得【黑面包|🍞】：还热乎，[类型:食物|功能:回复 10 点体力|可堆叠]
- 获得【金币|🪙】：[类型:货币|货币种类:金币]

【场景更新】
环境数据:
- 已有键:新值

【摘要】
（2-3句）

请开始生成：
`;

            const result = await window.generateFunctionalReply(prompt, 'use-item');
            if (!result) return;

            const summaryMatch = result.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
            const digestSummary = summaryMatch ? summaryMatch[1].trim() : '';
            const withoutDigest = result.replace(/【摘要】[\s\S]*?(?=\n【|$)/, '').trim();

            const updateIdx = withoutDigest.indexOf('【场景更新】');
            const effectIdx = withoutDigest.indexOf('【效果】');
            const cutPoints = [updateIdx, effectIdx].filter(i => i >= 0);
            const scriptEnd = cutPoints.length > 0 ? Math.min(...cutPoints) : withoutDigest.length;
            const scriptText = withoutDigest.substring(0, scriptEnd).trim();

            let sceneUpdatePart = '';
            let effectPart = '';
            if (updateIdx >= 0) {
                const nextBlock = effectIdx > updateIdx ? effectIdx : withoutDigest.length;
                sceneUpdatePart = withoutDigest.substring(updateIdx, nextBlock);
            }
            if (effectIdx >= 0) {
                const nextBlock = updateIdx > effectIdx ? updateIdx : withoutDigest.length;
                effectPart = withoutDigest.substring(effectIdx, nextBlock);
            }

            await MusicManager.applyMusicMarker(result);

            const dialogues = window.VisualNovelManager.parseScript(scriptText);

            if (dialogues.length > 0) {
                window.UIManager.closeModal();
                await window.VisualNovelManager.play(dialogues);
            } else {
                window.UIManager.closeModal();
                await window.UIManager.showText(scriptText, 5000);
            }

            if (effectPart) {
                await new Promise(r => setTimeout(r, 300));
                const results = EffectSystem.applyFromNarrative(effectPart);
                const text = EffectSystem.formatResults(results);
                if (text) await window.UIManager.showText(text, 4000);
            }
            if (sceneUpdatePart) {
                await new Promise(r => setTimeout(r, 300));
                const update = StoryManager.parseSceneUpdate(sceneUpdatePart);
                if (update) await StoryManager.applySceneUpdate(update);
            }
            if (digestSummary) {
                InteractionDigestManager.add({
                    targetType: 'item',
                    target: item.name,
                    source: 'inventoryItem',
                    summary: digestSummary,
                    chapterId,
                });
            }

            await MusicManager.clearOverrideMusic();

            InteractionHistoryManager.add({
                type: 'inventoryItem',
                target: item.name,
                targetMeta: {
                    count: item.count,
                    usedOn: targetChar ? targetChar.name : '玩家',
                },
                scene: scene?.name || '(无场景)',
                playerInput: input || '直接使用',
                script: scriptText,
                effect: effectPart || null,
                summary: digestSummary,
            });

            WorldManager.addToNarrativeLog(`[使用物品] ${item.name}${targetChar ? ` → ${targetChar.name}` : ''}`);
            if (window.SaveManager) window.SaveManager.save();
        },

        // ============================================================
        // 装备
        // ============================================================
        openEquipment() {
            this.addStyles();
            EquipmentManager._injectEquipStyles();

            const modal = document.getElementById('cinemaworld-modal');
            const player = PlayerStateManager.player;
            const eq = EquipmentManager.ensureStructure();

            let gridHTML = '';
            eq.slots.forEach((item, i) => {
                const icon = item?.icon || '📦';
                const isSelected = i === (this._equipSelectedIndex ?? 0);
                gridHTML += `
                    <div class="cw-inv-slot ${item ? '' : 'empty'} ${isSelected ? 'selected' : ''}"
                         onclick="InventoryManager._selectEquipSlot(${i})"
                         title="${item ? this._escapeAttr(item.name) : '空'}">
                        ${item ? `<div class="cw-inv-slot-icon">${icon}</div>` : ''}
                    </div>`;
            });

            const bonuses = eq.bonuses || {};
            let bonusHTML = '';
            if (Object.keys(bonuses).length > 0) {
                bonusHTML = Object.entries(bonuses).map(([k, v]) => {
                    const sign = v > 0 ? '+' : '';
                    const display = Math.abs(v) < 1 && v !== 0
                        ? `${sign}${(v * 100).toFixed(0)}%`
                        : `${sign}${v}`;
                    return `<span style="display:inline-block;padding:4px 10px;margin:3px;
                        background:rgba(255,180,80,.15);border:1px solid rgba(255,180,80,.35);
                        border-radius:12px;font-size:12px;color:#ffcf80;">
                        ${k} ${display}</span>`;
                }).join('');
            } else {
                bonusHTML = '<span style="color:#666;font-size:12px;">暂无加成</span>';
            }

            const sel = this._equipSelectedIndex ?? 0;
            const selItem = eq.slots[sel];

            modal.className = 'active cw-inv-modal';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚔️ 装备栏</div>

                <div style="text-align:center;margin-bottom:12px;">
                    <div style="font-size:12px;color:#888;margin-bottom:6px;">
                        共 ${eq.slots.length} 格
                    </div>
                    <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                        <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;"
                            onclick="EquipmentManager.expandSlots(1); InventoryManager.openEquipment();">
                            ➕ 扩容 +1
                        </button>
                        <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;"
                            onclick="EquipmentManager.expandSlots(6); InventoryManager.openEquipment();">
                            ➕ 扩容 +6
                        </button>
                        <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;"
                            onclick="InventoryManager._promptSetSlotCount()">
                            ✏️ 自定义
                        </button>
                        ${eq.slots.length > 1 ? `
                            <button class="cinemaworld-button" style="font-size:12px;padding:5px 12px;color:#d87d7d;"
                                onclick="EquipmentManager.shrinkSlots(1); InventoryManager.openEquipment();">
                                ➖ 缩容
                            </button>
                        ` : ''}
                    </div>
                </div>

                <div style="margin-bottom:12px;padding:10px 12px;background:rgba(255,180,80,.08);
                     border:1px solid rgba(255,180,80,.25);border-radius:10px;">
                    <div style="font-size:12px;color:#ffcf80;margin-bottom:6px;font-weight:600;">
                        📊 当前总加成
                    </div>
                    <div>${bonusHTML}</div>
                </div>

                <div class="cw-inv-layout" style="grid-template-columns: 1fr 340px;">
                    <div class="cw-inv-left">
                        <div class="cw-inv-grid">
                            ${gridHTML}
                        </div>
                    </div>
                    <div class="cw-inv-right">
                        <div class="cw-inv-detail">
                            ${selItem ? `
                                <div class="cw-inv-detail-head">
                                    <div class="cw-inv-detail-icon">${selItem.icon || '📦'}</div>
                                    <div class="cw-inv-detail-meta">
                                        <div class="cw-inv-detail-name">${selItem.name}</div>
                                        <div class="cw-inv-detail-count">第 ${sel + 1} 格</div>
                                    </div>
                                </div>
                                ${selItem.description ? `
                                    <div class="cw-inv-detail-section">
                                        <div class="cw-inv-detail-section-label">📝 描述</div>
                                        <div class="cw-inv-detail-desc">${selItem.description}</div>
                                    </div>
                                ` : ''}
                                ${this._renderItemFields(selItem)}
                                <div class="cw-inv-actions">
                                    <button class="cw-inv-action-btn primary"
                                        onclick="EquipmentManager.unequip(${sel}); InventoryManager.openEquipment();">
                                        📤 卸下
                                    </button>
                                    <button class="cw-inv-action-btn"
                                        onclick="InventoryManager._useEquipped(${sel})">
                                        ✨ 使用
                                    </button>
                                </div>
                            ` : `
                                <div class="cw-inv-empty-detail">
                                    <div class="cw-inv-empty-icon">📦</div>
                                    <div class="cw-inv-empty-text">第 ${sel + 1} 格为空</div>
                                </div>
                            `}
                        </div>
                    </div>
                </div>

                <div style="text-align:center;margin-top:16px;">
                    <button class="cinemaworld-button" onclick="InventoryManager.open()">← 返回背包</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>
            `;
        },

        _selectEquipSlot(i) {
            this._equipSelectedIndex = i;
            this.openEquipment();
        },

        _promptSetSlotCount() {
            const eq = EquipmentManager.ensureStructure();
            const n = prompt(`输入装备栏格数（当前 ${eq.slots.length}）：`, eq.slots.length);
            if (n === null) return;
            const num = parseInt(n);
            if (isNaN(num) || num < 1) { alert('请输入 ≥ 1 的数字'); return; }
            EquipmentManager.setSlotCount(num);
            this.openEquipment();
        },

        _renderItemFields(item) {
            if (!item?.fields) return '';
            const rows = [];
            for (const [k, v] of Object.entries(item.fields)) {
                if (k.startsWith('_pos')) continue;
                if (['图标', 'icon'].includes(k)) continue;
                const isBonus = EquipmentManager._parseBonus(v) !== null;
                rows.push(`
                    <div class="cw-inv-detail-attr">
                        <span class="key">${k}</span>
                        <span class="val ${isBonus ? 'bonus' : ''}">${v}</span>
                    </div>`);
            }
            if (rows.length === 0) return '';
            return `<div class="cw-inv-detail-section">
                <div class="cw-inv-detail-section-label">📋 属性</div>
                ${rows.join('')}
            </div>`;
        },

        _useEquipped(slotIndex) {
            const eq = EquipmentManager.ensureStructure();
            const item = eq.slots[slotIndex];
            if (!item) return;

            const player = PlayerStateManager.player;
            const tempIndex = player.inventory.length;
            player.inventory.push(item);
            InventoryManager.doUseItem(tempIndex);
            setTimeout(() => {
                const stillInInv = player.inventory.includes(item);
                if (!stillInInv) {
                    eq.slots[slotIndex] = null;
                    EquipmentManager.recomputeBonuses();
                    if (window.SaveManager) window.SaveManager.save();
                } else {
                    const i = player.inventory.indexOf(item);
                    if (i > -1) player.inventory.splice(i, 1);
                }
            }, 6000);
        },

        // ============================================================
        // 查看
        // ============================================================
        inspectItem(index) {
            const item = PlayerStateManager.player.inventory[index];
            if (!item) return;

            const modal = document.getElementById('cinemaworld-modal');
            const icon = item.icon || '📦';

            const fieldsHTML = this.renderItemFieldsHTML(item, {
                hideKeys: ['买价', '卖价', '库存'],
            });

            modal.className = 'active cw-inv-modal';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🔍 ${icon} ${item.name}</div>

                <div style="display:flex;gap:14px;padding:14px;background:rgba(0,0,0,.2);
                     border-radius:10px;margin-bottom:12px;align-items:center;">
                    <div style="font-size:48px;flex-shrink:0;line-height:1;">${icon}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:17px;font-weight:bold;color:#e8d8a8;margin-bottom:4px;">
                            ${item.name}
                        </div>
                        <div style="font-size:12px;color:#888;">
                            数量：${item.count || 1}
                        </div>
                    </div>
                </div>

                ${item.description ? `
                    <div style="padding:12px;background:rgba(255,255,255,.03);
                         border-radius:8px;margin-bottom:12px;">
                        <div style="font-size:11px;color:#888;font-weight:600;
                             margin-bottom:6px;letter-spacing:.5px;">📝 描述</div>
                        <div style="font-size:13px;color:#ccc;line-height:1.7;">
                            ${item.description}
                        </div>
                    </div>
                ` : ''}

                ${fieldsHTML ? `
                    <div style="padding:12px;background:rgba(255,255,255,.03);
                         border-radius:8px;margin-bottom:12px;">
                        <div style="font-size:11px;color:#888;font-weight:600;
                             margin-bottom:6px;letter-spacing:.5px;">📋 属性</div>
                        ${fieldsHTML}
                    </div>
                ` : ''}

                ${item.interactions?.length ? `
                    <div style="padding:12px;background:rgba(255,255,255,.03);
                         border-radius:8px;margin-bottom:12px;">
                        <div style="font-size:11px;color:#888;font-weight:600;
                             margin-bottom:6px;letter-spacing:.5px;">⚡ 交互方式</div>
                        <div style="display:flex;flex-wrap:wrap;gap:6px;">
                            ${item.interactions.map(inter => `
                                <span style="display:inline-block;padding:4px 10px;
                                     background:rgba(120,150,255,.15);
                                     border:1px solid rgba(120,150,255,.3);
                                     border-radius:12px;font-size:12px;color:#9ab0ff;">
                                    ${inter.name}${inter.hint ? `<span style="color:#888;font-size:10px;margin-left:4px;">${inter.hint}</span>` : ''}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <div style="text-align:center;margin-top:15px;display:flex;
                     justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary"
                        onclick="EquipmentManager.openEquipDialog(${index})">⚔️ 装备</button>
                    <button class="cinemaworld-button primary"
                        onclick="InventoryManager.useItem(${index})">✨ 使用</button>
                    <button class="cinemaworld-button"
                        onclick="InteractionHistoryManager.openHistoryModal('inventoryItem', '${this._escapeAttr(item.name)}')">📜 历史</button>
                    <button class="cinemaworld-button danger"
                        onclick="InventoryManager.openDiscardDialog(${index})">🗑️ 丢弃</button>
                    <button class="cinemaworld-button"
                        onclick="InventoryManager.open()">← 返回背包</button>
                    <button class="cinemaworld-button"
                        onclick="UIManager.closeModal()">关闭</button>
                </div>
            `;
        },

        // ============================================================
        // 数量选择模态框（通用）
        // ============================================================
        _openQuantityDialog({ title, item, maxCount, confirmLabel, confirmClass, onConfirm }) {
            const old = document.getElementById('cw-qty-modal');
            if (old) old.remove();

            const el = document.createElement('div');
            el.id = 'cw-qty-modal';
            el.className = 'cw-qty-modal';

            const quickBtns = maxCount > 1
                ? `<div class="cw-qty-quick">
                    <button class="cw-qty-quick-btn" data-qty="1">1</button>
                    ${maxCount >= 5 ? `<button class="cw-qty-quick-btn" data-qty="5">5</button>` : ''}
                    ${maxCount >= 10 ? `<button class="cw-qty-quick-btn" data-qty="10">10</button>` : ''}
                    ${maxCount >= 50 ? `<button class="cw-qty-quick-btn" data-qty="50">50</button>` : ''}
                    <button class="cw-qty-quick-btn" data-qty="${maxCount}">全部</button>
                </div>`
                : '';

            el.innerHTML = `
                <div class="cw-qty-panel">
                    <div class="cw-qty-title">${title}</div>

                    <div class="cw-qty-item">
                        <div class="cw-qty-item-icon">${item.icon || '📦'}</div>
                        <div class="cw-qty-item-info">
                            <div class="cw-qty-item-name">${item.name}</div>
                            <div class="cw-qty-item-have">你有 <strong>${maxCount}</strong> 个</div>
                        </div>
                    </div>

                    <div class="cw-qty-control">
                        <button class="cw-qty-btn" data-action="dec">−</button>
                        <input type="number" class="cw-qty-input" id="cw-qty-input"
                            value="1" min="1" max="${maxCount}">
                        <button class="cw-qty-btn" data-action="inc">+</button>
                    </div>

                    ${quickBtns}

                    <div class="cw-qty-actions">
                        <button class="cw-qty-action cancel" data-action="cancel">取消</button>
                        <button class="cw-qty-action confirm ${confirmClass || ''}" data-action="confirm">
                            ${confirmLabel}
                        </button>
                    </div>
                </div>`;

            document.body.appendChild(el);

            const input = el.querySelector('#cw-qty-input');
            const clamp = (v) => Math.max(1, Math.min(maxCount, parseInt(v) || 1));

            el.querySelector('[data-action="dec"]').onclick = () => {
                input.value = clamp(parseInt(input.value) - 1);
            };
            el.querySelector('[data-action="inc"]').onclick = () => {
                input.value = clamp(parseInt(input.value) + 1);
            };
            input.oninput = () => {
                const v = parseInt(input.value);
                if (isNaN(v) || v < 1) input.value = 1;
                else if (v > maxCount) input.value = maxCount;
            };

            el.querySelectorAll('[data-qty]').forEach(btn => {
                btn.onclick = () => {
                    input.value = clamp(parseInt(btn.dataset.qty));
                };
            });

            const close = () => el.remove();

            el.querySelector('[data-action="cancel"]').onclick = close;
            el.querySelector('[data-action="confirm"]').onclick = () => {
                const n = clamp(input.value);
                close();
                onConfirm(n);
            };

            el.addEventListener('click', (e) => {
                if (e.target === el) close();
            });

            const escHandler = (e) => {
                if (e.key === 'Escape') {
                    close();
                    document.removeEventListener('keydown', escHandler);
                }
            };
            document.addEventListener('keydown', escHandler);

            setTimeout(() => input.select(), 50);
        },

        // ============================================================
        // 工具
        // ============================================================
        _escapeAttr(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, "\\'")
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },

        renderItemFieldsHTML(item, options = {}) {
            if (!item?.fields) return '';
            const opt = {
                hideKeys: [],
                compact: false,
                ...options,
            };
            const defaultHide = ['图标', 'icon'];
            const rows = [];
            for (const [key, value] of Object.entries(item.fields)) {
                if (key.startsWith('_pos')) continue;
                if (defaultHide.includes(key)) continue;
                if (opt.hideKeys.includes(key)) continue;
                if (value === undefined || value === null || value === '') continue;

                const isNumeric = this._isNumericValue(value);
                rows.push(`
                    <div style="display:flex;justify-content:space-between;align-items:baseline;
                         padding:${opt.compact ? '4px' : '6px'} 0;
                         border-bottom:1px solid rgba(255,255,255,.05);
                         font-size:${opt.compact ? '11px' : '12px'};">
                        <span style="color:#888;flex-shrink:0;margin-right:10px;">${key}</span>
                        <span style="color:${isNumeric ? '#ffcf80' : '#ddd'};
                             font-weight:${isNumeric ? '600' : '400'};
                             text-align:right;word-break:break-word;">${value}</span>
                    </div>`);
            }
            return rows.join('');
        },

        _isNumericValue(v) {
            const s = String(v).trim();
            return /^[+\-]?\d+(\.\d+)?%?$/.test(s);
        },

        buildSceneContext(scene) {
            if (!scene) return '当前不在任何场景中。';
            let ctx = `场景名称：${scene.name}\n`;
            if (scene.description) ctx += `描述：${scene.description}\n`;
            if (scene.environment) ctx += `环境：${scene.environment}\n`;

            const env = scene.environmentData;
            if (env && env._order && env._order.length > 0) {
                const envText = env._order
                    .filter(k => env[k] !== undefined && env[k] !== '')
                    .map(k => `${k}:${env[k]}`)
                    .join(' | ');
                if (envText) ctx += `环境数据：${envText}\n`;
            }

            if (scene.sceneCharacters?.length) {
                ctx += `场景人物：\n`;
                scene.sceneCharacters.forEach(c => {
                    const info = [];
                    if (c.gender) info.push(`性别:${c.gender}`);
                    if (c.mood) info.push(`心情:${c.mood}`);
                    if (c.favorability) info.push(`好感度:${c.favorability}`);
                    if (c.status) info.push(`状态:${c.status}`);
                    ctx += `  - ${c.name}${info.length ? '（' + info.join('，') + '）' : ''}`;
                    if (c.description) ctx += `：${c.description}`;
                    ctx += '\n';
                });
            } else {
                ctx += `场景人物：无\n`;
            }

            if (scene.sceneItems?.length) {
                ctx += `场景实体：${scene.sceneItems.map(i => i.name).join('、')}\n`;
            }

            if (scene.sceneActions?.length) {
                ctx += `当前可执行的场景行动：\n`;
                scene.sceneActions.forEach(a => {
                    const typeNote = a.type === 'once' ? '一次性' : a.type === 'repeat' ? '可重复' : '';
                    ctx += `  - ${a.name}${typeNote ? `（${typeNote}）` : ''}`;
                    if (a.hint) ctx += `：${a.hint}`;
                    ctx += '\n';
                });
            }

            return ctx;
        },
    };

    // ==================== 商店管理器 ====================
    const ShopManager = {
        _currentShop: null,
        _currentView: 'buy',

        ensureStore() {
            if (!CinemaWorld.worldState.shops) {
                CinemaWorld.worldState.shops = {};
            }
            return CinemaWorld.worldState.shops;
        },

        getAll() {
            return Object.values(this.ensureStore());
        },

        find(name) {
            const store = this.ensureStore();
            return Object.values(store).find(s => s.name === name) || null;
        },

        deleteShop(shopId) {
            const store = this.ensureStore();
            const shop = store[shopId];
            if (!shop) return false;
            delete store[shopId];
            if (window.SaveManager) window.SaveManager.save();
            return true;
        },
        // ★ 根据场景实体生成商店
        async fromSceneItem(item) {
            if (!item) return null;

            const scene = window.LocationModalManager.currentLocation;
            const sceneCtx = window.InventoryManager.buildSceneContext(scene);
            const playerBlock = PlayerStateManager.formatForPrompt();

            const fields = item.fields || {};
            const fieldLines = Object.entries(fields)
                .filter(([k]) => !k.startsWith('_pos'))
                .filter(([k]) => !['类型', '图标', 'icon', '交互方式'].includes(k))
                .map(([k, v]) => `${k}：${v}`)
                .join('\n');

            const prompt = `你正在为视觉小说游戏设计一个"商店"。

【世界与场景】
${sceneCtx}

${playerBlock}

【商店实体信息】
名称：${item.name}
${item.description ? `描述：${item.description}` : ''}
${fieldLines ? `\n已有字段：\n${fieldLines}` : ''}

【任务】
根据这个场景实体，生成一个完整的商店。它可以是店铺、摊位、自动贩卖机、
分配站、黑市、NPC 随身货物等——由你根据实体信息决定。

【输出格式】
严格按以下格式输出：

【商店】
名字: (商店名，默认沿用实体名)
图标: (一个 emoji)
描述: (一段话，描述这个商店的样子、老板、氛围)
货币: (货币单位，如"金币"、"信用点"、"瓶盖"、"声望"，不写则默认"金币")
收购: (是/否，是否收购玩家卖的东西)

商品:
- 【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]

【规则】
1. 商品 3-8 件，符合场景和世界观
2. 商品格式和场景实体完全一致（方括号内 键:值，用 | 分隔）
3. 如果这个世界没有货币，把价格写成 0，并在"收购"里写"否"
4. 价格数值要符合世界观
5. 物品：用于消耗、食用、携带、交互。
6. 装备：能给玩家提供属性加成，额外写属性字段，如 攻击:+5|防御:+3

【示例】
【商店】
名字: 名字
图标: 🏪
描述: 描述
货币: 金币
收购: 是

商品:
- 【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]

请开始生成：
`;

            const result = await window.generateFunctionalReply(prompt, 'shop-from-scene-item');
            if (!result) return null;

            const shop = this.parseShop(result);
            if (!shop) return null;

            // 沿用实体名/图标（若 AI 没给）
            if (!shop.name) shop.name = item.name;
            if (shop.icon === '🏪' && item.icon) shop.icon = item.icon;

            this.saveShop(shop);
            return shop;
        },
        getItemSellPrice(item, shop) {
            if (!item) return 0;

            const f = item.fields || {};
            const p = this._readNumberFromFields(f, ['回收价', '卖价', '卖出价']);
            if (p !== null) return Math.max(0, p);

            const buyP = this._readNumberFromFields(f, ['售价', '买价', '价格']);
            if (buyP !== null) {
                const mult = shop?.sellMultiplier ?? 0.4;
                return Math.max(1, Math.round(buyP * mult));
            }

            return Math.max(1, Math.round(this._guessPrice(item, shop) * 0.4));
        },

        async regenerateShop(shopId) {
            const store = this.ensureStore();
            const old = store[shopId];
            if (!old) return null;

            const newShop = await this.generateShop(`重新生成一个商店，替代原来的「${old.name}」`);
            if (!newShop) return null;

            if (newShop.id && newShop.id !== shopId && store[newShop.id]) {
                delete store[newShop.id];
            }

            newShop.id = shopId;
            store[shopId] = newShop;

            if (this._currentShop && this._currentShop.id === shopId) {
                this._currentShop = newShop;
            }

            if (window.SaveManager) window.SaveManager.save();
            return newShop;
        },

        saveShop(shop) {
            const store = this.ensureStore();
            if (!shop.id) shop.id = `shop_${Date.now()}`;
            store[shop.id] = shop;
            if (window.SaveManager) window.SaveManager.save();
            return shop;
        },

        removeShop(id) {
            const store = this.ensureStore();
            delete store[id];
            if (window.SaveManager) window.SaveManager.save();
        },

        // ---------- 货币处理 ----------
        findCurrencyKey(shop) {
            const player = PlayerStateManager.player;
            const extra = player.extraStats;
            if (!extra || !extra._order) return null;

            if (shop?.currency) {
                if (extra._order.includes(shop.currency)) return shop.currency;
            }

            if (extra._order.includes('金币')) return '金币';

            for (const k of extra._order) {
                if (/金币|银两|铜钱|金钱|货币|币|元/.test(k)) return k;
            }

            return extra._order[0] || null;
        },

        getItemCurrency(item) {
            const f = item?.fields || {};
            for (const k of ['货币种类', '货币', '币种', 'currency']) {
                if (f[k] !== undefined && f[k] !== '') {
                    return String(f[k]).trim();
                }
            }
            return null;
        },
        normalizeCurrency(name, shop) {
            if (!name) return null;
        
            const playerKey = this.findCurrencyKey(shop);
            if (!playerKey) return name;
        
            if (name === playerKey) return playerKey;
        
            const currencyRegex = /金币|银两|铜钱|金钱|货币|币|元/;
            if (currencyRegex.test(name) && currencyRegex.test(playerKey)) {
                return playerKey;
            }
        
            return name;
        },
        getPlayerCurrency(shop) {
            const key = this.findCurrencyKey(shop);
            if (!key) return { key: null, value: 0 };
            const raw = String(PlayerStateManager.player.extraStats[key] ?? '0');
            const num = parseFloat(raw.replace(/[^\d.-]/g, '')) || 0;
            return { key, value: num, raw };
        },

        changePlayerCurrency(shop, delta) {
            const key = this.findCurrencyKey(shop);
            if (!key) return false;
            const extra = PlayerStateManager.player.extraStats;
            const raw = String(extra[key] ?? '0');
            const match = raw.match(/^(-?\d+(?:\.\d+)?)(.*)$/);
            if (!match) return false;
            const before = parseFloat(match[1]);
            const unit = match[2] || '';
            const after = Math.max(0, before + delta);
            extra[key] = `${after}${unit}`;
            PlayerStateManager.refreshAvatarArea();
            return { before, after, unit };
        },

        getBuyPrice(stockItem, shop) {
            if (typeof stockItem.buyPrice === 'number') return stockItem.buyPrice;
            const fields = stockItem.fields || {};
            for (const k of ['买入价', '价格', '售价', 'buyPrice', 'price']) {
                if (fields[k] !== undefined) {
                    const n = parseFloat(String(fields[k]).replace(/[^\d.-]/g, ''));
                    if (!isNaN(n)) return n;
                }
            }
            return Math.round((shop?.defaultBuyPrice || 10) * (shop?.buyMultiplier || 1));
        },

        getSellPrice(stockItem, shop) {
            if (typeof stockItem.sellPrice === 'number') return stockItem.sellPrice;
            const fields = stockItem.fields || {};
            for (const k of ['卖出价', '回收价', 'sellPrice']) {
                if (fields[k] !== undefined) {
                    const n = parseFloat(String(fields[k]).replace(/[^\d.-]/g, ''));
                    if (!isNaN(n)) return n;
                }
            }
            const buy = this.getBuyPrice(stockItem, shop);
            return Math.round(buy * (shop?.sellMultiplier ?? 0.5));
        },

        _guessPrice(item, shop) {
            const fields = item.fields || {};
            const type = String(fields['类型'] || item.type || '').toLowerCase();

            if (/武器|weapon/.test(type)) return 80;
            if (/护甲|防具|armor/.test(type)) return 60;
            if (/饰品|accessory/.test(type)) return 40;
            if (/消耗|consumable|食物|food/.test(type)) return 10;
            if (/工具|tool/.test(type)) return 30;
            if (/材料|material/.test(type)) return 15;
            if (/产物|product/.test(type)) return 15;

            let attrSum = 0;
            for (const [k, v] of Object.entries(fields)) {
                if (['类型', '状态', '图标', 'icon', '功能', '交互方式', '描述', '可堆叠',
                     '买价', '卖价', '买入价', '卖出价', '回收价'].includes(k)) continue;
                const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
                if (!isNaN(n)) attrSum += Math.abs(n);
            }

            return Math.max(5, Math.round(10 + attrSum * 2));
        },

        // ---------- 交易动作 ----------
        buy(shop, stockIndex, count = 1) {
            const stockItem = shop.stock?.[stockIndex];
            if (!stockItem) return { ok: false, reason: '商品不存在' };

            if (stockItem.count < count) {
                return { ok: false, reason: `库存不足（剩 ${stockItem.count}）` };
            }

            const unitPrice = stockItem.buyPrice || 0;
            const total = unitPrice * count;

            const { key: currencyKey, value: playerGold } = this.getPlayerCurrency(shop);
            if (total > 0 && !currencyKey) {
                return { ok: false, reason: '找不到货币（玩家 extraStats 里没有可用的货币键）' };
            }
            if (total > 0 && playerGold < total) {
                return { ok: false, reason: `钱不够（需要 ${total}，你有 ${playerGold}）` };
            }

            if (total > 0) this.changePlayerCurrency(shop, -total);

            const player = PlayerStateManager.player;
            const ex = player.inventory.find(i => i.name === stockItem.name);
            if (ex) {
                ex.count = (ex.count || 1) + count;
            } else {
                const cleanFields = { ...(stockItem.fields || {}) };

                player.inventory.push({
                    name: stockItem.name,
                    count: count,
                    icon: stockItem.icon || '📦',
                    description: stockItem.description || '',
                    fields: cleanFields,
                    interactions: stockItem.interactions || [],
                    status: stockItem.status || '',
                    effect: stockItem.effect || '',
                    type: stockItem.type || 'item',
                });
            }

            stockItem.count -= count;
            if (stockItem.count <= 0) {
                shop.stock.splice(stockIndex, 1);
            }

            if (window.SaveManager) window.SaveManager.save();
            return {
                ok: true,
                action: 'buy',
                itemName: stockItem.name,
                count,
                unitPrice,
                total,
                currency: currencyKey,
            };
        },

        sell(shop, inventoryIndex, count = 1) {
            const player = PlayerStateManager.player;
            const invItem = player.inventory[inventoryIndex];
            if (!invItem) return { ok: false, reason: '物品不存在' };
            if ((invItem.count || 1) < count) return { ok: false, reason: '数量不足' };

            const rawItemCurrency = this.getItemCurrency(invItem);
            const rawShopCurrency = shop.currency || '金币';
            const itemCurrency = this.normalizeCurrency(rawItemCurrency, shop);
            const shopCurrency = this.normalizeCurrency(rawShopCurrency, shop);
            if (itemCurrency && shopCurrency && itemCurrency !== shopCurrency) {
                return {
                    ok: false,
                    reason: `这家店只收「${rawShopCurrency}」计价的物品，这个物品是「${rawItemCurrency}」计价的`,
                };
            }

            const stockIndex = shop.stock.findIndex(s => s.name === invItem.name);
            if (stockIndex === -1 && !shop.buyAnything) {
                return { ok: false, reason: '这家店不收这类物品' };
            }

            let unitPrice;
            if (stockIndex > -1) {
                const stockItem = shop.stock[stockIndex];
                unitPrice = stockItem.sellPrice
                    ?? Math.round((stockItem.buyPrice || 0) * (shop.sellMultiplier ?? 0.4));
            } else {
                unitPrice = this.getItemSellPrice(invItem, shop);
            }

            const total = unitPrice * count;

            if (total > 0) this.changePlayerCurrency(shop, total);

            invItem.count -= count;
            if (invItem.count <= 0) {
                player.inventory.splice(inventoryIndex, 1);
            }

            if (stockIndex > -1) {
                shop.stock[stockIndex].count += count;
            } else if (shop.buyAnything) {
                const buyBack = Math.max(1, Math.round(unitPrice * 2.5));
                const cleanFields = { ...(invItem.fields || {}) };

                shop.stock.push({
                    name: invItem.name,
                    icon: invItem.icon || '📦',
                    description: invItem.description || '',
                    count,
                    fields: cleanFields,
                    interactions: invItem.interactions || [],
                    status: invItem.status || '',
                    effect: invItem.effect || '',
                    type: invItem.type || 'item',
                    buyPrice: buyBack,
                    sellPrice: unitPrice,
                });
            }

            if (window.SaveManager) window.SaveManager.save();
            return {
                ok: true,
                action: 'sell',
                itemName: invItem.name,
                count,
                unitPrice,
                total,
            };
        },

        // ---------- AI 生成商店 ----------
        async generateShop(context = '') {
            const playerBlock = PlayerStateManager.formatForPrompt();
            const worldCtx = StoryManager.buildContext(null, {
                parentStory: false,
                mainChars: false,
                scene: true,
                interactionDigests: false,
                volumes: false,
                chapters: false,
                pendingEvents: false,
            });

            const prompt = `你正在为视觉小说游戏生成一个"商店"。

【世界与场景】
${worldCtx}

${playerBlock}

【生成要求】
${context || '根据当前场景，生成一个自然的商店（可以是店铺、摊位、自动贩卖机、分配站、黑市、NPC 随身携带的货物等）。'}

【输出格式】
严格按以下格式输出：

【商店】
名字: (商店名)
图标: (一个 emoji)
描述: (一段话，描述这个商店的样子、老板、氛围)
货币: (货币单位，如"金币"、"信用点"、"瓶盖"、"声望"，不写则默认"金币")
收购: (是/否，是否收购玩家卖的东西)

商品:
- 【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]

【规则】
1. 商品 3-8 件，符合场景和世界观
2. 商品格式和场景实体完全一致（方括号内 键:值，用 | 分隔）
3. 图标可以是物品 emoji 或放在方括号里，二选一
4. 如果这个世界没有货币（如共产主义社会），
   把价格写成 0，并在"收购"里写"否"
5. 价格数值要符合世界观（末日游戏里可能几发子弹换一顿饭）
6.- 物品：用于消耗、食用、携带、交互的普通物品。
只需要写类型/状态/功能/交互方式/图标/可堆叠/买价/卖价/库存。
- 装备：能给玩家提供属性加成的物品（武器、护甲、饰品、工具等）。
在物品字段基础上，额外写属性字段，格式为 键:值，根据玩家有的属性来写。
例如 攻击:+5|防御:+3|暴击:+10%|幸运:+5。
玩家装备后属性会生效，脱下后失效

【示例】
【商店】
名字: 名字
图标: 🏪
描述: 描述
货币: 货币
收购: 是

商品:
- 【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]

请开始生成：
`;

            const result = await window.generateFunctionalReply(prompt, 'shop-generation');
            if (!result) return null;

            const shop = this.parseShop(result);
            if (!shop) return null;

            this.saveShop(shop);
            return shop;
        },

        parseShop(text) {
            const shop = {
                id: `shop_${Date.now()}`,
                name: '',
                icon: '🏪',
                description: '',
                currency: '金币',
                buyAnything: false,
                stock: [],
                isOpen: true,
            };

            const nameMatch = text.match(/名字[:：]\s*(.+)/);
            if (nameMatch) shop.name = nameMatch[1].trim();

            const iconMatch = text.match(/图标[:：]\s*(.+)/);
            if (iconMatch) {
                const emoji = iconMatch[1].match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
                if (emoji) shop.icon = emoji[0];
            }

            const descMatch = text.match(/描述[:：]\s*(.+)/);
            if (descMatch) shop.description = descMatch[1].trim();

            const curMatch = text.match(/货币[:：]\s*(.+)/);
            if (curMatch) shop.currency = curMatch[1].trim();

            const buyMatch = text.match(/收购[:：]\s*(.+)/);
            if (buyMatch) {
                shop.buyAnything = /是|yes|true|收/i.test(buyMatch[1]);
            }

            const stockSection = text.match(/商品[:：]?\s*([\s\S]*?)$/);
            if (stockSection) {
                const lines = stockSection[1].split('\n');
                for (const raw of lines) {
                    const line = raw.trim();
                    if (!line.startsWith('-')) continue;
                    const item = WorldManager.parseItemLine(line.substring(1).trim());
                    if (!item || !item.name) continue;

                    const fields = item.fields || {};

                    const buyPrice = this._readPriceFromFields(fields, ['买价', '价格', '买入价']);
                    const sellPrice = this._readPriceFromFields(fields, ['卖价', '回收价', '卖出价']);

                    let stockCount = this._readNumberFromFields(fields, ['库存', '数量', 'stock']);
                    if (stockCount === null) stockCount = 1;

                    const cleanFields = { ...fields };
                    delete cleanFields['库存'];
                    delete cleanFields['数量'];
                    delete cleanFields['stock'];

                    shop.stock.push({
                        name: item.name,
                        icon: item.icon || '📦',
                        description: item.description || '',
                        count: stockCount,
                        fields: cleanFields,
                        interactions: item.interactions || [],
                        status: item.status || '',
                        effect: item.effect || '',
                        type: item.type || 'item',
                        buyPrice: buyPrice !== null ? buyPrice : this._guessPrice(item, shop),
                        sellPrice: sellPrice !== null ? sellPrice : null,
                    });
                }
            }

            for (const item of shop.stock) {
                if (item.sellPrice === null || item.sellPrice === undefined) {
                    item.sellPrice = Math.round(item.buyPrice * 0.4);
                }
            }

            if (!shop.name) return null;
            return shop;
        },

        _readNumberFromFields(fields, keys) {
            for (const k of keys) {
                if (fields[k] !== undefined && fields[k] !== '') {
                    const n = parseFloat(String(fields[k]).replace(/[^\d.-]/g, ''));
                    if (!isNaN(n)) return n;
                }
            }
            return null;
        },

        _readPriceFromFields(fields, keys) {
            return this._readNumberFromFields(fields, keys);
        },

        // ---------- UI ----------
        open(shopOrId) {
            let shop;
            if (typeof shopOrId === 'string') {
                shop = this.find(shopOrId);
                if (!shop) {
                    shop = this.ensureStore()[shopOrId];
                }
            } else {
                shop = shopOrId;
            }
            if (!shop) {
                window.UIManager.showText('商店不存在', 2000);
                return;
            }

            this._currentShop = shop;
            this._currentView = 'buy';
            this._render();
        },

        openList() {
            const shops = this.getAll();
            const modal = document.getElementById('cinemaworld-modal');

            const savedGuide = this._lastShopGuide || '';

            const generatorHTML = `
                <div class="cw-shop-generator">
                    <div class="cw-shop-generator-title">🤖 AI 生成商店</div>
                    <div class="cw-shop-generator-hint">
                        描述你想要的商店（可选）。留空则由 AI 根据当前场景自由发挥。
                    </div>
                    <textarea class="cinemaworld-textarea" id="cw-shop-guide-input"
                        placeholder="例如：&#10;- 一个卖军火的黑市商人&#10;- 深夜便利店的自动贩卖机&#10;- 一个神秘的炼金术士摊位，只收金币&#10;- 战后的物资交换站，以物易物"
                        style="min-height:80px;font-size:13px;">${savedGuide}</textarea>
                    <div style="text-align:center;margin-top:8px;">
                        <button class="cinemaworld-button primary"
                            onclick="ShopManager.generateAndOpen()">➕ 生成商店</button>
                    </div>
                </div>`;

            if (shops.length === 0) {
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">🏪 商店列表</div>
                    ${generatorHTML}
                    <div style="text-align:center;padding:30px 20px;color:#888;">
                        <div style="font-size:40px;margin-bottom:15px;">🏪</div>
                        <div>还没有遇到过任何商店</div>
                    </div>
                    <div style="text-align:center;margin-top:15px;">
                        <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                    </div>`;
                modal.className = 'active';
                return;
            }

            let html = `<div class="cinemaworld-modal-title">🏪 商店列表</div>
                ${generatorHTML}
                <div style="display:grid;gap:10px;">`;
            for (const s of shops) {
                html += `
                    <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);
                            border-radius:10px;padding:14px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;
                                margin-bottom:8px;">
                            <div style="font-size:15px;font-weight:bold;color:#fff;flex:1;min-width:0;
                                    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;"
                                    onclick="ShopManager.open('${s.id}')">
                                ${s.icon || '🏪'} ${s.name}
                            </div>
                            <div style="font-size:11px;color:#888;flex-shrink:0;margin-left:8px;">
                                ${s.stock?.length || 0} 件商品
                            </div>
                        </div>
                        <div style="font-size:12px;color:#aaa;margin-bottom:10px;line-height:1.5;">
                            ${s.description || '无描述'}
                        </div>
                        <div style="display:flex;gap:6px;">
                            <button class="cinemaworld-button primary"
                                style="flex:1;margin:0;font-size:12px;padding:6px;"
                                onclick="ShopManager.open('${s.id}')">进入</button>
                            <button class="cinemaworld-button"
                                style="margin:0;font-size:12px;padding:6px 10px;"
                                onclick="ShopManager._confirmRegenerate('${s.id}')"
                                title="重新生成">🔄</button>
                            <button class="cinemaworld-button"
                                style="margin:0;font-size:12px;padding:6px 10px;color:#d87d7d;
                                border-color:rgba(216,125,125,.4);"
                                onclick="ShopManager._confirmDelete('${s.id}')"
                                title="删除">🗑️</button>
                        </div>
                    </div>`;
            }
            html += `</div>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;

            modal.innerHTML = html;
            modal.className = 'active';
            this._injectStyles();
        },

        async _confirmDelete(shopId) {
            const shop = this.ensureStore()[shopId];
            if (!shop) return;
            if (!confirm(`确定删除商店「${shop.name}」吗？`)) return;
            this.deleteShop(shopId);
            window.UIManager.showText(`已删除「${shop.name}」`, 1500);
            this.openList();
        },

        async _confirmRegenerate(shopId) {
            const shop = this.ensureStore()[shopId];
            if (!shop) return;
            if (!confirm(`确定重新生成「${shop.name}」吗？\n\n当前的库存和价格会被覆盖。`)) return;

            window.UIManager.showText(`正在重新生成「${shop.name}」...`, 800);

            const newShop = await this.regenerateShop(shopId);
            if (!newShop) {
                window.UIManager.showText('生成失败', 2000);
                return;
            }

            this.openList();
            window.UIManager.showText(`已重新生成「${newShop.name}」`, 1500);
        },

        async generateAndOpen() {
            const guideInput = document.getElementById('cw-shop-guide-input');
            const guide = guideInput?.value.trim() || '';

            this._lastShopGuide = guide;

            await window.UIManager.showText('正在生成商店...', 1000);
            const shop = await this.generateShop(guide);
            if (!shop) {
                window.UIManager.showText('生成失败', 2000);
                return;
            }
            window.UIManager.showText(`遇到了【${shop.name}】`, 1500);
            this.open(shop.id);
        },

        _render() {
            const shop = this._currentShop;
            if (!shop) return;
            const modal = document.getElementById('cinemaworld-modal');
            const { key: currencyKey, value: playerGold } = this.getPlayerCurrency(shop);

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">${shop.icon || '🏪'} ${shop.name}</div>

                <div style="text-align:center;color:#aaa;font-size:12px;line-height:1.5;
                     margin-bottom:10px;padding:8px;background:rgba(0,0,0,.2);border-radius:8px;">
                    ${shop.description || '一家普通的商店'}
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;
                     margin-bottom:12px;padding:10px 14px;background:rgba(255,215,100,.1);
                     border:1px solid rgba(255,215,100,.3);border-radius:8px;">
                    <div style="font-size:13px;color:#ffcf80;">
                        💰 你的${currencyKey || '货币'}：<strong>${playerGold}</strong>
                    </div>
                    <div style="font-size:12px;color:#888;">
                        货币单位：${shop.currency || currencyKey || '—'}
                    </div>
                </div>

                <div style="display:flex;gap:6px;margin-bottom:12px;">
                    <button class="cinemaworld-button ${this._currentView === 'buy' ? 'primary' : ''}"
                        style="flex:1;margin:0;"
                        onclick="ShopManager._switchView('buy')">🛒 购买</button>
                    <button class="cinemaworld-button ${this._currentView === 'sell' ? 'primary' : ''}"
                        style="flex:1;margin:0;"
                        onclick="ShopManager._switchView('sell')">💱 卖出</button>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div class="cw-shop-column">
                        <div class="cw-shop-column-title">🏪 商店库存</div>
                        <div class="cw-shop-grid">
                            ${this._renderStockGrid(shop)}
                        </div>
                    </div>
                    <div class="cw-shop-column">
                        <div class="cw-shop-column-title">🎒 你的背包</div>
                        <div class="cw-shop-grid">
                            ${this._renderPlayerInvGrid(shop)}
                        </div>
                    </div>
                </div>

                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button" onclick="ShopManager.openList()">🏪 商店列表</button>
                    <button class="cinemaworld-button" 
                        onclick="ShopManager._confirmRegenerate('${shop.id}')">🔄 重新生成</button>
                    <button class="cinemaworld-button" style="color:#d87d7d;border-color:rgba(216,125,125,.4);"
                        onclick="ShopManager._confirmDeleteAndClose('${shop.id}')">🗑️ 删除</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>
            `;
            modal.className = 'active';

            this._injectStyles();
        },

        _renderPlayerInvGrid(shop) {
            const inv = PlayerStateManager.player.inventory || [];
            const SLOT_COUNT = 24;
            const shopCurrency = shop.currency || '金币';

            let html = '';
            for (let i = 0; i < SLOT_COUNT; i++) {
                const item = inv[i];
                if (!item) {
                    html += `<div class="cw-shop-slot empty"></div>`;
                    continue;
                }

                const rawItemCurrency = this.getItemCurrency(item);
                const itemCurrency = this.normalizeCurrency(rawItemCurrency, shop);
                const normalizedShopCurrency = this.normalizeCurrency(shopCurrency, shop);
                const currencyMismatch = itemCurrency && normalizedShopCurrency && itemCurrency !== normalizedShopCurrency;

                const stockIndex = shop.stock.findIndex(s => s.name === item.name);
                let sellPrice = null;
                if (!currencyMismatch) {
                    if (stockIndex > -1) {
                        const s = shop.stock[stockIndex];
                        sellPrice = s.sellPrice ?? Math.round((s.buyPrice || 0) * 0.4);
                    } else if (shop.buyAnything) {
                        sellPrice = this.getItemSellPrice(item, shop);
                    }
                }

                const countBadge = item.count > 1
                    ? `<div class="cw-shop-slot-count">${item.count}</div>` : '';

                let priceHTML;
                if (currencyMismatch) {
                    priceHTML = `<div class="cw-shop-slot-price" style="color:#d87d7d;">币种不符</div>`;
                } else if (sellPrice !== null) {
                    priceHTML = `<div class="cw-shop-slot-price">${sellPrice}</div>`;
                } else {
                    priceHTML = `<div class="cw-shop-slot-price" style="color:#555;">不收</div>`;
                }

                const disabled = currencyMismatch || sellPrice === null;

                html += `
                    <div class="cw-shop-slot ${disabled ? 'disabled' : ''}"
                         onclick="ShopManager._openSellDialog(${i})"
                         title="${item.name}${currencyMismatch ? `（币种：${itemCurrency}）` : ''}">
                        <div class="cw-shop-slot-icon">${item.icon || '📦'}</div>
                        ${countBadge}
                        ${priceHTML}
                    </div>`;
            }
            return html;
        },

        _renderStockGrid(shop) {
            if (!shop.stock || shop.stock.length === 0) {
                return `<div class="cw-shop-grid-empty">暂无商品</div>`;
            }

            const { value: playerGold } = this.getPlayerCurrency(shop);
            const SLOT_COUNT = 24;

            let html = '';
            for (let i = 0; i < SLOT_COUNT; i++) {
                const item = shop.stock[i];
                if (!item) {
                    html += `<div class="cw-shop-slot empty"></div>`;
                    continue;
                }

                const buyPrice = item.buyPrice || 0;
                const canAfford = playerGold >= buyPrice;
                const countBadge = item.count > 1
                    ? `<div class="cw-shop-slot-count">${item.count}</div>` : '';

                html += `
                    <div class="cw-shop-slot ${canAfford ? '' : 'disabled'}"
                         onclick="ShopManager._openBuyDialog(${i})"
                         title="${item.name}">
                        <div class="cw-shop-slot-icon">${item.icon || '📦'}</div>
                        ${countBadge}
                        <div class="cw-shop-slot-price ${canAfford ? '' : 'expensive'}">
                            ${buyPrice}
                        </div>
                    </div>`;
            }
            return html;
        },

        async _confirmDeleteAndClose(shopId) {
            const shop = this.ensureStore()[shopId];
            if (!shop) return;
            if (!confirm(`确定删除商店「${shop.name}」吗？`)) return;
            this.deleteShop(shopId);
            window.UIManager.showText(`已删除「${shop.name}」`, 1500);
            this.openList();
        },

        _switchView(view) {
            this._currentView = view;
            this._render();
        },

        _openBuyDialog(stockIndex) {
            const shop = this._currentShop;
            const item = shop.stock[stockIndex];
            if (!item) return;
        
            const unitPrice = item.buyPrice || 0;
            const { key: currencyKey, value: playerGold } = this.getPlayerCurrency(shop);
        
            // ★ 修复：单价为 0（免费）时，不受货币限制，直接按库存算
            //   单价 > 0 时，按 "玩家货币 ÷ 单价" 计算可购买数
            let affordable;
            if (unitPrice <= 0) {
                affordable = item.count;
            } else {
                affordable = Math.floor(playerGold / unitPrice);
            }
        
            const maxCount = Math.max(1, Math.min(item.count, affordable));

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🛒 购买 ${item.name}</div>
                <div style="display:flex;gap:12px;padding:12px;background:rgba(0,0,0,.2);
                    border-radius:10px;margin-bottom:12px;">
                    <div style="font-size:40px;flex-shrink:0;">${item.icon || '📦'}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:15px;font-weight:bold;color:#fff;margin-bottom:4px;">
                            ${item.name}
                        </div>
                        <div style="font-size:12px;color:#aaa;line-height:1.5;">
                            ${item.description || '无描述'}
                        </div>
                    </div>
                </div>

                ${InventoryManager.renderItemFieldsHTML(item, {
                    hideKeys: ['买价', '卖价', '库存'],
                }) ? `
                    <div style="padding:10px 12px;background:rgba(255,255,255,.03);
                        border-radius:8px;margin-bottom:12px;">
                        <div style="font-size:11px;color:#888;font-weight:600;
                            margin-bottom:6px;letter-spacing:.5px;">📋 属性</div>
                        ${InventoryManager.renderItemFieldsHTML(item, { hideKeys: ['买价', '卖价', '库存'] })}
                    </div>
                ` : ''}

                <div style="display:flex;justify-content:space-between;padding:8px 0;
                     border-bottom:1px solid rgba(255,255,255,.08);font-size:13px;">
                    <span style="color:#aaa;">单价</span>
                    <span style="color:#ffcf80;">💰 ${unitPrice}</span>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;
                     border-bottom:1px solid rgba(255,255,255,.08);font-size:13px;">
                    <span style="color:#aaa;">你有</span>
                    <span style="color:#fff;">💰 ${playerGold} ${currencyKey || '—'}</span>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;
                     border-bottom:1px solid rgba(255,255,255,.08);font-size:13px;">
                    <span style="color:#aaa;">库存</span>
                    <span style="color:#fff;">${item.count}</span>
                </div>

                <div style="margin-top:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:6px;">
                        购买数量（最多 ${maxCount}）：
                    </div>
                    <input type="number" class="cinemaworld-textarea" id="cw-shop-buy-count"
                        value="1" min="1" max="${maxCount}"
                        style="min-height:auto;padding:10px;font-size:15px;text-align:center;">
                </div>

                <div style="text-align:center;margin-top:18px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary"
                        onclick="ShopManager._confirmBuy(${stockIndex})">✅ 确认购买</button>
                    <button class="cinemaworld-button"
                        onclick="ShopManager._render()">取消</button>
                </div>
            `;
            modal.className = 'active';
        },

        _confirmBuy(stockIndex) {
            const shop = this._currentShop;
            const input = document.getElementById('cw-shop-buy-count');
            const count = Math.max(1, parseInt(input?.value) || 1);

            const result = this.buy(shop, stockIndex, count);
            if (!result.ok) {
                window.UIManager.showText(`❌ ${result.reason}`, 2500);
                return;
            }

            window.UIManager.showText(
                `✅ 购买 ${result.itemName} ×${result.count}\n花费 ${result.total} ${result.currency}`,
                2500
            );
            this._render();
        },

        _openSellDialog(invIndex) {
            const shop = this._currentShop;
            const player = PlayerStateManager.player;
            const item = player.inventory[invIndex];
            if (!item) return;

            const rawItemCurrency = this.getItemCurrency(item);
            const rawShopCurrency = shop.currency || '金币';
            const itemCurrency = this.normalizeCurrency(rawItemCurrency, shop);
            const shopCurrency = this.normalizeCurrency(rawShopCurrency, shop);
            if (itemCurrency && shopCurrency && itemCurrency !== shopCurrency) {
                window.UIManager.showText(
                    `这家店只收「${rawShopCurrency}」计价的物品，\n这个物品是「${rawItemCurrency}」计价的`,
                    3000
                );
                return;
            }

            const stockIndex = shop.stock.findIndex(s => s.name === item.name);

            if (stockIndex === -1 && !shop.buyAnything) {
                window.UIManager.showText('这家店不收这类物品', 2000);
                return;
            }

            let unitPrice;
            if (stockIndex > -1) {
                const s = shop.stock[stockIndex];
                unitPrice = s.sellPrice
                    ?? Math.round((s.buyPrice || 0) * (shop.sellMultiplier ?? 0.4));
            } else {
                unitPrice = this.getItemSellPrice(item, shop);
            }

            const maxCount = item.count || 1;
            const { key: currencyKey } = this.getPlayerCurrency(shop);

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">💱 卖出 ${item.name}</div>
                <div style="display:flex;gap:12px;padding:12px;background:rgba(0,0,0,.2);
                    border-radius:10px;margin-bottom:12px;">
                    <div style="font-size:40px;flex-shrink:0;">${item.icon || '📦'}</div>
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:15px;font-weight:bold;color:#fff;margin-bottom:4px;">
                            ${item.name}
                        </div>
                        <div style="font-size:12px;color:#aaa;line-height:1.5;">
                            ${item.description || '无描述'}
                        </div>
                    </div>
                </div>

                ${InventoryManager.renderItemFieldsHTML(item, {
                    hideKeys: ['买价', '卖价', '库存'],
                }) ? `
                    <div style="padding:10px 12px;background:rgba(255,255,255,.03);
                        border-radius:8px;margin-bottom:12px;">
                        <div style="font-size:11px;color:#888;font-weight:600;
                            margin-bottom:6px;letter-spacing:.5px;">📋 属性</div>
                        ${InventoryManager.renderItemFieldsHTML(item, { hideKeys: ['买价', '卖价', '库存'] })}
                    </div>
                ` : ''}

                <div style="display:flex;justify-content:space-between;padding:8px 0;
                     border-bottom:1px solid rgba(255,255,255,.08);font-size:13px;">
                    <span style="color:#aaa;">回收价</span>
                    <span style="color:#ffcf80;">💰 ${unitPrice}</span>
                </div>
                <div style="display:flex;justify-content:space-between;padding:8px 0;
                     border-bottom:1px solid rgba(255,255,255,.08);font-size:13px;">
                    <span style="color:#aaa;">你有</span>
                    <span style="color:#fff;">${item.count} 件</span>
                </div>

                <div style="margin-top:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:6px;">
                        卖出数量（最多 ${maxCount}）：
                    </div>
                    <input type="number" class="cinemaworld-textarea" id="cw-shop-sell-count"
                        value="1" min="1" max="${maxCount}"
                        style="min-height:auto;padding:10px;font-size:15px;text-align:center;">
                </div>

                <div style="text-align:center;margin-top:18px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary"
                        onclick="ShopManager._confirmSell(${invIndex})">✅ 确认卖出</button>
                    <button class="cinemaworld-button"
                        onclick="ShopManager._render()">取消</button>
                </div>
            `;
            modal.className = 'active';
        },

        _confirmSell(invIndex) {
            const shop = this._currentShop;
            const input = document.getElementById('cw-shop-sell-count');
            const count = Math.max(1, parseInt(input?.value) || 1);

            const result = this.sell(shop, invIndex, count);
            if (!result.ok) {
                window.UIManager.showText(`❌ ${result.reason}`, 2500);
                return;
            }

            window.UIManager.showText(
                `✅ 卖出 ${result.itemName} ×${result.count}\n获得 ${result.total}`,
                2500
            );
            this._render();
        },

        _injectStyles() {
            // ★ CSS 已移至 style.css
            if (window.CinemaWorldCSS) window.CinemaWorldCSS.ensure();
        },
    };

    // ==================== 挂载到 window ====================
    window.EffectSystem = EffectSystem;
    window.CharacterInteractionManager = CharacterInteractionManager;
    window.SceneCharacterBrowserManager = SceneCharacterBrowserManager;
    window.SceneItemBrowserManager = SceneItemBrowserManager;
    window.EncounterManager = EncounterManager;
    window.InventoryManager = InventoryManager;
    window.ShopManager = ShopManager;

    console.log('[CinemaWorld] interact.js 已加载');
})();