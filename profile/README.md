# `xuanshu` profile（玄枢分发包骨架）

这个目录就是玄枢的 **DSH profile 分发包**（ADR-0001：不 fork DSH，只装配）。DSH 从
`$DSH_HOME/profiles/<name>` 启动一个 profile，所以「安装玄枢」= 让这个目录出现在
`$DSH_HOME/profiles/xuanshu`，再 `pnpm install`。

## 三件套

| 文件 | 作用 |
|---|---|
| `package.json` | `dsh.profile.bundles` = 本 profile 的 bundle 层清单（补丁栈自下而上）；`dependencies` 钉死每个包的版本 |
| `cordis.patch.yml` | **profile 自己的补丁层**，叠在所有 bundle 层之上。只放「本 profile 相对上游默认的差异」 |
| `pnpm-lock.yaml` | 锁文件：同一份 lockfile 装出同一棵树（ADR-0004 钉版策略的落点） |
| `pnpm-workspace.yaml` | `nodeLinker: hoisted` + `allowBuilds`（缺了后者 `pnpm install` 会以 `ERR_PNPM_IGNORED_BUILDS` 退出 1） |
| `cordis.yml` | DSH 每次启动会重写的空 root 配置，不要手改 |

## bundle 层清单（票 01 的范围）

```
@deepseek-ai/dsh-base        # DSH 宿主骨架：会话、工具、LLM、凭据、设置
@deepseek-ai/dsh-headless    # 一次性 CLI 宿主（本票的启动与验收目标，不开端口、不联网）
xuanshu-host                 # 玄枢主机插件（数据目录 + 装配报告）
xuanshu-client               # 玄枢客户端插件（自带预编译 bundle；宿主半边为空壳行）
```

`@deepseek-ai/dsh-web-app`（Web 宿主 + 浏览器 roster）**本票不接**：首页替换属票 07 · 首页替换，
且接上它会让 headless 启动也去开 HTTP 服务，与票 04 · 开发期双实例隔离正面冲突。
接入时只需往 `dsh.profile.bundles` 追加一项。

## 两个自有插件的行从哪来

不写在 `cordis.patch.yml` 里。两个包各自用 `dsh.bundle.patch` 声明自己的 bundle 补丁
（`packages/xuanshu-*/cordis.patch.yml`），bundle 层按上面的顺序展开时把行插进树。
**同一个 id 不要在 profile 层再声明一次**——重复 id 会让 Loader 启动失败
（本机 desktop profile 在 dsh-im 上踩过这个坑）。

### 新增一个自有插件包时要动哪几处

装配是「按名字串起来的」，插件包名同时出现在几个地方；漏一处不会报「配置错」，只会表现为
某一行不在树里或报告 `ok=false`。**五处**（这是 review 点出的 Shotgun Surgery 隐患的缓解清单）：

| # | 位置 | 要加什么 |
|---|---|---|
| 1 | `profile/package.json` | `dependencies` 里加该包，且把它加进 `dsh.profile.bundles`（**两处都要**） |
| 2 | 新包自己 | `cordis.patch.yml`：`insert` 一行 `{ id, name }` 均为包名 |
| 3 | `scripts/verify-assembly.mjs` | `OWN_ROW_IDS` 加该行 id（S1/S2/S3/S5 的断言集） |
| 4 | `tests/assembly/lib/boot-inprocess.mjs` | `pluginPackages.packageOf('<包名>')` 的包名列表 |
| 5 | `packages/xuanshu-host/lib/index.js` | `PEER_PACKAGE` 若不是对端包，报告里的插件键会缺 |

改完跑 `pnpm test`（`XUANSHU_REQUIRE_ASSEMBLY=1`）+ `node scripts/verify-assembly.mjs`：
两个自有包都必须出现在 S1 的行里、S2 的 `fiber.state === 2`、S5 报告的 `plugins` 与 `patchRowIds` 里。

## horosa MCP 行从哪来（版本库里的静态行）

`cordis.patch.yml` 里的 `mcp-horosa` 行（`id: mcp-horosa`、`serverName: horosa`、
`transport: streamable-http`、`url: http://127.0.0.1:8765/mcp`）是**写在版本库里的静态行**，
挂法跟 desktop profile 的 `mcp-filesystem` 行同款。它出现在 `dsh --profile xuanshu --dump-config`
的 `# == <profile>/cordis.patch.yml` 那段（即 profile 补丁层），不是运行期插进去的行。
缺的 `@deepseek-ai/dsh-mcp-client` 由**安装闭包**提供（它是 `@deepseek-ai/dsh` 的 dependencies 之一，
而 `@deepseek-ai/dsh` 是本 profile 的直依赖），所以 `package.json` 里不用加依赖。

**为什么市场的删除 UI 碰不到它**：市场那套（`dsh-mcp-connector` / `dshmarket`）管的是运行期的
「连接记录」——用户点连接时把记录写进 `$DSH_HOME/storages/mcp_connector.json`，删除 UI 删的也是那份记录。
玄枢**从不写**那个文件，`dsh.profile.bundles` 里也没有市场类插件，所以那里根本没有一条叫 `horosa`
的连接可供删除。「默认自带、不可删除」是靠**行的来源**保证的：版本库是唯一来源，装了 profile 就带上它。

**非回环不暴露**：这一行的 URL 钉死在回环上，宿主侧接缝库（`packages/xuanshu-host/lib/horosa/**`）
对非回环 host 一律拒绝启动 serve（`code: 'non-loopback-host'`），spawn 出来的
`horosa-skill serve --host` 也恒为 `127.0.0.1`。端口/路径这两个定值只出现三处
（本行 = `scripts/isolation/defaults.mjs` = `packages/xuanshu-host/lib/horosa/constants.mjs`），
一致性由测试钉住。排障与运行手册见 `docs/runbook/horosa.md`。

## 安装

```bash
# 仓库根
node scripts/install-profile.mjs                 # link 模式（开发/测试）：联接 + pnpm install
node scripts/install-profile.mjs --copy          # copy 模式（真分发）：复制 + 依赖改写为 link:<绝对路径>
node scripts/install-profile.mjs --home <dir>    # 装到隔离的 DSH_HOME（测试用）
```

安装完验证：

```bash
$env:DSH_HOME = "$HOME\.dsh"
dsh --profile xuanshu --dump-config     # 打印装配后的补丁栈（含每一层是谁贡献的）
dsh --profile xuanshu headless "..."    # 真启动（该命令需要 LLM；装配契约测试走不调 LLM 的路径）
```

## 数据目录

运行期数据一律落 `$DSH_HOME/xuanshu/`（默认 `~/.dsh/xuanshu/`），全部是本地文件、可整体拷走：

```
$DSH_HOME/xuanshu/
  assembly-report.json     # 装配报告（xuanshu/assembly-report@1）—— 空壳期的运行时自证
```

后续票会在这里长出 `pu/`（谱）、`digao.md`（底稿）、`cang/registry.jsonl`（藏库）等。
