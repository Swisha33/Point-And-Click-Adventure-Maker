-- Small helpers shared by the engine. Works on LuaJIT (LÖVE) and Lua 5.3 (lpp-vita).
local U = {}

local loadstr = loadstring or load

function U.deepcopy(v, seen)
  if type(v) ~= "table" then return v end
  seen = seen or {}
  if seen[v] then return seen[v] end
  local t = {}
  seen[v] = t
  for k, x in pairs(v) do
    -- keys starting with "_" are runtime-only (caches, timers) and never copied
    if not (type(k) == "string" and k:sub(1, 1) == "_") then
      t[U.deepcopy(k, seen)] = U.deepcopy(x, seen)
    end
  end
  return t
end

function U.clamp(v, a, b) if v < a then return a elseif v > b then return b end return v end
function U.dist(ax, ay, bx, by) local dx, dy = ax - bx, ay - by return math.sqrt(dx * dx + dy * dy) end
function U.round(v) return math.floor(v + 0.5) end

-- Load a Lua data file ("return { ... }") from a string without giving it access to globals.
function U.loadTable(src, name)
  if not src then return nil, "no data" end
  local fn, err
  if setfenv then
    fn, err = loadstr(src, name or "data")
    if fn then setfenv(fn, {}) end
  else
    fn, err = load(src, name or "data", "t", {})
  end
  if not fn then return nil, err end
  local ok, res = pcall(fn)
  if not ok then return nil, res end
  return res
end

-- Serialize a plain table back to Lua source (used by the in-game debug "save").
local function isIdent(s) return type(s) == "string" and s:match("^[%a_][%w_]*$") ~= nil end
local keywords = { ["and"]=1, ["break"]=1, ["do"]=1, ["else"]=1, ["elseif"]=1, ["end"]=1, ["false"]=1,
  ["for"]=1, ["function"]=1, ["goto"]=1, ["if"]=1, ["in"]=1, ["local"]=1, ["nil"]=1, ["not"]=1, ["or"]=1,
  ["repeat"]=1, ["return"]=1, ["then"]=1, ["true"]=1, ["until"]=1, ["while"]=1 }

local function ser(v, indent, out)
  local tv = type(v)
  if tv == "string" then out[#out + 1] = string.format("%q", v)
  elseif tv == "number" then
    if v ~= v or v == math.huge or v == -math.huge then out[#out + 1] = "0"
    elseif v == math.floor(v) and math.abs(v) < 1e15 then out[#out + 1] = string.format("%d", v)
    else out[#out + 1] = string.format("%.6g", v) end
  elseif tv == "boolean" then out[#out + 1] = tostring(v)
  elseif tv == "table" then
    local n = #v
    local keys = {}
    for k in pairs(v) do
      if not (type(k) == "number" and k >= 1 and k <= n and k == math.floor(k)) then
        if not (type(k) == "string" and k:sub(1, 1) == "_") then keys[#keys + 1] = k end
      end
    end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    if n == 0 and #keys == 0 then out[#out + 1] = "{}" return end
    local ind2 = indent .. "  "
    out[#out + 1] = "{\n"
    for i = 1, n do out[#out + 1] = ind2; ser(v[i], ind2, out); out[#out + 1] = ",\n" end
    for _, k in ipairs(keys) do
      out[#out + 1] = ind2
      if isIdent(k) and not keywords[k] then out[#out + 1] = k
      else out[#out + 1] = "["; ser(k, ind2, out); out[#out + 1] = "]" end
      out[#out + 1] = " = "
      ser(v[k], ind2, out)
      out[#out + 1] = ",\n"
    end
    out[#out + 1] = indent .. "}"
  else out[#out + 1] = "nil" end
end

function U.serialize(v)
  local out = { "return " }
  ser(v, "", out)
  out[#out + 1] = "\n"
  return table.concat(out)
end

-- Count UTF-8 characters (for the simple word wrap fallback).
function U.ulen(s)
  local _, n = s:gsub("[^\128-\191]", "")
  return n
end

-- Word wrap using a measure function (returns pixel width).
function U.wrap(text, maxW, measure)
  local lines, line = {}, ""
  for word in tostring(text):gmatch("%S+") do
    local test = (line == "") and word or (line .. " " .. word)
    if measure(test) > maxW and line ~= "" then
      lines[#lines + 1] = line
      line = word
    else
      line = test
    end
  end
  if line ~= "" then lines[#lines + 1] = line end
  if #lines == 0 then lines[1] = "" end
  return lines
end

return U
