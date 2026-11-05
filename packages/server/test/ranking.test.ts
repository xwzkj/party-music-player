import { describe, expect, it } from 'vitest'
import type { Track } from '@pmp/shared'
import { downvoteCounts, normalizeWeights, rankQueue, scoreItem, type RankingParams } from '../src/domain/ranking.ts'
import type { QueueItem } from '../src/domain/room.ts'

const MIN = 60_000
const W = { vote: 4, adds: 2.6, order: 2.6, popularity: 2.4, duration: 1 }

function track(over: Partial<Track> = {}): Track {
  return {
    source: 'netease',
    sourceId: '1',
    title: 't',
    artists: [],
    album: '',
    coverUrl: '',
    durationMs: 4 * MIN,
    popularity: 50,
    playability: 'full',
    ...over,
  }
}

function item(id: string, over: Partial<QueueItem> = {}): QueueItem {
  return { id, track: track(), addedBy: ['owner'], firstAddedAt: 0, votes: new Map(), pinnedAt: null, ...over }
}

function params(P: number, over: Partial<RankingParams> = {}): RankingParams {
  const ids = new Set(Array.from({ length: P }, (_, i) => `u${i}`))
  ids.add('owner')
  return {
    weights: W,
    presentIds: ids,
    presentCount: P,
    now: 0,
    orderCapMs: 60 * MIN,
    durationBestMs: 2 * MIN,
    durationWorstMs: 7 * MIN,
    ...over,
  }
}

describe('ranking', () => {
  it('normalizes weights by sum', () => {
    const n = normalizeWeights(W)
    expect(n.vote + n.adds + n.order + n.popularity + n.duration).toBeCloseTo(1)
    expect(n.vote).toBeCloseTo(4 / 12.6)
  })

  it('one more upvote adds about 6.3 points when P = 5', () => {
    const a = item('a')
    const b = item('b', { votes: new Map([['u1', 1]]) })
    const p = params(5)
    const k = downvoteCounts([a, b], p.presentIds)
    expect(scoreItem(b, p, k).total - scoreItem(a, p, k).total).toBeCloseTo(6.35, 1)
  })

  it('waiting 10 minutes adds about 3.4 points', () => {
    const a = item('a')
    const p0 = params(10)
    const p1 = params(10, { now: 10 * MIN })
    const k = new Map<string, number>()
    expect(scoreItem(a, p1, k).total - scoreItem(a, p0, k).total).toBeCloseTo(3.44, 1)
  })

  it('dilutes downvotes by 1/sqrt(k)', () => {
    const items = [1, 2, 3, 4].map((n) => item(`i${n}`, { votes: new Map([['u1', -1]]) }))
    const p = params(10)
    const k = downvoteCounts(items, p.presentIds)
    expect(k.get('u1')).toBe(4)
    const neutral = item('n')
    const diff = scoreItem(neutral, p, k).vote - scoreItem(items[0], p, k).vote
    // 每票 0.5，相当于半个赞
    const fullVote = scoreItem(item('x', { votes: new Map([['u2', 1]]) }), p, k).vote - scoreItem(neutral, p, k).vote
    expect(diff).toBeCloseTo(fullVote / 2)
  })

  it('ignores votes on your own song and votes from absent users', () => {
    const own = item('a', { votes: new Map([['owner', 1]]) })
    const absent = item('b', { votes: new Map([['ghost', -1]]) })
    const plain = item('c')
    const p = params(5)
    const k = downvoteCounts([own, absent, plain], p.presentIds)
    expect(scoreItem(own, p, k).vote).toBeCloseTo(scoreItem(plain, p, k).vote)
    expect(scoreItem(absent, p, k).vote).toBeCloseTo(scoreItem(plain, p, k).vote)
  })

  it('puts pinned first, then by score, ties by first added', () => {
    const a = item('a', { firstAddedAt: 2 })
    const b = item('b', { firstAddedAt: 1 })
    const c = item('c', { firstAddedAt: 3, votes: new Map([['u1', 1]]) })
    const d = item('d', { firstAddedAt: 4, pinnedAt: 100 })
    const e = item('e', { firstAddedAt: 5, pinnedAt: 50 })
    const order = rankQueue([a, b, c, d, e], params(5, { now: 0 })).map((r) => r.item.id)
    expect(order).toEqual(['e', 'd', 'c', 'b', 'a'])
  })

  it('excludes the locked next item', () => {
    const order = rankQueue([item('a'), item('b')], params(3), 'a').map((r) => r.item.id)
    expect(order).toEqual(['b'])
  })

  it('handles P = 1', () => {
    const a = item('a', { addedBy: ['u0'] })
    const s = scoreItem(a, params(1), new Map())
    expect(s.adds).toBeCloseTo(100 * (2.6 / 12.6))
    expect(Number.isFinite(s.total)).toBe(true)
  })

  it('scores duration linearly between 2 and 7 minutes', () => {
    const p = params(5)
    const k = new Map<string, number>()
    const short = scoreItem(item('a', { track: track({ durationMs: 2 * MIN }) }), p, k).duration
    const mid = scoreItem(item('b', { track: track({ durationMs: 4.5 * MIN }) }), p, k).duration
    const long = scoreItem(item('c', { track: track({ durationMs: 8 * MIN }) }), p, k).duration
    expect(long).toBe(0)
    expect(mid).toBeCloseTo(short / 2)
  })
})
