import { config } from '../config.ts'

/** 防 CSRF：Origin 必须与 Host 同源，或在 ALLOWED_ORIGINS 里 */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return false
  if (config.allowedOrigins.includes(origin)) return true
  if (!host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
