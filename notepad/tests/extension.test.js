// node --test notepad/tests: the parts of notepad that need no VS Code window, over a stub of the
// `vscode` module and a scratch folder holding 2 projects and a loose folder.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-'))
const vscode = { env: { remoteName: 'wsl' }, workspace: { workspaceFolders: [{ uri: { fsPath: scratch } }] } }
const load = Module._load
Module._load = function (request, ...rest) {
  return request === 'vscode' ? vscode : load.call(this, request, ...rest)
}
const { places, placeOf, listing, sessionOf, headerOf } = require('../extension.js').internal

const write = (file, text) => {
  fs.mkdirSync(path.dirname(path.join(scratch, file)), { recursive: true })
  fs.writeFileSync(path.join(scratch, file), text)
}
fs.mkdirSync(path.join(scratch, 'reader', '.git'), { recursive: true })
fs.mkdirSync(path.join(scratch, 'playground', '.git'), { recursive: true })
fs.mkdirSync(path.join(scratch, 'scratch-files'), { recursive: true })
write('reader/.vscode/settings.json', '{\n  "peacock.remoteColor": "#06130d"\n}\n')
write('reader/.notepad/ideas.md', 'loose idea')
write('reader/.notepad/sessions/2026-11-18-a3f8c1.md', '---\nsession: a3f8c1d2\n---\n\nFix the parser.\n')

test('the places are each top-level repo, then the opened folder itself', () => {
  assert.deepStrictEqual(places().map((p) => [p.name, !!p.loose]), [['playground', false], ['reader', false], [path.basename(scratch), true]])
})

test('a file belongs to its project, else to the opened folder', () => {
  assert.strictEqual(placeOf(path.join(scratch, 'reader', 'src', 'a.ts')).name, 'reader')
  assert.strictEqual(placeOf(path.join(scratch, 'scratch-files', 'x.md')).loose, true)
})

test('the listing holds notes and groups, with the project colour, and drops an empty loose folder', () => {
  const list = listing()
  const reader = list.find((p) => p.name === 'reader')
  assert.deepStrictEqual(reader.notes.map((n) => n.title), ['ideas'])
  assert.deepStrictEqual(reader.groups.map((g) => [g.name, g.notes.map((n) => [n.title, n.session])]), [['sessions', [['2026-11-18-a3f8c1', 'a3f8c1d2']]]])
  // Forest #06130d on its lighter shade, #123a28, as the status bar badge draws it.
  assert.strictEqual(reader.head, 'rgba(18, 58, 40, 0.85)')
  assert.strictEqual(list.find((p) => p.name === 'playground').head, undefined)
  assert.ok(!list.some((p) => p.loose))
})

test('a draft is tied by its header, and the header stays when the text is sent', () => {
  const draft = '---\nsession: a3f8c1d2\n---\n\nFix the parser.\n'
  assert.strictEqual(sessionOf(draft), 'a3f8c1d2')
  assert.strictEqual(sessionOf('session: a3f8c1d2\ntext'), undefined)
  assert.strictEqual(headerOf(draft), '---\nsession: a3f8c1d2\n---\n')
  assert.strictEqual(headerOf('no header'), '')
})

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }))
