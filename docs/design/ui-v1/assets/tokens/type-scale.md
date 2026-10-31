# 玄枢字体排版规格（票 03 · type-scale）

> **这是什么**：玄枢自有界面（S1–S15）的**字体排版取值**——字族栈 + 字号/字重/行高的**语义档位**，是票 03 验收项 1「字体排版规格」的交付物。
> **权威分工**：token 的**颜色侧**取值见 [`xs-tokens.json`](xs-tokens.json)（`--xs-text-*` 的「取值」列）；本文件填**字重/字号/行高的档位取值**。上游依据：`../shared/设计token字典.md` §3（「`text` token 同时约束颜色与字重/字号档位语义」）+ §14。
> **这不是什么**：不是像素级视觉精修（最终渲染细节、字距微调、多语言 fallback 调优留 UI 阶段）。
> 日期：2026-10-11 ｜ 状态：draft（票 03 交付物）

---

## 1. 字族栈（font-family）

沿用 DSH 主题的字体 token，玄枢**不自带字体文件、不覆写宿主字族**（ADR-0002：复用 DSH；上游规则：token 是唯一共享样式依赖）。

| 语义 | 字族 | 出处 | 用在 |
|---|---|---|---|
| 基础正文 / UI | `--dsw-font-family-base`（系统 UI 栈） | DSH 主题 | 全部界面文字 |
| 品牌名「玄枢」 | `--dsw-font-family-brand` | DSH 主题 | `--xs-text-brand`（S1 面板标题、`sidebar.brand.name`） |
| 等宽（slug / 路径 / 文件名） | `--dsw-font-family-mono`（等宽栈） | DSH 主题 | `--xs-text-code`（S5 slug、S13 源文件路径、S15 `~/.dsh/xuanshu/` 展示） |

> 若宿主未暴露 `--dsw-font-family-mono`，`--xs-text-code` 回落到系统等宽栈 `ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, monospace`，实现票在真机实测后回改本表（同「待实测登记处」纪律）。

## 2. 字号 / 字重 / 行高 语义档位（6 档，对齐 Plugin Manager 节奏）

> 基准：正文 **16px**（见 §5 的裁决）；间距阶梯 4 / 8 / 12 / 16 / 20 / 24（见 [`xs-tokens.css`](xs-tokens.css) `--xs-space-*`），管理列表行模式照 Plugin Manager 页（`dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:34`）。字号分「语义档」，实现票在组件里**点名档位 token，不写死 px**。

| 档位（对应 `--xs-text-*`） | 字号 | 字重 | 行高 | 用途（屏） |
|---|---|---|---|---|
| `brand` | 20px | 700 | 1.2 | 品牌名「玄枢」（S1 标题、侧栏品牌名） |
| `title` | 18px | 600 | 1.35 | 屏/卡主标题（S1 卡名、S5 谱名、S2 抽屉标题、S13 底稿标题） |
| `heading` | 16px | 600 | 1.4 | 区块小标题（S1 卡内分节、S10 分区标题）；与正文同号、靠字重分 |
| `body` | 16px | 400 | 1.6 | 正文（S2 命盘要点、S13 底稿正文、S10 diff 正文） |
| `secondary` | 14px | 400 | 1.5 | 次要文字（S5 谱卡描述、S8 账本副文、S11 跳转说明） |
| `tertiary` | 13px | 400 | 1.5 | 元信息（时间 / 字数 / 路径 / 计数） |
| `caption` | 12px | 400 | 1.4 | Tag 内文字、勾选计数这类最小标注 |
| `code` | 13px | 400 | 1.5 | 等宽（`--xs-text-code`；mono 字族） |
| `link` | 继承正文 | 400 + 下划线 | 继承 | 跨屏跳转文字（S2/S11/S13） |
| `on-accent` | 继承所在控件 | 500 | 继承 | 主按钮文字（S3「下一步」等，字号随 `--xs-size-control-height`） |
| `disabled` | 继承档位 | 400 | 继承 | 禁用态文字（颜色侧用 `--xs-text-disabled`） |

**字重阶梯**：`400`（正文）/ `500`（强调）/ `600`（标题）/ `700`（品牌）。**不引入** 300 / 800 等额外档，避免与宿主字重节拍不一致。

## 3. 与 `--xs-text-*` 的关系（实现票怎么接线）

- `--xs-text-*` 在 [`xs-tokens.json`](xs-tokens.json) 里只承载**颜色**（`var(--dsw-alias-…)` 或 `var(--xs-static-…)`）；本表的**字号/字重/行高**由实现票在组件层按档位落地（font-size / font-weight / line-height 直接取值，或映射到 DSH 语义字体 token）。
- 尺寸不分 light/dark（与 `--xs-space-*` / `--xs-size-*` 同理，双模同值）。
- 状态（`empty/loading/ready/error/running/done/stale`）的文字颜色走 `--xs-state-*`，字号/字重沿用本文档对应档位，**不新造状态专属字号**。

## 4. 验收自检

| 项 | 状态 |
|---|---|
| 字族栈三档（base / brand / mono）+ mono 回落 | ☑ |
| 6 档语义字号/字重/行高，对齐 Plugin Manager 节奏 | ☑ |
| 与 `--xs-text-*` 颜色侧分工明确、无字号重复定义 | ☑ |
| 不含像素级视觉精修、不含实现代码 | ☑ |

## 5. 正文下限的裁决与清偿（2026-10-31）

spec 003 §21 要求「正文 ≥16px」，而本表 `§2` 原先的 `body` 档写的是 **14px**——两边都是权威，
实测会把巡检判据 C-001 卡在自相矛盾上（判据量渲染值，实现照表落 14px，于是每条正文都红）。

**裁决：16px 是目标，14px 是原实现的取值。** 已按下面这条路径清偿：

- 本表 `§2` 改成新阶梯（`title` 18 / `heading` 16 / `body` 16 / `secondary` 14 /
  `tertiary` 13 / `caption` 12），`heading` 与 `body` 同号、**靠字重分**（600 vs 400），
  否则只抬 body 会让正文与标题同号、层级塌掉——那正是判据 L-001 要防的事；
- 实现侧：`style.ts` 的正文落到 `--dsh-content-font-size`（fallback 16）、次要落到
  `-secondary`（fallback 14）；`mounts` 的说明行从 12px 提到 16px，`note` 留 13px；
- **判据侧同步收紧**：C-001 只判正文，`role=meta`（tag / badge / 状态行 / 路径 / 计数）
  不参与 16px 下限——否则唯一的「通过」方式是把整屏调成同号。

**仍未清偿的部分（如实记账）**：宿主在容器上覆盖了 `--dsh-content-font-size`（实测取值 14px），
所以 `var(…, 16px)` 的 fallback 不生效，`panel:overview` 仍有 11/13 个正文级文字不足 16px。
下一手应当用 `max(16px, var(--dsh-content-font-size, 16px))` 把下限钉死（而不是靠 fallback），
或与 DSH 主题侧约定该 token 的下限。**在此之前 C-001 照现状判红，不许调低阈值转绿。**

依据：spec 003 §21 + WCAG AA 正文可读性 + 本轮定下的视觉方向 A（Apple 式克制留白，正文不吃小字）。
