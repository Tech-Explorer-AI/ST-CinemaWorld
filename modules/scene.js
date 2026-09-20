// ============================================================
// CinemaWorld · scene.js
// 场景浏览 / 编辑 / 行动 / 立绘层 / 头像栏 / 场景创建
// 依赖：core.js, world.js, player.js
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const WorldManager = window.WorldManager;
    const SpriteManager = window.SpriteManager;
    const BackgroundManager = window.BackgroundManager;
    const MusicManager = window.MusicManager;
    const PlayerStateManager = window.PlayerStateManager;
    const CharacterRegistry = window.CharacterRegistry;

    // ==================== 场景浏览/详情 ====================
    const LocationModalManager = {
        currentLocation: null,

        // ★ 统一的"进入场景"核心逻辑
        async doEnterScene(scene, options = {}) {
            if (!scene) return;

            CinemaWorld.ui.currentLocation = scene.name;
            LocationModalManager.currentLocation = scene;

            // 背景
            if (scene.generatedBackgroundId) {
                // ★ 异步从 IndexedDB 恢复 AI 生成的背景
                const ok = await window.BackgroundGenerator?.restoreGeneratedBackground(scene);
                if (!ok) {
                    // 记录丢失 → 走普通背景
                    if (scene.background) {
                        await BackgroundManager.apply(scene.background);
                    } else {
                        await BackgroundManager.apply(scene.name);
                    }
                }
            } else if (scene.generatedBackground) {
                // ★ 兼容旧存档（升级前生成的图还挂在 scene 上）
                const bgLayer = document.getElementById('cinemaworld-background');
                if (bgLayer) {
                    bgLayer.innerHTML = `<div style="position:absolute;inset:0;
                        background-image:url('${scene.generatedBackground}');
                        background-size:cover;background-position:center;z-index:0;"></div>`;
                }
                BackgroundManager.current = `__generated__${scene.name}`;

                // 顺手迁移到 IndexedDB
                if (window.BackgroundGenerator && window.BackgroundImageStore) {
                    const dataUrl = scene.generatedBackground;
                    const promptText = scene.generatedBackgroundPrompt || '';
                    delete scene.generatedBackground;
                    window.BackgroundGenerator._applyToScene(scene, dataUrl, promptText)
                        .catch(e => console.warn('[BgGen] 旧图迁移失败:', e));
                }
            } else if (scene.background) {
                await BackgroundManager.apply(scene.background);
            } else {
                await BackgroundManager.apply(scene.name);
            }

            // 音乐
            if (scene.music) {
                await MusicManager.setSceneMusic(scene.music);
            } else {
                MusicManager.setSceneMusic(null);
            }

            // 立绘 + 头像栏
            await SceneSpriteLayerManager.buildForScene(scene);
            SceneAvatarBarManager.buildForScene(scene);
            SceneActionManager.refresh();

            if (options.showText !== false) {
                await window.UIManager.showText(`进入了【${scene.name}】`, options.textDuration || 1500);
            }
        },

        // ★ 刷新时恢复场景（不显示提示文本）
        async restoreScene(scene) {
            if (!scene) return;
            CinemaWorld.ui.currentLocation = scene.name;
            LocationModalManager.currentLocation = scene;

            if (scene.generatedBackgroundId) {
                const ok = await window.BackgroundGenerator?.restoreGeneratedBackground(scene);
                if (!ok) {
                    if (scene.background) {
                        await BackgroundManager.apply(scene.background);
                    } else {
                        await BackgroundManager.apply(scene.name);
                    }
                }
            } else if (scene.generatedBackground) {
                const bgLayer = document.getElementById('cinemaworld-background');
                if (bgLayer) {
                    bgLayer.innerHTML = `<div style="position:absolute;inset:0;
                        background-image:url('${scene.generatedBackground}');
                        background-size:cover;background-position:center;z-index:0;"></div>`;
                }
                BackgroundManager.current = `__generated__${scene.name}`;

                if (window.BackgroundGenerator && window.BackgroundImageStore) {
                    const dataUrl = scene.generatedBackground;
                    const promptText = scene.generatedBackgroundPrompt || '';
                    delete scene.generatedBackground;
                    window.BackgroundGenerator._applyToScene(scene, dataUrl, promptText)
                        .catch(e => console.warn('[BgGen] 旧图迁移失败:', e));
                }
            } else if (scene.background) {
                await BackgroundManager.apply(scene.background);
            } else {
                await BackgroundManager.apply(scene.name);
            }

            if (scene.music) {
                await MusicManager.setSceneMusic(scene.music);
            } else {
                MusicManager.setSceneMusic(null);
            }

            await SceneSpriteLayerManager.buildForScene(scene);
            SceneAvatarBarManager.buildForScene(scene);
            SceneActionManager.refresh();
        },

        openLocationBrowser() {
            const scenes = WorldManager.getLocations();
            const modal = document.getElementById('cinemaworld-modal');

            if (scenes.length === 0) {
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📍 场景浏览</div>
                    <div style="text-align:center;padding:40px;color:#888;">
                        暂无场景<br><span style="font-size:14px;">点击 ➕ 创建场景</span>
                    </div>
                    <div style="text-align:center;margin-top:20px;">
                        <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                    </div>`;
                modal.className = 'active';
                return;
            }

            const cur = CinemaWorld.ui.currentLocation;
            let html = `<div class="cinemaworld-modal-title">📍 场景浏览</div><div style="display:grid;gap:10px;">`;
            for (const s of scenes) {
                const isCurrent = s.name === cur;
                html += `
                    <div style="background:${isCurrent ? 'rgba(120,150,255,.15)' : 'rgba(255,255,255,.05)'};border:1px solid ${isCurrent ? 'rgba(120,150,255,.4)' : 'rgba(255,255,255,.08)'};border-radius:10px;padding:15px;cursor:pointer;transition:all .2s;"
                         onclick="LocationModalManager.openLocationDetail('${s.name}')"
                         onmouseover="this.style.background='rgba(255,255,255,.1)'"
                         onmouseout="this.style.background='${isCurrent ? 'rgba(120,150,255,.15)' : 'rgba(255,255,255,.05)'}'">
                        <div style="font-weight:bold;font-size:15px;">📍 【${s.name}】${isCurrent ? ' <span style="color:#7da8ff;font-size:12px;">[当前]</span>' : ''}</div>
                        <div style="font-size:13px;color:#aaa;margin-top:5px;">${s.description ? s.description.substring(0, 60) + '...' : '无描述'}</div>
                    </div>`;
            }
            html += `</div>
                <div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="LocationCreationManager.showCreationModal()">➕ 创建新场景</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
            modal.innerHTML = html;
            modal.className = 'active';
        },

        openLocationDetail(name) {
            const scene = WorldManager.findEntity(name);
            if (!scene) return;
            this.currentLocation = scene;
            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = this.generateDetailHTML(scene);
            modal.className = 'active';
        },

        generateDetailHTML(scene) {
            const isCurrent = CinemaWorld.ui.currentLocation === scene.name;
            let html = `
                <div class="cinemaworld-modal-title">📍 【${scene.name}】</div>
                <div style="text-align:center;margin-bottom:15px;color:#aaa;font-size:14px;">${scene.description || '无描述'}</div>`;

            if (scene.environment) {
                html += `<div style="margin:10px 0;padding:10px;background:rgba(255,255,255,.03);border-radius:8px;font-size:13px;">
                    <span style="color:#888;">环境：</span>${scene.environment}
                </div>`;
            }

            // 人物
            if (scene.sceneCharacters && scene.sceneCharacters.length > 0) {
                html += `<div style="margin:10px 0;padding:12px;background:rgba(255,255,255,.03);border-radius:8px;">
                    <div style="font-weight:bold;margin-bottom:8px;font-size:14px;">👥 场景人物 (${scene.sceneCharacters.length})</div>
                    ${scene.sceneCharacters.map(c => `<div style="font-size:13px;margin:3px 0;">【${c.name}】${c.description || ''}</div>`).join('')}
                </div>`;
            }

            // 实体
            if (scene.sceneItems && scene.sceneItems.length > 0) {
                html += `<div style="margin:10px 0;padding:12px;background:rgba(255,255,255,.03);border-radius:8px;">
                    <div style="font-weight:bold;margin-bottom:8px;font-size:14px;">📦 场景实体 (${scene.sceneItems.length})</div>
                    ${scene.sceneItems.map(i => `<div style="font-size:13px;margin:3px 0;">【${i.name}】${i.description || ''}${i.status ? ` <span style="color:#887;">(${i.status})</span>` : ''}</div>`).join('')}
                </div>`;
            }

            // ★ 行动
            if (scene.sceneActions && scene.sceneActions.length > 0) {
                html += `<div style="margin:10px 0;padding:12px;background:rgba(255,255,255,.03);border-radius:8px;">
                    <div style="font-weight:bold;margin-bottom:8px;font-size:14px;">⚡ 场景行动 (${scene.sceneActions.length})</div>
                    ${scene.sceneActions.map(a => `<div style="font-size:13px;margin:3px 0;">${a.icon || '⚡'} ${a.name} <span style="color:#666;font-size:11px;">${a.type}${a.count ? ' ×' + a.count : ''}</span></div>`).join('')}
                </div>`;
            }

            // ★ 编辑区
            html += `
                <div style="margin:16px 0;padding:12px;background:rgba(120,150,255,.08);border:1px solid rgba(120,150,255,.25);border-radius:10px;">
                    <div style="font-size:12px;color:#7da8ff;margin-bottom:10px;font-weight:600;letter-spacing:.5px;">✏️ 编辑</div>
                    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
                        <button class="cinemaworld-button" style="margin:0;font-size:12px;" 
                            onclick="SceneEditorManager.openBasic('${scene.name}')">📝 基础信息</button>
                        <button class="cinemaworld-button" style="margin:0;font-size:12px;" 
                            onclick="SceneEditorManager.openEnvData('${scene.name}')">🌤 环境数据</button>
                        <button class="cinemaworld-button" style="margin:0;font-size:12px;" 
                            onclick="SceneEditorManager.openCharacters('${scene.name}')">👥 人物</button>
                        <button class="cinemaworld-button" style="margin:0;font-size:12px;" 
                            onclick="SceneEditorManager.openItems('${scene.name}')">📦 实体</button>
                        <button class="cinemaworld-button" style="margin:0;font-size:12px;" 
                            onclick="SceneEditorManager.openActions('${scene.name}')">⚡ 行动</button>
                        <button class="cinemaworld-button" style="margin:0;font-size:12px;color:#d8c07d;border-color:rgba(216,192,125,.4);" 
                            onclick="SceneEditorManager.openRawText('${scene.name}')">📄 原始文本</button>
                    </div>
                </div>`;

            html += `<div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                <button class="cinemaworld-button ${isCurrent ? '' : 'primary'}" onclick="LocationModalManager.enterScene('${scene.name}')">
                    ${isCurrent ? '🚪 离开此地' : '🚶 进入此地'}
                </button>
                <button class="cinemaworld-button" onclick="LocationModalManager.openLocationBrowser()">📋 返回列表</button>
                <button class="cinemaworld-button" style="color:#d87d7d;border-color:rgba(216,125,125,.4);"
                    onclick="LocationModalManager.deleteScene('${scene.name}')">🗑️ 删除场景</button>
                <button class="cinemaworld-button" onclick="UIManager.closeModal()">✖ 关闭</button>
            </div>`;

            return html;
        },

        async deleteScene(name) {
            const scene = WorldManager.findEntity(name);
            if (!scene) return;

            if (!confirm(`确定删除场景【${name}】吗？\n\n该场景内的人物、物品也会一并删除，且无法恢复。`)) {
                return;
            }

            const isCurrent = CinemaWorld.ui.currentLocation === name;

            // 1. 从世界实体移除
            const idx = CinemaWorld.worldState.entities.findIndex(e => e.name === name);
            if (idx > -1) CinemaWorld.worldState.entities.splice(idx, 1);

            // 2. 如果是当前场景 → 清空位置和视觉层
            if (isCurrent) {
                CinemaWorld.ui.currentLocation = null;
                LocationModalManager.currentLocation = null;

                BackgroundManager.clear();
                MusicManager.setSceneMusic(null);
                MusicManager.clearOverrideMusic();
                SceneSpriteLayerManager.clear();
                SceneAvatarBarManager.clear();

                window.UIManager.createFloatingButtons();
                window.UIManager.updateWorldStateDisplay();
                SceneActionManager.refresh();
                await window.UIManager.showText(`已删除当前场景【${name}】，已退出该场景`, 2000);
            } else {
                await window.UIManager.showText(`已删除场景【${name}】`, 1500);
            }

            // 3. 保存
            if (window.SaveManager) window.SaveManager.save();

            // 4. 回到列表（刷新）
            this.openLocationBrowser();
        },

        async enterScene(name) {
            const scene = WorldManager.findEntity(name);
            if (!scene) return;

            if (CinemaWorld.ui.currentLocation === name) {
                // 离开
                CinemaWorld.ui.currentLocation = null;
                LocationModalManager.currentLocation = null;
                await window.UIManager.showText(`离开了【${name}】`, 1500);

                BackgroundManager.clear();
                MusicManager.setSceneMusic(null);
                MusicManager.clearOverrideMusic();
                SceneSpriteLayerManager.clear();
                SceneAvatarBarManager.clear();
                SceneActionManager.refresh();
            } else {
                await this.doEnterScene(scene);
            }

            window.UIManager.createFloatingButtons();
            window.UIManager.updateWorldStateDisplay();
            window.UIManager.closeModal();
            if (window.SaveManager) window.SaveManager.save();
        },

        async exitCurrentLocation() {
            const name = CinemaWorld.ui.currentLocation;
            CinemaWorld.ui.currentLocation = null;
            LocationModalManager.currentLocation = null;
            await window.UIManager.showText(name ? `离开了【${name}】` : '已离开场景', 1500);
            window.UIManager.createFloatingButtons();
            window.UIManager.updateWorldStateDisplay();
            SceneActionManager.refresh();
            if (window.SaveManager) window.SaveManager.save();
        },
    };

    // ==================== 场景编辑器 ====================
    const SceneEditorManager = {
        _editingScene: null,

        // ---------- 1. 基础信息 ----------
        openBasic(sceneName) {
            const scene = WorldManager.findEntity(sceneName);
            if (!scene) return;
            this._editingScene = sceneName;
            const modal = document.getElementById('cinemaworld-modal');

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📝 编辑基础信息</div>
                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">场景名：</div>
                    <input type="text" class="cinemaworld-textarea" id="cw-edit-name" 
                        value="${scene.name.replace(/"/g, '&quot;')}" 
                        style="min-height:auto;padding:8px 12px;">
                </div>
                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">描述：</div>
                    <textarea class="cinemaworld-textarea" id="cw-edit-desc" 
                        style="min-height:100px;">${scene.description || ''}</textarea>
                </div>
                <div style="margin-bottom:12px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">环境：</div>
                    <textarea class="cinemaworld-textarea" id="cw-edit-env" 
                        style="min-height:60px;">${scene.environment || ''}</textarea>
                </div>
                <div style="margin-bottom:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                        <div style="font-size:13px;color:#aaa;margin-bottom:5px;">背景图片名：</div>
                        <input type="text" class="cinemaworld-textarea" id="cw-edit-bg" 
                            value="${(scene.background || '').replace(/"/g, '&quot;')}" 
                            style="min-height:auto;padding:8px 12px;">
                    </div>
                    <div>
                        <div style="font-size:13px;color:#aaa;margin-bottom:5px;">音乐名：</div>
                        <input type="text" class="cinemaworld-textarea" id="cw-edit-music" 
                            value="${(scene.music || '').replace(/"/g, '&quot;')}" 
                            style="min-height:auto;padding:8px 12px;">
                    </div>
                </div>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button primary" onclick="SceneEditorManager.saveBasic()">保存</button>
                    <button class="cinemaworld-button" onclick="LocationModalManager.openLocationDetail('${sceneName}')">返回</button>
                </div>`;
            modal.className = 'active';
        },

        saveBasic() {
            const scene = WorldManager.findEntity(this._editingScene);
            if (!scene) return;

            const newName = document.getElementById('cw-edit-name').value.trim();
            const desc = document.getElementById('cw-edit-desc').value.trim();
            const env = document.getElementById('cw-edit-env').value.trim();
            const bg = document.getElementById('cw-edit-bg').value.trim();
            const music = document.getElementById('cw-edit-music').value.trim();

            if (!newName) { alert('场景名不能为空'); return; }

            if (newName !== scene.name) {
                const oldName = scene.name;
                if (WorldManager.findEntity(newName)) {
                    alert(`场景名「${newName}」已存在`);
                    return;
                }
                scene.name = newName;
                if (CinemaWorld.ui.currentLocation === oldName) {
                    CinemaWorld.ui.currentLocation = newName;
                }
                (CinemaWorld.worldState.entities || []).forEach(e => {
                    if (e.name === oldName) e.name = newName;
                });
                this._editingScene = newName;
            }

            scene.description = desc;
            scene.environment = env;
            scene.background = bg;
            scene.music = music;

            this._rebuildRaw(scene);

            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.updateWorldStateDisplay();
            window.UIManager.showText('已保存', 1500);
            LocationModalManager.openLocationDetail(scene.name);
        },

        // ---------- 2. 环境数据 ----------
        openEnvData(sceneName) {
            const scene = WorldManager.findEntity(sceneName);
            if (!scene) return;
            this._editingScene = sceneName;

            const env = scene.environmentData;
            let text = '';
            if (env && env._order) {
                text = env._order
                    .filter(k => env[k] !== undefined && env[k] !== '')
                    .map(k => `${k}: ${env[k]}`)
                    .join('\n');
            }

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🌤 编辑环境数据</div>
                <div style="font-size:12px;color:#888;margin-bottom:10px;line-height:1.6;">
                    每行一个「键: 值」。键名可自由增删。<br>
                    例如：<code>时间: 清晨7:00</code>、<code>天气: 暴雨</code>
                </div>
                <textarea class="cinemaworld-textarea" id="cw-edit-envdata"
                    style="min-height:240px;font-family:monospace;">${text}</textarea>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button primary" onclick="SceneEditorManager.saveEnvData()">保存</button>
                    <button class="cinemaworld-button" onclick="LocationModalManager.openLocationDetail('${sceneName}')">返回</button>
                </div>`;
            modal.className = 'active';
        },

        saveEnvData() {
            const scene = WorldManager.findEntity(this._editingScene);
            if (!scene) return;

            const input = document.getElementById('cw-edit-envdata')?.value || '';
            const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
            const newEnv = { _order: [], _raw: '' };

            for (const line of lines) {
                const kv = line.match(/^(.+?)[:：]\s*(.+)$/);
                if (!kv) continue;
                const key = kv[1].trim();
                const value = kv[2].trim();
                if (!key) continue;
                newEnv[key] = value;
                newEnv._order.push(key);
            }
            newEnv._raw = newEnv._order.map(k => `${k}:${newEnv[k]}`).join('|');
            scene.environmentData = newEnv;

            this._rebuildRaw(scene);
            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.updateWorldStateDisplay();
            window.UIManager.showText('环境数据已保存', 1500);
            LocationModalManager.openLocationDetail(scene.name);
        },

        // ---------- 3. 人物 ----------
        openCharacters(sceneName) {
            const scene = WorldManager.findEntity(sceneName);
            if (!scene) return;
            this._editingScene = sceneName;
            const chars = scene.sceneCharacters || [];

            let html = `
                <div class="cinemaworld-modal-title">👥 编辑人物</div>
                <div style="margin-bottom:12px;display:grid;gap:8px;">`;

            chars.forEach((c, i) => {
                html += `
                    <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                            <div style="font-weight:bold;color:#fff;">${c.name}</div>
                            <div style="display:flex;gap:6px;">
                                <button class="cinemaworld-button" style="padding:3px 10px;font-size:11px;margin:0;"
                                    onclick="SceneEditorManager.editCharacter(${i})">编辑</button>
                                <button class="cinemaworld-button" style="padding:3px 10px;font-size:11px;margin:0;color:#d87d7d;"
                                    onclick="SceneEditorManager.removeCharacter(${i})">删除</button>
                            </div>
                        </div>
                        <div style="font-size:12px;color:#aaa;line-height:1.5;">
                            ${c.gender ? `${c.gender} · ` : ''}${c.mood || ''}${c.mood && c.favorability ? ' · ' : ''}${c.favorability ? `好感度${c.favorability}` : ''}
                            ${c.status ? ` · ${c.status}` : ''}
                        </div>
                    </div>`;
            });

            html += `</div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="SceneEditorManager.addCharacter()">➕ 新增人物</button>
                    <button class="cinemaworld-button" onclick="LocationModalManager.openLocationDetail('${sceneName}')">返回</button>
                </div>`;

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = html;
            modal.className = 'active';
        },

        addCharacter() {
            const scene = WorldManager.findEntity(this._editingScene);
            if (!scene) return;
            scene.sceneCharacters = scene.sceneCharacters || [];
            scene.sceneCharacters.push({
                name: '新人物', gender: '', mood: '', favorability: '', status: '',
                role: 'minor', tags: [], description: '',
            });
            if (window.SaveManager) window.SaveManager.save();
            this.openCharacters(this._editingScene);
        },

        editCharacter(index) {
            const scene = WorldManager.findEntity(this._editingScene);
            const c = scene?.sceneCharacters?.[index];
            if (!c) return;

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">编辑人物：${c.name}</div>
                <div style="display:grid;gap:10px;">
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">名字</div>
                        <input type="text" class="cinemaworld-textarea" id="cw-char-name" 
                            value="${(c.name || '').replace(/"/g, '&quot;')}" 
                            style="min-height:auto;padding:8px 12px;">
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">性别</div>
                            <input type="text" class="cinemaworld-textarea" id="cw-char-gender" 
                                value="${(c.gender || '').replace(/"/g, '&quot;')}" 
                                style="min-height:auto;padding:8px 12px;">
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">心情</div>
                            <input type="text" class="cinemaworld-textarea" id="cw-char-mood" 
                                value="${(c.mood || '').replace(/"/g, '&quot;')}" 
                                style="min-height:auto;padding:8px 12px;">
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">好感度</div>
                            <input type="text" class="cinemaworld-textarea" id="cw-char-fav" 
                                value="${(c.favorability || '').replace(/"/g, '&quot;')}" 
                                style="min-height:auto;padding:8px 12px;">
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">状态</div>
                            <input type="text" class="cinemaworld-textarea" id="cw-char-status" 
                                value="${(c.status || '').replace(/"/g, '&quot;')}" 
                                style="min-height:auto;padding:8px 12px;">
                        </div>
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">标签（、分隔）</div>
                        <input type="text" class="cinemaworld-textarea" id="cw-char-tags" 
                            value="${(c.tags || []).join('、').replace(/"/g, '&quot;')}" 
                            style="min-height:auto;padding:8px 12px;">
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">描述</div>
                        <textarea class="cinemaworld-textarea" id="cw-char-desc" 
                            style="min-height:80px;">${c.description || ''}</textarea>
                    </div>
                </div>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button primary" onclick="SceneEditorManager.saveCharacter(${index})">保存</button>
                    <button class="cinemaworld-button" onclick="SceneEditorManager.openCharacters('${this._editingScene}')">返回</button>
                </div>`;
        },

        saveCharacter(index) {
            const scene = WorldManager.findEntity(this._editingScene);
            const c = scene?.sceneCharacters?.[index];
            if (!c) return;

            const oldName = c.name;
            c.name = document.getElementById('cw-char-name').value.trim() || c.name;
            c.gender = document.getElementById('cw-char-gender').value.trim();
            c.mood = document.getElementById('cw-char-mood').value.trim();
            c.favorability = document.getElementById('cw-char-fav').value.trim();
            c.status = document.getElementById('cw-char-status').value.trim();
            c.tags = document.getElementById('cw-char-tags').value.split(/[、,，]/).map(t => t.trim()).filter(Boolean);
            c.description = document.getElementById('cw-char-desc').value.trim();

            // ★ 改名 → 同步档案
            if (oldName !== c.name) {
                const oldRec = CinemaWorld.worldState.characters?.[oldName];
                if (oldRec) {
                    delete CinemaWorld.worldState.characters[oldName];
                    oldRec.name = c.name;
                    CinemaWorld.worldState.characters[c.name] = oldRec;
                }
            }

            CharacterRegistry.upsert(c, scene.name, true);

            // ★ 新增：手动编辑后刷立绘
            if (scene.name === CinemaWorld.ui.currentLocation) {
                window.SpriteManager?.notifySceneSpriteUpdate(c.name);
            }

            this._rebuildRaw(scene);
            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText('人物已保存', 1500);
            this.openCharacters(this._editingScene);
        },

        removeCharacter(index) {
            const scene = WorldManager.findEntity(this._editingScene);
            if (!scene?.sceneCharacters?.[index]) return;
            const c = scene.sceneCharacters[index];
            if (!confirm(`确定删除人物「${c.name}」吗？`)) return;
            scene.sceneCharacters.splice(index, 1);
            this._rebuildRaw(scene);
            if (window.SaveManager) window.SaveManager.save();
            this.openCharacters(this._editingScene);
        },

        // ---------- 4. 实体 ----------
        openItems(sceneName) {
            const scene = WorldManager.findEntity(sceneName);
            if (!scene) return;
            this._editingScene = sceneName;
            const items = scene.sceneItems || [];

            let html = `<div class="cinemaworld-modal-title">📦 编辑实体</div>
                <div style="margin-bottom:12px;display:grid;gap:8px;">`;

            items.forEach((it, i) => {
                html += `
                    <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                            <div style="font-weight:bold;color:#e8d8a8;">${it.icon || '📦'} ${it.name}</div>
                            <div style="display:flex;gap:6px;">
                                <button class="cinemaworld-button" style="padding:3px 10px;font-size:11px;margin:0;"
                                    onclick="SceneEditorManager.editItem(${i})">编辑</button>
                                <button class="cinemaworld-button" style="padding:3px 10px;font-size:11px;margin:0;color:#d87d7d;"
                                    onclick="SceneEditorManager.removeItem(${i})">删除</button>
                            </div>
                        </div>
                        <div style="font-size:12px;color:#aaa;">${it.description || ''}</div>
                        ${it.status ? `<div style="font-size:11px;color:#887;margin-top:4px;">状态: ${it.status}</div>` : ''}
                    </div>`;
            });

            html += `</div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="SceneEditorManager.addItem()">➕ 新增实体</button>
                    <button class="cinemaworld-button" onclick="LocationModalManager.openLocationDetail('${sceneName}')">返回</button>
                </div>`;

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = html;
            modal.className = 'active';
        },

        addItem() {
            const scene = WorldManager.findEntity(this._editingScene);
            if (!scene) return;
            scene.sceneItems = scene.sceneItems || [];
            scene.sceneItems.push({
                name: '新实体', icon: '📦', description: '', status: '', effect: '',
                fields: {}, interactions: [], type: 'entity',
            });
            if (window.SaveManager) window.SaveManager.save();
            this.openItems(this._editingScene);
        },

        editItem(index) {
            const scene = WorldManager.findEntity(this._editingScene);
            const it = scene?.sceneItems?.[index];
            if (!it) return;

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">编辑实体：${it.name}</div>
                <div style="display:grid;gap:10px;">
                    <div style="display:grid;grid-template-columns:60px 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">图标</div>
                            <input type="text" class="cinemaworld-textarea" id="cw-item-icon" 
                                value="${(it.icon || '📦').replace(/"/g, '&quot;')}" 
                                style="min-height:auto;padding:8px;text-align:center;">
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">名字</div>
                            <input type="text" class="cinemaworld-textarea" id="cw-item-name" 
                                value="${(it.name || '').replace(/"/g, '&quot;')}" 
                                style="min-height:auto;padding:8px 12px;">
                        </div>
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">描述</div>
                        <textarea class="cinemaworld-textarea" id="cw-item-desc" 
                            style="min-height:80px;">${it.description || ''}</textarea>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">状态</div>
                            <input type="text" class="cinemaworld-textarea" id="cw-item-status" 
                                value="${(it.status || '').replace(/"/g, '&quot;')}" 
                                style="min-height:auto;padding:8px 12px;">
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">功能</div>
                            <input type="text" class="cinemaworld-textarea" id="cw-item-effect" 
                                value="${(it.effect || '').replace(/"/g, '&quot;')}" 
                                style="min-height:auto;padding:8px 12px;">
                        </div>
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">交互方式（、分隔）</div>
                        <input type="text" class="cinemaworld-textarea" id="cw-item-interactions" 
                            value="${(it.interactions || []).map(x => x.name).join('、').replace(/"/g, '&quot;')}" 
                            style="min-height:auto;padding:8px 12px;">
                    </div>
                </div>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button primary" onclick="SceneEditorManager.saveItem(${index})">保存</button>
                    <button class="cinemaworld-button" onclick="SceneEditorManager.openItems('${this._editingScene}')">返回</button>
                </div>`;
        },

        saveItem(index) {
            const scene = WorldManager.findEntity(this._editingScene);
            const it = scene?.sceneItems?.[index];
            if (!it) return;

            it.icon = document.getElementById('cw-item-icon').value.trim() || '📦';
            it.name = document.getElementById('cw-item-name').value.trim() || it.name;
            it.description = document.getElementById('cw-item-desc').value.trim();
            it.status = document.getElementById('cw-item-status').value.trim();
            it.effect = document.getElementById('cw-item-effect').value.trim();
            const interStr = document.getElementById('cw-item-interactions').value.trim();
            it.interactions = interStr
                ? interStr.split(/[、,，]/).map(s => ({ name: s.trim(), hint: '' })).filter(x => x.name)
                : [];

            this._rebuildRaw(scene);
            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText('实体已保存', 1500);
            this.openItems(this._editingScene);
        },

        removeItem(index) {
            const scene = WorldManager.findEntity(this._editingScene);
            if (!scene?.sceneItems?.[index]) return;
            const it = scene.sceneItems[index];
            if (!confirm(`确定删除实体「${it.name}」吗？`)) return;
            scene.sceneItems.splice(index, 1);
            this._rebuildRaw(scene);
            if (window.SaveManager) window.SaveManager.save();
            this.openItems(this._editingScene);
        },

        // ---------- 5. 行动 ----------
        openActions(sceneName) {
            const scene = WorldManager.findEntity(sceneName);
            if (!scene) return;
            this._editingScene = sceneName;
            const actions = scene.sceneActions || [];

            let html = `<div class="cinemaworld-modal-title">⚡ 编辑行动</div>
                <div style="margin-bottom:12px;display:grid;gap:8px;">`;

            actions.forEach((a, i) => {
                html += `
                    <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                            <div style="font-weight:bold;color:#fff;">${a.icon || '⚡'} ${a.name}</div>
                            <div style="display:flex;gap:6px;">
                                <button class="cinemaworld-button" style="padding:3px 10px;font-size:11px;margin:0;"
                                    onclick="SceneEditorManager.editAction(${i})">编辑</button>
                                <button class="cinemaworld-button" style="padding:3px 10px;font-size:11px;margin:0;color:#d87d7d;"
                                    onclick="SceneEditorManager.removeAction(${i})">删除</button>
                            </div>
                        </div>
                        <div style="font-size:12px;color:#aaa;">${a.hint || ''}</div>
                        <div style="font-size:11px;color:#888;margin-top:4px;">
                            类型: ${a.type}${a.count ? ` · 已执行 ${a.count} 次` : ''}
                        </div>
                    </div>`;
            });

            html += `</div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" onclick="SceneEditorManager.addAction()">➕ 新增行动</button>
                    <button class="cinemaworld-button" onclick="LocationModalManager.openLocationDetail('${sceneName}')">返回</button>
                </div>`;

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = html;
            modal.className = 'active';
        },

        addAction() {
            const scene = WorldManager.findEntity(this._editingScene);
            if (!scene) return;
            scene.sceneActions = scene.sceneActions || [];
            scene.sceneActions.push({
                name: '新行动', icon: '⚡', hint: '', type: 'auto', count: 0, status: 'available',
            });
            if (window.SaveManager) window.SaveManager.save();
            this.openActions(this._editingScene);
        },

        editAction(index) {
            const scene = WorldManager.findEntity(this._editingScene);
            const a = scene?.sceneActions?.[index];
            if (!a) return;

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">编辑行动</div>
                <div style="display:grid;gap:10px;">
                    <div style="display:grid;grid-template-columns:60px 1fr;gap:10px;">
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">图标</div>
                            <input type="text" class="cinemaworld-textarea" id="cw-act-icon" 
                                value="${(a.icon || '⚡').replace(/"/g, '&quot;')}" 
                                style="min-height:auto;padding:8px;text-align:center;">
                        </div>
                        <div>
                            <div style="font-size:12px;color:#888;margin-bottom:4px;">名字</div>
                            <input type="text" class="cinemaworld-textarea" id="cw-act-name" 
                                value="${(a.name || '').replace(/"/g, '&quot;')}" 
                                style="min-height:auto;padding:8px 12px;">
                        </div>
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">描述</div>
                        <textarea class="cinemaworld-textarea" id="cw-act-hint" 
                            style="min-height:60px;">${a.hint || ''}</textarea>
                    </div>
                    <div>
                        <div style="font-size:12px;color:#888;margin-bottom:4px;">类型</div>
                        <select id="cw-act-type" style="width:100%;padding:8px;border-radius:5px;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);">
                            <option value="auto" ${a.type === 'auto' ? 'selected' : ''}>自动（系统判断）</option>
                            <option value="once" ${a.type === 'once' ? 'selected' : ''}>一次性（做完消失）</option>
                            <option value="repeat" ${a.type === 'repeat' ? 'selected' : ''}>可重复</option>
                        </select>
                    </div>
                </div>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button primary" onclick="SceneEditorManager.saveAction(${index})">保存</button>
                    <button class="cinemaworld-button" onclick="SceneEditorManager.openActions('${this._editingScene}')">返回</button>
                </div>`;
        },

        saveAction(index) {
            const scene = WorldManager.findEntity(this._editingScene);
            const a = scene?.sceneActions?.[index];
            if (!a) return;

            a.icon = document.getElementById('cw-act-icon').value.trim() || '⚡';
            a.name = document.getElementById('cw-act-name').value.trim() || a.name;
            a.hint = document.getElementById('cw-act-hint').value.trim();
            a.type = document.getElementById('cw-act-type').value;

            this._rebuildRaw(scene);
            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText('行动已保存', 1500);
            this.openActions(this._editingScene);
        },

        removeAction(index) {
            const scene = WorldManager.findEntity(this._editingScene);
            if (!scene?.sceneActions?.[index]) return;
            const a = scene.sceneActions[index];
            if (!confirm(`确定删除行动「${a.name}」吗？`)) return;
            scene.sceneActions.splice(index, 1);
            this._rebuildRaw(scene);
            if (window.SaveManager) window.SaveManager.save();
            this.openActions(this._editingScene);
        },

        // ---------- 6. 原始文本 ----------
        openRawText(sceneName) {
            const scene = WorldManager.findEntity(sceneName);
            if (!scene) return;
            this._editingScene = sceneName;

            const modal = document.getElementById('cinemaworld-modal');
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📄 原始文本</div>
                <div style="font-size:12px;color:#d8c07d;margin-bottom:10px;line-height:1.6;padding:10px;background:rgba(216,192,125,.1);border-radius:8px;">
                    ⚠️ 这是场景的原始存储格式。直接编辑会重建所有结构化数据（人物/实体/行动/环境数据）。<br>
                    适合批量修改或从外部粘贴。
                </div>
                <textarea class="cinemaworld-textarea" id="cw-edit-raw"
                    style="min-height:400px;font-family:monospace;font-size:12px;">${scene.raw || ''}</textarea>
                <div style="text-align:center;margin-top:15px;">
                    <button class="cinemaworld-button primary" onclick="SceneEditorManager.saveRawText()">保存并重建</button>
                    <button class="cinemaworld-button" onclick="LocationModalManager.openLocationDetail('${sceneName}')">返回</button>
                </div>`;
            modal.className = 'active';
        },

        saveRawText() {
            const scene = WorldManager.findEntity(this._editingScene);
            if (!scene) return;

            const text = document.getElementById('cw-edit-raw').value.trim();
            if (!text) { alert('内容不能为空'); return; }

            const parsed = WorldManager.parseScene(text);
            if (!parsed || !parsed.name) {
                alert('解析失败：未找到场景名');
                return;
            }

            const oldName = scene.name;
            parsed.name = oldName;

            Object.assign(scene, parsed);

            CharacterRegistry.syncFromScene(scene);

            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText('已保存并重建', 1500);
            window.UIManager.updateWorldStateDisplay();
            LocationModalManager.openLocationDetail(scene.name);
        },

        // ---------- 工具：重建 raw ----------
        _rebuildRaw(scene) {
            let text = `*【${scene.name}】*\n`;
            if (scene.description) text += `描述：(${scene.description})\n`;
            if (scene.environment) text += `环境：(${scene.environment})\n`;
            if (scene.environmentData && scene.environmentData._order) {
                const envStr = scene.environmentData._order
                    .filter(k => scene.environmentData[k] !== undefined && scene.environmentData[k] !== '')
                    .map(k => `${k}:${scene.environmentData[k]}`)
                    .join('|');
                if (envStr) text += `环境数据:[${envStr}]\n`;
            }
            if (scene.background) text += `背景：${scene.background}\n`;
            if (scene.music) text += `🎵 音乐：${scene.music}\n`;

            if (scene.sceneCharacters?.length) {
                text += `\n场景人物：\n`;
                scene.sceneCharacters.forEach(c => {
                    const meta = [
                        c.name, c.gender || '', c.mood || '', c.favorability || '', c.status || ''
                    ].join('|');
                    const tags = c.tags?.length ? `，[${c.tags.join('、')}]` : '';
                    text += `- 【${meta}】：${c.description || ''}${tags}\n`;
                });
            }

            if (scene.sceneItems?.length) {
                text += `\n场景实体：\n`;
                scene.sceneItems.forEach(it => {
                    const fields = [];
                    if (it.status) fields.push(`状态:${it.status}`);
                    if (it.effect) fields.push(`功能:${it.effect}`);
                    if (it.interactions?.length) {
                        fields.push(`交互方式:${it.interactions.map(x => x.name).join('、')}`);
                    }
                    if (it.icon && it.icon !== '📦') fields.push(`图标:${it.icon}`);
                    for (const [k, v] of Object.entries(it.fields || {})) {
                        if (k.startsWith('_pos')) continue;
                        if (['状态', '功能', '图标', 'icon', '交互', '交互方式'].includes(k)) continue;
                        fields.push(`${k}:${v}`);
                    }
                    text += `- 【${it.name}】：${it.description || ''}${fields.length ? `，[${fields.join('|')}]` : ''}\n`;
                });
            }

            if (scene.sceneActions?.length) {
                text += `\n场景行动：\n`;
                scene.sceneActions.forEach(a => {
                    const typePart = a.type && a.type !== 'auto' ? `|${a.type}` : '';
                    text += `- 【${a.name}${a.icon ? '|' + a.icon : ''}${typePart}】：${a.hint || ''}\n`;
                });
            }

            scene.raw = text;
        },
    };

    // ==================== 场景行动管理器 ====================
    const SceneActionManager = {
        _expanded: false,

        refresh() {
            const bar = document.getElementById('cinemaworld-scene-actions');
            if (!bar) return;
            const scene = LocationModalManager.currentLocation;
            const actions = scene?.sceneActions || [];

            if (actions.length === 0) {
                // ★ 空场景也要重置展开态，避免旧状态残留
                this._expanded = false;
                bar.innerHTML = '';
                bar.classList.add('hidden');
                return;
            }
            bar.classList.remove('hidden');
            this.render();
        },

        render() {
            const bar = document.getElementById('cinemaworld-scene-actions');
            if (!bar) return;
            const scene = LocationModalManager.currentLocation;
            const actions = scene?.sceneActions || [];

            if (actions.length === 0) {
                bar.innerHTML = '';
                return;
            }

            let html = `
                <button class="cw-action-toggle" onclick="SceneActionManager.toggle()" title="场景行动">
                    ⚡ <span style="font-size:11px;">行动</span>
                </button>
                <div class="cw-action-panel ${this._expanded ? 'expanded' : ''}">`;

            actions.forEach((act, i) => {
                html += `
                    <div class="cw-action-item"
                            data-action-index="${i}"
                            onclick="SceneActionManager.execute(${i})">
                        <button class="cw-action-delete"
                            title="删除这个行动"
                            onclick="event.stopPropagation(); SceneActionManager.confirmDelete(${i});">×</button>
                        <span class="cw-action-icon">${act.icon || '⚡'}</span>
                        <div class="cw-action-text">
                            <div class="cw-action-name">
                                ${act.name}
                                ${act.count > 0 ? `<span style="font-size:10px;color:#888;">×${act.count}</span>` : ''}
                            </div>
                            ${act.hint ? `<div class="cw-action-hint">${act.hint}</div>` : ''}
                        </div>
                    </div>`;
            });

            html += `</div>`;
            bar.innerHTML = html;
        },

        // ★ 手动删除一个场景行动
        async confirmDelete(index) {
            const scene = LocationModalManager.currentLocation;
            if (!scene || !scene.sceneActions) return;
            const action = scene.sceneActions[index];
            if (!action) return;

            if (!confirm(`确定删除行动「${action.name}」吗？\n\n这个操作不可撤销。`)) {
                return;
            }

            scene.sceneActions.splice(index, 1);

            await window.UIManager.showText(`已删除行动「${action.name}」`, 1500);

            this.refresh();
            if (window.SaveManager) window.SaveManager.save();
        },

        toggle() {
            this._expanded = !this._expanded;
            const panel = document.querySelector('.cw-action-panel');
            if (panel) panel.classList.toggle('expanded', this._expanded);
        },

        collapse() {
            this._expanded = false;
            const panel = document.querySelector('.cw-action-panel');
            if (panel) panel.classList.remove('expanded');
        },

        // ★ 执行一个场景行动
        async execute(index) {
            const scene = LocationModalManager.currentLocation;
            if (!scene) return;
            const action = scene.sceneActions?.[index];
            if (!action) return;

            this.collapse();

            try {
                const chapterId = window.StoryManager?.currentChapter?.id || null;
                const sceneCtx = window.InventoryManager.buildSceneContext(scene);
                const playerBlock = PlayerStateManager.formatForPrompt();
                const worldCtx = window.StoryManager.buildContext(null, {
                    parentStory: false, mainChars: false, scene: false, pendingEvents: false,
                    digestFilter: {
                        sceneItems: false,
                        characters: false,
                        inventoryItems: false,
                    },
                    volumes: false, chapters: false,
                });

                const repeatNote = action.count > 0
                    ? `\n★ 注意：玩家已经执行过这个行动 ${action.count} 次。请让结果有变化或递减——不要重复相同的情节。`
                    : '';

                await window.UIManager.showText(`正在${action.name}...`, 1000);

                const prompt = `你正在为视觉小说游戏生成一段"场景行动"的剧情脚本。

【世界历史】
${worldCtx}

【场景上下文】
${sceneCtx}

★ 当前环境数据：
${WorldManager.getEnvDataText(scene)}

${playerBlock}

【执行行动】
行动名：${action.name}
行动类型：${action.type === 'once' ? '一次性' : action.type === 'repeat' ? '可重复' : '未定'}
已执行次数：${action.count}
行动描述：${action.hint || '无'}
${repeatNote}

【任务】
生成一段视觉小说脚本，描述玩家执行这个行动的过程和结果。

【音乐提示】
🎵 音乐: (音乐名)
可以按照这个格式符合场景的音乐。

★ 关于"场景行动"：
- 这是玩家主动做的事，不是和某个角色的对话
- 可以引发新事件、发现新线索、推进主线、改变场景状态
- 可以只是氛围描写（如"你站在窗边看着雨"）
- 如果这个行动导致某角色出现、某实体变化、某数值改变，要在【效果】和【场景更新】里体现

★ 关于"行动是否结束"：
- 如果这是一次性行动，或这次执行已经"做完/看完/用尽"了，请在【场景更新】里写：
  移除行动: ${action.name}
- 如果行动可以继续做，但需要玩家再次主动选择，则不要写。
- 如果你判断这个行动已经"没什么新东西可发现了"，也应该移除它。

【输出格式】
每一行是一个对话或旁白：
【角色名|显示/隐藏|位置|性别|状态】: 对话/旁白内容

规则：
0. 状态可以是心情，也可以是状态列表定义的内容，例如开心。
1. 位置只能是：左、中、右
2. 正在说话/动作的角色用"显示"，其他用"隐藏"
3. ★ 旁白（无人说话的环境描写、心理活动、动作）用【旁白】
4. ★ 只能使用【场景上下文】中列出的场景人物，不要捏造新角色
5. 生成5-10个脚本行
6. 如果造成了数据变化，在脚本结束后用【效果】块标记

【效果】
目标: 玩家
数值变化: 体力 +5
实体变化:
- 获得【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 失去【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
- 获得状态 状态名（可选效果，| 分隔：攻击-20%|持续3回合）
- 移除状态 状态名

★ 关键：获得物品时必须写完整格式（方括号内 键:值），否则玩家拿到的是空壳。
★ 可装备物品：写明属性字段，如 [类型:武器|攻击:+5|暴击:+10%]
★ 可消耗物品：写明功能，如 [类型:消耗品|功能:回复 50 点生命|可堆叠]
★ 普通物品：至少写 [类型:物品] 和图标

示例：
- 获得【生锈的铁剑|⚔️】：锈迹斑斑的短剑，[类型:武器|攻击:+3|图标:⚔️]
- 获得【红药水|🧪】：一瓶红色药剂，[类型:消耗品|功能:回复 30 点生命|可堆叠]
- 获得【黑面包|🍞】：还热乎，[类型:食物|功能:回复 10 点体力|可堆叠]

【场景更新】
(可选。如果行动改变了场景，才写这一块)
场景: (场景名)

环境数据:
- 数据1: (行动后的新数据)
- 数据2: (如有变化)
（只写变化的字段，不用重复没变的，只改变已有的环境数据键值，不准发明新的）

新增人物：
- 【人物名|性别|心情|好感度|状态|主次】：描述，[标签]

修改人物：
- 【人物名】：字段|新值

字段必须是以下之一：心情、状态、描述、标签
例如：
修改人物：
- 【人物名】：心情|新心情
- 【人物名】：状态|新状态
- 【人物名】：描述|人物的描述
- 【人物名】：标签|标签1、标签2   （多个标签用、分隔）

移除人物: 名字1、名字2

新增实体：
- 【实体名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
如果是物品(物品也是一种实体）：
- 【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]
新增遭遇实体：
- 【敌人名|图标】：描述，[类型:遭遇|HP:当前/最大|攻击:X|防御:X|敏捷:X|技能:X|掉落:X]
（★ 当行动引发了战斗时使用。
例如：主角被伏击、守卫发现、BOSS登场。
生成后玩家可以在场景实体列表里看到并触发战斗。）

★ 遭遇实体数量控制：
可以多个，例如普通和精英怪以及BOSS同时登场的情况。

★ 实体如果是可装备物品（武器/护甲/饰品/背包等），必须写上属性字段，
格式同场景创建时的规范：
- 【生锈的铁剑|⚔️】：[类型:武器|攻击:+3|图标:⚔️]
- 【幸运护符|🍀】：[类型:饰品|幸运:+5|图标:🍀]
- 【行军背包|🎒】：[类型:背包|背包格:+6|图标:🎒]

移除实体: 名字1、名字2

修改实体：
- 【实体名】：状态→新状态

新增行动：
- 【行动名|图标|once】：描述

移除行动: 行动名

场景状态：
- 键: 值

【场景切换】（如果行动导致玩家移动到新地点）
目标场景: (场景名)
预制人物: [人物1, 人物2]
预制物品: [物品1, 物品2]

【摘要】
（用2-3句话总结这次行动的过程与结果，包含：
- 玩家做了什么
- 发现了什么 / 引发了什么
- 对主线有什么影响
这段摘要会作为后续剧情、交互、场景行动的上下文。）

请开始生成：`;

                const result = await window.generateFunctionalReply(prompt, 'scene-action');
                if (!result) return;

                const summaryMatch = result.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
                const digestSummary = summaryMatch ? summaryMatch[1].trim() : '';

                const withoutDigest = result.replace(/【摘要】[\s\S]*?(?=\n【|$)/, '').trim();

                const sceneUpdateIdx = withoutDigest.indexOf('【场景更新】');
                const effectIdx = withoutDigest.indexOf('【效果】');
                const sceneSwitchIdx = withoutDigest.indexOf('【场景切换】');

                let cutPoints = [effectIdx, sceneUpdateIdx].filter(i => i >= 0);
                let scriptEnd = cutPoints.length > 0 ? Math.min(...cutPoints) : withoutDigest.length;
                const scriptText = withoutDigest.substring(0, scriptEnd).trim();

                let sceneUpdatePart = '';
                let effectPart = '';
                let sceneSwitchPart = '';

                const blocks = [
                    { idx: sceneUpdateIdx, key: 'update' },
                    { idx: effectIdx, key: 'effect' },
                    { idx: sceneSwitchIdx, key: 'switch' },
                ].filter(b => b.idx >= 0).sort((a, b) => a.idx - b.idx);

                for (let i = 0; i < blocks.length; i++) {
                    const start = blocks[i].idx;
                    const end = i + 1 < blocks.length ? blocks[i + 1].idx : withoutDigest.length;
                    const part = withoutDigest.substring(start, end);
                    if (blocks[i].key === 'update') sceneUpdatePart = part;
                    else if (blocks[i].key === 'effect') effectPart = part;
                    else if (blocks[i].key === 'switch') sceneSwitchPart = part;
                }
                await MusicManager.applyMusicMarker(result);
                const dialogues = window.VisualNovelManager.parseScript(scriptText);
                if (dialogues.length > 0) {
                    await window.VisualNovelManager.play(dialogues);
                } else {
                    await window.UIManager.showText(scriptText, 5000);
                }
                // 场景切换
                if (sceneSwitchPart) {
                    await new Promise(r => setTimeout(r, 300));
                    const sw = window.StoryManager.parseSceneSwitch(sceneSwitchPart.replace(/^【场景切换】/, ''));
                    if (sw && sw.targetScene) {
                        await window.StoryManager.handleSceneSwitch(sw, null);
                    }
                }

                // 应用场景更新
                if (sceneUpdatePart) {
                    await new Promise(r => setTimeout(r, 300));
                    const update = window.StoryManager.parseSceneUpdate(sceneUpdatePart);
                    if (update) await window.StoryManager.applySceneUpdate(update);
                }

                // 应用效果
                if (effectPart) {
                    await new Promise(r => setTimeout(r, 300));
                    const results = window.EffectSystem.applyFromNarrative(effectPart);
                    const text = window.EffectSystem.formatResults(results);
                    if (text) await window.UIManager.showText(text, 4000);
                }
                window.SpriteManager?.notifyAllSceneSpritesUpdate();
                // ★ 执行次数 +1
                if (action.type === 'once') {
                    const idx = scene.sceneActions.findIndex(a => a.name === action.name);
                    if (idx > -1) scene.sceneActions.splice(idx, 1);
                } else {
                    action.count = (action.count || 0) + 1;
                }

                if (digestSummary) {
                    window.InteractionDigestManager.add({
                        targetType: 'item',
                        target: `行动:${action.name}`,
                        source: 'sceneAction',
                        summary: digestSummary,
                        chapterId,
                    });
                }

                window.InteractionHistoryManager.add({
                    type: 'sceneAction',
                    target: action.name,
                    targetMeta: { icon: action.icon },
                    scene: scene.name,
                    playerInput: action.name,
                    script: scriptText,
                    effect: effectPart || null,
                    summary: digestSummary,
                });
                await MusicManager.clearOverrideMusic();
                this.refresh();
                if (window.SaveManager) window.SaveManager.save();

            } catch (e) {
                console.error('[CinemaWorld] 场景行动执行失败:', e);
                await window.UIManager.showText(`❌ 行动失败：${e.message}`, 3000);
            }
        },
    };

    // ==================== 场景立绘层管理器 ====================
    const SceneSpriteLayerManager = {
        slots: [],
        _buildToken: 0, 

        init() {
            this.createContainer();
            this.addStyles();
        },

        createContainer() {
            if (document.getElementById('cinemaworld-scene-sprites')) return;
            const container = document.getElementById('cinemaworld-container');
            const layer = document.createElement('div');
            layer.id = 'cinemaworld-scene-sprites';
            container.appendChild(layer);
        },

        addStyles() {
            // ★ CSS 已移至 style.css
            if (window.CinemaWorldCSS) window.CinemaWorldCSS.ensure();
        },

        // 进入场景时构建立绘
        async buildForScene(scene) {
            const layer = document.getElementById('cinemaworld-scene-sprites');
            if (!layer) return;

            // ★ 如果正在构建，把这次请求记为"待办"，不直接跑
            if (this._building) {
                this._pendingScene = scene;
                return;
            }
            this._building = true;

            try {
                // ★ 认领代次
                const myToken = ++this._buildToken;

                layer.innerHTML = '';
                this.slots = [];

                const chars = scene?.sceneCharacters || [];
                if (chars.length === 0) {
                    layer.classList.add('hidden');
                    return;
                }
                layer.classList.remove('hidden');

                // 预热
                for (const ch of chars) {
                    const state = SpriteManager.pickSpriteState(ch);
                    await SpriteManager.get(ch.name, ch.gender, state);
                    if (state !== '默认') {
                        await SpriteManager.get(ch.name, ch.gender, '默认');
                    }
                    if (myToken !== this._buildToken) return;
                }

                for (const ch of chars) {
                    if (!SpriteManager.characterSpriteMap[ch.name]) {
                        const url = await SpriteManager.get(ch.name, ch.gender, '默认');
                        if (url) SpriteManager.characterSpriteMap[ch.name] = url;
                    }
                    if (myToken !== this._buildToken) return;
                }

                const displayChars = chars.slice(0, 5);
                for (const ch of displayChars) {
                    if (myToken !== this._buildToken) return;
                    const slot = await this.createSlot(ch, chars.indexOf(ch));
                    if (myToken !== this._buildToken) return;
                    layer.appendChild(slot);
                    this.slots.push({ name: ch.name, visible: true, gender: ch.gender });
                }
            } finally {
                this._building = false;
                // 处理期间的新请求
                if (this._pendingScene) {
                    const s = this._pendingScene;
                    this._pendingScene = null;
                    setTimeout(() => this.buildForScene(s), 0);
                }
            }
        },

        // 创建单个立绘槽
        async createSlot(char, characterIndex) {
            const wrapper = document.createElement('div');
            wrapper.className = 'cinemaworld-scene-sprite';
            wrapper.dataset.characterName = char.name;

            // ★ 用当前状态（此时 cache 里应该已经预热好了）
            const state = SpriteManager.pickSpriteState(char);
            const url = SpriteManager.getCachedSpriteWithState(char.name, state)
                        || SpriteManager.getFromMapping(char.name);

            console.log(`[SceneSprite] ${char.name} 状态=${state} url=${url}`);

            let spriteHTML;
            if (url) {
                spriteHTML = `<img class="cinemaworld-scene-sprite-img" src="${url}" alt="${char.name}">`;
            } else {
                spriteHTML = `
                    <div class="cinemaworld-scene-sprite-placeholder">
                        <div class="cinemaworld-scene-sprite-placeholder-name">${char.name}</div>
                    </div>
                `;
                SpriteManager.ensureSpriteWithState(char.name, char.gender, state).then((loadedUrl) => {
                    if (!loadedUrl) return;
                    const ph = wrapper.querySelector('.cinemaworld-scene-sprite-placeholder');
                    if (ph) {
                        const newImg = document.createElement('img');
                        newImg.className = 'cinemaworld-scene-sprite-img';
                        newImg.src = loadedUrl;
                        newImg.alt = char.name;
                        ph.replaceWith(newImg);
                    }
                });
            }
            wrapper.innerHTML = '';
            wrapper.innerHTML = `
                ${spriteHTML}
                <div class="cinemaworld-scene-sprite-bar">
                    <span class="cinemaworld-scene-sprite-name">${char.name}</span>
                    <button class="cinemaworld-scene-sprite-btn" 
                        onclick="event.stopPropagation(); CharacterInteractionManager.open(${characterIndex})"
                        title="交互">💬</button>
                </div>
            `;
            wrapper.querySelectorAll('.cw-hotspot-layer').forEach(el => el.remove());
            // ★ 新增：热区层
            this._buildHotspotLayer(wrapper, char);

            return wrapper;
        },

        // ★ 新增：根据角色的 clickRules 生成立绘热区
        _buildHotspotLayer(wrapper, char) {
            wrapper.querySelectorAll('.cw-hotspot-layer').forEach(el => el.remove());
            // ★ 强制从档案拿最新规则（避免场景对象里的旧值）
            let rules = null;

            const archive = window.CharacterRegistry?.get?.(char.name);
            if (archive?.clickRules?.zones?.length > 0) {
                rules = archive.clickRules;
            } else if (char?.clickRules?.zones?.length > 0) {
                rules = char.clickRules;
            }

            if (!rules) {
                console.log(`[SceneSprite] ${char.name} 没有 clickRules，跳过热区`);
                return;
            }

            // ★ 顺手把场景对象同步成档案里的最新版本
            if (char && char.clickRules !== rules) {
                char.clickRules = rules;
            }

            const layer = document.createElement('div');
            layer.className = 'cw-hotspot-layer';

            for (const zone of rules.zones) {
                if (!zone.label) continue;

                const hs = document.createElement('div');
                hs.className = 'cw-hotspot';

                // ★ 二维定位（每次都用最新值）
                hs.style.top    = `${zone.top    ?? 0}%`;
                hs.style.height = `${zone.height ?? 100}%`;
                hs.style.left   = `${zone.left   ?? 0}%`;
                hs.style.width  = `${zone.width  ?? 100}%`;

                hs.dataset.zone = zone.label;
                hs.dataset.character = char.name;
                hs.title = zone.label;

                hs.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    window.ClickReactionManager?.trigger(char.name, zone.label);
                });

                layer.appendChild(hs);
            }

            wrapper.appendChild(layer);
            console.log(
                `[SceneSprite] 已为 ${char.name} 注入 ${rules.zones.length} 个热区`,
                rules.zones.map(z => `${z.label}(${z.top}~${z.top + z.height},${z.left ?? 0}~${(z.left ?? 0) + (z.width ?? 100)})`)
            );
        },
        // ★ 刷新某个角色的立绘（直接换 src，单图唯一，防并发）
        async refreshSpriteFor(name, state = null) {
            const wrapper = document.querySelector(
                `.cinemaworld-scene-sprite[data-character-name="${CSS.escape(name)}"]`
            );
            if (!wrapper) return;

            const scene = window.LocationModalManager?.currentLocation;
            const char = scene?.sceneCharacters?.find(c => c.name === name);
            if (!char) return;

            const finalState = state || SpriteManager.pickSpriteState(char);
            const url = await SpriteManager.get(name, char.gender, finalState);
            if (!url) return;

            // ★ 拿锁：同一个 wrapper 同时只允许一次刷新
            if (wrapper._refreshing) {
                wrapper._pendingState = finalState;
                return;
            }
            wrapper._refreshing = true;

            try {
                // ★ 强制只保留一个 img
                const imgs = wrapper.querySelectorAll('.cinemaworld-scene-sprite-img');
                let img = imgs[0];

                // 多余的 img 直接删
                for (let i = 1; i < imgs.length; i++) imgs[i].remove();

                if (img) {
                    img.src = url;
                } else {
                    const ph = wrapper.querySelector('.cinemaworld-scene-sprite-placeholder');
                    if (ph) {
                        img = document.createElement('img');
                        img.className = 'cinemaworld-scene-sprite-img';
                        img.src = url;
                        img.alt = name;
                        ph.replaceWith(img);
                    }
                }
            } finally {
                wrapper._refreshing = false;

                // 处理刷新期间的新请求
                if (wrapper._pendingState) {
                    const next = wrapper._pendingState;
                    wrapper._pendingState = null;
                    setTimeout(() => this.refreshSpriteFor(name, next), 0);
                }
            }
        },
        // 切换某个角色的立绘显隐
        toggleVisibility(name) {
            const wrapper = document.querySelector(`.cinemaworld-scene-sprite[data-character-name="${name}"]`);
            if (!wrapper) return;
            wrapper.classList.toggle('hidden-state');
            const slot = this.slots.find(s => s.name === name);
            if (slot) slot.visible = !slot.visible;

            SceneAvatarBarManager.syncFromSprites();
        },

        // 显示/隐藏整个立绘层
        toggleLayer() {
            const layer = document.getElementById('cinemaworld-scene-sprites');
            if (!layer) return;
            layer.classList.toggle('hidden');
            SceneAvatarBarManager.syncFromSprites();
        },

        isLayerHidden() {
            const layer = document.getElementById('cinemaworld-scene-sprites');
            return layer ? layer.classList.contains('hidden') : false;
        },

        // 清空
        clear() {
            const layer = document.getElementById('cinemaworld-scene-sprites');
            if (layer) {
                layer.innerHTML = '';
                layer.classList.add('hidden');
            }
            this.slots = [];
        },
    };

    // ==================== 场景头像栏管理器 ====================
    const SceneAvatarBarManager = {
        init() {
            this.createContainer();
            this.addStyles();
        },

        createContainer() {
            if (document.getElementById('cinemaworld-scene-avatars')) return;
            const container = document.getElementById('cinemaworld-container');
            const bar = document.createElement('div');
            bar.id = 'cinemaworld-scene-avatars';
            container.appendChild(bar);
        },

        addStyles() {
            // ★ CSS 已移至 style.css
            if (window.CinemaWorldCSS) window.CinemaWorldCSS.ensure();
        },

        // 为场景构建头像栏
        buildForScene(scene) {
            const bar = document.getElementById('cinemaworld-scene-avatars');
            if (!bar) return;
            bar.innerHTML = '';

            const chars = scene?.sceneCharacters || [];
            if (chars.length === 0) return;

            chars.slice(0, 5).forEach((ch, index) => {
                const item = this.createAvatarItem(ch, index);
                bar.appendChild(item);
            });

            // 层开关（仅当有人物时显示）
            const toggle = document.createElement('div');
            toggle.className = 'cinemaworld-scene-avatar-layer-toggle';
            toggle.id = 'cinemaworld-scene-layer-toggle';
            toggle.textContent = '👁 隐藏立绘';
            toggle.onclick = () => {
                SceneSpriteLayerManager.toggleLayer();
                this.updateLayerToggleText();
            };
            bar.appendChild(toggle);
        },

        createAvatarItem(char, characterIndex) {
            const item = document.createElement('div');
            item.className = 'cinemaworld-scene-avatar-item';
            item.dataset.characterName = char.name;

            // ★ 用状态立绘
            const state = SpriteManager.pickSpriteState(char);
            const spriteUrl = SpriteManager.getCachedSpriteWithState(char.name, state)
                            || SpriteManager.getCachedSprite(char.name);
            const faceInner = spriteUrl
                ? `<img src="${spriteUrl}" alt="${char.name}">`
                : char.name.charAt(0);

            item.innerHTML = `
                <div class="cinemaworld-scene-avatar-face">${faceInner}</div>
                <span class="cinemaworld-scene-avatar-name">${char.name}</span>
                <button class="cinemaworld-scene-avatar-btn" 
                    data-action="toggle" 
                    title="显示/隐藏立绘">👁</button>
                <button class="cinemaworld-scene-avatar-btn" 
                    data-action="interact" 
                    title="交互">💬</button>
            `;

            if (!spriteUrl) {
                SpriteManager.ensureSpriteWithState(char.name, char.gender, state).then(url => {
                    if (!url) return;
                    const faceEl = item.querySelector('.cinemaworld-scene-avatar-face');
                    if (faceEl) {
                        faceEl.innerHTML = `<img src="${url}" alt="${char.name}">`;
                    }
                });
            }

            item.querySelector('.cinemaworld-scene-avatar-name').onclick = (e) => {
                e.stopPropagation();
                window.SceneCharacterBrowserManager.openBrowser();
            };

            item.querySelector('[data-action="toggle"]').onclick = (e) => {
                e.stopPropagation();
                SceneSpriteLayerManager.toggleVisibility(char.name);
            };

            item.querySelector('[data-action="interact"]').onclick = (e) => {
                e.stopPropagation();
                window.CharacterInteractionManager.open(characterIndex);
            };

            return item;
        },

        // 同步立绘层的显示状态到头像栏
        syncFromSprites() {
            const layerHidden = SceneSpriteLayerManager.isLayerHidden();
            for (const slot of SceneSpriteLayerManager.slots) {
                const item = document.querySelector(`.cinemaworld-scene-avatar-item[data-character-name="${slot.name}"]`);
                if (item) {
                    item.classList.toggle('hidden-state', !slot.visible || layerHidden);
                }
            }
            this.updateLayerToggleText();
        },

        updateLayerToggleText() {
            const toggle = document.getElementById('cinemaworld-scene-layer-toggle');
            if (!toggle) return;
            const hidden = SceneSpriteLayerManager.isLayerHidden();
            toggle.textContent = hidden ? '👁 显示立绘' : '👁 隐藏立绘';
        },

        clear() {
            const bar = document.getElementById('cinemaworld-scene-avatars');
            if (bar) bar.innerHTML = '';
        },
    };

    // ==================== 场景创建 ====================
    const LocationCreationManager = {
        isGenerating: false,

        showCreationModal() {
            const modal = document.getElementById('cinemaworld-modal');
            const existing = WorldManager.getLocations();
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🎬 创建场景</div>
                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">描述场景（可选）：</div>
                    <textarea class="cinemaworld-textarea" id="scene-guide-input" 
                        placeholder="例如：一个被遗忘的古老神殿..." style="min-height:100px;"></textarea>
                </div>
                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">已有场景（AI将保持世界观一致）：</div>
                    <div style="font-size:12px;color:#888;max-height:80px;overflow-y:auto;background:rgba(255,255,255,.03);border-radius:5px;padding:10px;">
                        ${existing.length > 0 ? existing.map(l => `【${l.name}】`).join('、') : '暂无场景'}
                    </div>
                </div>
                <div id="scene-generation-result" style="display:none;margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">AI生成结果（可编辑）：</div>
                    <textarea class="cinemaworld-textarea" id="scene-generated-text" style="min-height:300px;"></textarea>
                </div>
                <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" id="generate-scene-btn" onclick="LocationCreationManager.generate()">🤖 AI生成场景</button>
                    <button class="cinemaworld-button" id="confirm-create-btn" onclick="LocationCreationManager.confirm()" style="display:none;">✅ 确认创建</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">✖ 取消</button>
                </div>`;
            modal.className = 'active';
        },

        async generate() {
            if (this.isGenerating) return;
            const guide = document.getElementById('scene-guide-input').value.trim();
            const existing = WorldManager.getLocations();
            const btn = document.getElementById('generate-scene-btn');
            btn.disabled = true;
            btn.innerHTML = '⏳ 生成中...';
            this.isGenerating = true;

            try {
                let prompt = `请生成一个场景，严格使用以下格式：

*【场景名】*
描述：(场景的详细描述)
环境：(场景的环境特征)
环境数据:[时间:具体时间|天气:具体天气|温度:具体温度|风力:具体风力|湿度:具体湿度|...]
背景：(背景图片名)
🎵 音乐：音乐名

场景人物：
- 【人物名|性别|心情|好感度|状态|主次】：人物描述，[标签1、标签2]

场景实体：
- 【实体名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
如果是物品(物品也是一种实体）：
- 【物品名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
- 【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]

★ 特殊场景实体类型：
以下类型有专用系统，必须严格使用对应字段：

【经营实体】（农田、牧场、商店、工厂、矿场等符合剧情背景设定的可持续运营的场所）
- 【名称|图标】：描述，[类型:经营|经营类型:农田|其他字段...]
  说明：经营类型可写 农田/牧场/商店/工厂/矿场/鱼塘...等，系统会据此生成经营系统。

【商店实体】（买卖物品的场所）
- 【名称|图标】：描述，[类型:商店|货币:金币|收购:是|其他字段...]
  说明：系统会据此生成一个商店，玩家点击可直接进入购买/出售界面。

★ 当场景氛围适合（如村子、集市、店铺、农场）时，可以主动生成 1 个经营或商店实体。

场景行动：
- 【行动名|图标|once】：这个行动能做什么
- 【行动名|图标|repeat】：...

（2-5 个。是玩家在当前场景可以主动做的事，而不是场景里已有的角色/实体。
 这些行动应该：
 - 结合场景氛围和当前局势
 - 可以影响主线（
 - 可以只是氛围探索
 - 不要和场景角色/实体的交互重复，场景实体已有的内容，场景行动无需再有，也无须通过这里进行交互
 - once：一次性行动，做完就消失（如"打开那个箱子"、"查看信号"）
 - repeat：可重复行动，但每次结果可能不同（如"站在窗边发呆"、"练习剑术"）
 - 不填：由系统按行动性质自动判断
 判断原则：
 - 探索型/推进型行动 → once
 - 氛围型/练习型行动 → repeat
 如果这个场景确实没什么可做的，可以不写这一块。）

字段说明：
0. ★ 环境数据必须用"键:值"格式，用 | 分隔。键名必须写出来，例如：
环境数据:[时间:具体时间|天气:具体天气|温度:具体温度|风力:具体风力|湿度:具体湿度|...]
你可以根据剧情和背景自由添加任何键：时间、天气、温度、风力、湿度、能见度、
季节、月相、潮汐、日期、声望……系统都能存能显。
1. 描述：实体的外观、位置、给人的感觉（实体可以是物品、建筑、植物、家具、机关、载具、自然景观等任何东西）
2. 类型：物品/建筑/植物/家具/机关/载具/自然物/…（由你自行判断，不要局限于"物品"）
3. 状态：当前状态（如"未拆封"、"车钥匙插在门上"、"半开着"），无则留空
4. 功能：能做什么（如"可驾驶"、"可阅读"、"可攀爬"），无则留空
5. 交互方式：列出这个实体可以进行的交互，用顿号分隔。可以是 1 种，也可以多种。
    例如：
    - 一扇木门：[类型:建筑|交互方式:推开、敲门、踹开|图标:🚪]
    如果这个实体确实没什么可交互的，可以不写这个字段。
6. 图标：只填一个 emoji，不要文字
7. ★ 你还可以自由添加其他字段（如"材质"、"年代"、"危险度"、"气味"），格式为 键:值
8. ★ 如果这个实体可以被"装备"（如武器、护甲、饰品、工具），
   请用"键:值"的形式写出它的属性加成，例如：
   - 【.357左轮|🔫】：老式左轮，[类型:武器|攻击:+5|暴击:+10%]
   - 【防弹背心|🦺】：凯夫拉材质，[类型:护甲|防御:+8]
   - 【登山背包|🎒】：能装更多东西，[类型:背包|背包格:+4]
   属性字段的规则：
   - 值必须是 "数字"、"±数字"、"数字%" 之一
   - 键名由你自由决定（攻击、防御、智力、敏捷、幸运……）
   - 系统会自动把这些字段汇总为玩家属性加成
   - 非属性字段（类型、状态、图标、交互方式）不会被当成加成

主次：填"主要"、"次要"或"路人"
    - 主要：与主线剧情相关的核心角色（1-2个）
    - 次要：有名字、有档案的配角
    - 路人：一次性背景人物

格式说明：
1. 括号()内为具体内容
2. 背景和音乐用简短英文/拼音，方便作为文件名
3. 人物的(性别|心情|好感度|状态)如：(女|平静|50|站在窗边)
4. 标签用顿号、分隔
5. 场景人物1-3个，场景实体1-4个
`;
                if (guide) prompt += `用户要求：${guide}\n\n`;
                if (existing.length > 0) {
                    prompt += `已有场景（避免重复）：\n`;
                    existing.forEach(s => prompt += `- 【${s.name}】${s.description?.substring(0, 30) || ''}\n`);
                    prompt += '\n';
                }
                prompt += '请开始生成：\n';

                const result = await window.generateFunctionalReply(prompt, 'scene-generation');
                if (result) {
                    document.getElementById('scene-generated-text').value = result;
                    document.getElementById('scene-generation-result').style.display = 'block';
                    document.getElementById('confirm-create-btn').style.display = 'inline-block';
                }
            } finally {
                this.isGenerating = false;
                btn.disabled = false;
                btn.innerHTML = '🤖 AI生成场景';
            }
        },

        async confirm() {
            const text = document.getElementById('scene-generated-text').value.trim();
            if (!text) { alert('请先生成场景'); return; }
            const scene = WorldManager.addScene(text);
            if (!scene) { alert('场景创建失败'); return; }
            const name = prompt('请为你的角色起个名字：', PlayerStateManager.player.name || '主人公');
            if (name && name.trim()) {
                PlayerStateManager.player.name = name.trim();
                CinemaWorld.currentUserName = name.trim();
                PlayerStateManager.refreshAvatarArea();
            }
            CinemaWorld.ui.currentLocation = scene.name;
            window.UIManager.closeModal();
            await window.UIManager.showText(`【${scene.name}】已创建`, 1500);
            await LocationModalManager.doEnterScene(scene, { showText: false });
            window.UIManager.createFloatingButtons();
            window.UIManager.updateWorldStateDisplay();
            if (window.SaveManager) window.SaveManager.save();
        },
    };

    // ==================== 挂载到 window ====================
    window.LocationModalManager = LocationModalManager;
    window.SceneEditorManager = SceneEditorManager;
    window.SceneActionManager = SceneActionManager;
    window.SceneSpriteLayerManager = SceneSpriteLayerManager;
    window.SceneAvatarBarManager = SceneAvatarBarManager;
    window.LocationCreationManager = LocationCreationManager;

    console.log('[CinemaWorld] scene.js 已加载');
})();