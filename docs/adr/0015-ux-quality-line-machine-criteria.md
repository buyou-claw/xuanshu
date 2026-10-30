# 体验质量线：判据进机器，AI 只在判据内评判与修复

「UI 丑 + 交互逻辑不人性化 + 问题太多没法列举」不是一张 bug 清单，是**判据没有载体**。本仓库其实已经有设计权威：`docs/design/ui-v1/` 的 `shared/设计token字典.md`（`§0.1 三层模型`、11 个 token 族、`§0.4 禁则`）、`README.md §4 硬约束`、`§5 约束→屏矩阵`、`§6.2 四条防脏状态规格`、`assets/tokens/type-scale.md`（6 档字号）、`assets/manifest.../素材需求台账.json`（机读）。它们缺的只有执行：禁则靠「写稿人自查 / 评审人复查」，兑现率从未被测量（真机只开过两次，`docs/development-status.md` §16.9 / §16.10，均为手搓探针）。

**决定：把 ui-v1 的纪律编译成机读判据集，AI 只在判据内评判与修复；判据的权威在文档，执行在检查器，变更权在人。**

具体定值：

1. **单一权威链**：`docs/design/ui-v1` 是唯一设计权威；`docs/design/ui-v1/criteria/` 是它的**机读投影**，禁止出现 ui-v1 没有的新规则——新增判据必须先回改 ui-v1，按本仓既有纪律「**回改本稿，不就地偏离**」处理，冲突以 ui-v1 为准。判据与 ui-v1 之间不允许存在第二份设计语言文档。
2. **参考体系按四维分工，不跨维**：**Fluent 2** → 视觉语言与**密度档**（comfortable/compact，工具型界面最贴，自身是 token pipeline 出身）；**Material 3** → **量化阈值**（对比度、点击目标尺寸、动效时长与缓动，数值全部公开可机检）；**WAI-ARIA APG** → 焦点/键盘/语义（规范，不参与审美投票）；**`.upstream` 的 astrostudyui** → 同类气质校准。它们**只做两件事**：补 ui-v1 `§14 不定义的` 空缺，把定性表述数值化。不重造 token 族、不替换视觉语言。
3. **巡检分两半，职责不同**：**b1 静态半边**（Node、不启浏览器）覆盖全部 27 个 `.tsx` / 30 个界面面（token 消费、字面值逃逸、注入点重复、断点字面、状态覆盖、按钮密度、`aria`/`disabled` 标记）；**b2 浏览器半边**（系统 Edge + 全局 playwright）**只跑任务剧本**，不按屏跑——一条剧本横穿多个界面面。b2 的地基复用 `tests/isolation/lib/web-boot.mjs`（抓 CLI 的 `?token=` 行 + cookie 握手），不新写启动探针。
4. **巡检只读**：不改源码、不刷新基线、不写 `.dsh-home`（真实数据那份**只读**跑）；每次 b2 前必须 `pnpm build`——`packages/xuanshu-client/lib/client.js` 不重建，实例里跑的就是旧 UI。
5. **基线不是判据**：视觉回归基线只进报告，**不参与「通过/未通过」**。判据全部是绝对规则，所以「刷新基线」不构成自证及格通道。这是把「AI 自己改自己验」变成可信闭环的关键一条。
6. **判据冻结**：`criteria/freeze.json` 存判据集 sha256；巡检器启动先校验，不一致即**拒绝运行并报警**。AI 只能写 `criteria/proposals/`，生效判据由人改。
7. **签字点只有两处**：① 判据集 v1 冻结那一次；② 你本来就要批的改动 PR（自动附巡检报告 + 3 张关键截图）。日常巡检、报告生成、视觉回归对比**零签字**。
8. **与 `docs/specs/002-reside-and-use.md:177` 的边界**：该禁令约束的是「为 Electron 壳的窗口/托盘/自启新建自动化 seam——不做 GUI 自动化，不新增 playwright/e2e 通道」；UX 巡检是**浏览器内只读采集**，不承担功能回归断言职责，因此不违反 002。同 spec `:192` Out of Scope 的「视觉精修」指设计稿阶段的精修，不指判据核验；`docs/specs/001-assembly-foundation.md:89` 早已留「可选 playwright e2e（后置）」。**若要把巡检升级成 `verify:all` 的门，另立 ADR。**
9. **导航模型是新判据族（本 ADR 只登记，不裁决形态）**：玄枢有四套入口原语（`main` 面板 / `shell.overlay` 抽屉 / `composer.dock` / 命令名），但**没有统一的「一个动作一个入口、一个返回落点」规矩**——这是「跳转不人性化」的结构性来源。判据族 N 的首批采集目标是入口重复与返回落点不一致。

**Considered Options**：

- **让 AI 看截图自评「丑」并自改**——被否：不可复现，且会与 ui-v1 打架，产出**第三份权威**，正是当前病根（12 个样式注入点各写各的）。
- **另写一本新设计书**——被否：ui-v1 的语言层（token 族、type-scale、禁则）已经完整，再写一本等于制造第二套命名。
- **先重构到单一样式底座，再上判据**——被否：拿「没有判据的重构」去赌「有判据的未来」。改为判据先行、注入点按违规密度就地收敛（ADR 第 1 条纪律不变）。
- **巡检直接进 `verify:all` 当门**——被否：误报未清零就挡门，等于教人绕过。先只报告（`pnpm verify:ux`），门另立 ADR。
- **每次改动都要人签字**——被否（用户明确否）：签字成本一高，巡检就会被绕开，比没有巡检更糟。压缩到两处签字点，靠「判据冻结 + 基线不进判据」代替人工盯防。
- **用截图基线做「通过」判据**——被否：基线在 AI 手里可刷新，形成自证及格通道。

**Consequences**：

- 新增：`docs/design/ui-v1/criteria/`（判据投影 + `freeze.json` + `proposals/`）、`scripts/ux/`（检查器）、`scripts/verify-ux.mjs`（runner）、`pnpm verify:ux`（只报告）；报告落 `ux-reports/`（gitignore）。
- 首批判据的取材点已定：`§0.4 禁则`、`§4 硬约束`、`§6.2 四条防脏状态`、`assets/tokens/xs-tokens.json`（122 token，light/dark）、`type-scale.md`（6 档）。
- 可**立即计数**的三类违规（无需开浏览器）：12 个样式注入点（7 个 `*-style.ts` + 5 处就地 `<style>`）、`mounts.tsx` 9 处字面 hex（`WorkflowPanel.tsx` 另有 2 处）、断点只有字面 `1100px`（`style.ts:63`）；`--dsw-alias-*` 全仓仅 4 处消费。
- 覆盖面事实源是 `tests/assembly/lib/panel-surface.mjs:12`（`PANEL_KEYS`），不再另抄一份清单。
- 顺带修正：`scripts/isolation/startup.mjs:30-34` 关于 `--profile <p> web` 的注记与构造命令不符（构造命令无 `web` 位置参数）。
- 回滚：删 `criteria/`、`scripts/ux/`、`verify:ux` 脚本即可回到「只有 vitest 装配测试」的状态；巡检从不写源码与真实 home。
