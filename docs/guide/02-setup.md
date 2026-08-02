← [Previous](01-what-youre-editing.md) | [Index](README.md) | Next: [Anatomy of a definition →](03-anatomy-of-a-definition.md)

# 2. Setup and your first project

**What you'll be able to do**

- Configure the editor's three folder settings and understand what each one does.
- Create a project, make an edit, save it, and find the file on disk.
- Recover from a crash without losing work.

---

## First run

Open the editor. With no project configured it loads the **bundled base game** — the full
`com.chicogames.default` data set, read-only. You can browse everything, click into any tab, and
learn the data without touching a folder.

The header's info line tells you where you are at all times:

```
Project: Default Project · 2940 defs · 50 folders · 2 unsaved
```

Read-only means `💾 Save` is disabled. That's deliberate: it stops you from accidentally editing the
base game in place. To make changes you create a project.

## The folder settings

Open `⚙`. Three settings, and they do different things:

| Setting | What it is |
|---|---|
| **Working directory** | The folder currently open for read/write. Set by opening or creating a project. `Forget` drops it; the **Auto-load on app start** checkbox controls whether it reopens next launch. |
| **Projects folder** | The parent folder your projects live in. Set this once. It's what makes `✨ New project`, `Save as…` and the projects dropdown useful. It also lists the projects it found, flagging any without a `project.json`. |
| **Default project** | Where the base game comes from. Leave it on **Default Project (HTTP)** — the copy bundled with the editor — unless you're working against a newer game build on disk. |

There's also a **Show developer actions** checkbox, which reveals "Publish as new Default Project
version…". That's for whoever maintains the bundled base data. Leave it off.

Set the **Projects folder** now — somewhere convenient like `Documents/TSIC Mods`. The editor
remembers folder access between sessions, so you grant permission once.

> **Why it works**
>
> The browser can't roam your filesystem. Every folder the editor touches is one you explicitly
> handed it through a picker; that permission is stored in the browser's IndexedDB and reconnected on
> reload. If you clear browser data, you re-pick the folders. Nothing is lost — your files are just
> files.

## Create a project

1. Click `✨ New project`.
2. **Folder** — defaults to your Projects folder.
3. **Project name** — this becomes the folder name. Use something filesystem-safe.
4. **Seed from default project?** — the important choice:

| Choice | You get | Use when |
|---|---|---|
| **Yes** | A full copy of the base game as your starting point | You want to browse and tweak with everything present. Remember to ship only what you changed. |
| **No** | An empty project | You know exactly what you're adding. Cleanest overlay. |

If you're unsure, choose **yes** — you can always trim later, and working against a full data set is
much easier when you're learning where things are.

5. Click create. The header switches to your project and `💾 Save` becomes available.

## Make your first edit

1. Go to the **Items** tab → **Crafting Materials** sub-tab.
2. Pick any item and change its display name.
3. The header shows `· 1 unsaved` and the Save button becomes `💾 Save (1) ▾`.
4. Click it.
5. Open your project folder in Explorer. There's now one JSON file, in the folder matching the item's
   class, containing your edit.

Everything else in this guide is a more interesting version of those five steps.

## The other header buttons

| Button | What it does |
|---|---|
| `📂 Open project` | Pick an existing project folder. The `▾` beside it lists projects found in your Projects folder, then recently opened folders. |
| `📌 Pin folder…` | Pin one folder for one-click reopen. After pinning it shows the folder name; its `▾` lets you change or unpin it. |
| `✨ New project` | The flow above. |
| `💾 Save (n) ▾` | Clicking saves; hovering opens the menu — `Save as…`, `Export`, `Export flattened`, and the mod.io actions. See [ch. 13](13-shipping.md). |
| `⟳ Reload` | Re-read the folder from disk. **Discards in-memory edits.** Only appears once a folder is open. |
| `⌘K Search` | Search every loaded definition. `Ctrl+K` also works. See [ch. 4](04-getting-around.md). |
| `⚙` | Settings. |

The `×` on a row in the `📂 Open project ▾` dropdown **deletes that project folder from disk**, not
just the list entry. It asks first. Read the dialog.

## Saving, reloading, and not losing work

- **Save** writes every dirty record. Only dirty records — clean ones aren't rewritten, so your
  overlay stays thin.
- **Save as…** picks a new folder and writes the entire working set there. Use it to fork a project.
  With a Projects folder configured you get a dialog that creates the subfolder for you.
- **Undo** is `Ctrl+Z`, redo is `Ctrl+Y` or `Ctrl+Shift+Z`, and it covers every edit, creation and
  deletion — see [ch. 4](04-getting-around.md) for what it does and doesn't collapse into one step.
  Loading a project clears the history.
- **Reload** throws away unsaved changes and re-reads disk. It will not warn you as thoroughly as you
  might like — save first.
- **Draft restore.** The editor keeps a local draft of unsaved work. If the browser crashes or you
  close the tab with changes pending, the next load offers *"Restore unsaved changes?"* with
  **Restore** and **Discard**. Restore is almost always right; Discard is permanent.

## What you may see on load

**"Auto-created N missing assets from dangling refs."** A toast, not a dialog. Every load, the editor
walks every `definition_ref` in the project; where one names an id that nothing defines *and* the
editor's schema knows that reference's class, it mints an empty stub so the reference resolves. The
stubs are unsaved records like any other, so the next `Save` writes them into your project as real
files. If you didn't want them, undo or delete them before saving. A big number here usually means
you've opened a thin overlay without the base game underneath it.

**"Schema drift detected."** The project contains classes or properties the editor's schema doesn't
know about. This normally means the project came from a newer game build than the editor's schema.
You can **Continue anyway** — drift doesn't block editing or saving, and the unknown fields are
preserved untouched. It's a warning that some fields will render generically rather than with their
proper editors.

**"This project needs a newer editor."** The project's `project.json` declares a schema version this
editor doesn't support. Don't force it — update the editor first. Opening it anyway risks writing
files the newer format can't read back.

---

## Gotchas

- **`💾 Save` greyed out.** Either nothing is dirty, or your source is read-only (the bundled base
  game, or a folder opened without write permission). Use `Save as…` to write it somewhere you own.
- **Firefox/Safari.** You can browse but not save — the File System Access API isn't available. The
  header's folder buttons will be disabled.
- **Two tabs, one project.** Don't. Both hold their own in-memory copy and the second save wins,
  silently discarding the first.
- **`⟳ Reload` after editing.** It discards, it doesn't merge. Save first, every time.
- **The `×` in the projects dropdown deletes from disk.** Not just from the list.

---

Next: [Anatomy of a definition →](03-anatomy-of-a-definition.md)
