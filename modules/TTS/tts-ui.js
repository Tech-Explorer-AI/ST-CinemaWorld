// ============================================================
// CinemaWorld · TTS/modules/tts-ui.js
// UI 层：手机里的"语音"App + 配置面板
// 依赖：tts-core.js, tts-router.js, tts-player.js, ui.js
//
// ★ 本版本适配串行流水线：
//   - VN.play 给每句挂 __ttsIndex
//   - VN.showDialogue 用 __ttsIndex，不用计数器
//   - VN 不阻塞 TTS，除非用户开了 waitForTTS
//   - skip / stop / end 全部 abort
// ============================================================

(function () {
    'use strict';

    const TTSCore = window.TTSCore;
    const TTSRouter = window.TTSRouter;
    const TTSPlayer = window.TTSPlayer;
    const TTSConfig = window.TTSConfig;

    // ==================== 主管理入口 ====================
    //   由 TTS/index.js 调用 TTSManager.init() 完成初始化
    const TTSManager = {
        init() {
            TTSCore.init();
            this._patchVN();
            this._patchPhone();
            this._applyBgmVolume();
            console.log('[TTS·UI] 初始化完成');
        },

        // ============================================================
        // 应用背景音乐音量
        // ============================================================
        _applyBgmVolume() {
            const cfg = TTSConfig.get();
            if (window.TTSDucking) {
                window.TTSDucking.setBaseVolume(cfg.bgmVolume);
            } else if (window.MusicManager?.setVolume) {
                window.MusicManager.setVolume(cfg.bgmVolume);
            }
            console.log('[TTS·UI] 已应用背景音量:', cfg.bgmVolume);
        },

        // ============================================================
        // 补丁 1：VN 播放流程
        // ============================================================
        _patchVN() {
            const VN = window.VisualNovelManager;
            if (!VN || VN._ttsPatched) return;

            // ---------- play()：给每句挂稳定索引 + 启动串行流水线 ----------
            const origPlay = VN.play.bind(VN);
            VN.play = async function (dialogues) {
                // ★ 给每句挂上稳定索引，后续 showDialogue 直接读，
                //   不再依赖计数器，避免重播 / 跳过 / 回看时错位
                if (Array.isArray(dialogues)) {
                    dialogues.forEach((d, i) => {
                        if (d && typeof d === 'object') d.__ttsIndex = i;
                    });
                }

                // ★ 启动 TTS 串行流水线（不阻塞 VN）
                if (TTSConfig.get().enabled) {
                    try {
                        TTSPlayer.startPipeline(dialogues);
                    } catch (e) {
                        console.warn('[TTS] 流水线启动失败:', e);
                    }
                }

                // 原逻辑
                return await origPlay(dialogues);
            };

            // ---------- showDialogue()：打字机 + TTS 并行，互不阻塞 ----------
            const origShow = VN.showDialogue.bind(VN);
            VN.showDialogue = async function (d) {
                const idx = (d && typeof d.__ttsIndex === 'number') ? d.__ttsIndex : -1;
                const cfg = TTSConfig.get();

                // 未开启 / 没索引 → 纯原逻辑
                if (!cfg.enabled || idx < 0) {
                    return await origShow(d);
                }

                // ★ 打字机和 TTS 同时启动
                const typingPromise = origShow(d);
                const ttsPromise = TTSPlayer.playFor(d, idx).catch((e) => {
                    console.warn(`[TTS·UI] playFor(${idx}) 异常:`, e);
                });

                // ★ VN 的"继续"只等打字机，绝不等 TTS
                await typingPromise;

                // ★ 如果用户开了 waitForTTS：打字完成后，再等这句语音播完
                if (cfg.waitForTTS) {
                    await ttsPromise;
                }
            };

            // ---------- skip()：中止流水线 ----------
            const origSkip = VN.skip?.bind(VN);
            if (origSkip) {
                VN.skip = async function () {
                    try { TTSPlayer.abort(); } catch (e) {}
                    return await origSkip();
                };
            }

            // ---------- stop()：中止 ----------
            const origStop = VN.stop?.bind(VN);
            if (origStop) {
                VN.stop = function () {
                    try { TTSPlayer.abort(); } catch (e) {}
                    return origStop();
                };
            }

            // ---------- end()：清空 ----------
            const origEnd = VN.end?.bind(VN);
            if (origEnd) {
                VN.end = async function () {
                    try { TTSPlayer.abort(); } catch (e) {}
                    return await origEnd();
                };
            }

            VN._ttsPatched = true;
            console.log('[TTS·UI] VN 已打补丁（串行流水线版）');
        },

        // ============================================================
        // 补丁 2：手机 App
        // ============================================================
        _patchPhone() {
            const Phone = window.PhoneUIManager;
            if (!Phone || Phone._ttsPatched) return;

            // ---------- renderHome()：加"语音"图标 ----------
            const origRenderHome = Phone.renderHome.bind(Phone);
            Phone.renderHome = function () {
                let html = origRenderHome();
                const insertBefore = `<div class="cw-phone-app" onclick="PhoneUIManager.openApp('settings')">`;
                const ttsApp = `
                    <div class="cw-phone-app" onclick="PhoneUIManager.openApp('tts')">
                        <div class="cw-phone-app-icon">
                            🔊
                            ${TTSConfig.get().enabled ? '' : ''}
                        </div>
                        <div class="cw-phone-app-name">语音</div>
                    </div>`;
                if (html.includes(insertBefore)) {
                    html = html.replace(insertBefore, ttsApp + insertBefore);
                } else {
                    html = html.replace(
                        /(<\/div>\s*<\/div>\s*<\/div>\s*)$/,
                        ttsApp + '$1'
                    );
                }
                return html;
            };

            // ---------- renderApp()：加 case ----------
            const origRenderApp = Phone.renderApp.bind(Phone);
            Phone.renderApp = function () {
                if (this.currentApp === 'tts') {
                    return TTSAppUI.render();
                }
                return origRenderApp();
            };

            Phone._ttsPatched = true;
            console.log('[TTS·UI] 手机已打补丁');
        },
    };

    // ==================== 手机内 TTS App UI ====================
    const TTSAppUI = {
        render() {
            const cfg = TTSConfig.get();
            const cacheSize = TTSCore.getCacheSize();

            return `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>语音</span>
                </div>
                <div class="cw-phone-app-body">

                    <!-- ========== 总开关 ========== -->
                    <div class="cw-tts-section">
                        <div class="cw-tts-row">
                            <span>启用语音</span>
                            <label class="cw-tts-switch">
                                <input type="checkbox" ${cfg.enabled ? 'checked' : ''}
                                    onchange="TTSAppUI.toggleEnabled(this.checked)">
                                <span class="cw-tts-slider"></span>
                            </label>
                        </div>
                    </div>

                    <!-- ========== 后端地址 ========== -->
                    <div class="cw-tts-section">
                        <div class="cw-tts-label">后端地址</div>
                        <input type="text" class="cw-tts-input"
                            value="${this._escape(cfg.endpoint)}"
                            placeholder="http://127.0.0.1:8080"
                            onchange="TTSAppUI.setEndpoint(this.value)">
                        <div class="cw-tts-hint">
                            audio.cpp 服务地址，例如 http://127.0.0.1:8080
                        </div>
                    </div>

                    <!-- ========== 模型 ========== -->
                    <div class="cw-tts-section">
                        <div class="cw-tts-label">TTS 模型</div>
                        <input type="text" class="cw-tts-input"
                            value="${this._escape(cfg.model)}"
                            placeholder="omnivoice"
                            onchange="TTSAppUI.setModel(this.value)">
                        <div class="cw-tts-hint">
                            对应 server.json 里的模型 id（omnivoice / Kokoro）
                        </div>
                    </div>

                    <!-- ========== 参考音频根目录 ========== -->
                    <div class="cw-tts-section">
                        <div class="cw-tts-label">参考音频目录</div>
                        <input type="text" class="cw-tts-input"
                            value="${this._escape(cfg.folderBase)}"
                            placeholder="voices"
                            onchange="TTSAppUI.setFolderBase(this.value)">
                        <div class="cw-tts-hint">
                            相对于 audio.cpp 工作目录。<br>
                            结构：<br>
                            <code>${this._escape(cfg.folderBase)}/narrator/default.wav</code><br>
                            <code>${this._escape(cfg.folderBase)}/male/default.wav</code><br>
                            <code>${this._escape(cfg.folderBase)}/female/default.wav</code><br>
                            <code>${this._escape(cfg.folderBase)}/player/default.wav</code><br>
                            同名 <code>.txt</code> 会被 audio.cpp 自动读取
                        </div>
                    </div>

                    <!-- ========== 播放参数 ========== -->
                    <div class="cw-tts-section">
                        <div class="cw-tts-label">背景音量：${Math.round(cfg.bgmVolume * 100)}%</div>
                        <input type="range" min="0" max="1" step="0.05"
                            value="${cfg.bgmVolume}"
                            oninput="TTSAppUI.setBgmVolume(this.value)"
                            style="width:100%;">
                        <div class="cw-tts-hint">场景背景音乐的音量</div>
                    </div>
                    <div class="cw-tts-section">
                        <div class="cw-tts-label">音量：${Math.round(cfg.volume * 100)}%</div>
                        <input type="range" min="0" max="1" step="0.05"
                            value="${cfg.volume}"
                            oninput="TTSAppUI.setVolume(this.value)"
                            style="width:100%;">
                    </div>

                    <div class="cw-tts-section">
                        <div class="cw-tts-label">语速：${cfg.rate.toFixed(2)}×</div>
                        <input type="range" min="0.5" max="2" step="0.05"
                            value="${cfg.rate}"
                            oninput="TTSAppUI.setRate(this.value)"
                            style="width:100%;">
                    </div>

                    <!-- ========== 播放策略 ========== -->
                    <div class="cw-tts-section">
                        <div class="cw-tts-row">
                            <span>打完字等语音播完</span>
                            <label class="cw-tts-switch">
                                <input type="checkbox" ${cfg.waitForTTS ? 'checked' : ''}
                                    onchange="TTSAppUI.setWaitForTTS(this.checked)">
                                <span class="cw-tts-slider"></span>
                            </label>
                        </div>
                        <div class="cw-tts-hint">
                            关闭 = 打字机归打字机，语音归语音（推荐）<br>
                            开启 = 语音播完才允许"继续"
                        </div>
                    </div>

                    <!-- ========== 测试 ========== -->
                    <div class="cw-tts-section">
                        <button class="cw-phone-rule-btn primary"
                            onclick="TTSAppUI.testSpeak()">
                            🎤 测试合成
                        </button>
                    </div>

                    <!-- ========== 缓存 ========== -->
                    <div class="cw-tts-section">
                        <div class="cw-tts-row">
                            <span>缓存：${cacheSize} 条</span>
                            <button class="cw-phone-back"
                                onclick="TTSAppUI.clearCache()">清空</button>
                        </div>
                    </div>

                    <!-- ========== 降级重置 ========== -->
                    <div class="cw-tts-section">
                        <button class="cw-phone-rule-btn"
                            onclick="TTSAppUI.resetFallback()">
                            🔄 重置角色降级标记
                        </button>
                        <div class="cw-tts-hint">
                            如果某个角色第一次合成失败被降级到默认音色，<br>
                            放好对应参考音频后，点这里重新尝试
                        </div>
                    </div>

                    <div class="cw-tts-footer">
                        CinemaWorld TTS · audio.cpp
                    </div>

                </div>`;
        },

        // ============================================================
        // 设置项
        // ============================================================
        setBgmVolume(v) {
            const val = parseFloat(v) || 0.5;
            TTSConfig.set('bgmVolume', val);
            // ★ 通知 Ducking：用户改了基准音量
            if (window.TTSDucking) {
                window.TTSDucking.setBaseVolume(val);
            } else if (window.MusicManager?.setVolume) {
                // 兜底：没有 Ducking 时直接设
                window.MusicManager.setVolume(val);
            }
            this._rerender();
        },

        toggleEnabled(v) {
            TTSConfig.set('enabled', !!v);
            if (!v) {
                try { TTSPlayer.abort(); } catch (e) {}
            }
            window.UIManager?.showText?.(v ? '🔊 语音已开启' : '🔇 语音已关闭', 1200);
            this._rerender();
        },

        setEndpoint(v) {
            const val = (v || '').trim().replace(/\/+$/, '');
            TTSConfig.set('endpoint', val);
            window.UIManager?.showText?.('地址已保存', 1000);
        },

        setModel(v) {
            TTSConfig.set('model', (v || 'omnivoice').trim());
            window.UIManager?.showText?.('模型已保存', 1000);
        },

        setFolderBase(v) {
            TTSConfig.set('folderBase', (v || 'voices').trim());
            window.UIManager?.showText?.('目录已保存', 1000);
        },

        setVolume(v) {
            TTSConfig.set('volume', parseFloat(v) || 1.0);
            this._rerender();
        },

        setRate(v) {
            TTSConfig.set('rate', parseFloat(v) || 1.0);
            this._rerender();
        },

        setWaitForTTS(v) {
            TTSConfig.set('waitForTTS', !!v);
        },

        // ============================================================
        // 测试
        // ============================================================
        async testSpeak() {
            const cfg = TTSConfig.get();
            if (!cfg.enabled) {
                window.UIManager?.showText?.('请先开启语音', 1500);
                return;
            }

            await window.UIManager?.showText?.('正在测试合成…', 800);

            // ★ 用 TTSRouter 生成，带 txt
            const voiceRef = TTSRouter._makeDefaultRef('narrator');

            const blob = await TTSCore.synthesize('你好，这是语音测试。', voiceRef, {});

            if (!blob || blob.__error) {
                window.UIManager?.showText?.(
                    `❌ 合成失败${blob?.status ? '（HTTP ' + blob.status + '）' : ''}\n请检查后端和参考文件`,
                    2500
                );
                return;
            }

            await TTSCore.playBlob(blob, {});
        },

        // ============================================================
        // 缓存 / 降级
        // ============================================================
        clearCache() {
            TTSCore.clearCache();
            window.UIManager?.showText?.('缓存已清空', 1200);
            this._rerender();
        },

        resetFallback() {
            TTSRouter.resetFallback();
            window.UIManager?.showText?.('降级标记已重置', 1500);
        },

        // ============================================================
        // 工具
        // ============================================================
        _rerender() {
            if (window.PhoneUIManager?.currentApp === 'tts') {
                window.PhoneUIManager.render();
            }
        },

        _escape(s) {
            return String(s ?? '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },
    };

    // ==================== 挂载 ====================
    window.TTSManager = TTSManager;
    window.TTSAppUI = TTSAppUI;

    console.log('[CinemaWorld·TTS] tts-ui.js 已加载');
})();