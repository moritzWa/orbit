import { Database } from "@db/sqlite";

const DB_PATH = Deno.env.get("CRM_DB_PATH") ??
  new URL("../../crm.db", import.meta.url).pathname;

export function getDb(): Database {
  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT,
      last_name TEXT,
      organization TEXT,
      display_name TEXT,
      apple_contacts_id INTEGER,
      linkedin_url TEXT,
      linkedin_headline TEXT,
      linkedin_location TEXT,
      linkedin_summary TEXT,
      linkedin_connected_on TEXT,
      linkedin_enriched_at TEXT,
      first_contacted TEXT,
      last_contacted TEXT,
      message_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_phones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id),
      phone TEXT NOT NULL,
      label TEXT,
      UNIQUE(contact_id, phone)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id),
      email TEXT NOT NULL,
      label TEXT,
      UNIQUE(contact_id, email)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imessage_rowid INTEGER UNIQUE,
      handle TEXT NOT NULL,
      contact_id INTEGER REFERENCES contacts(id),
      text TEXT,
      is_from_me INTEGER,
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS linkedin_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id),
      enriched_at TEXT DEFAULT (datetime('now')),
      raw_json TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS import_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      ran_at TEXT DEFAULT (datetime('now')),
      count INTEGER DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS merge_redirects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_contact_id INTEGER NOT NULL REFERENCES contacts(id),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source, source_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id_a INTEGER NOT NULL REFERENCES contacts(id),
      contact_id_b INTEGER NOT NULL REFERENCES contacts(id),
      type TEXT NOT NULL DEFAULT 'friend',
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(contact_id_a, contact_id_b)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id INTEGER NOT NULL REFERENCES contacts(id),
      tag TEXT NOT NULL,
      UNIQUE(contact_id, tag)
    )
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_contact_tags_tag ON contact_tags(tag)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS dismissed_duplicates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id_a INTEGER NOT NULL,
      contact_id_b INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(contact_id_a, contact_id_b)
    )
  `);

  // Index for matching handles to contacts
  db.exec("CREATE INDEX IF NOT EXISTS idx_contact_phones_phone ON contact_phones(phone)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_contact_emails_email ON contact_emails(email)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_handle ON messages(handle)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_contact_id ON messages(contact_id)");

  return db;
}

export function logImport(source: string, count: number) {
  const db = getDb();
  db.prepare("INSERT INTO import_log (source, count) VALUES (?, ?)").run(source, count);
  db.close();
}
