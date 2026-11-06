import { describe, expect, it } from 'vitest'
import { SYNC_POLICY, decideSync } from '../src/player/syncPolicy.ts'

const ctx = (
  over: Partial<{ sinceSeekMs: number; buffering: boolean; pitchPreserved: boolean }> = {},
) => ({
  sinceSeekMs: Number.POSITIVE_INFINITY,
  buffering: false,
  pitchPreserved: true,
  ...over,
})

describe('decideSync', () => {
  it('不漂移时保持原速、不跳转', () => {
    expect(decideSync(0, ctx())).toEqual({ rate: 1, seek: false })
    expect(decideSync(0.05, ctx())).toEqual({ rate: 1, seek: false })
  })

  it('小偏差只做小幅调速，不做硬跳', () => {
    const behind = decideSync(-0.6, ctx())
    expect(behind.seek).toBe(false)
    expect(behind.rate).toBeGreaterThan(1)
    expect(behind.rate).toBeLessThanOrEqual(1 + SYNC_POLICY.maxRateDelta)

    const ahead = decideSync(0.6, ctx())
    expect(ahead.seek).toBe(false)
    expect(ahead.rate).toBeLessThan(1)
    expect(ahead.rate).toBeGreaterThanOrEqual(1 - SYNC_POLICY.maxRateDelta)
  })

  it('调速幅度随偏差增大但不超过上限', () => {
    const small = decideSync(-0.2, ctx()).rate
    const large = decideSync(-2.5, ctx()).rate
    expect(large).toBeGreaterThan(small)
    expect(large).toBeLessThanOrEqual(1 + SYNC_POLICY.maxRateDelta)
  })

  it('不支持变调保护时绝不改速度，宁可等大偏差再跳', () => {
    expect(decideSync(-1.2, ctx({ pitchPreserved: false }))).toEqual({ rate: 1, seek: false })
  })

  it('缓冲中不改速也不硬跳，避免跳转后重新缓冲的死循环', () => {
    expect(decideSync(-5, ctx({ buffering: true }))).toEqual({ rate: 1, seek: false })
    expect(decideSync(-7.9, ctx({ buffering: true }))).toEqual({ rate: 1, seek: false })
  })

  it('冷却期内即使偏差较大也不硬跳，但可以小幅调速', () => {
    const r = decideSync(-5, ctx({ sinceSeekMs: SYNC_POLICY.seekCooldownMs - 1 }))
    expect(r.seek).toBe(false)
    expect(r.rate).toBeGreaterThan(1)
  })

  it('冷却结束且偏差较大时硬跳', () => {
    expect(decideSync(-5, ctx({ sinceSeekMs: SYNC_POLICY.seekCooldownMs + 1 }))).toEqual({
      rate: 1,
      seek: true,
    })
  })

  it('真正的跳变（切歌、拖进度）立即硬跳，即使刚跳过', () => {
    expect(decideSync(-30, ctx({ sinceSeekMs: 100 })).seek).toBe(true)
    expect(decideSync(12, ctx({ sinceSeekMs: 100 })).seek).toBe(true)
  })

  it('非法数值按不漂移处理', () => {
    expect(decideSync(Number.NaN, ctx())).toEqual({ rate: 1, seek: false })
  })
})
