# tests/isolation — 隔离验收测试台（票 04）

玄枢（XuanShu）与 desktop（Electron，占 `127.0.0.1:19387`）必须能**同时跑**而不互相污染：
会话 / storages / 凭据 / 机器级补丁全隔离，端口不互抢，horosa `8765` 有单占用守卫。

本目录是票 04 的**验收面**：断言的是「隔离行为」，不是实现细节。契约出处
`.scratch/assembly-foundation/notes/isolation-contract.md` §4.6（CLI 与 check id 定值）、§5（I1~I7）、
§5.1（评审裁决 R1~R18，本目录直接相关的几条在下面单列）。

| 文件 | 作用 |
|---|---|
| [`../../scripts/verify-isolation.mjs`](../../scripts/verify-isolation.mjs) | **唯一断言实现**（CLI，`--json` 给机器读，退出码 0/1） |
| `resolve.test.mjs` | I1/I2 + 环境门 `profile-installed` + **端口解析回归（数字形态）** + 启动器 CLI 前提（R2/R3/R12/R17）+ **web 真起冒烟** + 拒绝路径负例 |
| `port-guard.test.mjs` | I3/I4：真起对照组服务端验 web 端口门与 horosa 守卫四态（含 R5 的 probe-failed） |
| `dual-instance.test.mjs` | I5/I6/I7：两个隔离 home 各真跑一次 `headless`，**哨兵法**（R15）+ 指纹 + 清单 |
| `lib/verifier.mjs` | 公共夹具：环境门（唯一一份）、`spawnSync` 跑验收台、空闲端口 |
| `lib/fixture-server.mjs` | I4 对照组：**独立进程**的假服务端（为什么必须独立，见文件头） |
| `lib/web-boot.mjs` | 票 07 新增：**独立进程**真起 `dsh web` 探针（token 握手 → HTML 里的 `__DSH_BOOT__`）；为什么必须独立进程，见文件头 |
| `.tmp/` | 运行期临时 home（已 gitignore；绿的自动清理，红的留现场） |

## 跑

```bash
pnpm test:isolation                  # = vitest run tests/isolation
pnpm verify:isolation                # 直接跑验收台（人读输出）
node scripts/verify-isolation.mjs --json        # 机器读：{ ok, exitCode, checks, report, env }
node scripts/verify-isolation.mjs --json --only home-isolated,cli-version   # 只跑部分 check（开发用）
node scripts/verify-isolation.mjs --json --horosa-port 8765 --web-port 19388
```

默认隔离 home 是 `<repo>/.dsh-home`（已 gitignore；`profiles/xuanshu` 是指向 `<repo>/profile` 的
junction，所以「代码共享、状态各归各的」）。可用 `--home` / `XUANSHU_DSH_HOME` 覆盖。

`--web-port` 只收 `1..65535`（它是要拿去 bind 的）；`--horosa-port` **只要求是数字** ——
越界值（`defaults.INVALID_PROBE_PORT`）交给守卫判 `probe-failed`（§5.1 R6/R14），非数字才是用法错。
这两个标志只给测试喂对照组端口用，是契约 §4.6 CLI 的**超集**（已在 `--help` 里列出）。

**同源**：三个测试文件都只 spawn 验收台（`--json`）再断言它给出的 checks —— 四态判据、退出码映射、
路径包含关系全部只实现一次，所以「验收台绿 ⇒ 测试绿」。测试负责造现场（对照组服务端、空闲端口、
临时 home），验收台负责下判断。唯一例外是 `resolve.test.mjs` 的「启动器 CLI 前提」那一块：R17 要断言的
就是**启动器进程自己的退出码与 stdout 形状**，验收台是包在它外面的机器，量不到这两样，所以直接跑它。

## 环境门（不许假绿）

- profile 已装 → 需要 profile 的 6 个 check 真跑真断言；
- 未装 → 这 6 个 check 在 `--json` 里是 `skipped: true`（**不是** ok），测试文件整组 `describe.skip`
  并把原因与修复命令打到 stderr；验收台自身退出码 1；
- 设 `XUANSHU_REQUIRE_ASSEMBLY=1` → 「跳过」升级为硬失败（验收台报 `HARD FAIL`，测试直接 FAIL）。
  交付/CI 用这个。

```bash
node scripts/install-profile.mjs --home .dsh-home      # 没装时先装
XUANSHU_REQUIRE_ASSEMBLY=1 pnpm test:isolation          # 交付前验收
```

## I1~I7 ↔ check id ↔ 文件对照

| # | 断言 | check id | 主要在哪验 |
|---|---|---|---|
| I1 | 7 条派生路径全在 `$DSH_HOME` 下；换 home 后两两不同 | `home-isolated` | 验收台（`runStartup` + `resolveInstance` 纯函数对照）· `resolve.test.mjs` |
| I2 | CLI 来自 profile 树、版本 = `dsh-base` 版本；`--cli-bin` 优先 | `cli-version` | 验收台（`runStartup` 两次：默认 + 显式）· `resolve.test.mjs` |
| I3 | web 端口被占 → 启动器退出码 3 + detail 点名端口；空闲 → 通过 | `web-port` | 验收台 · `port-guard.test.mjs` |
| I4 | horosa 守卫四态判对（`free`/`horosa-ready`/`occupied-foreign`/`probe-failed`） | `horosa-guard` | 验收台 · `port-guard.test.mjs`（对照组服务端） |
| I5 | 双实例同跑无串扰：各自写自己的 `sessions`/`storages`/报告，清单不相交 | `dual-instance` + `no-crosstalk` | 验收台（两次真 `headless`）· `dual-instance.test.mjs` |
| I6 | 真 home 零写入：跑完 `~/.dsh` 顶层 + `sessions`/`storages` 指纹无新增无删除 | `no-real-home-write` | 验收台（只读指纹）· `dual-instance.test.mjs` |
| I7 | desktop 19387 没被碰：xuanshu 端口 ≠ 19387，计划命令里也不出现 | `no-crosstalk` | 验收台 · `port-guard.test.mjs`（撞 19387 → exit 3） |

另外 `profile-installed` 是环境门本体（profile 装没装 + 装在自己的隔离 home 下）。

## 哨兵法（R15）：I5 的行为证据

路径断言只证明「算出来的路径不一样」；串扰是**行为**，所以 `dual-instance` 会在 home A 里种四个哨兵，
跑完 home B 后断言两件事：

| 哨兵位置 | 为什么是它 |
|---|---|
| `sessions/<sentinel>` | 会话存储根 |
| `storages/<sentinel>` | storages 根 |
| `.credentials.yaml` | 凭据：**路径本身就是隔离对象** |
| `cordis.patch.yml` | 机器级补丁：同上。内容必须是「标记注释 + `[]`」——空文件/纯注释会让 boot `fatal`（`patches … must be a top-level YAML array of loader patch entries`），`[]` 是空补丁数组，对 DSH 无副作用 |

断言：① B 的 home 里**一个哨兵都找不到**（按文件名 + 按内容两路搜）；② A 的四个哨兵原样还在（mtime/size 未变）；
③ 哨兵必须真的出现在「B 跑之前」A 的清单里 —— 少了这一条，「找不到」可能只是「没种上」（空转）。

**这条断言的边界（别过度解读）**：它证明的是**存储根真的分开** —— B 的进程按自己的 `$DSH_HOME` 解析后
不会读到/写到 A 的 sessions、storages、凭据、机器级补丁。它**不**证明「两个会话互不可见」：
一次 `dsh --help` 不建会话，会话级的可见性要等票 10 有真会话路径才谈得上。

## 几条容易搞错的语义（§5.1 裁决）

- **R14**：`horosaGuard` 门在 `probe-failed` 时 `ok:false`（没验成不许显示成绿灯），但**启动器退出码仍是 0**
  —— 只有 `occupied-foreign`（真的拿到 HTTP 响应、形态不像 MCP）才是隔离失败（exit 3）。门 ok 与退出码**解耦**。
  验收台同时钉这两半：`checks['horosa-guard'].evidence.gateOk === false` 且 `...startupExitCode === 0`。
- **R5**：「有人 LISTEN 但 HTTP 在预算内零响应」（裸 TCP / 慢应答的 horosa）判 `probe-failed`，
  不再判 `occupied-foreign` —— 那格的真值是「无法判定」，判成「确定被占」会制造假红。
- **R2/R17（票 07 已翻转）**：票 04 里 `@deepseek-ai/dsh-web-app` 不在 `dsh.profile.bundles`，`--mode web`
  在 spawn 前拒绝（exit 2、profile 门 detail 点名 bundle、报告无 `spawn`）。票 07 接上 bundle 后真值翻了：
  同一个 `--mode web` 必须放行（profile 门 ok、`webBundle.available=true`、报告里**有** `spawn`），并且
  `resolve.test.mjs` 加了一条**真起**的冒烟（`lib/web-boot.mjs`：token 握手 → HTML 含 `__DSH_BOOT__`）。
  翻转的是断言的真值，不是删断言。doctor/env/headless 一直不受它影响。
- **web 命令形态**（票 07 实测）：`dsh web --port <n> --no-open`（`dsh <name>` 捷径把 `web` 展开成
  `--profile web`）才是 CLI 认的形态；`--profile <name> web --port <n>` 会被根解析器当多余位置参数拒掉
  （`error: too many arguments. Expected 0 arguments but got 1: web.`）。所以探针 spawn 的是前一种形态，
  `--mode web` 的 `plan.command` 仍是后一种（启动器侧待随票 07 调整，见其文件头与验收报告）。
- **R12**：没 spawn 就没有 `spawn` 字段（doctor/env 不再塞 `{ attempted: false }`）。
- **R8/R10**：非法端口只从 `defaults.INVALID_PROBE_PORT` 取；CLI `source` 比较只认 `resolve.CLI_SOURCES`
  —— 本目录不再出现这些字面量（`--help` 里的示例除外，那是给人敲的命令行）。
- **端口解析回归**：`resolveInstance({webPort: 7973})`（**数字**，不经 `String()`）必须原样生效。
  R6 重写曾让数字被 `isBlank()` 当成「未设」而静默退回默认端口 —— 在一个端口隔离工具里这是最危险的一类错，
  现在由 `resolve.test.mjs` 的「端口解析回归」块钉住（数字 / 字符串 / 未设三种形态 + `runStartup` 路径）。

## 一处**有意**的例外（写在证据里）

**I1 的第二个 home** 用纯函数 `resolveInstance()` 对照（不落盘、不 spawn）——契约 §5 对 I1
指定的就是这种测法：把同一个 home 的 7 条路径换成另一个 home 再算一遍，必须两两不同。

（I4 的 `probe-failed` 曾经也需要绕开启动器直接调守卫；自 A 把「数字但越界」交给守卫判之后，
它已经能走真链路，验收台恢复成「内部只调 `runStartup()`」。）

## 隔离卫生（这个测试台自己的规矩）

- **绝不写用户真实 `~/.dsh`**：只对它做 `readdir + stat` 指纹（顶层 + `sessions`/`storages` 一层）。
  验收台还带一条负例测试：把 `--home` 指到真实 home 必须被拒（`home-isolated` FAIL + exit 1）。
- **临时 home 一律 `tests/isolation/.tmp/**`**（`.gitignore` 有 `tests/**/.tmp/`）：真目录 +
  指向仓库 profile 的 junction；绿的自动删（先摘 junction 再递归删，确认过 `rmSync` 不跟随联接），
  红的留现场并提示 `--keep-tmp`。
- **对照组一律 `listen(0)`** 拿 OS 分配的空闲端口，测完 `kill()`；绝不占固定端口、绝不起真 horosa、
  绝不联网、绝不调 LLM。
- **`spawnSync` + `encoding: 'utf8'`** 抓子进程输出（PowerShell `>` 重定向会写成 UTF-16LE，
  `JSON.parse` 直接崩）。对照组服务端因此必须跑在**独立进程**里：`spawnSync` 会阻塞测试进程的
  事件循环，长在测试进程里的服务端在探测那一刻不会被调度，会把「有 HTTP 响应」的对照组全部退化成
  `occupied-foreign`，让 `horosa-ready` 两态假绿（踩过一次，细节见 `lib/fixture-server.mjs`）。
- **不跟随 junction**：状态清单遍历跳过符号联接，否则临时 home 里那份共享 profile 会被算成
  「两个实例各自的文件」，「清单不相交」就成了空话。

## 本票**未**覆盖的边界（诚实清单）

| 没测的东西 | 为什么 | 依赖 |
|---|---|---|
| 真起 horosa 服务（8765 上真的答 MCP） | horosa 还没装；本票只做单占用守卫，用假端点验三条判据 | 票 05/06 |
| `--mode web` 的 `plan.command` 真能跑起来 | 票 07 实测那条命令形态（`--profile <name> web …`）会被 CLI 根解析器拒成 `too many arguments`；能跑的是 `dsh web --port <n>`。web 真起由 `lib/web-boot.mjs` 用后者证明；启动器侧命令形态待随票 07 调整 | 票 07（启动器侧） |
| 会话级互不可见（两个会话看不到对方） | 哨兵法只证「存储根分开」；会话可见性要等有真会话路径 | 票 10 |
| 与 desktop **真的同时**长跑互不干扰 | 涉及 GUI 与时间维度；这里用「哨兵 + 状态指纹 + 清单不相交 + 端口不撞」逼近 | 手工 runbook（`docs/runbook/dual-instance.md`） |
