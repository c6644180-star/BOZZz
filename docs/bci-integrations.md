# BCI Communication Intelligence

BCI is the `/messages` module: a local workspace that stores conversations in
the existing SQLite database, summarises them, finds unanswered questions and
drafts replies.

**There is no send path.** The backend has no send endpoint, no SMTP client and
no messaging API call. Drafts stay inside BOZZ and are labelled
“Draft only, not sent”. The only way text leaves BOZZ is the user pressing
**Copy** and pasting it into an app themselves.

BCI does not scrape, automate or log in to WhatsApp, Instagram, Telegram or any
other messaging app. It only parses files the user chooses.

## What works

- Store, search, filter and delete conversations locally.
- Import `.txt`, `.json` and user-exported WhatsApp chat text files (preview
  before import).
- Summarise a conversation, list unanswered questions, list messages that need
  attention (questions, money, time-sensitive wording, commitments, requests).
- Draft a reply, rewrite a draft and translate a draft into English, Tamil,
  Tanglish or Hindi (any language name the provider understands).
- Edit the local style profile: language, formality, length, tone and up to 12
  reusable expressions.
- Per-conversation retention and a global default enforced by a cleanup job.
- Voice and command-bar phrases routed through the Intent Map.

## What does not exist

- No BCI hardware, thought-to-text input or brain signal decoding.
- No messaging transport, account login, contact sync or scheduling.
- No background sending of stored messages to an AI provider. Text goes to the
  configured provider only when the user starts an AI action.
- No cloud sync or upload. The database is local.

## Permission

`message_data` is off by default. The backend rejects every `/api/bci/*` data
route until it is granted. `GET /api/bci/provider` is readable before the grant
so the page can disclose which AI provider would be used; it returns no
conversation text.

Grant it from **Settings → Messages**, **Settings → Module permissions**, or the
gate on `/messages`. Every grant and revoke is audited.

## Storage

The existing SQLite database (`data/bozz.sqlite3`) gains these tables:

| Table | Contents |
| --- | --- |
| `bci_conversations` | id, title, source, retention days, timestamps |
| `bci_messages` | sender, text, direction, sent_at |
| `bci_drafts` | text, language, tone, timestamps |
| `bci_settings` | retention default and provider confirmations |
| `bci_style` | the single local style profile |

Messages are stored as plain text in the local file. Deleting a conversation
removes its messages and drafts from the database. “Delete all messages” requires
an explicit confirmation.

### Limits

- 2,000 messages per conversation.
- 20,000 characters per conversation.
- 2 MB per import file.
- Longer conversations are rejected rather than silently truncated.

### Retention

Options: keep 7 days, 30 days, 90 days, or until deleted. The global default
applies to new conversations; a conversation can override it from its title bar.
A cleanup job runs at backend startup and is throttled to at most once an hour
while conversations are listed. Expired conversations are deleted from SQLite
and the cleanup is audited (`bci_retention_cleanup`).

## AI provider disclosure

The provider comes from the existing AI registry (Ollama by default).

- The page always shows the provider and model.
- If the provider runs locally, no confirmation is needed.
- If it is remote, a one-time confirmation per provider is required. AI actions
  are refused until the user confirms; the confirmation is stored locally and
  audited.
- AI actions never run in the background over stored messages.

## AI actions and the Intent Map

Every action creates a real Intent Map task with module `bci` and one of these
action types: `bci.summarise`, `bci.unanswered`, `bci.attention`, `bci.draft`,
`bci.rewrite`, `bci.translate`.

- `UNDERSTAND` and `PLAN` record the recognised action and the message count.
- `APPROVE` is skipped because no message is sent and no external account is
  touched.
- `EXECUTE` records the provider result, or the local-rule pass.
- `VERIFY` records evidence: what was produced, what was stored, and that no
  message was sent.
- `REPORT` links the draft or result.

`unanswered` and `attention` are deterministic local-rule actions. They never
call the AI provider, so their result text is quoted from the stored messages
and their evidence source is `local_rules`. `summarise`, `draft`, `rewrite` and
`translate` call the configured provider and record evidence with source
`model_response`.

Provider failures produce a failed task with no evidence and an honest message.
The UI never claims a draft exists when the provider failed.

## No invented facts

The prompt requires the model to ask rather than invent facts, commitments,
prices or promises. Every unknown detail must be written as:

```
[CONFIRM: short question]
```

A deterministic guard also replaces currency amounts, percentages and clock
times that do not appear in the source conversation with a `[CONFIRM: verify
"..."]` marker. Drafts show every placeholder, block **Copy** until they are
resolved or explicitly dismissed, and removal is saved before copying is
unlocked.

## API

All routes below require `message_data` unless noted.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/bci/provider` | Provider disclosure (no permission needed) |
| POST | `/api/bci/provider/confirm` | One-time remote provider confirmation |
| GET/PUT | `/api/bci/settings` | Retention settings |
| GET/PUT | `/api/bci/style` | Local style profile |
| GET | `/api/bci/conversations?q=&source=&attention=` | Search and filter |
| POST | `/api/bci/conversations` | Create from pasted messages |
| POST | `/api/bci/conversations/delete-all` | Delete all (requires `confirm: true`) |
| GET/PATCH/DELETE | `/api/bci/conversations/{id}` | Read, rename/retention, delete |
| POST | `/api/bci/import/preview` | Parse and preview without storing |
| POST | `/api/bci/import` | Store the parsed conversation |
| GET/POST | `/api/bci/conversations/{id}/drafts` | List or create drafts |
| PATCH/DELETE | `/api/bci/drafts/{id}` | Edit or delete a draft |
| POST | `/api/bci/conversations/{id}/actions` | Run an AI action through the Intent Map |

There is deliberately no route whose path contains `send` or `smtp`; the backend
test suite asserts this.

## Imports

- **WhatsApp export text**: `[dd/mm/yyyy, hh:mm:ss] Name: message`, multiline
  continuation, AM/PM, and a day-first/month-first fallback. “Me”, “You”,
  “Myself” and “Self” are treated as outbound.
- **JSON**: `messages`, `items`, `chat` or `history`; aliases for sender, text
  and timestamp; epoch seconds/milliseconds or ISO dates.
- **Plain text**: `Name: message` lines, or a single text blob.
- **Paste**: the same parser with a filename chosen in the app.

The preview shows the detected format, counts, date range, warnings and the first
50 messages. Import stores every parsed message.

## Voice and command bar

These phrases are handled before file-search commands so “open messages” opens
the workspace rather than searching for a file:

- “open messages”, “show BCI messages”
- “summarise my messages”, “summarise the conversation”
- “any unanswered questions”, “check unanswered questions”
- “what needs attention”, “show messages that need attention”
- “draft a reply”, “write a reply to Priya about the quote”
- “translate my draft to Tamil”

The reply states the provider, what happened and that nothing was sent. If
message access is off or a remote provider is unconfirmed, the reply says so and
makes no AI request.

## Verification

Automated coverage includes:

- WhatsApp/JSON/text parsing, preview caps and full import.
- Message and character limits.
- Retention cleanup deleting only expired conversations.
- Attention and unanswered local rules.
- Remote provider confirmation and refusal before confirmation.
- Draft storage, `[CONFIRM]` placeholders, style in the prompt.
- Failed provider tasks with no evidence.
- Delete-all confirmation.
- Search/source/attention filters.
- “No send path exists”: no service method contains “send”, no API route contains
  “send” or “smtp”.

Manual browser checklist:

1. Open `/messages` with message data off; confirm the gate and provider
   disclosure, then grant access.
2. Load the Simulation sample; the source chip and banner must say Simulation.
3. Run Summarise, Unanswered, Needs attention and Draft reply; each should open
   an Intent Map task. Summarise and Draft reply show `model_response` evidence;
   Unanswered and Needs attention show `local_rules` evidence and quote the
   stored messages without calling the provider.
4. A draft with a placeholder must block Copy until resolved or dismissed.
5. Delete a conversation and use Delete all; both must ask for confirmation.
6. In Settings → Messages set retention and save the style profile.
7. Say “summarise my messages” and confirm the same result appears on the page.

## Beginner commands

From the repository root:

```bash
# Backend
PYTHONPATH=backend ./.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000

# Frontend (second terminal)
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173/messages`. The backend must be running for storage
and AI actions. If the configured AI provider is offline, the page still opens
and reports the real provider error; it does not fake an answer.
