// Notepad: titled notes in groups, listed in the sidebar in each project's colour.
//
// - A note is a markdown file, its title the file name: <project>/.notepad/<group>/<title>.md, or
//   <project>/.notepad/<title>.md outside any group. A group is a folder.
// - A project is a top-level git repo of the opened folder (as project-colors has it), or the opened
//   folder itself when it is a repo. Notes of the opened folder that belong to no project sit under its
//   own name. `.notepad/` goes into the project's .gitignore on the first note: notes are this machine's.
// - Each project's rows sit on its colour (`peacock.remoteColor` or `peacock.color` in its
//   .vscode/settings.json), lighter and translucent, with light text.
// - A note whose header names a session (`session: <id>`) is that Claude Code session's draft, made by
//   the session's /draft. Ctrl+Enter in its tab moves the text to ~/.local/state/notepad/outbox/<id>.md
//   and empties the note; the session's mod (flow-v2) sends it as the user's message.
const vscode = require('vscode')
const fs = require('fs')
const os = require('os')
const path = require('path')

const NOTES = '.notepad'
const TEXT = '#e7e7e7'
const outboxDir = () => path.join(os.homedir(), '.local', 'state', 'notepad', 'outbox')

// --- places: where notes live ---

const isRepo = (dir) => fs.existsSync(path.join(dir, '.git'))
const subfolders = (dir) => {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() } catch { return [] }
}

// Every place notes can live: each project, then each opened folder that is not one.
const places = () => {
  const out = []
  for (const folder of vscode.workspace.workspaceFolders || []) {
    const root = folder.uri.fsPath
    if (isRepo(root)) { out.push({ name: path.basename(root), dir: root }); continue }
    for (const name of subfolders(root)) if (!name.startsWith('.') && isRepo(path.join(root, name))) out.push({ name, dir: path.join(root, name) })
    out.push({ name: path.basename(root), dir: root, loose: true })
  }
  return out
}

// The place holding a file, the deepest first.
const placeOf = (file) => places().filter((p) => file && (file === p.dir || file.startsWith(p.dir + path.sep))).sort((a, b) => b.dir.length - a.dir.length)[0]

// --- colours, as project-colors reads them ---

const colorOf = (dir) => {
  let text
  try { text = fs.readFileSync(path.join(dir, '.vscode', 'settings.json'), 'utf8') } catch { return undefined }
  const order = vscode.env.remoteName ? ['remoteColor', 'color'] : ['color', 'remoteColor']
  for (const key of order) {
    const found = new RegExp(`"peacock\\.${key}"\\s*:\\s*"#?([0-9a-fA-F]{6})"`).exec(text)
    if (found) return '#' + found[1].toLowerCase()
  }
  return undefined
}

// Peacock's lighten (tinycolor2): the percentage added to HSL lightness. The same shade as the status bar badge.
const lighten = (hex, percent) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0, l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6
  }
  l = Math.min(1, l + percent / 100)
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const hue = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p }
  const rgb = s === 0 ? [l, l, l] : [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)]
  return rgb.map((v) => Math.round(v * 255))
}
const rgba = (hex, alpha) => (hex ? `rgba(${lighten(hex, 10).join(', ')}, ${alpha})` : undefined)

// --- notes ---

const headerOf = (text) => /^---\n[\s\S]*?\n---(?:\n|$)/.exec(text)?.[0] || ''
const sessionOf = (text) => /^session:\s*(\S+)\s*$/m.exec(headerOf(text))?.[1]

const notesIn = (dir) => {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => {
      const file = path.join(dir, e.name)
      let text = '', changed = 0
      try { text = fs.readFileSync(file, 'utf8'); changed = fs.statSync(file).mtimeMs } catch {}
      return { title: e.name.slice(0, -3), file, session: sessionOf(text), changed }
    })
    .sort((a, b) => b.changed - a.changed)
}

// What the list shows: each place with notes, its loose notes, then its groups.
const listing = () =>
  places()
    .map((place) => {
      const base = path.join(place.dir, NOTES)
      const color = colorOf(place.dir)
      // The head on the project's lighter shade, its rows fainter, as the status bar badge draws it.
      return { ...place, head: rgba(color, 0.85), body: rgba(color, 0.4), notes: notesIn(base), groups: subfolders(base).map((name) => ({ name, dir: path.join(base, name), notes: notesIn(path.join(base, name)) })) }
    })
    .filter((p) => !p.loose || p.notes.length || p.groups.length)

// `.notepad/` into the place's .gitignore and `!/.notepad/` into .ignore (search still reads notes), once.
const ignoreNotes = (place) => {
  if (!isRepo(place.dir)) return
  for (const [file, line] of [['.gitignore', `${NOTES}/`], ['.ignore', `!/${NOTES}/`]]) {
    const target = path.join(place.dir, file)
    let text = ''
    try { text = fs.readFileSync(target, 'utf8') } catch {}
    if (text.split('\n').includes(line)) continue
    fs.writeFileSync(target, text + (text && !text.endsWith('\n') ? '\n' : '') + line + '\n')
  }
}

// --- commands ---

const safeName = (name) => name.trim().replace(/[\/\\:*?"<>|]/g, '-')

// The place a new note or group goes to: the one asked, else a pick with the active file's project first.
const pickPlace = async (given) => {
  if (given) return places().find((p) => p.dir === given)
  const all = places()
  if (all.length === 1) return all[0]
  const here = placeOf(vscode.window.activeTextEditor?.document.uri.fsPath)
  const ordered = here ? [here, ...all.filter((p) => p.dir !== here.dir)] : all
  return (await vscode.window.showQuickPick(ordered.map((p) => ({ label: p.name, description: p.loose ? 'not a project' : '', place: p })), { title: 'Which project?' }))?.place
}

const newNote = async (args = {}) => {
  const place = await pickPlace(args.place)
  if (!place) return
  let group = args.group
  if (group === undefined) {
    const groups = subfolders(path.join(place.dir, NOTES))
    if (groups.length) {
      const picked = await vscode.window.showQuickPick([{ label: '(no group)', name: '' }, ...groups.map((g) => ({ label: g, name: g }))], { title: `Group in ${place.name}` })
      if (!picked) return
      group = picked.name
    } else group = ''
  }
  const title = await vscode.window.showInputBox({ title: 'Note title', prompt: [place.name, group].filter(Boolean).join(' / ') })
  if (!title?.trim()) return
  const file = path.join(place.dir, NOTES, group, `${safeName(title)}.md`)
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
    ignoreNotes(place)
  }
  await vscode.window.showTextDocument(vscode.Uri.file(file))
}

const newGroup = async (args = {}) => {
  const place = await pickPlace(args.place)
  if (!place) return
  const name = await vscode.window.showInputBox({ title: 'Group name', prompt: place.name })
  if (!name?.trim()) return
  fs.mkdirSync(path.join(place.dir, NOTES, safeName(name)), { recursive: true })
  ignoreNotes(place)
  refresh()
}

// Ctrl+Enter in a session's draft: its text to the outbox, the note emptied to its header.
const send = async () => {
  const editor = vscode.window.activeTextEditor
  if (!editor) return
  const doc = editor.document
  const text = doc.getText()
  const session = sessionOf(text)
  if (!session) return vscode.window.showInformationMessage("Notepad: this note isn't tied to a session. /draft in a Claude Code session opens that session's draft.")
  const header = headerOf(text)
  const body = text.slice(header.length).trim()
  if (!body) return
  const outbox = path.join(outboxDir(), `${session}.md`)
  if (fs.existsSync(outbox)) return vscode.window.showWarningMessage("Notepad: the last message wasn't taken yet. Is the session running?")
  fs.mkdirSync(outboxDir(), { recursive: true })
  // Written aside, then renamed: the session never reads half a file.
  fs.writeFileSync(outbox + '.tmp', body + '\n')
  fs.renameSync(outbox + '.tmp', outbox)
  await editor.edit((edit) => edit.replace(new vscode.Range(doc.positionAt(header.length), doc.positionAt(text.length)), '\n'))
  await doc.save()
  vscode.window.setStatusBarMessage('Notepad: sent', 3000)
}

// --- the list ---

let view
let pending
const refresh = () => {
  clearTimeout(pending)
  pending = setTimeout(() => view?.webview.postMessage({ type: 'list', places: listing() }), 150)
}

const html = () => {
  const nonce = Math.random().toString(36).slice(2)
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { padding: 0; margin: 0; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
  .place { margin: 0 0 6px; }
  .row { display: flex; align-items: center; padding: 2px 8px; cursor: pointer; white-space: nowrap; }
  .row:hover { filter: brightness(1.25); }
  .head { font-weight: 600; letter-spacing: 0.03em; padding: 4px 8px; }
  .group { padding-left: 16px; opacity: 0.9; }
  .note { padding-left: 16px; }
  .title { overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .tag { opacity: 0.7; font-size: 0.9em; margin-left: 6px; }
  .add { visibility: hidden; margin-left: 4px; padding: 0 4px; border-radius: 3px; }
  .row:hover .add { visibility: visible; }
  .add:hover { background: rgba(255, 255, 255, 0.15); }
  .empty { padding: 8px; opacity: 0.7; }
</style></head><body><div id="list"></div>
<script nonce="${nonce}">
  const api = acquireVsCodeApi()
  const state = api.getState() || { closed: {} }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e }
  const add = (title, message) => { const b = el('span', 'add', '+'); b.title = title; b.onclick = (ev) => { ev.stopPropagation(); api.postMessage(message) }; return b }
  const paint = (row, place, strong) => { if (place.head) { row.style.background = strong ? place.head : place.body; row.style.color = '${TEXT}' } }
  let last = []
  const draw = (places) => {
    last = places
    const list = document.getElementById('list')
    list.replaceChildren()
    if (!places.length) { list.append(el('div', 'empty', 'No projects in this window.')); return }
    for (const place of places) {
      const box = el('div', 'place')
      const head = el('div', 'row head')
      head.append(el('span', 'title', place.name.toUpperCase()), add('New group', { type: 'newGroup', place: place.dir }), add('New note', { type: 'newNote', place: place.dir, group: '' }))
      head.title = place.dir
      paint(head, place, true)
      box.append(head)
      const noteRow = (note, grouped) => {
        const row = el('div', 'row note')
        if (grouped) row.style.paddingLeft = '30px'
        row.append(el('span', 'title', note.title))
        if (note.session) row.append(el('span', 'tag', '→ session'))
        row.title = note.file
        row.onclick = () => api.postMessage({ type: 'open', file: note.file })
        paint(row, place, false)
        return row
      }
      for (const note of place.notes) box.append(noteRow(note, false))
      for (const group of place.groups) {
        const key = group.dir
        const row = el('div', 'row group')
        row.append(el('span', 'title', (state.closed[key] ? '▸ ' : '▾ ') + group.name), add('New note', { type: 'newNote', place: place.dir, group: group.name }))
        row.onclick = () => { state.closed[key] = !state.closed[key]; api.setState(state); draw(last) }
        paint(row, place, false)
        box.append(row)
        if (!state.closed[key]) for (const note of group.notes) box.append(noteRow(note, true))
      }
      list.append(box)
    }
  }
  window.addEventListener('message', (e) => { if (e.data.type === 'list') draw(e.data.places) })
  api.postMessage({ type: 'ready' })
</script></body></html>`
}

const provider = {
  resolveWebviewView(webviewView) {
    view = webviewView
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = html()
    webviewView.webview.onDidReceiveMessage((m) => {
      if (m.type === 'ready') refresh()
      else if (m.type === 'open') vscode.window.showTextDocument(vscode.Uri.file(m.file)).then(undefined, report)
      else if (m.type === 'newNote') newNote({ place: m.place, group: m.group }).catch(report)
      else if (m.type === 'newGroup') newGroup({ place: m.place }).catch(report)
    })
    webviewView.onDidChangeVisibility(() => webviewView.visible && refresh())
  },
}

exports.activate = (context) => {
  const watchers = (vscode.workspace.workspaceFolders || []).flatMap((folder) => [
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, `**/${NOTES}/**`)),
    vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, '**/.vscode/settings.json')),
  ])
  for (const w of watchers) context.subscriptions.push(w, w.onDidCreate(refresh), w.onDidChange(refresh), w.onDidDelete(refresh))
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('notepad.list', provider),
    vscode.commands.registerCommand('notepad.newNote', (args) => newNote(args).catch(report)),
    vscode.commands.registerCommand('notepad.newGroup', (args) => newGroup(args).catch(report)),
    vscode.commands.registerCommand('notepad.send', () => send().catch(report)),
    vscode.workspace.onDidChangeWorkspaceFolders(refresh),
  )
}
exports.deactivate = () => {}

const report = (error) => vscode.window.showErrorMessage(`Notepad: ${error.message || error}`)

// For tests/extension.test.js: the parts that need no window.
exports.internal = { places, placeOf, listing, sessionOf, headerOf, ignoreNotes, rgba }
