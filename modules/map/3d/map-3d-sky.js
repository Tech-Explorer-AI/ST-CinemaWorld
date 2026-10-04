// ============================================================
// CinemaWorld · map-3d-sky.js
// 程序化天空 + 星空（0 纹理，1 draw call，性能极低）
// 时段变化：进图时算一次 + 每游戏小时检查一次
// 暴露：window.Map3DSky
// ============================================================

(function () {
    'use strict';

    const Map3DSky = {
        THREE: null,
        mesh: null,
        uniforms: null,
        _scene: null,
        _ambient: null,
        _sun: null,

        // ============================================================
        // 时段列表
        // ============================================================
        _SEGMENTS: [
            { id: 'night',     from: 0,  to: 5  },
            { id: 'dawn',      from: 5,  to: 7  },
            { id: 'morning',   from: 7,  to: 10 },
            { id: 'noon',      from: 10, to: 15 },
            { id: 'afternoon', from: 15, to: 18 },
            { id: 'dusk',      from: 18, to: 20 },
            { id: 'evening',   from: 20, to: 24 },
        ],

        // ============================================================
        // 关键帧：按小时定义天空 / 太阳 / 环境光
        // ============================================================
        KEYFRAMES: [
            { hour: 0,    top: 0x05060f, mid: 0x0a1020, bot: 0x0a1020, sun: 0x304060, sunI: 0.0,  stars: 1.0, ambient: 0x223355, ambientI: 0.35 },
            { hour: 4.5,  top: 0x0a0e1a, mid: 0x1a2030, bot: 0x1a2030, sun: 0x405080, sunI: 0.0,  stars: 0.9, ambient: 0x2a3a5a, ambientI: 0.4  },
            { hour: 6,    top: 0x2a3a6a, mid: 0x6a5a8a, bot: 0x6a5a8a, sun: 0xff9060, sunI: 0.6,  stars: 0.3, ambient: 0x6a5a7a, ambientI: 0.6  },
            { hour: 7.5,  top: 0x4a7ad0, mid: 0xa0b8e8, bot: 0xa0b8e8, sun: 0xffc090, sunI: 1.0,  stars: 0.0, ambient: 0xc0d0e8, ambientI: 0.9  },
            { hour: 12,   top: 0x3a7ad0, mid: 0x8ab0e0, bot: 0x8ab0e0, sun: 0xffffff, sunI: 1.4,  stars: 0.0, ambient: 0xffffff, ambientI: 1.0  },
            { hour: 16,   top: 0x4a80c0, mid: 0x9ab8d8, bot: 0x9ab8d8, sun: 0xffe0a0, sunI: 1.2,  stars: 0.0, ambient: 0xffe0c0, ambientI: 1.0  },
            { hour: 18.5, top: 0x3a4a8a, mid: 0x8a6a8a, bot: 0x8a6a8a, sun: 0xff7040, sunI: 0.8,  stars: 0.1, ambient: 0xa08080, ambientI: 0.7  },
            { hour: 19.5, top: 0x1a1a4a, mid: 0x3a3050, bot: 0x3a3050, sun: 0x805080, sunI: 0.3,  stars: 0.5, ambient: 0x5a4a7a, ambientI: 0.5  },
            { hour: 21,   top: 0x0a0e1e, mid: 0x1a2030, bot: 0x3a4050, sun: 0x405080, sunI: 0.05, stars: 0.9, ambient: 0x2a3a5a, ambientI: 0.4  },
            { hour: 24,   top: 0x05060f, mid: 0x0a1020, bot: 0x1a2030, sun: 0x304060, sunI: 0.0,  stars: 1.0, ambient: 0x223355, ambientI: 0.35 },
        ],

        _lastSegment: null,
        _lastHour: null,

        // ============================================================
        // 初始化
        // ============================================================
        init(THREE, scene, ambient, sun) {
            this.THREE = THREE;
            this._scene = scene;
            this._ambient = ambient || null;
            this._sun = sun || null;

            const RADIUS = 400;
            const geo = new THREE.SphereGeometry(RADIUS, 48, 32);

            const uniforms = {
                uTop:         { value: new THREE.Color(0x1a2a5a) },
                uMid:         { value: new THREE.Color(0x4a6aaa) },
                uBottom:      { value: new THREE.Color(0x9ab8e0) },
                uSunDir:      { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },
                uSunColor:    { value: new THREE.Color(0xffd0a0) },
                uSunI:        { value: 1.0 },
                uStars:       { value: 0.0 },
                uTime:        { value: 0.0 },
                uStarDensity: { value: 0.94 },
            };
            this.uniforms = uniforms;

            const mat = new THREE.ShaderMaterial({
                side: THREE.BackSide,
                depthWrite: false,
                depthTest: true,
                fog: false,
                uniforms,

                vertexShader: `
                    varying vec3 vDir;
                    void main() {
                        vDir = normalize(position);
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,

                fragmentShader: `
                    uniform vec3 uTop;
                    uniform vec3 uMid;
                    uniform vec3 uBottom;
                    uniform vec3 uSunDir;
                    uniform vec3 uSunColor;
                    uniform float uSunI;
                    uniform float uStars;
                    uniform float uTime;
                    uniform float uStarDensity;

                    varying vec3 vDir;

                    float hash21(vec2 p) {
                        p = fract(p * vec2(123.34, 456.21));
                        p += dot(p, p + 45.32);
                        return fract(p.x * p.y);
                    }

                    float stars(vec3 dir) {
                        vec2 uv = vec2(
                            atan(dir.z, dir.x) / 6.2831853 + 0.5,
                            asin(clamp(dir.y, -1.0, 1.0)) / 3.1415926 + 0.5
                        );

                        float s = 0.0;

                        for (int i = 0; i < 3; i++) {
                            float scale = 60.0 + float(i) * 90.0;
                            vec2 p = uv * scale;
                            vec2 ip = floor(p);
                            vec2 fp = fract(p);

                            float rnd = hash21(ip + float(i) * 13.7);
                            if (rnd > uStarDensity) {
                                vec2 starPos = vec2(
                                    hash21(ip + 1.3),
                                    hash21(ip + 7.7)
                                );
                                float d = length(fp - starPos);
                                float brightness = (rnd - uStarDensity) / (1.0 - uStarDensity);
                                float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + rnd * 20.0);
                                s += smoothstep(0.05, 0.0, d) * brightness * twinkle;
                            }
                        }

                        {
                            vec2 p = uv * 25.0;
                            vec2 ip = floor(p);
                            vec2 fp = fract(p);
                            float rnd = hash21(ip + 42.0);
                            if (rnd > 0.97) {
                                vec2 starPos = vec2(hash21(ip + 3.1), hash21(ip + 9.4));
                                float d = length(fp - starPos);
                                float twinkle = 0.8 + 0.2 * sin(uTime * 3.0 + rnd * 30.0);
                                s += smoothstep(0.08, 0.0, d) * 2.0 * twinkle;
                            }
                        }

                        return s;
                    }

                    void main() {
                        vec3 dir = normalize(vDir);
                        float h = dir.y;

                        vec3 sky;
                        if (h > 0.0) {
                            sky = mix(uBottom, uMid, smoothstep(0.0, 0.35, h));
                            sky = mix(sky, uTop, smoothstep(0.35, 1.0, h));
                        } else {
                            sky = mix(uBottom, uBottom * 0.7, smoothstep(0.0, -1.0, h));
                        }

                        if (uSunI > 0.001) {
                            float sunDot = max(dot(dir, uSunDir), 0.0);
                            float glow  = pow(sunDot, 16.0) * 0.4;
                            float glow2 = pow(sunDot, 128.0) * 0.8;
                            float disk  = smoothstep(0.9988, 0.9997, sunDot);
                            sky += uSunColor * (glow + glow2 + disk * 3.0) * uSunI;
                        }

                        if (uStars > 0.01) {
                            float s = stars(dir);
                            s *= smoothstep(-0.15, 0.25, h);
                            sky += vec3(s) * uStars;
                        }

                        gl_FragColor = vec4(sky, 1.0);
                    }
                `,
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.frustumCulled = false;
            mesh.renderOrder = -1000;
            mesh.matrixAutoUpdate = false;
            scene.add(mesh);

            this.mesh = mesh;

            // ★ 进图时先应用一次
            const hour = this._getWorldHour();
            this._lastSegment = this._getSegment(hour);
            this._lastHour = hour;
            this.applyHour(hour);

            console.log(`[Map3DSky] 已初始化，当前时段: ${this._lastSegment} (${hour.toFixed(1)}h)`);
            return mesh;
        },

        // ============================================================
        // 从世界状态取当前小时（0~24 浮点）
        // ============================================================
        _getWorldHour() {
            const map = window.MapLauncher?.getMap?.();
            if (map && window.CWEnv?.ensureEnvData && window.CWEnv?.parseTotalMinutes) {
                try {
                    const env = window.CWEnv.ensureEnvData(map);
                    const totalMin = window.CWEnv.parseTotalMinutes(env);
                    if (typeof totalMin === 'number' && !isNaN(totalMin)) {
                        return (totalMin / 60) % 24;
                    }
                } catch (e) { /* 忽略 */ }
            }
            const d = new Date();
            return d.getHours() + d.getMinutes() / 60;
        },

        // ============================================================
        // 判断小时属于哪个时段
        // ============================================================
        _getSegment(hour) {
            for (const seg of this._SEGMENTS) {
                if (hour >= seg.from && hour < seg.to) return seg.id;
            }
            return 'night';
        },

        // ============================================================
        // 根据小时插值出目标颜色
        // ============================================================
        _computeSky(hour) {
            const T = this.THREE;
            const KF = this.KEYFRAMES;
            if (!KF?.length) return null;

            let a = KF[0], b = KF[KF.length - 1];
            for (let i = 0; i < KF.length - 1; i++) {
                if (hour >= KF[i].hour && hour <= KF[i + 1].hour) {
                    a = KF[i]; b = KF[i + 1];
                    break;
                }
            }
            const span = (b.hour - a.hour) || 1;
            const t = Math.max(0, Math.min(1, (hour - a.hour) / span));

            const lerpColor = (ha, hb) => {
                const ca = new T.Color(ha);
                const cb = new T.Color(hb);
                return ca.lerp(cb, t);
            };
            const lerp = (va, vb) => va + (vb - va) * t;

            const angle = ((hour - 6) / 12) * Math.PI;
            const sunDir = new T.Vector3(
                Math.cos(angle),
                Math.sin(angle),
                0.3
            ).normalize();

            return {
                top:      lerpColor(a.top, b.top),
                mid:      lerpColor(a.mid, b.mid),
                bot:      lerpColor(a.bot, b.bot),
                sun:      lerpColor(a.sun, b.sun),
                sunI:     lerp(a.sunI, b.sunI),
                stars:    lerp(a.stars, b.stars),
                ambient:  lerpColor(a.ambient, b.ambient),
                ambientI: lerp(a.ambientI, b.ambientI),
                sunDir,
            };
        },

        // ============================================================
        // 应用（无平滑，时段切换时用）
        // ============================================================
        applyHour(hour) {
            if (!this.mesh) return;
            const target = this._computeSky(hour);
            if (!target) return;

            const u = this.uniforms;
            u.uTop.value.copy(target.top);
            u.uMid.value.copy(target.mid);
            u.uBottom.value.copy(target.bot);
            u.uSunColor.value.copy(target.sun);
            u.uSunI.value = target.sunI;
            u.uStars.value = target.stars;
            u.uSunDir.value.copy(target.sunDir);

            if (this._ambient) {
                this._ambient.color.copy(target.ambient);
                this._ambient.intensity = target.ambientI;
            }
            if (this._sun) {
                this._sun.color.copy(target.sun);
                this._sun.intensity = target.sunI * 1.2;
                this._sun.position.copy(target.sunDir).multiplyScalar(80);
            }

            this._lastHour = hour;
        },

        // ============================================================
        // ★ 检查当前时段，变了就应用
        //   进图时调一次 + 每游戏小时调一次
        // ============================================================
        checkNow() {
            if (!this.mesh) return;

            const hour = this._getWorldHour();
            const seg = this._getSegment(hour);

            // 时段没变 → 直接返回（99% 的调用走这里）
            if (seg === this._lastSegment) return;

            console.log(`[Map3DSky] 时段: ${this._lastSegment} → ${seg} (${hour.toFixed(1)}h)`);
            this._lastSegment = seg;
            this.applyHour(hour);
        },

        // ============================================================
        // 每帧：天空球跟随相机
        // ============================================================
        follow(camera) {
            if (!this.mesh) return;
            this.mesh.position.copy(camera.position);
            this.mesh.updateMatrix();
        },

        // ============================================================
        // 每帧：更新 time（星星闪烁）
        // ============================================================
        tick(time) {
            if (this.uniforms) {
                this.uniforms.uTime.value = time % 1000;
            }
        },

        // ============================================================
        // 销毁
        // ============================================================
        destroy() {
            if (this.mesh) {
                this.mesh.geometry.dispose();
                this.mesh.material.dispose();
                this.mesh.parent?.remove(this.mesh);
                this.mesh = null;
            }
            this.uniforms = null;
            this._scene = null;
            this._ambient = null;
            this._sun = null;
            this._lastSegment = null;
            this._lastHour = null;
            console.log('[Map3DSky] 已销毁');
        },
    };

    window.Map3DSky = Map3DSky;
    console.log('[CinemaWorld] map-3d-sky.js 已加载');
})();