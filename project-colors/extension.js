// A window opened on one folder that holds several projects, each a git repo in a top-level subfolder
// (~/code/workspaces/main/reader, …/playground). Peacock paints a window one colour; this extension
// switches it to the colour of the project you are working in.
//
// - The project is the top-level folder of the active tab's file, or of the active terminal's folder.
//   The last one focused wins. Nothing open → no colour. A file or terminal of the workspace itself,
//   in no project → the workspace: its name on the badge, the window's own colours.
// - Each project keeps its colour in its own .vscode/settings.json (`peacock.remoteColor` under WSL,
//   `peacock.color` locally). This extension writes it to the window's settings, and Peacock repaints.
// - Each colour has an accent: the one paired with it in the favourites (`accent` beside `value`), else one
//   derived from it (colors.js → accentOf). The status bar shows the project's name in capitals on the
//   accent, as far left as an extension can put it (right after the remote item); the active tab's top line,
//   the activity bar's active line and its counts take the accent too. The remote (WSL) item is painted the
//   bar's own colour, so only the project badge stands out.
// - The accent is saved into the project's .vscode/settings.json as `projectColors.accent`, beside its
//   colour, where flow's terminal band reads it: on every paint, and when a colour is set or changed.
// - The title bar is VS Code's own (the user, 2026-11-24: reset it); painting clears any title it once set.
// - A colour changed through Peacock's own commands is saved back into the active project.
// - A window not set up ("Project colors: Set up this workspace") is left alone.
// - Its "bash (Flow)" terminal profile, set as the default by flow-v2 (vscode/settings.json), gives each new
//   terminal its own `FLOW_TERMINAL` id; see `terminalProfile` below. It works in any window, set up or not.
const vscode = require('vscode')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// The colours this extension writes. Those Peacock also manages are in its `peacock.excludedSettings`
// (package.json), so Peacock neither overwrites nor clears them.
const OURS = [
  'statusBarItem.warningBackground', 'statusBarItem.warningForeground', 'statusBarItem.remoteBackground',
  'tab.activeBorderTop', 'activityBar.activeBorder', 'activityBarTop.activeBorder',
  'activityBarBadge.background', 'activityBarBadge.foreground',
]

// Under a remote (WSL, SSH) Peacock paints from remoteColor, locally from color.
const keys = () => (vscode.env.remoteName ? ['remoteColor', 'color'] : ['color', 'remoteColor'])
const root = () => (vscode.workspace.workspaceFolders || [])[0]
const following = () => vscode.workspace.getConfiguration('projectColors').get('follow') === true

// --- colours ---

const colors = require('./colors')
const { lighten, ink } = colors
const percent = () => vscode.workspace.getConfiguration('peacock').get('darkenLightenPercentage') ?? 10
const favorites = () => vscode.workspace.getConfiguration('peacock').get('favoriteColors') || []
const freeColor = (used) => colors.freeColor(favorites().map((f) => f.value), used, percent())
const accentOf = (color) => colors.accentOf(color, favorites())

// --- projects ---

// Every top-level folder of the window that is a git repo.
const projects = () => {
  const folder = root()
  if (!folder) return []
  let names = []
  try { names = fs.readdirSync(folder.uri.fsPath, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch {}
  return names.filter((name) => fs.existsSync(path.join(folder.uri.fsPath, name, '.git'))).map((name) => ({ name, dir: path.join(folder.uri.fsPath, name) }))
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


const colorOf = (project) => (project.workspace ? undefined : colors.colorIn(project.dir, keys()))
// The accent goes only into a project's own settings: the workspace's hold the window's colours.
const saveAccent = (project, color) => !project.workspace && color && colors.saveAccentIn(project.dir, accentOf(color))
const saveColor = (project, color) => {
  colors.saveColorIn(project.dir, keys()[0], color)
  saveAccent(project, color)
}

// --- painting ---

let badge
let active // the project the window is painted for
let painted // the colour last written to Peacock

const update = async (section, key, value) => {
  const config = vscode.workspace.getConfiguration(section)
  if (JSON.stringify(config.inspect(key)?.workspaceValue) !== JSON.stringify(value)) await config.update(key, value, vscode.ConfigurationTarget.Workspace)
}

// Our colours for a project colour: the badge (a warning item) and the accent lines on the accent, the
// remote item on the bar's own colour.
const ourColors = (color) => {
  const accent = accentOf(color)
  return {
    'statusBarItem.warningBackground': accent,
    'statusBarItem.warningForeground': ink(accent),
    'statusBarItem.remoteBackground': color,
    'tab.activeBorderTop': accent,
    'activityBar.activeBorder': accent,
    'activityBarTop.activeBorder': accent,
    'activityBarBadge.background': accent,
    'activityBarBadge.foreground': ink(accent),
  }
}

// Ours, merged into the window's colour settings, which Peacock also writes; none for no colour.
const setOurColors = async (color) => {
  const current = { ...(vscode.workspace.getConfiguration('workbench').inspect('colorCustomizations')?.workspaceValue || {}) }
  for (const key of OURS) delete current[key]
  if (color) Object.assign(current, ourColors(color))
  await update('workbench', 'colorCustomizations', Object.keys(current).length ? current : undefined)
}

const paint = async (project) => {
  if (!following()) return
  active = project
  if (!project) {
    badge.hide()
    painted = undefined
    await setOurColors(undefined)
    await update('window', 'title', undefined)
    await update('window', 'titleSeparator', undefined)
    await update('peacock', keys()[0], undefined)
    return
  }
  const color = colorOf(project)
  badge.text = project.name.toUpperCase()
  badge.tooltip = project.workspace ? `${project.dir}: the workspace, in no project` : project.dir
  badge.backgroundColor = color ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
  badge.show()
  await update('window', 'titleSeparator', undefined)
  await update('window', 'title', undefined)
  if (project.workspace) {
    painted = undefined
    await setOurColors(undefined)
    await update('peacock', keys()[0], undefined)
    return
  }
  if (!color) return // a project without a colour leaves the window as it is
  painted = color
  saveAccent(project, color)
  // Ours first: Peacock, reacting to its own key, keeps colours it doesn't manage.
  await setOurColors(color)
  await update('peacock', keys()[0], color)
}

// The file of the active tab: text, diff, image or any custom editor.
const activeTabFile = () => {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input
  const uri = input?.uri || input?.modified
  return uri?.scheme === 'file' || uri?.scheme === 'vscode-remote' ? uri.fsPath : undefined
}
const anyTabOpen = () => vscode.window.tabGroups.all.some((g) => g.tabs.length)

const followTab = () => {
  if (!anyTabOpen()) return paint(undefined)
  const project = projectOf(activeTabFile())
  if (project && project.dir !== active?.dir) return paint(project)
}
const followTerminal = (terminal) => {
  const cwd = terminal?.shellIntegration?.cwd || terminal?.creationOptions?.cwd
  const project = projectOf(typeof cwd === 'string' ? cwd : cwd?.fsPath)
  if (project) return paint(project)
}

// --- terminals ---

// VS Code revives a terminal with the environment it was created with, so the id survives a window close or a
// reboot: flow-v2's hooks file the terminal's Claude Code session under it, and ~/.bashrc resumes that session
// in the revived shell. Splits and `+` open on the default profile too. No shellPath: VS Code starts the
// machine's default shell. No cwd: VS Code's own choice stands (the window's folder, a split's parent's folder).
const integrated = new WeakSet() // terminals whose shell integration has started
const PROFILE = 'projectColors.flowTerminal' // package.json's contributes.terminal.profiles id
const terminalProfile = () => new vscode.TerminalProfile({ env: { FLOW_TERMINAL: crypto.randomUUID() } })

// --- commands ---

const setup = async () => {
  if (!root()) return vscode.window.showWarningMessage('Project colors: open a folder holding your projects first.')
  await vscode.workspace.getConfiguration('projectColors').update('follow', true, vscode.ConfigurationTarget.Workspace)
  const all = projects()
  const bare = all.filter((p) => !colorOf(p))
  if (bare.length) {
    const picked = await vscode.window.showQuickPick(
      bare.map((p) => ({ label: p.name, picked: true, project: p })),
      { canPickMany: true, title: 'Give these projects a colour (untick one to colour it by hand later)' },
    )
    const used = all.map(colorOf).filter(Boolean)
    for (const item of picked || []) {
      const color = freeColor(used)
      if (!color) break
      saveColor(item.project, color)
      used.push(color)
    }
  }
  for (const p of all) saveAccent(p, colorOf(p))
  active = undefined
  await followTab()
}

const changeColor = async (uri) => {
  if (!following()) return vscode.window.showWarningMessage('Project colors: run "Set up this workspace" first.')
  const project = uri && projects().find((p) => p.dir === uri.fsPath)
  if (!project) return vscode.window.showWarningMessage('Project colors: right-click a project folder at the top of the Explorer.')
  await paint(project)
  const choice = await vscode.window.showQuickPick(
    [
      { label: 'A favourite colour', command: 'peacock.changeColorToFavorite' },
      { label: 'Enter a colour', command: 'peacock.enterColor' },
      { label: 'Darken', command: 'peacock.darken' },
      { label: 'Lighten', command: 'peacock.lighten' },
    ],
    { title: `Colour of ${project.name}` },
  )
  if (choice) await vscode.commands.executeCommand(choice.command)
}

// A colour Peacock wrote that this extension didn't: the user changed it, so the project keeps it.
const peacockChanged = async () => {
  if (!following() || !active || active.workspace) return
  const color = (vscode.workspace.getConfiguration('peacock').inspect(keys()[0])?.workspaceValue || '').toLowerCase()
  if (!color || color === painted) return
  saveColor(active, color)
  await paint(active)
}

exports.activate = (context) => {
  // First: the default terminal waits on this, and fails to open if anything before it throws.
  context.subscriptions.push(vscode.window.registerTerminalProfileProvider(PROFILE, { provideTerminalProfile: terminalProfile }))
  // VS Code's remote item (`WSL: Ubuntu`) has priority Number.POSITIVE_INFINITY; the highest an extension can
  // pass is MAX_SAFE_INTEGER (Infinity reaches the window as JSON, null), which puts the badge right after it.
  badge = vscode.window.createStatusBarItem('projectColors.name', vscode.StatusBarAlignment.Left, Number.MAX_SAFE_INTEGER)
  badge.name = 'Project name'
  context.subscriptions.push(
    badge,
    vscode.commands.registerCommand('projectColors.setup', () => setup().catch(report)),
    vscode.commands.registerCommand('projectColors.changeColor', (uri) => changeColor(uri).catch(report)),
    vscode.window.tabGroups.onDidChangeTabs(() => followTab()?.catch(report)),
    vscode.window.tabGroups.onDidChangeTabGroups(() => followTab()?.catch(report)),
    vscode.window.onDidChangeActiveTerminal((t) => followTerminal(t)?.catch(report)),
    // A terminal opened on a profile knows its folder only once shell integration starts. The event also
    // fires on each `cd`, which is left alone, as before.
    vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (integrated.has(e.terminal)) return
      integrated.add(e.terminal)
      if (e.terminal === vscode.window.activeTerminal) followTerminal(e.terminal)?.catch(report)
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`peacock.${keys()[0]}`)) peacockChanged().catch(report)
    }),
  )
  followTab()?.catch(report)
}
exports.deactivate = () => {}

const report = (error) => console.error('project-colors:', error)

// For tests/extension.test.js: the parts that need no window.
exports.internal = { lighten, ink, accentOf, freeColor, projectOf, colorOf, saveColor, saveAccent, OURS, ourColors, setOurColors, PROFILE, terminalProfile }
