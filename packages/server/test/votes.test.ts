import { describe, expect, it } from 'vitest'
import type { Timeline } from '@pmp/shared'
import { findReplayable, reverseCooldownBlocks, voteOpen, votePasses, voteThreshold } from '../src/domain/votes.ts'

const tl = (over: Partial<Timeline>): Timeline => ({
  itemId: 'x',
  durationMs: 1000,
  state: 'playing',
  startedAt: 0,
  pausedAtMs: 0,
  pausedBy: null,
  ...over,
})

describe('vote thresholds', () => {
  it.each([
    ['anyone', 1, 1],
    ['anyone', 6, 1],
    ['half', 1, 1],
    ['half', 2, 1],
    ['half', 5, 3],
    ['half', 6, 3],
    ['all', 1, 1],
    ['all', 2, 2],
    ['all', 5, 5],
    ['all', 6, 6],
  ] as const)('%s with P=%i needs %i', (mode, P, needed) => {
    expect(voteThreshold(mode, P)).toBe(needed)
  })

  it('half mode with 6 present: 3 votes pass, 2 do not', () => {
    const present = new Set(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(votePasses(new Set(['a', 'b']), present, 'half', 6)).toBe(false)
    expect(votePasses(new Set(['a', 'b', 'c']), present, 'half', 6)).toBe(true)
  })

  it('only counts present voters', () => {
    const present = new Set(['a', 'b'])
    expect(votePasses(new Set(['a', 'ghost']), present, 'all', 2)).toBe(false)
  })
})

describe('vote open states', () => {
  it('skip open when playing or paused', () => {
    expect(voteOpen('skip', tl({}), false)).toBe(true)
    expect(voteOpen('skip', tl({ state: 'paused', pausedBy: 'host' }), false)).toBe(true)
    expect(voteOpen('skip', tl({ state: 'idle', itemId: null }), false)).toBe(false)
  })
  it('prev needs history', () => {
    expect(voteOpen('prev', tl({}), false)).toBe(false)
    expect(voteOpen('prev', tl({}), true)).toBe(true)
  })
  it('pause only while playing', () => {
    expect(voteOpen('pause', tl({}), false)).toBe(true)
    expect(voteOpen('pause', tl({ state: 'paused', pausedBy: 'vote' }), false)).toBe(false)
  })
  it('resume only when paused by host or vote', () => {
    expect(voteOpen('resume', tl({ state: 'paused', pausedBy: 'host' }), false)).toBe(true)
    expect(voteOpen('resume', tl({ state: 'paused', pausedBy: 'vote' }), false)).toBe(true)
    expect(voteOpen('resume', tl({ state: 'paused', pausedBy: 'noListener' }), false)).toBe(false)
    expect(voteOpen('resume', tl({}), false)).toBe(false)
  })
})

describe('reverse cooldown', () => {
  it('blocks the opposite vote within 10 seconds', () => {
    const last = { kind: 'pause' as const, at: 1000 }
    expect(reverseCooldownBlocks('resume', last, 5000, 10_000)).toBe(true)
    expect(reverseCooldownBlocks('resume', last, 11_001, 10_000)).toBe(false)
    expect(reverseCooldownBlocks('pause', last, 5000, 10_000)).toBe(false)
    expect(reverseCooldownBlocks('skip', last, 5000, 10_000)).toBe(false)
  })
})

describe('replay', () => {
  it('skips items that ended with error', () => {
    expect(findReplayable([{ reason: 'error' }, { reason: 'skipped' }])).toBe(1)
    expect(findReplayable([{ reason: 'error' }])).toBe(-1)
  })
})
