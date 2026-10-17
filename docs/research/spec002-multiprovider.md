# Spec 002 侦察：钉版 `dsh-v0.2.0-rc.2` 上做「真多家 API 并列」

日期：2026-10-17 · 只读侦察，未改任何代码（唯一写入 = 本文件）。
路径约定：`@deepseek-ai/<包>/…` 指 `.dsh-home/profiles/xuanshu/node_modules/@deepseek-ai/<包>/…`（**运行时实装**，本 profile 真正加载的那份）。本仓路径相对仓库根。
强度标注：**实装** = 该包 `lib/*.js` 里跑得到的代码；**类型定义** = 仅 `.d.ts` 声明（无实装印证时不能当行为承诺）；**文档** = 随包的 README；**仅推断** = 由结构推出的结论，未实测。

---

## 结论先行

1. **多 provider 同时配：能做。** `dsh-llm-pi-ai` 的 `providers` 字典一次挂任意多条路由，且与 `deepseek-official` / `deepseek-account` 共存（路由名不撞即可）；条件：每家要么有能解析的 `apiKeyEnv` 凭据，要么走该 provider 自带登录，否则请求期 `MISSING_CREDENTIAL`。
2. **程序化列 provider/model/默认：能做。** `listProviders()` + `listModels(provider)` + `resolveModelInfo()`，默认取 `ctx.agentDefaultModel.currentSelection()`；条件：只能看到**已注册**路由——没配过的 pi-ai 路由不在 `listProviders()` 里，而在 `listConfigurableProviders()` 里。
3. **单次调用指定 provider+model：能做。** `GenerateOptions.provider: string` / `model: string`（另有 `reasoningEffort?`）；条件：model 必须被该路由服务（pi-ai 对未配置模型报 `UNKNOWN_MODEL`；core 路由本身允许 catalog 外的 id）。
4. **并行发 N 路：能做，但不是内置能力。** 自己起 N 个 `stream()` 迭代器即可；无全局并发闸，abort 靠每路 `signal`；**裸 `ctx.llm.stream()` 是单次尝试、不重试**（retry 只挂在 agent loop 的 `agent/request-error` 上），缺 adapter 不抛而是一个终态 error finish（`NO_ADAPTER`），故一路挂掉不拖累其它路。
5. **usage/cost：usage 有，cost 没有。** 响应流里有 `usage` 块（6 个 token 桶），**全链无货币价表**；pi-ai 上游 `cost` 元数据被显式丢弃（`NO_COST`），所以「费用未知」确实是当下唯一诚实的默认可视。
6. **用户怎么加一家新的：设置 → 模型页（Models）能加，也能手改 profile patch / 环境变量。** 玄枢可以只做「检测 + 指路」：检测面 = `listProviders`/`listConfigurableProviders`/`settings.describe`/`credentials.describe`，指路 = 文案指向 Models 页；条件：`ctx.settings` 依赖 `configEditor`+`profileContext` 两服务在场，须软取降级。

---

## 证据

| 结论 | 证据 file:line | 强度 |
|---|---|---|
| 一个 pi-ai 实例承载多路由：`providers` 字典键 = 路由名 | `dsh-llm-pi-ai/lib/types/config.d.ts:181-187`；说明 `:53-54` | 类型定义 |
| 该字典是 `Volatile`：设置改动下一请求即生效、无需重启 | 同上 `:187`；`dsh-llm-pi-ai/README.md:38` | 类型定义 + 文档 |
| base bundle 把 pi-ai **常挂但零路由**（dormant），配了才注册 | `dsh-base/cordis.patch.yml:120-128`（`:127` 即 `llm-pi-ai` 行） | 实装（bundle 配置） |
| 官方 DeepSeek 适配器与 pi-ai 可同时挂（路由名不撞） | `dsh-llm-pi-ai/README.md:34`；`dsh-llm-deepseek-account/lib/index.js:11`（`PROVIDER="deepseek-account"`）、`dsh-llm-deepseek-api-key/lib/index.js:36`（`"deepseek-official"`） | 文档 + 实装 |
| **本机已实证两家同跑**：desktop profile 配了 `opencode-go` 与 `opencode` | `C:\Users\Administrator\.dsh\profiles\desktop\cordis.patch.yml:24-86`（`llm-pi-ai.providers` 下两个键） | 实装（用户真实配置） |
| 凭据以 ref 形式共存：上面两条路由各自的 `apiKeyEnv` | 同文件 `:34`、`:86`；`C:\Users\Administrator\.dsh\.credentials.yaml` 的 `refs:` 下有 `OPENCODE_API_KEY` / `OPENCODE_GO_API_KEY`（值不打印） | 实装 |
| 未解析到凭据 → `MISSING_CREDENTIAL`；key 不可用 → `INVALID_CREDENTIAL` | `dsh-llm-pi-ai/README.md:38,117` | 文档 |
| `listProviders(): LlmProviderInfo[]` | `dsh-llm/lib/types/index.d.ts:272`；`LlmProviderInfo{id,name}` `lib/types/types.d.ts:205-210` | 类型定义 + 实装（`dsh-llm/lib/index.js` 同名方法） |
| `listConfigurableProviders()`（含 `settingsNs`/`settingsPath`/`declared`/`error`） | `dsh-llm/lib/types/index.d.ts:286`；结构 `lib/types/types.d.ts:224-247` | 类型定义 |
| `listModels(provider): Promise<LlmModelInfo[]>` | `dsh-llm/lib/types/index.d.ts:350`；`LlmModelInfo` `lib/types/types.d.ts:304-315` | 类型定义 |
| `resolveModelInfo(provider,model): LlmResolvedModelInfo`（context/defaultMaxTokens/reasoning…） | `dsh-llm/lib/types/index.d.ts:360`；`LlmResolvedModelInfo` `lib/types/types.d.ts:377-388` | 类型定义 |
| **「列全 provider→model→默认」有现成范式**（Host 侧一次性组装 catalog，含失败隔离） | `dsh-api-session-controller/lib/index.js:500-548`（`buildModelCatalog`：`listProviders()`→`listModels()`→`resolveModelInfo()`，返回 `{default, routableProviders, groups, failures}`） | 实装 |
| 默认 provider/model 可读 | `dsh-agent-default-model/lib/types/index.d.ts:40-42`（`currentSelection(): ModelSelection`）；base 默认 `deepseek-official/deepseek-flash`（`dsh-base/cordis.patch.yml:82-86`） | 类型定义 + 实装 |
| 玄枢已经在用这个面（列 provider、挑首个可用路由） | `packages/xuanshu-host/lib/digao/llm.mjs:31-51` | 实装（本仓） |
| `GenerateOptions.provider` / `.model` 必填 `string`；`signal?: AbortSignal` | `dsh-llm/lib/types/types.d.ts:489-492,519` | 类型定义 |
| 同一组字段在 `LlmCallConfig`（`prepareCall` 入参） | `dsh-llm/lib/types/call-config.d.ts:16-23` | 类型定义 |
| `prepareCall(config)` 绑定一次 adapter 注册后再派发 | `dsh-llm/lib/types/index.d.ts:93-116,386` | 类型定义 |
| catalog 只是「建议」，不约束路由 | `dsh-llm/lib/types/types.d.ts:303-304,344-347`（原文 “advisory, not request validation”） | 类型定义 |
| pi-ai 对未配置模型报 `UNKNOWN_MODEL`；未随 catalog 的路由必须给 `api`+`baseURL`+`models` | `dsh-llm-pi-ai/README.md:117` | 文档 |
| 可用的线上协议只有三种：`openai-completions` / `openai-responses` / `anthropic-messages` | `dsh-llm-pi-ai/lib/index.js:802-805` | 实装 |
| 无 adapter → `LlmError(…,"NO_ADAPTER")`，且被折成**终态 error finish**（不抛给调用方） | `dsh-llm/lib/index.js:2238`（抛点）、`:2283-2340`（`adapterStream` 的 `catch → yield adapterFailureChunk`） | 实装 |
| 失败形态：`finish.reason` = `{kind:'aborted'|'error', failure}`；`failure` 带 `code/status/providerRetryAfterMs` | `dsh-llm/lib/types/types.d.ts:131-149,26-44` | 类型定义 |
| 流里有 `usage` 块；`TokenUsage` = input/output/total?/cacheRead?/cacheWrite?/reasoning? | `dsh-llm/lib/types/types.d.ts:439-441,160-174` | 类型定义 |
| **上游货币成本被显式丢弃**：`NO_COST` 全零，注释「the harness never reads pi-ai's cost metadata — replay.ts zeroes it and no consumer reports spend」 | `dsh-llm-pi-ai/lib/index.js:267-276`（`const NO_COST` 在 `:272`）、`:688`（`cost: base?.cost ?? NO_COST`） | 实装 |
| token-meter 只有 token 桶，无金额字段 | `dsh-token-meter/lib/types/turn-usage.d.ts:8-22`；`lib/types/projection.d.ts:12-17` | 类型定义 |
| 玄枢的价表是编排注入的配置；缺表即 `costUsd: undefined`（界面「费用未知」） | `packages/xuanshu-host/lib/consult/bestof.mjs:179-185`；`bestof-run.mjs:352-358`（除法计价）、`:362-366`（`priceFor` 按 `<provider>/<model>` 取表） | 实装（本仓） |
| `llm/stream` 是 waterfall，可旁听或短路（`next()` 才进 adapter） | `dsh-llm/lib/types/index.d.ts:32-46` | 类型定义 |
| `llm/adapters-updated` 拓扑变更事件（无载荷，重读 `listProviders()`） | `dsh-llm/lib/types/types.d.ts:10-22` | 类型定义 |
| **裸 `ctx.llm.stream()` 不重试**：retry 只监听 `agent/request-error` | `dsh-llm-retry/lib/index.js:16-18,175`（`ctx.on("agent/request-error", …)`）；`dsh-llm-pi-ai/README.md:231`（“direct `ctx.llm.stream()` calls remain single-attempt”） | 实装 + 文档 |
| 每路由自带空闲超时：pi-ai 默认 300000ms；deepseek 同名字段可配 | `dsh-llm-pi-ai/lib/types/config.d.ts:21-22`；`dsh-llm-deepseek/lib/types/config.d.ts:22` | 类型定义 |
| 无全局并发闸（`dsh-llm` 内 concurren/semaphore/queue 全无命中） | `dsh-llm/lib/index.js`（全包关键字 grep 零命中） | 实装（否定证据） |
| Models 页（「设置 → 模型」）已在 xuanshu 装配里挂上 | `dsh-web-app/cordis.patch.yml:294-295`（`ui-settings-models`） | 实装（bundle 配置） |
| 加 provider 的两条 UI 路径：第三方目录 / 自建 OpenAI·Anthropic 兼容端点 | `dsh-client-ui-settings-models/README.md:55-57` | 文档 |
| 页面写入方式：`settings.mutate` 路径 ops，只持有脱敏描述符 | `dsh-client-ui-settings-models/README.md:77,81`；`dsh-settings/lib/types/index.d.ts:109-114`（`mutate` 在 `:114`） | 文档 + 类型定义 |
| 设置落盘到「当前 profile 的补丁层」 | `dsh-settings/lib/types/index.d.ts:85-91`（`documentPath` 在 `:87`） | 类型定义 |
| pi-ai 设置命名空间 = `llm-pi-ai`（可由 entry id 覆盖） | `dsh-llm-pi-ai/lib/index.js:2490-2492,2535` | 实装 |
| key 存 `<ROUTE>_API_KEY` ref，`cordis.patch.yml` 永不出现 key 值 | `dsh-client-ui-settings-models/README.md:45` | 文档 |
| 凭据源序：继承环境 → 受管 `$DSH_HOME/.credentials.yaml` → 项目/用户 `.env` | `dsh-base/cordis.patch.yml:105-108` | 实装（bundle 配置） |
| 「某家配没配 key」的检测范式（settings + credentials 联合判定） | `dsh-api-session-controller/lib/index.js:573-588`（`hasProviderApiKey`） | 实装 |
| `ctx.settings` 需要 `configEditor` + `profileContext` 两个服务 | `dsh-settings/lib/index.js:324`（`static inject`） | 实装 |
| 现合参：无 `profileIds` 时把同一 selection 复制 N 份（= 同模型两视角） | `packages/xuanshu-host/lib/consult/bestof.mjs:83-88` | 实装（本仓） |
| 现合参：给了 `profileIds` 才按路由各取**首个**模型 | `bestof.mjs:89-105`（`listModels` 在 `:97`、取 `models[0]` 在 `:101`） | 实装（本仓） |
| 现合参：judge 用**会话默认**模型（同源判官） | `bestof.mjs:391`（`defaultModelSelection(ctx)`）、collectJudge `:420` | 实装（本仓） |
| 现合参：N 路 `Promise.all` 全开，单路 try/catch 收敛 | `bestof.mjs:324-362`；`bestof-run.mjs:218-242`（`:225` 起流、`:236` 判 finish、`:241` 捕获） | 实装（本仓） |
| 现合参：跑前无确认、无并发上限、无每路超时 | `bestof.mjs:324`（直接进 `Promise.all`） | 实装（本仓） |
| 玄枢运行 home 的凭据库里**没有**任何 provider key（只有浏览器会话 grant） | `E:\ai_project\XuanShu\.dsh-home\.credentials.yaml`（`records:` 仅 `client-connection/browser-session`，无 `refs:` 段） | 实装（本机文件） |

---

## 现有的玄枢实现与本目标的差距

| # | 现状（带出处） | 要改什么 |
|---|---|---|
| 1 | 默认单路由：无 `profileIds` 时同一 `{provider,model}` 复制 N 份（`bestof.mjs:83-88`）——所谓「多 AI」是两个提示词视角，不是两家模型的分歧 | 路由解析改成「从已注册 provider 里选 N 家不同 `provider`」，并把它做成显式入参（下游编排传、UI 也可选） |
| 2 | `profileIds` 已有，但只取每路**第一个** model（`bestof.mjs:89-105`），等于把模型选择交给 adapter 的排序 | 允许 `{provider, model}` 二元组入参；缺 model 时才回落 `listModels()[0]` |
| 3 | judge 取会话默认模型（`bestof.mjs:391`）→ 判官与候选同源，「异源判官」不成立 | judge 路由单独解析：必须**不在候选路由集合里**；找不到异源家时如实降级（`judge.mode='failed'` 语义已有，`bestof-run.mjs:319-326`），不许冒充 |
| 4 | 无费用前置确认（`bestof.mjs:324` 直接开跑） | 跑前一步：列「N 家 × model × 上下文规模」，金额能算则算、不能算则显式「费用未知」，再由人点确认 |
| 5 | 价表是编排注入的配置（`bestof.mjs:179-185`、`bestof-run.mjs:362-366`），运行时无任何官方价表 | 二选一：接受「费用未知」为常态、确认页只报 token 规模；或自维护带版本/来源的估算价表并标注「估算」 |
| 6 | N 路全开无上限、无每路超时、无重试（`bestof.mjs:324` + 上文「裸 stream 不重试」） | 加并发上限（家数本来有界，但要防 `count` > 可用家数）、每路 `AbortSignal.timeout` 或路由级 `streamIdleTimeoutMs`；要不要自建退避须先决策 |
| 7 | 玄枢自家 DSH_HOME 的凭据库无 provider key（只有浏览器 grant），pi-ai 路由只能吃启动环境/`.env` 兜底 | 合参前置检查必须能读「某家 key 是否已配置」，缺则**指路**到设置页，而不是跑起来再吃 `MISSING_CREDENTIAL` |
| 8 | 无「有哪些家」的露出面：UI 只拿得到当前选择 | 新增只读「路由清单」RPC（provider → models → 是否已配 key），数据来源即证据表中 `buildModelCatalog` / `hasProviderApiKey` 两个范式 |

---

## 候选落地路径

### 路径 A（推荐，纯用 DSH 现有面）：只改玄枢编排 + 新增只读路由清单

- 玄枢**不**管 provider 怎么配：用户在「设置 → 模型」里自己加 2–4 家（`dsh-client-ui-settings-models/README.md:55-57`）。
- Host 侧新增只读能力：`listProviders()` → 逐家 `listModels()`/`resolveModelInfo()`（照 `dsh-api-session-controller/lib/index.js:500-548`），外加 `listConfigurableProviders()` 给「还没配」的家，再用 `settings.describe()`+`credentials.describe()` 判「已配 key」（照 `:573-588`）。
- 合参入参从 `profileIds: string[]` 升级为 `routes: {provider, model}[]`；judge 取「排除候选集」的第一家；缺异源判官 → 如实 `judge.mode='failed'`。
- 费用：确认页只报「N 家 / 每家 model / 每家输入规模（token）」+「金额未知」，除非编排显式传了价表。
- 风险：异源判官要求用户至少配了 N+1 家；catalog 只是 advisory，**「列出」≠「能用」**，必须叠加 key 检测。
- 验证成本：低——全部走 `ctx.llm`/`ctx.settings` 公开面；一台 DSH_HOME 配 2 家 + 1 个故意缺 key 的假 provider 即可覆盖三态。

### 路径 B（补设置面）：玄枢自带「合参路由配置」+ 可选价表

- 在路径 A 之上，加一份 `storages/*.json` 里的合参配置（哪几家参与、judge 指定哪家），客户端加选择器（provider 多选 + 每路 model 下拉），数据即 A 的清单 RPC。
- 再存一张**可选**价表（`<provider>/<model>` → `inputPerMTok/outputPerMTok`，`bestof-run.mjs:352-366` 已按此形状写好），跑前确认显示估算金额并标「估算，来源=配置」。
- 风险：价表必然腐烂（各家改价无人通知），各家计价口径不同（缓存命中价、图像 token）；界面上出现金额就会被当账单读。缓解：金额只在「价表命中且 usage 完整」时显示（`bestof-run.mjs:352-358` 已有该门槛）。
- 验证成本：中——多一层 UI + 配置 schema + 快照测试。

### 路径 C（不推荐）：自建 provider 池，绕过 pi-ai

- `registerAdapter` 是公开面（`dsh-llm/lib/types/index.d.ts:253`），玄枢理论上能自己起 adapter 直连各家 HTTP。
- 但会绕开 `ctx.credentials` / `apiKeyEnv` 每请求解析，以及「模型可见即已记录」的一致性——与 ADR-0010 拒绝「直接打 provider HTTP JSON mode」同一条理由（`docs/adr/0010-judge-without-structured-output.md:5`）。
- 验证成本：高（每家一套 wire 适配 + 凭据 + 图像投影），收益仅是「不依赖用户的设置页」。

---

## 仍未确认

1. **`ctx.settings` 在 xuanshu 运行时是否真在场**：它 `static inject = ["configEditor","profileContext"]`（`dsh-settings/lib/index.js:324`），而 `settings` 行在 base 里是 `disabled: !!js "!ctx.get('profileContext')"`（`dsh-base/cordis.patch.yml:101-103`）。本 profile 由 profile 启动，推断两者都在，但**未在运行时 dump 过**。
2. **xuanshu 运行时 `llm.listProviders()` 的实际返回集合**：按 bundle 推断至少 `deepseek-official`、`deepseek-account`（pi-ai 零路由，因 xuanshu 的 `cordis.patch.yml` 里没有 `llm-pi-ai:` 段），**未实测**。
3. **`listProviders()` 是否包含「没有 key 的家」**：pi-ai 的 directory 声明所有可认证 catalog provider（`dsh-llm-pi-ai/README.md:155`），但「已声明」≠「已注册路由」；这条边界只有实跑能钉死，直接影响界面措辞。
4. **裸 `ctx.llm.stream()` 下 `providerRetryAfterMs` 有无实际用处**：字段存在（`dsh-llm/lib/types/types.d.ts:33-34`），但 retry 只挂 loop（`dsh-llm-retry/lib/index.js:175`）；玄枢若自建退避要自己读它——未验证各家 adapter 是否真的填。
5. **上游是否存在任何金额通道**（DeepSeek 账户余额/账单）：`dsh-deepseek-llm-api-extensions` 全包 grep `balance|usage|quota` 零命中；`deepseek-account-platform` 的 grant 是否带用量接口未查。若都没有，金额只能靠玄枢自备价表。
6. **pi-ai 里哪些 provider 自带 login（可免 key）的完整名单**：README 只说「a provider pi-ai ships a login for」，未逐条列出；这决定「用户零配置能加几家」。
7. **`profileIds` 现语义是否已被下游/用例锁定**（`bestof.mjs:83-105` 之外还有谁写这个字段）：本轮只扫了 `lib/consult/`，未查 `packages/xuanshu-client` 与用例；改入参形状前需再确认一次。
