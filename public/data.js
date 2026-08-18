// Country list for the Trade section (country made in / imported from / exported to) —
// just standard country names for labeling; no per-country cost or tariff data is looked
// up automatically. The user enters the actual import/export cost themselves, since
// real-time tariff rates aren't something this app has a legitimate source for.
const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Argentina', 'Armenia', 'Australia', 'Austria',
  'Azerbaijan', 'Bahrain', 'Bangladesh', 'Belarus', 'Belgium', 'Bolivia',
  'Bosnia and Herzegovina', 'Brazil', 'Brunei', 'Bulgaria', 'Cambodia', 'Cameroon',
  'Canada', 'Chile', 'China', 'Colombia', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus',
  'Czechia', 'Denmark', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador',
  'Estonia', 'Ethiopia', 'Finland', 'France', 'Georgia', 'Germany', 'Ghana', 'Greece',
  'Guatemala', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia',
  'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan',
  'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Latvia', 'Lebanon', 'Libya',
  'Liechtenstein', 'Lithuania', 'Luxembourg', 'Malaysia', 'Malta', 'Mexico', 'Moldova',
  'Monaco', 'Mongolia', 'Morocco', 'Myanmar', 'Nepal', 'Netherlands', 'New Zealand',
  'Nicaragua', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan',
  'Panama', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania',
  'Russia', 'Saudi Arabia', 'Serbia', 'Singapore', 'Slovakia', 'Slovenia',
  'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sweden', 'Switzerland',
  'Syria', 'Taiwan', 'Thailand', 'Tunisia', 'Turkey', 'Ukraine',
  'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 'Uzbekistan',
  'Venezuela', 'Vietnam', 'Yemen',
];

// Eco-cost reference data, based on Idematapp/ecocostsvalue.com reference data
// (2020 excerpts). Covers common materials, processes, energy, and transport modes —
// use "Custom material / process" for anything not listed here. Eco-costs are in
// euro per kg unless noted otherwise.
//
// co2e / water / energyIn fields (carbon footprint, water consumption, energy used in
// production) are a SEPARATE data set from the eco-cost figures above: representative
// values compiled from general public LCA literature (e.g. World Aluminium, ecoinvent-
// style typical ranges, IPCC/grid emission factors), not from the same certified
// Idematapp/ecocostsvalue.com source as eco-cost. Treat them as indicative reference
// values, not certified figures — use the "Custom line item" fields for measured or
// certified numbers where precision matters. Units follow the same basis as ecoCost
// for each table (per kg for materials/processes/end-of-life, per tonne-km for
// transport) except the energy table, which is per kWh of electricity delivered.
// recycledPct is the % of a material's mass sourced from recycled feedstock.

const MATERIALS = [
  // --- Metals (page 33: Simapro/Idematapp2020 background-process output) ---
  { id: 'al-primary', category: 'Metals', name: 'Aluminium (primary)', ecoCost: 2.61, co2e: 11.9, water: 1240, energyIn: 45, recycledPct: 0 },
  { id: 'al-secondary', category: 'Metals', name: 'Aluminium (secondary)', ecoCost: 0.36, co2e: 0.6, water: 70, energyIn: 2.8, recycledPct: 100 },
  { id: 'al-trademix', category: 'Metals', name: 'Aluminium trade mix (66% prim / 33% sec)', ecoCost: 1.84, co2e: 8.05, water: 842, energyIn: 30.6, recycledPct: 33 },
  { id: 'cu-primary', category: 'Metals', name: 'Copper (primary)', ecoCost: 8.82, co2e: 3.5, water: 180, energyIn: 20, recycledPct: 0 },
  { id: 'cu-secondary', category: 'Metals', name: 'Copper (secondary)', ecoCost: 0.32, co2e: 0.75, water: 30, energyIn: 3.5, recycledPct: 100 },
  { id: 'cu-trademix', category: 'Metals', name: 'Copper wire/plate/pipe trade mix (56% prim / 44% sec)', ecoCost: 5.08, co2e: 2.29, water: 114, energyIn: 12.7, recycledPct: 44 },
  { id: 'ag-primary', category: 'Metals', name: 'Silver (primary)', ecoCost: 624.81, co2e: 150, water: 9000, energyIn: 700, recycledPct: 0 },
  { id: 'pb-primary', category: 'Metals', name: 'Lead (primary)', ecoCost: 2.05, co2e: 1.8, water: 30, energyIn: 6, recycledPct: 0 },
  { id: 'pb-secondary', category: 'Metals', name: 'Lead (secondary)', ecoCost: 0.09, co2e: 0.3, water: 5, energyIn: 1.2, recycledPct: 100 },
  { id: 'pb-trademix', category: 'Metals', name: 'Lead trade mix (25% prim / 75% sec)', ecoCost: 0.58, co2e: 0.68, water: 11.25, energyIn: 2.4, recycledPct: 75 },
  { id: 'ni-primary', category: 'Metals', name: 'Nickel (primary)', ecoCost: 24.83, co2e: 12, water: 250, energyIn: 55, recycledPct: 0 },
  { id: 'ni-secondary', category: 'Metals', name: 'Nickel (secondary)', ecoCost: 0.32, co2e: 1.5, water: 20, energyIn: 4, recycledPct: 100 },
  { id: 'ni-trademix', category: 'Metals', name: 'Nickel trade mix (70% prim / 30% sec)', ecoCost: 17.48, co2e: 8.85, water: 181, energyIn: 39.7, recycledPct: 30 },
  { id: 'mg-primary', category: 'Metals', name: 'Magnesium (primary)', ecoCost: 9.22, co2e: 35, water: 190, energyIn: 95, recycledPct: 0 },
  { id: 'mg-secondary', category: 'Metals', name: 'Magnesium (secondary)', ecoCost: 1.03, co2e: 1.0, water: 15, energyIn: 3, recycledPct: 100 },
  { id: 'mg-trademix', category: 'Metals', name: 'Magnesium trade mix (57% prim / 43% sec)', ecoCost: 5.69, co2e: 20.4, water: 114, energyIn: 55.5, recycledPct: 43 },
  { id: 'mn', category: 'Metals', name: 'Manganese', ecoCost: 1.02, co2e: 2.2, water: 40, energyIn: 8, recycledPct: 0 },
  { id: 'hg-primary', category: 'Metals', name: 'Mercury (primary)', ecoCost: 1642.39, co2e: 6, water: 50, energyIn: 10, recycledPct: 0 },
  { id: 'mo', category: 'Metals', name: 'Molybdenum', ecoCost: 49.08, co2e: 9, water: 120, energyIn: 30, recycledPct: 0 },
  { id: 'li', category: 'Metals', name: 'Lithium', ecoCost: 7.83, co2e: 15, water: 400, energyIn: 40, recycledPct: 0 },

  // --- Plastics, thermoplasts (page 34) ---
  { id: 'pa6', category: 'Plastics (thermoplast)', name: 'PA 6 (Nylon 6, Polyamide)', ecoCost: 2.15, co2e: 7.9, water: 160, energyIn: 27, recycledPct: 0 },
  { id: 'pa6-gf30', category: 'Plastics (thermoplast)', name: 'PA 6 GF30', ecoCost: 1.54, co2e: 5.6, water: 110, energyIn: 20, recycledPct: 0 },
  { id: 'pa66', category: 'Plastics (thermoplast)', name: 'PA 66 (Nylon 66, Polyamide)', ecoCost: 2.01, co2e: 8.5, water: 170, energyIn: 29, recycledPct: 0 },
  { id: 'pa66-gf30', category: 'Plastics (thermoplast)', name: 'PA 66 GF30', ecoCost: 1.44, co2e: 6.0, water: 120, energyIn: 21, recycledPct: 0 },
  { id: 'pb', category: 'Plastics (thermoplast)', name: 'PB (Polybutadiene)', ecoCost: 1.60, co2e: 3.0, water: 80, energyIn: 16, recycledPct: 0 },
  { id: 'pc', category: 'Plastics (thermoplast)', name: 'PC (Polycarbonate)', ecoCost: 2.08, co2e: 6.0, water: 140, energyIn: 25, recycledPct: 0 },
  { id: 'pc-gf30', category: 'Plastics (thermoplast)', name: 'PC 30% glass fibre', ecoCost: 1.49, co2e: 4.3, water: 100, energyIn: 18, recycledPct: 0 },
  { id: 'pe-hdpe', category: 'Plastics (thermoplast)', name: 'PE (HDPE, High density)', ecoCost: 1.14, co2e: 1.9, water: 60, energyIn: 21, recycledPct: 0 },
  { id: 'pe-ldpe', category: 'Plastics (thermoplast)', name: 'PE (LDPE, Low density)', ecoCost: 1.18, co2e: 2.0, water: 65, energyIn: 22, recycledPct: 0 },
  { id: 'pe-lldpe', category: 'Plastics (thermoplast)', name: 'PE (LLDPE, Linear low density)', ecoCost: 1.12, co2e: 1.85, water: 58, energyIn: 20, recycledPct: 0 },

  // --- Plastics, thermosets (page 34) ---
  { id: 'cfrp25', category: 'Plastics (thermoset)', name: 'CFRP 25% carbon', ecoCost: 2.99, co2e: 12, water: 200, energyIn: 90, recycledPct: 0 },
  { id: 'epoxy', category: 'Plastics (thermoset)', name: 'Epoxy resin', ecoCost: 1.32, co2e: 6.0, water: 90, energyIn: 30, recycledPct: 0 },
  { id: 'mf', category: 'Plastics (thermoset)', name: 'MF (resin)', ecoCost: 0.75, co2e: 3.5, water: 70, energyIn: 20, recycledPct: 0 },
  { id: 'pf', category: 'Plastics (thermoset)', name: 'PF (resin)', ecoCost: 0.80, co2e: 3.2, water: 65, energyIn: 18, recycledPct: 0 },
  { id: 'phenolics', category: 'Plastics (thermoset)', name: 'Phenolics (Bakelite)', ecoCost: 1.01, co2e: 3.0, water: 60, energyIn: 17, recycledPct: 0 },
  { id: 'polyester', category: 'Plastics (thermoset)', name: 'Polyester (unsaturated)', ecoCost: 1.15, co2e: 3.8, water: 85, energyIn: 22, recycledPct: 0 },

  // --- Bio-based (page 35) ---
  { id: 'bio-pe', category: 'Bio-based', name: 'bio-PE (Polyethylene, not bio-degradable)', ecoCost: 0.38, co2e: 0.8, water: 250, energyIn: 18, recycledPct: 0 },
  { id: 'ethanol-bio', category: 'Bio-based', name: 'Ethanol (bio)', ecoCost: 0.190, co2e: 0.5, water: 300, energyIn: 9, recycledPct: 0 },

  // --- Battery materials ---
  // Not covered by the Idematapp eco-cost source at all (a niche/specialised
  // category outside its scope), so ecoCost here is scaled from the co2e
  // figure using the same ~0.36 EUR-per-kgCO2e ratio applied to the regional
  // ENERGY/TRANSPORT additions below, for internal consistency rather than a
  // second certified source. co2e/water/energyIn are representative figures
  // compiled from public Li-ion battery LCA literature (cell/pack studies),
  // not a certified source -- see "About the data" in README.md. recycledPct
  // is 0 for all entries: battery-grade material is normally virgin-sourced,
  // and recycled-content claims here aren't something this app can verify.
  { id: 'graphite-anode', category: 'Battery materials', name: 'Graphite (battery anode)', ecoCost: 3.20, co2e: 9.0, water: 50, energyIn: 70, recycledPct: 0 },
  { id: 'nmc-cathode', category: 'Battery materials', name: 'Lithium NMC cathode (Nickel Manganese Cobalt Oxide)', ecoCost: 6.50, co2e: 18.0, water: 150, energyIn: 90, recycledPct: 0 },
  { id: 'lfp-cathode', category: 'Battery materials', name: 'Lithium LFP cathode (Lithium Iron Phosphate)', ecoCost: 2.90, co2e: 8.0, water: 60, energyIn: 45, recycledPct: 0 },
  { id: 'battery-separator', category: 'Battery materials', name: 'Battery separator (PP/PE microporous membrane)', ecoCost: 1.45, co2e: 4.0, water: 40, energyIn: 30, recycledPct: 0 },
  { id: 'battery-electrolyte', category: 'Battery materials', name: 'Battery electrolyte (liquid, LiPF6-based)', ecoCost: 2.15, co2e: 6.0, water: 80, energyIn: 35, recycledPct: 0 },
];

// Processing eco-costs, euro per kg of material processed (pages 34-35).
const PROCESSES = [
  { id: 'extrude-al', name: 'Extruding aluminium', ecoCost: 0.13, co2e: 0.35, water: 5, energyIn: 1.2 },
  { id: 'forge-al', name: 'Forging aluminium', ecoCost: 0.039, co2e: 0.10, water: 2, energyIn: 0.4 },
  { id: 'extrude-plastic-machine', name: 'Plastic extrusion (machine only)', ecoCost: 0.022, co2e: 0.15, water: 1, energyIn: 0.6 },
  { id: 'extrude-plastic-site', name: 'Plastic extrusion (production site)', ecoCost: 0.059, co2e: 0.30, water: 3, energyIn: 1.1 },
];

// Assembly / use-phase energy, euro per MJ (page 34, "Energy, electricity country mix").
// co2e / water / energyIn here are per kWh delivered (not per MJ, unlike the other tables) —
// energyIn is the cumulative primary energy input per kWh of electricity delivered
// (reflects generation and transmission losses, so it is typically > 1).
//
// The first three entries are the original Idematapp-sourced figures. The regional grids
// below them are a SEPARATE, additional estimate: co2e/water/energyIn are representative
// literature grid-carbon-intensity figures (same "indicative, not certified" status as the
// rest of the carbon/water/energy dataset — see the footer disclaimer); ecoCost for these
// has no Idematapp source at all, so it's derived by scaling proportionally to co2e using
// the ratio already implicit in the three original entries (~0.36 EUR per kg CO2e) — an
// estimate on top of an estimate, included for regional coverage rather than precision.
const ENERGY = [
  { id: 'elec-general', name: 'Electricity, general industry', ecoCost: 0.024, co2e: 0.35, water: 1.6, energyIn: 2.2 },
  { id: 'elec-industrial-west', name: 'Electricity, industrial (West Europe)', ecoCost: 0.028, co2e: 0.28, water: 1.4, energyIn: 2.0 },
  { id: 'elec-industrial-use', name: 'Electricity, industrial use', ecoCost: 0.023, co2e: 0.30, water: 1.5, energyIn: 2.1 },
  { id: 'elec-us', name: 'Electricity, grid mix (United States)', ecoCost: 0.040, co2e: 0.40, water: 2.0, energyIn: 2.8 },
  { id: 'elec-canada', name: 'Electricity, grid mix (Canada, hydro-heavy)', ecoCost: 0.013, co2e: 0.13, water: 0.65, energyIn: 0.91 },
  { id: 'elec-brazil', name: 'Electricity, grid mix (Brazil, hydro-heavy)', ecoCost: 0.010, co2e: 0.10, water: 0.50, energyIn: 0.70 },
  { id: 'elec-china', name: 'Electricity, grid mix (China, coal-heavy)', ecoCost: 0.058, co2e: 0.58, water: 2.90, energyIn: 4.06 },
  { id: 'elec-india', name: 'Electricity, grid mix (India, coal-heavy)', ecoCost: 0.075, co2e: 0.75, water: 3.75, energyIn: 5.25 },
  { id: 'elec-australia', name: 'Electricity, grid mix (Australia)', ecoCost: 0.068, co2e: 0.68, water: 3.40, energyIn: 4.76 },
];

// Transport, euro per tonne-km (tkm) unless noted (page 34, "Transport, rail/road").
// The regional/modal entries below "Truck + trailer, 24 tonnes" are the same kind of
// additional, representative-not-certified estimate described above for ENERGY.
const TRANSPORT = [
  { id: 'rail-eu', name: 'Train, freight (Europe)', ecoCost: 0.0053, co2e: 0.028, water: 0.05, energyIn: 0.15 },
  { id: 'rail-us', name: 'Train, freight, diesel (USA)', ecoCost: 0.0130, co2e: 0.021, water: 0.03, energyIn: 0.09 },
  { id: 'truck-container-28t', name: 'Truck + container, 28 tonnes', ecoCost: 0.027, co2e: 0.085, water: 0.08, energyIn: 0.35 },
  { id: 'truck-trailer-24t', name: 'Truck + trailer, 24 tonnes', ecoCost: 0.031, co2e: 0.095, water: 0.09, energyIn: 0.40 },
  { id: 'ocean-container', name: 'Ocean freight, container ship', ecoCost: 0.0043, co2e: 0.012, water: 0.02, energyIn: 0.05 },
  { id: 'air-cargo', name: 'Air freight, cargo aircraft', ecoCost: 0.22, co2e: 0.60, water: 1.20, energyIn: 2.50 },
  { id: 'truck-north-america', name: 'Truck freight (North America)', ecoCost: 0.032, co2e: 0.090, water: 0.085, energyIn: 0.37 },
  { id: 'truck-asia-pacific', name: 'Truck freight (Asia-Pacific)', ecoCost: 0.043, co2e: 0.120, water: 0.11, energyIn: 0.48 },
];

// End-of-life treatment, euro per kg of material discarded ("waste treatment").
// Negative values are a net CREDIT (the treatment avoids more eco-burden than it causes —
// see the Cradle-to-Cradle recycling/incineration/composting credit model).
const END_OF_LIFE = [
  { id: 'none', name: 'None modelled', ecoCost: 0, co2e: 0, water: 0, energyIn: 0 },
  { id: 'landfill-inert', name: 'Landfill (inert waste)', ecoCost: 0.116, co2e: 0.01, water: 0.01, energyIn: 0.02 },
  { id: 'incin-abs', name: 'Incineration: ABS', ecoCost: 0.15, co2e: 3.4, water: 0.02, energyIn: 0.05 },
  { id: 'incin-bio-pe', name: 'Incineration: bio-PE (credit)', ecoCost: -0.25, co2e: -0.6, water: -0.05, energyIn: -0.1 },
  { id: 'incin-bio-pet', name: 'Incineration: bio-PET', ecoCost: 0.08, co2e: 2.0, water: 0.02, energyIn: 0.04 },
  { id: 'incin-ca', name: 'Incineration: CA / cellulose polymers (credit)', ecoCost: -0.11, co2e: -0.5, water: -0.03, energyIn: -0.08 },
  { id: 'incin-ionomer', name: 'Incineration: Ionomer', ecoCost: 0.11, co2e: 2.6, water: 0.02, energyIn: 0.05 },
  { id: 'incin-pa11', name: 'Incineration: PA-11 / Nylon-11 (credit)', ecoCost: -0.20, co2e: -0.9, water: -0.05, energyIn: -0.12 },
  { id: 'incin-pa', name: 'Incineration: PA / Nylons, Polyamides', ecoCost: 0.11, co2e: 2.8, water: 0.02, energyIn: 0.05 },
  { id: 'incin-pc', name: 'Incineration: PC / Polycarbonate', ecoCost: 0.15, co2e: 3.0, water: 0.02, energyIn: 0.05 },
  { id: 'incin-pe', name: 'Incineration: PE / Polyethylene', ecoCost: 0.11, co2e: 2.9, water: 0.02, energyIn: 0.05 },
  { id: 'recycle-al-closed', name: 'Recycling, closed loop: Aluminium (credit)', ecoCost: -1.49, co2e: -8.5, water: -900, energyIn: -35 },
  { id: 'recycle-cu-closed', name: 'Recycling, closed loop: Copper (credit)', ecoCost: -4.76, co2e: -2.8, water: -140, energyIn: -15 },
];

// Two fully worked examples, used both as quick-start presets and as an automated
// correctness check: their known totals are 22.54 (pen) and 7.90 / 2.80 / 1.95
// (pencil body base case / case 1 / case 2). These reference totals are eco-cost
// only — the carbon/water/energy/recycled figures are not separately validated.
const PRESET_EXAMPLES = {
  // NOTE on fidelity: the source's road/rail transport sub-totals (0.29 and 0.06) sit next
  // to quantities (0.33 and 0.4) that do NOT reduce to those totals under the tonne-km
  // formula this calculator uses elsewhere (0.33 tkm x the listed 0.031 EUR/tkm rate is
  // ~0.01, not 0.29 - off by ~30x, and the source's own database-line reference for that
  // row, "C.010.06.104", doesn't match any line in its own listed table). Rather than invent
  // a conversion that fits, the two transport lines below are entered as fixed custom
  // eco-costs taken directly from the source's printed total - see the 'custom' line type.
  feltTipPen: {
    name: 'Felt-tip pen (materials only) — per 1000 pens',
    expectedTotal: 22.54,
    parts: [
      { name: 'Cap', materialId: 'pe-hdpe', weight: 2 },
      { name: 'Support for felt', materialId: 'pe-hdpe', weight: 2 },
      { name: 'Felt', materialId: 'pa66', weight: 1 },
      { name: 'Ink cartridge', materialId: 'polyester', weight: 4 },
      { name: 'Body', materialId: 'al-trademix', weight: 4 },
      { name: 'Ink', materialId: 'ethanol-bio', weight: 15 },
    ],
    assembly: { energyId: 'elec-industrial-west', mjPerKg: 1 },
    customLines: [
      { name: 'Transport, road', ecoCost: 0.29 },
      { name: 'Transport, rail', ecoCost: 0.06 },
    ],
  },
  pencilBodyBase: {
    name: 'Pencil body — base case (Aluminium, landfill)',
    expectedTotal: 7.90,
    parts: [{ name: 'Body', materialId: 'al-trademix', weight: 4, processId: 'extrude-al', endOfLifeId: 'none' }],
  },
  pencilBodyCase1: {
    name: 'Pencil body — case 1 (bio-PE, incineration credit)',
    expectedTotal: 2.80,
    parts: [{ name: 'Body', materialId: 'bio-pe', weight: 15, processId: 'extrude-plastic-site', endOfLifeId: 'incin-bio-pe' }],
  },
  pencilBodyCase2: {
    name: 'Pencil body — case 2 (Aluminium, closed-loop recycling)',
    expectedTotal: 1.95,
    parts: [{ name: 'Body', materialId: 'al-trademix', weight: 4, processId: 'extrude-al', endOfLifeId: 'recycle-al-closed' }],
  },
};

// Dual-purpose: a plain <script> tag in the browser (module is undefined there,
// so this is a no-op), or `require('./public/data.js')` from server.js — lets
// the AI-extraction endpoint reuse the exact same material/process/EoL names
// instead of duplicating this list server-side and risking it drifting out of sync.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COUNTRIES, MATERIALS, PROCESSES, ENERGY, TRANSPORT, END_OF_LIFE, PRESET_EXAMPLES };
}
