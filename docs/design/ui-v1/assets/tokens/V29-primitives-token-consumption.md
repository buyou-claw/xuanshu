# V29 · DSH primitives 消费 `--dsw-*` token 名单（票 03 研究报告）

> **回答的问题**（字典 §13.3 第一问 / 待实测登记处 V29）：primitives 各组件**完整**消费的 `--dsw-*` token 名单是什么？——以此自查票 03 填值时 `--xs-*` 的别名目标**确实被宿主消费**，不是指向一个无人读的名字。
> **结论先行**：玄枢 38 条别名形态的 `--xs-*` 共指向 **21 个** `--dsw-*` 目标，其中 **18 个被 primitives 直接消费**（名单见 §2），**3 个未被 primitives 消费但属宿主主题样式表自带取值**（见 §3，风险判定：可保留）。
> 日期：2026-10-11 ｜ 状态：closed（实测闭环）

---

## 1. 取证方法（可复跑）

1. 扫描本机 DSH 实装 `dsh-client-ui-primitives/lib/**/*.module.css`（38 个文件），用正则 `var\((--dsw-[a-z0-9-]+)` 抽取全部 token 引用，按「token → 消费组件集合」归并。
   - 结果：**92 个**不同的 `--dsw-*` token 被消费（完整名单见 §4）。
   - 取证对象含 `exportInspectTokens` 之外的 token（如 `--dsw-font-markdown-*` / `--dsw-elevation-*` / `--dsw-static-*` 直引）——它们也被如实记录；`exportInspectTokens()`（`dsh-client-ui-theme/lib/types/client/index.d.ts:132-136`）只导出 14 条 inspect 目录，不是消费证据，故以 CSS 全文扫描为准。
2. 扫描 [`xs-tokens.json`](xs-tokens.json) 全部 93 条 `--xs-*`，抽出取值形态为 `var(--dsw-…)` 的 38 条（其余 55 条 = 29 条 `var(--xs-static-…)` + 26 条字面值，不依赖宿主消费）。
3. 双向对表：别名目标是否在消费名单内（§2）；未命中者逐条定性（§3）。

证据路径约定：`<包名>/<包内路径>`，包根 = 本机 DSH 实装（见 `docs/design/ui-v1/README.md` §9）。

## 2. 对账表：`--xs-*` 别名目标 → primitives 消费情况

| `--dsw-*` 别名目标 | 指向它的 `--xs-*` | 被 primitives 消费？ |
|---|---|---|
| `--dsw-alias-bg-base` | `--xs-surface-app`、`--xs-surface-panel` | ✔ CodeBlock, ImagePreview, MarkdownText, MenuSurface |
| `--dsw-alias-bg-layer-1` | `--xs-surface-card` | ✔ HoverCard, Input, JsonTree, SegmentedControl |
| `--dsw-alias-bg-layer-2` | `--xs-surface-card-nested`、`--xs-state-busy-track` | ✔ Modal, Pill |
| `--dsw-alias-border-l1` | `--xs-edge-card`、`--xs-edge-divider` | ✔ JsonBlock, MarkdownText, Menu |
| `--dsw-alias-border-l2` | `--xs-edge-card-strong` | ✔ MarkdownText, Menu, TerminalBlock, fields |
| `--dsw-alias-brand-primary` | `--xs-text-brand`、`--xs-text-link`、`--xs-state-running-fg`、`--xs-level-base-fg` | ✔ Checkbox, Switch |
| `--dsw-alias-interactive-bg-hover` | `--xs-surface-interactive-hover`、`--xs-surface-selected` | ✔ Button, CodeCard, JsonBlock, Menu, Modal, Pill, SegmentedControl |
| `--dsw-alias-label-caption` | `--xs-text-caption`、`--xs-text-disabled` | ✔ MarkdownText, Menu |
| `--dsw-alias-label-primary` | `--xs-text-title`、`--xs-text-heading`、`--xs-text-body`、`--xs-state-ready-fg` | ✔ Button, Checkbox, CodeBlock, CodeCard, HoverCard, ImageLightbox, Input, JsonBlock, JsonTree, MarkdownText, Menu, Modal, PathLabel, Pill, ReadBlock, RiskConfirmation, SearchBlock, SegmentedControl, SegmentedTabs, SettingsForm, Tag, TerminalBlock, WebBlock, fields（24 个，全库最高频） |
| `--dsw-alias-label-secondary` | `--xs-text-secondary`、`--xs-constraint-budget-trimmed-fg` | ✔ CodeCard, DiffBlock, DisclosureRow, JsonBlock, JsonTree, MarkdownText, Modal, Pill, ReadBlock, RiskConfirmation, SearchBlock, SegmentedControl, SegmentedTabs, Tag, TerminalBlock, WebBlock, fields |
| `--dsw-alias-label-tertiary` | `--xs-text-tertiary`、`--xs-level-optional-fg` | ✔ CodeBlock, CodeCard, DiffBlock, DisclosureRow, ImagePreview, Input, JsonTree, MarkdownText, Menu, MenuGroup, PathLabel, ReadBlock, SearchBlock, SettingsForm, ShortcutKeys, StateDot, Tag, TerminalBlock, WebBlock, fields |
| `--dsw-alias-state-business-primary` | `--xs-edge-focus`（回退链第二环） | ✔ Checkbox, CodeCard, ConnectionIndicator, HoverCard, ImageLightbox, Input, JsonTree, MarkdownText, RiskConfirmation, SegmentedControl, SettingsForm, Switch, Tag, fields, user-text |
| `--dsw-alias-state-error-primary` | `--xs-state-error-fg` | ✔ DiffBlock, JsonTree, Menu, RiskConfirmation, StateDot, Tag, TerminalBlock, fields |
| `--dsw-alias-state-idle-primary` | `--xs-state-empty-fg`、`--xs-state-loading-fg` | ✔ StateDot |
| `--dsw-alias-state-success-primary` | `--xs-state-done-fg` | ✔ ConnectionIndicator, DiffBlock, StateDot, Tag, Toast |
| `--dsw-alias-state-warn-primary` | `--xs-state-warning-fg`、`--xs-constraint-budget-over-fg` | ✔ ConnectionIndicator, StateDot, Tag |
| `--dsw-focus-ring-color` | `--xs-edge-focus`（回退链第一环） | ✔ Checkbox, CodeCard, ConnectionIndicator, HoverCard, ImageLightbox, JsonTree, MarkdownText, RiskConfirmation, SegmentedControl, SettingsForm, Switch, fields |
| `--dsw-radius-md` | `--xs-radius-nested`、`--xs-radius-control`、`--xs-radius-tile` | ✔ Button, Input, MarkdownText, Menu, MenuGroup, MenuSurface, SegmentedControl, SegmentedTabs, SettingsForm, fields |
| `--dsw-alias-bg-overlay` | `--xs-surface-overlay` | ✘ 未被 primitives 直接消费（见 §3-1） |
| `--dsw-specific-sidebar-fill` | `--xs-surface-sidebar` | ✘ 未被 primitives 直接消费（见 §3-2） |
| `--dsw-radius-xl` | `--xs-radius-card`、`--xs-radius-overlay` | ✘ 未被 primitives 直接消费（见 §3-3） |

附注：`--xs-edge-focus` 的完整取值是 `var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))`，照抄宿主 `focus.css` 的原生回退链（`dsh-client-ui-theme/lib/client.js:1151`）；`--dsw-focus-ring-width`（2px）也被 10 个组件消费，焦点环宽直接沿用宿主 token，不另起 `--xs-*`。

## 3. 三个未被 primitives 消费的目标：定性与裁决

1. **`--dsw-alias-bg-overlay`**：浮层底。primitives 的浮层类组件（Modal/HoverCard/Menu）实际用 `--dsw-elevation-*` 阴影 + `--dsw-menu-surface-fill` / layer 系列而非 bg-overlay；但该 token 在宿主主题样式表双模自带取值（`dsh-client-ui-theme/lib/client.js:1148`，light=bluish-150 / dark=bluish-700），且在 14 条 inspect 目录内（`requiresLightAndDark: true`）。玄枢抽屉/弹窗是**自研容器**（上游禁 require primitives），消费方是玄枢自己的样式。**裁决：保留映射。**
2. **`--dsw-specific-sidebar-fill`**：侧栏列底。侧栏不在 primitives 包内（属宿主 `dsh-client-ui-sidebar`），故 CSS 扫描天然扫不到；inspect 目录 14 条之一，双模取值自带。**裁决：保留映射**（字典本就注明「沿用 DSH，不改」）。
3. **`--dsw-radius-xl`**（20px）：primitives 用到的最大圆角是 `--dsw-radius-panel`（28px，Modal）与 `--dsw-radius-lg`（16px，CodeBlock/Menu 等），xl 空档。但 xl 在宿主 base.css 尺度表有字面值（`dsh-client-ui-theme/lib/client.js:1142`），且是字典 §6 的既定建议别名（卡圆角比 Modal 的 panel 小一档、比 lg 大一档）。**裁决：保留映射**；玄枢卡是自研容器，消费在玄枢侧。若 UI 阶段实测视觉与宿主卡类（CodeCard 用 lg）违和，可在 UI 阶段降一档改 `--dsw-radius-lg`，本票不替 UI 阶段决定。

另记录一条**反向发现**（不影响填值，供 skins 分工参考）：`--dsw-alias-bg-skeleton` 被宿主主题样式表定义（light `#0000000a` / dark `#ffffff14`）但 **primitives 无 Skeleton 组件消费它**（与字典「DSH 无 Skeleton 原语」一致）；玄枢骨架自研，`--xs-surface-skeleton` 取值与之同值对齐。

## 4. 附录：primitives 消费的全部 92 个 `--dsw-*` token（扫描原始结果）

> 归并自 38 个 `*.module.css`；「组件数」= 消费该 token 的组件个数。直引 `--dsw-static-*` 的仅 FileTypeIcon / Toast / Tooltip 三处（与玄枢无关，记录在案）。

| token | 组件数 | 组件 |
|---|---|---|
| `--dsw-alias-bg-base` | 4 | CodeBlock, ImagePreview, MarkdownText, MenuSurface |
| `--dsw-alias-bg-layer-1` | 4 | HoverCard, Input, JsonTree, SegmentedControl |
| `--dsw-alias-bg-layer-2` | 2 | Modal, Pill |
| `--dsw-alias-bg-layer-3` | 4 | SegmentedTabs, SettingsForm, Tag, fields |
| `--dsw-alias-bg-layer-4` | 1 | fields |
| `--dsw-alias-bg-mask-1` | 2 | ImageLightbox, Modal |
| `--dsw-alias-bg-module-platform` | 2 | SegmentedTabs, Tag |
| `--dsw-alias-border-l1` | 3 | JsonBlock, MarkdownText, Menu |
| `--dsw-alias-border-l2` | 4 | MarkdownText, Menu, TerminalBlock, fields |
| `--dsw-alias-border-l2-darkmode-thin` | 1 | ImageLightbox |
| `--dsw-alias-border-l3` | 4 | Button, MarkdownText, SegmentedTabs, Switch |
| `--dsw-alias-border-l4` | 3 | Input, Tag, fields |
| `--dsw-alias-brand-primary` | 2 | Checkbox, Switch |
| `--dsw-alias-button-ghost-active-border` | 1 | Pill |
| `--dsw-alias-button-ghost-active-fill` | 1 | Pill |
| `--dsw-alias-button-primary-fill` | 2 | Button, RiskConfirmation |
| `--dsw-alias-button-primary-hover` | 1 | Button |
| `--dsw-alias-button-tool-bar-fill` | 1 | Button |
| `--dsw-alias-button-tool-bar-hover` | 1 | Button |
| `--dsw-alias-code-diff-added` | 1 | DiffBlock |
| `--dsw-alias-code-diff-deleted` | 1 | DiffBlock |
| `--dsw-alias-interactive-bg-active` | 1 | Button |
| `--dsw-alias-interactive-bg-hover` | 7 | Button, CodeCard, JsonBlock, Menu, Modal, Pill, SegmentedControl |
| `--dsw-alias-interactive-bg-hover-danger` | 1 | Menu |
| `--dsw-alias-label-caption` | 2 | MarkdownText, Menu |
| `--dsw-alias-label-dimmed` | 1 | Input |
| `--dsw-alias-label-error` | 1 | SettingsForm |
| `--dsw-alias-label-primary` | 24 | Button, Checkbox, CodeBlock, CodeCard, HoverCard, ImageLightbox, Input, JsonBlock, JsonTree, MarkdownText, Menu, Modal, PathLabel, Pill, ReadBlock, RiskConfirmation, SearchBlock, SegmentedControl, SegmentedTabs, SettingsForm, Tag, TerminalBlock, WebBlock, fields |
| `--dsw-alias-label-primary-foreground` | 3 | Button, StateDot, Switch |
| `--dsw-alias-label-secondary` | 17 | CodeCard, DiffBlock, DisclosureRow, JsonBlock, JsonTree, MarkdownText, Modal, Pill, ReadBlock, RiskConfirmation, SearchBlock, SegmentedControl, SegmentedTabs, Tag, TerminalBlock, WebBlock, fields |
| `--dsw-alias-label-shimmer` | 1 | TextShimmer |
| `--dsw-alias-label-tertiary` | 21 | CodeBlock, CodeCard, DiffBlock, DisclosureRow, ImagePreview, Input, JsonTree, MarkdownText, Menu, MenuGroup, PathLabel, ReadBlock, SearchBlock, SettingsForm, ShortcutKeys, StateDot, Tag, TerminalBlock, WebBlock, fields |
| `--dsw-alias-link` | 2 | MarkdownText, WebBlock |
| `--dsw-alias-markdown-code-block` | 6 | CodeBlock, CodeCard, JsonBlock, SearchBlock, TerminalBlock, WebBlock |
| `--dsw-alias-markdown-code-block-banner` | 2 | CodeBlock, SearchBlock |
| `--dsw-alias-markdown-inline-code` | 1 | MarkdownText |
| `--dsw-alias-menu-group-header-fill` | 1 | MenuGroup |
| `--dsw-alias-menu-icon` | 1 | Menu |
| `--dsw-alias-scrollbar-bg-l2` | 2 | HoverCard, Menu |
| `--dsw-alias-scrollbar-hover-l2` | 2 | HoverCard, Menu |
| `--dsw-alias-state-business-primary` | 15 | Checkbox, CodeCard, ConnectionIndicator, HoverCard, ImageLightbox, Input, JsonTree, MarkdownText, RiskConfirmation, SegmentedControl, SettingsForm, Switch, Tag, fields, user-text |
| `--dsw-alias-state-error-primary` | 8 | DiffBlock, JsonTree, Menu, RiskConfirmation, StateDot, Tag, TerminalBlock, fields |
| `--dsw-alias-state-idle-primary` | 1 | StateDot |
| `--dsw-alias-state-success-primary` | 5 | ConnectionIndicator, DiffBlock, StateDot, Tag, Toast |
| `--dsw-alias-state-success-tertiary` | 1 | ConnectionIndicator |
| `--dsw-alias-state-warn-label` | 2 | ConnectionIndicator, Toast |
| `--dsw-alias-state-warn-primary` | 3 | ConnectionIndicator, StateDot, Tag |
| `--dsw-alias-state-warn-tertiary` | 1 | ConnectionIndicator |
| `--dsw-alias-switch-thumb` | 1 | Switch |
| `--dsw-alias-toast-bg` | 1 | Toast |
| `--dsw-alias-toast-label` | 1 | Toast |
| `--dsw-alias-tooltip-bg` | 1 | Tooltip |
| `--dsw-alias-tooltip-key-bg` | 1 | ShortcutKeys |
| `--dsw-elevation-panel` | 1 | HoverCard |
| `--dsw-elevation-prominent` | 3 | ImageLightbox, Menu, Modal |
| `--dsw-elevation-soft` | 1 | SegmentedControl |
| `--dsw-focus-ring-color` | 12 | Checkbox, CodeCard, ConnectionIndicator, HoverCard, ImageLightbox, JsonTree, MarkdownText, RiskConfirmation, SegmentedControl, SettingsForm, Switch, fields |
| `--dsw-focus-ring-width` | 10 | Checkbox, ConnectionIndicator, HoverCard, ImageLightbox, MarkdownText, RiskConfirmation, SegmentedControl, SettingsForm, Switch, fields |
| `--dsw-font-family` | 2 | CodeBlock, CodeCard |
| `--dsw-font-markdown-base` | 1 | MarkdownText |
| `--dsw-font-markdown-base-strong` | 1 | MarkdownText |
| `--dsw-font-markdown-code` | 1 | MarkdownText |
| `--dsw-font-markdown-code-block` | 5 | CodeBlock, CodeCard, DiffBlock, SearchBlock, TerminalBlock |
| `--dsw-font-markdown-code-font-family` | 1 | user-text |
| `--dsw-font-markdown-h1` | 1 | MarkdownText |
| `--dsw-font-markdown-h2` | 1 | MarkdownText |
| `--dsw-font-markdown-h3` | 1 | MarkdownText |
| `--dsw-font-markdown-h4` | 1 | MarkdownText |
| `--dsw-font-markdown-table` | 1 | MarkdownText |
| `--dsw-font-markdown-table-head` | 1 | MarkdownText |
| `--dsw-font-xs-13` | 3 | SearchBlock, TerminalBlock, WebBlock |
| `--dsw-hovercard-bg` | 1 | HoverCard |
| `--dsw-mask-blur` | 2 | ImageLightbox, Modal |
| `--dsw-menu-backdrop-filter` | 2 | HoverCard, MenuSurface |
| `--dsw-menu-surface-fill` | 1 | MenuSurface |
| `--dsw-radius-lg` | 11 | CodeBlock, CodeCard, HoverCard, ImageLightbox, JsonBlock, MenuSurface, SearchBlock, SegmentedTabs, TerminalBlock, Toast, WebBlock |
| `--dsw-radius-md` | 10 | Button, Input, MarkdownText, Menu, MenuGroup, MenuSurface, SegmentedControl, SegmentedTabs, SettingsForm, fields |
| `--dsw-radius-panel` | 1 | Modal |
| `--dsw-radius-sm` | 12 | Button, CodeCard, ConnectionIndicator, ImagePreview, JsonBlock, MarkdownText, Menu, Modal, SegmentedControl, TerminalBlock, Tooltip, fields |
| `--dsw-radius-xs` | 2 | JsonTree, MarkdownText |
| `--dsw-shadow-lv3` | 2 | HoverCard, Toast |
| `--dsw-specific-input-major` | 1 | ImageLightbox |
| `--dsw-specific-menu` | 1 | HoverCard |
| `--dsw-static-amber-400` | 1 | FileTypeIcon |
| `--dsw-static-amber-500` | 1 | FileTypeIcon |
| `--dsw-static-deepseek-400` | 1 | Toast |
| `--dsw-static-deepseek-450` | 1 | FileTypeIcon |
| `--dsw-static-deepseek-500` | 1 | FileTypeIcon |
| `--dsw-static-green-500` | 1 | FileTypeIcon |
| `--dsw-static-neutral-bluish-00` | 1 | Tooltip |
| `--dsw-static-neutral-bluish-300` | 1 | FileTypeIcon |
| `--dsw-static-red-600` | 1 | FileTypeIcon |
