# Runbook · 玄枢的 home（`~/.xuanshu`）与 DSH 桌面版为什么互不影响

> 上位决策：`docs/adr/0014-own-desktop-shell-and-home.md`（玄枢有自己的壳与 home，与 DSH 桌面版零交集）。
> 实现只有一份：`scripts/isolation/resolve.mjs` 的 `resolveHomeWithSource()` / `defaultHome()` /
> `pointsAtRealDshHome()`；宿主侧那一份在 `packages/xuanshu-host/lib/home.mjs`（同一套判据）。
> 本页讲**home 在哪、怎么换、怎么迁、为什么碰不到 `~/.dsh`**；装什么、退出码、自检看
> [setup.md](setup.md)，双实例并跑看 [dual-instance.md](dual-instance.md)。

## 0. 一句话

玄枢的会话、storages、凭据、`xuanshu/` 数据目录、装配报告**全部**在它自己的 home 下：
**产品机 `~/.xuanshu`**，**仓库检出 `/.dsh-home`**（仓库内、已 gitignore）。
`~/.dsh` 是 DSH 桌面版的 home —— 玄枢**从不读写它**，解析结果一旦指向它，就是用法失败（exit 1）。

## 1. home 在哪：三档

| 档 | 谁是 home | 谁在用 | 来源串（报告里会看到） |
|---|---|---|---|
| **产品** | `<你的用户目录>/.xuanshu`（Windows：`C:\Users\<你>\.xuanshu`） | 装好的玄枢：桌面壳（票 #23）、发布入口 | `default (product ~/.xuanshu)` |
| **开发** | `<仓库>/.dsh-home` | 仓库里的开发 / 测试（`pnpm dev:xuanshu`、`pnpm verify:isolation`、`pnpm doctor:xuanshu`） | `default (dev <repo>/.dsh-home)` |
| **覆盖** | 你指定的任意目录 | 换盘、临时验证、干净临时 home 复现 | `--home` / `XUANSHU_DSH_HOME` / `DSH_HOME` |

「产品还是开发」怎么判（`resolveHomeMode()`）：显式给了档就是它；否则**找得到仓库根 = 开发档**
（仓库检出），找不到 = 产品档。两种判错的代价都不对称地安全：判成开发档只会把 home 落在一个仓库内目录，
**永远不会落到 `~/.dsh`**。

### 我现在用的是哪个 home？

```powershell
node scripts/isolation/startup.mjs --mode doctor            # 报告 checks.home 的 detail 里写着「隔离 home <路径>（来源 <来源串>）」
node scripts/isolation/startup.mjs --mode doctor --json     # 机器读：checks.home.evidence = { home, homeSource, realHome, exists }
pnpm verify:isolation                                        # 验收台还会说出**默认** home 是不是真实 home
```

`pnpm verify:isolation` 的 `home-isolated` 那条 check 的 evidence 里有四样东西，一起看最省事：

```jsonc
{
  "home": "...",                 // 这次真正用的 home
  "homeSource": "--home | XUANSHU_DSH_HOME | DSH_HOME | default (dev ...) | default (product ...)",
  "defaultHome": "...",          // 不看任何覆盖时算出来的默认 home
  "defaultHomeIsNotReal": true   // 它也必须不是 ~/.dsh —— 这条是「玄枢 home 永不等于 ~/.dsh」的断言本体
}
```

## 2. 怎么换 home

优先级（解析层唯一一份，`scripts/isolation/resolve.mjs::resolveHomeWithSource`）：

```
--home <dir>  ＞  $XUANSHU_DSH_HOME  ＞  $DSH_HOME（仅当它不指向真实 ~/.dsh）  ＞  默认（产品 / 开发两档）
```

```powershell
# ① 一次性：给这一条命令换个家
node scripts/setup.mjs --dsh-home D:\xuanshu-home
node scripts/isolation/startup.mjs --home D:\xuanshu-home

# ② 长期：设变量（新开的终端都生效）—— 这是壳/快捷方式应该做的事
setx XUANSHU_DSH_HOME "$env:USERPROFILE\.xuanshu"
# 临时（只影响当前终端）：
$env:XUANSHU_DSH_HOME = 'D:\xuanshu-home'
```

**两条变量的分工（这条最容易踩）**：

- `XUANSHU_DSH_HOME` 是**本仓自己的**变量：我们的脚本（setup / install-profile / 启动器 / 验收台）都认它。
- `DSH_HOME` 是 **DSH 本体**认的（`@deepseek-ai/dsh-home-paths` 只认它）。`dsh --profile xuanshu`
  这个子进程**只**看 `DSH_HOME`。
- 所以**要起 DSH 的地方必须把两个都设上**（壳就是 `DSH_HOME=<resolved home>` +
  `XUANSHU_DSH_HOME=<resolved home>` 一起传；`scripts/isolation/startup.mjs` 的 `plan.env` 已经是这么做的）。
  只设前者不设 `DSH_HOME` 的话，`dsh` 会开在 `~/.dsh` 上 —— 正是本节要避免的那件事。
- 环境里**天然带着**的 `DSH_HOME=~/.dsh`（在 DSH 会话里跑脚本时就是这样）会被**忽略并记一条 note**；
  显式打出来的 `--home` / `XUANSHU_DSH_HOME` 指向 `~/.dsh` 则是**硬拒绝**（exit 1）。

## 3. 怎么迁移（换一台机器 / 换一块盘）

home 是**一个目录**，迁移就是整目录复制 —— 但有几样不该跟着走。

```powershell
# ① 先停实例：关掉玄枢窗口（或 Ctrl+C 掉 dev 实例），确认没有 node 进程还开着这个 home
# ② 整目录复制（排除这三样：profile 代码 / 凭据 / 临时区）
robocopy "$env:USERPROFILE\.xuanshu" "D:\xuanshu-home" /E ^
  /XD "$env:USERPROFILE\.xuanshu\profiles" ^
  /XF "$env:USERPROFILE\.xuanshu\.credentials.yaml" ^
  /XD "$env:USERPROFILE\.xuanshu\xuanshu\.tmp"
# ③ 指向新家
setx XUANSHU_DSH_HOME "D:\xuanshu-home"
# ④ 复核：home 来源、真实 home 没被碰、默认 home 也不是 ~/.dsh
node scripts/isolation/startup.mjs --mode doctor --home D:\xuanshu-home
pnpm verify:isolation
```

| home 里的东西 | 迁移时 | 为什么 |
|---|---|---|
| `sessions/` · `storages/` | **复制** | 会话与运行时状态 |
| `xuanshu/`（谱/藏/底稿/日课/沉淀/事记…） | **复制** | 「我的数据」；`xuanshu/.tmp/` 跳过 |
| `.credentials.yaml` · `.anonymous-user-id` | **不复制**（新机器重配 API key） | 凭据属于这台机器；备份/迁移都不该带上它 |
| `profiles/` | **不复制**，在新家重装（`node scripts/setup.mjs --dsh-home D:\xuanshu-home`） | 几百 MB 的依赖树 + 指向仓库的目录联接，跨机器复制必坏 |
| `cordis.patch.yml` | 可复制 | 机器级补丁（空数组 `[]` 是合法形态） |
| `skills/` | 可复制 | 导出的工作流 skill |

迁移后第一次启动会重建 `profiles/`；`~/.dsh` 一个字节都不会动（见 §5 的断言）。

## 4. 我的数据：8 个品类、体积与一键备份（票 30）

「设置 → 我的数据」列出玄枢全部的本地数据，并提供一个把数据复制到你自选目录的「一键备份」。
这一节讲**备份里到底有什么、没有什么，以及怎么恢复**。

### 4.1 八个品类（体积按这里统计）

| 品类 | 位置（相对 home） | 内容 |
|---|---|---|
| 谱 | `xuanshu/pus/**` | 底座与各条谱（manifest / content / summary） |
| 藏 | `xuanshu/cang/registry.jsonl` | 藏的登记表（只存指针，不含被藏的文件本身） |
| 底稿 | `xuanshu/digao.md` + `xuanshu/digao.json` | 纯派生、可重建 |
| 事记 | `xuanshu/shiji.jsonl` | 事记账本（只可删、不可改） |
| 问事与会话 | `sessions/**` | DSH 会话记录（含 `.zstd` 压缩件）；玄枢自铸会话也在这里 |
| 存储 | `storages/**` | 调度 / 工作区 / 会话缓存等运行时状态 |
| skills | `skills/**` | 工作流导出的 `SKILL.md` |
| 其它 | `xuanshu/` 下未被上面覆盖的条目 | 日课、沉淀草稿、合参记录、八字快照、horosa 状态、装配报告… |

`home` 与「数据目录」是两件事：home 是 `<你的用户目录>/.xuanshu`（开发档 `<repo>/.dsh-home`），
数据目录是它下面的 `xuanshu/`。页面把两者分开显示，别把 home 叫成数据目录。

体积统计**不跟随符号链接 / 目录联接**（否则一条链到 home 之外的联接就能把外部目录算成自己的体积），
缺失的分类按 0 计；统计有文件数 / 深度上限，到顶会在页面上写明「至少这么多」。

### 4.2 备份：落哪、里面有什么

- 目标由你在系统目录选择器里挑（复用藏库的选目录能力）；**不能选 home 里面**
  （否则备份会把自己再备份一遍）。
- 备份目录名固定为 `xuanshu-backup-<YYYYMMDD-HHmmss>/`；同一秒里点两次会加 `-2`、`-3`，
  **绝不覆盖**已有备份。
- 内容 = 上面 8 个品类的真实文件（**包含会话记录**）。
- 每个文件复制后重新算一次 sha256，与复制前不一致就整体失败并清掉这次备份目录 ——
  不会留下半份文件。
- 清单 `manifest.json`（`xuanshu/backup@1`）逐项写着相对 home 的 POSIX 路径、`sha256` 与字节数，
  可以拿它逐项对账。

备份在宿主侧是异步的：界面按钮进入 busy 态并显示阶段文案（选目录 / 复制并校验），
期间不阻塞界面；失败会给出可读原因（目标在 home 里 / 未确认 / 目录不可写 / 复制失败）。

### 4.3 不备份什么、为什么

| 不备份 | 原因 |
|---|---|
| `.credentials.yaml`（以及任何密钥引用） | 凭据是本机凭据库。密钥不该离开这台机器，玄枢也不另建密钥库 |
| `xuanshu/logs/**` | 运行日志，排障用，不是用户数据 |
| `**/*.tmp` | 原子写残留，随时会被覆盖 |
| `profiles/**` | profile 代码与 node_modules（几百 MB），重装即可 |
| `cordis.yml` / `cordis.patch.yml` / `.anonymous-user-id` | 运行时配置与机器标识，不属于「我的数据」 |

**密钥怎么迁**：备份里没有 API key。换机器恢复后，在玄枢自己的「设置 → 模型」里重新填一次即可
（DSH 的设置页就是密钥库，玄枢不复制它）。

### 4.4 恢复：放回对应位置，不自动覆盖（逐项）

1. 先关掉玄枢，确认没有实例还在运行，再动文件。
2. 把备份里的 `xuanshu/`、`sessions/`、`storages/`、`skills/` 分别放回 home 的对应位置
   （同名文件覆盖前，先自己留一份）。
3. 在「设置 → 模型」重新填一次 API key。
4. 启动后打开「设置 → 我的数据」，看一次体积，确认分类都回来了。

玄枢**不提供自动恢复**：它不会自己覆盖现有数据，放回哪一份由你决定。

## 5. 为什么与 DSH 桌面版互不影响

| 维度 | DSH 桌面版 | 玄枢 | 断言/证据 |
|---|---|---|---|
| home | `~/.dsh` | `~/.xuanshu`（或仓库 `.dsh-home`） | `home-isolated`：home 与 7 条派生路径都在自己的 home 下；`evidence.defaultHomeIsNotReal` |
| 会话 / storages / 凭据 | `~/.dsh/{sessions,storages,.credentials.yaml}` | `<home>/…` 同一套布局，**不同的 home** | `no-crosstalk`：两份文件清单不相交；`no-real-home-write`：真实 home 指纹（顶层 + `sessions`/`storages`）跑前跑后无新增无删除 |
| 端口 | `19387` | `19388`（horosa MCP 另占 `8765`，有单占用守卫） | `no-crosstalk`：xuanshu 端口 ≠ 19387，计划命令里也不出现 |
| profile | `desktop`（Electron 独占，CLI 硬拒绝管理） | `xuanshu` | CLI 门：profile 与 CLI 版本同源 |
| 运行时写盘 | — | 宿主插件解析到 `~/.dsh` 时**拒绝写**（报告/数据目录/horosa 全不落） | `tests/isolation/home.test.mjs` 的「宿主拒绝」用例；`packages/xuanshu-host/lib/home.mjs` |

为什么这样就能同时跑：两个 home 是两个独立的目录树，**没有任何一条路径交叉**（凭据、会话、storages
各自一份），两个 web 端口不重叠，`8765` 的 horosa 由四态守卫保证只有一个在答。
`pnpm verify:isolation` 就是这套说法的**可执行版**：它自己真跑两个隔离 home 的实例，断言清单不相交、
真实 home 指纹零变化。

## 6. 装好并启动（一条命令 + 启动形态）

```powershell
# 产品档：显式给玄枢自己的 home（干净临时目录同理，最省事的复现方式）
node scripts/setup.mjs --dsh-home "$env:USERPROFILE\.xuanshu" --mirror https://gh-proxy.com/https://github.com

# 启动（注意 DSH_HOME 必须跟着一起给：dsh 本体只认它）
$env:DSH_HOME = "$env:USERPROFILE\.xuanshu"
node "$env:USERPROFILE\.xuanshu\profiles\xuanshu\node_modules\@deepseek-ai\dsh\lib\bin.js" --profile xuanshu --help

# 或者用启动器（它会把两个变量都传给子进程，还会做 home / 端口 / horosa 的门）
node scripts/isolation/startup.mjs --home "$env:USERPROFILE\.xuanshu" --mode doctor
pnpm dev:xuanshu      # 开发档：<repo>/.dsh-home + 19388
```

`dsh --profile xuanshu --help` 的**前提**是 profile 已装在这个 home 下（DSH 不会自动建自定义 profile）；
home 里没有它时 CLS 会直接报 `profile "xuanshu" does not exist`。先跑 setup（或
`node scripts/install-profile.mjs --home <home>`）。

## 7. 回滚 / 清理

装是加法，回滚是删：

```powershell
# 只删一个 profile
Remove-Item -Recurse -Force "$env:USERPROFILE\.xuanshu\profiles\xuanshu"
# 整个玄枢 home（会话 + 数据 + 凭据全在里面，删前自己确认）
Remove-Item -Recurse -Force "$env:USERPROFILE\.xuanshu"
# 仓库里的开发档
Remove-Item -Recurse -Force <repo>\.dsh-home
```

**不要**为了「重来一次」去删 `~/.dsh`：那是 DSH 桌面版的，玄枢从没往里写过（`no-real-home-write`
的指纹断言就是证据）。真要卸载桌面版请用它自己的卸载流程。

`install-profile.mjs` 没有 `--uninstall`：卸 profile 就是删目录。

## 8. 排障对照表（文案照抄实现，直接按它搜）

| 你会看到的文案 | 含义 | 处置 |
|---|---|---|
| `拒绝在用户真实 DSH home 上运行：…`（启动器 / setup，exit 1 / 3） | 解析结果指向 `~/.dsh` | 用 `--home` / `XUANSHU_DSH_HOME` 指到玄枢自己的 home；真要写真实 home 才加 setup 的 `--install` |
| `拒绝把玄枢的数据写进用户真实 DSH home（…）`（宿主 warn，不写报告） | `dsh` 起在没有 `DSH_HOME` 的终端里，`profileContext.home` 就是 `~/.dsh` | 用启动器启动，或先 `$env:DSH_HOME='<玄枢 home>'`；宿主绝不往那里写 |
| note：`DSH_HOME=… 指向用户真实 DSH home，已忽略` | **不是错误**：环境里带的变量被软忽略，已回落到玄枢自己的 home | 什么都不用做；想让它生效就显式 `--home` / `XUANSHU_DSH_HOME` |
| `home-isolated` FAIL：`默认 home 撞上用户真实 DSH home：…` | 默认值被改成了 `~/.dsh`（回归） | 这是实现 bug，报给维护者；别改测试去凑绿 |
| `profile "xuanshu" does not exist` | 这个 home 下没装 profile（DSH 不会自动建） | `node scripts/setup.mjs --dsh-home <home>`，或 `node scripts/install-profile.mjs --home <home>` |
| 界面上「数据目录」与报告路径对不上 | 报告里 `profile.dshHome` 是 **home**，数据目录是它的子目录 `<home>/xuanshu` | 报告新键 `profile.dshHomeSource` 说明这个 home 是哪来的；两者别再混着叫 |
| 「备份目录不能放在玄枢 home 里」 | 你在选目录时选了 home 内的文件夹 | 选 home 之外的目录（备份不是 home 的镜像，放一起会互相递归） |
| 「备份没有完成：…」 | 复制 / 校验失败（权限、磁盘满、文件被占用）；这次备份目录已被清掉 | 按冒号后的原因处置后重试；不会留下半份备份 |
| 「没有选择备份目录（已取消）」 | 系统目录选择器被关掉 / 宿主没有原生选择器 | 重试；宿主没有选择器时页面会给出「请粘贴本地路径」之外的原始原因 |

## 9. 相关

- `docs/adr/0014-own-desktop-shell-and-home.md` —— 为什么要有独立 home（与桌面版零交集）。
- `docs/adr/0006-dev-dual-instance-isolation.md` —— 开发期双实例隔离的原始裁决（R16：环境里的 `DSH_HOME` 软忽略）。
- [setup.md](setup.md) —— 一条命令装好：取件 / 钉版 runtime / 装配 profile / 三项自检 / 退出码。
- [dual-instance.md](dual-instance.md) —— desktop + xuanshu 开发期并跑（端口旋钮、horosa 8765 四态守卫）。
- `tests/isolation/home.test.mjs` —— 本页每条断言的用例（默认值两档、覆盖链、拒绝路径、宿主拒绝、验收台 evidence）。
- `packages/xuanshu-host/lib/data/**` 与 `packages/xuanshu-client/src/client/data{,-api,-style}.tsx` —— §4「我的数据」的实现
  （8 组口径、备份清单、恢复说明）；对应的用例在 `tests/data/**` 与 `tests/assembly/data-panel.test.mjs`。
