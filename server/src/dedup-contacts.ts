import { getDb } from "./db.ts";

export function dedup() {
  const db = getDb();

  // Find groups of contacts that share the same display_name
  const dupeGroups = db.prepare(`
    SELECT display_name, GROUP_CONCAT(id) as ids, COUNT(*) as c
    FROM contacts
    WHERE display_name IS NOT NULL
    GROUP BY display_name
    HAVING c > 1
    ORDER BY c DESC
  `).all() as Array<{ display_name: string; ids: string; c: number }>;

  let mergedGroups = 0;
  let removedContacts = 0;

  const transaction = db.transaction(() => {
    for (const group of dupeGroups) {
      const ids = group.ids.split(",").map(Number);

      // Pick the contact with the most messages as the primary
      const primary = db.prepare(`
        SELECT id FROM contacts WHERE id IN (${ids.map(() => "?").join(",")})
        ORDER BY message_count DESC, id ASC LIMIT 1
      `).get(...ids) as { id: number };

      const dupeIds = ids.filter((id) => id !== primary.id);
      if (dupeIds.length === 0) continue;

      const placeholders = dupeIds.map(() => "?").join(",");

      // Move phones and emails to primary (ignore conflicts)
      db.prepare(`UPDATE OR IGNORE contact_phones SET contact_id = ? WHERE contact_id IN (${placeholders})`).run(primary.id, ...dupeIds);
      db.prepare(`UPDATE OR IGNORE contact_emails SET contact_id = ? WHERE contact_id IN (${placeholders})`).run(primary.id, ...dupeIds);

      // Move messages to primary
      db.prepare(`UPDATE messages SET contact_id = ? WHERE contact_id IN (${placeholders})`).run(primary.id, ...dupeIds);

      // Delete orphaned phones/emails and other references from dupes
      db.prepare(`DELETE FROM contact_phones WHERE contact_id IN (${placeholders})`).run(...dupeIds);
      db.prepare(`DELETE FROM contact_emails WHERE contact_id IN (${placeholders})`).run(...dupeIds);
      db.prepare(`DELETE FROM contact_tags WHERE contact_id IN (${placeholders})`).run(...dupeIds);
      db.prepare(`DELETE FROM linkedin_snapshots WHERE contact_id IN (${placeholders})`).run(...dupeIds);
      db.prepare(`DELETE FROM dismissed_duplicates WHERE contact_id_a IN (${placeholders}) OR contact_id_b IN (${placeholders})`).run(...dupeIds, ...dupeIds);
      db.prepare(`DELETE FROM merge_redirects WHERE target_contact_id IN (${placeholders})`).run(...dupeIds);

      // Delete duplicate contacts
      db.exec("PRAGMA foreign_keys=OFF");
      db.prepare(`DELETE FROM contacts WHERE id IN (${placeholders})`).run(...dupeIds);
      db.exec("PRAGMA foreign_keys=ON");

      mergedGroups++;
      removedContacts += dupeIds.length;
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

  console.log(`Merged ${mergedGroups} groups, removed ${removedContacts} duplicate contacts`);
}

if (import.meta.main) {
  dedup();
}
