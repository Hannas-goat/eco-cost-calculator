// Eco-cost reference data, based on Idematapp/ecocostsvalue.com reference data
// (2020 excerpts). Covers common materials, processes, energy, and transport modes —
// use "Custom material / process" for anything not listed here. Eco-costs are in
// euro per kg unless noted otherwise.

const MATERIALS = [
  // --- Metals (page 33: Simapro/Idematapp2020 background-process output) ---
  { id: 'al-primary', category: 'Metals', name: 'Aluminium (primary)', ecoCost: 2.61 },
  { id: 'al-secondary', category: 'Metals', name: 'Aluminium (secondary)', ecoCost: 0.36 },
  { id: 'al-trademix', category: 'Metals', name: 'Aluminium trade mix (66% prim / 33% sec)', ecoCost: 1.84 },
  { id: 'cu-primary', category: 'Metals', name: 'Copper (primary)', ecoCost: 8.82 },
  { id: 'cu-secondary', category: 'Metals', name: 'Copper (secondary)', ecoCost: 0.32 },
  { id: 'cu-trademix', category: 'Metals', name: 'Copper wire/plate/pipe trade mix (56% prim / 44% sec)', ecoCost: 5.08 },
  { id: 'ag-primary', category: 'Metals', name: 'Silver (primary)', ecoCost: 624.81 },
  { id: 'pb-primary', category: 'Metals', name: 'Lead (primary)', ecoCost: 2.05 },
  { id: 'pb-secondary', category: 'Metals', name: 'Lead (secondary)', ecoCost: 0.09 },
  { id: 'pb-trademix', category: 'Metals', name: 'Lead trade mix (25% prim / 75% sec)', ecoCost: 0.58 },
  { id: 'ni-primary', category: 'Metals', name: 'Nickel (primary)', ecoCost: 24.83 },
  { id: 'ni-secondary', category: 'Metals', name: 'Nickel (secondary)', ecoCost: 0.32 },
  { id: 'ni-trademix', category: 'Metals', name: 'Nickel trade mix (70% prim / 30% sec)', ecoCost: 17.48 },
  { id: 'mg-primary', category: 'Metals', name: 'Magnesium (primary)', ecoCost: 9.22 },
  { id: 'mg-secondary', category: 'Metals', name: 'Magnesium (secondary)', ecoCost: 1.03 },
  { id: 'mg-trademix', category: 'Metals', name: 'Magnesium trade mix (57% prim / 43% sec)', ecoCost: 5.69 },
  { id: 'mn', category: 'Metals', name: 'Manganese', ecoCost: 1.02 },
  { id: 'hg-primary', category: 'Metals', name: 'Mercury (primary)', ecoCost: 1642.39 },
  { id: 'mo', category: 'Metals', name: 'Molybdenum', ecoCost: 49.08 },
  { id: 'li', category: 'Metals', name: 'Lithium', ecoCost: 7.83 },

  // --- Plastics, thermoplasts (page 34) ---
  { id: 'pa6', category: 'Plastics (thermoplast)', name: 'PA 6 (Nylon 6, Polyamide)', ecoCost: 2.15 },
  { id: 'pa6-gf30', category: 'Plastics (thermoplast)', name: 'PA 6 GF30', ecoCost: 1.54 },
  { id: 'pa66', category: 'Plastics (thermoplast)', name: 'PA 66 (Nylon 66, Polyamide)', ecoCost: 2.01 },
  { id: 'pa66-gf30', category: 'Plastics (thermoplast)', name: 'PA 66 GF30', ecoCost: 1.44 },
  { id: 'pb', category: 'Plastics (thermoplast)', name: 'PB (Polybutadiene)', ecoCost: 1.60 },
  { id: 'pc', category: 'Plastics (thermoplast)', name: 'PC (Polycarbonate)', ecoCost: 2.08 },
  { id: 'pc-gf30', category: 'Plastics (thermoplast)', name: 'PC 30% glass fibre', ecoCost: 1.49 },
  { id: 'pe-hdpe', category: 'Plastics (thermoplast)', name: 'PE (HDPE, High density)', ecoCost: 1.14 },
  { id: 'pe-ldpe', category: 'Plastics (thermoplast)', name: 'PE (LDPE, Low density)', ecoCost: 1.18 },
  { id: 'pe-lldpe', category: 'Plastics (thermoplast)', name: 'PE (LLDPE, Linear low density)', ecoCost: 1.12 },

  // --- Plastics, thermosets (page 34) ---
  { id: 'cfrp25', category: 'Plastics (thermoset)', name: 'CFRP 25% carbon', ecoCost: 2.99 },
  { id: 'epoxy', category: 'Plastics (thermoset)', name: 'Epoxy resin', ecoCost: 1.32 },
  { id: 'mf', category: 'Plastics (thermoset)', name: 'MF (resin)', ecoCost: 0.75 },
  { id: 'pf', category: 'Plastics (thermoset)', name: 'PF (resin)', ecoCost: 0.80 },
  { id: 'phenolics', category: 'Plastics (thermoset)', name: 'Phenolics (Bakelite)', ecoCost: 1.01 },
  { id: 'polyester', category: 'Plastics (thermoset)', name: 'Polyester (unsaturated)', ecoCost: 1.15 },

  // --- Bio-based (page 35) ---
  { id: 'bio-pe', category: 'Bio-based', name: 'bio-PE (Polyethylene, not bio-degradable)', ecoCost: 0.38 },
  { id: 'ethanol-bio', category: 'Bio-based', name: 'Ethanol (bio)', ecoCost: 0.190 },
];

// Processing eco-costs, euro per kg of material processed (pages 34-35).
const PROCESSES = [
  { id: 'extrude-al', name: 'Extruding aluminium', ecoCost: 0.13 },
  { id: 'forge-al', name: 'Forging aluminium', ecoCost: 0.039 },
  { id: 'extrude-plastic-machine', name: 'Plastic extrusion (machine only)', ecoCost: 0.022 },
  { id: 'extrude-plastic-site', name: 'Plastic extrusion (production site)', ecoCost: 0.059 },
];

// Assembly / use-phase energy, euro per MJ (page 34, "Energy, electricity country mix").
const ENERGY = [
  { id: 'elec-general', name: 'Electricity, general industry', ecoCost: 0.024 },
  { id: 'elec-industrial-west', name: 'Electricity, industrial (West Europe)', ecoCost: 0.028 },
  { id: 'elec-industrial-use', name: 'Electricity, industrial use', ecoCost: 0.023 },
];

// Transport, euro per tonne-km (tkm) unless noted (page 34, "Transport, rail/road").
const TRANSPORT = [
  { id: 'rail-eu', name: 'Train, freight (Europe)', ecoCost: 0.0053 },
  { id: 'rail-us', name: 'Train, freight, diesel (USA)', ecoCost: 0.0130 },
  { id: 'truck-container-28t', name: 'Truck + container, 28 tonnes', ecoCost: 0.027 },
  { id: 'truck-trailer-24t', name: 'Truck + trailer, 24 tonnes', ecoCost: 0.031 },
];

// End-of-life treatment, euro per kg of material discarded ("waste treatment").
// Negative values are a net CREDIT (the treatment avoids more eco-burden than it causes —
// see the Cradle-to-Cradle recycling/incineration/composting credit model).
const END_OF_LIFE = [
  { id: 'none', name: 'None modelled', ecoCost: 0 },
  { id: 'landfill-inert', name: 'Landfill (inert waste)', ecoCost: 0.116 },
  { id: 'incin-abs', name: 'Incineration: ABS', ecoCost: 0.15 },
  { id: 'incin-bio-pe', name: 'Incineration: bio-PE (credit)', ecoCost: -0.25 },
  { id: 'incin-bio-pet', name: 'Incineration: bio-PET', ecoCost: 0.08 },
  { id: 'incin-ca', name: 'Incineration: CA / cellulose polymers (credit)', ecoCost: -0.11 },
  { id: 'incin-ionomer', name: 'Incineration: Ionomer', ecoCost: 0.11 },
  { id: 'incin-pa11', name: 'Incineration: PA-11 / Nylon-11 (credit)', ecoCost: -0.20 },
  { id: 'incin-pa', name: 'Incineration: PA / Nylons, Polyamides', ecoCost: 0.11 },
  { id: 'incin-pc', name: 'Incineration: PC / Polycarbonate', ecoCost: 0.15 },
  { id: 'incin-pe', name: 'Incineration: PE / Polyethylene', ecoCost: 0.11 },
  { id: 'recycle-al-closed', name: 'Recycling, closed loop: Aluminium (credit)', ecoCost: -1.49 },
  { id: 'recycle-cu-closed', name: 'Recycling, closed loop: Copper (credit)', ecoCost: -4.76 },
];

// Two fully worked examples, used both as quick-start presets and as an automated
// correctness check: their known totals are 22.54 (pen) and 7.90 / 2.80 / 1.95
// (pencil body base case / case 1 / case 2).
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
