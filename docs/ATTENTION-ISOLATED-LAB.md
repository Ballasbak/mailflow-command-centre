# Mail Command Centre — isolated local development lab

Source: Ballasbak/mailflow-command-centre (feature/attention-triage).

This is NOT the working MailFlow lab. The development stack has:
- Its own project, containers, database, private named volume and Redis.
- Browser-only access on http://127.0.0.1:8081.
- No published PostgreSQL, Redis or backend API ports.
- A different hostname from the working http://localhost:8080 to separate
  browser cookies and localStorage (browser cookies are not port-scoped).
- Synthetic test emails ONLY; no real mailbox, shared secrets or IMAP connection.
- Backend/frontend images built from this fork, not pre-built lab images.

## Phase A — preflight (no containers started)

In PowerShell, in C:\Users\fnico\Projects\mailflow-command-centre:

1. Update the feature branch:

       git pull --ff-only

2. Generate private random development secrets locally:

       node scripts/prepare-attention-dev.mjs

   This creates .env.cc-dev only once, without printing any secret. This file
   is ignored by Git and Docker build context. Never share or commit it.

3. Validate the Compose service names (does not expose credentials):

       docker compose -p mailflow-cc-dev --env-file .env.cc-dev -f docker-compose.cc-dev.yml config --services

   Expect the four services frontend, backend, postgres and redis (order
   may vary). Stop and report an error rather than continuing.

## Phase B — start the isolated stack

After preflight, in the SAME source directory:

    docker compose -p mailflow-cc-dev --env-file .env.cc-dev -f docker-compose.cc-dev.yml up -d --build

First build may take several minutes. Check:

    docker compose -p mailflow-cc-dev --env-file .env.cc-dev -f docker-compose.cc-dev.yml ps

All services should be running/healthy. If backend is unhealthy, use:

    docker compose -p mailflow-cc-dev --env-file .env.cc-dev -f docker-compose.cc-dev.yml logs --tail 80 backend

Browse http://127.0.0.1:8081 (NOT localhost:8081).
Register exactly one throwaway development administrator with a distinct
password. Do NOT connect Gmail, Workspace, Yahoo or import the working
MailFlow lab's data or backups.

## Phase C — synthetic dashboard exercise

After registering the dev administrator, from the project root run this
single PowerShell pipeline:

    Get-Content -Raw .\scripts\seed-attention-dev.sql | docker compose -p mailflow-cc-dev --env-file .env.cc-dev -f docker-compose.cc-dev.yml exec -T postgres psql -X -v ON_ERROR_STOP=1 -U cc_dev -d cc_dev

This fixture refuses to execute unless it is in the cc_dev database under
the cc_dev role, exactly one registered admin exists, and no other real-mail
accounts exist. It inserts a DISABLED demo@example.invalid account with no
IMAP hostname/password and six harmless, idempotent fake emails.

Activate the "Attention Triage (development)" plugin for your user under
Settings > Plugins. This makes the dashboard visible but does NOT enable any
mailbox for automatic classification (per-account activation remains OFF).
Refresh only the development browser tab if necessary.

The Needs Attention dashboard should show four synthetic entries:
- Security alert (HIGH): mark Expected, then Undo.
- Customer enquiry (HIGH): mark Resolved, then Undo.
- Payment issue (MEDIUM).
- AI failed to classify (NEEDS_REVIEW).

It should HIDE the fifth item (newsletter marked NOISE) and the sixth item
(security alert already acknowledged as EXPECTED).

This checks actual PostgreSQL read/acknowledge SQL and dashboard behaviour;
it does not test real IMAP, AI billing or autonomous mail ingestion.

## Phase D — real PostgreSQL queue/lease rehearsal (synthetic only)

After the dashboard/manual workflow has been verified, the next step tests
actual backend queue/lease/retry/recovery SQL. It creates three NEW random
fake message rows, exercises them, and deletes only those same three rows.
Do not run against your working MailFlow.

Run from the project root, one command at a time:

    git pull --ff-only

Build the development backend image without restarting its running container:

    docker compose -p mailflow-cc-dev --env-file .env.cc-dev -f docker-compose.cc-dev.yml build backend

Run the manually invoked, guarded test in an EPHEMERAL backend container:

    docker compose -p mailflow-cc-dev --env-file .env.cc-dev -f docker-compose.cc-dev.yml run --rm -T --no-deps -e CC_DEV_SQL_TEST=1 backend node src/dev/attentionPostgresCheck.js

The test refuses to run unless every guard passes: expected cc_dev hostname,
database name, DB role, one throwaway user, exactly one disabled offline
demo@example.invalid account, no real credentials and no pre-existing queued
mail. It never imports a provider client, opens SMTP/IMAP or calls paid AI.

The test checks actual SQL, not mocked database calls:

- write-once enqueue; duplicate protection
- single-message lease, expiry reclaim and rejection of stale completion
- retry delays and NEEDS_REVIEW after three simulated failures
- recovery of missing queue annotations with a bounded recent-mail scan
- synthetic deterministic model output through the local prompt/parser
- classification projection, Expected/Undo, preservation of is_read

Expected last line: PASS: PostgreSQL queue and deterministic fake-AI rehearsal complete.
On any failure, stop and send the full error message. The script tries to clean
up only its own generated fake IDs; no persistent fixture row is changed.
Do not put any real mailbox credentials into this stack.
## Shutdown

Stop ONLY the isolated development stack, keeping its separate database:

    docker compose -p mailflow-cc-dev --env-file .env.cc-dev -f docker-compose.cc-dev.yml down

Do NOT add -v (volume deletion) and do NOT run these commands inside the
existing mailflow-lab directory.

## Release gate

Do not merge or deploy this development code over the existing working
MailFlow. Remaining requirements before real mailbox activation:
- Recovery for moved-by-rule and unusually old-dated new mail;
- Safe per-account opt-in with server-issued activation timestamp;
- Real PostgreSQL tests of claim, lease, settlement and retry logic;
- Provider billing/usage controls and operational monitoring.
