# 基于固定版本开发，不实时跟随上游（已钉死具体版本）

玄枢依赖两个外部上游：**DSH**（形态骨架，MIT）与 **horosa-skill**（玄学底座，AGPL-3.0-only）；另有一个规格参考对象：**星阙桌面端**（AGPL，只取其已验证的交互规格，不是依赖）。

**决定：锁定下列具体版本进行参考开发，不实时跟随上游仓库更新；上游更新在本项目内先不考虑。**

| 上游 | 钉死版本 | 提交 / 发布锚 | 用途 |
|---|---|---|---|
| DSH（`deepseek-ai/deepseek-harness`） | **dsh-v0.2.0-rc.2** | tag SHA `639ed015397290b3745d163aafe02ffee4aa3f84`；npm `@deepseek-ai/dsh@0.2.0-rc.2`（latest）；本机 `~/.dsh/profiles/desktop` 全系实装同版（侦察依据 docs/research/dsh-recon.md） | 形态骨架 + 装配基底（玄枢 = 其上的一个 profile + 插件） |
| horosa-skill（`Horace-Maxwell/horosa-skill`） | **v0.40.1** | release wheel URL 钉死 + SHA256；runtime 同版本同装；源码参考 main@`7ba3ab6a`（本地克隆 `.upstream/horosa-skill`） | 玄学底座（本地 MCP） |
| 星阙桌面端（`Horace-Maxwell/Horosa-Web-App-comprehensively-improved-Windows`） | **v3.11.3** | commit `f21b451b`（本地克隆 `.upstream/horosa-web-app-windows`） | 规格参考（八字录入、Best-of-N、挂载预算模式），非依赖 |

**Considered Options**：

- 实时跟随上游（总能拿到最新技法与修复）——被否。理由：① 两个上游都还在活跃变动（DSH 尚在 rc、horosa 技法与工具数在版本间变化），跟随会把上游的不稳定直接引进项目；② 玄枢有一处必须自持的定制（首页替换，见 ADR-0002），跟随意味着持续手工合并。
- 钉磁盘上旧 checkout 的 0.1.2-rc.1——被否：比 npm latest 落后两个版本，且全部扩展面侦察基于 rc.2 完成；rc.2 同时满足「最新可用（npm latest）」「本机实装」「已逐行验证」三个条件。master 的 0.2.1-alpha.x 为 alpha 流，不追。

**Consequences**：上游的新技法、新修复不会自动到来，需要**主动做一次升级**（一次性的、有意识的动作）。升级清单：

1. **horosa**：读新 release 的 `LESSONS.md` 新增条目 → 换钉死 wheel URL → 重装**同版本** runtime（禁止新树 + 旧 runtime 混跑）→ 重跑集成自检（八字出盘 + envelope + technique_card）；
2. **DSH**：换 tag 重跑 profile 装配 → 验证补丁行 id 未漂移 → 重新验证首页槽位遮蔽与 priority；
3. **星阙桌面端**：仅重新提取受影响的交互规格，代码不搬。
