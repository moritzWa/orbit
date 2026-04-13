import { getDb } from "./db.ts";

const PHOTOS_DIR = new URL("../../exports/contact-photos", import.meta.url).pathname;

const db = getDb();

// Find contacts with external URLs (not local /photos/ paths)
const contacts = db.prepare(`
  SELECT id, display_name, profile_picture_url
  FROM contacts
  WHERE profile_picture_url IS NOT NULL
    AND profile_picture_url NOT LIKE '/photos/%'
`).all() as Array<{ id: number; display_name: string; profile_picture_url: string }>;

console.log(`Found ${contacts.length} contacts with external photo URLs to download`);

let downloaded = 0;
let failed = 0;

for (const c of contacts) {
  try {
    const res = await fetch(c.profile_picture_url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = new Uint8Array(await res.arrayBuffer());
    const filename = `${c.id}.jpg`;
    Deno.writeFileSync(`${PHOTOS_DIR}/${filename}`, data);
    const localUrl = `/photos/${filename}`;
    db.prepare("UPDATE contacts SET profile_picture_url = ?, updated_at = datetime('now') WHERE id = ?").run(localUrl, c.id);
    downloaded++;
    console.log(`  ${c.display_name}: downloaded`);
  } catch (e) {
    failed++;
    console.log(`  ${c.display_name}: failed (${(e as Error).message})`);
  }
  // Rate limit
  await new Promise((r) => setTimeout(r, 100));
}

db.close();
console.log(`Done: ${downloaded} downloaded, ${failed} failed`);
