# Runbook · 一键安装（setup：取件 → 钉版 runtime → 装配 profile → 三项自检）

> 票 05 的交付物之一。上位决策：`docs/adr/0007-setup-one-command.md`（钉版依据：ADR-0004）；契约：`.scratch/assembly-foundation/notes/setup-contract.md`。
> 实现：`scripts/setup.mjs` + `scripts/setup/**`（钉版值在 `scripts/setup/horosa-pin.json`）。
> 本页只讲**怎么跑、怎么改、怎么回滚**；为什么这么设计看 ADR。

## 0. 一句话

**一条命令把玄枢装到「能启 + 底座就绪」**：取件（wheel + runtime）→ 校验 SHA256 → 装同版本 runtime 到纯 ASCII 根 → 装配 `xuanshu` profile → 跑三项真实自检。**钉版只有一个来源**（`horosa-pin.json`），**校验不过就一个字节都不装**。

## 1. 装什么、装到哪

```powershell
cd <repo>
node scripts/setup.mjs                 # 人读摘要
node scripts/setup.mjs --json          # stdout 只输出报告 JSON
pnpm setup:xuanshu                     # 等价入口
node scripts/setup.mjs --dry-run       # 只打印计划，零副作用
node scripts/setup.mjs -h              # 参数表（文件头注释块）
```

一条命令干五件事，顺序固定：

| # | 步骤 | 落点 |
|---|---|---|
| 1 | 取件（缓存命中 / 下载 / 离线件） | `<cache>/`（大文件唯一允许的落点之一） |
| 2 | 校验 SHA256（+ 大小） | 不匹配就删掉、退出 2、不装 |
| 3 | 装 runtime（上游 `install --archive`，不自己解压） | Windows 根 `C:\horosa`（**必须纯 ASCII**） |
| 4 | 装配 profile + `pnpm install` | `<dsh-home>/profiles/xuanshu`（home 两档见 [home.md](home.md)：开发 `<repo>/.dsh-home` / 产品 `~/.xuanshu`） |
| 5 | 三项自检（装配 / 8765 / 八字） | 结论写 `<dsh-home>/xuanshu/setup-report.json`（**成败都写**，失败报告正是排障第一手材料） |

**钉版值**（本机 win32-x64，文字与 `horosa-pin.json` 逐字一致）：

| 工件 | 文件名 | 大小（B） | SHA256 |
|---|---|---|---|
| wheel | `horosa_skill-0.40.1-py3-none-any.whl` | `1403270` | `feb377d6417ed82a49d0025f4190109435be06561f6fd33f05306b8f98819f83` |
| runtime | `horosa-runtime-win32-x64-v0.40.1.zip` | `718649254` | `2b3cce77b2779efbf41feba3d0377c10dadcd5e3b07f01c43985740edd3986d7` |
| runtime（posix 参考） | `horosa-runtime-darwin-arm64-v0.40.1.tar.gz` | `732395819` | `5e804d64428b9ff6dc02608cb6398e6b09fac5af38280e037e85228503708609` |

版本 `0.40.1` 是**唯一权威**（ADR-0004）：pin 里**没有** `latest`，代码也**不解析** `latest`。pin 里缺少当前平台 → 退出码 2，并列出 pin 支持的平台，不再猜。

## 2. 四条现场事实（踩过才知道）

1. **直连 GitHub 慢到不可用**：本机实测（**2026-10-12**）直连 `objects.githubusercontent.com` 只有 **12–24 KB/s** —— 719 MB 的 runtime 要 **8–16 小时**。加 `--mirror` 后实测 `https://gh-proxy.com/https://github.com` **21.9 MB/s**（719 MB **29.6 秒**下完，SHA256 与 pin 一致）、`https://ghfast.top/https://github.com` **19.3 MB/s**（≈33 秒）。开发机一律带 mirror。证据：`.scratch/assembly-foundation/captures/setup-e2e-groundtruth.md`。
2. **镜像只换传输，SHA256 门不变**：第三方代理正是需要校验的理由；报告的 `pin.*.url` 记下**实际用过**的 URL，可追查。
3. **Windows 的 runtime 根必须纯 ASCII**：上游 `runtime.path_not_ascii`（读清单/下载之前就拒），中文路径会挂。默认 `C:\horosa`，需要换根先设 `setx HOROSA_RUNTIME_ROOT C:\horosa`。
4. **默认绝不写真实 `~/.dsh`**：`--dsh-home` 解析结果**等于**真实 `~/.dsh`、或**落在它里面**（`~/.dsh/profiles/xuanshu` 这种更危险）时，**必须**显式 `--install` 才继续，否则退出码 3 并打印你该跑的命令。默认 home 是**玄枢自己的**：开发档 `<repo>/.dsh-home`（已 gitignore）、产品档 `~/.xuanshu`（ADR-0014；`--dsh-home` / `XUANSHU_DSH_HOME` 都能覆盖，见 [home.md](home.md)）。**同款守卫也在数据目录上**：环境里带的 `HOROSA_SKILL_DATA_DIR` 指向真实 `~/.horosa`（或它的子路径）时**忽略并记一条 note**，数据目录回到 `<dsh-home>/xuanshu/horosa`（与票 04 对 `$DSH_HOME` 的 R16 裁决同款：环境里带的不算你的意图，`--dsh-home` 那种显式意图才走硬门）。
5. **平台回退不静默**：pin 里没有当前平台一律**退出码 2** 并列出支持的平台；唯一例外是上游自己认可的仿真组合（Windows on ARM → `win32-x64` 载荷），命中时报告里写 `pin.runtime.platformFallback: {from, to}` 并留一条 note —— 不写就没人知道装的是哪份载荷。本机（win32-x64）是**直接命中**，这个字段是 `null`。

## 3. 参数族

| 族 | 参数 | 用途 |
|---|---|---|
| **离线** | `--wheel <path\|url>` · `--runtime <path\|url>` | 网络不可达时喂本地已装件（本地路径优先于下载，仍做 SHA256） |
| **缓存** | `--cache <dir>` · `--skip-download` · `--recheck` | 缓存位置 / 严格离线 / 强制重算大文件哈希 |
| **根目录** | `--runtime-root <dir>` | `HOROSA_RUNTIME_ROOT`（Windows 默认 `C:\horosa`） |
| **home** | `--dsh-home <dir>` · `--install` | 装配目标 + 数据目录根；`--install` 才允许写真实 `~/.dsh` |
| **镜像** | `--mirror <prefix[,prefix]>` | 换传输（`$HOROSA_RUNTIME_MIRROR` 兜底）；**wheel 与 runtime 都生效** |

连 `--mirror` 的实际语义都是照抄上游 `runtime/mirrors.py` 的：prefix **替换** `https://github.com`，**原始 URL 永远排最后** —— 同一份值可以直接交给 horosa 自己的 installer。上游自己也是这个口径（`HOROSA_RUNTIME_MIRROR` 同一个值同时改写清单、归档与 wheel URL），所以**镜像对 wheel 与 runtime 两类下载都生效**，`--dry-run` 打出的候选就是真跑会走的候选。

## 4. 全参数表

| 参数 | 语义 | 缺省 |
|---|---|---|
| `--wheel <path\|url>` | 离线/替代 wheel（本地路径优先于下载） | 空（走缓存/下载） |
| `--runtime <path\|url>` | 离线/替代 runtime 归档（本地路径优先于下载） | 空 |
| `--mirror <prefix[,prefix]>` | GitHub 镜像前缀（替换 `https://github.com`，原 URL 最后；对 wheel 与 runtime 的下载都生效） | `$HOROSA_RUNTIME_MIRROR` ＞ 空 |
| `--retries <n>` | 下载失败重试次数（正整数 `1..20`） | `3` |
| `--recheck` | 强制重算缓存大文件的 SHA256（默认只比 sidecar） | 关 |
| `--cache <dir>` | 工件缓存目录 | `$XUANSHU_CACHE` ＞ win32 `%LOCALAPPDATA%\xuanshu\cache` ＞ `~/.cache/xuanshu` |
| `--runtime-root <dir>` | `HOROSA_RUNTIME_ROOT` | win32 `C:\horosa`；posix `~/.horosa/runtime` |
| `--dsh-home <dir>` | DSH home（profile 装配目标 + 数据目录根） | `$XUANSHU_DSH_HOME` ＞ `$DSH_HOME`（仅当不指向真实 `~/.dsh`）＞ 默认两档：开发 `<repo>/.dsh-home` / 产品 `~/.xuanshu` |
| `--horosa-port <n>` | horosa MCP 端口（票 04 的既有旋钮，取值 `1..65535`） | `$XUANSHU_HOROSA_PORT` ＞ `$HOROSA_SKILL_PORT` ＞ `8765` |
| `--install` | 显式允许写**真实** `~/.dsh`（不给就拒绝） | 关 |
| `--profile <name>` | profile 名 | `xuanshu` |
| `--profile-mode link\|copy` | 装配形态（透传给 `install-profile.mjs`） | `link` |
| `--skip-download` | 只用缓存/本地件；缺件即失败（严格离线） | 关 |
| `--verify-only` | 只跑自检，不做取件/安装（**也不跑 uvx 环境门**；pin 段只反映缓存现状，零请求零哈希） | 关 |
| `--no-selfcheck` | 跳过自检 | 关 |
| `--selfcheck-timeout <ms>` | 自检里「起 serve + 八字出盘」的预算（毫秒，`1000..3600000`） | `600000`（首启 runtime 冷启动慢） |
| `--keep-serve` | 自检结束后不关掉 horosa serve（便于接着开发） | 关 |
| `--force` | 同版本也重装 runtime（透传 `install --force`） | 关 |
| `--dry-run` | 只打印计划（含两道纯环境门的结论），零副作用：不写报告、不建目录、不发请求、不跑 uvx 环境门 | 关 |
| `--json` | stdout 只输出报告 JSON | 关 |
| `-h/--help` | 打印文件头注释块 | — |

**端口与 host**（复用票 04 的解析，不新造）：端口链见上表 `--horosa-port` 行；host 读 `HOROSA_SKILL_HOST`，缺省 `127.0.0.1`，透传给自检起的 `serve`。
`--horosa-port` 是票 04 的既有旋钮，本票只沿用（`parseArgs` 收它，取值 `1..65535`）。
优先级一律：**显式命令行 > `XUANSHU_*` > 上游自身变量（`HOROSA_RUNTIME_MIRROR` / `HOROSA_SKILL_PORT` / `HOROSA_SKILL_HOST` / `HOROSA_RUNTIME_ROOT`）> 定值**。
**参数表之外的任何开关都是用法错（退出码 1）** —— 不会静默忽略一个你以为生效了的参数。

**缓存布局**：`<cache>/<name>`（最终件）+ `<cache>/<name>.part`（在下载）+ `<cache>/<name>.sha256`（校验通过后写的 sidecar）。
命中条件 = 文件存在 **且** 大小等于 pin **且** sidecar 等于 pin 的 sha256（**不重算大文件哈希**，除非 `--recheck`；首次落盘必须算一次）。
大小对得上但没有可用 sidecar 时，**不直接删**（那件可能是你手工下的），而是**先算一次** SHA256 判真伪：过就补写 sidecar 转命中，不过才重取。
下载用 `Range: bytes=<已下>-` 续传（服务端不支持 206 就整份重下），`.part` 断连后**故意保留**供下次续传，校验通过才原子 rename 成最终件。
`--dry-run` 的退出码：计划里有被挡住的门（`blocked`）→ **3**；否则 **0**。它不跑取件/安装/自检，所以**不会**给出 2 / 4 / 5。
两道纯环境门（真实 home 拒绝、win32 ASCII 根）**`--dry-run` 也跑**（它们零副作用，而这正是你想提前知道的）—— 所以干跑在坏环境下**会 exit 3**。计划里**不含** uvx 探测（那要 spawn 子进程）。
`--verify-only` 下 pin 段只在**真缓存命中**（存在 ∧ 大小等于 pin ∧ sidecar 相符）时写 `path` + `action: "cache-hit"`，否则 `path` 留 `null` —— 它不取件、不算哈希，所以不会凭空发明一个 action。

## 5. 三项自检：断言什么、失败怎么处置

三条全部**真跑**（不是"配置看起来对"），任一条 false → **退出码 5**。结论进报告 `checks[]`，`id` 只允许 `assembly` / `horosa8765` / `bazi`。

### C1 · 装配可启动（`assembly`）

- **断言**：`node scripts/verify-assembly.mjs --json --dsh-home <home> --profile <name>` → 退出码 0 **且** JSON `ok === true`。
- **原始输出**：落 `<dsh-home>/xuanshu/logs/verify-assembly.json`（太大，塞不进报告 —— 报告只给路径，见 §9）。
- **失败处置**：看报告 `checks[assembly].evidence` 里的装配错误行。
  - 缺 `node_modules` → 重装 profile：`node scripts/install-profile.mjs --home "<home>"`；
  - 补丁行 `status:"error"` → 先确认 profile 自己的 CLI 版本（用 profile 树里那份，别用 PATH 上全局的）；
  - 断言 0 通过但 `ok` 非真 → 贴报告回报，别手改 `scripts/verify-assembly.mjs`。

### C2 · horosa 8765 健康（`horosa8765`）

先 `checkHorosaPort()`（票 04 的四态守卫），再按结论分流：

| 守卫结论 | 退出码 | setup 怎么办 |
|---|---|---|
| `free` | — | 起一份 `serve`（日志 `<data-dir>/serve.log`，`<data-dir>` 缺省 = `<dsh-home>/xuanshu/horosa`，可被 `HOROSA_SKILL_DATA_DIR` 改），轮询等到就绪 |
| `horosa-ready` | — | **复用**已在跑的那份（自己没起，所以不会去 stop 它） |
| `occupied-foreign` | **3** | 环境门拒绝，**不算**自检失败：腾端口或换端口，**绝不去 kill 别人的进程** |
| `probe-failed` | **5**（自检失败） | **无法判定 ≠ 被占**：用**加长预算**（`min(selfcheck-timeout/2, 15s)`，下限 5s）复探一次 —— 慢应答的 horosa 正是这一格的常见成因；复探拿到 MCP 就绪就按「复用」通过，仍不成才 fail-closed。**绝不**在这里起第二份（端口上有 listener，再起必撞），处置见下 |

- **断言（唯一判据）**：MCP `initialize` **成功（200 且带响应头 `mcp-session-id`）** + `tools/list` 非空（`serve` 默认 `streamable-http`，`127.0.0.1:<port>/mcp`）。少了 `mcp-session-id` 就是**握手未成立** —— 不算「tools 列表有东西就算过」。
- **失败处置**：
  ```powershell
  Get-NetTCPConnection -State Listen -LocalPort 8765 | Select-Object LocalAddress,LocalPort,OwningProcess
  Get-Process -Id <OwningProcess> | Select-Object Id,ProcessName,Path
  ```
  常见的 `occupied-foreign` 是上一次 `serve` 没退干净（`Ctrl+C` 后 Java 子进程还挂着）。首启要起 runtime（Java + chart + Node），冷启动慢：把预算调大而不是重跑 —— `--selfcheck-timeout 900000`。
  `probe-failed`（exit 5）**不是**「端口被占」：先人工复探一次（`node scripts/isolation/horosa-guard.mjs --port 8765 --timeout 5000`）看它到底答不答；确认是慢 horosa 就把 `--selfcheck-timeout` 调大重跑，报告里 `checks[horosa8765].evidence.reprobe` 记着复探那一次的四态与 `mcpReady`。

### C3 · 八字工具可用（`bazi`）

- **断言**（两步，缺一不可）：
  1. `tools/list` 里含 **`horosa_cn_bazi_birth`**；
  2. `tools/call` 打 `horosa_cn_bazi_birth`（**固定测试出生数据**，写死在 `scripts/horosa/bazi-fixture.json`，不是真人生日：`date:"1990-01-01"`、`time:"12:00"`、`zone:"+08:00"`、`lat:"31n14"`、`lon:"121e29"`、`gender:"1"`，带 `agent_confirmed_settings:true` 与 `clarification_notes`；**不传** `timeAlg`，缺省 `0` = 真太阳时）→ envelope `ok === true` **且** `version === "0.40.1"` **且** `data` 非空（四柱可读）。
- **期望版本只有一个来源**：`scripts/setup/horosa-pin.json`。pin 读不到（被改名/删掉）时 C3 **直接判失败**并说明「pin 不可读」—— 不拿任何兜底字面量继续跑（那会把「升级后忘了换版本」变成一条永远为真的断言）。
- **真机实测长什么样**（2026-10-12，证据 `.scratch/assembly-foundation/captures/setup-mcp-probe.json`）：信封 `{ ok: true, tool: "bazi_birth", version: "0.40.1" }`，四柱里 `data.bazi.fourColumns.year.ganzi === "己巳"`。
- **失败处置**：`version` 不是 `0.40.1` 说明**新树混了旧 runtime** → `node scripts/setup.mjs --force` 重装同版本 runtime，再跑 `node scripts/setup.mjs --verify-only`；envelope 报错就先看 `evidence` 里上游返回的原文，别改 fixture 去凑绿。

自检结束默认 `stop` 掉**自己起的**那份 serve（`--keep-serve` 可留）；复用的是别人的实例时 `pid` 为空，`stop` 直接 no-op；**绝不** kill 不是自己起的进程 —— 上游 `:9999` / `:8899` 是用户桌面版星阙的端口，**永不对其测试**。
C2 没过时 C3 记一条「跳过：先修 C2」（八字工具必然也不可用），不再去 call 工具 —— 报告的 `checks` 仍恰好三条、顺序固定。

## 6. 退出码表（冻结）

| 码 | 含义 | 触发 | 你该做什么 |
|---|---|---|---|
| **0** | 成功 | 全部步骤 + 三条自检通过；**或** `--no-selfcheck` 下其余步骤全成（此时 `checks: []`，notes 里写明「显式跳过」—— 人显式放弃的检查不判失败） | — |
| **1** | 用法/未知错误 | 参数非法、未预期异常 | 改命令：`node scripts/setup.mjs -h` |
| **2** | **取件/校验失败** | 缺件、下载失败、SHA256 不匹配、pin 无当前平台 | 修网络/pin/喂本地件：`--mirror …`、`--wheel <path>`、`--runtime <path>` |
| **3** | **环境门拒绝** | `uv` 缺失、win32 非 ASCII runtime 根、真实 `~/.dsh` 未显式 `--install`、8765 `occupied-foreign` | 修环境：装 `uv` / `setx HOROSA_RUNTIME_ROOT C:\horosa` / 加 `--install` / 腾端口 |
| **4** | **安装失败** | `install --archive` 非 0、runtime 版本 ≠ pin、`install-profile.mjs`/`pnpm` 失败 | 看报告 `evidence` 原文；同版本硬门不合就 `--force` |
| **5** | **自检失败** | C1/C2/C3 任一 false | 见 §5 逐条处置；`--no-selfcheck` 只用来隔离故障，不是修复 |

**2/3/4/5 的处置完全不同**（取件 / 环境 / 安装 / 自检），别把 3 当 2 去重试网络，也别把 5 当 4 去重装。
`0` 有一条副作用要知道：`--no-selfcheck` 也会给 **0**，但报告 `checks` 是**空的** —— 「退出码 0」不再等价于「三条自检都过了」。CI 里想在没跑自检时也判红，就自己看 `checks.length`（或干脆别用 `--no-selfcheck`）。

## 7. 升级 horosa 的一次性清单（照 ADR-0004）

上游钉版不自动跟随，升级是**一次有意识的手动动作**：

1. 读新 release 的 `LESSONS.md` 新增条目（先知道上游改了什么）。
2. 换 pin：改 `scripts/setup/horosa-pin.json` 的 `version`、`releaseBase`、各工件的 `name` / `sha256` / `size`（**不许出现 `latest`**）。新 release 的 `SHA256SUMS.txt` 与 runtime manifest 是权威值，别凭记忆写。
3. 重装**同版本** runtime：`node scripts/setup.mjs --force` —— 禁止新树 + 旧 runtime 混跑，这是硬门（§5 C3 的 `version` 断言就是拦它的）。
4. 重跑自检：`node scripts/setup.mjs --verify-only`，确认 C3 的 envelope `version` 等于新 pin 版本、四柱可读。
5. 重跑装配契约测试：`pnpm verify:assembly`；再按需跑 `pnpm test`。
6. 更新受影响的文档（本 runbook 与 ADR-0007 里出现的版本号/大小/SHA256 前 8 位），别让文档停在旧版。

大工件（719 MB 那份）只允许出现在 `<cache>` 与 `<runtime-root>`：**绝不**进版本库、绝不进 `.dsh-home`。

## 8. 回滚

安装是**加法**，回滚就是删掉这三样（顺序随意；第 4 行是"顺手把整个隔离 home 一起删"的粗暴版）：

```powershell
Remove-Item -Recurse -Force C:\horosa                        # ① runtime 根（Windows 默认）
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\xuanshu\cache" # ② 工件缓存（719MB 在这）
Remove-Item -Recurse -Force <dsh-home>\profiles\xuanshu       # ③ 卸 profile
cmd /c rmdir /s /q "<repo>\.dsh-home"                        #    粗暴版：整个隔离 home 一起删
```

④ 这一行**别用 `Remove-Item -Recurse`**：worktree 里的 `node_modules` 是指向仓根的 junction，`-Recurse` 会跟着删到仓根的真件（与 AGENTS.md 的删目录规矩同一条）；`cmd /c rmdir /s /q` 不跟随。

② 的实际路径以你机器上解析出的 `--cache` 为准（`$XUANSHU_CACHE` ＞ win32 `%LOCALAPPDATA%\xuanshu\cache` ＞ `~/.cache/xuanshu`；`%LOCALAPPDATA%` 缺失或为空白时回落到 `~/.cache/xuanshu`）。不确定就把 setup 报告里的 `pin.*.path` 拿去定位。
`install-profile.mjs` **没有** `--uninstall` 这类开关（它只装配，不卸载）—— 卸 profile 就是删目录，删干净即可。

三件东西**不在**回滚范围内：desktop 的 `~/.dsh`（我们没碰）、horosa 自己的记忆与数据目录（`<dsh-home>/xuanshu/horosa`）、以及仓库里各 `node_modules`（`pnpm install` 的产物，已 gitignore）。

用 `--install` 写进过真实 `~/.dsh` 的话，回滚同理：`Remove-Item -Recurse -Force "$HOME\.dsh\profiles\xuanshu"`。

## 9. 隔离与卫生（为什么它敢在你的机器上跑）

- 缺省**绝不**写真实 `~/.dsh`：解析结果等于真实 `~/.dsh` **或落在它里面**时必须显式 `--install`，否则退出码 3 并打印你该跑的命令。**被拒时一个字节都不写 —— 连报告也不落盘**，只在 stdout/stderr 给你结论（这条没有例外条款）。
- 缺省**绝不**写真实 `~/.horosa`：数据目录一律 `<dsh-home>/xuanshu/horosa`（`HOROSA_SKILL_DATA_DIR`）。
- 任何网络动作都能被 `--skip-download` 关掉；`doctor` 一律**不带** `--probe-network`（默认零外网）。
- 大文件只在 `<cache>` 与 `<runtime-root>`；`.dsh-home` 与版本库里都不会出现 719 MB 的玩意。
- 报告在 `<dsh-home>/xuanshu/setup-report.json`（schema `xuanshu/setup-report@1`）：`pin.*` 记实际用的 URL 与 sha256、`runtime.action`（`installed` / `already-installed` / `skipped`）、`checks[]` 三条结论（`id` + `ok` + `detail` + `durationMs` + `evidence`；C2 那条还带顶层 `verdict`，通过时是 `horosa-ready`）、`exitCode`。**成功与失败都写报告** —— 只有上面那条「真实 home 被拒」是例外。
  **契约 §7 的键表是下界**，下面这些是**追加键**（有则用、无则略；机器读报告时别把它们当异常）：
  - `dryRun: true` + `plan[]`（`--dry-run` 的逐步计划：`step` / `action` / `detail`）——干跑**不落报告**，这一份只在 stdout；
  - `serve: { started, pid, stopped, detail }`——这次自检到底有没有起过 serve、pid 是多少、有没有停掉（`--keep-serve` 时 `stopped: false`）；复用别人的实例时 `started:false, pid:null`（**绝不**去 stop 它）；
  - `pin.runtime.platformFallback: {from,to} | null`——平台回退显式化（A10，见 §2 第 5 条）；直接命中时是 `null`；
  - `checks[].evidence.logFile` / `stderrLogFile`（C1）、`runtime.evidence.logs.{doctorBefore,doctorAfter,install}`——**大输出的落点**：`verify-assembly` 的 JSON、`doctor` 的 JSON、`install` 的 JSON 全落在 `<dsh-home>/xuanshu/logs/`，报告里只给路径（证据只放小字段，截断 ≤ 2KB/项）。
  失败的报告额外带 `error` / `hint` / `evidence`，并且 `notes` 里有一行 **`失败阶段：…`**（不然一份 `ok:false` 的报告读起来像是「取件失败了」——pin/平台解析失败也走这条路）。

**幂等**：重复执行 ① 不再下载（缓存命中）；② 不再重装同版本 runtime（`runtime.action = "already-installed"`）；③ 重复装配 profile 不报错；④ 仍跑自检并写出**新**报告（`generatedAt` 更新）。只有 `--force` 才允许重做 ②。

> **第一次真跑会多花一次哈希时间**：手工下载（或从别处拷来）的工件通常是「大小对、但没有 `.sha256` sidecar」这形态，它**不会**被当成脏件删掉重下，而是**先算一次 SHA256**：过就补写 sidecar 转命中，不过才重取。所以第一次跑会比后续慢（719 MB 那一份要读一遍盘），但**不会**白下 719 MB。想确认现状就 `--dry-run`，计划里会写 `verify-once`。

> 读脚本输出的一个坑（Windows）：抓子进程输出要**收字节再按 UTF-8 解**（本机控制台是 cp936，直接 `Get-Content` 会乱码）。要留证据就重定向到文件再用编辑器看。

## 10. 报错对照表（文案照抄实现，直接按它搜）

| 你会看到的文案 | 含义 | 处置 |
|---|---|---|
| `runtime.path_not_ascii` / 非 ASCII runtime 根 | 根路径含非 ASCII 字符（在任何网络/写盘动作**之前**就拒） | `setx HOROSA_RUNTIME_ROOT C:\horosa`，或 `--runtime-root C:\horosa` |
| SHA256 期望 vs 实际不符 | 工件被换过 / pin 过期 / 镜像回错内容 | 换一个 `--mirror` 前缀重下；离线件则重新取件。**别**改 pin 去迁就 |
| pin 里没有当前平台 | 你的平台不在 pin 的支持列表里（错误信息会列出来） | 按提示在 pin 里补平台条目，或在支持的平台跑 |
| `--skip-download` 且缓存缺件 | 严格离线模式下没有可用件 | 按提示 `--wheel <path>` / `--runtime <path>`，或先联网跑一次 |
| 真实 `~/.dsh` 被拒绝 | home 解析到了真实 home（或它的子路径） | 用默认隔离 home，或确认真要写才加 `--install` |
| `uv` 不在 PATH | 环境门 | 装 `uv`（CLI 走 `uvx --from <wheel> horosa-skill <cmd>`）；只想复看报告就 `--verify-only`（它不跑这道门） |
| runtime 版本 ≠ pin 版本 | 同版本硬门（禁止新树混旧 runtime） | `node scripts/setup.mjs --force` 重装，再 `--verify-only` |
| doctor 缺 `runtime_payload_version`（也没有 `freshness.installed_version`） | 版本**取不到** → 退出码 4（不许拿 `manifest_version` 兜底：那是「新清单蒙着旧载荷」的典型症状） | 看 `<dsh-home>/xuanshu/logs/doctor-after.json` 原文；多半装到了别的根/别的树，`--runtime-root` 对齐后重跑 |
| 报告 `notes` 里出现「HOROSA_SKILL_DATA_DIR=… 指向用户真实 horosa 数据目录，已忽略」 | 环境里带着的变量指向真实 `~/.horosa`（**不是**错误） | 什么都不用做；真要写那儿得用显式意图（本票没有这个开关），或先 `unset` 那个变量 |
| 8765 `occupied-foreign` | 有进程占着 8765 但不是 horosa | 见 §5 C2 的排查命令；**别**去 kill 别人的进程 |
| 8765 `probe-failed`（自检 exit 5） | 有人 LISTEN 但预算内没给出 HTTP 响应：**无法判定**，不是「被占」 | 先复探：`node scripts/isolation/horosa-guard.mjs --port 8765 --timeout 5000`；慢 horosa 就把 `--selfcheck-timeout` 调大重跑（报告 `evidence.reprobe` 有复探那一次的四态） |

## 11. 相关

- `docs/adr/0007-setup-one-command.md` —— 为什么是一条命令 + 钉版 pin + SHA256 硬门 + 三项真实自检。
- `docs/adr/0004-pin-upstream-versions.md` —— 钉版决策与上游升级清单。
- [home.md](home.md) —— 玄枢的 home（产品 `~/.xuanshu` / 开发 `<repo>/.dsh-home`）：在哪、怎么换、怎么迁移、为什么与 DSH 桌面版互不影响。
- `docs/runbook/dual-instance.md` —— 开发期双实例隔离（`$DSH_HOME` / 端口 / `8765` 四态守卫 / 回滚）。
- `docs/specs/001-assembly-foundation.md` —— 装配基座 spec（User Stories 1–4）。
