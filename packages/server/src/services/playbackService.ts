import { AppError, type EndedReason, type PlayVoteKind, type Track } from '@pmp/shared'
import { config } from '../config.ts'
import { tx } from '../db/connection.ts'
import { neteaseRepo } from '../db/netease.ts'
import { roomsRepo } from '../db/rooms.ts'
import { emptyPlayVotes, idleTimeline, type QueueItem, type RoomRuntime } from '../domain/room.ts'
import {
  msUntilEnd,
  msUntilLock,
  pauseTimeline,
  positionAt,
  resumeTimeline,
  seekTimeline,
  startTimeline,
} from '../domain/timeline.ts'
import { findReplayable, reverseCooldownBlocks, voteOpen, votePasses } from '../domain/votes.ts'
import { newId } from '../infra/ids.ts'
import { logger } from '../infra/logger.ts'
import { music } from '../music/index.ts'
import { bus } from './bus.ts'
import { chatService, trackLabel } from './chatService.ts'
import { presence, rankRoom } from './rank.ts'

interface PlaybackState {
  endTimer: NodeJS.Timeout | null
  lockTimer: NodeJS.Timeout | null
  noListenerTimer: NodeJS.Timeout | null
  lastToggle: { kind: 'pause' | 'resume'; at: number } | null
  anyoneCooldown: Map<string, number>
  consecutiveErrors: number
  halted: boolean
  switchToken: number
  /** 下一首被锁定的时刻，用来判断设备是否来得及预加载 */
  upNextSince: number
}

const states = new Map<string, PlaybackState>()

function st(room: RoomRuntime): PlaybackState {
  let s = states.get(room.id)
  if (!s) {
    s = {
      endTimer: null,
      lockTimer: null,
      noListenerTimer: null,
      lastToggle: null,
      anyoneCooldown: new Map(),
      consecutiveErrors: 0,
      halted: false,
      switchToken: 0,
      upNextSince: 0,
    }
    states.set(room.id, s)
  }
  return s
}

const MAX_HISTORY = 50

export function hostCookie(room: RoomRuntime): string | undefined {
  return neteaseRepo.get(room.ownerId)?.cookie
}

function hasListener(room: RoomRuntime): boolean {
  for (const l of room.listeners.values()) if (l.listening) return true
  return false
}

function changed(room: RoomRuntime): void {
  room.version++
  room.lastActiveAt = Date.now()
  bus.scheduleBroadcast(room)
}

function persistTimeline(room: RoomRuntime): void {
  roomsRepo.setTimeline(room.id, room.timeline, room.upNextId)
}

function clearTimers(s: PlaybackState): void {
  if (s.endTimer) clearTimeout(s.endTimer)
  if (s.lockTimer) clearTimeout(s.lockTimer)
  s.endTimer = null
  s.lockTimer = null
}

function rescheduleTimers(room: RoomRuntime): void {
  const s = st(room)
  clearTimers(s)
  const now = Date.now()
  const end = msUntilEnd(room.timeline, now)
  if (end === null) return
  const itemId = room.timeline.itemId
  s.endTimer = setTimeout(() => onTrackEnd(room, itemId), Math.max(0, end))
  const lock = msUntilLock(room.timeline, now, config.lockAheadMs)
  if (lock !== null) s.lockTimer = setTimeout(() => ensureLocked(room), Math.max(0, lock))
}

function inLockWindow(room: RoomRuntime, now: number): boolean {
  const lock = msUntilLock(room.timeline, now, config.lockAheadMs)
  return lock !== null && lock <= 0
}

export function setUpNext(room: RoomRuntime, id: string | null): void {
  room.upNextId = id
  st(room).upNextSince = id ? Date.now() : 0
  persistTimeline(room)
}

/** 从兜底歌单里随机取一首（避开最近 20 首播过的歌），检查可播放性 */
async function pickFallbackTrack(room: RoomRuntime): Promise<Track | null> {
  const pid = room.settings.fallbackPlaylistId
  if (!pid) return null
  const cookie = hostCookie(room)
  try {
    const tracks = [
      ...(await music.getPlaylistTracks(pid, 1, cookie)),
      ...(await music.getPlaylistTracks(pid, 2, cookie)),
    ]
    const recent = new Set(room.history.slice(0, config.fallbackAvoidRecent).map((h) => h.track.sourceId))
    if (room.current) recent.add(room.current.track.sourceId)
    let pool = tracks.filter((t) => !recent.has(t.sourceId))
    if (!pool.length) pool = tracks
    for (let i = 0; i < 3 && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      const t = pool.splice(idx, 1)[0]
      const p = await music.checkPlayability(t.sourceId, room.settings.audioLevel, cookie)
      if (p === 'full' || (p === 'trial' && room.settings.allowTrialTracks)) return { ...t, playability: p }
    }
  } catch (e) {
    logger.warn({ err: String(e), room: room.code }, 'fallback playlist failed')
  }
  return null
}

function insertFallbackItem(room: RoomRuntime, track: Track): QueueItem {
  const item: QueueItem = {
    id: newId(),
    track,
    addedBy: [],
    firstAddedAt: Date.now(),
    votes: new Map(),
    pinnedAt: null,
  }
  room.queue.set(item.id, item)
  roomsRepo.insertItem(item.id, room.id, track, item.firstAddedAt)
  return item
}

/** 队列为空时的兜底歌：没有人点过 */
export function isFallbackItem(item: QueueItem): boolean {
  return item.addedBy.length === 0
}

/** 在锁定窗口内且还没有下一首时，锁定此刻排第一的歌 */
export function ensureLocked(room: RoomRuntime): void {
  const now = Date.now()
  if (!inLockWindow(room, now)) return
  if (room.upNextId && room.queue.has(room.upNextId)) return
  const top = rankRoom(room, now)[0]
  if (top) {
    setUpNext(room, top.item.id)
    changed(room)
    return
  }
  if (!room.settings.fallbackPlaylistId) return
  const token = st(room).switchToken
  void pickFallbackTrack(room).then((t) => {
    if (!t || st(room).switchToken !== token || room.upNextId || !inLockWindow(room, Date.now())) return
    if (rankRoom(room).length) return ensureLocked(room)
    const item = insertFallbackItem(room, t)
    setUpNext(room, item.id)
    changed(room)
  })
}

/** 下一首被解除锁定（房主更换、删除或被撤回）后调用 */
export function unlockUpNext(room: RoomRuntime): void {
  if (!room.upNextId) return
  setUpNext(room, null)
  ensureLocked(room)
}

function pushHistory(room: RoomRuntime, item: QueueItem, reason: EndedReason, now: number): void {
  room.history.unshift({
    id: item.id,
    track: item.track,
    addedBy: item.addedBy,
    firstAddedAt: item.firstAddedAt,
    endedAt: now,
    reason,
  })
  if (room.history.length > MAX_HISTORY) {
    for (const old of room.history.splice(MAX_HISTORY)) roomsRepo.deleteItem(old.id)
  }
  roomsRepo.setItemState(item.id, 'played', reason, now)
}

function startItem(room: RoomRuntime, item: QueueItem, now: number): void {
  const s = st(room)
  const preloaded = room.upNextId === item.id && now - s.upNextSince >= config.bufferColdMs
  room.queue.delete(item.id)
  room.current = item
  room.upNextId = null
  s.upNextSince = 0
  const duration = item.track.durationMs > 0 ? item.track.durationMs : 4 * 60_000
  room.timeline = startTimeline(item.id, duration, now, preloaded ? config.bufferPreloadedMs : config.bufferColdMs)
  for (const l of room.listeners.values()) l.errorItemId = null
  roomsRepo.setItemState(item.id, 'playing', null, null)
  persistTimeline(room)
  rescheduleTimers(room)
}

function goIdle(room: RoomRuntime): void {
  room.current = null
  room.timeline = idleTimeline()
  clearTimers(st(room))
  persistTimeline(room)
}

/** 取下一首：优先已锁定的下一首，再取队列第一名 */
function pickNext(room: RoomRuntime, now: number): QueueItem | null {
  if (room.upNextId) {
    const it = room.queue.get(room.upNextId)
    if (it) return it
  }
  return rankRoom(room, now)[0]?.item ?? null
}

function announceNowPlaying(room: RoomRuntime, via: string | null): void {
  if (!room.current) return
  const label = trackLabel(room.current.track)
  const suffix = via ? `（${via}）` : ''
  chatService.system(room, 'nowPlaying', `正在播放：${label}${suffix}`, { title: room.current.track.title, via })
}

/**
 * "切换中"：结束当前歌（写入历史），选下一首并开始播放。
 * via 用于系统消息，例如"投票切歌""房主切歌"。
 */
export function advance(room: RoomRuntime, reason: EndedReason, via: string | null = null): void {
  const s = st(room)
  const now = Date.now()
  s.switchToken++
  room.playVotes = emptyPlayVotes()
  if (s.noListenerTimer) {
    clearTimeout(s.noListenerTimer)
    s.noListenerTimer = null
  }
  tx(() => {
    if (room.current) pushHistory(room, room.current, reason, now)
    room.current = null
    if (reason === 'error') {
      s.consecutiveErrors++
      if (s.consecutiveErrors >= config.maxConsecutiveErrors) {
        s.halted = true
        goIdle(room)
        return
      }
    } else {
      s.consecutiveErrors = 0
    }
    const next = pickNext(room, now)
    if (next) startItem(room, next, now)
    else goIdle(room)
  })
  if (s.halted) {
    bus.notice(room, 'hosts', 'warn', `连续 ${config.maxConsecutiveErrors} 首歌播放失败，已停止播放`)
    changed(room)
    return
  }
  if (room.current) {
    announceNowPlaying(room, via)
    if (!hasListener(room)) armNoListener(room)
    changed(room)
    return
  }
  changed(room)
  // 队列为空：尝试兜底歌单
  if (room.settings.fallbackPlaylistId && hasListener(room)) {
    const token = s.switchToken
    void pickFallbackTrack(room).then((t) => {
      if (!t || st(room).switchToken !== token || room.current) return
      const item = insertFallbackItem(room, t)
      tx(() => startItem(room, item, Date.now()))
      announceNowPlaying(room, '兜底歌单')
      changed(room)
    })
  }
}

function onTrackEnd(room: RoomRuntime, itemId: string | null): void {
  if (room.timeline.itemId !== itemId || room.timeline.state !== 'playing') return
  if (msUntilEnd(room.timeline, Date.now())! > 50) return rescheduleTimers(room)
  advance(room, 'finished')
}

/** 空闲且有歌可播、有设备出声时开始播放 */
export function maybeAutoStart(room: RoomRuntime): void {
  const s = st(room)
  if (room.timeline.state !== 'idle' || s.halted || !hasListener(room)) return
  if (room.queue.size === 0 && !room.settings.fallbackPlaylistId) return
  advance(room, 'finished')
}

/** 房主操作或有新歌入队时解除"连续出错停止" */
export function clearHalt(room: RoomRuntime): void {
  const s = st(room)
  s.halted = false
  s.consecutiveErrors = 0
}

function armNoListener(room: RoomRuntime): void {
  const s = st(room)
  if (s.noListenerTimer || room.timeline.state !== 'playing') return
  s.noListenerTimer = setTimeout(() => {
    s.noListenerTimer = null
    if (hasListener(room) || room.timeline.state !== 'playing') return
    room.timeline = pauseTimeline(room.timeline, Date.now(), 'noListener')
    persistTimeline(room)
    rescheduleTimers(room)
    changed(room)
  }, config.noListenerPauseMs)
}

/** 出声设备变化后调用 */
export function onListenersChanged(room: RoomRuntime): void {
  const s = st(room)
  if (hasListener(room)) {
    if (s.noListenerTimer) {
      clearTimeout(s.noListenerTimer)
      s.noListenerTimer = null
    }
    if (room.timeline.state === 'paused' && room.timeline.pausedBy === 'noListener') {
      room.timeline = resumeTimeline(room.timeline, Date.now())
      // 给设备留出加载时间
      room.timeline = { ...room.timeline, startedAt: room.timeline.startedAt + config.bufferColdMs }
      persistTimeline(room)
      rescheduleTimers(room)
    }
    maybeAutoStart(room)
  } else {
    armNoListener(room)
  }
  changed(room)
}

/** 所有正在出声的设备都对同一首歌报错时，以 error 为原因切到下一首 */
export function onAudioError(room: RoomRuntime, socketId: string, itemId: string): void {
  const l = room.listeners.get(socketId)
  if (!l || room.timeline.itemId !== itemId) return
  l.errorItemId = itemId
  const active = [...room.listeners.values()].filter((x) => x.listening)
  if (active.length && active.every((x) => x.errorItemId === itemId)) {
    advance(room, 'error')
  } else {
    changed(room)
  }
}

// ---------- 暂停、继续、切歌、上一曲 ----------

function doPause(room: RoomRuntime, by: 'host' | 'vote'): void {
  if (room.timeline.state !== 'playing') return
  const s = st(room)
  room.timeline = pauseTimeline(room.timeline, Date.now(), by)
  room.playVotes.pause.clear()
  room.playVotes.resume.clear()
  s.lastToggle = { kind: 'pause', at: Date.now() }
  persistTimeline(room)
  rescheduleTimers(room)
  chatService.system(room, 'pause', by === 'host' ? '房主暂停了播放' : '投票通过，已暂停', { by })
  changed(room)
}

function doResume(room: RoomRuntime, by: 'host' | 'vote'): void {
  if (room.timeline.state !== 'paused') return
  const s = st(room)
  room.timeline = resumeTimeline(room.timeline, Date.now())
  room.playVotes.pause.clear()
  room.playVotes.resume.clear()
  s.lastToggle = { kind: 'resume', at: Date.now() }
  persistTimeline(room)
  rescheduleTimers(room)
  if (!hasListener(room)) armNoListener(room)
  chatService.system(room, 'resume', by === 'host' ? '房主继续了播放' : '投票通过，继续播放', { by })
  changed(room)
}

/** 重播历史里最近一首不是因出错而结束的歌；正在播的歌放回队列并锁定为下一首 */
function doPrev(room: RoomRuntime, by: 'host' | 'vote'): void {
  const idx = findReplayable(room.history)
  if (idx < 0) throw new AppError('NO_HISTORY')
  const s = st(room)
  const now = Date.now()
  const h = room.history.splice(idx, 1)[0]
  s.switchToken++
  room.playVotes = emptyPlayVotes()
  const prevItem: QueueItem = {
    id: h.id,
    track: h.track,
    addedBy: h.addedBy,
    firstAddedAt: h.firstAddedAt,
    votes: new Map(),
    pinnedAt: null,
  }
  tx(() => {
    const interrupted = room.current
    room.current = null
    if (interrupted) {
      room.queue.set(interrupted.id, interrupted)
      roomsRepo.setItemState(interrupted.id, 'queued', null, null)
    }
    startItem(room, prevItem, now)
    if (interrupted) setUpNext(room, interrupted.id)
  })
  s.consecutiveErrors = 0
  chatService.system(
    room,
    'prev',
    `${by === 'host' ? '房主' : '投票通过，'}重播上一首：${trackLabel(prevItem.track)}`,
    { by, title: prevItem.track.title },
  )
  if (!hasListener(room)) armNoListener(room)
  changed(room)
}

function execute(room: RoomRuntime, kind: PlayVoteKind, by: 'host' | 'vote'): void {
  switch (kind) {
    case 'pause':
      return doPause(room, by)
    case 'resume':
      return doResume(room, by)
    case 'skip':
      return advance(room, 'skipped', by === 'host' ? '房主切歌' : '投票切歌')
    case 'prev':
      return doPrev(room, by)
  }
}

/** 在场人数变化后重新判断阈值 */
export function evaluateVotes(room: RoomRuntime): void {
  const p = presence(room)
  const hasHistory = findReplayable(room.history) >= 0
  for (const kind of ['skip', 'prev', 'pause', 'resume'] as const) {
    const voters = room.playVotes[kind]
    if (!voters.size) continue
    if (!voteOpen(kind, room.timeline, hasHistory)) continue
    if (votePasses(voters, p.ids, room.settings.voteMode, p.count)) {
      execute(room, kind, 'vote')
      return
    }
  }
}

export const playbackService = {
  /** 成员投票；房主不投票，直接执行 */
  vote(room: RoomRuntime, userId: string, kind: PlayVoteKind, itemId: string, on: boolean): { passed: boolean } {
    const m = room.members.get(userId)
    if (!m || m.left) throw new AppError('FORBIDDEN', 403)
    if (room.timeline.itemId !== itemId) return { passed: false } // 过期的投票直接忽略
    const voters = room.playVotes[kind]
    if (!on) {
      voters.delete(userId)
      changed(room)
      return { passed: false }
    }
    if (m.isHost) throw new AppError('FORBIDDEN', 403, '房主请直接操作')
    const now = Date.now()
    const s = st(room)
    if (!voteOpen(kind, room.timeline, findReplayable(room.history) >= 0)) throw new AppError('VOTE_NOT_OPEN')
    if (reverseCooldownBlocks(kind, s.lastToggle, now, config.reverseVoteCooldownMs)) {
      throw new AppError('VOTE_COOLDOWN')
    }
    const p = presence(room, now)
    const anyone = room.settings.voteMode === 'anyone'
    if (anyone) {
      const last = s.anyoneCooldown.get(userId)
      if (last !== undefined && now - last < config.anyoneCooldownMs) throw new AppError('VOTE_COOLDOWN')
    }
    voters.add(userId)
    if (votePasses(voters, p.ids, room.settings.voteMode, p.count)) {
      if (anyone) s.anyoneCooldown.set(userId, now)
      execute(room, kind, 'vote')
      return { passed: true }
    }
    changed(room)
    return { passed: false }
  },

  host(room: RoomRuntime, action: 'pause' | 'resume' | 'next' | 'prev' | 'seek', positionMs?: number): void {
    switch (action) {
      case 'pause':
        if (room.timeline.state !== 'playing') throw new AppError('VOTE_NOT_OPEN')
        return doPause(room, 'host')
      case 'resume':
        if (room.timeline.state !== 'paused') throw new AppError('VOTE_NOT_OPEN')
        return doResume(room, 'host')
      case 'next':
        clearHalt(room)
        if (room.timeline.state === 'idle') {
          if (!hasListener(room)) throw new AppError('VOTE_NOT_OPEN', 400, '没有设备在出声')
          return advance(room, 'finished')
        }
        return advance(room, 'skipped', '房主切歌')
      case 'prev':
        clearHalt(room)
        return doPrev(room, 'host')
      case 'seek': {
        if (room.timeline.state === 'idle' || positionMs === undefined) throw new AppError('VOTE_NOT_OPEN')
        room.timeline = seekTimeline(room.timeline, Date.now(), positionMs)
        persistTimeline(room)
        rescheduleTimers(room)
        changed(room)
        return
      }
    }
  },

  position(room: RoomRuntime): number {
    return positionAt(room.timeline, Date.now())
  },

  disposeRoom(room: RoomRuntime): void {
    const s = states.get(room.id)
    if (!s) return
    clearTimers(s)
    if (s.noListenerTimer) clearTimeout(s.noListenerTimer)
    s.switchToken++
    states.delete(room.id)
  },

  /** 启动恢复后为所有房间设置计时器 */
  restore(room: RoomRuntime): void {
    rescheduleTimers(room)
  },

  lastToggle(room: RoomRuntime) {
    return st(room).lastToggle
  },
}

export { changed as markChanged }
