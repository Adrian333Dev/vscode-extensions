// node --test flow/tests: the Explorer project switcher's settings (explorer.js), no VS Code needed.
const { test } = require('node:test')
const assert = require('node:assert')
const { WORKSPACE, hiddenFor, excludesFor, pickShowing, placeOf, reposFor } = require('../explorer')

const names = ['.flow', '.vscode', 'archive', 'flow-v2', 'playground', 'reader', 'workspace.md']
const projects = ['flow-v2', 'playground', 'reader']

test('a picked project hides every other entry at the top, the workspace\'s own files too unless kept', () => {
  assert.deepStrictEqual(hiddenFor('reader', names, projects, true), ['.flow', '.vscode', 'archive', 'flow-v2', 'playground', 'workspace.md'])
  assert.deepStrictEqual(hiddenFor('reader', names, projects, false), ['flow-v2', 'playground'])
})

test('"Workspace" hides every project; no pick hides nothing', () => {
  assert.deepStrictEqual(hiddenFor(WORKSPACE, names, projects, true), projects)
  assert.deepStrictEqual(hiddenFor(undefined, names, projects, true), [])
})

test('a folder added at the top while a pick is active is hidden on the next reapply', () => {
  assert.ok(hiddenFor('reader', [...names, 'notes'], [...projects, 'notes'], false).includes('notes'))
})

test('a pick writes files.exclude, and search.exclude false so search and Ctrl+P keep the hidden folders', () => {
  const next = excludesFor(['flow-v2', 'playground'], { files: {}, search: {}, hidden: [] }, true)
  assert.deepStrictEqual(next.files, { 'flow-v2': true, playground: true })
  assert.deepStrictEqual(next.search, { 'flow-v2': false, playground: false })
  assert.deepStrictEqual(next.hidden, ['flow-v2', 'playground'])
  assert.deepStrictEqual(excludesFor(['flow-v2'], { files: {}, search: {}, hidden: [] }, false).search, {})
})

test('a project hidden with no record of it is still the switcher\'s: picked, it shows; another pick records it', () => {
  // The state the user's window was left in (2026-11-26): flow-v2 hidden, missing from the record.
  const current = { files: { 'flow-v2': true, reader: true, '.notepad': true }, search: { 'flow-v2': false, reader: false }, hidden: ['reader'] }
  const projects = ['flow-v2', 'playground', 'reader']
  const picked = excludesFor(['playground', 'reader'], current, true, projects)
  assert.deepStrictEqual(picked.files, { '.notepad': true, playground: true, reader: true })
  assert.deepStrictEqual(picked.hidden, ['playground', 'reader'])
  const other = excludesFor(['flow-v2', 'reader'], current, true, projects)
  assert.deepStrictEqual(other.hidden, ['flow-v2', 'reader'])
  assert.deepStrictEqual(other.search, { 'flow-v2': false, reader: false })
})

test('switching removes only the switcher\'s own entries; keys set by hand stay, never taken over', () => {
  const current = {
    files: { 'flow-v2': true, playground: true, '**/*.log': true, archive: true },
    search: { 'flow-v2': false, playground: false, '**/dist': true },
    hidden: ['flow-v2', 'playground'],
  }
  const next = excludesFor(['archive', 'reader'], current, true)
  assert.deepStrictEqual(next.files, { '**/*.log': true, archive: true, reader: true })
  assert.deepStrictEqual(next.search, { '**/dist': true, reader: false })
  assert.deepStrictEqual(next.hidden, ['reader'], 'archive was hidden by hand: not ours to remove later')
})

test('"All" clears every entry the switcher wrote, and nothing else', () => {
  const next = excludesFor([], { files: { reader: true, x: true }, search: { reader: false }, hidden: ['reader'] }, true)
  assert.deepStrictEqual(next, { files: { x: true }, search: {}, hidden: [] })
})

test('a file in a hidden project switches the Explorer to that project', () => {
  assert.strictEqual(pickShowing('reader', 'flow-v2', true), 'reader')
  assert.strictEqual(pickShowing('reader', WORKSPACE, true), 'reader')
})

test('a file already shown, outside the window, or with nothing picked, switches nothing', () => {
  assert.strictEqual(pickShowing('reader', 'reader', true), undefined)
  assert.strictEqual(pickShowing(undefined, 'reader', true), undefined)
  assert.strictEqual(pickShowing('reader', undefined, true), undefined)
})

test("a workspace file switches to \"Workspace\" only when a pick hides the workspace's own files", () => {
  assert.strictEqual(pickShowing(WORKSPACE, 'reader', true), WORKSPACE)
  assert.strictEqual(pickShowing(WORKSPACE, 'reader', false), undefined)
  assert.strictEqual(pickShowing(WORKSPACE, WORKSPACE, true), undefined)
})

const repos = ['.', '.flow', 'flow-v2', 'flow-v2/.flow', 'playground', 'playground/.flow', 'reader', 'reader/.flow']

test('a repository belongs to its first folder\'s project; the window\'s own and a dot-folder\'s to the workspace', () => {
  assert.strictEqual(placeOf('reader/.flow', projects), 'reader')
  assert.strictEqual(placeOf('.', projects), WORKSPACE)
  assert.strictEqual(placeOf('.flow', projects), WORKSPACE)
  assert.strictEqual(placeOf('notes', projects), WORKSPACE) // a repo that isn't a project yet stays with the workspace
})

test('a picked project keeps its repository and its .flow in Source Control and closes the rest', () => {
  const next = reposFor('reader', repos, [], projects)
  assert.deepStrictEqual(next.close, ['.', '.flow', 'flow-v2', 'flow-v2/.flow', 'playground', 'playground/.flow'])
  assert.deepStrictEqual(next.reopen, [])
  assert.deepStrictEqual(next.closed, next.close)
})

test('switching reopens only what the switcher closed; one closed by hand stays closed', () => {
  // reader picked before: 6 closed by the switcher; the user then closed reader/.flow by hand (in neither list)
  const closed = ['.', '.flow', 'flow-v2', 'flow-v2/.flow', 'playground', 'playground/.flow']
  const next = reposFor('flow-v2', ['reader'], closed, projects)
  assert.deepStrictEqual(next.reopen, ['flow-v2', 'flow-v2/.flow'])
  assert.deepStrictEqual(next.close, ['reader'])
  assert.deepStrictEqual(next.closed, ['.', '.flow', 'playground', 'playground/.flow', 'reader'])
  const all = reposFor(undefined, ['flow-v2', 'flow-v2/.flow'], next.closed, projects)
  assert.deepStrictEqual(all, { close: [], reopen: next.closed, closed: [] })
})

test('"Workspace" keeps the workspace\'s own repository and its .flow', () => {
  assert.deepStrictEqual(reposFor(WORKSPACE, repos, [], projects).close, ['flow-v2', 'flow-v2/.flow', 'playground', 'playground/.flow', 'reader', 'reader/.flow'])
})

test('a repository Git opens while a pick is active (a new project) is closed on the next apply', () => {
  const closed = ['.', '.flow', 'flow-v2', 'flow-v2/.flow', 'playground', 'playground/.flow']
  assert.deepStrictEqual(reposFor('reader', ['reader', 'reader/.flow', 'notes'], closed, [...projects, 'notes']).close, ['notes'])
})
