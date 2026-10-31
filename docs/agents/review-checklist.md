# 复核清单（code-review 前读）

> 什么时候读：跑 `code-review`（Standards / Spec 两轴）或任何「复核本轮 diff」之前读本页。每条 = 一句规则 + 一个本轮真实实例指针；正文在报告/台账里，不复制。

## 1. AC 写「渲染 / 显示 / 一致」→ 必须在 apply/装配面断言

**规则**：验证要落在**真实入口**（apply 的注入面 / 装配 seam）上；组件层直接传 props 渲染出的绿不算。实现依赖宿主回传值时，再验一次「拿不到时」的降级文案。
**什么算违规**：只有 `renderToStaticMarkup(<Component dataDir="…" />)` 绿，而装配点根本不传这个值——测试替身与实现同错。
**本轮实例**：R3（#35）两轮。第一轮把 6 处文案收到**组件层 props**；第二轮 Spec 轴判「AC1 按实际 home 渲染只有组件层绿，装配点不传值」不通过，F1 才在 apply 期读一次 `data.overview` 注入。见 `docs/development-status.md` §16.6「修复后的第二轮 code-review」与「这一轮的教训」第 1 条（`docs/reviews/spec002-ae78c53-standards.md` §「判断项」J2 是旧路径文案，不是这条的出处）。

## 2. 夹具必须编码正确域字段，不拿邻近字段顶替

**规则**：断言依赖哪个域字段，夹具就用哪个字段编码（名字与语义都要对）；用邻近字段顶替会让旧实现也绿，或红在错字段上、测不到真缺陷。
**什么算违规**：用例声称验「已删除（可恢复）」，夹具却把 `frozenAt`（冻结）当墓碑喂进去。
**本轮实例**：R1（#33）事记墓碑/冻结。审查发现旧夹具与实现同错（把冻结当墓碑）；修法先改夹具证红、再改实现。见 `docs/reviews/spec002-ae78c53-spec.md` §3 C1、`docs/development-status.md` §16.6「这一轮的教训」第 2 条。

## 3. 跨包重复表 / 死导出：有消费者或两侧对拍

**规则**：同一份表/常量在两个包里各写一份时，必须 import 两侧真源直接对拍（改任一侧即红）；确有包边界理由的，登记为**显式例外**。新增导出必须有消费者，零消费者的导出直接删。
**什么算违规**：只钉字面量、不钉两侧同源；新增导出没人 import 还留着。
**本轮实例**：R7（#39）J1 契约副本 + J3 `OVERVIEW_HASH` 两侧对拍；F2 删两个零消费者导出。见 `docs/reviews/spec002-ae78c53-standards.md` §「判断项」J1 / J3、`docs/development-status.md` §16.6「这一轮的教训」第 3 条。

## 4. 文档数字只从工具输出抄（已机器化）

**规则**：用例数、文件数、产物字节一律从工具输出抄（`pnpm test:inventory` / `node scripts/build-client.mjs --check` / `pnpm verify:all`），不手算、不手改；当前验证块由 `scripts/check-doc-numbers.mjs` 核对（exit 1 = 漂移、2 = 没验），它已在 `pnpm verify:all` 里。
**什么算违规**：文档写的数字与 `tests/test-inventory.json` / `lib/client.js` 实况不一致，或绕开门手改数字。
**本轮实例**：`docs/development-status.md` §15 的基线历史（992 vs 1020）、§「工作方式」的「数字只从工具输出里抄」条、§16.6「同日清理事故与护栏」（1811/164 → 1814/165）两次手抄漂移与成文判据；机器判据本体见 `scripts/check-doc-numbers.mjs` 文件头。

## 5. 客户端只碰真 API：未声明服务用 `ctx.get`，DOM 事件挂对目标

**规则**：客户端 `ctx` 上**没写进 `inject` 的服务，属性访问会抛**（`cannot get property "x" without inject`），类型断言在运行期不生效 —— 可缺席服务一律 `ctx.get(name)`（统一入口 `src/client/ctx-service.ts::readService`）。事件订阅挂在真 EventTarget 上：`hashchange` 属于 `window`，`location` 没有 `addEventListener`。这类异常发生在 `apply()` 里时，DSH web boot 只显示一行 `xuanshu-client: failed`，**所有面板一起消失**。
**什么算违规**：`(ctx as { x?: T }).x` 这种「靠断言软取」；在 `location` 上 `addEventListener`；只在 `renderToStaticMarkup`/纯函数层验过就认为真机可用。
**本轮实例**：§16.9（2026-10-18 真机 boot 失败）：`ctx.uiWorkspace` / `workspaces` / `sessions` / `commandUi` 四处 + `overview-hash.ts` 的 `location.addEventListener`。取证用系统 Edge + 全局 playwright 打开真页面收 `console`（本机解压版 Chromium 起不来）。
