# Spec 001 · 48e0e0a 修复复核

日期：2026-10-16。结论：**本轮复核不通过**。本轮有 4 条有效发现：Standards 2 条（最高 P1），Spec 2 条（最高 P2）。上轮若干原始反例已经修复，不能据此关闭下面仍可复现的问题。工作流挂载另有 1 条已登记旧问题未关闭。

## 审查范围与方法

- 固定基线：`2cfcc051f43c8547efeeb380abd78fe9be18a02a`。
- 被审提交：`48e0e0ac728ef4ffba0c9e1bf23ad49a799f12ba`，分支 `codex/spec-001-integration`。
- 固定比较：`git diff 2cfcc051f43c8547efeeb380abd78fe9be18a02a...48e0e0ac728ef4ffba0c9e1bf23ad49a799f12ba`。
- 提交清单仅含 `48e0e0a docs+fix: 复核 5 条全修 + 三条上一轮遗留（安装器 copy / 日课生成链 / 底稿到点链）`；44 个文件，3165 行新增、865 行删除。
- 本轮审查该修复增量，并逐项回查上轮报告的 R1–R5 及 4 条遗留。两名独立审查者分别负责 Standards 和 Spec，主审复跑关键反例与真实 DSH Loop 探针。
- 依据：仓库 `AGENTS.md`、`docs/development-status.md`、Spec 001 对应设计稿 S8 / S9、ADR-0010 / ADR-0012。标准轴未报告仅凭代码气味作出的推断。
- 本次只新增本报告与忽略目录内的复核证据；未修改实现、测试或清单基线，未提交或推送。

## Standards

### N1 · [P1] 清单门仍漏掉与已知红并存的 hook 错误，以及未处理错误

位置：[inventory-gate.mjs:63](E:/ai_project/XuanShu/scripts/lib/inventory-gate.mjs:63)，以及第 118 行。

`collectReport()` 仅在一个文件没有任何失败断言时才登记 `suiteFailures`；`violationsFor()` 的兜底又要求整个报告没有失败条目。这会把同文件内与已知红并存的新 hook 错误一起放过。另一个独立问题是当前 Vitest JSON reporter 的 `success` 不反映未处理错误，仅依靠该字段也抓不全。

真实 Vitest 两种反例，主审均已独立复跑：

| 场景 | Vitest 原始结果 | 清单门结果 |
|---|---|---|
| 同文件一条已知失败断言，另一 `describe.beforeAll` 新抛错 | `exit=1`、`success=false`、`failedSuites=3`、1 条失败、1 条跳过，stderr 含新 hook 错误 | `suiteFailures=[]`、`violations=[]` |
| 断言通过，定时器抛未处理错误 | `exit=1`、`success=true`、0 条失败，stderr 含新未处理错误 | `suiteFailures=[]`、`violations=[]` |

违反 [development-status.md:411](E:/ai_project/XuanShu/docs/development-status.md:411)：“基线之外的红色一律是本轮引入的回归”。应独立收集 hook / suite / unhandled errors，再对断言失败逐条应用已知红名单；不能把一个已知断言失败当成整个文件或整个测试进程所有错误的解释。

证据：[probe-inventory.mjs](E:/ai_project/XuanShu/.scratch/review-48-standards/probe-inventory.mjs)，同目录 `mixed-report.json` / `unhandled-report.json` 及对应 stderr / stdout。

### N2 · [P1] `--force` 清理骨架时跟随 `packages` 根 junction 删除真实文件

位置：[install-profile.mjs:177](E:/ai_project/XuanShu/scripts/install-profile.mjs:177)，关键调用在第 181 行。

`removeOwnPackagesDir()` 先遍历传入路径，再交给 `removeTreeNoFollow()`；后者只对子项做 `lstat`，没有检查传入的根路径。当一个可丢弃 profile 骨架的 `packages` 本身是指向别处的 junction，且其内容只有自有包名时，`--force` 会沿 junction 递归删掉真实包内容。

全隔离探针使用自建的 `home/profiles/xuanshu`、自建的外部包目录和哨兵文件，执行 `--force --skip-install`：哨兵 `before=true → after=false`，安装器仍 `exit=0` 并将 profile 换为源目录联接。探针未接触现有 profile 或真实源包。

违反仓库 [AGENTS.md:20](E:/ai_project/XuanShu/AGENTS.md:20)、台账操作陷阱 3 的 junction 删除约束，也违反该新 helper 自身“不跟随联接”的约定。应先检查根路径；根为联接时只移除联接本身或拒绝操作，再决定是否遍历真实目录。

证据：[probe-install-junction.mjs](E:/ai_project/XuanShu/.scratch/review-48-standards/probe-install-junction.mjs)，探针所有路径均位于 `.scratch/review-48-standards/junction-case-*`。

## Spec

### N3 · [P2] 新增挂载在实际落日志前便被标记为已交付

位置：[boundary.mjs:120](E:/ai_project/XuanShu/packages/xuanshu-host/lib/consult/boundary.mjs:120)，第 122 行先更新 `mountsInjected`。

触发：会话已有材料，再新增挂载；该次发问在模型准备阶段失败，之后恢复模型配置再从原生会话发问。

边界先保存交付账，再返回注入消息。但真实 rc.2 Loop 在此后先执行 `prepareRequest()`，成功后才 append `user/message`。模型准备失败时，挂载没有进入日志，交付账却已前移，后续请求因此永久跳过它。真实 `pi-ai.prepareCall` 的 `INVALID_CONFIG` / `UNKNOWN_MODEL` 即可走到该失败路径；这不是 ADR-0012 所接受的极窄进程崩溃窗口。

真实 Loop 探针结果：首次失败后 `markedDelivered=[ws-probe]`、`mountInLog=false`；恢复模型后再问仍为 `mountInLog=false`，日志只有最初的材料注入。

违反 [S8:140](E:/ai_project/XuanShu/docs/design/ui-v1/screens/S8-临时挂载账本.md:140)：“发送消息 → 按已确认的裁剪结果注入”。应在消息确实 append 后提交交付账，或在下次边界与日志核对并恢复尚未提交的挂载。

### N4 · [P2] 改选或否决后的旧合参稿仍进入下一轮候选历史

位置：[history.mjs:99](E:/ai_project/XuanShu/packages/xuanshu-host/lib/consult/history.mjs:99)，第 100–104 行只过滤材料来源。

`buildCandidateHistory()` 把所有 `xuanshu-bestof-adopted` 日志都当成当前采用稿。但采用操作允许改选，真实会话日志又是追加式的：先采用 c1、再改选 c2 时，两份投递都留在日志中；否决该轮也不会从追加日志里删掉这些消息。新历史投影未结合该轮的最终决策过滤。

真实 API 与 Loop 探针结果：采用 c1 后改选 c2，下一轮候选 prompt 同时包含 c1、c2，且 c1 仍被标成“已采用的合参稿”；随后否决原轮，`adoptedId=null`，下一轮 prompt 仍同时包含两稿。

违反 [S9:174](E:/ai_project/XuanShu/docs/design/ui-v1/screens/S9-多AI合参面板.md:174)：“系统只取 adoptedId 对应的内容”“否决轮次不带任何候选正文”；ADR-0010 第 5 条同样要求历史只带当前采用稿。应结合旁挂决策的 `adoptedId` / `rejected` 与 `deliveries.messageId` 过滤，不可仅凭历史消息的来源标签判断。

N3 / N4 共用证据：[probe.mjs](E:/ai_project/XuanShu/.scratch/review-48-spec/probe.mjs)。探针使用钉版 rc.2 的真实 Context、SessionStore、AgentRegistry、AgentLoop 及本次提交的真实业务 API，仅对 LLM 输出和模型准备失败作桩；主审已独立复跑。

## 上轮问题逐项对照

| 上轮项 | 本轮状态 | 复核依据 |
|---|---|---|
| R1：hook / suite 失败假绿 | 部分修复，未关闭 | 单独 `beforeAll` 失败已能拦住；组合错误与未处理错误仍漏报，见 N1 |
| R2：空白创建、dispose 后原生首问缺上下文 | 原反例已修复 | 发问统一走 `agent/pre-step`，按日志是否存在材料补齐；对应回归通过 |
| R3：未 resume 时确认挂载，原生续问不生效 | 原反例已修复 | 边界读取持久化挂载，在恢复后的发问时补投；对应回归通过 |
| R4：A 成功、B 读取失败后整体记账 | 原反例已修复 | 改为按层记录实际纳入结果，失败层保留重试资格；交付事务另有 N3 |
| R5：候选缺文本历史及此前采用稿 | 部分修复，未关闭 | 已加入历史，但改选 / 否决过滤不符合要求，见 N4 |
| 更早遗留：copy 安装漏运行时依赖 | 已修复 | 真实离网 copy 安装成功；目标 host 可导入，目标可解析 `tz-lookup` |
| 更早遗留：copy 安装丢锁文件 | 已修复 | 真实 `--offline --frozen-lockfile` 成功；目标锁与仅改写自有包路径后的源锁逐字一致 |
| 更早遗留：日课 / 底稿定时任务未接生成链 | 已修复生成链缺口 | 本次新链在真实 Loop 的 schedule 消息下生成日课文件与底稿文件，见下方验证 |
| 更早遗留：工作流挂载占位 | 未关闭，非本轮新回归 | `mounts/content.mjs:203` 仍返回空层，客户端无工作流选择来源；台账 §12 已明确登记待设计决定 |

## 验证与边界

`pnpm verify:all` 的本轮全量 Vitest 报告已完成，`.scratch/test-inventory-report.json` 时间为 `2026-10-16T13:31:41.042Z`。主审用相同 `collectReport()` / `violationsFor()` 对该报告重新核算：

```text
用例 1097 条（基线 1097）/ 文件 103 个 / 失败 2 条（已知红 2 条）
文件级失败 0 个 / 跳过 10 条 / violations=[]
```

两条已知红仍是 `S1 装配树（dsh --dump-config-schema）` 和 `CLI 退出码为 0（五条 seam 全绿）`。类型检查与客户端 `--check` 另外独立通过，产物为 386627 bytes。全量报告通过不否定 N1：全仓这次没有触发那两种故障，N1 来自独立真实 Vitest 反例。

默认隔离 profile 的已安装 host 仍是旧副本，缺少本次新增的 boundary / daily delivery 文件。因此默认 `pnpm verify:assembly` 的结果只能证明该旧安装的装配状态。主审另在本轮真实 copy 安装目录上补跑装配验证；该副本的 `index.js`、`boundary.mjs`、`history.mjs`、`inject.mjs`、`rikke/delivery.mjs`、`digao/generate.mjs` 与被审源码逐字节一致。

补跑命令：`pnpm verify:assembly --dsh-home .scratch/review-48-standards/real-copy-1792157518877`。退出 1：**S1 FAIL，S2 / S3 / S4 / S5 PASS**；S4 的 185 行基线全部命中，S2 两个自有插件均激活，S5 写出新装配报告 `ok=true`。S1 仍是已登记的 rc.2 schema carrier 问题，不计作本次新回归。

定向验证：

- 原统一边界探针经过真实 Loop 跑完首问、无变化续问、增加挂载、撤下挂载及新引擎重放：材料只补一次，新增挂载有正文和披露，撤下有声明，重放后材料仍在且没有重复注入。证据：`.scratch/review-a2-boundary-probe.mjs`；本轮生成的日志在 `tests/consult/.tmp/boundary-probe-2EPEgL`。
- 日课 / 底稿探针经过真实 Loop，向各自 daily 会话发送真实 `source.kind='schedule'` 消息。日课产物 `schema=xuanshu/rikke@1`、`manual=false`，含 `yi/ji/liuri` 三键，黄历调用 1 次；底稿 `digao.md` 与 `digao.json` 均落盘，空来源下按契约回落 `digest=skeleton`。证据：`.scratch/review-48-daily-probe.mjs`、`.scratch/review-48-daily-data-DRMnud`。
- copy 真实安装与 frozen lockfile 日志：`.scratch/review-48-standards/real-copy-install.log`、`real-copy-frozen.log`。生成链探针使用本次源码及钉版 rc.2 运行时，不依赖默认 profile 中的旧 host。

上述真实 Loop 探针使用 LLM 桩、黄历 fixture，不等同于联网模型、真实定时钟触发或 UI 端到端验收。本轮没有重跑干净无 profile 的全仓矩阵。

本轮 Standards 2 条发现（最高 P1：清单门假绿、联接目标文件删除）；Spec 2 条发现（最高 P2：挂载交付账提前提交、采用稿历史过滤错误）。另有 Spec 1 条已登记的工作流挂载旧问题未关闭。
