-- OnboardIQ schema (PostgreSQL 14+)

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  roles         TEXT[] NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_roles_valid CHECK (roles <@ ARRAY['APPLICANT','KYC_OFFICER','COMPLIANCE_OFFICER']::TEXT[] AND cardinality(roles) > 0)
);

CREATE TABLE occupations (
  occupation_code TEXT PRIMARY KEY,
  description     TEXT NOT NULL,
  risk_level      TEXT NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH'))
);

-- Rule configuration history; the active row is the latest one.
CREATE TABLE rules_config (
  id          SERIAL PRIMARY KEY,
  version     TEXT NOT NULL,
  config      JSONB NOT NULL,
  created_by  INTEGER REFERENCES users(id),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE system_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE watchlist_entries (
  id          SERIAL PRIMARY KEY,
  list_type   TEXT NOT NULL CHECK (list_type IN ('SANCTIONS','PEP')),
  entry_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  alias       TEXT,
  dob         DATE,
  extra       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (list_type, entry_id)
);

-- Customers already on the bank's books (seeded) plus customers opened through OnboardIQ.
CREATE TABLE existing_customers (
  customer_id    TEXT PRIMARY KEY,
  full_name      TEXT NOT NULL,
  pan_number     TEXT NOT NULL UNIQUE,
  dob            DATE,
  source         TEXT NOT NULL DEFAULT 'SEED',
  application_id TEXT,
  account_number TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Simulated extraction service output (both data-pack files).
CREATE TABLE extraction_mock (
  doc_id      TEXT NOT NULL,
  field_name  TEXT NOT NULL,
  value       TEXT,
  confidence  NUMERIC(4,2) NOT NULL,
  PRIMARY KEY (doc_id, field_name)
);

CREATE SEQUENCE application_seq START 1;
CREATE SEQUENCE document_seq START 1;

CREATE TABLE applications (
  application_id      TEXT PRIMARY KEY,
  applicant_user_id   INTEGER NOT NULL REFERENCES users(id),
  application_date    DATE NOT NULL,
  full_name           TEXT NOT NULL,
  dob                 DATE NOT NULL,
  gender              TEXT NOT NULL,
  pan_number          TEXT NOT NULL,
  aadhaar_last4       CHAR(4) NOT NULL CHECK (aadhaar_last4 ~ '^[0-9]{4}$'),
  mobile              TEXT NOT NULL,
  email               TEXT NOT NULL,
  address             TEXT NOT NULL,
  city                TEXT NOT NULL,
  state               TEXT NOT NULL,
  pincode             TEXT NOT NULL,
  occupation_code     TEXT NOT NULL REFERENCES occupations(occupation_code),
  annual_income       BIGINT NOT NULL,
  kyc_consent         BOOLEAN NOT NULL CHECK (kyc_consent),
  consent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              TEXT NOT NULL,
  -- latest rules result
  decision            TEXT,
  reason_codes        TEXT[] NOT NULL DEFAULT '{}',
  name_match_score    DOUBLE PRECISION,
  risk_category       TEXT,
  rekyc_due_date      DATE,
  engine_result       JSONB,
  -- first rules result (for dashboard rates)
  initial_decision    TEXT,
  initial_reason_codes TEXT[],
  reviewed            BOOLEAN NOT NULL DEFAULT FALSE,
  -- maker / checker
  maker_user_id       INTEGER REFERENCES users(id),
  maker_recommendation TEXT,
  maker_comment       TEXT,
  maker_at            TIMESTAMPTZ,
  checker_user_id     INTEGER REFERENCES users(id),
  checker_decision    TEXT,
  checker_comment     TEXT,
  checker_at          TIMESTAMPTZ,
  resubmission_requested_at TIMESTAMPTZ,
  resubmission_due_at TIMESTAMPTZ,
  resubmission_count  INTEGER NOT NULL DEFAULT 0,
  -- account opening (mock core banking)
  customer_id         TEXT,
  account_number      TEXT,
  source              TEXT NOT NULL DEFAULT 'PORTAL',
  extraction_provider TEXT,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  in_review_since     TIMESTAMPTZ,
  pending_checker_since TIMESTAMPTZ,
  decided_at          TIMESTAMPTZ,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT applications_status_valid CHECK (status IN ('SUBMITTED','EXTRACTING','AUTO_APPROVED','IN_REVIEW','RESUBMISSION_REQUESTED','PENDING_CHECKER','APPROVED','REJECTED','AUTO_REJECTED','CLOSED_EXPIRED')),
  CONSTRAINT maker_checker_differ CHECK (checker_user_id IS NULL OR maker_user_id IS NULL OR checker_user_id <> maker_user_id)
);
CREATE INDEX applications_status_idx ON applications(status);
CREATE INDEX applications_applicant_idx ON applications(applicant_user_id);
CREATE INDEX applications_date_idx ON applications(application_date);
-- Two in-flight applications with the same PAN can never exist at the same time (concurrency guard).
CREATE UNIQUE INDEX applications_pan_inflight_uq ON applications(pan_number)
  WHERE status IN ('SUBMITTED','EXTRACTING','IN_REVIEW','RESUBMISSION_REQUESTED','PENDING_CHECKER');

CREATE TABLE documents (
  doc_id            TEXT PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES applications(application_id),
  file_name         TEXT NOT NULL,
  declared_doc_type TEXT NOT NULL CHECK (declared_doc_type IN ('PAN_CARD','AADHAAR_CARD','ELECTRICITY_BILL','BANK_STATEMENT','DRIVING_LICENCE')),
  sha256            CHAR(64) NOT NULL,
  size_bytes        INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 1048576),
  file_key          UUID NOT NULL UNIQUE,      -- non-guessable storage key, file stored outside the DB
  source_ref        TEXT,                      -- data-pack doc_id derived from the file name (mock lookups)
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by       INTEGER REFERENCES users(id),
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at        TIMESTAMPTZ
);
CREATE INDEX documents_app_idx ON documents(application_id);
-- Idempotency: the same file (hash) is stored only once per application.
CREATE UNIQUE INDEX documents_app_hash_uq ON documents(application_id, sha256) WHERE active;

CREATE TABLE extractions (
  id                  SERIAL PRIMARY KEY,
  doc_id              TEXT NOT NULL REFERENCES documents(doc_id),
  provider            TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('OK','UNKNOWN','FAILED','TIMEOUT')),
  doc_type            TEXT NOT NULL,
  doc_type_confidence NUMERIC(4,2) NOT NULL,
  fields              JSONB NOT NULL DEFAULT '{}'::jsonb,
  extractor_version   TEXT,
  classification      JSONB,
  error               TEXT,
  elapsed_ms          INTEGER,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX extractions_doc_idx ON extractions(doc_id);
CREATE UNIQUE INDEX extractions_current_uq ON extractions(doc_id) WHERE is_current;

-- Officer corrections (confidence 1.00, source OFFICER); also the labelled feedback for AI-4.
CREATE TABLE field_corrections (
  id                SERIAL PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES applications(application_id),
  doc_id            TEXT NOT NULL REFERENCES documents(doc_id),
  field_name        TEXT NOT NULL,
  old_value         TEXT,
  old_confidence    NUMERIC(4,2),
  new_value         TEXT NOT NULL,
  reason            TEXT NOT NULL,
  provider          TEXT,
  extractor_version TEXT,
  officer_id        INTEGER NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX field_corrections_app_idx ON field_corrections(application_id);

CREATE VIEW extraction_feedback AS
  SELECT fc.id, fc.doc_id, fc.field_name, fc.old_value AS extracted_value, fc.old_confidence AS extracted_confidence,
         fc.new_value AS corrected_value, fc.provider, fc.extractor_version, fc.officer_id, fc.reason, fc.created_at
    FROM field_corrections fc;

-- Every rules evaluation (submission, correction, re-screen, resubmission).
CREATE TABLE decisions (
  id                SERIAL PRIMARY KEY,
  application_id    TEXT NOT NULL REFERENCES applications(application_id),
  trigger           TEXT NOT NULL,
  decision          TEXT NOT NULL,
  reason_codes      TEXT[] NOT NULL,
  name_match_score  DOUBLE PRECISION,
  risk_category     TEXT,
  rekyc_due_date    DATE,
  engine_result     JSONB NOT NULL,
  provider          TEXT,
  config_version    TEXT,
  created_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX decisions_app_idx ON decisions(application_id);

-- Maker recommendations and checker decisions.
CREATE TABLE case_actions (
  id              SERIAL PRIMARY KEY,
  application_id  TEXT NOT NULL REFERENCES applications(application_id),
  actor_id        INTEGER NOT NULL REFERENCES users(id),
  actor_role      TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('RECOMMENDATION','CHECKER_DECISION')),
  value           TEXT NOT NULL,
  comment         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX case_actions_app_idx ON case_actions(application_id);

CREATE TABLE core_banking_accounts (
  customer_id     TEXT PRIMARY KEY,
  account_number  TEXT NOT NULL UNIQUE,
  application_id  TEXT NOT NULL UNIQUE,
  pan_number      TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE SEQUENCE core_customer_seq START 500001;

CREATE TABLE notifications (
  id              SERIAL PRIMARY KEY,
  application_id  TEXT REFERENCES applications(application_id),
  user_id         INTEGER REFERENCES users(id),
  channel         TEXT NOT NULL DEFAULT 'LOG',
  message         TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only audit trail.
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  application_id  TEXT,
  event_type      TEXT NOT NULL,
  actor_id        INTEGER,
  actor_email     TEXT,
  actor_role      TEXT,
  doc_id          TEXT,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip              TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX audit_app_idx ON audit_log(application_id, id);
CREATE INDEX audit_event_idx ON audit_log(event_type);

CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
