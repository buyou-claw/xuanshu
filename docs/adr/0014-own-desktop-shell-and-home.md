# 玄枢有自己的桌面壳与 home，与 DSH 桌面版零交集

> 状态：accepted ｜ 日期：2026-10-17 ｜ 来自 Spec 002 的设计访谈（产品口径由用户拍板）

Spec 002 需要「关窗口退到后台」「托盘」「到点系统通知」。侦察结论（`docs/research/spec002-resident.md`）是：钉版 `dsh-v0.2.0-rc.2` 里**没有任何宿主/插件可达的 OS 通知通道**，前端也没有 service worker，托盘与关窗隐藏**只存在于 DSH 的 Electron 桌面壳**里，而那个壳硬编码 `desktop` profile 与 `19387` 端口、不接受 profile 参数。

因此当时只有两条路：把玄枢的 bundle 装进 DSH 桌面版的 `desktop` profile（白得托盘/通知，但与日常 DSH 共生）；或自己造一层壳。**用户明确裁定：玄枢必须完全独立于 DSH 桌面版，两者同时运行、互不干扰，不能有任何关联。**

**决定：玄枢有自己的桌面壳（`xuanshu-shell`，Electron）和自己的 DSH home（`~/.xuanshu`），与 DSH 桌面版零交集。**

- 壳只做四件事：看护 `dsh --profile xuanshu --port 19388 --no-open` 子进程、承载窗口、托盘与关窗/自启行为、展示并响应宿主发来的通知。**不实现任何业务**。
- 壳与宿主之间只有一条契约：回环上的 JSON 通知端点（`{kind,title,body?,silent?,target}`）。壳可替换，业务不受影响。
- home 独立：玄枢不读写 `~/.dsh`（DSH 桌面版的 home）。代价是 provider 密钥要在玄枢自己的「设置 → 模型」里配一次——这是用户已接受的口径（「用户自己在 DSH 里配」）。
- 这条同时把 Spec 002 访谈里 Q11 的「与 DSH 同 home 的独立 profile」上调为「独立 home」：共用 home 就是共用凭据与会话，与「零交集」直接冲突。

**Considered Options**（都不选）：

- **装进 DSH 桌面版的 `desktop` profile**：托盘/关窗后台/Web Notification 全部现成，但玄枢与用户日常 DSH 同生共死、且 CLI 明确拒绝管理 `desktop` profile；与「零交集、必须同时运行」正面冲突。
- **独立 profile + 自建 OS 通知件（不造壳）**：保住隔离，但托盘/退出/重开都没有着落，通知只能靠 PowerShell toast 一类未验证手段（AUMID 可见性、杀软拦截、token 时效都不可控）。
- **在 DSH 桌面壳上打补丁 / 复用它跑第二个 home**：端口 `19387` 硬编码且单实例锁，两个实例无法同时跑；改它等于 fork。

**Consequences**：

- 新增一个 Electron 包与约 200MB 运行时；只用于壳，不进业务进程。
- 「点通知进今日视图」是壳能做到的极限：钉版前端没有路由，做不到「点哪条进哪页」。今日视图 = 首页，日课卡在首屏。
- 通知失败（权限、系统关闭）必须可观察：壳回报投递结果，宿主落账、界面显示未读与原因；**不允许**把「没推成」显示成「推过了」。
- 开发期隔离（ADR-0006）在此之上再收紧：断言玄枢 home 解析结果永不指向 `~/.dsh`。
- 壳是本期唯一的新跨进程面，必须可单测（子进程替身 + 假 Electron 适配层），且测试不得依赖真实窗口。
