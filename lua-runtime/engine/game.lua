-- Sir Licks-a-Lot point & click engine — platform independent core.
-- The platform backend (platform/love.lua or platform/vita.lua) provides drawing,
-- sound, file access and forwards input to the G.pointer*/G.key functions.
local U = require("engine.util")
local N = require("engine.nav")

local G = {}

-- movement direction from a movement vector (top-down games)
local function moveDir(dx, dy, prev)
  if math.abs(dx) < 0.01 and math.abs(dy) < 0.01 then return prev or "side" end
  if math.abs(dy) > math.abs(dx) * 1.3 then return dy < 0 and "up" or "down" end
  return "side"
end
local B            -- backend
local cfg          -- game config (game/config.lua, or the debug-edited copy from the save folder)
local S            -- runtime state of the current play-through

local VW, VH = 960, 540
local PANEL_W = 240
local FONT = 13

-- ---------------------------------------------------------------- colours
local C = {
  gold = { 255, 215, 0, 255 }, darkred = { 139, 0, 0, 255 }, brown = { 78, 52, 46, 255 },
  white = { 255, 255, 255, 255 }, black = { 0, 0, 0, 255 }, parchment = { 230, 201, 168, 235 },
  green = { 0, 255, 0, 255 }, dgreen = { 0, 110, 0, 255 }, cyan = { 0, 255, 255, 255 },
  yellow = { 255, 255, 0, 255 }, red = { 255, 0, 0, 255 },
}
local function rgba(c, a) return c[1], c[2], c[3], a or c[4] end

-- ---------------------------------------------------------------- defaults / migration
local function defaults(c)
  c.spawns = c.spawns or { village = { x = 480, y = 400 } }
  c.backgrounds = c.backgrounds or {}
  c.exits = c.exits or {}
  c.hotspots = c.hotspots or {}
  c.levelLicks = c.levelLicks or {}
  c.levelFollowerAccess = c.levelFollowerAccess or {}
  c.images = c.images or {}
  c.imageSizes = c.imageSizes or {}
  c.navgrids = c.navgrids or {}
  c.perspective = c.perspective or {}
  c.audio = c.audio or {}
  c.audio.music = c.audio.music or "assets/music.mp3"
  c.audio.click = c.audio.click or "assets/click.mp3"
  c.volumes = c.volumes or { music = 0.5, amb = 0.5, sfx = 0.5 }
  c.lickConfig = c.lickConfig or { text = "Lick", response = "...", dignityChange = -1 }
  c.titleScreen = c.titleScreen or {}
  c.titleScreen.backgroundImage = c.titleScreen.backgroundImage or "assets/title.png"
  c.titleScreen.titleText = c.titleScreen.titleText or "Sir Licks-a-Lot"
  c.titleScreen.startButtonText = c.titleScreen.startButtonText or "Start Adventure"
  c.ui = c.ui or {}
  c.ui.orb = c.ui.orb or "assets/hotspot.png"
  c.ui.bubble = c.ui.bubble or "assets/character_talk.png"
  c.ui.panelBox = c.ui.panelBox or "assets/uitext.png"
  c.ui.font = c.ui.font or "assets/font.ttf"
  c.knight = c.knight or { image = "assets/knight.png", frames = 5, animSpeed = 6, offY = 35, baseScale = 0.55, speed = 6 }
  c.startDignity = c.startDignity or 3
  c.items = c.items or {}
  c.combos = c.combos or {}
  c.interaction = c.interaction or { mode = "verbs", walkFirst = true }
  for scene, list in pairs(c.hotspots) do   -- stable ids for save games / show / hide
    for i, h in ipairs(list) do if not h.id then h.id = scene .. "_" .. i end end
  end
  if c.allowDebug == nil then c.allowDebug = true end
  if not c.sceneOrder then
    c.sceneOrder = {}
    for k in pairs(c.spawns) do c.sceneOrder[#c.sceneOrder + 1] = k end
    table.sort(c.sceneOrder)
  end
  c.startScene = c.startScene or c.sceneOrder[1] or "village"
  return c
end

-- ---------------------------------------------------------------- images
local imgCache = {}
local function getImage(path)
  if not path or path == "" or path:sub(1, 5) == "data:" then return nil end
  local e = imgCache[path]
  if e == nil then
    local h = B.loadImage(path)
    if h then
      local w, hh = B.imageSize(h)
      local a = cfg.imageSizes[path]
      e = { h = h, w = w, hgt = hh, aw = (a and a.w) or w, ah = (a and a.h) or hh }
    else
      e = false
    end
    imgCache[path] = e
  end
  return e or nil
end
G.getImage = getImage

-- draw a source rect given in *authored* pixels (as set up in the editor) into a dest rect
local function drawPart(path, sx, sy, sw, sh, dx, dy, dw, dh, flip, alpha)
  local e = getImage(path)
  if not e then return false end
  local rx, ry = e.w / e.aw, e.hgt / e.ah
  B.drawImage(e.h, sx * rx, sy * ry, sw * rx, sh * ry, dx, dy, dw, dh, flip, alpha or 1)
  return true
end
local function drawFull(path, dx, dy, dw, dh, flip, alpha)
  local e = getImage(path)
  if not e then return false end
  B.drawImage(e.h, 0, 0, e.w, e.hgt, dx, dy, dw, dh, flip, alpha or 1)
  return true
end
local function authoredSize(path)
  local e = getImage(path)
  if e then return e.aw, e.ah end
  local a = cfg.imageSizes[path]
  if a then return a.w, a.h end
  return 100, 100
end

-- ---------------------------------------------------------------- text
local function textW(s, size) return B.textWidth(s, size or FONT) end
local function textC(s, cx, y, size, col, a) -- centred
  B.text(s, cx - textW(s, size) / 2, y, size or FONT, rgba(col, a))
end

-- ---------------------------------------------------------------- sound
local sounds = {}
local settings = { music = 0.5, sfx = 0.5, amb = 0.5, muted = false }
local function getSound(name)
  local path = cfg.audio[name]
  if not path or path:sub(1, 5) == "data:" then return nil end
  local e = sounds[name]
  if e == nil then
    e = B.loadSound(path, name == "music" or cfg.spawns[name] ~= nil) or false
    sounds[name] = e
  end
  return e or nil
end
local function volFor(name)
  if settings.muted then return 0 end
  if name == "music" then return settings.music end
  if cfg.spawns[name] then return settings.amb end
  return settings.sfx
end
local function play(name, loop)
  local s = getSound(name)
  if not s then return nil end
  B.setVolume(s, volFor(name))
  B.playSound(s, loop)
  return s
end
local function applyVolumes()
  for name, s in pairs(sounds) do if s then B.setVolume(s, volFor(name)) end end
end
local function saveSettings() B.writeSave("settings.lua", U.serialize(settings)) end

-- ---------------------------------------------------------------- backgrounds / nav
local function bgRect(scene)
  local imgs = cfg.images[scene] or {}
  local bc = cfg.backgrounds[scene] or {}
  local x, y, w, h = 0, 0, VW, VH
  local fit = bc.fit or "stretch"
  if fit ~= "stretch" and imgs.bg then
    local iw, ih = authoredSize(imgs.bg)
    local s = (fit == "cover") and math.max(VW / iw, VH / ih) or math.min(VW / iw, VH / ih)
    w, h = iw * s, ih * s
    x, y = (VW - w) / 2, (VH - h) / 2
  end
  local sc = bc.scale or 1
  return (bc.x or 0) + x * sc, (bc.y or 0) + y * sc, w * sc, h * sc
end

local navCache = {}
local function navFor(scene)
  if navCache[scene] then return navCache[scene] end
  local g
  if cfg.navgrids[scene] then
    g = N.fromStrings(cfg.navgrids[scene])
  else
    local imgs = cfg.images[scene] or {}
    local mask = imgs.path and B.loadMask and B.loadMask(imgs.path)
    if mask then
      local rx, ry, rw, rh = bgRect(scene)
      g = N.fromSampler(function(px, py)
        local u = (px - rx) / rw * mask.w
        local v = (py - ry) / rh * mask.h
        if u < 0 or v < 0 or u >= mask.w or v >= mask.h then return false end
        return mask.alpha(math.floor(u), math.floor(v)) > 40
      end)
      if mask.release then mask.release() end
    else
      g = N.allWalkable()
    end
  end
  navCache[scene] = g
  return g
end

local function depth(scene, x, y)
  local p = cfg.perspective[scene] or { axis = "y", from = 300, to = 540, far = 0.5, near = 1.1, exp = 1 }
  local v = (p.axis == "x") and x or y
  local t = (v - (p.from or 0)) / (((p.to or 540) - (p.from or 0)) ~= 0 and ((p.to or 540) - (p.from or 0)) or 1)
  if t < 0 then t = 0 end
  return (p.far or 0.5) + (t ^ (p.exp or 1)) * ((p.near or 1.1) - (p.far or 0.5))
end

-- ---------------------------------------------------------------- state
local function freshState()
  local st = {
    mode = "play", scene = cfg.startScene, dignity = cfg.startDignity,
    hotspots = {}, followers = {},
    knight = { x = 480, y = 400, path = {}, state = "IDLE", facingRight = false, scale = 0.5 },
    dialogue = nil, clickFx = nil, frame = 0, ambience = nil, current = nil, gameOver = nil,
    unlocked = {}, pendingTravel = nil,
    inv = {}, held = nil, flags = {}, vis = {}, once = {},
    seq = nil, choices = nil, verbMenu = nil, pendingAct = nil, notice = nil,
  }
  for scene, list in pairs(cfg.hotspots) do
    st.hotspots[scene] = {}
    for i, h in ipairs(list) do
      local c = U.deepcopy(h)
      c._src = h
      st.hotspots[scene][i] = c
    end
  end
  return st
end

local ui = { panelOpen = true, buttons = {}, debug = false, drag = false, showGrid = true, dragging = nil,
             mx = -999, my = -999, cursor = false, toast = nil }
G.ui = ui

local function toast(msg) ui.toast = { text = msg, t = 2.5 } end

local autosave   -- set further down (needs the save code)
local saveCache  -- save slot info for the title / slot menus
local function setScene(name, noAutosave)
  if not cfg.spawns[name] then return end
  local st = S
  st.verbMenu, st.pendingAct, st.choices, st.seq = nil, nil, nil, nil
  -- followers leave with the knight
  local list = st.hotspots[st.scene]
  if list then
    for i = #list, 1, -1 do
      if list[i].isFollowing then
        table.insert(st.followers, list[i])
        table.remove(list, i)
      end
    end
  end
  st.scene = name
  local sp = cfg.spawns[name]
  st.knight.x, st.knight.y = sp.x, sp.y
  st.knight.path, st.knight.state = {}, "IDLE"
  st.dialogue = nil
  if cfg.levelFollowerAccess[name] ~= false then
    st.hotspots[name] = st.hotspots[name] or {}
    for i, f in ipairs(st.followers) do
      f.x, f.y = st.knight.x - 50 - (i - 1) * 30, st.knight.y
      f.isFollowing = true
      table.insert(st.hotspots[name], f)
    end
    st.followers = {}
  end
  -- ambience
  if st.current then B.stopSound(st.current) st.current = nil end
  if st.ambience then B.stopSound(st.ambience) st.ambience = nil end
  if cfg.audio[name] then st.ambience = play(name, true) end
  navFor(name)
  if not noAutosave and st.mode == "play" and not ui.debug and autosave then autosave() end
end

function G.startGame(forLoad)
  S = freshState()
  S.mode = "play"
  setScene(cfg.startScene, forLoad)
  local m = getSound("music")
  if m then B.setVolume(m, volFor("music")) B.playSound(m, true) end
end

local function toTitle()
  if S then
    if S.ambience then B.stopSound(S.ambience) end
    if S.current then B.stopSound(S.current) end
  end
  local m = sounds.music
  if m then B.stopSound(m) end
  S = { mode = "title", frame = 0 }
  ui.debug = false
  ui.slotMenu = nil
  saveCache = nil
end

-- ---------------------------------------------------------------- hit testing
local function hotspotHit(h, x, y)
  local cx, cy = h.x + (h.hboxX or 0), h.y + (h.hboxY or 0)
  local w = h.w or ((h.r and h.r * 2) or 120)
  local hh = h.h or ((h.r and h.r * 2) or 120)
  if h.shape == "rect" then
    return x > cx - w / 2 and x < cx + w / 2 and y > cy - hh / 2 and y < cy + hh / 2
  end
  return U.dist(cx, cy, x, y) < w / 2
end

-- ---------------------------------------------------------------- adventure rules
-- items, flags, reactions, conversations, verbs, walk-then-act, save/load
-- (same rules as web/adventure.js)
local DEFAULT_TEXTS = { look = "Nothing special.", talk = "It doesn't answer.", use = "I can't use that.",
  item = "That doesn't work.", combine = "Those don't fit together.", bye = "Goodbye." }
local VERBS = { { "look", "Look" }, { "talk", "Talk" }, { "use", "Use" } }

local function texts()
  local t = {}
  for k, v in pairs(DEFAULT_TEXTS) do t[k] = v end
  local d = cfg.interaction and cfg.interaction.defaults
  if d then for k, v in pairs(d) do if v ~= "" then t[k] = v end end end
  return t
end
local function itemName(id) local it = cfg.items[id] return it and (it.name or id) or id end
local function hasItem(id) for _, v in ipairs(S.inv) do if v == id then return true end end return false end

local function condsOk(list)
  if not list then return true end
  for _, c in ipairs(list) do
    if c.type == "flag" and not S.flags[c.key] then return false end
    if c.type == "noflag" and S.flags[c.key] then return false end
    if c.type == "item" and not hasItem(c.key) then return false end
    if c.type == "noitem" and hasItem(c.key) then return false end
  end
  return true
end

local function isVisible(h)
  if h.isDiscovered then return false end
  local v = S.vis and S.vis[h.id]
  if v == false or (v == nil and h.startHidden) then return false end
  return condsOk(h.visibleIf)
end

local function say(line, h)
  local text = tostring(line.text or "")
  if text == "" then return end
  local speaker = (line.speaker == "knight" or not h) and "knight" or "object"
  local timed = (cfg.interaction or {}).textWait == false
  S.dialogue = { text = text, timer = timed and math.max(90, math.min(420, 50 + #text * 3)) or math.huge, target = h, speaker = speaker, effect = line.effect }
end
local function notice(text) S.notice = { text = text, t = 2.5 } end

local function unlockExit(target, text)
  S.unlocked[S.scene] = S.unlocked[S.scene] or {}
  local l = S.unlocked[S.scene]
  for _, e in ipairs(l) do if e.target == target then return end end
  l[#l + 1] = { target = target, text = text }
end

local function startFollow(h)
  if h and not h.isFollowing then h.isFollowing = true h._ref = depth(S.scene, h.x, h.y) end
end

local nextStep, openChoices

local function execActions(list, h)
  for _, act in ipairs(list or {}) do
    local key, t = act.key, act.type
    if t == "give" and key and not hasItem(key) then S.inv[#S.inv + 1] = key notice("+ " .. itemName(key))
    elseif t == "take" then
      for i = #S.inv, 1, -1 do if S.inv[i] == key then table.remove(S.inv, i) end end
      if S.held == key then S.held = nil end
    elseif t == "set" and key then S.flags[key] = true
    elseif t == "clear" and key then S.flags[key] = nil
    elseif t == "hide" then local id = key or (h and h.id) if id then S.vis[id] = false end
    elseif t == "show" and key then S.vis[key] = true
    elseif t == "dignity" then
      S.dignity = S.dignity + (tonumber(act.value) or 0)
      if S.dignity <= 0 then S.gameOver = 3 end
    elseif t == "sound" and key then play(key, false)
    elseif t == "follow" then startFollow(h)
    elseif t == "exit" and key and cfg.spawns[key] then unlockExit(key, act.value or ("To " .. key))
    elseif t == "goto" and key and cfg.spawns[key] then S.seq = nil S.choices = nil setScene(key) return true
    end
  end
  return false
end

local function runSeq(steps) S.seq = { steps = steps, i = 0 } nextStep() end

nextStep = function()
  local s = S.seq
  if not s then return end
  s.i = s.i + 1
  while s.i <= #s.steps do
    local st = s.steps[s.i]
    if st.say then
      say(st.say, st.h)
      if S.dialogue then return end
    elseif st.actions then
      if execActions(st.actions, st.h) or not S.seq then S.seq = nil return end
    elseif st.choices then
      openChoices(st)
      return
    end
    s.i = s.i + 1
  end
  S.seq = nil
end

openChoices = function(step)
  local r = step.choices
  local list = {}
  for j, c in ipairs(r.choices or {}) do
    local k = step.key .. "c" .. j
    if c.text and c.text ~= "" and condsOk(c["if"]) and not (c.once and S.once[k]) then list[#list + 1] = { c = c, k = k } end
  end
  list[#list + 1] = { c = { text = texts().bye, ["end"] = true } }
  S.choices = { list = list, step = step }
end

local function pickChoice(i)
  local ch = S.choices
  if not ch or not ch.list[i] then return end
  local c, k = ch.list[i].c, ch.list[i].k
  S.choices = nil
  if k and c.once then S.once[k] = true end
  local h = ch.step.h
  local steps = { { say = { speaker = "knight", text = c.text }, h = h } }
  for _, l in ipairs(c.lines or {}) do if l.text and l.text ~= "" then steps[#steps + 1] = { say = l, h = h } end end
  if c.actions and #c.actions > 0 then steps[#steps + 1] = { actions = c.actions, h = h } end
  if not c["end"] then steps[#steps + 1] = ch.step end
  runSeq(steps)
end

local function runReaction(h, r, key)
  local steps = {}
  for _, l in ipairs(r.lines or {}) do if l.text and l.text ~= "" then steps[#steps + 1] = { say = l, h = h } end end
  if r.actions and #r.actions > 0 then steps[#steps + 1] = { actions = r.actions, h = h } end
  if r.choices and #r.choices > 0 then steps[#steps + 1] = { choices = r, h = h, key = key } end
  if #steps == 0 then steps[1] = { say = { speaker = "knight", text = "..." }, h = h } end
  runSeq(steps)
end

-- old projects: discovery hotspots, cycling dialogue lines, plain text
local function legacyAct(h)
  local target = h.discoverLevel and cfg.spawns[h.discoverLevel] and h.discoverLevel or nil
  if target and not h._found then
    h._found = true
    if h.discoverHide ~= false then h.isDiscovered = true end
    local acts
    if (h.discoverMode or "unlock") == "unlock" then acts = { { type = "exit", key = target, value = h.discoverText or ("To " .. target) } }
    else acts = { { type = "goto", key = target } } end
    runSeq({ { say = { text = h.discoverMsg or ("I found a way to " .. target .. "!"), speaker = "knight", effect = "peace" }, h = h }, { actions = acts, h = h } })
  elseif target and h.discoverMode == "travel" then
    runSeq({ { actions = { { type = "goto", key = target } }, h = h } })
  elseif h.dialogues and #h.dialogues > 0 then
    h.dialogIndex = h.dialogIndex or 0
    local line = h.dialogues[h.dialogIndex + 1]
    h.dialogIndex = (h.dialogIndex + 1) % #h.dialogues
    runSeq({ { say = line, h = h } })
  elseif h.text and h.text ~= "" and h.text ~= "New" then
    runSeq({ { say = { text = h.text, speaker = "object" }, h = h } })
  else
    return false
  end
  if h.followPlayer then startFollow(h) end
  return true
end

local function doAct(h, verb, item)
  if math.abs(h.x - S.knight.x) > 4 then S.knight.facingRight = h.x > S.knight.x end
  if S.current then B.stopSound(S.current) S.current = nil end
  if h.sound and verb ~= "look" then S.current = play(h.sound, false) end
  if verb == "item" then S.held = nil end
  for i, r in ipairs(h.reactions or {}) do
    if r.verb == verb and (verb ~= "item" or r.item == item) and condsOk(r["if"]) then
      local key = tostring(h.id) .. "#r" .. (i - 1)
      if not (r.once and S.once[key]) then
        if r.once then S.once[key] = true end
        runReaction(h, r, key)
        return
      end
    end
  end
  local T = texts()
  if verb == "item" then runSeq({ { say = { speaker = "knight", text = T.item }, h = h } }) return end
  if legacyAct(h) then return end
  runSeq({ { say = { speaker = "knight", text = T[verb] or T.use }, h = h } })
end

local function goAndDo(h, verb, item)
  S.verbMenu = nil
  local inter = cfg.interaction or {}
  if inter.walkFirst ~= false and not h.noWalk then
    local tx, ty
    if h.walkTo then tx, ty = h.walkTo.x, h.walkTo.y
    else   -- beside the hotspot, on the side the knight comes from
      local hw = (h.w or (h.r and h.r * 2) or 100) / 2
      local hh = (h.h or (h.r and h.r * 2) or 100) / 2
      local side = S.knight.x < h.x and -1 or 1
      tx, ty = h.x + (h.hboxX or 0) + side * (hw + 25), h.y + (h.hboxY or 0) + hh
    end
    local path = N.findPath(navFor(S.scene), S.knight.x, S.knight.y, tx, ty)
    local e = path and path[#path]
    if path and #path > 1 and U.dist(e.x, e.y, S.knight.x, S.knight.y) > 14 then
      S.knight.path, S.knight.state = path, "WALKING"
      S.clickFx = { x = e.x, y = e.y, life = 20 }
      S.pendingAct = { h = h, verb = verb, item = item }
      return
    end
  end
  doAct(h, verb, item)
end

local function simpleVerb(h)
  for _, v in ipairs({ "use", "talk", "look" }) do
    for _, r in ipairs(h.reactions or {}) do if r.verb == v and condsOk(r["if"]) then return v end end
  end
  return h.isCharacter and "talk" or "use"
end

local function interact(h)
  if S.held then goAndDo(h, "item", S.held) return end
  if ((cfg.interaction or {}).mode or "verbs") == "verbs" then
    S.verbMenu = { h = h, x = h.x + (h.hboxX or 0), y = h.y + (h.hboxY or 0) }
    return
  end
  goAndDo(h, simpleVerb(h))
end

local function tapItem(id)
  if S.seq then return end
  if not S.held then S.held = id return end
  if S.held == id then
    S.held = nil
    local it = cfg.items[id] or {}
    runSeq({ { say = { speaker = "knight", text = it.desc or itemName(id) } } })
    return
  end
  local x = S.held
  S.held = nil
  for _, c in ipairs(cfg.combos or {}) do
    if (c.a == x and c.b == id) or (c.a == id and c.b == x) then
      local acts = {}
      if c.consume ~= false then acts[#acts + 1] = { type = "take", key = c.a } acts[#acts + 1] = { type = "take", key = c.b } end
      if c.result then acts[#acts + 1] = { type = "give", key = c.result } end
      local steps = {}
      if c.text and c.text ~= "" then steps[#steps + 1] = { say = { speaker = "knight", text = c.text } } end
      steps[#steps + 1] = { actions = acts }
      runSeq(steps)
      return
    end
  end
  runSeq({ { say = { speaker = "knight", text = texts().combine } } })
end

-- ---- adventure UI layout (inventory bar, verb menu, conversation choices)
local function invRects()
  local out = {}
  if not S.inv or #S.inv == 0 or S.invClosed then return out end
  local size, gap = 58, 6
  local x0 = (ui.panelOpen and not ui.debug) and (PANEL_W + 34) or 34
  for i, id in ipairs(S.inv) do out[i] = { id = id, x = x0 + (i - 1) * (size + gap), y = VH - size - 10, w = size, h = size } end
  return out
end
-- small tab that opens / closes the inventory bar
local function invTabRect()
  if not S.inv or #S.inv == 0 then return nil end
  local r = invRects()
  if #r > 0 then local l = r[#r] return { x = l.x + l.w + 10, y = l.y + 14, w = 24, h = 30, open = true } end
  local x0 = (ui.panelOpen and not ui.debug) and (PANEL_W + 34) or 34
  return { x = x0 - 6, y = VH - 58, w = 64, h = 48, open = false }
end
local function verbRects()
  local m = S.verbMenu
  if not m then return {} end
  local w, h, gap = 76, 38, 6
  local total = #VERBS * w + (#VERBS - 1) * gap
  local x = U.clamp(U.round(m.x - total / 2), 6, VW - total - 6)
  local y = U.clamp(U.round(m.y - 90), 6, VH - 120)
  local out = {}
  for i, v in ipairs(VERBS) do out[i] = { v = v[1], label = v[2], x = x + (i - 1) * (w + gap), y = y, w = w, h = h } end
  return out
end
local function choiceRects()
  local ch = S.choices
  if not ch then return {} end
  local rowH, w = 34, 700
  local x = (ui.panelOpen and not ui.debug) and (PANEL_W + (VW - PANEL_W - w) / 2) or (VW - w) / 2
  local y0 = VH - 84 - #ch.list * rowH
  local out = {}
  for i, o in ipairs(ch.list) do out[i] = { i = i, text = o.c.text, x = x, y = y0 + (i - 1) * rowH, w = w, h = rowH - 4 } end
  return out
end
local function inside(r, x, y) return x >= r.x and x <= r.x + r.w and y >= r.y and y <= r.y + r.h end

local function advTapUI(x, y)
  if S.choices then
    for _, r in ipairs(choiceRects()) do if inside(r, x, y) then pickChoice(r.i) end end
    return true
  end
  if S.verbMenu then
    local h = S.verbMenu.h
    for _, r in ipairs(verbRects()) do
      if inside(r, x, y) then S.verbMenu = nil goAndDo(h, r.v) return true end
    end
    S.verbMenu = nil
  end
  local tab = invTabRect()
  if tab and inside(tab, x, y) and not S.seq then S.invClosed = not S.invClosed return true end
  for _, r in ipairs(invRects()) do if inside(r, x, y) then tapItem(r.id) return true end end
  if S.seq or S.dialogue then if S.dialogue then S.dialogue.timer = 0 end return true end   -- tap = next line
  return false
end

local function drawAdvUI()
  local inv = invRects()
  if #inv > 0 then
    local last = inv[#inv]
    B.rect("fill", inv[1].x - 6, inv[1].y - 6, last.x + last.w - inv[1].x + 12, last.h + 12, 30, 20, 10, 185)
    for _, r in ipairs(inv) do
      local held = S.held == r.id
      if held then B.rect("fill", r.x, r.y, r.w, r.h, 255, 215, 0, 115) else B.rect("fill", r.x, r.y, r.w, r.h, 230, 201, 168, 217) end
      if held then B.rect("line", r.x, r.y, r.w, r.h, 255, 215, 0, 255, 2) else B.rect("line", r.x, r.y, r.w, r.h, 110, 80, 50, 255, 2) end
      local it = cfg.items[r.id] or {}
      local e = it.icon and getImage(it.icon)
      if e then
        local s = math.min((r.w - 8) / e.aw, (r.h - 8) / e.ah)
        local w, h = e.aw * s, e.ah * s
        drawFull(it.icon, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h)
      else
        textC(itemName(r.id):sub(1, 8), r.x + r.w / 2, r.y + r.h / 2 - 6, 10, C.brown)
      end
    end
  end
  local tab = invTabRect()
  if tab then
    if tab.open then
      B.rect("fill", tab.x, tab.y, tab.w, tab.h, 68, 68, 68, 230)
      B.rect("line", tab.x, tab.y, tab.w, tab.h, 119, 119, 119, 255, 2)
      textC("<", tab.x + tab.w / 2, tab.y + 7, 14, C.white)
    else
      B.rect("fill", tab.x, tab.y, tab.w, tab.h, C.darkred[1], C.darkred[2], C.darkred[3], 255)
      B.rect("line", tab.x, tab.y, tab.w, tab.h, C.gold[1], C.gold[2], C.gold[3], 255, 2)
      textC("ITEMS", tab.x + tab.w / 2, tab.y + 6, 12, C.gold)
      textC("> " .. #S.inv, tab.x + tab.w / 2, tab.y + 25, 14, C.gold)
    end
  end
  if S.held then
    local label = "Use " .. itemName(S.held) .. " with ..."
    local y = (#inv > 0) and (inv[1].y - 34) or (VH - 36)
    local x = (#inv > 0) and inv[1].x - 6 or 34
    B.rect("fill", x, y, textW(label, 13) + 16, 22, 0, 0, 0, 180)
    B.text(label, x + 8, y + 4, 13, C.gold[1], C.gold[2], C.gold[3], 255)
    local it = cfg.items[S.held] or {}
    local e = it.icon and getImage(it.icon)
    if e and ui.mx > 0 then drawFull(it.icon, ui.mx + 10, ui.my + 10, 36, 36 * e.ah / e.aw, false, 0.85) end
  end
  local vr = verbRects()
  if #vr > 0 then
    local n = S.verbMenu.h.name
    if n and n ~= "" then
      local w = textW(n, 13) + 14
      B.rect("fill", S.verbMenu.x - w / 2, vr[1].y - 24, w, 20, 0, 0, 0, 180)
      textC(n, S.verbMenu.x, vr[1].y - 21, 13, C.white)
    end
    for _, r in ipairs(vr) do
      B.rect("fill", r.x, r.y, r.w, r.h, C.darkred[1], C.darkred[2], C.darkred[3], 255)
      B.rect("line", r.x + 1, r.y + 1, r.w - 2, r.h - 2, C.gold[1], C.gold[2], C.gold[3], 255, 2)
      textC(r.label, r.x + r.w / 2, r.y + 11, 15, C.gold)
    end
  end
  local cr = choiceRects()
  if #cr > 0 then
    B.rect("fill", cr[1].x - 8, cr[1].y - 8, cr[1].w + 16, #cr * 34 + 12, 20, 12, 6, 217)
    for _, r in ipairs(cr) do
      local hover = inside(r, ui.mx, ui.my)
      local col = hover and C.gold or { 240, 220, 192, 255 }
      B.text("> " .. r.text, r.x + 8, r.y + 7, 15, col[1], col[2], col[3], 255)
    end
  end
  if S.notice then
    local w = textW(S.notice.text, 18) + 30
    local a = math.min(1, S.notice.t / 0.5)
    B.rect("fill", VW / 2 - w / 2 + 120, 16, w, 34, 0, 0, 0, math.floor(190 * a))
    textC(S.notice.text, VW / 2 + 120, 23, 18, C.gold, math.floor(255 * a))
  end
end

-- ---- save games (save_auto.lua, save_1.lua ... in the save folder)
local function saveState()
  local dialogIdx, found, followers = {}, {}, {}
  local function scan(h)
    if h.dialogIndex and h.dialogIndex > 0 then dialogIdx[h.id] = h.dialogIndex end
    if h.isDiscovered then found[h.id] = "hidden" elseif h._found then found[h.id] = true end
    if h.isFollowing then followers[#followers + 1] = h.id end
  end
  for _, list in pairs(S.hotspots) do for _, h in ipairs(list) do scan(h) end end
  for _, h in ipairs(S.followers) do scan(h) end
  return { v = 1, time = os.time(), scene = S.scene, x = U.round(S.knight.x), y = U.round(S.knight.y), dignity = S.dignity,
           inv = S.inv, flags = S.flags, vis = S.vis, once = S.once, unlocked = S.unlocked,
           dialogIdx = dialogIdx, found = found, followers = followers }
end
local function saveGame(slot)
  local ok = B.writeSave("save_" .. slot .. ".lua", U.serialize(saveState()))
  if slot ~= "auto" then notice(ok and "Game saved" or "Saving failed") end
  return ok
end
local function readSave(slot)
  local src = B.readSave("save_" .. slot .. ".lua")
  return src and U.loadTable(src) or nil
end
local SLOTS = { "auto", "1", "2", "3" }
local function latestSave()
  local best, bt = nil, -1
  for _, s in ipairs(SLOTS) do local d = readSave(s) if d and (d.time or 0) > bt then best, bt = s, d.time or 0 end end
  return best
end

local function refreshSaves()
  saveCache = {}
  for _, slot in ipairs(SLOTS) do saveCache[slot] = readSave(slot) or false end
end
autosave = function() saveGame("auto") saveCache = nil end

local function loadGame(slot)
  local d = readSave(slot)
  if not d or not cfg.spawns[d.scene] then return false end
  G.startGame(true)
  S.inv, S.flags, S.vis, S.once = d.inv or {}, d.flags or {}, d.vis or {}, d.once or {}
  S.unlocked = d.unlocked or {}
  S.dignity = d.dignity or S.dignity
  for _, list in pairs(S.hotspots) do
    for _, h in ipairs(list) do
      if d.dialogIdx and d.dialogIdx[h.id] then h.dialogIndex = d.dialogIdx[h.id] end
      local f = d.found and d.found[h.id]
      if f then h._found = true if f == "hidden" then h.isDiscovered = true end end
    end
  end
  for _, id in ipairs(d.followers or {}) do   -- followers come along into the saved level
    for scn, list in pairs(S.hotspots) do
      for i = #list, 1, -1 do
        if list[i].id == id then local h = table.remove(list, i) h._ref = depth(scn, h.x, h.y) h.isFollowing = true S.followers[#S.followers + 1] = h end
      end
    end
  end
  setScene(d.scene, true)
  S.knight.x, S.knight.y = d.x or S.knight.x, d.y or S.knight.y
  notice("Game loaded")
  return true
end
G.saveGame, G.loadGame = saveGame, loadGame
G.adv = { verbRects = verbRects, choiceRects = choiceRects, invRects = invRects }   -- for tests / tools

-- ---------------------------------------------------------------- init
function G.init(backend)
  B = backend
  local src = B.readSave("config_edit.lua")
  local loaded, err
  if src then loaded = U.loadTable(src, "config_edit") end
  if not loaded then
    loaded, err = U.loadTable(B.readFile("game/config.lua"), "config")
  end
  cfg = defaults(loaded or {})
  if not loaded then toast("config.lua missing/broken: " .. tostring(err)) end
  G.cfg = cfg
  FONT = 13
  local st = B.readSave("settings.lua")
  local sv = st and U.loadTable(st)
  settings.music = cfg.volumes.music or 0.5
  settings.sfx = cfg.volumes.sfx or 0.5
  settings.amb = cfg.volumes.amb or 0.5
  if sv then for k, v in pairs(sv) do settings[k] = v end end
  if B.setFont then B.setFont(cfg.ui.font) end
  ui.cursor = B.showCursor or false
  toTitle()
end

-- ---------------------------------------------------------------- update
local function updateKnight(dt)
  local k = S.knight
  local p = cfg.player
  if p and p.customImage then   -- own player sprite: editor size at the spawn point, then depth like the knight
    local sp = cfg.spawns[S.scene] or k
    k.scale = (p.scale or 1) * depth(S.scene, k.x, k.y) / depth(S.scene, sp.x, sp.y)
  else
    k.scale = depth(S.scene, k.x, k.y) * (cfg.knight.baseScale or 0.55)
  end
  if k.state == "WALKING" and #k.path > 0 then
    local walk = cfg.knight.speed or 6
    local speed = (k.running and (cfg.knight.runSpeed or walk * 1.8) or walk) * 60 * dt
    local remaining = speed
    while remaining > 0 and #k.path > 0 do
      local t = k.path[1]
      local dx, dy = t.x - k.x, t.y - k.y
      local d = math.sqrt(dx * dx + dy * dy)
      if math.abs(dx) > 1 then k.facingRight = dx > 0 end
      if d > 0.5 then k.dir = moveDir(dx, dy, k.dir) end
      if d <= remaining then
        k.x, k.y = t.x, t.y
        remaining = remaining - d
        table.remove(k.path, 1)
      else
        k.x, k.y = k.x + dx / d * remaining, k.y + dy / d * remaining
        remaining = 0
      end
    end
    if #k.path == 0 then
      k.state = "IDLE"
      k.running = false
      if S.pendingAct then local p = S.pendingAct S.pendingAct = nil doAct(p.h, p.verb, p.item) end
      if S.pendingTravel then local t = S.pendingTravel S.pendingTravel = nil setScene(t) end
    end
  end
  if S.travelTimer then
    S.travelTimer = S.travelTimer - dt
    if S.travelTimer <= 0 then S.travelTimer = nil if S.pendingTravel then local t = S.pendingTravel S.pendingTravel = nil setScene(t) end end
  end
end

function G.update(dt)
  if dt > 0.1 then dt = 0.1 end
  if ui.toast then ui.toast.t = ui.toast.t - dt if ui.toast.t <= 0 then ui.toast = nil end end
  if not S then return end
  S.frame = S.frame + dt * 60
  if S.mode ~= "play" then return end
  if S.gameOver then
    S.gameOver = S.gameOver - dt
    if S.gameOver <= 0 then toTitle() end
    return
  end
  updateKnight(dt)
  local d = S.dialogue
  if d then d.timer = d.timer - dt * 60 if d.timer <= 0 then S.dialogue = nil end end
  if S.notice then S.notice.t = S.notice.t - dt if S.notice.t <= 0 then S.notice = nil end end
  if ui.press and B.time() - ui.press.t > 0.8 then ui.press = nil ui.debug = true ui.panelOpen = true toast("Editor") end
  if S.seq and not S.choices and not S.dialogue then nextStep() end
  -- followers
  local list = S.hotspots[S.scene]
  if list and S.dialogue then for _, h in ipairs(list) do h._moving = false end end
  if list and not S.dialogue then
    local f = 1 - (0.95 ^ (dt * 60))
    for _, h in ipairs(list) do
      if h.isFollowing then
        local dx, dy = S.knight.x - h.x, S.knight.y - h.y
        h._moving = math.sqrt(dx * dx + dy * dy) > 80
        if h._moving then
          local ff = S.knight.running and math.min(1, f * 1.6) or f
          h.x, h.y = h.x + dx * ff, h.y + dy * ff
          h.mirrored = dx < 0
          h._dir = moveDir(dx, dy, h._dir)
        end
      end
    end
  end
  if S.clickFx then
    S.clickFx.life = S.clickFx.life - dt * 60
    if S.clickFx.life <= 0 then S.clickFx = nil end
  end
end

-- ---------------------------------------------------------------- UI buttons
local function button(id, label, x, y, w, h, fn, style)
  ui.buttons[#ui.buttons + 1] = { id = id, label = label, x = x, y = y, w = w, h = h, fn = fn, style = style or "normal" }
end

local function drawButtons()
  for _, b in ipairs(ui.buttons) do
    local hover = ui.mx >= b.x and ui.mx <= b.x + b.w and ui.my >= b.y and ui.my <= b.y + b.h
    if b.style == "debug" or b.style == "debugOn" then
      local c = b.style == "debugOn" and { 170, 0, 0, 255 } or { 0, 128, 0, 255 }
      if hover then c = { math.min(255, c[1] + 40), math.min(255, c[2] + 40), c[3], 255 } end
      B.rect("fill", b.x, b.y, b.w, b.h, rgba(c))
      B.rect("line", b.x, b.y, b.w, b.h, 0, 255, 0, 255, 1)
      textC(b.label, b.x + b.w / 2, b.y + (b.h - 12) / 2, 11, C.white)
    elseif b.style == "tab" then
      B.rect("fill", b.x, b.y, b.w, b.h, 68, 68, 68, 230)
      B.rect("line", b.x, b.y, b.w, b.h, 119, 119, 119, 255, 1)
      textC(b.label, b.x + b.w / 2, b.y + (b.h - 14) / 2, 14, C.white)
    else
      local big = b.style == "big"
      B.rect("fill", b.x, b.y, b.w, b.h, rgba(C.darkred, hover and 255 or 235))
      B.rect("line", b.x + 1, b.y + 1, b.w - 2, b.h - 2, C.gold[1], C.gold[2], C.gold[3], C.gold[4], big and 5 or 2)
      local size = big and 30 or 13
      textC(b.label, b.x + b.w / 2, b.y + (b.h - size) / 2 - 1, size, C.gold)
    end
  end
end

local function buildTitleButtons()
  local ts = cfg.titleScreen
  button("start", ts.startButtonText, VW / 2 - 200, 352, 400, 76, function() G.startGame() end, "big")
  if not saveCache then refreshSaves() end
  local any = false
  for _, slot in ipairs(SLOTS) do if saveCache[slot] then any = true end end
  if any then
    button("cont", "Continue", VW / 2 - 200, 438, 195, 40, function() local l = latestSave() if l then loadGame(l) end end)
    button("loadt", "Load Game", VW / 2 + 5, 438, 195, 40, function() ui.slotMenu = "load" end)
  end
  if B.toggleFullscreen then
    button("fs", "Fullscreen", VW / 2 - 100, 490, 200, 36, function() B.toggleFullscreen() end)
  end
end

local function buildSlotButtons()
  if not saveCache then refreshSaves() end
  local mode = ui.slotMenu
  local y = 150
  for _, slot in ipairs(SLOTS) do
    local d = saveCache[slot]
    if (mode == "load" and d) or (mode == "save" and slot ~= "auto") then
      local name = slot == "auto" and "Autosave" or ("Slot " .. slot)
      local label = d and (name .. ":  " .. d.scene .. "  " .. os.date("%d.%m. %H:%M", d.time or 0)) or (name .. ":  (empty)")
      button("slot" .. slot, label, VW / 2 - 230, y, 460, 44, function()
        ui.slotMenu = nil
        if mode == "save" then saveGame(slot) saveCache = nil else loadGame(slot) end
      end)
      y = y + 54
    end
  end
  button("slotx", "Cancel", VW / 2 - 100, y + 10, 200, 40, function() ui.slotMenu = nil end)
end

local function cycleScene(dir)
  local order = cfg.sceneOrder
  local idx = 1
  for i, n in ipairs(order) do if n == S.scene then idx = i end end
  idx = (idx - 1 + dir) % #order + 1
  setScene(order[idx])
end

local function saveEdits()
  local ok = B.writeSave("config_edit.lua", U.serialize(cfg))
  toast(ok and "Saved (config_edit.lua)" or "Saving failed")
end

-- 0..max: hotspots that only appear when the pointer or the knight comes near
local function nearAlpha(h, max)
  if ui.debug then return 1 end
  local hx, hy = h.x + (h.hboxX or 0), h.y + (h.hboxY or 0)
  local d = math.min(U.dist(hx, hy, ui.mx, ui.my), U.dist(hx, hy, S.knight.x, S.knight.y) * 1.3)
  return math.max(0, math.min(max, max * (1 - (d - 60) / 140)))
end
local function fadesWhenFar(h)
  if h.nearFade ~= nil then return h.nearFade end
  return not h.isCharacter
end

-- ---------------------------------------------------------------- on-device editor (hidden debug mode)
-- open: long-press the Dignity box (or F2 / SELECT). Edits are saved to config_edit.lua in the save folder.
ui.ed = { mode = "select", sel = nil, pick = 1, delArm = nil }

local function setP(h, k, v)   -- change a hotspot property in the running game and in the config
  h[k] = v
  if h._src then h._src[k] = v end
end
local function newId() return "h_" .. tostring(math.floor(B.time() * 1000) % 100000000) .. tostring(math.random(100, 999)) end
local function addToScene(data)
  cfg.hotspots[S.scene] = cfg.hotspots[S.scene] or {}
  table.insert(cfg.hotspots[S.scene], data)
  local c = U.deepcopy(data)
  c._src = data
  S.hotspots[S.scene] = S.hotspots[S.scene] or {}
  table.insert(S.hotspots[S.scene], c)
  return c
end
local function removeFromScene(h)
  local list = S.hotspots[S.scene] or {}
  for i = #list, 1, -1 do if list[i] == h then table.remove(list, i) end end
  local cl = cfg.hotspots[S.scene] or {}
  for i = #cl, 1, -1 do if cl[i] == h._src or cl[i].id == h.id then table.remove(cl, i) end end
end
local function itemIds()
  local ids = {}
  for id in pairs(cfg.items or {}) do ids[#ids + 1] = id end
  table.sort(ids)
  return ids
end
local function walkPoint(h)
  if h.walkTo then return h.walkTo.x, h.walkTo.y end
  local hw = (h.w or (h.r and h.r * 2) or 100) / 2
  local hh = (h.h or (h.r and h.r * 2) or 100) / 2
  return U.round(h.x + (h.hboxX or 0) - hw - 25), U.round(h.y + (h.hboxY or 0) + hh)
end

-- text entry (LÖVE: keyboard / Android keyboard, Vita: system keyboard)
local function editText(title, text, cb)
  ui.textEdit = { title = title, text = text or "", cb = cb }
  if B.startText then B.startText(title, text or "") end
end
local function finishText(ok)
  local t = ui.textEdit
  ui.textEdit = nil
  if B.stopText then B.stopText() end
  if t and ok then t.cb(t.text) end
end
function G.textinput(s) if ui.textEdit then ui.textEdit.text = ui.textEdit.text .. s end end
function G.textResult(s)   -- Vita keyboard finished (nil = cancelled)
  if not ui.textEdit then return end
  if s then ui.textEdit.text = s finishText(true) else finishText(false) end
end

local function placeHotspot(x, y)
  local h = addToScene({ id = newId(), name = "New", x = U.round(x), y = U.round(y), r = 50, w = 100, h = 100,
    tx = U.round(x), ty = U.round(math.max(20, y - 120)), anchor = "object" })
  ui.ed.sel, ui.ed.mode = h, "select"
  toast("Hotspot placed")
end
local function placePickup(x, y)
  local ids = itemIds()
  local id = ids[ui.ed.pick]
  if not id then toast("No items in this project") return end
  local it = cfg.items[id]
  local data = { id = newId(), name = it.name or id, x = U.round(x), y = U.round(y), tx = U.round(x), ty = U.round(math.max(20, y - 90)),
    w = 70, h = 70, r = 35, shape = "circle", hboxY = -30, anchor = "object", isCharacter = false, nearFade = false,
    reactions = {
      { verb = "use", lines = { { speaker = "knight", text = "Got it: " .. (it.name or id) .. "." } }, actions = { { type = "give", key = id }, { type = "hide" } } },
      { verb = "look", lines = { { speaker = "knight", text = it.desc or ("A " .. (it.name or id) .. ".") } } },
    } }
  if it.icon then
    local aw, ah = authoredSize(it.icon)
    data.customImage, data.cols, data.rows, data.frameWidth, data.frameHeight, data.totalFrames = it.icon, 1, 1, aw, ah, 1
    data.scale = math.floor(56 / math.max(aw, ah) * 1000) / 1000
  end
  ui.ed.sel = addToScene(data)
  ui.ed.mode = "select"
  toast((it.name or id) .. " placed")
end

local function buildEditorButtons()
  local ed = ui.ed
  local x, w = 10, PANEL_W - 20
  local y = 46
  local half = (w - 6) / 2
  local function row(id, label, fn, on, bx, bw)
    button(id, label, bx or x, y, bw or w, 28, fn, on and "debugOn" or "debug")
  end
  local function nextRow() y = y + 33 end
  if ed.sel and ed.mode == "select" then   -- ---- object page
    local h = ed.sel
    row("back", "< BACK", function() ed.sel = nil end) nextRow()
    row("name", "Name: " .. (h.name or "?"), function() editText("Name", h.name, function(t) setP(h, "name", t) end) end) nextRow()
    local function stepper(id, label, value, minus, plus)
      button(id .. "-", "-", x, y, 40, 28, minus, "debug")
      button(id .. "+", "+", x + w - 40, y, 40, 28, plus, "debug")
      ui.labels[#ui.labels + 1] = { text = label .. ": " .. value, x = x + w / 2, y = y + 7, col = C.green }
      nextRow()
    end
    local hw, hh = h.w or (h.r and h.r * 2) or 100, h.h or (h.r and h.r * 2) or 100
    stepper("hbw", "Hitbox W", U.round(hw), function() setP(h, "w", math.max(10, hw - 10)) setP(h, "r", h.w / 2) end,
      function() setP(h, "w", hw + 10) setP(h, "r", h.w / 2) end)
    stepper("hbh", "Hitbox H", U.round(hh), function() setP(h, "h", math.max(10, hh - 10)) end, function() setP(h, "h", hh + 10) end)
    row("shape", h.shape == "rect" and "Shape: SQUARE" or "Shape: CIRCLE", function() setP(h, "shape", h.shape == "rect" and "circle" or "rect") end) nextRow()
    if h.customImage then
      stepper("scl", "Image scale", string.format("%.2f", h.scale or 1), function() setP(h, "scale", math.max(0.02, (h.scale or 1) / 1.1)) end,
        function() setP(h, "scale", (h.scale or 1) * 1.1) end)
    end
    local nf = fadesWhenFar(h)
    row("near", nf and "Visible only when near: ON" or "Visible only when near: OFF", function() setP(h, "nearFade", not nf) end, nf) nextRow()
    row("hid", h.startHidden and "Starts hidden: ON" or "Starts hidden: OFF", function() setP(h, "startHidden", not h.startHidden or nil) end, h.startHidden) nextRow()
    row("walk", h.noWalk and "Walk there first: OFF" or "Walk there first: ON", function() setP(h, "noWalk", not h.noWalk or nil) end, not h.noWalk) nextRow()
    row("mir", h.mirrored and "Mirror: ON" or "Mirror: OFF", function() setP(h, "mirrored", not h.mirrored) end, h.mirrored) nextRow()
    row("del", "DELETE OBJECT", function() removeFromScene(h) ed.sel = nil toast("Deleted") end, true)
    return
  end
  -- ---- scene page
  row("prev", "< LEVEL", function() cycleScene(-1) ed.sel = nil end, false, x, half)
  row("next", "LEVEL >", function() cycleScene(1) ed.sel = nil end, false, x + half + 6, half) nextRow()
  local modes = { { "select", "SELECT / EDIT" }, { "move", "MOVE (drag)" }, { "addHotspot", "+ HOTSPOT (tap level)" },
    { "addPickup", "+ ITEM PICKUP (tap level)" }, { "delete", "DELETE (tap twice)" } }
  for _, m in ipairs(modes) do
    row("m_" .. m[1], m[2], function() ed.mode = m[1] ed.delArm = nil end, ed.mode == m[1]) nextRow()
  end
  if ed.mode == "addPickup" then
    local ids = itemIds()
    if #ids == 0 then ui.labels[#ui.labels + 1] = { text = "(no items in project)", x = x + w / 2, y = y + 7, col = C.green }
    else
      ed.pick = U.clamp(ed.pick, 1, #ids)
      button("pk-", "<", x, y, 40, 28, function() ed.pick = (ed.pick - 2) % #ids + 1 end, "debug")
      button("pk+", ">", x + w - 40, y, 40, 28, function() ed.pick = ed.pick % #ids + 1 end, "debug")
      ui.labels[#ui.labels + 1] = { text = (cfg.items[ids[ed.pick]].name or ids[ed.pick]), x = x + w / 2, y = y + 7, col = C.gold }
    end
    nextRow()
  end
  row("grid", ui.showGrid and "GRID: ON" or "GRID: OFF", function() ui.showGrid = not ui.showGrid end, ui.showGrid, x, half)
  row("dig+", "DIGNITY +1", function() S.dignity = S.dignity + 1 end, false, x + half + 6, half) nextRow()
  row("save", "SAVE EDITS", saveEdits, false, x, half)
  row("reset", "RESET EDITS", function()
    B.deleteSave("config_edit.lua")
    toast("Edits removed - restart loads game/config.lua")
  end, true, x + half + 6, half) nextRow()
  row("close", "CLOSE EDITOR", function() ui.debug = false ed.sel = nil end) nextRow()
  ui.labels[#ui.labels + 1] = { text = "Reactions & dialogues: web editor", x = x + w / 2, y = VH - 22, col = C.green, size = 11 }
end

local function editorPress(x, y)
  local ed = ui.ed
  local list = S.hotspots[S.scene] or {}
  local function hitAt()
    for i = #list, 1, -1 do if hotspotHit(list[i], x, y) then return list[i] end end
  end
  if ed.mode == "addHotspot" then placeHotspot(x, y) return end
  if ed.mode == "addPickup" then placePickup(x, y) return end
  if ed.mode == "select" then ed.sel = hitAt() return end
  if ed.mode == "delete" then
    local h = hitAt()
    if not h then return end
    if ed.delArm and ed.delArm.h == h and B.time() - ed.delArm.t < 2 then removeFromScene(h) ed.delArm = nil toast("Deleted")
    else ed.delArm = { h = h, t = B.time() } toast("Tap again to delete " .. (h.name or "it")) end
    return
  end
  -- move
  local grab = B.platform == "love-desktop" and 1 or 1.8
  local sp = cfg.spawns[S.scene]
  if sp and U.dist(sp.x, sp.y, x, y) < 30 * grab then ui.dragging = { kind = "spawn", ox = sp.x - x, oy = sp.y - y } return end
  for _, h in ipairs(list) do
    local wx, wy = walkPoint(h)
    if not h.noWalk and U.dist(wx, wy, x, y) < 14 * grab then ui.dragging = { kind = "walk", h = h, ox = wx - x, oy = wy - y } return end
  end
  for _, h in ipairs(list) do
    if h.tx and U.dist(h.tx, h.ty, x, y) < 20 * grab then ui.dragging = { kind = "text", h = h, ox = h.tx - x, oy = h.ty - y } return end
  end
  local h = hitAt()
  if h then ui.dragging = { kind = "hotspot", h = h, ox = h.x - x, oy = h.y - y } end
end

local function editorMove(x, y)
  local d = ui.dragging
  if not d then return end
  local mx, my = U.round(x + (d.ox or 0)), U.round(y + (d.oy or 0))
  if d.kind == "spawn" then
    local sp = cfg.spawns[S.scene]
    sp.x, sp.y = mx, my
  elseif d.kind == "text" then
    setP(d.h, "tx", mx) setP(d.h, "ty", my)
  elseif d.kind == "walk" then
    setP(d.h, "walkTo", { x = mx, y = my })
  elseif d.kind == "hotspot" then
    local h = d.h
    local dx, dy = mx - h.x, my - h.y
    setP(h, "x", mx) setP(h, "y", my)
    if h.tx then setP(h, "tx", h.tx + dx) setP(h, "ty", h.ty + dy) end
    if h.walkTo then setP(h, "walkTo", { x = h.walkTo.x + dx, y = h.walkTo.y + dy }) end
  end
end

local function drawEditorWorld()
  local list = S.hotspots[S.scene] or {}
  if ui.showGrid then
    local g = navFor(S.scene)
    for gy = 1, N.ROWS do
      for gx = 1, N.COLS do
        if g[gy][gx] then B.rect("fill", (gx - 1) * N.CELL, (gy - 1) * N.CELL, N.CELL - 1, N.CELL - 1, 255, 0, 255, 70) end
      end
    end
  end
  for _, h in ipairs(list) do
    local cx, cy = h.x + (h.hboxX or 0), h.y + (h.hboxY or 0)
    local w = h.w or ((h.r and h.r * 2) or 120)
    local hh = h.h or ((h.r and h.r * 2) or 120)
    local col = (ui.ed.sel == h) and C.yellow or (ui.ed.mode == "delete" and C.red or C.cyan)
    local lw = (ui.ed.sel == h) and 4 or 2
    if h.shape == "rect" then B.rect("line", cx - w / 2, cy - hh / 2, w, hh, col[1], col[2], col[3], col[4], lw)
    else B.circle("line", cx, cy, w / 2, col[1], col[2], col[3], col[4], lw) end
    if ui.ed.mode == "move" then
      if h.tx then
        B.circle("line", h.tx, h.ty, 10, C.yellow[1], C.yellow[2], C.yellow[3], 255, 2)
        textC("TEXT", h.tx, h.ty - 28, 11, C.white)
      end
      if not h.noWalk then
        local wx, wy = walkPoint(h)
        B.circle("fill", wx, wy, 8, 60, 255, 60, h.walkTo and 255 or 130)
      end
    end
    textC(h.name or "Hotspot", h.x, h.y - w / 2 - 18, 12, C.white)
  end
  local sp = cfg.spawns[S.scene]
  if sp then B.circle("line", sp.x, sp.y, 20, C.cyan[1], C.cyan[2], C.cyan[3], 255, 2) textC("SPAWN", sp.x, sp.y - 36, 11, C.cyan) end
  B.text("EDITOR  Level: " .. S.scene .. "  Mode: " .. ui.ed.mode, PANEL_W + 34, 8, 13, C.green[1], C.green[2], C.green[3], 255)
end

local function drawTextEdit()
  local t = ui.textEdit
  if not t then return end
  B.rect("fill", 0, 0, VW, VH, 0, 0, 0, 200)
  B.rect("fill", VW / 2 - 260, 150, 520, 150, 26, 26, 26, 255)
  B.rect("line", VW / 2 - 260, 150, 520, 150, 0, 255, 0, 255, 2)
  textC(t.title, VW / 2, 164, 16, C.green)
  local caret = (math.floor(B.time() * 2) % 2 == 0) and "_" or " "
  B.rect("fill", VW / 2 - 240, 196, 480, 34, 0, 0, 0, 255)
  B.text(t.text .. caret, VW / 2 - 232, 204, 16, 255, 255, 255, 255)
end

local function buildPlayButtons()
  local x, w = 10, PANEL_W - 20
  local y = 112
  local function add(id, label, fn, style)
    button(id, label, x, y, w, 34, fn, style)
    y = y + 40
  end
  if ui.debug then buildEditorButtons() return end
  local shown = {}
  for _, ex in ipairs(cfg.exits[S.scene] or {}) do
    shown[ex.target] = true
    add("exit_" .. ex.target, ex.text or ("To " .. ex.target), function() setScene(ex.target) end)
  end
  for _, ex in ipairs(S.unlocked[S.scene] or {}) do   -- found through discovery hotspots
    if not shown[ex.target] then
      add("exit_" .. ex.target, ex.text, function() setScene(ex.target) end)
    end
  end
  local l = cfg.levelLicks[S.scene] or cfg.lickConfig
  add("lick", l.text or "Lick", function()
    if S.seq then return end
    runSeq({ { say = { speaker = "knight", text = l.response or "" } }, { actions = { { type = "dignity", value = l.dignityChange or 0 } } } })
  end)
  add("mute", settings.muted and "UNMUTE" or "MUTE", function()
    settings.muted = not settings.muted applyVolumes() saveSettings()
  end)
  -- volume steppers
  local function stepper(id, label, key)
    button(id .. "-", "-", x, y, 34, 30, function()
      settings[key] = math.max(0, settings[key] - 0.1) applyVolumes() saveSettings() end)
    button(id .. "+", "+", x + w - 34, y, 34, 30, function()
      settings[key] = math.min(1, settings[key] + 0.1) applyVolumes() saveSettings() end)
    ui.labels[#ui.labels + 1] = { text = label .. " " .. U.round(settings[key] * 100) .. "%", x = x + w / 2, y = y + 8 }
    y = y + 36
  end
  button("saveg", "Save", x, y, w / 2 - 4, 34, function() ui.slotMenu = "save" end)
  button("loadg", "Load", x + w / 2 + 4, y, w / 2 - 4, 34, function() ui.slotMenu = "load" end)
  y = y + 40
  stepper("mus", "Music", "music")
  stepper("sfx", "SFX", "sfx")
  if B.toggleFullscreen then add("fs", "Fullscreen", function() B.toggleFullscreen() end) end
  add("title", "Title Screen", toTitle)
end

local function rebuildButtons()
  ui.buttons, ui.labels = {}, {}
  if not S then return end
  if ui.textEdit then
    button("txok", "OK", VW / 2 - 210, 246, 200, 40, function() finishText(true) end)
    button("txno", "Cancel", VW / 2 + 10, 246, 200, 40, function() finishText(false) end)
    return
  end
  if ui.slotMenu then buildSlotButtons() return end
  if S.mode == "title" then
    buildTitleButtons()
    if cfg.allowDebug and B.platform ~= "vita" then
      -- (title debug button of the web version) - only meaningful in play mode here
    end
    return
  end
  if S.gameOver then return end
  if ui.panelOpen then
    buildPlayButtons()
    button("tab", "<", PANEL_W, VH / 2 - 30, 24, 60, function() ui.panelOpen = false end, "tab")
  else
    button("tab", ">", 0, VH / 2 - 30, 24, 60, function() ui.panelOpen = true end, "tab")
  end
end

-- ---------------------------------------------------------------- drawing
local function drawBackground()
  local imgs = cfg.images[S.scene] or {}
  local x, y, w, h = bgRect(S.scene)
  B.rect("fill", 0, 0, VW, VH, 0, 0, 0, 255)
  if not (imgs.bg and drawFull(imgs.bg, x, y, w, h)) then B.rect("fill", 0, 0, VW, VH, 51, 51, 51, 255) end
end

local function drawAnchored(path, sx, sy, sw, sh, ax, ay, lx, ly, w, h, mirror, alpha)
  local dx = mirror and (ax - (lx + w)) or (ax + lx)
  return drawPart(path, sx, sy, sw, sh, dx, ay + ly, w, h, mirror, alpha)
end

local function hotspotScale(h)   -- followers keep their size when they start following, then scale with depth
  if h.isFollowing then
    local ref = h._ref or depth(S.scene, h.x, h.y)
    return (h.scale or 1) * depth(S.scene, h.x, h.y) / ref
  end
  return h.scale or 1
end

-- sprite sheets + idle/walk animations (same rules as web/sprite.js)
local function sizeOf(path)
  local e = path and getImage(path)
  if e then return e.aw, e.ah end
  return nil
end

local DIR_ANIMS = { "idle_up", "walk_up", "run_up", "idle_down", "walk_down", "run_down" }

local function spriteInfo(o, kind)
  local image = o.customImage or o.image
  local w, h = sizeOf(image)
  if not w then w, h = o.frameWidth or 100, o.frameHeight or 100 end
  local total = o.totalFrames or o.frames or o.cols or 1
  local cols = o.cols or (o.frameWidth and math.max(1, U.round(w / o.frameWidth)) or total)
  local rows = o.rows or (o.frameHeight and math.max(1, U.round(h / o.frameHeight)) or 1)
  local speed = o.animSpeed or (kind == "player" and 6 or 10)
  local a = o.anims or {}
  local function norm(src, defFrames, defSpeed)
    src = src or {}
    return { row = src.row or 0, col = src.col or 0, frames = src.frames or defFrames, speed = src.speed or defSpeed,
             image = src.image, cols = src.cols, rows = src.rows }
  end
  local anims = { idle = norm(a.idle, kind == "player" and 1 or total, speed), walk = norm(a.walk, total, speed) }
  if a.run then anims.run = norm(a.run, total, speed)
  else
    anims.run = {}
    for k2, v in pairs(anims.walk) do anims.run[k2] = v end
    anims.run.speed = math.max(1, U.round((anims.walk.speed or speed) * 0.6))
  end
  if o.dirs then for _, n in ipairs(DIR_ANIMS) do if a[n] then anims[n] = norm(a[n], 1, speed) end end end
  return { image = image, cols = cols, rows = rows, fw = o.frameWidth or w / cols, fh = o.frameHeight or h / rows,
           sheetX = o.sheetX or 0, sheetY = o.sheetY or 0, anims = anims, dirs = o.dirs }
end

-- base = idle | walk | run, dir = side | up | down; returns the animation name and if mirroring is allowed
local function pickAnim(info, base, dir)
  if info.dirs and (dir == "up" or dir == "down") then
    local n = base .. "_" .. dir
    if info.anims[n] then return n, false end
  end
  return info.anims[base] and base or "idle", true
end

local function spriteFrame(info, name, tick)
  local a = info.anims[name] or info.anims.idle
  local frames = math.max(1, math.floor(a.frames or 1))
  local i = 0
  if frames > 1 then i = math.floor(tick / math.max(1, a.speed or 10)) % frames end
  local path, cols, fw, fh, ox, oy = info.image, info.cols, info.fw, info.fh, info.sheetX, info.sheetY
  if a.image then
    local w, h = sizeOf(a.image)
    if w then
      cols = a.cols or frames
      path, fw, fh, ox, oy = a.image, w / cols, h / (a.rows or 1), 0, 0
    end
  end
  local idx = (a.row or 0) * cols + (a.col or 0) + i
  local c, r = idx % cols, math.floor(idx / cols)
  return path, U.round(ox + c * fw), U.round(oy + r * fh), U.round(fw), U.round(fh), info.fh / fh
end

local function drawSprite(o, kind, base, x, y, scale, mirror, alpha, dir)
  local info = spriteInfo(o, kind)
  local name, mirrorOk = pickAnim(info, base, dir or "side")
  if not mirrorOk then mirror = false end
  local path, sx, sy, sw, sh, k = spriteFrame(info, name, S.frame)
  if not getImage(path) then path, sx, sy, sw, sh, k = spriteFrame(info, "none", S.frame) end
  local w, h = sw * k * scale, sh * k * scale
  drawAnchored(path, sx, sy, sw, sh, x, y, -w / 2 + (o.offX or 0), -h + (o.offY or 0), w, h, mirror, alpha)
end

local function drawHotspot(h)
  if h.customImage and getImage(h.customImage) then
    local a = 1
    if fadesWhenFar(h) and not h.isFollowing then a = nearAlpha(h, 1) end
    if a > 0.01 then drawSprite(h, "character", h._moving and (S.knight.running and "run" or "walk") or "idle", h.x, h.y, hotspotScale(h), h.mirrored, a, h._dir) end
  else
    local a = (h.nearFade == false) and 0.6 or nearAlpha(h, 0.6)
    if ui.debug then a = 1 end
    if a > 0.01 then drawFull(cfg.ui.orb, h.x - 25, h.y - 25, 50, 50, false, a) end
  end
end

local function drawKnight()
  local k = S.knight
  local p = cfg.player
  local o
  if p and p.customImage and getImage(p.customImage) then o = p
  else
    o = cfg.knight
    if o.offY == nil then o.offY = 35 end
  end
  local base = k.state == "WALKING" and (k.running and "run" or "walk") or "idle"
  drawSprite(o, "player", base, k.x, k.y, k.scale, not k.facingRight, 1, k.dir)
end

local function drawBubble()
  local d = S.dialogue
  if not d or not d.text or d.text == "" then return end
  local bw, bh = 320, 140
  local bx, by
  local t = d.target
  if d.speaker == "knight" or not t then
    bx, by = S.knight.x, S.knight.y - 200
  elseif t.isFollowing then
    bx, by = t.x, t.y - (t.frameHeight or 100) * hotspotScale(t) - 20
  else
    bx, by = t.tx or t.x, (t.ty or (t.y - 100)) - 20
  end
  -- keep the bubble on screen
  bx = U.clamp(bx, bw / 2 + 4, VW - bw / 2 - 4)
  by = U.clamp(by, bh + 4, VH - 4)
  drawFull(cfg.ui.bubble, bx - bw / 2, by - bh, bw, bh, t and t.flipBubble, 1)
  local ox, oy = 0, 0
  if d.effect == "angry" then ox, oy = (math.random() - 0.5) * 3, (math.random() - 0.5) * 3 end
  if d.effect == "peace" then oy = math.sin(B.time() * 5) * 2 end
  local lines = U.wrap(d.text, 260, function(s) return textW(s, FONT) end)
  local ty = by - bh + 38
  for i, line in ipairs(lines) do
    if i > 5 then break end
    textC(line, bx + ox, ty + oy + (i - 1) * 18, FONT, C.brown)
  end
  if d.timer == math.huge and math.floor(B.time() * 2.5) % 2 == 0 then textC("v", bx + 120, by - 44, 16, C.darkred) end   -- "tap to continue"
end

local function drawPanel()
  if not ui.panelOpen then return end
  if ui.debug then
    B.rect("fill", 0, 0, PANEL_W, VH, 20, 20, 20, 242)
    B.rect("fill", PANEL_W - 2, 0, 2, VH, rgba(C.green))
    textC((ui.ed.sel and ui.ed.mode == "select") and "OBJECT" or "EDITOR", PANEL_W / 2, 14, 18, C.green)
    return
  end
  B.rect("fill", 0, 0, PANEL_W, VH, rgba(C.parchment))
  B.rect("fill", PANEL_W - 3, 0, 3, VH, 110, 80, 50, 255)
  if not drawFull(cfg.ui.panelBox, 10, 18, PANEL_W - 20, 80) then
    B.rect("fill", 10, 18, PANEL_W - 20, 80, 240, 225, 200, 255)
  end
  textC("Dignity: " .. tostring(S.dignity), PANEL_W / 2, 48, 18, C.brown)
  if ui.press then
    local f = math.min(1, (B.time() - ui.press.t) / 0.8)
    B.rect("fill", 14, 90, (PANEL_W - 28) * f, 5, 0, 160, 0, 255)
  end
end

local function drawTitle()
  B.rect("fill", 0, 0, VW, VH, 0, 0, 0, 255)
  local ts = cfg.titleScreen
  local e = getImage(ts.backgroundImage)
  if e then -- "cover" like the CSS version
    local s = math.max(VW / e.aw, VH / e.ah)
    local w, h = e.aw * s, e.ah * s
    drawFull(ts.backgroundImage, (VW - w) / 2, (VH - h) / 2, w, h)
  end
  if ts.titleText and ts.titleText ~= "" and ts.showTitleText then
    textC(ts.titleText, VW / 2 + 2, 322, 34, C.black, 200)
    textC(ts.titleText, VW / 2, 320, 34, C.gold)
  end
end

local function drawCursor()
  if not ui.cursor then return end
  local x, y = ui.mx, ui.my
  B.circle("fill", x, y, 5, 255, 255, 255, 230)
  B.circle("line", x, y, 9, 0, 0, 0, 200, 2)
end

function G.draw()
  rebuildButtons()
  if not S then return end
  if S.mode == "title" then
    drawTitle()
  else
    drawBackground()
    local list = S.hotspots[S.scene] or {}
    -- y-sorted: hotspot sprites and knight
    local order = {}
    for _, h in ipairs(list) do
      if ui.debug or isVisible(h) then order[#order + 1] = { y = h.y, h = h } end
    end
    order[#order + 1] = { y = S.knight.y, knight = true }
    table.sort(order, function(a, b) return a.y < b.y end)
    for _, o in ipairs(order) do
      if o.knight then drawKnight() else drawHotspot(o.h) end
    end
    local imgs = cfg.images[S.scene] or {}
    if imgs.fg then local x, y, w, h = bgRect(S.scene) drawFull(imgs.fg, x, y, w, h) end
    if ui.debug then drawEditorWorld() end
    drawBubble()
    if not ui.debug then drawAdvUI() end
    if S.clickFx then
      local fx = S.clickFx
      B.circle("line", fx.x, fx.y, 5 + fx.life, 255, 255, 255, math.floor(255 * fx.life / 20), 3)
    end
    if S.gameOver then
      B.rect("fill", 0, 0, VW, VH, 0, 0, 0, 170)
      textC("Your dignity is gone!", VW / 2, VH / 2 - 30, 34, C.gold)
      textC("GAME OVER", VW / 2, VH / 2 + 20, 24, C.white)
    end
    drawPanel()
    for _, l in ipairs(ui.labels or {}) do textC(l.text, l.x, l.y, l.size or 13, l.col or C.brown) end
  end
  drawTextEdit()
  if ui.slotMenu then
    B.rect("fill", 0, 0, VW, VH, 0, 0, 0, 190)
    textC(ui.slotMenu == "save" and "Save game" or "Load game", VW / 2, 100, 26, C.gold)
  end
  drawButtons()
  if ui.toast then
    local w = textW(ui.toast.text, 14) + 30
    B.rect("fill", VW / 2 - w / 2, VH - 50, w, 32, 0, 0, 0, 200)
    textC(ui.toast.text, VW / 2, VH - 42, 14, C.white)
  end
  drawCursor()
end

-- ---------------------------------------------------------------- input
local function clickButtons(x, y)
  for i = #ui.buttons, 1, -1 do
    local b = ui.buttons[i]
    if x >= b.x and x <= b.x + b.w and y >= b.y and y <= b.y + b.h then
      play("click", false)
      b.fn()
      return true
    end
  end
  return false
end

local function worldClick(x, y)
  if advTapUI(x, y) then return end
  local list = S.hotspots[S.scene] or {}
  local hit
  for i = #list, 1, -1 do
    local h = list[i]
    if isVisible(h) and hotspotHit(h, x, y) then hit = h break end
  end
  S.pendingTravel = nil
  -- double tap = run
  local now = B.time()
  local lt = ui.lastTap
  local dbl = lt and now - lt.t < 0.38 and U.dist(lt.x, lt.y, x, y) < 50 and cfg.knight.allowRun ~= false
  ui.lastTap = (not dbl) and { x = x, y = y, t = now } or nil
  if dbl and S.knight.state == "WALKING" then S.knight.running = true return end
  S.knight.running = false
  if hit then interact(hit) return end
  S.pendingAct = nil
  if S.held then S.held = nil return end   -- tap on empty ground puts the item back
  local path = N.findPath(navFor(S.scene), S.knight.x, S.knight.y, x, y)
  if path and #path > 0 then
    S.knight.path = path
    S.knight.state = "WALKING"
    local e = path[#path]
    S.clickFx = { x = e.x, y = e.y, life = 20 }
  end
end

function G.pointerDown(x, y)
  ui.mx, ui.my = x, y
  if not S then return end
  rebuildButtons()
  if clickButtons(x, y) then return end
  if ui.slotMenu then ui.slotMenu = nil return end
  if ui.textEdit then return end
  if S.mode == "title" then return end
  if S.gameOver then return end
  if ui.panelOpen and x < PANEL_W then
    if not ui.debug and cfg.allowDebug and x >= 10 and x <= PANEL_W - 10 and y >= 18 and y <= 98 then
      ui.press = { x = x, y = y, t = B.time() }   -- hidden editor: hold the Dignity box
    end
    return
  end
  play("click", false)
  if ui.debug then editorPress(x, y) return end
  worldClick(x, y)
end

function G.pointerMove(x, y)
  ui.mx, ui.my = x, y
  if ui.debug and S and S.mode == "play" then editorMove(x, y) end
  if ui.press and U.dist(ui.press.x, ui.press.y, x, y) > 25 then ui.press = nil end
end

function G.pointerUp(x, y)
  ui.dragging = nil
  ui.press = nil
end

-- key names: "debug" (F2/SELECT), "menu" (TAB/START/TRIANGLE), "back" (ESC/CIRCLE)
function G.key(name)
  if not S then return end
  if ui.textEdit then
    if name == "enter" then finishText(true)
    elseif name == "escape" or name == "back" then finishText(false)
    elseif name == "backspace" then
      local t = ui.textEdit.text
      local cut = #t
      while cut > 0 and t:byte(cut) >= 128 and t:byte(cut) < 192 do cut = cut - 1 end   -- whole UTF-8 char
      ui.textEdit.text = t:sub(1, math.max(0, cut - 1))
    end
    return
  end
  if name == "debug" then
    if S.mode == "play" and cfg.allowDebug then ui.debug = not ui.debug ui.drag = false ui.panelOpen = true end
  elseif name == "menu" then
    if S.mode == "play" then ui.panelOpen = not ui.panelOpen end
    if S.mode == "title" then G.startGame() end
  elseif name == "back" then
    if ui.slotMenu then ui.slotMenu = nil
    elseif S.mode == "play" and (S.verbMenu or S.held) then S.verbMenu = nil S.held = nil
    elseif S.mode == "title" then if B.quit then B.quit() end
    elseif ui.debug then ui.debug = false
    else ui.panelOpen = not ui.panelOpen end
  end
end

function G.mode() return S and S.mode end
function G.textEditing() return ui.textEdit ~= nil end
function G.state() return S end

return G
