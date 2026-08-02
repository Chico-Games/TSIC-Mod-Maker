# The AI tab

A live sandbox for the AI2 stack, sitting on the same definitions every other tab edits.
Drag pawns and furniture around, watch what each agent senses and decides frame by frame,
and tune the numbers in place — without launching the editor.

Five views of one running world:

| Sub-tab | What it's for |
| --- | --- |
| **Sandbox** | Drag actors, watch senses and decisions live, with a full inspector and a decision timeline |
| **Scenarios** | Run the deterministic suite; click **watch** to mount any failure in the Sandbox |
| **Behaviour** | The `BHV_` graph, lit up along the active path; click any node to edit it |
| **Perception** | The `PRC_` cones as a draggable diagram, with inheritance made visible |
| **Attacks** | A whole-project reach audit: can each enemy actually land anything? |

## Where the data comes from

Everything except the ability table is read from `definitionsStore` — the same records the
Definitions tab shows. Edit a `PRC_`, `BHV_`, `SKL_`, `ED_` or `FD_*_DF` anywhere in the app
and the sandbox rebuilds with the new numbers, keeping the actors where you put them.

Writes go through `updateValueAtPath`, so AI edits join the normal dirty / undo / Save
pipeline. Nothing here has its own persistence.

The store holds definitions as **typed envelopes** (`{type:'float', value: 1.1}`); the
engine is a port of the C++ and reads the **plain** shape the game loads off disk.
`src/components/ai/envelope.ts` is the only place that knows about the difference.

### The ability table is baked in

`src/ai/abilities.ts` stands in for the real GAS abilities. It carries only the gates the AI
actually consults — `minRange`, `maxRange`, cooldown duration, `minCombatSeconds`,
`bCheckLineOfSight`, `bCommitToAttack` — plus the montage length as the swing duration and
the audited hitbox reach as the damage footprint. The values were read out of a live Unreal
editor via `ObjectTools.get_properties` on each `GA_*` CDO; provenance is in the file header.

It is **not** part of the mod project, because ability assets aren't. A project that renames
an ability tag will show it as "no range data" in the Attacks view until the table is
updated.

## What is actually simulated

Ported from the C++, structure and tick order included:

| Area | Source |
| --- | --- |
| Sight | `UScpPerceptionComponent::EvaluateSightVisibility` — primary/peripheral cones, angular falloff to `peripheral_gain`, distance falloff, motion and stealth multipliers, auto-detect radius, LoS trace, `time_to_spot` fill, glimpse drain, `memory_seconds`, ghost-track window |
| Hearing | `UScpSensesSubsystem::ReportNoise` — `loudness × (1 − d/range) × acuity`, occlusion attenuation, lifetime decay |
| Damage sense | `NotifyDamage` — pawn + entity records, total/recent half-lives, instant Spotted on being hit, give-up cancel, provocation latch |
| Observed | `UpdateObserved` — the mannequin's statue act: player FOV cone + margin, LoS, 0.75s linger |
| Targeting | `UpdateTarget` — priority rules in order, damage-only steal, stalemate give-up + resume window, patrol re-anchoring |
| Behaviour machine | `UScpBehaviorMachine` — root eval cadence, alias entries, priority + hold windows, `min_commit_seconds`, event queue then OnTick transitions, parents-before-leaves action ticks, failure escalation, `fail_cooldown` |
| Skills | `FScpAction_RunSkill` — nested frames, `$In.*` aliasing the caller's value sources |
| Attack selection | `ScpAi2::SelectAttack` — granted-ability gate, `CanActivateAbility`, sort by **highest min range** then max range, cooldown, weight |
| Coordinator | `UScpCombatCoordinatorSubsystem` — per-target token pool, `MaxSimultaneousAttackers = 2` |
| Armour | `UScpHealthSet::CalculateArmorReducedDamage` — the Valheim curve |

Value refs (`$Perception.Target`, `$Attack.Tag`, `$Path.BlockingEntity`, …) resolve on every
read, never snapshotted, exactly as `FScpValueSource` does.

## Sandbox controls

| | |
| --- | --- |
| drag a body | move it |
| drag the arrow | rotate it — this is the facing every cone and LoS test uses |
| `WASD` | walk the selected player |
| `C` / `V` | crouch / stealth toggle |
| `F` | player swings — feeds the damage sense, the steal rule and the grudge |
| `N` | make a loud noise here |
| `Space` / `.` | pause / single fixed step |
| wheel, drag empty space | zoom, pan |

Per-enemy ⏸ in the actor list pauses one AI while the rest keep running.

The sim runs at a fixed 60Hz; React-rendered panels refresh at 10Hz (`PANEL_HZ`) because
reconciling the inspector every frame is enough to lock the tab. The canvas has its own
`requestAnimationFrame` loop straight off the mutable world, so the view stays smooth.
Browsers pause `requestAnimationFrame` in a hidden tab — the sim pausing when you switch
away is the browser, not a bug.

## Editing

- **Perception** — every field says whether it's authored on this profile or **inherited**
  from the `extends` chain. Editing an inherited value writes a *local override* on the
  child with the right envelope type; the shared base is never touched, so tuning one enemy
  never retunes every enemy that extends it.
- **Behaviour** — `hold_seconds`, `fail_cooldown`, `nav_policy` and `min_commit_seconds` get
  real inputs; the whole selected node is also editable as JSON for anything the form
  doesn't cover.
- **Cone diagram** — the range, cone-angle, peripheral and auto-detect handles are draggable
  and write straight into the `PRC_`.

## Console handle

`window.__aiLab` for scripted repros:

```js
__aiLab.world                 // the live World
__aiLab.run(5)                // advance 5 seconds in fixed steps
__aiLab.dump('Bone')          // root, state path, target, attack verdicts, sight records
__aiLab.api.select(actor)
```

`window.__tsicDefs` is the definitions store, for loading a project without the directory
picker (which needs a user gesture and so can't be scripted).

## Headless smoke

```bash
npm run smoke:ai          # every v2 enemy, 20 sim-seconds
npx tsx ai-smoke.mjs 60   # longer
```

Loads `public/starter-project` off disk, runs each enemy against a player it is alerted to,
and reports the roots it entered, the attacks it fired, how close it got, and the worst
single-step time. Catches hangs, compile breakage and "this enemy can no longer attack"
regressions without a browser. It's wired into `npm run smoke`.

## Scenarios — the deterministic test suite

The **Scenarios** sub-tab runs a catalogue of scripted AI scenarios against the definitions
currently loaded, and reports a verdict per scenario. Click **watch** on any of them and that
exact run is mounted in the Sandbox, so you can step through a failure with the inspector,
the behaviour graph and the decision timeline attached. It is the same `ScenarioRun` the
headless runner drives, at the same seed, with the same script firing at the same times —
there is no second implementation to drift.

The same suite runs headlessly:

```bash
npx tsx ai-test.mjs                     # everything, against Mods/com.chicogames.default
npx tsx ai-test.mjs --filter perception  # substring match on id, title or tag
npx tsx ai-test.mjs --repeat 2           # assert each scenario replays to an identical hash
npx tsx ai-test.mjs --seeds 8            # sweep seeds; catches expectations that only
                                         # hold for one set of wander rolls
npx tsx ai-test.mjs --json report.json   # machine-readable
npx tsx ai-test.mjs --list               # the catalogue
```

npm aliases: `test:ai`, `test:ai:seeds`, `test:ai:determinism`, `smoke:ai-scenarios`.
Exit code is 0 only when nothing needs a human.

### Determinism

Everything is seeded and fixed-step. There is no wall clock, no `Math.random` and no
`Date.now()` anywhere in `src/ai/`, and the sim always steps at exactly 1/60s regardless of
how fast the host is. Two properties make that useful rather than merely true:

- **`World` takes a seed.** `new World(pack, { seed })`; actor ids count from 1 per world, so
  they are a function of spawn order rather than of process history.
- **Every agent has its OWN random stream**, derived from the world seed and the actor id via
  a splitmix finaliser. A shared stream couples agents that have nothing to do with each
  other: adding a second enemy to a scenario would shift the first one's wander rolls, and
  the scenario would silently stop testing what it was written to test.

`worldHash()` digests positions, health, machine state and sensed records into eight hex
digits. `--repeat N` re-runs each scenario and compares — a mismatch is a determinism break,
reported separately from a behaviour failure.

Throughput is roughly **600-800x realtime** on one core: the whole 75-scenario catalogue is
~2100 sim-seconds in ~3s of wall time.

### Writing a scenario

A scenario is data: a world to build, a script of timed inputs, and checks over the recorded
trace. They live in `src/ai/testing/scenarios/`.

```ts
{
  id: 'sight/frontal-still',
  title: 'A still player straight ahead is spotted in a few seconds',
  tags: ['perception', 'sight'],
  seconds: 12,
  enemies: [{ def: 'ED_Janitor', x: 0, y: 0, yaw: 0, frozen: true }],
  players: [{ x: 800, y: 0, silent: true }],
  script: [{ at: 5, who: 'player', teleport: { x: 1200, y: 0 } }],
  check: (t, e) => {
    e.happenedWithin('acquires the player', t.agent().firstTargetTime('player'), 8);
    e.gte('detection fills to spotted', t.agent().peakDetection('player'), 1);
  },
}
```

- **`frozen: true`** nails an enemy to the spot facing its spawn yaw while brain, senses and
  machine keep running. This is the seam that makes pure perception tests possible: an
  unfrozen enemy patrols, and a patrolling enemy turns, so "never spots the player" would
  really be testing which way the wander happened to point it.
- **Script steps** cover movement (`move`/`stop`), state (`crouch`, `stealth`, `teleport`,
  `face`, `silent`, `frozen`), stimuli (`damage`, `noise`, `alert`, `attack`), and lifecycle
  (`kill`, `remove`, `daySection`), with a `run` escape hatch.
- **The trace** exposes roots, states, targets, attacks, damage, detection fill, token
  holding, distances and travel per agent — see `AgentTrace` in `src/ai/testing/types.ts`.
- **Expectations record, they never throw**, so one bad check cannot hide the rest.

### knownBug — the expected-failure marker

A scenario that documents a defect asserts the CORRECT behaviour and carries a `knownBug`
string explaining why it fails. Those report as `KNOWN` rather than red. If one starts
passing it reports as `FIXED` and turns the run red, so the marker gets removed rather than
quietly outliving the bug.

## Known differences from the game

- **Pathfinding is a 100uu grid A\*, not the UE navmesh.** Breach vs blocking policy and the
  `PathBlocked` event are modelled; navmesh generation, agent-radius baking, link traversal
  and `move_to`'s stall-escalation heuristics are not.
- **2D only.** No floors, stairs, elevators or vertical LoS.
- **Pawn capsule radius defaults to 42uu for everything.** It feeds the approach envelope
  (`r + r + 40`), so the exact stopping distance for a large rig like TVHead will differ —
  which is why the Attacks view lets you change it.
- **Hit timing is mid-montage (45%), not the real `AnimNotifyState_Hitbox` window.**
- **Trace budgeting is not modelled** — every LoS test runs, where the game round-robins a
  budget via `UScpSensesSubsystem`.
- Damage numbers are placeholders; only armour reduction is real.

Treat it as the place to reproduce and reason about *decisions* — what it senses, what it
picks, why it refuses. Confirm timing- and geometry-sensitive results in PIE.

## Note on `public/starter-project`

The bundled starter project's five AI folders (`enemy_`, `perception_`, `behavior_`,
`skill_`, `damageable_furniture_definitions`) are kept in sync with the live TSIC default
mod, so an in-browser suite run and a headless one agree. If they drift again the symptom is
loud: the Scenarios view starts reporting `FIXED` for known bugs that are not fixed. Re-sync
by copying those folders out of `Mods/com.chicogames.default`. Everything else in the
starter project is still a snapshot — open the real mod folder when the numbers matter.
