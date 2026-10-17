/* Floorp Bookmark Toolbar Autoswitch. MIT licensed. */
var { ExtensionCommon } = ChromeUtils.importESModule('resource://gre/modules/ExtensionCommon.sys.mjs');
var { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
var floorpWorkspaceBars = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    const PREF = 'floorp.workspace-bookmarks.mapping';
    const STORE = 'floorp.workspaces.v4.store';
    const ROOT_TITLE = 'Workspace Bookmarks';
    const BACKUP_TITLE = 'Original Bookmarks Toolbar';
    const isSupported = () => Services.appinfo.name.toLowerCase() === 'floorp';
    const requireFloorp = () => {
      if (!isSupported()) throw new Error('This extension requires Floorp. Firefox is not supported.');
    };
    const records = new Map();
    let started = false;
    let queue = Promise.resolve();
    let closed = false;
    const previous = JSON.parse(Services.prefs.getStringPref(PREF, '{}'));
    const originalDefaultLocation = previous.originalDefaultLocation ?? Services.prefs.getStringPref('browser.bookmarks.defaultLocation', 'toolbar');
    const getStore = () => JSON.parse(Services.prefs.getStringPref(STORE, '{}'));
    const readMapping = () => JSON.parse(Services.prefs.getStringPref(PREF, '{}'));
    const save = map => Services.prefs.setStringPref(PREF, JSON.stringify(map));
    const run = task => {
      const job = queue.then(task);
      queue = job.catch(Cu.reportError);
      return job;
    };
    const listFolders = async rootGuid => {
      const b = PlacesUtils.bookmarks;
      const tree = await PlacesUtils.promiseBookmarksTree(rootGuid);
      return (tree?.children || [])
        .filter(node => (node.typeCode ?? node.type) === b.TYPE_FOLDER)
        .map(node => ({ guid: node.guid, name: node.title || 'Untitled', canDelete: true }));
    };
    async function backupStandardToolbar(map, folders) {
      if (map.toolbarBackup?.complete) return;
      const b = PlacesUtils.bookmarks;
      // Keep the collection outside the toolbar before moving its children.
      const root = await b.fetch(map.rootGuid);
      let ancestor = root;
      while (ancestor?.parentGuid) {
        if (ancestor.parentGuid === b.toolbarGuid) {
          await b.update({ guid: root.guid, parentGuid: b.menuGuid, index: b.DEFAULT_INDEX });
          break;
        }
        ancestor = await b.fetch(ancestor.parentGuid);
      }
      if (!map.toolbarBackup) {
        const tree = await PlacesUtils.promiseBookmarksTree(b.toolbarGuid);
        const items = (tree.children || []).map(node => node.guid);
        if (!items.length) { map.toolbarBackup = { complete: true }; return; }
        let name = BACKUP_TITLE;
        for (let suffix = 2; folders.some(folder => folder.name === name); suffix++) name = `${BACKUP_TITLE} (${suffix})`;
        map.toolbarBackup = { guid: PlacesUtils.history.makeGuid(), name, items, complete: false };
        // Persist the destination and original GUIDs before the first bookmark move.
        save(map);
      }
      const backup = map.toolbarBackup;
      let folder = await b.fetch(backup.guid);
      if (!folder) {
        folder = await b.insert({ guid: backup.guid, parentGuid: map.rootGuid, type: b.TYPE_FOLDER, title: backup.name });
      }
      if (folder.type !== b.TYPE_FOLDER || folder.parentGuid !== map.rootGuid) {
        throw new Error('The original toolbar backup is no longer in Workspace Bookmarks.');
      }
      if (!folders.some(item => item.guid === folder.guid)) {
        folders.push({ guid: folder.guid, name: folder.title || backup.name, canDelete: true });
      }
      for (const guid of backup.items) {
        const item = await b.fetch(guid);
        // A completed move or a user's manual move must not be repeated.
        if (item?.parentGuid === b.toolbarGuid) {
          await b.update({ guid, parentGuid: backup.guid, index: b.DEFAULT_INDEX });
        }
      }
      backup.complete = true;
      delete backup.items;
    }
    const ensureFolders = () => run(async () => {
      requireFloorp();
      const store = getStore();
      if (!Array.isArray(store.data)) throw new Error('Floorp workspace store is not ready');
      const b = PlacesUtils.bookmarks;
      const map = readMapping();
      let root = map.rootGuid && await b.fetch(map.rootGuid);
      if (!root || root.type !== b.TYPE_FOLDER) {
        const menu = await PlacesUtils.promiseBookmarksTree(b.menuGuid);
        const folders = (menu.children || []).filter(node => (node.typeCode ?? node.type) === b.TYPE_FOLDER);
        root = folders.find(node => node.title === ROOT_TITLE);
        root ||= await b.insert({ parentGuid: b.menuGuid, type: b.TYPE_FOLDER, title: ROOT_TITLE });
      }
      map.version = 3;
      map.rootGuid = root.guid;
      map.originalDefaultLocation ??= originalDefaultLocation;
      map.workspaces ??= {};
      map.initializedWorkspaces ??= {};
      const folders = await listFolders(root.guid);
      const ids = new Set(store.data.map(([id]) => id));
      for (const id of Object.keys(map.workspaces)) {
        if (!ids.has(id)) delete map.workspaces[id];
      }
      for (const id of Object.keys(map.initializedWorkspaces)) {
        if (!ids.has(id)) delete map.initializedWorkspaces[id];
      }
      const activeId = Services.wm.getMostRecentWindow('navigator:browser')?.workspacesFuncs?.getSelectedWorkspaceID() || store.defaultID;
      const copyTree = node => {
        const copy = { type: node.typeCode ?? node.type, title: node.title || '' };
        const url = node.uri ?? node.url;
        if (url) copy.url = url;
        if (node.children) copy.children = node.children.filter(child => child.guid !== root.guid).map(copyTree);
        return copy;
      };
      for (const [id, ws] of store.data) {
        let named = folders.find(folder => folder.name === ws.name);
        if (!map.initializedWorkspaces[id]) {
          if (!named) {
            const source = id === activeId
              ? await PlacesUtils.promiseBookmarksTree(b.toolbarGuid)
              : null;
            const guid = PlacesUtils.history.makeGuid();
            const children = (source?.children || []).filter(node => node.guid !== root.guid).map(copyTree);
            await b.insertTree({ guid: root.guid, children: [{ guid, type: b.TYPE_FOLDER, title: ws.name, children }] });
            named = { guid, name: ws.name, canDelete: true };
            folders.push(named);
          }
          map.initializedWorkspaces[id] = true;
          // Save progress for each workspace so an interrupted setup can resume.
          if (!Object.hasOwn(map.workspaces, id)) map.workspaces[id] = named.guid;
          save(map);
        }
        if (!Object.hasOwn(map.workspaces, id) || (map.workspaces[id] && !folders.some(folder => folder.guid === map.workspaces[id]))) {
          // Resolve missing or invalid bindings by name. Explicit unbinding stays unbound.
          map.workspaces[id] = named?.guid ?? null;
        }
      }
      // Provision the active workspace from the original toolbar before archiving it.
      await backupStandardToolbar(map, folders);
      save(map);
      return { ...map, folders };
    });
    const refreshAll = () => Promise.all([...records.values()].map(update));
    async function createToolbar(name) {
      name = name.trim();
      if (!name) throw new Error('Enter a toolbar name.');
      await ensureFolders();
      const folder = await run(async () => {
        const map = readMapping();
        if ((await listFolders(map.rootGuid)).some(item => item.name === name)) {
          throw new Error('A toolbar with this name already exists.');
        }
        return PlacesUtils.bookmarks.insert({ parentGuid: map.rootGuid, type: PlacesUtils.bookmarks.TYPE_FOLDER, title: name });
      });
      await refreshAll();
      return folder.guid;
    }
    async function renameToolbar(guid, name) {
      name = name.trim();
      if (!name) throw new Error('Enter a toolbar name.');
      await ensureFolders();
      await run(async () => {
        const folders = await listFolders(readMapping().rootGuid);
        const folder = folders.find(item => item.guid === guid);
        if (!folder) throw new Error('The bookmark toolbar no longer exists.');
        if (folders.some(item => item.guid !== guid && item.name === name)) {
          throw new Error('A toolbar with this name already exists.');
        }
        if (folder.name !== name) await PlacesUtils.bookmarks.update({ guid, title: name });
      });
      await refreshAll();
    }
    async function copyToolbar(sourceGuid, targetGuid) {
      if (sourceGuid === targetGuid) throw new Error('Choose a different toolbar.');
      await ensureFolders();
      await run(async () => {
        const map = readMapping();
        const folders = await listFolders(map.rootGuid);
        if (![sourceGuid, targetGuid].every(guid => folders.some(folder => folder.guid === guid))) {
          throw new Error('The bookmark toolbar no longer exists.');
        }
        const source = await PlacesUtils.promiseBookmarksTree(sourceGuid);
        const clone = node => {
          const result = { type: node.typeCode ?? node.type, title: node.title || '' };
          const url = node.uri ?? node.url;
          if (url) result.url = url;
          if (node.children) result.children = node.children.map(clone);
          return result;
        };
        const children = (source.children || []).map(clone);
        if (children.length) await PlacesUtils.bookmarks.insertTree({ guid: targetGuid, children });
      });
      await refreshAll();
    }
    async function bindFolder(workspaceId, guid) {
      await ensureFolders();
      await run(async () => {
        if (!(getStore().data || []).some(([id]) => id === workspaceId)) throw new Error('Unknown workspace');
        const map = readMapping();
        if (guid && !(await listFolders(map.rootGuid)).some(folder => folder.guid === guid)) throw new Error('Unknown bookmark folder');
        map.workspaces[workspaceId] = guid || null;
        save(map);
      });
      await refreshAll();
    }
    async function deleteFolder(guid) {
      await ensureFolders();
      await run(async () => {
        const map = readMapping();
        const folder = (await listFolders(map.rootGuid)).find(item => item.guid === guid);
        if (!folder?.canDelete) throw new Error('This bookmark folder cannot be deleted');
        await PlacesUtils.bookmarks.remove(guid);
        for (const id of Object.keys(map.workspaces)) {
          if (map.workspaces[id] === guid) map.workspaces[id] = null;
        }
        save(map);
      });
      await refreshAll();
    }
    async function renderMenu(rec) {
      const token = ++rec.menuToken;
      const map = await ensureFolders();
      if (closed || rec.detached || rec.win.closed || token !== rec.menuToken) return;
      if (!map.folders.some(folder => folder.guid === rec.copySource)) rec.copySource = null;
      const workspaceId = rec.win.workspacesFuncs?.getSelectedWorkspaceID();
      const workspaces = getStore().data || [];
      const workspace = workspaces.find(([id]) => id === workspaceId)?.[1];
      rec.menuBody.replaceChildren();
      const doc = rec.win.document;
      const heading = doc.createXULElement('label');
      heading.setAttribute('value', workspace ? `Bookmark toolbar for “${workspace.name}”` : 'Bookmark toolbar');
      heading.setAttribute('style', 'font-weight: 600; margin: 4px 6px 10px;');
      rec.menuBody.appendChild(heading);
      for (const folder of map.folders) {
        const row = doc.createXULElement('hbox');
        row.setAttribute('align', 'center');
        row.setAttribute('class', 'workspace-toolbar-row');
        row.setAttribute('data-bound', String(map.workspaces[workspaceId] === folder.guid));
        row.setAttribute('data-folder-guid', folder.guid);
        const checkbox = doc.createXULElement('checkbox');
        checkbox.setAttribute('label', folder.name);
        checkbox.setAttribute('flex', '1');
        checkbox.setAttribute('style', 'min-width: 0; margin: 4px 6px;');
        checkbox.checked = map.workspaces[workspaceId] === folder.guid;
        checkbox.disabled = !workspace;
        checkbox.addEventListener('command', () => {
          if (rec.win.workspacesFuncs?.getSelectedWorkspaceID() !== workspaceId) { rec.menu.hidePopup(); return; }
          bindFolder(workspaceId, checkbox.checked ? folder.guid : '').then(() => renderMenu(rec)).catch(Cu.reportError);
        });
        row.appendChild(checkbox);
        const bindings = doc.createXULElement('hbox');
        bindings.setAttribute('align', 'center');
        bindings.setAttribute('style', 'gap: 4px; margin-inline: 6px;');
        for (const [id, ws] of workspaces) {
          if (map.workspaces[id] !== folder.guid) continue;
          // Reuse Floorp's resolved icon, including its current icon registry.
          const nativeItem = doc.getElementById(`workspace-${id}`)
            || (id === workspaceId ? doc.getElementById('workspaces-toolbar-button') : null);
          const image = nativeItem && (nativeItem.style.listStyleImage || rec.win.getComputedStyle(nativeItem).listStyleImage);
          const badge = doc.createXULElement(image && image !== 'none' ? 'image' : 'label');
          badge.setAttribute('tooltiptext', id === workspaceId ? `${ws.name} (current workspace)` : ws.name);
          badge.setAttribute('aria-label', ws.name);
          badge.setAttribute('data-workspace-id', id);
          badge.setAttribute('style', 'width: 16px; height: 16px; margin: 0; padding: 3px; box-sizing: content-box; border-radius: 4px; -moz-context-properties: fill, fill-opacity; fill: currentColor;');
          if (image && image !== 'none') badge.style.listStyleImage = image;
          else badge.setAttribute('value', Array.from(ws.name || '?')[0]);
          if (id === workspaceId) badge.style.backgroundColor = 'var(--toolbarbutton-active-background, rgba(127, 127, 127, .25))';
          bindings.appendChild(badge);
        }
        row.appendChild(bindings);
        const copy = doc.createXULElement('toolbarbutton');
        const pasting = !!rec.copySource;
        const isSource = rec.copySource === folder.guid;
        copy.setAttribute('aria-label', pasting && !isSource ? 'Paste bookmarks' : 'Copy bookmarks');
        copy.setAttribute('image', context.extension.getURL(pasting && !isSource ? 'icons/paste.svg' : 'icons/copy.svg'));
        copy.setAttribute('tooltiptext', pasting && !isSource ? `Append copied bookmarks to “${folder.name}”` : `Copy bookmarks from “${folder.name}”`);
        copy.setAttribute('class', 'toolbarbutton-1 workspace-toolbar-icon');
        copy.disabled = isSource;
        copy.addEventListener('command', async () => {
          if (rec.copyBusy) return;
          if (!rec.copySource) {
            rec.copySource = folder.guid;
            await renderMenu(rec);
            return;
          }
          rec.copyBusy = true;
          copy.disabled = true;
          try {
            await copyToolbar(rec.copySource, folder.guid);
            rec.copySource = null;
          } catch (err) {
            Services.prompt.alert(rec.win, 'Copy bookmarks', err.message || 'Could not copy bookmarks.');
          } finally {
            rec.copyBusy = false;
            await renderMenu(rec);
          }
        });
        row.appendChild(copy);
        const rename = doc.createXULElement('toolbarbutton');
        rename.setAttribute('image', context.extension.getURL('icons/rename.svg'));
        rename.setAttribute('tooltiptext', `Rename “${folder.name}”`);
        rename.setAttribute('aria-label', `Rename toolbar ${folder.name}`);
        rename.setAttribute('class', 'toolbarbutton-1 workspace-toolbar-icon');
        const renameError = doc.createXULElement('description');
        renameError.hidden = true;
        renameError.setAttribute('role', 'alert');
        renameError.setAttribute('style', 'max-width: 320px; margin: 4px 6px; color: #d70022;');
        let editor = null;
        let renaming = false;
        const cancelRename = () => {
          editor.replaceWith(checkbox);
          editor = null;
          renameError.hidden = true;
          rename.setAttribute('image', context.extension.getURL('icons/rename.svg'));
          rename.setAttribute('tooltiptext', `Rename “${folder.name}”`);
          rename.setAttribute('aria-label', `Rename toolbar ${folder.name}`);
          rename.style.color = '';
          rename.focus();
        };
        const saveRename = async () => {
          if (renaming) return;
          renaming = true;
          editor.disabled = rename.disabled = true;
          renameError.hidden = true;
          try {
            await renameToolbar(folder.guid, editor.value);
            await renderMenu(rec);
          } catch (error) {
            renameError.textContent = error.message || 'Could not rename the bookmark toolbar.';
            renameError.hidden = false;
            editor.disabled = rename.disabled = false;
            editor.focus();
          } finally { renaming = false; }
        };
        rename.addEventListener('command', () => {
          if (editor) { saveRename(); return; }
          editor = doc.createElementNS('http://www.w3.org/1999/xhtml', 'input');
          editor.type = 'text';
          editor.value = folder.name;
          editor.setAttribute('aria-label', 'Toolbar name');
          editor.setAttribute('style', 'flex: 1; min-width: 0; width: 0; margin-inline: 6px; padding: 5px;');
          editor.addEventListener('keydown', event => {
            if (event.isComposing || !['Enter', 'Escape'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (renaming) return;
            if (event.key === 'Enter') saveRename();
            else cancelRename();
          });
          checkbox.replaceWith(editor);
          rename.setAttribute('image', context.extension.getURL('icons/confirm.svg'));
          rename.setAttribute('tooltiptext', 'Save toolbar name');
          rename.setAttribute('aria-label', 'Save toolbar name');
          rename.style.color = '#16833b';
          editor.focus();
          editor.select();
        });
        row.appendChild(rename);
        const remove = doc.createXULElement('toolbarbutton');
        remove.setAttribute('image', context.extension.getURL('icons/delete.svg'));
        remove.setAttribute('tooltiptext', `Delete “${folder.name}” and its bookmarks`);
        remove.setAttribute('aria-label', `Delete folder ${folder.name}`);
        remove.setAttribute('class', 'toolbarbutton-1 workspace-toolbar-icon');
        remove.disabled = !folder.canDelete;
        remove.addEventListener('command', () => {
          if (!Services.prompt.confirm(rec.win, 'Delete folder', `Delete “${folder.name}” and all its bookmarks? All workspaces using this folder will be unbound.`)) return;
          deleteFolder(folder.guid).then(() => renderMenu(rec)).catch(Cu.reportError);
        });
        row.appendChild(remove);
        rec.menuBody.appendChild(row);
        rec.menuBody.appendChild(renameError);
      }
      const addRow = doc.createXULElement('hbox');
      addRow.setAttribute('align', 'center');
      addRow.setAttribute('style', 'margin: 4px 0;');
      const add = doc.createXULElement('toolbarbutton');
      add.setAttribute('label', '+');
      add.setAttribute('class', 'toolbarbutton-1 workspace-toolbar-add');
      add.setAttribute('flex', '1');
      add.setAttribute('tooltiptext', 'Add bookmark toolbar');
      add.setAttribute('aria-label', 'Add bookmark toolbar');
      addRow.appendChild(add);
      const error = doc.createXULElement('description');
      error.hidden = true;
      error.setAttribute('role', 'alert');
      error.setAttribute('style', 'max-width: 320px; margin: 4px 6px; color: #d70022;');
      add.addEventListener('command', () => {
        const input = doc.createElementNS('http://www.w3.org/1999/xhtml', 'input');
        input.type = 'text';
        input.placeholder = 'Toolbar name';
        input.setAttribute('aria-label', 'Toolbar name');
        input.setAttribute('style', 'flex: 1; min-width: 0; width: 0; padding: 5px;');
        const submit = doc.createXULElement('toolbarbutton');
        submit.setAttribute('label', '✓');
        submit.setAttribute('class', 'toolbarbutton-1');
        submit.setAttribute('tooltiptext', 'Create bookmark toolbar');
        submit.setAttribute('aria-label', 'Create bookmark toolbar');
        submit.setAttribute('style', 'color: #16833b; font-size: 18px; font-weight: bold;');
        let saving = false;
        const saveToolbar = async () => {
          if (saving) return;
          saving = true;
          input.disabled = submit.disabled = true;
          error.hidden = true;
          try {
            await createToolbar(input.value);
            await renderMenu(rec);
          } catch (err) {
            error.textContent = err.message || 'Could not create the bookmark toolbar.';
            error.hidden = false;
            input.disabled = submit.disabled = false;
            input.focus();
          } finally { saving = false; }
        };
        submit.addEventListener('command', saveToolbar);
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (saving) return;
            if (event.key === 'Enter') saveToolbar();
            else { addRow.replaceChildren(add); error.hidden = true; add.focus(); }
          }
        });
        addRow.replaceChildren(input, submit);
        input.focus();
      });
      rec.menuBody.append(addRow, error);
      const hint = doc.createXULElement('description');
      hint.textContent = 'Choose a bookmark toolbar for this workspace.';
      hint.setAttribute('style', 'max-width: 320px; margin: 10px 6px 4px; opacity: .7;');
      rec.menuBody.appendChild(hint);
    }
    function installSelector(rec) {
      const doc = rec.win.document;
      const button = doc.createXULElement('toolbarbutton');
      button.id = 'floorp-workspace-folder-selector';
      button.setAttribute('class', 'toolbarbutton-1');
      button.setAttribute('label', 'Bookmark toolbars');
      button.setAttribute('aria-label', 'Choose a bookmark toolbar');
      button.setAttribute('image', context.extension.getURL('icons/selector.svg'));
      button.setAttribute('tooltiptext', 'Choose a bookmark toolbar for the current workspace');
      button.setAttribute('style', 'margin-inline-start: auto; flex-shrink: 0; -moz-context-properties: fill, fill-opacity; fill: currentColor;');
      const menu = doc.createXULElement('panel');
      menu.id = 'floorp-workspace-folder-menu';
      menu.setAttribute('type', 'arrow');
      menu.setAttribute('orient', 'vertical');
      const body = doc.createXULElement('vbox');
      body.setAttribute('style', 'min-width: 280px; max-height: 60vh; overflow-y: auto; padding: 8px;');
      const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
      style.textContent = `
        #floorp-workspace-folder-menu .workspace-toolbar-row {
          min-height: 32px;
          margin-block: 2px;
          padding: 2px;
          border: 1px solid color-mix(in srgb, currentColor 10%, transparent);
          border-radius: 5px;
          background-color: color-mix(in srgb, currentColor 3%, transparent);
        }
        #floorp-workspace-folder-menu .workspace-toolbar-row[data-bound="true"] {
          background-color: var(--toolbarbutton-active-background, rgba(127, 127, 127, .18));
        }
        #floorp-workspace-folder-menu .workspace-toolbar-row:hover,
        #floorp-workspace-folder-menu .workspace-toolbar-row:focus-within {
          background-color: var(--toolbarbutton-hover-background, rgba(127, 127, 127, .22));
          border-color: color-mix(in srgb, currentColor 25%, transparent);
        }
        #floorp-workspace-folder-menu .workspace-toolbar-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          width: 28px;
          min-width: 28px;
          height: 28px;
          flex-shrink: 0;
          -moz-context-properties: fill, fill-opacity;
          fill: currentColor;
          padding: 6px;
        }
        #floorp-workspace-folder-menu .workspace-toolbar-icon > .toolbarbutton-icon {
          width: 16px;
          height: 16px;
          margin: 0;
          padding: 0;
        }
        #floorp-workspace-folder-menu .workspace-toolbar-icon > .toolbarbutton-text {
          display: none;
        }
        #floorp-workspace-folder-menu .workspace-toolbar-add {
          flex: 1;
          justify-content: center;
          min-height: 32px;
          margin: 0;
          border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
          border-radius: 5px;
          background-color: color-mix(in srgb, currentColor 3%, transparent);
          font-size: 20px;
        }
        #floorp-workspace-folder-menu .workspace-toolbar-add:hover,
        #floorp-workspace-folder-menu .workspace-toolbar-add:focus-visible {
          background-color: var(--toolbarbutton-hover-background, rgba(127, 127, 127, .22));
        }
      `;
      menu.appendChild(style);
      menu.appendChild(body);
      (doc.getElementById('mainPopupSet') || doc.documentElement).appendChild(menu);
      rec.selector = button;
      rec.menu = menu;
      rec.menuBody = body;
      rec.menuToken = 0;
      // Show the selector even if bookmark initialization fails.
      doc.getElementById('PersonalToolbar')?.appendChild(button);
      button.addEventListener('command', () => {
        if (menu.state === 'open' || menu.state === 'showing') menu.hidePopup();
        else menu.openPopup(button, 'after_end', 0, 0, false, false);
      });
      menu.addEventListener('popupshowing', event => {
        if (event.target === menu) rec.copySource = null;
        if (event.target === menu) renderMenu(rec).catch(Cu.reportError);
      });
      rec.removers.push(() => { ++rec.menuToken; menu.hidePopup(); menu.remove(); button.remove(); });
    }
    function apply(rec) {
      if (rec.win.closed || rec.detached) return;
      const toolbar = rec.win.document.getElementById('PersonalToolbar');
      if (toolbar && rec.selector && rec.selector.parentNode !== toolbar) toolbar.appendChild(rec.selector);
      if (!rec.folderGuid) return;
      const view = rec.win.PlacesToolbarHelper?._viewElt?._placesView;
      const place = 'place:parent=' + rec.folderGuid;
      if (view && view.place !== place) view.place = place;
      if (rec.win.document.hasFocus()) Services.prefs.setStringPref('browser.bookmarks.defaultLocation', rec.folderGuid);
      return !!view;
    }
    function retryUpdate(rec) {
      if (closed || rec.detached || rec.win.closed || rec.retryTimer != null) return;
      rec.retryTimer = rec.win.setTimeout(() => {
        rec.retryTimer = null;
        update(rec);
      }, 1000);
    }
    async function update(rec) {
      const token = ++rec.token;
      try {
        if (rec.win.closed || closed || rec.detached) return;
        const enabled = Services.prefs.getBoolPref('floorp.workspaces.enabled', false);
        const ctx = rec.win.workspacesFuncs;
        if (!enabled) {
          rec.folderGuid = PlacesUtils.bookmarks.toolbarGuid;
          apply(rec);
          return;
        }
        const id = ctx?.getSelectedWorkspaceID();
        // Floorp restores the selected workspace after browser delayed startup.
        // Do not treat a not-yet-restored selection as an unbound workspace.
        if (!id || !getStore().data?.some(([workspaceId]) => workspaceId === id)) {
          retryUpdate(rec);
          return;
        }
        const map = await ensureFolders();
        if (closed || token !== rec.token || rec.win.closed || rec.detached) return;
        if (ctx.getSelectedWorkspaceID() !== id) { retryUpdate(rec); return; }
        if (rec.workspaceId !== id) rec.menu?.hidePopup();
        rec.workspaceId = id;
        rec.folderGuid = map.workspaces[id] || PlacesUtils.bookmarks.toolbarGuid;
        await rec.win.PlacesToolbarHelper.init();
        if (closed || token !== rec.token || rec.win.closed || rec.detached) return;
        if (!apply(rec)) { retryUpdate(rec); return; }
        if (rec.retryTimer != null) {
          rec.win.clearTimeout(rec.retryTimer);
          rec.retryTimer = null;
        }
        await rec.win.BookmarkingUI.updateEmptyToolbarMessage();
      } catch (error) { Cu.reportError(error); retryUpdate(rec); }
    }
    function install(win) {
      if (records.has(win) || win.document.documentURI !== 'chrome://browser/content/browser.xhtml') return;
      win.__floorpWorkspaceBarController?.dispose();
      const rec = { win, token: 0, folderGuid: null, workspaceId: null, removers: [], detached: false, retryTimer: null };
      rec.dispose = () => {
        rec.detached = true;
        if (rec.retryTimer != null) win.clearTimeout(rec.retryTimer);
        for (const remove of rec.removers) remove();
      };
      win.__floorpWorkspaceBarController = rec;
      records.set(win, rec);
      installSelector(rec);
      const listen = (target, name, fn) => {
        target.addEventListener(name, fn);
        rec.removers.push(() => target.removeEventListener(name, fn));
      };
      listen(win.gBrowser.tabContainer, 'TabSelect', () => update(rec));
      listen(win, 'focus', () => apply(rec));
      listen(win, 'activate', () => apply(rec));
      listen(win, 'toolbarvisibilitychange', () => win.setTimeout(() => apply(rec), 0));
      listen(win, 'aftercustomization', () => win.setTimeout(() => apply(rec), 0));
      const helper = win.PlacesToolbarHelper;
      const oldInit = helper._realInit;
      const patchedInit = function (...args) { const result = oldInit.apply(this, args); apply(rec); return result; };
      helper._realInit = patchedInit;
      rec.removers.push(() => { if (helper._realInit === patchedInit) helper._realInit = oldInit; });
      for (const name of ['bookmarkPage', 'bookmarkCurrentPages']) {
        const hook = win.PlacesCommandHook;
        const original = hook[name];
        if (typeof original !== 'function') continue;
        const patched = function (...args) {
          if (rec.folderGuid) Services.prefs.setStringPref('browser.bookmarks.defaultLocation', rec.folderGuid);
          return original.apply(this, args);
        };
        hook[name] = patched;
        rec.removers.push(() => { if (hook[name] === patched) hook[name] = original; });
      }
      listen(win, 'unload', event => { if (event.target !== win.document) return; rec.dispose(); records.delete(win); });
      update(rec);
    }
    const allWindows = () => {
      for (const win of Services.wm.getEnumerator('navigator:browser')) if (win.gBrowserInit?.delayedStartupFinished) install(win);
    };
    const observer = (subject, topic) => {
      if (topic === 'browser-delayed-startup-finished') install(subject);
      else for (const rec of records.values()) update(rec);
    };
    function start() {
      requireFloorp();
      if (started) return;
      started = true;
      // Use Places' own visibility setting so rebuilding the toolbar or
      // opening the extension popup cannot bring Other Bookmarks back.
      Services.prefs.setBoolPref('browser.toolbars.bookmarks.showOtherBookmarks', false);
      Services.obs.addObserver(observer, 'browser-delayed-startup-finished');
      Services.obs.addObserver(observer, 'floorp.workspaces.changed');
      Services.prefs.addObserver(STORE, observer);
      Services.prefs.addObserver('floorp.workspaces.enabled', observer);
      allWindows();
    }
    context.callOnClose({ close() {
      closed = true;
      if (!started) return;
      Services.obs.removeObserver(observer, 'browser-delayed-startup-finished');
      Services.obs.removeObserver(observer, 'floorp.workspaces.changed');
      Services.prefs.removeObserver(STORE, observer);
      Services.prefs.removeObserver('floorp.workspaces.enabled', observer);
      for (const rec of records.values()) {
        if (rec.win.__floorpWorkspaceBarController === rec) {
          rec.folderGuid = PlacesUtils.bookmarks.toolbarGuid;
          apply(rec);
          rec.dispose();
          delete rec.win.__floorpWorkspaceBarController;
        } else rec.dispose();
      }
      records.clear();
      Services.prefs.setStringPref('browser.bookmarks.defaultLocation', originalDefaultLocation);
    } });
    return { floorpWorkspaceBars: {
      async getCompatibility() { return { supported: isSupported() }; },
      async start() { start(); await Promise.all([...records.values()].map(update)); },
      async getState() {
        start();
        const map = await ensureFolders();
        const win = Services.wm.getMostRecentWindow('navigator:browser');
        const currentId = win?.workspacesFuncs?.getSelectedWorkspaceID();
        return { currentId, folders: map.folders, bars: (getStore().data || []).map(([id, ws]) => ({ id, name: ws.name, folderGuid: map.workspaces[id] })) };
      },
      createToolbar,
      renameToolbar,
      copyToolbar,
      bindFolder,
      deleteFolder,
      async openFolder(guid) {
        requireFloorp();
        if (!(await PlacesUtils.bookmarks.fetch(guid))) throw new Error('Folder does not exist');
        Services.wm.getMostRecentWindow('navigator:browser').PlacesCommandHook.showPlacesOrganizer([guid]);
      },
    } };
  }
};
