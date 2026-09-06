import { getDb } from "./db.ts";

const db = getDb();
const PORT = 3001;
const PHOTOS_DIR = Deno.env.get("CRM_PHOTOS_DIR") ??
  new URL("../../exports/contact-photos", import.meta.url).pathname;
const SERPER_KEY = Deno.env.get("SERPER_API_KEY");


// Simple rate limiter for Serper (max 4 req/sec)
const serperQueue: Array<{ resolve: (v: unknown) => void }> = [];
let serperInFlight = 0;
const SERPER_MAX_CONCURRENT = 3;
const SERPER_DELAY_MS = 350;

async function withSerperRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (serperInFlight >= SERPER_MAX_CONCURRENT) {
    await new Promise((resolve) => serperQueue.push({ resolve }));
  }
  serperInFlight++;
  try {
    const result = await fn();
    return result;
  } finally {
    serperInFlight--;
    await new Promise((r) => setTimeout(r, SERPER_DELAY_MS));
    const next = serperQueue.shift();
    if (next) next.resolve(undefined);
  }
}
const GROQ_KEY = Deno.env.get("GROQ_API_KEY");

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

// Write-through cache: remove groups containing any of the given contact IDs
function evictFromDuplicatesCache(contactIds: number[]) {
  const cached = db.prepare("SELECT data FROM duplicates_cache WHERE id = 1").get() as { data: string } | undefined;
  if (!cached) return;
  try {
    const parsed = JSON.parse(cached.data);
    const idSet = new Set(contactIds);
    parsed.groups = parsed.groups.filter((g: { ids: number[] }) =>
      !g.ids.some((id: number) => idSet.has(id))
    );
    db.prepare("UPDATE duplicates_cache SET data = ?, computed_at = datetime('now') WHERE id = 1").run(JSON.stringify(parsed));
  } catch (e) { console.error("Cache eviction error:", (e as Error).message); }
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // GET /api/contacts?sort=recent&q=search&limit=50&offset=0&needs_photo=1
  if (path === "/api/contacts" && req.method === "GET") {
    const sort = url.searchParams.get("sort") ?? "recent";
    const q = url.searchParams.get("q") ?? "";
    const limit = parseInt(url.searchParams.get("limit") ?? "50");
    const offset = parseInt(url.searchParams.get("offset") ?? "0");
    const needsPhoto = url.searchParams.get("needs_photo") === "1";

    const orderBy = sort === "messages" ? "message_count DESC"
      : sort === "updated" ? "c.updated_at DESC"
      : "CASE WHEN c.last_contacted IS NULL THEN 1 ELSE 0 END, c.last_contacted DESC";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    // Always hide phone-number-only contacts and archived
    conditions.push("c.display_name NOT GLOB '[+0-9]*'");
    if (url.searchParams.get("show_archived") !== "1") { conditions.push("c.archived = 0"); }
    // Hide X/IG-only contacts (no non-twitter messages, no other data sources) unless filtering by platform
    if (url.searchParams.get("platform") !== "x") {
      conditions.push("NOT (c.x_username IS NOT NULL AND c.linkedin_url IS NULL AND c.apple_contacts_id IS NULL AND c.ig_username IS NULL AND c.fb_name IS NULL AND c.stay_in_touch_days IS NULL AND NOT EXISTS (SELECT 1 FROM contact_tags WHERE contact_id = c.id AND tag IN ('x-mutual','x-following')) AND NOT EXISTS (SELECT 1 FROM messages WHERE contact_id = c.id AND source NOT IN ('twitter')))");
    }
    if (q) { conditions.push("c.display_name LIKE ?"); params.push(`%${q}%`); }
    if (needsPhoto) { conditions.push("c.profile_picture_url IS NULL AND c.profile_picture_skipped = 0"); }
    if (url.searchParams.get("has_linkedin") === "1") { conditions.push("c.linkedin_url IS NOT NULL"); }
    const fav = url.searchParams.get("favorites");
    if (fav === "1") { conditions.push("c.stay_in_touch_days IS NOT NULL"); }
    else if (fav === "0") { conditions.push("c.stay_in_touch_days IS NULL"); }
    if (url.searchParams.get("not_enriched") === "1") { conditions.push("c.linkedin_enriched_at IS NULL"); }
    const platform = url.searchParams.get("platform");
    if (platform === "x") { conditions.push("c.x_username IS NOT NULL"); }
    else if (platform === "linkedin") { conditions.push("c.linkedin_url IS NOT NULL"); }
    else if (platform === "instagram") { conditions.push("c.ig_username IS NOT NULL"); }
    const location = url.searchParams.get("location");
    if (location) {
      // Map city name to common tag aliases
      const tagAliases: Record<string, string[]> = {
        "New York": ["nyc", "new york", "ny"],
        "San Francisco": ["sf", "san francisco", "bay area"],
        "Los Angeles": ["la", "los angeles"],
        "London": ["london"],
        "Berlin": ["berlin"],
      };
      const aliases = tagAliases[location] ?? [location.toLowerCase()];
      const tagPlaceholders = aliases.map(() => "?").join(",");
      conditions.push(`(c.normalized_city = ? OR c.id IN (SELECT contact_id FROM contact_tags WHERE tag IN (${tagPlaceholders})))`);
      params.push(location, ...aliases);
    }
    const company = url.searchParams.get("company");
    if (company) { conditions.push("c.linkedin_company = ?"); params.push(company); }
    const gender = url.searchParams.get("gender");
    if (gender) { conditions.push("c.id IN (SELECT contact_id FROM contact_tags WHERE tag = ?)"); params.push(gender); }
    else if (platform === "whatsapp") { conditions.push("c.id IN (SELECT DISTINCT contact_id FROM messages WHERE source = 'whatsapp' AND contact_id IS NOT NULL)"); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit, offset);

    const contacts = db.prepare(`
      SELECT
        c.id, c.first_name, c.last_name, c.display_name, c.organization,
        c.linkedin_url, c.linkedin_headline, c.linkedin_location,
        c.profile_picture_url, c.stay_in_touch_days, c.snoozed_until, c.paused, c.notes, c.x_username, c.ig_username, c.apple_contact_uuid, c.beeper_thread_url,
        c.message_count, c.first_contacted, c.last_contacted,
        GROUP_CONCAT(DISTINCT p.phone) as phones,
        GROUP_CONCAT(DISTINCT e.email) as emails
      FROM contacts c
      LEFT JOIN contact_phones p ON p.contact_id = c.id
      LEFT JOIN contact_emails e ON e.contact_id = c.id
      ${whereClause}
      GROUP BY c.id
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...params);

    const countParams = q ? [`%${q}%`] : [];
    const total = db.prepare(
      `SELECT COUNT(*) as count FROM contacts c ${whereClause.replace(/LIMIT.*/, "")}`
    ).get(...countParams) as { count: number };

    return json({ contacts, total: total.count });
  }

  // GET /api/contacts/:id
  if (path.match(/^\/api\/contacts\/\d+$/) && req.method === "GET") {
    const id = parseInt(path.split("/").pop()!);
    const contact = db.prepare(`
      SELECT c.*, GROUP_CONCAT(DISTINCT p.phone) as phones, GROUP_CONCAT(DISTINCT e.email) as emails
      FROM contacts c
      LEFT JOIN contact_phones p ON p.contact_id = c.id
      LEFT JOIN contact_emails e ON e.contact_id = c.id
      WHERE c.id = ?
      GROUP BY c.id
    `).get(id);

    if (!contact) return json({ error: "Not found" }, 404);
    return json(contact);
  }

  // GET /api/contacts/:id/messages?limit=50&offset=0
  if (path.match(/^\/api\/contacts\/\d+\/messages$/) && req.method === "GET") {
    const id = parseInt(path.split("/")[3]);
    const limit = parseInt(url.searchParams.get("limit") ?? "50");
    const offset = parseInt(url.searchParams.get("offset") ?? "0");

    const messages = db.prepare(`
      SELECT * FROM (
        SELECT text, is_from_me, date, source
        FROM messages
        WHERE contact_id = ?
        ORDER BY date DESC
        LIMIT ? OFFSET ?
      ) ORDER BY date ASC
    `).all(id, limit, offset);

    return json(messages);
  }

  // PUT /api/contacts/:id/photo - downloads image to disk and stores local URL
  if (path.match(/^\/api\/contacts\/\d+\/photo$/) && req.method === "PUT") {
    const id = parseInt(path.split("/")[3]);
    const body = await req.json();
    const imageUrl = body.url as string;

    try {
      const res = await fetch(imageUrl);
      if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
      const data = new Uint8Array(await res.arrayBuffer());

      const photosDir = PHOTOS_DIR;
      const filename = `${id}.jpg`;
      Deno.writeFileSync(`${photosDir}/${filename}`, data);

      const localUrl = `/photos/${filename}`;
      db.prepare("UPDATE contacts SET profile_picture_url = ?, updated_at = datetime('now') WHERE id = ?").run(localUrl, id);
      return json({ ok: true, url: localUrl });
    } catch (e) {
      // Fallback: store the URL directly if download fails
      db.prepare("UPDATE contacts SET profile_picture_url = ?, updated_at = datetime('now') WHERE id = ?").run(imageUrl, id);
      return json({ ok: true, url: imageUrl, downloaded: false });
    }
  }

  // PUT /api/contacts/:id/skip-photo
  // GET /api/stay-in-touch - contacts due for follow-up
  if (path === "/api/stay-in-touch" && req.method === "GET") {
    const contacts = db.prepare(`
      SELECT c.id, c.display_name, c.profile_picture_url, c.stay_in_touch_days,
        c.last_contacted, c.snoozed_until, c.paused, c.linkedin_headline, c.organization,
        c.message_count,
        GROUP_CONCAT(DISTINCT p.phone) as phones
      FROM contacts c
      LEFT JOIN contact_phones p ON p.contact_id = c.id
      WHERE c.stay_in_touch_days IS NOT NULL
        AND c.paused = 0
        AND c.archived = 0
        AND (c.snoozed_until IS NULL OR c.snoozed_until < datetime('now'))
      GROUP BY c.id
      ORDER BY
        CASE WHEN c.last_contacted IS NULL THEN 0
          ELSE julianday('now') - julianday(c.last_contacted)
        END DESC
    `).all();
    return json({ contacts });
  }

  // PUT /api/contacts/:id/stay-in-touch
  if (path.match(/^\/api\/contacts\/\d+\/stay-in-touch$/) && req.method === "PUT") {
    const id = parseInt(path.split("/")[3]);
    const body = await req.json();
    if ("days" in body) {
      db.prepare("UPDATE contacts SET stay_in_touch_days = ?, updated_at = datetime('now') WHERE id = ?").run(body.days, id);
    }
    if ("paused" in body) {
      db.prepare("UPDATE contacts SET paused = ?, updated_at = datetime('now') WHERE id = ?").run(body.paused ? 1 : 0, id);
    }
    return json({ ok: true });
  }

  // POST /api/contacts/:id/manual-event
  if (path.match(/^\/api\/contacts\/\d+\/manual-event$/) && req.method === "POST") {
    const id = parseInt(path.split("/")[3]);
    const { text, daysAgo } = await req.json() as { text: string; daysAgo: number };
    const date = `datetime('now', '-${daysAgo} days')`;
    db.prepare(`INSERT INTO messages (handle, text, is_from_me, date, source, contact_id) VALUES ('manual', ?, 1, ${date}, 'manual', ?)`).run(text, id);
    // Update last_contacted if this is more recent
    db.prepare(`UPDATE contacts SET last_contacted = MAX(COALESCE(last_contacted, ''), ${date}), updated_at = datetime('now') WHERE id = ?`).run(id);
    return json({ ok: true });
  }

  // PUT /api/contacts/:id/contacted - log interaction and reset stay-in-touch timer
  if (path.match(/^\/api\/contacts\/\d+\/contacted$/) && req.method === "PUT") {
    const id = parseInt(path.split("/")[3]);
    const body = await req.json().catch(() => ({})) as { type?: string; note?: string };
    const type = body.type || "contacted";
    const note = body.note?.trim() || "";
    const text = note ? `[${type}] ${note}` : `[${type}]`;
    db.prepare("INSERT INTO messages (handle, text, is_from_me, date, source, contact_id) VALUES (?, ?, 1, datetime('now'), 'manual', ?)").run(`manual:${id}`, text, id);
    db.prepare("UPDATE contacts SET last_contacted = datetime('now'), snoozed_until = NULL, message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?").run(id);
    return json({ ok: true });
  }

  // PUT /api/contacts/:id/snooze
  if (path.match(/^\/api\/contacts\/\d+\/snooze$/) && req.method === "PUT") {
    const id = parseInt(path.split("/")[3]);
    const { days } = await req.json() as { days: number };
    db.prepare("UPDATE contacts SET snoozed_until = datetime('now', '+' || ? || ' days'), updated_at = datetime('now') WHERE id = ?").run(days, id);
    return json({ ok: true });
  }

  // GET /api/contacts/:id/tags
  if (path.match(/^\/api\/contacts\/\d+\/tags$/) && req.method === "GET") {
    const id = parseInt(path.split("/")[3]);
    const tags = db.prepare("SELECT tag FROM contact_tags WHERE contact_id = ?").all(id) as Array<{ tag: string }>;
    return json({ tags: tags.map((t) => t.tag) });
  }

  // PUT /api/contacts/:id/tags
  if (path.match(/^\/api\/contacts\/\d+\/tags$/) && req.method === "PUT") {
    const id = parseInt(path.split("/")[3]);
    const { tags } = await req.json() as { tags: string[] };
    db.prepare("DELETE FROM contact_tags WHERE contact_id = ?").run(id);
    const insert = db.prepare("INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)");
    for (const tag of tags) {
      insert.run(id, tag.trim().toLowerCase());
    }
    return json({ ok: true });
  }

  // GET /api/tags - list all tags with counts
  if (path === "/api/tags" && req.method === "GET") {
    const tags = db.prepare("SELECT tag, COUNT(*) as count FROM contact_tags GROUP BY tag ORDER BY count DESC").all();
    return json({ tags });
  }

  // GET /api/contacts/:id/connections
  if (path.match(/^\/api\/contacts\/\d+\/connections$/) && req.method === "GET") {
    const id = parseInt(path.split("/")[3]);
    const connections = db.prepare(`
      SELECT cc.id, cc.type,
        CASE WHEN cc.contact_id_a = ? THEN cc.contact_id_b ELSE cc.contact_id_a END as contact_id,
        CASE WHEN cc.contact_id_a = ? THEN cb.display_name ELSE ca.display_name END as display_name,
        CASE WHEN cc.contact_id_a = ? THEN cb.profile_picture_url ELSE ca.profile_picture_url END as profile_picture_url
      FROM contact_connections cc
      JOIN contacts ca ON ca.id = cc.contact_id_a
      JOIN contacts cb ON cb.id = cc.contact_id_b
      WHERE cc.contact_id_a = ? OR cc.contact_id_b = ?
    `).all(id, id, id, id, id);
    return json({ connections });
  }

  // POST /api/contacts/:id/connections
  if (path.match(/^\/api\/contacts\/\d+\/connections$/) && req.method === "POST") {
    const id = parseInt(path.split("/")[3]);
    const { targetId, type } = await req.json() as { targetId: number; type: string };
    const a = Math.min(id, targetId);
    const b = Math.max(id, targetId);
    db.prepare("INSERT OR IGNORE INTO contact_connections (contact_id_a, contact_id_b, type) VALUES (?, ?, ?)").run(a, b, type);
    return json({ ok: true });
  }

  // DELETE /api/contacts/:id/connections/:connId
  if (path.match(/^\/api\/contacts\/\d+\/connections\/\d+$/) && req.method === "DELETE") {
    const connId = parseInt(path.split("/").pop()!);
    db.prepare("DELETE FROM contact_connections WHERE id = ?").run(connId);
    return json({ ok: true });
  }

  // GET /api/companies - top companies for filter
  if (path === "/api/companies" && req.method === "GET") {
    const companies = db.prepare(`
      SELECT linkedin_company as company, COUNT(*) as count FROM contacts
      WHERE linkedin_company IS NOT NULL AND linkedin_company != '' AND archived = 0
      GROUP BY linkedin_company ORDER BY count DESC LIMIT 20
    `).all();
    return json({ companies });
  }

  // GET /api/locations - top cities for filter
  if (path === "/api/locations" && req.method === "GET") {
    const cities = db.prepare(`
      SELECT normalized_city as city, COUNT(*) as count FROM contacts
      WHERE normalized_city IS NOT NULL AND archived = 0
      GROUP BY normalized_city ORDER BY count DESC LIMIT 15
    `).all();
    return json({ cities });
  }

  // GET /api/sync-status
  if (path === "/api/sync-status" && req.method === "GET") {
    const sources = ["imessage", "whatsapp", "apple_contacts", "linkedin", "call_history", "x", "twitter_dms", "instagram", "instagram_enrich", "facebook", "substack"];
    const status = sources.map((source) => {
      const row = db.prepare("SELECT ran_at, count FROM import_log WHERE source = ? ORDER BY ran_at DESC LIMIT 1").get(source) as { ran_at: string; count: number } | undefined;
      return { source, last_ran: row?.ran_at ?? null, last_count: row?.count ?? 0 };
    });
    return json({ status });
  }

  // PUT /api/contacts/:id - update contact fields
  if (path.match(/^\/api\/contacts\/\d+$/) && req.method === "PUT") {
    const id = parseInt(path.split("/").pop()!);
    const body = await req.json();
    const fields: string[] = [];
    const values: (string | null)[] = [];

    for (const key of ["display_name", "first_name", "last_name", "organization", "linkedin_url", "notes", "beeper_thread_url"] as const) {
      if (key in body) {
        fields.push(`${key} = ?`);
        values.push(body[key]);
      }
    }
    if (fields.length === 0) return json({ error: "No fields to update" }, 400);

    fields.push("updated_at = datetime('now')");
    values.push(String(id));
    db.prepare(`UPDATE contacts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return json({ ok: true });
  }

  // PUT /api/contacts/:id/archive
  if (path.match(/^\/api\/contacts\/\d+\/archive$/) && req.method === "PUT") {
    const id = parseInt(path.split("/")[3]);
    db.prepare("UPDATE contacts SET archived = 1, updated_at = datetime('now') WHERE id = ?").run(id);
    evictFromDuplicatesCache([id]);
    return json({ ok: true });
  }

  if (path.match(/^\/api\/contacts\/\d+\/skip-photo$/) && req.method === "PUT") {
    const id = parseInt(path.split("/")[3]);
    db.prepare("UPDATE contacts SET profile_picture_skipped = 1, updated_at = datetime('now') WHERE id = ?").run(id);
    return json({ ok: true });
  }

  // GET /api/image-search?q=query
  if (path === "/api/image-search" && req.method === "GET") {
    const q = url.searchParams.get("q");
    if (!q) return json({ error: "Missing q parameter" }, 400);
    if (!SERPER_KEY) return json({ error: "SERPER_API_KEY not set" }, 500);

    const { res, body } = await withSerperRateLimit(async () => {
      const r = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: {
          "X-API-KEY": SERPER_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q, num: 9 }),
      });
      return { res: r, body: await r.text() };
    });
    console.log(`[image-search] q="${q}" status=${res.status} body_len=${body.length}`);

    if (!res.ok) {
      console.error(`[image-search] ERROR: ${body}`);
      return json({ error: `Serper API error: ${res.status}`, detail: body }, res.status);
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch {
      console.error(`[image-search] Failed to parse JSON: ${body.slice(0, 200)}`);
      return json({ error: "Invalid response from Serper", detail: body.slice(0, 200) }, 500);
    }

    const images = (data.images ?? []).map((img: Record<string, string>) => ({
      title: img.title,
      imageUrl: img.imageUrl,
      thumbnailUrl: img.thumbnailUrl,
      source: img.source,
    }));

    console.log(`[image-search] q="${q}" found ${images.length} images`);
    return json({ images });
  }

  // POST /api/improve-search-queries - LLM improves image search queries for a batch of contacts
  if (path === "/api/improve-search-queries" && req.method === "POST") {
    if (!GROQ_KEY) return json({ error: "GROQ_API_KEY not set" }, 500);

    const { contactIds } = await req.json() as { contactIds: number[] };

    const contacts = db.prepare(`
      SELECT id, display_name, linkedin_headline, linkedin_company, organization, linkedin_location
      FROM contacts WHERE id IN (${contactIds.map(() => "?").join(",")})
    `).all(...contactIds) as Array<{
      id: number; display_name: string; linkedin_headline: string | null;
      linkedin_company: string | null; organization: string | null; linkedin_location: string | null;
    }>;

    // Only send contacts that have some context to work with
    const contactsWithContext = contacts.filter((c) =>
      c.linkedin_headline || c.organization || c.linkedin_company || c.linkedin_location
    );

    if (contactsWithContext.length === 0) {
      return json({ queries: [] });
    }

    const contactDescriptions = contactsWithContext.map((c) => {
      const details = [c.linkedin_headline, c.organization, c.linkedin_company, c.linkedin_location].filter(Boolean).join(" | ");
      return `- ID ${c.id}: "${c.display_name}" (${details})`;
    }).join("\n");

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{
          role: "user",
          content: `For each person below, generate a Google Image search query that will find their face/profile photo. If the name is common/generic (like "Daniel George", "Anna", "John Smith"), add distinguishing keywords from their info (company, title, location). If the name is already unique enough (like "Akshaya Dinesh"), just use their name.

Return JSON array: [{"id": number, "query": "search query"}]
No explanation, just the JSON.

People:
${contactDescriptions}`
        }],
        temperature: 0,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return json({ error: `Grok API error: ${res.status} ${err}` }, res.status);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? "[]";
    // Extract JSON from response (might be wrapped in ```json blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const queries = jsonMatch ? JSON.parse(jsonMatch[0]) : [];

    return json({ queries });
  }

  // GET /api/duplicates - find fuzzy duplicate contacts (db-cached)
  if (path === "/api/duplicates" && req.method === "GET") {
    const refresh = url.searchParams.get("refresh") === "1";

    // Check db cache first
    if (!refresh) {
      const cached = db.prepare("SELECT data FROM duplicates_cache WHERE id = 1").get() as { data: string } | undefined;
      if (cached) {
        const all = JSON.parse(cached.data).groups;
        const limit = parseInt(url.searchParams.get("limit") ?? "20");
        const offset = parseInt(url.searchParams.get("offset") ?? "0");
        return json({ groups: all.slice(offset, offset + limit), total: all.length });
      }
    }
    // Find contacts with similar names using normalized comparison
    const allContacts = db.prepare(`
      SELECT c.id, c.display_name, c.organization, c.linkedin_url, c.profile_picture_url, c.message_count,
        GROUP_CONCAT(DISTINCT p.phone) as phones,
        GROUP_CONCAT(DISTINCT e.email) as emails
      FROM contacts c
      LEFT JOIN contact_phones p ON p.contact_id = c.id
      LEFT JOIN contact_emails e ON e.contact_id = c.id
      WHERE c.display_name IS NOT NULL
        AND c.display_name NOT GLOB '[+0-9]*'
        AND length(c.display_name) > 1
        AND c.archived = 0
        AND c.display_name LIKE '% %'
      GROUP BY c.id
      ORDER BY c.message_count DESC
    `).all() as Array<{
      id: number; display_name: string; organization: string | null;
      linkedin_url: string | null; profile_picture_url: string | null;
      message_count: number; phones: string | null; emails: string | null;
    }>;

    // Normalize: lowercase, remove parentheticals, trim
    const normalize = (n: string) => n.toLowerCase().replace(/\(.*?\)/g, "").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

    // Levenshtein distance for typo detection
    const levenshtein = (a: string, b: string): number => {
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, (_, i) => {
        const row = new Array(n + 1);
        row[0] = i;
        return row;
      });
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1, dp[i][j - 1] + 1,
            dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)
          );
      return dp[m][n];
    };

    const splitName = (n: string) => {
      const parts = n.split(" ");
      return { first: parts[0], last: parts.slice(1).join(" ") };
    };

    const groups: Array<typeof allContacts> = [];
    const used = new Set<number>();

    for (let i = 0; i < allContacts.length; i++) {
      if (used.has(allContacts[i].id)) continue;
      const norm1 = normalize(allContacts[i].display_name);
      const name1 = splitName(norm1);
      const group = [allContacts[i]];

      for (let j = i + 1; j < allContacts.length; j++) {
        if (used.has(allContacts[j].id)) continue;
        const norm2 = normalize(allContacts[j].display_name);
        const name2 = splitName(norm2);

        let match = false;

        // 1. Exact normalized match (case, parentheticals)
        if (norm1 === norm2) match = true;

        // 2. Very close edit distance on full name - max 1 edit for short names, 2 for long names (15+ chars)
        else if (norm1.length > 5 && norm2.length > 5) {
          const dist = levenshtein(norm1, norm2);
          const maxDist = Math.min(norm1.length, norm2.length) >= 15 ? 2 : 1;
          if (dist <= maxDist) match = true;
        }

        // 3. Same last name + identical first name (catches "SooHoon Choi" vs "Soohoon Choi" via rule 2)
        else if (name1.last && name2.last
          && levenshtein(name1.last, name2.last) <= 1
          && name1.first === name2.first) match = true;

        // 4. Shared phone number
        else if (allContacts[i].phones && allContacts[j].phones &&
          allContacts[i].phones.split(",").some((p: string) => allContacts[j].phones!.includes(p))) match = true;

        // Veto: if both have different LinkedIn URLs, they're definitely different people
        if (match && allContacts[i].linkedin_url && allContacts[j].linkedin_url
          && allContacts[i].linkedin_url !== allContacts[j].linkedin_url) match = false;

        if (match) {
          group.push(allContacts[j]);
          used.add(allContacts[j].id);
        }
      }

      if (group.length > 1) {
        used.add(allContacts[i].id);
        groups.push(group);
      }
    }

    // Filter out dismissed pairs
    const dismissed = db.prepare("SELECT contact_id_a, contact_id_b FROM dismissed_duplicates").all() as Array<{ contact_id_a: number; contact_id_b: number }>;
    const dismissedSet = new Set(dismissed.map((d) => `${Math.min(d.contact_id_a, d.contact_id_b)}-${Math.max(d.contact_id_a, d.contact_id_b)}`));

    const filteredGroups = groups.filter((g) => {
      // Remove group if ALL pairs in it have been dismissed
      const ids = g.map((c) => c.id);
      for (let a = 0; a < ids.length; a++) {
        for (let b = a + 1; b < ids.length; b++) {
          const key = `${Math.min(ids[a], ids[b])}-${Math.max(ids[a], ids[b])}`;
          if (!dismissedSet.has(key)) return true; // at least one undismissed pair
        }
      }
      return false;
    });

    const result = filteredGroups.map((g) => ({
      ids: g.map((c) => c.id),
      names: g.map((c) => c.display_name),
      phones: g.map((c) => c.phones),
      emails: g.map((c) => c.emails),
      message_counts: g.map((c) => c.message_count),
      profile_pictures: g.map((c) => c.profile_picture_url),
      linkedin_urls: g.map((c) => c.linkedin_url),
      organizations: g.map((c) => c.organization),
    }));

    // Cache full result, return paginated
    db.prepare("INSERT OR REPLACE INTO duplicates_cache (id, data, computed_at) VALUES (1, ?, datetime('now'))").run(JSON.stringify({ groups: result }));

    const limit = parseInt(url.searchParams.get("limit") ?? "20");
    const offset = parseInt(url.searchParams.get("offset") ?? "0");
    return json({ groups: result.slice(offset, offset + limit), total: result.length });
  }

  // POST /api/dismiss-duplicate
  if (path === "/api/dismiss-duplicate" && req.method === "POST") {
    const { ids } = await req.json() as { ids: number[] };
    const stmt = db.prepare("INSERT OR IGNORE INTO dismissed_duplicates (contact_id_a, contact_id_b) VALUES (?, ?)");
    // Dismiss all pairs in the group
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        stmt.run(Math.min(ids[a], ids[b]), Math.max(ids[a], ids[b]));
      }
    }
    evictFromDuplicatesCache(ids);
    return json({ ok: true });
  }

  // POST /api/merge-contacts
  if (path === "/api/merge-contacts" && req.method === "POST") {
    const { keepId, mergeIds } = await req.json() as { keepId: number; mergeIds: number[] };
    const placeholders = mergeIds.map(() => "?").join(",");

    // Move phones, emails, messages to the kept contact
    db.prepare(`UPDATE OR IGNORE contact_phones SET contact_id = ? WHERE contact_id IN (${placeholders})`).run(keepId, ...mergeIds);
    db.prepare(`UPDATE OR IGNORE contact_emails SET contact_id = ? WHERE contact_id IN (${placeholders})`).run(keepId, ...mergeIds);
    db.prepare(`UPDATE messages SET contact_id = ? WHERE contact_id IN (${placeholders})`).run(keepId, ...mergeIds);

    // Clean up orphaned phones/emails
    db.prepare(`DELETE FROM contact_phones WHERE contact_id IN (${placeholders})`).run(...mergeIds);
    db.prepare(`DELETE FROM contact_emails WHERE contact_id IN (${placeholders})`).run(...mergeIds);

    // Record merge redirects + copy over linkedin_url/photo if missing
    const kept = db.prepare("SELECT linkedin_url, profile_picture_url FROM contacts WHERE id = ?").get(keepId) as { linkedin_url: string | null; profile_picture_url: string | null };
    const insertRedirect = db.prepare("INSERT OR IGNORE INTO merge_redirects (source, source_id, target_contact_id) VALUES (?, ?, ?)");

    for (const mid of mergeIds) {
      const merged = db.prepare("SELECT apple_contacts_id, linkedin_url, profile_picture_url, x_username FROM contacts WHERE id = ?").get(mid) as {
        apple_contacts_id: number | null; linkedin_url: string | null; profile_picture_url: string | null; x_username: string | null;
      } | undefined;
      if (merged) {
        // Record redirects so re-imports don't recreate this contact
        if (merged.apple_contacts_id) {
          insertRedirect.run("apple", String(merged.apple_contacts_id), keepId);
        }
        if (merged.linkedin_url) {
          insertRedirect.run("linkedin", merged.linkedin_url, keepId);
        }
        if (merged.x_username) {
          insertRedirect.run("x", merged.x_username, keepId);
        }
        // Record email redirects for mbox/calendar re-imports
        const mergedEmails = db.prepare("SELECT email FROM contact_emails WHERE contact_id = ?").all(mid) as Array<{ email: string }>;
        for (const { email } of mergedEmails) {
          insertRedirect.run("mbox", email, keepId);
        }
        // Copy over missing data
        if (!kept.linkedin_url && merged.linkedin_url) {
          db.prepare("UPDATE contacts SET linkedin_url = ? WHERE id = ?").run(merged.linkedin_url, keepId);
        }
        if (!kept.profile_picture_url && merged.profile_picture_url) {
          db.prepare("UPDATE contacts SET profile_picture_url = ? WHERE id = ?").run(merged.profile_picture_url, keepId);
        }
      }
    }

    // Clean up all references before deleting
    db.prepare(`DELETE FROM contact_tags WHERE contact_id IN (${placeholders})`).run(...mergeIds);
    db.prepare(`DELETE FROM contact_phones WHERE contact_id IN (${placeholders})`).run(...mergeIds);
    db.prepare(`DELETE FROM contact_emails WHERE contact_id IN (${placeholders})`).run(...mergeIds);
    db.prepare(`DELETE FROM linkedin_snapshots WHERE contact_id IN (${placeholders})`).run(...mergeIds);
    db.prepare(`DELETE FROM dismissed_duplicates WHERE contact_id_a IN (${placeholders}) OR contact_id_b IN (${placeholders})`).run(...mergeIds, ...mergeIds);
    db.exec("PRAGMA foreign_keys=OFF");
    db.prepare(`DELETE FROM contacts WHERE id IN (${placeholders})`).run(...mergeIds);
    db.exec("PRAGMA foreign_keys=ON");

    // Recalculate message stats
    db.prepare(`
      UPDATE contacts SET
        message_count = (SELECT COUNT(*) FROM messages WHERE messages.contact_id = contacts.id),
        first_contacted = (SELECT MIN(date) FROM messages WHERE messages.contact_id = contacts.id),
        last_contacted = (SELECT MAX(date) FROM messages WHERE messages.contact_id = contacts.id),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(keepId);

    evictFromDuplicatesCache([keepId, ...mergeIds]);
    return json({ ok: true });
  }

  // POST /api/enrich-contact/:id - enrich a single contact via RapidAPI
  if (path.match(/^\/api\/enrich-contact\/\d+$/) && req.method === "POST") {
    const RAPIDAPI_KEY = Deno.env.get("RAPIDAPI_KEY");
    if (!RAPIDAPI_KEY) return json({ error: "RAPIDAPI_KEY not set" }, 500);

    const id = parseInt(path.split("/").pop()!);
    const contact = db.prepare("SELECT linkedin_url FROM contacts WHERE id = ?").get(id) as { linkedin_url: string } | undefined;
    if (!contact?.linkedin_url) return json({ error: "No LinkedIn URL" }, 400);

    const apiUrl = `https://fresh-linkedin-profile-data.p.rapidapi.com/enrich-lead?linkedin_url=${encodeURIComponent(contact.linkedin_url)}&include_skills=false&include_certifications=false&include_publications=false&include_honors=false&include_volunteers=false&include_projects=false&include_patents=false&include_courses=false&include_organizations=false&include_profile_status=false&include_company_public_url=true`;
    const res = await fetch(apiUrl, {
      headers: { "x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": "fresh-linkedin-profile-data.p.rapidapi.com" },
    });

    if (!res.ok) return json({ error: `RapidAPI error: ${res.status}` }, res.status);

    const apiData = await res.json();
    const d = apiData.data;
    if (!d) return json({ error: "No data returned" }, 500);

    const rawJson = JSON.stringify(d);
    const experiences = (d.experiences ?? []).map((e: Record<string, unknown>) => ({
      company: e.company ?? "", title: e.title ?? "", date_range: e.date_range ?? "", is_current: e.is_current ?? false,
    }));
    const educations = (d.educations ?? []).map((e: Record<string, unknown>) => ({
      school: e.school ?? "", degree: e.degree ?? "", field_of_study: e.field_of_study ?? "",
    }));

    db.prepare(`
      UPDATE contacts SET
        linkedin_headline = ?, linkedin_location = ?, linkedin_summary = ?,
        linkedin_company = ?, linkedin_industry = ?,
        linkedin_experiences = ?, linkedin_educations = ?,
        linkedin_raw_json = ?, linkedin_enriched_at = datetime('now'),
        organization = COALESCE(?, organization), updated_at = datetime('now')
      WHERE id = ?
    `).run(
      d.headline ?? null, d.location ?? null, d.about ?? null,
      d.company ?? null, d.company_industry ?? null,
      JSON.stringify(experiences), JSON.stringify(educations),
      rawJson, d.company ?? null, id
    );

    // Download profile pic if available
    let profilePicUrl = null;
    if (d.profile_image_url) {
      try {
        const picRes = await fetch(d.profile_image_url);
        if (picRes.ok) {
          const picData = new Uint8Array(await picRes.arrayBuffer());
          const photosDir = PHOTOS_DIR;
          const filename = `${id}.jpg`;
          Deno.writeFileSync(`${photosDir}/${filename}`, picData);
          profilePicUrl = `/photos/${filename}`;
          db.prepare("UPDATE contacts SET profile_picture_url = ? WHERE id = ?").run(profilePicUrl, id);
        }
      } catch { /* ignore */ }
    }

    // Save snapshot
    db.prepare("INSERT INTO linkedin_snapshots (contact_id, raw_json) VALUES (?, ?)").run(id, rawJson);

    return json({
      ok: true,
      headline: d.headline,
      company: d.company,
      location: d.location,
      profile_picture_url: profilePicUrl,
    });
  }

  // GET /photos/:filename - serve contact photos
  if (path.startsWith("/photos/")) {
    const filename = decodeURIComponent(path.slice(8));
    const photoPath = `${PHOTOS_DIR}/${filename}`;
    try {
      const data = Deno.readFileSync(photoPath);
      return new Response(data, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "max-age=86400" },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  return json({ error: "Not found" }, 404);
}

Deno.serve({ port: PORT }, handler);
console.log(`API server running on http://localhost:${PORT}`);
