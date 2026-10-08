-- migrations/003_create_settlements.sql
-- Idempotent migration: creates the settlements table with a natural unique
-- constraint on (bond_id, transaction_hash) to prevent duplicates under
-- concurrent ingestion.
-- Depends on: 002_create_bonds
-- UP

BEGIN;

CREATE TABLE IF NOT EXISTS settlements (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  bond_id           UUID          NOT NULL REFERENCES bonds(id) ON DELETE CASCADE,
  amount            NUMERIC(36,18) NOT NULL CHECK (amount >= 0),
  transaction_hash  VARCHAR(128)  NOT NULL,
  settled_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  status            TEXT          NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'settled', 'failed')),
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT settlements_bond_tx_unique UNIQUE (bond_id, transaction_hash)
);

CREATE INDEX IF NOT EXISTS idx_settlements_bond_id ON settlements(bond_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
CREATE INDEX IF NOT EXISTS idx_settlements_settled_at ON settlements(settled_at DESC);

DROP TRIGGER IF EXISTS settlements_updated_at ON settlements;
CREATE TRIGGER settlements_updated_at
  BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  settlements                  IS 'Settlement records for bond payouts, deduplicated by (bond_id, transaction_hash).';
COMMENT ON COLUMN settlements.id               IS 'Surrogate UUID primary key.';
COMMENT ON COLUMN settlements.bond_id          IS 'Foreign key to bonds.id – the bond being settled.';
COMMENT ON COLUMN settlements.amount           IS 'Settlement amount (18-decimal precision for token values).';
COMMENT ON COLUMN settlements.transaction_hash IS 'On-chain transaction hash, unique per bond to prevent duplicate ingestion.';
COMMENT ON COLUMN settlements.settled_at       IS 'Timestamp when the settlement was finalised on-chain.';
COMMENT ON COLUMN settlements.status           IS 'Settlement status: pending, settled, or failed.';
COMMENT ON COLUMN settlements.created_at       IS 'Row creation timestamp.';
COMMENT ON COLUMN settlements.updated_at       IS 'Row last-update timestamp.';

INSERT INTO schema_migrations (version)
VALUES ('003_create_settlements')
ON CONFLICT DO NOTHING;

COMMIT;

-- DOWN
-- BEGIN;
-- DROP TRIGGER IF EXISTS settlements_updated_at ON settlements;
-- DROP INDEX  IF EXISTS idx_settlements_settled_at;
-- DROP INDEX  IF EXISTS idx_settlements_status;
-- DROP INDEX  IF EXISTS idx_settlements_bond_id;
-- DROP TABLE  IF EXISTS settlements;
-- DELETE FROM schema_migrations WHERE version = '003_create_settlements';
-- COMMIT;
