// A window opened on one folder that holds several projects, each a git repo in a top-level subfolder
// (~/code/workspaces/main/reader, …/playground). This extension paints the window in the colour of the project
// whose file you are working in, and shows one project at a time in the Explorer.
//
// - Named project-colors before 0.7.0 (the user, 2026-11-25: a project switcher in "Project colors" made no
//   sense). Its settings were `projectColors.*`: a project's own colour and accent are still read under the old
//   names and renamed when written (colors.js); the workspace's own are moved once when a window opens
//   (`renameOldSettings`).
// - A project is a top-level folder that is a git repo and whose name doesn't start with a dot: the workspace's
//   own `.flow` is a git repo too, and was taken for a project.
//
// - The project is the top-level folder of the active tab's file. Terminals leave the window alone (the user,
//   2026-11-25: a repaint on each terminal switch lagged and looked bad; flow's band names a terminal's project).
//   No tab open → no colour. A file of the workspace itself, in no project → the workspace: its name on the
//   badge, the window's own colours.
// - Each project keeps its colour in its own .vscode/settings.json as `flow.color` (before 0.5.0
//   Peacock's `peacock.remoteColor` or `peacock.color`, still read). Painting is one write of the window's
//   `workbench.colorCustomizations`: the bars as Peacock painted them (colors.js → windowColors), plus ours below.
//   Peacock is gone since 0.5.0 (the user, 2026-11-25): two writers of the window's colours echoed each other,
//   which saved one project's colour into another three times and doubled the writes, the lag.
// - Each colour has an accent: the one paired with it in the favourites (`accent` beside `value`), else one
//   derived from it (colors.js → accentOf). The status bar shows the project's name in capitals on the
//   accent, as far left as an extension can put it (right after the remote item); the active tab's bottom
//   line (the theme's divider between tab and editor), the activity bar's active line and the active terminal's
//   mark in the terminal list (flow-v2's VS Code patch draws it from that colour) take the accent too.
//   The activity bar's counts are a light neutral: most accents share their colour's hue, and a count in one
//   blends into the bar (the user, 2026-11-24). The remote (WSL) item is painted the bar's own colour, so
//   only the project badge stands out.
// - The accent is saved into the project's .vscode/settings.json as `flow.accent`, beside its
//   colour, where flow's terminal band reads it: on every paint, and when a colour is set or changed.
// - The title bar is VS Code's own, `${rootNameShort}` set in flow-v2's machine settings (no `[WSL: …]`); the
//   Explorer's header names the pick, through flow-v2's VS Code patch (the user, 2026-11-26).
// - A project's colour changes through "Change this project's colour": a favourite, or a colour typed in.
// - Paints run one at a time, the latest asked for winning; the "Flow" output channel logs each with
//   its cause.
// - On a machine with flow-v2, each window opened runs its VS Code patch check (`vscodePatch`): an update
//   installs an unpatched VS Code often, and this runs right after one.
// - A window not set up ("Flow: Set up this workspace") is left alone.
// - Its "bash (Flow)" terminal profile gives each new terminal its own `FLOW_TERMINAL` id; see `terminalProfile`
//   below. It works in any window, set up or not. Not the default for now: as the default it broke terminal
//   reattach on reload (flow-v2's TASK-21).
const vscode = require('vscode')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = () => (vscode.workspace.workspaceFolders || [])[0]
const following = () => vscode.workspace.getConfiguration('flow').get('follow') === true

// --- colours ---

const colors = require('./colors')
const { lighten, ink, windowColors, LIGHTEN } = colors
const favorites = () => vscode.workspace.getConfiguration('flow').get('favorites') || []
const freeColor = (used) => colors.freeColor(favorites().map((f) => f.value), used, LIGHTEN)
const accentOf = (color) => colors.accentOf(color, favorites())

// --- projects ---

// Every top-level folder of the window that is a git repo, but for dot-folders (the workspace's own `.flow`).
const isProject = (name, dir) => !name.startsWith('.') && fs.existsSync(path.join(dir, '.git'))
const projects = () => {
  const folder = root()
  if (!folder) return []
  let names = []
  try { names = fs.readdirSync(folder.uri.fsPath, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch {}
  return names.filter((name) => isProject(name, path.join(folder.uri.fsPath, name))).map((name) => ({ name, dir: path.join(folder.uri.fsPath, name) }))
}

// The project holding a path; the workspace itself for a path inside the window's folder but in no
// project; undefined for a path outside it.
const projectOf = (file) => {
  const folder = root()
  if (!folder || !file) return undefined
  const relative = path.relative(folder.uri.fsPath, file)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
  const name = relative.split(path.sep)[0]
  return projects().find((p) => p.name === name) || workspace()
}
const workspace = () => ({ name: path.basename(root().uri.fsPath), dir: root().uri.fsPath, workspace: true })


// The workspace's colour is `flow.color` in the window's own settings, read and written through VS Code, which
// also writes that file (the user, 2026-11-26: "Workspace files" should paint the window too).
const HEX_COLOR = /^#([0-9a-f]{6})$/i
const workspaceColor = () => {
  const value = vscode.workspace.getConfiguration('flow').inspect('color')?.workspaceValue
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : undefined
}
const colorOf = (project) => (project.workspace ? workspaceColor() : colors.colorIn(project.dir))
// The accent goes only into a project's own settings: the workspace's hold the window's colours. Settings still
// under their names before 0.7.0 are renamed first.
const saveAccent = (project, color) => {
  if (project.workspace || !color) return false
  colors.renameOldIn(project.dir)
  return colors.saveAccentIn(project.dir, accentOf(color))
}
const saveColor = async (project, color) => {
  if (project.workspace) {
    await update('flow', 'color', color)
    await update('flow', 'accent', accentOf(color))
    return
  }
  colors.renameOldIn(project.dir)
  colors.saveColorIn(project.dir, color)
  saveAccent(project, color)
}

// --- painting ---

let badge
let log // the "Flow" output channel
const say = (line) => log?.info(line)

const update = async (section, key, value) => {
  const config = vscode.workspace.getConfiguration(section)
  if (JSON.stringify(config.inspect(key)?.workspaceValue) !== JSON.stringify(value)) await config.update(key, value, vscode.ConfigurationTarget.Workspace)
}

// The activity bar counts' colour: the bar's icons' own.
const COUNT = '#e7e7e7'
// Painted by 0.4.0 and earlier, cleared with ours so no window keeps it.
const RETIRED = ['tab.activeBorderTop']

// The window's colours for a project colour: the bars, the badge (a warning item) and the accent lines on the
// accent, the remote item on the bar's own colour, the counts neutral.
const ourColors = (color) => {
  const accent = accentOf(color)
  return {
    ...windowColors(color),
    'statusBarItem.warningBackground': accent,
    'statusBarItem.warningForeground': ink(accent),
    'statusBarItem.remoteBackground': color,
    'tab.activeBorder': accent,
    'terminal.tab.activeBorder': accent,
    'activityBar.activeBorder': accent,
    'activityBarTop.activeBorder': accent,
    'activityBarBadge.background': COUNT,
    'activityBarBadge.foreground': ink(COUNT),
  }
}

// Every key a project colour paints, cleared before the next paint: windowColors' and ours.
const OURS = Object.keys(ourColors('#000000'))

// Ours, merged into the window's colour settings, keeping any set by hand; none for no colour.
const setOurColors = async (color) => {
  const current = { ...(vscode.workspace.getConfiguration('workbench').inspect('colorCustomizations')?.workspaceValue || {}) }
  for (const key of [...OURS, ...RETIRED]) delete current[key]
  if (color) Object.assign(current, ourColors(color))
  await update('workbench', 'colorCustomizations', Object.keys(current).length ? current : undefined)
}

// One paint at a time: two at once (a terminal, then a tab, clicked quickly) interleave their writes and can leave
// the window on the wrong project. A paint asked for while one runs waits, and only the latest asked for runs.
let wanted // { project, why } asked for, not started yet
let running // the loop painting, while it runs
let target // the project the window is painted, or about to be painted, for
const paint = (project, why) => {
  wanted = { project, why }
  target = project
  running ??= (async () => {
    try {
      while (wanted) {
        const next = wanted
        wanted = undefined
        await paintNow(next.project, next.why)
      }
    } finally {
      running = undefined
    }
  })()
  return running
}

const paintNow = async (project, why) => {
  if (!following()) return
  say(`paint ${project ? project.name : 'nothing'} (${why})`)
  if (!project) {
    badge.hide()
    await setOurColors(undefined)
    return
  }
  const color = colorOf(project)
  badge.text = project.name.toUpperCase()
  badge.tooltip = project.workspace ? `${project.dir}: the workspace, in no project` : project.dir
  badge.backgroundColor = color ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
  badge.show()
  if (project.workspace && !color) return setOurColors(undefined)
  if (!color) return // a project without a colour leaves the window as it is
  saveAccent(project, color) // a project's own file; the workspace's accent is written with its colour
  await setOurColors(color)
}

// The file of the active tab: text, diff, image or any custom editor.
const activeTabFile = () => {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  const uri = input?.uri || input?.modified
  return uri?.scheme === 'file' || uri?.scheme === 'vscode-remote' ? uri.fsPath : undefined
}
const anyTabOpen = () => vscode.window.tabGroups.all.some((g) => g.tabs.length)

const tabChanged = (why) => {
  followTab(why)?.catch(report)
  followFile(activeTabFile())?.catch(report)
}

// The project the pick shows, for a paint: a project, the workspace for "Workspace files", none for "All projects".
const pickedProject = () => {
  const pick = currentPick()
  return pick === WORKSPACE ? workspace() : pick ? projects().find((p) => p.name === pick) : undefined
}

// With no tab open the window takes the pick's colour, when picks paint (the user, 2026-11-26: the badge and
// colour should not wait for a file), else none.
const followTab = (why) => {
  if (!anyTabOpen()) {
    const picked = switcher('paintOnPick') !== false ? pickedProject() : undefined
    return paint(picked, `${why}: no tab open${picked ? ', the pick' : ''}`)
  }
  const file = activeTabFile()
  const project = projectOf(file)
  if (project && project.dir !== target?.dir) return paint(project, `${why}: ${file}`)
}

// --- terminals ---

// VS Code revives a terminal with the environment it was created with, so the id survives a window close or a
// reboot: flow-v2's hooks file the terminal's Claude Code session under it, and ~/.bashrc resumes that session
// in the revived shell. Splits and `+` open on the default profile too. No shellPath: VS Code starts the
// machine's default shell. No cwd: VS Code's own choice stands (the window's folder, a split's parent's folder).
const PROFILE = 'flow.terminal' // package.json's contributes.terminal.profiles id
const terminalProfile = () => new vscode.TerminalProfile({ env: { FLOW_TERMINAL: crypto.randomUUID() } })

// --- the Explorer project switcher ---

const explorer = require('./explorer')
const { WORKSPACE } = explorer
const switcher = (key) => vscode.workspace.getConfiguration('flow').get(`explorer.${key}`)

// Every entry at the window's top: folders and files.
const topNames = () => {
  try { return fs.readdirSync(root().uri.fsPath) } catch (error) { if (error.code === 'ENOENT') return []; throw error }
}

// Shows the pick in the Explorer, or everything for none. One at a time: a pick and the watcher's reapply, at
// once, would each read the settings the other is still writing. And only the latest asked for: tabs flipped
// quickly, or Git opening each repository at the start, asked for one run each, every one writing the settings
// and refreshing the Explorer (the user, 2026-11-26: laggy once navigating).
// CURRENT asks to reapply the pick as it stands when the run starts, never as it stood when asked: a reapply
// asked for by Git reopening a repository, while a switch was still being written, once carried the old pick,
// switched back to it, reopened repositories again, and the window flipped between two projects twice a second
// until it was closed (2026-11-26 03:30, 0.8.0), Source Control flipping open files between their diff and text.
// So a reapply also never replaces a switch waiting to run.
const CURRENT = Symbol('the pick as it stands')
let wantedPick // { pick, why } asked for, not started yet
let showing // the loop showing, while it runs
const showInExplorer = (pick, why) => {
  if (!(pick === CURRENT && wantedPick)) wantedPick = { pick, why }
  showing ??= (async () => {
    try {
      while (wantedPick) {
        const next = wantedPick
        wantedPick = undefined
        await showNow(next.pick === CURRENT ? currentPick() : next.pick, next.why)
      }
    } finally {
      showing = undefined
    }
  })()
  return showing
}
const showNow = async (pick, why) => {
  const started = Date.now()
  const names = projects().map((p) => p.name)
  if (pick && pick !== WORKSPACE && !names.includes(pick)) pick = undefined // the project is gone
  const workspaceValue = (section, key) => vscode.workspace.getConfiguration(section).inspect(key)?.workspaceValue
  const next = explorer.excludesFor(
    explorer.hiddenFor(pick, topNames(), names, switcher('hideWorkspaceFiles') !== false),
    { files: workspaceValue('files', 'exclude') || {}, search: workspaceValue('search', 'exclude') || {}, hidden: switcher('hidden') || [] },
    switcher('searchEveryProject') !== false,
    names,
  )
  const orNone = (value) => (Object.keys(value).length ? value : undefined)
  say(`Explorer shows ${pick === WORKSPACE ? 'the workspace' : pick || 'everything'} (${why})`)
  // The record first: a switch cut short after it leaves a key it can remove next time, never one it can't.
  await update('flow', 'explorer.hidden', next.hidden.length ? next.hidden : undefined)
  await update('files', 'exclude', orNone(next.files))
  await update('search', 'exclude', orNone(next.search))
  await update('flow', 'explorer.pick', pick)
  await showInSourceControl(pick).catch(report)
  say(`  took ${Date.now() - started} ms`)
}
const currentPick = () => switcher('pick') || undefined

// Source Control shows the pick's repositories: a project's own and its .flow, or the workspace's own and its
// .flow; "All" every one. VS Code lets no extension choose what Source Control selects, so the others are closed
// through Git (`git.close` with a folder) and reopened through Git's API; Git keeps a closed one closed across a
// reload. Only what the switcher closed is reopened (`explorer.closedRepositories`), so one closed by hand stays.
const gitApi = async () => {
  const git = vscode.extensions.getExtension('vscode.git')
  if (!git) return undefined
  const extension = git.isActive ? git.exports : await git.activate()
  return extension?.enabled ? extension.getAPI(1) : undefined
}
const repoRoot = (fsPath) => path.relative(root().uri.fsPath, fsPath).split(path.sep).join('/') || '.'
const repoUri = (name) => vscode.Uri.file(path.join(root().uri.fsPath, name))
const showInSourceControl = async (pick) => {
  const api = await gitApi()
  if (!api) return
  const open = api.repositories.map((r) => repoRoot(r.rootUri.fsPath)).filter((r) => !r.startsWith('..'))
  const on = switcher('sourceControl') !== false
  const next = explorer.reposFor(on ? pick : undefined, open, switcher('closedRepositories') || [], projects().map((p) => p.name))
  for (const name of next.close) await vscode.commands.executeCommand('git.close', repoUri(name))
  for (const name of next.reopen) await api.openRepository(repoUri(name)).catch(report) // a folder deleted since: dropped
  if (next.close.length || next.reopen.length) say(`Source Control: closed ${next.close.join(', ') || 'none'}; reopened ${next.reopen.join(', ') || 'none'}`)
  await update('flow', 'explorer.closedRepositories', next.closed.length ? next.closed : undefined)
}

// After a pick, the Explorer focused on the active file when the pick holds it (its folders opened to it, the
// user, 2026-11-26), else on the project's folder, expanded: VS Code has no command to expand a folder, so the
// folder is revealed (selected, focused) and the focused list expands its selection. The wait lets the window
// apply the new `files.exclude` first: a reveal into a folder still hidden does nothing.
const REVEAL_WAIT_MS = 200
const revealPick = async (project) => {
  await new Promise((resolve) => setTimeout(resolve, REVEAL_WAIT_MS))
  const file = activeTabFile()
  if (file && projectOf(file)?.dir === project.dir) return vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(file))
  if (project.workspace) return // its own files sit at the Explorer's top already
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(project.dir))
  await vscode.commands.executeCommand('list.expand')
}

const pickProject = async () => {
  if (!following()) return vscode.window.showWarningMessage('Flow: run "Flow: Set up this workspace" first.')
  const now = currentPick()
  const items = [
    ...projects().map((p) => ({ label: `${p.name}/`, pick: p.name, project: p })),
    { label: 'All projects', description: 'every project and the workspace\'s own files', pick: undefined },
    { label: 'Workspace files', description: 'only the workspace\'s own files', pick: WORKSPACE },
  ]
  for (const item of items) if (item.pick === now) item.description = item.description ? `shown now · ${item.description}` : 'shown now'
  const quick = vscode.window.createQuickPick()
  quick.title = 'Show in the Explorer'
  quick.items = items
  quick.activeItems = items.filter((i) => i.pick === now)
  const choice = await new Promise((resolve) => {
    quick.onDidAccept(() => resolve(quick.selectedItems[0]))
    quick.onDidHide(() => resolve(undefined))
    quick.show()
  })
  quick.dispose()
  if (!choice) return
  await showInExplorer(choice.pick, 'picked')
  if (choice.project || choice.pick === WORKSPACE) await revealPick(choice.project || workspace())
  if (switcher('paintOnPick') !== false && choice.pick) await paint(choice.project || workspace(), 'picked')
}

// The active tab's file in a project (or the workspace's own files) the pick hides → the Explorer shows that one.
// Only when the active tab's file changes: VS Code reports every tab's change (dirty, preview, label), and a pick
// that doesn't hold the active file must not flip back on the next one.
let lastFile
const followFile = (file) => {
  if (file === lastFile) return
  lastFile = file
  if (!following() || switcher('followFile') === false) return
  const place = projectOf(file)
  const pick = explorer.pickShowing(place && (place.workspace ? WORKSPACE : place.name), currentPick(), switcher('hideWorkspaceFiles') !== false)
  if (pick) return showInExplorer(pick, `file opened: ${file}`)
}

// --- commands ---

const setup = async () => {
  if (!root()) return vscode.window.showWarningMessage('Flow: open a folder holding your projects first.')
  await vscode.workspace.getConfiguration('flow').update('follow', true, vscode.ConfigurationTarget.Workspace)
  const all = [...projects(), workspace()]
  const bare = all.filter((p) => !colorOf(p))
  if (bare.length) {
    const picked = await vscode.window.showQuickPick(
      bare.map((p) => ({ label: p.workspace ? `${p.name} (the workspace)` : p.name, picked: true, project: p })),
      { canPickMany: true, title: 'Give these projects a colour (untick one to colour it by hand later)' },
    )
    const used = all.map(colorOf).filter(Boolean)
    for (const item of picked || []) {
      const color = freeColor(used)
      if (!color) break
      await saveColor(item.project, color)
      used.push(color)
    }
  }
  for (const p of all) saveAccent(p, colorOf(p))
  target = undefined
  await followTab('set up')
}

// A favourite, marked when it is the project's or another project's colour, or one typed in.
const HEX = /^#?([0-9a-f]{6})$/i
const changeColor = async (uri) => {
  if (!following()) return vscode.window.showWarningMessage('Flow: run "Flow: Set up this workspace" first.')
  // A project folder right-clicked, else the one the window is painted for, the workspace included.
  const project = uri ? projects().find((p) => p.dir === uri.fsPath) : target
  if (!project) return vscode.window.showWarningMessage('Flow: right-click a project folder at the top of the Explorer, or pick a project first.')
  const own = colorOf(project)
  const usedBy = new Map([...projects(), workspace()].map((p) => [colorOf(p), p.name]))
  const choice = await vscode.window.showQuickPick(
    [
      ...favorites().map((f) => {
        const value = f.value.toLowerCase()
        const user = usedBy.get(value)
        return { label: f.name || value, description: value, detail: value === own ? 'this project' : user ? `used by ${user}` : undefined, value }
      }),
      { label: 'Enter a colour…', typed: true },
    ],
    { title: `Colour of ${project.name}`, matchOnDescription: true },
  )
  if (!choice) return
  let color = choice.value
  if (choice.typed) {
    const typed = await vscode.window.showInputBox({ title: `Colour of ${project.name}`, prompt: 'A hex colour, such as #1b2b34', value: own, validateInput: (v) => (HEX.test(v.trim()) ? undefined : 'Six hex digits, with or without #') })
    if (!typed) return
    color = `#${HEX.exec(typed.trim())[1].toLowerCase()}`
  }
  if (color === own) return
  say(`${project.name}'s colour set to ${color}`)
  await saveColor(project, color)
  target = undefined
  await paint(project, 'colour chosen')
}

exports.activate = (context) => {
  // First: the default terminal waits on this, and fails to open if anything before it throws.
  context.subscriptions.push(vscode.window.registerTerminalProfileProvider(PROFILE, { provideTerminalProfile: terminalProfile }))
  // VS Code's remote item (`WSL: Ubuntu`) has priority Number.POSITIVE_INFINITY; the highest an extension can
  // pass is MAX_SAFE_INTEGER (Infinity reaches the window as JSON, null), which puts the badge right after it.
  badge = vscode.window.createStatusBarItem('flow.name', vscode.StatusBarAlignment.Left, Number.MAX_SAFE_INTEGER)
  badge.name = 'Project name'
  log = vscode.window.createOutputChannel('Flow', { log: true })
  context.subscriptions.push(
    badge,
    log,
    vscode.commands.registerCommand('flow.setup', () => setup().catch(report)),
    vscode.commands.registerCommand('flow.changeColor', (uri) => changeColor(uri).catch(report)),
    vscode.commands.registerCommand('flow.pickProject', () => pickProject().catch(report)),
    vscode.window.tabGroups.onDidChangeTabs(() => tabChanged('tabs changed')),
    vscode.window.tabGroups.onDidChangeTabGroups(() => tabChanged('tab groups changed')),
  )
  badge.command = 'flow.pickProject'
  lastFile = activeTabFile() // the pick survives a reload as it was, whatever tab is open
  const ready = renameOldSettings().catch(report) // before anything reads the settings
  ready.then(() => followTab('window opened')?.catch(report))
  if (root()) {
    // A folder added at the top while a pick is active (`flow init` making a project) hides at once: patterns can
    // only list what to hide, never "all but this one". `*/.git` too: a folder becomes a project after it appears.
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root(), '{*,*/.git}'))
    const reapply = () => following() && currentPick() && showInExplorer(CURRENT, 'top level changed').catch(report)
    context.subscriptions.push(
      watcher,
      watcher.onDidCreate(reapply),
      watcher.onDidDelete(reapply),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('flow.explorer.hideWorkspaceFiles') || e.affectsConfiguration('flow.explorer.searchEveryProject')) reapply()
        // Turned off, it reopens what it closed; turned on, it closes again. With no pick there is nothing to close.
        if (e.affectsConfiguration('flow.explorer.sourceControl')) showInSourceControl(currentPick()).catch(report)
      }),
    )
    ready.then(reapply) // entries added or removed while the window was closed
    // A repository Git opens while a pick is active (a new project, a folder opened) is closed if the pick hides it;
    // the ones the switcher reopens come back here too, and are kept.
    ready.then(async () => {
      const api = await gitApi()
      if (api) context.subscriptions.push(api.onDidOpenRepository(() => reapply()))
    }).catch(report)
  }
  vscodePatch()
}
exports.deactivate = () => {}

// The workspace's own settings under the extension's older names, `workspaceProjects.*` (0.7.0 to 0.9.x) and
// `projectColors.*` (before 0.7.0), moved to `flow.*` once, before the first paint and the Explorer's first
// reapply, which read the new names. Also cleared: the window title 0.9.2 wrote with each pick (the user found
// `main · reader` unclear; the Explorer's own header names the pick now, through flow-v2's VS Code patch).
const renameOldSettings = async () => {
  for (const section of ['workspaceProjects', 'projectColors']) {
    const old = vscode.workspace.getConfiguration(section)
    for (const key of ['follow', 'explorer.pick', 'explorer.hidden', 'explorer.followFile', 'explorer.searchEveryProject', 'explorer.hideWorkspaceFiles', 'explorer.paintOnPick', 'explorer.sourceControl', 'explorer.closedRepositories']) {
      const value = old.inspect(key)?.workspaceValue
      if (value === undefined) continue
      if (vscode.workspace.getConfiguration('flow').inspect(key)?.workspaceValue === undefined) await update('flow', key, value)
      await old.update(key, undefined, vscode.ConfigurationTarget.Workspace)
      say(`setting ${section}.${key} renamed to flow.${key}`)
    }
  }
  const title = vscode.workspace.getConfiguration('window').inspect('title')?.workspaceValue
  if (typeof title === 'string' && title.startsWith('${rootNameShort} · ')) await update('window', 'title', undefined)
}

// flow-v2's patches to VS Code (scripts/patch-vscode.ts: terminal layout kept across a WSL restart, the active
// terminal marked in the terminal list). After an update VS Code runs unpatched; this patches the new version and
// offers to quit VS Code, so it reopens on it. Quiet when nothing is new or flow-v2 isn't on the machine.
const vscodePatch = () => {
  const script = path.join(require('os').homedir(), 'code/flow-v2/scripts/patch-vscode.ts')
  if (!fs.existsSync(script)) return
  require('child_process').execFile(process.execPath, [script, '--hook'], { timeout: 60000 }, async (error, stdout) => {
    if (error) return report(error)
    const lines = stdout.trim()
    if (!lines) return
    say(lines)
    const failed = lines.includes('failed')
    const show = failed ? vscode.window.showWarningMessage : vscode.window.showInformationMessage
    // Quit, not reload: VS Code's main process keeps product.json's checksums from when it started, so a reload
    // loads the patched files against the old checksums and warns that the installation is corrupt.
    const answer = await show(`${lines}${failed ? '' : ' Quit VS Code (every window) and open it again to use it.'}`, ...(failed ? [] : ['Quit VS Code']))
    if (answer === 'Quit VS Code') vscode.commands.executeCommand('workbench.action.quit')
  })
}

const report = (error) => {
  console.error('flow:', error)
  log?.error(String(error?.stack || error))
}

// For tests/extension.test.js: the parts that need no window.
exports.internal = { isProject, renameOldSettings, showInExplorer, CURRENT, pickedProject, showInSourceControl, followFile, lighten, ink, windowColors, accentOf, freeColor, projectOf, colorOf, saveColor, saveAccent, OURS, ourColors, setOurColors, PROFILE, terminalProfile }
