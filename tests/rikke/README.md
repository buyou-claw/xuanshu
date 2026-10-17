# tests/rikke — 票 13 日课的断言台（宿主半）

零网络、零真实 horosa、零真实定时。被测物是 `packages/xuanshu-host/lib/rikke/**` 的三个 RPC
（`rikke.status` / `rikke.generate` / `rikke.setTime`）与它落下的文件
（`<dataDir>/rikke/<YYYY-MM-DD>.json`，schema `xuanshu/rikke@1`）。

## 黄历信封 fixture 是真机捕获

`fixtures/envelopes/` 里的信封由探针在真机上抓下来再裁剪（`regen.mjs` 可复跑，`PROVENANCE.md` 记来源）。
**别手写一份「看起来像」的信封** —— 票 13 的三条真机事实都是抓下来才知道的：

1. `horosa_cn_huangli` 的技术必填只有 `date`；`hour` 可选但**必须是整数**（传 `'07:30'` 回
   `tool.invalid_payload`，`huangli-invalid-payload.json` 就是那一份真实失败信封）；
2. 宜忌不在结构化字段里，在 `data.snapshot_text` 的 `[今日宜忌]` 段（`宜：…` / `忌：…`）；
3. 流日的日柱只能从 `[起盘信息]` 的 `干支：…年 …月 **壬戌日**` 读出来（玄枢不自算干支）。

## 怎么做到「零真实 horosa」

`rikke.generate` 只允许走 `ctx.get('xuanshuHorosa')` 的 `callTool(name, args)`（票 06 的服务面 + Lead
2026-10-15 的加性裁决）。断言台给的替身（`../digao/lib/sandbox.mjs` 的 `fakeHorosa`）回放真实信封，
所以「信封 → 三键 → 产物文件」这条链路上没有自造形状。

## 断言只打三样外部可观察的东西

方法返回值 / 沙箱里真落了哪些文件 / 发给 horosa 与 schedule 的入参。不测内部函数与私有字段。

## 装配级证据：两条 daily 任务（真机跑过一次，记在这里）

单测能证明「有 `ctx.schedule` 时会把两条任务建对」，但「**装配后树里真的有 schedule 服务**」只能在
真启动里看。2026-10-15 在本机 worktree 上跑过一次（隔离 home，端口 19399）：

```powershell
node scripts/install-profile.mjs --home .dsh-home
$env:DSH_HOME="$PWD\.dsh-home"; $env:NO_COLOR='1'
node .dsh-home\profiles\xuanshu\node_modules\@deepseek-ai\dsh\lib\bin.js --profile xuanshu --port 19399 --no-open
# 然后看 .dsh-home/storages/schedule.json
```

观测结果（第一次启动）：

```json
{ "title": "日课",     "kind": "daily", "time": "07:30:00.000", "timeZone": "Asia/Shanghai",
  "sessionId": "session-xs-rikke-<uuid>", "status": "active" }
{ "title": "底稿刷新", "kind": "daily", "time": "03:30:00.000", "timeZone": "Asia/Shanghai",
  "sessionId": "session-xs-digao-<uuid>", "status": "active" }
```

**再启动一次**（同一条命令）后 `schedule.json` 仍是 **2 条**、`sessions/` 下仍是 **2 个**
`session-xs-*` 目录 —— 幂等（按 `catalog()` 里的任务名找自己那条，不重复建会话、不重复建任务）。

> 注意：`node tests/assembly/lib/boot-inprocess.mjs` **不能**用来验这条 —— 它的 overlay 为了不起端口把
> `webserver`/`connection` 一起关了，`session-controller` 停在 pending，`schedule` 行跟着 pending
> （`ctx.schedule === undefined`）。这不是缺陷，是那个探针的适用范围（它验的是「树挂起来了没有」）。

## 用例分布

| 文件 | 覆盖 |
|---|---|
| `content.test.mjs` | 真机 `snapshot_text` 分段 → `{yi, ji, liuri}`；日柱取自信封（换「甲子日」→ `甲子日 · 水`）；真机失败信封 → 可读失败 |
| `service.test.mjs` | 三方法：未生成/生成后/坏产物；底座未立与 horosa 不可得都是**可读失败**且不落盘；`setTime` 的 compare-and-update；**缺失即省略键** |
| `wiring.test.mjs` | 真 `apply()` + 真 `installRpc`：六个方法在 `/xuanshu` 上、与 pu/藏/八字合并、笔误落「未知玄枢操作」、装配后两条 daily 任务在场 |
| `schedule-bundle.test.mjs` | 契约 §0 判据：`--dump-config` 里有 `time-context` / `schedule` / `ui-schedule` 三行 |
