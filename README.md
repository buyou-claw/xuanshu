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
| `docs/specs/` | 交付 specs（001 装配基座 = issue #1） |
| `docs/adr/` | 架构决策记录（0001 装配不 fork / 0002 首页替换 / 0003 藏不上 AI / 0004 钉版 / 0005 谱是信息 / 0006 双实例隔离 / 0007 setup 一条命令） |
| `docs/runbook/` | 操作手册（`setup.md` = 一键安装：钉版取件 / 三项自检 / 退出码 / 升级与回滚；`dual-instance.md` = desktop + xuanshu 开发期并跑：DSH_HOME / 端口 / horosa 8765 守卫 / 回滚） |
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

> `pnpm dev:xuanshu`（起 `127.0.0.1:19388` 的 web 实例）**当前会以退出码 2 拒绝**：web 界面要 `@deepseek-ai/dsh-web-app` bundle，按票 01 的装配契约它属票 07（首页替换）。在被测实例上跑自证请用 `node scripts/isolation/startup.mjs --mode headless`；要拿端口/环境去启动别的实例用 `--mode env`。详见 `docs/runbook/dual-instance.md`。

## 安装

```bash
node scripts/setup.mjs --mirror https://gh-proxy.com/https://github.com   # 一条命令：取件 → 校验 → 装 runtime → 装配 profile → 自检
```

钉版 horosa-skill v0.40.1（SHA256 硬门，不匹配不装）；Windows runtime 落纯 ASCII 根 `C:\horosa`；装完跑三项真实自检（装配可启动 / 8765 健康 / 八字出盘）。网络不可达用 `--wheel`/`--runtime` 喂本地件；直连 GitHub 只有 12–24 KB/s，开发机一律带 `--mirror`。参数族、退出码 0–5、失败处置、升级与回滚见 [docs/runbook/setup.md](docs/runbook/setup.md)。

## 状态

- 产品与架构已定稿；Spec 001（装配基座：setup → 冷启动八字 → 自我总览四卡 → 问事闭环 → 谱）已发布为 [issue #1](https://github.com/buyou-claw/xuanshu/issues/1)（ready-for-agent）。
- **票 01（空壳立起）已实现**：分发包骨架三件套齐备、客户端预编译构建管线跑通、headless 启动 `xuanshu` profile 成功、装配契约测试台绿。
- **票 04（开发期双实例隔离）已实现**（[issue #5](https://github.com/buyou-claw/xuanshu/issues/5)）：`scripts/isolation/` 启动器 + `docs/runbook/dual-instance.md` + `tests/isolation/`。顺带修好票 01 测试台的两处环境依赖（profile 未自持 CLI、补丁行缺 provider 包），`pnpm verify:assembly` 现在五条 seam 全绿。
- 后续按 S1（客户端构建管线，已完成）→ S2（票 07 · 首页替换）→ S3（票 06 · horosa 集成 + 八字出盘）→ S4（票 10 · 问事闭环）逐票实现。

## 许可

AGPL-3.0-only（与上游 horosa-skill 同许可；DSH 为 MIT）。玄学计算能力不自造——全部来自上游 horosa-skill，本仓库只做装配与「个人的完整系统」。
