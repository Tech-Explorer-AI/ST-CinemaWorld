// ============================================================
// CinemaWorld · TTS/tts-player.js
// 播放层：串行合成 + 串行播放 + 三层降级
// 后端（audio.cpp）是单线程的，前端必须串行，绝不并发
// ============================================================

(function () {
    'use strict';

    const TTSCore = window.TTSCore;
    const TTSRouter = window.TTSRouter;
    const TTSConfig = window.TTSConfig;

    const TTSPlayer = {
        _pipeline: null,
        _currentPlayPromise: null,

        // ============================================================
        // 启动流水线：串行合成，一句接一句
        // ============================================================
        startPipeline(dialogues) {
            const cfg = TTSConfig.get();
            if (!cfg.enabled) return;

            this.abort();

            this._pipeline = {
                dialogues,
                results: new Map(),     // index -> blob | {__error}
                aborted: false,
                // ★ 合成游标：worker 只往前跑
                synthCursor: 0,
                // ★ 播放游标：playFor 只等自己那句
                waiter: null,
            };

            console.log(`[TTS·Player] 启动串行流水线，共 ${dialogues.length} 句`);

            // ★ 后台 worker：串行合成所有句子
            this._runSynthWorker();
        },

        async _runSynthWorker() {
            const p = this._pipeline;
            if (!p) return;

            for (let i = 0; i < p.dialogues.length; i++) {
                if (p.aborted) break;

                const d = p.dialogues[i];
                try {
                    await this._synthOne(d, i);
                } catch (e) {
                    console.warn(`[TTS·Player] 第 ${i} 句合成异常:`, e);
                    p.results.set(i, { __error: 'exception' });
                }

                // ★ 每合成完一句，唤醒可能在等这一句的 playFor
                this._notifyWaiter(i);
            }

            console.log('[TTS·Player] 串行流水线全部完成');
            // ★ 收尾：唤醒所有等待者
            this._notifyWaiter(-1);
        },

        async _synthOne(dialogue, index) {
            const p = this._pipeline;
            if (!p || p.aborted) return;

            const text = dialogue?.content;
            if (!text) {
                p.results.set(index, { __error: 'empty' });
                return;
            }

            const voiceRef = await TTSRouter.resolve(dialogue);
            const blob = await this._synthWithFallback(text, voiceRef, dialogue);

            if (p.aborted) return;
            p.results.set(index, blob || { __error: 'all_failed' });
        },

        // ============================================================
        // 三层降级：专属 → 文件夹默认 → 旁白默认
        // 每次降级都是一次真实的串行请求，不并发
        // ============================================================
        async _synthWithFallback(text, voiceRef, dialogue) {
            // 尝试 1：原音色
            let blob = await TTSCore.synthesize(text, voiceRef, {});
            if (blob && !blob.__error) return blob;
            console.log(`[TTS·Player] 尝试1失败 (${blob?.__error}): ${voiceRef.ref}`);

            // 尝试 2：该角色降级到 folder default
            if (voiceRef.mode === 'exact' && voiceRef.characterName) {
                TTSRouter.markFallback(voiceRef.characterName);
                const folderRef = TTSRouter._makeDefaultRef(voiceRef.folder);
                console.log(`[TTS·Player] 尝试2: ${folderRef.ref}`);
                blob = await TTSCore.synthesize(text, folderRef, {});
                if (blob && !blob.__error) return blob;
            }

            // 尝试 3：narrator default
            if (voiceRef.folder !== 'narrator') {
                const narratorRef = TTSRouter._makeDefaultRef('narrator');
                console.log(`[TTS·Player] 尝试3: ${narratorRef.ref}`);
                blob = await TTSCore.synthesize(text, narratorRef, {});
                if (blob && !blob.__error) return blob;
            }

            console.warn(`[TTS·Player] 全部降级失败: "${text.slice(0, 20)}..."`);
            return null;
        },

        // ============================================================
        // 播放某句：等它合成好 → 播放 → resolve
        // 串行：如果已有正在播放的，先等它播完（除非 abort）
        // ============================================================
        async playFor(dialogue, index) {
            const cfg = TTSConfig.get();
            if (!cfg.enabled) return;
            if (!this._pipeline) return;

            const text = dialogue?.content;
            if (!text) return;

            // ★ 等当前正在播的播完（同一时刻只有一句在播）
            if (this._currentPlayPromise) {
                try { await this._currentPlayPromise; } catch (e) {}
            }
            if (!this._pipeline || this._pipeline.aborted) return;

            // ★ 等这句的合成结果
            let blob = this._pipeline.results.get(index);
            if (blob === undefined) {
                blob = await this._waitForResult(index);
            }
            if (!blob || blob.__error) return;
            if (!this._pipeline || this._pipeline.aborted) return;

            // ★ 播放
            const playPromise = TTSCore.playBlob(blob, {});
            this._currentPlayPromise = playPromise;
            try {
                await playPromise;
            } finally {
                if (this._currentPlayPromise === playPromise) {
                    this._currentPlayPromise = null;
                }
            }
        },

        // ★ 给 waitForTTS 用：等当前正在播的语音结束
        async waitCurrent() {
            if (this._currentPlayPromise) {
                try { await this._currentPlayPromise; } catch (e) {}
            }
        },

        // ============================================================
        // 等待某句的合成结果（事件驱动，不再 100ms 轮询）
        // ============================================================
        _waitForResult(index, timeoutMs = 60000) {
            return new Promise((resolve) => {
                const p = this._pipeline;
                if (!p) return resolve(null);

                // 已经有了
                if (p.results.has(index)) return resolve(p.results.get(index));
                // 流水线已结束
                if (p.synthCursor > p.dialogues.length) return resolve(null);

                let done = false;
                const finish = (v) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    if (p.waiter && p.waiter.index === index && p.waiter.fn === onReady) {
                        p.waiter = null;
                    }
                    resolve(v);
                };

                const onReady = () => {
                    if (p.results.has(index)) finish(p.results.get(index));
                };

                // 注册 waiter（同一时刻一个 index 一个 waiter 足够）
                p.waiter = { index, fn: onReady };

                const timer = setTimeout(() => {
                    console.warn(`[TTS·Player] 第 ${index} 句合成超时`);
                    finish(null);
                }, timeoutMs);
            });
        },

        _notifyWaiter(finishedIndex) {
            const p = this._pipeline;
            if (!p || !p.waiter) return;
            const { index, fn } = p.waiter;
            // 完成的是当前 waiter 等的 index，或者流水线结束 (-1)
            if (finishedIndex === -1 || finishedIndex === index) {
                fn();
            }
        },

        // ============================================================
        // 中止
        // ============================================================
        abort() {
            if (this._pipeline) this._pipeline.aborted = true;
            this._pipeline = null;
            this._currentPlayPromise = null;
            TTSCore.abortAll();
        },

        stop() {
            TTSCore.stop();
        },

        isPreparing() {
            return !!this._pipeline && !this._pipeline.aborted;
        },
    };

    window.TTSPlayer = TTSPlayer;
    console.log('[CinemaWorld·TTS] tts-player.js 已加载');
})();