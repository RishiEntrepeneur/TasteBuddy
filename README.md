# TasteBuddy

Point your phone at a menu you cannot read, and it tells you what every dish
is.

No account, no restaurant to have joined, nothing to install. It works the
first time you open it, in a restaurant that has never heard of it.

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev            # http://localhost:3000
```

## On your phone

This is a thing you use standing up, in a restaurant, holding a menu. A laptop
is not where it is tested.

### The quick way: put it online

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRishiEntrepeneur%2FTasteBuddy%2Ftree%2Fclaude%2Ftastebuddy-architecture-setup-8n9jgg&env=ANTHROPIC_API_KEY&envDescription=Your%20Anthropic%20API%20key.%20Reading%20menus%20is%20the%20only%20thing%20this%20app%20does%2C%20so%20nothing%20works%20without%20it.&envLink=https%3A%2F%2Fconsole.anthropic.com%2Fsettings%2Fkeys&project-name=tastebuddy&repository-name=tastebuddy)

It copies the repository into your own account and asks for one thing:
`ANTHROPIC_API_KEY`. No database, no other settings. You get an `https://` URL
with a real certificate, which is what makes the camera work with no warning to
click through — so this is the route to take if you want *see it on your plate*
to just work, or if you want to send the link to somebody else.

`maxDuration` is set to 60 seconds on both routes. Reading a full page of
dishes is not a ten-second job, and ten seconds is the default a serverless
host will give you.

Once it is online, open it on the phone and add it to the home screen — Share →
Add to Home Screen on iOS, the install prompt or ⋮ → Add to Home screen on
Android. It gets its own icon and launches without any browser chrome, which is
what the camera view wants: no address bar sliding around over a live feed.

### The other way: same Wi-Fi as your computer

```bash
npm run dev:lan:https   # then open https://<your-computer>:3000 on the phone
```

Find `<your-computer>` — your machine's address on the Wi-Fi, not `localhost`:

| | |
|---|---|
| macOS | `ipconfig getifaddr en0` |
| Windows | `ipconfig` — the IPv4 Address under your Wi-Fi adapter |
| Linux | `hostname -I` |

It looks like `192.168.1.24`. Both devices have to be on the same network, and
some guest and campus networks block devices from seeing each other at all.

Use `dev:lan:https`, not `dev:lan`. `getUserMedia` only runs in a secure
context and a bare LAN IP over plain HTTP is not one, so over `dev:lan`
everything works *except* the camera view. HTTPS here means a certificate the
phone has never heard of: it will warn you once, and you tap through it. On an
iPhone that warning is also the most common reason the camera still refuses
afterwards — if it does, deploy it instead.

## What it does

**Photograph a menu.** It reads every dish, translates it, and says what each
one is in plain words. Anything that clashes with your allergies is flagged on
the row.

Whatever your phone hands over is fine. A HEIC off an iPhone, a 35 MB photo, a
picture taken sideways: `lib/dish/photo.ts` decodes it on the device, turns it
the right way up, shrinks it to the 2576px Claude Opus 5 actually reads, and
re-encodes it as a JPEG. That is also what strips the EXIF, so the location a
restaurant photo carries never leaves the phone.

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

One warning is not a guess at all. Where you avoid something a *trace* of will
hurt — gluten, peanuts, tree nuts, shellfish, fish, sesame, molluscs — the app
says so on every dish and once at the top of every menu, including the ones
that came back clear. No menu prints which fryer is shared, and this app cannot
see it either. "Nothing you avoid" on a plate of chips is exactly the screen
where somebody needs to hear that.

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
npm run verify:tracker    # 62 checks on the plate-finding vision pass
npm run verify:contrast   # every colour that carries text, measured
npm run verify:shapes     # the recipe each dish name picks
npm run verify:picture    # what survives out of a dish name into a prompt
```

`verify:contrast` exists because an alert nobody can read is worse than no
alert, and "it looks fine on my screen" is not a measurement.

### The one that needs a key

```bash
npm run try:menu                        # the bundled fixture
npm run try:menu -- ~/your-menu.jpg     # your own photo
```

Everything above proves the plumbing. None of it proves the answers are any
good, which is the only thing that matters, and that needs a real photo and a
real call.

`fixtures/menu-photo.jpg` is a Hanoi menu shot at an angle, with window glare
down one side and the far edge out of focus. `fixtures/menu-photo.expected.json`
is what is actually printed on it, so the run is scored rather than admired:
every dish found, every price attached to the right dish, the seven allergens
buried in Vietnamese descriptions (`chấm tương đậu phộng` is peanut sauce,
`nước mắm` is fish sauce, `đậu phụ` is tofu), and the two dishes that should
come back vegetarian.

The prices are the trap. They sit on the line *above* their dish, so anything
reading by vertical position alone attaches every one of them to the wrong row.

Drop your own photo in and it prints what came back for you to read. Add a
`your-menu.expected.json` beside it and it scores that too.

## The picture at the top of a dish

Two things can fill it, and they arrive in that order.

The **3D model** is built on the device out of the dish's own words —
`lib/ar/dish-geometry` picks a shape from the name, then from how the dish is
served, then from what is in it. It is instant, it works offline, and it will
never look like food.

The **drawing** is fetched from `/api/dish-image`, which asks
[Pollinations](https://pollinations.ai) for one. Free, no key, no account. It
fades in over the model when it arrives; if it never arrives the model is
already there and the diner notices nothing.

It is a *drawing*, deliberately, and the prompt says so four different ways.
Everything else in this app is built so a guess cannot pass for a fact, and an
image is the easiest place to lose that: a photorealistic plate sitting
directly above a line about peanuts gets read as **this restaurant's plate**,
which nobody has seen. A drawing is obviously a drawing, and the caption says
it twice.

A dish the model did not recognise gets neither. Empty plate, and a line
saying why.

The route proxies rather than linking straight out, which buys three things:
the diner's browser never talks to the drawing service, so their address does
not go with it; the response carries this app's own year-long immutable cache
header, so a CDN draws `masala dosa` once for everybody; and a failure arrives
as this app's failure, which the screen already knows how to fall back from.
Only the dish's name leaves, and it came off a printed menu in the first place.

`cleanDishName` is not decoration. That name reached the app off a photograph
of a menu a stranger printed, by way of a model, and is about to be pasted into
an instruction for a second generator. Letters, marks, digits and the
punctuation real dish names contain survive; newlines and `--flags` do not.
`npm run verify:picture` holds it.

```bash
DISH_IMAGES=off                  # no drawings; the 3D model only
DISH_IMAGE_HOST=https://…/       # a different generator, or a stand-in
```

## The offline demo

```bash
npm run demo:build     # writes demo/dist/tastebuddy-demo.html
```

One HTML file, about 1.6 MB, that reaches for nothing at all: no server, no
font host, no network. It is the real app — `components/` and `lib/` bundled
untouched — with one substitution. `demo/kitchen.ts` sits in front of `fetch`
and answers the two API routes from a list of dishes in `demo/dishes.ts`,
because a page opened from a file, or published somewhere that will not let it
call out, has nothing to ask.

Two things it deliberately does not fake. A dish outside the list comes back
`recognised: false` rather than invented, which is what the real model does
with a dish it does not know and what the screens already handle. And the
camera button does not pretend to have read your photo: it returns a fixed
sample menu and says so in the `notes` line the menu screen already prints.

It is a demo, not a substitute. Reading a menu needs the model, and the model
needs a key.

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
