import type { Ack, ChatMessage, PlayVoteKind, RoomSettings, RoomSnapshot } from './types.ts'

type Cb<T = unknown> = (res: Ack<T>) => void

export interface ClientToServerEvents {
  'room:enter': (p: { code: string }, cb: Cb<{ version: number }>) => void
  'room:leave': (p: { code: string }, cb: Cb) => void
  'queue:add': (p: { sourceId: string }, cb: Cb<{ itemId: string }>) => void
  'queue:withdraw': (p: { itemId: string }, cb: Cb) => void
  'vote:set': (p: { itemId: string; vote: 1 | -1 | 0 }, cb: Cb) => void
  'play:vote': (p: { kind: PlayVoteKind; itemId: string; on: boolean }, cb: Cb<{ passed: boolean }>) => void
  'audio:listening': (p: { on: boolean }, cb: Cb) => void
  'audio:error': (p: { itemId: string }, cb: Cb) => void
  'time:ping': (p: { t0: number }, cb: Cb<{ t0: number; ts: number }>) => void
  'chat:send': (p: { content: string }, cb: Cb<ChatMessage>) => void
  'host:playback': (
    p: { action: 'pause' | 'resume' | 'next' | 'prev' | 'seek'; positionMs?: number },
    cb: Cb,
  ) => void
  'host:queue': (p: { action: 'remove' | 'pin' | 'unpin' | 'setNext'; itemId: string }, cb: Cb) => void
  'host:settings': (p: Partial<RoomSettings>, cb: Cb) => void
  'host:kick': (p: { userId: string; ban: boolean }, cb: Cb) => void
  'host:unban': (p: { userId: string }, cb: Cb) => void
  'host:chatDelete': (p: { messageId: string }, cb: Cb) => void
  'host:resetPasscode': (p: { passcode?: string }, cb: Cb<{ passcode: string }>) => void
  'host:close': (p: Record<string, never>, cb: Cb) => void
}

export interface ServerToClientEvents {
  'room:state': (s: RoomSnapshot) => void
  'room:notice': (n: { level: 'info' | 'warn'; text: string }) => void
  'room:closed': (p: { code: string }) => void
  'member:kicked': (p: { code: string; banned: boolean }) => void
  'chat:message': (m: ChatMessage) => void
  'chat:deleted': (p: { messageId: string }) => void
  'netease:loginQr': (p: { fromNickname: string; qrImage: string; key: string }) => void
}
