import type { MeView, Role } from '@pmp/shared'
import { getDb } from './connection.ts'

export interface UserRow {
  id: string
  username: string
  password_hash: string
  email: string | null
  email_verified: number
  nickname: string | null
  role: Role
  can_create_room: number
  must_change_password: number
  can_rename_once: number
  token_version: number
  created_at: number
}

export const usersRepo = {
  count(): number {
    return (getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
  },
  byId(id: string): UserRow | undefined {
    return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  },
  byUsername(username: string): UserRow | undefined {
    return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
  },
  byVerifiedEmail(email: string): UserRow | undefined {
    return getDb()
      .prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND email_verified = 1')
      .get(email) as UserRow | undefined
  },
  insert(u: Omit<UserRow, 'token_version'> & { token_version?: number }): void {
    getDb()
      .prepare(
        `INSERT INTO users (id, username, password_hash, email, email_verified, nickname, role, can_create_room,
          must_change_password, can_rename_once, token_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        u.id,
        u.username,
        u.password_hash,
        u.email,
        u.email_verified,
        u.nickname,
        u.role,
        u.can_create_room,
        u.must_change_password,
        u.can_rename_once,
        u.token_version ?? 0,
        u.created_at,
      )
  },
  list(): UserRow[] {
    return getDb().prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as UserRow[]
  },
  setNickname(id: string, nickname: string): void {
    getDb().prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, id)
  },
  setPassword(id: string, hash: string): void {
    getDb()
      .prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?',
      )
      .run(hash, id)
  },
  /** 管理员重置：下次登录必须改密码 */
  adminResetPassword(id: string, hash: string): void {
    getDb()
      .prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?',
      )
      .run(hash, id)
  },
  setEmail(id: string, email: string | null, verified: boolean): void {
    getDb().prepare('UPDATE users SET email = ?, email_verified = ? WHERE id = ?').run(email, verified ? 1 : 0, id)
  },
  setUsername(id: string, username: string): void {
    getDb().prepare('UPDATE users SET username = ?, can_rename_once = 0 WHERE id = ?').run(username, id)
  },
  setCanCreateRoom(id: string, v: boolean): void {
    getDb().prepare('UPDATE users SET can_create_room = ? WHERE id = ?').run(v ? 1 : 0, id)
  },
  delete(id: string): void {
    getDb().prepare('DELETE FROM users WHERE id = ?').run(id)
  },
}

export function toMeView(u: UserRow): MeView {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    email: u.email,
    emailVerified: !!u.email_verified,
    role: u.role,
    canCreateRoom: u.role === 'admin' || !!u.can_create_room,
    mustChangePassword: !!u.must_change_password,
    canRenameOnce: !!u.can_rename_once,
  }
}
