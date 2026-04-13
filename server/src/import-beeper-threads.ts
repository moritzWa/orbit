import { Database } from "@db/sqlite";
import { getDb } from "./db.ts";

const BEEPER_DB = `${Deno.env.get("HOME")}/Library/Application Support/BeeperTexts/index.db`;

export function importBeeperThreads() {
  const crm = getDb();
  const beeper = new Database(BEEPER_DB, { readonly: true });

  // Get all single threads with phone numbers
  const threads = beeper.prepare(`
    SELECT t.threadID, t.accountID, pi.identifier as phone
    FROM threads t
    JOIN participants p ON p.room_id = t.threadID AND p.account_id = t.accountID
    JOIN participant_identifiers pi ON pi.participant_id = p.id AND pi.account_id = t.accountID
    WHERE json_extract(t.thread, '$.type') = 'single'
    AND p.is_self = 0
    AND pi.identifier_type = 'phone'
  `).all() as Array<{ threadID: string; accountID: string; phone: string }>;

  const normalizePhone = (p: string) => {
    let d = p.replace(/[^\d+]/g, "");
    if (!d.startsWith("+") && d.length >= 10) d = "+" + d;
    return d;
  };

  const findContact = crm.prepare("SELECT contact_id FROM contact_phones WHERE phone = ? LIMIT 1");
  const updateBeeper = crm.prepare("UPDATE contacts SET beeper_thread_url = ?, updated_at = datetime('now') WHERE id = ? AND beeper_thread_url IS NULL");

  let linked = 0;

  for (const t of threads) {
    const normalized = normalizePhone(t.phone);
    const match = findContact.get(normalized) as { contact_id: number } | undefined;
    if (!match) continue;

    // Build beeper:// URL based on account type
    let prefix: string;
    if (t.accountID.startsWith("imessage")) {
      prefix = `imessage/imsg##${t.threadID}`;
    } else if (t.accountID === "whatsapp") {
      prefix = `bridge-whatsapp/${t.threadID}`;
    } else {
      prefix = `${t.accountID}/${t.threadID}`;
    }

    const url = `beeper://select-thread/${prefix}?accountID=${t.accountID}`;
    updateBeeper.run(url, match.contact_id);
    linked++;
  }

  beeper.close();
  crm.close();
  console.log(`Linked ${linked} Beeper threads to contacts (out of ${threads.length} threads)`);
}

if (import.meta.main) {
  importBeeperThreads();
}
