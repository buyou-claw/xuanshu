# 玄枢 XuanShu

**玄枢 · 个人的 AI 化入口** —— 玄学为地基，谱为血肉，你为中枢。

只属于一个人的本地 AI 工具：以开源玄学底座 **horosa-skill**（本地 MCP）为最底层地基（命 + 运，永远在场），在 **DSH（DeepSeek Harness）** 之上以「profile + 插件装配（不 fork）」的方式，把「我这个人」的信息按**谱**积累、随问事勾选加载，多 AI 合参给出针对我个人的指引。**拍板权永远在人。**

- 单用户、本地部署、开源（AGPL-3.0-only）、无账号体系
- 底座 horosa-skill v0.40.1 · 骨架 DSH dsh-v0.2.0-rc.2 · 星阙桌面端 v3.11.3（规格参考）——版本钉死，见 `docs/adr/0004`

## 文档索引

| 文档 | 内容 |
|---|---|
| `CONTEXT.md` | 术语表（底座/谱/藏/底稿/问事/工作流/多 AI 合参/日课/沉淀/规格级复用…） |
| `product-definition.md` | 产品定义基准（v10） |
| `xuanshu-portrait.md` | 产品画像 |
| `docs/architecture-v1.md` | 技术架构 v1（分层、装配清单、机制映射、数据流、Spike 清单） |
| `docs/pu-spec-v1.md` | 谱规范 v1 |
| `docs/specs/` | 交付 specs（001 装配基座 = issue #1；002 住进去 = issue #21） |
| `docs/adr/` | 架构决策记录（0001 装配不 fork / 0002 首页替换 / 0003 藏不上 AI / 0004 钉版 / 0005 谱是信息 / 0006 双实例隔离 / 0007 setup 一条命令 / 0008 horosa 静态挂载与宿主托管） |
| `docs/runbook/` | 操作手册（`setup.md` = 一键安装：钉版取件 / 三项自检 / 退出码 / 升级与回滚；`dual-instance.md` = desktop + xuanshu 开发期并跑：DSH_HOME / 端口 / horosa 8765 守卫 / 回滚；`horosa.md` = horosa 底座：静态挂载行 / 宿主托管六步 / `/xuanshu-horosa` / `bazi-contract.mjs` / 状态文件 / 排障） |
| `docs/research/` | 上游侦察报告（DSH / horosa-skill / 星阙桌面端 / 真太阳时 / 事实核查） |
| `docs/agents/` | agent 工作流配置（issue tracker / domain docs） |

## 仓库结构

玄枢 = **一个 DSH profile + 两个插件包 + 内置 skills + setup 脚本**，零 DSH 源码改动（ADR-0001）。

| 路径 | 是什么 |
|---|---|
| `packages/xuanshu-host/` | 主机插件：建数据目录 `$DSH_HOME/xuanshu/`、写装配报告、注册宿主侧命令 |
| `packages/xuanshu-client/` | 客户端插件：`dsh.client{platform:'web'}` + **自带预编译 bundle**（`lib/client.js` 随包提交，装包即用，无需 `dev:web`）；`src/` 是源码，`scripts/build-client.mjs` 是构建管线 |
| `profile/` | **DSH profile 分发包** `xuanshu`：`package.json`（`dsh.profile.bundles`）+ `cordis.patch.yml` + `pnpm-lock.yaml` |
| `scripts/install-profile.mjs` | 装配：让 `profile/` 出现在 `$DSH_HOME/profiles/xuanshu`（link / copy 两种模式），再 `pnpm install` |
| `scripts/verify-assembly.mjs` · `tests/assembly/` | **装配契约测试台**：启动装配后的 profile，断言「装配成功 / 两个插件包在运行时树中 / 补丁行 id 未漂移」 |
| `scripts/isolation/` · `scripts/verify-isolation.mjs` · `tests/isolation/` | **开发期双实例隔离**：独立 `$DSH_HOME` + 独立端口 + horosa `8765` 单占用守卫；断言与 desktop 并跑无会话/storage/凭据串扰（ADR-0006） |
| `docs/` | 架构、specs、ADR、runbook、上游侦察 |

```bash
pnpm install                                     # 仓库根依赖（构建管线用）
node scripts/install-profile.mjs                 # 装 profile 到 ~/.dsh/profiles/xuanshu
node scripts/install-profile.mjs --home <dir>    # 或装到隔离的 DSH_HOME（测试用）
pnpm build:client                                # 从 src 重建客户端预编译 bundle
pnpm verify:assembly                             # 跑装配契约校验
pnpm doctor:xuanshu                              # 双实例体检（home / CLI / profile / 端口 / horosa 8765）
pnpm verify:isolation                            # 断言同跑无串扰（含两次真跑 headless + 哨兵）
pnpm test                                        # 全部测试
```

`pnpm dev:xuanshu` 启动 `127.0.0.1:19388` 的隔离 web 实例，首屏为自我总览。启动器选择 web 解析器；`--mode headless` 选择 headless 解析器，两个 bundle 不同时解析启动参数。直接启动使用 `dsh --profile xuanshu --port 19388 --no-open`。详见 [双实例 runbook](docs/runbook/dual-instance.md)。

## 安装

```bash
node scripts/setup.mjs --mirror https://gh-proxy.com/https://github.com   # 一条命令：取件 → 校验 → 装 runtime → 装配 profile → 自检
```

钉版 horosa-skill v0.40.1（SHA256 硬门，不匹配不装）；Windows runtime 落纯 ASCII 根 `C:\horosa`；装完跑三项真实自检（装配可启动 / 8765 健康 / 八字出盘）。网络不可达用 `--wheel`/`--runtime` 喂本地件；直连 GitHub 只有 12–24 KB/s，开发机一律带 `--mirror`。参数族、退出码 0–5、失败处置、升级与回滚见 [docs/runbook/setup.md](docs/runbook/setup.md)。

## horosa 底座

底座是**默认自带、删不掉**的一行：`profile/cordis.patch.yml` 用静态 `insert` 挂 `mcp-horosa`（`@deepseek-ai/dsh-mcp-client`，回环 `http://127.0.0.1:8765/mcp`）——它写在版本库的 profile 补丁层里，市场插件的连接记录（`$DSH_HOME/storages/mcp_connector.json`）里没有它，所以市场 UI 删不掉它。

进程由宿主托管：装配后 `xuanshu-host` 读 setup 报告 → 校验 runtime 版本 → 探端口四态（`free`/`horosa-ready`/`occupied-foreign`/`probe-failed`）→ spawn `horosa-skill serve` → **MCP 握手**判就绪；只停自己起的那份，非回环一律拒绝启动。失败只落 `<dsh-home>/xuanshu/horosa/horosa-status.json`（`code` + `hint`），**永不拖垮 DSH 启动**。

```bash
node scripts/horosa/bazi-contract.mjs --json    # 直打回环，验信封结构 / timeAlg 缺省=0 / 澄清闸（退出码 0/1/3）
```

命令用法、状态文件字段、config 键与排障表见 [docs/runbook/horosa.md](docs/runbook/horosa.md)；为什么这么设计见 [docs/adr/0008](docs/adr/0008-horosa-static-mount-and-host-managed-lifecycle.md)。

## 状态

- **Spec 002（住进去）已立项**：[issue #21](https://github.com/buyou-claw/xuanshu/issues/21)，规格 `docs/specs/002-reside-and-use.md`。主线 =「真的用起来」：独立桌面壳 + 两次触达（日课 / 晚省）+ 事记与底稿两段 + 真多家 API 合参 + 数据备份页；形态决策见 `docs/adr/0014`（玄枢自己的壳与 home，与 DSH 桌面版零交集）。
- **Spec 001（装配基座）16 张票全部实现完毕**，收在集成分支 `codex/spec-001-integration`，由 [PR #20](https://github.com/buyou-claw/xuanshu/pull/20) 承载（覆盖并取代已关闭的 stacked PR #2 / #3 / #4 / #6 / #7 / #9）；父 issue [#1](https://github.com/buyou-claw/xuanshu/issues/1)。
- 交付面：setup 一键安装（钉版 + SHA256 硬门）→ horosa 底座静态挂载与宿主托管 → 冷启动八字向导 → 自我总览四卡 → 谱管理 → 问事闭环 → 多 AI 合参 → 临时挂载 → 底稿 / 日课 → 藏库 → 沉淀闭环 → 工作流向导。零 DSH 源码改动（ADR-0001）。
- 验证（集成分支 tip，2026-10-15）：`vitest run` → **1021 passed / 4 failed / 8 skipped（1033）**；装配五 seam **S2 / S3 / S4 / S5 PASS，S1 FAIL**（钉版 `dsh-app-boot@0.2.0-rc.2` 的 schema 导出器只收 native carrier，而同版官方 web bundle 自带的 `dsh-agent-preset` 是另一种 —— 上游缺陷；测试保留失败、不放宽断言、不改上游源码）；`tsc --noEmit` exit 0；`build-client --check` in sync（386627 B）。
- 那 4 条失败里：**2 条是 S1 及其连带**；另 **2 条是 `tests/horosa/p0-fixtures` 的原始捕获缺失**（`.scratch/assembly-foundation/captures/gt06-*` 是本机真机取证、未纳入版本库）—— 不是代码回归：证据缺失时它们**故意红**，此前只是被 `skipIf` 掩盖（见 [开发进度](docs/development-status.md) §10）。
- 真机未覆盖的项（浏览器点击链、客户端↔宿主合流、真 LLM 路径、两处未做槽位）逐条登记在 [待实测登记处](docs/design/ui-v1/待实测登记处.md) §6 与 [开发进度](docs/development-status.md)。

## 许可

AGPL-3.0-only（与上游 horosa-skill 同许可；DSH 为 MIT）。玄学计算能力不自造——全部来自上游 horosa-skill，本仓库只做装配与「个人的完整系统」。
