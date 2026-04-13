import { getDb } from "./db.ts";

const PHOTOS_DIR = new URL("../../exports/contact-photos", import.meta.url).pathname;

export function importContactPhotos() {
  const db = getDb();
  let matched = 0;
  let skipped = 0;

  for (const entry of Deno.readDirSync(PHOTOS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".jpg")) continue;

    // Filename is "First_Last.jpg" - convert to "First Last"
    const displayName = entry.name.replace(".jpg", "").replace(/_/g, " ").replace(/^\$/, "");
    const photoUrl = `/photos/${encodeURIComponent(entry.name)}`;

    // Find matching contact without a photo already set
    const contact = db.prepare(
      "SELECT id FROM contacts WHERE display_name = ? AND profile_picture_url IS NULL LIMIT 1"
    ).get(displayName) as { id: number } | undefined;

    if (contact) {
      db.prepare("UPDATE contacts SET profile_picture_url = ?, updated_at = datetime('now') WHERE id = ?").run(photoUrl, contact.id);
      matched++;
    } else {
      skipped++;
    }
  }

  db.close();
  console.log(`Linked ${matched} photos, ${skipped} unmatched`);
}

if (import.meta.main) {
  importContactPhotos();
}
