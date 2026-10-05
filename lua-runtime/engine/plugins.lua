-- Plugin host for the Lua runtime (LÖVE PC/Android + PS Vita).
-- The editor's Lua export writes every enabled plugin to plugins/<id>/game.lua;
-- cfg.plugins[id] = { name, version, enabled, settings }.
-- A plugin file returns  function(api) ... end  (same API as the browser, see PLUGINS.md):
--   api.registerAction(type, fn(act, hotspot))       rule action
--   api.registerCondition(type, fn(cond) -> bool)    rule condition
--   api.registerUIAction(type, fn(action, element))  action for UI buttons
--   api.registerUIVar(name, fn(arg) -> string)       {placeholder} in UI texts
--   api.on(hook, fn)  init, gameStart, sceneEnter(scene), update(dt), drawWorld, drawUI, title,
--                     tap(x, y) -> true = handled, uiVisible(el) -> false = hide, uiDrawElement(el)
--   api.data          per-play-through table, stored in save games
--   api.settings      the plugin's settings
--   api.B             drawing / sound backend (B.rect, B.text, B.drawImage ...)
--   api.addEditorButton(label, fn)   extra button in the on-device editor
local P = {}

function P.new(engine)
  local host = { actions = {}, conds = {}, uiActions = {}, uiVars = {}, hooks = {}, editorButtons = {}, loaded = {}, errors = {} }

  local function fail(id, msg)
    local m = "Plugin " .. tostring(id) .. ": " .. tostring(msg)
    host.errors[#host.errors + 1] = m
    if print then print(m) end
    if engine.toast then engine.toast(m) end
  end
  host.fail = fail

  function host.hook(name, ...)
    local res
    for _, h in ipairs(host.hooks[name] or {}) do
      local ok, r = pcall(h.fn, ...)
      if not ok then fail(h.id, name .. ": " .. tostring(r))
      elseif r ~= nil and res == nil then res = r end
    end
    return res
  end
  function host.action(act, h)
    local a = host.actions[act.type]
    if not a then return false end
    local ok, err = pcall(a.fn, act, h)
    if not ok then fail(a.id, "action " .. act.type .. ": " .. tostring(err)) end
    return true
  end
  function host.cond(c)
    local k = host.conds[c.type]
    if not k then return nil end
    local ok, r = pcall(k.fn, c)
    if not ok then fail(k.id, "condition " .. c.type .. ": " .. tostring(r)) return true end
    return r and true or false
  end
  function host.uiAction(t, action, el)
    local a = host.uiActions[t]
    if not a then return false end
    local ok, err = pcall(a.fn, action, el)
    if not ok then fail(a.id, "ui action " .. t .. ": " .. tostring(err)) end
    return true
  end
  function host.uiVar(name, arg)
    local v = host.uiVars[name]
    if not v then return nil end
    local ok, r = pcall(v.fn, arg)
    if not ok then return "?" end
    return r == nil and "" or tostring(r)
  end
  function host.uiVisible(el)
    for _, h in ipairs(host.hooks.uiVisible or {}) do
      local ok, r = pcall(h.fn, el)
      if ok and r == false then return false end
    end
    return true
  end

  local function makeApi(id, p)
    p.settings = p.settings or {}
    local api = { id = id, version = 1, settings = p.settings, B = engine.B, cfg = engine.cfg }
    local function reg(map) return function(t, a, b) local fn = type(a) == "function" and a or b map[t] = { id = id, fn = fn } end end
    api.registerAction = reg(host.actions)
    api.registerCondition = reg(host.conds)
    api.registerUIAction = reg(host.uiActions)
    function api.registerUIVar(name, fn) host.uiVars[name] = { id = id, fn = fn } end
    function api.on(hook, fn) host.hooks[hook] = host.hooks[hook] or {} table.insert(host.hooks[hook], { id = id, fn = fn }) end
    function api.addEditorButton(label, fn) host.editorButtons[#host.editorButtons + 1] = { id = id, label = label, fn = fn } end
    setmetatable(api, { __index = function(_, k)
      if k == "data" then
        local S = engine.state()
        if not S or not S.plugins then return {} end
        S.plugins[id] = S.plugins[id] or {}
        return S.plugins[id]
      end
      return engine.api[k]    -- toast, say, state, setScene, execActions, condsOk, getImage, drawImage ...
    end })
    return api
  end

  function host.loadAll()
    local list = engine.cfg.plugins or {}
    local ids = {}
    for id in pairs(list) do ids[#ids + 1] = id end
    table.sort(ids)
    for _, id in ipairs(ids) do
      local p = list[id]
      if type(p) == "table" and p.enabled ~= false then
        local ok, mod = pcall(require, "plugins." .. id .. ".game")
        if not ok then fail(id, mod)
        elseif type(mod) ~= "function" then fail(id, "game.lua must return function(api)")
        else
          local ok2, err = pcall(mod, makeApi(id, p))
          if ok2 then host.loaded[#host.loaded + 1] = id else fail(id, err) end
        end
      end
    end
    host.hook("init")
  end

  return host
end

return P
