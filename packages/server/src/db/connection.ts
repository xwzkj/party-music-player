import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrate.ts'

let db: DatabaseSync | null = null

export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }
  const d = new DatabaseSync(file)
  d.exec('PRAGMA journal_mode = WAL')
  d.exec('PRAGMA foreign_keys = ON')
  d.exec('PRAGMA busy_timeout = 5000')
  migrate(d)
  if (file !== ':memory:') {
    // 数据库里有明文 Cookie，只允许服务进程读写（Windows 上无效果）
    try {
      fs.chmodSync(file, 0o600)
    } catch {
      /* ignore */
    }
  }
  db = d
  return d
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('数据库尚未打开')
  return db
}

/** 在一个事务里同步执行 fn */
export function tx<T>(fn: () => T): T {
  const d = getDb()
  d.exec('BEGIN')
  try {
    const r = fn()
    d.exec('COMMIT')
    return r
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}
