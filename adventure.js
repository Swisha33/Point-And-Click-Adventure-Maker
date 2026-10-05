// =============================
// ADVENTURE RULES (browser engine): items, flags, reactions, conversations,
// verbs, walk-then-act, save/load. Mixed into the engine object by game.js.
// The Lua engine (lua-runtime/engine/game.lua) implements the same rules.
//
// Config:
//   items:  { id: { name, icon, desc } }
//   combos: [ { a, b, result, text, consume } ]
//   interaction: { mode: 'verbs'|'simple', walkFirst, defaults: { look, talk, use, item, combine, bye } }
//   hotspot: id, startHidden, visibleIf:[cond], walkTo:{x,y}, noWalk,
//            reactions: [ { verb:'look'|'talk'|'use'|'item', item, if:[cond], once, lines:[line], actions:[act], choices:[choice] } ]
//   choice:  { text, if:[cond], once, lines:[line], actions:[act], end }
//   cond:    { type:'flag'|'noflag'|'item'|'noitem', key }
//   action:  { type:'give'|'take'|'set'|'clear'|'hide'|'show'|'goto'|'exit'|'dignity'|'sound'|'follow', key, value }
// =============================
const VW = 960, VH = 540;
export const DEFAULT_TEXTS = {
    look: "Nothing special.", talk: "It doesn't answer.", use: "I can't use that.",
    item: "That doesn't work.", combine: "Those don't fit together.", bye: "Goodbye."
};
const VERBS = [['look', 'Look'], ['talk', 'Talk'], ['use', 'Use']];
const SAVE_KEY = (slot) => 'SirLicksSave_' + slot;

export const adventure = {
    // ---------- state ----------
    advReset() {
        this.adv = {
            inv: [], held: null, flags: {}, vis: {}, once: {},
            seq: null, verbMenu: null, choices: null, pendingAct: null, notice: null
        };
    },
    texts() { return Object.assign({}, DEFAULT_TEXTS, (this.gameConfig.interaction || {}).defaults || {}); },
    interactionMode() { return (this.gameConfig.interaction || {}).mode || 'verbs'; },
    items() { return this.gameConfig.items || {}; },
    itemName(id) { const it = this.items()[id]; return it ? (it.name || id) : id; },

    condsOk(list) {
        if (!list || !list.length) return true;
        const a = this.adv;
        return list.every(c => {
            if (!c || !c.type) return true;
            if (c.type === 'flag') return !!a.flags[c.key];
            if (c.type === 'noflag') return !a.flags[c.key];
            if (c.type === 'item') return a.inv.includes(c.key);
            if (c.type === 'noitem') return !a.inv.includes(c.key);
            return true;
        });
    },
    isVisible(h) {
        if (!this.adv) return true;
        if (h.isDiscovered) return false;
        const v = this.adv.vis[h.id];
        if (v === false || (v === undefined && h.startHidden)) return false;
        return this.condsOk(h.visibleIf);
    },
    findHotspot(id) {
        for (const [scene, list] of Object.entries(this.gameConfig.hotspots)) { const h = list.find(x => x.id === id); if (h) return { h, scene }; }
        const f = this.globalFollowers.find(x => x.id === id); return f ? { h: f, scene: null } : null;
    },

    // ---------- talking ----------
    say(line, h) {
        const text = String(line.text || '');
        if (!text) return;
        this.activeDialogue = text;
        if (line.speaker === 'knight' || !h) this.talkingTarget = { speakerType: 'knight', currentEffect: line.effect };
        else { this.talkingTarget = h; h.speakerType = 'object'; h.currentEffect = line.effect; }
        // default: the line stays until the player taps (interaction.textWait = false -> timed)
        this.dialogueTimer = (this.gameConfig.interaction || {}).textWait === false ? Math.max(90, Math.min(420, 50 + text.length * 3)) : Infinity;
    },
    notice(text) { this.adv.notice = { text, t: 150 }; },
    // a sequence = list of steps: {say:line, h} | {actions, h} | {choices: reaction, h, key}
    runSeq(steps) { this.adv.seq = { steps, i: -1 }; this.nextStep(); },
    nextStep() {
        const s = this.adv.seq; if (!s) return;
        s.i++;
        while (s.i < s.steps.length) {
            const st = s.steps[s.i];
            if (st.say) { this.say(st.say, st.h); if (this.dialogueTimer > 0) return; }
            else if (st.actions) { const sceneBefore = this.scene; this.execActions(st.actions, st.h); if (this.scene !== sceneBefore || !this.adv.seq) { this.adv.seq = null; return; } }
            else if (st.choices) { this.openChoices(st); return; }
            s.i++;
        }
        this.adv.seq = null;
    },
    advUpdate() {
        const a = this.adv; if (!a) return;
        if (a.notice && --a.notice.t <= 0) a.notice = null;
        if (a.seq && !a.choices && this.dialogueTimer <= 0) this.nextStep();
    },

    // ---------- actions ----------
    execActions(list, h) {
        const a = this.adv;
        for (const act of list || []) {
            if (!act || !act.type) continue;
            const key = act.key;
            switch (act.type) {
                case 'give': if (key && !a.inv.includes(key)) { a.inv.push(key); this.notice('+ ' + this.itemName(key)); } break;
                case 'take': a.inv = a.inv.filter(i => i !== key); if (a.held === key) a.held = null; break;
                case 'set': if (key) a.flags[key] = true; break;
                case 'clear': if (key) delete a.flags[key]; break;
                case 'hide': { const id = key || (h && h.id); if (id) a.vis[id] = false; break; }
                case 'show': if (key) a.vis[key] = true; break;
                case 'dignity': this.dignity += parseInt(act.value) || 0; this.updateUI(); if (this.dignity <= 0) this.gameOverTimer = 180; break;
                case 'sound': if (key && this.gameConfig.audio[key] && !this.isMuted) { const s = this.audio(key); s.loop = false; s.currentTime = 0; s.volume = this.sfxVolume; s.play().catch(() => {}); } break;
                case 'follow': if (h && !h.isFollowing) { h.isFollowing = true; h._ref = this.depth(this.scene, h.x, h.y); if (!h._home) { h._home = this.scene; h._homePos = { x: h.x, y: h.y, tx: h.tx, ty: h.ty }; } } break;
                case 'exit': if (key && this.gameConfig.spawns[key]) {
                    const l = this.unlockedExits[this.scene] || (this.unlockedExits[this.scene] = []);
                    if (!l.some(e => e.target === key)) l.push({ target: key, text: act.value || `To ${this.pretty(key)}` });
                    this.updateUI();
                } break;
                case 'goto': if (key && this.gameConfig.spawns[key]) { this.adv.seq = null; this.closeChoices(); this.setScene(key); return; } break;
            }
        }
        this.updateUI();
    },

    // ---------- interacting with a hotspot ----------
    // tap on a hotspot in play mode
    interact(h, x, y) {
        const a = this.adv;
        if (a.held) return this.goAndDo(h, 'item', a.held);
        if (this.interactionMode() === 'verbs') { a.verbMenu = { h, x: h.x + (h.hboxX || 0), y: h.y + (h.hboxY || 0) }; return; }
        this.goAndDo(h, this.simpleVerb(h));
    },
    simpleVerb(h) {
        for (const v of ['use', 'talk', 'look']) if ((h.reactions || []).some(r => r.verb === v && this.condsOk(r.if))) return v;
        return h.isCharacter ? 'talk' : 'use';
    },
    goAndDo(h, verb, item) {
        const a = this.adv;
        a.verbMenu = null;
        const walk = (this.gameConfig.interaction || {}).walkFirst !== false && !h.noWalk;
        if (walk) {
            // default: stand beside the hotspot (on the side the knight comes from), at its foot line
            const hw = (h.w || (h.r ? h.r * 2 : 100)) / 2;
            const side = this.knight.x < h.x ? -1 : 1;
            const t = h.walkTo || { x: h.x + (h.hboxX || 0) + side * (hw + 25), y: h.y + (h.hboxY || 0) + (h.h || (h.r ? h.r * 2 : 100)) / 2 };
            const path = this.findPath({ x: this.knight.x, y: this.knight.y }, t);
            const end = path && path[path.length - 1];
            if (path && path.length > 1 && Math.hypot(end.x - this.knight.x, end.y - this.knight.y) > 14) {
                this.knight.path = path; this.knight.state = "WALKING";
                this.clickTarget = { x: end.x, y: end.y, life: 20 };
                a.pendingAct = { h, verb, item };
                return;
            }
        }
        this.doAct(h, verb, item);
    },
    // called when the knight stops walking
    advArrive() {
        const p = this.adv && this.adv.pendingAct;
        if (p) { this.adv.pendingAct = null; this.doAct(p.h, p.verb, p.item); return true; }
        return false;
    },
    doAct(h, verb, item) {
        const a = this.adv;
        if (Math.abs(h.x - this.knight.x) > 4) this.knight.facingRight = h.x > this.knight.x;
        this.stopCurrentSound();
        if (h.sound && this.gameConfig.audio[h.sound] && !this.isMuted && verb !== 'look') { this.currentSound = this.audio(h.sound); this.currentSound.loop = false; this.currentSound.currentTime = 0; this.currentSound.volume = this.sfxVolume; this.currentSound.play().catch(() => {}); }
        if (verb === 'item') a.held = null;
        const rs = h.reactions || [];
        for (let i = 0; i < rs.length; i++) {
            const r = rs[i];
            if (r.verb !== verb) continue;
            if (verb === 'item' && r.item !== item) continue;
            if (!this.condsOk(r.if)) continue;
            const key = `${h.id}#r${i}`;
            if (r.once && a.once[key]) continue;
            if (r.once) a.once[key] = true;
            return this.runReaction(h, r, key);
        }
        const T = this.texts();
        if (verb === 'item') return this.runSeq([{ say: { speaker: 'knight', text: T.item }, h }]);
        if (this.legacyAct(h)) return;
        this.runSeq([{ say: { speaker: 'knight', text: T[verb] || T.use }, h }]);
    },
    runReaction(h, r, key) {
        const steps = (r.lines || []).filter(l => l && l.text).map(l => ({ say: l, h }));
        if (r.actions && r.actions.length) steps.push({ actions: r.actions, h });
        if (r.choices && r.choices.length) steps.push({ choices: r, h, key });
        if (!steps.length) steps.push({ say: { speaker: 'knight', text: '...' }, h });
        this.runSeq(steps);
    },
    // old projects: discovery hotspots, cycling dialogue lines, plain text
    legacyAct(h) {
        const target = h.discoverLevel && this.gameConfig.spawns[h.discoverLevel] ? h.discoverLevel : null;
        let line = null;
        if (target && !h._found) {
            h._found = true;
            line = { text: h.discoverMsg || `I found a way to ${target}!`, speaker: 'knight', effect: 'peace' };
            if (h.discoverHide !== false) h.isDiscovered = true;
            const acts = (h.discoverMode || 'unlock') === 'unlock' ? [{ type: 'exit', key: target, value: h.discoverText || `To ${target}` }] : [{ type: 'goto', key: target }];
            this.runSeq([{ say: line, h }, { actions: acts, h }]);
        } else if (target && h.discoverMode === 'travel') {
            this.runSeq([{ actions: [{ type: 'goto', key: target }], h }]);
        } else if (h.dialogues && h.dialogues.length) {
            if (h.dialogIndex === undefined) h.dialogIndex = 0;
            line = h.dialogues[h.dialogIndex];
            h.dialogIndex = (h.dialogIndex + 1) % h.dialogues.length;
            this.runSeq([{ say: line, h }]);
        } else if (h.text && h.text !== 'New') {
            this.runSeq([{ say: { text: h.text, speaker: 'object' }, h }]);
        } else return false;
        if (h.followPlayer && !h.isFollowing) this.execActions([{ type: 'follow' }], h);
        return true;
    },

    // ---------- conversations ----------
    openChoices(step) {
        const r = step.choices, a = this.adv;
        const list = [];
        (r.choices || []).forEach((c, j) => {
            const k = `${step.key}c${j}`;
            if (c.text && this.condsOk(c.if) && !(c.once && a.once[k])) list.push({ c, k });
        });
        list.push({ c: { text: this.texts().bye, end: true }, k: null });
        a.choices = { list, step };
    },
    closeChoices() { if (this.adv) this.adv.choices = null; },
    pickChoice(i) {
        const a = this.adv, ch = a.choices; if (!ch) return;
        const { c, k } = ch.list[i];
        a.choices = null;
        if (k && c.once) a.once[k] = true;
        const h = ch.step.h;
        const steps = [{ say: { speaker: 'knight', text: c.text }, h }];
        (c.lines || []).filter(l => l && l.text).forEach(l => steps.push({ say: l, h }));
        if (c.actions && c.actions.length) steps.push({ actions: c.actions, h });
        if (!c.end) steps.push(ch.step);
        this.runSeq(steps);
    },

    // ---------- inventory + combining ----------
    tapItem(id) {
        const a = this.adv;
        if (a.seq) return;
        if (!a.held) { a.held = id; return; }
        if (a.held === id) {   // tap the held item again = look at it
            a.held = null;
            const it = this.items()[id] || {};
            this.runSeq([{ say: { speaker: 'knight', text: it.desc || this.itemName(id) } }]);
            return;
        }
        const x = a.held; a.held = null;
        const c = (this.gameConfig.combos || []).find(c => (c.a === x && c.b === id) || (c.a === id && c.b === x));
        if (!c) return this.runSeq([{ say: { speaker: 'knight', text: this.texts().combine } }]);
        const acts = [];
        if (c.consume !== false) acts.push({ type: 'take', key: c.a }, { type: 'take', key: c.b });
        if (c.result) acts.push({ type: 'give', key: c.result });
        const steps = [];
        if (c.text) steps.push({ say: { speaker: 'knight', text: c.text } });
        steps.push({ actions: acts });
        this.runSeq(steps);
    },

    // ---------- canvas UI (inventory bar, verb menu, choices, notices) ----------
    invRects() {
        const inv = this.adv ? this.adv.inv : [];
        if (!inv.length || this.adv.invClosed) return [];
        const size = 58, gap = 6, x0 = 12, y0 = VH - size - 10;
        return inv.map((id, i) => ({ id, x: x0 + i * (size + gap), y: y0, w: size, h: size }));
    },
    // the small tab that opens / closes the inventory bar
    invTabRect() {
        const a = this.adv; if (!a || !a.inv.length) return null;
        const r = this.invRects();
        if (r.length) { const l = r[r.length - 1]; return { x: l.x + l.w + 10, y: l.y + 14, w: 24, h: 30, open: true }; }
        return { x: 6, y: VH - 58, w: 64, h: 48, open: false };
    },
    verbRects() {
        const m = this.adv && this.adv.verbMenu; if (!m) return [];
        const w = 76, h = 38, gap = 6, total = VERBS.length * w + (VERBS.length - 1) * gap;
        let x = Math.round(m.x - total / 2), y = Math.round(m.y - 90);
        x = Math.max(6, Math.min(VW - total - 6, x)); y = Math.max(6, Math.min(VH - 120, y));
        return VERBS.map(([v, label], i) => ({ v, label, x: x + i * (w + gap), y, w, h }));
    },
    choiceRects() {
        const ch = this.adv && this.adv.choices; if (!ch) return [];
        const rowH = 34, w = 760, x = (VW - w) / 2;
        const y0 = VH - 84 - ch.list.length * rowH;
        return ch.list.map((o, i) => ({ i, text: o.c.text, x, y: y0 + i * rowH, w, h: rowH - 4 }));
    },
    // returns true when the tap was used by the adventure UI
    advTapUI(x, y) {
        const a = this.adv; if (!a) return false;
        const inside = (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
        if (a.choices) { const r = this.choiceRects().find(inside); if (r) this.pickChoice(r.i); return true; }
        if (a.verbMenu) {
            const r = this.verbRects().find(inside);
            const h = a.verbMenu.h; a.verbMenu = null;
            if (r) { this.goAndDo(h, r.v); return true; }
        }
        const tab = this.invTabRect();
        if (tab && inside(tab) && !a.seq) { a.invClosed = !a.invClosed; return true; }
        const it = this.invRects().find(inside);
        if (it) { this.tapItem(it.id); return true; }
        if (a.seq || this.dialogueTimer > 0) { this.dialogueTimer = 0; return true; }   // tap = next line
        return false;
    },
    drawAdvUI(ctx) {
        const a = this.adv; if (!a) return;
        const font = (px) => `bold ${px}px 'Courier New', monospace`;
        // inventory
        const inv = this.invRects();
        if (inv.length) {
            const last = inv[inv.length - 1];
            ctx.fillStyle = 'rgba(30,20,10,0.72)'; ctx.fillRect(inv[0].x - 6, inv[0].y - 6, last.x + last.w - inv[0].x + 12, last.h + 12);
            inv.forEach(r => {
                const it = this.items()[r.id] || {};
                ctx.fillStyle = a.held === r.id ? 'rgba(255,215,0,0.45)' : 'rgba(230,201,168,0.85)'; ctx.fillRect(r.x, r.y, r.w, r.h);
                ctx.strokeStyle = a.held === r.id ? '#ffd700' : '#6e5032'; ctx.lineWidth = 2; ctx.strokeRect(r.x, r.y, r.w, r.h);
                const im = it.icon ? this.img(it.icon) : null;
                if (this.ready(im)) { const s = Math.min((r.w - 8) / im.naturalWidth, (r.h - 8) / im.naturalHeight); const w = im.naturalWidth * s, h = im.naturalHeight * s; ctx.drawImage(im, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h); }
                else { ctx.fillStyle = '#4e342e'; ctx.font = font(10); ctx.textAlign = 'center'; ctx.fillText(this.itemName(r.id).slice(0, 8), r.x + r.w / 2, r.y + r.h / 2 + 4); }
            });
        }
        const tab = this.invTabRect();
        if (tab) {
            ctx.fillStyle = tab.open ? '#444' : '#8b0000'; ctx.fillRect(tab.x, tab.y, tab.w, tab.h);
            ctx.strokeStyle = tab.open ? '#777' : '#ffd700'; ctx.lineWidth = 2; ctx.strokeRect(tab.x, tab.y, tab.w, tab.h);
            ctx.fillStyle = tab.open ? '#fff' : '#ffd700'; ctx.textAlign = 'center';
            if (tab.open) { ctx.font = font(14); ctx.fillText('◀', tab.x + tab.w / 2, tab.y + 20); }
            else { ctx.font = font(12); ctx.fillText('ITEMS', tab.x + tab.w / 2, tab.y + 20); ctx.font = font(14); ctx.fillText(`▶ ${a.inv.length}`, tab.x + tab.w / 2, tab.y + 38); }
        }
        // held item: label + icon at the pointer
        if (a.held) {
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.font = font(13); ctx.textAlign = 'left';
            const label = `Use ${this.itemName(a.held)} with ...`;
            const y = inv.length ? inv[0].y - 18 : VH - 20;
            ctx.fillRect(8, y - 16, ctx.measureText(label).width + 16, 22); ctx.fillStyle = '#ffd700'; ctx.fillText(label, 16, y);
            const it = this.items()[a.held] || {}; const im = it.icon ? this.img(it.icon) : null;
            if (this.ready(im) && this.mouseX > 0) { ctx.globalAlpha = 0.85; ctx.drawImage(im, this.mouseX + 10, this.mouseY + 10, 36, 36 * im.naturalHeight / im.naturalWidth); ctx.globalAlpha = 1; }
        }
        // verb menu
        this.verbRects().forEach(r => {
            ctx.fillStyle = '#8b0000'; ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
            ctx.fillStyle = '#ffd700'; ctx.font = font(15); ctx.textAlign = 'center'; ctx.fillText(r.label, r.x + r.w / 2, r.y + 25);
        });
        if (a.verbMenu) { const h = a.verbMenu.h; ctx.fillStyle = 'rgba(0,0,0,0.7)'; const n = h.name || ''; if (n) { ctx.font = font(13); const vr = this.verbRects()[0]; const w = ctx.measureText(n).width + 14; ctx.fillRect(a.verbMenu.x - w / 2, vr.y - 24, w, 20); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(n, a.verbMenu.x, vr.y - 9); } }
        // conversation choices
        const cr = this.choiceRects();
        if (cr.length) {
            ctx.fillStyle = 'rgba(20,12,6,0.85)'; ctx.fillRect(cr[0].x - 8, cr[0].y - 8, cr[0].w + 16, cr.length * 34 + 12);
            cr.forEach(r => {
                const hover = this.mouseX >= r.x && this.mouseX <= r.x + r.w && this.mouseY >= r.y && this.mouseY <= r.y + r.h;
                ctx.fillStyle = hover ? '#ffd700' : '#f0dcc0'; ctx.font = font(15); ctx.textAlign = 'left';
                ctx.fillText('▸ ' + r.text, r.x + 8, r.y + 21);
            });
        }
        // notice ("+ Key")
        if (a.notice) {
            ctx.font = font(18); ctx.textAlign = 'center';
            const w = ctx.measureText(a.notice.text).width + 30;
            ctx.globalAlpha = Math.min(1, a.notice.t / 30);
            ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(VW / 2 - w / 2, 16, w, 34);
            ctx.fillStyle = '#ffd700'; ctx.fillText(a.notice.text, VW / 2, 39); ctx.globalAlpha = 1;
        }
    },

    // ---------- save / load ----------
    saveState() {
        const a = this.adv;
        const dialogIdx = {}, found = {}, followers = [];
        const all = [...Object.values(this.gameConfig.hotspots).flat(), ...this.globalFollowers];
        all.forEach(h => { if (h.dialogIndex) dialogIdx[h.id] = h.dialogIndex; if (h._found) found[h.id] = true; if (h.isDiscovered) found[h.id] = 'hidden'; if (h.isFollowing) followers.push(h.id); });
        return {
            v: 1, time: Date.now(), scene: this.scene, x: Math.round(this.knight.x), y: Math.round(this.knight.y), dignity: this.dignity,
            inv: a.inv.slice(), flags: Object.assign({}, a.flags), vis: Object.assign({}, a.vis), once: Object.assign({}, a.once),
            unlocked: JSON.parse(JSON.stringify(this.unlockedExits)), dialogIdx, found, followers
        };
    },
    saveGame(slot) {
        try { localStorage.setItem(SAVE_KEY(slot), JSON.stringify(this.saveState())); if (slot !== 'auto') this.notice('Game saved'); return true; }
        catch (e) { this.popup.alert('Saving failed: ' + e.message); return false; }
    },
    readSave(slot) { try { const s = localStorage.getItem(SAVE_KEY(slot)); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
    listSaves() { return ['auto', '1', '2', '3'].map(slot => ({ slot, data: this.readSave(slot) })); },
    loadGame(slot) {
        const d = this.readSave(slot); if (!d || !this.gameConfig.spawns[d.scene]) return false;
        if (!this.isGameRunning) this.startGame(true);
        this.restoreFollowers();
        this.advReset();
        const a = this.adv;
        a.inv = d.inv || []; a.flags = d.flags || {}; a.vis = d.vis || {}; a.once = d.once || {};
        this.unlockedExits = d.unlocked || {};
        this.dignity = d.dignity ?? this.dignity;
        const all = Object.values(this.gameConfig.hotspots).flat();
        all.forEach(h => { delete h.dialogIndex; delete h._found; delete h.isDiscovered; delete h.isFollowing; });
        all.forEach(h => { if (d.dialogIdx && d.dialogIdx[h.id]) h.dialogIndex = d.dialogIdx[h.id]; if (d.found && d.found[h.id]) { h._found = true; if (d.found[h.id] === 'hidden') h.isDiscovered = true; } });
        // followers walk along: take them out of their level and let setScene bring them in
        (d.followers || []).forEach(id => {
            const f = this.findHotspot(id); if (!f || !f.scene) return;
            const h = f.h; const list = this.gameConfig.hotspots[f.scene];
            h._home = f.scene; h._homePos = { x: h.x, y: h.y, tx: h.tx, ty: h.ty }; h.isFollowing = true; h._ref = this.depth(f.scene, h.x, h.y);
            list.splice(list.indexOf(h), 1); this.globalFollowers.push(h);
        });
        this.setScene(d.scene, true);
        this.knight.x = d.x; this.knight.y = d.y;
        this.updateUI();
        this.notice('Game loaded');
        return true;
    },
    async saveMenu(mode) {
        const fmt = (s) => s.data ? `${s.slot === 'auto' ? 'Autosave' : 'Slot ' + s.slot}: ${this.pretty(s.data.scene)} – ${new Date(s.data.time).toLocaleString()}` : `${s.slot === 'auto' ? 'Autosave' : 'Slot ' + s.slot}: (empty)`;
        const saves = this.listSaves().filter(s => mode === 'load' ? s.data : s.slot !== 'auto');
        if (!saves.length) { this.popup.alert('No saved games yet.'); return; }
        const pick = await this.popup.choice(mode === 'save' ? 'Save game to:' : 'Load game:', [
            ...saves.map(s => ({ label: fmt(s), value: s.slot })),
            { label: 'Cancel', value: null, cancel: true }
        ]);
        if (!pick) return;
        if (mode === 'save') this.saveGame(pick); else this.loadGame(pick);
    },
    latestSave() {
        return this.listSaves().filter(s => s.data).sort((a, b) => b.data.time - a.data.time)[0] || null;
    }
};
