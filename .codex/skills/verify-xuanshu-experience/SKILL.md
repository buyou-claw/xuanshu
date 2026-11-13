---
name: verify-xuanshu-experience
description: 在隔离 home 的系统 Edge 中验证玄枢 Web 用户体验。用于按用户目标探索入口、核对可见和落盘结果、保存证据、重放并缩减异常。
---

# 验证玄枢体验

从玄枢仓库根操作。当前主机的 checkout 在 `E:/other/ai_project/xuanshu`。用 `git rev-parse --show-toplevel` 和 `git status --short --branch` 确认位置和已有改动。要求存在 `scripts/experience/session.mjs`、`run.mjs`、`replay.mjs`；这些是本技能的执行入口。

按 `AGENTS.md` 读开发台账 §10、§16.4、§17.6 及任务相关章节。探索前读领域入口、`CONTEXT.md`、实操体验评估计划与相关界面稿。可执行流程和分类见仓库 `docs/design/ui-v1/自动用户体验侦察与Debug.md`。从[功能地图](features/README.md)选一个用户目标，读对应文件。产品期望以仓库设计稿、规格和冻结判据为准。

## Launch

运行 `node scripts/build-client.mjs --check`。仅缺仓库依赖时，按仓库手册运行 `pnpm install --frozen-lockfile` 后再检查。产物漂移时记录阻塞。读 `docs/runbook/home.md` 与 `docs/runbook/dual-instance.md`。

按 [Windows 会话操作](references/windows-session.md) 启动 `node scripts/experience/session.mjs --out <新报告目录>/scout`，保持同一 stdin 会话。现有 runner 通过 `install-profile.mjs --copy` 和 `scripts/isolation/startup.mjs` 自动准备新 home、体检并启动服务。运行目录在仓库 `.scratch/experience-scout/home-*`，证据在新建的 `ux-reports/verify-xuanshu-*/`。Playwright 优先使用原解析器，找不到时向 runner 传 `--playwright-dir`，当前主机的已装位置见会话操作。使用独立实例，避开正式 home、已有 `.experience-home` 和其他实例的端口。

`{"ready":true}` 表示可收命令。用 Doctor 确认实际应用可用。首次看到模型提示时，按任务决定是否经界面选择「稍后配置」。AI 任务需要独立的测试配置。

## Doctor

启动器自带的 `--mode doctor --json` 在服务启动前检查 home、版本、装配及端口，runner 保存每次的 `doctor-N.json`。先核对 `exitCode` 与各检查详情，horosa 的探测结果单独读。运行中的端口本来会被占用。对已启动实例用下列只读证据检查，遇异常先做同样核对：

- 读取 `environment.json`，核对独立 home、实际 Edge、提交和客户端哈希。比较仓库 `packages/xuanshu-client/lib/client.js` 与安装副本，runner 已在启动前比较两者。
- 读取当前启动代的 `service.jsonl` 和 `network.jsonl`。按 [Windows 进程核对](references/windows-session.md#运行中的进程核对) 验证监听者属于本轮启动器。身份握手应有 303 和会话 cookie，Edge 根页面应有 200 和 DSH boot 标记。
- 向会话发送 `observe` 或带可见断言的 `check`，截图和可访问树须显示本轮应用界面。出现 Loading、白屏或遮罩时保存现场，检查控制台与网络，再决定等待、处理提示或重启。HTTP 200 只证明页面响应。

## Drive

把用户目标和合成输入给探索者。先 `observe`，根据可见状态逐步选择动作，每个动作带 `reason`。优先用角色和精确名称，可用 `label`、`placeholder`、`text` 或 `within`。从根入口走真实可用控件。需要观察状态时用 `check`，保留可访问树和截图。写盘后用界面重新找回并读回相同数据。禁止强制点击、内部写接口、直接改业务文件和假造服务成功。

- `pnpm verify:ux --static --out <本轮目录>/static` 记录冻结判据基准，检查报告里的未采到项。现有浏览器采集使用 link profile，按仓库流程单独运行。静态基准和本轮实操证据各自解读。
- 需要现有真机回归时，在本轮任务完成后向该专用会话发 `{"type":"verify-live"}`。检查 `verify-live.log` 的 PASS、FAIL、汇总和汇总后异常。发生定位超时或中途退出时标记部分执行，未到达的断言记为未验证。退出 0 仍可能有失败；出生命盘、底稿或 AI 断言可能需要当前实例未准备的状态。基线红项对照样板报告与本轮证据记录归属。

## Evidence

任务必须交出同一次运行的 `environment.json`、`steps.jsonl`、`screens/`（截图和可访问快照）、每个启动代的 `trace-N.zip`、`console.jsonl`、`network.jsonl`、`persistence.jsonl` 和 `service.jsonl`。写盘路径用 UI 与只读数据相互印证；藏库用 `registry` 读取同一 home 的注册表。用合成数据，原始 trace 留本地。结果写覆盖表，注明验证到的界面、状态、阻塞和未执行项。按已有设计区分确认 Bug、间歇问题、自动化缺陷、体验启发式发现和需人工判断项。

## Replay

需要验证异常或示范缩减时，按[重放配置](references/replay.md)从本轮 `steps.jsonl` 选取已执行动作与同一可观察指纹。运行仓库 `scripts/experience/replay.mjs`，它用新的 copy home 重放、缩减及关停。解读实际有效尝试、复跑结果和最短性限定。保留未经证实的结果，已有问题仅登记证据，产品和判据修订另按用户授权。

## Cleanup

成功、失败和阻塞都走相同收尾。给自己持有的会话发送 `{"type":"close"}` 或结束 stdin，等待退出。此命令没有 JSON 回复。会话关闭 Edge、封存 trace 并关停它启动的进程树。按会话操作核对端口已释放、`service.jsonl` 有停止记录，关闭后重新读取证据。重放也要检查每次尝试的停止记录。

保留 `ux-reports/` 和对应 home 内的持久化证据。合成文件仍是登记指针的目标，随证据保留。另需移除非证据性临时目录时，先读 `docs/agents/parallel-work.md` §2 并核对实际路径和 junction；只清理由本轮创建的目录。遇关停失败，核对本轮 PID 与父子关系后处理，禁止按进程名或仅凭端口终止其他实例。
