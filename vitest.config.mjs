import { defineConfig } from 'vitest/config'

/**
 * 仓库根只跑**我们自己**的测试。
 *
 * 为什么必须显式配置：本仓库是「文档 + 装配包」仓库，根目录旁边常年躺着两类不该被 vitest 扫进来的东西——
 *   - `.upstream/`：上游侦察克隆（horosa-web 的 900+ 个测试文件，缺依赖、必红）；
 *   - `profile/node_modules/`：DSH 整棵树（约 300 个包，自带一堆 node_modules 测试）。
 * 不写 include/exclude，`vitest run` 会把它们全吸进来，把「全绿」变成「961 个无关失败」。
 * 证据：未加本文件前 `pnpm test` = 961 failed | 2 passed。
 */
export default defineConfig({
  // 票 07 起，UI 槽位契约测试直接 import `packages/xuanshu-client/src/client/*.tsx`
  // （vite 原生 esbuild 只做 TS 擦除 + JSX 变换）。JSX 必须是自动运行时，与包的
  // tsconfig（`"jsx": "react-jsx"`）和产物构建（esbuild `jsx: 'automatic'`）三处一致。
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: ['tests/**/*.test.mjs'],
    exclude: ['**/node_modules/**', '.upstream/**', '.scratch/**', 'profile/**', 'packages/**'],
    // 装配契约测试台要拉起 CLI dump（~3s）与进程内 boot 整棵树（~3s），默认 5s 不够。
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // 契约测试会写 `$DSH_HOME`（隔离目录）并启动 profile，串行跑避免互相踩。
    fileParallelism: false,
  },
})
