/**
 * Seeds a throwaway demo database with public figures from tech, film, music,
 * sport and writing, so the README screenshots can show real faces and names
 * instead of private contacts.
 *
 *   CRM_DB_PATH=/tmp/demo.db CRM_PHOTOS_DIR=exports/demo-photos \
 *     deno run -A server/src/seed-demo.ts
 *
 * Photos come from the Wikipedia REST summary API (Wikimedia Commons images).
 * Those are mostly conference and red-carpet shots, so each one is reframed
 * into a head-and-shoulders avatar by tools/facecrop.swift before being stored.
 */
import { getDb } from "./db.ts";

const PHOTOS_DIR = Deno.env.get("CRM_PHOTOS_DIR") ??
  new URL("../../exports/demo-photos", import.meta.url).pathname;

interface Person {
  wiki: string;
  name: string;
  org: string;
  headline: string;
  city: string;
  country: string;
  x?: string;
  ig?: string;
  linkedin?: string;
  /** days since we last talked */
  lastDays: number;
  msgs: number;
  /** stay-in-touch cadence in days; omitted = not a favorite */
  cadence?: number;
  tags: string[];
  notes?: string;
}

const PEOPLE: Person[] = [
  { wiki: "Sam Altman", name: "Sam Altman", org: "OpenAI", headline: "CEO at OpenAI", city: "San Francisco", country: "United States", x: "sama", linkedin: "https://linkedin.com/in/samaltman", lastDays: 96, msgs: 214, cadence: 60, tags: ["male", "sf", "x-mutual"], notes: "Met at the YC alumni dinner. Wants an intro to the infra team." },
  { wiki: "Patrick Collison", name: "Patrick Collison", org: "Stripe", headline: "Co-founder & CEO at Stripe", city: "San Francisco", country: "United States", x: "patrickc", linkedin: "https://linkedin.com/in/patrickcollison", lastDays: 121, msgs: 87, cadence: 90, tags: ["male", "sf", "x-mutual"], notes: "Book recs thread. Owes me one on progress studies." },
  { wiki: "Brian Chesky", name: "Brian Chesky", org: "Airbnb", headline: "Co-founder & CEO at Airbnb", city: "San Francisco", country: "United States", x: "bchesky", linkedin: "https://linkedin.com/in/brianchesky", lastDays: 187, msgs: 41, cadence: 120, tags: ["male", "sf"] },
  { wiki: "Whitney Wolfe Herd", name: "Whitney Wolfe Herd", org: "Bumble", headline: "Founder & Executive Chair at Bumble", city: "Austin", country: "United States", x: "whitwolfeherd", lastDays: 43, msgs: 63, cadence: 90, tags: ["female", "x-mutual"] },
  { wiki: "Dylan Field", name: "Dylan Field", org: "Figma", headline: "Co-founder & CEO at Figma", city: "San Francisco", country: "United States", x: "zoink", linkedin: "https://linkedin.com/in/dylanfield", lastDays: 12, msgs: 158, cadence: 60, tags: ["male", "sf", "x-mutual"], notes: "Design system feedback. Follow up after Config." },
  { wiki: "Tobias Lütke", name: "Tobi Lütke", org: "Shopify", headline: "Founder & CEO at Shopify", city: "Ottawa", country: "Canada", x: "tobi", lastDays: 208, msgs: 29, tags: ["male", "x-following"] },
  { wiki: "Jensen Huang", name: "Jensen Huang", org: "NVIDIA", headline: "Founder & CEO at NVIDIA", city: "Santa Clara", country: "United States", lastDays: 402, msgs: 8, tags: ["male"] },
  { wiki: "Melanie Perkins", name: "Melanie Perkins", org: "Canva", headline: "Co-founder & CEO at Canva", city: "Sydney", country: "Australia", lastDays: 74, msgs: 37, cadence: 90, tags: ["female"] },
  { wiki: "Marc Andreessen", name: "Marc Andreessen", org: "a16z", headline: "Co-founder & General Partner at Andreessen Horowitz", city: "Menlo Park", country: "United States", x: "pmarca", lastDays: 156, msgs: 22, tags: ["male", "x-following"] },
  { wiki: "Paul Graham (programmer)", name: "Paul Graham", org: "Y Combinator", headline: "Co-founder at Y Combinator, essayist", city: "London", country: "United Kingdom", x: "paulg", lastDays: 33, msgs: 96, cadence: 90, tags: ["male", "london", "x-mutual"] },
  { wiki: "Reid Hoffman", name: "Reid Hoffman", org: "Greylock", headline: "Co-founder of LinkedIn, Partner at Greylock", city: "Menlo Park", country: "United States", linkedin: "https://linkedin.com/in/reidhoffman", lastDays: 260, msgs: 15, tags: ["male"] },
  { wiki: "Daniel Ek", name: "Daniel Ek", org: "Spotify", headline: "Founder & CEO at Spotify", city: "Stockholm", country: "Sweden", x: "eldsjal", lastDays: 91, msgs: 44, tags: ["male"] },
  { wiki: "Demis Hassabis", name: "Demis Hassabis", org: "Google DeepMind", headline: "Co-founder & CEO at Google DeepMind", city: "London", country: "United Kingdom", x: "demishassabis", lastDays: 58, msgs: 31, cadence: 120, tags: ["male", "london"] },
  { wiki: "Vitalik Buterin", name: "Vitalik Buterin", org: "Ethereum Foundation", headline: "Co-founder of Ethereum", city: "Singapore", country: "Singapore", x: "VitalikButerin", lastDays: 310, msgs: 11, tags: ["male", "x-following"] },
  { wiki: "Jack Dorsey", name: "Jack Dorsey", org: "Block", headline: "Co-founder of Twitter and Block", city: "San Francisco", country: "United States", x: "jack", lastDays: 143, msgs: 26, tags: ["male", "sf"] },
  { wiki: "Anne Wojcicki", name: "Anne Wojcicki", org: "23andMe", headline: "Co-founder & CEO at 23andMe", city: "South San Francisco", country: "United States", lastDays: 178, msgs: 19, tags: ["female", "sf"] },
  { wiki: "Satya Nadella", name: "Satya Nadella", org: "Microsoft", headline: "Chairman & CEO at Microsoft", city: "Redmond", country: "United States", linkedin: "https://linkedin.com/in/satyanadella", lastDays: 365, msgs: 6, tags: ["male"] },
  { wiki: "Sundar Pichai", name: "Sundar Pichai", org: "Google", headline: "CEO at Alphabet and Google", city: "Mountain View", country: "United States", lastDays: 289, msgs: 9, tags: ["male"] },
  { wiki: "Emmett Shear", name: "Emmett Shear", org: "Twitch", headline: "Co-founder of Twitch", city: "San Francisco", country: "United States", x: "eshear", lastDays: 21, msgs: 71, cadence: 60, tags: ["male", "sf", "x-mutual"] },
  { wiki: "Garry Tan", name: "Garry Tan", org: "Y Combinator", headline: "President & CEO at Y Combinator", city: "San Francisco", country: "United States", x: "garrytan", lastDays: 7, msgs: 122, cadence: 30, tags: ["male", "sf", "x-mutual"], notes: "Intro'd me to two Fall batch founders. Send them the demo link." },
  { wiki: "Peter Thiel", name: "Peter Thiel", org: "Founders Fund", headline: "Co-founder of PayPal and Palantir", city: "Los Angeles", country: "United States", lastDays: 220, msgs: 14, tags: ["male", "la"] },
  { wiki: "Naval Ravikant", name: "Naval Ravikant", org: "AngelList", headline: "Co-founder of AngelList", city: "San Francisco", country: "United States", x: "naval", lastDays: 64, msgs: 48, tags: ["male", "sf", "x-following"] },
  { wiki: "Aaron Levie", name: "Aaron Levie", org: "Box", headline: "Co-founder & CEO at Box", city: "Redwood City", country: "United States", x: "levie", lastDays: 39, msgs: 55, tags: ["male", "x-mutual"] },
  { wiki: "Drew Houston", name: "Drew Houston", org: "Dropbox", headline: "Co-founder & CEO at Dropbox", city: "San Francisco", country: "United States", x: "drewhouston", lastDays: 132, msgs: 33, tags: ["male", "sf"] },
  { wiki: "Ben Silbermann", name: "Ben Silbermann", org: "Pinterest", headline: "Co-founder & Executive Chairman at Pinterest", city: "San Francisco", country: "United States", lastDays: 245, msgs: 12, tags: ["male", "sf"] },
  { wiki: "Evan Spiegel", name: "Evan Spiegel", org: "Snap", headline: "Co-founder & CEO at Snap", city: "Los Angeles", country: "United States", lastDays: 167, msgs: 18, tags: ["male", "la"] },
  { wiki: "Arash Ferdowsi", name: "Arash Ferdowsi", org: "Dropbox", headline: "Co-founder at Dropbox", city: "San Francisco", country: "United States", lastDays: 88, msgs: 24, tags: ["male", "sf"] },
  { wiki: "Alexis Ohanian", name: "Alexis Ohanian", org: "776", headline: "Co-founder of Reddit, Founder at 776", city: "New York", country: "United States", x: "alexisohanian", lastDays: 52, msgs: 61, cadence: 90, tags: ["male", "nyc", "x-mutual"] },
  { wiki: "Steve Huffman", name: "Steve Huffman", org: "Reddit", headline: "Co-founder & CEO at Reddit", city: "San Francisco", country: "United States", x: "spez", lastDays: 197, msgs: 16, tags: ["male", "sf"] },
  { wiki: "Mira Murati", name: "Mira Murati", org: "Thinking Machines Lab", headline: "Founder at Thinking Machines Lab", city: "San Francisco", country: "United States", lastDays: 26, msgs: 79, cadence: 60, tags: ["female", "sf"] },
  { wiki: "Fidji Simo", name: "Fidji Simo", org: "OpenAI", headline: "CEO of Applications at OpenAI", city: "San Francisco", country: "United States", lastDays: 111, msgs: 27, tags: ["female", "sf"] },
  { wiki: "Kevin Systrom", name: "Kevin Systrom", org: "Instagram", headline: "Co-founder of Instagram", city: "San Francisco", country: "United States", ig: "kevin", lastDays: 149, msgs: 35, tags: ["male", "sf", "ig-mutual"] },
  { wiki: "Julia Hartz", name: "Julia Hartz", org: "Eventbrite", headline: "Co-founder & CEO at Eventbrite", city: "San Francisco", country: "United States", lastDays: 82, msgs: 21, tags: ["female", "sf"] },
  { wiki: "Stewart Butterfield", name: "Stewart Butterfield", org: "Slack", headline: "Co-founder of Slack and Flickr", city: "Vancouver", country: "Canada", x: "stewart", lastDays: 233, msgs: 13, tags: ["male"] },
  { wiki: "Susan Wojcicki", name: "Susan Wojcicki", org: "YouTube", headline: "Former CEO at YouTube", city: "Los Altos", country: "United States", lastDays: 401, msgs: 7, tags: ["female"] },
  { wiki: "Elon Musk", name: "Elon Musk", org: "Tesla, SpaceX", headline: "CEO at Tesla and SpaceX", city: "Austin", country: "United States", x: "elonmusk", lastDays: 302, msgs: 17, tags: ["male", "x-following"] },
  { wiki: "Nat Friedman", name: "Nat Friedman", org: "NFDG", headline: "Former CEO at GitHub, investor", city: "San Francisco", country: "United States", x: "natfriedman", lastDays: 18, msgs: 104, cadence: 45, tags: ["male", "sf", "x-mutual"], notes: "Offered to look at the retrieval eval harness." },
  { wiki: "Dario Amodei", name: "Dario Amodei", org: "Anthropic", headline: "Co-founder & CEO at Anthropic", city: "San Francisco", country: "United States", lastDays: 47, msgs: 58, cadence: 90, tags: ["male", "sf"] },
  { wiki: "Michelle Zatlyn", name: "Michelle Zatlyn", org: "Cloudflare", headline: "Co-founder & President at Cloudflare", city: "San Francisco", country: "United States", lastDays: 68, msgs: 42, tags: ["female", "sf"] },
  { wiki: "Jack Ma", name: "Jack Ma", org: "Alibaba", headline: "Founder of Alibaba Group", city: "Hangzhou", country: "China", lastDays: 512, msgs: 4, tags: ["male"] },

  // Outside tech, so the demo does not read as one industry's address book.
  { wiki: "Zendaya", name: "Zendaya", org: "Actor", headline: "Actor and producer", city: "Los Angeles", country: "United States", ig: "zendaya", lastDays: 29, msgs: 47, cadence: 90, tags: ["female", "la", "ig-mutual"] },
  { wiki: "Timothée Chalamet", name: "Timothée Chalamet", org: "Actor", headline: "Actor", city: "New York", country: "United States", ig: "tchalamet", lastDays: 76, msgs: 22, tags: ["male", "nyc"] },
  { wiki: "Michael B. Jordan", name: "Michael B. Jordan", org: "Outlier Society", headline: "Actor, founder at Outlier Society", city: "Los Angeles", country: "United States", lastDays: 134, msgs: 18, tags: ["male", "la"] },
  { wiki: "Emma Stone", name: "Emma Stone", org: "Fruit Tree", headline: "Actor and producer", city: "Los Angeles", country: "United States", lastDays: 213, msgs: 11, tags: ["female", "la"] },
  { wiki: "Keanu Reeves", name: "Keanu Reeves", org: "Company Films", headline: "Actor, musician, producer", city: "Los Angeles", country: "United States", lastDays: 288, msgs: 9, tags: ["male", "la"] },
  { wiki: "Margot Robbie", name: "Margot Robbie", org: "LuckyChap", headline: "Actor, co-founder at LuckyChap Entertainment", city: "London", country: "United Kingdom", lastDays: 168, msgs: 16, tags: ["female", "london"] },
  { wiki: "Ryan Reynolds", name: "Ryan Reynolds", org: "Maximum Effort", headline: "Actor, founder at Maximum Effort", city: "New York", country: "United States", x: "VancityReynolds", lastDays: 61, msgs: 34, cadence: 120, tags: ["male", "nyc"], notes: "Wants to talk about the Mint Mobile-style marketing playbook." },
  { wiki: "Greta Gerwig", name: "Greta Gerwig", org: "Director", headline: "Director and screenwriter", city: "New York", country: "United States", lastDays: 97, msgs: 20, tags: ["female", "nyc"] },
  { wiki: "Christopher Nolan", name: "Christopher Nolan", org: "Syncopy", headline: "Director, co-founder at Syncopy", city: "Los Angeles", country: "United States", lastDays: 254, msgs: 7, tags: ["male", "la"] },
  { wiki: "Ava DuVernay", name: "Ava DuVernay", org: "Array", headline: "Director, founder at Array", city: "Los Angeles", country: "United States", lastDays: 118, msgs: 15, tags: ["female", "la"] },
  { wiki: "Rihanna", name: "Rihanna", org: "Fenty", headline: "Musician, founder at Fenty Beauty", city: "Los Angeles", country: "United States", ig: "badgalriri", lastDays: 152, msgs: 26, tags: ["female", "la", "ig-following"] },
  { wiki: "Beyoncé", name: "Beyoncé", org: "Parkwood Entertainment", headline: "Musician, founder at Parkwood Entertainment", city: "Los Angeles", country: "United States", lastDays: 331, msgs: 8, tags: ["female", "la"] },
  { wiki: "Taylor Swift", name: "Taylor Swift", org: "Musician", headline: "Musician and songwriter", city: "Nashville", country: "United States", lastDays: 199, msgs: 13, tags: ["female"] },
  { wiki: "Billie Eilish", name: "Billie Eilish", org: "Musician", headline: "Musician and songwriter", city: "Los Angeles", country: "United States", ig: "billieeilish", lastDays: 84, msgs: 29, tags: ["female", "la"] },
  { wiki: "Dua Lipa", name: "Dua Lipa", org: "Service95", headline: "Musician, founder at Service95", city: "London", country: "United Kingdom", lastDays: 45, msgs: 38, cadence: 90, tags: ["female", "london"] },
  { wiki: "Bad Bunny", name: "Bad Bunny", org: "Rimas", headline: "Musician", city: "San Juan", country: "Puerto Rico", lastDays: 267, msgs: 10, tags: ["male"] },
  { wiki: "Rick Rubin", name: "Rick Rubin", org: "Shangri-La", headline: "Record producer", city: "Malibu", country: "United States", lastDays: 40, msgs: 51, cadence: 90, tags: ["male", "la"], notes: "Long voice-note thread about doing less. Send him the essay." },
  { wiki: "Serena Williams", name: "Serena Williams", org: "Serena Ventures", headline: "Founder at Serena Ventures, 23-time Grand Slam champion", city: "Miami", country: "United States", lastDays: 55, msgs: 44, cadence: 90, tags: ["female"] },
  { wiki: "LeBron James", name: "LeBron James", org: "SpringHill", headline: "Athlete, co-founder at SpringHill Company", city: "Los Angeles", country: "United States", lastDays: 176, msgs: 17, tags: ["male", "la"] },
  { wiki: "Lionel Messi", name: "Lionel Messi", org: "Inter Miami", headline: "Footballer at Inter Miami", city: "Miami", country: "United States", lastDays: 240, msgs: 6, tags: ["male"] },
  { wiki: "Simone Biles", name: "Simone Biles", org: "Athlete", headline: "Olympic gymnast", city: "Houston", country: "United States", lastDays: 128, msgs: 12, tags: ["female"] },
  { wiki: "Lewis Hamilton", name: "Lewis Hamilton", org: "Ferrari", headline: "Formula One driver, founder at Mission 44", city: "Monaco", country: "Monaco", lastDays: 71, msgs: 25, tags: ["male"] },
  { wiki: "Roger Federer", name: "Roger Federer", org: "Team8", headline: "Co-founder at Team8, 20-time Grand Slam champion", city: "Zurich", country: "Switzerland", lastDays: 106, msgs: 21, tags: ["male"] },
  { wiki: "Barack Obama", name: "Barack Obama", org: "Obama Foundation", headline: "44th President of the United States", city: "Washington", country: "United States", lastDays: 318, msgs: 5, tags: ["male"] },
  { wiki: "Oprah Winfrey", name: "Oprah Winfrey", org: "OWN", headline: "Founder at OWN, producer", city: "Montecito", country: "United States", lastDays: 191, msgs: 14, tags: ["female"] },
  { wiki: "Bill Gates", name: "Bill Gates", org: "Gates Foundation", headline: "Co-chair at the Gates Foundation", city: "Seattle", country: "United States", linkedin: "https://linkedin.com/in/williamhgates", lastDays: 145, msgs: 23, tags: ["male"] },
  { wiki: "Mark Cuban", name: "Mark Cuban", org: "Cost Plus Drugs", headline: "Founder at Cost Plus Drugs, investor", city: "Dallas", country: "United States", x: "mcuban", lastDays: 34, msgs: 66, cadence: 60, tags: ["male", "x-mutual"] },
  { wiki: "Gordon Ramsay", name: "Gordon Ramsay", org: "Gordon Ramsay Restaurants", headline: "Chef and restaurateur", city: "London", country: "United Kingdom", lastDays: 87, msgs: 28, tags: ["male", "london"] },
  { wiki: "Trevor Noah", name: "Trevor Noah", org: "Day Zero", headline: "Comedian and host", city: "New York", country: "United States", lastDays: 50, msgs: 40, cadence: 90, tags: ["male", "nyc"] },
  { wiki: "Yuval Noah Harari", name: "Yuval Noah Harari", org: "Sapienship", headline: "Historian and author", city: "Tel Aviv", country: "Israel", lastDays: 162, msgs: 19, tags: ["male"] },
  { wiki: "Malcolm Gladwell", name: "Malcolm Gladwell", org: "Pushkin Industries", headline: "Author, co-founder at Pushkin Industries", city: "New York", country: "United States", lastDays: 66, msgs: 32, tags: ["male", "nyc"] },
  { wiki: "Neil deGrasse Tyson", name: "Neil deGrasse Tyson", org: "Hayden Planetarium", headline: "Astrophysicist, director at the Hayden Planetarium", city: "New York", country: "United States", lastDays: 228, msgs: 11, tags: ["male", "nyc"] },
];

const SAMPLE_THREADS: string[][] = [
  ["are you around for coffee next week?", "yes - tue or thu works, somewhere in soma?", "thu 9am at Sightglass then", "perfect, see you there"],
  ["congrats on the launch, the demo looked great", "thank you! took way longer than we thought", "how's the team holding up?", "tired but happy. we're hiring two more infra people"],
  ["random q: who do you know doing eval tooling?", "a couple people, let me think", "no rush", "sent you two names"],
  ["in town this weekend?", "flying back sunday night unfortunately", "next time then", "yes - I'll ping you when I'm back"],
  ["that essay you sent was excellent", "glad it landed. the second half is the good part", "already reread it twice", "ha, that's the right dose"],
  ["did the intro to the fund ever happen?", "yep, met them monday. good conversation", "nice, keep me posted", "will do"],
  ["saw the trailer, looks incredible", "we shot that scene eleven times", "worth it", "tell that to my knees"],
  ["are you doing anything for your birthday?", "dinner with about ten people, you're invited", "I'm in, what should I bring", "just yourself"],
  ["your set on saturday was unreal", "thank you, the room was so loud I couldn't hear the monitors", "couldn't tell at all", "good, that's the job"],
  ["quick one, do you still have that physio's number?", "yes, sending now", "you're a lifesaver", "he'll make you do the boring exercises though"],
];

const SOURCES = ["imessage", "whatsapp", "imessage", "instagram", "whatsapp"];

/** "Y Combinator" -> "ycombinator.com", "Tesla, SpaceX" -> "tesla.com" */
function orgDomain(org: string): string {
  return `${org.split(",")[0].toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;
}

function isoDaysAgo(days: number, hourOffset = 0): string {
  const d = new Date(Date.now() - days * 86400000 - hourOffset * 3600000);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

const UA = "personal-crm-demo-seed/1.0 (README screenshot)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * upload.wikimedia.org starts 429ing well before a run of this size finishes,
 * and its window is measured in tens of seconds, so the backoff has to be
 * genuinely long. Photos are cached on disk, so a re-run fills any gaps.
 */
const BACKOFF_MS = [5_000, 15_000, 45_000, 90_000];

async function get(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return res;
    await res.body?.cancel();
    if (res.status !== 429 && res.status < 500) return null;
    if (attempt === BACKOFF_MS.length) return null;
    await sleep(BACKOFF_MS[attempt]);
  }
  return null;
}

/**
 * upload.wikimedia.org only serves a fixed set of pre-rendered thumbnail
 * widths and 400s anything else ("Use thumbnail sizes listed on ..."), and
 * which sizes exist varies per file. Try the large ones first — the face crop
 * wants pixels — and fall back to the 330px thumbnail the API itself returned.
 */
const THUMB_WIDTHS = [960, 500];

/** Downloads the best available portrait for a Wikipedia title. */
async function wikiPhoto(title: string): Promise<Uint8Array | null> {
  const enc = encodeURIComponent(title.replace(/ /g, "_"));
  const res = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc}`);
  if (!res) return null;
  const data = await res.json();
  const thumb: string | undefined = data?.thumbnail?.source;
  const original: string | undefined = data?.originalimage?.source;

  const candidates: string[] = [];
  if (thumb) {
    const base = thumb.split("?")[0];
    for (const w of THUMB_WIDTHS) candidates.push(base.replace(/\/\d+px-/, `/${w}px-`));
    candidates.push(base);
  }
  if (original) candidates.push(original.split("?")[0]);

  for (const url of candidates) {
    const img = await get(url);
    if (img) return new Uint8Array(await img.arrayBuffer());
    await sleep(150);
  }
  return null;
}

const FACECROP_SRC = new URL("../tools/facecrop.swift", import.meta.url).pathname;
const FACECROP_BIN = new URL("../tools/facecrop", import.meta.url).pathname;

/** Builds the Vision-based cropper on first use; null if Swift isn't around. */
async function facecropBinary(): Promise<string | null> {
  if ((await Deno.stat(FACECROP_BIN).catch(() => null))?.isFile) return FACECROP_BIN;
  const build = new Deno.Command("swiftc", {
    args: ["-O", "-o", FACECROP_BIN, FACECROP_SRC],
    stdout: "null",
    stderr: "piped",
  });
  const out = await build.output().catch(() => null);
  if (out?.success) return FACECROP_BIN;
  console.warn("  facecrop unavailable, using uncropped images");
  return null;
}

/**
 * Reframes a source image as a square avatar around the subject's face.
 * Returns false when no face was found, so the caller keeps the original.
 */
async function faceCrop(bin: string, from: string, to: string): Promise<boolean> {
  const run = new Deno.Command(bin, {
    args: [from, to, "512"],
    stdout: "null",
    stderr: "null",
  });
  const out = await run.output().catch(() => null);
  return out?.success ?? false;
}

async function main() {
  await Deno.mkdir(PHOTOS_DIR, { recursive: true });
  const db = getDb();

  // getDb() only creates the original columns; the live db has picked up more
  // via ad-hoc migrations. Add whatever the API reads so a fresh demo db works.
  const EXTRA_COLUMNS: Array<[string, string]> = [
    ["linkedin_company", "TEXT"],
    ["linkedin_industry", "TEXT"],
    ["linkedin_experiences", "TEXT"],
    ["linkedin_educations", "TEXT"],
    ["linkedin_raw_json", "TEXT"],
    ["profile_picture_url", "TEXT"],
    ["profile_picture_skipped", "INTEGER DEFAULT 0"],
    ["archived", "INTEGER DEFAULT 0"],
    ["stay_in_touch_days", "INTEGER"],
    ["snoozed_until", "TEXT"],
    ["paused", "INTEGER DEFAULT 0"],
    ["notes", "TEXT"],
    ["x_username", "TEXT"],
    ["apple_contact_uuid", "TEXT"],
    ["ig_username", "TEXT"],
    ["ig_raw_json", "TEXT"],
    ["ig_bio", "TEXT"],
    ["ig_profile_pic_url", "TEXT"],
    ["beeper_thread_url", "TEXT"],
    ["fb_name", "TEXT"],
    ["substack_email", "TEXT"],
    ["substack_raw_json", "TEXT"],
    ["normalized_city", "TEXT"],
    ["normalized_country", "TEXT"],
  ];
  const existing = new Set(
    (db.prepare("PRAGMA table_info(contacts)").all() as Array<{ name: string }>)
      .map((r) => r.name),
  );
  for (const [col, type] of EXTRA_COLUMNS) {
    if (!existing.has(col)) db.exec(`ALTER TABLE contacts ADD COLUMN ${col} ${type}`);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS duplicates_cache (
      id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      computed_at TEXT DEFAULT (datetime('now'))
    )
  `);
  const msgCols = new Set(
    (db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>)
      .map((r) => r.name),
  );
  if (!msgCols.has("source")) {
    db.exec("ALTER TABLE messages ADD COLUMN source TEXT DEFAULT 'imessage'");
  }

  // Start from a clean slate so re-running is idempotent.
  for (
    const t of [
      "contact_tags",
      "contact_connections",
      "contact_phones",
      "contact_emails",
      "messages",
      "import_log",
      "contacts",
    ]
  ) {
    db.exec(`DELETE FROM ${t}`);
  }

  const insertContact = db.prepare(`
    INSERT INTO contacts (
      first_name, last_name, display_name, organization,
      linkedin_url, linkedin_headline, linkedin_location, linkedin_company,
      linkedin_enriched_at, x_username, ig_username,
      profile_picture_url, message_count, first_contacted, last_contacted,
      stay_in_touch_days, notes, normalized_city, normalized_country,
      apple_contacts_id, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const cropper = await facecropBinary();
  const rawDir = `${PHOTOS_DIR}/.source`;
  await Deno.mkdir(rawDir, { recursive: true });

  let ok = 0, missing = 0, cropped = 0;
  for (const [i, p] of PEOPLE.entries()) {
    // Keyed by name, not position, so adding people never invalidates the cache.
    const slug = p.name.toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const file = `${slug}.jpg`;
    const raw = `${rawDir}/${file}`;
    const out = `${PHOTOS_DIR}/${file}`;
    let localUrl: string | null = null;

    if (!(await Deno.stat(raw).catch(() => null))?.isFile) {
      await sleep(700);
      const bytes = await wikiPhoto(p.wiki);
      if (bytes) Deno.writeFileSync(raw, bytes);
    }

    if ((await Deno.stat(raw).catch(() => null))?.isFile) {
      if (cropper && await faceCrop(cropper, raw, out)) {
        cropped++;
      } else {
        // No face found: better a wide shot than a blank avatar.
        await Deno.copyFile(raw, out);
        console.warn(`  no face found for ${p.name}, using full image`);
      }
      localUrl = `/photos/${file}`;
      ok++;
    }

    if (!localUrl) {
      missing++;
      console.warn(`  no photo for ${p.name}`);
    }

    const [first, ...rest] = p.name.split(" ");
    insertContact.run(
      first,
      rest.join(" ") || null,
      p.name,
      p.org,
      p.linkedin ?? null,
      p.headline,
      `${p.city}, ${p.country}`,
      p.org,
      isoDaysAgo(30),
      p.x ?? null,
      p.ig ?? null,
      localUrl,
      p.msgs,
      isoDaysAgo(p.lastDays + 400),
      isoDaysAgo(p.lastDays),
      p.cadence ?? null,
      p.notes ?? null,
      p.city,
      p.country,
      1000 + i,
      isoDaysAgo(500),
      isoDaysAgo(p.lastDays),
    );
    const id = Number(db.lastInsertRowId);

    const handle = `+1555${String(1000000 + i * 7919).slice(-7)}`;
    db.prepare("INSERT INTO contact_phones (contact_id, phone, label) VALUES (?,?,?)")
      .run(id, handle, "mobile");
    db.prepare("INSERT INTO contact_emails (contact_id, email, label) VALUES (?,?,?)")
      .run(id, `${first.toLowerCase()}@${orgDomain(p.org)}`, "work");

    for (const tag of p.tags) {
      db.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?,?)").run(id, tag);
    }

    const thread = SAMPLE_THREADS[i % SAMPLE_THREADS.length];
    const source = SOURCES[i % SOURCES.length];
    thread.forEach((text, j) => {
      db.prepare(
        "INSERT INTO messages (handle, contact_id, text, is_from_me, date, source) VALUES (?,?,?,?,?,?)",
      ).run(
        handle,
        id,
        text,
        j % 2 === 0 ? 1 : 0,
        isoDaysAgo(p.lastDays, (thread.length - j) * 3),
        source,
      );
    });
  }

  // A few connections so the "connections" section isn't empty.
  const byName = new Map<string, number>(
    (db.prepare("SELECT id, display_name FROM contacts").all() as Array<
      { id: number; display_name: string }
    >).map((r) => [r.display_name, r.id]),
  );
  const links: Array<[string, string, string]> = [
    ["Sam Altman", "Garry Tan", "yc"],
    ["Sam Altman", "Mira Murati", "coworker"],
    ["Dario Amodei", "Sam Altman", "colleague"],
    ["Drew Houston", "Arash Ferdowsi", "cofounder"],
    ["Alexis Ohanian", "Steve Huffman", "cofounder"],
    ["Paul Graham", "Garry Tan", "yc"],
    ["Nat Friedman", "Dylan Field", "investor"],
    ["Serena Williams", "Alexis Ohanian", "married"],
    ["Zendaya", "Timothée Chalamet", "co-star"],
    ["Rick Rubin", "Malcolm Gladwell", "podcast"],
    ["Mark Cuban", "Ryan Reynolds", "investor"],
    ["Greta Gerwig", "Margot Robbie", "collaborator"],
  ];
  for (const [a, b, type] of links) {
    const ia = byName.get(a), ib = byName.get(b);
    if (ia && ib) {
      db.prepare(
        "INSERT OR IGNORE INTO contact_connections (contact_id_a, contact_id_b, type) VALUES (?,?,?)",
      ).run(Math.min(ia, ib), Math.max(ia, ib), type);
    }
  }

  for (
    const [source, count, days] of [
      ["imessage", 1842, 0],
      ["whatsapp", 967, 1],
      ["apple_contacts", 418, 2],
      ["linkedin", 1204, 21],
      ["call_history", 311, 2],
      ["x", 5083, 45],
      ["instagram", 764, 45],
      ["facebook", 319, 120],
    ] as Array<[string, number, number]>
  ) {
    db.prepare("INSERT INTO import_log (source, ran_at, count) VALUES (?,?,?)")
      .run(source, isoDaysAgo(days), count);
  }

  db.close();
  console.log(
    `Seeded ${PEOPLE.length} demo contacts (${ok} photos, ${cropped} face-cropped, ${missing} missing).`,
  );
}

main();
