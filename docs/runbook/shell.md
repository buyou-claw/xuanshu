# 桌面壳 `xuanshu-shell` 运行手册

> 状态：Spec 002 / 票 02（#23）交付。壳的实现与单测在 `packages/xuanshu-shell/` 与 `tests/shell/`。
> 本文件写「怎么把它跑起来、哪些必须真机验收、怎么干净地停掉」。

## 它是什么（以及不做什么）

壳只做四件事：

1. 看护 `dsh --profile xuanshu --port 19388 --no-open` 子进程（退出 / 崩溃会如实显示并重拉）；
2. 承载窗口：**只在拿到子进程 stdout 打印的认证 URL 之后**才加载玄枢首页，没拿到就显示「服务未就绪」；
3. 托盘与关窗行为：关窗默认隐藏（首次给一次性说明）、托盘菜单「打开 / 退出」、开机自启；
4. 接收宿主发来的回环通知并弹系统通知（`POST /v1/notify`）。

壳**不实现任何业务**：不写业务数据、不做深链/路由、不改 DSH 源码。与宿主的唯一 IPC 是回环 JSON
通知端点；设置经由同一 home 下的 `shell-settings.json`（壳读、宿主写）。

## 前置

- Node **≥ 22**（`node --version`）；`dsh` 子进程也由它拉起（可用 `XUANSHU_NODE_BIN` 指定别的 node）。
- 已装好玄枢 profile：`node scripts/install-profile.mjs --home .dsh-home`（开发期）。
- 通知/托盘/自启的真实行为需要一台**有桌面会话的 Windows**；CI 只跑纯模块测试。

## 开发期运行（仓库检出）

```pwsh
# 仓库根
pnpm install                                   # 会装 electron 38.2.2（约 125MB，见下）
pnpm --filter xuanshu-shell exec electron .    # 首次启动会 spawn dsh；窗口先显示「服务未就绪」
```

- **home**：从 `pnpm-workspace.yaml` 所在目录判定开发档 = `<repo>/.dsh-home`。也可以显式给：
  ```pwsh
  pnpm --filter xuanshu-shell exec electron . -- --home <repo>/.dsh-home
  ```
- **profile**：默认 `xuanshu`；`--profile <name>` 或 `XUANSHU_PROFILE` 覆盖。
- **端口**：默认 `19388`（`--port <n>` / `XUANSHU_WEB_PORT` 覆盖）。**永远不要用 19387**（那是 DSH 桌面版的）。
- **DSH 入口**：`XUANSHU_DSH_BIN` > `<home>/profiles/xuanshu/node_modules/@deepseek-ai/dsh/lib/bin.js` > PATH 的 `dsh`。
- 日志都在启动它的终端里（`[shell]` / `[dsh]` 前缀）；窗口不显示技术细节时先看终端。

### Electron 二进制装不上时

`pnpm install` 里 electron 的 postinstall 会从 GitHub 下 ~125MB 运行时。网络不通时：

```pwsh
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
pnpm install
pnpm --filter xuanshu-shell exec electron --version   # 会报错：说明只有 JS 包、没有运行时
```

这时**纯模块测试仍必须全绿**，但真实窗口/托盘/通知的验收未完成（如实登记，不许写成「已验证」）。
换一台能下载的机器（或配镜像 `ELECTRON_MIRROR`）后重跑安装即可。本机实测 GitHub 直连会
`ETIMEDOUT`，用镜像可以：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; node install.js`
（在 `packages/xuanshu-shell/node_modules/electron` 下跑）。

### 真机踩到的两个坑（2026-10-18，都有最小复现）

1. **`whenReady()` 之前读路径 = 静默必死**。`app.getPath('userData' | 'appData')` / `app.getName()`
   在 ready 前调用，进程会在 ready 之前直接退出，退出码 `0xFFFF7003`（-36861），stderr 只有一行
   `crashpad_client_win.cc: not connected`，**没有任何 JS 报错**——现象就是「双击了没反应」。
   最小复现：`import { app } from 'electron'; app.getPath('userData')` 两行就崩；把它挪到
   `await app.whenReady()` 之后一切正常。因此 `electron-adapter.mjs` 里这三个是 **getter**，
   模块加载期一律不读路径（`createElectronAdapter()` 被 `main.mjs` 顶层调用）。
2. **这台机器上 Chromium 沙箱起不来**：不带 `--no-sandbox` 时任何 Electron 程序都
   `0x80000003`（STATUS_BREAKPOINT）退出，12 行的最小程序同样如此。所以本机启动器
   （`玄枢.lnk` / `玄枢-开发档.cmd`）都带 `--no-sandbox`。这是**机器级**结论，不是壳的缺陷；
   换机器应重新判定，不要默认把这个开关写进产品默认值。

> 若连最小程序都**卡在 `whenReady()`**（连 profile 目录都不创建），说明机器当前状态下 Chromium
> 根本初始化不了 —— 先用 `dist\Electron自检.cmd` 判定，再决定是重启机器还是查沙箱/安全软件。


## 手测清单（真实机器）

按验收顺序做一遍，每步记录结果：

1. **双击启动**：`pnpm --filter xuanshu-shell exec electron .`（打包后是玄枢的 exe）。
   预期：窗口出现并显示「服务未就绪（正在启动）」；DSH 起来后（首次可能 10~60s）自动换成玄枢首页。
   若一直是「服务未就绪」，看终端里的 `[dsh]` 日志：是不是 profile 没装 / 端口被占 / 找不到 node。
2. **托盘**：任务栏托盘出现玄枢图标；左键点击→显示窗口；右键菜单有「打开」「退出」，
   另有一条当前状态和「开机自启：…（已开/已关）」。
3. **关窗常驻**：第一次点窗口的 × → 弹出「还在后台运行」的一次性说明 → 窗口隐藏。
   检查：壳进程与 DSH 子进程都还在；`Get-NetTCPConnection -LocalPort 19388 -State Listen` 仍有监听；
   托盘「打开」能恢复窗口（第二次关窗不再弹说明）。
4. **设置里的关窗即退出**：玄枢首页 →「设置 → 通用」→ 勾上「关窗口行为（关窗即退出）」，
   再关窗：壳直接走「先停子进程再退壳」。同一行下面是「实际生效」状态（关窗：退出）。
   *（手改 `<home>/xuanshu/shell-settings.json` 是排障手段，不是正常路径：界面写的就是这份文件。）*
5. **真退出**：托盘「退出」→ 先看到子进程退出、再退壳；确认没有孤儿：
   ```pwsh
   Get-Process node -ErrorAction SilentlyContinue | Select-Object Id,Path
   Get-NetTCPConnection -LocalPort 19388 -State Listen -ErrorAction SilentlyContinue
   ```
   两条都应为空（或者至少 19388 不再监听）。
6. **单实例**：壳开着时再启动一次 → 不出现第二个窗口/第二个 DSH，只把已有窗口唤到前面。
7. **子进程异常退出**：在任务管理器里结束 DSH 的 node 进程 → 窗口/托盘显示「服务未就绪（第 N 次重拉）」，
   退避后自动重拉并在就绪时换回首页；连续失败到上限会显示「已停止重拉」。
8. **壳被硬杀**：任务管理器结束 electron 进程 → **不应留下 DSH 子进程**（独立看门狗负责）。
   重复 3 次。若偶发留下，记录机器负载与时间，写进风险表（见下）。
9. **开机自启**：玄枢首页 →「设置 → 通用」→ 勾上「开机自启」，看一眼行下的「实际生效」：
   它显示的是**这台机器上实际用了哪条路**（登录项 / 启动文件夹快捷方式 / 不支持），
   不是设置里勾的值。随后核对：
   - 登录项方式：任务管理器 →「启动」里有玄枢（开发期注册的是 electron.exe，这是**如实**的）；
   - 快捷方式方式：`Win+R` → `shell:startup` 里有「玄枢.lnk」；
   - 托盘/状态页显示的「实际生效方式」要与之一致；两边都不可用时显示「不支持（未生效）」。
   *（手改 `shell-settings.json` 的 `autostart` 是排障手段，不是正常路径。）*
10. **通知**：壳运行、玄枢首页加载后，用状态文件里的 url/token 手动发一条（见下）；
    预期系统通知弹出；点通知 → 窗口被唤到前面并**停在玄枢首页（overview）**。
    落点靠 hash（`#xuanshu-overview`，前端仍无路由）；`target:'consult'` 也只到 overview ——
    「点哪条进哪页」仍未做（前端无路由，靠不存在的深链不做假按钮）。
    Windows 上如果通知不弹：先在系统设置里确认「通知」允许；仍不弹则记为未验证项。

### 手动发一条通知（不跑宿主）

```pwsh
$state = Get-Content "$HOME/.dsh-home/xuanshu/runtime/shell-notify.json" -Raw | ConvertFrom-Json
$body = @{
  schema = 'xuanshu/notify@1'; id = 'notify-manual-1'; kind = 'rikke'
  title = '今天的日课已生成'; body = ''; silent = $false
  target = 'overview'; createdAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$($state.url)/v1/notify" -ContentType 'application/json' `
  -Headers @{ authorization = "Bearer $($state.token)" } -Body $body
```

返回 `{ok:true,delivered:true}` = 构造并 `show()` 没抛（契约 §2 的 delivered 语义，**不等于**「你看到了」）。
`delivered:false` 会带 `reason`（`unsupported` / `permission-denied` / `failed`）。
换一个错 token 应得 401；删一个必填字段应得 400。

## 必须真机验收 / 仍未确认的清单

这些在 #23 的实现里**只能由单测覆盖到判据层**，真实观感/系统行为仍需人验：

- [ ] Windows toast 是否可见、是否被「专注助手/通知关闭」吞掉（delivered=true 但用户没看到是可能的）；
- [ ] 通知点击在**隐藏窗口**状态下是否真的把窗口带到前台（Electron 版本 / 平台焦点策略相关）；
- [ ] 认证 URL 的 token 是否有有效期、隔夜后是否仍能加载（研究笔记 `docs/research/spec002-resident.md` §「仍未确认」1–3）；
- [ ] 托盘图标在 Windows 深/浅色任务栏上的可见性（当前是运行时画的占位图标，不是正式设计稿）；
- [ ] Linux 上托盘是否可用（无托盘时壳只记日志、窗口照常）；
- [ ] 硬杀壳时看门狗的真实回收率（见手测 8）；
- [ ] 开机自启在「装好的应用」形态下的注册项与更新后的行为（本票没有打包流程）。

## 干净地停止

- **推荐**：托盘菜单「退出」→ 壳先 `SIGTERM` 子进程、等它退出（超时才 `SIGKILL`），再关通知端点、
  删运行时状态文件、退壳。
- **设置里的关窗即退出**：同一条退出路径。
- **兜底**：任务管理器结束 electron 进程；独立看门狗会把 DSH 子进程收掉。若仍有残留：
  ```pwsh
  Get-NetTCPConnection -LocalPort 19388 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
  ```
  （先 `Get-Process -Id` 确认那是玄枢的 node，不要误杀别的进程。）
- 退出后 `<home>/xuanshu/runtime/shell-notify.json` 与同目录的 `shell-status.json` 应被删除；
  宿主读不到会如实记「没有壳」（设置页显示实际生效方式为「未知」）。

## 排障一句话表

| 症状 | 先看 |
|---|---|
| 窗口一直「服务未就绪（正在启动）」 | 终端 `[dsh]` 日志；profile 是否装好；`Get-NetTCPConnection -LocalPort 19388` 是否被别的进程占 |
| 「服务未就绪（连续 N 次启动失败）」 | 子进程 stderr 尾部；`XUANSHU_DSH_BIN`/node 路径；home 是否指到了真实 `~/.dsh`（会被拒绝） |
| 通知 401 | 状态文件里的 token 与请求头是否同一份；壳是否重启过（token 每次启动都换） |
| 通知 400 | 载荷字段：schema/id/kind/title/target/createdAt；`body` ≤ 200 字、`title` ≤ 120 字 |
| 设置改了没反应 | 壳每次关窗/建托盘菜单前都会重读；`fs.watch` 只是加速，文件写坏会静默回落默认值 |
| 设置页显示「实际生效方式：未知」 | 壳没在跑（或旧版壳没写 `runtime/shell-status.json`）；设置值本身仍会写进 `shell-settings.json`，下次壳启动生效 |
| 设置页「实际生效」与勾选值不一致 | 系统把启动项拦下了（看 `shell-status.json` 的 `autostart.method` 与 `enabled`；两条路都不可用时是 `unsupported`） |
| 自启显示「不支持」 | 平台既没有登录项 API 也没有启动文件夹（如 Linux）；或写快捷方式被拦 |
| 第二个实例没反应 | 第二个进程只负责唤醒第一个；第一个被托盘隐藏时应弹到前台（看托盘是否还在） |

## 相关文件

- 实现：`packages/xuanshu-shell/lib/*.mjs`（纯模块 + `electron-adapter.mjs` 是唯一 import electron 的文件）
- 测试：`node ./node_modules/vitest/vitest.mjs run tests/shell`
- 契约：`.scratch/notes/spec002/contract-shell-notify.md`（§0 子进程/env/URL、§1 状态文件、§2 端点、§5 设置）；
  P1 的运行时状态文件 `runtime/shell-status.json`（自启实际生效方式 / 关窗行为）是**加性**扩展，
  与 `shell-notify.json` 同目录，宿主从 `XUANSHU_SHELL_NOTIFY_STATE` 的同目录兄弟推导，不新增 env。
- 决策：`docs/adr/0014-own-desktop-shell-and-home.md`
