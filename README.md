# 天体增量树 · 简体中文汉化版

> 这是 [Icecreamdudes/celestial_incremental](https://github.com/Icecreamdudes/celestial_incremental) 的**民间简体中文汉化分支**（fork）。
> 玩法、数值、美术、音效一律保持原版，唯一区别是额外带了一层可以整目录删除的中文翻译。

原版是英文的增量/放置游戏，基于 [The Modding Tree](docs/!general-info.md)（TMT）引擎，用 Vue 2 写成。这个仓库不改变游戏逻辑，只把界面上出现的英文换成中文。

---

## 开始玩

1. 下载本仓库（`Code → Download ZIP`，或 `git clone`）
2. 双击 `index.html`

首次打开需要联网，页面会从 CDN 取 Vue 2；之后可以离线玩。如果浏览器对本地文件限制较严，也可以在仓库目录里起一个静态服务器：

```bash
python -m http.server 8000
# 然后访问 http://127.0.0.1:8000/index.html
```

存档写在浏览器的 IndexedDB / localStorage 里，和原版完全一致——**原版的存档可以直接导入，汉化版的存档也能拿回原版继续玩**。

---

## 汉化概况

| 项目 | 数量 / 状态 |
|---|---|
| 精确词条（`exact`） | 14,492 条 |
| 片段规则（`fragment`） | 3,002 条 |
| 剧情对话 | 1,063 句，全部人工翻译 |
| 覆盖范围 | 主宇宙全部层、AD1 新宇宙、迷宫房间、飞船战、各色辐射层、成就页、设置页、更新日志 |
| 更新日志残留英文 | 0 |

专有名词按惯例保留英文，方便查攻略、对日志：`Tav`、`Cante`、`Marcel`、`Nova`、`Nox`、`Aniciffo`、`Eclipse`、`Celestial`、`Ragnarök`（译「诸神黄昏」）等。

翻译约定、术语表、每一轮踩过的坑，都记在 [`localization/README.md`](localization/README.md) 里；改词条之前建议先读一遍。

---

## 目录结构（汉化相关）

```
localization/
├── zh_CN.js      词典：exact 精确匹配 + fragment 片段替换（CRLF 行尾）
├── i18n.js       翻译引擎：劫持渲染文本，运行时替换，不碰游戏源码
├── bgfix.js      白屏修复补丁（游戏自身的首帧竞争问题）
├── savefix.js    存档导入修复补丁（见下节，修的是原版的 bug）
└── README.md     维护手册：约定、陷阱、验证流程
```

`index.html` 里只多了 4 行 `<script>` 引入。**`js/` 下的游戏源码一个字都没改**，所以上游每次更新都能近乎无痛地合进来。

---

## 与上游同步

- 上游：`Icecreamdudes/celestial_incremental`，默认分支 `main`
- 当前汉化基线：`1ce9cac2`（v1.15）
- 同步方式：把上游新提交合并进 `main`，再针对新增文本补词条，跑一遍回归（死键、词典 A/B、引擎 A/B、真机对拍），确认 0 回归再发版

汉化滞后于上游时，新增的英文会原样显示——不会报错、不会白屏，只是没翻。

---

## 顺带修掉的一个原版 bug：存档越导越大

原版 `js/utils/save.js` 的 `importSave()` 只做了 `atob` 解码，而存档是用 `btoa(unescape(encodeURIComponent(...)))` 写的。少还原一步的后果是：**每做一次「导出 → 导入」，存档里所有非 ASCII 字符的长度翻一倍。**

游戏里唯一的非 ASCII 内容是元素层 / 阿卡夏层猜词框里那个看不见的零宽连接符 `U+200D`，它的清理逻辑在字符变成乱码后就失效了，于是一路 `3 → 6 → 12 → … → 3 × 2ⁿ`。实测玩家存档：21 轮 = 两份 314 万字符的字符串，导出文件 17 MB；22 轮 = 629 万字符，33.8 MB（正常通关档只有 150~250 KB）。

本仓库的处理：

- `localization/savefix.js` 在运行时替换 `window.importSave`，补上缺失的解码，并加一道低频守卫（猜词框超过 64 字符直接清空）
- 已向上游提交修复 PR：[**#141**](https://github.com/Icecreamdudes/celestial_incremental/pull/141)

**已经被撑大的存档怎么救**：把 JSON 里 `el.guess` 和 `ak.guess` 两个值清空即可（其余字段一个字节都不用动），文件会立刻回到 200 KB 上下，进度完全保留。回到主宇宙待一会儿也会自动清掉，但不会缩小已经落盘的旧文件。

---

## 反馈

发现漏翻、错翻、术语不一致，欢迎开 issue，附上**截图 + 出现位置**（哪个层、哪个标签页）最省事。直接提 PR 改 `localization/zh_CN.js` 更快，注意保持 CRLF 行尾、不要加单字虚词的 `exact` 键。

---

## 致谢与许可

- 游戏本体：[Icecreamdudes/celestial_incremental](https://github.com/Icecreamdudes/celestial_incremental)
- 引擎：[The Modding Tree](docs/!general-info.md)（Acamaeda）/ [The Prestige Tree](https://github.com/Jacorb90/The-Prestige-Tree)
- 本仓库沿用上游的 MIT 许可证，原文见 [LICENSE](LICENSE)；汉化文本同样以 MIT 发布，转载注明出处即可

如果你想学 TMT 写自己的 mod，引擎文档仍然在原处：[入门教程](docs/tutorials/getting-started.md) 、[总览](docs/!general-info.md) 、[layers.js](js/layers.js)。
