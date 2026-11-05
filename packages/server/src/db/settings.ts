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
} as const
