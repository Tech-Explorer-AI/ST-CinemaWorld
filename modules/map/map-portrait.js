// ============================================================
// CinemaWorld · map-portrait.js
// 地图左下角立绘层：靠近 NPC 时浮现，离开时淡出
// 依赖：core.js（SpriteManager）, map-canvas.js
// 暴露：window.MapPortraitLayer
// ============================================================

(function () {
    'use strict';

    const MapPortraitLayer = {
        _el: null,
        _imgEl: null,
        _nameEl: null,
        _tagEl: null,
        _currentEntityId: null,
        _currentUrl: null,
        _hideTimer: null,

        // 靠近判定半径（格）
        NEAR_RADIUS: 2,

        // ---------- 初始化 ----------
        init() {
            if (this._el) return;

            const el = document.createElement('div');
            el.id = 'cw-map-portrait';
            el.innerHTML = `
                <div class="cw-map-portrait-img-wrap">
                    <img class="cw-map-portrait-img" alt="">
                    <div class="cw-map-portrait-placeholder"></div>
                </div>
                <div class="cw-map-portrait-info">
                    <div class="cw-map-portrait-name"></div>
                    <div class="cw-map-portrait-tag"></div>
                </div>
            `;
            const container = document.getElementById('cinemaworld-container') || document.body;
            container.appendChild(el);

            this._el = el;
            this._imgEl = el.querySelector('.cw-map-portrait-img');
            this._nameEl = el.querySelector('.cw-map-portrait-name');
            this._tagEl = el.querySelector('.cw-map-portrait-tag');
            this._placeholderEl = el.querySelector('.cw-map-portrait-placeholder');

            this._injectStyles();
            console.log('[MapPortrait] 已初始化');
        },

        // ---------- 样式 ----------
        _injectStyles() {
            if (document.getElementById('cw-map-portrait-styles')) return;
            const s = document.createElement('style');
            s.id = 'cw-map-portrait-styles';
            s.textContent = `
                #cw-map-portrait {
                    position: fixed;
                    left: 24px;
                    bottom: 24px;
                    z-index: 1000;
                    pointer-events: none;
                    display: flex;
                    flex-direction: column;
                    align-items: flex-start;
                    gap: 10px;
                    opacity: 0;
                    transform: translateY(16px);
                    transition: opacity .28s ease, transform .28s ease;
                }
                #cw-map-portrait.visible {
                    opacity: 1;
                    transform: translateY(0);
                }
        
                .cw-map-portrait-img-wrap {
                    position: relative;
                    width: 300px;
                    height: 400px;
                    border-radius: 16px;
                    overflow: hidden;
                    background: linear-gradient(180deg,
                        rgba(30,30,50,0.55) 0%,
                        rgba(20,20,35,0.85) 100%);
                    border: 1px solid rgba(120,150,255,0.4);
                    box-shadow:
                        0 16px 48px rgba(0,0,0,0.6),
                        0 0 0 1px rgba(255,255,255,0.05) inset;
                    backdrop-filter: blur(6px);
                }
        
                .cw-map-portrait-img {
                    position: absolute;
                    inset: 0;
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    object-position: center top;
                    display: none;
                }
                .cw-map-portrait-img.loaded {
                    display: block;
                }
        
                .cw-map-portrait-placeholder {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 130px;
                    line-height: 1;
                    color: rgba(255,255,255,0.35);
                }
                .cw-map-portrait-img.loaded ~ .cw-map-portrait-placeholder {
                    display: none;
                }
        
                .cw-map-portrait-info {
                    padding: 10px 18px;
                    background: rgba(20,20,35,0.88);
                    border: 1px solid rgba(120,150,255,0.35);
                    border-radius: 12px;
                    backdrop-filter: blur(6px);
                    box-shadow: 0 6px 20px rgba(0,0,0,0.5);
                }
        
                .cw-map-portrait-name {
                    font-size: 18px;
                    font-weight: 700;
                    color: #fff;
                    letter-spacing: 0.3px;
                    text-shadow: 0 1px 4px rgba(0,0,0,0.6);
                }
        
                .cw-map-portrait-tag {
                    font-size: 12px;
                    color: #9ab0ff;
                    margin-top: 3px;
                }
        
                @media (max-width: 640px) {
                    #cw-map-portrait {
                        left: 12px;
                        bottom: 12px;
                    }
                    .cw-map-portrait-img-wrap {
                        width: 180px;
                        height: 240px;
                    }
                    .cw-map-portrait-placeholder {
                        font-size: 88px;
                    }
                    .cw-map-portrait-name {
                        font-size: 15px;
                    }
                    .cw-map-portrait-tag {
                        font-size: 11px;
                    }
                }
            `;
            document.head.appendChild(s);
        },

        // ============================================================
        // ★ 由外部调用：直接指定"当前要显示的 NPC"
        //   ent = null → 隐藏
        //   dist = 距离（格，用于 tag 显示）
        // ============================================================
        showEntity(ent, dist) {
            if (!this._el) return;

            // 没有 → 隐藏
            if (!ent) {
                if (this._currentEntityId) this.hide();
                return;
            }

            // 同一个 NPC → 只更新距离 tag
            if (ent.id === this._currentEntityId) {
                this._updateTag(ent, dist);
                return;
            }

            // 切换 NPC → 重建
            this._currentEntityId = ent.id;
            this.show(ent, dist);
        },

        // ============================================================
        // ★ 更新 tag（名字下方的描述行）
        // ============================================================
        _updateTag(ent, dist) {
            const tagParts = [];
            if (ent.tags?.length) tagParts.push(ent.tags[0]);
            const mood = ent.mood || ent.meta?.mood || ent.fields?.['心情'];
            if (mood) tagParts.push(mood);
            if (dist <= 1) tagParts.push('· 近在咫尺');
            const newTag = tagParts.join(' · ');
            if (this._tagEl.textContent !== newTag) {
                this._tagEl.textContent = newTag;
            }
        },

        // ============================================================
        // 兼容旧调用（每帧传 entities）
        //   ★ 新代码不再使用，保留作兜底
        // ============================================================
        update(entities, playerX, playerY) {
            if (!this._el) return;

            let best = null;
            let bestDist = Infinity;

            for (const ent of entities) {
                if (ent.isPlayer) continue;
                if (ent.kind !== 'npc') continue;
                if (!ent._placed) continue;

                const dx = ent.x - playerX;
                const dy = ent.y - playerY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist <= this.NEAR_RADIUS && dist < bestDist) {
                    bestDist = dist;
                    best = ent;
                }
            }

            // ★ 转发到 showEntity
            this.showEntity(best, best ? bestDist : Infinity);
        },

        // ---------- 显示 ----------
        async show(ent, dist) {
            if (this._hideTimer) {
                clearTimeout(this._hideTimer);
                this._hideTimer = null;
            }

            // 名字 / 标签
            this._nameEl.textContent = ent.name || '???';
            this._updateTag(ent, dist);

            // ★ 切换 NPC：重新加载立绘
            this._imgEl.classList.remove('loaded');
            this._imgEl.removeAttribute('src');
            this._placeholderEl.textContent = ent.emoji || '👤';

            const url = await this._resolveSprite(ent);
            if (this._currentEntityId !== ent.id) return;   // 期间切换了

            if (url) {
                this._imgEl.onload = () => {
                    this._imgEl.classList.add('loaded');
                };
                this._imgEl.onerror = () => {
                    this._imgEl.classList.remove('loaded');
                };
                this._imgEl.src = url;
                this._currentUrl = url;
            }

            // 显示容器
            requestAnimationFrame(() => {
                if (this._currentEntityId === ent.id) {
                    this._el.classList.add('visible');
                }
            });
        },

        // ---------- 拿立绘 ----------
        async _resolveSprite(ent) {
            if (!window.SpriteManager) return null;

            const fakeChar = {
                name: ent.name,
                gender: ent.meta?.gender || ent.fields?.['性别'] || '未知',
                mood: ent.meta?.mood || ent.fields?.['心情'] || '',
                status: ent.status || '',
                tags: ent.tags || [],
            };

            // 先查缓存
            const state = window.SpriteManager.pickSpriteState?.(fakeChar);
            const cached = window.SpriteManager.getCachedSpriteWithState?.(ent.name, state)
                        || window.SpriteManager.getCachedSprite?.(ent.name);
            if (cached) return cached;

            // 缓存没有 → 异步加载
            try {
                const url = await window.SpriteManager.ensureSpriteWithState?.(
                    ent.name, fakeChar.gender, state || '默认'
                );
                return url || null;
            } catch (e) {
                console.warn('[MapPortrait] 立绘加载失败:', e);
                return null;
            }
        },

        // ---------- 隐藏 ----------
        hide() {
            if (!this._el) return;

            this._el.classList.remove('visible');
            this._currentEntityId = null;

            // 等淡出动画结束再清图，避免闪现
            if (this._hideTimer) clearTimeout(this._hideTimer);
            this._hideTimer = setTimeout(() => {
                if (this._currentEntityId) return;   // 期间又显示了
                this._imgEl.classList.remove('loaded');
                this._imgEl.removeAttribute('src');
                this._placeholderEl.textContent = '';
                this._hideTimer = null;
            }, 320);
        },

        // ---------- 强制销毁 ----------
        destroy() {
            if (this._hideTimer) clearTimeout(this._hideTimer);
            this._el?.remove();
            this._el = null;
            this._imgEl = null;
            this._nameEl = null;
            this._tagEl = null;
            this._placeholderEl = null;
            this._currentEntityId = null;
            this._currentUrl = null;
        },
    };

    window.MapPortraitLayer = MapPortraitLayer;
    console.log('[CinemaWorld] map-portrait.js 已加载');
})();