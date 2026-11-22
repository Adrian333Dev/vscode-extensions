// A custom editor that shows an HTML file rendered, scripts on, and redraws it whenever the file or a local
// script it loads changes on disk. Read-only: the source opens through "Reopen With > Text Editor".
const vscode = require('vscode')
const fs = require('fs')
const path = require('path')

// Any HTML file renders as a browser would show it: a <base> pointing at the file's folder makes relative
// script, style and image paths load; absolute file:// paths become webview addresses; https ones load as they are.
const render = async (panel, uri) => {
  let bytes
  try { bytes = await vscode.workspace.fs.readFile(uri) } catch { return } // mid-swap: the next event renders it
  const web = (u) => panel.webview.asWebviewUri(u).toString()
  const base = '<base href="' + web(vscode.Uri.joinPath(uri, '..')) + '/">'
  let html = Buffer.from(bytes).toString('utf8').replace(/(src|href)=(["'])file:\/\/([^"']+)\2/g, (m, a, q, p) => a + '=' + q + web(vscode.Uri.file(decodeURI(p))) + q)
  // Local files load fresh on every render: the webview caches them, so a rebuilt script never reached an open tab.
  const v = Date.now()
  html = html.replace(/(src|href)=(["'])(?!https?:|data:|#|vscode-)([^"'?]+)\2/g, (m, a, q, p) => a + '=' + q + p + '?v=' + v + q)
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => h + base) : base + html
  panel.webview.html = html
}

const localFiles = (file) => {
  let html = ''
  try { html = fs.readFileSync(file, 'utf8') } catch {}
  return [...html.matchAll(/src=(["'])(?!https?:|data:|vscode-)([^"'?]+)\1/g)].map(([, , p]) =>
    p.startsWith('file://') ? decodeURI(p.slice(7)) : path.resolve(path.dirname(file), p))
}

// Node's fs.watch on each file's real folder, not VS Code's watcher: VS Code's onDidChange missed 2 cases,
// a file replaced whole (written to a temp file, then renamed over: a create, not a change) and a file
// reached through a symlinked folder (flow-dev's `.flow`). Watching the folder by real path sees both.
const watch = (files, onChange) => {
  const byFolder = new Map()
  for (const f of files) {
    let real
    try { real = fs.realpathSync(f) } catch { real = f }
    const dir = path.dirname(real)
    if (!byFolder.has(dir)) byFolder.set(dir, new Set())
    byFolder.get(dir).add(path.basename(real))
  }
  let timer
  const watchers = []
  for (const [dir, names] of byFolder) {
    try {
      watchers.push(fs.watch(dir, (_event, name) => {
        if (name && !names.has(name)) return
        clearTimeout(timer)
        timer = setTimeout(onChange, 60) // one redraw per burst of writes
      }))
    } catch {}
  }
  return () => { clearTimeout(timer); watchers.forEach((w) => w.close()) }
}

const provider = {
  openCustomDocument: (uri) => ({ uri, dispose() {} }),
  async resolveCustomEditor(document, panel) {
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.file('/')] }
    const file = document.uri.fsPath
    let stop = () => {}
    // The watched list follows the page: a script added to it is watched from the next redraw on.
    const refresh = async () => {
      stop()
      stop = watch([file, ...localFiles(file)], refresh)
      await render(panel, document.uri)
    }
    await refresh()
    panel.onDidDispose(() => stop())
  },
}

exports.activate = (context) => {
  context.subscriptions.push(vscode.window.registerCustomEditorProvider('htmlPreview.view', provider, {
    webviewOptions: { retainContextWhenHidden: true },
  }))
}
exports.deactivate = () => {}
