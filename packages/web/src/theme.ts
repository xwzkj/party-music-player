import { getColorFromImage, setColorScheme } from 'mdui'
import { coverProxy } from './ui'

export const DEFAULT_SEED = '#f06a4f'
let lastSeed = ''
let lastUrl = ''

/**
 * mdui 的背景和各级容器色取自几乎没有彩度的中性色板，换了主题色也看不出来。
 * 这里在 mdui 生成配色之后，把一点 primary 混进这些颜色里。比例按层级递增：
 * 越"高"的容器越明显，层级之间仍然拉得开。
 */
const TINT: Record<string, { light: number; dark: number }> = {
  background: { light: 0.05, dark: 0.06 },
  surface: { light: 0.05, dark: 0.06 },
  'surface-dim': { light: 0.08, dark: 0.06 },
  'surface-bright': { light: 0.04, dark: 0.08 },
  'surface-container-lowest': { light: 0.03, dark: 0.04 },
  'surface-container-low': { light: 0.07, dark: 0.08 },
  'surface-container': { light: 0.09, dark: 0.1 },
  'surface-container-high': { light: 0.11, dark: 0.12 },
  'surface-container-highest': { light: 0.13, dark: 0.14 },
}

type Rgb = [number, number, number]

function parseRgb(v: string): Rgb | null {
  const parts = v.split(',').map((x) => Number(x.trim()))
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? (parts as Rgb) : null
}

function mix(base: Rgb, tint: Rgb, ratio: number): string {
  return base.map((c, i) => Math.round(c + (tint[i] - c) * ratio)).join(', ')
}

function tintSurfaces(): void {
  const root = document.documentElement
  // 先清掉上一次写的值，才能读到 mdui 刚生成的原始颜色
  for (const token of Object.keys(TINT)) {
    root.style.removeProperty(`--mdui-color-${token}-light`)
    root.style.removeProperty(`--mdui-color-${token}-dark`)
  }
  const cs = getComputedStyle(root)
  for (const mode of ['light', 'dark'] as const) {
    const primary = parseRgb(cs.getPropertyValue(`--mdui-color-primary-${mode}`))
    if (!primary) continue
    for (const [token, ratio] of Object.entries(TINT)) {
      const base = parseRgb(cs.getPropertyValue(`--mdui-color-${token}-${mode}`))
      // 写到内联样式上：mdui 的配色类用 var(--mdui-color-xxx-light/dark) 取值，内联的同名变量优先
      if (base) root.style.setProperty(`--mdui-color-${token}-${mode}`, mix(base, primary, ratio[mode]))
    }
  }
}

export function applySeed(hex: string): void {
  if (hex === lastSeed) return
  lastSeed = hex
  setColorScheme(hex)
  tintSurfaces()
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', hex)
}

/** 莫奈取色：从封面取主色生成整套配色；取不到时用默认种子色 */
export async function applyCoverColor(coverUrl: string | null | undefined): Promise<void> {
  if (!coverUrl) {
    lastUrl = ''
    applySeed(DEFAULT_SEED)
    return
  }
  if (coverUrl === lastUrl) return
  lastUrl = coverUrl
  try {
    const img = new Image()
    img.src = coverProxy(coverUrl)
    await img.decode()
    if (lastUrl !== coverUrl) return
    applySeed(await getColorFromImage(img))
  } catch {
    if (lastUrl === coverUrl) applySeed(DEFAULT_SEED)
  }
}
