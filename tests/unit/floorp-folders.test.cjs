const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')

function setup(existing = true) {
  const prefs = new Map([
    ['floorp.workspaces.v4.store', JSON.stringify({ defaultID: 'first', data: [['first', { name: 'Mil' }], ['second', { name: 'Home' }]] })],
    ['floorp.workspace-bookmarks.mapping', JSON.stringify(existing ? { version: 3, rootGuid: 'root', workspaces: { first: 'toolbar', second: 'home' } } : {})],
  ])
  const nodes = new Map([
    ['toolbar', { guid: 'toolbar', type: 2 }],
    ['menu', { guid: 'menu', type: 2 }],
    ['one', { guid: 'one', type: 1, parentGuid: 'toolbar', title: 'Original', url: 'https://example.com/' }],
    ['nested', { guid: 'nested', type: 2, parentGuid: 'toolbar', title: 'Nested' }],
    ['child', { guid: 'child', type: 1, parentGuid: 'nested', title: 'Child', url: 'https://example.org/' }],
  ])
  if (existing) {
    nodes.set('root', { guid: 'root', parentGuid: 'menu', type: 2, title: 'Workspace Bookmarks' })
    nodes.set('home', { guid: 'home', parentGuid: 'root', type: 2, title: 'Home' })
  }
  let next = 0
  let failGuid
  const bookmarks = {
    toolbarGuid: 'toolbar', menuGuid: 'menu', TYPE_FOLDER: 2, DEFAULT_INDEX: -1,
    async fetch(guid) { return nodes.get(guid) },
    async fetchTree(guid) {
      const tree = guid => {
        const { type, url, ...data } = nodes.get(guid)
        const result = { ...data, typeCode: type, type: type === 2 ? 'text/x-moz-place-container' : 'text/x-moz-place' }
        if (url) result.uri = url
        if (type === 2) result.children = [...nodes.values()].filter(n => n.parentGuid === guid).map(n => tree(n.guid))
        return result
      }
      return tree(guid)
    },
    async insert(data) { if (data.title === failGuid) { failGuid = undefined; throw new Error('Interrupted copy') } if (data.type === 1 && !data.url) throw new Error('Bookmark URL is required'); const node = { ...data, guid: data.guid || `created-${++next}` }; nodes.set(node.guid, node); return node },
    async insertTree(tree) {
      const snapshot = new Map([...nodes].map(([k,v]) => [k, { ...v }]))
      const add = async (children, parentGuid) => { for (const data of children) { const { children: nested, ...props } = data; const node = await this.insert({ ...props, parentGuid }); if (nested) await add(nested, node.guid) } }
      try { await add(tree.children, tree.guid) } catch (error) { nodes.clear(); for (const [k,v] of snapshot) nodes.set(k,v); throw error }
    },
    async remove(guid) { const remove = parent => { for (const n of [...nodes.values()]) if (n.parentGuid === parent) remove(n.guid); nodes.delete(parent) }; remove(guid) },
    async update(data) {
      if (data.guid === failGuid) { failGuid = undefined; throw new Error('Interrupted move') }
      Object.assign(nodes.get(data.guid), data)
      return nodes.get(data.guid)
    },
  }
  const sandbox = {
    ChromeUtils: { importESModule: name => name.includes('ExtensionCommon') ? { ExtensionCommon: { ExtensionAPI: class {} } } : { PlacesUtils: { bookmarks, promiseBookmarksTree: guid => bookmarks.fetchTree(guid), history: { makeGuid: () => `copy-${++next}` } } } },
    Services: {
      appinfo: { name: 'Floorp' },
      prefs: { getStringPref: (key, fallback) => prefs.get(key) ?? fallback, setStringPref: (key, value) => prefs.set(key, value), getBoolPref: () => true, setBoolPref() {}, clearUserPref: key => prefs.delete(key), addObserver() {}, removeObserver() {} },
      obs: { addObserver() {}, removeObserver() {} }, wm: { getEnumerator: () => [], getMostRecentWindow: () => null },
    },
    Cu: { reportError() {} },
  }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../../experiments/floorp.js'), 'utf8'), sandbox)
  let close
  const api = new sandbox.floorpWorkspaceBars().getAPI({ callOnClose(handler) { close = handler.close } }).floorpWorkspaceBars
  return { api, nodes, prefs, sandbox, shutdown: () => close?.(), failOnce: guid => { failGuid = guid }, mapping: async () => Object.fromEntries((await api.getState()).bars.map(bar => [bar.name, bar.folderGuid])) }
}



function addMil(s) {
  s.nodes.set('mil', { guid: 'mil', parentGuid: 'root', type: 2, title: 'Mil' })
  s.nodes.set('saved', { guid: 'saved', parentGuid: 'mil', type: 1, title: 'Keep me' })
}

test('Firefox cannot start or modify bookmarks even when experiment APIs are enabled', async () => {
  const s = setup()
  s.sandbox.Services.appinfo.name = 'Firefox'
  const prefs = JSON.stringify([...s.prefs])
  const bookmarks = JSON.stringify([...s.nodes])
  const writes = []
  s.sandbox.Services.prefs.setBoolPref = (...args) => writes.push(args)
  s.sandbox.Services.prefs.setStringPref = (...args) => writes.push(args)
  assert.equal((await s.api.getCompatibility()).supported, false)
  await assert.rejects(s.api.start(), /requires Floorp/)
  await assert.rejects(s.api.getState(), /requires Floorp/)
  await assert.rejects(s.api.createToolbar('Research'), /requires Floorp/)
  await assert.rejects(s.api.bindFolder('first', 'home'), /requires Floorp/)
  await assert.rejects(s.api.deleteFolder('home'), /requires Floorp/)
  await assert.rejects(s.api.copyToolbar('home', 'mil'), /requires Floorp/)
  await assert.rejects(s.api.openFolder('home'), /requires Floorp/)
  s.shutdown()
  assert.deepEqual(writes, [])
  assert.equal(JSON.stringify([...s.prefs]), prefs)
  assert.equal(JSON.stringify([...s.nodes]), bookmarks)
})

test('creating a toolbar trims its name and preserves bindings', async () => {
  const s = setup()
  const before = await s.mapping()
  const guid = await s.api.createToolbar('  Research  ')
  assert.equal(s.nodes.get(guid).title, 'Research')
  assert.equal(s.nodes.get(guid).parentGuid, 'root')
  assert.equal([...s.nodes.values()].some(node => node.parentGuid === guid), false)
  assert.deepEqual(await s.mapping(), before)
})

test('toolbar creation rejects blank and duplicate names, including concurrent submissions', async () => {
  const s = setup()
  await assert.rejects(s.api.createToolbar('   '), /Enter a toolbar name/)
  await s.api.getState()
  const count = s.nodes.size
  await assert.rejects(s.api.createToolbar(' Home '), /already exists/)
  assert.equal(s.nodes.size, count)
  const results = await Promise.allSettled([s.api.createToolbar('Research'), s.api.createToolbar('Research')])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal([...s.nodes.values()].filter(node => node.title === 'Research').length, 1)
})

test('failed toolbar creation can be retried', async () => {
  const s = setup()
  await s.api.getState()
  s.failOnce('Research')
  await assert.rejects(s.api.createToolbar('Research'), /Interrupted/)
  const guid = await s.api.createToolbar('Research')
  assert.equal(s.nodes.get(guid).title, 'Research')
})

test('copy appends independent bookmarks and nested folders without changing source or bindings', async () => {
  const s = setup()
  const before = await s.mapping()
  const source = before.Mil
  s.nodes.set('existing', { guid: 'existing', parentGuid: 'home', type: 1, title: 'Existing', url: 'https://keep.example/' })
  const originals = JSON.stringify([...s.nodes.values()].filter(node => node.parentGuid === source))
  await s.api.copyToolbar(source, 'home')
  const children = [...s.nodes.values()].filter(node => node.parentGuid === 'home')
  assert.equal(children.length, 3)
  assert.equal(s.nodes.get('existing').url, 'https://keep.example/')
  const bookmark = children.find(node => node.title === 'Original')
  assert.equal(bookmark.url, 'https://example.com/')
  const nested = children.find(node => node.title === 'Nested')
  const child = [...s.nodes.values()].find(node => node.parentGuid === nested.guid)
  assert.equal(child.url, 'https://example.org/')
  assert.equal(JSON.stringify([...s.nodes.values()].filter(node => node.parentGuid === source)), originals)
  assert.deepEqual(await s.mapping(), before)
})

test('copy refuses self-copy and folders outside the collection', async () => {
  const s = setup()
  await s.api.getState()
  const count = s.nodes.size
  await assert.rejects(s.api.copyToolbar('home', 'home'), /different toolbar/)
  await assert.rejects(s.api.copyToolbar('toolbar', 'home'), /no longer exists/)
  await assert.rejects(s.api.copyToolbar('home', 'missing'), /no longer exists/)
  assert.equal(s.nodes.size, count)
})

test('copy failure does not leave partially appended bookmarks', async () => {
  const s = setup()
  const source = (await s.mapping()).Mil
  const count = s.nodes.size
  s.failOnce('Child')
  await assert.rejects(s.api.copyToolbar(source, 'home'), /Interrupted/)
  assert.equal(s.nodes.size, count)
  await s.api.copyToolbar(source, 'home')
  assert.equal([...s.nodes.values()].filter(node => node.parentGuid === 'home').length, 2)
})

test('first binding matches folder names without changing bookmarks', async () => {
  const s = setup()
  addMil(s)
  s.prefs.delete('floorp.workspace-bookmarks.mapping')
  const count = s.nodes.size
  assert.deepEqual(await s.mapping(), { Mil: 'mil', Home: 'home' })
  assert.equal(s.nodes.size, count)
  assert.equal(s.nodes.get('one').parentGuid, 'toolbar')
})

test('two workspaces can share one folder and their choices persist', async () => {
  const s = setup()
  addMil(s)
  await s.api.bindFolder('first', 'home')
  await s.api.bindFolder('second', 'home')
  assert.deepEqual(await s.mapping(), { Mil: 'home', Home: 'home' })
  const saved = JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping'))
  assert.equal(saved.workspaces.first, 'home')
  assert.equal(saved.workspaces.second, 'home')
})

test('explicit unbinding is not undone by matching the workspace name', async () => {
  const s = setup()
  await s.api.bindFolder('second', '')
  assert.equal((await s.mapping()).Home, null)
  assert.equal((await s.mapping()).Home, null)
  assert.equal(s.nodes.has('home'), true)
})

test('workspace deletion removes only its binding, preserving the shared folder', async () => {
  const s = setup()
  await s.api.bindFolder('first', 'home')
  await s.api.bindFolder('second', 'home')
  s.nodes.set('home-child', { guid: 'home-child', parentGuid: 'home', type: 1, title: 'Home bookmark' })
  s.prefs.set('floorp.workspaces.v4.store', JSON.stringify({ defaultID: 'first', data: [['first', { name: 'Mil' }]] }))
  const state = await s.api.getState()
  assert.equal(state.bars[0].folderGuid, 'home')
  assert.equal(s.nodes.has('home-child'), true)
  assert.equal(JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).workspaces.second, undefined)
})

test('workspace rename preserves its selected folder without renaming a shared folder', async () => {
  const s = setup()
  await s.api.bindFolder('first', 'home')
  s.prefs.set('floorp.workspaces.v4.store', JSON.stringify({ defaultID: 'first', data: [['first', { name: 'Work' }], ['second', { name: 'Home' }]] }))
  assert.equal((await s.mapping()).Work, 'home')
  assert.equal(s.nodes.get('home').title, 'Home')
})

test('explicit folder deletion clears all bindings and removes its descendants', async () => {
  const s = setup()
  await s.api.bindFolder('first', 'home')
  await s.api.bindFolder('second', 'home')
  s.nodes.set('home-child', { guid: 'home-child', parentGuid: 'home', type: 1, title: 'Home bookmark' })
  await s.api.deleteFolder('home')
  assert.equal(s.nodes.has('home'), false)
  assert.equal(s.nodes.has('home-child'), false)
  assert.deepEqual(await s.mapping(), { Mil: null, Home: null })
  assert.equal(s.nodes.get('one').parentGuid, 'toolbar')
})

test('browser roots and folders outside the selectable collection cannot be deleted or bound', async () => {
  const s = setup()
  await assert.rejects(s.api.deleteFolder('toolbar'), /cannot be deleted/)
  await assert.rejects(s.api.deleteFolder('menu'), /cannot be deleted/)
  await assert.rejects(s.api.deleteFolder('nested'), /cannot be deleted/)
  await assert.rejects(s.api.bindFolder('second', 'nested'), /Unknown bookmark folder/)
  await assert.rejects(s.api.bindFolder('second', 'toolbar'), /Unknown bookmark folder/)
  await assert.rejects(s.api.bindFolder('deleted-workspace', 'home'), /Unknown workspace/)
})

test('new computer IDs bind by name and unmatched folders are preserved', async () => {
  const s = setup()
  addMil(s)
  s.prefs.delete('floorp.workspace-bookmarks.mapping')
  s.prefs.set('floorp.workspaces.v4.store', JSON.stringify({ defaultID: 'new-mil', data: [['new-mil', { name: 'Mil' }], ['new-home', { name: 'Home' }]] }))
  assert.deepEqual(await s.mapping(), { Mil: 'mil', Home: 'home' })
  s.prefs.set('floorp.workspaces.v4.store', JSON.stringify({ defaultID: 'new', data: [['new', { name: 'New space' }]] }))
  assert.ok((await s.mapping())['New space'])
  assert.equal(s.nodes.has('home'), true)
  assert.equal(s.nodes.has('mil'), true)
})

test('a folder removed outside the addon is unbound without being recreated', async () => {
  const s = setup()
  await s.api.getState()
  s.nodes.delete('home')
  assert.equal((await s.mapping()).Home, null)
  assert.equal(s.nodes.has('home'), false)
})


test('missing folders are initialized for every workspace without changing existing bindings', async () => {
  const s = setup()
  const state = await s.api.getState()
  const folders = state.folders.filter(folder => folder.canDelete)
  assert.deepEqual(Array.from(folders, folder => folder.name).sort(), ['Home', 'Mil'])
  const mil = folders.find(folder => folder.name === 'Mil')
  assert.ok([...s.nodes.values()].some(node => node.parentGuid === mil.guid && node.title === 'Original'))
  assert.equal(s.nodes.get('one').parentGuid, 'toolbar')
  assert.equal(state.bars.find(bar => bar.id === 'first').folderGuid, mil.guid)
  const count = s.nodes.size
  await s.api.getState()
  assert.equal(s.nodes.size, count)
})

test('an explicit null binding stays unbound during initial folder provisioning', async () => {
  const s = setup()
  const map = JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping'))
  map.workspaces.first = null
  s.prefs.set('floorp.workspace-bookmarks.mapping', JSON.stringify(map))
  const state = await s.api.getState()
  const mil = state.folders.find(folder => folder.name === 'Mil')
  assert.ok(mil)
  assert.equal(state.bars.find(bar => bar.id === 'first').folderGuid, null)
})

test('an existing collection and its bookmark contents are preserved', async () => {
  const s = setup()
  addMil(s)
  const state = await s.api.getState()
  assert.equal(s.nodes.get('root').title, 'Workspace Bookmarks')
  assert.equal(state.folders.find(folder => folder.name === 'Home').guid, 'home')
  assert.equal(s.nodes.get('saved').parentGuid, 'mil')
  assert.equal([...s.nodes.values()].filter(node => node.title === 'Workspace Bookmarks').length, 1)
})

test('an English collection is reused after restoring bookmarks without old preferences', async () => {
  const s = setup()
  addMil(s)
  s.nodes.get('root').title = 'Workspace Bookmarks'
  s.prefs.delete('floorp.workspace-bookmarks.mapping')
  const count = s.nodes.size
  assert.deepEqual(await s.mapping(), { Mil: 'mil', Home: 'home' })
  assert.equal(s.nodes.size, count)
})


test('initial copies accept Places uri fields and preserve nested bookmark URLs', async () => {
  const s = setup()
  const state = await s.api.getState()
  const mil = state.folders.find(folder => folder.name === 'Mil')
  const original = [...s.nodes.values()].find(node => node.parentGuid === mil.guid && node.title === 'Original')
  assert.equal(original.url, 'https://example.com/')
  const nested = [...s.nodes.values()].find(node => node.parentGuid === mil.guid && node.title === 'Nested')
  const child = [...s.nodes.values()].find(node => node.parentGuid === nested.guid && node.title === 'Child')
  assert.equal(child.url, 'https://example.org/')
  assert.equal(s.nodes.get('one').parentGuid, 'toolbar')
})


test('selector contains only workspace folders, excluding the browser toolbar', async () => {
  const s = setup()
  const state = await s.api.getState()
  assert.deepEqual(Array.from(state.folders, folder => folder.name).sort(), ['Home', 'Mil'])
  assert.equal(state.folders.some(folder => folder.guid === 'toolbar'), false)
})

test('an initialized workspace bound to the excluded toolbar resolves to its named folder', async () => {
  const s = setup()
  addMil(s)
  const map = JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping'))
  map.initializedWorkspaces = { first: true, second: true }
  s.prefs.set('floorp.workspace-bookmarks.mapping', JSON.stringify(map))
  assert.deepEqual(await s.mapping(), { Mil: 'mil', Home: 'home' })
  assert.equal(JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).workspaces.first, 'mil')
  await s.api.bindFolder('first', 'home')
  assert.deepEqual(await s.mapping(), { Mil: 'home', Home: 'home' })
})
