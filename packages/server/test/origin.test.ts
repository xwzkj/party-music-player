import './setupEnv.ts'
import { describe, expect, it } from 'vitest'
import { originAllowed } from '../src/http/origin.ts'

describe('同源校验（防 CSRF）', () => {
  it('同一主机不同端口也放行：反代改端口、非常规端口都不误伤', () => {
    expect(originAllowed('http://example.com:8080', 'example.com')).toBe(true)
    expect(originAllowed('https://192.168.1.5:8443', '192.168.1.5:3000')).toBe(true)
    expect(originAllowed('http://localhost:5173', 'localhost:3000')).toBe(true)
  })

  it('浏览器声明 same-origin / none 时放行：Host 被反代改写也不误伤', () => {
    expect(originAllowed('https://example.com:8443', '127.0.0.1:3000', 'same-origin')).toBe(true)
    expect(originAllowed(undefined, '127.0.0.1:3000', 'none')).toBe(true)
  })

  it('跨站请求一律拒绝', () => {
    expect(originAllowed('https://evil.com', 'example.com')).toBe(false)
    expect(originAllowed('https://evil.com', 'example.com', 'cross-site')).toBe(false)
    expect(originAllowed('https://a.example.com', 'example.com', 'same-site')).toBe(false)
  })

  it('没有 Origin 的请求拒绝', () => {
    expect(originAllowed(undefined, 'example.com')).toBe(false)
  })

  it('IPv6 主机名也能比较', () => {
    expect(originAllowed('http://[::1]:8080', '[::1]:3000')).toBe(true)
  })
})
