# tests/workflow — 票 16 工作流创建向导的断言台

零网络、零真实 LLM、零真实 skill 注册表。被测物是宿主 `packages/xuanshu-host/lib/workflow/**`
（`workflow.create` / `workflow.list` / `workflow.exportSkill`）与客户端门厅面板
（`packages/xuanshu-client/src/client/workflow/**`）。

## 用例分布

| 文件 | 覆盖 |
|---|---|
| `create.test.mjs` | 会话创建（自铸 id / 专用 cwd / preset + 模型 / 不进 workspace）、**种子文本首行 `/writing-skills`**、能力门（缺 preset/模型当场失败且不建会话）、清单先有会话才有、`workflow.list` 的字段与「没导出就省略 `exportedAt`」、工作流不碰 `pus/` |
| `export-skill.test.mjs` | 落点 `<dshHome>/skills/<kebab>/SKILL.md`、frontmatter **只有 name + description**（旧键一个都不产生）、同名冲突不静默覆盖、**写完立刻读回**（磁盘重解析 + 注册表两条路）、缺字段/会话不在清单里的可读失败 |
| `../assembly/workflow-panel.test.mjs` | 契约 §4 三个方法名逐字、请求体透传、**渲染期只读 list（写请求只有人点才发）**、规则文案与人判定、导出按钮 disabled 判据、加性注册（不碰默认面板）、S1 快捷入口 `QUICKLINK.workflow` 的落点 |

## 真机取证：导出 skill（2026-10-15，本机）

导出 skill 是本票唯一**写到用户真实机器上**的动作，而它落错地方或读不回来，用户**看不出来**
（skill 静静地不生效）。沙箱里全绿不算数，所以真机跑过一次（探针：
`.scratch/assembly-foundation/captures/gt16-real-skill-export.mjs`，跑完即删）：

```powershell
node .scratch/assembly-foundation/captures/gt16-real-skill-export.mjs `
  --dsh-home E:\ai_project\XuanShu\.dsh-home --profile xuanshu `
  --cli-bin E:\ai_project\XuanShu\.dsh-home\profiles\xuanshu\node_modules\@deepseek-ai\dsh\lib\bin.js `
  --worktree E:\ai_project\XuanShu\.scratch\worktrees\t16-workflow
```

真机观测（三次跑的结果一致，最后一次的输出）：

1. **落点**：`E:\ai_project\XuanShu\.dsh-home\skills\xs-workflow-selftest\SKILL.md`（335 B），
   frontmatter 逐字是 `---` / `name: xs-workflow-selftest` / `description: "…"` / `---`，
   目录里只有 `SKILL.md` 一个文件；跑完删掉后 `skills/` 下为空。
2. **读回验证**：
   - 磁盘重解析 → `{ok:true, name, description, content}` 全部对得上；
   - `ctx.skills.list({})` → **数组，2 条**（`diagnose-windows-sandbox-acl`、`xuanshu-create-pu`），
     **看不到**刚写的那个 skill（导出前后都是 2 条，带 `cwd` 也一样）——
     宿主层看不到 preset 层扫出来的 `user-dsh` skill，事实笔记 §4.1.4 的分层陷阱在真机上成立；
   - 于是 `verifySkillRegistered` 给 `{checked:true, found:false, conflict:false}` +
     一句如实的 reason：**导出仍然成功**（磁盘那一步是权威判据），但**不谎称**注册表也核对过了。
3. **同一次真机跑抓到的真缺陷**：`ctx.skills.list()` 是 `Promise<SkillSummary[]>`
   （`dsh-skill/lib/types/index.d.ts` 的 `SkillRegistry`），第一版没 `await` →
   `Array.isArray(Promise)` 恒 false → **每次都报「注册表里没看到」**。
   这句话听起来像 watcher 没生效，其实是自己没 await；沙箱里的假 service 也是同步的，
   两边一起错、测试全绿。已修（`await` + 非数组时如实说「服务面变了」），
   并补了一条以「同名冲突」为探针的回归用例（只有真 await 到列表才可能发现冲突并回滚）。
