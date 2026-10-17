# AGENTS

本文件是仓库级 agent 说明书入口。工程技能（to-spec / to-tickets / implement / triage 等）按下方各节读取配置。

## Agent skills

### Issue tracker

Issues 与 specs 存放在 GitHub Issues（`buyou-claw/xuanshu`），经 `gh` CLI 或 GitHub MCP 工具操作。See `docs/agents/issue-tracker.md`.

### Domain docs

single-context：根目录一个 `CONTEXT.md`（玄枢术语表）+ `docs/adr/`（全局决策）。See `docs/agents/domain.md`.

### 仓库现状与验证

- **现状 / 证据 / 陷阱**：`docs/development-status.md` —— 票→issue 对照、验证边界、操作陷阱都在这一份里，动手前先读。
- **验证一条命令**：`pnpm verify:all`（类型 + 产物同步 + 用例清单门）。要往文档或 PR 贴数字，抄工具输出：用例计数 = `pnpm test:inventory`，五 seam = `pnpm verify:assembly`。
- **`.scratch/` 是未入库的证据前置**：若干测试靠它（缺了会红或跳过，见台账 §10）——动它之前先读那条测试要读什么文件。
- **删 worktree / 依赖目录**：`pnpm cleanup:worktrees`（先证明分支已并入，再存档，再删）。`Remove-Item -Recurse` 会跟随 pnpm 的 junction，删掉的是仓库根的真件。
