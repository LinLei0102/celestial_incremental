# 简体中文汉化层（Celestial Incremental）

本目录是该游戏的**简体中文汉化层**，采用「加载期拦截 + 运行时词典替换」方案，
**不修改任何游戏源码**，因此上游更新时可干净合并。

## 文件

| 文件 | 作用 |
|---|---|
| `zh_CN.js` | 词典：`window.CELESTIAL_I18N = { "zh-CN": { exact: {…}, fragment: {…} } }`，共 **15,368** 条 |
| `i18n.js` | 翻译引擎：在游戏脚本加载前包装各渲染入口，运行时查词典替换 |
| `bgfix.js` | 白屏修复补丁：不改源码，运行时加固背景与主题（详见下节） |

## 接入方式

在 `index.html` 中，于 `js/mod.js` 之后、`js/technical/loader.js` 之前引入：

```html
<script src="localization/zh_CN.js"></script>
<script src="localization/i18n.js"></script>
<script src="localization/bgfix.js"></script>
```

## 引擎工作原理

1. **注册期**：包装 `addLayer`，翻译图层数据中的显示字段（名称/描述/升级/成就/剧情对话/弹窗等）。
2. **渲染期**：包装 `run` / `gridRun` / `doPopup` / Canvas `fillText` / `Vue.component`。
3. **兜底**：`MutationObserver` 监听 DOM，翻译运行期插入的文本节点。
4. **匹配**：所有词条按长度降序合成**一条正则**一次替换；纯字母键自动加 `\b` 边界（长键优先）。

### 三类保护（避免误伤非展示内容）

- **HTML 标签整体保护**：`<…>` 原样保留，标签内的属性名/属性值/JS 不被替换
  （如 `style='width:40px'`、`onclick='player.x.Tabs=…'`）；含标签的整句键仍可命中。
- **资源路径掩码**：`run()` 的字符串返回值也会进入翻译（如 `image()` 返回的图片路径），
  故 `resources/…`、`Savebank/…` 等路径先掩码再还原，避免被改成 `resources/宠物/…`。
- **函数式内容翻译**：`tabFormat() {…}` / microtab `content() {…}` 这类**方法**形态，
  包装为"求值后翻译其返回数组"，使带标签的整句键也能生效。

## 语言切换

游戏内 **设置页 → 「语言：中文 / Language: English」** 按钮切换，切换后页面会自动刷新以生效。

## 术语口径

翻译遵循统一术语表（专有名词如 Tav / Cante / Zar / Matos / Aleph / Celestial 等保留英文；
`Prestige`=威望、`Eclipse 机制`=蚀、`Check Back`=回访、`pylon`=尖塔 等）。

## 白屏修复补丁（`bgfix.js`）

### 现象

某些情况下游戏主区域整片变成**白色**（左面板、按钮、顶部标题条仍然有颜色），刷新后偶发。

### 成因

页面底色来自 `css/style.css` 的 `body { background: var(--background); }`，
而 `--background` 由 `js/mod.js` 每 50ms 写入一次。只要这个值最终**画不出任何东西**
（被浏览器判为非法声明而被整条丢弃），`body` 背景即透明，露出浏览器默认白底。

`css/style.css` 的 `:root` 兜底层之所以兜不住，是因为那里的值**带引号**：

```css
--miscButton: "#333";        /* 展开成 background-color:"#333"，非法 */
```

平时这些变量看起来正常，只因为 `js/utils/themes.js` 的 `changeTheme()` 会把**不带引号**的
合法值写进 `body` 的内联样式。一旦 `changeTheme()` 没跑成功，`:root` 里的非法值就会顶上来。

而 `changeTheme()` 跑不成功的现实入口是上游的一个笔误 —— `js/utils/save.js`：

```js
if (themes.indexOf(options.theme) < 0) theme = "default"   // 赋给了全局 theme，没修 options.theme
```

于是旧存档里遗留/被改过的主题名（上游自己迁移过 `"aqua"`）会让
`colors[options.theme] === undefined`，`changeTheme()` 在读 `colors_theme["regBorder"]`
时抛 `TypeError`，**整套主题变量一个都写不进去**。

> 同源但独立的另一处：`js/game.js` 的 50ms 主循环用 `ticking` 做重入保护，
> 而 `ticking = false` 是循环体最后一句、没有 `try/finally`。中途任何一行抛异常
> （例如 `js/technical/canvas.js` 读取尚未初始化的 `tmp[layer]`），`ticking` 会永久停在
> `true`，整个游戏循环彻底停摆且无法自愈。

### 补丁做的五件事

1. **`<html>` 地板色** —— 给根元素铺 `#161616 !important`。`<html>` 有了不透明背景后，
   `body` 的背景不再「传播到画布」，于是 `body` 画不出东西时露出的是这层深色而不是白；
   而 `body` 一旦正常画背景就会**完全盖住**它，零视觉回归。
2. **变量级兜底** —— 用 `html:root`（特指度 0,1,1）而非 `:root`（0,1,0）重新声明**不带引号**的
   默认主题变量，稳压 `css/style.css` 的带引号 `:root`，且不受运行时注入 `<style>` 的文档顺序影响。
3. **主题自愈** —— 检测 `body` 上主题变量缺失/为 `undefined` 时，先把非法的 `options.theme`
   纠正为 `"default"`，再重跑 `changeTheme()`；仍失败则写入硬编码兜底值。
4. **背景守卫** —— 包装 `updateStyles()`，每次写入后用**解析期校验**（`div.style.background = v`
   看浏览器收不收）判断 `--background` 是否合法，非法就回填
   `linear-gradient(0deg, <--layerBackground>)` 或地板色。
   空串**不干预** —— 那是源码 `case "c"` 用来「回退到 `:root`」的正常机制。
5. **主循环解冻** —— `ticking` 卡死超过 3 秒自动复位（由 `ENABLE_LOOP_RESCUE` 开关控制）。

### 调试接口

```js
window.__bgfix.status()   // 查看地板色 / 内联值与解析后背景 / 是否合法 / 自愈次数
window.__bgfix.repair()   // 手动触发一次修复
```

### 验证

- **167 个图层逐个对拍「补丁开 / 关」**：背景计算结果差异 **0**（含纯色、渐变、`url()` 三类）。
- 解析期校验器自检 **6/6** 正确（含 `"#676742"` 合法、`linear-gradient(0deg,"#161616")` 非法 等）。
- 故障注入：清空全部主题变量 → 自愈；`--background = "undefined"` → 回填。
- 主循环解冻实测：强制 `updateTemp` 抛错后 `player.time` 停止，3 秒后恢复推进。

### 关闭方式

- 想完全关掉主循环解冻：把 `bgfix.js` 里的 `ENABLE_LOOP_RESCUE` 改成 `false`。
- 想整体移除补丁：删掉 `index.html` 里的 `<script src="localization/bgfix.js"></script>` 一行即可。

## 说明

- 本汉化层与原游戏源码解耦，可整体删除（移除上述 `<script>` 行即可回到英文原版）。
- 游戏版权归原作者所有，本目录仅包含汉化所需的词典、引擎与修复补丁。
