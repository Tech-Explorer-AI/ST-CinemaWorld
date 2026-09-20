// ============================================================
// CinemaWorld · background-gen.js
// AI 背景图生成：配置管理 / 工作流 / ComfyUI 通信 / 提示词生成
// 依赖：core.js, world.js, ui.js（generateFunctionalReply）
// ============================================================

(function () {
    'use strict';

    // ★ 防止重复加载
    if (window.__CinemaWorld_BgGenLoaded) {
        console.warn('[BgGen] 已加载过，跳过重复执行');
        return;
    }
    window.__CinemaWorld_BgGenLoaded = true;

    const CinemaWorld = window.CinemaWorld;

    // ==================== 背景图 IndexedDB 存储 ====================
    const BackgroundImageStore = {
        DB_NAME: 'CinemaWorld_BG',
        STORE: 'backgrounds',
        VERSION: 1,
        _db: null,
        _initPromise: null,

        async init() {
            if (this._db) return this._db;
            if (this._initPromise) return this._initPromise;

            this._initPromise = new Promise((resolve, reject) => {
                const req = indexedDB.open(this.DB_NAME, this.VERSION);

                req.onerror = () => {
                    console.error('[BgStore] 打开数据库失败:', req.error);
                    reject(req.error);
                };

                req.onsuccess = () => {
                    this._db = req.result;
                    console.log('[BgStore] 数据库已就绪');
                    resolve(this._db);
                };

                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(this.STORE)) {
                        const store = db.createObjectStore(this.STORE, { keyPath: 'id' });
                        store.createIndex('sceneName', 'sceneName', { unique: false });
                        store.createIndex('createdAt', 'createdAt', { unique: false });
                        console.log('[BgStore] 已创建 objectStore:', this.STORE);
                    }
                };
            });

            return this._initPromise;
        },

        async put(id, record) {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE], 'readwrite');
                const st = tx.objectStore(this.STORE);
                const req = st.put({ id, ...record });
                req.onsuccess = () => resolve(id);
                req.onerror = () => reject(req.error);
            });
        },

        async get(id) {
            if (!id) return null;
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE], 'readonly');
                const st = tx.objectStore(this.STORE);
                const req = st.get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        },

        async delete(id) {
            if (!id) return;
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE], 'readwrite');
                const st = tx.objectStore(this.STORE);
                const req = st.delete(id);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error);
            });
        },

        async listAll() {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE], 'readonly');
                const st = tx.objectStore(this.STORE);
                const req = st.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
        },

        async gc(keepIds = []) {
            const db = await this.init();
            const keep = new Set(keepIds.filter(Boolean));
            return new Promise((resolve, reject) => {
                const tx = db.transaction([this.STORE], 'readwrite');
                const st = tx.objectStore(this.STORE);
                const req = st.openCursor();
                let deleted = 0;
                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor) {
                        if (!keep.has(cursor.value.id)) {
                            cursor.delete();
                            deleted++;
                        }
                        cursor.continue();
                    } else {
                        if (deleted > 0) console.log(`[BgStore] GC 清理了 ${deleted} 张孤儿背景图`);
                        resolve(deleted);
                    }
                };
                req.onerror = () => reject(req.error);
            });
        },
    };

    // ==================== 配置管理 ====================
    const BackgroundGenConfig = {
        KEY: 'CinemaWorld_bg_gen_config',

        defaults: {
            enabled: false,
            comfyuiUrl: '127.0.0.1:8188',
            apiType: 'local',

            // 提示词生成来源
            promptSource: 'cinemaworld',   // 'cinemaworld' | 'kobold' | 'remote'

            // ★ 提示词风格：'clip' 逗号标签 | 'natural' 自然语言长句
            promptStyle: 'natural',

            // Kobold
            koboldUrl: 'http://127.0.0.1:5001',

            // 远程
            remoteApiUrl: '',
            remoteApiKey: '',
            remoteModel: '',
            remoteProvider: 'openai',

            // 生图参数
            width: 1216,
            height: 832,

            // 工作流
            activeWorkflowId: 'builtin_default',

            // ★ 前缀默认置空，需要的人自己去填
            stylePrefix: '',

            // 负面提示词（仍保留，因为 ComfyUI 的 negative 节点需要）
            negativePrompt: '3DCG, @ai-generated, @nano banana, ' +
            'worst quality, low quality, score_1, score_2, score_3, ' +
            'blurry, jpeg artifacts, ' +
            'censored, censorship, pixelated, bar censor, mosaic, ' +
            'signature, grayscale, monochrome, simple background, ' +
            'high-heeled shoes, hair_grab, sash, girl, ' +
            'humans, characters, people, 1girl, 1boy, person, face, ' +
            'watermark, text',
        },

        load() {
            try {
                const raw = localStorage.getItem(this.KEY);
                if (!raw) return { ...this.defaults };
                const parsed = JSON.parse(raw);
                return { ...this.defaults, ...parsed };
            } catch (e) {
                console.error('[BgGen] 配置读取失败:', e);
                return { ...this.defaults };
            }
        },

        save(cfg) {
            try {
                localStorage.setItem(this.KEY, JSON.stringify(cfg));
            } catch (e) {
                console.error('[BgGen] 配置保存失败:', e);
            }
        },
    };

    // ==================== 运行时状态 ====================
    const BackgroundGenState = {
        config: BackgroundGenConfig.load(),
        workflows: [],
        isGenerating: false,
        lastError: null,
    };

    // ==================== 内置默认工作流 ====================
    const BUILTIN_WORKFLOW = {
        id: 'builtin_default',
        name: '默认（Qwen-Anima）',
        isBuiltin: true,
        promptNode: '11',
        promptField: 'text',
        negativeNode: '12',
        negativeField: 'text',
        widthNode: '28',
        heightNode: '28',
        seedNode: '19',
        workflow: {
            "1":  { "inputs": { "images": ["8", 0] }, "class_type": "PreviewImage" },
            "8":  { "inputs": { "samples": ["19", 0], "vae": ["15", 0] }, "class_type": "VAEDecode" },
            "11": { "inputs": { "text": "", "clip": ["54", 0] }, "class_type": "CLIPTextEncode" },
            "12": { "inputs": { "text": "", "clip": ["54", 0] }, "class_type": "CLIPTextEncode" },
            "15": { "inputs": { "vae_name": "qwen_image_vae.safetensors" }, "class_type": "VAELoader" },
            "19": {
                "inputs": {
                    "seed": 12345, "steps": 8, "cfg": 1,
                    "sampler_name": "er_sde", "scheduler": "simple", "denoise": 1,
                    "model": ["61", 0], "positive": ["11", 0],
                    "negative": ["12", 0], "latent_image": ["28", 0]
                },
                "class_type": "KSampler"
            },
            "28": { "inputs": { "width": 1200, "height": 800, "batch_size": 1 }, "class_type": "EmptyLatentImage" },
            "44": { "inputs": { "unet_name": "anima-base-v1.0.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader" },
            "54": { "inputs": { "clip_name": "qwen_3_06b_base.safetensors", "type": "qwen_image", "device": "default" }, "class_type": "CLIPLoader" },
            "61": { "inputs": { "lora_name": "Anima\\anima-turbo-lora-v0.2.safetensors", "strength_model": 1, "model": ["44", 0] }, "class_type": "LoraLoaderModelOnly" },
            "62": { "inputs": { "filename_prefix": "CinemaWorld_bg", "images": ["1", 0] }, "class_type": "SaveImage" }
        }
    };

    // ==================== 工作流管理 ====================
    const BackgroundWorkflowManager = {
        JSON_PATH: 'scripts/extensions/third-party/CinemaWorld/workflows/',

        async init() {
            BackgroundGenState.workflows = [BUILTIN_WORKFLOW];

            try {
                const manifestUrl = `${this.JSON_PATH}manifest.json`;
                const resp = await fetch(manifestUrl, { cache: 'no-cache' });

                if (resp.ok) {
                    const manifest = await resp.json();
                    const fileList = Array.isArray(manifest.workflows) ? manifest.workflows : [];
                    console.log('[BgGen] manifest 里的工作流:', fileList);

                    for (const file of fileList) {
                        const id = `file_${file}`;
                        if (BackgroundGenState.workflows.some(w => w.id === id)) continue;
                        await this._loadFromFile(file);
                    }
                } else {
                    console.log('[BgGen] 未找到 manifest.json，使用内置工作流');
                }
            } catch (e) {
                console.log('[BgGen] manifest.json 读取失败:', e.message);
            }

            const savedId = BackgroundGenState.config.activeWorkflowId;
            if (!BackgroundGenState.workflows.some(w => w.id === savedId)) {
                BackgroundGenState.config.activeWorkflowId =
                    BackgroundGenState.workflows[0]?.id || 'builtin_default';
                BackgroundGenConfig.save(BackgroundGenState.config);
            }

            console.log('[BgGen] 已加载工作流:',
                BackgroundGenState.workflows.map(w => `${w.name}(${w.id})`));
        },

        async _loadFromFile(filename) {
            try {
                const url = `${this.JSON_PATH}${encodeURIComponent(filename)}`;
                const resp = await fetch(url);
                if (!resp.ok) {
                    console.warn(`[BgGen] 读取失败: ${filename} (${resp.status})`);
                    return;
                }
                const workflow = await resp.json();
                const detected = this.detectNodes(workflow);

                BackgroundGenState.workflows.push({
                    id: `file_${filename}`,
                    name: filename.replace(/\.json$/i, ''),
                    isBuiltin: false,
                    isFromFile: true,
                    filename,
                    ...detected,
                    workflow,
                });
                console.log(`[BgGen] 加载工作流: ${filename}`);
            } catch (e) {
                console.warn('[BgGen] 加载工作流失败:', filename, e);
            }
        },

        async rescan() {
            BackgroundGenState.workflows = BackgroundGenState.workflows.filter(
                w => w.isBuiltin || (!w.isFromFile && w.id.startsWith('custom_'))
            );
            await this.init();
        },

        detectNodes(workflow) {
            const result = {
                promptNode: '11', promptField: 'text',
                negativeNode: null, negativeField: 'text',
                widthNode: null, heightNode: null,
                seedNode: null,
                textNodes: [],
            };

            const textNodes = [];
            const latentNodes = [];
            const samplerNodes = [];

            for (const [id, node] of Object.entries(workflow)) {
                const ct = node.class_type || '';
                if (ct === 'CLIPTextEncode') {
                    const value = node.inputs?.text || '';
                    textNodes.push({
                        id, field: 'text', value,
                        preview: String(value).slice(0, 60),
                        hasContent: !!value,
                    });
                }
                if (ct === 'EmptyLatentImage') latentNodes.push({ id, node });
                if (ct === 'KSampler' || ct === 'KSamplerAdvanced') samplerNodes.push({ id, node });
            }

            result.textNodes = textNodes;

            for (const s of samplerNodes) {
                const pos = s.node.inputs?.positive;
                const neg = s.node.inputs?.negative;
                if (Array.isArray(pos) && pos[0]) result.promptNode = String(pos[0]);
                if (Array.isArray(neg) && neg[0]) result.negativeNode = String(neg[0]);
                if (s.node.inputs?.seed !== undefined) result.seedNode = s.id;
                break;
            }

            if (!result.negativeNode && textNodes.length > 1) {
                const other = textNodes.find(t => t.id !== result.promptNode);
                if (other) result.negativeNode = other.id;
            }

            if (latentNodes.length > 0) {
                result.widthNode = latentNodes[0].id;
                result.heightNode = latentNodes[0].id;
            }

            return result;
        },

        getActive() {
            const id = BackgroundGenState.config.activeWorkflowId;
            return BackgroundGenState.workflows.find(w => w.id === id)
                || BackgroundGenState.workflows[0]
                || BUILTIN_WORKFLOW;
        },

        updateNodeConfig(id, patch) {
            const wf = BackgroundGenState.workflows.find(w => w.id === id);
            if (!wf) return false;
            Object.assign(wf, patch);
            return true;
        },

        importFromJSON(jsonText, name = '自定义工作流') {
            try {
                const workflow = JSON.parse(jsonText);
                if (typeof workflow !== 'object') throw new Error('不是有效的 JSON 对象');

                const detected = this.detectNodes(workflow);
                const id = `custom_${Date.now()}`;
                const entry = {
                    id, name, isBuiltin: false, isFromFile: false,
                    ...detected,
                    workflow,
                };
                BackgroundGenState.workflows.push(entry);
                return entry;
            } catch (e) {
                console.error('[BgGen] 工作流导入失败:', e);
                return null;
            }
        },

        remove(id) {
            const idx = BackgroundGenState.workflows.findIndex(w => w.id === id);
            if (idx < 0) return false;
            if (BackgroundGenState.workflows[idx].isBuiltin) return false;

            BackgroundGenState.workflows.splice(idx, 1);

            if (BackgroundGenState.config.activeWorkflowId === id) {
                BackgroundGenState.config.activeWorkflowId = 'builtin_default';
                BackgroundGenConfig.save(BackgroundGenState.config);
            }
            return true;
        },
    };

    // ==================== 提示词生成 ====================
    const BackgroundPromptGenerator = {
        // ---------- CLIP 标签版 ----------
        async generateFromScene(scene) {
            if (!scene) return null;

            const envLine = window.WorldManager.getEnvDataText(scene);

            const prompt = `You are an AI art prompt engineer for a visual novel game.
Generate an English image-generation prompt for the BACKGROUND of the following scene.

【Scene】
Name: ${scene.name}
Description: ${scene.description || '(none)'}
Environment: ${scene.environment || '(none)'}
Environment Data: ${envLine}

【STRICT RULES】
1. The image must be a pure SCENERY / BACKGROUND image.
2. ★ ABSOLUTELY NO characters, no people, no humans, no faces, no figures.
3. Focus on: environment, architecture, lighting, atmosphere, weather, time of day, mood.
4. Output ONLY comma-separated English tags, no sentences, no explanation, no quotes.
5. Keep it under 60 words. Include quality tags like "detailed, scenery, no humans".
6. If the scene is indoors, describe the room; if outdoors, describe the landscape.

Example output:
anime style, detailed background, abandoned classroom, broken windows, sunset light, dust particles, wooden desks, chalkboard, melancholic atmosphere, no humans, masterpiece, best quality

Now output the tags for the scene above:`;

            const cfg = BackgroundGenState.config;

            if (cfg.promptSource === 'cinemaworld') {
                const result = await window.generateFunctionalReply(prompt, 'bg-prompt');
                return result ? this._cleanClip(result) : null;
            }
            if (cfg.promptSource === 'kobold') {
                return this._cleanClip(await this._koboldGenerate(prompt, cfg));
            }
            if (cfg.promptSource === 'remote') {
                return this._cleanClip(await this._remoteGenerate(prompt, cfg));
            }

            const result = await window.generateFunctionalReply(prompt, 'bg-prompt');
            return result ? this._cleanClip(result) : null;
        },

        // ---------- 自然语言版 ----------
        async generateFromSceneNatural(scene) {
            if (!scene) return null;

            const envLine = window.WorldManager.getEnvDataText(scene);

            const prompt = `You are an AI art prompt engineer for a visual novel game.
Write a natural-language English prompt to generate the BACKGROUND of the following scene.

【Scene】
Name: ${scene.name}
Description: ${scene.description || '(none)'}
Environment: ${scene.environment || '(none)'}
Environment Data: ${envLine}

【STRICT RULES】
1. The image must be a pure SCENERY / BACKGROUND illustration.
2. ★ ABSOLUTELY NO characters, no people, no humans, no faces, no figures.
3. Write in flowing, descriptive sentences (2-4 sentences), not comma tags.
4. Include: art style, composition, lighting, atmosphere, weather, time of day, mood, details.
5. Describe what the viewer sees: environment, architecture, objects, textures, colors.
6. End with a phrase like "no people, no characters in the scene".
7. Output ONLY the prompt. No explanation, no quotes, no markdown.

Example output:
An anime-style digital illustration of an abandoned classroom at golden hour. Warm sunset light streams through broken windows, casting long shadows across scattered wooden desks and a chalkboard covered in faded writing. Dust particles float in the air, and the melancholic atmosphere suggests years of neglect. Detailed background art, soft painterly style, no people, no characters in the scene.

Now write the prompt for the scene above:`;

            const cfg = BackgroundGenState.config;

            if (cfg.promptSource === 'cinemaworld') {
                const result = await window.generateFunctionalReply(prompt, 'bg-prompt-natural');
                return result ? this._cleanNatural(result) : null;
            }
            if (cfg.promptSource === 'kobold') {
                return this._cleanNatural(await this._koboldGenerate(prompt, cfg));
            }
            if (cfg.promptSource === 'remote') {
                return this._cleanNatural(await this._remoteGenerate(prompt, cfg));
            }

            const result = await window.generateFunctionalReply(prompt, 'bg-prompt-natural');
            return result ? this._cleanNatural(result) : null;
        },

        // ---------- 统一入口 ----------
        async generate(scene) {
            const style = BackgroundGenState.config.promptStyle || 'natural';
            if (style === 'clip') {
                return await this.generateFromScene(scene);
            }
            return await this.generateFromSceneNatural(scene);
        },

        // ---------- 清洗工具 ----------
        _cleanClip(text) {
            if (!text) return null;
            let s = String(text).trim();
            s = s.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
            s = s.replace(/^["'「『]+/, '').replace(/["'」』]+$/, '').trim();
            s = s.replace(/^(Prompt|Tags|Output|Result)\s*[:：]\s*/i, '').trim();
            s = s.replace(/\s*\n\s*/g, ', ').replace(/,\s*,/g, ',').replace(/\s+/g, ' ');
            return s || null;
        },

        _cleanNatural(text) {
            if (!text) return null;
            let s = String(text).trim();
            s = s.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
            s = s.replace(/^["'「『]+/, '').replace(/["'」』]+$/, '').trim();
            s = s.replace(/^(Prompt|Output|Result)\s*[:：]\s*/i, '').trim();
            s = s.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
            return s || null;
        },

        // ---------- 后端 ----------
        async _koboldGenerate(prompt, cfg) {
            const url = `${cfg.koboldUrl}/api/v1/generate`;
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt, max_length: 300, temperature: 0.8, top_p: 0.9, rep_pen: 1.1,
                }),
            });
            if (!resp.ok) throw new Error(`Kobold ${resp.status}`);
            const data = await resp.json();
            return (data.results?.[0]?.text || '').trim();
        },

        async _remoteGenerate(prompt, cfg) {
            const headers = { 'Content-Type': 'application/json' };
            const isClaude = cfg.remoteProvider === 'claude';
            if (isClaude) {
                headers['x-api-key'] = cfg.remoteApiKey;
                headers['anthropic-version'] = '2023-06-01';
            } else if (cfg.remoteApiKey) {
                headers['Authorization'] = `Bearer ${cfg.remoteApiKey}`;
            }

            const body = isClaude
                ? { model: cfg.remoteModel, max_tokens: 400,
                    messages: [{ role: 'user', content: prompt }] }
                : { model: cfg.remoteModel, max_tokens: 400, temperature: 0.8,
                    messages: [{ role: 'user', content: prompt }] };

            const resp = await fetch(cfg.remoteApiUrl, {
                method: 'POST', headers, body: JSON.stringify(body),
            });
            if (!resp.ok) throw new Error(`Remote ${resp.status}`);
            const data = await resp.json();
            return isClaude
                ? (data.content?.[0]?.text || '').trim()
                : (data.choices?.[0]?.message?.content || '').trim();
        },
    };

    // ==================== ComfyUI 通信 ====================
    const BackgroundComfyClient = {
        generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        },

        async generate(promptText) {
            const cfg = BackgroundGenState.config;
            const wf = BackgroundWorkflowManager.getActive();
            const workflow = JSON.parse(JSON.stringify(wf.workflow));

            // ★ 前缀默认空，需要时用户在手机里填
            const fullPrompt = (cfg.stylePrefix || '') + promptText;

            if (workflow[wf.promptNode]?.inputs) {
                workflow[wf.promptNode].inputs[wf.promptField || 'text'] = fullPrompt;
            }

            if (wf.negativeNode && workflow[wf.negativeNode]?.inputs) {
                workflow[wf.negativeNode].inputs[wf.negativeField || 'text'] = cfg.negativePrompt || '';
            }

            if (wf.widthNode && workflow[wf.widthNode]?.inputs) {
                if ('width' in workflow[wf.widthNode].inputs) workflow[wf.widthNode].inputs.width = cfg.width;
                if ('height' in workflow[wf.widthNode].inputs) workflow[wf.widthNode].inputs.height = cfg.height;
            }

            if (wf.seedNode && workflow[wf.seedNode]?.inputs?.seed !== undefined) {
                workflow[wf.seedNode].inputs.seed = Math.floor(Math.random() * 2147483647);
            }

            const clientId = this.generateUUID();
            const promptId = this.generateUUID();

            return new Promise((resolve, reject) => {
                const wsUrl = `ws://${cfg.comfyuiUrl}/ws?clientId=${clientId}`;
                const ws = new WebSocket(wsUrl);

                const timeout = setTimeout(() => {
                    try { ws.close(); } catch (e) {}
                    reject(new Error('生成超时（120s）'));
                }, 120000);

                ws.onopen = async () => {
                    try {
                        await this._queuePrompt(workflow, promptId, clientId, cfg.comfyuiUrl);
                        const images = await this._waitForCompletion(ws, promptId, cfg.comfyuiUrl);
                        clearTimeout(timeout);
                        ws.close();

                        if (images && images.length > 0) {
                            resolve(images[0]);
                        } else {
                            reject(new Error('未生成图片'));
                        }
                    } catch (e) {
                        clearTimeout(timeout);
                        try { ws.close(); } catch (e2) {}
                        reject(e);
                    }
                };

                ws.onerror = () => {
                    clearTimeout(timeout);
                    reject(new Error('WebSocket 连接失败，请检查 ComfyUI 是否启动'));
                };
            });
        },

        async _queuePrompt(workflow, promptId, clientId, host) {
            const resp = await fetch(`http://${host}/prompt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: workflow, client_id: clientId, prompt_id: promptId }),
            });
            if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(`ComfyUI 拒绝请求 (${resp.status}): ${txt.slice(0, 200)}`);
            }
        },

        _waitForCompletion(ws, promptId, host) {
            return new Promise((resolve, reject) => {
                ws.onmessage = async (event) => {
                    try {
                        const msg = JSON.parse(event.data);
                        if (msg.type === 'executing'
                            && msg.data.node === null
                            && msg.data.prompt_id === promptId) {
                            const images = await this._fetchHistory(promptId, host);
                            resolve(images);
                        }
                    } catch (e) {
                        console.warn('[BgGen] ws 消息解析失败:', e);
                    }
                };
                ws.onerror = () => reject(new Error('WebSocket 错误'));
            });
        },

        async _fetchHistory(promptId, host) {
            const resp = await fetch(`http://${host}/history/${promptId}`);
            if (!resp.ok) throw new Error('获取历史失败');
            const history = await resp.json();

            const outputs = history[promptId]?.outputs || {};
            const urls = [];
            for (const node of Object.values(outputs)) {
                if (!node.images) continue;
                for (const img of node.images) {
                    const params = new URLSearchParams({
                        filename: img.filename,
                        subfolder: img.subfolder || '',
                        type: img.type || 'output',
                    });
                    const imgResp = await fetch(`http://${host}/view?${params}`);
                    const blob = await imgResp.blob();
                    const dataUrl = await new Promise((res, rej) => {
                        const reader = new FileReader();
                        reader.onload = () => res(reader.result);
                        reader.onerror = rej;
                        reader.readAsDataURL(blob);
                    });
                    urls.push(dataUrl);
                }
            }
            return urls;
        },

        async testConnection() {
            const cfg = BackgroundGenState.config;
            try {
                const resp = await fetch(`http://${cfg.comfyuiUrl}/system_stats`);
                return resp.ok;
            } catch (e) {
                return false;
            }
        },
    };

    // ==================== 对外主 API ====================
    const BackgroundGenerator = {
        _initPromise: null,

        async generateForCurrentScene() {
            if (BackgroundGenState.isGenerating) {
                window.UIManager.showText('正在生成背景图，请稍候...', 1500);
                return null;
            }

            const scene = window.LocationModalManager?.currentLocation;
            if (!scene) {
                window.UIManager.showText('请先进入一个场景', 2000);
                return null;
            }

            BackgroundGenState.isGenerating = true;

            try {
                await window.UIManager.showText('🎨 正在生成背景提示词...', 1500);

                // ★ 统一入口，根据配置自动选 clip / natural
                const promptText = await BackgroundPromptGenerator.generate(scene);
                if (!promptText) throw new Error('提示词生成失败');

                console.log('[BgGen] 提示词:', promptText);

                await window.UIManager.showText('🖼️ 正在绘制背景图...', 1500);
                const dataUrl = await BackgroundComfyClient.generate(promptText);
                if (!dataUrl) throw new Error('未返回图片');

                await this._applyToScene(scene, dataUrl, promptText);

                await window.UIManager.showText(
                    `✅ 背景图已生成并应用\n（提示词：${promptText.slice(0, 50)}...）`,
                    3000
                );

                return { dataUrl, prompt: promptText };

            } catch (e) {
                console.error('[BgGen] 生成失败:', e);
                BackgroundGenState.lastError = e.message;
                await window.UIManager.showText(`❌ 生成失败：${e.message}`, 3500);
                return null;
            } finally {
                BackgroundGenState.isGenerating = false;
            }
        },

        async _applyToScene(scene, dataUrl, promptText) {
            if (!scene) return;

            const imageId = `bg_${scene.name.replace(/[^\w\u4e00-\u9fa5]/g, '_')}_${Date.now()}`;

            try {
                await BackgroundImageStore.put(imageId, {
                    dataUrl,
                    prompt: promptText,
                    sceneName: scene.name,
                    createdAt: Date.now(),
                });
                console.log('[BgGen] 原图已存入 IndexedDB:', imageId);
            } catch (e) {
                console.error('[BgGen] IndexedDB 写入失败:', e);
                scene.generatedBackground = dataUrl;
                scene.generatedBackgroundPrompt = promptText;
                scene.generatedBackgroundAt = Date.now();
                this._applyLayer(dataUrl);
                if (window.SaveManager) window.SaveManager.save();
                return;
            }

            const oldId = scene.generatedBackgroundId;
            if (oldId && oldId !== imageId) {
                BackgroundImageStore.delete(oldId).catch(() => {});
            }

            delete scene.generatedBackground;
            scene.generatedBackgroundId = imageId;
            scene.generatedBackgroundPrompt = promptText;
            scene.generatedBackgroundAt = Date.now();

            this._applyLayer(dataUrl);

            if (window.SaveManager) window.SaveManager.save();
        },

        _applyLayer(dataUrl) {
            const bgLayer = document.getElementById('cinemaworld-background');
            if (!bgLayer) return;

            bgLayer.innerHTML = '';
            const layer = document.createElement('div');
            layer.style.cssText = `
                position:absolute;top:0;left:0;width:100%;height:100%;
                background-image:url('${dataUrl}');
                background-size:cover;background-position:center;
                opacity:0;transition:opacity .8s ease;z-index:0;
            `;
            bgLayer.appendChild(layer);
            void layer.offsetWidth;
            layer.style.opacity = '1';

            if (window.BackgroundManager) {
                window.BackgroundManager.current = '__generated__';
            }
        },

        async restoreGeneratedBackground(scene) {
            if (!scene || !scene.generatedBackgroundId) return false;

            try {
                const rec = await BackgroundImageStore.get(scene.generatedBackgroundId);
                if (rec?.dataUrl) {
                    this._applyLayer(rec.dataUrl);
                    return true;
                }
                console.warn('[BgGen] 背景图记录丢失，清空引用:', scene.generatedBackgroundId);
                delete scene.generatedBackgroundId;
                delete scene.generatedBackgroundPrompt;
                delete scene.generatedBackgroundAt;
                if (window.SaveManager) window.SaveManager.save();
                return false;
            } catch (e) {
                console.error('[BgGen] 恢复背景图失败:', e);
                return false;
            }
        },

        async clearForCurrentScene() {
            const scene = window.LocationModalManager?.currentLocation;
            if (!scene) return;

            if (scene.generatedBackgroundId) {
                try {
                    await BackgroundImageStore.delete(scene.generatedBackgroundId);
                } catch (e) {
                    console.warn('[BgGen] 删除背景图记录失败:', e);
                }
            }

            delete scene.generatedBackgroundId;
            delete scene.generatedBackgroundPrompt;
            delete scene.generatedBackgroundAt;
            delete scene.generatedBackground;

            if (window.BackgroundManager) {
                if (scene.background) {
                    await window.BackgroundManager.apply(scene.background);
                } else {
                    await window.BackgroundManager.apply(scene.name);
                }
            }

            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText('已清除生成的背景图', 1500);
        },

        getConfig() { return { ...BackgroundGenState.config }; },

        setConfig(patch) {
            Object.assign(BackgroundGenState.config, patch);
            BackgroundGenConfig.save(BackgroundGenState.config);
        },

        isEnabled() { return BackgroundGenState.config.enabled; },
        isGenerating() { return BackgroundGenState.isGenerating; },
        getWorkflows() { return BackgroundGenState.workflows; },

        async init() {
            if (this._initPromise) {
                console.log('[BgGen] init 已在执行/已完成，跳过');
                return this._initPromise;
            }
            this._initPromise = this._doInit();
            return this._initPromise;
        },

        async _doInit() {
            try {
                await BackgroundImageStore.init();
            } catch (e) {
                console.warn('[BgGen] IndexedDB 初始化失败:', e);
            }
            await BackgroundWorkflowManager.init();
            console.log('[BgGen] 初始化完成，enabled =', BackgroundGenState.config.enabled,
                ', promptStyle =', BackgroundGenState.config.promptStyle);
        },
    };

    // ==================== 挂载 ====================
    window.BackgroundGenerator = BackgroundGenerator;
    window.BackgroundGenConfig = BackgroundGenConfig;
    window.BackgroundWorkflowManager = BackgroundWorkflowManager;
    window.BackgroundPromptGenerator = BackgroundPromptGenerator;
    window.BackgroundComfyClient = BackgroundComfyClient;
    window.BackgroundImageStore = BackgroundImageStore;

    console.log('[CinemaWorld] background-gen.js 已加载');
})();