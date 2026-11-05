import type { EndedReason, PlayVoteKind, RoomSettings, Timeline, Track, Weights } from '@pmp/shared'

export interface MemberRuntime {
  userId: string
  nickname: string
  isHost: boolean
  online: boolean
  lastSeenAt: number
  left: boolean
}

export interface QueueItem {
  id: string
  track: Track
  addedBy: string[]
  firstAddedAt: number
  votes: Map<string, 1 | -1>
  pinnedAt: number | null
}

export interface PlayedItem {
  id: string
  track: Track
  addedBy: string[]
  firstAddedAt: number
  endedAt: number
  reason: EndedReason
}

export interface ListenerState {
  userId: string
  listening: boolean
  errorItemId: string | null
}

export interface RoomRuntime {
  id: string
  code: string
  ownerId: string
  passcode: string
  settings: RoomSettings
  createdAt: number
  lastActiveAt: number
  members: Map<string, MemberRuntime>
  bans: Set<string>
  queue: Map<string, QueueItem>
  /** 正在播放（或暂停中）的歌，不在 queue 里 */
  current: QueueItem | null
  upNextId: string | null
  timeline: Timeline
  playVotes: Record<PlayVoteKind, Set<string>>
  listeners: Map<string, ListenerState>
  /** 最近的在前 */
  history: PlayedItem[]
  version: number
}

export function emptyPlayVotes(): Record<PlayVoteKind, Set<string>> {
  return { skip: new Set(), prev: new Set(), pause: new Set(), resume: new Set() }
}

export function idleTimeline(): Timeline {
  return { itemId: null, durationMs: 0, state: 'idle', startedAt: 0, pausedAtMs: 0, pausedBy: null }
}

export function defaultRoomSettings(weights: Weights, hostIsVip: boolean): RoomSettings {
  return {
    quotaPerMember: null,
    voteMode: 'half',
    weights: { ...weights },
    memberAudioDefault: false,
    allowTrialTracks: false,
    audioLevel: hostIsVip ? 'exhigh' : 'standard',
    fallbackPlaylistId: null,
  }
}

/** 配额只统计"自己点的、还在队列里待播"的歌 */
export function quotaUsed(room: RoomRuntime, userId: string): number {
  let n = 0
  for (const item of room.queue.values()) if (item.addedBy.includes(userId)) n++
  return n
}

export function findQueuedBySource(room: RoomRuntime, sourceId: string): QueueItem | undefined {
  for (const item of room.queue.values()) if (item.track.sourceId === sourceId) return item
  return undefined
}
