# Eco-Cost Calculator

A Life Cycle Assessment (LCA) tool: build a product from parts (material +
weight), optional processing and end-of-life treatment per part, assembly energy,
transport, and any custom eco-cost line — and get an eco-cost breakdown with a
hotspot chart, plus the ability to save and compare scenarios (base case vs.
alternative material vs. closed-loop recycling, etc.).

Uses the single-indicator eco-costs method (in euro), with two "Load example"
presets (felt-tip pen, pencil body) included as quick-start templates.

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

The two preset examples are checked against their known reference totals to a few
cents (source figures are pre-rounded to 2 decimals, so a full-precision
recomputation won't hit the exact cent — the calculator shows this comparison
openly rather than silently matching or hiding it).
