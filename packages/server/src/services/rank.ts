import { config } from '../config.ts'
import { presentIds } from '../domain/presence.ts'
import { rankQueue, type RankedItem } from '../domain/ranking.ts'
import type { RoomRuntime } from '../domain/room.ts'

export function presence(room: RoomRuntime, now = Date.now()): { ids: Set<string>; count: number } {
  const members = room.members.values()
  const ids = presentIds(members, now, config.presenceGraceMs)
  return { ids, count: Math.max(1, ids.size) }
}

/** 队列排序（不含已锁定的下一首） */
export function rankRoom(room: RoomRuntime, now = Date.now()): RankedItem[] {
  const p = presence(room, now)
  return rankQueue(
    room.queue.values(),
    {
      weights: room.settings.weights,
      presentIds: p.ids,
      presentCount: p.count,
      now,
      orderCapMs: config.orderCapMs,
      durationBestMs: config.durationBestMs,
      durationWorstMs: config.durationWorstMs,
    },
    room.upNextId,
  )
}

