// =====================================================
// Civil Engineering Idle
// Implements DESIGN.md v0.2. Levels 1-3 playable.
//
// Worker allocation rule (resolves the gap DESIGN §3 left open): workers are a
// single pool, and the player ASSIGNS them per raw material. This keeps §6's
// single hiring ladder intact and makes misallocation the bottleneck that the
// §9 Stage 3 Operations tab will diagnose.
// =====================================================

const CONFIG = {
  tickRate: 100,
  saveKey: 'civilIdle_v2',
  // Offline accrual is a Level-3 unlock (§10). Before the first Project
  // Manager a backgrounded tab must not dump hours of production on return.
  maxCatchUpSeconds: 60,
  offlineCapHours: 8,        // §10 "generous by default"
  collapseHintSeconds: 120,  // §9 Stage 2 — tunable, finalize in playtest
};

// --- TUNING: playtest placeholders (§14 "remaining true unknowns") ----------
const TUNING = {
  tapYield: 1,
  laborerRate: 0.5,
  foremanBonus: 0.25,
  superBonus: 0.5,
  pmBonus: 0.1,          // +10% global production per Project Manager
  seedPerCapital: 25,
  overtimePerLevel: 0.1,
  offlineBase: 0.5,      // 50% of live rate while away...
  offlinePerLevel: 0.25, // ...+25% per Offline Efficiency level, capped at 100%
};

// --- RESOURCES --------------------------------------------------------------
const RESOURCES = {
  timber:   { name: 'Timber' },
  lumber:   { name: 'Lumber' },
  stone:    { name: 'Stone' },
  cutstone: { name: 'Cut Stone' },
  ironore:  { name: 'Iron Ore' },
  coal:     { name: 'Coal' },
  iron:     { name: 'Iron' },
};
const resName = id => (RESOURCES[id] || { name: id }).name;

// Accurate to the trade — the tone rule (§1) is grounded vocabulary.
const TAP_VERB = {
  timber: 'Fell Timber', stone: 'Quarry Stone',
  ironore: 'Dig Ore', coal: 'Dig Coal',
};

// --- THE HIRING LADDER (§6) -------------------------------------------------
const WORKERS = {
  laborer: {
    name: 'Laborer',
    desc: `Extracts ${TUNING.laborerRate}/sec when assigned`,
    baseCost: 12, growth: 1.15, fromLevel: 1,
  },
  foreman: {
    name: 'Foreman',
    desc: `+${TUNING.foremanBonus * 100}% to all Laborers`,
    baseCost: 120, growth: 1.28, fromLevel: 1,
    requires: s => (s.workers.laborer || 0) >= 5,
  },
  superintendent: {
    name: 'Superintendent',
    desc: `+${TUNING.superBonus * 100}% to each Foreman`,
    baseCost: 1500, growth: 1.35, fromLevel: 2,
  },
  projectManager: {
    name: 'Project Manager',
    desc: `+${TUNING.pmBonus * 100}% global output; first one unlocks offline progress`,
    baseCost: 3000, growth: 1.5, fromLevel: 3,
  },
  qaManager: {
    name: 'QA Manager',
    // §6: no production effect at all. Its value is purely the UI unlock.
    desc: 'No output. Lets you collapse finished chains',
    baseCost: 5000, growth: 1.6, fromLevel: 3,
    requires: s => (s.workers.projectManager || 0) >= 1,
  },
};

// --- BUILDINGS (§3: recipes + capacity) -------------------------------------
// Global registry, not per-level: buildings PERSIST across reset (§4), so the
// Sawmill must keep converting during later levels to feed back-references.
const BUILDINGS = {
  sawmill: {
    name: 'Sawmill', fromLevel: 1,
    inputs: { timber: 1.0 }, outputs: { lumber: 0.5 },
    baseCost: { timber: 60 }, growth: 1.3,
    requires: s => (s.workers.laborer || 0) >= 3,
  },
  stoneyard: {
    name: 'Stone Yard', fromLevel: 2,
    inputs: { stone: 1.0 }, outputs: { cutstone: 0.4 },
    // Costs lumber as well as stone — the §7 back-reference starts at the
    // building, so the timber chain matters before the arch is even started.
    baseCost: { stone: 150, lumber: 40 }, growth: 1.3,
  },
  smelter: {
    name: 'Smelter', fromLevel: 3,
    // The first genuinely multi-input recipe: coal fires the smelter (§7).
    // Runs at whatever fraction the scarcer of ore/coal allows.
    inputs: { ironore: 1.0, coal: 0.5 }, outputs: { iron: 0.4 },
    // Built of cut stone and timber, which keeps BOTH earlier chains alive
    // rather than letting the stone yard go dead at Level 3 (§7).
    baseCost: { cutstone: 200, lumber: 120 }, growth: 1.32,
  },
};

// --- LEVELS (§7) ------------------------------------------------------------
// wageRaw: which material wages are paid in. Defaults to the level's first new
// raw; stated explicitly so hiring never bills an odd secondary material.
const LEVELS = [
  {
    id: 1, zone: 'Hollow Creek',
    newRaws: [{ id: 'timber', name: 'Timber' }],
    wageRaw: 'timber',
    structure: {
      id: 'trestle', name: 'Timber Trestle',
      desc: 'A timber pile trestle across Hollow Creek.',
      // Measured against a greedy-optimal sim: ~9m20s, a floor since a real
      // player buys less promptly. Cost is a weak pacing lever — the economy
      // compounds, so 10x cost is only ~3x time.
      cost: { lumber: 1000 }, reputation: 3,
    },
  },
  {
    id: 2, zone: 'Quarry Bend',
    newRaws: [{ id: 'stone', name: 'Stone' }],
    wageRaw: 'stone',
    structure: {
      id: 'arch', name: 'Stone Arch',
      desc: 'A cut-stone arch on timber centering.',
      // Lumber requirement IS the back-reference (§7): centering/falsework.
      cost: { cutstone: 800, lumber: 250 }, reputation: 5,
    },
  },
  {
    id: 3, zone: 'Foundry Gap',
    newRaws: [{ id: 'ironore', name: 'Iron Ore' }, { id: 'coal', name: 'Coal' }],
    wageRaw: 'ironore',
    structure: {
      id: 'truss', name: 'Iron Truss',
      desc: 'A wrought-iron through truss on stone abutments.',
      // Lumber for erection falsework — keeps the oldest chain live (§7).
      cost: { iron: 1200, lumber: 300 }, reputation: 8,
    },
  },
];

// --- REPUTATION UPGRADES (§11) ----------------------------------------------
const REP_UPGRADES = {
  tapValue:        { name: 'Tap Value',        desc: '+100% per-tap yield',              baseCost: 2, growth: 2.0 },
  startingCapital: { name: 'Starting Capital', desc: `+${TUNING.seedPerCapital} raw at level start`, baseCost: 3, growth: 2.0 },
  retainedCrew:    { name: 'Retained Crew',    desc: '+1 Laborer kept through reset',    baseCost: 5, growth: 2.5 },
  overtime:        { name: 'Overtime',         desc: '+10% global production',           baseCost: 4, growth: 2.2 },
  offlineEff:      { name: 'Offline Efficiency', desc: '+25% offline accrual rate',      baseCost: 6, growth: 2.2 },
};

// --- HELP TEXT --------------------------------------------------------------
const HELP = {
  panorama: ['The Site',
    'Every structure you finish stays here permanently — one zone per crossing. ' +
    'Resets never touch it. By the end it is the skyline of everything you have built.'],
  assignment: ['Assignment',
    'Laborers only extract the material you put them on. New hires go automatically ' +
    'to whichever material has the fewest workers, so hiring always does something. ' +
    'Use − and + to rebalance: − takes someone off a material into your unassigned ' +
    'pool, + puts them on. Later levels need several materials at once, and splitting ' +
    'the crew wrong is what starves your buildings. ' +
    'Crew output counts only assigned Laborers — tapping is a one-off grab and does ' +
    'not change it.'],
  crew: ['Crew',
    'Laborers do the extracting. Foremen make every Laborer faster, and ' +
    'Superintendents make every Foreman stronger — each tier multiplies the one ' +
    'below. Project Managers add output and unlock offline progress, so the game ' +
    'keeps running while you are away. QA Managers produce nothing at all; they ' +
    'exist to let you collapse chains you no longer want to look at. ' +
    'Your whole crew is laid off when you complete a structure; you re-hire each level.'],
  processing: ['Processing',
    'Buildings do not produce on their own — they convert. A Sawmill turns Timber ' +
    'into Lumber, but only as fast as Laborers supply it. A recipe with two inputs ' +
    'runs at whatever fraction the scarcer one allows. A building short of input is ' +
    'marked starved. Buildings are permanent: you keep them through every reset, ' +
    'which is why re-staffing is the first thing you do each level. ' +
    'Once you have a QA Manager, a chain that has run clean for a while offers to ' +
    'collapse to a single line — it never collapses itself.'],
  structure: ['Structures',
    'The goal of each level. It consumes a large amount of refined material, and ' +
    'usually some material from an earlier chain — so old chains never go dead. ' +
    'Finishing it banks Reputation, adds the zone to your skyline, and resets your ' +
    'crew and stockpiles — but never your buildings.'],
  reputation: ['Reputation',
    'Permanent currency, earned only by completing structures. It survives every ' +
    'reset. Spend it on upgrades that make each new level start less painful — ' +
    'keeping some crew, starting with materials, or raising output across the board. ' +
    'It is the only progress that compounds across runs.'],
};

// --- STATE ------------------------------------------------------------------
let state = {
  level: 1,
  resources: {},   // WIPED on reset (§4)
  workers: {},     // WIPED on reset (§4)
  assign: {},      // rawId -> laborers assigned. WIPED with the crew.
  buildings: {},   // PERSIST (§4)
  unlocked: {},    // PERSIST (§6)
  gallery: [],     // PERSIST (§4)
  reputation: 0,   // PERSIST (§5)
  repUpgrades: {}, // PERSIST
  collapsed: {},   // buildingId -> true. Player's choice, so it PERSISTS.
  lastSeen: Date.now(),
  startTime: Date.now(),
};

let tickSpeed = 1;
let lastTick = Date.now();
const starved = {};
const stableSince = {};   // buildingId -> ms timestamp of last clean run

// --- HELPERS ----------------------------------------------------------------
const currentLevel = () => LEVELS.find(l => l.id === state.level) || LEVELS[0];

// Every raw unlocked so far — upstream chains stay available forever, which is
// what makes back-references (§7) playable.
function availableRaws() {
  return LEVELS.filter(l => l.id <= state.level).flatMap(l => l.newRaws);
}
function primaryRaw() {
  const l = currentLevel();
  return l.wageRaw || l.newRaws[l.newRaws.length - 1].id;
}

const add = (res, amt) => { state.resources[res] = (state.resources[res] || 0) + amt; };
const canAfford = cost => Object.entries(cost).every(([r, a]) => (state.resources[r] || 0) >= a);
const spend = cost => { for (const [r, a] of Object.entries(cost)) state.resources[r] -= a; };
const isUnlocked = (kind, id) => !!state.unlocked[kind + ':' + id];

const totalAssigned = () => Object.values(state.assign).reduce((a, b) => a + b, 0);
const unassigned = () => (state.workers.laborer || 0) - totalAssigned();
const hasOffline = () => (state.workers.projectManager || 0) > 0;
const hasQA = () => (state.workers.qaManager || 0) > 0;

function checkUnlocks() {
  for (const [id, def] of Object.entries(WORKERS)) {
    const key = 'worker:' + id;
    if (state.unlocked[key] || state.level < def.fromLevel) continue;
    if (def.requires && !def.requires(state)) continue;
    state.unlocked[key] = true;
  }
  for (const [id, b] of Object.entries(BUILDINGS)) {
    const key = 'building:' + id;
    if (state.unlocked[key] || state.level < b.fromLevel) continue;
    if (b.requires && !b.requires(state)) continue;
    state.unlocked[key] = true;
  }
}

// --- PRODUCTION (§3) --------------------------------------------------------
const globalMult = () =>
  (1 + TUNING.overtimePerLevel * (state.repUpgrades.overtime || 0)) *
  (1 + TUNING.pmBonus * (state.workers.projectManager || 0));
const tapYield = () => TUNING.tapYield * (1 + (state.repUpgrades.tapValue || 0));

function laborMult() {
  const w = state.workers;
  const foremanBonus = TUNING.foremanBonus * (1 + TUNING.superBonus * (w.superintendent || 0));
  return 1 + (w.foreman || 0) * foremanBonus;
}
const extractionRateFor = rawId =>
  (state.assign[rawId] || 0) * TUNING.laborerRate * laborMult() * globalMult();
const totalExtractionRate = () =>
  availableRaws().reduce((sum, r) => sum + extractionRateFor(r.id), 0);

// Live output rate of a building, for the collapsed summary line.
function outputRateOf(id) {
  const b = BUILDINGS[id];
  const count = state.buildings[id] || 0;
  const out = Object.entries(b.outputs)[0];
  return { rate: count * out[1] * globalMult(), res: out[0] };
}

function produce(dt) {
  for (const r of availableRaws()) add(r.id, extractionRateFor(r.id) * dt);

  for (const [id, b] of Object.entries(BUILDINGS)) {
    const count = state.buildings[id] || 0;
    starved[id] = false;
    if (!count) continue;

    // Run at the fraction the scarcest input allows.
    let scale = 1;
    for (const [res, rate] of Object.entries(b.inputs)) {
      const want = count * rate * globalMult() * dt;
      if (want > 0) scale = Math.min(scale, (state.resources[res] || 0) / want);
    }
    scale = Math.max(0, Math.min(1, scale));
    starved[id] = scale < 1 - 1e-9;
    if (scale <= 0) continue;

    for (const [res, rate] of Object.entries(b.inputs)) {
      state.resources[res] -= count * rate * globalMult() * dt * scale;
    }
    for (const [res, rate] of Object.entries(b.outputs)) {
      add(res, count * rate * globalMult() * dt * scale);
    }
  }

  // Track how long each chain has run clean — drives the collapse suggestion.
  const now = Date.now();
  for (const id of Object.keys(BUILDINGS)) {
    if (starved[id] || !(state.buildings[id] > 0)) stableSince[id] = 0;
    else if (!stableSince[id]) stableSince[id] = now;
  }
}

// §9 Stage 2: suggest collapse only for a chain that is automated and has not
// starved for a while. The game never collapses anything itself.
function collapseEligible(id) {
  if (!hasQA() || state.collapsed[id]) return false;
  if (!(state.buildings[id] > 0) || starved[id] || !stableSince[id]) return false;
  return (Date.now() - stableSince[id]) / 1000 >= CONFIG.collapseHintSeconds;
}

// --- OFFLINE PROGRESS (§10) -------------------------------------------------
const offlineEfficiency = () =>
  Math.min(1, TUNING.offlineBase + TUNING.offlinePerLevel * (state.repUpgrades.offlineEff || 0));

function applyOfflineProgress() {
  const away = (Date.now() - (state.lastSeen || Date.now())) / 1000;
  // Locked until the first Project Manager (§10), and ignore trivial gaps.
  if (!hasOffline() || away < 60) return null;

  const capped = Math.min(away, CONFIG.offlineCapHours * 3600);
  const effective = capped * offlineEfficiency();

  const before = { ...state.resources };
  // Step it rather than one huge dt so buildings starve realistically partway.
  let remaining = effective;
  while (remaining > 0) {
    const step = Math.min(60, remaining);
    produce(step);
    remaining -= step;
  }
  const gained = {};
  for (const [res, amt] of Object.entries(state.resources)) {
    const d = amt - (before[res] || 0);
    if (d > 0.5) gained[res] = d;
  }
  return { away: capped, gained };
}

// --- COSTS & PURCHASING -----------------------------------------------------
function workerCost(id) {
  const def = WORKERS[id];
  return { [primaryRaw()]: Math.ceil(def.baseCost * Math.pow(def.growth, state.workers[id] || 0)) };
}
function buildingCost(id) {
  const b = BUILDINGS[id];
  const mult = Math.pow(b.growth, state.buildings[id] || 0);
  const cost = {};
  for (const [r, a] of Object.entries(b.baseCost)) cost[r] = Math.ceil(a * mult);
  return cost;
}
const repCost = id =>
  Math.ceil(REP_UPGRADES[id].baseCost * Math.pow(REP_UPGRADES[id].growth, state.repUpgrades[id] || 0));

function hire(id) {
  checkUnlocks();
  if (!isUnlocked('worker', id)) return;
  const cost = workerCost(id);
  if (!canAfford(cost)) return;
  spend(cost);
  state.workers[id] = (state.workers[id] || 0) + 1;

  if (id === 'laborer') autoAssign(1);

  checkUnlocks();
  render();
}

// Place new hires on the least-staffed material. Leaving them unassigned meant
// hiring five Laborers on Level 2 moved the rate not at all, which reads as a
// broken game. Allocation stays the player's job — they rebalance with − / +.
function autoAssign(n) {
  const raws = availableRaws();
  if (!raws.length) return;
  for (let i = 0; i < n; i++) {
    let target = raws[0].id;
    for (const r of raws) {
      if ((state.assign[r.id] || 0) < (state.assign[target] || 0)) target = r.id;
    }
    state.assign[target] = (state.assign[target] || 0) + 1;
  }
}

function buyBuilding(id) {
  checkUnlocks();
  if (!BUILDINGS[id] || !isUnlocked('building', id)) return;
  const cost = buildingCost(id);
  if (!canAfford(cost)) return;
  spend(cost);
  state.buildings[id] = (state.buildings[id] || 0) + 1;
  checkUnlocks();
  render();
}
function buyRepUpgrade(id) {
  const cost = repCost(id);
  if (state.reputation < cost) return;
  state.reputation -= cost;
  state.repUpgrades[id] = (state.repUpgrades[id] || 0) + 1;
  render();
}

// Move one laborer on or off a raw. +1 draws from the unassigned pool only —
// never silently steals from another raw.
function assignWorker(rawId, delta) {
  const cur = state.assign[rawId] || 0;
  if (delta > 0 && unassigned() <= 0) return;
  if (delta < 0 && cur <= 0) return;
  state.assign[rawId] = cur + delta;
  render();
}

function toggleCollapse(id) {
  state.collapsed[id] = !state.collapsed[id];
  render();
}

// --- STRUCTURE COMPLETION & RESET (§4) --------------------------------------
function buildStructure() {
  const s = currentLevel().structure;
  if (!canAfford(s.cost)) return;
  spend(s.cost);
  if (!state.gallery.includes(s.id)) state.gallery.push(s.id);
  state.reputation += s.reputation;
  showToast(`${s.name} complete!  +${s.reputation} Reputation`);
  resetForNextLevel();
}

function resetForNextLevel() {
  state.resources = {};
  state.workers = {};
  state.assign = {};

  const next = LEVELS.find(l => l.id === state.level + 1);
  if (next) state.level = next.id;

  const seed = TUNING.seedPerCapital * (state.repUpgrades.startingCapital || 0);
  if (seed) for (const r of availableRaws()) add(r.id, seed);

  const crew = state.repUpgrades.retainedCrew || 0;
  if (crew) { state.workers.laborer = crew; autoAssign(crew); }

  checkUnlocks();
  render();
}

// --- NUMBER FORMATTING (§12) ------------------------------------------------
const BASE_SUFFIXES = ['', 'K', 'M', 'B', 'T'];
function suffixFor(tier) {
  if (tier < BASE_SUFFIXES.length) return BASE_SUFFIXES[tier];
  const i = tier - BASE_SUFFIXES.length;
  const first = Math.floor(i / 26);
  if (first > 25) return 'e' + tier * 3;
  return String.fromCharCode(97 + first) + String.fromCharCode(97 + (i % 26));
}
function fmt(n) {
  if (!isFinite(n)) return '∞';
  if (n < 0) return '-' + fmt(-n);
  if (n < 100) return n.toFixed(1);
  if (n < 1000) return Math.floor(n).toString();
  const tier = Math.floor(Math.log10(n) / 3);
  const scaled = n / Math.pow(1000, tier);
  return scaled.toFixed(scaled < 100 ? 2 : 0) + suffixFor(tier);
}
const costStr = cost =>
  Object.entries(cost).map(([r, a]) => `${fmt(a)} ${resName(r)}`).join(', ');

function durationStr(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${Math.max(1, m)}m`;
}

// --- UI CONSTRUCTION --------------------------------------------------------
const refs = { workers: {}, buildings: {}, rep: {}, raws: {} };

function row(name, desc, btnLabel, onClick) {
  const el = document.createElement('div');
  el.className = 'upgrade';
  el.innerHTML =
    `<div class="up-info">
       <div class="up-name"></div><div class="up-desc"></div>
       <div class="up-owned">Owned: <span class="count">0</span></div>
     </div>
     <button class="buy-btn">${btnLabel}<span class="cost"></span></button>`;
  el.querySelector('.up-name').textContent = name;
  el.querySelector('.up-desc').textContent = desc;
  el.querySelector('.buy-btn').addEventListener('click', onClick);
  return el;
}

function buildUI() {
  const rawList = document.getElementById('raw-list');
  for (const l of LEVELS) for (const r of l.newRaws) {
    const el = document.createElement('div');
    el.className = 'upgrade assign-row';
    el.innerHTML =
      `<div class="up-info">
         <div class="up-name">${r.name}</div>
         <div class="up-desc rate-line"></div>
       </div>
       <div class="stepper">
         <button class="step-btn minus">−</button>
         <span class="assigned">0</span>
         <button class="step-btn plus">+</button>
       </div>`;
    el.querySelector('.minus').addEventListener('click', () => assignWorker(r.id, -1));
    el.querySelector('.plus').addEventListener('click', () => assignWorker(r.id, +1));
    rawList.appendChild(el);
    refs.raws[r.id] = el;
  }

  const workerList = document.getElementById('worker-list');
  for (const [id, def] of Object.entries(WORKERS)) {
    const el = row(def.name, def.desc, 'Hire: ', () => hire(id));
    workerList.appendChild(el);
    refs.workers[id] = el;
  }

  const buildingList = document.getElementById('building-list');
  for (const [id, b] of Object.entries(BUILDINGS)) {
    const desc = Object.entries(b.inputs).map(([r, v]) => `${v}/s ${resName(r)}`).join(' + ') +
                 ' → ' +
                 Object.entries(b.outputs).map(([r, v]) => `${v}/s ${resName(r)}`).join(' + ');
    const el = row(b.name, desc, 'Build: ', () => buyBuilding(id));
    // Collapse affordance + the one-line summary it collapses to (§9 Stage 2)
    el.querySelector('.up-info').insertAdjacentHTML('beforeend',
      '<div class="summary"></div>');
    // Chip lives inside the info block: a two-input recipe wraps to two lines,
    // and a sibling flex item ends up wedged mid-sentence.
    const chip = document.createElement('button');
    chip.className = 'collapse-chip hidden';
    chip.addEventListener('click', () => toggleCollapse(id));
    el.querySelector('.up-info').appendChild(chip);
    buildingList.appendChild(el);
    refs.buildings[id] = el;
  }

  const repList = document.getElementById('rep-list');
  for (const [id, def] of Object.entries(REP_UPGRADES)) {
    const el = row(def.name, def.desc, 'Buy: ', () => buyRepUpgrade(id));
    el.querySelector('.up-owned').innerHTML = 'Level: <span class="count">0</span>';
    repList.appendChild(el);
    refs.rep[id] = el;
  }
}

// --- RENDER -----------------------------------------------------------------
function render() {
  renderPanorama();
  renderResources();

  const raws = availableRaws();
  const rawIds = raws.map(r => r.id);
  for (const [id, el] of Object.entries(refs.raws)) {
    const shown = rawIds.includes(id);
    el.classList.toggle('locked', !shown);
    if (!shown) continue;
    el.querySelector('.assigned').textContent = state.assign[id] || 0;
    el.querySelector('.rate-line').textContent = fmt(extractionRateFor(id)) + '/sec';
    el.querySelector('.plus').disabled = unassigned() <= 0;
    el.querySelector('.minus').disabled = (state.assign[id] || 0) <= 0;
  }
  document.getElementById('unassigned-count').textContent = unassigned();
  document.getElementById('unassigned-note').classList.toggle('hidden', unassigned() <= 0);

  for (const id of Object.keys(WORKERS)) {
    const el = refs.workers[id];
    const ok = isUnlocked('worker', id);
    el.classList.toggle('locked', !ok);
    if (!ok) continue;
    const cost = workerCost(id);
    el.querySelector('.count').textContent = state.workers[id] || 0;
    el.querySelector('.cost').textContent = costStr(cost);
    el.querySelector('.buy-btn').disabled = !canAfford(cost);
  }

  let any = false;
  for (const id of Object.keys(BUILDINGS)) {
    const el = refs.buildings[id];
    const ok = isUnlocked('building', id);
    el.classList.toggle('locked', !ok);
    if (!ok) continue;
    any = true;
    const cost = buildingCost(id);
    const count = state.buildings[id] || 0;
    el.querySelector('.count').textContent = count;
    el.querySelector('.cost').textContent = costStr(cost);
    el.querySelector('.buy-btn').disabled = !canAfford(cost);
    el.classList.toggle('starved', count > 0 && starved[id]);

    // Collapsed chains stay collapsed even when they go into warning (§9).
    const isCollapsed = !!state.collapsed[id];
    el.classList.toggle('collapsed', isCollapsed);
    if (isCollapsed) {
      const o = outputRateOf(id);
      el.querySelector('.summary').textContent =
        `${count}× · ${fmt(starved[id] ? 0 : o.rate)}/s ${resName(o.res)}` +
        (starved[id] ? ' · starved' : ' · running');
    }
    const chip = el.querySelector('.collapse-chip');
    const showChip = isCollapsed || collapseEligible(id);
    chip.classList.toggle('hidden', !showChip);
    chip.textContent = isCollapsed ? 'expand' : 'collapse?';
  }
  document.getElementById('process-empty').classList.toggle('hidden', any);

  for (const id of Object.keys(REP_UPGRADES)) {
    const el = refs.rep[id];
    const cost = repCost(id);
    el.querySelector('.count').textContent = state.repUpgrades[id] || 0;
    el.querySelector('.cost').textContent = `${fmt(cost)} Rep`;
    el.querySelector('.buy-btn').disabled = state.reputation < cost;
  }

  renderStructure();

  // Name the actual job rather than a generic "Break Ground".
  document.getElementById('tap-dig').textContent = raws.length === 1
    ? `${TAP_VERB[raws[0].id] || 'Extract'} (+${fmt(tapYield())} ${raws[0].name})`
    : `Work the Site (+${fmt(tapYield())} each)`;
  document.getElementById('site-name').textContent = currentLevel().zone;

  document.getElementById('debug-runtime').textContent =
    Math.floor((Date.now() - state.startTime) / 1000) + 's';
  document.getElementById('debug-rate').textContent = fmt(totalExtractionRate()) + '/s';
}

function renderResources() {
  const ids = [];
  for (const r of availableRaws()) if (!ids.includes(r.id)) ids.push(r.id);
  for (const [id, b] of Object.entries(BUILDINGS)) {
    if (!isUnlocked('building', id)) continue;
    for (const out of Object.keys(b.outputs)) if (!ids.includes(out)) ids.push(out);
  }
  const rows = ids.map(id => [resName(id), fmt(state.resources[id] || 0)]);
  rows.push(['Reputation', fmt(state.reputation)]);
  // "Rate" read as though tapping should move it. This is passive crew output
  // only — taps are one-off, so name what it actually measures.
  rows.push(['Crew output', fmt(totalExtractionRate()) + '/s']);

  document.getElementById('resources').innerHTML = rows
    .map(([k, v]) => `<div class="resource"><span class="res-label">${k}</span><span>${v}</span></div>`)
    .join('');
}

function renderPanorama() {
  const lvl = currentLevel();
  const zones = state.gallery.map(id => {
    const l = LEVELS.find(x => x.structure.id === id);
    return { label: l ? l.zone : id, built: true };
  });
  if (!state.gallery.includes(lvl.structure.id)) zones.push({ label: lvl.zone, built: false });

  // A barrier sits BETWEEN zones — it's the gap a structure spans.
  document.getElementById('panorama').innerHTML = zones.map((z, i) =>
    (i > 0 ? '<div class="barrier bridged"></div>' : '') +
    `<div class="zone${z.built ? '' : ' locked'}"><span class="zone-label">${z.label}</span></div>`
  ).join('');
}

function renderStructure() {
  const s = currentLevel().structure;
  const done = state.gallery.includes(s.id);
  // Progress is gated by the scarcest requirement, not the first one.
  const parts = Object.entries(s.cost).map(([res, need]) => {
    const have = state.resources[res] || 0;
    return { res, need, have, pct: Math.min(1, have / need) };
  });
  const pct = Math.min(...parts.map(p => p.pct)) * 100;

  document.getElementById('structure-card').innerHTML =
    `<div class="structure">
       <div class="up-name">${s.name}${done ? ' <span class="built-tag">built</span>' : ''}</div>
       <div class="up-desc">${s.desc}</div>
       <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
       ${parts.map(p => `<div class="up-owned${p.pct >= 1 ? ' met' : ''}">${fmt(p.have)} / ${fmt(p.need)} ${resName(p.res)}</div>`).join('')}
       <button class="buy-btn wide" id="build-structure" ${canAfford(s.cost) ? '' : 'disabled'}>
         ${done ? 'Rebuild (test)' : 'Build'} — ${costStr(s.cost)}
       </button>
       <div class="up-desc note">Completing this resets your crew and stockpiles.
         Buildings, Reputation, and the skyline persist.</div>
     </div>`;
  document.getElementById('build-structure').addEventListener('click', buildStructure);
}

// --- TOAST ------------------------------------------------------------------
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// --- CORE LOOP --------------------------------------------------------------
function tick() {
  const now = Date.now();
  let dt = ((now - lastTick) / 1000) * tickSpeed;
  lastTick = now;
  if (dt > CONFIG.maxCatchUpSeconds) dt = CONFIG.maxCatchUpSeconds;
  checkUnlocks();
  produce(dt);
  state.lastSeen = now;
  render();
}

// --- EVENT WIRING -----------------------------------------------------------
document.getElementById('tap-dig').addEventListener('click', e => {
  // Tapping feeds every available raw. Targeting UI would be dead weight on a
  // mechanic designed to fade to irrelevance by Level 3 (§3).
  for (const r of availableRaws()) add(r.id, tapYield());
  const btn = e.currentTarget;
  btn.classList.remove('pop');
  void btn.offsetWidth;
  btn.classList.add('pop');
  render();
});

document.querySelectorAll('#tabs .tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#tabs .tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('tab-' + btn.dataset.tab).classList.remove('hidden');
  });
});

document.getElementById('debug-reset').addEventListener('click', () => {
  if (confirm('Wipe all progress?')) {
    localStorage.removeItem(CONFIG.saveKey);
    location.reload();
  }
});
document.getElementById('debug-resources').addEventListener('click', () => {
  for (const id of Object.keys(RESOURCES)) add(id, 1000);
  render();
});
document.getElementById('debug-rep').addEventListener('click', () => {
  state.reputation += 10;
  render();
});
document.getElementById('debug-speed').addEventListener('change', e => {
  tickSpeed = parseFloat(e.target.value);
});

// Help popovers — delegated so rows built later still work.
document.addEventListener('click', e => {
  const btn = e.target.closest('.help-btn');
  if (!btn) return;
  e.stopPropagation();
  const entry = HELP[btn.dataset.help];
  if (!entry) return;
  document.getElementById('help-title').textContent = entry[0];
  document.getElementById('help-body').textContent = entry[1];
  document.getElementById('help-overlay').classList.remove('hidden');
});
document.getElementById('help-overlay').addEventListener('click', () => {
  document.getElementById('help-overlay').classList.add('hidden');
});

// --- SAVE / LOAD ------------------------------------------------------------
function save() {
  try {
    state.lastSeen = Date.now();
    localStorage.setItem(CONFIG.saveKey, JSON.stringify(state));
  } catch (e) { /* quota */ }
}
function load() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return;
    const s = JSON.parse(raw) || {};
    state = {
      ...state, ...s,
      resources:   { ...(s.resources || {}) },
      workers:     { ...(s.workers || {}) },
      assign:      { ...(s.assign || {}) },
      buildings:   { ...(s.buildings || {}) },
      unlocked:    { ...(s.unlocked || {}) },
      repUpgrades: { ...(s.repUpgrades || {}) },
      collapsed:   { ...(s.collapsed || {}) },
      gallery:     Array.isArray(s.gallery) ? s.gallery : [],
    };
    // Saves made before a level existed can sit on a completed level; advance
    // past anything already in the gallery.
    while (true) {
      const cur = LEVELS.find(l => l.id === state.level);
      const next = LEVELS.find(l => l.id === state.level + 1);
      if (!cur || !next || !state.gallery.includes(cur.structure.id)) break;
      state.level = next.id;
    }
    // Never leave more laborers assigned than are actually employed.
    const cap = state.workers.laborer || 0;
    while (totalAssigned() > cap) {
      const biggest = Object.keys(state.assign).sort((a, b) => state.assign[b] - state.assign[a])[0];
      state.assign[biggest] -= 1;
    }
  } catch (e) {
    console.warn('Save load failed', e);
  }
}

// --- BOOT -------------------------------------------------------------------
// The debug panel hands out 1000 of every resource per tap — enough to buy a
// structure outright. Keep it off the public build unless explicitly asked for
// with ?debug on the URL.
if (!/[?&]debug\b/.test(location.search)) {
  document.getElementById('debug').classList.add('hidden');
}

load();
buildUI();
checkUnlocks();

const offline = applyOfflineProgress();
state.lastSeen = Date.now();

render();
if (offline) {
  const parts = Object.entries(offline.gained)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([r, v]) => `${fmt(v)} ${resName(r)}`);
  showToast(parts.length
    ? `Away ${durationStr(offline.away)} — crew produced ${parts.join(', ')}`
    : `Away ${durationStr(offline.away)} — nothing produced, chains were starved`);
}

setInterval(tick, CONFIG.tickRate);
setInterval(save, 5000);
