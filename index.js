// ============================================================
// CinemaWorld - 从无到有的世界引擎
// 模块化入口
// ============================================================

(function () {
    'use strict';

    // 利用当前脚本标签的 src 反推目录
    const BASE_PATH = (() => {
        // 找到加载本 index.js 的 script 标签
        const scripts = document.querySelectorAll('script[src*="CinemaWorld"], script[src*="CinemaMode"]');
        // 更通用的做法：用 document.currentScript（在同步执行时有效）
        const cur = document.currentScript;
        if (cur && cur.src) {
            return cur.src.replace(/index\.js.*$/, '');
        }
        // 兜底：遍历所有 script，找 src 里含本扩展名的
        for (const s of document.querySelectorAll('script[src]')) {
            if (/CinemaWorld|CinemaMode/i.test(s.src) && /index\.js/.test(s.src)) {
                return s.src.replace(/index\.js.*$/, '');
            }
        }
        // 最后兜底：保持原样
        return 'scripts/extensions/third-party/ST-CinemaWorld-main/';
    })();

    // ★ 严格按依赖顺序加载，不能乱
    const MODULES = [
        'modules/css-loader.js',     // L0：样式加载器
        'modules/core.js',           // L1：核心状态 + 角色档案 + 骰子 + 语义
        'modules/world.js',          // L2：世界管理 + 背景 + 音乐 + 立绘
        'modules/player.js',         // L2：玩家状态 + 装备 + 派生 + 标签效果
        'modules/scene.js',          // L3：场景浏览/编辑/行动/立绘层/头像栏
        'modules/story.js',          // L3：剧情 + 章节 + 交互历史/摘要
        'modules/rules.js',          // L3：规则引擎 + 触发器 + 游戏钩子
        'modules/interact.js',       // L4：效果系统 + 交互 + 背包 + 商店
        'modules/battle.js',         // L4：战斗系统
        'modules/simulation.js',     // L4：模拟经营
        'modules/city.js',           // L4：模拟经营
        'modules/industry.js',           // L4：模拟经营
        'modules/background-gen.js', // L4：AI 背景图生成（引擎层）
        'modules/background-ui.js',  // L5：AI 背景图生成（UI 层，依赖 PhoneUIManager）
        'modules/social.js',         // L5：虚拟社交
        'modules/bond.js',           // L5：羁绊模块
        'modules/click.js',  
        'modules/ui.js',             // L5：UI + VN + 手机 + 玩家创建 + 启动
        'modules/save.js',           // L6：存档（依赖所有模块）
    ];

    // ---------- 动态加载单个脚本 ----------
    function loadScript(filename) {
        return new Promise((resolve) => {
            const exist = document.querySelector(`script[data-cw-module="${filename}"]`);
            if (exist) { resolve(); return; }

            const s = document.createElement('script');
            s.src = BASE_PATH + filename;
            s.dataset.cwModule = filename;
            s.onload = () => {
                console.log(`[CinemaWorld] 模块已加载: ${filename}`);
                resolve();
            };
            s.onerror = () => {
                console.error(`[CinemaWorld] 模块加载失败: ${filename}`);
                resolve();   // 不阻塞后续
            };
            document.head.appendChild(s);
        });
    }

    // ---------- 按顺序加载所有模块 ----------
    async function loadAll() {
        for (const m of MODULES) {
            await loadScript(m);
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
                z-index: 2147483647 !important;   /* ★ 最高 */
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