import type { AudioLevel, PlaylistSummary, QrStatus, RawLyrics, Track } from '@pmp/shared'

export interface PlayUrlResult {
  url: string | null
  trialOnly: boolean
  expiresAt: number
}

export interface NeteaseAccount {
  uid: string
  nickname: string
  vipType: number
}

export interface QrCheckResult {
  status: QrStatus['status']
  cookie?: string
}

export interface MusicProvider {
  searchTracks(keyword: string, page: number): Promise<Track[]>
  searchPlaylists(keyword: string, page: number): Promise<PlaylistSummary[]>
  getTracks(ids: string[]): Promise<Track[]>
  getPlayUrl(id: string, level: AudioLevel, cookie?: string): Promise<PlayUrlResult>
  getLyrics(id: string): Promise<RawLyrics>
  getUserPlaylists(cookie: string, uid: string): Promise<PlaylistSummary[]>
  getPlaylistTracks(id: string, page: number, cookie?: string): Promise<Track[]>
  createLoginQr(): Promise<{ key: string; qrImage: string }>
  checkLoginQr(key: string): Promise<QrCheckResult>
  getAccount(cookie: string): Promise<NeteaseAccount>
}

export const PLAYLIST_PAGE_SIZE = 50
export const SEARCH_PAGE_SIZE = 30
