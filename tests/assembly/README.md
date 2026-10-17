# tests/assembly — 装配契约测试台

票 01 的验收面：玄枢 = 一个 DSH profile + 两个插件包（零 DSH 源码改动），所以只断言**装配后对外
可观察的东西**（契约 `.scratch/assembly-foundation/notes/lead-contract.md` 第 5 节）。不 import
玄枢内部模块、不依赖 LLM、不联网、不开端口。

| 文件 | 作用 |
|---|---|
| `../../scripts/verify-assembly.mjs` | 唯一的断言实现（CLI，退出码 0/1，`--json` 给机器读） |
| `assembly-contract.test.mjs` | 跑一次上面的 CLI（`--json`），把 S1~S5 逐个包成测试；CLI 与测试永远同源 |
| `parsers.test.mjs` | 测试台自己的单测：dump YAML 解析、bundle 补丁提取、产物物化、基线生成（不需要装 profile） |
| `build-pipeline.test.mjs` | 构建管线自证：`build-client.mjs --check`（产物与 `src/**` 同步）+ 漂移负例（不需要装 profile） |
| `lib/boot-inprocess.mjs` | S2 的执行体：进程内跑官方 `loadProfile`/`boot`，单独进程以免脏了测试进程 |
| `baseline/patch-rows.json` | 漂移基线，由 `--write-baseline` 从**真实安装**的 DSH 包提取生成，不要手改 |
| `fixtures/` | 真实产物的摘录（dump 摘录、真实 bundle 补丁），给解析器单测用 |

## 跑

```bash
pnpm test:assembly                     # = vitest run tests/assembly
pnpm verify:assembly                   # 直接跑测试台（人读输出）
node scripts/verify-assembly.mjs --json --only s1,s4   # 只跑部分 seam（开发用）
```

默认 `DSH_HOME=<repo>/.dsh-home`（已 gitignore）。profile 没装时先：

```bash
node scripts/install-profile.mjs --home .dsh-home
```

## 环境门（不许假绿）

- profile 已装 → S1~S5 真跑真断言；
- 未装 → **显式 skip 并打印原因与修复命令**；设 `XUANSHU_REQUIRE_ASSEMBLY=1` 则变成硬失败
  （交付/CI 用这个，免得「没装 = 全绿」）；
- `XUANSHU_DSH_HOME` / `XUANSHU_PROFILE` 可换 home 与 profile 名（例如拿 `.scratch/pine-home`
  的 `pine-probe` 当「装配坏了」的对照组：S1/S2/S3/S5 必须红）。

## 基线怎么更新

```bash
node scripts/verify-assembly.mjs --write-baseline   # 从已安装的 profile 重生成 baseline/patch-rows.json
```

打印新增/移除/改名换层的行，人工确认后提交。失败的漂移检查会点名具体行 id（critical 行优先），
例如 `- [critical] tools: name-changed；期望 …，实际 …`。

## 本票**未**覆盖的 seam（诚实边界）

Spec 001 的 Testing Decisions #1 把主 seam 写成一个**装配契约**，它列的断言里有几项本票做不了，
因为被断言的东西还不存在（依赖后续票）。本票实际只做「装配契约的四条 + 一次启动自证」：

| Spec 001 #1 里的断言 | 本票状态 | 依赖 |
|---|---|---|
| 补丁行 id 未漂移 | ✅ S1 + S4（基线 96 行逐条命中） | — |
| 两个自有插件包在运行时树里且 `fiber.state === 2`、`packageOf` 解析正确 | ✅ S2 | — |
| 数据目录初始化正确 | ✅ S5（`assembly-report.json` 新写出且 `ok === true`） | — |
| 工具表含 `mcp__horosa__*` | ❌ 未覆盖：horosa MCP 行还没接 | 票 06 · horosa 集成 + 八字出盘 |
| `ctx.sessions.create` 可带玄枢 meta | ❌ 未覆盖：还没有会创建会话的功能路径 | 票 10 · 问事闭环 |
| `ctx.schedule` 含日课/底稿任务 | ❌ 未覆盖：定时任务还没注册 | 票 13 · 底稿 + 日课 |

**S2 与 S5 的分工**（免得把「进程内挂载」误读成「真启动」）：S2 用**官方 overlay 机制**
（`readProfilePatches(..., context.overlays)`，等价于 CLI 的 `--patch`）把 headless app 的
启动行（`headless-startup` / `headless-runner`）关掉 —— 树照挂、我们两行照激活，但**不跑 run、
不调 LLM、不开端口**。真正走一遍 CLI 启动路径（`prepareProfile` → 挂树 → exit 0）的是 **S5**，
它跑 `dsh --profile xuanshu --help` 并断言 `assembly-report.json` 本次新写出、`ok === true`。
