import { describe, expect, it } from 'vitest'
import { findLyricIndex, parseLrc, parseLyrics, parseYrc } from '../src/lyrics.ts'

describe('lyrics', () => {
  it('parses LRC with multiple timestamps and skips JSON lines', () => {
    const lines = parseLrc('{"t":0,"c":[{"tx":"作词"}]}\n[00:01.50][00:10.5]hello\n[01:02.123]world\n[ti:abc]')
    expect(lines).toEqual([
      { startMs: 1500, text: 'hello' },
      { startMs: 10_500, text: 'hello' },
      { startMs: 62_123, text: 'world' },
    ])
  })

  it('parses YRC word timings', () => {
    const [l] = parseYrc('{"t":0}\n[1000,2000](1000,500,0)你(1500,500,0)好')
    expect(l.startMs).toBe(1000)
    expect(l.endMs).toBe(3000)
    expect(l.text).toBe('你好')
    expect(l.words).toEqual([
      { startMs: 1000, durationMs: 500, text: '你' },
      { startMs: 1500, durationMs: 500, text: '好' },
    ])
  })

  it('aligns translations within 500 ms and falls back to LRC', () => {
    const lines = parseLyrics({
      yrc: null,
      lrc: '[00:01.00]a\n[00:05.00]b',
      tlyric: '[00:01.30]A\n[00:07.00]B',
    })
    expect(lines[0].translation).toBe('A')
    expect(lines[1].translation).toBeUndefined()
    expect(lines[0].endMs).toBe(5000)
  })

  it('returns empty when nothing is available', () => {
    expect(parseLyrics({ yrc: null, lrc: null, tlyric: null })).toEqual([])
  })

  it('finds the current line', () => {
    const lines = parseLyrics({ yrc: null, lrc: '[00:01.00]a\n[00:05.00]b', tlyric: null })
    expect(findLyricIndex(lines, 0)).toBe(-1)
    expect(findLyricIndex(lines, 1000)).toBe(0)
    expect(findLyricIndex(lines, 6000)).toBe(1)
  })
})
