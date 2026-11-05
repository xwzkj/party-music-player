import { pino } from 'pino'
import { config } from '../config.ts'

/** 对 Cookie、令牌、密码字段脱敏 */
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      '*.password',
      '*.oldPassword',
      '*.newPassword',
      '*.passcode',
      '*.cookie',
      '*.token',
      '*.turnstileToken',
    ],
    censor: '[REDACTED]',
  },
})
