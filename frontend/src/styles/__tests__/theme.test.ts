import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(selector)
  if (start === -1) throw new Error(`Missing selector: ${selector}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, index)
    }
  }
  throw new Error(`Unclosed rule: ${selector}`)
}

function token(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)
  if (!match) throw new Error(`Missing token: --${name}`)
  return match[1].toLowerCase()
}

function channel(value: number): number {
  const normalized = value / 255
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  const red = channel((value >> 16) & 0xff)
  const green = channel((value >> 8) & 0xff)
  const blue = channel(value & 0xff)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const theme = read('src/styles/theme.css')
const rootTokens = ruleBody(theme, ':root')
const cyanTokens = ruleBody(theme, '[data-theme="cyan"]')

describe('gold identity', () => {
  it('makes gold the default accent', () => {
    expect(token(rootTokens, 'accent')).toBe('#f5b800')
    expect(token(rootTokens, 'accent-bright')).toBe('#ffd34d')
    expect(token(rootTokens, 'accent-deep')).toBe('#5a3a00')
    expect(token(rootTokens, 'warm-white')).toBe('#fff6dc')
    expect(token(rootTokens, 'bg')).toBe('#07060a')
  })

  it('keeps the cyan palette isolated in the alternate theme block', () => {
    expect(token(cyanTokens, 'accent')).toBe('#2bb8f0')
    expect(rootTokens).not.toContain('#2bb8f0')
    expect(rootTokens).not.toContain('#8fe3ff')
    expect(rootTokens).not.toContain('#eafaff')
    expect(rootTokens).not.toContain('#053245')
    expect(rootTokens).not.toContain('#04131f')
  })
})

describe('no legacy cyan outside the cyan theme', () => {
  const legacy = ['#2bb8f0', '#8fe3ff', '#eafaff', '#053245', '#04131f', '#030a12', '#02070d', '#02060b']
  const styleFiles = readdirSync(resolve(ROOT, 'src/styles')).filter((file) => file.endsWith('.css'))

  for (const file of styleFiles) {
    if (file === 'theme.css') continue
    it(`${file} uses theme tokens`, () => {
      const source = read(`src/styles/${file}`).toLowerCase()
      for (const hex of legacy) expect(source).not.toContain(hex)
    })
  }

  it('theme.css only uses legacy cyan inside the cyan block', () => {
    const outside = theme.replace(cyanTokens, '')
    for (const hex of legacy) expect(outside.toLowerCase()).not.toContain(hex)
  })
})

describe('contrast on the gold background', () => {
  const background = token(rootTokens, 'bg')

  for (const name of ['text', 'text-soft', 'text-muted', 'accent', 'accent-bright', 'ok', 'warn', 'danger']) {
    it(`--${name} clears WCAG AA 4.5:1`, () => {
      expect(contrast(token(rootTokens, name), background)).toBeGreaterThanOrEqual(4.5)
    })
  }
})
