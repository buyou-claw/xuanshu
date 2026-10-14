# tests/consult — 票 10 宿主半的断言台

零网络、零真实会话、零真实 LLM。被测物是 `packages/xuanshu-host/lib/consult/**` 的
**六个 `consult.*` 方法**（契约 §2 的冻结方法面）、它们落下的**旁挂清单**
（`<dataDir>/consult/sessions/<sessionId>.json`，schema `xuanshu/consult@1`），
以及首轮**注入文本**（`consult.send` 交给 `agent.inject()` 的那条消息）。

## 怎么做到「零真实会话」

`consult.*` 只被允许通过三个接缝碰会话与谱：

| 接缝 | 断言台给的替身 | 判据 |
|---|---|---|
| `ctx.agents.create/get/resume` | `lib/sandbox.mjs` 的 `fakeAgents()` | 记录 `create` 的入参（含 `meta`）、`resume` 的入参，交出可观察的假 agent |
| `ctx.sessionQuery.readSession` | `fakeSessionQuery()` | 记录读了哪个会话；没登记的会话按上游错误码 `SESSION_QUERY_SESSION_NOT_FOUND` 抛 |
| `ctx.sessions` / `ctx.workspaceRegistry` | `fakeSessionStore()` / `fakeWorkspaceRegistry()` | **任何**调用都记账并抛 —— 票 10 不许用它们 |

假 agent 的 `whenIdle()` 直接抛：票 10 等一轮结束必须看 `turn/end`
（`dsh-agent/lib/types/runtime-types.d.ts:164` 明说 `whenIdle()` 不标识某条消息的结束）。
「用 whenIdle 记账」这种写法在这里会立刻红，而不是在真机上安静地记错。

## 零自造形状：谱与信封都来自真实现

- **底座谱**：用票 08 的**真** `bazi.cast` + 票 06 在真机上捕获的信封
  （`tests/horosa/fixtures/envelopes/bazi-ok-default.json`，假 `xuanshuHorosa` 回放）现出一次盘，
  落到沙箱的 `pus/_base/**`。票 10 只消费 `bazi.basePu`，绝不自己造一份底座谱。
- **可选谱**：用票 09 的**真** `createPuRepository().confirm()` 落盘，验证注入的是
  真 `pu.read()` 读出来的概览 / summary / 路径。
- **会话事件**：`userEvent()` / `assistantEvent()` 按 `dsh-session` 的 `SessionEvent` 形状造
  （`{type, seq, time, data}`），喂给假 `sessionQuery` —— 验的是 `history.mjs` 的投影，不是真日志格式。

## 断言只打四样外部可观察的东西

1. **方法返回值**（契约 §2 的形状：`ConsultSummary` / `ConsultMessage` / `required+optional` / `{accepted:true}`）；
2. **沙箱里真落了哪些文件**（`sandbox.files()` 全量比对 + 旁挂清单逐字段比对）；
3. **交给 agent 的东西**：`create` 的 `{sessionId, meta}`、`inject` / `followup` 的消息与**顺序**；
4. **事件订阅**：`turn/end` 命中与退订（`host.listenerCount('session/event')`）。

不测内部函数、不测私有字段：`lib/consult/*` 内部改结构不该让这里变红。

## 用例分布

| 文件 | 覆盖 |
|---|---|
| `defaults.test.mjs` | 底座/底稿恒在场（present 三态 + reason 指向）；可选谱来自 `pu.list()` 且排除 `_base`；坏谱不进列表；一个谱都没有的空态 |
| `agent.test.mjs` | 会话怎么接上 agent：`meta.agentPreset` + `agentOptions` + `setup` 里 mount 缺省 preset；resume 认回会话 header 存的 preset（名册里没了退回缺省）；软降级；**发问前的能力门**（缺服务 → 可读失败且不注入/不落账） |
| `create.test.mjs` | id 前缀 / `cwd` / `meta` 逐键 / 返回形状；`ctx.sessions` 与 `workspaceRegistry` **零调用**；旁挂清单逐字段；`pus` 拒绝路径「不建会话、不落盘」；旁挂写失败**回滚会话** |
| `send.test.mjs` | 注入先于问题、来源 kind；三段来源标记 + 概览/summary/路径且**不含正文**；**非勾选谱不出现**；底稿缺 / 底座缺的文案；一轮只灌一次；首问定标题、改名不被覆盖；并发两问串行；`turn/end` 记账与退订（别的会话 / 别的类型不算）；`agents.resume` 续问；拒绝路径 |
| `history.test.mjs` | `list` 是旁挂清单权威（没有 `sessionQuery` 也列得出来、坏文件不拖垮）；`read` 投影（工具结果不进消息流、source 带得出、not-found → 空数组、坏日志不吞）；`rename` 落盘与拒绝 |
| `message.test.mjs` | 注入消息形状与官方 `createUserMessage()` 对照（profile 装了才跑对照，没装整组跳过）、深冻结、两个构造器各带各的 kind |
| `turn.test.mjs` | `turn/end` 命中与退订、abort、没有 `ctx.on` 时拒绝（不永远挂着） |
| `wiring.test.mjs` | **真** `installRpc` + **真** `apply()`：`/xuanshu` 通道路径、六个方法逐字可调、与 `pu.*`/`cang.*`/`bazi.*` 合并不覆盖、数据目录同源、preset 真的挂到 agent scope 上 |
| `bestof-run.test.mjs` | 票 11：2 路并行（各带视角 directive、**候选不带工具**）；judge 单字段工具成功路径；记录落 `xuanshu/bestof@1`；两路 usage 各自记着 |
| `bestof-judge.test.mjs` | 票 11：judge **三条负路径**（没调工具 / 参数非法 JSON / 参数不合 schema）+ prompt-json 降级 + 回落按**完成顺序** + 判官调用本身失败 + 只有一份候选不跑判官 |
| `bestof-adopt.test.mjs` | 票 11：`state` 冷读（进程重启后按 runId 读回来）/ 采用 / 否决 / 合并（宿主总编调用与人手合并）/ `cancel`（停止全部）/ 费用（有价表才算，没价表整个键缺席）/ 路由与能力门 |
| `bestof-assembler.test.mjs` | 票 11：自己收的 chunk 与官方 `BlockAssembler` 逐项对照（文本 / usage / finish；profile 装了才跑） |
| `bestof-wiring.test.mjs` | 票 11：**真** `installRpc` + **真** `apply()` 下三个 `bestof.*` 可调、与既有方法合并不覆盖、记录落同一个 dataDir、采用稿在这条路上也投进会话 |
| `bestof-history.test.mjs` | task-14：**采用稿进会话历史**（`user/message` + `source.kind=xuanshu-bestof-adopted`）、落选候选**逐字搜不到**、adopt 前后日志**只多那一处**、否决不写、合并写合并稿、改选写第二条、进程重启走后 resume、投递失败如实回执 |
| `bestof-history-real.test.mjs` | task-14：用**真** `dsh-session` 的 `SessionStore`/`Session` 证明这条载体合法（`append` 不抛、事件在册、投影带我们的 source、header 没动、只多已登记的事件类型）；profile 装了才跑 |

票 11 的假 `ctx.llm` 在 `lib/bestof-llm.mjs`：按 **7 分支 chunk 契约**回放
（`block-start`/`text-delta`/`tool-call-delta`/`block-end`/`usage`/`finish`），
`arguments` 保持「未解析的原始 JSON 字符串」，支持 `delay`（完成顺序）与 `hold`（吐完正文但这一路还挂着）。

假服务一共五个：`fakeAgents()`（记录 create/resume 入参，并像真工厂那样在发布前 `await setup`）、
`fakeSessionQuery()`、`fakeAgentPresets()`（resolve/mount）、`fakeAgentDefaultModel()`，以及
两个「不许被碰」的陷阱替身 `fakeSessionStore()` / `fakeWorkspaceRegistry()`。

## 跑法

```powershell
node node_modules/vitest/vitest.mjs run --root . tests/consult
```

`message.test.mjs` 的「官方实现对照」需要 worktree 里装过 profile
（`node scripts/install-profile.mjs --home .dsh-home`）；没装时它 `skipIf` 跳过，
其余用例不受影响。
