← [Index](README.md) | Next: [What you're editing →](01-what-youre-editing.md)

# 0. Quick start

**Make a working mod in about fifteen minutes.** No theory — every step links to the chapter that
explains it if you want the why. You need Chrome, Edge or Brave, and the game installed.

---

## 1. Open the editor

<https://chico-games.github.io/TSIC-Mod-Maker/>

It loads the base game read-only, so you can look at everything before you own anything.

## 2. Point it at a projects folder

`⚙` → **Projects folder** → pick somewhere like `Documents/TSIC Mods`. Once. ([ch. 2](02-setup.md))

## 3. Make a project

`✨ New project` → name it → leave **Seed from default project** ticked. You now have a folder of your
own with the whole base game visible in it.

## 4. Change something

**Items → Crafting Materials**, pick anything, change its display name. The header shows `1 unsaved`.

## 5. Save

`💾 Save`. Look in your project folder: **one JSON file**, in the folder matching that item's class.
That single file is your entire mod so far. ([ch. 1](01-what-youre-editing.md) explains why)

## 6. Add a `mod.json`

In your project folder, next to the definition folders:

```json
{
  "id": "com.yourname.firstmod",
  "displayName": "My First Mod",
  "version": "1.0.0"
}
```

`id` and `version` are required. The id must be unique — reverse-DNS is the convention.

## 7. Put it in the game

Copy the whole folder into the game's `Mods/` directory — the one next to `Content/`:

```
…/steamapps/common/The Store Is Closed/TSIC/Mods/com.yourname.firstmod/
```

## 8. Turn it on

Start the game → **Mod Selection** → enable your mod. Installed and enabled are two different
things, and forgetting this is the single most common "my mod doesn't work".

## 9. Look for it in game

Load a save and find your renamed item. If it isn't there, check the log for these three lines —
they answer nearly every failure:

```
LogScpMods: ScpMods: mod 'com.yourname.firstmod' overrides '…'
LogScpMods: BuildLocalSetManifest: mod '…' is on disk but not in any load order — inactive
LogScpMods: BuildLocalSetManifest: mod '…' is in load order but not on disk locally — skipped
```

## 10. Ship it

Back in the editor: `💾 Save ▾` → `Export` for a ZIP of just your changes, or
`📤 Publish to mod.io` to put it where other players can subscribe to it.
([ch. 13](13-shipping.md))

---

## What to read next

| If you want to… | Go to |
|---|---|
| Understand what you just did | [Ch. 1 — What you're editing](01-what-youre-editing.md) |
| Add a new item and make it craftable | [Ch. 5](05-items.md) then [Ch. 7](07-recipes-and-progression.md) |
| Change what enemies drop | [Ch. 8](08-loot-and-drops.md) |
| Build a room | [Ch. 10](10-gameplay-tags.md) then [Ch. 11](11-laying-out-the-world.md) |
| Publish properly | [Ch. 13](13-shipping.md) |

---

## Gotchas in the first fifteen minutes

- **`💾 Save` is greyed out.** You're still on the read-only base game. Make a project first.
- **Firefox or Safari.** You can browse but not save; the editor needs Chromium's file access.
- **Nothing changed in game.** Not enabled in Mod Selection, or the game wasn't restarted —
  definitions load at startup, there's no hot reload.
- **You seeded from the default project and shipped the whole folder.** Use `Export`, which writes
  only what you changed. See [ch. 13](13-shipping.md).

---

Next: [What you're editing →](01-what-youre-editing.md)
