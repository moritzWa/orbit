import { Database } from "@db/sqlite";
import { getDb, logImport } from "./db.ts";

const IMESSAGE_DB = `${Deno.env.get("HOME")}/Library/Messages/chat.db`;

function extractTextFromAttributedBody(blob: Uint8Array | null): string | null {
  if (!blob || blob.length < 20) return null;
  try {
    // Find "NSString" marker followed by preamble bytes
    const marker = [0x4E, 0x53, 0x53, 0x74, 0x72, 0x69, 0x6E, 0x67]; // "NSString"
    let pos = -1;
    for (let i = 0; i < blob.length - 15; i++) {
      if (marker.every((b, j) => blob[i + j] === b)) {
        pos = i + marker.length;
        break;
      }
    }
    if (pos === -1) return null;

    // Skip preamble bytes (typically 5-6 bytes: \x01\x94\x84\x01+ or similar)
    // Find the length indicator after preamble
    pos += 5; // skip standard preamble
    if (pos >= blob.length) return null;

    // Read length
    let textLength: number;
    if (blob[pos] === 0x81) {
      // 3-byte length: 0x81 followed by 2 bytes little-endian
      if (pos + 2 >= blob.length) return null;
      textLength = blob[pos + 1] | (blob[pos + 2] << 8);
      pos += 3;
    } else {
      // 1-byte length
      textLength = blob[pos];
      pos += 1;
    }

    if (textLength <= 0 || pos + textLength > blob.length) return null;

    const text = new TextDecoder("utf-8", { fatal: false }).decode(blob.slice(pos, pos + textLength));
    return text.trim() || null;
  } catch { /* ignore */ }
  return null;
}

export function importIMessages() {
  const crm = getDb();
  const imessageDb = new Database(IMESSAGE_DB, { readonly: true });

  const lastImported = crm.prepare(
    "SELECT MAX(imessage_rowid) as max_rowid FROM messages WHERE source = 'imessage' OR source IS NULL"
  ).get() as { max_rowid: number | null } | undefined;
  const sinceRowId = lastImported?.max_rowid ?? 0;

  const rows = imessageDb.prepare(`
    SELECT
      m.ROWID,
      m.text,
      m.attributedBody,
      m.is_from_me,
      datetime(m.date / 1000000000 + 978307200, 'unixepoch') as date_iso,
      c.chat_identifier as handle_id
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE m.ROWID > ?
      AND (c.chat_identifier LIKE '%@%' OR c.chat_identifier LIKE '+%')
    ORDER BY m.ROWID ASC
  `).all(sinceRowId) as Array<{
    ROWID: number;
    text: string | null;
    attributedBody: Uint8Array | null;
    is_from_me: number;
    date_iso: string;
    handle_id: string;
  }>;

  let newMessages = 0;
  let extractedFromBody = 0;

  const insertMessage = crm.prepare(`
    INSERT OR IGNORE INTO messages (imessage_rowid, handle, text, is_from_me, date, source)
    VALUES (?, ?, ?, ?, ?, 'imessage')
  `);

  const transaction = crm.transaction(() => {
    for (const row of rows) {
      let text = row.text;
      if (!text && row.attributedBody) {
        text = extractTextFromAttributedBody(row.attributedBody);
        if (text) extractedFromBody++;
      }
      insertMessage.run(row.ROWID, row.handle_id, text, row.is_from_me, row.date_iso);
      newMessages++;
    }
  });

  transaction();

  imessageDb.close();
  crm.close();

  console.log(`Imported ${newMessages} new messages (since rowid ${sinceRowId}), ${extractedFromBody} extracted from attributedBody`);
  logImport("imessage", newMessages);
}

if (import.meta.main) {
  importIMessages();
}
