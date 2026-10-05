-- PS Vita entry point (Lua Player Plus Vita runs app0:/index.lua).
-- Controls: touch = tap/drag | left stick or D-pad = cursor, CROSS = click
--           TRIANGLE / START = side panel, CIRCLE = back, SELECT or hold the Dignity box = editor

-- lpp-vita has no package.path into app0:, so provide a tiny require
do
  local loaded = {}
  function require(name)
    if loaded[name] ~= nil then return loaded[name] end
    local path = "app0:/" .. name:gsub("%.", "/") .. ".lua"
    local fn, err = loadfile(path)
    if not fn then error("require '" .. name .. "': " .. tostring(err)) end
    local res = fn(name)
    if res == nil then res = true end
    loaded[name] = res
    return res
  end
end

Sound.init()
local B = require("platform.vita")
local G = require("engine.game")

local ok, err = pcall(G.init, B)

local cx, cy = 480, 270          -- virtual cursor
local touching, crossDown = false, false
local oldPad = Controls.read()
local last = B.time()

local function pressed(pad, btn) return Controls.check(pad, btn) and not Controls.check(oldPad, btn) end
local function released(pad, btn) return not Controls.check(pad, btn) and Controls.check(oldPad, btn) end

while true do
  local now = B.time()
  local dt = now - last
  last = now

  if ok then
    local pad = Controls.read()

    -- front touch (lpp-vita already maps it to 960x544)
    local tx, ty = Controls.readTouch()
    if tx then
      tx, ty = tx, ty - B.OY
      cx, cy = tx, ty
      if not touching then G.pointerDown(tx, ty) touching = true
      else G.pointerMove(tx, ty) end
    elseif touching then
      G.pointerUp(cx, cy)
      touching = false
    end

    -- left stick / d-pad move the cursor
    local ax, ay = Controls.readLeftAnalog()
    local mx, my = (ax - 128), (ay - 128)
    if math.abs(mx) < 28 then mx = 0 end
    if math.abs(my) < 28 then my = 0 end
    local speed = 520 * dt
    local vx, vy = mx / 128 * speed, my / 128 * speed
    if Controls.check(pad, SCE_CTRL_LEFT) then vx = -speed * 0.7 end
    if Controls.check(pad, SCE_CTRL_RIGHT) then vx = speed * 0.7 end
    if Controls.check(pad, SCE_CTRL_UP) then vy = -speed * 0.7 end
    if Controls.check(pad, SCE_CTRL_DOWN) then vy = speed * 0.7 end
    if vx ~= 0 or vy ~= 0 then
      cx = math.max(0, math.min(959, cx + vx))
      cy = math.max(0, math.min(539, cy + vy))
      G.pointerMove(cx, cy)
    end

    if pressed(pad, SCE_CTRL_CROSS) then G.pointerDown(cx, cy) crossDown = true end
    if crossDown and released(pad, SCE_CTRL_CROSS) then G.pointerUp(cx, cy) crossDown = false end
    if pressed(pad, SCE_CTRL_TRIANGLE) or pressed(pad, SCE_CTRL_START) then G.key("menu") end
    if pressed(pad, SCE_CTRL_CIRCLE) then G.key("back") end
    if pressed(pad, SCE_CTRL_SELECT) then G.key("debug") end
    oldPad = pad

    if B.pollText then   -- system keyboard of the on-device editor
      local done, txt = B.pollText()
      if done then G.textResult(txt) end
    end
    local uok, uerr = pcall(G.update, dt)
    if not uok then ok, err = false, uerr end
    B.reapSounds()
  end

  Graphics.initBlend()
  Screen.clear()
  if ok then
    local dok, derr = pcall(G.draw)
    if not dok then ok, err = false, derr end
  else
    Graphics.debugPrint(10, 10, "Fehler:", Color.new(255, 80, 80))
    local y = 40
    for line in tostring(err):gmatch("[^\n]+") do
      Graphics.debugPrint(10, y, line:sub(1, 90), Color.new(255, 255, 255))
      y = y + 22
    end
    Graphics.debugPrint(10, y + 20, "START = beenden", Color.new(255, 255, 0))
    if Controls.check(Controls.read(), SCE_CTRL_START) then System.exit() end
  end
  Graphics.termBlend()
  Screen.flip()
  Screen.waitVblankStart()
end
