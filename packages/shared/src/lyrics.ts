import type { LyricLine, LyricWord, RawLyrics } from './types.ts'

const LRC_TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
const YRC_LINE = /^\[(\d+),(\d+)\](.*)$/
const YRC_WORD = /\((\d+),(\d+),\d+\)([^(]*)/g

function fractionToMs(frac: string | undefined): number {
  if (!frac) return 0
  if (frac.length === 1) return Number(frac) * 100
  if (frac.length === 2) return Number(frac) * 10
  return Number(frac.slice(0, 3))
}

/** 解析逐行歌词（LRC），一行可以有多个时间戳 */
export function parseLrc(text: string | null | undefined): { startMs: number; text: string }[] {
  if (!text) return []
  const out: { startMs: number; text: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('{')) continue
    const times: number[] = []
    LRC_TIME.lastIndex = 0
    let m: RegExpExecArray | null
    let lastEnd = 0
    while ((m = LRC_TIME.exec(line)) !== null) {
      times.push(Number(m[1]) * 60000 + Number(m[2]) * 1000 + fractionToMs(m[3]))
      lastEnd = m.index + m[0].length
    }
    if (times.length === 0) continue
    const content = line.slice(lastEnd).trim()
    for (const t of times) out.push({ startMs: t, text: content })
  }
  out.sort((a, b) => a.startMs - b.startMs)
  return out
}

/** 解析网易云逐字歌词（YRC）：[行开始,行时长](字开始,字时长,0)字... */
export function parseYrc(text: string | null | undefined): LyricLine[] {
  if (!text) return []
  const out: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('{')) continue
    const m = YRC_LINE.exec(line)
    if (!m) continue
    const startMs = Number(m[1])
    const durMs = Number(m[2])
    const words: LyricWord[] = []
    YRC_WORD.lastIndex = 0
    let w: RegExpExecArray | null
    while ((w = YRC_WORD.exec(m[3])) !== null) {
      words.push({ startMs: Number(w[1]), durationMs: Number(w[2]), text: w[3] })
    }
    const lineText = words.length ? words.map((x) => x.text).join('') : m[3]
    out.push({ startMs, endMs: startMs + durMs, text: lineText, words: words.length ? words : undefined })
  }
  out.sort((a, b) => a.startMs - b.startMs)
  return out
}

/** 把翻译按时间戳对齐到最近的一行（误差 500 毫秒以内） */
function attachTranslations(lines: LyricLine[], translations: { startMs: number; text: string }[]): void {
  if (!translations.length) return
  for (const line of lines) {
    let best: { startMs: number; text: string } | null = null
    let bestDiff = Infinity
    for (const t of translations) {
      const diff = Math.abs(t.startMs - line.startMs)
      if (diff < bestDiff) {
        bestDiff = diff
        best = t
      }
    }
    if (best && bestDiff <= 500 && best.text) line.translation = best.text
  }
}

/** 统一入口：优先逐字歌词，没有就用逐行歌词，都没有返回空数组 */
export function parseLyrics(raw: RawLyrics, trackDurationMs = 0): LyricLine[] {
  let lines = parseYrc(raw.yrc)
  if (!lines.length) {
    const lrc = parseLrc(raw.lrc).filter((l) => l.text)
    lines = lrc.map((l, i) => ({
      startMs: l.startMs,
      endMs: i + 1 < lrc.length ? lrc[i + 1].startMs : Math.max(l.startMs + 5000, trackDurationMs),
      text: l.text,
    }))
  }
  attachTranslations(lines, parseLrc(raw.tlyric))
  return lines
}

/** 找到当前进度所在的行；还没到第一行返回 -1 */
export function findLyricIndex(lines: LyricLine[], positionMs: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].startMs <= positionMs) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
