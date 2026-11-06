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

/**
 * 把翻译按时间戳对齐到原文行。
 *
 * 网易云的 tlyric 和 lrc/yrc 是两份独立文件，时间戳经常不完全相同：
 * 可能整体偏移几百毫秒到两三秒，也可能少几行（纯音乐段没有翻译）。
 * 这里按时间顺序做一次动态规划对齐，允许跳行，避免“差一点就完全不显示”。
 */
function attachTranslations(lines: LyricLine[], translations: { startMs: number; text: string }[]): void {
  const trans = translations.filter((t) => t.text.trim())
  if (!lines.length || !trans.length) return

  const n = lines.length
  const m = trans.length
  // 匹配窗口 4 秒；跳过一次的代价 1.5 秒，意味着 3 秒内的偏移会优先匹配
  const MAX_DIFF = 4000
  const SKIP = 1500
  // 极端长歌词退化为简单最近匹配，避免分配过大的矩阵
  if ((n + 1) * (m + 1) > 1_000_000) {
    attachNearest(lines, trans, MAX_DIFF)
    return
  }

  const w = m + 1
  const dp = new Float64Array((n + 1) * w)
  for (let i = 1; i <= n; i++) dp[i * w] = i * SKIP
  for (let j = 1; j <= m; j++) dp[j] = j * SKIP

  for (let i = 1; i <= n; i++) {
    const lineAt = lines[i - 1].startMs
    for (let j = 1; j <= m; j++) {
      const diff = Math.abs(lineAt - trans[j - 1].startMs)
      const matched = diff <= MAX_DIFF ? dp[(i - 1) * w + j - 1] + diff : Number.POSITIVE_INFINITY
      const skipLine = dp[(i - 1) * w + j] + SKIP
      const skipTrans = dp[i * w + j - 1] + SKIP
      dp[i * w + j] = Math.min(matched, skipLine, skipTrans)
    }
  }

  // 回溯出匹配对；按时间顺序写入，一条翻译只使用一次
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const cur = dp[i * w + j]
    const diff = Math.abs(lines[i - 1].startMs - trans[j - 1].startMs)
    if (diff <= MAX_DIFF && Math.abs(cur - (dp[(i - 1) * w + j - 1] + diff)) < 1e-6) {
      lines[i - 1].translation = trans[j - 1].text
      i--
      j--
    } else if (Math.abs(cur - (dp[(i - 1) * w + j] + SKIP)) < 1e-6) {
      i--
    } else {
      j--
    }
  }
}

/** 超长歌词的退路：各自找最近的、未被占用的翻译 */
function attachNearest(
  lines: LyricLine[],
  trans: { startMs: number; text: string }[],
  maxDiff: number,
): void {
  const used = new Set<number>()
  for (const line of lines) {
    let best = -1
    let bestDiff = maxDiff + 1
    for (let j = 0; j < trans.length; j++) {
      if (used.has(j)) continue
      const diff = Math.abs(trans[j].startMs - line.startMs)
      if (diff < bestDiff) {
        bestDiff = diff
        best = j
      }
    }
    if (best >= 0) {
      used.add(best)
      line.translation = trans[best].text
    }
  }
}

/** 统一入口：优先逐字歌词，没有就用逐行歌词，都没有返回空数组 */
export function parseLyrics(raw: RawLyrics, trackDurationMs = 0): LyricLine[] {
  let lines = parseYrc(raw.yrc)
  const fromYrc = lines.length > 0
  if (!fromYrc) {
    const lrc = parseLrc(raw.lrc).filter((l) => l.text)
    lines = lrc.map((l, i) => ({
      startMs: l.startMs,
      endMs: i + 1 < lrc.length ? lrc[i + 1].startMs : Math.max(l.startMs + 5000, trackDurationMs),
      text: l.text,
    }))
  }
  // 逐字歌词优先用同源的 ytlrc：它和 yrc 的时间戳一致，tlyric 则可能整体或逐行错位
  const wordTranslations = fromYrc ? parseLrc(raw.ytlrc) : []
  attachTranslations(lines, wordTranslations.length ? wordTranslations : parseLrc(raw.tlyric))
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
