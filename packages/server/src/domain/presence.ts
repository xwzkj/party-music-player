import type { MemberRuntime } from './room.ts'

/** 在场：没有主动离开，并且当前在线或最近 graceMs 内有过连接 */
export function isPresent(m: MemberRuntime, now: number, graceMs: number): boolean {
  if (m.left) return false
  return m.online || now - m.lastSeenAt <= graceMs
}

export function presentIds(members: Iterable<MemberRuntime>, now: number, graceMs: number): Set<string> {
  const out = new Set<string>()
  for (const m of members) if (isPresent(m, now, graceMs)) out.add(m.userId)
  return out
}

/** 在场人数 P，最小取 1 */
export function presentCount(members: Iterable<MemberRuntime>, now: number, graceMs: number): number {
  return Math.max(1, presentIds(members, now, graceMs).size)
}

/**
 * 加入、离开系统消息的防刷屏：同一个人 60 秒内只记一条。
 * 返回 true 表示这次应该发消息，并记录时间。
 */
export class JoinLeaveDeduper {
  private readonly last = new Map<string, number>()
  private readonly windowMs: number
  constructor(windowMs: number) {
    this.windowMs = windowMs
  }
  shouldAnnounce(userId: string, now: number): boolean {
    const t = this.last.get(userId)
    if (t !== undefined && now - t < this.windowMs) return false
    this.last.set(userId, now)
    return true
  }
}
