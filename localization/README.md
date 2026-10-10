# 简体中文汉化层（Celestial Incremental）

本目录是该游戏的**简体中文汉化层**，采用「加载期拦截 + 运行时词典替换」方案，
**不修改任何游戏源码**，因此上游更新时可干净合并。

## 文件

| 文件 | 作用 |
|---|---|
| `zh_CN.js` | 词典：`window.CELESTIAL_I18N = { "zh-CN": { exact: {…}, fragment: {…} } }`，共 **15,368** 条 |
| `i18n.js` | 翻译引擎：在游戏脚本加载前包装各渲染入口，运行时查词典替换 |

## 接入方式

在 `index.html` 中，于 `js/mod.js` 之后、`js/technical/loader.js` 之前引入：

```html
<script src="localization/zh_CN.js"></script>
<script src="localization/i18n.js"></script>
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

## 说明

- 本汉化层与原游戏源码解耦，可整体删除（移除上述两行 `<script>` 即可回到英文原版）。
- 游戏版权归原作者所有，本目录仅包含汉化所需的词典与引擎。
