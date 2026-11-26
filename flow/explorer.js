// The Explorer project switcher's settings, worked out without VS Code (flow-v2's docs/spec/window.md, TASK-24).
//
// A pick shows one project in the Explorer by hiding the window's other top-level entries through `files.exclude`
// in the window's own .vscode/settings.json, so the real Explorer keeps rename, drag and drop and new file.
// A pick is a project's name, WORKSPACE (the workspace's own files only), or undefined (everything).

const WORKSPACE = '(workspace)' // never a folder name: parentheses can't start a project made by `flow init`

// The top-level entries a pick hides. `names`: every entry at the window's top; `projects`: those that are projects.
const hiddenFor = (pick, names, projects, hideWorkspaceFiles) => {
  if (!pick) return []
  if (pick === WORKSPACE) return names.filter((n) => projects.includes(n))
  return names.filter((n) => n !== pick && (hideWorkspaceFiles || projects.includes(n)))
}

// `files.exclude` and `search.exclude` with the switcher's entries swapped for `hide`. `current`: the workspace's
// own values of both and `hidden`, the keys the switcher wrote last time. A key someone else set stays theirs: kept
// as it is, never taken over, never removed. A project's folder is always the switcher's, recorded or not: its
// record once went missing while its `files.exclude` key stayed (two writers at once), and the project then
// stayed hidden for good, picked or not (flow-v2, the user, 2026-11-26: picking flow-v2 showed nothing).
// `searchEvery`: a hidden folder stays in search and Ctrl+P, through a `false` key in `search.exclude`, which
// VS Code lays over `files.exclude`.
const excludesFor = (hide, current, searchEvery, projects = []) => {
  const files = { ...current.files }
  const search = { ...current.search }
  for (const key of new Set([...current.hidden, ...projects])) {
    delete files[key]
    if (search[key] === false) delete search[key]
  }
  const hidden = []
  for (const name of hide) {
    if (name in files) continue
    files[name] = true
    if (searchEvery && !(name in search)) search[name] = false
    hidden.push(name)
  }
  return { files, search, hidden }
}

// The pick that shows `place` (a project's name, WORKSPACE for a file of the workspace itself, undefined for a
// file outside the window), when the current pick hides it; undefined when it shows already.
const pickShowing = (place, pick, hideWorkspaceFiles) => {
  if (!pick || !place || place === pick) return undefined
  if (place === WORKSPACE && !hideWorkspaceFiles) return undefined
  return place
}

// Source Control follows the pick (the user left it to me, 2026-11-26: "prefer simplicity"). Git repositories are
// named by their root relative to the window's folder: '.' the workspace's own, '.flow' its records, 'reader' and
// 'reader/.flow' a project's. A root belongs to the project named by its first segment; the window's folder and
// a dot-folder (the workspace's `.flow`) belong to the workspace.
const placeOf = (root, projects) => {
  const first = root.split('/')[0]
  return root !== '.' && !first.startsWith('.') && projects.includes(first) ? first : WORKSPACE
}

// Which repositories to close and reopen for `pick`. `open`: the roots open now; `closed`: those the switcher
// closed before (a root closed by hand is in neither, so it stays closed). Returns `closed`, the switcher's
// record after the change.
const reposFor = (pick, open, closed, projects) => {
  const keep = (root) => !pick || placeOf(root, projects) === pick
  const reopen = closed.filter(keep)
  const close = open.filter((root) => !keep(root) && !closed.includes(root))
  return { close, reopen, closed: [...closed.filter((root) => !keep(root)), ...close] }
}

module.exports = { WORKSPACE, hiddenFor, excludesFor, pickShowing, placeOf, reposFor }
