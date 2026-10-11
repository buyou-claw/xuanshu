# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root（玄枢术语表：底座/谱/藏/底稿/问事/工作流/多 AI 合参/沉淀/日课/规格级复用…）
- **`docs/adr/`**: read ADRs that touch the area you're about to work in（0001 装配不 fork、0002 首页替换、0003 藏不上 AI、0004 钉版、0005 谱是信息不是能力）
- 另有产品层文档 `product-definition.md`（v10）、`xuanshu-portrait.md`、架构 `docs/architecture-v1.md`、谱规范 `docs/pu-spec-v1.md`、上游侦察 `docs/research/`。

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo（本仓库：无 `CONTEXT-MAP.md`，一个根 `CONTEXT.md` + 全局 `docs/adr/`）。

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-build-on-dsh-by-assembly-not-fork.md
│   └── ...
└── docs/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids（如：别说「模块」，说「谱」；别说「资产」，说「藏」；别说「每日运势」，说「日课」）。

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0004 (pin upstream versions), but worth reopening because…_
