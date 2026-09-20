// ============================================================
// CinemaWorld · background-ui.js
// 浮动按钮 + 手机 App UI
// 依赖：background-gen.js
// ============================================================

(function () {
    'use strict';

    // ==================== 浮动按钮 ====================
    const BackgroundGenFloatingButton = {
        BTN_ID: 'cinemaworld-bg-gen-btn',

        // 在场景行动栏上方插入一个生成按钮
        mount() {
            if (!window.BackgroundGenerator.isEnabled()) {
                this.unmount();
                return;
            }

            const bar = document.getElementById('cinemaworld-scene-actions');
            if (!bar) return;

            // 已存在就不重复建
            if (document.getElementById(this.BTN_ID)) return;

            const btn = document.createElement('button');
            btn.id = this.BTN_ID;
            btn.className = 'cw-bg-gen-btn';
            btn.title = 'AI 生成背景图';
            btn.innerHTML = `
                <span class="cw-bg-gen-icon">🎨</span>
                <span class="cw-bg-gen-label">生成背景</span>
            `;

            btn.onclick = (e) => {
                e.stopPropagation();
                this._onClick();
            };

            // 插到场景行动栏之前（也就是"上方"）
            const sceneActions = document.getElementById('cinemaworld-scene-actions');
            if (sceneActions && sceneActions.parentNode) {
                sceneActions.parentNode.insertBefore(btn, sceneActions);
            } else {
                const container = document.getElementById('cinemaworld-container');
                container?.appendChild(btn);
            }
        },

        unmount() {
            const el = document.getElementById(this.BTN_ID);
            if (el) el.remove();
        },

        async _onClick() {
            if (window.BackgroundGenerator.isGenerating()) {
                window.UIManager.showText('正在生成中，请稍候...', 1500);
                return;
            }

            // 长按/右键 = 菜单（清除 / 重新生成 / 预览）
            const scene = window.LocationModalManager?.currentLocation;
            if (!scene) {
                window.UIManager.showText('请先进入场景', 1500);
                return;
            }

            // 简单方案：点击 = 生成，如果已有生成的图，弹菜单
            if (scene.generatedBackground) {
                this._showMenu(scene);
            } else {
                await window.BackgroundGenerator.generateForCurrentScene();
            }
        },

        _showMenu(scene) {
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">🎨 背景图</div>
                <div style="font-size:12px;color:#888;margin-bottom:14px;text-align:center;">
                    当前场景已有 AI 生成的背景图
                </div>

                <div style="margin-bottom:14px;padding:10px;background:rgba(0,0,0,.3);border-radius:8px;">
                    <img src="${scene.generatedBackground}"
                         style="width:100%;border-radius:6px;display:block;"
                         alt="generated background">
                    <div style="font-size:11px;color:#666;margin-top:8px;line-height:1.5;">
                        ${(scene.generatedBackgroundPrompt || '').slice(0, 120)}...
                    </div>
                </div>

                <div style="display:grid;gap:8px;">
                    <button class="cinemaworld-button primary"
                        onclick="BackgroundGenFloatingButton._regen()">
                        🔄 重新生成
                    </button>
                    <button class="cinemaworld-button"
                        onclick="BackgroundGenFloatingButton._clear()">
                        🗑️ 清除（恢复原背景）
                    </button>
                    <button class="cinemaworld-button"
                        onclick="UIManager.closeModal()">
                        取消
                    </button>
                </div>
            `;
        },

        async _regen() {
            window.UIManager.closeModal();
            const scene = window.LocationModalManager?.currentLocation;
            if (!scene) return;
            delete scene.generatedBackground;   // 先清掉，让生成流程重新走
            await window.BackgroundGenerator.generateForCurrentScene();
        },

        _clear() {
            window.UIManager.closeModal();
            window.BackgroundGenerator.clearForCurrentScene();
        },
    };

    // ==================== 手机 App ====================
    const BackgroundGenAppUI = {
        // 渲染到 PhoneUIManager 的 modal 里（复用 cw-phone 外壳）
        render() {
            const cfg = window.BackgroundGenerator.getConfig();
            const workflows = window.BackgroundGenerator.getWorkflows();
            const activeWf = workflows.find(w => w.id === cfg.activeWorkflowId) || workflows[0];
            const enabled = cfg.enabled;

            return `
                <div class="cw-phone-app-header">
                    <button class="cw-phone-back" onclick="PhoneUIManager.goHome()">←</button>
                    <span>生图管理</span>
                </div>

                <div class="cw-phone-app-body">
                    <!-- 开关 -->
                    <div class="cw-bggen-card">
                        <div class="cw-bggen-card-title">🎨 功能开关</div>
                        <label class="cw-bggen-switch">
                            <input type="checkbox" id="bggen-enabled"
                                ${enabled ? 'checked' : ''}
                                onchange="BackgroundGenAppUI.toggleEnabled(this.checked)">
                            <span>在场景界面显示"生成背景"按钮</span>
                        </label>
                        <div class="cw-bggen-hint">
                            ${enabled
                                ? '按钮已显示在场景行动栏上方'
                                : '关闭后主界面不显示生图按钮（不影响已生成的背景图）'}
                        </div>
                    </div>

                    <!-- ComfyUI 连接 -->
                    <div class="cw-bggen-card">
                        <div class="cw-bggen-card-title">🔌 ComfyUI 连接</div>

                        <label class="cw-bggen-field">
                            <span>地址</span>
                            <input type="text" id="bggen-comfy-url"
                                value="${cfg.comfyuiUrl}"
                                placeholder="127.0.0.1:8188">
                        </label>

                        <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
                            <button class="cw-bggen-btn" onclick="BackgroundGenAppUI.testConnection()">
                                🔍 测试连接
                            </button>
                            <span id="bggen-conn-status" class="cw-bggen-status"></span>
                        </div>
                    </div>

                    <!-- 提示词来源 -->
                    <div class="cw-bggen-card">
                        <div class="cw-bggen-card-title">🧠 提示词生成来源</div>

                        <div class="cw-bggen-radio-group">
                            <label class="cw-bggen-radio">
                                <input type="radio" name="bggen-prompt-src" value="cinemaworld"
                                    ${cfg.promptSource === 'cinemaworld' ? 'checked' : ''}
                                    onchange="BackgroundGenAppUI.setPromptSource('cinemaworld')">
                                <span>CinemaWorld（推荐）</span>
                            </label>
                            <label class="cw-bggen-radio">
                                <input type="radio" name="bggen-prompt-src" value="kobold"
                                    ${cfg.promptSource === 'kobold' ? 'checked' : ''}
                                    onchange="BackgroundGenAppUI.setPromptSource('kobold')">
                                <span>KoboldCPP</span>
                            </label>
                            <label class="cw-bggen-radio">
                                <input type="radio" name="bggen-prompt-src" value="remote"
                                    ${cfg.promptSource === 'remote' ? 'checked' : ''}
                                    onchange="BackgroundGenAppUI.setPromptSource('remote')">
                                <span>远程 API</span>
                            </label>
                        </div>

                        <div id="bggen-kobold-config" style="${cfg.promptSource === 'kobold' ? '' : 'display:none;'}">
                            <label class="cw-bggen-field">
                                <span>KoboldCPP 地址</span>
                                <input type="text" id="bggen-kobold-url"
                                    value="${cfg.koboldUrl}"
                                    placeholder="http://127.0.0.1:5001">
                            </label>
                        </div>

                        <div id="bggen-remote-config" style="${cfg.promptSource === 'remote' ? '' : 'display:none;'}">
                            <label class="cw-bggen-field">
                                <span>API URL</span>
                                <input type="text" id="bggen-remote-url"
                                    value="${cfg.remoteApiUrl}"
                                    placeholder="https://api.openai.com/v1/chat/completions">
                            </label>
                            <label class="cw-bggen-field">
                                <span>API Key</span>
                                <input type="password" id="bggen-remote-key"
                                    value="${cfg.remoteApiKey}"
                                    placeholder="sk-...">
                            </label>
                            <label class="cw-bggen-field">
                                <span>模型</span>
                                <input type="text" id="bggen-remote-model"
                                    value="${cfg.remoteModel}"
                                    placeholder="gpt-3.5-turbo">
                            </label>
                        </div>
                    </div>
                    <div class="cw-bggen-card">
                        <div class="cw-bggen-card-title">✍️ 提示词风格</div>
                        <div class="cw-bggen-hint" style="margin-bottom:10px;">
                            CILP与自然语言，你想要用哪种？
                        </div>
                        <div class="cw-bggen-radio-group">
                            <label class="cw-bggen-radio">
                                <input type="radio" name="bggen-prompt-style" value="natural"
                                    ${cfg.promptStyle === 'natural' ? 'checked' : ''}
                                    onchange="BackgroundGenAppUI.setPromptStyle('natural')">
                                <div>
                                    <div style="font-size:13px;color:#ddd;">自然语言描述</div>
                                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.5;">
                                        完整句子描述场景<br>
                                        <span style="color:#7dd87d;">推荐：Qwen-Image / Anima / Flux / SD3 / MJ</span>
                                    </div>
                                </div>
                            </label>
                            <label class="cw-bggen-radio" style="margin-top:8px;">
                                <input type="radio" name="bggen-prompt-style" value="clip"
                                    ${cfg.promptStyle === 'clip' ? 'checked' : ''}
                                    onchange="BackgroundGenAppUI.setPromptStyle('clip')">
                                <div>
                                    <div style="font-size:13px;color:#ddd;">CLIP 标签</div>
                                    <div style="font-size:11px;color:#888;margin-top:2px;line-height:1.5;">
                                        逗号分隔的关键词<br>
                                        <span style="color:#9ab0ff;">推荐：SD1.5 / SDXL / Pony</span>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>
                    <!-- 画风/参数 -->
                    <div class="cw-bggen-card">
                        <div class="cw-bggen-card-title">🖌️ 画风与参数</div>

                        <label class="cw-bggen-field">
                            <span>画风前缀（可选，拼在提示词最前面）</span>
                            <textarea id="bggen-style-prefix" rows="2"
                                placeholder="留空即可。需要时可填：anime style, masterpiece, ">${cfg.stylePrefix || ''}</textarea>
                        </label>

                        <label class="cw-bggen-field">
                            <span>负面提示词</span>
                            <textarea id="bggen-negative" rows="3"
                                placeholder="humans, characters, people...">${cfg.negativePrompt || ''}</textarea>
                        </label>

                        <div class="cw-bggen-row">
                            <label class="cw-bggen-field half">
                                <span>宽</span>
                                <input type="number" id="bggen-width" value="${cfg.width}" step="64">
                            </label>
                            <label class="cw-bggen-field half">
                                <span>高</span>
                                <input type="number" id="bggen-height" value="${cfg.height}" step="64">
                            </label>
                        </div>
                    </div>

                    <!-- 工作流 -->
                                        <!-- 工作流 -->
                    <div class="cw-bggen-card">
                        <div class="cw-bggen-card-title">
                            🧩 工作流
                            <button class="cw-bggen-mini-btn" style="float:right;"
                                onclick="BackgroundGenAppUI.rescanWorkflows()"
                                title="重新扫描文件夹">🔄</button>
                        </div>

                        <div class="cw-bggen-hint" style="margin-bottom:8px;">
                            当前：<strong style="color:#9ab0ff;">${activeWf?.name || '（无）'}</strong>
                            ${activeWf?.isBuiltin ? '<span class="cw-bggen-tag">内置</span>' : ''}
                            ${activeWf?.isFromFile ? '<span class="cw-bggen-tag">📁 文件</span>' : ''}
                        </div>

                        <div class="cw-bggen-workflow-list">
                            ${workflows.map(w => `
                                <div class="cw-bggen-workflow-item ${w.id === cfg.activeWorkflowId ? 'active' : ''}">
                                    <div class="cw-bggen-workflow-name"
                                        onclick="BackgroundGenAppUI.selectWorkflow('${w.id}')">
                                        ${w.name}
                                        ${w.isBuiltin ? '<span class="cw-bggen-tag">内置</span>' : ''}
                                        ${w.isFromFile ? '<span class="cw-bggen-tag">📁</span>' : ''}
                                    </div>
                                    <button class="cw-bggen-mini-btn"
                                        onclick="BackgroundGenAppUI.openNodeConfig('${w.id}')"
                                        title="配置节点">⚙️</button>
                                    ${!w.isBuiltin ? `
                                        <button class="cw-bggen-del"
                                            onclick="BackgroundGenAppUI.removeWorkflow('${w.id}')"
                                            title="移除">🗑️</button>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </div>

                        <div class="cw-bggen-hint" style="margin-top:10px;font-size:10px;">
                            💡 把 ComfyUI 导出的 workflow JSON 放进<br>
                            <code>workflows/</code> 文件夹<br>
                            点右上 🔄 自动加载
                        </div>
                    </div>
                    <div class="cw-bggen-card">
                        <div class="cw-bggen-card-title">💾 存储管理</div>
                        <div class="cw-bggen-hint" id="bggen-storage-info">
                            加载中...
                        </div>
                        <div style="display:flex;gap:8px;margin-top:10px;">
                            <button class="cw-bggen-btn"
                                onclick="BackgroundGenAppUI.refreshStorageInfo()">
                                🔄 刷新
                            </button>
                            <button class="cw-bggen-btn"
                                onclick="BackgroundGenAppUI.openStorageManager()">
                                📂 管理
                            </button>
                        </div>
                    </div>            
                    <!-- 保存 -->
                    <div class="cw-bggen-actions">
                        <button class="cw-bggen-btn primary"
                            onclick="BackgroundGenAppUI.save()">
                            💾 保存配置
                        </button>
                        <button class="cw-bggen-btn"
                            onclick="BackgroundGenAppUI.testGenerate()">
                            🧪 测试生成
                        </button>
                    </div>
                </div>
            `;
        },
                async refreshStorageInfo() {
            const el = document.getElementById('bggen-storage-info');
            if (!el) return;
            try {
                const list = await window.BackgroundImageStore.listAll();
                const totalKB = list.reduce((s, r) => s + (r.dataUrl?.length || 0) * 0.75 / 1024, 0);
                const totalMB = (totalKB / 1024).toFixed(2);
                el.innerHTML = `
                    共 <strong style="color:#9ab0ff;">${list.length}</strong> 张背景图 ·
                    占用 <strong style="color:#9ab0ff;">${totalMB} MB</strong>
                `;
            } catch (e) {
                el.textContent = '读取失败：' + e.message;
            }
        },

        async openStorageManager() {
            const modal = document.getElementById('cinemaworld-modal');
            const list = await window.BackgroundImageStore.listAll();

            if (list.length === 0) {
                modal.className = 'active';
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📂 背景图管理</div>
                    <div style="text-align:center;padding:40px;color:#888;">
                        还没有生成过任何背景图
                    </div>
                    <div style="text-align:center;margin-top:16px;">
                        <button class="cinemaworld-button" onclick="PhoneUIManager.render()">返回</button>
                    </div>`;
                return;
            }

            list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

            let html = `
                <div class="cinemaworld-modal-title">📂 背景图管理 (${list.length})</div>
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;
                    max-height:60vh;overflow-y:auto;padding:4px;">
            `;

            for (const rec of list) {
                html += `
                    <div style="background:rgba(0,0,0,.3);border-radius:8px;padding:8px;
                        border:1px solid rgba(255,255,255,.08);">
                        <img src="${rec.dataUrl}" 
                            style="width:100%;height:100px;object-fit:cover;border-radius:6px;display:block;">
                        <div style="font-size:11px;color:#9ab0ff;margin-top:6px;
                            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                            title="${rec.sceneName}">
                            📍 ${rec.sceneName}
                        </div>
                        <div style="font-size:10px;color:#666;margin-top:2px;">
                            ${new Date(rec.createdAt).toLocaleString()}
                        </div>
                        <button class="cw-bggen-btn" style="width:100%;margin-top:6px;
                            justify-content:center;font-size:11px;padding:4px;"
                            onclick="BackgroundGenAppUI.deleteStoredImage('${rec.id}')">
                            🗑️ 删除
                        </button>
                    </div>
                `;
            }

            html += `</div>
                <div style="text-align:center;margin-top:14px;">
                    <button class="cinemaworld-button" onclick="PhoneUIManager.render()">返回</button>
                </div>`;

            modal.className = 'active';
            modal.innerHTML = html;
        },

        async deleteStoredImage(id) {
            if (!confirm('确定删除这张背景图吗？如果它正被场景使用，场景会恢复到普通背景。')) return;

            // 检查是否正在被使用
            const inUse = (window.CinemaWorld?.worldState?.entities || [])
                .some(s => s.generatedBackgroundId === id);

            if (inUse) {
                const scene = (window.CinemaWorld?.worldState?.entities || [])
                    .find(s => s.generatedBackgroundId === id);
                delete scene.generatedBackgroundId;
                delete scene.generatedBackgroundPrompt;
                delete scene.generatedBackgroundAt;

                // 如果删的正好是当前场景，立刻恢复普通背景
                if (window.LocationModalManager?.currentLocation === scene) {
                    if (scene.background) {
                        await window.BackgroundManager.apply(scene.background);
                    } else {
                        await window.BackgroundManager.apply(scene.name);
                    }
                }
            }

            await window.BackgroundImageStore.delete(id);
            if (window.SaveManager) window.SaveManager.save();
            window.UIManager.showText('已删除', 1500);
            this.openStorageManager();
        },
        // ---- 交互 ----
        toggleEnabled(v) {
            window.BackgroundGenerator.setConfig({ enabled: v });
            BackgroundGenFloatingButton.mount();   // 立即挂载/卸载
            window.UIManager.showText(v ? '已开启生图按钮' : '已关闭生图按钮', 1500);
        },

        setPromptSource(src) {
            window.BackgroundGenerator.setConfig({ promptSource: src });
            // 刷新 UI
            PhoneUIManager.render();
        },

        selectWorkflow(id) {
            window.BackgroundGenerator.setConfig({ activeWorkflowId: id });
            PhoneUIManager.render();
        },

        removeWorkflow(id) {
            if (!confirm('确定移除这个工作流吗？\n（如果它来自文件夹，下次刷新会自动回来）')) return;
            const ok = window.BackgroundWorkflowManager.remove(id);
            if (ok) {
                window.UIManager.showText('已移除工作流', 1500);
                PhoneUIManager.render();
            } else {
                window.UIManager.showText('内置工作流不可移除', 1500);
            }
        },

        async rescanWorkflows() {
            window.UIManager.showText('正在重新扫描工作流文件夹...', 1200);
            await window.BackgroundWorkflowManager.rescan();
            window.UIManager.showText(
                `已加载 ${window.BackgroundGenerator.getWorkflows().length} 个工作流`,
                1500
            );
            PhoneUIManager.render();
        },

        // ★ 核心：节点配置面板
        openNodeConfig(workflowId) {
            const wf = window.BackgroundGenerator.getWorkflows()
                .find(w => w.id === workflowId);
            if (!wf) return;

            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active cw-bggen-node-modal';

            // 收集所有可能的节点
            const textNodes = wf.textNodes || [];
            const allNodes = Object.entries(wf.workflow).map(([id, node]) => ({
                id,
                classType: node.class_type || 'unknown',
                inputs: node.inputs || {},
            }));

            const isTextNode = (node) => node.classType === 'CLIPTextEncode';
            const isLatentNode = (node) => node.classType === 'EmptyLatentImage';
            const isSamplerNode = (node) => 
                node.classType === 'KSampler' || node.classType === 'KSamplerAdvanced';

            // 文本节点选择器（正面/负面）
            const buildTextNodeSelect = (selectedId, inputId) => {
                const candidates = allNodes.filter(isTextNode);
                if (candidates.length === 0) {
                    return `<div class="cw-bggen-node-empty">未找到 CLIPTextEncode 节点</div>`;
                }
                return `
                    <select class="cw-bggen-node-select" id="${inputId}"
                        onchange="BackgroundGenAppUI._onNodeChange('${workflowId}')">
                        ${candidates.map(n => `
                            <option value="${n.id}" ${n.id === selectedId ? 'selected' : ''}>
                                ${n.id} - ${n.classType}
                                ${n.inputs.text ? ` [${String(n.inputs.text).slice(0, 30)}...]` : ''}
                            </option>
                        `).join('')}
                    </select>
                `;
            };

            // 宽高节点选择器
            const buildLatentNodeSelect = (selectedId, inputId) => {
                const candidates = allNodes.filter(isLatentNode);
                if (candidates.length === 0) {
                    return `<div class="cw-bggen-node-empty">未找到 EmptyLatentImage 节点</div>`;
                }
                return `
                    <select class="cw-bggen-node-select" id="${inputId}"
                        onchange="BackgroundGenAppUI._onNodeChange('${workflowId}')">
                        <option value="">（不使用）</option>
                        ${candidates.map(n => `
                            <option value="${n.id}" ${n.id === selectedId ? 'selected' : ''}>
                                ${n.id} - ${n.classType}
                                ${n.inputs.width ? ` (${n.inputs.width}×${n.inputs.height})` : ''}
                            </option>
                        `).join('')}
                    </select>
                `;
            };

            // 种子节点选择器
            const buildSeedNodeSelect = (selectedId, inputId) => {
                const candidates = allNodes.filter(n => 
                    isSamplerNode(n) && n.inputs.seed !== undefined
                );
                if (candidates.length === 0) {
                    return `<div class="cw-bggen-node-empty">未找到带 seed 的采样器节点</div>`;
                }
                return `
                    <select class="cw-bggen-node-select" id="${inputId}"
                        onchange="BackgroundGenAppUI._onNodeChange('${workflowId}')">
                        <option value="">（不使用）</option>
                        ${candidates.map(n => `
                            <option value="${n.id}" ${n.id === selectedId ? 'selected' : ''}>
                                ${n.id} - ${n.classType}
                            </option>
                        `).join('')}
                    </select>
                `;
            };

            // 节点列表（供点击快速填充）
            const buildNodeList = () => {
                return allNodes.map(n => {
                    const isPromptNode = n.id === wf.promptNode;
                    const isNegativeNode = n.id === wf.negativeNode;
                    const isWidthNode = n.id === wf.widthNode;
                    const isSeedNode = n.id === wf.seedNode;

                    const tags = [];
                    if (isPromptNode) tags.push('<span class="cw-bggen-node-tag primary">正面</span>');
                    if (isNegativeNode) tags.push('<span class="cw-bggen-node-tag negative">负面</span>');
                    if (isWidthNode) tags.push('<span class="cw-bggen-node-tag dim">宽高</span>');
                    if (isSeedNode) tags.push('<span class="cw-bggen-node-tag seed">种子</span>');

                    // 显示输入摘要
                    const inputsPreview = Object.entries(n.inputs)
                        .filter(([k, v]) => typeof v === 'string' && v.length > 0 && !k.startsWith('_'))
                        .slice(0, 2)
                        .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
                        .join(' · ');

                    return `
                        <div class="cw-bggen-node-row" data-node-id="${n.id}">
                            <div class="cw-bggen-node-id">${n.id}</div>
                            <div class="cw-bggen-node-type">${n.classType}</div>
                            <div class="cw-bggen-node-preview" title="${inputsPreview}">
                                ${inputsPreview || '—'}
                            </div>
                            <div class="cw-bggen-node-tags">${tags.join('')}</div>
                        </div>
                    `;
                }).join('');
            };

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">
                    ⚙️ 节点配置 · ${wf.name}
                </div>

                <div class="cw-bggen-node-modal-hint">
                    不同工作流的文本节点不一样，请手动指定哪个节点接收提示词。
                    点击下方节点可快速设置为"正面提示词"。
                </div>

                <!-- 配置区 -->
                <div class="cw-bggen-node-config">
                    <div class="cw-bggen-node-config-row">
                        <label>✅ 正面提示词节点</label>
                        ${buildTextNodeSelect(wf.promptNode, 'cfg-prompt-node')}
                    </div>
                    <div class="cw-bggen-node-config-row">
                        <label>🚫 负面提示词节点</label>
                        ${buildTextNodeSelect(wf.negativeNode, 'cfg-negative-node')}
                    </div>
                    <div class="cw-bggen-node-config-row">
                        <label>📐 宽高节点</label>
                        ${buildLatentNodeSelect(wf.widthNode, 'cfg-width-node')}
                    </div>
                    <div class="cw-bggen-node-config-row">
                        <label>🎲 种子节点</label>
                        ${buildSeedNodeSelect(wf.seedNode, 'cfg-seed-node')}
                    </div>
                </div>

                <!-- 节点列表 -->
                <div class="cw-bggen-node-list-title">
                    📋 全部节点 (${allNodes.length})
                    <span class="cw-bggen-hint" style="display:inline;margin-left:8px;">
                        点击任意节点 → 设为正面提示词
                    </span>
                </div>
                <div class="cw-bggen-node-list">
                    ${buildNodeList()}
                </div>

                <div class="cw-bggen-node-modal-actions">
                    <button class="cinemaworld-button primary"
                        onclick="BackgroundGenAppUI.saveNodeConfig('${workflowId}')">
                        💾 保存
                    </button>
                    <button class="cinemaworld-button"
                        onclick="PhoneUIManager.render()">
                        取消
                    </button>
                </div>
            `;

            // 节点列表点击 → 设为正面
            setTimeout(() => {
                modal.querySelectorAll('.cw-bggen-node-row').forEach(row => {
                    row.onclick = () => {
                        const nodeId = row.dataset.nodeId;
                        const select = document.getElementById('cfg-prompt-node');
                        if (select && [...select.options].some(o => o.value === nodeId)) {
                            select.value = nodeId;
                            this._onNodeChange(workflowId);
                        }
                    };
                });
            }, 0);
        },
        setPromptStyle(style) {
            window.BackgroundGenerator.setConfig({ promptStyle: style });
            const label = style === 'natural' ? '自然语言描述' : 'CLIP 标签';
            window.UIManager.showText(`已切换到「${label}」`, 1500);
        },
        save() {
            const patch = {
                comfyuiUrl: document.getElementById('bggen-comfy-url')?.value?.trim() || '127.0.0.1:8188',
                koboldUrl: document.getElementById('bggen-kobold-url')?.value?.trim() || '',
                remoteApiUrl: document.getElementById('bggen-remote-url')?.value?.trim() || '',
                remoteApiKey: document.getElementById('bggen-remote-key')?.value || '',
                remoteModel: document.getElementById('bggen-remote-model')?.value?.trim() || '',
                stylePrefix: document.getElementById('bggen-style-prefix')?.value || '',
                negativePrompt: document.getElementById('bggen-negative')?.value || '',
                width: parseInt(document.getElementById('bggen-width')?.value) || 1200,
                height: parseInt(document.getElementById('bggen-height')?.value) || 800,

                // ★ 新增：从 radio 里读当前选中的风格
                promptStyle: document.querySelector('input[name="bggen-prompt-style"]:checked')?.value || 'natural',
            };
            window.BackgroundGenerator.setConfig(patch);
            window.UIManager.showText('✅ 配置已保存', 1500);
        },
        // 节点变化时，只更新预览（不立即保存）
        _onNodeChange(workflowId) {
            // 这里只是 UI 反馈，保存时统一处理
            console.log('[BgGen] 节点选择变化:', workflowId);
        },

        saveNodeConfig(workflowId) {
            const promptNode = document.getElementById('cfg-prompt-node')?.value;
            const negativeNode = document.getElementById('cfg-negative-node')?.value || null;
            const widthNode = document.getElementById('cfg-width-node')?.value || null;
            const seedNode = document.getElementById('cfg-seed-node')?.value || null;

            if (!promptNode) {
                alert('必须选择正面提示词节点');
                return;
            }

            window.BackgroundWorkflowManager.updateNodeConfig(workflowId, {
                promptNode,
                promptField: 'text',
                negativeNode,
                negativeField: 'text',
                widthNode,
                heightNode: widthNode,   // 宽高同节点
                seedNode,
            });

            window.UIManager.showText('✅ 节点配置已保存', 1500);
            PhoneUIManager.render();
        },

        // 保留旧的导入方法（备用）
        openWorkflowImport() {
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">➕ 粘贴工作流 JSON</div>
                <div class="cw-bggen-node-modal-hint">
                    推荐把 JSON 放进 <code>workflows/</code> 文件夹自动加载。<br>
                    这里是备用入口，用于临时粘贴测试。
                </div>
                <input type="text" id="bggen-import-name"
                    placeholder="工作流名称（可选）"
                    class="cinemaworld-textarea"
                    style="min-height:auto;padding:8px 12px;margin-bottom:10px;">
                <textarea id="bggen-import-json"
                    class="cinemaworld-textarea"
                    placeholder='粘贴 workflow JSON...'
                    style="min-height:260px;font-family:monospace;font-size:11px;"></textarea>
                <div style="text-align:center;margin-top:14px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button primary" onclick="BackgroundGenAppUI.doImport()">
                        ✅ 导入
                    </button>
                    <button class="cinemaworld-button" onclick="PhoneUIManager.render()">
                        取消
                    </button>
                </div>
            `;
        },

        doImport() {
            const name = document.getElementById('bggen-import-name')?.value?.trim() || '自定义工作流';
            const jsonText = document.getElementById('bggen-import-json')?.value?.trim();
            if (!jsonText) { alert('请输入 JSON'); return; }

            const entry = window.BackgroundWorkflowManager.importFromJSON(jsonText, name);
            if (!entry) {
                alert('导入失败：JSON 格式有误');
                return;
            }

            window.BackgroundGenerator.setConfig({ activeWorkflowId: entry.id });
            window.UIManager.showText(`已导入工作流：${entry.name}`, 2000);

            // 直接打开节点配置
            setTimeout(() => this.openNodeConfig(entry.id), 100);
        },

        async testConnection() {
            const url = document.getElementById('bggen-comfy-url')?.value?.trim();
            const status = document.getElementById('bggen-conn-status');
            if (!url) return;

            window.BackgroundGenerator.setConfig({ comfyuiUrl: url });

            if (status) {
                status.textContent = '测试中...';
                status.style.color = '#ffcf80';
            }

            const ok = await window.BackgroundComfyClient.testConnection();
            if (status) {
                status.textContent = ok ? '✅ 连接成功' : '❌ 连接失败';
                status.style.color = ok ? '#7dd87d' : '#d87d7d';
            }
        },

        doImport() {
            const name = document.getElementById('bggen-import-name')?.value?.trim() || '自定义工作流';
            const jsonText = document.getElementById('bggen-import-json')?.value?.trim();
            if (!jsonText) { alert('请输入 JSON'); return; }

            const entry = window.BackgroundWorkflowManager.importFromJSON(jsonText, name);
            if (!entry) {
                alert('导入失败：JSON 格式有误');
                return;
            }

            window.BackgroundGenerator.setConfig({ activeWorkflowId: entry.id });
            window.UIManager.showText(`已导入工作流：${entry.name}`, 2000);
            PhoneUIManager.render();
        },

        save() {
            const patch = {
                comfyuiUrl: document.getElementById('bggen-comfy-url')?.value?.trim() || '127.0.0.1:8188',
                koboldUrl: document.getElementById('bggen-kobold-url')?.value?.trim() || '',
                remoteApiUrl: document.getElementById('bggen-remote-url')?.value?.trim() || '',
                remoteApiKey: document.getElementById('bggen-remote-key')?.value || '',
                remoteModel: document.getElementById('bggen-remote-model')?.value?.trim() || '',
                stylePrefix: document.getElementById('bggen-style-prefix')?.value || '',
                negativePrompt: document.getElementById('bggen-negative')?.value || '',
                width: parseInt(document.getElementById('bggen-width')?.value) || 1200,
                height: parseInt(document.getElementById('bggen-height')?.value) || 800,
            };
            window.BackgroundGenerator.setConfig(patch);
            window.UIManager.showText('✅ 配置已保存', 1500);
        },

        async testGenerate() {
            // 先保存
            this.save();

            const scene = window.LocationModalManager?.currentLocation;
            if (!scene) {
                window.UIManager.showText('请先进入一个场景再测试', 2000);
                return;
            }

            PhoneUIManager.close();
            await window.BackgroundGenerator.generateForCurrentScene();
        },
    };

    // ==================== 挂载 ====================
    window.BackgroundGenFloatingButton = BackgroundGenFloatingButton;
    window.BackgroundGenAppUI = BackgroundGenAppUI;

    // ==================== 自动挂载 ====================
    // 场景进入/切换后尝试挂载浮动按钮
    const _origDoEnter = window.LocationModalManager?.doEnterScene;
    if (_origDoEnter) {
        window.LocationModalManager.doEnterScene = async function (...args) {
            const r = await _origDoEnter.apply(this, args);
            setTimeout(() => BackgroundGenFloatingButton.mount(), 100);
            return r;
        };
    }
        // ==================== 数据一致性维护 ====================
// 在 background-ui.js 里，给 PhoneUIManager.render 包一层
const _origPhoneRender = window.PhoneUIManager?.render;
if (_origPhoneRender) {
    window.PhoneUIManager.render = function () {
        const r = _origPhoneRender.apply(this);
        // 如果当前是生图 App，刷新存储信息
        if (this.currentApp === 'bggen') {
            setTimeout(() => BackgroundGenAppUI.refreshStorageInfo(), 50);
        }
        return r;
    };
}
    // 1. 删除场景时，同步删掉 IndexedDB 里的原图
    const _origDeleteScene = window.LocationModalManager?.deleteScene;
    if (_origDeleteScene) {
        window.LocationModalManager.deleteScene = async function (name) {
            const scene = window.WorldManager?.findEntity(name);
            if (scene?.generatedBackgroundId && window.BackgroundImageStore) {
                window.BackgroundImageStore.delete(scene.generatedBackgroundId).catch(() => {});
            }
            return await _origDeleteScene.apply(this, [name]);
        };
    }

    // 2. 存档加载后 GC 孤儿原图
    const _origSaveApply = window.SaveManager?.apply;
    if (_origSaveApply) {
        window.SaveManager.apply = function (data) {
            const r = _origSaveApply.apply(this, [data]);
            setTimeout(() => {
                if (!window.BackgroundImageStore) return;
                const keepIds = (window.CinemaWorld?.worldState?.entities || [])
                    .map(s => s.generatedBackgroundId)
                    .filter(Boolean);
                window.BackgroundImageStore.gc(keepIds).catch(e =>
                    console.warn('[BgGen] GC 失败:', e)
                );
            }, 1500);
            return r;
        };
    }

    // 3. 场景行动刷新后重新挂载浮动按钮
    const _origRefresh = window.SceneActionManager?.refresh;
    if (_origRefresh) {
        window.SceneActionManager.refresh = function (...args) {
            const r = _origRefresh.apply(this, args);
            setTimeout(() => BackgroundGenFloatingButton.mount(), 50);
            return r;
        };
    }

    // 启动时尝试挂载
    setTimeout(() => BackgroundGenFloatingButton.mount(), 500);

    console.log('[CinemaWorld] background-ui.js 已加载');
})();