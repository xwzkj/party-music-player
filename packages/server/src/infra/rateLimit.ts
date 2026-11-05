/** 内存中的滑动窗口限流器，按 key 计数 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>()
  private readonly limit: number
  private readonly windowMs: number

  constructor(limit: number, windowMs: number) {
    this.limit = limit
    this.windowMs = windowMs
  }

  /** 记一次并返回是否允许 */
  take(key: string, now = Date.now()): boolean {
    const arr = this.prune(key, now)
    if (arr.length >= this.limit) return false
    arr.push(now)
    return true
  }

  /** 只检查不计数 */
  check(key: string, now = Date.now()): boolean {
    return this.prune(key, now).length < this.limit
  }

  /** 只计数不检查（例如记录失败次数） */
  hit(key: string, now = Date.now()): number {
    const arr = this.prune(key, now)
    arr.push(now)
    return arr.length
  }

  count(key: string, now = Date.now()): number {
    return this.prune(key, now).length
  }

  reset(key: string): void {
    this.hits.delete(key)
  }

  private prune(key: string, now: number): number[] {
    let arr = this.hits.get(key)
    if (!arr) {
      arr = []
      this.hits.set(key, arr)
    }
    const cutoff = now - this.windowMs
    while (arr.length && arr[0] <= cutoff) arr.shift()
    return arr
  }

  /** 定期清理空 key，防止内存增长 */
  sweep(now = Date.now()): void {
    for (const key of this.hits.keys()) {
      if (this.prune(key, now).length === 0) this.hits.delete(key)
    }
  }
}

const allLimiters: SlidingWindowLimiter[] = []
export function limiter(limit: number, windowMs: number): SlidingWindowLimiter {
  const l = new SlidingWindowLimiter(limit, windowMs)
  allLimiters.push(l)
  return l
}

setInterval(() => {
  const now = Date.now()
  for (const l of allLimiters) l.sweep(now)
}, 5 * 60 * 1000).unref()
