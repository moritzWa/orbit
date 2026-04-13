import { getDb } from './db.ts';

const API_HOST = 'fresh-linkedin-profile-data.p.rapidapi.com';
const API_KEY = Deno.env.get('RAPIDAPI_KEY');

if (!API_KEY) {
  console.error('Set RAPIDAPI_KEY in .env');
  Deno.exit(1);
}

async function fetchProfile(
  linkedinUrl: string
): Promise<Record<string, unknown> | null> {
  const apiUrl = `https://${API_HOST}/enrich-lead?linkedin_url=${encodeURIComponent(linkedinUrl)}&include_skills=false&include_certifications=false&include_publications=false&include_honors=false&include_volunteers=false&include_projects=false&include_patents=false&include_courses=false&include_organizations=false&include_profile_status=false&include_company_public_url=true`;

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      headers: {
        'x-rapidapi-key': API_KEY!,
        'x-rapidapi-host': API_HOST,
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    console.error(`  Fetch error: ${(e as Error).message}`);
    return null;
  }

  if (res.status === 402 || res.status === 429) {
    console.error(`API credits exhausted (${res.status}). Stopping.`);
    Deno.exit(1);
  }

  if (!res.ok) {
    console.error(`  API error ${res.status}: ${await res.text()}`);
    return null;
  }

  const json = await res.json();
  return json.data ?? null;
}

export async function enrichLinkedIn(limit: number, refresh: boolean) {
  const db = getDb();

  const whereClause = refresh
    ? "linkedin_url IS NOT NULL AND (linkedin_enriched_at IS NULL OR linkedin_enriched_at < datetime('now', '-90 days') OR linkedin_enriched_at = 'failed')"
    : "linkedin_url IS NOT NULL AND (linkedin_enriched_at IS NULL OR linkedin_enriched_at = 'failed')";

  const contacts = db
    .prepare(
      `
    SELECT id, display_name, linkedin_url
    FROM contacts
    WHERE ${whereClause}
    ORDER BY message_count DESC
    LIMIT ?
  `
    )
    .all(limit) as Array<{
    id: number;
    display_name: string;
    linkedin_url: string;
  }>;

  if (contacts.length === 0) {
    console.log('No contacts to enrich.');
    db.close();
    return;
  }

  console.log(
    `About to enrich ${contacts.length} contacts (~${contacts.length} API credits)`
  );

  const update = db.prepare(`
    UPDATE contacts SET
      linkedin_headline = ?,
      linkedin_location = ?,
      linkedin_summary = ?,
      linkedin_company = ?,
      linkedin_industry = ?,
      linkedin_experiences = ?,
      linkedin_educations = ?,
      linkedin_raw_json = ?,
      linkedin_enriched_at = datetime('now'),
      organization = COALESCE(?, organization),
      updated_at = datetime('now')
    WHERE id = ?
  `);

  const insertSnapshot = db.prepare(
    'INSERT INTO linkedin_snapshots (contact_id, raw_json) VALUES (?, ?)'
  );

  const markFailed = db.prepare(
    "UPDATE contacts SET linkedin_enriched_at = 'failed', updated_at = datetime('now') WHERE id = ?"
  );

  let enriched = 0;
  let failed = 0;

  for (const contact of contacts) {
    console.log(`  ${contact.display_name}...`);
    const data = await fetchProfile(contact.linkedin_url);

    if (!data) {
      markFailed.run(contact.id);
      failed++;
      continue;
    }

    const rawJson = JSON.stringify(data);
    const experiences = (
      (data.experiences as Array<Record<string, unknown>>) ?? []
    ).map((e) => ({
      company: e.company ?? '',
      title: e.title ?? '',
      date_range: e.date_range ?? '',
      is_current: e.is_current ?? false,
    }));
    const educations = (
      (data.educations as Array<Record<string, unknown>>) ?? []
    ).map((e) => ({
      school: e.school ?? '',
      degree: e.degree ?? '',
      field_of_study: e.field_of_study ?? '',
    }));

    update.run(
      (data.headline as string) ?? null,
      (data.location as string) ?? null,
      (data.about as string) ?? null,
      (data.company as string) ?? null,
      (data.company_industry as string) ?? null,
      JSON.stringify(experiences),
      JSON.stringify(educations),
      rawJson,
      (data.company as string) ?? null,
      contact.id
    );

    insertSnapshot.run(contact.id, rawJson);

    // Download profile pic if available and contact doesn't have one
    const profileImageUrl = data.profile_image_url as string | undefined;
    if (profileImageUrl) {
      const existing = db
        .prepare('SELECT profile_picture_url FROM contacts WHERE id = ?')
        .get(contact.id) as { profile_picture_url: string | null };
      if (!existing.profile_picture_url) {
        try {
          const picRes = await fetch(profileImageUrl);
          if (picRes.ok) {
            const picData = new Uint8Array(await picRes.arrayBuffer());
            const photosDir = new URL(
              '../../exports/contact-photos',
              import.meta.url
            ).pathname;
            const filename = `${contact.id}.jpg`;
            Deno.writeFileSync(`${photosDir}/${filename}`, picData);
            db.prepare(
              'UPDATE contacts SET profile_picture_url = ? WHERE id = ?'
            ).run(`/photos/${filename}`, contact.id);
          }
        } catch (e) {
          console.error(`  Photo download failed for ${contact.display_name}: ${(e as Error).message}`);
        }
      }
    }

    enriched++;

    // Rate limit
    await new Promise((r) => setTimeout(r, 500));
  }

  db.close();
  console.log(`Done: ${enriched} enriched, ${failed} failed`);
}

if (import.meta.main) {
  const refresh = Deno.args.includes('--refresh');
  const limitArg = Deno.args.find((a) => !a.startsWith('-'));
  const limit = parseInt(limitArg ?? '10');
  await enrichLinkedIn(limit, refresh);
}
