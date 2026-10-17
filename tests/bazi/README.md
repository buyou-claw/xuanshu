# tests/bazi — 票 08 宿主半的断言台

零网络、零真实 horosa、零外部进程。被测物是 `packages/xuanshu-host/lib/bazi/**` 的
**六个 `bazi.*` 方法**（契约 §2 的冻结方法面）与它们落下的文件（契约 §1 的文件契约）。

## 怎么做到「零真实 horosa」

`bazi.cast` 只被允许走 `ctx.get('xuanshuHorosa')` 的 `baziBirth()`（契约 §3）。断言台给的
就是一个**普通对象**替身（`lib/sandbox.mjs` 的 `fakeHorosa`），它：

- 回放票 06 在真机上**已捕获**的信封 `tests/horosa/fixtures/envelopes/**`（不新造 fixture、不手写信封）；
- 分类走**真实现** `classifyBaziEnvelope`（票 06 的单源），返回形状照抄 `createHorosaRuntime().baziBirth()`
  （`pillars` 4 槽数组 + `fourColumns` 对象 + `payload` 回显）。

于是「信封 → 快照 / 底座谱」（票 08 的活儿）这段链路上没有任何自造形状；
「信封怎么来的」（票 06 的活儿）由 `tests/horosa/**` 自己验。

## 断言只打三样外部可观察的东西

1. **方法返回值**（契约 §2 的形状：`bazi.status` 三态、`bazi.cast` 四态、`bazi.cities` 的
   `{items, source}`、`bazi.timezone` 的三项可空）；
2. **沙箱里真落了哪些文件**（`sandbox.files()` 全量比对，不是「某个文件存在」——
   「一个字节都不落盘」这类断言只有全量列表才拦得住）；
3. **发给 horosa 的 payload**（缺省省略 `timeAlg`、注入 `agent_confirmed_settings`、
   `timeAlg` 透传、缺经纬度时**一次都没调**）。

不测内部函数、不测私有字段：`lib/bazi/*` 的内部改结构不该让这里变红。

## 用例分布

| 文件 | 覆盖 |
|---|---|
| `timezone.test.mjs` | 坐标→IANA zone；**历史 DST**（`Asia/Shanghai` 1990-06-01 = +09:00、1985-06-01 = +08:00）；南半球 DST；越界/(0,0)/非数 → 全 null |
| `cities.test.mjs` | 大库缺失/损坏/形状不符 → `{items: [], source: 'none'}`（不报错）；中文/拼音/首字母/英文四路检索；limit 夹取；`City` 形状**不含 tz**；用户覆盖位优先 |
| `cast.test.mjs` | 12 条拒绝路径逐条验「不落盘 + 不调 horosa」；成功路径的快照与底座谱三件；`timeAlg` 缺省省略/透传；闸的 `promptToUser` **信封原文**；error 两态；二次 `status` 不重出盘；坏快照/schema 的 error 态 |
| `wiring.test.mjs` | **真** `installRpc` + **真** `apply()`（宿主 ctx 是替身）：`/xuanshu` 通道上六个方法名逐字可调、与 `pu.*`/`cang.*` 合并、`xuanshuHorosa` 被 provide、数据目录同源 |

## 已知的口径决定（不是缺陷）

- **`basis.trueSolar` 当前总是省略**：契约 §1 要求它只能来自 horosa 信封里的真太阳时字段，
  而票 06 的冻结接缝 `baziBirth()` 只回传分类结果（`techniqueCard` / 四柱 / `timeAlg`），
  **不包含** `data.snapshot_text`（真机里「真太阳时：…」只出现在那段口径文本里）。
  按契约 §1 的兜底省略该键，绝不拿经度自己算一个假值（录入层不换算）。
  要让命盘卡的口径行多出这一行，需要 Lead 裁决是否给票 06 的 `baziBirth()` 增补 additive 字段。
- **信封 `ok:true` 但四柱读不全 → `phase='error'`**：快照 schema 要求四柱齐（没有四柱的盘
  点不亮命盘卡，也不该在底座谱里留半张盘）。这是对契约 §2 四态的一处收紧，已登记在票 08 的交接里。
- **落盘顺序 = 先底座谱、后快照**：快照是命盘卡的开关，先写它再写谱失败会留下「有盘无谱」的半成品
  （S3 §352(e) 明令不点亮）。
