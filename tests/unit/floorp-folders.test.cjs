const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')

function setup(existing = true, windows = []) {
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
  const errors = []
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
      obs: { addObserver() {}, removeObserver() {} }, wm: { getEnumerator: () => windows, getMostRecentWindow: () => windows[0] || null },
    },
    Cu: { reportError(error) { errors.push(error) } },
  }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../../experiments/floorp.js'), 'utf8'), sandbox)
  let close
  const api = new sandbox.floorpWorkspaceBars().getAPI({ extension: { getURL: path => `extension://${path}` }, callOnClose(handler) { close = handler.close } }).floorpWorkspaceBars
  return { api, nodes, prefs, sandbox, errors, shutdown: () => close?.(), failOnce: guid => { failGuid = guid }, mapping: async () => Object.fromEntries((await api.getState()).bars.map(bar => [bar.name, bar.folderGuid])) }
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

test('renaming a shared toolbar preserves its GUID, contents and all bindings', async () => {
  const s = setup()
  await s.api.bindFolder('first', 'home')
  await s.api.bindFolder('second', 'home')
  s.nodes.set('keep', { guid: 'keep', type: 1, parentGuid: 'home', title: 'Keep', url: 'https://example.net/' })
  const before = await s.mapping()
  const count = s.nodes.size
  await s.api.renameToolbar('home', '  Shared  ')
  assert.equal(s.nodes.get('home').title, 'Shared')
  assert.equal(s.nodes.get('keep').parentGuid, 'home')
  assert.deepEqual(await s.mapping(), before)
  assert.equal(s.nodes.size, count)
  assert.equal((await s.api.getState()).folders.find(folder => folder.guid === 'home').name, 'Shared')
})

test('rename rejects blank and duplicate names without changing the folder', async () => {
  const s = setup()
  await s.api.getState()
  await assert.rejects(s.api.renameToolbar('home', '   '), /Enter a toolbar name/)
  await assert.rejects(s.api.renameToolbar('home', ' Mil '), /already exists/)
  assert.equal(s.nodes.get('home').title, 'Home')
  await s.api.renameToolbar('home', ' Home ')
  assert.equal(s.nodes.get('home').title, 'Home')
})

test('rename refuses browser roots and folders outside the collection', async () => {
  const s = setup()
  for (const guid of ['toolbar', 'menu', 'root', 'nested', 'missing']) {
    await assert.rejects(s.api.renameToolbar(guid, 'New name'), /no longer exists/)
  }
  assert.equal(s.nodes.get('root').title, 'Workspace Bookmarks')
  assert.equal(s.nodes.get('nested').title, 'Nested')
})

test('concurrent renames cannot create duplicate toolbar names', async () => {
  const s = setup()
  addMil(s)
  const results = await Promise.allSettled([
    s.api.renameToolbar('home', 'Shared'),
    s.api.renameToolbar('mil', 'Shared'),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal([...s.nodes.values()].filter(node => node.title === 'Shared').length, 1)
})

test('a failed rename leaves bindings and the name unchanged and can be retried', async () => {
  const s = setup()
  const before = await s.mapping()
  s.failOnce('home')
  await assert.rejects(s.api.renameToolbar('home', 'Shared'), /Interrupted/)
  assert.equal(s.nodes.get('home').title, 'Home')
  assert.deepEqual(await s.mapping(), before)
  await s.api.renameToolbar('home', 'Shared')
  assert.equal(s.nodes.get('home').title, 'Shared')
  assert.deepEqual(await s.mapping(), before)
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

test('first binding matches existing folders while archiving the standard toolbar', async () => {
  const s = setup()
  addMil(s)
  s.prefs.delete('floorp.workspace-bookmarks.mapping')
  const count = s.nodes.size
  assert.deepEqual(await s.mapping(), { Mil: 'mil', Home: 'home' })
  assert.equal(s.nodes.size, count + 1)
  assert.equal(s.nodes.get('one').parentGuid, JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup.guid)
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
  assert.equal(s.nodes.get('one').parentGuid, JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup.guid)
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
  assert.deepEqual(Array.from(folders, folder => folder.name).sort(), ['Home', 'Mil', 'Original Bookmarks Toolbar'])
  const mil = folders.find(folder => folder.name === 'Mil')
  assert.ok([...s.nodes.values()].some(node => node.parentGuid === mil.guid && node.title === 'Original'))
  assert.equal(s.nodes.get('one').parentGuid, JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup.guid)
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
  assert.equal(s.nodes.size, count + 1)
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
  assert.equal(s.nodes.get('one').parentGuid, JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup.guid)
})


test('selector contains only workspace folders, excluding the browser toolbar', async () => {
  const s = setup()
  const state = await s.api.getState()
  assert.deepEqual(Array.from(state.folders, folder => folder.name).sort(), ['Home', 'Mil', 'Original Bookmarks Toolbar'])
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

test('initial setup moves original bookmarks, folders and separators into a selectable archive', async () => {
  const s = setup(false)
  s.nodes.set('separator', { guid: 'separator', parentGuid: 'toolbar', type: 3 })
  const state = await s.api.getState()
  const map = JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping'))
  const archive = state.folders.find(folder => folder.guid === map.toolbarBackup.guid)
  assert.equal(archive.name, 'Original Bookmarks Toolbar')
  assert.equal(map.toolbarBackup.complete, true)
  assert.equal(map.toolbarBackup.items, undefined)
  assert.equal(s.nodes.get(archive.guid).parentGuid, map.rootGuid)
  for (const guid of ['one', 'nested', 'separator']) assert.equal(s.nodes.get(guid).parentGuid, archive.guid)
  assert.equal(s.nodes.get('child').parentGuid, 'nested')
  assert.equal(s.nodes.get('child').url, 'https://example.org/')
  assert.equal([...s.nodes.values()].some(node => node.parentGuid === 'toolbar'), false)
  const active = state.bars.find(bar => bar.id === 'first').folderGuid
  assert.ok([...s.nodes.values()].some(node => node.parentGuid === active && node.title === 'Original'))
})

test('an interrupted archive resumes with the same folder and original bookmark GUIDs', async () => {
  const s = setup()
  s.failOnce('nested')
  await assert.rejects(s.api.getState(), /Interrupted move/)
  const pending = JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup
  assert.equal(pending.complete, false)
  assert.deepEqual(pending.items, ['one', 'nested'])
  assert.equal(s.nodes.get('one').parentGuid, pending.guid)
  assert.equal(s.nodes.get('nested').parentGuid, 'toolbar')
  const count = s.nodes.size
  await s.api.getState()
  assert.equal(s.nodes.size, count)
  assert.equal(s.nodes.get('nested').parentGuid, pending.guid)
  assert.equal(s.nodes.get('child').parentGuid, 'nested')
  assert.equal(JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup.complete, true)
})

test('failure to create the archive leaves originals intact and retries the reserved destination', async () => {
  const s = setup()
  s.failOnce('Original Bookmarks Toolbar')
  await assert.rejects(s.api.getState(), /Interrupted/)
  const pending = JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup
  assert.equal(s.nodes.has(pending.guid), false)
  assert.equal(s.nodes.get('one').parentGuid, 'toolbar')
  assert.equal(s.nodes.get('nested').parentGuid, 'toolbar')
  await s.api.getState()
  assert.equal(s.nodes.get('one').parentGuid, pending.guid)
  assert.equal([...s.nodes.values()].filter(node => node.title === 'Original Bookmarks Toolbar').length, 1)
})

test('restoring originals and deleting the archive does not trigger another automatic move', async () => {
  const s = setup()
  await s.api.getState()
  const backup = JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup
  s.nodes.get('one').parentGuid = 'toolbar'
  s.nodes.set('new', { guid: 'new', type: 1, parentGuid: 'toolbar', url: 'https://new.example/' })
  await s.api.renameToolbar(backup.guid, 'Saved originals')
  await s.api.deleteFolder(backup.guid)
  s.shutdown()
  const reloaded = new s.sandbox.floorpWorkspaceBars().getAPI({ callOnClose() {} }).floorpWorkspaceBars
  await reloaded.getState()
  assert.equal(s.nodes.get('one').parentGuid, 'toolbar')
  assert.equal(s.nodes.get('new').parentGuid, 'toolbar')
  assert.equal(s.nodes.has(backup.guid), false)
  assert.equal([...s.nodes.values()].some(node => node.title === 'Original Bookmarks Toolbar'), false)
})

test('an empty standard toolbar needs no archive and later additions stay in place', async () => {
  const s = setup()
  for (const guid of ['one', 'nested', 'child']) s.nodes.delete(guid)
  const state = await s.api.getState()
  assert.equal(state.folders.some(folder => folder.name === 'Original Bookmarks Toolbar'), false)
  assert.equal(JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup.complete, true)
  s.nodes.set('new', { guid: 'new', type: 1, parentGuid: 'toolbar', url: 'https://new.example/' })
  await s.api.getState()
  assert.equal(s.nodes.get('new').parentGuid, 'toolbar')
})

test('an existing archive name is preserved without merging unrelated contents', async () => {
  const s = setup()
  s.nodes.set('existing-backup', { guid: 'existing-backup', parentGuid: 'root', type: 2, title: 'Original Bookmarks Toolbar' })
  s.nodes.set('keep', { guid: 'keep', parentGuid: 'existing-backup', type: 1, url: 'https://keep.example/' })
  const state = await s.api.getState()
  const archive = state.folders.find(folder => folder.name === 'Original Bookmarks Toolbar (2)')
  assert.ok(archive)
  assert.equal(s.nodes.get('one').parentGuid, archive.guid)
  assert.equal(s.nodes.get('keep').parentGuid, 'existing-backup')
})

test('a collection placed on the standard toolbar moves to the menu before archiving', async () => {
  const s = setup()
  s.nodes.get('root').parentGuid = 'toolbar'
  await s.api.getState()
  const backup = JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup
  assert.equal(s.nodes.get('root').parentGuid, 'menu')
  assert.equal(s.nodes.get(backup.guid).parentGuid, 'root')
  assert.equal(s.nodes.get('one').parentGuid, backup.guid)
  assert.equal([...s.nodes.values()].some(node => node.parentGuid === 'toolbar'), false)
})

test('a collection nested inside the toolbar is extracted without creating a bookmark cycle', async () => {
  const s = setup()
  s.nodes.get('root').parentGuid = 'nested'
  await s.api.getState()
  const backup = JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping')).toolbarBackup
  assert.equal(s.nodes.get('root').parentGuid, 'menu')
  assert.equal(s.nodes.get('nested').parentGuid, backup.guid)
  assert.equal(s.nodes.get('child').parentGuid, 'nested')
})

test('concurrent startup requests create one archive and preserve existing shared bindings', async () => {
  const s = setup()
  addMil(s)
  const map = JSON.parse(s.prefs.get('floorp.workspace-bookmarks.mapping'))
  map.initializedWorkspaces = { first: true, second: true }
  map.workspaces = { first: 'home', second: 'home' }
  s.prefs.set('floorp.workspace-bookmarks.mapping', JSON.stringify(map))
  await Promise.all([s.api.getState(), s.api.getState(), s.api.getState()])
  assert.deepEqual(await s.mapping(), { Mil: 'home', Home: 'home' })
  assert.equal([...s.nodes.values()].filter(node => node.title === 'Original Bookmarks Toolbar').length, 1)
  assert.equal(s.nodes.get('saved').parentGuid, 'mil')
})

// Native services are represented by a small window double; no browser is launched.
function startupWindow() {
  const timers = new Map()
  let nextTimer = 0
  const element = () => ({
    style: {}, parentNode: null, children: [],
    setAttribute() {}, addEventListener() {}, removeEventListener() {},
    appendChild(child) { this.children.push(child); child.parentNode = this; return child },
    hidePopup() {}, remove() { this.parentNode = null },
  })
  const toolbar = element()
  const popups = element()
  const viewElement = {}
  const win = {
    closed: false, gBrowserInit: { delayedStartupFinished: true },
    gBrowser: { tabContainer: element() }, PlacesCommandHook: {},
    addEventListener() {}, removeEventListener() {},
    document: {
      documentURI: 'chrome://browser/content/browser.xhtml',
      documentElement: popups, hasFocus: () => true,
      getElementById: id => ({ PersonalToolbar: toolbar, mainPopupSet: popups })[id],
      createXULElement: element, createElementNS: element,
    },
    setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id },
    clearTimeout(id) { timers.delete(id) },
    PlacesToolbarHelper: {
      _viewElt: viewElement,
      _realInit() { viewElement._placesView ||= { place: 'place:parent=toolbar' } },
      async init() { this._realInit() },
    },
    BookmarkingUI: { async updateEmptyToolbarMessage() { win.emptyMessageUpdated = true } },
  }
  return {
    win, timers, viewElement, toolbar,
    async tick() {
      const callbacks = [...timers.values()]
      timers.clear()
      for (const callback of callbacks) callback()
      // Flush queued Places operations without depending on real startup timing.
      await new Promise(resolve => setImmediate(resolve))
    },
  }
}

test('startup waits for Floorp workspace restoration without requiring a workspace click', async () => {
  const w = startupWindow()
  const s = setup(true, [w.win])
  await s.api.start()
  assert.equal(w.timers.size, 1)
  // Workspace restoration can take longer than the old single 1.2s retry.
  for (let attempt = 0; attempt < 5; attempt++) await w.tick()
  assert.equal(w.timers.size, 1)
  assert.equal(s.nodes.get('one').parentGuid, 'toolbar')
  let selected
  w.win.workspacesFuncs = { getSelectedWorkspaceID: () => selected }
  await w.tick()
  selected = 'second'
  await w.tick()
  assert.equal(w.viewElement._placesView.place, 'place:parent=home')
  assert.equal(w.timers.size, 0)
  assert.equal(w.win.emptyMessageUpdated, true)
  assert.equal(s.prefs.get('browser.bookmarks.defaultLocation'), 'home')
  s.shutdown()
})

test('startup retries an unavailable Places view and stops after it becomes ready', async () => {
  const w = startupWindow()
  const s = setup(true, [w.win])
  w.win.workspacesFuncs = { getSelectedWorkspaceID: () => 'second' }
  w.win.PlacesToolbarHelper.init = async () => {}
  await s.api.start()
  assert.equal(w.timers.size, 1)
  await w.tick()
  assert.equal(w.timers.size, 1)
  w.viewElement._placesView = { place: 'place:parent=toolbar' }
  await w.tick()
  assert.equal(w.viewElement._placesView.place, 'place:parent=home')
  assert.equal(w.timers.size, 0)
  s.shutdown()
})

test('shutdown cancels pending startup retries without archiving bookmarks', async () => {
  const w = startupWindow()
  const s = setup(true, [w.win])
  await s.api.start()
  assert.equal(w.timers.size, 1)
  s.shutdown()
  assert.equal(w.timers.size, 0)
  await w.tick()
  assert.equal(s.nodes.get('one').parentGuid, 'toolbar')
})

function bookmarkWindow(contextId = 4) {
  const w = startupWindow()
  w.contextId = contextId
  w.opened = []
  w.win.workspacesFuncs = {
    getSelectedWorkspaceID: () => 'second',
    getCurrentWorkspaceUserContextId: () => w.contextId,
  }
  w.win.gBrowser.addTab = function (url, options) {
    assert.equal(this, w.win.gBrowser)
    const tab = { url, options, originAttributes: { userContextId: options?.userContextId || 0 } }
    w.opened.push(tab)
    return tab
  }
  w.win.BookmarksEventHandler = {
    onClick(event) {
      assert.equal(this, w.win.BookmarksEventHandler)
      if (event.folder) return event.urls.map(url => w.win.gBrowser.addTab(url, event.options))
      return this.onCommand(event)
    },
    onCommand(event) {
      assert.equal(this, w.win.BookmarksEventHandler)
      if (event.fail) throw new Error('Native opening failed')
      if (event.button === 0 && !event.ctrlKey) return 'current tab'
      return w.win.gBrowser.addTab('https://example.com/', event.options)
    },
  }
  const initializeView = w.win.PlacesToolbarHelper._realInit
  w.win.PlacesToolbarHelper._realInit = function () {
    initializeView.call(this)
    const view = w.viewElement._placesView
    if (view.controller) return
    view.controller = {
      doCommand(command, options = { userContextId: 0, inBackground: true }) {
        assert.equal(this, view.controller)
        if (command !== 'placesCmd_open:tab') return 'native command'
        if (w.failContextCommand) throw new Error('Context command failed')
        return w.win.gBrowser.addTab('https://example.com/', options)
      },
      openSelectionInTabs(event) {
        assert.equal(this, view.controller)
        return event.urls.map(url => w.win.gBrowser.addTab(url, event.options))
      },
    }
    w.nativeControllerCommand = view.controller.doCommand
    w.nativeControllerSelection = view.controller.openSelectionInTabs
    if (w.protectedController) Object.defineProperty(view.controller, 'doCommand', { writable: false })
  }
  w.event = (props = {}) => ({
    button: 1,
    originalTarget: { closest: selector => selector === '#PersonalToolbar' ? w.toolbar : null },
    options: { userContextId: 0, inBackground: true, triggeringPrincipal: { native: true } },
    ...props,
  })
  return w
}

function mockBookmarkPrivacy(s, windows) {
  const originalImport = s.sandbox.ChromeUtils.importESModule
  s.sandbox.ChromeUtils.importESModule = name => name.includes('PrivateBrowsingUtils')
    ? { PrivateBrowsingUtils: { isWindowPrivate: win => !!windows.find(w => w.win === win)?.private } }
    : originalImport(name)
}

test('middle-click bookmarks choose the live workspace cookie jar before browser creation', async () => {
  const w = bookmarkWindow()
  const s = setup(true, [w.win])
  mockBookmarkPrivacy(s, [w])
  await s.api.start()
  assert.equal(w.viewElement._placesView.place, 'place:parent=home')
  const event = w.event()
  const tab = w.win.BookmarksEventHandler.onClick(event)
  assert.equal(tab.originAttributes.userContextId, 4)
  assert.equal(tab.options.inBackground, true)
  assert.equal(tab.options.triggeringPrincipal, event.options.triggeringPrincipal)
  assert.equal(event.options.userContextId, 0)
  assert.equal(w.opened.length, 1)
  w.contextId = 7
  const shifted = w.event({ shiftKey: true, options: { inBackground: false } })
  assert.equal(w.win.BookmarksEventHandler.onClick(shifted).originAttributes.userContextId, 7)
  assert.equal(w.opened[1].options.inBackground, false)
  assert.equal(w.win.BookmarksEventHandler.onCommand(w.event({ button: 0, ctrlKey: true })).originAttributes.userContextId, 7)
  assert.equal(w.win.BookmarksEventHandler.onCommand(w.event({ button: 0 })), 'current tab')
  s.shutdown()
})

test('folder middle-clicks and submenu commands inherit the workspace container', async () => {
  const w = bookmarkWindow()
  const s = setup(true, [w.win])
  mockBookmarkPrivacy(s, [w])
  await s.api.start()
  const tabs = w.win.BookmarksEventHandler.onClick(w.event({ folder: true, urls: ['https://example.com/', 'https://example.org/'] }))
  assert.deepEqual(tabs.map(tab => tab.originAttributes.userContextId), [4, 4])
  assert.equal(w.win.BookmarksEventHandler.onCommand(w.event()).originAttributes.userContextId, 4)
  s.shutdown()
})

test('container handling preserves explicit containers and unrelated tab creation', async () => {
  const w = bookmarkWindow()
  const s = setup(true, [w.win])
  mockBookmarkPrivacy(s, [w])
  await s.api.start()
  const explicit = w.event({ options: { userContextId: 9, inBackground: false } })
  assert.equal(w.win.BookmarksEventHandler.onClick(explicit).originAttributes.userContextId, 9)
  assert.equal(w.opened[0].options, explicit.options)
  assert.equal(w.win.BookmarksEventHandler.onClick(w.event({ originalTarget: { closest: () => null } })).originAttributes.userContextId, 0)
  assert.equal(w.win.gBrowser.addTab('https://example.net/', { userContextId: 0 }).originAttributes.userContextId, 0)
  s.shutdown()
})

test('private windows, disabled features and unavailable containers retain native opening', async () => {
  const w = bookmarkWindow()
  const s = setup(true, [w.win])
  mockBookmarkPrivacy(s, [w])
  await s.api.start()
  const originalBoolPref = s.sandbox.Services.prefs.getBoolPref
  for (const pref of ['floorp.workspaces.enabled', 'privacy.userContext.enabled']) {
    s.sandbox.Services.prefs.getBoolPref = key => key !== pref
    assert.equal(w.win.BookmarksEventHandler.onClick(w.event()).originAttributes.userContextId, 0)
  }
  s.sandbox.Services.prefs.getBoolPref = originalBoolPref
  w.private = true
  assert.equal(w.win.BookmarksEventHandler.onClick(w.event()).originAttributes.userContextId, 0)
  w.private = false
  for (const id of [0, undefined, -1, '4', 1.5, 0x100000000]) {
    w.contextId = id
    assert.equal(w.win.BookmarksEventHandler.onClick(w.event()).originAttributes.userContextId, 0)
  }
  w.win.workspacesFuncs.getCurrentWorkspaceUserContextId = () => { throw new Error('Workspace unavailable') }
  assert.equal(w.win.BookmarksEventHandler.onClick(w.event()).originAttributes.userContextId, 0)
  s.shutdown()
})

test('opening failure clears toolbar scope and shutdown restores native functions', async () => {
  const w = bookmarkWindow()
  const originalAddTab = w.win.gBrowser.addTab
  const originalClick = w.win.BookmarksEventHandler.onClick
  const originalCommand = w.win.BookmarksEventHandler.onCommand
  const s = setup(true, [w.win])
  mockBookmarkPrivacy(s, [w])
  await s.api.start()
  assert.throws(() => w.win.BookmarksEventHandler.onClick(w.event({ fail: true })), /Native opening failed/)
  assert.equal(w.win.gBrowser.addTab('https://example.net/', { userContextId: 0 }).originAttributes.userContextId, 0)
  assert.equal(w.win.BookmarksEventHandler.onClick(w.event()).originAttributes.userContextId, 4)
  s.shutdown()
  assert.equal(w.win.gBrowser.addTab, originalAddTab)
  assert.equal(w.win.BookmarksEventHandler.onClick, originalClick)
  assert.equal(w.win.BookmarksEventHandler.onCommand, originalCommand)
})

test('each browser window resolves its own bookmark container', async () => {
  const first = bookmarkWindow(4)
  const second = bookmarkWindow(7)
  const s = setup(true, [first.win, second.win])
  mockBookmarkPrivacy(s, [first, second])
  await s.api.start()
  assert.equal(first.win.BookmarksEventHandler.onClick(first.event()).originAttributes.userContextId, 4)
  assert.equal(second.win.BookmarksEventHandler.onClick(second.event()).originAttributes.userContextId, 7)
  s.shutdown()
})

for (const blocked of ['onClick', 'onCommand', 'addTab', 'BookmarksEventHandler']) {
  test(`an inaccessible native ${blocked} cannot prevent displaying workspace bookmarks`, async () => {
    const w = bookmarkWindow()
    const originalClick = w.win.BookmarksEventHandler.onClick
    const originalCommand = w.win.BookmarksEventHandler.onCommand
    const originalAddTab = w.win.gBrowser.addTab
    if (blocked === 'BookmarksEventHandler') {
      Object.defineProperty(w.win, blocked, { get() { throw new Error('Native hook unavailable') } })
    } else {
      const target = blocked === 'addTab' ? w.win.gBrowser : w.win.BookmarksEventHandler
      Object.defineProperty(target, blocked, { writable: false })
    }
    const s = setup(true, [w.win])
    await s.api.start()
    assert.equal(w.viewElement._placesView.place, 'place:parent=home')
    assert.equal(s.prefs.get('browser.bookmarks.defaultLocation'), 'home')
    assert.equal(w.timers.size, 0)
    assert.equal(w.win.emptyMessageUpdated, true)
    assert.ok(s.errors.length > 0)
    assert.equal(w.win.gBrowser.addTab, originalAddTab)
    if (blocked !== 'BookmarksEventHandler') {
      assert.equal(w.win.BookmarksEventHandler.onClick, originalClick)
      assert.equal(w.win.BookmarksEventHandler.onCommand, originalCommand)
    }
    s.shutdown()
    assert.equal(w.viewElement._placesView.place, 'place:parent=toolbar')
  })
}

test('a failed native hook in one window does not stop toolbar setup in other windows', async () => {
  const first = bookmarkWindow(4)
  const second = bookmarkWindow(7)
  Object.defineProperty(first.win.gBrowser, 'addTab', { writable: false })
  const s = setup(true, [first.win, second.win])
  mockBookmarkPrivacy(s, [first, second])
  await s.api.start()
  assert.equal(first.viewElement._placesView.place, 'place:parent=home')
  assert.equal(second.viewElement._placesView.place, 'place:parent=home')
  assert.equal(first.win.BookmarksEventHandler.onClick(first.event()).originAttributes.userContextId, 0)
  assert.equal(second.win.BookmarksEventHandler.onClick(second.event()).originAttributes.userContextId, 7)
  s.shutdown()
})

test('Open in New Tab context command uses the active workspace container', async () => {
  const w = bookmarkWindow(4)
  const s = setup(true, [w.win])
  mockBookmarkPrivacy(s, [w])
  await s.api.start()
  const controller = w.viewElement._placesView.controller
  // Context commands bypass BookmarksEventHandler.onClick and onCommand.
  const options = { userContextId: 0, inBackground: true, triggeringPrincipal: { native: true } }
  const tab = controller.doCommand('placesCmd_open:tab', options)
  assert.equal(tab.originAttributes.userContextId, 4)
  assert.equal(tab.options.inBackground, true)
  assert.equal(tab.options.triggeringPrincipal, options.triggeringPrincipal)
  assert.equal(options.userContextId, 0)
  w.contextId = 7
  assert.equal(controller.doCommand('placesCmd_open:tab').originAttributes.userContextId, 7)
  assert.equal(controller.doCommand('placesCmd_open:tab', { userContextId: 9 }).originAttributes.userContextId, 9)
  assert.equal(controller.doCommand('placesCmd_open:window'), 'native command')
  assert.equal(w.win.gBrowser.addTab('https://elsewhere.example/', { userContextId: 0 }).originAttributes.userContextId, 0)
  w.failContextCommand = true
  assert.throws(() => controller.doCommand('placesCmd_open:tab'), /Context command failed/)
  assert.equal(w.win.gBrowser.addTab('https://elsewhere.example/', { userContextId: 0 }).originAttributes.userContextId, 0)
  s.shutdown()
  assert.equal(controller.doCommand, w.nativeControllerCommand)
  assert.equal(controller.openSelectionInTabs, w.nativeControllerSelection)
})

test('Open All in Tabs context command applies the container to every bookmark', async () => {
  const w = bookmarkWindow(4)
  const s = setup(true, [w.win])
  mockBookmarkPrivacy(s, [w])
  await s.api.start()
  const tabs = w.viewElement._placesView.controller.openSelectionInTabs(w.event({ urls: ['https://example.com/', 'https://example.org/'] }))
  assert.deepEqual(tabs.map(tab => tab.originAttributes.userContextId), [4, 4])
  s.shutdown()
})

test('rebuilding the native toolbar also wraps its new context command controller', async () => {
  const w = bookmarkWindow(4)
  const s = setup(true, [w.win])
  mockBookmarkPrivacy(s, [w])
  await s.api.start()
  const oldController = w.viewElement._placesView.controller
  const oldCommand = w.nativeControllerCommand
  delete w.viewElement._placesView
  await w.win.PlacesToolbarHelper.init()
  const controller = w.viewElement._placesView.controller
  assert.notEqual(controller, oldController)
  assert.equal(controller.doCommand('placesCmd_open:tab').originAttributes.userContextId, 4)
  assert.equal(w.viewElement._placesView.place, 'place:parent=home')
  s.shutdown()
  assert.equal(oldController.doCommand, oldCommand)
  assert.equal(controller.doCommand, w.nativeControllerCommand)
})

test('a protected context controller preserves the toolbar and working middle-click support', async () => {
  const w = bookmarkWindow(4)
  w.protectedController = true
  const s = setup(true, [w.win])
  mockBookmarkPrivacy(s, [w])
  await s.api.start()
  assert.equal(w.viewElement._placesView.place, 'place:parent=home')
  assert.equal(w.win.BookmarksEventHandler.onClick(w.event()).originAttributes.userContextId, 4)
  assert.equal(w.viewElement._placesView.controller.doCommand, w.nativeControllerCommand)
  s.shutdown()
})
