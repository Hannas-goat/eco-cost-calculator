// --- App state ---
// One unified product drives every tab. Add a part once on Home and eco-cost,
// carbon, water, energy, and recycled content all compute from it — Carbon /
// Water / Energy / Recycled tabs are read-only breakdown views of this same
// product, not separate data-entry tools.
let product = { parts: [], assembly: null, transportLegs: [], customLines: [], tradeLines: [] };
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

// --- Currency: eco-cost is entered and stored in euros (that's the unit the
// reference data is in); everywhere it's DISPLAYED can be converted to the
// user's chosen currency. Rates come from a free, keyless, CORS-open API,
// fetched on demand (not on every page load) and cached in localStorage. ---
const CURRENCIES = {
  EUR: { symbol: '€', digits: 2, name: 'Euro' },
  USD: { symbol: '$', digits: 2, name: 'US Dollar' },
  GBP: { symbol: '£', digits: 2, name: 'British Pound' },
  JPY: { symbol: '¥', digits: 0, name: 'Japanese Yen' },
  CAD: { symbol: 'CA$', digits: 2, name: 'Canadian Dollar' },
  AUD: { symbol: 'A$', digits: 2, name: 'Australian Dollar' },
  CHF: { symbol: 'CHF', digits: 2, name: 'Swiss Franc' },
  CNY: { symbol: '¥', digits: 2, name: 'Chinese Yuan' },
  INR: { symbol: '₹', digits: 2, name: 'Indian Rupee' },
};
const CURRENCY_KEY = 'ecocost_currency';
const RATES_CACHE_KEY = 'ecocost_exchange_rates';
const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

let currentCurrency = localStorage.getItem(CURRENCY_KEY) || 'EUR';
let exchangeRates = { EUR: 1 };
let ratesUpdatedAt = null;

function loadCachedRates() {
  try {
    const cached = JSON.parse(localStorage.getItem(RATES_CACHE_KEY) || 'null');
    if (cached && cached.rates && Date.now() - cached.fetchedAt < RATES_MAX_AGE_MS) {
      exchangeRates = cached.rates;
      ratesUpdatedAt = cached.sourceDate;
      return true;
    }
  } catch (e) { /* ignore malformed cache */ }
  return false;
}

async function ensureExchangeRates() {
  if (currentCurrency === 'EUR') return true;
  if (exchangeRates[currentCurrency]) return true;
  if (loadCachedRates() && exchangeRates[currentCurrency]) return true;

  const note = document.getElementById('currency-note');
  if (note) note.textContent = 'Fetching exchange rates…';
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/EUR');
    const data = await res.json();
    if (data.result !== 'success') throw new Error('rate lookup failed');
    exchangeRates = data.rates;
    ratesUpdatedAt = data.time_last_update_utc;
    localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ rates: exchangeRates, fetchedAt: Date.now(), sourceDate: ratesUpdatedAt }));
    return true;
  } catch (e) {
    if (loadCachedRates()) return true; // fall back to stale cache rather than failing outright
    if (note) note.textContent = 'Could not fetch exchange rates — showing euros instead.';
    currentCurrency = 'EUR';
    return false;
  }
}

async function changeCurrency() {
  currentCurrency = document.getElementById('currency-select').value;
  localStorage.setItem(CURRENCY_KEY, currentCurrency);
  await ensureExchangeRates();
  updateCurrencyNote();
  refreshRateLabels();
  renderAll();
  await renderScenarios();
}

function updateCurrencyNote() {
  const note = document.getElementById('currency-note');
  if (!note) return;
  note.textContent = currentCurrency === 'EUR'
    ? 'All amounts entered and shown in euros.'
    : `Every rate, input, and total on this page is shown in ${currentCurrency} (${CURRENCIES[currentCurrency].name}), using rates from ${ratesUpdatedAt || 'exchangerate-api.com'} — stored internally in euros so nothing is lost switching currencies. Reference-total checks always stay in euros, since they validate against known source figures. CSV exports also stay in euros, for portable raw data.`;
}

// A small per-unit rate (e.g. €0.0053/tkm) needs more precision than a total —
// fixed-2-decimals would round small rates to zero. Trims trailing zeros naturally.
// (Named distinctly from fmtRate(value, metricKey, basis) below, which formats a
// detail-column rate by metric — a same-name collision here previously broke both.)
function fmtCurrencyRate(eurPerUnit, unitLabel) {
  const cur = CURRENCIES[currentCurrency] || CURRENCIES.EUR;
  const rate = exchangeRates[currentCurrency] || 1;
  const shown = (eurPerUnit * rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 });
  return `${cur.symbol}${shown}/${unitLabel}`;
}

function fmtMetric(n, key) {
  if (key === 'ecoCost') {
    const cur = CURRENCIES[currentCurrency] || CURRENCIES.EUR;
    const rate = exchangeRates[currentCurrency] || 1;
    return `${cur.symbol}${fmt(n * rate, cur.digits)}`;
  }
  const cfg = METRICS[key];
  return `${fmt(n, cfg.digits)} ${cfg.unit}`;
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

// Rebuilds only the rate-labeled dropdowns (process/EoL/energy/transport), preserving
// whatever's currently selected — used on init AND whenever currency changes. Deliberately
// does NOT touch part-category/part-material, so switching currency never resets those.
function refreshRateLabels() {
  const processSelect = document.getElementById('part-process');
  const prevProcess = processSelect.value;
  processSelect.innerHTML = '<option value="">No processing</option>' +
    PROCESSES.map(p => `<option value="${p.id}">${p.name} (${fmtCurrencyRate(p.ecoCost, 'kg')})</option>`).join('');
  processSelect.value = prevProcess;

  const eolSelect = document.getElementById('part-eol');
  const prevEol = eolSelect.value;
  eolSelect.innerHTML = END_OF_LIFE.map(e => `<option value="${e.id}">${e.name}${e.ecoCost ? ` (${fmtCurrencyRate(e.ecoCost, 'kg')})` : ''}</option>`).join('');
  eolSelect.value = prevEol;

  const energySelect = document.getElementById('assembly-energy');
  const prevEnergy = energySelect.value;
  energySelect.innerHTML = ENERGY.map(e => `<option value="${e.id}">${e.name} (${fmtCurrencyRate(e.ecoCost, 'MJ')})</option>`).join('');
  energySelect.value = prevEnergy;

  const transportSelect = document.getElementById('transport-mode');
  const prevTransport = transportSelect.value;
  transportSelect.innerHTML = TRANSPORT.map(t => `<option value="${t.id}">${t.name} (${fmtCurrencyRate(t.ecoCost, 'tkm')})</option>`).join('');
  transportSelect.value = prevTransport;

  updateCustomValuePlaceholder();
  updateMaterialPreview();
}

// --- Dropdown population ---
function initDropdowns() {
  const categories = [...new Set(MATERIALS.map(m => m.category))];
  document.getElementById('part-category').innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
  renderMaterialOptions();

  refreshRateLabels();

  document.getElementById('transport-distance').addEventListener('input', updateTransportPreview);
  document.getElementById('transport-mode').addEventListener('change', updateTransportPreview);
  updateTransportPreview();

  const countryOptions = COUNTRIES.map(c => `<option value="${c}">${c}</option>`).join('');
  document.getElementById('trade-made-in').innerHTML = countryOptions;
  document.getElementById('trade-imported-from').innerHTML = countryOptions;
  document.getElementById('trade-exported-to').innerHTML = countryOptions;
}

// Searchable material combobox: a text input + <datalist>, scoped to the chosen
// category, so users can type "Alu..." instead of scanning a long dropdown.
function renderMaterialOptions() {
  const category = document.getElementById('part-category').value;
  const inCategory = MATERIALS.filter(m => m.category === category);
  document.getElementById('material-datalist').innerHTML =
    inCategory.map(m => `<option value="${m.name}">`).join('');
  document.getElementById('part-material').value = '';
  updateMaterialPreview();
}

// Shows the picked material's rates (in the selected currency/units) as you type,
// since the searchable text input — unlike the old plain <select> — doesn't show
// this inline in the dropdown itself.
function updateMaterialPreview() {
  const el = document.getElementById('material-preview');
  const name = document.getElementById('part-material').value.trim();
  const material = MATERIALS.find(m => m.name === name);
  el.textContent = material
    ? `${fmtCurrencyRate(material.ecoCost, 'kg')} · ${material.co2e} kg CO2e/kg · ${material.water} L/kg · ${material.energyIn} kWh/kg · ${material.recycledPct}% recycled`
    : '';
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
  // Typed in the currently selected currency; stored internally in euros, like everything else.
  const enteredValue = Number(document.getElementById('custom-value').value) || 0;
  const ecoCost = enteredValue / (exchangeRates[currentCurrency] || 1);
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

// Trade: a purely financial line (country made in, imported-from/exported-to countries,
// and their costs) — contributes to eco-cost only, not carbon/water/energy, since it's a
// customs/logistics fee rather than an environmental impact. Costs are typed in the
// selected currency and stored internally in euros, same as the custom-line-item input.
function addTradeLine() {
  const madeIn = document.getElementById('trade-made-in').value;
  const importedFrom = document.getElementById('trade-imported-from').value;
  const exportedTo = document.getElementById('trade-exported-to').value;
  const rate = exchangeRates[currentCurrency] || 1;
  const importCost = (Number(document.getElementById('trade-import-cost').value) || 0) / rate;
  const exportCost = (Number(document.getElementById('trade-export-cost').value) || 0) / rate;
  if (!importCost && !exportCost) {
    alert('Enter an import cost and/or an export cost.');
    return;
  }
  product.tradeLines.push({ id: nextLineId++, madeIn, importedFrom, exportedTo, importCost, exportCost });
  document.getElementById('trade-import-cost').value = '';
  document.getElementById('trade-export-cost').value = '';
  activePresetKey = null;
  renderAll();
}

function removeLine(kind, id) {
  if (kind === 'part') product.parts = product.parts.filter(p => p.id !== id);
  if (kind === 'transport') product.transportLegs = product.transportLegs.filter(t => t.id !== id);
  if (kind === 'custom') product.customLines = product.customLines.filter(c => c.id !== id);
  if (kind === 'trade') product.tradeLines = product.tradeLines.filter(t => t.id !== id);
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
  product = { parts: [], assembly: null, transportLegs: [], customLines: [], tradeLines: [] };
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

  // (p.tradeLines || []) — scenarios saved before this feature existed won't have this
  // field at all; treat that as "no trade lines" rather than crashing.
  for (const trade of (p.tradeLines || [])) {
    const detail = `Made in ${trade.madeIn}, imported from ${trade.importedFrom}, exported to ${trade.exportedTo} — financial trade cost, not an environmental impact`;
    items.push({
      label: `Trade: ${trade.madeIn}`,
      details: { ecoCost: detail, co2e: detail, water: detail, energyIn: detail },
      kind: 'trade',
      ecoCost: (trade.importCost || 0) + (trade.exportCost || 0),
      co2e: 0,
      water: 0,
      energyIn: 0,
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

// Assembly/Transport/Custom/Trade are collapsed by default to keep the builder
// uncluttered — but auto-expand if they already hold data (e.g. from a loaded
// preset or scenario), so nothing configured stays hidden from view.
function openDetailsIfContent(detailsId, hasContent) {
  const details = document.getElementById(detailsId);
  if (details && hasContent) details.open = true;
}

function renderAssembly() {
  const el = document.getElementById('assembly-line');
  openDetailsIfContent('assembly-details', !!product.assembly);
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
  openDetailsIfContent('transport-details', product.transportLegs.length > 0);
  el.innerHTML = product.transportLegs.length
    ? product.transportLegs.map(t => {
        const transport = findById(TRANSPORT, t.transportId);
        return lineItemRow('transport', t.id, transport.name, `${t.distanceKm} km (${t.tkm.toFixed(4)} tkm)`);
      }).join('')
    : '<p class="hint">No transport legs yet.</p>';
}

function renderCustom() {
  const el = document.getElementById('custom-list');
  openDetailsIfContent('custom-details', product.customLines.length > 0);
  el.innerHTML = product.customLines.length
    ? product.customLines.map(c => lineItemRow('custom', c.id, c.name,
        `${fmtMetric(c.ecoCost, 'ecoCost')} · ${fmt(c.co2e)} kg CO2e · ${fmt(c.water, 1)} L · ${fmt(c.energyIn)} kWh`)).join('')
    : '<p class="hint">No custom lines yet.</p>';
}

function renderTradeLines() {
  const el = document.getElementById('trade-list');
  openDetailsIfContent('trade-details', product.tradeLines.length > 0);
  el.innerHTML = product.tradeLines.length
    ? product.tradeLines.map(t => lineItemRow('trade', t.id, `Made in ${t.madeIn}`,
        `Imported from ${t.importedFrom} (${fmtMetric(t.importCost, 'ecoCost')}) · Exported to ${t.exportedTo} (${fmtMetric(t.exportCost, 'ecoCost')})`)).join('')
    : '<p class="hint">No trade lines yet.</p>';
}

// Custom-line eco-cost placeholder follows the selected currency, so the input itself
// never shows a euro label when a different currency is active.
function updateCustomValuePlaceholder() {
  const unit = currentCurrency === 'EUR' ? 'euros' : currentCurrency;
  const setPlaceholder = (id, label) => {
    const input = document.getElementById(id);
    if (input) input.placeholder = `${label} (${unit})`;
  };
  setPlaceholder('custom-value', 'Eco-cost');
  setPlaceholder('trade-import-cost', 'Import cost');
  setPlaceholder('trade-export-cost', 'Export cost');
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
  const currencyAside = currentCurrency !== 'EUR' ? ' (reference checks always stay in euros, regardless of the selected display currency)' : '';
  el.innerHTML = `${withinTolerance ? '✓' : '⚠'} Reference total for "${preset.name}": €${fmt(preset.expectedTotal)}.
    This calculator computed €${fmt(total)} (difference €${fmt(diff)}, from source figures pre-rounded to 2 decimals)${currencyAside}.`;
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

// --- Optimization hints: flag when a lower-impact alternative already exists in the
// reference data, for whichever metric the current tab is about. Grounded in the app's
// own data (no invented numbers) — extends the same "higher-recycled alternative" idea
// already used on the Recycled Content tab to materials, energy, and transport. Deliberately
// skips processes and end-of-life: neither is grouped by material compatibility in the data
// model, so a generic "lower value" match could suggest something physically nonsensical
// (e.g. an incineration EoL option meant for plastic, applied to a metal part).
const HINT_IDS = { ecoCost: 'eco-hints', co2e: 'carbon-hints', water: 'water-hints', energyIn: 'energy-hints' };

function materialBaseName(name) { return name.split(' ')[0]; }

function bestAlternative(list, current, metricKey, sameGroup) {
  const candidates = list.filter(x => x.id !== current.id && x[metricKey] < current[metricKey] && (!sameGroup || sameGroup(x)));
  if (!candidates.length) return null;
  return candidates.reduce((best, x) => (x[metricKey] < best[metricKey] ? x : best));
}

function computeOptimizationHints(metricKey) {
  const hints = [];

  for (const part of product.parts) {
    const material = findById(MATERIALS, part.materialId);
    const baseName = materialBaseName(material.name);
    const alt = bestAlternative(MATERIALS, material, metricKey, m => materialBaseName(m.name) === baseName);
    if (alt) {
      const saved = (material[metricKey] - alt[metricKey]) * part.weight;
      hints.push(`<strong>${part.name}:</strong> switch material from "${material.name}" to "${alt.name}" → saves ${fmtMetric(saved, metricKey)}`);
    }
  }

  if (product.assembly) {
    const energy = findById(ENERGY, product.assembly.energyId);
    const alt = bestAlternative(ENERGY, energy, metricKey);
    if (alt) {
      const kwh = (product.assembly.mjPerKg * totalPartsWeight()) / 3.6;
      const saved = (energy[metricKey] - alt[metricKey]) * kwh;
      hints.push(`<strong>Assembly energy:</strong> switch from "${energy.name}" to "${alt.name}" → saves ${fmtMetric(saved, metricKey)}`);
    }
  }

  for (const leg of product.transportLegs) {
    const transport = findById(TRANSPORT, leg.transportId);
    const alt = bestAlternative(TRANSPORT, transport, metricKey);
    if (alt) {
      const saved = (transport[metricKey] - alt[metricKey]) * leg.tkm;
      hints.push(`<strong>Transport (${transport.name}):</strong> switch to "${alt.name}" → saves ${fmtMetric(saved, metricKey)}`);
    }
  }

  return hints;
}

function renderOptimizationHints(metricKey) {
  const el = document.getElementById(HINT_IDS[metricKey]);
  if (!el) return;
  const hints = computeOptimizationHints(metricKey);
  el.innerHTML = hints.length
    ? `<strong>Lower-impact alternatives available in your reference data:</strong><ul>${hints.map(h => `<li>${h}</li>`).join('')}</ul>`
    : '';
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
  product.tradeLines.forEach(t => targets.push({ id: `trade:${t.id}`, label: `Trade: made in ${t.madeIn} (import + export cost)` }));
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
  } else if (type === 'trade') {
    const t = clone.tradeLines.find(x => x.id === id);
    if (t) {
      t.importCost = (t.importCost || 0) * factor;
      t.exportCost = (t.exportCost || 0) * factor;
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

// --- CSV import: bulk-add parts from a spreadsheet instead of one at a time ---
function downloadCsvTemplate() {
  const csv = csvFromRows(['Name', 'Material', 'Weight', 'Process', 'End-of-life'], [
    ['Body', 'Aluminium (secondary)', '2', 'Extruding aluminium', 'Recycling, closed loop: Aluminium (credit)'],
    ['Cap', 'PE (HDPE, High density)', '0.5', '', ''],
  ]);
  downloadCsv('parts-template', csv);
}

// Minimal CSV line parser: handles quoted fields containing commas, not full RFC 4180
// (no embedded newlines inside a quoted field) — sufficient for a simple parts sheet.
function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { cur += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

function uploadPartsCsv(event) {
  const file = event.target.files[0];
  const status = document.getElementById('csv-upload-status');
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const lines = String(reader.result).split(/\r?\n/).filter(l => l.trim().length);
    if (!lines.length) { status.textContent = 'Empty file.'; return; }

    const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
    const col = (...names) => names.map(n => header.indexOf(n)).find(i => i !== -1);
    const nameCol = col('name', 'part name');
    const materialCol = col('material');
    const weightCol = col('weight', 'weight (kg)');
    const processCol = col('process');
    const eolCol = col('end-of-life', 'eol');

    if (nameCol === undefined || materialCol === undefined || weightCol === undefined) {
      status.textContent = 'CSV needs at least Name, Material, and Weight columns — see the template.';
      return;
    }

    let added = 0;
    const errors = [];
    lines.slice(1).forEach((line, i) => {
      const cells = parseCsvLine(line);
      const name = (cells[nameCol] || '').trim();
      const materialName = (cells[materialCol] || '').trim();
      const weight = Number(cells[weightCol]);
      const material = MATERIALS.find(m => m.name.toLowerCase() === materialName.toLowerCase());
      if (!name || !material || !weight || weight <= 0) {
        errors.push(`row ${i + 2}${!name ? ' (no name)' : ''}${!material ? ` (material "${materialName}" not found)` : ''}${(!weight || weight <= 0) ? ' (invalid weight)' : ''}`);
        return;
      }
      const processName = processCol !== undefined ? (cells[processCol] || '').trim() : '';
      const process = processName ? PROCESSES.find(p => p.name.toLowerCase() === processName.toLowerCase()) : null;
      const eolName = eolCol !== undefined ? (cells[eolCol] || '').trim() : '';
      const eol = eolName ? END_OF_LIFE.find(e => e.name.toLowerCase() === eolName.toLowerCase()) : null;

      product.parts.push({
        id: nextLineId++, name, materialId: material.id, weight,
        processId: process ? process.id : null, endOfLifeId: eol ? eol.id : 'none',
      });
      added++;
    });

    status.textContent = added
      ? `Added ${added} part(s).${errors.length ? ` Skipped: ${errors.join('; ')}.` : ''}`
      : `No parts added. ${errors.join('; ') || 'Check the file matches the template format.'}`;
    activePresetKey = null;
    renderAll();
  };
  reader.onerror = () => { status.textContent = 'Could not read that file.'; };
  reader.readAsText(file);
  event.target.value = ''; // allow re-uploading the same file name after a fix
}

// --- AI part extraction: free-text OR an uploaded file -> parts, via the backend (never
// calls the AI provider directly from the browser -- the API key must stay server-side).
// Matching against MATERIALS/PROCESSES/END_OF_LIFE happens here, same as CSV upload,
// so a made-up name the AI might return never silently becomes a real part.

// File types the browser can just read as plain text -- everything else (PDF, DOCX, XLS/XLSX)
// needs server-side parsing, so those go through aiAttachedFile instead. Images aren't offered
// here at all -- Groq (the current AI provider) doesn't host any vision-capable model right
// now, confirmed against its live model catalog, so an image upload would just fail every time.
const AI_PLAIN_TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json'];
let aiAttachedFile = null;

function handleAiFileSelect(event) {
  const file = event.target.files[0];
  const status = document.getElementById('ai-status');
  aiAttachedFile = null;
  if (!file) { status.textContent = ''; return; }

  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
  if (AI_PLAIN_TEXT_EXTENSIONS.includes(ext) || file.type.startsWith('text/')) {
    const reader = new FileReader();
    reader.onload = () => {
      document.getElementById('ai-description').value = String(reader.result).slice(0, 20000);
      status.textContent = `Loaded ${file.name} into the box above — edit if needed, then Extract.`;
    };
    reader.onerror = () => { status.textContent = 'Could not read that file.'; };
    reader.readAsText(file);
  } else {
    aiAttachedFile = file;
    status.textContent = `📎 ${file.name} attached (${(file.size / 1024).toFixed(0)} KB) — click "Extract parts with AI" to process it.`;
  }
}

function applyAiPartSuggestions(suggestions) {
  let added = 0;
  let estimated = 0;
  const skipped = [];
  for (const s of suggestions) {
    const name = String(s.name || 'Part').slice(0, 60);
    const materialName = s.material ? String(s.material) : '';
    const material = materialName ? MATERIALS.find(m => m.name.toLowerCase() === materialName.toLowerCase()) : null;
    const weight = Number(s.weight);
    const hasWeight = weight && weight > 0;

    if (material && hasWeight) {
      const processName = s.process ? String(s.process) : '';
      const process = processName ? PROCESSES.find(p => p.name.toLowerCase() === processName.toLowerCase()) : null;
      const eolName = s.endOfLife ? String(s.endOfLife) : '';
      const eol = eolName ? END_OF_LIFE.find(e => e.name.toLowerCase() === eolName.toLowerCase()) : null;
      product.parts.push({
        id: nextLineId++, name, materialId: material.id, weight,
        processId: process ? process.id : null, endOfLifeId: eol ? eol.id : 'none',
      });
      added++;
      continue;
    }

    // No catalog material fit -- if the AI supplied its own grounded per-kg estimate
    // (only offered when nothing in the reference data matched), add it as a custom
    // line instead of silently giving up, but clearly marked as unverified so it's
    // never mistaken for the vetted reference figures the catalog matches use.
    const est = s.estimate;
    const hasEstimate = est && typeof est === 'object' &&
      [est.ecoCost, est.co2e, est.water, est.energyIn].some(v => Number(v) > 0);
    if (!material && hasEstimate && hasWeight) {
      product.customLines.push({
        id: nextLineId++,
        name: `${name} (AI-estimated — not in reference data, verify before trusting)`,
        ecoCost: (Number(est.ecoCost) || 0) * weight,
        co2e: (Number(est.co2e) || 0) * weight,
        water: (Number(est.water) || 0) * weight,
        energyIn: (Number(est.energyIn) || 0) * weight,
      });
      estimated++;
      continue;
    }

    skipped.push(`${name} (${!material ? `no reference material for "${materialName || 'none given'}"` : 'missing/invalid weight'})`);
  }
  return { added, estimated, skipped };
}

// Live elapsed-time counter while an AI request is in flight — there's no real
// progress signal from a single completion call, so this counts up actual elapsed
// seconds against a rough typical-duration estimate, rather than a fake progress bar.
let aiTimerHandle = null;

function startAiTimer(estimateLabel) {
  stopAiTimer();
  const status = document.getElementById('ai-status');
  const startedAt = Date.now();
  const tick = () => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    status.textContent = `Thinking… ${elapsed}s elapsed (usually ${estimateLabel})`;
  };
  tick();
  aiTimerHandle = setInterval(tick, 1000);
}

function stopAiTimer() {
  if (aiTimerHandle) { clearInterval(aiTimerHandle); aiTimerHandle = null; }
}

// Backstop in case the server itself stalls (not just Groq, which the server already times
// out on its own end after 45s per call -- and it can now make up to 2 calls if the first one
// found named parts but gave no usable material/estimate for any of them, so worst case is
// closer to 90s) -- slightly longer than that, so the server's own clearer timeout message
// wins in the normal case and this is just a last resort.
async function fetchAiWithTimeout(url, options) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 100000);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (e) {
    if (e.name === 'AbortError') {
      return { ok: false, data: { error: 'This is taking far longer than expected (over 100s) and was cancelled on this end. The AI service may be overloaded — try again in a bit, or try a shorter description.' } };
    }
    return { ok: false, data: { error: 'Network error: ' + e.message } };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function extractPartsWithAI() {
  const textarea = document.getElementById('ai-description');
  const fileInput = document.getElementById('ai-file-input');
  const status = document.getElementById('ai-status');

  let ok, data;
  if (aiAttachedFile) {
    startAiTimer('5-15s for documents, up to 90s if it needs a second attempt');
    const formData = new FormData();
    formData.append('file', aiAttachedFile);
    ({ ok, data } = await fetchAiWithTimeout('/api/ai-extract-parts-from-file', { method: 'POST', body: formData, credentials: 'same-origin' }));
  } else {
    const description = textarea.value.trim();
    if (!description) { status.textContent = 'Describe the product or attach a file first.'; return; }
    startAiTimer('3-8s for text, up to 90s if it needs a second attempt');
    ({ ok, data } = await fetchAiWithTimeout('/api/ai-extract-parts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
      credentials: 'same-origin',
    }));
  }
  stopAiTimer();

  if (!ok) { status.textContent = data.error || 'AI extraction failed.'; return; }

  const { added, estimated, skipped } = applyAiPartSuggestions(Array.isArray(data.parts) ? data.parts : []);
  const handled = added + estimated;
  status.textContent = handled
    ? `AI added ${added} part(s) from the reference data${estimated ? ` and ${estimated} with its own estimated numbers (marked "AI-estimated" in the custom lines — review before trusting)` : ''}.${skipped.length ? ` Skipped: ${skipped.join('; ')}.` : ''}`
    : skipped.length
      ? `AI found ${skipped.length} part(s), but couldn't match or confidently estimate any of them: ${skipped.join('; ')}. Add these yourself via "Custom line item" below — it takes any material and impact numbers, not just what's in the dropdown.`
      : 'No usable parts found. Try describing the material and weight more explicitly.';
  if (handled) {
    textarea.value = '';
    fileInput.value = '';
    aiAttachedFile = null;
    activePresetKey = null;
    renderAll();
  }
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
// Briefly flashes a stat value green when it changes, so updates feel live rather
// than just silently different — skips the flash on first render (nothing to compare to).
function setStatValue(id, text) {
  const el = document.getElementById(id);
  const changed = el.textContent !== '' && el.textContent !== text;
  el.textContent = text;
  if (changed) {
    el.classList.remove('flash');
    void el.offsetWidth; // restart the CSS animation even if it's still running
    el.classList.add('flash');
  }
}

function renderOverview(items) {
  const totals = totalsFor(items);
  setStatValue('stat-ecoCost', fmtMetric(totals.ecoCost, 'ecoCost'));
  setStatValue('stat-co2e', fmtMetric(totals.co2e, 'co2e'));
  setStatValue('stat-water', fmtMetric(totals.water, 'water'));
  setStatValue('stat-energyIn', fmtMetric(totals.energyIn, 'energyIn'));
  setStatValue('stat-recycled', `${fmt(computeRecycledPct(), 1)}%`);
}

// --- Rendering: master ---
function renderAll() {
  renderParts();
  renderAssembly();
  renderTransport();
  renderCustom();
  renderTradeLines();

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

  renderOptimizationHints('ecoCost');
  renderOptimizationHints('co2e');
  renderOptimizationHints('water');
  renderOptimizationHints('energyIn');

  renderRecycledTab();
  renderSensitivityOptions();
  document.getElementById('sens-table').style.display = 'none';

  updateTransportPreview();
}

// --- Presets ---
function loadPreset(key) {
  const preset = PRESET_EXAMPLES[key];
  product = { parts: [], assembly: null, transportLegs: [], customLines: [], tradeLines: [] };
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

// --- Account: our own /api backend (Express + Turso), session via httpOnly cookie ---
let currentUser = null; // { id, email } or null when signed out

async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no JSON body, e.g. 204 */ }
  return { ok: res.ok, status: res.status, data: data || {} };
}

async function refreshCurrentUser() {
  const { ok, data } = await api('/api/me');
  currentUser = ok ? data.user : null;
  renderAccountUI();
}

function renderAccountUI() {
  document.getElementById('account-signed-out').style.display = currentUser ? 'none' : '';
  document.getElementById('account-signed-in').style.display = currentUser ? '' : 'none';
  if (currentUser) document.getElementById('auth-user-email').textContent = currentUser.email;

  const toggle = document.getElementById('account-toggle-btn');
  toggle.textContent = currentUser ? `👤 ${currentUser.email}` : '👤 Sign in';

  const hasLocalScenarios = loadLocalScenarios().length > 0;
  document.getElementById('auth-import-row').style.display = (currentUser && hasLocalScenarios) ? '' : 'none';

  document.getElementById('scenarios-storage-note').textContent = currentUser
    ? '(saved to your account)'
    : '(saved only in this browser — sign in via the account menu, top right, to save to your account)';
}

function toggleAccountMenu() {
  const menu = document.getElementById('account-menu');
  menu.style.display = menu.style.display === 'none' ? '' : 'none';
}

function closeAccountMenu() {
  document.getElementById('account-menu').style.display = 'none';
}

// Close the menu on outside click, without swallowing the toggle button's own click.
document.addEventListener('click', (e) => {
  const corner = document.getElementById('account-corner');
  if (corner && !corner.contains(e.target)) closeAccountMenu();
});

async function authSignUp() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const msg = document.getElementById('auth-message');
  if (!email || password.length < 6) { msg.textContent = 'Enter an email and a password of at least 6 characters.'; return; }
  msg.textContent = 'Signing up…';
  const { ok, data } = await api('/api/signup', { method: 'POST', body: { email, password } });
  if (!ok) { msg.textContent = data.error || 'Sign up failed.'; return; }
  currentUser = data.user;
  msg.textContent = '';
  renderAccountUI();
  closeAccountMenu();
  await renderScenarios();
}

async function authLogIn() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const msg = document.getElementById('auth-message');
  if (!email || !password) { msg.textContent = 'Enter your email and password.'; return; }
  msg.textContent = 'Logging in…';
  const { ok, data } = await api('/api/login', { method: 'POST', body: { email, password } });
  if (!ok) { msg.textContent = data.error || 'Log in failed.'; return; }
  currentUser = data.user;
  msg.textContent = '';
  renderAccountUI();
  closeAccountMenu();
  await renderScenarios();
}

async function authLogOut() {
  await api('/api/logout', { method: 'POST' });
  closeAccountMenu();
  currentUser = null;
  renderAccountUI();
  await renderScenarios();
}

async function importLocalScenarios() {
  if (!currentUser) return;
  const local = loadLocalScenarios();
  for (const s of local) {
    await api('/api/scenarios', {
      method: 'POST',
      body: { name: s.name, totals: scenarioTotals(s), recycledPct: s.recycledPct || 0, product: s.product },
    });
  }
  saveLocalScenarios([]);
  await renderScenarios();
  renderAccountUI();
}

// --- Scenarios: our /api backend when signed in, localStorage otherwise ---
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
    const { ok, data } = await api('/api/scenarios', { method: 'POST', body: { name, totals, recycledPct, product } });
    if (!ok) { alert('Could not save to your account: ' + (data.error || 'unknown error')); return; }
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
    await api(`/api/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } else {
    saveLocalScenarios(loadLocalScenarios().filter(s => s.id !== id));
  }
  await renderScenarios();
}

async function loadScenario(id) {
  let loadedProduct;
  if (currentUser) {
    const { ok, data } = await api(`/api/scenarios/${encodeURIComponent(id)}`);
    if (!ok) return;
    loadedProduct = data.scenario.product;
  } else {
    const scenario = loadLocalScenarios().find(s => s.id === id);
    if (!scenario) return;
    loadedProduct = scenario.product;
  }
  product = loadedProduct;
  if (!product.tradeLines) product.tradeLines = []; // scenarios saved before this feature existed
  nextLineId = Math.max(1, ...[...product.parts, ...product.transportLegs, ...product.customLines, ...product.tradeLines].map(x => x.id + 1));
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
    const { ok, data } = await api('/api/scenarios');
    scenarios = ok ? data.scenarios : [];
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
document.getElementById('currency-select').value = currentCurrency;
ensureExchangeRates().then(() => {
  document.getElementById('currency-select').value = currentCurrency; // may have fallen back to EUR
  updateCurrencyNote();
  refreshRateLabels();
  renderAll();
});
renderAll();
renderAccountUI();
refreshCurrentUser().then(renderScenarios);
showTab('home');
