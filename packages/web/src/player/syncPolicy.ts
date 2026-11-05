/**
 * 播放进度同步策略。
 *
 * 旧逻辑只要漂移超过 0.5 秒就硬跳，跨省用户缓冲一次就落后 0.5～1 秒，
 * 于是每秒跳一次、跳完重新缓冲、再跳——听起来就是“一卡一卡”。
 *
 * 新策略：
 * - 小漂移用播放速度追（±8%），不打断缓冲；
 * - 缓冲中绝不硬跳；
 * - 硬跳后 25 秒内不再硬跳，避免“跳转—重新缓冲—再跳”的循环；
 * - 只有切歌、拖进度这类真正的跳变（>8 秒）才立即硬跳。
 */
export interface SyncContext {
  /** 距上次硬跳过了多少毫秒；从未硬跳过传 Infinity */
  sinceSeekMs: number
  /** 当前音频元素是否在缓冲（waiting / stalled） */
  buffering: boolean
}

export interface SyncDecision {
  /** 期望的 playbackRate；1 表示不调速 */
  rate: number
  /** 是否应该直接跳到目标位置 */
  seek: boolean
}

export const SYNC_POLICY = {
  /** 小于这个漂移完全不动 */
  deadbandSec: 0.08,
  /** 超过这个漂移说明是真正的跳变（切歌、拖进度、长时间挂起） */
  hardSeekSec: 8,
  /** 非缓冲状态下，超过这个漂移且过了冷却期才硬跳 */
  softSeekSec: 4,
  /** 硬跳后的冷却时间 */
  seekCooldownMs: 25_000,
  /** 调速上限，6% 大约 17 秒追回 1 秒 */
  maxRateDelta: 0.06,
} as const

export function decideSync(driftSec: number, ctx: SyncContext): SyncDecision {
  const drift = Number.isFinite(driftSec) ? driftSec : 0
  const abs = Math.abs(drift)
  if (abs <= SYNC_POLICY.deadbandSec) return { rate: 1, seek: false }

  // 正数表示本机超前，需要放慢；负数表示落后，需要加快
  const direction = drift > 0 ? -1 : 1
  const delta = Math.min(SYNC_POLICY.maxRateDelta, 0.02 + abs * 0.02)
  const rate = 1 + direction * delta

  if (ctx.buffering) return { rate, seek: false }
  if (abs > SYNC_POLICY.hardSeekSec) return { rate: 1, seek: true }
  if (abs > SYNC_POLICY.softSeekSec && ctx.sinceSeekMs > SYNC_POLICY.seekCooldownMs) {
    return { rate: 1, seek: true }
  }
  return { rate, seek: false }
}
