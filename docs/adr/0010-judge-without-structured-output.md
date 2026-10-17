# judge 槽不用 `json_schema strict`：用「工具调用参数 JSON + 校验」

Spec 001 的实现决策里写着多 AI 合参的 judge 槽走「`json_schema strict`、失败回落完成顺序第一份」（票 11）。钉死的 `0.2.0-rc.2` **没有结构化输出**，任何按参数写法的代码都必然返工：

- **`GenerateOptions` 全字段无结构化输出**：`provider, model, reasoningEffort?, messages, system?, tools?, toolHistory?, temperature?, maxTokens?, stop?, signal?, sessionId?, purpose?`（`dsh-llm/lib/types/types.d.ts:489-531`）——没有 `responseFormat` / `jsonSchema` / `json_schema`。
- **全实装 grep 零命中**：282 个包对 `json_schema|response_format|responseFormat` **无一处**命中。
- **上游明文**：`dsh-llm/README.md:158`「`GenerateOptions` sampling is `temperature`/`maxTokens`/`stop` only — no `tool_choice`, `top_p`, or penalty fields」；`dsh-llm-deepseek/README.md:205`「`tool_choice` is not mapped — not part of the core vocabulary」。
- 顺带否掉一条捷径：**直接打 provider 的 HTTP JSON mode** 会绕过 DSH 的凭据体系（`ctx.credentials`，`apiKeyEnv` 每请求解析）与「Model-visible ⟺ logged」不变量（`dsh-llm/README.md:114`），等于在玄枢里开第二条 LLM 通道——ADR-0001「装配不 fork」的同一逻辑。

**决定：judge 槽让模型**调用一个只有一个字段的工具**（`submit_judgement`），参数天然是模型产出的原始 JSON 字符串，再用 schema 校验；校验失败或模型没调工具 → 回落「完成顺序第一份」。**

具体定值：

1. **judge 的产出走工具调用参数，不走采样参数**：`'tool/call'` 事件的 `arguments` 是「模型产出的原始 JSON 字符串，未解析」（`dsh-session/lib/types/types.d.ts:354-360`），所以它**天然就是**一个可校验的 JSON 载荷；工具只声明一个 `judgement` 对象参数。
2. **校验必须显式做，且失败要回落而不是抛**：解析 + 逐字段校验（轴向：采用哪一份、排序、理由）；任何一步失败 → `adoptedId = 完成顺序第一份`，并把失败原因记进 `bestOf.judge.error`（**回落是规格的一部分，不是异常处理**）。
3. **N 路并行 = 并发多个 `ctx.llm.stream()`**：`stream()` 每次返回独立的 `AsyncIterable`，无共享可变状态（`dsh-llm/lib/types/index.d.ts:412`；`LlmRuntime` 只有 adapter/directory/discoveries 三个私有字段）。注意 `prepareCall()` 是**一次性**的（`:386`），并发场景每个 provider 各自 `prepareCall` + `stream`，或直接 `stream`。
4. **`bestOf` 记录不落 `message.candidates`**（rc.2 无此字段，见 ADR-0009 第 7 条）：落旁挂文件，`costUsd` 从 `assistant/message` 的 `usage` 累计。
5. **历史只带采用稿**：注入下一轮上下文时只放 `adoptedId` 指向的那一份；其余候选留在旁挂记录里供回看——这条是产品规格（分歧可见、拍板在人），不是上下文预算的副产品。
6. **模型选择复用既有 provider 配置与凭据**：`ctx.llm.listProviders()` / `listModels(provider)` / `listConfigurableProviders()`（`:272` / `:350` / `:286`），凭据走 `ctx.credentials.resolve(ref)`（`dsh-credentials/lib/types/index.d.ts:129`）。玄枢**不自建密钥存储**。
7. **合参状态按会话串行提交**（2026-10-17，修复 F3/F4）：新轮首次直接写旁挂文件，成功后才发布为当前轮；旧候选后台回填继续受当前轮守卫保护。同一问事的受理、拍板与采用投递使用进程内操作队列，采用投递和账本提交完成后，下一轮才读取历史并继承账本。候选流本身不占队列，仍然并行；不同会话互不等待。冷恢复或合并调用较慢时，同会话后续状态操作会等待它结束；操作失败会释放队列。该队列不提供跨进程锁。

**Considered Options**：

- **提示词要求 JSON + 自己 parse**（剥离 ```json 围栏后 `JSON.parse`）——**保留为降级路径**：它不需要工具面，实现最短；缺点是「模型没按格式答」与「模型拒答」分不开，且没有工具调用这个天然的 schema 边界。judge 槽首选工具调用，工具不可用时降级到它，降级事实要写进 `bestOf.judge.mode`。
- **等上游支持 `response_format`** —— 被否：ADR-0004 已经钉死版本与「不追上游」的口径；把票 11 挂在一个未排期的上游能力上，等于这张票没有交付日期。
- **直接对 provider 发 HTTP 请求用它的 JSON mode** —— 被否：见上文，绕过凭据与日志不变量，等于自建第二条 LLM 通道。
- **judge 用另一个 agent 跑一轮带工具的会话**（复用 `ctx.agents`）—— 被否（本版）：判官不该带挂载与工具（设计稿 H4「判官不带挂载」），而 agent 路径要起会话、落日志、付上下文组装成本；judge 只需要一次「读 N 份答案 → 输出一个判断」的调用，`ctx.llm.stream()` 更贴形状。
- **判官失败就不采用（`adoptedId = null`）** —— 被否：那会让「模型偶发不按格式」表现成「这次合参白做了」。规格要的是**拍板在人**，所以回落首份 + 人可以改选，比空手而归好。

**Consequences**：

- **judge 的成功判据变成两条**：`tool/call` 出现 **且** 参数校验通过。断言必须覆盖「模型没调工具」「参数不是合法 JSON」「参数合法但不合 schema」三条负路径，否则「回落」这条规格等于没测。
- **`costUsd` 的来源是 `usage`，不是估算**：单测不可能打真模型，所以成本字段在无 LLM 的断言台里以打桩 usage 验证累计逻辑，真机数值由 e2e（需真凭据）另行确认——**不要把打桩值写成实测值**。
- **退路被显式登记**：若某 provider 的工具调用能力不可用，judge 降级为提示词 JSON；降级后 `bestOf.judge.mode` 从 `tool` 变 `prompt-json`，回看时能看出这次判定是怎么来的。
- **本 ADR 同时约束票 15 / 16**：凡「让另一个模型评一句 / 吐一个结构」的地方，都不要再去找 `json_schema` 参数。
