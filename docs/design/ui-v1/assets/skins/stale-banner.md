# stale 提示条皮肤（stale-banner）

> 台账：asset.S2-10 ｜ 类型：texture（组件皮肤）｜ 屏：S2《命盘卡详情》§6 stale 行
> 用途：stale 提示条（旧版本出盘）：「此盘由 horosa `<旧版本>` 生成，当前底座是 `<版本>`」+ `[重新出盘 ->]`；提示条皮肤 + 图标。
> 取值纪律：本规格只引用 token 名；一切取值以 `tokens/xs-tokens.css` 为权威，本文件不含字面值、不含代码。

## 结构拆解（对应 S2 §6 stale 行）

1. **提示条容器** —— 抽屉顶部常驻一条，在只读徽标之下、正文之上；不自动消失（S2 §6：常驻提示，不静默当作最新）。
2. **前置图标位** —— 陈旧语义图标一枚（行内前置档；icons 分工，与 asset.S8-5 stale 告警同族语义）。
3. **文案** —— 「此盘由 horosa `<旧版本>` 生成，当前底座是 `<版本>`」；版本号为等宽片段。
4. **动作位** —— `[重新出盘 ->]`（→ S3，必过二次确认弹窗，S2 §6 stale 行）。

## 逐部位 token 引用

| 部位 | token | 语义 |
|---|---|---|
| 提示条底 | `--xs-surface-card-nested` | 卡内嵌套面 |
| 左侧边条 | `--xs-state-stale-fg` | 陈旧态前景（边条式提示条的语义侧条） |
| 前置图标 | `--xs-state-stale-fg` | 陈旧态前景（内容在场但已过期） |
| 文案关键词（「此盘由 horosa … 生成」的版本片段） | `--xs-state-stale-fg` + `--xs-text-code` | 版本号等宽（`--xs-text-code`：谱 slug / 路径 / 文件名类片段） |
| 正文 | `--xs-text-body` | 正文 |
| 动作按钮 | 主按钮皮肤（skins/primary-button.md） | 陈旧态给的唯一写路径；文字 `--xs-text-on-accent` |
| 提示条圆角 | `--xs-radius-nested` | 卡内嵌套面圆角 |
| 提示条内边距 | `--xs-space-card-pad` | 卡内边距 |
| 图标↔文字↔动作间距 | `--xs-space-row` | 列表行内的水平间距 |

## 状态

| 状态 | 呈现 |
|---|---|
| `stale`（本皮肤主态） | 常驻展示直到快照被重出替换；**不静默当作最新**（S2 §6 stale 行） |
| 动作进行中 | 点 `[重新出盘]` → 二次确认弹窗（human-gate 容器，token 见 skins 外 S10-8 / 字典 §9）；本提示条保持展示 |
| 消解 | 重出盘后抽屉重读快照，提示条随 `loading → ready` 消失（S2 §5 第 5 步） |

## 尺寸语义

- 提示条在抽屉正文列内全宽；抽屉宽度语义 = `--xs-size-drawer-width` / `--xs-size-drawer-maxheight`（窄屏）。
- 前置图标边长：`--xs-size-icon-inline`（行内图标边长）。
- 高 ≈ 一行正文 + 上下内距；动作按钮不折入「⋯」（陈旧是主态提示，不是次要信息）。

## 备注

- 与 skins/horosa-banner.md（asset.S4-8）同族异义：同为「边条式提示条」结构，语义色一为 stale、一为 error，不得混用。
- S1 命盘卡的 stale 行内提示（「此盘由 horosa <旧版> 生成」+ `[重新出盘]`，S1 §6 stale 行）复用本皮肤的行内形态（容器降为卡内一行，无独立圆角底）。
