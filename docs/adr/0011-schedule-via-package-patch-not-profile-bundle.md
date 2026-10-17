# 0011 · `ctx.schedule` 由本包补丁行提供，而非 profile 的 `bundles`

**状态**：接受（2026-10-15）
**相关**：Spec 001 §86（票 13 的前置）· [ADR-0001](0001-build-on-dsh-by-assembly-not-fork.md)（只装配、不改上游）· [ADR-0004](0004-pin-upstream-versions.md)（钉版）· 票 13 / issue #16

## 背景

Spec 001 把票 13（底稿刷新 + 日课）的前置写成一句硬要求：

> 玄枢分发 profile 的 `dsh.profile.bundles` 必须**加上** `@deepseek-ai/dsh-experimental-schedule-bundle`，
> 否则 `ctx.schedule` 不存在 → 定时半边整体不可用。

实现在本机把这条路走了一遍，结果是**走不通**：

- `ctx.schedule` 的提供者不在 shipped 组合里 —— `@deepseek-ai/dsh-base` / `dsh-headless` / `dsh-web-app`
  三份 `cordis.patch.yml` 里都**没有** `time-context` / `schedule` / `ui-schedule` 这三个行 id；
- 改 `dsh.profile.bundles` 需要一个**能改 bundles 的面**：能改它的 `plugin_manager` 工具**只挂给 GUI 会话**，
  在无 GUI 的安装/脚本路径上不可得；CLI 的 `dsh plugin` 走的是 **pnpm 通道**（装包），**不管 bundle**。

也就是说：**规格给的那条路依赖一个在这个环境里拿不到的能力面**，而不是"没做"。

## 决定

**在本包自己的 `packages/xuanshu-host/cordis.patch.yml` 里插三行**，id 与 name 与 shipped bundle **逐字一致**：

```yaml
- id: time-context
- id: schedule
- id: ui-schedule
```

`profile/package.json` **一个字不动**（不新增 `dsh.profile.bundles` 条目）。

## 为什么不是别的做法

- **手写一个自己的 bundle 包**：等于把上游三个插件的装配细节抄一份进来，上游一改就漂 —— 违反 ADR-0001
  「只装配、不改上游」的精神（抄一份契约比调用它更脆）。
- **改 `profile/package.json` 的 bundles 数组**：在能改它的面（GUI 的 plugin_manager）拿到之前，
  改了也**验不了**；写了不能验的东西比写清楚"走退路"更坏。
- **等上游把三行加进 shipped 组合**：那是上游的事，不是这张票能决定的（ADR-0004 已把版本钉死）。

## 后果

**好的**：

- 三行落进树后，`--dump-config` 里三个 id 都在（有提交的断言 `tests/rikke/schedule-bundle.test.mjs` 钉住）；
- **S4 漂移基线不受影响**：基线 185 行**全部命中**，树 188 → 191 行（+3 就是这三行）——
  基线只检查"该在的还在"，所以新增行不会打红；
- **真机验过两端**：真 `dsh web` 启动后 `.dsh-home/storages/schedule.json` 里**恰好 2 条** daily
  （日课 07:30 / 底稿刷新 03:30），**再启一次仍是 2 条、sessions 下仍 2 个目录**（幂等）；
- 同一 profile 的 web 与 headless 两面都能拿到 `ctx.schedule`。

**代价与已知风险（要记住的一条）**：

- **将来若有人在 GUI 里对同一 profile 再 `set_bundle` 启用官方那个 bundle，会出现重复行**
  （同一个 id 被装配两次）。那时的正确做法是：**删掉本包补丁里的这三行**，改由 `dsh.profile.bundles` 管理。
  这条已写进 `packages/xuanshu-host/cordis.patch.yml` 的注释里，不让它只活在这份 ADR 里。
- **依赖声明不完整**：`packages/xuanshu-host/package.json` **没有**显式声明 `@deepseek-ai/dsh-schedule`，
  当前靠 `@deepseek-ai/dsh` 的传递依赖解析得到（实测 `profile/node_modules/@deepseek-ai/dsh-schedule` 存在）。
  也就是说：**如果上游哪天把这条传递依赖去掉，这三行会静默失效**（`ctx.inject(['schedule'], …)` 的回调
  永远不触发，界面只显示"未回传"，boot 不报错）。这是本决定留下的最脆的一环，如实登记在此。
  彻底修法是显式声明该依赖（需重跑 `install-profile` 并核对钉版），**留作后续**。

## 与规格的关系

规格原文（Spec 001 §86 与票 13 的"前置"段）**没有回改**：它描述的是"最终应当达到的状态"，
而本 ADR 记录的是"当前环境里达到该状态的替代路径"。两者不冲突 —— 一旦能在该 profile 上改 bundles，
就应当改回规格写的那条路，并删掉这三行。
