# 会话分类与插件数据：自铸 sessionId 前缀 + 专用 cwd + 旁挂文件

Spec 001 的实现决策里写着「问事容器：新 main key `consult` 面板 + `ctx.sessions.create`（`meta.xuanshu={kind:'consult', pus:[…], mounts:[…]}`）」，票 10 / 12 / 15 的交付都建在这条上：给会话打「这是问事、这次用了哪些谱、挂了什么」的标记，并且历史回看要能按这个标记筛出来。

钉死的 `0.2.0-rc.2` 让这条**做不到**，而且是静默做不到：

- **`meta` 是闭集 7 字段，且实现是逐字段挑的**：`dsh-session/lib/index.js:1699-1709` 构造 header 时只挑 `cwd` / `parentSession` / `createdAt` / `isSeeded` / `origin` / `delegationDepth` / `agentPreset`；`meta` 从未被展开 → **额外键不报错、不入 header、写不进日志、读不回来**。类型层同样（`dsh-session/lib/types/types.d.ts:114-122`），磁盘 header 行也只有这 7 个（`dsh-session-persistence-jsonl/lib/types/format.d.ts:42-53`）。这条由 Lead 2026-10-15 独立复核过。
- **`agentPreset` 是这 7 个里唯一的自由字符串，但不能当标签用**：它的语义被 preset registry 占用——`dsh-api-session-controller/lib/index.js:358-371` 会拿它 `presets.resolve()/mount()`，assemble 时 `assertPresetUnchanged`（`:479-482`）会因不匹配而抛冲突。
- **「新增一个自定义会话事件类型来存这些」是死路**：`Session.append()` 无法写入 `ignorable`（`dsh-session/lib/index.js:1453-1459` 的信封只有 `{type,seq,time,data,…surfaceMetadata}`），而读侧拒绝未知且非 ignorable 的事件 —— `dsh-session-format-v3-to-v4/lib/index.js:989` 直接抛 `SessionFormatUnsupportedMigrationError`，**会话从此打不开**。`KNOWN_SESSION_EVENT_TYPES` 是仓内生成脚本产出的表（`dsh-session/lib/types/known-event-types.d.ts:7-21`），仓外插件天然不在表里。DSH 自带规范把这条写成明文禁令：`dsh-agent-preset/skills/cordis-plugin-development/references/practices.md:21`。
- **也筛不了**：`SessionResultFilter` 只支持 `id | cwd | created-at | parent | availability`（`dsh-session-query/lib/types/types.d.ts:170-184`），没有任何 header 扩展字段过滤。

**决定：会话分类不靠 `meta`、不靠自定义事件，而靠三个各自有独立理由的载体——① 玄枢自铸的 sessionId 前缀；② 专用 cwd（不是 workspace）；③ 旁挂 JSON 文件；消息级来源标记用官方允许的 `MessageSourceMap` 合并点。**

具体定值：

1. **会话 id 由玄枢自铸**，形态 `session-xs-<kind>-<uuid>`：`session-xs-consult-…`（票 10）、`session-xs-rikke-…` / `session-xs-digao-…`（票 13 的日课与底稿定时会话）。依据：`SessionId` 是**未校验的 branded string**（`dsh-session/lib/index.js:1685` 只在 `prepare` 查重复；`dsh-session-persistence-jsonl/lib/types/format.d.ts:69-71` 明说 unvalidated），上层控制器铸的是 `session-<uuid>`（`dsh-api-session-controller/lib/index.js:688`），我们只是把 `<uuid>` 换成自己的前缀。字符只用 `[A-Za-z0-9._-]`（其它字符会被 `encodeSegment` 转义成 `~XXXX`，目录名会变得不可读）。
2. **归属用专用 cwd**：`<dataDir>/consult`（问事）。依据：`cwd` 是**唯一受支持的元数据过滤**（`filterSessions([{kind:'cwd', values:[…]}])`），且宿主会在建会话前 `mkdir -p`（`dsh-api-session-controller/lib/index.js:445-448`）。
3. **刻意不用 workspace 来归属**：`workspaceRegistry.create()` 要求目录已存在、会把会话 `attachSession` 进 `sessionIds`（`dsh-workspace/lib/types/types.d.ts:88-97`，且要求 `header.cwd` 的 realpath == `workspace.path`）。而产品约束是**「问事与工作区并列、不属于任何工作区」**——把问事会话挂进 workspace 列表正是这条约束要防的事。用 cwd 拿到同样的筛选能力，却不产生归属。
4. **`pus` / `mounts` 清单落旁挂文件**：`<dataDir>/consult/<sessionId>.json`，schema `xuanshu/consult@1`，含 `{ schema, sessionId, kind:'consult', pus:[…], mounts:[…], createdAt }`。依据：DSH 规范建议插件自有数据放自己的存储（`references/practices.md:21`），而玄枢的数据目录本来就是「一切数据本地、可整体拷走」的契约面（C11）。
5. **消息级来源标记**用自定义 `MessageSourceMap` kind（`xuanshu-consult`）：`MessageSourceMap` 是**显式 merge-extensible** 的合并点（`dsh-llm/lib/types/message.d.ts:95-108`，注释原文：each producer declares its own `kind`，没有共享的 catch-all `plugin` kind），user 消息可携带任意 producer 的 kind，消费方对未知 kind 直接 fall through。运行期唯一的 source 校验只针对 system 消息（`dsh-session/lib/index.js:1206`）。
6. **禁止三件事**：往 `meta` 塞额外键（静默丢弃）；新增会话事件 `type`（会话打不开）；把 `agentPreset` 当自由标签（preset 语义 + `assertPresetUnchanged` 抛冲突）。
7. **本 ADR 同样约束票 11**：`message.candidates` 也不是 rc.2 的字段（`dsh-llm`/`dsh-session`/`dsh-agent` 的 `.d.ts` 全无 `candidates` 命中）——合参的 `bestOf{adoptedId,ranking,judge,costUsd}` 记录落旁挂文件，`costUsd` 从 `assistant/message` 事件的 `usage` 累计（`dsh-session/lib/types/types.d.ts` 的 `'assistant/message'` 带 `usage?: TokenUsage`）。

**Considered Options**：

- **照 spec 用 `meta.xuanshu`** —— 被否：这条不是「不合规范」，而是**静默失效**——代码写下去不报错、测试不给红、运行时读回来是 `undefined`。这类偏差最危险的地方在于它看起来是工作的，所以必须把「为什么不能用」写进 ADR 而不只是改代码。
- **拿 `agentPreset` 当自由标签**（它确实是 7 个里唯一的自由字符串）—— 被否：那会让会话去 `presets.resolve()` 一个不存在的 preset，而 `assertPresetUnchanged` 在恢复路径上会抛冲突；用一个有语义的字段当无词语义，等于给下一个读代码的人埋雷。
- **新增自定义会话事件 `xuanshu/consult`**（最"正统"的事件溯源做法）—— 被否：`append()` 写不了 `ignorable`，读侧拒绝未知非 ignorable 事件 → **会话直接打不开**。这不是性能或风格问题，是数据可用性问题，而且症状是「问过的事全部消失」。
- **用 `ctx.storageDomain.open()` 的 domain 而不是普通 JSON 文件** —— 保留为将来选项：`workspace.json` 是同构先例，domain 有版本与表结构。本版不用它的理由是本票只需要「一个会话一份清单」这种最简结构，而 `storageDomain` 的写入面与并发语义当时未核实（已列为待查）。若将来清单需要跨会话查询或迁移，再换成 domain，**换的时候旁挂 schema 版本号 `xuanshu/consult@1` 就是迁移锚点**。
- **把问事会话挂到 workspace 里，靠 workspace 筛** —— 被否：见上面第 3 条，它会破坏「问事与工作区并列、不属于任何工作区」这条产品约束；而且 `workspaceRegistry.create` 要求目录已存在、成员资格还要求 cwd 的 realpath 相等，多一层无收益的耦合。
- **自建一个 `$DSH_HOME/xuanshu/sessions.json` 索引**（一条记录一件事）—— 保留为票 10 的实现细节：与第 4 条的「一会话一文件」相比，索引便于列表排序与查询，但引入双写一致性问题。票 10 若需要列表页，**只在旁挂文件之上做只读聚合**，不引入第二份权威。

**Consequences**：

- **会话 id 形状成为契约的一部分**：`session-xs-consult-……` 前缀被断言钉住；改前缀等于改数据格式，要按数据迁移对待。
- **历史回看有两条来源，权威分开**：**旁挂清单**是「问过哪些事」的权威（含本次勾选的谱与挂载），**会话日志**是正文的权威（用 `ctx.sessionQuery.readSession(id)` 读，本机是 `session.v4.jsonl.zstd`，**不要自己解压**）。列表页 = 读旁挂目录，不要靠扫会话日志反推。
- **spec 的原文必须改掉**：`docs/specs/001-assembly-foundation.md` 的实现决策里 `meta.xuanshu={…}` 与 `message.candidates` 两处已改为指向本 ADR 与 ADR-0010。**不改 spec 只改代码，下一个照 spec 实现的人会再踩一次**——这正是本 ADR 存在的理由。
- **票 13 的定时会话同样受约束**：日课「今天是否已做过」不能靠会话事件类型（ADR 同款理由），也不能靠 `schedule` 服务（它只记 `lastDelivery`/`deliveryHistory`，没有「当日打卡」语义）——要自己存，载体同上。
- **消息级标记的能力边界被显式缩小**：自定义 `MessageSourceMap` kind 只解决「这条消息是谁注入的」，不解决「这个会话属于哪一类」。不要再指望一个字段干两件事。
