// ============================================================
// CinemaWorld - TTS 目录聚合加载器
// 依赖：主入口 index.js 已挂好 window.CWLoader
// CWLoader.BASE 指向 modules/，本文件只需给出相对 modules/ 的路径
// ============================================================

(function () {
    'use strict';

    if (window.CinemaWorldTTSLoader) return;   // 防重复

    // ★ 反推 TTS 目录的绝对 URL（用于前端 fetch .txt）
    window.CW_TTS_BASE = (() => {
        const cur = document.currentScript;
        if (cur && cur.src) {
            return cur.src.replace(/index\.js.*$/, '');
        }
        for (const s of document.querySelectorAll('script[src]')) {
            if (/CinemaWorld/.test(s.src) && /TTS\/index\.js/.test(s.src)) {
                return s.src.replace(/index\.js.*$/, '');
            }
        }
        return 'scripts/extensions/third-party/ST-CinemaWorld-main/TTS/';
    })();

    console.log('[CinemaWorld/TTS] BASE =', window.CW_TTS_BASE);

    if (!window.CWLoader) {
        console.error('[CinemaWorld/TTS] CWLoader 未加载，无法加载 TTS 模块');
        window.CinemaWorldTTSLoader = Promise.resolve();
        return;
    }

    // ★ 严格按依赖顺序排列（路径相对 modules/）
    const MODULES = [
        'TTS/tts-core.js',
        'TTS/tts-router.js',
        'TTS/tts-player.js',
        'TTS/tts-ui.js',
    ];

    window.CinemaWorldTTSLoader = window.CWLoader.loadAll(MODULES).then(() => {
        if (window.TTSManager?.init) {
            try {
                window.TTSManager.init();
            } catch (e) {
                console.error('[CinemaWorld/TTS] 初始化失败:', e);
            }
        }
        console.log('[CinemaWorld/TTS] 全部模块加载完成');
    });
})();