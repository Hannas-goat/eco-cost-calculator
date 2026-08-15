// --- App state ---
// `product` (Home) is the eco-cost builder — unchanged, single-indicator, drives only Home.
let product = { parts: [], assembly: null, transportLegs: [], customLines: [] };
// The 4 other tabs are standalone calculators with their own state, independent of `product`.
// Carbon / Water / Energy share one list (energyUsageEntries) since all three are the same
// "energy source x kWh" input, just read out as a different factor.
let energyUsageEntries = []; // { id, energyId, kwh }
let recycledEntries = []; // { id, materialId, weight }
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
function populateSelect(selectEl, options, valueKey, labelFn) {
  selectEl.innerHTML = options.map(o => `<option value="${o[valueKey]}">${labelFn(o)}</option>`).join('');
}

function initDropdowns() {
  const categories = [...new Set(MATERIALS.map(m => m.category))];
  populateSelect(document.getElementById('part-category'), categories.map(c => ({ id: c })), 'id', c => c.id);
  renderMaterialOptions();

  const processSelect = document.getElementById('part-process');
  processSelect.innerHTML = '<option value="">No processing</option>' +
    PROCESSES.map(p => `<option value="${p.id}">${p.name} (€${p.ecoCost}/kg)</option>`).join('');

  const eolSelect = document.getElementById('part-eol');
  eolSelect.innerHTML = END_OF_LIFE.map(e => `<option value="${e.id}">${e.name}${e.ecoCost ? ` (€${e.ecoCost}/kg)` : ''}</option>`).join('');

  const energyOptionsHtml = ENERGY.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  document.getElementById('assembly-energy').innerHTML = ENERGY.map(e => `<option value="${e.id}">${e.name} (€${e.ecoCost}/MJ)</option>`).join('');
  document.getElementById('carbon-energy-id').innerHTML = energyOptionsHtml;
  document.getElementById('water-energy-id').innerHTML = energyOptionsHtml;
  document.getElementById('energy-energy-id').innerHTML = energyOptionsHtml;

  const transportSelect = document.getElementById('transport-mode');
  transportSelect.innerHTML = TRANSPORT.map(t => `<option value="${t.id}">${t.name} (€${t.ecoCost}/tkm)</option>`).join('');
  document.getElementById('transport-distance').addEventListener('input', updateTransportPreview);
  transportSelect.addEventListener('change', updateTransportPreview);
  updateTransportPreview();

  document.getElementById('recycled-material').innerHTML = MATERIALS
    .map(m => `<option value="${m.id}">${m.category} — ${m.name} (${m.recycledPct}% recycled)</option>`).join('');
}

function renderMaterialOptions() {
  const category = document.getElementById('part-category').value;
  const inCategory = MATERIALS.filter(m => m.category === category);
  populateSelect(document.getElementById('part-material'), inCategory, 'id', m => `${m.name} (€${m.ecoCost}/kg)`);
}

// --- Home: adding line items (eco-cost only) ---
function addPart() {
  const name = document.getElementById('part-name').value.trim();
  const materialId = document.getElementById('part-material').value;
  const weight = Number(document.getElementById('part-weight').value);
  const processId = document.getElementById('part-process').value || null;
  const endOfLifeId = document.getElementById('part-eol').value || 'none';
  if (!name || !materialId || !weight || weight <= 0) {
    alert('Give the part a name, a material, and a positive weight.');
    return;
  }
  product.parts.push({ id: nextLineId++, name, materialId, weight, processId, endOfLifeId });
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
  const value = Number(document.getElementById('custom-value').value);
  if (!name || Number.isNaN(value)) {
    alert('Give the custom line a description and a euro value.');
    return;
  }
  product.customLines.push({ id: nextLineId++, name, ecoCost: value });
  document.getElementById('custom-name').value = '';
  document.getElementById('custom-value').value = '';
  activePresetKey = null;
  renderAll();
}

function removeLine(kind, id) {
  if (kind === 'part') product.parts = product.parts.filter(p => p.id !== id);
  if (kind === 'transport') product.transportLegs = product.transportLegs.filter(t => t.id !== id);
  if (kind === 'custom') product.customLines = product.customLines.filter(c => c.id !== id);
  if (kind === 'energyUsage') energyUsageEntries = energyUsageEntries.filter(e => e.id !== id);
  if (kind === 'recycledEntry') recycledEntries = recycledEntries.filter(r => r.id !== id);
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

// --- Home: calculation (eco-cost only) ---
function computeLineItems(p = product) {
  const items = [];

  for (const part of p.parts) {
    const material = findById(MATERIALS, part.materialId);
    const process = part.processId ? findById(PROCESSES, part.processId) : null;
    const eol = part.endOfLifeId ? findById(END_OF_LIFE, part.endOfLifeId) : null;
    const materialCost = part.weight * material.ecoCost;
    const processCost = process ? part.weight * process.ecoCost : 0;
    const eolCost = eol ? part.weight * eol.ecoCost : 0;
    const detailBits = [`${part.weight} kg × ${material.name} (€${material.ecoCost}/kg)`];
    if (process) detailBits.push(`+ ${process.name} (€${process.ecoCost}/kg)`);
    if (eol && eol.ecoCost !== 0) detailBits.push(`+ ${eol.name} (€${eol.ecoCost}/kg)`);
    items.push({
      label: part.name,
      detail: detailBits.join(' '),
      ecoCost: materialCost + processCost + eolCost,
      kind: 'part',
    });
  }

  if (p.assembly) {
    const energy = findById(ENERGY, p.assembly.energyId);
    const mj = p.assembly.mjPerKg * totalPartsWeight(p);
    items.push({
      label: 'Assembly energy',
      detail: `${p.assembly.mjPerKg} MJ/kg × ${totalPartsWeight(p)} kg = ${mj.toFixed(3)} MJ × ${energy.name} (€${energy.ecoCost}/MJ)`,
      ecoCost: mj * energy.ecoCost,
      kind: 'assembly',
    });
  }

  for (const leg of p.transportLegs) {
    const transport = findById(TRANSPORT, leg.transportId);
    items.push({
      label: `Transport: ${transport.name}`,
      detail: `${leg.tkm.toFixed(4)} tkm × €${transport.ecoCost}/tkm (${leg.distanceKm} km)`,
      ecoCost: leg.tkm * transport.ecoCost,
      kind: 'transport',
    });
  }

  for (const custom of p.customLines) {
    items.push({ label: custom.name, detail: 'Custom eco-cost', ecoCost: custom.ecoCost, kind: 'custom' });
  }

  return items;
}

// --- Home: rendering builder ---
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
    ? product.customLines.map(c => lineItemRow('custom', c.id, c.name, `€${fmt(c.ecoCost)}`)).join('')
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
      <td class="detail-cell">${i.detail}</td>
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

// --- Carbon / Water / Energy: standalone "energy usage" calculator (shared data) ---
function addEnergyUsageEntry(prefix) {
  const energyId = document.getElementById(`${prefix}-energy-id`).value;
  const kwh = Number(document.getElementById(`${prefix}-kwh`).value);
  if (!energyId || !kwh || kwh <= 0) {
    alert('Pick an energy source and a positive kWh value.');
    return;
  }
  energyUsageEntries.push({ id: nextLineId++, energyId, kwh });
  document.getElementById(`${prefix}-kwh`).value = '';
  renderAll();
}

function energyUsageItems() {
  return energyUsageEntries.map(e => {
    const energy = findById(ENERGY, e.energyId);
    return {
      label: energy.name,
      detail: `${fmt(e.kwh)} kWh × ${energy.name}`,
      co2e: e.kwh * energy.co2e,
      water: e.kwh * energy.water,
      energyIn: e.kwh * energy.energyIn,
    };
  });
}

function renderEnergyUsageLists() {
  const html = energyUsageEntries.length
    ? energyUsageEntries.map(e => {
        const energy = findById(ENERGY, e.energyId);
        return lineItemRow('energyUsage', e.id, energy.name, `${fmt(e.kwh)} kWh`);
      }).join('')
    : '<p class="hint">No energy usage entries yet.</p>';
  document.getElementById('carbon-entries-list').innerHTML = html;
  document.getElementById('water-entries-list').innerHTML = html;
  document.getElementById('energy-entries-list').innerHTML = html;
}

function energyUsageTotals() {
  const items = energyUsageItems();
  return {
    co2e: items.reduce((s, i) => s + i.co2e, 0),
    water: items.reduce((s, i) => s + i.water, 0),
    energyIn: items.reduce((s, i) => s + i.energyIn, 0),
  };
}

// Best/worst case: same total kWh, but every entry using the cleanest (or dirtiest)
// available ENERGY source for that metric — grounded in the app's own reference
// data, not an external benchmark.
function energyUsageRange(metricKey) {
  const totalKwh = energyUsageEntries.reduce((s, e) => s + e.kwh, 0);
  const factors = ENERGY.map(e => e[metricKey]);
  const bestSource = ENERGY.find(e => e[metricKey] === Math.min(...factors));
  const worstSource = ENERGY.find(e => e[metricKey] === Math.max(...factors));
  return {
    best: totalKwh * bestSource[metricKey],
    worst: totalKwh * worstSource[metricKey],
    bestSource,
    worstSource,
  };
}

const RANGE_IDS = {
  co2e: { bestLabel: 'carbon-range-best-label', worstLabel: 'carbon-range-worst-label', marker: 'carbon-range-marker', your: 'carbon-range-your' },
  water: { bestLabel: 'water-range-best-label', worstLabel: 'water-range-worst-label', marker: 'water-range-marker', your: 'water-range-your' },
  energyIn: { bestLabel: 'energy-range-best-label', worstLabel: 'energy-range-worst-label', marker: 'energy-range-marker', your: 'energy-range-your' },
};

function renderRangeMeter(metricKey, total) {
  const ids = RANGE_IDS[metricKey];
  const range = energyUsageRange(metricKey);
  const marker = document.getElementById(ids.marker);
  document.getElementById(ids.bestLabel).textContent = `Best case: ${fmtMetric(range.best, metricKey)} (${range.bestSource.name})`;
  document.getElementById(ids.worstLabel).textContent = `Worst case: ${fmtMetric(range.worst, metricKey)} (${range.worstSource.name})`;
  document.getElementById(ids.your).textContent = fmtMetric(total, metricKey);
  const span = range.worst - range.best;
  const pct = span > 0 ? Math.min(100, Math.max(0, ((total - range.best) / span) * 100)) : 0;
  marker.style.left = `${pct}%`;
}

// --- Recycled content: standalone calculator ---
function addRecycledEntry() {
  const materialId = document.getElementById('recycled-material').value;
  const weight = Number(document.getElementById('recycled-weight').value);
  if (!materialId || !weight || weight <= 0) {
    alert('Pick a material and a positive weight.');
    return;
  }
  recycledEntries.push({ id: nextLineId++, materialId, weight });
  document.getElementById('recycled-weight').value = '';
  renderAll();
}

function computeRecycledPct() {
  let totalWeight = 0;
  let recycledWeight = 0;
  for (const entry of recycledEntries) {
    const material = findById(MATERIALS, entry.materialId);
    totalWeight += entry.weight;
    recycledWeight += entry.weight * (material.recycledPct / 100);
  }
  return totalWeight > 0 ? (recycledWeight / totalWeight) * 100 : 0;
}

function renderRecycledTab() {
  const empty = document.getElementById('recycled-empty');
  const body = document.getElementById('recycled-body');
  document.getElementById('recycled-entries-list').innerHTML = recycledEntries.length
    ? recycledEntries.map(r => {
        const material = findById(MATERIALS, r.materialId);
        return lineItemRow('recycledEntry', r.id, material.name, `${fmt(r.weight)} kg · ${fmt(material.recycledPct, 0)}% recycled`);
      }).join('')
    : '<p class="hint">No materials added yet.</p>';

  if (!recycledEntries.length) {
    empty.style.display = '';
    body.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  body.style.display = '';

  document.getElementById('recycled-tbody').innerHTML = recycledEntries.map(r => {
    const material = findById(MATERIALS, r.materialId);
    return `<tr>
      <td>${material.name}</td>
      <td class="detail-cell">${material.category}</td>
      <td class="num">${fmt(r.weight)} kg</td>
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
  for (const r of recycledEntries) {
    const material = findById(MATERIALS, r.materialId);
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
    : '<strong>No higher-recycled alternative found</strong> in the reference data for the materials you\'ve added.';

  document.getElementById('recycled-chart').innerHTML = recycledEntries.map(r => {
    const material = findById(MATERIALS, r.materialId);
    return `<div class="chart-row">
      <span class="chart-label">${material.name}</span>
      <div class="chart-track"><div class="chart-bar bar-credit" style="width:${material.recycledPct}%"></div></div>
      <span class="chart-value">${fmt(material.recycledPct, 0)}%</span>
    </div>`;
  }).join('');
}

// --- Sensitivity analysis: standalone, generic calculator ---
function runSensitivity() {
  const label = document.getElementById('sens-label').value.trim() || 'Value';
  const base = Number(document.getElementById('sens-base').value);
  if (Number.isNaN(base) || document.getElementById('sens-base').value === '') {
    alert('Enter a base value to test.');
    return;
  }
  const pct = Number(document.getElementById('sens-variation').value);
  const down = base * (1 - pct / 100);
  const up = base * (1 + pct / 100);

  document.getElementById('sens-table').style.display = '';
  document.getElementById('sens-tbody').innerHTML = `<tr>
    <td>${label}</td>
    <td class="num">${fmt(down)}</td>
    <td class="num">${fmt(base)}</td>
    <td class="num">${fmt(up)}</td>
    <td class="num">${fmt(up - down)}</td>
  </tr>`;
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
    const total = items.reduce((s, i) => s + i.ecoCost, 0);
    const rows = items.map(i => [i.label, i.detail, i.ecoCost.toFixed(2)]);
    rows.push(['Total', '', total.toFixed(2)]);
    return csvFromRows(['Line item', 'Detail', 'Eco-cost (EUR)'], rows);
  },
  carbon: () => {
    const items = energyUsageItems();
    const rows = items.map(i => [i.label, i.detail, i.co2e.toFixed(2)]);
    rows.push(['Total', '', items.reduce((s, i) => s + i.co2e, 0).toFixed(2)]);
    return csvFromRows(['Energy source', 'Detail', 'kg CO2e'], rows);
  },
  water: () => {
    const items = energyUsageItems();
    const rows = items.map(i => [i.label, i.detail, i.water.toFixed(1)]);
    rows.push(['Total', '', items.reduce((s, i) => s + i.water, 0).toFixed(1)]);
    return csvFromRows(['Energy source', 'Detail', 'Water (L)'], rows);
  },
  energy: () => {
    const items = energyUsageItems();
    const rows = items.map(i => [i.label, i.detail, i.energyIn.toFixed(2)]);
    rows.push(['Total', '', items.reduce((s, i) => s + i.energyIn, 0).toFixed(2)]);
    return csvFromRows(['Energy source', 'Detail', 'Energy (kWh)'], rows);
  },
  recycled: () => {
    const rows = recycledEntries.map(r => {
      const material = findById(MATERIALS, r.materialId);
      return [material.name, material.category, r.weight.toFixed(2), material.recycledPct];
    });
    rows.push(['Weighted total', '', '', computeRecycledPct().toFixed(1)]);
    return csvFromRows(['Material', 'Category', 'Weight (kg)', 'Recycled %'], rows);
  },
};

function exportCsv(tabKey, filename) {
  const build = CSV_EXPORTERS[tabKey];
  if (!build) return;
  downloadCsv(filename, build());
}

// --- Home: overview dashboard (previews every tab) ---
function renderOverview(ecoItems) {
  const ecoTotal = ecoItems.reduce((sum, i) => sum + i.ecoCost, 0);
  const energyTotals = energyUsageTotals();
  document.getElementById('stat-ecoCost').textContent = fmtMetric(ecoTotal, 'ecoCost');
  document.getElementById('stat-co2e').textContent = fmtMetric(energyTotals.co2e, 'co2e');
  document.getElementById('stat-water').textContent = fmtMetric(energyTotals.water, 'water');
  document.getElementById('stat-energyIn').textContent = fmtMetric(energyTotals.energyIn, 'energyIn');
  document.getElementById('stat-recycled').textContent = `${fmt(computeRecycledPct(), 1)}%`;
}

// --- Rendering: master ---
function renderAll() {
  renderParts();
  renderAssembly();
  renderTransport();
  renderCustom();

  const ecoItems = computeLineItems();
  const ecoTotal = renderBreakdown(ecoItems, 'ecoCost', ECO_IDS);
  renderPresetCheck(ecoTotal);

  renderEnergyUsageLists();
  const enItems = energyUsageItems();
  const co2eTotal = renderBreakdown(enItems, 'co2e', CARBON_IDS);
  const waterTotal = renderBreakdown(enItems, 'water', WATER_IDS);
  const energyInTotal = renderBreakdown(enItems, 'energyIn', ENERGY_IDS);
  if (co2eTotal !== null) renderRangeMeter('co2e', co2eTotal);
  if (waterTotal !== null) renderRangeMeter('water', waterTotal);
  if (energyInTotal !== null) renderRangeMeter('energyIn', energyInTotal);

  renderRecycledTab();
  renderOverview(ecoItems);

  updateTransportPreview();
}

// --- Presets (Home / eco-cost only) ---
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
      product.customLines.push({ id: nextLineId++, name: c.name, ecoCost: c.ecoCost });
    }
  }
  activePresetKey = key;
  renderAll();
  showTab('home');
}

// --- Scenarios (localStorage, Home / eco-cost only) ---
function loadScenarios() {
  try { return JSON.parse(localStorage.getItem(SCENARIOS_KEY) || '[]'); } catch (e) { return []; }
}

function saveScenarios(scenarios) {
  localStorage.setItem(SCENARIOS_KEY, JSON.stringify(scenarios));
}

function saveScenario() {
  const name = document.getElementById('scenario-name').value.trim();
  if (!name) { alert('Name this scenario first.'); return; }
  const items = computeLineItems();
  if (!items.length) { alert('Build a product before saving it as a scenario.'); return; }
  const total = items.reduce((sum, i) => sum + i.ecoCost, 0);
  const scenarios = loadScenarios();
  scenarios.push({ id: Date.now(), name, total, product: JSON.parse(JSON.stringify(product)) });
  saveScenarios(scenarios);
  document.getElementById('scenario-name').value = '';
  renderScenarios();
}

function deleteScenario(id) {
  saveScenarios(loadScenarios().filter(s => s.id !== id));
  renderScenarios();
}

function loadScenario(id) {
  const scenario = loadScenarios().find(s => s.id === id);
  if (!scenario) return;
  product = scenario.product;
  nextLineId = Math.max(1, ...[...product.parts, ...product.transportLegs, ...product.customLines].map(x => x.id + 1));
  activePresetKey = null;
  renderAll();
  showTab('home');
}

function renderScenarios() {
  const scenarios = loadScenarios();
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
      <td><a href="#" onclick="loadScenario(${s.id}); return false;">${s.name}</a></td>
      <td class="num">${fmt(s.total)}</td>
      <td><button type="button" class="btn-remove" onclick="deleteScenario(${s.id})">✕</button></td>
    </tr>`).join('');

  const maxAbs = Math.max(...scenarios.map(s => Math.abs(s.total)), 0.0001);
  chart.innerHTML = scenarios.map(s => {
    const pct = (Math.abs(s.total) / maxAbs) * 100;
    const barClass = s.total < 0 ? 'bar-credit' : 'bar-burden';
    return `<div class="chart-row">
      <span class="chart-label">${s.name}</span>
      <div class="chart-track"><div class="chart-bar ${barClass}" style="width:${pct}%"></div></div>
      <span class="chart-value">€${fmt(s.total)}</span>
    </div>`;
  }).join('');
}

// --- Init ---
initDropdowns();
renderAll();
renderScenarios();
showTab('home');
