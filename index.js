// ============================================================
// CinemaWorld - 从无到有的世界引擎
// 模块化入口
// ============================================================

(function () {
    'use strict';

    const BASE_PATH = 'scripts/extensions/third-party/CinemaWorld/';

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

    // ---------- 悬浮入口按钮（原样保留） ----------
    function addEnterButton() {
        if (document.getElementById('cinemaworld-enter-btn')) return;

        const style = document.createElement('style');
        style.textContent = `
            #cinemaworld-enter-btn{position:fixed;bottom:20px;right:20px;width:60px;height:60px;border-radius:30px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;cursor:pointer;font-size:24px;box-shadow:0 4px 15px rgba(0,0,0,.3);z-index:10000;transition:all .3s;display:flex;align-items:center;justify-content:center;}
            #cinemaworld-enter-btn:hover{transform:scale(1.1);box-shadow:0 6px 20px rgba(0,0,0,.5);}
            #cinemaworld-enter-btn.in-plugin{background:linear-gradient(135deg,#d87d7d,#a85a5a);z-index:10001;}
        `;
        document.head.appendChild(style);

        const btn = document.createElement('button');
        btn.id = 'cinemaworld-enter-btn';
        btn.innerHTML = '🎬';
        btn.title = '进入 CinemaWorld';
        btn.onclick = () => {
            const container = document.getElementById('cinemaworld-container');
            const isActive = container && container.classList.contains('active');
            if (isActive) {
                window.UIManager.exitCinemaWorld();
            } else {
                window.UIManager.enterCinemaWorld();
            }
        };
        document.body.appendChild(btn);
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