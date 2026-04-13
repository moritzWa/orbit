import { Database } from "@db/sqlite";
import { getDb, logImport } from "./db.ts";

const WA_DIR = `${Deno.env.get("HOME")}/Library/Group Containers/group.net.whatsapp.WhatsApp.shared`;
const WA_CHAT_DB = `${WA_DIR}/ChatStorage.sqlite`;
const WA_CONTACTS_DB = `${WA_DIR}/ContactsV2.sqlite`;

// WhatsApp uses Apple epoch in seconds (not nanoseconds like iMessage)
const APPLE_EPOCH_OFFSET = 978307200;

function waTimestampToISO(seconds: number): string {
  const unix = seconds + APPLE_EPOCH_OFFSET;
  return new Date(unix * 1000).toISOString();
}

function phoneFromJid(jid: string): string | null {
  const match = jid.match(/^(\d+)@s\.whatsapp\.net$/);
  return match ? `+${match[1]}` : null;
}

export function importWhatsApp() {
  const crm = getDb();

  // Add whatsapp source columns if not present
  try { crm.exec("ALTER TABLE messages ADD COLUMN source TEXT DEFAULT 'imessage'"); } catch { /* already exists */ }

  const chatDb = new Database(WA_CHAT_DB, { readonly: true });
  const contactsDb = new Database(WA_CONTACTS_DB, { readonly: true });

  // Build a name lookup from WhatsApp contacts
  const waContacts = contactsDb.prepare(`
    SELECT ZFULLNAME, ZPHONENUMBER, ZWHATSAPPID FROM ZWAADDRESSBOOKCONTACT
    WHERE ZFULLNAME IS NOT NULL
  `).all() as Array<{ ZFULLNAME: string; ZPHONENUMBER: string; ZWHATSAPPID: string }>;

  const nameByJid = new Map<string, string>();
  for (const c of waContacts) {
    if (c.ZWHATSAPPID) nameByJid.set(c.ZWHATSAPPID, c.ZFULLNAME);
  }

  // Also get names from chat sessions (for contacts not in address book)
  const chatSessions = chatDb.prepare(`
    SELECT ZCONTACTJID, ZPARTNERNAME FROM ZWACHATSESSION
    WHERE ZCONTACTJID LIKE '%@s.whatsapp.net' AND ZPARTNERNAME IS NOT NULL
  `).all() as Array<{ ZCONTACTJID: string; ZPARTNERNAME: string }>;

  for (const s of chatSessions) {
    if (!nameByJid.has(s.ZCONTACTJID)) {
      nameByJid.set(s.ZCONTACTJID, s.ZPARTNERNAME);
    }
  }

  contactsDb.close();

  // Find latest imported WhatsApp message
  const lastImported = crm.prepare(
    "SELECT MAX(date) as max_date FROM messages WHERE source = 'whatsapp'"
  ).get() as { max_date: string | null } | undefined;

  // Fetch 1:1 messages only (skip group chats for now)
  const messages = chatDb.prepare(`
    SELECT
      m.Z_PK,
      m.ZTEXT,
      m.ZISFROMME,
      m.ZMESSAGEDATE,
      m.ZFROMJID,
      m.ZTOJID,
      cs.ZCONTACTJID
    FROM ZWAMESSAGE m
    JOIN ZWACHATSESSION cs ON cs.Z_PK = m.ZCHATSESSION
    WHERE cs.ZCONTACTJID LIKE '%@s.whatsapp.net'
      AND m.ZMESSAGEDATE IS NOT NULL
    ORDER BY m.ZMESSAGEDATE ASC
  `).all() as Array<{
    Z_PK: number;
    ZTEXT: string | null;
    ZISFROMME: number;
    ZMESSAGEDATE: number;
    ZFROMJID: string | null;
    ZTOJID: string | null;
    ZCONTACTJID: string;
  }>;

  chatDb.close();

  let newMessages = 0;
  let newContacts = 0;
  let linked = 0;

  // Use a unique key for whatsapp messages: "wa_{Z_PK}"
  const insertMessage = crm.prepare(`
    INSERT OR IGNORE INTO messages (imessage_rowid, handle, text, is_from_me, date, source)
    VALUES (NULL, ?, ?, ?, ?, 'whatsapp')
  `);

  // Check for existing message to avoid duplicates (by handle + date + source)
  const checkExists = crm.prepare(
    "SELECT id FROM messages WHERE handle = ? AND date = ? AND source = 'whatsapp' LIMIT 1"
  );

  const findContactByPhone = crm.prepare("SELECT contact_id FROM contact_phones WHERE phone = ? LIMIT 1");
  const findContactByName = crm.prepare("SELECT id FROM contacts WHERE first_name = ? AND last_name = ? LIMIT 1");
  const insertContact = crm.prepare(`
    INSERT INTO contacts (first_name, last_name, display_name) VALUES (?, ?, ?)
  `);
  const insertPhone = crm.prepare("INSERT OR IGNORE INTO contact_phones (contact_id, phone, label) VALUES (?, ?, 'whatsapp')");

  const transaction = crm.transaction(() => {
    for (const msg of messages) {
      const dateISO = waTimestampToISO(msg.ZMESSAGEDATE);

      // Skip if before last import
      if (lastImported?.max_date && dateISO <= lastImported.max_date) continue;

      const jid = msg.ZCONTACTJID;
      const phone = phoneFromJid(jid);
      if (!phone) continue;

      const handle = `wa:${jid}`;

      // Check duplicate
      if (checkExists.get(handle, dateISO)) continue;

      insertMessage.run(handle, msg.ZTEXT, msg.ZISFROMME, dateISO);
      newMessages++;

      // Try to link to existing contact by phone
      const phoneMatch = findContactByPhone.get(phone) as { contact_id: number } | undefined;
      if (phoneMatch) {
        crm.prepare("UPDATE messages SET contact_id = ? WHERE handle = ? AND contact_id IS NULL").run(phoneMatch.contact_id, handle);
        linked++;
      } else {
        // Create contact from WhatsApp name
        const name = nameByJid.get(jid);
        if (name) {
          const parts = name.split(" ");
          const firstName = parts[0];
          const lastName = parts.slice(1).join(" ") || null;

          // Check if name already exists
          const nameMatch = (firstName && lastName)
            ? findContactByName.get(firstName, lastName) as { id: number } | undefined
            : undefined;

          if (nameMatch) {
            insertPhone.run(nameMatch.id, phone);
            crm.prepare("UPDATE messages SET contact_id = ? WHERE handle = ? AND contact_id IS NULL").run(nameMatch.id, handle);
            linked++;
          } else {
            insertContact.run(firstName, lastName, name);
            const newId = crm.lastInsertRowId;
            insertPhone.run(newId, phone);
            crm.prepare("UPDATE messages SET contact_id = ? WHERE handle = ?").run(newId, handle);
            newContacts++;
            linked++;
          }
        }
      }
    }
  });

  transaction();

  // Update message stats for affected contacts
  crm.exec(`
    UPDATE contacts SET
      message_count = COALESCE((SELECT COUNT(*) FROM messages WHERE messages.contact_id = contacts.id), 0),
      first_contacted = (SELECT MIN(date) FROM messages WHERE messages.contact_id = contacts.id),
      last_contacted = (SELECT MAX(date) FROM messages WHERE messages.contact_id = contacts.id),
      updated_at = datetime('now')
    WHERE id IN (SELECT DISTINCT contact_id FROM messages WHERE source = 'whatsapp' AND contact_id IS NOT NULL)
  `);

  crm.close();

  console.log(`WhatsApp: ${newMessages} new messages, ${newContacts} new contacts, ${linked} linked`);
  logImport("whatsapp", newMessages);
}

if (import.meta.main) {
  importWhatsApp();
}
