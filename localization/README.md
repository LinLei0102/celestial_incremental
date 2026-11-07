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

## 第十二轮踩坑记录（上游 v1.15「衰败降临」同步后的补齐）

> 本轮范围：上游同步带来的 910 条新串 → 剧情 1,063 句人工翻译 + AD1／飞船战／杂项 262 条，
> 并回头把历史遗留的「半翻」清掉（710 → 47，剩余全是专名与 `tick`／`MK` 这类技术词）。

7. **`exact` 里的键会被当片段用 —— 单字／虚词键是毒药。**
   引擎把 `exact` 与 `fragment` 的键**合进同一个 `masterRe`**（`masterMap[k] = k in exact ? exact[k] : fragment[k]`），
   所以一条 `"THE": "这"` 的 exact 会让 `"THE WORLD"` 命中片段、变成 `这 WORLD`。
   同类的 `"true": "开"` 会把 `He is the true villain here!` 变成 `He is the 开 villain here!`。
   已删 `"THE"`；`"true"` 保留（布尔开关要用），靠整句 exact 兜住散文。
   **新增键前先自问：这条键会不会作为子串出现在别的句子里？**

8. **` for ` 这类虚词片段会产出乱句，能整句就整句。**
   `" for ": "，造成 "` 曾把 `Watch for Bombs` 变成 `Watch，造成 Bombs`、
   `Regen is halved for all characters` 变成 `Regen 减半，造成 all characters`。
   已改为 `"，"`。判据：一条片段如果单独拿出来不成短语，就不要进 `fragment`。

9. **`exact` 段以 `    },` 收尾，`fragment` 段以 `    }` 收尾 —— 两者不能混。**
   往 `exact` 末尾插条目时，`next(... lines[i] == "    }" ...)` 会一路跳过 `    },`
   一直找到 `fragment` 的收尾，结果把整批 exact 塞进了 `fragment` 段（本轮真踩了，364 条）。
   正确边界：`lines[i].strip() == "}," and lines[i+2].strip().startswith("fragment:")`。

10. **半翻扫描必须先反转义再比对。**
    `strList()` 用正则抓源码字面量时，`\"` 这类转义是原样留在捕获组里的，
    直接喂给 `translate()` 会把含引号的整句判成「未翻」（本轮 1 条长句误报）。
    另外要排除**引号配对错位产物**：`" + format(tmp[this.layer].buyables[this.id].cost) + "`
    这类「上一个串的收尾引号 + 下一个串的开头引号」会被当成一个字符串，
    里面是 JS 代码而不是界面文案，必须按 `^\+ *(format|formatWhole|…)\(` 过滤掉。

11. **罗马数字与 2~4 位全大写缩写不算「残留英文」。**
    `BI IP Upgrade I → BI 无限点升级 I` 是完全正确的译文。
    判据里要剥掉 `\b[IVXLC]{1,6}\b` 与 `\b[A-Z]{2,4}\b`，否则 659 条里 244 条是误报。

12. **changelog 是单个大模板串，新版本段落只能靠长片段补。**
    v1.15 那段是 `- DUE TO THE SECRETIVE NATURE…` 这种整行英文，
    加 5 条**整行**片段（`DUE TO THE…`、`v1.15 - Decaying Descent`、`- Check Nox perks!`、
    `-Made a lot of balancing changes`、`-Fixed a lot of bugs`）即可让
    `_cl_now.js` 的残留 token 从 24 条降到 `[]`。含标点的长片段是安全的：
    `isPureWord()` 只对**纯字母单token**加 `\b` 守卫，多词键走 `escapeRe()` 直接子串匹配。

13. **AD1 真机探针的「残留」要以专名为终点。**
    补完后 `probe_ad1.js` 剩 13 条，全是 `Eclipse` / `Nox` / `Aniciffo` / `Marcel` / `Celestial` / `BH`
    这类按术语表保留的英文，属预期终态；`probe_d1_live.js` 的 61 个状态各剩 3 条，
    是侧栏图层符号 `DG` / `LE` / `GJ`（`symbol:` 字段，本来就是图标不是文案）。

14. **导出存档暴涨到几十 MB —— 原版 `importSave()` 缺一层 UTF-8 解码。**
    导出与导入用了不对称的编解码：

    | 位置 | 代码 |
    |---|---|
    | `exportSave()` / `exportFile()` | `btoa(unescape(encodeURIComponent(json)))` |
    | `load()` | `JSON.parse(decodeURIComponent(escape(atob(s))))` |
    | `importSave()` | `JSON.parse(atob(s))` ← **少了 `decodeURIComponent(escape(...))`** |

    「导出」把字符串的 UTF-8 字节按 Latin-1 逐个字符展开，「导入」却没还原。
    于是每个非 ASCII 字符被拆成 2~3 个 Latin-1 码点；**每做一次「导出 → 导入」字符数翻一倍**。

    全存档唯一的非 ASCII 内容，是 `elements.js:30` / `akash.js:34` 给空猜词框填的
    零宽连接符 `U+200D`：
    ```js
    if (player.el.guess === "") { player.el.guess = "\u200d" }
    ```
    它们的清理逻辑是 `replaceAll("\u200d","")`，膨胀后字符串里只剩 Latin-1 乱码、
    早已不含 `U+200D`，所以**永远清不掉，只能继续变大**。

    实测：1 个 `U+200D`（3 字节）经 **21 轮**「导出→导入」= `3 × 2^20` = **3,145,728 字符 = 6 MiB**；
    `el.guess` + `ak.guess` 合计 12.58 MB，占该存档 JSON 的 **98.6%**（17 MB 文件 → 瘦身后 230 KB）。

    判定特征（一眼认出来）：`el.guess` 与 `ak.guess` **完全相同**、长度是 `3 × 2^n`、
    字符只有 `U+00C3` `U+00C2` `U+0082` `U+0083` 这几种。

    修复见 `localization/savefix.js`：运行时替换 `importSave` 补上解码，并加低频守卫
    （两个猜词框超过 64 字符即清空，正常输入 ≤ 8 字符，无副作用）。未改动 `js/` 下任何文件。

    附带发现：`js/layers.js:93-94`（`i` 层 / Origin，主宇宙）每帧无条件
    `player.ak.guess = ""` / `player.el.guess = ""`。所以只要回到 U1 让 `i` 层跑起来，
    膨胀值就会被自动清掉；但它**不会**缩小已写进磁盘的旧存档，也救不回已经翻倍的轮次。

### 15. `buyables[x].display()` 的说明是**多行拼接串**，要按「动态断点」拆成多条键

`js/DarkAU1/spaceRadiation.js` 这类写法：

```js
display() {
    return "which are giving " + format(x) + " space decay per dark radiation click.\n\
        This buyable is currently boosting production by x" + format(y) + ".\n\
        Cost: " + format(tmp[this.layer].buyables[this.id].cost) + " Space Radiation"
}
```

拼完是一整串带 `\n` 与缩进空格的文本，**永远不可能整串命中**，只能靠片段。
办法是沿着每个 `+ format(...)` 把静态段切开，逐段建片段键：

| 键 | 值 |
|---|---|
| ` space decay per dark radiation click.` | ` 空间衰变，每次点击黑暗辐射。` |
| ` decay generators^2 per dark radiation click.` | ` 衰变发生器^2，每次点击黑暗辐射。` |
| `This buyable is currently boosting production by x` | `该可购项当前使产量提升 x` |
| ` Space Radiation` | ` 空间辐射` |

注意两点：
1. 键里**不要带行首缩进**（源码里是 `\n` + 20 个空格），否则换个缩进就失配；
   把带空格的边界放进键尾/键首就够了。
2. `^2` / `^3` 这类上标必须**各写一条**，不能只写 ` decay generators per ...`，
   否则 `^2` 会留在中文后面变成「衰变发生器，每次点击…^2」。

排查手段：`_audit/probe_sr.js` —— 摆一份带数值的假存档、切到该层、抓全部文本节点，
打印「仍含英文字母」的条目。比翻源码快得多。

### 16. `raw-html` 里的 HTML 标签会切断文本节点 —— 键**不能跨标签**

aniciffo 层「彩色辐射」页的写法是：

```js
["raw-html", () => hasUpgrade("ani", 11) ? "You have <h3>" + format(amt) + "</h3> red radiation. (+" + ... : ""]
```

浏览器把它拆成 **text / `<h3>` / text** 三段，引擎只拿到文本节点：

- `You have `
- ` red radiation. (+172.88/6.00s)`
- `Costs ` + ` dark radiation.`

所以任何含 `<h3>` 的键（例：`Boosts dark radiation gain by x<h3>`）在真机上**永远不命中**，
必须按标签边界拆成纯净文本键：

| 键 | 值 |
|---|---|
| ` red radiation. (+` | ` 红色辐射。(+` |
| ` dark radiation.` | ` 黑暗辐射。` |
| ` red radiation` | ` 红色辐射` |

反过来，**颜色词不能单独建键**：`"Red": "红"` 会把 ` Red Radiation</small>` 变成「红 辐射」，
必须整段收（`" Red Radiation</small>"` → `" 红色辐射</small>"`）。

另外：`formatTime()` 的入参是**秒**。假存档里填 6 / 9 / 12 才显示 `6.00s`，
填 6000 会变成 `1.67h`，对不上截图就别怀疑字典。

排查手段：`_audit/probe_color.js`（摆假存档 → 切到 ani 层 `Color Radiation` → 抓文本节点）。

### 17. 同位素名（`carbon-14`）被当成内部 id 掩码 —— 小写首字母的漏网

`decay.js` / `punchcards.js` 里大量出现化学同位素名：

```js
"which are boosting carbon-14 gain by x"
... + " carbon-14.<br>(based on dark grass)</h3>"
x + " to alpha particle gain (based on universe resets)<br>"
```

`ID_SCAN = /[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+/g` 会把 `carbon-14` 整个当 id 掩码，
于是**含它的整句键在拼接语境下全部失配**（只剩 `which are boosting carbon-14 获取 x`）。

引擎里有两道闸，别改错地方：

| 闸 | 作用范围 | 原有例外 |
|---|---|---|
| `idShape()` | **只**用于 exact 整串分支 | `^[A-Z][a-z]+-\d+$`（大写首字母） |
| `isDisplayName()` → `ID_SAFE` | fragment 主正则掩码 | 规则①②（译文干净 / 原文保留） |

同位素译文「碳-14」含 `-`、也不含英文原文，规则①②都不满足，所以**必须**在
`isDisplayName()` 里放行：

```js
if (/^[A-Za-z][a-z]+-\d+$/.test(t) && !/^Refinements-/i.test(t)) return true;
```

`Refinements-17` 是**反例**：它是 `js/Hex/blessings.js:639` 的公式变量名
`(Refinements-17)^1.6`，放行会被译成「精炼-17」破坏公式，必须排除。

验证方式：
- `_audit/t_idsafe_risk.js`（`RISK_BEFORE=<旧 i18n.js>`）应只剩**同位素名差异**，
  非同位素差异 0（本轮 238 条差异全部是 17 个同位素 × 14 种上下文）。
- `_audit/t_dec.js` 覆盖 36 条衰变层 / 穿孔卡文本。
- `_audit/probe_dec.js` 真机切 `dec` 层 Main，残留英文应为 0。

## 说明

- 本汉化层与原游戏源码解耦，可整体删除（移除上述 `<script>` 行即可回到英文原版）。
- 游戏版权归原作者所有，本目录仅包含汉化所需的词典、引擎与修复补丁。
