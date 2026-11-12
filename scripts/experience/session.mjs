import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { createScout } from './run.mjs'

const { values } = parseArgs({
  options: { out: { type: 'string' }, 'playwright-dir': { type: 'string' } },
})
const reply = value => console.log(JSON.stringify(value))
const message = error => String(error.message).replace(/([?&]token=)[^\s"'&]+/gi, '$1[redacted]')

let scout
try {
  if (!values.out) throw new Error('Usage: node scripts/experience/session.mjs --out <new directory> [--playwright-dir <package>]')
  scout = await createScout({ out: values.out, playwrightDir: values['playwright-dir'] })
  reply({ ready: true })
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    try {
      const action = JSON.parse(line)
      if (action.type === 'close') break
      const result = action.type === 'verify-live' ? await scout.verifyLive() : await scout.perform(action)
      reply({ ok: true, result })
    } catch (error) {
      reply({ ok: false, error: message(error) })
    }
  }
} catch (error) {
  reply({ ok: false, error: message(error) })
  process.exitCode = 1
} finally {
  await scout?.close()
}
