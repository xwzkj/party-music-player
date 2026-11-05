import { LRUCache } from 'lru-cache'
import { AppError } from '@pmp/shared'
import { neteaseRepo } from '../db/netease.ts'
import type { RoomRuntime } from '../domain/room.ts'
import { limiter } from '../infra/rateLimit.ts'
import { music } from '../music/index.ts'

const perUser = limiter(30, 60_000)
/** 按"请求者 + 歌曲 + 音质"缓存，只用来合并同一个人的重复请求 */
const cache = new LRUCache<string, { url: string; expiresAt: number; via: Via }>({ max: 2000, ttl: 5 * 60_000 })

type Via = 'self' | 'host' | 'trial'

/**
 * 每台出声设备各自取播放地址：
 * 1. 本人账号；2. 房主账号（没绑定时匿名取）；3. 允许试听时接受试听地址；4. TRACK_UNAVAILABLE
 */
export async function getPlayUrl(
  room: RoomRuntime,
  userId: string,
  itemId: string,
): Promise<{ url: string; expiresAt: number; via: Via }> {
  const m = room.members.get(userId)
  if (!m || m.left) throw new AppError('FORBIDDEN', 403)
  const item = room.current?.id === itemId ? room.current : room.queue.get(itemId)
  if (!item) throw new AppError('STALE_ITEM')
  if (!perUser.take(userId)) throw new AppError('RATE_LIMITED', 429)

  const level = room.settings.audioLevel
  const key = `${userId}:${item.track.sourceId}:${level}`
  const hit = cache.get(key)
  if (hit && hit.expiresAt - Date.now() > 60_000) return hit

  const self = neteaseRepo.get(userId)?.cookie
  const host = userId === room.ownerId ? undefined : neteaseRepo.get(room.ownerId)?.cookie
  const attempts: { via: Via; cookie: string | undefined }[] = []
  if (self) attempts.push({ via: 'self', cookie: self })
  if (host) attempts.push({ via: 'host', cookie: host })
  if (!self && !host) attempts.push({ via: 'host', cookie: undefined })

  let trial: { url: string; expiresAt: number } | null = null
  for (const a of attempts) {
    let r
    try {
      r = await music.getPlayUrl(item.track.sourceId, level, a.cookie)
    } catch {
      continue
    }
    if (r.url && !r.trialOnly) {
      const v = { url: r.url, expiresAt: r.expiresAt, via: a.via }
      cache.set(key, v, { ttl: Math.max(1000, r.expiresAt - Date.now() - 60_000) })
      return v
    }
    if (r.url && r.trialOnly && !trial) trial = { url: r.url, expiresAt: r.expiresAt }
  }
  if (trial && room.settings.allowTrialTracks) return { ...trial, via: 'trial' }
  throw new AppError('TRACK_UNAVAILABLE')
}
