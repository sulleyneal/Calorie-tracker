# Morsel — gap analysis

*Written after reading every file and using the app end-to-end (text logging,
photo flow, Trends, goal calculator) at build `b20-photo-trends`. The question:
what separates this lovely side project from the calorie tracker a
MyFitnessPal-abandoner actually keeps for 90 days?*

The short answer: Morsel already wins the moments MFP loses — logging is
genuinely effortless and the app is beautiful. What it's missing is everything
*around* the log: a reason to come back tomorrow, protection for the journal
you build, honesty on day one, and grace when you make a mistake. Ranked:

## 1. The journal is mortal (data safety)

Everything lives in localStorage — which browsers evict under storage
pressure, users nuke with "clear browsing data", and Safari deletes after 7
days of disuse for non-installed sites. A person with 60 days of history loses
it all silently. That is *the* app-abandonment event; you don't come back from
it. Fixes: export/import backup (a JSON file the user owns — keeps the
privacy-by-architecture promise), `navigator.storage.persist()`, and PWA
install (which exempts storage from Safari's 7-day eviction).

## 2. Not actually installable or offline (PWA)

There's a manifest but no service worker, so: no reliable install prompt, no
icon-on-homescreen nudge, and — despite the README's promise — the Pages app
does not load offline. The bitter irony: offline *logging* already works (the
local parser + built-in food DB run entirely client-side); it's the page
itself that can't open without network. A BUILD-versioned app-shell service
worker turns Morsel into a real app you open on the subway. Must be guarded so
`dist/morsel.html` opened from `file://` still works (no SW there, by design).

## 3. First-run tells a lie (fake seed data)

A brand-new user gets a fabricated "Yesterday" — 1,235 cal of oatmeal and
shawarma they never ate — polluting the journal, the streak, the 30-day
average, and every insight computed from them. Charming for a demo GIF,
corrosive for trust in a *tracker*, where the entire product is "these numbers
are true." Replace with honest, warm empty states (they already exist and are
good) and a nudge to set your goal after the first log (goal setting is
currently hidden behind a dashed underline nobody notices).

## 4. Nothing pulls you back tomorrow (day-2 mechanics)

The streak exists — buried in Trends, which renders nothing until you've
logged 3 days. Day 2 is where trackers die. Fixes: streak shown on the Today
card from day 2 (🔥 celebrating, never guilt — a broken streak greets you with
"fresh page", not shame), and a locally-computed "yesterday, wrapped" line in
chat the first time you open a new day. Cheap, private, and it makes opening
the app feel like a reward.

## 5. Repeat meals are re-typed (speed of the 100th log)

By week 2, most meals are repeats, and every one costs a full AI round-trip.
Quick-repeat chips (your frequent foods, one tap, logged instantly from local
data — zero network) make the 100th log *faster* than the 1st. This is the
single biggest "speed everywhere" win available.

## 6. No weekly recap worth screenshotting

Trends is a good dashboard but there's no moment of narrative pride. A "Your
week" editorial card — Mon–Sun bars, days on goal, best day, streak, one warm
Morsel line — designed to be screenshot-shaped, is both a retention loop and
the app's only viral surface.

## 7. Mistakes are punished (editing)

Logged "two eggs" but ate one? Your only tool is delete — behind an ugly
`window.confirm` — then retype. Needed: portion adjust (½×, 2×) on an entry,
undo instead of confirm on delete, and in-app dialogs replacing
`confirm`/`alert`/`prompt` (which look broken inside an otherwise polished
app, and freeze headless/automated environments).

## 8. It slows down exactly when the user succeeds (perf at day 60)

Every single log re-renders the *entire* journal DOM (60 days × 176px images)
plus the full thread; boot renders all history ever. The app is fastest on
day 1 and slowest on day 90 — backwards for a retention product. Fixes: render
views only when visible, collapse older journal days behind "show earlier",
cap the boot-time thread, dirty-flags in `send()`.

## 9. Photo thumbs will hit the storage wall

420px JPEG thumbs ≈ 40–80 KB each; localStorage's ~5 MB cap arrives around
photo 80–120. `saveDb` already downgrades oldest photos to illustrated plates
on quota failure (good), but silently, and only 5 at a time under a full-quota
error storm. Proactive size budget + the same downgrade, quietly, earlier.

## 10. Insights can mislead on thin data

A day where you logged one coffee counts as a "logged day": it drags the
30-day average down and can flip insights into fiction ("you're averaging
400 cal — quietly excellent"). Averages/insights should ignore obviously
partial days (e.g. < 2 entries and < 500 cal); the chart stays honest and
shows everything.

## Non-goals (deliberate)

- **Dark mode** — the blush editorial language *is* the brand; a dark variant
  is a redesign, not a gap.
- **Accounts/sync** — privacy-by-architecture is the moat. Export/import is
  the answer to multi-device, not a server.
- **Micronutrients, water, exercise** — MFP died of feature sprawl. Morsel
  stays a calorie-and-macro journal with a personality.

## House invariants (checked every change)

- `morsel-v1` (and legacy `morsel-demo-v1`) journals migrate forward
  losslessly; a 60-day history survives every change here.
- `npm run demo` single-file build keeps working, including from `file://`.
- Free tier only; brain stays stateless; vanilla JS; BUILD bumped every
  deployable change.
