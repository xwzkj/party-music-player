/**
 * 播放进度同步策略。
 *
 * 用小幅调速追偏差（`preservesPitch` 打开时是变速不变调），只有真正的跳变
 * 或偏差过大才硬跳。幅度控制在 ±3% 以内：既能慢慢追平，又不容易听出
 * 时间拉伸的痕迹；不支持变调保护的浏览器则完全不改速度。
 */
export interface SyncContext {
  /** 距上次硬跳过了多少毫秒；从未硬跳过传 Infinity */
  sinceSeekMs: number
  /** 当前音频元素是否在缓冲（waiting / stalled） */
  buffering: boolean
  /** 当前浏览器是否支持变速不变调 */
  pitchPreserved: boolean
}

export interface SyncDecision {
  /** 期望的 playbackRate；1 表示不调速 */
  rate: number
  /** 是否应该直接跳到目标位置 */
  seek: boolean
}

export const SYNC_POLICY = {
  /** 小于这个偏差完全不动，避免为了几十毫秒去碰声音 */
  deadbandSec: 0.12,
  /** 超过这个偏差说明是真正的跳变（切歌、拖进度、长时间挂起） */
  hardSeekSec: 6,
  /** 非缓冲状态下，超过这个偏差且冷却结束才硬跳 */
  softSeekSec: 3,
  /** 硬跳后的冷却时间，防止反复跳 */
  seekCooldownMs: 20_000,
  /** 调速上限 3%：1 秒偏差约 33 秒追平，听感接近原速 */
  maxRateDelta: 0.03,
} as const

export function decideSync(driftSec: number, ctx: SyncContext): SyncDecision {
  const drift = Number.isFinite(driftSec) ? driftSec : 0
  const abs = Math.abs(drift)
  if (ctx.buffering) return { rate: 1, seek: false }
  if (abs > SYNC_POLICY.hardSeekSec) return { rate: 1, seek: true }
  if (abs > SYNC_POLICY.softSeekSec && ctx.sinceSeekMs > SYNC_POLICY.seekCooldownMs) {
    return { rate: 1, seek: true }
  }
  if (!ctx.pitchPreserved || abs <= SYNC_POLICY.deadbandSec) return { rate: 1, seek: false }

  // 正数表示本机超前，需要放慢；负数表示落后，需要加快
  const direction = drift > 0 ? -1 : 1
  const delta = Math.min(SYNC_POLICY.maxRateDelta, 0.01 + abs * 0.01)
  return { rate: 1 + direction * delta, seek: false }
}
