// node --test project-colors/tests: the parts of project-colors that need no VS Code window,
// over a stub of the `vscode` module and a scratch folder of projects.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'project-colors-'))
const settings = {
  peacock: { darkenLightenPercentage: 10, favoriteColors: [{ value: '#06130D', accent: '#34D399' }, { value: '#003049' }, { value: '#4e1b0a' }, { value: '#0a0908' }] },
  workbench: {},
}
const vscode = {
  TerminalProfile: class { constructor(options) { this.options = options } },
  ConfigurationTarget: { Workspace: 2 },
  env: { remoteName: 'wsl' },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: scratch } }],
    // The window's workspace settings: `get`, `inspect` and `update` all on `settings`.
    getConfiguration: (section) => ({
      get: (key) => settings[section]?.[key],
      inspect: (key) => ({ workspaceValue: settings[section]?.[key] }),
      update: async (key, value) => { (settings[section] ??= {})[key] = value },
    }),
  },
}
const load = Module._load
Module._load = function (request, ...rest) {
  return request === 'vscode' ? vscode : load.call(this, request, ...rest)
}
const { isUsersChoice, lighten, ink, accentOf, freeColor, projectOf, colorOf, saveColor, saveAccent, OURS, ourColors, setOurColors, PROFILE, terminalProfile } = require('../extension.js').internal

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

test("a colour's accent is the one paired with it in the favourites, else derived from its hue; a grey gives silver", () => {
  assert.strictEqual(accentOf('#06130d'), '#34d399', 'paired, whatever the case')
  near(accentOf('#003049'), '#47b3eb') // no pair: hue 200.5° at S80% L60%
  near(accentOf('#4e1b0a'), '#eb7047') // hue 15°
  assert.strictEqual(accentOf('#2a2c3c'), '#d4d8de', 'S18%: a grey')
  assert.strictEqual(accentOf('#0a0908'), '#d4d8de')
})

test('the text on an accent is black or white, whichever has the higher contrast', () => {
  for (const light of ['#ffb703', '#34d399', '#e5c07b', '#ff4d79', '#818cf8', '#d4d8de']) assert.strictEqual(ink(light), '#000000', light)
  for (const dark of ['#06130d', '#1b0108', '#0e1729', '#7c3aed', '#b91c1c']) assert.strictEqual(ink(dark), '#ffffff', dark)
})

test('a project colour paints the badge and the active tab and activity bar lines in its accent, the counts neutral', () => {
  assert.deepStrictEqual(ourColors('#06130d'), {
    'statusBarItem.warningBackground': '#34d399',
    'statusBarItem.warningForeground': '#000000',
    'statusBarItem.remoteBackground': '#06130d',
    'tab.activeBorder': '#34d399',
    'activityBar.activeBorder': '#34d399',
    'activityBarTop.activeBorder': '#34d399',
    'activityBarBadge.background': '#e7e7e7',
    'activityBarBadge.foreground': '#000000',
  })
  assert.deepStrictEqual(Object.keys(ourColors('#003049')).sort(), [...OURS].sort(), 'every key painted is one the extension clears')
})

test("our colours replace our old ones, retired ones included, and are cleared without touching Peacock's", async () => {
  settings.workbench.colorCustomizations = { 'titleBar.activeBackground': '#06130d', 'statusBarItem.warningBackground': '#123a28', 'tab.activeBorderTop': '#ffffff' }
  await setOurColors('#06130d')
  assert.deepStrictEqual(settings.workbench.colorCustomizations, { 'titleBar.activeBackground': '#06130d', ...ourColors('#06130d') })
  await setOurColors(undefined)
  assert.deepStrictEqual(settings.workbench.colorCustomizations, { 'titleBar.activeBackground': '#06130d' })
  settings.workbench.colorCustomizations = ourColors('#06130d')
  await setOurColors(undefined)
  assert.strictEqual(settings.workbench.colorCustomizations, undefined, 'nothing left: the setting goes')
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

const settingsOf = (p) => fs.readFileSync(path.join(p.dir, '.vscode', 'settings.json'), 'utf8')

test('the colour is read from the key Peacock paints from under WSL, and written back with its accent, keeping the rest', () => {
  const p = project('playground', '{\n  // the project colour\n  "peacock.color": "#111111",\n  "peacock.remoteColor": "#06130D"\n}\n')
  assert.strictEqual(colorOf(p), '#06130d')
  saveColor(p, '#003049')
  assert.strictEqual(settingsOf(p), `{\n  // the project colour\n  "peacock.color": "#111111",\n  "peacock.remoteColor": "#003049",\n  "projectColors.accent": "${accentOf('#003049')}"\n}\n`)
})

test('a project with no settings file, or an empty one, gets one holding only its colour and accent', () => {
  const fresh = project('fresh')
  saveColor(fresh, '#4e1b0a')
  assert.strictEqual(settingsOf(fresh), `{\n  "peacock.remoteColor": "#4e1b0a",\n  "projectColors.accent": "${accentOf('#4e1b0a')}"\n}\n`)
  const other = project('other', '{\n  "editor.tabSize": 2\n}\n')
  saveColor(other, '#0a0908')
  assert.strictEqual(settingsOf(other), '{\n  "peacock.remoteColor": "#0a0908",\n  "projectColors.accent": "#d4d8de",\n  "editor.tabSize": 2\n}\n')
  assert.strictEqual(colorOf(other), '#0a0908')
})

test("the accent is written beside the project's colour, only when it changes, and never into the workspace's settings", () => {
  const p = project('reader', '{\n\t"editor.tabSize": 2,\n\t"peacock.remoteColor": "#06130d", // forest\n\t"files.trimTrailingWhitespace": true\n}\n')
  assert.strictEqual(saveAccent(p, '#06130d'), true)
  assert.strictEqual(settingsOf(p), '{\n\t"editor.tabSize": 2,\n\t"peacock.remoteColor": "#06130d",\n\t"projectColors.accent": "#34d399", // forest\n\t"files.trimTrailingWhitespace": true\n}\n')
  const written = fs.statSync(path.join(p.dir, '.vscode', 'settings.json')).mtimeMs
  assert.strictEqual(saveAccent(p, '#06130D'), false, 'same accent: nothing written')
  assert.strictEqual(fs.statSync(path.join(p.dir, '.vscode', 'settings.json')).mtimeMs, written)
  assert.strictEqual(saveAccent(p, '#003049'), true)
  assert.match(settingsOf(p), new RegExp(`"projectColors.accent": "${accentOf('#003049')}", // forest`), 'a changed accent replaces its line')

  const last = project('last', '{\n  "peacock.remoteColor": "#06130d"\n}')
  saveAccent(last, '#06130d')
  assert.strictEqual(settingsOf(last), '{\n  "peacock.remoteColor": "#06130d",\n  "projectColors.accent": "#34d399"\n}')

  const ws = projectOf(path.join(scratch, 'workspace.md'))
  assert.ok(!saveAccent(ws, '#06130d'))
  assert.ok(!fs.existsSync(path.join(scratch, '.vscode')), 'the workspace root gets no accent')
  const bare = project('bare')
  assert.ok(!saveAccent(bare, undefined))
  assert.ok(!fs.existsSync(path.join(bare.dir, '.vscode')), 'no colour, no accent')
})

test('a free colour is the favourite farthest from those in use, and none is left when all are used', () => {
  assert.strictEqual(freeColor([]), '#06130d')
  const picked = freeColor(['#06130d'])
  assert.notStrictEqual(picked, '#06130d')
  assert.strictEqual(freeColor(['#06130d', '#003049', '#4e1b0a', '#0a0908']), undefined)
})

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }))

test("each terminal on the profile gets its own FLOW_TERMINAL id, and VS Code's own shell and folder", () => {
  const [a, b] = [terminalProfile(), terminalProfile()]
  assert.match(a.options.env.FLOW_TERMINAL, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.notStrictEqual(a.options.env.FLOW_TERMINAL, b.options.env.FLOW_TERMINAL)
  assert.deepStrictEqual(Object.keys(a.options), ['env'], 'a shellPath or cwd here would override the default shell, or a split\'s folder')
})

test("the favourites are the 17 approved pairs, Peacock leaves the colours it manages that we paint alone, and the accent setting is declared", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  const defaults = manifest.contributes.configurationDefaults
  assert.deepStrictEqual(defaults['peacock.favoriteColors'].map((f) => [f.name, f.value, f.accent]), [
    ['Graphite', '#090b0c', '#e5c07b'], ['Jet', '#0a0908', '#ffb703'], ['Onyx', '#0c090c', '#c4b5fd'],
    ['Charcoal', '#14161a', '#67e8f9'], ['Gunmetal', '#1b222a', '#7cb7ff'], ['Wine', '#1b0108', '#fb7185'],
    ['Mahogany', '#221010', '#ff8a65'], ['Oxblood', '#360a07', '#ff6b4a'], ['Raspberry', '#35111e', '#f472b6'],
    ['Crimson', '#380808', '#f87171'], ['Burgundy', '#4d0218', '#ff4d79'], ['Forest', '#06130d', '#34d399'],
    ['Jade', '#0b2620', '#5eead4'], ['Midnight', '#030712', '#60a5fa'], ['Ocean', '#000e15', '#38bdf8'],
    ['Navy', '#0e1729', '#818cf8'], ['Aubergine', '#2a0f23', '#e879f9'],
  ])
  // Peacock 4.5.1's ColorSettings: it rewrites or deletes each of these on every repaint unless excluded.
  const peacocks = ['statusBarItem.remoteBackground', 'activityBar.activeBorder', 'activityBarTop.activeBorder', 'activityBarBadge.background', 'activityBarBadge.foreground', 'tab.activeBorder']
  assert.deepStrictEqual(OURS.filter((k) => peacocks.includes(k)).sort(), [...defaults['peacock.excludedSettings']].sort())
  assert.strictEqual(manifest.contributes.configuration.properties['projectColors.accent']?.type, 'string')
})

test('package.json contributes the profile the code registers, under the title flow-v2 sets as the default', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  assert.deepStrictEqual(manifest.contributes.terminal.profiles.map((p) => [p.id, p.title]), [[PROFILE, 'bash (Flow)']])
  assert.ok(manifest.activationEvents.includes(`onTerminalProfile:${PROFILE}`))
})

test("a colour Peacock writes back is the user's choice only when it is neither ours nor the window's old one", () => {
  // The reload of 2026-11-24: flow-v2 painting over reader's leftover colour, Peacock echoing the leftover.
  assert.strictEqual(isUsersChoice('#090b0c', '#06130d', '#090b0c'), false, "the old colour echoed back")
  assert.strictEqual(isUsersChoice('#06130d', '#06130d', '#090b0c'), false, 'our own write')
  assert.strictEqual(isUsersChoice('#221010', '#06130d', '#090b0c'), true, 'a colour picked through Peacock')
  assert.strictEqual(isUsersChoice('#221010', undefined, '#090b0c'), true, 'a first colour for a project with none')
  assert.strictEqual(isUsersChoice(undefined, '#06130d', '#090b0c'), false, 'a cleared colour')
})
