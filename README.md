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

Uses NVIDIA's OpenAI-compatible API (`https://build.nvidia.com`) — text
documents go to a text model; images go to a separate vision-capable model,
since not every model on a given key/plan supports both. PDF text comes via
`pdf-parse`, `.docx` via `mammoth`, `.xls`/`.xlsx` via `xlsx` (converted to
CSV text) — all parsed **server-side**, capped at 15 MB per file.

This calls the AI from the **server**, never the browser — the API key is a
secret credential and must never end up in any file shipped to the client.
To enable it:

1. Get an API key from [build.nvidia.com](https://build.nvidia.com).
2. Set `NVIDIA_API_KEY` as an environment variable on your Render service
   (Environment tab — same place as `JWT_SECRET`/`TURSO_*`).
3. Optionally set `NVIDIA_MODEL` (defaults to `meta/llama-3.1-70b-instruct`;
   a faster 8B variant was tried as the default here briefly, but it wasn't
   reliable about actually following the requested JSON schema — it would
   sometimes wrap the whole response in a hallucinated fake tool-call shape
   instead of doing the extraction at all, which isn't something recoverable
   after the fact since there's no real data in it), `NVIDIA_VISION_MODEL`
   (defaults to `meta/llama-3.2-90b-vision-instruct` — this one's the most
   likely to need changing, since vision-model availability varies by
   plan/key), or `NVIDIA_BASE_URL`.
4. Optionally, for web search: get a key from [tavily.com](https://tavily.com)
   (free tier available) and set it as `TAVILY_API_KEY`, same place as above.

Until `NVIDIA_API_KEY` is set, the feature returns a clear "not configured"
message and everything else keeps working exactly as before — same pattern
as the optional Supabase/Turso setup elsewhere in this README. Rate-limited
server-side (10 requests / 10 minutes per IP) since it hits a paid API.

**Web search (optional, on top of the above):** with a
[Tavily](https://tavily.com) API key set as `TAVILY_API_KEY`, the model can
call a `search_web` tool mid-extraction to look up a detail your text/file
doesn't state — a real product's typical weight, what a component is
actually made of, etc. — instead of just leaving it blank. It's only asked
to do this when it actually names something specific and answerable; it's
told explicitly not to search speculatively for every part. Without
`TAVILY_API_KEY`, the model is never even told the tool exists (no `tools`
sent in the request at all), so extraction works exactly as it did before
this was added — just without the ability to look anything up.

The server never waits more than 100 seconds on the whole extraction —
covering every model call *and* every search it runs, not per-call — before
giving up and returning a clear timeout error (the browser has its own
120-second backstop in case the server itself stalls). The loop is capped
at a single search-then-reask round (down from a first attempt at 2-3)
before the model is asked, with search no longer offered, to settle on a
final answer regardless, and every search a round asks for runs
concurrently rather than one-by-one — both still in effect and both purely
upside (less latency, no quality tradeoff). The 8B-model swap that was
tried alongside those two is not, for the reliability reason noted above,
so 70B remains the default despite being the slower option. If speed still
matters more than the search capability for your traffic, the fastest fix
available without a redeploy is removing `TAVILY_API_KEY` — that reverts to
the original single-call flow with no search overhead at all. JSON
extraction
from the model's reply also tries every brace-delimited candidate in the
text and validates its shape before accepting it, rather than assuming the
first (or first-to-last) braces are the real answer — models often wrap
JSON in commentary despite being told not to, and a naive extraction breaks
the moment that commentary itself contains any brace-like text.

The model is asked to return a **list number**, not a name, for each
material/process/end-of-life match (e.g. `39` rather than `"Graphite
(battery anode)"`), which the server then resolves back to the real name.
An earlier version asked for the exact name string and, despite explicit
instructions and examples, the model would sometimes invent a plausible
but non-existent variant (e.g. `"Carbon (activated)"`) instead of the real
catalog entry — a wrong number is a much narrower failure mode than a
wrong string, and any out-of-range or non-numeric response just resolves
to "no match" rather than a fabricated-looking name.

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
