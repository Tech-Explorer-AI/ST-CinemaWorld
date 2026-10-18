// ============================================================
// CinemaWorld · map-parser.js
// 地图规则文本 → 结构化对象
// 全中文，无 ID，名字即主键
// ============================================================

(function () {
    'use strict';

    const MapParser = {
        // ============================================================
        // 主入口
        // ============================================================
        parse(text) {
            if (!text || typeof text !== 'string') return null;

            const map = {
                name: '',
                description: '',
                mapType: 'outdoor',
                startRegion: null,
                background: '',
                music: '',
                style: null,
                spatial: {},
                exits: {},
                heightMap: { _base: 0 },

                regions: [],
                connections: [],
                entities: [],
                buildingCatalog: {},
                itemTable: {},
            };

            // ---------- 【地图】 ----------
            const mapBlock = this._section(text, '地图');
            if (mapBlock) {
                map.name = this._kv(mapBlock, '名称') || this._kv(mapBlock, '名字') || '无名区域';
                map.description = this._kv(mapBlock, '描述') || '';
                map.startRegion = this._kv(mapBlock, '起点') || null;
                map.background = this._kv(mapBlock, '背景') || '';
                map.music = this._kv(mapBlock, '音乐') || '';

                const typeStr = this._kv(mapBlock, '类型') || '室外';
                map.mapType = /室内|indoor/i.test(typeStr) ? 'indoor' : 'outdoor';
            }

            // ---------- 【地图风格】 ----------
            const styleBlock = this._section(text, '地图风格');
            if (styleBlock) {
                map.style = this._parseMapStyle(styleBlock);
            }

            // ---------- 【空间】 ----------
            const spaceBlock = this._section(text, '空间');
            if (spaceBlock) {
                map.spatial = this._parseSpatialBlock(spaceBlock);
            }

            // ---------- 【高度】 ----------
            const heightBlock = this._section(text, '高度');
            if (heightBlock) {
                map.heightMap = this._parseHeightBlock(heightBlock);
            }

            // ---------- 【物品表】（先解析，实体里会引用） ----------
            const itemTableBlock = this._section(text, '物品表');
            if (itemTableBlock) {
                for (const line of itemTableBlock.split('\n')) {
                    const entry = this._parseItemTableLine(line);
                    if (entry) map.itemTable[entry.name] = entry;
                }
            }
            // 兼容旧【奖励表】
            const rewardBlock = this._section(text, '奖励表');
            if (rewardBlock) {
                for (const line of rewardBlock.split('\n')) {
                    const entry = this._parseItemTableLine(line);
                    if (entry) map.itemTable[entry.name] = entry;
                }
            }

            // ---------- 【大建筑表】（兼容旧【建筑】） ----------
            let buildingBlock = this._section(text, '大建筑表');
            if (!buildingBlock) buildingBlock = this._section(text, '建筑');
            if (buildingBlock) {
                for (const line of buildingBlock.split('\n')) {
                    const b = this._parseBuildingTemplate(line);
                    if (b) map.buildingCatalog[b.name] = b;
                }
            }

            // ---------- 【区域】 ----------
            const regionBlock = this._section(text, '区域');
            if (regionBlock) {
                for (const line of regionBlock.split('\n')) {
                    const r = this._parseRegionLine(line);
                    if (r) map.regions.push(r);
                }
            }

            // ---------- 【连接】 ----------
            const connBlock = this._section(text, '连接');
            if (connBlock) {
                for (const line of connBlock.split('\n')) {
                    const c = this._parseConnectionLine(line);
                    if (c) map.connections.push(c);
                }
            }

            // ---------- 【实体】 ----------
            const entityBlock = this._section(text, '实体');
            if (entityBlock) {
                const subs = this._splitEntitySubsections(entityBlock);

                for (const line of subs.general) {
                    const e = this._parseEntityLine(line);
                    if (e) map.entities.push(e);
                }
                for (const line of subs.items) {
                    const e = this._parseItemInstanceLine(line, 'item', map);
                    if (e) map.entities.push(e);
                }
                for (const line of subs.equips) {
                    const e = this._parseItemInstanceLine(line, 'equipment', map);
                    if (e) map.entities.push(e);
                }

                // ★★★ 出入口实体：与【空间】/【出入口】段去重
                for (const line of subs.portals) {
                    const e = this._parseEntityLine(line);
                    if (!e) continue;

                    // 从实体名 / 位置 / 字段里推断方向
                    const dir = this._inferPortalDirection(e);

                    // 已经在 exits 里了 → 丢弃（说明是重复声明）
                    if (dir && map.exits[dir]) {
                        console.log(`[MapParser] 丢弃重复的出入口实体：${e.name}（方向 ${dir} 已在【空间】/【出入口】段声明）`);
                        continue;
                    }

                    e.kind = 'portal';
                    map.entities.push(e);
                }
            }

            // ---------- 【出入口】 ----------
            const exitBlock = this._section(text, '出入口');
            if (exitBlock) {
                this._parseExitsBlock(exitBlock, map);
            }

            if (map.regions.length === 0) return null;

            // 起点兜底
            if (!map.startRegion || !map.regions.some(r => r.name === map.startRegion)) {
                map.startRegion = map.regions[0].name;
            }

            // ★ 名字消歧：同名加 @区域
            this._disambiguateEntities(map);

            // 玩家兜底
            if (!map.entities.some(e => e.isPlayer)) {
                map.entities.push({
                    id: '玩家',
                    name: '玩家',
                    emoji: '🧍',
                    kind: 'player',
                    region: map.startRegion,
                    position: '中央',
                    blocking: false,
                    isPlayer: true,
                    tags: [],
                    description: '',
                    meta: {},
                    status: '', effect: '',
                    fields: {},
                    interactions: [],
                    extraStats: { _order: [], _raw: '' },
                    count: 1, countMode: 'single',
                    stackable: false, maxStack: null,
                    type: 'player',
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
        // ★ 从 portal 实体的各个字段推断它"指向哪个方向"
        //   判断依据（优先级从高到低）：
        //     1. fields['方向']
        //     2. 实体名里的方向词（东侧渡口石径 → east）
        //     3. position 锚点（east → east）
        // ============================================================
        _inferPortalDirection(ent) {
            if (!ent) return null;

            // 1. fields['方向']
            const fromField = this._normalizeDir(ent.fields?.['方向']);
            if (fromField) return fromField;

            // 2. 实体名里的方向词（长词优先，避免"东"命中"东北"）
            const name = String(ent.name || '');
            const NAME_MAP = [
                ['东北', 'northeast'], ['东南', 'southeast'],
                ['西南', 'southwest'], ['西北', 'northwest'],
                ['东侧', 'east'], ['南侧', 'south'],
                ['西侧', 'west'], ['北侧', 'north'],
                ['东门', 'east'], ['南门', 'south'],
                ['西门', 'west'], ['北门', 'north'],
                ['东边', 'east'], ['南边', 'south'],
                ['西边', 'west'], ['北边', 'north'],
                ['东方', 'east'], ['南方', 'south'],
                ['西方', 'west'], ['北方', 'north'],
            ];
            for (const [kw, dir] of NAME_MAP) {
                if (name.includes(kw)) return dir;
            }

            // 3. position 锚点
            const pos = this._normalizeDir(ent.position);
            if (pos && pos !== 'any') return pos;

            // 4. 单个方位字兜底（放最后，避免误伤）
            if (/东/.test(name)) return 'east';
            if (/南/.test(name)) return 'south';
            if (/西/.test(name)) return 'west';
            if (/北/.test(name)) return 'north';

            return null;
        },
        // ============================================================
        // ★ 名字消歧：同名实体加 @区域 后缀
        // ============================================================
        _disambiguateEntities(map) {
            const count = {};
            for (const e of map.entities) {
                if (e.isPlayer) continue;
                count[e.name] = (count[e.name] || 0) + 1;
            }

            for (const e of map.entities) {
                if (e.isPlayer) continue;
                if (count[e.name] > 1) {
                    e.id = `${e.name}@${e.region || '未知'}`;
                    e._ambiguousName = e.name;
                } else {
                    e.id = e.name;
                }
            }
        },

        // ============================================================
        // 物品表行
        // - 【物品名|图标】：描述，[类型:xxx|可拾取:是|...]
        // ============================================================
        _parseItemTableLine(raw) {
            const line = String(raw || '').trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;

            const meta = m[1].split('|').map(s => s.trim());
            const name = meta[0];
            if (!name) return null;

            const emoji = this._extractEmoji(meta[1]) || '📦';
            const { description, tags, fields } = this._splitDescTagsAndFields(m[2] || '');

            if (fields['可拾取'] !== undefined) {
                fields['可拾取'] = this._normalizeBool(fields['可拾取']) ? '是' : '否';
            }
            if (fields['可堆叠'] !== undefined) {
                fields['可堆叠'] = this._normalizeBool(fields['可堆叠']) ? '是' : '否';
            }

            return { name, emoji, description, tags, fields };
        },

        // ============================================================
        // 物品摆放行
        // - 【物品名|区域|锚点】：数量
        // ============================================================
        _parseItemInstanceLine(raw, kind, map) {
            const line = String(raw || '').trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】\s*[：:]?\s*([\s\S]*)$/);
            if (!m) return null;

            const meta = m[1].split('|').map(s => s.trim());
            if (meta.length < 3) return null;

            const itemName = meta[0];
            const region = meta[1];
            const position = meta[2] || '中央';

            if (!itemName || !region) return null;

            // 校验 region
            if (map?.regions && !map.regions.some(r => r.name === region)) {
                return null;
            }

            let count = 1;
            const countM = (m[2] || '').match(/(\d+)/);
            if (countM) count = Math.max(1, parseInt(countM[1]));

            const def = map?.itemTable?.[itemName];
            if (!def) {
                console.warn(`[MapParser] 物品「${itemName}」不在物品表里，跳过`);
                return null;
            }

            return this._buildItemEntity(def, { region, position, count, kind });
        },

        _buildItemEntity(def, options) {
            const { region, position, count, kind } = options;
            return {
                id: `${def.name}@${region}`,
                name: def.name,
                emoji: def.emoji || '📦',
                kind: 'item',
                region,
                position,
                blocking: false,
                isPlayer: false,
                tags: def.tags || [],
                description: def.description || '',
                status: '', effect: def.fields['效果'] || '',
                count: count || 1,
                countMode: 'single',
                stackable: def.fields['可堆叠'] === '是',
                maxStack: parseInt(def.fields['最大堆叠']) || null,
                type: def.fields['类型'] || (kind === 'equipment' ? '装备' : '物品'),
                fields: { ...(def.fields || {}), '可拾取': def.fields['可拾取'] || '是' },
                interactions: this._parseInteractions(def.fields['交互方式']),
                extraStats: { _order: [], _raw: '' },
                meta: { fromItemTable: def.name },
            };
        },

        // ============================================================
        // 大建筑表
        // - 【名称|图标|尺寸】：描述，[外墙:X|屋顶:Y|门:Z|门向:南|风格:S|层数:N|可进入:是|连接:Y]
        // ============================================================
        _parseBuildingTemplate(raw) {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;

            const meta = m[1].split('|').map(s => s.trim());
            const name = meta[0];
            if (!name) return null;

            const emoji = this._extractEmoji(meta[1]) || '🏠';
            const sizeStr = meta[2] || '3x3';

            const sizeMatch = sizeStr.match(/^(\d+)\s*[x×]\s*(\d+)$/i);
            const size = sizeMatch
                ? { w: parseInt(sizeMatch[1]), h: parseInt(sizeMatch[2]) }
                : { w: 3, h: 3 };

            if (size.w <= 1 && size.h <= 1) {
                console.warn('[MapParser] 大建筑不允许 1×1:', name);
                return null;
            }

            const { description, tags, fields } = this._splitDescTagsAndFields(m[2] || '');
            const enterable = /^(是|yes|true|可|1)$/i.test(String(fields['可进入'] || '').trim());

            return {
                name,
                emoji,
                size,
                description,
                tags,
                wallTile: fields['外墙'] || null,
                roofTile: fields['屋顶'] || null,
                doorTile: fields['门'] || null,
                doorSide: this._normalizeDir(fields['门向']) || '南',
                style: fields['风格'] || null,
                floors: parseInt(fields['层数']) || 1,
                enterable,
                linkedRegion: fields['连接'] || null,
                keywords: [name, ...(tags || [])].filter(Boolean),
                _raw: line,
            };
        },

        // ============================================================
        // 区域行
        // - 【名称|类型|尺寸|地形】：描述，[地形:甲、乙|装饰:丙|迷你建筑:戊|大建筑:庚×N|高度:xx]
        // ============================================================
        _parseRegionLine(raw) {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;

            const parts = m[1].split('|').map(s => s.trim());

            const name = parts[0];
            if (!name) return null;

            const type = parts[1] || 'default';
            const size = parts[2] || '';
            const terrain = parts[3] || '';

            const { description, tags, fields } = this._splitDescTagsAndFields(m[2] || '');

            const parseList = (str) => String(str || '')
                .split(/[、,，]/)
                .map(s => s.trim())
                .filter(Boolean)
                .filter(s => !/^(无|没有|none|n\/a|-|——?)$/i.test(s));

            // ★ 原始地形
            const rawTerrains = parseList(fields['地形']);
            const rawMain = terrain || (rawTerrains[0] || null);

            // ★ 按"类型 + 地形"转换成实际地形
            const terrains = this._normalizeRegionTerrains(type, rawTerrains);
            const mainTerrain = this._normalizeRegionTerrains(
                type,
                rawMain ? [rawMain] : []
            )[0] || rawMain;

            return {
                name,
                type,
                size: this._normalizeSize(size),
                terrain: mainTerrain,           // ★ 转换后的主地形
                description,
                tags,
                sceneName: fields['场景'] || null,
                heightRef: fields['高度'] || null,

                terrains,                        // ★ 转换后的地形列表
                decors: parseList(fields['装饰']),
                minis: parseList(fields['迷你建筑']),
                buildings: parseList(fields['大建筑']),
            };
        },

        // ============================================================
        // 连接行
        // - 【起点|终点|方向|距离|种类】
        // ============================================================
        _parseConnectionLine(raw) {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;

            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】/);
            if (!m) return null;

            const parts = m[1].split('|').map(s => s.trim());

            const from = parts[0];
            const to = parts[1];
            if (!from || !to || from === to) return null;

            return {
                from,
                to,
                direction: this._normalizeDir(parts[2]) || '任意',
                distance: this._normalizeDistance(parts[3]),
                kind: this._normalizeConnectionKind(parts[4]),
            };
        },

        // ============================================================
        // 出入口段
        // - 【方向|种类|名字】：描述，[目标:地图名|未知:是]
        // ============================================================
        _parseExitsBlock(block, map) {
            for (const raw of block.split('\n')) {
                const line = raw.trim();
                if (!line.startsWith('-')) continue;

                const content = line.substring(1).trim();
                const m = content.match(/^【([^】]+)】\s*[：:]\s*([\s\S]*)$/);
                if (!m) continue;

                const meta = m[1].split('|').map(s => s.trim());
                const dir = this._normalizeDir(meta[0]);
                if (!dir) {
                    console.warn('[MapParser] 未知方向:', meta[0]);
                    continue;
                }

                const { description, fields } = this._splitDescTagsAndFields(m[2] || '');
                const isUnknown = this._normalizeBool(fields['未知']);

                map.exits[dir] = {
                    kind: meta[1] || '道路',
                    label: meta[2] || `${dir}门`,
                    target: isUnknown ? null : (fields['目标'] || null),
                    description: description || '',
                };
            }
        },
        _normalizeRegionTerrains(type, terrains) {
            if (!terrains || terrains.length === 0) return terrains;

            const RULES = {
                '道路': {
                    '泥土': 'dirt_path', '土': 'dirt_path', '泥地': 'dirt_path',
                    '石板': 'stone', '石地': 'stone',
                    '碎石': 'gravel', '砾石': 'gravel',
                    '草地': 'grass', '杂草': 'tall_grass',
                    '木板': 'wooden_deck',
                },
                '山地': {
                    '岩石': 'rocky_ground', '岩': 'rocky_ground',
                    '泥土': 'dirt',
                    '草地': 'grass', '苔藓': 'moss',
                },
                '沙滩': {
                    '沙地': 'sand', '沙': 'sand',
                    '水': 'shore',
                },
                '森林': {
                    '草地': 'grass',
                    '苔藓': 'moss',
                    '泥土': 'dirt',
                },
                '湖泊': {
                    '水': 'water',
                    '沙地': 'shore',
                    '岩石': 'rocky_ground',
                },
                '广场': {
                    '石板': 'stone',
                    '泥土': 'dirt',
                    '砖': 'brick',
                },
                '村庄': {
                    '泥土': 'dirt',
                    '草地': 'grass',
                    '石板': 'stone',
                },
                '房间': {
                    '木地板': 'wood',
                    '瓷砖': 'tile',
                    '石板': 'stone',
                    '地毯': 'carpet',
                },
                '走廊': {
                    '木地板': 'wood',
                    '瓷砖': 'tile',
                    '石板': 'stone',
                },
                '大厅': {
                    '木地板': 'wood',
                    '大理石': 'marble',
                    '瓷砖': 'tile',
                },
            };

            const rule = RULES[type];
            if (!rule) return terrains;

            return terrains.map(t => rule[t] || t);
        },
        // ============================================================
        // 实体段
        // ============================================================
        _splitEntitySubsections(block) {
            const lines = block.split('\n');
            const subs = { general: [], items: [], equips: [], portals: [] };
            let mode = 'general';

            for (const raw of lines) {
                const line = raw.trim();
                if (!line) continue;

                // 子标题
                if (/^(?:NPC|npc|人物)[\s\/、,，]*[:：]?\s*$/.test(line)) { mode = 'general'; continue; }
                if (/^(?:装饰|装饰物)[\s\/、,，]*[:：]?\s*$/.test(line)) { mode = 'general'; continue; }
                if (/^(?:标记|marker)[\s\/、,，]*[:：]?\s*$/.test(line)) { mode = 'general'; continue; }
                if (/^(?:遭遇|敌人)[\s\/、,，]*[:：]?\s*$/.test(line)) { mode = 'general'; continue; }
                if (/^(?:资源点|采集点|矿脉|渔点)[\s\/、,，]*[:：]?\s*$/.test(line)) { mode = 'general'; continue; }

                if (/^(?:物品|道具)[\s\/、,，]*(?:装备)*\s*[:：]?\s*$/.test(line)) { mode = 'items'; continue; }
                if (/^(?:装备|武器|护甲)[\s\/、,，]*[:：]?\s*$/.test(line)) { mode = 'equips'; continue; }

                if (/^(?:出入口|入口|出口|传送点|门|portal)[\s（(【]*.*?[】)）]?\s*[:：]?\s*$/i.test(line)) {
                    mode = 'portals'; continue;
                }

                if (/─+\s*第[一二三四五六七八九十]+类/.test(line)) break;
                if (/^═+\s*\d+\.\d+/.test(line)) continue;

                const isEntityLine = /^[-•]?\s*【/.test(line);
                if (!isEntityLine) continue;

                const normalized = line.startsWith('-') ? line : '- ' + line;

                if (mode === 'general') {
                    // 检查类型字段
                    const bracketMatch = normalized.match(/[\[【]([^\]】]+)[\]】]/);
                    if (bracketMatch && /(^|\|)\s*类型\s*[:：]/.test(bracketMatch[1])) {
                        const typeField = bracketMatch[1];
                        if (/类型\s*[:：]\s*遭遇/.test(typeField)) { subs.general.push(normalized); continue; }
                        if (/类型\s*[:：]\s*(武器|护甲|饰品|装备|工具)/.test(typeField)) { subs.equips.push(normalized); continue; }
                        if (/类型\s*[:：]\s*(传送|出入口|portal)/.test(typeField)) { subs.portals.push(normalized); continue; }
                        subs.items.push(normalized);
                        continue;
                    }
                    // 位置化格式：第 3 位是类型
                    const metaMatch = normalized.match(/【([^】]+)】/);
                    if (metaMatch) {
                        const meta = metaMatch[1].split('|').map(s => s.trim());
                        const kindIdx = meta[2];
                        if (kindIdx === '出入口' || kindIdx === '传送门') {
                            subs.portals.push(normalized);
                            continue;
                        }
                    }
                    subs.general.push(normalized);
                    continue;
                }

                if (mode === 'items' || mode === 'equips') {
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
        // 实体行
        // - 【名字|图标|类型|区域|锚点|阻挡|性别|心情|主次】：描述，[标签...]
        // ============================================================
        _parseEntityLine(raw) {
            const line = raw.trim();
            if (!line || !line.startsWith('-')) return null;
        
            const content = line.substring(1).trim();
            const m = content.match(/^【([^】]+)】\s*[：:]\s*([\s\S]*)$/);
            if (!m) return null;
        
            const parts = m[1].split('|').map(s => s.trim());
        
            // ============================================================
            // ★ 前置过滤：识别 AI 写进【实体】段的"伪出入口"
            //   特征：
            //     1. 字段数量 ≤ 3（真实体至少 4-5 个字段）
            //     2. 第 1 位是纯方向词
            //   命中 → 直接丢弃，不进入实体列表
            // ============================================================
            if (parts.length <= 3) {
                const dirWord = parts[0];
                const PURE_DIRS = new Set([
                    '东', '南', '西', '北',
                    '东北', '东南', '西南', '西北',
                    '东侧', '南侧', '西侧', '北侧',
                    '东边', '南边', '西边', '北边',
                    '东方', '南方', '西方', '北方',
                ]);
                if (PURE_DIRS.has(String(dirWord || '').trim())) {
                    console.warn(`[MapParser] 丢弃伪出入口实体: ${parts.join('|')}`);
                    return null;
                }
            }

            // ★ 位置化格式
            const name = parts[0];
            if (!name) return null;

            const emoji = this._extractEmoji(parts[1]) || '❓';

            // ★ 先解析 fields（后面要用 fields['类型'] 推导 kind）
            const { description, tags, fields } = this._splitDescTagsAndFields(m[2] || '');

            // ★ kind 推导：位置化格式优先，兜底 fields['类型']
            let kind = this._normalizeKind(parts[2]);
            if (!kind) {
                kind = this._normalizeKindFromType(fields['类型']);
            }
            if (!kind) {
                if (parts.length <= 2) kind = 'item';
                else kind = 'npc';
            }

            // ★ 区域：优先位置化，兜底 fields['区域']
            let region = (parts[3] && parts[3] !== '-') ? parts[3] : null;
            if (!region && fields['区域']) region = fields['区域'];

            // ★ 位置：优先位置化，兜底 fields['位置']
            let position = parts[4];
            if (!position || position === '-') {
                position = fields['位置'] || '中央';
            }

            const blocking = this._normalizeBlocking(parts[5]);
            const gender = (parts[6] && parts[6] !== '-') ? parts[6] : '';
            const mood = (parts[7] && parts[7] !== '-') ? parts[7] : '';
            const role = this._normalizeRole(parts[8]);

            if (fields['可拾取'] !== undefined) {
                fields['可拾取'] = this._normalizeBool(fields['可拾取']) ? '是' : '否';
            }

            const isPlayer = kind === 'player' || name === '玩家';
            const isDecor = kind === 'decor';
            const isResource = kind === 'resource_point';

            const result = {
                id: name,
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
                meta: { gender, mood, role },

                size: isDecor ? { w: 1, h: 1 } : null,
                decorType: isDecor ? (fields['装饰类型'] || '小型建筑') : null,
                variant: isDecor ? Math.floor(Math.random() * 8) : null,
            };

            // ★ 资源点：解析 resource 数据
            if (isResource) {
                result.resource = this._parseResourceData(fields);
                // 资源点不阻挡（默认）
                if (parts[5] === undefined || parts[5] === '-') {
                    result.blocking = false;
                }
            }

            return result;
        },
        // ============================================================
        // ★ 从 fields['类型'] 推导 kind
        //   用于：位置化格式没写 kind，但方括号里有【类型:武器】
        // ============================================================
        _normalizeKindFromType(typeStr) {
            if (!typeStr) return null;
            const t = String(typeStr).trim();

            const MAP = {
                // 物品类
                '消耗品': 'item',
                '武器': 'item',
                '护甲': 'item',
                '饰品': 'item',
                '工具': 'item',
                '材料': 'item',
                '食物': 'item',
                '杂物': 'item',
                '货币': 'item',
                '物品': 'item',
                '道具': 'item',
                '装备': 'item',

                // 遭遇
                '遭遇': 'encounter',
                '敌人': 'encounter',

                // 装饰
                '装饰': 'decor',
                '装饰物': 'decor',

                // 标记
                '标记': 'marker',
                '任务点': 'quest_point',

                // 资源点
                '资源点': 'resource_point',
                '采集点': 'resource_point',
                '矿脉': 'resource_point',
                '渔点': 'resource_point',

                // 出入口
                '出入口': 'portal',
                '传送门': 'portal',
            };

            return MAP[t] || null;
        },
        // ============================================================
        // ★ 资源点数据解析
        //   字段格式：
        //     [类型:采集|消耗:体力×3、鱼饵×1|产出:苹果×1|概率:金苹果×1:5%
        //      |次数:3|刷新:24小时|交互名:采摘|交互图标:🖐️]
        // ============================================================
        _parseResourceData(fields) {
            const resource = {
                type: fields['类型'] || '采集',
                actionName: fields['交互名'] || '互动',
                actionEmoji: fields['交互图标'] || '✨',
                actionDesc: fields['交互描述'] || '',

                cost: {},
                rewards: [],

                uses: {
                    current: 0,
                    max: 0,
                    refreshHours: 0,
                    refreshCountPerPeriod: 1,
                    lastRefreshAt: 0,
                },
            };

            // ---------- 消耗 ----------
            // "体力×3、鱼饵×1"
            if (fields['消耗']) {
                for (const pair of String(fields['消耗']).split(/[、,，]/)) {
                    const m = pair.trim().match(/^(.+?)\s*[×xX*]\s*(\d+)$/);
                    if (m) {
                        resource.cost[m[1].trim()] = parseInt(m[2]);
                    } else {
                        // "体力 3" 格式兜底
                        const m2 = pair.trim().match(/^(.+?)\s+(\d+)$/);
                        if (m2) resource.cost[m2[1].trim()] = parseInt(m2[2]);
                    }
                }
            }

            // ---------- 产出（必得） ----------
            // "苹果×1、树枝×2"
            if (fields['产出']) {
                for (const pair of String(fields['产出']).split(/[、,，]/)) {
                    const m = pair.trim().match(/^(.+?)\s*[×xX*]\s*(\d+)$/);
                    if (m) {
                        resource.rewards.push({
                            item: m[1].trim(),
                            count: parseInt(m[2]),
                            chance: 1.0,
                        });
                    }
                }
            }

            // ---------- 概率产出 ----------
            // "金苹果×1:5%、宝箱×1:1%"
            if (fields['概率']) {
                for (const pair of String(fields['概率']).split(/[、,，]/)) {
                    const m = pair.trim().match(/^(.+?)\s*[×xX*]\s*(\d+)\s*[:：]\s*([\d.]+)\s*%$/);
                    if (m) {
                        resource.rewards.push({
                            item: m[1].trim(),
                            count: parseInt(m[2]),
                            chance: parseFloat(m[3]) / 100,
                        });
                    }
                }
            }

            // ---------- 次数 ----------
            // "3" 或 "0"（0 = 无限）
            if (fields['次数'] !== undefined) {
                const n = parseInt(fields['次数']);
                if (!isNaN(n)) {
                    resource.uses.max = n;
                    resource.uses.current = n;
                }
            }

            // ---------- 刷新周期 ----------
            // "24小时" / "3天" / "1周"
            if (fields['刷新']) {
                const m = String(fields['刷新']).match(/(\d+)\s*(小时|钟头|时|h|天|日|周|星期)/);
                if (m) {
                    const n = parseInt(m[1]);
                    const unit = m[2];
                    let hours = n;
                    if (/天|日/.test(unit)) hours = n * 24;
                    else if (/周|星期/.test(unit)) hours = n * 24 * 7;
                    resource.uses.refreshHours = hours;
                }
            }

            // ---------- 每次刷新恢复几次 ----------
            // "每次刷新恢复 2 次" → refreshCountPerPeriod: 2
            if (fields['恢复']) {
                const n = parseInt(fields['恢复']);
                if (!isNaN(n) && n > 0) {
                    resource.uses.refreshCountPerPeriod = n;
                }
            }

            // ---------- 无限次数：max=0，current 也是 0，但要允许无限用 ----------
            // 用一个标记区分"没写次数"和"写了次数:0"
            resource.uses.infinite = (resource.uses.max === 0);

            return resource;
        },
        // ============================================================
        // 工具
        // ============================================================
        _section(text, title) {
            const re1 = new RegExp(`【${title}】\\s*([\\s\\S]*?)(?=\\n【|$)`);
            const m1 = text.match(re1);
            if (m1) return m1[1].trim();

            const re2 = new RegExp(
                `─+\\s*第[一二三四五六七八九十]+类[：:]\\s*${title}\\s*─+\\s*([\\s\\S]*?)(?=\\n─+\\s*第[一二三四五六七八九十]+类|$)`
            );
            const m2 = text.match(re2);
            if (m2) return m2[1].trim();

            return '';
        },

        _kv(block, key) {
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
                description = s.substring(0, brackets[0].index).trim()
                    .replace(/^[，,、\s]+|[，,、\s]+$/g, '');

                for (const b of brackets) {
                    const inner = b.inner.trim();
                    if (/[:：]/.test(inner)) {
                        for (const pair of inner.split('|')) {
                            const kv = pair.match(/^(.+?)[:：]\s*([\s\S]+)$/);
                            if (kv) fields[kv[1].trim()] = kv[2].trim();
                        }
                    } else {
                        tags.push(...inner.split(/[、,，]/).map(t => t.trim()).filter(Boolean));
                    }
                }
            }

            return { description, tags, fields };
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

        // ---------- 中文归一化 ----------
        _normalizeDir(input) {
            if (!input) return null;
            const s = String(input).trim();
            const MAP = {
                '东': 'east', 'east': 'east', 'e': 'east', '右': 'east',
                '南': 'south', 'south': 'south', 's': 'south', '下': 'south',
                '西': 'west', 'west': 'west', 'w': 'west', '左': 'west',
                '北': 'north', 'north': 'north', 'n': 'north', '上': 'north',
                '东北': 'northeast', 'northeast': 'northeast', 'ne': 'northeast',
                '东南': 'southeast', 'southeast': 'southeast', 'se': 'southeast',
                '西南': 'southwest', 'southwest': 'southwest', 'sw': 'southwest',
                '西北': 'northwest', 'northwest': 'northwest', 'nw': 'northwest',
                '任意': 'any', 'any': 'any',
            };
            return MAP[s] || null;
        },

        _normalizeSize(s) {
            const MAP = {
                '极小': 'tiny', '小': 'small', '中': 'medium', '大': 'large', '巨大': 'huge',
                'tiny': 'tiny', 'small': 'small', 'medium': 'medium',
                'large': 'large', 'huge': 'huge',
            };
            return MAP[s] || s || null;
        },

        _normalizeDistance(s) {
            const MAP = { '近': 'near', '中': 'medium', '远': 'far', 'near': 'near', 'medium': 'medium', 'far': 'far' };
            return MAP[s] || 'near';
        },

        _normalizeConnectionKind(s) {
            const MAP = {
                '道路': 'road', 'road': 'road',
                '小径': 'path', 'path': 'path',
                '门': 'door', 'door': 'door',
                '传送门': 'portal', 'portal': 'portal',
            };
            return MAP[s] || 'road';
        },

        _normalizeKind(s) {
            if (!s) return 'npc';
            const t = String(s).trim().toLowerCase();
            const MAP = {
                'npc': 'npc', '人物': 'npc', '角色': 'npc',
                'decor': 'decor', '装饰': 'decor', '装饰物': 'decor',
                'marker': 'marker', '标记': 'marker',
                'encounter': 'encounter', '遭遇': 'encounter', '敌人': 'encounter',
                'portal': 'portal', '出入口': 'portal', '传送门': 'portal',
                'player': 'player', '玩家': 'player',
                'item': 'item', '物品': 'item',
                'building': 'decor',  // 兼容
                '资源点': 'resource_point',
                'resource': 'resource_point',
            };
            return MAP[t] || null;
        },

        _normalizeBlocking(s) {
            if (!s) return true;
            const t = String(s).trim().toLowerCase();
            if (['阻挡', 'yes', 'true', '1', '是', '可', 'y', '阻挡的'].includes(t)) return true;
            if (['不阻挡', 'no', 'false', '0', '否', '不可', 'n'].includes(t)) return false;
            return true;
        },

        _normalizeRole(s) {
            if (!s) return null;
            const t = String(s).trim();
            if (/主要/.test(t)) return 'main';
            if (/次要/.test(t)) return 'minor';
            if (/路人/.test(t)) return 'npc';
            return null;
        },

        _normalizeBool(v) {
            if (v === true) return true;
            if (v === false || v === undefined || v === null) return false;
            const s = String(v).trim().toLowerCase();
            return ['是', 'yes', 'true', '1', 'y', '可', '能'].includes(s);
        },

        _parseCount(v) {
            if (v === undefined || v === null || v === '') return 1;
            const m = String(v).match(/(\d+)/);
            if (m) return Math.max(1, parseInt(m[1]));
            return 1;
        },

        _inferCountMode(kind, fields) {
            if (kind !== 'npc' && kind !== 'encounter') return 'single';
            const n = this._parseCount(fields?.['数量']);
            return n <= 1 ? 'single' : 'cluster';
        },

        _parseMapStyle(block) {
            const line = block.split('\n').find(l => l.trim().startsWith('-'));
            if (!line) return null;

            const m = line.match(/^-\s*【([^】]+)】/);
            if (!m) return null;

            const meta = m[1].split('|').map(s => s.trim());
            return {
                id: meta[0] || 'default',
                name: meta[0] || '默认',
                keywords: (meta[1] || '').split(/[、,，]/).map(s => s.trim()).filter(Boolean),
            };
        },

        _parseSpatialBlock(block) {
            const spatial = {};
            for (const raw of block.split('\n')) {
                const line = raw.trim();
                if (!line || line.startsWith('#') || line.startsWith('//')) continue;

                const m = line.match(/^[-•]?\s*([^:：]+)\s*[:：]\s*(.+)$/);
                if (!m) continue;

                const dir = this._normalizeDir(m[1].trim());
                if (!dir) continue;

                let value = m[2].trim();
                if (/^(未知|unknown|\?|-|无)$/i.test(value)) {
                    spatial[dir] = null;
                } else {
                    value = value.replace(/^[\[【]|[\]】]$/g, '').trim();
                    spatial[dir] = value;
                }
            }
            return spatial;
        },
        // MapParser 里加：
        _normalizeTerrain(s) {
            const MAP = {
                '草地': 'grass', '深草': 'tall_grass', '干草': 'dry_grass',
                '泥土': 'dirt', '土': 'dirt', '泥地': 'dirt',
                '沙地': 'sand', '沙滩': 'sand',
                '雪地': 'snow', '雪': 'snow',
                '碎石': 'gravel', '碎石地': 'gravel',
                '土路': 'dirt_path',
                '石板': 'stone', '石板路': 'stone', '石地': 'stone',
                '鹅卵石': 'cobblestone',
                '柏油': 'asphalt', '沥青': 'asphalt',
                '水泥': 'concrete', '混凝土': 'concrete',
                '砖': 'brick', '红砖': 'brick',
                '瓷砖': 'tile', '地砖': 'tile',
                '木栈道': 'wooden_deck',
                '木地板': 'wood', '木地': 'wood',
                '大理石': 'marble',
                '地毯': 'carpet', '红毯': 'carpet',
                '灰地毯': 'gray_carpet',
                '陶瓷': 'ceramic',
                '拼木': 'parquet',
                '花纹地砖': 'patterned_tile',
                '砖墙': 'wall', '墙': 'wall',
                '石墙': 'stone_wall',
                '水泥墙': 'concrete_wall',
                '木墙': 'wood_wall',
                '白墙': 'white_wall',
                '玻璃幕墙': 'glass_wall',
                '铁皮墙': 'metal_wall',
                '瓷砖墙': 'tile_wall',
                '水': 'water', '水面': 'water',
                '深水': 'deep_water',
                '海水': 'sea', '海': 'sea',
                '湖水': 'lake', '湖': 'lake',
                '河水': 'river', '河': 'river',
                '波纹': 'ripple',
                '水下': 'underwater',
                '瀑布': 'waterfall',
                '草地边缘': 'grass_edge',
                '岸边': 'shore', '水岸': 'shore', '滩涂': 'shore',
                '沙滩边缘': 'beach_edge',
                '雪地边缘': 'snow_edge',
                '岩石': 'rocky_ground', '岩石地面': 'rocky_ground', '岩': 'rocky_ground',
                '崖顶': 'cliff_top', '山顶': 'cliff_top',
                '泥地边缘': 'mud_edge',
                '落叶': 'fallen_leaves', '枯叶': 'fallen_leaves',
                '岩浆': 'lava', '熔岩': 'lava',
                '沼泽': 'swamp', '湿地': 'swamp',
                '冰': 'ice', '冰面': 'ice',
                '雪原': 'snow_field',
                '苔藓': 'moss', '苔': 'moss', '青苔': 'moss',
                '藤蔓': 'vine_ground', '藤': 'vine_ground',
                '花田': 'flower_field', '花海': 'flower_field',
                '枯草': 'dead_grass',
                '虚空': 'void',
                '纯白地': 'white_floor',
                '纯灰地': 'gray_floor',
                '棋盘格': 'checkerboard',
                '警告条纹': 'warning',
                '金属地板': 'metal_floor',
                '发光地板': 'glowing_floor',
                '透明': 'transparent',
                '道路': 'road', '路': 'road',
                '小径': 'path',
                '地板': 'floor',
            };
            return MAP[s] || s;
        },
        _normalizeDecor(s) {
            const MAP = {
                '树': 'tree', '树木': 'tree', '树林': 'tree', '乔木': 'tree',
                '樱花': 'tree', '松树': 'tree', '枯树': 'tree',
                '花': 'plant', '野花': 'plant', '植物': 'plant', '灌木': 'plant',
                '石头': 'rock', '岩石': 'rock', '碎石': 'rock',
                '路灯': 'lamp', '街灯': 'lamp',
                '长椅': 'bench', '凳子': 'bench',
                '垃圾桶': 'trash',
                '告示板': 'sign', '路标': 'sign', '牌子': 'sign',
                '小摊': 'small_building', '摊位': 'small_building',
                '井': 'small_building', '水井': 'small_building',
                '信箱': 'mailbox',
                '公交站': 'bus_stop',
                '消防栓': 'hydrant',
            };
            return MAP[s] || s;
        },
        _parseHeightBlock(block) {
            const heights = { _base: 0 };
            for (const raw of block.split('\n')) {
                const line = raw.trim();
                if (!line) continue;

                const m = line.match(/^[-•]?\s*([^:：]+)\s*[:：]\s*(-?\d+)$/);
                if (!m) continue;

                const key = m[1].trim();
                const value = parseInt(m[2]);

                if (key === '基准' || key === 'base') {
                    heights._base = value;
                } else {
                    heights[key] = value;
                }
            }
            return heights;
        },
    };

    window.MapParser = MapParser;
    console.log('[CinemaWorld] map-parser.js 已加载（全中文，无 ID）');
})();