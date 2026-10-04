// ============================================================
// CinemaWorld · map-3d-interact.js
// 越肩视角交互：鼠标拖拽旋转、滚轮缩放、点击拾取、键盘转向
// 暴露：window.Map3DInteract
// ============================================================

(function () {
    'use strict';

    const Map3DInteract = {
        _renderer: null,
        _camera: null,
        _raycaster: null,
        _mouse: null,
        _container: null,

        // 拖拽旋转状态
        _dragging: false,
        _dragLast: { x: 0, y: 0 },

        // 触屏
        _touchLast: null,

        init(renderer, camera, container) {
            this._renderer = renderer;
            this._camera = camera;
            this._container = container;
            this._raycaster = new window.THREE.Raycaster();
            this._mouse = new window.THREE.Vector2();

            this._bind();
            console.log('[Map3DInteract] 已绑定（越肩视角）');
        },

        _bind() {
            const c = this._container;

            this._onDown = (e) => this._onDown_(e);
            this._onMove = (e) => this._onMove_(e);
            this._onUp = (e) => this._onUp_(e);
            this._onClick = (e) => this._onClick_(e);
            this._onWheel = (e) => this._onWheel_(e);
            this._onContext = (e) => e.preventDefault();

            c.addEventListener('mousedown', this._onDown);
            c.addEventListener('mousemove', this._onMove);
            c.addEventListener('mouseup', this._onUp);
            c.addEventListener('click', this._onClick);
            c.addEventListener('wheel', this._onWheel, { passive: false });
            c.addEventListener('contextmenu', this._onContext);

            this._onTouchStart = (e) => this._onTouchStart_(e);
            this._onTouchMove = (e) => this._onTouchMove_(e);
            this._onTouchEnd = (e) => this._onTouchEnd_(e);
            c.addEventListener('touchstart', this._onTouchStart, { passive: false });
            c.addEventListener('touchmove', this._onTouchMove, { passive: false });
            c.addEventListener('touchend', this._onTouchEnd);

            // ★★★ 关键：捕获阶段拦截键盘
            // ★ keydown + keyup 都要捕获
            this._onKey = (e) => this._onKey_(e);
            this._onKeyUp = (e) => this._onKeyUp_(e);
            window.addEventListener('keydown', this._onKey, true);
            window.addEventListener('keyup', this._onKeyUp, true);
        },
        _onKeyUp_(e) {
            if (!window.MapCanvas3D?._running) return;
        
            const k = e.key.toLowerCase();
            const CAPTURED = [
                'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
                'w', 'a', 's', 'd', 'q', 'e',
            ];
        
            if (CAPTURED.includes(k)) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
        
                // ★ 同步到 MapCanvas.keys
                if (window.MapCanvas?.keys) {
                    window.MapCanvas.keys[k] = false;
                }
            }
        },
        // ============================================================
        // 键盘：拦截方向键 + QE，避免 ST 主 UI 重复处理
        // ============================================================
        _onKey_(e) {
            if (!window.MapCanvas3D?._running) return;

            const k = e.key.toLowerCase();

            // ★ 3D 模式下要独占的按键
            const CAPTURED = [
                'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
                'w', 'a', 's', 'd', 'q', 'e',
            ];

            if (CAPTURED.includes(k)) {
                // ★ 三层拦截，确保 SillyTavern 主 UI 拿不到
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();

                if (window.MapCanvas?.keys) window.MapCanvas.keys[k] = tru
            }

            // 相机 90° 转向
            if (k === 'q') {
                window.Map3DCamera.rotateKey(-1);
            } else if (k === 'e') {
                window.Map3DCamera.rotateKey(1);
            }

            // WASD / 方向键由 MapCanvas._updateMovementOnly 读取 this.keys
            // 但前提是 2D 的 keydown handler 也能拿到 —— 不，我们刚刚 stopImmediatePropagation 了
            // 所以这里要主动把按键状态写进 MapCanvas.keys
            if (window.MapCanvas) {
                const KC = window.MapCanvas;
                if (KC.keys) {
                    if (CAPTURED.includes(k)) {
                        KC.keys[k] = true;
                        // 同时设一个"按键按下"标记，以便动画等使用
                    }
                }
            }
        },

        // ============================================================
        // 鼠标
        // ============================================================
        _onDown_(e) {
            // 左键或右键都触发旋转（左键也可以转视角）
            if (e.button === 0 || e.button === 2) {
                this._dragging = true;
                this._dragLast = { x: e.clientX, y: e.clientY };
                // 阻止默认行为（防止文本选中）
                e.preventDefault();
            }
        },

        _onMove_(e) {
            if (!this._dragging) return;
            const dx = e.clientX - this._dragLast.x;
            const dy = e.clientY - this._dragLast.y;
            this._dragLast = { x: e.clientX, y: e.clientY };
            window.Map3DCamera.rotate(dx, dy);
        },

        _onUp_(e) {
            this._dragging = false;
        },

        _onClick_(e) {
            // 拖拽后不触发点击
            if (this._dragged) {
                this._dragged = false;
                return;
            }

            this._getNDC(e);
            this._raycaster.setFromCamera(this._mouse, this._camera);

            // ============================================================
            // 1. ★ 先检查"建筑门"标记
            // ============================================================
            const doors = window.MapCanvas3D._entityGroup.children.filter(
                o => o.userData?._isBuildingEntrance
            );
            if (doors.length > 0) {
                const doorHits = this._raycaster.intersectObjects(doors, true);
                if (doorHits.length > 0) {
                    const hit = doorHits[0].object;
                    const buildingId = hit.userData?._buildingId || hit.parent?.userData?._buildingId;
                    const buildingName = hit.userData?._buildingName || hit.parent?.userData?._buildingName;
                    if (buildingId && buildingName) {
                        console.log('[Map3DInteract] 点击门:', buildingName);
                        window.MapInteract?.enterBuilding?.(buildingId, buildingName);
                        return;
                    }
                }
            }

            // ============================================================
            // 2. 实体（建筑走"寻路"，其他打开详情）
            // ============================================================
            const entityHits = this._raycaster.intersectObjects(
                window.MapCanvas3D._entityGroup.children,
                true
            );
            if (entityHits.length > 0) {
                const hit = entityHits[0].object;
                let entId = hit.userData?._entityId || hit.parent?.userData?._entityId;

                if (entId) {
                    const map = window.MapLauncher?.getMap?.();
                    const ent = map?.entities?.find(en => en.id === entId);

                    if (ent) {
                        // ★ 建筑 → 走"寻路到门口"
                        if (ent.kind === 'building') {
                            if (ent.entrance) {
                                const target = window.MapCanvas?._findNearestWalkable?.(
                                    ent.entrance.x, ent.entrance.y
                                );
                                if (target) {
                                    window.MapCanvas._setClickPath(target.x, target.y);
                                }
                            }
                            return;
                        }
                        // ★ portal → 直接触发进入
                        if (ent.kind === 'portal') {
                            console.log('[Map3DInteract] 点击 portal:', ent.name);
                            window.MapInteract?.enterPortal?.(ent.id);
                            return;
                        }
                        // 其他实体 → 打开详情
                        if (!ent.isPlayer) {
                            console.log('[Map3DInteract] 点击实体:', ent.name);
                            window.MapEntityPanel?.openDetail?.(ent.id);
                            return;
                        }
                    }
                }
            }

            // ============================================================
            // 3. 玩法区
            // ============================================================
            const plotHits = this._raycaster.intersectObjects(
                window.MapCanvas3D._plotGroup.children,
                true
            );
            if (plotHits.length > 0) {
                const hit = plotHits[0].object;
                let plotId = hit.userData?._plotId || hit.parent?.userData?._plotId;
                if (plotId) {
                    console.log('[Map3DInteract] 点击玩法区:', plotId);
                    window.MapPlotManager?.selectPlot?.(plotId);
                    return;
                }
            }

            // ============================================================
            // 4. 地面（先检查是不是门格）
            // ============================================================
            const groundHits = this._raycaster.intersectObjects(
                window.MapCanvas3D._groundGroup.children,
                true
            );
            if (groundHits.length > 0) {
                const p = groundHits[0].point;
                const { gx, gy } = window.MapCanvas3D.worldToGrid(p.x, p.z);
                console.log('[Map3DInteract] 点击地面:', gx, gy);

                // ★ 目标格是不是门
                const map = window.MapLauncher?.getMap?.();
                const cell = map?._generated?.grid?.[gy]?.[gx];
                if (cell?.portal?.kind === 'building') {
                    console.log('[Map3DInteract] 点击建筑门格:', cell.portal.buildingName);
                    window.MapInteract?.enterBuilding?.(
                        cell.portal.buildingId,
                        cell.portal.buildingName
                    );
                    return;
                }

                // 走路径
                const target = window.MapCanvas?._findNearestWalkable?.(gx, gy);
                if (target) {
                    window.MapCanvas._setClickPath(target.x, target.y);
                }
            }
        },

        _onWheel_(e) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 1 : -1;
            window.Map3DCamera.zoom(delta * 0.6);
        },

        // ============================================================
        // 触屏
        // ============================================================
        _onTouchStart_(e) {
            if (e.touches.length === 1) {
                this._touchLast = {
                    x: e.touches[0].clientX,
                    y: e.touches[0].clientY,
                    startX: e.touches[0].clientX,
                    startY: e.touches[0].clientY,
                    moved: false,
                };
            } else if (e.touches.length === 2) {
                const t1 = e.touches[0], t2 = e.touches[1];
                this._touchLast = {
                    pinchDist: Math.hypot(
                        t1.clientX - t2.clientX,
                        t1.clientY - t2.clientY
                    ),
                    center: {
                        x: (t1.clientX + t2.clientX) / 2,
                        y: (t1.clientY + t2.clientY) / 2,
                    },
                };
            }
        },

        _onTouchMove_(e) {
            if (e.touches.length === 1 && this._touchLast) {
                const t = e.touches[0];
                const dx = t.clientX - this._touchLast.x;
                const dy = t.clientY - this._touchLast.y;
                if (Math.abs(dx) + Math.abs(dy) > 3) this._touchLast.moved = true;
                this._touchLast.x = t.clientX;
                this._touchLast.y = t.clientY;
                window.Map3DCamera.rotate(dx * 1.5, dy * 1.5);
                e.preventDefault();
            } else if (e.touches.length === 2 && this._touchLast) {
                const t1 = e.touches[0], t2 = e.touches[1];
                const dist = Math.hypot(
                    t1.clientX - t2.clientX,
                    t1.clientY - t2.clientY
                );
                const delta = (this._touchLast.pinchDist - dist) * 0.02;
                if (Math.abs(delta) > 0.1) {
                    window.Map3DCamera.zoom(delta);
                }
                this._touchLast.pinchDist = dist;
                e.preventDefault();
            }
        },

        _onTouchEnd_(e) {
            // 单击（没移动）→ 触发点击
            if (this._touchLast && !this._touchLast.moved) {
                const t = e.changedTouches[0];
                if (t) {
                    const fakeEvent = {
                        clientX: t.clientX,
                        clientY: t.clientY,
                        button: 0,
                        preventDefault: () => { },
                    };
                    this._onClick_(fakeEvent);
                }
            }
            this._touchLast = null;
        },

        // ============================================================
        // 键盘：Q/E 转向
        // ============================================================
        _onKey_(e) {
            // 只在 3D 模式响应
            if (!window.MapCanvas3D?._running) return;
            const k = e.key.toLowerCase();
            if (k === 'q') {
                window.Map3DCamera.rotateKey(-1, 2);
                e.preventDefault();
            } else if (k === 'e') {
                window.Map3DCamera.rotateKey(1, 2);
                e.preventDefault();
            }
        },

        // ============================================================
        // 工具
        // ============================================================
        _getNDC(e) {
            const rect = this._container.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            this._mouse.set(x, y);
        },

        destroy() {
            const c = this._container;
            if (!c) return;
            c.removeEventListener('mousedown', this._onDown);
            c.removeEventListener('mousemove', this._onMove);
            c.removeEventListener('mouseup', this._onUp);
            c.removeEventListener('click', this._onClick);
            c.removeEventListener('wheel', this._onWheel);
            c.removeEventListener('contextmenu', this._onContext);
            c.removeEventListener('touchstart', this._onTouchStart);
            c.removeEventListener('touchmove', this._onTouchMove);
            c.removeEventListener('touchend', this._onTouchEnd);
            window.removeEventListener('keydown', this._onKey);
        },
    };

    window.Map3DInteract = Map3DInteract;
    console.log('[CinemaWorld] map-3d-interact.js 已加载');
})();