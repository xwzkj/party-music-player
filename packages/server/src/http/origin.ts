import { config } from '../config.ts'

/** 从 Origin 或 Host 里取出主机名；Host 可能是 127.0.0.1:3000 或 [::1]:3000 这种 */
function hostnameOf(value: string): string | null {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * 防 CSRF 的同源校验。登录态是 Cookie，跨站请求必须挡住，但不该把正常的部署方式也挡住：
 *
 * 1. `Sec-Fetch-Site` 是浏览器自己写的，脚本改不了。值是 same-origin / none 时请求确实来自本站，
 *    直接放行——反向代理改写 Host、或者跑在 8080 这类非常规端口时都不会误伤。
 * 2. 没有这个头（老浏览器、非浏览器客户端）时比较 Origin 和 Host 的主机名，
 *    不看端口和协议：反代可能把 443 转成 3000、把 Host 写成不带端口的形式。
 * 3. `ALLOWED_ORIGINS` 仍然优先，给反代把 Host 改写成别的域名时兜底。
 *
 * 跨站页面发来的请求（Origin 是别的域名，Sec-Fetch-Site 是 cross-site / same-site）一律拒绝。
 */
export function originAllowed(origin: string | undefined, host: string | undefined, fetchSite?: string): boolean {
  if (fetchSite === 'same-origin' || fetchSite === 'none') return true
  if (!origin) return false
  if (config.allowedOrigins.includes(origin)) return true
  if (!host) return false
  const fromOrigin = hostnameOf(origin)
  const fromHost = hostnameOf(host)
  return !!fromOrigin && !!fromHost && fromOrigin === fromHost
}
