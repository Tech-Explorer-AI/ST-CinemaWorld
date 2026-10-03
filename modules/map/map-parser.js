// ============================================================
// CinemaWorld · map-parser.js
// 地图规则文本 → 结构化对象
// 依赖：map-schema.js, world.js（parseItemLine）
// 暴露：window.MapParser
// ============================================================

(function () {
    'use strict';

    const MapParser = {
        // ---------- 主入口 ----------
        parse(text) {
            if (!text || typeof text !== 'string') return null;

            const map = {
                name: '',
                description: '',
                startRegion: null,
                music: '',
                regions: [],
                connections: [],
                entities: [],
                buildingCatalog: {},   // ★ 新增：大建筑表
            };

            // ---------- 【地图】区块 ----------
            const mapBlock = this._section(text, '地图');
            if (mapBlock) {
                map.name = this._kv(mapBlock, '名称') || this._kv(mapBlock, '名字') || '无名区域';
                map.description = this._kv(mapBlock, '描述') || '';
                map.startRegion = this._kv(mapBlock, '起点') || null;
                map.background = this._kv(mapBlock, '背景') || '';   // ★ 新增
                map.music = this._kv(mapBlock, '音乐') || '';
            }

            // ---------- 【大建筑表】区块（兼容旧【建筑】） ----------
            let buildingBlock = this._section(text, '大建筑表');
            if (!buildingBlock) {
                buildingBlock = this._section(text, '建筑');
            }
            if (buildingBlock) {
                for (const line of buildingBlock.split('\n')) {
                    const b = this._parseBuildingTemplate(line);
                    if (b) map.buildingCatalog[b.id] = b;
                }
            }

            // ---------- 【区域】区块 ----------
            const regionBlock = this._section(text, '区域');
            if (regionBlock) {
                for (const line of regionBlock.split('\n')) {
                    const r = this._parseRegionLine(line);
                    if (r) map.regions.push(r);
                }
            }

            // ---------- 【连接】区块 ----------
            const connBlock = this._section(text, '连接');
            if (connBlock) {
                for (const line of connBlock.split('\n')) {
                    const c = this._parseConnectionLine(line);
                    if (c) map.connections.push(c);
                }
            }

            // ---------- 【实体】区块 ----------
            const entityBlock = this._section(text, '实体');
            if (entityBlock) {
                const subs = this._splitEntitySubsections(entityBlock);

                // 普通实体（NPC / decor / marker / encounter / player）
                for (const line of subs.general) {
                    const e = this._parseEntityLine(line);
                    if (e) map.entities.push(e);
                }

                // 物品
                for (const line of subs.items) {
                    const e = this._parseItemEntityLine(line, 'item');
                    if (e) map.entities.push(e);
                }

                // 装备
                for (const line of subs.equips) {
                    const e = this._parseItemEntityLine(line, 'equipment');
                    if (e) map.entities.push(e);
                }

                // 出入口
                for (const line of subs.portals) {
                    const e = this._parseEntityLine(line);
                    if (e) {
                        e.kind = 'portal';
                        map.entities.push(e);
                    }
                }
            }

            // ---------- 兜底：独立【建筑】段（旧格式） ----------
            // 如果 AI 意外生成了旧格式的独立建筑，这里转为 building 实体
            // （新格式走 buildingCatalog，不走这里）
            if (!map.buildingCatalog || Object.keys(map.buildingCatalog).length === 0) {
                // 尝试解析旧格式【建筑】为实例
                const legacyBuildingBlock = this._section(text, '建筑');
                if (legacyBuildingBlock) {
                    for (const line of legacyBuildingBlock.split('\n')) {
                        const b = this._parseLegacyBuildingInstance(line);
                        if (b) map.entities.push(b);
                    }
                }
            }

            if (map.regions.length === 0) return null;

            // 起点兜底
            if (!map.startRegion || !map.regions.some(r => r.id === map.startRegion)) {
                map.startRegion = map.regions[0].id;
            }

            // 玩家兜底
            if (!map.entities.some(e => e.isPlayer)) {
                map.entities.push({
                    id: 'player',
                    name: '玩家',
                    emoji: '🧍',
                    kind: 'player',
                    region: map.startRegion,
                    position: 'center',
                    blocking: false,
                    isPlayer: true,
                    tags: [],
                    description: '',
                    fields: {},
                    status: '',
                    effect: '',
                    interactions: [],
                    count: 1,
                    countMode: 'single',
                    stackable: false,
                    maxStack: null,
                    type: 'player',
                    extraStats: { _order: [], _raw: '' },
                    meta: {},
                });
            } else {
                const p = map.entities.find(e => e.isPlayer);
                p.region = map.startRegion;
            }

            // 所有实体兜底 region
            for (const e of map.entities) {
                if (!e.region) e.region = map.startRegion;
            }

            return map;
        },

        // ============================================================
        // 大建筑表：模板行
        // - 【id|名称|emoji|尺寸】：描述，[外墙:X|屋顶:Y|门:Z|门向:south|可进入:是|连接:Y]
        // ============================================================
        _parseBuildingTemplate(raw) {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;

            const meta = m[1].split('|').map(s => s.trim());
            const id = meta[0];
            if (!id) return null;

            const name = meta[1] || id;
            const emoji = this._extractEmoji(meta[2]) || '🏠';
            const sizeStr = meta[3] || '3x3';

            // 解析尺寸
            const sizeMatch = sizeStr.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
            const size = sizeMatch
                ? { w: parseInt(sizeMatch[1]), h: parseInt(sizeMatch[2]) }
                : { w: 3, h: 3 };

            // ★ 1×1 拒绝（应走迷你建筑）
            if (size.w <= 1 && size.h <= 1) {
                console.warn('[MapParser] 大建筑表不允许 1×1，已忽略:', id);
                return null;
            }

            const rest = m[2] || '';
            const { description, tags, fields } = this._splitDescTagsAndFields(rest);

            // 可进入布尔
            const enterable = /^(是|yes|true|可|1)$/i.test(String(fields['可进入'] || '').trim());

            return {
                id,
                name,
                emoji,
                size,
                description,
                tags,
                wallTile: fields['外墙'] || null,
                roofTile: fields['屋顶'] || null,
                doorTile: fields['门'] || null,
                doorSide: fields['门向'] || 'south',
                enterable,
                linkedRegion: fields['连接'] || null,
                keywords: [name, ...(tags || [])].filter(Boolean),
                _raw: line,
            };
        },

        // ============================================================
        // 旧格式：独立建筑实例行（兼容）
        // - 【id|名称|emoji|尺寸|区域id|锚点|入口方向】：描述，[类型:X|数量:N|连接:Y]
        // ============================================================
        _parseLegacyBuildingInstance(raw) {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;

            const meta = m[1].split('|').map(s => s.trim());
            const id = meta[0];
            if (!id) return null;

            const name = meta[1] || id;
            const emoji = this._extractEmoji(meta[2]) || '🏠';
            const sizeStr = meta[3] || '3x3';
            const region = meta[4] || null;
            const anchor = meta[5] || 'center';
            const entranceDir = meta[6] || 'south';

            const sizeMatch = sizeStr.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
            const size = sizeMatch
                ? { w: parseInt(sizeMatch[1]), h: parseInt(sizeMatch[2]) }
                : { w: 3, h: 3 };

            const isTiny = (size.w <= 1 && size.h <= 1);

            const rest = m[2] || '';
            const { description, tags, fields } = this._splitDescTagsAndFields(rest);

            const count = this._parseCount(fields['数量']);

            return {
                id,
                name,
                emoji,
                kind: 'building',
                region,
                position: anchor,
                blocking: true,
                isPlayer: false,
                tags,
                description,
                meta: {},
                status: '',
                effect: '',
                fields,
                interactions: [],
                extraStats: { _order: [], _raw: '' },
                count,
                isTemplate: count > 1,
                stackable: false,
                maxStack: null,
                type: 'building',

                anchor: null,
                size,
                isTiny,
                entrance: null,
                entranceDir,
                linkedRegion: isTiny ? null : (fields['连接'] || null),
                linkedScene: null,
                wallTile: fields['外墙'] || null,
                roofTile: fields['屋顶'] || null,
                doorTile: fields['门'] || null,
            };
        },

        // ============================================================
        // 区块切分
        // ============================================================
        _section(text, title) {
            // 1. 【标题】
            const re1 = new RegExp(`【${title}】\\s*([\\s\\S]*?)(?=\\n【|$)`);
            const m1 = text.match(re1);
            if (m1) return m1[1].trim();
        
            // 2. ──── 第X类：标题 ────
            const re2 = new RegExp(
                `─+\\s*第[一二三四五六七八九十]+类[：:]\\s*${title}\\s*─+\\s*([\\s\\S]*?)(?=\\n─+\\s*第[一二三四五六七八九十]+类|$)`
            );
            const m2 = text.match(re2);
            if (m2) return m2[1].trim();
        
            return '';
        },

        _kv(block, key) {
            // 找包含 key 的行，key 前面允许 emoji 和空格
            const lines = block.split('\n');
            for (const line of lines) {
                const m = line.match(/^[^:：]*?([^:：\s]+)\s*[:：]\s*(.+)$/);
                if (!m) continue;
                const k = m[1].replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').trim();
                if (k === key) {
                    return m[2].trim().replace(/[（()）]/g, '');
                }
            }
            return '';
        },

        // ============================================================
        // 【实体】区块按子段切分
        // ============================================================
        _splitEntitySubsections(block) {
            const lines = block.split('\n');
            const subs = { general: [], items: [], equips: [], portals: [] };
            let mode = 'general';
        
            for (const raw of lines) {
                const line = raw.trim();
                if (!line) continue;
        
                // ★ 子标题识别（覆盖各种写法）
                // NPC / 装饰 / 标记 / 遭遇
                if (/^(?:NPC|npc)[\s\/、,，]*(?:装饰|标记|遭遇)*\s*[:：]?\s*$/.test(line)) {
                    mode = 'general'; continue;
                }
                if (/^【NPC】/.test(line)) { mode = 'general'; continue; }
                if (/^【装饰[\s\/、]?标记】/.test(line)) { mode = 'general'; continue; }
        
                // 物品 / 装备
                if (/^(?:物品|道具)[\s\/、,，]*(?:装备)*\s*[:：]?\s*$/.test(line)) {
                    mode = 'items'; continue;
                }
                if (/^【物品[\s\/、]?装备】/.test(line)) { mode = 'items'; continue; }
        
                // 装备
                if (/^(?:装备|武器|护甲)\s*[:：]?\s*$/.test(line)) { mode = 'equips'; continue; }
        
                // 出入口
                if (/^(?:出入口|入口|出口|传送点|门|portal)[\s（(【]*.*?[】)）]?\s*[:：]?\s*$/i.test(line)) {
                    mode = 'portals'; continue;
                }
                if (/^【出入口】/.test(line)) { mode = 'portals'; continue; }
        
                // ★ 遇到"第X类"或新段标题 → 停
                if (/─+\s*第[一二三四五六七八九十]+类/.test(line)) break;
                if (/^═+\s*\d+\.\d+/.test(line)) continue;   // 忽略装饰线
        
                // ★ 实体行
                const isEntityLine = /^[-•]?\s*【/.test(line);
                if (!isEntityLine) continue;
        
                const normalized = line.startsWith('-') ? line : '- ' + line;
        
                // 分派
                if (mode === 'general') {
                    const metaMatch = normalized.match(/【([^】]+)】/);
                    if (metaMatch) {
                        const meta = metaMatch[1].split('|').map(s => s.trim());
                        if (meta[3] === 'portal') { subs.portals.push(normalized); continue; }
                        if (meta.some(p => /^kind\s*[:：]\s*portal$/i.test(p))) { subs.portals.push(normalized); continue; }
                    }
        
                    const bracketMatch = normalized.match(/[\[【]([^\]】]+)[\]】]/);
                    if (bracketMatch && /(^|\|)\s*类型\s*[:：]/.test(bracketMatch[1])) {
                        const typeField = bracketMatch[1];
                        if (/类型\s*[:：]\s*遭遇/.test(typeField)) { subs.general.push(normalized); continue; }
                        if (/类型\s*[:：]\s*(武器|护甲|饰品|装备|工具)/.test(typeField)) { subs.equips.push(normalized); continue; }
                        if (/类型\s*[:：]\s*(传送|出入口|portal)/.test(typeField)) { subs.portals.push(normalized); continue; }
                        subs.items.push(normalized);
                        continue;
                    }
                    subs.general.push(normalized);
                    continue;
                }
        
                if (mode === 'items' || mode === 'equips') {
                    // items 模式下也判断类型
                    const bracketMatch = normalized.match(/[\[【]([^\]】]+)[\]】]/);
                    if (bracketMatch && /(^|\|)\s*类型\s*[:：]/.test(bracketMatch[1])) {
                        const typeField = bracketMatch[1];
                        if (/类型\s*[:：]\s*(武器|护甲|饰品|装备|工具)/.test(typeField)) {
                            subs.equips.push(normalized); continue;
                        }
                        if (/类型\s*[:：]\s*(消耗品|材料|食物|杂物|货币|物品)/.test(typeField)) {
                            subs.items.push(normalized); continue;
                        }
                    }
                    if (mode === 'items') subs.items.push(normalized);
                    else subs.equips.push(normalized);
                    continue;
                }
        
                if (mode === 'portals') subs.portals.push(normalized);
                else subs.general.push(normalized);
            }
        
            return subs;
        },

        // ============================================================
        // 区域行
        // - 【id|名称|类型|尺寸|地形】：描述，[地形:甲、乙|装饰:丙、丁|迷你建筑:戊|大建筑:庚×N]
        // ============================================================
        _parseRegionLine(raw) {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;

            const metaParts = m[1].split('|').map(s => s.trim());

            // 混合解析
            const positional = [];
            const kv = {};

            for (const part of metaParts) {
                const sepIdx = part.search(/[:：]/);
                if (sepIdx < 0) {
                    positional.push(part);
                } else {
                    const k = part.substring(0, sepIdx).trim();
                    const v = part.substring(sepIdx + 1).trim();
                    kv[k] = v;
                }
            }

            let id, name, type, size, terrain;

            if (Object.keys(kv).length > 0) {
                id = kv.id || positional[0] || '';
                name = kv.name || kv['名称'] || positional[1] || id;
                type = kv.type || kv['类型'] || positional[2] || 'default';
                size = kv.size || kv['尺寸'] || positional[3] || '';
                terrain = kv.terrain || kv['地形'] || positional[4] || '';
            } else {
                id = positional[0] || '';
                name = positional[1] || id;
                type = positional[2] || 'default';
                size = positional[3] || '';
                terrain = positional[4] || '';
            }

            if (!id) return null;

            const rest = m[2] || '';
            const { description, tags, fields } = this._splitDescTagsAndFields(rest);

            // ★ 解析资源清单
            const parseList = (str) => String(str || '')
                .split(/[、,，]/)
                .map(s => s.trim())
                .filter(Boolean)
                .filter(s => !/^(无|没有|none|n\/a|-|——?)$/i.test(s));   // ★ 加这一行

            return {
                id,
                name,
                type,
                size: size || null,
                terrain: terrain || null,
                description,
                tags,
                sceneName: fields['场景'] || null,

                // ★ 新增：资源清单
                terrains: parseList(fields['地形']),
                decors: parseList(fields['装饰']),
                minis: parseList(fields['迷你建筑']),
                buildings: parseList(fields['大建筑']),
            };
        },

        // ============================================================
        // 连接行
        // ============================================================
        _parseConnectionLine(raw) {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】/);
            if (!m) return null;

            const metaParts = m[1].split('|').map(s => s.trim());

            const positional = [];
            const kv = {};

            for (const part of metaParts) {
                const sepIdx = part.search(/[:：]/);
                if (sepIdx < 0) {
                    positional.push(part);
                } else {
                    const k = part.substring(0, sepIdx).trim();
                    const v = part.substring(sepIdx + 1).trim();
                    kv[k] = v;
                }
            }

            let from, to, direction, distance, kind;

            if (Object.keys(kv).length > 0) {
                from = kv.from || positional[0] || '';
                to = kv.to || positional[1] || '';
                direction = kv.direction || kv['方向'] || positional[2] || 'any';
                distance = kv.distance || kv['距离'] || positional[3] || 'near';
                kind = kv.kind || kv['种类'] || positional[4] || 'road';
            } else {
                from = positional[0] || '';
                to = positional[1] || '';
                direction = positional[2] || 'any';
                distance = positional[3] || 'near';
                kind = positional[4] || 'road';
            }

            if (!from || !to || from === to) return null;

            return { from, to, direction, distance, kind };
        },

        // ============================================================
        // 普通实体行（NPC / decor / marker / encounter / portal / player）
        // ============================================================
        _parseEntityLine(raw) {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;

            const metaParts = m[1].split('|').map(s => s.trim());

            // 混合格式解析
            const positional = [];
            const kv = {};

            for (const part of metaParts) {
                const sepIdx = part.search(/[:：]/);
                if (sepIdx < 0) {
                    positional.push(part);
                } else {
                    const k = part.substring(0, sepIdx).trim();
                    const v = part.substring(sepIdx + 1).trim();
                    kv[k] = v;
                }
            }

            let meta;

            if (Object.keys(kv).length > 0) {
                const posId = positional[0] || '';
                const posName = positional[1] || '';
                const posEmoji = positional[2] || '';

                meta = [
                    kv.id || posId || '',
                    kv.name || posName || kv.id || posId || '',
                    kv.emoji || posEmoji || '',
                    kv.kind || positional[3] || 'npc',
                    kv.region || positional[4] || null,
                    kv.pos || kv.position || positional[5] || 'center',
                    kv.blocking || positional[6] || 'yes',
                    kv.gender || positional[7] || '-',
                    kv.mood || positional[8] || '-',
                ];
            } else {
                meta = metaParts;

                const KIND_RE = /^(npc|decor|marker|encounter|portal|player|item|building|scene|装备|武器|护甲|饰品|工具)$/i;

                if (meta.length === 2) {
                    meta = [meta[0], meta[0], meta[1], 'encounter', null, 'center', 'no', '-', '-'];
                } else if (meta.length === 7 && KIND_RE.test(meta[1])) {
                    meta = [meta[0], meta[0], '❓', ...meta.slice(1)];
                } else if (meta.length === 8 && KIND_RE.test(meta[2])) {
                    meta = [meta[0], meta[0], ...meta.slice(1)];
                }
            }

            while (meta.length < 9) meta.push('-');

            const rawId = meta[0] || `ent_${Date.now()}`;
            const name = meta[1] || rawId;

            const id = /[\u4e00-\u9fa5]/.test(rawId)
                ? `ent_${this._hashName(rawId)}`
                : rawId;

            const emoji = this._extractEmoji(meta[2]) || '❓';
            let kind = (meta[3] || 'npc').toLowerCase();

            if (kind === 'building') kind = 'decor';

            const region = meta[4] && meta[4] !== '-' ? meta[4] : null;
            const position = meta[5] || 'center';
            const blocking = this._parseBool(meta[6], true);
            const gender = (meta[7] && meta[7] !== '-') ? meta[7] : '';
            const mood = (meta[8] && meta[8] !== '-') ? meta[8] : '';

            const rest = m[2] || '';
            const { description, tags, fields } = this._splitDescTagsAndFields(rest);

            if (fields['可拾取'] !== undefined) {
                fields['可拾取'] = this._normalizeBool(fields['可拾取']) ? '是' : '否';
            }

            const isPlayer = kind === 'player' || rawId === 'player';
            const isDecor = kind === 'decor';

            return {
                id,
                name,
                emoji,
                kind,
                region,
                position,
                blocking,
                isPlayer,
                description,
                tags,
                fields,
                status: fields['状态'] || '',
                effect: fields['功能'] || '',
                count: this._parseCount(fields['数量']),
                countMode: this._inferCountMode(kind, fields),
                stackable: this._normalizeBool(fields['可堆叠']),
                maxStack: parseInt(fields['最大堆叠']) || null,
                type: fields['类型'] || kind,
                interactions: this._parseInteractions(fields['交互方式']),
                extraStats: { _order: [], _raw: '' },
                meta: { gender, mood, rawId },

                // decor 特有（不再猜类型，统一走默认）
                size: isDecor ? { w: 1, h: 1 } : null,
                decorType: isDecor ? (fields['装饰类型'] || 'small_building') : null,
                variant: isDecor ? Math.floor(Math.random() * 8) : null,
            };
        },

        // ============================================================
        // 物品 / 装备实体行
        // - 【生锈的铁剑|⚔️】：描述，[类型:武器|可拾取:是|区域:plaza|位置:west|攻击:+3]
        // ============================================================
        _parseItemEntityLine(raw, defaultType = 'item') {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();

            const parsed = window.WorldManager?.parseItemLine?.(content);
            if (!parsed || !parsed.name) {
                console.warn('[MapParser] 物品行解析失败:', content);
                return null;
            }

            const fields = parsed.fields || {};

            const region = fields['区域'] || null;
            const position = fields['位置'] || 'center';

            const pickup = this._normalizeBool(fields['可拾取']) ? '是' : '否';
            const stackable = this._normalizeBool(fields['可堆叠']) ? '是' : '否';
            const count = parseInt(fields['数量']) || 1;
            const maxStack = parseInt(fields['最大堆叠']) || null;

            const id = `item_${this._hashName(parsed.name)}`;

            return {
                id,
                name: parsed.name,
                emoji: parsed.icon || '📦',
                kind: 'item',
                region,
                position,
                blocking: false,
                isPlayer: false,
                tags: parsed.tags || [],
                description: parsed.description || '',
                status: parsed.status || '',
                effect: parsed.effect || '',
                count,
                countMode: 'single',
                stackable: stackable === '是',
                maxStack,
                type: fields['类型'] || (defaultType === 'equipment' ? '装备' : '物品'),
                fields: {
                    ...fields,
                    '可拾取': pickup,
                    '可堆叠': stackable,
                },
                interactions: parsed.interactions || [],
                extraStats: { _order: [], _raw: '' },
                meta: {
                    gender: '',
                    mood: '',
                    isEquipment: defaultType === 'equipment',
                },
            };
        },

        // ============================================================
        // 工具
        // ============================================================

        _splitDescTagsAndFields(text) {
            const s = String(text || '').trim();
            let description = s;
            const tags = [];
            const fields = {};

            const bracketRegex = /[\[【]([^\]】]*)[\]】]/g;
            let bm;
            const brackets = [];
            while ((bm = bracketRegex.exec(s)) !== null) {
                brackets.push({ full: bm[0], inner: bm[1], index: bm.index });
            }

            if (brackets.length > 0) {
                description = s.substring(0, brackets[0].index).trim();
                description = description.replace(/^[，,、\s]+|[，,、\s]+$/g, '');

                for (const b of brackets) {
                    const inner = b.inner.trim();
                    if (/[:：]/.test(inner)) {
                        // ★ 支持 | 分隔的键值对
                        for (const pair of inner.split('|')) {
                            const kv = pair.match(/^(.+?)[:：]\s*([\s\S]+)$/);
                            if (kv) {
                                fields[kv[1].trim()] = kv[2].trim();
                            }
                        }
                    } else {
                        tags.push(...inner.split(/[、,，]/).map(t => t.trim()).filter(Boolean));
                    }
                }
            }

            // 尾部未闭合的方括号
            const tailMatch = s.match(/[\[【]([^\[\]【】]*)$/);
            if (tailMatch && tailMatch.index > 0) {
                const inner = tailMatch[1].trim();
                if (inner) {
                    if (/[:：]/.test(inner)) {
                        for (const pair of inner.split('|')) {
                            const kv = pair.match(/^(.+?)[:：]\s*([\s\S]+)$/);
                            if (kv) fields[kv[1].trim()] = kv[2].trim();
                        }
                    } else {
                        tags.push(...inner.split(/[、,，]/).map(t => t.trim()).filter(Boolean));
                    }
                    description = s.substring(0, tailMatch.index).trim()
                        .replace(/^[，,、\s]+|[，,、\s]+$/g, '');
                }
            }

            return { description, tags, fields };
        },

        _splitDescTags(text) {
            const { description, tags } = this._splitDescTagsAndFields(text);
            return { description, tags };
        },

        _parseInteractions(text) {
            if (!text) return [];
            return String(text)
                .split(/[、,，]/)
                .map(s => s.trim())
                .filter(Boolean)
                .map(name => ({ name, hint: '' }));
        },

        _extractEmoji(s) {
            if (!s) return '';
            const m = String(s).match(
                /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u
            );
            return m ? m[0] : '';
        },

        _parseBool(s, fallback = true) {
            if (s === undefined || s === null || s === '') return fallback;
            const v = String(s).trim().toLowerCase();
            if (['yes', 'y', 'true', '1', '是', '可', '阻挡', '能'].includes(v)) return true;
            if (['no', 'n', 'false', '0', '否', '不可', '不阻挡', '通行'].includes(v)) return false;
            return fallback;
        },

        _normalizeBool(v) {
            if (v === true) return true;
            if (v === false || v === undefined || v === null) return false;
            const s = String(v).trim().toLowerCase();
            return ['是', 'yes', 'true', '1', 'y', '可', '能'].includes(s);
        },

        _parseCount(v) {
            if (v === undefined || v === null || v === '') return 1;
            const s = String(v).trim();
            const m = s.match(/(\d+)/);
            if (m) return Math.max(1, parseInt(m[1]));
            return 1;
        },

        _inferCountMode(kind, fields) {
            if (kind !== 'npc' && kind !== 'encounter') return 'single';
            const hasCount = fields?.['数量'] !== undefined;
            if (!hasCount) return 'single';
            const n = this._parseCount(fields['数量']);
            if (n <= 1) return 'single';
            return 'cluster';
        },

        _hashName(name) {
            let h = 0;
            const s = String(name);
            for (let i = 0; i < s.length; i++) {
                h = ((h << 5) - h + s.charCodeAt(i)) | 0;
            }
            return Math.abs(h).toString(36);
        },
    };

    window.MapParser = MapParser;
    console.log('[CinemaWorld] map-parser.js 已加载');
})();