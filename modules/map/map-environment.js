// ============================================================
// CinemaWorld · map-environment.js
// 地图环境时钟 + 动态环境数据 + 昼夜滤镜缓存 + 地图模式 HUD
//
// ★ 时间规则：从 window.TimeRuleEngine 读（如果 AI 生成了【时间规则】段）
//              没生成则走默认值
//
// ★ 懒更新设计：
//   - worldMinutes 是世界唯一真相（无论玩家在哪都在走）
//   - 每张地图记 lastTickAt
//   - 玩家进入地图时才 catchUpMap 补算 delta
//   - 当前地图实时推进（HUD、昼夜、farm）
//
// 暴露：window.EnvironmentClock
//       window.EnvironmentManager
//       window.EnvironmentHUD
//       window.DayNightFilter
//       window.CWEnv
// ============================================================

(function () {
    'use strict';

    // ============================================================
    // 0. 环境数据读写
    // ============================================================

    function getActiveMap() {
        try {
            return window.MapLauncher?.getMap?.() || null;
        } catch (e) {
            return null;
        }
    }

    function ensureEnvData(map) {
        if (!map) return null;

        const ws = window.CinemaWorld?.worldState;
        const stored = ws?.maps?.[map.name]?._environment;

        // 用已存储的 env 补齐（仅当 map 上还没有完整 env）
        if (stored
            && (!map._environment
                || !map._environment._order
                || map._environment._order.length === 0)) {
            map._environment = stored;
        }

        // 建/取 env（★ 只声明一次）
        let env = map._environment;
        if (!env) {
            env = { _order: [], _raw: '' };
            map._environment = env;
        }

        if (!Array.isArray(env._order)) env._order = [];
        if (typeof env._raw !== 'string') env._raw = '';

        // _runtime 结构保证
        if (!env._runtime) {
            env._runtime = {
                totalMinutes: null,
                lastRollHour: -1,
                lastRollDay: -1,
                dayBaseTemp: null,
                dayBaseHumidity: null,
                dayBaseWind: null,
                lastTickAt: null,        // ★ 懒更新用
            };
        } else {
            // ★ 老存档兜底
            if (env._runtime.totalMinutes === undefined) env._runtime.totalMinutes = null;
            if (env._runtime.lastRollHour === undefined) env._runtime.lastRollHour = -1;
            if (env._runtime.lastRollDay === undefined) env._runtime.lastRollDay = -1;
            if (env._runtime.dayBaseTemp === undefined) env._runtime.dayBaseTemp = null;
            if (env._runtime.dayBaseHumidity === undefined) env._runtime.dayBaseHumidity = null;
            if (env._runtime.dayBaseWind === undefined) env._runtime.dayBaseWind = null;
            if (env._runtime.lastTickAt === undefined) env._runtime.lastTickAt = null;
        }

        return env;
    }

    function readField(env, key) {
        const v = env?.[key];
        if (v === undefined || v === null) return '';
        return String(v).trim();
    }

    function writeField(env, key, value) {
        if (!env) return;
        if (value === undefined || value === null || value === '') return;
        const v = String(value);
        if (!env._order.includes(key)) env._order.push(key);
        env[key] = v;
    }

    function deleteField(env, key) {
        if (!env) return;
        delete env[key];
        const idx = env._order.indexOf(key);
        if (idx > -1) env._order.splice(idx, 1);
    }

    function rebuildRaw(env) {
        if (!env) return;
        env._raw = env._order
            .filter(k => env[k] !== undefined && env[k] !== '')
            .map(k => `${k}:${env[k]}`)
            .join('|');
    }

    // ---------- 读时间规则（带兜底）----------
    function getTimeRules() {
        const r = window.TimeRuleEngine?.rules;
        if (!r || !r.structure) {
            return {
                hoursPerDay: 24,
                daysPerMonth: 30,
                monthsPerYear: 12,
                startDate: { year: 1, month: 1, day: 1, hour: 6, minute: 0 },
                speed: 1,
            };
        }
        return {
            hoursPerDay: r.structure.hoursPerDay || 24,
            daysPerMonth: r.structure.daysPerMonth || 30,
            monthsPerYear: r.structure.monthsPerYear || 12,
            startDate: r.structure.startDate || { year: 1, month: 1, day: 1, hour: 6, minute: 0 },
            speed: r.speed?.minutesPerRealSecond || 1,
        };
    }

    // ============================================================
    // 1. 时间解析 / 格式化
    // ============================================================

    function parseTotalMinutes(env) {
        if (!env) return null;

        if (typeof env._runtime?.totalMinutes === 'number') {
            return env._runtime.totalMinutes;
        }

        const timeStr = readField(env, '时间');
        const dateStr = readField(env, '日期');
        const tr = getTimeRules();
        const { hoursPerDay: HPD, daysPerMonth: DPM, monthsPerYear: MPY } = tr;

        let dayIndex = 1;
        if (dateStr) {
            const m = dateStr.match(/(\d+)年(\d+)月(\d+)日/);
            if (m) {
                const y = parseInt(m[1]);
                const mo = parseInt(m[2]);
                const d = parseInt(m[3]);
                dayIndex = (y - 1) * DPM * MPY + (mo - 1) * DPM + d;
            }
        }

        let hh = tr.startDate.hour, mm = tr.startDate.minute;
        if (timeStr) {
            const m = timeStr.match(/(\d{1,2})[:：](\d{2})/);
            if (m) {
                hh = parseInt(m[1]);
                mm = parseInt(m[2]);
            }
        }

        const total = (dayIndex - 1) * HPD * 60 + hh * 60 + mm;
        if (env._runtime) env._runtime.totalMinutes = total;
        return total;
    }

    function writeTimeFields(env, totalMinutes) {
        if (!env) return null;

        const tr = getTimeRules();
        const { hoursPerDay: HPD, daysPerMonth: DPM, monthsPerYear: MPY } = tr;

        const minutesPerDay = HPD * 60;
        const minutesPerMonth = DPM * minutesPerDay;
        const minutesPerYear = MPY * minutesPerMonth;

        const year = Math.floor(totalMinutes / minutesPerYear) + 1;
        const remAfterYear = totalMinutes % minutesPerYear;
        const month = Math.floor(remAfterYear / minutesPerMonth) + 1;
        const remAfterMonth = remAfterYear % minutesPerMonth;
        const dayOfMonth = Math.floor(remAfterMonth / minutesPerDay) + 1;
        const remAfterDay = remAfterMonth % minutesPerDay;
        const hour = Math.floor(remAfterDay / 60);
        const minute = remAfterDay % 60;

        writeField(env, '时间', `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
        writeField(env, '日期', `${year}年${month}月${dayOfMonth}日`);

        // 季节
        let season = '';
        if (window.TimeRuleEngine?.getSeason) {
            const s = window.TimeRuleEngine.getSeason(month);
            if (s) season = s.name;
        }
        if (!season) {
            season = (month >= 3 && month <= 5) ? '春'
                : (month >= 6 && month <= 8) ? '夏'
                    : (month >= 9 && month <= 11) ? '秋' : '冬';
        }
        writeField(env, '季节', season);

        // 时段
        let phase = '';
        if (window.TimeRuleEngine?.getPhase) {
            const p = window.TimeRuleEngine.getPhase(hour);
            if (p) phase = p.name;
        }
        if (phase) {
            writeField(env, '时段', phase);
        } else {
            deleteField(env, '时段');
        }

        // 节日
        if (window.TimeRuleEngine?.getFestival) {
            const fest = window.TimeRuleEngine.getFestival(month, dayOfMonth);
            if (fest) {
                writeField(env, '节日', fest.name);
            } else {
                deleteField(env, '节日');
            }
        }

        if (!env._runtime) env._runtime = {};
        env._runtime.totalMinutes = totalMinutes;

        return {
            day: Math.floor(totalMinutes / minutesPerDay) + 1,
            hour, minute, year, month, dayOfMonth, season, phase,
        };
    }

    // ============================================================
    // 2. 天气 / 派生值
    // ============================================================

    const WEATHER_ICON = {
        '晴': '☀️', '多云': '⛅', '阴': '☁️',
        '小雨': '🌦️', '大雨': '🌧️', '雷阵雨': '⛈️',
        '小雪': '🌨️', '大雪': '❄️', '雾': '🌫️',
        '沙尘': '🌪️', '大风': '💨',
    };

    const DEFAULT_WEATHER_POOL = {
        '春': ['晴', '多云', '阴', '小雨', '雷阵雨', '雾'],
        '夏': ['晴', '多云', '雷阵雨', '大雨', '阴'],
        '秋': ['晴', '多云', '阴', '小雨', '雾'],
        '冬': ['晴', '阴', '小雪', '大雪', '雾'],
    };

    const SEASON_TEMP = {
        '春': { base: 15, amplitude: 8 },
        '夏': { base: 28, amplitude: 6 },
        '秋': { base: 18, amplitude: 8 },
        '冬': { base: 2, amplitude: 6 },
    };

    function weatherTempMod(weather) {
        if (/大雪|大雨|雷/.test(weather)) return -5;
        if (/小雪|小雨/.test(weather)) return -2;
        if (/雾|阴/.test(weather)) return -1;
        if (/晴/.test(weather)) return +2;
        if (/沙尘|大风/.test(weather)) return -1;
        return 0;
    }

    function weatherHumidityBase(weather) {
        if (/大雨|雷/.test(weather)) return 85;
        if (/小雨|小雪|大雪/.test(weather)) return 75;
        if (/雾/.test(weather)) return 80;
        if (/阴|多云/.test(weather)) return 55;
        if (/晴/.test(weather)) return 40;
        if (/沙尘/.test(weather)) return 25;
        return 55;
    }

    function weatherWindBase(weather) {
        if (/雷|大风/.test(weather)) return 6;
        if (/大雨|大雪/.test(weather)) return 4;
        if (/小雨|小雪/.test(weather)) return 3;
        if (/阴|多云|雾/.test(weather)) return 2;
        if (/晴/.test(weather)) return 2;
        if (/沙尘/.test(weather)) return 5;
        return 2;
    }

    function hourCurve(hour) {
        return Math.sin((hour - 4) / 24 * Math.PI * 2) * 0.5 + 0.5;
    }

    function pickWeather(season, customPool) {
        if (window.TimeRuleEngine?.getWeatherPool) {
            const rulePool = window.TimeRuleEngine.getWeatherPool(season);
            if (rulePool && rulePool.length > 0) {
                return rulePool[Math.floor(Math.random() * rulePool.length)];
            }
        }
        const pool = (customPool && customPool.length > 0)
            ? customPool
            : (DEFAULT_WEATHER_POOL[season] || DEFAULT_WEATHER_POOL['春']);

        const weighted = [];
        for (const w of pool) {
            let weight = 1;
            if (/晴|多云/.test(w)) weight = 3;
            if (/阴/.test(w)) weight = 2;
            if (/雷|暴|大/.test(w)) weight = 1;
            for (let i = 0; i < weight; i++) weighted.push(w);
        }
        return weighted[Math.floor(Math.random() * weighted.length)];
    }

    function computeDayBase(env) {
        const season = readField(env, '季节') || '春';
        const weather = readField(env, '天气') || '晴';
        const conf = SEASON_TEMP[season] || SEASON_TEMP['春'];

        const dailyNoise = (Math.random() - 0.5) * conf.amplitude * 0.6;
        const dayBaseTemp = conf.base + weatherTempMod(weather) + dailyNoise;

        const dailyHumNoise = (Math.random() - 0.5) * 12;
        const dayBaseHumidity = weatherHumidityBase(weather) + dailyHumNoise;

        const dayBaseWind = weatherWindBase(weather) + (Math.random() - 0.5) * 1.5;

        env._runtime.dayBaseTemp = dayBaseTemp;
        env._runtime.dayBaseHumidity = dayBaseHumidity;
        env._runtime.dayBaseWind = dayBaseWind;

        return { dayBaseTemp, dayBaseHumidity, dayBaseWind };
    }

    function deriveTempAtHour(env, hour) {
        const base = env._runtime.dayBaseTemp ?? 15;
        const season = readField(env, '季节') || '春';
        const conf = SEASON_TEMP[season] || SEASON_TEMP['春'];

        const curve = hourCurve(hour);
        const swing = (curve - 0.5) * conf.amplitude;
        const noise = (Math.random() - 0.5) * 0.6;

        return Math.round(base + swing + noise);
    }

    function deriveHumidityAtHour(env, hour) {
        const base = env._runtime.dayBaseHumidity ?? 55;
        const curve = hourCurve(hour);
        const swing = (0.5 - curve) * 15;
        const noise = (Math.random() - 0.5) * 3;
        return Math.max(10, Math.min(98, Math.round(base + swing + noise)));
    }

    function deriveWindAtHour(env, hour) {
        const base = env._runtime.dayBaseWind ?? 2;
        const dayPart = (hour >= 8 && hour <= 18) ? 1 : 0;
        const swing = dayPart ? 0.8 : -0.5;
        const noise = (Math.random() - 0.5) * 0.8;
        return Math.max(0, Math.min(12, Math.round(base + swing + noise)));
    }

    // ============================================================
    // 3. 昼夜滤镜计算
    // ============================================================

    function dayNightFactor(hour) {
        return (1 - Math.cos((hour - 12) / 24 * Math.PI * 2)) / 2;
    }

    function twilightWarmth(hour) {
        const dawn = Math.max(0, 1 - Math.abs(hour - 6) / 2);
        const dusk = Math.max(0, 1 - Math.abs(hour - 18) / 2);
        return Math.max(dawn, dusk);
    }

    function computeDayNightFilter(hour, weather = '晴') {
        const dark = dayNightFactor(hour);
        const warm = twilightWarmth(hour);

        const nightR = 30, nightG = 40, nightB = 90;
        const warmR = 255, warmG = 140, warmB = 60;

        const warmMix = warm * Math.max(0, dark - 0.3) / 0.7;

        const r = Math.round(nightR * (1 - warmMix) + warmR * warmMix);
        const g = Math.round(nightG * (1 - warmMix) + warmG * warmMix);
        const b = Math.round(nightB * (1 - warmMix) + warmB * warmMix);

        let alpha = dark * 0.55;

        if (/大雨|雷/.test(weather)) alpha += 0.12;
        else if (/小雨|小雪|大雪/.test(weather)) alpha += 0.08;
        else if (/雾/.test(weather)) alpha += 0.06;
        else if (/阴/.test(weather)) alpha += 0.03;

        alpha = Math.min(0.65, alpha);

        if (alpha <= 0.01) return null;
        return { r, g, b, alpha };
    }

    // ============================================================
    // 4. 昼夜滤镜缓存
    // ============================================================
    const DayNightFilter = {
        _cached: null,
        _prev: null,
        _hourKey: null,
        _transitionStart: 0,
        _transitionDuration: 800,

        init() {
            window.addEventListener('cw:env-hour', () => this._onHourChange());
            this.refresh();
            console.log('[DayNight] 已初始化');
        },

        // ★ 单一入口：任何地方都可以调，内部自带保护
        refresh() {
            const map = getActiveMap();
            if (!map) return;
            if (!map._generated) return;

            const env = ensureEnvData(map);
            if (!env) return;
            if (!readField(env, '时间')) return;

            const hour = this._readHour(env);
            const weather = readField(env, '天气') || '晴';

            this._cached = computeDayNightFilter(hour, weather);
            this._prev = null;
            this._hourKey = hour;
        },

        _onHourChange() {
            const map = getActiveMap();
            if (!map || !map._generated) return;

            const env = ensureEnvData(map);
            if (!env) return;
            if (!readField(env, '时间')) return;

            const hour = this._readHour(env);
            const weather = readField(env, '天气') || '晴';
            const newColor = computeDayNightFilter(hour, weather);

            this._prev = this._cached;
            this._cached = newColor;
            this._hourKey = hour;
            this._transitionStart = performance.now();

            const str = newColor
                ? `rgba(${newColor.r},${newColor.g},${newColor.b},${newColor.alpha.toFixed(2)})`
                : '无滤镜';
            console.log(`[DayNight] ${String(hour).padStart(2, '0')}:00 → ${str}`);
        },

        _readHour(env) {
            const timeStr = readField(env, '时间');
            const m = timeStr.match(/^(\d{1,2})[:：]/);
            if (m) return parseInt(m[1]);

            const total = parseTotalMinutes(env);
            if (total !== null) {
                const tr = getTimeRules();
                return Math.floor((total % (tr.hoursPerDay * 60)) / 60);
            }
            return 12;
        },

        getCurrent() {
            if (!this._cached) return null;
            if (!this._prev) return this._cached;

            const elapsed = performance.now() - this._transitionStart;
            const t = Math.min(1, elapsed / this._transitionDuration);

            if (t >= 1) {
                this._prev = null;
                return this._cached;
            }

            return {
                r: Math.round(this._prev.r + (this._cached.r - this._prev.r) * t),
                g: Math.round(this._prev.g + (this._cached.g - this._prev.g) * t),
                b: Math.round(this._prev.b + (this._cached.b - this._prev.b) * t),
                alpha: this._prev.alpha + (this._cached.alpha - this._prev.alpha) * t,
            };
        },
    };

    // ============================================================
    // 5. 世界时钟（懒更新核心）
    // ============================================================
    const EnvironmentClock = {
        DEFAULT_CONFIG: {
            enabled: true,
            minutesPerRealSecond: 1,
            minStepMinutes: 1,
        },

        _accumulator: 0,
        _lastRealTs: 0,
        _running: false,
        _rafId: null,

        _listeners: { minute: [], hour: [], day: [] },

        init() {
            const tr = getTimeRules();
            this.DEFAULT_CONFIG.minutesPerRealSecond = tr.speed;

            this._lastRealTs = performance.now();
            this._running = true;
            this._loop();
            console.log('[EnvClock] 已启动，速度:', this.DEFAULT_CONFIG.minutesPerRealSecond, '游戏分/现实秒');
        },

        _loop() {
            if (!this._running) return;
            const now = performance.now();
            const dtRealSec = Math.min(0.5, (now - this._lastRealTs) / 1000);
            this._lastRealTs = now;
            this.tick(dtRealSec);
            this._rafId = requestAnimationFrame(() => this._loop());
        },

        tick(dtRealSec) {
            const playMode = window.CinemaWorld?.worldState?.playMode;
            if (playMode !== 'map') return;

            const map = getActiveMap();
            if (!map) return;

            const env = ensureEnvData(map);
            if (!env) return;

            const speed = this.DEFAULT_CONFIG.minutesPerRealSecond;
            this._accumulator += dtRealSec * speed;

            const step = this.DEFAULT_CONFIG.minStepMinutes;
            if (this._accumulator < step) return;

            const wholeMinutes = Math.floor(this._accumulator);
            this._accumulator -= wholeMinutes;

            this.advance(wholeMinutes);
        },

        // ============================================================
        // ★ 核心：只推进世界时钟 + 当前地图
        // ============================================================
        advance(minutes) {
            if (!minutes || minutes <= 0) return;

            const ws = window.CinemaWorld?.worldState;
            if (!ws) return;

            // ★ 世界时钟：唯一真相
            ws.worldMinutes = (ws.worldMinutes || 0) + minutes;

            // ★ 广播世界 tick（farm 等系统可监听）
            window.dispatchEvent(new CustomEvent('cw:world-tick', {
                detail: { deltaMinutes: minutes, worldMinutes: ws.worldMinutes }
            }));

            // ★ 只推进"当前地图"的实时 env
            const activeMap = getActiveMap();
            if (!activeMap) return;

            this._advanceActiveMap(activeMap, minutes);
        },

        // ★ 只推进当前地图（实时逻辑，会发 day/hour/minute 事件）
        _advanceActiveMap(map, minutes) {
            const env = ensureEnvData(map);
            if (!env) return;

            const tr = getTimeRules();
            const minPerDay = tr.hoursPerDay * 60;

            const oldTotal = parseTotalMinutes(env);
            if (oldTotal === null) return;

            const oldDayIndex = Math.floor(oldTotal / minPerDay);
            const oldHour = Math.floor((oldTotal % minPerDay) / 60);

            const total = oldTotal + minutes;
            const derived = writeTimeFields(env, total);
            rebuildRaw(env);

            // 1. 跨天
            if (derived.day > oldDayIndex) {
                const crossedDays = derived.day - oldDayIndex;
                for (let i = 0; i < crossedDays; i++) {
                    this._emit('day', {
                        day: oldDayIndex + i + 1,
                        map, env,
                    });
                }
            }

            // 2. 跨小时
            if (derived.hour !== oldHour) {
                this._emit('hour', {
                    hour: derived.hour,
                    day: derived.day,
                    map, env,
                });
                window.MapLauncher?._saveMapToWorld?.(map);
            }

            // 3. 每分钟
            this._emit('minute', {
                minute: derived.minute,
                hour: derived.hour,
                day: derived.day,
                map, env,
            });

            // ★ 记录当前地图的 tick 时间
            env._runtime.lastTickAt = total;
        },

        // ============================================================
        // ★ 玩家进入地图 → 按 delta 补算
        // ============================================================
        catchUpMap(map) {
            if (!map) return;

            const ws = window.CinemaWorld?.worldState;
            if (!ws) return;

            const env = ensureEnvData(map);
            if (!env) return;

            const worldMinutes = ws.worldMinutes || 0;
            const lastTick = env._runtime.lastTickAt;

            // 首次进入（没有 lastTickAt）→ 用当前世界时间初始化
            if (typeof lastTick !== 'number') {
                env._runtime.lastTickAt = worldMinutes;
                return;
            }

            const delta = worldMinutes - lastTick;
            if (delta <= 0) return;

            console.log(`[EnvClock] catchUp ${map.name}: +${delta} 分钟`);

            const tr = getTimeRules();
            const minPerDay = tr.hoursPerDay * 60;

            const total = (env._runtime.totalMinutes || 0) + delta;

            // ★ 只推进 env 时间，不触发 day/hour 事件
            const savedRuntime = env._runtime;
            writeTimeFields(env, total);
            env._runtime = savedRuntime;
            env._runtime.totalMinutes = total;
            env._runtime.lastTickAt = worldMinutes;

            // 天气按天重 roll（补上跨越的天数）
            const lastDay = env._runtime.lastRollDay ?? -1;
            const curDay = Math.floor(total / minPerDay) + 1;
            if (curDay !== lastDay) {
                env._runtime.lastRollDay = curDay;
                const season = readField(env, '季节') || '春';
                const forecast = readField(env, '明日');
                writeField(env, '天气', forecast || pickWeather(season, env._weatherPool || null));
                writeField(env, '明日', pickWeather(season, env._weatherPool || null));
                computeDayBase(env);
            }

            // 温度/湿度按当前小时重算
            const hourNow = Math.floor((total % minPerDay) / 60);
            writeField(env, '温度', `${deriveTempAtHour(env, hourNow)}°C`);
            writeField(env, '湿度', `${deriveHumidityAtHour(env, hourNow)}%`);
            writeField(env, '风力', `${deriveWindAtHour(env, hourNow)}级`);
            env._runtime.lastRollHour = hourNow;

            rebuildRaw(env);

            // ★ 广播"地图补算完成"，让 farm 消费
            window.dispatchEvent(new CustomEvent('cw:map-catchup', {
                detail: { map, env, deltaMinutes: delta }
            }));

            console.log(`[EnvClock] catchUp ${map.name} 完成`);
        },

        skipTo({ day = null, hour = null, minute = null }) {
            const map = getActiveMap();
            if (!map) return;
            const env = ensureEnvData(map);

            const cur = parseTotalMinutes(env) ?? 0;
            const tr = getTimeRules();
            const minPerDay = tr.hoursPerDay * 60;
            let target = cur;

            if (hour !== null) {
                const m = minute !== null ? minute : 0;
                const dayPart = Math.floor(cur / minPerDay) * minPerDay;
                target = dayPart + hour * 60 + m;
            }

            const delta = target - cur;
            if (delta > 0) this.advance(delta);
        },

        on(event, fn) {
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push(fn);
        },
        off(event, fn) {
            const arr = this._listeners[event];
            if (!arr) return;
            const i = arr.indexOf(fn);
            if (i > -1) arr.splice(i, 1);
        },
        _emit(event, payload) {
            for (const fn of (this._listeners[event] || [])) {
                try { fn(payload); } catch (e) { console.error('[EnvClock]', e); }
            }
            window.dispatchEvent(new CustomEvent(`cw:env-${event}`, { detail: payload }));
        },

        pause() {
            this._running = false;
            if (this._rafId) cancelAnimationFrame(this._rafId);
        },
        resume() {
            if (this._running) return;
            this._running = true;
            this._lastRealTs = performance.now();
            this._loop();
        },

        formatTime() {
            const map = getActiveMap();
            const env = map ? ensureEnvData(map) : null;
            if (!env) return '--:--';
            return readField(env, '时间') || '--:--';
        },
        formatDate() {
            const map = getActiveMap();
            const env = map ? ensureEnvData(map) : null;
            if (!env) return '';
            const t = readField(env, '时间');
            const d = readField(env, '日期');
            if (!d) return t;
            return `${d} ${t}`;
        },
    };

    // ============================================================
    // 6. 环境管理器
    // ============================================================
    const EnvironmentManager = {
        _inited: false,

        init() {
            if (this._inited) return;
            this._inited = true;

            EnvironmentClock.on('day', (p) => this._onDay(p));
            EnvironmentClock.on('hour', (p) => this._onHour(p));
            EnvironmentClock.on('minute', (p) => this._onMinute(p));

            console.log('[EnvManager] 已初始化（懒更新模式）');
        },

        _onMinute() {
            // 扩展点
        },

        _onHour({ hour, day, map, env }) {
            if (!env) return;
            if (env._runtime.lastRollHour === hour) return;
            env._runtime.lastRollHour = hour;

            const temp = deriveTempAtHour(env, hour);
            const hum = deriveHumidityAtHour(env, hour);
            const wind = deriveWindAtHour(env, hour);

            writeField(env, '温度', `${temp}°C`);
            writeField(env, '湿度', `${hum}%`);
            writeField(env, '风力', `${wind}级`);

            rebuildRaw(env);

            this._checkEventHooks(env, hour, map);

            console.log(`[EnvManager] ${readField(env, '日期')} ${String(hour).padStart(2, '0')}:00 温度=${temp}°C 湿度=${hum}% 风力=${wind}级`);
        },

        _checkEventHooks(env, hour, map) {
            if (!window.TimeRuleEngine?.checkEventHooks) return;

            const dateStr = readField(env, '日期');
            const m = dateStr.match(/(\d+)年(\d+)月(\d+)日/);
            if (!m) return;
            const date = {
                year: parseInt(m[1]),
                month: parseInt(m[2]),
                day: parseInt(m[3]),
            };

            const timeStr = readField(env, '时间');
            const mm = timeStr.match(/^(\d{1,2})[:：](\d{2})/);
            const minute = mm ? parseInt(mm[2]) : 0;

            const hooks = window.TimeRuleEngine.checkEventHooks(hour, minute, date);
            if (hooks.length === 0) return;

            window.CinemaWorld.worldState.pendingEvents =
                window.CinemaWorld.worldState.pendingEvents || [];

            for (const h of hooks) {
                const exists = window.CinemaWorld.worldState.pendingEvents.some(
                    e => e.name === h.event && !e.processed
                );
                if (exists) continue;

                let detail = '';
                if (h.festival) {
                    detail = `节日「${h.festival.name}」：${h.festival.effects.join('、')}`;
                }

                window.CinemaWorld.worldState.pendingEvents.push({
                    name: h.event,
                    detail,
                    timestamp: Date.now(),
                    processed: false,
                });

                console.log(`[TimeRule] 事件钩子触发: ${h.event}`, detail || '');
            }
        },

        _onDay({ day, map, env }) {
            if (!env) return;
            if (env._runtime.lastRollDay === day) return;
            env._runtime.lastRollDay = day;

            const forecast = readField(env, '明日');
            const season = readField(env, '季节') || '春';

            let today;
            if (forecast) {
                today = forecast;
            } else {
                today = pickWeather(season, env._weatherPool || null);
            }
            writeField(env, '天气', today);
            writeField(env, '明日', pickWeather(season, env._weatherPool || null));

            computeDayBase(env);

            const tr = getTimeRules();
            const hourNow = Math.floor(((parseTotalMinutes(env) ?? 0) % (tr.hoursPerDay * 60)) / 60);
            const temp = deriveTempAtHour(env, hourNow);
            const hum = deriveHumidityAtHour(env, hourNow);
            const wind = deriveWindAtHour(env, hourNow);

            writeField(env, '温度', `${temp}°C`);
            writeField(env, '湿度', `${hum}%`);
            writeField(env, '风力', `${wind}级`);

            env._runtime.lastRollHour = hourNow;

            rebuildRaw(env);

            console.log(`[EnvManager] ${readField(env, '日期')} ${today}（明日:${readField(env, '明日')}）${temp}°C`);

            window.dispatchEvent(new CustomEvent('cw:env-day', {
                detail: { day, map, env }
            }));

            window.MapLauncher?._saveMapToWorld?.(map);
            if (window.SaveManager) window.SaveManager.save();
        },

        setWeather(name) {
            const map = getActiveMap();
            if (!map) return;
            const env = ensureEnvData(map);

            writeField(env, '天气', name);
            writeField(env, '明日', pickWeather(readField(env, '季节') || '春'));

            computeDayBase(env);
            const tr = getTimeRules();
            const hourNow = Math.floor(((parseTotalMinutes(env) ?? 0) % (tr.hoursPerDay * 60)) / 60);
            writeField(env, '温度', `${deriveTempAtHour(env, hourNow)}°C`);
            writeField(env, '湿度', `${deriveHumidityAtHour(env, hourNow)}%`);
            writeField(env, '风力', `${deriveWindAtHour(env, hourNow)}级`);

            rebuildRaw(env);

            DayNightFilter.refresh();

            const total = parseTotalMinutes(env);
            window.dispatchEvent(new CustomEvent('cw:env-day', {
                detail: {
                    day: total !== null ? Math.floor(total / (tr.hoursPerDay * 60)) + 1 : 1,
                    map, env,
                }
            }));

            window.MapLauncher?._saveMapToWorld?.(map);
        },

        setWeatherPool(pool) {
            const map = getActiveMap();
            if (!map) return;
            const env = ensureEnvData(map);
            env._weatherPool = Array.isArray(pool) ? pool : null;
        },

        buildPromptText() {
            const map = getActiveMap();
            if (!map) return '（无地图）';
            const env = ensureEnvData(map);

            const keys = ['时间', '日期', '时段', '季节', '天气', '温度', '湿度', '风力', '明日', '节日'];
            const parts = [];
            for (const k of keys) {
                const v = readField(env, k);
                if (v) parts.push(`${k}:${v}`);
            }
            return parts.join(' | ');
        },

        buildShortText() {
            const map = getActiveMap();
            if (!map) return '';
            const env = ensureEnvData(map);
            const weather = readField(env, '天气') || '?';
            const temp = readField(env, '温度') || '';
            const time = readField(env, '时间') || '--:--';
            const icon = WEATHER_ICON[weather] || '☀️';
            return `${icon} ${weather} ${temp} · ${time}`;
        },

        sync() {
            const map = getActiveMap();
            if (!map) return;
            const env = ensureEnvData(map);
            rebuildRaw(env);
            window.dispatchEvent(new CustomEvent('cw:env-sync', { detail: { map, env } }));
        },

        // ============================================================
        // 首次初始化地图环境
        // ============================================================
        initMapEnvironment(map) {
            if (!map) return;
            const env = ensureEnvData(map);
            if (!env) return;

            const ws = window.CinemaWorld?.worldState;

            // ----------------------------------------------------
            // 1. 已有时间 → 只兜底 worldMinutes / lastTickAt
            // ----------------------------------------------------
            if (readField(env, '时间')) {
                if (env._runtime.dayBaseTemp === null) computeDayBase(env);

                DayNightFilter.refresh();

                if (ws) {
                    if (typeof ws.worldMinutes !== 'number') {
                        ws.worldMinutes = parseTotalMinutes(env) || 0;
                    }
                    if (typeof env._runtime.lastTickAt !== 'number') {
                        env._runtime.lastTickAt = ws.worldMinutes;
                    }
                }
                return;
            }

            // ----------------------------------------------------
            // 2. 首次初始化：尝试从当前场景继承环境字段
            // ----------------------------------------------------
            const scene = window.LocationModalManager?.currentLocation;
            if (scene?.environmentData?._order?.length) {
                const src = scene.environmentData;
                const KEYS = ['时间', '日期', '季节', '天气', '温度', '湿度', '风力', '明日'];

                for (const k of KEYS) {
                    if (src[k]) writeField(env, k, src[k]);
                }
                for (const k of src._order) {
                    if (KEYS.includes(k)) continue;
                    if (k.startsWith('_')) continue;
                    if (src[k] === undefined || src[k] === '') continue;
                    if (!env._order.includes(k)) {
                        writeField(env, k, src[k]);
                    }
                }
            }

            // ----------------------------------------------------
            // 3. 仍无时间 → 用 TimeRuleEngine.startDate 初始化
            // ----------------------------------------------------
            if (!readField(env, '时间')) {
                const tr = getTimeRules();
                const sd = tr.startDate;
                const total = ((sd.year - 1) * tr.monthsPerYear * tr.daysPerMonth
                    + (sd.month - 1) * tr.daysPerMonth
                    + (sd.day - 1)) * tr.hoursPerDay * 60
                    + sd.hour * 60 + sd.minute;
                writeTimeFields(env, total);
            }

            // ----------------------------------------------------
            // 4. 补天气
            // ----------------------------------------------------
            if (!readField(env, '天气')) {
                const season = readField(env, '季节') || '春';
                writeField(env, '天气', pickWeather(season));
                writeField(env, '明日', pickWeather(season));
            }

            // ----------------------------------------------------
            // 5. 计算当天基准
            // ----------------------------------------------------
            computeDayBase(env);

            // ----------------------------------------------------
            // 6. 按当前小时写温度/湿度/风力
            // ----------------------------------------------------
            const tr = getTimeRules();
            const total = parseTotalMinutes(env) ?? 0;
            const minPerDay = tr.hoursPerDay * 60;
            const hourNow = Math.floor((total % minPerDay) / 60);

            writeField(env, '温度', `${deriveTempAtHour(env, hourNow)}°C`);
            writeField(env, '湿度', `${deriveHumidityAtHour(env, hourNow)}%`);
            writeField(env, '风力', `${deriveWindAtHour(env, hourNow)}级`);

            env._runtime.lastRollHour = hourNow;
            env._runtime.lastRollDay = Math.floor(total / minPerDay) + 1;

            // ----------------------------------------------------
            // 7. 初始化 worldMinutes + lastTickAt（懒更新核心）
            // ----------------------------------------------------
            if (ws) {
                if (typeof ws.worldMinutes !== 'number') {
                    ws.worldMinutes = total;
                }
                if (typeof env._runtime.lastTickAt !== 'number') {
                    env._runtime.lastTickAt = ws.worldMinutes;
                }
            }

            // ----------------------------------------------------
            // 8. 重建 _raw + 刷新滤镜
            // ----------------------------------------------------
            rebuildRaw(env);
            DayNightFilter.refresh();

            console.log('[EnvManager] 地图环境已初始化:', env._raw);
        },
    };

    // ============================================================
    // 7. HUD
    // ============================================================
    const EnvironmentHUD = {
        _el: null,
        _inited: false,
        _flashTimer: null,
        _modeTimer: null,
        _refs: null,
        _lastOtherSig: null,

        init() {
            if (this._inited) return;
            this._inited = true;

            this._injectStyles();
            this._ensureElement();
            this._cacheRefs();

            window.addEventListener('cw:env-minute', () => this.refresh());
            window.addEventListener('cw:env-hour', () => this.refresh());
            window.addEventListener('cw:env-day', () => {
                this.refresh();
                this._flash();
            });
            window.addEventListener('cw:env-sync', () => this.refresh());

            this._syncWithPlayMode();
            this._modeTimer = setInterval(() => this._syncWithPlayMode(), 400);

            console.log('[EnvHUD] 已初始化');
        },

        _ensureElement() {
            if (this._el) return;

            const el = document.createElement('div');
            el.id = 'cw-env-hud';
            el.innerHTML = `
                <div class="cw-env-hud-weather">
                    <div class="cw-env-hud-weather-icon">☀️</div>
                    <div class="cw-env-hud-weather-main">
                        <div class="cw-env-hud-weather-name">晴</div>
                        <div class="cw-env-hud-weather-line">
                            <span class="cw-env-hud-temp">--°C</span>
                            <span class="cw-env-hud-sep">·</span>
                            <span class="cw-env-hud-wind">风力--级</span>
                        </div>
                    </div>
                    <div class="cw-env-hud-forecast">
                        <span class="cw-env-hud-forecast-label">明日</span>
                        <span class="cw-env-hud-forecast-value">--</span>
                    </div>
                </div>

                <div class="cw-env-hud-time">
                    <div class="cw-env-hud-date">—</div>
                    <div class="cw-env-hud-clock">--:--</div>
                    <div class="cw-env-hud-phase">—</div>
                </div>

                <div class="cw-env-hud-extra"></div>
            `;

            const container = document.getElementById('cinemaworld-container') || document.body;
            container.appendChild(el);
            this._el = el;
        },

        _cacheRefs() {
            this._refs = {
                icon: this._el.querySelector('.cw-env-hud-weather-icon'),
                name: this._el.querySelector('.cw-env-hud-weather-name'),
                temp: this._el.querySelector('.cw-env-hud-temp'),
                wind: this._el.querySelector('.cw-env-hud-wind'),
                forecast: this._el.querySelector('.cw-env-hud-forecast-value'),
                date: this._el.querySelector('.cw-env-hud-date'),
                clock: this._el.querySelector('.cw-env-hud-clock'),
                phase: this._el.querySelector('.cw-env-hud-phase'),
                extra: this._el.querySelector('.cw-env-hud-extra'),
            };
        },

        _injectStyles() {
            if (document.getElementById('cw-env-hud-styles')) return;
            const s = document.createElement('style');
            s.id = 'cw-env-hud-styles';
            s.textContent = `
                #cw-env-hud {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 100001;
                    display: none;
                    flex-direction: column;
                    gap: 8px;
                    width: 240px;
                    pointer-events: none;
                    font-family: inherit;
                    animation: cw-env-hud-fade-in .35s ease;
                }
                #cw-env-hud.visible { display: flex; }
                @keyframes cw-env-hud-fade-in {
                    from { opacity: 0; transform: translateX(8px); }
                    to   { opacity: 1; transform: translateX(0); }
                }

                .cw-env-hud-weather {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 14px;
                    background: rgba(20, 22, 34, 0.85);
                    border: 1px solid rgba(140, 180, 255, 0.25);
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0,0,0,.45);
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                    transition: box-shadow .35s ease, transform .35s ease;
                }
                #cw-env-hud.flash .cw-env-hud-weather {
                    box-shadow: 0 4px 28px rgba(255,200,100,.55),
                                0 0 0 1px rgba(255,220,140,.5) inset;
                    transform: scale(1.03);
                }

                .cw-env-hud-weather-icon {
                    font-size: 32px;
                    line-height: 1;
                    flex-shrink: 0;
                    filter: drop-shadow(0 2px 4px rgba(0,0,0,.4));
                }
                .cw-env-hud-weather-main {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    min-width: 0;
                    flex: 1;
                }
                .cw-env-hud-weather-name {
                    font-size: 15px;
                    font-weight: 700;
                    color: #fff;
                    letter-spacing: .5px;
                }
                .cw-env-hud-weather-line {
                    display: flex;
                    align-items: center;
                    gap: 5px;
                    font-size: 11px;
                    color: #a8c4ff;
                }
                .cw-env-hud-temp { font-weight: 600; color: #ffd76b; }
                .cw-env-hud-sep { color: #556; }
                .cw-env-hud-wind { color: #a8c4ff; }

                .cw-env-hud-forecast {
                    display: flex;
                    flex-direction: column;
                    align-items: flex-end;
                    gap: 2px;
                    padding-left: 10px;
                    border-left: 1px solid rgba(255,255,255,.12);
                    flex-shrink: 0;
                }
                .cw-env-hud-forecast-label {
                    font-size: 9px;
                    color: #667;
                    letter-spacing: 1px;
                }
                .cw-env-hud-forecast-value {
                    font-size: 12px;
                    color: #9ab0ff;
                    font-weight: 600;
                }

                .cw-env-hud-time {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 2px;
                    padding: 10px 14px;
                    background: rgba(20, 22, 34, 0.85);
                    border: 1px solid rgba(140, 180, 255, 0.25);
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0,0,0,.45);
                    backdrop-filter: blur(10px);
                    -webkit-backdrop-filter: blur(10px);
                }
                .cw-env-hud-date {
                    font-size: 12px;
                    color: #9ab0ff;
                    font-weight: 600;
                    letter-spacing: .5px;
                    white-space: nowrap;
                    max-width: 100%;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .cw-env-hud-clock {
                    font-size: 24px;
                    font-weight: 700;
                    color: #fff;
                    font-family: 'Menlo', 'Consolas', monospace;
                    letter-spacing: 1px;
                    text-shadow: 0 0 12px rgba(140, 180, 255, .4);
                }
                .cw-env-hud-phase {
                    font-size: 11px;
                    color: #7dd87d;
                    font-weight: 600;
                }

                .cw-env-hud-extra {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    padding: 8px 14px;
                    background: rgba(20, 22, 34, 0.75);
                    border: 1px solid rgba(140, 180, 255, 0.18);
                    border-radius: 10px;
                    backdrop-filter: blur(8px);
                    -webkit-backdrop-filter: blur(8px);
                    font-size: 12px;
                    line-height: 1.5;
                }
                .cw-env-hud-extra:empty { display: none; }
                .cw-env-hud-extra-row {
                    display: flex;
                    gap: 8px;
                    justify-content: space-between;
                }
                .cw-env-hud-extra-key { color: #8898b8; }
                .cw-env-hud-extra-val { color: #ddd; font-weight: 600; }

                @media (max-width: 640px) {
                    #cw-env-hud {
                        top: 12px;
                        right: 12px;
                        width: 190px;
                        gap: 6px;
                    }
                    .cw-env-hud-weather { padding: 9px 11px; gap: 9px; border-radius: 10px; }
                    .cw-env-hud-weather-icon { font-size: 26px; }
                    .cw-env-hud-weather-name { font-size: 13px; }
                    .cw-env-hud-weather-line { font-size: 10px; }
                    .cw-env-hud-forecast-value { font-size: 11px; }
                    .cw-env-hud-time { padding: 8px 10px; border-radius: 10px; }
                    .cw-env-hud-date { font-size: 11px; }
                    .cw-env-hud-clock { font-size: 20px; }
                    .cw-env-hud-extra { font-size: 11px; padding: 6px 10px; }
                }
            `;
            document.head.appendChild(s);
        },

        show() {
            if (!this._el) { this._ensureElement(); this._cacheRefs(); }
            this._el.classList.add('visible');
            this.refresh();
        },
        hide() {
            if (!this._el) return;
            this._el.classList.remove('visible');
        },
        isVisible() {
            return !!this._el?.classList.contains('visible');
        },

        _syncWithPlayMode() {
            const playMode = window.CinemaWorld?.worldState?.playMode;
            const wsPanel = document.getElementById('cinemaworld-worldstate');

            if (playMode === 'map') {
                // ★ 有激活地图才显示
                const map = getActiveMap();
                if (map) this.show();
                if (wsPanel) wsPanel.style.display = 'none';
            } else {
                this.hide();
                if (wsPanel) wsPanel.style.display = '';
            }
        },

        refresh() {
            if (!this._el) return;
            if (!this.isVisible()) return;

            const map = getActiveMap();
            if (!map) return;
            if (!map._generated) return;

            const env = ensureEnvData(map);
            if (!env) return;

            const time = readField(env, '时间');
            if (!time) return;

            if (this._refs.clock && this._refs.clock.textContent !== time) {
                this._refs.clock.textContent = time;
            }

            const weather = readField(env, '天气') || '--';
            const icon = WEATHER_ICON[weather] || '☀️';
            const temp = readField(env, '温度') || '--';
            const wind = readField(env, '风力') || '--';
            const forecast = readField(env, '明日') || '--';
            const date = readField(env, '日期') || '';
            const phase = readField(env, '时段') || '';
            const season = readField(env, '季节') || '';
            const festival = readField(env, '节日') || '';

            const phaseDisplay = festival
                ? `🎉 ${festival}`
                : (phase ? `${phase} · ${season}` : season);

            const otherSig = `${weather}|${temp}|${wind}|${forecast}|${date}|${phase}|${season}|${festival}`;
            if (otherSig === this._lastOtherSig) return;
            this._lastOtherSig = otherSig;

            const r = this._refs;
            if (r.icon) r.icon.textContent = icon;
            if (r.name) r.name.textContent = weather;
            if (r.temp) r.temp.textContent = temp;
            if (r.wind) r.wind.textContent = wind.startsWith('风力') ? wind : `风力${wind}`;
            if (r.forecast) r.forecast.textContent = forecast;
            if (r.date) r.date.textContent = date || '—';
            if (r.phase) r.phase.textContent = phaseDisplay || '—';

            this._renderExtra(env);
        },

        _renderExtra(env) {
            const extraEl = this._refs?.extra;
            if (!extraEl) return;

            const rows = [];
            const hum = readField(env, '湿度');
            if (hum) rows.push({ key: '湿度', val: hum });

            const SKIP = new Set([
                '时间', '日期', '季节', '天气', '温度', '湿度', '风力', '明日',
                '时段', '节日',
            ]);
            for (const k of env._order) {
                if (rows.length >= 4) break;
                if (SKIP.has(k)) continue;
                if (k.startsWith('_')) continue;
                const v = env[k];
                if (v === undefined || v === '') continue;
                if (String(v).length > 20) continue;
                rows.push({ key: k, val: String(v) });
            }

            if (rows.length === 0) {
                extraEl.innerHTML = '';
                return;
            }

            extraEl.innerHTML = rows.map(r => `
                <div class="cw-env-hud-extra-row">
                    <span class="cw-env-hud-extra-key">${this._escape(r.key)}</span>
                    <span class="cw-env-hud-extra-val">${this._escape(r.val)}</span>
                </div>
            `).join('');
        },

        _escape(s) {
            return String(s ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
        },

        _flash() {
            if (!this._el) return;
            this._el.classList.add('flash');
            if (this._flashTimer) clearTimeout(this._flashTimer);
            this._flashTimer = setTimeout(() => {
                this._el.classList.remove('flash');
            }, 1200);
        },

        destroy() {
            if (this._modeTimer) clearInterval(this._modeTimer);
            if (this._flashTimer) clearTimeout(this._flashTimer);
            this._el?.remove();
            this._el = null;
            this._inited = false;
        },
    };

    // ============================================================
    // ★ 统一环境数据取用
    // ============================================================

    function getActiveEnvData() {
        const playMode = window.CinemaWorld?.worldState?.playMode;

        if (playMode === 'map') {
            const map = window.MapLauncher?.getMap?.();
            if (map) {
                const env = ensureEnvData(map);
                if (env) return env;
            }
        }

        const scene = window.LocationModalManager?.currentLocation;
        if (scene?.environmentData?._order?.length) {
            return scene.environmentData;
        }

        if (playMode === 'map') {
            const map = window.MapLauncher?.getMap?.();
            if (map) {
                const env = ensureEnvData(map);
                if (env) return env;
            }
        }

        return null;
    }

    function getEnvDataText(target = undefined) {
        if (target && target.environmentData) {
            const playMode = window.CinemaWorld?.worldState?.playMode;
            if (playMode === 'map') {
                const map = window.MapLauncher?.getMap?.();
                if (map) {
                    const mapEnv = ensureEnvData(map);
                    if (mapEnv?._order?.length) {
                        return _formatEnvText(mapEnv);
                    }
                }
            }
            return _formatEnvText(target.environmentData);
        }

        const env = getActiveEnvData();
        if (!env) return '（暂无环境数据）';
        return _formatEnvText(env);
    }

    function _formatEnvText(env) {
        if (!env?._order?.length) return '（暂无环境数据）';
        const text = env._order
            .filter(k => env[k] !== undefined && env[k] !== '')
            .map(k => `${k}:${env[k]}`)
            .join(' | ');
        return text || '（暂无环境数据）';
    }

    // ============================================================
    // 挂载
    // ============================================================
    window.EnvironmentClock = EnvironmentClock;
    window.EnvironmentManager = EnvironmentManager;
    window.EnvironmentHUD = EnvironmentHUD;
    window.DayNightFilter = DayNightFilter;

    window.CWEnv = {
        getActiveMap,
        ensureEnvData,
        readField,
        writeField,
        rebuildRaw,
        parseTotalMinutes,
        WEATHER_ICON,
        computeDayNightFilter,
        dayNightFactor,
        twilightWarmth,
        initMapEnvironment: (map) => EnvironmentManager.initMapEnvironment(map),
        getActiveEnvData,
        getEnvDataText,
        catchUpMap: (map) => EnvironmentClock.catchUpMap(map),   // ★ 懒更新入口
    };

    function boot() {
        EnvironmentClock.init();
        EnvironmentManager.init();
        DayNightFilter.init();
        EnvironmentHUD.init();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    console.log('[CinemaWorld] map-environment.js 已加载');
})();