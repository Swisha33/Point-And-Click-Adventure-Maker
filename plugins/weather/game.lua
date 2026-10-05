-- Weather plugin - Lua part (LÖVE PC/Android, PS Vita): rain / snow over the level.
return function(api)
  local B = api.B
  local drops = {}
  local preview = nil
  local function scene() local S = api.state() return S and S.scene end
  local function mode()
    if preview then return preview end
    local d = api.data
    local sc = scene()
    if d.override and d.override[sc] then return d.override[sc] end
    return (api.settings.levels or {})[sc] or "none"
  end
  local function spawn(m, top)
    return { x = math.random() * 1000 - 20, y = top and (-10 - math.random() * 40) or math.random() * 540,
             v = m == "snow" and (0.8 + math.random() * 1.2) or (9 + math.random() * 5), s = math.random() }
  end

  api.registerAction("weather", function(act)
    local d = api.data
    d.override = d.override or {}
    d.override[(act.value and act.value ~= "") and act.value or scene()] = act.key or "none"
  end)
  api.on("sceneEnter", function() drops = {} end)
  api.on("update", function(dt)
    local m = mode()
    if m ~= "rain" and m ~= "snow" then return end
    local n = math.min(api.settings.amount or 140, 160)
    while #drops < n do drops[#drops + 1] = spawn(m, false) end
    local k = dt * 60
    for i, p in ipairs(drops) do
      p.y = p.y + p.v * k
      p.x = p.x + (m == "rain" and -2 * k or math.sin((p.y + i * 30) / 40) * 0.6 * k)
      if p.y > 545 then drops[i] = spawn(m, true) end
    end
  end)
  api.on("drawWorld", function()
    local m = mode()
    if m == "rain" then
      for _, p in ipairs(drops) do B.rect("fill", p.x, p.y, 2, 12, 180, 200, 255, 140) end
    elseif m == "snow" then
      for _, p in ipairs(drops) do local r = 2 + p.s * 3 B.rect("fill", p.x, p.y, r, r, 255, 255, 255, 220) end
    end
  end)
  -- on-device editor: EDITOR > PLUGINS
  api.addEditorButton("WEATHER HERE: CYCLE", function()
    local lv = api.settings.levels or {}
    api.settings.levels = lv
    local sc = scene()
    local cur = lv[sc] or "none"
    lv[sc] = (cur == "none" and "rain") or (cur == "rain" and "snow") or nil
    drops = {}
    api.toast("Weather in " .. tostring(sc) .. ": " .. tostring(lv[sc] or "none") .. " (SAVE EDITS)")
  end)
  api.addEditorButton("WEATHER PREVIEW", function()
    preview = (preview == nil and "rain") or (preview == "rain" and "snow") or nil
    drops = {}
  end)
end
