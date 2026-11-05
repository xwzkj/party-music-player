import type { AudioLevel, PlaylistSummary, RawLyrics, Track } from '@pmp/shared'
import type { MusicProvider, NeteaseAccount, PlayUrlResult, QrCheckResult } from './provider.ts'

/**
 * 假的音乐源，用于开发和测试（MUSIC_PROVIDER=fake）。
 * 播放地址指向本站 /api/dev/tone/:id.wav，生成一段正弦波。
 * id 以 9 结尾的歌只能试听，以 8 结尾的歌无法播放。
 */
const NAMES = ['晴天', '夜曲', '稻香', '七里香', '青花瓷', '告白气球', '起风了', '平凡之路', '光年之外', '孤勇者']

function fakeTrack(id: number): Track {
  return {
    source: 'netease',
    sourceId: String(id),
    title: `${NAMES[id % NAMES.length]} #${id}`,
    artists: [`歌手${id % 7}`],
    album: `专辑${id % 5}`,
    coverUrl: '',
    durationMs: 30_000 + (id % 4) * 10_000,
    popularity: (id * 37) % 101,
    playability: 'full',
  }
}

export class FakeProvider implements MusicProvider {
  private qrPolls = new Map<string, number>()

  async searchTracks(keyword: string, page: number): Promise<Track[]> {
    const base = [...keyword].reduce((a, c) => a + c.charCodeAt(0), 0) % 1000
    return Array.from({ length: 10 }, (_, i) => fakeTrack(100000 + base * 100 + (page - 1) * 10 + i))
  }

  async searchPlaylists(keyword: string, page: number): Promise<PlaylistSummary[]> {
    return Array.from({ length: 3 }, (_, i) => ({
      id: String(900 + (page - 1) * 3 + i),
      name: `${keyword} 歌单 ${i + 1}`,
      coverUrl: '',
      trackCount: 20,
      creator: '测试用户',
    }))
  }

  async getTracks(ids: string[]): Promise<Track[]> {
    return ids.map((id) => fakeTrack(Number(id)))
  }

  async getPlayUrl(id: string, _level: AudioLevel, cookie?: string): Promise<PlayUrlResult> {
    const now = Date.now()
    if (id.endsWith('8')) return { url: null, trialOnly: false, expiresAt: now }
    const trialOnly = id.endsWith('9') && !cookie
    return { url: `/api/dev/tone/${id}.wav`, trialOnly, expiresAt: now + 20 * 60_000 }
  }

  async getLyrics(id: string): Promise<RawLyrics> {
    const t = fakeTrack(Number(id))
    const lines: string[] = []
    const yrc: string[] = []
    for (let s = 0; s * 5000 < t.durationMs; s++) {
      const ms = s * 5000
      const mm = String(Math.floor(ms / 60000)).padStart(2, '0')
      const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
      lines.push(`[${mm}:${ss}.00]第 ${s + 1} 句歌词`)
      const words = ['第', ' ', String(s + 1), ' ', '句', '歌', '词']
      yrc.push(`[${ms},4000]` + words.map((w, i) => `(${ms + i * 500},500,0)${w}`).join(''))
    }
    return {
      lrc: lines.join('\n'),
      yrc: yrc.join('\n'),
      tlyric: lines.map((l) => l.replace(/第 (\d+) 句歌词/, 'Line $1')).join('\n'),
    }
  }

  async getUserPlaylists(): Promise<PlaylistSummary[]> {
    return [{ id: '901', name: '我喜欢的音乐', coverUrl: '', trackCount: 20, creator: '测试用户' }]
  }

  async getPlaylistTracks(id: string, page: number): Promise<Track[]> {
    if (page > 1) return []
    return Array.from({ length: 20 }, (_, i) => fakeTrack(Number(id) * 100 + i))
  }

  async createLoginQr(): Promise<{ key: string; qrImage: string }> {
    const key = `fake-${Date.now()}`
    this.qrPolls.set(key, 0)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#eee"/><text x="80" y="85" text-anchor="middle" font-size="14">FAKE QR</text></svg>`
    return { key, qrImage: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` }
  }

  async checkLoginQr(key: string): Promise<QrCheckResult> {
    const n = (this.qrPolls.get(key) ?? 99) + 1
    this.qrPolls.set(key, n)
    if (n > 30) return { status: 'expired' }
    if (n < 2) return { status: 'waiting' }
    if (n < 3) return { status: 'confirming' }
    return { status: 'success', cookie: `MUSIC_U=fake_${key}` }
  }

  async getAccount(cookie: string): Promise<NeteaseAccount> {
    return { uid: cookie.slice(-6), nickname: '假网易云用户', vipType: 11 }
  }
}

/** 生成正弦波 WAV（8 kHz、8 位、单声道） */
export function toneWav(id: string, durationMs: number): Buffer {
  const rate = 8000
  const n = Math.floor((rate * durationMs) / 1000)
  const freq = 220 + (Number(id) % 12) * 40
  const buf = Buffer.alloc(44 + n)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate, 28)
  buf.writeUInt16LE(1, 32)
  buf.writeUInt16LE(8, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n, 40)
  for (let i = 0; i < n; i++) {
    // 每秒一次的音量包络，方便听出是否同步
    const env = 1 - ((i % rate) / rate) * 0.8
    buf[44 + i] = 128 + Math.round(60 * env * Math.sin((2 * Math.PI * freq * i) / rate))
  }
  return buf
}

export function fakeTrackDuration(id: string): number {
  return fakeTrack(Number(id)).durationMs
}
