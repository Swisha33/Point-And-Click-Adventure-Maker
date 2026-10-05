// =============================
// UI LAYOUT EDITOR (browser editor)
// Edit the title screen, the in-game HUD and menu screens directly on the canvas:
// drag = move, handles = resize, properties in the debug panel.
// Mixed into the engine object by game.js.
// =============================
import { el, makeCtx, actionsEditor, condsEditor } from './rules-editor.js';
import { readPluginFile, listBundledPlugins, loadBundledPlugin } from './plugins.js';
import { UI_TYPES, UI_ACTIONS, UI_WHEN, defaultLayout, ensureLayout, newElementId, drawFitted } from './ui-layout.js';

const VW = 960, VH = 540;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const opt = (v, l, sel) => el('option', { value: v, selected: v === sel }, l);

// colour input that also keeps the alpha part of "#rrggbbaa"
function colorInput(value, onchange, allowNone = true) {
    const v = value || '';
    const rgb = v.length >= 7 ? v.slice(0, 7) : '#000000';
    const alpha = v.length === 9 ? parseInt(v.slice(7), 16) / 255 : 1;
    const none = el('input', { type: 'checkbox', checked: !v, title: 'none' });
    const c = el('input', { type: 'color', value: rgb });
    const a = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: alpha, title: 'opacity' });
    const emit = () => {
        if (none.checked) return onchange('');
        const al = parseFloat(a.value);
        onchange(al >= 0.999 ? c.value : c.value + Math.round(al * 255).toString(16).padStart(2, '0'));
    };
    c.oninput = () => { none.checked = false; emit(); }; a.oninput = () => { none.checked = false; emit(); }; none.onchange = emit;
    return el('span', { class: 'ui-color' }, [c, a, allowNone ? el('label', { class: 'ui-none' }, [none, 'none']) : null]);
}

export const uiEditor = {
    uiEdit: null,      // { screen, sel, drag, snap }

    uiEditStart(screen) {
        ensureLayout(this.gameConfig);
        this.uiEdit = { screen: screen || (this.isGameRunning ? 'hud' : 'title'), sel: null, drag: null, snap: 5 };
        this.editEnabled = false; this.deleteMode = false; this.editMode = false; this.placeMode = null;
        this.updateUI();
    },
    uiEditStop() { this.uiEdit = null; this.updateUI(); },
    uiEditScreen() { return this.uiEdit && this.layout().screens[this.uiEdit.screen]; },
    uiSel() { const s = this.uiEditScreen(); return s && s.elements.find(e => e.id === this.uiEdit.sel); },

    // ---------- canvas ----------
    uiEditDraw(ctx) {
        const s = this.uiEditScreen(); if (!s) return;
        const id = this.uiEdit.screen;
        if (id === 'title') this.uiDrawTitleBg(ctx, s);
        else if (!this.isGameRunning) { ctx.fillStyle = '#2a2a2a'; ctx.fillRect(0, 0, VW, VH); }
        if (id !== 'title' && id !== 'hud') {
            this.uiDraw(ctx, { screens: ['hud'] });       // a menu is shown above the HUD
            if (s.dim) { ctx.fillStyle = `rgba(0,0,0,${s.dim})`; ctx.fillRect(0, 0, VW, VH); }
            if (s.bgImage) { const im = this.img(s.bgImage); if (this.ready(im)) drawFitted(ctx, im, 0, 0, VW, VH, 'cover'); }
        }
        const env = this.uiEnv();
        for (const e of s.elements) {
            ctx.save();
            if (!this.uiVisible(e, env)) ctx.globalAlpha = 0.45;    // hidden right now (group / condition)
            this.uiDrawEl(ctx, e, true);
            ctx.restore();
            ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(0,255,0,0.45)'; ctx.lineWidth = 1;
            ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1); ctx.restore();
        }
        const sel = this.uiSel();
        if (sel) {
            ctx.save(); ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 2; ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
            ctx.fillStyle = '#00ff00';
            for (const h of HANDLES) { const p = this.uiHandlePos(sel, h); ctx.fillRect(p.x - 5, p.y - 5, 10, 10); }
            ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.font = "bold 11px 'Courier New', monospace";
            const info = `${sel.x},${sel.y}  ${sel.w}×${sel.h}`;
            const ty = sel.y > 18 ? sel.y - 16 : sel.y + sel.h + 2;
            ctx.fillRect(sel.x, ty, ctx.measureText(info).width + 8, 14);
            ctx.fillStyle = '#0f0'; ctx.textAlign = 'left'; ctx.fillText(info, sel.x + 4, ty + 11);
            ctx.restore();
        }
        ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(VW - 400, 0, 352, 20);
        ctx.fillStyle = '#0f0'; ctx.font = "bold 12px 'Courier New', monospace"; ctx.textAlign = 'right';
        ctx.fillText(`UI EDITOR: ${(s.name || id).slice(0, 18)} - drag, resize, Del, arrows`, VW - 54, 14); ctx.restore();
    },
    uiHandlePos(e, h) {
        const x = h.includes('w') ? e.x : h.includes('e') ? e.x + e.w : e.x + e.w / 2;
        const y = h.includes('n') ? e.y : h.includes('s') ? e.y + e.h : e.y + e.h / 2;
        return { x, y };
    },
    uiEditDown(x, y) {
        const s = this.uiEditScreen(); if (!s) return;
        const grab = this.isTouch ? 16 : 8;
        const sel = this.uiSel();
        if (sel) for (const h of HANDLES) {
            const p = this.uiHandlePos(sel, h);
            if (Math.abs(p.x - x) <= grab && Math.abs(p.y - y) <= grab) { this.uiEdit.drag = { mode: h, el: sel, x0: x, y0: y, r: { x: sel.x, y: sel.y, w: sel.w, h: sel.h } }; return; }
        }
        const hit = s.elements.slice().reverse().find(e => x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h);
        if (hit) {
            const changed = this.uiEdit.sel !== hit.id;
            this.uiEdit.sel = hit.id;
            this.uiEdit.drag = { mode: 'move', el: hit, x0: x, y0: y, r: { x: hit.x, y: hit.y, w: hit.w, h: hit.h } };
            if (changed) this.updateUI();
        } else if (this.uiEdit.sel) { this.uiEdit.sel = null; this.updateUI(); }
    },
    uiEditMove(x, y, shift) {
        const d = this.uiEdit && this.uiEdit.drag; if (!d) return;
        const snap = shift ? 1 : (this.uiEdit.snap || 1);
        const sn = (v) => Math.round(v / snap) * snap;
        const dx = x - d.x0, dy = y - d.y0, r = d.r, e = d.el;
        if (d.mode === 'move') { e.x = sn(r.x + dx); e.y = sn(r.y + dy); }
        else {
            let x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
            if (d.mode.includes('w')) x1 = sn(Math.min(x2 - 8, r.x + dx));
            if (d.mode.includes('e')) x2 = sn(Math.max(x1 + 8, x2 + dx));
            if (d.mode.includes('n')) y1 = sn(Math.min(y2 - 8, r.y + dy));
            if (d.mode.includes('s')) y2 = sn(Math.max(y1 + 8, y2 + dy));
            e.x = x1; e.y = y1; e.w = x2 - x1; e.h = y2 - y1;
        }
        d.moved = true;
        this.uiSyncFields();
    },
    uiEditUp() { if (this.uiEdit && this.uiEdit.drag) { this.uiEdit.drag = null; } },
    uiEditKey(e) {
        if (!this.uiEdit) return false;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return false;
        const sel = this.uiSel(); if (!sel) return false;
        const step = e.shiftKey ? 10 : 1;
        const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (mv) { sel.x += mv[0]; sel.y += mv[1]; this.uiSyncFields(); e.preventDefault(); return true; }
        if (e.key === 'Delete' || e.key === 'Backspace') { this.uiDeleteSel(); e.preventDefault(); return true; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { this.uiDuplicateSel(); e.preventDefault(); return true; }
        return false;
    },
    uiSyncFields() {
        const sel = this.uiSel(); if (!sel) return;
        for (const k of ['x', 'y', 'w', 'h']) { const i = document.getElementById('uie-' + k); if (i && document.activeElement !== i) i.value = sel[k]; }
    },

    // ---------- element operations ----------
    uiAdd(type) {
        const s = this.uiEditScreen(); if (!s) return;
        const base = { id: newElementId(s), type, x: 380, y: 230, w: 200, h: 44 };
        const kinds = {
            button: { text: 'Button', fontSize: 15, color: '#ffd700', bg: '#8b0000', border: '#ffd700', borderW: 2, action: { type: 'none' } },
            label: { text: 'Text', fontSize: 18, color: '#ffffff', shadow: true },
            image: { w: 120, h: 120, fit: 'contain' },
            panel: { w: 300, h: 200, bg: '#000000aa', border: '#ffd700', borderW: 2 },
            exits: { h: 116, itemH: 34, gap: 6, fontSize: 13, color: '#ffd700', bg: '#8b0000', border: '#ffd700', borderW: 2 },
            slider: { h: 28, target: 'music', text: 'Music {music}%', fontSize: 12, color: '#ffffff', bg: '#00000066', border: '#ffffff', borderW: 1, fill: '#8b0000cc' }
        };
        const e = Object.assign(base, kinds[type] || {});
        s.elements.push(e); this.uiEdit.sel = e.id; this.updateUI();
    },
    uiDeleteSel() {
        const s = this.uiEditScreen(), sel = this.uiSel(); if (!sel) return;
        s.elements.splice(s.elements.indexOf(sel), 1); this.uiEdit.sel = null; this.updateUI();
    },
    uiDuplicateSel() {
        const s = this.uiEditScreen(), sel = this.uiSel(); if (!sel) return;
        const c = JSON.parse(JSON.stringify(sel)); c.id = newElementId(s); c.x += 12; c.y += 12;
        s.elements.push(c); this.uiEdit.sel = c.id; this.updateUI();
    },
    uiOrder(d) {
        const s = this.uiEditScreen(), sel = this.uiSel(); if (!sel) return;
        const i = s.elements.indexOf(sel), j = d === 'top' ? s.elements.length - 1 : d === 'bottom' ? 0 : i + d;
        if (j < 0 || j >= s.elements.length) return;
        s.elements.splice(i, 1); s.elements.splice(j, 0, sel); this.updateUI();
    },
    async uiNewScreen() {
        const name = await this.popup.prompt('Name of the new menu screen:', 'My menu'); if (!name) return;
        const L = this.layout();
        let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'menu';
        if (['title', 'hud'].includes(id) || L.screens[id]) { let n = 2; while (L.screens[id + n]) n++; id = id + n; }
        L.screens[id] = {
            name, modal: true, dim: 0.5, elements: [
                { id: 'm_box', type: 'panel', x: 300, y: 120, w: 360, h: 300, bg: '#1e1410ee', border: '#ffd700', borderW: 3 },
                { id: 'm_head', type: 'label', x: 300, y: 135, w: 360, h: 40, text: name, fontSize: 24, color: '#ffd700', shadow: true },
                { id: 'm_close', type: 'button', x: 380, y: 360, w: 200, h: 40, text: 'Close', fontSize: 16, color: '#ffd700', bg: '#8b0000', border: '#ffd700', borderW: 2, action: { type: 'close' } }
            ]
        };
        this.uiEdit.screen = id; this.uiEdit.sel = null; this.updateUI();
        this.popup.toast(`Menu "${name}" created - open it with a button (action "Open menu screen")`);
    },
    async uiDeleteScreen() {
        const id = this.uiEdit.screen; if (id === 'title' || id === 'hud') return;
        if (!await this.popup.confirm(`Delete menu screen "${this.layout().screens[id].name || id}"?`, { ok: 'Delete', danger: true })) return;
        delete this.layout().screens[id]; this.uiEdit.screen = 'hud'; this.uiEdit.sel = null; this.updateUI();
    },
    async uiResetScreen() {
        const id = this.uiEdit.screen, d = defaultLayout(this.gameConfig).screens[id];
        if (!d) { this.popup.alert('Only the title screen, the HUD and the example pause menu have a default.'); return; }
        if (!await this.popup.confirm(`Reset "${d.name}" to the default layout?`, { ok: 'Reset', danger: true })) return;
        this.layout().screens[id] = d; this.uiEdit.sel = null; this.updateUI();
    },
    async uiPickImage(target, key, file) {
        try {
            const path = await this.debug.imageToMedia(file);
            target[key] = path;
            this.img(path);
            this.updateUI();
        } catch (e) { this.popup.alert('Image failed: ' + e.message); }
    },
    // make the element match the picture's aspect ratio (keeps the width)
    uiFitToImage(e) {
        const im = this.img(e.image); if (!this.ready(im)) return;
        e.h = Math.max(8, Math.round(e.w * im.naturalHeight / im.naturalWidth)); this.updateUI();
    },

    // ---------- debug panel section ----------
    uiEditorFieldset() {
        const L = ensureLayout(this.gameConfig);
        const kids = [];
        if (!this.uiEdit) {
            kids.push(el('div', { class: 'ui-hint' }, 'Move, resize and add buttons, texts and pictures of the title screen, the game HUD and your own menus.'));
            for (const [id, s] of Object.entries(L.screens)) kids.push(el('button', { onclick: () => this.uiEditStart(id) }, `EDIT: ${s.name || id}`));
            kids.push(el('button', { onclick: async () => { this.uiEditStart('hud'); await this.uiNewScreen(); } }, '+ NEW MENU SCREEN'));
            return this.createDebugFieldset('UI Layout (game screens)', kids);
        }
        const ue = this.uiEdit, s = this.uiEditScreen();
        const scrSel = el('select', { onchange: () => { ue.screen = scrSel.value; ue.sel = null; this.updateUI(); } },
            Object.entries(L.screens).map(([id, sc]) => opt(id, sc.name || id, ue.screen)));
        kids.push(el('button', { class: 'delete-active', onclick: () => this.uiEditStop() }, 'DONE (close UI editor)'));
        kids.push(el('label', {}, 'Screen:'), scrSel);
        const row = (...b) => el('div', { class: 'ui-row' }, b);
        kids.push(row(el('button', { onclick: () => this.uiNewScreen() }, '+ Menu'),
            ue.screen !== 'title' && ue.screen !== 'hud' ? el('button', { onclick: () => this.uiDeleteScreen() }, 'Delete') : null,
            el('button', { onclick: () => this.uiResetScreen() }, 'Reset')));
        // screen settings
        const nameIn = el('input', { type: 'text', value: s.name || '', placeholder: 'screen name', oninput: () => { s.name = nameIn.value; } });
        kids.push(el('label', {}, 'Screen name:'), nameIn);
        if (ue.screen !== 'title' && ue.screen !== 'hud') {
            kids.push(el('div', { class: 'ui-hint' }, `Open it with a button action "Open menu screen" or the rule action "Open menu screen" (id: ${ue.screen}).`));
            const dim = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s.dim || 0, oninput: () => { s.dim = parseFloat(dim.value); } });
            const modal = el('input', { type: 'checkbox', checked: !!s.modal, onchange: () => { s.modal = modal.checked; } });
            kids.push(el('label', {}, 'Darken game behind it:'), dim, el('div', { class: 'char-checkbox' }, [modal, el('label', {}, 'Blocks taps on the game (modal)')]));
        }
        if (ue.screen !== 'hud') {
            kids.push(el('label', {}, 'Background picture (optional):'),
                this.fileInput('uie-scr-bg', 'image/*', f => this.uiPickImage(s, 'bgImage', f)));
            if (s.bgImage) kids.push(el('button', { onclick: () => { delete s.bgImage; this.updateUI(); } }, 'Remove background'));
        }
        const snap = el('select', { onchange: () => { ue.snap = parseInt(snap.value); } }, [1, 2, 5, 10, 20].map(n => opt(String(n), `${n}px`, String(ue.snap))));
        kids.push(row(el('span', {}, 'Snap:'), snap));
        // add
        kids.push(el('label', {}, 'Add:'));
        kids.push(el('div', { class: 'ui-add' }, Object.entries(UI_TYPES).map(([t, l]) => el('button', { onclick: () => this.uiAdd(t) }, '+ ' + l))));
        // element list
        const list = el('select', { size: Math.min(8, Math.max(3, s.elements.length)), class: 'ui-list', onchange: () => { ue.sel = list.value; this.updateUI(); } },
            s.elements.slice().reverse().map(e => opt(e.id, `${UI_TYPES[e.type] || e.type}: ${(e.text || e.image || e.id).toString().slice(0, 22)}${e.group ? ' [' + e.group + ']' : ''}`, ue.sel)));
        kids.push(el('label', {}, 'Elements (top first):'), list);
        const sel = this.uiSel();
        if (sel) kids.push(this.uiPropsBox(sel));
        else kids.push(el('div', { class: 'ui-hint' }, 'Tap an element on the game screen to select it.'));
        return this.createDebugFieldset('UI Layout Editor', kids);
    },

    uiPropsBox(e) {
        const box = el('div', { class: 'ui-props' });
        const lab = (t) => el('label', {}, t);
        const num = (k, step = 1) => { const i = el('input', { type: 'number', id: 'uie-' + k, value: e[k] ?? '', step, oninput: () => { const v = parseFloat(i.value); if (!isNaN(v)) e[k] = v; } }); return i; };
        const text = (k, ph) => { const i = el('input', { type: 'text', value: e[k] || '', placeholder: ph || '', oninput: () => { if (i.value) e[k] = i.value; else delete e[k]; } }); return i; };
        box.appendChild(el('div', { class: 'ui-props-head' }, `${UI_TYPES[e.type] || e.type}  (${e.id})`));
        const typeSel = el('select', { onchange: () => { e.type = typeSel.value; this.updateUI(); } }, Object.entries(UI_TYPES).map(([t, l]) => opt(t, l, e.type)));
        box.append(lab('Type:'), typeSel);
        box.append(el('div', { class: 'ui-grid4' }, [lab('x'), num('x'), lab('y'), num('y'), lab('w'), num('w'), lab('h'), num('h')]));
        if (e.type !== 'image' && e.type !== 'exits') {
            box.append(lab('Text ({dignity} {scene} {lick} {mute} {music} {sfx} {items} {flag:x}):'), text('text', 'text'));
        }
        if (e.type !== 'image' && e.type !== 'panel') {
            const al = el('select', { onchange: () => { e.align = al.value; } }, [opt('center', 'centered', e.align || 'center'), opt('left', 'left', e.align || 'center')]);
            const sh = el('input', { type: 'checkbox', checked: !!e.shadow, onchange: () => { e.shadow = sh.checked; } });
            box.append(el('div', { class: 'ui-row' }, [lab('Font size'), num('fontSize'), al, sh, lab('shadow')]));
            box.append(lab('Text colour:'), colorInput(e.color, v => { e.color = v || '#ffffff'; }, false));
        }
        if (e.type !== 'label' || e.bg) box.append(lab('Background colour:'), colorInput(e.bg, v => { if (v) e.bg = v; else delete e.bg; }));
        box.append(lab('Border colour / width:'), el('div', { class: 'ui-row' }, [colorInput(e.border, v => { if (v) e.border = v; else delete e.border; }), num('borderW')]));
        if (e.type === 'slider') {
            box.append(lab('Fill colour:'), colorInput(e.fill, v => { e.fill = v || '#8b0000cc'; }, false));
            const t = el('select', { onchange: () => { e.target = t.value; } }, [opt('music', 'Music volume', e.target), opt('sfx', 'Sound effects volume', e.target), opt('amb', 'Ambience volume', e.target)]);
            box.append(lab('Controls:'), t);
        }
        if (e.type === 'exits') box.append(el('div', { class: 'ui-row' }, [lab('Button height'), num('itemH'), lab('gap'), num('gap')]),
            el('div', { class: 'ui-hint' }, 'Shows one button per exit of the current level (set up under Level Settings → Exits).'));
        // picture
        if (e.type !== 'slider') {
            box.append(lab(e.type === 'image' ? 'Picture:' : 'Picture (sized to the element):'),
                this.fileInput('uie-img-' + e.id, 'image/*', f => this.uiPickImage(e, 'image', f)));
            if (e.image) {
                const fit = el('select', { onchange: () => { e.fit = fit.value; } }, [opt('stretch', 'stretch to box', e.fit || 'stretch'), opt('contain', 'fit inside (keep shape)', e.fit || 'stretch'), opt('cover', 'fill + crop (keep shape)', e.fit || 'stretch')]);
                box.append(el('div', { class: 'ui-row' }, [fit,
                    el('button', { onclick: () => this.uiFitToImage(e) }, 'Box = picture shape'),
                    el('button', { onclick: () => { delete e.image; this.updateUI(); } }, '✕')]));
            }
        }
        // action
        if (e.type === 'button' || e.type === 'image' || e.type === 'label' || e.type === 'panel') {
            const a = e.action || (e.action = { type: 'none' });
            const act = el('select', { onchange: () => { e.action = { type: act.value }; this.updateUI(); } }, Object.entries(UI_ACTIONS).map(([t, l]) => opt(t, l, a.type)));
            box.append(lab('When tapped:'), act);
            const c = this.gameConfig;
            if (a.type === 'scene') {
                const s = el('select', { onchange: () => { a.target = s.value; } }, c.sceneOrder.map(n => opt(n, n, a.target)));
                if (!a.target) a.target = c.sceneOrder[0];
                box.append(s);
            } else if (a.type === 'menu') {
                const scr = Object.entries(this.layout().screens).filter(([k]) => k !== 'title' && k !== 'hud');
                const s = el('select', { onchange: () => { if (s.value === '__new') { this.uiNewScreen().then(() => { a.screen = this.uiEdit && this.uiEdit.screen; }); } else a.screen = s.value; } },
                    [...scr.map(([k, sc]) => opt(k, sc.name || k, a.screen)), opt('__new', '+ new menu screen…', '')]);
                if (!a.screen && scr.length) a.screen = scr[0][0];
                box.append(s);
            } else if (a.type === 'toggle') {
                box.append(el('input', { type: 'text', value: a.group || '', placeholder: 'group name, e.g. side', oninput: (ev) => { a.group = ev.target.value.trim(); } }));
            } else if (a.type === 'rules') {
                a.actions = a.actions || [];
                box.append(actionsEditor(a.actions, makeCtx(this, []), 'Do'));
            } else if (this.plugins && this.plugins.uiActionSpecs[a.type]) {
                for (const f of this.plugins.uiActionSpecs[a.type].fields || []) {
                    box.append(lab(f.label || f.key), el('input', { type: f.type === 'number' ? 'number' : 'text', value: a[f.key] ?? '', oninput: (ev) => { a[f.key] = f.type === 'number' ? parseFloat(ev.target.value) : ev.target.value; } }));
                }
            }
        }
        // visibility
        const when = el('select', { onchange: () => { if (when.value) e.when = when.value; else delete e.when; } }, Object.entries(UI_WHEN).map(([k, l]) => opt(k, l, e.when || '')));
        box.append(lab('Show:'), when);
        box.append(lab('Group (hide/show together, "!name" = shown while the group is hidden):'), text('group', 'e.g. side'));
        e.if = e.if || [];
        box.append(condsEditor(e.if, makeCtx(this, []), 'Only if (in game)'));
        if (e.type === 'label' || e.type === 'button' || e.type === 'panel' || e.type === 'image') {
            const eh = el('input', { type: 'checkbox', checked: !!e.editorHold, onchange: () => { e.editorHold = eh.checked; } });
            box.append(el('div', { class: 'char-checkbox' }, [eh, el('label', {}, 'Hold 0.8 s to open the hidden editor')]));
        }
        box.append(el('div', { class: 'ui-row' }, [
            el('button', { onclick: () => this.uiOrder('top') }, 'To front'), el('button', { onclick: () => this.uiOrder('bottom') }, 'To back'),
            el('button', { onclick: () => this.uiDuplicateSel() }, 'Duplicate'), el('button', { class: 'reset-btn', onclick: () => this.uiDeleteSel() }, 'Delete')]));
        return box;
    },

    // ---------- plugin manager ----------
    pluginsFieldset() {
        const c = this.gameConfig; c.plugins = c.plugins || {};
        const host = this.plugins;
        const kids = [];
        const ids = Object.keys(c.plugins);
        if (!ids.length) kids.push(el('div', { class: 'ui-hint' }, 'No plugins yet. Plugins add new rule actions, conditions, UI button actions, effects or editor tools - for the browser and the Lua game (PC / Android / Vita).'));
        for (const id of ids) {
            const p = c.plugins[id];
            const on = el('input', { type: 'checkbox', checked: p.enabled !== false, onchange: () => { p.enabled = on.checked; this._pluginsDirty = true; this.updateUI(); } });
            const loaded = host && host.loaded.includes(id);
            kids.push(el('div', { class: 'plugin-row' }, [
                el('div', { class: 'plugin-title' }, [on, ` ${p.name || id} `, el('span', { class: 'plugin-ver' }, `v${p.version || '?'}${loaded ? ' ✓' : ''}`)]),
                p.description ? el('div', { class: 'ui-hint' }, p.description) : null,
                el('div', { class: 'ui-hint' }, `${p.web ? 'browser ✓' : 'browser –'}   ${p.lua ? 'Lua (PC/Android/Vita) ✓' : 'Lua –'}${p.author ? '   by ' + p.author : ''}`),
                el('div', { class: 'ui-row' }, [
                    el('button', { onclick: () => this.editPluginSettings(id) }, 'Settings'),
                    el('button', { onclick: () => this.downloadPlugin(id) }, 'Download'),
                    el('button', { class: 'reset-btn', onclick: async () => { if (await this.popup.confirm(`Remove plugin "${p.name || id}"?`, { ok: 'Remove', danger: true })) { delete c.plugins[id]; this._pluginsDirty = true; this.updateUI(); } } }, 'Remove')
                ])
            ]));
        }
        if (host && host.errors.length) kids.push(el('div', { class: 'plugin-err' }, host.errors.join('\n')));
        kids.push(el('label', {}, 'Install plugin (.zip with plugin.json, or .json):'),
            this.fileInput('plugin-file', '.zip,.json', async (f) => {
                try { const { id, data } = await readPluginFile(f); this.installPlugin(id, data); }
                catch (e) { this.popup.alert('Plugin install failed: ' + e.message); }
            }));
        const ex = el('select', {}, [el('option', { value: '' }, '(loading examples…)')]);
        listBundledPlugins().then(list => {
            ex.innerHTML = '';
            ex.appendChild(el('option', { value: '' }, list.length ? 'Example plugins…' : '(no example plugins found)'));
            list.forEach(p => ex.appendChild(el('option', { value: p.dir }, `${p.name} - ${p.description || ''}`)));
        });
        kids.push(el('div', { class: 'ui-row' }, [ex, el('button', { onclick: async () => {
            if (!ex.value) return;
            try { const { id, data } = await loadBundledPlugin(ex.value); this.installPlugin(id, data); }
            catch (e) { this.popup.alert('Install failed: ' + e.message); }
        } }, 'Install')]));
        if (this._pluginsDirty) kids.push(el('button', { class: 'delete-active', onclick: async () => { await this.debug.saveConfig(); location.reload(); } }, 'APPLY: save project + reload'));
        kids.push(el('div', { class: 'ui-hint' }, 'How to write plugins: see PLUGINS.md.'));
        const fs = this.createDebugFieldset('Plugins', kids);
        return fs;
    },
    // extra panels added by plugins (api.editor.addPanel)
    pluginPanels() {
        if (!this.plugins) return [];
        return this.plugins.panels.map(p => {
            const box = el('div');
            try { p.build(box, this); } catch (e) { box.textContent = 'Error: ' + e.message; }
            return this.createDebugFieldset(`${p.title}`, [box]);
        });
    },
    installPlugin(id, data) {
        const c = this.gameConfig; c.plugins = c.plugins || {};
        const old = c.plugins[id];
        if (old && old.settings) data.settings = Object.assign({}, data.settings, old.settings);
        c.plugins[id] = data; this._pluginsDirty = true; this.updateUI();
        this.popup.toast(`Plugin "${data.name}" installed - press APPLY to load it`);
    },
    async editPluginSettings(id) {
        const p = this.gameConfig.plugins[id];
        const v = await this.popup.prompt(`Settings of "${p.name || id}" (JSON):`, JSON.stringify(p.settings || {}));
        if (v === null) return;
        try { p.settings = JSON.parse(v || '{}'); this._pluginsDirty = true; this.updateUI(); } catch (e) { this.popup.alert('Not valid JSON: ' + e.message); }
    },
    async downloadPlugin(id) {
        if (!window.JSZip) return;
        const p = this.gameConfig.plugins[id], zip = new JSZip();
        const m = { id, name: p.name, version: p.version, description: p.description, author: p.author, settings: p.settings || {} };
        if (p.web) { m.web = 'web.js'; zip.file(`${id}/web.js`, p.web); }
        if (p.lua) { m.lua = 'game.lua'; zip.file(`${id}/game.lua`, p.lua); }
        zip.file(`${id}/plugin.json`, JSON.stringify(m, null, 2));
        this.debug.download(await zip.generateAsync({ type: 'blob' }), `plugin_${id}.zip`);
    }
};
