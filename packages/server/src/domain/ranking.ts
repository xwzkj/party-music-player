import type { ScoreBreakdown, Weights } from '@pmp/shared'
import type { QueueItem } from './room.ts'

export interface RankingParams {
  weights: Weights
  presentIds: Set<string>
  /** 在场人数 P，最小 1 */
  presentCount: number
  now: number
  orderCapMs: number
  durationBestMs: number
  durationWorstMs: number
}

export interface RankedItem {
  item: QueueItem
  score: ScoreBreakdown
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

/** 按总和归一化权重；全为 0 时平均分配 */
export function normalizeWeights(w: Weights): Weights {
  const sum = w.vote + w.adds + w.order + w.popularity + w.duration
  if (sum <= 0) return { vote: 0.2, adds: 0.2, order: 0.2, popularity: 0.2, duration: 0.2 }
  return {
    vote: w.vote / sum,
    adds: w.adds / sum,
    order: w.order / sum,
    popularity: w.popularity / sum,
    duration: w.duration / sum,
  }
}

/** 有效票：投票人在场，且没有点过这首歌 */
function effectiveVotes(item: QueueItem, present: Set<string>): [string, 1 | -1][] {
  const out: [string, 1 | -1][] = []
  for (const [uid, v] of item.votes) {
    if (!present.has(uid)) continue
    if (item.addedBy.includes(uid)) continue
    out.push([uid, v])
  }
  return out
}

/** 每个在场用户当前在队列里一共踩了几首 */
export function downvoteCounts(items: Iterable<QueueItem>, present: Set<string>): Map<string, number> {
  const k = new Map<string, number>()
  for (const item of items) {
    for (const [uid, v] of effectiveVotes(item, present)) {
      if (v === -1) k.set(uid, (k.get(uid) ?? 0) + 1)
    }
  }
  return k
}

/** 加权净票数 V：赞记 1，踩记 1/√k */
export function weightedNetVotes(item: QueueItem, present: Set<string>, k: Map<string, number>): number {
  let v = 0
  for (const [uid, val] of effectiveVotes(item, present)) {
    if (val === 1) v += 1
    else v -= 1 / Math.sqrt(k.get(uid) ?? 1)
  }
  return v
}

export function durationScore(durationMs: number, bestMs: number, worstMs: number): number {
  if (durationMs <= bestMs) return 1
  if (durationMs >= worstMs) return 0
  return (worstMs - durationMs) / (worstMs - bestMs)
}

export function scoreItem(item: QueueItem, p: RankingParams, k: Map<string, number>): ScoreBreakdown {
  const w = normalizeWeights(p.weights)
  const P = Math.max(1, p.presentCount)
  const V = weightedNetVotes(item, p.presentIds, k)
  const sVote = clamp01(0.5 + V / P)
  const sAdds = Math.min(1, (2 * item.addedBy.length) / P)
  const sOrder = clamp01((p.now - item.firstAddedAt) / p.orderCapMs)
  const sPop = item.track.popularity == null ? 0.5 : clamp01(item.track.popularity / 100)
  const sDur = durationScore(item.track.durationMs, p.durationBestMs, p.durationWorstMs)
  const vote = 100 * w.vote * sVote
  const adds = 100 * w.adds * sAdds
  const order = 100 * w.order * sOrder
  const popularity = 100 * w.popularity * sPop
  const duration = 100 * w.duration * sDur
  return { total: vote + adds + order + popularity + duration, vote, adds, order, popularity, duration }
}

/**
 * 最终顺序：置顶的按置顶时间排最前；其余按总分从高到低，同分先点的在前。
 * excludeId 用来排除已锁定的下一首（它不参与重排）。
 */
export function rankQueue(items: Iterable<QueueItem>, p: RankingParams, excludeId: string | null = null): RankedItem[] {
  const all = [...items]
  const k = downvoteCounts(all, p.presentIds)
  const ranked = all
    .filter((i) => i.id !== excludeId)
    .map((item) => ({ item, score: scoreItem(item, p, k) }))
  ranked.sort((a, b) => {
    const pa = a.item.pinnedAt
    const pb = b.item.pinnedAt
    if (pa !== null && pb !== null) return pa - pb
    if (pa !== null) return -1
    if (pb !== null) return 1
    const diff = b.score.total - a.score.total
    if (Math.abs(diff) > 1e-9) return diff
    return a.item.firstAddedAt - b.item.firstAddedAt
  })
  return ranked
}
