# Plugins

Plugins add new features to the game **and** the editor without touching the engine.
One plugin can have two parts that do the same thing:

| file       | runs in                                   | format |
|------------|-------------------------------------------|--------|
| `web.js`   | browser game + web editor                 | ES module: `export default function (api) { … }` |
| `game.lua` | LÖVE (PC / Android) and PS Vita           | `return function(api) … end` |

A plugin is stored **inside the project** (`cfg.plugins[id]`), so it is part of backups, the web
download and the Lua export (`plugins/<id>/game.lua`). Install one in the editor:
Debug → **Plugins** → choose a `.zip` (or an example) → **APPLY** (saves + reloads).

## Package

```
myplugin/
  plugin.json
  web.js        (optional)
  game.lua      (optional)
```

```json
{
  "id": "myplugin",            // letters, digits, _  (also the Lua folder name)
  "name": "My plugin",
  "version": "1.0",
  "author": "you",
  "description": "What it does",
  "web": "web.js",
  "lua": "game.lua",
  "settings": { "anything": 1 }   // editable in the plugin manager, saved in the project
}
```

Zip the folder (or its contents). A single `.json` with `webCode` / `luaCode` strings works too.

## API (same names in JS and Lua)

| call | what it does |
|------|--------------|
| `api.registerAction(type, spec, fn(act, hotspot))` | new **rule action** (reactions, choices, UI buttons "Run rule actions") |
| `api.registerCondition(type, spec, fn(cond) → bool)` | new **condition** ("only if", element visibility) |
| `api.registerUIAction(type, spec, fn(action, element))` | new function for **UI buttons** |
| `api.registerUIVar(name, fn(arg) → string)` | new placeholder for UI texts: `{name}` or `{name:arg}` |
| `api.on(hook, fn)` | hooks, see below |
| `api.data` | table for this play-through – **stored in save games**, empty on a new game |
| `api.settings` | the plugin's settings (project) |
| `api.toast(text)`, `api.say(text, speaker)` | messages |
| `api.state()` | `{ scene, dignity, … }` (Lua: the engine state table) |
| `api.setScene(name)`, `api.execActions(list)`, `api.condsOk(list)` | use the engine |

`spec` (web only, Lua ignores it) describes the fields the editor shows:
`{ label: 'Counter: add', fields: [ { key: 'key', label: 'name', type: 'text' }, { key: 'value', type: 'number' } ] }`
Field types: `text`, `number`, `item`, `flag`, `level`, `screen`, `hotspot`.

### Hooks

| hook | when | |
|------|------|-|
| `init` | after all plugins are loaded | |
| `gameStart` | new game / load | |
| `sceneEnter(scene)` | level changed | |
| `update(dt)` | every frame while playing (web: no dt, 60 fps) | |
| `drawWorld(ctx)` | after the level, before the HUD (web: canvas 2D context; Lua: draw with `api.B`) | |
| `drawUI(ctx)` | above everything | |
| `title(ctx)` | on the title screen | |
| `tap(x, y)` | before the game handles a tap – return `true` to swallow it | |
| `uiVisible(el)` | return `false` to hide a UI element | |
| `uiDrawElement(ctx, el)` / Lua `uiDrawElement(el)` | after a UI element was drawn | |

### Editor (web)

```js
api.editor.addCommand('myCmd', 'Do my thing', () => { … });   // usable in custom debug quick-buttons
api.editor.addPanel('My panel', (container, engine) => { … }); // extra section in the debug panel
```

### On-device editor (Lua)

```lua
api.addEditorButton("MY TOOL", function() ... end)   -- EDITOR > PLUGINS
```

Lua drawing (`api.B`): `B.rect("fill"|"line", x, y, w, h, r, g, b, a, lineWidth)`, `B.circle(...)`,
`B.text(s, x, y, size, r, g, b, a)`, `api.drawImage(path, x, y, w, h, fit)`. Coordinates are always 960×540.

## Examples (`plugins/`)

- **counters** – number variables: actions *Counter: add / set*, conditions *at least / less than*,
  text `{var:coins}`, button action *Counter: add*. Values are kept in save games.
- **weather** – rain / snow per level (`settings.levels`), rule action *Weather*, an editor panel and
  a quick-button command for a preview; on the device: EDITOR > PLUGINS > WEATHER HERE.

## Tips

- Keep `web.js` and `game.lua` behaving the same – the browser is where you test, the device is where it ships.
- Errors in a plugin never stop the game: they are shown in the plugin manager (web) or as a message (Lua).
- Lua runs on LuaJIT (5.1). Avoid `goto`, integer division `//` and other 5.3-only syntax.
