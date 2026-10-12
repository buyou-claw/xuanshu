# xuanshu-host — 玄枢主机插件（Node 侧）

玄枢（XuanShu）= **DSH profile `xuanshu` + 主机插件 `xuanshu-host` + 客户端插件 `xuanshu-client` + 内置 skills + setup 脚本**，纯装配、零 DSH 源码改动（ADR-0001）。本包是其中的**主机半边**。

## 它在装配里的位置

```
profile/xuanshu (dsh.profile.bundles)
  ├─ @deepseek-ai/dsh-base        ┐
  ├─ @deepseek-ai/dsh-headless    │ 各 bundle 的 cordis.patch.yml 依序叠加
  ├─ xuanshu-host     ← 本包 ─────┤ 本包的 dsh.bundle.patch 插入一行插件：
  └─ xuanshu-client               ┘   { id: xuanshu-host, name: xuanshu-host }
```

- `dsh.bundle.patch` → `cordis.patch.yml`：本包的 bundle 补丁，`insert` 一行 `id/name` 均为 `xuanshu-host` 的插件行（契约 §0/§3）。
- `lib/index.js`：那一行的实现，cordis 插件（`name` / `inject` / `apply`）。`inject` 刻意为空数组——不依赖任何宿主 service，所有 service 都用非严格 `ctx.get(name, false)` 软取，拿不到就降级并在报告 `notes` 里说明。
- 本包**不带** `dsh.client` 声明：浏览器半边属于 `xuanshu-client`。

## 运行时产物

`apply(ctx)` 只做纯本地文件操作 + 本地进程托管（**不调 LLM、不联网**；唯一开端口的地方是 horosa serve，且只绑回环 `127.0.0.1`，见下节。只 import `node:fs`/`node:module`/`node:os`/`node:path`/`node:url` 与本包自己的 `./horosa/service.mjs`）：

1. 建目录 `$DSH_HOME/xuanshu/`（`$DSH_HOME` 缺省 `~/.dsh`；契约 §0 数据目录）；
2. 写出 `$DSH_HOME/xuanshu/assembly-report.json`（schema `xuanshu/assembly-report@1`）——票 01 唯一的运行时可观察证据（seam S2）。写法是同目录临时文件 + `rename` 覆盖，保证读到的一定是完整 JSON；
3. 注册斜杠命令 `/xuanshu-report`：就地重探并重写报告后回报一行摘要（不依赖 LLM 的宿主侧可观察物，契约 §3 第 3 条）。`commands` service 不在场时静默跳过；
4. **票 06**：调 `installHorosa(ctx, config)` 装配 horosa 底座（服务 `xuanshuHorosa` + 命令 `/xuanshu-horosa` + 延后自启的本地 serve），见下节。

### 报告字段

| 字段 | 来源 |
|---|---|
| `schema` | 定值 `xuanshu/assembly-report@1` |
| `generatedAt` | 本次写出时刻（ISO 8601） |
| `ok` | 三项必查全过才 `true`：`profileContext` 可得 ∧ 两个插件包都在 profile 安装点解析到 ∧ 两行 id 都在本进程树中 |
| `profile.name` / `.dir` / `.dshHome` | `ctx.get('profileContext')`（`name`/`dir`/`home`）；不可得时按 `$DSH_HOME` 与契约 §0 推导并记 `notes` |
| `dsh.version` | 运行时解析 `@deepseek-ai/dsh`（退回 `dsh-headless`/`dsh-base`）的 `package.json.version`；都解析不到则留空串 |
| `runtime.node` / `.platform` | `process.version` / `process.platform` |
| `plugins['xuanshu-host']` / `['xuanshu-client']` | **运行时探测**：本包读模块旁的 `package.json`，对端包从 profile 安装点解析 `<包名>/package.json`；解析不到就**不留该键**并记 `notes`（不硬编码版本/路径） |
| `patchRowIds` | `[...ctx.get('loader').entries()]` 取每行 `Entry.options.id`，去重排序 = 本进程可见的补丁行 |
| `notes` | 降级与失败原因的自由文本（不伪造数据的地方都会在这里说清楚） |

`patchRowIds` 取 `Entry.options.id`（补丁行自身 id，与 `dsh --profile xuanshu --dump-config` 打印的 id 同形态），而不是 `Entry.id`——后者在 include 子树里是路径形态（`include:xuanshu-host`）。该数组是**忠实枚举**，会包含 app-boot 合成的根 include 行（`include`）与 group 行；要「只含补丁层行」的消费方自行过滤。

## horosa 底座（票 06）

玄学底座 horosa（上游 skill `0.40.1`）由**本插件托管生命周期**：profile 补丁里那一行静态
`mcp-horosa`（`transport: streamable-http`、`serverName: horosa`、回环 `http://127.0.0.1:8765/mcp`）
只管把工具名 `mcp__horosa__*` 挂进装配树；**进程**由这里的 `installHorosa` 负责起、复用、停。

```
packages/xuanshu-host/lib/horosa/
  constants.mjs  定值唯一来源（端口/路径/工具名/状态 schema；宿主侧不 import 仓库 scripts，见 ADR-0008）
  paths.mjs      resolveHorosaPaths（dshHome/dataDir/runtimeRoot/cacheDir/serve.log/状态文件/setup 报告）+ loopbackHost
  plan.mjs       readSetupReport / resolveHorosaPlan（pin 版本 + wheel + uvx）/ ensureRuntime（runtime 同版本门）
  guard.mjs      MCP 客户端（initialize/tools/list/tools/call，SSE 拿到应答即早停）+ 端口四态守卫
  serve.mjs      startHorosaServe / stopHorosaServe / ownsServe（只停自己起的；日志落 fd）
  bazi.mjs       buildBaziPayload / classifyBaziEnvelope（两个纯函数）
  service.mjs    createHorosaRuntime（状态机）+ installHorosa（装配入口，永不抛）
```

**装配 → 就绪的六步**：解析路径/配置 → plan（pin 版本取 `$DSH_HOME/xuanshu/setup-report.json`）→
`ensureRuntime`（读 `<runtimeRoot>/current/runtime-manifest.json` 的 `runtime_payload_version`，版本不符**不起 serve**）→
端口四态裁决 → `startHorosaServe`（`uvx --from <wheel> horosa-skill serve --host 127.0.0.1 --port <port>`，日志直接落
`<dataDir>/serve.log` 的 fd）→ 就绪判据 = **MCP 握手**（`initialize` 200 且带回响应头 `mcp-session-id`）。
`dispose` 时默认收掉**自己起的**那份（`keepServeOnDispose: true` 可留）。

**端口四态**（与票 04 的 `checkHorosaPort` 逐字同词表，两侧由 parity 测试钉住）。
`startHorosaServe().verdict` = **进门那一刻**的四态裁决（成功新起 → `'free'`，起完之后的状态在
`evidence.verdict='horosa-ready'`；复用 → `'horosa-ready'`；拒绝 → `'occupied-foreign'`/`'probe-failed'`/`'non-loopback-host'`）：

| verdict | 处置 |
|---|---|
| `free` | 没人 LISTEN：起 serve |
| `horosa-ready` | 已有 horosa MCP 在答：**复用**，不新起第二个实例 |
| `occupied-foreign` | 拿到了 HTTP 响应但不像 MCP：**拒绝启动**（绝不 kill 别人的进程） |
| `probe-failed` | 无法判定（慢应答 / 探针自身出错）：**fail-closed 拒绝启动**——「无法判定 ≠ 被占」 |

**非回环不暴露**：`config.host` 不是 `127.0.0.1`/`localhost`/`::1` → `code: 'non-loopback-host'` 拒绝起；
spawn 的 `--host` 恒为 `127.0.0.1`。`:9999`/`:8899` 是用户桌面版星阙的端口，永不触碰。

**服务 `xuanshuHorosa`**（`ctx.provide` 不可得就跳过）：`status()` / `ensure()` / `start()` / `stop()` /
`waitReady(timeoutMs)` / `baziBirth(input)` / `snapshot()`。**命令 `/xuanshu-horosa`**（`ctx.effect` 包裹注册）：
`status`（默认）/ `start` / `stop` / `bazi date=1990-01-01 time=12:00 zone=+08:00 lat=31n14 lon=121e29 [gender=1] [timeAlg=1|3]`。

**状态文件** `<dataDir>/horosa-status.json`（schema `xuanshu/horosa-status@1`，原子写，每次状态变化都重写）：
`{ schema, generatedAt, ok, phase(idle|ensuring|starting|ready|blocked|foreign|stopped), code, detail, hint,
runtime{root,installed,version,expectedVersion}, serve{started,pid,reused,cleanedUp,logFile,readyMs},
endpoint{host,port,url,verdict,sessionId,toolCount},
plan{version,wheel,wheelExists,uvxBin,host,port,source,runtimePayloadVersion},
bazi?{lastPhase,lastTool,lastVersion,pillars} }`。
`plan` 是 additive 顶层块（首次 `ensure()`/`start()` 之后才有值，排障第一眼看它）：
**`plan.wheelExists === false` = wheel 不在盘上** —— 它不是门（测试注入点会给还没落盘的路径），但会让 spawn 失败；
此时 `hint` 与 `detail` 都指向 `pnpm setup:xuanshu`（重新取件 + SHA256 校验），或改用 `config.wheel` / `$XUANSHU_HOROSA_WHEEL`。

**`ok` 的语义**（别读错）：`ok` = 「**这一步没有失败**」，**不是**「serve 正在跑」。
`phase:'stopped'`（正常收工，`detail` 写明已停）/ `idle`（已装配、等自启）/ `ready` 都 `ok:true`；
只有 `blocked`（环境门没过 / spawn 失败 / 超时 / `probe-failed`）、`foreign`（端口被非 horosa 占）
以及带 `code` 的失败（如 `stop()` 被拒 `not-ours`）是 `ok:false`。
**判「底座在不在跑」看 `phase === 'ready'` 与 `serve.started`/`serve.pid`，不看 `ok`。**

**`serve.cleanedUp`**（失败路径的收尾契约）：`true` = 没有「自己起过、还没收掉」的进程
（含「压根没起来」）；`false` = 起 serve 失败后**清理没成功**，`serve.pid` 指向一个仍活着的自己人。
`stop()` / `dispose()` 收尾取 **`serve.pid` ∪ `serve.mjs` 登记表里未收掉的 pid** 的并集，
所以即使状态记漏也会被收掉；没收干净的 pid 会留在状态里、下次 `start`/`stop` 再试（R5：只停自己起的）。

数据目录缺省 `$DSH_HOME/xuanshu/horosa/`。

**config 键**（补丁行的 config，全部可选、全部有缺省；本次 `cordis.patch.yml` 不带 config，缺省即生产形态）：
`enabled(true)` / `autoStart(true)` / `startDelayMs(2000)` / `startupWaitMs(60000)` /
`keepServeOnDispose(false)` / `host('127.0.0.1')` / `runtimeRoot` / `dataDir` / `wheel` / `uvxBin` / `port`。
端口解析链（R10）：**`config.port`（数字或数字字符串都认）> `$XUANSHU_HOROSA_PORT` > `HOROSA_DEFAULT_PORT`**；
`port` 刻意**不进缺省值**，否则会遮住 env 注入点（断言台正是用 env 顶端口起用例的）。
改端口时记得同步改 profile 补丁里那一行的 URL 端口（两处必须一致）。

**出盘口径**（`baziBirth`）：`buildBaziPayload` 只透传出生五字段 +（可选）`timeAlg`，并注入确认闸
（`agent_confirmed_settings: true` + `clarification_notes`）；`timeAlg` 缺省或 `0` → **键省略**（引擎缺省 = 真太阳时），
`1`/`3` 透传，缺经纬度**拒绝出盘**（防静默退化成钟表口径）。`classifyBaziEnvelope` 把信封分成
`ok` / `gate`（`agent_guidance.required`，原文带出 `promptToUser`）/ `error` / `invalid` 四相；
`baziBirth().pillars` 是 4 槽数组 `[年,月,日,时]`（时柱来自上游 `fourColumns.time`）。

**测试注入口**（缺省一律 = 真实路径）：`XUANSHU_UVX_BIN` / `XUANSHU_HOROSA_WHEEL` / `XUANSHU_SETUP_REPORT` /
`XUANSHU_HOROSA_DATA_DIR` / `XUANSHU_HOROSA_AUTOSTART=0` / `HOROSA_RUNTIME_ROOT`。

排障手册见 [`docs/runbook/horosa.md`](../../docs/runbook/horosa.md)；为什么宿主侧自带一份接缝库、以及
「两份四态实现」这笔债，见 [`docs/adr/0008-horosa-static-mount-host-managed-lifecycle.md`](../../docs/adr/0008-horosa-static-mount-host-managed-lifecycle.md)。

## 用法与自检

```powershell
# 导入自检（DoD）：导出 apply 函数
node --input-type=module -e "const m = await import('file:///E:/ai_project/XuanShu/packages/xuanshu-host/lib/index.js'); console.log(typeof m.apply, m.name)"
```

真正「装进树里、状态激活、报告写出」的验证由票 01 的**装配契约测试台**负责（`tests/assembly/`，
S1–S5），不放在本包内。本包**不带**自己的验证脚本：一次性的手写探针属于侦察草稿
（`.scratch/**`，gitignore），不进提交物。
