-- PS Vita backend for Lua Player Plus Vita (lpp-vita, LuaJIT).
-- API checked against the lpp-vita sources:
--  * Graphics.fillRect / fillEmptyRect / drawLine take (x1, x2, y1, y2, color)  <- note the order!
--  * Graphics.drawImageExtended draws the image part CENTRED on (x, y)
--  * Sound.play() resets the volume to max, so the volume is applied after play
--  * Sound.open() only accepts OGG(Vorbis)/WAV/AIFF/MIDI and MP3 *with* an ID3v2.3 tag
--    -> tools/build_vita.py converts all audio to .ogg
local B = {}
B.platform = "vita"
B.showCursor = true

local ROOT = "app0:/"
local SAVE = "ux0:/data/SirLicks/"
local OY = 2            -- 960x540 game centred on the 960x544 screen

local clock = Timer.new()
function B.time() return Timer.getTime(clock) / 1000 end

pcall(System.createDirectory, "ux0:/data")
pcall(System.createDirectory, SAVE)

local function color(r, g, b, a) return Color.new(math.floor(r), math.floor(g), math.floor(b), math.floor(a or 255)) end
local floor = math.floor

-- ------------------------------------------------------------ fonts
local font, fontSize
function B.setFont(path)
  local ok, f = pcall(Font.load, ROOT .. path)
  if ok and f then font = f else font = nil end
  fontSize = nil
end
local function useSize(size)
  size = floor(size + 0.5)
  if font and fontSize ~= size then Font.setPixelSizes(font, size) fontSize = size end
  return size
end
function B.text(s, x, y, size, r, g, b, a)
  local sz = useSize(size)
  if font then
    Font.print(font, floor(x), floor(y + OY), s, color(r, g, b, a))
  else
    Graphics.debugPrint(floor(x), floor(y + OY), s, color(r, g, b, a))
  end
  local _ = sz
end
function B.textWidth(s, size)
  useSize(size)
  if font then
    local ok, w = pcall(Font.getTextWidth, font, s)
    if ok and w then return w end
  end
  return #s * size * 0.6
end

-- ------------------------------------------------------------ images
function B.loadImage(path)
  if not System.doesFileExist(ROOT .. path) then return nil end
  local ok, img = pcall(Graphics.loadImage, ROOT .. path)
  if not ok or not img then return nil end
  pcall(Graphics.setImageFilters, img, FILTER_LINEAR, FILTER_LINEAR)
  return img
end
function B.imageSize(img) return Graphics.getImageWidth(img), Graphics.getImageHeight(img) end

function B.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh, flip, alpha)
  sx, sy = floor(sx + 0.5), floor(sy + 0.5)
  if sw <= 0 or sh <= 0 then return end
  local kx, ky = dw / sw, dh / sh
  if flip then kx = -kx end
  local cx, cy = dx + dw / 2, dy + dh / 2 + OY
  if alpha and alpha < 1 then
    Graphics.drawImageExtended(cx, cy, img, sx, sy, sw, sh, 0, kx, ky, color(255, 255, 255, alpha * 255))
  else
    Graphics.drawImageExtended(cx, cy, img, sx, sy, sw, sh, 0, kx, ky)
  end
end

-- ------------------------------------------------------------ shapes
function B.rect(mode, x, y, w, h, r, g, b, a, lw)
  local c = color(r, g, b, a)
  y = y + OY
  if mode == "fill" then
    Graphics.fillRect(x, x + w, y, y + h, c)
  else
    for i = 0, (lw or 1) - 1 do
      Graphics.fillEmptyRect(x + i, x + w - i, y + i, y + h - i, c)
    end
  end
end

local SEG = 28
function B.circle(mode, x, y, rad, r, g, b, a, lw)
  local c = color(r, g, b, a)
  y = y + OY
  if mode == "fill" then
    Graphics.fillCircle(x, y, rad, c)
    return
  end
  for k = 0, (lw or 1) - 1 do
    local rr = rad - k * 0.8
    local px, py = x + rr, y
    for i = 1, SEG do
      local t = i / SEG * math.pi * 2
      local nx, ny = x + math.cos(t) * rr, y + math.sin(t) * rr
      Graphics.drawLine(px, nx, py, ny, c)
      px, py = nx, ny
    end
  end
end

-- ------------------------------------------------------------ sound
-- A "sound" is a descriptor; every play opens its own lpp-vita handle so sounds can
-- overlap, be stopped (closed) and replayed reliably.
local voices = {}
function B.loadSound(path)
  if not System.doesFileExist(ROOT .. path) then return nil end
  return { path = ROOT .. path, vol = 1, handles = {} }
end
function B.playSound(s, loop)
  local ok, h = pcall(Sound.open, s.path)
  if not ok or not h then return end
  Sound.play(h, loop and true or false)
  Sound.setVolume(h, floor(s.vol * 32767))
  s.handles[#s.handles + 1] = h
  voices[#voices + 1] = { s = s, h = h, loop = loop }
end
function B.stopSound(s)
  for _, h in ipairs(s.handles) do pcall(Sound.close, h) end
  s.handles = {}
  for i = #voices, 1, -1 do if voices[i].s == s then table.remove(voices, i) end end
end
function B.setVolume(s, v)
  s.vol = v
  for _, h in ipairs(s.handles) do Sound.setVolume(h, floor(v * 32767)) end
end
-- called every frame from index.lua: release finished one-shot sounds
function B.reapSounds()
  for i = #voices, 1, -1 do
    local v = voices[i]
    if not v.loop and not Sound.isPlaying(v.h) then
      pcall(Sound.close, v.h)
      for j = #v.s.handles, 1, -1 do if v.s.handles[j] == v.h then table.remove(v.s.handles, j) end end
      table.remove(voices, i)
    end
  end
end

-- ------------------------------------------------------------ files
local function readAll(p)
  local f = io.open(p, "rb")
  if not f then return nil end
  local d = f:read("*a")
  f:close()
  return d
end
function B.readFile(path) return readAll(ROOT .. path) end
function B.readSave(name) return readAll(SAVE .. name) end
function B.writeSave(name, data)
  local f = io.open(SAVE .. name, "wb")
  if not f then return false end
  f:write(data)
  f:close()
  return true
end
function B.deleteSave(name)
  if System.doesFileExist(SAVE .. name) then pcall(System.deleteFile, SAVE .. name) end
  return true
end

function B.loadMask(path)
  local img = B.loadImage(path)
  if not img then return nil end
  local w, h = B.imageSize(img)
  return {
    w = w, h = h,
    alpha = function(x, y) return Color.getA(Graphics.getPixel(x, y, img)) end,
    release = function() Graphics.freeImage(img) end,
  }
end

-- text entry for the on-device editor: system keyboard, polled from index.lua
local kbActive = false
function B.startText(title, text)
  local ok = pcall(Keyboard.start, title or "Text", text or "", 64, TYPE_DEFAULT, MODE_TEXT)
  kbActive = ok
end
function B.stopText() if kbActive then pcall(Keyboard.clear) kbActive = false end end
-- returns done, text (text = nil when cancelled)
function B.pollText()
  if not kbActive then return false end
  local st = Keyboard.getState()
  if st == RUNNING then return false end
  local txt = (st == FINISHED) and Keyboard.getInput() or nil
  Keyboard.clear()
  kbActive = false
  return true, txt
end

function B.quit() System.exit() end

B.OY = OY
return B
