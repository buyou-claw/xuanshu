# tests/setup — setup 断言台（票 05）

`node scripts/setup.mjs` 一条命令 = 取件 → 校验 → 装 runtime → 装配 profile → 三项自检。
本目录是它的**验收面**：断言的全是**外部可观察物** —— 进程退出码 / 报告 JSON（唯一机器可读产物）/
缓存目录里的字节 / 有没有发起过请求。不 import 实现内部模块做白盒断言（例外：契约 §10 明写「纯单测」的
**三个**模块 `scripts/setup/mirror.mjs`（`mirrorCandidates`）/ `scripts/setup/exit.mjs`（`EXIT`）/
`scripts/setup/args.mjs`（`parseArgs`），外加 `scripts/setup/pin.mjs` 的 `runtimeArtifact()` ——
本机是 win32-x64，A10 的 `win32-arm64 → win32-x64` 回退**造不出真平台**，只能单测这个纯函数）。

契约出处：`.scratch/assembly-foundation/notes/setup-contract.md`（§2 参数 · §3 取件校验 · §5 自检 ·
§7 报告 · §8 退出码 · §10 **十条断言面**）+ `.scratch/assembly-foundation/captures/setup-e2e-groundtruth.md`
（Lead 真机实测的 doctor / install / serve / MCP 响应形状 —— 所有 fixture 都照它回放，不靠猜）。

| 文件 | 作用 |
|---|---|
| `pin.test.mjs` | **第 8 条**：`scripts/setup/horosa-pin.json` 与离线副本（`captures/horosa-SHA256SUMS.txt` + `horosa-runtime-manifest.json`）逐值一致；不许出现 `latest`。纯单测。**A10**：平台回退（`platformFallback`）显式化 + 无平台即 exit 2 |
| `mirror.test.mjs` | **第 10 条**：`mirrorCandidates` 的候选顺序 / 非 github 原样 / 空列表只回原 URL。纯单测 |
| `args-exit.test.mjs` | **第 7 条的一部分**：`EXIT` 六个数逐键相等；`--help` 真列参数、未知参数 exit 1 且点名 |
| `setup-cli.test.mjs` | **第 1–7、9 条**：端到端（离线取件零 HTTP / SHA256 门 / Range 续传 / 两个环境门 / 幂等 / 报告 schema / 退出码表）。**A3**：doctor 的版本门只认 `runtime_payload_version`（≥2 例）。**A10/A11**：报告里 `platformFallback: null` 与 `logs/` 路径（路径都指向真文件） |
| `selfcheck-branches.test.mjs` | **C2 的两条分流**：**A1**（守卫判 `probe-failed` → 加长预算复探 → 复用通过，且**没有**起第二个进程）、**A2**（`initialize` 不带 `mcp-session-id` → C2 false、exit 5，不许假绿）、**A7**（`structuredContent` 与 `content[].text` 同时存在时，信封必须取自后者） |
| `report-and-gates.test.mjs` | **A4**（`--verify-only` 在一份没有 uvx 的 PATH 上 exit 0；同一 PATH 真跑 exit 3）、**A5**（失败也写报告 / 真实 home 被拒仍零写入）、**A6**（`HOROSA_SKILL_DATA_DIR` 指向真实 `~/.horosa` → 忽略 + note）、**A11**（C1 的 `evidence.logFile` 指向真文件） |
| `probe-pin.test.mjs` | **A9**：探针的期望版本只有 pin 一个来源 —— 把 `scripts/horosa/**` 抄进沙箱、`scripts/setup/` 留空，`checkBaziTool()` 必须回 `ok:false`（不猜版本、不发请求） |
| `fixtures.test.mjs` | **替身自检**：先证明 fixture 自己是对的（计数 server、Range+断连、假 uvx 的 doctor/install/MCP、两个 stub、zip 字节） |
| `install-profile-copy.test.mjs` | **copy 模式回归门**（复核报告 Standards 3 / Standards 4）：自有插件包必须**物化进目标**（`<target>/packages/<name>`）且说明符是 `file:./packages/<name>`（`link:` 不装被链接包自己的依赖 → 目标里没有 `tz-lookup`）；`pnpm-lock.yaml` 必须一并复制并把自有包路径改写成目标内相对路径（`--skip-install` 装出来的 profile 也要能被 `--frozen-lockfile` 校验）。**零 pnpm / 零网络**：把真脚本原样拷进临时 fixture 仓库跑（脚本按自身位置推 REPO_ROOT），所以跑的是真代码、不碰真仓库与真 DSH_HOME。**复现「修复前红」**：`XUANSHU_INSTALL_PROFILE_BIN` 指向修复前的脚本副本即可（默认=仓库里的真实现） |
| `fixtures/bin/uvx.mjs` | **假 uvx**：回放真机形状的 `doctor` / `install` / `runtime status` / `serve`（含真 MCP HTTP） |
| `fixtures/stubs/install-profile.mjs` | `scripts/install-profile.mjs` 替身（**零 pnpm**） |
| `fixtures/stubs/verify-assembly.mjs` | `scripts/verify-assembly.mjs` 替身（C1 的 0/1 两态） |
| `lib/release-server.mjs` | 本地**计数** server（独立进程）：计数 / Range 206 / 「先给半个文件后断连」 |
| `lib/sandbox.mjs` `lib/fixtures.mjs` `lib/zip.mjs` `lib/sha.mjs` `lib/env.mjs` `lib/setup-run.mjs` `lib/paths.mjs` | 沙箱（cache / dsh-home / runtime-root / state / work 五件套）、fixture 归档与测试 pin、真 zip 构造、SHA256、子进程环境、跑 CLI 的胶水（含 `startFakeHorosa`：C2 分流用例自己起的假 serve） |
| `.tmp/` | 运行期沙箱（cache / dsh-home / runtime-root / state / work 五件套；已 gitignore，绿的留现场便于复盘） |

## 跑

```bash
pnpm vitest run tests/setup        # 本目录
pnpm test:setup                    # 等价（Lead 落地的 npm script）
pnpm vitest run tests/setup/fixtures.test.mjs   # 只想确认 fixture 没坏
```

## 十条断言面 ↔ 用例对照

| # | 断言 | 主要在哪验 | 需要实现的哪些部分 |
|---|---|---|---|
| 1 | SHA256 不匹配即中止 → exit 2，runtime 根零新文件、缓存零 `.part`、错误带「期望 vs 实际」 | `setup-cli.test.mjs`（含缓存/install 台账断言） | 取件+校验+退出码 |
| 2 | 离线 `--wheel`/`--runtime` → **全程零 HTTP**（计数 server 断言 0） | `setup-cli.test.mjs` | 取件（离线分支） |
| 3 | 断点续传：先断连留 `.part` → 重跑带 `Range: bytes=<已下>-` → 最终 SHA256 正确、无 `.part` 残留 | `setup-cli.test.mjs` | 下载器 |
| 4 | win32 非 ASCII runtime 根 → exit 3 且**发生在下载之前**（零请求） | `setup-cli.test.mjs` | 环境门 |
| 5 | `--dsh-home` = 真实 `~/.dsh` 且无 `--install` → exit 3，一个文件都不写 | `setup-cli.test.mjs`（+ 真实 `~/.dsh` 只读快照） | 环境门 |
| 6 | 幂等：连跑两次 → 第二次零下载、`runtime.action === "already-installed"`、`generatedAt` 更新、exit 0 | `setup-cli.test.mjs` | 编排 + 缓存 + 版本门 |
| 7 | 退出码表 2/3/4/5 各至少一例（另加 1） | `setup-cli.test.mjs` + `args-exit.test.mjs` | 全部 |
| 8 | pin 与离线副本逐值一致、无 `latest` | `pin.test.mjs` | 只需 pin 文件 |
| 9 | 报告 schema：`checks[].id` 恰为 assembly/horosa8765/bazi、顺序固定、`schema` 正确 | `setup-cli.test.mjs` | 报告 + 三项自检 |
| 10 | 镜像重写纯函数：prefix 在前 / 原 URL 最后 / 非 github 原样 / 空列表只回原 URL | `mirror.test.mjs` | 只需 `mirror.mjs` |

## 注入点（契约 §10 + Lead 批准，测试侧唯一的口子）

| 变量 | 替身 | 为什么必须有 |
|---|---|---|
| `XUANSHU_SETUP_PIN` | `tests/setup/.tmp/**/pin.json` | fixture 归档只有几百字节，sha256 永远对不上真实 pin；没有它，第 1/3/6 条只能退化成「必然失败」的弱形态 |
| `XUANSHU_UVX_BIN` | `fixtures/bin/uvx.mjs` | 不装真 uvx 环境、不起真 horosa（`.mjs` → `spawn(process.execPath,[bin,...args])`，Windows 上 shell:false 直跑 `.cmd` 会 EINVAL） |
| `XUANSHU_INSTALL_PROFILE_BIN` | `fixtures/stubs/install-profile.mjs` | 真实现会跑 `pnpm install` —— 「零网络 / 零真实安装」守不住 |
| `XUANSHU_VERIFY_ASSEMBLY_BIN` | `fixtures/stubs/verify-assembly.mjs` | C1 真跑要起 DSH CLI（分钟级）；替身让 exit 0/5 两态确定可造 |
| `XUANSHU_SKIP_PREFLIGHT=1` | — | 跳过「`uv` 在不在 PATH」的环境门（本机 PATH 与 CI 不一致，会引入假红）。**A4 的用例故意不设它**：那条要验的正是「`--verify-only` 下这道门不该跑」 |
| `XUANSHU_FAKE_UVX_STATE` | 沙箱的 `state/` 目录 | 假 uvx 的状态与记账目录（`calls.jsonl` / `installed.json` / `serve.json`）——`baseEnv` 设的就是它 |
| `XUANSHU_FAKE_UVX_MODE` | — | `fail-install` / `wrong-version` / `manifest-only` / `manifest-lies`：造 exit 4 的各种版本门形态（后两个是 A3 的用例） |
| `XUANSHU_FAKE_UVX_NO_SESSION=1` | — | A2：让假 server **不回** `mcp-session-id` → C2 必须 false |
| `XUANSHU_FAKE_UVX_GET_DELAY_MS` / `XUANSHU_FAKE_UVX_GET_DELAY_TIMES` | — | A1：让头一次 `GET /mcp` 慢应答（守卫判 `probe-failed`），复探时已经答得出来 |
| `XUANSHU_STUB_MODE` / `XUANSHU_STUB_LOG` | — | **只在测试侧**：造 exit 4（`fail-profile`）与 exit 5（`fail-verify`），以及两个 stub 的 argv 台账 |
| `XUANSHU_HOROSA_PORT` | — | 把 C2 的端口顶到一个 OS 分配的空闲端口（**绝不绑真实 8765**；假 uvx 见到 8765 会直接拒绝启动） |

## 替身回放的就是真机形状（别改「更好看」的版本）

`fixtures/bin/uvx.mjs` 的每个 JSON 都对着 `captures/setup-e2e-groundtruth.md`：

- **fixture 的版本号从仓内 pin 派生**（`lib/fixtures.mjs` 与 `fixtures/bin/uvx.mjs` 都读
  `scripts/setup/horosa-pin.json`）。原因：C3 断言的期望版本由探针**直接读仓内 pin** 得到
  （不认 `XUANSHU_SETUP_PIN`），doctor 的同版本硬门又拿**测试 pin 的 version** 比 —— 两边都对着仓内
  pin。写死的字面量会让「升级 pin」把断言台弄红（假红），进而诱使人去改测试；派生之后升级 pin 只需要
  改 `horosa-pin.json` 一处。
- `doctor`：**装好但服务没起时 `ok` 就是 `false`**（真机实测）。版本门只能断言
  `installed === true && runtime_payload_version === <pin.version>` —— 谁拿 `ok` 当版本门，谁就会把好机器判坏。
  fixture 故意保留这个 `ok:false`，把「判据写错」当场抓出来。
- `install --archive`：回 `runtime_layout_version` / `runtime_payload_version` / `derived_from` / `services`。
- `serve`：**streamable-http 真形状** —— `initialize` → 200 + `content-type: text/event-stream` +
  `mcp-session-id`（32 hex）、SSE 载荷在 `data:` 行；`notifications/initialized` → **202 空体**；
  `tools/list` → `result.tools` 含 `horosa_cn_bazi_birth`；`tools/call` → 信封在
  **`result.content[0].text`**（JSON 字符串）里，**不在** `structuredContent`。
- C3 的固定调用还会被 fixture 校验（都是契约 §5 明写的）：必须 `agent_confirmed_settings: true`、
  必须带 date/time/zone/lat/lon、**不得传 `timeAlg`**。违反 → 信封 `ok:false` → C3 红 → exit 5。

## 卫生（这个测试台自己的规矩）

- **零网络**：唯一允许的「网络」是本目录的 `lib/release-server.mjs`（只绑 `127.0.0.1` + `listen(0)`）。
  它是**独立进程**：`spawnSync` 会阻塞测试进程的事件循环，长在测试进程里的 server 在实现下载那一刻
  不会被调度 —— 每条「零请求」断言都会**假绿**（票 04 踩过同一个坑，见 `tests/isolation/lib/fixture-server.mjs`）。
- **不碰真实 `~/.dsh`**：第 5 条用「把子进程的 `USERPROFILE`/`HOME` 指向沙箱里的假 home」来构造「真实
  `~/.dsh`」——实现即使有 bug 也只污染沙箱；同时给真 `~/.dsh` 拍一张**只读**快照（顶层 + `profiles`
  一层 + 报告的 mtime），跑完必须逐项不变。
- **不碰 `C:\horosa`、不读 719MB 的真实 runtime 归档**：runtime 一律用几百字节的 fixture zip；
  第 4 条的非 ASCII 根用**沙箱内**的中文路径（不用契约里的 `C:\用户\horosa` 字面量，免得实现有 bug 时
  真在 C 盘建出目录）。
- **子进程输出收字节按 UTF-8 解**（`spawnSync` + `encoding:'utf8'`）；本机控制台是 cp936，用 PowerShell
  重定向会写成 UTF-16LE，`JSON.parse` 直接崩。
- 受管环境变量一律**先删再设**（`lib/env.mjs` 的 `MANAGED_ENV`）：开发机上真的有 `DSH_HOME` /
  `HOROSA_RUNTIME_ROOT` / `XUANSHU_*`，继承下去等于测「别人设的环境」。
- 起子进程前先跑 `fixtures.test.mjs`：端到端红了，先证明不是 fixture 的锅。

## 两条环境相关的断言（诚实标注）

| 断言 | 条件 | 说明 |
|---|---|---|
| 缓存里的真 wheel 字节级等于 pin（sha256 + size） | 仅当 `%LOCALAPPDATA%\xuanshu\cache\horosa_skill-0.40.1-py3-none-any.whl` 存在 | 在 `pin.test.mjs` 里，读 1.4MB 文件（约 10ms）。**第 8 条的必过部分是离线副本比对**，这条是额外的真值加强，缺件时自动不跑 |
| 真实 `~/.dsh` 零写入 | 恒跑 | 只做 `readdir`/`statSync` 快照，不读内容、不写 |

## 三条**被真 bug 逼出来**的断言（别删、别放宽）

它们落在契约的字缝里（§6/§7 的样例与条文），但每一条都对应一次真实缺陷；删掉它们等于把那次缺陷的
回归门拆掉。留此备忘：

| 断言 | 抓到的真缺陷 |
|---|---|
| `checks[1].verdict === 'horosa-ready'`（§7 样例的字段位置） | 报告里只有 `evidence.verdict`（= 起 serve **之前**那一探的 `'free'`）→ 机器读这份报告得到的结论是「端口当时是空的」，答非所问（C2 成功后的归宿应是 `horosa-ready`） |
| 第 5 条「拒绝路径一个文件都不写」（§6 第一句没有例外条款） | 实现「报告无论成败都写」，于是**真实 `~/.dsh` 被写入 `<home>/xuanshu/setup-report.json`** —— 拒绝路径恰恰最需要零副作用。现在 `第 5 条` 的快照连 `<real>/xuanshu` 一层都拍（顶层 `xuanshu` 一旦出现，光看顶层就再也发现不了新增） |
| `mirrorCandidates` 的**数组形态与逗号串形态结果相等**（含尾斜杠） | 数组分支没做 `rstrip('/')` → 产出 `https://mirror//owner/repo/...`（一个静默 404 的坏候选）；CLI 路径因为先过 `parseMirrorPrefixes` 而侥幸没事 |
| （附）`连跑两次全绿` / 第 9 条 | `selfcheck.mjs` 把作用域里不存在的 `env` 传给 `startServe`（ReferenceError）→ **任何带自检的运行都必然 exit 5**，默认路径永远不可能成功 |

## 票 05 复审（A 项）的回归门（同样别删、别放宽）

同一个道理：每条都对应一次**代码 / 契约 / runbook 三处口径不一致**，修的是实现或文档，断言是那次
「不一致」的探测门。用例名里带 A 编号，便于与 `.scratch/assembly-foundation/notes/setup-review-fixes.md` 对账：

| 断言（用例） | 抓到的真缺陷 |
|---|---|
| A1 `selfcheck-branches`：守卫判 `probe-failed` → 加长预算复探 → **复用**通过（`serve.started === false`） | 契约 §5 改成「复探一次、不 spawn」，实现却直接 `return ok:false`（慢应答的 horosa 被冤枉成失败）；runbook 当时还写着第三种口径（「复用不成再自起一份」） |
| A2 `selfcheck-branches`：假 server 不回 `mcp-session-id` → C2 false、exit 5 | `mcpToolsList().ok` 不看 sessionId，C2 只判 `tools.ok === true` → 判据被弱化（自家 `probe.mjs` 反而要求 sessionId，同票两套口径） |
| A3 `setup-cli`：doctor 只给 `manifest_version` → exit 4 | 版本门会读 `manifest_version` / `runtime.version` / 顶层 `version`，**从不读**契约 §4.3 的 `runtime_payload_version` → 「新清单蒙着旧载荷」时门假过（还会把已装的同版本误判成「已装」而跳过安装） |
| A4 `report-and-gates`：没有 uvx 的 PATH 上 `--verify-only` exit 0（同一 PATH 真跑 exit 3） | `preflightUvx()` 跑在 `--verify-only` 分支之前 → 没装 uv 的机器上「只想复看一份报告」也 exit 3，与 runbook 的承诺相反 |
| A5 `report-and-gates`：pin 没有当前平台（exit 2）也写报告；真实 home 被拒仍零写入 | pin/平台解析失败只打 stdout、不落报告，而 runbook 承诺「成败都写报告，唯一例外是真实 home 被拒」 |
| A6 `report-and-gates`：`HOROSA_SKILL_DATA_DIR` 指向真实 `~/.horosa` → 忽略 + note | 该环境变量能覆盖数据目录且**没有守卫**，与 §6「数据目录一律 `<dsh-home>/xuanshu/horosa`」及对 `$DSH_HOME` 的 R16 裁决不对称 |
| A7 `selfcheck-branches`：两处都有信封时 `evidence.callEnvelopeFrom === 'content.text'` | 契约 §9 冻结的顺序是 `result.content[].text` **优先**、`structuredContent` 仅兼容，实现反了 —— 两处都在时由「兼容分支」决定读哪份数据（假 server 的 `structuredContent` 是一份错信封，顺序一乱 C3 必红） |
| A9 `probe-pin`：pin 读不到 → `checkBaziTool()` 回 `ok:false`（且不是「连接失败」那种形状） | `probe.mjs` 里有 `FALLBACK_VERSION = '0.40.1'`（第二份钉版值）→ pin 读不到时静默退化成陈旧版本，断言的却是去年的版本 |
| A10 `pin`（单测）/ `setup-cli`（报告键）：`platformFallback` 显式 `{from,to}` 或 `null` | `PLATFORM_FALLBACKS`（win32-arm64 → win32-x64）是**静默**的，绕开 §3.1「pin 无当前平台 → exit 2 并列出平台」的字面 |
| A11 `report-and-gates` / `setup-cli`：报告里的 `logs/` 路径指向真文件 | 契约 §7 与 runbook 都承诺「大输出落 `logs/`」，但 `logsDir` 是死字段（算了没人用）→ 被 `clipEvidence` 裁掉的 `verify-assembly` / `doctor` 原文无处可寻 |

## 本票**未**覆盖的边界

| 没测的东西 | 为什么 | 依赖 |
|---|---|---|
| 真下载 719MB 的 runtime、真 `install --archive` 解包 | 断言台禁止读/用那份工件（任务书硬约束）；取件/校验/续传三段逻辑都在我们这侧，用同形 fixture 验 | Lead 的真机 E2E（`captures/setup-*`） |
| 真 `pnpm install` / 真 DSH CLI 启动（C1） | 同上：会真联网、真装、分钟级；C1 的契约在 `tests/assembly/**` 另有断言台 | `pnpm test:assembly` |
| copy 模式下真 `pnpm install` 的依赖落地（目标 `node_modules/xuanshu-host` 能不能 import 到 `tz-lookup`、`--frozen-lockfile` 认不认复制的锁文件） | 断言台禁真装；`install-profile-copy.test.mjs` 只断言**机制**（物化 + `file:` 说明符 + 锁文件改写） | 离网探针 `.scratch/install-fix/probe2-copy.mjs`（fixture 图）与 `probe5-real-copy.mjs`（真 profile，`--offline` + 死 registry） |
| `--mirror` 在真 github 上的吞吐（21.9 MB/s 那种实测） | 真机网络事实，不是代码性质 | `captures/setup-e2e-groundtruth.md` §1 |
| 真 horosa runtime 的 MCP 120 工具全量面 | 假 uvx 只回放 12 个（含 `horosa_cn_bazi_birth`）；全量面归 `scripts/horosa/**` 的探针 | 票 06 |
| 8765 被别的进程占用（`occupied-foreign` → exit 3） | 需要先有一个真实占用者；票 04 的四态守卫已在自己的断言台里验过 | `tests/isolation/port-guard.test.mjs` |
| `win32-arm64 → win32-x64` 回退的**真机**行为（报告字段是与真平台一致的） | 本机是 win32-x64，`process.arch` 造不出 arm64；回退的**选择逻辑**用 `runtimeArtifact()` 单测封住，报告字段用「直接命中 → null」那条用例封住 | 真 ARM 机器（转述给 Lead 时附本行） |
| C2 自起 serve 的成功路径里「`initialize` 不带 session」以外的不完整形态（如 `tools/list` 空数组） | 需要一份「握手成功但工具表为空」的假 server；`c2Ready` 的两个来源都有这条判据，`probe.mjs` 侧另有单测断言 | 票 06 的探针断言台 |
