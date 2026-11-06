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

  it('时间戳有偏差时仍把翻译对齐到原文', () => {
    const lines = parseLyrics({
      yrc: null,
      lrc: '[00:01.00]a\n[00:05.00]b',
      tlyric: '[00:01.30]A\n[00:07.00]B',
    })
    expect(lines[0].translation).toBe('A')
    expect(lines[1].translation).toBe('B')
    expect(lines[0].endMs).toBe(5000)
  })

  it('逐字歌词与翻译整体偏移也能匹配', () => {
    const lines = parseLyrics({
      yrc: '[1000,2000](1000,500,0)你(1500,500,0)好',
      lrc: null,
      tlyric: '[00:01.80]Hello',
    })
    expect(lines[0].translation).toBe('Hello')
  })

  it('少一行翻译时其余行仍然对齐', () => {
    const lines = parseLyrics({
      yrc: null,
      lrc: '[00:01.00]a\n[00:05.00]b\n[00:09.00]c',
      tlyric: '[00:01.20]A\n[00:09.30]C',
    })
    expect(lines[0].translation).toBe('A')
    expect(lines[1].translation).toBeUndefined()
    expect(lines[2].translation).toBe('C')
  })

  it('多一行翻译时不会抢走后面原文的翻译', () => {
    const lines = parseLyrics({
      yrc: null,
      lrc: '[00:02.00]a\n[00:06.00]b',
      tlyric: '[00:00.50]Intro\n[00:02.40]A\n[00:06.30]B',
    })
    expect(lines[0].translation).toBe('A')
    expect(lines[1].translation).toBe('B')
  })

  it('相差太远的翻译不会硬挂上去', () => {
    const lines = parseLyrics({
      yrc: null,
      lrc: '[00:01.00]a\n[00:05.00]b',
      tlyric: '[00:01.00]A\n[00:20.00]B',
    })
    expect(lines[0].translation).toBe('A')
    expect(lines[1].translation).toBeUndefined()
  })

  it('有 ytlrc 时优先用它，tlyric 的错位不再影响翻译', () => {
    const lines = parseLyrics({
      yrc: '[0,2000](0,500,0)Hello\n[6000,2000](6000,500,0)World',
      ytlrc: '[00:00.000]你好\n[00:06.000]世界',
      tlyric: '[00:04.100]错位的翻译\n[00:06.800]也错位',
      lrc: null,
    })
    expect(lines[0].translation).toBe('你好')
    expect(lines[1].translation).toBe('世界')
  })

  it('没有 ytlrc 时回退到 tlyric', () => {
    const lines = parseLyrics({
      yrc: '[0,2000](0,500,0)Hello',
      ytlrc: '',
      tlyric: '[00:00.300]你好',
      lrc: null,
    })
    expect(lines[0].translation).toBe('你好')
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
