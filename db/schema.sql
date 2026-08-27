-- ============================================================================
--  TasteBuddy — schema
--
--      psql "$DATABASE_URL" -f db/schema.sql
--
--  There is one table, and it holds no food and no people.
--
--  The app has no accounts and stores nothing about anybody: a diner's
--  allergies live in their own browser and are never sent here, and what they
--  looked up is not recorded. The only thing the server needs to remember is
--  how often it has been asked, so that an app anyone can use does not become
--  a bill its owner did not choose.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
--  lookups
--
--  One row per menu photo read or dish explained. Both cost money and both are
--  open to anyone with the address, because somebody standing in a restaurant
--  holding a menu they cannot read is not going to make an account first.
--
--  The limit hangs off the anonymous token the browser mints for itself. It is
--  not an identity and proves nothing; it is a handle to count against, which
--  is all a rate limit needs. Someone determined can mint a fresh one, and the
--  daily total across everyone is the backstop for that.
--
--  Note what is absent: the dish name. What somebody looks up in a restaurant
--  is their business, and a table of who searched for what is a liability
--  nobody asked this app to hold.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS lookups (
  id            BIGSERIAL PRIMARY KEY,
  -- The browser's anonymous token. Not a person.
  diner_token   TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('menu_photo', 'dish')),
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT lookups_token_format CHECK (diner_token ~ '^[A-Za-z0-9_-]{22,64}$')
);

-- The per-browser limit: "how many has this one had in the last hour".
CREATE INDEX IF NOT EXISTS lookups_token_idx
  ON lookups (diner_token, created_at DESC);

-- The backstop: "how many has the whole app had today", which is what stops a
-- script minting a fresh token per request from running up a bill.
CREATE INDEX IF NOT EXISTS lookups_recent_idx ON lookups (created_at DESC);

-- Rows older than a couple of days answer no question either index is asked.
-- A housekeeping job can drop them:
--   DELETE FROM lookups WHERE created_at < now() - interval '7 days';
