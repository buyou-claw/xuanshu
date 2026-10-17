# 信封 fixture 的来源（别手改这些 JSON）

本目录的 `*.json` **不是手写的信封**，而是 Lead 2026-10-13 在本机（win32-x64，`C:\horosa` v0.40.1 已装）
用真机探针抓下来的响应的**裁剪版**。裁剪规则是可复跑的：
`node tests/horosa/fixtures/envelopes/regen.mjs`（写回）/ `... regen.mjs --check`（只比对）。

| fixture | 来源（`.scratch/assembly-foundation/captures/`，不入库） | 抓取日期 | 处理 |
|---|---|---|---|
| `bazi-ok-default.json` | `gt06-envelope-default.json`（`tools/call horosa_cn_bazi_birth`，**不传** `timeAlg` + `agent_confirmed_settings:true`） | 2026-10-13（响应 `generated_at` 2026-10-12T16:23:18Z） | 裁剪：只删字段、不改值 |
| `bazi-ok-clock.json` | `gt06-envelope-clock.json`（同上，`timeAlg:1`） | 同上 | 裁剪 |
| `bazi-ok-meansolar.json` | `gt06-envelope-meansolar.json`（同上，`timeAlg:3`） | 同上 | 裁剪 |
| `bazi-gate.json` | `gt06-gate-raw.json`（不带 `agent_confirmed_settings`/`defaults_accepted`）→ 从 SSE `data:` 行的 `result.content[0].text` 里取出信封 | 同上 | 裁剪 |
| `bazi-ok-default-no-settings-timealg.json` | = `bazi-ok-default.json` | — | **派生**：`delete data.technique_card.settings.timeAlg`（验 §4.2 的回退判据 `input_normalized.timeAlg`） |
| `bazi-error.json` | = `bazi-ok-default.json` | — | **派生（合成）**：真实探针没造过 error 分支，最小的 `ok:false + error.code='invalid_payload'` 改写 |

## 裁剪保留了什么（判据要用的真实字段路径）

- 顶层 14 键逐键保留（含 `error/code/message/details` 四个 `null`）——
  `HOROSA_ENVELOPE_REQUIRED_KEYS` 的子集断言就是在这一层上做的。
- `data.technique_card` **整块**（1.4KB）：`settings.timeAlg.value` 是「`timeAlg` 口径」的**唯一判据**（§0.1 的坑：
  四柱跨不了时支，不能拿来判 `timeAlg`）。
- `data.snapshot_text` **整段**（5.6KB）：三档的口径行原文（`时间算法：真太阳时 / 直接时间 / 平太阳时(仅经度)`），
  人读判据 + 三份 fixture 确实互不相同的证据。
- `data.bazi.fourColumns.{year,month,day,time}` 的 `ganzi/ganZhi/zhu` + `stem.cell`/`branch.cell`。
- `error.details.{ask_if_missing×4, safe_defaults×6, do_not_assume, confirmation_fields,
  agent_recovery.prompt_to_user, hint, next_action}`（gate）。
- `input_normalized` 全量：回退判据的来源，也是「缺省省略 = 0」的证据（真机回显 `timeAlg: 0`）。

裁掉的是大而无当的部分：`data.bazi` 里的神煞/纳音/大运/流年（原文 674KB）、`export_snapshot.export_text`。

## ⚠️ 一处「契约与真机不符」（2026-10-13 从捕获原文核对，已回报 Lead/T1）

契约 §0.1 / §5 P4 写 `data.bazi.fourColumns.{year,month,day,hour}.ganzi`，
但真机上 `fourColumns` 的键是 `year/month/day/**time**/tai/ming/shen/...`（17 个）——
**没有 `hour`**；时柱在 `fourColumns.time`（`zhu:'时'`，`ganzi:'甲午'`），三份信封一致。

fixture 按**真机**保留 `time`（fixture 不许为了迁就实现而改真形状）；
`classifyBaziEnvelope(...).pillars.hour === '甲午'` 仍是对外断言（§4.2 的槽位名）——
`time → hour` 的映射是**实现**必须做的一步。`p0-fixtures.test.mjs` 会同时钉住这两件事。

另：gate 信封的 `data` 与 `input_normalized` 在真机捕获里**都是 `{}`**（Lead 2026-10-13 用原始捕获复核）。
但**闸的判据不看这个**（契约 §4.2）：只看 `ok === false && (error.code ?? code) === 'agent_guidance.required'`，
**不看 `data` 是否为空**。四柱不可读是**后果**（界面据此不点亮命盘卡），不是判据 ——
`data` 的形状将来若变了（上游多回一个空壳），闸的判定也不该跟着变。

> 过程留痕：本目录的 fixture **曾经**把成功信封的骨架套在 gate 信封上，产出过
> `data:{bazi:{fourColumns:{}}}` 这种真机没有的形状（是我裁剪器的 bug，不是捕获的问题）。
> `regen.mjs` 现在对非 ok 的信封**整份原样**返回；`p0-fixtures.test.mjs` 里有逐条对回捕获的用例，
> 再犯会当场红。

## 捕获目录不存在时

`.scratch/` 不入库：在没跑过票 06 探针的机器上本目录只有 fixture 文件、没有捕获文件。
`p0-fixtures.test.mjs` 的「对回捕获」用例会自动跳过（fixture 本身照常参与 P4）。
