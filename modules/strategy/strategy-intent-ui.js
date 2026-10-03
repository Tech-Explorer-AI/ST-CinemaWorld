// ============================================================
// CinemaWorld · strategy-intent-ui.js
// 战略意图输入：生成行动前让玩家描述思路
// 依赖：ui.js
// ============================================================

(function () {
    'use strict';

    const IntentUI = {

        // 记忆（会话内 + localStorage）
        _memoryKey: 'cw_strategy_intent_memory',

        _loadMemory() {
            try {
                return JSON.parse(localStorage.getItem(this._memoryKey) || '{}');
            } catch (e) { return {}; }
        },

        _saveMemory(key, value) {
            try {
                const mem = this._loadMemory();
                mem[key] = value;
                localStorage.setItem(this._memoryKey, JSON.stringify(mem));
            } catch (e) { /* ignore */ }
        },

        // ============================================================
        // 主接口：弹窗询问意图
        // config = {
        //   key: 'diplomacy_xxx',        // 记忆键（唯一）
        //   title: '外交意图',
        //   icon: '🤝',
        //   subtitle: '针对 赤铁军团',    // 可选
        //   placeholder: '例如：远交近攻...',
        //   examples: [                   // 可选：快捷提示按钮
        //     { label: '远交近攻', text: '联合远方势力，先吞并邻国' },
        //     { label: '以夷制夷', text: '挑动两个敌人互相消耗' },
        //   ],
        //   allowEmpty: true,             // 允许直接生成（跳过输入）
        // }
        // 返回：Promise<string>（意图文本，或 ''）
        // ============================================================
        ask(config) {
            return new Promise((resolve) => {
                const mem = this._loadMemory();
                const saved = mem[config.key] || '';

                const modal = document.getElementById('cinemaworld-modal');
                if (!modal) { resolve(''); return; }

                const examplesHTML = (config.examples || []).map((ex, i) => `
                    <button class="cw-intent-example" data-idx="${i}">${ex.label}</button>
                `).join('');

                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">
                        ${config.icon || '🎯'} ${config.title || '战略意图'}
                    </div>

                    ${config.subtitle ? `
                        <div style="text-align:center;font-size:12px;color:#9ab0ff;margin-bottom:10px;">
                            ${config.subtitle}
                        </div>` : ''}

                    <div style="font-size:12px;color:#888;margin-bottom:8px;line-height:1.6;">
                        描述你的战略思路，AI 会据此生成更贴切的方案。<br>
                        <span style="color:#666;">留空则按当前局势自由生成。</span>
                    </div>

                    <textarea class="cinemaworld-textarea cw-intent-textarea"
                        id="cw-intent-input"
                        placeholder="${config.placeholder || '例如：先稳住东线，集中兵力突破西境…'}"
                        style="min-height:110px;">${this._escapeHtml(saved)}</textarea>

                    ${examplesHTML ? `
                        <div class="cw-intent-examples">
                            <div class="cw-intent-examples-label">快捷思路：</div>
                            ${examplesHTML}
                        </div>` : ''}

                    <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                        <button class="cinemaworld-button primary" id="cw-intent-confirm">
                            🤖 生成
                        </button>
                        ${config.allowEmpty !== false ? `
                            <button class="cinemaworld-button" id="cw-intent-skip">
                                跳过，直接生成
                            </button>` : ''}
                        <button class="cinemaworld-button" id="cw-intent-cancel">✖ 取消</button>
                    </div>
                `;
                modal.className = 'active';

                const input = document.getElementById('cw-intent-input');

                // 快捷示例点击 → 填入文本框
                modal.querySelectorAll('.cw-intent-example').forEach(btn => {
                    btn.onclick = () => {
                        const idx = parseInt(btn.dataset.idx);
                        const ex = config.examples[idx];
                        if (ex) {
                            input.value = ex.text;
                            input.focus();
                        }
                    };
                });

                document.getElementById('cw-intent-confirm').onclick = () => {
                    const val = input.value.trim();
                    this._saveMemory(config.key, val);
                    resolve(val);
                };

                const skipBtn = document.getElementById('cw-intent-skip');
                if (skipBtn) {
                    skipBtn.onclick = () => {
                        this._saveMemory(config.key, '');
                        resolve('');
                    };
                }

                document.getElementById('cw-intent-cancel').onclick = () => {
                    resolve(null);   // null = 取消
                };
            });
        },

        // 清空某类记忆（重置时用）
        clearMemory(key) {
            const mem = this._loadMemory();
            if (key) delete mem[key];
            else Object.keys(mem).forEach(k => delete mem[k]);
            try { localStorage.setItem(this._memoryKey, JSON.stringify(mem)); } catch (e) {}
        },

        // 拼接意图到 context（给 StrategyManager 用）
        buildContext(intent, baseContext = '') {
            if (!intent) return baseContext;
            const intentBlock = `【玩家的战略思路】\n${intent}`;
            return baseContext ? `${baseContext}\n\n${intentBlock}` : intentBlock;
        },

        _escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },
    };

    window.IntentUI = IntentUI;
    console.log('[CinemaWorld] strategy-intent-ui.js 已加载');
})();