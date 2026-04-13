import { parse } from "@std/csv";
import { getDb, logImport } from "./db.ts";

export function importSubstack() {
  const db = getDb();

  // Find the CSV in Downloads
  let csvPath = "";
  for (const entry of Deno.readDirSync(`${Deno.env.get("HOME")}/Downloads`)) {
    if (entry.name.includes("subscriber-export") && entry.name.endsWith(".csv")) {
      csvPath = `${Deno.env.get("HOME")}/Downloads/${entry.name}`;
      break;
    }
  }
  if (!csvPath) { console.error("No subscriber-export CSV found in Downloads"); Deno.exit(1); }

  console.log(`Reading ${csvPath}`);
  const raw = Deno.readTextFileSync(csvPath).replace(/^\uFEFF/, "");
  const records = parse(raw, { skipFirstRow: true }) as Record<string, string>[];
  console.log(`${records.length} subscribers`);

  // Add columns if not exist
  try { db.exec("ALTER TABLE contacts ADD COLUMN substack_email TEXT"); } catch { /* exists */ }
  try { db.exec("ALTER TABLE contacts ADD COLUMN substack_raw_json TEXT"); } catch { /* exists */ }

  const findBySubstackEmail = db.prepare("SELECT id FROM contacts WHERE substack_email = ? LIMIT 1");
  const findByEmail = db.prepare("SELECT contact_id FROM contact_emails WHERE email = ? LIMIT 1");
  const findByName = db.prepare("SELECT id FROM contacts WHERE display_name = ? AND archived = 0 LIMIT 1");
  const findRedirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'substack' AND source_id = ?");
  const insertTag = db.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)");
  const updateSubstack = db.prepare("UPDATE contacts SET substack_email = ?, substack_raw_json = ?, updated_at = datetime('now') WHERE id = ?");

  let matched = 0;
  let skipped = 0;

  for (const row of records) {
    const email = (row["Email"] ?? "").trim().toLowerCase();
    const name = (row["Name"] ?? "").trim();
    if (!email) { skipped++; continue; }

    let contactId: number | null = null;

    // 1. By substack_email (re-import)
    const bySub = findBySubstackEmail.get(email) as { id: number } | undefined;
    if (bySub) contactId = bySub.id;

    // 2. Merge redirect
    if (!contactId) {
      const redirect = findRedirect.get(email) as { target_contact_id: number } | undefined;
      if (redirect) contactId = redirect.target_contact_id;
    }

    // 3. By email in contact_emails
    if (!contactId) {
      const byEmail = findByEmail.get(email) as { contact_id: number } | undefined;
      if (byEmail) contactId = byEmail.contact_id;
    }

    // 4. By display name
    if (!contactId && name) {
      const byName = findByName.get(name) as { id: number } | undefined;
      if (byName) contactId = byName.id;
    }

    if (!contactId) { skipped++; continue; }

    updateSubstack.run(email, JSON.stringify(row), contactId);
    insertTag.run(contactId, "substack-subscriber");
    matched++;

    if (matched <= 10) console.log(`  ${name || email} -> contact ${contactId}`);
  }

  db.close();
  console.log(`\nSubstack: ${matched} matched, ${skipped} skipped`);
  logImport("substack", matched);
}

if (import.meta.main) {
  importSubstack();
}
