# 安装是一条命令：钉版 pin 文件 + SHA256 硬门 + 纯 ASCII runtime 根 + 三项真实自检

玄枢的「装好」不是一次性的开发动作，而是**每个新机器、每次重装、每次上游升级都要重走一遍的路径**。而这条路径上有四个各自独立的失败点：① 工件从哪来（上游 GitHub，本机实测直连 12–24 KB/s，719 MB 的 runtime 要 8–16 小时）；② 拿到的对不对（第三方镜像与断点续传都可能给出半份或换过的内容）；③ 装到哪（Windows 上 runtime 根含非 ASCII 字符会被上游在读清单/下载**之前**就拒掉）；④ 装完到底能不能用（「配置看起来对」和「八字真能出盘」是两件事）。

**决定：安装由一个可执行入口 `scripts/setup.mjs` 承担（一条命令 = 取件 → 校验 → 装 runtime → 装配 profile → 自检），钉版值集中在一个进版本库的 pin 文件里，SHA256 不匹配就一个字节都不装，Windows runtime 根强制纯 ASCII，装完必须跑三条真实自检；镜像只换传输、不换信任。**

具体定值：

1. **钉版只有一个来源**：`scripts/setup/horosa-pin.json`（schema `xuanshu/horosa-pin@1`），版本 **`0.40.1`**、wheel `horosa_skill-0.40.1-py3-none-any.whl`（`1403270` B）、runtime `horosa-runtime-win32-x64-v0.40.1.zip`（`718649254` B），sha256 与大小逐字写死。脚本**不解析** `latest`；pin 里没有当前平台 → 退出码 2 并列出支持的平台。依据是 ADR-0004（不实时跟随上游）。
2. **SHA256 是硬门，不是日志**：下载后必算，且写 sidecar（`<cache>/<name>.sha256`）供后续命中比对；不匹配就删掉 `.part`/目标件、退出码 2、**不装**。缓存命中条件 = 存在 且 大小等于 pin 且 sidecar 等于 pin（不重算大文件哈希，除非 `--recheck`）。
3. **装 runtime 用上游自己的 `install --archive`**（`uvx --from <wheel> horosa-skill install --archive <本地已校验路径> [--force]`）：不自己解压、不自己摆布局，**`--archive` 永远只收本地已校验路径**（不把 URL 转给上游，否则绕开我们的 SHA256 门）。装完跑 `doctor`（纯 JSON）断言 `installed === true && runtime_payload_version === <pin 版本>`（等价字段 `freshness.installed_version`；两者都缺就是「版本取不到」→ 退出码 4），不等就退出码 4 —— 禁止新树混旧 runtime。`manifest_version` / 顶层 `version` **不参与判定**（那是清单的说法，能蒙住旧载荷），只进证据供对账。
4. **纯 ASCII runtime 根**（win32）：`--runtime-root` 必须绝对且 `/^[\x20-\x7E]+$/`，否则**在任何网络/写盘动作之前**退出码 3，提示 `setx HOROSA_RUNTIME_ROOT C:\horosa`（与上游 `runtime.path_not_ascii` 同口径）。
5. **三项自检全是真的**：`assembly`（spawn `verify-assembly.mjs`，真启动装配树，原始 JSON 落 `<dsh-home>/xuanshu/logs/`）、`horosa8765`（起 `serve` → MCP `initialize` **200 且带响应头 `mcp-session-id`** + `tools/list` 非空，两条缺一不可）、`bazi`（`tools/call` 打 `horosa_cn_bazi_birth`，envelope `ok` 且 `version === "0.40.1"` 且四柱可读）。任一条 false → 退出码 5；8765 被**非 horosa** 进程占着则是环境门（退出码 3），不算自检失败；守卫判 `probe-failed`（有人 LISTEN 但预算内没应答）时**不是**「被占」：用加长预算复探一次，仍不成按自检失败（退出码 5）处置，且**绝不**再起第二份 serve。
6. **镜像只换传输**：`--mirror <prefix[,prefix]>` ＞ `$HOROSA_RUNTIME_MIRROR`，语义照抄上游 `runtime/mirrors.py`（prefix 替换 `https://github.com`，原 URL 永远排最后，同一份值可直接交给 horosa 自己的 installer）。**wheel 与 runtime 两类下载都走同一套候选**（上游也是同一个环境变量同时改写清单、归档与 wheel URL），所以 `--dry-run` 打出的候选就是真跑会走的候选。pin 的 URL 仍是权威，报告记实际使用的 URL。
7. **隔离是缺省行为**：不写真实 `~/.dsh`（除非显式 `--install`；判据是「等于**或落在**真实 home 里」，比「等于」严一档，防的是 `~/.dsh/profiles/xuanshu` 这种更危险的目标）、不写真实 `~/.horosa`（数据目录一律 `<dsh-home>/xuanshu/horosa`；环境里带的 `HOROSA_SKILL_DATA_DIR` 指向真实 `~/.horosa` 时忽略并记 note —— 与对 `$DSH_HOME` 的裁决同款），报告落 `<dsh-home>/xuanshu/setup-report.json`（schema `xuanshu/setup-report@1`），大输出（`verify-assembly` / `doctor` / `install` 的 JSON）落 `<dsh-home>/xuanshu/logs/`（报告只给路径）。报告**成败都写**，唯一例外是上面那条「真实 home 被拒」。
8. **退出码分四类**：`1` 用法 / `2` 取件校验 / `3` 环境门 / `4` 安装 / `5` 自检 —— 因为「改命令」「修网络」「修环境」「重装」「查自检」是四种完全不同的处置。

**Considered Options**：

- **在 README 里写一串手工步骤（下载 → 解压 → 摆目录 → 装 profile）**——被否：这些步骤里有 SHA256 校验、断点续传、ASCII 根、同版本硬门四处**必须每次都对**的判断，靠人肉执行意味着每次重装都重新赌一次；而人肉最容易省掉的恰好是「校验」那一步（流程性文档只描述怎么走，不会在流程走错时报错）。
- **直接 `horosa-skill install`（联网拉 latest）**——被否：那正是 ADR-0004 否掉的做法。上游仍在活跃变动，技法数量与工具表在版本间会变（本票的 pin 就是为了让「装了什么」可复现）；而且 latest 会在我们没意识到的情况下换掉 runtime 布局。
- **自己解压 runtime 归档、自己摆目录布局**——被否：那是**重造上游的契约**。上游的 `install` 自己管路径校验、版本戳与清单校验（`runtime.path_not_ascii` 就是它先发现的），我们照着它的输出摆布局，等于把它的格式细节复制一份并长期维护；上游一改布局就轮到我们坏。
- **不校验 SHA256（"反正 pin 里写着 URL"）**——被否：镜像正是风险面 —— 本机直连不可用（12–24 KB/s），实际能用的路径是第三方代理（实测 `gh-proxy.com` 21.9 MB/s）；第三方代理与断点续传都可能给出被换过或半份的内容。此时 SHA256 是**唯一的**信任锚，去掉它等于把「装的是什么」交给代理。
- **只做「配置检查」而当自检（检查文件在不在、端口有没有设）**——被否：这正是要防的假绿。文件在位不代表装配树能启动，端口空着不代表 MCP 能应答，`tools/list` 里有工具不代表八字真能出盘 —— 所以三条自检全部**真跑**（真 spawn、真起 serve、真 call 工具）。
- **镜像默认开（或直接把镜像前缀写死进 pin）**——被否：默认开等于把信任默认交给第三方，且镜像可用性随时会变；写死进 pin 会让 pin 不再是「上游权威值」。做成显式参数 + 环境变量兜底，pin 保留上游 URL。

**Consequences**：

- 装机器少一堆事：跑 `node scripts/setup.mjs`（或 `pnpm setup:xuanshu`）就够；网络不好的机器加 `--mirror https://gh-proxy.com/https://github.com`。完整参数、三条自检的断言与处置、退出码表、升级清单、回滚命令见 `docs/runbook/setup.md`。
- 幂等成为硬要求：重复执行不再下载、不再重装同版本 runtime（`runtime.action = "already-installed"`）、重复装配 profile 不报错，但仍跑自检并写出新报告 —— 因为「装过一次」不代表「现在还能用」。
- **退出码 0 不再等价于「三条自检都过了」**：`--no-selfcheck` 下其余步骤全成也给 0，此时报告 `checks` 是空的（人显式放弃的检查不该判失败）。想在 CI 里区分，看 `checks.length` 而不是退出码 —— 这条星号必须写进文档，否则「0 = 全绿」会被人当成断言用。
- 环境门拒绝真实 `~/.dsh` 时**一个字节都不写，连报告也不落盘**（只在 stdout/stderr 给结论）。代价是那种失败没有机器可读产物，换来的是「绝不碰用户真实数据目录」这条没有例外条款。
- 升级 horosa 变成一次性的、有意识的动作（照 ADR-0004 的清单）：读新 `LESSONS.md` → 换 pin 的 版本/URL/sha256/大小 → `--force` 重装**同版本** runtime → 重跑自检 → 重跑装配契约测试。禁止新树 + 旧 runtime 混跑，这条由自检里的 `version === "0.40.1"` 断言兜底。
- runtime 的字节只落在两处：`<cache>` 与 `<runtime-root>`（Windows 默认 `C:\horosa`）。绝不进版本库、绝不进 `.dsh-home` —— 719 MB 的工件混进装配树会让「拷走数据目录」从几 MB 变成 GB 级。
- 本票**不做**的事：不做包管理式升级（没有 `setup update` 子命令，升级就是改 pin + 重跑）、不做并行多版本 runtime（一次只认一个 pin 版本）、不托管 desktop 的 `~/.dsh`（不经 `--install` 一律拒绝写入）。
- 与票 04 的分工：端口（`8765`）与「被非 horosa 占用」的四态判定复用 `scripts/isolation/**`，本票不新造第二套判定；`8765` 的**生命周期**托管（超时、停谁不停谁）在 `scripts/horosa/serve-lifecycle.mjs`，只停自己起的那份。
