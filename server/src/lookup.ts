import { getDb } from "./db.ts";

const query = Deno.args.join(" ").trim();
if (!query) {
  console.log("Usage: deno task lookup <name or email>");
  Deno.exit(1);
}

const db = getDb();

// Search by name or email
const contacts = db.prepare(`
  SELECT DISTINCT c.* FROM contacts c
  LEFT JOIN contact_emails e ON e.contact_id = c.id
  WHERE c.display_name LIKE ? OR e.email LIKE ?
  AND c.archived = 0
  ORDER BY c.message_count DESC
  LIMIT 5
`).all(`%${query}%`, `%${query}%`) as Array<Record<string, unknown>>;

if (contacts.length === 0) {
  console.log(`No contacts found for "${query}"`);
  db.close();
  Deno.exit(0);
}

for (const c of contacts) {
  const id = c.id as number;
  console.log(`\n=== ${c.display_name} (id: ${id}) ===`);
  if (c.organization) console.log(`Org: ${c.organization}`);
  if (c.linkedin_headline) console.log(`LinkedIn: ${c.linkedin_headline}`);
  if (c.linkedin_url) console.log(`URL: ${c.linkedin_url}`);
  if (c.linkedin_location) console.log(`Location: ${c.linkedin_location}`);
  console.log(`Messages: ${c.message_count} | First: ${c.first_contacted ?? "n/a"} | Last: ${c.last_contacted ?? "n/a"}`);

  const phones = db.prepare("SELECT phone, label FROM contact_phones WHERE contact_id = ?").all(id) as Array<{ phone: string; label: string | null }>;
  if (phones.length) console.log(`Phones: ${phones.map((p) => `${p.phone}${p.label ? ` (${p.label})` : ""}`).join(", ")}`);

  const emails = db.prepare("SELECT email, label FROM contact_emails WHERE contact_id = ?").all(id) as Array<{ email: string; label: string | null }>;
  if (emails.length) console.log(`Emails: ${emails.map((e) => `${e.email}${e.label ? ` (${e.label})` : ""}`).join(", ")}`);

  // Recent messages
  const messages = db.prepare(`
    SELECT text, date, is_from_me, source FROM messages
    WHERE contact_id = ? ORDER BY date DESC LIMIT 10
  `).all(id) as Array<{ text: string | null; date: string; is_from_me: number; source: string }>;

  if (messages.length) {
    console.log(`\nRecent messages:`);
    for (const m of messages) {
      const who = m.is_from_me ? "me" : "them";
      const text = (m.text ?? "(no text)").slice(0, 80).replace(/\n/g, " ");
      console.log(`  ${m.date.slice(0, 10)} [${m.source}] ${who}: ${text}`);
    }
  }
}

db.close();
