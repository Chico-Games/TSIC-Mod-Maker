← [Previous](12-validations.md) | [Index](README.md) | Next: [Appendices →](14-appendices.md)

# 13. Shipping your mod

**What you'll be able to do**

- Get your mod into the game and test it.
- Understand the export options and pick the right one.
- Publish to mod.io and update it later.
- Diagnose the "my mod isn't loading" cases.

---

## What you ship

A folder. That's the whole deliverable:

```
com.yourname.yourmod/
├── mod.json                        ← required: id, displayName, version
├── craft_recipe_definitions/
├── damageable_furniture_definitions/
├── layout_definitions/
└── maps/                           ← optional
```

Ship **only the definitions you changed or added**. Your project folder is already that overlay if you
created it empty; if you seeded from the default project, use `Export` (see below) rather than
shipping the whole folder.

## The export options

Hover `💾 Save` for the menu.

| Option | Produces | Use when |
|---|---|---|
| **Save** | Writes dirty records into your project folder | Constantly, while working |
| **Save as…** | Writes the whole working set to a new folder | Forking a project |
| **Export** | A ZIP in **overlay format** — your changes only | **This is what you ship** |
| **Export flattened** | A ZIP of base + overlay merged, a complete tree | Almost never. See warning below |

> **Do not ship a flattened export.** It contains a copy of every base-game definition, so your mod
> overrides *everything* and conflicts with every other mod in the load order. It exists for
> inspection and pipeline work, not distribution.

## Testing locally

Mods are read from a `Mods/` folder inside the game directory — the folder that also contains
`Content/`. On a typical Steam install that's something like:

```
…/steamapps/common/The Store Is Closed/TSIC/Mods/
```

If you're not sure, look for the directory containing `Content/` and put `Mods/` next to it. In a dev
build it's `<ProjectDir>/Mods/`. The game also scans `Content/Mods` — a second location developers
use; either works.

Any direct subfolder containing a `mod.json` is discovered. The folder's *name* isn't read at all —
identity comes from the `id` inside `mod.json`. Naming the folder after the id is the convention
every shipped mod follows, and it's what keeps a `Mods/` directory legible, but a mismatch won't stop
the mod loading.

**Steps:**

1. Copy your mod folder into `Mods/`.
2. Start the game.
3. Open the **Mod Selection** screen and enable your mod. Being installed is not the same as being
   enabled — a mod on disk but not in the load order is inactive.
4. Load a game and check your changes.

The mod stack is one **default mod** at the top plus an ordered list. Your choices are saved
per-install, so your stack won't follow you to another machine or affect other players.

**Iterating:** edit in the browser, `Save`, copy the folder over, restart the game. The game reads
definitions at startup — there's no hot reload.

**Developer tip:** launching with `-modsdir=<path>` points one process at its own mods root. Useful for
running two instances with different stacks, which is how you test multiplayer mod mismatches.

## Checking it actually loaded

The game log is explicit about mods — the category is `LogScpMods`. Look for:

- `mod '<id>' overrides '<path>'` — your override landed. Paths are lowercased in this line.
- `mod '<id>' is on disk but not in any load order — inactive` — you forgot to enable it.
- `mod '<id>' is in load order but not on disk locally — skipped` — nothing under `Mods/` declares
  that id. Check the `id` in `mod.json`, not the folder name.
- `mod '<id>' metadata rejected — scripting disabled: <reason>` — `mod.json` has a bad `permissions`,
  `scripts` or `overrides` block. Content still loads; scripting doesn't.

Those lines answer nearly every "why isn't my mod working" question.

The definition loader reports separately, and this is where a broken *file* shows up rather than a
broken mod:

- `DefinitionPack: loaded '<mod>' (N defs, N refs resolved, N unresolved)` — the headline. If `N
  defs` is lower than the number of files you shipped, something was rejected below.
- `DefinitionPack: unknown class '<class>' in <file>` — the `class` field names something the game
  doesn't have. Usually a typo, or a definition from a newer build.
- `DefinitionPack: header <file>: <reason>` — missing `id`, bad JSON, that kind of thing.
- `DefinitionPack: asset import: N files in …` — your textures, sounds and meshes
  ([ch. 1](01-what-youre-editing.md#shipping-your-own-art-and-audio)); individual failures log above
  it.

Unresolved refs are worth watching: they're the runtime equivalent of the `orphan ref` validation,
and they mean something in your data points at an id nothing defines.

## Publishing to mod.io

`💾 Save` → hover → `📤 Publish to mod.io`. You need to be signed in (`🌐 Sign in (mod.io)` in the
same menu) and to have your project open from a real folder — the bundled base game can't be
published. `📥 Browse mods` in the same menu reads the game's mod.io catalogue without publishing
anything, which is the easy way to see what other people ship.

The wizard has four steps:

### 1. Bind

Create a new mod.io entry, or bind to an existing one you own. Binding writes the mod.io identity into
your project so subsequent publishes update the same entry rather than creating duplicates.

### 2. Metadata

| Field | Limit / requirement |
|---|---|
| Mod name | ≤ 80 characters |
| Summary | ≤ 250 characters |
| Description | Markdown, optional |
| Logo | PNG/JPG/GIF, at least 512 × 288 |
| Tags | Pick from the game's tag list |
| Visibility | Public or hidden |

Write the summary for someone browsing a list of hundreds. "Replaces all chairs with cardboard boxes"
beats "A fun mod!".

### 3. Modfile

The editor packs the project first and shows you what's in the upload: file count, how many are new
versus modified, how many are unchanged, the total size and an MD5. Read it — it's the last honest
look at what you're about to ship, and an unexpectedly large file count usually means stub records
you didn't mean to save.

Anything wrong is listed above the fields. Errors block the upload button; warnings don't.

| Field | Notes |
|---|---|
| Version | Semver. Bump it every publish |
| Changelog | What changed. Future you will be grateful |
| Activation | On by default: this becomes the version users download. Off uploads a draft you can promote later from the mod detail panel |

### 4. Done

mod.io virus-scans the file before it becomes downloadable, so the profile page may show it as
pending for a while after the wizard says it's published.

### The sync chip

The header chip compares your project against what's on mod.io:

| Chip | Means |
|---|---|
| `mod.io: not bound` | This project isn't connected to a mod yet |
| `mod.io: synced` | Local matches your last push, and the remote matches too |
| `mod.io: local newer` | You have unpushed changes |
| `mod.io: remote newer` | Someone published a newer modfile than your last push |
| `mod.io: diverged` | Both sides moved since your last push |

### Updating later

Open the project, make changes, publish again. The binding from step 1 means it updates the same mod
entry. Bump the version and write a changelog.

## Multiplayer and mods

Worth knowing even if you're not building for it:

- A mod's identity is a hash of its **contents**, not where it came from. A hand-installed copy and a
  mod.io copy of the same revision match, so they're interchangeable. (`mod.json`'s `modio` block is
  excluded from the hash for exactly this reason — the installer writes it, and it would otherwise
  make every downloaded copy look different from the original.)
- A joining client that lacks a mod the server runs will fetch it **from mod.io itself**, pinned to
  the exact file revision. A mod with no mod.io identity can only be *named* to the player, not
  fetched — so hand-distributed mods can't be auto-resolved for joiners.
- This is a good reason to publish even a small mod rather than passing a ZIP around, if you play with
  other people.

## Version discipline

- `mod.json` `version` is your mod's identity to players and servers. Bump it on every published change.
- The base game's `com.chicogames.default` version is not yours to change.
- Keep your project in version control. It's plain JSON in plain folders — git works perfectly, and
  diffs are readable.

---

## Gotchas

- **Installed ≠ enabled.** The Mod Selection screen is a separate step.
- **The load order holds ids, not folder names.** "In load order but not on disk" means no `mod.json`
  under `Mods/` claims that id.
- **Restart the game after changing files.** Definitions load at startup.
- **Shipping a flattened export** overrides the entire base game and breaks compatibility with every
  other mod.
- **Load order matters.** If two mods change the same file, the later one wins. If your changes
  vanish when another mod is enabled, that's the cause.
- **Publishing needs a real folder.** The bundled read-only base game can't be published; open or
  create a project first.

---

Next: [Appendices →](14-appendices.md)
