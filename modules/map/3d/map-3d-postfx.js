// ============================================================
// CinemaWorld · map-3d-postfx.js
// 3D 后处理：ACES 色调映射 + Bloom + FXAA + 暗角
//   挂到 MapCanvas3D 的渲染管线上，不改原代码
// 暴露：window.Map3DPostFX
// ============================================================

(function () {
    'use strict';

    if (window.Map3DPostFX) return;

    const Map3DPostFX = {
        // ============================================================
        // 可调参数
        // ============================================================
        CFG: {
            enabled: true,

            // ---------- ACES 色调映射 ----------
            toneMapping: true,
            exposure: 1.05,

            // ---------- Bloom ----------
            bloom: true,
            bloomStrength: 0.55,      // 整体强度
            bloomRadius: 0.5,         // 扩散半径
            bloomThreshold: 0.85,     // 亮度阈值（只有高于此值的像素才发光）

            // ---------- FXAA ----------
            fxaa: true,

            // ---------- 暗角 ----------
            vignette: true,
            vignetteStrength: 0.35,   // 0~1
            vignetteRadius: 0.75,     // 从中心到边缘的开始位置
        },

        // 运行时
        THREE: null,
        _installed: false,
        _originalRender: null,

        // 后处理管线
        _composer: null,
        _renderPass: null,
        _bloomPass: null,
        _fxaaPass: null,
        _vignettePass: null,
        _outputPass: null,

        // ============================================================
        // 安装
        // ============================================================
        install() {
            if (this._installed) return true;

            const MC = window.MapCanvas3D;
            if (!MC || !MC.renderer) {
                console.warn('[Map3DPostFX] MapCanvas3D 未就绪');
                return false;
            }

            const THREE = window.THREE;
            if (!THREE) {
                console.warn('[Map3DPostFX] THREE 未就绪');
                return false;
            }

            this.THREE = THREE;

            // ★ 加载后处理所需的库（EffectComposer 等）
            //   这些库在 three.min.js 里没有，需要单独加载
            //   我们用轻量实现，避免外部依赖

            this._installHook();
            this._installed = true;
            console.log('[Map3DPostFX] 已安装');
            return true;
        },

        // ============================================================
        // 接管 renderer.render
        // ============================================================
        _installHook() {
            const MC = window.MapCanvas3D;
            const renderer = MC.renderer;

            // 保存原始方法
            this._originalRender = renderer.render.bind(renderer);

            const self = this;

            renderer.render = function (scene, camera) {
                // 未启用 → 直通
                if (!self.CFG.enabled) {
                    return self._originalRender(scene, camera);
                }

                // ★ 首次调用时初始化后处理管线
                if (!self._composer) {
                    self._buildPipeline(renderer, scene, camera);
                    // 初始化完这次先直通，避免管线未就绪
                    if (!self._composer) {
                        return self._originalRender(scene, camera);
                    }
                }

                // 尺寸变化时更新
                self._checkResize(renderer);

                // ★ 更新参数
                self._applyParams(renderer);

                // ★ 走 composer
                try {
                    self._composer.render();
                } catch (e) {
                    console.error('[Map3DPostFX] composer 渲染失败，回退直通:', e);
                    self._originalRender(scene, camera);
                }
            };

            console.log('[Map3DPostFX] 已接管 renderer.render');
        },

        // ============================================================
        // 卸载
        // ============================================================
        uninstall() {
            if (!this._installed) return;

            const MC = window.MapCanvas3D;
            if (MC?.renderer && this._originalRender) {
                MC.renderer.render = this._originalRender;
            }

            this._disposePipeline();

            this._installed = false;
            console.log('[Map3DPostFX] 已卸载');
        },

        // ============================================================
        // 构建后处理管线
        // ============================================================
        _buildPipeline(renderer, scene, camera) {
            const THREE = this.THREE;

            // ★ 检查必要的类是否可用
            //   three.min.js 里通常没有 EffectComposer，
            //   我们用极简 shader 实现，不依赖 addons

            try {
                // ---------- 1. 渲染目标 ----------
                const size = new THREE.Vector2();
                renderer.getDrawingBufferSize(size);

                const rtParams = {
                    minFilter: THREE.LinearFilter,
                    magFilter: THREE.LinearFilter,
                    format: THREE.RGBAFormat,
                    type: THREE.HalfFloatType,
                    stencilBuffer: false,
                    depthBuffer: true,
                };

                this._rtScene = new THREE.WebGLRenderTarget(size.x, size.y, rtParams);
                this._rtBright = new THREE.WebGLRenderTarget(
                    Math.floor(size.x / 2), Math.floor(size.y / 2), rtParams
                );
                this._rtBlurA = new THREE.WebGLRenderTarget(
                    Math.floor(size.x / 2), Math.floor(size.y / 2), rtParams
                );
                this._rtBlurB = new THREE.WebGLRenderTarget(
                    Math.floor(size.x / 2), Math.floor(size.y / 2), rtParams
                );

                // ---------- 2. 全屏 quad ----------
                this._quadScene = new THREE.Scene();
                this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
                this._quadGeo = new THREE.PlaneGeometry(2, 2);
                this._quadMesh = null;

                // ---------- 3. 材质们 ----------
                this._matBloomExtract = this._makeMaterial(`
                    uniform sampler2D tDiffuse;
                    uniform float threshold;
                    varying vec2 vUv;
                    void main() {
                        vec4 c = texture2D(tDiffuse, vUv);
                        float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
                        float bright = max(0.0, luma - threshold) / max(0.0001, 1.0 - threshold);
                        gl_FragColor = vec4(c.rgb * bright, 1.0);
                    }
                `, {
                    tDiffuse: { value: null },
                    threshold: { value: this.CFG.bloomThreshold },
                });

                this._matBlur = this._makeMaterial(`
                    uniform sampler2D tDiffuse;
                    uniform vec2 direction;
                    varying vec2 vUv;
                    void main() {
                        vec4 sum = vec4(0.0);
                        sum += texture2D(tDiffuse, vUv - direction * 1.3846153846) * 0.2270270270;
                        sum += texture2D(tDiffuse, vUv - direction * 0.3162162162) * 0.3162162162;
                        sum += texture2D(tDiffuse, vUv) * 0.2270270270;
                        sum += texture2D(tDiffuse, vUv + direction * 0.3162162162) * 0.3162162162;
                        sum += texture2D(tDiffuse, vUv + direction * 1.3846153846) * 0.2270270270;
                        gl_FragColor = sum;
                    }
                `, {
                    tDiffuse: { value: null },
                    direction: { value: new THREE.Vector2(1 / size.x, 0) },
                });

                this._matFXAA = this._makeMaterial(`
                    uniform sampler2D tDiffuse;
                    uniform vec2 resolution;
                    varying vec2 vUv;
                    
                    void main() {
                        vec2 texel = 1.0 / resolution;
                        vec3 rgbM  = texture2D(tDiffuse, vUv).rgb;
                        vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-texel.x, -texel.y)).rgb;
                        vec3 rgbNE = texture2D(tDiffuse, vUv + vec2( texel.x, -texel.y)).rgb;
                        vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-texel.x,  texel.y)).rgb;
                        vec3 rgbSE = texture2D(tDiffuse, vUv + vec2( texel.x,  texel.y)).rgb;

                        vec3 luma = vec3(0.299, 0.587, 0.114);
                        float lumaM  = dot(rgbM,  luma);
                        float lumaNW = dot(rgbNW, luma);
                        float lumaNE = dot(rgbNE, luma);
                        float lumaSW = dot(rgbSW, luma);
                        float lumaSE = dot(rgbSE, luma);

                        float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
                        float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

                        vec2 dir;
                        dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
                        dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));

                        float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.25 * 0.03125, 0.0078125);
                        float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
                        dir = min(vec2(8.0), max(vec2(-8.0), dir * rcpDirMin)) * texel;

                        vec3 rgbA = 0.5 * (
                            texture2D(tDiffuse, vUv + dir * (1.0/3.0 - 0.5)).rgb +
                            texture2D(tDiffuse, vUv + dir * (2.0/3.0 - 0.5)).rgb
                        );
                        vec3 rgbB = rgbA * 0.5 + 0.25 * (
                            texture2D(tDiffuse, vUv + dir * -0.5).rgb +
                            texture2D(tDiffuse, vUv + dir *  0.5).rgb
                        );
                        float lumaB = dot(rgbB, luma);
                        vec3 color = (lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB;
                        gl_FragColor = vec4(color, 1.0);
                    }
                `, {
                    tDiffuse: { value: null },
                    resolution: { value: new THREE.Vector2(size.x, size.y) },
                });

                this._matVignette = this._makeMaterial(`
                    uniform sampler2D tDiffuse;
                    uniform float strength;
                    uniform float radius;
                    varying vec2 vUv;
                    void main() {
                        vec4 c = texture2D(tDiffuse, vUv);
                        vec2 uv = vUv - 0.5;
                        float d = length(uv);
                        float v = smoothstep(radius, 0.5, d);
                        c.rgb *= (1.0 - v * strength);
                        gl_FragColor = c;
                    }
                `, {
                    tDiffuse: { value: null },
                    strength: { value: this.CFG.vignetteStrength },
                    radius: { value: this.CFG.vignetteRadius },
                });

                this._matComposite = this._makeMaterial(`
                    uniform sampler2D tDiffuse;
                    uniform sampler2D tBloom;
                    uniform float bloomStrength;
                    varying vec2 vUv;
                    void main() {
                        vec4 base = texture2D(tDiffuse, vUv);
                        vec4 bloom = texture2D(tBloom, vUv);
                        gl_FragColor = vec4(base.rgb + bloom.rgb * bloomStrength, base.a);
                    }
                `, {
                    tDiffuse: { value: null },
                    tBloom: { value: null },
                    bloomStrength: { value: this.CFG.bloomStrength },
                });

                // ---------- 4. 标记管线就绪 ----------
                this._composer = { _custom: true };
                console.log('[Map3DPostFX] 后处理管线已构建');

            } catch (e) {
                console.error('[Map3DPostFX] 管线构建失败:', e);
                this._composer = null;
            }
        },

        // ============================================================
        // 编译一个全屏 shader 材质
        // ============================================================
        _makeMaterial(fragShader, uniforms) {
            const THREE = this.THREE;

            const vert = `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `;

            // ★ ACES Filmic Tone Mapping 注入
            let finalFrag = fragShader;
            if (this.CFG.toneMapping) {
                finalFrag = fragShader.replace(
                    /gl_FragColor\s*=\s*([^;]+);/g,
                    'gl_FragColor = vec4(ACESFilmicToneMapping($1.rgb), $1.a);'
                );
            }

            const toneMappingFn = this.CFG.toneMapping ? `
                uniform float exposure;
                vec3 ACESFilmicToneMapping(vec3 color) {
                    color *= exposure;
                    color = (color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14);
                    return clamp(color, 0.0, 1.0);
                }
            ` : '';

            // 注入到 fragment 头部
            const fullFrag = `
                ${toneMappingFn}
                ${finalFrag}
            `;

            const allUniforms = { ...uniforms };
            if (this.CFG.toneMapping) {
                allUniforms.exposure = { value: this.CFG.exposure };
            }

            const mat = new THREE.ShaderMaterial({
                vertexShader: vert,
                fragmentShader: fullFrag,
                uniforms: allUniforms,
                depthTest: false,
                depthWrite: false,
                transparent: false,
            });

            // 保存原始 uniforms 引用，便于更新
            mat._uniformsRef = allUniforms;
            return mat;
        },

        // ============================================================
        // 尺寸变化检查
        // ============================================================
        _checkResize(renderer) {
            const THREE = this.THREE;
            const size = new THREE.Vector2();
            renderer.getDrawingBufferSize(size);

            if (!this._rtScene) return;

            if (this._rtScene.width !== size.x || this._rtScene.height !== size.y) {
                this._rtScene.setSize(size.x, size.y);
                const halfW = Math.floor(size.x / 2);
                const halfH = Math.floor(size.y / 2);
                this._rtBright.setSize(halfW, halfH);
                this._rtBlurA.setSize(halfW, halfH);
                this._rtBlurB.setSize(halfW, halfH);

                // 更新 FXAA 分辨率
                if (this._matFXAA) {
                    this._matFXAA.uniforms.resolution.value.set(size.x, size.y);
                }
            }
        },

        // ============================================================
        // 参数应用
        // ============================================================
        _applyParams(renderer) {
            const CFG = this.CFG;

            // 色调映射曝光
            if (this._matBloomExtract?.uniforms?.exposure) {
                this._matBloomExtract.uniforms.exposure.value = CFG.exposure;
            }
            if (this._matFXAA?.uniforms?.exposure) {
                this._matFXAA.uniforms.exposure.value = CFG.exposure;
            }
            if (this._matVignette?.uniforms?.exposure) {
                this._matVignette.uniforms.exposure.value = CFG.exposure;
            }
            if (this._matComposite?.uniforms?.exposure) {
                this._matComposite.uniforms.exposure.value = CFG.exposure;
            }

            // Bloom
            if (this._matBloomExtract?.uniforms?.threshold) {
                this._matBloomExtract.uniforms.threshold.value = CFG.bloomThreshold;
            }
            if (this._matComposite?.uniforms?.bloomStrength) {
                this._matComposite.uniforms.bloomStrength.value = CFG.bloomStrength;
            }

            // 暗角
            if (this._matVignette?.uniforms?.strength) {
                this._matVignette.uniforms.strength.value = CFG.vignetteStrength;
                this._matVignette.uniforms.radius.value = CFG.vignetteRadius;
            }

            // renderer 的 toneMapping 关闭（我们在 shader 里做）
            renderer.toneMapping = THREE.NoToneMapping;
            renderer.outputColorSpace = THREE.SRGBColorSpace || renderer.outputColorSpace;
        },

        // ============================================================
        // 卸载时清理
        // ============================================================
        _disposePipeline() {
            const targets = [
                this._rtScene, this._rtBright, this._rtBlurA, this._rtBlurB,
            ];
            for (const rt of targets) {
                rt?.dispose?.();
            }

            const mats = [
                this._matBloomExtract, this._matBlur,
                this._matFXAA, this._matVignette, this._matComposite,
            ];
            for (const m of mats) {
                m?.dispose?.();
            }

            this._quadGeo?.dispose?.();

            this._rtScene = null;
            this._rtBright = null;
            this._rtBlurA = null;
            this._rtBlurB = null;
            this._composer = null;
            this._quadMesh = null;
        },

        // ============================================================
        // 用户 API：开关
        // ============================================================
        setEnabled(on) {
            this.CFG.enabled = !!on;
            console.log(`[Map3DPostFX] ${on ? '开启' : '关闭'}`);
        },

        // 快速预设
        preset(name) {
            switch (name) {
                case 'low':
                    this.CFG.bloom = false;
                    this.CFG.vignette = true;
                    this.CFG.vignetteStrength = 0.25;
                    this.CFG.fxaa = true;
                    this.CFG.exposure = 1.0;
                    break;
                case 'medium':
                    this.CFG.bloom = true;
                    this.CFG.bloomStrength = 0.45;
                    this.CFG.bloomThreshold = 0.9;
                    this.CFG.vignetteStrength = 0.3;
                    this.CFG.exposure = 1.05;
                    break;
                case 'high':
                    this.CFG.bloom = true;
                    this.CFG.bloomStrength = 0.7;
                    this.CFG.bloomThreshold = 0.8;
                    this.CFG.vignetteStrength = 0.4;
                    this.CFG.exposure = 1.1;
                    break;
                case 'cinematic':
                    this.CFG.bloomStrength = 0.85;
                    this.CFG.bloomThreshold = 0.75;
                    this.CFG.vignetteStrength = 0.5;
                    this.CFG.vignetteRadius = 0.65;
                    this.CFG.exposure = 1.15;
                    break;
            }
            console.log(`[Map3DPostFX] 预设: ${name}`, { ...this.CFG });
        },
    };

    // ============================================================
    // 覆盖 composer.render：自己实现渲染流程
    // ============================================================
    // 因为我不想引入 three 的 addons（EffectComposer / RenderPass 等），
    // 所以直接在 render hook 里手写 pipeline。
    // 上面 _installHook 里的 `self._composer.render()` 需要被替换。

    // ★ 重新定义 render hook（修正版）
    Map3DPostFX._installHook = function () {
        const MC = window.MapCanvas3D;
        const renderer = MC.renderer;
        this._originalRender = renderer.render.bind(renderer);
        const self = this;

        renderer.render = function (scene, camera) {
            if (!self.CFG.enabled) {
                return self._originalRender(scene, camera);
            }
            if (!self._composer) {
                self._buildPipeline(renderer, scene, camera);
                if (!self._composer) {
                    return self._originalRender(scene, camera);
                }
            }
            self._checkResize(renderer);
            self._applyParams(renderer);

            try {
                self._renderPipeline(renderer, scene, camera);
            } catch (e) {
                console.error('[Map3DPostFX] 渲染失败，回退直通:', e);
                self._originalRender(scene, camera);
            }
        };
    };

    // ============================================================
    // 手写渲染流程
    // ============================================================
    Map3DPostFX._renderPipeline = function (renderer, scene, camera) {
        const THREE = this.THREE;
        const CFG = this.CFG;

        // ---------- Pass 1: 主场景 → rtScene ----------
        renderer.setRenderTarget(this._rtScene);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);

        // ---------- Pass 2: 提取亮部 → rtBright ----------
        let bloomRT = null;
        if (CFG.bloom) {
            this._matBloomExtract.uniforms.tDiffuse.value = this._rtScene.texture;

            // 绘制到 rtBright
            this._drawFullscreen(renderer, this._rtBright, this._matBloomExtract);

            // ---------- Pass 3: 横向模糊 → rtBlurA ----------
            this._matBlur.uniforms.tDiffuse.value = this._rtBright.texture;
            this._matBlur.uniforms.direction.value.set(
                1 / this._rtBright.width, 0
            );
            this._drawFullscreen(renderer, this._rtBlurA, this._matBlur);

            // ---------- Pass 4: 纵向模糊 → rtBlurB ----------
            this._matBlur.uniforms.tDiffuse.value = this._rtBlurA.texture;
            this._matBlur.uniforms.direction.value.set(
                0, 1 / this._rtBlurA.height
            );
            this._drawFullscreen(renderer, this._rtBlurB, this._matBlur);

            bloomRT = this._rtBlurB;
        }

        // ---------- Pass 5: 合成 (base + bloom) ----------
        // 如果有暗角，合成后再叠暗角；否则直接输出
        let compositeInput = this._rtScene;

        if (CFG.bloom && bloomRT) {
            // 合成到一个临时 target
            // 复用 rtBlurA 作为合成目标（它已经用完）
            this._matComposite.uniforms.tDiffuse.value = this._rtScene.texture;
            this._matComposite.uniforms.tBloom.value = bloomRT.texture;
            this._drawFullscreen(renderer, this._rtBlurA, this._matComposite);
            compositeInput = this._rtBlurA;
        }

        // ---------- Pass 6: 暗角 ----------
        if (CFG.vignette) {
            this._matVignette.uniforms.tDiffuse.value = compositeInput.texture;
            // 暗角直接输出到屏幕
            this._drawFullscreen(renderer, null, this._matVignette);
            return;
        }

        // ---------- Pass 7: 无暗角 → 直接输出 ----------
        // 用 FXAA 材质做最后一 pass（如果启用）
        if (CFG.fxaa) {
            this._matFXAA.uniforms.tDiffuse.value = compositeInput.texture;
            this._drawFullscreen(renderer, null, this._matFXAA);
        } else {
            // 直出
            this._matVignette.uniforms.tDiffuse.value = compositeInput.texture;
            this._matVignette.uniforms.strength.value = 0;
            this._drawFullscreen(renderer, null, this._matVignette);
        }
    };

    // ============================================================
    // 全屏 quad 绘制
    // ============================================================
    Map3DPostFX._drawFullscreen = function (renderer, target, material) {
        if (!this._quadMesh) {
            this._quadMesh = new this.THREE.Mesh(this._quadGeo, material);
            this._quadScene.add(this._quadMesh);
        } else {
            this._quadMesh.material = material;
        }

        renderer.setRenderTarget(target);
        renderer.clear();
        renderer.render(this._quadScene, this._quadCamera);
        renderer.setRenderTarget(null);
    };

    // ============================================================
    // 挂载
    // ============================================================
    window.Map3DPostFX = Map3DPostFX;

    // ★ 等 MapCanvas3D 就绪后自动安装
    (function boot() {
        let tries = 0;
        const timer = setInterval(() => {
            if (window.MapCanvas3D && window.THREE) {
                clearInterval(timer);
                Map3DPostFX.install();
            } else if (++tries > 100) {
                clearInterval(timer);
                console.warn('[Map3DPostFX] 等待依赖超时');
            }
        }, 100);
    })();

    console.log('[CinemaWorld] map-3d-postfx.js 已加载');
})();