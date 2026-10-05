-- Counters plugin - Lua part (LÖVE PC/Android, PS Vita). Same behaviour as web.js.
return function(api)
  local function vars()
    local d = api.data
    if not d.vars then
      d.vars = {}
      for k, v in pairs(api.settings.start or {}) do d.vars[k] = v end
    end
    return d.vars
  end
  local function num(v) return tonumber(v) or 0 end

  api.registerAction("addvar", function(act) vars()[act.key] = num(vars()[act.key]) + num(act.value) end)
  api.registerAction("setvar", function(act) vars()[act.key] = num(act.value) end)
  api.registerCondition("varmin", function(c) return num(vars()[c.key]) >= num(c.value) end)
  api.registerCondition("varless", function(c) return num(vars()[c.key]) < num(c.value) end)
  api.registerUIVar("var", function(name) local v = num(vars()[name]) return v == math.floor(v) and string.format("%d", v) or tostring(v) end)
  api.registerUIAction("addvar", function(a) vars()[a.key] = num(vars()[a.key]) + num(a.value) end)
  api.on("gameStart", function() vars() end)
end
