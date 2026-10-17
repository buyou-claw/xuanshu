# Spec 001 · a2ceaf3 修复复核

日期：2026-10-15。结论：**本轮复核不通过**。本提交修复了原探针的正常路径，但仍有 5 条本轮发现；上一轮另外 4 条问题未包含在本次修改中，仍未关闭。

## 审查范围与方法

- 固定基线：`d1ce6b3ce205701d5b2cac9a32afa8ae832f7709`。
- 被审提交：`a2ceaf39853b7796f099db7025b8ae3cc5dcc0c6`；25 文件，1331 行新增、261 行删除。
- 固定比较命令：`git diff d1ce6b3...a2ceaf3`。提交清单仅包含 `a2ceaf3`。
- 标准轴与规格轴由两个独立审查上下文完成，主审另行运行回归验证、最小反例及钉版 DSH 实装探针。两轴独立列出。
- 审查期间分支新增 `2cfcc05`，只修复台账与 9 份票面的编码；`git diff --name-only a2ceaf3` 确认没有业务代码变化。该文档提交不属于本次代码审查范围。
- 本次只新增本报告；实现、测试基线与已有文档未由审查者修改。`.scratch/` 下的探针及报告是复核证据，不是正式回归测试。

## Standards

### R1 · [P1] 清单门仍会漏掉 hook / suite 失败

位置：[scripts/lib/inventory-gate.mjs:44](../../scripts/lib/inventory-gate.mjs#L44)，关键判断在第 47 行。

`collectReport()` 只把 `assertion.status === 'failed'` 计为失败。真实 Vitest 的 `beforeAll` 抛错时，文件状态为 `failed`，用例仍被收集但标记为 `skipped`；报告新鲜、用例数不减，因此本门仍判通过。

独立真实 Vitest 反例结果：`vitestExit=1`、`reportSuccess=false`、文件 `status=failed`；但 `current.failures=[]`、`violations=[]`。这不是已知红豁免，而是文件级失败根本未进入判据。

依据：`AGENTS.md` 的验证约定、`docs/development-status.md` 的“基线之外的红色一律是本轮引入的回归”。应把未被显式豁免的 hook / suite / 未处理错误纳入违规；不能简单拒绝所有非零退出码，因为正常完成的已知红运行也会退出 1。

证据：`.scratch/review-a2-standards/probe-hook.mjs`、同目录 `hook-failure.test.mjs`、`hook-report.json`。主审已独立重跑。

上一轮标准轴状态：旧报告复用已修；干净环境收集条数缩水已修。copy 安装的两条旧问题仍未修改，见下方逐项对照。

## Spec

### R2 · [P1] 空白会话在恢复后仍会漏掉必需上下文

位置：[packages/xuanshu-host/lib/consult/service.mjs:129](../../packages/xuanshu-host/lib/consult/service.mjs#L129)，以及第 259 行的提前注入。

触发：空白创建问事，尚未发送第一问便关闭应用 / dispose agent，之后从门厅或历史继续，并使用原生 composer 发问。

新实现只把必需上下文放进 DSH 的待消费 inbox。钉版 rc.2 实装探针确认：`inject()` 后只有 `agent/inbox/spliced`，没有 `user/message`；正常 `handle.dispose()` 会追加 `outcome:"canceled"` 将待消费上下文移除。恢复后“继续”仅刷新目录、打开会话，原生 composer 不经过 `consult.send`，因此补灌逻辑不执行。

依据：Spec 001 用户故事 14：“底座与底稿默认在场、不可关”。应在恢复后的统一发问边界核对并补齐，而不能只依赖创建时排队和 RPC send 兜底。

上游实装依据：`dsh-agent-loop/lib/index.js:812`（inject）、`:815`（cancel 清 inbox）、`:1688`（dispose 调 cancel）。证据：`.scratch/review-a2-spec-inbox-probe.mjs`、`.scratch/review-a2-spec-inbox-output.jsonl`。主审已独立重跑；这是无模型调用的生命周期探针，不是带真实凭据的 UI e2e。

### R3 · [P1] 重启后先确认挂载、再从原生会话续问，挂载仍不生效

位置：[packages/xuanshu-host/lib/consult/service.mjs:155](../../packages/xuanshu-host/lib/consult/service.mjs#L155)。

触发：应用重启后，最近会话尚未 resume；在门厅为该会话确认挂载，再点“继续这次问事”，从原生 composer 提问。

`syncMountsIntoSession()` 找不到 live agent 时直接返回 false；RPC 仍成功保存挂载，只安排 `consult.send` 将来兜底。但真实 UI 的“继续”只是导航，不调用该 RPC。探针确认挂载已保存 1 项，恢复后的原生问题前没有任何挂载注入。

依据：S8 §5 第 7 步：“发送消息 → 按已确认的裁剪结果注入”。该路径由 `consult.tsx:282` 的 `mountSlot(latest)`、`:301` 的继续按钮、`:154` 的导航方法连通。应先恢复 agent 后投递增量，或由原生发问的统一入口补投。

证据：`.scratch/review-a2-mount-probe.mjs` 的 `mount-before-native-resume`；输出为 `mountsPersisted=1`、`contextInjections=0`、`aContentDelivered=false`。

### R4 · [P2] 部分挂载读取失败后，会被整体标记为已交付

位置：[packages/xuanshu-host/lib/consult/inject.mjs:106](../../packages/xuanshu-host/lib/consult/inject.mjs#L106)，调用方在 `service.mjs:159` 保存整份 `mountsInjected`。

触发：同时挂载 A、B，A 成功读取，B 暂时不存在或读不动。`.some(layer.kept)` 因 A 成功而返回 true，调用方把 `[A,B]` 全部记为已交付。B 恢复后，同清单再次确认和后续发送都命中相同 `mountsKey`，不会重读 B。

依据：S8 §5 的确认、发送注入与错误恢复要求；本提交台账 §11 也明确承诺“内容没真纳入不算交付，下一问再试”。独立探针结果：`markedInjected=[a,b]`、`readsAfterRecovery=0`、`bContentDelivered=false`。

应按层记录实际交付状态，保留失败层的重试资格，避免用“一层成功”代表“整份成功”。

证据：`.scratch/review-a2-mount-probe.mjs` 的 `partial-mount-recovery`。

### R5 · [P2] 合参候选仍不包含文本历史与此前采用稿

位置：[packages/xuanshu-host/lib/consult/bestof-run.mjs:227](../../packages/xuanshu-host/lib/consult/bestof-run.mjs#L227)，上游组装在 `bestof.mjs:397`。

现在候选收到的是底座、底稿、勾选谱、挂载快照加当前问题，仍没有会话文本历史。用户下一轮要求“沿用刚才预算比较已经采用的方案”，候选无法取得上一轮方案与预算。

依据：`docs/design/ui-v1/shared/星阙交互规格索引.md:175` 的“玄枢 v1 历史长度按合参模型统一处理”，以及 ADR-0010 第 5 条“历史只带采用稿：注入下一轮上下文时只放 adoptedId 指向的那一份”。S9 排除的是图片历史，不是全部文本历史。新增台账把“不带历史”声明为边界，并未修改这些需求。

应为候选加入经过窗口裁剪的会话文本历史，只保留被采用的合参稿，过滤落选或否决候选。判官与合并槽继续遵守各自的上下文边界。

## 上一轮 9 项逐项对照

| 上轮项 | 本轮状态 | 依据 |
|---|---|---|
| Standards 1：旧测试报告假绿 | 已修复该反例 | 原故障探针现在退出 2；另发现 hook 失败漏报，见 R1 |
| Standards 2：干净 CI 收集条数缩水 | 已修复 | 五个受影响文件未装 profile 时仍收集 46 条，逐文件与基线一致；41 条显式跳过 |
| Standards 3：copy 安装漏运行时依赖 | 未修复 | `scripts/install-profile.mjs:159` 仍改为 `link:`，本提交未修改安装器 |
| Standards 4：copy 安装丢锁文件 | 未修复 | `scripts/install-profile.mjs:166` 的复制列表仍无匹配 lockfile |
| Spec 1：定时任务未接可执行生成链 | 未修复 | `rikke/daily-tasks.mjs:142` 仍裸建 agent；本提交未改该文件 |
| Spec 2：空白首问漏上下文 | 部分修复 | 同进程路径已改善；正常 dispose 后的原生续问仍漏，见 R2 |
| Spec 3：合参候选缺本次资料 | 部分修复 | 资料快照已带入；历史与采用稿仍缺，见 R5 |
| Spec 4：首轮后挂载不生效 | 部分修复 | 活 agent 的普通迟到挂载已改善；未 resume 和部分失败仍漏，见 R3、R4 |
| Spec 5：工作流挂载仍占位 | 未修复 | `mounts/content.mjs:203` 仍对工作流返回空内容，客户端仍无工作流选择来源 |

上面 4 条“未修复”是上一轮已经报告的问题，不计作本次提交引入的新回归。

## 验证与边界

`pnpm verify:all` 退出 0；类型检查通过，客户端产物与源码同步（386627 B）。清单门原始摘要：

```text
[inventory] 用例 1057 条（基线 1057）/ 文件 99 个 / 失败 2 条（已知红 2 条） / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败。
```

`pnpm verify:assembly` 退出 1：S1 FAIL，S2 / S3 / S4 / S5 PASS；S4 的 185 行基线全部命中。S1 仍是已登记的钉版 schema carrier 问题，本轮没有把它列为新回归。

未装 profile 的定向复核覆盖本次修改的五个环境门文件：46 条，0 失败，41 跳过；文件分别收集 8 / 8 / 13 / 16 / 1 条，与基线一致。证据：`.scratch/review-a2-clean-profile.json`。本轮没有再跑第二遍完整的干净环境全仓测试，不能把这份定向结果说成全仓干净 CI 验收。

原探针复跑确认：合参已携带底稿 / 勾选谱；同进程空白首问已排入上下文；普通迟到挂载能形成新增投递。原探针末尾读取的 `.scratch/spec001-review-no-profile.json` 是上轮冻结输出，仍显示 1 条，不用作本轮环境门判据。

实际安装的 host 中 `consult/service.mjs`、`inject.mjs`、`turns.mjs`、`bestof.mjs` 与被审源码逐字节一致，排除了 profile 仍装旧实现的干扰。

清单门当前通过并不否定 R1：实际全仓运行没有触发该 hook 故障；R1 来自单独故障注入，其他上下文问题也不在现有正向回归用例的覆盖中。

本轮标准轴 1 条发现（最高 P1：hook 失败假绿）；规格轴 4 条发现（最高 P1：恢复后的上下文注入缺失）。另有标准轴 2 条、规格轴 2 条上一轮问题未关闭。
