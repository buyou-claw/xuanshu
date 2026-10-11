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
| `docs/adr/` | 架构决策记录（0001 装配不 fork / 0002 首页替换 / 0003 藏不上 AI / 0004 钉版 / 0005 谱是信息） |
| `docs/research/` | 上游侦察报告（DSH / horosa-skill / 星阙桌面端 / 真太阳时 / 事实核查） |
| `docs/agents/` | agent 工作流配置（issue tracker / domain docs） |

## 状态

- 产品与架构已定稿；Spec 001（装配基座：setup → 冷启动八字 → 自我总览四卡 → 问事闭环 → 谱）已发布为 [issue #1](https://github.com/buyou-claw/xuanshu/issues/1)（ready-for-agent）。
- 代码尚未开工；下一步 = 拆 tickets → 按 S1（客户端构建管线）→ S2（首页替换）→ S3（horosa 集成）→ S4（问事闭环）逐票实现。

## 许可

AGPL-3.0-only（与上游 horosa-skill 同许可；DSH 为 MIT）。玄学计算能力不自造——全部来自上游 horosa-skill，本仓库只做装配与「个人的完整系统」。
