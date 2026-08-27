# TasteBuddy

Point your phone at a menu you cannot read, and it tells you what every dish
is.

No account, no restaurant to have joined, nothing to install. It works the
first time you open it, in a restaurant that has never heard of it.

```bash
npm install
npm run dev            # http://localhost:3000
```

To use it on a phone on the same Wi-Fi:

```bash
npm run dev:lan        # binds 0.0.0.0 — reach it at http://<your-lan-ip>:3000
npm run dev:lan:https  # same, over HTTPS — required for "see it on your plate"
```

`getUserMedia` only runs in a secure context, and a bare LAN IP over plain
HTTP is not one. Everything works under `dev:lan` except the camera view,
which needs `dev:lan:https` and a self-signed certificate you accept once on
the device.

## What it does

**Photograph a menu.** It reads every dish, translates it, and says what each
one is in plain words. Anything that clashes with your allergies is flagged on
the row.

**Type a dish.** One name you cannot place, in whatever spelling you managed.
It comes back with the proper name and accents, what it is, what it tastes
like, and what is usually in it.

**See it on your plate.** The camera opens, the app finds an empty plate on the
table, and the dish is placed on it at real size. The geometry is built from
the dish's own name — nothing here has a photograph of the real food, and every
screen showing one says so.

## The one rule

The app is allowed to say what a dish is **normally** made with. It has no
vocabulary for what this kitchen actually did.

That is a deliberate line, and it is drawn in the type system rather than in a
comment. `LikelyAllergen.likelihood` is `"usually" | "sometimes"` — there is no
third value, so the model cannot express certainty about a kitchen it has never
seen. `from` names the part of the dish the allergen comes from, because "the
peanut sauce" is something you can point at and ask about and "peanuts" is not.
`recognised` goes false when the model does not know the dish, and a dish
nobody recognised never gets a green tick: an empty allergen list on an unknown
dish means "I do not know", not "there is nothing there".

Somebody standing in front of a menu they cannot read is asking exactly this
question, and "pad thai usually has peanuts" is the answer that keeps them
safe. Refusing to answer would not make anyone safer; it would send them to
order blind.

Your allergies never leave your phone. There is no account to attach them to
and no request that carries them: dishes are matched against them in the
browser.

## Running it

One environment variable matters:

```bash
ANTHROPIC_API_KEY=sk-ant-...   # reading menus and looking up dishes
```

Without it the app loads and says it is not switched on. Everything else is
optional — see `.env.example`.

`DATABASE_URL` is only used for rate limiting. There is one table
(`db/schema.sql`) and it holds no food and no people: just a count of how often
the app has been asked, so that something anyone can use does not become a bill
its owner did not choose. Without a database those counters live in memory,
which is fine for local work and is not a real limit.

## Checks

```bash
npm run typecheck
npm run lint
npm run build
npm run verify:tracker    # 26 checks on the plate-finding vision pass
npm run verify:contrast   # every colour that carries text, measured
```

`verify:contrast` exists because an alert nobody can read is worse than no
alert, and "it looks fine on my screen" is not a measurement.

## Layout

```
app/
  page.tsx              the whole app; there is only one route
  api/read-menu/        a photographed menu to a list of dishes
  api/explain/          one dish name to everything the app can say
components/
  app/                  the screens and the bar along the bottom
  ar/                   the camera view and the geometry that goes in it
lib/
  dish/                 the model calls, the safety shape, the spend caps
  ar/                   plate tracking and the parametric dish builder
  hooks/                allergies and history, both local to the browser
```
