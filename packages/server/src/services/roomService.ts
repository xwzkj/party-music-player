import { AppError, type RoomSettings } from '@pmp/shared'
import { config, defaultWeights } from '../config.ts'
import { tx } from '../db/connection.ts'
import { neteaseRepo } from '../db/netease.ts'
import { roomsRepo } from '../db/rooms.ts'
import { usersRepo, type UserRow } from '../db/users.ts'
import { JoinLeaveDeduper } from '../domain/presence.ts'
import {
  defaultRoomSettings,
  emptyPlayVotes,
  findQueuedBySource,
  idleTimeline,
  quotaUsed,
  type QueueItem,
  type RoomRuntime,
} from '../domain/room.ts'
import { newId, randomDigits, safeEqual } from '../infra/ids.ts'
import { limiter } from '../infra/rateLimit.ts'
import { logger } from '../infra/logger.ts'
import { music } from '../music/index.ts'
import { bus } from './bus.ts'
import { chatService, trackLabel } from './chatService.ts'
import {
  advance,
  clearHalt,
  ensureLocked,
  evaluateVotes,
  hostCookie,
  isFallbackItem,
  markChanged,
  maybeAutoStart,
  playbackService,
  setUpNext,
  unlockUpNext,
} from './playbackService.ts'
import { rankRoom } from './rank.ts'
import { roomStore } from './roomStore.ts'

const joinPerUser = limiter(10, 60_000)
const joinFailPerRoom = limiter(30, 10 * 60_000)
const joinPausedUntil = new Map<string, number>()
const dedupers = new Map<string, JoinLeaveDeduper>()

function deduper(room: RoomRuntime): JoinLeaveDeduper {
  let d = dedupers.get(room.id)
  if (!d) {
    d = new JoinLeaveDeduper(config.joinLeaveDedupeMs)
    dedupers.set(room.id, d)
  }
  return d
}

const displayName = (u: UserRow): string => u.nickname ?? u.username

export function isRoomHost(room: RoomRuntime, user: UserRow): boolean {
  return user.id === room.ownerId || user.role === 'admin'
}

function requireOpen(code: string): RoomRuntime {
  const room = roomStore.byCode(code)
  if (!room) throw new AppError('ROOM_NOT_FOUND', 404)
  return room
}

/** 系统消息里用的成员昵称 */
function memberName(room: RoomRuntime, userId: string): string {
  return room.members.get(userId)?.nickname ?? '有人'
}

function requireMember(room: RoomRuntime, userId: string) {
  const m = room.members.get(userId)
  if (!m || m.left) throw new AppError('FORBIDDEN', 403)
  return m
}

function newRoomCode(): string {
  for (let i = 0; i < 50; i++) {
    const code = randomDigits(6)
    if (!roomStore.byCode(code) && !roomsRepo.codeInUse(code)) return code
  }
  throw new AppError('INTERNAL', 500, '无法分配房间号')
}

function addMemberRuntime(room: RoomRuntime, user: UserRow, now: number): void {
  room.members.set(user.id, {
    userId: user.id,
    nickname: displayName(user),
    isHost: isRoomHost(room, user),
    online: false,
    lastSeenAt: now,
    left: false,
  })
}

/** 删除只有这个人点过的歌，并把他从其他歌的点歌人里移除 */
function purgeUserFromQueue(room: RoomRuntime, userId: string): void {
  let unlocked = false
  for (const item of [...room.queue.values()]) {
    if (item.votes.delete(userId)) roomsRepo.deleteVote(item.id, userId)
    const idx = item.addedBy.indexOf(userId)
    if (idx < 0) continue
    item.addedBy.splice(idx, 1)
    roomsRepo.removeAdd(item.id, userId)
    if (item.addedBy.length === 0) {
      room.queue.delete(item.id)
      roomsRepo.deleteItem(item.id)
      if (room.upNextId === item.id) {
        room.upNextId = null
        unlocked = true
      }
    }
  }
  for (const set of Object.values(room.playVotes)) set.delete(userId)
  if (unlocked) unlockUpNext(room)
}

export const roomService = {
  create(user: UserRow, passcode: string | undefined): RoomRuntime {
    if (user.role !== 'admin' && !user.can_create_room) throw new AppError('FORBIDDEN', 403)
    for (const r of roomStore.all()) if (r.ownerId === user.id) throw new AppError('ROOM_LIMIT_REACHED', 409)
    const now = Date.now()
    const vip = (neteaseRepo.get(user.id)?.vip_type ?? 0) > 0
    const room: RoomRuntime = {
      id: newId(),
      code: newRoomCode(),
      ownerId: user.id,
      passcode: passcode ?? randomDigits(4),
      settings: defaultRoomSettings(defaultWeights, vip),
      createdAt: now,
      lastActiveAt: now,
      members: new Map(),
      bans: new Set(),
      queue: new Map(),
      current: null,
      upNextId: null,
      timeline: idleTimeline(),
      playVotes: emptyPlayVotes(),
      listeners: new Map(),
      history: [],
      version: 1,
    }
    tx(() => {
      roomsRepo.insert({
        id: room.id,
        code: room.code,
        owner_id: room.ownerId,
        passcode: room.passcode,
        settings_json: JSON.stringify(room.settings),
        timeline_json: JSON.stringify(room.timeline),
        created_at: now,
        last_active_at: now,
      })
      roomsRepo.upsertMember(room.id, user.id, now)
    })
    addMemberRuntime(room, user, now)
    roomStore.add(room)
    deduper(room).shouldAnnounce(user.id, now)
    return room
  },

  info(code: string, user: UserRow): { code: string; open: boolean; joined: boolean; isHost: boolean } {
    const room = roomStore.byCode(code)
    if (!room) return { code, open: false, joined: false, isHost: false }
    const m = room.members.get(user.id)
    return { code, open: true, joined: !!m && !room.bans.has(user.id), isHost: isRoomHost(room, user) }
  },

  myRooms(user: UserRow): { code: string; isOwner: boolean; memberCount: number }[] {
    return roomStore
      .all()
      .filter((r) => r.members.has(user.id) && !r.members.get(user.id)!.left)
      .map((r) => ({ code: r.code, isOwner: r.ownerId === user.id, memberCount: r.members.size }))
  },

  join(code: string, user: UserRow, passcode: string): void {
    const room = requireOpen(code)
    if (room.bans.has(user.id)) throw new AppError('BANNED', 403)
    const existing = room.members.get(user.id)
    if (existing) {
      // 已经加入过的人不用再输口令
      if (existing.left) this.rejoin(room, user)
      return
    }
    const now = Date.now()
    const paused = joinPausedUntil.get(room.id)
    if (paused && paused > now) throw new AppError('JOIN_PAUSED', 429)
    if (!joinPerUser.take(user.id)) throw new AppError('RATE_LIMITED', 429)
    if (!safeEqual(passcode, room.passcode)) {
      if (joinFailPerRoom.hit(room.id) >= 30) {
        joinPausedUntil.set(room.id, now + 2 * 60_000)
        joinFailPerRoom.reset(room.id)
        bus.notice(room, 'hosts', 'warn', '有人多次输错口令，房间已暂停新加入 2 分钟')
      }
      throw new AppError('BAD_PASSCODE', 403)
    }
    if (room.members.size >= config.maxMembers) throw new AppError('ROOM_FULL', 409)
    roomsRepo.upsertMember(room.id, user.id, now)
    addMemberRuntime(room, user, now)
    if (deduper(room).shouldAnnounce(user.id, now)) {
      chatService.system(room, 'join', `${displayName(user)} 加入了房间`, { userId: user.id })
    }
    markChanged(room)
  },

  /** 主动离开后再进 */
  rejoin(room: RoomRuntime, user: UserRow): void {
    const m = room.members.get(user.id)
    if (!m || !m.left) return
    const now = Date.now()
    m.left = false
    m.lastSeenAt = now
    roomsRepo.setMemberLeft(room.id, user.id, false, now)
    if (deduper(room).shouldAnnounce(user.id, now)) {
      chatService.system(room, 'join', `${m.nickname} 加入了房间`, { userId: user.id })
    }
    markChanged(room)
  },

  leave(room: RoomRuntime, userId: string): void {
    const m = room.members.get(userId)
    if (!m || m.left) return
    const now = Date.now()
    m.left = true
    m.lastSeenAt = now
    roomsRepo.setMemberLeft(room.id, userId, true, now)
    for (const set of Object.values(room.playVotes)) set.delete(userId)
    if (deduper(room).shouldAnnounce(userId, now)) {
      chatService.system(room, 'leave', `${m.nickname} 离开了房间`, { userId })
    }
    safeEvaluate(room)
    markChanged(room)
  },

  /** 设备连接、断开时更新在线状态 */
  setOnline(room: RoomRuntime, userId: string, online: boolean): void {
    const m = room.members.get(userId)
    if (!m) return
    const now = Date.now()
    m.online = online
    m.lastSeenAt = now
    roomsRepo.touchMember(room.id, userId, now)
    safeEvaluate(room)
    markChanged(room)
  },

  kick(room: RoomRuntime, actor: UserRow, targetId: string, ban: boolean): void {
    const m = room.members.get(targetId)
    if (!m) throw new AppError('NOT_FOUND', 404)
    const target = usersRepo.byId(targetId)
    if (targetId === room.ownerId || target?.role === 'admin' || targetId === actor.id) {
      throw new AppError('FORBIDDEN', 403, '不能踢出房主或管理员')
    }
    tx(() => {
      purgeUserFromQueue(room, targetId)
      room.members.delete(targetId)
      roomsRepo.deleteMember(room.id, targetId)
      if (ban) {
        room.bans.add(targetId)
        roomsRepo.addBan(room.id, targetId, Date.now())
      }
    })
    for (const [sid, l] of room.listeners) if (l.userId === targetId) room.listeners.delete(sid)
    bus.kicked(room, targetId, ban)
    chatService.system(room, 'kick', `${m.nickname} 被移出房间`, { userId: targetId })
    safeEvaluate(room)
    markChanged(room)
  },

  unban(room: RoomRuntime, userId: string): void {
    room.bans.delete(userId)
    roomsRepo.removeBan(room.id, userId)
    markChanged(room)
  },

  updateSettings(room: RoomRuntime, patch: Partial<RoomSettings>): void {
    const before = room.settings
    const next: RoomSettings = { ...before, ...patch, weights: { ...before.weights, ...(patch.weights ?? {}) } }
    const w = next.weights
    if (w.vote + w.adds + w.order + w.popularity + w.duration <= 0) {
      throw new AppError('VALIDATION_FAILED', 400, '权重之和必须大于 0')
    }
    room.settings = next
    roomsRepo.setSettings(room.id, next)
    const changes: string[] = []
    const modeName = { anyone: '任何人', half: '一半以上', all: '所有人' }
    if (before.voteMode !== next.voteMode) changes.push(`投票模式改为"${modeName[next.voteMode]}"`)
    if (before.quotaPerMember !== next.quotaPerMember) {
      changes.push(next.quotaPerMember === null ? '点歌配额改为不限' : `点歌配额改为每人 ${next.quotaPerMember} 首`)
    }
    if (before.allowTrialTracks !== next.allowTrialTracks) {
      changes.push(next.allowTrialTracks ? '允许点试听歌曲' : '不再允许点试听歌曲')
    }
    if (before.fallbackPlaylistId !== next.fallbackPlaylistId) {
      changes.push(next.fallbackPlaylistId ? '设置了兜底歌单' : '取消了兜底歌单')
    }
    if (JSON.stringify(before.weights) !== JSON.stringify(next.weights)) changes.push('调整了排序权重')
    if (changes.length) chatService.system(room, 'settings', `房主${changes.join('，')}`, { changes })
    safeEvaluate(room)
    maybeAutoStart(room)
    markChanged(room)
  },

  /** 房主改口令：传了就用传的，没传就随机生成 4 位 */
  resetPasscode(room: RoomRuntime, passcode?: string): string {
    room.passcode = passcode ?? randomDigits(4)
    roomsRepo.setPasscode(room.id, room.passcode)
    markChanged(room)
    return room.passcode
  },

  close(room: RoomRuntime, reason: string): void {
    if (!roomStore.get(room.id)) return
    chatService.system(room, 'closed', '房间已关闭', { reason })
    playbackService.disposeRoom(room)
    roomsRepo.close(room.id)
    roomStore.remove(room)
    dedupers.delete(room.id)
    bus.closed(room)
    logger.info({ room: room.code, reason }, 'room closed')
  },

  // ---------- 队列 ----------

  async addToQueue(room: RoomRuntime, user: UserRow, sourceId: string): Promise<string> {
    requireMember(room, user.id)
    const isHost = isRoomHost(room, user)
    const quick = findQueuedBySource(room, sourceId)
    if (!quick) {
      if (room.current?.track.sourceId === sourceId) throw new AppError('ALREADY_PLAYING')
      if (room.queue.size >= config.maxQueue) throw new AppError('QUEUE_FULL')
    }
    if (!isHost && room.settings.quotaPerMember !== null && !quick?.addedBy.includes(user.id)) {
      if (quotaUsed(room, user.id) >= room.settings.quotaPerMember) throw new AppError('QUOTA_EXCEEDED')
    }

    // 1. 异步取外部数据
    let track = quick?.track
    if (!quick) {
      const t = await music.getTrack(sourceId)
      if (!t) throw new AppError('TRACK_UNAVAILABLE')
      const p = await music.checkPlayability(sourceId, room.settings.audioLevel, hostCookie(room))
      if (p === 'unavailable') throw new AppError('TRACK_UNAVAILABLE')
      if (p === 'trial' && !room.settings.allowTrialTracks) throw new AppError('TRACK_TRIAL_ONLY')
      track = { ...t, playability: p }
    }

    // 2. 同步地重新校验并修改
    if (roomStore.get(room.id) !== room) throw new AppError('ROOM_CLOSED')
    requireMember(room, user.id)
    if (room.current?.track.sourceId === sourceId) throw new AppError('ALREADY_PLAYING')
    if (!isHost && room.settings.quotaPerMember !== null) {
      const existing = findQueuedBySource(room, sourceId)
      if (!existing?.addedBy.includes(user.id) && quotaUsed(room, user.id) >= room.settings.quotaPerMember) {
        throw new AppError('QUOTA_EXCEEDED')
      }
    }
    const now = Date.now()
    let item = findQueuedBySource(room, sourceId)
    let replacedFallback = false
    let announce: 'new' | 'merge' | null = null
    tx(() => {
      if (item) {
        if (item.addedBy.includes(user.id)) return
        announce = 'merge'
        item.addedBy.push(user.id)
        roomsRepo.addAdd(item.id, user.id, now)
        // 先投票再点这首歌，原来的投票作废
        if (item.votes.delete(user.id)) roomsRepo.deleteVote(item.id, user.id)
        return
      }
      if (room.queue.size >= config.maxQueue) throw new AppError('QUEUE_FULL')
      const newItem: QueueItem = {
        id: newId(),
        track: track!,
        addedBy: [user.id],
        firstAddedAt: now,
        votes: new Map(),
        pinnedAt: null,
      }
      room.queue.set(newItem.id, newItem)
      roomsRepo.insertItem(newItem.id, room.id, newItem.track, now)
      roomsRepo.addAdd(newItem.id, user.id, now)
      item = newItem
      announce = 'new'
      // 有人点歌了，撤掉自动锁定的兜底歌
      const up = room.upNextId ? room.queue.get(room.upNextId) : undefined
      if (up && isFallbackItem(up)) {
        room.queue.delete(up.id)
        roomsRepo.deleteItem(up.id)
        room.upNextId = null
        replacedFallback = true
      }
    })
    if (announce) {
      const who = memberName(room, user.id)
      const label = trackLabel(item!.track)
      chatService.system(room, 'queueAdd', announce === 'new' ? `${who} 点了 ${label}` : `${who} 也点了 ${label}`, {
        userId: user.id,
        title: item!.track.title,
      })
    }
    if (replacedFallback) unlockUpNext(room)
    else ensureLocked(room)
    clearHalt(room)
    maybeAutoStart(room)
    markChanged(room)
    return item!.id
  },

  withdraw(room: RoomRuntime, userId: string, itemId: string): void {
    requireMember(room, userId)
    const item = room.queue.get(itemId)
    if (!item) throw new AppError('STALE_ITEM')
    const idx = item.addedBy.indexOf(userId)
    if (idx < 0) throw new AppError('FORBIDDEN', 403)
    let unlocked = false
    tx(() => {
      item.addedBy.splice(idx, 1)
      roomsRepo.removeAdd(itemId, userId)
      if (item.addedBy.length === 0) {
        room.queue.delete(itemId)
        roomsRepo.deleteItem(itemId)
        if (room.upNextId === itemId) {
          room.upNextId = null
          unlocked = true
        }
      }
    })
    chatService.system(room, 'queueWithdraw', `${memberName(room, userId)} 撤回了 ${trackLabel(item.track)}`, {
      userId,
      title: item.track.title,
    })
    if (unlocked) unlockUpNext(room)
    markChanged(room)
  },

  setVote(room: RoomRuntime, userId: string, itemId: string, vote: 1 | -1 | 0): void {
    requireMember(room, userId)
    const item = room.queue.get(itemId)
    if (!item) throw new AppError('STALE_ITEM')
    if (item.addedBy.includes(userId)) throw new AppError('CANNOT_VOTE_OWN')
    const prev = item.votes.get(userId) ?? 0
    if (vote === 0) {
      item.votes.delete(userId)
      roomsRepo.deleteVote(itemId, userId)
    } else {
      item.votes.set(userId, vote)
      roomsRepo.setVote(itemId, userId, vote)
    }
    // 只在赞/踩真正变化时发消息；取消投票不发，避免来回点刷屏
    if (vote !== 0 && vote !== prev) {
      chatService.system(
        room,
        'vote',
        `${memberName(room, userId)} ${vote === 1 ? '赞了' : '踩了'} ${trackLabel(item.track)}`,
        { userId, title: item.track.title, vote },
      )
    }
    markChanged(room)
  },

  hostQueue(room: RoomRuntime, action: 'remove' | 'pin' | 'unpin' | 'setNext', itemId: string): void {
    if (action === 'remove' && room.current?.id === itemId) {
      advance(room, 'removed', '房主删歌')
      return
    }
    const item = room.queue.get(itemId)
    if (!item) throw new AppError('STALE_ITEM')
    switch (action) {
      case 'remove': {
        const wasNext = room.upNextId === itemId
        tx(() => {
          room.queue.delete(itemId)
          roomsRepo.deleteItem(itemId)
          if (wasNext) room.upNextId = null
        })
        for (const uid of item.addedBy) {
          if (uid !== room.ownerId) bus.notice(room, [uid], 'info', `你点的《${item.track.title}》被房主移除`)
        }
        chatService.system(room, 'queueRemove', `房主移除了 ${trackLabel(item.track)}`, { title: item.track.title })
        if (wasNext) unlockUpNext(room)
        break
      }
      case 'pin':
        item.pinnedAt = Date.now()
        roomsRepo.setPinned(itemId, item.pinnedAt)
        break
      case 'unpin':
        item.pinnedAt = null
        roomsRepo.setPinned(itemId, null)
        break
      case 'setNext':
        setUpNext(room, itemId)
        break
    }
    markChanged(room)
  },

  /** 改昵称后同步到所有房间 */
  renameEverywhere(userId: string, nickname: string): void {
    for (const room of roomStore.all()) {
      const m = room.members.get(userId)
      if (m) {
        m.nickname = nickname
        markChanged(room)
      }
    }
  },

  /** 房主绑定、解绑或换绑账号时，整个队列重新检查一遍 */
  async recheckRoomsOf(ownerId: string): Promise<void> {
    for (const room of roomStore.all()) {
      if (room.ownerId !== ownerId) continue
      const cookie = hostCookie(room)
      for (const item of [...room.queue.values()]) {
        let p
        try {
          p = await music.checkPlayability(item.track.sourceId, room.settings.audioLevel, cookie)
        } catch {
          continue
        }
        if (!room.queue.has(item.id)) continue
        const bad = p === 'unavailable' || (p === 'trial' && !room.settings.allowTrialTracks)
        if (bad) {
          const wasNext = room.upNextId === item.id
          room.queue.delete(item.id)
          roomsRepo.deleteItem(item.id)
          if (wasNext) unlockUpNext(room)
          bus.notice(room, item.addedBy, 'warn', `你点的《${item.track.title}》因无法播放被移除`)
        } else if (p !== item.track.playability) {
          item.track = { ...item.track, playability: p }
          roomsRepo.updateTrack(item.id, item.track)
        }
      }
      markChanged(room)
    }
  },

  /** 账号被删除：从所有房间移除，关闭他的房间 */
  purgeUser(userId: string): void {
    for (const room of roomStore.all()) {
      if (room.ownerId === userId) {
        this.close(room, 'ownerDeleted')
        continue
      }
      if (!room.members.has(userId)) continue
      tx(() => purgeUserFromQueue(room, userId))
      room.members.delete(userId)
      for (const [sid, l] of room.listeners) if (l.userId === userId) room.listeners.delete(sid)
      bus.kicked(room, userId, false)
      markChanged(room)
    }
  },

  /** 每分钟：关闭过期房间、重新判断投票阈值、触发重排广播 */
  sweep(now = Date.now()): void {
    for (const room of roomStore.all()) {
      const anyOnline = [...room.members.values()].some((m) => m.online)
      let lastSeen = room.createdAt
      for (const m of room.members.values()) lastSeen = Math.max(lastSeen, m.lastSeenAt)
      if (now - room.createdAt > config.roomMaxAgeMs) {
        this.close(room, 'maxAge')
        continue
      }
      if (!anyOnline && now - lastSeen > config.roomIdleCloseMs) {
        this.close(room, 'idle')
        continue
      }
      safeEvaluate(room)
      // 提交顺序分随时间变化，定期重排
      const order = rankRoom(room, now)
        .map((r) => r.item.id)
        .join(',')
      const prev = lastOrder.get(room.id)
      lastOrder.set(room.id, order)
      if (prev !== undefined && prev !== order) markChanged(room)
      else if (anyOnline) markChanged(room)
      roomsRepo.touch(room.id, room.lastActiveAt)
    }
  },

  requireOpen,
  requireMember,
  trackLabel,
}

const lastOrder = new Map<string, string>()

function safeEvaluate(room: RoomRuntime): void {
  try {
    evaluateVotes(room)
  } catch (e) {
    logger.warn({ err: String(e), room: room.code }, 'evaluate votes failed')
  }
}
