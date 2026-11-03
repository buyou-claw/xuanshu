# 复核清单（code-review 前读）

> 什么时候读：跑 `code-review`（Standards / Spec 两轴）或任何「复核本轮 diff」之前读本页。每条 = **一句可执行的规则** +「这条规则的来历」（它是从哪次事故里长出来的：什么错、怎么被逮到的、修法是什么）。规则正文就在这里，不靠别处的文档；过程报告按 ADR-0016 退出仓库，只剩这层来历。

## 1. AC 写「渲染 / 显示 / 一致」→ 必须在 apply/装配面断言

**规则**：验证要落在**真实入口**（apply 的注入面 / 装配 seam）上；组件层直接传 props 渲染出的绿不算。实现依赖宿主回传值时，再验一次「拿不到时」的降级文案。
**什么算违规**：只有 `renderToStaticMarkup(<Component dataDir="…" />)` 绿，而装配点根本不传这个值——测试替身与实现同错。
**这条规则的来历**：R3（#35）两轮才立住。第一轮把 6 处「`~/.dsh` 旧路径」文案收进**组件层 props**，测试全绿；第二轮 Spec 轴判不通过——判据是「AC1 按实际 home 渲染」，而组件层直传 props 的绿证明不了这件事：装配点根本不传值。修法是把取值挪到 apply 期，读一次宿主回传的 `data.overview` 再注入 5 处路径。**教训是通用的**：测试替身与实现同错时，两边都绿。

## 2. 夹具必须编码正确域字段，不拿邻近字段顶替

**规则**：断言依赖哪个域字段，夹具就用哪个字段编码（名字与语义都要对）；用邻近字段顶替会让旧实现也绿，或红在错字段上、测不到真缺陷。
**什么算违规**：用例声称验「已删除（可恢复）」，夹具却把 `frozenAt`（冻结）当墓碑喂进去。
**这条规则的来历**：R1（#33）事记墓碑/冻结。用例声称验「已删除（可恢复）」，夹具却把 `frozenAt`（冻结）当墓碑喂进去——**旧夹具与旧实现同错，所以旧实现也绿**。审查逮到的不是「实现写错了」而是「断言测错了字段」；修法是先改夹具证明它变红、再改实现。后续同一形状又出现一次（C1 的夹具同时含墓碑与冻结），说明这条不是一次性的疏忽。

## 3. 跨包重复表 / 死导出：有消费者或两侧对拍

**规则**：同一份表/常量在两个包里各写一份时，必须 import 两侧真源直接对拍（改任一侧即红）；确有包边界理由的，登记为**显式例外**。新增导出必须有消费者，零消费者的导出直接删。
**什么算违规**：只钉字面量、不钉两侧同源；新增导出没人 import 还留着。
**这条规则的来历**：R7（#39）一次逮到两个同族问题。J1：契约副本在两包各写一份、只钉字面量不钉两侧同源；J3：`OVERVIEW_HASH` 同样各存一份。修法是两侧 `import` 真源直接对拍（改任一侧即红）+ 握手闭环；F2 顺手删掉两个零消费者导出。**「新增导出必须有消费者」是这条的配套**：没人 import 的导出是下一份没人维护的副本。

## 4. 文档数字只从工具输出抄（已机器化）

**规则**：用例数、文件数、产物字节一律从工具输出抄（`pnpm test:inventory` / `node scripts/build-client.mjs --check` / `pnpm verify:all`），不手算、不手改；当前验证块由 `scripts/check-doc-numbers.mjs` 核对（exit 1 = 漂移、2 = 没验），它已在 `pnpm verify:all` 里。
**什么算违规**：文档写的数字与 `tests/test-inventory.json` / `lib/client.js` 实况不一致，或绕开门手改数字。
**这条规则的来历**：本仓手抄的数字漂过四次（992 vs 1020、1811/164 → 1814/165、559944 → 560502、557338 → 558918）——**纪律挡不住手抄，只有机器判据挡得住**。所以判据从「人写对」改成「机器核对」：门本体的判据、代价与退出码口径写在 `scripts/check-doc-numbers.mjs` 文件头，核对的唯一目标是 `README.md` 的 `## 状态` 段（ADR-0016 第 2 条）。

## 5. 客户端只碰真 API：未声明服务用 `ctx.get`，DOM 事件挂对目标

**规则**：客户端 `ctx` 上**没写进 `inject` 的服务，属性访问会抛**（`cannot get property "x" without inject`），类型断言在运行期不生效 —— 可缺席服务一律 `ctx.get(name)`（统一入口 `src/client/ctx-service.ts::readService`）。事件订阅挂在真 EventTarget 上：`hashchange` 属于 `window`，`location` 没有 `addEventListener`。这类异常发生在 `apply()` 里时，DSH web boot 只显示一行 `xuanshu-client: failed`，**所有面板一起消失**。
**什么算违规**：`(ctx as { x?: T }).x` 这种「靠断言软取」；在 `location` 上 `addEventListener`；只在 `renderToStaticMarkup`/纯函数层验过就认为真机可用。
**这条规则的来历**：2026-10-18 真机 boot 失败——真机打开玄枢只显示 `HARNESS / Failed to load plugins / xuanshu-client: failed`，10 个面板一个都不出现，而测试全绿。四处 `ctx.uiWorkspace` / `workspaces` / `sessions` / `commandUi` 没写进 `inject`，属性代理直接抛；`overview-hash.ts` 的 `location.addEventListener` 同款一抛就整块死。取证只能靠真页面：用系统 Edge + 全局 playwright 收 `console` / `pageerror`（本机解压版 Chromium 起不来），再给 `apply()` 临时加 `try/catch` 打真实栈、定位完立即撤掉。**这就是为什么「只在 `renderToStaticMarkup`/纯函数层验过」不算真机可用**：这个类别的异常在静态层永远看不见。
