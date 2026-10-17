/**
 * tests/horosa/lib/yaml.mjs — 读仓库里的 YAML 的**唯一一份**胶水。
 *
 * 为什么用 `yaml` 这个包（而不是行式正则）：P2/P5 断言的是**配置真的能被解析出来的那个值**
 * （端口/路径/回环/布尔），正则糊一遍等于用我自己的理解替代 YAML 规范 ——
 * 一个缩进或引号风格的改动就能让断言与真实装配结果分叉。
 *
 * **从仓库根解析**（复核 CI 实测的修复）：`yaml` 现在是根 `devDependencies` 里的一条显式依赖，
 * 所以 `pnpm install --frozen-lockfile` 之后它就在 `<repo>/node_modules/yaml`。以前只从
 * `profile/package.json` 解析 —— 那棵树要跑过 `setup` 才有，于是**干净环境（CI）里
 * `Cannot find module 'yaml'`，p2/p5 两个文件整个收集失败、15 条用例从总数里消失**
 * （清单门抓到的正是这个形状）。脚本放在 `tests/horosa/lib/`，向上两级就是仓库根，
 * 解析根因此**不依赖包管理器布局**，也不依赖 profile 装没装。
 *
 * 兜底保留 `profile/`：老环境（只有 profile 那棵树、没重跑过 `pnpm install`）仍能跑。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PROFILE_DIR } from './paths.mjs'

/** 仓库根（`tests/horosa/lib/` 向上三级）。 */
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** 按顺序试几个解析根，返回第一个装得出来的 `yaml`。 */
function loadYaml() {
  const roots = [join(REPO_ROOT, 'package.json'), join(PROFILE_DIR, 'package.json')]
  let lastError
  for (const root of roots) {
    try {
      return createRequire(root)('yaml')
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(
    `解析不到 \`yaml\`（试过 ${roots.join(' 与 ')}）：先在仓库根跑一次 \`pnpm install --frozen-lockfile\`。`
    + `原始错误：${String(lastError?.message ?? lastError)}`,
  )
}

const YAML = loadYaml()

/** 用 `yaml` 解析一段 YAML 文本。 */
export function parseYaml(text) {
  return YAML.parse(text)
}

/** 解析一个 YAML 文件。 */
export function parseYamlFile(path) {
  return parseYaml(readFileSync(path, 'utf8'))
}
