# Spec 001 · F1–F4 修复与独立复核

日期：2026-10-17。分支：`codex/spec-001-integration`。
范围：修复 [4b3c2a3 复核报告](spec001-4b3c2a3-review.md) 的 F1–F4；比较固定点
`4b3c2a37b9bfbd08a559fed21958ebf4e5cead75` 与本次提交前的暂存区。
结论：**四条发现均已关闭；独立 Standards / Spec 各 0 条新发现**。

## 修复

| 发现 | 结果 |
|---|---|
| F1 · P1 | 自有 Vitest reporter 独立采集 suite / hook 与未处理错误；空消息错误也判红。生产 runner 强制校验两份报告的新鲜度、结构和测试文件覆盖，报告缺失或不完整拒绝判绿；合法已知失败与主动跳过不会误报 |
| F2 · P2 | 重挂未确认期间用单份 `previousDelivery` 保留旧正文仍需撤回的事实，读取失败也保留；新正文确认后清快照、撤下确认后清条目 |
| F3 · P2 | 新轮首次落盘成功后才发布内存记录和认领当前轮；首块流返回前，新实例也能按新 `runId` 冷读，旧轮后台写仍受守卫保护 |
| F4 · P2 | 同会话状态操作排队直到采用 / 合并完成投递与记账，新轮继承最终决策；失败释放队列。候选仍后台生成，异会话独立 |

四条原始反例均先复现失败，再补实现；正式回归净增 8 条，清单 `knownRed` 未修改。
票 12、ADR-0010 / ADR-0012、宿主 README 及开发台账已同步约束和代价。

## Standards

独立审查：**0 条发现，无最高级别问题**。

已审完整暂存区修复及仓库成文规则。F1 不再用文件级 `message` 是否非空或终端文本推断错误；
通过已装 Vitest 4.1.11 的 `errors()` / `allSuites()` 实装核对独立错误通道。
独立运行 `inventory-gate.test.mjs`：**26 passed，exit 0**；`git diff --cached --check` 通过。

## Spec

独立审查：**缺失 / 部分实现 0 条，越界 0 条，错误实现 0 条；无最高级别问题**。

F2 保留撤回义务直到日志确认，F3 受理时已持久化，F4 队列覆盖受理、采用 / 合并投递和记账、停止。
独立交错探针确认：合并等待时同会话新轮等待、异会话可完成；新轮继承合并账；
采用参数失败后队列释放；排在新轮后的旧 cancel 被拒且不覆盖新盘；首块前新实例冷读成功。

## 验证与证据

- 四个相关测试文件：**88 passed，exit 0**。
- 宿主副本：`node scripts/install-profile.mjs --home .dsh-home --skip-install` 同步成功。
- F1：`.scratch/review-4b-standards/probe.mjs`，空消息 hook 产生 1 条独立文件级违规。
- F2：`.scratch/review-4b-spec-mount-data-MXJq4N/results.json`，撤下声明已进日志，最终挂载与交付账均为空。
- F3 / F4：`.scratch/fix-f-persist-data-7NRMXP/results.json`，盘上为新轮、冷读无错、采用成功且账中有投递，后轮带 c2、不带旧 c1。
- 独立队列探针：`.scratch/review-f-spec-queue.mjs`，现场 `.scratch/review-f-spec-queue-data-qTs8Fo/results.json`，exit 0。
- `pnpm verify:assembly`：S2 / S3 / S4 / S5 PASS，S1 FAIL，exit 1。S4 的 185 行基线全部命中；客户端产物 386627 B。S1 是既有 rc.2 schema carrier 错误，未改上游或放宽断言。
- `pnpm verify:all`：**exit 0**。类型检查通过，客户端产物同步；完整套件 1135 passed / 10 skipped / 2 known failed。清单门原样输出：

```text
[inventory] 用例 1147 条（基线 1147）/ 文件 104 个 / 失败 2 条（已知红 2 条） / 文件级失败 0 个 / 跳过 10 条 / vitest exit 1
[inventory] 通过：没有用例消失、没有已知红之外的失败、没有文件级失败。
```

两条已知失败仍为 S1 装配树与连带的「CLI 五 seam 全绿」断言；此次未新增豁免。

## 边界

同会话慢采用 / 合并会延后后续状态操作；队列为单个 API 实例内的顺序约束，不提供跨进程锁。
`previousDelivery` 只保留一份平面快照。验证使用真实业务 API、文件 store 和 rc.2 Loop，
LLM / agents 为测试适配；未验真实模型及 UI 端到端、未重跑干净无 profile 全仓矩阵。
此前待补的 S7 多采用稿回看验收仍待补。本结论仅关闭 F1–F4，不代表 Spec 001 全部验收项完成。
