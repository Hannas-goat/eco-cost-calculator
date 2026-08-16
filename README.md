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
