import { parse } from "@std/csv";
import { getDb } from "./db.ts";

type Row = Record<string, string>;

// URLs, rather than display names, identify participants. Group conversations
// are skipped: assigning every message to one member would distort relationships.
export function profileKey(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.hostname !== "linkedin.com" && !url.hostname.endsWith(".linkedin.com")) return null;
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]).toLowerCase() : null;
  } catch {
    return null;
  }
}

function singleProfile(value: string): string | null {
  const urls = value.split(/[;,]\s*/).filter((part) => part.trim());
  return urls.length === 1 ? profileKey(urls[0]) : null;
}

export async function importLinkedInMessages(
  db: ReturnType<typeof getDb>,
  csv: string,
  selfUrl: string,
) {
  const self = profileKey(selfUrl);
  if (!self) throw new Error("Provide your LinkedIn /in/ profile URL with --self");
  const cleaned = csv.replace(/^\uFEFF/, "");
  const header = parse(cleaned)[0];
  const required = ["CONVERSATION ID", "FROM", "SENDER PROFILE URL", "TO", "RECIPIENT PROFILE URL", "DATE", "CONTENT"];
  if (!header || required.some((name) => !header.includes(name))) {
    throw new Error(`messages.csv must contain: ${required.join(", ")}`);
  }
  const rows = parse(cleaned, { skipFirstRow: true }) as Row[];
  const result = { imported: 0, duplicates: 0, skipped: 0, created: 0 };
  const prepared: Array<{ key: string; name: string; date: string; text: string; outgoing: number; fingerprint: string }> = [];
  for (const row of rows) {
    const sender = singleProfile(row["SENDER PROFILE URL"]);
    const recipient = singleProfile(row["RECIPIENT PROFILE URL"]);
    if (!sender || !recipient || sender === recipient || (sender !== self && recipient !== self)) {
      result.skipped++;
      continue;
    }
    const dateValue = row.DATE.trim();
    // Archives are UTC. Do not let the machine's local timezone reinterpret it.
    const date = new Date(/(?:Z|[+-]\d\d:?\d\d)$/i.test(dateValue) ? dateValue : `${dateValue.replace(" ", "T")}Z`);
    if (!row["CONVERSATION ID"].trim() || Number.isNaN(date.getTime())) {
      result.skipped++;
      continue;
    }
    const outgoing = sender === self ? 1 : 0;
    const key = outgoing ? recipient : sender;
    const name = (outgoing ? row.TO : row.FROM).trim();
    const text = row.CONTENT || row.SUBJECT || "(attachment)";
    const timestamp = date.toISOString().replace("T", " ").slice(0, 19);
    const identity = JSON.stringify([row["CONVERSATION ID"], sender, recipient, date.toISOString(), row.SUBJECT || "", row.CONTENT]);
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
    const fingerprint = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    prepared.push({ key, name, date: timestamp, text, outgoing, fingerprint });
  }

  const byProfile = new Map<string, number>();
  for (const contact of db.prepare("SELECT id, linkedin_url FROM contacts WHERE linkedin_url IS NOT NULL").all() as Array<{ id: number; linkedin_url: string }>) {
    const key = profileKey(contact.linkedin_url);
    if (key) byProfile.set(key, contact.id);
  }
  for (const redirect of db.prepare("SELECT source_id, target_contact_id FROM merge_redirects WHERE source = 'linkedin'").all() as Array<{ source_id: string; target_contact_id: number }>) {
    const key = profileKey(redirect.source_id);
    if (key) byProfile.set(key, redirect.target_contact_id);
  }
  const touched = new Set<number>();
  db.transaction(() => {
    for (const row of prepared) {
      if (db.prepare("SELECT 1 FROM linkedin_message_imports WHERE fingerprint = ?").get(row.fingerprint)) {
        result.duplicates++;
        continue;
      }
      let id = byProfile.get(row.key);
      if (!id) {
        // A unique name may link a phone-only contact, but never override a
        // different LinkedIn identity or pick arbitrarily between namesakes.
        const matches = db.prepare("SELECT id, linkedin_url FROM contacts WHERE display_name = ? AND archived = 0").all(row.name) as Array<{ id: number; linkedin_url: string | null }>;
        if (matches.length === 1 && !matches[0].linkedin_url) {
          id = matches[0].id;
          db.prepare("UPDATE contacts SET linkedin_url = ? WHERE id = ?").run(`https://www.linkedin.com/in/${row.key}`, id);
        } else {
          db.prepare("INSERT INTO contacts (display_name, linkedin_url) VALUES (?, ?)").run(row.name || row.key, `https://www.linkedin.com/in/${row.key}`);
          id = Number(db.lastInsertRowId);
          result.created++;
        }
        byProfile.set(row.key, id);
      }
      db.prepare("INSERT INTO messages (handle, contact_id, text, is_from_me, date, source) VALUES (?, ?, ?, ?, ?, 'linkedin')")
        .run(`linkedin:${row.key}`, id, row.text, row.outgoing, row.date);
      db.prepare("INSERT INTO linkedin_message_imports (fingerprint, message_id) VALUES (?, ?)").run(row.fingerprint, Number(db.lastInsertRowId));
      touched.add(id);
      result.imported++;
    }
    for (const id of touched) {
      db.prepare(`UPDATE contacts SET
        message_count = (SELECT COUNT(*) FROM messages WHERE contact_id = ?),
        first_contacted = (SELECT MIN(date) FROM messages WHERE contact_id = ?),
        last_contacted = (SELECT MAX(date) FROM messages WHERE contact_id = ?),
        updated_at = datetime('now') WHERE id = ?`).run(id, id, id, id);
    }
    db.prepare("INSERT INTO import_log (source, count) VALUES ('linkedin_messages', ?)").run(result.imported);
  })();
  return result;
}

if (import.meta.main) {
  const [path, flag, selfUrl] = Deno.args;
  if (!path || flag !== "--self" || !selfUrl || Deno.args.length !== 3) {
    throw new Error("Usage: deno task import-linkedin-messages /path/to/messages.csv --self https://www.linkedin.com/in/your-profile");
  }
  const csv = Deno.readTextFileSync(path);
  const db = getDb();
  try {
    console.log("LinkedIn messages:", await importLinkedInMessages(db, csv, selfUrl));
  } finally {
    db.close();
  }
}
