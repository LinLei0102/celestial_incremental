# 简体中文汉化层（Celestial Incremental）

本目录是该游戏的**简体中文汉化层**，采用「加载期拦截 + 运行时词典替换」方案，
**不修改任何游戏源码**，因此上游更新时可干净合并。

## 文件

| 文件 | 作用 |
|---|---|
| `zh_CN.js` | 词典：`window.CELESTIAL_I18N = { "zh-CN": { exact: {…}, fragment: {…} } }`，源码里共 **15,777** 行词条（exact 12,782 + fragment 2,995，其中 4 条两块都有；引擎去重后生效 **15,773** 条） |
| `i18n.js` | 翻译引擎：在游戏脚本加载前包装各渲染入口，运行时查词典替换 |
| `bgfix.js` | 白屏修复补丁：不改源码，运行时加固背景与主题（详见下节） |

> **exact 与 fragment 的区别**：`exact` 只在「整条字符串完全相等」时命中（可安全地含资源路径、
> 内联样式、`onclick` 表达式）；`fragment` 作为子串命中，用于句内替换与「源码拼串」场景
> （如 `"which are raising … by ^" + format(…) + ".\n Cost: " + …`，整串永远拼不出字典键，
> 只能靠片段命中）。**会流入 fragment 的键必须保证不会撞上代码标识符**（见下节）。

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

### 五类保护（避免误伤非展示内容）

- **HTML 标签整体保护**：`<…>` 原样保留，标签内的属性名/属性值/JS 不被替换
  （如 `style='width:40px'`、`onclick='player.x.Tabs=…'`）；含标签的整句键仍可命中。
- **资源路径掩码**：`run()` 的字符串返回值也会进入翻译（如 `image()` 返回的图片路径），
  故 `resources/…`、`Savebank/…` 等路径先掩码再还原，避免被改成 `resources/宠物/…`。
- **标识符（id）保护**：`A2-Iridite-Battle-End` 这类短横连接的内部 id 先整体掩码，
  避免被单词级词条逐段误译（渲染成 `A2-Iridite-战斗-End`）。
  只有被判定为「显示名」的 id 形态 token 才**不掩码**，判定满足其一即可：

  | 规则 | 判据 | 例子 |
  |---|---|---|
  | ① | 该 token 出现在某条词典 key 里，**且那条 key 的译文完全译出**（剥掉 HTML 标签、剥掉标点短横线后不含 `-`） | `Honey-Cell`→蜜胞、`Anti-Dragon`→反龙、`Single-Tab`→单标签 |
  | ② | 该 token 在译文里**原样保留**（有意保留英文的术语） | `Asc-1`、`Lvl-4`、`F-13`、`I-VIII`、`SME-A1`、`Toss-Up` |
  | ③ | 人工白名单种子（仅 1 个，见下） | `Z-Jinx` |
  | ④ | （已弃用）「译文里出现该 token 的某个以 `-` 结尾的前缀」—— 会把 `A2-Iridite-Battle-Middle` 这类**误收词条**一起放行，已于第十轮撤回 | — |

  > 规则③的人工种子只有 `Z-Jinx` 一个：术语表裁定 `Jinx→厄运`，故译作 `Z-厄运`
  > （无法用规则②识别）；而全仓库检索显示 `Z-Jinx` **只出现在 changelog 模板串里**，
  > 放开掩码不会波及游戏 UI。

  ⚠️ **注意**：规则①②判干净的**关键动作**是把「标点短横线」剥掉再判 ——
  两侧带空白的 `-`（`v1.13.1 - Akash …`）与行首列表符号（`- Fixed xxx`）都不是 id 标记。
  真正的 id 短横线两侧必无空白（`Hive-Chamber`），所以剥标点不会削弱对 id 的保护。
  更新日志里每条译文都以 `- ` 开头，若忘了这一步，**整份 changelog 的 100+ 条条目
  会因为短横线术语被掩码而全部失配**（第十轮实测：修复前残留 110 个英文 token，
  修复后 0 个）。

  → 另外，**术语的译文请用 `、` 而不要用 `-` 作并列符号**，否则该术语会被当成 id 掩码掉。
- **纯单词键的代码守卫（第十轮新增）**：像 `width` / `length` / `depth` / `points` / `tier`
  这类**单个英文单词**的 fragment 键，同时也是 CSS 属性名 / HTML 属性名 / JS 对象键。
  引擎给它们加了一道右向守卫：**后面紧跟 `'` `"` `=`，或 `:` 后接代码值字符时不匹配**。
  ```
  style='width:69px'   → 不再变成 style='宽度:69px'      （样式失效）
  <img width='100'>    → 不再变成 <img 宽度='100'>        （属性失效）
  {'width': '100px'}   → 不再变成 {'宽度': '100px'}       （JS 失效）
  Cost:  /  Cost:<br>  → 照常译成「价格:」（冒号后不是值字符，属于文案）
  depth 1 / the width of a box → 照常翻译
  ```
  用前瞻实现（非后顾），兼容所有浏览器。
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

## 维护须知（第十轮踩坑记录）

> **第十轮续补（D1 审计轮）改了 2 个文件、4 处：**
> 1. `zh_CN.js` —— 把 `"Next building unlocked at Asc-1 Lvl-"` 这条**永远不可能命中的键**
>    改成前缀键 `"Next building unlocked at "`（源码是 `… Lvl-"` + 数字，运行时拼成 `…Lvl-5`）。
> 2. `i18n.js` —— `ID_SAFE` 增加判定规则②（译文原样保留 token 即视为显示名），
>    实测 21,980 条语料 **2 处改善 / 0 回归**。
> 3. `i18n.js` —— 判「译文干净」前**剥掉标点短横线**（两侧带空白的 `-`、行首 `- `），
>    修好整份 changelog（残留英文 token **110 → 0**），真机 3,733 条文本签名对拍 **仅 1 处差异**
>    且是页面实时状态（与翻译无关）。
> 4. `i18n.js` —— 人工白名单种子 `Z-Jinx`（术语表裁定 `Jinx→厄运`，无法用规则②识别；
>    全仓库检索确认它只出现在 changelog 模板串内）。

1. **每个被标签拆开的文本节点都需要独立的键。**
   宇宙头部模板是 `<p v-html="run(universes[player.universe].name, …)">`，而
   `name = "Dark Universe 1<br>Shadow Overworld"` —— `v-html` 会把 `<br>` 拆成
   **两个文本节点**，真正进入 DOM 兜底钩子的是裸串 `"Dark Universe 1"` 与
   `"Shadow Overworld"`，而组合键 `"Dark Universe 1<br>Shadow Overworld"` 在 DOM 路径上
   **永远不会被匹配**。凡被 `<br>` 或标签拆开的串，都要为每一段单独配键。
   已按此补齐 16 个宇宙的头部（其中 12 个是 `A<br>B` 复合名，逐一补了两段裸键）。

2. **别拿 CSS 属性名当词条。** `width` / `length` / `depth` 这类单词键极易撞上样式与 JS；
   引擎已有守卫（见上节），新增时仍请自查是否会被用作代码标识符。

3. **术语译文里的并列符号用 `、`，不要用 `-`。** 否则该术语会被 id 掩码（见上文）。

   > 更进一步：**即使译文里保留英文术语，也别指望它在「拼接语境」里生效** ——
   > 例如源码 `"Next building unlocked at Asc-1 Lvl-" + formatWhole(…)`，
   > 运行时拼成 `…Asc-1 Lvl-5`，其中 `Asc-1` 与 `Lvl-5` 都是 id 形态而被掩码，
   > 键里任何跨过掩码位置的写法都永远匹配不上。正确做法是把键**收在动态部分之前**：
   > `"Next building unlocked at "` → `"下一栋建筑解锁于 "`。
   > 同一串若既做整串又有拼接，请拆成**两条键**（一条整串 exact，一条前缀 fragment）。

4. **整串一次翻译 vs 逐条翻译，行为不同。**
   更新日志是 `let changelog = \`…\`` 生成的一整块 55k 字符 HTML，
   它走的是「掩码 → 主正则」的长串路径，**不是**逐条 exact 路径。
   因此「单行探测通过」**不等于**「实际渲染通过」——改完引擎务必跑一次整块 changelog 对拍
   （见 `_audit/_cl_now.js`：`整段 changelog 残留 token` 应为 `[]`）。
   同理，`_audit/_ab2_corpus.json` 那种「一条一行的语料库 A/B」看不见长串路径的问题，
   需要**真机渲染快照对拍**（`probe_all_live.js` 跑两遍，数字归一化后逐条比）来兜底。

5. **改词典务必保留 CRLF。** `zh_CN.js` 是 CRLF 行尾；脚本改写时用 `newline=''` 读取、
   以 `\r\n` 重新拼接，否则整个文件产生全量 diff、上游无法合并。

6. **验证工具**（位于仓库外的 `_audit/`，不随游戏分发）：

   | 脚本 | 作用 |
   |---|---|
   | `lib_engine.js` | 在 Node 中**真实装载** `i18n.js`+`zh_CN.js`，导出与浏览器同款的 `translate()` |
   | `t_dict_ab.js` | 两份**词典** A/B（引擎不变），按 `residual()` 分类「改善 / 回归」 |
   | `t_engine_ab.js` | 两份**引擎** A/B（词典不变），21,980 条语料 + 代码标识符丢失检测 |
   | `t_idsafe_risk.js` | **全量风险矩阵**：词典里 340 个短横线 token × 15 种上下文（含 `xxx.K`、`style='K:1px'`、`{'K':1}`）对拍 |
   | `t_newtok_reach.js` | 新增白名单 token 的**可达性**：它在源码里出现在哪、是否只在 changelog 内 |
   | `t_guard.js` | 断言 id、资源路径、内联样式、纯单词代码上下文不被破坏 |
   | `t_css.js` | 内联样式污染检测（fragment 键撞 CSS 属性名） |
   | `t_dangerkeys.js` | 「单词型 fragment 键 ∩ 源码代码标识符」求交集 |
   | `t_templates.js` | `TEMPLATE_PATCH` 键是否全部命中、打完补丁的模板是否残留英文 |
   | `t_deadkeys.js` | 死键检测（`translate(K) === K` 的键永远不可能生效） |
   | `r10_coverage.js` / `r10_d1.js` | 静态覆盖率：全源码候选串 / D1 全部层 × 真实引擎 |
   | `_cl_now.js` | 整段 changelog 对拍（长串路径），残留应为 `[]` |
   | `probe_d1_live.js` / `probe_all_live.js` | 真机探针：D1（61 状态）/ 全游戏（458 状态），逐状态快照并判定残留 |
   | `a_probe_diff.js` | 两次真机快照对拍（数字归一化后逐条比对），用来证明改动**零回归** |

## 说明

- 本汉化层与原游戏源码解耦，可整体删除（移除上述 `<script>` 行即可回到英文原版）。
- 游戏版权归原作者所有，本目录仅包含汉化所需的词典、引擎与修复补丁。
