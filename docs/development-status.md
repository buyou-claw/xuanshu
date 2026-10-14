# Spec 001 开发进度

核对日期：2026-10-15。集成分支：`codex/spec-001-integration`（**已推 origin**）。

GitHub issue/PR 的 open 状态不等于未实现：票 01–06 的代码在本地提交并由 stacked PR 承载（#2/#3/#4/#6/#7/#9 仍 open）；票 07–14 的实现在集成分支上，其中 07 为 issue #10。

## 票 → issue 对照

| 票 | issue | 状态 |
|---|---|---|
| 01 空壳立起 | —（PR #2） | 实现完成 |
| 02 UI 设计稿 | —（PR #3） | 实现完成 |
| 03 UI 素材资产 | —（PR #4） | 实现完成 |
| 04 双实例隔离 | #5（PR #6） | 实现完成 |
| 05 setup 一键安装 | —（PR #7） | 实现完成 |
| 06 horosa 集成 + 八字出盘 | #8（PR #9） | 实现完成 |
| 07 首页替换 = 自我总览四卡 | #10 | 实现完成 |
| 08 八字冷启动向导 + 底座谱 + 命盘卡点亮 | #11 | **实现中**（宿主半 / 客户端半并行） |
| 09 谱管理（创建/查看/编辑/级别） | #12 | 实现完成，总装配接线已收口 |
| 10 问事闭环 | #13 | 待 08 |
| 11 多 AI 合参（Best-of-N） | #14 | 待 10 |
| 12 临时挂载（预算裁剪披露） | #15 | 待 10 |
| 13 底稿 + 日课（定时任务） | #16 | 待 08、09 |
| 14 藏库（指针 + 签 + 跳转） | #17 | 实现完成，总装配接线已收口 |
| 15 沉淀闭环（导出汇总 → 确认写谱） | #18 | 待 09、10 |
| 16 工作流创建向导 | #19 | 待 10 |

## 本轮（2026-10-15）

### 1. 总装配接线（票 09 / 票 14 的收口）

票 09 与票 14 的实现与断言台此前都已落地，但**没有任何地方把它们接进装配树**：
宿主 `apply()` 没调 `installRpc`，客户端 `apply()` 没调 `installPuPanel` / `installCangClient`。
即「谱面板」「藏抽屉」在真实装配里并不存在。现已接上：

- 宿主 `packages/xuanshu-host/lib/index.js`：`apply()` 组合 `installPuSkill` + `installRpc(pu.* / cang.*)`；
  数据目录与装配报告**共用** `resolveDataDir`（避免「报告写 A、数据落 B」的错位）。
- 客户端 `packages/xuanshu-client/src/client/index.tsx`：`apply()` 调 `installPuPanel` + `installCangClient`；
  cordis `inject` 增 `connection`（证据 `dsh-client-connection/lib/client.js:1477` 的 `ctx.provide("connection", handle)`）；
  `dsh.client.inject` 同步增 `@deepseek-ai/dsh-client-connection`。
- `installPuPanel` 补非 DOM 守卫（产物物化与 SSR 断言跑在 Node 里，原写法会抛）；
  `ctx.uiWorkspace` 改软取（服务缺席时按钮不渲染，而不是点了才炸）。
- `tests/assembly/overview-contract.test.mjs` 的「只注册两个 cell」升级为「玄枢全部注册都是加性的」全量断言。

### 2. 修掉票 07 埋下的回归

票 07 在 `profile/cordis.patch.yml` 前面加了 headless/web 三条 `disabled` 顶条目，
`tests/horosa/p2-single-source.test.mjs` 里「insert 行在第 0 个条目」的假设随之失效（5 条断言连带红）。
改为与 P5 同款的 `flatMap(entry.insert)` 全量取行，并补「`mcp-horosa` 只声明一次」的断言。

### 3. 侦察发现两处 spec 级偏差（已裁定并落 ADR）

对钉版 `0.2.0-rc.2` 做了一轮只读考古（笔记：`.scratch/notes/dsh-api-facts.md`，带 file:line 证据），
发现 spec 的两条实现决策在该版本上**做不到**，而且是静默做不到：

| spec 原文 | rc.2 的真实情况 | 处置 |
|---|---|---|
| 问事容器 `ctx.sessions.create`（`meta.xuanshu={kind,pus,mounts}`） | `meta` 是闭集 7 字段且实现**逐字段挑**（`dsh-session/lib/index.js:1699-1709`）→ 额外键**静默丢弃、不报错、读不回**；`SessionResultFilter` 也不支持任何 header 扩展字段过滤 | **ADR-0009**：自铸 sessionId 前缀 `session-xs-<kind>-<uuid>` + 专用 cwd（不是 workspace）+ 旁挂 JSON 清单；消息级标记走 `MessageSourceMap` 合并点。**禁止**新增会话事件 `type`（`append()` 写不了 `ignorable`，会让会话打不开） |
| 合参 judge 槽 `json_schema strict` | `GenerateOptions` 无 `response_format`/`json_schema`，全 282 包 grep 零命中，README 明文只支持 `temperature`/`maxTokens`/`stop` | **ADR-0010**：judge 走「工具调用参数 JSON + 校验」，失败回落完成顺序第一份；`message.candidates` 同样不存在 → `bestOf` 记录落旁挂文件 |

这两条偏差已回改 `docs/specs/001-assembly-foundation.md`（不改 spec 只改代码，下一个照 spec 实现的人会再踩一次）。
另确认：票 13 的 `ctx.schedule` 需要 profile 的 bundles 补 `@deepseek-ai/dsh-experimental-schedule-bundle`
（该 bundle 只有三行 `time-context` / `schedule` / `ui-schedule`；base/web/headless 三份 shipped patch 里全无这三个 id）；
S4 漂移基线只检查**基线里有的行**是否存在，新增 bundle 带来的新行不会被判失败。

## 验证边界

完整装配五条 seam 的当前结果：S2（进程内启动）、S3（客户端产物）、S4（上游行基线）、S5（真实 CLI 报告）通过；
**S1 schema 导出失败**。

失败来自钉版 `@deepseek-ai/dsh-app-boot@0.2.0-rc.2`：它的 schema 导出器只接受 native group/include carrier，
而同版本官方 web bundle 自带的 `@deepseek-ai/dsh-agent-preset` 是另一种 carrier，报
`unrecognized Loader tree carrier`。真实 web 与宿主启动正常。测试保留失败，无上游源码改动、无放宽断言。

当前全仓基线（`node ./node_modules/vitest/vitest.mjs run`）：

```
Test Files  1 failed | 31 passed | 1 skipped (33)
Tests       2 failed | 310 passed | 8 skipped (320)
```

那 2 条失败即上述 S1。**基线之外的红色一律是本轮引入的回归。**

本机 PATH 中的 `pnpm` shim 指向已不存在的 executable。所有构建 / vitest / tsc 通过现有 Node 直接执行；
需要 pnpm 时照 `scripts/install-profile.mjs` 内部的调用方式走。未修改机器全局配置。

## 工作方式

- 每个实现者在自己的 git worktree（`.scratch/worktrees/<ticket>`）与自己的分支上工作，
  完成前把集成分支 tip 并进自己的分支，再由 Lead 合并回集成分支。
- 跨半/跨票的接口面**先冻结成契约文档**（如 `.scratch/notes/t08-contract.md`）再并行实现，
  避免两条分支在集成时对不上。
- 每完成一个阶段：推分支 + 开票面 PR + 在对应 issue 留证据，做法照票 01–07 的历史形态。
