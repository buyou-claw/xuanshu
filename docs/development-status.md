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
| 08 八字冷启动向导 + 底座谱 + 命盘卡点亮 | #11 | 实现完成（宿主半 + 客户端半已并入集成分支） |
| 09 谱管理（创建/查看/编辑/级别） | #12 | 实现完成，总装配接线已收口 |
| 10 问事闭环 | #13 | 实现完成（宿主半 + 客户端半已并入集成分支） |
| 11 多 AI 合参（Best-of-N） | #14 | **实现中** |
| 12 临时挂载（预算裁剪披露） | #15 | **实现中** |
| 13 底稿 + 日课（定时任务） | #16 | 实现完成（宿主半 + 客户端半已并入集成分支） |
| 14 藏库（指针 + 签 + 跳转） | #17 | 实现完成，总装配接线已收口 |
| 15 沉淀闭环（导出汇总 → 确认写谱） | #18 | **实现中** |
| 16 工作流创建向导 | #19 | **实现中** |

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

### 4. 票 08 落地（宿主半 + 客户端半）

两个实现者各在自己的 worktree / 分支上并行，按 `.scratch/notes/t08-contract.md` 冻结的接口面工作，
完成后合并进集成分支（`c1ba8d4` / `4cd5eb7`）。

- **宿主半**：`lib/bazi/{constants,timezone,cities,snapshot,base-pu,cast,service}.mjs` 六个 `bazi.*` 方法；
  城市大库 6792 条 / 664 KB（从上游 `citiesFull.json` 裁剪，生成脚本 + 来源留档）；
  `pu/repository.mjs` 新增底座保留路径 `readBase`/`writeBase`（用户 slug 语义一字未动）；
  `tz-lookup`（**CC0-1.0**）作为运行时依赖。`tests/bazi` 67 条，零网络零真实 horosa。
- **客户端半**：`onboarding.tsx` / `onboarding-steps.tsx` / `MingpanPanel.tsx` / `cities.ts` / `bazi-api.ts` /
  `bazi-controller.ts` 等；概览四卡改**数据驱动**（命盘卡按 `bazi.status` 给四态 + 快照）；
  `tests/assembly/onboarding-*.test.mjs` 67 条。

**Lead 补的两处（跨票/冻结面，属集成分支）**：

1. **真太阳时口径行**：票 06 的接缝只回传分类结果，`basis.trueSolar` 一直缺席。该版本信封**没有**结构化的
   真太阳时字段 —— 看起来像的 `data.bazi.directTime` 的时间部分**随 `timeAlg` 变**（实测 0 档 `12:02:34` /
   1 档 `12:00:00` / 3 档 `12:05:56`），拿它当真太阳时会在 2/3 的口径选择下报出一个**不是**真太阳时的值。
   真太阳时只在口径文本的 `真太阳时：<时间戳>` 行里，且三档恒为同一值。故新增
   `extractTrueSolarTime`（锚定该行，读不出返回 `null`）并串到 `buildBasis`/`buildSnapshot`/`cast`/底座谱。
   **绝不拿经度自己算**（「录入层不换算」是 spec 明文）。反证与三条负路径已进 `tests/horosa/p4`。
2. **`xuanshuHorosa.callTool(name, args, options)`**：票 06 的服务面只有 `baziBirth` 一个业务方法，
   而票 13 的日课要 `horosa_cn_huangli` —— 缺这一口，日课就只能去走「自己起 serve / 直连 8765」
   那条被明令禁止的第二通道。新方法语义与 `baziBirth` 同族（取端点 → `mcpCallTool` → 原样回信封，
   **不替你起 serve**），`ok` = 「调用走到了信封」而非「业务成功」。

### 5. 票 10 / 票 13 落地（各分两半并行）

四张票（含 08）都按「先冻结跨半契约 → 两半各在自己的 worktree/分支实现 → 合并」的方式推进。
契约：`.scratch/notes/t08-contract.md`、`t10-contract.md`、`t13-contract.md`；后四票：`t11-16-contracts.md`。

**票 10（问事闭环）**：宿主 `lib/consult/**` 六个 RPC + 旁挂清单 `xuanshu/consult@1` + 首轮上下文注入 +
`turn/end` 记账；客户端门厅（`consult` main key，侧栏 order 30）+ 历史回看子页。两个落地前逮住的坑：
① 裸 `ctx.agents.create` 的会话**跑不起来**（缺 provider/model，且工具来自 preset 挂载的 scope）；
② `openSession(宿主建的 id)` 会**同步抛** `unknown session` → 唯一打开路径写成 `await ctx.sessions.refresh()` → `openSession(id)`。
两坑的 file:line 证据进了契约与 ADR-0009 体系。

**票 13（底稿 + 日课）**：`lib/digao/**`（纯派生 + 确定性骨架 + 来源标记 + LLM 降级如实标注，**没有** write/update）、
`lib/rikke/**`（`horosa_cn_huangli` → `{yi,ji,liuri}`）、两条 daily（日课 07:30 / 底稿 03:30）。
`ctx.schedule` 的提供者不在 shipped 组合里 → 在本包 `cordis.patch.yml` 插 `time-context`/`schedule`/`ui-schedule` 三行
（id 与 shipped bundle 逐字一致；S4 基线 185 行仍全命中，树 188→191）。**真机 `dsh web` 实测**：
`storages/schedule.json` 里恰好 2 条 daily、再启一次仍是 2 条（幂等）。另一处真机发现：
`apply` 里直接 `ctx.get('schedule')` 是 `undefined`（三行挂在本行之后）→ 改 `ctx.inject(['schedule'], …)`。

### 6. 收掉一处结构债：注册面清单收成单一事实来源

票 07/08/10/13 各加了自己的面板，于是**四张契约测试**各写了一份「穷举注册面快照」，而顺序还取决于
`index.tsx` 的 install 调用次序 —— 两张票并行时必然在同一处冲突（本轮合并就在 4 个文件上冲突）。
现收成 **`tests/assembly/lib/panel-surface.mjs`**：`PANEL_KEYS`（顺序 = install 真实次序）+ 派生的
`expectedRegisterNames()` / `expectedCells()`，四张测试都从它取。**以后新增面板只改这一处。**
构建输出可逐项复核注册顺序（`node scripts/build-client.mjs` 会打印副作用序列）。

## 验证边界

完整装配五条 seam 的当前结果：S2（进程内启动）、S3（客户端产物）、S4（上游行基线）、S5（真实 CLI 报告）通过；
**S1 schema 导出失败**。

失败来自钉版 `@deepseek-ai/dsh-app-boot@0.2.0-rc.2`：它的 schema 导出器只接受 native group/include carrier，
而同版本官方 web bundle 自带的 `@deepseek-ai/dsh-agent-preset` 是另一种 carrier，报
`unrecognized Loader tree carrier`。真实 web 与宿主启动正常。测试保留失败，无上游源码改动、无放宽断言。

当前全仓基线（`node ./node_modules/vitest/vitest.mjs run`）：

```
Test Files  1 failed | 63 passed | 1 skipped (65)
Tests       2 failed | 684 passed | 8 skipped (694)
```

那 2 条失败即上述 S1（`S1 装配树` 与由它连带的 `CLI 退出码为 0`）。**基线之外的红色一律是本轮引入的回归。**
（历史：票 08 后 448 passed；票 10/13 合并后 684 passed。）

**S5 的面依赖（已修）**：票 07 在 profile 补丁层加了三行 `disabled` 开关后，web 面（`XUANSHU_SURFACE` 未设）
由 `web-startup` 拥有 cmdlineArgs，它把 `--help` 当自己的用法打印后**在挂载插件树之前就 exit 0** ——
于是 apply 根本没跑、报告写不出来，S5 判红。同一 profile 同一命令只差这一个环境变量：未设 → FAIL；
headless → PASS（189 行）。这条 seam 要验的是「真 CLI 启动 → 插件 apply → 报告写出」，所以
`checkS5` 的探针**显式取 headless 面**（`runCli` 增 `extraEnv` 形参），web 面的启动本身由
`tests/isolation` 的 web 冒烟覆盖。**这是修探针口径，不是放宽断言。**

**首次冷启动的 serve 会慢到分钟级**（uv 首次要装 46 个包）：那段时间里 `baziBirth` / `callTool`
会拿到 `ECONNREFUSED`（`code:'mcp-call-failed'`）。宿主侧**刻意不在业务方法里自旋等 serve**
（避免与 autostart 抢着起、也避免把服务的生命周期职责漏进业务层）——失败如实回报，由界面给可读理由。
热启动实测 ≈ 22s（票 06 数据），属正常路径。

本机 PATH 中的 `pnpm` shim 指向已不存在的 executable。所有构建 / vitest / tsc 通过现有 Node 直接执行；
需要 pnpm 时照 `scripts/install-profile.mjs` 内部的调用方式走。未修改机器全局配置。

## 工作方式

- 每个实现者在自己的 git worktree（`.scratch/worktrees/<ticket>`）与自己的分支上工作，
  完成前把集成分支 tip 并进自己的分支，再由 Lead 合并回集成分支。
- 跨半/跨票的接口面**先冻结成契约文档**（如 `.scratch/notes/t08-contract.md`）再并行实现，
  避免两条分支在集成时对不上。
- 每完成一个阶段：推分支 + 开票面 PR + 在对应 issue 留证据，做法照票 01–07 的历史形态。
