# Spec 002 可行性侦察：常驻 · 到点系统通知 · 点通知进今日日课

> 侦察对象 = 玄枢实际跑的钉版 `@deepseek-ai/*@0.2.0-rc.2`（`.dsh-home/profiles/xuanshu/node_modules/@deepseek-ai/`）
> ＋ 桌面外壳 `E:\DeepSeek Harness\resources\app.asar`（`@deepseek-ai/dsh-desktop@0.2.0-rc.2`，只读内存解包，未落盘）。
> 文中 `@deepseek-ai/dsh-desktop/...` 均指 app.asar 内路径；`packages/...` 指本仓。
> `docs/specs/` 现只有 001，本文件是 002 立项前的可行性证据，不是 spec。

## 结论先行

1. **常驻**：**能做，只对了一半**。玄枢现在是独立 node 进程（`dsh --profile xuanshu`），web 只是它监听的一个端口，关浏览器不影响它；但「关窗口默认退到后台（托盘）」和「开机自启」在 CLI 形态里**都不存在**，必须自建 OS 侧，或改用桌面壳形态（壳自带托盘与关窗退后台，但它跑的是 `desktop` profile，不是玄枢）。
2. **到点系统通知**：**不能**（钉版内无任何宿主/插件可达的 OS 通知通道）。壳里的 `Notification` 只服务强制更新且不对外暴露；插件侧全仓无 notification API；前端无 service worker。回落只能是 OS 侧自建通知器，或把玄枢装进桌面壳后由页面自己调 Web Notification。
3. **点通知进今日日课**：**不能**（rc.2 前端没有路由；桌面壳的 `dsh://` 只做「聚焦窗口」）。回落：通知点击只打开固定地址（`http://127.0.0.1:19388/`）落到玄枢首页，由玄枢把「今日日课」做成默认视图；「点哪条进哪页」是新增开发。

## 证据

| 结论 | 证据（file:line） | 强度 |
|---|---|---|
| 宿主形态 = Electron 桌面壳，不是浏览器壳 | `@deepseek-ai/dsh-desktop/package.json:3`（"Electron desktop shell…"）、`:8`（main=lib/main.js）；`@deepseek-ai/dsh-desktop/lib/main.js:5`（引入 Tray/Notification/BrowserWindow） | 实装源码 |
| dsh 运行时是外壳 spawn 的子进程（stdio 带 ipc） | `@deepseek-ai/dsh-desktop/lib/main.js:3673-3691`；入口 = `dsh-desktop-host/lib/index.js` | 实装源码 |
| 关主窗口 = 隐藏，不退出、不杀子进程 | `@deepseek-ai/dsh-desktop/lib/main.js:12028-12040`（close → preventDefault → hide）；`:12014-12021` | 实装源码 |
| 只有真退出才拆后端 | `@deepseek-ai/dsh-desktop/lib/main.js:12228-12245`（before-quit → finishQuit）、`:12216-12218`（`backend.close()`） | 实装源码 |
| `window-all-closed` 只在真关窗后发生（退出路径） | `@deepseek-ai/dsh-desktop/lib/main.js:12197-12199` | 实装源码 |
| 托盘存在（Windows），含 打开/退出 | `@deepseek-ai/dsh-desktop/lib/main.js:10834-10846`（Tray）、`:11937-11948`（win32 创建，`resources/tray.ico`） | 实装源码 |
| 首次关窗有一次性「退到后台」确认，确认后才隐藏 | `@deepseek-ai/dsh-desktop/lib/main.js:10880-10935` | 实装源码 |
| 外壳没有开机自启 API | `main.js` 全文 grep `setLoginItemSettings` / `openAtLogin` = 0 命中 | 实装源码（否定） |
| 实机也没有自启项 | `HKCU/HKLM\Software\Microsoft\Windows\CurrentVersion\Run` 无 DeepSeek；启动文件夹无快捷方式；无同名计划任务 | 实机状态 |
| 唯一一处 `new Notification` 是强制更新提示，且不对外暴露 | `@deepseek-ai/dsh-desktop/lib/main.js:8908-8924`（构造、click、show） | 实装源码 |
| 外壳 IPC 通道共 35 处，无「通知」通道 | `@deepseek-ai/dsh-desktop/lib/main.js:6242-12003`（`ipcMain.handle/on` 全集，无一条含 notif） | 实装源码（否定） |
| 外壳硬编码 desktop profile + 19387，不接受 profile 参数 | `@deepseek-ai/dsh-desktop-host/lib/index.js:225-235`（app.asar 内 `dsh/node_modules/` 下） | 实装源码 |
| 壳把「已武装的定时提醒」算进退出前检查 → 桌面侧 schedule 是活的 | `@deepseek-ai/dsh-desktop-host/lib/index.js:149-178` | 实装源码 |
| `dsh web` = 起 HTTP 服务 + 顺手开浏览器，不是内嵌 App | `@deepseek-ai/dsh-web-app/lib/index.js:22`（"Serve the … browser UI"）、`:34`（openBrowser 默认 true）、`:205-206`（spawn 浏览器） | 实装源码 |
| CLI 无 service/daemon/autostart 子命令，只有 profile 与 plugin | `@deepseek-ai/dsh/lib/bin.js:41-49`（示例）、`:105`（argv 模型） | 实装源码 |
| headless 跑完一次就退，不能当常驻 | `@deepseek-ai/dsh-headless/README.md:12` | 实装源码（文档） |
| 前端无路由（唯一 hash 用法在 pdf 预览 vendor 里） | `@deepseek-ai/dsh-web-frontend/dist/index.html:1-21`；全包 grep `pushState`/`location.hash` 仅 `dsh-client-ui-sidebar-documentpreview/lib/client.pdf.js:27630` | 实装源码 |
| 有 PWA manifest 但无 service worker → 关页面后无推送/通知 | `@deepseek-ai/dsh-web-frontend/dist/manifest.webmanifest:1-11`；`dist` 无 sw 文件、assets 无 `serviceWorker.register` | 实装源码（否定） |
| 桌面壳对非麦克风权限一律放行（Web Notification 的必要前提） | `@deepseek-ai/dsh-desktop/lib/main.js:6279-6282`（`permission !== "media"` → `callback(true)`） | 实装源码 |
| 桌面壳深链只认 `dsh://open`，不带路由 | `@deepseek-ai/dsh-desktop/lib/main.js:12189-12193` | 实装源码 |
| `ctx.schedule` = 进程内 setTimeout，进程在就会跑 | `@deepseek-ai/dsh-schedule/lib/index.js:1493`（Host timer）、`:1641-1645`（setTimeout + unref） | 实装源码 |
| 到点投递 = 取会话 → followup → 起 turn，不需要客户端在场 | `@deepseek-ai/dsh-schedule/lib/index.js:1576-1597`；`@deepseek-ai/dsh-agent-loop/lib/index.js:806-807`（followup → next-turn + wakeDriver） | 实装源码 |
| 投递语义明确标 host | `@deepseek-ai/dsh-schedule/lib/index.js:1383`（`deliveryMode: "host"`）；`@deepseek-ai/dsh-schedule/lib/types/index.d.ts:68`（`create(sessionId, request)`） | 实装源码 |
| 玄枢已把 schedule 三行插进 profile，日课 07:30 已存在 | `packages/xuanshu-host/cordis.patch.yml:27-35`；`packages/xuanshu-host/lib/digao/tasks.mjs:48`（07:30）、`:49`（03:30 底稿） | 实装源码（本仓） |
| 到点那一刻跑的是宿主侧生成链，不依赖模型/页面 | `packages/xuanshu-host/lib/rikke/delivery.mjs:25`（`agent/pre-step`）、`:62`（`installDailyDelivery`） | 实装源码（本仓） |
| 21:30 晚省目前不存在 | 全仓 grep `21:30` = 0 命中 | 实装源码（否定） |
| 宿主插件可注册自己的 HTTP 路由 | `@deepseek-ai/dsh-host-webserver/lib/types/index.d.ts:14-30`（WebRoute/route 注册） | 类型定义 |
| 宿主插件可拉起本机 GUI 程序 | `@deepseek-ai/dsh-host-open-in-app/lib/types/index.d.ts:1-13`（launch 路由） | 类型定义 |
| 宿主插件可用无 shell 的 execFile 调本机命令 | `@deepseek-ai/dsh-native-command/lib/types/runner.d.ts:9-20`（`runNativeCommand`，显式 `hidden`/`visible` 窗口） | 类型定义 |
| 外部事件可造会话（webhook），但不含通知 | `@deepseek-ai/dsh-webhook/README.md:12-19` | 实装源码（文档） |
| 桌面 profile 已装第三方 bundle + schedule，可作「装进桌面壳」的先例 | `~/.dsh/profiles/desktop/package.json:4-23`（`dshmarket`、`dsh-infinite-gen-5`、`dsh-experimental-schedule-bundle`） | 实机状态 |
| `desktop` profile 被官方独占，CLI 明确拒绝管理 | `@deepseek-ai/dsh/lib/bin.js:35-37`、`:112` | 实装源码 |

## 三条候选落地路径

### 路径 A（最小改动，保住隔离）：独立 profile + OS 侧常驻 + 外部通知器

- **常驻/自启**：登录时由启动文件夹快捷方式或计划任务执行 `node scripts/isolation/startup.mjs --mode web --`（透传见 `docs/runbook/dual-instance.md:52-56`），进程与页面本就解耦（`@deepseek-ai/dsh-web-app/lib/index.js:205-206` 只 spawn 浏览器一次）。
- **通知**：在 `agent/pre-step` 那条链（`packages/xuanshu-host/lib/rikke/delivery.mjs:25`）之后，由 `xuanshu-host` 用 `runNativeCommand`（`@deepseek-ai/dsh-native-command/lib/types/runner.d.ts:9-20`）拉起本机通知器。三条备选：① PowerShell 5.1 + WinRT toast（需注册 AUMID + 开始菜单快捷方式，否则可能静默不弹）；② `msg.exe`（本机存在：`C:\Windows\system32\msg.exe`，消费版行为不稳）；③ 自建 tray helper（koffi FFI `Shell_NotifyIcon`，与外壳同路：`@deepseek-ai/dsh-desktop-host/package.json:14`）。
- **点击**：通知器自己带 URL 打开 `http://127.0.0.1:19388/`（`connection.authenticatedUrl` 的 token 形态，见 `@deepseek-ai/dsh-web-app/lib/index.js:198`）；「进今日日课」靠玄枢把首页默认视图做成今日页——做不到「点哪条进哪页」（无路由，`@deepseek-ai/dsh-web-frontend/dist/index.html:1-21`）。
- **风险**：AUMID/快捷方式要写注册表（用户可感知）；未注册 AUMID 的 toast 可能不可见；杀软会拦「插件拉 PowerShell」；token 是否过期未验证。
- **验证成本**：中。需一台干净 Win 机做 toast 可见性，以及一次「关页面到点仍生成」的端到端（schedule 已在，只差通知器）。

### 路径 B（吃桌面壳现成能力）：玄枢作为 bundle 装进 `desktop` profile

- **依赖**：`~/.dsh/profiles/desktop/package.json:4-23` 已证明第三方 bundle 可装；把 `xuanshu-host` / `xuanshu-client` 加进 bundles，即获得托盘（`@deepseek-ai/dsh-desktop/lib/main.js:10834-10846`）、关窗退后台（`:12028-12040`）、单实例（`:6870-6877`），且 schedule bundle 已在。
- **通知**：客户端可直接 `new Notification()` —— 壳对非麦克风权限一律放行（`@deepseek-ai/dsh-desktop/lib/main.js:6279-6282`），且关窗只是 hide、renderer 仍活着。
- **代价/风险**：① 与 ADR-0006 的双实例隔离正面冲突（`.dsh-home` vs `~/.dsh`）；② 端口钉死 19387（`dsh-desktop-host/lib/index.js:231-235`），玄枢与 DSH 共实例；③ `desktop` profile 归 Electron 独占（`@deepseek-ai/dsh/lib/bin.js:35-37`），装/升只能走应用内插件管理器；④ 壳自带 electron-updater（`@deepseek-ai/dsh-desktop/package.json:10`），更新重装后第三方 bundle 是否保留未验证。
- **验证成本**：低-中（不必造通知器），但验收面变成「玄枢能否在官方 desktop profile 长期共存」，是产品/架构决策。

### 路径 C（最坏回落，不新增任何 OS 能力）

- **做法**：到点仍由 `ctx.schedule` 触发（`@deepseek-ai/dsh-schedule/lib/index.js:1576-1597`），宿主侧生成日课产物并写会话（`packages/xuanshu-host/lib/rikke/delivery.mjs:62`）；「通知」退化为下次打开页面时的未读标记 / 页面内 toast（rc.2 的 Toast 全是 React 组件，如 `@deepseek-ai/dsh-client-ui-schedule/lib/client.js:186-194`）。
- **风险**：技术零风险；产品上直接违背「没有页面也要能看到」，只能当保底。
- **验证成本**：极低（纯现成机制）。

## 仍未确认

1. Windows 上**未注册 AUMID 的 WinRT toast 是否真的可见**（本机未实测，避免打扰用户）。
2. Electron **隐藏窗口**（非销毁）时 renderer 的 `new Notification()` 是否真的弹出——权限放行只是必要条件。
3. `connection.authenticatedUrl` 的 token 是否有有效期；带 token 的 URL 隔夜还能不能用。
4. `msg.exe` 在本机 Win11（22621）消费版的投递成功率。
5. electron-updater 重装后，`file:` 第三方 bundle（`~/.dsh/profiles/desktop/package.json:8`）是否保留。
6. 玄枢客户端能否读到启动 URL 的 query/hash（前端无路由）——这决定「点通知进今日日课」能否落地。
7. `dsh-desktop-host` 引入 koffi 的实际用途未读实现；「自建 tray helper」只是同路推断，不是已验证方案。
