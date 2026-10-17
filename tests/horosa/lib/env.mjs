/**
 * tests/horosa/lib/env.mjs — 子进程环境变量的**白名单式**构造。
 *
 * 为什么不能 `{...process.env}`：开发机上真的有 `DSH_HOME` / `HOROSA_*` / `XUANSHU_*`
 * （票 04/05 都往用户环境里写过），继承下去等于测「别人设的环境」；最坏情况是把真实
 * `~/.dsh`、真实 8765 当成目标。受管变量一律**先删再按需设**。
 *
 * 注意本票与票 05 的**同名不同义**变量：
 *   `XUANSHU_UVX_BIN` —— 票 05 指向它的假 uvx（doctor/install/serve 三合一），
 *   本票指向 `tests/horosa/fixtures/bin/uvx.mjs`（只回放 `serve` 生命周期 + 记账）。
 *   两张表都收进来，谁设了都会被删干净。
 */

/** 被测实现（宿主侧）认识的全部环境变量 = 契约 §3.2 R10 的测试注入口 + 票 05 的邻居。 */
export const MANAGED_ENV = [
  'DSH_HOME',
  'HOROSA_RUNTIME_ROOT',
  'HOROSA_RUNTIME_MIRROR',
  'HOROSA_SKILL_DATA_DIR',
  'HOROSA_SKILL_PORT',
  'HOROSA_SKILL_HOST',
  'XUANSHU_CACHE',
  'XUANSHU_DSH_HOME',
  'XUANSHU_PROFILE',
  'XUANSHU_CLI_BIN',
  'XUANSHU_UVX_BIN',
  'XUANSHU_HOROSA_WHEEL',
  'XUANSHU_SETUP_REPORT',
  'XUANSHU_HOROSA_DATA_DIR',
  'XUANSHU_HOROSA_AUTOSTART',
  'XUANSHU_HOROSA_PORT',
  'XUANSHU_E2E',
  'XUANSHU_SETUP_PIN',
  'XUANSHU_SKIP_PREFLIGHT',
  'XUANSHU_INSTALL_PROFILE_BIN',
  'XUANSHU_VERIFY_ASSEMBLY_BIN',
  // 替身自己的旋钮（本票）：
  'XUANSHU_FAKE_UVX_LOG',
  'XUANSHU_FAKE_UVX_MODE',
  'XUANSHU_FAKE_UVX_CONFIRM',
  // 票 05 的替身旋钮（不许漏：漏了就等于「先删再设」对它们不成立）：
  'XUANSHU_FAKE_UVX_STATE',
  'XUANSHU_FAKE_UVX_VERSION',
  'XUANSHU_FAKE_UVX_NO_SESSION',
  'XUANSHU_FAKE_UVX_BOTH_ENVELOPES',
  'XUANSHU_FAKE_UVX_GET_DELAY_MS',
  'XUANSHU_FAKE_UVX_GET_DELAY_TIMES',
  'XUANSHU_STUB_MODE',
  'XUANSHU_STUB_LOG',
]

/**
 * 造**子进程**环境：删掉全部受管变量，再套 `overrides`。
 * @param {Record<string, string|number|undefined>} overrides
 */
export function childEnv(overrides = {}) {
  const env = { ...process.env }
  for (const key of MANAGED_ENV) delete env[key]
  env.NODE_NO_WARNINGS = '1'
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key]
    else env[key] = String(value)
  }
  return env
}

/**
 * 造**同进程**环境：在被测模块（`process.env` 缺省值）读取前削掉受管变量。
 *
 * 为什么需要它：`resolveHorosaPaths({ env = process.env })`、`resolveHorosaPlan({ env = process.env })`
 * 这些签名缺省读 `process.env` —— 开发机上真有的 `HOROSA_RUNTIME_ROOT=C:\horosa` 会**静默**把用例
 * 变成「测真机」而不是「测注入点」。返回一个还原函数，`afterEach` 里调。
 */
export function isolateProcessEnv(overrides = {}) {
  const saved = new Map()
  for (const key of MANAGED_ENV) {
    saved.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined)
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) process.env[key] = String(value)
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
