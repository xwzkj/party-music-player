export type VoteMode = 'anyone' | 'half' | 'all'
export type AudioLevel = 'standard' | 'exhigh' | 'lossless'
export type PlayVoteKind = 'skip' | 'prev' | 'pause' | 'resume'
export type Playability = 'full' | 'trial' | 'unavailable'
export type EndedReason = 'finished' | 'skipped' | 'removed' | 'error'
export type PausedBy = 'host' | 'vote' | 'noListener' | null
export type Role = 'admin' | 'user'

export interface Weights {
  vote: number
  adds: number
  order: number
  popularity: number
  duration: number
}

export interface RoomSettings {
  quotaPerMember: number | null
  voteMode: VoteMode
  weights: Weights
  memberAudioDefault: boolean
  allowTrialTracks: boolean
  audioLevel: AudioLevel
  fallbackPlaylistId: string | null
}

export interface Track {
  source: 'netease'
  sourceId: string
  title: string
  artists: string[]
  album: string
  coverUrl: string
  durationMs: number
  popularity: number | null
  playability: Playability
}

export interface PlaylistSummary {
  id: string
  name: string
  coverUrl: string
  trackCount: number
  creator: string
}

export interface ArtistSummary {
  id: string
  name: string
  avatarUrl: string
  /** 别名或译名，可能为空 */
  alias: string
}

export interface Timeline {
  itemId: string | null
  durationMs: number
  state: 'idle' | 'playing' | 'paused'
  startedAt: number
  pausedAtMs: number
  pausedBy: PausedBy
}

export interface ScoreBreakdown {
  total: number
  vote: number
  adds: number
  order: number
  popularity: number
  duration: number
}

export interface QueueItemView {
  id: string
  track: Track
  addedBy: { id: string; nickname: string }[]
  up: number
  down: number
  myVote: 1 | -1 | 0
  mine: boolean
  pinned: boolean
  score: ScoreBreakdown
}

/** 已经播过的歌（最近的在前） */
export interface PlayedItemView {
  id: string
  track: Track
  addedBy: { id: string; nickname: string }[]
  endedAt: number
  reason: EndedReason
}

export interface PlayVoteView {
  count: number
  needed: number
  mine: boolean
  open: boolean
}

export interface MemberView {
  id: string
  nickname: string
  isHost: boolean
  present: boolean
  listening: boolean
}

export interface RoomSnapshot {
  version: number
  serverNow: number
  room: { code: string; status: 'open' | 'closed'; settings: RoomSettings; ownerId: string }
  me: {
    userId: string
    isHost: boolean
    quotaUsed: number
    quotaLimit: number | null
    neteaseBound: boolean
    listeningDefault: boolean
  }
  timeline: Timeline
  nowPlaying: {
    item: QueueItemView
    votes: Record<PlayVoteKind, PlayVoteView>
  } | null
  hasHistory: boolean
  upNext: QueueItemView | null
  queue: QueueItemView[]
  history: PlayedItemView[]
  members: MemberView[]
  host?: {
    passcode: string
    votersByItem: Record<string, { up: string[]; down: string[] }>
    neteaseVip: boolean
    bans: { id: string; nickname: string }[]
  }
}

export interface ChatMessage {
  id: string
  kind: 'user' | 'system'
  userId: string | null
  nickname: string | null
  content: string
  systemType: string | null
  payload: Record<string, unknown> | null
  createdAt: number
}

export interface MeView {
  id: string
  username: string
  nickname: string | null
  email: string | null
  emailVerified: boolean
  role: Role
  canCreateRoom: boolean
  mustChangePassword: boolean
  canRenameOnce: boolean
}

export interface PublicConfig {
  emailVerificationEnabled: boolean
  turnstileEnabled: boolean
  turnstileSiteKey: string | null
}

export interface LyricWord {
  startMs: number
  durationMs: number
  text: string
}

export interface LyricLine {
  startMs: number
  endMs: number
  text: string
  words?: LyricWord[]
  translation?: string
}

export interface RawLyrics {
  lrc: string | null
  yrc: string | null
  tlyric: string | null
  /** 与 yrc 同源的逐行翻译（LRC 格式），时间戳和 yrc 对得上 */
  ytlrc?: string | null
}

export type QrStatus =
  | { status: 'expired' }
  | { status: 'waiting' }
  | { status: 'confirming' }
  | { status: 'success' }

/** 当前用户绑定网易云的状态 */
export type NeteaseBinding =
  | { bound: false }
  | { bound: true; nickname: string; uid: string; vip: boolean }

export type Ack<T = unknown> = { ok: true; data: T } | { ok: false; code: string; message?: string }
