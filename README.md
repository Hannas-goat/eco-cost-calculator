# Life Cycle Calculator

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
the browser), or a PDF, Word (`.docx`), or Excel (`.xls`/`.xlsx`) document
— and an AI call extracts structured parts from it. Everything is matched against the
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
useful than none.

If a part still has no catalog match and no usable AI estimate after the
retry described below, a deliberately generic, deliberately modest
placeholder figure gets attached anyway rather than leaving the part
unusable — this is a policy choice, not a data-quality claim: every part
the AI found and could weigh becomes a real, reviewable line item in the
product, full stop, rather than requiring a trip to "Custom line item" for
anything the model wasn't confident about (which turned out to be common
enough, especially for less mainstream materials like specific battery
chemistries, that leaving it unhandled defeated the point of automatic
extraction). This is named distinctly in the UI — `"<part> (AI couldn't
identify this — GENERIC placeholder values, please correct)"` — clearly
separate from a genuine AI estimate, since the trust level really is
different: an AI estimate reflects some actual reasoning about the
material, a generic placeholder reflects none at all. A part only still
gets skipped (requiring manual entry) when its weight itself couldn't be
determined — weight is product-specific in a way generic material-class
impact figures aren't, so unlike the estimate case, there's no reasonable
generic number to fall back to there.

Uses [NVIDIA's](https://build.nvidia.com) OpenAI-compatible API — PDF text
comes via `pdf-parse`, `.docx` via `mammoth`, `.xls`/`.xlsx` via `xlsx`
(converted to CSV text) — all parsed **server-side**, capped at 15 MB per
file. Images go to a separate vision-capable model as inline image data.

This project has tried three AI providers for this feature, each change
made for a concrete reason rather than just trying a different vendor:
NVIDIA (the original setup) → Google Gemini (for its native
`responseSchema` structured-output mode, which constrains generation to a
fixed JSON shape at the API level instead of just asking nicely — closes
off a whole class of "model didn't follow the format" bugs; never
actually usable here since Gemini's free tier required a billing account
on file for this account/region) → Groq (Gemini's replacement, since its
free tier didn't have that billing requirement) → **back to NVIDIA**,
after a long run of Groq-specific problems: a default model that turned
out to be deprecated, `tools` being flatly incompatible with JSON mode on
that API (400 error, discovered by hitting it), an 8000-tokens/minute
free-tier rate cap that real usage tripped more than once, a server-side
JSON validator that rejected malformed output outright instead of
returning it for this project's own fallback parser to attempt, and a
hallucinated tool call Groq's API rejected outright. NVIDIA never
produced any of those specific failures in this project's use of it, so
it's the more proven option despite lacking Gemini's structural
guarantee — this version leans on the same numbered-index approach used
throughout instead (`"material":39` rather than `"material":"Graphite
(battery anode)"` — a wrong number is a much narrower failure mode than a
wrong string, and any out-of-range or non-numeric response just resolves
to "no match" instead of a fabricated-looking name) plus
`extractPartsObject`, a brace-scanning fallback parser that recovers a
`{"parts":[...]}` object even if the model wraps valid JSON in extra
commentary despite being told not to.

A smaller/faster model was tried once, briefly, purely to chase lower
latency (first on the NVIDIA setup, then again as Groq's default) — both
times it was measurably less reliable about following the requested JSON
shape, once wrapping an entire response in a hallucinated fake tool-call
structure with no real data in it. `NVIDIA_MODEL` defaults to a 70B-class
model for this reason; trading it for a smaller one is a real
reliability/speed tradeoff, not a free win.

This calls the AI from the **server**, never the browser — the API key is a
secret credential and must never end up in any file shipped to the client.
To enable it:

1. Get an API key from [build.nvidia.com](https://build.nvidia.com).
2. Set `NVIDIA_API_KEY` as an environment variable on your Render service
   (Environment tab — same place as `JWT_SECRET`/`TURSO_*`).
3. Optionally set `NVIDIA_MODEL` (defaults to `meta/llama-3.1-70b-instruct`),
   `NVIDIA_VISION_MODEL` (defaults to `meta/llama-3.2-90b-vision-instruct` —
   this default is the most likely to need changing, since vision-model
   availability varies by plan/key), or `NVIDIA_BASE_URL`.
4. Optionally, for web search: get a free key from
   [tavily.com](https://tavily.com) and set it as `TAVILY_API_KEY`, same
   place as above.

Until `NVIDIA_API_KEY` is set, the feature returns a clear "not configured"
message and everything else keeps working exactly as before — same pattern
as the optional Supabase/Turso setup elsewhere in this README. Rate-limited
server-side (10 requests / 10 minutes per IP) since it hits a paid API.

**Web search:** with `TAVILY_API_KEY` set, the model can call a
`search_web` tool mid-extraction to look up a detail your text/file
doesn't state — a real product's typical weight, or what a component is
actually made of — instead of just leaving it null; a component's typical
weight is a real, look-up-able fact for a specific real product, not
something general domain knowledge alone can approximate the way "rubber
roughly costs X per kg" can. This is a single unified round-based loop
(up to 1 search round before the model must produce its final answer) —
NVIDIA's API doesn't reject combining tool definitions with the plain
"output only JSON" prompt instruction the way Groq's did, so unlike that
version, this doesn't need a two-call phase split. Without
`TAVILY_API_KEY`, the model is never even told the tool exists (no
`tools` sent in the request at all), so behavior is identical to not
having this at all.

The shared low-level request function retries on a 429 (rate limit) with
exponential backoff, up to 3 retries (4 total attempts) — this stays
regardless of which provider is active, since "a paid external API can
rate-limit you" doesn't change even when the specific provider does. It
honors the API's `Retry-After` header exactly when present (capped at 15
seconds, since it's telling us precisely how long to wait); when that
header is missing, the wait doubles each attempt (2s, 4s, 8s, capped at
15s) instead of reusing one fixed guess for every retry. This is
transparent to the user when it works — a request that would have failed
on a borderline rate-limit hit just takes longer instead.

Separately, if a response finds named parts but leaves every one of them
unusable — either both "material" and "estimate" null, or a material
matched with no "weight" to attach it to (a matched material with no
weight can't become a real line item any more than an unmatched one can)
— the server retries once with a pointed correction naming what was left
blank, rather than accepting a response that's functionally the same as
finding nothing despite technically succeeding. Part of that correction:
if the text gave one overall weight for the whole product without
breaking it down per component, the model should apportion that total
across the parts by reasonable typical mass proportions (or use
`search_web`, if available, to look up a typical weight for a named real
product) rather than leaving every component's weight null. A normal or
partial response never triggers this retry, so it doesn't add latency to
the common case — though it does mean a worst-case request can take close
to twice the per-call timeout.

If a part still has no catalog match and no usable AI estimate after that
retry, a deliberately generic, deliberately modest placeholder figure
(`GENERIC_FALLBACK_ESTIMATE`) gets attached anyway rather than leaving the
part unusable — a policy choice, not a data-quality claim: every part the
AI found and could weigh becomes a real, reviewable line item, rather than
requiring a trip to "Custom line item" for anything the model wasn't
confident about. It's named distinctly in the UI (`"<part> (AI couldn't
identify this — GENERIC placeholder values, please correct)"`) so the
difference in trust level from a genuine AI estimate is obvious, not just
implied. A part only still gets skipped when its weight itself couldn't be
determined — weight is product-specific in a way generic material-class
impact figures aren't, so there's no reasonable generic number to fall
back to there.

Each "turn" (one call to the AI, including any search round inside it) is
capped at 45 seconds; since the retry mechanism above can invoke it
twice, worst-case total server time is around 90 seconds, and the
browser's own backstop is set accordingly.

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
