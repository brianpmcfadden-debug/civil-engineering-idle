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
  principalPerStructure: 0.05, // +5% per completed structure, per Principal
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
  aggregate:  { name: 'Aggregate' },
  cement:     { name: 'Cement' },
  concrete:   { name: 'Concrete' },
  steelplate: { name: 'Steel Plate' },
  rebar:      { name: 'Rebar' },
  strand:     { name: 'Strand' },
  cable:      { name: 'Cable' },
};
const resName = id => (RESOURCES[id] || { name: id }).name;

// Accurate to the trade — the tone rule (§1) is grounded vocabulary.
const TAP_VERB = {
  timber: 'Fell Timber', stone: 'Quarry Stone',
  ironore: 'Dig Ore', coal: 'Dig Coal', aggregate: 'Dig Aggregate',
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
  principal: {
    name: 'Principal',
    // §6: global multiplier that scales with structures completed — so it is
    // worth progressively more the deeper the gallery gets.
    desc: '+5% global output per structure in your skyline',
    baseCost: 20000, growth: 1.6, fromLevel: 5,
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
  kiln: {
    name: 'Kiln', fromLevel: 4,
    // Coal fires the kiln (§7) — the same coal chain the smelter needs, so
    // Level 4 is the first real competition for a single raw.
    inputs: { aggregate: 1.0, coal: 0.4 }, outputs: { cement: 0.35 },
    baseCost: { cutstone: 500, iron: 200 }, growth: 1.32,
  },
  batchPlant: {
    name: 'Batch Plant', fromLevel: 4,
    inputs: { cement: 0.6, aggregate: 1.0 }, outputs: { concrete: 0.5 },
    baseCost: { iron: 400, lumber: 300 }, growth: 1.32,
  },
  rollingMill: {
    name: 'Rolling Mill', fromLevel: 5,
    // Two outputs from one pass, as a real mill would run.
    inputs: { iron: 1.2, coal: 0.6 }, outputs: { steelplate: 0.35, rebar: 0.15 },
    baseCost: { iron: 1200, concrete: 400 }, growth: 1.34,
  },
  strandMill: {
    name: 'Strand Mill', fromLevel: 6,
    inputs: { steelplate: 0.9 }, outputs: { strand: 0.3 },
    baseCost: { steelplate: 1500, concrete: 800 }, growth: 1.34,
  },
  wireSpinning: {
    name: 'Wire Spinning', fromLevel: 7,
    inputs: { strand: 0.8 }, outputs: { cable: 0.25 },
    baseCost: { strand: 2000, concrete: 1500 }, growth: 1.36,
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
  {
    id: 4, zone: 'Slack Water',
    // Limestone was merged into Aggregate (§7) — six raws at once was the
    // game's most punishing point and the realism cost is invisible.
    newRaws: [{ id: 'aggregate', name: 'Aggregate' }],
    wageRaw: 'aggregate',
    structure: {
      id: 'slab', name: 'RC Slab Bridge',
      desc: 'A reinforced concrete slab span on spread footings.',
      cost: { concrete: 2500, lumber: 600 }, reputation: 12,
    },
  },
  // Levels 5-7 add no new raws (§7): the widening stops at five and the rest of
  // the game is depth — new processes stacked on the chains already running.
  {
    id: 5, zone: 'Ironworks Reach',
    newRaws: [], wageRaw: 'aggregate',
    structure: {
      id: 'girder', name: 'Plate Girder Bridge',
      desc: 'Riveted plate girders on concrete abutments.',
      cost: { steelplate: 4000, concrete: 1200 }, reputation: 18,
    },
  },
  {
    id: 6, zone: 'Long Meadow',
    newRaws: [], wageRaw: 'aggregate',
    structure: {
      id: 'boxbeam', name: 'Prestressed Box Beam',
      desc: 'Post-tensioned box girders, strand stressed against concrete.',
      // §7: steel and concrete both required.
      cost: { strand: 3000, concrete: 2000 }, reputation: 26,
    },
  },
  {
    id: 7, zone: 'The Narrows',
    newRaws: [], wageRaw: 'aggregate',
    structure: {
      id: 'cablestay', name: 'Cable-Stayed Span',
      desc: 'A cable-stayed main span — the profession\'s ceiling.',
      // §7 back-reference: everything upstream.
      cost: { cable: 5000, concrete: 3000, steelplate: 2000 }, reputation: 40,
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
  assignment: ['Materials',
    'Mine takes one unit by hand. Hire puts a laborer on that material, paid out ' +
    'of that material — timber crews cost timber, ore crews cost ore. ' +
    'A hire stays on its material for the rest of the level; there is no ' +
    'transferring, so decide the split as you build it. If a chain is short, hire ' +
    'more onto it rather than moving anyone. Everything resets when you complete ' +
    'a structure, so a bad split is never permanent. ' +
    'Crew output counts only laborers — mining by hand is a one-off grab and does ' +
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
  operations: ['Operations',
    'Only things currently costing you output, worst first. Nothing here is a ' +
    'control — it is a diagnosis, and "Fix" jumps you to the row that needs the ' +
    'change. A starved chain is ranked by how much production it is actually ' +
    'losing, so a big chain running at half speed outranks a small one stopped ' +
    'dead. Anything the structure needs that nothing is producing outranks ' +
    'everything, because it is a hard stop rather than a slowdown. ' +
    'An empty list means every chain is fed and the whole crew is working.'],
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
  paused: {},      // buildingId -> true. Player's choice, so it PERSISTS.
  offlineUnlocked: false,  // latched on the first PM hire — PERSISTS (§10)
  lastSeen: Date.now(),
  startTime: Date.now(),
};

let tickSpeed = 1;
let lastTick = Date.now();
const starved = {};
const limitedBy = {};     // buildingId -> the input resource that is short
const runScale = {};      // buildingId -> 0..1 fraction of capacity running
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
  if (l.wageRaw) return l.wageRaw;
  // Levels that add no new raw fall back to the newest one available.
  const raws = availableRaws();
  return raws[raws.length - 1].id;
}

const add = (res, amt) => { state.resources[res] = (state.resources[res] || 0) + amt; };
const canAfford = cost => Object.entries(cost).every(([r, a]) => (state.resources[r] || 0) >= a);
const spend = cost => { for (const [r, a] of Object.entries(cost)) state.resources[r] -= a; };
const isUnlocked = (kind, id) => !!state.unlocked[kind + ':' + id];

const totalAssigned = () => Object.values(state.assign).reduce((a, b) => a + b, 0);
const unassigned = () => (state.workers.laborer || 0) - totalAssigned();
// §10 says offline is "unlocked by hiring the first Project Manager" — a
// permanent unlock. Keying it off currently-having-a-PM silently switched it
// back off at every reset, since resets wipe the whole crew (§4).
const hasOffline = () => !!state.offlineUnlocked;
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
  (1 + TUNING.pmBonus * (state.workers.projectManager || 0)) *
  // Principals scale with the skyline, so they are near-worthless early and
  // compound hard once the gallery fills (§6).
  (1 + TUNING.principalPerStructure * (state.workers.principal || 0) * state.gallery.length);
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
    // An idled plant consumes nothing. Without this, a plant persisted from
    // earlier levels eats every unit you mine by hand the moment a new level
    // starts, so you can never accumulate enough raw material to re-hire.
    if (state.paused[id]) { runScale[id] = 0; continue; }

    // Run at the fraction the scarcest input allows, and remember WHICH input
    // is short — "starved" alone doesn't tell the player what to go fix.
    let scale = 1, limiting = null;
    for (const [res, rate] of Object.entries(b.inputs)) {
      const want = count * rate * globalMult() * dt;
      if (want <= 0) continue;
      const s = (state.resources[res] || 0) / want;
      if (s < scale) { scale = s; limiting = res; }
    }
    scale = Math.max(0, Math.min(1, scale));
    starved[id] = scale < 1 - 1e-9;
    limitedBy[id] = starved[id] ? limiting : null;
    runScale[id] = scale;   // how much of capacity is actually running
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

// --- OPERATIONS (§9 Stage 3) ------------------------------------------------
// Diagnosis only, never controls. Severity is measured in units/sec of output
// actually being lost, so unrelated problems rank against each other honestly
// instead of by category.
const OPS_FROM_LEVEL = 5;

function bottlenecks() {
  const out = [];

  // 1. A built chain that cannot get enough input.
  for (const [id, b] of Object.entries(BUILDINGS)) {
    const count = state.buildings[id] || 0;
    if (!count || !starved[id]) continue;
    const o = outputRateOf(id);
    const lost = o.rate * (1 - (runScale[id] || 0));
    if (lost <= 1e-6) continue;
    out.push({
      severity: lost,
      title: `${b.name} starved`,
      detail: limitedBy[id]
        ? `Short of ${resName(limitedBy[id])} — running at ${Math.round((runScale[id] || 0) * 100)}% of capacity`
        : `Running at ${Math.round((runScale[id] || 0) * 100)}% of capacity`,
      cost: `−${fmt(lost)}/s ${resName(o.res)}`,
      jump: { tab: 'process', el: refs.buildings[id] },
    });
  }

  // 2. Crew standing around.
  const idle = unassigned();
  if (idle > 0) {
    const lost = idle * TUNING.laborerRate * laborMult() * globalMult();
    out.push({
      severity: lost,
      title: `${idle} laborer${idle > 1 ? 's' : ''} unassigned`,
      detail: 'Idle crew extract nothing. Put them on a material.',
      cost: `−${fmt(lost)}/s`,
      jump: { tab: 'extract', el: null },
    });
  }

  // 3. The structure needs something nothing is making. A hard blocker, not a
  // slowdown, so it outranks throughput losses.
  const s = currentLevel().structure;
  for (const [res, need] of Object.entries(s.cost)) {
    if ((state.resources[res] || 0) >= need) continue;
    const extracted = (state.assign[res] || 0) > 0;
    let produced = false;
    for (const [id, b] of Object.entries(BUILDINGS)) {
      if ((state.buildings[id] || 0) > 0 && b.outputs[res] &&
          !starved[id] && !state.paused[id]) produced = true;
    }
    if (extracted || produced) continue;
    const maker = Object.entries(BUILDINGS).find(([, b]) => b.outputs[res]);
    out.push({
      severity: Infinity,
      title: `No ${resName(res)} being produced`,
      detail: maker
        ? `${s.name} needs ${fmt(need)} — build or feed a ${maker[1].name}.`
        : `${s.name} needs ${fmt(need)} — put crew on it.`,
      cost: 'blocked',
      jump: { tab: maker ? 'process' : 'extract', el: maker ? refs.buildings[maker[0]] : refs.raws[res] },
    });
  }

  // 4. A plant you idled yourself, whose output this level actually needs.
  // Idling is the right move while re-staffing, and exactly the thing you then
  // forget to undo.
  const chain = new Set(relevantResources());
  for (const [id, b] of Object.entries(BUILDINGS)) {
    if (!(state.buildings[id] > 0) || !state.paused[id]) continue;
    if (!Object.keys(b.outputs).some(o => chain.has(o))) continue;
    const o = outputRateOf(id);
    out.push({
      severity: o.rate,
      title: `${b.name} idled`,
      detail: 'You idled this. Resume it once there is crew to feed it.',
      cost: `−${fmt(o.rate)}/s ${resName(o.res)}`,
      jump: { tab: 'process', el: refs.buildings[id] },
    });
  }

  return out.sort((a, b) => b.severity - a.severity);
}

function showTab(name) {
  document.querySelectorAll('#tabs .tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById('tab-' + name).classList.remove('hidden');
}

// Jump-link: switch tab, scroll to the row, flash it once so the eye lands.
function jumpTo(jump) {
  showTab(jump.tab);
  if (!jump.el) return;
  jump.el.scrollIntoView({ block: 'center' });
  jump.el.classList.remove('flash');
  void jump.el.offsetWidth;
  jump.el.classList.add('flash');
}

// --- OFFLINE PROGRESS (§10) -------------------------------------------------
const offlineEfficiency = () =>
  Math.min(1, TUNING.offlineBase + TUNING.offlinePerLevel * (state.repUpgrades.offlineEff || 0));

function applyOfflineProgress() {
  const away = (Date.now() - (state.lastSeen || Date.now())) / 1000;
  if (away < 60) return null;
  // Locked until the first Project Manager (§10). Say so rather than appearing
  // to do nothing — silence here reads as a broken game.
  if (!hasOffline()) return { locked: true, away };

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
function workerCost(id, rawId) {
  const def = WORKERS[id];
  const amount = Math.ceil(def.baseCost * Math.pow(def.growth, state.workers[id] || 0));
  // Laborers are hired against a specific material and paid out of that
  // operation. Billing a timber crew in stone made no sense on Level 2.
  // The amount still follows one crew-wide ladder (§6) — only the currency
  // changes, so hiring from your biggest pile is a mild, legible choice.
  return { [(id === 'laborer' && rawId) ? rawId : primaryRaw()]: amount };
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

function hire(id, rawId) {
  checkUnlocks();
  if (!isUnlocked('worker', id)) return;
  const cost = workerCost(id, rawId);
  if (!canAfford(cost)) return;
  spend(cost);
  state.workers[id] = (state.workers[id] || 0) + 1;

  if (id === 'laborer') {
    // Hired against a material, so they start on it immediately.
    if (rawId) state.assign[rawId] = (state.assign[rawId] || 0) + 1;
    else autoAssign(1);
  }
  if (id === 'projectManager') state.offlineUnlocked = true;

  checkUnlocks();
  render();
}

// Manual extraction of one specific material (§3 tapping).
function mineRaw(rawId) {
  add(rawId, tapYield());
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

// Reassignment is deliberately absent. A laborer hired against a material is
// paid out of it and stays on it for the level. Allowing transfers made the
// per-material wage meaningless: you could hire everyone with whatever was
// cheapest and immediately move them onto the expensive material. Getting the
// split right is now the decision, and the fix for a bad one is to hire more,
// not to shuffle.

function toggleCollapse(id) {
  state.collapsed[id] = !state.collapsed[id];
  render();
}
function togglePause(id) {
  state.paused[id] = !state.paused[id];
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
    el.className = 'assign-row';
    el.innerHTML =
      `<div class="assign-head">
         <div class="up-name">${r.name}</div>
         <div class="up-desc rate-line"></div>
       </div>
       <div class="assign-controls">
         <button class="mine-btn">Mine</button>
         <button class="hire-btn">Hire <span class="hire-cost"></span></button>
         <div class="crew-badge"><span class="assigned">0</span> crew</div>
       </div>`;
    el.querySelector('.mine-btn').addEventListener('click', () => mineRaw(r.id));
    el.querySelector('.hire-btn').addEventListener('click', () => hire('laborer', r.id));
    rawList.appendChild(el);
    refs.raws[r.id] = el;
  }

  const workerList = document.getElementById('worker-list');
  for (const [id, def] of Object.entries(WORKERS)) {
    // Laborers are hired per material up in Assignment; a second generic Hire
    // button here would bill an arbitrary material and confuse the two.
    if (id === 'laborer') continue;
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
    el.querySelector('.up-info').insertAdjacentHTML('beforeend', '<div class="status"></div>');
    // Chip lives inside the info block: a two-input recipe wraps to two lines,
    // and a sibling flex item ends up wedged mid-sentence.
    const chip = document.createElement('button');
    chip.className = 'collapse-chip hidden';
    chip.addEventListener('click', () => toggleCollapse(id));
    el.querySelector('.up-info').appendChild(chip);

    const pause = document.createElement('button');
    pause.className = 'pause-btn';
    pause.addEventListener('click', () => togglePause(id));
    el.insertBefore(pause, el.querySelector('.buy-btn'));
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
    const crew = state.assign[id] || 0;
    el.querySelector('.assigned').textContent = crew;
    el.querySelector('.rate-line').textContent =
      `${fmt(extractionRateFor(id))}/sec · ${fmt(state.resources[id] || 0)} held`;

    const cost = workerCost('laborer', id);
    el.querySelector('.hire-cost').textContent = fmt(cost[id]);
    el.querySelector('.hire-btn').disabled = !canAfford(cost);
    el.querySelector('.mine-btn').textContent = `Mine +${fmt(tapYield())}`;
  }
  document.getElementById('unassigned-count').textContent = unassigned();
  document.getElementById('unassigned-note').classList.toggle('hidden', unassigned() <= 0);

  for (const id of Object.keys(WORKERS)) {
    const el = refs.workers[id];
    if (!el) continue;   // Laborers have no Crew row — they're hired per material
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
    el.classList.toggle('running', count > 0 && !starved[id] && !state.paused[id]);

    // A built, fed building should look obviously alive. Previously the only
    // visible state change was starvation, so a working chain read as dead.
    // This line doubles as the collapsed summary §9 asks for (name, rate,
    // status), so a collapsed row just hides the recipe and keeps this.
    const o = outputRateOf(id);
    const st = el.querySelector('.status');
    const pauseBtn = el.querySelector('.pause-btn');
    pauseBtn.classList.toggle('hidden', count === 0);
    pauseBtn.textContent = state.paused[id] ? 'Resume' : 'Idle';
    el.classList.toggle('paused', count > 0 && !!state.paused[id]);

    if (count === 0) {
      st.textContent = 'none built';
      st.dataset.state = 'idle';
    } else if (state.paused[id]) {
      st.textContent = `${count}× · idled — consuming nothing`;
      st.dataset.state = 'idle';
    } else if (starved[id]) {
      st.textContent = `${count}× · starved` +
        (limitedBy[id] ? ` — needs ${resName(limitedBy[id])}` : '');
      st.dataset.state = 'warn';
    } else {
      st.textContent = `${count}× · running · ${fmt(o.rate)}/s ${resName(o.res)}`;
      st.dataset.state = 'run';
    }

    // Collapsed chains stay collapsed even when they go into warning (§9).
    const isCollapsed = !!state.collapsed[id];
    el.classList.toggle('collapsed', isCollapsed);
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
  renderOps();

  // One material means one obvious action, so keep the big satisfying button.
  // With several materials it becomes ambiguous ("work the site" on what?), so
  // the per-material Mine buttons take over instead.
  const single = raws.length === 1;
  document.getElementById('manual').classList.toggle('hidden', !single);
  if (single) {
    document.getElementById('tap-dig').textContent =
      `${TAP_VERB[raws[0].id] || 'Extract'} (+${fmt(tapYield())} ${raws[0].name})`;
  }
  document.getElementById('site-name').textContent = currentLevel().zone;

  document.getElementById('debug-runtime').textContent =
    Math.floor((Date.now() - state.startTime) / 1000) + 's';
  document.getElementById('debug-rate').textContent = fmt(totalExtractionRate()) + '/s';
}

// Which materials belong on the bar this level: what the structure needs, plus
// everything upstream of it (including what the plants cost to build), plus any
// raw you can put crew on.
//
// Deliberately independent of how much you currently HOLD. Keying it off stock
// meant a material consumed as fast as it is produced flickered in and out of
// the grid, and every tap of Mine bounced the whole page.
function relevantResources() {
  const set = new Set(Object.keys(currentLevel().structure.cost));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, b] of Object.entries(BUILDINGS)) {
      if (b.fromLevel > state.level) continue;
      if (!Object.keys(b.outputs).some(o => set.has(o))) continue;
      for (const r of [...Object.keys(b.inputs), ...Object.keys(b.baseCost)]) {
        if (!set.has(r)) { set.add(r); grew = true; }
      }
    }
  }
  for (const r of availableRaws()) set.add(r.id);
  // RESOURCES is declared in chain order, so this reads raw -> refined.
  return Object.keys(RESOURCES).filter(id => set.has(id));
}

function renderResources() {
  const rows = relevantResources().map(id => [resName(id), fmt(state.resources[id] || 0)]);
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

function renderOps() {
  const unlocked = state.level >= OPS_FROM_LEVEL;
  document.getElementById('tab-btn-ops').classList.toggle('hidden', !unlocked);
  if (!unlocked) return;

  const items = bottlenecks();
  const host = document.getElementById('ops-list');
  document.getElementById('ops-clear').classList.toggle('hidden', items.length > 0);

  // Rebuilding wholesale would drop the click handlers mid-tap, so reuse rows.
  while (host.children.length > items.length) host.lastChild.remove();
  while (host.children.length < items.length) {
    const el = document.createElement('div');
    el.className = 'ops-row';
    el.innerHTML =
      `<div class="ops-info">
         <div class="ops-title"></div>
         <div class="ops-detail"></div>
       </div>
       <div class="ops-right"><div class="ops-cost"></div><button class="ops-jump">Fix →</button></div>`;
    host.appendChild(el);
  }
  items.forEach((it, i) => {
    const el = host.children[i];
    el.querySelector('.ops-title').textContent = it.title;
    el.querySelector('.ops-detail').textContent = it.detail;
    el.querySelector('.ops-cost').textContent = it.cost;
    el.dataset.severity = it.severity === Infinity ? 'blocked' : (i === 0 ? 'top' : 'normal');
    el.querySelector('.ops-jump').onclick = () => jumpTo(it.jump);
  });
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
  // Only shown on single-material levels; multi-material uses per-row Mine.
  const raws = availableRaws();
  add(raws[0].id, tapYield());
  const btn = e.currentTarget;
  btn.classList.remove('pop');
  void btn.offsetWidth;
  btn.classList.add('pop');
  render();
});

document.querySelectorAll('#tabs .tab').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
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
      paused:      { ...(s.paused || {}) },
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
    // Saves written before the assignment system existed have a crew but no
    // assignment map, so every Laborer would load idle: crew output reads zero
    // and hiring more just grows an unassigned pile. Put any idle crew to work.
    const idle = cap - totalAssigned();
    if (idle > 0) autoAssign(idle);
    // Saves from before the latch existed: anyone holding a PM had earned the
    // unlock, so honour it rather than making them re-buy one.
    if ((state.workers.projectManager || 0) > 0) state.offlineUnlocked = true;
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
if (offline && offline.locked) {
  showToast(`Away ${durationStr(offline.away)} — the site was shut down. ` +
            `Hire a Project Manager to keep it running while you're gone.`);
} else if (offline) {
  const parts = Object.entries(offline.gained)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([r, v]) => `${fmt(v)} ${resName(r)}`);
  showToast(parts.length
    ? `Away ${durationStr(offline.away)} — crew produced ${parts.join(', ')}`
    : `Away ${durationStr(offline.away)} — nothing produced, chains were starved`);
}

setInterval(tick, CONFIG.tickRate);
setInterval(save, 5000);
