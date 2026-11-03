import { CONSULT_SCENARIOS } from './consult.mjs'
import { EXCEPTION_SCENARIOS } from './consult-exceptions.mjs'
import { RESTART_SCENARIOS } from './consult-restart.mjs'
import { SAMPLE_SCENARIOS } from './consult-sample.mjs'
import { CONSULT_VISUAL_SCENARIOS } from './consult-visual.mjs'

/** 场景 id → 场景定义（`id` / `caseId` / `title` / `shots` / `run`）。 */
export const SCENARIOS = {
  ...CONSULT_SCENARIOS,
  ...SAMPLE_SCENARIOS,
  ...EXCEPTION_SCENARIOS,
  ...RESTART_SCENARIOS,
  ...CONSULT_VISUAL_SCENARIOS,
}

/** 场景 id 的稳定顺序（`--help` 与「未知场景」的报错都按它列，输出因此可比较）。 */
export const SCENARIO_IDS = Object.keys(SCENARIOS)
