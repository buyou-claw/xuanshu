# Spec 002 · 标准轴审查（Standards）

- 固定点（基准）：`main = 09951eb5ad2e49edcc1b74cfb35e99d2ed9ceebe`（= merge-base，已核）
- 审查对象：`HEAD = ae78c53203d4ffe717d859ea0196bb277bc3f2ff`（`feat/spec-002-integration`，41 提交）
- diff：`git diff main...HEAD`（224 文件，+32964/−1686，工作区干净）
- 轴：只做**标准轴**，不与规格轴合并排序（规格轴见 `spec002-ae78c53-spec.md`）
- 标准来源：`AGENTS.md`、`CONTEXT.md`、`docs/agents/domain.md`、`docs/development-status.md`（工作方式 / §9 / §11–§13 / §16）、`docs/adr/0001–0014`、`README.md`、`.github/workflows/verify.yml`、`package.json`、`docs/runbook/*.md`、冻结契约 `.scratch/notes/spec002/*.md`（四份都在）

## 结论

**不通过。** 全量 9 项：**硬违规 1 项**、判断项 5 项、气味基线 3 项。

标准执行度整体**高于 Spec 001 各轮**：单事实来源（host home）收口、真实 `~/.dsh` 拒绝门、「未知不冒充 false」、凭据不进备份/不计体积、关闭现场放宽的双向对照用例，都是本轮真实落地且有负路径证据的。唯一判不通过的原因是一条冻结契约明文禁止、且本仓历史上反复判红的「拿不到就写 0」静默失效（H1）；另有 1 条本轮 home 迁移造成的用户可见旧路径文案失真（J2）。

---

## 硬违规

### H1 [P2] `traffic.status` 把「账读不出来」报成 `unread: 0`——注释与代码相反，契约明文禁止

**位置**

- `packages/xuanshu-host/lib/notify/traffic.mjs:119-129`（读面）
  ```js
  if (!existsSync(file)) return { entries: [], unread: 0, exists: false }   // L121
  try { text = readFileSync(file, 'utf8') }
  catch {
    // 账读不出来 = 未知，不是空账；调用方据此省略 unread（不写 0 冒充「都读过了」）。   // L127
    return { entries: [], unread: 0, exists: false }                        // L128
  }
  ```
- `packages/xuanshu-host/lib/notify/service.mjs:42-48`（RPC）
  ```js
  'traffic.status': async (request) => {
    const ledger = readTraffic(dataDir, { limit: source.limit })
    const out = { entries: ledger.entries, unread: ledger.unread }   // 无条件写 unread
    if (ledger.lastFailure !== undefined) out.lastFailure = ledger.lastFailure
    return out
  },
  ```
- 对照：同一轮 diff 里 `packages/xuanshu-host/lib/rikke/service.mjs:91-94` 是**正确写法**——`if (ledger.exists) { … out.unread = … }`，拿不到就不写 `unread`。

**引用标准**

1. 冻结契约 `.scratch/notes/spec002/contract-shell-notify.md:112-118`（§4）：「`traffic.status({ limit? })` → `{ entries: [最新在前], unread: <int>, lastFailure?: … }`**（拿不到就省略键，不写 false/0 冒充已读）**」。
2. `docs/development-status.md:734`（§16.2）：`routes.list`「默认路由未知时 `isDefault = null`（之前写成 `false`，把『不知道』冒充成『不是』）」——本仓成文判据：**未知不许折算成具体的否/零**。
3. `docs/development-status.md:472`（§13 SP-3）：注释写「不让它们互相顶掉」、代码却是 `Map.set` ⇒ 被追罚并要求「注释与代码对齐」——注释与实现相反本身就是一条既有判据。
4. `docs/adr/0014-own-desktop-shell-and-home.md:26`：「通知失败（权限、系统关闭）必须可观察……**不允许**把「没推成」显示成「推过了」」。

**为什么是硬违规而不是风格**

- `readTraffic` 把两种语义**压进同一个返回值**：文件不存在（合法空账，`unread:0` 是真话）与文件存在但读失败（未知）都返回 `{ unread:0, exists:false }`；调用方无法区分，于是 `traffic.status` 必然把「未知」报成「0 条未读」——正是契约禁止、且 ADR-0014 点名的「把没推成显示成推过了」那一类静默失效。
- 代码注释已经把**正确契约写在旁边**（L127「调用方据此省略 unread」），但调用方没有省略；同一轮 diff 里 `rikke.status` 又实现了正确版本。不是设计取舍，是漏做 + 注释失真。
- 后果在界面侧：触达账是「哪些通知没被看过 / 哪条推失败」的唯一权威（契约 §4 末「不另存计数」）；读失败被折叠成 0 会让未读角标与失败原因一起消失，且无任何可观测信号。

**建议修法（三选一，推荐 ①）**

1. `readTraffic` 增加三态（`{ state: 'missing' | 'unreadable' | 'ok' }` 或保留 `exists` 并把读失败返 `unread: null`），`traffic.status` 仿 `rikke/service.mjs:91` 只在 `ledger.exists === true` 时写 `unread` / `lastFailure`；注释改成与实现一致。
2. 若坚持 `unread` 常驻，则把「读失败」与「空账」分开（新增 `unreadable: true` 或 `notes`），前端明确显示「未读数未知」，**不能**显示 0。
3. 回归用例：`tests/traffic/ledger.test.mjs` 现有用例只覆盖「文件不存在 → `{entries:[],unread:0,exists:false}`」（L114-117），需补一条「文件存在但读不出」（打桩 `readFileSync` 抛错，或 Windows 上锁文件）→ 断言 `traffic.status` **不含 `unread` 键**。现无此用例，故这条静默失效在 1761 条用例下仍可全绿。

---

## 判断项

### J1 [P2] 冻结契约 §0「不写第二份字面量」与壳侧本地副本的偏差

- 位置：`packages/xuanshu-shell/lib/contract.mjs:62-65,68-84`（`DEFAULT_WEB_PORT = 19388`、`DESKTOP_WEB_PORT = 19387`、`DEFAULT_PROFILE`、`DATA_DIR_NAME`、`DSH_PACKAGE`、`HOME_MODES` 等全部另写一份字面量）。
- 标准：`.scratch/notes/spec002/contract-shell-notify.md:14-15`（§0）：「web 端口：`19388`（常量来源 `scripts/isolation/defaults.mjs` 的 `DEFAULT_WEB_PORT`；壳/宿主/启动器都引用它，**不写第二份字面量**）」。
- 已做的缓解：`tests/shell/contract-parity.test.mjs:53-66` 把宿主与 `scripts/isolation/defaults.mjs` 的真源 import 进来逐值对拍，且额外钉死契约字面量（「避免两边一起改错也算绿」）。文件头也写明了「副本而不 import」的包边界理由。
- 判定：按契约原文可读作硬违规，但实现用 parity 测试堵住了漂移风险，且理由（壳要能单独装进 Electron 应用）成立——**作为判断项要求二选一走完闭环**：① 更新冻结契约 §0 措辞（「壳侧允许 parity-tested 本地副本」）；或 ② 在 `contract.mjs` 头注释把这一处登记为对契约的显式例外（当前只写了「值必须与真源逐字一致」，没写「例外」二字）。
- 关联气味：Duplicated Code（见 S1）。

### J2 [P1] 本轮 home 迁移把 6 处用户可见文案里的旧路径变成错话（本轮变更引入的连带失真）

- 位置（均为 main 上已存在、本轮未改的行，但被本轮 ADR-0014 的 home 变更**变成错的**）：
  - `packages/xuanshu-client/src/client/sediment-views.tsx:279`：`草稿落点（只读）：~/.dsh/xuanshu/sediment/…`
  - `packages/xuanshu-client/src/client/sediment-model.ts:161`：`const base = '~/.dsh/xuanshu/pus/…'`
  - `packages/xuanshu-client/src/client/panel.ts:99`：`PANEL_LOCAL_NOTE = '数据都在本地 ~/.dsh/xuanshu/'`
  - `packages/xuanshu-client/src/client/CangPanel.tsx:108`：`registryPath ?? '~/.dsh/xuanshu/cang/registry.jsonl'`
  - `packages/xuanshu-client/src/client/MingpanPanel.tsx:37`：`当前底座谱（~/.dsh/xuanshu/pus/_base/bazi.md）…`
  - `packages/xuanshu-client/src/client/consult-views.tsx:388`：`数据在本地：~/.dsh/sessions/`
- 标准：ADR-0014（`docs/adr/0014-own-desktop-shell-and-home.md:13`「home 独立：玄枢不读写 `~/.dsh`」）+ 冻结契约 §0（产品 `~/.xuanshu` / 开发 `<repo>/.dsh-home`）+ `docs/development-status.md:688`「数字/口径只从工具输出（唯一真源）里抄，手抄必然漂」的同一条逻辑：**唯一真源变了，抄死的旧值必须跟着改**。
- 为什么算判断项而不是不动它：这些行不在本 diff 的 diff hunk 里（按「不审 main 之前的既有物」本可放过），但本 diff 把数据目录从 `~/.dsh/xuanshu` 迁到 `<home>/xuanshu`（产品 `~/.xuanshu/xuanshu`），使它们从「旧路径」变成「**用户唯一能看到的错误路径**」。用户在设置/面板里读到 `~/.dsh/...` 会直接去翻 DSH 桌面版的数据目录，与 ADR-0014「零交集」的对外承诺冲突。
- 建议：宿主 RPC 已回 `home/dataDir`（`data.overview`），客户端文案据此渲染；最省事的兜底是改成 `<玄枢 home>/xuanshu/…` 占位，并加一条源码扫描用例（client src 中 `~/.dsh` 只允许出现在注释里）——本仓已有同类「源码级禁令」测试先例（`tests/lib/home-single-source.test.mjs` 的 function-identity 断言）。

### J3 [P2] `OVERVIEW_HASH` 跨包各写一份字面量，但测试只钉字面量、没钉两侧同源

- 位置：`packages/xuanshu-client/src/client/overview-hash.ts:17`（`export const OVERVIEW_HASH = 'xuanshu-overview'`）与 `packages/xuanshu-shell/lib/main-flow.mjs:127`（同名常量、同值）。
- 现状：`tests/assembly/overview-hash.test.mjs:16,43` import 的是**客户端自己那份**，再断言 `'#xuanshu-overview'` 字面量——壳侧那份没有参与对拍。与同轮 `tests/shell/contract-parity.test.mjs` 明确采用的「两侧 import 真源直接比」的做法不一致。
- 标准：单事实来源（`docs/development-status.md:110` §6「注册面清单收成单一事实来源」与 §16.2 的收口逻辑）；两包各自写一份会被两侧各自的绿测试掩护（`contract-parity` 文件头描述的正是这种失败形态）。
- 建议：把 `OVERVIEW_HASH` 纳入 `tests/shell/contract-parity.test.mjs`（import 两包直接比），或客户端改为从共享常量模块取值。

### J4 [P3] 新 runbook 示例使用作者机器的绝对路径

- 位置：`docs/runbook/shell.md:34`：`pnpm --filter xuanshu-shell exec electron . -- --home E:/ai_project/XuanShu/.dsh-home`
- 说明：既有 runbook 已有同样惯例（`docs/runbook/dual-instance.md:13,169`、`horosa.md:56,165`、`setup.md:14` 的 `cd E:\ai_project\XuanShu` / `C:\Users\…`），属仓库既有风格而非本轮新引入的坏习惯；且此处是「本机手测命令」语境。**不判硬违规**，但新文件建议写成 `--home <repo>/.dsh-home`（与 `docs/runbook/home.md:19` 用 `<你的用户目录>` / `<你>` 的写法一致），避免示例只对作者机器成立。

### J5 [P3] `lib/index.js:170` 的函数体起写在同一行，与全仓格式不一致

- 位置：`packages/xuanshu-host/lib/index.js:170`：``export function isShuttingDown(ctx) {  const stateOf = (value) => {``
- 同文件其余函数、以及本轮新增的 `home.mjs`/`notify/**`/`shiji/**` 均为「`{` 后换行」。本仓无 lint/prettier 配置（`package.json` 只有 tsc + build-client + inventory 门），故不判违规，仅提示回正，避免后续 diff 噪声。

---

## 气味基线（全部只是判断项；成文标准优先）

### S1 Duplicated Code · home 解析三份实现

- `packages/xuanshu-shell/lib/home.mjs`（208 行，头注释自认是 `scripts/isolation/resolve.mjs` 的**本地副本**）；`packages/xuanshu-host/lib/home.mjs`（196 行，同规则第三份）。
- 缓解：壳↔resolve 有逐组对拍（`tests/shell/home.test.mjs`，见 `home.mjs:4-5` 注释）；宿主侧有「唯一实现 + 同一函数对象」断言（`tests/lib/home-single-source.test.mjs:56-59`）。
- 判断：包边界使得直接 import 不现实，**当前可接受**；但三份实现里「两档默认 / real-`~/.dsh` 拒绝门」的规则一旦变更需要三处同步，且**宿主 ↔ 壳/启动器之间没有跨包对拍**。契约 §0 允许「把纯逻辑抽到壳可 import 的中立模块」——下一轮可考虑，或补一条 host↔resolve 的拒绝门对拍。

### S2 Middle Man · 两个「薄包装」

- `packages/xuanshu-host/lib/shiji/scan.mjs:54-56`（`resolveShijiDshHome` → `resolveSearchHome().home`）、`packages/xuanshu-host/lib/workflow/service.mjs`（`resolveDshHome`）。
- 判断：**可接受**——它们存在是为了「第 5 份 home 解析必须收回到唯一实现」（`tests/lib/home-single-source.test.mjs` ④），是这次结构债修复的产物而非无意义转发；有行为对拍用例。

### S3 Primitive Obsession / Mysterious Name · `exists: boolean` + `unread: number` 承担三态

- 位置：`packages/xuanshu-host/lib/notify/traffic.mjs:119-129,145-153`。
- 判断：一个布尔 `exists` 同时表示「文件不存在（合法空账）」与「文件存在但读不出（未知）」；一个数字 `unread` 同时表示「0 条未读」与「不知道」。名字没有说出它装的是哪一种 → 这正是 H1 的根因。建议改成显式三态（`state` 或可空 `unread: number|null`），让类型本身堵住折算。

---

## 已核查且通过的关键面（证明覆盖过，不是漏看）

1. **ADR-0001 零 DSH 源码改动**：diff 只含本仓 224 个文件；`git ls-files 'packages/*/node_modules/*'` 为空；无上游 checkout / `node_modules` 入库；无 `.scratch/**` 入库。
2. **ADR-0004 钉版**：唯一新增运行依赖是 `electron 38.2.2`（精确版本，`packages/xuanshu-shell/package.json:22`）；`pnpm-workspace.yaml` 的 `allowBuilds` 只放行 esbuild / electron 且逐条写了理由；`pnpm-lock.yaml` 新增仅 `packages/xuanshu-shell` 一项 workspace 入口。
3. **ADR-0014 + 单一 home 实现**：`packages/xuanshu-host/lib/home.mjs` 收口；`bazi/service.mjs` 再导出的是**同一函数对象**（`tests/lib/home-single-source.test.mjs:56-59` 用 `toBe` 钉引用）；`resolveDataDir` / `resolveSearchHome` 两处都对真实 `~/.dsh`（含子目录）改判兜底并带回 `note`（`home.mjs:137-143,184-195`）；`docs/development-status.md:709` 的 `home-isolated` 断言「两档默认都不是 `~/.dsh`」。
4. **冻结契约 §1/§2/§5 逐字对拍**：`tests/shell/contract-parity.test.mjs` 对 schema、`kind`/`target` 取值域、默认设置、端口/profile/home 变量名逐值对拍；14 条非法载荷**两侧同判**（L107-132）；多余字段两边都忽略（L134-137）。这是本 diff 里质量最高的一组测试。
5. **通知端点纪律（契约 §2/§3/ADR-0014:26）**：`notify/send.mjs:104-188` 永不抛、2s 超时、不重试、发送前**再校验一次回环**；`shell/lib/notify-state.mjs:93-114` 同目录 `wx` tmp + rename 原子写 + 尽力 `0o600`；`delivered:false` 如实回传（`send.mjs:163-172`）。
6. **「未知不冒充」三处（本轮复核修复的核心判据）**：`routes.list` 的 `isDefault: null`（`consult/routes.mjs:155-167`；负路径 `tests/consult/bestof-catalog.test.mjs:130-136`、`tests/assembly/bestof-multiprovider.test.mjs:175-186`）；日课 AI 段三态 `ok/off/failed`（`tests/rikke/ai-note.test.mjs:78-106`）；事记「核不了 ≠ 没有」（`shiji/scan.mjs:167-182,217-223` 用 `available:false` 且不冻结既有条目）。
7. **凭据与排除（契约 §1 + ADR-0003 边界）**：`.credentials.yaml` 是 `NEVER_COUNT_BASENAME`（`data/plan.mjs:31,128`），不进任何组、不进备份，作为 `excluded` 条目给界面解释（`data/overview.mjs:20-39`）；`tests/data/backup.test.mjs:78,130-138` 真造带 `sk-live-…` 的凭据文件，断言备份文件不存在、清单里没有、`manifest.excluded` 有原因。
8. **装配报告关闭放宽「刻意且窄」**：`reportIsOk` 只放宽 `profileContext` 一项（`lib/index.js:444-445`），双向对照用例把「恒 false / 恒 true」各打红一条（`tests/assembly/assembly-report-teardown.test.mjs:53-75`）；非关闭现场缺 `profileContext` 仍然判红。
9. **断言质量（新增面）**：diff 中**没有新增** `it.skipIf` / `describe.skipIf`（`git diff | grep '^+.*skipIf'` 为 0）；未发现新增恒真断言（既有 `tests/lib/fixtures/inventory-*` 里的 `expect(true).toBe(true)` 是为清单门造夹具的刻意写法，非本轮新增）；`assembly-report` 的恒真/恒假对照是正例。
10. **数字一致性（只做跨文档核对，未重跑——见局限）**：`README.md` 的「1761 条用例 / 162 文件 / 失败 2 条（既有已知红）/ 跳过 10 条」「515773 B」与 `docs/development-status.md:744,754,762` 的工具输出逐字一致；`§16.3` 明确 `knownRed` 未改、`verify:all` exit 0。
11. **术语（CONTEXT.md）**：对 131 个新增文件做旧称扫描（模块/资产/每日运势/仪表盘/闹钟/标签）——命中 25 处全部是「纯模块」「设置分区标签」这类**软件/UI 通用词**，不是域对象旧称漂移；新代码/文案一律用「谱 / 藏 / 底稿 / 事记 / 日课 / 晚省 / 合参」。
12. **DSH 钉版断言带出处**：新增代码里涉及上游行为的断言（`dsh-schedule/lib/index.js:1596-1626`、`dsh-llm/lib/types/types.d.ts:489-531`、`dsh-agent-loop/lib/index.js:906-918` 等）均为 `包/文件:行` 形态，符合 `docs/development-status.md` 的惯例；未发现「无出处的上游行为断言」。

---

## 方法与局限

**做了什么**

- 先读标准：`AGENTS.md`、`CONTEXT.md`、`docs/agents/domain.md`、`docs/development-status.md` 的工作方式/§9/§11–§13/§16 全文，`docs/adr/0001–0014`（重点 0001/0003/0004/0005/0006/0009/0010/0012/0013/0014），`README.md`、`.github/workflows/verify.yml`、`package.json`、`pnpm-workspace.yaml`、`scripts/isolation/defaults.mjs`、四份冻结契约。
- 分区看 diff：先 `--stat` 分 12 区（client src / client 产物 / host lib / shell / scripts / profile / docs / tests 各域）；**新增文件优先读全文**（host `home.mjs`、`data/plan.mjs`、`data/overview.mjs`、`notify/send.mjs`、`notify/traffic.mjs`、`rikke/occurrence.mjs`、`shiji/scan.mjs`、`shiji/ledger.mjs`、shell `contract.mjs`/`home.mjs`、client `overview-hash.ts`），重点测试全文（`contract-parity`、`home-single-source`、`assembly-report-teardown`）。
- 对 diff 做全量模式扫描：新增 `catch`、`?? 0`/`|| 0`、`skipIf`、恒真断言、硬编码盘符/`~/.dsh`、凭据字面量、新增依赖、被删除的 RPC 方法名/导出、新增 `TODO/FIXME`、`console.log`。
- 交叉核对：README / development-status / runbook / 测试之间的数字与口径；同一判据在多个模块的落法（`rikke.status` vs `traffic.status` 的 `exists` 门就是靠这步发现 H1 的）。

**没做 / 不能确认**

- **未运行** `pnpm verify:all` / `pnpm test:inventory` / `pnpm verify:isolation` / `pnpm verify:assembly`：本任务禁止 `pnpm install/setup/install-profile`，且全量 1761 条用例超出本轮时窗。因此工具强制的类型/测试面**不重复报**；文档里的测试数字只做了跨文档一致性核对，**没有独立复算**。
- 未逐行读 162 个测试文件（约 40% 新增测试只做了 grep 级抽查）；未逐行读客户端产物 `packages/xuanshu-client/lib/client.js`（4514 行 diff，只核了它与 `src/**` 的同步门存在且 `build-client --check` 是 CI 门之一）；未审计客户端 60+ 个新增/修改组件的 UI 逻辑（标准轴无渲染/DOM 判据可用）。
- **未验证 H1 触发率**：Windows 上 `readFileSync` 读已存在文件失败的频率（文件被独占锁 / 权限）未实测；这不影响「未知被报成 0」的判据成立，只影响其优先级。
- 未核真机：桌面壳真实窗口/托盘/toast/自启、真第二家 provider、真 LLM 端到端——这些已在 `docs/development-status.md:790-816`（§16.5）如实登记，不按本轮发现计。
- 按任务要求**没有**审 main 之前既有的代码与文档结论（J2 是唯一例外，并以「被本轮变更变成错话」的理由明确标注）。
- HEAD 审查期间未变化（开始与结束各核一次 `git rev-parse HEAD`）。
