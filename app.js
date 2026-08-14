// --- App state ---
let product = { parts: [], assembly: null, transportLegs: [], customLines: [] };
let nextLineId = 1;
let activePresetKey = null; // set when a preset is loaded, so we can show the validation check

const SCENARIOS_KEY = 'ecocost_scenarios';

function fmt(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function findById(list, id) { return list.find(x => x.id === id); }

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

  const energySelect = document.getElementById('assembly-energy');
  energySelect.innerHTML = ENERGY.map(e => `<option value="${e.id}">${e.name} (€${e.ecoCost}/MJ)</option>`).join('');

  const transportSelect = document.getElementById('transport-mode');
  transportSelect.innerHTML = TRANSPORT.map(t => `<option value="${t.id}">${t.name} (€${t.ecoCost}/tkm)</option>`).join('');
  document.getElementById('transport-distance').addEventListener('input', updateTransportPreview);
  transportSelect.addEventListener('change', updateTransportPreview);
  updateTransportPreview();
}

function renderMaterialOptions() {
  const category = document.getElementById('part-category').value;
  const inCategory = MATERIALS.filter(m => m.category === category);
  populateSelect(document.getElementById('part-material'), inCategory, 'id', m => `${m.name} (€${m.ecoCost}/kg)`);
}

// --- Adding line items ---
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
  activePresetKey = null;
  renderAll();
}

function removeAssembly() {
  product.assembly = null;
  activePresetKey = null;
  renderAll();
}

function totalPartsWeight() {
  return product.parts.reduce((sum, p) => sum + p.weight, 0);
}

function clearProduct() {
  product = { parts: [], assembly: null, transportLegs: [], customLines: [] };
  activePresetKey = null;
  renderAll();
}

// --- Calculation ---
function computeLineItems() {
  const items = [];

  for (const part of product.parts) {
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

  if (product.assembly) {
    const energy = findById(ENERGY, product.assembly.energyId);
    const mj = product.assembly.mjPerKg * totalPartsWeight();
    items.push({
      label: 'Assembly energy',
      detail: `${product.assembly.mjPerKg} MJ/kg × ${totalPartsWeight()} kg = ${mj.toFixed(3)} MJ × ${energy.name} (€${energy.ecoCost}/MJ)`,
      ecoCost: mj * energy.ecoCost,
      kind: 'assembly',
    });
  }

  for (const leg of product.transportLegs) {
    const transport = findById(TRANSPORT, leg.transportId);
    items.push({
      label: `Transport: ${transport.name}`,
      detail: `${leg.tkm.toFixed(4)} tkm × €${transport.ecoCost}/tkm (${leg.distanceKm} km)`,
      ecoCost: leg.tkm * transport.ecoCost,
      kind: 'transport',
    });
  }

  for (const custom of product.customLines) {
    items.push({ label: custom.name, detail: 'Custom eco-cost', ecoCost: custom.ecoCost, kind: 'custom' });
  }

  return items;
}

// --- Rendering ---
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

function renderResults() {
  const items = computeLineItems();
  const empty = document.getElementById('results-empty');
  const body = document.getElementById('results-body');
  if (!items.length) {
    empty.style.display = '';
    body.style.display = 'none';
    document.getElementById('preset-check').style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  body.style.display = '';

  const total = items.reduce((sum, i) => sum + i.ecoCost, 0);
  const maxAbs = Math.max(...items.map(i => Math.abs(i.ecoCost)), 0.0001);
  const sorted = [...items].sort((a, b) => Math.abs(b.ecoCost) - Math.abs(a.ecoCost));
  const hotspotLabel = sorted.find(i => i.ecoCost > 0)?.label;

  document.getElementById('results-tbody').innerHTML = items.map(i => `
    <tr class="${i.label === hotspotLabel ? 'row-hotspot' : ''}">
      <td>${i.label}${i.label === hotspotLabel ? ' <span class="hotspot-badge">🔥 hotspot</span>' : ''}</td>
      <td class="detail-cell">${i.detail}</td>
      <td class="num">${fmt(i.ecoCost)}</td>
    </tr>`).join('');
  document.getElementById('results-total').textContent = `€${fmt(total)}`;

  document.getElementById('hotspot-chart').innerHTML = sorted.map(i => {
    const pct = (Math.abs(i.ecoCost) / maxAbs) * 100;
    const barClass = i.ecoCost < 0 ? 'bar-credit' : 'bar-burden';
    return `<div class="chart-row">
      <span class="chart-label">${i.label}</span>
      <div class="chart-track"><div class="chart-bar ${barClass}" style="width:${pct}%"></div></div>
      <span class="chart-value">€${fmt(i.ecoCost)}</span>
    </div>`;
  }).join('');

  renderPresetCheck(total);
}

function renderPresetCheck(total) {
  const el = document.getElementById('preset-check');
  if (!activePresetKey) { el.style.display = 'none'; return; }
  const preset = PRESET_EXAMPLES[activePresetKey];
  const diff = Math.abs(total - preset.expectedTotal);
  const withinTolerance = diff <= 0.10;
  el.style.display = '';
  el.className = 'preset-check ' + (withinTolerance ? 'preset-check-ok' : 'preset-check-fail');
  el.innerHTML = `${withinTolerance ? '✓' : '⚠'} Reference total for "${preset.name}": €${fmt(preset.expectedTotal)}.
    This calculator computed €${fmt(total)} (difference €${fmt(diff)}, from source figures pre-rounded to 2 decimals).`;
}

function renderAll() {
  renderParts();
  renderAssembly();
  renderTransport();
  renderCustom();
  renderResults();
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
      product.customLines.push({ id: nextLineId++, name: c.name, ecoCost: c.ecoCost });
    }
  }
  activePresetKey = key;
  renderAll();
}

// --- Scenarios (localStorage) ---
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
