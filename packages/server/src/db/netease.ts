import { getDb } from './connection.ts'

export interface NeteaseAccountRow {
  user_id: string
  netease_uid: string
  netease_nickname: string
  vip_type: number
  cookie: string
  updated_at: number
}

export const neteaseRepo = {
  get(userId: string): NeteaseAccountRow | undefined {
    return getDb().prepare('SELECT * FROM netease_accounts WHERE user_id = ?').get(userId) as
      | NeteaseAccountRow
      | undefined
  },
  upsert(r: NeteaseAccountRow): void {
    getDb()
      .prepare(
        `INSERT INTO netease_accounts (user_id, netease_uid, netease_nickname, vip_type, cookie, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET netease_uid = excluded.netease_uid,
           netease_nickname = excluded.netease_nickname, vip_type = excluded.vip_type,
           cookie = excluded.cookie, updated_at = excluded.updated_at`,
      )
      .run(r.user_id, r.netease_uid, r.netease_nickname, r.vip_type, r.cookie, r.updated_at)
  },
  delete(userId: string): void {
    getDb().prepare('DELETE FROM netease_accounts WHERE user_id = ?').run(userId)
  },
}
