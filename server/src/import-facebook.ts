import { getDb, logImport } from "./db.ts";

const FB_EXPORT_DIR = "/tmp/fb_export";

// Same mojibake fix as Instagram (Facebook uses the same encoding)
function fixEncoding(s: string): string {
  try {
    if (!/[\u00c0-\u00ff]/.test(s)) return s;
    const bytes = new Uint8Array(s.split("").map((c) => c.charCodeAt(0) & 0xff));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

export function importFacebook() {
  const db = getDb();

  const findByName = db.prepare("SELECT id FROM contacts WHERE display_name = ? AND archived = 0 LIMIT 1");
  const findByFbName = db.prepare("SELECT id FROM contacts WHERE fb_name = ? LIMIT 1");
  const findRedirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'facebook' AND source_id = ?");
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (handle, text, is_from_me, date, source, contact_id)
    VALUES (?, ?, ?, ?, 'facebook', ?)
  `);
  const insertTag = db.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)");

  function findContact(fbName: string, folderName?: string): number | null {
    // 1. By fb_name column
    const byFb = findByFbName.get(fbName) as { id: number } | undefined;
    if (byFb) return byFb.id;

    // 2. Check merge redirects (using folder name as stable ID)
    if (folderName) {
      const redirect = findRedirect.get(folderName) as { target_contact_id: number } | undefined;
      if (redirect) return redirect.target_contact_id;
    }

    // 3. By display name
    const byName = findByName.get(fbName) as { id: number } | undefined;
    if (byName) {
      db.prepare("UPDATE contacts SET fb_name = COALESCE(fb_name, ?), updated_at = datetime('now') WHERE id = ?")
        .run(fbName, byName.id);
      return byName.id;
    }

    return null;
  }

  // --- Phase 1: Import friends list ---
  let friendsMatched = 0;
  let friendsSkipped = 0;
  try {
    const friends = JSON.parse(Deno.readTextFileSync(`${FB_EXPORT_DIR}/connections/friends/your_friends.json`));
    const friendsList = friends.friends_v2 ?? [];
    console.log(`Friends list: ${friendsList.length}`);

    for (const f of friendsList) {
      const name = fixEncoding(f.name);
      const contactId = findContact(name);
      if (contactId) {
        insertTag.run(contactId, "fb-friend");
        friendsMatched++;
      } else {
        friendsSkipped++;
      }
    }
    console.log(`  Friends: ${friendsMatched} matched, ${friendsSkipped} skipped`);
  } catch (e) {
    console.error("Friends import error:", (e as Error).message);
  }

  // --- Phase 2: Import DMs ---
  let conversations = 0;
  let messagesImported = 0;
  let dmMatched = 0;
  let dmSkipped = 0;

  // Process both e2ee_cutover and inbox folders
  for (const subdir of ["e2ee_cutover", "inbox"]) {
    const msgDir = `${FB_EXPORT_DIR}/your_facebook_activity/messages/${subdir}`;
    let dirs: string[] = [];
    try {
      dirs = [...Deno.readDirSync(msgDir)].filter((e) => e.isDirectory).map((e) => e.name);
    } catch { continue; }

    for (const dir of dirs) {
      const msgPath = `${msgDir}/${dir}/message_1.json`;
      try { Deno.statSync(msgPath); } catch { continue; }

      const data = JSON.parse(Deno.readTextFileSync(msgPath));
      const participants = data.participants
        .map((p: { name: string }) => fixEncoding(p.name))
        .filter((n: string) => n !== "Moritz Wallawitsch");

      // Skip group chats
      if (participants.length !== 1) continue;

      const participantName = participants[0];
      const contactId = findContact(participantName, dir);
      if (!contactId) { dmSkipped++; continue; }

      dmMatched++;
      const handle = `fb:${dir}`;

      for (const msg of data.messages) {
        const senderName = fixEncoding(msg.sender_name);
        const isFromMe = senderName === "Moritz Wallawitsch" ? 1 : 0;
        const date = new Date(msg.timestamp_ms).toISOString().replace("T", " ").slice(0, 19);

        let text: string | null = null;
        if (msg.content) {
          text = fixEncoding(msg.content);
        } else if (msg.photos) {
          text = "(photo)";
        } else if (msg.videos) {
          text = "(video)";
        } else if (msg.audio_files) {
          text = "(audio)";
        } else if (msg.share) {
          text = msg.share?.link ? `Shared: ${msg.share.link}` : "(shared post)";
        } else if (msg.sticker) {
          text = "(sticker)";
        }

        insertMessage.run(handle, text, isFromMe, date, contactId);
        messagesImported++;
      }

      conversations++;
      if (conversations <= 10) {
        console.log(`  DM: ${participantName} (${subdir}/${dir}) -> contact ${contactId}`);
      }
      if (conversations % 50 === 0) console.log(`  Processed ${conversations} DMs...`);
    }
  }

  // Update message counts
  db.exec(`
    UPDATE contacts SET
      message_count = (SELECT COUNT(*) FROM messages WHERE messages.contact_id = contacts.id),
      last_contacted = (SELECT MAX(date) FROM messages WHERE messages.contact_id = contacts.id),
      updated_at = datetime('now')
    WHERE id IN (SELECT DISTINCT contact_id FROM messages WHERE source = 'facebook' AND contact_id IS NOT NULL)
  `);

  db.close();
  console.log(`\nFB import: ${friendsMatched} friends matched, ${dmMatched} DM matches, ${dmSkipped} DM skipped, ${messagesImported} messages from ${conversations} conversations`);
  logImport("facebook", messagesImported);
}

if (import.meta.main) {
  importFacebook();
}
