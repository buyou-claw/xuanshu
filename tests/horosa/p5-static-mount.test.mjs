/**
 * P5 · **静态挂载行**（静态面三件事）
 *
 * 判据出处：契约 §2（硬约束 1–5）+ §5 P5 + Lead 2026-10-13 复审裁决。
 *
 * 本文件只做**静态面**：
 *   ① 版本库的 `profile/cordis.patch.yml` 里有这一行（id/name/serverName/回环 URL/容错键）；
 *   ② `profile/package.json` 的 `dsh.profile.bundles` 里没有市场类插件（`dsh-mcp-connector`/`dshmarket`）；
 *   ③ 本仓生产代码里**没有任何**写 `mcp_connector.json` 的路径（我们不走市场那条通道）。
 * 「`mcp-horosa` 真出现在 `--dump-config` 的 **profile 补丁层**」与「真实 `$DSH_HOME` 的
 * `storages/mcp_connector.json` 里没有 horosa 记录」这两件事**需要真跑 CLI/真 home**，
 * 验证在 **P10⑦（e2e）** —— 早先本文件里「自己造一份 storage 再断言不含 horosa」的写法是**自证**，
 * 已按复审意见删除。
 *
 * 抓的真实缺陷/风险：
 *   ① 「默认自带、不可删除」如果靠**运行期**再插一遍，市场就能删掉它；机制必须落在一行**版本库静态行**上。
 *   ② 同一个 id 声明两次会让 Loader **启动失败**（desktop profile 踩过），所以「只出现一次」必须断言。
 *   ③ `failOnStartupError` 默认是 true：horosa 没起时那一行会把整棵装配树拖垮 → 必须显式 `false` + reconnect。
 *   ④ `toolCallTimeoutMs` 默认偏短：首调会拉起 runtime（冷启动分钟级），超时太短 = 首次出盘必失败。
 *   ⑤ `serverName` 决定工具名前缀：写错 → 客户端按 `mcp__horosa__*` 找就找不到。
 *
 * 零网络、零子进程：只读文件。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

import { HOST_PACKAGE, PROFILE_PACKAGE_JSON, PROFILE_PATCH, REPO_ROOT } from './lib/paths.mjs'
import { parseYamlFile } from './lib/yaml.mjs'

const patch = parseYamlFile(PROFILE_PATCH)
const rows = (patch ?? []).flatMap((entry) => entry?.insert ?? [])
const horosaRow = rows.find((entry) => entry?.id === 'mcp-horosa')
const profilePackage = JSON.parse(readFileSync(PROFILE_PACKAGE_JSON, 'utf8'))

/** 全仓的 patch 文件（判「同一个 id 声明两次」用）。 */
function allPatchFiles() {
  const files = [PROFILE_PATCH]
  const packagesDir = join(REPO_ROOT, 'packages')
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    const candidate = join(packagesDir, entry.name, 'cordis.patch.yml')
    if (existsSync(candidate)) files.push(candidate)
  }
  return files
}

describe('P5 · 静态挂载行（profile 补丁层）', () => {
  it('mcp-horosa 行存在，且 id/name/serverName/transport 都与契约一致', () => {
    expect(horosaRow, 'profile/cordis.patch.yml 里没有 id=mcp-horosa 的 insert 行').toBeTruthy()
    expect(horosaRow.id).toBe('mcp-horosa')
    expect(horosaRow.name).toBe('@deepseek-ai/dsh-mcp-client')
    expect(horosaRow.config.transport).toBe('streamable-http')
    // 工具名前缀的唯一来源（客户端按 mcp__horosa__* 找工具）。
    expect(horosaRow.config.serverName).toBe('horosa')
  })

  it('回环 URL + failOnStartupError:false + 长 toolCallTimeoutMs + reconnect 四键', () => {
    const url = new URL(horosaRow.config.url)
    expect(url.hostname).toBe('127.0.0.1')
    expect(Number(url.port)).toBe(8765)
    expect(url.pathname).toBe('/mcp')
    // horosa 没起不许拖垮 DSH 启动（默认 true 会拖垮整棵树）。
    expect(horosaRow.config.failOnStartupError).toBe(false)
    // 首调会拉起 runtime（冷启动分钟级），5 分钟是契约钉的下限。
    expect(horosaRow.config.toolCallTimeoutMs).toBe(300_000)
    expect(horosaRow.config.reconnect).toEqual({ enabled: true, initialDelayMs: 1000, maxDelayMs: 30000, maxAttempts: 60 })
  })

  it('同一个 id 在全仓 patch 文件里只声明一次（重复声明会让 Loader 启动失败）', () => {
    const declarations = []
    for (const file of allPatchFiles()) {
      const parsed = parseYamlFile(file)
      const ids = (parsed ?? []).flatMap((entry) => entry?.insert ?? []).map((entry) => entry?.id)
      if (ids.includes('mcp-horosa')) declarations.push(file)
    }
    expect(declarations, 'mcp-horosa 只能在 profile 补丁层声明一次').toEqual([PROFILE_PATCH])
  })

  it('profile/package.json 不动：不加 dsh-mcp-client 依赖；市场类插件不进 bundles', () => {
    const dependencies = { ...(profilePackage.dependencies ?? {}), ...(profilePackage.devDependencies ?? {}) }
    expect(Object.keys(dependencies)).not.toContain('@deepseek-ai/dsh-mcp-client')
    const bundles = profilePackage.dsh?.profile?.bundles ?? []
    expect(bundles).not.toContain('@deepseek-ai/dsh-mcp-connector')
    expect(bundles).not.toContain('dsh-mcp-connector')
    expect(bundles).not.toContain('dshmarket')
    // 本票不改 packages/xuanshu-host/cordis.patch.yml（默认值即生产形态）。
    const hostPatch = join(HOST_PACKAGE, 'cordis.patch.yml')
    if (existsSync(hostPatch)) {
      expect(readFileSync(hostPatch, 'utf8')).not.toContain('mcp-horosa')
    }
  })

  it('本仓生产代码里**没有任何**写 `mcp_connector.json` 的路径（静态行不是市场连接）', () => {
    // 这条替代了早先「自己造一份 storage 再断言不含 horosa」的写法 —— 那是**自证**：
    // 文件是测试自己写的，断言必然成立，什么也没验到（Lead 2026-10-13 复审指出）。
    // 真正能验的是「我们根本不碰市场 storage 那条通道」：生产代码里搜不到那个文件名。
    const files = []
    const collect = (dir) => {
      if (!existsSync(dir)) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules') continue
          collect(full)
        } else if (/\.(mjs|cjs|js|ts)$/.test(entry.name)) {
          files.push(full)
        }
      }
    }
    for (const root of ['packages', 'scripts']) collect(join(REPO_ROOT, root))
    expect(files.length, 'packages/scripts 下一个源码文件都没扫到？扫描根写错了').toBeGreaterThan(20)

    const offenders = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length))
      text.split(/\r?\n/).forEach((line, index) => {
        if (/mcp_connector/i.test(line)) offenders.push(`${relative(REPO_ROOT, file).split('\\').join('/')}:${index + 1}: ${line.trim()}`)
      })
    }
    expect(offenders, `生产代码里出现了市场 storage 的写入路径：\n${offenders.join('\n')}`).toEqual([])
  })

  it('「层归属」与「真实 storage」的真实验证在 P10⑦（e2e），不在本文件', () => {
    // 本文件只做**静态面**（版本库 YAML / package.json / 生产代码）。
    // 「mcp-horosa 这一行真出现在 `--dump-config` 的 profile 补丁层」与「真实 $DSH_HOME 的
    // storages/mcp_connector.json 里没有 horosa 记录」都需要真跑 CLI 与真 home —— 那在 P10⑦。
    // 这条断言只是把这个分工显式写下来（防止有人以为静态面覆盖了那两件事）。
    expect(readFileSync(join(REPO_ROOT, 'tests', 'horosa', 'p10-e2e.test.mjs'), 'utf8')).toMatch(/dump-config/)
  })
})
