import { getDb, logImport } from "./db.ts";

const API_HOST = "instagram-api-fast-reliable-data-scraper.p.rapidapi.com";
const API_KEY = Deno.env.get("RAPIDAPI_KEY");
const IG_EXPORT_DIR = "/tmp/ig_export";
const PHOTOS_DIR = new URL("../../exports/contact-photos", import.meta.url).pathname;

if (!API_KEY) {
  console.error("Set RAPIDAPI_KEY in .env");
  Deno.exit(1);
}

interface IGProfile {
  pk: number;
  username: string;
  full_name: string;
  biography?: string;
  profile_pic_url?: string;
  follower_count?: number;
  following_count?: number;
  is_private?: boolean;
  is_verified?: boolean;
}

const API_HOST_V2 = "instagram-scraper-20251.p.rapidapi.com";

async function getProfileByUsername(username: string): Promise<IGProfile | null> {
  try {
    // Single call using the new API
    const res = await fetch(`https://${API_HOST_V2}/userinfo/?username_or_id=${username}`, {
      headers: {
        "x-rapidapi-key": API_KEY!,
        "x-rapidapi-host": API_HOST_V2,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429 || res.status === 402) {
      console.error(`  Rate limited (${res.status}). Stopping.`);
      Deno.exit(1);
    }
    if (!res.ok) {
      console.error(`  API ${res.status} for ${username}`);
      return null;
    }
    const body = await res.text();
    try {
      const parsed = JSON.parse(body);
      return parsed.data ?? parsed;
    } catch {
      console.error(`  Bad JSON for ${username}: ${body.slice(0, 100)}`);
      return null;
    }
  } catch (e) {
    console.error(`  Error fetching ${username}: ${(e as Error).message}`);
    return null;
  }
}

export async function enrichInstagram(limit: number) {
  const db = getDb();

  // Load followers/following from export
  const followerUsernames = new Set<string>();
  const followingUsernames = new Set<string>();

  try {
    const followers = JSON.parse(Deno.readTextFileSync(`${IG_EXPORT_DIR}/connections/followers_and_following/followers_1.json`));
    for (const f of followers) {
      const username = f.string_list_data?.[0]?.value;
      if (username) followerUsernames.add(username.toLowerCase());
    }
  } catch { /* skip */ }

  try {
    const following = JSON.parse(Deno.readTextFileSync(`${IG_EXPORT_DIR}/connections/followers_and_following/following.json`));
    for (const f of following.relationships_following ?? []) {
      const username = f.title;
      if (username) followingUsernames.add(username.toLowerCase());
    }
  } catch { /* skip */ }

  const allUsernames = new Set([...followerUsernames, ...followingUsernames]);
  const mutuals = new Set([...followerUsernames].filter((u) => followingUsernames.has(u)));
  console.log(`Followers: ${followerUsernames.size}, Following: ${followingUsernames.size}, Mutuals: ${mutuals.size}, Total unique: ${allUsernames.size}`);

  // Filter out already-imported usernames
  const findByIg = db.prepare("SELECT id FROM contacts WHERE ig_username = ? LIMIT 1");
  const findByName = db.prepare("SELECT id FROM contacts WHERE display_name = ? AND archived = 0 LIMIT 1");
  const findRedirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'instagram' AND source_id = ?");
  const updateIg = db.prepare("UPDATE contacts SET ig_username = COALESCE(ig_username, ?), updated_at = datetime('now') WHERE id = ?");
  const insertContact = db.prepare(`
    INSERT INTO contacts (first_name, last_name, display_name, organization, ig_username)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertTag = db.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)");

  // Prioritize people we follow (more likely real connections)
  const toEnrich: string[] = [];
  for (const username of followingUsernames) {
    const existing = findByIg.get(username) as { id: number } | undefined;
    if (!existing) toEnrich.push(username);
  }
  // Then followers we don't follow back
  for (const username of followerUsernames) {
    if (followingUsernames.has(username)) continue; // already added as following
    const existing = findByIg.get(username) as { id: number } | undefined;
    if (!existing) toEnrich.push(username);
  }
  console.log(`To enrich: ${toEnrich.length} (${toEnrich.length - allUsernames.size + toEnrich.length} already imported)`);

  let matched = 0;
  let created = 0;
  let skipped = 0;
  let picsDownloaded = 0;
  let apiCalls = 0;

  for (let i = 0; i < Math.min(toEnrich.length, limit); i++) {
    const username = toEnrich[i];
    const profile = await getProfileByUsername(username);
    apiCalls += 2;

    if (!profile) {
      skipped++;
      console.log(`  ${username}: skipped (API error)`);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (!profile.full_name) {
      skipped++;
      console.log(`  ${username}: skipped (no name set, private=${profile.is_private})`);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    const isFollower = followerUsernames.has(username);
    const isFollowing = followingUsernames.has(username);
    const isMutual = isFollower && isFollowing;

    // Try to match existing contact
    let contactId: number | null = null;

    const redirect = findRedirect.get(username) as { target_contact_id: number } | undefined;
    if (redirect) {
      contactId = redirect.target_contact_id;
    } else {
      const byName = findByName.get(profile.full_name) as { id: number } | undefined;
      if (byName) contactId = byName.id;
    }

    if (contactId) {
      updateIg.run(username, contactId);
      // Store IG data on existing contact
      db.prepare("UPDATE contacts SET ig_bio = ?, ig_raw_json = ?, ig_profile_pic_url = ?, updated_at = datetime('now') WHERE id = ?")
        .run(profile.biography?.slice(0, 500) || null, JSON.stringify(profile), profile.profile_pic_url || null, contactId);
      matched++;
      if (matched <= 10) console.log(`  Matched: ${profile.full_name} (@${username}) -> contact ${contactId}`);
    } else {
      const parts = profile.full_name.split(" ");
      const firstName = parts[0];
      const lastName = parts.slice(1).join(" ") || null;
      insertContact.run(firstName, lastName, profile.full_name, profile.biography?.slice(0, 200) || null, username);
      contactId = db.lastInsertRowId;
      // Store full IG data on new contact
      db.prepare("UPDATE contacts SET ig_bio = ?, ig_raw_json = ?, ig_profile_pic_url = ?, updated_at = datetime('now') WHERE id = ?")
        .run(profile.biography?.slice(0, 500) || null, JSON.stringify(profile), profile.profile_pic_url || null, contactId);
      created++;
      if (created <= 10) console.log(`  Created: ${profile.full_name} (@${username}) -> contact ${contactId}`);
    }

    // Tag relationship
    if (isFollower) insertTag.run(contactId, "ig-follower");
    if (isFollowing) insertTag.run(contactId, "ig-following");
    if (isMutual) insertTag.run(contactId, "ig-mutual");

    // Download profile pic if missing
    const existing = db.prepare("SELECT profile_picture_url FROM contacts WHERE id = ?").get(contactId) as { profile_picture_url: string | null };
    if (!existing.profile_picture_url && profile.profile_pic_url) {
      try {
        const picRes = await fetch(profile.profile_pic_url);
        if (picRes.ok) {
          const data = new Uint8Array(await picRes.arrayBuffer());
          Deno.writeFileSync(`${PHOTOS_DIR}/${contactId}.jpg`, data);
          db.prepare("UPDATE contacts SET profile_picture_url = ? WHERE id = ?").run(`/photos/${contactId}.jpg`, contactId);
          picsDownloaded++;
        }
      } catch { /* skip */ }
    }

    if ((i + 1) % 10 === 0) console.log(`  Progress: ${i + 1}/${Math.min(toEnrich.length, limit)} (${apiCalls} API calls)`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  db.close();
  console.log(`\nIG enrich: ${matched} matched, ${created} created, ${skipped} skipped, ${picsDownloaded} pics, ${apiCalls} API calls used`);
  logImport("instagram_enrich", matched + created);
}

if (import.meta.main) {
  const limit = parseInt(Deno.args[0] ?? "5");
  await enrichInstagram(limit);
}
