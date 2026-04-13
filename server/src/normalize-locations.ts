import { cityMapping } from "npm:city-timezones";
import { getDb } from "./db.ts";

interface CityEntry {
  city: string;
  province?: string;
  state_ansi?: string;
  country: string;
  timezone: string;
  pop?: number;
}

// Manual overrides for common LinkedIn location strings
const MANUAL_MAP: Record<string, { city: string; country: string }> = {
  "san francisco bay area": { city: "San Francisco", country: "United States" },
  "new york city metropolitan area": { city: "New York", country: "United States" },
  "berlin metropolitan area": { city: "Berlin", country: "Germany" },
  "greater london": { city: "London", country: "United Kingdom" },
  "los angeles metropolitan area": { city: "Los Angeles", country: "United States" },
  "munich metropolitan area": { city: "Munich", country: "Germany" },
  "chicago metropolitan area": { city: "Chicago", country: "United States" },
  "boston metropolitan area": { city: "Boston", country: "United States" },
  "seattle metropolitan area": { city: "Seattle", country: "United States" },
  "brooklyn": { city: "New York", country: "United States" },
  "manhattan": { city: "New York", country: "United States" },
  "queens": { city: "New York", country: "United States" },
  "palo alto": { city: "San Francisco", country: "United States" },
  "stanford": { city: "San Francisco", country: "United States" },
  "berkeley": { city: "San Francisco", country: "United States" },
  "mountain view": { city: "San Francisco", country: "United States" },
  "menlo park": { city: "San Francisco", country: "United States" },
  "sunnyvale": { city: "San Francisco", country: "United States" },
  "san jose": { city: "San Francisco", country: "United States" },
  "redwood city": { city: "San Francisco", country: "United States" },
};

function normalizeLocation(location: string): { city: string | null; country: string | null } {
  const clean = location.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();

  // Check manual overrides first
  for (const [key, val] of Object.entries(MANUAL_MAP)) {
    if (lower.includes(key)) return val;
  }

  // For LinkedIn format "City, State, Country" - extract city directly
  const parts = clean.split(/,\s*/);
  if (parts.length >= 3) {
    // "San Francisco, California, United States" → city=San Francisco
    const candidateCity = parts[0];
    // Verify it's a real city using city-timezones
    const match = (cityMapping as CityEntry[]).find((c) =>
      c.city.toLowerCase() === candidateCity.toLowerCase()
    );
    if (match) {
      return { city: match.city, country: match.country };
    }
    // If not found exactly, still use first part as city
    return { city: candidateCity, country: parts[parts.length - 1] };
  }

  // For 2-part locations "Berlin, Germany"
  if (parts.length === 2) {
    const match = (cityMapping as CityEntry[]).find((c) =>
      c.city.toLowerCase() === parts[0].toLowerCase()
    );
    if (match) return { city: match.city, country: match.country };
    return { city: parts[0], country: parts[1] };
  }

  // Single word - try exact city match only (avoid loose matching)
  if (parts.length === 1) {
    const exact = (cityMapping as CityEntry[])
      .filter((c) => c.city.toLowerCase() === lower)
      .sort((a, b) => (b.pop || 0) - (a.pop || 0));
    if (exact.length > 0) return { city: exact[0].city, country: exact[0].country };
  }

  return { city: null, country: null };
}

const db = getDb();

// Get all contacts with any location data
const contacts = db.prepare(`
  SELECT id, linkedin_location FROM contacts
  WHERE (linkedin_location IS NOT NULL)
    AND normalized_city IS NULL
    AND archived = 0
`).all() as Array<{ id: number; linkedin_location: string | null }>;

console.log(`Normalizing locations for ${contacts.length} contacts`);

let normalized = 0;
let failed = 0;

const update = db.prepare("UPDATE contacts SET normalized_city = ?, normalized_country = ?, updated_at = datetime('now') WHERE id = ?");

for (const c of contacts) {
  const loc = c.linkedin_location;
  if (!loc) continue;

  const result = normalizeLocation(loc);
  if (result.city) {
    update.run(result.city, result.country, c.id);
    normalized++;
  } else {
    failed++;
  }
}

// Also try X location from contacts with x_username but no normalized_city
// X location is stored in the CSV, not in our DB yet. We'd need to import it separately.

db.close();
console.log(`Normalized ${normalized}, failed ${failed}`);

// Show top cities
const db2 = getDb();
const cities = db2.prepare(`
  SELECT normalized_city, COUNT(*) as c FROM contacts
  WHERE normalized_city IS NOT NULL AND archived = 0
  GROUP BY normalized_city ORDER BY c DESC LIMIT 20
`).all() as Array<{ normalized_city: string; c: number }>;
console.log("\nTop cities:");
for (const city of cities) {
  console.log(`  ${city.normalized_city}: ${city.c}`);
}
db2.close();
