# verify-xuanshu-experience（项目级技能）

玄枢仓库的项目级技能，随仓库版本化。技能本体见 [SKILL.md](SKILL.md)：在隔离 home 的系统 Edge 里，按用户目标探索玄枢 Web、核对可见与落盘结果、保存证据、重放并缩减异常。

- 正文来源：技能在 `SKILL.md`，功能地图在 [features/README.md](features/README.md)，平台细节在 `references/`。
- 可执行入口：仓库的 `scripts/experience/session.mjs`、`run.mjs`、`replay.mjs`。本目录只放技能说明，不含执行器。
- 工作流设计与判据仍在 `docs/design/ui-v1/自动用户体验侦察与Debug.md`，本技能是对它的可执行封装。
- 技能名 `verify-xuanshu-experience`，kebab-case，frontmatter 只有 `name` + `description`。

## 安装与加载

按项目级技能使用：放在仓库 `.codex/skills/verify-xuanshu-experience/`，随仓库走，不复制到用户级目录 —— 两份副本会各自漂移，且用户级副本读不到本 checkout 的执行器。仓库副本是唯一权威版本，改技能只改这里。

若所用客户端只扫描用户级目录，再临时复制一份（复制后不再回写仓库副本）：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.codex\skills" | Out-Null
Copy-Item -Recurse -Force .codex\skills\verify-xuanshu-experience "$env:USERPROFILE\.codex\skills\"
```

## 本机参数（已适配）

技能是仓库副本，运行参数按本机写入，换 checkout 或换机器时只改这两处：

| 参数 | 位置 | 本机值 |
| --- | --- | --- |
| `repo` | [references/windows-session.md](references/windows-session.md) 的 Node REPL 段 | `E:/ai_project/XuanShu` |
| `pwDir` | 同上 | `C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright` |

本机已用 `git rev-parse --show-toplevel` 核对仓库根，并确认 `pwDir/package.json` 存在。运行 `node --input-type=module -e 'import {resolvePlaywright} from "./scripts/ux/collect/browser.mjs"; console.log(Boolean(resolvePlaywright()))'` 实测返回 `true`：仓库没装 playwright，但默认解析器在 `%APPDATA%\npm\node_modules\playwright` 命中，所以 `pwArgs` 为空、`pwDir` 只是兜底，默认路径失效时才会用到。这些是运行参数，不是产品断言。

## 验收状态

取证时的冷启动验收（PR #85 入库版本）：一个没有前序会话的 Agent 仅凭本技能启动新 home，在 Edge 经 Doctor 核验、验证错误路径被拒绝、修正后成功登记、重启后按签找回同一记录，登记 ID 与注册表哈希一致；当时入库的 `SKILL.md` 与加载副本逐字节相同（`sha256 786b4412…2ecf`，与取证记录 `codex-skill-discovery.json` 的 `skill.sha256` 一致）。

本机适配后 `SKILL.md` 与 `references/windows-session.md` 已按上表改过，不再是那个哈希；验收结论仍指同一套执行路径与同一批执行器，未因改路径而改变。

取证目录按 `.gitignore` 不入库，作者机器上保留在 `ux-reports/verify-xuanshu-rwMBW9/`：`report.md` 为实跑报告，`codex-skill-discovery.json` 为 `skills/list` 发现记录，`scout/`、`replay-filled-name/`、`final-checks.json` 为原始证据与关停核对。

已实跑：藏库。已核对入口与验收条件、未实跑：[自我总览与命盘](features/overview.md)、[问事与历史](features/consult.md)、[谱管理](features/pu.md)。
