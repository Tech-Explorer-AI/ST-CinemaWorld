// ============================================================
// CinemaWorld · combat-ui.js
// 即时战斗 · UI（举械键 + 攻击键）
// CD 用按钮本身的"从上到下扫过"效果
// ============================================================

(function () {
    'use strict';

    const CombatUI = {
        _el: null,
        _aimBtn: null,
        _attackBtn: null,
        _cdHintEl: null,
        _cdHintTimer: null,
        _inited: false,
        _cdLoopStarted: false,

        // ============================================================
        // 初始化
        // ============================================================
        init() {
            this._injectStyles();
            this._ensureElement();
            this._startCDLoop();
            console.log('[CombatUI] 已初始化');
        },

        // ============================================================
        // 挂载
        // ============================================================
        _ensureElement() {
            if (this._el && document.body.contains(this._el)) return;

            document.getElementById('cw-combat-ui')?.remove();
            document.getElementById('cw-combat-cd-hint')?.remove();

            const el = document.createElement('div');
            el.id = 'cw-combat-ui';
            el.innerHTML = `
                <button class="cw-combat-btn" id="cw-combat-aim-btn" title="举械/收械 (Q)">🗡️</button>
                <button class="cw-combat-btn" id="cw-combat-attack-btn" title="攻击 (空格)">
                    <span class="cw-combat-attack-content"></span>
                    <span class="cw-combat-attack-mask"></span>
                </button>
            `;

            const win = document.getElementById('cinemaworld-map-window');
            if (!win) {
                console.warn('[CombatUI] 地图窗口不存在，延迟挂载');
                setTimeout(() => this._ensureElement(), 200);
                return;
            }

            win.appendChild(el);

            this._el = el;
            this._aimBtn = el.querySelector('#cw-combat-aim-btn');
            this._attackBtn = el.querySelector('#cw-combat-attack-btn');

            this._aimBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.CombatState.toggleAimed();
            });
            this._attackBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.CombatState.tryAttack();
            });

            const hint = document.createElement('div');
            hint.id = 'cw-combat-cd-hint';
            win.appendChild(hint);
            this._cdHintEl = hint;

            console.log('[CombatUI] 已挂载到地图窗口');
        },

        // ============================================================
        // 样式
        // ============================================================
        _injectStyles() {
            if (document.getElementById('cw-combat-ui-styles')) return;
            const s = document.createElement('style');
            s.id = 'cw-combat-ui-styles';
            s.textContent = `
                #cw-combat-ui {
                    position: absolute;
                    right: 20px;
                    bottom: 100px;
                    z-index: 9999;
                    display: none;
                    flex-direction: column;
                    gap: 10px;
                    pointer-events: none;
                    user-select: none;
                }
                #cw-combat-ui.visible { display: flex; }

                .cw-combat-btn {
                    pointer-events: auto;
                    width: 64px;
                    height: 64px;
                    border-radius: 32px;
                    border: 2px solid rgba(140, 180, 255, 0.5);
                    background: rgba(20, 22, 34, 0.9);
                    color: #fff;
                    font-size: 28px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
                    transition: all 0.15s;
                    user-select: none;
                    -webkit-tap-highlight-color: transparent;
                    position: relative;
                    padding: 0;
                    overflow: hidden;
                }
                .cw-combat-btn:active { transform: scale(0.92); }

                #cw-combat-aim-btn {
                    background: rgba(30, 40, 70, 0.9);
                    border-color: rgba(140, 180, 255, 0.6);
                    overflow: visible;
                }
                #cw-combat-aim-btn.active {
                    background: linear-gradient(135deg, #d87d7d, #a85a5a);
                    border-color: rgba(255, 160, 160, 0.9);
                    box-shadow: 0 4px 24px rgba(255, 100, 100, 0.5);
                }

                /* 攻击按钮 */
                #cw-combat-attack-btn {
                    width: 84px;
                    height: 84px;
                    border-radius: 42px;
                    font-size: 34px;
                    background: linear-gradient(135deg, #d87d7d, #a85a5a);
                    border-color: rgba(255, 200, 200, 0.7);
                    overflow: hidden;
                }

                /* 内容层（图标） */
                .cw-combat-attack-content {
                    position: relative;
                    z-index: 2;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    line-height: 1;
                    pointer-events: none;
                }

                .cw-combat-attack-content.dual {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                }
                .cw-combat-attack-content.dual .cw-weapon-icon {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 26px;
                }
                .cw-combat-attack-content.dual .cw-weapon-icon:first-child {
                    border-right: 1px solid rgba(255,255,255,0.25);
                }

                /* ★ 遮罩层：CD 时盖住按钮，从上到下退出 */
                .cw-combat-attack-mask {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    z-index: 3;
                    pointer-events: none;
                    background: rgba(30, 20, 20, 0.78);
                    clip-path: inset(100% 0 0 0);
                    transition: clip-path 0.08s linear;
                    border-radius: 42px;   /* 和按钮圆角一致 */
                }
                .cw-combat-attack-mask.visible {
                    clip-path: inset(0 0 0 0);
                }

                #cw-combat-attack-btn.cooldown {
                    filter: brightness(0.85);
                }

                /* CD 提示 */
                #cw-combat-cd-hint {
                    position: absolute;
                    right: 20px;
                    bottom: 200px;
                    padding: 8px 16px;
                    background: rgba(40, 20, 20, 0.95);
                    border: 1px solid rgba(255, 120, 120, 0.6);
                    border-radius: 8px;
                    color: #ff9999;
                    font-size: 12px;
                    z-index: 9999;
                    opacity: 0;
                    transform: translateY(8px);
                    transition: all 0.2s;
                    pointer-events: none;
                }
                #cw-combat-cd-hint.visible {
                    opacity: 1;
                    transform: translateY(0);
                }

                @media (max-width: 640px) {
                    #cw-combat-ui { right: 12px; bottom: 80px; }
                    .cw-combat-btn { width: 54px; height: 54px; font-size: 24px; }
                    #cw-combat-attack-btn { width: 72px; height: 72px; font-size: 30px; border-radius: 36px;overflow: hidden; }
                    .cw-combat-attack-content.dual .cw-weapon-icon { font-size: 22px; }
                }
            `;
            document.head.appendChild(s);
        },

        // ============================================================
        // 模式切换
        // ============================================================
        onModeChange(mode) {
            if (!this._el) return;
            if (mode === 'aimed') {
                this._el.classList.add('visible');
                this._aimBtn.classList.add('active');
                this._aimBtn.textContent = '🛡️';
            } else {
                this._el.classList.remove('visible');
                this._aimBtn.classList.remove('active');
                this._aimBtn.textContent = '🗡️';
            }
        },

        setVisible(visible) {
            if (!this._el) return;
            if (visible && window.CombatState?.isAimed?.()) {
                this._el.classList.add('visible');
            } else {
                this._el.classList.remove('visible');
            }
        },

        // ============================================================
        // CD 刷新循环
        // ============================================================
        _startCDLoop() {
            if (this._cdLoopStarted) return;
            this._cdLoopStarted = true;

            const loop = () => {
                if (!this._cdLoopStarted) return;
                if (window.CombatState?.isAimed?.()) {
                    this.updateAttackButton();
                }
                requestAnimationFrame(loop);
            };
            loop();
        },

        // ============================================================
        // 更新攻击按钮
        // ============================================================
        updateAttackButton() {
            if (!this._attackBtn) return;

            const main = window.EquipmentManager?.getMainWeapon?.();
            const off = window.EquipmentManager?.getOffWeapon?.();

            // ---------- 1. 图标 ----------
            const contentEl = this._attackBtn.querySelector('.cw-combat-attack-content');
            if (!contentEl) return;

            if (!main && !off) {
                if (contentEl.textContent !== '⚔️' || contentEl.classList.contains('dual')) {
                    contentEl.className = 'cw-combat-attack-content';
                    contentEl.textContent = '⚔️';
                }
            } else if (main && off) {
                const mainIcon = main.icon || '⚔️';
                const offIcon = off.icon || '⚔️';
                const html = `<span class="cw-weapon-icon">${mainIcon}</span><span class="cw-weapon-icon">${offIcon}</span>`;
                if (!contentEl.classList.contains('dual') || contentEl.innerHTML.trim() !== html) {
                    contentEl.className = 'cw-combat-attack-content dual';
                    contentEl.innerHTML = html;
                }
            } else {
                const w = main || off;
                const icon = w.icon || '⚔️';
                if (contentEl.textContent !== icon || contentEl.classList.contains('dual')) {
                    contentEl.className = 'cw-combat-attack-content';
                    contentEl.textContent = icon;
                }
            }

            // ---------- 2. CD 状态 ----------
            // ★ 只看"存在"的武器，没武器视为可用
            const weapons = [];
            if (main) weapons.push(main);
            if (off) weapons.push(off);

            const anyReady = weapons.length === 0
                || weapons.some(w => window.CombatState.isWeaponReady(w));

            // ---------- 3. 更新遮罩 ----------
            const maskEl = this._attackBtn.querySelector('.cw-combat-attack-mask');
            if (maskEl) {
                if (anyReady) {
                    // CD 好了 → 遮罩完全退出
                    maskEl.style.clipPath = 'inset(100% 0 0 0)';
                } else {
                    // CD 中 → 取"最快好的那把"的 CD 比例
                    let bestRemain = Infinity;
                    let bestInterval = 1000;

                    for (const w of weapons) {
                        const remain = window.CombatState.getCooldownRemain(w);
                        const interval = window.CombatWeapon.getCombatData(w)?.interval || 1000;
                        // 用"剩余时间 / 攻击间隔"作为比较（归一化）
                        if (remain / interval < bestRemain / bestInterval) {
                            bestRemain = remain;
                            bestInterval = interval;
                        }
                    }

                    // cdPct: 1（刚打完） → 0（快好）
                    const cdPct = Math.max(0, Math.min(1, bestRemain / bestInterval));
                    const topPct = (1 - cdPct) * 100;

                    maskEl.style.clipPath = `inset(${topPct}% 0 0 0)`;
                }
            }

            if (anyReady) {
                this._attackBtn.classList.remove('cooldown');
            } else {
                this._attackBtn.classList.add('cooldown');
            }
        },

        // ============================================================
        // CD 提示
        // ============================================================
        flashCooldownHint(remainMs) {
            if (!this._cdHintEl) return;
            const sec = (remainMs / 1000).toFixed(1);
            this._cdHintEl.textContent = `⏳ 冷却中 ${sec}s`;
            this._cdHintEl.classList.add('visible');
            if (this._cdHintTimer) clearTimeout(this._cdHintTimer);
            this._cdHintTimer = setTimeout(() => {
                this._cdHintEl.classList.remove('visible');
            }, 1200);
        },

        updateCooldowns() { },

        destroy() {
            this._cdLoopStarted = false;
            this._el?.remove();
            this._cdHintEl?.remove();
            this._el = null;
            this._aimBtn = null;
            this._attackBtn = null;
            this._cdHintEl = null;
            this._inited = false;
        },
    };

    window.CombatUI = CombatUI;
    console.log('[CinemaWorld] combat-ui.js 已加载');
})();