// node --test flow/tests: pick-color.js over a scratch workspace of projects.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pick } = require('../pick-color.js')

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-color-'))
const project = (name, settingsText) => {
  const dir = path.join(scratch, name)
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
  if (settingsText !== undefined) {
    fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), settingsText)
  }
  return dir
}
const settingsOf = (dir) => fs.readFileSync(path.join(dir, '.vscode', 'settings.json'), 'utf8')
const accentOf = (color) => require('../package.json').contributes.configuration.properties['flow.favorites'].default.find((f) => f.value === color).accent

test('a project with a colour keeps it, and nothing is written', () => {
  const dir = project('reader', '{\n  "peacock.remoteColor": "#06130D"\n}\n')
  assert.deepStrictEqual(pick(dir), { color: '#06130d', written: false })
  assert.strictEqual(settingsOf(dir), '{\n  "peacock.remoteColor": "#06130D"\n}\n')
})

test('a new project gets a favourite none of its neighbours use, with its accent', () => {
  project('playground', '{\n  "peacock.remoteColor": "#0a0908"\n}\n')
  fs.mkdirSync(path.join(scratch, 'not-a-repo', '.vscode'), { recursive: true })
  fs.writeFileSync(path.join(scratch, 'not-a-repo', '.vscode', 'settings.json'), '{ "flow.color": "#14161a" }')
  const dir = project('fresh')
  const { color, written } = pick(dir)
  assert.strictEqual(written, true)
  assert.ok(!['#06130d', '#0a0908'].includes(color))
  assert.strictEqual(settingsOf(dir), `{\n  "flow.color": "${color}",\n  "flow.accent": "${accentOf(color)}"\n}\n`)
  assert.deepStrictEqual(pick(dir), { color, written: false })
})

test.after(() => fs.rmSync(scratch, { recursive: true, force: true }))
