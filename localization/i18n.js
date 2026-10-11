// ============================================================================
//  Celestial Incremental — 汉化翻译层  (localization/i18n.js)
//  ---------------------------------------------------------------------------
//  本文件是「语言系统」的翻译引擎，只做加载期拦截与运行时翻译，不改动任何
//  游戏源文件，因此上游更新时 git 合并零冲突。
//
//  工作原理：
//    1. 在图层文件加载前包装 addLayer —— 图层数据（名称/描述/升级/成就/剧情
//       对话/弹窗文本等）注册时即被翻译（静态字符串查词典，函数包装返回值）。
//    2. 包装 run() —— 所有经由 run() 渲染的文本（含动态拼接）过一遍词典。
//    3. 包装 doPopup() —— 弹窗标题与正文翻译。
//    4. 包装 CanvasRenderingContext2D.prototype.fillText/strokeText —— 画布
//       战斗文字翻译。
//    5. 包装 Vue.component() —— 对少量硬编码在模板里的英文做定点替换。
//    6. 设置页注入「语言」切换按钮（中 / EN），选择存 localStorage。
//
//  词典文件：localization/zh_CN.js  （window.CELESTIAL_I18N）
// ============================================================================
(function () {
    "use strict";

    // ------------------------------------------------------------------
    // 语言状态
    // ------------------------------------------------------------------
    var LS_KEY = "celestial_i18n_lang";
    var lang = "zh-CN";
    try { lang = localStorage.getItem(LS_KEY) || "zh-CN"; } catch (e) { /* ignore */ }

    var DICTS = window.CELESTIAL_I18N || {};
    var active = DICTS[lang] || DICTS["zh-CN"] || { exact: {}, fragment: {} };
    var exact = active.exact || {};
    var fragment = active.fragment || {};

    // ------------------------------------------------------------------
    // 词典匹配器：所有 key 按长度降序，一次正则替换
    // ------------------------------------------------------------------
    var masterRe = null;        // 全局正则（replace 用）
    var masterTest = null;      // 非全局正则（快速探测用）
    var masterMap = {};

    function escapeRe(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function isPureWord(s) {
        return /^[A-Za-z]+$/.test(s);
    }

    function buildMatcher() {
        var seen = {};
        var keys = [];
        var k, i;
        for (k in exact) if (!seen[k]) { seen[k] = 1; keys.push(k); }
        for (k in fragment) if (!seen[k]) { seen[k] = 1; keys.push(k); }
        keys.sort(function (a, b) { return b.length - a.length; });
        var parts = [];
        masterMap = {};
        // 第十轮加固：纯字母键（width / length / depth / points / tier / …）加一道
        // **右向守卫**，只在「后面紧跟代码符号」时放弃匹配 ——
        //   ①  ' " 或 =   → JS 对象键 / HTML 属性名：{'width':1}、<img width='100'>
        //   ②  :后紧跟代码值字符 [\w#.-] → CSS 声明：style='width:69px'、width:#fff、width:12.5%
        // 反例（照常匹配，属于文案）：
        //   "Cost:"  "Cost:<br>"  "Requires:<br>"  "Cost: "  "depth 1"  "length per second."
        // 原因：这些位置是代码而不是文案，被替换后会弄坏样式与表达式。
        // 用前瞻而非后顾，兼容所有浏览器。
        var WORD_GUARD_AFTER = "(?![\\w$'\"])(?![=])(?!:[\\w#.\\-])";
        for (i = 0; i < keys.length; i++) {
            k = keys[i];
            masterMap[k] = (k in exact) ? exact[k] : fragment[k];
            parts.push(isPureWord(k)
                ? ("\\b" + escapeRe(k) + "\\b" + WORD_GUARD_AFTER)
                : escapeRe(k));
        }
        if (parts.length) {
            // 第八轮补丁：masterRe 追加「HTML 标签」分支 —— 标签整体优先原样保留，
            // 使标签内部的属性名/属性值/资源路径（如 style='width:40px'、src='resources/Pets/x.png'、
            // class='... base'、onclick='player.x.Tabs=...'）不再被词典误替换。
            // 词典键仍排在前面（左起优先 + 长键优先），故含标签的整句键（如成就描述、<h3>…</h3>）照常命中。
            // masterTest 保持「仅词典键」，避免纯标签串触发无谓替换。
            masterRe = new RegExp("(" + parts.join("|") + ")|(<[^>]*>)", "g");
            masterTest = new RegExp(parts.join("|"));
        } else {
            masterRe = null;
            masterTest = null;
        }
    }
    buildMatcher();

    // ------------------------------------------------------------------
    // 翻译核心（带缓存，缓存溢出时清空）
    // ------------------------------------------------------------------
    var cache = new Map();
    var CACHE_MAX = 5000;

    // 资源/资产路径（第八轮续补丁）：run() 会把 image() 等字段的返回值也送进 translate()，
    // 这类路径是不含 HTML 标签的独立串，标签分支保护不到，必须单独掩码。
    var PATH_RE = /\b(?:resources|Savebank|music|css|js|fragments|docs)\/[^\s'"<>()]*/g;

    // ------------------------------------------------------------------
    // 标识符（id）保护 —— 修复「A2-Iridite-Battle-End → A2-Iridite-战斗-End」
    // 背景：词典含大量单词级 key（Start / Unlock / Battle / Dice / Space / Hive / …），
    //   而 buildMatcher() 对纯字母 key 用具词边界 \b，短横线 '-' 也是词边界，
    //   于是图层 / 过场动画 / 可点击项的 id 被逐段误译，渲染出半中半英的串。
    //   （过场 id 由 components.js 的 cutscene-node 组件 v-html 出来，只经过 DOM 兜底钩子）
    // 策略：translate() 跑词典之前把「id 形态 token」整体掩码，跑完再还原；
    //   并禁止词典对 id 形态的整串做 exact 命中。
    //   id 形态 = 由 '-' 连接的 ASCII 段（≥2 段）。
    // 唯一例外：词典对该 token 有「干净」整串译文（译文不含 '-'）时，说明它是显示名
    //   （如 Anti-Dragon→反龙、6-Sides→6 面、Honey-Cells→蜜胞），照常翻译。
    // ------------------------------------------------------------------
    var ID_SCAN = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g;
    function idShape(s) {
        return /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(s);
    }

    // 「不是 id」的白名单：id 形态的词，只要出现在**某条词典 key 里**、且该 key 的译文是
    // 「干净」的（译文不含 '-'），就说明它是真实术语而不是内部 id —— 例如
    //   "Boosts Honey-Cell Gain by x"→"将蜜胞获取提升 x"   ⇒ Honey-Cell 是术语
    //   "<h3>Post-OTF Mult</h3><br>x" →"<h3>OTF 后倍率</h3><br>x" ⇒ Post-OTF 是术语
    //   "Single-Tab Mode"→"单标签模式"                      ⇒ Single-Tab 是术语
    // 反之，「译文里还夹着 '-'」的条目正是被误收的 id（如 "Hive-Chamber-Fight-Start":
    // "蜂巢-密室-战斗-开始"），不白名单，会被掩码保护。
    // 该表在词典装载后一次性算出，运行时只做 O(1) 查表。
    //  规则③′：判「干净」前先去掉**作标点用的短横线** —— 两侧带空白（"v1.13.1 - Akash …"）
    //  或行首列表符号（"- Fixed xxx"）。真正的 id 短横线两侧必无空白（Hive-Chamber / Z-Jinx），
    //  因此剥掉标点短横线不会削弱对 id 的保护（"蜂巢-密室-战斗-开始" 依旧「不干净」）。
    //  典型受害者：更新日志标题 "<h3>v1.13.1 - Akash's Mini-Update I: Negative Diamonds</h3>"。
    function stripPunctDash(s) {
        return s.replace(/^\s*-\s+/, "").replace(/\s+-\s?/g, " ");
    }
    var ID_SAFE = (function () {
        var safe = {};
        function harvest(k, v) {
            if (typeof v !== "string") return;
            // 第十轮修正：判断「译文是否干净」前先剥掉 HTML 标签。
            // 否则形如 "<div style='margin-top:0px'>爆炸…</div>" 的整句键，会因为
            // 属性里的连字符（margin-top / bottomTooltip）被误判为「不干净」，
            // 于是 "margin-top" 这类 CSS 属性名被当作 id 掩码，
            // 导致**含内联样式的整句键全部失配**（第十轮 t_deadkeys.js 实测 9 条）。
            var clean = v.replace(/<[^>]*>/g, "");
            var m = String(k).match(ID_SCAN);
            if (!m) return;
            // 两条认定规则（满足其一即视为「显示名」，不做掩码）：
            //  ① 译文干净（不含 '-'）              —— 术语被完全译出，如 Honey-Cell→蜜胞、Anti-Dragon→反龙
            //  ② 该 token 在译文里**原样保留**     —— 术语有意保留英文，如
            //     "Next building unlocked at Asc-1 Lvl-4" → "…Asc-1 Lvl-4…"、
            //     "Celestialite F-13 rolled…" → "星灵 F-13 掷出…"、
            //     "Increase SME-A1 & SME-A2 Cap" → "提升 SME-A1 与 SME-A2 上限"
            //  规则②是第十轮续补：此前只认规则①，于是「译文中保留英文的术语」被判为『不干净』
            //  而遭 ID_SCAN 掩码，导致**含该类术语的整句键在拼接语境下全部失配**
            //  （实测：SME-A1/A2 上限键、F-13 骰子键共 2 条在拼接串上复活；21,980 条语料 0 回归）。
            //  注意：被白名单命中的 token 会**原样返回**，不参与词典逐词替换，
            //  因此对内部 id（cutscene-piano / dice-space / infinity-challenge）行为不变。
            //  规则③（第十轮续补）：判「干净」前先剥掉 **changelog 列表符号**（"- "）。
            //  更新日志每条译文都以 "- " 开头，若把项目符号也算作「译文里夹着 '-'」，
            //  则所有 "- Fixed xxx" 条目的短横线术语（Uni-bar / edge-cases / post-iridite /
            //  CB-Fighting / tree-layout … 共 19 个）统统不被白名单 → 被 ID_SCAN 掩码
            //  → 这 103 条更新日志在「整段 changelog 一次性翻译」时全部失配。
            //  实测：整段 changelog（55,612 字符）残留 token 110 → 7，新引入 0。
            var cleanOk = stripPunctDash(clean).indexOf("-") < 0;
            for (var i = 0; i < m.length; i++) {
                var tok = m[i];
                if (cleanOk || clean.indexOf(tok) >= 0) safe[tok] = 1;
            }
        }
        var k;
        for (k in exact) harvest(k, exact[k]);
        for (k in fragment) harvest(k, fragment[k]);
        return safe;
    })();
    // 第十轮续补 —— 极小规模的人工白名单（0 处例外即不维护）。
    // 与规则②互斥的场景：术语的**译文改写了尾部**（无法靠「译文原样保留」识别），
    // 但术语本身只出现在更新日志模板串里，因此放开掩码不会波及游戏 UI。
    //   Z-Jinx → "Z-厄运"：术语表.md:312 裁定 Jinx→厄运（Hex 诅咒行 Α-厄运 … Μ-厄运），
    //   故 "Z-厄运" 是正确译法，不能用规则②处理；
    //   而 grep 全仓库，"Z-Jinx" 仅出现在 js/mod.js 的 changelog 模板串中（1 处）。
    ['Z-Jinx'].forEach(function (t) { ID_SAFE[t] = 1; });

    function isDisplayName(t) {
        return ID_SAFE[t] === 1;
    }

    function translate(str) {
        if (lang === "en" || typeof str !== "string" || str.length < 2) return str;
        if (/^[A-Za-z0-9]$/.test(str)) return str;          // 单字符（图层 id / 符号等）不译
        if (cache.has(str)) return cache.get(str);
        var out;
        if (Object.prototype.hasOwnProperty.call(exact, str)) {
            // 整串 exact 命中优先：保护「含资源路径的整句键」（如角色图鉴页 <img src='resources/…'>…）
            // 这些键必须原样匹配，不能先被路径掩码拆散。
            var ev = exact[str];
            // id 保护：整串是 id 形态、且译文里仍夹着 '-' ⇒ 该词条是此前误收的 id
            // （如 "Hive-Chamber-Fight-Start": "蜂巢-密室-战斗-开始"），原样保留；
            // 真正的显示名译文不含 '-'（Anti-Dragon→反龙），不受影响。
            out = (idShape(str) && typeof ev === "string" && ev.indexOf("-") >= 0) ? str : ev;
        } else {
            // 掩码资源路径 / id token → 词典替换 → 还原（占位符不含字母，不会被词典键命中）
            var guards = [];
            var masked = str.replace(PATH_RE, function (m) {
                guards.push(m);
                return "\u0001" + (guards.length - 1) + "\u0001";
            });
            // 掩码 id 形态 token（词典有干净整串译文的显示名除外）
            masked = masked.replace(ID_SCAN, function (m) {
                if (isDisplayName(m)) return m;
                guards.push(m);
                return "\u0001" + (guards.length - 1) + "\u0001";
            });
            if (masterTest && masterTest.test(masked)) {
                // 回调签名: (match, 词典键, HTML标签)。命中标签分支时原样返回，标签内不做翻译。
                out = masked.replace(masterRe, function (m, key, tag) {
                    if (tag !== undefined) return tag;
                    return masterMap[m];
                });
            } else {
                out = masked;
            }
            if (guards.length) out = out.replace(/\u0001(\d+)\u0001/g, function (_, i) { return guards[+i]; });
        }
        // 时间单位（Xd Xh Xm Xs，如 "33d 2h 8m 28.1s"）：数字前缀限定，避免误伤普通英文
        // "After {数字}"：限定数字上下文，避免全局误伤（如 "After 6.21e463 ..."）
        out = out
            .replace(/\bAfter (\d+(?:\.\d+)?)/g, "超过 $1")
            .replace(/(\d+(?:\.\d+)?)y /g, "$1年 ")
            .replace(/(\d+(?:\.\d+)?)d /g, "$1天 ")
            .replace(/(\d+(?:\.\d+)?)h(?![\w])/g, "$1小时")
            .replace(/(\d+(?:\.\d+)?)m(?![\w])/g, "$1分")
            .replace(/(\d+(?:\.\d+)?)s(?![\w])/g, "$1秒");
        if (cache.size >= CACHE_MAX) cache.clear();
        cache.set(str, out);
        return out;
    }

    // ------------------------------------------------------------------
    // 函数包装：保留原函数（闭包安全），仅翻译其字符串返回值
    // ------------------------------------------------------------------
    function wrapTextFn(fn) {
        if (fn.__ci18nWrapped) return fn;        // 已包装则复用，避免每帧嵌套包装
        var orig = fn;
        var wrapped = function () {
            var r = orig.apply(this, arguments);
            return (typeof r === "string") ? translate(r) : r;
        };
        wrapped.__ci18nWrapped = true;
        return wrapped;
    }

    function translateValue(v) {
        if (typeof v === "string") return translate(v);
        if (typeof v === "function") return wrapTextFn(v);
        return v;
    }

    // 函数式 tabFormat / microtab content：注册期拿不到数组（源码里是方法/函数，如
    // well.js 的 `content() { … }`），旧逻辑直接跳过 → 其中的 raw-html 串永不翻译，
    // 只剩 DOM 观察器按文本节点兜底，于是「带 HTML 标签的整句键」全部失效
    // （如 <span style='color:#ffff00'>Can't afford!</span>）。
    // 改为包装该函数，在每次求值时翻译其返回的数组。
    function wrapFormatFn(fn) {
        if (fn.__ci18nFormatWrapped) return fn;
        var wrapped = function () {
            var r = fn.apply(this, arguments);
            if (Array.isArray(r)) translateFormatArray(r);
            return r;
        };
        wrapped.__ci18nFormatWrapped = true;
        return wrapped;
    }

    // ------------------------------------------------------------------
    // 各类对象的文本字段表（只动显示字段，绝不动标识符/存档键/样式）
    // ------------------------------------------------------------------
    var FIELD_MAP = {
        layer:       ["name", "tooltip", "subtitle", "longDesc", "message", "smallDesc"],
        upgrade:     ["title", "description", "currencyDisplayName", "effectDisplay", "smallDesc", "tooltip", "name"],
        buyable:     ["title", "description", "currencyDisplayName", "effectDisplay", "smallDesc", "tooltip", "name"],
        milestone:   ["name", "requirementDescription", "effectDescription", "tooltip", "description"],
        challenge:   ["name", "challengeDescription", "description", "rewardDescription", "goal", "goalDescription", "tooltip", "unlockedDescription", "reward"],
        achievement: ["name", "desc", "tooltip", "description", "reward", "smallDesc"],
        clickable:   ["title", "display", "tooltip", "description", "name"],
        grid:        ["title", "description", "tooltip"],
        infobox:     ["title", "body"],
        sublayer:    ["name", "tooltip", "description"]
    };

    function translateCollection(col, type) {
        if (!col || typeof col !== "object") return;
        var fields = FIELD_MAP[type] || [];
        if (!fields.length) return;
        for (var key in col) {
            var obj = col[key];
            if (!obj || typeof obj !== "object") continue;
            for (var i = 0; i < fields.length; i++) {
                var f = fields[i];
                if (obj[f] !== undefined) obj[f] = translateValue(obj[f]);
            }
        }
    }

    // 布局/数据指令类 tabFormat 条目（payload 不是文本，不能动）
    // 第五轮补丁：补登此前漏掉的容器型组件名（top-column / always-scroll-column 等），
    // 否则 translateFormatArray 不会递归进这些容器，其内部 raw-html/text 永远不被翻译
    // （Credits / Ideas: Nova / Magic / Rare·Epic·Legendary 徽章即因此漏翻）。
    var LAYOUT_TYPES = {
        "blank": 1, "hr": 1, "row": 1, "column": 1, "tr": 1, "td": 1,
        "style-row": 1, "style-column": 1, "grid": 1, "tabs": 1,
        "upgrade": 1, "buyable": 1, "milestone": 1, "challenge": 1, "achievement": 1,
        "clickable": 1, "node": 1, "layer": 1, "bar": 1, "p": 1, "ul": 1, "li": 1,
        "microtabs": 1, "buttonless-microtabs": 1, "levelable": 1, "levelable-display": 1,
        "infobox": 1, "tree": 1, "hotkey": 1, "challenge-name": 1, "dropdown": 1,
        "bought": 1, "notify": 1, "glow": 1, "conditional": 1,
        "category-button": 1, "scroll-column": 1, "scroll-row": 1,
        // ---- 第五轮补登的容器型布局组件 ----
        "tooltip-row": 1, "left-row": 1, "right-row": 1, "top-column": 1,
        "always-scroll-row": 1, "always-scroll-column": 1,
        "theme-scroll-row": 1, "theme-scroll-column": 1,
        "centered-draggable-scroll-row": 1, "stat-row": 1
    };
    var TEXT_TYPES = { "raw-html": 1, "display-text": 1, "text": 1, "info": 1, "tooltip": 1 };

    // ------------------------------------------------------------------
    // 组件 payload 数组的下标语义
    // 背景：translateFormatArray 对 LAYOUT_TYPES 组件会递归其数组 payload，
    //   但部分组件的 payload 不是「格式数组」，而是 [显示文本, 代码标识符…]。
    //   category-button 的模板为
    //     v-on:click="player.subtabs[layer][data[1]] = data[2]"
    //   payload = [标签, microtab 组名, 索引, 禁用]。组名/索引是 player.subtabs
    //   的键与值，一旦被当文本翻译（实测 stars→星星 / blood→鲜血 / upgrades→升级），
    //   点击就会写入错误的键 → 类目无法切换。
    // 只翻下列下标，其余原样保留。
    // ------------------------------------------------------------------
    var PAYLOAD_TEXT_IDX = { "category-button": [0], "stat-row": [0, 1] };
    // payload 全是标识符/尺寸，一律不递归（tree 的节点 id 数组、blank 的宽高数组）
    var PAYLOAD_OPAQUE = { "tree": 1, "blank": 1 };

    function translateFormatArray(arr) {
        if (!Array.isArray(arr)) return;
        for (var i = 0; i < arr.length; i++) {
            var item = arr[i];
            if (typeof item === "string") {
                // 裸字符串 = Vue 组件名，**无条件不翻译**。
                // 依据：row / column / style-row / style-column / scroll-* / always-scroll-* /
                //   theme-scroll-* / tooltip-row / left-row / right-row / top-column /
                //   centered-draggable-scroll-row 的模板一律为
                //     v-if="!Array.isArray(item)" v-bind:is="item"
                //   即「非数组元素」必是组件名；实测全库容器数组中的裸字符串 100% 是已注册组件名，
                //   故跳过无损（审计脚本 audit_ident.js 的 F2 项须为 0）。
                // 注意：**不能**改成「查该组件是否已注册再决定」——layers.js 是 modFiles 的第一个
                //   文件，可能在 components.js 注册组件之前执行（加载顺序竞态，实测桌面正常、
                //   移动端因时序不同而暴露）：layers.js 的 "cutscene-nodes" 曾被翻成
                //   "过场动画-nodes"，导致 Cutscene Viewer 面板空白。
                continue;
            }
            if (!Array.isArray(item) || typeof item[0] !== "string") continue;
            var type = item[0];
            if (TEXT_TYPES[type]) {
                if (item[1] !== undefined) item[1] = translateValue(item[1]);
            } else if (LAYOUT_TYPES[type]) {
                var idxs = PAYLOAD_TEXT_IDX[type];
                if (idxs) {
                    // 只翻白名单下标，其余是代码标识符（见 PAYLOAD_TEXT_IDX 注释）
                    var pl = item[1];
                    if (Array.isArray(pl)) {
                        for (var t = 0; t < idxs.length; t++) {
                            var pi = idxs[t];
                            if (typeof pl[pi] === "string") pl[pi] = translate(pl[pi]);
                            else if (typeof pl[pi] === "function") pl[pi] = wrapTextFn(pl[pi]);
                        }
                    }
                } else if (!PAYLOAD_OPAQUE[type]) {
                    for (var j = 1; j < item.length; j++) {
                        if (Array.isArray(item[j])) translateFormatArray(item[j]);
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // microtabs：标签名通过注入 title 翻译（键名是代码引用，不能改名）；
    // content 走 tabFormat 处理
    // ------------------------------------------------------------------
    function translateMicrotabs(mt) {
        if (!mt || typeof mt !== "object") return;
        for (var grp in mt) {
            var tabs = mt[grp];
            if (!tabs || typeof tabs !== "object") continue;
            for (var name in tabs) {
                var tab = tabs[name];
                if (!tab || typeof tab !== "object") continue;
                var zh = translate(name);
                if (zh !== name && tab.title === undefined) tab.title = zh;
                if (tab.title !== undefined) tab.title = translateValue(tab.title);
                if (typeof tab.content === "function") tab.content = wrapFormatFn(tab.content);
                else if (tab.content) translateFormatArray(tab.content);
            }
        }
    }

    // ------------------------------------------------------------------
    // 图层数据整体翻译
    // ------------------------------------------------------------------
    function translateLayerData(d) {
        if (!d || typeof d !== "object") return;

        var i;
        var fields = FIELD_MAP.layer;
        for (i = 0; i < fields.length; i++) {
            if (d[fields[i]] !== undefined) d[fields[i]] = translateValue(d[fields[i]]);
        }

        translateCollection(d.upgrades, "upgrade");
        translateCollection(d.buyables, "buyable");
        translateCollection(d.milestones, "milestone");
        translateCollection(d.challenges, "challenge");
        translateCollection(d.achievements, "achievement");
        translateCollection(d.clickables, "clickable");
        translateCollection(d.grid, "grid");
        translateCollection(d.infoboxes, "infobox");
        translateCollection(d.sublayers, "sublayer");

        // 过场动画对话
        if (d.cutscenes) {
            for (var scKey in d.cutscenes) {
                var sc = d.cutscenes[scKey];
                if (sc && Array.isArray(sc.dialogue)) {
                    for (i = 0; i < sc.dialogue.length; i++) {
                        var ln = sc.dialogue[i];
                        if (ln && typeof ln.text === "string") ln.text = translate(ln.text);
                        if (ln && typeof ln.name === "string") ln.name = translate(ln.name);
                    }
                }
            }
        }

        if (d.microtabs) translateMicrotabs(d.microtabs);
        if (typeof d.tabFormat === "function") d.tabFormat = wrapFormatFn(d.tabFormat);
        else if (d.tabFormat) translateFormatArray(d.tabFormat);
    }

    // ------------------------------------------------------------------
    // 设置页注入「语言」切换按钮
    // ------------------------------------------------------------------
    function injectLanguageSetting(layerName, d) {
        if (layerName !== "settings" && layerName !== "st") return;
        if (!d || typeof d !== "object") return;
        try {
            if (!d.clickables) d.clickables = {};
            if (!d.clickables[9001]) {
                d.clickables[9001] = {
                    title: function () { return window.CI18N.label(); },
                    // 备注：切换语言会整页刷新以生效（display 渲染在标题下方，tooltip 为悬停提示）
                    display: function () { return window.CI18N.note(); },
                    tooltip: function () { return window.CI18N.hint(); },
                    canClick: function () { return true; },
                    unlocked: function () { return true; },
                    onClick: function () { window.CI18N.toggle(); },
                    style: { width: "195px", minHeight: "78px", color: "var(--textColor)", background: "var(--miscButtonDisable)", borderRadius: "0px", border: "3px solid var(--regBorder)", margin: "0px 5px" }
                };
            }
            if (Array.isArray(d.tabFormat)) {
                d.tabFormat.unshift(["row", [["clickable", 9001]]]);
            }
        } catch (e) {
            console.warn("[CI18N] settings inject failed", e);
        }
    }

    // ------------------------------------------------------------------
    // Hook 1: addLayer —— 图层注册时翻译（在图层文件加载前生效）
    // ------------------------------------------------------------------
    var origAddLayer = window.addLayer;
    if (typeof origAddLayer === "function") {
        window.addLayer = function (layerName, layerData, tabLayers) {
            try {
                translateLayerData(layerData);
                injectLanguageSetting(layerName, layerData);
            } catch (e) {
                console.warn("[CI18N] translate layer '" + layerName + "' failed", e);
            }
            return origAddLayer(layerName, layerData, tabLayers);
        };
    } else {
        console.warn("[CI18N] addLayer not found at load time; translation hooks will be partial.");
    }

    // ------------------------------------------------------------------
    // Hook 2: run() / gridRun() —— 渲染访问器（utils.js 加载完成后生效）
    // ------------------------------------------------------------------
    function hookRun() {
        if (window.run && !window.__CI18N_runHooked) {
            window.__CI18N_runHooked = true;
            var origRun = window.run;
            window.run = function (func, target, args) {
                var r = origRun(func, target, args);
                return (typeof r === "string") ? translate(r) : r;
            };
        }
        if (window.gridRun && !window.__CI18N_gridHooked) {
            window.__CI18N_gridHooked = true;
            var origGrid = window.gridRun;
            window.gridRun = function (layer, func, data, id) {
                var r = origGrid(layer, func, data, id);
                return (typeof r === "string") ? translate(r) : r;
            };
        }
    }

    // ------------------------------------------------------------------
    // Hook 3: doPopup() —— 弹窗文本
    // ------------------------------------------------------------------
    function hookPopup() {
        if (window.doPopup && !window.__CI18N_popupHooked) {
            window.__CI18N_popupHooked = true;
            var origPopup = window.doPopup;
            window.doPopup = function (type, text, title, timer, color, image) {
                arguments[1] = typeof text === "string" ? translate(text) : text;
                arguments[2] = typeof title === "string" ? translate(title) : title;
                return origPopup.apply(this, arguments);
            };
        }
    }

    // ------------------------------------------------------------------
    // Hook 4: Canvas 画布文字（战斗 HUD 等）
    // ------------------------------------------------------------------
    (function hookCanvas() {
        var proto = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
        if (!proto) return;
        ["fillText", "strokeText"].forEach(function (m) {
            var orig = proto[m];
            if (!orig) return;
            proto[m] = function (text) {
                if (typeof text === "string") arguments[0] = translate(text);
                return orig.apply(this, arguments);
            };
        });
    })();

    // ------------------------------------------------------------------
    // Hook 5: Vue.component —— 组件模板中少量硬编码英文的定点替换
    // ------------------------------------------------------------------
    var TEMPLATE_PATCH = {
        "main-display": {
            "You have ": "你拥有 "
        },
        "levelable-display": {
            ">Effects<": ">效果<",
            ">Description<": ">描述<"
        },
        "info-tab": {
            // 第十轮：info-tab 是 Vue 组件模板（systemComponents.js:167 'info-tab'），
            // 整段静态英文**不经过 translate()/DOM 观察器之外的任何钩子**，且模板里的
            // 纯文本节点在首次渲染后不再重插 —— 只能在模板编译前做字面替换。
            // 注意 <h2>{{modInfo.name}}</h2> 等插值原样保留（split/join 不碰 {{ }}）。
            "Changelog": "更新日志",
            "Hotkeys": "快捷键",
            "Made by ": "作者：",
            " by Acamaeda and FlamemasterNXF": "，由 Acamaeda 与 FlamemasterNXF 制作",
            "Songs made by Sweetlolipop (My brother)": "配乐由 Sweetlolipop 制作（我的弟弟）",
            "The Prestige Tree made by Jacorb and Aarex": "The Prestige Tree 由 Jacorb 与 Aarex 制作",
            "Art by Citrine (Also known as lumen/niko/zittara) and a lil bit by JToh": "美术：Citrine（又名 lumen/niko/zittara），少量由 JToh 绘制",
            "Galaxy thumbnail by Blepoo": "星系缩略图：Blepoo",
            "Typo check by Piterpicher": "错别字校对：Piterpicher",
            ">Soundtrack<": ">原声带<",
            "The Modding Tree Discord": "The Modding Tree Discord",
            "Main Prestige Tree server": "Main Prestige Tree 服务器",
            "Time Played: ": "游戏时长：",
            "b: Switch buymax mode": "b: 切换购买上限模式",
            "i: Switch to incremental node": "i: 切换到增量节点",
            "m: Switch to meta-prestige node": "m: 切换到 Meta-威望节点",
            "c: Switch to crafting node": "c: 切换到合成节点",
            "m+shift: Meta-prestige reset": "m+shift: Meta-威望重置",
            "h: Switch to hub node (uses a travel if not in dimensional realm)": "h: 切换到枢纽节点（不在维度领域内时消耗一次旅行）"
        },
        "options-tab": {
            // 第十轮：options-tab 同样是 Vue 组件模板（systemComponents.js:204），
            // 静态标签不经过 translate()；且这些按钮文本节点首次渲染后不再重插。
            // ⚠ 顺序敏感：`"Autosave: "` 必须排在子串键 `"Save"` 之前，
            //    否则 split("Save") 会把 "Autosave" 拆成 "Auto保存"。
            "Autosave: ": "自动保存：",
            "Offline Prod: ": "离线产出：",
            "Theme: ": "主题：",
            "Show Milestones: ": "显示里程碑：",
            "High-Quality Tree: ": "高质量树：",          // 挡住 "Tree"→树木 误替换
            "Completed Challenges: ": "已完成挑战：",
            "Single-Tab Mode: ": "单标签模式：",
            "Shift-Click to Toggle Tooltips: ": "Shift+点击切换提示框：",
            "Show Milestone Popups: ": "显示里程碑弹窗：",
            "Toggle Music: ": "音乐开关：",
            "Toggle Hotkeys: ": "快捷键开关：",
            "Toggle Particles: ": "粒子开关：",
            // 插值表达式里的字面量：连同 "?" 与 ":" 一起替换，
            // 避免 "ON"/"On" 作为子串误伤 onclick / ONLY 等代码片段
            "?\"ON\":\"OFF\"": "?\"开\":\"关\"",
            "?\"HIDDEN\":\"SHOWN\"": "?\"隐藏\":\"显示\"",
            "?\"ALWAYS\":\"AUTO\"": "?\"总是\":\"自动\"",
            "?\"Unmute\":\"Mute\"": "?\"取消静音\":\"静音\"",
            "?\"On\":\"Off\"": "?\"开\":\"关\"",
            // ⚠ 必须带 ">…<" 定界符：裸键 "Save" 会把 onclick="exportSave()" /
            //    "importSave()" 里的函数名改成 export保存() / import保存()，直接弄坏按钮。
            ">Save<": ">保存<",
            "HARD RESET": "硬重置",
            "Export to clipboard": "导出到剪贴板",
            "Import": "导入"
        },
        // 第十轮：树节点 / 网格节点 的默认提示框（systemComponents.js:48 / :114）
        // 这些串在模板表达式里用 ' + ' 拼接，渲染进 <tooltip v-html> 的文本节点，
        // 因含动态数值，只能改模板字面量本体（保留 '' 定界符）。
        "tree-node": {
            "'Reach '": "'需要 '",
            "' to unlock (You have '": "' 才能解锁（你拥有 '",
            "tmp[layer].baseResource + ')'": "tmp[layer].baseResource + '）'",
            "I am a button!": "我是一个按钮！"
        },
        "grid-node": {
            "'Reach '": "'需要 '",
            "' to unlock (You have '": "' 才能解锁（你拥有 '",
            "tmp[layer].baseResource + ')'": "tmp[layer].baseResource + '）'",
            "I am a button!": "我是一个按钮！"
        },
        // 第十轮：资源显示条（components.js:657 'resource-display'）
        // 静态字面量在 {{ }} 之间，用 "}}" / ">" 做定界符精确定位；
        // ⚠ 这里**不能**用裸键 " is "（会被 masterRe 当成子串全局替换，
        //    实测把 "Cloud gain is multiplied by x1.5" 弄成 "…获取 为 multiplied by…"）
        "resource-display": {
            ">You have {{": ">你拥有 {{",
            ">You are gaining {{": ">你正在获得 {{",
            "}} per second": "}} 每秒",
            ">Your best {{": ">你的最佳 {{",
            "}} is {{": "}} 为 {{",
            ">You have made a total of {{": ">你累计已获得 {{"
        },
        // 第十轮：里程碑的自动开关按钮（components.js:638 'toggle'）
        // 模板形如 {{player[data[0]][data[1]]?"ON":"OFF"}}，ON/OFF 是插值表达式里的字面量
        "toggle": {
            "?\"ON\":\"OFF\"": "?\"开\":\"关\""
        },
        // 第十轮：黑心（Black Heart）连击里程碑按钮（components.js:1948 'bh-milestone'）
        // 模板里 ' Combo (' 已被词典译作 ' 连击（'，此处把收尾的 "/3)" 补成全角
        "bh-milestone": {
            "/3)<br><small>[": "/3）<br><small>["
        },
        // 注：components.js 的 'buyable' 模板本身不含 Buy 按钮（只有 ex-/dark-/rounded- 系才有），
        //    故此处不再为 'buyable' 配置空补丁（第十轮 _audit/t_templates.js 验证发现）。
        "ex-buyable": {
            "Buy 1": "购买 1",
            "Buy Max": "购买最大"
        },
        "dark-buyable": {
            "Buy 1": "购买 1",
            "Buy Max": "购买最大"
        },
        "layerColor-dark-buyable": {
            "Buy 1": "购买 1",
            "Buy Max": "购买最大"
        },
        "rounded-ex-buyable": {
            "Buy 1": "购买 1",
            "Buy Max": "购买最大"
        },
        "rounded-dark-buyable": {
            "Buy 1": "购买 1",
            "Buy Max": "购买最大"
        },
        // ---- 第五轮补丁：upgrade 组件模板里的静态 "Cost: " 字面 ----
        // 模板形如  <br><br>Cost: {{ cost }} {{ currencyDisplayName }}
        // currencyDisplayName 在注册时已译（如“花蜜 γ”“蜂王浆”），唯独静态 "Cost: "
        // 不经过任何翻译钩子；在模板编译前替换静态片段，插值 {{}} 原样保留。
        "upgrade": {
            "Cost: ": "价格："
        },
        "hoverless-upgrade": {
            "Cost: ": "价格："
        },
        "ex-upgrade": {
            "Cost: ": "价格："
        },
        "bt-upgrade": {
            "Cost: ": "价格："
        },
        "id-upgrade": {
            "Cost: ": "价格："
        },
        // ---- 第五轮补丁：bh-milestone 组件 v-html 表达式里的静态英文 ----
        // 模板: data[0] + ' Combo (' + milestone + '/3)<br><small>[' +
        //       (milestone>2 ? '1 Character' : n + ' Characters') + ']</small>'
        // 结果需对齐词典：  "25 Combo (0/3)" -> "25 连击（0/3)"，"[3 Characters]" -> "[3 角色]"
        "bh-milestone": {
            " Combo (": " 连击（",
            "1 Character": "1 角色",
            " Characters": " 角色"
        }
    };

    (function hookVue() {
        if (!window.Vue || typeof window.Vue.component !== "function") return;
        var origVC = window.Vue.component;
        window.Vue.component = function (name, options) {
            if (options && typeof options.template === "string" && TEMPLATE_PATCH[name]) {
                var rep = TEMPLATE_PATCH[name];
                for (var k in rep) {
                    options.template = options.template.split(k).join(rep[k]);
                }
            }
            return origVC.apply(this, arguments);
        };
    })();

    // ------------------------------------------------------------------
    // Hook 6: DOM 观察器 —— 捕获运行期插入 DOM 的硬编码英文
    // （Vue 渲染文本节点、cutsceneNew.js 原生按钮、粒子弹窗、v-html 内容等
    //   均不经过 run/translate 钩子，只能靠观察 DOM 文本节点补翻）
    // ------------------------------------------------------------------
    (function hookDom() {
        if (!window.MutationObserver || !window.document) return;
        // 第五轮：单次新增子树遍历上限由 300 提高到 1500 —— 大型升级网格/设置页
        // 一次插入的子树常超 300 节点，旧上限会截断后续静态文本节点（如 upgrade 的
        // "Cost: " 模板字面量），且这些静态节点一旦创建不再重新插入，永不补翻。
        var MAX_WALK = 1500;
        // budget 可由调用方覆盖（启动全量扫描传 Infinity）
        function walk(node, budget) {
            var limit = (typeof budget === "number") ? budget : MAX_WALK;
            var stack = [node];
            var walked = 0;
            while (stack.length && walked < limit) {
                var n = stack.pop();
                walked++;
                if (n.nodeType === 3) { // TEXT_NODE
                    var v = n.nodeValue;
                    if (v && masterTest && masterTest.test(v)) {
                        var t = translate(v);
                        if (t !== v) n.nodeValue = t;
                    }
                    continue;
                }
                if (n.nodeType !== 1) continue; // 只处理元素与文本
                var tag = n.tagName;
                if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") continue;
                for (var i = n.childNodes.length - 1; i >= 0; i--) stack.push(n.childNodes[i]);
            }
        }
        var mo = new MutationObserver(function (muts) {
            for (var i = 0; i < muts.length; i++) {
                var m = muts[i];
                if (m.type !== "childList") continue;
                var added = m.addedNodes;
                for (var j = 0; j < added.length; j++) {
                    if (added[j].nodeType === 1 || added[j].nodeType === 3) walk(added[j]);
                }
            }
        });
        function start() {
            if (document.documentElement) {
                mo.observe(document.documentElement, { childList: true, subtree: true });
                // 第五轮：启动时对既有 DOM 全量扫描一次，兜住观察器开始前已渲染、
                // 且之后不再重新插入的静态文本节点。
                try { walk(document.documentElement, Infinity); } catch (e) { /* ignore */ }
            } else {
                setTimeout(start, 100);
            }
        }
        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", start);
            setTimeout(start, 1500); // 兜底：防止事件已过
        } else {
            start();
        }
    })();

    // ------------------------------------------------------------------
    // 语言切换 API（默认中文；localStorage 持久化）
    // ------------------------------------------------------------------
    function setLanguage(l) {
        lang = (l === "en" || l === "zh-CN") ? l : "zh-CN";
        try { localStorage.setItem(LS_KEY, lang); } catch (e) { /* ignore */ }
        cache.clear();
        if (window.location && window.location.reload) {
            window.location.reload();
        }
    }

    window.CI18N = {
        lang: function () { return lang; },
        set: setLanguage,
        toggle: function () { setLanguage(lang === "zh-CN" ? "en" : "zh-CN"); },
        label: function () { return lang === "zh-CN" ? "语言：中文" : "Language: English"; },
        note: function () { return lang === "zh-CN" ? "切换后自动刷新网页以生效" : "Refreshes the page to apply"; },
        hint: function () { return lang === "zh-CN" ? "点击切换 中文 / 英文；切换后网页会自动刷新以生效。" : "Click to switch Chinese / English. The page refreshes automatically to apply."; },
        translate: translate
    };

    // 延迟到全部脚本加载完成后挂 run / doPopup（它们定义在 utils.js）
    if (window.addEventListener) {
        window.addEventListener("DOMContentLoaded", function () {
            hookRun();
            hookPopup();
        });
        // 兜底：防止 DOMContentLoaded 已过
        setTimeout(function () { hookRun(); hookPopup(); }, 0);
    }
})();
