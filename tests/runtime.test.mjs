import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'

const rules = [{ keywords: ['review'], route: { provider: 'test-provider', model: 'test-model' } }]

test('the package entry loads and routes in the JavaScript runtime', async () => {
  const { apply } = await import('dsh-agent-router')
  let restore
  const original = async spec => spec
  const ctx = {
    subagents: { startActivation: original },
    effect(disposer) {
      restore = disposer()
      return () => { restore = undefined }
    },
  }

  apply(ctx, { rules })
  const spec = { label: 'review', request: { prompt: 'inspect this' } }
  const routed = await ctx.subagents.startActivation(spec)

  assert.equal(routed.request.agentOptions.provider, 'test-provider')
  assert.equal(routed.request.agentOptions.model, 'test-model')
  assert.deepEqual(spec, { label: 'review', request: { prompt: 'inspect this' } })
  assert.equal(typeof restore, 'function')
  restore()
  assert.equal(ctx.subagents.startActivation, original)
})

// The real-loader tests need an installed DSH. Set DSH_NODE_MODULES to its
// node_modules directory; otherwise a global @deepseek-ai/dsh install is looked
// up (local resolution, `npm root -g`, then two conventional prefixes) and the
// tests are skipped when none is found (CI without DSH).
function findDshNodeModules() {
  if (process.env.DSH_NODE_MODULES) return process.env.DSH_NODE_MODULES
  const candidates = []
  try {
    const require = createRequire(import.meta.url)
    candidates.push(join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'node_modules'))
  } catch {}
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    candidates.push(join(globalRoot, '@deepseek-ai/dsh/node_modules'))
  } catch {}
  const home = process.env.HOME ?? ''
  candidates.push(
    join(home, '.local/lib/node_modules/@deepseek-ai/dsh/node_modules'),
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules',
  )
  return candidates.find(existsSync)
}

const dshRoot = findDshNodeModules()
const skip = dshRoot ? false : 'DSH not installed (set DSH_NODE_MODULES)'

async function realLoader() {
  const { Context } = await import(`${dshRoot}/@deepseek-ai/cordis/lib/index.js`)
  const { Loader } = await import(`${dshRoot}/@deepseek-ai/cordis-plugin-loader/lib/index.js`)
  const ctx = new Context()
  const loaderFiber = ctx.plugin(Loader, { baseUrl: new URL('../', import.meta.url).href })
  await loaderFiber.await()
  return { ctx, loaderFiber }
}

test('the DSH loader waits for subagents before activating the plugin', { skip }, async () => {
  const { ctx, loaderFiber } = await realLoader()

  await ctx.loader.create({ id: 'agent-router', name: 'dsh-agent-router', config: { rules } })

  const original = async spec => spec
  const subagents = { startActivation: original }
  assert.equal(subagents.startActivation, original)

  ctx.provide('subagents', subagents)
  const entry = ctx.loader.resolve('agent-router')
  await entry.fiber.await()

  const routed = await subagents.startActivation({ label: 'review', request: { prompt: 'inspect this' } })
  assert.equal(routed.request.agentOptions.provider, 'test-provider')
  assert.equal(routed.request.agentOptions.model, 'test-model')

  await entry.fiber.dispose()
  assert.equal(subagents.startActivation, original)
  await loaderFiber.dispose()
})

test('the DSH loader rejects a malformed rule instead of wrapping activation', { skip }, async () => {
  const { ctx, loaderFiber } = await realLoader()
  const original = async spec => spec
  const subagents = { startActivation: original }
  ctx.provide('subagents', subagents)

  await ctx.loader.create({
    id: 'agent-router',
    name: 'dsh-agent-router',
    config: { rules: [{ match: 'smoke', provider: 'p', model: 'm' }] },
  })
  const entry = ctx.loader.resolve('agent-router')
  await assert.rejects(entry.fiber.await(), /rules\.0\.match/)
  assert.equal(subagents.startActivation, original)

  await loaderFiber.dispose()
})
