import { parse } from "@std/csv";
import { getDb, logImport } from "./db.ts";

const TWITTER_EXPORT_DIR = "/tmp/twitter_export";

export function importTwitterDMs() {
  const db = getDb();

  // Build ID → name/username map from the Chrome CSV exports
  const idToInfo = new Map<string, { name: string; username: string }>();
  const followingIds = new Set<string>();

  for (const type of ["Followers", "Following"]) {
    for (const dir of [`${Deno.env.get("HOME")}/Downloads`, "../../exports"]) {
      try {
        for (const entry of Deno.readDirSync(dir)) {
          if (entry.name.includes(type) && entry.name.includes("twitter") && entry.name.endsWith(".csv")) {
            const raw = Deno.readTextFileSync(`${dir}/${entry.name}`).replace(/^\uFEFF/, "");
            const records = parse(raw, { skipFirstRow: true }) as Record<string, string>[];
            for (const row of records) {
              const uid = Object.values(row)[0]?.trim();
              const name = (row["Name"] ?? "").trim();
              const username = (row["Username"] ?? "").trim();
              if (uid && name) {
                idToInfo.set(uid, { name, username });
                if (type === "Following") followingIds.add(uid);
              }
            }
          }
        }
      } catch { /* skip */ }
    }
  }

  console.log(`ID map: ${idToInfo.size} users, Following: ${followingIds.size}`);

  // Find my user ID
  let myId = "";
  const dmRaw = Deno.readTextFileSync(`${TWITTER_EXPORT_DIR}/data/direct-messages.js`);
  const dms = JSON.parse(dmRaw.slice(dmRaw.indexOf("[")));

  // Detect my ID from conversation IDs - the ID that appears most often
  const idCounts = new Map<string, number>();
  for (const conv of dms) {
    for (const part of conv.dmConversation.conversationId.split("-")) {
      idCounts.set(part, (idCounts.get(part) || 0) + 1);
    }
  }
  myId = [...idCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  console.log(`My ID: ${myId}`);

  const findByName = db.prepare("SELECT id FROM contacts WHERE display_name = ? AND archived = 0 LIMIT 1");
  const findByXUsername = db.prepare("SELECT id FROM contacts WHERE x_username = ? LIMIT 1");
  const findRedirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'x' AND source_id = ?");
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (handle, text, is_from_me, date, source, contact_id)
    VALUES (?, ?, ?, ?, 'twitter', ?)
  `);

  let conversations = 0;
  let messagesImported = 0;
  let skipped = 0;

  for (const conv of dms) {
    const c = conv.dmConversation;
    const parts = c.conversationId.split("-");
    const otherId = parts.find((p: string) => p !== myId);
    if (!otherId) continue;

    // Only import DMs with people I follow
    if (!followingIds.has(otherId)) { skipped++; continue; }

    const info = idToInfo.get(otherId);
    if (!info) { skipped++; continue; }

    // Find contact
    let contactId: number | null = null;
    const byUsername = findByXUsername.get(info.username) as { id: number } | undefined;
    if (byUsername) {
      contactId = byUsername.id;
    } else {
      const redirect = findRedirect.get(info.username) as { target_contact_id: number } | undefined;
      if (redirect) {
        contactId = redirect.target_contact_id;
      } else {
        const byName = findByName.get(info.name) as { id: number } | undefined;
        if (byName) contactId = byName.id;
      }
    }

    if (!contactId) { skipped++; continue; }

    const handle = `x:${info.username}`;
    for (const msg of c.messages) {
      const m = msg.messageCreate;
      if (!m) continue;
      const isFromMe = m.senderId === myId ? 1 : 0;
      const date = new Date(parseInt(m.createdAt)).toISOString().replace("T", " ").slice(0, 19);
      const text = m.text || "(media)";
      insertMessage.run(handle, text, isFromMe, date, contactId);
      messagesImported++;
    }

    conversations++;
    if (conversations <= 10) {
      console.log(`  ${info.name} (@${info.username}) -> contact ${contactId}: ${c.messages.length} msgs`);
    }
    if (conversations % 50 === 0) console.log(`  Processed ${conversations}...`);
  }

  // Update message counts
  db.exec(`
    UPDATE contacts SET
      message_count = (SELECT COUNT(*) FROM messages WHERE messages.contact_id = contacts.id),
      last_contacted = (SELECT MAX(date) FROM messages WHERE messages.contact_id = contacts.id),
      updated_at = datetime('now')
    WHERE id IN (SELECT DISTINCT contact_id FROM messages WHERE source = 'twitter' AND contact_id IS NOT NULL)
  `);

  db.close();
  console.log(`\nTwitter DMs: ${conversations} conversations, ${messagesImported} messages, ${skipped} skipped`);
  logImport("twitter_dms", messagesImported);
}

if (import.meta.main) {
  importTwitterDMs();
}
