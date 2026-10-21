-- Synthetic email fixtures ONLY. Safe by design: this SQL refuses to run
-- outside the dedicated cc_dev database and cc_dev user, or on a populated
-- real-mail account environment. Run only AFTER registering one dev admin.
--
-- PowerShell:
-- Get-Content -Raw .\scripts\seed-attention-dev.sql |
--   docker compose -p mailflow-cc-dev --env-file .env.cc-dev -f docker-compose.cc-dev.yml exec -T postgres psql -X -v ON_ERROR_STOP=1 -U cc_dev -d cc_dev
BEGIN;
DO $$
DECLARE
  owner_id uuid;
  user_count integer;
  demo_account uuid := 'ca11c000-0000-4000-8000-000000000001';
BEGIN
  IF current_database() <> 'cc_dev' OR current_user <> 'cc_dev' THEN
    RAISE EXCEPTION 'Refusing to seed outside isolated cc_dev';
  END IF;

  SELECT COUNT(*) INTO user_count FROM users;
  IF user_count <> 1 THEN
    RAISE EXCEPTION 'Register exactly one development administrator first';
  END IF;

  -- A real mailbox has no business existing in this synthetic-only lab.
  IF EXISTS (SELECT 1 FROM email_accounts
              WHERE email_address <> 'demo@example.invalid') THEN
    RAISE EXCEPTION 'Refusing to seed: a non-synthetic mailbox exists';
  END IF;

  SELECT id INTO owner_id FROM users LIMIT 1;

  -- DISABLED fake mailbox, with no hostname, password, token or transport.
  -- Automatic triage opt-in is never enabled by this script.
  INSERT INTO email_accounts (id, user_id, name, email_address, enabled, protocol)
  VALUES (demo_account, owner_id, 'Demo Inbox (offline)', 'demo@example.invalid',
          false, 'imap')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO messages (
    id, account_id, uid, folder, message_id, subject,
    from_name, from_email, date, snippet, is_read, plugin_annotations
  ) VALUES
  (
    'ca11c000-0000-4000-8000-000000000101', demo_account, 101, 'INBOX',
    '<cc-demo-101@example.invalid>', '[DEMO] New Google App Password',
    'Synthetic Security', 'alerts@example.invalid', NOW() - interval '1 hour',
    'Synthetic security notice for testing Expected.', false,
    '{"attention-triage":{"status":"DONE","ownerStatus":"OPEN","result":{"version":1,"attention":"YES","priority":"HIGH","category":"SECURITY","why":"A sample account security event needs your confirmation.","action":"Check whether the event was expected.","deadline":"NONE"}}}'::jsonb
  ),
  (
    'ca11c000-0000-4000-8000-000000000102', demo_account, 102, 'INBOX',
    '<cc-demo-102@example.invalid>', '[DEMO] Customer repair booking enquiry',
    'Synthetic Customer', 'customer@example.invalid', NOW() - interval '2 hours',
    'Synthetic customer question for testing Resolved.', false,
    '{"attention-triage":{"status":"DONE","ownerStatus":"OPEN","result":{"version":1,"attention":"YES","priority":"HIGH","category":"CUSTOMER","why":"A prospective customer asks for a repair appointment.","action":"Reply with repair availability.","deadline":"NONE"}}}'::jsonb
  ),
  (
    'ca11c000-0000-4000-8000-000000000103', demo_account, 103, 'INBOX',
    '<cc-demo-103@example.invalid>', '[DEMO] Payment statement needs review',
    'Synthetic Payments', 'accounts@example.invalid', NOW() - interval '3 hours',
    'Synthetic finance message.', false,
    '{"attention-triage":{"status":"DONE","ownerStatus":"OPEN","result":{"version":1,"attention":"YES","priority":"MEDIUM","category":"MONEY","why":"A synthetic payment difference requires checking.","action":"Compare the statement with your records.","deadline":"NONE"}}}'::jsonb
  ),
  (
    'ca11c000-0000-4000-8000-000000000104', demo_account, 104, 'INBOX',
    '<cc-demo-104@example.invalid>', '[DEMO] Classification unavailable',
    'Synthetic Queue', 'queue@example.invalid', NOW() - interval '4 hours',
    'Synthetic failed-AI job for manual review.', false,
    '{"attention-triage":{"status":"NEEDS_REVIEW","ownerStatus":"OPEN","lastError":"ai_unavailable","attempts":3,"version":1}}'::jsonb
  ),
  (
    'ca11c000-0000-4000-8000-000000000105', demo_account, 105, 'INBOX',
    '<cc-demo-105@example.invalid>', '[DEMO] Routine weekly newsletter',
    'Synthetic Newsletter', 'news@example.invalid', NOW() - interval '5 hours',
    'This noise message must not appear in Needs Attention.', false,
    '{"attention-triage":{"status":"DONE","ownerStatus":"OPEN","result":{"version":1,"attention":"NO","priority":"NONE","category":"NOISE","why":"Routine newsletter.","action":"NONE","deadline":"NONE"}}}'::jsonb
  ),
  (
    'ca11c000-0000-4000-8000-000000000106', demo_account, 106, 'INBOX',
    '<cc-demo-106@example.invalid>', '[DEMO] Already acknowledged security alert',
    'Synthetic Security', 'previous@example.invalid', NOW() - interval '6 hours',
    'Previously expected; must not appear in attention feed.', false,
    '{"attention-triage":{"status":"DONE","ownerStatus":"EXPECTED","result":{"version":1,"attention":"YES","priority":"HIGH","category":"SECURITY","why":"Test alert.","action":"Check if expected.","deadline":"NONE"}}}'::jsonb
  )
  ON CONFLICT (id) DO NOTHING;
END $$;
COMMIT;

-- Six synthetic rows inserted (or already present); the attention feed should
-- initially display four because NOISE and previously EXPECTED are excluded.
SELECT COUNT(*) AS synthetic_messages
FROM messages
WHERE account_id = 'ca11c000-0000-4000-8000-000000000001';
