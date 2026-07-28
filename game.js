// =====================================================
// Civil Engineering Idle
// Implements DESIGN.md v0.2 — build order (§15) step 1:
// Level 1 end-to-end, which forces the three new systems
// into existence: the worker layer, processing, and reset.
// All game logic in one file, intentionally simple.
// =====================================================

const CONFIG = {
  tickRate: 100,          // ms per tick (10 ticks/sec)
  saveKey: 'civilIdle_v2', // v1 was the prototype's different game; don't load it
  // Offline accrual is a Level-3 unlock (§10). Until then a backgrounded tab
  // must not dump hours of production on return, so catch-up is clamped.
  maxCatchUpSeconds: 60,
  collapseHintSeconds: 120, // §9 Stage 2 — unused until the QA Manager exists
};

// --- TUNING -----------------------------------------------------------------
// Placeholder cost curve. DESIGN §14 lists these as "remaining true unknowns"
// to be settled in playtest, so they live in one block for fast iteration.
const TUNING = {
  tapYield: 1,          // raw per tap
  laborerRate: 0.5,     // raw/sec per Laborer
  foremanBonus: 0.25,   // +25% to all Laborers, per Foreman
  superBonus: 0.5,      // +50% to each Foreman's bonus, per Superintendent
  seedPerCapital: 25,   // raw granted per Starting Capital level
  overtimePerLevel: 0.1,// +10% global production per Overtime level
};

// --- THE HIRING LADDER (§6) -------------------------------------------------
// The ladder IS the production system: each tier multiplies the tier below.
// Hired counts reset every structure; the *ability* to hire is latched forever.
const WORKERS = {
  laborer: {
    name: 'Laborer',
    desc: `Extracts ${TUNING.laborerRate}/sec`,
    baseCost: 12, growth: 1.15,
    fromLevel: 1,
  },
  foreman: {
    name: 'Foreman',
    desc: `+${TUNING.foremanBonus * 100}% to all Laborers`,
    baseCost: 120, growth: 1.28,
    fromLevel: 1,
    requires: s => (s.workers.laborer || 0) >= 5,
  },
  superintendent: {
    name: 'Superintendent',
    desc: `+${TUNING.superBonus * 100}% to each Foreman`,
    baseCost: 1500, growth: 1.35,
    fromLevel: 2,
  },
};

// --- LEVELS (§7) ------------------------------------------------------------
// Adding a level = adding a row. Only Level 1 is defined: Level 2+ needs the
// multi-raw worker-allocation rule that DESIGN §15 defers to the Level 3 step.
const LEVELS = [
  {
    id: 1,
    zone: 'Hollow Creek',
    raw:     { id: 'timber', name: 'Timber' },
    refined: { id: 'lumber', name: 'Lumber' },
    buildings: [
      {
        id: 'sawmill',
        name: 'Sawmill',
        input: 'timber', output: 'lumber',
        rate: 1.0,   // input consumed per sec, per building
        yield: 0.5,  // output per unit of input
        baseCost: { timber: 60 }, growth: 1.3,
        requires: s => (s.workers.laborer || 0) >= 3,
      },
    ],
    structure: {
      id: 'trestle',
      name: 'Timber Trestle',
      desc: 'A timber pile trestle across Hollow Creek.',
      cost: { lumber: 300 },
      reputation: 3,
    },
  },
];

// --- REPUTATION UPGRADES (§11) ----------------------------------------------
// The four that actually bear on Level 1. The other four in §11 (Offline
// Efficiency, Unlock Discounts, Prefab, Reputation Yield) need systems that
// don't exist yet, so they're deliberately absent rather than stubbed.
const REP_UPGRADES = {
  tapValue:        { name: 'Tap Value',        desc: '+100% per-tap yield',             baseCost: 2, growth: 2.0 },
  startingCapital: { name: 'Starting Capital', desc: `+${TUNING.seedPerCapital} raw at level start`, baseCost: 3, growth: 2.0 },
  retainedCrew:    { name: 'Retained Crew',    desc: '+1 Laborer kept through reset',   baseCost: 5, growth: 2.5 },
  overtime:        { name: 'Overtime',         desc: '+10% global production',          baseCost: 4, growth: 2.2 },
};

// --- STATE ------------------------------------------------------------------
let state = {
  level: 1,
  resources: {},    // stockpiles          — WIPED on reset (§4)
  workers: {},      // hired counts        — WIPED on reset (§4)
  buildings: {},    // owned counts        — PERSIST (§4)
  unlocked: {},     // latched recipes     — PERSIST (§6)
  gallery: [],      // completed structures— PERSIST (§4)
  reputation: 0,    //                     — PERSIST (§5)
  repUpgrades: {},  //                     — PERSIST
  startTime: Date.now(),
};

let tickSpeed = 1;
let lastTick = Date.now();
const starved = {};  // building id -> bool, drives the §9 warning state

// --- HELPERS ----------------------------------------------------------------
function currentLevel() {
  return LEVELS.find(l => l.id === state.level) || LEVELS[0];
}
function add(res, amt) {
  state.resources[res] = (state.resources[res] || 0) + amt;
}
function canAfford(cost) {
  return Object.entries(cost).every(([r, a]) => (state.resources[r] || 0) >= a);
}
function spend(cost) {
  for (const [r, a] of Object.entries(cost)) state.resources[r] -= a;
}
function isUnlocked(kind, id) {
  return !!state.unlocked[kind + ':' + id];
}

// Latch unlocks permanently. §6: "the ability to hire each tier persists across
// reset" — so a gate that depended on a now-reset worker count must not re-lock.
function checkUnlocks() {
  for (const [id, def] of Object.entries(WORKERS)) {
    const key = 'worker:' + id;
    if (state.unlocked[key]) continue;
    if (state.level < def.fromLevel) continue;
    if (def.requires && !def.requires(state)) continue;
    state.unlocked[key] = true;
  }
  for (const b of currentLevel().buildings) {
    const key = 'building:' + b.id;
    if (state.unlocked[key]) continue;
    if (b.requires && !b.requires(state)) continue;
    state.unlocked[key] = true;
  }
}

// --- PRODUCTION (§3) --------------------------------------------------------
function globalMult() {
  return 1 + TUNING.overtimePerLevel * (state.repUpgrades.overtime || 0);
}
function tapYield() {
  return TUNING.tapYield * (1 + (state.repUpgrades.tapValue || 0));
}
function extractionRate() {
  const w = state.workers;
  const foremanBonus = TUNING.foremanBonus * (1 + TUNING.superBonus * (w.superintendent || 0));
  const laborMult = 1 + (w.foreman || 0) * foremanBonus;
  return (w.laborer || 0) * TUNING.laborerRate * laborMult * globalMult();
}

function produce(dt) {
  const lvl = currentLevel();

  // Extraction is worker-driven — this is what makes a persisted building
  // worthless until the player re-staffs (§3).
  add(lvl.raw.id, extractionRate() * dt);

  // Buildings are recipes + capacity: they convert, capped by available input.
  for (const b of lvl.buildings) {
    const count = state.buildings[b.id] || 0;
    starved[b.id] = false;
    if (!count) continue;

    const want = count * b.rate * globalMult() * dt;
    const have = state.resources[b.input] || 0;
    const used = Math.min(want, have);
    starved[b.id] = used < want - 1e-9;
    if (used <= 0) continue;

    state.resources[b.input] = have - used;
    add(b.output, used * b.yield);
  }
}

// --- COSTS & PURCHASING -----------------------------------------------------
function workerCost(id) {
  const def = WORKERS[id];
  const owned = state.workers[id] || 0;
  return { [currentLevel().raw.id]: Math.ceil(def.baseCost * Math.pow(def.growth, owned)) };
}
function buildingCost(b) {
  const mult = Math.pow(b.growth, state.buildings[b.id] || 0);
  const cost = {};
  for (const [r, a] of Object.entries(b.baseCost)) cost[r] = Math.ceil(a * mult);
  return cost;
}
function repCost(id) {
  const def = REP_UPGRADES[id];
  return Math.ceil(def.baseCost * Math.pow(def.growth, state.repUpgrades[id] || 0));
}

function hire(id) {
  checkUnlocks();  // latch first, so the gate reflects current state either way
  if (!isUnlocked('worker', id)) return;
  const cost = workerCost(id);
  if (!canAfford(cost)) return;
  spend(cost);
  state.workers[id] = (state.workers[id] || 0) + 1;
  checkUnlocks();  // this hire may itself satisfy the next tier's gate
  render();
}
function buyBuilding(id) {
  checkUnlocks();
  const b = currentLevel().buildings.find(x => x.id === id);
  if (!b || !isUnlocked('building', id)) return;
  const cost = buildingCost(b);
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
  // Wipe stockpiles and the entire worker force. Keep buildings, gallery,
  // latched recipes, and Reputation. The persisted factory now STARVES until
  // re-staffed — the opening beat of every level (§3).
  state.resources = {};
  state.workers = {};

  const next = LEVELS.find(l => l.id === state.level + 1);
  if (next) {
    state.level = next.id;
  }
  // If there is no next level we stay put. Replaying Level 1 is the intended
  // way to exercise the reset beat until the multi-raw allocation rule lands.

  const seed = TUNING.seedPerCapital * (state.repUpgrades.startingCapital || 0);
  if (seed) state.resources[currentLevel().raw.id] = seed;

  const crew = state.repUpgrades.retainedCrew || 0;
  if (crew) state.workers.laborer = crew;

  checkUnlocks();  // a new level can open a new tier (e.g. Superintendent)
  render();
}

// --- NUMBER FORMATTING (§12) ------------------------------------------------
const BASE_SUFFIXES = ['', 'K', 'M', 'B', 'T'];

// Beyond T, named idle suffixes (aa, ab, ac, …) — more readable on a phone
// than scientific notation.
function suffixFor(tier) {
  if (tier < BASE_SUFFIXES.length) return BASE_SUFFIXES[tier];
  const i = tier - BASE_SUFFIXES.length;
  const first = Math.floor(i / 26);
  if (first > 25) return 'e' + tier * 3;  // past 'zz'; nothing should reach here
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

function costStr(cost) {
  return Object.entries(cost)
    .map(([r, a]) => `${fmt(a)} ${resourceName(r)}`)
    .join(', ');
}
function resourceName(id) {
  const lvl = currentLevel();
  if (lvl.raw.id === id) return lvl.raw.name;
  if (lvl.refined.id === id) return lvl.refined.name;
  return id;
}

// --- UI CONSTRUCTION --------------------------------------------------------
// Rows are built once and then updated in place, so a click is never lost to a
// mid-tick innerHTML rebuild.
const refs = { workers: {}, buildings: {}, rep: {} };

function row(name, desc, btnLabel, onClick) {
  const el = document.createElement('div');
  el.className = 'upgrade';
  el.innerHTML =
    `<div class="up-info">
       <div class="up-name"></div>
       <div class="up-desc"></div>
       <div class="up-owned">Owned: <span class="count">0</span></div>
     </div>
     <button class="buy-btn">${btnLabel}<span class="cost"></span></button>`;
  el.querySelector('.up-name').textContent = name;
  el.querySelector('.up-desc').textContent = desc;
  el.querySelector('.buy-btn').addEventListener('click', onClick);
  return el;
}

function buildUI() {
  const workerList = document.getElementById('worker-list');
  for (const [id, def] of Object.entries(WORKERS)) {
    const el = row(def.name, def.desc, 'Hire: ', () => hire(id));
    workerList.appendChild(el);
    refs.workers[id] = el;
  }

  const buildingList = document.getElementById('building-list');
  for (const b of currentLevel().buildings) {
    const desc = `${b.rate}/sec ${resourceName(b.input)} → ${b.rate * b.yield}/sec ${resourceName(b.output)}`;
    const el = row(b.name, desc, 'Build: ', () => buyBuilding(b.id));
    buildingList.appendChild(el);
    refs.buildings[b.id] = el;
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
  const lvl = currentLevel();

  renderPanorama();
  renderResources();

  for (const [id, def] of Object.entries(WORKERS)) {
    const el = refs.workers[id];
    const unlocked = isUnlocked('worker', id);
    el.classList.toggle('locked', !unlocked);
    if (!unlocked) continue;
    const cost = workerCost(id);
    el.querySelector('.count').textContent = state.workers[id] || 0;
    el.querySelector('.cost').textContent = costStr(cost);
    el.querySelector('.buy-btn').disabled = !canAfford(cost);
  }

  let anyBuilding = false;
  for (const b of lvl.buildings) {
    const el = refs.buildings[b.id];
    const unlocked = isUnlocked('building', b.id);
    el.classList.toggle('locked', !unlocked);
    if (!unlocked) continue;
    anyBuilding = true;
    const cost = buildingCost(b);
    const count = state.buildings[b.id] || 0;
    el.querySelector('.count').textContent = count;
    el.querySelector('.cost').textContent = costStr(cost);
    el.querySelector('.buy-btn').disabled = !canAfford(cost);
    // A built-but-starved chain is the warning state the collapse UI will reuse.
    el.classList.toggle('starved', count > 0 && starved[b.id]);
  }
  document.getElementById('process-empty').classList.toggle('hidden', anyBuilding);

  for (const id of Object.keys(REP_UPGRADES)) {
    const el = refs.rep[id];
    const cost = repCost(id);
    el.querySelector('.count').textContent = state.repUpgrades[id] || 0;
    el.querySelector('.cost').textContent = `${fmt(cost)} Rep`;
    el.querySelector('.buy-btn').disabled = state.reputation < cost;
  }

  renderStructure();

  document.getElementById('debug-runtime').textContent =
    Math.floor((Date.now() - state.startTime) / 1000) + 's';
  document.getElementById('debug-rate').textContent =
    fmt(extractionRate()) + '/s';
}

function renderResources() {
  const lvl = currentLevel();
  const rows = [
    [lvl.raw.name, fmt(state.resources[lvl.raw.id] || 0)],
    [lvl.refined.name, fmt(state.resources[lvl.refined.id] || 0)],
    ['Reputation', fmt(state.reputation)],
    ['Rate', fmt(extractionRate()) + '/s'],
  ];
  const host = document.getElementById('resources');
  host.innerHTML = rows
    .map(([k, v]) => `<div class="resource"><span class="res-label">${k}</span><span>${v}</span></div>`)
    .join('');
}

// The panorama is the permanent gallery (§4): reset never touches it.
function renderPanorama() {
  const host = document.getElementById('panorama');
  const built = state.gallery
    .map(id => {
      const l = LEVELS.find(x => x.structure.id === id);
      return l ? l.zone : id;
    });
  const lvl = currentLevel();
  const zones = built.map(label => ({ label, built: true }));
  if (!state.gallery.includes(lvl.structure.id)) {
    zones.push({ label: lvl.zone, built: false });
  }

  // A barrier sits BETWEEN two zones — it's the gap a structure spans. Emitting
  // one after the last zone leaves a stub bridging nothing.
  host.innerHTML = zones.map((z, i) =>
    (i > 0 ? '<div class="barrier bridged"></div>' : '') +
    `<div class="zone${z.built ? '' : ' locked'}"><span class="zone-label">${z.label}</span></div>`
  ).join('');
}

function renderStructure() {
  const s = currentLevel().structure;
  const host = document.getElementById('structure-card');
  const [res, need] = Object.entries(s.cost)[0];
  const have = state.resources[res] || 0;
  const pct = Math.min(100, (have / need) * 100);
  const done = state.gallery.includes(s.id);
  const affordable = canAfford(s.cost);

  host.innerHTML =
    `<div class="structure">
       <div class="up-name">${s.name}${done ? ' <span class="built-tag">built</span>' : ''}</div>
       <div class="up-desc">${s.desc}</div>
       <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
       <div class="up-owned">${fmt(have)} / ${fmt(need)} ${resourceName(res)}</div>
       <button class="buy-btn wide" id="build-structure" ${affordable ? '' : 'disabled'}>
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// --- CORE LOOP --------------------------------------------------------------
function tick() {
  const now = Date.now();
  let dt = ((now - lastTick) / 1000) * tickSpeed;
  lastTick = now;
  if (dt > CONFIG.maxCatchUpSeconds) dt = CONFIG.maxCatchUpSeconds;
  checkUnlocks();
  produce(dt);
  render();
}

// --- EVENT WIRING -----------------------------------------------------------
document.getElementById('tap-dig').addEventListener('click', e => {
  add(currentLevel().raw.id, tapYield());
  const btn = e.currentTarget;
  btn.classList.remove('pop');
  void btn.offsetWidth; // force reflow to restart the animation
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
  const lvl = currentLevel();
  add(lvl.raw.id, 1000);
  add(lvl.refined.id, 1000);
  render();
});
document.getElementById('debug-rep').addEventListener('click', () => {
  state.reputation += 10;
  render();
});
document.getElementById('debug-speed').addEventListener('change', e => {
  tickSpeed = parseFloat(e.target.value);
});

// --- SAVE / LOAD ------------------------------------------------------------
function save() {
  try {
    localStorage.setItem(CONFIG.saveKey, JSON.stringify(state));
  } catch (e) { /* ignore quota errors */ }
}

function load() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return;
    const s = JSON.parse(raw) || {};
    // Merge per-key so fields added later don't break an old save.
    state = {
      ...state,
      ...s,
      resources:   { ...(s.resources || {}) },
      workers:     { ...(s.workers || {}) },
      buildings:   { ...(s.buildings || {}) },
      unlocked:    { ...(s.unlocked || {}) },
      repUpgrades: { ...(s.repUpgrades || {}) },
      gallery:     Array.isArray(s.gallery) ? s.gallery : [],
    };
  } catch (e) {
    console.warn('Save load failed', e);
  }
}

// --- BOOT -------------------------------------------------------------------
load();
buildUI();
checkUnlocks();
render();
setInterval(tick, CONFIG.tickRate);
setInterval(save, 5000);
