import { Database } from "@db/sqlite";
import { getDb, logImport } from "./db.ts";

const CONTACTS_DIR = `${Deno.env.get("HOME")}/Library/Application Support/AddressBook/Sources`;

function findContactsDb(): string {
  // Find the source with actual contacts
  for (const entry of Deno.readDirSync(CONTACTS_DIR)) {
    if (!entry.isDirectory) continue;
    const dbPath = `${CONTACTS_DIR}/${entry.name}/AddressBook-v22.abcddb`;
    try {
      const db = new Database(dbPath, { readonly: true });
      const row = db.prepare("SELECT COUNT(*) as c FROM ZABCDRECORD WHERE ZFIRSTNAME IS NOT NULL").get() as { c: number };
      db.close();
      if (row.c > 0) return dbPath;
    } catch { /* skip */ }
  }
  throw new Error("No Apple Contacts database found with contacts");
}

function normalizePhone(phone: string): string {
  // Strip everything except digits and leading +
  let digits = phone.replace(/[^\d+]/g, "");
  // Ensure leading + for international numbers (10+ digits without +)
  if (!digits.startsWith("+") && digits.length >= 10) {
    digits = "+" + digits;
  }
  return digits;
}

export function importContacts() {
  const crm = getDb();
  const contactsDbPath = findContactsDb();
  const contactsDb = new Database(contactsDbPath, { readonly: true });

  console.log(`Reading from ${contactsDbPath}`);

  // Fetch all contacts with phones and emails
  const records = contactsDb.prepare(`
    SELECT Z_PK, ZFIRSTNAME, ZLASTNAME, ZORGANIZATION
    FROM ZABCDRECORD
  `).all() as Array<{
    Z_PK: number;
    ZFIRSTNAME: string | null;
    ZLASTNAME: string | null;
    ZORGANIZATION: string | null;
  }>;

  const phones = contactsDb.prepare(`
    SELECT ZOWNER, ZFULLNUMBER, ZLABEL
    FROM ZABCDPHONENUMBER
    WHERE ZFULLNUMBER IS NOT NULL
  `).all() as Array<{ ZOWNER: number; ZFULLNUMBER: string; ZLABEL: string | null }>;

  const emails = contactsDb.prepare(`
    SELECT ZOWNER, ZADDRESS, ZLABEL
    FROM ZABCDEMAILADDRESS
    WHERE ZADDRESS IS NOT NULL
  `).all() as Array<{ ZOWNER: number; ZADDRESS: string; ZLABEL: string | null }>;

  // Group phones and emails by owner
  const phonesByOwner = new Map<number, typeof phones>();
  for (const p of phones) {
    const list = phonesByOwner.get(p.ZOWNER) ?? [];
    list.push(p);
    phonesByOwner.set(p.ZOWNER, list);
  }

  const emailsByOwner = new Map<number, typeof emails>();
  for (const e of emails) {
    const list = emailsByOwner.get(e.ZOWNER) ?? [];
    list.push(e);
    emailsByOwner.set(e.ZOWNER, list);
  }

  contactsDb.close();

  let newContacts = 0;
  let updatedContacts = 0;
  let redirected = 0;

  const findRedirect = crm.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'apple' AND source_id = ?");
  const findByAppleId = crm.prepare("SELECT id, archived FROM contacts WHERE apple_contacts_id = ?");
  const insertContact = crm.prepare(`
    INSERT INTO contacts (first_name, last_name, organization, display_name, apple_contacts_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertPhone = crm.prepare("INSERT OR IGNORE INTO contact_phones (contact_id, phone, label) VALUES (?, ?, ?)");
  const insertEmail = crm.prepare("INSERT OR IGNORE INTO contact_emails (contact_id, email, label) VALUES (?, ?, ?)");

  const transaction = crm.transaction(() => {
    for (const rec of records) {
      const displayName = [rec.ZFIRSTNAME, rec.ZLASTNAME].filter(Boolean).join(" ") || rec.ZORGANIZATION || null;
      if (!displayName) continue; // skip nameless records

      let contactId: number;

      // 1. Check merge redirects - this apple_id was previously merged into another contact
      const redirect = findRedirect.get(String(rec.Z_PK)) as { target_contact_id: number } | undefined;
      if (redirect) {
        contactId = redirect.target_contact_id;
        redirected++;
        // Only add phones/emails, never overwrite name
      } else {
        // 2. Check if this apple_id already exists
        const existing = findByAppleId.get(rec.Z_PK) as { id: number; archived: number } | undefined;

        if (existing) {
          if (existing.archived) continue; // skip archived contacts entirely
          // Don't overwrite name - only update org if it was null
          crm.prepare("UPDATE contacts SET organization = COALESCE(organization, ?), updated_at = datetime('now') WHERE id = ?")
            .run(rec.ZORGANIZATION, existing.id);
          contactId = existing.id;
          updatedContacts++;
        } else {
          insertContact.run(rec.ZFIRSTNAME, rec.ZLASTNAME, rec.ZORGANIZATION, displayName, rec.Z_PK);
          contactId = crm.lastInsertRowId;
          newContacts++;
        }
      }

      // Add phones/emails (safe for all cases)
      for (const p of phonesByOwner.get(rec.Z_PK) ?? []) {
        insertPhone.run(contactId, normalizePhone(p.ZFULLNUMBER), p.ZLABEL);
      }
      for (const e of emailsByOwner.get(rec.Z_PK) ?? []) {
        insertEmail.run(contactId, e.ZADDRESS.toLowerCase(), e.ZLABEL);
      }
    }
  });

  transaction();

  // Now link messages to contacts by matching handles to phones/emails
  const unlinkedMessages = crm.prepare(`
    SELECT DISTINCT handle FROM messages WHERE contact_id IS NULL
  `).all() as Array<{ handle: string }>;

  let linked = 0;
  const findContactByPhone = crm.prepare("SELECT contact_id FROM contact_phones WHERE phone = ? LIMIT 1");
  const findContactByEmail = crm.prepare("SELECT contact_id FROM contact_emails WHERE email = ? LIMIT 1");
  const linkMessages = crm.prepare("UPDATE messages SET contact_id = ? WHERE handle = ?");

  const linkTransaction = crm.transaction(() => {
    for (const { handle } of unlinkedMessages) {
      let match: { contact_id: number } | undefined;

      if (handle.includes("@")) {
        match = findContactByEmail.get(handle.toLowerCase()) as { contact_id: number } | undefined;
      } else {
        match = findContactByPhone.get(normalizePhone(handle)) as { contact_id: number } | undefined;
      }

      if (match) {
        linkMessages.run(match.contact_id, handle);
        linked++;
      }
    }
  });

  linkTransaction();

  // Update contact message stats from linked messages
  crm.exec(`
    UPDATE contacts SET
      message_count = COALESCE((SELECT COUNT(*) FROM messages WHERE messages.contact_id = contacts.id), 0),
      first_contacted = COALESCE((SELECT MIN(date) FROM messages WHERE messages.contact_id = contacts.id), contacts.first_contacted),
      last_contacted = COALESCE((SELECT MAX(date) FROM messages WHERE messages.contact_id = contacts.id), contacts.last_contacted),
      updated_at = datetime('now')
    WHERE id IN (SELECT DISTINCT contact_id FROM messages WHERE contact_id IS NOT NULL)
  `);

  crm.close();

  console.log(`Contacts: ${newContacts} new, ${updatedContacts} updated, ${redirected} redirected (merged)`);
  logImport("apple_contacts", newContacts + updatedContacts);
  console.log(`Linked ${linked} message handles to contacts`);
}

if (import.meta.main) {
  importContacts();
}
