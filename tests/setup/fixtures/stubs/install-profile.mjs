#!/usr/bin/env node
/**
 * tests/setup/fixtures/stubs/install-profile.mjs — `scripts/install-profile.mjs` 的**替身**。
 *
 * 为什么必须替身（契约 §10 / Lead 批准的 `XUANSHU_INSTALL_PROFILE_BIN`）：
 * 真实现会在 profile 里跑 `pnpm install`。断言台的两条硬约束是「**零网络**」「**零真实安装**」，
 * 而 pnpm 会不会碰 registry 不由我们控制；更重要的是，那会让「第二次跑零下载」这种断言
 * 混进一堆与取件无关的 I/O（一次抖动就假红）。
 *
 * 替身只做真实现里**被测实现真正会依赖**的那一件事：让 `<home>/profiles/<name>` 变成一个存在的目录。
 * 它把 argv 记到 `$XUANSHU_STUB_LOG/<name>.jsonl`，断言台据此核对「透传的 --home/--profile/--copy」。
 *
 * 环境变量：
 *   XUANSHU_STUB_LOG   记账目录（缺省不记账）
 *   XUANSHU_STUB_MODE  'fail-profile' → 退出 1（第 7 条的 exit 4 用）
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const opt = (name) => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}

const logDir = process.env.XUANSHU_STUB_LOG
if (logDir) {
  mkdirSync(logDir, { recursive: true })
  appendFileSync(join(logDir, 'install-profile.jsonl'), `${JSON.stringify({ ts: Date.now(), argv, cwd: process.cwd() })}\n`)
}

if (process.env.XUANSHU_STUB_MODE === 'fail-profile') {
  process.stderr.write('stub install-profile: refusing (XUANSHU_STUB_MODE=fail-profile)\n')
  process.exit(1)
}

const home = opt('--home') ?? process.env.DSH_HOME
const profile = opt('--profile') ?? 'xuanshu'
if (!home) {
  process.stderr.write('stub install-profile: --home is required\n')
  process.exit(1)
}

const target = join(home, 'profiles', profile)
mkdirSync(target, { recursive: true })
writeFileSync(join(target, 'package.json'), `${JSON.stringify({ name: `dsh-profile-${profile}`, version: '0.0.0', private: true, dsh: { profile: { bundles: [] } } }, undefined, 2)}\n`)
writeFileSync(join(target, '.stub-install-profile'), `${JSON.stringify({ argv, mode: opt('--copy') ? 'copy' : 'link' })}\n`)
process.stdout.write(`[stub-install-profile] mode=${opt('--copy') ? 'copy' : 'link'} home=${home} profile=${profile}\n`)
