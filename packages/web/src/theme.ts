import { getColorFromImage, setColorScheme } from 'mdui'
import { coverProxy } from './ui'

export const DEFAULT_SEED = '#f06a4f'
let lastSeed = ''
let lastUrl = ''

export function applySeed(hex: string): void {
  if (hex === lastSeed) return
  lastSeed = hex
  setColorScheme(hex)
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
