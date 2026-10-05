// =============================
// CUSTOMIZABLE DEBUG PANEL (browser editor)
//  - dock it at the side (width adjustable) or float it as a window (drag the header, resize the corner)
//  - sections can be collapsed, re-ordered and hidden ("✎ Customize")
//  - own quick buttons: pick a command (new scene, new menu screen, export, plugin commands …),
//    a label and optionally a picture that is sized to the button
// Settings are per browser (localStorage), not part of the game.
// =============================
import { el } from './rules-editor.js';

const KEY = 'pcam.debugUI';
const DEF = { float: false, x: 40, y: 40, w: 300, h: 520, dockW: 260, order: [], hidden: [], collapsed: [], quick: [] };

export function loadPrefs() {
    try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return Object.assign({}, DEF); }
}
function savePrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) {} }

// every command a quick button can run
export function debugCommands(eng) {
    const d = eng.debug;
    const reset = () => { eng.editEnabled = false; eng.deleteMode = false; eng.editMode = false; eng.placeMode = null; };
    const inLevel = (fn) => () => { if (!eng.isGameRunning) eng.startGame(); fn(); };
    const mode = (prop) => inLevel(() => { const v = !eng[prop]; reset(); eng[prop] = v; eng.updateUI(); });
    const cmds = {
        newScene: ['New scene / level', () => d.addLevel()],
        deleteScene: ['Delete current level', inLevel(() => d.deleteLevel())],
        renameScene: ['Rename level', inLevel(() => d.renameLevel())],
        prevScene: ['Previous level', inLevel(() => d.cycleLevel(-1))],
        nextScene: ['Next level', inLevel(() => d.cycleLevel(1))],
        addHotspot: ['+ Hotspot', inLevel(() => { reset(); eng.placeMode = 'hotspot'; eng.updateUI(); eng.popup.toast('Tap the level where the new hotspot should go'); })],
        addCharacter: ['+ Character', inLevel(() => { reset(); eng.placeMode = 'character'; eng.updateUI(); eng.popup.toast('Tap the level where the new character should go'); })],
        addPickup: ['+ Item pickup', inLevel(() => { reset(); d.placePickup(); })],
        editMode: ['Edit mode on/off', mode('editMode')],
        dragMode: ['Drag mode on/off', mode('editEnabled')],
        deleteMode: ['Delete mode on/off', mode('deleteMode')],
        editPlayer: ['Edit player', inLevel(() => d.openEditor('player'))],
        items: ['Items & combinations', () => d.showItems()],
        interaction: ['Interaction settings', () => d.showInteraction()],
        lick: ['Edit level lick', inLevel(() => d.showLickEditor(false))],
        bgEditor: ['Move / zoom background', inLevel(() => d.showBackgroundEditor())],
        uiEditor: ['UI layout editor', () => eng.uiEditStart()],
        newMenu: ['New menu screen', async () => { eng.uiEditStart('hud'); await eng.uiNewScreen(); }],
        title: ['Title screen', () => { if (eng.isGameRunning) eng.backToTitle(); }],
        play: ['Play test (close editor)', () => { if (!eng.isGameRunning) eng.startGame(); if (eng.debugMode) eng.toggleDebugMenu(); }],
        save: ['Save config', () => d.saveConfig()],
        exportLua: ['Export for Lua', () => d.exportLua()],
        download: ['Download project (web)', () => d.downloadGameCopy()],
        backup: ['Backup JSON', () => d.exportJSON()],
        fullscreen: ['Fullscreen', () => eng.toggleFullscreen()],
        mute: ['Mute / unmute', () => eng.toggleMute()],
        plugins: ['Plugin manager', () => { const p = loadPrefs(); p.collapsed = p.collapsed.filter(k => k !== 'Plugins'); savePrefs(p); eng.updateUI(); setTimeout(() => document.querySelector('[data-sec="Plugins"]')?.scrollIntoView(), 50); }]
    };
    if (eng.plugins) for (const [id, c] of Object.entries(eng.plugins.commands)) cmds['plugin:' + id] = [`${c.label} (${c.id})`, () => c.fn()];
    return cmds;
}

export const debugUI = {
    prefs: null,
    customizing: false,

    // called by updateUI after the debug panel has been (re)built
    decorate(eng, uiLayer, statsDiv, buttonsDiv) {
        const p = this.prefs || (this.prefs = loadPrefs());
        const cont = document.getElementById('gameContainer');
        this.applyFrame(eng, uiLayer, cont);

        // header with the panel tools
        const head = el('div', { class: 'dbg-head' }, [
            el('span', { class: 'dbg-grip', title: p.float ? 'Drag to move' : '' }, p.float ? '⠿' : ''),
            el('button', { title: p.float ? 'Dock at the side' : 'Float as a window', onclick: () => { p.float = !p.float; savePrefs(p); eng.updateUI(); } }, p.float ? '⇤ Dock' : '⧉ Float'),
            el('button', { class: this.customizing ? 'on' : '', title: 'Re-order, hide and add buttons', onclick: () => { this.customizing = !this.customizing; eng.updateUI(); } }, this.customizing ? '✓ Done' : '✎ Customize'),
            el('button', { title: 'Collapse / expand all sections', onclick: () => { const keys = this.sectionKeys(buttonsDiv); p.collapsed = p.collapsed.length >= keys.length ? [] : keys; savePrefs(p); eng.updateUI(); } }, '☰')
        ]);
        statsDiv.prepend(head);
        if (p.float) this.makeDraggable(uiLayer, head, p);

        // quick buttons
        buttonsDiv.prepend(this.quickBar(eng, p));

        // sections: key, collapse, order, hide
        const secs = [...buttonsDiv.children].filter(c => c.tagName === 'FIELDSET' || c.classList.contains('debug-box'));
        secs.forEach(s => {
            const key = this.keyOf(s); s.dataset.sec = key;
            if (s.tagName === 'FIELDSET') {
                const lg = s.querySelector('legend');
                if (lg) {
                    lg.classList.add('dbg-legend');
                    lg.onclick = () => { const i = p.collapsed.indexOf(key); if (i >= 0) p.collapsed.splice(i, 1); else p.collapsed.push(key); savePrefs(p); s.classList.toggle('collapsed', i < 0); };
                }
                s.classList.toggle('collapsed', p.collapsed.includes(key));
            }
        });
        // order: known keys in saved order, new ones keep their place
        const order = p.order.filter(k => secs.some(s => s.dataset.sec === k));
        const anchor = buttonsDiv.querySelector('.dbg-quick');
        let after = anchor;
        for (const k of order) { const s = secs.find(x => x.dataset.sec === k); if (s) { after.after(s); after = s; } }
        secs.forEach(s => { if (p.hidden.includes(s.dataset.sec) && !this.customizing) s.style.display = 'none'; });

        if (this.customizing) {
            secs.forEach(s => {
                const key = s.dataset.sec, hidden = p.hidden.includes(key);
                s.classList.add('dbg-custom'); if (hidden) s.classList.add('dbg-hidden');
                const bar = el('div', { class: 'dbg-secbar' }, [
                    el('span', { class: 'dbg-seckey' }, key),
                    el('button', { title: 'Move up', onclick: () => this.move(eng, buttonsDiv, key, -1) }, '▲'),
                    el('button', { title: 'Move down', onclick: () => this.move(eng, buttonsDiv, key, 1) }, '▼'),
                    el('button', { title: hidden ? 'Show' : 'Hide', onclick: () => { if (hidden) p.hidden = p.hidden.filter(k => k !== key); else p.hidden.push(key); savePrefs(p); eng.updateUI(); } }, hidden ? '👁 show' : '🚫 hide')
                ]);
                s.prepend(bar);
                // drag & drop re-ordering (mouse)
                s.draggable = true;
                s.ondragstart = (ev) => { ev.dataTransfer.setData('text/plain', key); s.classList.add('dragging'); };
                s.ondragend = () => s.classList.remove('dragging');
                s.ondragover = (ev) => ev.preventDefault();
                s.ondrop = (ev) => { ev.preventDefault(); const from = ev.dataTransfer.getData('text/plain'); if (from && from !== key) this.moveTo(eng, buttonsDiv, from, key); };
            });
            buttonsDiv.appendChild(el('button', { class: 'reset-btn', onclick: () => { const q = p.quick; this.prefs = Object.assign({}, DEF, { quick: q, float: p.float }); savePrefs(this.prefs); eng.updateUI(); } }, 'Reset panel layout (keeps quick buttons)'));
        }
    },
    keyOf(s) {
        if (s.tagName === 'FIELDSET') { const t = (s.querySelector('legend')?.textContent || 'Section').replace(/:.*$/, '').trim(); return t; }
        if (s.classList.contains('debug-box')) return 'Tools';
        return 'Section';
    },
    sectionKeys(buttonsDiv) { return [...buttonsDiv.querySelectorAll('[data-sec]')].map(s => s.dataset.sec); },
    currentOrder(buttonsDiv) { return [...buttonsDiv.children].filter(c => c.dataset && c.dataset.sec).map(c => c.dataset.sec); },
    move(eng, buttonsDiv, key, d) {
        const o = this.currentOrder(buttonsDiv), i = o.indexOf(key), j = i + d;
        if (j < 0 || j >= o.length) return;
        [o[i], o[j]] = [o[j], o[i]]; this.prefs.order = o; savePrefs(this.prefs); eng.updateUI();
    },
    moveTo(eng, buttonsDiv, from, to) {
        const o = this.currentOrder(buttonsDiv); o.splice(o.indexOf(from), 1); o.splice(o.indexOf(to), 0, from);
        this.prefs.order = o; savePrefs(this.prefs); eng.updateUI();
    },

    // dock (side panel with adjustable width) or float (window)
    applyFrame(eng, uiLayer, cont) {
        const p = this.prefs;
        uiLayer.classList.toggle('dbg-float', !!p.float);
        cont.classList.toggle('dbg-floating', !!p.float);
        uiLayer.querySelectorAll('.dbg-resize').forEach(r => r.remove());
        if (p.float) {
            Object.assign(uiLayer.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' });
            if (!this._ro) {
                this._ro = new ResizeObserver(() => {
                    if (!this.prefs.float || !uiLayer.classList.contains('dbg-float')) return;
                    const r = uiLayer.getBoundingClientRect(); if (r.width < 50) return;
                    this.prefs.w = Math.round(r.width); this.prefs.h = Math.round(r.height); savePrefs(this.prefs);
                });
                this._ro.observe(uiLayer);
            }
        } else {
            Object.assign(uiLayer.style, { left: '', top: '', height: '', width: p.dockW + 'px' });
            cont.style.setProperty('--dock', p.dockW + 'px');
            const grip = el('div', { class: 'dbg-resize', title: 'Drag to change the width' });
            grip.onpointerdown = (ev) => {
                ev.preventDefault(); const x0 = ev.clientX, w0 = p.dockW;
                const mv = (e) => { p.dockW = Math.max(200, Math.min(600, w0 + e.clientX - x0)); uiLayer.style.width = p.dockW + 'px'; cont.style.setProperty('--dock', p.dockW + 'px'); };
                const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); savePrefs(p); };
                document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
            };
            uiLayer.appendChild(grip);
        }
    },
    makeDraggable(uiLayer, head, p) {
        head.onpointerdown = (ev) => {
            if (ev.target.tagName === 'BUTTON') return;
            ev.preventDefault();
            const x0 = ev.clientX, y0 = ev.clientY, px = p.x, py = p.y;
            const mv = (e) => {
                p.x = Math.max(-p.w + 60, Math.min(window.innerWidth - 60, px + e.clientX - x0));
                p.y = Math.max(0, Math.min(window.innerHeight - 40, py + e.clientY - y0));
                uiLayer.style.left = p.x + 'px'; uiLayer.style.top = p.y + 'px';
            };
            const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); savePrefs(p); };
            document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
        };
    },

    // ---- quick buttons
    quickBar(eng, p) {
        const cmds = debugCommands(eng);
        const bar = el('div', { class: 'dbg-quick' + (this.customizing ? ' customizing' : '') });
        p.quick.forEach((q, i) => {
            const c = cmds[q.cmd];
            const b = el('button', { class: 'dbg-qbtn', title: c ? c[0] : `missing command ${q.cmd}`, onclick: () => { if (this.customizing) return this.editQuick(eng, p, i); if (c) c[1](); else eng.popup.toast('Command not available: ' + q.cmd); } });
            b.style.width = (q.w || 120) + 'px'; b.style.height = (q.h || 30) + 'px';
            if (q.image) {
                b.style.backgroundImage = `url("${q.image}")`;
                b.style.backgroundSize = q.fit === 'cover' ? 'cover' : q.fit === 'contain' ? 'contain' : '100% 100%';
                b.style.backgroundPosition = 'center'; b.style.backgroundRepeat = 'no-repeat';
                b.classList.add('has-img');
            }
            b.appendChild(el('span', {}, q.label || (c ? c[0] : q.cmd)));
            if (this.customizing) {
                const hold = el('div', { class: 'dbg-qhold' }, [b]);
                const wrap = el('div', { class: 'dbg-qwrap' }, [hold,
                    el('button', { class: 'dbg-qx', title: 'Move left', onclick: () => { if (i > 0) { [p.quick[i - 1], p.quick[i]] = [p.quick[i], p.quick[i - 1]]; savePrefs(p); eng.updateUI(); } } }, '◀'),
                    el('button', { class: 'dbg-qx', title: 'Delete', onclick: () => { p.quick.splice(i, 1); savePrefs(p); eng.updateUI(); } }, '✕')]);
                // drag the corner to resize
                const rz = el('span', { class: 'dbg-qrz', title: 'Drag to resize' });
                rz.onpointerdown = (ev) => {
                    ev.preventDefault(); ev.stopPropagation();
                    const x0 = ev.clientX, y0 = ev.clientY, w0 = q.w || 120, h0 = q.h || 30;
                    const mv = (e) => { q.w = Math.max(30, Math.round(w0 + e.clientX - x0)); q.h = Math.max(20, Math.round(h0 + e.clientY - y0)); b.style.width = q.w + 'px'; b.style.height = q.h + 'px'; };
                    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); savePrefs(p); };
                    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
                };
                hold.appendChild(rz);
                bar.appendChild(wrap);
            } else bar.appendChild(b);
        });
        if (this.customizing || !p.quick.length) {
            bar.appendChild(el('button', { class: 'dbg-qadd', onclick: () => this.editQuick(eng, p, -1) }, '+ Button'));
        }
        return bar;
    },
    // add (i = -1) or edit a quick button
    editQuick(eng, p, i) {
        const cmds = debugCommands(eng);
        const q = i >= 0 ? Object.assign({}, p.quick[i]) : { cmd: 'newScene', label: '', w: 120, h: 30, fit: 'stretch' };
        const back = el('div', { class: 'popup-backdrop' });
        const cmd = el('select', {}, Object.entries(cmds).map(([k, [l]]) => el('option', { value: k, selected: k === q.cmd }, l)));
        const label = el('input', { type: 'text', value: q.label || '', placeholder: '(command name)' });
        const w = el('input', { type: 'number', value: q.w || 120, min: 30 }), h = el('input', { type: 'number', value: q.h || 30, min: 20 });
        const fit = el('select', {}, [['stretch', 'stretch to button'], ['contain', 'fit inside'], ['cover', 'fill + crop']].map(([v, l]) => el('option', { value: v, selected: v === (q.fit || 'stretch') }, l)));
        const prev = el('div', { class: 'dbg-qprev' });
        const showPrev = () => {
            prev.innerHTML = '';
            const b = el('div', { class: 'dbg-qbtn has-img' }, el('span', {}, label.value || cmds[cmd.value][0]));
            b.style.width = (parseInt(w.value) || 120) + 'px'; b.style.height = (parseInt(h.value) || 30) + 'px';
            if (q.image) { b.style.backgroundImage = `url("${q.image}")`; b.style.backgroundSize = fit.value === 'stretch' ? '100% 100%' : fit.value; b.style.backgroundPosition = 'center'; b.style.backgroundRepeat = 'no-repeat'; }
            prev.appendChild(b);
        };
        const file = el('input', { type: 'file', accept: 'image/*' });
        file.onchange = async () => {
            const f = file.files[0]; if (!f) return;
            // keep it small: the picture is drawn at button size
            const im = new Image(); im.src = URL.createObjectURL(f); await im.decode().catch(() => {});
            const s = Math.min(1, 256 / Math.max(im.naturalWidth || 1, im.naturalHeight || 1));
            const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(im.naturalWidth * s)); cv.height = Math.max(1, Math.round(im.naturalHeight * s));
            cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
            q.image = cv.toDataURL('image/png'); showPrev();
        };
        [cmd, label, w, h, fit].forEach(x => { x.oninput = showPrev; x.onchange = showPrev; });
        const close = () => back.remove();
        const box = el('div', { class: 'popup-box dbg-qedit' }, [
            el('div', { class: 'popup-text' }, i >= 0 ? 'Edit quick button' : 'New quick button'),
            el('label', {}, 'Command:'), cmd, el('label', {}, 'Label:'), label,
            el('label', {}, 'Size (w × h):'), el('div', { class: 'ui-row' }, [w, h]),
            el('label', {}, 'Picture (optional, sized to the button):'), file, fit,
            el('button', { onclick: () => { delete q.image; showPrev(); } }, 'Remove picture'),
            prev,
            el('div', { class: 'popup-buttons' }, [
                el('button', { onclick: close }, 'Cancel'),
                el('button', { onclick: () => {
                    Object.assign(q, { cmd: cmd.value, label: label.value.trim(), w: parseInt(w.value) || 120, h: parseInt(h.value) || 30, fit: fit.value });
                    if (i >= 0) p.quick[i] = q; else p.quick.push(q);
                    savePrefs(p); close(); eng.updateUI();
                } }, 'OK')
            ])
        ]);
        back.appendChild(box);
        document.getElementById('gameContainer').appendChild(back);
        showPrev();
    }
};
