# Spec 001 开发进度

核对日期：2026-10-14。集成分支：`codex/spec-001-integration`。

GitHub issue/PR 的 open 状态不等于未实现：票 01–06 的代码已经在本地提交，相关 PR 尚未合并。本轮从票 07 的未提交工作继续。

| 票 | 状态 | 验证 / 下一步 |
|---|---|---|
| 01–06 | 已有实现提交 | 骨架、设计、素材、隔离、setup、horosa；PR #2/3/4/6/7/9 仍 open |
| 07 | 四卡与 web 启动已实现 | UI/构建 27 项通过，隔离 resolve 16 项通过，真实 HTTP 200 + DSH 认证握手；GitHub #10 |
| 08 | 开发中 | 离线出生地、历史时区、确认出盘、底座谱、命盘详情 |
| 09 | 开发中 | 创建预览、确认落盘、谱列表与编辑；真实 DSH RPC |
| 14 | 开发中 | 指针与签的 JSONL 注册表、系统打开、藏不进 AI |
| 10 | 等待 08/09 | 问事容器与 DSH conversation 协同，审批仍由 DSH 展示 |
| 13 | 等待 08/09 | 底稿与日课、schedule 装配 |
| 11/12/15/16 | 等待 10 | 合参、临时挂载、沉淀、工作流 |

## 验证边界

完整装配五个 seam 的当前结果：S2（进程内启动）、S3（客户端产物）、S4（185 条上游行基线）、S5（真实 CLI 报告）通过；**S1 schema 导出失败**。

失败来自钉版 `@deepseek-ai/dsh-app-boot@0.2.0-rc.2`：它的 schema 导出器只接受 native group/include carrier，而同版本官方 web bundle 自带的四个 `@deepseek-ai/dsh-agent-preset` 是另一种 carrier，报 `unrecognized Loader tree carrier`。真实 web 与宿主启动正常。测试保留失败，无上游源码改动、无放宽断言。

本机 PATH 中的 pnpm shim 指向已不存在的 executable。本轮通过现有 Node 直接执行构建、vitest、tsc；未修改机器全局配置。

## Ticket 来源

票 07–16 原来仅在 ignored `.scratch/assembly-foundation/issues/` 中。本轮保留在 `docs/tickets/`，防止草稿随工作目录丢失。已发布票 07 为 [issue #10](https://github.com/buyou-claw/xuanshu/issues/10)。后续 GitHub create_issue 连续返回 MCP transport 错误，未发布的草稿仍可在本地复核；发布前应查询同标题，避免请求超时后重复创建。
