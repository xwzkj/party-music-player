import { createHash } from 'node:crypto'
import { LRUCache } from 'lru-cache'
import type { AudioLevel, Playability, PlaylistSummary, RawLyrics, Track } from '@pmp/shared'
import { config } from '../config.ts'
import { FakeProvider } from './fakeProvider.ts'
import { NeteaseClient } from './neteaseClient.ts'
import type { MusicProvider, PlayUrlResult } from './provider.ts'

export type { MusicProvider, PlayUrlResult } from './provider.ts'

const MIN = 60_000

let provider: MusicProvider = config.musicProvider === 'fake' ? new FakeProvider() : new NeteaseClient()

/** 测试时注入假实现 */
export function setMusicProvider(p: MusicProvider): void {
  provider = p
  searchCache.clear()
  trackCache.clear()
  lyricCache.clear()
  playabilityCache.clear()
}

const searchCache = new LRUCache<string, Track[] | PlaylistSummary[]>({ max: 500, ttl: 5 * MIN })
const trackCache = new LRUCache<string, Track>({ max: 5000, ttl: 60 * MIN })
const lyricCache = new LRUCache<string, RawLyrics>({ max: 1000, ttl: 24 * 60 * MIN })
const playabilityCache = new LRUCache<string, Playability>({ max: 5000, ttl: config.playabilityCacheMs })

const hashCookie = (c: string | undefined): string =>
  c ? createHash('sha256').update(c).digest('hex').slice(0, 16) : 'anon'

export const music = {
  async searchTracks(q: string, page: number): Promise<Track[]> {
    const key = `t:${q}:${page}`
    const hit = searchCache.get(key) as Track[] | undefined
    if (hit) return hit
    const r = await provider.searchTracks(q, page)
    searchCache.set(key, r)
    return r
  },

  async searchPlaylists(q: string, page: number): Promise<PlaylistSummary[]> {
    const key = `p:${q}:${page}`
    const hit = searchCache.get(key) as PlaylistSummary[] | undefined
    if (hit) return hit
    const r = await provider.searchPlaylists(q, page)
    searchCache.set(key, r)
    return r
  },

  async getTrack(id: string): Promise<Track | null> {
    const hit = trackCache.get(id)
    if (hit) return hit
    const [t] = await provider.getTracks([id])
    if (!t) return null
    trackCache.set(id, t)
    return t
  },

  async getPlaylistTracks(id: string, page: number, cookie?: string): Promise<Track[]> {
    const key = `pl:${id}:${page}:${hashCookie(cookie)}`
    const hit = searchCache.get(key) as Track[] | undefined
    if (hit) return hit
    const r = await provider.getPlaylistTracks(id, page, cookie)
    for (const t of r) trackCache.set(t.sourceId, t)
    searchCache.set(key, r)
    return r
  },

  async getLyrics(id: string): Promise<RawLyrics> {
    const hit = lyricCache.get(id)
    if (hit) return hit
    const r = await provider.getLyrics(id)
    lyricCache.set(id, r)
    return r
  },

  getPlayUrl(id: string, level: AudioLevel, cookie?: string): Promise<PlayUrlResult> {
    return provider.getPlayUrl(id, level, cookie)
  },

  /** 用房主的 Cookie 实测可播放性，结果缓存 10 分钟 */
  async checkPlayability(id: string, level: AudioLevel, hostCookie: string | undefined): Promise<Playability> {
    const key = `${id}:${level}:${hashCookie(hostCookie)}`
    const hit = playabilityCache.get(key)
    if (hit) return hit
    const r = await provider.getPlayUrl(id, level, hostCookie)
    const p: Playability = !r.url ? 'unavailable' : r.trialOnly ? 'trial' : 'full'
    playabilityCache.set(key, p)
    return p
  },

  getUserPlaylists: (cookie: string, uid: string) => provider.getUserPlaylists(cookie, uid),
  createLoginQr: () => provider.createLoginQr(),
  checkLoginQr: (key: string) => provider.checkLoginQr(key),
  getAccount: (cookie: string) => provider.getAccount(cookie),
}

/** 从分享链接或纯数字里取出歌单 id */
export function parsePlaylistLink(link: string): string | null {
  const s = link.trim()
  if (/^\d{1,20}$/.test(s)) return s
  const m = /playlist(?:\/|\?id=|.*[?&]id=)(\d{1,20})/.exec(s)
  return m ? m[1] : null
}
