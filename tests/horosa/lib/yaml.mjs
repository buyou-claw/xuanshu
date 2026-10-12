/**
 * tests/horosa/lib/yaml.mjs — 读仓库里的 YAML 的**唯一一份**胶水。
 *
 * 为什么用 `profile/` 那棵树的 `yaml`：DSH 自己的依赖里有它（`profile/node_modules/yaml`），
 * 断言台不必为此加依赖、也不必联网装包。用 `createRequire(profile/package.json)` 解析，
 * 而不是从测试目录 require —— 后者的解析根在 `node_modules` 链上，会随包管理器布局漂移。
 *
 * 为什么不做「行式 YAML 解析」：P2/P5 断言的是**配置真的能被解析出来的那个值**
 * （端口/路径/回环/布尔），正则糊一遍等于用我自己的理解替代 YAML 规范 ——
 * 一个缩进或引号风格的改动就能让断言与真实装配结果分叉。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import { PROFILE_DIR } from './paths.mjs'

const requireFromProfile = createRequire(join(PROFILE_DIR, 'package.json'))

/** 用 profile 树的 `yaml` 解析一段 YAML 文本。 */
export function parseYaml(text) {
  const YAML = requireFromProfile('yaml')
  return YAML.parse(text)
}

/** 解析一个 YAML 文件。 */
export function parseYamlFile(path) {
  return parseYaml(readFileSync(path, 'utf8'))
}
