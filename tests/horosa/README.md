# tests/horosa — horosa 集成断言台（票 06）

票 06 的验收面：**profile 里的静态挂载行**能不能被装配树认出来、**宿主托管的生命周期**会不会碰别人的进程、
**八字信封**的两个纯函数判得对不对。判据全部来自
`.scratch/assembly-foundation/notes/horosa-integration-contract.md`（§0 真机捕获 · §2 挂载行 · §3 宿主接缝
· §4 两个纯函数 · §5 用例表 P1–P10）。

## 跑

```bash
npx vitest run tests/horosa              # 全部（P10 自动 skip）
XUANSHU_E2E=1 npx vitest run tests/horosa/p10-e2e.test.mjs   # 真机 e2e（要 %LOCALAPPDATA% 的 wheel + C:\horosa）
npx vitest run tests/horosa/p0-fixtures.test.mjs             # 红了先证明不是 fixture 的锅
```

## 用例表（编号 → 接缝 → 判据 → 是否零网络）

| # | 文件 | 接缝（被测物） | 判据（外部可观察物） | 零网络 |
|---|---|---|---|---|
| P0 | `p0-fixtures.test.mjs` | **替身自检**（不是被测物） | 六个信封 fixture 的顶层键/键路径/三档口径行；假 MCP 服务器真答 MCP（120 工具、`mcp-session-id`、信封在 `content[0].text`）；五种模式形状；假 uvx 起得来/记账/拒 8765；两个模板 fill 后是合法 JSON。**捕获目录存在时**再逐字段对回真实捕获 | ✅ |
| P0b | `p0b-surface.test.mjs` | §3.1 的**冻结导出名** | 七个模块的每个导出（名字 + 类型）、`default` 不许有、定值本身（端口/路径/工具名/schema/词表）、`loopbackHost` 三门、`resolveHorosaPaths` 七键、纯函数不偷读 `process.env` | ✅ |
| P1 | `p1-guard-parity.test.mjs` | `checkHorosaEndpoint` ↔ `scripts/isolation/horosa-guard.mjs::checkHorosaPort` | 同一现场（空闲 / 200+html / `mcp-session-id` / 200+JSON-RPC / 404 / 裸 TCP / 非法端口）**verdict 逐字相同**；词表四态用满；`ok` 语义一致（只有 free/horosa-ready 放行）；只探不杀 | ✅（只连 `127.0.0.1` + 内核分配端口） |
| P2 | `p2-single-source.test.mjs` | `profile/cordis.patch.yml` + `scripts/isolation/defaults.mjs` + `lib/horosa/constants.mjs` | YAML **真解析**出的 url 端口/路径三方逐字相等；**生产代码路径**（`packages/xuanshu-host/lib/**`、`scripts/*.mjs`、`scripts/{isolation,horosa,setup}/**`）里除两个白名单文件外不出现 `8765`/`/mcp` **字面量**（注释、提示语、check id 不算；扫描器自带反证用例）；白名单文件确实定义了这两个定值。**测试/fixtures/文档不在范围内** | ✅ |
| P3 | `p3-build-payload.test.mjs` | `buildBaziPayload`（纯函数） | 必填齐全→ok 且**无 `timeAlg` 键**；1/3 透传；0=省略；三种缺省写法；`2/4/-1/'2'/'true'/'x'`→`invalid-time-alg` 且**不产出 payload**；缺 date/time/zone/**lat**/**lon**→`missing-birth-fields` 且不产出 payload；空串/空白算缺；gender 白名单；10 键 + `byLon` 不进 payload；键集合封顶；确认闸默认注入 / `agentConfirmed:false` 不注入；纯函数不改输入 | ✅ |
| P4 | `p4-classify-envelope.test.mjs` | `classifyBaziEnvelope`（纯函数）+ §0 的**真实信封** | 三档 `technique_card.settings.timeAlg.value` = 0/1/3 且**四柱三档相同**（所以四柱不能当判据）；真机 `fourColumns.time` → 对外槽位 `pillars.hour`；`techniqueCard`/`version`/`pillarSource`；回退 `input_normalized.timeAlg` 与 `timeAlgSource`；四柱不合法→`pillars:null` 但仍 `phase:'ok'`；gate→code/4 条追问/`prompt_to_user` **原文**/safeDefaults/confirmationFields/四柱不可读；error→code+message；六种 invalid | ✅ |
| P5 | `p5-static-mount.test.mjs` | **静态面三件事** | ① `profile/cordis.patch.yml` 有这一行（id/name/serverName/transport/回环 URL/`failOnStartupError:false`/`toolCallTimeoutMs:300000`/reconnect 四键）+ 同一 id 全仓**只声明一次**（重复声明会让 Loader 启动失败）；② `dsh.profile.bundles` 无市场插件、dependencies 无 dsh-mcp-client；③ 生产代码里**没有**写 `mcp_connector.json` 的路径。**层归属与真实 storage 的真实验证在 P10⑦**（早先「自己造一份 storage 再断言」是自证，已删） | ✅ |
| P6 | `p6-ensure-runtime.test.mjs` | `readSetupReport` / `resolveHorosaPlan` / `ensureRuntime` | 无 manifest→`runtime-not-installed`+hint 指 setup（且**不建目录**）；版本不符→`runtime-version-mismatch`；同版本→ok；`runtime_payload_version` 优先、缺了回退 `version`；载荷 ≠ 预期而 version 相等→仍拒；坏 JSON 不抛；报告→wheel/version 逐字来自报告；无报告→`setup-report-missing`（**不猜 wheel**）；`XUANSHU_HOROSA_WHEEL` 覆盖 wheel；**`config.port` 的数字/数字字符串两种类型都逐值生效**（回归门，见下）+ 非法端口 `invalid-port` 不静默回落；`report` 入参两种形状都认 | ✅ |
| P7 | `p7-serve-lifecycle.test.mjs` | `startHorosaServe` / `stopHorosaServe` / `ownsServe` / `installHorosa` 的 dispose（**假 uvx**） | 空闲端口→`ok/started/pid>0` + **端口真答 MCP** + 台账里 argv/env 逐条对（`--from`/`serve`/`--host 127.0.0.1`/`--port`/四个 `HOROSA_*`）+ `serve.log` 落盘；已有 horosa→`started:false, pid:null` 且**台账零新增**；foreign→拒绝且**不 spawn**；bare-tcp(probe-failed)→fail-closed 且**不 spawn**；uvx 秒退→`ok:false`；停自己起的→进程真没了 + `ownsServe` 不再认；停别人的 pid→`ok:false` 且**那个进程还活着**；`.mjs`/`.cmd`/裸名三种 Windows 形态都能起；**R5 dispose**：自启的 serve 在 effect 收尾时被自己收掉（端口回到 free、phase=stopped），`keepServeOnDispose:true` 时不许收 | ✅（`127.0.0.1` + 假 uvx） |
| P8 | `p8-non-loopback.test.mjs` | `loopbackHost` / `startHorosaServe` | `0.0.0.0`/局域网 IP/域名/`127.0.0.1.evil.com`→`non-loopback-host` 且**零 spawn**（台账空）；`::1` 是回环 → 但 spawn 的 `--host` 恒为 `127.0.0.1`（客户端按 v4 探活） | ✅ |
| P9 | `p9-status-install.test.mjs` | `installHorosa` / `createHorosaRuntime` | 能力齐→`provide('xuanshuHorosa')` + 命令 `xuanshu-horosa` 在 `ctx.effect` 里注册 + 状态文件 `schema/phase/generatedAt` 合法；**裸 ctx 不抛**且返回 `ok` + notes 说明缺什么；只有 logger 也活；R2 分流落进状态文件（code/hint 指 setup、不起 serve）；第二次 `ensure()` 的 `generatedAt` 更新且文件始终是完整 JSON；服务面七件套 + `status()` 无副作用；两次装配同目标**共用一份**、不同目标各一份 | ✅ |
| P9b | `p9b-service-bazi.test.mjs` | §3.3 的服务状态机：`waitReady` + `baziBirth` | `waitReady` 以 MCP 握手为判据（空端口 false）；`baziBirth` → phase ok + **`pillars` 是 4 槽数组** + `fourColumns` 对象 + `timeAlg`/`techniqueCard` + 落 `status.bazi.{lastPhase,pillars,lastTool,lastVersion}`；`timeAlg:1` 透传；闸路径→phase gate + 4 问 + `promptToUser` + `status.bazi.pillars===null`；**缺 lat/lon 时不发 MCP 调用**（plan 指向关闭端口仍判 `invalid`）；MCP 不可达→`mcp-call-failed` + hint 指 serve 日志。plan 用假 MCP 端点，**零真实 uvx** | ✅ |
| P10 | `p10-e2e.test.mjs` | 真实 uvx + 真实 `C:\horosa` + 真实 8765 + 真 CLI + 装配树 | ① profile 物化快照**逐字节**新鲜（漂了给 `install-profile` 命令）② 前置件齐（wheel/runtime/CLI/`.dsh-home`/T2 的 CLI）③a **复用分支**（8765 上已有别人的 horosa，用假 MCP 占位）→ `started:false`、不 spawn、别人的还活着；③b **自起分支**（占位收掉后）→ 起真实 serve ④ `bazi-contract.mjs` exit 0 + 20 条 checks 全绿 + 三档/闸 ⑤ `boot-inprocess` **有界轮询**（上限 4 次）到 `mcp__horosa__*` 出现（客户端注册是异步的）⑦ 真 CLI `--dump-config` 里该行在 profile 补丁层之后 + `--dump-config-schema` 的 `status !== 'error'` 且 `x-cordis.complete === true` + 真实 home 的 `mcp_connector.json` 无 horosa 记录 ⑥ 收尾：**owned → free；复用态 → 别人的仍在答**。跑完在 `<sandbox>/work/p10-summary.json` 落机器可读摘要（serve pid / 三档 timeAlg / boot 工具名与尝试次数 / 层归属行号） | ❌ 唯一联网/spec 外的一环；`XUANSHU_E2E=1` 才跑 |

> P0 有两半：`p0-fixtures`（替身自检）+ `p0b-surface`（冻结接口面）。契约表里只列了 P1–P10，
> 这两条是「表的前置」：fixture 坏了或导出名少了，P1–P9 的红绿没有意义。

## fixtures

| 路径 | 是什么 |
|---|---|
| `fixtures/envelopes/*.json` | **真实信封的裁剪版**（Lead 2026-10-13 真机探针 `gt06-*`）。来源/裁剪规则/派生关系见 `envelopes/PROVENANCE.md`；`envelopes/regen.mjs` 可重生成（`--check` 只比对） |
| `fixtures/bin/fake-mcp-server.mjs` | **独立进程**的假 MCP / 假占用者：`mcp`(120 工具) / `mcp-session-id` / `json-rpc` / `foreign-html` / `not-found` / `bare-tcp` |
| `fixtures/bin/uvx.mjs` | **假 uvx**（P7/P8）：记账到 `$XUANSHU_FAKE_UVX_LOG` + 起 MCP + 拒绑 8765；`XUANSHU_FAKE_UVX_MODE=exit-immediately` 造「起不来」 |
| `fixtures/bin/uvx.cmd` | 同一个假 uvx 的 Windows 批处理形态（P7 的第二种路径形态） |
| `fixtures/setup-report.json` | 假 setup 报告的**模板**（裁剪自真机 `setup-e2e-run2.json`，`__VERSION__`/`__WHEEL__`/… 占位符由 `lib/sandbox.mjs` 填） |
| `fixtures/runtime-manifest.json` | 假 `current/runtime-manifest.json`（形状照 `C:\horosa\current\runtime-manifest.json`） |
| `lib/paths.mjs` · `env.mjs` · `sandbox.mjs` · `servers.mjs` | 路径一处定义 / 子进程环境白名单 / 一次性沙箱 / 假服务器与探活胶水 |
| `.tmp/` | 运行期沙箱（已 gitignore；绿的留现场便于复盘） |

## 卫生（这个断言台自己的规矩）

- **零网络**：除 P10 外只用 `127.0.0.1` + 内核分配端口；**绝不写死 8765**（假 uvx 见到 8765 直接退 9 拒绑）。
- **零真实 uvx**：P1–P9 一律 `XUANSHU_UVX_BIN=tests/horosa/fixtures/bin/uvx.mjs`。
- **不碰真机**：不读 `C:\horosa`、不碰 `%LOCALAPPDATA%\xuanshu\cache`、不写真实 `~/.dsh`；
  受管环境变量（`DSH_HOME`/`HOROSA_*`/`XUANSHU_*`）**先删再按需设**（`lib/env.mjs`），
  同进程调用被测模块前用 `isolateProcessEnv()` 清一遍（否则开发机上真有的 `HOROSA_RUNTIME_ROOT=C:\horosa`
  会静默把用例变成「测真机」）。
- **对照组一律独立进程**：`spawnSync`/同步等待会阻塞测试进程的事件循环，长在测试进程里的服务器在
  被探的那一刻不会被调度，`horosa-ready`/`occupied-foreign` 就没被验过（票 04 踩过）。
- **收尾**：测试自己起的 serve / 假服务器在 `afterAll` 里全部收掉；P10 额外断言 8765 回到 `free`。

## 口径裁决（Lead 2026-10-13 拍板，用例已按此钉住）

| 分歧 | 裁决 | 用例怎么钉 |
|---|---|---|
| `timeAlg` 的「键在但没值」（`undefined` / `null` / 空串） | **都算缺省 → 省略该键**（不报错、不写 0）。理由：界面「没选档」就是没值，判非法会让默认档用户出不了盘 | P3：三种写法各一条，断言 `ok:true` + **无 `timeAlg` 键** + `omitted` 含 `timeAlg` |
| `timeAlg` 数字字符串（`'1'` / `'3'`） | 「拒（`invalid-time-alg`）」或「归一化成数字透传」都接受；**绝不许静默省略** | P3：两条都覆盖（若被接受则断言 `payload.timeAlg === 1/3` 且类型是 number） |
| `ok` 不是布尔（如 `'true'`） | 只要**不判成 `'ok'`**（`invalid` 或 `error` 都接受） | P4：断言 `phase !== 'ok'`、`ok:false`、`pillars` 为 null |
| `startHorosaServe()` 起成功后 `verdict` 是 `free`（进门那一探）还是 `horosa-ready`（终态） | 实现口径 = 进门那一探（`free`）；测试不锁死，只要求落在四态词表内 | P7：断言词表成员；事实由端口握手与假 uvx 台账判 |

## 被真机 / 真机行为逼出来的三条教训（别改回去）

1. **`data.bazi.fourColumns` 的真实键是 `year/month/day/**time**/…`（没有 `hour`）** —— 时柱在
   `fourColumns.time`。契约 §0.1 一度写成 `hour`，Lead 已就地修正；`time → hour` 的映射算实现的责任
   （对外槽位仍叫 `hour`，`baziBirth().pillars` 是 4 槽数组）。fixture 按真机保留 `time`，
   `p0-fixtures` 有一条断言专门盯着它（真机出现 `hour` 就会红）。
2. **`.cmd` 替身必须是纯 ASCII**（`fixtures/bin/uvx.cmd` 顶部有同样的警告）：cmd.exe 按 **OEM 代码页
   （本机 cp936）** 读 `.cmd`，而文件是 UTF-8 无 BOM —— 中文注释会被拆成字节、当成命令执行，
   替身根本起不来（症状是 `waitMcpReady` 超时）。诊断：docs-verifier（T4）2026-10-13。
   以后再加 `.cmd`/`.bat` fixture：**只写英文注释**，并在文件头写清这条。
3. **`config.port` 的「数字」曾被 `text()` 静默丢掉**（T3 2026-10-13 抓到、T1 当天修）：
   YAML 里 `port: 18765` 是数字，只认字符串的取值把它判成「没设」→ 静默回落 8765，而 DSH 那一行的 URL
   指 18765 → 工具全不见、日志里什么都没有（正是本票要防的静默失败）。P6 里那条「数字/数字字符串
   两种类型都逐值生效」就是它的回归门；同族检查：`config.port` 非法值必须显式 `invalid-port`，不许回落。
