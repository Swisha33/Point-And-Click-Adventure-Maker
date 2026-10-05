// =============================
// PLUGINS (browser engine + editor)
// A plugin is stored inside the project: cfg.plugins[id] = { name, version, description, author,
//   enabled, settings, web: "<JS module source>", lua: "<Lua source>" }
// so it travels with backups, the web project download and the Lua export
// (which writes plugins/<id>/game.lua for LÖVE / PS Vita).
//
// web code:   export default function (api) { ... }
// Lua code:   return function (api) ... end
// Both get the same API (see PLUGINS.md):
//   api.registerAction(type, spec, fn(act, hotspot))        new rule action
//   api.registerCondition(type, spec, fn(cond) -> bool)     new rule condition
//   api.registerUIAction(type, spec, fn(action, element))   new action for UI buttons
//   api.registerUIVar(name, fn(arg) -> string)              new {placeholder} for UI texts
//   api.on(hook, fn)   hooks: init, gameStart, sceneEnter(scene), update, drawWorld(ctx), drawUI(ctx),
//                      tap(x, y) -> true = handled, uiVisible(el) -> false = hide, uiDrawElement(ctx, el)
//   api.data           per-play-through table that is stored in save games
//   api.settings       the plugin's settings from the project
//   editor only: api.editor.addCommand(id, label, fn), api.editor.addPanel(title, build(container))
//   spec = { label, fields: [ { key: 'key' | 'value' | <any>, label, type: text|number|item|flag|level|screen|hotspot } ] }
// =============================
import { registerRuleType } from './rules-editor.js';
import { UI_ACTIONS } from './ui-layout.js';

export const PLUGIN_API_VERSION = 1;

export function createPluginHost(engine) {
    const host = {
        actions: {}, conds: {}, uiActions: {}, uiVars: {}, hooks: {}, commands: {}, panels: [],
        loaded: [], errors: [],
        uiActionSpecs: {},

        hook(name, ...args) {
            let res;
            for (const h of this.hooks[name] || []) {
                try { const r = h.fn(...args); if (r !== undefined && res === undefined) res = r; }
                catch (e) { this.fail(h.id, `${name}: ${e.message}`); }
            }
            return res;
        },
        // true when a plugin handled the rule action
        action(act, h) {
            const a = this.actions[act.type]; if (!a) return false;
            try { a.fn(act, h); } catch (e) { this.fail(a.id, `action ${act.type}: ${e.message}`); }
            return true;
        },
        // undefined when no plugin knows the condition type
        cond(c) {
            const k = this.conds[c.type]; if (!k) return undefined;
            try { return !!k.fn(c); } catch (e) { this.fail(k.id, `condition ${c.type}: ${e.message}`); return true; }
        },
        uiAction(type, action, el) {
            const a = this.uiActions[type]; if (!a) return false;
            try { a.fn(action, el); } catch (e) { this.fail(a.id, `ui action ${type}: ${e.message}`); }
            return true;
        },
        uiVar(name, arg) {
            const v = this.uiVars[name]; if (!v) return undefined;
            try { const r = v.fn(arg); return r === undefined || r === null ? '' : String(r); } catch (e) { return '?'; }
        },
        uiVisible(el) {
            for (const h of this.hooks.uiVisible || []) { try { if (h.fn(el) === false) return false; } catch (e) {} }
            return true;
        },
        fail(id, msg) {
            const m = `Plugin "${id}": ${msg}`;
            if (!this.errors.includes(m)) { this.errors.push(m); console.error(m); }
        },

        makeApi(id, p) {
            const self = this;
            const reg = (map, kind) => (type, spec, fn) => {
                if (typeof spec === 'function') { fn = spec; spec = {}; }
                map[type] = { id, fn, spec: spec || {} };
                if (kind) registerRuleType(kind, type, (spec && spec.label) || type, (spec && spec.fields) || [{ key: 'key', label: 'key', type: 'text' }]);
            };
            const api = {
                id, version: PLUGIN_API_VERSION, engine, settings: p.settings || (p.settings = {}),
                get data() { const a = engine.adv; if (!a) return {}; a.plugins = a.plugins || {}; return a.plugins[id] || (a.plugins[id] = {}); },
                registerAction: reg(this.actions, 'action'),
                registerCondition: reg(this.conds, 'cond'),
                registerUIAction(type, spec, fn) {
                    if (typeof spec === 'function') { fn = spec; spec = {}; }
                    self.uiActions[type] = { id, fn, spec: spec || {} };
                    self.uiActionSpecs[type] = spec || {};
                    UI_ACTIONS[type] = (spec && spec.label) || type;
                },
                registerUIVar(name, fn) { self.uiVars[name] = { id, fn }; },
                on(hook, fn) { (self.hooks[hook] || (self.hooks[hook] = [])).push({ id, fn }); },
                toast: (t) => engine.popup.toast(t),
                say: (text, speaker = 'knight') => engine.runSeq && engine.runSeq([{ say: { speaker, text } }]),
                state: () => ({ scene: engine.scene, dignity: engine.dignity, running: engine.isGameRunning, adv: engine.adv, knight: engine.knight }),
                setScene: (s) => engine.setScene(s),
                execActions: (list, h) => engine.execActions(list, h),
                condsOk: (list) => engine.condsOk(list),
                img: (path) => engine.img(path),
                editor: {
                    addCommand(cid, label, fn) { self.commands[cid] = { id, label, fn }; },
                    addPanel(title, build) { self.panels.push({ id, title, build }); }
                }
            };
            return api;
        },

        async loadAll() {
            const all = engine.gameConfig.plugins || {};
            for (const [id, p] of Object.entries(all)) {
                if (!p || p.enabled === false || !p.web) continue;
                const url = URL.createObjectURL(new Blob([p.web], { type: 'text/javascript' }));
                try {
                    const mod = await import(url);
                    const init = mod.default || mod.init;
                    if (typeof init !== 'function') throw new Error('web code has no "export default function (api)"');
                    await init(this.makeApi(id, p));
                    this.loaded.push(id);
                } catch (e) { this.fail(id, e.message); }
                finally { URL.revokeObjectURL(url); }
            }
            this.hook('init');
        }
    };
    return host;
}

// ---- plugin packages: a .zip with plugin.json (+ web.js / game.lua files) or a single .json bundle
export async function readPluginFile(file) {
    let manifest, files = {};
    if (/\.zip$/i.test(file.name)) {
        if (!window.JSZip) throw new Error('JSZip missing');
        const zip = await JSZip.loadAsync(file);
        const entry = Object.values(zip.files).find(f => /(^|\/)plugin\.json$/.test(f.name));
        if (!entry) throw new Error('plugin.json not found in the zip');
        const base = entry.name.slice(0, entry.name.length - 'plugin.json'.length);
        manifest = JSON.parse(await entry.async('string'));
        for (const key of ['web', 'lua']) {
            const fn = manifest[key] || (key === 'web' ? 'web.js' : 'game.lua');
            const f = zip.file(base + fn);
            if (f) files[key] = await f.async('string');
        }
    } else {
        manifest = JSON.parse(await file.text());
        files = { web: manifest.webCode || manifest.web_source, lua: manifest.luaCode || manifest.lua_source };
    }
    return pluginFromManifest(manifest, files);
}
export function pluginFromManifest(m, files) {
    if (!m || !m.id || !/^[a-z0-9_]+$/i.test(m.id)) throw new Error('plugin.json needs an "id" (letters, digits, _)');
    return {
        id: m.id,
        data: {
            name: m.name || m.id, version: m.version || '1.0', description: m.description || '', author: m.author || '',
            enabled: true, settings: Object.assign({}, m.settings || {}),
            web: files.web || '', lua: files.lua || ''
        }
    };
}
// examples shipped in plugins/ (listed in plugins/index.json)
export async function listBundledPlugins() {
    try { const r = await fetch('plugins/index.json'); if (!r.ok) return []; return (await r.json()).plugins || []; } catch (e) { return []; }
}
export async function loadBundledPlugin(dir) {
    const m = await (await fetch(`plugins/${dir}/plugin.json`)).json();
    const files = {};
    for (const key of ['web', 'lua']) {
        const fn = m[key] || (key === 'web' ? 'web.js' : 'game.lua');
        try { const r = await fetch(`plugins/${dir}/${fn}`); if (r.ok) files[key] = await r.text(); } catch (e) {}
    }
    return pluginFromManifest(m, files);
}
