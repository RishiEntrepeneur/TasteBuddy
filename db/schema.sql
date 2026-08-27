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
