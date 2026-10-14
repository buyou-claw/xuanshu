# tests/sediment — 票 15（沉淀闭环）宿主半的断言台

零网络、零真实会话、零真实 LLM（`sediment.draft` 会等一轮对话，这里也只重放那一轮对被测物可见的两面：
`turn/end` 事件与日志里的助手消息）。被测物是 `packages/xuanshu-host/lib/sediment/**`
的**三个 `sediment.*` 方法**（契约 §3 的冻结方法面）、草稿暂存区
（`<dataDir>/sediment/<draftId>.json`，schema `xuanshu/sediment@1`）与写回到目标谱的落盘结果。

## 本票的断言重心：负路径

「AI 不静默改我的东西」这条产品线在这张票上的机器判据是「**未确认时磁盘上一个字节都不许变**」，
所以负路径用的是**字节级快照**（`sandbox.snapshot()`：路径 → 内容），而不是「文件列表没变」——
后者挡不住「同名文件被改写」这种最像成功的失败。

## 怎么做到「零真实会话」

`sediment.*` 只被允许通过四个接缝碰会话与谱：

| 接缝 | 断言台给的替身 | 判据 |
|---|---|---|
| `ctx.agents.get/resume` | `lib/sandbox.mjs` 的 `fakeAgents()` | 记录 `resume` 的入参；**不许 `create`**（沉淀的是这场问事会话，不是另开一场） |
| `ctx.sessionQuery.readSession` | `fakeSessionQuery()` | 记录读了哪个会话；没登记的会话按上游错误码 `SESSION_QUERY_SESSION_NOT_FOUND` 抛 |
| `ctx.on('session/event')` | `makeHost()` 的 `on/emit/listenerCount` | 「先订阅 `turn/end` 再 `followup`」有客观判据：followup 那一刻监听器数必须是 1 |
| `ctx.sessions` | `fakeSessionStore()`（测试文件里就地定义） | **任何**调用都记账并抛 |

假 agent 的 `whenIdle()` 直接抛：等一轮结束必须看 `turn/end`
（`dsh-agent/lib/types/runtime-types.d.ts:164` 明说 `whenIdle()` 不标识某条消息的结束）。

## 零自造形状：谱、旁挂清单都来自真实现

- **目标谱**：用票 09 的**真** `createPuRepository().confirm()` 落盘；写回之后也用票 09 的
  `read()` 验证结果（「只走 `pu.update` 那条路」这件事靠**结果**钉住，不靠内部函数断言）；
- **问事会话**：用票 10 的**真** `createConsultStore()` 落旁挂清单（`session-xs-consult-…`）；
- **会话事件**：`userEvent()` / `assistantEvent()` / `turnEndEvent()` 按 `dsh-session` 的
  `SessionEvent` 形状造（`{type, seq, time, data}`），喂给假 `sessionQuery`。

## 断言只打四样外部可观察的东西

1. **方法返回值**（契约 §3 的形状：`{draftId,target,draft}` / `{pu}` / `{ok:true}`）；
2. **沙箱里真落了哪些文件**（`sandbox.files()` 全量比对、草稿逐字段比对、字节级快照）；
3. **交给 agent 的东西**：`followup` 的消息（来源 kind + 提示内容）与**顺序**；
4. **通道层**：`wiring.test.mjs` 走**真** `installRpc` + **真** `apply()`，逐字调三个方法。

不测内部函数、不测私有字段：`lib/sediment/*` 内部改结构不该让这里变红。

## 用例分布

| 文件 | 覆盖 |
|---|---|
| `store.test.mjs` | 落盘路径与 schema；正文归一（概览必须真在一级标题上）；不合规草稿拒收且不落盘；schema 不认识 → `null`（不猜）；`draftId` 的路径穿越面 |
| `commit.test.mjs` | **`confirmed !== true` 四个变体一律拒收 + 字节级零改动**；草稿原样留着；写回后正文 / `updated_at` / `summary` 都对；只写目标谱、不改谱名、不新建；成功即删草稿；`draft?` 覆盖；目标谱被删 → 可读失败且不新建 |
| `draft.test.mjs` | 驱动的是这场问事会话（`resume` 它、`created` 为空）；**先订阅 `turn/end` 再 `followup`**；提示里带 skill 与目标谱当前正文；代码围栏容忍；模型乱答 / 缺 summary → 拒收且草稿区零落盘；非问事会话 / 旁挂不存在 / `turns=0` 拒收；目标谱推断四条路（显式 / 勾选第一本 / 列表第一本 / 一本都没有）；能力门；`sessionQuery` 缺失；取消；**只暂存不改谱** |
| `discard.test.mjs` | 只删这一份草稿（别的草稿与谱文件原样）；草稿不存在 / id 形状不对 → 可读失败且零改动 |
| `wiring.test.mjs` | `/xuanshu` 通道上三个方法逐字可调、与既有组（`pu.*`/`cang.*`/`bazi.*`/`consult.*`/`digao.*`/`rikke.*`）合并不覆盖；skill `xuanshu-sediment` 真的注册进 `ctx.skills`（与票 09 的 `create-pu` 并列）；导出汇总 + 确认写回的端到端（草稿落 `config.dataDir/sediment` 下） |

## 没被覆盖的（如实登记）

- **真 LLM 的提炼质量**：这里的「模型回答」是用例给的字符串（合法 JSON / 乱答 / 缺字段），
  只验**形状与闸门**，不验真模型会不会按 skill 吐 JSON。真机上一次 `sediment.draft` **未跑**。
- **真 DSH 会话日志的 replay 路径**：`ctx.sessionQuery.readSession` 是替身；
  真日志是 zstd JSONL（本机 `session.v4.jsonl.zstd`），读法由票 10 `consult.read` 那条路覆盖。
- **客户端点击链路**：见 `tests/assembly/sediment-views.test.mjs` 的环境声明（`renderToStaticMarkup`，无 jsdom）。

## 跑法

```powershell
node node_modules/vitest/vitest.mjs run --root . tests/sediment
```
