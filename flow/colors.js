// colors.js: colour arithmetic and a project's colour line in its .vscode/settings.json, with no VS Code
// API, so the extension and pick-color.js (run by `flow init`) share them.
const fs = require('fs')
const path = require('path')

const toRgb = (hex) => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
}
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')

// HSL, each part 0 to 1.
const toHsl = (hex) => {
  const [r, g, b] = toRgb(hex)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}
const fromHsl = (h, s, l) => {
  if (s === 0) return toHex([l, l, l])
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const hue = (t) => {
    t = (t + 1) % 1
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
  }
  return toHex([hue(h + 1 / 3), hue(h), hue(h - 1 / 3)])
}

// tinycolor2's lighten, as Peacock used it: add the percentage to HSL lightness.
const lighten = (hex, percent) => {
  const [h, s, l] = toHsl(hex)
  return fromHsl(h, s, Math.min(1, l + percent / 100))
}

// The accent of a project colour: the one paired with it in the favourites (`accent` beside `value`), else
// one derived from it (its hue at HSL S80% L60%; a grey, under S25%, gives silver), so a colour picked by
// hand still gets one. The window shows it (status-bar badge, active tab and activity bar lines, activity
// bar count) and flow's terminal band reads it from `flow.accent`.
const SILVER = '#d4d8de'
const derivedAccent = (hex) => {
  const [h, s] = toHsl(hex)
  return s < 0.25 ? SILVER : fromHsl(h, 0.8, 0.6)
}
const accentOf = (hex, favorites = []) => {
  const pair = favorites.find((f) => f?.accent && f.value?.toLowerCase() === hex.toLowerCase())
  return pair ? pair.accent.toLowerCase() : derivedAccent(hex)
}

// Black or white, whichever stands out more on `background` (WCAG contrast).
const luminance = (hex) => {
  const [r, g, b] = toRgb(hex).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ink = (background) => {
  const l = luminance(background)
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#000000' : '#ffffff'
}

// The window's colours for a project colour, as Peacock painted them (its defaults, lighter shade 10%), so the
// look stayed when this extension took over painting (the user, 2026-11-25): title and status bars in the colour,
// the activity bar in the lighter shade, light text on a dark colour, dark text on a light one.
const LIGHTEN = 10
const windowColors = (color) => {
  const lighter = lighten(color, LIGHTEN)
  const fore = ink(color) === '#ffffff' ? '#e7e7e7' : '#15202b'
  const faded = `${fore}99`
  const bar = (prefix) => ({
    [`${prefix}.activeBackground`]: lighter,
    [`${prefix}.background`]: lighter,
    [`${prefix}.foreground`]: fore,
    [`${prefix}.inactiveForeground`]: faded,
  })
  return {
    ...bar('activityBar'),
    ...bar('activityBarTop'),
    'commandCenter.border': faded,
    'commandCenter.foreground': fore,
    'sash.hoverBorder': lighter,
    'statusBar.background': color,
    'statusBar.debuggingBackground': color,
    'statusBar.debuggingForeground': fore,
    'statusBar.foreground': fore,
    'statusBar.inactiveBackground': color,
    'statusBarItem.hoverBackground': lighter,
    'statusBarItem.remoteForeground': fore,
    'titleBar.activeBackground': color,
    'titleBar.activeForeground': fore,
    'titleBar.inactiveBackground': `${color}99`,
    'titleBar.inactiveForeground': faded,
  }
}

// OKLab, where distance matches how different 2 colours look.
const oklab = (hex) => {
  const [r, g, b] = toRgb(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817104294 * g + 0.6299787162 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const distance = (a, b, percent) => {
  const [x, y] = [oklab(lighten(a, percent)), oklab(lighten(b, percent))]
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

// The favourite farthest from every colour in use, judged on the lighter shade, where dark colours differ.
const freeColor = (favorites, used, percent) => {
  const left = favorites.map((c) => c.toLowerCase()).filter((c) => !used.includes(c))
  if (!left.length) return undefined
  if (!used.length) return left[0]
  return left.map((c) => [c, Math.min(...used.map((u) => distance(c, u, percent)))]).sort((a, b) => b[1] - a[1])[0][0]
}

const settingsFile = (dir) => path.join(dir, '.vscode', 'settings.json')

const quoted = (name) => `"${name.replace(/\./g, '\\.')}"`
const read = (dir) => {
  try { return fs.readFileSync(settingsFile(dir), 'utf8') } catch { return undefined }
}

// The project's own colour, `flow.color`; still read: `projectColors.color` (before 0.7.0, when the
// extension was project-colors) and the keys Peacock painted from (before 0.5.0). Read from the file: VS Code
// doesn't read settings in a subfolder.
const COLOR = 'flow.color'
const ACCENT = 'flow.accent'
// Older names: workspace-projects (0.7.0 to 0.9.x), project-colors (before 0.7.0).
const OLD = { [COLOR]: ['workspaceProjects.color', 'projectColors.color'], [ACCENT]: ['workspaceProjects.accent', 'projectColors.accent'] }
const colorIn = (dir) => {
  const text = read(dir)
  if (!text) return undefined
  for (const key of [COLOR, ...OLD[COLOR], 'peacock.remoteColor', 'peacock.color']) {
    const found = new RegExp(`${quoted(key)}\\s*:\\s*"#?([0-9a-fA-F]{3,8})"`).exec(text)
    if (found) return '#' + found[1].toLowerCase()
  }
  return undefined
}

// Writes one string setting into the project's .vscode/settings.json, changing only its line, and only when
// its value differs; true when written. A new setting goes on its own line after the last line matching
// `beside`, else first in the file.
const saveSettingIn = (dir, name, value, beside) => {
  const file = settingsFile(dir)
  const text = read(dir) ?? '{}\n'
  const line = new RegExp(`${quoted(name)}\\s*:\\s*"([^"]*)"`)
  const found = line.exec(text)
  if (found && found[1].toLowerCase() === value.toLowerCase()) return false
  const entry = `"${name}": "${value}"`
  const anchor = beside && [...text.matchAll(new RegExp(`^([ \\t]*)${beside}\\s*:\\s*"[^"]*"([ \\t]*,)?`, 'gm'))].pop()
  let next
  if (found) next = text.replace(line, entry)
  else if (/^\s*\{\s*\}\s*$/.test(text)) next = `{\n  ${entry}\n}\n`
  else if (anchor) {
    const [whole, indent, comma] = anchor
    const lines = `${whole.replace(/[ \t]*,$/, '')},\n${indent}${entry}${comma ? ',' : ''}`
    next = text.slice(0, anchor.index) + lines + text.slice(anchor.index + whole.length)
  } else next = text.replace('{', `{\n  ${entry},`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, next)
  return true
}

const saveColorIn = (dir, color) => saveSettingIn(dir, COLOR, color)
// The accent beside the project's colour, where flow's terminal band reads it.
const saveAccentIn = (dir, accent) => saveSettingIn(dir, ACCENT, accent, quoted(COLOR))

// Renames the project's colour and accent from their older names, in place; true when written.
const renameOldIn = (dir) => {
  const text = read(dir)
  if (!text) return false
  let next = text
  for (const [now, olds] of Object.entries(OLD))
    for (const old of olds) if (!new RegExp(quoted(now)).test(next)) next = next.replace(new RegExp(quoted(old)), `"${now}"`)
  if (next === text) return false
  fs.writeFileSync(settingsFile(dir), next)
  return true
}

module.exports = { LIGHTEN, lighten, windowColors, accentOf, derivedAccent, ink, freeColor, colorIn, saveColorIn, saveAccentIn, renameOldIn }
