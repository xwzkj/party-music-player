import { confirm, snackbar } from 'mdui'
import { ApiError } from './api/http'

export function toast(message: string): void {
  snackbar({ message, placement: 'bottom', autoCloseDelay: 3000, queue: 'toast' })
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
