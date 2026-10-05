-- LÖVE entry point (PC + Android). The PS Vita entry point is index.lua.
local B = require("platform.love")
local G = require("engine.game")

local VW, VH = 960, 540
local scale, ox, oy = 1, 0, 0
local failed = nil      -- error text shown on screen instead of a black screen
local loaded = false

local function log(msg)
  print(msg)
  pcall(love.filesystem.append, "log.txt", os.date("%H:%M:%S ") .. tostring(msg) .. "\n")
end

local function layout()
  local w, h = love.graphics.getDimensions()
  scale = math.min(w / VW, h / VH)
  if scale <= 0 then scale = 1 end
  ox = math.floor((w - VW * scale) / 2)
  oy = math.floor((h - VH * scale) / 2)
end
local function toVirtual(x, y) return (x - ox) / scale, (y - oy) / scale end

local function safe(fn, ...)
  if failed then return end
  local ok, err = xpcall(fn, function(e) return tostring(e) .. "\n" .. debug.traceback("", 2) end, ...)
  if not ok then failed = err log("ERROR: " .. err) end
end

function love.load()
  pcall(love.filesystem.remove, "log.txt")
  local w, h = love.graphics.getDimensions()
  log(string.format("LOVE %s | %s | window %dx%d", (love.getVersion and table.concat({ love.getVersion() }, ".", 1, 3) or "?"),
    love.system.getOS(), w, h))
  layout()
end

function love.resize() layout() end

function love.update(dt)
  if loaded ~= true then return end
  safe(G.update, dt)
end

local function drawLoading()
  B.setc(1, 1, 1, 1)
  love.graphics.print("Loading...", 20, 20)
end

function love.draw()
  local lg = love.graphics
  lg.clear(0, 0, 0)
  if failed then
    B.setc(1, 0.4, 0.4, 1)
    lg.printf("Sir Licks-a-Lot crashed - please send this text:\n\n" .. failed, 10, 10, lg.getWidth() - 20)
    return
  end
  if not loaded then
    -- first frame: show something, then load (loading big images can take a moment on phones)
    drawLoading()
    loaded = "pending"
    return
  end
  if loaded == "pending" then
    safe(G.init, B)
    loaded = true
    log("init ok")
  end
  lg.push()
  lg.translate(ox, oy)
  lg.scale(scale)
  safe(G.draw)
  lg.pop()
  -- black bars outside the 16:9 game area
  B.setc(0, 0, 0, 1)
  local w, h = lg.getDimensions()
  if ox > 0 then lg.rectangle("fill", 0, 0, ox, h) lg.rectangle("fill", w - ox, 0, ox, h) end
  if oy > 0 then lg.rectangle("fill", 0, 0, w, oy) lg.rectangle("fill", 0, h - oy, w, oy) end
  B.setc(1, 1, 1, 1)
end

-- touch on Android arrives as mouse events too (LÖVE default), so mouse is enough
function love.mousepressed(x, y, button)
  if loaded == true and button == 1 then safe(G.pointerDown, toVirtual(x, y)) end
end
function love.mousemoved(x, y)
  if loaded == true then safe(G.pointerMove, toVirtual(x, y)) end
end
function love.mousereleased(x, y, button)
  if loaded == true and button == 1 then safe(G.pointerUp, toVirtual(x, y)) end
end

function love.keypressed(key)
  if failed and key == "escape" then love.event.quit() return end
  if loaded ~= true then return end
  if G.textEditing() then   -- typing in the on-device editor
    if key == "return" or key == "kpenter" then safe(G.key, "enter")
    elseif key == "backspace" then safe(G.key, "backspace")
    elseif key == "escape" then safe(G.key, "escape") end
    return
  end
  if key == "f2" then safe(G.key, "debug")
  elseif key == "tab" then safe(G.key, "menu")
  elseif key == "escape" then safe(G.key, "back")   -- Android back button = escape
  elseif key == "return" or key == "space" then if G.mode() == "title" then safe(G.key, "menu") end
  elseif key == "f11" then love.window.setFullscreen(not love.window.getFullscreen(), "desktop") end
end

function love.textinput(t) if loaded == true then safe(G.textinput, t) end end

-- PC: drop a picture onto the window -> copied to <save folder>/images/ and offered in the editor's file picker
function love.filedropped(file)
  if loaded ~= true then return end
  local name = (file:getFilename():match("([^/\\]+)$") or "picture.png"):gsub("[^%w%._%-]", "_")
  if not name:lower():match("%.png$") and not name:lower():match("%.jpe?g$") and not name:lower():match("%.bmp$") then return end
  local ok = pcall(file.open, file, "r")
  if not ok then return end
  local data = file:read()
  file:close()
  love.filesystem.createDirectory("images")
  love.filesystem.write("images/" .. name, data)
  safe(G.fileDropped, "images/" .. name)
end

-- gamepad support (e.g. Android with controller)
function love.gamepadpressed(_, btn)
  if loaded ~= true then return end
  if btn == "back" then safe(G.key, "debug")
  elseif btn == "start" or btn == "y" then safe(G.key, "menu")
  elseif btn == "b" then safe(G.key, "back") end
end
