import { parse } from "@std/csv";
import { getDb, logImport } from "./db.ts";

export function importGoogleContacts() {
  const csvPath = `${Deno.env.get("HOME")}/Downloads/google-contacts.csv`;
  const raw = Deno.readTextFileSync(csvPath).replace(/^\uFEFF/, "");
  const records = parse(raw, { skipFirstRow: true }) as Record<string, string>[];
  console.log(`Google Contacts: ${records.length} entries`);

  const db = getDb();

  const findByName = db.prepare("SELECT id FROM contacts WHERE display_name = ? AND archived = 0 LIMIT 1");
  const findByPhone = db.prepare("SELECT contact_id FROM contact_phones WHERE phone = ? LIMIT 1");
  const findByEmail = db.prepare("SELECT contact_id FROM contact_emails WHERE email = ? LIMIT 1");
  const insertEmail = db.prepare("INSERT OR IGNORE INTO contact_emails (contact_id, email, label) VALUES (?, ?, 'google')");

  let linked = 0;
  let skipped = 0;

  for (const row of records) {
    const firstName = (row["First Name"] ?? "").trim();
    const lastName = (row["Last Name"] ?? "").trim();
    const displayName = [firstName, lastName].filter(Boolean).join(" ");
    if (!displayName) { skipped++; continue; }

    // Collect emails and phones from the row
    const emails: string[] = [];
    const phones: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const email = (row[`E-mail ${i} - Value`] ?? "").trim().toLowerCase();
      if (email) emails.push(email);
      const phone = (row[`Phone ${i} - Value`] ?? "").trim().replace(/[^\d+]/g, "");
      if (phone) phones.push(phone.startsWith("+") ? phone : phone.length >= 10 ? "+" + phone : phone);
    }

    if (emails.length === 0) { skipped++; continue; }

    // Try to match to existing contact
    let contactId: number | null = null;

    // By email first
    for (const email of emails) {
      const match = findByEmail.get(email) as { contact_id: number } | undefined;
      if (match) { contactId = match.contact_id; break; }
    }

    // By phone
    if (!contactId) {
      for (const phone of phones) {
        const match = findByPhone.get(phone) as { contact_id: number } | undefined;
        if (match) { contactId = match.contact_id; break; }
      }
    }

    // By name
    if (!contactId) {
      const match = findByName.get(displayName) as { id: number } | undefined;
      if (match) contactId = match.id;
    }

    if (!contactId) { skipped++; continue; }

    // Link emails to existing contact
    for (const email of emails) {
      insertEmail.run(contactId, email);
    }
    linked++;

    if (linked <= 10) console.log(`  ${displayName} -> contact ${contactId} (${emails.join(", ")})`);
  }

  db.close();
  console.log(`\nGoogle Contacts: ${linked} linked emails, ${skipped} skipped`);
  logImport("google_contacts", linked);
}

if (import.meta.main) {
  importGoogleContacts();
}
