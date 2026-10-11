# 开发期双实例隔离：一个 `$DSH_HOME` 一条实例，`8765` 单占用守卫

玄枢的开发/测试要同时跑两个 DSH 实例：**desktop**（Electron 应用，占 `127.0.0.1:19387`，管着用户真实数据）与 **xuanshu**（被测的玄枢 profile）。上游把下面这些放在**一个** `$DSH_HOME` 根下，而 `$DSH_HOME` 默认就是 `~/.dsh`：

| 共享物 | 解析来源（0.2.0-rc.2 实测） |
|---|---|
| `sessions/` | `dsh-base/cordis.patch.yml:133` → `!!js dshHomePath('sessions')` |
| `storages/` | 同上 `:171` |
| `.credentials.yaml` | `dsh-credentials-local/lib/index.js` → `join(resolveDshHome(config.dshHome), '.credentials.yaml')` |
| `.anonymous-user-id` | `$DSH_HOME/.anonymous-user-id` |
| 机器级补丁 `cordis.patch.yml` | `$DSH_HOME/cordis.patch.yml`（最后一个 overlay 层） |

即：两个实例同跑时，会**共享**会话存储、storage、凭据与机器级补丁——测试实例的一次写入会落进用户真实数据里，而用户的一次改动会污染测试基线。

**决定：开发/测试实例一律用独立 `$DSH_HOME` + 独立 web 端口启动，并由启动器在拉起前做三道门（home/CLI 环境门、web 端口门、horosa `8765` 单占用门）。隔离不靠"记得设环境变量"，而靠一个可复用的启动器 `scripts/isolation/startup.mjs`。**

具体定值：

1. **`$DSH_HOME` 隔离**：开发/测试默认 `<repo>/.dsh-home`（已 gitignore），由 `--home` / `XUANSHU_DSH_HOME` 指定；启动器拒绝把 home 解析到用户真实 `~/.dsh`（**不提供** `--allow-real-home` 逃生舱——这个开关一存在，早晚有人在 CI 里打开它）。玄枢的数据目录 `$DSH_HOME/xuanshu/` 因此天然落在隔离 home 下，仍可整体拷走。
2. **端口隔离**：desktop 占 `19387`；xuanshu 的 web 实例默认 `19388`（`--web-port` / `XUANSHU_WEB_PORT`），被测时也可以用 `--mode headless`（不开端口）。启动前探一次 `127.0.0.1:<web-port>`：有人 LISTEN 就 fail-fast（退出码 3），不做"换个端口偷偷起来"这种静默降级。
3. **horosa `8765` 单占用守卫**：`serve` 默认 `127.0.0.1:8765/mcp`（streamable-http）。启动前探活，四态判定：`free`（没人 LISTEN，正常）／`horosa-ready`（应答形态像 MCP 端点）／`occupied-foreign`（有进程占着但不是 horosa → fail-fast + 修复提示）／`probe-failed`（探针自身出错 → 记 unknown，不算被占，但写进报告）。端口可被 `HOROSA_SKILL_PORT` / `--horosa-port` 覆盖。
4. **CLI 自持**：xuanshu 的 CLI 用 profile 树里那份 `<profile>/node_modules/@deepseek-ai/dsh/lib/bin.js`。本机 PATH 上全局 npm 装的是 **0.1.2-rc.1**，与 0.2.0-rc.2 的树不兼容（会崩在 `does not provide an export named 'StartupError'`）；版本不符时环境门判 FAIL（退出码 2），不静默回落。

**Considered Options**：

- **两个实例共用一个 `$DSH_HOME`，靠 profile 名区分**——被否：会话/storage/凭据/机器补丁根本不按 profile 分目录，这是上游的共享设计，不是配置问题。
- **给 desktop 也搬离 `~/.dsh`**——被否：desktop 由 Electron 应用独占管理（CLI 明确拒绝：`profile "desktop" is managed exclusively by the Electron application`），搬它等于跟应用抢数据目录。
- **只用文档约定（"跑测试前记得 `$env:DSH_HOME=...`"）**——被否：约定会被忘记，而且没有任何东西会在忘记时报错；本票要求"有测试断言同跑无串扰"，所以隔离必须是**可执行、可断言**的。
- **启动器自动换端口**——被否：端口冲突是"你已经有一个实例在跑"的信号，静默换端口会让人以为新实例起来了，实际在跟另一个实例说话。
- **把 `8765` 的占用直接当致命错**——被否：horosa 未启动是正常的（票 05/06 才托管它）；只有"被**别的**东西占着"才是必须停下来说清楚的错。

**Consequences**：

- 开发期多一件事：跑玄枢的实例前先跑 `node scripts/isolation/startup.mjs --mode doctor`（体检 + 两道门），或用 `pnpm verify:isolation` 一次性断言 I1~I7。
- `profile/pnpm-workspace.yaml` 的 `autoInstallPeers: false` 意味着 base/headless 补丁行依赖的那批 provider 包必须**显式**写进 `profile/package.json`（desktop profile 也是这么做的）；否则补丁行解析不到，装配树里会出现 `status:"error"` 的行。本票把这份显式清单补齐，并把 `@deepseek-ai/dsh` 自己装进 profile，让装配测试不再依赖"机器上碰巧有个能用的 CLI"。
- 票 05（setup 一键安装）与票 06（horosa 集成）沿用这套约定：数据目录、端口、`8765` 守卫都从 `scripts/isolation/defaults.mjs` 取，不再各写一份常量。
- **web 界面还没接**：起 web 实例要 `@deepseek-ai/dsh-web-app` bundle，而票 01 的装配契约把它划给票 07（首页替换）。本票实测把它提前放进 `dsh.profile.bundles` 会让装配树从 98 行涨到 187 行并多出 4 条 `unrecognized Loader tree carrier`（`preset-standard/ptc/minimal/cordis`），2 个必激活行不激活 → 票 01 的 S1/S2 直接转红。所以本票只把**端口隔离与守卫**做扎实（`--web-port` 被占 → exit 3，有真占端口的断言），`--mode web` 在缺 bundle 时**明确拒绝**（exit 2 + 点名缺哪个包），命令与环境经 `--mode env` 交付。接 bundle 与解决上面那 4 条 carrier 错误是票 07 的事。
- 回滚：删掉 `<repo>/.dsh-home` 即可回到"只有一个 desktop 实例"的原始状态；启动器不改动 `~/.dsh` 下的任何东西（测试有指纹断言 `no-real-home-write`）。
