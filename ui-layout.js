// =============================
// CUSTOMIZABLE GAME UI (browser engine)
// The title screen, the in-game HUD and any number of menu screens are plain data
// in cfg.ui.layout and are drawn on the canvas. The Lua engine (lua-runtime/engine/layout.lua)
// draws and handles exactly the same data, so a layout made in the editor looks and works
// the same on PC, Android and PS Vita.
//
// cfg.ui.layout = { screens: { title: Screen, hud: Screen, <id>: Screen ... } }
// Screen  = { name, modal, dim (0..1), bgImage, elements: [Element] }
//   title  = shown on the title screen, hud = shown while playing, others = menus opened by buttons
// Element = { id, type, x, y, w, h,
//   text        "Dignity: {dignity}"  - placeholders: {dignity} {scene} {title} {start} {lick} {mute}
//               {music} {sfx} {items} {flag:name}
//   fontSize, color, bg, border, borderW    colours "#rrggbb" or "#rrggbbaa", "" = none
//   image, fit  picture drawn into the element box: stretch | contain | cover
//   align       center | left
//   shadow      text shadow
//   action      { type, target, screen, group, actions:[rule actions], ... }  (see UI_ACTIONS)
//   group       elements of a group can be shown/hidden with the "toggle" action; "!name" = only when hidden
//   when        '' | hasSave | canFullscreen | titleText | muted | unmuted | debugAllowed | running
//   if          [conditions] like the adventure rules (flag / noflag / item / noitem)
//   editorHold  holding this element for 0.8 s opens the hidden editor (if allowed)
//   exits:  itemH, gap      slider: target (music | sfx | amb), label }
// =============================
const VW = 960, VH = 540;

export const UI_TYPES = {
    button: 'Button', label: 'Text', image: 'Picture', panel: 'Panel (box)',
    exits: 'Exit buttons (auto)', slider: 'Volume slider'
};
export const UI_ACTIONS = {
    none: 'Nothing', start: 'Start new game', continue: 'Continue (latest save)',
    save: 'Save menu', load: 'Load menu', title: 'Back to title screen',
    scene: 'Go to scene…', menu: 'Open menu screen…', close: 'Close this menu',
    toggle: 'Show / hide group…', mute: 'Mute / unmute', fullscreen: 'Fullscreen',
    lick: 'Lick (level lick)', rules: 'Run rule actions…', debug: 'Open editor', quit: 'Quit game'
};
export const UI_WHEN = {
    '': 'Always', hasSave: 'Save game exists', canFullscreen: 'Fullscreen possible',
    titleText: 'Title text switched on', muted: 'Sound muted', unmuted: 'Sound on',
    debugAllowed: 'Editor allowed', running: 'Game running'
};

const btn = (o) => Object.assign({ type: 'button', fontSize: 13, color: '#ffd700', bg: '#8b0000', border: '#ffd700', borderW: 2 }, o);

export function defaultLayout(cfg) {
    const box = (cfg && cfg.ui && cfg.ui.panelBox) || 'assets/uitext.png';
    return {
        screens: {
            title: {
                name: 'Title screen', elements: [
                    { id: 't_title', type: 'label', x: 0, y: 290, w: 960, h: 50, text: '{title}', fontSize: 34, color: '#ffd700', shadow: true, when: 'titleText' },
                    btn({ id: 't_start', x: 280, y: 352, w: 400, h: 76, text: '{start}', fontSize: 30, borderW: 5, action: { type: 'start' } }),
                    btn({ id: 't_cont', x: 280, y: 438, w: 195, h: 40, text: 'Continue', fontSize: 16, action: { type: 'continue' }, when: 'hasSave' }),
                    btn({ id: 't_load', x: 485, y: 438, w: 195, h: 40, text: 'Load Game', fontSize: 16, action: { type: 'load' }, when: 'hasSave' }),
                    btn({ id: 't_fs', x: 380, y: 490, w: 200, h: 36, text: 'Fullscreen', fontSize: 15, color: '#ffffff', bg: '#333333', border: '#ffffff', action: { type: 'fullscreen' }, when: 'canFullscreen' })
                ]
            },
            hud: {
                name: 'Game HUD', elements: [
                    { id: 'h_panel', type: 'panel', x: 0, y: 0, w: 240, h: 540, bg: '#e6c9a8eb', border: '#6e5032', borderW: 3, group: 'side' },
                    { id: 'h_dignity', type: 'label', x: 10, y: 18, w: 220, h: 80, image: box, fit: 'stretch', text: 'Dignity: {dignity}', fontSize: 18, color: '#4e342e', editorHold: true, group: 'side' },
                    btn({ id: 'h_exits', type: 'exits', x: 10, y: 112, w: 220, h: 116, itemH: 34, gap: 6, group: 'side' }),
                    btn({ id: 'h_lick', x: 10, y: 236, w: 220, h: 34, text: '{lick}', action: { type: 'lick' }, group: 'side' }),
                    btn({ id: 'h_save', x: 10, y: 276, w: 106, h: 34, text: 'Save', action: { type: 'save' }, group: 'side' }),
                    btn({ id: 'h_load', x: 124, y: 276, w: 106, h: 34, text: 'Load', action: { type: 'load' }, group: 'side' }),
                    btn({ id: 'h_mute', x: 10, y: 316, w: 220, h: 34, text: '{mute}', action: { type: 'mute' }, group: 'side' }),
                    { id: 'h_music', type: 'slider', x: 10, y: 358, w: 220, h: 28, target: 'music', text: 'Music {music}%', fontSize: 12, color: '#4e342e', bg: '#00000026', border: '#4e342e', borderW: 1, fill: '#8b000066', group: 'side' },
                    { id: 'h_sfx', type: 'slider', x: 10, y: 392, w: 220, h: 28, target: 'sfx', text: 'SFX {sfx}%', fontSize: 12, color: '#4e342e', bg: '#00000026', border: '#4e342e', borderW: 1, fill: '#8b000066', group: 'side' },
                    btn({ id: 'h_fs', x: 10, y: 428, w: 220, h: 34, text: 'Fullscreen', action: { type: 'fullscreen' }, when: 'canFullscreen', group: 'side' }),
                    btn({ id: 'h_title', x: 10, y: 468, w: 220, h: 34, text: 'Title Screen', action: { type: 'title' }, group: 'side' }),
                    { id: 'h_tab', type: 'button', x: 240, y: 240, w: 24, h: 60, text: '<', fontSize: 14, color: '#ffffff', bg: '#444444e6', border: '#777777', borderW: 1, action: { type: 'toggle', group: 'side' }, group: 'side' },
                    { id: 'h_tab2', type: 'button', x: 0, y: 240, w: 24, h: 60, text: '>', fontSize: 14, color: '#ffffff', bg: '#8b0000e6', border: '#777777', borderW: 1, action: { type: 'toggle', group: 'side' }, group: '!side' }
                ]
            },
            pause: {
                name: 'Pause menu (example)', modal: true, dim: 0.55, elements: [
                    { id: 'p_box', type: 'panel', x: 330, y: 110, w: 300, h: 320, bg: '#1e1410ee', border: '#ffd700', borderW: 3 },
                    { id: 'p_head', type: 'label', x: 330, y: 125, w: 300, h: 40, text: 'Paused', fontSize: 26, color: '#ffd700', shadow: true },
                    btn({ id: 'p_resume', x: 360, y: 180, w: 240, h: 40, text: 'Resume', fontSize: 16, action: { type: 'close' } }),
                    btn({ id: 'p_save', x: 360, y: 230, w: 240, h: 40, text: 'Save', fontSize: 16, action: { type: 'save' } }),
                    btn({ id: 'p_load', x: 360, y: 280, w: 240, h: 40, text: 'Load', fontSize: 16, action: { type: 'load' } }),
                    btn({ id: 'p_title', x: 360, y: 360, w: 240, h: 40, text: 'Title Screen', fontSize: 16, action: { type: 'title' } })
                ]
            }
        }
    };
}

export function ensureLayout(cfg) {
    cfg.ui = cfg.ui || {};
    const d = defaultLayout(cfg);
    const L = cfg.ui.layout || (cfg.ui.layout = d);
    L.screens = L.screens || {};
    for (const k of ['title', 'hud']) if (!L.screens[k]) L.screens[k] = d.screens[k];
    for (const s of Object.values(L.screens)) s.elements = s.elements || [];
    return L;
}

export function newElementId(screen) {
    let i = (screen.elements || []).length + 1, id;
    do { id = 'e' + (i++) + Math.random().toString(36).slice(2, 5); } while (screen.elements.some(e => e.id === id));
    return id;
}

// "#rgb", "#rrggbb", "#rrggbbaa" -> css colour; '' / null -> null
export function cssColor(c) {
    if (!c || typeof c !== 'string' || c[0] !== '#') return null;
    if (c.length === 9) {
        const n = parseInt(c.slice(1), 16);
        return `rgba(${(n >>> 24) & 255},${(n >>> 16) & 255},${(n >>> 8) & 255},${((n & 255) / 255).toFixed(3)})`;
    }
    return c;
}

const FONT = (px) => `bold ${px}px 'Courier New', monospace`;
const inside = (e, x, y) => x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h;

// image fitted into a box (stretch | contain | cover) - shared by the engine and the editor preview
export function drawFitted(ctx, im, x, y, w, h, fit = 'stretch') {
    const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
    if (!iw || !ih) return;
    if (fit === 'contain') {
        const s = Math.min(w / iw, h / ih), dw = iw * s, dh = ih * s;
        ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else if (fit === 'cover') {
        const s = Math.max(w / iw, h / ih), sw = w / s, sh = h / s;
        ctx.drawImage(im, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
    } else ctx.drawImage(im, x, y, w, h);
}

// mixed into the engine object (game.js)
export const uiLayout = {
    uiInit() {
        this.ui = { menus: [], groups: {}, slider: null, press: null };
        ensureLayout(this.gameConfig);
    },
    layout() { return ensureLayout(this.gameConfig); },
    uiScreen(id) { return this.layout().screens[id]; },
    // screens drawn right now, bottom to top
    uiActiveScreens() {
        const ids = [this.isGameRunning ? 'hud' : 'title'];
        for (const m of this.ui.menus) if (this.uiScreen(m)) ids.push(m);
        return ids;
    },
    uiEnv() {
        return {
            hasSave: !!this.latestSave(), canFullscreen: !!document.fullscreenEnabled,
            titleText: this.gameConfig.titleScreen.showTitleText !== false && !!this.gameConfig.titleScreen.titleText,
            muted: !!this.isMuted, unmuted: !this.isMuted, debugAllowed: this.gameConfig.allowDebug !== false,
            running: !!this.isGameRunning
        };
    },
    groupShown(g) { return this.ui.groups[g] !== false; },
    uiVisible(el, env) {
        if (el.group) {
            const neg = el.group[0] === '!', g = neg ? el.group.slice(1) : el.group;
            if (this.groupShown(g) === neg) return false;
        }
        if (el.when && !(env || this.uiEnv())[el.when]) return false;
        if (el.if && el.if.length && this.adv && !this.condsOk(el.if)) return false;
        if (this.plugins && !this.plugins.uiVisible(el)) return false;
        return true;
    },
    uiText(s) {
        if (!s) return '';
        const c = this.gameConfig, a = this.adv || { inv: [], flags: {} };
        const lick = (c.levelLicks[this.scene] || c.lickConfig || {}).text || 'Lick';
        const vars = {
            dignity: this.dignity, scene: this.scene, title: c.titleScreen.titleText, start: c.titleScreen.startButtonText,
            lick, mute: this.isMuted ? 'UNMUTE' : 'MUTE', music: Math.round(this.musicVolume * 100),
            sfx: Math.round(this.sfxVolume * 100), amb: Math.round(this.ambVolume * 100), items: a.inv.length
        };
        return String(s).replace(/\{(\w+)(?::([^}]*))?\}/g, (m, k, arg) => {
            if (k === 'flag') return a.flags[arg] ? '1' : '0';
            if (k === 'item') return a.inv.includes(arg) ? '1' : '0';
            if (this.plugins) { const v = this.plugins.uiVar(k, arg); if (v !== undefined) return v; }
            return vars[k] !== undefined ? vars[k] : m;
        });
    },
    // exit buttons of the current scene (fixed exits + exits found in the game)
    uiExitList() {
        const l = (this.currentExits ? this.currentExits() : []);
        return l.map(ex => ({ text: ex.text || ('To ' + ex.target), target: ex.target }));
    },
    uiExitRects(el) {
        const list = this.uiExitList(); if (!list.length) return [];
        const gap = el.gap ?? 6;
        const ih = Math.min(el.itemH || 34, (el.h - gap * (list.length - 1)) / list.length);
        return list.map((ex, i) => ({ x: el.x, y: el.y + i * (ih + gap), w: el.w, h: ih, ex }));
    },
    // left edge the adventure UI (inventory, choices) should start at: right of a visible side bar
    hudLeft() {
        if (!this.isGameRunning) return 0;
        const s = this.uiScreen('hud'); if (!s) return 0;
        let r = 0; const env = this.uiEnv();
        for (const el of s.elements) if (el.type === 'panel' && el.x <= 5 && el.h >= VH * 0.6 && this.uiVisible(el, env)) r = Math.max(r, el.x + el.w);
        return r;
    },
    uiVolume(target) { return target === 'sfx' ? this.sfxVolume : target === 'amb' ? this.ambVolume : this.musicVolume; },
    uiSetVolume(target, v) {
        v = Math.max(0, Math.min(1, v));
        if (target === 'sfx') { this.sfxVolume = v; const c = this.audioCache.get('click'); if (c) c.volume = v; }
        else if (target === 'amb') { this.ambVolume = v; for (const [k, a] of this.audioCache) if (this.gameConfig.spawns[k]) a.volume = v; }
        else { this.musicVolume = v; const m = this.audioCache.get('music'); if (m) m.volume = v; }
    },

    // ---------- drawing ----------
    uiDraw(ctx, opts = {}) {
        const env = this.uiEnv();
        for (const id of (opts.screens || this.uiActiveScreens())) {
            const s = this.uiScreen(id); if (!s) continue;
            if (id === 'title') this.uiDrawTitleBg(ctx, s);
            else if (s.dim) { ctx.fillStyle = `rgba(0,0,0,${s.dim})`; ctx.fillRect(0, 0, VW, VH); }
            if (id !== 'title' && s.bgImage) { const im = this.img(s.bgImage); if (this.ready(im)) drawFitted(ctx, im, 0, 0, VW, VH, 'cover'); }
            for (const el of s.elements) if (opts.all || this.uiVisible(el, env)) this.uiDrawEl(ctx, el, opts.all);
        }
    },
    uiDrawTitleBg(ctx, s) {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH);
        const im = this.img(s.bgImage || this.gameConfig.titleScreen.backgroundImage);
        if (this.ready(im)) drawFitted(ctx, im, 0, 0, VW, VH, 'cover');
    },
    uiBox(ctx, x, y, w, h, el, hover) {
        const bg = cssColor(el.bg);
        if (bg) { ctx.fillStyle = bg; ctx.fillRect(x, y, w, h); }
        if (el.image) { const im = this.img(el.image); if (this.ready(im)) drawFitted(ctx, im, x, y, w, h, el.fit || 'stretch'); }
        if (hover && (bg || el.image)) { ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y, w, h); }
        const bc = cssColor(el.border), bw = el.borderW ?? 0;
        if (bc && bw > 0) { ctx.strokeStyle = bc; ctx.lineWidth = bw; ctx.strokeRect(x + bw / 2, y + bw / 2, w - bw, h - bw); }
    },
    uiLabel(ctx, text, x, y, w, h, el) {
        if (!text) return;
        const size = el.fontSize || 13;
        ctx.font = FONT(size); ctx.textBaseline = 'middle';
        const left = el.align === 'left';
        ctx.textAlign = left ? 'left' : 'center';
        const tx = left ? x + 8 : x + w / 2, ty = y + h / 2 + 1;
        if (el.shadow) { ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillText(text, tx + 2, ty + 2); }
        ctx.fillStyle = cssColor(el.color) || '#ffffff';
        ctx.fillText(text, tx, ty);
        ctx.textBaseline = 'alphabetic';
    },
    uiDrawEl(ctx, el, editing) {
        const hover = !editing && el.action && el.action.type && el.action.type !== 'none' && inside(el, this.mouseX, this.mouseY);
        ctx.save();
        if (el.type === 'exits') {
            const rects = this.uiExitRects(el);
            if (editing && !rects.length) { ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ffd700'; ctx.strokeRect(el.x, el.y, el.w, el.h); ctx.setLineDash([]); this.uiLabel(ctx, '(exit buttons)', el.x, el.y, el.w, el.h, el); }
            for (const r of rects) { this.uiBox(ctx, r.x, r.y, r.w, r.h, el, !editing && inside(r, this.mouseX, this.mouseY)); this.uiLabel(ctx, r.ex.text, r.x, r.y, r.w, r.h, el); }
        } else if (el.type === 'slider') {
            this.uiBox(ctx, el.x, el.y, el.w, el.h, Object.assign({}, el, { border: null }), false);
            const v = this.uiVolume(el.target);
            ctx.fillStyle = cssColor(el.fill) || 'rgba(139,0,0,0.7)'; ctx.fillRect(el.x, el.y, el.w * v, el.h);
            this.uiBox(ctx, el.x, el.y, el.w, el.h, { border: el.border, borderW: el.borderW }, false);
            this.uiLabel(ctx, this.uiText(el.text), el.x, el.y, el.w, el.h, el);
        } else {
            this.uiBox(ctx, el.x, el.y, el.w, el.h, el, hover);
            this.uiLabel(ctx, this.uiText(el.text), el.x, el.y, el.w, el.h, el);
            if (el.editorHold && this.ui.press && this.ui.press.el === el) {
                const f = Math.min(1, (performance.now() - this.ui.press.t) / 800);
                ctx.fillStyle = '#00a000'; ctx.fillRect(el.x + 4, el.y + el.h - 8, (el.w - 8) * f, 5);
            }
        }
        if (this.plugins) this.plugins.hook('uiDrawElement', ctx, el);
        ctx.restore();
    },

    // ---------- input ----------
    // element under the point, topmost first; a modal menu blocks everything below it
    uiHit(x, y) {
        const env = this.uiEnv(), ids = this.uiActiveScreens();
        for (let i = ids.length - 1; i >= 0; i--) {
            const s = this.uiScreen(ids[i]);
            for (let j = s.elements.length - 1; j >= 0; j--) {
                const el = s.elements[j];
                if (this.uiVisible(el, env) && inside(el, x, y)) return { el, screen: ids[i] };
            }
            if (s.modal) return { el: null, screen: ids[i], modal: true };
        }
        return null;
    },
    // returns true when the UI used the tap
    uiPointerDown(x, y) {
        const hit = this.uiHit(x, y); if (!hit) return false;
        const el = hit.el; if (!el) return true;
        if (el.type === 'slider') { this.ui.slider = el; this.uiSetVolume(el.target, (x - el.x) / el.w); return true; }
        if (el.type === 'exits') {
            const r = this.uiExitRects(el).find(q => inside(q, x, y));
            if (r) this.uiDo({ type: 'scene', target: r.ex.target }, el);
            return true;
        }
        if (el.editorHold && this.gameConfig.allowDebug !== false && !this.debugMode) {
            this.ui.press = { el, x, y, t: performance.now() };
            clearTimeout(this._holdTimer);
            this._holdTimer = setTimeout(() => { if (this.ui.press && this.ui.press.el === el) { this.ui.press = null; this.toggleDebugMenu(); } }, 800);
        }
        if (el.action && el.action.type && el.action.type !== 'none') this.uiDo(el.action, el);
        return true;
    },
    uiPointerMove(x, y) {
        if (this.ui.slider) this.uiSetVolume(this.ui.slider.target, (x - this.ui.slider.x) / this.ui.slider.w);
        if (this.ui.press && Math.hypot(this.ui.press.x - x, this.ui.press.y - y) > 25) this.ui.press = null;
    },
    uiPointerUp() { this.ui.slider = null; this.ui.press = null; },

    doLick() {
        if (this.gameOverTimer || !this.isGameRunning) return;
        if (this.adv && this.adv.seq) return;
        const l = this.gameConfig.levelLicks[this.scene] || this.gameConfig.lickConfig;
        this.runSeq([{ say: { speaker: 'knight', text: l.response } }, { actions: [{ type: 'dignity', value: l.dignityChange }] }]);
    },
    uiDo(action, el) {
        const t = action.type, c = this.gameConfig;
        if (this.plugins && this.plugins.uiAction(t, action, el)) return;
        switch (t) {
            case 'start': this.ui.menus = []; this.startGame(); break;
            case 'continue': { const l = this.latestSave(); if (l) { this.ui.menus = []; this.loadGame(l.slot); } break; }
            case 'save': if (this.isGameRunning) this.saveMenu('save'); break;
            case 'load': this.saveMenu('load'); break;
            case 'title': this.ui.menus = []; if (this.isGameRunning) this.backToTitle(); break;
            case 'scene': if (action.target && c.spawns[action.target]) {
                this.ui.menus = [];
                if (!this.isGameRunning) this.startGame();
                this.setScene(action.target);
            } break;
            case 'menu': if (action.screen && this.uiScreen(action.screen) && !['title', 'hud'].includes(action.screen)) {
                this.ui.menus = this.ui.menus.filter(m => m !== action.screen); this.ui.menus.push(action.screen);
            } break;
            case 'close': this.ui.menus.pop(); break;
            case 'toggle': if (action.group) this.ui.groups[action.group] = !this.groupShown(action.group); break;
            case 'mute': this.toggleMute(); break;
            case 'fullscreen': this.toggleFullscreen(); break;
            case 'lick': this.doLick(); break;
            case 'rules': if (this.isGameRunning && action.actions) this.execActions(action.actions, null); break;
            case 'debug': if (c.allowDebug !== false) this.toggleDebugMenu(); break;
            case 'quit': this.ui.menus = []; if (this.isGameRunning) this.backToTitle(); break;
        }
    }
};
