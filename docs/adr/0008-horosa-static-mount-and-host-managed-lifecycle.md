# horosa 底座：静态补丁行 + 宿主托管生命周期 + 宿主侧自带接缝库

玄枢的地基是 horosa-skill（本地 MCP，命 + 运永远在场），它有三个特性同时成立：① 它是**必装品**——没有它玄枢就不是玄枢，用户不该有机会把它「顺手关掉」；② 它是**一个进程**——`serve` 要在 `127.0.0.1:8765` 上监听，起停要有人负责；③ 它是**分发物之外的东西**——宿主插件从 `<profile>/node_modules/xuanshu-host` 加载，仓库目录不在它的运行环境里（copy 模式、别人的机器上根本没有 `scripts/`）。

这三条各自否掉了一类做法：必装品不能挂在「市场管理的连接」上（那样它能被市场 UI 删掉）；一个进程不能没人负责生命周期（否则用户要手工 `horosa-skill serve`，而 DSH 启动顺序里没有它的位置）；而「宿主直接 import 仓库 `scripts/`」在分发形态下根本不成立。票 05 已经把「怎么装 horosa」钉死了（pin + SHA256 + 三项真实自检），本票要回答的是**装完之后它怎么一直活着**。

**决定：horosa 的 MCP 连接是 profile 补丁层里的一行静态 `insert`（`id: mcp-horosa`，回环 URL，非回环不暴露）；它的进程由宿主插件托管（ensure runtime → 端口四态 → spawn serve → MCP 握手判就绪 → dispose 只收自己起的那份），失败一律折算成状态文件里的 `code` + `hint`，永不抛、永不拖垮 DSH 启动；宿主侧**自带一份接缝库** `packages/xuanshu-host/lib/horosa/**`，不 import 仓库 `scripts/horosa/**`。**

具体定值：

1. **静态补丁行是「默认自带、不可删除」的机制本体**：`profile/cordis.patch.yml` 在 bundle 层之后插入
   `{ id: mcp-horosa, name: '@deepseek-ai/dsh-mcp-client', config: { transport: streamable-http, serverName: horosa, url: http://127.0.0.1:8765/mcp, … } }`。
   三条互相独立的判据证明「市场删除 UI 管不到」：行的来源是版本库里的 profile 补丁层（`--dump-config` 的 `# == <profile>/cordis.patch.yml` 段里可读到）、
   市场类插件的连接记录 `$DSH_HOME/storages/mcp_connector.json` 里**没有** horosa（我们从不写它）、
   `dsh-mcp-connector` / `dshmarket` 不在 `dsh.profile.bundles` 里。
2. **`profile/package.json` 不动**：`@deepseek-ai/dsh-mcp-client` 由**安装闭包**提供（它是 `@deepseek-ai/dsh` 的 dependencies，而后者是本 profile 的直依赖）——desktop profile 挂 `mcp-filesystem` 就是这么挂的（它对 dsh-mcp-client 也没有直依赖）。
3. **回环是硬门，不是约定**：URL 与 spawn 的 `--host` 都钉在 `127.0.0.1`；宿主解析配置时非回环字面量 → `code:'non-loopback-host'`，**拒绝起 serve**。补丁行的 `toolCallTimeoutMs: 300000` 与 `failOnStartupError: false` 是配套的：首调要拉起 runtime（冷启动分钟级），而 horosa 没起**不许**拖垮 DSH 启动（靠 `reconnect` 自愈）。
4. **宿主托管六步，每步先判后做**：plan（读 setup 报告）→ ensure runtime（比对 `<runtimeRoot>/current/runtime-manifest.json` 的 `runtime_payload_version` 与 pin）→ 端口四态 → spawn `serve`（stdio 直接落 `<dataDir>/serve.log` 的 fd）→ **健康判据 = MCP 握手**（`initialize` 200 且响应头有 `mcp-session-id`；`tools/list` 非空是第二重）→ dispose 收掉自己起的那份。
   runtime 未装 / 版本不符**都不起 serve**，只给 `code`（`setup-report-missing` / `runtime-not-installed` / `runtime-version-mismatch`）+ `hint`（`pnpm setup:xuanshu`）。
5. **四态词表复用票 04，不新造**：`free` → 起；`horosa-ready` → **复用**（`started:false, pid:null`）；`occupied-foreign` → 拒绝启动；`probe-failed` → fail-closed 拒绝（**「无法判定」≠「被占」**：慢应答的冷启动 horosa 正是这一格）。
6. **只停自己起的**：模块内 spawn 登记表（pid → entry）是唯一授权来源，表外 pid 一律 `ok:false` 拒绝；**没有**任何按名字/按端口找进程再杀的路径。Windows 用 `taskkill /PID <pid> /T /F` 收进程树（uvx → uv → python 三层，只有 `/T` 收得全），POSIX 进程组 `SIGTERM` → `SIGKILL`。上游明令 `:9999` / `:8899` 是用户桌面版星阙的端口——永不触碰、永不测试。
7. **失败面只有两处可观察物**：状态文件 `<dsh-home>/xuanshu/horosa/horosa-status.json`（schema `xuanshu/horosa-status@1`，原子写，每次状态变化都重写）与 `<dataDir>/serve.log`。装配 `apply` 立即返回（起 serve 是 `unref` 的后台定时任务，dispose 清掉），任何异常只记日志 + 落状态文件。
8. **上游 seam 契约 CLI 直打回环**：`scripts/horosa/bazi-contract.mjs`（四组断言：工具在不在 / 信封结构与 `technique_card.versions.runtime` / `timeAlg` 三档口径 / 澄清闸拦截→带确认重出盘），退出码 `0` 全过 / `1` 断言失败 / `3` 环境门，与票 05 同口径。载荷来自宿主 `buildBaziPayload`、断言来自 `classifyBaziEnvelope`（**单源**，CLI 不重写判据）。
9. **宿主侧自带接缝库**（`packages/xuanshu-host/lib/horosa/**`：`constants` / `paths` / `plan` / `guard` / `serve` / `bazi` / `service`）：导出名冻结，测试、CLI、文档都按它写。

**Considered Options**：

- **用市场插件（`dsh-mcp-connector`）管理这条连接**——被否：那正是「能被删掉」的形态。连接记录进 `$DSH_HOME/storages/mcp_connector.json`，市场 UI 一点就能断开，而 horosa 是玄枢的地基（ADR-0005 的同款逻辑：核心能力不做成用户可选项）。本票反而把「storage 里没有 horosa 记录」写成断言——**不可删除**必须是可验证的事实，不是口头承诺。
- **让用户手工 `horosa-skill serve`（文档写清命令）**——被否：这就是票 05 ADR-0007 否掉「在 README 里写一串手工步骤」的同一个理由。手工步骤里「ensure runtime 版本对不对」「端口上是不是别人」「该不该停」都是**必须每次都对**的判断，人肉执行等于每次重装都重新赌一次；而且 DSH 启动时没人保证它起没起，工具列表会静默空掉。
- **让 DSH 用 stdio transport 直接拉起 horosa（不起常驻 serve）**——被否：首次起 serve 要把 runtime 拉起来（本机实测 **22.2s** 才到 MCP 就绪，`captures/gt06-summary.json` 的 `serve.detail`；此后单次出盘只需 ≈1.27s），每次会话都付这笔钱；且 stdio 形态下「复用/别人的实例」这些语义全部消失，端口四态守卫与票 04 的判定就白做了。上游自己也有 `serve --transport stdio`，但那是给「不想占端口」的场景，不是给「常驻底座」的。
- **宿主 `import` 仓库 `scripts/horosa/**`（复用票 05 的 `serve-lifecycle.mjs` 与票 04 的 `horosa-guard.mjs`）**——被否：宿主插件是从 `<profile>/node_modules/xuanshu-host` 加载的**分发物**，仓库目录不在它的运行环境里（copy 模式 / 别人的机器上根本没有 `scripts/`）。这条否掉的不是「复用」，而是「把仓库路径当运行时依赖」。
- **把端口四态判定再写一份更简单的（只看 TCP/HTTP 状态码）**——被否：四态里最难的一格恰恰是 `probe-failed`（有人 LISTEN 但预算内零响应，**无法判定**），票 04 为它专门做过一次行为改变（原判 `occupied-foreign` → 制造假红）。简化版必然把「慢应答的 horosa」冤枉成「被占」，然后引导用户去 kill 一个无辜进程。
- **非回环时给个警告但照常起**——被否：无 token 的 MCP 端点暴露到局域网是**未鉴权的能力出口**，而「警告」在无人值守的启动路径里等于没发生。做成硬门（拒绝起 + `code`），要远程用就走 DSH 自己的鉴权与隧道。

**Consequences**：

- **欠下一笔明确的债：两台机器上有两份四态实现** —— `scripts/isolation/horosa-guard.mjs::checkHorosaPort`（票 04，启动器与 setup 自检用）与 `packages/xuanshu-host/lib/horosa/guard.mjs::checkHorosaEndpoint`（本票，宿主运行时用）。**这是有意的重复**：宿主是分发物、`scripts/` 不在它的环境里（上一节的第四条）。还债方式不是「合并成一个文件」，而是**两条钉子**：① **P1 parity 测试**——同一组现场（空闲端口 / 非 MCP 的 HTTP 服务 / 带 `mcp-session-id` 头的假 MCP）下两份实现给出**逐字相同**的 verdict；② 定值与词表同源（`free` / `horosa-ready` / `occupied-foreign` / `probe-failed`）。**改动其中一份必须同时跑 parity**，否则两份会各说各话，而症状是「UI 说就绪、CLI 说被占」这类最难查的假绿。
- 端口/路径定值有**三处**必须一致（YAML 无法 `import`，只能靠断言钉）：`profile/cordis.patch.yml` 的 `8765`/`/mcp` = `scripts/isolation/defaults.mjs` 的 `DEFAULT_HOROSA_PORT`/`HOROSA_MCP_PATH` = `packages/xuanshu-host/lib/horosa/constants.mjs` 的 `HOROSA_DEFAULT_PORT`/`HOROSA_MCP_PATH`。**P2 测试**钉住「谁再写一个 8765」这件事，但口径要写准：**字面量只许出现在这两个定值模块**（`defaults.mjs` + `constants.mjs`），范围是**生产代码路径**——`packages/xuanshu-host/lib/**`、`scripts/isolation/*.mjs`、`scripts/horosa/*.mjs`、`scripts/setup/**/*.mjs`、`scripts/*.mjs`（**排除注释**）；**测试 / fixtures / 文档不在范围内**（它们本来就该写字面量做对照）。
  **执行现状（2026-10-13 复核后收敛）**：P2 测试的扫描范围**已经与上面这条规则一致**——宿主 `packages/xuanshu-host/lib/**`（递归）+ `scripts` 顶层 + `scripts/{isolation,horosa,setup}`（递归），排除 `node_modules` 与注释，白名单只有上面那两个定值模块（**测试 / fixtures / 文档**自然不在其中）。
  判据取的是「**定义处**」而不是子串：端口只认「独立数字且**不在字符串字面量里**」（`const p = 8765` 命中、`log('8765 被占用')` 不命中、`'horosa8765'` 连正则都不匹配），路径只认「恰好等于 `/mcp` 的**带引号字面量**」（`import './mcp-client.mjs'`、用法提示里的 `--path /mcp` 都不命中）。所以提示文案与导入路径不会被误伤，而真写出第三份定义时会当场变红。
  历史：`scripts/isolation/horosa-guard.mjs` 曾自带 `const DEFAULT_PATH = '/mcp'`（票 04 当年只把 `8765` 换成常量、`/mcp` 漏了），2026-10-13 已改为 `import { HOROSA_MCP_PATH } from './defaults.mjs'`（Lead 授权；`tests/isolation` 36 用例全绿、P2 9 用例全绿）。**当前没有已知的第二份定义。**
- **这笔债不止四态判定：Windows 的 spawn 计划与日志解码也是抄件。** 宿主侧 `serve.mjs` 自带 `buildSpawnPlan`（`.mjs` / `.cmd`·`.bat` → `cmd /d /s /c` + `windowsVerbatimArguments` / 裸名三形态）、`quoteWindowsArg` 与 `decodeConsole` 各一份，语义与 `scripts/horosa/serve-lifecycle.mjs`（同名的前两者）和 `scripts/horosa/shared.mjs`（`decodeConsole`）一致——理由同样成立（宿主是分发物，不能 import 仓库 `scripts/`）。但 **P1 parity 只比 verdict，不覆盖这三处**：`decodeConsole` 撞上控制台代码页（cp936 等）时两边解码行为可能分叉，spawn 计划的引号/`PATHEXT` 处理更是「一改就只在一边生效」。所以钉子要写成两条：**① 改 spawn 计划或 `decodeConsole` 必须同时看两边（`packages/xuanshu-host/lib/horosa/serve.mjs` ↔ `scripts/horosa/serve-lifecycle.mjs` / `shared.mjs`）**；② 若将来要给它们上断言，先扩 P1 的比对面（同一份假 uvx，两边各起一次，比 argv/env 与解码结果），**别只盯 verdict**。目前记为**已知未覆盖**。
- 装配的失败面变安静了：宿主永不抛，所以「horosa 没起来」不会让 DSH 起不来，**代价是它也不会在启动时报错**。可观察物只有状态文件 + `serve.log`——排障必须先看状态文件的 `code`/`hint`，不能指望启动日志。这条写进了 runbook §7 的排障表。
- `timeAlg` 的判据必须写在 `technique_card.settings.timeAlg.value`（首选）或 `input_normalized.timeAlg`（次选）上，**不能看四柱**：本机实测（`captures/gt06-summary.json`）三档的四柱完全相同（上海 1.48° 经度差 + 均时差 ≈ +2m34s，跨不了时支）。这条坑写进 ADR 与 runbook，是因为它「看起来应该能测」——用四柱做的断言**永远为真**，是最典型的那种假绿。
- 澄清闸（`agent_guidance.required`）**不是** JSON-RPC error、也不是 `result.isError`：HTTP 200 + `isError:false` + 信封照回，只有信封 `ok:false`。所以「调用成功」与「出盘成功」是两件事，判定必须走 `classifyBaziEnvelope` 的四态（`ok` / `gate` / `error` / `invalid`），界面侧还要**原文展示** `agent_recovery.prompt_to_user`（不转述）、拦截期间不落谱、不点亮命盘卡。
- 本票**不做**的事：不做远程/非回环暴露（硬门拒绝）、不做 horosa 的自动升级（钉版在票 05，本票只读 pin 版本比对并对不上就拒绝起）、不托管用户桌面版星阙的进程、不写任何市场插件的连接记录（storage 只读）。
- 开发期多一个动作：想在不启动 DSH 的情况下验上游 seam，用 `node scripts/horosa/bazi-contract.mjs`（直打回环，四组断言 + 退出码 0/1/3）；想看宿主托管现状，看 `<dsh-home>/xuanshu/horosa/horosa-status.json`。完整命令、状态字段表、config 键与排障表见 `docs/runbook/horosa.md`。
