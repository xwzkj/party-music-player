import type { ChatMessage, ServerToClientEvents } from '@pmp/shared'
import type { RoomRuntime } from '../domain/room.ts'

/** 服务层向实时网关发消息的接口；由 realtime/gateway.ts 实现 */
export interface RoomBus {
  scheduleBroadcast(room: RoomRuntime): void
  notice(room: RoomRuntime, target: 'all' | 'hosts' | string[], level: 'info' | 'warn', text: string): void
  chat(room: RoomRuntime, msg: ChatMessage): void
  chatDeleted(room: RoomRuntime, messageId: string): void
  closed(room: RoomRuntime): void
  kicked(room: RoomRuntime, userId: string, banned: boolean): void
  toHosts<E extends keyof ServerToClientEvents>(
    room: RoomRuntime,
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void
}

const noop: RoomBus = {
  scheduleBroadcast() {},
  notice() {},
  chat() {},
  chatDeleted() {},
  closed() {},
  kicked() {},
  toHosts() {},
}

export let bus: RoomBus = noop

export function setBus(b: RoomBus): void {
  bus = b
}
