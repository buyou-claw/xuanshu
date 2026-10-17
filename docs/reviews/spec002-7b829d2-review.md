# Spec 002 全量复核与打磨

日期：2026-10-17。固定点 `09951eb5ad2e49edcc1b74cfb35e99d2ed9ceebe`，
审查对象 `7b829d28b0db4ed90968a19511448051d2d30e56`（Spec 002 合入 main 后）。
差分命令：`git diff 09951eb...7b829d2`；提交清单：`git log 09951eb..7b829d2 --oneline`。
修复分支：`codex/spec002-review-polish`。以下缺陷位置均指原审查对象；当前修复不抹掉原始结论。

按 `code-review` 的两个独立上下文审查：Standards 和 Spec 分别保留发现，不跨轴排序。
来源为 AGENTS、`docs/agents/review-checklist.md`、CONTEXT、开发台账、相关 ADR、
Spec 002、父票 #21 与冻结契约。旧审查已修项及已登记的真机证据缺口不重复计为代码缺陷。

## Standards

原始结论：2 项硬违规，无另外需要行动的气味判断项；本轮均已修复。

1. **[P1] 事记读失败被当成空账，重写丢掉历史与墓碑。**
   `shiji/store.mjs:113–118` 把 EACCES 等错误也返回空数组；扫描随后整账重写。
   违反 ADR-0013 的“项目消失后条目冻结”与“删除即写入排除表，之后不再自动生成”。
   独立探针预置墓碑和冻结条目，仅令首次读取瞬时失败：墓碑复活、冻结条目消失，且无错误说明。
   **修复**：只有 ENOENT 为空账；其余错误带路径和错误码，阻止写入。
   用例：`tests/shiji/ledger.test.mjs`、`store.test.mjs`，含扫描开始与提交前读失败。

2. **[P2] 晚省读不存在的 header.lastPromptAt，假夹具掩盖续问漏报。**
   `wansheng/facts.mjs:134–140`；旧夹具也把该字段塞进 header。
   钉版真实字段为 `sessionProjectionCache.values.sessionListMetadata.lastPromptAt`；
   上游 `dsh-api-session-controller/lib/index.js:2041` 用它与 header.createdAt 计算活动时间。
   违反复核清单第 2 条“夹具必须编码正确域字段”。昨天创建、今天续问的项目原本漏报。
   **修复**：读真实投影，缺失时回落人的提问日志；核不了时省略该路并给原因。
   用例：`tests/wansheng/facts.test.mjs`；先纠正夹具证红，再修实现。

标准轴共 2 项，最严重为读错后重写事记造成数据损失；修复后相关回归通过。

## Spec

原始独立报告 5 项，主代理补充备份凭据和路径边界 2 项；合计 7 项，本轮均已修复。

1. **[P1] 事记扫描跨 await 覆盖已成功的人操作。**
   规格要求“删除写 excludedAt（墓碑），之后不再自动生成”，用户故事 16 要求保存当天事记。
   `shiji/ledger.mjs:182–241` 从旧快照扫描、等待摘要、整账覆盖，期间的删除、恢复、人工保存会丢失。
   **修复**：同数据目录的扫描串行；提交前同步重读并保留期间的人操作和新条目。
   用例：`tests/shiji/ledger.test.mjs`，含删除/保存、恢复、重叠扫描与失败释放。

2. **[P1] 备份截断或源读取失败仍报完整成功。**
   规格要求“备份包含业务数据与会话记录”；`data/backup.mjs:184–198` 原本忽略 walkFiles.capped。
   两文件、文件上限为一的反例返回成功且缺一文件；源目录 EACCES 也会被当空目录。
   **修复**：达到上限或源读取失败时拒绝备份并说明路径，不留下本次备份目录；
   概览可以部分统计，但 notes 必须说明未核对部分未知。
   用例：`tests/data/backup.test.mjs`、`read-failure.test.mjs`。

3. **[P2] 判官无超时与取消信号，迟到结果覆盖停止状态。**
   规格要求“每路独立 AbortSignal（含超时）”，沿用“停止全部”。
   `consult/bestof.mjs:600,637–710` 的判官没有信号；候选完成后仍可无限等待，停止后迟到判定又改成 tool。
   **修复**：判官路由查找和流式调用都限时，传递独立信号；超时回落完成顺序，取消后不回填排序和 usage。
   用例：`tests/consult/bestof-judge-source.test.mjs`，含忽略 abort 的适配器及冷读对照。

4. **[P2] 日课 AI 没有读底稿“最近”的正文。**
   规格要求“读底座谱 + 底稿‘最近’ + 当日骨架”；`rikke/ai-note.mjs:66–76` 只喂时间、段数、模式。
   **修复**：按底稿的真实两段边界读取近期正文，限制长度，保留来源标记；不带过去事记或混合摘要。
   缺正文如实说明。用例：`tests/rikke/ai-note.test.mjs`，断真实近况进入 prompt、过去内容不进入。

5. **[P2] 晚省完全没有工作流活动。**
   规格要求“当天有活动的工作区/工作流”；`wansheng/facts.mjs:192–211` 与客户端仅有工作区一路。
   **修复**：追加 activeWorkflows，读本地工作流清单和真实会话活动，创建/导出时间也可核对；
   卡上只显示「今天 N 个工作流有活动」的计数；名称、会话数、活动时间在晚省面板里列（卡不重复名称）。
   坏清单或读错表示未知，合法空清单才为零。
   用例：`tests/wansheng/facts.test.mjs`、`generate.test.mjs`、
   `tests/assembly/wansheng-panel.test.mjs`（含真实注册入口 → RPC 数据注入）。

6. **[P2] 备份收入当前壳的通知凭据，并漏过 Windows 文件名大小写变体。**
   规格要求“不包含 .credentials.yaml 与任何密钥引用”。
   `data/backup.mjs:170–179` 未排除 runtime；`data/plan.mjs:128` 仅逐字比较凭据名。
   实证：shell-notify.json 的 token 原样进入备份；dataDir=home 时，Win32 的 .CREDENTIALS.YAML 也被复制。
   **修复**：runtime 凭据/进程状态整组排除，概览和清单说明原因；凭据与排除目录名按平台大小写语义判断。
   用例：`tests/data/backup.test.mjs`，同时检查复制文件、清单与概览。

7. **[P2] 备份目标路径门可被目录联接和外置 dataDir 绕过。**
   冻结备份契约要求“不能等于/位于 home 之内（防递归）”；`data/backup.mjs:134` 只有词法包含判断。
   目标为指向 home 内的 junction 时仍成功；独立覆盖 dataDir 后也可把备份放在数据目录内，后续收入旧备份。
   **修复**：核对目标、home、dataDir 的真实位置，拒绝两种递归位置。
   用例：`tests/data/backup.test.mjs`，同时断拒绝后目标目录为空。

规格轴共 7 项，最严重为人工确认的删除/保存被扫描覆盖与不完整备份；修复后相关回归通过。

## 验证与适用边界

修复先用临时目录、可控 LLM/文件错误和真实钉版数据形状构造反例；未放宽 knownRed。
主代理复跑受影响测试、重建客户端，并通过 `install-profile --home .dsh-home --skip-install` 同步运行副本。
最终全仓用例与装配结果见 `docs/development-status.md` §16.8；数字以工具最终输出为准。

事记队列与写前合并保证同一宿主进程内的顺序，不提供跨进程文件锁；两个进程共用同一 dataDir 的边界仍在。
备份遇到源目录规模上限现在明确失败，用户需要检查目录规模；不会静默输出部分副本。
未逐行穷尽所有改动，也未把模块回归当作真机验收：真实 Electron 窗口/托盘/toast/自启、
真实多家 provider 与真实浏览器点击链仍按 §16.5 的登记边界处理。
