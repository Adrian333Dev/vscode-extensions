// node --test flow/tests: the parts of workspace-projects that need no VS Code window,
// over a stub of the `vscode` module and a scratch folder of projects.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-ext-'))
const settings = {
  flow: { favorites: [{ value: '#06130D', accent: '#34D399' }, { value: '#003049' }, { value: '#4e1b0a' }, { value: '#0a0908' }] },
  workbench: {},
}
// Git's open repositories, by folder: `git.close` takes one out, the API's `openRepository` puts it back.
const gitOpen = new Set()
const gitApi = {
  get repositories() { return [...gitOpen].map((fsPath) => ({ rootUri: { fsPath } })) },
  openRepository: async (uri) => { gitOpen.add(uri.fsPath) },
  onDidOpenRepository: () => ({ dispose() {} }),
}
const vscode = {
  Uri: { file: (fsPath) => ({ fsPath }) },
  commands: { executeCommand: async (command, uri) => { if (command === 'git.close') gitOpen.delete(uri.fsPath) } },
  extensions: { getExtension: (id) => (id === 'vscode.git' ? { isActive: true, exports: { enabled: true, getAPI: () => gitApi } } : undefined) },
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
const { renameOldSettings, showInExplorer, CURRENT, pickedProject, followFile, lighten, ink, windowColors, accentOf, freeColor, projectOf, colorOf, saveColor, saveAccent, OURS, ourColors, setOurColors, PROFILE, terminalProfile } = require('../extension.js').internal

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

test("a project colour paints the bars as Peacock did: the values Peacock 4.5.1 wrote for #06130d (2026-11-25)", () => {
  assert.deepStrictEqual(windowColors('#06130d'), {
    'activityBar.activeBackground': '#123a28', 'activityBar.background': '#123a28', 'activityBar.foreground': '#e7e7e7', 'activityBar.inactiveForeground': '#e7e7e799',
    'activityBarTop.activeBackground': '#123a28', 'activityBarTop.background': '#123a28', 'activityBarTop.foreground': '#e7e7e7', 'activityBarTop.inactiveForeground': '#e7e7e799',
    'commandCenter.border': '#e7e7e799', 'commandCenter.foreground': '#e7e7e7', 'sash.hoverBorder': '#123a28',
    'statusBar.background': '#06130d', 'statusBar.debuggingBackground': '#06130d', 'statusBar.debuggingForeground': '#e7e7e7', 'statusBar.foreground': '#e7e7e7', 'statusBar.inactiveBackground': '#06130d',
    'statusBarItem.hoverBackground': '#123a28', 'statusBarItem.remoteForeground': '#e7e7e7',
    'titleBar.activeBackground': '#06130d', 'titleBar.activeForeground': '#e7e7e7', 'titleBar.inactiveBackground': '#06130d99', 'titleBar.inactiveForeground': '#e7e7e799',
  })
  assert.strictEqual(windowColors('#e5c07b')['titleBar.activeForeground'], '#15202b', 'dark text on a light colour')
})

test('a project colour paints the badge, the active tab, terminal and activity bar lines in its accent, the counts neutral', () => {
  assert.deepStrictEqual(ourColors('#06130d'), {
    ...windowColors('#06130d'),
    'statusBarItem.warningBackground': '#34d399',
    'statusBarItem.warningForeground': '#000000',
    'statusBarItem.remoteBackground': '#06130d',
    'tab.activeBorder': '#34d399',
    'terminal.tab.activeBorder': '#34d399',
    'activityBar.activeBorder': '#34d399',
    'activityBarTop.activeBorder': '#34d399',
    'activityBarBadge.background': '#e7e7e7',
    'activityBarBadge.foreground': '#000000',
  })
  assert.deepStrictEqual(Object.keys(ourColors('#003049')).sort(), [...OURS].sort(), 'every key painted is one the extension clears')
})

test('our colours replace our old ones, retired ones included, and are cleared keeping any set by hand', async () => {
  settings.workbench.colorCustomizations = { 'editor.background': '#000000', 'statusBarItem.warningBackground': '#123a28', 'tab.activeBorderTop': '#ffffff' }
  await setOurColors('#06130d')
  assert.deepStrictEqual(settings.workbench.colorCustomizations, { 'editor.background': '#000000', ...ourColors('#06130d') })
  await setOurColors(undefined)
  assert.deepStrictEqual(settings.workbench.colorCustomizations, { 'editor.background': '#000000' })
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
  assert.strictEqual(colorOf(ws), undefined, 'the workspace has no colour until one is set')
  settings.flow.color = '#0B1A2E'
  assert.strictEqual(colorOf(ws), '#0b1a2e', "the workspace's colour is flow.color in the window's settings")
  settings.flow.color = 'red'
  assert.strictEqual(colorOf(ws), undefined, 'a value that is no colour is none')
  delete settings.flow.color
  assert.strictEqual(projectOf('/elsewhere/file.js'), undefined)
})

test("a dot-folder at the top is never a project, even a git repo (the workspace's own .flow)", () => {
  fs.mkdirSync(path.join(scratch, '.flow', '.git'), { recursive: true })
  const place = projectOf(path.join(scratch, '.flow', 'inbox.md'))
  assert.strictEqual(place?.workspace, true, 'the workspace\'s own file')
  assert.ok(!saveAccent(place, '#06130d'))
  assert.ok(!fs.existsSync(path.join(scratch, '.flow', '.vscode')), 'never painted, never given settings')
  fs.rmSync(path.join(scratch, '.flow'), { recursive: true })
})

test("a colour and accent under the names before 0.7.0 are read, and renamed in place on the next write", () => {
  const p = project('renamed', '{\n  "editor.tabSize": 2,\n  "projectColors.color": "#06130d",\n  "projectColors.accent": "#34d399"\n}\n')
  assert.strictEqual(colorOf(p), '#06130d')
  assert.strictEqual(saveAccent(p, '#06130d'), false, 'same accent: only the names change')
  assert.strictEqual(settingsOf(p), '{\n  "editor.tabSize": 2,\n  "flow.color": "#06130d",\n  "flow.accent": "#34d399"\n}\n')
})

const settingsOf = (p) => fs.readFileSync(path.join(p.dir, '.vscode', 'settings.json'), 'utf8')

test("the colour is read from flow.color, else from Peacock's old keys, and written with its accent, keeping the rest", () => {
  const p = project('playground', '{\n  // the project colour\n  "peacock.color": "#111111",\n  "peacock.remoteColor": "#06130D"\n}\n')
  assert.strictEqual(colorOf(p), '#06130d', "Peacock's WSL key first")
  saveColor(p, '#003049')
  assert.strictEqual(colorOf(p), '#003049')
  assert.strictEqual(settingsOf(p), `{\n  "flow.color": "#003049",\n  "flow.accent": "${accentOf('#003049')}",\n  // the project colour\n  "peacock.color": "#111111",\n  "peacock.remoteColor": "#06130D"\n}\n`)
})

test('a project with no settings file, or an empty one, gets one holding only its colour and accent', () => {
  const fresh = project('fresh')
  saveColor(fresh, '#4e1b0a')
  assert.strictEqual(settingsOf(fresh), `{\n  "flow.color": "#4e1b0a",\n  "flow.accent": "${accentOf('#4e1b0a')}"\n}\n`)
  const other = project('other', '{\n  "editor.tabSize": 2\n}\n')
  saveColor(other, '#0a0908')
  assert.strictEqual(settingsOf(other), '{\n  "flow.color": "#0a0908",\n  "flow.accent": "#d4d8de",\n  "editor.tabSize": 2\n}\n')
  assert.strictEqual(colorOf(other), '#0a0908')
})

test("the accent is written beside the project's colour, only when it changes, and never into the workspace's settings", () => {
  const p = project('reader', '{\n\t"editor.tabSize": 2,\n\t"flow.color": "#06130d", // forest\n\t"files.trimTrailingWhitespace": true\n}\n')
  assert.strictEqual(saveAccent(p, '#06130d'), true)
  assert.strictEqual(settingsOf(p), '{\n\t"editor.tabSize": 2,\n\t"flow.color": "#06130d",\n\t"flow.accent": "#34d399", // forest\n\t"files.trimTrailingWhitespace": true\n}\n')
  const written = fs.statSync(path.join(p.dir, '.vscode', 'settings.json')).mtimeMs
  assert.strictEqual(saveAccent(p, '#06130D'), false, 'same accent: nothing written')
  assert.strictEqual(fs.statSync(path.join(p.dir, '.vscode', 'settings.json')).mtimeMs, written)
  assert.strictEqual(saveAccent(p, '#003049'), true)
  assert.match(settingsOf(p), new RegExp(`"flow.accent": "${accentOf('#003049')}", // forest`), 'a changed accent replaces its line')

  const last = project('last', '{\n  "flow.color": "#06130d"\n}')
  saveAccent(last, '#06130d')
  assert.strictEqual(settingsOf(last), '{\n  "flow.color": "#06130d",\n  "flow.accent": "#34d399"\n}')

  const ws = projectOf(path.join(scratch, 'workspace.md'))
  assert.ok(!saveAccent(ws, '#06130d'))
  assert.ok(!fs.existsSync(path.join(scratch, '.vscode')), 'the workspace root gets no accent')
  const bare = project('bare')
  assert.ok(!saveAccent(bare, undefined))
  assert.ok(!fs.existsSync(path.join(bare.dir, '.vscode')), 'no colour, no accent')
})

test("the workspace's colour and its accent go into the window's settings, never a file at its root", async () => {
  const ws = projectOf(path.join(scratch, 'workspace.md'))
  await saveColor(ws, '#06130d')
  assert.deepStrictEqual([settings.flow.color, settings.flow.accent], ['#06130d', '#34d399'])
  assert.strictEqual(colorOf(ws), '#06130d')
  assert.ok(!fs.existsSync(path.join(scratch, '.vscode')), 'VS Code writes that file, not the extension')
  delete settings.flow.color
  delete settings.flow.accent
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

test('the favourites are the 17 approved pairs, and the colour and accent settings are declared', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  const properties = manifest.contributes.configuration.properties
  assert.deepStrictEqual(properties['flow.favorites'].default.map((f) => [f.name, f.value, f.accent]), [
    ['Graphite', '#090b0c', '#e5c07b'], ['Jet', '#0a0908', '#ffb703'], ['Onyx', '#0c090c', '#c4b5fd'],
    ['Charcoal', '#14161a', '#67e8f9'], ['Gunmetal', '#1b222a', '#7cb7ff'], ['Wine', '#1b0108', '#fb7185'],
    ['Mahogany', '#221010', '#ff8a65'], ['Oxblood', '#360a07', '#ff6b4a'], ['Raspberry', '#35111e', '#f472b6'],
    ['Crimson', '#380808', '#f87171'], ['Burgundy', '#4d0218', '#ff4d79'], ['Forest', '#06130d', '#34d399'],
    ['Jade', '#0b2620', '#5eead4'], ['Midnight', '#030712', '#60a5fa'], ['Ocean', '#000e15', '#38bdf8'],
    ['Navy', '#0e1729', '#818cf8'], ['Aubergine', '#2a0f23', '#e879f9'],
  ])
  assert.strictEqual(properties['flow.accent']?.type, 'string')
  assert.strictEqual(properties['flow.color']?.type, 'string')
  assert.ok(!manifest.contributes.configurationDefaults, "no Peacock settings left")
})

test('the switcher is in the command palette, findable as "Flow: Switch project"; its key and button wait for set-up', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  const command = manifest.contributes.commands.find((c) => c.command === 'flow.pickProject')
  assert.strictEqual(`${command.category}: ${command.title}`, "Flow: Switch project")
  assert.ok(!manifest.contributes.menus.commandPalette.some((m) => m.command === command.command), 'never hidden from the palette')
  assert.deepStrictEqual(manifest.contributes.keybindings.map((k) => [k.command, k.key, k.when]), [[command.command, 'ctrl+alt+p', 'config.flow.follow']])
  const json = JSON.stringify(manifest)
  assert.ok(!json.includes('projectColors'), 'no old name left in the manifest')
})

test('package.json contributes the profile the code registers, under the title flow-v2 sets as the default', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  assert.deepStrictEqual(manifest.contributes.terminal.profiles.map((p) => [p.id, p.title]), [[PROFILE, 'bash (Flow)']])
  assert.ok(manifest.activationEvents.includes(`onTerminalProfile:${PROFILE}`))
})

test('the Explorer switcher writes the window\'s settings, keeps a key set by hand, and clears only its own', async () => {
  const [a] = [project('switch-a'), project('switch-b')]
  settings.files = { exclude: { '**/*.log': true } }
  await showInExplorer(a.name, 'test')
  const shown = fs.readdirSync(scratch).filter((n) => !settings.files.exclude[n])
  assert.deepStrictEqual(shown, [a.name], 'every other entry at the top hidden')
  assert.strictEqual(settings.search.exclude['switch-b'], false, 'search and Ctrl+P keep the hidden project')
  assert.strictEqual(settings.flow['explorer.pick'], a.name)
  await showInExplorer(undefined, 'test')
  assert.deepStrictEqual(settings.files.exclude, { '**/*.log': true })
  assert.strictEqual(settings.search.exclude, undefined)
  assert.strictEqual(settings.flow['explorer.hidden'], undefined)
})

test('Source Control keeps only the pick\'s repositories, reopens only what it closed, and can be turned off', async () => {
  const [a, b] = [project('scm-a'), project('scm-b')]
  const repo = (name) => path.join(scratch, name)
  for (const name of ['scm-a', 'scm-a/.flow', 'scm-b', 'scm-b/.flow', '.flow']) gitOpen.add(repo(name))
  gitOpen.add(scratch)
  await showInExplorer(a.name, 'test')
  assert.ok(gitOpen.has(repo('scm-a')) && gitOpen.has(repo('scm-a/.flow')), 'the pick and its .flow stay')
  assert.ok(!gitOpen.has(repo('scm-b')) && !gitOpen.has(repo('scm-b/.flow')) && !gitOpen.has(scratch) && !gitOpen.has(repo('.flow')))
  assert.deepStrictEqual([...settings.flow['explorer.closedRepositories']].sort(), ['.', '.flow', 'scm-b', 'scm-b/.flow'])
  gitOpen.delete(repo('scm-a/.flow')) // closed by hand
  await showInExplorer(undefined, 'test')
  assert.ok([scratch, repo('.flow'), repo('scm-b'), repo('scm-b/.flow'), repo('scm-a')].every((r) => gitOpen.has(r)), 'All reopens what it closed')
  assert.ok(!gitOpen.has(repo('scm-a/.flow')), 'one closed by hand stays closed')
  assert.strictEqual(settings.flow['explorer.closedRepositories'], undefined)
  settings.flow['explorer.sourceControl'] = false
  await showInExplorer(b.name, 'test')
  assert.ok(gitOpen.has(repo('scm-a')), 'off: Source Control left alone')
  delete settings.flow['explorer.sourceControl']
  await showInExplorer(undefined, 'test')
  gitOpen.clear()
})

test("opening a hidden project's file switches the Explorer to it; a later change of the same tab doesn't flip it back", async () => {
  const [a, b] = [project('follow-a'), project('follow-b')]
  settings.flow.follow = true
  await showInExplorer(a.name, 'test')
  await followFile(path.join(b.dir, 'notes.md'))
  assert.strictEqual(settings.flow['explorer.pick'], b.name)
  await showInExplorer(a.name, 'picked by hand')
  await followFile(path.join(b.dir, 'notes.md')) // the same active file: a dirty mark, a label change
  assert.strictEqual(settings.flow['explorer.pick'], a.name)
  settings.flow['explorer.followFile'] = false
  await followFile(path.join(b.dir, 'other.md'))
  assert.strictEqual(settings.flow['explorer.pick'], a.name, 'off: never follows')
  delete settings.flow['explorer.followFile']
  await showInExplorer(undefined, 'test')
  settings.flow.follow = undefined
})

test('the pick names what a pick paints: its project, the workspace for "Workspace files", nothing for "All projects"', () => {
  const a = project('paint-a')
  settings.flow['explorer.pick'] = a.name
  assert.strictEqual(pickedProject()?.dir, a.dir)
  settings.flow['explorer.pick'] = '(workspace)'
  assert.deepStrictEqual([pickedProject()?.workspace, pickedProject()?.dir], [true, scratch])
  settings.flow['explorer.pick'] = undefined
  assert.strictEqual(pickedProject(), undefined)
  settings.flow['explorer.pick'] = 'gone'
  assert.strictEqual(pickedProject(), undefined, 'a project deleted since')
  delete settings.flow['explorer.pick']
})

test("the workspace's settings under the names before 0.7.0 move to the new ones, once", async () => {
  settings.projectColors = { follow: true, 'explorer.pick': 'reader', 'explorer.hidden': ['playground'] }
  await renameOldSettings()
  assert.deepStrictEqual([settings.flow.follow, settings.flow['explorer.pick'], settings.flow['explorer.hidden']], [true, 'reader', ['playground']])
  assert.deepStrictEqual(Object.values(settings.projectColors).filter((v) => v !== undefined), [], 'the old ones removed')
  for (const key of ['follow', 'explorer.pick', 'explorer.hidden']) delete settings.flow[key]
})

test('switches asked for while one runs collapse into the latest: tabs flipped quickly write the settings twice, not once each', async () => {
  const [a, b, c] = [project('quick-a'), project('quick-b'), project('quick-c')]
  const picks = []
  const config = vscode.workspace.getConfiguration
  vscode.workspace.getConfiguration = (section) => {
    const inner = config(section)
    return { ...inner, update: async (key, value) => { if (key === 'explorer.pick') picks.push(value); return inner.update(key, value) } }
  }
  await Promise.all([showInExplorer(a.name, 'test'), showInExplorer(b.name, 'test'), showInExplorer(c.name, 'test')])
  vscode.workspace.getConfiguration = config
  assert.deepStrictEqual(picks, [a.name, c.name])
  await showInExplorer(undefined, 'test')
})

test('a reapply runs the pick as it stands then, and never replaces a switch waiting to run: no ping-pong between two projects', async () => {
  const [a, b] = [project('pong-a'), project('pong-b')]
  await showInExplorer(a.name, 'test')
  const running = showInExplorer(b.name, 'file opened') // starts at once
  showInExplorer(a.name, 'picked') // waits
  showInExplorer(CURRENT, 'Git reopened a repository') // must not replace the wait
  await running
  assert.strictEqual(settings.flow['explorer.pick'], a.name)
  showInExplorer(b.name, 'file opened')
  await showInExplorer(CURRENT, 'Git reopened a repository')
  assert.strictEqual(settings.flow['explorer.pick'], b.name, 'a reapply after the switch keeps it')
  await showInExplorer(undefined, 'test')
})
