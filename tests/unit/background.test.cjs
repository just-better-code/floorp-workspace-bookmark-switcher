const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { test } = require('node:test')
const source = fs.readFileSync(path.join(__dirname, '../../background.js'), 'utf8')
const flush = () => new Promise(resolve => setImmediate(resolve))

function setup(api, storage = new Map()) {
  const errors = []
  const tabs = []
  vm.runInNewContext(source, {
    browser: {
      floorpWorkspaceBars: api,
      runtime: { getURL: file => `moz-extension://test/${file}` },
      tabs: { async create(tab) { tabs.push(tab) } },
    },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    console: { error(error) { errors.push(String(error)) } },
  })
  return { errors, tabs }
}

test('background starts only the Floorp workspace integration', async () => {
  let starts = 0
  const { errors, tabs } = setup({ getCompatibility: async () => ({ supported: true }), start: async () => { starts++ } })
  await flush()
  assert.equal(starts, 1)
  assert.deepEqual(errors, [])
  assert.deepEqual(tabs, [])
})

test('startup errors are reported without unhandled rejections', async () => {
  const { errors } = setup({ getCompatibility: async () => ({ supported: true }), start: async () => { throw new Error('Startup failed') } })
  await flush()
  assert.ok(errors.some(error => error.includes('Startup failed')))
})

test('a missing API opens the compatibility page once across background reloads', async () => {
  const storage = new Map()
  const first = setup(undefined, storage)
  await flush()
  assert.ok(first.errors.some(error => error.includes('requires Floorp')))
  assert.equal(first.tabs[0].url, 'moz-extension://test/compatibility.html')
  const second = setup(undefined, storage)
  await flush()
  assert.equal(second.tabs.length, 0)
})

test('Firefox with experiment APIs available is rejected before startup', async () => {
  let starts = 0
  const { tabs } = setup({ getCompatibility: async () => ({ supported: false }), start: async () => { starts++ } })
  await flush()
  assert.equal(starts, 0)
  assert.equal(tabs.length, 1)
})

test('compatibility check failures do not start the addon', async () => {
  let starts = 0
  const { errors } = setup({ getCompatibility: async () => { throw new Error('Check failed') }, start: async () => { starts++ } })
  await flush()
  assert.equal(starts, 0)
  assert.ok(errors.some(error => error.includes('Check failed')))
})
