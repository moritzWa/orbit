import { getDb } from "./db.ts";
import { importLinkedInMessages } from "./import-linkedin-messages.ts";

const self = "https://www.linkedin.com/in/moritz";
const other = "https://www.linkedin.com/in/andrew";
const headers = ["CONVERSATION ID", "FROM", "SENDER PROFILE URL", "TO", "RECIPIENT PROFILE URL", "DATE", "SUBJECT", "CONTENT"];
const encode = (rows: string[][]) => "\uFEFF" + [headers, ...rows].map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
const incoming = (url = other, name = "Andrew") => ["conversation-1", name, url, "Moritz", self, "2025-02-19 21:16:00", "", "Hi, Moritz\nJoin us? \"Thanks\""];
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

Deno.test("directions, UTC, quoted multiline CSV, statistics across sources, replay and overlap", async () => {
  const db = getDb(":memory:");
  try {
    db.prepare("INSERT INTO contacts (display_name, linkedin_url) VALUES ('Andrew', ?)").run(other + "/?trk=old");
    db.exec("INSERT INTO messages (handle,contact_id,text,is_from_me,date,source) VALUES ('phone',1,'old',0,'2024-01-01 00:00:00','imessage')");
    const reply = ["conversation-1", "Moritz", self, "Andrew", other, "2025-02-19T23:19:00+02:00", "", "Thanks!"];
    equal(await importLinkedInMessages(db, encode([incoming(), reply]), self), { imported: 2, duplicates: 0, skipped: 0, created: 0 });
    equal(db.prepare("SELECT message_count,first_contacted,last_contacted FROM contacts WHERE id=1").get(), { message_count: 3, first_contacted: "2024-01-01 00:00:00", last_contacted: "2025-02-19 21:19:00" });
    equal(db.prepare("SELECT text,is_from_me FROM messages WHERE source='linkedin' ORDER BY id").all(), [{ text: 'Hi, Moritz\nJoin us? "Thanks"', is_from_me: 0 }, { text: "Thanks!", is_from_me: 1 }]);
    equal((await importLinkedInMessages(db, encode([incoming(), reply]), self)).duplicates, 2);
    const next = [...reply]; next[5] = "2025-02-20 00:00:00";
    equal((await importLinkedInMessages(db, encode([reply, next]), self)).imported, 1);
    equal(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});

Deno.test("groups, unknown participants, invalid dates and non-LinkedIn URLs are skipped", async () => {
  const db = getDb(":memory:");
  try {
    const group = incoming(); group[4] = `${self}; https://www.linkedin.com/in/third`;
    const unrelated = incoming(); unrelated[4] = "https://www.linkedin.com/in/third";
    const badDate = incoming(); badDate[5] = "not a date";
    const foreign = incoming("https://evil.example/in/andrew");
    equal(await importLinkedInMessages(db, encode([group, unrelated, badDate, foreign]), self), { imported: 0, duplicates: 0, skipped: 4, created: 0 });
    equal(db.prepare("SELECT COUNT(*) AS n FROM contacts").get(), { n: 0 });
  } finally { db.close(); }
});

Deno.test("merge redirects, unique phone-only names, ambiguous names and conflicting profile identities", async () => {
  const db = getDb(":memory:");
  try {
    db.exec("INSERT INTO contacts (display_name) VALUES ('Renamed'),('Phone Only'),('Namesake'),('Namesake')");
    db.prepare("INSERT INTO contacts (display_name,linkedin_url) VALUES ('Conflict', ?)").run("https://www.linkedin.com/in/different-person");
    db.prepare("INSERT INTO merge_redirects (source,source_id,target_contact_id) VALUES ('linkedin',?,1)").run(other);
    const rows = [incoming(), incoming("https://www.linkedin.com/in/phone", "Phone Only"), incoming("https://www.linkedin.com/in/namesake", "Namesake"), incoming("https://www.linkedin.com/in/conflict", "Conflict")];
    equal((await importLinkedInMessages(db, encode(rows), self)).created, 2);
    equal(db.prepare("SELECT contact_id FROM messages ORDER BY id").all(), [{ contact_id: 1 }, { contact_id: 2 }, { contact_id: 6 }, { contact_id: 7 }]);
  } finally { db.close(); }
});

Deno.test("invalid headers or self identity fail without writes", async () => {
  const db = getDb(":memory:");
  try {
    for (const [csv, url] of [["FROM,CONTENT\nAndrew,Hi", self], [encode([incoming()]), "not a URL"]]) {
      let failed = false;
      try { await importLinkedInMessages(db, csv, url); } catch { failed = true; }
      equal(failed, true);
    }
    equal(db.prepare("SELECT COUNT(*) AS n FROM import_log").get(), { n: 0 });
  } finally { db.close(); }
});

Deno.test("a database failure rolls back contacts, messages, receipts and import log", async () => {
  const db = getDb(":memory:");
  try {
    db.exec(`CREATE TRIGGER fail_receipt BEFORE INSERT ON linkedin_message_imports
      BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`);
    let failed = false;
    try { await importLinkedInMessages(db, encode([incoming()]), self); } catch { failed = true; }
    equal(failed, true);
    for (const table of ["contacts", "messages", "linkedin_message_imports", "import_log"]) {
      equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(), { n: 0 });
    }
  } finally { db.close(); }
});

Deno.test("percent-encoded Unicode URLs and attachments link on replay", async () => {
  const db = getDb(":memory:");
  try {
    db.prepare("INSERT INTO contacts (display_name,linkedin_url) VALUES (?,?)").run("Michael Trịnh", "https://www.linkedin.com/in/michael-trịnh");
    const row = incoming("https://www.linkedin.com/in/michael-tr%E1%BB%8Bnh/", "Michael Trịnh");
    row[7] = "";
    equal(await importLinkedInMessages(db, encode([row, row]), self), { imported: 1, duplicates: 1, skipped: 0, created: 0 });
    equal(db.prepare("SELECT contact_id,text FROM messages").get(), { contact_id: 1, text: "(attachment)" });
  } finally { db.close(); }
});
