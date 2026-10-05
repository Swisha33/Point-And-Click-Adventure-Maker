-- LÖVE 11.x backend (Windows / macOS / Linux / Android / iOS).
local B = {}
local lg = love.graphics

local isMobile = love.system.getOS() == "Android" or love.system.getOS() == "iOS"

-- LÖVE 0.10 compatibility (old Android loader apps): colours 0-255, no getInfo
local major = love.getVersion and love.getVersion() or 0
local V11 = major >= 11
B.V11 = V11
if not love.filesystem.getInfo then
  love.filesystem.getInfo = function(p)
    if love.filesystem.exists(p) then return { type = love.filesystem.isDirectory(p) and "directory" or "file" } end
    return nil
  end
end
local CS = V11 and 1 or 255   -- colour scale
local function setc(r, g, b, a) lg.setColor(r * CS, g * CS, b * CS, (a or 1) * CS) end
B.setc = setc
B.platform = isMobile and "love-mobile" or "love-desktop"
B.showCursor = false

local fontPath
local fonts = {}
local function font(size)
  size = math.floor(size + 0.5)
  local f = fonts[size]
  if not f then
    if fontPath and love.filesystem.getInfo(fontPath) then f = lg.newFont(fontPath, size)
    else f = lg.newFont(size) end
    fonts[size] = f
  end
  return f
end
function B.setFont(path) fontPath = path fonts = {} end

local function col(r, g, b, a) setc(r / 255, g / 255, b / 255, (a or 255) / 255) end

function B.loadImage(path)
  if not love.filesystem.getInfo(path) then return nil end
  local ok, img = pcall(lg.newImage, path)
  if not ok then return nil end
  img:setFilter("linear", "linear")
  return img
end
function B.imageSize(img) return img:getWidth(), img:getHeight() end

local quads = setmetatable({}, { __mode = "k" })
function B.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh, flip, alpha)
  local iw, ih = img:getWidth(), img:getHeight()
  local per = quads[img]
  if not per then per = {} quads[img] = per end
  local key = sx .. ":" .. sy .. ":" .. sw .. ":" .. sh
  local q = per[key]
  if not q then q = lg.newQuad(sx, sy, sw, sh, iw, ih) per[key] = q end
  setc(1, 1, 1, alpha or 1)
  local kx, ky = dw / sw, dh / sh
  if flip then lg.draw(img, q, dx + dw, dy, 0, -kx, ky)
  else lg.draw(img, q, dx, dy, 0, kx, ky) end
end

function B.rect(mode, x, y, w, h, r, g, b, a, lw)
  col(r, g, b, a)
  if mode == "line" then lg.setLineWidth(lw or 1) end
  lg.rectangle(mode, x, y, w, h)
end
function B.circle(mode, x, y, rad, r, g, b, a, lw)
  col(r, g, b, a)
  if mode == "line" then lg.setLineWidth(lw or 1) end
  lg.circle(mode, x, y, rad)
end
function B.text(s, x, y, size, r, g, b, a)
  lg.setFont(font(size))
  col(r, g, b, a)
  lg.print(s, math.floor(x + 0.5), math.floor(y + 0.5))
end
function B.textWidth(s, size) return font(size):getWidth(s) end

-- sound
function B.loadSound(path, stream)
  if not love.filesystem.getInfo(path) then return nil end
  local ok, src = pcall(love.audio.newSource, path, stream and "stream" or "static")
  if ok then return src end
  return nil
end
function B.playSound(s, loop)
  s:stop()
  s:setLooping(loop and true or false)
  s:play()
end
function B.stopSound(s) s:stop() end
function B.setVolume(s, v) s:setVolume(v) end

-- files: game files from the .love / source folder, saves in the LÖVE save directory
function B.readFile(path)
  if not love.filesystem.getInfo(path) then return nil end
  return love.filesystem.read(path)
end
function B.readSave(name)
  if not love.filesystem.getInfo(name) then return nil end
  -- getInfo also sees files from the game folder; only accept real save-dir files
  local real = love.filesystem.getRealDirectory(name)
  if real ~= love.filesystem.getSaveDirectory() then return nil end
  return love.filesystem.read(name)
end
function B.writeSave(name, data) return love.filesystem.write(name, data) end
function B.deleteSave(name) return love.filesystem.remove(name) end

-- alpha mask for building the walk grid when config has no baked navgrid
function B.loadMask(path)
  if not love.filesystem.getInfo(path) then return nil end
  local ok, data = pcall(love.image.newImageData, path)
  if not ok then return nil end
  return {
    w = data:getWidth(), h = data:getHeight(),
    alpha = function(x, y) local _, _, _, a = data:getPixel(x, y) return V11 and a * 255 or a end,
    release = function() if data.release then data:release() end end,
  }
end

function B.time() return love.timer.getTime() end
-- text entry for the on-device editor (opens the on-screen keyboard on Android)
function B.startText() love.keyboard.setTextInput(true) end
function B.stopText() love.keyboard.setTextInput(false) end
if not isMobile then
  function B.toggleFullscreen() love.window.setFullscreen(not love.window.getFullscreen(), "desktop") end
end
function B.quit() love.event.quit() end

-- file browser for the on-device editor: pictures in the save folder ("images/"), the game's media
-- PC: drop a picture onto the window to copy it into images/ (see love.filedropped in main.lua)
pcall(love.filesystem.createDirectory, "images")
function B.pickerRoots()
  return {
    { label = "My pictures (save folder/images)", path = "images" },
    { label = "Game media", path = "media" },
    { label = "Game assets", path = "assets" },
  }
end
function B.listDir(path)
  local out = {}
  local ok, items = pcall(love.filesystem.getDirectoryItems, path)
  if not ok or not items then return out end
  for _, name in ipairs(items) do
    local info = love.filesystem.getInfo(path .. "/" .. name)
    if info then out[#out + 1] = { name = name, dir = info.type == "directory" } end
  end
  return out
end
B.saveDir = love.filesystem.getSaveDirectory()

return B
