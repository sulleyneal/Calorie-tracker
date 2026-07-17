# 🍓 Morsel

A delightful calorie tracker. Tell it what you ate the way you'd text a friend —
*"had a cappuccino and an almond croissant"* — and Morsel keeps the journal,
the math, and the pictures.

**Live app:** https://sulleyneal.github.io/Calorie-tracker/

- **Chat to log.** Free-text meal logging with quantities ("two eggs and toast").
- **Snap to log.** Photograph your plate — the brain reads the photo (Gemini
  vision, with Groq's free vision model as fallback), estimates portions, and
  your own photo becomes the journal shot. Add a note first ("half of this")
  and it's treated as ground truth.
- **Trends & insights.** A third tab that turns the journal into patterns:
  streak, 30-day average, days-on-goal, a 14-day chart, weekly rhythm, macro
  split, and a few observations in Morsel's voice. Computed entirely on-device.
- **Accurate nutrition.** Calories and macros from the
  [USDA FoodData Central](https://fdc.nal.usda.gov/) API, with a built-in
  USDA-derived database of ~120 common foods that works fully offline.
- **A picture for every plate.** Each logged item gets a soft illustrated
  plate — the food's emoji on white ceramic over a blush gradient. (Optional:
  enable AI photo generation on the server with `ENABLE_IMAGES=true`.)
- **Private by architecture.** Every journal lives in its owner's browser
  (localStorage). Share the link with anyone — they get their own Morsel and
  can never see yours.
- **A journal worth scrolling.** Day-by-day feed with daily totals, protein /
  carbs / fat shares, an animated progress toward your goal, and a little
  celebration when you land on target.

## How it's put together

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  The app (static page)  │  text   │  The brain (optional server) │
│  GitHub Pages / 1 file  │ ──────► │  • parses the meal (AI)      │
│  • your journal         │         │  • USDA nutrition lookup     │
│  • all personal data    │ ◄────── │  • stores NOTHING            │
│  • works offline        │  items  │                              │
└─────────────────────────┘         └──────────────────────────────┘
```

The static app is complete on its own (offline parser + built-in nutrition +
illustrated plates). Connecting a brain server upgrades it: unlimited food
vocabulary and live USDA data. The brain is stateless — it computes and
forgets, so one deployment serves any number of people without anyone sharing
data.

## Run it locally

```bash
npm install
cp .env.example .env   # add your keys (optional)
npm start              # → http://localhost:3000
```

Served locally, the page uses its own server as the brain automatically.

## Deploy the brain (free) and power up the public app

1. **Get keys** (all free)
   - `GROQ_API_KEY` — [console.groq.com/keys](https://console.groq.com/keys)
     — **free, no credit card.** Powers smart meal parsing; used as a fallback
     when Gemini is busy, or on its own if you skip Gemini entirely.
   - `GEMINI_API_KEY` — [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
     — optional; another free parsing provider.
   - `USDA_API_KEY` — [fdc.nal.usda.gov/api-key-signup](https://fdc.nal.usda.gov/api-key-signup)
     (free; `DEMO_KEY` works for light use)

   **Smart parsing is free** — set just `GROQ_API_KEY` for it. The brain tries
   Gemini, then Groq, then its built-in food list, so parsing keeps working
   even when one provider's free tier is congested. Food images are illustrated
   plates; optional AI photo generation (`ENABLE_IMAGES=true`) needs Gemini
   billing.
2. **Deploy on [Render](https://render.com)** — New → Blueprint → connect this
   repo (it ships a `render.yaml`). Paste your keys as environment variables.
   Set `ACCESS_CODE` to any passphrase if you don't want strangers spending
   your Gemini quota.
3. **Connect the app** — open the live app once with your brain's URL:

   ```
   https://sulleyneal.github.io/Calorie-tracker/?api=https://YOUR-APP.onrender.com
   ```

   The app remembers the brain from then on (and asks for the access code once,
   if you set one). Anyone you share that link with gets smart parsing and live
   nutrition too, while their journal stays on their own device.

> 💸 Cost note: everything here runs on free tiers. The only paid extra is
> optional AI photo generation (`ENABLE_IMAGES=true`, Gemini billing); it's off
> by default, so food images are free illustrated plates.

## Single-file build

```bash
npm run demo   # builds dist/morsel.html
```

The entire app in one HTML file — email it, open it from a USB stick, anything.
This is also exactly what GitHub Pages serves (built by
`.github/workflows/deploy-pages.yml` on every push).

## Stack

Node + Express (stateless, ~150 lines), vanilla front end — one HTML file, one
stylesheet, one script. No database anywhere: journals live in browsers.
