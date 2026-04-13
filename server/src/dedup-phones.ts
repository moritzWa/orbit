import { getDb } from "./db.ts";

const db = getDb();

// --- Phase 1: Normalize phones ---
db.exec(`
  DELETE FROM contact_phones
  WHERE phone NOT LIKE '+%' AND length(phone) >= 10
    AND EXISTS (
      SELECT 1 FROM contact_phones cp2
      WHERE cp2.contact_id = contact_phones.contact_id
        AND cp2.phone = '+' || contact_phones.phone
    )
`);
db.exec(`
  UPDATE contact_phones SET phone = '+' || phone
  WHERE phone NOT LIKE '+%' AND length(phone) >= 10
`);

// --- Shared merge logic ---
const insertRedirect = db.prepare("INSERT OR IGNORE INTO merge_redirects (source, source_id, target_contact_id) VALUES (?, ?, ?)");

function mergeContacts(keepId: number, removeIds: number[]) {
  const ph = removeIds.map(() => "?").join(",");

  db.prepare(`UPDATE messages SET contact_id = ? WHERE contact_id IN (${ph})`).run(keepId, ...removeIds);
  db.prepare(`UPDATE OR IGNORE contact_phones SET contact_id = ? WHERE contact_id IN (${ph})`).run(keepId, ...removeIds);
  db.prepare(`UPDATE OR IGNORE contact_emails SET contact_id = ? WHERE contact_id IN (${ph})`).run(keepId, ...removeIds);

  for (const rid of removeIds) {
    const r = db.prepare("SELECT apple_contacts_id, linkedin_url, profile_picture_url, display_name FROM contacts WHERE id = ?").get(rid) as {
      apple_contacts_id: number | null; linkedin_url: string | null; profile_picture_url: string | null; display_name: string;
    } | undefined;
    if (r) {
      if (r.apple_contacts_id) insertRedirect.run("apple", String(r.apple_contacts_id), keepId);
      if (r.linkedin_url) insertRedirect.run("linkedin", r.linkedin_url, keepId);
      const k = db.prepare("SELECT linkedin_url, profile_picture_url, display_name FROM contacts WHERE id = ?").get(keepId) as {
        linkedin_url: string | null; profile_picture_url: string | null; display_name: string;
      };
      if (!k.linkedin_url && r.linkedin_url) db.prepare("UPDATE contacts SET linkedin_url = ? WHERE id = ?").run(r.linkedin_url, keepId);
      if (!k.profile_picture_url && r.profile_picture_url) db.prepare("UPDATE contacts SET profile_picture_url = ? WHERE id = ?").run(r.profile_picture_url, keepId);

      // Prefer the name with more uppercase letters (better casing)
      const countUpper = (s: string) => (s.match(/[A-Z]/g) || []).length;
      if (countUpper(r.display_name) > countUpper(k.display_name)) {
        db.prepare("UPDATE contacts SET display_name = ?, first_name = ?, updated_at = datetime('now') WHERE id = ?")
          .run(r.display_name, r.display_name.split(" ")[0], keepId);
      }
    }
  }

  db.prepare(`DELETE FROM contact_phones WHERE contact_id IN (${ph})`).run(...removeIds);
  db.prepare(`DELETE FROM contact_emails WHERE contact_id IN (${ph})`).run(...removeIds);
  db.prepare(`DELETE FROM contact_tags WHERE contact_id IN (${ph})`).run(...removeIds);
  db.prepare(`DELETE FROM linkedin_snapshots WHERE contact_id IN (${ph})`).run(...removeIds);
  db.prepare(`DELETE FROM merge_redirects WHERE target_contact_id IN (${ph})`).run(...removeIds);
  db.prepare(`DELETE FROM dismissed_duplicates WHERE contact_id_a IN (${ph}) OR contact_id_b IN (${ph})`).run(...removeIds, ...removeIds);
  db.exec("PRAGMA foreign_keys=OFF");
  db.prepare(`DELETE FROM contacts WHERE id IN (${ph})`).run(...removeIds);
  db.exec("PRAGMA foreign_keys=ON");
}

let merged = 0;
let removed = 0;

const transaction = db.transaction(() => {
  // --- Phase 2: Merge by shared phone (including +1 normalization) ---
  // Also match +1XXXXXXXXXX with +XXXXXXXXXX (US country code)
  const sharedPhones = db.prepare(`
    SELECT phone, GROUP_CONCAT(DISTINCT contact_id) as contact_ids, COUNT(DISTINCT contact_id) as cnt
    FROM (
      SELECT contact_id,
        CASE
          WHEN phone LIKE '+1%' AND length(phone) = 12 THEN '+' || substr(phone, 3)
          ELSE phone
        END as phone
      FROM contact_phones
    )
    GROUP BY phone
    HAVING cnt > 1
  `).all() as Array<{ phone: string; contact_ids: string; cnt: number }>;

  for (const { contact_ids } of sharedPhones) {
    const ids = [...new Set(contact_ids.split(",").map(Number))];
    const keep = db.prepare(`
      SELECT id FROM contacts WHERE id IN (${ids.map(() => "?").join(",")})
      ORDER BY message_count DESC, id ASC LIMIT 1
    `).get(...ids) as { id: number };
    const removeIds = ids.filter((id) => id !== keep.id);
    if (removeIds.length === 0) continue;
    mergeContacts(keep.id, removeIds);
    removed += removeIds.length;
    merged++;
  }

  // --- Phase 3: Merge by shared email ---
  const sharedEmails = db.prepare(`
    SELECT email, GROUP_CONCAT(DISTINCT contact_id) as contact_ids, COUNT(DISTINCT contact_id) as cnt
    FROM contact_emails
    GROUP BY email
    HAVING cnt > 1
  `).all() as Array<{ email: string; contact_ids: string; cnt: number }>;

  for (const { contact_ids } of sharedEmails) {
    const ids = [...new Set(contact_ids.split(",").map(Number))];
    // Verify contacts still exist (might have been merged in phone phase)
    const existing = ids.filter((id) => {
      const c = db.prepare("SELECT id FROM contacts WHERE id = ?").get(id);
      return !!c;
    });
    if (existing.length < 2) continue;
    const keep = db.prepare(`
      SELECT id FROM contacts WHERE id IN (${existing.map(() => "?").join(",")})
      ORDER BY message_count DESC, id ASC LIMIT 1
    `).get(...existing) as { id: number };
    const removeIds = existing.filter((id) => id !== keep.id);
    if (removeIds.length === 0) continue;
    mergeContacts(keep.id, removeIds);
    removed += removeIds.length;
    merged++;
  }

  // --- Phase 4: Merge by exact normalized name (strip emojis, case-insensitive) ---
  const normalize = (n: string) => n
    .replace(/[\u{1F000}-\u{1FFFF}|\u{2600}-\u{27BF}|\u{FE00}-\u{FEFF}|\u{200D}|\u{20E3}|\u{E0020}-\u{E007F}|☁️☀️⭐✨❤️]/gu, "")
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

  const allContacts = db.prepare(`
    SELECT id, display_name, message_count FROM contacts
    WHERE display_name IS NOT NULL AND display_name LIKE '% %' AND archived = 0
    ORDER BY message_count DESC
  `).all() as Array<{ id: number; display_name: string; message_count: number }>;

  const nameGroups = new Map<string, number[]>();
  for (const c of allContacts) {
    const norm = normalize(c.display_name);
    if (!norm || norm.length < 3) continue;
    const group = nameGroups.get(norm) ?? [];
    group.push(c.id);
    nameGroups.set(norm, group);
  }

  for (const [, ids] of nameGroups) {
    if (ids.length < 2) continue;
    // Verify contacts still exist
    const existing = ids.filter((id) => {
      const c = db.prepare("SELECT id FROM contacts WHERE id = ?").get(id);
      return !!c;
    });
    if (existing.length < 2) continue;
    const keep = db.prepare(`
      SELECT id FROM contacts WHERE id IN (${existing.map(() => "?").join(",")})
      ORDER BY message_count DESC, id ASC LIMIT 1
    `).get(...existing) as { id: number };
    const removeIds = existing.filter((id) => id !== keep.id);
    if (removeIds.length === 0) continue;
    mergeContacts(keep.id, removeIds);
    removed += removeIds.length;
    merged++;
  }
});

transaction();

// Recalculate message stats
db.exec(`
  UPDATE contacts SET
    message_count = COALESCE((SELECT COUNT(*) FROM messages WHERE messages.contact_id = contacts.id), 0),
    first_contacted = (SELECT MIN(date) FROM messages WHERE messages.contact_id = contacts.id),
    last_contacted = (SELECT MAX(date) FROM messages WHERE messages.contact_id = contacts.id),
    updated_at = datetime('now')
`);

db.close();
console.log(`Merged ${merged} groups, removed ${removed} duplicate contacts`);
