# AGENTS

本文件是玄枢仓库的 agent 工作入口。按任务读取下列文档，具体规则在对应文档中维护。

## 开始任务

1. 检查 `git status`，确认当前分支和已有改动，保留与本任务无关的文件。
2. 动手前读 [开发台账](docs/development-status.md) 的相关章节，确认实现现状、验证边界和操作陷阱。历史结果按记录日期引用，当前结论用本轮证据支持。
3. 探索业务前读 [领域文档配置](docs/agents/domain.md)，使用根目录 `CONTEXT.md` 的术语，并读取触及的 ADR。
4. 按用户指定阶段交付：用户要求“先评估”时产出证据与建议，要求“先记录”时落文档；安装、启动和修复按当前任务授权范围开展。

## 按任务读取

| 触发条件 | 必读文档与用途 |
|---|---|
| 取票、编写 spec、创建或更新 issue | [Issue tracker](docs/agents/issue-tracker.md)：GitHub Issues 的操作与票据约定 |
| 确定领域术语、业务关系或产品边界 | [Domain docs](docs/agents/domain.md)：术语表、产品文档与 ADR 的职责 |
| 评估 UI 美观、按钮跳转、输入输出冗余或实际使用体验；根据评估修复界面 | [实操体验评估计划](docs/design/ui-v1/实操体验评估计划-2026-11-02.md)：范围、任务、证据格式与局部优化边界；执行阶段以当前用户指令为准 |
| 修改界面实现、样式、交互或 UX 判据 | [UI 设计入口](docs/design/ui-v1/README.md)、[判据说明](docs/design/ui-v1/criteria/README.md)：定位相关界面稿，遵守设计权威与判据变更流程 |
| 安装、启动或迁移运行环境 | [Home 手册](docs/runbook/home.md)、[双实例手册](docs/runbook/dual-instance.md)；涉及桌面壳时再读 [Shell 手册](docs/runbook/shell.md) |
| 创建 worktree、分派并行实现或合并工作树成果 | [并行实现](docs/agents/parallel-work.md)：起树入口、依赖链接、基线归属与合并顺序 |
| 清理 worktree、依赖目录或测试临时目录 | 先读 [并行实现 §2](docs/agents/parallel-work.md#2-junction-跟穿禁令)，再使用其中的安全清理流程 |
| 运行 code-review、两轴复核或复核本轮 diff | [复核清单](docs/agents/review-checklist.md)：真实入口、夹具、跨包契约与运行时 API 的检查要求 |
| 修改客户端源码或处理客户端产物冲突 | [并行实现 §3–4](docs/agents/parallel-work.md#3-用例基线与客户端产物归属)：生成物重建、同步提交与冲突处置 |

## 验证与交付

- **代码变更**：从 `package.json` 选择受影响的测试，交付前运行 `pnpm verify:all`。分别报告实际测试与工程检查的结果；`verify:all` 不代表执行了全部测试。
- **文档变更**：检查 diff、链接及与既有规则的一致性。规则只保留一个正文来源，入口通过带触发条件的指针引用。
- **界面结论**：按实操评估计划保留真实操作与截图证据；未完成的路径写明已验证部分、阻塞条件和验证缺口。
- **数字引用**：用例计数抄 `pnpm test:inventory`，装配 seam 抄 `pnpm verify:assembly`；其他统计遵循 [复核清单 §4](docs/agents/review-checklist.md#4-文档数字只从工具输出抄已机器化)。
- **证据前置**：`.scratch/` 中有未入库的测试前置。改动前读 [开发台账](docs/development-status.md) §10，并检查相关测试实际读取的文件；缺件导致的失败或跳过单独记录。
- **完成条件**：任务范围内的改动均有对应验证；未验证项和既有已知红有明确归属。最终说明交付内容、验证结果与剩余限制；涉及提交时核对文件范围，避免带入无关数据。
