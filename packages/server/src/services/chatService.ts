import { AppError, type ChatMessage } from '@pmp/shared'
import { roomsRepo, type ChatRow } from '../db/rooms.ts'
import type { RoomRuntime } from '../domain/room.ts'
import { newId } from '../infra/ids.ts'
import { limiter } from '../infra/rateLimit.ts'
import { bus } from './bus.ts'

const perUser = limiter(5, 10_000)

// 去掉控制字符（保留普通空格）
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g

export function sanitizeChat(s: string): string {
  return s.replace(CONTROL, '').trim()
}

export function rowToMessage(r: ChatRow): ChatMessage {
  return {
    id: r.id,
    kind: r.kind,
    userId: r.user_id,
    nickname: r.nickname,
    content: r.content,
    systemType: r.system_type,
    payload: r.payload_json ? (JSON.parse(r.payload_json) as Record<string, unknown>) : null,
    createdAt: r.created_at,
  }
}

export const chatService = {
  send(room: RoomRuntime, userId: string, raw: string): ChatMessage {
    const member = room.members.get(userId)
    if (!member || member.left) throw new AppError('FORBIDDEN', 403)
    const content = sanitizeChat(raw)
    if (content.length < 1 || content.length > 200) throw new AppError('VALIDATION_FAILED', 400, '消息 1 到 200 字')
    if (!perUser.take(`${room.id}:${userId}`)) throw new AppError('CHAT_RATE_LIMITED', 429)
    const msg: ChatMessage = {
      id: newId(),
      kind: 'user',
      userId,
      nickname: member.nickname,
      content,
      systemType: null,
      payload: null,
      createdAt: Date.now(),
    }
    roomsRepo.insertChat({
      id: msg.id,
      room_id: room.id,
      kind: 'user',
      user_id: userId,
      content,
      system_type: null,
      payload_json: null,
      created_at: msg.createdAt,
    })
    bus.chat(room, msg)
    return msg
  },

  /** 系统消息：服务端生成文字，同时记录事件类型和参数 */
  system(room: RoomRuntime, type: string, content: string, payload: Record<string, unknown> = {}): void {
    const msg: ChatMessage = {
      id: newId(),
      kind: 'system',
      userId: null,
      nickname: null,
      content,
      systemType: type,
      payload,
      createdAt: Date.now(),
    }
    roomsRepo.insertChat({
      id: msg.id,
      room_id: room.id,
      kind: 'system',
      user_id: null,
      content,
      system_type: type,
      payload_json: JSON.stringify(payload),
      created_at: msg.createdAt,
    })
    bus.chat(room, msg)
  },

  history(room: RoomRuntime, before: number | undefined): ChatMessage[] {
    const rows = roomsRepo.listChat(room.id, before ?? Date.now() + 1, 50)
    return rows.reverse().map(rowToMessage)
  },

  delete(room: RoomRuntime, messageId: string): void {
    const row = roomsRepo.getChat(messageId)
    if (!row || row.room_id !== room.id || row.deleted) throw new AppError('NOT_FOUND', 404)
    if (row.kind === 'system') throw new AppError('FORBIDDEN', 403, '系统消息不能删除')
    roomsRepo.deleteChat(messageId)
    bus.chatDeleted(room, messageId)
  },
}

export function trackLabel(t: { title: string; artists: string[] }): string {
  return t.artists.length ? `${t.title} - ${t.artists.join(' / ')}` : t.title
}
