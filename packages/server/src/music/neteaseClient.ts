import { createRequire } from 'node:module'
import type { ArtistSummary, AudioLevel, PlaylistSummary, RawLyrics, Track } from '@pmp/shared'
import { AppError } from '@pmp/shared'
import { logger } from '../infra/logger.ts'
import {
  PLAYLIST_PAGE_SIZE,
  SEARCH_PAGE_SIZE,
  type MusicProvider,
  type NeteaseAccount,
  type PlayUrlResult,
  type QrCheckResult,
} from './provider.ts'

// 只声明用到的接口；第三方库的返回体按 unknown 处理，在这里转成项目自己的类型
type Params = Record<string, unknown> & { cookie?: string }
type ApiFn = (p: Params) => Promise<{ status: number; body: any; cookie?: string[] }>
interface NcmApi {
  cloudsearch: ApiFn
  artist_top_song: ApiFn
  song_detail: ApiFn
  song_url_v1: ApiFn
  lyric_new: ApiFn
  user_playlist: ApiFn
  playlist_track_all: ApiFn
  login_qr_key: ApiFn
  login_qr_create: ApiFn
  login_qr_check: ApiFn
  captcha_sent: ApiFn
  login_cellphone: ApiFn
  user_account: ApiFn
}

let api: NcmApi | null = null
function ncm(): NcmApi {
  if (!api) {
    const require = createRequire(import.meta.url)
    api = require('@neteasecloudmusicapienhanced/api') as NcmApi
  }
  return api
}

/** 对网易云的并发请求最多 5 个 */
class Semaphore {
  private active = 0
  private readonly waiters: (() => void)[] = []
  private readonly max: number
  constructor(max: number) {
    this.max = max
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r))
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.waiters.shift()?.()
    }
  }
}
const sem = new Semaphore(5)

async function call(name: keyof NcmApi, params: Params): Promise<any> {
  return sem.run(async () => {
    try {
      const res = await ncm()[name]({ ...params, timestamp: Date.now() })
      return res.body
    } catch (e: any) {
      // 库在 code 非 200 时直接 reject，带上 body
      if (e && typeof e === 'object' && 'body' in e) return e.body
      logger.warn({ err: String(e), api: name }, 'netease call failed')
      throw new AppError('NETEASE_ERROR', 502)
    }
  })
}

function httpsUrl(u: string | undefined | null): string {
  if (!u) return ''
  return u.replace(/^http:\/\//, 'https://')
}

/** 网易云失败时的提示文字在 msg 或 message 里 */
function failureMessage(body: any, fallback: string): string {
  const m = body?.message ?? body?.msg
  return typeof m === 'string' && m.trim() ? m.trim() : fallback
}

function toTrack(s: any): Track {
  const artists = (s.ar ?? s.artists ?? []).map((a: any) => String(a.name ?? ''))
  const album = s.al ?? s.album ?? {}
  return {
    source: 'netease',
    sourceId: String(s.id),
    title: String(s.name ?? ''),
    artists,
    album: String(album.name ?? ''),
    coverUrl: httpsUrl(album.picUrl),
    durationMs: Number(s.dt ?? s.duration ?? 0),
    popularity: typeof s.pop === 'number' ? s.pop : null,
    playability: 'full',
  }
}

function toPlaylist(p: any): PlaylistSummary {
  return {
    id: String(p.id),
    name: String(p.name ?? ''),
    coverUrl: httpsUrl(p.coverImgUrl ?? p.picUrl),
    trackCount: Number(p.trackCount ?? 0),
    creator: String(p.creator?.nickname ?? ''),
  }
}

function toArtist(a: any): ArtistSummary {
  const alias = [...(a.alias ?? []), ...(a.trans ? [a.trans] : [])].map(String).filter(Boolean)
  return {
    id: String(a.id),
    name: String(a.name ?? ''),
    avatarUrl: httpsUrl(a.img1v1Url ?? a.picUrl),
    alias: [...new Set(alias)].join(' / '),
  }
}

export class NeteaseClient implements MusicProvider {
  async searchTracks(keyword: string, page: number): Promise<Track[]> {
    const body = await call('cloudsearch', {
      keywords: keyword,
      type: 1,
      limit: SEARCH_PAGE_SIZE,
      offset: (page - 1) * SEARCH_PAGE_SIZE,
    })
    return (body?.result?.songs ?? []).map(toTrack)
  }

  async searchPlaylists(keyword: string, page: number): Promise<PlaylistSummary[]> {
    const body = await call('cloudsearch', {
      keywords: keyword,
      type: 1000,
      limit: SEARCH_PAGE_SIZE,
      offset: (page - 1) * SEARCH_PAGE_SIZE,
    })
    return (body?.result?.playlists ?? []).map(toPlaylist)
  }

  async searchArtists(keyword: string, page: number): Promise<ArtistSummary[]> {
    const body = await call('cloudsearch', {
      keywords: keyword,
      type: 100,
      limit: SEARCH_PAGE_SIZE,
      offset: (page - 1) * SEARCH_PAGE_SIZE,
    })
    return (body?.result?.artists ?? []).map(toArtist)
  }

  async getArtistTopTracks(id: string): Promise<Track[]> {
    const body = await call('artist_top_song', { id })
    return (body?.songs ?? []).map(toTrack)
  }

  async getTracks(ids: string[]): Promise<Track[]> {
    if (!ids.length) return []
    const body = await call('song_detail', { ids: ids.join(',') })
    return (body?.songs ?? []).map(toTrack)
  }

  async getPlayUrl(id: string, level: AudioLevel, cookie?: string): Promise<PlayUrlResult> {
    const body = await call('song_url_v1', { id, level, cookie })
    const d = body?.data?.[0]
    const now = Date.now()
    if (!d || !d.url) return { url: null, trialOnly: false, expiresAt: now }
    // freeTrialInfo 不为空表示只返回了试听片段
    const trialOnly = !!d.freeTrialInfo
    const expiSec = typeof d.expi === 'number' && d.expi > 0 ? d.expi : 1200
    return { url: httpsUrl(d.url), trialOnly, expiresAt: now + expiSec * 1000 }
  }

  async getLyrics(id: string): Promise<RawLyrics> {
    const body = await call('lyric_new', { id })
    return {
      lrc: body?.lrc?.lyric ?? null,
      yrc: body?.yrc?.lyric ?? null,
      tlyric: body?.tlyric?.lyric ?? null,
    }
  }

  async getUserPlaylists(cookie: string, uid: string): Promise<PlaylistSummary[]> {
    const body = await call('user_playlist', { uid, limit: 100, offset: 0, cookie })
    return (body?.playlist ?? []).map(toPlaylist)
  }

  async getPlaylistTracks(id: string, page: number, cookie?: string): Promise<Track[]> {
    const body = await call('playlist_track_all', {
      id,
      limit: PLAYLIST_PAGE_SIZE,
      offset: (page - 1) * PLAYLIST_PAGE_SIZE,
      cookie,
    })
    return (body?.songs ?? []).map(toTrack)
  }

  async createLoginQr(): Promise<{ key: string; qrImage: string }> {
    const k = await call('login_qr_key', {})
    const key = String(k?.data?.unikey ?? '')
    if (!key) throw new AppError('NETEASE_ERROR', 502)
    const q = await call('login_qr_create', { key, qrimg: true })
    return { key, qrImage: String(q?.data?.qrimg ?? '') }
  }

  async checkLoginQr(key: string): Promise<QrCheckResult> {
    const body = await call('login_qr_check', { key })
    switch (body?.code) {
      case 800:
        return { status: 'expired' }
      case 801:
        return { status: 'waiting' }
      case 802:
        return { status: 'confirming' }
      case 803:
        return { status: 'success', cookie: String(body.cookie ?? '') }
      default:
        return { status: 'expired' }
    }
  }

  async getAccount(cookie: string): Promise<NeteaseAccount> {
    const body = await call('user_account', { cookie })
    const p = body?.profile
    if (!p) throw new AppError('NETEASE_ERROR', 502, '网易云登录状态无效')
    return { uid: String(p.userId), nickname: String(p.nickname ?? ''), vipType: Number(p.vipType ?? 0) }
  }

  /** 给手机号发登录验证码 */
  async sendLoginCaptcha(phone: string): Promise<void> {
    const body = await call('captcha_sent', { phone })
    if (body?.code !== 200) throw new AppError('NETEASE_ERROR', 400, failureMessage(body, '验证码发送失败'))
  }

  /** 手机号 + 短信验证码登录，返回网易云的 Cookie 串 */
  async loginByPhone(phone: string, captcha: string): Promise<string> {
    const body = await call('login_cellphone', { phone, captcha })
    const cookie = typeof body?.cookie === 'string' ? body.cookie : ''
    if (body?.code === 200 && cookie) return cookie
    throw new AppError('NETEASE_ERROR', 400, failureMessage(body, '绑定失败，请检查手机号和验证码'))
  }
}
