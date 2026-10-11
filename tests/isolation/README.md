# tests/isolation — 隔离验收测试台（票 04）

玄枢（XuanShu）与 desktop（Electron，占 `127.0.0.1:19387`）必须能**同时跑**而不互相污染：
会话 / storages / 凭据 / 机器级补丁全隔离，端口不互抢，horosa `8765` 有单占用守卫。

本目录是票 04 的**验收面**：断言的是「隔离行为」，不是实现细节。契约出处
`.scratch/assembly-foundation/notes/isolation-contract.md` §4.6（CLI 与 check id 定值）、§5（I1~I7）。

| 文件 | 作用 |
|---|---|
| [`../../scripts/verify-isolation.mjs`](../../scripts/verify-isolation.mjs) | **唯一断言实现**（CLI，`--json` 给机器读，退出码 0/1） |
| `resolve.test.mjs` | I1/I2 + 环境门 `profile-installed` + 两条不需要 profile 的拒绝路径负例 |
| `port-guard.test.mjs` | I3/I4：真起对照组服务端验 web 端口门与 horosa 守卫四态 |
| `dual-instance.test.mjs` | I5/I6/I7：两个隔离 home 各真跑一次 `headless`，比指纹与清单 |
| `lib/verifier.mjs` | 公共夹具：环境门（唯一一份）、`spawnSync` 跑验收台、空闲端口 |
| `lib/fixture-server.mjs` | I4 对照组：**独立进程**的假服务端（为什么必须独立，见文件头） |
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

**同源**：三个测试文件都只 spawn 验收台（`--json`）再断言它给出的 checks —— 四态判据、退出码映射、
路径包含关系全部只实现一次，所以「验收台绿 ⇒ 测试绿」。测试负责造现场（对照组服务端、空闲端口、
临时 home），验收台负责下判断。

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

## 两处**有意**的例外（都写在证据里）

1. **I1 的第二个 home** 用纯函数 `resolveInstance()` 对照（不落盘、不 spawn）——契约 §5 对 I1
   指定的就是这种测法：把同一个 home 的 7 条路径换成另一个 home 再算一遍，必须两两不同。
2. **I4 的 `probe-failed`** 只能由「探针自身出错」触发：端口号非法时 `resolve.mjs` 会先拒（用法失败），
   而「连得上的假服务端」按契约一律判 `occupied-foreign`。所以这一态由验收台直接打守卫的**非法端口**
   分支来钉死（判据是 fail-closed：`ok:false` + hint，探针坏了绝不许静默放行一个被占的 8765）。

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
| `dsh web` 真监听 `19388` 并跑起来 | 那需要长驻服务 + 端口占用；本票只断言「门」与计划命令 | 票 05+ |
| 与 desktop **真的同时**长跑互不干扰 | 涉及 GUI 与时间维度；这里用「状态指纹 + 清单不相交 + 端口不撞」逼近 | 手工 runbook（`docs/runbook/dual-instance.md`） |
| 会话/凭据的真实读写路径（`ctx.sessions.create` 等） | 还没有会创建会话的功能路径（`dsh --help` 不建会话） | 票 10 |
