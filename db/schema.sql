-- ============================================================================
--  TasteBuddy — PostgreSQL schema
--
--  The relational hub behind the QR-code menu: Restaurants, MenuItems,
--  Allergens and 3D_Assets (.glb). Apply with:
--
--      psql "$DATABASE_URL" -f db/schema.sql
--
--  Every table is idempotent (IF NOT EXISTS) so this doubles as migration 001.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy dish search

-- ---------------------------------------------------------------------------
--  Enumerated domains
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE allergen_severity AS ENUM ('contains', 'may_contain', 'removable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE asset_status AS ENUM ('pending', 'processing', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE menu_category AS ENUM ('starters', 'mains', 'sides', 'desserts', 'drinks');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lod_tier AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
--  restaurants
--
--  One row per venue. `slug` is what the table QR code encodes:
--      https://tastebuddy.app/restaurant/<slug>
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS restaurants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  tagline         TEXT NOT NULL DEFAULT '',
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  locale          TEXT NOT NULL DEFAULT 'en-US',

  -- Branding rendered at the top of the diner dashboard.
  primary_color   TEXT NOT NULL DEFAULT '#111111',
  accent_color    TEXT NOT NULL DEFAULT '#f97316',
  logo_url        TEXT,
  hero_image_url  TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT restaurants_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  CONSTRAINT restaurants_primary_color_hex CHECK (primary_color ~* '^#[0-9a-f]{6}$'),
  CONSTRAINT restaurants_accent_color_hex CHECK (accent_color ~* '^#[0-9a-f]{6}$')
);

-- ---------------------------------------------------------------------------
--  allergens
--
--  Reference table seeded with the 14 EU FIC declarable allergens (a superset
--  of the US "big 9"). Kept as a table rather than an enum so a chain can add
--  a regional allergen without a schema migration.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS allergens (
  key           TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',

  CONSTRAINT allergens_key_format CHECK (key ~ '^[a-z][a-z_]{1,30}$')
);

INSERT INTO allergens (key, label, description) VALUES
  ('peanuts',   'Peanuts',    'Groundnuts, peanut oil, satay and peanut flour.'),
  ('tree_nuts', 'Tree nuts',  'Almond, cashew, walnut, pecan, pistachio, hazelnut.'),
  ('dairy',     'Dairy',      'Milk, butter, cream, cheese, yoghurt, whey and casein.'),
  ('eggs',      'Eggs',       'Whole egg, albumen, mayonnaise and egg wash.'),
  ('gluten',    'Gluten',     'Wheat, barley, rye, spelt and malt.'),
  ('soy',       'Soy',        'Soybean, tofu, edamame, miso and soy sauce.'),
  ('fish',      'Fish',       'Finned fish, fish sauce, anchovy and bonito.'),
  ('shellfish', 'Shellfish',  'Prawn, crab, lobster, crayfish and shrimp paste.'),
  ('sesame',    'Sesame',     'Sesame seed, tahini and sesame oil.'),
  ('mustard',   'Mustard',    'Mustard seed, powder and prepared mustard.'),
  ('celery',    'Celery',     'Celery stalk, celeriac, leaves and celery salt.'),
  ('lupin',     'Lupin',      'Lupin flour and lupin seeds in baked goods.'),
  ('molluscs',  'Molluscs',   'Mussel, clam, oyster, squid and octopus.'),
  ('sulphites', 'Sulphites',  'Preservatives above 10 mg/kg, common in wine and dried fruit.')
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description;

-- ---------------------------------------------------------------------------
--  menu_items
--
--  Nutrition is stored for the *base* portion (portion multiplier 1.0) and
--  scaled on read, so the portion slider never needs a write.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS menu_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  category            menu_category NOT NULL DEFAULT 'mains',
  price_cents         INTEGER NOT NULL,
  base_portion_grams  INTEGER NOT NULL,

  -- Portion slider bounds, as multipliers of the base portion.
  portion_min         NUMERIC(4, 2) NOT NULL DEFAULT 0.50,
  portion_max         NUMERIC(4, 2) NOT NULL DEFAULT 2.00,
  portion_step        NUMERIC(4, 2) NOT NULL DEFAULT 0.25,
  portion_default     NUMERIC(4, 2) NOT NULL DEFAULT 1.00,

  -- Nutrition per base portion.
  calories            NUMERIC(8, 2) NOT NULL DEFAULT 0,
  protein_g           NUMERIC(8, 2) NOT NULL DEFAULT 0,
  carbs_g             NUMERIC(8, 2) NOT NULL DEFAULT 0,
  fat_g               NUMERIC(8, 2) NOT NULL DEFAULT 0,
  sugar_g             NUMERIC(8, 2) NOT NULL DEFAULT 0,
  sodium_mg           NUMERIC(8, 2) NOT NULL DEFAULT 0,
  fiber_g             NUMERIC(8, 2) NOT NULL DEFAULT 0,

  image_url           TEXT,
  is_available        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order          INTEGER NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT menu_items_price_positive CHECK (price_cents >= 0),
  CONSTRAINT menu_items_grams_positive CHECK (base_portion_grams > 0),
  CONSTRAINT menu_items_portion_bounds CHECK (
    portion_min > 0
    AND portion_max >= portion_min
    AND portion_step > 0
    AND portion_default BETWEEN portion_min AND portion_max
  )
);

CREATE INDEX IF NOT EXISTS menu_items_restaurant_idx
  ON menu_items (restaurant_id, category, sort_order);

CREATE INDEX IF NOT EXISTS menu_items_name_trgm_idx
  ON menu_items USING gin (name gin_trgm_ops);

-- Nutrition filtering hits this on every menu load.
CREATE INDEX IF NOT EXISTS menu_items_nutrition_idx
  ON menu_items (restaurant_id, calories, sodium_mg);

-- ---------------------------------------------------------------------------
--  menu_item_allergens  (join: MenuItems <-> Allergens)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS menu_item_allergens (
  menu_item_id  UUID NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  allergen_key  TEXT NOT NULL REFERENCES allergens (key) ON DELETE RESTRICT,
  severity      allergen_severity NOT NULL DEFAULT 'contains',
  note          TEXT,

  PRIMARY KEY (menu_item_id, allergen_key)
);

-- "Show me every dish that is safe for a peanut allergy" is an anti-join
-- against this index.
CREATE INDEX IF NOT EXISTS menu_item_allergens_key_idx
  ON menu_item_allergens (allergen_key, severity);

-- ---------------------------------------------------------------------------
--  asset_3d  (the "3D_Assets" table)
--
--  One row per menu item per generation attempt. `source_checksum` is the
--  pipeline's idempotency key: re-uploading the same photo returns the cached
--  CDN paths instead of paying for another mesh generation.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS asset_3d (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id        UUID NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  status              asset_status NOT NULL DEFAULT 'pending',

  -- CDN path of the default (medium) tier .glb.
  glb_url             TEXT,
  -- { "high": "...", "medium": "...", "low": "..." }
  lod_urls            JSONB NOT NULL DEFAULT '{}'::jsonb,

  triangle_count      INTEGER,
  file_size_bytes     INTEGER,

  source_image_url    TEXT,
  source_checksum     CHAR(64),

  -- Longest real-world edge in metres; the AR viewer scales the mesh to this.
  real_world_scale_m  NUMERIC(5, 3) NOT NULL DEFAULT 0.220,

  -- Correlates the async generator webhook back to this row.
  generator_job_id    TEXT,
  failure_reason      TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at            TIMESTAMPTZ,

  CONSTRAINT asset_3d_ready_has_url CHECK (status <> 'ready' OR glb_url IS NOT NULL),
  CONSTRAINT asset_3d_failed_has_reason CHECK (status <> 'failed' OR failure_reason IS NOT NULL),
  CONSTRAINT asset_3d_triangles_positive CHECK (triangle_count IS NULL OR triangle_count > 0),
  CONSTRAINT asset_3d_scale_sane CHECK (real_world_scale_m > 0 AND real_world_scale_m < 2)
);

-- At most one live asset per dish; historical failures are kept for debugging.
CREATE UNIQUE INDEX IF NOT EXISTS asset_3d_one_ready_per_item
  ON asset_3d (menu_item_id)
  WHERE status IN ('ready', 'processing', 'pending');

-- The pipeline cache lookup.
CREATE UNIQUE INDEX IF NOT EXISTS asset_3d_checksum_idx
  ON asset_3d (source_checksum)
  WHERE source_checksum IS NOT NULL AND status = 'ready';

CREATE INDEX IF NOT EXISTS asset_3d_job_idx
  ON asset_3d (generator_job_id)
  WHERE generator_job_id IS NOT NULL;

-- ---------------------------------------------------------------------------
--  updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS restaurants_touch ON restaurants;
CREATE TRIGGER restaurants_touch BEFORE UPDATE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS menu_items_touch ON menu_items;
CREATE TRIGGER menu_items_touch BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================================
--  Migration 002 — ingredients and saved dishes
-- ============================================================================

-- ---------------------------------------------------------------------------
--  ingredients
--
--  A shared catalogue, not per-restaurant rows: "double cream" carries dairy
--  wherever it is used, so the allergen belongs to the ingredient and every
--  dish that uses it inherits the fact. Hand-tagging each dish instead is how
--  a menu ends up with one dish that forgot to declare its butter.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ingredients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  -- Broad grouping for the shopping-list view: 'dairy', 'produce', 'meat'…
  category    TEXT NOT NULL DEFAULT 'other',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ingredients_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

CREATE INDEX IF NOT EXISTS ingredients_category_idx ON ingredients (category, name);

-- Allergens an ingredient inherently carries.
CREATE TABLE IF NOT EXISTS ingredient_allergens (
  ingredient_id  UUID NOT NULL REFERENCES ingredients (id) ON DELETE CASCADE,
  allergen_key   TEXT NOT NULL REFERENCES allergens (key) ON DELETE RESTRICT,
  PRIMARY KEY (ingredient_id, allergen_key)
);

-- ---------------------------------------------------------------------------
--  menu_item_ingredients
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS menu_item_ingredients (
  menu_item_id   UUID NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  ingredient_id  UUID NOT NULL REFERENCES ingredients (id) ON DELETE RESTRICT,
  -- Grams in one base portion; null when the amount is "to taste".
  quantity_g     NUMERIC(8, 2),
  -- A garnish the kitchen will leave off on request. Drives the `removable`
  -- severity, so "hold the pistachio" stops being a hard conflict.
  is_optional    BOOLEAN NOT NULL DEFAULT FALSE,
  note           TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (menu_item_id, ingredient_id),
  CONSTRAINT menu_item_ingredients_qty CHECK (quantity_g IS NULL OR quantity_g > 0)
);

CREATE INDEX IF NOT EXISTS menu_item_ingredients_item_idx
  ON menu_item_ingredients (menu_item_id, sort_order);

-- "Which dishes use this ingredient?" — the recall query when a supplier
-- issues a notice, which is the whole reason this is a shared catalogue.
CREATE INDEX IF NOT EXISTS menu_item_ingredients_ingredient_idx
  ON menu_item_ingredients (ingredient_id);

-- ---------------------------------------------------------------------------
--  menu_item_effective_allergens
--
--  What a dish actually exposes: allergens derived from its ingredients,
--  unioned with the hand-declared rows. Both sources are needed — an
--  ingredient cannot know it shares a fryer, and a kitchen cannot be trusted
--  to remember that butter is dairy on all four hundred dishes.
--
--  Severity resolves to the strongest claim: an explicit `contains` beats an
--  optional ingredient's `removable`.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW menu_item_effective_allergens AS
WITH derived AS (
  SELECT
    mii.menu_item_id,
    ia.allergen_key,
    CASE WHEN mii.is_optional THEN 'removable' ELSE 'contains' END::allergen_severity AS severity,
    i.name AS note
  FROM menu_item_ingredients mii
  JOIN ingredients i ON i.id = mii.ingredient_id
  JOIN ingredient_allergens ia ON ia.ingredient_id = i.id
),
declared AS (
  SELECT menu_item_id, allergen_key, severity, note
  FROM menu_item_allergens
),
combined AS (
  SELECT * FROM derived
  UNION ALL
  SELECT * FROM declared
)
SELECT DISTINCT ON (menu_item_id, allergen_key)
  menu_item_id,
  allergen_key,
  severity,
  note
FROM combined
ORDER BY
  menu_item_id,
  allergen_key,
  -- Strongest claim wins.
  array_position(
    ARRAY['contains', 'may_contain', 'removable']::allergen_severity[],
    severity
  );

-- ---------------------------------------------------------------------------
--  saved_dishes
--
--  TasteBuddy has no accounts, so a saved list is keyed by an opaque token the
--  browser generates and keeps. The token is the only credential: anyone
--  holding it can read and change that list, which is why it is 32 bytes of
--  randomness and why nothing identifying is ever stored beside it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS saved_dishes (
  diner_token   TEXT NOT NULL,
  menu_item_id  UUID NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  note          TEXT,
  saved_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (diner_token, menu_item_id),
  CONSTRAINT saved_dishes_token_shape CHECK (diner_token ~ '^[A-Za-z0-9_-]{22,64}$')
);

CREATE INDEX IF NOT EXISTS saved_dishes_token_idx
  ON saved_dishes (diner_token, saved_at DESC);

-- Abandoned lists are not worth storing forever; a housekeeping job deletes
-- rows whose token has not been touched in a year.
CREATE INDEX IF NOT EXISTS saved_dishes_stale_idx ON saved_dishes (saved_at);

-- ============================================================================
--  Migration 003 — restaurant staff access
-- ============================================================================

-- ---------------------------------------------------------------------------
--  restaurant_staff_keys
--
--  Menu editing needs an authenticated caller, and TasteBuddy has no user
--  accounts to hang that off. Each venue instead gets one or more opaque
--  access keys, issued out of band when the venue is onboarded.
--
--  Only the SHA-256 of a key is stored. A password would need a slow KDF
--  because humans choose weak ones; these are 256 bits of machine-generated
--  randomness, so there is no dictionary to run and a fast hash is the right
--  tool — what matters is that a database leak does not hand over live keys.
--
--  Keys are revoked, never deleted, so an audit can still explain who had
--  access when.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS restaurant_staff_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  -- Hex SHA-256 of the issued key.
  key_hash       CHAR(64) NOT NULL UNIQUE,
  -- Human label for the key, e.g. "Front of house iPad".
  label          TEXT NOT NULL DEFAULT 'Staff key',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ
);

-- Sign-in looks a key up by hash alone; the venue is whatever the row says,
-- so a key can never be replayed against a restaurant it was not issued for.
CREATE INDEX IF NOT EXISTS restaurant_staff_keys_live_idx
  ON restaurant_staff_keys (key_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS restaurant_staff_keys_venue_idx
  ON restaurant_staff_keys (restaurant_id, created_at DESC);

-- ============================================================================
--  Migration 004 — let a photo back more than one dish
-- ============================================================================

-- The original checksum index was UNIQUE among ready assets, which quietly
-- forbade the thing content-addressing exists to allow: the same photo backing
-- two dishes. A chain with one stock shot per dish across venues, or a kitchen
-- reusing a plating photo, would hit a constraint violation on the second
-- upload. The cache lookup only ever needs "find a ready asset with this
-- checksum", so uniqueness was never doing useful work.
DROP INDEX IF EXISTS asset_3d_checksum_idx;

CREATE INDEX IF NOT EXISTS asset_3d_checksum_idx
  ON asset_3d (source_checksum)
  WHERE source_checksum IS NOT NULL;

-- ============================================================================
--  Migration 005 — menu photo imports
-- ============================================================================

-- ---------------------------------------------------------------------------
--  menu_import_runs
--
--  One row per menu photo read by the vision model. Three jobs:
--
--    Cost.   A vision call costs real money and a venue can point a camera at
--            anything. The hourly count per venue is read straight off this
--            table, so the limit holds across serverless containers rather
--            than per-instance like an in-memory counter would.
--
--    Audit.  When a wrong price or a mangled dish name reaches a menu, this
--            says which photo it came from and when — the difference between
--            fixing one dish and re-checking the whole menu.
--
--    Honesty about what was reviewed. `dish_count` is what the model read;
--            `committed_count` is what staff actually kept. A gap between them
--            is the signal that the photo was poor.
--
--  Deliberately absent: anything the model said about allergens. It is not
--  asked, and there is no column here that could carry such an answer forward.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS menu_import_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    UUID NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  -- Hex SHA-256 of the uploaded photo. The same menu re-read shows up as a
  -- repeat rather than as a new source of truth.
  source_checksum  CHAR(64) NOT NULL,
  -- Dishes the model returned, before staff review.
  dish_count       INTEGER NOT NULL DEFAULT 0,
  -- Dishes staff kept. Null until they commit; 0 if they discarded the lot.
  committed_count  INTEGER,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at     TIMESTAMPTZ
);

-- The rate-limit query: "how many reads has this venue had in the last hour".
CREATE INDEX IF NOT EXISTS menu_import_runs_venue_idx
  ON menu_import_runs (restaurant_id, created_at DESC);

-- Spotting a venue re-reading the same photo over and over.
CREATE INDEX IF NOT EXISTS menu_import_runs_checksum_idx
  ON menu_import_runs (source_checksum);

-- ============================================================================
--  Migration 006 — one key, several venues
-- ============================================================================

-- ---------------------------------------------------------------------------
--  staff_key_venues
--
--  A key used to belong to exactly one venue, which is wrong for the customer
--  that matters commercially: a group. A head chef running four sites had to
--  carry four keys and sign in and out to move between them, and there was no
--  way to hand a regional manager access to three sites but not the fourth.
--
--  Access is now a grant per (key, venue). The key's own row says nothing
--  about which venues it reaches, so there is one place to read and one place
--  to revoke.
--
--  Revoking a key stays a property of the key, not the grant: a lost iPad is
--  lost for every site at once, and having to remember which grants to pull
--  is how a stale grant survives.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff_key_venues (
  key_id         UUID NOT NULL REFERENCES restaurant_staff_keys (id) ON DELETE CASCADE,
  restaurant_id  UUID NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_id, restaurant_id)
);

-- "Which venues may this key reach" is the sign-in query; the primary key
-- already serves it. This one answers "who can reach this venue", which is
-- what the access-keys panel lists and what the last-key-standing check reads.
CREATE INDEX IF NOT EXISTS staff_key_venues_venue_idx
  ON staff_key_venues (restaurant_id);

-- Carry the existing single-venue keys across.
INSERT INTO staff_key_venues (key_id, restaurant_id, granted_at)
SELECT id, restaurant_id, created_at
  FROM restaurant_staff_keys
 WHERE restaurant_id IS NOT NULL
    ON CONFLICT DO NOTHING;

-- With the grants moved, the column on the key row would be a second answer
-- to the same question, and the two would drift the first time a key gained a
-- second venue. Dropping it takes its index with it.
ALTER TABLE restaurant_staff_keys DROP COLUMN IF EXISTS restaurant_id;

-- ============================================================================
--  Migration 007 — onboarding a restaurant
-- ============================================================================

-- ---------------------------------------------------------------------------
--  restaurant_staff_keys.is_operator
--
--  Venues used to arrive by INSERT, which made onboarding a restaurant a
--  database task rather than a product one. Creating a venue is now something
--  a key can be allowed to do.
--
--  It is a flag on the key rather than a separate table because it is a
--  capability, not an identity: the same person signs in the same way and gets
--  the same editor, and the flag only decides whether "New venue" is there.
--
--  Two rules keep it from spreading. A key issued by an operator is not itself
--  an operator unless that is asked for explicitly, so handing a restaurant
--  their key never hands them the platform. And creating a venue grants the
--  creator that one venue, nothing else: an operator with fifty clients still
--  reaches only the venues actually granted to their key, and can drop a grant
--  once a venue is handed over.
-- ---------------------------------------------------------------------------

ALTER TABLE restaurant_staff_keys
  ADD COLUMN IF NOT EXISTS is_operator BOOLEAN NOT NULL DEFAULT false;

-- Venue branding is data, and text gets drawn on it. A colour that cannot
-- carry text at all is rejected in lib/admin/venue-validation.ts, where the
-- ratio can actually be measured; the database keeps the cheap format check
-- it already had. Nothing to add here beyond a note that the two are
-- deliberately different jobs.

-- Editing a venue touches `updated_at`, which nothing was maintaining.
CREATE OR REPLACE FUNCTION touch_restaurant_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS restaurants_touch_updated_at ON restaurants;
CREATE TRIGGER restaurants_touch_updated_at
  BEFORE UPDATE ON restaurants
  FOR EACH ROW EXECUTE FUNCTION touch_restaurant_updated_at();

-- ============================================================================
--  Migration 008 — the diner's own lookups
-- ============================================================================

-- ---------------------------------------------------------------------------
--  lookups
--
--  Reading a menu photo and explaining a dish both cost money, and both are
--  open to anyone with the app: there is no sign-in, because a person standing
--  in a restaurant holding a menu they cannot read is not going to make an
--  account first.
--
--  So the limit hangs off the anonymous token the browser already mints for
--  saved dishes. It is not an identity and proves nothing; it is a handle to
--  count against, which is all a rate limit needs. Someone determined can mint
--  a fresh one, and the daily total below is the backstop for that.
--
--  Nothing here records what was asked. The dish name is not stored, because
--  what somebody is looking up in a restaurant is their business, and a table
--  of "who searched for what" is a liability nobody asked this app to hold.
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

-- The per-token limit: "how many has this browser had in the last hour".
CREATE INDEX IF NOT EXISTS lookups_token_idx
  ON lookups (diner_token, created_at DESC);

-- The backstop: "how many has the whole app had today", which is what stops a
-- script minting a fresh token per request from running up a bill.
CREATE INDEX IF NOT EXISTS lookups_recent_idx ON lookups (created_at DESC);
