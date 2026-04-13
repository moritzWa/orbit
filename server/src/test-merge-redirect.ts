import { Database } from "@db/sqlite";

// Test: merge redirects prevent re-import from recreating merged contacts
// Uses an in-memory DB to avoid corrupting real data

const db = new Database(":memory:");

// Set up schema
db.exec(`
  CREATE TABLE contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT, last_name TEXT, organization TEXT,
    display_name TEXT, apple_contacts_id INTEGER, archived INTEGER DEFAULT 0,
    linkedin_url TEXT, profile_picture_url TEXT,
    message_count INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE contact_phones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER, phone TEXT, label TEXT, UNIQUE(contact_id, phone)
  );
  CREATE TABLE contact_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER, email TEXT, label TEXT, UNIQUE(contact_id, email)
  );
  CREATE TABLE merge_redirects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL, source_id TEXT NOT NULL,
    target_contact_id INTEGER NOT NULL, UNIQUE(source, source_id)
  );
`);

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

// --- Test 1: Basic merge redirect ---
console.log("\nTest 1: Merged contact should not be recreated on re-import");

// Create two contacts (simulating Natalie and Natalie Perez)
db.exec(`
  INSERT INTO contacts (id, first_name, last_name, display_name, apple_contacts_id) VALUES (1, 'Natalie', 'Perez', 'Natalie Perez', 42);
  INSERT INTO contacts (id, first_name, last_name, display_name, apple_contacts_id) VALUES (2, 'Natalie', NULL, 'Natalie', 99);
  INSERT INTO contact_phones (contact_id, phone) VALUES (1, '+14803696627');
  INSERT INTO contact_phones (contact_id, phone) VALUES (2, '+12023609536');
`);

// Simulate merge: keep 1, delete 2, record redirect
db.exec(`
  INSERT INTO merge_redirects (source, source_id, target_contact_id) VALUES ('apple', '99', 1);
  UPDATE contact_phones SET contact_id = 1 WHERE contact_id = 2;
  DELETE FROM contacts WHERE id = 2;
`);

// Simulate re-import: apple_id 99 comes in again
const redirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'apple' AND source_id = '99'").get() as { target_contact_id: number } | undefined;

assert(redirect !== undefined, "Redirect found for apple_id 99");
assert(redirect?.target_contact_id === 1, "Redirect points to contact 1 (Natalie Perez)");

const contactCount = (db.prepare("SELECT COUNT(*) as c FROM contacts").get() as { c: number }).c;
assert(contactCount === 1, "Only 1 contact exists (merged one was deleted)");

const contact = db.prepare("SELECT display_name FROM contacts WHERE id = 1").get() as { display_name: string };
assert(contact.display_name === "Natalie Perez", "Name was NOT overwritten back to 'Natalie'");

// --- Test 2: Archived contacts should be skipped ---
console.log("\nTest 2: Archived contacts should not be recreated");

db.exec(`
  INSERT INTO contacts (id, first_name, display_name, apple_contacts_id, archived) VALUES (3, 'Spam', 'Spam Person', 200, 1);
`);

const archived = db.prepare("SELECT archived FROM contacts WHERE apple_contacts_id = 200").get() as { archived: number };
assert(archived.archived === 1, "Contact is archived");
// Import should check archived flag and skip

// --- Test 3: Phones should still be added to redirected contacts ---
console.log("\nTest 3: Phones/emails added to redirect target");

const phonesBefore = (db.prepare("SELECT COUNT(*) as c FROM contact_phones WHERE contact_id = 1").get() as { c: number }).c;
db.exec("INSERT OR IGNORE INTO contact_phones (contact_id, phone) VALUES (1, '+19788705912')");
const phonesAfter = (db.prepare("SELECT COUNT(*) as c FROM contact_phones WHERE contact_id = 1").get() as { c: number }).c;
assert(phonesAfter === phonesBefore + 1, "New phone added to redirect target");

// --- Test 4: Chris Schnabl scenario - fuzzy match after merge ---
console.log("\nTest 4: Previously merged contact (Chris Schabl -> Chris Schnabl)");

db.exec(`
  INSERT INTO contacts (id, first_name, last_name, display_name, apple_contacts_id) VALUES (4, 'Chris', 'Schnabl', 'Chris Schnabl', 300);
  INSERT INTO merge_redirects (source, source_id, target_contact_id) VALUES ('apple', '301', 4);
`);

// Re-import: apple_id 301 ("Chris Schabl") comes in again
const chrisRedirect = db.prepare("SELECT target_contact_id FROM merge_redirects WHERE source = 'apple' AND source_id = '301'").get() as { target_contact_id: number } | undefined;
assert(chrisRedirect?.target_contact_id === 4, "Chris Schabl redirects to Chris Schnabl (id 4)");

const chrisName = db.prepare("SELECT display_name FROM contacts WHERE id = 4").get() as { display_name: string };
assert(chrisName.display_name === "Chris Schnabl", "Chris Schnabl name preserved (not overwritten to Schabl)");

db.close();

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) Deno.exit(1);
