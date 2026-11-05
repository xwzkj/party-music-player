import type { DatabaseSync } from 'node:sqlite'

const migrations: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    email TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    nickname TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    can_create_room INTEGER NOT NULL DEFAULT 0,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    can_rename_once INTEGER NOT NULL DEFAULT 0,
    token_version INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX users_email_verified ON users(email COLLATE NOCASE) WHERE email_verified = 1;

  CREATE TABLE netease_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    netease_uid TEXT NOT NULL,
    netease_nickname TEXT NOT NULL,
    vip_type INTEGER NOT NULL DEFAULT 0,
    cookie TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES users(id),
    passcode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    settings_json TEXT NOT NULL,
    timeline_json TEXT NOT NULL,
    up_next_id TEXT,
    created_at INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX rooms_open_code ON rooms(code) WHERE status = 'open';

  CREATE TABLE room_members (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    left INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (room_id, user_id)
  );

  CREATE TABLE room_bans (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );

  CREATE TABLE queue_items (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    track_json TEXT NOT NULL,
    first_added_at INTEGER NOT NULL,
    pinned_at INTEGER,
    state TEXT NOT NULL,
    ended_reason TEXT,
    ended_at INTEGER
  );
  CREATE INDEX queue_items_room ON queue_items(room_id, state);

  CREATE TABLE queue_adds (
    item_id TEXT NOT NULL REFERENCES queue_items(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (item_id, user_id)
  );

  CREATE TABLE votes (
    item_id TEXT NOT NULL REFERENCES queue_items(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    value INTEGER NOT NULL,
    PRIMARY KEY (item_id, user_id)
  );

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    user_id TEXT,
    content TEXT NOT NULL,
    system_type TEXT,
    payload_json TEXT,
    created_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX chat_room_time ON chat_messages(room_id, created_at);
  `,
]

export function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined
  let current = row?.version ?? 0
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run()
  while (current < migrations.length) {
    db.exec('BEGIN')
    try {
      db.exec(migrations[current])
      current++
      db.prepare('UPDATE schema_version SET version = ?').run(current)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}
