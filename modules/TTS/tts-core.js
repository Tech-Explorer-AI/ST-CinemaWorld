// ============================================================
// CinemaWorld · TTS/tts-core.js
// 引擎层：配置 / 缓存 / 后端调用 / 播放 / 中止
// 依赖：core.js
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;

    // ==================== 配置 ====================
    const TTSConfig = {
        _defaults: {
            enabled: false,
            endpoint: 'http://127.0.0.1:8080',
            model: 'omnivoice',
            volume: 1.0,
            bgmVolume: 0.5,
            rate: 1.0,
            maxTokens: 256,
            cacheLimit: 100,
            folderBase: 'voices',
            waitForTTS: false,
            duckLevel: 0.3,                                      // ★ 新增
        },

        get() {
            const ws = CinemaWorld.worldState;
            if (!ws) return { ...this._defaults };
            if (!ws.tts) ws.tts = {};
            for (const [k, v] of Object.entries(this._defaults)) {
                if (ws.tts[k] === undefined) ws.tts[k] = v;
            }
            return ws.tts;
        },

        set(key, value) {
            const ws = CinemaWorld.worldState;
            if (!ws) return;
            if (!ws.tts) ws.tts = {};
            ws.tts[key] = value;
            if (window.SaveManager) window.SaveManager.save();
        },
    };

    // ==================== LRU 缓存 ====================
    class LRUCache {
        constructor(limit = 100) {
            this.limit = limit;
            this.map = new Map();
        }
        has(key) { return this.map.has(key); }
        get(key) {
            if (!this.map.has(key)) return undefined;
            const v = this.map.get(key);
            this.map.delete(key);
            this.map.set(key, v);
            return v;
        }
        set(key, value) {
            if (this.map.has(key)) this.map.delete(key);
            else if (this.map.size >= this.limit) {
                const first = this.map.keys().next().value;
                this.map.delete(first);
            }
            this.map.set(key, value);
        }
        clear() { this.map.clear(); }
        get size() { return this.map.size; }
    }

    // ==================== 核心引擎 ====================
    const TTSCore = {
        _cache: null,
        _refTextCache: new Map(),     // url → text | null
        _currentAudio: null,
        _currentResolve: null,
        _abortControllers: new Map(),

        init() {
            const cfg = TTSConfig.get();
            this._cache = new LRUCache(cfg.cacheLimit);
            console.log('[TTS·Core] 初始化完成, endpoint =', cfg.endpoint);
        },

        get endpoint() { return TTSConfig.get().endpoint; },
        get model() { return TTSConfig.get().model; },

        // ============================================================
        // 解析参考文本：从 ST 扩展下 fetch 同名 .txt
        // ============================================================
        async _resolveRefText(voiceRef) {
            if (!voiceRef?.txt) return null;
            const url = voiceRef.txt;

            // ★ 只命中成功缓存
            if (this._refTextCache.has(url)) {
                return this._refTextCache.get(url);
            }

            try {
                const resp = await fetch(url, { cache: 'no-store' });
                if (!resp.ok) {
                    console.warn(`[TTS·Core] .txt 读取失败 (${resp.status}): ${url}`);
                    return null;   // ★ 不缓存失败
                }
                const text = (await resp.text()).trim();
                if (!text) {
                    console.warn(`[TTS·Core] .txt 内容为空: ${url}`);
                    return null;   // ★ 不缓存空
                }
                this._refTextCache.set(url, text);   // ★ 只缓存成功
                console.log(`[TTS·Core] .txt 读取成功: ${url}`);
                return text;
            } catch (e) {
                console.warn(`[TTS·Core] .txt fetch 异常: ${url}`, e);
                return null;   // ★ 不缓存失败
            }
        },

        // ============================================================
        // 合成：text + voiceRef → Blob | { __error, ... }
        //   voiceRef: { ref, txt, folder, mode, characterName }
        // ============================================================
        async synthesize(text, voiceRef, options = {}) {
            if (!text || !voiceRef?.ref) return null;

            const cfg = TTSConfig.get();
            const key = this._makeKey(text, voiceRef, cfg);

            if (this._cache?.has(key)) {
                return this._cache.get(key);
            }

            // ★ 解析参考文本（优先 options.refText）
            const refText = options.refText ?? await this._resolveRefText(voiceRef);

            const ctrl = new AbortController();
            this._abortControllers.set(key, ctrl);

            const body = {
                model: cfg.model,
                input: text,
                voice_ref: voiceRef.ref,
                response_format: 'wav',
                max_tokens: cfg.maxTokens,
            };

            // ★ 只有克隆模式才需要 reference_text
            if (refText) {
                body.reference_text = refText;
            }

            let resp;
            try {
                resp = await fetch(`${cfg.endpoint}/v1/audio/speech`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: ctrl.signal,
                });
            } catch (e) {
                this._abortControllers.delete(key);
                if (e.name === 'AbortError') {
                    return { __error: 'aborted', voiceRef };
                }
                console.warn('[TTS·Core] 请求失败:', e);
                return { __error: 'network', voiceRef, message: e.message };
            }

            this._abortControllers.delete(key);

            if (!resp.ok) {
                let errText = '';
                try { errText = await resp.text(); } catch (e) { }

                // ★ 分类错误
                let code = 'server';
                if (/could not open|no such file|not found|missing/i.test(errText)) {
                    code = 'file_missing';
                } else if (/reference_text/i.test(errText)) {
                    code = 'reftext_missing';
                }

                console.warn(`[TTS·Core] 服务端 ${resp.status} (${code}):`, errText.slice(0, 200));
                return { __error: code, status: resp.status, voiceRef, errText };
            }

            const blob = await resp.blob();
            this._cache?.set(key, blob);
            return blob;
        },

        _makeKey(text, voiceRef, cfg) {
            return `${cfg.model}|${voiceRef.ref}|${text}`;
        },

        // ============================================================
        // 播放：Blob → 出声
        // ============================================================
        async playBlob(blob, options = {}) {
            if (!blob || blob.__error) return;
        
            return new Promise((resolve) => {
                this.stop();
        
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
        
                const cfg = TTSConfig.get();
                audio.volume = options.volume ?? cfg.volume;
                audio.playbackRate = options.rate ?? cfg.rate;
        
                this._currentAudio = audio;
                this._currentResolve = resolve;
        
                // ★ 开始 duck
                const ducking = window.TTSDucking;
                const shouldDuck = options.duck !== false;   // 默认 duck，可传 duck:false 关掉
                if (ducking && shouldDuck) {
                    ducking.duck();
                }
        
                const cleanup = () => {
                    try { URL.revokeObjectURL(url); } catch (e) {}
                    if (this._currentResolve === resolve) {
                        this._currentAudio = null;
                        this._currentResolve = null;
                    }
                    // ★ 恢复 BGM
                    if (ducking && shouldDuck) {
                        ducking.unduck();
                    }
                    resolve();
                };
        
                audio.onended = cleanup;
                audio.onerror = (e) => {
                    console.warn('[TTS·Core] 播放错误:', e);
                    cleanup();
                };
        
                audio.play().catch(e => {
                    console.warn('[TTS·Core] play() 被拒绝:', e);
                    cleanup();
                });
            });
        },

        // ============================================================
        // 合成 + 播放（快捷方法，给试听用）
        // ============================================================
        async speak(text, voiceRef, options = {}) {
            const blob = await this.synthesize(text, voiceRef, options);
            if (!blob || blob.__error) return false;
            await this.playBlob(blob, options);
            return true;
        },

        // ============================================================
        // 停止当前播放
        // ============================================================
        stop() {
            if (this._currentAudio) {
                try {
                    this._currentAudio.pause();
                    this._currentAudio.src = '';
                } catch (e) {}
                this._currentAudio = null;
            }
            if (this._currentResolve) {
                const r = this._currentResolve;
                this._currentResolve = null;
                try { r(); } catch (e) {}
            }
            // ★ 主动恢复（防止 stop 时 cleanup 没跑到）
            window.TTSDucking?.unduck?.();
        },

        // ============================================================
        // 中止所有未完成合成
        // ============================================================
        abortAll() {
            for (const ctrl of this._abortControllers.values()) {
                try { ctrl.abort(); } catch (e) { }
            }
            this._abortControllers.clear();
            this.stop();
        },

        // ============================================================
        // 缓存管理
        // ============================================================
        clearCache() {
            this._cache?.clear();
            this._refTextCache.clear();
            console.log('[TTS·Core] 缓存已清空');
        },

        getCacheSize() {
            return this._cache?.size ?? 0;
        },

    };
    // ============================================================
    // CinemaWorld · TTS/tts-core.js
    // ★ 新增：DuckingManager（BGM 自动闪避）
    // ============================================================

    // ==================== BGM Ducking ====================
    const DuckingManager = {
        _duckFactor: 1.0,          // 当前应用的比例
        _ducking: false,           // 是否正在 duck
        _baseVolume: null,         // 基准音量（用户设置的 bgmVolume）
        _duckLevel: 0.3,           // duck 时降到基准的 30%

        // 获取基准音量（从 TTSConfig 读，保证和滑块一致）
        _getBase() {
            const v = window.TTSConfig?.get?.().bgmVolume;
            return typeof v === 'number' ? v : 0.5;
        },

        // 应用音量 = 基准 × factor
        _apply() {
            const base = this._baseVolume ?? this._getBase();
            const final = base * this._duckFactor;
            if (window.MusicManager?.setVolume) {
                window.MusicManager.setVolume(final);
            }
            return final;
        },

        // 用户改滑块时调用：更新基准值，如果不在 duck 中就立即应用
        setBaseVolume(v) {
            this._baseVolume = typeof v === 'number' ? v : 0.5;
            if (!this._ducking) {
                this._duckFactor = 1.0;
                this._apply();
            }
            // duck 中：不立即应用，等 TTS 结束再应用新基准
        },

        // 开始 duck（TTS 播放前调用）
        duck() {
            if (this._ducking) return;
            this._ducking = true;
            this._duckFactor = this._duckLevel;
            this._apply();
            console.log(`[TTS·Ducking] 降音量 → 基准的 ${Math.round(this._duckLevel * 100)}%`);
        },

        // 恢复（TTS 播放完 / 中止时调用）
        unduck() {
            if (!this._ducking) return;
            this._ducking = false;
            this._duckFactor = 1.0;
            // ★ 恢复时读最新基准（用户可能在 TTS 期间调了滑块）
            this._baseVolume = this._getBase();
            this._apply();
            console.log(`[TTS·Ducking] 恢复音量 → ${Math.round(this._baseVolume * 100)}%`);
        },

        isDucking() {
            return this._ducking;
        },
    };

    // 挂载
    window.TTSDucking = DuckingManager;
    // ==================== 挂载 ====================
    window.TTSConfig = TTSConfig;
    window.TTSCore = TTSCore;

    console.log('[CinemaWorld·TTS] tts-core.js 已加载');
})();