← [Previous](08-loot-and-drops.md) | [Index](README.md) | Next: [Gameplay tags →](10-gameplay-tags.md)

# 9. Enemies and AI

**What you'll be able to do**

- Find the four definitions that make up an enemy.
- Tune perception cones and watch the effect live.
- Read a behaviour graph as it runs.
- Catch the classic "this enemy can never actually hit anything" bug before shipping.

---

## What makes an enemy

An enemy is assembled from several definitions that reference each other:

| Definition | Folder | Describes |
|---|---|---|
| `ED_BoneHead` | `enemy_definitions` | The enemy itself — stats, loadout, drop table, which behaviour and perception it uses |
| `BHV_BoneHead` | `behavior_definitions` | Its decision graph — what it does and when |
| `PRC_BoneHead` | `perception_definitions` | What it can sense — cone angles, ranges |
| `BoneHeadSpawnParameters` | `enemy_spawn_parameter_definitions` | How it's spawned into the world |

Plus `skill_definitions` for the individual actions a behaviour can invoke, and `ESP_*`
(`enemy_spawn_point_definitions`) for the world-gen objects that place them
([ch. 11](11-laying-out-the-world.md)).

Death drops are edited in **Recipes & Loot → Enemies** ([ch. 8](08-loot-and-drops.md)); the AI tab is
about behaviour.

## The AI tab

Five views of **one running simulated world**. The same definitions every other tab edits, running
live — change a number and the sandbox reacts immediately. Edits go through the normal dirty/undo/
Save pipeline; nothing here has its own persistence.

If the tab tells you there's no AI content, the project has no `enemy_definitions` record with
`ai_stack: "v2"` and a behaviour, or the behaviour/perception/skill definitions it points at are
missing. A `⚠ N broken references` chip beside the sub-tabs lists the ones it couldn't resolve.

### Sandbox

A live top-down world at a fixed 60 Hz. Drag pawns and furniture around and watch senses and
decisions update in real time.

- **Scenes**: *Open arena* (no cover), *Blind corner* (occlusion), *Shop aisles* (realistic clutter).
  Test each — an AI that behaves well in an arena often falls apart in aisles.
- **Day section** picks a time-of-day perception profile, or the base profile.
- **Spawn** any enemy or a player at the centre of view.
- **Blocking furniture**: filter the `FD_` list, place one or a wall of eight. Each row shows health,
  armour, size and whether it's breakable — an unbreakable piece fails `can_break_furniture`, so the
  AI has to route around it instead of through it.
- **Inspector** on the right shows the selected actor's live state.
- **Timeline** underneath shows the decision history. This is what to read when an enemy "does
  nothing": it shows which skill it picked and why the next one didn't fire.

Controls:

| | |
|---|---|
| drag a body | move it |
| drag the arrow | rotate it — this is the facing every cone and line-of-sight test uses |
| `WASD` | walk the selected player |
| `C` / `V` | crouch / stealth toggle |
| `F` | the player swings — feeds the damage sense, the target-steal rule and the grudge |
| `N` | make a loud noise here |
| `Space` / `.` | pause / single step |
| wheel, drag empty space | zoom, pan |

`⏸` on an actor row pauses that one AI while the rest keep running; `⏸ all` does the lot.

The simulation stops when you switch browser tabs. That's the browser suspending animation frames,
not a bug.

### Scenarios

A catalogue of scripted AI scenarios — spawn positions, a script of timed inputs, and checks over
what was recorded — run against the definitions currently loaded, with a verdict each.

Click **watch** on any of them and that exact run mounts in the Sandbox, at the same seed, with the
same script firing at the same times. You get the inspector, the behaviour graph and the timeline
attached to the failure.

A scenario that documents a known defect asserts the *correct* behaviour and reports `KNOWN` rather
than red. If one starts passing it reports `FIXED` and turns the run red, so the marker gets removed
instead of quietly outliving the bug.

The same suite runs headlessly (`npm run test:ai`), which is what CI uses.

### Behaviour

The `BHV_` graph, drawn as a node graph and lit along the currently active path while the sandbox
runs. Click a node to edit it.

Watching the graph light up is the fastest way to understand an unfamiliar enemy — you see which
branches actually get taken rather than guessing from the JSON.

### Perception

The `PRC_` definition as a draggable diagram: sight cones, ranges, angles. The range, cone-angle,
peripheral and auto-detect handles all write straight into the record, and the sandbox picks the
change up immediately.

Perception profiles inherit, and every field tells you whether it's authored here or inherited.
**Editing an inherited value writes a local override on the child** — the shared base is untouched,
so tuning one enemy never retunes every enemy that extends it. (Opening `PRC_BaseHostile` itself and
editing it there does affect everyone. Where-Used first.)

> **Why it works**
>
> AI definitions support inheritance through an `extends` property naming another definition:
>
> ```json
> "properties": {
>   "extends": "PRC_BaseHostile",
>   "sight": { "range": 3000, "time_to_spot": 1.1 }
> }
> ```
>
> At load the game walks the chain and merges parent into child, child winning, then drops the
> `extends` field. Seven of the eight shipped perception profiles are one line of `extends` plus the
> handful of numbers that make that enemy different.
>
> The rules are strict, and each has its own load error: the parent must exist
> (`extends unknown definition`), must be **the same class** (`extends '…' of a different class`),
> and the chain must not loop (`extends cycle`). This is an AI-definition feature — items, furniture
> and recipes have no equivalent.

Perception is where most enemy "feel" lives. A cone that's too wide makes an enemy omniscient; too
narrow and it walks past the player. Tune here, then verify in the *Blind corner* scene.

### Attacks

A project-wide reach audit across every enemy, and the one view you should check before shipping any
AI change.

> **The bug it exists to catch**
>
> The engage skill drives an enemy to a distance derived from an **approach envelope** computed from
> the capsule sizes of attacker and target — not from the ability's own range. If an attack's max
> range is *below* that envelope, the enemy approaches, reports success, and then the ability refuses
> to fire because it's still out of reach. The enemy stands there and does nothing, forever.
>
> Nothing about the loadout JSON or the ability asset makes this visible on its own. The Attacks
> matrix computes both numbers and shows you where they don't overlap.

Check it after changing: an enemy's size, a weapon's range, or an attack ability. The pawn capsule
radius the envelope is computed from is adjustable in this view, because the simulation defaults
every pawn to 42 uu and a large rig like TVHead really isn't.

An ability the table has no range data for shows as such rather than passing silently. That's
expected for a renamed or brand-new ability: the range figures come from the game's ability assets,
which aren't part of a mod project.

## Tuning workflow

1. Pick the enemy in the sandbox and run the *Open arena* scene. Confirm the basics work.
2. Switch to *Blind corner* — does it lose the player sensibly, or cheat?
3. Switch to *Shop aisles* — does it path, or get stuck on furniture?
4. Adjust perception cones in the Perception view; re-run.
5. If a decision looks wrong, open Behaviour and watch which node lights up.
6. Run **Scenarios** — it catches regressions in enemies you weren't looking at.
7. Before saving, check the Attacks matrix.
8. `Save`, then playtest in game — the sandbox is a good model, not the real thing.

## Where the sandbox differs from the game

Worth knowing before you trust a result:

- **Pathfinding is a 100 uu grid A\***, not the engine's navmesh. Breach-vs-route-around decisions are
  modelled; navmesh baking, link traversal and stall heuristics are not.
- **Two dimensions only.** No floors, stairs, elevators or vertical line of sight.
- **Hit timing is mid-animation** rather than the real hitbox window.
- **Damage numbers are placeholders.** Only armour reduction is real.

Use it to reason about *decisions* — what an enemy senses, what it picks, why it refuses. Confirm
anything timing- or geometry-sensitive in the game.

## Enemies in the world

An enemy needs a route into the world:

- `ESP_*` enemy spawn points are placed by layouts. The base game's standard tile carries exactly one.
- `enemy_spawn_parameter_definitions` controls rates and conditions.
- Biome tiles determine which spawn point is used, so which enemies appear where is a
  **world layout** decision as much as an AI one ([ch. 11](11-laying-out-the-world.md)).

---

## Gotchas

- **The sandbox is a simulation, not the game.** Behaviour that's obviously broken here is broken
  there; behaviour that's fine here still needs a playtest.
- **An enemy whose attack range is under its approach envelope will never attack.** Check the Attacks
  view. This is silent in every other tool.
- **Editing a base perception profile in the Definitions tab hits every enemy that extends it.** The
  Perception view's inherited-field editing writes a local override instead; the Definitions tab does
  not. Where-Used before editing `PRC_BaseHostile` directly.
- **Deleting a behaviour or perception record that an enemy references** leaves a dangling ref; the
  AI tab will refuse to build a world for that enemy.

---

Next: [Gameplay tags →](10-gameplay-tags.md)
