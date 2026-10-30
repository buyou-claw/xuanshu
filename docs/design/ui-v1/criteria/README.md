# 判据目录（`docs/design/ui-v1/criteria/`）

> 这是什么：`docs/design/ui-v1` 的**机读投影**。设计权威仍是 `docs/design/ui-v1` 的稿子本身；
> 这里只把稿子里的纪律编译成能被检查器执行的五列判据（ADR-0015 第 1 条）。

## 1. 目录布局

| 路径 | 谁写 | 作用 |
|---|---|---|
| `rules/<族>.json` | 人（判据提案批准后） | 判据的**作者面**：每条一句话、可判真假，带出处锚 |
| `criteria.json` | 投影器（`scripts/ux/project.mjs`） | 判据集**投影产物**：同一输入必须产出同一字节，`version` 是它的 sha256 |
| `freeze.json` | 人（签字那一次） | 冻结值：`version` + 冻结时刻。巡检启动先校验它 |
| `proposals/` | AI / 任何人 | 提案区。**新判据只能先落这里**，由人批准后搬进 `rules/` |

`rules/` 与 `criteria.json` 的差别只有一个方向：**`rules/` 是人写的原文，`criteria.json` 是它的确定性投影**。
不要手改 `criteria.json` —— 它自己算出的 `version` 会立刻对不上，巡检会拒绝运行（`scripts/ux/freeze.mjs`）。

## 2. 五列（缺一列即投影失败）

| 列 | 取值 | 判据 |
|---|---|---|
| `id` | `<族>-<三位数字>` | 族前缀必须与所在文件一致；**稳定且永不复用**。下架用 `tombstone: true` 标记，不删条目 |
| `statement` | 一句话 | 必须能判真假；写「要好看」这种不可判的句子等于没写 |
| `check` | `static` · `browser` · `human-only` | 机器判不了就必须显式写 `human-only`，并在 `humanReason` 写清**为什么机器判不了** |
| `evidence` | `file-line` · `computed-style` · `screenshot` · `transcript` | 报告里每条红要指得回这个位置 |
| `severity` | `blocker` · `major` · `minor` | 决定报告排序，不决定是否通过 |

附加字段：`appliesTo`（`{kind:"all"|"panel"|"parasitic"}` 或 `{kind:"ids",ids:[…]}`）、
`source`（`{file, anchor}`，锚必须真的出现在文件里，否则投影失败）。

## 3. 三条硬门槛

1. **没有检查器就不许是机器判据**：`check` 为 `static` / `browser` 的判据，必须有同 id 的检查器
   （静态采集器的 `probes`，或浏览器采集器的剧本锚）。缺了采集器直接报错，不静默跳过。
2. **`human-only` 必须写理由**：没写 `humanReason` 的投影直接失败——不允许把「没人验」伪装成「人来验」。
3. **判据不许自造规则**：每条判据的 `source.anchor` 必须能在 `docs/design/ui-v1` 里找到。
   要加新规矩，先回改设计稿（本仓纪律：**回改本稿，不就地偏离**）。

## 4. 变更权

- 判据冻结后被改 → 巡检**拒绝运行**并非零退出（不是打个警告继续跑）。
- AI 的写入面只有 `proposals/`。把提案搬进 `rules/` 并重新冻结，是**人的动作**（一次签字，见 ADR-0015 第 7 条）。
- 历史兑现率只在「同一版判据 + 同一批界面面」之间可比；跨版本时报告写「不可比」，不硬算。
