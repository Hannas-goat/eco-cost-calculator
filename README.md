# Eco-Cost Calculator

A Life Cycle Assessment (LCA) tool: build a product once on the Home tab and
every other tab — Carbon footprint, Water consumption, Energy used in
production, Recycled content, Sensitivity analysis — computes its indicator
from that same product automatically. Nothing needs to be re-entered per tab.

Home uses the single-indicator eco-costs method (in euros) as its primary
metric: build a product from parts (material + weight), optional processing
and end-of-life treatment per part, assembly energy, transport, and any custom
line item (which can carry its own eco-cost, carbon, water, and energy values).
Two "Load example" presets (felt-tip pen, pencil body) are included as
quick-start templates. Materials are picked via a searchable combobox (type to
filter) rather than one long dropdown.

## Tabs

- **Home** — the product builder, plus an overview dashboard totalling every
  indicator at once, the eco-cost breakdown/hotspot chart, and multi-indicator
  scenario comparison.
- **Carbon footprint** — kg CO2e breakdown and hotspot chart for the product
  you built on Home.
- **Water consumption** — litres breakdown and hotspot chart, same product.
- **Energy used in production** — kWh (embodied/cumulative energy demand)
  breakdown and hotspot chart, same product.
- **Recycled content** — weight-weighted % recycled content across the parts
  you built, with a radial meter and a list of any higher-recycled material
  alternatives available in the reference data.
- **Sensitivity analysis** — pick one input from the product you built (a
  part's weight, the assembly energy amount, a transport leg, a custom line),
  vary it by ±10/20/50%, and see how every indicator responds.

Carbon, Water, and Energy also show a "best case / worst case" range meter:
holding materials/transport/end-of-life fixed, how far would the total move if
assembly energy alone used the cleanest vs. dirtiest source already in the
reference data. Every breakdown table has a CSV export button, and the Home
overview card has a "Print / save as PDF" button that opens a dedicated report
layout via the browser's native print dialog.

## Currency

Eco-cost is stored internally in euros — that's the unit the reference data
(Idematapp/ecocostsvalue.com) is in — but everything you see or type follows
one selected currency (EUR, USD, GBP, JPY, CAD, AUD, CHF, CNY, INR): material/
process/energy/transport rate labels, the custom-line-item eco-cost input, and
every total, using live rates from the free, keyless
[exchangerate-api.com](https://www.exchangerate-api.com/) service, fetched on
first use and cached in `localStorage` for 12 hours (falling back to any
previously cached rates, or to euros, if the lookup fails). The preset
reference-total checks always stay in euros (they're validating against known
source figures), and CSV exports stay in raw euros too, for data portability.

## Trade

A "Trade" section on Home lets you record where a product was made and its
import/export costs: pick a "made in" country plus separate "imported from"
and "exported to" countries, and enter an import cost and/or export cost
(in your selected currency). This is a **financial cost only** — it adds to
the eco-cost total but contributes nothing to carbon/water/energy, since a
customs or logistics fee isn't itself an environmental impact. There's no
built-in tariff-rate lookup by country pair; real-time trade tariff data
isn't something this app has a legitimate source for, so the cost is always
whatever you enter.

## Optimization hints

Wherever a lower-impact alternative already exists in the reference data for
a material, energy source, or transport mode you've used, a hint appears
under that tab's hotspot chart (e.g. "switch material from X to Y → saves
Z"), scoped to whichever indicator that tab is about. This deliberately
doesn't cover processes or end-of-life treatments — neither is grouped by
material compatibility in the data, so a generic "lower value" match there
could suggest something physically nonsensical (e.g. an EoL option meant for
plastic, applied to a metal part).

## Regional coverage

Beyond the three original Idematapp-sourced electricity entries, `data.js`
includes additional regional electricity grids (US, Canada, Brazil, China,
India, Australia) and transport modes (ocean freight, air freight, regional
trucking) as a further estimate on the same "representative, not certified"
basis as the rest of the carbon/water/energy dataset — see the comments in
`data.js` for exactly how each figure was derived.

## Battery & capacitor materials

`data.js` also includes a small "Battery & capacitor materials" category
(graphite anode, NMC and LFP cathodes, activated carbon electrode, separator
membrane, liquid electrolyte) since these components don't map onto any of
the general materials above. These aren't covered by the Idematapp eco-cost
source either, so eco-cost is scaled from the carbon figure using the same
ratio as the regional electricity/transport additions, rather than a second
certified source — see the comment above the entries in `data.js` for
specifics. The separator/electrolyte entries are specifically Li-ion battery
chemistry (PP/PE membrane, LiPF6 electrolyte) — a supercapacitor's separator
and electrolyte are typically a different chemistry, so those two fields are
expected to stay unmatched (and fall back to "Custom line item") unless a
description explicitly names a matching chemistry.

## Bulk part upload

Instead of adding parts one at a time, upload a CSV with `Name`, `Material`,
`Weight`, `Process`, and `End-of-life` columns (the last two optional) via
"Upload parts CSV" on Home — download the template button next to it for the
exact expected format. Material/process/end-of-life names must match an
entry in `data.js` (case-insensitive); rows that don't match are skipped with
an explanation rather than silently dropped or guessed at.

## AI part extraction (optional)

A third way to fill in parts, on Home: describe the product in plain
language, or attach a file — `.txt`/`.md`/`.csv`/`.json` (read directly in
the browser), a PDF, a Word (`.docx`) or Excel (`.xls`/`.xlsx`) document, or
an image (a product photo, spec sheet, or handwritten notes) — and an AI
call extracts structured parts from it. Everything is matched against the
real material/process/end-of-life names in `data.js`, same validation as the
CSV upload, so a name the AI gets wrong never silently becomes a real part.
Suggestions are added directly to the product; review them before trusting
the numbers.

When a part's material doesn't match anything in `data.js` at all (the
reference catalog is necessarily finite — it can't cover every real-world
material), the AI is asked to default to giving its own best-guess
eco-cost/carbon/water/energy figures instead of just giving up, since these
are always clearly labeled and reviewable rather than passed off as
reference data. These are added as a custom line item named `"<part>
(AI-estimated — not in reference data, verify before trusting)"`, so
they're clearly distinguished from the vetted catalog figures everywhere
they show up (breakdowns, exports, everything reads the name as-is). The
server sanitizes each of the 4 estimate numbers (eco-cost, carbon, water,
energy) independently — coercing anything non-finite, negative, or
implausibly large to zero rather than discarding the whole estimate over
one malformed field, since a model asked for 4 numbers per part won't
always format every single one cleanly, and 3 good numbers are still more
useful than none. If neither a catalog match nor any usable estimate comes
back at all, that part is still skipped with an explanation, same as
before.

Uses [Google's Gemini API](https://ai.google.dev). PDF text comes via
`pdf-parse`, `.docx` via `mammoth`, `.xls`/`.xlsx` via `xlsx` (converted to
CSV text) — all parsed **server-side**, capped at 15 MB per file. Images go
straight to Gemini as inline image data — Gemini's Flash models are
natively multimodal, so unlike a lot of other providers there's no separate
vision-only model to configure.

This calls the AI from the **server**, never the browser — the API key is a
secret credential and must never end up in any file shipped to the client.
To enable it:

1. Get a free API key from [Google AI Studio](https://ai.google.dev) (no
   credit card required for the free tier).
2. Set `GEMINI_API_KEY` as an environment variable on your Render service
   (Environment tab — same place as `JWT_SECRET`/`TURSO_*`).
3. Optionally set `GEMINI_MODEL` (defaults to `gemini-2.0-flash`),
   `GEMINI_BASE_URL`, or `GEMINI_ENABLE_SEARCH=false` to turn off web search
   (see below) without removing the key entirely.

Until `GEMINI_API_KEY` is set, the feature returns a clear "not configured"
message and everything else keeps working exactly as before — same pattern
as the optional Supabase/Turso setup elsewhere in this README. Rate-limited
server-side (10 requests / 10 minutes per IP) since it hits a paid-beyond-
free-tier API.

**Structured output, not prompt-based hoping:** extraction uses Gemini's
native `responseSchema` mode, which constrains generation to a fixed JSON
shape at the API level rather than just asking the model nicely to follow a
format described in the prompt. An earlier version of this feature (on a
different provider) went through several rounds of prompt tightening —
numbered list indices instead of name strings, worked examples for
ambiguous cases — fighting the model returning subtly-off-schema output
despite explicit instructions (e.g. inventing a plausible but non-existent
material name, or once, on a smaller/faster model that was tried and
reverted, wrapping the entire response in a hallucinated fake tool-call
shape with no real data in it at all). A schema constraint closes off that
whole failure class structurally instead of trying to out-word it.

**Web search:** Gemini has Google Search grounding built into the API — no
separate search-provider key needed. When enabled (the default;
`GEMINI_ENABLE_SEARCH=false` to disable), extraction runs as two calls: an
optional research pass with search grounding enabled to look up a detail
your text/file doesn't state (a real product's typical weight, what a
component is actually made of, etc.), then the structured extraction call
with whatever it found folded in as extra context. These have to be two
separate calls — Gemini doesn't support combining search grounding with
`responseSchema` in the same request — but a failed or unhelpful research
pass never sinks the whole extraction; it just proceeds without whatever
that lookup would have filled in. The server never waits more than 60
seconds across both calls combined (the browser has its own 75-second
backstop in case the server itself stalls).

The `extractPartsObject` brace-scanning JSON parser from an earlier version
of this feature is kept as a defensive fallback in case `JSON.parse` ever
fails on what's supposed to be guaranteed-clean structured output, but
shouldn't normally be reachable.

The model is asked to return a **list number**, not a name, for each
material/process/end-of-life match (e.g. `39` rather than `"Graphite
(battery anode)"`), which the server then resolves back to the real name —
a wrong number is a much narrower failure mode than a wrong string, and any
out-of-range or non-numeric response just resolves to "no match" rather
than a fabricated-looking name.

## Accounts

Optional — the calculator works fully without signing in; saved scenarios
then just stay in the current browser's `localStorage`. Signing in saves
scenarios to your account instead, accessible from any device.

This runs on a small Express server (not a static site) with its own
database and hand-rolled email/password auth (bcrypt-hashed passwords, a
signed JWT in an httpOnly cookie). The database is [Turso](https://turso.tech)
(hosted libSQL/SQLite), but the server also works against a local SQLite file
with zero setup — see "Running it" below.

**Production setup (Render):**

1. Create a database at [turso.tech](https://turso.tech) (free tier) and get
   its connection URL and an auth token for it (`turso db show <name> --url`
   and `turso db tokens create <name>`, or from their dashboard — this needs
   to be a *database* auth token, not a general platform API key).
2. In the Render dashboard for this service's Environment tab, set:
   - `TURSO_DATABASE_URL` — the `libsql://...` URL from step 1
   - `TURSO_AUTH_TOKEN` — the database auth token from step 1
   - `JWT_SECRET` — any long random string (e.g. `openssl rand -base64 32`);
     this signs session cookies, so treat it as a real secret
3. Deploy. The server creates its `users` and `scenarios` tables automatically
   on first boot — no manual SQL needed.

None of these are committed to the repo (`render.yaml` just declares that
they're expected — `sync: false` means "set this manually").

## Running it

```
npm install
npm start
```

then open `http://localhost:3000/`. Without `TURSO_DATABASE_URL` set, the
server automatically falls back to a local SQLite file (`local-dev.db`,
gitignored) — full accounts + scenario storage work immediately with no
external service needed for local development. You do need `JWT_SECRET` set
to *something* even locally (the server refuses to start without it), e.g.:

```
JWT_SECRET=dev-secret npm start
```

## Files

- `public/index.html`, `public/styles.css`, `public/app.js` — the frontend
  (served as static files by `server.js`)
- `public/data.js` — the eco-cost reference database (materials, processes,
  energy, transport, end-of-life) and the two preset examples, with sourcing notes
- `server.js` — the Express app: serves the frontend, plus the `/api/*`
  auth and scenarios endpoints

## About the data

The eco-cost figures in `public/data.js` are based on Idematapp / ecocostsvalue.com
reference data (2020 excerpts), covering common materials, processes, energy, and
transport modes. Use the "Custom line item" field in the calculator for any
material, process, or cost not covered.

The carbon (kg CO2e), water (L), energy-in-production (kWh), and recycled-content
(%) figures are a **separate** data set: representative values compiled from
general public LCA literature, not from the same certified source as the eco-cost
figures. Treat them as indicative reference values rather than certified numbers,
and use the custom line fields for measured/certified data where precision
matters.

The two preset examples are checked against their known eco-cost reference totals
to a few cents (source figures are pre-rounded to 2 decimals, so a full-precision
recomputation won't hit the exact cent — the calculator shows this comparison
openly rather than silently matching or hiding it). The carbon/water/energy/
recycled figures for the presets are not separately validated against a reference
total.
