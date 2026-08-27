-- ============================================================================
--  TasteBuddy — demo seed data
--
--  Mirrors lib/db/seed.ts so a Postgres-backed deployment behaves identically
--  to the zero-infrastructure default. Apply after db/schema.sql:
--
--      psql "$DATABASE_URL" -f db/schema.sql
--      psql "$DATABASE_URL" -f db/seed.sql
--
--  Safe to re-run: every statement upserts on a natural key.
-- ============================================================================

BEGIN;

INSERT INTO restaurants (slug, name, tagline, currency, locale, primary_color, accent_color)
VALUES
  ('aurelia-kitchen', 'Aurelia Kitchen', 'Coastal Mediterranean, cooked over fire.', 'USD', 'en-US', '#1c1917', '#e07a3f'),
  ('hanoi-house',     'Hanoi House',     'Northern Vietnamese street food, all day.', 'USD', 'en-US', '#0f172a', '#10b981')
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      tagline = EXCLUDED.tagline,
      primary_color = EXCLUDED.primary_color,
      accent_color = EXCLUDED.accent_color;

-- Menu items are keyed by (restaurant, name) for the purposes of re-seeding.
CREATE UNIQUE INDEX IF NOT EXISTS menu_items_seed_key
  ON menu_items (restaurant_id, name);

WITH venue AS (SELECT id FROM restaurants WHERE slug = 'aurelia-kitchen')
INSERT INTO menu_items (
  restaurant_id, name, description, category, price_cents, base_portion_grams,
  portion_min, portion_max, portion_step, portion_default,
  calories, protein_g, carbs_g, fat_g, sugar_g, sodium_mg, fiber_g, sort_order
)
SELECT venue.id, v.* FROM venue, (VALUES
  ('Charred Octopus', 'Slow-braised octopus finished over embers, salsa verde, smoked paprika oil.', 'starters'::menu_category, 1900, 180, 0.50, 2.00, 0.25, 1.00, 310, 28, 9, 18, 2, 720, 2, 1),
  ('Burrata & Peach', 'Whole burrata, grilled peach, basil, aged balsamic, toasted pistachio.', 'starters'::menu_category, 1600, 220, 0.50, 2.00, 0.25, 1.00, 480, 19, 22, 34, 16, 540, 3, 2),
  ('Fire-Roasted Lamb Shoulder', 'Twelve-hour lamb shoulder, charred lemon, whipped feta, mint gremolata.', 'mains'::menu_category, 3800, 420, 0.50, 2.50, 0.25, 1.00, 940, 62, 14, 68, 5, 1480, 3, 1),
  ('Saffron Risotto', 'Carnaroli rice, saffron, bone marrow butter, aged parmesan.', 'mains'::menu_category, 2600, 330, 0.50, 2.00, 0.25, 1.00, 720, 21, 88, 30, 4, 1120, 3, 2),
  ('Whole Sea Bream', 'Salt-baked sea bream, fennel, preserved lemon, olive oil.', 'mains'::menu_category, 3400, 400, 0.50, 2.00, 0.25, 1.00, 520, 54, 6, 30, 2, 890, 2, 3),
  ('Charred Greens', 'Tenderstem broccoli, chilli, garlic, lemon. Vegan.', 'sides'::menu_category, 1100, 160, 0.50, 2.00, 0.25, 1.00, 140, 6, 12, 8, 3, 260, 6, 1),
  ('Basque Cheesecake', 'Burnt-top cheesecake, salted caramel, hazelnut praline.', 'desserts'::menu_category, 1400, 150, 0.50, 2.00, 0.25, 1.00, 610, 11, 48, 42, 39, 380, 1, 1)
) AS v
ON CONFLICT (restaurant_id, name) DO UPDATE SET description = EXCLUDED.description;

WITH venue AS (SELECT id FROM restaurants WHERE slug = 'hanoi-house')
INSERT INTO menu_items (
  restaurant_id, name, description, category, price_cents, base_portion_grams,
  portion_min, portion_max, portion_step, portion_default,
  calories, protein_g, carbs_g, fat_g, sugar_g, sodium_mg, fiber_g, sort_order
)
SELECT venue.id, v.* FROM venue, (VALUES
  ('Gỏi Cuốn', 'Fresh rice-paper rolls, prawn, mint, peanut dipping sauce.', 'starters'::menu_category, 1200, 200, 0.50, 2.00, 0.25, 1.00, 320, 16, 40, 11, 9, 680, 3, 1),
  ('Phở Bò', 'Twelve-hour beef broth, rice noodles, brisket, herbs.', 'mains'::menu_category, 1800, 650, 0.50, 2.00, 0.25, 1.00, 560, 38, 66, 16, 7, 1980, 3, 1),
  ('Bún Chả', 'Charcoal pork patties, cold rice vermicelli, nước chấm, herbs.', 'mains'::menu_category, 1900, 520, 0.50, 2.00, 0.25, 1.00, 690, 34, 72, 28, 18, 1640, 4, 2),
  ('Cà Phê Sữa Đá', 'Robusta drip coffee over condensed milk and ice.', 'drinks'::menu_category, 600, 240, 1.00, 1.00, 1.00, 1.00, 180, 4, 30, 5, 29, 60, 0, 1)
) AS v
ON CONFLICT (restaurant_id, name) DO UPDATE SET description = EXCLUDED.description;

-- --- Allergen declarations -------------------------------------------------

INSERT INTO menu_item_allergens (menu_item_id, allergen_key, severity, note)
SELECT mi.id, a.allergen_key, a.severity::allergen_severity, a.note
FROM (VALUES
  ('Charred Octopus',            'molluscs',  'contains',    NULL),
  ('Charred Octopus',            'sulphites', 'may_contain', 'Braising wine.'),
  ('Burrata & Peach',            'dairy',     'contains',    NULL),
  ('Burrata & Peach',            'tree_nuts', 'removable',   'Pistachio can be omitted.'),
  ('Burrata & Peach',            'sulphites', 'contains',    'Aged balsamic.'),
  ('Fire-Roasted Lamb Shoulder', 'dairy',     'contains',    'Whipped feta.'),
  ('Saffron Risotto',            'dairy',     'contains',    NULL),
  ('Saffron Risotto',            'celery',    'may_contain', NULL),
  ('Whole Sea Bream',            'fish',      'contains',    NULL),
  ('Basque Cheesecake',          'dairy',     'contains',    NULL),
  ('Basque Cheesecake',          'eggs',      'contains',    NULL),
  ('Basque Cheesecake',          'gluten',    'contains',    NULL),
  ('Basque Cheesecake',          'tree_nuts', 'contains',    'Hazelnut praline.'),
  ('Gỏi Cuốn',                   'peanuts',   'contains',    'Peanut dipping sauce.'),
  ('Gỏi Cuốn',                   'shellfish', 'contains',    NULL),
  ('Gỏi Cuốn',                   'soy',       'contains',    NULL),
  ('Phở Bò',                     'fish',      'contains',    'Fish sauce in the broth.'),
  ('Phở Bò',                     'soy',       'may_contain', NULL),
  ('Bún Chả',                    'fish',      'contains',    NULL),
  ('Bún Chả',                    'soy',       'contains',    NULL),
  ('Bún Chả',                    'peanuts',   'may_contain', 'Shared wok and fryer.'),
  ('Cà Phê Sữa Đá',              'dairy',     'contains',    NULL)
) AS a(item_name, allergen_key, severity, note)
JOIN menu_items mi ON mi.name = a.item_name
ON CONFLICT (menu_item_id, allergen_key) DO UPDATE
  SET severity = EXCLUDED.severity, note = EXCLUDED.note;

-- --- 3D assets -------------------------------------------------------------
-- One ready mesh per dish, except Sea Bream (still generating) and the coffee
-- (no mesh at all), so every asset state the UI handles is represented.

INSERT INTO asset_3d (
  menu_item_id, status, glb_url, lod_urls, triangle_count, file_size_bytes,
  source_image_url, real_world_scale_m, ready_at
)
SELECT
  mi.id,
  'ready'::asset_status,
  '/assets/models/' || a.slug || '/medium.glb',
  json_build_object(
    'high',   '/assets/models/' || a.slug || '/high.glb',
    'medium', '/assets/models/' || a.slug || '/medium.glb',
    'low',    '/assets/models/' || a.slug || '/low.glb'
  )::jsonb,
  a.triangles,
  a.bytes,
  '/assets/source/' || a.slug || '.jpg',
  a.scale_m,
  now()
FROM (VALUES
  ('Charred Octopus',            'charred-octopus',   24000,  780000, 0.220),
  ('Burrata & Peach',            'burrata-peach',     18400,  610000, 0.220),
  ('Fire-Roasted Lamb Shoulder', 'lamb-shoulder',     31200, 1140000, 0.280),
  ('Saffron Risotto',            'saffron-risotto',   24000,  780000, 0.240),
  ('Charred Greens',             'charred-greens',    12800,  420000, 0.180),
  ('Basque Cheesecake',          'basque-cheesecake', 24000,  780000, 0.160),
  ('Gỏi Cuốn',                   'goi-cuon',          24000,  780000, 0.190),
  ('Phở Bò',                     'pho-bo',            24000,  780000, 0.250),
  ('Bún Chả',                    'bun-cha',           24000,  780000, 0.220)
) AS a(item_name, slug, triangles, bytes, scale_m)
JOIN menu_items mi ON mi.name = a.item_name
WHERE NOT EXISTS (
  SELECT 1 FROM asset_3d existing
  WHERE existing.menu_item_id = mi.id
    AND existing.status IN ('ready', 'processing', 'pending')
);

-- Sea Bream exercises the "mesh still generating" path in the UI.
INSERT INTO asset_3d (menu_item_id, status, real_world_scale_m)
SELECT mi.id, 'processing'::asset_status, 0.240
FROM menu_items mi
WHERE mi.name = 'Whole Sea Bream'
  AND NOT EXISTS (
    SELECT 1 FROM asset_3d existing
    WHERE existing.menu_item_id = mi.id
      AND existing.status IN ('ready', 'processing', 'pending')
  );

COMMIT;

-- ============================================================================
--  Seed 002 — ingredients
--
--  Allergens attach to the ingredient, so every dish using parmesan inherits
--  dairy without anyone tagging it. `menu_item_effective_allergens` unions
--  these with the hand-declared rows.
-- ============================================================================

BEGIN;

INSERT INTO ingredients (slug, name, category) VALUES
  ('octopus','Octopus','seafood'), ('prawn','Prawn','seafood'), ('sea-bream','Sea bream','seafood'),
  ('fish-sauce','Fish sauce','pantry'), ('lamb-shoulder','Lamb shoulder','meat'),
  ('beef-brisket','Beef brisket','meat'), ('pork-belly','Pork belly','meat'),
  ('burrata','Burrata','dairy'), ('feta','Feta','dairy'), ('parmesan','Parmesan','dairy'),
  ('butter','Butter','dairy'), ('cream-cheese','Cream cheese','dairy'),
  ('double-cream','Double cream','dairy'), ('condensed-milk','Condensed milk','dairy'),
  ('eggs','Eggs','pantry'), ('wheat-flour','Wheat flour','grain'),
  ('carnaroli-rice','Carnaroli rice','grain'), ('rice-noodles','Rice noodles','grain'),
  ('rice-vermicelli','Rice vermicelli','grain'), ('rice-paper','Rice paper','grain'),
  ('pistachio','Pistachio','pantry'), ('hazelnut-praline','Hazelnut praline','pantry'),
  ('peanut-sauce','Peanut sauce','pantry'), ('soy-sauce','Soy sauce','pantry'),
  ('hoisin','Hoisin','pantry'), ('aged-balsamic','Aged balsamic','pantry'),
  ('white-wine','White wine','pantry'), ('olive-oil','Olive oil','pantry'),
  ('sugar','Sugar','pantry'), ('salted-caramel','Salted caramel','pantry'),
  ('sea-salt','Sea salt','pantry'), ('robusta-coffee','Robusta coffee','pantry'),
  ('ice','Ice','other'), ('peach','Peach','produce'), ('basil','Basil','produce'),
  ('mint','Mint','produce'), ('parsley','Parsley','produce'), ('coriander','Coriander','produce'),
  ('lettuce','Lettuce','produce'), ('spring-onion','Spring onion','produce'),
  ('broccoli','Broccoli','produce'), ('fennel','Fennel','produce'), ('garlic','Garlic','produce'),
  ('onion','Onion','produce'), ('chilli','Chilli','produce'), ('lemon','Lemon','produce'),
  ('lime','Lime','produce'), ('preserved-lemon','Preserved lemon','produce'),
  ('capers','Capers','produce'), ('ginger','Ginger','produce'),
  ('saffron','Saffron','spice'), ('smoked-paprika','Smoked paprika','spice'),
  ('star-anise','Star anise','spice')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category;

INSERT INTO ingredient_allergens (ingredient_id, allergen_key)
SELECT i.id, v.allergen_key
FROM (VALUES
  ('octopus','molluscs'), ('prawn','shellfish'), ('sea-bream','fish'), ('fish-sauce','fish'),
  ('burrata','dairy'), ('feta','dairy'), ('parmesan','dairy'), ('butter','dairy'),
  ('cream-cheese','dairy'), ('double-cream','dairy'), ('condensed-milk','dairy'),
  ('eggs','eggs'), ('wheat-flour','gluten'), ('pistachio','tree_nuts'),
  ('hazelnut-praline','tree_nuts'), ('peanut-sauce','peanuts'),
  ('soy-sauce','soy'), ('hoisin','soy'), ('aged-balsamic','sulphites'), ('white-wine','sulphites')
) AS v(slug, allergen_key)
JOIN ingredients i ON i.slug = v.slug
ON CONFLICT DO NOTHING;

INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id, quantity_g, is_optional, note, sort_order)
SELECT mi.id, i.id, v.qty, v.optional, v.note, v.ord
FROM (VALUES
  ('Charred Octopus','octopus',140.0,FALSE,NULL,1),
  ('Charred Octopus','white-wine',30.0,FALSE,'Braising liquor.',2),
  ('Charred Octopus','parsley',8.0,FALSE,NULL,3),
  ('Charred Octopus','capers',6.0,FALSE,NULL,4),
  ('Charred Octopus','smoked-paprika',2.0,FALSE,NULL,5),
  ('Charred Octopus','olive-oil',12.0,FALSE,NULL,6),
  ('Burrata & Peach','burrata',125.0,FALSE,NULL,1),
  ('Burrata & Peach','peach',60.0,FALSE,NULL,2),
  ('Burrata & Peach','basil',4.0,FALSE,NULL,3),
  ('Burrata & Peach','aged-balsamic',8.0,FALSE,NULL,4),
  ('Burrata & Peach','pistachio',10.0,TRUE,'Left off on request.',5),
  ('Fire-Roasted Lamb Shoulder','lamb-shoulder',320.0,FALSE,NULL,1),
  ('Fire-Roasted Lamb Shoulder','feta',45.0,FALSE,NULL,2),
  ('Fire-Roasted Lamb Shoulder','lemon',20.0,FALSE,NULL,3),
  ('Fire-Roasted Lamb Shoulder','mint',5.0,FALSE,NULL,4),
  ('Saffron Risotto','carnaroli-rice',90.0,FALSE,NULL,1),
  ('Saffron Risotto','parmesan',30.0,FALSE,NULL,2),
  ('Saffron Risotto','butter',25.0,FALSE,NULL,3),
  ('Saffron Risotto','saffron',0.2,FALSE,NULL,4),
  ('Saffron Risotto','white-wine',40.0,FALSE,NULL,5),
  ('Whole Sea Bream','sea-bream',320.0,FALSE,NULL,1),
  ('Whole Sea Bream','fennel',40.0,FALSE,NULL,2),
  ('Whole Sea Bream','preserved-lemon',15.0,FALSE,NULL,3),
  ('Charred Greens','broccoli',140.0,FALSE,NULL,1),
  ('Charred Greens','chilli',3.0,FALSE,NULL,2),
  ('Charred Greens','garlic',5.0,FALSE,NULL,3),
  ('Charred Greens','olive-oil',10.0,FALSE,NULL,4),
  ('Basque Cheesecake','cream-cheese',70.0,FALSE,NULL,1),
  ('Basque Cheesecake','double-cream',35.0,FALSE,NULL,2),
  ('Basque Cheesecake','eggs',28.0,FALSE,NULL,3),
  ('Basque Cheesecake','wheat-flour',6.0,FALSE,NULL,4),
  ('Basque Cheesecake','hazelnut-praline',10.0,FALSE,NULL,5),
  ('Phở Bò','rice-noodles',180.0,FALSE,NULL,1),
  ('Phở Bò','beef-brisket',90.0,FALSE,NULL,2),
  ('Phở Bò','fish-sauce',12.0,FALSE,NULL,3),
  ('Phở Bò','star-anise',1.0,FALSE,NULL,4),
  ('Phở Bò','soy-sauce',5.0,TRUE,'Served alongside.',5),
  ('Bún Chả','pork-belly',140.0,FALSE,NULL,1),
  ('Bún Chả','rice-vermicelli',160.0,FALSE,NULL,2),
  ('Bún Chả','fish-sauce',18.0,FALSE,NULL,3),
  ('Bún Chả','soy-sauce',10.0,FALSE,NULL,4),
  ('Gỏi Cuốn','rice-paper',30.0,FALSE,NULL,1),
  ('Gỏi Cuốn','prawn',60.0,FALSE,NULL,2),
  ('Gỏi Cuốn','peanut-sauce',35.0,FALSE,NULL,3),
  ('Gỏi Cuốn','hoisin',10.0,FALSE,NULL,4),
  ('Cà Phê Sữa Đá','robusta-coffee',30.0,FALSE,NULL,1),
  ('Cà Phê Sữa Đá','condensed-milk',45.0,FALSE,NULL,2),
  ('Cà Phê Sữa Đá','ice',160.0,FALSE,NULL,3)
) AS v(item_name, slug, qty, optional, note, ord)
JOIN menu_items mi ON mi.name = v.item_name
JOIN ingredients i ON i.slug = v.slug
ON CONFLICT (menu_item_id, ingredient_id) DO UPDATE
  SET quantity_g = EXCLUDED.quantity_g, is_optional = EXCLUDED.is_optional, note = EXCLUDED.note;

COMMIT;

-- ============================================================================
--  Seed 003 — a development staff key
--
--  Only the hash is stored. The key itself is 'tastebuddy-dev-staff-key',
--  which is fine for a local demo and must never exist in a real deployment —
--  issue real venues a random key and give them the plaintext once.
-- ============================================================================

INSERT INTO restaurant_staff_keys (restaurant_id, key_hash, label)
SELECT r.id, encode(digest('tastebuddy-dev-staff-key', 'sha256'), 'hex'), 'Development key'
FROM restaurants r
WHERE r.slug = 'aurelia-kitchen'
ON CONFLICT (key_hash) DO NOTHING;
