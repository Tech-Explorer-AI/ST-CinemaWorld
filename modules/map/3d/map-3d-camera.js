// ============================================================
// CinemaWorld · map-3d-camera.js
// 越肩视角相机：在玩家背后，玩家可旋转
// 暴露：window.Map3DCamera
// ============================================================

(function () {
    'use strict';

    const Map3DCamera = {
        camera: null,
        _target: null,
        _targetSmooth: null,

        // 相机参数
        _yaw: 0,                    // 水平角（相机在玩家背后的方向）
        _pitch: 0.28,               // 俯角（弧度）
        _distance: 7,               // 距离
        _height: 2.0,               // 高度偏移（看向玩家胸口）

        // 吸附
        _snapTargetYaw: null,

        // 平滑
        _smoothYaw: 0,
        _smoothPitch: 0.28,
        _smoothDist: 7,
        _smoothLerp: 0.12,

        // 边界
        PITCH_MIN: -0.5,
        PITCH_MAX: 1.3, 
        DIST_MIN: 3,
        DIST_MAX: 20,

        // ============================================================
        // 初始化
        // ============================================================
        init(THREE, aspect) {
            this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 500);
            this._target = new THREE.Vector3(0, 0, 0);
            this._targetSmooth = new THREE.Vector3(0, 0, 0);
            this._apply();
            return this.camera;
        },

        // ============================================================
        // 目标位置（玩家位置）
        // ============================================================
        setTarget(x, y, z, instant = false) {
            if (!this._target) return;
            this._target.set(x, y, z);
            if (instant) {
                this._targetSmooth.copy(this._target);
                this._apply();
            }
        },

        // ============================================================
        // 旋转（鼠标拖拽）
        // ============================================================
        rotate(dx, dy) {
            this._yaw -= dx * 0.005;
            this._pitch = Math.max(
                this.PITCH_MIN,
                Math.min(this.PITCH_MAX, this._pitch + dy * 0.005)
            );
        },

        // ============================================================
        // 旋转键盘（QE，每次 90°）
        // ============================================================
        rotateKey(direction) {
            const snap = Math.PI / 2;
            this._snapTargetYaw = Math.round(this._yaw / snap) * snap + direction * snap;
        },

        // ============================================================
        // 缩放
        // ============================================================
        zoom(delta) {
            this._distance = Math.max(
                this.DIST_MIN,
                Math.min(this.DIST_MAX, this._distance + delta)
            );
        },

        // ============================================================
        // 视角预设
        // ============================================================
        setPreset(name) {
            switch (name) {
                case 'over-shoulder': this._pitch = 0.28; this._distance = 7; break;
                case 'wide':          this._pitch = 0.5;  this._distance = 12; break;
                case 'close':         this._pitch = 0.2;  this._distance = 4; break;
                case 'top-down':      this._pitch = 0.85; this._distance = 14; break;
            }
        },

        // ============================================================
        // 每帧调用（更新平滑 + 相机）
        // ★ 只能有一个 update！
        // ============================================================
        update(dt) {
            if (!this.camera || !this._target) return;
            if (dt === undefined) dt = 1 / 60;   // 兜底
            if (dt > 0.1) dt = 0.1;              // 防止 tab 切回来时大跳
        
            // ---------- 吸附（QE 转 90°）----------
            if (this._snapTargetYaw !== null && this._snapTargetYaw !== undefined) {
                let diff = this._snapTargetYaw - this._yaw;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                if (Math.abs(diff) < 0.005) {
                    this._yaw = this._snapTargetYaw;
                    this._snapTargetYaw = null;
                } else {
                    // 按时间：2 秒内转完
                    this._yaw += diff * Math.min(1, dt * 6);
                }
            }
        
            // ---------- 按时间计算平滑系数 ----------
            // halfLife = 0.08 秒 → 系数 ≈ 0.15 @ 60fps
            const kTarget = this._smoothFactor(dt, 0.06);
            const kYaw    = this._smoothFactor(dt, 0.05);
            const kPitch  = this._smoothFactor(dt, 0.08);
            const kDist   = this._smoothFactor(dt, 0.08);
        
            // ---------- 目标位置平滑 ----------
            this._targetSmooth.lerp(this._target, kTarget);
        
            // ---------- yaw 平滑 ----------
            let yawDelta = this._yaw - this._smoothYaw;
            while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
            while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
            this._smoothYaw += yawDelta * kYaw;
        
            // ---------- pitch / dist ----------
            this._smoothPitch += (this._pitch - this._smoothPitch) * kPitch;
            this._smoothDist += (this._distance - this._smoothDist) * kDist;
        
            this._apply();
        },
        
        // ============================================================
        // 按时间算平滑系数
        //   halfLife: 半衰期（秒）。值越小越快
        //   dt: 帧间隔（秒）
        // ============================================================
        _smoothFactor(dt, halfLife) {
            if (halfLife <= 0) return 1;
            return 1 - Math.pow(0.5, dt / halfLife);
        },
        
        // ============================================================
        // 应用相机位置
        // ============================================================
        _apply() {
            if (!this.camera) return;

            const p = this._targetSmooth;
            const yaw = this._smoothYaw;
            const pitch = this._smoothPitch;
            const dist = this._smoothDist;

            // 相机位置：在玩家背后上方
            const offsetX = Math.sin(yaw) * Math.cos(pitch) * dist;
            const offsetY = Math.sin(pitch) * dist + this._height;
            const offsetZ = Math.cos(yaw) * Math.cos(pitch) * dist;

            this.camera.position.set(
                p.x + offsetX,
                p.y + offsetY,
                p.z + offsetZ
            );

            this.camera.lookAt(p.x, p.y + 0.6, p.z);
        },

        // ============================================================
        // 相机前方（世界方向）
        // ============================================================
        getForward() {
            const yaw = this._smoothYaw;
            return {
                x: -Math.sin(yaw),
                z: -Math.cos(yaw),
            };
        },

        // ============================================================
        // 相机右方（世界方向）
        // ============================================================
        getRight() {
            const yaw = this._smoothYaw;
            return {
                x: Math.cos(yaw),
                z: -Math.sin(yaw),
            };
        },

        // ============================================================
        // 瞬时定位（切到 3D 瞬间）
        // ============================================================
        snapToPlayer(playerWorldPos) {
            this._target.copy(playerWorldPos);
            this._targetSmooth.copy(playerWorldPos);
            this._apply();
        },

        // ============================================================
        // 销毁
        // ============================================================
        destroy() {
            this.camera = null;
            this._target = null;
            this._targetSmooth = null;
        },
    };

    window.Map3DCamera = Map3DCamera;
    console.log('[CinemaWorld] map-3d-camera.js 已加载');
})();