// =====================================================
// Civil Engineering Idle — Prototype
// All game logic in one file, intentionally simple.
// =====================================================

// --- CONFIG: tune these to change game feel ---
const CONFIG = {
  tickRate: 100,        // ms per tick (10 ticks/sec)
  costGrowth: 1.15,     // cost multiplier per purchase
  saveKey: 'civilIdleProto',
};

// Definition of every purchasable thing.
// Adding a new building = adding a row here. ScriptableObject equivalent.
const BUILDINGS = {
  shovel: {
    name: 'Hand Shovel',
    baseCost: { aggregate: 10 },
    produces: { aggregate: 1 },
    repeatable: true,
  },
  pickaxe: {
    name: 'Pickaxe',
    baseCost: { aggregate: 25 },
    produces: { stone: 1 },
    repeatable: true,
    unlockWhen: state => state.buildings.shovel >= 3,
  },
  footpath: {
    name: 'Footpath',
    baseCost: { aggregate: 50, stone: 10 },
    produces: { coins: 1 },
    repeatable: true,
    unlockWhen: state => state.buildings.pickaxe >= 1,
  },
  bridge: {
    name: 'Wooden Footbridge',
    baseCost: { aggregate: 100, timber: 20 },
    produces: {},
    repeatable: false,
    onBuild: state => {
      state.zone2Unlocked = true;
      showToast('Pine Stand unlocked!');
    },
  },
  axe: {
    name: "Lumberjack's Axe",
    baseCost: { aggregate: 75 },
    produces: { timber: 1 },
    repeatable: true,
    requiresZone: 2,
  },
};

// --- STATE: the entire game in one object ---
let state = {
  resources: { aggregate: 0, stone: 0, timber: 0, coins: 0 },
  buildings: { shovel: 0, pickaxe: 0, footpath: 0, bridge: 0, axe: 0 },
  zone2Unlocked: false,
  startTime: Date.now(),
  // Bootstrap timber: small grove on home side so bridge is achievable
  // before we have lumber zone access. Players get a tiny passive trickle.
  homeTimberRate: 0.1, // per sec
};

// --- CORE LOOP ---
let tickSpeed = 1; // multiplier from debug panel
let lastTick = Date.now();

function tick() {
  const now = Date.now();
  const dt = ((now - lastTick) / 1000) * tickSpeed;
  lastTick = now;

  // Production from buildings
  for (const [id, count] of Object.entries(state.buildings)) {
    if (count === 0) continue;
    const def = BUILDINGS[id];
    for (const [res, rate] of Object.entries(def.produces)) {
      state.resources[res] = (state.resources[res] || 0) + rate * count * dt;
    }
  }

  // Bootstrap timber trickle (lets player afford first bridge)
  state.resources.timber += state.homeTimberRate * dt;

  render();
}

// --- PURCHASE LOGIC ---
function getCost(id) {
  const def = BUILDINGS[id];
  const owned = state.buildings[id] || 0;
  const mult = def.repeatable ? Math.pow(CONFIG.costGrowth, owned) : 1;
  const cost = {};
  for (const [res, amt] of Object.entries(def.baseCost)) {
    cost[res] = Math.ceil(amt * mult);
  }
  return cost;
}

function canAfford(cost) {
  return Object.entries(cost).every(([res, amt]) => state.resources[res] >= amt);
}

function buy(id) {
  const def = BUILDINGS[id];
  if (!def) return;
  if (!def.repeatable && state.buildings[id] >= 1) return;
  const cost = getCost(id);
  if (!canAfford(cost)) return;

  for (const [res, amt] of Object.entries(cost)) {
    state.resources[res] -= amt;
  }
  state.buildings[id] = (state.buildings[id] || 0) + 1;

  if (def.onBuild) def.onBuild(state);

  render();
}

// --- RENDER: update the DOM each tick ---
function fmt(n) {
  // Number formatter — extend later for K/M/B suffixes
  if (n < 100) return n.toFixed(1);
  if (n < 10000) return Math.floor(n).toString();
  if (n < 1e6) return (n / 1000).toFixed(1) + 'K';
  if (n < 1e9) return (n / 1e6).toFixed(2) + 'M';
  return (n / 1e9).toFixed(2) + 'B';
}

function render() {
  // Resources
  document.getElementById('res-aggregate').textContent = fmt(state.resources.aggregate);
  document.getElementById('res-stone').textContent = fmt(state.resources.stone);
  document.getElementById('res-timber').textContent = fmt(state.resources.timber);
  document.getElementById('res-coins').textContent = fmt(state.resources.coins);

  // Upgrades — visibility, costs, button state
  for (const id of Object.keys(BUILDINGS)) {
    const def = BUILDINGS[id];
    const el = document.getElementById('up-' + id);
    if (!el) continue;

    // Unlock check
    let unlocked = true;
    if (def.unlockWhen && !def.unlockWhen(state)) unlocked = false;
    if (def.requiresZone === 2 && !state.zone2Unlocked) unlocked = false;
    el.classList.toggle('locked', !unlocked);

    // Owned count
    const countEl = el.querySelector('.count');
    if (countEl) countEl.textContent = state.buildings[id] || 0;

    // Cost & button state
    const btn = el.querySelector('.buy-btn');
    const cost = getCost(id);
    const costStr = Object.entries(cost)
      .map(([res, amt]) => `${fmt(amt)} ${res.slice(0,3)}`)
      .join(', ');
    btn.querySelector('.cost').textContent = costStr;
    btn.disabled = !canAfford(cost) || (!def.repeatable && state.buildings[id] >= 1);
  }

  // Zone 2 unlock styling
  document.getElementById('game').classList.toggle('zone-2-unlocked', state.zone2Unlocked);
  document.getElementById('zone-2-visual').classList.toggle('locked', !state.zone2Unlocked);
  document.getElementById('barrier-1-visual').classList.toggle('bridged', state.buildings.bridge >= 1);

  // Debug
  document.getElementById('debug-runtime').textContent =
    Math.floor((Date.now() - state.startTime) / 1000) + 's';
}

// --- TOAST notifications ---
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// --- EVENT WIRING ---
document.getElementById('tap-dig').addEventListener('click', e => {
  state.resources.aggregate += 1;
  e.target.classList.remove('pop');
  void e.target.offsetWidth; // force reflow to restart animation
  e.target.classList.add('pop');
  render();
});

document.querySelectorAll('.buy-btn').forEach(btn => {
  btn.addEventListener('click', () => buy(btn.dataset.id));
});

document.getElementById('debug-reset').addEventListener('click', () => {
  if (confirm('Reset game?')) {
    localStorage.removeItem(CONFIG.saveKey);
    location.reload();
  }
});

document.getElementById('debug-resources').addEventListener('click', () => {
  for (const k of Object.keys(state.resources)) state.resources[k] += 1000;
  render();
});

document.getElementById('debug-speed').addEventListener('change', e => {
  tickSpeed = parseFloat(e.target.value);
});

// --- SAVE / LOAD ---
function save() {
  try {
    localStorage.setItem(CONFIG.saveKey, JSON.stringify(state));
  } catch (e) { /* ignore quota errors in prototype */ }
}

function load() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return;
    const loaded = JSON.parse(raw);
    // Shallow merge so new fields added later don't break old saves
    state = { ...state, ...loaded };
  } catch (e) {
    console.warn('Save load failed', e);
  }
}

// --- BOOT ---
load();
setInterval(tick, CONFIG.tickRate);
setInterval(save, 5000);
render();
