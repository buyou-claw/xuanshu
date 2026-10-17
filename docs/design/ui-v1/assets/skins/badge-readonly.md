# 只读 / 纯派生徽标皮肤（badge-readonly）

> 台账：asset.S1-11、asset.S2-5（同款，同文件）｜ 类型：texture（组件皮肤）｜ 屏：S1《自我总览》§3.1①③、S2《命盘卡详情》§3①；别名 asset.S4-9 同款复用
> 用途：只读 / 纯派生 两类标记（`XsReadonlyBadge`「只读 · 由出生信息与底座生成」、`XsPureDerivedBadge`「纯派生 · 不可手改」）；S2-5 只读标记徽标与 S1 `XsReadonlyBadge` 同款。
> 取值纪律：本规格只引用 token 名；一切取值以 `tokens/xs-tokens.css` 为权威，本文件不含字面值、不含代码。

## 结构拆解（对应 S1 §4 / S2 §4 组件树）

1. **胶囊底** —— DSH `Tag` 原语承载形状（S1 §4：`XsReadonlyBadge` 由 Tag 原语承载）；本皮肤只定 token，不重画形状。
2. **固定文案** —— 逐字固定、跨屏一致（S13 §9：跨屏一致性硬要求）：
   - 只读徽标：「只读 · 由出生信息与底座生成」（→ C1）；
   - 纯派生徽标：「纯派生 · 不可手改」（→ C2）。
3. **前置小标位（可选）** —— 文字同高的 glyph 位；配 `brand/badge-derived.svg`（asset.S13-2）这枚底版图形，文案与图形同族。

## 逐部位 token 引用

| 部位 | token | 语义 |
|---|---|---|
| 只读徽标 文字 / 图标 | `--xs-constraint-readonly-fg` | 「只读」标记的文字 / 图标（→ C1） |
| 只读徽标 底 | `--xs-constraint-readonly-bg` | 「只读」标记的底 |
| 纯派生徽标 文字 / 图标 | `--xs-constraint-derived-fg` | 「纯派生」标记的文字 / 图标（→ C2） |
| 纯派生徽标 底 | `--xs-constraint-derived-bg` | 「纯派生」标记的底 |
| 胶囊圆角 | `--xs-radius-chip` | 胶囊圆角 |
| 与卡头标题的间距 | `--xs-space-row` | 列表行内的水平间距（标题 ↔ 徽标） |

## 状态

| 状态 | 呈现 |
|---|---|
| 常态（唯一态） | 徽标是**只读标记，不是控件**：无 hover / active / 禁用等交互态，不可关闭（S13 §3①：吸顶、无关闭按钮） |
| `stale`（底稿卡陈旧） | 徽标本身不变色；陈旧另由一枚「陈旧 · 源头已更新」Tag 承载，其文字用 `--xs-state-stale-fg`（S1 §6 追加态 stale 行） |

## 尺寸语义

- 高度：`--xs-size-chip-height`（胶囊高度语义：Tag / Pill 落在文本行上）。
- 徽标与卡头标题同基线；窄屏不折行、不缩小字号，超出时标题让位折行（S13 §2C：标记不折叠）。

## 备注

- **硬规矩**：`constraint` 族 token 不得用于装饰，每个出现处必须能指回 C1 / C2（token 字典 §9.1 第 1 条）；徽标配色只走本表两对 token（S13 §8「配色只走 `--xs-constraint-derived-fg/-bg`」）。
- 配套图形底版：`brand/badge-derived.svg`（asset.S13-2，与 S1 / S4 同一枚）；底版内字面色只是占位，实现以本表 token 为准（assets README §3.3）。
- S2-5 与 S1-11 同款（台账原文「同款」）：同文件即本份；S4-9 为台账别名，同款复用不另产。
