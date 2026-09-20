// ============================================================
// CinemaWorld · click.js
// 立绘点击反应：热区规则生成 / 解析 / 触发 / 气泡
// 依赖：core.js, world.js, player.js, story.js
// 被依赖：scene.js（渲染热区）、interact.js（面板入口）
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const CharacterRegistry = window.CharacterRegistry;
    const SpriteManager = window.SpriteManager;

    // ============================================================
    // 解析器：把 AI 生成的热区规则文本 → 结构化对象
    // ============================================================
    const ClickRuleParser = {
        parse(text) {
            const result = { zones: [], reactions: {} };
            if (!text || typeof text !== 'string') return this._fallback();

            const zoneBlockMatch = text.match(/热区[:：]?\s*([\s\S]*?)(?=反应[:：]|$)/);
            const reactionBlockMatch = text.match(/反应[:：]?\s*([\s\S]*)$/);

            // ---------- 解析热区 ----------
            if (zoneBlockMatch) {
                for (const raw of zoneBlockMatch[1].split('\n')) {
                    const line = raw.trim();
                    if (!line) continue;

                    // 匹配 "- 名字: 上~下" 或 "- 名字: 上~下, 左~右"
                    // 支持 - ~ ～ — 等分隔符
                    const m = line.match(
                        /^[-•]?\s*(.+?)\s*[:：]\s*(\d+)\s*[~～\-—]\s*(\d+)\s*(?:[,，]\s*(\d+)\s*[~～\-—]\s*(\d+))?/
                    );
                    if (!m) continue;

                    const label = m[1].trim();
                    if (!label) continue;

                    const top    = parseInt(m[2]);
                    const bottom = parseInt(m[3]);
                    if (isNaN(top) || isNaN(bottom) || bottom <= top) continue;

                    const left  = m[4] !== undefined ? parseInt(m[4]) : 0;
                    const right = m[5] !== undefined ? parseInt(m[5]) : 100;
                    if (isNaN(left) || isNaN(right) || right <= left) continue;

                    result.zones.push({
                        label,
                        top:    Math.max(0, Math.min(100, top)),
                        height: Math.max(0, Math.min(100, bottom) - Math.max(0, Math.min(100, top))),
                        left:   Math.max(0, Math.min(100, left)),
                        width:  Math.max(0, Math.min(100, right) - Math.max(0, Math.min(100, left))),
                    });
                }
            }

            if (result.zones.length === 0) {
                result.zones = this._defaultZones();
            }

            // ---------- 解析反应 ----------
            if (reactionBlockMatch) {
                let currentZone = null;

                for (const raw of reactionBlockMatch[1].split('\n')) {
                    const line = raw.trim();
                    if (!line) continue;

                    // 区域标题行
                    const zoneTitleM = line.match(/^([^\|]+?)\s*[:：]\s*$/);
                    if (zoneTitleM) {
                        currentZone = zoneTitleM[1].trim();
                        if (!result.reactions[currentZone]) {
                            result.reactions[currentZone] = [];
                        }
                        continue;
                    }

                    // "- 表情|台词|权重"
                    const itemM = line.match(/^[-•]?\s*(.+?)\|(.+?)\|(\d+)\s*$/);
                    if (itemM && currentZone) {
                        result.reactions[currentZone].push({
                            mood: itemM[1].trim(),
                            line: itemM[2].trim(),
                            weight: parseInt(itemM[3]) || 1,
                        });
                        continue;
                    }

                    // "- 表情|台词"
                    const itemM2 = line.match(/^[-•]?\s*(.+?)\|(.+?)\s*$/);
                    if (itemM2 && currentZone) {
                        result.reactions[currentZone].push({
                            mood: itemM2[1].trim(),
                            line: itemM2[2].trim(),
                            weight: 1,
                        });
                    }
                }
            }

            // 补齐：有热区没反应 → 给默认
            for (const zone of result.zones) {
                if (!result.reactions[zone.label] || result.reactions[zone.label].length === 0) {
                    result.reactions[zone.label] = [
                        { mood: '默认', line: '……', weight: 1 },
                    ];
                }
            }

            return result;
        },

        _defaultZones() {
            return [
                { label: '头部', top: 0,  height: 28, left: 0, width: 100 },
                { label: '身体', top: 28, height: 42, left: 0, width: 100 },
                { label: '手',   top: 70, height: 30, left: 0, width: 100 },
            ];
        },

        _fallback() {
            return {
                zones: this._defaultZones(),
                reactions: {
                    '头部': [{ mood: '默认', line: '……', weight: 1 }],
                    '身体': [{ mood: '默认', line: '……', weight: 1 }],
                    '手':   [{ mood: '默认', line: '……', weight: 1 }],
                },
            };
        },
    };

    // ============================================================
    // 生成器：拼 prompt、调 AI、解析、写入角色档案
    // ============================================================
        // ============================================================
    // 生成器：拼 prompt、调 AI、解析、写入角色档案
    // ============================================================
    const ClickRuleGenerator = {
        isGenerating: false,

        async generate(charName) {
            if (this.isGenerating) {
                console.log('[ClickRule] 正在生成中，请稍后');
                return null;
            }

            const char = CharacterRegistry.get(charName);
            if (!char) {
                console.warn(`[ClickRule] 找不到角色档案: ${charName}`);
                return null;
            }

            this.isGenerating = true;
            try {
                const prompt = await this._buildPrompt(char);
                const raw = await window.generateFunctionalReply(prompt, 'click-rules');
                if (!raw) {
                    console.warn('[ClickRule] AI 返回为空');
                    return null;
                }

                const parsed = ClickRuleParser.parse(raw);

                char.clickRules = {
                    generatedAt: Date.now(),
                    basedOnChapter: window.StoryManager?.currentChapter?.id || null,
                    zones: parsed.zones,
                    reactions: parsed.reactions,
                    raw: raw,
                };

                CharacterRegistry.upsert(char, char.lastScene || '', char.isPresent !== false);

                // ★ 关键：把规则也同步回当前场景的 sceneCharacters
                this._syncToScene(charName, char.clickRules);

                if (window.SaveManager) window.SaveManager.save();

                console.log('[ClickRule] 生成成功:', charName, parsed);
                return char.clickRules;

            } catch (e) {
                console.error('[ClickRule] 生成失败:', e);
                return null;
            } finally {
                this.isGenerating = false;
            }
        },

        // ★ 新增：把规则同步回场景对象（顺手把数据不一致也修了）
        _syncToScene(charName, rules) {
            const scene = window.LocationModalManager?.currentLocation;
            if (!scene) return;
            const sceneChar = scene.sceneCharacters?.find(c => c.name === charName);
            if (sceneChar) {
                sceneChar.clickRules = rules;
            }
        },

        // ★ 改成 async：需要先测量立绘尺寸
        async _buildPrompt(char) {
            const StoryManager = window.StoryManager;
            const InteractionDigestManager = window.InteractionDigestManager;

            // 测量真实立绘尺寸
            const sizeInfo = await this._measureSprite(char);

            // 剧情上下文
            let worldCtx = '';
            if (StoryManager) {
                worldCtx = StoryManager.buildContext(null, {
                    parentStory: false,
                    mainChars: false,
                    scene: false,
                    volumes: true,
                    chapters: true,
                    pendingEvents: false,
                    interactionDigests: false,
                }) || '';
            }

            // 交互历史
            let digestText = '';
            if (InteractionDigestManager) {
                const chapterId = StoryManager?.currentChapter?.id || null;
                digestText = InteractionDigestManager.formatForCharacterPrompt(char.name, chapterId) || '';
            }

            // 角色档案
            const tags = (char.tags || [])
                .map(t => typeof t === 'string' ? t : t?.name)
                .filter(Boolean);

            let charBlock = `姓名：${char.name}`;
            if (char.gender) charBlock += `\n性别：${char.gender}`;
            if (char.mood) charBlock += `\n心情：${char.mood}`;
            if (char.favorability !== undefined && char.favorability !== '') {
                charBlock += `\n好感度：${char.favorability}`;
            }
            if (char.status) charBlock += `\n状态：${char.status}`;
            if (tags.length) charBlock += `\n标签：${tags.join('、')}`;
            if (char.description) charBlock += `\n描述：${char.description}`;

            // 尺寸块
            const sizeBlock = sizeInfo
                ? `===== 立绘尺寸（真实数据）=====
立绘宽度：${sizeInfo.width} px
立绘高度：${sizeInfo.height} px
宽高比：${sizeInfo.aspect}（宽 / 高）
${sizeInfo.source}

★ 划分热区时必须参考真实宽高比：
- 宽高比 < 0.7（窄高，全身立绘）：纵向空间多，可细分头/胸/腰/腿
- 宽高比 0.7 ~ 1.3（接近方形，半身像）：可细分左脸/右脸/胸口/手
- 宽高比 > 1.3（宽扁，胸像/远景）：横向空间多，可细分左右区域
- 每个热区高度 ≥ 8%，宽度 ≥ 15%
- 热区覆盖范围建议铺满 0~100，不要留太大空隙`
                : `===== 立绘尺寸 =====
（暂无立绘图片，请按标准全身立绘比例划分：头部 0~20，身体 20~70，手 70~100）`;

            const prompt = `你正在为一个视觉小说角色设计"点击反应规则"。

玩家会点击立绘的不同部位，你要为每个部位设计多条"表情 + 台词"的反应。
这些反应会在玩家点击时随机播放，所以需要多样性和层次感。

===== 角色档案 =====
${charBlock}

${sizeBlock}

===== 当前剧情阶段 =====
${worldCtx || '（暂无剧情上下文）'}

===== 玩家与该角色的交互历史 =====
${digestText || '（暂无交互记录）'}

===== 任务 =====
1. 把立绘划分成 3-8 个热区
2. 每个热区用"上下界"（可选"左右界"）定义矩形区域
3. 为每个热区设计 2-4 条反应
4. 每条反应包含：立绘表情 + 一句台词 + 权重

===== 输出格式（严格遵守）=====

热区：
- 左脸: 0 ~ 20, 0 ~ 50
- 右脸: 0 ~ 20, 50 ~ 100
- 胸口: 20 ~ 60
- 左手: 60 ~ 100, 0 ~ 50
- 右手: 60 ~ 100, 50 ~ 100

反应：
头部:
- 害羞|别、别摸头啦…|3
- 生气|再摸就咬你哦。|1
身体:
- 惊讶|呀！|2
- 困惑|……你在做什么？|2
手:
- 开心|嗯？要牵手吗？|1

===== 规则 =====

【热区】
1. 区间格式："- 名字: 上界 ~ 下界"，上下界用 0-100 的百分比
2. 可选第二组：", 左界 ~ 右界"，不写则默认全宽
3. 不重叠、不留缝，尽量铺满 0 ~ 100
4. 每个热区高度 ≥ 8%，宽度 ≥ 15%
5. 至少 3 个热区，最多 8 个
6. ★ 是否切左右由你决定 ——
   - 高冷/内敛的角色：可以只给 3 个纵条（头/身/手）
   - 活泼/亲密/外形特殊的角色：可以细分左右
     （左脸/右脸、左手/右手、左翼/右翼）
   - 结合角色的性格、外形、亲密程度决定粒度
7. 热区名可以自由发挥：头部、脸、胸口、腰、手、翅膀、尾巴……
   但必须是短词，不要超过 3 个字

【反应】
1. 每条格式："- 表情|台词|权重"
2. "表情"是简短短语，用于选择立绘状态（害羞、生气、开心……）
3. 台词要符合角色性格、心情、好感度、剧情
4. 权重 1-5，越高越容易被点到
5. 每个热区 2-4 条

【风格要求】
1. 好感度高 → 反应更亲昵；好感度低 → 更冷淡
2. 心情差 → 更冲；心情好 → 更柔和
3. 不要出现"我是AI"之类的出戏内容

请开始生成：
`;

            return prompt;
        },

        // ★ 新增：测量立绘真实尺寸
        async _measureSprite(char) {
            // 1. 优先从 DOM 里找该角色当前的立绘
            const wrapper = document.querySelector(
                `.cinemaworld-scene-sprite[data-character-name="${CSS.escape(char.name)}"]`
            );

            if (wrapper) {
                const img = wrapper.querySelector('.cinemaworld-scene-sprite-img');
                if (img && img.complete && img.naturalWidth > 0) {
                    return {
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        aspect: (img.naturalWidth / img.naturalHeight).toFixed(2),
                        source: '（来源：DOM 中正在显示的立绘）',
                    };
                }

                const rect = wrapper.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    return {
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        aspect: (rect.width / rect.height).toFixed(2),
                        source: '（来源：容器尺寸，非图片真实尺寸）',
                    };
                }
            }

            // 2. 不在 DOM → 用 SpriteManager 已缓存的 URL 手动加载测量
            const url = window.SpriteManager?.getCachedSprite?.(char.name)
                     || window.SpriteManager?.getFromMapping?.(char.name);

            if (!url) return null;

            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    resolve({
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        aspect: (img.naturalWidth / img.naturalHeight).toFixed(2),
                        source: '（来源：缓存立绘的真实像素）',
                    });
                };
                img.onerror = () => resolve(null);
                img.src = url;
            });
        },

        clear(charName) {
            const char = CharacterRegistry.get(charName);
            if (!char) return false;
            delete char.clickRules;

            // ★ 同步清掉场景里的
            const scene = window.LocationModalManager?.currentLocation;
            const sceneChar = scene?.sceneCharacters?.find(c => c.name === charName);
            if (sceneChar) delete sceneChar.clickRules;

            if (window.SaveManager) window.SaveManager.save();
            return true;
        },
    };

    // ============================================================
    // 面板：打开 / 查看 / 编辑 / 重新生成
    // ============================================================
    const ClickRuleManager = {
        _currentChar: null,

        openPanel(name) {
            const char = CharacterRegistry.get(name);
            if (!char) {
                window.UIManager?.showText('找不到该角色', 1500);
                return;
            }

            this._currentChar = name;
            const rules = char.clickRules;

            if (!rules) {
                this._renderEmpty(char);
            } else {
                this._renderEditor(char, rules);
            }
        },
        _refreshSceneSprite(charName) {
            const scene = window.LocationModalManager?.currentLocation;
            if (!scene) return;

            // 只有这个角色在当前场景里才需要刷
            const inScene = scene.sceneCharacters?.some(c => c.name === charName);
            if (!inScene) return;

            // 找到这个角色对应的 wrapper
            const wrapper = document.querySelector(
                `.cinemaworld-scene-sprite[data-character-name="${CSS.escape(charName)}"]`
            );
            if (!wrapper) return;

            // ★ 先清旧热区层
            wrapper.querySelectorAll('.cw-hotspot-layer').forEach(el => el.remove());

            // ★ 找到场景角色对象，重建热区
            const char = scene.sceneCharacters.find(c => c.name === charName);
            if (!char) return;

            // ★ 同步档案规则到场景对象
            const archive = window.CharacterRegistry?.get?.(charName);
            if (archive?.clickRules) {
                char.clickRules = archive.clickRules;
            }

            window.SceneSpriteLayerManager?._buildHotspotLayer?.(wrapper, char);
        },

        // ---------- 空状态：引导生成 ----------
        _renderEmpty(char) {
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';
            modal.innerHTML = `
                <div class="cinemaworld-modal-title">👆 ${char.name} · 点击反应</div>

                <div style="text-align:center;padding:30px 20px 20px;color:#aaa;font-size:13px;line-height:1.8;">
                    <div style="font-size:56px;margin-bottom:16px;">👆</div>
                    <div>还没有为 <strong style="color:#fff;">${char.name}</strong> 生成点击反应规则</div>
                    <div style="color:#888;margin-top:10px;">
                        AI 会根据角色性格、当前心情、好感度、<br>
                        以及你们之间的交互历史，生成一套点击反应。
                    </div>
                </div>

                <div id="cw-click-gen-result" style="display:none;margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:5px;">生成结果预览：</div>
                    <div id="cw-click-gen-preview"
                        style="font-size:12px;line-height:1.7;color:#ccc;
                            padding:12px;background:rgba(0,0,0,.25);border-radius:8px;
                            max-height:300px;overflow-y:auto;white-space:pre-wrap;"></div>
                </div>

                <div style="text-align:center;margin-top:16px;display:flex;
                    justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" id="cw-click-gen-btn"
                        onclick="ClickRuleManager._doGenerate('${this._escape(char.name)}')">
                        🤖 AI 生成
                    </button>
                    <button class="cinemaworld-button"
                        onclick="UIManager.closeModal()">取消</button>
                </div>`;
        },

        // ---------- 已有规则：展示 + 编辑 ----------
        _renderEditor(char, rules) {
            const modal = document.getElementById('cinemaworld-modal');
            modal.className = 'active';

            // 统计
            const totalReactions = Object.values(rules.reactions || {})
                .reduce((s, arr) => s + arr.length, 0);

            // 生成时间
            const genTime = rules.generatedAt
                ? new Date(rules.generatedAt).toLocaleString()
                : '未知';

            // 章节对齐提示
            const currentChapterId = window.StoryManager?.currentChapter?.id || null;
            const isOutdated = rules.basedOnChapter
                && currentChapterId
                && rules.basedOnChapter !== currentChapterId;

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">👆 ${char.name} · 点击反应</div>

                <div style="display:flex;justify-content:space-between;align-items:center;
                    padding:10px 14px;background:rgba(255,255,255,.04);
                    border-radius:8px;margin-bottom:14px;font-size:12px;color:#888;">
                    <span>🎯 ${rules.zones.length} 个热区 · ${totalReactions} 条反应</span>
                    <span>🕐 ${genTime}</span>
                </div>

                ${isOutdated ? `
                    <div style="padding:10px 14px;background:rgba(255,180,80,.12);
                        border:1px solid rgba(255,180,80,.35);border-radius:8px;
                        margin-bottom:14px;font-size:12px;color:#ffcf80;line-height:1.6;">
                        ⚠️ 规则是在其他章节生成的，可能与当前剧情不符。建议重新生成。
                    </div>
                ` : ''}

                <div style="margin-bottom:15px;">
                    <div style="font-size:13px;color:#aaa;margin-bottom:8px;">
                        📋 规则内容（可手动编辑）：
                    </div>
                    <textarea class="cinemaworld-textarea" id="cw-click-rules-text"
                        style="min-height:320px;font-family:monospace;font-size:12px;">${this._formatRulesAsText(rules)}</textarea>
                    <div style="font-size:11px;color:#666;margin-top:6px;line-height:1.6;">
                        💡 格式：<br>
                        热区：<br>
                        - 头部: 0 ~ 28<br>
                        反应：<br>
                        头部:<br>
                        - 表情|台词|权重
                    </div>
                </div>

                <div style="text-align:center;margin-top:16px;display:flex;
                    justify-content:center;gap:8px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary"
                        onclick="ClickRuleManager._saveEdit('${this._escape(char.name)}')">
                        ✅ 保存
                    </button>
                    <button class="cinemaworld-button"
                        style="color:#ffcf80;border-color:rgba(255,207,128,.4);"
                        onclick="ClickRuleManager._doGenerate('${this._escape(char.name)}')">
                        🔄 重新生成
                    </button>
                    <button class="cinemaworld-button"
                        style="color:#d87d7d;border-color:rgba(216,125,125,.4);"
                        onclick="ClickRuleManager._doClear('${this._escape(char.name)}')">
                        🗑️ 清空规则
                    </button>
                    <button class="cinemaworld-button"
                        onclick="ClickRuleManager._testClick('${this._escape(char.name)}')">
                        🎲 测试
                    </button>
                    <button class="cinemaworld-button"
                        onclick="SceneCharacterBrowserManager.openBrowser()">
                        ← 返回
                    </button>
                    <button class="cinemaworld-button"
                        onclick="UIManager.closeModal()">关闭</button>
                </div>`;
        },

        // ---------- 把规则对象转回可编辑的文本 ----------
        _formatRulesAsText(rules) {
            const lines = [];

            lines.push('热区：');
            for (const z of (rules.zones || [])) {
                const top = z.top;
                const bottom = z.top + z.height;
                const left = z.left ?? 0;
                const right = left + (z.width ?? 100);

                if (left === 0 && right === 100) {
                    // 全宽 → 只写上下
                    lines.push(`- ${z.label}: ${top} ~ ${bottom}`);
                } else {
                    // 二维
                    lines.push(`- ${z.label}: ${top} ~ ${bottom}, ${left} ~ ${right}`);
                }
            }

            lines.push('');
            lines.push('反应：');
            for (const [zoneLabel, pool] of Object.entries(rules.reactions || {})) {
                lines.push(`${zoneLabel}:`);
                for (const r of pool) {
                    lines.push(`- ${r.mood}|${r.line}|${r.weight || 1}`);
                }
            }

            return lines.join('\n');
        },

        // ---------- 保存手动编辑 ----------
        _saveEdit(name) {
            const char = CharacterRegistry.get(name);
            if (!char) return;

            const textarea = document.getElementById('cw-click-rules-text');
            if (!textarea) return;

            const text = textarea.value.trim();
            if (!text) {
                alert('内容不能为空');
                return;
            }

            const parsed = ClickRuleParser.parse(text);

            char.clickRules = {
                generatedAt: char.clickRules?.generatedAt || Date.now(),
                basedOnChapter: char.clickRules?.basedOnChapter || null,
                zones: parsed.zones,
                reactions: parsed.reactions,
                raw: text,
                editedByPlayer: true,
            };

            CharacterRegistry.upsert(char, char.lastScene || '', char.isPresent !== false);
            if (window.SaveManager) window.SaveManager.save();
            this._refreshSceneSprite(name);
            window.UIManager?.showText('已保存', 1500);
            this._renderEditor(char, char.clickRules);
        },

        // ---------- 生成 ----------
        async _doGenerate(name) {
            const btn = document.getElementById('cw-click-gen-btn');
            const previewEl = document.getElementById('cw-click-gen-preview');
            const resultBox = document.getElementById('cw-click-gen-result');

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ 生成中...';
            }

            window.UIManager?.showText('正在生成点击反应规则...', 1200);

            const rules = await ClickRuleGenerator.generate(name);

            if (!rules) {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '🤖 AI 生成';
                }
                window.UIManager?.showText('❌ 生成失败', 2000);
                return;
            }
            this._refreshSceneSprite(name);
            window.UIManager?.showText(`✅ 已生成 ${rules.zones.length} 个热区`, 1500);

            const char = CharacterRegistry.get(name);
            this._renderEditor(char, rules);
        },

        // ---------- 清空 ----------
        _doClear(name) {
            if (!confirm(`确定清空 ${name} 的点击反应规则吗？`)) return;
            ClickRuleGenerator.clear(name);

            // ★ 新增：让当前场景的立绘热区消失
            this._refreshSceneSprite(name);

            window.UIManager?.showText('已清空', 1500);
            const char = CharacterRegistry.get(name);
            this._renderEmpty(char);
        },

        // ---------- 测试：随机抽一条看看 ----------
        _testClick(name) {
            const char = CharacterRegistry.get(name);
            const rules = char?.clickRules;
            if (!rules) return;

            const zones = rules.zones || [];
            if (zones.length === 0) return;

            // 随机一个热区
            const zone = zones[Math.floor(Math.random() * zones.length)];
            const pool = rules.reactions[zone.label] || [];
            if (pool.length === 0) return;

            // 随机一条
            const picked = pool[Math.floor(Math.random() * pool.length)];

            window.UIManager?.showText(
                `【${zone.label}】\n表情：${picked.mood}\n台词：${picked.line}`,
                3000
            );
        },

        // ---------- 工具 ----------
        _escape(str) {
            return String(str).replace(/'/g, "\\'");
        },
    };

    // ============================================================
    // 运行时触发（第二步接立绘热区时才真正用到）
    // 这里先写好，供后续对接
    // ============================================================
    const ClickReactionManager = {

        _lastTrigger: {},
        _THROTTLE_MS: 200,

        async trigger(name, zoneLabel) {
            // ★ 节流：同一角色 200ms 内只处理一次
            const now = Date.now();
            const key = `${name}`;
            if (this._lastTrigger[key] && now - this._lastTrigger[key] < this._THROTTLE_MS) {
                return;
            }
            this._lastTrigger[key] = now;

            const char = CharacterRegistry.get(name);
            const rules = char?.clickRules;
            if (!rules) return;

            const pool = rules.reactions?.[zoneLabel];
            if (!pool || pool.length === 0) return;

            const picked = this._pickWeighted(pool);
            if (!picked) return;

            console.log(`[ClickReaction] ${name} @ ${zoneLabel} → ${picked.mood} / ${picked.line}`);

            if (window.SceneSpriteLayerManager?.refreshSpriteFor) {
                try {
                    await window.SceneSpriteLayerManager.refreshSpriteFor(name, picked.mood);
                } catch (e) {
                    console.warn('[ClickReaction] 刷新立绘失败:', e);
                }
            }

            this._showBubble(name, picked.line);
            this._shake(name);
        },

        _pickWeighted(pool) {
            const total = pool.reduce((s, r) => s + (r.weight || 1), 0);
            if (total <= 0) return pool[0] || null;

            let r = Math.random() * total;
            for (const item of pool) {
                r -= (item.weight || 1);
                if (r <= 0) return item;
            }
            return pool[pool.length - 1];
        },

        _showBubble(name, text) {
            const wrapper = document.querySelector(
                `.cinemaworld-scene-sprite[data-character-name="${CSS.escape(name)}"]`
            );
            if (!wrapper) return;

            // 移除旧的
            const old = wrapper.querySelector('.cw-click-bubble');
            if (old) old.remove();

            const bubble = document.createElement('div');
            bubble.className = 'cw-click-bubble';
            bubble.textContent = text;
            wrapper.appendChild(bubble);

            // 触发进入动画
            requestAnimationFrame(() => {
                bubble.classList.add('show');
            });

            // 自动消失
            setTimeout(() => {
                bubble.classList.remove('show');
                setTimeout(() => bubble.remove(), 300);
            }, 2500);
        },

        _shake(name) {
            const wrapper = document.querySelector(
                `.cinemaworld-scene-sprite[data-character-name="${CSS.escape(name)}"]`
            );
            if (!wrapper) return;

            wrapper.classList.add('cw-shake-light');
            setTimeout(() => {
                wrapper.classList.remove('cw-shake-light');
            }, 350);
        },
    };

    // ============================================================
    // 挂载
    // ============================================================
    window.ClickRuleParser = ClickRuleParser;
    window.ClickRuleGenerator = ClickRuleGenerator;
    window.ClickRuleManager = ClickRuleManager;
    window.ClickReactionManager = ClickReactionManager;

    console.log('[CinemaWorld] click.js 已加载');
})();