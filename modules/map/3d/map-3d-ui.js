// ============================================================
// CinemaWorld · map-3d-ui.js
// 3D 按钮 + 模式切换
// 暴露：window.Map3DUI
// ============================================================

(function () {
    'use strict';

    const Map3DUI = {
        _mode: '2d',           // '2d' | '3d'
        _container: null,
        _inited: false,

        // ★ 切地图时的状态保存
        _pendingReenter: false,

        // ============================================================
        // 初始化：等待地图窗口出现，插入 3D 按钮
        // ============================================================
        init() {
            if (this._inited) return;
            this._inited = true;

            // 监听地图窗口打开
            window.addEventListener('cw:map-opened', () => this._injectButton());
            // 兜底：轮询（防止事件不触发）
            setInterval(() => this._injectButton(), 800);

            console.log('[Map3DUI] 已初始化');
        },

        // ============================================================
        // 切地图前调用（由 MapLauncher._renderMapWindow 触发）
        //   - 保存当前是否处于 3D
        //   - 主动销毁 3D（避免僵尸 renderer）
        //   - 重置 _mode 为 2d，让下次 _enter3D 能正常进入
        // ============================================================
        onMapWillChange() {
            if (this._mode !== '3d') return;

            console.log('[Map3DUI] 地图即将切换，保存 3D 状态');
            this._pendingReenter = true;

            // 主动销毁 3D 资源
            try { window.Map3DInteract?.destroy?.(); } catch (e) { }
            try { window.MapCanvas3D?.destroy?.(); } catch (e) { }

            // 清掉残留 DOM
            document.getElementById('cw-3d-info')?.remove();
            const old3d = document.getElementById('cw-map-3d-container');
            if (old3d) old3d.remove();

            // 重置模式
            this._mode = '2d';
            this._container = null;

            // 按钮文案复位（下次 _injectButton 会重新注入）
            const btn = document.getElementById('cw-map-3d-btn');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🎮 3D 视角';
            }
        },

        // ============================================================
        // 切地图后调用（由 MapLauncher._renderMapWindow 触发）
        //   - 如果之前在 3D，重新进入
        // ============================================================
        onMapChanged() {
            if (!this._pendingReenter) return;
            this._pendingReenter = false;

            console.log('[Map3DUI] 地图切换完成，准备重新进入 3D');

            // 等两帧，让 2D canvas 先初始化好，3D 容器才存在
            setTimeout(() => {
                // 前置检查：地图数据、2D canvas 都就绪
                const map = window.MapLauncher?.getMap?.();
                if (!map?._generated) {
                    console.warn('[Map3DUI] 地图未就绪，取消重进 3D');
                    return;
                }
                if (!window.MapCanvas?.canvas) {
                    console.warn('[Map3DUI] 2D canvas 未就绪，取消重进 3D');
                    return;
                }

                this._enter3D();
            }, 200);
        },

        // ============================================================
        // 在地图窗口按钮栏插入 3D 按钮
        // ============================================================
        _injectButton() {
            const bar = document.getElementById('cw-map-list-btn')?.parentElement;
            if (!bar) return;

            // 已有按钮 → 只更新文案
            const existing = document.getElementById('cw-map-3d-btn');
            if (existing) {
                existing.textContent = this._mode === '3d' ? '🖼️ 切回 2D' : '🎮 3D 视角';
                return;
            }

            const btn = document.createElement('button');
            btn.id = 'cw-map-3d-btn';
            btn.className = 'cinemaworld-button';
            btn.textContent = this._mode === '3d' ? '🖼️ 切回 2D' : '🎮 3D 视角';
            btn.style.cssText = 'background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;';
            btn.onclick = () => this.toggle();

            bar.appendChild(btn);
            console.log('[Map3DUI] 3D 按钮已注入');
        },

        // ============================================================
        // 切换 2D / 3D
        // ============================================================
        async toggle() {
            if (this._mode === '3d') {
                this._exit3D();
            } else {
                await this._enter3D();
            }
        },

        async _enter3D() {
            // ★ 已 3D → 不重复进
            if (this._mode === '3d') return;

            const map = window.MapLauncher?.getMap?.();
            if (!map?._generated) {
                window.UIManager?.showText?.('地图未准备好', 1500);
                return;
            }

            const btn = document.getElementById('cw-map-3d-btn');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ 加载 Three.js...';
            }

            try {
                // 1. 加载 Three.js
                await window.CWThree.load();

                // 2. 准备容器
                const canvasContainer = document.getElementById('cw-map-canvas-container');
                if (!canvasContainer) {
                    throw new Error('找不到地图容器');
                }

                // 3. 隐藏 2D canvas（不销毁）
                if (window.MapCanvas?.canvas) {
                    window.MapCanvas.canvas.style.display = 'none';
                    window.MapCanvas._renderEnabled = false;
                }

                // 4. 创建 3D 容器
                let container3d = document.getElementById('cw-map-3d-container');
                if (!container3d) {
                    container3d = document.createElement('div');
                    container3d.id = 'cw-map-3d-container';
                    container3d.style.cssText = `
                        position: absolute;
                        inset: 0;
                        width: 960px;
                        height: 720px;
                        overflow: hidden;
                        background: #0d0d18;
                        z-index: 5;
                    `;
                    canvasContainer.appendChild(container3d);
                }
                container3d.style.display = 'block';
                // ★ 昼夜叠加层（DOM，mix-blend-mode: multiply）
                let nightDiv = document.getElementById('cw-3d-night');
                if (!nightDiv) {
                    nightDiv = document.createElement('div');
                    nightDiv.id = 'cw-3d-night';
                    nightDiv.style.cssText = `
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 10;
        display: none;
        mix-blend-mode: multiply;
        will-change: background;
    `;
                    container3d.appendChild(nightDiv);
                }
                // 5. 初始化 3D
                const ok = await window.MapCanvas3D.init(container3d, map, {
                    tileSize: 2,
                });
                if (!ok) throw new Error('3D 初始化失败');

                // 6. 信息面板
                const infoEl = document.createElement('div');
                infoEl.id = 'cw-3d-info';
                infoEl.style.cssText = `
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    padding: 8px 12px;
                    background: rgba(0,0,0,0.7);
                    color: #fff;
                    font-family: monospace;
                    font-size: 12px;
                    border-radius: 6px;
                    pointer-events: none;
                    z-index: 100;
                `;
                container3d.style.position = 'relative';
                container3d.appendChild(infoEl);

                // 7. 绑定交互
                window.Map3DInteract.init(
                    window.MapCanvas3D.renderer,
                    window.MapCanvas3D._camera,
                    container3d
                );

                // 8. 更新按钮
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '🖼️ 切回 2D';
                }

                this._mode = '3d';
                this._container = container3d;

                // 9. 提示
                window.UIManager?.showText?.('🎮 3D 视角\n右键拖拽旋转 · 滚轮缩放', 2500);

            } catch (e) {
                console.error('[Map3DUI] 进入 3D 失败:', e);
                window.UIManager?.showText?.('❌ 3D 加载失败：' + e.message, 3000);

                // 回退 2D
                if (window.MapCanvas?.canvas) {
                    window.MapCanvas.canvas.style.display = 'block';
                    window.MapCanvas._renderEnabled = true;
                }

                const btn2 = document.getElementById('cw-map-3d-btn');
                if (btn2) {
                    btn2.disabled = false;
                    btn2.textContent = '🎮 3D 视角';
                }

                this._mode = '2d';
                this._container = null;
            }
        },

        _exit3D() {
            try {
                window.Map3DInteract.destroy();
            } catch (e) { }
            try {
                window.MapCanvas3D.destroy();
            } catch (e) { }

            document.getElementById('cw-3d-info')?.remove();
            const container3d = document.getElementById('cw-map-3d-container');
            if (container3d) container3d.style.display = 'none';

            // ★★★ 复位 2D
            const MC = window.MapCanvas;
            if (MC) {
                if (typeof MC.resumeFrom3D === 'function') {
                    MC.resumeFrom3D();
                } else {
                    // 兜底：老版本
                    MC._renderEnabled = true;
                    MC._dirty = true;
                    if (MC.canvas) {
                        MC.canvas.style.display = 'block';
                        MC.canvas.style.visibility = 'visible';
                    }
                    if (!MC._running) {
                        MC._running = true;
                        MC._loop?.();
                    }
                }

                // ★ 清空残留按键状态（防止卡方向）
                if (MC.keys) {
                    for (const k of Object.keys(MC.keys)) MC.keys[k] = false;
                }
            }
            document.getElementById('cw-3d-night')?.remove();
            const btn = document.getElementById('cw-map-3d-btn');
            if (btn) btn.textContent = '🎮 3D 视角';

            this._mode = '2d';
            this._container = null;

            window.UIManager?.showText?.('🖼️ 已切回 2D', 1200);
        },

        // 地图窗口关闭时（真正关闭，不是切换）
        onMapClosed() {
            this._pendingReenter = false;   // ★ 清除待重进状态
            if (this._mode === '3d') {
                this._exit3D();
            }
        },
    };

    // 挂载
    window.Map3DUI = Map3DUI;

    // 等 DOM 就绪后启动
    function boot() {
        Map3DUI.init();

        // 监听地图关闭事件
        window.addEventListener('cw:map-closed', () => Map3DUI.onMapClosed());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld] map-3d-ui.js 已加载');
})();