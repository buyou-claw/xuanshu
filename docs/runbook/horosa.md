# Runbook · horosa 底座（静态挂载 + 宿主托管生命周期 + 八字出盘）

> 票 06 的交付物之一。上位决策：`docs/adr/0008-horosa-static-mount-and-host-managed-lifecycle.md`；
> 契约：`.scratch/assembly-foundation/notes/horosa-integration-contract.md`（冻结）。
> 实现：`profile/cordis.patch.yml` 的 `mcp-horosa` 行 + `packages/xuanshu-host/lib/horosa/**` +
> `scripts/horosa/bazi-contract.mjs`；断言台 `tests/horosa/**`。
> 本页只讲**怎么跑、怎么验、怎么排障**；为什么这么设计看 ADR-0008。
> **装 horosa 本体**（wheel / runtime / 钉版 / SHA256）不在本页，在 `docs/runbook/setup.md`。

## 0. 一句话

**horosa 是「默认自带、删不掉」的一行 MCP 连接**：它写在 profile 补丁层（版本库是唯一来源），
市场插件碰不到它；**它的进程由宿主托管**（ensure runtime → 探端口四态 → spawn `serve` → 等 MCP 握手就绪 → dispose 收掉自己的那份），
装没装、版本对不对、端口被谁占着都只落一份状态文件，**绝不拖垮 DSH 启动**。

## 1. 这一行是怎么挂的，以及为什么市场删不掉

`profile/cordis.patch.yml` 是本 profile 相对上游默认的差异层，加载顺序在所有 bundle 层**之后**：

```yaml
- insert:
    - id: mcp-horosa
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: horosa
        url: http://127.0.0.1:8765/mcp
        toolCallTimeoutMs: 300000        # 首调会拉起 runtime（冷启动分钟级）
        failOnStartupError: false        # horosa 没起不许拖垮 DSH 启动；靠 reconnect 自愈
        reconnect:
          enabled: true
          initialDelayMs: 1000
          maxDelayMs: 30000
          maxAttempts: 60
```

四条硬约束（都有测试钉住，改之前先看 `tests/horosa/**`）：

| # | 约束 | 判据 |
|---|---|---|
| 1 | `id` 必须是 `mcp-horosa`，`serverName` 必须是 `horosa` | 工具名前缀的唯一来源：`mcp__horosa__*` |
| 2 | URL **只能回环**：`http://127.0.0.1:8765/mcp` | 非回环不暴露；宿主 spawn 的 `--host` 同时钉在 `127.0.0.1` |
| 3 | `profile/package.json` **不动** | `@deepseek-ai/dsh-mcp-client` 由安装闭包提供（它是 `@deepseek-ai/dsh` 的 dependencies，而后者是本 profile 的直依赖）—— desktop profile 挂 `mcp-filesystem` 就是这么挂的 |
| 4 | 端口/路径**三方一致**：YAML 的 `8765`/`/mcp` = `scripts/isolation/defaults.mjs` = `packages/xuanshu-host/lib/horosa/constants.mjs` | YAML 无法 `import`，所以一致性由 **P2 测试**钉住。**字面量只许出现在这两个定值模块里**——范围是**生产代码路径**（`packages/xuanshu-host/lib/**`、`scripts/isolation/*.mjs`、`scripts/horosa/*.mjs`、`scripts/setup/**/*.mjs`、`scripts/*.mjs`），**注释不算**；测试 / fixtures / 文档本来就要写字面量做对照，**不在范围内** |

> **执行现状（2026-10-13 复核后收敛）**：P2 测试的扫描范围**与上面这条规则一致**——宿主 `packages/xuanshu-host/lib/**`（递归）
> + `scripts` 顶层 + `scripts/{isolation,horosa,setup}`（递归），排除 `node_modules` 与注释，白名单只有那两个定值模块。
> 判据取的是「**定义处**」而不是子串：端口只认「独立数字且**不在字符串字面量里**」、路径只认「恰好等于 `/mcp` 的**带引号字面量**」——
> 所以检查 id `'horosa8765'`、`import './mcp-client.mjs'`、用法提示里的 `--port 8765` 都不会被误伤，而真写出第三份定义时会当场变红。
> 历史上唯一一处（`scripts/isolation/horosa-guard.mjs` 的 `const DEFAULT_PATH = '/mcp'`）已改为 `import { HOROSA_MCP_PATH } from './defaults.mjs'`
> （Lead 授权，`tests/isolation` 36/36、P2 9/9 绿）。**当前没有已知的第二份定义。**

**「市场（dsh-mcp-connector）删除 UI 管不到它」是怎么成立的**——三条互相独立的机制，都能自己复验：

```powershell
cd <repo>
$xhome = "$PWD\.dsh-home"                       # 别用 $home：PowerShell 里 $HOME 是只读自动变量，赋值会直接报错
$env:DSH_HOME = $xhome
$bin = "$xhome\profiles\xuanshu\node_modules\@deepseek-ai\dsh\lib\bin.js"

# ① 行的来源是 profile 补丁层（不是市场 storage）：
node $bin --profile xuanshu --dump-config | Select-String -Pattern '^# ==|id: mcp-horosa'
#   → 最后一行层头是 `# == <repo>\.dsh-home\profiles\xuanshu\cordis.patch.yml`，
#     紧接着就是 `- id: mcp-horosa`（本机 2026-10-13 实测：层头在 386 行、行在 387 行）
#   完整原始输出：captures/horosa-dump-config.txt

# ② 市场类插件的连接记录里没有 horosa（我们从不写它）：
Get-Item "$xhome\storages\mcp_connector.json" -ErrorAction SilentlyContinue | Select-String -Pattern 'horosa'
#   → 无输出（文件不存在，或存在但没有任何 horosa 记录）。别写 `Select-String -Path <不存在的文件>`：
#     那条路会打印「找不到路径」错误，看起来像检查失败

# ③ 市场插件本身不在 profile 的 bundles 里：
((Get-Content "$xhome\profiles\xuanshu\package.json" -Raw -Encoding utf8) | ConvertFrom-Json).dsh.profile.bundles
#   → @deepseek-ai/dsh-base / @deepseek-ai/dsh-headless / xuanshu-host / xuanshu-client
#     （没有 dsh-mcp-connector / dshmarket）
#   `-Encoding utf8` 不能省：默认按 cp936 读时中文描述会被解成乱码，ConvertFrom-Json 直接报错

# ④ 这行真的解析得到包（`status` 不是 error）——注意这一步要用 --dump-config-schema：
node -e "const j=JSON.parse(require('node:fs').readFileSync('.scratch/assembly-foundation/captures/horosa-dump-config-schema.json','utf8'));console.log(j['x-cordis'].entries.filter(e=>e.id==='mcp-horosa'))"
#   → [{ path:'/98', id:'mcp-horosa', name:'@deepseek-ai/dsh-mcp-client', status:'schema', configRef:'#/$defs/config66' }]
#     status='schema' = 行与它的包都解析到了（`error` 才是缺包）；x-cordis.complete 同时为 true
```

① 的证据：`captures/horosa-dump-config.txt`（`--dump-config` 每换一层打一行 `# ==`，
所以「这行是谁插的」在输出里直接可读）；④ 的证据：`captures/horosa-dump-config-schema.json`。

## 2. 宿主托管的六步

装配后 `xuanshu-host` 插件行（`packages/xuanshu-host/lib/horosa/service.mjs`）按固定顺序托管 horosa，
**每一步都是「先判后做」，失败只落状态文件，永不抛、永不拖垮装配**：

| 步 | 做什么 | 判据 / 落点 |
|---|---|---|
| 1 · **plan** | 读 setup 报告（`<dsh-home>/xuanshu/setup-report.json`）定位 wheel 与运行时根，解析出 uvx / runtimeRoot / dataDir / host / port | 报告缺 → `code:'setup-report-missing'` + `hint` 指向 `pnpm setup:xuanshu` |
| 2 · **ensure runtime** | 读 `<runtimeRoot>/current/runtime-manifest.json`，把 `runtime_payload_version`（回退 `version`）与 pin 版本比对 | 未装 → `runtime-not-installed`；版本不符 → `runtime-version-mismatch`。**两种都不起 serve**，`hint` 都是 `pnpm setup:xuanshu` |
| 3 · **端口四态** | `checkHorosaEndpoint()`：`free` / `horosa-ready` / `occupied-foreign` / `probe-failed` | `free` → 起；`horosa-ready` → **复用**（`started:false, pid:null`）；`occupied-foreign` → 拒绝；`probe-failed` → fail-closed 拒绝（**无法判定 ≠ 被占**） |
| 4 · **spawn serve** | `<uvxBin> --from <wheel> horosa-skill serve --host 127.0.0.1 --port <port>`，env 带 `HOROSA_RUNTIME_ROOT` / `HOROSA_SKILL_DATA_DIR` / `HOROSA_SKILL_HOST` / `HOROSA_SKILL_PORT` | stdio **直接落 `<dataDir>/serve.log`**（fd，不给子进程留管道——留管道会撞上游 Python logging 的 `BrokenPipe`） |
| 5 · **健康判据** | **判据 = MCP 握手**：`initialize` 拿到 200 **且**响应头有 `mcp-session-id`（`tools/list` 非空是第二重） | 轮询到就绪才落 `phase:'ready'`；等不到按超时处置 |
| 6 · **dispose** | 只收**自己起的**那份 serve（`keepServeOnDispose:true` 可留） | 模块内 spawn 登记表（pid → entry）；表外 pid 一律拒绝。Windows 用 `taskkill /PID <pid> /T /F` 收进程树（uvx → uv → python 三层），POSIX 进程组 `SIGTERM` → `SIGKILL` |

> **起 serve 失败时也会把 pid 记下来**：失败路径如果**已经 spawn 出进程**（起得来但答不出 / 端口被抢 / 超时）
> 且**清理没成功**（`evidence.cleanedUp !== true`），`status.serve` 会记成 `{ started:true, pid:<pid>, cleanedUp:false }`；
> 于是 **dispose 仍能收掉自己起的那一份**，不会在 8765 上留下我们自己起的孤儿（`cleanedUp` 就是这件事的状态位）。
> 这条是双轴评审后 T1 补的——**丢了 pid 等于把自己的 serve 丢在端口上不管**（R5 的漏水口）。

**`startHorosaServe().verdict` 的口径（冻结，别按「起完之后端口是什么态」去读它）**：
`verdict` = **进门那一刻**的四态裁决 —— 新起一份时是 **`free`**（正因为空着才起），起完之后的端口状态在
`evidence.verdict`（= `'horosa-ready'`），握手细节在 `evidence.handshake`；复用既有实例时 `verdict = 'horosa-ready'`；
被拒时是 `'occupied-foreign'` / `'probe-failed'`；非回环则是 `'non-loopback-host'`。
所以「`verdict==='free'` 但状态文件里 `endpoint.verdict==='horosa-ready'`」**不是矛盾**，是同一件事的两端。

「只停自己起的」是**唯一授权来源**：`stopHorosaServe(pid)` 对登记表外的 pid 一律 `ok:false` 拒绝，
**没有任何按名字/按端口找进程再杀的路径**。上游明令 `:9999` / `:8899` 是用户桌面版星阙的端口——永不触碰、永不测试。
副作用是**硬杀 DSH 会留下一个在跑的 serve**（Windows 上不给子进程发信号，谁也执行不了清理代码）：
这不是漏杀，下次装配看到 `horosa-ready` 会**复用**它（§2 第 3 步），而不是起第二个。

起一次要多久（本机 2026-10-13 实测，`captures/gt06-summary.json`）——**四个数别混**：

| 量 | 实测 | 出处 |
|---|---|---|
| **首次起 serve**（`startServe` → MCP 就绪，runtime 还没跑起来） | **22203ms** | `serve.detail` 的「耗时 22203ms」 |
| MCP `initialize` 握手（serve 已在跑） | **22ms** | `initialize.ms` |
| 单次 `tools/call` 出盘（八字） | **≈1.27s** | `cases.*.ms` = 1267 / 1271 / 1260 |
| `tools/list` | **30ms**，**120** 条工具 | `toolsList.ms` / `toolsList.count` |

所以 `toolCallTimeoutMs: 300000` 与 `startupWaitMs` 的宽预算不是保守，是**首次起 serve 的真实量级**。

## 3. 宿主侧服务与 `/xuanshu-horosa` 命令

装配时插件 `ctx.provide('xuanshuHorosa', service)`（拿不到 `provide` 就跳过并记 note），
同一进程内多次装配**共用一份**（幂等）。服务面：

| 方法 | 语义 |
|---|---|
| `status()` | 读状态（**不产生副作用**） |
| `ensure()` | 解析 plan → ensure runtime → 落状态 |
| `start()` | ensure 通过 → 四态裁决 → spawn → 等 MCP 就绪 → 落状态 |
| `stop()` | 停掉自己起的那份（别人的一律拒绝） |
| `waitReady(ms)` | 在不自动起的前提下，等**外部** serve 就绪 |
| `baziBirth(input)` | `buildBaziPayload` → `tools/call horosa_cn_bazi_birth` → `classifyBaziEnvelope` → 落 `status.bazi` |
| `snapshot()` | 紧凑快照（路径 / config / plan / 状态），给命令与排障用 |
| `persistStatus(phase, patch)` / `dispose()` | 立即落一次状态文件（装配时用 R7）/ 收尾（停自己起的 serve，`keepServeOnDispose` 可留） |

人类入口是一个命令（`commands` service 在场时注册，`ctx.effect` 包裹）：

```
/xuanshu-horosa                                     # 缺省 = status
/xuanshu-horosa status
/xuanshu-horosa start
/xuanshu-horosa stop
/xuanshu-horosa bazi date=1990-01-01 time=12:00 zone=+08:00 lat=31n14 lon=121e29
/xuanshu-horosa bazi date=… time=… zone=… lat=… lon=… [gender=1] [timeAlg=1|3] [clarificationNotes=…]
```

`bazi` 的五个出生字段（`date`/`time`/`zone`/`lat`/`lon`）**必填**，缺任一命令直接回用法错（缺经纬度不许出盘）；
其余键可选。返回 `{ kind: 'success' | 'error', text }`，`text` 是一行人类可读摘要（不是 JSON）——
例如 `status` 回 `horosa ready：… 端点 http://127.0.0.1:8765/mcp（verdict=horosa-ready，工具 120）｜ 处置：…`。
真实状态以状态文件为准（§5）——命令只是给人看的入口。

## 4. 上游 seam 契约 CLI：`bazi-contract.mjs`

用途：**不经过 DSH，直打 `127.0.0.1:8765/mcp`**，把「信封结构 / `timeAlg` 缺省口径 / 澄清闸」变成可复跑的命令。

```powershell
cd <repo>
node scripts/horosa/bazi-contract.mjs                     # 人读摘要
node scripts/horosa/bazi-contract.mjs --json              # stdout 只有一份 JSON 报告
node scripts/horosa/bazi-contract.mjs --port 8765 --path /mcp --timeout-ms 300000
node scripts/horosa/bazi-contract.mjs --fixture scripts/horosa/bazi-fixture.json --out .scratch/assembly-foundation/captures/bazi-contract-raw.json
```

四组断言（全绿 → exit 0）：

| # | 断言 | 判据 |
|---|---|---|
| 1 | `tools/list` 含 `horosa_cn_bazi_birth` | 工具名逐字 |
| 2 | **信封结构** | `ok===true`、`tool==='bazi_birth'`、`version===pin.version`、`data` 非空、`error===null`、顶层键 ⊇ `['ok','tool','version','data','summary','warnings','error']`、`data.technique_card` 存在且 `technique_card.versions.runtime === pin.version` |
| 3 | **`timeAlg` 缺省口径** | 同一份 fixture 跑三档（省略 / `1` / `3`），断言 `techniqueCard.settings.timeAlg.value === 0 / 1 / 3` |
| 4 | **澄清闸拦截** | 不带 `agent_confirmed_settings` / `defaults_accepted` 调一次 → `phase==='gate'`、`code==='agent_guidance.required'`、`questions.length > 0`、`promptToUser` 非空、**四柱不可读**（`classifyBaziEnvelope(...).pillars === null`）；再带确认调一次 → `phase==='ok'` 且四柱可读 |

> 第 4 组的判据是 **`pillars === null`**，不是「`data` 为空」——「`data` 空」只是本机实测的结果，
> 上游换个版本给个空壳也仍然是拦截。**闸不是 JSON-RPC error**：HTTP 200 + `result.isError:false` + 信封照回，
> 只有信封 `ok:false`（§0.2）；所以「调用成功」与「出盘成功」是两件事。

退出码（与票 05 同口径）：

| 码 | 含义 | 你该做什么 |
|---|---|---|
| **0** | 四组断言全过 | — |
| **1** | 断言失败（信封/口径/闸/结构不符） | 看报告里失败那条的 `detail` 与原始信封；别改 fixture 去凑绿 |
| **3** | 环境门（8765 没人在答 / pin 读不到 / MCP 握手不成） | 先起 horosa（宿主会自动起，或 `setup.mjs` 自检会起），再复跑 |

两条单源约束（评审会问）：载荷**必须**来自 `packages/xuanshu-host/lib/horosa/bazi.mjs::buildBaziPayload`，
断言**必须**来自 `classifyBaziEnvelope`——CLI 里**不重写**判据，也不自己拼 payload。
fixture 固定为 `scripts/horosa/bazi-fixture.json`（写死的合成生日，**非真人**），**不许改它**。
`--json` 时 stdout 只有一份 JSON；`--out` 落原始证据（信封全文，≤2MB 截断）。

### 4.1 `timeAlg` 的坑（照抄实测，别再踩）

`timeAlg` 三档**四柱完全相同**——上海 1.48° 经度差 + 均时差 ≈ **+2m34s**，跨不了时支。
所以**四柱不能当 `timeAlg` 的判据**，只能用：

| 传入 | 首选判据 `technique_card.settings.timeAlg.value` | 次选 `input_normalized.timeAlg` | `snapshot_text` 口径行 |
|---|---|---|---|
| **省略（玄枢默认）** | **0** | **0** | `时间算法：真太阳时` |
| `timeAlg: 1` | 1 | 1 | `时间算法：直接时间` |
| `timeAlg: 3` | 3 | 3 | `时间算法：平太阳时(仅经度)` |

原始证据：`.scratch/assembly-foundation/captures/gt06-summary.json`（三档 `timeBasisHits` + 四柱 +
`gt06-envelope-{default,clock,meansolar}.json` 全文）。

## 5. 状态文件

每次状态变化都**重写**一份原子写的 JSON：

```
<dsh-home>/xuanshu/horosa/horosa-status.json      # schema: xuanshu/horosa-status@1
```

| 字段 | 含义 |
|---|---|
| `schema` / `generatedAt` | 固定标识 / 生成时刻 |
| **`ok`** | **「这一步没有失败」，不是「serve 在跑」**：`stopped`（正常收工）与 `idle`（已装配、等自启）都是 **`true`**；`blocked` / `foreign` / `stop()` 被拒（`code:'not-ours'`）才是 `false`。**判「底座在不在跑」看 `phase === 'ready'` 与 `serve.started`/`serve.pid`，不看 `ok`** |
| `phase` | `idle` \| `ensuring` \| `starting` \| `ready` \| `blocked` \| `foreign` \| `stopped` |
| `code` / `detail` / `hint` | 失败码 / 人读细节 / **下一步该跑什么**（`hint` 永远指向可执行的处置） |
| `runtime` | `{ root, installed, version, expectedVersion }` |
| **`plan`**（plan 解析成功后就有；即使随后 runtime 门判 `blocked`，也带着它） | `{ version, wheel, wheelExists, uvxBin, host, port, source, runtimePayloadVersion }` —— 「这些值是从哪来的」的完整答案；`source` 说明 wheel 命中链（`config-wheel` / `XUANSHU_HOROSA_WHEEL` / `setup-report` / `cache-dir`）。**`wheelExists:false` 时 `hint` 指向 `pnpm setup:xuanshu`**（缺件先跑 setup，而不是翻 serve 日志猜） |
| `serve` | `{ started, pid, reused, logFile, readyMs }`（复用别人的实例时 `started:false, pid:null`）。**起 serve 失败但已 spawn 出进程、且清理没成功时会带 `cleanedUp:false`**——此时 `pid` 仍会被记下，**dispose 仍能收掉它**（见 §2 第 6 步的注） |
| `endpoint` | `{ host, port, url, verdict, sessionId, toolCount }`（`verdict` = 四态词表） |
| `bazi`（可选） | `{ lastPhase, lastTool, lastVersion, pillars }` —— 最后一次出盘的结果 |

看它：

```powershell
# 先看结论（phase / ok / code / hint 一眼就够）：
$s = Get-Content "$PWD\.dsh-home\xuanshu\horosa\horosa-status.json" -Raw -Encoding utf8 | ConvertFrom-Json
$s.phase, $s.ok, $s.code, $s.hint
# 再看计划与端点：
$s.plan | Format-List; $s.endpoint | Format-List
```

> 读法两条：**① `ok` 不代表在跑**（正常 `stop` 之后是 `ok:true, phase:'stopped'`，那不是故障）；
> **② 排障第一眼看 `code` + `hint`**，`plan.wheelExists` 与 `runtime.expectedVersion` 是第二眼。

## 6. 补丁行的 config 键

全部**有缺省**（本票默认值即生产形态，`xuanshu-host` 行本身不带 `config`；要改就改这行）：

| 键 | 缺省 | 用途 |
|---|---|---|
| `enabled` | `true` | 关掉 = 这一行完全不托管（不影响 MCP 客户端行本身） |
| `autoStart` | `true` | 装配后是否自动起 serve |
| `startDelayMs` | `2000` | `apply` 后延迟多久起（后台任务，`unref` 定时器，dispose 清掉） |
| `startupWaitMs` | `60000` | 等就绪的总预算 |
| `keepServeOnDispose` | `false` | dispose 时留下自己起的 serve（开发时想接着用才开） |
| `host` | `'127.0.0.1'` | 只能回环（非回环 → `code:'non-loopback-host'`，拒绝起） |
| `port` | `8765` | 与 `scripts/isolation/defaults.mjs` 同源 |
| `runtimeRoot` | 解析得出 | 覆盖 `HOROSA_RUNTIME_ROOT` |
| `dataDir` | `<dsh-home>/xuanshu/horosa` | 覆盖数据目录（状态文件与 `serve.log` 都在它下面） |
| `wheel` | 从 setup 报告解析 | 显式指定已校验的 wheel |
| `uvxBin` | `uvx` | 覆盖 `uvx` 可执行文件 |

> **键以 §3.2 的 11 个为准**（前 7 个有实值缺省、后 4 个缺省 `undefined` = 交给解析链），上表与契约
> 「config 键表（以 §3.2 的 11 个为准）」和实现（`lib/horosa/service.mjs` 的 `DEFAULT_CONFIG`，注释同样指向 §3.2 末表）**逐字一致**。
> 契约早期措辞里的「八个 config 键」是笔误，**已修**。

## 7. 排障手册

先记住一个总原则：**宿主永远不抛异常**。所以「起不来」的证据只有两处——状态文件（§5）与 `serve.log`。

| 现象 | 看哪里 | 处置 |
|---|---|---|
| 工具列表里没有 `mcp__horosa__*` | **`--dump-config-schema`**（JSON）里 `mcp-horosa` 行的 `status`（`--dump-config` 是 YAML，没有 `status` 字段） | `status === "error"` → 看该行错误（多半是 `@deepseek-ai/dsh-mcp-client` 没进安装闭包）：重装 profile `node scripts/install-profile.mjs --home <home>`。本机正常态是 `status: "schema"`。**注意它是异步注册的**：本机实测 boot 刚完成时工具表 27 条、一条 `mcp__horosa__*` 都没有，等 MCP 客户端行连上（≈15s 内）才变成 147 条（其中 120 条是 horosa）——**别在启动那一秒下结论** |
| 改了 `packages/xuanshu-host/**` 但行为没变 | `install-profile.mjs` 输出里的 `own-package` 两行 + `profile/node_modules/xuanshu-host/` 里那份的大小/时间 | 见 §7.1：profile 里是 **pnpm 物化的拷贝**，跑一次 `node scripts/install-profile.mjs --home <home>`（`--skip-install` 也行）就会**逐文件同步**自有插件；同步后用 `Get-FileHash` 两行比对确认 |
| 状态文件 `code: "setup-report-missing"` | `<dsh-home>/xuanshu/setup-report.json` 不存在 | 先跑 `pnpm setup:xuanshu`（它才会取件、钉版 runtime、写报告） |
| `code: "runtime-not-installed"` / `"runtime-version-mismatch"` | `status.runtime.{installed,version,expectedVersion}` 与 `<runtimeRoot>/current/runtime-manifest.json` | 未装/版本不符 → `node scripts/setup.mjs --force`（同版本硬门：**禁止新树混旧 runtime**），再 `node scripts/setup.mjs --verify-only` |
| 状态文件 `phase: "foreign"`（`endpoint.verdict: "occupied-foreign"`） | `hint` 里的查占用命令 | `netstat -ano \| findstr :8765` → 看清是谁再决定；**绝不 kill 别人的进程**。要么腾端口，要么同时改 `HOROSA_SKILL_PORT` 与 `XUANSHU_HOROSA_PORT`（`--horosa-port`） |
| 状态文件 `endpoint.verdict: "probe-failed"` | 同上，但**这不是「被占」** | 有人 LISTEN 但预算内零 HTTP 响应 → **无法判定**：先用**加长预算**复探 `node scripts/isolation/horosa-guard.mjs --port 8765 --timeout 5000`；慢应答的冷启动 horosa 正是这一格的常见成因。宿主 fail-closed 拒绝起第二份是对的 |
| 一直起不来（`phase: "starting"` 超时） | `<dataDir>/serve.log` 的尾巴（状态文件 `serve.logFile` 给绝对路径） | 冷启动分钟级；把 `startupWaitMs` 调大而不是反复重跑。日志里 `BrokenPipe` / 端口占用 / Python traceback 是三类不同病因 |
| `code: "non-loopback-host"` | 补丁行的 `config.host` | 改回 `127.0.0.1`（或 `::1` / `localhost`）。**非回环不暴露**是设计，不是配置疏漏 |
| DSH 起不来（而不是 horosa 起不来） | 装配报告 `<dsh-home>/xuanshu/assembly-report.json` | 这不该发生（`failOnStartupError: false` + 宿主侧永不抛）；真发生就按票 01 的装配排障走，并**贴状态文件**回报 |

> **端口「有人占着」的唯一判据是 `LISTEN`**：`netstat -ano | findstr :8765` 会把上一次连接留下的
> `TIME_WAIT` 残迹也打出来（本机 2026-10-13 实测：8765 完全空闲时仍有 4 条 TIME_WAIT），别把它当成「被占」。
> 要确认就 `Get-NetTCPConnection -State Listen -LocalPort 8765`（无输出 = 真的空着）。

### 7.1 改了宿主插件怎么生效（profile 里是拷贝，不是链接）
`profile/` 是 `link` 模式装配到 `$DSH_HOME/profiles/xuanshu`（junction），但**插件包本身是 `pnpm install` 物化的拷贝**：
`file:../packages/xuanshu-host` 这个依赖解析成真目录，不是符号链接。本机 2026-10-13 实测（`Get-FileHash`）：

| 文件 | 大小 | 修改时间 |
|---|---|---|
| `packages/xuanshu-host/lib/index.js`（真身） | 16353 B | 2026-10-11 20:46:48 |
| `profile/node_modules/xuanshu-host/lib/index.js`（profile 里那份） | 16283 B | 2026-10-11 20:20:45 |

两份**哈希不同**，profile 里是旧快照 —— 因为 pnpm 对 `file:` 依赖**按 lockfile 快照复用**，源目录变了也不会刷新
（输出照样是 `Lockfile is up to date` / `reused`）。**`install-profile.mjs` 已经把这件事兜住了**：
无论哪种模式，跑完 `pnpm install` 之后它都会**逐文件同步自有插件包**（`packages/xuanshu-host`、`packages/xuanshu-client`）
进 profile 的 `node_modules/`，并打印一行统计：

```
[install-profile] own-package xuanshu-host: 同步了 2 个文件（9 个已相同）——pnpm 对 file: 依赖不会因源目录变化而刷新拷贝
[install-profile] own-package xuanshu-client: 已是最新（11 个文件逐一比对相同）
```

所以日常动作就是**跑一次 `install-profile`**：

```powershell
# 改完 packages/xuanshu-host/**（或 packages/xuanshu-client/**）之后：
node scripts/install-profile.mjs --home "$PWD\.dsh-home"
#   → 看 own-package 那两行：出现「同步了 N 个文件」就是刷新了；「已是最新」= 本来就是新的
node scripts/install-profile.mjs --home "$PWD\.dsh-home" --skip-install   # 不跑 pnpm，只刷新自有插件（等价的最小动作）
```

`--skip-install` **也会做这次同步**（它等价于「只刷新自有插件」），所以「只想让代码生效、不想重跑 pnpm」时用它最快。
同步完仍可用哈希自检（**权威判据**，别只看日志）：

```powershell
(Get-FileHash packages\xuanshu-host\lib\index.js).Hash
(Get-FileHash profile\node_modules\xuanshu-host\lib\index.js).Hash      # 两行必须一致
Test-Path profile\node_modules\xuanshu-host\lib\horosa\service.mjs     # 新增目录也要真的物化
```

忘了这一步的症状是「代码明明改了、DSH 里的行为没变」——`--dump-config` 一切正常，但加载的是旧快照；
更隐蔽的一种是 `lib/horosa/**` 根本没进 profile，于是 `installHorosa` 压根不存在（宿主侧行为完全缺席）。
（`profile/node_modules/` 已在 `.gitignore` 里，不进版本库。）

`serve.log` 的位置（两种口径一致）：

```powershell
# 状态文件里直接给绝对路径：
(Get-Content "$PWD\.dsh-home\xuanshu\horosa\horosa-status.json" -Raw | ConvertFrom-Json).serve.logFile
# 或直接看：
Get-Content "$PWD\.dsh-home\xuanshu\horosa\serve.log" -Tail 50
```

## 8. 「非回环不暴露」

horosa 的 `serve` 默认绑 `127.0.0.1`（上游口径：非回环绑定无 token 会拒启）。玄枢把这条**做成硬门**而不是约定：

1. 补丁行的 `url` 只能写回环字面量（`127.0.0.1` / `::1` / `localhost`）；
2. 宿主解析配置时，`host` 不是回环字面量 → `code:'non-loopback-host'`，**拒绝起 serve**（不是"警告后照起"）；
3. spawn 的 `--host` 恒为 `127.0.0.1`，不跟随任何外部环境变量。

换句话说：**没有任何一条配置能把 horosa 暴露到局域网**。要远程用，就该走 DSH 自己的鉴权与隧道，而不是把这一行改成 `0.0.0.0`。

## 9. 与 `docs/runbook/setup.md` 的分工

两页讲的是同一个底座的两段时间，**不要互相替代**：

| | `docs/runbook/setup.md`（票 05） | 本页（票 06） |
|---|---|---|
| 管什么 | **装**：取件 → SHA256 校验 → 装 runtime → 装配 profile → 三项自检 | **用**：这一行怎么挂、进程谁托管、八字怎么出盘 |
| 触发时机 | 新机器 / 重装 / 上游升级 | 每次装配后自动（`autoStart`），或手动 `/xuanshu-horosa start` |
| 关键定值 | `scripts/setup/horosa-pin.json`（版本 + SHA256） | 端口/路径（`scripts/isolation/defaults.mjs` = `lib/horosa/constants.mjs` = YAML） |
| 失败长什么样 | 退出码 `1/2/3/4/5`（用法/取件/环境/安装/自检） | 状态文件 `code` + `hint`（宿主永不抛） |
| 会不会动你的进程 | 自检自己起 serve、跑完默认停掉（`--keep-serve` 可留） | dispose 默认收掉自己起的；**别人的一律不碰** |

两者共用同一份四态词表（`free` / `horosa-ready` / `occupied-foreign` / `probe-failed`）与同一份端口定值；
`setup.md` 的 C2 自检与本页 §2 的第 3 步判的是同一件事。

## 10. 相关

- `docs/adr/0008-horosa-static-mount-and-host-managed-lifecycle.md` —— 为什么是静态补丁行 + 宿主托管 + 宿主侧自带接缝库。
- `docs/runbook/setup.md` —— 安装 horosa 本体（取件 / 钉版 / SHA256 / 三项自检 / 升级 / 回滚）。
- `docs/runbook/dual-instance.md` —— 开发期双实例隔离（`8765` 单占用守卫的四态判定出处）。
- `.scratch/assembly-foundation/notes/horosa-integration-contract.md` —— 本票冻结契约（§0 真实地面真值）。
- `.scratch/assembly-foundation/captures/horosa-e2e-2026-10-13.md` —— 真实端到端证据（命令 + 退出码 + 原始输出尾巴）。
