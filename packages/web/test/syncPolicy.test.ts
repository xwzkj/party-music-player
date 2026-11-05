import { describe, expect, it } from 'vitest'
import { SYNC_POLICY, decideSync } from '../src/player/syncPolicy.ts'

const ctx = (over: Partial<{ sinceSeekMs: number; buffering: boolean }> = {}) => ({
  sinceSeekMs: Number.POSITIVE_INFINITY,
  buffering: false,
  ...over,
})

describe('decideSync', () => {
  it('不漂移时保持原速、不跳转', () => {
    expect(decideSync(0, ctx())).toEqual({ rate: 1, seek: false })
    expect(decideSync(0.05, ctx())).toEqual({ rate: 1, seek: false })
  })

  it('小漂移只用调速，不硬跳', () => {
    const behind = decideSync(-0.6, ctx())
    expect(behind.seek).toBe(false)
    expect(behind.rate).toBeGreaterThan(1)
    expect(behind.rate).toBeLessThanOrEqual(1 + SYNC_POLICY.maxRateDelta)

    const ahead = decideSync(0.6, ctx())
    expect(ahead.seek).toBe(false)
    expect(ahead.rate).toBeLessThan(1)
    expect(ahead.rate).toBeGreaterThanOrEqual(1 - SYNC_POLICY.maxRateDelta)
  })

  it('缓冲中绝不硬跳，避免跳转后重新缓冲的死循环', () => {
    expect(decideSync(-1.2, ctx({ buffering: true })).seek).toBe(false)
    expect(decideSync(-7.9, ctx({ buffering: true })).seek).toBe(false)
  })

  it('冷却期内不硬跳', () => {
    const r = decideSync(-5, ctx({ sinceSeekMs: SYNC_POLICY.seekCooldownMs - 1 }))
    expect(r.seek).toBe(false)
    expect(r.rate).toBeGreaterThan(1)
  })

  it('冷却结束且落后太多时硬跳', () => {
    const r = decideSync(-5, ctx({ sinceSeekMs: SYNC_POLICY.seekCooldownMs + 1 }))
    expect(r).toEqual({ rate: 1, seek: true })
  })

  it('真正的跳变（切歌、拖进度）立即硬跳，即使刚跳过', () => {
    expect(decideSync(-30, ctx({ sinceSeekMs: 100 })).seek).toBe(true)
    expect(decideSync(12, ctx({ sinceSeekMs: 100 })).seek).toBe(true)
  })

  it('调速幅度随漂移增大但不超过上限', () => {
    const small = decideSync(-0.2, ctx()).rate
    const large = decideSync(-3, ctx()).rate
    expect(large).toBeGreaterThan(small)
    expect(large).toBeLessThanOrEqual(1 + SYNC_POLICY.maxRateDelta)
  })

  it('非法数值按不漂移处理', () => {
    expect(decideSync(Number.NaN, ctx())).toEqual({ rate: 1, seek: false })
  })
})
