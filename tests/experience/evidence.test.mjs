/**
 * tests/experience/evidence.test.mjs —— 证据记录器（Spec 04 · 票 #75）的判据台。
 *
 * 守的是「改前/改后两份报告能不能逐项比」这件事本身：
 *   1. 步骤行**确定性** —— 同一输入两跑字节完全相同，不含时间戳与绝对路径；
 *   2. 覆盖状态**复用判据词表**（`scripts/ux/judge.mjs` 的 `VERDICT_STATUSES`）+ `blocked`，
 *      旧词映射只此一份，未知状态报错而不是猜；
 *   3. 覆盖表每行**必须指向证据或阻塞理由**，同一 `caseId` 只能一行结论；
 *   4. 认证材料在 URL 与错误文档里**被脱敏**，错误文档只留最小字段；
 *   5. 证据目录形状 —— 只接受 `ux-reports/experience-<轮次>`，绝对路径与越界前缀一律拒。
 *
 * 断言面 = 纯结构的外部可观察物（返回值 / 抛出的错误类型与可读原因）。
 * **零浏览器、零网络、不写真实 home**（票 #75 验收标准第 9 条）；需要落盘的地方一律 `os.tmpdir()`。
 *
 * 范式来自 prior art：`tests/ux/project.test.mjs`（确定性写法）、`tests/ux/judge.test.mjs`
 * （状态词表边界）、`tests/ux/family-dc.test.mjs`（采集与判定分开测）、
 * `tests/lib/worktree-create.test.mjs`（临时目录 + 外部可观察物）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { VERDICT_STATUSES } from '../../scripts/ux/judge.mjs'
import {
  COVERAGE_STATUSES,
  EVIDENCE_FILES,
  EVIDENCE_ROOT,
  EXPERIENCE_DIR_PATTERN,
  EvidenceError,
  STEP_FIELDS,
  assertEvidenceDir,
  coverageDocument,
  errorsDocument,
  normalizeStatus,
  sanitizeUrl,
  stepLine,
} from '../../scripts/experience/evidence.mjs'

/** 抓到抛出的错误对象本身（要断言它的类型与消息内容，而不是只断言「会抛」）。 */
function capture(action) {
  try {
    action()
    return null
  } catch (caught) {
    return caught
  }
}

const REPO_ROOT = join(import.meta.dirname, '..', '..')

/**
 * 本文件加载时仓库里 `ux-reports/` 的有无。
 * 用例结束时必须还是这个值 —— 它证明「这一票的测试没在仓库里落证据」（AC9）。
 * 取样而不是写死 `false`：别的测试文件（`verify:ux` 那侧）本来就往这里写报告，
 * 写死会让本文件在别人之后跑时假红。
 */
const REPO_UX_REPORTS_EXISTED = existsSync(join(REPO_ROOT, 'ux-reports'))

/**
 * 同上，取样 `.experience-home/`：票 #77 的实操 runner 按设计保留体验 home（ADR-0017 第 4 条），
 * 所以「真跑过一次」之后这个目录在仓库里是正常状态。本文件能承诺的只是**自己不去造它**。
 */
const REPO_EXPERIENCE_HOME_EXISTED = existsSync(join(REPO_ROOT, '.experience-home'))

/** 一条合法步骤行的基准输入（各条用例只改自己要钉的那一处）。 */
function stepInput(overrides = {}) {
  return {
    step: 1,
    action: '打开自我总览',
    target: 'panel:overview',
    outcome: '出现四张卡片',
    ...overrides,
  }
}

describe('票 #75 · AC1 步骤行字段闭集固定，同一输入两跑字节完全相同', () => {
  it('字段闭集固定为 step/action/target/outcome/shot/note，并且同一输入两跑输出字节完全相同', () => {
    // 闭集的字面权威来自票据，不是模块自己 —— 免得「拿模块常量断言模块常量」空转。
    expect([...STEP_FIELDS]).toEqual(['step', 'action', 'target', 'outcome', 'shot', 'note'])

    const input = stepInput({
      step: 3,
      action: '点击「开始问事」',
      target: 'panel:consult',
      outcome: '界面切到问事面板，出现等待提示',
      shot: 'E03-step3.png',
      note: '按钮没有可见边框',
    })

    const first = stepLine(input)
    const second = stepLine({ ...input })

    // 确定性 = 两次调用产出的字符串逐字节相同（照 tests/ux/project.test.mjs 的幂等写法）。
    expect(second).toBe(first)
    // 字节级：连序列化出来的字符串本身也比长度/形状，键序漂了就红。
    expect(first).toBe(
      '{"step":3,"action":"点击「开始问事」","outcome":"界面切到问事面板，出现等待提示",'
      + '"target":"panel:consult","shot":"E03-step3.png","note":"按钮没有可见边框"}',
    )
    expect(Object.keys(JSON.parse(first)).sort()).toEqual([...STEP_FIELDS].sort())
    expect(first).not.toMatch(/\n/u)
  })

  it('调用方对象里的键序不影响输出（确定性不靠调用方自觉）', () => {
    const full = stepInput({ shot: 'E01-1.png', note: 'n' })
    const reordered = {
      note: full.note,
      shot: full.shot,
      outcome: full.outcome,
      target: full.target,
      action: full.action,
      step: full.step,
    }
    expect(stepLine(reordered)).toBe(stepLine(full))
  })
})

describe('票 #75 · AC2 步骤行不接受时间戳，也不接受带目录分隔符的截图路径', () => {
  it('带上时间戳字段（timestamp / at / time / ts / iso8601 / date）的步骤行被拒，且错误信息说清闭集', () => {
    for (const key of ['timestamp', 'at', 'time', 'ts', 'iso8601', 'date', 'finishedAt', 'duration']) {
      const line = stepInput({ [key]: '2026-11-02T23:05:28+08:00' })
      const error = capture(() => stepLine(line))
      expect(error, `多余键 ${key} 应当被拒`).toBeInstanceOf(EvidenceError)
      // 报错要说清是哪个键、闭集是什么，调用方才改得对（不是只丢一句「参数错」）。
      expect(error.message).toContain(key)
      expect(error.message).toContain(STEP_FIELDS.join(' / '))
    }
  })

  it('闭集内字段的形状照样要管：step 非正整数、action/outcome 空白、输入不是对象都报错', () => {
    const bad = [
      stepInput({ step: 0 }),
      stepInput({ step: '1' }),
      stepInput({ step: 1.5 }),
      stepInput({ action: '  ' }),
      stepInput({ action: 42 }),
      stepInput({ outcome: undefined }),
      stepInput({ target: '' }),
      stepInput({ shot: '' }),
      stepInput({ note: 42 }),
    ]
    for (const input of bad) {
      expect(capture(() => stepLine(input)), `非法输入应当报错：${JSON.stringify(input)}`).toBeInstanceOf(EvidenceError)
    }
    for (const input of [undefined, null, 'step', 42, [stepInput()]]) {
      expect(capture(() => stepLine(input)), `非对象输入应当报错：${String(input)}`).toBeInstanceOf(EvidenceError)
    }
    // 反面对照：最小合法行必须过，否则上面那一串只是永远为真。
    expect(() => stepLine(stepInput())).not.toThrow()
  })

  it('截图路径只要带目录分隔符（正斜杠或反斜杠）就被拒，纯文件名通过', () => {
    const rejected = [
      'shots/E03-step1.png',
      'shots\\E03-step1.png',
      'ux-reports/experience-round-01/shots/a.png',
      'C:\\Users\\someone\\a.png',
      '/tmp/a.png',
      './a.png',
      '../a.png',
      '\\a.png',
    ]
    for (const shot of rejected) {
      const error = (() => {
        try {
          stepLine(stepInput({ shot }))
          return null
        } catch (caught) {
          return caught
        }
      })()
      expect(error, `shot=「${shot}」应当被拒`).toBeInstanceOf(EvidenceError)
      expect(error.message).toMatch(/shot/u)
    }
    // 反面对照：纯文件名必须过，否则这条断言只是永远为真的空壳。
    expect(stepLine(stepInput({ shot: 'E03-step1.png' }))).toContain('E03-step1.png')
  })
})

describe('票 #75 · AC3 覆盖状态复用判据词表，旧词归一，未知状态报错而不是猜', () => {
  it('覆盖状态闭集 = 判据词表 + blocked（词表只有一份来源）', () => {
    expect(COVERAGE_STATUSES).toEqual([...VERDICT_STATUSES, 'blocked'])
    for (const status of VERDICT_STATUSES) {
      expect(normalizeStatus(status)).toBe(status)
    }
    expect(normalizeStatus('blocked')).toBe('blocked')
  })

  it('计划旧词按固定映射归一：passed→pass / failed→fail / not-run→not-collected / needs-human→human-only', () => {
    expect(normalizeStatus('passed')).toBe('pass')
    expect(normalizeStatus('failed')).toBe('fail')
    expect(normalizeStatus('not-run')).toBe('not-collected')
    expect(normalizeStatus('needs-human')).toBe('human-only')
    expect(normalizeStatus('blocked')).toBe('blocked')
  })

  it('未知状态抛 EvidenceError，错误信息带上可读原因与可接受词表', () => {
    for (const status of ['ok', 'PASSED', 'skip', 'partial', '通过', 'not_run', 'needsHuman']) {
      const attempt = () => {
        try {
          normalizeStatus(status)
          return null
        } catch (caught) {
          return caught
        }
      }
      const error = attempt()
      expect(error, `状态「${status}」应当报错而不是被猜成某个词`).toBeInstanceOf(EvidenceError)
      expect(error.name).toBe('EvidenceError')
      // 报错要说清「只接受哪些」，否则调用方无从修正。
      expect(error.message).toContain(status)
      expect(error.message).toMatch(/pass/u)
      expect(error.message).toMatch(/blocked/u)
    }
  })

  it('非字符串或空白的状态也报错（不把它当成「未采到」放过）', () => {
    for (const status of ['', '   ', null, undefined, 42, {}, ['pass']]) {
      expect(() => normalizeStatus(status), `状态「${String(status)}」应当报错`).toThrow(EvidenceError)
    }
  })
})

describe('票 #75 · AC4 覆盖表每行必须指向证据或阻塞理由', () => {
  it('pass / fail 缺 evidence 报错，报错信息点名 caseId 与缺的那一半', () => {
    for (const status of ['pass', 'fail', 'passed', 'failed']) {
      const attempt = () => {
        try {
          coverageDocument([{ caseId: 'E01', status }])
          return null
        } catch (caught) {
          return caught
        }
      }
      const error = attempt()
      expect(error, `${status} 没给 evidence 应当报错`).toBeInstanceOf(EvidenceError)
      expect(error.message).toContain('E01')
      expect(error.message).toContain('evidence')
    }
  })

  it('blocked / not-collected / collection-failed / human-only 缺 reason 报错', () => {
    const noEvidenceNeeded = ['blocked', 'not-collected', 'collection-failed', 'human-only', 'not-run', 'needs-human']
    for (const status of noEvidenceNeeded) {
      const attempt = () => {
        try {
          coverageDocument([{ caseId: 'E02', status }])
          return null
        } catch (caught) {
          return caught
        }
      }
      const error = attempt()
      expect(error, `${status} 没给 reason 应当报错`).toBeInstanceOf(EvidenceError)
      expect(error.message).toContain('E02')
      expect(error.message).toContain('reason')
    }
  })

  it('空白字符串不算给了证据/理由（空壳不能蒙过这一半）', () => {
    expect(() => coverageDocument([{ caseId: 'E03', status: 'pass', evidence: '   ' }])).toThrow(EvidenceError)
    expect(() => coverageDocument([{ caseId: 'E04', status: 'blocked', reason: '' }])).toThrow(EvidenceError)
  })

  it('给齐了才产出行：pass 带 evidence、blocked 带 reason，旧词落的是判据词，totals 逐状态计数', () => {
    const document = coverageDocument([
      { caseId: 'E01', status: 'passed', evidence: 'E01-step2.png', scenario: '问事', lastStep: '2' },
      { caseId: 'E02', status: 'not-run', reason: '未配模型，走不到这一步' },
      { caseId: 'E03', status: 'blocked', reason: 'horosa 未起' },
    ])
    expect(document.schema).toBe('xuanshu/experience-coverage@1')
    expect(document.cases.map((row) => row.status)).toEqual(['pass', 'not-collected', 'blocked'])
    expect(document.cases[0].evidence).toBe('E01-step2.png')
    expect(document.cases[0].scenario).toBe('问事')
    expect(document.cases[0].lastStep).toBe('2')
    // 不该混进对面的那一半：pass 行不带 reason，未通过行不带 evidence。
    expect('reason' in document.cases[0]).toBe(false)
    expect('evidence' in document.cases[1]).toBe(false)
    expect(document.cases[1].reason).toBe('未配模型，走不到这一步')
    expect(document.totals).toEqual({
      pass: 1,
      fail: 0,
      'not-collected': 1,
      'collection-failed': 0,
      'human-only': 0,
      blocked: 1,
    })
    expect(Object.keys(document.totals)).toEqual([...COVERAGE_STATUSES])
  })

  it('coverageDocument 不是数组直接报错；缺 caseId 也报错', () => {
    expect(() => coverageDocument(undefined)).toThrow(EvidenceError)
    expect(() => coverageDocument('E01')).toThrow(EvidenceError)
    expect(() => coverageDocument([{ status: 'pass', evidence: 'a.png' }])).toThrow(EvidenceError)
    expect(() => coverageDocument([null])).toThrow(EvidenceError)
  })
})

describe('票 #75 · AC5 同一个用例只能有一行结论', () => {
  it('同一 caseId 重复出现报错，信息点名重复的 caseId', () => {
    const attempt = () => {
      try {
        coverageDocument([
          { caseId: 'E01', status: 'pass', evidence: 'a.png' },
          { caseId: 'E01', status: 'fail', evidence: 'b.png' },
        ])
        return null
      } catch (caught) {
        return caught
      }
    }
    const error = attempt()
    expect(error).toBeInstanceOf(EvidenceError)
    expect(error.message).toContain('E01')
  })

  it('同一个 caseId 换写法（多余空格 / 旧词与判据词混用）也算重复 —— 一条用例只有一个结论', () => {
    expect(() => coverageDocument([
      { caseId: 'E01', status: 'pass', evidence: 'a.png' },
      { caseId: ' E01 ', status: 'passed', evidence: 'b.png' },
    ])).toThrow(EvidenceError)
  })
})

describe('票 #75 · AC6 URL 里的一次性凭据参数值被替换为占位符', () => {
  // 六个参数名（ADR-0017「脱敏」段）× 三种起始位置（`?` / `&` / 片段里的 `?`）。
  const SENSITIVE = ['token', 'access_token', 'code', 'key', 'secret', 'password']

  it('每个敏感参数名在 ? 起始与 & 起始两种位置上都被替换为占位符', () => {
    for (const name of SENSITIVE) {
      const secret = `SECRET-${name}`
      for (const url of [
        `http://127.0.0.1:53124/?${name}=${secret}`,
        `http://127.0.0.1:53124/?x=1&${name}=${secret}`,
        `http://127.0.0.1:53124/?a=1&${name}=${secret}&b=2`,
      ]) {
        const out = sanitizeUrl(url)
        expect(out, `凭据没被去掉：${url}`).not.toContain(secret)
        expect(out).toContain(`${name}=<redacted>`)
      }
    }
  })

  it('参数名大小写不敏感（TOKEN / Token / AccessToken 都算）', () => {
    for (const name of ['TOKEN', 'Token', 'tOkEn', 'ACCESS_TOKEN', 'Access_Token', 'PASSWORD', 'Key']) {
      const out = sanitizeUrl(`http://h/p?${name}=Sup3rSecret`)
      expect(out, `大小写变体没被脱敏：${name}`).not.toContain('Sup3rSecret')
      expect(out).toMatch(/=<redacted>/u)
    }
  })

  it('值里带 # 片段时只脱到 # 之前，片段本身原样保留', () => {
    const out = sanitizeUrl('http://127.0.0.1:1/?token=ABC123#/consult?x=1')
    expect(out).toBe('http://127.0.0.1:1/?token=<redacted>#/consult?x=1')
  })

  it('哈希路由里带的凭据也被脱敏（#/path?token=… 与 #token=…）', () => {
    expect(sanitizeUrl('http://h/#/consult?token=ABC123')).toBe('http://h/#/consult?token=<redacted>')
    expect(sanitizeUrl('http://h/#token=ABC123')).toBe('http://h/#token=<redacted>')
  })

  it('非敏感参数原样保留，参数名前后缀不误伤（apikey / tokens / ?x=1&y=2）', () => {
    const untouched = [
      'http://h/p?apikey=abc',
      'http://h/p?tokens=abc',
      'http://h/p?my_key=abc',
      'http://h/p?x=1&y=2',
      'http://h/p?panel=consult',
    ]
    for (const url of untouched) {
      expect(sanitizeUrl(url)).toBe(url)
    }
  })

  it('脱敏可重复执行（幂等）：对已脱敏的结果再跑一次字节相同', () => {
    const once = sanitizeUrl('http://h/p?token=ABC&secret=XYZ#/x')
    expect(sanitizeUrl(once)).toBe(once)
  })

  it('一条 URL 里的多个凭据参数全部脱掉（不是只脱第一个）', () => {
    const out = sanitizeUrl('http://h/p?a=1&token=T1&secret=S2&code=C3&key=K4&password=P2&access_token=A2&z=9')
    expect(out).toBe('http://h/p?a=1&token=<redacted>&secret=<redacted>&code=<redacted>&key=<redacted>&password=<redacted>&access_token=<redacted>&z=9')
    for (const secret of ['T1', 'S2', 'C3', 'K4', 'P2', 'A2']) {
      expect(out).not.toContain(secret)
    }
  })

  it('空值参数也被替换；非字符串输入报错而不是猜', () => {
    expect(sanitizeUrl('http://h/p?token=')).toBe('http://h/p?token=<redacted>')
    expect(() => sanitizeUrl(undefined)).toThrow(EvidenceError)
    expect(() => sanitizeUrl(42)).toThrow(EvidenceError)
    expect(() => sanitizeUrl({ token: 'x' })).toThrow(EvidenceError)
  })
})

describe('票 #75 · AC7 错误文档只留能定位的最小字段', () => {
  /** 把整份文档序列化后拿去查禁词：字段名和值一起查，才算真没留。 */
  const flatten = (document) => JSON.stringify(document)

  it('四类错误各归其位，每行只有 kind / message / step，并给出总数', () => {
    const document = errorsDocument({
      consoleErrors: ['Failed to load resource'],
      pageErrors: [{ message: 'Uncaught TypeError', step: 4 }],
      requestFailures: ['net::ERR_ABORTED'],
      httpErrors: ['500 Internal Server Error'],
    })
    expect(document.console).toEqual([{ kind: 'console', message: 'Failed to load resource' }])
    expect(document.page).toEqual([{ kind: 'page', message: 'Uncaught TypeError', step: 4 }])
    expect(document.requestFailed).toEqual([{ kind: 'request', message: 'net::ERR_ABORTED' }])
    expect(document.http).toEqual([{ kind: 'http', message: '500 Internal Server Error' }])
    expect(document.total).toBe(4)

    for (const rows of [document.console, document.page, document.requestFailed, document.http]) {
      for (const row of rows) {
        expect(Object.keys(row).sort()).toContain('kind')
        expect(Object.keys(row).filter((key) => key !== 'step')).toEqual(['kind', 'message'].sort())
      }
    }
  })

  it('堆栈与完整请求头不进文档：给了 stack / headers 等 message·step 之外的字段就报错，并点名那个字段', () => {
    for (const key of ['stack', 'stackTrace', 'headers', 'requestHeaders', 'responseHeaders', 'url', 'location']) {
      const attempt = () => {
        try {
          errorsDocument({ pageErrors: [{ message: 'boom', step: 2, [key]: 'LEAK' }] })
          return null
        } catch (caught) {
          return caught
        }
      }
      const error = attempt()
      expect(error, `多余键 ${key} 应当报错，而不是被静默丢掉`).toBeInstanceOf(EvidenceError)
      expect(error.message).toContain(key)
      expect(flatten({ error: error.message })).not.toContain('LEAK')
    }
  })

  it('字符串消息里带堆栈帧时只留消息本身，堆栈行被剥掉', () => {
    const document = errorsDocument({
      consoleErrors: ['TypeError: cannot read x\n    at foo (http://h/app.js:10:3)\n    at bar (http://h/app.js:20:1)'],
    })
    expect(document.console).toHaveLength(1)
    expect(document.console[0].message).toBe('TypeError: cannot read x')
    expect(flatten(document)).not.toMatch(/\bat\s+foo/u)
  })

  it('消息也走过脱敏：URL 凭据出现在 console/page/request/http 四类消息里都被替换', () => {
    const document = errorsDocument({
      consoleErrors: ['GET http://127.0.0.1:53124/?token=LEAK1 401'],
      pageErrors: [{ message: 'open http://h/p?a=1&secret=LEAK2', step: 1 }],
      requestFailures: ['failed http://h/x#/y?code=LEAK3'],
      httpErrors: ['401 http://h/p?password=LEAK4'],
    })
    const text = flatten(document)
    for (const secret of ['LEAK1', 'LEAK2', 'LEAK3', 'LEAK4']) {
      expect(text, `凭据「${secret}」没被脱敏`).not.toContain(secret)
    }
    expect(document.console[0].message).toContain('token=<redacted>')
    expect(document.page[0].message).toContain('secret=<redacted>')
    expect(document.requestFailed[0].message).toContain('code=<redacted>')
    expect(document.http[0].message).toContain('password=<redacted>')
  })

  it('step 给了必须是 ≥1 的整数；非法值报错而不是猜第几步', () => {
    for (const step of [0, -1, 1.5, '2', null]) {
      expect(() => errorsDocument({ pageErrors: [{ message: 'boom', step }] }), `step=${String(step)}`).toThrow(EvidenceError)
    }
    // 反面对照：合法 step 必须过。
    expect(errorsDocument({ pageErrors: [{ message: 'boom', step: 7 }] }).page[0].step).toBe(7)
  })

  it('空输入得到空文档（不提前填内容）；四类全空时 total 为 0', () => {
    const document = errorsDocument()
    expect(document).toEqual({ console: [], page: [], requestFailed: [], http: [], total: 0 })
    expect(errorsDocument({}).total).toBe(0)
  })

  it('同一组错误两跑字节相同（确定性覆盖到错误文档）', () => {
    const input = {
      consoleErrors: ['b msg', 'a msg'],
      pageErrors: [{ message: 'z', step: 9 }, { message: 'y', step: 3 }],
    }
    expect(JSON.stringify(errorsDocument(input))).toBe(JSON.stringify(errorsDocument(input)))
  })
})

describe('票 #75 · AC8 证据目录只接受「报告根下的一轮评估」', () => {
  it('接受轮次目录的正常写法（含反斜杠与结尾斜杠，返回归一后的相对路径）', () => {
    expect(assertEvidenceDir('ux-reports/experience-round-01')).toBe('ux-reports/experience-round-01')
    expect(assertEvidenceDir('ux-reports\\experience-round-01')).toBe('ux-reports/experience-round-01')
    expect(assertEvidenceDir('ux-reports/experience-round-01/')).toBe('ux-reports/experience-round-01')
    expect(assertEvidenceDir('ux-reports/experience-e01')).toBe('ux-reports/experience-e01')
  })

  it('绝对路径一律被拒：Windows 盘符、POSIX 根、UNC 共享', () => {
    const absolute = [
      'C:\\Users\\someone\\ux-reports\\experience-round-01',
      'C:/ux-reports/experience-round-01',
      'e:\\ai_project\\XuanShu\\ux-reports\\experience-round-01',
      '/tmp/ux-reports/experience-round-01',
      '/ux-reports/experience-round-01',
      '\\\\server\\share\\experience-round-01',
    ]
    for (const out of absolute) {
      const error = capture(() => assertEvidenceDir(out))
      expect(error, `绝对路径应当被拒：${out}`).toBeInstanceOf(EvidenceError)
      expect(error.message).toMatch(/绝对路径|相对仓库根/u)
    }
  })

  it('越界前缀 `..` 一律被拒（它会把证据写到仓库外面去）', () => {
    const escaping = [
      '../ux-reports/experience-round-01',
      '..',
      '../..',
      'ux-reports/../experience-round-01',
      'ux-reports/experience-round-01/../../..',
      'ux-reports\\..\\.experience-home',
    ]
    for (const out of escaping) {
      expect(capture(() => assertEvidenceDir(out)), `越界前缀应当被拒：${out}`).toBeInstanceOf(EvidenceError)
    }
  })

  it('写进源码树或真实 home 的路径全被拒（scripts / profile / .experience-home / ~）', () => {
    const wrongHome = [
      'scripts/experience',
      'profile/cordis.yml',
      'docs/design/ui-v1',
      '.experience-home',
      '.experience-home/ux-reports/experience-round-01',
      'ux-reports',
      'ux-reports/experience-',
      'ux-reports/experience-Round-01',
      'ux-reports/round-01',
      'reports/experience-round-01',
      'ux-reports/experience-round-01/shots',
      '~/.xuanshu',
      'home',
    ]
    for (const out of wrongHome) {
      expect(capture(() => assertEvidenceDir(out)), `不是轮次目录的形状，应当被拒：${out}`).toBeInstanceOf(EvidenceError)
    }
  })

  it('非字符串与空白输入报错，不返回「勉强算过」的路径', () => {
    for (const out of ['', '   ', null, undefined, 42, {}, ['ux-reports/experience-a']]) {
      expect(capture(() => assertEvidenceDir(out)), `收到 ${String(out)}`).toBeInstanceOf(EvidenceError)
    }
  })

  it('报告根与被忽略的目录一致：EVIDENCE_ROOT 就是模式里的前缀（两处不许各写各的）', () => {
    expect(EVIDENCE_ROOT).toBe('ux-reports')
    // 行为口径：拿 EVIDENCE_ROOT 拼出来的轮次目录必须过；换个根名必须不过。
    expect(assertEvidenceDir(`${EVIDENCE_ROOT}/experience-round-01`)).toBe('ux-reports/experience-round-01')
    expect(capture(() => assertEvidenceDir(`other-root/experience-round-01`))).toBeInstanceOf(EvidenceError)
    // 常量口径：模式的字面前缀就是 EVIDENCE_ROOT（正则源里 `/` 带转义）。
    expect(EXPERIENCE_DIR_PATTERN.source.startsWith(`^${EVIDENCE_ROOT}\\/`)).toBe(true)
    // 固定文件名不许漂（报告与复测脚本按这些名字取）。
    expect(Object.values(EVIDENCE_FILES).sort()).toEqual(
      ['coverage.json', 'environment.json', 'errors.json', 'findings.md', 'steps.jsonl', 'trace.zip'].sort(),
    )
  })
})

describe('票 #75 · AC9 全部用临时目录，零浏览器、零网络', () => {
  const made = []

  /** 临时「报告根」：系统临时目录下的 ux-reports/experience-<轮次>，绝不碰仓库源码树。 */
  function tempEvidenceDir(round) {
    const root = mkdtempSync(join(tmpdir(), 'evidence-ticket75-'))
    made.push(root)
    const dir = join(root, EVIDENCE_ROOT, `experience-${round}`)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  afterEach(() => {
    while (made.length > 0) {
      rmSync(made.pop(), { recursive: true, force: true })
    }
  })

  it('把步骤行与两份文档真的写进临时证据目录再读回来：换目录重写后字节相同', () => {
    // 目录名经过同一套形状断言：写的地方就是断言认可的地方，不是另造一份口径。
    const relative = `${EVIDENCE_ROOT}/experience-round-01`
    expect(assertEvidenceDir(relative)).toBe(relative)

    const steps = [
      stepLine(stepInput({ step: 1, action: '打开自我总览', outcome: '四张卡片', shot: 'E01-1.png' })),
      stepLine(stepInput({ step: 2, action: '选谱', target: '谱·仕途', outcome: '出现已选标记' })),
    ]
    const coverage = coverageDocument([
      { caseId: 'E01', status: 'passed', evidence: 'E01-1.png' },
      { caseId: 'E07', status: 'blocked', reason: '未配模型' },
    ])
    const errors = errorsDocument({
      consoleErrors: ['GET http://127.0.0.1:53124/?token=LEAKME 401'],
      pageErrors: [{ message: 'Uncaught Error', step: 2 }],
    })

    const writeAll = (target) => {
      writeFileSync(join(target, EVIDENCE_FILES.steps), `${steps.join('\n')}\n`, 'utf8')
      writeFileSync(join(target, EVIDENCE_FILES.coverage), `${JSON.stringify(coverage, null, 2)}\n`, 'utf8')
      writeFileSync(join(target, EVIDENCE_FILES.errors), `${JSON.stringify(errors, null, 2)}\n`, 'utf8')
    }

    const dir = tempEvidenceDir('round-01')
    writeAll(dir)
    const stepsBytes = readFileSync(join(dir, EVIDENCE_FILES.steps))

    // 换一份临时目录（等价于「另一台机器 / 另一轮」）重写：产物逐字节相同，才谈得上跨轮逐项比。
    const again = tempEvidenceDir('round-02')
    writeAll(again)
    expect(readFileSync(join(again, EVIDENCE_FILES.steps))).toEqual(stepsBytes)
    expect(readFileSync(join(again, EVIDENCE_FILES.coverage), 'utf8'))
      .toBe(readFileSync(join(dir, EVIDENCE_FILES.coverage), 'utf8'))
    // 落盘的内容里没有凭据。
    expect(readFileSync(join(dir, EVIDENCE_FILES.errors), 'utf8')).not.toContain('LEAKME')

    // 写的位置在系统临时目录里，不在仓库源码树，也不叫「真实 home」那个名字。
    // （Windows 的 tmpdir 本身就在用户目录下，所以这里钉的是「在 temp 根下、不在仓库里」，
    //  不碰日常数据 home 由「模块零 fs 依赖」+「仓库里没多出目录」两条一起兜。）
    const tempRoot = realpathSync.native(tmpdir())
    expect(realpathSync.native(dir).startsWith(tempRoot)).toBe(true)
    expect(dir).not.toContain(REPO_ROOT)
    expect(dir).not.toContain('.experience-home')
  })

  it('记录器是纯结构：源码里没有浏览器 / 网络 / 子进程 / 时钟 / 环境变量依赖', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts/experience/evidence.mjs'), 'utf8')
    for (const banned of [
      'node:fs', 'node:http', 'node:https', 'node:net', 'node:tls', 'node:dns',
      'node:child_process', 'node:worker_threads', 'playwright',
    ]) {
      expect(source, `证据记录器不该用到 ${banned}`).not.toMatch(new RegExp(`from '${banned}'`, 'u'))
    }
    // 时钟一进来，两份报告就再也无法逐项比（AC1 的根）。
    expect(source).not.toMatch(/Date\.now\(/u)
    expect(source).not.toMatch(/new Date\(/u)
    expect(source).not.toMatch(/process\.env/u)
    expect(source).not.toMatch(/\bfetch\(/u)
  })

  it('这一票的用例没在仓库里造出证据目录，也没碰真实 home', () => {
    // REPO_UX_REPORTS_EXISTED 在本文件加载时取样：用例跑完，仓库里那个目录的有无不许变化。
    expect(existsSync(join(REPO_ROOT, EVIDENCE_ROOT))).toBe(REPO_UX_REPORTS_EXISTED)
    // `.experience-home/` 同理取样，不写死 `false`：票 #77 的 runner **按设计保留**体验 home
    // （ADR-0017 第 4 条：「持久」= home 与数据跨轮复用），一次真跑之后它本来就在。
    // 这里要钉的是「本文件的用例没自己造出它」，而不是「仓库里永远不许有它」。
    expect(existsSync(join(REPO_ROOT, '.experience-home'))).toBe(REPO_EXPERIENCE_HOME_EXISTED)
  })
})
