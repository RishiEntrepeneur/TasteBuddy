# TasteBuddy

A web-native AR dining platform. A restaurant puts one QR code on the table; a
diner scans it, the menu opens in the browser they already have, and every dish
can be projected onto their own empty plate at the portion they actually want —
with anything that clashes with their allergies flagged both in the menu and
over the 3D model itself.

No app store, no download, no account.

```bash
npm install
npm run dev            # http://localhost:3000/restaurant/aurelia-kitchen
```

To open it on a phone on the same Wi-Fi:

```bash
npm run dev:lan        # binds 0.0.0.0 — reach it at http://<your-lan-ip>:3000
npm run dev:lan:https  # same, over HTTPS — required for the AR camera
```

`getUserMedia` only runs in a secure context, and a bare LAN IP over plain HTTP
is not one. The menu and profile routes are fine under `dev:lan`; AR needs
`dev:lan:https`, which generates a self-signed certificate you accept once on
the device. The viewer detects an insecure origin and says so rather than
failing silently.

Runs with **zero infrastructure** out of the box: no database, no API keys and
no asset bucket are required. Set the environment variables in
`.env.example` to move each piece to real infrastructure, one at a time.

## Architecture

```
app/
  page.tsx                            Venue directory (staff-facing)
  restaurant/[id]/page.tsx            The diner dashboard the QR code opens
  api/menu/route.ts                   Menu, filtered by allergens + nutrition
  api/tastebuddy-pipeline/route.ts    2D photo -> optimised .glb pipeline
components/
  TasteBuddyARViewer.tsx              Camera + WebGL AR canvas
  ar/DishModel.tsx                    .glb loader with procedural fallback
  ar/AllergenWarningOverlay.tsx       In-scene warning anchored to the dish
  RestaurantDashboard.tsx             Interactive menu shell
  MenuItemCard.tsx, PortionSlider.tsx, AllergenProfilePicker.tsx
lib/
  types.ts                            Domain model — the single source of truth
  menu-filter.ts                      Conflict evaluation (shared server+client)
  allergens.ts, nutrition.ts          Allergen catalogue, portion scaling
  ar/plate-tracker.ts                 Surface tracking on an empty plate
  pipeline/{validation,lod,cdn,generator}.ts
  db/{client,repository,seed}.ts      Postgres, with a seed-data fallback
db/
  schema.sql                          Restaurants, MenuItems, Allergens, 3D assets,
                                      Ingredients, SavedDishes
  seed.sql                            Demo data mirroring lib/db/seed.ts
```

### The data hub

`db/schema.sql` is the relational core: `restaurants`, `menu_items`,
`allergens` (seeded with the 14 EU FIC declarable allergens, a superset of the
US "big 9"), the `menu_item_allergens` join carrying a per-dish severity, and
`asset_3d` for generated meshes.

Two decisions worth calling out:

- **Nutrition is stored per base portion and scaled on read.** The portion
  slider therefore never writes, and a "1.5× lamb shoulder" is evaluated against
  the diner's calorie ceiling without a round trip.
- **`asset_3d.source_checksum` is the pipeline's idempotency key**, backed by a
  partial unique index. Re-uploading the same dish photo resolves to the meshes
  that already exist instead of paying to generate them again.

`lib/db/repository.ts` reads from Postgres when `DATABASE_URL` is set and from
`lib/db/seed.ts` otherwise. Callers never branch on which is active. The whole
menu — allergens aggregated to JSON, live asset joined — is one round trip, so
rendering a menu never N+1s.

### Ingredients, and why allergens are derived from them

Allergens belong to the **ingredient**, not to the dish. `ingredients` is a
shared catalogue, `ingredient_allergens` says what each one carries, and the
`menu_item_effective_allergens` view unions those derived facts with the
hand-declared rows.

Both sources are needed and neither is sufficient: an ingredient cannot know it
shares a fryer, and a kitchen cannot be trusted to remember that butter is dairy
across four hundred dishes. Severity resolves to the strongest claim, and an
ingredient marked `is_optional` yields `removable` — so "hold the pistachio"
stops being a hard conflict automatically.

This is not theoretical. Seeding the real ingredient lists made Saffron Risotto
declare **sulphites**, from the white wine it is cooked with, which the
hand-tagged data had never captured. The conflict message names the culprit too:
"Contains sulphites — White wine".

`menu_item_ingredients` is indexed by ingredient as well as by dish, because
"which dishes use this?" is the query you need the hour a supplier issues a
recall notice.

### Saved dishes

There are no accounts, so a saved list is keyed by an opaque token the browser
mints and keeps (`lib/hooks/useSavedDishes`). The token *is* the credential:
whoever holds it can read and change that list, so it is 192 bits of randomness
and nothing identifying is stored beside it. That trade is fine for a favourites
list and would not be for anything else — which is exactly why the allergen
profile never goes near it.

Saved dishes are re-evaluated against the diner's *current* profile every time
the list is opened, so a dish kept last month turns unsafe the moment they add
an allergen.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/saved?token=…` | The list, hydrated into full menu items |
| `POST` | `/api/saved` | Save. Idempotent |
| `DELETE` | `/api/saved?token=…&menuItemId=…` | Remove |

### The menu editor

`/admin` is the venue-side editor: dishes, prices, portions, nutrition,
ingredients and allergen declarations, plus the availability toggle staff
actually reach for mid-service.

Authentication is a per-venue **access key**, issued out of band, exchanged at
sign-in for a signed httpOnly session cookie. Only the SHA-256 of a key is
stored — a password would need a slow KDF because humans pick weak ones, but
these are machine-generated tokens with no dictionary to run, so what matters is
that a database leak hands over no live keys. Keys are revoked, never deleted,
so an audit can still say who had access when.

**The venue is always taken from the session, never from the request.** Every
write is scoped by `restaurant_id` in its `WHERE` clause, so a valid session for
one venue matches no rows in another's — verified by pointing an Aurelia session
at a Hanoi House dish and getting a 404 from update, toggle and delete alike.
The 404 is deliberate: confirming the dish exists would leak another venue's ids.

The editor shows which allergens the ingredient list already implies, live as
you add ingredients, so nobody re-declares them by hand. The hand-declared field
is reserved for what no ingredient can know — a shared fryer, a supplier notice.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/admin/session` | Exchange an access key for a session |
| `GET` | `/api/admin/session` | Current session, if any |
| `DELETE` | `/api/admin/session` | Sign out |
| `GET` | `/api/admin/menu-items` | Every dish plus the ingredient catalogue |
| `POST` | `/api/admin/menu-items` | Create or update a dish |
| `PATCH` | `/api/admin/menu-items` | Toggle availability |
| `DELETE` | `/api/admin/menu-items` | Remove a dish |

Editing a dish also offers a photo upload, which runs the 2D-to-3D pipeline
below and records the result against the dish — so a venue turns a photo into
the model diners see in AR without touching a terminal. The panel reports the
three LOD tiers and says out loud when a photo was already generated and cost
nothing, because a venue that knows re-uploading is free will re-photograph
until the mesh is right.

### The allergen model

Severity is three-valued, because "contains peanuts" and "fried in a shared
peanut fryer" are different facts:

| Severity | Meaning | Hard conflict? |
| --- | --- | --- |
| `contains` | A listed ingredient | Always |
| `may_contain` | Shared fryer or prep surface | Only in strict mode (the default) |
| `removable` | An optional garnish that can be left off | Never — shown as an advisory |

Strict mode is on unless explicitly disabled, so the failure mode is a spurious
warning rather than a missed one.

A diner's profile lives in `localStorage` and is **never persisted
server-side** — it is health data and TasteBuddy has no account to attach it to.
It reaches `/api/menu` as a query string for the life of one request. The
dashboard re-evaluates conflicts on the client with the same pure function the
API uses (`lib/menu-filter.ts`), so toggling an allergen is instant and a dish
can never be judged safe in one place and unsafe in another.

### `GET /api/menu`

| Parameter | Description |
| --- | --- |
| `restaurant` | **Required.** UUID or QR slug |
| `allergens` | `peanuts,dairy,gluten` — unknown keys are ignored, not rejected |
| `strict` | `false` stops treating "may contain" as a conflict |
| `mode` | `flag` (default) annotates conflicts; `exclude` drops unsafe dishes |
| `category` | `starters` \| `mains` \| `sides` \| `desserts` \| `drinks` |
| `q` | Fuzzy name/description search |
| `portions` | `itemId:1.5,otherId:0.75` — thresholds apply to the scaled portion |
| `maxCalories`, `maxSodium`, `maxSugar`, `maxFat`, `maxCarbs`, `maxProtein`, `maxFiber` | Upper bounds |

```bash
curl "localhost:3000/api/menu?restaurant=hanoi-house&allergens=peanuts,shellfish&maxSodium=1500&mode=exclude"
```

### `/api/tastebuddy-pipeline`

| Method | Purpose |
| --- | --- |
| `POST` | `multipart/form-data` with `image` and `menuItemId`. Starts a mesh job. |
| `GET ?jobId=…` | Poll a job. Omit `jobId` for the pipeline's configuration. |
| `PUT` | Generator webhook callback, HMAC-SHA256 signed. |

1. **Validate cheaply first.** Format is sniffed from magic bytes, never trusted
   from the multipart header; size and pixel dimensions are read from the file
   header without decoding the image. A photo that cannot produce a usable mesh
   is rejected before any money is spent on it.
2. **Hash and look up.** A checksum hit returns the cached CDN paths and the
   request costs nothing.
3. **Submit, decimate, cache.** The finished mesh is decimated into three tiers
   and written to immutable, content-addressed paths.

Failed jobs are deliberately *not* cached, so a retry is always allowed.

`POST` requires a staff session and a dish belonging to that venue, checked
before a single byte is hashed — mesh generation costs real money per call, and
an open endpoint is a way to spend someone else's budget. `PUT` is the generator
calling back, carries no cookie, and is authenticated by its HMAC signature.

Every outcome is written to `asset_3d`, including `processing` and `failed`.
Without that the pipeline produced CDN paths nothing read: a job could succeed
and the diner's AR view would still fall back to procedural geometry.

With `GENERATOR_WEBHOOK_URL` unset, a built-in mock follows the identical
contract — job id now, signed callback later — so the whole pipeline is
exercised end to end in development without a paid API key.

### Polygon reduction

Budgets are set by the tightest real constraint, which is **mobile Safari**, not
Chrome (`lib/pipeline/lod.ts`):

| Tier | Triangles | Texture | Budget | Used for |
| --- | --- | --- | --- | --- |
| `high` | 65k | 2048px | 3 MB | Desktop and tablets on Wi-Fi. Never auto-selected on a phone. |
| `medium` | 35k | 1024px | 1.4 MB | Default. Fits the iOS WebGL budget alongside the camera texture. |
| `low` | 12k | 512px | 500 KB | ≤4 GB Android, `Save-Data`, 3G. |

iOS never exposes `navigator.deviceMemory`, so mobile Safari is capped at
`medium` on merit rather than on a signal that cannot be read. Textures ship as
WebP inside the `.glb` because `KHR_texture_basisu` is not guaranteed on older
iOS.

### Surface tracking

WebXR hit-testing is the right tool and is used where it exists. iOS Safari
ships no WebXR at all — which is most of the diners TasteBuddy will ever see —
so `lib/ar/plate-tracker.ts` provides the fallback: a vision pass over a 64×48
downsample of the camera feed that finds the plate directly.

A plate is reliably a large, bright, almost colourless disc against a darker,
more saturated table. The tracker takes the weighted centroid and second moment
of that mask, rejects implausible blobs (too small, too large, too elongated),
and smooths what survives. It locks after six consecutive good frames and holds
through twenty bad ones, so a shaking hand does not drop the anchor. Tap
anywhere to place the dish by hand when the surface is glass or a patterned
tablecloth.

Verify the maths without a camera:

```bash
npm run verify:tracker
```

### The AR viewer

The camera feed is a plain `<video>` composited *behind* a transparent WebGL
canvas rather than uploaded as a texture: the browser composites it for free,
the feed keeps full frame rate while the renderer is throttled, and phones avoid
a second full-resolution texture upload per frame.

The allergen warning is rendered **in the scene, anchored to the model** — a
translucent shell enclosing the food plus a camera-facing banner sprite — not
merely printed in the surrounding DOM. There is no angle from which the dish
appears without its warning. The banner is drawn to a 2D canvas and uploaded as
a texture, so it needs no font fetch and stays crisp over a live camera feed.
The banner's fill stays fully opaque and only its ring pulses; fading a safety
warning costs contrast exactly when the diner is trying to read it.

Portions scale physically: **volume** is linear in the portion multiplier, so
each linear dimension scales with its cube root. A "double portion" is not a
dish twice as wide.

## Verification

```bash
npm run build            # production build + TypeScript
npm run lint             # ESLint, including the React Compiler rules
npm run typecheck        # tsc --noEmit
npm run verify:tracker   # plate-detection, hysteresis and projection maths
```

## Deployment notes

- Camera access requires a **secure context**. The viewer detects an insecure
  origin and says so rather than failing silently.
- `next.config.ts` sets `Permissions-Policy: camera=(self)`, so the rear camera
  is available to TasteBuddy and to nothing embedded in it.
- Set `GENERATOR_WEBHOOK_SECRET` in production. The development default is not
  a secret, and callbacks with an invalid signature are rejected with a 401.
