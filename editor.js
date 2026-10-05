// =============================
// EDITOR / DEBUG TOOLS
// =============================
const LUA_RUNTIME_FILES = ['main.lua', 'conf.lua', 'index.lua', 'engine/util.lua', 'engine/nav.lua', 'engine/game.lua', 'platform/love.lua', 'platform/vita.lua'];
const LUA_EXTRA_FILES = ['tools/build_love.py', 'tools/build_vita.py', 'README_LUA.md'];
const WEB_FILES = ['index.html', 'style.css', 'game.js', 'editor.js', 'popup.js', 'sprite.js', 'adventure.js', 'rules-editor.js', 'config.js', 'vendor/jszip.min.js', 'vendor/JSZIP_LICENSE.md'];

// turn "http://host/assets/x.png" into "assets/x.png" (same-origin only)
function relSrc(src) {
    if (!src || src.startsWith('data:')) return src;
    try {
        const u = new URL(src, location.href);
        const base = new URL('.', location.href);
        if (u.origin === base.origin && u.pathname.startsWith(base.pathname)) return decodeURIComponent(u.pathname.slice(base.pathname.length));
    } catch (e) {}
    return src;
}
// Guess the frame grid of a sprite sheet:
// 1) frames separated by transparent gaps (even sized) -> exact count
// 2) otherwise the repeat distance of the picture along x (frames that touch, like the knight)
function guessGrid(im) {
    const W = im.naturalWidth, H = im.naturalHeight;
    const fallback = { cols: Math.max(1, Math.round(W / H)), rows: 1, sure: false };
    try {
        const s = Math.min(1, 800 / Math.max(W, H));
        const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d'); cx.drawImage(im, 0, 0, w, h);
        const d = cx.getImageData(0, 0, w, h).data;
        const colSum = new Array(w).fill(0), rowSum = new Array(h).fill(0);
        let opaque = true;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const a = d[(y * w + x) * 4 + 3];
            if (a > 20) { colSum[x] += a; rowSum[y] += a; } else opaque = false;
        }
        if (opaque) return fallback;
        const segments = (arr) => { const out = []; let start = -1; arr.forEach((v, i) => { if (v > 0 && start < 0) start = i; if (v === 0 && start >= 0) { out.push(i - start); start = -1; } }); if (start >= 0) out.push(arr.length - start); return out; };
        const even = (seg) => { if (seg.length < 2) return seg.length === 1; const m = seg.reduce((a, b) => a + b, 0) / seg.length; const sd = Math.sqrt(seg.reduce((a, b) => a + (b - m) ** 2, 0) / seg.length); return sd / m < 0.35; };
        const period = (prof) => {
            const n = prof.length, m = prof.reduce((a, b) => a + b, 0) / n, p = prof.map(v => v - m);
            const varr = p.reduce((a, v) => a + v * v, 0) || 1;
            const sc = {};
            for (let k = 2; k <= 12; k++) { const L = Math.round(n / k); if (L < 8) break; let c = 0; for (let i = 0; i + L < n; i++) c += p[i] * p[i + L]; sc[k] = c / varr; }
            const vals = Object.values(sc); if (!vals.length) return { n: 1, score: 0 };
            const best = Math.max(...vals); if (best < 0.3) return { n: 1, score: best };
            return { n: Math.max(...Object.keys(sc).filter(k => sc[k] >= 0.85 * best).map(Number)), score: best };
        };
        const cs = segments(colSum), rs = segments(rowSum);
        const rows = rs.length >= 1 && even(rs) ? rs.length : 1;
        const per = period(colSum);
        const gapsOk = cs.length >= 1 && even(cs);
        // touching frames merge into fewer gaps -> a strong repeat pattern wins
        if (gapsOk && (per.n === cs.length || per.score < 0.5 || per.n < cs.length)) return { cols: cs.length, rows, sure: true };
        return { cols: per.n, rows, sure: per.score >= 0.5 };
    } catch (e) { return fallback; }
}
const loadImg = (src) => new Promise((res) => { if (!src) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
const readFileAsDataURL = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'video/ogg': 'ogg' };

// JS value -> Lua source
function toLua(v, ind = '') {
    if (v === null || v === undefined) return 'nil';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
    if (typeof v === 'string') {
        let s = '"';
        for (const ch of v) {
            const c = ch.codePointAt(0);
            if (ch === '\\') s += '\\\\'; else if (ch === '"') s += '\\"'; else if (ch === '\n') s += '\\n'; else if (ch === '\r') s += '\\r';
            else if (c < 32 || c === 127) s += '\\' + String(c).padStart(3, '0'); else s += ch;
        }
        return s + '"';
    }
    const ind2 = ind + '  ';
    if (Array.isArray(v)) {
        if (!v.length) return '{}';
        return '{\n' + v.map(x => ind2 + toLua(x, ind2)).join(',\n') + '\n' + ind + '}';
    }
    const keys = Object.keys(v).filter(k => v[k] !== undefined && v[k] !== null);
    if (!keys.length) return '{}';
    return '{\n' + keys.map(k => ind2 + (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && !['and', 'end', 'in', 'or', 'not', 'nil', 'true', 'false', 'if', 'then', 'else', 'elseif', 'for', 'do', 'while', 'repeat', 'until', 'function', 'local', 'return', 'break', 'goto'].includes(k) ? k : `[${toLua(k)}]`) + ' = ' + toLua(v[k], ind2)).join(',\n') + '\n' + ind + '}';
}

import { spriteInfo, spriteFrame, BASE_ANIMS, DIR_ANIMS, ANIM_LABELS } from './sprite.js';
const ALL_ANIMS = [...BASE_ANIMS, ...DIR_ANIMS];
const OPTIONAL_ANIMS = ['run', ...DIR_ANIMS];   // need a tick to be used
import { reactionsEditor, condsEditor, cleanReactions, makeCtx, showItemsDialog, showInteractionDialog } from './rules-editor.js';

// pointer helper: 1 finger/mouse = drag, 2 fingers = pinch, mouse wheel = pinch
function attachGestures(el, { onDrag, onPinch, onStart }) {
    const pts = new Map();
    let lastDist = 0;
    el.style.touchAction = 'none';
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.size === 2) lastDist = dist();
        if (pts.size === 1 && onStart) onStart();
        e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
        const p = pts.get(e.pointerId); if (!p) return;
        const k = el.width / el.getBoundingClientRect().width || 1;   // CSS px -> canvas px
        if (pts.size === 1) { onDrag((e.clientX - p.x) * k, (e.clientY - p.y) * k); }
        p.x = e.clientX; p.y = e.clientY;
        if (pts.size === 2) { const d = dist(); if (lastDist > 0 && d > 0) onPinch(d / lastDist); lastDist = d; }
    });
    const up = (e) => { pts.delete(e.pointerId); lastDist = pts.size === 2 ? dist() : 0; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => { e.preventDefault(); onPinch(e.deltaY < 0 ? 1.05 : 1 / 1.05); }, { passive: false });
}

export const debug = {
    engine: null, currentHotspotForSound: null, charPreviewImg: null, editingChar: null, isEditingPlayer: false,
    charOffX: 0, charOffY: 0, hitboxOffX: 0, hitboxOffY: 0, sheetX: 0, sheetY: 0,
    dragTargetType: 'image',
    bgEditScale: 1, bgEditX: 0, bgEditY: 0, bgPreviewImg: null, currentDialogues: [],
    previewTick: 0, previewInterval: null, imageChosen: false, animImages: {},
    editorType: 'hotspot',

    init(eng) { this.engine = eng; },
    $(id) { return document.getElementById(id); },
    get popup() { return this.engine.popup; },

    async saveConfig() {
        try {
            await this.engine.store.set("SirLicksConfig", this.engine.cleanConfig());
            try { localStorage.removeItem("SirLicksConfig"); } catch (e) {}
            await this.engine.gcMedia();   // drop uploaded files nothing uses any more
            this.popup.toast("Saved!");
        } catch (e) {
            this.popup.alert("Saving failed: " + e.message + "\nUse BACKUP JSON as a fallback.");
        }
    },
    async resetEngine() {
        const choice = await this.popup.choice("Wipe everything?\nYour saved project in this browser will be deleted and the default project is loaded.", [
            { label: 'Cancel', value: null, cancel: true },
            { label: 'Backup first, then wipe', value: 'backup', primary: true },
            { label: 'Wipe without backup', value: 'wipe', danger: true }
        ]);
        if (!choice) return;
        if (choice === 'backup') { await this.exportJSON(); await new Promise(r => setTimeout(r, 800)); }
        await this.engine.store.del("SirLicksConfig");
        for (const k of await this.engine.store.keys('media:')) await this.engine.store.del(k);
        location.reload();
    },

    // (re)creates a dialog so its event handlers are always attached - even if an
    // old saved index.html already contains a copy of it
    makeDialog(id, html) {
        const old = this.$(id); if (old) old.remove();
        const d = document.createElement('div'); d.id = id; d.className = 'modal-dialog hidden'; d.innerHTML = html;
        this.$('gameContainer').appendChild(d);
        return d;
    },

    setupDialogs() {
        const oldQ = this.$('quick-img-upload'); if (oldQ) oldQ.remove();

        this.makeDialog('char-creator-dialog', `
            <h3 id="char-editor-title">Edit</h3>
            <div class="char-editor-body">
                <div class="char-preview-pane">
                    <div class="preview-toolbar">
                        <button id="btn-drag-img" class="tiny-btn active">Image</button>
                        <button id="btn-drag-grid" class="tiny-btn anim-only">Frame</button>
                        <button id="btn-drag-box" class="tiny-btn">Hitbox</button>
                    </div>
                    <canvas id="char-preview-canvas" width="600" height="400"></canvas>
                    <p class="help-text" id="gesture-help"></p>
                    <div class="char-checkbox anim-only preview-anim-row">
                        <label><input type="checkbox" id="preview-animate"> Play</label>
                        <select id="preview-anim">${ALL_ANIMS.map(a => `<option value="${a}">${ANIM_LABELS[a]}</option>`).join('')}</select>
                    </div>
                </div>
                <div class="char-controls-pane">
                    <label>Name: <input type="text" id="char-name"></label>
                    <div id="kind-row"><label>Type:
                        <select id="char-kind"><option value="hotspot">Hotspot (click spot)</option><option value="character">Character (animated sprite)</option></select></label>
                    </div>

                    <div class="section-header">Image</div>
                    <label><input type="file" id="char-file" accept="image/*"></label>
                    <button id="char-clear-img" class="tiny-btn">Remove image</button>

                    <div class="section-header">Hitbox</div>
                    <div class="char-controls">
                        <div><label>Width: <input type="number" id="char-hb-w" value="60"></label></div>
                        <div><label>Height: <input type="number" id="char-hb-h" value="60"></label></div>
                    </div>
                    <div class="char-checkbox"><label><input type="checkbox" id="char-rect"> Square Hitbox</label></div>

                    <div class="section-header">Visuals</div>
                    <div class="char-controls">
                        <div><label>Scale: <input type="number" id="char-scale" value="1.0" step="0.05" min="0.02"></label></div>
                    </div>
                    <div class="anim-only">
                        <div class="section-header">Sprite sheet grid</div>
                        <div class="char-controls">
                            <div><label>Columns: <input type="number" id="char-cols" value="1" min="1"></label></div>
                            <div><label>Rows: <input type="number" id="char-rows" value="1" min="1"></label></div>
                        </div>
                        <p class="help-text" id="frame-size-info"></p>
                        <div class="section-header">Animations</div>
                        <div class="char-checkbox"><label><input type="checkbox" id="char-dirs"> Up / down animations (top-down games): used when walking up or down</label></div>
                        <table class="anim-table">
                            <tr><th>Use</th><th></th><th>Row</th><th>Col</th><th>Frames</th><th>Speed</th><th>Own image (optional)</th></tr>
                            ${ALL_ANIMS.map(a => `<tr id="anim-tr-${a}" class="${DIR_ANIMS.includes(a) ? 'dir-row' : ''}">
                                <td>${OPTIONAL_ANIMS.includes(a) ? `<input type="checkbox" id="an-${a}-on">` : '✓'}</td>
                                <td>${ANIM_LABELS[a]}</td>
                                <td><input type="number" id="an-${a}-row" min="1" value="1"></td>
                                <td><input type="number" id="an-${a}-col" min="1" value="1"></td>
                                <td><input type="number" id="an-${a}-frames" min="1" value="1"></td>
                                <td><input type="number" id="an-${a}-speed" min="1" value="10"></td>
                                <td class="anim-img-cell"><input type="file" id="an-${a}-file" accept="image/*"><span id="an-${a}-img" class="anim-img-name"></span>
                                    <span class="anim-grid" id="an-${a}-grid"><input type="number" id="an-${a}-gc" min="1" value="1" title="columns">×<input type="number" id="an-${a}-gr" min="1" value="1" title="rows"></span>
                                    <button id="an-${a}-clear" class="tiny-btn">✕</button></td></tr>`).join('')}
                        </table>
                        <p class="help-text">Row/Col = first frame (1 = top / left). Frames continue to the right and then on the next row,
                        so an animation can span several rows. Speed = ticks per frame (smaller = faster).<br>
                        Own image = a separate sheet for this animation; its grid (columns × rows) is detected automatically.
                        Idle plays while standing, Walk while moving, Run after a double tap (unticked Run = Walk played faster).</p>
                    </div>

                    <div class="player-only">
                        <div class="section-header">Movement</div>
                        <label>Walk speed: <span id="mv-walk-val"></span><input type="range" id="mv-walk" min="1" max="20" step="0.5"></label>
                        <label>Run speed: <span id="mv-run-val"></span><input type="range" id="mv-run" min="1" max="30" step="0.5"></label>
                        <div class="char-checkbox"><label><input type="checkbox" id="mv-allowrun"> Double tap to run</label></div>
                    </div>

                    <div class="npc-only">
                        <div class="section-header">Behavior</div>
                        <div class="char-checkbox"><label><input type="checkbox" id="char-mirror"> Mirror</label></div>
                        <div class="char-checkbox"><label><input type="checkbox" id="char-nearfade"> Only visible when near (fades in like a normal hotspot)</label></div>
                        <div class="char-checkbox char-only"><label><input type="checkbox" id="char-follow"> Follows Player</label></div>
                        <div class="char-checkbox"><label><input type="checkbox" id="char-flip-bubble"> Flip speech bubble (tail on the other side)</label></div>

                        <div class="section-header">Reactions (Look / Talk / Use / items)</div>
                        <div id="reactions-box"></div>

                        <div class="section-header">Visibility &amp; walking</div>
                        <div class="char-checkbox"><label><input type="checkbox" id="vis-start-hidden"> Starts hidden (an action "Show hotspot" reveals it)</label></div>
                        <div id="vis-conds"></div>
                        <div class="char-checkbox"><label><input type="checkbox" id="walk-none"> Act without walking there first</label></div>
                        <p class="help-text">Where the knight stands: DRAG mode shows a green ◆ walk-to point for every hotspot. <button id="walk-reset" class="mini-btn">Reset to automatic</button></p>

                        <div class="section-header">Sound (plays when clicked)</div>
                        <div class="sound-row"><select id="char-sound"></select><button id="char-sound-play" class="tiny-btn">▶</button></div>
                        <label>Add a new sound: <input type="file" id="char-sound-file" accept="audio/*"></label>

                        <div class="section-header">Simple lines (used when no reaction fits)</div>
                        <div id="dialog-list" class="dialog-list"></div>
                        <p class="help-text">Edit lines directly · ▲▼ = order · effect: angry shakes, calm floats</p>
                        <div class="dialog-inputs">
                            <input type="text" id="new-dialog-text" placeholder="Text...">
                            <select id="new-dialog-speaker"><option value="object">This Character</option><option value="knight">Player</option></select>
                        </div>
                        <button id="add-dialog-btn" class="tiny-btn">+ Add Line</button>

                        <div class="section-header">Exit / Discovery</div>
                        <div class="char-checkbox"><label><input type="checkbox" id="disc-on"> Leads to another level</label></div>
                        <div id="disc-fields">
                            <label>Target level: <select id="disc-target"></select></label>
                            <label>When clicked:
                                <select id="disc-mode">
                                    <option value="unlock">Discover: unlock an exit button</option>
                                    <option value="travel">Door: walk there and change level</option>
                                </select></label>
                            <label class="disc-unlock">Exit button text: <input type="text" id="disc-text" placeholder="To ..."></label>
                            <label>Message (player says): <input type="text" id="disc-msg" placeholder="I found a hidden path!"></label>
                            <div class="char-checkbox"><label><input type="checkbox" id="disc-hide"> Hide hotspot after it was found</label></div>
                        </div>
                    </div>

                    <div class="dialog-actions">
                        <button id="char-add-btn">Save</button>
                        <button id="char-delete-btn" style="background-color: #a00;">Delete</button>
                        <button id="char-cancel-btn">Cancel</button>
                    </div>
                </div>
            </div>`);

        this.$('char-kind').onchange = () => { this.setEditorType(this.$('char-kind').value); this.$('char-nearfade').checked = this.editorType === 'hotspot'; };
        this.$('btn-drag-img').onclick = () => this.setDragMode('image');
        this.$('btn-drag-grid').onclick = () => this.setDragMode('grid');
        this.$('btn-drag-box').onclick = () => this.setDragMode('hitbox');
        ['char-scale', 'char-hb-w', 'char-hb-h', 'char-rect', 'char-mirror', 'char-cols', 'char-rows',
         ...ALL_ANIMS.flatMap(a => [`an-${a}-row`, `an-${a}-col`, `an-${a}-frames`, `an-${a}-speed`, `an-${a}-gc`, `an-${a}-gr`])].forEach(id => this.$(id).addEventListener('input', () => this.updateCharPreview()));
        this.$('char-cols').addEventListener('change', () => {   // new column count: frames follow unless set by hand
            const c = parseInt(this.$('char-cols').value) || 1;
            ALL_ANIMS.forEach(a => { if (!this.animImages[a] && parseInt(this.$(`an-${a}-frames`).value) > c * (parseInt(this.$('char-rows').value) || 1)) this.$(`an-${a}-frames`).value = c; });
            this.updateCharPreview();
        });
        OPTIONAL_ANIMS.forEach(a => this.$(`an-${a}-on`).addEventListener('change', () => { this.updateAnimRows(); if (this.$(`an-${a}-on`).checked) { this.$('preview-anim').value = a; } this.updateCharPreview(); }));
        this.$('char-dirs').addEventListener('change', () => this.updateAnimRows());
        ALL_ANIMS.forEach(a => {
            this.$(`an-${a}-file`).onchange = async (ev) => {
                const f = ev.target.files[0]; if (!f) return;
                const path = await this.engine.putMedia(f, 'img');
                const im = await loadImg(this.engine.src(path));
                this.engine.img(path);
                const g = im ? guessGrid(im) : { cols: 1, rows: 1, sure: false };
                this.animImages[a] = path;
                this.$(`an-${a}-gc`).value = g.cols; this.$(`an-${a}-gr`).value = g.rows;
                this.$(`an-${a}-row`).value = 1; this.$(`an-${a}-col`).value = 1;
                this.$(`an-${a}-frames`).value = g.cols * g.rows;
                if (this.$(`an-${a}-on`)) this.$(`an-${a}-on`).checked = true;
                this.popup.toast(`${ANIM_LABELS[a]}: ${g.cols} × ${g.rows} frames ${g.sure ? 'found' : 'guessed - check the grid'}`);
                ev.target.value = '';
                this.updateAnimRows();
                this.$('preview-anim').value = a; this.$('preview-animate').checked = true; this.startPreviewAnim();
            };
            this.$(`an-${a}-clear`).onclick = () => { this.animImages[a] = null; this.updateAnimRows(); this.updateCharPreview(); };
        });
        const speedLabel = () => { this.$('mv-walk-val').textContent = this.$('mv-walk').value; this.$('mv-run-val').textContent = this.$('mv-run').value; };
        this.$('mv-walk').addEventListener('input', speedLabel); this.$('mv-run').addEventListener('input', speedLabel);
        this.$('preview-animate').addEventListener('change', (e) => { if (e.target.checked) this.startPreviewAnim(); else this.stopPreviewAnim(); });
        this.$('preview-anim').addEventListener('change', () => this.updateCharPreview());
        this.$('char-follow').addEventListener('change', () => this.updateAnimRows());
        this.$('char-file').addEventListener('change', (e) => this.handleCharFile(e));
        this.$('char-clear-img').onclick = () => { this.imageChosen = false; this.chosenImagePath = null; this.charPreviewImg = this.defaultPreviewImage(); this.$('char-file').value = ''; this.updateCharPreview(); };
        this.$('char-add-btn').onclick = () => this.saveCharacter();
        this.$('char-delete-btn').onclick = () => this.deleteCharacter();
        this.$('char-cancel-btn').onclick = () => { this.stopPreviewAnim(); this.$('char-creator-dialog').classList.add('hidden'); };
        this.$('add-dialog-btn').onclick = () => this.addDialogLine();
        this.$('disc-on').onchange = () => this.updateDiscoveryFields();
        this.$('char-sound-play').onclick = () => this.previewSound();
        this.$('walk-reset').onclick = (e) => { e.preventDefault(); this.resetWalkTo = true; this.popup.toast("Walk-to point will be automatic again"); };
        this.$('char-sound-file').onchange = async (ev) => { const f = ev.target.files[0]; if (f) await this.uploadObjectSound(f); ev.target.value = ''; };
        this.$('disc-mode').onchange = () => this.updateDiscoveryFields();

        // touch / mouse gestures on the preview
        const num = (id) => parseFloat(this.$(id).value) || 0;
        const setNum = (id, v, digits = 0) => { this.$(id).value = digits ? v.toFixed(digits) : Math.max(1, Math.round(v)); };
        attachGestures(this.$('char-preview-canvas'), {
            onDrag: (dx, dy) => {
                if (this.dragTargetType === 'image') { this.charOffX += dx; this.charOffY += dy; }
                else if (this.dragTargetType === 'hitbox') { this.hitboxOffX += dx; this.hitboxOffY += dy; }
                else { const sc = num('char-scale') || 1; this.sheetX -= dx / sc; this.sheetY -= dy / sc; }
                this.updateCharPreview();
            },
            onPinch: (f) => {
                if (this.dragTargetType === 'image') setNum('char-scale', Math.max(0.02, num('char-scale') * f), 3);
                else if (this.dragTargetType === 'hitbox') { setNum('char-hb-w', num('char-hb-w') * f); setNum('char-hb-h', num('char-hb-h') * f); }
                else setNum('char-scale', Math.max(0.02, num('char-scale') * f), 3);   // frame size comes from the grid, never from pinching
                this.updateCharPreview();
            }
        });

        this.makeDialog('bg-editor-dialog', `<h3>Background Editor</h3><div class="char-editor-body"><div class="char-preview-pane"><canvas id="bg-editor-canvas" width="960" height="540"></canvas><p class="help-text">Drag = move · Pinch / mouse wheel = zoom</p></div><div class="char-controls-pane"><label>Zoom (Scale): <input type="range" id="bg-scale" min="0.5" max="3" step="0.01" value="1"></label><p id="bg-scale-val">1.0</p><div class="dialog-actions"><button id="bg-reset-btn">Reset</button><button id="bg-save-btn">Save View</button><button id="bg-cancel-btn">Cancel</button></div></div></div>`);
        const setBgScale = (v) => { this.bgEditScale = Math.min(3, Math.max(0.5, v)); this.$('bg-scale').value = this.bgEditScale; this.$('bg-scale-val').innerText = this.bgEditScale.toFixed(2); this.updateBgPreview(); };
        this.$('bg-scale').addEventListener('input', (e) => setBgScale(parseFloat(e.target.value)));
        this.$('bg-save-btn').onclick = () => {
            const bc = this.engine.gameConfig.backgrounds[this.engine.scene] || {};
            this.engine.gameConfig.backgrounds[this.engine.scene] = Object.assign(bc, { x: Math.round(this.bgEditX), y: Math.round(this.bgEditY), scale: this.bgEditScale });
            this.engine.navDirty = true;
            this.$('bg-editor-dialog').classList.add('hidden');
        };
        this.$('bg-reset-btn').onclick = () => { this.bgEditX = 0; this.bgEditY = 0; setBgScale(1); };
        this.$('bg-cancel-btn').onclick = () => this.$('bg-editor-dialog').classList.add('hidden');
        attachGestures(this.$('bg-editor-canvas'), {
            onDrag: (dx, dy) => { this.bgEditX += dx; this.bgEditY += dy; this.updateBgPreview(); },
            onPinch: (f) => setBgScale(this.bgEditScale * f)
        });

        const oldSnd = this.$('sound-assignment-dialog'); if (oldSnd) oldSnd.remove();

        this.makeDialog('lick-editor-dialog', `<h3 id="le-title">Lick action</h3><label>Button Text: <input type="text" id="le-btn-text"></label><label>Response Text: <input type="text" id="le-resp-text"></label><label>Dignity Change: <input type="number" id="le-dig"></label><div class="dialog-actions"><button id="le-reset" style="background:#a00">Use default</button><button id="le-save">Save</button><button id="le-cancel">Cancel</button></div>`);
        this.$('le-save').onclick = () => this.saveLickConfig();
        this.$('le-cancel').onclick = () => this.$('lick-editor-dialog').classList.add('hidden');
        this.$('le-reset').onclick = () => { delete this.engine.gameConfig.levelLicks[this.engine.scene]; this.engine.updateUI(); this.$('lick-editor-dialog').classList.add('hidden'); this.popup.toast("This level uses the default lick action again"); };
    },

    showItems() { showItemsDialog(this); },
    async placePickup() {
        const items = this.engine.gameConfig.items || {};
        const ids = Object.keys(items);
        if (!ids.length) { this.popup.alert('Create items first (Game Settings → ITEMS & COMBINATIONS).'); return; }
        const id = await this.popup.choice('Which item should lie in the level?', [...ids.map(i => ({ label: items[i].name || i, value: i })), { label: 'Cancel', value: null, cancel: true }]);
        if (!id) return;
        this.engine.placeMode = 'item:' + id; this.engine.updateUI();
        this.popup.toast(`Tap where "${items[id].name || id}" should lie`);
    },
    // hotspot that shows the item icon; Use = pick it up, Look = description
    async makePickup(itemId, x, y) {
        const eng = this.engine, it = (eng.gameConfig.items || {})[itemId] || {};
        const h = {
            id: 'h_' + Math.random().toString(36).slice(2, 9), name: it.name || itemId, x, y, tx: x, ty: Math.max(20, y - 90),
            w: 70, h: 70, r: 35, shape: 'circle', hboxY: -30, anchor: 'object', sound: null, isCharacter: false, nearFade: false,
            reactions: [
                { verb: 'use', lines: [{ speaker: 'knight', text: `Got it: ${it.name || itemId}.` }], actions: [{ type: 'give', key: itemId }, { type: 'hide' }] },
                { verb: 'look', lines: [{ speaker: 'knight', text: it.desc || `A ${it.name || itemId}.` }] },
                { verb: 'talk', lines: [{ speaker: 'knight', text: "It's not very talkative." }] }
            ]
        };
        if (it.icon) {
            const im = await loadImg(eng.src(it.icon));
            if (im) Object.assign(h, { customImage: it.icon, cols: 1, rows: 1, frameWidth: im.naturalWidth, frameHeight: im.naturalHeight, totalFrames: 1, scale: Math.round(56 / Math.max(im.naturalWidth, im.naturalHeight) * 1000) / 1000 });
        }
        (eng.gameConfig.hotspots[eng.scene] || (eng.gameConfig.hotspots[eng.scene] = [])).push(h);
        eng.updateUI();
        this.popup.toast(`${h.name} placed - EDIT it to change the reactions`);
    },
    showInteraction() { showInteractionDialog(this); },

    defaultPreviewImage() {
        const c = this.engine.gameConfig;
        if (this.editorType === 'player') return this.engine.img(c.knight.image);
        if (this.editorType === 'hotspot') return this.engine.img(c.ui.orb);
        return null;
    },

    // show only the fields that belong to what is being edited
    setEditorType(type) {
        this.editorType = type;
        const isPlayer = type === 'player', isHotspot = type === 'hotspot';
        const show = (sel, on) => this.$('char-creator-dialog').querySelectorAll(sel).forEach(el => el.style.display = on ? '' : 'none');
        show('.anim-only', !isHotspot);
        show('.npc-only', !isPlayer);
        show('.char-only', type === 'character');
        this.$('kind-row').style.display = isPlayer ? 'none' : '';
        this.$('char-kind').value = isPlayer ? 'hotspot' : type;
        this.$('char-delete-btn').style.display = isPlayer ? 'none' : '';
        if (isHotspot && this.dragTargetType === 'grid') this.setDragMode('image');
        this.updateAnimRows();
        const name = this.$('char-name').value;
        this.$('char-editor-title').textContent = isPlayer ? 'Edit Player' : `${this.editingChar ? 'Edit' : 'New'} ${isHotspot ? 'Hotspot' : 'Character'}${name ? ': ' + name : ''}`;
        if (!this.imageChosen) this.charPreviewImg = this.defaultPreviewImage();
        this.updateCharPreview();
    },

    setDragMode(mode) {
        this.dragTargetType = mode;
        this.$('btn-drag-img').classList.toggle('active', mode === 'image');
        this.$('btn-drag-grid').classList.toggle('active', mode === 'grid');
        this.$('btn-drag-box').classList.toggle('active', mode === 'hitbox');
        this.$('gesture-help').textContent = {
            image: 'Drag = move image · Pinch / wheel = scale',
            grid: 'Drag = move the frame grid over the sheet · Pinch / wheel = scale',
            hitbox: 'Drag = move hitbox · Pinch / wheel = hitbox size'
        }[mode];
    },

    updateDiscoveryFields() {
        const on = this.$('disc-on').checked;
        this.$('disc-fields').style.display = on ? '' : 'none';
        this.$('char-creator-dialog').querySelectorAll('.disc-unlock').forEach(el => el.style.display = this.$('disc-mode').value === 'unlock' ? '' : 'none');
    },

    // target: hotspot object, 'player', or null (new); kind for new objects: 'hotspot' | 'character'
    openEditor(target, kind = 'hotspot', pos = null) {
        this.newPos = pos;
        const cfg = this.engine.gameConfig;
        if (target === 'player') {
            const p = cfg.player;
            const k = cfg.knight;
            // default knight: its tuning lives in cfg.knight (image = assets/knight.png)
            this.showCharacterCreator(p || Object.assign({ name: 'Knight', offY: 35 }, k, { scale: k.baseScale || 0.55 }), true);
        } else if (target) this.showCharacterCreator(target, false);
        else this.showCharacterCreator(null, false, kind === 'character');
    },

    // show the animation rows that make sense for what is edited
    updateAnimRows() {
        const moves = this.editorType === 'player' || (this.editorType === 'character' && this.$('char-follow').checked);
        const dirs = this.$('char-dirs').checked;
        ALL_ANIMS.forEach(a => {
            const base = a.split('_')[0];
            const show = (base === 'idle' || moves) && (!DIR_ANIMS.includes(a) || dirs);
            this.$(`anim-tr-${a}`).style.display = show ? '' : 'none';
            const on = !OPTIONAL_ANIMS.includes(a) || this.$(`an-${a}-on`).checked;
            const opt = this.$('preview-anim').querySelector(`option[value=${a}]`);
            opt.disabled = !show || !on;
            const own = !!this.animImages[a];
            this.$(`an-${a}-img`).textContent = own ? '✓' : '';
            this.$(`an-${a}-grid`).style.display = own ? '' : 'none';
            this.$(`an-${a}-clear`).style.display = own ? '' : 'none';
            this.$(`anim-tr-${a}`).classList.toggle('anim-off', !on);
        });
        const sel = this.$('preview-anim');
        if (sel.selectedOptions[0] && sel.selectedOptions[0].disabled) sel.value = 'idle';
        this.$('char-creator-dialog').querySelectorAll('.player-only').forEach(el => el.style.display = this.editorType === 'player' ? '' : 'none');
    },

    // sprite description from the form (same structure the game reads)
    readSprite() {
        const int = (id, d = 1) => Math.max(1, parseInt(this.$(id).value) || d);
        const img = this.charPreviewImg;
        const W = img && img.naturalWidth ? img.naturalWidth : 100, H = img && img.naturalHeight ? img.naturalHeight : 100;
        const isHotspot = this.editorType === 'hotspot';
        const cols = isHotspot ? 1 : int('char-cols'), rows = isHotspot ? 1 : int('char-rows');
        const anim = (a) => {
            const own = this.animImages[a];
            const gc = own ? int(`an-${a}-gc`) : cols, gr = own ? int(`an-${a}-gr`) : rows;
            const o = { row: Math.min(gr, int(`an-${a}-row`)) - 1, col: Math.min(gc, int(`an-${a}-col`)) - 1, frames: int(`an-${a}-frames`), speed: int(`an-${a}-speed`, 10) };
            o.frames = Math.min(o.frames, Math.max(1, gc * gr - (o.row * gc + o.col)));
            if (own) { o.image = own; o.cols = gc; o.rows = gr; }
            return o;
        };
        const s = {
            customImage: this.imageChosen ? this.chosenImagePath : undefined,
            image: this.imageChosen ? undefined : (img ? relSrc(img.src) : undefined),
            cols, rows, frameWidth: W / cols, frameHeight: H / rows,
            sheetX: Math.round(this.sheetX), sheetY: Math.round(this.sheetY),
            offX: Math.round(this.charOffX), offY: Math.round(this.charOffY)
        };
        if (isHotspot) s.anims = { idle: { row: 0, frames: 1, speed: 10 }, walk: { row: 0, frames: 1, speed: 10 } };
        else {
            s.anims = { idle: anim('idle'), walk: anim('walk') };
            if (this.$('an-run-on').checked) s.anims.run = anim('run');
            s.dirs = this.$('char-dirs').checked;
            if (s.dirs) DIR_ANIMS.forEach(a => { if (this.$(`an-${a}-on`).checked) s.anims[a] = anim(a); });
        }
        s.totalFrames = s.anims.idle.image ? cols : s.anims.idle.frames;   // older engines: looping NPC frames
        s.animSpeed = s.anims.idle.speed;
        return s;
    },
    // fill grid + animation fields from a sprite object (image must be loaded for old projects)
    fillSprite(e, kind) {
        const sizeOf = (p) => (p === (e.customImage || e.image) && this.charPreviewImg && this.charPreviewImg.naturalWidth)
            ? { w: this.charPreviewImg.naturalWidth, h: this.charPreviewImg.naturalHeight } : this.engine.sizeOf(p);
        const info = spriteInfo(e, kind === 'hotspot' ? 'character' : kind, sizeOf);
        this.$('char-cols').value = info.cols; this.$('char-rows').value = info.rows;
        this.animImages = {};
        const stored = e.anims || {};
        this.$('char-dirs').checked = !!e.dirs;
        ALL_ANIMS.forEach(a => {
            const an = info.anims[a] || stored[a] || info.anims[a.split('_')[0]] || info.anims.idle;
            this.$(`an-${a}-row`).value = (an.row || 0) + 1;
            this.$(`an-${a}-col`).value = (an.col || 0) + 1;
            this.$(`an-${a}-frames`).value = an.frames || 1;
            this.$(`an-${a}-speed`).value = an.speed || 10;
            this.$(`an-${a}-gc`).value = an.cols || an.frames || 1;
            this.$(`an-${a}-gr`).value = an.rows || 1;
            if (OPTIONAL_ANIMS.includes(a)) this.$(`an-${a}-on`).checked = !!stored[a];
            if (an.image && (stored[a] || !OPTIONAL_ANIMS.includes(a))) { this.animImages[a] = an.image; this.engine.img(an.image); }
        });
        // movement (player)
        const kc = this.engine.gameConfig.knight;
        this.$('mv-walk').value = kc.speed || 6; this.$('mv-run').value = kc.runSpeed || Math.round((kc.speed || 6) * 1.8);
        this.$('mv-allowrun').checked = kc.allowRun !== false;
        this.$('mv-walk-val').textContent = this.$('mv-walk').value; this.$('mv-run-val').textContent = this.$('mv-run').value;
        this.updateAnimRows();
    },

    showCharacterCreator(existingChar = null, isPlayer = false, forceAsCharacter = false) {
        this.$('char-creator-dialog').classList.remove('hidden');
        this.editingChar = isPlayer ? null : existingChar;
        this.isEditingPlayer = isPlayer;
        this.stopPreviewAnim();
        this.$('preview-animate').checked = false;
        this.$('preview-anim').value = 'idle';
        this.$('char-file').value = '';
        this.setDragMode('image');
        const e = existingChar || {};
        this.$('char-name').value = e.name || '';
        this.imageChosen = !!e.customImage;
        this.chosenImagePath = e.customImage || null;
        this.fillSoundSelect(e.sound);
        this.$('char-flip-bubble').checked = !!e.flipBubble;

        let type = 'hotspot';
        if (isPlayer) type = 'player';
        else if (forceAsCharacter || e.isCharacter) type = 'character';

        this.$('char-scale').value = e.scale || 1;
        this.$('char-hb-w').value = e.w || (e.r ? e.r * 2 : 60);
        this.$('char-hb-h').value = e.h || (e.r ? e.r * 2 : 60);
        this.$('char-rect').checked = e.shape === 'rect';
        this.$('char-mirror').checked = !!e.mirrored;
        this.$('char-follow').checked = !!e.followPlayer;
        this.$('char-nearfade').checked = e.nearFade ?? !(forceAsCharacter || e.isCharacter);
        this.charOffX = e.offX || 0; this.charOffY = e.offY || 0;
        this.hitboxOffX = e.hboxX || 0; this.hitboxOffY = e.hboxY || 0;
        this.sheetX = e.sheetX || 0; this.sheetY = e.sheetY || 0;
        this.currentDialogues = e.dialogues ? e.dialogues.map(d => ({ ...d })) : [];
        // reactions, visibility, walking
        this.currentReactions = JSON.parse(JSON.stringify(e.reactions || []));
        this.currentVisibleIf = JSON.parse(JSON.stringify(e.visibleIf || []));
        this.resetWalkTo = false;
        this.$('vis-start-hidden').checked = !!e.startHidden;
        this.$('walk-none').checked = !!e.noWalk;
        if (!isPlayer) {
            const ctx = makeCtx(this.engine, this.currentReactions);
            reactionsEditor(this.$('reactions-box'), this.currentReactions, ctx);
            const vc = this.$('vis-conds'); vc.innerHTML = ''; vc.appendChild(condsEditor(this.currentVisibleIf, ctx, 'Visible only if'));
        }

        // exit / discovery
        const sel = this.$('disc-target'); sel.innerHTML = '';
        Object.keys(this.engine.gameConfig.spawns).filter(s => s !== this.engine.scene).forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });
        this.$('disc-on').checked = !!e.discoverLevel;
        if (e.discoverLevel) sel.value = e.discoverLevel;
        this.$('disc-mode').value = e.discoverMode || 'unlock';
        this.$('disc-text').value = e.discoverText || '';
        this.$('disc-msg').value = e.discoverMsg || '';
        this.$('disc-hide').checked = e.discoverHide !== false;
        this.updateDiscoveryFields();

        this.setEditorType(type);
        const src = e.customImage;
        this.charPreviewImg = src ? this.engine.img(src) : this.defaultPreviewImage();
        const im = this.charPreviewImg;
        const apply = () => { this.fillSprite(e, type); this.updateCharPreview(); };
        if (!im || this.engine.ready(im)) apply(); else im.addEventListener('load', apply, { once: true });
        this.renderDialogList();
    },

    startPreviewAnim() {
        if (this.previewInterval) clearInterval(this.previewInterval);
        this.previewTick = 0;
        this.previewInterval = setInterval(() => { this.previewTick++; this.updateCharPreview(); }, 1000 / 60);
    },
    stopPreviewAnim() {
        if (this.previewInterval) clearInterval(this.previewInterval);
        this.previewInterval = null; this.previewTick = 0;
        this.updateCharPreview();
    },

    updateCharPreview() {
        const cvs = this.$('char-preview-canvas');
        if (!cvs || !this.engine || !this.engine.gameConfig) return;
        const ctx = cvs.getContext('2d');
        ctx.fillStyle = "#111"; ctx.fillRect(0, 0, 600, 400);
        const eng = this.engine;
        const bgImg = eng.img(eng.sceneImages().bg);
        let fx = 480, fy = 270;
        if (this.isEditingPlayer && eng.isGameRunning) { fx = eng.knight.x; fy = eng.knight.y; }
        else if (this.editingChar && this.editingChar.x !== undefined) { fx = this.editingChar.x; fy = this.editingChar.y; }
        else if (this.newPos) { fx = this.newPos.x; fy = this.newPos.y; }
        if (eng.ready(bgImg)) { const r = eng.bgRect(); ctx.save(); ctx.translate(300 - fx, 200 - fy); ctx.drawImage(bgImg, r.x, r.y, r.w, r.h); ctx.restore(); }
        let scale = parseFloat(this.$('char-scale').value) || 1;
        // the player is shown at the size it has where it stands
        if (this.isEditingPlayer && eng.isGameRunning) {
            const d = eng.depth(eng.scene, fx, fy);
            if (!this.imageChosen) scale *= d;   // default knight: baseScale × depth
            else { const sp = eng.gameConfig.spawns[eng.scene]; scale *= d / (eng.depth(eng.scene, sp.x, sp.y) || 1); }
        }
        const img = this.charPreviewImg;
        const isHotspot = this.editorType === 'hotspot';
        const mirror = this.$('char-mirror').checked;
        const cx = 300, cy = 200;
        const playing = this.$('preview-animate').checked;
        const info_el = this.$('frame-size-info');
        if (img && img.complete && img.naturalWidth) {
            ctx.save(); ctx.translate(cx, cy);
            if (isHotspot && !this.imageChosen) { ctx.globalAlpha = 0.8; ctx.drawImage(img, -25, -25, 50, 50); }   // default orb, as in game
            else {
                const spr = this.readSprite();
                const sizeOf = (p) => (p === spr.customImage || p === spr.image) ? { w: img.naturalWidth, h: img.naturalHeight } : eng.sizeOf(p);
                spr.customImage = spr.customImage || spr.image;
                const info = spriteInfo(spr, this.editorType === 'player' ? 'player' : 'character', sizeOf);
                const anim = this.$('preview-anim').value;
                const fr = spriteFrame(info, anim, playing ? this.previewTick : 0, sizeOf);
                const fim = fr.path === spr.customImage ? img : eng.img(fr.path);
                const drawW = fr.sw * fr.k * scale, drawH = fr.sh * fr.k * scale;
                if (mirror) ctx.scale(-1, 1);
                if (eng.ready(fim)) ctx.drawImage(fim, fr.sx, fr.sy, fr.sw, fr.sh, -drawW / 2 + this.charOffX, -drawH + this.charOffY, drawW, drawH);
                if (!playing && !isHotspot) { ctx.strokeStyle = "rgba(0,255,255,0.8)"; ctx.lineWidth = 1; ctx.setLineDash([4, 2]); ctx.strokeRect(-drawW / 2 + this.charOffX, -drawH + this.charOffY, drawW, drawH); }
                if (info_el) info_el.textContent = isHotspot ? '' : `Frame: ${Math.round(info.fw)} × ${Math.round(info.fh)} px (sheet ${img.naturalWidth} × ${img.naturalHeight})`;
            }
            ctx.restore();
        }
        ctx.save(); ctx.strokeStyle = this.dragTargetType === 'hitbox' ? "#FFFF00" : "rgba(255,255,0,0.6)"; ctx.lineWidth = 3; ctx.beginPath();
        const w = parseFloat(this.$('char-hb-w').value) || 60, h = parseFloat(this.$('char-hb-h').value) || 60;
        const hx = cx + this.hitboxOffX, hy = cy + this.hitboxOffY;
        if (this.$('char-rect').checked) ctx.strokeRect(hx - w / 2, hy - h / 2, w, h); else { ctx.arc(hx, hy, w / 2, 0, Math.PI * 2); ctx.stroke(); }
        ctx.strokeStyle = "red"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx - 5, cy); ctx.lineTo(cx + 5, cy); ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 5); ctx.stroke();
        ctx.restore();
    },

    async handleCharFile(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const path = await this.engine.putMedia(file, 'img');   // sprite sheets keep their exact pixels
        const im = new Image();
        im.onload = () => {
            this.charPreviewImg = im; this.imageChosen = true; this.chosenImagePath = path;
            // guess the grid: frames side by side, roughly as wide as high
            const g = this.editorType === 'hotspot' ? { cols: 1, rows: 1, sure: true } : guessGrid(im);
            const cols = g.cols;
            this.$('char-cols').value = cols; this.$('char-rows').value = g.rows;
            this.animImages = {};
            ALL_ANIMS.forEach(a => { this.$(`an-${a}-row`).value = 1; this.$(`an-${a}-col`).value = 1; this.$(`an-${a}-frames`).value = cols; });
            if (g.rows > 1) {   // several rows: guess idle = row 1, walk = row 2, run = row 3 (adjust if needed)
                this.$('an-walk-row').value = Math.min(2, g.rows); this.$('an-run-row').value = Math.min(3, g.rows);
            }
            this.$('an-idle-frames').value = this.editorType === 'player' && g.rows === 1 ? 1 : cols;
            this.updateAnimRows();
            const fh = im.naturalHeight / g.rows;
            this.$('char-scale').value = fh > 200 ? Math.max(0.1, Math.round(150 / fh * 10) / 10) : 1.0;
            this.charOffX = 0; this.charOffY = 0; this.sheetX = 0; this.sheetY = 0;
            this.updateCharPreview();
            if (cols > 1 || g.rows > 1) this.popup.toast(`${g.sure ? 'Found' : 'Guessed'} a ${cols} × ${g.rows} grid - adjust Columns/Rows if needed`);
        };
        im.src = this.engine.src(path);
    },

    saveCharacter() {
        const num = (id) => parseFloat(this.$(id).value);
        const type = this.editorType;
        const hasImg = this.imageChosen && this.charPreviewImg;
        const spr = this.readSprite();
        const data = {
            name: this.$('char-name').value,
            scale: num('char-scale') || 1,
            cols: spr.cols, rows: spr.rows, frameWidth: spr.frameWidth, frameHeight: spr.frameHeight,
            totalFrames: spr.totalFrames, animSpeed: spr.animSpeed, anims: spr.anims, dirs: spr.dirs || undefined,
            offX: spr.offX, offY: spr.offY,
            hboxX: Math.round(this.hitboxOffX), hboxY: Math.round(this.hitboxOffY),
            sheetX: spr.sheetX, sheetY: spr.sheetY,
            w: num('char-hb-w'), h: num('char-hb-h'), r: num('char-hb-w') / 2,
            shape: this.$('char-rect').checked ? 'rect' : 'circle',
            mirrored: this.$('char-mirror').checked,
            followPlayer: type === 'character' && this.$('char-follow').checked,
            nearFade: this.$('char-nearfade').checked,
            isCharacter: type === 'character' || type === 'player'
        };
        if (hasImg) data.customImage = this.chosenImagePath || relSrc(this.charPreviewImg.src);
        const cfg = this.engine.gameConfig;

        if (type === 'player') {
            Object.assign(cfg.knight, { speed: parseFloat(this.$('mv-walk').value) || 6, runSpeed: parseFloat(this.$('mv-run').value) || 11, allowRun: this.$('mv-allowrun').checked });
            if (!hasImg) { // default knight: keep its tuning in cfg.knight
                Object.assign(cfg.knight, {
                    offX: data.offX, offY: data.offY, baseScale: data.scale, cols: data.cols, rows: data.rows, dirs: data.dirs,
                    frameWidth: data.frameWidth, frameHeight: data.frameHeight, frames: data.anims.walk.frames,
                    animSpeed: data.anims.walk.speed, anims: data.anims, sheetX: data.sheetX, sheetY: data.sheetY
                });
                cfg.player = null;
            } else cfg.player = data;
        } else {
            data.dialogues = this.currentDialogues.filter(d => d.text && d.text.trim());
            const rs = cleanReactions(this.currentReactions); if (rs.length) data.reactions = rs;
            const vis = (this.currentVisibleIf || []).filter(c => c && c.type && c.key); if (vis.length) data.visibleIf = vis;
            if (this.$('vis-start-hidden').checked) data.startHidden = true;
            if (this.$('walk-none').checked) data.noWalk = true;
            data.sound = this.$('char-sound').value || null;
            data.flipBubble = this.$('char-flip-bubble').checked;
            if (this.$('disc-on').checked && this.$('disc-target').value) {
                Object.assign(data, {
                    discoverLevel: this.$('disc-target').value, discoverMode: this.$('disc-mode').value,
                    discoverText: this.$('disc-text').value || undefined, discoverMsg: this.$('disc-msg').value || undefined,
                    discoverHide: this.$('disc-hide').checked
                });
            }
            if (type === 'hotspot' && !hasImg) { delete data.anims; delete data.cols; delete data.rows; }
            let target = this.editingChar;
            if (!target) {
                const list = cfg.hotspots[this.engine.scene] || (cfg.hotspots[this.engine.scene] = []);
                const p = this.newPos || { x: 480, y: 300 };
                target = { id: 'h_' + Math.random().toString(36).slice(2, 9), x: p.x, y: p.y, tx: p.x, ty: Math.max(20, p.y - 160), anchor: 'object', sound: null };
                list.push(target);
            }
            if (this.resetWalkTo) delete target.walkTo;
            ['customImage', 'anims', 'dirs', 'reactions', 'visibleIf', 'startHidden', 'noWalk', 'discoverLevel', 'discoverMode', 'discoverText', 'discoverMsg', 'discoverHide', 'isDiscovered', '_found'].forEach(k => delete target[k]);
            Object.keys(data).forEach(k => { if (data[k] === undefined) delete data[k]; });
            Object.assign(target, data);
        }
        this.stopPreviewAnim();
        this.engine.updateUI();
        this.$('char-creator-dialog').classList.add('hidden');
        this.popup.toast("Saved " + (data.name || type) + " (remember SAVE CONFIG)");
    },

    async deleteCharacter() {
        if (this.isEditingPlayer) return;
        if (this.editingChar) {
            if (await this.popup.confirm(`Permanently delete "${this.editingChar.name || 'this object'}"?`, { ok: 'Delete', danger: true })) {
                const list = this.engine.gameConfig.hotspots[this.engine.scene] || [];
                const i = list.indexOf(this.editingChar);
                if (i > -1) list.splice(i, 1);
                this.engine.updateUI();
                this.$('char-creator-dialog').classList.add('hidden');
            }
        } else this.$('char-creator-dialog').classList.add('hidden');
    },

    // ---------- dialogues: edit text, speaker, effect, order ----------
    addDialogLine() {
        const t = this.$('new-dialog-text').value;
        if (t) { this.currentDialogues.push({ text: t, speaker: this.$('new-dialog-speaker').value }); this.renderDialogList(); this.$('new-dialog-text').value = ""; }
    },
    renderDialogList() {
        const l = this.$('dialog-list'); if (!l) return; l.innerHTML = "";
        if (!this.currentDialogues.length) { l.innerHTML = '<div class="help-text">No lines yet - the hotspot says its name.</div>'; return; }
        this.currentDialogues.forEach((d, i) => {
            const row = document.createElement('div'); row.className = "dialog-item " + (d.speaker === 'knight' ? 'player-text' : 'char-text');
            const spk = document.createElement('select');
            [['object', 'Char'], ['knight', 'Player']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if ((d.speaker || 'object') === v) o.selected = true; spk.appendChild(o); });
            spk.onchange = () => { d.speaker = spk.value; row.className = "dialog-item " + (d.speaker === 'knight' ? 'player-text' : 'char-text'); };
            const txt = document.createElement('input'); txt.type = 'text'; txt.value = d.text; txt.oninput = () => { d.text = txt.value; };
            const eff = document.createElement('select'); eff.title = 'Text effect';
            [['', 'normal'], ['angry', 'angry (shake)'], ['peace', 'calm (float)']].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; if ((d.effect || '') === v) o.selected = true; eff.appendChild(o); });
            eff.onchange = () => { if (eff.value) d.effect = eff.value; else delete d.effect; };
            const mk = (t, fn, hide) => { const b = document.createElement('button'); b.textContent = t; b.onclick = fn; if (hide) b.style.visibility = 'hidden'; return b; };
            const swap = (j) => { const a = this.currentDialogues; [a[i], a[j]] = [a[j], a[i]]; this.renderDialogList(); };
            row.append(spk, txt, eff, mk('▲', () => swap(i - 1), i === 0), mk('▼', () => swap(i + 1), i === this.currentDialogues.length - 1), mk('X', () => this.removeDialogLine(i)));
            l.appendChild(row);
        });
    },
    removeDialogLine(i) { this.currentDialogues.splice(i, 1); this.renderDialogList(); },

    // ---------- sound inside the EDIT window ----------
    fillSoundSelect(current) {
        const sel = this.$('char-sound'); sel.innerHTML = '';
        const c = this.engine.gameConfig;
        const names = Object.keys(c.audio).filter(k => k !== 'music' && k !== 'click' && !c.spawns[k]);
        [['', '(no sound)'], ...names.map(n => [n, n])].forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
        if (current && !names.includes(current)) { const o = document.createElement('option'); o.value = current; o.textContent = current + ' (missing file)'; sel.appendChild(o); }
        sel.value = current || '';
    },
    async uploadObjectSound(file) {
        const base = (this.$('char-name').value || 'sound').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'sound';
        const c = this.engine.gameConfig;
        let name = base, n = 2;
        while (c.audio[name] || c.spawns[name] || name === 'music' || name === 'click') name = `${base}_${n++}`;
        c.audio[name] = await this.engine.putMedia(file, 'audio');
        this.fillSoundSelect(name);
        this.popup.toast(`Sound "${name}" added`);
    },
    previewSound() {
        const name = this.$('char-sound').value; if (!name) return;
        const a = this.engine.audio(name); if (!a) return;
        a.loop = false; a.currentTime = 0; a.volume = this.engine.sfxVolume || 0.5; a.play().catch(() => {});
    },

    // ---------- lick action: per level or default for all ----------
    showLickEditor(global = false) {
        const c = this.engine.gameConfig;
        this.lickGlobal = global;
        this.$('lick-editor-dialog').classList.remove('hidden');
        const own = c.levelLicks[this.engine.scene];
        const l = global ? c.lickConfig : (own || c.lickConfig);
        this.$('le-title').textContent = global ? 'Default lick action (all levels)' : `Lick action: ${this.engine.scene}` + (own ? '' : ' (uses default)');
        this.$('le-reset').style.display = (!global && own) ? '' : 'none';
        this.$('le-btn-text').value = l.text; this.$('le-resp-text').value = l.response; this.$('le-dig').value = l.dignityChange;
    },
    saveLickConfig() {
        const conf = { text: this.$('le-btn-text').value, response: this.$('le-resp-text').value, dignityChange: parseInt(this.$('le-dig').value) || 0 };
        const c = this.engine.gameConfig;
        if (this.lickGlobal) c.lickConfig = conf; else c.levelLicks[this.engine.scene] = conf;
        this.engine.updateUI();
        this.$('lick-editor-dialog').classList.add('hidden');
    },

    showBackgroundEditor() {
        const eng = this.engine;
        this.$('bg-editor-dialog').classList.remove('hidden');
        this.bgPreviewImg = eng.img(eng.sceneImages().bg);
        const bc = eng.gameConfig.backgrounds[eng.scene] || {};
        this.bgEditScale = bc.scale || 1; this.bgEditX = bc.x || 0; this.bgEditY = bc.y || 0;
        this.$('bg-scale').value = this.bgEditScale; this.$('bg-scale-val').innerText = this.bgEditScale.toFixed(2);
        this.updateBgPreview();
    },
    updateBgPreview() {
        const cvs = this.$('bg-editor-canvas'); const ctx = cvs.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 960, 540);
        const eng = this.engine;
        if (!eng.ready(this.bgPreviewImg)) return;
        const bc = eng.gameConfig.backgrounds[eng.scene] || (eng.gameConfig.backgrounds[eng.scene] = {});
        const saved = { x: bc.x, y: bc.y, scale: bc.scale };
        Object.assign(bc, { x: this.bgEditX, y: this.bgEditY, scale: this.bgEditScale });
        const r = eng.bgRect();
        Object.assign(bc, saved);
        ctx.drawImage(this.bgPreviewImg, r.x, r.y, r.w, r.h);
        ctx.strokeStyle = 'rgba(255,255,0,0.6)'; ctx.lineWidth = 3; ctx.strokeRect(1, 1, 958, 538);
    },

    // ---------- exits & levels ----------
    addExit() {
        const target = this.$('exit-target-select').value;
        if (!target) { this.popup.alert("Create a second level first (+ LEVEL)."); return; }
        const eng = this.engine;
        const text = this.$('exit-btn-text').value || `To ${eng.pretty(target)}`;
        const ex = eng.gameConfig.exits;
        (ex[eng.scene] || (ex[eng.scene] = [])).push({ target, text });
        if (this.$('exit-auto-return').checked) {
            if (!ex[target]) ex[target] = [];
            if (!ex[target].find(e => e.target === eng.scene)) ex[target].push({ target: eng.scene, text: `To ${eng.pretty(eng.scene)}` });
        }
        eng.updateUI();
    },
    async renameExit(i) {
        const ex = this.engine.gameConfig.exits[this.engine.scene][i];
        const t = await this.popup.prompt(`Button text for the exit to "${ex.target}":`, ex.text);
        if (t !== null && t.trim()) { ex.text = t.trim(); this.engine.updateUI(); }
    },
    moveExit(i, dir) {
        const a = this.engine.gameConfig.exits[this.engine.scene];
        [a[i], a[i + dir]] = [a[i + dir], a[i]];
        this.engine.updateUI();
    },
    async addLevel() {
        const name = ((await this.popup.prompt("New level name:")) || '').trim();
        const c = this.engine.gameConfig;
        if (!name) return;
        if (c.spawns[name] || name === 'music' || name === 'click') { this.popup.alert("That name is already used."); return; }
        c.spawns[name] = { x: 480, y: 400 };
        c.hotspots[name] = []; c.exits[name] = []; c.images[name] = {};
        c.backgrounds[name] = { x: 0, y: 0, scale: 1, fit: 'stretch' };
        c.perspective[name] = { axis: 'y', from: 300, to: 540, far: 0.5, near: 1.1, exp: 1 };
        c.sceneOrder.push(name);
        this.engine.setScene(name);
    },
    async renameLevel() {
        const eng = this.engine, c = eng.gameConfig, old = eng.scene;
        const name = ((await this.popup.prompt(`Rename level "${old}" to:`, old)) || '').trim();
        if (!name || name === old) return;
        if (c.spawns[name] || c.audio[name] || name === 'music' || name === 'click') { this.popup.alert("That name is already used."); return; }
        for (const k of ['spawns', 'hotspots', 'backgrounds', 'exits', 'images', 'perspective', 'levelLicks', 'levelFollowerAccess', 'audio']) {
            if (c[k] && Object.prototype.hasOwnProperty.call(c[k], old)) { c[k][name] = c[k][old]; delete c[k][old]; }
        }
        const oldLabel = `To ${eng.pretty(old)}`, oldLabel2 = `To ${old}`;
        for (const list of Object.values(c.exits)) list.forEach(e => {
            if (e.target === old) { e.target = name; if (e.text === oldLabel || e.text === oldLabel2) e.text = `To ${eng.pretty(name)}`; }
        });
        for (const list of Object.values(c.hotspots)) list.forEach(h => { if (h.discoverLevel === old) h.discoverLevel = name; });
        c.sceneOrder = c.sceneOrder.map(s => s === old ? name : s);
        if (c.startScene === old) c.startScene = name;
        for (const list of Object.values(eng.unlockedExits)) list.forEach(e => { if (e.target === old) e.target = name; });
        if (eng.unlockedExits[old]) { eng.unlockedExits[name] = eng.unlockedExits[old]; delete eng.unlockedExits[old]; }
        if (eng.audioCache.has(old)) { eng.audioCache.set(name, eng.audioCache.get(old)); eng.audioCache.delete(old); }
        eng.scene = name;
        eng.updateUI();
        this.popup.toast(`Level renamed to "${name}"`);
    },
    async deleteLevel() {
        const c = this.engine.gameConfig;
        if (Object.keys(c.spawns).length <= 1) { this.popup.alert("Cannot delete the last level."); return; }
        const old = this.engine.scene;
        if (!(await this.popup.confirm(`Permanently delete level '${old}'?`, { ok: 'Delete', danger: true }))) return;
        for (const k of ['spawns', 'hotspots', 'backgrounds', 'exits', 'images', 'perspective', 'levelLicks', 'levelFollowerAccess']) delete c[k][old];
        delete c.audio[old];
        for (const s of Object.keys(c.exits)) c.exits[s] = c.exits[s].filter(e => e.target !== old);
        for (const list of Object.values(c.hotspots)) list.forEach(h => { if (h.discoverLevel === old) delete h.discoverLevel; });
        c.sceneOrder = c.sceneOrder.filter(s => s !== old);
        if (c.startScene === old) c.startScene = c.sceneOrder[0];
        this.engine.setScene(c.sceneOrder[0]);
    },
    cycleLevel(dir) {
        const order = this.engine.gameConfig.sceneOrder;
        const i = Math.max(0, order.indexOf(this.engine.scene));
        this.engine.setScene(order[(i + dir + order.length) % order.length]);
    },

    // ---------- uploads (stored as separate files in the browser, applied at once) ----------
    // big backgrounds are scaled down to max 2048 px; sprite sheets are never touched (frame coordinates!)
    async imageToMedia(file, { resize = true } = {}) {
        if (!resize) return this.engine.putMedia(file, 'img');
        const im = await loadImg(URL.createObjectURL(file));
        if (!im) throw new Error("Not an image");
        const max = 2048, longest = Math.max(im.naturalWidth, im.naturalHeight);
        if (longest <= max) return this.engine.putMedia(file, 'img');
        const s = max / longest, cv = document.createElement('canvas');
        cv.width = Math.round(im.naturalWidth * s); cv.height = Math.round(im.naturalHeight * s);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
        const blob = await new Promise(r => cv.toBlob(r, type, 0.92));
        this.popup.toast(`Image scaled down to ${cv.width}×${cv.height}`);
        return this.engine.putMedia(blob, 'img');
    },
    async uploadAudio(key, file) {
        const eng = this.engine;
        eng.gameConfig.audio[key] = await eng.putMedia(file, 'audio');
        const old = eng.audioCache.get(key); if (old) old.pause();
        eng.audioCache.delete(key);
        // play right away where it belongs
        if (eng.isGameRunning && !eng.isMuted && (key === 'music' || key === eng.scene)) {
            const a = eng.audio(key); a.loop = true; a.volume = key === 'music' ? eng.musicVolume : eng.ambVolume; a.play().catch(() => {});
        }
        this.popup.toast(key === 'music' ? "Music changed" : key === 'click' ? "Click sound changed" : "Level music changed");
    },
    removeAudio(key) {
        const eng = this.engine;
        const a = eng.audioCache.get(key); if (a) a.pause();
        eng.audioCache.delete(key); delete eng.gameConfig.audio[key];
        this.popup.toast("Level music removed");
    },
    async applyLevelImage(kind, file) {
        const c = this.engine.gameConfig;
        const path = await this.imageToMedia(file);
        (c.images[this.engine.scene] || (c.images[this.engine.scene] = {}))[kind] = path;
        this.engine.img(path);
        this.engine.navDirty = true;
        this.popup.toast({ bg: "Background", path: "Path image", fg: "Foreground" }[kind] + " changed");
    },
    async applyTitleBackground(input) {
        const f = input.files && input.files[0];
        if (!f) return;
        this.engine.gameConfig.titleScreen.backgroundImage = await this.imageToMedia(f);
        input.value = '';
        this.updateTitleScreenElements();
        this.popup.toast("Title background changed (remember SAVE CONFIG)");
    },
    updateTitleText() { this.engine.gameConfig.titleScreen.titleText = this.$('title-text-input').value; this.updateTitleScreenElements(); },
    updateTitleScreenElements() {
        const ts = this.engine.gameConfig.titleScreen;
        const h1 = document.querySelector('#startScreen h1');
        h1.textContent = ts.titleText; h1.style.display = ts.showTitleText === false ? 'none' : '';
        this.$('start-game-button').textContent = ts.startButtonText;
        const hasSave = !!this.engine.latestSave();
        this.$('continue-button').classList.toggle('hidden', !hasSave);
        this.$('load-title-button').classList.toggle('hidden', !hasSave);
        this.$('startScreen').style.backgroundImage = `url("${this.engine.src(ts.backgroundImage)}")`;
    },

    download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); },

    // backup = one self-contained file (uploaded files are embedded)
    async backupData() {
        const cfg = this.engine.cleanConfig();
        const cache = new Map();
        const walk = async (o) => {
            for (const k of Object.keys(o)) {
                const v = o[k];
                if (typeof v === 'string' && v.startsWith('media/')) {
                    if (!cache.has(v)) {
                        try { const b = await this.engine.mediaBlob(v); cache.set(v, await readFileAsDataURL(b)); } catch (e) { cache.set(v, v); }
                    }
                    o[k] = cache.get(v);
                } else if (v && typeof v === 'object') await walk(v);
            }
        };
        await walk(cfg);
        return cfg;
    },
    async exportJSON() {
        this.download(new Blob([JSON.stringify(await this.backupData())], { type: 'application/json' }), 'SirLicks_backup.json');
        this.popup.toast("Backup downloaded");
    },
    async importJSON(file) {
        try {
            const data = JSON.parse(await file.text());
            if (!data || !data.spawns) throw new Error("This is not a Sir Licks backup.");
            if (!(await this.popup.confirm("Replace the current project with this backup?", { ok: 'Replace', danger: true }))) return;
            for (const k of await this.engine.store.keys('media:')) await this.engine.store.del(k);
            await this.engine.store.set("SirLicksConfig", data);   // inline files are converted on load
            location.reload();
        } catch (e) { this.popup.alert("Import failed: " + e.message); }
    },

    // all asset paths a config references (images + audio + font)
    collectAssetRefs(cfg) {
        const imgs = new Set(), auds = new Set(), other = new Set();
        const addI = (s) => { if (s) imgs.add(s); };
        Object.values(cfg.images).forEach(s => { addI(s.bg); addI(s.path); addI(s.fg); });
        addI(cfg.ui.orb); addI(cfg.ui.bubble); addI(cfg.ui.panelBox); if (cfg.ui.font) other.add(cfg.ui.font);
        addI(cfg.knight.image); addI(cfg.titleScreen.backgroundImage);
        const addAnims = (o) => { if (o && o.anims) Object.values(o.anims).forEach(a => a && addI(a.image)); };
        addAnims(cfg.knight);
        if (cfg.player) { addI(cfg.player.customImage); addAnims(cfg.player); }
        Object.values(cfg.hotspots).forEach(l => l.forEach(h => { addI(h.customImage); addAnims(h); }));
        Object.values(cfg.items || {}).forEach(it => addI(it && it.icon));
        Object.values(cfg.audio).forEach(s => { if (s) auds.add(s); });
        return { imgs, auds, other };
    },

    async fetchBlob(src) {
        const r = await fetch(src);
        if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
        return r.blob();
    },

    requireZip() {
        if (window.JSZip) return true;
        this.popup.alert("JSZip could not be loaded. Export needs it.");
        return false;
    },

    // ===================== EXPORT FOR LUA =====================
    async exportLua() {
        if (!this.requireZip()) return;
        const status = (t) => { const b = document.querySelector('#buttons fieldset:last-of-type legend'); if (b) b.textContent = t; };
        try {
            status('Export: collecting...');
            const eng = this.engine;
            const cfg = eng.cleanConfig();
            const zip = new JSZip();
            const missing = [];

            // 1) data: URLs -> real files under assets/custom/
            const dataMap = new Map(); let n = 0;
            const fileFor = (src, kind) => {
                if (!src) return src;
                if (!src.startsWith('data:')) return relSrc(src);   // assets/... and media/... keep their path
                if (dataMap.has(src)) return dataMap.get(src);
                const mime = src.slice(5, src.indexOf(';'));
                const ext = MIME_EXT[mime] || (kind === 'audio' ? 'ogg' : 'png');
                const path = `assets/custom/${kind}_${++n}.${ext}`;
                zip.file(path, src.slice(src.indexOf(',') + 1), { base64: true });
                dataMap.set(src, path);
                return path;
            };
            for (const s of Object.values(cfg.images)) for (const k of ['bg', 'path', 'fg']) if (s[k]) s[k] = fileFor(s[k], 'img');
            for (const k of Object.keys(cfg.ui)) cfg.ui[k] = fileFor(cfg.ui[k], 'img');
            cfg.knight.image = fileFor(cfg.knight.image, 'img');
            cfg.titleScreen.backgroundImage = fileFor(cfg.titleScreen.backgroundImage, 'img');
            if (cfg.player && cfg.player.customImage) cfg.player.customImage = fileFor(cfg.player.customImage, 'img');
            Object.values(cfg.hotspots).forEach(l => l.forEach(h => { if (h.customImage) h.customImage = fileFor(h.customImage, 'img'); }));
            Object.values(cfg.items || {}).forEach(it => { if (it && it.icon) it.icon = fileFor(it.icon, 'img'); });
            [cfg.knight, cfg.player, ...Object.values(cfg.hotspots).flat()].forEach(o => { if (o && o.anims) Object.values(o.anims).forEach(a => { if (a && a.image) a.image = fileFor(a.image, 'img'); }); });
            for (const k of Object.keys(cfg.audio)) cfg.audio[k] = fileFor(cfg.audio[k], 'audio');

            // 2) image sizes as authored (lets the Lua side work with downscaled copies)
            status('Export: measuring images...');
            const refs = this.collectAssetRefs(cfg);
            cfg.imageSizes = {};
            const srcOf = (p) => { for (const [d, q] of dataMap) if (q === p) return d; return eng.src(p); };
            for (const p of refs.imgs) {
                const im = await loadImg(srcOf(p));
                if (im) cfg.imageSizes[p] = { w: im.naturalWidth, h: im.naturalHeight }; else missing.push(p);
            }

            // 3) bake walk grids (same placement as the editor, so Lua needs no pixel reading)
            status('Export: baking walk grids...');
            cfg.navgrids = {};
            for (const scene of Object.keys(cfg.spawns)) {
                const imgs = eng.sceneImages(scene);
                await loadImg(imgs.bg && eng.img(imgs.bg).src); await loadImg(imgs.path && eng.img(imgs.path).src);
                let g = null;
                for (let tries = 0; tries < 50 && !g; tries++) { g = eng.computeNavGrid(scene); if (!g) await new Promise(r => setTimeout(r, 100)); }
                if (g) cfg.navgrids[scene] = g.map(row => row.map(c => c === 0 ? '1' : '0').join(''));
            }
            eng.generateNavGrid();

            // 4) copy referenced asset files
            status('Export: packing assets...');
            for (const p of [...refs.imgs, ...refs.auds, ...refs.other]) {
                if (p.startsWith('assets/custom/') && [...dataMap.values()].includes(p)) continue;
                if (/^(https?:|blob:)/.test(p)) { missing.push(p); continue; }
                try { zip.file(p, await this.fetchBlob(eng.src(p))); } catch (e) { missing.push(p); }
            }

            // 5) Lua runtime + config
            status('Export: adding Lua engine...');
            for (const f of [...LUA_RUNTIME_FILES, ...LUA_EXTRA_FILES]) {
                try { zip.file(f, await this.fetchBlob('lua-runtime/' + f)); } catch (e) { missing.push('lua-runtime/' + f); }
            }
            delete cfg.version;
            zip.file('game/config.lua', '-- generated by the Sir Licks-a-Lot editor\nreturn ' + toLua(cfg) + '\n');

            status('Export: zipping...');
            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
            this.download(blob, 'SirLicks_Lua.zip');
            status('Export');
            if (missing.length) this.popup.alert("Exported, but these files were missing:\n" + missing.join('\n')); else this.popup.toast("Lua export done");
        } catch (e) {
            console.error(e); status('Export'); this.popup.alert("Lua export failed: " + e.message);
        }
    },

    // ===================== DOWNLOAD WEB PROJECT =====================
    async downloadGameCopy() {
        if (!this.requireZip()) return;
        try {
            const zip = new JSZip();
            const cfg = this.engine.cleanConfig();
            // source files are fetched from the server - never the live DOM (that was the old bug)
            for (const f of WEB_FILES) zip.file(f, await this.fetchBlob(f));
            const confSrc = await (await fetch('config.js')).text();
            const header = confSrc.slice(0, confSrc.indexOf('export const')) || '';
            zip.file('config.js', header + 'export const defaultGameConfig = ' + JSON.stringify(cfg, null, 2) + ';\n');
            const refs = this.collectAssetRefs(cfg);
            const missing = [];
            for (const p of [...refs.imgs, ...refs.auds, ...refs.other]) {
                if (p.startsWith('data:') || /^(https?:|blob:)/.test(p)) continue; // inline data stays in config.js
                try { zip.file(p, await this.fetchBlob(this.engine.src(p))); } catch (e) { missing.push(p); }
            }
            for (const f of [...LUA_RUNTIME_FILES, ...LUA_EXTRA_FILES]) {
                try { zip.file('lua-runtime/' + f, await this.fetchBlob('lua-runtime/' + f)); } catch (e) { missing.push('lua-runtime/' + f); }
            }
            const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
            this.download(blob, 'SirLicks_Project.zip');
            if (missing.length) this.popup.alert("Saved, but these files were missing:\n" + missing.join('\n')); else this.popup.toast("Project downloaded");
        } catch (e) { this.popup.alert("Download failed: " + e.message); }
    }
};
