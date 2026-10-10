// ============================================================================
//  Celestial Incremental — 白屏修复补丁  (localization/bgfix.js)
//  ---------------------------------------------------------------------------
//  作用：修掉「某些情况下背景变成白色」的问题。
//  原则：**不改动任何原版源码**（mod.js / game.js / themes.js / css 一律不碰），
//        只做运行时加固。上游更新时 git 合并零冲突。
//
//  ---------------------------------------------------------------------------
//  白屏的真实成因（已在 Edge + CDP 中逐条复现、并有像素级取证）
//  ---------------------------------------------------------------------------
//  页面底色来自 css/style.css 的
//        body { background: var(--background); }
//  --background 由 js/mod.js 的 updateStyles() 每 50ms 写入一次，取值有两类：
//        (a) 直接量   如 "linear-gradient(0deg, #161616)"、"#676742"
//        (b) 变量引用 如 "linear-gradient(0deg, var(--layerBackground))"
//  只要这个值最终「什么都画不出来」，body 的背景就按 unset 处理 → 透明 →
//  露出浏览器默认白底。触发方式包括：
//        · 引用的变量失效：var(--layerBackground) 拿不到合法颜色
//        · 值被写成字符串 "undefined"
//        · url() 指向缺失素材
//
//  而 css/style.css 的 :root 兜底层**兜不住**，因为那里的值普遍带引号：
//        --miscButton: "#333";   ← 展开成 background-color:"#333" 是非法声明
//  这些变量平时看着正常，只因为 changeTheme()（js/utils/themes.js）会用不带引号
//  的值覆盖到 body 上。一旦 changeTheme() 没跑成，:root 里的非法值就会顶上来，
//  于是 --background 变成 linear-gradient(0deg, "#161616") —— 非法 → 透明 → 白。
//
//  changeTheme() 跑不成的现实入口：js/utils/save.js 的 loadOptions() 里
//        if (themes.indexOf(options.theme) < 0) theme = "default"   ← 赋给了全局 theme，
//  并没有修 options.theme。旧存档遗留的主题名（源码本身迁移过 "aqua"）会让
//  colors[options.theme] === undefined，changeTheme() 于是在读 colors_theme["regBorder"]
//  时抛 TypeError，整套主题变量一个都写不进去 —— 实测可复现。
//
//  附带记录一个同源但独立的崩溃点：js/game.js 的 50ms 主循环用 ticking 做重入保护，
//  而 ticking = false 是循环体的最后一句。中途任何一行抛异常（例如 js/technical/canvas.js
//  读取尚未初始化的 tmp[layer]），ticking 就永久停在 true，整个游戏循环彻底停摆且无法自愈。
//  本补丁把它一并救回来（可用开关关闭）。
//
//  另外注意：左面板之所以在其它区域变白时依然正常，是因为它的底色由 mod.js 用
//  硬编码的宇宙色（如 #0b0b0b）写进 #uniBG 的内联样式，与主题变量无关。
//
//  ---------------------------------------------------------------------------
//  本补丁做的四件事
//  ---------------------------------------------------------------------------
//   1. 注入 CSS：给 <html> 铺一层深色「地板色」，并把默认主题的一套**不带引号**的
//      合法变量声明到 html:root / html body 上。地板色是关键一招 —— 只要没东西画出来，
//      露出的就是这层深色而不是白；而 body 一旦正常画背景就会完全盖住它，零视觉回归。
//   2. 主题自愈：发现 body 上的主题变量缺失/被写成 undefined 时重新执行 changeTheme()
//      （并把非法的 options.theme 纠正为 default），失败则写入硬编码兜底值。
//   3. 背景守卫：包装 updateStyles()，每次写入后用浏览器的解析结果校验 --background，
//      画不出东西就回填一个合法值。
//   4. 主循环解冻：ticking 卡死超过 3 秒时复位（默认开启，见 ENABLE_LOOP_RESCUE）。
//
//  调试：控制台执行 window.__bgfix.status() 看状态，window.__bgfix.repair() 手动修复。
// ============================================================================
(function () {
    "use strict";

    // ------------------------------------------------------------------
    // 配置
    // ------------------------------------------------------------------
    var FLOOR_COLOR = "#161616";   // <html> 地板色（正常情况看不见，只在背景画不出来时兜底）
    var ENABLE_LOOP_RESCUE = true; // 是否启用主循环解冻（false 可关闭）
    var LOOP_STUCK_MS = 3000;      // ticking 卡死多久算异常

    // 默认主题的一套合法（不带引号）取值
    var FALLBACK_VARS = {
        "--background": FLOOR_COLOR,
        "--regBorder": "#7a7a7a",
        "--menuBackground": "#0f0f0f",
        "--layerBackground": "#161616",
        "--miscButton": "#333",
        "--miscButtonHover": "#444",
        "--miscButtonDisable": "#222",
        "--titleGradient": "linear-gradient(90deg, #555555 0%, #3e3e3e 50%, #555555 100%)",
        "--tabTitle": "#444",
        "--scrollBackground": "#000",
        "--scroll1": "#343434",
        "--scroll2": "#3B3B3B",
        "--scroll3": "#424242",
        "--scroll4": "#545454",
        "--selected": "#a0a0a0",
        "--textColor": "#ccc"
    };

    // 自愈时检查是否存在的变量（缺任何一个都说明 changeTheme() 没跑成功）
    var WATCH_VARS = ["--layerBackground", "--menuBackground", "--miscButton", "--regBorder", "--titleGradient", "--tabTitle", "--textColor"];

    var LOG = "[bgfix]";
    var repairs = { theme: 0, background: 0, loop: 0 };

    // ------------------------------------------------------------------
    // 1) 注入 CSS
    //    选择器用 html:root（特指度 0,1,1）而不是 :root（0,1,0）——
    //    这样无论文档顺序如何，都稳压 css/style.css 里带引号的 :root 兜底层。
    //    再叠一条 html body（直接声明在 body 上，优先级高于「继承来的」值），
    //    保证 body 内联变量缺失时也能取到合法值；而 changeTheme() 正常写入的
    //    内联值优先级更高，仍会胜出 —— 零回归。
    // ------------------------------------------------------------------
    function buildCss() {
        var vars = [];
        for (var k in FALLBACK_VARS) vars.push(k + ": " + FALLBACK_VARS[k] + ";");
        var decl = vars.join("");
        return "html:root{" + decl + "}\n" +
            "html body{" + decl + "}\n" +
            // 地板色：<html> 有了不透明背景后，body 的背景不再「传播到画布」，
            // 于是 body 画不出东西时露出的是这里的深色，而不是浏览器默认白底。
            "html{background-color:" + FLOOR_COLOR + " !important;}\n";
    }

    function injectCss() {
        try {
            var st = document.getElementById("bgfix-style");
            if (!st) {
                st = document.createElement("style");
                st.id = "bgfix-style";
                st.textContent = buildCss();
                (document.head || document.documentElement).appendChild(st);
            } else if (st.textContent !== buildCss()) {
                st.textContent = buildCss();
            }
            // 关键：解析期插入的 <style> 实测会被更早声明的 :root 压住，
            // 这里在运行时把它移动到 <head> 末尾再补一次，确保排在最后。
            var head = document.head;
            if (head && st.parentNode === head && head.lastElementChild !== st) {
                head.appendChild(st);
            }
            return true;
        } catch (e) {
            console.warn(LOG, "注入 CSS 失败", e);
            return false;
        }
    }
    injectCss();

    // ------------------------------------------------------------------
    // 判断工具
    // ------------------------------------------------------------------
    function isBadToken(v) {
        v = (v === undefined || v === null) ? "" : String(v).trim();
        return v === "" || v === "undefined" || v === "null" || v.charAt(0) === '"';
    }

    // 把值里的 var(--x) 就地替换成 body 上的实际取值，好让下面做解析期校验
    function resolveVars(value) {
        if (typeof value !== "string" || value.indexOf("var(") < 0) return value;
        var self = resolveVars;
        return value.replace(/var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,([^()]*))?\)/g, function (m, name, fb) {
            var v = "";
            try {
                v = (document.body.style.getPropertyValue(name) || "").trim();
                if (!v) {
                    v = getComputedStyle(document.body).getPropertyValue(name).trim();
                    v = v.replace(/^["']|["']$/g, "");   // 去掉 :root 里那层引号
                }
            } catch (e) { /* ignore */ }
            if (!v || v === "undefined" || v === "null") return (fb !== undefined ? fb : "").trim();
            return v;
        });
    }

    // 解析期校验：让浏览器自己判断这个 background 值收不收。
    // 被语法拒绝时 element.style.background 会读回空串；不依赖 getComputedStyle，
    // 因此完全不受过渡动画中间态影响。
    var valTest = null;
    function acceptedBackground(value) {
        try {
            if (!valTest) valTest = document.createElement("div");
            valTest.style.background = "";
            valTest.style.background = value;
            return !!valTest.style.background;
        } catch (e) {
            return true;   // 拿不准就不动手
        }
    }

    function themeVarsBroken() {
        try {
            if (!document.body) return false;
            for (var i = 0; i < WATCH_VARS.length; i++) {
                if (isBadToken(document.body.style.getPropertyValue(WATCH_VARS[i]))) return true;
            }
        } catch (e) { /* ignore */ }
        return false;
    }

    // ------------------------------------------------------------------
    // 2) 主题自愈
    // ------------------------------------------------------------------
    function sanitizeThemeOption() {
        try {
            if (typeof options !== "object" || !options) return;
            if (typeof themes === "undefined" || !themes || typeof themes.indexOf !== "function") return;
            if (themes.indexOf(options.theme) < 0) {
                console.warn(LOG, "options.theme 非法(" + JSON.stringify(options.theme) + ")，已纠正为 default");
                options.theme = "default";
            }
        } catch (e) { /* ignore */ }
    }

    function applyHardFallback() {
        try {
            if (!document.body) return;
            for (var k in FALLBACK_VARS) {
                try { document.body.style.setProperty(k, FALLBACK_VARS[k]); } catch (e) { }
            }
        } catch (e) { /* ignore */ }
    }

    function repairTheme(reason) {
        try {
            if (!document.body) return;
            sanitizeThemeOption();
            if (typeof changeTheme === "function") {
                try { changeTheme(); } catch (e) {
                    console.warn(LOG, "changeTheme() 抛错：" + e.message);
                }
            }
            if (themeVarsBroken()) applyHardFallback();
            repairs.theme++;
            console.warn(LOG, "已自愈主题变量（原因：" + reason + "）");
        } catch (e) {
            console.warn(LOG, "主题自愈失败", e);
        }
    }

    // ------------------------------------------------------------------
    // 3) 背景守卫
    // ------------------------------------------------------------------
    function backgroundValue() {
        try { return document.body.style.getPropertyValue("--background"); }
        catch (e) { return ""; }
    }

    // 生成一个「合法且尽量贴合当前主题」的兜底背景
    function safeBackground() {
        try {
            var lb = (document.body.style.getPropertyValue("--layerBackground") || "").trim();
            if (!isBadToken(lb) && /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(|[a-zA-Z]+)$/.test(lb)) {
                return "linear-gradient(0deg, " + lb + ")";
            }
        } catch (e) { /* ignore */ }
        return FLOOR_COLOR;
    }

    function checkBackground(force) {
        var raw = backgroundValue();
        if (raw === undefined || raw === null) return;
        var v = String(raw).trim();
        // 空串：源码 case "c" 就是靠它「恢复成 :root 的 --background」，属于预期行为，不干预
        if (v === "") return;
        if (!force && acceptedBackground(resolveVars(v))) return;   // 合法 → 不动
        var fixed = safeBackground();
        try {
            document.body.style.setProperty("--background", fixed);
            repairs.background++;
            console.warn(LOG, "--background = " + JSON.stringify(v.slice(0, 90)) + " 解析不合法，已回填 " + fixed);
        } catch (e) { /* ignore */ }
    }

    function installUpdateStylesGuard() {
        if (typeof window.updateStyles !== "function") return false;
        if (window.updateStyles.__bgfixWrapped) return true;
        var orig = window.updateStyles;
        var wrapped = function () {
            var r = orig.apply(this, arguments);
            try { checkBackground(false); } catch (e) { /* ignore */ }
            return r;
        };
        wrapped.__bgfixWrapped = true;
        wrapped.__orig = orig;
        window.updateStyles = wrapped;
        console.warn(LOG, "已接管 updateStyles()，每次写入后都会校验背景值");
        return true;
    }

    // ------------------------------------------------------------------
    // 4) 主循环解冻
    // ------------------------------------------------------------------
    var stuckSince = 0;
    function loopRescueTick() {
        if (!ENABLE_LOOP_RESCUE) return;
        try {
            if (typeof window.ticking === "undefined") { stuckSince = 0; return; }
            if (window.ticking !== true) { stuckSince = 0; return; }
            if (!stuckSince) { stuckSince = Date.now(); return; }
            if (Date.now() - stuckSince >= LOOP_STUCK_MS) {
                window.ticking = false;
                stuckSince = 0;
                repairs.loop++;
                console.warn(LOG, "主循环 ticking 卡死超过 " + LOOP_STUCK_MS + "ms，已复位");
            }
        } catch (e) { /* ignore */ }
    }

    // ------------------------------------------------------------------
    // 常驻守护
    // ------------------------------------------------------------------
    var started = false;
    function start() {
        if (started) return;
        started = true;
        injectCss();                       // 运行时再补一次，确保排在 <head> 末尾
        installUpdateStylesGuard();
        if (themeVarsBroken()) repairTheme("启动检查");
        checkBackground(false);

        setInterval(function () {          // 主题变量守护
            try { if (themeVarsBroken()) repairTheme("变量缺失"); } catch (e) { }
        }, 800);

        setInterval(loopRescueTick, 500);  // 主循环解冻守护

        if (window.addEventListener) {
            window.addEventListener("focus", function () {
                try { injectCss(); if (themeVarsBroken()) repairTheme("窗口重新聚焦"); } catch (e) { }
            });
        }

        if (!installUpdateStylesGuard()) { // updateStyles 定义在 game.js，可能比本文件晚
            var tries = 0;
            var t = setInterval(function () {
                tries++;
                if (installUpdateStylesGuard() || tries > 200) clearInterval(t);
            }, 100);
        }

        console.warn(LOG, "白屏修复补丁已启用：html 地板色 + 主题自愈 + 背景校验" + (ENABLE_LOOP_RESCUE ? " + 主循环解冻" : ""));
    }

    // ------------------------------------------------------------------
    // 对外调试接口
    // ------------------------------------------------------------------
    window.__bgfix = {
        status: function () {
            var raw = backgroundValue();
            var out = {
                地板色: FLOOR_COLOR,
                主循环解冻: ENABLE_LOOP_RESCUE,
                自愈次数: repairs,
                background内联值: raw,
                background解析后: resolveVars(String(raw || "")),
                background是否合法: acceptedBackground(resolveVars(String(raw || ""))),
                主题变量缺失: themeVarsBroken(),
                ticking: window.ticking
            };
            try {
                var cs = getComputedStyle(document.body);
                out.body背景图 = cs.backgroundImage;
                out.body背景色 = cs.backgroundColor;
                out.html背景色 = getComputedStyle(document.documentElement).backgroundColor;
                out.html的layerBackground = getComputedStyle(document.documentElement).getPropertyValue("--layerBackground").trim();
            } catch (e) { /* ignore */ }
            return out;
        },
        repair: function () {
            checkBackground(true);
            repairTheme("手动调用");
            return this.status();
        },
        _repairs: repairs
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
        setTimeout(start, 0);   // 兜底：DOMContentLoaded 可能已经错过
    } else {
        start();
    }
})();
