-- com.test.kitchensink: UI VM fixture. Runs on every machine for each local
-- player once a screen of this mod mounts (or the UI subsystem boots the mod).
-- It touches each UI-side namespace once so the content test and the kitchen
-- sink node can prove the sandbox, the read-only tsic table and the UI.* events.

local hits = 0

tsic.mod.onLoad(function()
  tsic.log.info("kitchen sink UI script loaded for %s %s", tsic.mod.id(), tsic.mod.version())
end)

-- A hand-written binding: the same thing a declarative screen binding does.
tsic.ui.screen.bind("UI.Screen.Changed", function(payload)
  hits = hits + 1
  tsic.log.info("screen changed to %s (%d so far)", tostring(payload.Name), hits)
end)

tsic.mod.onUnload(function()
  tsic.log.info("kitchen sink UI script unloading after %d screen changes", hits)
end)
