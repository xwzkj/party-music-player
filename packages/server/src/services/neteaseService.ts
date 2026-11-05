import { AppError, type NeteaseBinding, type PlaylistSummary, type QrStatus } from '@pmp/shared'
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

/** 拿到 Cookie 后保存账号，两种绑定方式共用 */
async function saveAccount(user: UserRow, cookie: string): Promise<void> {
  const account = await music.getAccount(cookie)
  neteaseRepo.upsert({
    user_id: user.id,
    netease_uid: account.uid,
    netease_nickname: account.nickname,
    vip_type: account.vipType,
    cookie,
    updated_at: Date.now(),
  })
  void roomService.recheckRoomsOf(user.id).catch((e) => logger.warn({ err: String(e) }, 'recheck failed'))
}

function bindingOf(user: UserRow): NeteaseBinding {
  const a = neteaseRepo.get(user.id)
  if (!a) return { bound: false }
  return { bound: true, nickname: a.netease_nickname, uid: a.netease_uid, vip: a.vip_type > 0 }
}

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
      await saveAccount(user, r.cookie)
      return { status: 'success' }
    }
    if (r.status === 'expired') pending.delete(key)
    return { status: r.status }
  },

  /** 给手机号发登录验证码（不落库，验证码只存在网易云那边） */
  sendLoginCaptcha(phone: string): Promise<void> {
    return music.sendLoginCaptcha(phone)
  },

  /** 手机号 + 验证码绑定，返回绑定后的状态 */
  async bindByPhone(user: UserRow, phone: string, captcha: string): Promise<NeteaseBinding> {
    const cookie = await music.loginByPhone(phone, captcha)
    await saveAccount(user, cookie)
    return bindingOf(user)
  },

  me(user: UserRow): NeteaseBinding {
    return bindingOf(user)
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
