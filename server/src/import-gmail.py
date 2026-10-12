#!/usr/bin/env python3
"""Read-only Gmail API -> existing CRM contacts. No external Python packages."""
import argparse
import concurrent.futures
import datetime as dt
import email.utils
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


class Gmail:
    def __init__(self, config):
        self.config = config
        self.token = None
        self.expires = 0

    def authenticate(self):
        creds = json.loads((self.config / 'credentials.json').read_text())
        keys = json.loads((self.config / 'gcp-oauth.keys.json').read_text())
        client = keys.get('installed', keys.get('web'))
        body = urllib.parse.urlencode(dict(
            client_id=client['client_id'], client_secret=client['client_secret'],
            refresh_token=creds['refresh_token'], grant_type='refresh_token',
        )).encode()
        with urllib.request.urlopen(urllib.request.Request(
            'https://oauth2.googleapis.com/token', data=body,
        ), timeout=40) as response:
            data = json.load(response)
        self.token = data['access_token']
        self.expires = time.time() + data.get('expires_in', 3600) - 120

    def get(self, path, params=None):
        if time.time() >= self.expires:
            self.authenticate()
        url = 'https://gmail.googleapis.com/gmail/v1/users/me/' + path
        if params:
            url += '?' + urllib.parse.urlencode(params, doseq=True)
        for attempt in range(5):
            try:
                request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + self.token})
                with urllib.request.urlopen(request, timeout=45) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                if error.code not in (429, 500, 502, 503, 504) or attempt == 4:
                    raise
                time.sleep(2 ** attempt)


def schema(db):
    db.executescript('''
        CREATE TABLE IF NOT EXISTS gmail_sync_state (
          account TEXT PRIMARY KEY, history_id TEXT NOT NULL,
          address_map TEXT NOT NULL, synced_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS gmail_message_links (
          account TEXT NOT NULL, gmail_id TEXT NOT NULL, thread_id TEXT NOT NULL,
          crm_message_id INTEGER NOT NULL REFERENCES messages(id),
          PRIMARY KEY(account, gmail_id, crm_message_id)
        );
        CREATE INDEX IF NOT EXISTS gmail_link_message ON gmail_message_links(crm_message_id);
    ''')


def allowlist(db):
    # Ambiguous emails and archived contacts do not qualify. No display-name
    # matching, contact creation, alias guessing, or LLM classification.
    rows = db.execute('''SELECT lower(trim(e.email)), min(c.id), count(DISTINCT c.id)
        FROM contact_emails e JOIN contacts c ON c.id=e.contact_id
        WHERE c.archived=0 GROUP BY lower(trim(e.email))''')
    return {addr: cid for addr, cid, count in rows
            if count == 1 and re.fullmatch(r'[^\s<>"{}()]+@[^\s<>"{}()]+', addr)}


def addresses(value):
    return {addr.lower() for _, addr in email.utils.getaddresses([value or '']) if addr}


def eligible(message, allowed, own):
    labels = set(message.get('labelIds', []))
    if labels & {'SPAM', 'TRASH', 'DRAFT'}:
        return {}
    h = {item['name'].lower(): item['value'] for item in message.get('payload', {}).get('headers', [])}
    sender = addresses(h.get('from'))
    to = addresses(h.get('to'))
    if len(sender) != 1:
        return {}
    outgoing = bool(sender & own) or 'SENT' in labels
    if outgoing:
        peers = to - own
    elif to & own:
        peers = sender - own
    else:
        return {}  # Being Cc'd does not establish direct contact.
    result = {}
    for addr in sorted(peers):
        if addr in allowed:
            result[allowed[addr]] = (addr, int(outgoing), h.get('subject') or '(no subject)')
    return result


def scan(api, allowed):
    ids = set()
    emails = sorted(allowed)
    for start in range(0, len(emails), 20):
        terms = ' '.join(f'from:{addr} to:{addr}' for addr in emails[start:start + 20])
        params = {'q': '{' + terms + '} -in:spam -in:trash -in:drafts', 'maxResults': 500}
        while True:
            page = api.get('messages', params)
            ids.update(m['id'] for m in page.get('messages', []))
            if not page.get('nextPageToken'):
                break
            params['pageToken'] = page['nextPageToken']
    return ids


def changes(api, cursor):
    ids = set()
    params = {'startHistoryId': cursor, 'maxResults': 500}
    while True:
        page = api.get('history', params)
        for record in page.get('history', []):
            for m in record.get('messages', []):
                ids.add(m['id'])
            for kind in ('messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved'):
                ids.update(item['message']['id'] for item in record.get(kind, []))
        if not page.get('nextPageToken'):
            return ids, page.get('historyId', cursor)
        params['pageToken'] = page['nextPageToken']


def sync(db, api, aliases=(), force=False):
    schema(db)
    profile = api.get('profile')
    account = profile['emailAddress'].lower()
    own = {account, *(addr.lower() for addr in aliases)}
    allowed = {addr: cid for addr, cid in allowlist(db).items() if addr not in own}
    state = db.execute('SELECT history_id,address_map FROM gmail_sync_state WHERE account=?', (account,)).fetchone()
    previous = json.loads(state[1]) if state else {}
    full = force or not state
    ids = set()
    cursor = profile['historyId']  # Save the boundary from BEFORE the full scan.
    if not full:
        try:
            ids, cursor = changes(api, state[0])
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            full = True  # Expired history: rescan only allowed correspondents.
    new = {addr: cid for addr, cid in allowed.items() if previous.get(addr) != cid}
    ids.update(scan(api, allowed if full else new))
    # Revisit persisted links on full sync or eligibility changes, including
    # deletion/spam transitions omitted from messages.list.
    if full or previous != allowed:
        ids.update(row[0] for row in db.execute('SELECT DISTINCT gmail_id FROM gmail_message_links WHERE account=?', (account,)))
    stats = dict(account=account, mode='full' if full else 'incremental',
                 allowed_addresses=len(allowed), checked=len(ids), inserted=0, removed=0, unchanged=0)
    print(json.dumps({'stage': 'fetch', **stats}), flush=True)
    def fetch(mid):
        try:
            return mid, api.get('messages/' + mid, {'format': 'metadata', 'metadataHeaders': ['From', 'To', 'Cc', 'Subject', 'Date']})
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return mid, None
            raise
    touched = set()
    # Per-page commits allow a failed long backfill to resume idempotently.
    # Only the final successful transaction advances the history cursor.
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for number, (mid, message) in enumerate(pool.map(fetch, sorted(ids)), 1):
            with db:
                wanted = eligible(message, allowed, own) if message else {}
                links = db.execute('''SELECT l.crm_message_id,m.contact_id,m.handle,m.text,m.date,m.is_from_me
                    FROM gmail_message_links l JOIN messages m ON m.id=l.crm_message_id
                    WHERE l.account=? AND l.gmail_id=?''', (account, mid)).fetchall()
                existing = {row[1]: row for row in links}
                for row in links:
                    if row[1] not in wanted:
                        db.execute('DELETE FROM gmail_message_links WHERE crm_message_id=?', (row[0],))
                        db.execute('DELETE FROM messages WHERE id=?', (row[0],))
                        touched.add(row[1]); stats['removed'] += 1
                for cid, (addr, outgoing, subject) in wanted.items():
                    date = dt.datetime.fromtimestamp(int(message['internalDate']) / 1000, dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
                    values = ('gmail:' + addr, '✉ ' + subject, date, outgoing)
                    old = existing.get(cid)
                    if old:
                        if tuple(old[2:]) != values:
                            db.execute('UPDATE messages SET handle=?,text=?,date=?,is_from_me=? WHERE id=?', (*values, old[0]))
                            touched.add(cid)
                        stats['unchanged'] += 1
                    else:
                        crm_id = db.execute("INSERT INTO messages(handle,text,date,is_from_me,source,contact_id) VALUES (?,?,?,?,'gmail',?)", (*values, cid)).lastrowid
                        db.execute('INSERT INTO gmail_message_links VALUES (?,?,?,?)', (account, mid, message.get('threadId', mid), crm_id))
                        touched.add(cid); stats['inserted'] += 1
                # Counts remain consistent even if a later network request fails.
                for cid in {row[1] for row in links} | set(wanted):
                    if cid in touched:
                        db.execute('''UPDATE contacts SET
                            message_count=(SELECT count(*) FROM messages WHERE contact_id=?),
                            first_contacted=(SELECT min(date) FROM messages WHERE contact_id=?),
                            last_contacted=(SELECT max(date) FROM messages WHERE contact_id=?),
                            updated_at=datetime('now') WHERE id=?''', (cid,) * 4)
            if number % 200 == 0:
                print(json.dumps({'progress': number, **stats}), flush=True)
    with db:
        db.execute('''INSERT INTO gmail_sync_state VALUES (?,?,?,datetime('now'))
            ON CONFLICT(account) DO UPDATE SET history_id=excluded.history_id,
            address_map=excluded.address_map,synced_at=excluded.synced_at''', (account, cursor, json.dumps(allowed)))
        db.execute("INSERT INTO import_log(source,count) VALUES ('gmail',?)", (stats['inserted'],))
    stats['contacts_touched'] = len(touched)
    return stats


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=Path(__file__).resolve().parents[2] / 'crm.db')
    parser.add_argument('--auth-dir', type=Path, default=Path.home() / '.gmail-mcp')
    parser.add_argument('--alias', action='append', default=[])
    parser.add_argument('--full', action='store_true', help='Reconcile all allowed history, not only changes')
    args = parser.parse_args()
    # mode=rw refuses to create a new database accidentally.
    db = sqlite3.connect(args.db.resolve().as_uri() + '?mode=rw', uri=True, timeout=30)
    db.execute('PRAGMA foreign_keys=ON')
    try:
        print(json.dumps({'stage': 'DONE', **sync(db, Gmail(args.auth_dir), args.alias, args.full)}), flush=True)
    finally:
        db.close()
