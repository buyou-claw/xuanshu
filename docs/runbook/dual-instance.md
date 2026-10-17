# Runbook · 双实例并跑（desktop + xuanshu 开发期隔离）

> 票 04 的交付物之一。上位决策：`docs/adr/0006-dev-dual-instance-isolation.md`；实现：`scripts/isolation/startup.mjs`。
> 本页只讲**怎么跑、怎么改、怎么回滚**；为什么这么设计看 ADR。

## 0. 一句话

**desktop（Electron，占 `127.0.0.1:19387`）与 xuanshu（被测实例）各自一个 `$DSH_HOME`，各自一个 web 端口；horosa 的 `8765` 在拉起前先探一次单占用。** 这三件事都由一个启动器负责，不靠"记得设环境变量"。

## 1. 先做一次体检

```powershell
cd E:\ai_project\XuanShu
node scripts/isolation/startup.mjs                 # 人读摘要；= --mode doctor
node scripts/isolation/startup.mjs --json          # 机器读（stdout 只有一份 JSON）
```

`doctor` 不 spawn 任何进程、不开端口，只算清六道门并打印报告：

| 门 | 查什么 | 失败退出码 |
|---|---|---|
| `home` | 隔离 home 存在、且**不是**真实 `~/.dsh`（指到真实 home 是**用法错误**，不是环境错误） | **1** |
| `cli` | CLI 必须是 profile 树里那份，且版本 = `dsh-base` 版本 | 2 |
| `profile` | `$DSH_HOME/profiles/xuanshu` 有 `package.json` + `node_modules`（缺了用 `--install`） | 2 |
| `webPort` | `127.0.0.1:<web-port>` 没人 LISTEN，且不等于 desktop 的 `19387` | 3 |
| `horosaGuard` | `127.0.0.1:<horosa-port>/mcp` 要么空着、要么是 horosa 自己在答；**只有 `occupied-foreign` 判失败**（`probe-failed` 不改退出码，只记 `unknown`） | 3（仅 foreign） |
| `stateIsolated` | 七条派生路径（profile/数据目录/sessions/storages/凭据/机器补丁/装配报告）全落在同一个 `$DSH_HOME` 下 | 3 |

退出码不是只有 0/1：**1 = 用法错（改命令），2 = 环境不对（装 profile / 换 CLI），3 = 隔离不成立（腾端口 / 查谁占了）**，处置完全不同。

## 2. 两种跑法

```powershell
# ① desktop：照常开应用（Electron 自己管 19387 与 ~/.dsh），下面这条只是"确认它在"
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 19387 | Select-Object LocalAddress,LocalPort,OwningProcess

# ② xuanshu（被测实例）：独立 home，跑一次真启动自证 —— 这是本票可用的跑法
node scripts/isolation/startup.mjs --mode headless
#   真跑一次 `dsh --profile xuanshu --help`（boot + dispose + exit 0，不调 LLM、不开端口），
#   并断言 $DSH_HOME/xuanshu/assembly-report.json 是本次新写出的。
```

票 07 已接入 `@deepseek-ai/dsh-web-app`：`node scripts/isolation/startup.mjs --mode web` 启动浏览器实例。`plan.env.XUANSHU_SURFACE` 选择 web/headless；profile 补丁仅启用对应的启动解析器。CLI 的 `web` 位置参数是 profile 名的快捷写法，所以自定义 profile 必须使用 `dsh --profile xuanshu --port 19388 --no-open`，不能追加 `web`。真实 web 冒烟验证认证跳转、cookie 和含 `__DSH_BOOT__` 的 HTTP 200 页面。完整装配 S1 仍有四条上游 preset carrier schema 错误，记录在开发进度中。

命令和环境可通过 env 模式取出：

```powershell
node scripts/isolation/startup.mjs --mode env               # 打出一串 $env:... 赋值 + 启动命令
node scripts/isolation/startup.mjs --mode env --json        # 结构化：plan.command / plan.env / instance.*
```

端口隔离本身现在就可以验：`--web-port` 被占时启动器 exit 3（`pnpm test:isolation` 里有真占端口的断言）。`--` 之后的参数原样透传给 `dsh`（逃生舱，不属于本票验收面）：

```powershell
node scripts/isolation/startup.mjs --mode env -- --trusted-host xuanshu.test
```

## 3. 三个旋钮

| 旋钮 | 默认 | 命令行 | 环境变量（按优先级） |
|---|---|---|---|
| 隔离 home | 开发档 `<repo>/.dsh-home`（产品档是玄枢自己的 `~/.xuanshu`，ADR-0014） | `--home <dir>` | `XUANSHU_DSH_HOME` → `DSH_HOME`（仅当不指向真实 home）→ 默认 |
| xuanshu web 端口 | `19388` | `--web-port <n>` | `XUANSHU_WEB_PORT` → 默认 |
| horosa 端口 | `8765` | `--horosa-port <n>` | `XUANSHU_HOROSA_PORT` → `HOROSA_SKILL_PORT` → 默认 |
| profile 名 | `xuanshu` | `--profile <name>` | `XUANSHU_PROFILE` → 默认 |
| CLI | profile 树里那份 | `--cli-bin <path>` | `XUANSHU_CLI_BIN` → 自动发现 |

优先级一律：**显式命令行 > `XUANSHU_*` > 上游自身变量（如 `HOROSA_SKILL_PORT`）> 定值**。

`DSH_HOME` 有个坑要知道：**它指向真实 `~/.dsh` 时会被忽略**（在 DSH 会话里跑本脚本时，环境天然带着 desktop 的 `DSH_HOME`），忽略这件事会记进报告的 `notes`；要覆盖就用 `--home` 或 `XUANSHU_DSH_HOME`。
玄枢自己的 home（产品 `~/.xuanshu` / 开发 `<repo>/.dsh-home`）、怎么换、怎么迁移，见 [home.md](home.md)。

**horosa 端口要换就得两边一起换**（`HOROSA_SKILL_PORT` 给 `serve`，`--horosa-port`/`XUANSHU_HOROSA_PORT` 给守卫）：只改一边，守卫会看到"端口空着"而放行、实例却连到另一个端口。

`19387` 不能碰：那是 desktop 的。启动器不会去占它，`--web-port 19387` 直接判失败。

## 4. `8765` 守卫的四种结论

拉起实例前启动器探一次 `http://127.0.0.1:<horosa-port>/mcp`：

| verdict | 含义 | 启动器怎么办 |
|---|---|---|
| `free` | 没人 LISTEN | 放行。horosa 未启动是**正常**状态（票 05/06 才托管它的生命周期） |
| `horosa-ready` | 有人在答，且应答形态像 MCP 端点（`mcp-session-id` 头 / JSON-RPC body / `405 + allow: POST`） | 放行，报告里记下证据 |
| `occupied-foreign` | **有进程占着，但不是 horosa** | **fail-fast，退出码 3**，报告里给 `hint`（排查命令 + 换端口命令 + `--transport stdio` 免端口方案） |
| `probe-failed` | **没验成**（两种来源：端口有人 LISTEN 但在预算内零 HTTP 响应 —— 可能是慢应答的 horosa；或探针自身出错） | **不算被占，也不算通过**：门的 `ok:false`（不显示成绿灯），但**退出码仍是 0**，结论记成 `unknown` 写进报告与 `notes` |

「被占但不是 horosa」最常见的原因是**上一次 `serve` 没退干净**（`Ctrl+C` 之后 Java 子进程还挂着）。这时先看是谁：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8765 | Select-Object LocalAddress,LocalPort,OwningProcess
Get-Process -Id <OwningProcess> | Select-Object Id,ProcessName,Path
```

真要并行跑第二个 horosa，就用另一对端口（两边一起改）：

```powershell
node scripts/isolation/startup.mjs --horosa-port 18765 --mode doctor
# 同时让 horosa 侧监听 18765：HOROSA_SKILL_PORT=18765 uv run horosa-skill serve
```

## 5. 断言"真的没串扰"

```powershell
pnpm verify:isolation          # 唯一断言实现，退出码 0/1
node scripts/verify-isolation.mjs --json
pnpm test:isolation            # 同一套断言的 vitest 包装
```

断言面（只有这些，别处不算）：

| # | 断言 |
|---|---|
| I1 | 不同 `$DSH_HOME` 解析出的七条路径两两不同，且都在各自 home 下 |
| I2 | CLI 来自 profile 树、版本 = `dsh-base` 版本，`--cli-bin` 优先 |
| I3 | web 端口被占 → 退出码 3 且点名端口；空闲 → 通过 |
| I4 | `8765` 守卫四态判对（真起临时 HTTP 对照组来验） |
| I5 | 两个隔离 home 各真跑一次 `headless`，各自写出自己的 sessions/storages/装配报告；且做**哨兵断言**：往 A 的 `sessions/`、`storages/`、`.credentials.yaml`、`cordis.patch.yml` 各放一个哨兵，B 跑完后 B 的 home 里一个都找不到（证明"根真的分开"，不止路径字符串不同） |
| I6 | 跑完测试后用户真实 `~/.dsh` **无新增无删除**、里面不出现 `xuanshu/`、所有运行的 home 都不是真实 home；mtime/size 指纹只作证据（本机 desktop 与我们并发写同一个 `~/.dsh`，指纹无法归因到某一次运行） |
| I7 | xuanshu 的端口 ≠ `19387` |

CI / 交付前用 `XUANSHU_REQUIRE_ASSEMBLY=1` 把"profile 没装"从 skip 变成硬失败——否则"没装 = 全绿"。

**诚实边界**：一次 `dsh --help` 只走 boot + dispose，不建会话、不写 storages——所以 I5 证明的是"存储根真的分开了"（哨兵法），不是"两个会话互不可见"。真正的会话/凭据串扰要等票 10（问事闭环真建会话）才有行为断言。同理，凭据的**读取路径**隔离由 `credentialsFile` 与哨兵覆盖，凭据的读写行为属后续票。

### 写这类测试时的一个坑（已踩过）

验收台用 `spawnSync` 跑被测进程，**会阻塞测试进程自己的事件循环**。所以 I4 的对照组服务端**必须起在独立进程里**：如果它长在测试进程内，探测发出的那一刻它不被调度 —— TCP 连得上（内核 backlog 就 ACK）、HTTP 永远不响应，于是所有"有 HTTP 响应"的对照组都退化成 `occupied-foreign`，而 `horosa-ready` 的两态会**假绿**。对照组服务端在 `tests/isolation/lib/fixture-server.mjs`（独立进程），断言里钉了"真拿到响应"的证据（`status` / `mcp-session-id`）。

## 6. 回滚

隔离是**加法**，回滚就是删掉那个 home：

```powershell
Remove-Item -Recurse -Force E:\ai_project\XuanShu\.dsh-home    # 只删隔离 home，desktop 与 ~/.dsh 不受影响
```

三件东西**不在**回滚范围内（它们本来就不归本票管）：desktop 的 `~/.dsh`、horosa 自己的 runtime 与记忆（`HOROSA_RUNTIME_ROOT` / `HOROSA_SKILL_DATA_DIR`）、以及仓库里 `profile/node_modules`（`pnpm install` 的产物，`.gitignore` 已忽略）。

启动器与测试**不会**往真实 `~/.dsh` 写任何东西：`home` 解析到真实 home 时直接用法失败（**没有** `--allow-real-home` 这种逃生舱），I6 还会在每次跑测后核对指纹。

## 7. 报错对照表（文案照抄实现，直接按它搜）

| 你会看到的文案（`[门] FAIL 详情`） | 含义 | 处置 |
|---|---|---|
| `拒绝在用户真实 DSH home 上运行：C:\Users\…\.dsh` | `--home` 或 `XUANSHU_DSH_HOME` 指到了真实 home（**用法错误，退出码 1**） | 用默认 `.dsh-home`，或显式给一个隔离目录 |
| `隔离 home 不存在：<dir>` | home 目录还没建 | `node scripts/install-profile.mjs --home "<dir>"`，或给启动器加 `--install` |
| `127.0.0.1:19388 已被占用：xuanshu 需要独立端口才能与 desktop 同跑` | 已经有一个实例在跑（或别的进程占了） | 先关掉那个实例；确认是别人占的就换 `--web-port` |
| `web 端口 19387 就是 desktop 的端口：xuanshu 必须用独立端口（默认 19388）` | 你把 `--web-port` 指到了 desktop 的端口 | 换端口 |
| `profile "xuanshu" 没装在 <home>\profiles\xuanshu（缺 node_modules）` | profile 没装 | `node scripts/install-profile.mjs --home "<dir>"` |
| `找不到 DSH CLI（profile 树 / 同 home 的兄弟 profile / PATH 都没有）` | profile 里没装 `@deepseek-ai/dsh` | 在 `profile/` 下重跑 `pnpm install`（别用 PATH 上全局那份 0.1.2-rc.1） |
| `CLI v0.1.2-rc.1（…）≠ profile 装的 @deepseek-ai/dsh-base 0.2.0-rc.2：版本不符的 CLI 会去解析别人的 node_modules` | 用错树了 | 同上；或显式 `--cli-bin <profile>\node_modules\@deepseek-ai\dsh\lib\bin.js` |
| `horosa 守卫：… occupied-foreign` + `hint` | `8765` 被非 horosa 进程占着（**退出码 3**） | 见 §4 |
| `有人 LISTEN，但在 <budget>ms 内没有给出任何 HTTP 响应…**无法判定**是不是 horosa` 或 `探针无法判定 <host>:<port> 的状态（网络错误：…）` | 探针没拿到结论（端口有人在听但不应答 —— 可能是慢应答的 horosa；或探针自身出错） | **退出码仍是 0，但这一门不是绿灯**（`horosaGuard.ok=false`）：看报告 `evidence` 人工确认 `8765` 上是谁，或先 `--timeout-ms 5000` 复探 |
| `--mode web` 报「缺 `@deepseek-ai/dsh-web-app`」 | 本票还没接 web bundle（属票 07） | 用 `--mode headless` 跑自证，或 `--mode env` 取命令 |
| 端口/路径看着都对、数据却混了 | 你可能直接手跑了 `dsh` 而没走启动器 | 一律用 `node scripts/isolation/startup.mjs`；`--mode env` 可以把同一套变量交给别的工具 |

**一个例外要说清楚**：环境里那支 `DSH_HOME` 指向真实 `~/.dsh` 时，启动器**忽略它**并改用默认隔离 home（在报告 `notes` 里写明）。这是为了让脚本在 DSH 会话里也能安全地跑——在 DSH 里 `DSH_HOME` 天然是 desktop 的。显式的 `--home` / `XUANSHU_DSH_HOME` 指到真实 home 才是硬拒绝（退出码 1）。

## 8. 给下一票的接口

票 05（setup）与票 06（horosa 集成）请从 `scripts/isolation/defaults.mjs` 取常量（端口、`8765`、退出码、`$DSH_HOME/xuanshu/` 数据目录名），不要再各写一份：这份是唯一来源，改了这里两边一起变。

## 9. 附：profile 自己那份 CLI

xuanshu 的 profile 现在自带一支版本相符的 CLI（票 04 补的，理由见 ADR-0006）：

```powershell
E:\ai_project\XuanShu\profile\node_modules\.bin\dsh.CMD --profile xuanshu --help
# 等价于（且与本仓库其它脚本同源）：
node scripts/isolation/startup.mjs --mode env --json   # 看 plan.command
```

**不要**用 PATH 上那个全局 `dsh`：本机 npm 全局装的是 0.1.2-rc.1，与 0.2.0-rc.2 的装配树不兼容（会崩在 `does not provide an export named 'StartupError'`）。启动器的 `cli` 门就是拦这个的。

