import { parse } from "@std/csv";
import { getDb, logImport } from "./db.ts";

const EXPORTS_DIR = new URL("../../exports", import.meta.url).pathname;
const PHOTOS_DIR = new URL("../../exports/contact-photos", import.meta.url).pathname;

export async function importX(limit?: number) {
  const followersCsv = findCsv("Followers");
  const followingCsv = findCsv("Following");

  const db = getDb();

  // Build sets of usernames from each file
  const followerUsernames = new Set<string>();
  const followingUsernames = new Set<string>();

  if (followersCsv) {
    for (const row of parseCsv(followersCsv)) {
      if (row["Username"]) followerUsernames.add(row["Username"].trim().toLowerCase());
    }
  }
  if (followingCsv) {
    for (const row of parseCsv(followingCsv)) {
      if (row["Username"]) followingUsernames.add(row["Username"].trim().toLowerCase());
    }
  }

  const mutuals = new Set([...followerUsernames].filter((u) => followingUsernames.has(u)));
  console.log(`Followers: ${followerUsernames.size}, Following: ${followingUsernames.size}, Mutuals: ${mutuals.size}`);

  const findByName = db.prepare("SELECT id FROM contacts WHERE display_name = ? AND archived = 0 LIMIT 1");
  const findByXUsername = db.prepare("SELECT id FROM contacts WHERE x_username = ? LIMIT 1");
  const findRedirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'x' AND source_id = ?");
  const updateX = db.prepare("UPDATE contacts SET x_username = COALESCE(x_username, ?), updated_at = datetime('now') WHERE id = ?");
  const insertContact = db.prepare(`
    INSERT INTO contacts (first_name, last_name, display_name, organization, x_username)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertTag = db.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)");

  let matched = 0;
  let created = 0;
  let skipped = 0;
  let picsDownloaded = 0;

  // Process all records from both files (deduped by username)
  const allRecords = new Map<string, Record<string, string>>();
  if (followersCsv) for (const row of parseCsv(followersCsv)) {
    const u = (row["Username"] ?? "").trim().toLowerCase();
    if (u) allRecords.set(u, row);
  }
  if (followingCsv) for (const row of parseCsv(followingCsv)) {
    const u = (row["Username"] ?? "").trim().toLowerCase();
    if (u && !allRecords.has(u)) allRecords.set(u, row);
  }

  let count = 0;
  for (const [username, row] of allRecords) {
    if (limit && count >= limit) break;

    const name = (row["Name"] ?? "").trim();
    const avatarUrl = (row["Avatar URL"] ?? "").trim();
    const bio = (row["Bio"] ?? "").trim();

    if (!name || !username) { skipped++; count++; continue; }

    // Determine relationship
    const isFollower = followerUsernames.has(username);
    const isFollowing = followingUsernames.has(username);
    const isMutual = isFollower && isFollowing;

    // Try to match existing contact
    let contactId: number | null = null;
    const byUsername = findByXUsername.get(username) as { id: number } | undefined;
    if (byUsername) {
      contactId = byUsername.id;
    } else {
      const redirect = findRedirect.get(username) as { target_contact_id: number } | undefined;
      if (redirect) {
        contactId = redirect.target_contact_id;
      } else {
        const byName = findByName.get(name) as { id: number } | undefined;
        if (byName) contactId = byName.id;
      }
    }

    if (contactId) {
      // Link existing contact
      updateX.run(username, contactId);
      matched++;
    } else {
      // Create new contact
      const parts = name.split(" ");
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || null;
      insertContact.run(firstName, lastName, name, bio || null, username);
      contactId = db.lastInsertRowId;
      created++;
    }

    // Tag relationship
    if (isFollower) insertTag.run(contactId, "x-follower");
    if (isFollowing) insertTag.run(contactId, "x-following");
    if (isMutual) insertTag.run(contactId, "x-mutual");

    // Download profile pic if missing
    const existing = db.prepare("SELECT profile_picture_url FROM contacts WHERE id = ?").get(contactId) as { profile_picture_url: string | null };
    if (!existing.profile_picture_url && avatarUrl) {
      try {
        const res = await fetch(avatarUrl);
        if (res.ok) {
          const data = new Uint8Array(await res.arrayBuffer());
          const filename = `${contactId}.jpg`;
          Deno.writeFileSync(`${PHOTOS_DIR}/${filename}`, data);
          db.prepare("UPDATE contacts SET profile_picture_url = ? WHERE id = ?").run(`/photos/${filename}`, contactId);
          picsDownloaded++;
        }
      } catch { /* skip */ }
    }

    count++;
    if (count % 100 === 0) console.log(`  Processed ${count}...`);
  }

  db.close();
  console.log(`\nX import: ${matched} matched, ${created} created, ${skipped} skipped, ${picsDownloaded} pics downloaded`);
  logImport("x", matched + created);
}

function parseCsv(path: string): Record<string, string>[] {
  const raw = Deno.readTextFileSync(path).replace(/^\uFEFF/, "");
  return parse(raw, { skipFirstRow: true }) as Record<string, string>[];
}

function findCsv(type: string): string | null {
  for (const dir of [EXPORTS_DIR, `${Deno.env.get("HOME")}/Downloads`]) {
    try {
      for (const entry of Deno.readDirSync(dir)) {
        if (entry.name.includes(type) && entry.name.endsWith(".csv") && entry.name.includes("twitter")) {
          return `${dir}/${entry.name}`;
        }
      }
    } catch { /* skip */ }
  }
  return null;
}

if (import.meta.main) {
  const limit = Deno.args[0] ? parseInt(Deno.args[0]) : undefined;
  await importX(limit);
}
