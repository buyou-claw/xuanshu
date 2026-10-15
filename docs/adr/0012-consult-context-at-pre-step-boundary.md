# 问事上下文改在 `agent/pre-step` 边界交付：一次落日志、按变化补

Spec 001 票 10/12 要的是「底座谱与底稿默认在场、不可关」（用户故事 14）与「发送消息 → 按已确认的裁剪结果注入」（S8 §5 步骤 7）。票 10 原先的实现把这两件事都挂在 **`agent.inject()`** 上 —— 也就是排进 DSH 的**待消费 inbox**：

- `inject()` 只是 `agent/inbox/spliced`（`dsh-agent-loop/lib/index.js:813`），**还不是** `user/message`；
- 正常 `handle.dispose()` 会追加一条 `outcome:"canceled"` 把待消费的消息**撤掉**（`:815` 清 inbox、`:1688` dispose 调 cancel）；
- 会话也可以由**原生 composer** 打开（门厅「继续这次问事」只是导航）：那条路不经过 `consult.send`。

三条叠起来就是复核用实装探针钉住的洞：**空白开会话 → 关应用 / dispose → 恢复后从原生 composer 问第一句**，第一问既没有底座谱也没有底稿，而界面、旁挂清单、日志三处都正常。挂载那一半更直白：重启后先确认挂载、再点「继续」问 —— `setMounts` 那一刻没有活着的 agent，注入无从谈起。

**决定：必需上下文与临时挂载改由 `agent/pre-step` 边界交付（`packages/xuanshu-host/lib/consult/boundary.mjs`）——在每一轮的**第一步**决定「这一步该不该补、补什么」，并且**只补缺的**：材料一次、挂载按变化（逐层）。**

依据（随包实装，非自创）：

1. `agent/pre-step` 是**每一步模型输入成型**的地方：`dsh-agent-loop/lib/index.js:906-918` 先 `inbox.claim()` 再 `dispatch.waterfall("agent/pre-step", …)`，把结果当作这一步的消息；随包先例 `dsh-time-context/lib/index.js:242-246` 用同一个事件把「当前时间」加进每一步。
2. **这些消息会被 loop 落进会话日志**：`:1061` 首次尝试时 `session.append("user/message", message, {surfaceOp:'append'})` —— 这是「模型可见 ⟺ 已落日志」不变量的具体形态。**所以交付的落点是日志**：一次交付即永久在场（重启、dispose、原生 composer 都一样，因为读的是日志），也因此**不该每轮重发**（那会把同一份大文本反复写进 JSONL）。
3. `session.deriveMessages()` 是模型实际看到的历史（`dsh-session/lib/types/index.d.ts:288`：surface 是 derived history 的唯一来源）—— 探针与断言台都用它当判据。

具体定值：

1. **只在第一步**（`step === 1`）判断：后面几步是同一轮的工具循环，`step ≠ 1` 不重复。
2. **这一步必须有用户输入**（`messages.length > 0`）才补：收尾步骤塞进一条消息会打破 loop 的 `turnEnds && nextStep.length === 0` 判据 ⇒ **凭空多出一次模型调用**。
3. **材料（底座谱 / 底稿 / 勾选谱）补一次**：判据 = 会话日志里有没有带段标记（`【来源：底座谱】`）的 `user/message`（`source.kind = 'xuanshu-consult'`）。有 → 不再发；没有 → 这段材料连同当时的挂载全量发一次。
4. **挂载按变化补**：判据 = 旁挂清单的 `mountsInjected`（**逐层**记「内容已经交给模型」的那一份）。
   - `pending` = 当前挂载里不在 `mountsInjected` 的（新增，或上次内容没读出来 ⇒ 下一问重试）；
   - `removed` = `mountsInjected` 里有、当前清单里没有的（撤下 ⇒ 说一句「不再适用」，否则模型继续拿旧正文当现况）；
   - 两者都空 → 这一问什么都不注入。
5. **只有内容真的纳入**（`layer.kept === true`）才记进 `mountsInjected` —— 读不出来的层留在外面，下一问自动重试（评审 R4：不许拿「一层成功」代表「整份成功」）。
6. **永不抛**：装配失败只记日志、原样交出这一步的输入。

**代价与边界（如实登记）**：

- 材料是**会话开始时的那一份**：底稿在会话中途刷新（票 13 的定时任务）不会自动重发 —— 材料里给的是**文件路径**，要看最新版让模型自己去读；要一份新快照就开新会话。
- 每一问的**第一步**都要读一次旁挂清单（一个小 JSON）；有挂载变化时再按预算读一次挂载内容。这是「按变化补」的价格，读取量由既有预算（`mounts/budget.mjs`）封顶。
- `mountsInjected` 是**我们记的账**，而「交付」这件事本身发生在 loop 的 append 里：两者之间有极窄的窗口（我们写账 → loop 落日志）。若进程恰好死在这中间，那一层会被当成「已交付」；再改一次挂载就会重新交付（材料那一半是日志判据，不存在这个问题）。这条窗口写在这里，不假装没有。
- 判官 / 合并槽继续不带材料（H4）；合参候选的历史走**另一条**通道（`history.mjs` 的文本投影 + 窗口裁剪），因为它不进会话上下文。

**Consequences**：

- `consult.create` / `consult.send` / `consult.setMounts` **都不再注入**，只负责受理与记账；`consult.setMounts` 不再需要「那一刻有活 agent」。
- 材料仍然以 `user/message`（`source.kind = 'xuanshu-consult'`）出现在轨迹 / 历史里 —— ADR-0009 第 5 条的消息级标记照旧成立（这一条曾经被误写成「不再出现注入行」，`agent/pre-step` 的 append 行为纠正了它）。
- 判据从「有没有调 inject」变成「**模型看到的历史里有没有它**」：断言台打边界返回值 + 假日志（`tests/consult/boundary.test.mjs`），实装探针跑**真的一轮**（`.scratch/review-a2-boundary-probe.mjs`，打桩 LLM、观察 `deriveMessages()` 与事件流）。
