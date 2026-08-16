// --- App state ---
// One unified product drives every tab. Add a part once on Home and eco-cost,
// carbon, water, energy, and recycled content all compute from it — Carbon /
// Water / Energy / Recycled tabs are read-only breakdown views of this same
// product, not separate data-entry tools.
let product = { parts: [], assembly: null, transportLegs: [], customLines: [] };
let nextLineId = 1;
let activePresetKey = null; // set when a preset is loaded, so we can show the validation check

const SCENARIOS_KEY = 'ecocost_scenarios';

const METRICS = {
  ecoCost: { label: 'Eco-cost', unit: '€', digits: 2, prefix: true },
  co2e: { label: 'Carbon footprint', unit: 'kg CO2e', digits: 2, prefix: false },
  water: { label: 'Water consumption', unit: 'L', digits: 1, prefix: false },
  energyIn: { label: 'Energy used in production', unit: 'kWh', digits: 2, prefix: false },
};

function fmt(n, digits = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtMetric(n, key) {
  const cfg = METRICS[key];
  return cfg.prefix ? `€${fmt(n, cfg.digits)}` : `${fmt(n, cfg.digits)} ${cfg.unit}`;
}

function findById(list, id) { return list.find(x => x.id === id); }

// --- Tabs ---
const TABS = ['home', 'carbon', 'water', 'energy', 'recycled', 'sensitivity'];

function showTab(name) {
  for (const id of TABS) {
    document.getElementById(`tab-${id}`).style.display = id === name ? '' : 'none';
    document.getElementById(`tabbtn-${id}`).classList.toggle('active', id === name);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Dropdown population ---
function initDropdowns() {
  const categories = [...new Set(MATERIALS.map(m => m.category))];
  document.getElementById('part-category').innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
  renderMaterialOptions();

  const processSelect = document.getElementById('part-process');
  processSelect.innerHTML = '<option value="">No processing</option>' +
    PROCESSES.map(p => `<option value="${p.id}">${p.name} (€${p.ecoCost}/kg)</option>`).join('');

  const eolSelect = document.getElementById('part-eol');
  eolSelect.innerHTML = END_OF_LIFE.map(e => `<option value="${e.id}">${e.name}${e.ecoCost ? ` (€${e.ecoCost}/kg)` : ''}</option>`).join('');

  const energySelect = document.getElementById('assembly-energy');
  energySelect.innerHTML = ENERGY.map(e => `<option value="${e.id}">${e.name} (€${e.ecoCost}/MJ)</option>`).join('');

  const transportSelect = document.getElementById('transport-mode');
  transportSelect.innerHTML = TRANSPORT.map(t => `<option value="${t.id}">${t.name} (€${t.ecoCost}/tkm)</option>`).join('');
  document.getElementById('transport-distance').addEventListener('input', updateTransportPreview);
  transportSelect.addEventListener('change', updateTransportPreview);
  updateTransportPreview();
}

// Searchable material combobox: a text input + <datalist>, scoped to the chosen
// category, so users can type "Alu..." instead of scanning a long dropdown.
function renderMaterialOptions() {
  const category = document.getElementById('part-category').value;
  const inCategory = MATERIALS.filter(m => m.category === category);
  document.getElementById('material-datalist').innerHTML =
    inCategory.map(m => `<option value="${m.name}">`).join('');
  document.getElementById('part-material').value = '';
}

// --- Adding line items ---
function addPart() {
  const name = document.getElementById('part-name').value.trim();
  const materialName = document.getElementById('part-material').value.trim();
  const material = MATERIALS.find(m => m.name === materialName);
  const weight = Number(document.getElementById('part-weight').value);
  const processId = document.getElementById('part-process').value || null;
  const endOfLifeId = document.getElementById('part-eol').value || 'none';
  if (!name || !material || !weight || weight <= 0) {
    alert('Give the part a name, pick a material from the list (type to search), and a positive weight.');
    return;
  }
  product.parts.push({ id: nextLineId++, name, materialId: material.id, weight, processId, endOfLifeId });
  document.getElementById('part-form').reset();
  renderMaterialOptions();
  activePresetKey = null;
  renderAll();
}

function setAssembly() {
  const energyId = document.getElementById('assembly-energy').value;
  const mjPerKg = Number(document.getElementById('assembly-mj-per-kg').value);
  if (!mjPerKg || mjPerKg <= 0) {
    product.assembly = null;
  } else {
    product.assembly = { energyId, mjPerKg };
  }
  activePresetKey = null;
  renderAll();
}

function updateTransportPreview() {
  const weight = totalPartsWeight();
  const distance = Number(document.getElementById('transport-distance').value) || 0;
  const tkm = (weight / 1000) * distance;
  document.getElementById('transport-tkm-preview').textContent =
    weight > 0 && distance > 0 ? `= ${tkm.toFixed(4)} tonne-km (product weight ${weight} kg × ${distance} km)` : '';
}

function addTransport() {
  const transportId = document.getElementById('transport-mode').value;
  const distanceKm = Number(document.getElementById('transport-distance').value);
  const weight = totalPartsWeight();
  if (!distanceKm || distanceKm <= 0) {
    alert('Enter a distance in km — transport eco-cost is calculated from the product weight and this distance.');
    return;
  }
  if (weight <= 0) {
    alert('Add at least one part first, so transport has a weight to move.');
    return;
  }
  const tkm = (weight / 1000) * distanceKm;
  product.transportLegs.push({ id: nextLineId++, transportId, distanceKm, tkm });
  document.getElementById('transport-distance').value = '';
  updateTransportPreview();
  activePresetKey = null;
  renderAll();
}

function addCustomLine() {
  const name = document.getElementById('custom-name').value.trim();
  const ecoCost = Number(document.getElementById('custom-value').value) || 0;
  const co2e = Number(document.getElementById('custom-co2e').value) || 0;
  const water = Number(document.getElementById('custom-water').value) || 0;
  const energyIn = Number(document.getElementById('custom-energy').value) || 0;
  if (!name || (!ecoCost && !co2e && !water && !energyIn)) {
    alert('Give the custom line a description and at least one value.');
    return;
  }
  product.customLines.push({ id: nextLineId++, name, ecoCost, co2e, water, energyIn });
  document.getElementById('custom-name').value = '';
  document.getElementById('custom-value').value = '';
  document.getElementById('custom-co2e').value = '';
  document.getElementById('custom-water').value = '';
  document.getElementById('custom-energy').value = '';
  activePresetKey = null;
  renderAll();
}

function removeLine(kind, id) {
  if (kind === 'part') product.parts = product.parts.filter(p => p.id !== id);
  if (kind === 'transport') product.transportLegs = product.transportLegs.filter(t => t.id !== id);
  if (kind === 'custom') product.customLines = product.customLines.filter(c => c.id !== id);
  activePresetKey = null;
  renderAll();
}

function removeAssembly() {
  product.assembly = null;
  activePresetKey = null;
  renderAll();
}

function totalPartsWeight(p = product) {
  return p.parts.reduce((sum, x) => sum + x.weight, 0);
}

function clearProduct() {
  product = { parts: [], assembly: null, transportLegs: [], customLines: [] };
  activePresetKey = null;
  renderAll();
}

// Rate text for one metric, e.g. "€2.61/kg" or "11.9 kg CO2e/kg" — every line
// item's detail text is built once per metric so each tab describes ITS OWN
// rate, not always the eco-cost one.
function fmtRate(value, metricKey, basis) {
  const cfg = METRICS[metricKey];
  return cfg.prefix ? `€${value}/${basis}` : `${value} ${cfg.unit}/${basis}`;
}

function partDetails(part, material, process, eol) {
  const details = {};
  for (const metricKey of Object.keys(METRICS)) {
    const bits = [`${part.weight} kg × ${material.name} (${fmtRate(material[metricKey], metricKey, 'kg')})`];
    if (process) bits.push(`+ ${process.name} (${fmtRate(process[metricKey], metricKey, 'kg')})`);
    if (eol && eol[metricKey] !== 0) bits.push(`+ ${eol.name} (${fmtRate(eol[metricKey], metricKey, 'kg')})`);
    details[metricKey] = bits.join(' ');
  }
  return details;
}

function assemblyDetails(assembly, energy, mj, kwh, weight) {
  const details = {};
  details.ecoCost = `${assembly.mjPerKg} MJ/kg × ${weight} kg = ${mj.toFixed(3)} MJ × ${energy.name} (${fmtRate(energy.ecoCost, 'ecoCost', 'MJ')})`;
  for (const metricKey of ['co2e', 'water', 'energyIn']) {
    details[metricKey] = `${assembly.mjPerKg} MJ/kg × ${weight} kg = ${kwh.toFixed(3)} kWh × ${energy.name} (${fmtRate(energy[metricKey], metricKey, 'kWh')})`;
  }
  return details;
}

function transportDetails(leg, transport) {
  const details = {};
  for (const metricKey of Object.keys(METRICS)) {
    details[metricKey] = `${leg.tkm.toFixed(4)} tkm × ${fmtRate(transport[metricKey], metricKey, 'tkm')} (${leg.distanceKm} km)`;
  }
  return details;
}

// --- Calculation: every part/assembly/transport/custom line carries all four
// indicators at once, computed in a single pass. ---
function computeLineItems(p = product) {
  const items = [];

  for (const part of p.parts) {
    const material = findById(MATERIALS, part.materialId);
    const process = part.processId ? findById(PROCESSES, part.processId) : null;
    const eol = part.endOfLifeId ? findById(END_OF_LIFE, part.endOfLifeId) : null;
    const sumField = (key) =>
      part.weight * material[key] + (process ? part.weight * process[key] : 0) + (eol ? part.weight * eol[key] : 0);
    items.push({
      label: part.name,
      details: partDetails(part, material, process, eol),
      kind: 'part',
      ecoCost: sumField('ecoCost'),
      co2e: sumField('co2e'),
      water: sumField('water'),
      energyIn: sumField('energyIn'),
    });
  }

  if (p.assembly) {
    const energy = findById(ENERGY, p.assembly.energyId);
    const weight = totalPartsWeight(p);
    const mj = p.assembly.mjPerKg * weight;
    const kwh = mj / 3.6;
    items.push({
      label: 'Assembly energy',
      details: assemblyDetails(p.assembly, energy, mj, kwh, weight),
      kind: 'assembly',
      ecoCost: mj * energy.ecoCost,
      co2e: kwh * energy.co2e,
      water: kwh * energy.water,
      energyIn: kwh * energy.energyIn,
    });
  }

  for (const leg of p.transportLegs) {
    const transport = findById(TRANSPORT, leg.transportId);
    items.push({
      label: `Transport: ${transport.name}`,
      details: transportDetails(leg, transport),
      kind: 'transport',
      ecoCost: leg.tkm * transport.ecoCost,
      co2e: leg.tkm * transport.co2e,
      water: leg.tkm * transport.water,
      energyIn: leg.tkm * transport.energyIn,
    });
  }

  for (const custom of p.customLines) {
    items.push({
      label: custom.name,
      details: { ecoCost: 'Custom line', co2e: 'Custom line', water: 'Custom line', energyIn: 'Custom line' },
      kind: 'custom',
      ecoCost: custom.ecoCost || 0,
      co2e: custom.co2e || 0,
      water: custom.water || 0,
      energyIn: custom.energyIn || 0,
    });
  }

  return items;
}

function totalsFor(items) {
  return {
    ecoCost: items.reduce((s, i) => s + i.ecoCost, 0),
    co2e: items.reduce((s, i) => s + i.co2e, 0),
    water: items.reduce((s, i) => s + i.water, 0),
    energyIn: items.reduce((s, i) => s + i.energyIn, 0),
  };
}

function computeRecycledPct(p = product) {
  let totalWeight = 0;
  let recycledWeight = 0;
  for (const part of p.parts) {
    const material = findById(MATERIALS, part.materialId);
    totalWeight += part.weight;
    recycledWeight += part.weight * (material.recycledPct / 100);
  }
  return totalWeight > 0 ? (recycledWeight / totalWeight) * 100 : 0;
}

// --- Rendering: builder (Home only) ---
function lineItemRow(kind, id, label, detail) {
  return `<div class="line-item">
    <span class="line-item-label">${label}</span>
    <span class="line-item-detail">${detail}</span>
    <button type="button" class="btn-remove" onclick="removeLine('${kind}', ${id})">✕</button>
  </div>`;
}

function renderParts() {
  const el = document.getElementById('parts-list');
  el.innerHTML = product.parts.length
    ? product.parts.map(p => {
        const material = findById(MATERIALS, p.materialId);
        return lineItemRow('part', p.id, p.name, `${p.weight} kg · ${material.name}`);
      }).join('')
    : '<p class="hint">No parts yet.</p>';
}

function renderAssembly() {
  const el = document.getElementById('assembly-line');
  if (!product.assembly) { el.innerHTML = '<p class="hint">No assembly energy set.</p>'; return; }
  const energy = findById(ENERGY, product.assembly.energyId);
  el.innerHTML = `<div class="line-item">
    <span class="line-item-label">Assembly</span>
    <span class="line-item-detail">${product.assembly.mjPerKg} MJ/kg · ${energy.name}</span>
    <button type="button" class="btn-remove" onclick="removeAssembly()">✕</button>
  </div>`;
}

function renderTransport() {
  const el = document.getElementById('transport-list');
  el.innerHTML = product.transportLegs.length
    ? product.transportLegs.map(t => {
        const transport = findById(TRANSPORT, t.transportId);
        return lineItemRow('transport', t.id, transport.name, `${t.distanceKm} km (${t.tkm.toFixed(4)} tkm)`);
      }).join('')
    : '<p class="hint">No transport legs yet.</p>';
}

function renderCustom() {
  const el = document.getElementById('custom-list');
  el.innerHTML = product.customLines.length
    ? product.customLines.map(c => lineItemRow('custom', c.id, c.name,
        `€${fmt(c.ecoCost)} · ${fmt(c.co2e)} kg CO2e · ${fmt(c.water, 1)} L · ${fmt(c.energyIn)} kWh`)).join('')
    : '<p class="hint">No custom lines yet.</p>';
}

// --- Shared breakdown table + hotspot chart renderer, reused by every metric tab ---
function renderBreakdown(items, metricKey, ids) {
  const empty = document.getElementById(ids.empty);
  const body = document.getElementById(ids.body);
  if (!items.length) {
    empty.style.display = '';
    body.style.display = 'none';
    return null;
  }
  empty.style.display = 'none';
  body.style.display = '';

  const total = items.reduce((sum, i) => sum + i[metricKey], 0);
  const maxAbs = Math.max(...items.map(i => Math.abs(i[metricKey])), 0.0001);
  const sorted = [...items].sort((a, b) => Math.abs(b[metricKey]) - Math.abs(a[metricKey]));
  const hotspotLabel = sorted.find(i => i[metricKey] > 0)?.label;

  document.getElementById(ids.tbody).innerHTML = items.map(i => `
    <tr class="${i.label === hotspotLabel ? 'row-hotspot' : ''}">
      <td>${i.label}${i.label === hotspotLabel ? ' <span class="hotspot-badge">🔥 hotspot</span>' : ''}</td>
      <td class="detail-cell">${i.details[metricKey]}</td>
      <td class="num">${fmtMetric(i[metricKey], metricKey)}</td>
    </tr>`).join('');
  document.getElementById(ids.total).textContent = fmtMetric(total, metricKey);

  document.getElementById(ids.chart).innerHTML = sorted.map(i => {
    const pct = (Math.abs(i[metricKey]) / maxAbs) * 100;
    const barClass = i[metricKey] < 0 ? 'bar-credit' : 'bar-burden';
    return `<div class="chart-row">
      <span class="chart-label">${i.label}</span>
      <div class="chart-track"><div class="chart-bar ${barClass}" style="width:${pct}%"></div></div>
      <span class="chart-value">${fmtMetric(i[metricKey], metricKey)}</span>
    </div>`;
  }).join('');

  return total;
}

const ECO_IDS = { empty: 'results-empty', body: 'results-body', tbody: 'results-tbody', total: 'results-total', chart: 'hotspot-chart' };
const CARBON_IDS = { empty: 'carbon-empty', body: 'carbon-body', tbody: 'carbon-tbody', total: 'carbon-total', chart: 'carbon-chart' };
const WATER_IDS = { empty: 'water-empty', body: 'water-body', tbody: 'water-tbody', total: 'water-total', chart: 'water-chart' };
const ENERGY_IDS = { empty: 'energy-empty', body: 'energy-body', tbody: 'energy-tbody', total: 'energy-total', chart: 'energy-chart' };

function renderPresetCheck(total) {
  const el = document.getElementById('preset-check');
  if (!activePresetKey || total === null) { el.style.display = 'none'; return; }
  const preset = PRESET_EXAMPLES[activePresetKey];
  const diff = Math.abs(total - preset.expectedTotal);
  const withinTolerance = diff <= 0.10;
  el.style.display = '';
  el.className = 'preset-check ' + (withinTolerance ? 'preset-check-ok' : 'preset-check-fail');
  el.innerHTML = `${withinTolerance ? '✓' : '⚠'} Reference total for "${preset.name}": €${fmt(preset.expectedTotal)}.
    This calculator computed €${fmt(total)} (difference €${fmt(diff)}, from source figures pre-rounded to 2 decimals).`;
}

// --- Best case / worst case: holding materials, transport, and end-of-life fixed,
// how much does the total move if assembly energy alone used the cleanest vs.
// dirtiest available source? Grounded in the app's own reference data. ---
const RANGE_IDS = {
  co2e: { wrap: 'carbon-range-wrap', bestLabel: 'carbon-range-best-label', worstLabel: 'carbon-range-worst-label', marker: 'carbon-range-marker', your: 'carbon-range-your', na: 'carbon-range-na' },
  water: { wrap: 'water-range-wrap', bestLabel: 'water-range-best-label', worstLabel: 'water-range-worst-label', marker: 'water-range-marker', your: 'water-range-your', na: 'water-range-na' },
  energyIn: { wrap: 'energy-range-wrap', bestLabel: 'energy-range-best-label', worstLabel: 'energy-range-worst-label', marker: 'energy-range-marker', your: 'energy-range-your', na: 'energy-range-na' },
};

function renderRangeMeter(metricKey, items, total) {
  const ids = RANGE_IDS[metricKey];
  if (total === null || !product.assembly) {
    document.getElementById(ids.wrap).style.display = 'none';
    document.getElementById(ids.na).style.display = total === null ? 'none' : '';
    return;
  }
  document.getElementById(ids.na).style.display = 'none';
  document.getElementById(ids.wrap).style.display = '';

  const nonAssemblyTotal = items.filter(i => i.kind !== 'assembly').reduce((s, i) => s + i[metricKey], 0);
  const mj = product.assembly.mjPerKg * totalPartsWeight();
  const kwh = mj / 3.6;
  const factors = ENERGY.map(e => e[metricKey]);
  const bestSource = ENERGY.find(e => e[metricKey] === Math.min(...factors));
  const worstSource = ENERGY.find(e => e[metricKey] === Math.max(...factors));
  const best = nonAssemblyTotal + kwh * bestSource[metricKey];
  const worst = nonAssemblyTotal + kwh * worstSource[metricKey];

  document.getElementById(ids.bestLabel).textContent = `Best case: ${fmtMetric(best, metricKey)} (${bestSource.name})`;
  document.getElementById(ids.worstLabel).textContent = `Worst case: ${fmtMetric(worst, metricKey)} (${worstSource.name})`;
  document.getElementById(ids.your).textContent = fmtMetric(total, metricKey);
  const span = worst - best;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((total - best) / span) * 100)) : 0;
  document.getElementById(ids.marker).style.left = `${pct}%`;
}

// --- Recycled content: derived view of Home's parts (no separate entry form) ---
function renderRecycledTab() {
  const empty = document.getElementById('recycled-empty');
  const body = document.getElementById('recycled-body');
  if (!product.parts.length) {
    empty.style.display = '';
    body.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  body.style.display = '';

  document.getElementById('recycled-tbody').innerHTML = product.parts.map(p => {
    const material = findById(MATERIALS, p.materialId);
    return `<tr>
      <td>${p.name}</td>
      <td class="detail-cell">${material.name}</td>
      <td class="num">${fmt(p.weight)} kg</td>
      <td class="num">${fmt(material.recycledPct, 0)}%</td>
    </tr>`;
  }).join('');

  const pct = computeRecycledPct();
  document.getElementById('recycled-total').textContent = `${fmt(pct, 1)}%`;
  document.getElementById('recycled-meter').style.setProperty('--meter-pct', pct.toFixed(1));

  // Group by base material name (e.g. "Aluminium" from "Aluminium (primary)" /
  // "Aluminium trade mix (...)") rather than the broader category — category alone
  // would wrongly suggest e.g. Copper as an "alternative" to Aluminium.
  const materialBaseName = (name) => name.split(' ')[0];
  const seenBaseNames = new Set();
  const hints = [];
  for (const p of product.parts) {
    const material = findById(MATERIALS, p.materialId);
    const baseName = materialBaseName(material.name);
    if (seenBaseNames.has(baseName)) continue;
    seenBaseNames.add(baseName);
    const alternatives = MATERIALS
      .filter(m => materialBaseName(m.name) === baseName && m.recycledPct > material.recycledPct)
      .sort((a, b) => b.recycledPct - a.recycledPct);
    if (alternatives.length) {
      hints.push(`<li><strong>${material.name}</strong> (${material.recycledPct}%) → ${alternatives.map(a => `${a.name} (${a.recycledPct}%)`).join(', ')}</li>`);
    }
  }
  document.getElementById('recycled-hints').innerHTML = hints.length
    ? `<strong>Higher-recycled alternatives available in your reference data:</strong><ul>${hints.join('')}</ul>`
    : '<strong>No higher-recycled alternative found</strong> in the reference data for the materials in this product.';

  document.getElementById('recycled-chart').innerHTML = product.parts.map(p => {
    const material = findById(MATERIALS, p.materialId);
    return `<div class="chart-row">
      <span class="chart-label">${p.name}</span>
      <div class="chart-track"><div class="chart-bar bar-credit" style="width:${material.recycledPct}%"></div></div>
      <span class="chart-value">${fmt(material.recycledPct, 0)}%</span>
    </div>`;
  }).join('');
}

// --- Sensitivity analysis: pick an input from the current product, vary it ---
function sensitivityTargets() {
  const targets = [];
  product.parts.forEach(p => targets.push({ id: `part:${p.id}`, label: `Part: ${p.name} (weight)` }));
  if (product.assembly) targets.push({ id: 'assembly:0', label: 'Assembly energy (MJ/kg)' });
  product.transportLegs.forEach(t => {
    const transport = findById(TRANSPORT, t.transportId);
    targets.push({ id: `transport:${t.id}`, label: `Transport: ${transport.name} (distance)` });
  });
  product.customLines.forEach(c => targets.push({ id: `custom:${c.id}`, label: `Custom: ${c.name}` }));
  return targets;
}

function renderSensitivityOptions() {
  const select = document.getElementById('sens-target');
  const targets = sensitivityTargets();
  const prevValue = select.value;
  select.innerHTML = targets.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
  if (targets.some(t => t.id === prevValue)) select.value = prevValue;

  const hasTargets = targets.length > 0;
  document.getElementById('sens-empty').style.display = hasTargets ? 'none' : '';
  document.getElementById('sens-form').style.display = hasTargets ? '' : 'none';
  if (!hasTargets) document.getElementById('sens-table').style.display = 'none';
}

function buildScaledProduct(targetId, factor) {
  const clone = JSON.parse(JSON.stringify(product));
  const [type, idStr] = targetId.split(':');
  const id = Number(idStr);
  if (type === 'part') {
    const p = clone.parts.find(x => x.id === id);
    if (p) p.weight *= factor;
  } else if (type === 'assembly') {
    if (clone.assembly) clone.assembly.mjPerKg *= factor;
  } else if (type === 'transport') {
    const t = clone.transportLegs.find(x => x.id === id);
    if (t) { t.distanceKm *= factor; t.tkm *= factor; }
  } else if (type === 'custom') {
    const c = clone.customLines.find(x => x.id === id);
    if (c) {
      c.ecoCost = (c.ecoCost || 0) * factor;
      c.co2e = (c.co2e || 0) * factor;
      c.water = (c.water || 0) * factor;
      c.energyIn = (c.energyIn || 0) * factor;
    }
  }
  return clone;
}

function runSensitivity() {
  const targetId = document.getElementById('sens-target').value;
  if (!targetId) return;
  const pct = Number(document.getElementById('sens-variation').value);

  const base = totalsFor(computeLineItems(product));
  const down = totalsFor(computeLineItems(buildScaledProduct(targetId, 1 - pct / 100)));
  const up = totalsFor(computeLineItems(buildScaledProduct(targetId, 1 + pct / 100)));

  document.getElementById('sens-table').style.display = '';
  document.getElementById('sens-tbody').innerHTML = Object.keys(METRICS).map(key => {
    const lo = Math.min(down[key], up[key]);
    const hi = Math.max(down[key], up[key]);
    return `<tr>
      <td>${METRICS[key].label}</td>
      <td class="num">${fmtMetric(down[key], key)}</td>
      <td class="num">${fmtMetric(base[key], key)}</td>
      <td class="num">${fmtMetric(up[key], key)}</td>
      <td class="num">${fmtMetric(hi - lo, key)}</td>
    </tr>`;
  }).join('');
}

// --- CSV export (client-side, no dependencies) ---
function csvCell(value) {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvFromRows(header, rows) {
  return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const CSV_EXPORTERS = {
  eco: () => {
    const items = computeLineItems();
    const rows = items.map(i => [i.label, i.details.ecoCost, i.ecoCost.toFixed(2)]);
    rows.push(['Total', '', items.reduce((s, i) => s + i.ecoCost, 0).toFixed(2)]);
    return csvFromRows(['Line item', 'Detail', 'Eco-cost (EUR)'], rows);
  },
  carbon: () => {
    const items = computeLineItems();
    const rows = items.map(i => [i.label, i.details.co2e, i.co2e.toFixed(2)]);
    rows.push(['Total', '', items.reduce((s, i) => s + i.co2e, 0).toFixed(2)]);
    return csvFromRows(['Line item', 'Detail', 'kg CO2e'], rows);
  },
  water: () => {
    const items = computeLineItems();
    const rows = items.map(i => [i.label, i.details.water, i.water.toFixed(1)]);
    rows.push(['Total', '', items.reduce((s, i) => s + i.water, 0).toFixed(1)]);
    return csvFromRows(['Line item', 'Detail', 'Water (L)'], rows);
  },
  energy: () => {
    const items = computeLineItems();
    const rows = items.map(i => [i.label, i.details.energyIn, i.energyIn.toFixed(2)]);
    rows.push(['Total', '', items.reduce((s, i) => s + i.energyIn, 0).toFixed(2)]);
    return csvFromRows(['Line item', 'Detail', 'Energy (kWh)'], rows);
  },
  recycled: () => {
    const rows = product.parts.map(p => {
      const material = findById(MATERIALS, p.materialId);
      return [p.name, material.name, p.weight.toFixed(2), material.recycledPct];
    });
    rows.push(['Weighted total', '', '', computeRecycledPct().toFixed(1)]);
    return csvFromRows(['Part', 'Material', 'Weight (kg)', 'Recycled %'], rows);
  },
};

function exportCsv(tabKey, filename) {
  const build = CSV_EXPORTERS[tabKey];
  if (!build) return;
  downloadCsv(filename, build());
}

// --- Home: overview dashboard (previews every tab) ---
function renderOverview(items) {
  const totals = totalsFor(items);
  document.getElementById('stat-ecoCost').textContent = fmtMetric(totals.ecoCost, 'ecoCost');
  document.getElementById('stat-co2e').textContent = fmtMetric(totals.co2e, 'co2e');
  document.getElementById('stat-water').textContent = fmtMetric(totals.water, 'water');
  document.getElementById('stat-energyIn').textContent = fmtMetric(totals.energyIn, 'energyIn');
  document.getElementById('stat-recycled').textContent = `${fmt(computeRecycledPct(), 1)}%`;
}

// --- Rendering: master ---
function renderAll() {
  renderParts();
  renderAssembly();
  renderTransport();
  renderCustom();

  const items = computeLineItems();
  renderOverview(items);

  const ecoTotal = renderBreakdown(items, 'ecoCost', ECO_IDS);
  renderPresetCheck(ecoTotal);
  const co2eTotal = renderBreakdown(items, 'co2e', CARBON_IDS);
  const waterTotal = renderBreakdown(items, 'water', WATER_IDS);
  const energyInTotal = renderBreakdown(items, 'energyIn', ENERGY_IDS);
  renderRangeMeter('co2e', items, co2eTotal);
  renderRangeMeter('water', items, waterTotal);
  renderRangeMeter('energyIn', items, energyInTotal);

  renderRecycledTab();
  renderSensitivityOptions();
  document.getElementById('sens-table').style.display = 'none';

  updateTransportPreview();
}

// --- Presets ---
function loadPreset(key) {
  const preset = PRESET_EXAMPLES[key];
  product = { parts: [], assembly: null, transportLegs: [], customLines: [] };
  for (const p of preset.parts) {
    product.parts.push({
      id: nextLineId++, name: p.name, materialId: p.materialId, weight: p.weight,
      processId: p.processId || null, endOfLifeId: p.endOfLifeId || 'none',
    });
  }
  if (preset.assembly) {
    product.assembly = { energyId: preset.assembly.energyId, mjPerKg: preset.assembly.mjPerKg };
  }
  if (preset.customLines) {
    for (const c of preset.customLines) {
      product.customLines.push({ id: nextLineId++, name: c.name, ecoCost: c.ecoCost, co2e: 0, water: 0, energyIn: 0 });
    }
  }
  activePresetKey = key;
  renderAll();
  showTab('home');
}

// --- Account: Supabase auth (email/password), gracefully disabled if unconfigured ---
// `SUPABASE_URL` / `SUPABASE_ANON_KEY` come from supabase-config.js, loaded before this file.
// Guarded against the CDN failing to load too, so a network hiccup on a third-party
// script disables accounts only — it must never take down the rest of the calculator.
let supabaseClient = null;
try {
  if (typeof SUPABASE_URL === 'string' && SUPABASE_URL && typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY && typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch (e) {
  supabaseClient = null;
}
const supabaseConfigured = supabaseClient !== null;
let currentUser = null; // Supabase auth user object, or null when signed out / not configured

function renderAccountUI() {
  document.getElementById('account-card').style.display = '';
  document.getElementById('account-not-configured').style.display = supabaseConfigured ? 'none' : '';
  document.getElementById('account-signed-out').style.display = (supabaseConfigured && !currentUser) ? '' : 'none';
  document.getElementById('account-signed-in').style.display = (supabaseConfigured && currentUser) ? '' : 'none';
  if (currentUser) document.getElementById('auth-user-email').textContent = currentUser.email;

  const hasLocalScenarios = loadLocalScenarios().length > 0;
  document.getElementById('auth-import-row').style.display = (currentUser && hasLocalScenarios) ? '' : 'none';

  document.getElementById('scenarios-storage-note').textContent = !supabaseConfigured
    ? '(saved only in this browser)'
    : currentUser ? '(saved to your account)' : '(saved only in this browser — sign in above to save to your account)';
}

async function authSignUp() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const msg = document.getElementById('auth-message');
  if (!email || password.length < 6) { msg.textContent = 'Enter an email and a password of at least 6 characters.'; return; }
  msg.textContent = 'Signing up…';
  const { error } = await supabaseClient.auth.signUp({ email, password });
  msg.textContent = error ? error.message : 'Check your email to confirm your account, then log in.';
}

async function authLogIn() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const msg = document.getElementById('auth-message');
  if (!email || !password) { msg.textContent = 'Enter your email and password.'; return; }
  msg.textContent = 'Logging in…';
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) msg.textContent = error.message;
}

async function authLogOut() {
  await supabaseClient.auth.signOut();
}

async function importLocalScenarios() {
  if (!currentUser) return;
  const local = loadLocalScenarios();
  for (const s of local) {
    await supabaseClient.from('scenarios').insert({
      user_id: currentUser.id, name: s.name, totals: scenarioTotals(s), recycled_pct: s.recycledPct || 0, product: s.product,
    });
  }
  saveLocalScenarios([]);
  await renderScenarios();
  renderAccountUI();
}

// --- Scenarios: Supabase when signed in, localStorage otherwise ---
function loadLocalScenarios() {
  try { return JSON.parse(localStorage.getItem(SCENARIOS_KEY) || '[]'); } catch (e) { return []; }
}

function saveLocalScenarios(scenarios) {
  localStorage.setItem(SCENARIOS_KEY, JSON.stringify(scenarios));
}

async function saveScenario() {
  const name = document.getElementById('scenario-name').value.trim();
  if (!name) { alert('Name this scenario first.'); return; }
  const items = computeLineItems();
  if (!items.length) { alert('Build a product before saving it as a scenario.'); return; }
  const totals = totalsFor(items);
  const recycledPct = computeRecycledPct();

  if (currentUser) {
    const { error } = await supabaseClient.from('scenarios').insert({
      user_id: currentUser.id, name, totals, recycled_pct: recycledPct, product,
    });
    if (error) { alert('Could not save to your account: ' + error.message); return; }
  } else {
    const scenarios = loadLocalScenarios();
    scenarios.push({ id: String(Date.now()), name, totals, recycledPct, product: JSON.parse(JSON.stringify(product)) });
    saveLocalScenarios(scenarios);
  }
  document.getElementById('scenario-name').value = '';
  await renderScenarios();
}

async function deleteScenario(id) {
  if (currentUser) {
    await supabaseClient.from('scenarios').delete().eq('id', id);
  } else {
    saveLocalScenarios(loadLocalScenarios().filter(s => s.id !== id));
  }
  await renderScenarios();
}

async function loadScenario(id) {
  let loadedProduct;
  if (currentUser) {
    const { data } = await supabaseClient.from('scenarios').select('product').eq('id', id).single();
    if (!data) return;
    loadedProduct = data.product;
  } else {
    const scenario = loadLocalScenarios().find(s => s.id === id);
    if (!scenario) return;
    loadedProduct = scenario.product;
  }
  product = loadedProduct;
  nextLineId = Math.max(1, ...[...product.parts, ...product.transportLegs, ...product.customLines].map(x => x.id + 1));
  activePresetKey = null;
  renderAll();
  showTab('home');
}

function scenarioTotals(s) {
  return s.totals || { ecoCost: s.total || 0, co2e: 0, water: 0, energyIn: 0 };
}

async function renderScenarios() {
  let scenarios;
  if (currentUser) {
    const { data, error } = await supabaseClient.from('scenarios').select('*').order('created_at', { ascending: true });
    scenarios = error ? [] : data.map(row => ({ id: row.id, name: row.name, totals: row.totals, recycledPct: row.recycled_pct }));
  } else {
    scenarios = loadLocalScenarios().map(s => ({ id: s.id, name: s.name, totals: scenarioTotals(s), recycledPct: s.recycledPct || 0 }));
  }

  const empty = document.getElementById('scenarios-empty');
  const table = document.getElementById('scenarios-table');
  const chart = document.getElementById('scenarios-chart');
  if (!scenarios.length) {
    empty.style.display = '';
    table.style.display = 'none';
    chart.innerHTML = '';
    return;
  }
  empty.style.display = 'none';
  table.style.display = '';

  document.getElementById('scenarios-tbody').innerHTML = scenarios.map(s => `
    <tr>
      <td><a href="#" onclick="loadScenario('${s.id}'); return false;">${s.name}</a></td>
      <td class="num">${fmtMetric(s.totals.ecoCost, 'ecoCost')}</td>
      <td class="num">${fmtMetric(s.totals.co2e, 'co2e')}</td>
      <td class="num">${fmtMetric(s.totals.water, 'water')}</td>
      <td class="num">${fmtMetric(s.totals.energyIn, 'energyIn')}</td>
      <td class="num">${fmt(s.recycledPct, 1)}%</td>
      <td><button type="button" class="btn-remove" onclick="deleteScenario('${s.id}')">✕</button></td>
    </tr>`).join('');

  const maxAbs = Math.max(...scenarios.map(s => Math.abs(s.totals.ecoCost)), 0.0001);
  chart.innerHTML = scenarios.map(s => {
    const total = s.totals.ecoCost;
    const pct = (Math.abs(total) / maxAbs) * 100;
    const barClass = total < 0 ? 'bar-credit' : 'bar-burden';
    return `<div class="chart-row">
      <span class="chart-label">${s.name}</span>
      <div class="chart-track"><div class="chart-bar ${barClass}" style="width:${pct}%"></div></div>
      <span class="chart-value">€${fmt(total)}</span>
    </div>`;
  }).join('');
}

// --- Init ---
initDropdowns();
renderAll();
renderAccountUI();
if (supabaseConfigured) {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    currentUser = session ? session.user : null;
    renderAccountUI();
    renderScenarios();
  });
} else {
  renderScenarios();
}
showTab('home');
