import type { EndedReason, RoomSettings, Timeline, Track } from '@pmp/shared'
import { getDb } from './connection.ts'

export interface RoomRow {
  id: string
  code: string
  owner_id: string
  passcode: string
  status: 'open' | 'closed'
  settings_json: string
  timeline_json: string
  up_next_id: string | null
  created_at: number
  last_active_at: number
}

export interface MemberRow {
  room_id: string
  user_id: string
  joined_at: number
  last_seen_at: number
  left: number
  nickname: string | null
  username: string
  role: string
}

export interface QueueRow {
  id: string
  room_id: string
  track_json: string
  first_added_at: number
  pinned_at: number | null
  state: 'queued' | 'playing' | 'played'
  ended_reason: EndedReason | null
  ended_at: number | null
}

export interface ChatRow {
  id: string
  room_id: string
  kind: 'user' | 'system'
  user_id: string | null
  content: string
  system_type: string | null
  payload_json: string | null
  created_at: number
  deleted: number
  nickname: string | null
}

const db = () => getDb()

export const roomsRepo = {
  insert(r: Omit<RoomRow, 'status' | 'up_next_id'>): void {
    db()
      .prepare(
        `INSERT INTO rooms (id, code, owner_id, passcode, status, settings_json, timeline_json, created_at, last_active_at)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      )
      .run(r.id, r.code, r.owner_id, r.passcode, r.settings_json, r.timeline_json, r.created_at, r.last_active_at)
  },
  listOpen(): RoomRow[] {
    return db().prepare("SELECT * FROM rooms WHERE status = 'open'").all() as unknown as RoomRow[]
  },
  codeInUse(code: string): boolean {
    return !!db().prepare("SELECT 1 FROM rooms WHERE code = ? AND status = 'open'").get(code)
  },
  setSettings(id: string, s: RoomSettings): void {
    db().prepare('UPDATE rooms SET settings_json = ? WHERE id = ?').run(JSON.stringify(s), id)
  },
  setTimeline(id: string, t: Timeline, upNextId: string | null): void {
    db().prepare('UPDATE rooms SET timeline_json = ?, up_next_id = ? WHERE id = ?').run(JSON.stringify(t), upNextId, id)
  },
  setPasscode(id: string, passcode: string): void {
    db().prepare('UPDATE rooms SET passcode = ? WHERE id = ?').run(passcode, id)
  },
  touch(id: string, at: number): void {
    db().prepare('UPDATE rooms SET last_active_at = ? WHERE id = ?').run(at, id)
  },
  /** 关闭：删除队列、投票、成员、禁入名单和聊天，rooms 保留一行 */
  close(id: string): void {
    const d = db()
    d.prepare('DELETE FROM queue_items WHERE room_id = ?').run(id)
    d.prepare('DELETE FROM room_members WHERE room_id = ?').run(id)
    d.prepare('DELETE FROM room_bans WHERE room_id = ?').run(id)
    d.prepare('DELETE FROM chat_messages WHERE room_id = ?').run(id)
    d.prepare("UPDATE rooms SET status = 'closed' WHERE id = ?").run(id)
  },
  deleteByOwner(ownerId: string): void {
    db().prepare('DELETE FROM rooms WHERE owner_id = ?').run(ownerId)
  },

  // 成员
  listMembers(roomId: string): MemberRow[] {
    return db()
      .prepare(
        `SELECT m.*, u.nickname, u.username, u.role FROM room_members m JOIN users u ON u.id = m.user_id
         WHERE m.room_id = ?`,
      )
      .all(roomId) as unknown as MemberRow[]
  },
  isMember(roomId: string, userId: string): boolean {
    return !!db().prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId)
  },
  upsertMember(roomId: string, userId: string, now: number): void {
    db()
      .prepare(
        `INSERT INTO room_members (room_id, user_id, joined_at, last_seen_at, left) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(room_id, user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at, left = 0`,
      )
      .run(roomId, userId, now, now)
  },
  setMemberLeft(roomId: string, userId: string, left: boolean, now: number): void {
    db()
      .prepare('UPDATE room_members SET left = ?, last_seen_at = ? WHERE room_id = ? AND user_id = ?')
      .run(left ? 1 : 0, now, roomId, userId)
  },
  touchMember(roomId: string, userId: string, now: number): void {
    db().prepare('UPDATE room_members SET last_seen_at = ? WHERE room_id = ? AND user_id = ?').run(now, roomId, userId)
  },
  deleteMember(roomId: string, userId: string): void {
    db().prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, userId)
  },

  // 禁入
  listBans(roomId: string): string[] {
    return (db().prepare('SELECT user_id FROM room_bans WHERE room_id = ?').all(roomId) as { user_id: string }[]).map(
      (r) => r.user_id,
    )
  },
  isBanned(roomId: string, userId: string): boolean {
    return !!db().prepare('SELECT 1 FROM room_bans WHERE room_id = ? AND user_id = ?').get(roomId, userId)
  },
  addBan(roomId: string, userId: string, now: number): void {
    db().prepare('INSERT OR IGNORE INTO room_bans (room_id, user_id, created_at) VALUES (?, ?, ?)').run(roomId, userId, now)
  },
  removeBan(roomId: string, userId: string): void {
    db().prepare('DELETE FROM room_bans WHERE room_id = ? AND user_id = ?').run(roomId, userId)
  },

  // 队列
  listItems(roomId: string): QueueRow[] {
    return db()
      .prepare("SELECT * FROM queue_items WHERE room_id = ? AND state IN ('queued', 'playing')")
      .all(roomId) as unknown as QueueRow[]
  },
  listHistory(roomId: string, limit: number): QueueRow[] {
    return db()
      .prepare("SELECT * FROM queue_items WHERE room_id = ? AND state = 'played' ORDER BY ended_at DESC LIMIT ?")
      .all(roomId, limit) as unknown as QueueRow[]
  },
  listAdds(roomId: string): { item_id: string; user_id: string; added_at: number }[] {
    return db()
      .prepare(
        `SELECT a.* FROM queue_adds a JOIN queue_items q ON q.id = a.item_id WHERE q.room_id = ? ORDER BY a.added_at`,
      )
      .all(roomId) as unknown as { item_id: string; user_id: string; added_at: number }[]
  },
  listVotes(roomId: string): { item_id: string; user_id: string; value: 1 | -1 }[] {
    return db()
      .prepare(`SELECT v.* FROM votes v JOIN queue_items q ON q.id = v.item_id WHERE q.room_id = ?`)
      .all(roomId) as unknown as { item_id: string; user_id: string; value: 1 | -1 }[]
  },
  insertItem(id: string, roomId: string, track: Track, firstAddedAt: number): void {
    db()
      .prepare(
        "INSERT INTO queue_items (id, room_id, track_json, first_added_at, state) VALUES (?, ?, ?, ?, 'queued')",
      )
      .run(id, roomId, JSON.stringify(track), firstAddedAt)
  },
  updateTrack(id: string, track: Track): void {
    db().prepare('UPDATE queue_items SET track_json = ? WHERE id = ?').run(JSON.stringify(track), id)
  },
  deleteItem(id: string): void {
    db().prepare('DELETE FROM queue_items WHERE id = ?').run(id)
  },
  setItemState(id: string, state: QueueRow['state'], reason: EndedReason | null, endedAt: number | null): void {
    db()
      .prepare('UPDATE queue_items SET state = ?, ended_reason = ?, ended_at = ? WHERE id = ?')
      .run(state, reason, endedAt, id)
  },
  setPinned(id: string, pinnedAt: number | null): void {
    db().prepare('UPDATE queue_items SET pinned_at = ? WHERE id = ?').run(pinnedAt, id)
  },
  addAdd(itemId: string, userId: string, at: number): void {
    db().prepare('INSERT OR IGNORE INTO queue_adds (item_id, user_id, added_at) VALUES (?, ?, ?)').run(itemId, userId, at)
  },
  removeAdd(itemId: string, userId: string): void {
    db().prepare('DELETE FROM queue_adds WHERE item_id = ? AND user_id = ?').run(itemId, userId)
  },
  setVote(itemId: string, userId: string, value: 1 | -1): void {
    db()
      .prepare(
        'INSERT INTO votes (item_id, user_id, value) VALUES (?, ?, ?) ON CONFLICT(item_id, user_id) DO UPDATE SET value = excluded.value',
      )
      .run(itemId, userId, value)
  },
  deleteVote(itemId: string, userId: string): void {
    db().prepare('DELETE FROM votes WHERE item_id = ? AND user_id = ?').run(itemId, userId)
  },

  // 聊天
  insertChat(r: Omit<ChatRow, 'deleted' | 'nickname'>): void {
    db()
      .prepare(
        `INSERT INTO chat_messages (id, room_id, kind, user_id, content, system_type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.id, r.room_id, r.kind, r.user_id, r.content, r.system_type, r.payload_json, r.created_at)
  },
  listChat(roomId: string, before: number, limit: number): ChatRow[] {
    return db()
      .prepare(
        `SELECT c.*, u.nickname FROM chat_messages c LEFT JOIN users u ON u.id = c.user_id
         WHERE c.room_id = ? AND c.deleted = 0 AND c.created_at < ? ORDER BY c.created_at DESC LIMIT ?`,
      )
      .all(roomId, before, limit) as unknown as ChatRow[]
  },
  getChat(id: string): ChatRow | undefined {
    return db().prepare('SELECT *, NULL AS nickname FROM chat_messages WHERE id = ?').get(id) as ChatRow | undefined
  },
  deleteChat(id: string): void {
    db().prepare('UPDATE chat_messages SET deleted = 1 WHERE id = ?').run(id)
  },
}
