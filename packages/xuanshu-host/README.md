# xuanshu-host — 玄枢主机插件（Node 侧）

玄枢（XuanShu）= **DSH profile `xuanshu` + 主机插件 `xuanshu-host` + 客户端插件 `xuanshu-client` + 内置 skills + setup 脚本**，纯装配、零 DSH 源码改动（ADR-0001）。本包是其中的**主机半边**。

## 它在装配里的位置

```
profile/xuanshu (dsh.profile.bundles)
  ├─ @deepseek-ai/dsh-base        ┐
  ├─ @deepseek-ai/dsh-headless    │ 各 bundle 的 cordis.patch.yml 依序叠加
  ├─ xuanshu-host     ← 本包 ─────┤ 本包的 dsh.bundle.patch 插入一行插件：
  └─ xuanshu-client               ┘   { id: xuanshu-host, name: xuanshu-host }
```

- `dsh.bundle.patch` → `cordis.patch.yml`：本包的 bundle 补丁，`insert` 一行 `id/name` 均为 `xuanshu-host` 的插件行（契约 §0/§3）。
- `lib/index.js`：那一行的实现，cordis 插件（`name` / `inject` / `apply`）。`inject` 刻意为空数组——不依赖任何宿主 service，所有 service 都用非严格 `ctx.get(name, false)` 软取，拿不到就降级并在报告 `notes` 里说明。
- 本包**不带** `dsh.client` 声明：浏览器半边属于 `xuanshu-client`。

## 运行时产物

`apply(ctx)` 只做纯本地文件操作（**不调 LLM、不联网、不开端口**；只 import `node:fs`/`node:module`/`node:os`/`node:path`/`node:url` 五个 node 内置模块）：

1. 建目录 `$DSH_HOME/xuanshu/`（`$DSH_HOME` 缺省 `~/.dsh`；契约 §0 数据目录）；
2. 写出 `$DSH_HOME/xuanshu/assembly-report.json`（schema `xuanshu/assembly-report@1`）——票 01 唯一的运行时可观察证据（seam S2）。写法是同目录临时文件 + `rename` 覆盖，保证读到的一定是完整 JSON；
3. 注册斜杠命令 `/xuanshu-report`：就地重探并重写报告后回报一行摘要（不依赖 LLM 的宿主侧可观察物，契约 §3 第 3 条）。`commands` service 不在场时静默跳过。

### 报告字段

| 字段 | 来源 |
|---|---|
| `schema` | 定值 `xuanshu/assembly-report@1` |
| `generatedAt` | 本次写出时刻（ISO 8601） |
| `ok` | 三项必查全过才 `true`：`profileContext` 可得 ∧ 两个插件包都在 profile 安装点解析到 ∧ 两行 id 都在本进程树中 |
| `profile.name` / `.dir` / `.dshHome` | `ctx.get('profileContext')`（`name`/`dir`/`home`）；不可得时按 `$DSH_HOME` 与契约 §0 推导并记 `notes` |
| `dsh.version` | 运行时解析 `@deepseek-ai/dsh`（退回 `dsh-headless`/`dsh-base`）的 `package.json.version`；都解析不到则留空串 |
| `runtime.node` / `.platform` | `process.version` / `process.platform` |
| `plugins['xuanshu-host']` / `['xuanshu-client']` | **运行时探测**：本包读模块旁的 `package.json`，对端包从 profile 安装点解析 `<包名>/package.json`；解析不到就**不留该键**并记 `notes`（不硬编码版本/路径） |
| `patchRowIds` | `[...ctx.get('loader').entries()]` 取每行 `Entry.options.id`，去重排序 = 本进程可见的补丁行 |
| `notes` | 降级与失败原因的自由文本（不伪造数据的地方都会在这里说清楚） |

`patchRowIds` 取 `Entry.options.id`（补丁行自身 id，与 `dsh --profile xuanshu --dump-config` 打印的 id 同形态），而不是 `Entry.id`——后者在 include 子树里是路径形态（`include:xuanshu-host`）。该数组是**忠实枚举**，会包含 app-boot 合成的根 include 行（`include`）与 group 行；要「只含补丁层行」的消费方自行过滤。

## 用法与自检

```powershell
# 导入自检（DoD）：导出 apply 函数
node --input-type=module -e "const m = await import('file:///E:/ai_project/XuanShu/packages/xuanshu-host/lib/index.js'); console.log(typeof m.apply, m.name)"
```

真正「装进树里、状态激活、报告写出」的验证由票 01 的**装配契约测试台**负责（`tests/assembly/`，
S1–S5），不放在本包内。本包**不带**自己的验证脚本：一次性的手写探针属于侦察草稿
（`.scratch/**`，gitignore），不进提交物。
