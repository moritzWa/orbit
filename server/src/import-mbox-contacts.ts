import { getDb, logImport } from "./db.ts";

const EMAIL_NAMES_PATH = "/tmp/email_to_name.json";

export function importMboxContacts(limit?: number) {
  const emailNames: Record<string, string> = JSON.parse(
    Deno.readTextFileSync(EMAIL_NAMES_PATH)
  );

  const db = getDb();

  // Get all unmatched calendar attendee emails
  const raw = Deno.readTextFileSync("/tmp/gcal_export/Default_wallawitsch@gmail.com.ics") +
    Deno.readTextFileSync("/tmp/gcal_export/moritz@rogo.ai.ics");
  const content = raw.replace(/\r?\n[ \t]/g, "");

  const unmatched = new Set<string>();
  const blocks = content.split("BEGIN:VEVENT");
  for (const block of blocks.slice(1)) {
    const attendees: string[] = [];
    for (const m of block.matchAll(/ATTENDEE[^:]*:mailto:([^\r\n]+)/gi)) {
      const e = m[1].trim().toLowerCase();
      if (!e.includes("wallawitsch")) attendees.push(e);
    }
    if (attendees.length >= 10) continue;

    for (const email of attendees) {
      if (email.includes("rogo.ai") || email.includes("rogodata.com") || email.includes("resource.calendar")) continue;
      // Check if already linked
      const existing = db.prepare("SELECT contact_id FROM contact_emails WHERE email = ?").get(email);
      if (!existing) {
        // Check merge redirects
        const redirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'mbox' AND source_id = ?").get(email);
        if (!redirect) unmatched.add(email);
      }
    }
  }

  console.log(`Unmatched calendar attendees: ${unmatched.size}`);

  const findByName = db.prepare("SELECT id FROM contacts WHERE display_name = ? AND archived = 0 LIMIT 1");
  const findByEmail = db.prepare("SELECT contact_id FROM contact_emails WHERE email = ? LIMIT 1");
  const findRedirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'mbox' AND source_id = ?");
  const insertContact = db.prepare(`
    INSERT INTO contacts (first_name, last_name, display_name, organization)
    VALUES (?, ?, ?, ?)
  `);
  const insertEmail = db.prepare("INSERT OR IGNORE INTO contact_emails (contact_id, email, label) VALUES (?, ?, 'mbox')");
  const insertTag = db.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)");

  let linked = 0;
  let created = 0;
  let skipped = 0;
  let count = 0;

  for (const email of [...unmatched].sort()) {
    if (limit && count >= limit) break;
    count++;

    const name = emailNames[email];
    if (!name || name.includes("=?") || name.length < 3) {
      skipped++;
      continue;
    }

    // Clean up "Last, First" format
    let displayName = name;
    if (name.includes(",") && !name.includes("(")) {
      const parts = name.split(",").map((s: string) => s.trim());
      if (parts.length === 2 && parts[0].length > 1 && parts[1].length > 1) {
        displayName = `${parts[1]} ${parts[0]}`;
      }
    }

    // Check redirect first
    const redirect = findRedirect.get(email) as { target_contact_id: number } | undefined;
    if (redirect) {
      insertEmail.run(redirect.target_contact_id, email);
      linked++;
      continue;
    }

    // Try to match by email (shouldn't hit since we filtered above, but safety)
    const byEmail = findByEmail.get(email) as { contact_id: number } | undefined;
    if (byEmail) {
      linked++;
      continue;
    }

    // Try to match by name
    const byName = findByName.get(displayName) as { id: number } | undefined;
    if (byName) {
      insertEmail.run(byName.id, email);
      linked++;
      if (count <= 20) console.log(`  LINK: ${email} -> ${displayName} (contact ${byName.id})`);
      continue;
    }

    // Create new contact
    const nameParts = displayName.split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || null;

    // Try to infer org from email domain
    const domain = email.split("@")[1];
    const skipDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "me.com", "protonmail.com", "hey.com", "live.com"];
    const org = skipDomains.includes(domain) ? null : domain.split(".")[0];

    insertContact.run(firstName, lastName, displayName, org);
    const newId = db.lastInsertRowId;
    insertEmail.run(newId, email);
    insertTag.run(newId, "calendar-attendee");
    created++;
    if (count <= 20) console.log(`  NEW:  ${email} -> ${displayName} (contact ${newId})`);
  }

  db.close();
  console.log(`\nMbox contacts: ${linked} linked, ${created} created, ${skipped} skipped`);
  logImport("mbox", linked + created);
}

if (import.meta.main) {
  const limit = Deno.args[0] ? parseInt(Deno.args[0]) : undefined;
  importMboxContacts(limit);
}
