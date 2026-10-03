// ============================================================
// CinemaWorld · TTS/tts-router.js
// 路由层：角色名 / 性别 / 身份 → voiceRef
// 依赖：core.js, world.js, tts-core.js
//
// ★ 音色优先级（男 / 女角色）：
//   1. 同名专属：探测 female/林青禾.txt 是否存在
//        → 存在 = 你手工提供了同名音色 → 用 female/林青禾.wav
//   2. 抽签：female/23.wav（局内稳定 + 避重）
//   3. 兜底：female/default.wav → narrator/default.wav
//        （由 tts-player.js 的降级链处理）
//
// ★ 旁白 / 玩家 / 其他：固定走各自 folder 的 default.wav
// ★ 抽签：局内稳定 + 避重，世界重置时清空
// ★ 探测结果缓存：同一角色整局只探测一次
//
// ★ 持久化：抽签表 / 降级标记写入 worldState，
//   随存档保存，刷新页面后音色不再变化。
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const CharacterRegistry = window.CharacterRegistry;
    const TTSConfig = window.TTSConfig;

    // ============================================================
    // 音色池大小
    // ============================================================
    const VOICE_POOL_SIZE = 15;

    // 固定不抽的 folder
    const FIXED_FOLDERS = ['narrator', 'player', 'other'];

    // ============================================================
    // ★ 持久化状态：从 worldState 读写
    // ============================================================

    // 抽签表：{ female: {角色名: n}, male: {角色名: n} }
    function _getAssignStore() {
        const ws = CinemaWorld?.worldState;
        if (!ws) return { female: {}, male: {} };
        if (!ws.ttsVoiceAssign || typeof ws.ttsVoiceAssign !== 'object') {
            ws.ttsVoiceAssign = { female: {}, male: {} };
        }
        if (!ws.ttsVoiceAssign.female || typeof ws.ttsVoiceAssign.female !== 'object') {
            ws.ttsVoiceAssign.female = {};
        }
        if (!ws.ttsVoiceAssign.male || typeof ws.ttsVoiceAssign.male !== 'object') {
            ws.ttsVoiceAssign.male = {};
        }
        return ws.ttsVoiceAssign;
    }

    // 降级标记：{ 角色名: 'fallback' }
    function _getModeStore() {
        const ws = CinemaWorld?.worldState;
        if (!ws) return {};
        if (!ws.ttsCharacterMode || typeof ws.ttsCharacterMode !== 'object') {
            ws.ttsCharacterMode = {};
        }
        return ws.ttsCharacterMode;
    }

    // 写回 + 立即保存
    function _persist() {
        try { window.SaveManager?.save?.(); } catch (e) {}
    }

    // ============================================================
    // 探测缓存（内存即可，刷新后重新探测成本极低）
    // ============================================================
    const _exactProbe = {
        female: new Map(),
        male:   new Map(),
    };

    async function _probeExactVoice(folder, name) {
        const cache = _exactProbe[folder];
        if (!cache) return false;

        if (cache.has(name)) return cache.get(name);

        const cfg = TTSConfig.get();
        const base = (window.CW_TTS_BASE || '') + (cfg.folderBase || 'voices');
        const url = `${base}/${folder}/${encodeURIComponent(name)}.txt`;

        let exists = false;

        // 先试 HEAD（最轻）
        try {
            const resp = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
            exists = resp.ok;
        } catch (e) {
            // HEAD 不被支持 / 网络异常 → 试 GET
            try {
                const resp = await fetch(url, { method: 'GET', cache: 'force-cache' });
                exists = resp.ok;
            } catch (e2) {
                exists = false;
            }
        }

        cache.set(name, exists);
        console.log(
            `[TTS·Router] 探测同名: [${folder}] ${name} → ${exists ? '✅ 有专属' : '❌ 走抽签'}`
        );
        return exists;
    }

    // ============================================================
    // 主对象
    // ============================================================
    const TTSRouter = {
        // ============================================================
        // 主入口：根据 dialogue 决定 voiceRef
        // ============================================================
        async resolve(dialogue) {
            const cfg = TTSConfig.get();
            const base = cfg.folderBase || 'voices';
            const txtBase = (window.CW_TTS_BASE || '') + base;

            const name = dialogue?.character || '旁白';

            // ---------- 1. 判定身份 → folder ----------
            const identity = this._resolveIdentity(name, dialogue);

            // ---------- 2. 固定身份：旁白 / 玩家 / 其他 ----------
            if (FIXED_FOLDERS.includes(identity)) {
                return this._makeRef(identity, 'default', base, txtBase);
            }

            // ---------- 3. 男 / 女角色 ----------
            // 空名 / 已降级 → 直接 default
            const modeStore = _getModeStore();
            if (!name || modeStore[name] === 'fallback') {
                return this._makeRef(identity, 'default', base, txtBase);
            }

            // ★ 3a. 探测同名专属
            const hasExact = await _probeExactVoice(identity, name);
            if (hasExact) {
                return this._makeRef(identity, name, base, txtBase, 'exact', name);
            }

            // ★ 3b. 抽签（持久化）
            const n = this._assignVoice(identity, name);
            return this._makeRef(identity, String(n), base, txtBase, 'exact', name);
        },

        // ============================================================
        // 判定身份 → folder 名
        //   'narrator' | 'player' | 'male' | 'female' | 'other'
        // ============================================================
        _resolveIdentity(name, dialogue) {
            // 旁白
            if (!name || ['旁白', '系统', 'narrator'].includes(name)) {
                return 'narrator';
            }

            // 玩家
            if (this._isPlayer(name)) {
                return 'player';
            }

            // 性别
            const record = CharacterRegistry?.get?.(name);
            let gender = record?.gender || '';

            if (!gender && dialogue?.extraInfo) {
                gender = String(dialogue.extraInfo).trim();
            }

            const g = String(gender).toLowerCase();
            if (g.includes('女') || g.includes('female') || g === 'f') return 'female';
            if (g.includes('男') || g.includes('male')   || g === 'm') return 'male';

            // 非男非女 / 未知 / 猫狗机械神
            return 'other';
        },

        // ============================================================
        // ★ 抽签：从持久化 store 读写
        //   局内稳定 + 避重，刷新页面后依然稳定
        // ============================================================
        _assignVoice(folder, name, total = VOICE_POOL_SIZE) {
            const store = _getAssignStore();
            const table = store[folder];
            if (!table) return 1;

            // ★ 已有分配 → 直接返回（刷新后稳定）
            if (table[name] !== undefined) {
                return table[name];
            }

            const used = new Set(Object.values(table));
            const candidates = [];
            for (let i = 1; i <= total; i++) {
                if (!used.has(i)) candidates.push(i);
            }

            let n;
            if (candidates.length > 0) {
                n = candidates[Math.floor(Math.random() * candidates.length)];
            } else {
                n = Math.floor(Math.random() * total) + 1;
                console.warn(`[TTS·Router] ${folder} 池已满（${total}），${name} 共用音色 ${n}`);
            }

            table[name] = n;

            // ★ 写回 worldState + 立即保存
            _persist();

            console.log(`[TTS·Router] 抽签: [${folder}] ${name} → ${n}`);
            return n;
        },

        // ============================================================
        // 世界重置：清空抽签表 + 探测缓存 + 降级标记
        // ============================================================
        resetVoiceAssign() {
            const store = _getAssignStore();
            const fCount = Object.keys(store.female).length;
            const mCount = Object.keys(store.male).length;

            store.female = {};
            store.male   = {};

            _exactProbe.female.clear();
            _exactProbe.male.clear();

            const modeStore = _getModeStore();
            for (const k of Object.keys(modeStore)) {
                delete modeStore[k];
            }

            _persist();

            console.log(
                `[TTS·Router] 已重置音色（female ${fCount} / male ${mCount}），探测缓存已清空`
            );
        },

        // 只重置降级标记（保留抽签 + 探测缓存）
        resetFallback() {
            const modeStore = _getModeStore();
            for (const k of Object.keys(modeStore)) {
                delete modeStore[k];
            }
            _persist();
            console.log('[TTS·Router] 降级标记已重置');
        },

        // ============================================================
        // 构造 voiceRef
        // ============================================================
        _makeRef(folder, name, base, txtBase, mode = 'default', characterName = null) {
            return {
                ref: `${base}/${folder}/${name}.wav`,      // 给 audio.cpp
                txt: `${txtBase}/${folder}/${name}.txt`,   // 给前端 fetch
                folder,
                name,
                mode,
                characterName,
            };
        },

        _makeDefaultRef(folder) {
            const cfg = TTSConfig.get();
            const base = cfg.folderBase || 'voices';
            const txtBase = (window.CW_TTS_BASE || '') + base;
            return this._makeRef(folder, 'default', base, txtBase);
        },

        // ============================================================
        // 降级标记（持久化）
        // ============================================================
        markFallback(characterName) {
            if (!characterName) return;
            const modeStore = _getModeStore();
            modeStore[characterName] = 'fallback';
            _persist();
            console.log(`[TTS·Router] ${characterName} 已降级到 default`);
        },

        // ============================================================
        // 工具
        // ============================================================
        _isPlayer(name) {
            if (!name) return false;
            const playerName = this._getPlayerName();
            return ['玩家', '我', '主人公', 'player'].includes(name)
                || (playerName && name === playerName);
        },

        _getPlayerName() {
            return window.PlayerStateManager?.player?.name || null;
        },
    };

    window.TTSRouter = TTSRouter;
    console.log('[CinemaWorld·TTS] tts-router.js 已加载（持久化 + 同名探测 + 抽签）');
})();