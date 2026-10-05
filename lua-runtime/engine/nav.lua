-- Walkable grid + A* pathfinding (same 12px grid as the web version).
local N = {}
N.CELL = 12
N.W, N.H = 960, 540
N.COLS = math.ceil(N.W / N.CELL)   -- 80
N.ROWS = math.ceil(N.H / N.CELL)   -- 45

-- grid[y][x] = true when walkable (1-based indices)
function N.allWalkable()
  local g = {}
  for y = 1, N.ROWS do
    local row = {}
    for x = 1, N.COLS do row[x] = true end
    g[y] = row
  end
  return g
end

-- Baked grid from the exporter: array of strings, "1" = walkable
function N.fromStrings(rows)
  local g = {}
  for y = 1, N.ROWS do
    local s = rows[y] or ""
    local row = {}
    for x = 1, N.COLS do row[x] = s:sub(x, x) == "1" end
    g[y] = row
  end
  return g
end

function N.toStrings(g)
  local out = {}
  for y = 1, N.ROWS do
    local t = {}
    for x = 1, N.COLS do t[x] = g[y][x] and "1" or "0" end
    out[y] = table.concat(t)
  end
  return out
end

-- Build from a sampling function: walkable(px, py) -> bool (screen space, 960x540)
function N.fromSampler(walkable)
  local g = {}
  local half = N.CELL / 2
  for y = 1, N.ROWS do
    local row = {}
    for x = 1, N.COLS do
      local px, py = (x - 1) * N.CELL + half, (y - 1) * N.CELL + half
      row[x] = (px < N.W and py < N.H) and walkable(px, py) or false
    end
    g[y] = row
  end
  return g
end

local function cellOf(px, py)
  return math.floor(px / N.CELL) + 1, math.floor(py / N.CELL) + 1
end
local function centerOf(cx, cy)
  return (cx - 1) * N.CELL + N.CELL / 2, (cy - 1) * N.CELL + N.CELL / 2
end
N.cellOf, N.centerOf = cellOf, centerOf

function N.isWalkable(g, px, py)
  if px < 0 or py < 0 or px >= N.W or py >= N.H then return false end
  local cx, cy = cellOf(px, py)
  return g[cy] and g[cy][cx] or false
end

-- Nearest walkable cell (spiral search like the original, radius up to 60 cells)
function N.nearest(g, px, py)
  local cx, cy = cellOf(px, py)
  if g[cy] and g[cy][cx] then return cx, cy end
  for r = 1, 60 do
    local best, bx, by = nil, nil, nil
    for dy = -r, r do
      for dx = -r, r do
        if math.abs(dx) == r or math.abs(dy) == r then
          local x, y = cx + dx, cy + dy
          if y >= 1 and y <= N.ROWS and x >= 1 and x <= N.COLS and g[y][x] then
            local d = dx * dx + dy * dy
            if not best or d < best then best, bx, by = d, x, y end
          end
        end
      end
    end
    if best then return bx, by end
  end
  return nil
end

-- Binary heap keyed by f
local function hpush(h, node, f)
  h.n = h.n + 1
  local i = h.n
  h.items[i], h.keys[i] = node, f
  while i > 1 do
    local p = math.floor(i / 2)
    if h.keys[p] <= h.keys[i] then break end
    h.items[p], h.items[i] = h.items[i], h.items[p]
    h.keys[p], h.keys[i] = h.keys[i], h.keys[p]
    i = p
  end
end
local function hpop(h)
  if h.n == 0 then return nil end
  local top = h.items[1]
  h.items[1], h.keys[1] = h.items[h.n], h.keys[h.n]
  h.items[h.n], h.keys[h.n] = nil, nil
  h.n = h.n - 1
  local i = 1
  while true do
    local l, r, s = i * 2, i * 2 + 1, i
    if l <= h.n and h.keys[l] < h.keys[s] then s = l end
    if r <= h.n and h.keys[r] < h.keys[s] then s = r end
    if s == i then break end
    h.items[s], h.items[i] = h.items[i], h.items[s]
    h.keys[s], h.keys[i] = h.keys[i], h.keys[s]
    i = s
  end
  return top
end

local DIRS = { {0,1,1}, {0,-1,1}, {1,0,1}, {-1,0,1}, {1,1,1.4142}, {1,-1,1.4142}, {-1,1,1.4142}, {-1,-1,1.4142} }

-- Returns list of {x=,y=} points in screen space, or nil
function N.findPath(g, sx, sy, ex, ey)
  local scx, scy = N.nearest(g, sx, sy)
  local ecx, ecy = N.nearest(g, ex, ey)
  if not scx or not ecx then return nil end
  local cols = N.COLS
  local function key(x, y) return (y - 1) * cols + x end
  local function heur(x, y) local dx, dy = x - ecx, y - ecy return math.sqrt(dx * dx + dy * dy) end

  local open = { items = {}, keys = {}, n = 0 }
  local gScore, came, closed = {}, {}, {}
  local sk = key(scx, scy)
  gScore[sk] = 0
  hpush(open, sk, heur(scx, scy))
  local ek = key(ecx, ecy)

  while open.n > 0 do
    local ck = hpop(open)
    if ck == ek then
      -- endpoint: the clicked spot if it's walkable, otherwise the nearest cell centre
      local endX, endY
      if N.isWalkable(g, ex, ey) then endX, endY = ex, ey else endX, endY = centerOf(ecx, ecy) end
      local path = { { x = endX, y = endY } }
      local k = came[ck]
      while k do
        local x = (k - 1) % cols + 1
        local y = math.floor((k - 1) / cols) + 1
        local px, py = centerOf(x, y)
        table.insert(path, 1, { x = px, y = py })
        k = came[k]
      end
      return path
    end
    if not closed[ck] then
      closed[ck] = true
      local cx = (ck - 1) % cols + 1
      local cy = math.floor((ck - 1) / cols) + 1
      local cg = gScore[ck]
      for i = 1, 8 do
        local d = DIRS[i]
        local nx, ny = cx + d[1], cy + d[2]
        if nx >= 1 and nx <= cols and ny >= 1 and ny <= N.ROWS and g[ny][nx] then
          -- no corner cutting through walls
          if d[3] == 1 or (g[cy][nx] and g[ny][cx]) then
            local nk = key(nx, ny)
            local tg = cg + d[3]
            if not closed[nk] and (gScore[nk] == nil or tg < gScore[nk]) then
              gScore[nk] = tg
              came[nk] = ck
              hpush(open, nk, tg + heur(nx, ny))
            end
          end
        end
      end
    end
  end
  return nil
end

return N
