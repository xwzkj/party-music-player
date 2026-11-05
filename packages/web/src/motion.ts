/** MD3 动效：缓动曲线和用 requestAnimationFrame 驱动的补间 */

/** 生成 cubic-bezier 缓动函数（与 CSS cubic-bezier 相同） */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  // 牛顿迭代求 x(t) = x 的 t，失败时退回二分法
  function solve(x: number): number {
    let t = x
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x
      if (Math.abs(err) < 1e-5) return t
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= err / d
    }
    let lo = 0
    let hi = 1
    t = x
    while (lo < hi) {
      const v = sx(t)
      if (Math.abs(v - x) < 1e-5) return t
      if (x > v) lo = t
      else hi = t
      t = (lo + hi) / 2
      if (hi - lo < 1e-6) break
    }
    return t
  }
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)))
}

export const easing = {
  emphasized: cubicBezier(0.2, 0, 0, 1),
  emphasizedDecelerate: cubicBezier(0.05, 0.7, 0.1, 1),
  standard: cubicBezier(0.2, 0, 0, 1),
}

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 补间动画；返回取消函数 */
export function tween(
  durationMs: number,
  ease: (t: number) => number,
  onFrame: (p: number) => void,
): () => void {
  if (reducedMotion()) {
    onFrame(1)
    return () => {}
  }
  let raf = 0
  const start = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / durationMs)
    onFrame(ease(t))
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}
