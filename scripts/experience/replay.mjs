import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { createScout } from './run.mjs'

function* combinations(values, count, offset = 0, prefix = []) {
  if (count === 0) {
    yield prefix
    return
  }
  for (let index = offset; index <= values.length - count; index += 1) {
    yield* combinations(values, count - 1, index + 1, [...prefix, values[index]])
  }
}

const { values } = parseArgs({
  options: { spec: { type: 'string' }, out: { type: 'string' }, 'playwright-dir': { type: 'string' } },
})
if (!values.spec || !values.out) {
  throw new Error('Usage: node scripts/experience/replay.mjs --spec <file> --out <new directory> [--playwright-dir <package>]')
}

const specPath = resolve(values.spec)
const spec = JSON.parse(await readFile(specPath, 'utf8'))
const source = resolve(dirname(specPath), spec.stepsFile)
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const original = await readJson(join(dirname(source), 'environment.json'))
const recorded = (await readFile(source, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line))
const actions = new Map(recorded.filter(row => row.event === 'finish').map(row => [row.step, row.action]))
const { prelude = [], steps, checks, registryCount, maxCandidates = 30, viewport, unreachableWhen = {} } = spec
const required = spec.required ?? steps?.slice(-1)
if (!Array.isArray(steps) || steps.length === 0 || steps.length > 16 ||
    !Array.isArray(checks) || checks.length === 0 ||
    !Array.isArray(required) || !required.length || required.some(id => !steps.includes(id)) ||
    !Number.isInteger(maxCandidates) || maxCandidates < 0 ||
    new Set([...prelude, ...steps]).size !== prelude.length + steps.length ||
    [...prelude, ...steps].some(step => !actions.has(step))) {
  throw new Error('Replay needs completed action IDs, checks, and a nonnegative candidate budget')
}

const out = resolve(values.out)
await mkdir(out)
await writeFile(join(out, 'spec.json'), JSON.stringify({ ...spec, stepsFile: source }, null, 2) + '\n')
const attempts = []
const summary = { attempts, verdict: 'running', shortestCandidate: null, allShorterExcluded: false }
async function save() {
  await writeFile(join(out, 'replay.json'), JSON.stringify(summary, null, 2) + '\n')
}

async function attempt(kind, sequence) {
  const dir = `${String(attempts.length + 1).padStart(2, '0')}-${kind}`
  const row = { kind, dir, steps: sequence, outcome: 'inconclusive', checks: [] }
  attempts.push(row)
  await save()
  let scout
  try {
    scout = await createScout({ out: join(out, dir), playwrightDir: values['playwright-dir'], viewport })
    const environment = await readJson(join(out, dir, 'environment.json'))
    for (const key of ['commit', 'clientSha256', 'criteriaVersion', 'edge', 'playwright', 'viewport', 'colorScheme']) {
      if (JSON.stringify(environment[key]) !== JSON.stringify(original[key])) throw new Error(`Replay environment differs: ${key}`)
    }
    for (const id of [...prelude, ...sequence]) {
      row.lastAttemptedSourceStep = id
      try {
        const result = await scout.perform(actions.get(id))
        if (result.matches === false) throw new Error(`Recorded precondition failed at step ${id}`)
      } catch (error) {
        const witnesses = unreachableWhen[id]
        if (error.name !== 'TimeoutError' || !witnesses?.length) throw error
        row.reachability = []
        for (const check of witnesses) {
          const result = await scout.perform({ ...check, type: 'check' })
          row.reachability.push({ ...check, matches: result.matches, screenshot: result.screenshot })
        }
        if (!row.reachability.every(check => check.matches)) throw error
        row.outcome = 'unreachable'
        row.error = String(error.message).replace(/([?&]token=)[^\s"'&]+/gi, '$1[redacted]')
        break
      }
    }
    if (row.outcome !== 'unreachable') {
      for (const check of checks) {
        const result = await scout.perform({ ...check, type: 'check' })
        row.checks.push({ ...check, matches: result.matches, screenshot: result.screenshot })
      }
      if (registryCount !== undefined) {
        const { rows } = await scout.perform({ type: 'registry', reason: 'Verify the same persistence condition as the original observation' })
        row.registry = { expected: registryCount, actual: rows.length }
      }
      row.outcome = row.checks.every(check => check.matches) && (!row.registry || row.registry.actual === row.registry.expected)
        ? 'matched' : 'different'
    }
  } catch (error) {
    row.error = String(error.message).replace(/([?&]token=)[^\s"'&]+/gi, '$1[redacted]')
  } finally {
    try {
      await scout?.close()
    } catch (error) {
      row.outcome = 'inconclusive'
      row.cleanupError = String(error.message)
    }
    await save()
    console.log(JSON.stringify({ ...row, error: row.error?.split('\n')[0] }))
  }
  return row.outcome
}

const full = [await attempt('full', steps), await attempt('full', steps)]
if (full.every(result => result === 'matched')) {
  const removable = steps.filter(id => !required.includes(id))
  let best = steps
  let tried = 0
  minimize: for (let size = 0; size < removable.length; size += 1) {
    for (const subset of combinations(removable, size)) {
      if (tried >= maxCandidates) break minimize
      tried += 1
      const candidate = steps.filter(id => required.includes(id) || subset.includes(id))
      if (await attempt('candidate', candidate) === 'matched') {
        best = candidate
        break minimize
      }
    }
  }
  summary.shortestCandidate = best
  summary.allShorterExcluded = attempts.filter(row => row.steps.length < best.length).every(row => ['different', 'unreachable'].includes(row.outcome))
    && (best !== steps || tried === (2 ** removable.length) - 1)
  const repeat = best === steps ? 'matched' : await attempt('confirm', best)
  summary.verdict = repeat === 'matched' ? 'stable-match' : repeat === 'different' ? 'intermittent-candidate' : 'inconclusive-candidate'
} else {
  summary.verdict = full.includes('matched') && full.includes('different') ? 'intermittent' : 'not-confirmed'
}
await save()
if (summary.verdict !== 'stable-match') process.exitCode = 1
