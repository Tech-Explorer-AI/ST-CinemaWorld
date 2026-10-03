// ============================================================
// CinemaWorld - 从无到有的世界引擎
// 模块化入口
// ============================================================

(function () {
    'use strict';

    // 利用当前脚本标签的 src 反推目录
    const BASE_PATH = (() => {
        const cur = document.currentScript;
        if (cur && cur.src) {
            return cur.src.replace(/index\.js.*$/, '');
        }
        for (const s of document.querySelectorAll('script[src]')) {
            if (/CinemaWorld|CinemaMode/i.test(s.src) && /index\.js/.test(s.src)) {
                return s.src.replace(/index\.js.*$/, '');
            }
        }
        return 'scripts/extensions/third-party/ST-CinemaWorld-main/';
    })();

    // ============================================================
    // ★ 公共加载器：挂到 window 上，供子目录 index.js 复用
    // BASE 指向 modules/ 目录，所有路径相对它解析
    // ============================================================
    window.CWLoader = {
        BASE: BASE_PATH + 'modules/',

        load(filename, key) {
            key = key || filename;
            return new Promise((resolve) => {
                if (document.querySelector(`script[data-cw-module="${key}"]`)) {
                    resolve();
                    return;
                }
                const s = document.createElement('script');
                s.src = this.BASE + filename;
                s.dataset.cwModule = key;
                s.onload = () => {
                    console.log(`[CinemaWorld] 模块已加载: ${key}`);
                    resolve();
                };
                s.onerror = () => {
                    console.error(`[CinemaWorld] 模块加载失败: ${key}`);
                    resolve();   // 不阻塞后续
                };
                document.head.appendChild(s);
            });
        },

        async loadAll(list, keyPrefix = '') {
            for (const f of list) {
                await this.load(keyPrefix + f, keyPrefix + f);
            }
        }
    };

    // ============================================================
    // ★ 严格按依赖顺序加载，不能乱（路径相对 modules/）
    // ============================================================
    const MODULES = [
        'css-loader.js',             // L0：样式加载器
        'core.js',                   // L1：核心状态 + 角色档案 + 骰子 + 语义
        'world.js',                  // L2：世界管理 + 背景 + 音乐 + 立绘
        'player.js',                 // L2：玩家状态 + 装备 + 派生 + 标签效果
        'scene.js',                  // L3：场景浏览/编辑/行动/立绘层/头像栏
        'story.js',                  // L3：剧情 + 章节 + 交互历史/摘要
        'rules.js',                  // L3：规则引擎 + 触发器 + 游戏钩子
        'interact.js',               // L4：效果系统 + 交互 + 背包 + 商店
        'item-effect.js',            // L4：效果系统 + 交互 + 背包 + 商店
        'battle.js',                 // L4：战斗系统
        'simulation.js',             // L4：模拟经营
        'city.js',                   // L4：模拟经营
        'industry.js',               // L4：模拟经营
        'background-gen.js',         // L4：AI 背景图生成（引擎层）
        'background-ui.js',          // L5：AI 背景图生成（UI 层）
        'social.js',                 // L5：虚拟社交
        'bond.js',                   // L5：羁绊模块
        'ui.js',                     // L5：UI + VN + 手机 + 玩家创建 + 启动

        // ↓ 子目录聚合入口（各自内部自己加载）
        'TTS/index.js',
        'map/index.js',
        'strategy/index.js',

        'click.js',
        'save.js',                   // L6：存档（依赖所有模块）
    ];

    // ---------- 加载单个脚本（复用 CWLoader）----------
    function loadScript(filename) {
        return window.CWLoader.load(filename, filename);
    }

    // ---------- 等待子目录聚合入口挂出 Promise ----------
    async function awaitAggregator(promiseGetter) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
            const p = promiseGetter();
            if (p) return p;
            await new Promise((r) => setTimeout(r, 20));
        }
        console.warn('[CinemaWorld] 聚合入口未挂载 Promise，超时放行');
    }

    // ---------- 按顺序加载所有模块 ----------
    async function loadAll() {
        for (const m of MODULES) {
            await loadScript(m);

            // 加载完聚合入口后，等它内部全部加载完
            if (m === 'map/index.js') {
                await awaitAggregator(() => window.CinemaWorldMapLoader);
                await awaitAggregator(() => window.CinemaWorldMap3DLoader);
            } else if (m === 'strategy/index.js') {
                await awaitAggregator(() => window.CinemaWorldStrategyLoader);
            }else if (m === 'TTS/index.js') {
                // ★ 新增
                await awaitAggregator(() => window.CinemaWorldTTSLoader);
            }
        }
    }

    // ---------- 初始化插件（等所有模块加载完） ----------
    function initPlugin() {
        console.log('[CinemaWorld] 插件初始化开始');

        try {
            // 1. 预热样式
            if (window.CinemaWorldCSS) window.CinemaWorldCSS.ensure();

            // 2. 核心 UI
            window.UIManager.init();
            window.StoryManager.init();
            window.SaveManager.init();

            // 3. 载入存档
            const loaded = window.SaveManager.load();
            if (loaded) {
                window.CharacterNameManager.sync();
                window.UIManager.createFloatingButtons();
                window.UIManager.updateWorldStateDisplay();

                const curScene = window.LocationModalManager.currentLocation;
                if (curScene) {
                    window.LocationModalManager.restoreScene(curScene).then(() => {
                        console.log('[CinemaWorld] 场景已恢复:', curScene.name);
                    });
                }
            }

            // 4. 悬浮入口按钮
            addEnterButton();

            // 5. 退出时保存
            window.addEventListener('beforeunload', () => window.SaveManager.save());

            console.log('[CinemaWorld] 插件初始化完成');
        } catch (e) {
            console.error('[CinemaWorld] 初始化失败:', e);
        }
    }

    function addEnterButton() {
        if (document.getElementById('cinemaworld-enter-wrapper')) return;
    
        const style = document.createElement('style');
        style.id = 'cinemaworld-enter-btn-styles';
        style.textContent = `
            /* ============================================================ */
            /* 全屏锚点容器：铺满视口，不接收点击，只用来定位按钮          */
            /* ============================================================ */
            #cinemaworld-enter-wrapper {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                height: 100dvh !important;
                pointer-events: none !important;
                z-index: 2147483647 !important;
                transform: translateZ(0);
                isolation: isolate;
                margin: 0 !important;
                padding: 0 !important;
                border: 0 !important;
                overflow: visible !important;
            }
    
            #cinemaworld-enter-btn {
                position: absolute !important;
                right: max(20px, env(safe-area-inset-right, 20px)) !important;
                bottom: max(20px, env(safe-area-inset-bottom, 20px)) !important;
                width: 80px !important;
                height: 80px !important;
                border-radius: 40px !important;
                background: linear-gradient(135deg, #667eea, #764ba2) !important;
                color: #fff !important;
                border: none !important;
                cursor: pointer !important;
                font-size: 36px !important;
                box-shadow: 0 4px 15px rgba(0,0,0,.3) !important;
                pointer-events: auto !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                visibility: visible !important;
                opacity: 1 !important;
                transition: all .3s !important;
                padding: 0 !important;
                margin: 0 !important;
                user-select: none !important;
                -webkit-tap-highlight-color: transparent !important;
                touch-action: manipulation !important;
            }
            #cinemaworld-enter-btn:hover {
                transform: scale(1.1) !important;
                box-shadow: 0 6px 20px rgba(0,0,0,.5) !important;
            }
            #cinemaworld-enter-btn:active {
                transform: scale(0.95) !important;
            }
            #cinemaworld-enter-btn.in-plugin {
                background: linear-gradient(135deg, #d87d7d, #a85a5a) !important;
            }
    
            /* 手机（<768px）默认中右侧 */
            @media (max-width: 768px) {
                #cinemaworld-enter-btn {
                    width: 54px !important;
                    height: 54px !important;
                    font-size: 22px !important;
                    border-radius: 27px !important;
                    right: 12px !important;
                    bottom: auto !important;
                    top: 50% !important;
                    transform: translateY(-50%) !important;
                }
                #cinemaworld-enter-btn:hover {
                    transform: translateY(-50%) scale(1.08) !important;
                }
                #cinemaworld-enter-btn:active {
                    transform: translateY(-50%) scale(0.95) !important;
                }
            }
    
            /* 手机竖屏：靠底部，避开 ST 输入框 + iPhone 安全区 */
            @media (max-width: 768px) and (orientation: portrait) {
                #cinemaworld-enter-btn {
                    top: auto !important;
                    bottom: calc(24px + env(safe-area-inset-bottom, 0px)) !important;
                    transform: none !important;
                }
                #cinemaworld-enter-btn:hover {
                    transform: scale(1.08) !important;
                }
                #cinemaworld-enter-btn:active {
                    transform: scale(0.95) !important;
                }
            }
    
            /* 极窄屏（<400px） */
            @media (max-width: 400px) {
                #cinemaworld-enter-btn {
                    width: 48px !important;
                    height: 48px !important;
                    font-size: 20px !important;
                    border-radius: 24px !important;
                    right: 10px !important;
                }
            }
        `;
        document.head.appendChild(style);
    
        const wrapper = document.createElement('div');
        wrapper.id = 'cinemaworld-enter-wrapper';
    
        const btn = document.createElement('button');
        btn.id = 'cinemaworld-enter-btn';
        btn.innerHTML = '🎬';
        btn.title = '进入 CinemaWorld';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const container = document.getElementById('cinemaworld-container');
            const isActive = container && container.classList.contains('active');
            if (isActive) {
                window.UIManager.exitCinemaWorld();
            } else {
                window.UIManager.enterCinemaWorld();
            }
        });
    
        wrapper.appendChild(btn);
        document.documentElement.appendChild(wrapper);
    
        // ★ 保底：如果酒馆往 html 末尾塞了更高层级元素，把 wrapper 移到最后
        const mo = new MutationObserver(() => {
            if (wrapper.parentElement === document.documentElement &&
                wrapper !== document.documentElement.lastElementChild) {
                document.documentElement.appendChild(wrapper);
            }
        });
        mo.observe(document.documentElement, { childList: true });
    
        console.log('[CinemaWorld] 入口按钮已挂载到 documentElement');
    }

    // ---------- 启动 ----------
    async function boot() {
        await loadAll();
        initPlugin();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();