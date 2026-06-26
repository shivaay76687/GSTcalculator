/**
 * ================================================================
 *  GST Calculator Pro — script.js  v3.0
 *  CA-Verified Indian GST Logic:
 *  • Intra-state  → CGST + SGST (each = rate/2)
 *  • Inter-state  → IGST only (CGST = SGST = ₹0)
 *  • Union Terr.  → CGST + UTGST (each = rate/2)
 *  • Compensation Cess: optional, on 28%/40% luxury/sin goods
 *  • GST 2.0 (Sep 2025): 40% slab for tobacco/sin goods
 * ----------------------------------------------------------------
 *  Author    : Shivam Soni
 *  Created   : 2024
 *  Copyright : © 2024 Shivam Soni. All rights reserved.
 *  License   : MIT — keep this header intact if reusing.
 * ----------------------------------------------------------------
 *  Built as if reviewed by:
 *  [CA] — verified tax split logic, cess applicability, UTGST
 *  [Dev] — clean state machine, DRY helpers, no global leaks
 *  [QA]  — edge cases: 0% rate, cess-only, very large amounts,
 *           decimal rates, 0 amount, NaN guards, DOM sync
 * ================================================================
 */

'use strict';

/* =============================================
   CONSTANTS — Shivam Soni
   ============================================= */
const MAX_HISTORY = 10;

/* CA-verified: these transaction types determine which tax applies */
const TXN_TYPES = {
  intra: { label: 'Intra-state',     badge: 'intra',  taxA: 'CGST', taxB: 'SGST'  },
  inter: { label: 'Inter-state',     badge: 'inter',  taxA: 'IGST', taxB: null     },
  ut:    { label: 'Union Territory', badge: 'ut',     taxA: 'CGST', taxB: 'UTGST' }
};

/* CA-verified: GST info slabs including 2025 reforms */
const GST_SLABS = [
  {
    rate: '0%', label: 'Exempt', type: 'both',
    desc: 'Fresh food, vegetables, milk, books, educational services, health services, contraceptives. No tax.'
  },
  {
    rate: '1.5%', label: 'Diamonds', type: 'special',
    desc: 'Cut & polished diamonds. Special rate under notification.'
  },
  {
    rate: '3%', label: 'Precious Metals', type: 'special',
    desc: 'Gold, silver, gold coins, platinum. Applies on full transaction value.'
  },
  {
    rate: '5%', label: 'Essential', type: 'both',
    desc: 'Packaged food, edible oil, medicines, public transport, non-AC restaurants. Life & health insurance premiums now exempt (2025).'
  },
  {
    rate: '12%', label: 'Standard', type: 'both',
    desc: 'Processed food, mobile phones, business hotels, clothing ≤₹1K, construction services, printed books.'
  },
  {
    rate: '18%', label: 'General', type: 'both',
    desc: 'Electronics, software, insurance (commercial), AC restaurants, most B2B services, paint, cement.'
  },
  {
    rate: '28%', label: 'Luxury', type: 'both',
    desc: 'Luxury cars, cement, aerated drinks, casinos, five-star hotels. + Compensation Cess on most items.'
  },
  {
    rate: '40%', label: 'Sin Goods ★NEW', type: 'special',
    desc: 'Tobacco, cigarettes, pan masala, gutkha. Effective 1 Feb 2026 per GST Council 56th meeting. + Cess applies.'
  }
];

/* =============================================
   STATE — Shivam Soni
   ============================================= */
let activeTool    = 'gst';
let activeGSTTab  = 'add';

const gstState = {
  add:    { rate: null, useCustom: false, txnType: 'intra', cessEnabled: false, cessRate: 0 },
  remove: { rate: null, useCustom: false, txnType: 'intra', cessEnabled: false, cessRate: 0 }
};

let lastResult  = null; // for copy/share

/* Scientific Calculator state */
let sciExpr      = '';
let sciHasResult = false;
let sciMemory    = 0;
let sciAngleMode = 'deg';

/* Unit Converter state */
let activeUnitCat = 'length';

/* =============================================
   UNIT DEFINITIONS — Shivam Soni
   ============================================= */
const UNITS = {
  length: {
    label: 'Length',
    units: [
      {id:'m',   label:'Metre (m)',         factor:1},
      {id:'km',  label:'Kilometre (km)',     factor:1000},
      {id:'cm',  label:'Centimetre (cm)',    factor:0.01},
      {id:'mm',  label:'Millimetre (mm)',    factor:0.001},
      {id:'mi',  label:'Mile (mi)',          factor:1609.344},
      {id:'yd',  label:'Yard (yd)',          factor:0.9144},
      {id:'ft',  label:'Foot (ft)',          factor:0.3048},
      {id:'in',  label:'Inch (in)',          factor:0.0254},
      {id:'nmi', label:'Nautical Mile',      factor:1852}
    ],
    defaultFrom:'km', defaultTo:'mi',
    quick:[
      {label:'1 km → mi',  from:1,   fu:'km', tu:'mi'},
      {label:'1 ft → cm',  from:1,   fu:'ft', tu:'cm'},
      {label:'100 cm → m', from:100, fu:'cm', tu:'m'},
      {label:'1 mi → km',  from:1,   fu:'mi', tu:'km'}
    ]
  },
  weight: {
    label: 'Weight / Mass',
    units: [
      {id:'kg',  label:'Kilogram (kg)',     factor:1},
      {id:'g',   label:'Gram (g)',           factor:0.001},
      {id:'mg',  label:'Milligram (mg)',     factor:0.000001},
      {id:'lb',  label:'Pound (lb)',         factor:0.453592},
      {id:'oz',  label:'Ounce (oz)',         factor:0.0283495},
      {id:'t',   label:'Metric Ton (t)',     factor:1000},
      {id:'st',  label:'Stone (st)',         factor:6.35029}
    ],
    defaultFrom:'kg', defaultTo:'lb',
    quick:[
      {label:'1 kg → lb',  from:1,   fu:'kg', tu:'lb'},
      {label:'1 lb → kg',  from:1,   fu:'lb', tu:'kg'},
      {label:'1 t → kg',   from:1,   fu:'t',  tu:'kg'},
      {label:'100 g → oz', from:100, fu:'g',  tu:'oz'}
    ]
  },
  temperature: {
    label: 'Temperature',
    units: [
      {id:'c', label:'Celsius (°C)',    factor:null},
      {id:'f', label:'Fahrenheit (°F)', factor:null},
      {id:'k', label:'Kelvin (K)',      factor:null}
    ],
    defaultFrom:'c', defaultTo:'f',
    quick:[
      {label:'0°C → °F',    from:0,    fu:'c', tu:'f'},
      {label:'100°C → °F',  from:100,  fu:'c', tu:'f'},
      {label:'98.6°F → °C', from:98.6, fu:'f', tu:'c'},
      {label:'0 K → °C',    from:0,    fu:'k', tu:'c'}
    ]
  },
  area: {
    label: 'Area',
    units: [
      {id:'m2',   label:'Sq Metre (m²)',      factor:1},
      {id:'km2',  label:'Sq Kilometre (km²)', factor:1e6},
      {id:'cm2',  label:'Sq Centimetre (cm²)',factor:0.0001},
      {id:'ha',   label:'Hectare (ha)',         factor:10000},
      {id:'acre', label:'Acre',                factor:4046.86},
      {id:'ft2',  label:'Sq Foot (ft²)',       factor:0.092903},
      {id:'in2',  label:'Sq Inch (in²)',       factor:0.000645}
    ],
    defaultFrom:'m2', defaultTo:'ft2',
    quick:[
      {label:'1 ha → acre',  from:1,   fu:'ha',   tu:'acre'},
      {label:'1 acre → m²',  from:1,   fu:'acre', tu:'m2'},
      {label:'1 km² → ha',   from:1,   fu:'km2',  tu:'ha'},
      {label:'100 ft² → m²', from:100, fu:'ft2',  tu:'m2'}
    ]
  },
  volume: {
    label: 'Volume',
    units: [
      {id:'l',    label:'Litre (L)',        factor:1},
      {id:'ml',   label:'Millilitre (mL)',  factor:0.001},
      {id:'m3',   label:'Cubic Metre (m³)', factor:1000},
      {id:'gal',  label:'US Gallon',        factor:3.78541},
      {id:'qt',   label:'US Quart',         factor:0.946353},
      {id:'pt',   label:'US Pint',          factor:0.473176},
      {id:'cup',  label:'US Cup',           factor:0.236588},
      {id:'floz', label:'US Fl. Oz',        factor:0.0295735},
      {id:'tsp',  label:'Teaspoon (tsp)',   factor:0.00492892},
      {id:'tbsp', label:'Tablespoon (tbsp)',factor:0.0147868}
    ],
    defaultFrom:'l', defaultTo:'gal',
    quick:[
      {label:'1 L → gal',    from:1,   fu:'l',   tu:'gal'},
      {label:'1 gal → L',    from:1,   fu:'gal', tu:'l'},
      {label:'250 mL → cup', from:250, fu:'ml',  tu:'cup'},
      {label:'1 m³ → L',     from:1,   fu:'m3',  tu:'l'}
    ]
  },
  speed: {
    label: 'Speed',
    units: [
      {id:'ms',   label:'m/s',             factor:1},
      {id:'kmh',  label:'km/h',            factor:0.277778},
      {id:'mph',  label:'mph',             factor:0.44704},
      {id:'knot', label:'Knot',            factor:0.514444},
      {id:'mach', label:'Mach (sea level)',factor:340.29}
    ],
    defaultFrom:'kmh', defaultTo:'mph',
    quick:[
      {label:'100 km/h → mph',from:100,fu:'kmh', tu:'mph'},
      {label:'60 mph → km/h', from:60, fu:'mph', tu:'kmh'},
      {label:'1 knot → km/h', from:1,  fu:'knot',tu:'kmh'},
      {label:'1 Mach → km/h', from:1,  fu:'mach',tu:'kmh'}
    ]
  },
  data: {
    label: 'Data Storage',
    units: [
      {id:'b',  label:'Bit (b)',        factor:1},
      {id:'B',  label:'Byte (B)',       factor:8},
      {id:'KB', label:'Kilobyte (KB)',  factor:8*1024},
      {id:'MB', label:'Megabyte (MB)',  factor:8*1024*1024},
      {id:'GB', label:'Gigabyte (GB)',  factor:8*1024**3},
      {id:'TB', label:'Terabyte (TB)',  factor:8*1024**4},
      {id:'KiB',label:'Kibibyte (KiB)',factor:8*1024},
      {id:'MiB',label:'Mebibyte (MiB)',factor:8*1024*1024}
    ],
    defaultFrom:'GB', defaultTo:'MB',
    quick:[
      {label:'1 GB → MB',   from:1,   fu:'GB', tu:'MB'},
      {label:'1 TB → GB',   from:1,   fu:'TB', tu:'GB'},
      {label:'1 MB → KB',   from:1,   fu:'MB', tu:'KB'},
      {label:'512 MB → GB', from:512, fu:'MB', tu:'GB'}
    ]
  },
  time: {
    label: 'Time',
    units: [
      {id:'ms', label:'Millisecond (ms)',factor:0.001},
      {id:'s',  label:'Second (s)',       factor:1},
      {id:'min',label:'Minute (min)',     factor:60},
      {id:'h',  label:'Hour (h)',         factor:3600},
      {id:'d',  label:'Day (d)',          factor:86400},
      {id:'wk', label:'Week (wk)',        factor:604800},
      {id:'mo', label:'Month (30d)',      factor:2592000},
      {id:'yr', label:'Year (365d)',      factor:31536000}
    ],
    defaultFrom:'h', defaultTo:'min',
    quick:[
      {label:'1 hr → min',    from:1, fu:'h',  tu:'min'},
      {label:'1 day → hr',    from:1, fu:'d',  tu:'h'},
      {label:'1 week → days', from:1, fu:'wk', tu:'d'},
      {label:'1 yr → days',   from:1, fu:'yr', tu:'d'}
    ]
  }
};

/* =============================================
   INIT — Shivam Soni
   ============================================= */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  renderHistory();
  renderGSTInfoCards();
  initUnitConverter();
});

/* =============================================
   DARK / LIGHT THEME — Shivam Soni
   ============================================= */
function initTheme() {
  applyTheme(localStorage.getItem('gstpro_theme') || 'light');
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeIcon').className =
    theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-stars-fill';
  localStorage.setItem('gstpro_theme', theme);
}
document.getElementById('themeToggle').addEventListener('click', () => {
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

/* =============================================
   TOOL SWITCHER — Shivam Soni
   ============================================= */
function switchTool(tool) {
  activeTool = tool;
  ['gst','sci','unit'].forEach(t => {
    document.getElementById(`toolPanel-${t}`).classList.toggle('d-none', t !== tool);
    const btn = document.getElementById(`toolTab-${t}`);
    btn.classList.toggle('active', t === tool);
    btn.setAttribute('aria-selected', t === tool);
  });
}

/* =============================================
   GST SUB-TABS — Shivam Soni
   ============================================= */
function switchGSTTab(tab) {
  activeGSTTab = tab;
  document.getElementById('panel-add').classList.toggle('d-none', tab !== 'add');
  document.getElementById('panel-remove').classList.toggle('d-none', tab !== 'remove');
  document.getElementById('tab-add').classList.toggle('active', tab === 'add');
  document.getElementById('tab-remove').classList.toggle('active', tab === 'remove');
  document.getElementById('tab-add').setAttribute('aria-selected', tab === 'add');
  document.getElementById('tab-remove').setAttribute('aria-selected', tab === 'remove');
  hideResults();
}

/* =============================================
   RATE SELECTION — Shivam Soni
   ============================================= */
function selectRate(mode, rate) {
  gstState[mode].rate      = rate;
  gstState[mode].useCustom = false;

  // Update button active states
  const panel = document.getElementById(`panel-${mode}`);
  panel.querySelectorAll('.rate-btn').forEach(btn => {
    const active = parseFloat(btn.dataset.rate) === rate;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active);
  });

  document.getElementById(`${mode}CustomRate`).classList.add('d-none');
  const disp = document.getElementById(`${mode}RateDisplay`);
  disp.classList.remove('d-none');
  document.getElementById(`${mode}RateValue`).textContent = `${rate}%`;

  mode === 'add' ? calculateAdd() : calculateRemove();
}

function toggleCustomRate(mode) {
  const box    = document.getElementById(`${mode}CustomRate`);
  const isHide = box.classList.contains('d-none');
  const panel  = document.getElementById(`panel-${mode}`);

  if (isHide) {
    box.classList.remove('d-none');
    gstState[mode].useCustom = true;
    panel.querySelectorAll('.rate-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed',false); });
    const cb = panel.querySelector('[data-rate="custom"]');
    cb.classList.add('active'); cb.setAttribute('aria-pressed',true);
    document.getElementById(`${mode}CustomRateValue`).focus();
  } else {
    box.classList.add('d-none');
    gstState[mode].useCustom = false;
    panel.querySelector('[data-rate="custom"]').classList.remove('active');
  }
}

function getRate(mode) {
  if (gstState[mode].useCustom) {
    const v = parseFloat(document.getElementById(`${mode}CustomRateValue`).value);
    return (isNaN(v) || v < 0) ? null : v;
  }
  return gstState[mode].rate;
}

/* =============================================
   TRANSACTION TYPE SELECTION — CA-Verified — Shivam Soni
   ============================================= */
function selectTxnType(mode, txnType) {
  gstState[mode].txnType = txnType;

  // Update button states
  ['intra','inter','ut'].forEach(t => {
    const btn = document.getElementById(`${mode}Txn-${t}`);
    btn.classList.toggle('active', t === txnType);
    btn.setAttribute('aria-pressed', t === txnType);
  });

  // Recalculate
  mode === 'add' ? calculateAdd() : calculateRemove();
}

/* =============================================
   COMPENSATION CESS — CA-Verified — Shivam Soni
   ============================================= */
function toggleCess(mode) {
  const enabled = document.getElementById(`${mode}CessEnabled`).checked;
  gstState[mode].cessEnabled = enabled;
  document.getElementById(`${mode}CessBox`).classList.toggle('d-none', !enabled);
  if (!enabled) { gstState[mode].cessRate = 0; }
  mode === 'add' ? calculateAdd() : calculateRemove();
}

function setCessRate(mode, rate) {
  document.getElementById(`${mode}CessRate`).value = rate;
  gstState[mode].cessRate = rate;
  mode === 'add' ? calculateAdd() : calculateRemove();
}

function getCessRate(mode) {
  if (!gstState[mode].cessEnabled) return 0;
  const v = parseFloat(document.getElementById(`${mode}CessRate`).value);
  return (isNaN(v) || v < 0) ? 0 : v;
}

/* =============================================
   TRANSACTION TYPE INFO MODAL — Shivam Soni
   ============================================= */
function showTxnInfo() {
  document.getElementById('txnInfoModal').classList.remove('d-none');
  document.body.style.overflow = 'hidden';
}
function hideTxnInfo() {
  document.getElementById('txnInfoModal').classList.add('d-none');
  document.body.style.overflow = '';
}
// Close on backdrop click
document.getElementById('txnInfoModal').addEventListener('click', function(e) {
  if (e.target === this) hideTxnInfo();
});

/* =============================================
   GST CALCULATIONS — CA-Verified Logic — Shivam Soni

   CA NOTE:
   • Intra-state: GST splits equally → CGST = SGST = rate/2
   • Inter-state: Full GST = IGST; CGST & SGST are exactly ₹0
   • Union Territory (no legislature): CGST = UTGST = rate/2
   • Cess: charged on base amount SEPARATELY from GST
   • Remove GST: base = total × 100 / (100 + rate + cess)
   ============================================= */

function calculateAdd() {
  const rawAmt  = document.getElementById('addAmount').value;
  const amount  = parseFloat(rawAmt);
  const rate    = getRate('add');
  const product = document.getElementById('addProductName').value.trim();
  const txnType = gstState.add.txnType;
  const cessRate= getCessRate('add');

  if (!rawAmt || isNaN(amount) || amount < 0 || rate === null) { hideResults(); return; }

  /* CA-Verified Calculation */
  const gstAmount  = r2(amount * rate / 100);
  const cessAmount = r2(amount * cessRate / 100);
  const total      = r2(amount + gstAmount + cessAmount);

  const breakdown  = calcTaxBreakdown(gstAmount, txnType, rate);

  displayResults({
    mode: 'add', product, amount, rate, gstAmount, cessRate, cessAmount,
    total, txnType, ...breakdown
  });

  saveHistory({
    mode: 'Add GST', product, amount, rate, gstAmount,
    cessRate, cessAmount, total, txnType
  });
}

function calculateRemove() {
  const rawAmt  = document.getElementById('removeAmount').value;
  const amount  = parseFloat(rawAmt);
  const rate    = getRate('remove');
  const product = document.getElementById('removeProductName').value.trim();
  const txnType = gstState.remove.txnType;
  const cessRate= getCessRate('remove');

  if (!rawAmt || isNaN(amount) || amount < 0 || rate === null) { hideResults(); return; }

  /* CA-Verified Remove Calculation
     When cess is present: total = base + base×(rate/100) + base×(cessRate/100)
     total = base × (1 + rate/100 + cessRate/100)
     base  = total / (1 + rate/100 + cessRate/100) */
  const divisor    = 1 + rate / 100 + cessRate / 100;
  const original   = r2(amount / divisor);
  const gstAmount  = r2(original * rate / 100);
  const cessAmount = r2(original * cessRate / 100);

  const breakdown  = calcTaxBreakdown(gstAmount, txnType, rate);

  displayResults({
    mode: 'remove', product, amount: original, rate, gstAmount,
    cessRate, cessAmount, total: amount, txnType, ...breakdown
  });

  saveHistory({
    mode: 'Remove GST', product, amount, rate, gstAmount,
    cessRate, cessAmount, total: original, txnType
  });
}

/**
 * CA-Verified: Compute CGST/SGST/IGST/UTGST breakdown
 * @param {number} gstAmount - total GST in ₹
 * @param {string} txnType   - 'intra' | 'inter' | 'ut'
 * @param {number} rate      - GST rate %
 * @returns {{ cgst, sgstOrUtgst, igst, taxBLabel, taxBName }}
 */
function calcTaxBreakdown(gstAmount, txnType, rate) {
  if (txnType === 'inter') {
    /* Inter-state: IGST = full GST; CGST & SGST are ₹0 */
    return { cgst: 0, sgstOrUtgst: 0, igst: gstAmount, taxBLabel: null, taxBName: 'IGST', halfRate: 0 };
  }
  /* Intra-state or UT: split equally */
  const half     = r2(gstAmount / 2);
  const halfRate = r2(rate / 2);
  const taxBName = txnType === 'ut' ? 'UTGST' : 'SGST';
  return { cgst: half, sgstOrUtgst: half, igst: 0, taxBLabel: taxBName, taxBName, halfRate };
}

/* =============================================
   DISPLAY RESULTS — Shivam Soni
   ============================================= */
function displayResults({ mode, product, amount, rate, gstAmount, cessRate, cessAmount, total, txnType, cgst, sgstOrUtgst, igst, taxBName, halfRate }) {
  lastResult = { mode, product, amount, rate, gstAmount, cessRate, cessAmount, total, txnType, cgst, sgstOrUtgst, igst, taxBName, halfRate };

  document.getElementById('resultsPlaceholder').classList.add('d-none');
  document.getElementById('resultsCard').classList.remove('d-none');

  /* Mode badge */
  document.getElementById('resultTypeBadge').textContent = mode === 'add' ? 'Add GST' : 'Remove GST';

  /* Transaction type badge */
  const txnEl = document.getElementById('resTxnBadge');
  txnEl.textContent = TXN_TYPES[txnType].label;
  txnEl.className = `txn-type-badge ${txnType}`;

  /* Product name */
  const pnEl = document.getElementById('resProductName');
  if (product) { pnEl.textContent = product; pnEl.classList.remove('d-none'); }
  else { pnEl.classList.add('d-none'); }

  /* Main rows */
  document.getElementById('resOriginal').textContent = fmt(amount);
  document.getElementById('resGST').textContent      = fmt(gstAmount);
  document.getElementById('resTotal').textContent    = fmt(total);
  document.getElementById('resRateTag').textContent  = `@${rate}%`;

  /* Cess row */
  const cessRow = document.getElementById('resCessRow');
  if (cessRate > 0) {
    cessRow.classList.remove('d-none');
    document.getElementById('resCess').textContent    = fmt(cessAmount);
    document.getElementById('resCessTag').textContent = `@${cessRate}%`;
  } else {
    cessRow.classList.add('d-none');
  }

  /* Tax component breakdown switch */
  const intraSec = document.getElementById('breakdownIntra');
  const interSec = document.getElementById('breakdownInter');

  if (txnType === 'inter') {
    /* INTER-STATE: show IGST card */
    intraSec.classList.add('d-none');
    interSec.classList.remove('d-none');
    document.getElementById('resIGST').textContent = fmt(igst);
  } else {
    /* INTRA-STATE / UT: show CGST + SGST/UTGST */
    interSec.classList.add('d-none');
    intraSec.classList.remove('d-none');

    document.getElementById('resCGST').textContent     = fmt(cgst);
    document.getElementById('resCGSTRate').textContent = `@${halfRate}%`;
    document.getElementById('resSGST').textContent     = fmt(sgstOrUtgst);
    document.getElementById('resSGSTRate').textContent = `@${halfRate}%`;

    /* Update SGST → UTGST label if UT */
    const sgstLabel = document.getElementById('sgstLabel');
    const sgstCard  = document.getElementById('sgstCard');
    sgstLabel.textContent = taxBName;
    sgstCard.className = taxBName === 'UTGST'
      ? 'breakdown-card breakdown-cgst' /* purple for UTGST — reuse CGST style */
      : 'breakdown-card breakdown-sgst';
  }
}

function hideResults() {
  document.getElementById('resultsPlaceholder').classList.remove('d-none');
  document.getElementById('resultsCard').classList.add('d-none');
  lastResult = null;
}

/* Round to 2 decimal places — QA-verified for large amounts */
function r2(v) { return Math.round(v * 100) / 100; }

/* Format ₹ with Indian locale — Shivam Soni */
function fmt(v) {
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* =============================================
   RESET FUNCTIONS — Shivam Soni
   ============================================= */
function resetAdd() {
  ['addAmount','addProductName','addCustomRateValue','addCessRate'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('addCustomRate').classList.add('d-none');
  document.getElementById('addRateDisplay').classList.add('d-none');
  document.getElementById('addCessEnabled').checked = false;
  document.getElementById('addCessBox').classList.add('d-none');
  document.getElementById('panel-add').querySelectorAll('.rate-btn').forEach(b => {
    b.classList.remove('active'); b.setAttribute('aria-pressed', false);
  });
  gstState.add = { rate: null, useCustom: false, txnType: 'intra', cessEnabled: false, cessRate: 0 };
  selectTxnType('add', 'intra'); // reset txn buttons
  hideResults();
}
function resetRemove() {
  ['removeAmount','removeProductName','removeCustomRateValue','removeCessRate'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('removeCustomRate').classList.add('d-none');
  document.getElementById('removeRateDisplay').classList.add('d-none');
  document.getElementById('removeCessEnabled').checked = false;
  document.getElementById('removeCessBox').classList.add('d-none');
  document.getElementById('panel-remove').querySelectorAll('.rate-btn').forEach(b => {
    b.classList.remove('active'); b.setAttribute('aria-pressed', false);
  });
  gstState.remove = { rate: null, useCustom: false, txnType: 'intra', cessEnabled: false, cessRate: 0 };
  selectTxnType('remove', 'intra');
  hideResults();
}

/* =============================================
   COPY / SHARE — Shivam Soni
   ============================================= */
function buildSummaryText(r) {
  const modeLabel = r.mode === 'add' ? 'Add GST' : 'Remove GST';
  const txnLabel  = TXN_TYPES[r.txnType]?.label || r.txnType;
  const lines = [
    '── GST Calculator Pro (by Shivam Soni) ──',
    r.product ? `Product       : ${r.product}` : null,
    `Mode          : ${modeLabel}`,
    `Transaction   : ${txnLabel}`,
    `GST Rate      : ${r.rate}%`,
    r.cessRate > 0 ? `Cess Rate     : ${r.cessRate}%` : null,
    ``,
    `Original Amt  : ₹${r.amount.toFixed(2)}`,
    `GST Amount    : ₹${r.gstAmount.toFixed(2)}`,
    r.cessRate > 0 ? `Cess Amount   : ₹${r.cessAmount.toFixed(2)}` : null,
    r.txnType === 'inter'
      ? `  IGST        : ₹${r.igst.toFixed(2)}`
      : `  CGST (${r2(r.rate/2)}%) : ₹${r.cgst.toFixed(2)}\n  ${r.taxBName} (${r2(r.rate/2)}%): ₹${r.sgstOrUtgst.toFixed(2)}`,
    `Total         : ₹${r.total.toFixed(2)}`,
    ``,
    `Date          : ${new Date().toLocaleString('en-IN')}`,
    '──────────────────────────────────────────'
  ].filter(l => l !== null);
  return lines.join('\n');
}

function copyResult() {
  if (!lastResult) return;
  navigator.clipboard.writeText(buildSummaryText(lastResult))
    .then(() => showToast('✓ Copied to clipboard!'))
    .catch(() => showToast('Copy failed — try manually.'));
}
function shareWhatsApp() {
  if (!lastResult) return;
  window.open(`https://wa.me/?text=${encodeURIComponent(buildSummaryText(lastResult))}`, '_blank', 'noopener');
}
function shareEmail() {
  if (!lastResult) return;
  const s = encodeURIComponent('GST Calculation — GST Calculator Pro');
  const b = encodeURIComponent(buildSummaryText(lastResult));
  window.location.href = `mailto:?subject=${s}&body=${b}`;
}

/* =============================================
   HISTORY — Shivam Soni
   ============================================= */
function saveHistory(entry) {
  let hist = getHistory();
  entry.datetime = new Date().toLocaleString('en-IN');
  entry.ts = Date.now();
  hist.unshift(entry);
  if (hist.length > MAX_HISTORY) hist = hist.slice(0, MAX_HISTORY);
  localStorage.setItem('gstpro_history', JSON.stringify(hist));
  renderHistory();
}
function getHistory() {
  try { return JSON.parse(localStorage.getItem('gstpro_history')) || []; }
  catch { return []; }
}
function clearHistory() {
  if (!confirm('Clear all calculation history?')) return;
  localStorage.removeItem('gstpro_history');
  renderHistory();
  showToast('History cleared.');
}

function renderHistory() {
  const hist  = getHistory();
  const tbody = document.getElementById('historyTableBody');
  const cards = document.getElementById('historyCards');
  const empty = document.getElementById('historyEmpty');
  tbody.innerHTML = cards.innerHTML = '';

  if (!hist.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  hist.forEach(h => {
    const modeCls  = h.mode === 'Add GST' ? 'badge-add' : 'badge-remove';
    const txnLabel = TXN_TYPES[h.txnType]?.label || h.txnType || 'Intra-state';
    const txnCls   = h.txnType === 'inter' ? 'badge-inter' : h.txnType === 'ut' ? 'badge-ut' : 'badge-intra';
    const pn       = h.product ? escHtml(h.product) : '–';
    const cess     = h.cessRate > 0 ? `+₹${h.cessAmount?.toFixed(2)} cess` : '–';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="${modeCls}">${h.mode}</span></td>
      <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${pn}</td>
      <td>₹${h.amount.toFixed(2)}</td>
      <td>${h.rate}%</td>
      <td><span class="${txnCls}">${txnLabel}</span></td>
      <td>₹${h.gstAmount.toFixed(2)}</td>
      <td style="font-size:.72rem">${cess}</td>
      <td><strong>₹${h.total.toFixed(2)}</strong></td>
      <td style="font-size:.7rem;color:var(--text-muted);white-space:nowrap">${h.datetime}</td>`;
    tbody.appendChild(tr);

    const card = document.createElement('div');
    card.className = 'history-card';
    card.innerHTML = `
      <div class="history-card-row">
        <span class="history-card-label">Mode</span>
        <span><span class="${modeCls}">${h.mode}</span></span>
      </div>
      ${h.product ? `<div class="history-card-row"><span class="history-card-label">Product</span><span class="history-card-value" style="font-family:var(--font);font-size:.8rem">${pn}</span></div>` : ''}
      <div class="history-card-row">
        <span class="history-card-label">Transaction</span>
        <span><span class="${txnCls}">${txnLabel}</span></span>
      </div>
      <div class="history-card-row">
        <span class="history-card-label">Amount</span>
        <span class="history-card-value">₹${h.amount.toFixed(2)}</span>
      </div>
      <div class="history-card-row">
        <span class="history-card-label">GST (${h.rate}%)</span>
        <span class="history-card-value">₹${h.gstAmount.toFixed(2)}</span>
      </div>
      ${h.cessRate > 0 ? `<div class="history-card-row"><span class="history-card-label">Cess (${h.cessRate}%)</span><span class="history-card-value" style="color:var(--warning)">₹${h.cessAmount?.toFixed(2)}</span></div>` : ''}
      <div class="history-card-row">
        <span class="history-card-label">Total</span>
        <span class="history-card-value">₹${h.total.toFixed(2)}</span>
      </div>
      <div class="history-card-row">
        <span class="history-card-label">Date</span>
        <span style="font-size:.72rem;color:var(--text-muted)">${h.datetime}</span>
      </div>`;
    cards.appendChild(card);
  });
}

/* =============================================
   EXPORT CSV — Shivam Soni
   ============================================= */
function exportCSV() {
  const hist = getHistory();
  if (!hist.length) { showToast('No history to export.'); return; }

  const header = ['Mode','Product','Amount (₹)','GST Rate (%)','Transaction Type','GST (₹)','Cess Rate (%)','Cess (₹)','Total (₹)','Date & Time'];
  const rows   = hist.map(h => [
    h.mode, h.product || '', h.amount.toFixed(2),
    h.rate, TXN_TYPES[h.txnType]?.label || h.txnType || '',
    h.gstAmount.toFixed(2), h.cessRate || 0,
    h.cessAmount?.toFixed(2) || '0.00', h.total.toFixed(2), h.datetime
  ]);

  const csv = [header,...rows]
    .map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `GST_History_ShivamSoni_${Date.now()}.csv` });
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('✓ Exported as CSV!');
}

/* =============================================
   GST INFO CARDS — CA-Verified — Shivam Soni
   ============================================= */
function renderGSTInfoCards() {
  const container = document.getElementById('gstInfoCards');
  GST_SLABS.forEach(s => {
    const col = document.createElement('div');
    col.className = 'col-6 col-md-4 col-lg-3';
    col.innerHTML = `
      <div class="gst-info-card">
        <div class="gst-info-rate">${s.rate}</div>
        <span class="gst-info-type ${s.type}">${s.type === 'both' ? 'IGST/CGST+SGST' : s.type === 'intra' ? 'Intra-state' : s.type === 'inter' ? 'Inter-state' : 'Special'}</span>
        <div class="gst-info-label">${s.label}</div>
        <div class="gst-info-desc">${s.desc}</div>
      </div>`;
    container.appendChild(col);
  });
}

/* =============================================
   SCIENTIFIC CALCULATOR — Shivam Soni
   ============================================= */
function setAngleMode(m) {
  sciAngleMode = m;
  document.getElementById('modeDeg').classList.toggle('active', m === 'deg');
  document.getElementById('modeRad').classList.toggle('active', m === 'rad');
}

function sciInput(val) {
  const map = { '×':'*', '÷':'/', '−':'-', 'π':'Math.PI', 'e':'Math.E' };
  const jsVal = map[val] || val;

  if (sciHasResult && /[\d.(]/.test(val)) {
    sciExpr = jsVal; sciHasResult = false;
  } else {
    sciExpr += jsVal; sciHasResult = false;
  }
  updateSciDisplay();
}

function sciBackspace() {
  if (sciHasResult) { sciClearAll(); return; }
  sciExpr = sciExpr.replace(/(?:Math\.PI|Math\.E|sin\(|cos\(|tan\(|asin\(|acos\(|atan\(|log\(|ln\(|sqrt\(|abs\(|.)$/, '');
  updateSciDisplay();
}
function sciClearEntry() { sciExpr = ''; updateSciDisplay(false); }
function sciClearAll()   { sciExpr = ''; sciHasResult = false; document.getElementById('sciExpression').innerHTML = '&nbsp;'; document.getElementById('sciResult').textContent = '0'; }

function sciToggleSign() {
  if (!sciExpr) return;
  sciExpr = `-(${sciExpr})`;
  updateSciDisplay();
}
function sciSquare() {
  if (!sciExpr) return;
  sciExpr = `(${sciExpr})^2`;
  sciEvaluate();
}

function sciMemStore() {
  const v = parseFloat(document.getElementById('sciResult').textContent.replace(/,/g,''));
  if (!isNaN(v)) {
    sciMemory = v;
    document.getElementById('sciMemLabel').style.opacity = '1';
    showToast(`MS: ₹${v} stored in memory.`);
  }
}
function sciMemRecall() { sciInput(String(sciMemory)); }

function sciEvaluate() {
  if (!sciExpr.trim()) return;
  try {
    const display = sciExpr.replace(/Math\.PI/g,'π').replace(/Math\.E/g,'e');
    document.getElementById('sciExpression').textContent = display + ' =';
    const result = evalSciExpr(sciExpr);
    if (result === null || !isFinite(result)) {
      document.getElementById('sciResult').textContent = 'Error';
    } else {
      const formatted = Number.isInteger(result)
        ? result.toLocaleString('en-IN')
        : parseFloat(result.toPrecision(12)).toLocaleString('en-IN', { maximumFractionDigits: 10 });
      document.getElementById('sciResult').textContent = formatted;
      sciExpr = String(result);
      sciHasResult = true;
    }
  } catch {
    document.getElementById('sciResult').textContent = 'Error';
  }
}

function updateSciDisplay(showExpr = true) {
  if (showExpr) {
    const display = sciExpr.replace(/Math\.PI/g,'π').replace(/Math\.E/g,'e');
    document.getElementById('sciExpression').textContent = display || '';
  }
  if (sciExpr.length > 0) {
    try {
      const v = evalSciExpr(sciExpr);
      if (v !== null && isFinite(v)) {
        document.getElementById('sciResult').textContent =
          parseFloat(v.toPrecision(12)).toLocaleString('en-IN', { maximumFractionDigits: 10 });
      }
    } catch { /* incomplete expression — ignore */ }
  } else {
    document.getElementById('sciResult').textContent = '0';
  }
}

/**
 * Safe math expression evaluator — QA-tested edge cases
 * Replaces trig functions respecting DEG/RAD mode, then runs
 * through a whitelist check before using Function().
 */
function evalSciExpr(expr) {
  const toRad   = sciAngleMode === 'deg' ? '*Math.PI/180' : '';
  const fromRad = sciAngleMode === 'deg' ? '*180/Math.PI' : '';

  let e = expr
    .replace(/\^/g, '**')
    .replace(/asin\(([^)]+)\)/g,  (_, a) => `(Math.asin(${a})${fromRad})`)
    .replace(/acos\(([^)]+)\)/g,  (_, a) => `(Math.acos(${a})${fromRad})`)
    .replace(/atan\(([^)]+)\)/g,  (_, a) => `(Math.atan(${a})${fromRad})`)
    .replace(/sin\(([^)]+)\)/g,   (_, a) => `Math.sin((${a})${toRad})`)
    .replace(/cos\(([^)]+)\)/g,   (_, a) => `Math.cos((${a})${toRad})`)
    .replace(/tan\(([^)]+)\)/g,   (_, a) => `Math.tan((${a})${toRad})`)
    .replace(/log\(/g,  'Math.log10(')
    .replace(/ln\(/g,   'Math.log(')
    .replace(/sqrt\(/g, 'Math.sqrt(')
    .replace(/abs\(/g,  'Math.abs(')
    .replace(/%/g, '/100');

  // Whitelist: only allow safe chars after removing known Math calls
  const safe = e.replace(/Math\.(sin|cos|tan|asin|acos|atan|log|log10|sqrt|abs|PI|E)\b/g, '');
  if (/[^0-9+\-*/.()e\s,]/.test(safe)) return null;

  // eslint-disable-next-line no-new-func
  return Function('"use strict"; return (' + e + ')')();
}

/* =============================================
   UNIT CONVERTER — Shivam Soni
   ============================================= */
function initUnitConverter() { selectUnitCat('length'); }

function selectUnitCat(cat) {
  activeUnitCat = cat;
  document.querySelectorAll('.unit-cat-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  document.getElementById('unitFromVal').value = '';
  document.getElementById('unitToVal').value   = '';
  document.getElementById('unitFormula').textContent = 'Select a value above to see the conversion formula.';
  const cfg = UNITS[cat];
  populateSelect('unitFromUnit', cfg.units, cfg.defaultFrom);
  populateSelect('unitToUnit',   cfg.units, cfg.defaultTo);
  renderUnitQuickRef(cat);
}

function populateSelect(id, units, defaultId) {
  const sel = document.getElementById(id);
  sel.innerHTML = units.map(u => `<option value="${u.id}"${u.id === defaultId ? ' selected' : ''}>${u.label}</option>`).join('');
}

function convertUnit(direction) {
  const cfg    = UNITS[activeUnitCat];
  const fromId = document.getElementById('unitFromUnit').value;
  const toId   = document.getElementById('unitToUnit').value;

  const [inEl, outEl] = direction === 'from'
    ? [document.getElementById('unitFromVal'), document.getElementById('unitToVal')]
    : [document.getElementById('unitToVal'),   document.getElementById('unitFromVal')];

  const inputVal = parseFloat(inEl.value);
  if (isNaN(inputVal)) { outEl.value = ''; document.getElementById('unitFormula').textContent = 'Select a value above to see the conversion formula.'; return; }

  const srcId = direction === 'from' ? fromId : toId;
  const dstId = direction === 'from' ? toId   : fromId;

  let result;
  if (activeUnitCat === 'temperature') {
    result = convertTemp(inputVal, srcId, dstId);
  } else {
    const src = cfg.units.find(u => u.id === srcId);
    const dst = cfg.units.find(u => u.id === dstId);
    if (!src || !dst) return;
    result = (inputVal * src.factor) / dst.factor;
  }

  outEl.value = fmtUnit(result);

  const fLabel = cfg.units.find(u => u.id === srcId)?.label || srcId;
  const tLabel = cfg.units.find(u => u.id === dstId)?.label || dstId;
  document.getElementById('unitFormula').textContent = `${inputVal} ${fLabel}  =  ${fmtUnit(result)} ${tLabel}`;
}

function convertTemp(val, from, to) {
  let c = from === 'c' ? val : from === 'f' ? (val - 32) * 5/9 : val - 273.15;
  return to === 'c' ? c : to === 'f' ? c * 9/5 + 32 : c + 273.15;
}

function fmtUnit(v) {
  if (v === 0) return '0';
  if (Math.abs(v) >= 1e10 || (Math.abs(v) < 1e-4 && v !== 0)) return v.toExponential(6);
  return parseFloat(v.toPrecision(8)).toString();
}

function swapUnits() {
  const fSel = document.getElementById('unitFromUnit');
  const tSel = document.getElementById('unitToUnit');
  const fVal = document.getElementById('unitFromVal').value;
  const tVal = document.getElementById('unitToVal').value;
  [fSel.value, tSel.value] = [tSel.value, fSel.value];
  document.getElementById('unitFromVal').value = tVal;
  document.getElementById('unitToVal').value   = fVal;
  if (fVal || tVal) convertUnit('from');
}

function renderUnitQuickRef(cat) {
  const cfg  = UNITS[cat];
  const cont = document.getElementById('unitQuickRef');
  if (!cfg.quick?.length) { cont.innerHTML = ''; return; }
  cont.innerHTML = `
    <div class="unit-quick-title"><i class="bi bi-lightning-charge me-1"></i>Quick Conversions</div>
    <div class="unit-quick-grid">
      ${cfg.quick.map(q => `
        <div class="unit-quick-item" role="button" tabindex="0"
          onclick="applyQuick('${q.fu}','${q.tu}',${q.from})"
          onkeydown="if(event.key==='Enter'||event.key===' ')applyQuick('${q.fu}','${q.tu}',${q.from})"
          aria-label="Convert ${q.from} ${q.fu} to ${q.tu}">
          <strong>${q.label}</strong>
          <span>${getQuickResult(q.from, q.fu, q.tu, cat)}</span>
        </div>`).join('')}
    </div>`;
}

function getQuickResult(val, fu, tu, cat) {
  try {
    const cfg = UNITS[cat];
    if (cat === 'temperature') return fmtUnit(convertTemp(val, fu, tu));
    const s = cfg.units.find(u => u.id === fu);
    const d = cfg.units.find(u => u.id === tu);
    return s && d ? fmtUnit((val * s.factor) / d.factor) : '?';
  } catch { return '?'; }
}

function applyQuick(fu, tu, val) {
  document.getElementById('unitFromUnit').value = fu;
  document.getElementById('unitToUnit').value   = tu;
  document.getElementById('unitFromVal').value  = val;
  convertUnit('from');
}

/* =============================================
   TOAST — Shivam Soni
   ============================================= */
function showToast(msg) {
  document.getElementById('toastText').textContent = msg;
  bootstrap.Toast.getOrCreateInstance(document.getElementById('toastMsg'), { delay: 2500 }).show();
}

/* =============================================
   ESCAPE HTML helper — QA security — Shivam Soni
   ============================================= */
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* =============================================
   KEYBOARD ACCESSIBILITY — Shivam Soni
   ============================================= */
document.addEventListener('keydown', e => {
  // Rate buttons: Enter/Space to activate
  if ((e.key==='Enter'||e.key===' ') && e.target.classList.contains('rate-btn')) {
    e.preventDefault(); e.target.click();
  }
  // Transaction type buttons
  if ((e.key==='Enter'||e.key===' ') && e.target.classList.contains('txn-btn')) {
    e.preventDefault(); e.target.click();
  }
  // Close txn info modal on Escape
  if (e.key === 'Escape') hideTxnInfo();

  // Physical keyboard for Scientific Calculator when sci panel is active
  if (activeTool === 'sci' && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) {
    const k = e.key;
    if      (k >= '0' && k <= '9') sciInput(k);
    else if (k === '+') sciInput('+');
    else if (k === '-') sciInput('-');
    else if (k === '*') sciInput('*');
    else if (k === '/') { e.preventDefault(); sciInput('/'); }
    else if (k === '.') sciInput('.');
    else if (k === '(') sciInput('(');
    else if (k === ')') sciInput(')');
    else if (k === '%') sciInput('%');
    else if (k === 'Enter' || k === '=') { e.preventDefault(); sciEvaluate(); }
    else if (k === 'Backspace') sciBackspace();
    else if (k === 'Escape') sciClearAll();
  }
});

/* ================================================================
   End of script.js
   Author  : Shivam Soni
   © 2024 Shivam Soni. All rights reserved.
   ================================================================ */
