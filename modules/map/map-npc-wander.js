// ============================================================
// CinemaWorld · map-npc-wander.js
// 地图 NPC 行为：
//   1. 漫步（wander）：小时级随机移动，无声背景活动
//   2. 靠近（approach）：玩家进入 NPC 的注意范围后，NPC 主动走过来
//                       走到位后弹出气泡，玩家接受 → 触发"被动交互"
//
// 依赖：map-environment.js（cw:env-hour / cw:env-minute）
//       map-canvas.js（MapCanvas / MapLauncher）
//       ui.js（generateFunctionalReply / VisualNovelManager / UIManager）
//
// 暴露：window.MapNPCWander
// ============================================================

(function () {
    'use strict';

    // ============================================================
    // 配置
    // ============================================================
    const CONFIG = {
        wander: {
            // 每小时挪动的概率（0~1）
            moveChance: 0.6,
            // 8 邻域偏移
            neighbors: [
                [-1, -1], [0, -1], [1, -1],
                [-1, 0], [1, 0],
                [-1, 1], [0, 1], [1, 1],
            ],
        },

        approach: {
            // ★ 玩家进入这个范围 → NPC 注意到玩家（曼哈顿距离）
            noticeRadius: 5,

            // ★ 玩家离开这个范围 → 靠近中的 NPC 放弃
            abandonDistance: 7,

            // 走到玩家相邻几格内算"到位"（曼哈顿距离）
            reachDistance: 2,

            // 每 N 游戏分钟移动一步（越小越灵敏）
            stepIntervalMinutes: 5,

            // 被拒绝/忽略/完成后进入冷却（游戏分钟）
            cooldownMinutes: 180,

            // 同一时间只允许一个 NPC 处于"靠近模式"
            maxActive: 1,

            // 气泡自动消失时间（现实毫秒）
            bubbleLifetimeMs: 12000,

            // ★ 每个 NPC 每张地图允许多久"注意"一次（防止反复触发）
            noticeCooldownMinutes: 90,
        },

        // ★ 搭讪摘要是否写入全局上下文
        writeDigestToContext: true,
    };

    // ============================================================
    // 主体
    // ============================================================
    const MapNPCWander = {
        CONFIG,

        _inited: false,

        // 靠近状态
        _approach: {
            activeId: null,               // 正在靠近的实体 id
            cooldowns: {},                // { entityId: 冷却结束的游戏分钟 }
            noticeCooldowns: {},          // { entityId: 上次注意结束的游戏分钟 }
            pendingBubble: null,          // 当前气泡对应的实体 id
            bubbleTimer: null,
            isApproachInteracting: false, // 正在播放搭讪 VN
            lastStepAt: 0,                // 上次移动的游戏分钟（节流用）
        },

        // ============================================================
        // 初始化
        // ============================================================
        init() {
            if (this._inited) return;
            this._inited = true;

            window.addEventListener('cw:env-hour', () => this._onHour());
            window.addEventListener('cw:env-minute', () => this._onMinuteApproach());

            console.log('[NPCWander] 已初始化');
        },

        // ============================================================
        // 小时事件：漫步
        // ============================================================
        _onHour() {
            const playMode = window.CinemaWorld?.worldState?.playMode;
            if (playMode !== 'map') return;

            const map = window.MapLauncher?.getMap?.();
            if (!map?._generated) return;

            const moved = this.wanderAll(map);
            if (moved > 0) {
                if (window.MapCanvas?.canvas) window.MapCanvas._render();
                window.MapLauncher?._saveMapToWorld?.(map);
                console.log(`[NPCWander] ${moved} 个 NPC 移动了`);
            }
        },

        // ============================================================
        // ★ 分钟事件：靠近检查（每游戏分钟跑一次）
        // ============================================================
        _onMinuteApproach() {
            const playMode = window.CinemaWorld?.worldState?.playMode;
            if (playMode !== 'map') return;

            const canvas = window.MapCanvas;
            const map = window.MapLauncher?.getMap?.();
            if (!canvas?.player || !map?._generated) return;

            // ★ 有模态框打开 → 不搭讪
            const modal = document.getElementById('cinemaworld-modal');
            if (modal?.classList.contains('active')) return;

            // ★ 有子面板打开 → 不搭讪
            if (window.MapLauncher?._subState) return;

            // ★ VN 播放中 → 不搭讪
            if (window.VisualNovelManager?.isPlaying) return;

            // ★ 战斗进行中 → 不搭讪
            if (window.BattleManager?.isActive?.()) return;

            // 正在播放搭讪 VN → 冻结
            if (this._approach.isApproachInteracting) return;

            // 有气泡挂着 → 等玩家处理
            if (this._approach.pendingBubble) return;

            const grid = map._generated.grid;
            const state = this._approach;

            // ---------- 已有活跃靠近者 ----------
            if (state.activeId) {
                const ent = map.entities.find(e => e.id === state.activeId);
                if (!ent) {
                    // 目标实体消失
                    state.activeId = null;
                } else {
                    // 玩家跑太远 → 放弃
                    const px = canvas.player.x;
                    const py = canvas.player.y;
                    const dist = Math.abs(ent.x - px) + Math.abs(ent.y - py);
                    if (dist > CONFIG.approach.abandonDistance) {
                        console.log(`[NPCWander] ${ent.name} 放弃靠近（玩家跑远）`);
                        this._setCooldown(ent.id, map, 30);   // 短冷却
                        state.activeId = null;
                    } else {
                        // 节流：两次移动之间至少 N 分钟
                        const now = this._readTotalMinutes(map);
                        if (now - state.lastStepAt >= CONFIG.approach.stepIntervalMinutes) {
                            state.lastStepAt = now;
                            const ok = this._stepApproach(map, grid);
                            if (ok) {
                                if (window.MapCanvas?.canvas) window.MapCanvas._render();
                                window.MapLauncher?._saveMapToWorld?.(map);
                            }
                        }
                    }
                }
                return;
            }

            // ---------- 选候选 ----------
            const candidate = this._pickApproachCandidate(map, grid);
            if (!candidate) return;

            // 进入靠近模式
            state.activeId = candidate.id;
            state.lastStepAt = this._readTotalMinutes(map);
            console.log(`[NPCWander] ${candidate.name} 注意到玩家，开始靠近`);

            // 给 NPC 打上"靠近中"标记（渲染用）
            candidate.meta = candidate.meta || {};
            candidate.meta._approachingPlayer = true;

            // 立即走一步，让玩家立刻看到反应
            const ok = this._stepApproach(map, grid);
            if (window.MapCanvas?.canvas) window.MapCanvas._render();
            window.MapLauncher?._saveMapToWorld?.(map);
        },

        // ============================================================
        // 漫步
        // ============================================================
        wanderAll(map) {
            const grid = map._generated?.grid;
            if (!grid) return 0;

            const allEntities = map.entities;
            let movedCount = 0;

            const occupied = this._buildOccupied(allEntities);

            for (const ent of allEntities) {
                if (!this._canWander(ent, map)) continue;
                if (Math.random() > CONFIG.wander.moveChance) continue;

                const moved = this._tryMove(ent, map, grid, occupied);
                if (moved) movedCount++;
            }

            return movedCount;
        },

        _canWander(ent, map) {
            if (!ent) return false;
            if (!ent._placed) return false;
            if (ent.isPlayer) return false;
            if (ent.kind !== 'npc') return false;
            if (typeof ent.x !== 'number' || typeof ent.y !== 'number') return false;

            // ★ 正在靠近玩家 → 不参与随机漫步
            if (this._approach.activeId === ent.id) return false;
            // ★ 正在播放搭讪 VN → 不移动
            if (this._approach.pendingBubble === ent.id) return false;

            // 不动主线目标
            const mq = window.CinemaWorld?.worldState?.mainQuest;
            if (mq?.active && mq.status === 'active'
                && mq.target.kind === 'entity'
                && mq.target.entityId === ent.id) {
                return false;
            }

            // 不动任务目标
            if (ent.meta?.questId || ent.meta?.questTarget) return false;

            // 不动有硬标记的 NPC
            if (ent.tags?.includes('不移动') || ent.tags?.includes('固定')) return false;

            return true;
        },

        _buildOccupied(entities) {
            const set = new Set();
            for (const e of entities) {
                if (!e._placed) continue;
                if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
                if (e.kind === 'building') continue;
                set.add(`${e.x},${e.y}`);
            }
            return set;
        },

        _tryMove(ent, map, grid, occupied) {
            const oldX = ent.x;
            const oldY = ent.y;

            const neighbors = this._shuffle([...CONFIG.wander.neighbors]);

            for (const [dx, dy] of neighbors) {
                const nx = oldX + dx;
                const ny = oldY + dy;

                if (!this._canStandOn(nx, ny, ent, map, grid, occupied)) continue;

                occupied.delete(`${oldX},${oldY}`);

                if (window.MapCanvas?.startVisualMove) {
                    const fromVX = ent._visualX ?? oldX;
                    const fromVY = ent._visualY ?? oldY;
                    window.MapCanvas.startVisualMove(ent, fromVX, fromVY, nx, ny);
                }

                ent.x = nx;
                ent.y = ny;
                if (window.MapCanvas3D?._running) {
                    window.MapCanvas3D.syncEntity(ent);
                }
                occupied.add(`${nx},${ny}`);

                this._afterMove(ent, map, grid);
                return true;
            }

            return false;
        },

        _canStandOn(x, y, ent, map, grid, occupied) {
            if (y < 0 || y >= grid.length) return false;
            if (x < 0 || x >= grid[0].length) return false;

            const cell = grid[y][x];
            if (!cell) return false;
            if (!cell.walkable) return false;
            if (cell.terrain === 'void') return false;
            if (cell.decor) return false;
            if (cell.portal) return false;
            if (occupied.has(`${x},${y}`)) return false;

            if (cell.regionId && ent.region && cell.regionId !== ent.region) {
                return false;
            }

            return true;
        },

        _afterMove(ent, map, grid) {
            const cell = grid[ent.y]?.[ent.x];
            if (!cell) return;

            if (cell.regionId && cell.regionId !== ent.region) {
                ent.region = cell.regionId;
            }
            // ★★★ 新增：NPC 移动后也更新立绘（NPC 走过来时立绘实时出现）
            if (ent.kind === 'npc' && window.MapCanvas?._running) {
                window.MapCanvas._updateNearbyAfterMove?.();
            }
            window.dispatchEvent(new CustomEvent('cw:npc-moved', {
                detail: { entity: ent, map },
            }));
        },

        _shuffle(arr) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        },

        wanderOne(entityId) {
            const map = window.MapLauncher?.getMap?.();
            if (!map?._generated) return false;
            const ent = map.entities.find(e => e.id === entityId);
            if (!ent) return false;
            if (!this._canWander(ent, map)) return false;

            const occupied = this._buildOccupied(map.entities);
            const moved = this._tryMove(ent, map, map._generated.grid, occupied);

            if (moved && window.MapCanvas?.canvas) {
                window.MapCanvas._render();
                window.MapLauncher?._saveMapToWorld?.(map);
            }
            return moved;
        },

        // ============================================================
        // 候选选择：玩家进入 noticeRadius 的 NPC
        // ============================================================
        _pickApproachCandidate(map, grid) {
            const canvas = window.MapCanvas;
            if (!canvas?.player) return null;

            const px = canvas.player.x;
            const py = canvas.player.y;
            const now = this._readTotalMinutes(map);

            const state = this._approach;

            let best = null;
            let bestDist = Infinity;

            for (const ent of map.entities) {
                if (!this._canWander(ent, map)) continue;

                // ---------- 冷却中 ----------
                const cd = state.cooldowns[ent.id];
                if (cd && now < cd) continue;

                // ---------- 刚注意过（短冷却） ----------
                const nc = state.noticeCooldowns[ent.id];
                if (nc && now < nc + CONFIG.approach.noticeCooldownMinutes) continue;

                // ---------- 距离判定 ----------
                const dx = ent.x - px;
                const dy = ent.y - py;
                const dist = Math.abs(dx) + Math.abs(dy);

                if (dist > CONFIG.approach.noticeRadius) continue;
                if (dist <= CONFIG.approach.reachDistance) continue;   // 已经在身边

                if (dist < bestDist) {
                    bestDist = dist;
                    best = ent;
                }
            }

            return best;
        },

        _stepApproach(map, grid) {
            const canvas = window.MapCanvas;
            const state = this._approach;
            if (!canvas?.player || !state.activeId) return false;

            const ent = map.entities.find(e => e.id === state.activeId);
            if (!ent) {
                state.activeId = null;
                return false;
            }

            const px = canvas.player.x;
            const py = canvas.player.y;
            const dx = px - ent.x;
            const dy = py - ent.y;
            const dist = Math.abs(dx) + Math.abs(dy);

            // 到位 → 弹气泡
            if (dist <= CONFIG.approach.reachDistance) {
                this._showApproachBubble(ent, map);
                return false;
            }

            // 朝玩家走一格（差值大的轴优先）
            const moves = [];
            if (Math.abs(dx) >= Math.abs(dy)) {
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
            } else {
                if (dy !== 0) moves.push([0, Math.sign(dy)]);
                if (dx !== 0) moves.push([Math.sign(dx), 0]);
            }
            if (dx !== 0 && dy !== 0) moves.push([Math.sign(dx), Math.sign(dy)]);

            const occupied = this._buildOccupied(map.entities);
            for (const [mx, my] of moves) {
                const nx = ent.x + mx;
                const ny = ent.y + my;
                if (!this._canStandOn(nx, ny, ent, map, grid, occupied)) continue;

                if (window.MapCanvas?.startVisualMove) {
                    window.MapCanvas.startVisualMove(
                        ent,
                        ent._visualX ?? ent.x,
                        ent._visualY ?? ent.y,
                        nx, ny
                    );
                }
                ent.x = nx;
                ent.y = ny;
                if (window.MapCanvas3D?._running) {
                    window.MapCanvas3D.syncEntity(ent);
                }
                this._afterMove(ent, map, grid);
                return true;
            }

            return false;
        },

        // ============================================================
        // 气泡
        // ============================================================
        _showApproachBubble(ent, map) {
            const state = this._approach;
            if (state.pendingBubble === ent.id) return;
            if (state.pendingBubble) return;

            state.pendingBubble = ent.id;

            // 清掉头顶标记（已经有气泡了）
            if (ent.meta) ent.meta._approachingPlayer = false;

            const el = document.createElement('div');
            el.id = 'cw-npc-approach-bubble';
            el.className = 'cw-npc-approach-bubble';

            el.innerHTML = `
                <div class="cw-npc-approach-avatar">${this._escape(ent.emoji || '👤')}</div>
                <div class="cw-npc-approach-body">
                    <div class="cw-npc-approach-name">${this._escape(ent.name)}</div>
                    <div class="cw-npc-approach-text">想和你聊聊</div>
                </div>
                <button class="cw-npc-approach-accept" title="接受">✅</button>
                <button class="cw-npc-approach-reject" title="拒绝">✕</button>
            `;

            document.body.appendChild(el);

            el.querySelector('.cw-npc-approach-accept').onclick = () => {
                this._dismissApproachBubble();
                this._startApproachInteraction(ent, map);
            };

            el.querySelector('.cw-npc-approach-reject').onclick = () => {
                this._dismissApproachBubble();
                this._setCooldown(ent.id, map);
                state.activeId = null;
                state.pendingBubble = null;
            };

            state.bubbleTimer = setTimeout(() => {
                this._dismissApproachBubble();
                this._setCooldown(ent.id, map);
                state.activeId = null;
                state.pendingBubble = null;
            }, CONFIG.approach.bubbleLifetimeMs);
        },

        _dismissApproachBubble() {
            const state = this._approach;
            if (state.bubbleTimer) {
                clearTimeout(state.bubbleTimer);
                state.bubbleTimer = null;
            }
            const el = document.getElementById('cw-npc-approach-bubble');
            if (el) el.remove();
        },

        // ★ 冷却：cleanup 时同时清掉头顶标记
        _setCooldown(entityId, map, minutes = null) {
            const total = this._readTotalMinutes(map);
            const mins = minutes ?? CONFIG.approach.cooldownMinutes;
            this._approach.cooldowns[entityId] = total + mins;
            this._approach.noticeCooldowns[entityId] = total;

            // 清掉头顶标记
            const ent = map.entities.find(e => e.id === entityId);
            if (ent?.meta) ent.meta._approachingPlayer = false;
        },

        // ============================================================
        // 搭讪交互：独立提示词
        // ============================================================
        async _startApproachInteraction(ent, map) {
            const state = this._approach;
            if (state.isApproachInteracting) return;
            state.isApproachInteracting = true;

            try {
                state.pendingBubble = null;

                const region = map.regions.find(r => r.id === ent.region);
                const chapterId = window.StoryManager?.currentChapter?.id || null;

                const contextParts = this._buildApproachContextParts(map, ent, region);
                const prompt = this._buildApproachPrompt(ent, map, region, contextParts);

                await window.UIManager.showText('正在生成对话...', 500);

                const result = await window.generateFunctionalReply(prompt, 'npc-approach');
                if (!result) {
                    console.warn('[NPCWander] 搭讪生成失败');
                    return;
                }

                await this._processApproachResult(result, {
                    ent,
                    map,
                    region,
                    chapterId,
                });

            } catch (e) {
                console.error('[NPCWander] 搭讪交互异常:', e);
            } finally {
                state.isApproachInteracting = false;
                state.activeId = null;

                if (ent?.id) {
                    this._setCooldown(ent.id, map);
                }

                if (window.MapCanvas?.canvas) window.MapCanvas._render();
                if (window.SaveManager) window.SaveManager.save();
            }
        },

        // ---------- 上下文组装 ----------
        _buildApproachContextParts(map, ent, region) {
            const parts = [];

            if (window.StoryManager) {
                const ctx = window.StoryManager.buildContext(null, {
                    parentStory: false,
                    mainChars: true,
                    scene: false,
                    interactionDigests: true,
                    volumes: false,
                    chapters: false,
                    pendingEvents: false,
                });
                if (ctx) parts.push(ctx);
            }

            let mapCtx = `【地图】${map.name || ''}\n`;
            if (map.description) mapCtx += `${map.description}\n`;
            mapCtx += `\n【当前位置】${region?.name || '未知区域'}`;
            if (region?.description) mapCtx += `\n${region.description}`;
            parts.push(mapCtx);

            if (window.CWEnv) {
                const env = window.CWEnv.ensureEnvData(map);
                if (env?._order?.length) {
                    const envText = env._order
                        .filter(k => env[k] !== undefined && env[k] !== '')
                        .map(k => `${k}:${env[k]}`)
                        .join(' | ');
                    if (envText) parts.push(`【当前环境】${envText}`);
                }
            }

            if (window.PlayerStateManager) {
                parts.push(window.PlayerStateManager.formatForPrompt());
            }

            const siblings = map.entities.filter(e =>
                e.region === region?.id && e.id !== ent.id && !e.isPlayer
            );
            if (siblings.length > 0) {
                let sibCtx = `【附近的其他实体】`;
                for (const s of siblings.slice(0, 8)) {
                    sibCtx += `\n- ${s.emoji} ${s.name}（${s.kind}）${s.description ? '：' + s.description : ''}`;
                }
                parts.push(sibCtx);
            }

            return parts;
        },

        // ---------- 独立提示词 ----------
        _buildApproachPrompt(ent, map, region, contextParts) {
            const player = window.PlayerStateManager?.player;
            const playerName = player?.name || '主人公';
            const scene = window.LocationModalManager.currentLocation;
            const playerRecent = window.StoryManager?.buildContext(null, {
                parentStory: false,
                mainChars: false,
                scene: false,
                interactionDigests: true,
                digestFilter: {
                    characters: true,
                    characterFilter: 'onlySelf',
                    targetName: ent.name,
                },
                volumes: false,
                chapters: false,
                pendingEvents: false,
            }) || '';

            return `你正在扮演一个视觉小说游戏里的"NPC 主动搭讪"事件。

════════════════════════════════════════
【剧情结构】（务必理解）
════════════════════════════════════════
- 玩家在地图上路过 / 停留，${ent.name} 注意到了玩家。
- ${ent.name} 主动从附近走过来，走到玩家身边，向玩家搭话。
- 玩家是被动方：玩家没有主动搭话、没有发出邀请。
- 你的任务是描述 **${ent.name} 主动接近玩家、并且先开口** 的场景。
- 不要写成"玩家去找${ent.name}对话"，也不要写成"玩家开口问了什么"。
- 剧情可以是：一句寒暄、一句询问、一句警告、一个请求、一个玩笑、
  一段感慨、一句闲话……取决于这个角色的性格和当前局势。

════════════════════════════════════════
【世界与剧情上下文】
${contextParts.join('\n\n')}

★ 当前环境数据：
${WorldManager.getEnvDataText(scene)}
════════════════════════════════════════
【主动搭讪的 NPC】
名称：${ent.name}
类型：${ent.kind}
描述：${ent.description || '（无）'}
${ent.tags?.length ? `标签：${ent.tags.join('、')}` : ''}
${this._formatEntityStats(ent)}

════════════════════════════════════════
【玩家】
名字：${playerName}
${player?.profile || '（无特别设定）'}

${playerRecent ? `【玩家与 ${ent.name} 的近期互动】\n${playerRecent}\n` : ''}

════════════════════════════════════════
【任务】
生成一段 6-12 行的视觉小说脚本，描述这个搭讪事件。

【输出格式】
每行：
【角色名|显示/隐藏|左/中/右|性别|状态】: 内容
旁白用：【旁白】: 内容

规则：
- 说话者"显示"，其他"隐藏"
- 只有 ${ent.name} 和玩家能说话
- 旁白用于环境、动作、心理描写
- 音乐: 🎵 音乐: 曲名

════════════════════════════════════════
【可选：赠予】
如果这次搭讪中，${ent.name} 主动送给玩家东西（物品/装备/情报），
在脚本之后用【赠予】块标记。没有就不写。

【赠予】
- 获得【物品名|图标】：描述，[类型|状态|功能|交互方式|效果:效果DSL|可堆叠|货币种类:X|买价:X|卖价:X|其他]
- 获得【装备名|图标】：描述，[类型|状态|功能|交互方式|可堆叠|货币种类:X|买价:X|卖价:X|属性:X|属性:Y]

★ 赠予是 NPC 主动给玩家，玩家没有要求，也没有付出。
★ 数值奖励写：数值变化: 金钱+N，经验+N
★ 没东西送就不写【赠予】块。
说明：效果DSL:<动作><目标> <值>[; <动作><目标> <值>...]

动作：
- 回复：当前值+N，不超上限（如"回复生命 X"）
- 提升：上限+N，当前值同步+N（如"提升生命上限 X"）
- 设置：当前值=N（如"设置生命 X"）
- 减少：当前值-N（如"减少理智 Y"）
- 永久：永久改变属性（如"永久力量 X"）
- 状态：加状态（如"状态中毒 X"）
- 移除：移除状态（如"移除中毒"）
- 增益：临时属性加成（如"增益攻击 X Y回合"）

值可以是数字或百分比：回复生命 X / 回复生命 X%
多效果用分号分隔：回复生命 X; 回复体力 X
无效果的物品写 效果:无

════════════════════════════════════════
【摘要】
（2-3 句。${ent.name} 主动来找玩家做了什么、说了什么、什么态度。
 作为后续剧情、交互、主线的上下文。）

请开始生成：`;
        },

        _formatEntityStats(ent) {
            const lines = [];
            if (ent.status) lines.push(`状态：${ent.status}`);
            if (ent.effect) lines.push(`功能：${ent.effect}`);

            for (const [k, v] of Object.entries(ent.fields || {})) {
                if (k.startsWith('_pos')) continue;
                if (['图标', 'icon', '类型', '状态', '功能'].includes(k)) continue;
                lines.push(`${k}：${v}`);
            }

            const extra = ent.extraStats;
            if (extra?._order?.length) {
                for (const k of extra._order) {
                    if (extra[k] !== undefined && extra[k] !== '') {
                        lines.push(`${k}：${extra[k]}`);
                    }
                }
            }

            return lines.length > 0 ? '\n' + lines.join('\n') : '';
        },

        // ---------- 处理搭讪结果 ----------
        async _processApproachResult(result, meta) {
            const { ent, map, region, chapterId } = meta;

            const summaryMatch = result.match(/【摘要】\s*([\s\S]*?)(?=\n【|$)/);
            const digestSummary = summaryMatch ? summaryMatch[1].trim() : '';
            let withoutDigest = result.replace(/【摘要】[\s\S]*?(?=\n【|$)/, '').trim();

            const giftIdx = withoutDigest.indexOf('【赠予】');
            let scriptText = withoutDigest;
            let giftPart = '';
            if (giftIdx >= 0) {
                scriptText = withoutDigest.substring(0, giftIdx).trim();
                giftPart = withoutDigest.substring(giftIdx);
            }

            if (window.MusicManager) {
                await window.MusicManager.applyMusicMarker(result);
            }

            const dialogues = window.VisualNovelManager.parseScript(scriptText);
            if (dialogues.length > 0) {
                await window.VisualNovelManager.play(dialogues);
            } else {
                await window.UIManager.showText(scriptText, 5000);
            }

            if (giftPart) {
                await new Promise(r => setTimeout(r, 300));
                this._applyApproachGifts(giftPart);
            }

            if (window.InteractionHistoryManager) {
                window.InteractionHistoryManager.add({
                    type: 'npcApproach',
                    target: ent.name,
                    targetMeta: { entityId: ent.id, source: 'approach' },
                    scene: region?.name || map.name || '(地图)',
                    playerInput: '（NPC 主动搭讪）',
                    script: scriptText,
                    effect: giftPart || null,
                    summary: digestSummary,
                });
            }

            if (CONFIG.writeDigestToContext && digestSummary && window.InteractionDigestManager) {
                window.InteractionDigestManager.add({
                    targetType: 'item',
                    target: `搭讪:${ent.name}`,
                    source: 'npcApproach',
                    summary: digestSummary,
                    chapterId,
                });
            }

            if (window.MusicManager) await window.MusicManager.clearOverrideMusic();
        },

        // ---------- 应用"赠予"块 ----------
        _applyApproachGifts(giftPart) {
            const player = window.PlayerStateManager?.player;
            if (!player) return;

            player.inventory = player.inventory || [];

            const lines = giftPart.split('\n');
            const added = [];

            for (const raw of lines) {
                const line = raw.trim();
                if (!line) continue;
                if (/^【赠予】/.test(line)) continue;

                if (/^数值变化\s*[:：]/.test(line)) {
                    const body = line.replace(/^数值变化\s*[:：]\s*/, '');
                    const parts = body.split(/[，,、\/／]/).map(s => s.trim()).filter(Boolean);
                    for (const p of parts) {
                        const m = p.match(/^(.+?)\s*[+\-＋－]\s*(\d+)\s*$/);
                        if (!m) continue;
                        const key = m[1].trim();
                        const delta = parseInt(m[2]);
                        if (window.MapQuestManager?._applyNumberReward) {
                            window.MapQuestManager._applyNumberReward(key, delta);
                        }
                    }
                    continue;
                }

                if (!/^[-•]?\s*【/.test(line)) continue;
                const clean = line.replace(/^[-•]\s*/, '');
                const item = window.WorldManager?.parseItemLine?.(clean);
                if (!item || !item.name) continue;

                const stackable = item.stackable === true;
                const existing = stackable
                    ? player.inventory.find(i => i.name === item.name)
                    : null;

                if (existing) {
                    existing.count = (existing.count || 1) + (item.count || 1);
                } else {
                    const slots = player.inventorySlots || 40;
                    if (player.inventory.length >= slots) {
                        console.warn(`[NPCWander] 背包已满，无法加入 ${item.name}`);
                        continue;
                    }
                    player.inventory.push({
                        name: item.name,
                        count: item.count || 1,
                        icon: item.icon || '📦',
                        description: item.description || '',
                        fields: { ...(item.fields || {}) },
                        interactions: item.interactions || [],
                        status: item.status || '',
                        effect: item.effect || '',
                        stackable,
                        maxStack: item.maxStack || null,
                        type: item.type || 'item',
                    });
                }
                added.push(`${item.icon || '📦'} ${item.name}`);
            }

            if (added.length > 0) {
                window.UIManager?.showText?.(`🎁 收到：${added.join('、')}`, 2000);
                window.PlayerStateManager?.refreshAvatarArea?.();
            }
        },

        // ============================================================
        // 状态重置（切地图时调用）
        // ============================================================
        resetApproachState() {
            const state = this._approach;
            state.activeId = null;
            state.pendingBubble = null;
            state.isApproachInteracting = false;
            state.lastStepAt = 0;
            this._dismissApproachBubble();

            // 清掉所有实体上的靠近标记
            const map = window.MapLauncher?.getMap?.();
            if (map?.entities) {
                for (const e of map.entities) {
                    if (e.meta?._approachingPlayer) {
                        e.meta._approachingPlayer = false;
                    }
                }
            }
        },

        // ============================================================
        // 工具
        // ============================================================
        _readTotalMinutes(map) {
            try {
                if (window.CWEnv?.parseTotalMinutes && window.CWEnv?.ensureEnvData) {
                    const env = window.CWEnv.ensureEnvData(map);
                    const t = window.CWEnv.parseTotalMinutes(env);
                    if (typeof t === 'number') return t;
                }
            } catch (e) { /* 忽略 */ }
            return 0;
        },

        _escape(s) {
            return String(s || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        },
    };

    window.MapNPCWander = MapNPCWander;

    function boot() {
        MapNPCWander.init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld] map-npc-wander.js 已加载');
})();