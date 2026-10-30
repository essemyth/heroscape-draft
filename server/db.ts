// SQLite storage (Node's built-in node:sqlite). One file in the data directory.
// Mirrors the tables the app used on Supabase; permissions are enforced in the routes.

import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const SCHEMA = `
create table if not exists users (
  id text primary key,
  token_hash text not null unique,
  created_at text not null
);

create table if not exists drafts (
  id text primary key,
  host_id text not null references users (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'drafting', 'complete')),
  settings text not null,   -- LobbySettings JSON
  state text,               -- DraftState JSON once started
  version integer not null default 0,
  created_at text not null,
  updated_at text not null
);

create table if not exists draft_players (
  draft_id text not null references drafts (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  name text not null,
  discord_id text,
  joined_at text not null,
  primary key (draft_id, user_id)
);

create table if not exists draft_secrets (
  draft_id text primary key references drafts (id) on delete cascade,
  discord_webhook text
);

create table if not exists photo_editors (
  user_id text primary key references users (id) on delete cascade,
  added_at text not null
);

create table if not exists unit_photos (
  unit_id text primary key,
  path text not null,
  thumb_path text not null,
  updated_at text not null,
  uploaded_by text
);
`

export type Db = DatabaseSync

export function openDb(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, 'heroscape.db'))
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;')
  db.exec(SCHEMA)
  return db
}

/** Runs `fn` in a transaction; everything inside commits together or not at all. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('begin immediate')
  try {
    const result = fn()
    db.exec('commit')
    return result
  } catch (e) {
    db.exec('rollback')
    throw e
  }
}
