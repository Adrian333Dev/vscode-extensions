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

// Peacock's lighten (tinycolor2): add the percentage to HSL lightness.
const lighten = (hex, percent) => {
  const [r, g, b] = toRgb(hex)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0, l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  l = Math.min(1, l + percent / 100)
  if (s === 0) return toHex([l, l, l])
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const hue = (t) => {
    t = (t + 1) % 1
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
  }
  return toHex([hue(h + 1 / 3), hue(h), hue(h - 1 / 3)])
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

// The badge's shade: lightened by `percent`, and further until it looks clearly lighter than the bar,
// since the same HSL step that stands out on a near-black colour barely shows on a mid one.
const BADGE_STEP = 0.13 // OKLab lightness; near-black colours get ~0.14 from Peacock's 10%
const badgeShade = (hex, percent) => {
  let p = percent
  while (p < 60 && oklab(lighten(hex, p))[0] - oklab(hex)[0] < BADGE_STEP) p += 2
  return lighten(hex, p)
}

// The favourite farthest from every colour in use, judged on the lighter shade, where dark colours differ.
const freeColor = (favorites, used, percent) => {
  const left = favorites.map((c) => c.toLowerCase()).filter((c) => !used.includes(c))
  if (!left.length) return undefined
  if (!used.length) return left[0]
  return left.map((c) => [c, Math.min(...used.map((u) => distance(c, u, percent)))]).sort((a, b) => b[1] - a[1])[0][0]
}

const settingsFile = (dir) => path.join(dir, '.vscode', 'settings.json')

// The project's own colour under the first of `keys` it holds (remoteColor, color). Read from the file:
// VS Code doesn't read settings in a subfolder.
const colorIn = (dir, keys) => {
  let text
  try { text = fs.readFileSync(settingsFile(dir), 'utf8') } catch { return undefined }
  for (const key of keys) {
    const found = new RegExp(`"peacock\\.${key}"\\s*:\\s*"#?([0-9a-fA-F]{3,8})"`).exec(text)
    if (found) return '#' + found[1].toLowerCase()
  }
  return undefined
}

// Writes the colour into the project's .vscode/settings.json, changing only that one line.
const saveColorIn = (dir, key, color) => {
  const file = settingsFile(dir)
  const name = `"peacock.${key}"`
  let text = '{}\n'
  try { text = fs.readFileSync(file, 'utf8') } catch {}
  const line = new RegExp(`${name.replace('.', '\\.')}\\s*:\\s*"[^"]*"`)
  if (line.test(text)) text = text.replace(line, `${name}: "${color}"`)
  else if (/^\s*\{\s*\}\s*$/.test(text)) text = `{\n  ${name}: "${color}"\n}\n`
  else text = text.replace('{', `{\n  ${name}: "${color}",`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

module.exports = { lighten, badgeShade, freeColor, colorIn, saveColorIn }
