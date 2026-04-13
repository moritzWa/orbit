import { getDb, logImport } from "./db.ts";

const CAL_EXPORT_DIR = "/tmp/gcal_export";
const MAX_ATTENDEES = 10;

interface CalEvent {
  uid: string;
  summary: string;
  dtstart: string;
  dtend: string;
  attendees: string[]; // email addresses
  location?: string;
}

function parseICS(content: string): CalEvent[] {
  const events: CalEvent[] = [];
  const blocks = content.split("BEGIN:VEVENT");

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split("END:VEVENT")[0];

    const get = (key: string): string => {
      const match = block.match(new RegExp(`^${key}[;:](.*)$`, "m"));
      return match ? match[1].replace(/^\w+=\w+:/, "").trim() : "";
    };

    const uid = get("UID");
    const summary = get("SUMMARY").replace(/\\,/g, ",").replace(/\\n/g, " ");
    let dtstart = get("DTSTART");

    // Parse date - handle both DATE and DATETIME formats
    if (dtstart.includes("T")) {
      // 20220314T153000Z or TZID=...:20220314T153000
      const dateStr = dtstart.replace(/.*:/, "").replace("Z", "");
      const y = dateStr.slice(0, 4), m = dateStr.slice(4, 6), d = dateStr.slice(6, 8);
      const h = dateStr.slice(9, 11), mi = dateStr.slice(11, 13);
      dtstart = `${y}-${m}-${d} ${h}:${mi}:00`;
    } else {
      const dateStr = dtstart.replace(/.*:/, "");
      if (dateStr.length >= 8) {
        dtstart = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)} 00:00:00`;
      }
    }

    // Collect attendees
    const attendees: string[] = [];
    const attendeeMatches = block.matchAll(/ATTENDEE[^:]*:mailto:([^\r\n]+)/gi);
    for (const match of attendeeMatches) {
      const email = match[1].trim().toLowerCase();
      if (email && !email.includes("wallawitsch")) attendees.push(email);
    }

    if (uid && summary && dtstart && attendees.length > 0 && attendees.length < MAX_ATTENDEES) {
      events.push({ uid, summary, dtstart, attendees, location: get("LOCATION") || undefined });
    }
  }

  return events;
}

export function importGoogleCalendar() {
  const db = getDb();

  // Parse all ICS files
  let allEvents: CalEvent[] = [];
  for (const entry of Deno.readDirSync(CAL_EXPORT_DIR)) {
    if (!entry.name.endsWith(".ics")) continue;
    console.log(`Parsing ${entry.name}...`);
    const content = Deno.readTextFileSync(`${CAL_EXPORT_DIR}/${entry.name}`);
    const events = parseICS(content);
    console.log(`  ${events.length} events with 1-${MAX_ATTENDEES - 1} attendees`);
    allEvents = allEvents.concat(events);
  }

  console.log(`Total events to import: ${allEvents.length}`);

  const findByEmail = db.prepare("SELECT contact_id FROM contact_emails WHERE email = ? LIMIT 1");
  const findByName = db.prepare("SELECT id FROM contacts WHERE display_name = ? AND archived = 0 LIMIT 1");
  const findRedirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'calendar' AND source_id = ?");
  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (handle, text, is_from_me, date, source, contact_id)
    VALUES (?, ?, 1, ?, 'calendar', ?)
  `);
  const insertEmail = db.prepare("INSERT OR IGNORE INTO contact_emails (contact_id, email, label) VALUES (?, ?, 'calendar')");

  // First pass: extract attendee names from ICS and link emails to contacts
  let emailsLinked = 0;
  for (const entry of Deno.readDirSync(CAL_EXPORT_DIR)) {
    if (!entry.name.endsWith(".ics")) continue;
    const raw = Deno.readTextFileSync(`${CAL_EXPORT_DIR}/${entry.name}`);
    const unfolded = raw.replace(/\r?\n[ \t]/g, ""); // Unfold continuation lines
    for (const m of unfolded.matchAll(/ATTENDEE[^:]*CN=([^;:]+)[^:]*:mailto:([^\r\n]+)/gi)) {
      const cn = m[1].trim().replace(/^"|"$/g, "");
      const email = m[2].trim().toLowerCase();
      if (email.includes("wallawitsch") || email.includes("resource.calendar") || cn.includes("[Zoom]")) continue;
      // Check if email already linked
      const existing = findByEmail.get(email);
      if (existing) continue;
      // Match by name
      const contact = findByName.get(cn) as { id: number } | undefined;
      if (contact) {
        insertEmail.run(contact.id, email);
        emailsLinked++;
      }
    }
  }
  console.log(`Linked ${emailsLinked} new emails from calendar attendee names`);

  let imported = 0;
  let skipped = 0;

  for (const event of allEvents) {
    let matchedAny = false;

    for (const email of event.attendees) {
      let contactId: number | null = null;

      // Check merge redirects
      const redirect = findRedirect.get(email) as { target_contact_id: number } | undefined;
      if (redirect) {
        contactId = redirect.target_contact_id;
      } else {
        const match = findByEmail.get(email) as { contact_id: number } | undefined;
        if (match) contactId = match.contact_id;
      }

      if (contactId) {
        const text = `📅 ${event.summary}${event.attendees.length > 1 ? ` (+${event.attendees.length} attendees)` : ""}`;
        insertMessage.run(`cal:${email}`, text, event.dtstart, contactId);
        matchedAny = true;
      }
    }

    if (matchedAny) {
      imported++;
      if (imported <= 10) console.log(`  ${event.dtstart.slice(0, 10)}: "${event.summary}" (${event.attendees.length} attendees)`);
    } else {
      skipped++;
    }
  }

  // Update last_contacted
  db.exec(`
    UPDATE contacts SET
      last_contacted = (SELECT MAX(date) FROM messages WHERE messages.contact_id = contacts.id),
      message_count = (SELECT COUNT(*) FROM messages WHERE messages.contact_id = contacts.id),
      updated_at = datetime('now')
    WHERE id IN (SELECT DISTINCT contact_id FROM messages WHERE source = 'calendar' AND contact_id IS NOT NULL)
  `);

  db.close();
  console.log(`\nCalendar: ${imported} events imported, ${skipped} skipped (no matching contact)`);
  logImport("calendar", imported);
}

if (import.meta.main) {
  importGoogleCalendar();
}
