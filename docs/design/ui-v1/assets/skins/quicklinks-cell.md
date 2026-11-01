# 快捷入口单元格皮肤（quicklinks-cell）

> 台账：asset.S1-12 ｜ 类型：texture（组件皮肤）｜ 屏：S1《自我总览》§3.1④、§6④；S4 同组件复用
> 用途：快捷入口三格（含主标题 + 副标题 + 边界说明行）。
> 取值纪律：本规格只引用 token 名；一切取值以 `tokens/xs-tokens.css` 为权威，本文件不含字面值、不含代码。

## 结构拆解（对应 S1 §4 `XsQuickLinks`）

1. **三格容器** —— 一行三等宽（问事 / 工作区 / 工作流）；窄屏仍一行三格，不折成两行（S1 §3.2④：三入口是并列关系，折行会被误读成层级）。
2. **单元格** —— 图标位 + 一行主标题（问事 / 工作区 / 工作流）+ 一行副标题（书房 / 车间 / 流水线；底座未立时问事格副标题改「底座未立 · 也能空手先问一句」）。
3. **边界说明行** —— 卡内右下角常驻一句「谱 / 藏 / 定时任务是管理入口，在侧栏『库』与设置里，不在本卡」（C6 ○）。
4. **置灰格** —— 入口目标不可用（main key 未注册）时该格 fail-soft 置灰 + Tooltip 说明原因，其余两格照常可用（S1 §6④ error 行）。

## 逐部位 token 引用

| 部位 | token | 语义 |
|---|---|---|
| 单元格底 | `--xs-surface-card-nested` | 卡内嵌套面（卡里的分区） |
| 单元格 hover 底 | `--xs-surface-interactive-hover` | 可交互行的悬停面 |
| 单元格圆角 | `--xs-radius-nested` | 卡内嵌套面圆角 |
| 图标 | 继承主标题色 | 图标为 currentColor，随主标题文字色继承，不单独设色 |
| 主标题 | `--xs-text-heading` | 区块小标题 |
| 副标题 | `--xs-text-secondary` | 次要文字（说明句 / 卡副标题） |
| 边界说明行 | `--xs-text-tertiary` | 三级文字（元信息级常驻句） |
| 置灰格 文字 / 图标 | `--xs-text-disabled` | 禁用态文字 |
| 焦点环 | `--xs-edge-focus` | 焦点环（键盘可达） |
| 格间水平间距 | `--xs-space-toolbar` | 一排控件之间的水平距离 |
| 格内边距 | `--xs-space-card-pad` | 卡内边距 |
| 主副标题行距 | `--xs-space-stack-sm` | 紧邻文字行之间的垂直距离 |
| 边界行与格间距 | `--xs-space-stack-md` | 控件 / 段落之间的垂直距离 |
| hover 过渡 | `--xs-motion-duration-fast` + `--xs-motion-ease-standard` | 快动效时长 + 标准缓动 |

## 状态

| 状态 | 呈现 |
|---|---|
| `ready`（常态） | 静态组件，随面板一同渲染；不设骨架、无 `loading` / `empty`（S1 §6④ 显式说明） |
| hover / 焦点 | 底换 `--xs-surface-interactive-hover` + `--xs-edge-focus` 焦点环 |
| `disabled`（fail-soft） | 单格置灰（`--xs-text-disabled`）+ Tooltip 说明原因；其余格不受影响 |
| 底座未立提示（S4 冷启动） | 问事格副标题换提示句，格仍可用、不置灰（S4 §3④） |

## 尺寸语义

- 卡最小高度：`--xs-size-card-minheight`（四卡同守）。
- 图标边长：图标族 24 档（icons 分工 asset.S1-5 的 `size_hint`），与主标题基线对齐；不引 `--xs-size-icon-inline`（那是行内 16 档语义）。
- 三格等宽；窄屏不折行（并列语义优先于可读宽度，S1 §3.2④）。

## 备注

- 配套图标：icons 分工 asset.S1-5（问事 / 工作区 / 工作流三枚，同视觉重量）。
- 边界说明行是 C6 的常驻呈现，不得做成 hover 才出现的提示（S1 §9 C6②）。
