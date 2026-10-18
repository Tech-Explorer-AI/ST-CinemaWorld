// ============================================================
// CinemaWorld · combat-init.js
// 即时战斗 · 初始化 & 钩子
// ============================================================

(function () {
    'use strict';

    function ensureSettings() {
        const ws = window.CinemaWorld?.worldState;
        if (!ws) return;
        ws.settings = ws.settings || {};
        if (ws.settings.combatMode === undefined) {
            ws.settings.combatMode = 'turnbased';
        }
    }

    function patchEquipmentManager() {
        const EM = window.EquipmentManager;
        if (!EM || EM._combatPatched) return false;

        EM._combatPatched = true;

        EM.getMainWeapon = function () {
            const eq = this.ensureStructure?.();
            if (!eq?.slots) return null;
            return eq.slots[0] || null;
        };

        EM.getOffWeapon = function () {
            const eq = this.ensureStructure?.();
            if (!eq?.slots) return null;

            const main = eq.slots[0];
            if (!main) return null;

            const mainData = window.CombatWeapon?.getCombatData?.(main);
            if (mainData?.twoHanded) return null;

            const off = eq.slots[1];
            if (!off) return null;

            const offData = window.CombatWeapon?.getCombatData?.(off);
            if (!offData) return null;
            if (!offData.dualWield) return null;

            return off;
        };

        EM.canEquipToOffHand = function (item) {
            const data = window.CombatWeapon?.getCombatData?.(item);
            return data?.dualWield === true;
        };

        console.log('[CombatInit] EquipmentManager 已包装');
        return true;
    }

    function patchMapCanvas() {
        const MC = window.MapCanvas;
        if (!MC || MC._combatPatched) return false;

        MC._combatPatched = true;

        const originalRender = MC._render.bind(MC);
        MC._render = function () {
            originalRender();

            if (!isRealtimeEnabled()) return;
            if (window.MapCanvas3D?._running) return;
            if (!this.ctx) return;

            try {
                window.CombatRender?.render?.(
                    this.ctx,
                    this.camera,
                    this.config.tileSize,
                    this._cssW,
                    this._cssH
                );
            } catch (e) {
                console.error('[CombatInit] CombatRender 失败:', e);
            }
        };

        const originalUpdate = MC._update.bind(MC);
        MC._update = function () {
            originalUpdate();

            if (!isRealtimeEnabled()) return;

            const now = performance.now();
            const dt = this._lastCombatTick ? now - this._lastCombatTick : 16;
            this._lastCombatTick = now;

            try {
                window.CombatState?.update?.(dt);
            } catch (e) {
                console.error('[CombatInit] CombatState.update 失败:', e);
            }
        };

        const originalHandleInputAndMove = MC._handleInputAndMove.bind(MC);
        MC._handleInputAndMove = function (now) {
            if (isRealtimeEnabled() && window.CombatState?.isAimed?.()) {
                const origCd = this.config.moveCooldown;
                this.config.moveCooldown = origCd * 2;
                try {
                    originalHandleInputAndMove(now);
                } finally {
                    this.config.moveCooldown = origCd;
                }
                return;
            }
            originalHandleInputAndMove(now);
        };

        const originalInit = MC.init.bind(MC);
        MC.init = function (container, map, options) {
            const result = originalInit(container, map, options);
            window.CombatState?.reset?.();
            window.CombatAI?.reset?.();
            window.CompanionCombatAI?.reset?.();
            window.CombatRender?.clear?.();
            window.CombatUI?.setVisible?.(isRealtimeEnabled());
            return result;
        };

        const originalDestroy = MC.destroy.bind(MC);
        MC.destroy = function () {
            window.CombatUI?.setVisible?.(false);
            window.CombatState?.reset?.();
            window.CombatAI?.reset?.();
            window.CompanionCombatAI?.reset?.();
            window.CombatRender?.clear?.();
            originalDestroy();
        };

        console.log('[CombatInit] MapCanvas 已包装');
        return true;
    }

    function bindCombatKeys() {
        if (window._combatKeysBound) return;
        window._combatKeysBound = true;

        window.addEventListener('keydown', (e) => {
            if (!isRealtimeEnabled()) return;
            if (!window.MapLauncher?.getMap?.()) return;

            const tag = (e.target?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;
            if (e.target?.isContentEditable) return;

            const key = e.key.toLowerCase();

            if (key === 'shift' && !e.repeat) {
                e.preventDefault();
                e.stopPropagation();
                window.CombatState?.toggleAimed?.();
                return;
            }

            if (e.key === ' ' && window.CombatState?.isAimed?.()) {
                e.preventDefault();
                e.stopPropagation();
                window.CombatState?.tryAttack?.();
                return;
            }
        }, true);

        console.log('[CombatInit] 键盘监听已绑定');
    }

    function patchMapInteract() {
        const MI = window.MapInteract;
        if (!MI || MI._combatPatched) return false;

        MI._combatPatched = true;

        const originalTalkTo = MI.talkTo?.bind(MI);
        if (originalTalkTo) {
            MI.talkTo = function (entityId) {
                if (isRealtimeEnabled() && window.CombatState?.isAimed?.()) {
                    window.UIManager?.showText?.('先收械再对话', 1000);
                    return;
                }
                return originalTalkTo(entityId);
            };
        }

        console.log('[CombatInit] MapInteract 已包装');
        return true;
    }

    function patchPhoneSettings() {
        if (!window.PhoneUIManager) return false;

        const Phone = window.PhoneUIManager;

        const original = Phone.renderSettingsApp?.bind(Phone);
        if (!original || Phone._combatPatched) return true;

        Phone._combatPatched = true;

        Phone.renderSettingsApp = function () {
            const mode = window.CinemaWorld?.worldState?.settings?.combatMode || 'turnbased';

            return `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>设置</span>
                </div>
                <div class="cw-phone-app-body">
                    <div style="padding:14px;background:rgba(255,255,255,.04);border-radius:10px;margin-bottom:12px;">
                        <div style="font-size:14px;color:#fff;font-weight:600;margin-bottom:8px;">
                            ⚔️ 战斗模式
                        </div>
                        <div style="font-size:11px;color:#888;margin-bottom:12px;line-height:1.5;">
                            即时制是测试功能。开启后，地图上按 Shift 进入举械态，空格攻击。
                        </div>
                        <div style="display:flex;gap:8px;">
                            <button class="cw-phone-nav-btn"
                                style="flex:1;${mode === 'turnbased' ? 'background:rgba(120,150,255,.3);' : ''}"
                                onclick="PhoneUIManager._setCombatMode('turnbased')">
                                回合制
                            </button>
                            <button class="cw-phone-nav-btn"
                                style="flex:1;${mode === 'realtime' ? 'background:rgba(216,125,125,.3);' : ''}"
                                onclick="PhoneUIManager._setCombatMode('realtime')">
                                即时制
                            </button>
                        </div>
                    </div>
                </div>`;
        };

        Phone._setCombatMode = function (mode) {
            const ws = window.CinemaWorld?.worldState;
            if (!ws) return;
            ws.settings = ws.settings || {};
            ws.settings.combatMode = mode;

            if (window.SaveManager) window.SaveManager.save();

            window.CombatUI?.setVisible?.(mode === 'realtime');
            this.render();

            window.UIManager?.showText?.(
                mode === 'realtime' ? '⚔️ 已切换到即时制' : '🎲 已切换到回合制',
                1500
            );
        };

        console.log('[CombatInit] 手机设置已包装');
        return true;
    }

    function isRealtimeEnabled() {
        const ws = window.CinemaWorld?.worldState;
        return ws?.settings?.combatMode === 'realtime';
    }
    window.isRealtimeCombat = isRealtimeEnabled;

    function boot() {
        ensureSettings();

        if (!patchEquipmentManager()) { setTimeout(boot, 100); return; }
        if (!patchMapCanvas()) { setTimeout(boot, 100); return; }

        patchMapInteract();
        patchPhoneSettings();
        bindCombatKeys();
        bindMapModeUI();
        disableEncounterChaseInRealtime();

        window.CombatUI?.init?.();
        window.CombatAI?.init?.();

        // ★ 队友战斗 AI 已由 companion-summon.js 内部 tick 驱动
        //   这里只确保 summon 已 init
        if (window.CompanionSummonManager && !window.CompanionSummonManager._tickTimer) {
            window.CompanionSummonManager.init?.();
        }

        try { window.CombatRender3D?.init?.(); } catch (e) {
            console.error('[CombatInit] CombatRender3D.init 失败:', e);
        }
        console.log('[CombatInit] 即时战斗系统已就绪');
    }

    window.addEventListener('cw:map-opened', () => {
        window.CombatUI._el = null;
        window.CombatUI._cdHintEl = null;
        window.CombatUI.init();

        if (isRealtimeEnabled()) {
            const main = window.EquipmentManager?.getMainWeapon?.();
            const off = window.EquipmentManager?.getOffWeapon?.();

            if (main || off) {
                window.CombatState?.enterAimed?.();
            } else {
                window.CombatState?.exitAimed?.();
                console.log('[CombatInit] 没有武器，保持步行态');
            }
        }

        document.querySelectorAll('.cw-action-toggle').forEach(b => {
            b.style.setProperty('display', 'none', 'important');
        });
    });

    window.addEventListener('cw:map-closed', () => {
        window.CombatUI?.setVisible?.(false);
        window.CombatState?.reset?.();
        window.CombatAI?.reset?.();
        window.CompanionCombatAI?.reset?.();
        window.CombatRender?.clear?.();

        document.querySelectorAll('.cw-action-toggle').forEach(b => {
            b.style.removeProperty('display');
        });
    });

    function disableEncounterChaseInRealtime() {
        const MC = window.MapEncounterChase;
        if (!MC || MC._realtimePatched) return;

        MC._realtimePatched = true;

        const original = MC._onMinute.bind(MC);
        MC._onMinute = function () {
            if (isRealtimeEnabled()) return;
            return original();
        };

        const originalStart = MC._startBattle?.bind(MC);
        if (originalStart) {
            MC._startBattle = async function (ent, map) {
                if (isRealtimeEnabled()) {
                    ent.meta = ent.meta || {};
                    ent.meta._combatAggro = true;
                    ent.meta._combatAggroAt = Date.now();
                    this._dropChaser?.(ent.id, map, 'realtime-aggro');
                    console.log(`[CombatInit] ${ent.name} 改为即时 aggro`);
                    return;
                }
                return originalStart(ent, map);
            };
        }

        console.log('[CombatInit] MapEncounterChase 已适配即时模式');
    }

    function bindMapModeUI() {
        window.addEventListener('cw:map-opened', () => {
            const btn = document.querySelector('.cw-action-toggle');
            if (btn) btn.style.display = 'none';

            const panel = document.getElementById('cinemaworld-scene-actions');
            if (panel) panel.style.display = 'none';
        });

        window.addEventListener('cw:map-closed', () => {
            const btn = document.querySelector('.cw-action-toggle');
            if (btn) btn.style.display = '';

            const panel = document.getElementById('cinemaworld-scene-actions');
            if (panel) panel.style.display = '';
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld] combat-init.js 已加载');
})();