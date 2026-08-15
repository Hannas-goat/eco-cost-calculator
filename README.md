# Eco-Cost Calculator

A Life Cycle Assessment (LCA) tool with six tabs, each independently usable: a
product-level eco-cost calculator (Home) plus five standalone single-purpose
calculators for other environmental indicators.

Home uses the single-indicator eco-costs method (in euro): build a product from
parts (material + weight), optional processing and end-of-life treatment per
part, assembly energy, transport, and any custom line item, and get an eco-cost
breakdown with a hotspot chart, plus the ability to save and compare scenarios
(base case vs. alternative material vs. closed-loop recycling, etc.). Two "Load
example" presets (felt-tip pen, pencil body) are included as quick-start
templates.

## Tabs

- **Home** — the eco-cost product builder, plus an overview dashboard
  previewing the current result from every other tab.
- **Carbon footprint** — standalone: add energy sources and kWh used, get a
  kg CO2e breakdown and hotspot chart.
- **Water consumption** — standalone: same energy-usage inputs, litres
  breakdown and hotspot chart.
- **Energy used in production** — standalone: same energy-usage inputs, kWh
  (embodied/cumulative energy demand) breakdown and hotspot chart.
- **Recycled content** — standalone: add materials and weights, get a
  weight-weighted % recycled content.
- **Sensitivity analysis** — standalone: enter any base value, vary it by
  ±10/20/50%, and see the resulting range.

Carbon footprint, Water consumption, and Energy used in production share one
underlying list of energy-usage entries (source + kWh) — add an entry from any
of the three tabs and all three totals update together, since they're all
measured per kWh of the same energy use. Recycled content and Sensitivity
analysis each keep entirely separate state. None of the five standalone tabs
read from the Home product builder, or from each other.

## Extra analysis & export

- **Best case / worst case.** Carbon footprint, Water consumption, and Energy
  used in production each show a range meter comparing your total against what
  it would be if every entry had used the cleanest (or dirtiest) energy source
  already in the reference data — grounded in the app's own data, not an
  external benchmark.
- **Higher-recycled alternatives.** The Recycled content tab flags any material
  you've added that has a higher-recycled variant elsewhere in the reference
  data (e.g. Aluminium (primary) → Aluminium (secondary), 100%).
- **CSV export.** Every breakdown table (Home eco-cost, Carbon, Water, Energy,
  Recycled) has an "Export CSV" button.
- **Print / save as PDF.** The button on the Home overview card opens the
  browser print dialog with a dedicated report layout (all tabs' data shown at
  once, forms and buttons hidden) — use "Save as PDF" there for a shareable
  report. No server or library involved; it's the browser's native print-to-PDF.

## Running it

No build step, no server-side logic — it's a static site.

```
python -m http.server 8000
```

then open `http://localhost:8000/`. (Or just open `index.html` directly in a browser.)

## Files

- `index.html` — page structure
- `styles.css` — styling
- `data.js` — the eco-cost reference database (materials, processes, energy,
  transport, end-of-life) and the two preset examples, with sourcing notes
- `app.js` — calculator logic, rendering, and scenario persistence (localStorage)

## About the data

The eco-cost figures in `data.js` are based on Idematapp / ecocostsvalue.com
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
