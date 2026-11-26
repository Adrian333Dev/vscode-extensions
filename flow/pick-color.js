#!/usr/bin/env node
// pick-color.js <project folder>: give a project a colour outside VS Code, as the extension's setup command
// does inside it. Run by `flow init`.
//
// A project that already has a colour keeps it. Otherwise it gets the favourite farthest from the colours of
// the other git repos beside it (its workspace), written into its .vscode/settings.json with its accent
// (`flow.accent`). Either way the colour is printed.
const fs = require('fs')
const path = require('path')
const colors = require('./colors')

const favorites = require('./package.json').contributes.configuration.properties['flow.favorites'].default

const pick = (dir) => {
  const own = colors.colorIn(dir)
  if (own) return { color: own, written: false }
  const parent = path.dirname(dir)
  let siblings = []
  try { siblings = fs.readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => path.join(parent, d.name)) } catch {}
  const used = siblings
    .filter((d) => d !== dir && fs.existsSync(path.join(d, '.git')))
    .map((d) => colors.colorIn(d))
    .filter(Boolean)
  const color = colors.freeColor(favorites.map((f) => f.value), used, colors.LIGHTEN)
  if (!color) return { color: undefined, written: false }
  colors.saveColorIn(dir, color)
  colors.saveAccentIn(dir, colors.accentOf(color, favorites))
  return { color, written: true }
}

if (require.main === module) {
  const target = process.argv[2]
  if (!target) {
    console.error('usage: pick-color.js <project folder>')
    process.exit(2)
  }
  const { color } = pick(path.resolve(target))
  if (!color) {
    console.error('no free colour left: set one with "Change this project\'s colour"')
    process.exit(1)
  }
  console.log(color)
}

module.exports = { pick }
