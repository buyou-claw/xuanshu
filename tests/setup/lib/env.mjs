/**
 * tests/setup/lib/env.mjs — 子进程环境变量的**白名单式**构造。
 *
 * 为什么不能直接 `{...process.env}`：开发机上真的有 `DSH_HOME` / `HOROSA_RUNTIME_ROOT` /
 * `XUANSHU_*` 这些变量（票 04/05 都往用户环境里写过），继承下去会让断言台测到「别人设的环境」，
 * 而且最坏情况是某个用例把真实 `~/.dsh` 当成目标。所有受管变量一律**先删再按需设**。
 */

/** 被测实现认识的全部环境变量（契约 §2/§3.4/§10 + setup-core 已回报的注入点）。 */
export const MANAGED_ENV = [
  'DSH_HOME',
  'HOROSA_RUNTIME_ROOT',
  'HOROSA_RUNTIME_MIRROR',
  'HOROSA_SKILL_DATA_DIR',
  'HOROSA_SKILL_PORT',
  'HOROSA_SKILL_HOST',
  'XUANSHU_CACHE',
  'XUANSHU_DSH_HOME',
  'XUANSHU_HOROSA_PORT',
  'XUANSHU_PROFILE',
  'XUANSHU_CLI_BIN',
  'XUANSHU_UVX_BIN',
  'XUANSHU_SETUP_PIN',
  'XUANSHU_SKIP_PREFLIGHT',
  'XUANSHU_INSTALL_PROFILE_BIN',
  'XUANSHU_VERIFY_ASSEMBLY_BIN',
  'XUANSHU_FAKE_UVX_STATE',
  'XUANSHU_FAKE_UVX_MODE',
  'XUANSHU_FAKE_UVX_VERSION',
]

/**
 * 造子进程环境：删掉全部受管变量，再套 `overrides`。
 * @param {Record<string, string|undefined>} overrides
 */
export function childEnv(overrides = {}) {
  const env = { ...process.env }
  for (const key of MANAGED_ENV) delete env[key]
  // 关掉 node 自己的告警噪声：断言台只看被测进程的行为，不看 node 的弃用提醒。
  env.NODE_NO_WARNINGS = '1'
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key]
    else env[key] = String(value)
  }
  return env
}
