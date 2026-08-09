# Eco-Cost Calculator

A small Life Cycle Assessment (LCA) tool: build a product from parts (material +
weight), optional processing and end-of-life treatment per part, assembly energy,
transport, and any custom eco-cost line — and get an eco-cost breakdown with a
hotspot chart, plus the ability to save and compare scenarios (base case vs.
alternative material vs. closed-loop recycling, etc.).

Built after reviewing the INNOMAT / EIT RawMaterials Academy "Module 1: Life Cycle
Assessment" training deck. The method (single-indicator eco-costs, in euro) and the
two "Load example" presets (felt-tip pen, pencil body) are taken directly from that
deck's own worked examples.

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
  transport, end-of-life) and the two preset worked examples, transcribed from the
  training deck with sourcing notes
- `app.js` — calculator logic, rendering, and scenario persistence (localStorage)

## About the data

The eco-cost figures in `data.js` are a small illustrative sample transcribed from
the deck's own slides (Idematapp 2020 database excerpts) — not the full licensed
Idematapp / ecocostsvalue.com database. Use the "Custom line item" field in the
calculator for any material, process, or cost not in the sample list.

The two preset examples validate against the deck's own printed totals within a few
cents (the deck displays each line pre-rounded to 2 decimals, so a full-precision
recomputation from those same rounded numbers won't hit the exact cent — the
calculator shows this comparison openly rather than silently matching or hiding it).
