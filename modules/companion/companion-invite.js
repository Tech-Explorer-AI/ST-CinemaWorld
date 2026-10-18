// ============================================================
// CinemaWorld · companion/companion-invite.js
// 邀请入队入口（供地图/场景调用）
//
// 依赖：companion-core.js, companion-ai.js, companion-ui.js
// 暴露：window.CompanionInvite
// ============================================================

(function () {
    'use strict';

    const CharacterRegistry = window.CharacterRegistry;
    const CompanionManager = window.CompanionManager;
    const CompanionAIManager = window.CompanionAIManager;
    const CompanionUI = window.CompanionUI;

    const CompanionInvite = {
        async invite(name) {
            const norm = CharacterRegistry.normalizeName(name);
            if (!norm) return;

            if (CompanionManager.isMember(norm)) {
                window.UIManager?.showText?.(`${name} 已经在队伍里了`, 1500);
                return;
            }

            const ok = await this._confirm(name);
            if (!ok) return;

            window.UIManager?.showText?.('正在生成剧情...', 800);
            const story = await CompanionAIManager.generateJoinStory(name);

            if (!story) {
                window.UIManager?.showText?.('剧情生成失败，未入队', 2000);
                return;
            }

            await CompanionUI._playStory(story.raw);

            if (!story.accepted) {
                window.UIManager?.showText?.(`💬 ${name} 暂时婉拒了`, 2500);
                return;
            }

            const result = await CompanionManager.join(norm, {
                joinedFrom: this._getCurrentLocation(),
            });

            if (result.ok) {
                window.UIManager?.showText?.(`🤝 ${name} 加入了队伍`, 2500);
                CompanionUI._writeDigest(name, story.raw, '入队');
            
                // ★ 新增：自动打开队友详情模态框（延迟等提示消失）
                setTimeout(() => {
                    window.CompanionUI?.openModalDetail?.(norm);
                }, 600);
            } else {
                window.UIManager?.showText?.(result.message, 2000);
            }
        },

        _confirm(name) {
            return new Promise(resolve => {
                const modal = document.getElementById('cinemaworld-modal');
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">🤝 邀请同行</div>
                    <div class="cw-companion-confirm-body">
                        <div class="cw-companion-confirm-row">
                            <span>对象</span><span>${CompanionUI._escape(name)}</span>
                        </div>
                    </div>
                    <div class="cw-companion-confirm-hint">
                        邀请是否成功取决于你和她目前的关系。<br>
                        她可能会答应，也可能婉拒。
                    </div>
                    <div style="text-align:center;margin-top:16px;display:flex;justify-content:center;gap:10px;">
                        <button class="cinemaworld-button primary" id="cw-companion-go">邀请</button>
                        <button class="cinemaworld-button" id="cw-companion-cancel">取消</button>
                    </div>`;
                modal.className = 'active';

                document.getElementById('cw-companion-go').onclick = () => {
                    window.UIManager.closeModal();
                    resolve(true);
                };
                document.getElementById('cw-companion-cancel').onclick = () => {
                    window.UIManager.closeModal();
                    resolve(false);
                };
            });
        },

        _getCurrentLocation() {
            const scene = window.LocationModalManager?.currentLocation;
            if (scene?.name) return scene.name;
            const map = window.MapLauncher?.getMap?.();
            if (map?.name) return map.name;
            return '';
        },
    };

    window.CompanionInvite = CompanionInvite;
    console.log('[CinemaWorld/companion] companion-invite.js 已加载');
})();