# The TSIC Modding Guide

A complete, practical guide to authoring TSIC content with the Definition Editor — from your first
edit to a published mod, including how to lay out the world.

**Read it online:** <https://chico-games.github.io/TSIC-Mod-Maker/guide/> — the same chapters as one
searchable page, linked from `📖 Guide` in the editor's header. This folder is the source; the
published page is regenerated from it on every deploy.

You do not need Unreal Engine, C++, or any programming knowledge. You need a Chromium-based browser
(Chrome, Edge or Brave) and the editor.

## Chapters

**In a hurry?** [Quick start](00-quick-start.md) gets you from opening the editor to a working mod
in the game in about fifteen minutes, with no theory at all.

| # | Chapter | What it covers |
|---|---|---|
| ★ | [Quick start](00-quick-start.md) | First mod, end to end. Ten steps, no explanation. |
| 1 | [What you're editing](01-what-youre-editing.md) | Definitions, mods, and the overlay model. Read this first — it explains everything else. |
| 2 | [Setup and your first project](02-setup.md) | Settings, creating a project, saving, reloading, recovering drafts. |
| 3 | [Anatomy of a definition](03-anatomy-of-a-definition.md) | What's inside a definition file, folder↔class, naming conventions, references. |
| 4 | [Getting around](04-getting-around.md) | The header, the seven tabs, search, drag-and-drop, Where-Used. |
| 5 | [Items](05-items.md) | The class browser, the nine item folders, static-item partners, bulk editing. |
| 6 | [Furniture](06-furniture.md) | Choosing the right furniture folder, tier chains, death loot, upgrades. |
| 7 | [Recipes, stations and progression](07-recipes-and-progression.md) | Recipes, ARRs, bench tags, grow stages, the tech tree. |
| 8 | [Loot and drops](08-loot-and-drops.md) | The two loot systems, difficulty tiers, enemy drops, biome loot. |
| 9 | [Enemies and AI](09-enemies-and-ai.md) | Behaviour graphs, perception cones, the live sandbox, the scenario suite, the attack-reach audit. |
| 10 | [Gameplay tags](10-gameplay-tags.md) | The tag tree and why tagging is a design activity. |
| 11 | [Laying out the world](11-laying-out-the-world.md) | **The big one.** Maps, biomes, tiles, layouts, search queries, seeds, and how to build rooms that play well. |
| 12 | [Validations](12-validations.md) | Every warning the editor can raise, and the ones it can't. |
| 13 | [Shipping your mod](13-shipping.md) | Export, install locally, test in game, publish to mod.io. |
| 14 | [Appendices](14-appendices.md) | Folder→class table, naming glossary, keyboard and mouse, reference numbers, troubleshooting. |

## I just want to…

| Goal | Go to |
|---|---|
| Change what a recipe costs | [Ch. 7](07-recipes-and-progression.md) |
| Add a new craftable item | [Ch. 5](05-items.md), then [Ch. 7](07-recipes-and-progression.md) |
| Make an enemy drop something | [Ch. 8](08-loot-and-drops.md) |
| Change what spawns on the floor in a biome | [Ch. 8](08-loot-and-drops.md) |
| Tune how an enemy behaves | [Ch. 9](09-enemies-and-ai.md) |
| Build a new room / tile | [Ch. 11](11-laying-out-the-world.md) |
| Re-skin existing furniture (e.g. chairs → boxes) | [Ch. 1](01-what-youre-editing.md), then [Ch. 6](06-furniture.md) |
| Ship my own mesh, texture or sound | [Ch. 1](01-what-youre-editing.md#shipping-your-own-art-and-audio) |
| Work out what a folder I've never used is for | [Appendix A](14-appendices.md#the-folders-this-guide-doesnt-otherwise-cover) |
| Get my mod running in the game | [Ch. 13](13-shipping.md) |
| Understand an error the editor is showing me | [Ch. 12](12-validations.md) |
| Fix something that isn't working | [Appendix E](14-appendices.md#appendix-e--troubleshooting) |

## The shortest possible summary

1. Everything in TSIC is a JSON file in a folder. One file = one thing.
2. A mod is a folder of those files plus a `mod.json`. Mods stack; later ones override earlier ones
   at the same path.
3. The editor gives you typed, schema-aware views of that folder, plus specialised tools for crafting,
   loot, AI and world layout.
4. Content becomes *reachable* through references (recipes, loot tables, ARRs) and *discoverable*
   through gameplay tags (layout queries). Creating a definition is only half the job.
5. Ship the overlay, not a flattened copy.

## Before you start

- **Browser:** Chrome, Edge or Brave. The editor writes files directly to a folder you choose, which
  needs the File System Access API. Firefox and Safari can read the bundled base game but cannot save.
- **Disk:** pick a folder for your projects and keep it out of the game's install directory until
  you're ready to test. Chapter 2 sets this up.
- **Backups:** your project is plain JSON in a plain folder. Putting it in git costs nothing and will
  save you at least once.

## Conventions in this guide

> **Why it works** — boxes like this explain the data model behind what you just did. Skippable on a
> first read; worth it on the second.

**Gotchas** sections at the end of each chapter list the failure modes and the exact symptom you'll see.

Buttons and UI elements are written exactly as they appear on screen: `📂 Open project`,
`⌘K Search`, `💾 Save (3) ▾`.
