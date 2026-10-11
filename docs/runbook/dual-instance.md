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
| `home` | `$DSH_HOME` 解析结果**不能**在真实 `~/.dsh` 下 | 2 |
| `cli` | CLI 必须是 profile 树里那份，且版本 = `dsh-base` 版本 | 2 |
| `profile` | `$DSH_HOME/profiles/xuanshu` 有 `package.json` + `node_modules`（缺了用 `--install`） | 2 |
| `webPort` | `127.0.0.1:<web-port>` 没人 LISTEN | 3 |
| `horosaGuard` | `127.0.0.1:<horosa-port>/mcp` 要么空着、要么是 horosa 自己在答 | 3 |
| `stateIsolated` | 七条派生路径（profile/数据目录/sessions/storages/凭据/机器补丁/装配报告）全落在同一个 `$DSH_HOME` 下 | 3 |

退出码不是只有 0/1：**2 = 环境不对（改用法或装 profile），3 = 隔离不成立（腾端口/查谁占了）**，处置完全不同。

## 2. 两条并跑命令

```powershell
# ① desktop：照常开应用（Electron 自己管 19387 与 ~/.dsh），下面这条只是"确认它在"
Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 19387 | Select-Object LocalAddress,LocalPort,OwningProcess

# ② xuanshu：独立 home + 独立端口，在另一个终端里
node scripts/isolation/startup.mjs --mode web                 # 默认 19388，等价于 dsh --profile xuanshu web --port 19388 --no-open

# 或者：被测实例不开端口（CI / 只想跑一次装配自证）
node scripts/isolation/startup.mjs --mode headless            # 真跑一次 CLI 启动，断言数据目录里新写出 assembly-report.json
```

`--mode env` 不 spawn，只把环境变量与命令打出来，交给别的工具用：

```powershell
node scripts/isolation/startup.mjs --mode env
# → plan.env（含 DSH_HOME=…、DSH_TELEMETRY_DISABLED=1、NO_COLOR=1）与 plan.command
node scripts/isolation/startup.mjs --mode env --json | ConvertFrom-Json   # 结构化
```

`--` 之后的参数原样透传给 `dsh`（逃生舱，不属于本票验收面）：

```powershell
node scripts/isolation/startup.mjs --mode web -- --trusted-host xuanshu.test
```

## 3. 三个旋钮

| 旋钮 | 默认 | 命令行 | 环境变量 |
|---|---|---|---|
| 隔离 home | `<repo>/.dsh-home` | `--home <dir>` | `XUANSHU_DSH_HOME`（其次才是 `DSH_HOME`） |
| xuanshu web 端口 | `19388` | `--web-port <n>` | `XUANSHU_WEB_PORT` |
| horosa 端口 | `8765` | `--horosa-port <n>` | `XUANSHU_HOROSA_PORT`（其次 `HOROSA_SKILL_PORT`） |

优先级：**显式命令行 > `XUANSHU_*` 环境变量 > 定值**。
profile 名同理（`--profile` / `XUANSHU_PROFILE`），默认 `xuanshu`。

**有两个端口不能动**：

- `19387` —— desktop 的。启动器不会去占它，报告里也会把它标成"desktop 的"。
- `8765` —— horosa 的默认端点。要换只能**两边一起换**（`serve --port` 与 `--horosa-port`），否则守卫会看到"端口空着"而放行、实际连的是另一个端口。

## 4. `8765` 守卫的四种结论

拉起实例前启动器探一次 `http://127.0.0.1:<horosa-port>/mcp`：

| verdict | 含义 | 启动器怎么办 |
|---|---|---|
| `free` | 没人 LISTEN | 放行。horosa 未启动是**正常**状态（票 05/06 才托管它的生命周期） |
| `horosa-ready` | 有人在答，且应答形态像 MCP 端点（`mcp-session-id` 头 / JSON-RPC body / `405 + allow: POST`） | 放行，报告里记下证据 |
| `occupied-foreign` | **有进程占着，但不是 horosa** | **fail-fast，退出码 3**，报告里给 `hint`（排查命令 + 换端口命令 + `--transport stdio` 免端口方案） |
| `probe-failed` | 探针自身出错（不是"被占"） | 记 `unknown` 写进报告与 `notes`，不算隔离失败 |

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
| I5 | 两个隔离 home 各真跑一次 `headless`，各自写出自己的 sessions/storages/装配报告，文件清单不相交 |
| I6 | 跑完测试后用户真实 `~/.dsh` **无新增无删除**、里面不出现 `xuanshu/`、所有运行的 home 都不是真实 home；mtime/size 指纹只作证据（本机 desktop 与我们并发写同一个 `~/.dsh`，指纹无法归因到某一次运行） |
| I7 | xuanshu 的端口 ≠ `19387` |

CI / 交付前用 `XUANSHU_REQUIRE_ASSEMBLY=1` 把"profile 没装"从 skip 变成硬失败——否则"没装 = 全绿"。

### 写这类测试时的一个坑（已踩过）

验收台用 `spawnSync` 跑被测进程，**会阻塞测试进程自己的事件循环**。所以 I4 的对照组服务端**必须起在独立进程里**：如果它长在测试进程内，探测发出的那一刻它不被调度 —— TCP 连得上（内核 backlog 就 ACK）、HTTP 永远不响应，于是所有"有 HTTP 响应"的对照组都退化成 `occupied-foreign`，而 `horosa-ready` 的两态会**假绿**。对照组服务端在 `tests/isolation/lib/fixture-server.mjs`（独立进程），断言里钉了"真拿到响应"的证据（`status` / `mcp-session-id`）。

## 6. 回滚

隔离是**加法**，回滚就是删掉那个 home：

```powershell
Remove-Item -Recurse -Force E:\ai_project\XuanShu\.dsh-home    # 只删隔离 home，desktop 与 ~/.dsh 不受影响
```

三件东西**不在**回滚范围内（它们本来就不归本票管）：desktop 的 `~/.dsh`、horosa 自己的 runtime 与记忆（`HOROSA_RUNTIME_ROOT` / `HOROSA_SKILL_DATA_DIR`）、以及仓库里 `profile/node_modules`（`pnpm install` 的产物，`.gitignore` 已忽略）。

启动器与测试**不会**往真实 `~/.dsh` 写任何东西：`home` 解析到真实 home 时直接用法失败（**没有** `--allow-real-home` 这种逃生舱），I6 还会在每次跑测后核对指纹。

## 7. 报错对照表

| 现象 | 含义 | 处置 |
|---|---|---|
| `refusing to run against the user's real DSH home` | `--home`/环境变量指到了 `~/.dsh` | 用默认 `.dsh-home`，或给一个隔离目录 |
| `web port 19388 is busy (pid …, …)` | 已经有一个 xuanshu 实例在跑（或别的进程占了） | 先关掉那个实例；确认是别人占的就换 `--web-port` |
| `profile not installed` | `<home>/profiles/xuanshu` 缺 `package.json`/`node_modules` | `node scripts/install-profile.mjs --home <dir>`，或加 `--install` |
| `cli version mismatch` | profile 树里的 `@deepseek-ai/dsh` 与 `dsh-base` 版本不一致 | 重跑 `pnpm install`（`profile/` 下），别用 PATH 上全局那份（0.1.2-rc.1） |
| `occupied-foreign` + `hint` | `8765` 被非 horosa 进程占着 | 见 §4 |
| `probe-failed` | 探针自身出错（网络栈/权限） | 看报告 `evidence.error`；这一条**不算**隔离失败，但别当绿灯 |
| 端口/路径看着对、数据却混了 | 你可能直接手跑了 `dsh` 而没走启动器 | 一律用 `node scripts/isolation/startup.mjs`；`--mode env` 可以把同一套变量交给别的工具 |

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

