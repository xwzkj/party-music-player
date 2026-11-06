import { confirm, snackbar } from 'mdui'
import { ApiError } from './api/http'

export function toast(message: string): void {
  // 全屏面板（播放页、聊天、播放列表）打开时，底部是播放控件或输入框，toast 改到顶部显示
  const inSheet = !!document.querySelector('[data-app-sheet]')
  const bar = snackbar({ message, placement: inSheet ? 'top' : 'bottom', autoCloseDelay: 3000, queue: 'toast' })
  // 底部的 toast 要抬到房间页底部栏之上：mdui 用内联样式排 bottom，这里用 margin 叠加 --app-toast-offset
  if (!inSheet) bar.classList.add('app-toast')
}

export function toastError(e: unknown): void {
  if (e instanceof ApiError) return toast(e.message)
  if (e instanceof Error) return toast(e.message)
  toast('出错了')
}

/** 返回用户是否点了确定 */
export async function ask(headline: string, description?: string, confirmText = '确定'): Promise<boolean> {
  try {
    await confirm({ headline, description, confirmText, cancelText: '取消', closeOnOverlayClick: true })
    return true
  } catch {
    return false
  }
}

/** 从 mdui 组件事件里取 value */
export function val(e: Event): string {
  return String((e.target as HTMLInputElement).value ?? '')
}

/**
 * 复制文本。navigator.clipboard 只在安全上下文（https 或 localhost）里可用，
 * 用局域网 IP 走 http 打开时会是 undefined，这时退回 textarea + execCommand。
 */
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* 权限被拒时继续走老办法 */
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  area.setSelectionRange(0, text.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

export function checked(e: Event): boolean {
  return !!(e.target as HTMLInputElement).checked
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 封面走本站代理，避免 canvas 跨域污染；同时换成小图 */
export function coverSrc(url: string, size = 300): string {
  if (!url) return ''
  return `${url.replace(/^http:/, 'https:')}?param=${size}y${size}`
}

export function coverProxy(url: string): string {
  return url ? `/api/music/cover?url=${encodeURIComponent(url)}` : ''
}
