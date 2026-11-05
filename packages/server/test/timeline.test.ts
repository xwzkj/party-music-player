import { describe, expect, it } from 'vitest'
import type { Timeline } from '@pmp/shared'
import {
  msUntilEnd,
  msUntilLock,
  pauseTimeline,
  positionAt,
  resumeTimeline,
  seekTimeline,
  startTimeline,
} from '../src/domain/timeline.ts'
import { JoinLeaveDeduper, presentCount } from '../src/domain/presence.ts'

describe('timeline', () => {
  const t0 = startTimeline('a', 60_000, 1000, 800)

  it('starts after the buffer', () => {
    expect(t0.startedAt).toBe(1800)
    expect(positionAt(t0, 1800)).toBe(0)
    expect(positionAt(t0, 11_800)).toBe(10_000)
  })

  it('pause then resume keeps position', () => {
    const p = pauseTimeline(t0, 11_800, 'host')
    expect(p.state).toBe('paused')
    expect(p.pausedAtMs).toBe(10_000)
    expect(positionAt(p, 99_999)).toBe(10_000)
    const r = resumeTimeline(p, 50_000)
    expect(r.startedAt).toBe(40_000)
    expect(positionAt(r, 50_000)).toBe(10_000)
  })

  it('seek while playing and paused', () => {
    expect(seekTimeline(t0, 5000, 20_000).startedAt).toBe(-15_000)
    const p = pauseTimeline(t0, 5000, 'vote')
    expect(seekTimeline(p, 9999, 30_000).pausedAtMs).toBe(30_000)
    expect(seekTimeline(t0, 0, 999_999).startedAt).toBe(-60_000)
  })

  it('pausing during the buffer clamps to 0', () => {
    expect(pauseTimeline(t0, 1000, 'host').pausedAtMs).toBe(0)
  })

  it('computes timer delays', () => {
    expect(msUntilEnd(t0, 1800)).toBe(60_000)
    expect(msUntilLock(t0, 1800, 15_000)).toBe(45_000)
    expect(msUntilEnd(pauseTimeline(t0, 2000, 'host'), 2000)).toBeNull()
  })
})

describe('presence', () => {
  const base = { nickname: '', isHost: false }
  it('counts online and recently seen members, min 1', () => {
    const members = [
      { ...base, userId: 'a', online: true, lastSeenAt: 0, left: false },
      { ...base, userId: 'b', online: false, lastSeenAt: 95_000, left: false },
      { ...base, userId: 'c', online: false, lastSeenAt: 0, left: false },
      { ...base, userId: 'd', online: true, lastSeenAt: 0, left: true },
    ]
    expect(presentCount(members, 100_000, 10_000)).toBe(2)
    expect(presentCount([], 0, 10_000)).toBe(1)
  })

  it('dedupes join/leave messages within 60 seconds', () => {
    const d = new JoinLeaveDeduper(60_000)
    expect(d.shouldAnnounce('a', 0)).toBe(true)
    expect(d.shouldAnnounce('a', 30_000)).toBe(false)
    expect(d.shouldAnnounce('b', 30_000)).toBe(true)
    expect(d.shouldAnnounce('a', 61_000)).toBe(true)
  })
})
