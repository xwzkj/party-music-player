import type { PausedBy, Timeline } from '@pmp/shared'

export function positionAt(t: Timeline, now: number): number {
  if (t.state === 'playing') return Math.max(0, Math.min(t.durationMs, now - t.startedAt))
  if (t.state === 'paused') return t.pausedAtMs
  return 0
}

export function startTimeline(itemId: string, durationMs: number, now: number, bufferMs: number): Timeline {
  return { itemId, durationMs, state: 'playing', startedAt: now + bufferMs, pausedAtMs: 0, pausedBy: null }
}

export function pauseTimeline(t: Timeline, now: number, by: Exclude<PausedBy, null>): Timeline {
  if (t.state !== 'playing') return t
  // 还在缓冲（now < startedAt）时，进度按 0 算
  return { ...t, state: 'paused', pausedAtMs: Math.max(0, now - t.startedAt), pausedBy: by }
}

export function resumeTimeline(t: Timeline, now: number): Timeline {
  if (t.state !== 'paused') return t
  return { ...t, state: 'playing', startedAt: now - t.pausedAtMs, pausedBy: null }
}

export function seekTimeline(t: Timeline, now: number, positionMs: number): Timeline {
  const x = Math.max(0, Math.min(positionMs, t.durationMs))
  if (t.state === 'playing') return { ...t, startedAt: now - x }
  if (t.state === 'paused') return { ...t, pausedAtMs: x }
  return t
}

/** 距离时间轴走完还有多少毫秒；不在播放返回 null */
export function msUntilEnd(t: Timeline, now: number): number | null {
  if (t.state !== 'playing') return null
  return t.startedAt + t.durationMs - now
}

/** 距离锁定下一首的时刻还有多少毫秒；不在播放返回 null */
export function msUntilLock(t: Timeline, now: number, lockAheadMs: number): number | null {
  const end = msUntilEnd(t, now)
  if (end === null) return null
  return end - lockAheadMs
}
