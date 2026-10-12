# tests/setup — setup 断言台（票 05）

`node scripts/setup.mjs` 一条命令 = 取件 → 校验 → 装 runtime → 装配 profile → 三项自检。
本目录是它的**验收面**：断言的全是**外部可观察物** —— 进程退出码 / 报告 JSON（唯一机器可读产物）/
缓存目录里的字节 / 有没有发起过请求。不 import 实现内部模块做白盒断言（例外：契约 §10 明写「纯单测」的
两个模块 `scripts/setup/mirror.mjs` 与 `scripts/setup/exit.mjs`）。

契约出处：`.scratch/assembly-foundation/notes/setup-contract.md`（§2 参数 · §3 取件校验 · §5 自检 ·
§7 报告 · §8 退出码 · §10 **十条断言面**）+ `.scratch/assembly-foundation/captures/setup-e2e-groundtruth.md`
（Lead 真机实测的 doctor / install / serve / MCP 响应形状 —— 所有 fixture 都照它回放，不靠猜）。

| 文件 | 作用 |
|---|---|
| `pin.test.mjs` | **第 8 条**：`scripts/setup/horosa-pin.json` 与离线副本（`captures/horosa-SHA256SUMS.txt` + `horosa-runtime-manifest.json`）逐值一致；不许出现 `latest`。纯单测 |
| `mirror.test.mjs` | **第 10 条**：`mirrorCandidates` 的候选顺序 / 非 github 原样 / 空列表只回原 URL。纯单测 |
| `args-exit.test.mjs` | **第 7 条的一部分**：`EXIT` 六个数逐键相等；`--help` 真列参数、未知参数 exit 1 且点名 |
| `setup-cli.test.mjs` | **第 1–7、9 条**：端到端（离线取件零 HTTP / SHA256 门 / Range 续传 / 两个环境门 / 幂等 / 报告 schema / 退出码表） |
| `fixtures.test.mjs` | **替身自检**：先证明 fixture 自己是对的（计数 server、Range+断连、假 uvx 的 doctor/install/MCP、两个 stub、zip 字节） |
| `fixtures/bin/uvx.mjs` | **假 uvx**：回放真机形状的 `doctor` / `install` / `runtime status` / `serve`（含真 MCP HTTP） |
| `fixtures/stubs/install-profile.mjs` | `scripts/install-profile.mjs` 替身（**零 pnpm**） |
| `fixtures/stubs/verify-assembly.mjs` | `scripts/verify-assembly.mjs` 替身（C1 的 0/1 两态） |
| `lib/release-server.mjs` | 本地**计数** server（独立进程）：计数 / Range 206 / 「先给半个文件后断连」 |
| `lib/sandbox.mjs` `lib/fixtures.mjs` `lib/zip.mjs` `lib/sha.mjs` `lib/env.mjs` `lib/setup-run.mjs` `lib/paths.mjs` | 沙箱、fixture 归档与测试 pin、真 zip 构造、SHA256、子进程环境、跑 CLI 的胶水 |
| `.tmp/` | 运行期沙箱（cache / dsh-home / runtime-root / state 四件套；已 gitignore，绿的留现场便于复盘） |

## 跑

```bash
pnpm vitest run tests/setup        # 本目录
pnpm test:setup                    # 等价（Lead 落地的 npm script）
pnpm vitest run tests/setup/fixtures.test.mjs   # 只想确认 fixture 没坏
XUANSHU_SETUP_TESTS_KEEP=0 pnpm vitest run tests/setup   # 跑完清掉 .tmp（默认保留现场）
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
| `XUANSHU_SKIP_PREFLIGHT=1` | — | 跳过「`uv` 在不在 PATH」的环境门（本机 PATH 与 CI 不一致，会引入假红） |
| `XUANSHU_FAKE_UVX_MODE` / `XUANSHU_STUB_MODE` | — | **只在测试侧**：造 exit 4（`fail-install` / `wrong-version`）与 exit 5（`fail-verify`） |
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

## 本票**未**覆盖的边界

| 没测的东西 | 为什么 | 依赖 |
|---|---|---|
| 真下载 719MB 的 runtime、真 `install --archive` 解包 | 断言台禁止读/用那份工件（任务书硬约束）；取件/校验/续传三段逻辑都在我们这侧，用同形 fixture 验 | Lead 的真机 E2E（`captures/setup-*`） |
| 真 `pnpm install` / 真 DSH CLI 启动（C1） | 同上：会真联网、真装、分钟级；C1 的契约在 `tests/assembly/**` 另有断言台 | `pnpm test:assembly` |
| `--mirror` 在真 github 上的吞吐（21.9 MB/s 那种实测） | 真机网络事实，不是代码性质 | `captures/setup-e2e-groundtruth.md` §1 |
| 真 horosa runtime 的 MCP 120 工具全量面 | 假 uvx 只回放 12 个（含 `horosa_cn_bazi_birth`）；全量面归 `scripts/horosa/**` 的探针 | 票 06 |
| 8765 被别的进程占用（`occupied-foreign` → exit 3） | 需要先有一个真实占用者；票 04 的四态守卫已在自己的断言台里验过 | `tests/isolation/port-guard.test.mjs` |
