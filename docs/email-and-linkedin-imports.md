# Gmail and LinkedIn message history

## Gmail: exact matching to existing contacts

```bash
deno task --cwd server import-gmail --alias other-address@example.com
deno task --cwd server test-gmail
```

The Gmail importer requires Python 3, with no additional packages. It uses OAuth
credentials in `~/.gmail-mcp/credentials.json` and client configuration in
`~/.gmail-mcp/gcp-oauth.keys.json`, as used by the Gmail AutoAuth MCP server.
Alternatively, provide `--auth-dir /path/to/oauth-directory`. OAuth credentials
must permit reading Gmail. The importer itself calls only read endpoints.

The account address is discovered from Gmail. Repeat `--alias` for additional
addresses you send or receive mail as, and supply the same aliases on each run.

Only exact addresses already linked through `contact_emails` to an unarchived
CRM contact qualify. Calendar-linked addresses qualify once the calendar importer
has linked them. Ambiguous matches are skipped. Unmatched mail never creates a
contact; names are not used to guess identities. Incoming mail must address you
directly, and outgoing mail must address the contact directly. Cc alone does not
qualify. Spam, Trash and Drafts are excluded.

The first run backfills all available history for qualifying addresses. Later
runs fetch changes using Gmail's history cursor, plus historical mail for newly
linked addresses. An expired cursor triggers reconciliation. Use `--full` to
force reconciliation. Message IDs prevent duplicates, and the history cursor
advances only after a successful run. Interrupted runs can be retried.

Gmail records store subjects, UTC timestamps, direction and message/thread IDs,
not message bodies or attachments. Deleted messages, changed spam/trash labels
and removed contact eligibility are reconciled on later runs.

Use `--db /absolute/path/to/crm.db` to select an existing database explicitly.
Run the command again to sync; it does not install an automatic schedule.

## LinkedIn: exported messages.csv

Request a data archive from LinkedIn's data privacy settings and extract it:

```bash
deno task --cwd server import-linkedin-messages /absolute/path/to/messages.csv --self https://www.linkedin.com/in/your-profile
deno task --cwd server test-linkedin-messages
```

Your profile URL identifies incoming versus outgoing messages. The importer
matches participants by profile URL and merge redirects, then by a unique name
only if that contact has no LinkedIn URL. Unknown participants get new contacts.
Group conversations and invalid/missing participant URLs or dates are skipped
and counted. This differs from Gmail's existing-contact-only policy.

Repeat or overlapping exports do not duplicate messages. Conversation ID,
participants, timestamp, subject and content form a message fingerprint; export
rows identical in all those fields cannot be distinguished without message IDs.
Archive times without explicit offsets are interpreted as UTC. Message counts
and first/last contact timestamps include existing sources too.
