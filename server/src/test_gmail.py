import importlib.util
import sqlite3
import unittest
import urllib.error
from pathlib import Path

spec = importlib.util.spec_from_file_location('gmail', Path(__file__).with_name('import-gmail.py'))
gmail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gmail)


def message(mid='1', sender='friend@example.com', to='me@example.com', labels=None):
    return dict(id=mid, threadId='thread', internalDate='1704067200000',
                labelIds=labels or [], payload={'headers': [
                    {'name': 'From', 'value': sender}, {'name': 'To', 'value': to},
                    {'name': 'Subject', 'value': 'Hello'},
                    {'name': 'Cc', 'value': 'stranger@example.com'}]})


class API:
    def __init__(self):
        self.messages = {'1': message()}
        self.calls = []
        self.history = []
        self.expired = False
        self.fail = False

    def get(self, path, params=None):
        self.calls.append((path, params))
        if path == 'profile': return {'emailAddress': 'me@example.com', 'historyId': '100'}
        if path == 'messages':
            # Include irrelevant hits deliberately: importer must enforce local
            # eligibility even if Gmail search is broader than expected.
            return {'messages': [{'id': mid} for mid in self.messages]}
        if path == 'history':
            if self.expired: raise urllib.error.HTTPError('', 404, 'expired', {}, None)
            return {'historyId': '200', 'history': [{'messages': [{'id': mid} for mid in self.history]}]}
        if path.startswith('messages/'):
            if self.fail: raise RuntimeError('network failure')
            mid = path.split('/')[1]
            if mid not in self.messages: raise urllib.error.HTTPError('', 404, 'deleted', {}, None)
            return self.messages[mid]
        raise AssertionError(path)


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.executescript('''
          CREATE TABLE contacts(id INTEGER PRIMARY KEY,display_name TEXT,archived INTEGER DEFAULT 0,
            message_count INTEGER DEFAULT 0,first_contacted TEXT,last_contacted TEXT,updated_at TEXT);
          CREATE TABLE contact_emails(contact_id INTEGER,email TEXT);
          CREATE TABLE messages(id INTEGER PRIMARY KEY,contact_id INTEGER REFERENCES contacts(id),
            handle TEXT,text TEXT,date TEXT,is_from_me INTEGER,source TEXT);
          CREATE TABLE import_log(source TEXT,count INTEGER);
          INSERT INTO contacts(id,display_name) VALUES(1,'Friend'),(2,'Other');
          INSERT INTO contact_emails VALUES(1,'friend@example.com');
        ''')
        self.api = API()

    def tearDown(self): self.db.close()

    def test_only_linked_email_never_names_or_cc(self):
        self.api.messages.update({'2': message('2','Friend <stranger@example.com>'),
                                  '3': message('3',to='someone@example.com')})
        result = gmail.sync(self.db, self.api)
        self.assertEqual(result['inserted'], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM contacts').fetchone()[0], 2)
        self.assertEqual(self.db.execute('SELECT message_count FROM contacts WHERE id=1').fetchone()[0], 1)

    def test_replay_and_incremental(self):
        gmail.sync(self.db,self.api)
        self.assertEqual(gmail.sync(self.db,self.api)['inserted'],0)
        self.api.messages['2'] = message('2','me@example.com','friend@example.com',['SENT'])
        self.api.history = ['1','2']
        self.assertEqual(gmail.sync(self.db,self.api)['inserted'],1)
        self.assertEqual([r[0] for r in self.db.execute('SELECT is_from_me FROM messages ORDER BY id')],[0,1])

    def test_new_calendar_email_gets_backfill(self):
        gmail.sync(self.db,self.api)
        self.db.execute("INSERT INTO contact_emails VALUES(2,'new@example.com')")
        self.api.messages['2'] = message('2','new@example.com')
        result = gmail.sync(self.db,self.api)
        self.assertEqual(result['inserted'],1)
        self.assertTrue(any(path=='messages' and 'new@example.com' in params['q'] for path,params in self.api.calls))

    def test_deleted_spam_draft_and_archived_removed(self):
        gmail.sync(self.db,self.api)
        self.api.messages['1']['labelIds']=['TRASH']
        self.api.history=['1']
        self.assertEqual(gmail.sync(self.db,self.api)['removed'],1)
        self.api.messages['1']['labelIds']=[]
        gmail.sync(self.db,self.api)
        self.db.execute('UPDATE contacts SET archived=1 WHERE id=1')
        self.assertEqual(gmail.sync(self.db,self.api)['removed'],1)
        for label in ['SPAM','DRAFT']:
            self.assertEqual(gmail.eligible(message(labels=[label]),{'friend@example.com':1},{'me@example.com'}),{})

    def test_expired_cursor_and_network_failure(self):
        gmail.sync(self.db,self.api)
        self.api.expired=True
        self.assertEqual(gmail.sync(self.db,self.api)['mode'],'full')
        self.api.expired=False; self.api.fail=True; self.api.history=['1']
        before=self.db.execute('SELECT history_id FROM gmail_sync_state').fetchone()
        with self.assertRaises(RuntimeError): gmail.sync(self.db,self.api)
        self.assertEqual(self.db.execute('SELECT history_id FROM gmail_sync_state').fetchone(),before)

    def test_ambiguous_emails_and_aliases(self):
        self.db.execute("INSERT INTO contact_emails VALUES(2,'FRIEND@example.com')")
        self.assertEqual(gmail.allowlist(self.db),{})
        self.assertEqual(gmail.eligible(message(sender='alias@example.com',to='friend@example.com'),{'friend@example.com':1},{'me@example.com','alias@example.com'})[1][1],1)

    def test_message_and_history_pagination(self):
        calls=[]
        class Pages:
            def get(_,path,params):
                calls.append((path,dict(params)))
                if path=='messages':
                    return {'messages':[{'id':'2' if params.get('pageToken') else '1'}], **({} if params.get('pageToken') else {'nextPageToken':'next'})}
                return {'history':[{'messagesAdded':[{'message':{'id':'2' if params.get('pageToken') else '1'}}]}], 'historyId':'300', **({} if params.get('pageToken') else {'nextPageToken':'next'})}
        self.assertEqual(gmail.scan(Pages(),{'friend@example.com':1}),{'1','2'})
        self.assertEqual(gmail.changes(Pages(),'100'),({'1','2'},'300'))
        self.assertEqual(len(calls),4)

    def test_contact_reassigned_without_duplicates(self):
        gmail.sync(self.db,self.api)
        self.db.execute('UPDATE contact_emails SET contact_id=2')
        result=gmail.sync(self.db,self.api)
        self.assertEqual((result['inserted'],result['removed']),(1,1))
        self.assertEqual(self.db.execute('SELECT contact_id FROM messages').fetchall(),[(2,)])
        self.assertEqual(self.db.execute('SELECT message_count FROM contacts ORDER BY id').fetchall(),[(0,),(1,)])

    def test_multi_recipient_and_query_duplicate(self):
        self.db.execute("INSERT INTO contact_emails VALUES(2,'other@example.com')")
        self.api.messages['1']=message(sender='me@example.com',to='friend@example.com, other@example.com, stranger@example.com',labels=['SENT'])
        self.assertEqual(gmail.sync(self.db,self.api)['inserted'],2)
        self.assertEqual(gmail.sync(self.db,self.api,force=True)['inserted'],0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM contacts').fetchone()[0],2)

    def test_write_failure_does_not_advance_cursor(self):
        gmail.schema(self.db)
        self.db.execute("CREATE TRIGGER fail_link BEFORE INSERT ON gmail_message_links BEGIN SELECT RAISE(ABORT,'failed link'); END")
        with self.assertRaises(sqlite3.IntegrityError): gmail.sync(self.db,self.api)
        self.assertEqual(self.db.execute('SELECT count(*) FROM messages').fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM gmail_sync_state').fetchone()[0],0)


if __name__=='__main__': unittest.main()
