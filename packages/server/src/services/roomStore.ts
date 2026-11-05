import type { RoomSettings, Timeline, Track } from '@pmp/shared'
import { config, defaultWeights } from '../config.ts'
import { roomsRepo } from '../db/rooms.ts'
import { pauseTimeline } from '../domain/timeline.ts'
import {
  defaultRoomSettings,
  emptyPlayVotes,
  type MemberRuntime,
  type PlayedItem,
  type QueueItem,
  type RoomRuntime,
} from '../domain/room.ts'

const rooms = new Map<string, RoomRuntime>()
const codes = new Map<string, string>()

export const roomStore = {
  get(id: string): RoomRuntime | undefined {
    return rooms.get(id)
  },
  byCode(code: string): RoomRuntime | undefined {
    const id = codes.get(code)
    return id ? rooms.get(id) : undefined
  },
  all(): RoomRuntime[] {
    return [...rooms.values()]
  },
  add(room: RoomRuntime): void {
    rooms.set(room.id, room)
    codes.set(room.code, room.id)
  },
  remove(room: RoomRuntime): void {
    rooms.delete(room.id)
    if (codes.get(room.code) === room.id) codes.delete(room.code)
  },
  clear(): void {
    rooms.clear()
    codes.clear()
  },

  /** 启动时从 SQLite 恢复所有开放的房间 */
  loadAll(now: number): void {
    for (const r of roomsRepo.listOpen()) {
      const settings: RoomSettings = { ...defaultRoomSettings(defaultWeights, false), ...JSON.parse(r.settings_json) }
      let timeline = JSON.parse(r.timeline_json) as Timeline
      const members = new Map<string, MemberRuntime>()
      for (const m of roomsRepo.listMembers(r.id)) {
        members.set(m.user_id, {
          userId: m.user_id,
          nickname: m.nickname ?? m.username,
          isHost: m.user_id === r.owner_id || m.role === 'admin',
          online: false,
          lastSeenAt: m.last_seen_at,
          left: !!m.left,
        })
      }
      const adds = new Map<string, string[]>()
      for (const a of roomsRepo.listAdds(r.id)) {
        const arr = adds.get(a.item_id) ?? []
        arr.push(a.user_id)
        adds.set(a.item_id, arr)
      }
      const votes = new Map<string, Map<string, 1 | -1>>()
      for (const v of roomsRepo.listVotes(r.id)) {
        const m = votes.get(v.item_id) ?? new Map()
        m.set(v.user_id, v.value)
        votes.set(v.item_id, m)
      }
      const queue = new Map<string, QueueItem>()
      let current: QueueItem | null = null
      for (const row of roomsRepo.listItems(r.id)) {
        const item: QueueItem = {
          id: row.id,
          track: JSON.parse(row.track_json) as Track,
          addedBy: adds.get(row.id) ?? [],
          firstAddedAt: row.first_added_at,
          votes: votes.get(row.id) ?? new Map(),
          pinnedAt: row.pinned_at,
        }
        if (row.state === 'playing') current = item
        else queue.set(item.id, item)
      }
      const history: PlayedItem[] = roomsRepo.listHistory(r.id, 50).map((h) => ({
        id: h.id,
        track: JSON.parse(h.track_json) as Track,
        addedBy: adds.get(h.id) ?? [],
        firstAddedAt: h.first_added_at,
        endedAt: h.ended_at ?? 0,
        reason: h.ended_reason ?? 'finished',
      }))
      // 原本在播放的，改为因无人出声而暂停
      if (timeline.state === 'playing') {
        timeline = pauseTimeline(timeline, Math.min(now, timeline.startedAt + timeline.durationMs), 'noListener')
      }
      if (timeline.itemId && current?.id !== timeline.itemId) {
        timeline = { itemId: null, durationMs: 0, state: 'idle', startedAt: 0, pausedAtMs: 0, pausedBy: null }
      }
      const room: RoomRuntime = {
        id: r.id,
        code: r.code,
        ownerId: r.owner_id,
        passcode: r.passcode,
        settings,
        createdAt: r.created_at,
        lastActiveAt: Math.max(r.last_active_at, now),
        members,
        bans: new Set(roomsRepo.listBans(r.id)),
        queue,
        current,
        upNextId: r.up_next_id && queue.has(r.up_next_id) ? r.up_next_id : null,
        timeline,
        playVotes: emptyPlayVotes(),
        listeners: new Map(),
        history,
        version: 1,
      }
      roomsRepo.setTimeline(room.id, room.timeline, room.upNextId)
      roomStore.add(room)
    }
  },
}

export const presenceGrace = config.presenceGraceMs
