import { AppError, type PlaylistSummary, type QrStatus } from '@pmp/shared'
import { neteaseRepo } from '../db/netease.ts'
import type { UserRow } from '../db/users.ts'
import { logger } from '../infra/logger.ts'
import { music } from '../music/index.ts'
import { bus } from './bus.ts'
import { roomService } from './roomService.ts'
import { roomStore } from './roomStore.ts'

/** 二维码 key → 发起绑定的用户；只放内存 */
const pending = new Map<string, { userId: string; createdAt: number }>()
const QR_TTL = 5 * 60_000

export const neteaseService = {
  async createQr(user: UserRow, showOnHostCode?: string): Promise<{ key: string; qrImage: string }> {
    const qr = await music.createLoginQr()
    pending.set(qr.key, { userId: user.id, createdAt: Date.now() })
    if (showOnHostCode) {
      const room = roomStore.byCode(showOnHostCode)
      const m = room?.members.get(user.id)
      if (!room || !m || m.left) throw new AppError('FORBIDDEN', 403)
      bus.toHosts(room, 'netease:loginQr', { fromNickname: m.nickname, qrImage: qr.qrImage, key: qr.key })
    }
    return qr
  },

  async checkQr(user: UserRow, key: string): Promise<QrStatus> {
    const p = pending.get(key)
    if (!p || p.userId !== user.id || Date.now() - p.createdAt > QR_TTL) return { status: 'expired' }
    const r = await music.checkLoginQr(key)
    if (r.status === 'success' && r.cookie) {
      pending.delete(key)
      const account = await music.getAccount(r.cookie)
      neteaseRepo.upsert({
        user_id: user.id,
        netease_uid: account.uid,
        netease_nickname: account.nickname,
        vip_type: account.vipType,
        cookie: r.cookie,
        updated_at: Date.now(),
      })
      void roomService.recheckRoomsOf(user.id).catch((e) => logger.warn({ err: String(e) }, 'recheck failed'))
      return { status: 'success' }
    }
    if (r.status === 'expired') pending.delete(key)
    return { status: r.status }
  },

  me(user: UserRow): { bound: false } | { bound: true; nickname: string; uid: string; vip: boolean } {
    const a = neteaseRepo.get(user.id)
    if (!a) return { bound: false }
    return { bound: true, nickname: a.netease_nickname, uid: a.netease_uid, vip: a.vip_type > 0 }
  },

  async myPlaylists(user: UserRow): Promise<PlaylistSummary[]> {
    const a = neteaseRepo.get(user.id)
    if (!a) throw new AppError('NETEASE_NOT_BOUND')
    return music.getUserPlaylists(a.cookie, a.netease_uid)
  },

  unbind(user: UserRow): void {
    neteaseRepo.delete(user.id)
    void roomService.recheckRoomsOf(user.id).catch((e) => logger.warn({ err: String(e) }, 'recheck failed'))
  },

  cookieOf(userId: string): string | undefined {
    return neteaseRepo.get(userId)?.cookie
  },
}

setInterval(() => {
  const now = Date.now()
  for (const [k, v] of pending) if (now - v.createdAt > QR_TTL) pending.delete(k)
}, 60_000).unref()
