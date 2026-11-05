import type { PlayVoteKind, PlayVoteView, QueueItemView, RoomSnapshot } from '@pmp/shared'
import { neteaseRepo } from '../db/netease.ts'
import { usersRepo } from '../db/users.ts'
import { quotaUsed, type QueueItem, type RoomRuntime } from '../domain/room.ts'
import type { RankedItem } from '../domain/ranking.ts'
import { countValidVotes, findReplayable, voteOpen, voteThreshold } from '../domain/votes.ts'
import { presence, rankRoom } from './rank.ts'

const round1 = (x: number): number => Math.round(x * 10) / 10

/** 每次广播计算一次的共享部分 */
export interface SharedSnapshotData {
  now: number
  ranked: RankedItem[]
  rankedById: Map<string, RankedItem>
  present: Set<string>
  presentCount: number
  hasHistory: boolean
  nicknames: Map<string, string>
}

export function computeShared(room: RoomRuntime, now = Date.now()): SharedSnapshotData {
  const p = presence(room, now)
  const ranked = rankRoom(room, now)
  const all = rankRoom({ ...room, upNextId: null }, now)
  const rankedById = new Map(all.map((r) => [r.item.id, r]))
  const nicknames = new Map<string, string>()
  for (const m of room.members.values()) nicknames.set(m.userId, m.nickname)
  return {
    now,
    ranked,
    rankedById,
    present: p.ids,
    presentCount: p.count,
    hasHistory: findReplayable(room.history) >= 0,
    nicknames,
  }
}

function nameOf(shared: SharedSnapshotData, id: string): string {
  const n = shared.nicknames.get(id)
  if (n) return n
  const u = usersRepo.byId(id)
  const name = u ? (u.nickname ?? u.username) : '已删除用户'
  shared.nicknames.set(id, name)
  return name
}

function itemView(item: QueueItem, shared: SharedSnapshotData, userId: string): QueueItemView {
  let up = 0
  let down = 0
  for (const [uid, v] of item.votes) {
    if (item.addedBy.includes(uid)) continue
    if (v === 1) up++
    else down++
  }
  const s = shared.rankedById.get(item.id)?.score
  return {
    id: item.id,
    track: item.track,
    addedBy: item.addedBy.map((id) => ({ id, nickname: nameOf(shared, id) })),
    up,
    down,
    myVote: item.votes.get(userId) ?? 0,
    mine: item.addedBy.includes(userId),
    pinned: item.pinnedAt !== null,
    score: s
      ? {
          total: round1(s.total),
          vote: round1(s.vote),
          adds: round1(s.adds),
          order: round1(s.order),
          popularity: round1(s.popularity),
          duration: round1(s.duration),
        }
      : { total: 0, vote: 0, adds: 0, order: 0, popularity: 0, duration: 0 },
  }
}

/** 按身份裁剪的完整快照；每个连接单独生成 */
export function buildSnapshot(
  room: RoomRuntime,
  shared: SharedSnapshotData,
  userId: string,
  socketId: string,
): RoomSnapshot {
  const me = room.members.get(userId)
  const isHost = !!me?.isHost
  const account = neteaseRepo.get(userId)

  let listeningDefault = room.settings.memberAudioDefault
  if (isHost) {
    // 本人已有另一台设备在出声时，新设备默认不出声
    listeningDefault = ![...room.listeners].some(([sid, l]) => sid !== socketId && l.userId === userId && l.listening)
  }

  let nowPlaying: RoomSnapshot['nowPlaying'] = null
  if (room.current && room.timeline.itemId === room.current.id) {
    const needed = voteThreshold(room.settings.voteMode, shared.presentCount)
    const votes = {} as Record<PlayVoteKind, PlayVoteView>
    for (const kind of ['skip', 'prev', 'pause', 'resume'] as const) {
      const voters = room.playVotes[kind]
      votes[kind] = {
        count: countValidVotes(voters, shared.present),
        needed,
        mine: voters.has(userId),
        open: voteOpen(kind, room.timeline, shared.hasHistory),
      }
    }
    nowPlaying = { item: itemView(room.current, shared, userId), votes }
  }

  const upNextItem = room.upNextId ? room.queue.get(room.upNextId) : undefined
  const listeningUsers = new Set<string>()
  for (const l of room.listeners.values()) if (l.listening) listeningUsers.add(l.userId)

  const snap: RoomSnapshot = {
    version: room.version,
    serverNow: Date.now(),
    room: { code: room.code, status: 'open', settings: room.settings, ownerId: room.ownerId },
    me: {
      userId,
      isHost,
      quotaUsed: quotaUsed(room, userId),
      quotaLimit: isHost ? null : room.settings.quotaPerMember,
      neteaseBound: !!account,
      listeningDefault,
    },
    timeline: room.timeline,
    nowPlaying,
    hasHistory: shared.hasHistory,
    upNext: upNextItem ? itemView(upNextItem, shared, userId) : null,
    queue: shared.ranked.map((r) => itemView(r.item, shared, userId)),
    members: [...room.members.values()]
      .filter((m) => !m.left)
      .map((m) => ({
        id: m.userId,
        nickname: m.nickname,
        isHost: m.isHost,
        present: shared.present.has(m.userId),
        listening: listeningUsers.has(m.userId),
      })),
  }

  if (isHost) {
    const votersByItem: Record<string, { up: string[]; down: string[] }> = {}
    for (const item of room.queue.values()) {
      const up: string[] = []
      const down: string[] = []
      for (const [uid, v] of item.votes) {
        if (item.addedBy.includes(uid)) continue
        ;(v === 1 ? up : down).push(nameOf(shared, uid))
      }
      if (up.length || down.length) votersByItem[item.id] = { up, down }
    }
    snap.host = {
      passcode: room.passcode,
      votersByItem,
      neteaseVip: (neteaseRepo.get(room.ownerId)?.vip_type ?? 0) > 0,
      bans: [...room.bans].map((id) => ({ id, nickname: nameOf(shared, id) })),
    }
  }
  return snap
}
