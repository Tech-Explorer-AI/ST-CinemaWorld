// ============================================================
// CinemaWorld · player.js
// 玩家状态 / 装备 / 派生属性 / 标签效果
// 依赖：core.js, world.js（SpriteManager）
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const DiceEngine = window.DiceEngine;
    const SpriteManager = window.SpriteManager;

    // ==================== 玩家状态管理器 ====================
    const PlayerStateManager = {
        player: {
            name: '主人公',
            profile: '',
            statusBars: [],
            attributes: {},
            inventory: [],
            inventorySlots: 40,
            tags: [],
            extraStats: { _order: [], _raw: '' },   // ★ 万能键
            nameCustomized: false,
            equipment: {
                slots: new Array(6).fill(null),   // 定长数组，初始 6 格
                bonuses: {},                       // 缓存：所有装备的属性加成汇总
            },
        },
        displayedBars: [0, 1],

        // ★ 新增：同步真实用户名
        syncPlayerName() {
            if (this.player.nameCustomized) return;
            const realName = CinemaWorld.currentUserName;
            if (realName && realName !== this.player.name) {
                this.player.name = realName;
                this.refreshAvatarArea();
            }
        },

        init() {
            this.createAvatarArea();
            this.syncPlayerName();  // ★
        },

        createAvatarArea() {
            if (document.getElementById('cinemaworld-avatar-area')) return;
            const container = document.getElementById('cinemaworld-container');
            const el = document.createElement('div');
            el.id = 'cinemaworld-avatar-area';
            el.innerHTML = this.generateAvatarHTML();
            container.appendChild(el);
            this.addAvatarStyles();
        },

        generateAvatarHTML() {
            const bars = this.getDisplayedBars();
            let barsHTML = bars.map(b => this.generateBarHTML(b)).join('');
            if (!barsHTML) {
                barsHTML = `<div style="font-size:11px;color:#666;text-align:center;padding:5px;">暂无状态</div>`;
            }

            // ★ 玩家头像
            const avatarUrl = SpriteManager.playerAvatar;
            let avatarContent;
            if (avatarUrl) {
                avatarContent = `<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="player">`;
            } else {
                avatarContent = `<span class="cinemaworld-avatar-text">${this.player.name.charAt(0)}</span>`;
                // 异步加载，加载完刷新
                SpriteManager.getPlayerAvatar().then(url => {
                    if (url) this.refreshAvatarArea();
                });
            }

            return `
                <div class="cinemaworld-avatar" onclick="PlayerStateManager.openPlayerModal()" title="点击查看玩家信息">
                    <div class="cinemaworld-avatar-circle">
                        ${avatarContent}
                    </div>
                    <div class="cinemaworld-avatar-info">
                        <div class="cinemaworld-avatar-name">${this.player.name}</div>
                        <div class="cinemaworld-avatar-bars">${barsHTML}</div>
                    </div>
                </div>`;
        },

        generateBarHTML(bar) {
            if (!bar) return '';
            const pct = bar.max > 0 ? Math.min(100, (bar.current / bar.max) * 100) : 0;
            const color = this.getBarColor(bar);
            const isLow = pct < 30;
            return `
                <div class="cinemaworld-bar-container" title="${bar.icon || ''} ${bar.key}: ${bar.current}/${bar.max}${bar.note ? ' (' + bar.note + ')' : ''}">
                    <div class="cinemaworld-bar-label">
                        <span>${bar.icon || ''} ${bar.key}</span>
                        <span class="cinemaworld-bar-value">${bar.current}/${bar.max}</span>
                    </div>
                    <div class="cinemaworld-bar-track">
                        <div class="cinemaworld-bar-fill" style="width:${pct}%;background:${color};${isLow ? 'animation:pulse 1.5s infinite;' : ''}"></div>
                    </div>
                </div>`;
        },

        getBarColor(bar) {
            const k = (bar.key || '').toLowerCase();
            const icon = bar.icon || '';
            if (k.includes('体力') || k.includes('生命') || k.includes('hp') || icon === '❤️')
                return 'linear-gradient(90deg,#ff6b6b,#ff8e8e)';
            if (k.includes('理智') || k.includes('精神') || k.includes('mp') || icon === '🧠')
                return 'linear-gradient(90deg,#6b9fff,#8eb8ff)';
            if (k.includes('魔力') || k.includes('法力') || k.includes('魔法'))
                return 'linear-gradient(90deg,#a96bff,#c48eff)';
            if (k.includes('宿命') || k.includes('命运') || icon === '🌑')
                return 'linear-gradient(90deg,#4a4a5a,#6a6a7a)';
            if (k.includes('混乱') || k.includes('堕落') || icon === '🌀')
                return 'linear-gradient(90deg,#ff6b9d,#ff8eb8)';
            if (k.includes('经验') || k.includes('exp'))
                return 'linear-gradient(90deg,#ffd76b,#ffe58e)';
            return 'linear-gradient(90deg,#7dd87d,#9ee89e)';
        },

        getDisplayedBars() {
            // ★ 直接取 statusBars 的前 2 个，顺序由 statusBars 本身决定
            return (this.player.statusBars || []).slice(0, 2);
        },

        // ★ 格式化玩家信息给 AI 用（场景行动/交互等复用）
        formatForPrompt() {
            let text = '【玩家设定】\n';
            text += `名字：${this.player.name || '主人公'}\n`;
            if (this.player.profile) {
                text += this.player.profile + '\n';
            } else {
                text += '（无特别设定）\n';
            }

            const bars = this.player.statusBars || [];
            if (bars.length > 0) {
                text += '\n【玩家状态】\n';
                bars.forEach(b => {
                    text += `${b.icon || ''} ${b.key}: ${b.current}/${b.max}${b.note ? ' (' + b.note + ')' : ''}\n`;
                });
            }

            // ★ 属性（带描述 + 装备加成）
            const attrs = this.player.attributes || {};
            const attrKeys = Object.keys(attrs);
            const bonuses = this.player.equipment?.bonuses || {};

            if (attrKeys.length > 0) {
                text += '\n【玩家属性】\n';
                for (const key of attrKeys) {
                    const attr = attrs[key];
                    const val = typeof attr === 'object' ? attr.value : attr;
                    const desc = typeof attr === 'object' ? attr.description : '';
                    const icon = typeof attr === 'object' ? attr.icon : '';
                    const bonus = bonuses[key] || 0;

                    text += `${icon || ''} ${key}: ${val}`;
                    if (bonus !== 0) {
                        const sign = bonus > 0 ? '+' : '';
                        const display = Math.abs(bonus) < 1 && bonus !== 0
                            ? `${sign}${(bonus * 100).toFixed(0)}%`
                            : `${sign}${bonus}`;
                        text += `（装备 ${display}）`;
                    }
                    if (desc) text += `（${desc}）`;
                    text += '\n';
                }
            }

            const inv = this.player.inventory || [];
            if (inv.length > 0) {
                text += '\n【背包】\n';
                inv.forEach(i => {
                    text += `${i.icon || '📦'} ${i.name} × ${i.count}\n`;
                });
            }

            // ★ 装备栏
            const eqSlots = this.player.equipment?.slots || [];
            const equippedItems = eqSlots.filter(Boolean);
            if (equippedItems.length > 0) {
                text += '\n【装备栏】\n';
                const byName = {};
                for (const item of equippedItems) {
                    if (!byName[item.name]) byName[item.name] = { item, count: 0 };
                    byName[item.name].count++;
                }
                for (const [name, { item, count }] of Object.entries(byName)) {
                    text += `${item.icon || '⚔️'} ${name}`;
                    if (count > 1) text += ` ×${count}`;
                    const itemBonuses = this._extractItemBonuses(item);
                    if (itemBonuses) text += `（${itemBonuses}）`;
                    text += '\n';
                }
            }

            // ★ 装备加成汇总
            if (Object.keys(bonuses).length > 0) {
                text += '\n【装备加成】\n';
                for (const [k, v] of Object.entries(bonuses)) {
                    const sign = v > 0 ? '+' : '';
                    const display = Math.abs(v) < 1 && v !== 0
                        ? `${sign}${(v * 100).toFixed(0)}%`
                        : `${sign}${v}`;
                    text += `${k}: ${display}\n`;
                }
            }

            const tags = this.player.tags || [];
            if (tags.length > 0) {
                const tagText = tags.map(t => {
                    if (typeof t === 'string') return t;
                    let s = t.name;
                    if (t.duration) s += `(${t.duration}回合)`;
                    return s;
                }).join('、');
                text += `\n【状态】${tagText}\n`;
            }

            // ★ 额外数据
            const extra = this.player.extraStats;
            if (extra && extra._order && extra._order.length > 0) {
                const lines = extra._order
                    .filter(k => extra[k] !== undefined && extra[k] !== '')
                    .map(k => `${k}: ${extra[k]}`);
                if (lines.length > 0) {
                    text += `\n【额外数据】\n${lines.join('\n')}\n`;
                }
            }

            // ★ 派生属性
            const derived = this.player.derivedStats?.computed;
            if (derived && Object.keys(derived).length > 0) {
                text += '\n【派生属性】\n';
                for (const [k, v] of Object.entries(derived)) {
                    text += `${k}: ${v.current}${v.max !== undefined ? '/' + v.max : ''}\n`;
                }
            }

            return text;
        },

        _extractItemBonuses(item) {
            if (!item?.fields) return '';
            const parts = [];
            for (const [rawKey, value] of Object.entries(item.fields)) {
                const key = EquipmentManager._normalizeKey(rawKey);
                if (key === null) continue;
                if (EquipmentManager._isNonBonusField(key)) continue;
                const num = EquipmentManager._parseBonus(value);
                if (num === null) continue;
                const sign = num > 0 ? '+' : '';
                const display = Math.abs(num) < 1 && num !== 0
                    ? `${sign}${(num * 100).toFixed(0)}%`
                    : `${sign}${num}`;
                parts.push(`${key}${display}`);
            }
            return parts.join('，');
        },

        addAvatarStyles() {
            // ★ CSS 已移至 style.css
            if (window.CinemaWorldCSS) window.CinemaWorldCSS.ensure();
        },

        // 解析玩家状态文本
        parsePlayerState(text) {
            const result = { statusBars: [], attributes: {}, inventory: [], tags: [], extraStats: {} };
            const lines = text.split('\n');
            let section = 'general';

            // ★ 判断一行是否"像物品行"
            const isItemLine = (line) => {
                if (/^[-•]?\s*【(.+?)】\s*[：:]\s*\[.+?\]\s*$/.test(line)) return true;
                if (/^[-•]?\s*.+?[：:]\s*\d+\s*$/.test(line)) return true;
                return false;
            };

            for (let raw of lines) {
                const line = raw.trim();
                if (!line) continue;

                // ---- section 切换 ----
                if (line.includes('人物状态') || line.includes('状态栏')) { section = 'status'; continue; }
                if (line.includes('角色属性') || line.includes('属性')) { section = 'attributes'; continue; }
                if (line.includes('物品栏')) { section = 'inventory'; continue; }
                if (line === '状态' || line === '【状态】') { section = 'tags'; continue; }
                if (line.includes('额外数据') || line.includes('额外状态') || line.includes('其他数据')) {
                    section = 'extra';
                    continue;
                }
                // ---- 检测 section 结束 ----
                if (section === 'inventory' && !isItemLine(line)) {
                    section = 'general';
                }

                // ---- 新格式物品行 ----
                if (section === 'inventory') {
                    const itemLineMatch = line.match(
                        /^[-•]?\s*【(.+?)】\s*[：:]\s*(?:[\[【](.+?)[\]】]|(.+?\|.+?))\s*$/
                    );
                    if (itemLineMatch) {
                        const cleaned = line.replace(/^[-•]\s*/, '');
                        const parsedItem = WorldManager.parseItemLine(cleaned);
                        if (parsedItem && parsedItem.name) {
                            let itemName = parsedItem.name;
                            let itemIcon = parsedItem.icon;
                            const nameEmoji = itemName.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
                            if (nameEmoji) {
                                itemName = itemName.replace(nameEmoji[0], '').trim();
                                if (!parsedItem.icon || parsedItem.icon === '📦') {
                                    itemIcon = nameEmoji[0];
                                }
                            }
                            result.inventory.push({
                                name: itemName,
                                count: parsedItem.count || 1,
                                description: parsedItem.description || '',
                                status: parsedItem.status || '',
                                effect: parsedItem.effect || '',
                                stackable: parsedItem.stackable,
                                maxStack: parsedItem.maxStack,
                                icon: itemIcon || '📦',
                                interactions: parsedItem.interactions || [],
                                type: parsedItem.type || 'entity',
                            });
                        }
                        continue;
                    }
                    // 旧格式：物品名：数量
                    const oldItem = line.match(/^[-•]?\s*(.+?)[：:]\s*(\d+)\s*$/);
                    if (oldItem) {
                        result.inventory.push({
                            name: oldItem[1].trim(),
                            count: parseInt(oldItem[2]) || 1,
                            icon: '📦',
                            type: 'entity',
                            fields: {},
                        });
                        continue;
                    }
                    continue;
                }

                // ---- tags 整行 ----
                if (section === 'tags') {
                    if (/^[*#\-\s]/.test(line) && !/^[-•]\s*\S/.test(line)) {
                        section = 'general';
                        continue;
                    }
                    const raw = line.replace(/^[-•]\s*/, '');
                    // ★ 拦截 "[object Object]" 和 "object Object" 这类被 String 化的对象
                    if (/^\[?\s*object\s+Object\s*\]?$/i.test(raw)) {
                        console.warn('[CinemaWorld] 跳过被对象污染的 tag 行:', raw);
                        continue;
                    }
                    const name = raw.replace(/[【】\[\]]/g, '').trim();
                    if (!name) continue;
                    const existing = (this.player.tags || []).find(t =>
                        (typeof t === 'string' ? t : t?.name) === name
                    );
                    if (existing && typeof existing === 'object') {
                        result.tags.push(existing);
                    } else {
                        result.tags.push({ name, effect: null, duration: null });
                    }
                    continue;
                }

                // ---- 数值条 / 属性 / 通用 kv ----
                const kv = line.match(/^(.+?)[:：]\s*(.+)$/);
                if (!kv) continue;
                const rawKey = kv[1].trim();
                const value = kv[2].trim();

                const iconMatch = rawKey.match(/^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]+)\s*(.+)$/u);
                const icon = iconMatch ? iconMatch[1] : '';
                const key = iconMatch ? iconMatch[2].trim() : rawKey;

                // 支持：100/100 或 100/100 = 力量 × 50 + 200
                const bar = value.match(/^(\d+)\s*\/\s*(\d+)\s*(?:=\s*(.+?))?\s*(?:[（(](.+)[)）])?$/);
                if (bar) {
                    const note = bar[4]?.trim() || '';
                    const entry = {
                        key, icon,
                        current: parseInt(bar[1]),
                        base: parseInt(bar[2]),
                        max: parseInt(bar[2]),
                        derivedExpr: bar[3]?.trim() || null,
                        note,
                        trigger: null,
                    };

                    // ★ 解析触发标记
                    const fullMatch = note.match(/(?:满时|满了|满→|满:)\s*触发?\s*(.+)/);
                    if (fullMatch) {
                        entry.trigger = { on: 'full', event: fullMatch[1].trim() };
                    }
                    const emptyMatch = note.match(/(?:空时|空了|空→|空:)\s*触发?\s*(.+)/);
                    if (emptyMatch) {
                        entry.trigger = { on: 'empty', event: emptyMatch[1].trim() };
                    }

                    result.statusBars.push(entry);
                    continue;
                }

                // ★ 额外数据（万能键）
                if (section === 'extra') {
                    const clean = line.replace(/^[-•]\s*/, '').trim();
                    const kv2 = clean.match(/^(.+?)[:：]\s*(.+)$/);
                    if (kv2) {
                        result.extraStats[kv2[1].trim()] = kv2[2].trim();
                    }
                    continue;
                }
                if (section === 'attributes') {
                    const m = value.match(/^(\d+)\s*[｜|]\s*(.+)$/);
                    if (m) {
                        result.attributes[key] = {
                            icon,
                            value: parseInt(m[1]),
                            description: m[2].trim(),
                        };
                    } else {
                        const old = value.match(/^(\d+)\s*(?:[（(].*[)）])?$/);
                        if (old) {
                            result.attributes[key] = { icon, value: parseInt(old[1]), description: '' };
                        } else {
                            result.attributes[key] = { icon, value };
                        }
                    }
                }
            }
            return result;
        },

        updateFromText(text) {
            const parsed = this.parsePlayerState(text);
            this.player.statusBars = parsed.statusBars;
            this.player.attributes = parsed.attributes;

            // ★ 按名合并物品，避免覆盖已有图标/描述
            const oldInv = this.player.inventory || [];
            const newInv = parsed.inventory || [];
            const mergedMap = new Map();
            for (const oldItem of oldInv) {
                mergedMap.set(oldItem.name, { ...oldItem });
            }
            for (const newItem of newInv) {
                if (mergedMap.has(newItem.name)) {
                    const existing = mergedMap.get(newItem.name);
            
                    // ★ 图标：只有新解析出的不是默认值时才覆盖
                    if (newItem.icon && newItem.icon !== '📦') {
                        existing.icon = newItem.icon;
                    }
            
                    // ★ 其他字段：只在有值时覆盖
                    if (newItem.description) existing.description = newItem.description;
                    if (newItem.status)      existing.status = newItem.status;
                    if (newItem.effect)      existing.effect = newItem.effect;
                    if (newItem.type && newItem.type !== 'entity') existing.type = newItem.type;
            
                    if (newItem.stackable) existing.stackable = newItem.stackable;
                    if (newItem.maxStack)  existing.maxStack = newItem.maxStack;
            
                    // fields：合并而不是整体替换
                    if (newItem.fields && Object.keys(newItem.fields).length > 0) {
                        existing.fields = { ...(existing.fields || {}), ...newItem.fields };
                    }
            
                    // interactions：新解析的有内容才用新的
                    if (newItem.interactions?.length > 0) {
                        existing.interactions = newItem.interactions;
                    }
            
                    // count：玩家编辑时显式输入的数量优先
                    if (typeof newItem.count === 'number' && newItem.count > 0) {
                        existing.count = newItem.count;
                    }
                } else {
                    mergedMap.set(newItem.name, newItem);
                }
            }
            this.player.inventory = Array.from(mergedMap.values());

            // ★ 合并额外数据
            if (parsed.extraStats && Object.keys(parsed.extraStats).length > 0) {
                if (!this.player.extraStats || !Array.isArray(this.player.extraStats._order)) {
                    this.player.extraStats = { _order: [], _raw: '' };
                }
                for (const [k, v] of Object.entries(parsed.extraStats)) {
                    if (!this.player.extraStats._order.includes(k)) {
                        this.player.extraStats._order.push(k);
                    }
                    this.player.extraStats[k] = v;
                }
                this.player.extraStats._raw = this.player.extraStats._order
                    .map(k => `${k}:${this.player.extraStats[k]}`)
                    .join('|');
            }

            // ★ 按名字合并，保留旧 tag 的 effect/duration
            if (parsed.tags && parsed.tags.length) {
                const oldMap = new Map();
                for (const t of (this.player.tags || [])) {
                    const n = typeof t === 'string' ? t : t.name;
                    oldMap.set(n, t);
                }
                const merged = [];
                for (const t of parsed.tags) {
                    const n = typeof t === 'string' ? t : t.name;
                    if (oldMap.has(n)) {
                        const old = oldMap.get(n);
                        if (typeof old === 'object') {
                            merged.push({ ...old, name: n });
                        } else {
                            merged.push({ name: n, effect: null, duration: null });
                        }
                    } else {
                        merged.push(typeof t === 'object' ? t : { name: n, effect: null, duration: null });
                    }
                    oldMap.delete(n);
                }
                this.player.tags = merged;
            }

            this.refreshAvatarArea();
        },

        refreshAvatarArea() {
            const el = document.getElementById('cinemaworld-avatar-area');
            if (el) el.innerHTML = this.generateAvatarHTML();

            // ★ 如果玩家在场景立绘层里，也要刷
            if (typeof window.SpriteManager !== 'undefined' &&
                CinemaWorld.ui.currentLocation) {
                const scene = window.LocationModalManager?.currentLocation;
                const playerName = this.player.name;
                const inScene = scene?.sceneCharacters?.some(c => c.name === playerName);
                if (inScene) {
                    window.SpriteManager.notifySceneSpriteUpdate(playerName);
                }
            }
        },

        // ★ 手动重算派生属性（玩家主动点才跑）
        forceRecompute() {
            if (typeof DerivedStatsEngine === 'undefined') return;
            DerivedStatsEngine.syncFromRules(this.player);
            DerivedStatsEngine.recompute(this.player);
            this.refreshAvatarArea();
            this.openPlayerModal();
            if (window.SaveManager) window.SaveManager.save();
            UIManager.showText('已根据当前规则重算派生属性', 1500);
        },

        openPlayerModal() {
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = this.generatePlayerModalHTML();
            modal.className = 'active';
        },

        editName() {
            const currentName = this.player.name;
            const newName = prompt('输入新的名字：', currentName);
            if (newName === null) return;
            const trimmed = newName.trim();
            if (!trimmed) {
                alert('名字不能为空');
                return;
            }
            if (trimmed === currentName) return;

            this.player.name = trimmed;
            this.player.nameCustomized = true;
            CinemaWorld.currentUserName = trimmed;

            this.refreshAvatarArea();
            this.openPlayerModal();

            if (window.SaveManager) window.SaveManager.save();
        },

        generatePlayerModalHTML() {
            let html = `
            <div class="cinemaworld-modal-title" style="display:flex;align-items:center;justify-content:center;gap:10px;">
                <span>👤 ${this.player.name}</span>
                <button class="cinemaworld-button" 
                    style="font-size:12px;padding:4px 10px;margin:0;"
                    onclick="PlayerStateManager.editName()"
                    title="修改名字">✏️</button>
            </div>`;

            // ★ 角色设定
            if (this.player.profile) {
                html += `
                    <div style="margin-bottom:16px;padding:12px 14px;
                        background:rgba(120,150,255,.08);
                        border:1px solid rgba(120,150,255,.25);
                        border-radius:10px;">
                        <div style="font-size:12px;color:#7da8ff;margin-bottom:8px;
                            font-weight:600;letter-spacing:.5px;">🎭 角色设定</div>
                        <div style="font-size:13px;color:#ddd;line-height:1.7;
                            white-space:pre-wrap;">${this.player.profile}</div>
                    </div>`;
            }

            // 数值条
            if (this.player.statusBars.length > 0) {
                html += `<div style="margin-bottom:20px;">
                    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
                        <div style="font-size:14px;font-weight:bold;color:#aaa;">📊 人物状态</div>
                        <div style="font-size:11px;color:#666;">↑前 2 个显示在右上角</div>
                    </div>
                    <div style="display:grid;gap:10px;">`;

                this.player.statusBars.forEach((bar, i) => {
                    const pct = bar.max > 0 ? Math.min(100, (bar.current / bar.max) * 100) : 0;
                    const isDisplayed = i < 2;
                    const isFirst = i === 0;
                    const isLast = i === this.player.statusBars.length - 1;

                    html += `
                        <div style="background:rgba(255,255,255,.03);border-radius:10px;padding:12px;
                            border:1px solid ${isDisplayed ? 'rgba(120,150,255,.3)' : 'rgba(255,255,255,.05)'};
                            display:flex;align-items:center;gap:10px;">
                            <div style="flex:1;min-width:0;">
                                <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
                                    <span style="font-size:13px;color:#ddd;">
                                        ${bar.icon || ''} ${bar.key}
                                        ${isDisplayed
                                            ? `<span style="color:#7da8ff;font-size:10px;margin-left:6px;">[右上角 第${i + 1}位]</span>`
                                            : `<span style="color:#555;font-size:10px;margin-left:6px;">[不显示]</span>`}
                                    </span>
                                    <span style="font-size:13px;color:#aaa;font-family:monospace;">${bar.current}/${bar.max}</span>
                                </div>
                                <div style="height:8px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden;">
                                    <div style="width:${pct}%;height:100%;background:${this.getBarColor(bar)};border-radius:4px;"></div>
                                </div>
                                ${bar.note ? `<div style="font-size:11px;color:#888;margin-top:5px;font-style:italic;">${bar.note}</div>` : ''}
                            </div>
                            <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0;">
                                <button class="cinemaworld-button"
                                    style="padding:2px 8px;font-size:11px;margin:0;line-height:1.2;
                                        ${isFirst ? 'opacity:.25;pointer-events:none;' : ''}"
                                    onclick="event.stopPropagation(); PlayerStateManager.moveBarUp(${i})"
                                    title="上移">▲</button>
                                <button class="cinemaworld-button"
                                    style="padding:2px 8px;font-size:11px;margin:0;line-height:1.2;
                                        ${isLast ? 'opacity:.25;pointer-events:none;' : ''}"
                                    onclick="event.stopPropagation(); PlayerStateManager.moveBarDown(${i})"
                                    title="下移">▼</button>
                            </div>
                        </div>`;
                });
                html += `</div></div>`;
            }

            // 属性
            const attrKeys = Object.keys(this.player.attributes);
            if (attrKeys.length > 0) {
                html += `<div style="margin-bottom:20px;"><div style="font-size:14px;font-weight:bold;color:#aaa;margin-bottom:10px;">💪 角色属性</div><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">`;
                for (const key of attrKeys) {
                    const attr = this.player.attributes[key];
                    const val = typeof attr === 'object' ? attr.value : attr;
                    const icon = typeof attr === 'object' ? attr.icon : '';
                    const desc = typeof attr === 'object' ? (attr.description || '') : '';
                    html += `
                        <div style="background:rgba(255,255,255,.03);border-radius:8px;padding:10px 12px;
                            display:flex;flex-direction:column;gap:4px;">
                            <div style="display:flex;justify-content:space-between;align-items:baseline;">
                                <span style="font-size:13px;color:#ccc;">${icon || ''} ${key}</span>
                                <span style="font-size:16px;font-weight:bold;color:#fff;">${val}</span>
                            </div>
                            ${desc ? `<div style="font-size:11px;color:#888;line-height:1.5;
                                font-style:italic;">${desc}</div>` : ''}
                        </div>`;
                }
                html += `</div></div>`;
            }

            // ★ 派生属性
            const derived = this.player.derivedStats?.computed;
            if (derived && Object.keys(derived).length > 0) {
                html += `<div style="margin-bottom:20px;">
                    <div style="font-size:14px;font-weight:bold;color:#aaa;margin-bottom:10px;">⚔️ 派生属性</div>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">`;
                for (const [k, v] of Object.entries(derived)) {
                    const display = v.max !== undefined ? `${v.current}/${v.max}` : `${v.current}`;
                    html += `
                        <div style="background:rgba(255,255,255,.03);border-radius:8px;padding:10px;
                            display:flex;justify-content:space-between;align-items:center;">
                            <span style="font-size:13px;color:#ccc;">${k}</span>
                            <span style="font-size:14px;font-weight:bold;color:#ff9d4d;">${display}</span>
                        </div>`;
                }
                html += `</div></div>`;
            }

            // ★ 游戏规则入口
            if (RuleEngine?.rules?.raw) {
                html += `<div style="text-align:center;margin-bottom:15px;">
                    <button class="cinemaworld-button" onclick="RuleCreationManager.openEditor()">⚙️ 查看/编辑规则</button>
                </div>`;
            }

            // ★ 额外数据（万能键）
            const extra = this.player.extraStats;
            if (extra && extra._order && extra._order.length > 0) {
                const extraLines = extra._order
                    .filter(k => extra[k] !== undefined && extra[k] !== '')
                    .map(k => `
                        <div style="display:flex;justify-content:space-between;align-items:center;
                            padding:8px 12px;background:rgba(255,255,255,.03);border-radius:8px;">
                            <span style="font-size:13px;color:#ccc;">${k}</span>
                            <span style="font-size:14px;font-weight:bold;color:#ffd76b;">${extra[k]}</span>
                        </div>`);

                if (extraLines.length > 0) {
                    html += `<div style="margin-bottom:20px;">
                        <div style="font-size:14px;font-weight:bold;color:#aaa;margin-bottom:10px;">💰 额外数据</div>
                        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
                            ${extraLines.join('')}
                        </div>
                    </div>`;
                }
            }

            // ★ 状态（player.tags）
            const playerTags = this.player.tags || [];
            if (playerTags.length > 0) {
                html += `<div style="margin-bottom:20px;">
                    <div style="font-size:14px;font-weight:bold;color:#aaa;margin-bottom:10px;">✨ 状态</div>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">`;
                playerTags.forEach((tag, i) => {
                    const name = typeof tag === 'string' ? tag : tag.name;
                    const duration = typeof tag === 'object' && tag.duration
                        ? `<span style="color:#888;font-size:10px;margin-left:4px;">${tag.duration}回合</span>`
                        : '';
                    html += `<span style="display:inline-flex;align-items:center;gap:6px;
                        padding:5px 12px;background:rgba(120,150,255,.15);
                        border:1px solid rgba(120,150,255,.3);border-radius:14px;
                        font-size:12px;color:#9ab0ff;">
                        ${name}${duration}
                        <span onclick="PlayerStateManager.removeTag(${i})"
                            style="cursor:pointer;color:#d87d7d;font-weight:bold;"
                            title="移除">×</span>
                    </span>`;
                });
                html += `</div></div>`;
            }

            html += `
            <div style="margin-bottom:20px;text-align:center;display:flex;justify-content:center;gap:10px;">
                <button class="cinemaworld-button" onclick="InventoryManager.open()">🎒 打开背包</button>
                <button class="cinemaworld-button primary" onclick="PhoneUIManager.open()">📱 打开手机</button>
            </div>`;

            // ★ 重算按钮
            html += `
            <div style="margin-bottom:12px;text-align:center;">
                <button class="cinemaworld-button"
                    style="font-size:12px;padding:6px 14px;color:#ffcf80;border-color:rgba(255,207,128,.4);"
                    onclick="PlayerStateManager.forceRecompute()"
                    title="根据当前规则和装备重新计算派生属性">
                    🔄 重算派生属性
                </button>
            </div>`;

            html += `<div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                <button class="cinemaworld-button primary" onclick="PlayerStateManager.generatePlayerState()">🤖 AI生成玩家状态</button>
                <button class="cinemaworld-button" onclick="PlayerStateManager.openEditModal()">✏️ 编辑状态</button>
                <button class="cinemaworld-button" onclick="PlayerCreationManager.showCreationModal()">🎭 重新设定角色</button>
                <button class="cinemaworld-button" onclick="UIManager.closeModal()">✖ 关闭</button>
            </div>`;
            return html;
        },

        removeTag(index) {
            if (!this.player.tags) return;
            this.player.tags.splice(index, 1);
            this.openPlayerModal();
            if (window.SaveManager) window.SaveManager.save();
        },

        // ★ 上移数值条
        moveBarUp(index) {
            if (index <= 0) return;
            const bars = this.player.statusBars;
            [bars[index - 1], bars[index]] = [bars[index], bars[index - 1]];
            this.refreshAvatarArea();
            this.openPlayerModal();
            if (window.SaveManager) window.SaveManager.save();
        },

        // ★ 下移数值条
        moveBarDown(index) {
            const bars = this.player.statusBars;
            if (index >= bars.length - 1) return;
            [bars[index], bars[index + 1]] = [bars[index + 1], bars[index]];
            this.refreshAvatarArea();
            this.openPlayerModal();
            if (window.SaveManager) window.SaveManager.save();
        },

        async generatePlayerState() {
            const scene = window.LocationModalManager?.currentLocation || null;

            const worldCtx = [];
            if (CinemaWorld.worldState.name) {
                worldCtx.push(`世界名：${CinemaWorld.worldState.name}`);
            }
            const wh = CinemaWorld.worldState.worldHistory;
            if (wh?.summary) {
                worldCtx.push(`世界史：${wh.summary}`);
            }
            if (scene) {
                worldCtx.push(`当前场景：${scene.name}`);
                if (scene.description) worldCtx.push(`场景描述：${scene.description}`);
                if (scene.environment) worldCtx.push(`环境：${scene.environment}`);
                const envLine = window.WorldManager?.getEnvDataText?.(scene);
                if (envLine) worldCtx.push(`环境数据：${envLine}`);
            }

            await UIManager.showText('正在生成玩家状态...', 1000);

            const prompt = `请为玩家角色生成一个状态栏，使用以下格式：

【世界背景】
${worldCtx.length > 0 ? worldCtx.join('\n') : '（这是一个全新的世界，尚未定义具体世界观）'}

【人物状态】
 ❤️ 生命值：X/Y
 💛 体力：X/Y
 ⭐ 经验值：X/Y
（根据场景需要生成多个数值条，也可以放进来，用emoji图标开头）

【角色属性】
💪 力量：X|描述（例如力拔山兮气盖世啊，时不利兮雅不逝啊之类的，描述可以好玩一点）
🏃 敏捷：X|描述
🌟 等级：X|描述
（除以上外，生成多个属性，格式：图标 名称：数值|描述）

【物品栏】
【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
（生成 1-4 个物品）

【装备栏】
【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X]
（生成 0-2 个初始装备，符合玩家设定和世界观。没有就不写这一块）

注意：
1. 数值条格式必须是 "当前值/最大值"
2. 属性格式为 "数值|描述"，基本参考数值以普通人为10为基数
3. 物品必须严格按上面的格式，方括号内字段用 | 分隔
4. 可堆叠填"是"或"否"
5. 图标字段只填一个 emoji，不要文字
6. ★ 属性字段写法：键名:值，例如 攻击:+5|防御:+3|暴击:+10%
    - 属性字段写法：键名:值
    - 值必须是 "数字"、"±数字"、"数字%" 之一
    - ★ 数值条类字段（如体力、理智、经验）只写"上限加成"，
    直接写裸名即可，例如"体力:+50"表示体力上限+50
    - 不要写"体力回复 +50"这类当前值加成，装备系统不处理
    - ★ 系统会自动识别"体力上限"、"最大体力"等同义写法并归一化
    - 这些字段装备后会生效，直接叠加到玩家属性上
    - 非属性字段（类型、状态、图标等）不会生效，只是展示
7. 所有数值要符合当前世界状态和角色设定，数值要精确，不能有？，不明等等模糊的表述
`;

            const result = await window.generateFunctionalReply(prompt, 'player-state');
            if (result) {
                this.updateFromText(result);
                await UIManager.showText('玩家状态已更新', 2000);
                this.openPlayerModal();
            }
        },

        openEditModal() {
            const modal = document.getElementById('cinemaworld-modal');
            let text = '【人物状态】\n';
            this.player.statusBars.forEach(b => {
                text += `${b.icon || ''} ${b.key}：${b.current}/${b.max}${b.note ? ' (' + b.note + ')' : ''}\n`;
            });
            text += '\n【角色属性】\n';
            for (const [key, attr] of Object.entries(this.player.attributes)) {
                const v = typeof attr === 'object' ? attr.value : attr;
                const m = typeof attr === 'object' ? attr.modifier : '';
                const i = typeof attr === 'object' ? attr.icon : '';
                text += `${i || ''} ${key}：${v}${m ? ' (' + m + ')' : ''}\n`;
            }

            // ★ 物品栏
            text += '\n【物品栏】\n';
            this.player.inventory.forEach(item => {
                // ★ 图标写进名字里：【名字|图标】
                const namePart = item.icon
                    ? `${item.name}|${item.icon}`
                    : item.name;
            
                // ★ 字段用键:值，且用 fields 的真实内容重建
                const fieldParts = [];
            
                if (item.description) fieldParts.push(`描述:${item.description}`);
                if (item.status) fieldParts.push(`状态:${item.status}`);
                if (item.effect) fieldParts.push(`功能:${item.effect}`);
                if (item.type) fieldParts.push(`类型:${item.type}`);
            
                // fields 里的其他键
                for (const [k, v] of Object.entries(item.fields || {})) {
                    if (k.startsWith('_pos')) continue;   // 丢掉位置占位
                    if (['图标', 'icon'].includes(k)) continue;
                    if (['描述', '状态', '功能', '类型'].includes(k)) continue;   // 已处理
                    fieldParts.push(`${k}:${v}`);
                }
            
                if (item.stackable === true) fieldParts.push('可堆叠:是');
                else if (item.maxStack) fieldParts.push(`可堆叠:${item.maxStack}`);
            
                const fieldsText = fieldParts.length > 0 ? `[${fieldParts.join('|')}]` : '';
                text += `【${namePart}】：${item.description || ''}${fieldsText}\n`;
            });

            text += '\n【状态】\n';
            (this.player.tags || []).forEach(t => {
                const name = typeof t === 'string' ? t : t?.name;
                if (!name || typeof name !== 'string') return;   // ★ 跳过无 name 的
                text += `${name}\n`;                              // ★ 只写 name
            });

            // ★ 额外数据
            text += '\n【额外数据】\n';
            const extra = this.player.extraStats;
            if (extra && extra._order) {
                extra._order.forEach(k => {
                    if (extra[k] !== undefined && extra[k] !== '') {
                        text += `${k}: ${extra[k]}\n`;
                    }
                });
            }
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">✏️ 编辑玩家状态</div>
                <textarea class="cinemaworld-textarea" id="player-state-input" style="min-height:300px;">${text}</textarea>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button primary" onclick="PlayerStateManager.saveEdit()">保存</button>
                    <button class="cinemaworld-button" onclick="PlayerStateManager.openPlayerModal()">取消</button>
                </div>`;
        },

        saveEdit() {
            const text = document.getElementById('player-state-input').value;
            this.updateFromText(text);
            this.openPlayerModal();
        },
    };

    // ==================== 装备管理器 ====================
    const EquipmentManager = {
        DEFAULT_SLOT_COUNT: 6,

        // ---------- 初始化 ----------
        ensureStructure() {
            const player = PlayerStateManager.player;
            if (!player.equipment) {
                player.equipment = {
                    slots: new Array(this.DEFAULT_SLOT_COUNT).fill(null),
                    bonuses: {},
                };
            }
            if (!Array.isArray(player.equipment.slots)) {
                player.equipment.slots = new Array(this.DEFAULT_SLOT_COUNT).fill(null);
            }
            if (!player.equipment.bonuses) {
                player.equipment.bonuses = {};
            }
            return player.equipment;
        },

        _normalizeKey(key) {
            if (!key) return key;
            const s = String(key).trim();

            // 1. 上限类后缀 → 剥掉
            const upperSuffixes = ['上限', '最大值', '最大', '上限值', 'max', 'Max', 'MAX'];
            for (const suf of upperSuffixes) {
                if (s.endsWith(suf) && s.length > suf.length) {
                    return s.slice(0, -suf.length).trim();
                }
            }

            // 2. 上限类前缀 → 剥掉
            const upperPrefixes = ['最大', 'max', 'Max'];
            for (const pre of upperPrefixes) {
                if (s.startsWith(pre) && s.length > pre.length) {
                    return s.slice(pre.length).trim();
                }
            }

            // 3. 当前值类 → 整个跳过
            const currentSuffixes = ['当前值', '当前', '回复', '恢复', '即时'];
            for (const suf of currentSuffixes) {
                if (s.endsWith(suf) && s.length > suf.length) {
                    return null;
                }
            }

            // 4. 默认：裸 key
            return s;
        },

        _injectEquipStyles() {
            // ★ CSS 已移至 style.css
            if (window.CinemaWorldCSS) window.CinemaWorldCSS.ensure();
        },

        // 从背包点"装备" → 弹装备格选择
        openEquipDialog(inventoryIndex) {
            const player = PlayerStateManager.player;
            const eq = this.ensureStructure();
            const item = player.inventory[inventoryIndex];
            if (!item) return;

            const modal = document.getElementById('cinemaworld-modal');

            let slotsHTML = '';
            eq.slots.forEach((slotItem, i) => {
                const isOccupied = !!slotItem;
                slotsHTML += `
                    <div class="cw-equip-slot ${isOccupied ? 'occupied' : 'empty'}"
                        onclick="EquipmentManager._pickSlot(${inventoryIndex}, ${i})"
                        title="${isOccupied ? '替换：' + slotItem.name : '放入此格'}">
                        ${isOccupied
                            ? `<div class="cw-equip-slot-icon">${slotItem.icon || '📦'}</div>`
                            : `<div class="cw-equip-slot-empty">+</div>`}
                        <div class="cw-equip-slot-label">${i + 1}</div>
                    </div>`;
            });

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">⚔️ 装备 ${item.name}</div>
                <div style="text-align:center;color:#aaa;font-size:13px;margin-bottom:15px;">
                    选择要放入的格子（点击已占用的格子会替换）
                </div>
                <div class="cw-equip-grid">${slotsHTML}</div>
                <div style="text-align:center;margin-top:20px;">
                    <button class="cinemaworld-button" onclick="InventoryManager.open()">返回背包</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                </div>`;
            modal.className = 'active';

            this._injectEquipStyles();
        },

        // 内部：玩家点了某个格子
        _pickSlot(inventoryIndex, slotIndex) {
            const result = this.equip(inventoryIndex, slotIndex);
            if (!result.ok) {
                if (result.needExpand) {
                    alert('装备栏已满。可以点"扩容"或去背包里卸下一些装备。');
                } else {
                    alert(result.reason || '装备失败');
                }
                return;
            }
            UIManager.showText(`已装备 ${result.item.name}`, 1500);
            InventoryManager.open();
        },

        // ---------- 扩容 / 缩容 ----------
        expandSlots(n = 1) {
            const eq = this.ensureStructure();
            for (let i = 0; i < n; i++) eq.slots.push(null);
            this.recomputeBonuses();
            if (window.SaveManager) window.SaveManager.save();
            return eq.slots.length;
        },

        shrinkSlots(n = 1) {
            const eq = this.ensureStructure();
            for (let i = 0; i < n; i++) {
                if (eq.slots.length <= 1) break;
                const last = eq.slots[eq.slots.length - 1];
                if (last) {
                    PlayerStateManager.player.inventory.push(last);
                }
                eq.slots.pop();
            }
            this.recomputeBonuses();
            if (window.SaveManager) window.SaveManager.save();
            return eq.slots.length;
        },

        setSlotCount(n) {
            const eq = this.ensureStructure();
            n = Math.max(1, Math.floor(n) || 1);
            while (eq.slots.length < n) eq.slots.push(null);
            while (eq.slots.length > n) {
                const last = eq.slots[eq.slots.length - 1];
                if (last) PlayerStateManager.player.inventory.push(last);
                eq.slots.pop();
            }
            this.recomputeBonuses();
            if (window.SaveManager) window.SaveManager.save();
            return eq.slots.length;
        },

        canEquip(item) {
            if (!item) return false;
            return true;
        },

        // ---------- 装备：背包 → 装备格 ----------
        equip(inventoryIndex, slotIndex = null) {
            const player = PlayerStateManager.player;
            const eq = this.ensureStructure();

            const item = player.inventory[inventoryIndex];
            if (!item) return { ok: false, reason: '物品不存在' };

            if (slotIndex === null) {
                slotIndex = eq.slots.findIndex(s => s === null);
                if (slotIndex === -1) {
                    return { ok: false, reason: '装备栏已满', needExpand: true };
                }
            }

            if (slotIndex < 0 || slotIndex >= eq.slots.length) {
                return { ok: false, reason: '格子位置无效' };
            }

            const old = eq.slots[slotIndex];
            if (old) player.inventory.push(old);

            eq.slots[slotIndex] = item;
            player.inventory.splice(inventoryIndex, 1);

            this.recomputeBonuses();
            PlayerStateManager.refreshAvatarArea();
            if (window.SaveManager) window.SaveManager.save();

            return { ok: true, item, slotIndex };
        },

        // ---------- 卸下：装备格 → 背包 ----------
        unequip(slotIndex) {
            const player = PlayerStateManager.player;
            const eq = this.ensureStructure();

            if (slotIndex < 0 || slotIndex >= eq.slots.length) {
                return { ok: false, reason: '格子位置无效' };
            }

            const item = eq.slots[slotIndex];
            if (!item) return { ok: false, reason: '该格为空' };

            player.inventory.push(item);
            eq.slots[slotIndex] = null;

            this.recomputeBonuses();
            PlayerStateManager.refreshAvatarArea();
            if (window.SaveManager) window.SaveManager.save();

            return { ok: true, item };
        },

        // ---------- 交换：装备格 ↔ 装备格 ----------
        swapSlots(a, b) {
            const eq = this.ensureStructure();
            if (a < 0 || b < 0 || a >= eq.slots.length || b >= eq.slots.length) return false;
            [eq.slots[a], eq.slots[b]] = [eq.slots[b], eq.slots[a]];
            this.recomputeBonuses();
            if (window.SaveManager) window.SaveManager.save();
            return true;
        },

        // ---------- 核心：重算所有装备的属性加成 ----------
        recomputeBonuses() {
            const eq = this.ensureStructure();
            const bonuses = {};
            const stackCount = {};

            for (const item of eq.slots) {
                if (!item) continue;
                stackCount[item.name] = (stackCount[item.name] || 0) + 1;

                const fields = item.fields || {};
                for (const [rawKey, value] of Object.entries(fields)) {
                    if (this._isNonBonusField(rawKey)) continue;

                    const key = this._normalizeKey(rawKey);
                    if (key === null) continue;

                    const num = this._parseBonus(value);
                    if (num === null) continue;

                    bonuses[key] = (bonuses[key] || 0) + num;
                }
            }

            eq.bonuses = bonuses;
            eq.stackCount = stackCount;

            console.log('[Equipment] 加成重算:', bonuses);

            this._applyBagExpansion();

            if (typeof DerivedStatsEngine !== 'undefined') {
                DerivedStatsEngine.recompute(PlayerStateManager.player);
            }

            PlayerStateManager.refreshAvatarArea();

            return bonuses;
        },

        // ---------- 背包类装备的扩容 / 缩容 ----------
        _applyBagExpansion() {
            const eq = this.ensureStructure();
            const bonuses = eq.bonuses || {};

            const expandKeys = ['bagSlots', '背包格', '扩容', '背包容量'];
            let totalExpand = 0;
            for (const k of expandKeys) {
                if (bonuses[k]) totalExpand += bonuses[k];
            }

            eq._appliedExpand = eq._appliedExpand || 0;
            const delta = totalExpand - eq._appliedExpand;

            if (delta > 0) {
                for (let i = 0; i < delta; i++) eq.slots.push(null);
                eq._appliedExpand = totalExpand;
                UIManager.showText(`🎒 装备栏扩容 +${delta} 格`, 2000);
                console.log(`[Equipment] 背包类装备扩容 +${delta} 格，当前 ${eq.slots.length} 格`);
            } else if (delta < 0) {
                const toRemove = Math.min(-delta, eq.slots.length - 1);
                for (let i = 0; i < toRemove; i++) {
                    const last = eq.slots[eq.slots.length - 1];
                    if (last) PlayerStateManager.player.inventory.push(last);
                    eq.slots.pop();
                }
                eq._appliedExpand = totalExpand;
                UIManager.showText(`🎒 装备栏缩容 ${toRemove} 格`, 2000);
                console.log(`[Equipment] 卸下背包装备，缩容 ${toRemove} 格`);
            }
        },

        // 哪些字段不是属性加成
        _isNonBonusField(key) {
            const BLACKLIST = [
                '状态', '功能', '图标', 'icon', '交互', '交互方式',
                '互动', '互动方式', '操作', 'actions', 'interactions',
                '类型', 'type', '可堆叠', '数量', '描述', 'desc',
                '可拾取', '拾取', '名称', 'name',
                '买价', '卖价', '买入价', '卖出价', '回收价', '价格', '库存',
                '属性', '加成', '效果数值', '数值', '加成属性',
            ];
            if (BLACKLIST.includes(key)) return true;
            if (key.startsWith('_pos')) return true;
            return false;
        },

        // 解析 "＋5" / "5" / "+5%" / "-3" / "10%" 这类值
        _parseBonus(value) {
            if (value === null || value === undefined) return null;
            const s = String(value).trim();
            const m = s.match(/^([+\-＋－]?)\s*(\d+(?:\.\d+)?)\s*(%|％)?$/);
            if (!m) return null;

            let num = parseFloat(m[2]);
            const sign = m[1];
            if (sign === '-' || sign === '－') num = -num;
            if (m[3]) num = num / 100;
            return num;
        },

        // ---------- 装备类物品的特殊效果（背包扩容） ----------
        applySpecialEffects() {
            const eq = this.ensureStructure();
            const bonuses = eq.bonuses || {};

            const expandKeys = ['bagSlots', '背包格', '扩容', '背包容量'];
            let totalExpand = 0;
            for (const k of expandKeys) {
                if (bonuses[k]) totalExpand += bonuses[k];
            }

            eq._appliedExpand = eq._appliedExpand || 0;
            const delta = totalExpand - eq._appliedExpand;

            if (delta > 0) {
                for (let i = 0; i < delta; i++) eq.slots.push(null);
                eq._appliedExpand = totalExpand;
                console.log(`[Equipment] 背包类装备扩容 +${delta} 格，当前 ${eq.slots.length} 格`);
                UIManager.showText(`🎒 装备栏扩容 +${delta} 格`, 2000);
            } else if (delta < 0) {
                const toRemove = Math.min(-delta, eq.slots.length - 1);
                for (let i = 0; i < toRemove; i++) {
                    const last = eq.slots[eq.slots.length - 1];
                    if (last) PlayerStateManager.player.inventory.push(last);
                    eq.slots.pop();
                }
                eq._appliedExpand = totalExpand;
                console.log(`[Equipment] 卸下背包装备，缩容 ${toRemove} 格`);
            }
        },
    };

    // ==================== 派生属性引擎 ====================
    const DerivedStatsEngine = {
        // 计算一条表达式（复用 DiceEngine 的数学求值，不掷骰）
        evaluate(expr, context) {
            return DiceEngine._evaluateMath(expr, context);
        },

        // 把玩家属性和派生值组成 context
        _buildContext(player) {
            const ctx = {};
            const attrs = player.attributes || {};
            const bonuses = player.equipment?.bonuses || {};
        
            for (const [k, v] of Object.entries(attrs)) {
                const base = typeof v === 'object' ? (v.value ?? 0) : Number(v) || 0;
                ctx[k] = base + (bonuses[k] || 0);
            }
        
            // ★ 把额外数据也加进去（数值类的才加）
            const extra = player.extraStats;
            if (extra && Array.isArray(extra._order)) {
                for (const k of extra._order) {
                    if (ctx[k] !== undefined) continue;   // 属性表优先
                    const raw = String(extra[k] ?? '');
                    const m = raw.match(/^(-?\d+(?:\.\d+)?)/);
                    if (m) {
                        ctx[k] = parseFloat(m[1]);
                    }
                }
            }
        
            return ctx;
        },

        // 重算所有派生值（含数值条和独立派生）
        recompute(player) {
            if (!player) return;

            const bonuses = player.equipment?.bonuses || {};
            const ctx = this._buildContext(player);

            // ========== 1. 数值条：max = base + 派生 + 装备 ==========
            for (const bar of player.statusBars || []) {
                const equipBonus = this._findEquipBonus(bar.key, bonuses);

                if (!bar.derivedExpr) {
                    const base = bar.base ?? bar.max ?? 0;
                    bar.max = Math.round(base + equipBonus);
                    if (bar.current > bar.max) bar.current = bar.max;
                    if (bar.base === undefined) bar.base = base;
                    continue;
                }

                const bonus = this.evaluate(bar.derivedExpr, ctx);
                const base = bar.base ?? 0;
                const oldMax = bar.max || base || 1;
                const oldCurrent = bar.current ?? oldMax;
                const ratio = oldMax > 0 ? oldCurrent / oldMax : 1;

                bar.max = Math.round(base + bonus + equipBonus);
                bar.current = Math.min(bar.max, Math.round(bar.max * ratio));
            }

            // ========== 2. 独立派生值 ==========
            if (player.derivedStats?.rules) {
                player.derivedStats.computed = player.derivedStats.computed || {};

                for (const rule of player.derivedStats.rules) {
                    const value = this.evaluate(rule.expr, ctx);
                    const base = rule.base ?? 0;
                    const old = player.derivedStats.computed[rule.name];
                    const equipBonus = bonuses[rule.name] || 0;

                    player.derivedStats.computed[rule.name] = {
                        current: Math.round((base + value + equipBonus) * 100) / 100,
                        max: old?.max,
                    };
                }
            }

            console.log('[DerivedStats] 重算完成:', player.derivedStats?.computed);
        },

        // ★ 辅助：从 bonuses 里找某个 key 的加成（带同义词匹配）
        _findEquipBonus(key, bonuses) {
            if (!key || !bonuses) return 0;
            if (bonuses[key] !== undefined) return bonuses[key];

            for (const [k, v] of Object.entries(bonuses)) {
                if (k === key) return v;
                if (k.includes(key) || key.includes(k)) return v;
            }
            return 0;
        },

        // 从规则引擎同步派生规则到玩家
        syncFromRules(player) {
            if (!player) return;
            player.derivedStats = player.derivedStats || { rules: [], computed: {} };
            player.statusBars = player.statusBars || [];

            // ★ 完全重建：先清空所有派生规则
            player.derivedStats.rules = [];
            const oldComputed = player.derivedStats.computed || {};
            player.derivedStats.computed = {};

            const rules = window.RuleEngine?.rules?.derived || [];
            const boundNames = new Set();

            // 清洗函数
            const cleanName = (s) => String(s || '')
                .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, '')
                .replace(/\s+/g, '')
                .trim();

            for (const r of rules) {
                const cleanRName = cleanName(r.name);

                const matchedBar = player.statusBars.find(b => {
                    const cleanBKey = cleanName(b.key);
                    return cleanBKey === cleanRName ||
                           cleanBKey === cleanRName + '上限' ||
                           (cleanBKey + '上限') === cleanRName;
                });

                if (matchedBar) {
                    matchedBar.derivedExpr = r.expr;
                    if (/^\s*\d/.test(r.expr)) {
                        matchedBar.base = 0;
                    } else if (matchedBar.base === undefined) {
                        matchedBar.base = matchedBar.max || 100;
                    }
                    boundNames.add(cleanRName);
                    boundNames.add(cleanName(matchedBar.key));
                    continue;
                }

                player.derivedStats.rules.push({ name: r.name, expr: r.expr, base: 0 });

                if (oldComputed[r.name]) {
                    player.derivedStats.computed[r.name] = oldComputed[r.name];
                }
            }

            // ★ 清理：没有绑定到数值条的条
            for (const bar of player.statusBars) {
                const cleanBKey = cleanName(bar.key);
                const matched = rules.some(r => cleanName(r.name) === cleanBKey || cleanName(r.name) === cleanBKey + '上限');
                if (!matched && bar.derivedExpr) {
                    bar.derivedExpr = null;
                }
            }

            console.log('[DerivedStats] 规则已重建，绑定数:', boundNames.size, '独立派生数:', player.derivedStats.rules.length);
        },
    };

    // ==================== 标签效果管理器 ====================
    const TagEffectManager = {
        _customEffects: {},

        getEffect(tag) {
            if (!tag) return null;
            if (typeof tag === 'string') {
                return this._customEffects[tag] || null;
            }
            if (tag.effect) return tag.effect;
            return this._customEffects[tag.name] || null;
        },

        getName(tag) {
            return typeof tag === 'string' ? tag : tag.name;
        },

        syncFromRules() {
            const defs = window.RuleEngine?.rules?.tagDefs;
            this._customEffects = defs ? { ...defs } : {};
            console.log('[TagEffectManager] 规则状态定义:', Object.keys(this._customEffects));
        },

        applyAttributeModifiers(baseStats, tags) {
            const result = { ...baseStats };
            const multipliers = {};

            for (const tag of (tags || [])) {
                const effect = this.getEffect(tag);
                if (!effect?.属性) continue;
                for (const [attr, delta] of Object.entries(effect.属性)) {
                    if (!multipliers[attr]) multipliers[attr] = [];
                    multipliers[attr].push(1 + delta);
                }
            }

            for (const [attr, mults] of Object.entries(multipliers)) {
                if (typeof result[attr] === 'number') {
                    const totalMult = mults.reduce((a, b) => a * b, 1);
                    result[attr] = Math.round(result[attr] * totalMult * 100) / 100;
                }
            }

            return result;
        },

        shouldSkipTurn(tags) {
            for (const tag of (tags || [])) {
                const effect = this.getEffect(tag);
                if (effect?.跳过回合) return true;
            }
            return false;
        },

        getPerTurnEffects(tags) {
            const out = [];
            for (const tag of (tags || [])) {
                const effect = this.getEffect(tag);
                if (!effect?.每回合) continue;
                out.push({
                    tagName: this.getName(tag),
                    changes: effect.每回合,
                });
            }
            return out;
        },

        getDefaultDuration(name) {
            return this._customEffects[name]?.持续 ?? null;
        },
    };

    // ==================== 挂载到 window ====================
    window.PlayerStateManager = PlayerStateManager;
    window.EquipmentManager = EquipmentManager;
    window.DerivedStatsEngine = DerivedStatsEngine;
    window.TagEffectManager = TagEffectManager;

    console.log('[CinemaWorld] player.js 已加载');
})();