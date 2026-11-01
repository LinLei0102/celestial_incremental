// ============================================================================
//  savefix.js —— 修复原版 importSave() 缺少 UTF-8 解码导致的存档畸形膨胀
//  ---------------------------------------------------------------------------
//  【现象】
//  导出的存档文件异常巨大（实测 17 MB，正常应为 ~200 KB）。
//
//  【根因】
//  save.js 的导出与导入用了两套不对称的编解码：
//      exportSave() / exportFile()：  btoa(unescape(encodeURIComponent(json)))
//      load()：                       JSON.parse(decodeURIComponent(escape(atob(s))))
//      importSave()：                 JSON.parse(atob(s))          ← 少了 decodeURIComponent(escape(...))
//
//  「导出」会把字符串的 UTF-8 字节按 Latin-1 逐个字符展开，而「导入」没有还原。
//  于是每个非 ASCII 字符被拆成 2~3 个 Latin-1 码点；每做一次「导出 → 导入」，
//  字符数就再翻一倍（3 字节 → 6 → 12 → …，指数增长）。
//
//  【为什么只有 el.guess / ak.guess 中招】
//  elements.js:30 与 akash.js:34 会把空的猜词输入框填成零宽连接符 U+200D：
//      if (player.el.guess === "") { player.el.guess = "\u200d" }
//  它是整个存档里唯一的非 ASCII 内容，所以成了唯一被反复翻倍的地方。
//  而这两处 update() 的清理逻辑是 replaceAll("\u200d", "")，膨胀后字符串里
//  早已不含 U+200D（只剩 Latin-1 乱码），因此永远清不掉、只能继续变大。
//
//  【实测】
//  1 个 U+200D（3 字节）经 21 轮「导出→导入」= 3 × 2^20 = 3,145,728 字符 = 6 MiB，
//  两个字段合计 12.58 MB，占该存档 JSON 的 98.6%。
//
//  【本文件做的事】
//  1) 运行时替换 window.importSave，补上 decodeURIComponent(escape(...))；
//  2) 装入低频守卫：两个猜词输入框若超过 64 字符（正常输入 ≤ 8），自动清空，
//     让已经中招的存档自行瘦身。
//  不改动 js/ 下任何源码。
// ============================================================================
(function () {
    "use strict";
    if (typeof window === "undefined") return;

    // 自由文本输入框里已知会被游戏自动填值、且可能被该 bug 撑爆的字段。
    // 仅在这两个字段异常超长时清空，不涉及任何进度数据。
    var TEXT_INPUTS = [["el", "guess"], ["ak", "guess"]];
    var MAX_LEN = 64;

    function decodeSave(str) {
        var raw;
        try {
            raw = atob(String(str).replace(/\s+/g, ""));
        } catch (e) {
            return null;                     // 不是合法 base64，交给原逻辑去报错
        }
        // 优先按 TMT 自己的编码（exportFile 的产出）解码，且要求能解析成 JSON
        try {
            var utf8 = decodeURIComponent(escape(raw));
            JSON.parse(utf8);
            return utf8;
        } catch (e) {
            // 退化：原样返回，行为与原版一致，绝不比原来更糟
            try { JSON.parse(raw); return raw; } catch (e2) { return null; }
        }
    }

    function sanitize(obj) {
        for (var i = 0; i < TEXT_INPUTS.length; i++) {
            var layer = obj[TEXT_INPUTS[i][0]];
            if (!layer || typeof layer !== "object") continue;
            var v = layer[TEXT_INPUTS[i][1]];
            if (typeof v === "string" && v.length > MAX_LEN) layer[TEXT_INPUTS[i][1]] = "";
        }
    }

    function install() {
        var orig = window.importSave;
        if (typeof orig !== "function" || typeof window.getStartPlayer !== "function") return false;
        if (orig.__savefix) return true;

        var patched = function (imported, forced) {
            if (imported === undefined) {
                // 用户手工粘贴：沿用原版的提示语与流程
                return orig.apply(this, arguments);
            }
            var json = decodeSave(imported);
            if (json === null) return orig.apply(this, arguments);   // 解不开就完全交给原版

            try {
                var tempPlr = Object.assign(window.getStartPlayer(), JSON.parse(json));
                if (tempPlr.versionType != window.modInfo.id && !forced &&
                    !confirm("This save may or may not work, just press 'ok' and see what happens."))
                    return;
                sanitize(tempPlr);
                window.player = tempPlr;
                window.player.versionType = window.modInfo.id;
                window.fixSave();
                window.versionCheck();
                window.NaNcheck(window.save);
                window.save();
                window.location.reload();
            } catch (e) {
                console.error("[savefix] 导入失败，回退原版逻辑", e);
                return orig.apply(this, arguments);
            }
        };
        patched.__savefix = true;
        window.importSave = patched;

        // 低频守卫：让已经膨胀的存档（含此前用旧代码导入过的）自动恢复
        setInterval(function () {
            try {
                if (typeof window.player !== "object" || !window.player) return;
                sanitize(window.player);
            } catch (e) { }
        }, 2000);

        console.log("[savefix] importSave 已修补（UTF-8 解码 + 猜词输入框守卫）");
        return true;
    }

    if (install()) return;
    // localization/ 在 js/utils/save.js 之前加载，需等它就绪
    var tries = 0;
    var timer = setInterval(function () {
        if (install() || ++tries > 600) clearInterval(timer);
    }, 50);
})();
