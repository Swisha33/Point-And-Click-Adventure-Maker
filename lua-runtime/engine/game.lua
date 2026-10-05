-- Sir Licks-a-Lot point & click engine — platform independent core.
-- The platform backend (platform/love.lua or platform/vita.lua) provides drawing,
-- sound, file access and forwards input to the G.pointer*/G.key functions.
local U = require("engine.util")
local N = require("engine.nav")
local Lay = require("engine.layout")
local PL = require("engine.plugins")

local G = {}

-- movement direction from a movement vector (top-down games)
local function moveDir(dx, dy, prev)
  if math.abs(dx) < 0.01 and math.abs(dy) < 0.01 then return prev or "side" end
  if math.abs(dy) > math.abs(dx) * 1.3 then return dy < 0 and "up" or "down" end
  return "side"
end
local lay          -- UI layout (title / HUD / menus), created in G.init
local plugins      -- plugin host, created in G.init
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
  c.plugins = c.plugins or {}
  Lay.ensure(c)
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
    seq = nil, choices = nil, verbMenu = nil, pendingAct = nil, notice = nil, plugins = {},
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
             mx = -999, my = -999, cursor = false, toast = nil, menus = {}, groups = {}, edX = 0 }
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
  if plugins then plugins.hook("sceneEnter", name) end
end

function G.startGame(forLoad)
  S = freshState()
  S.mode = "play"
  ui.menus = {}
  setScene(cfg.startScene, forLoad)
  local m = getSound("music")
  if m then B.setVolume(m, volFor("music")) B.playSound(m, true) end
  if plugins then plugins.hook("gameStart") end
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
  ui.menus = {}
  ui.ue, ui.picker = nil, nil
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
    if plugins and c.type and c.type ~= "flag" and c.type ~= "noflag" and c.type ~= "item" and c.type ~= "noitem" then
      if plugins.cond(c) == false then return false end
    end
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
    elseif t == "menu" then if key and lay and lay.screen(key) then G.openMenu(key) end
    elseif t == "closemenu" then table.remove(ui.menus)
    elseif plugins and t and not ({ give = 1, take = 1, set = 1, clear = 1, hide = 1, show = 1, dignity = 1, sound = 1, follow = 1, exit = 1, ["goto"] = 1 })[t] then
      plugins.action(act, h)
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
  local x0 = G.hudLeft() + 34
  for i, id in ipairs(S.inv) do out[i] = { id = id, x = x0 + (i - 1) * (size + gap), y = VH - size - 10, w = size, h = size } end
  return out
end
-- small tab that opens / closes the inventory bar
local function invTabRect()
  if not S.inv or #S.inv == 0 then return nil end
  local r = invRects()
  if #r > 0 then local l = r[#r] return { x = l.x + l.w + 10, y = l.y + 14, w = 24, h = 30, open = true } end
  local x0 = G.hudLeft() + 34
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
  local left = G.hudLeft()
  local rowH = 34
  local w = math.min(700, VW - left - 20)
  local x = left + (VW - left - w) / 2
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
           dialogIdx = dialogIdx, found = found, followers = followers, plugins = S.plugins }
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
  S.plugins = d.plugins or {}
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
  lay = Lay.new({
    B = B, cfg = cfg, ui = ui, getImage = getImage, drawFull = drawFull, drawPart = drawPart, textW = textW,
    state = function() return S end, condsOk = condsOk, plugins = nil,
    vars = function()
      local l = (S and S.scene and cfg.levelLicks[S.scene]) or cfg.lickConfig
      return { dignity = S and S.dignity or cfg.startDignity, scene = S and S.scene or "", title = cfg.titleScreen.titleText,
               start = cfg.titleScreen.startButtonText, lick = (l and l.text) or "Lick", mute = settings.muted and "UNMUTE" or "MUTE",
               music = U.round(settings.music * 100), sfx = U.round(settings.sfx * 100), amb = U.round(settings.amb * 100),
               items = S and S.inv and #S.inv or 0 }
    end,
    exits = function()
      local out, shown = {}, {}
      if not S or S.mode ~= "play" then return out end
      for _, ex in ipairs(cfg.exits[S.scene] or {}) do shown[ex.target] = true out[#out + 1] = { text = ex.text or ("To " .. ex.target), target = ex.target } end
      for _, ex in ipairs(S.unlocked[S.scene] or {}) do
        if not shown[ex.target] then out[#out + 1] = { text = ex.text, target = ex.target } end
      end
      return out
    end,
    env = function()
      if not saveCache then refreshSaves() end
      local any = false
      for _, slot in ipairs(SLOTS) do if saveCache[slot] then any = true end end
      return { hasSave = any, canFullscreen = B.toggleFullscreen ~= nil, titleText = cfg.titleScreen.showTitleText ~= false and (cfg.titleScreen.titleText or "") ~= "",
               muted = settings.muted, unmuted = not settings.muted, debugAllowed = cfg.allowDebug and true or false, running = S and S.mode == "play" }
    end,
    volume = function(t) return settings[t == "sfx" and "sfx" or t == "amb" and "amb" or "music"] or 0.5 end,
    setVolume = function(t, v)
      settings[t == "sfx" and "sfx" or t == "amb" and "amb" or "music"] = U.clamp(v, 0, 1)
      applyVolumes() ui.volDirty = true
    end,
    doAction = function(a, el) G.uiAction(a, el) end,
  })
  G.lay = lay
  -- plugins (plugins/<id>/game.lua)
  plugins = PL.new({ B = B, cfg = cfg, toast = toast, state = function() return S end, api = {
    toast = toast, state = function() return S end, setScene = function(n) setScene(n) end,
    execActions = function(l, h) return execActions(l, h) end, condsOk = function(l) return condsOk(l) end,
    say = function(text, speaker) runSeq({ { say = { speaker = speaker or "knight", text = text } } }) end,
    getImage = getImage, drawImage = function(path, x, y, w, h, fit) return lay.image(path, x, y, w, h, fit) end,
    textWidth = textW, openMenu = function(id) G.openMenu(id) end, ui = ui, VW = VW, VH = VH,
  } })
  G.plugins = plugins
  lay.setPlugins(plugins)
  plugins.loadAll()
end

function G.hudLeft()
  if ui.debug or not lay then return 0 end
  return lay.hudLeft()
end
function G.openMenu(id)
  if id == "title" or id == "hud" or not lay.screen(id) then return end
  for i = #ui.menus, 1, -1 do if ui.menus[i] == id then table.remove(ui.menus, i) end end
  ui.menus[#ui.menus + 1] = id
end
local function doLick()
  if not S or S.mode ~= "play" or S.seq or S.gameOver then return end
  local l = cfg.levelLicks[S.scene] or cfg.lickConfig
  runSeq({ { say = { speaker = "knight", text = l.response or "" } }, { actions = { { type = "dignity", value = l.dignityChange or 0 } } } })
end
-- what a UI button does (same list as UI_ACTIONS in ui-layout.js)
function G.uiAction(a, el)
  local t = a.type
  if plugins and plugins.uiAction(t, a, el) then return end
  local playing = S and S.mode == "play"
  if t == "start" then G.startGame()
  elseif t == "continue" then local l = latestSave() if l then loadGame(l) end
  elseif t == "save" then if playing then ui.slotMenu = "save" end
  elseif t == "load" then ui.slotMenu = "load"
  elseif t == "title" then if playing then toTitle() end
  elseif t == "scene" then
    if a.target and cfg.spawns[a.target] then
      if not playing then G.startGame() end
      ui.menus = {}
      setScene(a.target)
    end
  elseif t == "menu" then if a.screen then G.openMenu(a.screen) end
  elseif t == "close" then table.remove(ui.menus)
  elseif t == "toggle" then if a.group and a.group ~= "" then ui.groups[a.group] = not lay.groupShown(a.group) end
  elseif t == "mute" then settings.muted = not settings.muted applyVolumes() saveSettings()
  elseif t == "fullscreen" then if B.toggleFullscreen then B.toggleFullscreen() end
  elseif t == "lick" then doLick()
  elseif t == "rules" then if playing and a.actions then execActions(a.actions, nil) end
  elseif t == "debug" then if playing and cfg.allowDebug then ui.debug = true ui.panelOpen = true end
  elseif t == "quit" then if B.quit then B.quit() elseif playing then toTitle() end
  end
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
  if ui.press and B.time() - ui.press.t > 0.8 then ui.press = nil ui.debug = true ui.panelOpen = true ui.menus = {} toast("Editor") end
  if plugins then plugins.hook("update", dt) end
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

-- ---------------------------------------------------------------- file picker
-- Pictures from the memory card / save folder (e.g. drawn with LibreSprite on the Vita).
-- The backend provides B.pickerRoots() and B.listDir(path); without them only the game folders are offered.
local IMG_EXT = { png = true, jpg = true, jpeg = true, bmp = true }
local PICK_ROWS = 8
local function joinPath(dir, name)
  if dir == "" then return name end
  if dir:match("[/:]$") then return dir .. name end
  return dir .. "/" .. name
end
local function openPicker(title, cb)
  local roots = (B.pickerRoots and B.pickerRoots()) or { { label = "Game media", path = "media" }, { label = "Game assets", path = "assets" } }
  ui.picker = { title = title, cb = cb, dir = nil, roots = roots, page = 1, entries = nil, sel = nil }
end
G.openPicker = openPicker
-- a picture dropped onto the window (LÖVE desktop) - select it in an open picker
function G.fileDropped(path)
  if ui.picker then ui.picker.dir, ui.picker.entries, ui.picker.page, ui.picker.sel = "images", nil, 1, path
  else toast("Copied to images/ - choose it with PICTURE FROM FILES") end
end
local function pickerEntries()
  local p = ui.picker
  if p.entries then return p.entries end
  local out = {}
  if not p.dir then
    for _, r in ipairs(p.roots) do out[#out + 1] = { label = r.label, path = r.path, dir = true } end
  else
    local l = (B.listDir and B.listDir(p.dir)) or {}
    table.sort(l, function(a, b) if a.dir ~= b.dir then return a.dir end return a.name:lower() < b.name:lower() end)
    for _, e in ipairs(l) do
      local ext = e.name:match("%.(%w+)$")
      if e.dir then out[#out + 1] = { label = "[" .. e.name .. "]", path = joinPath(p.dir, e.name), dir = true }
      elseif ext and IMG_EXT[ext:lower()] then out[#out + 1] = { label = e.name, path = joinPath(p.dir, e.name) } end
    end
  end
  p.entries = out
  return out
end
local function buildPickerButtons()
  local p = ui.picker
  local list = pickerEntries()
  local pages = math.max(1, math.ceil(#list / PICK_ROWS))
  p.page = U.clamp(p.page, 1, pages)
  local x, w, y = 40, 520, 96
  for i = (p.page - 1) * PICK_ROWS + 1, math.min(#list, p.page * PICK_ROWS) do
    local e = list[i]
    button("pk" .. i, e.label, x, y, w, 38, function()
      if e.dir then
        p.parent = p.parent or {}
        p.parent[#p.parent + 1] = p.dir or false
        p.dir, p.entries, p.page, p.sel = e.path, nil, 1, nil
      else
        p.sel = e.path
      end
    end, p.sel == e.path and "debugOn" or "debug")
    y = y + 43
  end
  if #list == 0 then ui.labels[#ui.labels + 1] = { text = "(no pictures here - png / jpg / bmp)", x = x + w / 2, y = 120, col = C.green } end
  local by = VH - 52
  if p.dir then
    button("pkup", "UP", x, by, 100, 38, function()
      local par = table.remove(p.parent or {})
      p.dir, p.entries, p.page, p.sel = par or nil, nil, 1, nil
    end, "debug")
  end
  button("pkprev", "< PAGE", x + 110, by, 110, 38, function() p.page = p.page - 1 end, "debug")
  button("pknext", "PAGE >", x + 230, by, 110, 38, function() p.page = p.page + 1 end, "debug")
  ui.labels[#ui.labels + 1] = { text = p.page .. "/" .. pages, x = x + 395, y = by + 12, col = C.green }
  button("pkx", "CANCEL", x + 420, by, 100, 38, function() ui.picker = nil end, "debugOn")
  if p.sel then
    button("pkok", "USE THIS PICTURE", 600, by, 320, 38, function()
      local path, cb = p.sel, p.cb
      ui.picker = nil
      if getImage(path) then cb(path) else toast("Could not load " .. path) end
    end, "debug")
  end
end
local function drawPicker()
  local p = ui.picker
  if not p then return end
  B.rect("fill", 0, 0, VW, VH, 10, 10, 10, 245)
  B.rect("line", 2, 2, VW - 4, VH - 4, 0, 255, 0, 255, 2)
  textC(p.title or "Choose a picture", VW / 2, 16, 20, C.green)
  B.text(p.dir or "(choose a place)", 40, 64, 13, 200, 255, 200, 255)
  if p.sel then
    local e = getImage(p.sel)
    B.rect("line", 600, 96, 320, 380, 0, 255, 0, 255, 1)
    if e then
      local s = math.min(300 / e.aw, 330 / e.ah)
      drawFull(p.sel, 760 - e.aw * s / 2, 286 - e.ah * s / 2 - 15, e.aw * s, e.ah * s)
      textC(e.w .. " x " .. e.hgt, 760, 450, 13, C.green)
    else textC("(cannot load)", 760, 280, 14, C.red) end
  end
end

-- ---------------------------------------------------------------- on-device level tools
local function newLevel(name)
  name = (name or ""):gsub("[^%w_%- ]", ""):gsub("^%s+", ""):gsub("%s+$", "")
  if name == "" then toast("Level needs a name") return end
  if cfg.spawns[name] then toast("Level exists already") return end
  cfg.spawns[name] = { x = 480, y = 420 }
  cfg.hotspots[name], cfg.exits[name], cfg.images[name] = {}, {}, {}
  cfg.backgrounds[name] = { x = 0, y = 0, scale = 1, fit = "cover" }
  cfg.sceneOrder[#cfg.sceneOrder + 1] = name
  S.hotspots[name] = {}
  setScene(name)
  toast("Level " .. name .. " created - pick a background")
  openPicker("Background for " .. name, function(path)
    cfg.images[name].bg = path
    navCache[name] = nil
  end)
end
local function paintCell(x, y)
  local g = navFor(S.scene)
  local cx, cy = math.floor(x / N.CELL) + 1, math.floor(y / N.CELL) + 1
  local r = ui.ed.brush or 2
  for yy = cy - r + 1, cy + r - 1 do
    for xx = cx - r + 1, cx + r - 1 do
      if g[yy] and g[yy][xx] ~= nil then g[yy][xx] = not ui.ed.paintBlock end
    end
  end
  ui.ed.paintDirty = true
end
local function storePaint()
  if ui.ed.paintDirty then cfg.navgrids[S.scene] = N.toStrings(navFor(S.scene)) ui.ed.paintDirty = nil end
end
G.storePaint = storePaint

-- ---------------------------------------------------------------- on-device UI layout editor
local UI_ACTION_LIST = { "none", "start", "continue", "save", "load", "title", "scene", "menu", "close", "toggle", "mute", "fullscreen", "lick", "debug", "quit" }
local UI_ACTION_LABEL = { none = "nothing", start = "start game", continue = "continue", save = "save menu", load = "load menu",
  title = "title screen", scene = "go to scene", menu = "open menu", close = "close menu", toggle = "show/hide group",
  mute = "mute", fullscreen = "fullscreen", lick = "lick", debug = "editor", quit = "quit" }
local BG_COLORS = { "#8b0000", "#333333", "#004080", "#006400", "#000000aa", "#e6c9a8eb", "" }
local TX_COLORS = { "#ffd700", "#ffffff", "#000000", "#4e342e", "#00ff00" }
local function screenIds()
  local ids = { "title", "hud" }
  local extra = {}
  for k in pairs(Lay.ensure(cfg).screens) do if k ~= "title" and k ~= "hud" then extra[#extra + 1] = k end end
  table.sort(extra)
  for _, k in ipairs(extra) do ids[#ids + 1] = k end
  return ids
end
local function cycle(list, v, d)
  local i = 1
  for k, x in ipairs(list) do if x == v then i = k end end
  return list[(i - 1 + d) % #list + 1]
end
function G.uiEditStart() ui.ue = { screen = "hud", sel = nil, drag = nil } ui.panelOpen = true ui.edX = VW - PANEL_W end   -- HUD sits left
function G.uiEditStop() ui.ue = nil ui.edX = 0 end
local function ueScreen() return Lay.ensure(cfg).screens[ui.ue.screen] end
local function ueNewId(s) local n = #s.elements + 1 local id repeat id = "d" .. n n = n + 1 local dup = false for _, e in ipairs(s.elements) do if e.id == id then dup = true end end until not dup return id end
local function ueAdd(kind)
  local s = ueScreen()
  local e = { id = ueNewId(s), type = kind, x = 380, y = 230, w = 200, h = 44 }
  if kind == "button" then e.text, e.fontSize, e.color, e.bg, e.border, e.borderW, e.action = "Button", 15, "#ffd700", "#8b0000", "#ffd700", 2, { type = "none" }
  elseif kind == "label" then e.text, e.fontSize, e.color, e.shadow = "Text", 18, "#ffffff", true
  elseif kind == "image" then e.w, e.h, e.fit = 120, 120, "contain" end
  s.elements[#s.elements + 1] = e
  ui.ue.sel = e
  if kind == "image" then openPicker("Picture", function(p) e.image = p end) end
end
local function ueNewMenu()
  local L = Lay.ensure(cfg)
  local n, id = 1, nil
  repeat id = "menu" .. n n = n + 1 until not L.screens[id]
  L.screens[id] = { name = "Menu " .. (n - 1), modal = true, dim = 0.5, elements = {
    { id = "m_box", type = "panel", x = 300, y = 120, w = 360, h = 300, bg = "#1e1410ee", border = "#ffd700", borderW = 3 },
    { id = "m_head", type = "label", x = 300, y = 135, w = 360, h = 40, text = "Menu " .. (n - 1), fontSize = 24, color = "#ffd700", shadow = true },
    { id = "m_close", type = "button", x = 380, y = 360, w = 200, h = 40, text = "Close", fontSize = 16, color = "#ffd700", bg = "#8b0000", border = "#ffd700", borderW = 2, action = { type = "close" } },
  } }
  ui.ue.screen, ui.ue.sel = id, nil
  toast("New menu: open it with a button (action: open menu)")
end
local function buildUIEditorButtons(x, w, y, row, nextRow, half)
  local ue = ui.ue
  local s = ueScreen()
  if not s then ue.screen = "hud" s = ueScreen() end
  row("scr-", "< SCREEN", function() ue.screen = cycle(screenIds(), ue.screen, -1) ue.sel = nil end, false, x, half)
  row("scr+", "SCREEN >", function() ue.screen = cycle(screenIds(), ue.screen, 1) ue.sel = nil end, false, x + half + 6, half) nextRow()
  ui.labels[#ui.labels + 1] = { text = s.name or ue.screen, x = x + w / 2, y = y() + 6, col = C.gold } nextRow(22)
  row("addb", "+ BUTTON", function() ueAdd("button") end, false, x, half)
  row("addt", "+ TEXT", function() ueAdd("label") end, false, x + half + 6, half) nextRow()
  row("addi", "+ PICTURE", function() ueAdd("image") end, false, x, half)
  row("addm", "+ NEW MENU", ueNewMenu, false, x + half + 6, half) nextRow()
  local e = ue.sel
  if e then
    ui.labels[#ui.labels + 1] = { text = (e.type or "?") .. "  " .. (e.id or ""), x = x + w / 2, y = y() + 6, col = C.yellow } nextRow(22)
    if e.type ~= "image" and e.type ~= "exits" then
      row("etx", "TEXT: " .. tostring(e.text or ""):sub(1, 16), function() editText("Text ({dignity} {lick} {mute} ...)", e.text, function(t) e.text = t end) end) nextRow()
    end
    if e.type == "button" or e.type == "image" or e.type == "label" or e.type == "panel" then
      local a = e.action or { type = "none" }
      e.action = a
      button("act-", "<", x, y(), 34, 28, function() e.action = { type = cycle(UI_ACTION_LIST, a.type, -1) } end, "debug")
      button("act+", ">", x + w - 34, y(), 34, 28, function() e.action = { type = cycle(UI_ACTION_LIST, a.type, 1) } end, "debug")
      ui.labels[#ui.labels + 1] = { text = "Tap: " .. (UI_ACTION_LABEL[a.type] or a.type), x = x + w / 2, y = y() + 7, col = C.green } nextRow()
      if a.type == "scene" then
        a.target = a.target or cfg.sceneOrder[1]
        button("tg-", "<", x, y(), 34, 28, function() a.target = cycle(cfg.sceneOrder, a.target, -1) end, "debug")
        button("tg+", ">", x + w - 34, y(), 34, 28, function() a.target = cycle(cfg.sceneOrder, a.target, 1) end, "debug")
        ui.labels[#ui.labels + 1] = { text = tostring(a.target), x = x + w / 2, y = y() + 7, col = C.gold } nextRow()
      elseif a.type == "menu" then
        local menus = {}
        for _, id in ipairs(screenIds()) do if id ~= "title" and id ~= "hud" then menus[#menus + 1] = id end end
        if #menus > 0 then
          a.screen = a.screen or menus[1]
          button("tg-", "<", x, y(), 34, 28, function() a.screen = cycle(menus, a.screen, -1) end, "debug")
          button("tg+", ">", x + w - 34, y(), 34, 28, function() a.screen = cycle(menus, a.screen, 1) end, "debug")
          ui.labels[#ui.labels + 1] = { text = tostring(a.screen), x = x + w / 2, y = y() + 7, col = C.gold } nextRow()
        end
      elseif a.type == "toggle" then
        row("grp", "GROUP: " .. tostring(a.group or ""), function() editText("Group name", a.group, function(t) a.group = t end) end) nextRow()
      end
    end
    if e.type ~= "slider" then
      row("pic", "PICTURE FILE", function() openPicker("Picture for the element", function(p) e.image = p end) end, false, x, half)
      row("fit", "FIT: " .. (e.fit or "stretch"), function() e.fit = cycle({ "stretch", "contain", "cover" }, e.fit or "stretch", 1) end, false, x + half + 6, half) nextRow()
    end
    row("fs-", "FONT -", function() e.fontSize = math.max(6, (e.fontSize or 13) - 1) end, false, x, half)
    row("fs+", "FONT +", function() e.fontSize = (e.fontSize or 13) + 1 end, false, x + half + 6, half) nextRow()
    row("bgc", "BG COLOR", function() local c = cycle(BG_COLORS, e.bg or "", 1) e.bg = c ~= "" and c or nil end, false, x, half)
    row("txc", "TEXT COLOR", function() e.color = cycle(TX_COLORS, e.color or "#ffffff", 1) end, false, x + half + 6, half) nextRow()
    row("dup", "COPY", function()
      local c = U.deepcopy(e) c.id = ueNewId(s) c.x, c.y = c.x + 12, c.y + 12
      s.elements[#s.elements + 1] = c ue.sel = c
    end, false, x, half)
    row("del", "DELETE", function()
      for i = #s.elements, 1, -1 do if s.elements[i] == e then table.remove(s.elements, i) end end
      ue.sel = nil
    end, true, x + half + 6, half) nextRow()
    row("nopic", "NO PICTURE", function() e.image = nil end, false, x, half)
    row("front", "TO FRONT", function()
      for i = #s.elements, 1, -1 do if s.elements[i] == e then table.remove(s.elements, i) end end
      s.elements[#s.elements + 1] = e
    end, false, x + half + 6, half) nextRow()
  else
    ui.labels[#ui.labels + 1] = { text = "Tap an element, drag it,", x = x + w / 2, y = y() + 4, col = C.green, size = 11 }
    ui.labels[#ui.labels + 1] = { text = "drag the corner to resize", x = x + w / 2, y = y() + 18, col = C.green, size = 11 } nextRow()
  end
  local third = (w - 12) / 3
  row("side", ui.edX > 0 and "<< PANEL" or "PANEL >>", function() ui.edX = ui.edX > 0 and 0 or (VW - PANEL_W) end, false, x, third)
  row("uisave", "SAVE", saveEdits, false, x + third + 6, third)
  row("uidone", "DONE", function() G.uiEditStop() end, true, x + 2 * third + 12, third)
end

-- canvas part of the UI layout editor
function G.uiEditDraw()
  local id = ui.ue.screen
  local s = ueScreen()
  if not s then return end
  if id ~= "title" and id ~= "hud" then lay.draw({ "hud" }) end
  lay.draw({ id }, true)
  for _, e in ipairs(s.elements) do B.rect("line", e.x, e.y, e.w, e.h, 0, 255, 0, 110, 1) end
  local e = ui.ue.sel
  if e then
    B.rect("line", e.x, e.y, e.w, e.h, 0, 255, 0, 255, 3)
    B.rect("fill", e.x + e.w - 12, e.y + e.h - 12, 24, 24, 0, 255, 0, 255)
    B.text(e.x .. "," .. e.y .. "  " .. e.w .. "x" .. e.h, e.x, math.max(0, e.y - 16), 11, 0, 255, 0, 255)
  end
end
function G.uiEditPress(x, y)
  local ue = ui.ue
  local s = ueScreen()
  local e = ue.sel
  local grab = B.platform == "love-desktop" and 14 or 24
  if e and math.abs(x - (e.x + e.w)) <= grab and math.abs(y - (e.y + e.h)) <= grab then
    ue.drag = { mode = "size", e = e, x0 = x, y0 = y, w = e.w, h = e.h } return
  end
  for i = #s.elements, 1, -1 do
    local el = s.elements[i]
    if Lay.inside(el, x, y) then
      ue.sel = el
      ue.drag = { mode = "move", e = el, x0 = x, y0 = y, ex = el.x, ey = el.y }
      return
    end
  end
  ue.sel = nil
end
function G.uiEditMove(x, y)
  local d = ui.ue and ui.ue.drag
  if not d then return end
  local function sn(v) return math.floor(v / 5 + 0.5) * 5 end
  if d.mode == "move" then d.e.x, d.e.y = sn(d.ex + x - d.x0), sn(d.ey + y - d.y0)
  else d.e.w, d.e.h = math.max(10, sn(d.w + x - d.x0)), math.max(10, sn(d.h + y - d.y0)) end
end

local function buildEditorButtons()
  local ed = ui.ed
  local x, w = ui.edX + 10, PANEL_W - 20
  local y = 46
  local half = (w - 6) / 2
  local function row(id, label, fn, on, bx, bw)
    button(id, label, bx or x, y, bw or w, 28, fn, on and "debugOn" or "debug")
  end
  local function nextRow(dy) y = y + (dy or 33) end
  if ui.ue then buildUIEditorButtons(x, w, function() return y end, row, nextRow, half) return end
  if ed.page == "plugins" then   -- ---- buttons added by plugins
    row("back", "< BACK", function() ed.page = nil end) nextRow()
    for i, b in ipairs(plugins.editorButtons) do
      if i > 10 then break end
      row("plb" .. i, b.label, function() local ok, err = pcall(b.fn) if not ok then toast(tostring(err)) end end) nextRow()
    end
    if #plugins.editorButtons == 0 then ui.labels[#ui.labels + 1] = { text = "(no plugin tools)", x = x + w / 2, y = y + 7, col = C.green } nextRow() end
    ui.labels[#ui.labels + 1] = { text = "Loaded: " .. (#plugins.loaded > 0 and table.concat(plugins.loaded, ", ") or "-"), x = x + w / 2, y = y + 7, col = C.green, size = 11 } nextRow()
    for i, e in ipairs(plugins.errors) do if i <= 4 then ui.labels[#ui.labels + 1] = { text = e:sub(1, 36), x = x + w / 2, y = y + 4, col = C.red, size = 10 } nextRow(16) end end
    return
  end
  if ed.page == "exits" then   -- ---- exits of this level
    local exits = cfg.exits[S.scene] or {}
    cfg.exits[S.scene] = exits
    row("back", "< BACK", function() ed.page = nil end) nextRow()
    for i, ex in ipairs(exits) do
      if i > 7 then break end
      row("exn" .. i, ex.text or ("To " .. ex.target), function() editText("Button text", ex.text, function(t) ex.text = t end) end, false, x, w - 40)
      row("exd" .. i, "X", function() table.remove(exits, i) end, true, x + w - 34, 34) nextRow()
    end
    local others = {}
    for _, n in ipairs(cfg.sceneOrder) do if n ~= S.scene then others[#others + 1] = n end end
    if #others > 0 then
      ed.exitTo = ed.exitTo or others[1]
      button("et-", "<", x, y, 34, 28, function() ed.exitTo = cycle(others, ed.exitTo, -1) end, "debug")
      button("et+", ">", x + w - 34, y, 34, 28, function() ed.exitTo = cycle(others, ed.exitTo, 1) end, "debug")
      ui.labels[#ui.labels + 1] = { text = tostring(ed.exitTo), x = x + w / 2, y = y + 7, col = C.gold } nextRow()
      row("exadd", "+ EXIT TO " .. tostring(ed.exitTo):upper():sub(1, 12), function()
        exits[#exits + 1] = { target = ed.exitTo, text = "To " .. ed.exitTo }
        local back = cfg.exits[ed.exitTo] or {}
        cfg.exits[ed.exitTo] = back
        local has = false
        for _, b in ipairs(back) do if b.target == S.scene then has = true end end
        if not has then back[#back + 1] = { target = S.scene, text = "To " .. S.scene } end
        toast("Exit added (+ way back)")
      end) nextRow()
    else
      ui.labels[#ui.labels + 1] = { text = "(make a 2nd level first)", x = x + w / 2, y = y + 7, col = C.green } nextRow()
    end
    return
  end
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
    row("img", h.customImage and "CHANGE PICTURE" or "PICTURE FROM FILES", function()
      openPicker("Picture for " .. (h.name or "object"), function(p)
        local e = getImage(p)
        setP(h, "customImage", p) setP(h, "cols", 1) setP(h, "rows", 1) setP(h, "totalFrames", 1)
        setP(h, "frameWidth", e.aw) setP(h, "frameHeight", e.ah) setP(h, "anims", nil)
        setP(h, "scale", math.floor(160 / math.max(e.aw, e.ah) * 1000) / 1000)
      end)
    end) nextRow()
    if h.customImage then
      stepper("scl", "Image scale", string.format("%.2f", h.scale or 1), function() setP(h, "scale", math.max(0.02, (h.scale or 1) / 1.1)) end,
        function() setP(h, "scale", (h.scale or 1) * 1.1) end)
    end
    local nf = fadesWhenFar(h)
    row("near", nf and "Only when near: ON" or "Only when near: OFF", function() setP(h, "nearFade", not nf) end, nf) nextRow()
    row("hid", h.startHidden and "Starts hidden: ON" or "Starts hidden: OFF", function() setP(h, "startHidden", not h.startHidden or nil) end, h.startHidden, x, half)
    row("walk", h.noWalk and "Walk first: OFF" or "Walk first: ON", function() setP(h, "noWalk", not h.noWalk or nil) end, not h.noWalk, x + half + 6, half) nextRow()
    row("mir", h.mirrored and "Mirror: ON" or "Mirror: OFF", function() setP(h, "mirrored", not h.mirrored) end, h.mirrored, x, half)
    row("del", "DELETE", function() removeFromScene(h) ed.sel = nil toast("Deleted") end, true, x + half + 6, half) nextRow()
    return
  end
  -- ---- scene page
  row("prev", "< LEVEL", function() storePaint() cycleScene(-1) ed.sel = nil end, false, x, half)
  row("next", "LEVEL >", function() storePaint() cycleScene(1) ed.sel = nil end, false, x + half + 6, half) nextRow()
  row("newlv", "+ LEVEL", function() editText("Name of the new level", "", newLevel) end, false, x, half)
  row("bg", "BACKGROUND", function()
    local sc = S.scene
    openPicker("Background for " .. sc, function(p) cfg.images[sc] = cfg.images[sc] or {} cfg.images[sc].bg = p navCache[sc] = nil end)
  end, false, x + half + 6, half) nextRow()
  local modes = { { "select", "SELECT/EDIT" }, { "move", "MOVE" }, { "addHotspot", "+ HOTSPOT" },
    { "addPickup", "+ PICKUP" }, { "delete", "DELETE" }, { "paint", "WALK AREA" } }
  for i, m in ipairs(modes) do
    local left = i % 2 == 1
    row("m_" .. m[1], m[2], function() storePaint() ed.mode = m[1] ed.delArm = nil if m[1] == "paint" then ui.showGrid = true end end, ed.mode == m[1],
      left and x or (x + half + 6), half)
    if not left then nextRow() end
  end
  if ed.mode == "paint" then
    row("brush", ed.paintBlock and "BRUSH: WALL" or "BRUSH: FLOOR", function() ed.paintBlock = not ed.paintBlock end, ed.paintBlock, x, half)
    row("bsize", "SIZE " .. (ed.brush or 2), function() ed.brush = (ed.brush or 2) % 4 + 1 end, false, x + half + 6, half) nextRow()
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
  row("exits", "EXITS", function() ed.page = "exits" end, false, x, half)
  row("uilay", "UI LAYOUT", function() storePaint() G.uiEditStart() end, false, x + half + 6, half) nextRow()
  row("grid", ui.showGrid and "GRID: ON" or "GRID: OFF", function() ui.showGrid = not ui.showGrid end, ui.showGrid, x, half)
  row("dig+", "DIGNITY +1", function() S.dignity = S.dignity + 1 end, false, x + half + 6, half) nextRow()
  local tool = cfg.tools and cfg.tools.spriteEditorTitleId
  if B.launchApp then
    row("sprite", (tool and tool ~= "") and "SPRITE EDITOR" or "SET SPRITE EDITOR", function()
      if tool and tool ~= "" then storePaint() saveEdits() B.launchApp(tool)
      else editText("Title ID of your sprite editor (e.g. LibreSprite)", "", function(t) cfg.tools = cfg.tools or {} cfg.tools.spriteEditorTitleId = t:upper() end) end
    end, false, x, half)
  else
    row("side", ui.edX > 0 and "<< PANEL" or "PANEL >>", function() ui.edX = ui.edX > 0 and 0 or (VW - PANEL_W) end, false, x, half)
  end
  row("plug", "PLUGINS (" .. #plugins.editorButtons .. ")", function() ed.page = "plugins" end, false, x + half + 6, half) nextRow()
  row("save", "SAVE EDITS", function() storePaint() saveEdits() end, false, x, half)
  row("reset", "RESET EDITS", function()
    B.deleteSave("config_edit.lua")
    toast("Edits removed - restart loads game/config.lua")
  end, true, x + half + 6, half) nextRow()
  row("close", "CLOSE EDITOR", function() storePaint() ui.debug = false ed.sel = nil end) nextRow()
end

local function editorPress(x, y)
  local ed = ui.ed
  local list = S.hotspots[S.scene] or {}
  local function hitAt()
    for i = #list, 1, -1 do if hotspotHit(list[i], x, y) then return list[i] end end
  end
  if ed.mode == "paint" then paintCell(x, y) ui.dragging = { kind = "paint" } return end
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
  if d.kind == "paint" then paintCell(x, y) return end
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
        if g[gy][gx] then B.rect("fill", (gx - 1) * N.CELL, (gy - 1) * N.CELL, N.CELL - 1, N.CELL - 1, 255, 0, 255, 70)
        elseif ui.ed.mode == "paint" then B.rect("fill", (gx - 1) * N.CELL, (gy - 1) * N.CELL, N.CELL - 1, N.CELL - 1, 255, 0, 0, 90) end
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
  B.text("EDITOR  Level: " .. S.scene .. "  Mode: " .. ui.ed.mode, ui.edX > 0 and 34 or (PANEL_W + 34), 8, 13, C.green[1], C.green[2], C.green[3], 255)
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

local function rebuildButtons()
  ui.buttons, ui.labels = {}, {}
  if not S then return end
  if ui.textEdit then
    button("txok", "OK", VW / 2 - 210, 246, 200, 40, function() finishText(true) end)
    button("txno", "Cancel", VW / 2 + 10, 246, 200, 40, function() finishText(false) end)
    return
  end
  if ui.picker then buildPickerButtons() return end
  if ui.slotMenu then buildSlotButtons() return end
  if S.mode == "title" then return end   -- title screen, HUD and menus: engine/layout.lua
  if S.gameOver then return end
  if ui.debug then
    if ui.panelOpen then
      buildEditorButtons()
      button("tab", "<", ui.edX + PANEL_W, VH / 2 - 30, 24, 60, function() ui.panelOpen = false end, "tab")
    else
      button("tab", ">", ui.edX, VH / 2 - 30, 24, 60, function() ui.panelOpen = true end, "tab")
    end
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
  if not ui.panelOpen or not ui.debug then return end
  local px = ui.edX
  B.rect("fill", px, 0, PANEL_W, VH, 20, 20, 20, 242)
  B.rect("fill", px + PANEL_W - 2, 0, 2, VH, rgba(C.green))
  textC(ui.ue and "UI LAYOUT" or ((ui.ed.sel and ui.ed.mode == "select") and "OBJECT" or "EDITOR"), px + PANEL_W / 2, 14, 18, C.green)
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
    if ui.ue then G.uiEditDraw() else lay.draw() end
    plugins.hook("title")
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
    plugins.hook("drawWorld")
    if ui.debug and not ui.ue then drawEditorWorld() end
    if ui.ue then G.uiEditDraw()
    elseif not ui.debug then lay.draw({ "hud" }) end
    drawBubble()
    if not ui.debug then
      drawAdvUI()
      if #ui.menus > 0 then lay.draw(ui.menus) end
    end
    plugins.hook("drawUI")
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
  drawPicker()
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
  if ui.textEdit or ui.picker then return end
  if ui.ue then G.uiEditPress(x, y) return end
  if S.mode == "play" and ui.debug then
    if ui.panelOpen and x >= ui.edX and x < ui.edX + PANEL_W then return end
    play("click", false)
    editorPress(x, y)
    return
  end
  if plugins.hook("tap", x, y) == true then return end
  if S.gameOver then return end
  if lay.pointerDown(x, y) then play("click", false) return end
  if S.mode == "title" then return end
  play("click", false)
  worldClick(x, y)
end

function G.pointerMove(x, y)
  ui.mx, ui.my = x, y
  if ui.ue then G.uiEditMove(x, y) return end
  if lay then lay.pointerMove(x, y) end
  if ui.debug and S and S.mode == "play" then editorMove(x, y) end
  if ui.press and U.dist(ui.press.x, ui.press.y, x, y) > 25 then ui.press = nil end
end

function G.pointerUp(x, y)
  ui.dragging = nil
  ui.press = nil
  if ui.ue then ui.ue.drag = nil end
  if lay then lay.pointerUp() end
  if ui.volDirty then ui.volDirty = nil saveSettings() end
  if ui.debug and S and S.mode == "play" then storePaint() end
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
    if S.mode == "play" then
      if ui.debug then ui.panelOpen = not ui.panelOpen
      elseif #ui.menus > 0 then table.remove(ui.menus)
      else ui.groups.side = not lay.groupShown("side") end
    end
    if S.mode == "title" then G.startGame() end
  elseif name == "back" then
    if ui.slotMenu then ui.slotMenu = nil
    elseif ui.picker then ui.picker = nil
    elseif ui.ue then G.uiEditStop()
    elseif #ui.menus > 0 then table.remove(ui.menus)
    elseif S.mode == "play" and (S.verbMenu or S.held) then S.verbMenu = nil S.held = nil
    elseif S.mode == "title" then if B.quit then B.quit() end
    elseif ui.debug then ui.debug = false
    else ui.groups.side = not lay.groupShown("side") end
  end
end

function G.mode() return S and S.mode end
function G.textEditing() return ui.textEdit ~= nil end
function G.state() return S end

return G
