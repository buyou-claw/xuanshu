# Spec 001 · 32216d9 修复复核

日期：2026-10-16。结论：**本轮复核不通过**。Standards 1 条 P1，Spec 4 条 P2。上轮几个原始反例已经修复，但清单门、挂载失败恢复与采用稿过滤尚有下列未闭合路径。

## 审查范围与方法

- 基线：`48e0e0ac728ef4ffba0c9e1bf23ad49a799f12ba`。
- 被审提交：`32216d9207dac1523a89e024c801c9049653c0f8`，分支 `codex/spec-001-integration`。
- 固定比较：`git diff 48e0e0ac728ef4ffba0c9e1bf23ad49a799f12ba...32216d9207dac1523a89e024c801c9049653c0f8`。
- 提交清单仅含 `32216d9 fix: 复核 48e0e0a 的 4 条发现（清单门两大类漏报 / --force 联接删除 / 挂载账与日志对账 / 采用稿历史过滤）`；27 文件，1155 行新增、130 行删除。
- 本轮复核修复增量及上轮 N1–N4。Standards / Spec 分别由独立审查上下文完成；主审独立复跑关键反例及真实 rc.2 Loop 探针。
- 成文依据：`AGENTS.md`、`docs/development-status.md`、Spec 001、S8 / S9、票 12、ADR-0010 / ADR-0012。标准轴没有另报仅凭气味推断的问题。
- 本次新增本报告及忽略目录内的证据；实现、测试与清单基线保持原样。

## Standards

### R1 · [P1] 已知失败与 `afterAll` 错误并存时，清单门仍会假绿

位置：[inventory-gate.mjs:77](E:/ai_project/XuanShu/scripts/lib/inventory-gate.mjs:77)。

本次判据只在“没有失败断言，或存在跳过用例”时登记文件级失败。`afterAll` 在断言全部执行后抛错，不产生 skipped；若同文件有一条已知失败，新 hook 错误便不进入 `suiteFailures`，退出码兜底也被已有失败断言阻断。

真实 `runSuiteReport()` 探针使用一条 allowlisted 的 `known red` 断言，以及 `afterAll(() => { throw new Error('NEW_AFTER_ALL_ERROR') })`：Vitest `exit=1 / success=false`，stderr 明确包含 `Failed Suites` 与新错误；清单门却得到：

```text
failures=1（已知红） / skipped=0 / suiteFailures=[]
unhandledErrors=false / violations=[]
```

违反 [development-status.md:451](E:/ai_project/XuanShu/docs/development-status.md:451)：“基线之外的红色一律是本轮引入的回归”。应独立收集 hook / suite 的错误证据，不能由跳过条数推定这类错误是否存在。

证据：[probe.mjs](E:/ai_project/XuanShu/.scratch/review-322-standards/probe.mjs)、同目录 `after-all.fixture.mjs`、`after-all-report.json`、`after-all-stderr.txt`。主审已独立复跑。

## Spec

### R2 · [P2] 后一轮采用后，前一轮仍有效的采用稿被历史过滤掉

位置：[bestof-store.mjs:66](E:/ai_project/XuanShu/packages/xuanshu-host/lib/consult/bestof-store.mjs:66)。

`currentAdoptedMessageIds()` 在全会话账本找到一条 adopted 就立即返回一个 id，因此整场会话最多保留一稿，而非保留各轮最终被采用的稿。

真实 API / Loop 验证：两个独立合参轮次分别采用 `DRAFT_9_UNIQUE`、`DRAFT_11_UNIQUE`；两轮均未否决，两份都已经进入会话日志。下一轮候选 prompt 却为 `promptHasFirstRun=false / promptHasSecondRun=true`。用户要求结合此前两次拍板时，候选丢失第一轮结论。

违反 [S9:77](E:/ai_project/XuanShu/docs/design/ui-v1/screens/S9-多AI合参面板.md:77)：“采用稿是这一轮在会话流里的正式输出”，以及 [S9:174](E:/ai_project/XuanShu/docs/design/ui-v1/screens/S9-多AI合参面板.md:174) 按每轮 `adoptedId` 取历史的要求。应按 `runId` 分组，保留各轮最终有效的采用消息集合。

### R3 · [P2] 同轮否决后重新采用，当前采用稿仍被排除

位置：[bestof-store.mjs:59](E:/ai_project/XuanShu/packages/xuanshu-host/lib/consult/bestof-store.mjs:59)，关键排除在第 65 行。

`rejectedRuns` 将账本里曾出现过 rejected 的 run 永久排除，没有考虑该轮之后的新采用决定。真实执行同一轮 `c1 → reject → c2`，接口返回 `adoptedId=c2 / rejected=false / delivery.ok=true`，日志也有 c2；过滤结果却是空集合，下一轮候选 `candidateHasReadopted=false`。

客户端否决后仍可操作采用，该路径也被真实业务 API 接受。违反 [S9:169](E:/ai_project/XuanShu/docs/design/ui-v1/screens/S9-多AI合参面板.md:169) 的采用语义，以及 [ADR-0010:18](E:/ai_project/XuanShu/docs/adr/0010-judge-without-structured-output.md:18)：“只放 adoptedId 指向的那一份”。应根据每轮最后决定判断，而非判断它是否曾经被否决。

### R4 · [P2] 旧记录未迁移，第二个新轮次会重新混入已改选稿

位置：[bestof.mjs:433](E:/ai_project/XuanShu/packages/xuanshu-host/lib/consult/bestof.mjs:433)。

现有 `xuanshu/bestof@1` 记录可以只有 `deliveries / adoptedId / rejected`，没有新字段 `draftLedger`。首次读取时 fallback 能正确过滤；但启动新 run 会用空数组覆盖可判定的旧决策。之后再次读取，新记录没有该旧轮的采用信息，过滤返回 `null`，所有旧采用日志又被放进候选历史。

用本次业务 API 构造 c1→c2 的合法记录，再去掉新增账本字段以模拟上一版本数据：升级后的首个新 run 为 `firstHasObsolete=false / firstHasCurrent=true`；第二个新 run 则为 `secondHasObsolete=true / secondHasCurrent=true`。本轮的新 run 尚未拍板，也没有覆盖旧轮决定的用户动作。

违反 [S9:174](E:/ai_project/XuanShu/docs/design/ui-v1/screens/S9-多AI合参面板.md:174)：“系统只取 adoptedId 对应的内容”。应在覆盖旧记录前迁移已有决策与投递信息，保留旧记录可判定的采用关系。

R2–R4 共用证据：[probe.mjs](E:/ai_project/XuanShu/.scratch/review-322-spec/probe.mjs)。主审独立复跑的候选输入保存在 `.scratch/review-322-spec/data-6B89GI/prompts.json`。其中跨轮场景另外采用两轮均未否决的账本，排除了 R3 对 R2 的干扰。

### R5 · [P2] 挂载撤下与重新挂上的失败恢复仍会永久漏投

位置：[inject.mjs:199](E:/ai_project/XuanShu/packages/xuanshu-host/lib/consult/inject.mjs:199)，日志判据在第 184–192 行，边界在 `boundary.mjs:140` 提前保存返回的交付账。

新增层首次准备失败后的重投已经改善，但当前对账只判断历史中是否曾出现某个正文标记，且在声明落日志前就删除撤下项，不能完整表示挂载状态变化的交付。真实 Loop 的两个独立反例：

1. 成功挂载 → 撤下 → 模型准备失败：交付账已清为 `[]`，撤下声明没有落日志；恢复模型再问也不补发，`withdrawalInLog=false`。旧挂载正文仍在历史中。
2. 成功挂载 → 成功撤下 → 修改工作区内容并重新挂上 → 模型准备失败：下一问把第一次挂载的旧 marker 当成此次重新挂载的交付证据，不再补投新版内容；`withdrawalInLog=true`，但恢复后仍 `updatedRemountInLog=false`。

两组的首次新增挂载失败恢复均为 `originalAddRecovered=true`，证明上轮的正向反例已修，而挂载生命周期中的同类失败尚未覆盖。

违反 [票 12:25](E:/ai_project/XuanShu/docs/tickets/12-mounts-budget-disclosure.md:25)：“新增的层补投它的正文 + 披露，撤下的层说一句‘已撤下、不再适用’”，以及 ADR-0012 的交付按日志核实要求。应以本次状态变化的交付回执对账；撤下声明确认前保留重试依据，重新挂载也不能复用旧一轮的正文 marker 充当回执。

证据：[review-322-mounts-probe.mjs](E:/ai_project/XuanShu/.scratch/review-322-mounts-probe.mjs)、`.scratch/review-322-mount-data-vXXPoe/results.json`。该探针经过真实 rc.2 Session / AgentLoop、真实 `consult.setMounts` 与本次边界，仅 LLM 和工作区注册服务打桩；两组使用不同的独立 Context 和数据目录。

## 上轮四项对照

| 上轮项 | 本轮状态 | 证据 |
|---|---|---|
| N1：已知失败与新 hook 并存 / 未处理错误 | 原两个反例已修，类别仍未关闭 | 真 runner 中 mixed 产生文件级违规；未处理错误独立识别；`afterAll` 仍漏报，见 R1 |
| N2：`--force` 沿 `packages` 根 junction 误删 | 已关闭 | 原隔离探针原样复跑，哨兵 `before=true / after=true`；安装器 exit 0，profile 正常替换成源联接 |
| N3：新增挂载模型准备失败后永久漏投 | 首次新增路径已修，生命周期恢复不完整 | 主审真实 Loop 验证首次新增可恢复；撤下 / 重挂仍漏，见 R5 |
| N4：改选或否决后的旧稿混入候选历史 | 新账本的原简单路径已修，过滤整体未关闭 | 新历史过滤已生效；仍有跨轮丢稿、否决后重采、旧数据升级问题，见 R2–R4 |

工作流挂载缺数据源仍为此前登记的未完成项；本轮的 hint 成块与去重改善没有补齐该数据源，不计作本次新增发现。

## 验证与边界

`pnpm verify:all` **退出 0**。类型检查通过，客户端源码与产物同步（386627 bytes）；本轮清单门原始输出：

```text
[inventory] 用例 1119 条（基线 1119）/ 文件 104 个 / 失败 2 条（已知红 2 条） / 文件级失败 0 个 / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败、没有文件级失败。
```

两条已知红为 S1 装配树与由它连带的 CLI 全绿断言。原始报告位于 `.scratch/test-inventory-report.json`。全量测试通过清单门不否定本报告：上述发现来自额外故障与状态转换探针，当前正式用例未覆盖这些反例。

`pnpm verify:assembly` 退出 1：**S1 FAIL，S2 / S3 / S4 / S5 PASS**；S4 的 185 行基线全部命中，两个自有插件激活，S5 写出新装配报告 `ok=true`。S1 仍是已登记的钉版 rc.2 schema carrier 问题，不计作本轮新回归。

默认隔离 profile 的 `index.js`、`boundary.mjs`、`history.mjs`、`inject.mjs`、`bestof-store.mjs`、`bestof.mjs` 与被审源码逐字节一致；本轮装配结果覆盖本次实现，没有沿用上一轮的旧 host 副本。

独立定向验证：

- 标准轴相关两个正式测试文件 `inventory-gate.test.mjs` / `install-profile-copy.test.mjs` 共 29 条通过；真实故障探针另证实 R1。
- 主审复跑根 junction 探针：自建哨兵仍存在，exit 0；现场 `.scratch/review-48-standards/junction-case-1792162767574`。只操作自建夹具路径。
- 主审复跑真实 Loop 的采用稿历史探针与挂载失败恢复探针，输出及候选输入见各发现证据链接。
- `git diff --check 48e0e0a...32216d9` 通过。

探针使用 LLM 桩及本地夹具，不等同于真实联网模型或 UI 端到端验收。本轮未重跑干净无 profile 的全仓矩阵。

Standards：1 条，最高 P1（`afterAll` 错误假绿）；Spec：4 条，最高 P2（采用稿历史错误、挂载失败恢复漏投）。另有 1 条已登记的工作流挂载旧问题未关闭。
