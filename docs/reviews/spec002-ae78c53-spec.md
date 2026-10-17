# Spec 002（`main...feat/spec-002-integration`，HEAD `ae78c53`）· 规格轴审查

> 审查轴：**Spec**（不是 Standards；两轴独立、不合并排序）。
> 固定点：`main` = `09951eb5ad2e49edcc1b74cfb35e99d2ed9ceebe`（`git merge-base main HEAD` 复核一致）。
> 审查 HEAD：`ae78c53`（41 提交，`git diff main...HEAD` = 225 文件 / +32964 附近）。
> 审查期间 HEAD 未变化（开工/收尾两次 `git rev-parse HEAD` 均为 `ae78c53`）。
> 规格来源按权威序：`docs/specs/002-reside-and-use.md` → `.scratch/spec002-tickets.md`（票 01–10）→ ADR-0013/0014/0009/0010/0012/0004/0001 → 两份 research → `docs/development-status.md` §16（含 16.5 已登记边界）→ 复核修复轮 `1aff99a`/`65b2b39`/`5185117` 的「12 项」**逐项落代码复核**。

---

## 0. 结论

**不通过（有条件）**。10 张票的主体实现质量高、契约夹测与「拿不到就省略键 / 不冒充未知 / 不静默」的纪律在代码里是真实存在的；但本轮仍有 **6 条发现**，其中 1 条直接让票 05 的验收项「恢复是设置里的显式动作」在界面上**实际不成立**。

| 类别 | 条数 |
|---|---|
| (a) 缺失 / 只做一半 | 3（其中 1 中、2 低） |
| (b) 范围蔓延 | 0（已逐项核对，见 §2） |
| (c) 做了但做错（含「声称修了其实只修一半」） | 3（高 1 / 中 1 / 低-中 1） |

最严重一条（C1）：**设置 → 事记的「已删除（可恢复）」筛的是 `frozenAt`（源头消失）而不是 `excludedAt`（墓碑字段）**，导致最常见的删除（源头还在、人只点删除）在设置里**看不到、无法恢复**；同时把「冻结」条目冒充成「已删除」。复核修复轮声称补上的 `P4 设置 → 事记（恢复墓碑）` 在真实删除路径上不生效，且用例替身与实现同错（历史教训「沙箱里全绿不算数」的又一个形状）。

改动方向明确、不涉及架构返工：C1 是客户端一个筛选字段 + 一处日期字段 + 一条用例夹具；C2 是把三处遗留兜底改成 `home.mjs` 的薄包装；C3 是把判官失败的 `mode` 改成 `failed`（或按契约新开一档）。A1/A2/A3 属于补素材/补证据/补可读状态，或如实登记进 §16.5。

---

## 1. (a) 缺失 / 只做一半

### A1（中）事记摘要的依据只有「会话标题」，缺规格点名的「会话摘要」那一半

- **规格/票面原文**
  - `docs/specs/002-reside-and-use.md:141`：「**摘要依据**：该工作区/工作流的**会话标题与摘要** + 项目目录里的说明文档（README / 需求 / 笔记等；目录白名单 + 用户可排除；**不读代码正文**）。摘要为目标 1–2 句、带 `basis` 计数。」
  - 用户故事 30（`:79`）：「每条事记标明依据（会话几场 · 文档几份）」（计数这一半成立）。
- **期望**：生成事记摘要的素材包含「会话摘要」这一路（或按本仓自己的可行性结论：会话没有现成摘要 API，应**由我们自己从标题 + 首问/事件正文生成**）。
- **实际**：工作区条目的 `material.sessionTitles` 只收集标题，`summaryPrompt()` 也只拼「会话标题 + 文档正文」：
  - `packages/xuanshu-host/lib/shiji/scan.mjs:214`（`const titles = counted.map(...title...)`）、`:225-234`（`material: { sessionTitles: titles, docs: [...] }`）；`collectSessionEvidence()` 对会话日志的唯一用途是算 `lastActiveMs`（`:119-133`），**从不保留正文/首问**。
  - `packages/xuanshu-host/lib/shiji/summary.mjs:71-83`：`summaryPrompt()` 只输出「项目名 / 依据计数 / 会话标题 / 文档段落」，没有会话内容。
- **可行性依据**：`docs/research/spec002-resident.md` 不涉；本仓自己的探路明确写过这件事：
  - `.scratch/notes/spec002/explore-shiji-digao.md:14`：「**但没有「会话摘要」这个东西**……Spec 002 说的「会话摘要」必须由我们**自己**从标题 + 首问 / 事件文本生成 —— 别去找 API」；
  - 同文件 `:174`：会话侧能取的只有 `session/title`、`titleInput`、`lastPromptAt`（无摘要）。
- **影响**：`basis` 计数仍然正确，但摘要的「忠实度」低于规格的素材口径；对「会话里发生过什么」只能靠标题推断。未在 `docs/development-status.md` §16.5 登记为边界。
- **测试盲区**：`tests/shiji/summary.test.mjs` 断言的是「素材含 title + 文档片段」（探路笔记 `:545` 也是这么写的），没有任何用例要求素材包含会话文本/首问；因此这项缺失在 1761 条绿色里不可见。

### A2（低）票 01「setup 在干净临时 home 上一条命令装好 + `dsh --profile xuanshu --help` 可启动」没有本轮证据，且未登记

- **票面原文**：`.scratch/spec002-tickets.md:19`「setup 在干净临时 home 上一条命令装好，`dsh --profile xuanshu --help` 可启动」。
- **实际覆盖**：
  - `tests/setup/setup-cli.test.mjs:52` 的 sandbox 参数**始终显式** `--dsh-home sandbox.home`；全仓 `tests/**` 搜不到 `resolveSetupPaths` 的调用点（0 命中）⇒ **setup 的「默认档（dev/product）」没有任何用例**，只靠它委托的 `resolveHomeWithSource()` 被间接覆盖。
  - `dsh --profile xuanshu --help` 的「可启动」有隔离台既有证据（`tests/isolation/dual-instance.test.mjs` 真跑启动器 → 临时 home 里 spawn CLI `--help`），但那是**启动器**路径，不是「setup 装完 → 直接 dsh --help」这条票面链路。
- **登记状态**：§16.5 只登记了「桌面壳/真 provider/真浏览器 …」，本条未登记。按本轴规则，未真机验收项**如实登记即可接受**；未登记且无证据则算 partial。

### A3（低）「权限缺失」不是可读的独立状态，只是 `failed` + 原始英文 reason 串

- **规格原文**：`docs/specs/002-reside-and-use.md:130`「未读：**壳把通知投递结果回报给宿主（成功/失败/权限缺失）**，宿主落一张触达账；界面据此显示未读标记与失败原因。」票 04 AC（`.scratch/spec002-tickets.md:93`）也点名「成功 / 失败 / 未读 / **权限缺失**可查」。
- **实际**：
  - 契约把状态收成三值 `delivered | failed | skipped`（`packages/xuanshu-host/lib/notify/contract.mjs:42-43`），权限缺失被折进 `failed`，原因串是壳侧的英文 token `permission-denied`（`packages/xuanshu-host/lib/notify/touch.mjs:57-59` 抬头是「桌面壳没有弹出通知：permission-denied」）。
  - 界面直接把原始 reason 串渲染出来（`packages/xuanshu-client/src/client/notify.tsx:88-90`；`wansheng.tsx` 同理），没有本地化成「权限缺失（系统通知权限被关）」这一类可辨认文案；用例也**断言原始英文串**（`tests/assembly/wansheng-panel.test.mjs:159`、`tests/assembly/rikke-panel.test.mjs:418-423`、`tests/wansheng/service.test.mjs:113`）。
- **判断**：`spec:130` 把「权限缺失」与「失败」并列，落成 `failed + reason` 属于契约层对规格的**降格**（`.scratch/notes/spec002/contract-shell-notify.md:85` 也只写「设置里打开摘要」）。「可查」在技术上成立（账行里查得到），但用户/界面看到的是英文码，不是「权限缺失」。作为低严重度判断项报出，建议至少在客户端把常见 reason 映射成人话（或按契约在账上加 `permission-missing` 之类可读状态）。

---

## 2. (b) 范围蔓延

**0 条实质蔓延**。逐项核对过容易越界的地方，均能追到规格/票面：

- 新依赖只有 `electron@38.2.2`（`packages/xuanshu-shell/package.json`；规格 `:203` 明示新增 Electron 运行时，仅壳用）；`pnpm-workspace.yaml` 只放行 electron 的 build 脚本。
- 新增 RPC 方法组全部逐条可追：`routes.list`（票 07 AC1/规格 `:150`）、`bestof.estimate`（票 07 AC4/规格 `:153`）、`shiji.*`（票 05/06）、`wansheng.*`/`traffic.*`/`shell.settings.*`/`rikke.settings.*`（票 03/04/02/08 的设置面）、`data.overview/data.backup`（票 09/规格 `:160`）；没有规格没要求的价表、自动重试、预扣费、playwright/e2e（规格 `Out of Scope` `:195`、Testing Decisions `:177` 明确禁止）。
- 新设置项四组（AI 建议段 / 通知摘要 / 关窗行为 / 开机自启 / 两个时刻 / 事记排除目录）全部对应票面验收（票 03、04、02、05）。
- 新文件族（`lib/notify/**`、`lib/shiji/**`、`lib/data/**`、`lib/wansheng/**`、`xuanshu-shell/**`、`lib/home.mjs`）都是交付面本身，不是顺手扩张；`atomic.mjs`、`llm/text.mjs` 是消除重复的实现层收口。
- 两处**判断项**（不报为蔓延）：`data.overview` 把规格 `:160` 的 6 个点名品类扩成 8 组（+`storages`、`skills`，`:16.1` 已如实登记为 8 组）；`docs/runbook/shell.md` 是壳的手测清单（票 02 需要「如实显示/手测」，属交付物）。

---

## 3. (c) 做了但做错

### C1（高）设置 → 事记「已删除（可恢复）」用错字段：真实墓碑看不到，「冻结」条目被冒充成「已删除」——票 05 AC「恢复是设置里的显式动作」在 UI 上不成立

- **规格/票面原文**
  - `docs/specs/002-reside-and-use.md:143`：「**删除效力**：删除写 `excludedAt`（墓碑），之后**不再自动生成**同 `source+refId` 条目；**恢复为设置里的显式动作**。」
  - 票 05 AC（`.scratch/spec002-tickets.md:118`）：「删除写墓碑，之后不再自动生成同一条；**恢复是设置里的显式动作**」。
  - 复核修复轮声称已补：`docs/development-status.md:700-703`「`设置 → 事记`（恢复墓碑 / 排除目录）」、`:727-738` 的 P4。
- **宿主语义（正确）**：删除只写 `excludedAt`（`packages/xuanshu-host/lib/shiji/ledger.mjs:86-95`），恢复只清 `excludedAt`（`:101-110`）；`frozenAt` 是**另一件事**（源头消失，`:233-239`）；`listShiji({includeDeleted:true})` 才返回墓碑（`:61-66`）。
- **客户端实现（错）**：
  - `packages/xuanshu-client/src/client/shiji-views.tsx:330`：`tombstones: [...].filter((entry) => entry.frozenAt !== null && entry.frozenAt !== undefined)` —— 筛的是**冻结**字段。
  - `:247`：`删除于 ${dayOf(entry.frozenAt)}` —— 把冻结时刻当删除时刻显示。
  - `:181`、`:194` 的注释同样把「墓碑」定义成「`frozenAt` 非空」，概念已写反。
- **后果（真实用户路径）**：
  1. 正常删除（源头还在、只点 [删除]）⇒ 条目只有 `excludedAt`、`frozenAt=null` ⇒ **不出现在「已删除（可恢复）」**里，设置页**无法恢复**（只能敲 RPC `shiji.restore`）。
  2. 源目录被删/工作区消失（`frozenAt` 非空、没被删除）⇒ **反而被列成「已删除」**并给 [恢复]；点下去 `restoreShijiEntry()` 命中「没删过：幂等」（`ledger.mjs:105`）返回 ok，界面提示「已恢复这条事记：下一轮扫描会按在场源头重新出现」——**一句没发生的事**。
- **测试盲区（替身与实现同错）**：`tests/assembly/shiji-settings.test.mjs:34-45` 的 `TOMBSTONE` 夹具只有 `frozenAt`、**没有 `excludedAt`**，注释写「一条被删掉（墓碑）的事记」；`:115` 断言「墓碑逐条列出」用的就是它。也就是说：**用例把「冻结」当「墓碑」钉住了**，所以 `pnpm vitest` 全绿也发现不了这条。这正是本仓历史教训（测试替身与被测实现同错）的又一个形状。
- **修复面**：`shiji-views.tsx` 的筛选与日期字段（`excludedAt`，缺省回落到「日期未知」）+ 夹具补 `excludedAt`/`frozenAt` 两种情形各一条用例；底稿面板 `digao.tsx` 的删除/文案不动。

### C2（中）「宿主 home / dataDir 只剩一份实现」只做了一半：`cang` 与 `horosa` 仍各有一份无 `~/.dsh` 门的解析

- **约束原文**：`docs/development-status.md:737-738`（§16.2）「宿主 home/dataDir 解析**只剩一份实现**（`lib/home.mjs`；`bazi/service.mjs` 只是同一函数对象的再导出）；事记/工作流的 skill 扫描根也走 `resolveSearchHome()`」；复核修复轮 S1/S2 的立论（`tests/lib/home-single-source.test.mjs:1-20`）正是「第 5 份 home 解析 + 绕过 ADR-0014 门」。
- **实际仍在的三处**（都不经 `pointsAtRealDshHome`）：
  - `packages/xuanshu-host/lib/cang/service.mjs:39-43`：`config.dataDir ?? join(profile?.home ?? process.env.DSH_HOME ?? fallbackXuanshuHome(...).home, 'xuanshu')` —— 把 `profileContext.home` / `$DSH_HOME` 原样拼进 dataDir，未判真实 home。
  - `packages/xuanshu-host/lib/horosa/service.mjs:211-216`：`profileContext.home → $DSH_HOME → undefined`，原样透传。
  - `packages/xuanshu-host/lib/horosa/paths.mjs:85-89`：`home = dshHome || $DSH_HOME || fallback`，再 `join(home,'xuanshu','horosa')`。
- **生产路径目前安全**：`lib/index.js:566-580` 的 `planWriteTarget()`/`plan.blocked` 落点门会先收工，`installHorosa`/`createCangMethods` 都在这道门之后（`index.js:582-622`）。但这是**调用点**的安全，不是解析唯一性的安全：任何不传 `config.dataDir` 的调用方（测试、将来的嵌入方、新方法组）都会重新走到无门的兜底——这正是 S1 当初被抓的同一形状。
- **测试盲区**：`tests/lib/home-single-source.test.mjs` 只比对 `bazi` 再导出同一函数对象 + `workflow`/`shiji` 两个薄包装；**没有覆盖 `cang`/`horosa`**。§16.2 的「只剩一份实现」是登记承诺，与代码不符。

### C3（低-中）判官调用失败被记成 `mode:'tool'`，与 `mode` 的冻结语义和 spec:152 的 `failed` 不一致

- **规格原文**：`docs/specs/002-reside-and-use.md:152`：「**判官**：judge 路由必须**不在候选 provider 集合里**；找不到异源时如实标记 `judge.mode='same-source'|'failed'`，**不冒充异源**」；用户故事 39（`:91`）「没有异源判官时它如实说「本轮判官同源 / 判官失败」」。
- **实际**：判官调用抛错 / 失败 finish 两条路径都写 `mode:'tool'`（`packages/xuanshu-host/lib/consult/bestof.mjs:654-663` 与 `:668-678`），只有「模型没调工具、正文也没 JSON」才走 `mode:'failed'`（`packages/xuanshu-host/lib/consult/bestof-run.mjs:271-279`）。而 `mode` 的公开语义是「这次判定是**怎么来的**」，`tool` = 工具调用（`packages/xuanshu-client/src/client/bestof-api.ts:32-40`）——一次根本没成功的调用被记成「走了工具判定」。
- **UI 没有冒充异源**：`judge.error` 非空 ⇒ 客户端显示「判官（本次未给出有效排序）」并给失败原因（`bestof-views.tsx:313-329`、`bestof-model.ts:222-239`）。但机器可读记录（`bestof.state` 落盘记录）与契约语义不符，`failed` 档实际只覆盖了很窄的一种情况。
- **测试盲区**：`tests/consult/bestof-judge-source.test.mjs:119-127` 只断言 `source/provider/error`，**不断言 `mode`**；因此这条不一致在 4 条判官用例里全绿。

---

## 4. 10 张票验收标准逐票核对

> 只核「本轮 diff 是否满足票面验收」，不做标准轴。证据列给 file:line 或用例路径；未跑全量的地方如实标注。

| 票 | 结论 | 逐条核对（✓/partial/✗ + 证据） |
|---|---|---|
| 01 独立 home | **partial** | ①写入面全在该 home：`resolveInstance` 派生路径 + `verify-isolation.mjs` 的 `ISOLATED_PATH_KEYS`/`home-isolated` evidence（`scripts/verify-isolation.mjs:449-479, 617-673`）✓；②会红的对照：`tests/isolation/home.test.mjs:162-179`（`XUANSHU_DSH_HOME=~/.dsh` → exit 1、无 instance）+ `:96-107`（默认值现算）✓；③`verify:isolation` 加 home 断言 ✓（`defaultHomeIsNotReal`，`:622-654`；**未亲自跑**，§16.3 记 8/8）；④setup 干净临时 home + `dsh --help`：**partial，见 A2**；⑤runbook：`docs/runbook/home.md`（home 位置/换/迁移/为什么互不影响）✓。另：宿主拒绝写真实 home 有实现与用例（`lib/index.js:560-580`、`tests/isolation/home.test.mjs:333-395`）✓，但**解析唯一性只做一半（C2）**。 |
| 02 桌面壳 | **✓（模块层，已登记）** | 单实例（`shell/single-instance.mjs` + `tests/shell/single-instance.test.mjs`）、托盘打开/退出（`desktop-behavior.mjs:110-131` + `close-tray.test.mjs`）、关窗默认隐藏 + 一次性说明（`desktop-behavior.mjs:44-75`）、真退出先停子进程再退壳（`supervisor.mjs:273-313`、`main.mjs` quit 路径、`tests/shell/supervisor.test.mjs`）、自启如实显示实际方式（`autostart.mjs:91-150` + `status.mjs` + 设置页 `notify.tsx:262-291`）、子进程看护/重启/看门狗（`supervisor.mjs` + `watchdog.mjs`）、无真实窗口可单测（14 个纯模块 + 唯一 `electron-adapter.mjs`）✓。「真窗口/托盘/toast 未真机」按 §16.5 `:792-794` **如实登记接受**。 |
| 03 早间触达 | **✓** | 到点生成 + 推送（`rikke/delivery.mjs:124-160` 的 `runTouchChain`/`deliverRikkeTouch`；窗口关着不影响——生成在宿主、通知走回环）✓；AI 三态（`rikke/generate.mjs:78-140`、`ai-note.mjs:118-145`；`tests/rikke/ai-note.test.mjs`、`tests/rikke/morning-touch.test.mjs`）✓；通知默认不露内容/开摘要带泛化短句（`rikke/touch.mjs:38-50`、`tests/rikke/morning-touch.test.mjs:192-210`）✓；失败如实落账不阻塞产物（`notify/touch.mjs:73-102`、`tests/rikke/morning-touch.test.mjs:253-270`）✓；两侧夹测契约（`tests/shell/contract-parity.test.mjs`、`tests/notify/send.test.mjs`）✓；不引入 GUI 自动化 ✓。点通知停 overview：`main-flow.mjs:137-165` + 客户端 `overview-hash.ts` + `tests/assembly/overview-hash.test.mjs`（尽力而为语义与规格 `:202` 一致）✓。 |
| 04 晚间触达 | **✓（A3 为低严重度例外）** | 晚省零模型调用：`wansheng/generate.mjs` 全文件无 `ctx.llm`，`facts.mjs` 只读文件/服务，`tests/wansheng/facts.test.mjs`/`generate.test.mjs` 断言调用数 0 ✓；补课与「不重复/不补两次」：`rikke/missed.mjs:81-102`（产物 + 账双判据、7 天窗口、幂等）+ `tests/rikke/missed.test.mjs:298` ✓；`missed:true` 与 occurrence 日期修复：`rikke/occurrence.mjs`、`delivery.mjs:96-110`、`tests/rikke/touch-runner.test.mjs` ✓；时刻可调且即生效：`wansheng.setTime`/`rikke.setTime` → `schedule.update` + 设置同步（`tests/wansheng/schedule.test.mjs:110-134`）✓；触达账与投递历史：`notify/traffic.mjs` + `notify.tsx:54-132` + `wansheng.tsx:310-315` ✓。**权限缺失可读性见 A3（partial）**。 |
| 05 事记账本 | **partial** | 账本/一项目一条/冻结/墓碑/指纹重算/不读代码正文/白名单+排除/四路来源之一/注入桩：`lib/shiji/{store,scan,ledger,summary,docs}.mjs` + `tests/shiji/**` 逐项有据 ✓（`docs.mjs:20-23` 扩展名白名单就是「不读代码正文」判据；`ledger.mjs:196-226` 墓碑优先 + 指纹门；`tests/shiji/ledger.test.mjs`/`docs.test.mjs`）；工作流来源＝导出过 skill 才收（`scan.mjs:243-298`）✓。**✗ 删除后的「恢复」在设置 UI 不生效（C1）**；**A1 摘要素材缺会话摘要（partial）**。 |
| 06 底稿两段 | **✓** | 两段结构 + 四路来源标记：`digao/skeleton.mjs`（`DIGAO_SECTIONS`、`buildPastSegments`、`shijiRecordLine`；`renderDigaoMarkdown` 生成 `## 最近在做什么`/`## 曾经做过什么`）+ `tests/digao/skeleton.test.mjs` ✓；纯派生无写入口：`digao/service.mjs` 方法面未加写方法（复核 `tests/digao/service.test.mjs` 仍全量钉方法名）✓；事记按 lastActiveAt 倒序 + 日期区间 + 依据（`skeleton.mjs:110-125`、`ledger.mjs:49-54`）✓；删除动作在条目上（`digao.tsx` 事记 [删除] + `shiji-api.remove`）✓；会话内「存成今天的事记」点了才写（`shiji-api.ts` 硬编码 `confirmed:true`、`shiji-views.tsx:73`；宿主 `service.mjs:47-51` 拒无 confirmed）✓；同一扫描管线：`digao/generate.mjs:45-70` 内 `scanAndUpdateShiji()` → `listShiji()` → 渲染，无第二条扫描路径 ✓；旧断言不回归（`tests/digao/*`、`tests/assembly/digao-panel.test.mjs` 36 条）✓。 |
| 07 多家合参 | **✓（C3 为低-中例外）** | 路由清单只读三态 + 未注册可配置 + 默认未知 `null`：`consult/routes.mjs` + `tests/consult/bestof-routes.test.mjs`/`bestof-catalog.test.mjs` ✓；`routes` 入参 2–4、`provider::model` 去重、缺 model 回落首家首模型：`bestof.mjs:118-190` + `bestof-multiprovider.test.mjs` ✓；异源判官/两种降级：`bestof.mjs:612-648` + `tests/consult/bestof-judge-source.test.mjs` ✓（**失败路径 mode 记账见 C3**）；`estimate` 金额恒 unknown + 人确认（`confirm!==true` → `needs-confirmation`）：`bestof.mjs:717-735, 797-799` + `bestof-estimate.test.mjs` ✓；并发上限 4 + 每路独立 abort/超时 + 单路失败隔离：`bestof.mjs:52, 287-290, 447-478, 524-577` + `bestof-concurrency.test.mjs` ✓；三闸/按轮账本/候选历史只带采用稿口径不变：`bestof-store.mjs` + `tests/consult/bestof-adopt.test.mjs`/`history.test.mjs` ✓；零配置写入：`routes.mjs` 全文件无写方法 ✓。 |
| 08 接上 AI | **✓** | 状态面 `configured/providers/defaultModel/reason`（含 `unknown` 三态）：`ai-model.ts:192-243` + `tests/assembly/ai-readiness-model.test.mjs`（15 条）✓；只读（唯一 I/O `routes.list`）：`ai-api.ts` + `ai-model.ts` 无写路径 ✓；冷启动第 6 步可完成/可跳过、跳过时入口仍禁用：`onboarding-steps.tsx`、`tests/assembly/onboarding-wizard.test.mjs`、`cards.tsx:761-781`（`consultDisabled = ... aiState==='missing'`）✓；配好后 5s 轮询自动解除、无需重启：`ai-model.ts:314-393` + `ai-readiness-controller.test.mjs`（8 条）✓；「一键跳到设置 → 模型」只到逐字路径 + 有真 handler 才渲染按钮：`ai-views.tsx:79-97`，与 §16.5 `:806-809` 登记一致 ✓。**判断项**：票面写「向导**第二步**」，实装是八字五步之后的第 6/6 步；阶段顺序符合规格 `:135`「八字 → 接上 AI → 就绪」，不报为错。 |
| 09 我的数据 | **✓** | 分类体积可读（8 组，`.credentials.yaml` 永不计、不跟随联）：`data/plan.mjs`、`data/overview.mjs` + `tests/data/overview.test.mjs`/`assembly/data-panel.test.mjs` ✓；备份到自选目录（复用 `cang.pickDirectory`）：`data/backup.mjs:109-150` + `data.tsx:212-269` ✓；清单每文件 sha256 + size、复制后重摘要不一致即整体失败并清理：`backup.mjs:222-280` + `tests/data/backup.test.mjs` ✓；**不含** `.credentials.yaml`/密钥、页面写原因与迁移方法：`plan.mjs:31`、`backup.mjs:169-220`、`data.tsx:188-205`、`runbook/home.md §4.3` ✓；恢复逐项说明 + 不自动覆盖：`data.tsx:198-205`、`runbook/home.md §4.4` ✓；不阻塞界面 + 失败可读：`data.tsx` busy/stage/error、RPC 异步 ✓。 |
| 10 两处遗留缺陷 | **✓** | 回看按轮当前采用稿、否决轮不当当前：`consult/service.mjs:44-64, 320-330`（加性 `drafts`）、`bestof-store.mjs:150-205`（账本唯一推导入 `currentAdoptedMessageIds`/`adoptedDraftRounds`、rejected 轮不记 current）+ `tests/assembly/consult-views.test.mjs`/`bestof-adopt.test.mjs` ✓；工作流挂载注入已导出 `SKILL.md`、未导出如实说「还没有导出过 skill」、导出后被删另说：`mounts/content.mjs:194-320`（`readWorkflowLayer` 四步判据 + `isSkillName` 防路径穿越 + `c78c05c`）+ `tests/consult/mounts-content.test.mjs`/`mounts-preview.test.mjs` ✓；预算/披露口径零改动：`clip.mjs`/`context.mjs` 未改、`mounts-clip.test.mjs`/`mounts-inject.test.mjs` 17 条仍绿（本轮未跑，按列表面）✓；「会红的对照」两处均以「改前行为」为反例钉在用例里（`mounts-content.test.mjs` 的「不再返回 hint 空层」、`consult-views` 的「无 drafts 键/旧全场一份」）✓。 |

**横切**：零 DSH 源码改动 ✓（diff 只动自有包 / `scripts/` / `profile/README.md` / docs / tests / `pnpm-*.yaml`；DSH 主体与补丁行未动，§16.3 的 S4「基线 185 行全部命中」为证）；加性接口 ✓（`consult.read` 无合参记录时不加 `drafts` 键、`digao.read/status` 加性字段、旧方法名未改）；钉版行为断言有据 ✓（`routes.list` 的 `listProviders/listModels/listConfigurableProviders`、`occurrence` 的 `reminders_json`、`settings.section` 实装位置都在代码注释里引到具体行）；台账数字自查：`tests/test-inventory.json` 读得 `total=1761`、文件条目 **162** 个、`knownRed` 2 条，与 §16.3 的「1761/162、已知红 2」**一致**（全量 vitest / verify:isolation / verify:assembly 由 Lead 跑，本轴未重复）。

---

## 5. 方法与局限

- **怎么审的**：先读规格全文（205 行）、10 张票面全文、§16 与四份冻结契约，再按 §16.1 的票→交付面映射定位实现；新文件读全文，老文件看 `git diff main...HEAD` 的改动；「复核 12 项」逐项独立核代码与用例（不复述台账）。
- **证据标准**：每条发现都给「规格/票面原文 → 实现 file:line → 用例路径或缺口」。区分硬违规（AC 不成立/语义写反）与判断项（契约对规格的降格、文案口径）。
- **未做的事（局限）**：① 没有跑 `pnpm verify:all` / `pnpm test:inventory` / `pnpm verify:isolation` / `pnpm verify:assembly`（Lead 在跑；本轴只做了静态核对 + 清单文件自查）；② 没有真机跑壳（本机 Electron 二进制按 §16.4 未装），壳的验收按「模块层 + §16.5 已登记」接受；③ 没有真多家 provider key（按 §16.5 接受）；④ 客户端无 jsdom，UI 结论来自 `renderToStaticMarkup`/纯函数用例 + 源码，未做真浏览器点击链。
- **规格外观察（不计入 6 条）**：
  1. 客户端尚有几处**用户可见的 `~/.dsh` 旧路径文案**未被本 diff 更新：`panel.ts:99`（「数据都在本地 ~/.dsh/xuanshu/」）、`consult-views.tsx:388`、`MingpanPanel.tsx:37`、`sediment-views.tsx:279`、`sediment-model.ts:161`、`CangPanel.tsx:108` 的占位值。这些是 **main 上就有的**（不在本 diff 内），按「只审本 diff」不列为发现；但它们与 ADR-0014 改后的 home 语义相反，建议后续单开一笔（尤其是 `panel.ts:99` 与 `consult-views.tsx:388` 是首页/门厅级文案）。
  2. `docs/runbook/home.md:12` 把开发档写成「仓库检出 `/.dsh-home`」（漏了 `<repo>` 前缀），是文档笔误，不影响判据。
