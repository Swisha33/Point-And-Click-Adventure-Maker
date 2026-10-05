-- Customizable game UI (title screen, in-game HUD, menu screens) - same data and rules as
-- ui-layout.js in the web editor. cfg.ui.layout = { screens = { title = ..., hud = ..., <menu> = ... } }
-- Element: { id, type = button|label|image|panel|exits|slider, x, y, w, h, text, fontSize, color, bg,
--            border, borderW, image, fit, align, shadow, action = { type, target, screen, group, actions },
--            group ("name" / "!name"), when, if = { conditions }, editorHold, itemH, gap, target, fill }
local U = require("engine.util")

local L = {}
local VW, VH = 960, 540

-- "#rrggbb" / "#rrggbbaa" -> r, g, b, a  (nil for none)
local colorCache = {}
local function col(c)
  if type(c) ~= "string" or c:sub(1, 1) ~= "#" then return nil end
  local v = colorCache[c]
  if v == nil then
    local h = c:sub(2)
    if #h == 3 then h = h:sub(1, 1):rep(2) .. h:sub(2, 2):rep(2) .. h:sub(3, 3):rep(2) end
    local r, g, b = tonumber(h:sub(1, 2), 16), tonumber(h:sub(3, 4), 16), tonumber(h:sub(5, 6), 16)
    local a = #h >= 8 and tonumber(h:sub(7, 8), 16) or 255
    v = (r and g and b and a) and { r, g, b, a } or false
    colorCache[c] = v
  end
  return v or nil
end
L.col = col

local function btn(o)
  local d = { type = "button", fontSize = 13, color = "#ffd700", bg = "#8b0000", border = "#ffd700", borderW = 2 }
  for k, v in pairs(o) do d[k] = v end
  return d
end

function L.default(cfg)
  local box = (cfg and cfg.ui and cfg.ui.panelBox) or "assets/uitext.png"
  return {
    screens = {
      title = { name = "Title screen", elements = {
        { id = "t_title", type = "label", x = 0, y = 290, w = 960, h = 50, text = "{title}", fontSize = 34, color = "#ffd700", shadow = true, when = "titleText" },
        btn({ id = "t_start", x = 280, y = 352, w = 400, h = 76, text = "{start}", fontSize = 30, borderW = 5, action = { type = "start" } }),
        btn({ id = "t_cont", x = 280, y = 438, w = 195, h = 40, text = "Continue", fontSize = 16, action = { type = "continue" }, when = "hasSave" }),
        btn({ id = "t_load", x = 485, y = 438, w = 195, h = 40, text = "Load Game", fontSize = 16, action = { type = "load" }, when = "hasSave" }),
        btn({ id = "t_fs", x = 380, y = 490, w = 200, h = 36, text = "Fullscreen", fontSize = 15, color = "#ffffff", bg = "#333333", border = "#ffffff", action = { type = "fullscreen" }, when = "canFullscreen" }),
      } },
      hud = { name = "Game HUD", elements = {
        { id = "h_panel", type = "panel", x = 0, y = 0, w = 240, h = 540, bg = "#e6c9a8eb", border = "#6e5032", borderW = 3, group = "side" },
        { id = "h_dignity", type = "label", x = 10, y = 18, w = 220, h = 80, image = box, fit = "stretch", text = "Dignity: {dignity}", fontSize = 18, color = "#4e342e", editorHold = true, group = "side" },
        btn({ id = "h_exits", type = "exits", x = 10, y = 112, w = 220, h = 116, itemH = 34, gap = 6, group = "side" }),
        btn({ id = "h_lick", x = 10, y = 236, w = 220, h = 34, text = "{lick}", action = { type = "lick" }, group = "side" }),
        btn({ id = "h_save", x = 10, y = 276, w = 106, h = 34, text = "Save", action = { type = "save" }, group = "side" }),
        btn({ id = "h_load", x = 124, y = 276, w = 106, h = 34, text = "Load", action = { type = "load" }, group = "side" }),
        btn({ id = "h_mute", x = 10, y = 316, w = 220, h = 34, text = "{mute}", action = { type = "mute" }, group = "side" }),
        { id = "h_music", type = "slider", x = 10, y = 358, w = 220, h = 28, target = "music", text = "Music {music}%", fontSize = 12, color = "#4e342e", bg = "#00000026", border = "#4e342e", borderW = 1, fill = "#8b000066", group = "side" },
        { id = "h_sfx", type = "slider", x = 10, y = 392, w = 220, h = 28, target = "sfx", text = "SFX {sfx}%", fontSize = 12, color = "#4e342e", bg = "#00000026", border = "#4e342e", borderW = 1, fill = "#8b000066", group = "side" },
        btn({ id = "h_fs", x = 10, y = 428, w = 220, h = 34, text = "Fullscreen", action = { type = "fullscreen" }, when = "canFullscreen", group = "side" }),
        btn({ id = "h_title", x = 10, y = 468, w = 220, h = 34, text = "Title Screen", action = { type = "title" }, group = "side" }),
        { id = "h_tab", type = "button", x = 240, y = 240, w = 24, h = 60, text = "<", fontSize = 14, color = "#ffffff", bg = "#444444e6", border = "#777777", borderW = 1, action = { type = "toggle", group = "side" }, group = "side" },
        { id = "h_tab2", type = "button", x = 0, y = 240, w = 24, h = 60, text = ">", fontSize = 14, color = "#ffffff", bg = "#8b0000e6", border = "#777777", borderW = 1, action = { type = "toggle", group = "side" }, group = "!side" },
      } },
      pause = { name = "Pause menu (example)", modal = true, dim = 0.55, elements = {
        { id = "p_box", type = "panel", x = 330, y = 110, w = 300, h = 320, bg = "#1e1410ee", border = "#ffd700", borderW = 3 },
        { id = "p_head", type = "label", x = 330, y = 125, w = 300, h = 40, text = "Paused", fontSize = 26, color = "#ffd700", shadow = true },
        btn({ id = "p_resume", x = 360, y = 180, w = 240, h = 40, text = "Resume", fontSize = 16, action = { type = "close" } }),
        btn({ id = "p_save", x = 360, y = 230, w = 240, h = 40, text = "Save", fontSize = 16, action = { type = "save" } }),
        btn({ id = "p_load", x = 360, y = 280, w = 240, h = 40, text = "Load", fontSize = 16, action = { type = "load" } }),
        btn({ id = "p_title", x = 360, y = 360, w = 240, h = 40, text = "Title Screen", fontSize = 16, action = { type = "title" } }),
      } },
    }
  }
end

function L.ensure(cfg)
  cfg.ui = cfg.ui or {}
  local d = L.default(cfg)
  cfg.ui.layout = cfg.ui.layout or d
  local Lt = cfg.ui.layout
  Lt.screens = Lt.screens or {}
  for _, k in ipairs({ "title", "hud" }) do if not Lt.screens[k] then Lt.screens[k] = d.screens[k] end end
  for _, s in pairs(Lt.screens) do s.elements = s.elements or {} end
  return Lt
end

local function inside(e, x, y) return x >= e.x and x <= e.x + e.w and y >= e.y and y <= e.y + e.h end
L.inside = inside

-- ctx: B, cfg, ui, getImage, drawFull, drawPart, textW, state(), condsOk(list), vars(), exits(),
--      volume(target), setVolume(target, v), env(), doAction(action, el), plugins (optional)
function L.new(ctx)
  local self = {}
  local B, ui = ctx.B, ctx.ui
  ui.menus = ui.menus or {}
  ui.groups = ui.groups or {}

  local function screens() return L.ensure(ctx.cfg).screens end
  function self.setPlugins(p) ctx.plugins = p end
  function self.screen(id) return screens()[id] end
  function self.groupShown(g) return ui.groups[g] ~= false end

  function self.active()
    local S = ctx.state()
    local ids = { (S and S.mode == "play") and "hud" or "title" }
    for _, m in ipairs(ui.menus) do if screens()[m] then ids[#ids + 1] = m end end
    return ids
  end

  function self.visible(el, env)
    if el.group and el.group ~= "" then
      local neg = el.group:sub(1, 1) == "!"
      local g = neg and el.group:sub(2) or el.group
      if self.groupShown(g) == neg then return false end
    end
    if el.when and el.when ~= "" and not (env or ctx.env())[el.when] then return false end
    local S = ctx.state()
    if el["if"] and #el["if"] > 0 and S and S.mode == "play" and not ctx.condsOk(el["if"]) then return false end
    if ctx.plugins and not ctx.plugins.uiVisible(el) then return false end
    return true
  end

  function self.text(s)
    if not s or s == "" then return "" end
    local vars = ctx.vars()
    local S = ctx.state()
    return (tostring(s):gsub("{(%w+):?([^}]*)}", function(k, arg)
      if k == "flag" then return (S and S.flags and S.flags[arg]) and "1" or "0" end
      if k == "item" then
        if S and S.inv then for _, v in ipairs(S.inv) do if v == arg then return "1" end end end
        return "0"
      end
      if ctx.plugins then local v = ctx.plugins.uiVar(k, arg) if v ~= nil then return v end end
      if vars[k] ~= nil then return tostring(vars[k]) end
      return "{" .. k .. (arg ~= "" and (":" .. arg) or "") .. "}"
    end))
  end

  function self.exitRects(el)
    local list = ctx.exits()
    local n = #list
    if n == 0 then return {} end
    local gap = el.gap or 6
    local ih = math.min(el.itemH or 34, (el.h - gap * (n - 1)) / n)
    local r = {}
    for i, ex in ipairs(list) do r[i] = { x = el.x, y = el.y + (i - 1) * (ih + gap), w = el.w, h = ih, ex = ex } end
    return r
  end

  function self.hudLeft()
    local S = ctx.state()
    if not S or S.mode ~= "play" then return 0 end
    local s = screens().hud
    if not s then return 0 end
    local env, r = ctx.env(), 0
    for _, el in ipairs(s.elements) do
      if el.type == "panel" and el.x <= 5 and el.h >= VH * 0.6 and self.visible(el, env) then r = math.max(r, el.x + el.w) end
    end
    return r
  end

  -- ---------------------------------------------------------- drawing
  local function image(path, x, y, w, h, fit)
    local e = ctx.getImage(path)
    if not e then return false end
    if fit == "contain" then
      local s = math.min(w / e.aw, h / e.ah)
      local dw, dh = e.aw * s, e.ah * s
      ctx.drawFull(path, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    elseif fit == "cover" then
      local s = math.max(w / e.aw, h / e.ah)
      local sw, sh = w / s, h / s
      ctx.drawPart(path, (e.aw - sw) / 2, (e.ah - sh) / 2, sw, sh, x, y, w, h)
    else
      ctx.drawFull(path, x, y, w, h)
    end
    return true
  end
  self.image = image

  local function box(x, y, w, h, el, hover)
    local bg = col(el.bg)
    if bg then B.rect("fill", x, y, w, h, bg[1], bg[2], bg[3], bg[4]) end
    if el.image then image(el.image, x, y, w, h, el.fit) end
    if hover and (bg or el.image) then B.rect("fill", x, y, w, h, 255, 255, 255, 30) end
    local bc, bw = col(el.border), el.borderW or 0
    if bc and bw > 0 then B.rect("line", x + bw / 2, y + bw / 2, w - bw, h - bw, bc[1], bc[2], bc[3], bc[4], bw) end
  end

  local function label(t, x, y, w, h, el)
    if not t or t == "" then return end
    local size = el.fontSize or 13
    local tw = ctx.textW(t, size)
    local tx = el.align == "left" and (x + 8) or (x + (w - tw) / 2)
    local ty = y + (h - size) / 2
    local c = col(el.color) or { 255, 255, 255, 255 }
    if el.shadow then B.text(t, tx + 2, ty + 2, size, 0, 0, 0, 200) end
    B.text(t, tx, ty, size, c[1], c[2], c[3], c[4])
  end

  function self.drawEl(el, editing)
    local hover = not editing and el.action and el.action.type and el.action.type ~= "none" and ui.cursor and inside(el, ui.mx, ui.my)
    if el.type == "exits" then
      local rects = self.exitRects(el)
      if editing and #rects == 0 then
        B.rect("line", el.x, el.y, el.w, el.h, 255, 215, 0, 200, 1)
        label("(exit buttons)", el.x, el.y, el.w, el.h, el)
      end
      for _, r in ipairs(rects) do
        box(r.x, r.y, r.w, r.h, el, not editing and ui.cursor and inside(r, ui.mx, ui.my))
        label(r.ex.text, r.x, r.y, r.w, r.h, el)
      end
    elseif el.type == "slider" then
      local bg = col(el.bg)
      if bg then B.rect("fill", el.x, el.y, el.w, el.h, bg[1], bg[2], bg[3], bg[4]) end
      local v = ctx.volume(el.target)
      local f = col(el.fill) or { 139, 0, 0, 180 }
      B.rect("fill", el.x, el.y, el.w * v, el.h, f[1], f[2], f[3], f[4])
      box(el.x, el.y, el.w, el.h, { border = el.border, borderW = el.borderW }, false)
      label(self.text(el.text), el.x, el.y, el.w, el.h, el)
    else
      box(el.x, el.y, el.w, el.h, el, hover)
      label(self.text(el.text), el.x, el.y, el.w, el.h, el)
      if el.editorHold and ui.press and ui.press.el == el then
        local f = math.min(1, (B.time() - ui.press.t) / 0.8)
        B.rect("fill", el.x + 4, el.y + el.h - 8, (el.w - 8) * f, 5, 0, 160, 0, 255)
      end
    end
    if ctx.plugins then ctx.plugins.hook("uiDrawElement", el) end
  end

  function self.drawTitleBg(s)
    B.rect("fill", 0, 0, VW, VH, 0, 0, 0, 255)
    image(s.bgImage or ctx.cfg.titleScreen.backgroundImage, 0, 0, VW, VH, "cover")
  end

  -- ids: list of screen ids (default: the active ones); all = draw hidden elements too (editor)
  function self.draw(ids, all)
    local env = ctx.env()
    for _, id in ipairs(ids or self.active()) do
      local s = screens()[id]
      if s then
        if id == "title" then self.drawTitleBg(s)
        elseif s.dim and s.dim > 0 then B.rect("fill", 0, 0, VW, VH, 0, 0, 0, math.floor(255 * s.dim)) end
        if id ~= "title" and s.bgImage then image(s.bgImage, 0, 0, VW, VH, "cover") end
        for _, el in ipairs(s.elements) do
          if all or self.visible(el, env) then self.drawEl(el, all) end
        end
      end
    end
  end

  -- ---------------------------------------------------------- input
  function self.hit(x, y)
    local env, ids = ctx.env(), self.active()
    for i = #ids, 1, -1 do
      local s = screens()[ids[i]]
      for j = #s.elements, 1, -1 do
        local el = s.elements[j]
        if self.visible(el, env) and inside(el, x, y) then return el, ids[i] end
      end
      if s.modal then return false, ids[i] end
    end
    return nil
  end

  -- true when the UI used the tap
  function self.pointerDown(x, y)
    local el = self.hit(x, y)
    if el == nil then return false end
    if el == false then return true end   -- modal menu: swallow
    if el.type == "slider" then
      ui.slider = el
      ctx.setVolume(el.target, (x - el.x) / el.w)
      return true
    end
    if el.type == "exits" then
      for _, r in ipairs(self.exitRects(el)) do
        if inside(r, x, y) then ctx.doAction({ type = "scene", target = r.ex.target }, el) break end
      end
      return true
    end
    if el.editorHold and ctx.cfg.allowDebug and not ui.debug then ui.press = { x = x, y = y, t = B.time(), el = el } end
    if el.action and el.action.type and el.action.type ~= "none" then ctx.doAction(el.action, el) end
    return true
  end
  function self.pointerMove(x, y)
    if ui.slider then ctx.setVolume(ui.slider.target, (x - ui.slider.x) / ui.slider.w) end
  end
  function self.pointerUp() ui.slider = nil end

  return self
end

return L
