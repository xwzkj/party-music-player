import type { PlayVoteKind, Timeline, VoteMode } from '@pmp/shared'

/** 投票阈值：任何人 1 票；一半 ⌈P/2⌉；所有人 P */
export function voteThreshold(mode: VoteMode, presentCount: number): number {
  const P = Math.max(1, presentCount)
  if (mode === 'anyone') return 1
  if (mode === 'half') return Math.ceil(P / 2)
  return P
}

/** 只统计在场成员的票 */
export function countValidVotes(voters: Set<string>, present: Set<string>): number {
  let n = 0
  for (const v of voters) if (present.has(v)) n++
  return n
}

export function votePasses(voters: Set<string>, present: Set<string>, mode: VoteMode, presentCount: number): boolean {
  const n = countValidVotes(voters, present)
  return n > 0 && n >= voteThreshold(mode, presentCount)
}

/** 当前状态下能否发起某种投票（见 4.6.2） */
export function voteOpen(kind: PlayVoteKind, t: Timeline, hasHistory: boolean): boolean {
  if (t.itemId === null || t.state === 'idle') return false
  switch (kind) {
    case 'skip':
      return t.state === 'playing' || t.state === 'paused'
    case 'prev':
      return (t.state === 'playing' || t.state === 'paused') && hasHistory
    case 'pause':
      return t.state === 'playing'
    case 'resume':
      return t.state === 'paused' && (t.pausedBy === 'host' || t.pausedBy === 'vote')
  }
}

/**
 * 反向投票冷却：任何一次暂停或继续生效后 cooldownMs 内不接受反向投票。
 * lastToggle 记录最后一次生效的是 pause 还是 resume，以及时间。
 */
export function reverseCooldownBlocks(
  kind: PlayVoteKind,
  lastToggle: { kind: 'pause' | 'resume'; at: number } | null,
  now: number,
  cooldownMs: number,
): boolean {
  if (!lastToggle) return false
  if (kind !== 'pause' && kind !== 'resume') return false
  if (kind === lastToggle.kind) return false
  return now - lastToggle.at < cooldownMs
}

/** 历史里最近一首不是因出错而结束的歌的下标；没有返回 -1 */
export function findReplayable<T extends { reason: string }>(history: T[]): number {
  return history.findIndex((h) => h.reason !== 'error')
}
