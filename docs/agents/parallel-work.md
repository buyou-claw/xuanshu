# 并行实现（worktree / 多 agent）

> 什么时候读：要开独立 worktree、或把多张票并行走时读本页。本文件的规则正文只在本文档；`AGENTS.md` 只放**指向本文件**的指针。

## 1. 起工作树（唯一入口）

在主仓根执行（不是在工作树里）：

```bash
node scripts/worktree-create.mjs <name> --base feat/spec-002-integration
```

- 一条命令完成：建树 + 建分支（默认 `fix/<name>`）+ 只链依赖（主仓根 `node_modules`、主仓里**已存在**的 `packages/*/node_modules` 与 `profile/node_modules` —— 后者是隔离实例的 DSH CLI 所在，缺了 worktree 里起不来实例；缺的会打印「跳过」）。末行会打印可直接复制的 `cd "<worktree 绝对路径>"`。
- 先看计划：同一条命令加 `--dry-run`（不建目录、不改 git）。分支名用 `--branch <name>` 覆盖。
- 不要手工 `git worktree add` + `mklink`：漏链跑不起来，链错就是下一节的跟穿事故。名字非法 / 目录或分支已存在时脚本会**拒绝且现场零改动**。

## 2. junction 跟穿（禁令）

- 实现者 worktree 的 `node_modules` 是指向主仓的 junction/symlink；**任何递归删除都会跟穿它，删掉的是主仓真件**（2026-10-17 实测：实现者按票在 worktree 里 `mklink /J node_modules <主仓>/node_modules`，收 worktree 时 `git worktree remove` 递归删除**跟穿 junction**，把主仓根 `node_modules` 清空 —— `vitest` / `tsc` 起不来，`.dsh-home` 里 profile 的 `node_modules` 也一起空了）。**恢复**：`ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile --offline`（pnpm store 还在）→ `node scripts/install-profile.mjs --home .dsh-home` → `pnpm verify:all` 复绿。**护栏**：`scripts/lib/cleanup-junctions.mjs` 在 `git worktree remove` **之前**先摘掉 worktree 内所有 junction/symlink（只删链接本身、绝不进目标），判据在 `tests/lib/cleanup-junctions.test.mjs`（含「目标哨兵文件必须活着」）。教训：`rmdir /s` 不跟随 reparse point 只保护最后那一步，**先删目录的是 git**。
- **收 worktree 只走**（主仓根执行）：`pnpm cleanup:worktrees`。它先证明分支 tip 已是 HEAD 的祖先（未并回只报告、不删）→ 脏工作区 `git stash --include-untracked` 存档 → 摘链接（只删链接本身、绝不进目标）→ deregister + 删目录。**这条证明链是必须的，不是流程洁癖**：2026-10-15 的清理轮里，票 13 客户端半有**两笔从未并回集成分支**的提交（合并方向走了一半：集成分支并入该分支后，客户端又并回一次、再提交一笔），靠 `git log -S'clearOutcome' --oneline HEAD` 在合并前输出 NONE 才被逮到；「先证明 branch tip 是 HEAD 祖先」就是为了让这类没回来的最后一棒**当场暴露而不是被静默删掉**。判据的具体做法见 `tests/lib/cleanup-junctions.test.mjs` 与 `scripts/cleanup-worktrees.mjs` 文件头。
- 禁止手写 `Remove-Item -Recurse` / `cmd /c rmdir /s` 清工作树或依赖目录；连 `tests/**/.tmp` 这类临时目录也别用递归删除（同款事故面：隔离台的临时 home 在红的时候不会被清，重跑会红在「现场回收干净」，清理要走 `cmd /c rmdir /s /q tests\isolation\.tmp`）。
- 收之前先看名单：`pnpm cleanup:worktrees -- --dry-run`。只在实现者全部收工、分支已提交后跑——脚本按「分支是否已并入」判，不看还有没有人在用。

## 3. 用例基线与客户端产物归属

- `tests/test-inventory.json` 是**集成分支所有者**的账：实现者不改它，照常写用例；所有者合并后统一 `node scripts/check-test-inventory.mjs --update` 刷新基线，并同步文档里的数字（`--update` 的键序由脚本自己排，别手改搬移）。
- `pnpm verify:all` = tsc + `node scripts/build-client.mjs --check` + 用例清单门 + `scripts/check-doc-numbers.mjs`：文档数字手抄一漂就红（判据见 `docs/agents/review-checklist.md` 第 4 条）。
- `packages/xuanshu-client/lib/client.js` 是 `packages/xuanshu-client/src/client/**` 的生成物：改了 src 就 `node scripts/build-client.mjs`，把产物一起提交；`node scripts/build-client.mjs --check` 是 CI 门。

## 4. 生成物冲突：一律重建

合并时 `packages/xuanshu-client/lib/client.js` 冲突**不手工合并**：取任意完整版本 → `node scripts/build-client.mjs` 按当前 `src` 重建 → `git add` 重建结果。生成物只认 src，手改/手并必漂。

## 5. 合并顺序（报告前）

1. 在你的分支上：`git merge feat/spec-002-integration --no-edit`；`client.js` 冲突按上节重建。
2. 重跑受影响用例（至少该票验证命令 + `tests/assembly`），把结果抄进报告。
3. 之后集成分支若再前进、或你的分支又提交，**报告前再并一次**：清理门按「分支 tip 是 HEAD 祖先」判，少并一次就可能丢提交。**这是实测踩过的坑**：票 13 客户端两笔就是这么丢的 —— 集成分支并入你的分支之后，你的分支又并回集成分支一次、再提交一笔，最后一棒没回来；`cleanup:worktrees` 的「必须是 HEAD 祖先」正是拦这个的。
