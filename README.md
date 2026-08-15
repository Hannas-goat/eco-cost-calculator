# Eco-Cost Calculator

A Life Cycle Assessment (LCA) tool: build a product from parts (material +
weight), optional processing and end-of-life treatment per part, assembly energy,
transport, and any custom line item — and get a full multi-indicator impact
breakdown, plus the ability to save and compare scenarios (base case vs.
alternative material vs. closed-loop recycling, etc.).

Uses the single-indicator eco-costs method (in euro) as its primary metric, with
two "Load example" presets (felt-tip pen, pencil body) included as quick-start
templates.

## Tabs

- **Home** — the product builder, an overview dashboard totalling every
  indicator at once, the eco-cost breakdown/hotspot chart, and saved-scenario
  comparison.
- **Carbon footprint** — kg CO2e breakdown and hotspot chart.
- **Water consumption** — litres breakdown and hotspot chart.
- **Energy used in production** — kWh (embodied/cumulative energy demand)
  breakdown and hotspot chart.
- **Recycled content** — weight-weighted % recycled content across the parts
  in your product.
- **Sensitivity analysis** — pick one input from your current product, vary it
  by ±10/20/50%, and see how every indicator responds.

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
