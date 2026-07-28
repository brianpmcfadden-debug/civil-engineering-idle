# Civil Engineering Idle Game — Design Doc v0.2

**Platform:** Browser (mobile-first, portrait). Continues the prototype in this repo (`game.js` / `index.html` / `styles.css`).
**Status:** Core loop, progression, and all v0.1 open questions **resolved**. Remaining unknowns are cost-curve numbers, the collapse threshold `N` (playtest), Reputation upgrade costs, and Act IV's full structure list — all deferred by design, none block Level 1.

---

## What changed from v0.1

- **Added §3 Production Model** — the spine. Production is *worker-driven*; buildings are recipes + capacity, not producers. This is the biggest clarification and it resolves the reset question for free.
- **Reset question (v0.1 Open Q #1) resolved:** buildings/recipes persist, workers reset. Safe from trivialization because persisted buildings *starve* without workers.
- **Panorama = permanent gallery.** The prototype's zone-accretion visual is kept and repurposed: each level adds a zone; reset wipes stockpiles, not the skyline.
- **`coins` currency cut.** It violated the three-currency ceiling. Reputation is the only meta-currency.
- **Level 4 raws merged** (Limestone folded into Aggregate).
- **Act IV added** — grounded ending at the cable-stayed span, with an opt-in absurd space-structures branch unlocked at the final prestige.
- **§11 Reputation menu** and **§12 number formatting** specified.
- **§13 Reconciliation with the prototype** added — what's kept, inverted, cut, and built.

---

## 1. Premise

You are a construction operation that grows from one person with a shovel into a firm capable of building major crossings. Progress is measured in structures completed. Each structure is a level; each level introduces new raw materials, new processing, and ends by unlocking the structure itself.

**Tone:** grounded and real. Material names, job titles, and process names are accurate to the profession. The humor comes from scale escalation, not from jokes.

---

## 2. Core Loop

1. Tap to extract raw material.
2. Hire **workers** to automate extraction.
3. Unlock **processing buildings** to convert raw → refined material.
4. Scale the chain until you can afford the level's structure.
5. Build the structure. **Reset.** New materials and a new structure unlock.

---

## 3. Production Model (the spine)

Three kinds of thing, with three different lifespans:

| Thing | Role | Lifespan |
|---|---|---|
| **Workers** (hiring ladder, §5) | The production force. Extract raw; higher tiers multiply the force. | **Reset** every structure |
| **Buildings** | Recipes + capacity. Convert raw → refined at a rate, capped by available input. | **Persist** forever |
| **Structures** | The level goal. Consume a large quantity of the level's top refined material. | **Permanent** (gallery) |

**Flow:** Tap or Workers → raw material → Buildings convert → refined material → Structure consumes → level complete.

**Why this resolves the reset question cleanly:** because extraction is worker-driven, a persisted building produces **nothing** with zero workers — it starves for input. So after a reset you keep every building you ever unlocked, but the whole operation is idle until you **re-staff** it. "Keep the factory, re-staff it" is therefore *emergent*, not a special-cased balance hack, and the v0.1 worry that persisting buildings would trivialize early tiers goes away — a persisted Sawmill is worthless until Laborers feed it timber again.

Re-staffing is the fast, satisfying opening beat of every level.

**Tapping** is manual raw extraction, always available, and scales *only* via Reputation (§11, Tap Value). It is designed to become a negligible fraction of throughput by Level 3 — the player's activity shifts from tapping to reviewing (the Paperclips model). Do not artificially keep it relevant; a player who *wants* it relevant can invest Reputation, but the default path lets it fade.

---

## 4. Prestige / Reset Rules

Reset triggers on **structure completion**, not a player-chosen prestige button.

**Resets:**
- All raw material stockpiles
- All refined material stockpiles
- The entire worker force (all tiers → 0)

**Persists:**
- Unlocked recipes and processes (you never re-learn smelting)
- All buildings (you keep the factory; you re-staff it)
- Completed structures — the panorama **gallery** keeps accreting one zone per level
- Reputation (meta-currency, §11)

**Panorama as gallery:** the prototype's top-of-screen panorama (zones filling in, barriers getting bridged) is the permanent record. Reset never touches it. By endgame it is a skyline of every structure you have built — the emotional payoff that keeps the reset from feeling like a wipe. (Portrait width means the panorama scrolls or shows the most recent N zones as the count grows — an implementation detail, not a design lock.)

---

## 5. Currencies

Three currencies is the ceiling. Do not add a fourth. (v0.1's `coins` is **cut**.)

| Currency | Scope | Purpose |
|---|---|---|
| Raw materials | Per level, resets | Inputs to processing |
| Refined materials | Per level, resets | Inputs to the structure |
| **Reputation** | Permanent | Earned on structure completion. Buys global meta-upgrades (§11). |

---

## 6. The Hiring Ladder

The ladder **is** the production system (§3), not a multiplier bolted onto building output. Each tier multiplies the tier below it.

| Tier | Effect | Unlocks |
|---|---|---|
| **You (tapping)** | Manual extraction | Start |
| **Laborer** | Auto-extracts raw at a fixed rate | Level 1 early |
| **Foreman** | +% to all Laborers | Level 1 late |
| **Superintendent** | +% to all Foremen | Level 2 |
| **Project Manager** | +% globally, **unlocks offline accrual** | Level 3 |
| **QA Manager** | No production effect — unlocks UI collapse (§8) | Level 3 mid |
| **Principal** | Global multiplier, scales with structures completed | Level 5 |

The *ability* to hire each tier persists across reset (it's an unlocked recipe); the *hired count* resets to zero. So at Level 3 you already know how to hire Superintendents — you just have to hire them again from scratch.

---

## 7. Progression Table

Every level adds at least one recipe that consumes an **earlier** material, so no chain ever goes dead. Because buildings persist, you keep the upstream factory alive across resets to feed each level's back-reference.

| Level | New Raw | New Process | Refined Output | Structure | Back-reference |
|---|---|---|---|---|---|
| 1 | Timber | Sawmill | Lumber | Timber trestle | — |
| 2 | Stone | Stone yard | Cut stone | Stone arch | Lumber → centering/falsework |
| 3 | Iron ore, Coal | Smelter | Iron | Iron truss | Coal fires the smelter |
| 4 | Aggregate | Kiln → Batch plant | Cement → Concrete | RC slab bridge | Coal fires the kiln; lumber → formwork |
| 5 | — | Rolling mill | Steel plate, Rebar | Plate girder bridge | Iron + coal at volume |
| 6 | — | Strand mill | Prestressing strand | Prestressed box beam | Steel + concrete both required |
| 7 | — | Wire spinning | Structural cable | Cable-stayed span | Everything upstream |

*(Level 4: Limestone merged into a single "Aggregate" raw — six raws at once was the game's widest, most punishing point; the realism cost is invisible to players.)*

**Structure cost design:** the structure is the level's final unlock and consumes a large quantity of the level's top-tier refined material. The endgame of each level is scaling one specific chain hard, not scaling everything evenly.

---

## 8. Act IV — Optional Absurd Branch

**The grounded game ends at the cable-stayed span (Level 7).** Completing it is a full, satisfying ending: a seven-structure gallery, the real profession's ceiling.

At that final prestige the player is offered a choice:
- **Conclude** — the grounded ending. Gallery complete.
- **"Click absurdity"** — opt-in unlock of **Act IV: space structures.**

Design rules for Act IV:
- **Unforeshadowed.** Levels 1–7 are written completely straight. Act IV is a *reveal*, not a setup — so nothing in the grounded game plants sci-fi seeds.
- **Materially continuous.** The cable-stayed span's structural cable is the natural feedstock for a space-elevator tether. Act IV escalates the *existing* cable chain into orbit rather than hard-cutting to a new genre.
- **Still grounded vocabulary.** Tether, counterweight, geostationary anchor, mass driver. Absurd by *scale*, not by joke — the tone rule holds even in orbit.
- **Roadmap lock, not a spec.** First structure ≈ space elevator / orbital tether. Beyond that (ring, mass driver, …) is TBD and out of scope until the grounded seven are solid.

---

## 9. UI / Screen Organization

The problem: by Level 4 the player runs multiple raws and several processes. That does not fit a phone screen. The solution is a three-stage evolution where each stage replaces the last. (This replaces the prototype's single flat scroll list.)

### Stage 1 — Three tabs (from start)
- **Extract** — raw material sources (workers + tapping)
- **Process** — conversion buildings
- **Build** — structure progress and requirements

Pre-QA-Manager, tabs are a long scroll. **Cluttered but fully workable.** Never punishing — the player must be able to succeed here indefinitely; the upgrade is relief, not a rescue.

### Stage 2 — QA Manager unlocks collapse (Level 3 mid)
Chains can be collapsed to a single summary line (name, rate, status).

**Collapse is manual, with suggestion.** The game never moves the UI on its own.
- A chain fully automated and not starved for `N` minutes gets a **subtle "collapse?" affordance** on its row.
- Player taps to collapse; can expand any time.
- If a collapsed chain starts limiting production, its row turns to a **warning state but stays collapsed.** The player decides whether to open it.
- Nothing ever expands, collapses, or reorders while the player is looking at the screen.

### Stage 3 — Operations tab (unlocks Level 5)
A fourth tab listing **only active bottlenecks, ranked by severity.** No production controls — just diagnosis and jump-links to the relevant row. By Level 5 this is the primary screen. Target session shape: open app → glance at Operations → fix the top red line → close app.

---

## 10. Offline Progress

Unlocked by hiring the first Project Manager (Level 3). Before that, progress is session-only — which keeps the early game tight and gives the PM hire real weight. Generous by default; the rate is a Reputation upgrade target (§11).

---

## 11. Reputation Upgrades

Earned on structure completion. All global, permanent, no new currency. Costs/scaling are TBD until cost curves are drawn.

1. **Offline Efficiency** — +% offline accrual rate
2. **Starting Capital** — begin each level with a seed stockpile of the base raw (softens the re-staff cold-start; this is the prototype's `homeTimberRate` bootstrap idea, generalized)
3. **Tap Value** — +% per-tap yield (the opt-in lever that keeps tapping alive per §3/§6)
4. **Unlock Discounts** — −% cost on recipe/building unlocks
5. **Retained Crew** — start each level with N workers pre-hired (directly tunes the re-staff beat)
6. **Overtime** — flat +% global production multiplier
7. **Prefab** — the structure costs −% refined material
8. **Reputation Yield** — +% Reputation earned per structure (the compounding meta-loop)

---

## 12. Number Formatting

Ceiling is set by the most expensive structure's cost (grounded: the cable-stayed span; extended if Act IV is on).

- Below 1,000: one decimal early, then integers.
- K / M / B / T for thousands → trillions.
- Beyond T: **named idle suffixes** (aa, ab, ac, …) — more readable on a phone than raw scientific notation.
- Extend the existing `fmt()` in `game.js`; it already handles K/M/B with a TODO for exactly this.

---

## 13. Reconciliation with the prototype

The prototype is a clean clicker skeleton, but it is currently a *different game* (spatial zone-accretion, no reset, buildings-as-producers, a `coins` currency). Migration path:

**Keep:**
- The tick / render / save-load / debug-panel harness — genuinely good, worth building on.
- The **panorama** concept → repurpose as the permanent gallery (§4).
- The `CONFIG`-driven, data-first building definitions ("adding a building = adding a row").
- `fmt()` (extend per §12) and the `homeTimberRate` bootstrap pattern (→ Reputation "Starting Capital").

**Invert:**
- Buildings stop being direct producers → become **recipes + capacity** that convert raw→refined, gated by worker-supplied input (§3). The hiring ladder becomes the producer.

**Cut:**
- The `coins` resource and the `footpath` building (fourth-currency violation).

**Build (all greenfield today):**
- The worker layer (Laborer → Principal) and its multiplier stacking.
- Processing (a building that *consumes* a raw each tick to yield a refined, capped by input).
- Reset logic (zero workers + stockpiles; persist buildings, structures, Reputation).
- Reputation currency + upgrade menu (§11).
- Three-tab UI (§9), then collapse, then Operations.

**Rename Level 1 to canon:** the prototype's aggregate→footbridge zone is scaffolding to replace with Timber → Sawmill → Lumber → Timber trestle.

---

## 14. Resolved Questions (was §9 Open Questions)

1. **Workers/buildings persist through reset?** → **Resolved:** buildings/recipes persist, workers reset, via the worker-driven production model (§3). Not a blocker for Level 1 (nothing to reset on run 1).
2. **Collapse suggestion threshold `N`?** → **Tunable, not a design gate.** `CONFIG` constant, default ~2 min, finalize in playtest.
3. **Level 4 material count?** → **Resolved:** Limestone merged into Aggregate.
4. **Act IV / ending?** → **Resolved:** grounded to the cable-stayed span, opt-in absurd space-structures branch at final prestige (§8).
5. **Reputation upgrade list?** → **Drafted (§11);** costs TBD after cost curves.
6. **Number formatting?** → **Resolved (§12):** K/M/B/T then named suffixes; ceiling = top structure cost.

7. **How does one worker force split across multiple raws?** (Surfaced during Level 1 implementation — §3 defined a single undifferentiated force but no splitting rule, which blocked *both* Level 2 and Level 3.) → **Resolved: assignment pool.** Workers are hired into one pool and the player assigns them per raw with steppers. `+` draws only from the unassigned pool, never silently from another raw. Unassigned workers extract nothing, so allocation is a real decision.
   - Chosen over per-raw crews (would fork §6's single ladder into N laborer tiers by Level 7) and auto-split (would remove the decision entirely and leave the §9 Stage 3 Operations tab with nothing to diagnose).
   - **Refined after playtest:** new hires auto-assign to the *least-staffed* material, at every level. The first cut left hires unassigned from Level 2 on, so hiring five Laborers moved crew output not at all — which reads as a broken game, not as a decision to make. Allocation is still the player's: − / + rebalance freely.
   - The resource bar's "Rate" was renamed **Crew output**, because it counts only assigned Laborers and tapping (a one-off grab) never moves it.
   - **Laborers are hired per material, and paid in that material.** Each raw's row carries its own *Mine* and *Hire* button. Billing a timber crew in stone (the old single-wage-material rule) read as nonsense. The *amount* still follows one crew-wide ladder per §6 — only the currency changes, which makes hiring out of your largest stockpile a mild, legible choice. Managers, who aren't tied to a material, are still paid in the level's newest raw.
   - The big tap button now appears only on single-material levels. With several raws "work the site" was ambiguous, so the per-material *Mine* buttons replace it.

8. **Do working buildings read as working?** → **No, and now fixed.** The only visible state change used to be starvation, so a healthy chain looked inert. Every building now carries a status line — `none built` / `N× · running · X/s Y` / `N× · starved — needs Z` — with a green pulse when live and amber when blocked. Naming the *specific* short input is what makes it actionable, and it is the same signal the §9 Stage 3 Operations tab will rank.

**Remaining true unknowns:** cost-curve numbers, `N`'s final value, Reputation upgrade costs, Act IV's full structure list. All deferred by design.

**Pacing note (measured, not estimated):** against a greedy-optimal simulated player, Level 1 completes in ~5m25s at 300 lumber and ~9m20s at 1000. Cost is a *weak* pacing lever — the economy compounds, so 10× the cost is only ~3× the time. To lengthen a level substantially, flatten the growth curves rather than raising the structure cost.

---

## 15. Build Order

1. **Level 1 end-to-end** on the existing harness: Timber extraction (tap + Laborer), Foreman multiplier, Sawmill (Timber→Lumber conversion consuming input), Timber trestle structure, and the first reset. This one slice forces the three biggest new systems into existence — the worker layer, processing, and reset.
2. **Level 3 next** (not Level 2) — the first level with two raws (iron ore + coal) feeding one process (smelter), which is where the real balance and UI questions live. Adds PM (offline accrual) and QA Manager (collapse).
3. **QA Manager + collapse UI** (§9 Stage 2).
4. **Fill in Level 2, then Level 4 onward.**
5. **Operations tab** (§9 Stage 3) last.
6. **Act IV** branch only after the grounded seven are solid.
