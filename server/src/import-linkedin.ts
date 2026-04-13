import { parse } from "@std/csv";
import { getDb } from "./db.ts";

const EXPORTS_DIR = "exports";

function findCsvFile(): string {
  // Find the most recent Connections.csv in exports/
  for (const entry of Deno.readDirSync(EXPORTS_DIR)) {
    if (entry.name.toLowerCase().includes("connections") && entry.name.endsWith(".csv")) {
      return `${EXPORTS_DIR}/${entry.name}`;
    }
  }
  throw new Error(`No Connections CSV found in ${EXPORTS_DIR}/. Download from LinkedIn and place it there.`);
}

function stripLinkedInNotes(content: string): string {
  // LinkedIn CSVs sometimes have notes/preamble before the header row
  const lines = content.split("\n");
  const headerIdx = lines.findIndex((l) =>
    l.includes("First Name") && l.includes("Last Name")
  );
  if (headerIdx > 0) {
    return lines.slice(headerIdx).join("\n");
  }
  return content;
}

export function importLinkedIn() {
  const csvPath = findCsvFile();
  console.log(`Reading ${csvPath}`);

  const raw = Deno.readTextFileSync(csvPath);
  const cleaned = stripLinkedInNotes(raw);
  const records = parse(cleaned, { skipFirstRow: true });

  const db = getDb();

  // Try to match by first+last name, then by email
  const findByName = db.prepare(
    "SELECT id FROM contacts WHERE first_name = ? AND last_name = ? LIMIT 1"
  );
  const findByEmail = db.prepare(
    "SELECT contact_id FROM contact_emails WHERE email = ? LIMIT 1"
  );
  const findRedirect = db.prepare(
    "SELECT target_contact_id FROM merge_redirects WHERE source = 'linkedin' AND source_id = ?"
  );
  const insertContact = db.prepare(`
    INSERT INTO contacts (first_name, last_name, organization, display_name, linkedin_url, linkedin_connected_on)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const updateLinkedIn = db.prepare(`
    UPDATE contacts SET
      linkedin_url = COALESCE(?, linkedin_url),
      linkedin_connected_on = COALESCE(?, linkedin_connected_on),
      organization = COALESCE(organization, ?),
      updated_at = datetime('now')
    WHERE id = ?
  `);
  const insertEmail = db.prepare(
    "INSERT OR IGNORE INTO contact_emails (contact_id, email, label) VALUES (?, ?, 'linkedin')"
  );

  let newContacts = 0;
  let merged = 0;
  let skipped = 0;

  const transaction = db.transaction(() => {
    for (const row of records) {
      const firstName = (row["First Name"] ?? "").trim();
      const lastName = (row["Last Name"] ?? "").trim();
      const email = (row["Email Address"] ?? "").trim().toLowerCase();
      const company = (row["Company"] ?? "").trim();
      const position = (row["Position"] ?? "").trim();
      const connectedOn = (row["Connected On"] ?? "").trim();
      const url = (row["URL"] ?? "").trim();

      if (!firstName && !lastName) { skipped++; continue; }

      const displayName = [firstName, lastName].filter(Boolean).join(" ");
      const org = [position, company].filter(Boolean).join(" at ") || null;

      // Try to find existing contact
      let contactId: number | null = null;

      // Match by email first (most reliable)
      if (email) {
        const emailMatch = findByEmail.get(email) as { contact_id: number } | undefined;
        if (emailMatch) contactId = emailMatch.contact_id;
      }

      // Then try merge redirect by LinkedIn URL
      if (!contactId && url) {
        const redirect = findRedirect.get(url) as { target_contact_id: number } | undefined;
        if (redirect) contactId = redirect.target_contact_id;
      }

      // Then try name match
      if (!contactId && firstName && lastName) {
        const nameMatch = findByName.get(firstName, lastName) as { id: number } | undefined;
        if (nameMatch) contactId = nameMatch.id;
      }

      if (contactId) {
        updateLinkedIn.run(url || null, connectedOn || null, org, contactId);
        if (email) insertEmail.run(contactId, email);
        merged++;
      } else {
        insertContact.run(firstName, lastName, org, displayName, url || null, connectedOn || null);
        const newId = db.lastInsertRowId;
        if (email) insertEmail.run(newId, email);
        newContacts++;
      }
    }
  });

  transaction();
  db.close();

  console.log(`LinkedIn: ${newContacts} new, ${merged} merged with existing, ${skipped} skipped`);
}

if (import.meta.main) {
  importLinkedIn();
}
