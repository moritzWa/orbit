import { Database } from "@db/sqlite";
import { getDb, logImport } from "./db.ts";

const CALL_DB = `${Deno.env.get("HOME")}/Library/Application Support/CallHistoryDB/CallHistory.storedata`;

export function importCallHistory() {
  const crm = getDb();

  let callDb: Database;
  try {
    callDb = new Database(CALL_DB, { readonly: true });
  } catch (e) {
    console.error(`Cannot open call history db: ${(e as Error).message}`);
    return;
  }

  // We store calls as messages with source='call' so they show in the timeline
  const lastImported = crm.prepare(
    "SELECT MAX(date) as max_date FROM messages WHERE source = 'call'"
  ).get() as { max_date: string | null } | undefined;
  const sinceDate = lastImported?.max_date ?? "2000-01-01";

  const rows = callDb.prepare(`
    SELECT
      h.ZVALUE as phone,
      c.ZDURATION as duration,
      c.ZORIGINATED as is_outgoing,
      c.ZANSWERED as answered,
      datetime(c.ZDATE + 978307200, 'unixepoch') as call_date
    FROM ZCALLRECORD c
    JOIN Z_2REMOTEPARTICIPANTHANDLES z ON z.Z_2REMOTEPARTICIPANTCALLS = c.Z_PK
    JOIN ZHANDLE h ON h.Z_PK = z.Z_4REMOTEPARTICIPANTHANDLES
    WHERE datetime(c.ZDATE + 978307200, 'unixepoch') > ?
    ORDER BY c.ZDATE ASC
  `).all(sinceDate) as Array<{
    phone: string;
    duration: number;
    is_outgoing: number;
    answered: number;
    call_date: string;
  }>;

  let imported = 0;

  const insertCall = crm.prepare(`
    INSERT OR IGNORE INTO messages (handle, text, is_from_me, date, source)
    VALUES (?, ?, ?, ?, 'call')
  `);

  const transaction = crm.transaction(() => {
    for (const row of rows) {
      const mins = Math.floor(row.duration / 60);
      const secs = Math.floor(row.duration % 60);
      const durationStr = row.duration > 0 ? `${mins}m ${secs}s` : "";

      let text: string;
      if (!row.answered) {
        text = row.is_outgoing ? `📞 Outgoing call (no answer)` : `📞 Missed call`;
      } else if (row.duration > 0) {
        text = row.is_outgoing
          ? `📞 Outgoing call (${durationStr})`
          : `📞 Incoming call (${durationStr})`;
      } else {
        text = row.is_outgoing ? `📞 Outgoing call` : `📞 Incoming call`;
      }

      insertCall.run(row.phone, text, row.is_outgoing, row.call_date);
      imported++;
    }
  });

  transaction();

  // Link calls to contacts by phone
  const unlinked = crm.prepare(`
    SELECT DISTINCT handle FROM messages WHERE source = 'call' AND contact_id IS NULL
  `).all() as Array<{ handle: string }>;

  let linked = 0;
  const normalizePhone = (p: string) => {
    let d = p.replace(/[^\d+]/g, "");
    if (!d.startsWith("+") && d.length >= 10) d = "+" + d;
    return d;
  };
  const findContact = crm.prepare("SELECT contact_id FROM contact_phones WHERE phone = ? LIMIT 1");
  const linkMessages = crm.prepare("UPDATE messages SET contact_id = ? WHERE handle = ? AND source = 'call'");

  const linkTransaction = crm.transaction(() => {
    for (const { handle } of unlinked) {
      const match = findContact.get(normalizePhone(handle)) as { contact_id: number } | undefined;
      if (match) {
        linkMessages.run(match.contact_id, handle);
        linked++;
      }
    }
  });

  linkTransaction();

  // Update last_contacted for contacts with calls
  crm.exec(`
    UPDATE contacts SET
      last_contacted = (
        SELECT MAX(date) FROM messages WHERE messages.contact_id = contacts.id
      ),
      updated_at = datetime('now')
    WHERE id IN (
      SELECT DISTINCT contact_id FROM messages WHERE source = 'call' AND contact_id IS NOT NULL
    )
  `);

  callDb.close();
  crm.close();

  console.log(`Calls: ${imported} imported, ${linked} linked to contacts`);
  logImport("call_history", imported);
}

if (import.meta.main) {
  importCallHistory();
}
