// ============================================================
// CinemaWorld · combat-state.js
// 即时战斗 · 状态机
//   - walk / aimed 切换
//   - 武器 CD 管理
//   - 攻击触发（含双持）
//
// 依赖：CombatWeapon, EquipmentManager, CombatResolver, CombatUI
// 暴露：window.CombatState
// ============================================================

(function () {
    'use strict';

    const CombatState = {
        _mode: 'walk',                 // 'walk' | 'aimed'
        _cooldowns: {},                // { weaponKey: 剩余毫秒 }
        _lastAttackAt: 0,              // 上次攻击的时间戳（用于后摇）
        _attacking: false,             // 攻击动作中

        // ============================================================
        // 模式切换
        // ============================================================
        getMode() {
            return this._mode;
        },

        isAimed() {
            return this._mode === 'aimed';
        },

        toggleAimed() {
            if (this._mode === 'aimed') {
                this.exitAimed();
            } else {
                this.enterAimed();
            }
        },

        enterAimed() {
            if (this._mode === 'aimed') return;
        
            // 没武器 → 不允许举械
            const main = window.EquipmentManager?.getMainWeapon?.();
            const off = window.EquipmentManager?.getOffWeapon?.();
            if (!main && !off) {
                window.UIManager?.showText?.('没有装备武器', 1200);
                return;
            }
        
            this._mode = 'aimed';
            window.CombatUI?.onModeChange('aimed');
        
            // ★ 2D 重绘（会走 isAimed 判断用举械图集）
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
        
            // ★ 3D 强制刷新玩家纹理
            if (window.MapCanvas3D?._running) {
                const node = window.MapCanvas3D._entityNodes.get(window.MapCanvas?.player?.id);
                if (node) {
                    node._aimed = true;   // 让 _updateSmoothPositions 检测到变化
                    node._facing = null;  // 强制重新刷
                }
            }
        
            console.log('[CombatState] 进入举械态');
        },
        
        exitAimed() {
            if (this._mode === 'walk') return;
            this._mode = 'walk';
        
            window.CombatUI?.onModeChange('walk');
        
            // ★ 2D 重绘
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
        
            // ★ 3D 强制刷新玩家纹理
            if (window.MapCanvas3D?._running) {
                const node = window.MapCanvas3D._entityNodes.get(window.MapCanvas?.player?.id);
                if (node) {
                    node._aimed = false;
                    node._facing = null;
                }
            }
        
            console.log('[CombatState] 回到步行态');
        },

        // ============================================================
        // CD 管理
        // ============================================================
        _weaponKey(weapon) {
            if (!weapon) return null;
            return weapon.id || weapon.name;
        },

        isWeaponReady(weapon) {
            if (!weapon) return false;
            const key = this._weaponKey(weapon);
            const remain = this._cooldowns[key] || 0;
            return remain <= 0;
        },

        getCooldownRemain(weapon) {
            if (!weapon) return 0;
            const key = this._weaponKey(weapon);
            return Math.max(0, this._cooldowns[key] || 0);
        },

        _startCooldown(weapon, interval) {
            const key = this._weaponKey(weapon);
            if (!key) return;
            this._cooldowns[key] = interval;
        },

        // ============================================================
        // 每帧更新（由 MapCanvas 主循环调用）
        // ============================================================
        update(dt) {
            if (this._mode !== 'aimed') return;

            // 递减 CD
            for (const key of Object.keys(this._cooldowns)) {
                if (this._cooldowns[key] > 0) {
                    this._cooldowns[key] = Math.max(0, this._cooldowns[key] - dt);
                }
            }
        },

        // ============================================================
        // 攻击
        // ============================================================
        async tryAttack() {
            if (this._mode !== 'aimed') {
                window.UIManager?.showText?.('先举械（按 Shift）', 1000);
                return;
            }

            if (this._attacking) return;

            const main = window.EquipmentManager?.getMainWeapon?.();
            const off = window.EquipmentManager?.getOffWeapon?.();

            // ---------- 收集能打的武器 ----------
            const attacks = [];

            if (main) {
                const mainData = window.CombatWeapon.getCombatData(main);
                if (mainData && this.isWeaponReady(main)) {
                    attacks.push({ weapon: main, data: mainData });
                }
            }

            if (off) {
                const offData = window.CombatWeapon.getCombatData(off);
                if (offData && this.isWeaponReady(off)) {
                    attacks.push({ weapon: off, data: offData });
                }
            }

            // ---------- 都没好 ----------
            if (attacks.length === 0) {
                const mainRemain = main ? this.getCooldownRemain(main) : 0;
                const offRemain = off ? this.getCooldownRemain(off) : 0;
                const remain = Math.min(
                    mainRemain || Infinity,
                    offRemain || Infinity
                );
                window.CombatUI?.flashCooldownHint?.(remain);
                return;
            }

            // ---------- 没武器 ----------
            if (!main && !off) {
                window.UIManager?.showText?.('没有装备武器', 1000);
                return;
            }

            // ---------- 逐个结算 ----------
            this._attacking = true;

            const player = window.MapCanvas?.player;

            // ★ 把朝向转成"世界方向"
            //   2D 模式：playerFacing 就是世界方向，直接返回
            //   3D 模式：playerFacing 是"按键语义"，结合相机转成世界方向
            const rawFacing = window.MapSprites?.playerFacing || 'down';
            const facing = window.CombatRender3D?.facingToWorld?.(rawFacing) || rawFacing;

            const map = window.MapLauncher?.getMap?.();

            for (const atk of attacks) {
                try {
                    await window.CombatResolver.executeAttack({
                        weapon: atk.weapon,
                        combatData: atk.data,
                        player,
                        facing,
                        map,
                    });
                    this._startCooldown(atk.weapon, atk.data.interval);
                } catch (e) {
                    console.error('[CombatState] 攻击结算失败:', e);
                }
            }

            this._lastAttackAt = performance.now();

            // 后摇：0.15 秒内不能再攻击（防止连点）
            setTimeout(() => {
                this._attacking = false;
            }, 150);
        },

        // ============================================================
        // 重置（切地图/退出时用）
        // ============================================================
        reset() {
            this._mode = 'walk';
            this._cooldowns = {};
            this._attacking = false;
            window.CombatUI?.onModeChange('walk');
        },
    };

    window.CombatState = CombatState;
    console.log('[CinemaWorld] combat-state.js 已加载');
})();