-- com.test.scripting: mod scripting fixture.
--
-- Runs in the rules VM on the listen-server host. Exercises the tsic.* gameplay
-- surface end to end and records every step into per-mod storage so a harness
-- (PIE spec / Gauntlet node) can assert the trail afterwards:
--   storage["log"]  = ordered { { step, ok }, ... } entries
--   storage["done"] = true once the full loop (boot -> schedule -> spawn ->
--                     grant) has completed
--
-- Timing rule: gameplay timing goes through tsic.schedule.at, which arms
-- against the authoritative game clock and fires from the host's tick.

local steps = {}

local function record(step, ok)
  steps[#steps + 1] = { step = step, ok = ok and true or false }
  tsic.storage.set("log", steps)
end

tsic.mod.onLoad(function()
  local time, err = tsic.time.get()
  record("boot", time ~= nil)
  if not time then
    tsic.log.warn("boot failed: %s", tostring(err))
    return
  end

  -- When the schedule fires: spawn a brainless dummy enemy and grant the host
  -- an item, then flag completion.
  local id, schedErr = tsic.schedule.at(2, function()
    record("schedule.fired", true)
    local spawn, spawnErr = tsic.enemies.spawn{ enemy = "BoneHead", withBrain = false, distance = 600 }
    record("enemy.spawn", spawn ~= nil)
    if not spawn then tsic.log.warn("enemy.spawn failed: %s", tostring(spawnErr)) end
    local grant, grantErr = tsic.items.grant("ID_Bread_CN", 3)
    record("item.grant", grant ~= nil)
    if not grant then tsic.log.warn("item.grant failed: %s", tostring(grantErr)) end
    tsic.storage.set("done", true)
  end)
  record("schedule.at", id ~= nil)
  if not id then tsic.log.warn("schedule.at failed: %s", tostring(schedErr)) end
end)
