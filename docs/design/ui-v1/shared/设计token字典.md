# 设计 token 字典（票 02 · shared）

> **这是什么**：玄枢自有界面（S1–S15）里出现的**结构元素**归纳成的 token 族与命名表。每屏的线框与组件树只引用这里的 token 名，不再自己造名。
> **这不是什么**：**不含视觉值**。本文件里没有色值、没有 px、没有字号、没有阴影参数 —— 这些一律由**票 03（UI 素材资产制作）**在 alias 层填。本稿只定义「这个名字是什么意思、用在哪里」。
> **消费方**：票 03（填值）｜票 07–16（在组件树里点名 token 族，不点名取值）。
> 证据约定同 [`DSH槽位映射.md`](DSH槽位映射.md)：`<包名>/<包内路径>:<行号>`，包名相对本机 DSH 实装（见 [`../README.md`](../README.md) §9）。**不写绝对路径**。
> 状态：draft（票 02 交付物）｜日期：2026-10-11

---

## 0. 命名规则与分层模型

### 0.1 三层模型（沿用 DSH，不另起一套）

DSH 已有的 token 体系是**两层**：**尺度层** `--dsw-static-*`（静态调色板 / 尺度）+ **语义别名层** `--dsw-alias-*`（按用途命名）。
证据：`dsh-client-ui-theme/lib/client.js:1148`（static 尺度表）、`:1234-1333`（alias 目录，14 条，逐条 `requiresLightAndDark: true`）。

玄枢**加第三层**，只做命名，不重复造值：

| 层 | 前缀 | 谁拥有 | 本稿是否涉及 |
|---|---|---|---|
| 尺度层 | `--dsw-static-*` | DSH 主题（`dsh-client-ui-theme`） | ✗ 不涉及 |
| 语义别名层 | `--dsw-alias-*`、`--dsw-specific-*` | DSH 主题 | 仅作**映射目标**（见各表的「建议别名」列） |
| **玄枢语义层** | **`--xs-*`** | 玄枢（票 03 填值） | ✔ **本文件全部内容** |

**原则**：`--xs-*` 是**别名层之上的别名层**。凡 DSH 已有合适语义别名者，`--xs-*` 直接指向它（票 03 写 `var(--dsw-alias-…)`）；只有玄枢特有语义（谱级别 / 只读·锁定·不可见约束）才需要票 03 给出**新值**。

**这条设计被上游规则硬性要求**（不是审美选择）：插件**不得 require 任何 Harness Client 包**，必须照抄形状自研，且**只保留 `--dsw-alias-*` token 引用** —— 原文「Tokens then remain the only shared styling dependency」。证据：`dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:35`；同文件 `:34` 规定「样式只走主题 token（`--dsw-alias-*`），**字面颜色仅限插画**」。

⇒ **token 是玄枢界面与 DSH 宿主之间唯一被允许的共享依赖**。因此本字典的完整性直接决定各屏能否与宿主视觉一致；反过来，**漏定义某个结构元素的 token = 实现票被迫写死字面值 = 违反上游规则**。

### 0.2 命名法

```text
--xs-<族>-<名>[-<角色>]
```

- **族**（本稿定稿的 9 族）：`surface` `text` `edge` `space` `radius` `state` `level` `constraint` `size`（+ 附属 `motion`）。
- **名**：语义短名，全小写、连字符分词，用**产品定名**（谱 / 藏 / 底稿 / 日课 / 问事 / 挂载 / 沉淀 / 合参），不用旧名（模块 / 资产 / 每日运势 / 多模型对比）。术语对照见 [`../README.md`](../README.md) §7。
- **角色**（可选）：`-fg`（前景，文字/图标）/ `-bg`（底）/ `-border`（描边）。**不出现「hover」「active」这类交互态名词** —— 交互态归 `state` 族统一表达。

### 0.3 一条 token 的完整定义（四列，本文件所有表同构）

| token | 语义 | 用在哪 | 取值 |
|---|---|---|---|

- **语义**：这个名字代表什么（不看取值就能懂）。
- **用在哪**：屏号 + 部位。至少一个，否则该 token 应删除。
- **取值**：**本文件一律写「票 03 填」**。表里另设「建议别名」列，只写**语义映射目标**（不是取值）。

### 0.4 禁则（写稿人自查）

1. 本文件**不出现**色值（`#rrggbb` / `rgb()` / 颜色名）、px / rem / em 数值。
2. 线框里**不写 token**（线框只写结构与文案位），token 只出现在组件树与该屏第 9 节。
3. **不新造状态同义词**：状态名只能用 `empty / loading / ready / error / running / done / stale`（[`../README.md`](../README.md) §3.3）。
4. **颜色不作为唯一区分手段**：`level` 与 `constraint` 两族的任何呈现**必须同时带文字标签**（见 §7.3、§8.4）。

---

## 1. 族总览

| 族 | 管什么 | token 数 | 主用屏 |
|---|---|---|---|
| [`surface`](#2-surface表面) | 面的底色（应用 / 面板 / 卡 / 嵌套 / 浮层 / 遮罩 / 选中 / 锁定 / 只读） | 12 | 全部 |
| [`text`](#3-text文字) | 文字与图标的语义层级 | 11 | 全部 |
| [`edge`](#4-edge描边与聚焦) | 发丝描边、分隔线、焦点环 | 6 | 全部 |
| [`space`](#5-space间距) | 外边距 / 区块距 / 卡距 / 卡内距 / 行距 / 堆叠距 | 10 | 全部 |
| [`radius`](#6-radius圆角) | 卡 / 嵌套面 / 控件 / 胶囊 / 浮层 / 图标底 | 6 | 全部 |
| [`state`](#7-state状态) | 7 个稳定状态名的前景 / 底 | 9 | 全部（每屏必须给空/加载/错误） |
| [`level`](#8-level谱级别) | 谱的三档级别 + 三种「不是谱」的实体 | 9 | S5 / S6 / S8 / S11 / S12 |
| [`constraint`](#9-constraint约束只读--锁定--不可见) | 只读 / 纯派生 / 锁定 / AI 不可见 / 预算裁剪 / 人工闸门 | 11 | S1 S2 S4 S5 S6 S7 S8 S10 S11 S13 S15 |
| [`size`](#10-size尺寸) | 语义尺寸（宽 / 高 / 断点 / 图标 / 图形） | 12 | 全部 |
| `motion` | 骨架扫光 / 抽屉与浮层进出 | 3 | S1 S2 S8 |

**合计 95 个 token**（含附属 `motion`）。票 03 的填值工作量下界；`constraint` 与 `level` 两族是**新增值**的主要来源（DSH 侧无对应语义）。

---

## 2. `surface`（表面）

| token | 语义 | 用在哪 | 建议别名（语义映射，非取值） | 取值 |
|---|---|---|---|---|
| `--xs-surface-app` | 应用最底层背景 | S1/S4/S5/S11/S13 main 面板根容器 | `--dsw-alias-bg-base` | 票 03 填 |
| `--xs-surface-panel` | 面板容器底（与 app 底可同可不同） | S1/S5/S6/S11/S13 面板外壳 | `--dsw-alias-bg-base` | 票 03 填 |
| `--xs-surface-card` | 卡面（一张独立的卡片） | S1 四卡、S5 谱卡、S9 合参候选卡、S11 藏卡、S14 日课卡 | `--dsw-alias-bg-layer-1` | 票 03 填 |
| `--xs-surface-card-nested` | 卡内嵌套面（卡里的分区） | S1 卡内区块、S8 挂载账本行内区、S10 沉淀预览区 | `--dsw-alias-bg-layer-2` | 票 03 填 |
| `--xs-surface-overlay` | 浮层底（抽屉 / 弹窗 / 浮卡） | S2 命盘卡详情抽屉、S8 挂载账本抽屉、S10 确认弹窗、S4 引导浮层 | `--dsw-alias-bg-overlay` | 票 03 填 |
| `--xs-surface-overlay-mask` | 浮层后方遮罩 | S2 / S8 抽屉、S10 确认弹窗 | **无直接别名 → 票 03 新给**（DSH 的 `Modal` 遮罩是黑色半透明且**不模糊背景**，证据 `dsh-client-ui-primitives/README.zh.md:120`、`dsh-client-ui-theme/README.zh.md:47`） | 票 03 填 |
| `--xs-surface-sidebar` | 侧栏列底（沿用 DSH，不改） | S15 侧栏行所在列 | `--dsw-specific-sidebar-fill` | 票 03 填 |
| `--xs-surface-interactive-hover` | 可交互行的悬停面 | S5 谱列表行、S11 藏列表行、S6 勾选行、S15 侧栏行 | `--dsw-alias-interactive-bg-hover` | 票 03 填 |
| `--xs-surface-selected` | 选中 / 激活面 | S6 已勾选谱行、S9 已采用候选、S15 当前面板行 | `--dsw-alias-interactive-bg-hover` | 票 03 填 |
| `--xs-surface-readonly` | **只读面**（内容在场但不可编辑） | S2 命盘卡详情（C1）、S13 底稿视图（C2） | **无直接别名 → 票 03 新给** | 票 03 填 |
| `--xs-surface-locked` | **锁定行面**（默认在场、不可关） | S6 勾选列表的「底座」「底稿」两行（C5） | **无直接别名 → 票 03 新给** | 票 03 填 |
| `--xs-surface-skeleton` | 骨架屏占位块底 | S1 四卡各自的卡级骨架（README §6 D2）、S5/S11/S13 列表骨架 | **无直接别名 → 票 03 新给**（DSH 无 `Skeleton` 原语，见 [`DSH槽位映射.md`](DSH槽位映射.md) §5.2） | 票 03 填 |
| `--xs-surface-empty` | 空态区的底（与正常内容区分） | S1/S4 空态、S5/S11/S13 空态、S6 无谱可选、S7 无历史 | **无直接别名 → 票 03 新给** | 票 03 填 |

---

## 3. `text`（文字）

> 全部 `text` token 同时约束**颜色**与**字重/字号档位语义**；票 03 只填颜色侧，字号侧归 UI 阶段（README §1「不含视觉精修」）。

| token | 语义 | 用在哪 | 建议别名 | 取值 |
|---|---|---|---|---|
| `--xs-text-brand` | 品牌名「玄枢」 | S1 面板标题、`sidebar.brand.name` 占位 | `--dsw-alias-brand-primary` + `--dsw-font-family-brand` | 票 03 填 |
| `--xs-text-title` | 屏 / 卡的主标题 | S1 卡名、S5 谱名、S2 抽屉标题、S13 底稿标题 | `--dsw-alias-label-primary` | 票 03 填 |
| `--xs-text-heading` | 区块小标题 | S1 卡内分节、S10 沉淀分区标题 | `--dsw-alias-label-primary` | 票 03 填 |
| `--xs-text-body` | 正文 | S2 命盘要点、S13 底稿正文、S10 diff 正文 | `--dsw-alias-label-primary` | 票 03 填 |
| `--xs-text-secondary` | 次要文字（说明句 / 卡副标题） | S5 谱卡描述、S8 账本行副文、S11 跳转说明 | `--dsw-alias-label-secondary` | 票 03 填 |
| `--xs-text-tertiary` | 三级文字（元信息 / 时间 / 字数） | S1 卡脚 info、S7 历史行时间、S10「字数变化」 | `--dsw-alias-label-tertiary` | 票 03 填 |
| `--xs-text-caption` | 极小注记 | S6 勾选计数、S8 预算计数、Tag 内文字 | `--dsw-alias-label-caption` | 票 03 填 |
| `--xs-text-link` | 可跳转文字（跨屏跳转） | S2「重新录制出生信息」、S13「要改就改源头」三跳、S11 跳转入口 | `--dsw-alias-brand-primary` | 票 03 填 |
| `--xs-text-code` | 等宽（谱 slug / 路径 / 文件名） | S5 谱名 slug、S13 源文件路径、S15 `~/.dsh/xuanshu/` 展示 | **无直接别名 → 票 03 新给** | 票 03 填 |
| `--xs-text-on-accent` | 主按钮上的文字 | S3「下一步」、S10「更新到谱」、S4「去录出生信息」 | **无直接别名 → 票 03 新给**（主按钮为自研控件；形状参照 F4，见 [`DSH槽位映射.md`](DSH槽位映射.md) §5） | 票 03 填 |
| `--xs-text-disabled` | 禁用态文字 | S8 超预算行、S10 未勾选确认框、S6 无谱时的发送钮 | `--dsw-alias-label-caption` | 票 03 填 |

---

## 4. `edge`（描边与聚焦）

| token | 语义 | 用在哪 | 建议别名 | 取值 |
|---|---|---|---|---|
| `--xs-edge-card` | 卡的描边 | S1 四卡、S5 谱卡、S9 候选卡 | `--dsw-alias-border-l1` | 票 03 填 |
| `--xs-edge-card-strong` | 强调卡的描边（选中 / 焦点卡） | S9 已采用候选、S6 当前勾选汇总区 | `--dsw-alias-border-l2` | 票 03 填 |
| `--xs-edge-divider` | 区块分隔线（发丝） | S1 卡内分节、S8 账本行间、S13 底稿分节 | `--dsw-alias-border-l1` | 票 03 填 |
| `--xs-edge-locked` | 锁定行描边 | S6 底座 / 底稿锁定行（C5） | **无直接别名 → 票 03 新给** | 票 03 填 |
| `--xs-edge-readonly` | 只读区描边 | S2 抽屉顶部标记带、S13 顶栏（C1/C2） | **无直接别名 → 票 03 新给** | 票 03 填 |
| `--xs-edge-focus` | 焦点环 | 全部可聚焦控件 | `--dsw-focus-ring-color` / `--dsw-focus-ring-width` | 票 03 填 |

---

## 5. `space`（间距）

> 全部只表达**关系**，不带数值。票 03 / UI 阶段按 DSH 的间距阶梯落到具体数。

| token | 语义 | 用在哪 | 取值 |
|---|---|---|---|
| `--xs-space-page` | 面板内容与面板边缘的距离 | S1/S5/S6/S11/S13 面板外壳 | 票 03 填 |
| `--xs-space-section` | 大区块之间的垂直距离 | S1 四卡与页头、S5 列表与工具栏、S10 导出区与更新区 | 票 03 填 |
| `--xs-space-card-gap` | 卡片之间的栅格间隙 | S1 四卡 `栅格 2×2`、S9 候选卡横排、S14 任务卡列表 | 票 03 填 |
| `--xs-space-card-pad` | 卡内边距 | 全部卡片 | 票 03 填 |
| `--xs-space-row` | 列表行内的水平间距（图标↔文字↔右侧控件） | S5/S6/S11 列表行、S8 账本行、S15 侧栏行 | 票 03 填 |
| `--xs-space-stack-sm` | 紧邻文字行之间的垂直距离 | 卡标题↔副标题、Tag 行↔正文 | 票 03 填 |
| `--xs-space-stack-md` | 控件 / 段落之间的垂直距离 | 表单行之间、按钮行与内容之间 | 票 03 填 |
| `--xs-space-toolbar` | 一排控件之间的水平距离 | S5 工具栏、S10 底部按钮行、S6 勾选区操作行 | 票 03 填 |
| `--xs-space-overlay-inset` | 浮层与视口边缘的距离 | S2/S8 抽屉、S10 确认弹窗、S4 引导浮层 | 票 03 填 |
| `--xs-space-overlay-pad` | 浮层内的边距 | 同上 | 票 03 填 |

---

## 6. `radius`（圆角）

| token | 语义 | 用在哪 | 建议别名 | 取值 |
|---|---|---|---|---|
| `--xs-radius-card` | 卡片圆角 | S1 四卡、S5 谱卡、S9 候选卡、S11 藏卡、S14 任务卡 | `--dsw-radius-xl` | 票 03 填 |
| `--xs-radius-nested` | 卡内嵌套面圆角（比卡小一档） | S1 卡内区块、S10 预览区、S8 行内区 | `--dsw-radius-md` | 票 03 填 |
| `--xs-radius-control` | 控件圆角（按钮 / 输入 / 分段） | 全部 `Button` / `Input` / `SegmentedControl` / `SegmentedTabs` | `--dsw-radius-md` | 票 03 填 |
| `--xs-radius-chip` | 胶囊圆角 | `Tag` / `Pill`（谱级别、超预算、只读标记） | **票 03 按 `Tag`/`Pill` 既有几何对齐** | 票 03 填 |
| `--xs-radius-overlay` | 浮层圆角 | S2/S8 抽屉、S10 确认弹窗、`Modal` | `--dsw-radius-xl` | 票 03 填 |
| `--xs-radius-tile` | 图标 / 图形底板圆角 | S15 侧栏行图标底、S2 命盘主图形底、S1 卡头图标 | `--dsw-radius-md` | 票 03 填 |

---

## 7. `state`（状态）

> 状态名**只能**用 [`../README.md`](../README.md) §3.3 定死的那 7 个：`empty` / `loading` / `ready` / `error` / `running` / `done` / `stale`。不新造同义词。

| token | 语义 | 用在哪 | 建议别名 | 取值 |
|---|---|---|---|---|
| `--xs-state-empty-fg` | 空态前景（说明文字与图形） | S1/S4 空态、S5/S11/S13 空态、S6 无谱、S7 无历史 | `--dsw-alias-state-idle-primary` | 票 03 填 |
| `--xs-state-loading-fg` | 加载态前景（骨架 / 扫光 / 转圈） | S1 卡级骨架、S5/S11 列表骨架、S9 合参进行中 | `--dsw-alias-state-idle-primary` | 票 03 填 |
| `--xs-state-ready-fg` | 就绪态前景（正常内容 / 可操作提示） | 全部屏的默认内容态 | `--dsw-alias-label-primary` | 票 03 填 |
| `--xs-state-running-fg` | 运行态前景 | S9 合参进行中、S12 工作流执行中、S14 任务触发中 | `--dsw-alias-brand-primary` | 票 03 填 |
| `--xs-state-done-fg` | 完成态前景 | S9 全部候选返回、S10 已写入、S14 最近一次投递成功 | `--dsw-alias-state-success-primary` | 票 03 填 |
| `--xs-state-warning-fg` | 告警态前景（不是失败） | S8 已裁剪提示、S10 字数超阈值、S14 任务即将到期 | `--dsw-alias-state-warn-primary` | 票 03 填 |
| `--xs-state-error-fg` | 错误态前景 | 全部屏的错误态、S2 八字缺失、S3 出生信息非法 | `--dsw-alias-state-error-primary` | 票 03 填 |
| `--xs-state-stale-fg` | **陈旧态**前景（内容在场但已过期） | S1 日课卡跨日、S13 底稿与源头不一致、S5 谱在外部被改 | **无直接别名 → 票 03 新给**（可基于 `--dsw-alias-state-warn-primary` 派生） | 票 03 填 |
| `--xs-state-busy-track` | 进度 / 运行条的轨道 | S9 合参进度、S8 预算占用条、S14 任务周期示意 | `--dsw-alias-bg-layer-2` | 票 03 填 |

**与 DSH 已有控件的对应**（实现票用）：DSH 有一个现成的状态点控件，其五态 `done / warning / error / idle / ongoing` 与上面 7 个状态名的映射是 —— `done↔done`、`warning↔warning`、`error↔error`、`idle↔empty`、`ongoing↔loading|running`；`stale` 无对应，需自研。
⚠️ **这是形状参照，不是可 import 的依赖**（上游禁止 require primitives）：玄枢自研状态点时应**照它的形状与 `aria` 行为**对齐，只引用 `--xs-state-*` / `--dsw-alias-*` token。证据：`dsh-client-ui-primitives/lib/types/index.d.ts:5-6`、`dsh-client-ui-primitives/README.zh.md:54`；禁令 `dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:35`（详见 [`DSH槽位映射.md`](DSH槽位映射.md) §0 F4 / §5）。

---

## 8. `level`（谱级别）

### 8.1 语义来源（不新造级别）

`docs/pu-spec-v1.md` §4 定义了两档级别，**本族严格照抄，不扩档**：

| 级别 | 含义 | 参与方式 | 出处 |
|---|---|---|---|
| `base`（基础输入级） | 优先级高、关于「你」的既定事实 | 进底稿提炼源；问事默认候选勾选 | `docs/pu-spec-v1.md:49-51` |
| `optional`（可选输入级） | 某侧面（工作 / 3D 打印 / 软件开发…） | 底稿不采；问事时按需追加 | `docs/pu-spec-v1.md:52` |
| **底座（八字）** | **唯一必填项，默认加载、始终在场、不可关**，**属底座、非可选谱** | 始终在场 | `docs/pu-spec-v1.md:54`、`:67` |
| **底稿** | 与八字同级的**基础谱**，默认必加载；**纯派生** | 每次对话都在场 | `CONTEXT.md:38-39`；`docs/pu-spec-v1.md:67` |
| **藏** | **不是谱**；只有指针 + 签 + 跳转；**永不进 AI** | — | `CONTEXT.md:50-52` |
| **工作区 / 工作流** | **不是谱**；并列独立、不可互相转换 | 只能被「临时挂载」 | `CONTEXT.md:31`、`:66`、`:86-88` |

### 8.2 token

| token | 语义 | 用在哪 | 建议别名 | 取值 |
|---|---|---|---|---|
| `--xs-level-base-fg` | `level: base` 谱的标识文字 / 图标 | S5 谱列表行、S6 勾选列表行、S7 历史回看行 | `--dsw-alias-brand-primary` | 票 03 填 |
| `--xs-level-base-bg` | `level: base` 的标识底（Tag 底） | 同上 | **票 03 新给** | 票 03 填 |
| `--xs-level-optional-fg` | `level: optional` 谱的标识文字 / 图标 | 同上 | `--dsw-alias-label-tertiary` | 票 03 填 |
| `--xs-level-optional-bg` | `level: optional` 的标识底 | 同上 | **票 03 新给** | 票 03 填 |
| `--xs-level-baseplate-fg` | **底座（八字）** 的标识 —— 唯一「始终在场」者 | S1 命盘卡、S6 锁定行、S15 | **票 03 新给**（必须与 base/optional **可区分**，因为 C5 的「不可关」由它承载） | 票 03 填 |
| `--xs-level-baseplate-bg` | 底座标识底 | 同上 | **票 03 新给** | 票 03 填 |
| `--xs-level-digao-fg` | **底稿** 的标识（与八字同级、纯派生） | S1 底稿卡、S6 锁定行、S13 底稿面板顶栏 | **票 03 新给** | 票 03 填 |
| `--xs-level-digao-bg` | 底稿标识底 | 同上 | **票 03 新给** | 票 03 填 |
| `--xs-level-nonpu-fg` / `--xs-level-nonpu-bg` | **「不是谱」的实体**（藏 / 工作区 / 工作流）在「挂载」与「藏库」语境下的标识 —— 用同一对 token，靠**文字标签**区分具体是哪一个 | S8 挂载账本（工作区 / 工作流）、S11 藏卡、S12 工作流、S15 | **票 03 新给** | 票 03 填 |

> 行内同时列出两个 token 的（如 `-fg` / `-bg`）视为**一行**，票 03 成对填。

### 8.3 三条硬规矩

1. **底座与底稿的标识必须与 base/optional 可区分**（C5：`默认在场 · 不可关` 与可勾选谱在**视觉与语义上分组**）。证据：README §4 C5。
2. **`--xs-level-nonpu-*` 只能出现在「挂载」与「藏库」语境**，**绝不出现**在谱列表里（C6：谱列表**不出现**工作区 / 工作流条目；挂载抽屉**只列**工作区 / 工作流，且只用「挂载」措辞）。证据：README §4 C6。
3. **`level` 不能单独承担区分职责**（见 §0.4 第 4 条）：每个级别标识旁**必须**有文字（「基础」「可选」「底座 · 默认在场」「底稿 · 纯派生」「藏」「挂载」）。

---

## 9. `constraint`（约束：只读 / 锁定 / 不可见）

> 这一族**只服务 README §4 的 11 条硬约束**；每条 token 都必须能指回一个 `C<n>`。**DSH 侧没有对应语义，是票 03 新增值的主要来源。**

| token | 语义 | 用在哪（→ 约束号） | 建议别名 | 取值 |
|---|---|---|---|---|
| `--xs-constraint-readonly-fg` | 「只读」标记的文字 / 图标 | S2 抽屉顶部「只读 · 由出生信息与底座生成」→ **C1** | **票 03 新给** | 票 03 填 |
| `--xs-constraint-readonly-bg` | 「只读」标记的底 | 同上 | **票 03 新给** | 票 03 填 |
| `--xs-constraint-derived-fg` | 「纯派生」标记的文字 / 图标 | S13 顶栏「纯派生 · 不可手改」→ **C2** | **票 03 新给** | 票 03 填 |
| `--xs-constraint-derived-bg` | 「纯派生」标记的底 | 同上 | **票 03 新给** | 票 03 填 |
| `--xs-constraint-locked-fg` | 「锁定」行的文字 / 图标（无 checkbox 的行） | S6 勾选列表的「默认在场 · 不可关」两行 → **C5** | **票 03 新给** | 票 03 填 |
| `--xs-constraint-locked-bg` | 锁定行的底 | 同上 → **C5** | **票 03 新给** | 票 03 填 |
| `--xs-constraint-noai-fg` | 「AI 不可见」常驻声明的文字 | S11 藏库顶部「藏永不进 AI：只登记指针、签与跳转，玄枢不读、不索引、不分析」→ **C3** | **票 03 新给** | 票 03 填 |
| `--xs-constraint-noai-bg` | 同上声明的底 | 同上 → **C3** | **票 03 新给** | 票 03 填 |
| `--xs-constraint-budget-over-fg` | 「超预算未纳入」Tag 的文字 | S8 挂载预览折叠区、S6 发送前预览 → **C7** | `--dsw-alias-state-warn-primary` | 票 03 填 |
| `--xs-constraint-budget-trimmed-fg` | 「已裁剪 N→M 字」Tag 的文字 | 同上 → **C7** | `--dsw-alias-label-secondary` | 票 03 填 |
| `--xs-constraint-budget-bar` | `挂载 N 字 / 预算 M 字` 状态栏的占用条 | S6 / S8 状态栏 → **C7** | **票 03 新给** | 票 03 填 |
| `--xs-constraint-human-gate-fg` | 「人工确认闸门」标记（人点过才可写） | S10 确认弹窗顶部、S6 沉淀入口、S9 采用/合并/否决按钮行、S12「跑没跑通由你判定」→ **C4 / C8 / C9 / C10** | **票 03 新给** | 票 03 填 |
| `--xs-constraint-human-gate-bg` | 同上标记的底 | 同上 | **票 03 新给** | 票 03 填 |

### 9.1 四条硬规矩

1. **`constraint` 族的 token 不得用于装饰**。每个出现处必须能在该屏第 9 节指回 `C<n>`。
2. **「AI 不可见」（`--xs-constraint-noai-*`）是负面事实** —— 它约束的是**界面上不存在的东西**（藏卡片上**无**摘要 / **无**问答 / **无**「让 AI 看看」）。用 token 表达时只能用于**那句常驻声明行**，不得用来给「AI 动作按钮」上色（那等于承认按钮存在）。→ C3。
3. **人工闸门的呈现必须是「人点的控件」而非提示文案**：`--xs-constraint-human-gate-*` 只用于**确认弹窗与按钮行**的容器，不用于普通说明文字。→ C4 / C8 / C9。
4. **C10 的审批界面不由玄枢上色**：DSH 审批卡**原样复用**（`conversation.composer` chain 的 composer 顶替，见 [`DSH槽位映射.md`](DSH槽位映射.md) §6.6），**不提供**玄枢自制的「总是允许」开关。`constraint` 族**不定义**审批卡内部 token。→ C10。

---

## 10. `size`（尺寸）

> 全部是**语义尺寸**，与 [`../README.md`](../README.md) §3.1 一致（线框里写「卡高≈2行」「栅格 2×2」「maxHeight≈10行」，本族给这些语义一个名字）。

| token | 语义 | 用在哪 | 取值 |
|---|---|---|---|
| `--xs-size-breakpoint-wide` | 宽 / 窄屏分界（语义已由 README §3.1 定为「宽 ≥1100 / 窄 <1100」，本 token 只承载这个名字，**取值不在此重复**） | 全部屏的响应式两态 | 见 README §3.1（票 03 不填） |
| `--xs-size-panel-content-max` | 面板内容最大宽度（宽屏下的阅读宽度上限） | S1/S5/S6/S11/S13 面板内容列 | 票 03 填 |
| `--xs-size-card-minheight` | 卡的最小高度（语义「≈ 2 行 + 卡头」） | S1 四卡、S5 谱卡、S9 候选卡 | 票 03 填 |
| `--xs-size-scrollregion-max` | 正文内滚区最大高度（语义「≈ 10 行（内滚）」） | S2 命盘要点、S7 历史列表、S8 账本明细、S13 底稿正文 | 票 03 填 |
| `--xs-size-drawer-width` | 抽屉宽度（宽屏） | S2 命盘卡详情、S8 挂载账本 | 票 03 填 |
| `--xs-size-drawer-maxheight` | 抽屉最大高度（窄屏时） | 同上（窄屏态） | 票 03 填 |
| `--xs-size-modal-width` | 确认弹窗宽度 | S10 沉淀确认、S9 否决理由、S15「整体拷走」说明 | 票 03 填 |
| `--xs-size-icon-sidebar` | 侧栏行的图标边长 | S15 侧栏行（`sidebar.panellist` 的 `size` owner prop） | 票 03 填 |
| `--xs-size-icon-inline` | 行内图标边长（Tag 前 / 行首） | S5/S6/S11 列表行、S8 账本行 | 票 03 填 |
| `--xs-size-glyph-brand` | 品牌主图形边长 | S1 页头、`conversation.hero.brand.mark`（若用） | 票 03 填 |
| `--xs-size-control-height` | 控件高度语义（按钮 / 输入 / 分段） | 全部 | 票 03 填 |
| `--xs-size-chip-height` | 胶囊高度语义（Tag / Pill 落在文本行上） | 谱级别 Tag、超预算 Tag、只读标记 | 票 03 填 |

---

## 11. `motion`（附属族，最小集）

| token | 语义 | 用在哪 | 取值 |
|---|---|---|---|
| `--xs-motion-duration-fast` | 快动效时长语义（悬停 / 状态切换） | 列表行悬停、Tag 切换 | 票 03 填 |
| `--xs-motion-duration-overlay` | 浮层进出时长语义 | S2/S8 抽屉、S10 弹窗 | 票 03 填 |
| `--xs-motion-ease-standard` | 标准缓动 | 全部 | 票 03 填 |

> **前提**：DSH 主题会遵循「减少动态效果」偏好（`dsh-client-ui-primitives/README.zh.md:57-58`）。玄枢自研的骨架扫光与抽屉动画**必须**同样尊重该偏好（`TextShimmer` 的做法：「减少动态效果模式保留静态底色」，`dsh-client-ui-primitives/README.zh.md:57`）。

---

## 12. 逐屏 token 使用索引（S1–S15）

> 每屏第 9 节（硬约束在 UI 上的呈现）**按本表勾选 token**；未列出的族 = 该屏不涉及。

| 屏 | `level` | `constraint` | 追加 `state` | 追加 `surface` | 追加 `size` |
|---|---|---|---|---|---|
| S1 自我总览 | `baseplate`（命盘卡）、`digao`（底稿卡） | `readonly`(C1)、`derived`(C2)、`noai`○(C3) | `loading`（卡级骨架）、`stale`（日课跨日） | `card` / `card-nested` / `skeleton` / `empty` | `card-minheight`、`glyph-brand`、`breakpoint-wide` |
| S2 命盘卡详情 | `baseplate` | `readonly`(C1) | — | `overlay` / `overlay-mask` / `readonly` | `drawer-width`、`drawer-maxheight`、`scrollregion-max` |
| S3 八字向导 | `baseplate` | `human-gate`(C10) | `error`（出生信息非法） | `card` / `overlay` | `modal-width`（二次确认） |
| S4 首次空态 | `baseplate`、`digao` | `readonly`(C1)、`derived`(C2) | `empty` | `empty` / `card` | `card-minheight` |
| S5 谱管理 | `base` / `optional` / `baseplate` / `digao` | `derived`○(C2)、`noai`○(C3)、`human-gate`○(C4)、`locked`○(C5)、`human-gate`○(C10) | `empty` / `loading` / `stale` | `card` / `interactive-hover` / `selected` | `card-minheight`、`panel-content-max` |
| S6 问事面板 | `base` / `optional` / `baseplate` / `digao` / `nonpu`○ | `derived`(C2)、`human-gate`○(C4)、`locked`(C5)、`budget-over` / `budget-trimmed` / `budget-bar`○(C7)、`human-gate`○(C9)、`human-gate`(C10) | `empty`（无谱）、`error` | `locked` / `selected` / `card-nested` | `scrollregion-max`、`chip-height` |
| S7 历史回看 | `base` / `optional` | `human-gate`○(C4) | `empty` / `stale` | `readonly` | `scrollregion-max` |
| S8 挂载账本 | `nonpu` | `budget-over` / `budget-trimmed` / `budget-bar`(C7) | `warning`（已裁剪） | `overlay` / `overlay-mask` / `card-nested` | `drawer-width`、`scrollregion-max` |
| S9 多 AI 合参 | — | `human-gate`(C9)、`human-gate`○(C10)、`budget-*`○(C7) | `running` / `done` / `error` | `card` / `card-nested` | `card-minheight` |
| S10 沉淀确认 | `base` / `optional`（目标谱） | `human-gate`(C4)、`human-gate`(C10) | `warning`（字数超阈）、`done`（已写入） | `overlay` / `overlay-mask` / `card-nested` | `modal-width` |
| S11 藏库 | `nonpu` | `noai`(C3)、`human-gate`○(C11 的「整体拷走」说明) | `empty` / `loading` | `card` / `interactive-hover` | `panel-content-max` |
| S12 工作流向导 | `nonpu` | `human-gate`(C8)、`human-gate`○(C10)、`human-gate`○(C11) | `running` / `done` | `card` | `panel-content-max` |
| S13 底稿面板 | `digao` | `derived`(C2)、`human-gate`○(C11) | `empty` / `stale` | `readonly` / `panel` | `scrollregion-max`、`panel-content-max` |
| S14 日课 / 定时任务 | `baseplate`（日课属底座 + 时间基准） | `human-gate`○(C10) | `running` / `done` / `error`（投递失败） | `card` | `card-minheight` |
| S15 管理入口落位 | `nonpu`○ | `noai`○(C3) | — | `sidebar` | `icon-sidebar`、`breakpoint-wide` |

`○` = README §5 矩阵里该屏为 `○`（若涉及则写）的对应条目。

**两条不由 `constraint` 族承载的约束**（写稿人别找错族）：

- **C6（谱与工作区/工作流并列独立）** 由 `level` 族的 `nonpu` 承载 + `text` 的文字标签（「挂载」措辞）；`constraint` 族不参与。
- **C11（一切数据本地、可整体拷走）** 由 `text-code`（路径展示）、`surface-panel`、`size-panel-content-max` 承载；`constraint` 族只在「整体拷走」的确认说明处用 `human-gate`。

---

## 13. 交给票 03 的填值清单与顺序

### 13.1 硬要求（照 DSH 的既有约束）

1. **每个 token 必须同时给 light 与 dark 两个模式的值**。DSH 的覆盖层契约原文：`ThemeTokenOverrides` 的值是 `{ light, dark }`，**两个模式都必填**（「an override never goes illegible when the user switches to the other scheme」）。证据：`dsh-client-ui-theme/lib/types/client/index.d.ts:29-41`；alias 目录逐条 `requiresLightAndDark: true`：`dsh-client-ui-theme/lib/client.js:1234-1333`。
2. **填值入口是 `ctx.theme`**：`ctx.theme.overrideTokens(<source>, tokens)` 按 source 叠加（后叠者按 token 胜出，同 source 再调即整层替换），或 `ctx.theme.register({ id, colorScheme, tokens })` 注册一个具名主题。证据：`dsh-client-ui-theme/lib/types/client/index.d.ts:153-178`、`:42-53`。
3. **不要动 DSH 的尺度层**：`--dsw-static-*` 是主题的静态尺度表（`dsh-client-ui-theme/lib/client.js:1148`），玄枢不覆写；只在 alias 层之上做别名。README.zh.md 的原则原文：token 样式表是颜色值的唯一权威来源，新增值须「以一个静态尺度层级与一个语义别名的形式」进入（`dsh-client-ui-theme/README.zh.md:126`）。
4. **不要重定义已有 alias 的语义**：若 `--xs-*` 指向 `--dsw-alias-*`，该 alias 的含义由 DSH 拥有；玄枢只在 `constraint` / `level` 两族新造值。
5. **本字典之外不得出现字面颜色**。上游规则：样式只走主题 token，**字面颜色仅限插画**（artwork）。证据：`dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:34`。
6. **管理列表（谱 / 藏 / 底稿 / 定时任务）的间距、字号、行模式照 DSH 的 Plugin Manager 页**（上游点名的同类型官方参照）：`practices.md:34`。票 03 定这一族的 `--xs-space-*` / `--xs-size-*` 时应以该页为基准，而不是自创节奏。

### 13.2 建议的填值顺序（按「被多少屏用到」排）

1. **`state`（7 态）** —— 15 屏全部依赖，且 `empty/loading/error` 是验收硬要求（README §3.4）。缺它整稿不可评。
2. **`surface` + `edge` + `radius`** —— 全部屏的容器层；多数可直接别名到 DSH alias，票 03 只需确认映射成立。
3. **`text` + `size`** —— 内容层；`text-code` 与 `text-on-accent` 需要新值。
4. **`constraint`（13 条）** —— **玄枢特有，无 DSH 对应**，是验证项 3「硬约束在 UI 上看得见」的物理承载。缺它则该验收项无法通过。
5. **`level`（9 条）** —— 玄枢特有；与 `constraint` 有交集（`baseplate` / `digao` / `nonpu`），建议同批设计以免语义撞色。
6. **`space` + `motion`** —— 收尾（`space` 多数落到 DSH 既有间距阶梯，`motion` 只 3 条）。

### 13.3 票 03 必须回问的两个问题（本稿无法答）

| 问题 | 为什么本稿无法答 |
|---|---|
| primitives 各组件**完整**消费的 `--dsw-*` token 名单是什么？ | 本稿未逐文件读 `dsh-client-ui-primitives/lib/*.module.css` 全文。可用 `ctx.theme.exportInspectTokens()` 导出（`dsh-client-ui-theme/lib/types/client/index.d.ts:132-136`），或补读 CSS。**未确认**。 |
| `constraint` / `level` 两族是否要落成**独立的具名主题**（`ctx.theme.register`）还是**叠加覆盖层**（`overrideTokens`）？ | 取决于部署形态（玄枢是否要成为可选主题）。属票 03 + 产品决定；本稿只定义名字与语义。 |

---

## 14. 不定义的（明确交给别人）

| 不定义 | 归谁 |
|---|---|
| 具体色值 / 字号 / 字重 / 行高 / 阴影 / 模糊 / 动效时长 | **票 03**（本文件的「取值」列） |
| 像素级尺寸与栅格 | **UI 阶段**（README §1、§3.1） |
| 四卡的视觉精修 | 明确后置（README §6 末段） |
| 签（tags）的视觉呈现 | 明确后置（README §6 末段；`docs/pu-spec-v1.md:30` 亦标「预留字段，功能暂不启用」） |
| 语音输入的视觉 | v2，不在本稿（README §2 末段） |
| DSH 审批卡内部的视觉 | DSH 拥有，玄枢不复用其 token（见 §9.1 第 4 条，C10） |
| DSH 原样界面（工作区 / 项目 / 会话列表 / 设置 / skill 管理 / MCP 管理）的任何 token | **不改**（ADR-0002；README §2 末段） |
