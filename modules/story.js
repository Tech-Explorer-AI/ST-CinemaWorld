// ============================================================
// CinemaWorld · story.js
// 剧情 / 章节 / 交互历史 / 交互摘要
// 依赖：core.js, world.js, player.js, rules.js
// ============================================================

(function () {
    'use strict';

    const CinemaWorld = window.CinemaWorld;
    const WorldManager = window.WorldManager;
    const PlayerStateManager = window.PlayerStateManager;
    const RuleEngine = window.RuleEngine;
    const DerivedStatsEngine = window.DerivedStatsEngine;
    const TagEffectManager = window.TagEffectManager;

    // ==================== 交互历史管理器 ====================
    const InteractionHistoryManager = {
        MAX_PER_TARGET: 50,

        ensureExists() {
            if (!CinemaWorld.worldState.interactions) {
                CinemaWorld.worldState.interactions = [];
            }
        },

        // ★ 添加一条记录
        add(record) {
            this.ensureExists();
            record.id = `inter_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            record.timestamp = record.timestamp || Date.now();
            record.chapterId = StoryManager.currentChapter?.id || null;
            record.summary = '';
            record.summaryGeneratedAt = null;
            CinemaWorld.worldState.interactions.push(record);

            this.pruneOldRecords(record.type, record.target);
            this.pruneGlobal();

            if (window.SaveManager) window.SaveManager.save();
            return record;
        },

        pruneGlobal() {
            const MAX_GLOBAL = 500;
            const list = CinemaWorld.worldState.interactions;
            if (list.length <= MAX_GLOBAL) return;

            list.sort((a, b) => a.timestamp - b.timestamp);
            CinemaWorld.worldState.interactions = list.slice(-MAX_GLOBAL);
        },

        // ★ 打开历史记录模态框
        openHistoryModal(type, target) {
            const modal = document.getElementById('cinemaworld-modal');
            const records = this.getByTarget(type, target);

            const typeName = {
                character: '角色',
                sceneItem: '场景实体',
                inventoryItem: '背包物品',
                sceneAction: '场景行动',
            }[type] || '目标';

            if (records.length === 0) {
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📜 交互历史 · ${target}</div>
                    <div style="text-align:center;padding:50px 20px;color:#888;">
                        <div style="font-size:40px;margin-bottom:15px;">📭</div>
                        <div>暂无与【${target}】的交互记录</div>
                    </div>
                    <div style="text-align:center;margin-top:20px;">
                        <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                    </div>`;
                modal.className = 'active';
                return;
            }

            let html = `
                <div class="cinemaworld-modal-title">📜 交互历史 · ${target}</div>
                <div style="margin-bottom:15px;color:#aaa;font-size:13px;text-align:center;">
                    共 ${records.length} 条记录
                </div>
                <div style="display:grid;gap:10px;max-height:500px;overflow-y:auto;">`;

            records.forEach((rec, i) => {
                const time = new Date(rec.timestamp);
                const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
                const dateStr = `${time.getMonth() + 1}/${time.getDate()}`;

                html += `
                    <div style="background:rgba(255,255,255,.05);border-radius:10px;padding:14px;
                        border:1px solid rgba(255,255,255,.08);cursor:pointer;transition:all .2s;"
                        onclick="InteractionHistoryManager.viewRecord('${rec.id}')"
                        onmouseover="this.style.background='rgba(255,255,255,.1)'"
                        onmouseout="this.style.background='rgba(255,255,255,.05)'">
                        <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                            <div style="font-size:12px;color:#7da8ff;">
                                📍 ${rec.scene || '未知场景'}
                            </div>
                            <div style="font-size:11px;color:#666;">
                                ${dateStr} ${timeStr} · 回合${rec.turn}
                            </div>
                        </div>
                        <div style="font-size:13px;color:#ddd;margin-bottom:6px;">
                            <span style="color:#888;">你说：</span>${rec.playerInput}
                        </div>
                        <div style="font-size:12px;color:#888;line-height:1.5;
                            overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;
                            -webkit-box-orient:vertical;">
                            ${rec.script.substring(0, 80)}...
                        </div>
                        ${rec.effect ? `
                            <div style="font-size:11px;color:#d8c07d;margin-top:6px;">
                                ✨ 产生了数据变化
                            </div>
                        ` : ''}
                    </div>`;
            });

            html += `</div>
                <div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:10px;">
                    <button class="cinemaworld-button" 
                        onclick="InteractionHistoryManager.clearByTarget('${type}', '${target}')"
                        style="color:#d87d7d;">🗑️ 清空记录</button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;

            modal.innerHTML = html;
            modal.className = 'active';
        },

        // ★ 查看单条记录详情（重放脚本）
        viewRecord(recordId) {
            const rec = CinemaWorld.worldState.interactions.find(r => r.id === recordId);
            if (!rec) return;

            const modal = document.getElementById('cinemaworld-modal');
            const time = new Date(rec.timestamp);

            modal.innerHTML = `
                <div class="cinemaworld-modal-title">📜 交互详情</div>
                <div style="margin-bottom:15px;font-size:12px;color:#888;">
                    ${time.toLocaleString()} · 回合${rec.turn} · 场景：${rec.scene || '未知'}
                </div>
                <div style="margin-bottom:15px;padding:10px;background:rgba(120,150,255,.1);border-radius:8px;">
                    <div style="font-size:12px;color:#7da8ff;margin-bottom:5px;">你的输入</div>
                    <div style="font-size:13px;color:#ddd;">${rec.playerInput}</div>
                </div>
                <div style="margin-bottom:15px;">
                    <div style="font-size:12px;color:#aaa;margin-bottom:8px;">交互脚本</div>
                    <div style="font-size:13px;line-height:1.8;color:#ccc;padding:12px;
                        background:rgba(0,0,0,.25);border-radius:8px;max-height:300px;overflow-y:auto;">
                        ${rec.script.replace(/\n/g, '<br>')}
                    </div>
                </div>
                ${rec.effect ? `
                    <div style="margin-bottom:15px;">
                        <div style="font-size:12px;color:#aaa;margin-bottom:8px;">效果</div>
                        <pre style="font-size:12px;color:#d8c07d;padding:10px;
                            background:rgba(200,180,100,.1);border-radius:8px;
                            white-space:pre-wrap;">${rec.effect}</pre>
                    </div>
                ` : ''}
                <div style="text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" 
                        onclick="InteractionHistoryManager.replay('${rec.id}')">
                        ▶️ 重放
                    </button>
                    <button class="cinemaworld-button" 
                        onclick="InteractionHistoryManager.remove('${rec.id}'); InteractionHistoryManager.openHistoryModal('${rec.type}', '${rec.target}');">
                        🗑️ 删除
                    </button>
                    <button class="cinemaworld-button" 
                        onclick="InteractionHistoryManager.openHistoryModal('${rec.type}', '${rec.target}')">
                        返回
                    </button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
        },

        // ★ 重放脚本
        async replay(recordId) {
            const rec = CinemaWorld.worldState.interactions.find(r => r.id === recordId);
            if (!rec) return;

            const dialogues = rec.dialogues || window.VisualNovelManager.parseScript(rec.script);
            if (dialogues.length === 0) {
                alert('脚本为空，无法重放');
                return;
            }

            window.UIManager.closeModal();
            await window.VisualNovelManager.play(dialogues);
            await window.UIManager.showText('（重放完毕，未应用效果）', 2000);
        },

        // ★ 按目标清理旧记录
        pruneOldRecords(type, target) {
            const records = CinemaWorld.worldState.interactions
                .filter(r => r.type === type && r.target === target);

            if (records.length <= this.MAX_PER_TARGET) return;

            records.sort((a, b) => a.timestamp - b.timestamp);
            const toRemove = records.slice(0, records.length - this.MAX_PER_TARGET);
            const removeIds = new Set(toRemove.map(r => r.id));

            CinemaWorld.worldState.interactions = CinemaWorld.worldState.interactions
                .filter(r => !removeIds.has(r.id));
        },

        // ★ 获取某个目标的所有记录（按时间倒序）
        getByTarget(type, target) {
            this.ensureExists();
            return CinemaWorld.worldState.interactions
                .filter(r => r.type === type && r.target === target)
                .sort((a, b) => b.timestamp - a.timestamp);
        },

        // ★ 获取所有记录
        getAll() {
            this.ensureExists();
            return [...CinemaWorld.worldState.interactions]
                .sort((a, b) => b.timestamp - a.timestamp);
        },

        // ★ 获取最近 N 条（用于上下文）
        getRecent(n = 5, type = null) {
            this.ensureExists();
            let list = CinemaWorld.worldState.interactions;
            if (type) list = list.filter(r => r.type === type);
            return [...list].sort((a, b) => b.timestamp - a.timestamp).slice(0, n);
        },

        // ★ 删除某条记录
        remove(id) {
            this.ensureExists();
            const idx = CinemaWorld.worldState.interactions.findIndex(r => r.id === id);
            if (idx > -1) {
                CinemaWorld.worldState.interactions.splice(idx, 1);
                if (window.SaveManager) window.SaveManager.save();
            }
        },

        // ★ 清空某目标的所有记录
        clearByTarget(type, target) {
            if (!confirm(`确定清空与 ${target} 的所有交互记录吗？`)) return;
            this.ensureExists();
            CinemaWorld.worldState.interactions = CinemaWorld.worldState.interactions
                .filter(r => !(r.type === type && r.target === target));
            if (window.SaveManager) window.SaveManager.save();
            this.openHistoryModal(type, target);
            window.UIManager.showText(`已清空与 ${target} 的记录`, 1500);
        },
    };

    // ==================== 交互摘要管理器（带压缩） ====================
    const InteractionDigestManager = {
        COMPACT_THRESHOLD: 6,
        COMPACT_KEEP: 2,

        // ★ 角色数量配额
        ROLE_QUOTA: {
            main:  Infinity,
            minor: 8,
            npc:   5,
        },

        // ★ 排序权重（常量，方便调参）
        //   分数量级：compacted(1000) > thisChapter(200) > recentWindow(120) > 累积 lines/compacted
        //   目的：保证"被压缩过的长线角色"永远优先于"本章刚出现的路人"
        WEIGHT: {
            compacted:    1000,   // 被压缩过 → 基础分（说明有长期互动史）
            perLine:         3,   // 每保留一条 line
            perCompacted:    2,   // compactUntilIndex 每 1 分（相当于每条已压缩消息）
            thisChapter:   200,   // 本章活跃
            recentWindow:  120,   // 最近 24 小时内有互动
        },

        // ★ 取角色最后一次活跃时间（bucket 级，非 line 级）
        _lastActiveAt(name) {
            const store = this._ensureStore();
            const b = store.byCharacter[name];
            if (!b) return 0;
            // 旧结构：数组，最后一条的 createdAt
            if (Array.isArray(b)) {
                return b[b.length - 1]?.createdAt || 0;
            }
            // 新结构：bucket 级时间戳（如果没有，退化为 0）
            return b.lastActiveAt || 0;
        },

        // ★ 计算一个角色的"上下文权重分数"
        //   - 压缩过（长线角色）   → +1000
        //   - 每条已压缩消息       → +2
        //   - 每条保留中的 line    → +3
        //   - 本章活跃             → +200
        //   - 24h 内活跃           → +120
        _characterWeight(name, opts = {}) {
            const { chapterId = null } = opts;
            const store = this._ensureStore();
            const b = store.byCharacter[name];
            if (!b) return 0;

            // 旧结构：数组，按 summary 条数给分
            if (Array.isArray(b)) {
                return b.length * this.WEIGHT.perLine;
            }

            const W = this.WEIGHT;
            let score = 0;

            // 1. 被压缩过 → 说明有过长期互动史
            if ((b.compactUntilIndex || 0) > 0 || b.summary) {
                score += W.compacted;
            }
            // 2. 已压缩的消息量
            score += (b.compactUntilIndex || 0) * W.perCompacted;
            // 3. 保留中的 line 数
            score += (b.lines?.length || 0) * W.perLine;
            // 4. 本章活跃
            if (chapterId && b.chapterId === chapterId) {
                score += W.thisChapter;
            }
            // 5. 24h 内活跃
            const lastAt = this._lastActiveAt(name);
            if (lastAt && Date.now() - lastAt < 24 * 60 * 60 * 1000) {
                score += W.recentWindow;
            }

            return score;
        },
        // ---------- 归档：清掉不属于"保留章节"的旧摘要 ----------
        // keepChapterIds: 需要保留的 chapterId 数组（通常是"当前卷里所有章节"）
        archiveOldChapters(keepChapterIds = []) {
            const store = this._ensureStore();
            const keep = new Set(keepChapterIds);

            // ========== 角色摘要 ==========
            for (const name of Object.keys(store.byCharacter)) {
                const bucket = store.byCharacter[name];

                // 旧结构：数组
                if (Array.isArray(bucket)) {
                    const filtered = bucket.filter(d => keep.has(d.chapterId));
                    if (filtered.length === 0) {
                        delete store.byCharacter[name];
                    } else {
                        store.byCharacter[name] = filtered;
                    }
                    continue;
                }

                // 新结构：{ lines, summary, compactUntilIndex, chapterId, ... }
                // ★ 保留条件：
                //   - 该角色当前章节在保留列表里（本轮活跃）
                //   - 或者该角色有 summary（长期记忆，跨章保留）
                const hasSummary = !!bucket.summary;
                const chapterKept = !bucket.chapterId || keep.has(bucket.chapterId);

                if (!chapterKept && !hasSummary) {
                    // 没摘要 + 章节不保留 → 直接丢弃
                    delete store.byCharacter[name];
                } else if (!chapterKept && hasSummary) {
                    // 章节不保留但有摘要 → 保留摘要，清掉 lines
                    bucket.lines = [];
                    bucket.compactUntilIndex = 0;
                    // chapterId 保留原值，让 formatForCharacterPrompt 走"早期回顾"分支
                }
                // chapterKept === true → 完全保留
            }

            // ========== 物品摘要 ==========
            for (const name of Object.keys(store.byItem)) {
                const b = this._ensureBucket(store, 'byItem', name);
                b.items = b.items.filter(d => keep.has(d.chapterId));
                if (b.items.length === 0 && !b.compact) {
                    delete store.byItem[name];
                }
            }

            console.log(`[CinemaWorld] 交互摘要归档完成，保留 ${keep.size} 个章节`);
            if (window.SaveManager) window.SaveManager.save();
        },
        _quotaCharacters(names, opts = {}) {
            const { chapterId = null } = opts;
            const registry = window.CharacterRegistry;
            const store = this._ensureStore();

            // 1. 分桶（顺带过滤空 bucket）
            const buckets = { main: [], minor: [], npc: [] };
            for (const name of names) {
                const b = store.byCharacter[name];

                // ★ 空 bucket 不参与配额（只有档案、从没聊过）
                if (Array.isArray(b)) {
                    if (b.length === 0) continue;
                } else if (b) {
                    const hasContent =
                        (b.lines?.length || 0) > 0 ||
                        (b.compactUntilIndex || 0) > 0 ||
                        !!b.summary;
                    if (!hasContent) continue;
                } else {
                    continue;
                }

                const role = registry?.get(name)?.role || 'minor';
                (buckets[role] || buckets.minor).push(name);
            }

            // 2. 每个桶按"权重分数"降序排
            const scoreOf = (name) => this._characterWeight(name, { chapterId });
            for (const key of ['main', 'minor', 'npc']) {
                buckets[key].sort((a, b) => scoreOf(b) - scoreOf(a));
            }

            // 3. 按配额截断
            const kept = [];
            kept.push(...buckets.main);
            kept.push(...buckets.minor.slice(0, this.ROLE_QUOTA.minor));
            kept.push(...buckets.npc.slice(0, this.ROLE_QUOTA.npc));

            // 4. 被丢弃的记日志（方便调参）
            const dropped = {
                minor: buckets.minor.slice(this.ROLE_QUOTA.minor),
                npc:   buckets.npc.slice(this.ROLE_QUOTA.npc),
            };
            if (dropped.minor.length || dropped.npc.length) {
                console.log('[CinemaWorld] 上下文角色截断:', {
                    keptMinor: buckets.minor.slice(0, this.ROLE_QUOTA.minor)
                        .map(n => ({ name: n, score: scoreOf(n) })),
                    droppedMinor: dropped.minor
                        .map(n => ({ name: n, score: scoreOf(n) })),
                    droppedNpc: dropped.npc
                        .map(n => ({ name: n, score: scoreOf(n) })),
                });
            }

            return kept;
        },
        // ---------- 结构迁移 ----------
        _ensureBucket(store, bucketName, target) {
            const bucket = store[bucketName];
            if (!bucket[target]) {
                bucket[target] = { compact: '', compactUntilId: null, items: [] };
                return bucket[target];
            }
            // 旧结构迁移
            if (Array.isArray(bucket[target])) {
                const oldItems = bucket[target];
                bucket[target] = {
                    compact: '',
                    compactUntilId: null,
                    items: oldItems,
                };
                console.log(`[CinemaWorld] 交互摘要结构迁移: ${target}`);
            }
            return bucket[target];
        },

        _ensureStore() {
            if (!CinemaWorld.worldState.interactionDigests) {
                CinemaWorld.worldState.interactionDigests = { byCharacter: {}, byItem: {} };
            }
            const store = CinemaWorld.worldState.interactionDigests;
            if (!store.byCharacter) store.byCharacter = {};
            if (!store.byItem) store.byItem = {};
            return store;
        },

        // ---------- 添加 ----------
        add({ targetType, target, source, summary, chapterId }) {
            const store = this._ensureStore();
            const bucketName = targetType === 'character' ? 'byCharacter' : 'byItem';
            const bucket = this._ensureBucket(store, bucketName, target);

            bucket.items.push({
                id: `digest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                chapterId: chapterId || StoryManager.currentChapter?.id || null,
                targetType, target, source,
                summary,
                createdAt: Date.now(),
            });

            if (window.SaveManager) window.SaveManager.save();

            // ★ 异步触发压缩（不阻塞）
            this.compactTarget(targetType, target).catch(e => {
                console.error('[CinemaWorld] 压缩失败:', e);
            });
        },

        // ---------- 压缩单个 target ----------
        async compactTarget(targetType, target) {
            const store = this._ensureStore();
            const bucketName = targetType === 'character' ? 'byCharacter' : 'byItem';
            const bucket = this._ensureBucket(store, bucketName, target);

            if (bucket.items.length <= this.COMPACT_THRESHOLD) return;

            const needCompact = bucket.items.length - this.COMPACT_KEEP;
            const toCompact = bucket.items.slice(0, needCompact);
            if (toCompact.length === 0) return;

            const prev = bucket.compact ? `【已有回顾】\n${bucket.compact}\n\n` : '';
            const newText = toCompact.map((d, i) => `${i + 1}. ${d.summary}`).join('\n');

            let prompt;
            if (targetType === 'character') {
                prompt = `请把以下多次互动压缩成一段简短回顾，作为后续与「${target}」交互的上下文。

${prev}【新增互动】
${newText}

要求：
1. 保留：关系变化趋势（变好/变差/暧昧/疏远）、关键事件（承诺、冲突、秘密、赠礼）、当前态度
2. 一段话，不分点
3. 不要重复玩家的原话
4. 直接输出回顾内容，不要加任何前缀

请输出：`;
            } else {
                prompt = `请把以下多次使用/行动压缩成一段简短回顾，作为后续与「${target}」交互的上下文。

${prev}【新增记录】
${newText}

要求：
1. 保留：累计效果（用了多少次、消耗多少、产出多少）、当前状态、最近一次的关键结果
2. 一段话，不分点
3. 直接输出回顾内容，不要加任何前缀

请输出：`;
            }

            const result = await window.generateFunctionalReply(prompt, 'digest-compact');
            if (!result) return;

            bucket.compact = result.trim();
            bucket.compactUntilId = toCompact[toCompact.length - 1].id;
            bucket.items = bucket.items.slice(needCompact);

            console.log(`[CinemaWorld] 已压缩「${target}」摘要，剩余 ${bucket.items.length} 条`);
            if (window.SaveManager) window.SaveManager.save();
        },

        // ==================== 角色专用：双层存储 ====================
        // ★ 添加角色对话原文行
        addCharacterLines(name, dialogueText, chapterId) {
            const store = this._ensureStore();

            // ★ 首次创建 / 旧结构迁移
            if (!store.byCharacter[name] || Array.isArray(store.byCharacter[name])) {
                const oldItems = Array.isArray(store.byCharacter[name])
                    ? store.byCharacter[name]
                    : (store.byCharacter[name]?.items || []);
                store.byCharacter[name] = {
                    lines: [],
                    summary: '',
                    compactUntilIndex: 0,
                    chapterId: chapterId || null,
                    lastActiveAt: Date.now(),      // ★ 新增
                    _legacyItems: oldItems,
                };
                if (oldItems.length) {
                    const legacyText = oldItems
                        .map(d => d.summary)
                        .filter(Boolean)
                        .join('；');
                    if (legacyText) store.byCharacter[name].summary = legacyText;
                }
            }

            const bucket = store.byCharacter[name];
            // ★ 章节变了 → 清空 lines 和 summary，只保留"跨章的压缩回顾"
            const newChapterId = chapterId || bucket.chapterId;
            if (bucket.chapterId && newChapterId && bucket.chapterId !== newChapterId) {
                console.log(`[CinemaWorld] 角色「${name}」跨章：从 ${bucket.chapterId} 到 ${newChapterId}，清空本章记录`);

                // 旧章的 lines 全部压缩进 summary（如果有 content 的话）
                // 但这里简单处理：直接丢弃 lines（因为旧章的 summary 已经由 compressCharacter 生成过）
                bucket.lines = [];
                // summary 保留——它是"跨章回顾"，是角色档案的一部分
                // bucket.summary 不清，因为它是角色的"长期记忆"
                bucket.compactUntilIndex = 0;
            }

            bucket.chapterId = newChapterId;



            const lines = dialogueText.split('\n')
                .map(l => l.trim())
                .filter(Boolean)
                .filter(l => !/^🎵\s*音乐[:：]/.test(l));

            bucket.lines.push(...lines);

            if (window.SaveManager) window.SaveManager.save();

            this.compactCharacter(name).catch(e => {
                console.error('[CinemaWorld] 角色摘要压缩失败:', e);
            });
        },

        // ★ 章内压缩（lines 超阈值时）
        async compactCharacter(name) {
            const store = this._ensureStore();
            const bucket = store.byCharacter[name];
            if (!bucket || Array.isArray(bucket)) return;

            // ★ 按角色定位取参数
            const role = window.CharacterRegistry?.get(name)?.role || 'minor';
            const PARAMS = {
                main:  { threshold: 35, keep: 15 },
                minor: { threshold: 15, keep: 5 },
                npc:   { threshold: 8,  keep: 2 },
            };
            const { threshold: THRESHOLD, keep: KEEP } = PARAMS[role] || PARAMS.minor;

            if (bucket.lines.length <= THRESHOLD) return;

            const needCompact = bucket.lines.length - KEEP;
            const toCompact = bucket.lines.slice(0, needCompact);
            if (toCompact.length === 0) return;

            const prev = bucket.summary ? `【已有回顾】\n${bucket.summary}\n\n` : '';
            const newText = toCompact.join('\n');

            const prompt = `请把以下玩家与「${name}」的过往对话，总结成一段自然连贯的回顾。这段回顾会作为后续与该角色交互的上下文。

${prev}【新增对话】
${newText}

要求：
1. 保留：谈过什么话题、关系有什么变化、有什么约定/梗/悬念
2. 一段话，不分点，100字以内
3. 不要重复已有回顾的内容，合并成连贯的整体
4. 像"日记"一样自然，不要罗列
5. 如果提到具体的梗或承诺（如"下次帮你修屋顶"、"偷苹果"），必须保留

请直接输出回顾内容：
`;

            const result = await window.generateFunctionalReply(prompt, 'character-compact');
            if (!result) return;

            bucket.summary = result.trim();
            bucket.lines = bucket.lines.slice(needCompact);
            bucket.compactUntilIndex = (bucket.compactUntilIndex || 0) + needCompact;
            // ★ 注意：不动 lastActiveAt，压缩不代表"有新互动"
            //   lastActiveAt 只在 addCharacterLines 里刷新

            console.log(`[CinemaWorld] 已压缩「${name}」的对话，保留 ${bucket.lines.length} 条`);
            if (window.SaveManager) window.SaveManager.save();
        },

        // ---------- 读取 ----------
        _getAllForTarget(targetType, target) {
            const store = this._ensureStore();
            const bucketName = targetType === 'character' ? 'byCharacter' : 'byItem';
            const bucket = this._ensureBucket(store, bucketName, target);
            return {
                compact: bucket.compact,
                items: bucket.items,
            };
        },

        // ★ 取某角色本卷内所有摘要
        getForCharacter(name, chapterId, limit = 5) {
            const store = this._ensureStore();
            const bucket = store.byCharacter[name];

            if (!bucket) return { compact: '', items: [] };

            if (Array.isArray(bucket)) {
                const filtered = chapterId
                    ? bucket.filter(d => d.chapterId === chapterId)
                    : bucket;
                return { compact: '', items: filtered.slice(-limit) };
            }

            if (chapterId && bucket.chapterId && bucket.chapterId !== chapterId) {
                return { compact: bucket.summary || '', items: [] };
            }

            return {
                compact: bucket.summary || '',
                items: bucket.lines.slice(-limit).map(l => ({ summary: l })),
            };
        },

        // 取某物品在本章的摘要
        getForItem(name, chapterId, limit = 5) {
            const { compact, items } = this._getAllForTarget('item', name);
            const filtered = items.filter(d => !chapterId || d.chapterId === chapterId);
            return {
                compact,
                items: filtered.slice(-limit),
            };
        },

        // ---------- 格式化 ----------
        formatForCharacterPrompt(name, chapterId) {
            const store = this._ensureStore();
            const bucket = store.byCharacter[name];
            if (!bucket) return '';

            if (Array.isArray(bucket)) {
                const lines = bucket.map(d => `- ${d.summary}`).filter(Boolean);
                return lines.join('\n');
            }

            if (chapterId && bucket.chapterId && bucket.chapterId !== chapterId) {
                return bucket.summary ? `（早期回顾）${bucket.summary}` : '';
            }

            const parts = [];

            if (bucket.summary) {
                parts.push(`（早期回顾）${bucket.summary}`);
            }

            const recent = bucket.lines.slice(-20);
            if (recent.length > 0) {
                parts.push(`【最近对话】\n${recent.join('\n')}`);
            }

            return parts.join('\n\n');
        },

        formatForItemPrompt(name, chapterId) {
            const { compact, items } = this.getForItem(name, chapterId);
            const lines = [];
            if (compact) lines.push(`（过往回顾）${compact}`);
            items.forEach((d, i) => lines.push(`${i + 1}. ${d.summary}`));
            return lines.join('\n');
        },

        // ---------- 章节级汇总 ----------
        getAllForChapter(chapterId) {
            if (!chapterId) return { characters: {}, items: {} };
            const store = this._ensureStore();
            const result = { characters: {}, items: {} };

            // ★ 先过配额闸
            const keptNames = this._quotaCharacters(
                Object.keys(store.byCharacter),
                { chapterId }
            );
            const keptSet = new Set(keptNames);

            for (const [name, bucket] of Object.entries(store.byCharacter)) {
                if (!keptSet.has(name)) continue;   // ★ 被截掉的直接跳过

                const role = window.CharacterRegistry?.get(name)?.role || 'minor';

                if (Array.isArray(bucket)) {
                    const filtered = bucket.filter(d => d.chapterId === chapterId);
                    if (filtered.length) {
                        result.characters[name] = {
                            compact: '',
                            items: role === 'npc' ? [] : filtered,
                        };
                    }
                    continue;
                }

                if (bucket.chapterId === chapterId) {
                    result.characters[name] = {
                        compact: bucket.summary || '',
                        items: role === 'npc' ? [] : bucket.lines.map(l => ({ summary: l })),
                    };
                } else if (bucket.summary) {
                    result.characters[name] = {
                        compact: bucket.summary,
                        items: [],
                    };
                }
            }

            for (const [name, raw] of Object.entries(store.byItem)) {
                const b = this._ensureBucket(store, 'byItem', name);
                const filtered = b.items.filter(d => d.chapterId === chapterId);
                if (filtered.length || b.compact) {
                    result.items[name] = { compact: b.compact, items: filtered };
                }
            }
            return result;
        },

        // 本章"场景行动"摘要
        getChapterActions(chapterId, limit = 8) {
            if (!chapterId) return [];
            const store = this._ensureStore();
            const result = [];
            for (const [name, raw] of Object.entries(store.byItem)) {
                if (!name.startsWith('行动:')) continue;
                const b = this._ensureBucket(store, 'byItem', name);
                if (b.compact) {
                    result.push({
                        actionName: name.slice(3),
                        summary: b.compact,
                        isCompact: true,
                        createdAt: 0,
                    });
                }
                for (const d of b.items) {
                    if (d.chapterId === chapterId) {
                        result.push({
                            actionName: name.slice(3),
                            summary: d.summary,
                            isCompact: false,
                            createdAt: d.createdAt,
                        });
                    }
                }
            }
            return result.sort((a, b) => a.createdAt - b.createdAt).slice(-limit);
        },

        // 只取本章"与角色的交互"摘要
        formatChapterCharactersForPrompt(chapterId, limit = 6) {
            if (!chapterId) return '';
            const store = this._ensureStore();

            // 收集候选
            let names = Object.keys(store.byCharacter);

            // ★ 过配额闸
            names = this._quotaCharacters(names, { chapterId });

            const lines = [];
            for (const name of names) {
                const role = window.CharacterRegistry?.get(name)?.role || 'minor';
                if (role === 'npc') continue;

                const b = this._ensureBucket(store, 'byCharacter', name);
                if (b.compact) {
                    lines.push(`- ${name}：${b.compact}`);
                }
                const filtered = b.items.filter(d => d.chapterId === chapterId);
                const take = role === 'main' ? 2 : 1;
                filtered.slice(-take).forEach(d => {
                    lines.push(`- ${name}：${d.summary}`);
                });
            }
            return lines.slice(-limit).join('\n');
        },

        formatChapterActionsForPrompt(chapterId, limit = 8) {
            const list = this.getChapterActions(chapterId, limit);
            if (!list.length) return '';
            return list.map(d => `- ${d.actionName}：${d.summary}`).join('\n');
        },

        // ★ 章节总结时：整合所有交互
        formatChapterDigests(chapterId, options = {}) {
            if (!chapterId) return '';

            const opt = {
                characters:     true,
                sceneItems:     true,
                inventoryItems: true,
                sceneActions:   true,
                characterFilter: 'all',
                excludeName:     null,
                ...options,
            };

            const { items } = this.getAllForChapter(chapterId);
            let text = '';

            // ==================== 角色 ====================
            // story.js · formatChapterDigests
            if (opt.characters) {
                const store = this._ensureStore();
                let charNames = Object.keys(store.byCharacter);

                // 过滤条件（原有）
                if (opt.characterFilter === 'onlySelf' && opt.targetName) {
                    charNames = charNames.filter(n => n === opt.targetName);
                } else if (opt.characterFilter === 'excludeSelf' && opt.targetName) {
                    charNames = charNames.filter(n => n !== opt.targetName);
                } else if (Array.isArray(opt.characterFilter)) {
                    charNames = charNames.filter(n => opt.characterFilter.includes(n));
                }

                // ★ 新增：过配额闸
                charNames = this._quotaCharacters(charNames, { chapterId });

                if (charNames.length) {
                    text += `【本章与角色的交互】\n`;
                    for (const name of charNames) {
                        const role = window.CharacterRegistry?.get(name)?.role || 'minor';
                        const bucket = store.byCharacter[name];
                        if (!bucket || Array.isArray(bucket)) continue;

                        text += `▸ ${name}：\n`;
                        if (bucket.summary) {
                            text += `  （回顾）${bucket.summary}\n`;
                        }

                        // 每角色条数：main 全量，minor 1 条，npc 只留 compact
                        if (role === 'npc') {
                            // npc 不注入 lines，只留 summary
                        } else if (role === 'minor') {
                            bucket.lines.slice(-1).forEach(l => {
                                text += `  ${l}\n`;
                            });
                        } else {
                            bucket.lines.forEach(l => {
                                text += `  ${l}\n`;
                            });
                        }
                    }
                    text += '\n';
                }
            }

            // ==================== 按 source 分三类 ====================
            const actionEntries    = [];
            const sceneItemEntries = [];
            const inventoryEntries = [];

            for (const [name, data] of Object.entries(items)) {
                const source = data.items[0]?.source || null;

                if (name.startsWith('行动:') || source === 'sceneAction') {
                    actionEntries.push([name.replace(/^行动:/, ''), data]);
                } else if (source === 'sceneItem') {
                    sceneItemEntries.push([name, data]);
                } else if (source === 'inventoryItem') {
                    inventoryEntries.push([name, data]);
                } else {
                    inventoryEntries.push([name, data]);
                }
            }

            if (opt.sceneActions && actionEntries.length) {
                text += `【本章场景行动】\n`;
                for (const [name, data] of actionEntries) {
                    text += `▸ ${name}：\n`;
                    if (data.compact) text += `  （回顾）${data.compact}\n`;
                    data.items.forEach(d => { text += `  - ${d.summary}\n`; });
                }
                text += '\n';
            }

            if (opt.sceneItems && sceneItemEntries.length) {
                text += `【本章与场景实体的交互】\n`;
                for (const [name, data] of sceneItemEntries) {
                    text += `▸ ${name}：\n`;
                    if (data.compact) text += `  （回顾）${data.compact}\n`;
                    data.items.forEach(d => { text += `  - ${d.summary}\n`; });
                }
                text += '\n';
            }

            if (opt.inventoryItems && inventoryEntries.length) {
                text += `【本章使用背包物品】\n`;
                for (const [name, data] of inventoryEntries) {
                    text += `▸ ${name}：\n`;
                    if (data.compact) text += `  （回顾）${data.compact}\n`;
                    data.items.forEach(d => { text += `  - ${d.summary}\n`; });
                }
                text += '\n';
            }

            return text;
        },

        // ---------- 归档 ----------
        aarchiveOldChapters(keepChapterIds = []) {
            const store = this._ensureStore();
            const keep = new Set(keepChapterIds);
        
            for (const name of Object.keys(store.byCharacter)) {
                const bucket = store.byCharacter[name];
        
                if (Array.isArray(bucket)) {
                    const filtered = bucket.filter(d => keep.has(d.chapterId));
                    if (filtered.length === 0) {
                        delete store.byCharacter[name];
                    } else {
                        store.byCharacter[name] = filtered;
                    }
                    continue;
                }
        
                // ★ 关键修复：不删除 bucket，只清空"本章 lines"
                //   summary 是跨章长期记忆，永远保留
                if (bucket.chapterId && !keep.has(bucket.chapterId)) {
                    // 旧章 → 清 lines，保留 summary
                    bucket.lines = [];
                    bucket.compactUntilIndex = 0;
                    bucket.chapterId = null;   // 标记为"无归属章节"
                }
            }
        
            for (const bucketName of ['byItem']) {
                for (const name of Object.keys(store[bucketName])) {
                    const b = this._ensureBucket(store, bucketName, name);
                    b.items = b.items.filter(d => keep.has(d.chapterId));
                    if (b.items.length === 0 && !b.compact) {
                        delete store[bucketName][name];
                    }
                }
            }
        
            if (window.SaveManager) window.SaveManager.save();
        },
    };

    // ==================== 交互摘要生成器 ====================
    const InteractionSummaryManager = {
        // 交互结束时调用，生成并存储摘要
        async generateAndStore(record) {
            if (!record || record.summary) return record.summary;

            const scene = window.LocationModalManager?.currentLocation;
            const typeName = {
                character: '与角色的对话',
                sceneItem: '使用场景实体',
                inventoryItem: '使用背包物品',
            }[record.type] || '交互';

            const prevSummaries = InteractionHistoryManager
                .getByTarget(record.type, record.target)
                .filter(r => r.summary && r.id !== record.id)
                .slice(0, 5)
                .reverse()
                .map(r => `- ${r.summary}`)
                .join('\n');

            const prompt = `请用1-2句话总结这次交互，作为后续剧情的"前情提要"。

【交互类型】${typeName}
【目标】${record.target}
【场景】${record.scene || '未知'}
【玩家输入】${record.playerInput || '（无）'}

【交互脚本】
${record.script}

${record.effect ? `【数据变化】\n${record.effect}` : ''}

${prevSummaries ? `【与该目标的过往交互】\n${prevSummaries}\n` : ''}

要求：
1. 说清楚：发生了什么、结果是什么、关系/状态有何变化
2. 1-2句话，不分点，不带格式
3. 如果有关键选择或转折，必须写进去
4. 不要重复玩家输入的原话

请直接输出摘要：
`;

            const summary = await window.generateFunctionalReply(prompt, 'interaction-summary');
            if (summary) {
                record.summary = summary.trim();
                record.summaryGeneratedAt = Date.now();
                if (window.SaveManager) window.SaveManager.save();
            }
            return record.summary;
        },

        // 批量补全（旧存档升级用）
        async backfillMissing() {
            const list = CinemaWorld.worldState.interactions || [];
            const missing = list.filter(r => !r.summary && r.script);
            for (const rec of missing) {
                await this.generateAndStore(rec);
            }
        },
    };

        // ==================== 剧情管理器 ====================
        const StoryManager = {
            storyList: [],
            currentStory: null,
            chapters: [],
            currentChapter: null,
            volumes: [],
            currentVolume: null,
            _listIndex: 0,
            _pendingSwitch: null,
            _pendingSourceStory: null,
            _switchResolve: null,
    
            init() {
                console.log('[CinemaWorld] 剧情系统初始化');
            },
    
            // StoryManager 中新增
            getMainStoryContextForInteraction() {
                const chapter = this.currentChapter;
                let ctx = '';
    
                if (chapter) {
                    ctx += `【本章主线】${chapter.title}\n`;
                    if (chapter.compactSummary) {
                        ctx += `本章前情：${chapter.compactSummary}\n`;
                    }
                    const stories = this.storyList
                        .filter(s => s.chapterId === chapter.id && s.summary && s.order > (chapter.compactUntilOrder || 0))
                        .sort((a, b) => a.order - b.order)
                        .slice(-5);
                    if (stories.length > 0) {
                        ctx += `本章近期剧情：\n`;
                        stories.forEach(s => {
                            ctx += `  · ${s.title}：${s.summary}\n`;
                        });
                    }
                }
    
                const pastChapters = this.chapters.filter(c => c.summary && c !== chapter);
                if (pastChapters.length > 0) {
                    ctx += `\n【前情提要】\n`;
                    pastChapters.slice(-2).forEach(c => {
                        ctx += `  · ${c.title}：${c.summary}\n`;
                    });
                }
    
                return ctx;
            },
    
            getChapterInteractionSummary() {
                const chapter = this.currentChapter;
                if (!chapter) return '';
    
                const chapterInteractions = InteractionHistoryManager.getAll()
                    .filter(r => r.chapterId === chapter.id && r.summary);
    
                if (chapterInteractions.length === 0) return '';
    
                const byType = {
                    character: [],
                    sceneItem: [],
                    inventoryItem: [],
                };
                for (const r of chapterInteractions) {
                    if (byType[r.type]) byType[r.type].push(r);
                }
    
                let text = '【本章交互记录】\n';
    
                if (byType.character.length > 0) {
                    text += '\n▸ 与角色的互动：\n';
                    const byTarget = {};
                    for (const r of byType.character) {
                        if (!byTarget[r.target]) byTarget[r.target] = [];
                        byTarget[r.target].push(r);
                    }
                    for (const [name, records] of Object.entries(byTarget)) {
                        text += `  · ${name}：\n`;
                        records
                            .sort((a, b) => a.timestamp - b.timestamp)
                            .slice(-3)
                            .forEach(r => {
                                text += `    - ${r.summary}\n`;
                            });
                    }
                }
    
                if (byType.sceneItem.length > 0) {
                    text += '\n▸ 使用场景实体：\n';
                    byType.sceneItem.slice(-5).forEach(r => {
                        text += `  · ${r.target}：${r.summary}\n`;
                    });
                }
    
                if (byType.inventoryItem.length > 0) {
                    text += '\n▸ 使用背包物品：\n';
                    byType.inventoryItem.slice(-5).forEach(r => {
                        text += `  · ${r.target}：${r.summary}\n`;
                    });
                }
    
                return text;
            },
    
            // ==================== 创建剧情卡 ====================
            async createStory(userPrompt = '', parentStory = null) {
                const scene = window.LocationModalManager.currentLocation;
                if (!scene) {
                    this._showNoScene();
                    return;
                }
                
                // ★ 新增：如果没显式传前驱，自动找"本章最后一段已完成剧情"
                if (!parentStory && this.currentChapter) {
                    const chapterStories = this.storyList
                        .filter(s => s.chapterId === this.currentChapter.id && s.status === 'completed')
                        .sort((a, b) => (b.order || 0) - (a.order || 0));

                    if (chapterStories.length > 0) {
                        parentStory = chapterStories[0];   // 最新的一段
                    }
                }
                if (!this.currentChapter) {
                    ChapterManager.createChapter(`第${this.chapters.length + 1}章：${scene.name}`);
                }
    
                const modal = document.getElementById('cinemaworld-modal');
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📖 ${parentStory ? '继续剧情' : '创建剧情'}</div>
                    <div style="margin-bottom:15px;padding:10px;background:rgba(120,150,255,.1);border-radius:8px;font-size:13px;">
                        📍 当前场景：<span style="color:#7da8ff;font-weight:bold;">${scene.name}</span>
                        ${parentStory ? `<br>📚 前驱：<span style="color:#7da8ff;">${parentStory.title}</span>` : ''}
                    </div>
                    <div style="margin-bottom:15px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:5px;">剧情描述（可选）：</div>
                        <textarea class="cinemaworld-textarea" id="story-guide-input" 
                            placeholder="例如：主角在村庄中遇到了一位神秘的老者..." 
                            style="min-height:100px;">${userPrompt}</textarea>
                    </div>
                    <div style="margin-bottom:15px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:5px;">类型：</div>
                        <select id="story-type-select" style="width:100%;padding:8px;border-radius:5px;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);">
                            <option value="主线">主线剧情</option>
                            <option value="支线">支线剧情</option>
                            <option value="角色">角色剧情</option>
                        </select>
                    </div>
                    <div id="story-generation-result" style="display:none;margin-bottom:15px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:5px;">AI生成结果（可编辑）：</div>
                        <textarea class="cinemaworld-textarea" id="story-generated-text" style="min-height:300px;"></textarea>
                    </div>
                    <div style="text-align:center;margin-top:15px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                        <button class="cinemaworld-button primary" id="generate-story-btn" 
                            onclick="StoryManager.generateStory(${parentStory ? `'${parentStory.id}'` : 'null'})">🤖 AI生成剧情</button>
                        <button class="cinemaworld-button" id="confirm-story-btn" 
                            onclick="StoryManager.confirmStory(${parentStory ? `'${parentStory.id}'` : 'null'})" 
                            style="display:none;">✅ 确认开始</button>
                        <button class="cinemaworld-button" onclick="UIManager.closeModal()">✖ 取消</button>
                    </div>`;
                modal.className = 'active';
            },
    
            _showNoScene() {
                const modal = document.getElementById('cinemaworld-modal');
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📖 剧情</div>
                    <div style="text-align:center;padding:40px 20px;color:#888;">
                        <div style="font-size:40px;margin-bottom:15px;">📍</div>
                        <div>请先进入一个场景</div>
                    </div>
                    <div style="text-align:center;margin-top:20px;">
                        <button class="cinemaworld-button primary" onclick="LocationModalManager.openLocationBrowser()">📍 选择场景</button>
                        <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                    </div>`;
                modal.className = 'active';
            },
    
            // ==================== AI 生成剧情 ====================
            async generateStory(parentId = null) {
                const guide = document.getElementById('story-guide-input').value.trim();
                const type = document.getElementById('story-type-select').value;
                const btn = document.getElementById('generate-story-btn');
                btn.disabled = true;
                btn.innerHTML = '⏳ 生成中...';
    
                const parentStory = parentId ? this.storyList.find(s => s.id === parentId) : null;
                const context = this.buildContext(parentStory);
    
                const scene = window.LocationModalManager.currentLocation;
                const envLine = WorldManager.getEnvDataText(scene);
                const playerBlock = PlayerStateManager.formatForPrompt();
    
                const prompt = `你是视觉小说剧本作家。生成一段${type}剧情。

【世界状态】
${context}

★ 环境数据：${envLine}

${playerBlock}

【剧情要求】
${guide || '根据当前世界状态，生成一段自然推进的剧情。'}

【输出格式】（严格遵守）

【剧情】
类型: ${type}
标题: (剧情标题)
场景: (当前场景名，切换则写新场景名)
🎵 音乐: (可选，如"日常"、"紧张"、"温馨")

【摘要】
(2-4 句。谁出场、发生什么、达成什么、玩家选择导致什么。作为下次生成的上下文)

【对话】
【人物名|显示/隐藏|左/中/右|性别|状态】: 内容
【玩家|显示|中|性别|状态】: 内容
【旁白】: 环境描写或心理活动

【场景更新】（可选，只有场景变化才写，没变化完全省略）
场景: (场景名)
环境数据: 
- 已有键:新值   （只改已有键，不发明新键）
新增人物: 
- 【名|性别|心情|好感度|状态|主次】：描述，[标签]
修改人物: 
- 【名】：心情|新值   （字段限：心情/状态/描述/标签）
移除人物: 名1、名2
新增实体: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
物品: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
装备: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]
新增遭遇(写入新增实体，类型必须写"遭遇"): 
- 【名|图标】：描述，[类型:遭遇|HP:当前/最大|攻击:X|防御:X|敏捷:X|技能:X|掉落:X]
移除实体: 名1、名2
修改实体: 
- 【名】：状态→新状态
场景状态: 
- 键: 值

【效果】
目标: 玩家 或 角色名
数值变化: 键名 +N  或  键名 -N
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

状态效果(可选，| 分隔)：攻击-20% / 防御+30% / 每回合:生命-5 / 持续:3回合 / 跳过回合
示例：获得状态 中毒（生命-5|持续3回合）

【选项】（2-4 个，每个选项后紧跟唯一一个【效果】块）
A. 选项内容
B. 选项内容

【场景切换】（可选，玩家移动到新地点时写）
目标场景: 场景名
预制人物: [人物1, 人物2]
预制物品: [物品1, 物品2]
原因: 切换原因
（场景切换和场景更新可以同时存在）

【规则】
1. 对话行: 说话者"显示"，其他"隐藏"；玩家写【玩家|显示|中|性别】
2. 场景更新只写"变化"的：有人离开→移除人物，引入新角色→新增人物，实体被消耗/破坏→移除或修改实体，新实体→新增实体，氛围/时间变化→场景状态
3. 效果块可影响玩家或场景NPC。目标必须写在场景上下文里出现过的角色名。一次最多 2-3 个效果块
4. 每个选项后紧跟唯一一个【效果】块
5. 【摘要】必须写在【对话】之前

【待处理事件】（如有，剧情必须自然反映）
- 生命归零 → 昏迷醒来、被救、濒死体验
- 升级 → 感觉更强大、技能提升、周围人察觉
- 体力耗尽 → 醒来是第二天

【禁止】
× 捏造不在场景中的角色
× 场景实体格式和场景创建时不一致
× 角色离开却不写"移除人物"
× 实体被消耗却不写"移除实体"或"修改实体"
× 忽略本章交互摘要（人物态度、实体状态、气氛等）

请开始生成：
`;
    
                const result = await window.generateFunctionalReply(prompt, 'story-generation');
                btn.disabled = false;
                btn.innerHTML = '🤖 AI生成剧情';
    
                if (result) {
                    document.getElementById('story-generated-text').value = result;
                    document.getElementById('story-generation-result').style.display = 'block';
                    document.getElementById('confirm-story-btn').style.display = 'inline-block';
                }
            },
    
            // ==================== 确认生成剧情卡 ====================
            async confirmStory(parentId = null) {
                const text = document.getElementById('story-generated-text').value.trim();
                if (!text) { alert('请先生成剧情'); return; }
    
                const parentStory = parentId ? this.storyList.find(s => s.id === parentId) : null;
                const story = this.parseStory(text);
                if (!story) { alert('格式错误'); return; }
    
                story.id = `story_${Date.now()}`;
                story.parentId = parentId;
                story.chapterId = this.currentChapter?.id || null;
                story.order = this.storyList.filter(s => s.chapterId === story.chapterId).length + 1;
                story.createdAt = Date.now();
                story.status = 'active';
                story.chosenOption = null;
                
                // ★ 新增：确保新卡也有这些标记
                if (story._played === undefined) story._played = false;
                if (story._sceneSwitchHandled === undefined) story._sceneSwitchHandled = false;
                if (story._appliedEffects === undefined) story._appliedEffects = {};


                this.storyList.push(story);
    
                if (this.currentChapter) {
                    this.currentChapter.storyIds.push(story.id);
                    this.currentChapter.events.push({
                        type: 'story-create',
                        storyId: story.id,
                        title: story.title,
                        summary: `创建剧情: ${story.title}`,
                        timestamp: Date.now(),
                    });
                }
    
                window.UIManager.closeModal();
                await this.playStory(story);
                if (window.SaveManager) window.SaveManager.save();
            },
    
            // ==================== 解析剧情 ====================
            parseStory(text) {
                const story = {
                    raw: text,
                    title: '',
                    type: '主线',
                    scene: '',
                    music: '',
                    summary: '',
                    dialogues: [],
                    options: [],
                    globalEffects: [],
                    globalEffect: null,
                    sceneSwitch: null,
                    sceneUpdates: [],
                    // ★ 新增：幂等/播放状态标记
                    _played: false,
                    _sceneSwitchHandled: false,
                    _appliedEffects: {},
                };
    
                const titleMatch = text.match(/标题[:：]\s*(.+)/);
                if (titleMatch) story.title = titleMatch[1].trim();
                const typeMatch = text.match(/类型[:：]\s*(.+)/);
                if (typeMatch) story.type = typeMatch[1].trim();
                const sceneMatch = text.match(/场景[:：]\s*(.+)/);
                if (sceneMatch) story.scene = sceneMatch[1].trim();
                const musicMatch = text.match(/🎵\s*音乐[:：]\s*(.+)/);
                if (musicMatch) story.music = musicMatch[1].trim();
    
                // 对话
                const dlgSection = text.match(/【对话】([\s\S]*?)(?=【选项】|【效果】|【场景切换】|$)/);
                if (dlgSection) {
                    story.dialogues = window.VisualNovelManager.parseScript(dlgSection[1]);
                }
    
                // ★ 选项（每个选项后跟一个【效果】块）
                const optSection = text.match(/【选项】([\s\S]*?)$/);
                if (optSection) {
                    story.options = this.parseOptionsWithEffects(optSection[1]);
                }
    
                // ★ 摘要解析
                const summaryMatch = text.match(/【摘要】\s*([\s\S]*?)(?=【|$)/);
                if (summaryMatch) {
                    story.summary = summaryMatch[1].trim();
                }
    
                // ★ 解析场景更新（可能多个）
                const updateRegex = /【场景更新】([\s\S]*?)(?=【场景更新】|【场景切换】|【选项】|【效果】|$)/g;
                let m;
                while ((m = updateRegex.exec(text)) !== null) {
                    const parsed = this.parseSceneUpdate('【场景更新】' + m[1]);
                    if (parsed) story.sceneUpdates.push(parsed);
                }
    
                const beforeOptions = text.split('【选项】')[0];
    
                const effRegex = /【效果】([\s\S]*?)(?=【|$)/g;
                let effM;
                while ((effM = effRegex.exec(beforeOptions)) !== null) {
                    story.globalEffects.push('【效果】' + effM[1]);
                }
    
                const swMatch = text.match(/【场景切换】([\s\S]*?)(?=【选项】|【效果】|【场景更新】|$)/);
                if (swMatch) story.sceneSwitch = this.parseSceneSwitch(swMatch[1]);
    
                this.detectAndUpgradeSceneSwitch(story);
    
                return story;
            },
    
            // ★ 兜底：识别 AI 把"场景切换"误写进"场景更新"的情况
            detectAndUpgradeSceneSwitch(story) {
                if (!story || !story.sceneUpdates || story.sceneUpdates.length === 0) {
                    return story;
                }
    
                if (story.sceneSwitch && story.sceneSwitch.targetScene) {
                    return story;
                }
    
                const curSceneName = window.LocationModalManager.currentLocation?.name;
                if (!curSceneName) {
                    return story;
                }
    
                const switchCandidates = story.sceneUpdates.filter(
                    up => up.sceneName && up.sceneName !== curSceneName
                );
    
                if (switchCandidates.length === 0) {
                    return story;
                }
    
                const target = switchCandidates[switchCandidates.length - 1];
                const targetSceneName = target.sceneName;
                const sameTarget = switchCandidates.filter(up => up.sceneName === targetSceneName);
    
                const presetChars = new Map();
                const presetItems = new Map();
                for (const up of sameTarget) {
                    for (const c of up.addCharacters) {
                        if (!presetChars.has(c.name)) presetChars.set(c.name, c);
                    }
                    for (const it of up.addItems) {
                        if (!presetItems.has(it.name)) presetItems.set(it.name, it);
                    }
                }
    
                story.sceneSwitch = {
                    targetScene: targetSceneName,
                    characters: Array.from(presetChars.keys()),
                    items: Array.from(presetItems.keys()),
                    reason: '（系统从【场景更新】的场景名推断为场景切换）',
                    _upgraded: true,
                    _presetCharacters: Array.from(presetChars.values()),
                    _presetItems: Array.from(presetItems.values()),
                };
    
                const newUpdates = [];
                for (const up of story.sceneUpdates) {
                    if (up.sceneName !== targetSceneName) {
                        newUpdates.push(up);
                        continue;
                    }
    
                    const stripped = {
                        ...up,
                        sceneName: curSceneName,
                        addCharacters: [],
                        addItems: [],
                    };
    
                    const hasContent =
                        stripped.removeCharacters.length > 0 ||
                        stripped.removeItems.length > 0 ||
                        stripped.modifyItems.length > 0 ||
                        Object.keys(stripped.statusChanges).length > 0;
    
                    if (hasContent) {
                        newUpdates.push(stripped);
                    }
                }
                story.sceneUpdates = newUpdates;
    
                console.log('[CinemaWorld] 兜底升级场景切换:', story.sceneSwitch.targetScene,
                    '预制人物:', story.sceneSwitch.characters,
                    '预制物品:', story.sceneSwitch.items);
    
                return story;
            },
    
            // ★ 解析带效果的选项
            parseOptionsWithEffects(optionText) {
                const options = [];
    
                const blockRegex = /([A-Z])[.、]\s*([\s\S]*?)(?=(?:[A-Z][.、]\s)|$)/g;
                let m;
                while ((m = blockRegex.exec(optionText)) !== null) {
                    const key = m[1];
                    const body = m[2].trim();
                    if (!body) continue;
    
                    const effectMatch = body.match(/【效果】([\s\S]*?)(?=【场景切换】|$)/);
                    const switchMatch = body.match(/【场景切换】([\s\S]*?)$/);
    
                    let optText = body;
                    if (effectMatch) {
                        optText = optText.replace(effectMatch[0], '');
                    }
                    if (switchMatch) {
                        optText = optText.replace(switchMatch[0], '');
                    }
                    optText = optText.replace(/\s+/g, ' ').trim();
    
                    options.push({
                        key,
                        text: optText,
                        effectText: effectMatch ? '【效果】' + effectMatch[1] : '',
                        sceneSwitch: switchMatch ? this.parseSceneSwitch(switchMatch[1]) : null,
                    });
                }
    
                return options;
            },
    
            parseSceneSwitch(switchText) {
                const sw = { targetScene: '', characters: [], items: [], reason: '' };
                const ts = switchText.match(/目标场景[:：]\s*(.+)/);
                if (ts) sw.targetScene = ts[1].trim();
                const cs = switchText.match(/预制人物[:：]\s*\[(.+?)\]/);
                if (cs) sw.characters = cs[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
                const is = switchText.match(/预制物品[:：]\s*\[(.+?)\]/);
                if (is) sw.items = is[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
                const rs = switchText.match(/原因[:：]\s*(.+)/);
                if (rs) sw.reason = rs[1].trim();
                return sw;
            },
    
            // ==================== 场景更新解析器 ====================
            parseSceneUpdate(text) {
                const match = text.match(/【场景更新】([\s\S]*)/);
                if (!match) return null;
    
                const body = match[1];
                const update = {
                    sceneName: '',
                    addCharacters: [],
                    removeCharacters: [],
                    modifyCharacters: [],
                    addItems: [],
                    removeItems: [],
                    modifyItems: [],
                    addActions: [],
                    removeActions: [],
                    statusChanges: {},
                    environmentChanges: {},
                };
    
                const lines = body.split('\n');
                let section = null;
    
                const splitNames = (s) => s
                    .replace(/^[-•]\s*/, '')
                    .replace(/[【】\[\]]/g, '')
                    .split(/[、,，]/)
                    .map(x => x.trim())
                    .filter(Boolean);
    
                for (let raw of lines) {
                    const line = raw.trim();
                    if (!line) continue;
    
                    let m = line.match(/^场景[:：]\s*(.+)$/);
                    if (m) { update.sceneName = m[1].trim(); continue; }
    
                    m = line.match(/^移除人物[:：]?\s*(.*)$/);
                    if (m) {
                        section = 'removeChars';
                        if (m[1]) {
                            update.removeCharacters.push(...splitNames(m[1]));
                        }
                        continue;
                    }
    
                    m = line.match(/^修改人物[:：]?\s*(.*)$/);
                    if (m) {
                        section = 'modifyChars';
                        if (m[1]) {
                            this._parseModifyCharLine(m[1], update);
                        }
                        continue;
                    }
    
                    m = line.match(/^新增人物[:：]?\s*(.*)$/);
                    if (m) {
                        section = 'addChars';
                        if (m[1]) {
                            const ch = WorldManager.parseCharacterLine(m[1].replace(/^[-•]\s*/, ''));
                            if (ch && ch.name) update.addCharacters.push(ch);
                        }
                        continue;
                    }
    
                    m = line.match(/^移除(?:实体|物品)[:：]?\s*(.*)$/);
                    if (m) {
                        section = 'removeItems';
                        if (m[1]) {
                            update.removeItems.push(...splitNames(m[1]));
                        }
                        continue;
                    }
    
                    // ★ 兼容"新增遭遇实体"、"新增敌人"、"新增NPC"等
                    m = line.match(/^新增(?:遭遇)?(?:实体|物品|敌人|NPC)[:：]?\s*(.*)$/);
                    if (m) {
                        section = 'addItems';
                        if (m[1]) {
                            const it = WorldManager.parseItemLine(m[1].replace(/^[-•]\s*/, ''));
                            if (it && it.name) update.addItems.push(it);
                        }
                        continue;
                    }
    
                    m = line.match(/^修改(?:实体|物品)[:：]?\s*(.*)$/);
                    if (m) {
                        section = 'modifyItems';
                        if (m[1]) {
                            this._parseModifyItemLine(m[1], update);
                        }
                        continue;
                    }
    
                    m = line.match(/^场景状态[:：]?\s*(.*)$/);
                    if (m) {
                        section = 'status';
                        if (m[1]) {
                            const kv = m[1].match(/^(.+?)[:：]\s*(.+)$/);
                            if (kv) update.statusChanges[kv[1].trim()] = kv[2].trim();
                        }
                        continue;
                    }
    
                    m = line.match(/^环境数据[:：]?\s*(.*)$/);
                    if (m) {
                        section = 'env';
                        update.environmentChanges = update.environmentChanges || {};
                        if (m[1]) {
                            this._parseEnvLine(m[1], update);
                        }
                        continue;
                    }
    
                    m = line.match(/^移除行动[:：]?\s*(.*)$/);
                    if (m) {
                        section = 'removeActions';
                        if (m[1]) update.removeActions.push(...splitNames(m[1]));
                        continue;
                    }
                    m = line.match(/^新增行动[:：]?\s*(.*)$/);
                    if (m) {
                        section = 'addActions';
                        if (m[1]) {
                            const act = WorldManager.parseActionLine(m[1].replace(/^[-•]\s*/, ''));
                            if (act && act.name) update.addActions.push(act);
                        }
                        continue;
                    }
    
                    if (section === 'addChars') {
                        const line2 = line.replace(/^[-•]\s*/, '');
                        const ch = WorldManager.parseCharacterLine(line2);
                        if (ch && ch.name) update.addCharacters.push(ch);
    
                    } else if (section === 'removeChars') {
                        update.removeCharacters.push(...splitNames(line));
    
                    } else if (section === 'modifyChars') {
                        this._parseModifyCharLine(line.replace(/^[-•]\s*/, ''), update);
    
                    } else if (section === 'addItems') {
                        const line2 = line.replace(/^[-•]\s*/, '');
                        const it = WorldManager.parseItemLine(line2);
                        if (it && it.name) update.addItems.push(it);
    
                    } else if (section === 'removeItems') {
                        update.removeItems.push(...splitNames(line));
    
                    } else if (section === 'modifyItems') {
                        this._parseModifyItemLine(line.replace(/^[-•]\s*/, ''), update);
    
                    } else if (section === 'status') {
                        const kv = line.replace(/^[-•]\s*/, '').match(/^(.+?)[:：]\s*(.+)$/);
                        if (kv) update.statusChanges[kv[1].trim()] = kv[2].trim();
    
                    } else if (section === 'env') {
                        this._parseEnvLine(line, update);
    
                    } else if (section === 'removeActions') {
                        update.removeActions.push(...splitNames(line));
    
                    } else if (section === 'addActions') {
                        const line2 = line.replace(/^[-•]\s*/, '');
                        const act = WorldManager.parseActionLine(line2);
                        if (act && act.name) update.addActions.push(act);
                    }
                }
    
                return update;
            },
    
            _parseModifyCharLine(line, update) {
                const m = line.match(/^[【\[]?(.+?)[】\]]?[：:]\s*(.+)$/);
                if (!m) return;
                const name = m[1].trim();
                const rest = m[2].trim();
    
                const validFields = ['心情', '好感度', '状态', '描述', '性别', '标签'];
    
                const pipe = rest.match(/^(.+?)\s*\|\s*(.+)$/);
                if (!pipe) {
                    console.warn(`[CinemaWorld] 修改人物格式无效（缺 |）: ${line}`);
                    return;
                }
    
                const field = pipe[1].trim();
                let value = pipe[2].trim();
    
                if (!validFields.includes(field)) {
                    console.warn(`[CinemaWorld] 修改人物字段名无效: ${field}，跳过`);
                    return;
                }
    
                if (field === '好感度') {
                    const delta = value.match(/^([+\-])\s*(\d+)$/);
                    if (delta) {
                        update.modifyCharacters.push({
                            name,
                            field,
                            op: delta[1],
                            value: parseInt(delta[2]),
                        });
                        return;
                    }
                    const abs = value.match(/^(\d+)$/);
                    if (abs) {
                        update.modifyCharacters.push({
                            name,
                            field,
                            op: '=',
                            value: parseInt(abs[1]),
                        });
                        return;
                    }
                    console.warn(`[CinemaWorld] 好感度格式无效: ${value}`);
                    return;
                }
    
                if (field === '标签') {
                    const tags = value.split(/[、,，]/).map(t => t.trim()).filter(Boolean);
                    update.modifyCharacters.push({ name, field, value: tags });
                    return;
                }
    
                update.modifyCharacters.push({ name, field, value });
            },
    
            _parseEnvLine(line, update) {
                update.environmentChanges = update.environmentChanges || {};
                const clean = line.replace(/^[-•]\s*/, '').trim();
                if (!clean) return;
                const kv = clean.match(/^(.+?)[:：]\s*(.+)$/);
                if (kv) {
                    update.environmentChanges[kv[1].trim()] = kv[2].trim();
                }
            },
    
            _parseModifyItemLine(line, update) {
                let m = line.match(/^[【\[]?(.+?)[】\]]?[：:]\s*(.+)$/);
                if (!m) return;
                const name = m[1].trim();
                let rest = m[2].trim();
    
                rest = rest.replace(/^状态[:：]?\s*/, '');
    
                const arrow = rest.match(/^(.+?)→(.+)$/);
                if (arrow) {
                    update.modifyItems.push({
                        name,
                        field: '状态',
                        value: arrow[2].trim(),
                    });
                    return;
                }
    
                update.modifyItems.push({
                    name,
                    field: '描述',
                    value: rest,
                });
            },
    
            // ==================== 应用场景更新 ====================
            async applySceneUpdate(update) {
                if (!update) return;
    
                const scene = update.sceneName
                    ? WorldManager.findEntity(update.sceneName)
                    : window.LocationModalManager.currentLocation;
    
                if (!scene) {
                    console.warn(`[CinemaWorld] 场景更新目标不存在，暂存: ${update.sceneName}`);
                    if (!CinemaWorld.worldState.pendingUpdates) {
                        CinemaWorld.worldState.pendingUpdates = [];
                    }
                    CinemaWorld.worldState.pendingUpdates.push(update);
                    return;
                }
    
                console.log('[CinemaWorld] 应用场景更新:', update);
    
                scene.sceneCharacters = scene.sceneCharacters || [];
                scene.sceneItems = scene.sceneItems || [];
                scene.statusBar = scene.statusBar || {};
                scene.sceneActions = scene.sceneActions || [];
    
                // ==================== 环境数据 ====================
                if (update.environmentChanges && Object.keys(update.environmentChanges).length > 0) {
                    if (!scene.environmentData || typeof scene.environmentData !== 'object') {
                        scene.environmentData = { _order: [], _raw: '' };
                    }
                    if (!Array.isArray(scene.environmentData._order)) {
                        scene.environmentData._order = [];
                    }
    
                    for (const [key, value] of Object.entries(update.environmentChanges)) {
                        if (!scene.environmentData._order.includes(key)) {
                            scene.environmentData._order.push(key);
                        }
                        scene.environmentData[key] = value;
                    }
    
                    scene.environmentData._raw = scene.environmentData._order
                        .filter(k => scene.environmentData[k] !== undefined && scene.environmentData[k] !== '')
                        .map(k => `${k}:${scene.environmentData[k]}`)
                        .join('|');
    
                    console.log('[CinemaWorld] 环境数据已更新:', scene.environmentData);
                }
    
                // ==================== 新增人物 ====================
                for (const ch of update.addCharacters) {
                    if (!scene.sceneCharacters.some(c => c.name === ch.name)) {
                        scene.sceneCharacters.push(ch);
                    } else {
                        const existing = scene.sceneCharacters.find(c => c.name === ch.name);
                        Object.assign(existing, ch);
                    }
                    window.CharacterRegistry.upsert(ch, scene.name, true);

                    // ★ 新增：预热立绘
                    if (scene.name === CinemaWorld.ui.currentLocation) {
                        const state = window.SpriteManager.pickSpriteState(ch);
                        window.SpriteManager.ensureSpriteWithState(ch.name, ch.gender, state)
                            .catch(e => console.warn('[CinemaWorld] 预热立绘失败:', e));
                    }
                }
    
                // ==================== 修改人物 ====================
                for (const mod of update.modifyCharacters) {
                    const char = scene.sceneCharacters.find(c => c.name === mod.name);
                    if (!char) continue;

                    const fieldMap = {
                        '心情': 'mood',
                        '好感度': 'favorability',
                        '状态': 'status',
                        '描述': 'description',
                        '性别': 'gender',
                        '标签': 'tags',
                    };
                    const key = fieldMap[mod.field] || mod.field;

                    if (mod.field === '标签') {
                        char.tags = mod.value;
                    } else if (mod.field === '好感度') {
                        let cur = parseInt(char.favorability);
                        if (isNaN(cur)) cur = 0;
                        if (mod.op === '+') cur += mod.value;
                        else if (mod.op === '-') cur -= mod.value;
                        else cur = mod.value;
                        char.favorability = String(cur);
                    } else {
                        char[key] = mod.value;
                    }

                    window.CharacterRegistry.upsert(char, scene.name, true);

                    // ★ 新增：状态变化时刷新立绘
                    if (['心情', '状态', '标签'].includes(mod.field) &&
                        scene.name === CinemaWorld.ui.currentLocation) {
                        window.SpriteManager?.notifySceneSpriteUpdate(char.name);
                    }
                }
    
                // ==================== 移除人物 ====================
                for (const name of update.removeCharacters) {
                    const idx = scene.sceneCharacters.findIndex(c => c.name === name);
                    if (idx > -1) scene.sceneCharacters.splice(idx, 1);
                }
    
                // ==================== 新增物品 ====================
                for (const it of update.addItems) {
                    if (!scene.sceneItems.some(i => i.name === it.name)) {
                        scene.sceneItems.push(it);
                    }
                }
    
                // ==================== 移除物品 ====================
                for (const name of update.removeItems) {
                    const idx = scene.sceneItems.findIndex(i => i.name === name);
                    if (idx > -1) scene.sceneItems.splice(idx, 1);
                }
    
                // ==================== 修改物品 ====================
                for (const mod of update.modifyItems) {
                    const item = scene.sceneItems.find(i => i.name === mod.name);
                    if (!item) continue;
    
                    const fieldMap = {
                        '状态': 'status',
                        '描述': 'description',
                    };
                    const key = fieldMap[mod.field] || mod.field;
                    item[key] = mod.value;
                }
    
                // ==================== 新增行动 ====================
                for (const act of update.addActions) {
                    if (!scene.sceneActions.some(a => a.name === act.name)) {
                        scene.sceneActions.push(act);
                    }
                }
    
                // ==================== 移除行动 ====================
                for (const name of update.removeActions) {
                    const idx = scene.sceneActions.findIndex(a => a.name === name);
                    if (idx > -1) {
                        scene.sceneActions.splice(idx, 1);
                    }
                }
    
                // ==================== 场景状态栏 ====================
                for (const [key, value] of Object.entries(update.statusChanges)) {
                    scene.statusBar[key] = value;
                }
    
                console.log('[CinemaWorld] 场景更新完成');
    
                if (CinemaWorld.ui.currentLocation === scene.name) {
                    await window.SpriteManager.buildMapping(scene.sceneCharacters);
                    await window.SceneSpriteLayerManager.buildForScene(scene);
                    window.SceneAvatarBarManager.buildForScene(scene);
    
                    window.UIManager.updateWorldStateDisplay();
                    window.SceneActionManager.refresh();
                }
    
                if (window.SaveManager) window.SaveManager.save();
            },
    
            // ==================== 播放剧情 ====================
            async playStory(story) {
                const STORY_SCOPE = 'story';
                let storyMusicSet = false;

                try {
                    // ============================================================
                    // 1. 设置剧情音乐（在 VN 播放之前）
                    // ============================================================
                    if (story.music) {
                        await window.MusicManager.setScopedMusic(STORY_SCOPE, story.music);
                        storyMusicSet = true;
                    } else {
                        const markers = window.MusicManager.parseMusicMarkers(story.raw || '');
                        if (markers.length > 0) {
                            await window.MusicManager.setScopedMusic(STORY_SCOPE, markers[0]);
                            storyMusicSet = true;
                        }
                    }

                    // ============================================================
                    // 2. 播放 VN
                    // ============================================================
                    if (story.dialogues.length > 0) {
                        await window.VisualNovelManager.play(story.dialogues);
                    }

                    // ★ 标记已播放过（无论是自然播完还是被跳过）
                    story._played = true;

                    // ============================================================
                    // 3. 清掉剧情音乐
                    // ============================================================
                    if (storyMusicSet) {
                        await window.MusicManager.clearScopedMusic(STORY_SCOPE);
                        storyMusicSet = false;
                    }

                    // ============================================================
                    // 4. 场景切换（幂等）
                    // ============================================================
                    if (story.sceneSwitch && !story._sceneSwitchHandled) {
                        await this.handleSceneSwitch(story.sceneSwitch, story);
                        story._sceneSwitchHandled = true;
                    }

                    // ============================================================
                    // 5. 场景更新（幂等）
                    // ============================================================
                    if (story.sceneUpdates && story.sceneUpdates.length > 0) {
                        for (const update of story.sceneUpdates) {
                            if (update._movedToSwitch) continue;
                            if (update._applied) continue;      // ★ 已应用就跳过
                            await this.applySceneUpdate(update);
                            update._applied = true;             // ★ 打标记
                        }
                    }

                    // ============================================================
                    // 6. 全局效果（幂等）
                    // ============================================================
                    if (story.globalEffects && story.globalEffects.length > 0) {
                        for (let i = 0; i < story.globalEffects.length; i++) {
                            // ★ 用下标追踪，因为 globalEffects 里存的是字符串
                            if (!story._appliedEffects) story._appliedEffects = {};
                            if (story._appliedEffects[i]) continue;

                            const eff = story.globalEffects[i];
                            await new Promise(r => setTimeout(r, 300));
                            const results = window.EffectSystem.applyFromNarrative(eff);
                            const resultText = window.EffectSystem.formatResults(results);
                            if (resultText) await window.UIManager.showText(resultText, 3000);

                            story._appliedEffects[i] = true;
                        }
                    }

                    // ============================================================
                    // 7. 清除 pendingEvents
                    // ============================================================
                    if (CinemaWorld.worldState.pendingEvents) {
                        CinemaWorld.worldState.pendingEvents.forEach(e => {
                            if (!e.processed) e.processed = true;
                        });
                    }

                    // ============================================================
                    // 8. 选项 or 完成
                    // ============================================================
                    if (story.options.length === 0) {
                        await this.completeStory(story);
                    } else {
                        await this.showOptions(story);
                    }

                } catch (e) {
                    console.error('[CinemaWorld] playStory 出错:', e);
                    throw e;
                } finally {
                    if (storyMusicSet) {
                        try {
                            await window.MusicManager.clearScopedMusic(STORY_SCOPE);
                        } catch (err) {
                            console.warn('[CinemaWorld] 清理剧情音乐失败:', err);
                        }
                    }
                    if (window.SaveManager) window.SaveManager.save();
                }
            },
    
            // ==================== 显示选项 ====================
            async showOptions(story) {
                const modal = document.getElementById('cinemaworld-modal');
    
                let optionsHTML = '';
                story.options.forEach((o, i) => {
                    optionsHTML += `<div class="cinemaworld-option-item" onclick="StoryManager.selectOption('${story.id}', ${i})">
                        <span class="cinemaworld-option-key">${o.key}</span>
                        <span class="cinemaworld-option-text">${o.text}</span>
                    </div>`;
                });
    
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📖 ${story.title}</div>
                    <div style="margin-bottom:20px;color:#aaa;font-size:14px;text-align:center;">选择你的行动</div>
    
                    <div style="display:flex;flex-direction:column;gap:10px;">${optionsHTML}</div>
    
                    <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,.1);">
                        <div style="font-size:13px;color:#aaa;margin-bottom:8px;">
                            ✍️ 或者，自己决定要做什么：
                        </div>
                        <textarea class="cinemaworld-textarea" id="story-custom-option-input"
                            placeholder="例如：我决定什么都不做，静静观察他的反应。&#10;（输入内容不会触发数值变化，只会作为剧情上下文）"
                            style="min-height:80px;"></textarea>
                        <div style="text-align:center;margin-top:10px;">
                            <button class="cinemaworld-button primary"
                                onclick="StoryManager.submitCustomOption('${story.id}')">
                                ✅ 确认这个行动
                            </button>
                        </div>
                    </div>
    
                    <div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);">
                        <button class="cinemaworld-button" onclick="StoryManager.closeOptions('${story.id}')"
                            style="color:#d87d7d;border-color:rgba(216,125,125,.4);">
                            ✖ 关闭（暂不选择）
                        </button>
                    </div>
                `;
                modal.className = 'active';
    
                if (!document.getElementById('cinemaworld-option-styles')) {
                    const s = document.createElement('style');
                    s.id = 'cinemaworld-option-styles';
                    s.textContent = `
                        .cinemaworld-option-item{padding:16px 20px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:15px;}
                        .cinemaworld-option-item:hover{background:rgba(120,150,255,.15);border-color:rgba(120,150,255,.4);transform:translateX(5px);}
                        .cinemaworld-option-key{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-weight:bold;color:#fff;flex-shrink:0;}
                        .cinemaworld-option-text{font-size:14px;color:#e0e0e0;line-height:1.5;}
                    `;
                    document.head.appendChild(s);
                }
            },
    
            async submitCustomOption(storyId) {
                const story = this.storyList.find(s => s.id === storyId);
                if (!story) return;
    
                const input = document.getElementById('story-custom-option-input')?.value.trim();
                if (!input) {
                    alert('请输入你想做的事');
                    return;
                }
    
                story.chosenOption = {
                    key: 'CUSTOM',
                    text: input,
                    custom: true,
                    applied: true,
                    timestamp: Date.now(),
                };
    
                window.UIManager.closeModal();
    
                await window.UIManager.showText(`你的行动：${input}`, 2000);
    
                if (this.currentChapter) {
                    this.currentChapter.events.push({
                        type: 'custom-choice',
                        storyId: story.id,
                        choice: input,
                        summary: `自定义行动: ${input}`,
                        timestamp: Date.now(),
                    });
                }
    
                await window.MusicManager.clearOverrideMusic();
                await this.completeStory(story);
                if (window.SaveManager) window.SaveManager.save();
            },
    
            async closeOptions(storyId) {
                const story = this.storyList.find(s => s.id === storyId);
                if (!story) return;
    
                window.UIManager.closeModal();
                await window.UIManager.showText('已暂缓选择，可稍后从剧情列表继续', 2000);
            },
    
            // ==================== 选择选项 ====================
            async selectOption(storyId, optionIndex) {
                const story = this.storyList.find(s => s.id === storyId);
                if (!story) return;
                if (story.chosenOption) {
                    alert('这个剧情已经做选择了');
                    window.UIManager.closeModal();
                    return;
                }
                const opt = story.options[optionIndex];
                if (!opt) return;
    
                story.chosenOption = {
                    key: opt.key,
                    text: opt.text,
                    applied: true,
                    timestamp: Date.now(),
                };
    
                window.UIManager.closeModal();
    
                await window.UIManager.showText(`你选择了：${opt.key}. ${opt.text}`, 2000);
    
                if (opt.effectText) {
                    await new Promise(r => setTimeout(r, 300));
                    const results = window.EffectSystem.applyFromNarrative(opt.effectText);
                    const resultText = window.EffectSystem.formatResults(results);
                    if (resultText) await window.UIManager.showText(resultText, 3500);
                }
    
                if (opt.sceneSwitch) {
                    await new Promise(r => setTimeout(r, 300));
                    await this.handleSceneSwitch(opt.sceneSwitch, story);
                }
    
                if (this.currentChapter) {
                    this.currentChapter.events.push({
                        type: 'choice',
                        storyId: story.id,
                        choice: `${opt.key}. ${opt.text}`,
                        summary: `选择了: ${opt.text}`,
                        timestamp: Date.now(),
                    });
                }
    
                await window.MusicManager.clearOverrideMusic();
                await this.completeStory(story);
                if (window.SaveManager) window.SaveManager.save();
            },
    
            // ==================== 完成剧情卡 ====================
            async completeStory(story) {
                story.status = 'completed';
                story.completedAt = Date.now();
    
                if (this.currentChapter) {
                    this.currentChapter.events.push({
                        type: 'story-complete',
                        storyId: story.id,
                        title: story.title,
                        summary: `完成剧情: ${story.title}`,
                        timestamp: Date.now(),
                    });
                }
    
                await window.UIManager.showText(`📖 ${story.title} - 完成`, 2000);
                await window.MusicManager.clearOverrideMusic();
    
                try {
                    await ChapterManager.tryCompactChapter();
                } catch (e) {
                    console.error('[CinemaWorld] 章内压缩失败:', e);
                }
    
                try {
                    await this.maybeRollOverChapter();
                } catch (e) {
                    console.error('[CinemaWorld] 章节滚动失败:', e);
                }
    
                if (window.SaveManager) window.SaveManager.save();
            },
    
            async maybeRollOverChapter() {
                const ch = StoryManager.currentChapter;
                if (!ch) return false;
            
                const ROLLOVER_THRESHOLD = 8;
            
                const activeCount = StoryManager.storyList.filter(
                    s => s.chapterId === ch.id
                      && s.status === 'completed'
                      && s.order > (ch.compactUntilOrder || 0)
                ).length;
            
                if (activeCount < ROLLOVER_THRESHOLD) return false;
            
                console.log(`[CinemaWorld] 本章完成 ${activeCount} 段剧情，触发滚动`);
                await window.UIManager.showText('本章告一段落，正在开启新章...', 2000);
            
                // 记下当前章 id，用于判断 endChapter 有没有自动建新章
                const oldChapterId = ch.id;
            
                await this.endChapter();
            
                // ★ 如果 endChapter 内部没建新章（卷没满的情况），这里补建
                if (StoryManager.currentChapter?.id === oldChapterId
                    || !StoryManager.currentChapter) {
                    await ChapterManager.createChapter(`第${StoryManager.chapters.length + 1}章`);
                }
            
                await window.UIManager.showText('新的章节开始了', 1500);
                return true;
            },
    
            // ==================== 章节结束（转发到 ChapterManager） ====================
            async endChapter() {
                return await ChapterManager.endChapter();
            },
    
            // ==================== 场景切换 ====================
            async handleSceneSwitch(sw, sourceStory) {
                if (!sw || !sw.targetScene) return;
            
                if (sw.targetScene === CinemaWorld.ui.currentLocation) {
                    console.log('[CinemaWorld] 场景切换目标即当前场景，跳过');
                    return;
                }
            
                await window.UIManager.showText(`正在进入【${sw.targetScene}】...`, 1500);
            
                // ★ 关键：切场景前，清掉剧情的 override
                //   让新场景音乐有机会接管
                await window.MusicManager.clearScopedMusic('story');
            
                let scene = WorldManager.findEntity(sw.targetScene);
            
                if (!scene) {
                    const generated = await this.generateSceneFromSwitch(sw, sourceStory);
                    await this.openSceneSwitchConfirm(sw, generated, sourceStory);
                    return;
                }
            
                await this.doApplySwitch(sw, scene, sourceStory);
            },
    
            async doApplySwitch(sw, scene, sourceStory) {
                if (sw.characters?.length || sw._presetCharacters?.length) {
                    const charObjs = sw._presetCharacters
                        || sw.characters.map(name => ({ name, type: 'character', description: '', tags: [] }));
                    scene.sceneCharacters = scene.sceneCharacters || [];
                    for (const c of charObjs) {
                        const existing = scene.sceneCharacters.find(x => x.name === c.name);
                        if (existing) Object.assign(existing, c);
                        else scene.sceneCharacters.push(c);
                    }
                }
                if (sw.items?.length || sw._presetItems?.length) {
                    const itemObjs = sw._presetItems
                        || sw.items.map(name => ({ name, type: 'item', description: '', status: '' }));
                    scene.sceneItems = scene.sceneItems || [];
                    for (const it of itemObjs) {
                        const existing = scene.sceneItems.find(x => x.name === it.name);
                        if (existing) Object.assign(existing, it);
                        else scene.sceneItems.push(it);
                    }
                }
    
                CinemaWorld.ui.currentLocation = scene.name;
                window.LocationModalManager.currentLocation = scene;
    
                if (scene.background) await window.BackgroundManager.apply(scene.background);
                else await window.BackgroundManager.apply(scene.name);
                if (scene.music) await window.MusicManager.setSceneMusic(scene.music);
                else window.MusicManager.setSceneMusic(null);
    
                await window.SceneSpriteLayerManager.buildForScene(scene);
                window.SceneAvatarBarManager.buildForScene(scene);
    
                // ★ 修复：切换到新场景后刷新行动栏
                //    先收起旧场景残留的展开状态，再重新渲染
                if (typeof window.SceneActionManager !== 'undefined') {
                    window.SceneActionManager.collapse();
                    window.SceneActionManager.refresh();
                }
    
                window.UIManager.createFloatingButtons();
                window.UIManager.updateWorldStateDisplay();
                await window.UIManager.showText(`已进入【${scene.name}】`, 1500);
    
                if (this.currentChapter && sourceStory) {
                    this.currentChapter.events.push({
                        type: 'scene-switch',
                        storyId: sourceStory.id,
                        from: sourceStory.scene,
                        to: sw.targetScene,
                        reason: sw.reason,
                        summary: `切换到: ${sw.targetScene}`,
                        timestamp: Date.now(),
                    });
                }
    
                if (CinemaWorld.worldState.pendingUpdates?.length) {
                    const stillPending = [];
                    for (const upd of CinemaWorld.worldState.pendingUpdates) {
                        if (upd.sceneName === scene.name) {
                            await this.applySceneUpdate(upd);
                        } else {
                            stillPending.push(upd);
                        }
                    }
                    CinemaWorld.worldState.pendingUpdates = stillPending;
                }
            },
    
            async generateSceneFromSwitch(sw, sourceStory = null) {
                const presetChars = sw._presetCharacters || (sw.characters || []).map(c => ({ name: c }));
                const presetItems = sw._presetItems || (sw.items || []).map(i => ({ name: i }));
    
                const ctxParts = [];
    
                const wh = CinemaWorld.worldState.worldHistory;
                if (wh?.summary) {
                    ctxParts.push(`【世界史】${wh.summary}`);
                }
    
                const fromScene = window.LocationModalManager.currentLocation;
                if (fromScene) {
                    let s = `【玩家离开的场景】${fromScene.name}`;
                    if (fromScene.description) s += `\n描述：${fromScene.description}`;
                    if (fromScene.environment) s += `\n环境：${fromScene.environment}`;
                    ctxParts.push(s);
                }
    
                if (sourceStory) {
                    const storyParts = [];
                    storyParts.push(`标题：${sourceStory.title}`);
                    if (sourceStory.type) storyParts.push(`类型：${sourceStory.type}`);
                    if (sourceStory.summary) {
                        storyParts.push(`\n【剧情摘要】\n${sourceStory.summary}`);
                    }
    
                    if (sourceStory.dialogues?.length) {
                        const dialogueText = sourceStory.dialogues
                            .slice(-20)
                            .map(d => {
                                if (['旁白', '系统'].includes(d.character)) {
                                    return `【旁白】${d.content}`;
                                }
                                return `【${d.character}】${d.content}`;
                            })
                            .join('\n');
                        storyParts.push(`\n【剧情对话节选】\n${dialogueText}`);
                    }
    
                    if (sourceStory.chosenOption) {
                        storyParts.push(`\n【玩家选择】${sourceStory.chosenOption.text}`);
                    }
    
                    ctxParts.push(`【本段剧情】\n${storyParts.join('\n')}`);
                }
    
                if (sw.reason) {
                    ctxParts.push(`【进入此场景的原因】${sw.reason}`);
                }
    
                const playerName = PlayerStateManager.player.name || '主人公';
                const playerProfile = PlayerStateManager.player.profile || '';
    
                let playerBlock = `【玩家设定】\n名字：${playerName}\n`;
                playerBlock += playerProfile ? playerProfile + '\n' : '（无特别设定）\n';
    
                const playerBlock2 = PlayerStateManager.formatForPrompt();
    
                if (playerBlock2) {
                    playerBlock += `\n【玩家状态】\n${playerBlock2}\n`;
                }
    
                ctxParts.push(playerBlock2);
    
                const charLines = presetChars.length > 0
                    ? presetChars.map(c => {
                        const meta = [c.name, c.gender || '', c.mood || '', c.favorability || '', c.status || ''].join('|');
                        const desc = c.description || '';
                        const tags = c.tags?.length ? `，[${c.tags.join('、')}]` : '';
                        return `- 【${meta}】：${desc}${tags}`;
                    }).join('\n')
                    : '（无）';
                const worldCtx = this.buildContext(null, { mainChars: false, scene: false, pendingEvents: false, volumes: true, interactionDigests: false });
                const itemLines = presetItems.length > 0
                    ? presetItems.map(i => {
                        const status = i.status ? `，(${i.status})` : '';
                        return `- 【${i.name}】：${i.description || ''}${status}`;
                    }).join('\n')
                    : '（无）';
    
                    const prompt = `你是视觉小说剧本作家。玩家正从上一段剧情进入一个新场景，请根据剧情上下文生成这个场景的完整设定。

${worldCtx}

===== 剧情上下文 =====
${ctxParts.join('\n\n')}

===== 新场景信息 =====
场景名：${sw.targetScene}

以下人物/实体**必须出现在新场景中**（可补充描述，不要删除）：
【人物】
${charLines}

【实体】
${itemLines}

===== 输出格式（严格遵守）=====

【${sw.targetScene}】
描述：(结合剧情上下文，写玩家为什么来这里、这里什么氛围)
环境：(环境特征)
环境数据:[时间:X|天气:X|温度:X|风力:X|湿度:X|...]
背景：(中文图片名，简短，如"教室"、"地下通道")
🎵 音乐：(曲名，如"神秘"、"紧张"、"温馨")

场景人物：
- 【名|性别|心情|好感度|状态|主次】：描述，[标签1、标签2]

场景实体：
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|其他]
物品: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|其他]
装备: 
- 【名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|库存:X|属性:X|属性:Y]

★ 特殊实体类型（用专用字段）：
经营:
 - 【名|图标】：描述，[类型:经营|经营类型:农田/牧场/商店/工厂/矿场/鱼塘|其他字段]
商店: 
- 【名|图标】：描述，[类型:商店|货币:金币|收购:是|其他字段]
（场景氛围适合时，主动生成 1 个）

场景行动：
- 【行动名|图标|once】：能做什么
- 【行动名|图标|repeat】：能做什么
（2-5 个，玩家可主动做的事，不重复场景角色/实体的交互。
    once=一次性，repeat=可重复。没有就不写）

===== 格式规则 =====

1. 人物行（5 字段 | 分隔，顺序固定）：
    【名|性别|心情|好感度|状态】：描述，[标签]
    - 好感度必须是纯数字（0、50、-10）
    - 状态是简短短语（"排练中"），不能带冒号或方括号
    - 主次填"主要/次要/路人"，追加在最后：
        【名|性别|心情|好感度|状态|主次】：描述，[标签]
    - 正确：- 【如月梅|女|冷静|0|排练中|次要】：淡粉长发，[队长、完美主义]
    - ❌ 错误：- 【如月梅|女|冷静|好感度+15|状态：排练中】：...（带了前缀/冒号）

2. 实体行（方括号内 键:值，| 分隔）：
    - 【名|图标】：描述，[类型|状态|功能|交互方式|图标|其他]
    - 字段顺序不固定，没有的字段省略
    - 图标只填一个 emoji，不要文字
    - 实体可以是物品/建筑/植物/家具/机关/载具/自然物等

3. 装备类实体须带属性字段：
    - 【名|图标】：描述，[类型:武器|攻击:+3|图标:⚔️]
    - 属性值格式：数字 / ±数字 / 数字%（如 +5、-3、+10%）
    - 非属性字段（类型/状态/图标/交互方式）不会被当成加成

4. 描述要结合剧情上下文，让场景自然承接上一段剧情
5. 场景人物 1-5 个（含必须出现的），场景实体 1-5 个
6. 背景/音乐用简短中文

请开始生成：
`;
    
                const result = await window.generateFunctionalReply(prompt, 'scene-from-story');
                return result || `【${sw.targetScene}】\n描述：(新场景)\n环境：(待探索)`;
            },
    
            // ==================== 构建上下文 ====================
            buildContext(parentStory = null, options = {}) {
                const opt = {
                    world:              true,
                    worldHistory:       true,
                    volumes:            true,
                    chapters:           true,
                    chapter:            true,
                    parentStory:        true,
                    interactionDigests: true,
                    scene:              true,
                    mainChars:          true,
                    pendingEvents:      true,
                    ...options,
                };
    
                const digestFilter = opt.digestFilter || {};
    
                let ctx = '';
    
                // ========== 第 0 层：世界 + 世界史 ==========
                if (opt.world || opt.worldHistory) {
                    if (opt.world) ctx += `【世界】\n`;
                    const wh = CinemaWorld.worldState.worldHistory;
                    if (opt.worldHistory && wh.summary) {
                        ctx += `【世界史】${wh.summary}\n`;
                    }
                }
    
                const chapter = this.currentChapter;
                const volume = chapter ? ChapterManager.getVolume(chapter.volumeId) : this.currentVolume;
    
                // ========== 第 1 层：更早的卷摘要 ==========
                if (opt.volumes) {
                    const pastVolumes = this.volumes.filter(v => v.summary && !v.archived && v !== volume);
                    if (pastVolumes.length > 0) {
                        ctx += `【过往篇章】\n`;
                        pastVolumes.slice(-2).forEach(v => {
                            ctx += `▶ ${v.title}\n${v.summary}\n\n`;
                        });
                    }
                }
    
                // ========== 第 2 层：前情提要 ==========
                if (opt.chapters) {
                    const pastChapters = this.chapters.filter(c => c.summary && c !== chapter);
                    if (pastChapters.length > 0) {
                        ctx += `【前情提要】\n`;
    
                        const currentVolumeChapters = volume
                            ? pastChapters.filter(c => c.volumeId === volume.id)
                            : [];
                        const earlierChapters = pastChapters.filter(c => c.volumeId !== volume?.id);
    
                        currentVolumeChapters.forEach(c => {
                            ctx += `▶ ${c.title}\n${c.summary}\n`;
                        });
                        earlierChapters.slice(-2).forEach(c => {
                            ctx += `▶ ${c.title}\n${c.summary}\n`;
                        });
                        ctx += '\n';
                    }
                }
    
                // ========== 第 3 层：当前章节的剧情卡 ==========
                if (opt.chapter && chapter) {
                    ctx += `【当前章节】${chapter.title}\n`;
    
                    if (chapter.compactSummary) {
                        ctx += `【本章前情】${chapter.compactSummary}\n\n`;
                    }
    
                    const chapterStories = this.storyList
                        .filter(s => s.chapterId === chapter.id && s.summary && s.order > (chapter.compactUntilOrder || 0))
                        .sort((a, b) => a.order - b.order);
    
                    if (chapterStories.length > 0) {
                        ctx += `【本章剧情明细】\n`;
                        chapterStories.forEach(s => {
                            ctx += `▶ ${s.title}\n${s.summary}\n`;
                            if (s.chosenOption) {
                                ctx += `玩家选择: ${s.chosenOption.text}\n`;
                            }
                            ctx += '\n';
                        });
                    }
                }
                // ========== 第 3.5 层：本章最后一段剧情（自动补充）==========
                if (opt.chapter && chapter && !parentStory) {
                    const lastCompleted = this.storyList
                        .filter(s => s.chapterId === chapter.id
                                    && s.status === 'completed'
                                    && s.order > (chapter.compactUntilOrder || 0))
                        .sort((a, b) => (b.order || 0) - (a.order || 0))[0];

                    if (lastCompleted) {
                        ctx += `\n【最近的剧情进展】\n`;
                        ctx += `标题: ${lastCompleted.title}\n`;
                        if (lastCompleted.summary) ctx += `摘要: ${lastCompleted.summary}\n`;
                        if (lastCompleted.chosenOption) {
                            ctx += `玩家选择: ${lastCompleted.chosenOption.text}\n`;
                        }
                    }
                }
                // ========== 第 4 层：前驱剧情 ==========
                if (opt.parentStory && parentStory) {
                    ctx += `\n【本剧情的上一步】\n`;
                    ctx += `标题: ${parentStory.title}\n`;
                    if (parentStory.summary) ctx += `摘要: ${parentStory.summary}\n`;
                    if (parentStory.chosenOption) {
                        ctx += `玩家选择: ${parentStory.chosenOption.text}\n`;
                    }
                }
    
                // ========== 第 5 层：当前场景 ==========
                if (opt.scene) {
                    const scene = window.LocationModalManager.currentLocation;
                    if (scene) {
                        ctx += `\n【当前场景】\n名称: ${scene.name}\n`;
                        if (scene.description) ctx += `描述: ${scene.description}\n`;
                        if (scene.environment) ctx += `环境: ${scene.environment}\n`;
                        if (scene.sceneCharacters?.length) {
                            ctx += `场景人物: ${scene.sceneCharacters.map(c => `${c.name}(${c.gender || '?'})`).join('、')}\n`;
                        }
                        if (scene.sceneItems?.length) {
                            ctx += `场景实体: ${scene.sceneItems.map(i => i.name).join('、')}\n`;
                        }
                    }
                }
    
                // ========== 第 6.5 层：主要角色名册 ==========
                if (opt.mainChars) {
                    const mainCharacters = window.CharacterRegistry.getMainCharacters();
                    if (mainCharacters.length > 0) {
                        ctx += `\n【主要角色名册】\n`;
                        ctx += `（这些是贯穿主线的核心角色。他们可以不在当前场景中，但主线剧情可以通过通讯、回忆、提及、突然出现等方式让他们参与。）\n`;
                        mainCharacters.forEach(c => {
                            const parts = [];
                            if (c.gender) parts.push(c.gender);
                            if (c.favorability) parts.push(`好感度:${c.favorability}`);
                            if (c.mood) parts.push(`心情:${c.mood}`);
                            if (c.lastScene) parts.push(`最近位置:${c.lastScene}`);
                            ctx += `  · ${c.name}（${parts.join('，')}）`;
                            if (c.description) ctx += `：${c.description}`;
                            ctx += '\n';
                        });
                        ctx += '\n★ 主线剧情可以让这些角色远程登场（如发来通讯、被提及、突然出现），不限于当前场景。\n';
                    }
                }
    
                // ========== 待处理事件 ==========
                if (opt.pendingEvents) {
                    const pendingEvents = CinemaWorld.worldState.pendingEvents?.filter(e => !e.processed) || [];
                    if (pendingEvents.length > 0) {
                        ctx += `\n【待处理事件】（这些事件刚发生，剧情需要自然衔接）\n`;
                        pendingEvents.forEach(e => {
                            ctx += `  · ${e.name}：${e.detail || ''}\n`;
                        });
                        ctx += '\n★ 请在剧情中自然地反映这些事件，处理完后标记为已处理。\n';
                    }
                }
    
                // ========== 第 7 层：本章交互摘要 ==========
                if (opt.interactionDigests) {
                    const chapterId = this.currentChapter?.id;
                    if (chapterId) {
                        const digestText = InteractionDigestManager.formatChapterDigests(chapterId, digestFilter);
                        if (digestText) {
                            ctx += `\n【本章交互历史】\n${digestText}\n`;
                        }
                    }
                }
    
                return ctx;
            },
    
            // ==================== 剧情列表 ====================
            openStoryList() {
                const scene = window.LocationModalManager.currentLocation;
                const modal = document.getElementById('cinemaworld-modal');
    
                if (!scene) {
                    modal.innerHTML = `<div class="cinemaworld-modal-title">📚 剧情列表</div>
                        <div style="text-align:center;padding:40px 20px;color:#888;">
                            <div style="font-size:40px;margin-bottom:15px;">📍</div>
                            <div>请先进入一个场景</div>
                        </div>
                        <div style="text-align:center;margin-top:20px;">
                            <button class="cinemaworld-button primary" onclick="LocationModalManager.openLocationBrowser()">📍 选择场景</button>
                            <button class="cinemaworld-button" onclick="UIManager.closeModal()">取消</button>
                        </div>`;
                    modal.className = 'active';
                    return;
                }
    
                const chapter = this.currentChapter;
                if (!chapter) {
                    modal.innerHTML = `<div class="cinemaworld-modal-title">📚 剧情列表</div>
                        <div style="text-align:center;padding:40px;color:#888;">当前没有章节</div>
                        <div style="text-align:center;margin-top:20px;">
                            <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                        </div>`;
                    modal.className = 'active';
                    return;
                }
    
                const stories = this.storyList
                    .filter(s => s.chapterId === chapter.id)
                    .sort((a, b) => a.order - b.order);
    
                const completedCount = stories.filter(s => s.status === 'completed').length;
                const ROLLOVER_THRESHOLD = 8;
    
                if (stories.length === 0) {
                    modal.innerHTML = `
                        <div class="cinemaworld-modal-title">📚 ${chapter.title}</div>
                        <div style="text-align:center;padding:40px;color:#888;">本章暂无剧情</div>
                        <div style="text-align:center;margin-top:20px;">
                            <button class="cinemaworld-button primary" onclick="StoryManager.createStory()">➕ 创建新剧情</button>
                            <button class="cinemaworld-button" onclick="StoryManager.openChapterList()">📚 查看所有章节</button>
                            <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                        </div>`;
                    modal.className = 'active';
                    return;
                }
    
                if (this._listIndex === undefined) this._listIndex = stories.length - 1;
                if (this._listIndex >= stories.length) this._listIndex = stories.length - 1;
                if (this._listIndex < 0) this._listIndex = 0;
    
                const cur = stories[this._listIndex];
                const statusMap = {
                    completed: { text: '✅ 已完成', color: '#7dd87d' },
                    active: { text: '▶️ 进行中', color: '#d8c07d' },
                };
                const st = statusMap[cur.status] || { text: cur.status, color: '#888' };
    
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📚 ${chapter.title}</div>
                    <div style="text-align:center;margin-bottom:15px;">
                        <div style="font-size:12px;color:#888;margin-bottom:6px;">
                            本章进度：${completedCount} / ${ROLLOVER_THRESHOLD} 段剧情
                        </div>
                        <div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;">
                            <div style="width:${Math.min(100, completedCount / ROLLOVER_THRESHOLD * 100)}%;
                                height:100%;background:linear-gradient(90deg,#667eea,#764ba2);border-radius:2px;"></div>
                        </div>
                    </div>
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
                        <button class="cinemaworld-button" onclick="StoryManager.navStory(-1)" 
                            style="min-width:40px;padding:8px 12px;">←</button>
                        <div style="flex:1;text-align:center;color:#aaa;font-size:13px;">
                            ${this._listIndex + 1} / ${stories.length}
                        </div>
                        <button class="cinemaworld-button" onclick="StoryManager.navStory(1)" 
                            style="min-width:40px;padding:8px 12px;">→</button>
                    </div>
                    
                    <div style="background:rgba(255,255,255,.05);border-radius:12px;padding:20px;margin-bottom:15px;">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                            <div style="font-size:17px;font-weight:bold;color:#fff;flex:1;">📖 ${cur.title}</div>
                            <div style="font-size:12px;color:${st.color};margin-left:10px;">${st.text}</div>
                        </div>
                        <div style="font-size:12px;color:#888;margin-bottom:8px;">
                            类型: ${cur.type} · 场景: ${cur.scene || '未知'}
                            ${cur.chapterId ? ` · 章节: ${this.chapters.find(c => c.id === cur.chapterId)?.title || '?'}` : ''}
                        </div>
                        ${cur.chosenOption ? `
                            <div style="font-size:13px;color:#aaa;margin-top:8px;padding:8px;background:rgba(120,150,255,.1);border-radius:6px;">
                                <span style="color:#7da8ff;">你的选择：</span>${cur.chosenOption.text}
                            </div>
                        ` : ''}
                        ${cur.status === 'active' ? `
                            <div style="font-size:13px;color:#d8c07d;margin-top:8px;">
                                ⚠️ 此剧情尚未完成
                            </div>
                        ` : ''}
                    </div>
                    
                    <div style="text-align:center;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
                        <button class="cinemaworld-button primary" onclick="StoryManager.continueFromCard('${cur.id}')">
                            ▶️ 继续剧情
                        </button>
                        <button class="cinemaworld-button" onclick="StoryManager.viewStoryDetail('${cur.id}')">
                            🔍 查看详情
                        </button>
                        <button class="cinemaworld-button" onclick="StoryManager.createStory()">
                            ➕ 新剧情
                        </button>
                        <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                    </div>
                    <div style="text-align:center;margin-top:15px;">
                        <button class="cinemaworld-button" onclick="StoryManager.openChapterList()">📚 所有章节</button>
                    </div>
                    `;
                modal.className = 'active';
            },
    
            openSceneSwitchConfirm(sw, generatedText, sourceStory) {
                return new Promise((resolve) => {
                    const modal = document.getElementById('cinemaworld-modal');
                    modal.innerHTML = `
                        <div class="cinemaworld-modal-title">🚪 即将进入新场景</div>
                        <div style="margin-bottom:12px;padding:10px;background:rgba(120,150,255,.1);border-radius:8px;font-size:13px;">
                            <div>📍 目标场景：<span style="color:#7da8ff;font-weight:bold;">${sw.targetScene}</span></div>
                            ${sw.reason ? `<div style="color:#aaa;margin-top:4px;">原因：${sw.reason}</div>` : ''}
                        </div>
                        <div style="margin-bottom:12px;">
                            <div style="font-size:13px;color:#aaa;margin-bottom:5px;">
                                场景内容（可编辑。确认后才会创建并进入）：
                            </div>
                            <textarea class="cinemaworld-textarea" id="scene-switch-edit-input" 
                                style="min-height:340px;">${generatedText}</textarea>
                        </div>
                        <div style="font-size:12px;color:#888;margin-bottom:15px;line-height:1.6;">
                            💡 提示：可以修改"背景"为本地实际存在的图片名，
                            把人物"性别: 未知"改成"男/女"，
                            补全心情、好感度等字段。
                        </div>
                        <div style="text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                            <button class="cinemaworld-button primary" 
                                onclick="StoryManager.confirmSceneSwitch('${sw.targetScene}', '${sourceStory?.id || ''}')">
                                ✅ 确认进入
                            </button>
                            <button class="cinemaworld-button" onclick="StoryManager.regenerateSceneSwitch()">🔄 重新生成</button>
                            <button class="cinemaworld-button" 
                                onclick="StoryManager.cancelSceneSwitch('${sw.targetScene}')">
                                ✖ 取消切换
                            </button>
                        </div>`;
                    modal.className = 'active';
    
                    this._pendingSwitch = sw;
                    this._pendingSourceStory = sourceStory;
                    this._switchResolve = resolve;
                });
            },
    
            async confirmSceneSwitch(targetName, sourceStoryId) {
                const text = document.getElementById('scene-switch-edit-input').value.trim();
                if (!text) { alert('场景内容不能为空'); return; }
    
                const sw = this._pendingSwitch;
                const sourceStory = this._pendingSourceStory;
                this._pendingSwitch = null;
                this._pendingSourceStory = null;
    
                window.UIManager.closeModal();
    
                let scene = WorldManager.addScene(text);
                if (!scene) {
                    alert('场景创建失败');
                    if (this._switchResolve) { this._switchResolve(); this._switchResolve = null; }
                    return;
                }
    
                if (scene.name !== targetName) {
                    console.log(`[CinemaWorld] 场景名对齐: ${scene.name} → ${targetName}`);
                    scene.name = targetName;
                }
    
                if (sw) {
                    const charObjs = sw._presetCharacters || [];
                    const itemObjs = sw._presetItems || [];
                    scene.sceneCharacters = scene.sceneCharacters || [];
                    scene.sceneItems = scene.sceneItems || [];
                    for (const c of charObjs) {
                        if (!scene.sceneCharacters.some(x => x.name === c.name)) {
                            scene.sceneCharacters.push(c);
                        }
                    }
                    for (const it of itemObjs) {
                        if (!scene.sceneItems.some(x => x.name === it.name)) {
                            scene.sceneItems.push(it);
                        }
                    }
                }
    
                await this.doApplySwitch(sw || {}, scene, sourceStory);
                if (window.SaveManager) window.SaveManager.save();
    
                if (this._switchResolve) {
                    this._switchResolve();
                    this._switchResolve = null;
                }
            },
    
            async regenerateSceneSwitch() {
                if (!this._pendingSwitch) return;
                await window.UIManager.showText('重新生成中...', 1000);
                const generated = await this.generateSceneFromSwitch(this._pendingSwitch);
                document.getElementById('scene-switch-edit-input').value = generated;
            },
    
            async cancelSceneSwitch(targetName) {
                this._pendingSwitch = null;
                this._pendingSourceStory = null;
                window.UIManager.closeModal();
                await window.UIManager.showText(`取消了前往【${targetName}】`, 1500);
    
                if (this._switchResolve) {
                    this._switchResolve();
                    this._switchResolve = null;
                }
            },
    
            navStory(delta) {
                if (this._listIndex === undefined) this._listIndex = 0;
                this._listIndex = Math.max(0, Math.min(this.storyList.length - 1, this._listIndex + delta));
                this.openStoryList();
            },
    
            async continueFromCard(storyId) {
                const story = this.storyList.find(s => s.id === storyId);
                if (!story) return;
                window.UIManager.closeModal();
    
                if (story.status === 'active') {
                    await this.playStory(story);
                } else {
                    await this.createStory('', story);
                }
            },
    
            viewStoryDetail(storyId) {
                const s = this.storyList.find(x => x.id === storyId);
                if (!s) return;
                const modal = document.getElementById('cinemaworld-modal');
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📖 ${s.title}</div>
                    <div style="margin-bottom:20px;">
                        <div style="font-size:13px;color:#aaa;margin-bottom:10px;">
                            类型: ${s.type} · 状态: ${s.status} · 序号: ${s.order}
                        </div>
                        <div style="font-size:13px;line-height:1.8;color:#ccc;padding:15px;background:rgba(0,0,0,.2);border-radius:8px;max-height:400px;overflow-y:auto;">
                            ${(s.raw || '').replace(/\n/g, '<br>')}
                        </div>
                    </div>
                    <div style="text-align:center;">
                        <button class="cinemaworld-button" onclick="StoryManager.deleteStory('${storyId}')">🗑️ 删除</button>
                        <button class="cinemaworld-button" onclick="StoryManager.openStoryList()">返回列表</button>
                        <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                    </div>`;
            },
    
            deleteStory(storyId) {
                if (!confirm('确定删除？')) return;
                const i = this.storyList.findIndex(s => s.id === storyId);
                if (i > -1) this.storyList.splice(i, 1);
                if (this._listIndex >= this.storyList.length) {
                    this._listIndex = Math.max(0, this.storyList.length - 1);
                }
                if (window.SaveManager) window.SaveManager.save();
                this.openStoryList();
            },
    
            openChapterList() {
                const modal = document.getElementById('cinemaworld-modal');
                let html = `<div class="cinemaworld-modal-title">📚 章节列表</div>`;
    
                const wh = CinemaWorld.worldState.worldHistory;
                if (wh.summary) {
                    html += `
                        <div style="margin-bottom:15px;padding:12px;background:rgba(120,80,180,.15);
                             border:1px solid rgba(120,80,180,.3);border-radius:10px;">
                            <div style="font-size:13px;color:#b890ff;margin-bottom:6px;">📜 世界史</div>
                            <div style="font-size:12px;color:#ccc;line-height:1.6;">${wh.summary}</div>
                        </div>`;
                }
    
                if (this.volumes.length === 0) {
                    html += `<div style="text-align:center;padding:40px;color:#888;">暂无章节</div>`;
                } else {
                    html += `<div style="display:grid;gap:15px;max-height:500px;overflow-y:auto;">`;
    
                    this.volumes.forEach(volume => {
                        const isCurrentVolume = volume === this.currentVolume;
                        const chapters = this.chapters.filter(c => c.volumeId === volume.id);
                        const summarizedCount = chapters.filter(c => c.summary).length;
                        const VOLUME_SIZE = ChapterManager.VOLUME_SIZE;
    
                        html += `
                            <div style="background:${isCurrentVolume ? 'rgba(120,150,255,.1)' : 'rgba(255,255,255,.03)'};
                                 border:1px solid ${isCurrentVolume ? 'rgba(120,150,255,.35)' : 'rgba(255,255,255,.08)'};
                                 border-radius:12px;padding:14px;">
                                <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
                                    <div style="font-size:15px;font-weight:bold;color:#fff;">
                                        📖 ${volume.title}
                                        ${volume.archived ? '<span style="font-size:11px;color:#888;margin-left:6px;">[已归档]</span>' : ''}
                                    </div>
                                    ${isCurrentVolume ? `
                                        <span style="color:#7da8ff;font-size:12px;">
                                            ${summarizedCount}/${VOLUME_SIZE} 章
                                        </span>
                                    ` : ''}
                                </div>
                                ${volume.summary ? `
                                    <div style="font-size:12px;color:#aaa;line-height:1.6;margin-bottom:10px;
                                         padding:8px;background:rgba(0,0,0,.2);border-radius:6px;">
                                        ${volume.summary}
                                    </div>
                                ` : ''}
                                <div style="display:grid;gap:6px;">`;
    
                        chapters.forEach(c => {
                            const isCurrent = c === this.currentChapter;
                            const storyCount = StoryManager.storyList.filter(s => s.chapterId === c.id).length;
                            html += `
                                <div style="padding:10px;background:${isCurrent ? 'rgba(120,150,255,.15)' : 'rgba(255,255,255,.03)'};
                                     border-radius:6px;font-size:12px;
                                     cursor:pointer;transition:all .2s;"
                                     onclick="ChapterManager.viewChapterStories('${c.id}')"
                                     onmouseover="this.style.background='rgba(120,150,255,.1)'"
                                     onmouseout="this.style.background='${isCurrent ? 'rgba(120,150,255,.15)' : 'rgba(255,255,255,.03)'}'">
                                    <div style="display:flex;justify-content:space-between;">
                                        <span style="color:${isCurrent ? '#7da8ff' : '#ccc'};">${c.title}</span>
                                        <span style="color:#666;font-size:11px;">${storyCount}段剧情</span>
                                    </div>
                                    ${c.summary ? `<div style="color:#888;margin-top:4px;">${c.summary.substring(0, 60)}...</div>` : ''}
                                </div>`;
                        });
    
                        html += `</div></div>`;
                    });
    
                    html += `</div>`;
                }
    
                html += `<div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                    <button class="cinemaworld-button primary" 
                        onclick="ChapterManager.createChapter('新章节'); StoryManager.openChapterList();">
                        ➕ 新章节
                    </button>
                    ${this.currentChapter ? `
                        <button class="cinemaworld-button" 
                            onclick="ChapterManager.closeChapterAndStartNew().then(()=>StoryManager.openChapterList())">
                            ⏹️ 结束当前章节
                        </button>
                    ` : ''}
                    <button class="cinemaworld-button" 
                        onclick="ChapterManager.forceEndVolume().then(()=>StoryManager.openChapterList())"
                        style="color:#d8c07d;border-color:rgba(216,192,125,.4);">
                        📕 强制结束本卷
                    </button>
                    <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                </div>`;
    
                modal.innerHTML = html;
                modal.className = 'active';
            },
        };
    
        // ==================== 章节/卷管理器 ====================
        const ChapterManager = {
            VOLUME_SIZE: 8,
            COMPACT_THRESHOLD: 12,
            COMPACT_KEEP: 8,
    
            // ---------- 章节 ----------
            createChapter(title, summary = '') {
                if (!StoryManager.currentVolume) {
                    this.startNewVolume();
                }
    
                const ch = {
                    id: `chapter_${Date.now()}`,
                    title,
                    summary,
                    volumeId: StoryManager.currentVolume.id,
                    order: StoryManager.chapters.filter(c => c.volumeId === StoryManager.currentVolume.id).length + 1,
                    startTime: Date.now(),
                    endTime: null,
                    storyIds: [],
                    events: [],
                    compactSummary: '',
                    compactUntilOrder: 0,
                    previousSummary: '',
                };
    
                StoryManager.chapters.push(ch);
                StoryManager.currentChapter = ch;
                StoryManager.currentVolume.chapterIds.push(ch.id);
    
                console.log(`[CinemaWorld] 新章节: ${title} (卷:${StoryManager.currentVolume.title})`);
    
                try {
                    const keepChapterIds = StoryManager.chapters
                        .filter(c => c.volumeId === StoryManager.currentVolume.id)
                        .map(c => c.id);
                    InteractionDigestManager.archiveOldChapters(keepChapterIds);
                } catch (e) {
                    console.error('[CinemaWorld] 新章归档失败:', e);
                }
    
                return ch;
            },
    
            viewChapterStories(chapterId) {
                const chapter = StoryManager.chapters.find(c => c.id === chapterId);
                if (!chapter) return;
    
                const stories = StoryManager.storyList
                    .filter(s => s.chapterId === chapterId)
                    .sort((a, b) => a.order - b.order);
    
                const modal = document.getElementById('cinemaworld-modal');
    
                let html = `
                    <div class="cinemaworld-modal-title">📖 ${chapter.title}</div>
                    <div style="text-align:center;margin-bottom:15px;font-size:12px;color:#888;">
                        共 ${stories.length} 段剧情${chapter.summary ? ' · 已完成总结' : ''}
                    </div>
                    ${chapter.summary ? `
                        <div style="margin-bottom:15px;padding:10px;background:rgba(120,150,255,.1);border-radius:8px;
                            font-size:13px;color:#ccc;line-height:1.6;">
                            <div style="color:#7da8ff;margin-bottom:4px;">📝 章节总结</div>
                            ${chapter.summary}
                        </div>
                    ` : ''}
                `;
    
                if (stories.length === 0) {
                    html += `<div style="text-align:center;padding:40px;color:#888;">本章暂无剧情</div>`;
                } else {
                    html += `<div style="display:grid;gap:8px;max-height:400px;overflow-y:auto;">`;
                    stories.forEach((s, i) => {
                        const statusMap = {
                            completed: { text: '✅', color: '#7dd87d' },
                            active: { text: '▶️', color: '#d8c07d' },
                        };
                        const st = statusMap[s.status] || { text: '?', color: '#888' };
    
                        html += `
                            <div style="padding:12px;background:rgba(255,255,255,.05);border-radius:8px;
                                cursor:pointer;transition:all .2s;"
                                onclick="ChapterManager.viewStoryCard('${s.id}')"
                                onmouseover="this.style.background='rgba(120,150,255,.15)'"
                                onmouseout="this.style.background='rgba(255,255,255,.05)'">
                                <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                                    <span style="color:#fff;font-weight:bold;">${i+1}. ${s.title}</span>
                                    <span style="color:${st.color};font-size:12px;">${st.text}</span>
                                </div>
                                ${s.summary ? `
                                    <div style="font-size:12px;color:#aaa;line-height:1.5;">
                                        ${s.summary.substring(0, 100)}${s.summary.length > 100 ? '...' : ''}
                                    </div>
                                ` : ''}
                                ${s.chosenOption ? `
                                    <div style="font-size:11px;color:#7da8ff;margin-top:4px;">
                                        你的选择：${s.chosenOption.text}
                                    </div>
                                ` : ''}
                            </div>`;
                    });
                    html += `</div>`;
                }
    
                html += `
                    <div style="text-align:center;margin-top:20px;display:flex;justify-content:center;gap:10px;">
                        <button class="cinemaworld-button" onclick="StoryManager.openChapterList()">← 返回章节列表</button>
                        <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                    </div>
                `;
    
                modal.innerHTML = html;
                modal.className = 'active';
            },
    
            viewStoryCard(storyId) {
                const s = StoryManager.storyList.find(x => x.id === storyId);
                if (!s) return;
    
                const modal = document.getElementById('cinemaworld-modal');
                modal.innerHTML = `
                    <div class="cinemaworld-modal-title">📖 ${s.title}</div>
                    <div style="margin-bottom:15px;font-size:12px;color:#888;text-align:center;">
                        类型: ${s.type} · 状态: ${s.status}
                        ${s.chosenOption ? ` · 已选择` : ' · 未选择'}
                    </div>
                    ${s.summary ? `
                        <div style="margin-bottom:15px;padding:10px;background:rgba(120,150,255,.1);border-radius:8px;
                            font-size:13px;color:#ccc;line-height:1.6;">
                            <div style="color:#7da8ff;margin-bottom:4px;">📝 摘要</div>
                            ${s.summary}
                        </div>
                    ` : ''}
                    ${s.chosenOption ? `
                        <div style="margin-bottom:15px;padding:10px;background:rgba(255,200,100,.1);border-radius:8px;
                            font-size:13px;color:#e8d8a8;">
                            <div style="color:#d8c07d;margin-bottom:4px;">🎯 你的选择</div>
                            ${s.chosenOption.text}
                        </div>
                    ` : ''}
                    <div style="margin-bottom:15px;">
                        <div style="font-size:12px;color:#aaa;margin-bottom:8px;">原始内容</div>
                        <div style="font-size:12px;line-height:1.8;color:#ccc;padding:12px;
                            background:rgba(0,0,0,.25);border-radius:8px;max-height:300px;overflow-y:auto;">
                            ${(s.raw || '').replace(/\n/g, '<br>')}
                        </div>
                    </div>
                    <div style="text-align:center;display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
                        ${s.dialogues?.length ? `
                            <button class="cinemaworld-button primary" 
                                onclick="ChapterManager.replayStory('${s.id}')">
                                ▶️ 重放
                            </button>
                        ` : ''}
                        <button class="cinemaworld-button" 
                            onclick="ChapterManager.viewChapterStories('${s.chapterId}')">
                            ← 返回本章
                        </button>
                        <button class="cinemaworld-button" onclick="UIManager.closeModal()">关闭</button>
                    </div>
                `;
                modal.className = 'active';
            },
    
            async replayStory(storyId) {
                const s = StoryManager.storyList.find(x => x.id === storyId);
                if (!s) return;
    
                if (!s.dialogues || s.dialogues.length === 0) {
                    alert('这段剧情没有可重放的对话');
                    return;
                }
    
                window.UIManager.closeModal();
                await window.VisualNovelManager.play(s.dialogues);
                await window.UIManager.showText('（重放完毕，未应用效果）', 2000);
            },
    
            async endChapter() {
                let ch = StoryManager.currentChapter;
                if (!ch) return;
            
                // ★ 关键：同步到 chapters 数组里的同一对象
                const inArray = StoryManager.chapters.find(c => c.id === ch.id);
                if (inArray && inArray !== ch) {
                    // 把游离对象的内容合并回数组里的那个
                    // 但更安全的做法是：直接用数组里的那个作为 currentChapter
                    console.warn('[CinemaWorld] currentChapter 与 chapters 数组不同步，已修正');
                    StoryManager.currentChapter = inArray;
                    ch = inArray;
                } else if (!inArray) {
                    // 数组里找不到 → 补进去（理论上不该发生）
                    StoryManager.chapters.push(ch);
                }
            
                // 防重复
                if (ch.endTime) {
                    console.warn('[CinemaWorld] 该章节已结束');
                    return;
                }
            
                ch.endTime = Date.now();
                ch.summary = await this.generateChapterSummary(ch);
            
                // ★ 立刻保存
                if (window.SaveManager) window.SaveManager.save();
            
                try {
                    const currentVolume = StoryManager.currentVolume;
                    if (currentVolume) {
                        const keepChapterIds = StoryManager.chapters
                            .filter(c => c.volumeId === currentVolume.id)
                            .map(c => c.id);
                        InteractionDigestManager.archiveOldChapters(keepChapterIds);
                    }
                } catch (e) {
                    console.error('[CinemaWorld] 交互摘要归档失败:', e);
                }
            
                await this.tryEndVolume();
            
                if (window.SaveManager) window.SaveManager.save();
            },
            // ★ 结束当前章节并开启新章（手动按钮用）
            async closeChapterAndStartNew() {
                const ch = StoryManager.currentChapter;
                if (!ch) {
                    await window.UIManager.showText('当前没有章节', 1500);
                    return;
                }

                if (ch.endTime) {
                    await window.UIManager.showText('该章节已结束', 1500);
                    return;
                }

                await window.UIManager.showText('正在总结本章...', 1500);

                // 1. 结束当前章（会生成 summary + 保存）
                await this.endChapter();

                // 2. 开新章
                const nextNum = StoryManager.chapters.length + 1;
                const newChapter = this.createChapter(`第${nextNum}章`);

                // 3. 保存
                if (window.SaveManager) window.SaveManager.save();

                await window.UIManager.showText(`新章节已开始：${newChapter.title}`, 2000);
                return newChapter;
            },
            async generateChapterSummary(chapter) {
                const parts = [];
    
                const chapterStories = StoryManager.storyList
                    .filter(s => s.chapterId === chapter.id && s.summary)
                    .sort((a, b) => a.order - b.order);
    
                if (chapterStories.length > 0) {
                    const storyText = chapterStories.map(s => {
                        let line = `【${s.title}】\n${s.summary}`;
                        if (s.chosenOption) line += `\n玩家选择: ${s.chosenOption.text}`;
                        return line;
                    }).join('\n\n');
                    parts.push(`【主线剧情】\n${storyText}`);
                }
    
                const digestText = InteractionDigestManager.formatChapterDigests(chapter.id);
                if (digestText) {
                    parts.push(`【本章交互】\n${digestText}`);
                }
    
                if (parts.length === 0) {
                    const events = chapter.events || [];
                    if (events.length === 0) return '本章没有重要事件。';
                    const eventText = events.map(e => `- ${e.summary || ''}`).join('\n');
                    parts.push(`【事件记录】\n${eventText}`);
                }
    
                const text = parts.join('\n\n');
    
                const prompt = `请总结以下章节，作为后续章节的"前情提要"。
    
    章节标题：${chapter.title}
    
    ${text}
    
    要求：
    1. 主要发生了什么（含主线与玩家的关键交互）
    2. 重要角色登场、以及玩家与他们的关系变化
    3. 玩家的关键选择
    4. 对后续的影响
    5. 简洁，一段话，不要分点
    6. ★ 如果玩家与某角色有多次互动且态度明显变化，必须在总结里体现
    7. ★ 如果玩家反复使用某物品并产生了结果，也要体现
    `;
    
                const result = await window.generateFunctionalReply(prompt, 'chapter-summary');
                return result || '本章内容未能总结。';
            },
    
            // ---------- 卷 ----------
            startNewVolume(title = null) {
                const order = StoryManager.volumes.length + 1;
                const volume = {
                    id: `volume_${Date.now()}`,
                    title: title || `第${order}卷`,
                    summary: '',
                    order,
                    chapterIds: [],
                    startTime: Date.now(),
                    endTime: null,
                    archived: false,
                };
                StoryManager.volumes.push(volume);
                StoryManager.currentVolume = volume;
                console.log(`[CinemaWorld] 新卷: ${volume.title}`);
    
                try {
                    const keepChapterIds = StoryManager.chapters
                        .filter(c => c.volumeId === volume.id)
                        .map(c => c.id);
                    InteractionDigestManager.archiveOldChapters(keepChapterIds);
                    console.log(`[CinemaWorld] 新卷开始，旧章交互摘要已清理`);
                } catch (e) {
                    console.error('[CinemaWorld] 新卷归档失败:', e);
                }
    
                return volume;
            },
    
            async tryEndVolume() {
                const volume = StoryManager.currentVolume;
                if (!volume) return;
    
                const chapters = StoryManager.chapters.filter(
                    c => c.volumeId === volume.id && c.summary
                );
    
                if (chapters.length < this.VOLUME_SIZE) return;
    
                const text = chapters.map(c => `【${c.title}】${c.summary}`).join('\n\n');
                const prompt = `请用3-5句话总结这一卷的主要内容，作为后续卷的"前情提要"。
    
    卷标题：${volume.title}
    
    章节回顾：
    ${text}
    
    要求：
    1. 这一卷的核心冲突与进展
    2. 关键角色的变化
    3. 玩家的重大选择
    4. 一段话，简洁`;
    
                const result = await window.generateFunctionalReply(prompt, 'volume-summary');
                volume.summary = result || '本卷内容未能总结。';
                volume.endTime = Date.now();
    
                console.log(`[CinemaWorld] 卷结束: ${volume.title}`);
    
                this.startNewVolume();
    
                await this.tryCompactToWorldHistory();
            },
    
            async forceEndVolume() {
                const volume = StoryManager.currentVolume;
                if (!volume) {
                    await window.UIManager.showText('当前没有卷', 1500);
                    return;
                }
    
                const chapters = StoryManager.chapters.filter(
                    c => c.volumeId === volume.id && c.summary
                );
    
                if (chapters.length === 0) {
                    volume.summary = '（本卷无已完成的章节）';
                } else {
                    const text = chapters.map(c => `【${c.title}】${c.summary}`).join('\n\n');
                    const prompt = `请用3-5句话总结这一卷的主要内容。
    
卷标题：${volume.title}

章节回顾：
${text}

要求：
1. 核心冲突与进展
2. 关键角色的变化
3. 玩家的重大选择
4. 一段话，简洁
`;
    
                    const result = await window.generateFunctionalReply(prompt, 'volume-summary');
                    volume.summary = result || '本卷内容未能总结。';
                }
    
                volume.endTime = Date.now();
                console.log(`[CinemaWorld] 强制结束卷: ${volume.title}`);
    
                this.startNewVolume();

                // ★ 把当前章节清空
                StoryManager.currentChapter = null;

                // ★ 立刻建新章
                this.createChapter(`第${StoryManager.chapters.length + 1}章`);

                await this.tryCompactToWorldHistory();
                if (window.SaveManager) window.SaveManager.save();
    
                await window.UIManager.showText(`本卷已结束，开启新卷`, 2000);
            },
    
            // ---------- 世界史压缩 ----------
            async tryCompactToWorldHistory() {
                const ARCHIVE_THRESHOLD = 5;
                const KEEP_RECENT = 2;
    
                const activeVolumes = StoryManager.volumes.filter(v => v.summary && !v.archived);
                if (activeVolumes.length < ARCHIVE_THRESHOLD) return;
    
                const toArchive = activeVolumes.slice(0, activeVolumes.length - KEEP_RECENT);
                if (toArchive.length === 0) return;
    
                const text = toArchive.map(v => `【${v.title}】${v.summary}`).join('\n\n');
                const existing = CinemaWorld.worldState.worldHistory.summary || '';
    
                const prompt = `请把以下篇章整合进世界史，形成一段连贯的、100-200字的编年史摘要。
    
    ${existing ? `【已有世界史】\n${existing}\n\n` : ''}【新增篇章】
    ${text}
    
    要求：
    1. 整合为一段话，不分点
    2. 保留关键事件、重要人物、世界格局变化
    3. 语言像史书，简洁有力
    `;
    
                const result = await window.generateFunctionalReply(prompt, 'world-history');
                if (result) {
                    CinemaWorld.worldState.worldHistory.summary = result;
                    CinemaWorld.worldState.worldHistory.updatedAt = Date.now();
                    CinemaWorld.worldState.worldHistory.eraCount++;
    
                    toArchive.forEach(v => v.archived = true);
                    console.log(`[CinemaWorld] 已归档 ${toArchive.length} 卷进入世界史`);
                    if (window.SaveManager) window.SaveManager.save();
                }
            },
    
            // ---------- 章内压缩 ----------
            async tryCompactChapter() {
                const ch = StoryManager.currentChapter;
                if (!ch) return;
    
                const stories = StoryManager.storyList
                    .filter(s => s.chapterId === ch.id && s.summary)
                    .sort((a, b) => a.order - b.order);
    
                const uncompactCount = stories.filter(s => s.order > ch.compactUntilOrder).length;
                if (uncompactCount < this.COMPACT_THRESHOLD) return;
    
                const needCompact = uncompactCount - this.COMPACT_KEEP;
                const toCompact = stories
                    .filter(s => s.order > ch.compactUntilOrder)
                    .slice(0, needCompact);
    
                if (toCompact.length === 0) return;
    
                const text = toCompact.map(s => {
                    let line = `【${s.title}】${s.summary}`;
                    if (s.chosenOption) line += `\n玩家选择: ${s.chosenOption.text}`;
                    return line;
                }).join('\n\n');
    
                const prev = ch.compactSummary ? `【之前的前情】\n${ch.compactSummary}\n\n` : '';
    
                const prompt = `请用5-8句话总结以下剧情段落，作为本后续剧情的"前情提要"。
    
    ${prev}【本段剧情】
    ${text}
    
    要求：
    1. 保留关键事件、玩家关键选择、人物关系变化
    2. 简洁连贯，一段话
    `;
    
                const result = await window.generateFunctionalReply(prompt, 'chapter-compact');
                if (result) {
                    ch.compactSummary = result;
                    ch.compactUntilOrder = toCompact[toCompact.length - 1].order;
                    console.log(`[CinemaWorld] 章内压缩至 order ${ch.compactUntilOrder}`);
                    if (window.SaveManager) window.SaveManager.save();
                }
            },
    
            // ---------- 查询 ----------
            getVolume(id) {
                return StoryManager.volumes.find(v => v.id === id);
            },
    
            getAllSummaries() {
                return StoryManager.chapters
                    .filter(c => c.summary)
                    .map(c => `【${c.title}】${c.summary}`)
                    .join('\n\n');
            },
        };
    
        // ==================== 挂载到 window ====================
        window.InteractionHistoryManager = InteractionHistoryManager;
        window.InteractionDigestManager = InteractionDigestManager;
        window.InteractionSummaryManager = InteractionSummaryManager;
        window.StoryManager = StoryManager;
        window.ChapterManager = ChapterManager;
    
        console.log('[CinemaWorld] story.js 已加载');
    })();