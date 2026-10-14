# 黄历信封 fixture 的来源（别手改这些 JSON）

本目录的 `*.json` **不是手写的信封**，是 Lead 记的探针在真机上抓下来的响应的**裁剪版**。裁剪规则可复跑：

```powershell
# 1) 抓（探针不入库，在 .scratch/ 下；会起一次本地 horosa serve，跑完自己收掉）
node .scratch/assembly-foundation/captures/gt13-huangli-probe.mjs
# 2) 裁（本目录的 regen.mjs；--check 只比对）
node tests/rikke/fixtures/envelopes/regen.mjs
node tests/rikke/fixtures/envelopes/regen.mjs --check
```

| fixture | 来源（`.scratch/assembly-foundation/captures/`，不入库） | 抓取日期 | 处理 |
|---|---|---|---|
| `huangli-ok.json` | `gt13-huangli-hour-raw.json`（`tools/call horosa_cn_huangli`，`{date:'2026-10-15', hour:7, agent_confirmed_settings:true}`） | 2026-10-15 | 裁剪：只删 `data.export_snapshot`，不改值 |
| `huangli-invalid-payload.json` | `gt13-huangli-bad-hour-raw.json`（同上但 `hour:'07:30'` 传成字符串） | 2026-10-15 | 同上（**真实失败信封**，不是合成的） |

## 真机事实（本票要照它写实现，别猜）

1. **`hour` 必须是整数**：`technical_required_fields = ["date"]`，`accepted_fields = [agent_confirmed_settings,
   clarification_notes, date, defaults_accepted, hour]`；传 `'07:30'` 会被上游判
   `tool.invalid_payload`，`error.details.validation_errors = [{loc:['hour'], msg:'Input should be a valid
   integer…'}]`（`huangli-invalid-payload.json` 就是这一份）。所以玄枢传的是**本机小时数**（0–23 的整数）。
2. **宜忌在 `data.snapshot_text` 里**（按 `[段名]` 分段），不在结构化字段里：
   - `[起盘信息]` → `公历/农历/干支/生肖`（流日 = `干支：丙午年 戊戌月 **壬戌日**` 的第三段）；
   - `[今日宜忌]` → `宜：…` / `忌：…`（顿号分隔，正是票 07 日课卡的三行内容）；
   - 其余段（值神值宿 / 彭祖百忌 / 吉神凶煞 / 冲煞·胎神·方位 / 时辰吉凶 / 物候·六曜·数九三伏 /
     流年年神方位 / 方法说明）本票只做只读展示的素材，不做解析。
3. **`technique_card.settings` 对黄历是空的**（与 `bazi_birth` 不同）：`huangli` 的口径行不在这里，
   所以 `rikke` 的 `huangli: { ok, version, tool }` 取的是**信封顶层**的 `version` / `tool`。
4. **`hour` 不改变当日渲染文本**（同一日期传 `hour:7` 与不传，`snapshot_text` 逐字相同，已实测）——
   传它是为了与契约 §2 的 `{date,hour}` 对齐，不是因为结果随它变。

## 为什么 fixture 放在 `tests/rikke/` 而不是 `tests/horosa/fixtures/`

票 13 的写作用域是 `tests/digao/` + `tests/rikke/`（`tests/horosa/fixtures/**` 属票 06 的断言台）。
黄历信封是**票 13 才引入的技法**，所以它的 fixture、生成器与来源说明跟消费方放在一起；
若 Lead 希望信封 fixture 集中到 `tests/horosa/fixtures/envelopes/`，把本目录整体挪过去即可
（`regen.mjs` 的 `CASES` 与测试里的 `ENVELOPES_DIR` 是唯一两处引用）。
