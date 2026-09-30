PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Usuários
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- Cache local da Open Library.
-- Guardamos apenas o mínimo para exibir a biblioteca offline e manter as FKs.
-- A fonte da verdade continua sendo a Open Library (identificada pelas chaves).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS book_works (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ol_work_key        TEXT    NOT NULL UNIQUE,       -- ex.: /works/OL166894W
  title              TEXT    NOT NULL,
  authors            TEXT    NOT NULL DEFAULT '[]', -- JSON array de nomes
  cover_id           INTEGER,
  cover_url          TEXT,                            -- capa de fonte externa (Google Books), quando não há cover_id
  first_publish_year INTEGER,
  subjects           TEXT    NOT NULL DEFAULT '[]', -- JSON array
  synced_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS book_editions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id          INTEGER NOT NULL REFERENCES book_works(id) ON DELETE CASCADE,
  ol_edition_key   TEXT    UNIQUE,                  -- ex.: /books/OL7353617M (nulo = edição manual)
  title            TEXT    NOT NULL,
  publisher        TEXT,
  publish_date     TEXT,
  number_of_pages  INTEGER,
  isbn             TEXT,
  language         TEXT,
  cover_id         INTEGER,
  cover_url        TEXT,                            -- capa de fonte externa (Google Books), quando não há cover_id
  is_custom        INTEGER NOT NULL DEFAULT 0,      -- edição cadastrada manualmente pelo usuário
  synced_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_editions_work ON book_editions(work_id);

-- ---------------------------------------------------------------------------
-- Biblioteca pessoal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_library (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  edition_id   INTEGER NOT NULL REFERENCES book_editions(id) ON DELETE CASCADE,
  status       TEXT    NOT NULL DEFAULT 'WANT_TO_READ'
               CHECK (status IN ('WANT_TO_READ','READING','PAUSED','FINISHED','ABANDONED')),
  -- páginas totais desta cópia: cai para book_editions.number_of_pages quando nulo,
  -- mas o usuário pode corrigir (a edição dele pode divergir do catálogo)
  total_pages  INTEGER CHECK (total_pages IS NULL OR total_pages > 0),
  current_page INTEGER NOT NULL DEFAULT 0 CHECK (current_page >= 0),
  rating       INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  is_favorite  INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  added_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  started_at   TEXT,
  finished_at  TEXT,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, edition_id)
);
CREATE INDEX IF NOT EXISTS idx_library_user_status ON user_library(user_id, status);

-- Histórico de leitura: um evento por atualização de progresso.
CREATE TABLE IF NOT EXISTS reading_progress (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  library_item_id INTEGER NOT NULL REFERENCES user_library(id) ON DELETE CASCADE,
  page_from       INTEGER NOT NULL CHECK (page_from >= 0),
  page_to         INTEGER NOT NULL CHECK (page_to   >= 0),
  pages_read      INTEGER NOT NULL,
  note            TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_progress_item ON reading_progress(library_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS annotations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  library_item_id INTEGER NOT NULL REFERENCES user_library(id) ON DELETE CASCADE,
  page            INTEGER CHECK (page IS NULL OR page >= 0),
  title           TEXT,
  content         TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_annotations_item ON annotations(library_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quotes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  library_item_id INTEGER NOT NULL REFERENCES user_library(id) ON DELETE CASCADE,
  page            INTEGER CHECK (page IS NULL OR page >= 0),
  text            TEXT    NOT NULL,
  comment         TEXT,
  is_favorite     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_item ON quotes(library_item_id, created_at DESC);
