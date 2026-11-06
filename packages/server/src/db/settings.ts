import { getDb } from './connection.ts'

export const settingsRepo = {
  get(key: string): string | undefined {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value
  },
  set(key: string, value: string): void {
    getDb()
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  },
  has(key: string): boolean {
    return this.get(key) !== undefined
  },
  delete(key: string): void {
    getDb().prepare('DELETE FROM settings WHERE key = ?').run(key)
  },
  getBool(key: string, def = false): boolean {
    const v = this.get(key)
    return v === undefined ? def : v === '1'
  },
  setBool(key: string, v: boolean): void {
    this.set(key, v ? '1' : '0')
  },
}

export const SettingKey = {
  emailVerification: 'email_verification_enabled',
  turnstile: 'turnstile_enabled',
  jwtSecret: 'jwt_secret',
  // 管理员在后台填写的配置；有值时优先于环境变量
  smtpHost: 'smtp_host',
  smtpPort: 'smtp_port',
  smtpSecure: 'smtp_secure',
  smtpUser: 'smtp_user',
  smtpPass: 'smtp_pass',
  smtpFrom: 'smtp_from',
  turnstileSiteKey: 'turnstile_site_key',
  turnstileSecretKey: 'turnstile_secret_key',
} as const
