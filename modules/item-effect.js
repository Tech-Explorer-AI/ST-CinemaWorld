// ============================================================
// CinemaWorld · item-effect.js
// 物品效果 DSL：解析 / 应用 / 启发式推断
// 依赖：player.js, core.js
// 暴露：window.ItemEffectApplier
// ============================================================

(function () {
    'use strict';

    const ItemEffectApplier = {
        // ============================================================
        // 1. 主入口：应用物品效果
        // ============================================================
        apply(item, target = '玩家') {
            if (!item) return [];

            const fields = item.fields || {};
            let dsl = fields['效果'];

            // ① 有 DSL → 直接用
            if (dsl && !/^(无|none|n\/a|-|—+)$/i.test(String(dsl).trim())) {
                return this.applyDSL(dsl, target);
            }

            // ② 没有 DSL → 从 功能 推断
            const inferred = this.inferFromFunction(
                fields['功能'] || item.effect || '',
                item.type || fields['类型'] || ''
            );
            if (inferred) {
                // 顺便写回，避免重复推断
                if (!fields['效果']) {
                    fields['效果'] = inferred;
                }
                return this.applyDSL(inferred, target);
            }

            // ③ 推断失败 → 返回空，让调用方走 AI
            return [];
        },

        // ============================================================
        // 2. 应用整条 DSL
        // ============================================================
        applyDSL(dsl, target = '玩家') {
            const results = [];
            if (!dsl) return results;

            const parts = String(dsl)
                .split(/[;；]/)
                .map(s => s.trim())
                .filter(Boolean);

            for (const part of parts) {
                const effect = this.parseOne(part);
                if (!effect) {
                    console.warn('[ItemEffect] 无法解析效果:', part);
                    continue;
                }
                const r = this.applyOne(effect, target);
                if (r) results.push(r);
            }

            return results;
        },

        // ============================================================
        // 3. 解析单条效果
        // ============================================================
        parseOne(text) {
            const s = String(text || '').trim();
            if (!s) return null;

            // 状态中毒 3
            let m = s.match(/^状态\s*([\u4e00-\u9fa5A-Za-z0-9]+)\s*(\d+)?\s*(回合)?$/);
            if (m) {
                return {
                    action: '状态',
                    target: m[1].trim(),
                    duration: m[2] ? parseInt(m[2]) : null,
                };
            }

            // 移除中毒
            m = s.match(/^移除\s*([\u4e00-\u9fa5A-Za-z0-9]+)$/);
            if (m) {
                return { action: '移除', target: m[1].trim() };
            }

            // 增益攻击 5 3回合
            m = s.match(/^(增益)\s*([\u4e00-\u9fa5A-Za-z]+)\s*(-?\d+%?)\s*(\d+)\s*回合?$/);
            if (m) {
                return {
                    action: '增益',
                    target: m[2].trim(),
                    value: m[3],
                    duration: parseInt(m[4]),
                };
            }

            // 通用：回复/提升/设置/减少/永久 + 目标 + 值
            m = s.match(/^(回复|提升|设置|减少|永久)\s*([\u4e00-\u9fa5A-Za-z]+)\s*(-?\d+%?|\d+)$/);
            if (m) {
                return {
                    action: m[1],
                    target: m[2].trim(),
                    value: m[3],
                };
            }

            // 没有值的情况（如"回复生命"）
            m = s.match(/^(回复|提升|设置|减少|永久)\s*([\u4e00-\u9fa5A-Za-z]+)$/);
            if (m) {
                return {
                    action: m[1],
                    target: m[2].trim(),
                    value: null,
                };
            }

            return null;
        },

        // ============================================================
        // 4. 应用单条效果
        // ============================================================
        applyOne(effect, targetName) {
            const player = window.PlayerStateManager?.player;
            if (!player) return null;

            const { action, target, value, duration } = effect;

            switch (action) {
                case '回复':
                    return this._applyRecover(target, value, player);
                case '提升':
                    return this._applyRaiseMax(target, value, player);
                case '设置':
                    return this._applySet(target, value, player);
                case '减少':
                    return this._applyReduce(target, value, player);
                case '永久':
                    return this._applyPermanent(target, value, player);
                case '状态':
                    return this._applyAddStatus(target, duration, player);
                case '移除':
                    return this._applyRemoveStatus(target, player);
                case '增益':
                    return this._applyTempBuff(target, value, duration, player);
                default:
                    return null;
            }
        },

        // ---------- 回复（当前值 +N，不超上限）----------
        _applyRecover(key, value, player) {
            const resolved = this._resolveKey(key, player);
            if (!resolved) return null;

            if (resolved.scope === 'statusBar') {
                const bar = resolved.ref;
                const before = bar.current;
                const delta = this._parseValue(value, bar.max);
                bar.current = Math.max(0, Math.min(bar.max, bar.current + delta));
                window.PlayerStateManager.refreshAvatarArea();
                return {
                    type: 'recover',
                    key: bar.key,
                    before,
                    after: bar.current,
                    delta: bar.current - before,
                };
            }

            if (resolved.scope === 'extra') {
                const extra = player.extraStats;
                const raw = String(extra[resolved.key] ?? '0');
                const num = parseFloat(raw) || 0;
                const delta = this._parseValue(value);
                const unit = raw.replace(/^-?\d+(?:\.\d+)?/, '');
                const after = Math.max(0, num + delta);
                extra[resolved.key] = `${after}${unit}`;
                window.PlayerStateManager.refreshAvatarArea();
                return {
                    type: 'recover',
                    key: resolved.key,
                    before: num,
                    after,
                    delta: after - num,
                };
            }

            return null;
        },

        // ---------- 提升上限（上限 +N，当前值同步 +N）----------
        _applyRaiseMax(key, value, player) {
            const resolved = this._resolveKey(key, player);
            if (!resolved) return null;

            // 去掉"上限"后缀，找到实际键
            const cleanKey = String(key).replace(/(上限|最大值|最大)$/, '').trim();

            if (resolved.scope === 'statusBar') {
                const bar = resolved.ref;
                const delta = this._parseValue(value);
                const before = { current: bar.current, max: bar.max };
                bar.max += delta;
                bar.current += delta;
                window.PlayerStateManager.refreshAvatarArea();
                return {
                    type: 'raiseMax',
                    key: bar.key,
                    before,
                    after: { current: bar.current, max: bar.max },
                    delta,
                };
            }

            return null;
        },

        // ---------- 设置（当前值 = N）----------
        _applySet(key, value, player) {
            const resolved = this._resolveKey(key, player);
            if (!resolved) return null;

            if (resolved.scope === 'statusBar') {
                const bar = resolved.ref;
                const before = bar.current;
                const v = this._parseValue(value, bar.max);
                bar.current = Math.max(0, Math.min(bar.max, v));
                window.PlayerStateManager.refreshAvatarArea();
                return {
                    type: 'set',
                    key: bar.key,
                    before,
                    after: bar.current,
                };
            }

            if (resolved.scope === 'extra') {
                const extra = player.extraStats;
                const raw = String(extra[resolved.key] ?? '0');
                const unit = raw.replace(/^-?\d+(?:\.\d+)?/, '');
                const before = parseFloat(raw) || 0;
                extra[resolved.key] = `${value}${unit}`;
                window.PlayerStateManager.refreshAvatarArea();
                return {
                    type: 'set',
                    key: resolved.key,
                    before,
                    after: value,
                };
            }

            return null;
        },

        // ---------- 减少（当前值 -N）----------
        _applyReduce(key, value, player) {
            const resolved = this._resolveKey(key, player);
            if (!resolved) return null;

            if (resolved.scope === 'statusBar') {
                const bar = resolved.ref;
                const before = bar.current;
                const delta = this._parseValue(value, bar.max);
                bar.current = Math.max(0, bar.current - delta);
                window.PlayerStateManager.refreshAvatarArea();
                return {
                    type: 'reduce',
                    key: bar.key,
                    before,
                    after: bar.current,
                    delta: bar.current - before,
                };
            }

            return null;
        },

        // ---------- 永久（基础属性 +N）----------
        _applyPermanent(key, value, player) {
            const resolved = this._resolveKey(key, player);
            if (!resolved) return null;

            // 属性
            if (resolved.scope === 'attribute') {
                const attr = player.attributes[resolved.key];
                const delta = this._parseValue(value);
                if (typeof attr === 'object') {
                    const before = Number(attr.value) || 0;
                    attr.value = before + delta;
                    window.PlayerStateManager.refreshAvatarArea();
                    return {
                        type: 'permanent',
                        key: resolved.key,
                        before,
                        after: attr.value,
                        delta,
                    };
                } else {
                    const before = Number(attr) || 0;
                    player.attributes[resolved.key] = before + delta;
                    window.PlayerStateManager.refreshAvatarArea();
                    return {
                        type: 'permanent',
                        key: resolved.key,
                        before,
                        after: player.attributes[resolved.key],
                        delta,
                    };
                }
            }

            // 派生
            if (resolved.scope === 'derived') {
                const d = player.derivedStats.computed[resolved.key];
                if (d) {
                    const delta = this._parseValue(value);
                    const before = d.current;
                    d.current = (d.current || 0) + delta;
                    window.PlayerStateManager.refreshAvatarArea();
                    return {
                        type: 'permanent',
                        key: resolved.key,
                        before,
                        after: d.current,
                        delta,
                    };
                }
            }

            // 额外数据
            if (resolved.scope === 'extra') {
                const extra = player.extraStats;
                const raw = String(extra[resolved.key] ?? '0');
                const num = parseFloat(raw) || 0;
                const delta = this._parseValue(value);
                const unit = raw.replace(/^-?\d+(?:\.\d+)?/, '');
                const after = num + delta;
                extra[resolved.key] = `${after}${unit}`;
                window.PlayerStateManager.refreshAvatarArea();
                return {
                    type: 'permanent',
                    key: resolved.key,
                    before: num,
                    after,
                    delta,
                };
            }

            return null;
        },

        // ---------- 加状态 ----------
        _applyAddStatus(name, duration, player) {
            player.tags = player.tags || [];
            const existing = player.tags.find(t =>
                (typeof t === 'string' ? t : t.name) === name
            );
            if (existing && typeof existing === 'object') {
                if (duration !== null && duration !== undefined) {
                    existing.duration = duration;
                }
                return { type: 'status', name, action: 'refresh', duration };
            }

            const effect = window.TagEffectManager?.getEffect?.(name) || null;
            player.tags.push({
                name,
                effect,
                duration: duration ?? effect?.持续 ?? null,
            });
            window.PlayerStateManager.refreshAvatarArea();
            return { type: 'status', name, action: 'add', duration };
        },

        // ---------- 移除状态 ----------
        _applyRemoveStatus(name, player) {
            if (!player.tags) return null;
            const idx = player.tags.findIndex(t =>
                (typeof t === 'string' ? t : t.name) === name
            );
            if (idx > -1) {
                player.tags.splice(idx, 1);
                window.PlayerStateManager.refreshAvatarArea();
                return { type: 'status', name, action: 'remove' };
            }
            return { type: 'status', name, action: 'notFound' };
        },

        // ---------- 临时增益 ----------
        _applyTempBuff(key, value, duration, player) {
            const resolved = this._resolveKey(key, player);
            const attrKey = resolved?.key || key;

            player.tags = player.tags || [];
            const tagName = `${attrKey}增益`;

            let num = parseFloat(String(value).replace('%', '')) || 0;
            if (String(value).endsWith('%')) num = num / 100;
            else if (num >= 2) num = num / 100;

            player.tags.push({
                name: tagName,
                effect: { 属性: { [attrKey]: num } },
                duration: duration ?? 3,
            });
            window.PlayerStateManager.refreshAvatarArea();
            return {
                type: 'buff',
                key: attrKey,
                value: num,
                duration: duration ?? 3,
            };
        },

        // ============================================================
        // 5. 启发式推断：从"功能"里抠效果
        // ============================================================
        inferFromFunction(funcText, itemType = '') {
            if (!funcText) return null;
            const s = String(funcText);

            const effects = [];

            // 回复 X 点 生命/体力/...
            const recoverRe = /(?:回复|恢复|补充|治疗)\s*(\d+)\s*点?\s*(生命|体力|理智|魔力|法力|气力|精力|血量|HP|MP)/gi;
            let m;
            while ((m = recoverRe.exec(s)) !== null) {
                effects.push(`回复${m[2]} ${m[1]}`);
            }

            // 增加/提升 X 点 生命上限
            const raiseRe = /(?:增加|提升|提高|增强)\s*(\d+)\s*点?\s*(生命|体力|理智|魔力|法力|攻击|防御|敏捷|力量|智力|幸运)(?:上限|最大值|最大)?/gi;
            while ((m = raiseRe.exec(s)) !== null) {
                const isUpper = /上限|最大值|最大/.test(m[0]);
                if (isUpper) {
                    effects.push(`提升${m[2]}上限 ${m[1]}`);
                } else {
                    effects.push(`永久${m[2]} ${m[1]}`);
                }
            }

            // 减少 X 点 理智/...
            const reduceRe = /(?:减少|失去|扣除)\s*(\d+)\s*点?\s*(理智|生命|体力)/gi;
            while ((m = reduceRe.exec(s)) !== null) {
                effects.push(`减少${m[2]} ${m[1]}`);
            }

            // 解除/移除 中毒
            const removeRe = /(?:解除|移除|清除|治愈)\s*([\u4e00-\u9fa5]{2,6})/g;
            while ((m = removeRe.exec(s)) !== null) {
                const statusName = m[1].trim();
                // 排除误匹配
                if (/生命|体力|理智|魔力|法力|攻击|防御|敏捷/.test(statusName)) continue;
                effects.push(`移除${statusName}`);
            }

            // 附加/陷入 中毒
            const addStatusRe = /(?:附加|陷入|获得|处于)\s*([\u4e00-\u9fa5]{2,6})(?:\s*状态)?/g;
            while ((m = addStatusRe.exec(s)) !== null) {
                const statusName = m[1].trim();
                if (/生命|体力|理智|魔力|攻击|防御/.test(statusName)) continue;
                effects.push(`状态${statusName}`);
            }

            // 无效果的物品
            if (effects.length === 0) {
                // 明显是"无效果"的描述
                if (/^(无|用于|可用来|可以|作为|材料|装饰|纪念|收藏)/.test(s)) {
                    return '无';
                }
                return null;
            }

            return effects.join('; ');
        },

        // ============================================================
        // 6. 显示效果文本
        // ============================================================
        formatResults(results) {
            if (!results || results.length === 0) return '';

            const lines = [];

            for (const r of results) {
                switch (r.type) {
                    case 'recover':
                        lines.push(`💚 ${r.key} ${r.before} → ${r.after}（+${r.delta}）`);
                        break;
                    case 'reduce':
                        lines.push(`📉 ${r.key} ${r.before} → ${r.after}（${r.delta}）`);
                        break;
                    case 'raiseMax':
                        lines.push(`⬆️ ${r.key}上限 ${r.before.max} → ${r.after.max}（+${r.delta}）`);
                        break;
                    case 'set':
                        lines.push(`✨ ${r.key} 设置为 ${r.after}`);
                        break;
                    case 'permanent':
                        lines.push(`🌟 ${r.key} 永久 ${r.before} → ${r.after}（+${r.delta}）`);
                        break;
                    case 'status':
                        if (r.action === 'add') {
                            lines.push(`✨ 获得状态：${r.name}${r.duration ? `（${r.duration}回合）` : ''}`);
                        } else if (r.action === 'remove') {
                            lines.push(`✨ 解除状态：${r.name}`);
                        } else if (r.action === 'refresh') {
                            lines.push(`✨ 刷新状态：${r.name}`);
                        } else if (r.action === 'notFound') {
                            lines.push(`⚠️ 状态 ${r.name} 不存在`);
                        }
                        break;
                    case 'buff':
                        lines.push(`🔥 ${r.key} +${(r.value * 100).toFixed(0)}%（${r.duration}回合）`);
                        break;
                }
            }

            return lines.join('\n');
        },

        // ============================================================
        // 7. 判断物品是否可快捷使用
        // ============================================================
        canQuickUse(item) {
            if (!item) return false;
            const fields = item.fields || {};
            const type = item.type || fields['类型'] || '';

            // 消耗品类
            if (/消耗品|食物|药水|药剂|饮品|丹药/.test(type)) return true;

            // 有可解析的效果
            const dsl = fields['效果'];
            if (dsl && !/^(无|none|n\/a|-|—+)$/i.test(String(dsl).trim())) {
                return true;
            }

            // 有能从 功能 推断的效果
            const inferred = this.inferFromFunction(fields['功能'] || item.effect || '', type);
            if (inferred && inferred !== '无') return true;

            return false;
        },

        // ============================================================
        // 工具
        // ============================================================
        _resolveKey(logicalKey, player) {
            // 优先用 MapQuestManager 的归一化
            if (window.MapQuestManager?._resolveRewardKey) {
                const r = window.MapQuestManager._resolveRewardKey(logicalKey);
                if (r) return r;
            }

            // 兜底：直接查
            if (!player) return null;
            const clean = (s) => String(s || '')
                .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
                .replace(/\s+/g, '').trim().toLowerCase();

            const target = clean(logicalKey);

            for (const bar of player.statusBars || []) {
                if (clean(bar.key) === target || clean(bar.key).includes(target) || target.includes(clean(bar.key))) {
                    return { scope: 'statusBar', ref: bar, key: bar.key };
                }
            }
            for (const k of Object.keys(player.attributes || {})) {
                if (clean(k) === target || clean(k).includes(target) || target.includes(clean(k))) {
                    return { scope: 'attribute', key: k };
                }
            }
            const computed = player.derivedStats?.computed || {};
            for (const k of Object.keys(computed)) {
                if (clean(k) === target || clean(k).includes(target) || target.includes(clean(k))) {
                    return { scope: 'derived', key: k };
                }
            }
            const extra = player.extraStats;
            if (extra && Array.isArray(extra._order)) {
                for (const k of extra._order) {
                    if (clean(k) === target || clean(k).includes(target) || target.includes(clean(k))) {
                        return { scope: 'extra', key: k };
                    }
                }
            }
            return null;
        },

        _parseValue(value, max = null) {
            if (value === null || value === undefined) return 0;
            const s = String(value).trim();
            if (s.endsWith('%')) {
                const pct = parseFloat(s) / 100;
                return max !== null ? Math.round(max * pct) : 0;
            }
            return parseFloat(s) || 0;
        },
    };

    // ============================================================
    // 快捷使用栏
    // ============================================================
    const MapQuickBar = {
        SLOT_COUNT: 8,

        // 拿可以快捷使用的物品
        getQuickItems() {
            const player = window.PlayerStateManager?.player;
            const inv = player?.inventory || [];
            return inv
                .filter(i => ItemEffectApplier.canQuickUse(i))
                .slice(0, this.SLOT_COUNT);
        },

        // 渲染 HTML
        render() {
            const items = this.getQuickItems();
            if (items.length === 0) return '';

            return `
                <div class="cw-map-quick-bar" id="cw-map-quick-bar">
                    ${items.map((item, i) => `
                        <button class="cw-map-quick-slot"
                            data-item-name="${this._esc(item.name)}"
                            onclick="MapQuickBar.use('${this._escAttr(item.name)}')"
                            title="${this._escAttr(item.name)}（点击使用）">
                            <div class="cw-map-quick-icon">${item.icon || '📦'}</div>
                            <div class="cw-map-quick-count">${item.count || 1}</div>
                        </button>
                    `).join('')}
                </div>`;
        },

        // 使用
        async use(itemName) {
            const player = window.PlayerStateManager?.player;
            if (!player) return;

            const item = (player.inventory || []).find(i => i.name === itemName);
            if (!item) {
                window.UIManager?.showText?.('物品不存在', 1500);
                return;
            }

            // 应用效果
            const results = ItemEffectApplier.apply(item, '玩家');

            if (!results || results.length === 0) {
                // 没有可执行效果 → 走 AI 生成
                const idx = player.inventory.indexOf(item);
                if (idx > -1) {
                    window.InventoryManager?._proceedUseItemFlow?.(idx);
                }
                return;
            }

            // 数量 -1
            item.count = (item.count || 1) - 1;
            if (item.count <= 0) {
                const idx = player.inventory.indexOf(item);
                if (idx > -1) player.inventory.splice(idx, 1);
            }

            // 显示结果
            const text = ItemEffectApplier.formatResults(results);
            if (text) {
                await window.UIManager?.showText?.(
                    `🧪 使用 ${item.icon || ''} ${item.name}\n${text}`,
                    2200
                );
            }

            // 刷新 UI
            window.PlayerStateManager?.refreshAvatarArea?.();
            window.MapCanvas?._render?.();
            this.refresh();
            if (window.SaveManager) window.SaveManager.save();
        },

        // 刷新快捷栏
        refresh() {
            const oldBar = document.getElementById('cw-map-quick-bar');
            if (!oldBar) return;

            const parent = oldBar.parentNode;
            const newHTML = this.render();
            if (!newHTML) {
                oldBar.remove();
                return;
            }

            const temp = document.createElement('div');
            temp.innerHTML = newHTML.trim();
            const newBar = temp.firstChild;
            parent.replaceChild(newBar, oldBar);
        },

        _esc(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },

        _escAttr(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
    };

    // ============================================================
    // 挂载
    // ============================================================
    window.ItemEffectApplier = ItemEffectApplier;
    window.MapQuickBar = MapQuickBar;

    console.log('[CinemaWorld] item-effect.js 已加载');
})();