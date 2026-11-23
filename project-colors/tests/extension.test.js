// node --test project-colors/tests: the parts of project-colors that need no VS Code window,
// over a stub of the `vscode` module and a scratch folder of projects.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'project-colors-'))
const settings = { peacock: { darkenLightenPercentage: 10, favoriteColors: [{ value: '#06130d' }, { value: '#003049' }, { value: '#4e1b0a' }, { value: '#0a0908' }] } }
const vscode = {
  env: { remoteName: 'wsl' },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: scratch } }],
    getConfiguration: (section) => ({ get: (key) => settings[section]?.[key] }),
  },
}
const load = Module._load
Module._load = function (request, ...rest) {
  return request === 'vscode' ? vscode : load.call(this, request, ...rest)
}
const { lighten, badgeShade, freeColor, projectOf, titleOf, colorOf, saveColor } = require('../extension.js').internal

const project = (name, settingsText) => {
  fs.mkdirSync(path.join(scratch, name, '.git'), { recursive: true })
  if (settingsText !== undefined) {
    fs.mkdirSync(path.join(scratch, name, '.vscode'), { recursive: true })
    fs.writeFileSync(path.join(scratch, name, '.vscode', 'settings.json'), settingsText)
  }
  return { name, dir: path.join(scratch, name) }
}

// Within 1 per channel: a channel landing on exactly .5 rounds either way, by float noise in tinycolor2's path.
const near = (actual, expected) => {
  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [a, e] = [channels(actual), channels(expected)]
  assert.ok(a.every((v, i) => Math.abs(v - e[i]) <= 1), `${actual} is not ${expected}`)
}

test("lighten gives Peacock's own shade (tinycolor2's lighten, run 2026-11-18)", () => {
  near(lighten('#06130d', 10), '#123a28')
  near(lighten('#003049', 10), '#00527c')
  near(lighten('#0a0908', 10), '#26221f')
  near(lighten('#4e1b0a', 10), '#7b2b10')
  near(lighten('#2a2c3c', 10), '#3f425a')
})

test('the badge shade stands clear of the bar: a mid colour is lightened further than a near-black one', () => {
  near(badgeShade('#06130d', 10), '#123a28') // already clear at Peacock's 10%
  const step = (hex) => parseInt(badgeShade(hex, 10).slice(5, 7), 16) - parseInt(hex.slice(5, 7), 16)
  assert.ok(step('#123d7a') > parseInt(lighten('#123d7a', 10).slice(5, 7), 16) - 0x7a, 'Sapphire gets more than 10%')
})

test('a file belongs to the git repo at the top of the window; other files there to the workspace; outside paths to none', () => {
  project('reader')
  fs.mkdirSync(path.join(scratch, 'notes'), { recursive: true })
  assert.strictEqual(projectOf(path.join(scratch, 'reader', 'src', 'app.js'))?.name, 'reader')
  const ws = projectOf(path.join(scratch, 'workspace.md'))
  assert.strictEqual(ws?.workspace, true)
  assert.strictEqual(ws.name, path.basename(scratch))
  assert.strictEqual(projectOf(path.join(scratch, 'notes', 'a.md'))?.workspace, true)
  assert.strictEqual(projectOf(scratch)?.workspace, true, 'a terminal at the top')
  assert.strictEqual(colorOf(ws), undefined, 'the workspace has no colour of its own')
  assert.strictEqual(projectOf('/elsewhere/file.js'), undefined)
})

test('the colour is read from the key Peacock paints from under WSL, and written back keeping the rest', () => {
  const p = project('playground', '{\n  // the project colour\n  "peacock.color": "#111111",\n  "peacock.remoteColor": "#06130D"\n}\n')
  assert.strictEqual(colorOf(p), '#06130d')
  saveColor(p, '#003049')
  const text = fs.readFileSync(path.join(p.dir, '.vscode', 'settings.json'), 'utf8')
  assert.strictEqual(text, '{\n  // the project colour\n  "peacock.color": "#111111",\n  "peacock.remoteColor": "#003049"\n}\n')
})

test('a project with no settings file, or an empty one, gets one holding only its colour', () => {
  const fresh = project('fresh')
  saveColor(fresh, '#4e1b0a')
  assert.strictEqual(fs.readFileSync(path.join(fresh.dir, '.vscode', 'settings.json'), 'utf8'), '{\n  "peacock.remoteColor": "#4e1b0a"\n}\n')
  const other = project('other', '{\n  "editor.tabSize": 2\n}\n')
  saveColor(other, '#0a0908')
  assert.strictEqual(fs.readFileSync(path.join(other.dir, '.vscode', 'settings.json'), 'utf8'), '{\n  "peacock.remoteColor": "#0a0908",\n  "editor.tabSize": 2\n}\n')
  assert.strictEqual(colorOf(other), '#0a0908')
})

test('a free colour is the favourite farthest from those in use, and none is left when all are used', () => {
  assert.strictEqual(freeColor([]), '#06130d')
  const picked = freeColor(['#06130d'])
  assert.notStrictEqual(picked, '#06130d')
  assert.strictEqual(freeColor(['#06130d', '#003049', '#4e1b0a', '#0a0908']), undefined)
})

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }))

test('the title names the workspace, then the project unless it is the workspace, then the file', () => {
  assert.strictEqual(titleOf({ name: 'playground', dir: '/w/playground' }, 'main'), 'w:main${separator}playground${separator}${activeEditorShort}')
  assert.strictEqual(titleOf({ name: 'main', dir: '/w', workspace: true }, 'main'), 'w:main${separator}${activeEditorShort}')
})
