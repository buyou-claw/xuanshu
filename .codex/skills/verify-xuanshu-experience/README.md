# verify-xuanshu-experience（仓库存档副本）

Codex 用户级技能 `verify-xuanshu-experience` 的版本化副本。技能本体见 [SKILL.md](SKILL.md)：在隔离 home 的系统 Edge 里，按用户目标探索玄枢 Web、核对可见与落盘结果、保存证据、重放并缩减异常。

- 正文来源：技能在 `SKILL.md`，功能地图在 [features/README.md](features/README.md)，平台细节在 `references/`。
- 可执行入口：仓库的 `scripts/experience/session.mjs`、`run.mjs`、`replay.mjs`。本目录只放技能说明，不含执行器。
- 工作流设计与判据仍在 `docs/design/ui-v1/自动用户体验侦察与Debug.md`，本技能是对它的可执行封装。

## 安装

Codex 只从用户级目录发现技能，仓库副本需复制到 `$CODEX_HOME/skills`（本机为 `C:\Users\Lenovo\.codex\skills`）：

```powershell
Copy-Item -Recurse -Force .codex\skills\verify-xuanshu-experience "$env:USERPROFILE\.codex\skills\"
```

复制后用 Codex 的 `skills/list` 确认 `enabled: true`，再按 [SKILL.md](SKILL.md) 从仓库根运行。仓库副本是权威版本，改技能先改这里再复制过去。

## 可移植性

技能叙述里的本机路径（checkout `E:/other/ai_project/xuanshu`、Playwright 目录）是取证时的实际值。换 checkout 或换机器时，按 [SKILL.md](SKILL.md) 首段用 `git rev-parse --show-toplevel` 确认仓库根，并改 [references/windows-session.md](references/windows-session.md) 的 `repo` 与 `pwDir`。这些是运行参数，不是产品断言。

## 验收状态

冷启动验收：一个没有前序会话的 Agent 仅凭本技能启动新 home，在 Edge 经 Doctor 核验、验证错误路径被拒绝、修正后成功登记、重启后按签找回同一记录，登记 ID 与注册表哈希一致。入库的 `SKILL.md` 与当时加载的副本逐字节相同（`sha256 786b4412…2ecf`，与取证记录 `codex-skill-discovery.json` 的 `skill.sha256` 一致）。

取证目录按 `.gitignore` 不入库，本机保留在 `ux-reports/verify-xuanshu-rwMBW9/`：`report.md` 为实跑报告，`codex-skill-discovery.json` 为 `skills/list` 发现记录，`scout/`、`replay-filled-name/`、`final-checks.json` 为原始证据与关停核对。

已实跑：藏库。已核对入口与验收条件、未实跑：[自我总览与命盘](features/overview.md)、[问事与历史](features/consult.md)、[谱管理](features/pu.md)。
