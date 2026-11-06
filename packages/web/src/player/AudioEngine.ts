import type { Timeline } from '@pmp/shared'
import { ApiError, post } from '../api/http'
import { serverNow } from '../realtime/socket'
import { decideSync } from './syncPolicy'

/** 一段极短的静音 WAV，用于在用户点击时解锁音频 */
const SILENT =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

/** 浏览器是否支持“变速不变调”；不支持就不调速，避免变调 */
const PRESERVES_PITCH =
  'preservesPitch' in HTMLMediaElement.prototype ||
  'mozPreservesPitch' in HTMLMediaElement.prototype ||
  'webkitPreservesPitch' in HTMLMediaElement.prototype

/** 有的内核在换 src 后会重置这个标记，加载前后都重新设一次 */
function keepPitch(el: HTMLAudioElement): void {
  el.preservesPitch = true
  ;(el as any).mozPreservesPitch = true
  ;(el as any).webkitPreservesPitch = true
}

interface Loaded {
  itemId: string
  url: string
  expiresAt: number
}

export interface EngineCallbacks {
  /** 这台设备无法播放这首歌（取不到地址或重试后仍出错） */
  onError(itemId: string): void
  onVia?(via: string): void
}

type WakeLockSentinelLike = { release(): Promise<void>; released: boolean }

/**
 * 按服务端时间轴播放：两个 audio 元素交替，一个播当前歌，一个预加载下一首。
 * 偏差小时用 ±3% 的速度慢慢追（preservesPitch 保证不变调），缓冲中不硬跳，
 * 硬跳后有冷却；不支持变调保护的浏览器完全不调速。
 */
export class AudioEngine {
  private readonly code: string
  private readonly cb: EngineCallbacks
  private els: [HTMLAudioElement, HTMLAudioElement]
  private active = 0
  private loaded: (Loaded | null)[] = [null, null]
  private timeline: Timeline | null = null
  private upNextId: string | null = null
  private listening = false
  private failed = new Set<string>()
  private retried = new Set<string>()
  private fetching = new Map<string, Promise<Loaded | null>>()
  private tickTimer: number
  private lastDriftCheck = 0
  /** 当前音频元素是否在等数据 */
  private buffering = false
  /** 上一次硬跳的时刻（performance.now） */
  private lastSeekAt = 0
  /** 这段时间内不做对齐检查，让刚开始的播放/跳转稳定下来 */
  private suppressUntil = 0
  /** 上一次看到的播放位置，用来判断缓冲是否已经结束 */
  private lastPosition = 0
  private wakeLock: WakeLockSentinelLike | null = null
  private volume = 0.8
  unlocked = false

  constructor(code: string, cb: EngineCallbacks) {
    this.code = code
    this.cb = cb
    this.els = [this.makeEl(0), this.makeEl(1)]
    this.tickTimer = window.setInterval(() => this.tick(), 200)
    document.addEventListener('visibilitychange', this.onVisible)
  }

  private makeEl(idx: number): HTMLAudioElement {
    const el = new Audio()
    el.preload = 'auto'
    keepPitch(el)
    el.addEventListener('error', () => this.onElError(idx))
    el.addEventListener('waiting', () => this.setBuffering(idx, true))
    el.addEventListener('stalled', () => this.setBuffering(idx, true))
    el.addEventListener('canplay', () => this.setBuffering(idx, false))
    el.addEventListener('playing', () => this.onPlaying(idx))
    el.addEventListener('seeked', () => {
      if (this.els[this.active] !== el) return
      this.suppressUntil = performance.now() + 800
    })
    return el
  }

  private setBuffering(idx: number, on: boolean): void {
    // 事件可能来自预加载的备用元素，只关心正在出声的那个
    if (this.els[this.active] !== this.els[idx]) return
    this.buffering = on
  }

  private onPlaying(idx: number): void {
    if (this.els[this.active] !== this.els[idx]) return
    this.buffering = false
    // 刚开始出声时给浏览器一点时间稳定，别立刻判定漂移
    this.suppressUntil = performance.now() + 1200
  }

  /** 必须在用户点击的回调里调用 */
  async unlock(): Promise<boolean> {
    for (const el of this.els) {
      // 静音片段本身没有声音，不设 muted：Chrome 会暂停后台标签页里静音的媒体
      el.src = SILENT
      try {
        await el.play()
        el.pause()
      } catch (e) {
        // 只有 NotAllowedError 表示被自动播放策略拦截；其他错误（如被打断）不影响解锁
        if ((e as DOMException)?.name === 'NotAllowedError') return false
      }
    }
    this.loaded = [null, null]
    this.unlocked = true
    return true
  }

  setVolume(v: number): void {
    this.volume = v
    for (const el of this.els) el.volume = v
  }

  setListening(on: boolean): void {
    this.listening = on
    if (!on) {
      for (const el of this.els) el.pause()
      void this.releaseWakeLock()
    } else {
      void this.requestWakeLock()
      this.sync(true)
    }
  }

  update(timeline: Timeline, upNextId: string | null): void {
    const prev = this.timeline
    const changedItem = prev?.itemId !== timeline.itemId
    const changedState = prev?.state !== timeline.state
    this.timeline = timeline
    this.upNextId = upNextId
    if (changedItem) {
      this.retried.clear()
      this.buffering = false
      this.suppressUntil = 0
      if (timeline.itemId) this.failed.delete(timeline.itemId)
    }
    // 只有换歌或播放/暂停切换才立刻重新对齐；普通快照（投票、成员变化）交给每秒的检查
    this.sync(changedItem || changedState)
  }

  destroy(): void {
    window.clearInterval(this.tickTimer)
    document.removeEventListener('visibilitychange', this.onVisible)
    for (const el of this.els) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    void this.releaseWakeLock()
  }

  // ---------- 内部 ----------

  private get cur(): HTMLAudioElement {
    return this.els[this.active]
  }

  private async fetchUrl(itemId: string): Promise<Loaded | null> {
    const pending = this.fetching.get(itemId)
    if (pending) return pending
    const p = (async () => {
      try {
        const r = await post<{ url: string; expiresAt: number; via: string }>(`/rooms/${this.code}/play-url`, { itemId })
        this.cb.onVia?.(r.via)
        return { itemId, url: r.url, expiresAt: r.expiresAt }
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'TRACK_UNAVAILABLE' || e.code === 'STALE_ITEM')) {
          if (e.code === 'TRACK_UNAVAILABLE') this.markFailed(itemId)
          return null
        }
        return null
      } finally {
        this.fetching.delete(itemId)
      }
    })()
    this.fetching.set(itemId, p)
    return p
  }

  private markFailed(itemId: string): void {
    if (this.failed.has(itemId)) return
    this.failed.add(itemId)
    if (this.timeline?.itemId === itemId) {
      this.cur.pause()
      this.cb.onError(itemId)
    }
  }

  private async load(slot: number, itemId: string): Promise<boolean> {
    const l = await this.fetchUrl(itemId)
    if (!l) return false
    // 等待期间状态可能变了
    if (this.timeline?.itemId !== itemId && this.upNextId !== itemId) return false
    this.loaded[slot] = l
    const el = this.els[slot]
    el.src = l.url
    keepPitch(el)
    el.volume = this.volume
    el.load()
    return true
  }

  private sync(force = false): void {
    const t = this.timeline
    if (!this.listening || !this.unlocked || !t || !t.itemId || t.state === 'idle') {
      for (const el of this.els) if (!el.paused) el.pause()
      return
    }
    const itemId = t.itemId
    if (this.failed.has(itemId)) {
      this.cur.pause()
      return
    }
    // 当前歌已经在备用元素里预加载过：切换
    if (this.loaded[this.active]?.itemId !== itemId) {
      const other = 1 - this.active
      if (this.loaded[other]?.itemId === itemId) {
        this.cur.pause()
        this.active = other
        this.buffering = false
      } else if (!this.fetching.has(itemId)) {
        this.cur.pause()
        void this.load(this.active, itemId).then((ok) => ok && this.sync(true))
        return
      } else {
        return
      }
    }
    this.preloadNext()
    this.align(force)
  }

  private preloadNext(): void {
    const next = this.upNextId
    if (!next || next === this.timeline?.itemId || this.failed.has(next)) return
    const other = 1 - this.active
    if (this.loaded[other]?.itemId === next || this.fetching.has(next)) return
    this.els[other].pause()
    void this.load(other, next)
  }

  private align(force: boolean): void {
    const t = this.timeline!
    const el = this.cur
    const now = serverNow()
    const expectedMs = t.state === 'playing' ? now - t.startedAt : t.pausedAtMs

    if (t.state === 'paused') {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime * 1000 - expectedMs) > 300) this.seek(el, expectedMs / 1000)
      return
    }
    // 还没到开始时刻：停在开头等待
    if (expectedMs < 0) {
      if (!el.paused) el.pause()
      if (el.currentTime > 0.05) this.seek(el, 0)
      return
    }
    // 音频提前结束就静音等待
    if (Number.isFinite(el.duration) && el.duration > 0 && expectedMs / 1000 >= el.duration - 0.05) {
      if (!el.paused) el.pause()
      return
    }
    if (el.paused) {
      this.seek(el, expectedMs / 1000)
      el.playbackRate = 1
      this.lastSeekAt = performance.now()
      this.suppressUntil = performance.now() + 1500
      el.play().catch(() => {
        /* 被浏览器拦截时，等待用户再点一次 */
      })
      return
    }
    const now2 = performance.now()
    if (!force && now2 - this.lastDriftCheck < 1000) return
    this.lastDriftCheck = now2
    // 刚开始播放或刚跳转过，先让缓冲稳定，避免把启动延迟误判成漂移
    if (now2 < this.suppressUntil) return
    // stalled 之后没有 playing 事件时，只要进度在走就当作缓冲结束
    if (this.buffering && el.currentTime > this.lastPosition + 0.05) this.buffering = false
    this.lastPosition = el.currentTime
    const drift = el.currentTime - expectedMs / 1000 // 正数表示本机超前
    const decision = decideSync(drift, {
      sinceSeekMs: now2 - this.lastSeekAt,
      buffering: this.buffering,
      pitchPreserved: PRESERVES_PITCH,
    })
    if (decision.seek) {
      this.seek(el, expectedMs / 1000)
      this.lastSeekAt = now2
      this.suppressUntil = now2 + 800
      el.playbackRate = 1
    } else if (el.playbackRate !== decision.rate) {
      el.playbackRate = decision.rate
    }
  }

  private seek(el: HTMLAudioElement, sec: number): void {
    try {
      el.currentTime = Math.max(0, sec)
    } catch {
      /* 还没加载元数据 */
    }
  }

  private tick(): void {
    this.sync(false)
  }

  /** 出错先用当前进度重新取一次地址再试；仍然失败就上报 */
  private onElError(idx: number): void {
    const l = this.loaded[idx]
    if (!l || !this.els[idx].getAttribute('src')) return
    this.loaded[idx] = null
    if (l.itemId !== this.timeline?.itemId) return
    if (this.retried.has(l.itemId)) {
      this.markFailed(l.itemId)
      return
    }
    this.retried.add(l.itemId)
    void this.load(idx, l.itemId).then((ok) => {
      if (ok) this.sync(true)
      else this.markFailed(l.itemId)
    })
  }

  private onVisible = (): void => {
    if (document.visibilityState === 'visible' && this.listening) {
      void this.requestWakeLock()
      this.sync(true)
    }
  }

  private async requestWakeLock(): Promise<void> {
    const wl = (navigator as any).wakeLock
    if (!wl || !window.isSecureContext) return
    if (this.wakeLock && !this.wakeLock.released) return
    try {
      this.wakeLock = await wl.request('screen')
    } catch {
      this.wakeLock = null
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release()
    } catch {
      /* ignore */
    }
    this.wakeLock = null
  }
}
