# 并行实现（worktree / 多 agent）

> 什么时候读：要开独立 worktree、或把多张票并行走时读本页。本文件的规则正文只在本文档；`AGENTS.md` 只放**指向本文件**的指针。

## 1. 起工作树（唯一入口）

在主仓根执行（不是在工作树里）：

```bash
node scripts/worktree-create.mjs <name> --base feat/spec-002-integration
```

- 一条命令完成：建树 + 建分支（默认 `fix/<name>`）+ 只链依赖（主仓根 `node_modules` 与主仓里**已存在**的 `packages/*/node_modules`；缺的会打印「跳过」）。末行会打印可直接复制的 `cd "<worktree 绝对路径>"`。
- 先看计划：同一条命令加 `--dry-run`（不建目录、不改 git）。分支名用 `--branch <name>` 覆盖。
- 不要手工 `git worktree add` + `mklink`：漏链跑不起来，链错就是下一节的跟穿事故。名字非法 / 目录或分支已存在时脚本会**拒绝且现场零改动**。

## 2. junction 跟穿（禁令）

- 实现者 worktree 的 `node_modules` 是指向主仓的 junction/symlink；**任何递归删除都会跟穿它，删掉的是主仓真件**（2026-10-17 实测：主仓 `node_modules` 被清空，见 `docs/development-status.md` §16.4 第 7 条）。
- **收 worktree 只走**（主仓根执行）：`pnpm cleanup:worktrees`。它先证明分支 tip 已是 HEAD 的祖先（未并回只报告、不删）→ 脏工作区 `git stash --include-untracked` 存档 → 摘链接（只删链接本身、绝不进目标）→ deregister + 删目录。证明链条目见 `docs/development-status.md` §10「清理轮：找回票 13 客户端半的最后一棒」。
- 禁止手写 `Remove-Item -Recurse` / `cmd /c rmdir /s` 清工作树或依赖目录；连 `tests/**/.tmp` 这类临时目录也别用递归删除（同款事故面，§16.4 第 2 条）。
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
3. 之后集成分支若再前进、或你的分支又提交，**报告前再并一次**：清理门按「分支 tip 是 HEAD 祖先」判，少并一次就可能丢提交（见 `docs/development-status.md` §「工作方式」的「合并方向的最后一棒」条）。
