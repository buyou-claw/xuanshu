# 站在 DSH 上做「装配 + 定制」，不复制源码另起炉灶

DSH（`@deepseek-ai/dsh`，MIT）本身就是插件化骨架：能力全部由 bundle / 插件装配而成，第三方插件可以加侧边栏入口、面板与 host 路由。玄枢是它之上的「一个 profile + 一组插件 + 必要的定制」。**决定：不 fork 源码另起炉灶**——原因有三：① 本机跑的是 `0.2.0-rc.2`，而能找到的源码 checkout 只有 `0.1.2-rc.1`，fork 会立刻背上一份落后一个版本的源码；② DSH 还在 rc 阶段，fork 后上游每次改动都要手动合；③ 玄枢真正独有的东西有限（horosa 插件封装、模块规范、会话级预选、多 AI 合参交互），其余能力 DSH 已经提供。

**Consequences**：DSH 的升级路线由上游决定，玄枢只维护自己那几块；唯一必须自持的定制点见 ADR-0002。版本策略见 ADR-0004。

> 附注（2026-10 侦察修正，见 docs/research/dsh-recon.md）：理由 ① 中「源码 checkout 只有 0.1.2-rc.1」的前提已核实为误——本机 checkout 实为 **0.2.0-rc.2 的已装配 desktop profile**（DSH 本体以 npm 发布包安装于 node_modules）。决定不变，且证据更强：装配式正是官方机制本身，profile 即分发包。
