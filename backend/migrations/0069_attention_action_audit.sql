-- Mail Command Centre: durable, metadata-only owner action history.
-- Individual email bodies, subjects, sender addresses and provider secrets are never stored here.
-- Audit rows remain after an email is expunged; deleting the owner account removes their history.
CREATE TABLE IF NOT EXISTS attention_action_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  message_id UUID NOT NULL,
  action TEXT NOT NULL DEFAULT 'OWNER_STATUS',
  previous_status TEXT NOT NULL CHECK (previous_status IN ('OPEN', 'RESOLVED', 'EXPECTED')),
  new_status TEXT NOT NULL CHECK (new_status IN ('OPEN', 'RESOLVED', 'EXPECTED')),
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS attention_action_audit_owner_recent
  ON attention_action_audit (user_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS attention_action_audit_message_recent
  ON attention_action_audit (user_id, message_id, occurred_at DESC);
