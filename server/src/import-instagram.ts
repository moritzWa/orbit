import { getDb, logImport } from "./db.ts";

const IG_EXPORT_DIR = "/tmp/ig_export";

function fixEncoding(s: string): string {
  try {
    if (!/[\u00c0-\u00ff]/.test(s)) return s;
    const bytes = new Uint8Array(s.split("").map((c) => c.charCodeAt(0) & 0xff));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

function extractUsername(url: string): string | null {
  // Extract username from instagram.com/username/... or instagram.com/stories/username/...
  const match = url.match(/instagram\.com\/(?:stories\/)?([^/?]+)/);
  if (match && !["reel", "p", "tv"].includes(match[1])) return match[1];
  // For reels/posts, try to get from the path differently
  return null;
}

export function importInstagram(limit?: number) {
  const db = getDb();

  const findByName = db.prepare("SELECT id FROM contacts WHERE display_name = ? AND archived = 0 LIMIT 1");
  const findByIg = db.prepare("SELECT id FROM contacts WHERE ig_username = ? LIMIT 1");
  const findRedirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'instagram' AND source_id = ?");
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (handle, text, is_from_me, date, source, contact_id)
    VALUES (?, ?, ?, ?, 'instagram', ?)
  `);

  // Helper to find contact by IG username with merge redirect fallback
  function findContact(igUsername: string, displayName?: string): number | null {
    // 1. By ig_username column
    const byIg = findByIg.get(igUsername) as { id: number } | undefined;
    if (byIg) return byIg.id;

    // 2. Check merge redirects
    const redirect = findRedirect.get(igUsername) as { target_contact_id: number } | undefined;
    if (redirect) return redirect.target_contact_id;

    // 3. By display name
    if (displayName) {
      const byName = findByName.get(displayName) as { id: number } | undefined;
      if (byName) {
        // Store ig_username on matched contact
        db.prepare("UPDATE contacts SET ig_username = COALESCE(ig_username, ?), updated_at = datetime('now') WHERE id = ?")
          .run(igUsername, byName.id);
        return byName.id;
      }
    }

    return null;
  }

  // --- Phase 1: Import DMs ---
  const inboxDir = `${IG_EXPORT_DIR}/your_instagram_activity/messages/inbox`;
  let conversations = 0;
  let messagesImported = 0;
  let matched = 0;
  let skipped = 0;

  try {
    const dirs = [...Deno.readDirSync(inboxDir)]
      .filter((e) => e.isDirectory)
      .map((e) => e.name);

    for (const dir of dirs) {
      if (limit && conversations >= limit) break;

      const msgPath = `${inboxDir}/${dir}/message_1.json`;
      try { Deno.statSync(msgPath); } catch { continue; }

      const data = JSON.parse(Deno.readTextFileSync(msgPath));
      const participants = data.participants
        .map((p: { name: string }) => fixEncoding(p.name))
        .filter((n: string) => n !== "Moritz Wallawitsch");

      // Skip group chats
      if (participants.length !== 1) continue;

      const participantName = participants[0];
      const igUsername = dir.split("_").slice(0, -1).join("_");

      const contactId = findContact(igUsername, participantName);
      if (!contactId) { skipped++; conversations++; continue; }

      matched++;
      const handle = `ig:${igUsername}`;

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
          text = msg.share.link ? `Shared: ${msg.share.link}` : "(shared post)";
        }

        if (msg.reactions) {
          for (const r of msg.reactions) {
            const reactor = fixEncoding(r.actor);
            const emoji = fixEncoding(r.reaction);
            const reactIsFromMe = reactor === "Moritz Wallawitsch" ? 1 : 0;
            insertMessage.run(handle, `${emoji} reacted to "${(text ?? "").slice(0, 50)}"`, reactIsFromMe, date, contactId);
          }
        }

        insertMessage.run(handle, text, isFromMe, date, contactId);
        messagesImported++;
      }

      conversations++;
      if (conversations <= 10) {
        console.log(`  DM: ${participantName} (@${igUsername}) -> contact ${contactId}`);
      }
      if (conversations % 50 === 0) console.log(`  Processed ${conversations} DMs...`);
    }
  } catch (e) {
    console.error("DM import error:", (e as Error).message);
  }

  // --- Phase 2: Import liked posts ---
  let likesImported = 0;
  try {
    const likesPath = `${IG_EXPORT_DIR}/your_instagram_activity/likes/liked_posts.json`;
    const likes = JSON.parse(Deno.readTextFileSync(likesPath));

    for (const like of likes) {
      // Extract username from nested Owner dict
      let username: string | null = null;
      for (const lv of like.label_values ?? []) {
        if (lv.dict) {
          for (const d of lv.dict) {
            for (const entry of d.dict ?? []) {
              if (entry.label === "Username") username = entry.value;
            }
          }
        }
      }
      if (!username) continue;

      const contactId = findContact(username);
      if (!contactId) continue;

      const date = new Date(like.timestamp * 1000).toISOString().replace("T", " ").slice(0, 19);
      insertMessage.run(`ig:${username}`, `❤️ Liked their post`, 1, date, contactId);
      likesImported++;
    }
    console.log(`  Liked posts: ${likesImported} imported`);
  } catch (e) {
    console.error("Likes import error:", (e as Error).message);
  }

  // --- Phase 3: Import story likes ---
  let storyLikesImported = 0;
  try {
    const storyPath = `${IG_EXPORT_DIR}/your_instagram_activity/story_interactions/story_likes.json`;
    const storyLikes = JSON.parse(Deno.readTextFileSync(storyPath)) as Array<{
      timestamp: number;
      label_values?: Array<{ label: string; value: string }>;
    }>;

    for (const like of storyLikes) {
      let username: string | null = null;
      for (const lv of like.label_values ?? []) {
        if (lv.dict) {
          for (const d of lv.dict) {
            for (const entry of d.dict ?? []) {
              if (entry.label === "Username") username = entry.value;
            }
          }
        }
      }
      if (!username) continue;

      const contactId = findContact(username);
      if (!contactId) continue;

      const date = new Date(like.timestamp * 1000).toISOString().replace("T", " ").slice(0, 19);
      insertMessage.run(`ig:${username}`, `⭐ Liked their story`, 1, date, contactId);
      storyLikesImported++;
    }
    console.log(`  Story likes: ${storyLikesImported} imported`);
  } catch (e) {
    console.error("Story likes import error:", (e as Error).message);
  }

  // Update message counts
  db.exec(`
    UPDATE contacts SET
      message_count = (SELECT COUNT(*) FROM messages WHERE messages.contact_id = contacts.id),
      last_contacted = (SELECT MAX(date) FROM messages WHERE messages.contact_id = contacts.id),
      updated_at = datetime('now')
    WHERE id IN (SELECT DISTINCT contact_id FROM messages WHERE source = 'instagram' AND contact_id IS NOT NULL)
  `);

  db.close();
  const total = messagesImported + likesImported + storyLikesImported;
  console.log(`\nIG import: ${matched} DM matches, ${skipped} skipped, ${total} total items (${messagesImported} msgs, ${likesImported} post likes, ${storyLikesImported} story likes)`);
  logImport("instagram", total);
}

if (import.meta.main) {
  const limit = Deno.args[0] ? parseInt(Deno.args[0]) : undefined;
  importInstagram(limit);
}
