# Spec 001 · 4b3c2a3 修复复核

日期：2026-10-17。结论：**本轮复核不通过**。Standards 1 条 P1，Spec 3 条 P2。上轮 R1–R5 的原始反例均已转绿；清单门和挂载生命周期仍有未闭合路径，新增的合参写盘保护另有两条可复现回归。

## 审查范围与方法

- 基线：`32216d9207dac1523a89e024c801c9049653c0f8`。
- 被审提交：`4b3c2a37b9bfbd08a559fed21958ebf4e5cead75`，分支 `codex/spec-001-integration`。
- 固定比较：`git diff 32216d9207dac1523a89e024c801c9049653c0f8...4b3c2a37b9bfbd08a559fed21958ebf4e5cead75`。
- 提交清单仅含 `4b3c2a3 fix: 复核 32216d9 的 5 条发现（afterAll 假绿 / 采用稿按轮 / 旧记录迁移 / 挂载撤下重挂恢复）`；20 文件，1240 行新增、138 行删除。
- 本轮审修复增量与上轮 R1–R5。Standards / Spec 由独立审查上下文完成；主审复跑原反例、故障探针和状态交错探针，并运行完整验证。
- 依据：仓库 `AGENTS.md`、`docs/development-status.md`、Spec 001、S9、票 12、ADR-0010 / ADR-0012。没有仅凭气味推断的问题。
- 本次只新增本报告与忽略目录内的证据；未修改实现、正式测试或清单基线。

## Standards

### F1 · [P1] 空消息的 `afterAll` 错误仍被已知失败掩盖

位置：[inventory-gate.mjs:85](E:/ai_project/XuanShu/scripts/lib/inventory-gate.mjs:85)，第 86 行的判据。

新增第三类证据依赖文件级 `result.message` 非空。但当前钉版 Vitest 对 `afterAll(() => { throw new Error() })` 产生的文件级 message 合法为空串。若同文件另有一条已知失败，没有 skipped，三个文件级条件全部不成立；退出码兜底也被已有失败挡住。

真实 runner 复现：`exit=1 / success=false / skipped=0 / suiteFailures=[] / unhandledErrors=false / violations=[]`。stderr 明确包含 `Failed Suites 1` 和该 hook 的完整堆栈。此反例发生在当前 Vitest 4.1.11，属于现有错误形状，并非台账接受的“换版本后 reporter 形状变化”。

违反 [development-status.md:575](E:/ai_project/XuanShu/docs/development-status.md:575)：“基线之外的红色一律是本轮引入的回归”。应独立采集 suite / hook 错误是否存在，不能用错误消息是否非空替代该判据。

证据：[probe.mjs](E:/ai_project/XuanShu/.scratch/review-4b-standards/probe.mjs)、同目录 `empty-message.fixture.mjs`、`empty-message-report.json`、`empty-message-stderr.txt`。主审已独立复跑。

## Spec

### F2 · [P2] 失败撤下后又失败重挂，会丢失旧正文仍需撤回的事实

位置：[inject.mjs:257](E:/ai_project/XuanShu/packages/xuanshu-host/lib/consult/inject.mjs:257)，新账在第 283 行替换旧账。

真实 rc.2 Loop 路径：成功挂载 A → 撤下那问模型准备失败 → 重挂 A 后模型准备再次失败 → 再撤下，并恢复正常问答。

重挂时，未落日志的新 `receipt` 覆盖了旧的已交付事实及尚未确认的撤下状态。再次撤下时，`!confirmed(entry)` 只检查这次失败的重挂投递，把条目当成“没有内容可撤”直接清掉。恢复正常后连续问两次，结果仍为：

```text
oldBodyInLog=true / updatedBodyInLog=false / withdrawalInLog=false
currentMounts=[] / currentLedger=[]
```

违反 [票 12:26](E:/ai_project/XuanShu/docs/tickets/12-mounts-budget-disclosure.md:26)：“撤下的层说一句‘已撤下、不再适用’”，以及 [第 35 行](E:/ai_project/XuanShu/docs/tickets/12-mounts-budget-disclosure.md:35)：“撤下声明在日志确认之前条目必须留着”。应保留此前已交付且未撤回的事实，直到撤下凭据真正进入日志；新投递失败不能抹去旧正文的撤回义务。

证据：[review-4b-spec-mount-lifecycle.mjs](E:/ai_project/XuanShu/.scratch/review-4b-spec-mount-lifecycle.mjs)。主审独立复跑现场：`.scratch/review-4b-spec-mount-data-sVuykv/results.json`、`events.json`；真实 Session、AgentLoop、consult API，仅 LLM 与 registry / FS 适配打桩。

### F3 · [P2] 第二轮的首次持久化被当成旧轮写入拒绝，受理后冷读找不到记录

位置：[bestof.mjs:479](E:/ai_project/XuanShu/packages/xuanshu-host/lib/consult/bestof.mjs:479)，第 483 行无条件更新 `currentRun`；拦截条件在第 233 行。

同一服务实例启动过第一轮后，`currentRun` 仍指向第一轮。第二轮首次 `persist(record)` 因 runId 不同直接返回 false；`bestof.run` 忽略该返回值，照样把第二轮认作当前轮并返回成功。

当第二轮候选流尚未产出首个文本块时，还没有后续回填能补上这次写。真实业务 API / 文件 store 探针得到：第二轮已有受理 runId，`diskStillFirstRun=true`；使用无内存记录的新 API 实例冷读第二轮，报“合参记录不存在”。这一路没有磁盘故障或多宿主共用数据目录，首 token 尚未返回即可触发。此时进程重启会丢失已经受理的轮次。

违反 [ADR-0010:17](E:/ai_project/XuanShu/docs/adr/0010-judge-without-structured-output.md:17) 的合参记录落旁挂文件约定，以及本轮“首次落盘成功之后才认下自己是当前轮”的写入约束。应将“受理新轮的首次写”与“禁止旧后台轮回写”分开，成功确认首次写后再改变当前轮。

### F4 · [P2] 采用投递与新轮交错时，投递成功但采用关系被静默丢弃

位置：[bestof.mjs:639](E:/ai_project/XuanShu/packages/xuanshu-host/lib/consult/bestof.mjs:639)，第 641 行忽略投递后 `persist()` 的 false 返回。

单进程中的可复现路径：第一轮先采用 c1；改采 c2 时，冷会话 `resume` 正在等待；期间启动并完成第二轮，再恢复第一轮的投递。

c2 进入会话，API 返回 `delivery.ok=true`，但新轮已继承 c1 的旧账；投递后补写被 `currentRun` 守卫跳过。之后候选历史仍带 c1、不带 c2。探针结果：

```text
deliveryOk=true / logHasNewChoice=true / ledgerHasDelivery=false
nextCandidateHasNewChoice=false / nextCandidateHasOldChoice=true
```

这与“调用开始时已经被新轮取代、直接拒绝旧轮”的路径不同：该采用请求通过了检查，决定也先成功落盘，取代发生在合法的异步投递等待期间。当前实现末尾的静默丢写会让真实采用结果与后续历史过滤依据永久分离。

违反 [S9:174](E:/ai_project/XuanShu/docs/design/ui-v1/screens/S9-多AI合参面板.md:174)：“系统只取 adoptedId 对应的内容”，以及 ADR-0010 第 5 条的当前采用稿语义。应协调新轮继承与未完成投递，或把该轮最终决策 / 投递关系合入当前持久账本，不能在投递成功后丢掉过滤依据。

F3 / F4 共用证据：[review-4b-bestof-persist-probe.mjs](E:/ai_project/XuanShu/.scratch/review-4b-bestof-persist-probe.mjs)、`.scratch/review-4b-persist-data-sOt6zu/results.json`。使用真实 bestof / consult API、真实文件 store，LLM 和 agents 是本仓测试适配；F3 只等待候选首块，F4 只在异步 resume 处设置有序等待，均不注入文件写入故障。规格轴已独立审阅源码与结果并确认两条成立。

## 上轮 R1–R5 对照

| 上轮项 | 本轮状态 | 复核依据 |
|---|---|---|
| R1：已知失败与 `afterAll` 新错误并存 | 原反例已修，类别未关闭 | `NEW_AFTER_ALL_ERROR` 现在产生文件级违规；空消息 hook 仍漏，见 F1 |
| R2：全会话只保留最后一稿 | 已关闭该反例 | 原真实 API / Loop 探针两轮有效采用稿均进入下一轮候选 |
| R3：同轮否决后重采仍被过滤 | 已关闭该反例 | `candidateHasReadopted=true`，当前采用消息 id 在保留集合中 |
| R4：旧记录第二次新轮又混入旧稿 | 已关闭该反例 | `secondHasObsolete=false / secondHasCurrent=true`，迁移的 legacy 条目持续继承 |
| R5：单次撤下失败 / 重挂失败不能恢复 | 原两组反例已修，生命周期仍未关闭 | `withdrawalInLog=true / updatedRemountInLog=true`；连续交错失败仍漏撤，见 F2 |

R2–R4 的顺序路径修复与 F4 的异步交错问题分别成立。F3 / F4 属于本轮新增写入守卫涉及的回归，不把原始反例重新标成未修复。

原探针本轮现场：`.scratch/review-322-spec/data-ncv3qv/prompts.json`、`.scratch/review-322-mount-data-BZ5t7C/results.json`。此前的 mixed / unhandled 清单门探针继续正确判红。

工作流挂载缺数据源仍为此前登记的旧问题；本轮未补齐，不计入这 4 条发现。

## 验证与边界

`pnpm verify:all` **退出 0**。类型检查通过，客户端源码与产物同步（386627 bytes）。本轮清单门原始输出：

```text
[inventory] 用例 1139 条（基线 1139）/ 文件 104 个 / 失败 2 条（已知红 2 条） / 文件级失败 0 个 / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败、没有文件级失败。
```

两条既有失败仍为 S1 装配树与由它连带的 CLI 全绿断言。原始报告位于 `.scratch/test-inventory-report.json`。本轮四条发现来自额外的故障和状态交错探针，当前正式用例通过并不覆盖这些反例。

`pnpm verify:assembly` 退出 1：**S1 FAIL，S2 / S3 / S4 / S5 PASS**。S4 的 185 行基线全部命中，两个自有插件激活，S5 写出新报告 `ok=true`。S1 仍为已登记的钉版 rc.2 schema carrier 问题，不计作新回归。

实际安装的 host 中 `index.js`、`boundary.mjs`、`history.mjs`、`inject.mjs`、`bestof-store.mjs`、`bestof.mjs` 与被审源码逐字节一致。原 Loop 探针及新增生命周期探针直接引用本次源码，运行时使用钉版 rc.2。

`git diff --check 32216d9...4b3c2a3` 通过。复核未修改实现、正式测试或 knownRed 基线。

以上探针不等同于联网模型或 UI 端到端验收；本轮未重跑干净无 profile 的全仓矩阵，也未把此前工作流数据源缺口标记为完成。

Standards：1 条，最高 P1（空消息 hook 错误假绿）；Spec：3 条，最高 P2（挂载漏撤、合参受理未写盘、采用投递后丢账）。另有 1 条已登记的工作流挂载旧问题未关闭。
