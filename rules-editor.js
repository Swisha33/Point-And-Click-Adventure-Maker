// =============================
// RULES EDITOR: UI builders for reactions, conditions, actions, conversation choices,
// items + combos and interaction settings. Used by editor.js.
// All builders edit the given arrays/objects in place.
// =============================
import { DEFAULT_TEXTS } from './adventure.js';

export function el(tag, attrs = {}, kids = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null) continue;
        if (k === 'class') e.className = v;
        else if (k.startsWith('on')) e[k] = v;
        else if (k in e && k !== 'list') e[k] = v;
        else e.setAttribute(k, v);
    }
    (Array.isArray(kids) ? kids : [kids]).forEach(c => { if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return e;
}
const opt = (value, label, sel) => el('option', { value, selected: value === sel }, label);
const smallBtn = (label, title, fn) => el('button', { class: 'mini-btn', title, onclick: (e) => { e.preventDefault(); fn(); } }, label);
function moveIn(arr, i, d, rerender) { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; rerender(); }

export const VERB_LABELS = { look: 'Look', talk: 'Talk', use: 'Use', item: 'Use item on it' };
const COND_TYPES = [['flag', 'flag is set'], ['noflag', 'flag is NOT set'], ['item', 'player has item'], ['noitem', 'player does NOT have item']];
const ACTION_TYPES = [
    ['give', 'Give item'], ['take', 'Take item away'], ['set', 'Set flag'], ['clear', 'Clear flag'],
    ['hide', 'Hide hotspot'], ['show', 'Show hotspot'], ['exit', 'Unlock exit button'], ['goto', 'Go to level'],
    ['dignity', 'Change dignity'], ['sound', 'Play sound'], ['follow', 'This character follows player']
];

// ---- context helpers (lists for the dropdowns)
export function makeCtx(engine, current) {
    const c = engine.gameConfig;
    const flags = new Set();
    const scanConds = (l) => (l || []).forEach(x => { if (x && (x.type === 'flag' || x.type === 'noflag') && x.key) flags.add(x.key); });
    const scanActs = (l) => (l || []).forEach(x => { if (x && (x.type === 'set' || x.type === 'clear') && x.key) flags.add(x.key); });
    const scanR = (r) => { scanConds(r.if); scanActs(r.actions); (r.choices || []).forEach(ch => { scanConds(ch.if); scanActs(ch.actions); }); };
    Object.values(c.hotspots).flat().forEach(h => { scanConds(h.visibleIf); (h.reactions || []).forEach(scanR); });
    (current || []).forEach(scanR);
    const hotspots = [];
    for (const [scene, list] of Object.entries(c.hotspots)) list.forEach(h => hotspots.push({ id: h.id, label: `${h.name || h.id} (${scene})` }));
    const sounds = Object.keys(c.audio).filter(k => k !== 'music' && k !== 'click' && !c.spawns[k]);
    return { items: c.items || {}, flags: [...flags].sort(), hotspots, levels: c.sceneOrder.slice(), sounds };
}
function flagDatalist(ctx) {
    let dl = document.getElementById('flag-datalist');
    if (!dl) { dl = el('datalist', { id: 'flag-datalist' }); document.body.appendChild(dl); }
    dl.innerHTML = ''; ctx.flags.forEach(f => dl.appendChild(el('option', { value: f })));
}
function itemSelect(ctx, value, onchange, allowNone = false) {
    const s = el('select', { onchange: () => onchange(s.value) });
    if (allowNone) s.appendChild(opt('', '(nothing)', value || ''));
    const ids = Object.keys(ctx.items);
    if (!ids.length && !allowNone) s.appendChild(opt('', '(no items yet - add them in ITEMS)', ''));
    ids.forEach(id => s.appendChild(opt(id, ctx.items[id].name || id, value)));
    if (value && !ctx.items[value]) s.appendChild(opt(value, value + ' (missing)', value));
    if (!value && ids.length && !allowNone) setTimeout(() => onchange(s.value));
    return s;
}
function flagInput(value, onchange) {
    const i = el('input', { type: 'text', value: value || '', placeholder: 'flag name, e.g. door_open', oninput: () => onchange(i.value.trim()) });
    i.setAttribute('list', 'flag-datalist');
    return i;
}

// ---- conditions
export function condsEditor(arr, ctx, label = 'Only if') {
    const box = el('div', { class: 'rule-block' });
    const render = () => {
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'rule-label' }, label + (arr.length ? ':' : ' (always)')));
        arr.forEach((c, i) => {
            const keyCell = el('span', { class: 'rule-key' });
            const drawKey = () => { keyCell.innerHTML = ''; keyCell.appendChild(c.type === 'item' || c.type === 'noitem' ? itemSelect(ctx, c.key, v => c.key = v) : flagInput(c.key, v => c.key = v)); };
            const type = el('select', { onchange: () => { c.type = type.value; c.key = ''; drawKey(); } }, COND_TYPES.map(([v, l]) => opt(v, l, c.type)));
            drawKey();
            box.appendChild(el('div', { class: 'rule-row' }, [type, keyCell, smallBtn('✕', 'Remove', () => { arr.splice(i, 1); render(); })]));
        });
        box.appendChild(smallBtn('+ condition', 'Add condition', () => { arr.push({ type: 'flag', key: '' }); render(); }));
    };
    render();
    return box;
}

// ---- spoken lines
export function linesEditor(arr, label = 'Says') {
    const box = el('div', { class: 'rule-block' });
    const render = () => {
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'rule-label' }, label + ':'));
        arr.forEach((d, i) => {
            const spk = el('select', { onchange: () => d.speaker = spk.value }, [opt('knight', 'Player', d.speaker || 'object'), opt('object', 'It/Char', d.speaker || 'object')]);
            const txt = el('input', { type: 'text', value: d.text || '', placeholder: 'text…', oninput: () => d.text = txt.value });
            const eff = el('select', { onchange: () => { if (eff.value) d.effect = eff.value; else delete d.effect; } }, [opt('', 'normal', d.effect || ''), opt('angry', 'angry', d.effect || ''), opt('peace', 'calm', d.effect || '')]);
            box.appendChild(el('div', { class: 'rule-row' }, [spk, txt, eff, smallBtn('▲', 'Up', () => moveIn(arr, i, -1, render)), smallBtn('✕', 'Remove', () => { arr.splice(i, 1); render(); })]));
        });
        box.appendChild(smallBtn('+ line', 'Add line', () => { arr.push({ speaker: arr.length ? (arr[arr.length - 1].speaker === 'knight' ? 'object' : 'knight') : 'object', text: '' }); render(); }));
    };
    render();
    return box;
}

// ---- actions
export function actionsEditor(arr, ctx, label = 'Then') {
    const box = el('div', { class: 'rule-block' });
    const render = () => {
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'rule-label' }, label + ':'));
        arr.forEach((a, i) => {
            const cell = el('span', { class: 'rule-key' });
            const drawKey = () => {
                cell.innerHTML = '';
                const t = a.type;
                if (t === 'give' || t === 'take') cell.appendChild(itemSelect(ctx, a.key, v => a.key = v));
                else if (t === 'set' || t === 'clear') cell.appendChild(flagInput(a.key, v => a.key = v));
                else if (t === 'hide' || t === 'show') {
                    const s = el('select', { onchange: () => { if (s.value) a.key = s.value; else delete a.key; } });
                    if (t === 'hide') s.appendChild(opt('', '(this hotspot)', a.key || ''));
                    ctx.hotspots.forEach(h => s.appendChild(opt(h.id, h.label, a.key || '')));
                    if (t === 'show' && !a.key && ctx.hotspots.length) a.key = ctx.hotspots[0].id;
                    cell.appendChild(s);
                } else if (t === 'goto' || t === 'exit') {
                    const s = el('select', { onchange: () => a.key = s.value }, ctx.levels.map(l => opt(l, l, a.key)));
                    if (!a.key && ctx.levels.length) a.key = ctx.levels[0];
                    cell.appendChild(s);
                    if (t === 'exit') { const v = el('input', { type: 'text', value: a.value || '', placeholder: 'button text', oninput: () => a.value = v.value }); cell.appendChild(v); }
                } else if (t === 'dignity') { const v = el('input', { type: 'number', value: a.value ?? -1, oninput: () => a.value = parseInt(v.value) || 0 }); if (a.value === undefined) a.value = -1; cell.appendChild(v); }
                else if (t === 'sound') {
                    const s = el('select', { onchange: () => a.key = s.value }, ctx.sounds.length ? ctx.sounds.map(n => opt(n, n, a.key)) : [opt('', '(add sounds in the Sound section)', '')]);
                    if (!a.key && ctx.sounds.length) a.key = ctx.sounds[0];
                    cell.appendChild(s);
                }
            };
            const type = el('select', { onchange: () => { a.type = type.value; delete a.key; delete a.value; drawKey(); } }, ACTION_TYPES.map(([v, l]) => opt(v, l, a.type)));
            drawKey();
            box.appendChild(el('div', { class: 'rule-row' }, [type, cell, smallBtn('▲', 'Up', () => moveIn(arr, i, -1, render)), smallBtn('✕', 'Remove', () => { arr.splice(i, 1); render(); })]));
        });
        box.appendChild(smallBtn('+ action', 'Add action', () => { arr.push({ type: 'give' }); render(); }));
    };
    render();
    return box;
}

// ---- conversation choices
export function choicesEditor(arr, ctx) {
    const box = el('div', { class: 'rule-block' });
    const render = () => {
        box.innerHTML = '';
        box.appendChild(el('div', { class: 'rule-label' }, 'Conversation choices' + (arr.length ? ' (a "Goodbye" option is added automatically):' : ' (none - plain reaction)')));
        arr.forEach((c, i) => {
            c.lines = c.lines || []; c.actions = c.actions || []; c.if = c.if || [];
            const txt = el('input', { type: 'text', value: c.text || '', placeholder: 'What the player can say…', oninput: () => { c.text = txt.value; sum.firstChild.textContent = '💬 ' + (c.text || '(empty)'); } });
            const once = el('label', { class: 'inline-check' }, [el('input', { type: 'checkbox', checked: !!c.once, onchange: (e) => c.once = e.target.checked }), 'only once']);
            const end = el('label', { class: 'inline-check' }, [el('input', { type: 'checkbox', checked: !!c.end, onchange: (e) => c.end = e.target.checked }), 'ends conversation']);
            const sum = el('summary', {}, [el('span', {}, '💬 ' + (c.text || '(empty)')), el('span', { class: 'card-tools' }, [smallBtn('▲', 'Up', () => moveIn(arr, i, -1, render)), smallBtn('✕', 'Remove choice', () => { arr.splice(i, 1); render(); })])]);
            box.appendChild(el('details', { class: 'rule-card choice-card', open: !c.text }, [sum, txt, el('div', { class: 'rule-row' }, [once, end]), condsEditor(c.if, ctx, 'Shown only if'), linesEditor(c.lines, 'Answer'), actionsEditor(c.actions, ctx, 'Then')]));
        });
        box.appendChild(smallBtn('+ choice', 'Add conversation choice', () => { arr.push({ text: '', lines: [{ speaker: 'object', text: '' }], actions: [], if: [] }); render(); }));
    };
    render();
    return box;
}

// ---- reactions (cards in the EDIT window)
export function reactionsEditor(container, arr, ctx) {
    flagDatalist(ctx);
    const render = () => {
        container.innerHTML = '';
        if (!arr.length) container.appendChild(el('p', { class: 'help-text' }, 'No reactions yet. Example: "Use" → Says "A key!" → Then: Give item Key, Hide hotspot.'));
        arr.forEach((r, i) => {
            r.if = r.if || []; r.lines = r.lines || []; r.actions = r.actions || []; r.choices = r.choices || [];
            const title = () => `${VERB_LABELS[r.verb] || r.verb}${r.verb === 'item' ? ': ' + ((ctx.items[r.item] || {}).name || r.item || '?') : ''}${r.if.length ? ' (if…)' : ''}${r.once ? ' (once)' : ''}`;
            const head = el('span', {}, title());
            const itemCell = el('span', {});
            const drawItem = () => { itemCell.innerHTML = ''; if (r.verb === 'item') itemCell.appendChild(itemSelect(ctx, r.item, v => { r.item = v; head.textContent = title(); })); else delete r.item; };
            const verb = el('select', { onchange: () => { r.verb = verb.value; drawItem(); head.textContent = title(); } }, Object.entries(VERB_LABELS).map(([v, l]) => opt(v, l, r.verb)));
            drawItem();
            const once = el('label', { class: 'inline-check' }, [el('input', { type: 'checkbox', checked: !!r.once, onchange: (e) => { r.once = e.target.checked; head.textContent = title(); } }), 'only once']);
            const sum = el('summary', {}, [head, el('span', { class: 'card-tools' }, [
                smallBtn('▲', 'Higher priority', () => moveIn(arr, i, -1, render)), smallBtn('▼', 'Lower priority', () => moveIn(arr, i, 1, render)),
                smallBtn('✕', 'Delete reaction', () => { arr.splice(i, 1); render(); })])]);
            container.appendChild(el('details', { class: 'rule-card', open: r._open }, [sum,
                el('div', { class: 'rule-row' }, [el('span', { class: 'rule-label' }, 'When player:'), verb, itemCell, once]),
                condsEditor(r.if, ctx), linesEditor(r.lines), actionsEditor(r.actions, ctx), choicesEditor(r.choices, ctx)]));
        });
        container.appendChild(el('div', { class: 'rule-row' }, [
            ...['look', 'talk', 'use', 'item'].map(v => smallBtn('+ ' + VERB_LABELS[v], 'Add reaction', () => { arr.push({ verb: v, _open: true, lines: [{ speaker: v === 'talk' ? 'object' : 'knight', text: '' }], actions: [], if: [], choices: [] }); render(); }))
        ]));
        container.appendChild(el('p', { class: 'help-text' }, 'The first reaction (top to bottom) whose trigger and conditions fit is used. Put special cases (with "Only if") above the general ones.'));
    };
    render();
}

// clean a reactions array for saving (drop empty bits + editor-only keys)
export function cleanReactions(arr) {
    const cl = (l) => (l || []).filter(x => x && x.text && x.text.trim());
    const ca = (l) => (l || []).filter(x => x && x.type);
    const cc = (l) => (l || []).filter(x => x && x.type && x.key);
    return (arr || []).map(r => {
        const o = { verb: r.verb };
        if (r.verb === 'item') o.item = r.item;
        if (r.once) o.once = true;
        const c = cc(r.if); if (c.length) o.if = c;
        const l = cl(r.lines); if (l.length) o.lines = l;
        const a = ca(r.actions); if (a.length) o.actions = a;
        const ch = (r.choices || []).filter(x => x && x.text && x.text.trim()).map(x => {
            const q = { text: x.text.trim() };
            if (x.once) q.once = true; if (x.end) q.end = true;
            const c2 = cc(x.if); if (c2.length) q.if = c2;
            const l2 = cl(x.lines); if (l2.length) q.lines = l2;
            const a2 = ca(x.actions); if (a2.length) q.actions = a2;
            return q;
        });
        if (ch.length) o.choices = ch;
        return o;
    }).filter(r => r.verb && (r.verb !== 'item' || r.item));
}

// ---- ITEMS & COMBOS dialog
export function showItemsDialog(dbg) {
    const eng = dbg.engine, c = eng.gameConfig;
    c.items = c.items || {}; c.combos = c.combos || [];
    let d = document.getElementById('items-dialog'); if (d) d.remove();
    d = el('div', { id: 'items-dialog', class: 'modal-dialog' });
    eng.debug.$('gameContainer').appendChild(d);
    const slug = (s) => (s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'item';
    const render = () => {
        d.innerHTML = '';
        d.appendChild(el('h3', {}, 'Items & Combinations'));
        const list = el('div', { class: 'items-list' });
        Object.entries(c.items).forEach(([id, it]) => {
            const preview = el('img', { class: 'item-icon', src: it.icon ? eng.src(it.icon) : '' });
            const file = el('input', { type: 'file', accept: 'image/*', onchange: async () => { const f = file.files[0]; if (!f) return; it.icon = await dbg.imageToMedia(f); preview.src = eng.src(it.icon); eng.img(it.icon); } });
            list.appendChild(el('div', { class: 'item-row' }, [
                preview,
                el('div', { class: 'item-fields' }, [
                    el('div', { class: 'rule-row' }, [el('span', { class: 'item-id' }, id), el('input', { type: 'text', value: it.name || '', placeholder: 'Name', oninput: (e) => it.name = e.target.value })]),
                    el('input', { type: 'text', value: it.desc || '', placeholder: 'Description (player says it when looking at the item)', oninput: (e) => it.desc = e.target.value }),
                    el('label', { class: 'small-label' }, ['Icon: ', file])
                ]),
                smallBtn('✕', 'Delete item', async () => { if (await eng.popup.confirm(`Delete item "${it.name || id}"?`, { ok: 'Delete', danger: true })) { delete c.items[id]; render(); } })
            ]));
        });
        d.appendChild(list);
        d.appendChild(smallBtn('+ New item', 'Add item', async () => {
            const name = ((await eng.popup.prompt('Name of the new item:')) || '').trim(); if (!name) return;
            let id = slug(name), n = 2; while (c.items[id]) id = slug(name) + '_' + n++;
            c.items[id] = { name, desc: '' }; render();
        }));
        d.appendChild(el('div', { class: 'section-header' }, 'Combinations (drag one item onto another in the game)'));
        const ctx = makeCtx(eng);
        c.combos.forEach((cb, i) => {
            d.appendChild(el('div', { class: 'rule-card combo-card' }, [
                el('div', { class: 'rule-row' }, [itemSelect(ctx, cb.a, v => cb.a = v), ' + ', itemSelect(ctx, cb.b, v => cb.b = v), ' = ', itemSelect(ctx, cb.result, v => { if (v) cb.result = v; else delete cb.result; }, true), smallBtn('✕', 'Delete', () => { c.combos.splice(i, 1); render(); })]),
                el('input', { type: 'text', value: cb.text || '', placeholder: 'Player says… (e.g. "Now it fits!")', oninput: (e) => cb.text = e.target.value }),
                el('label', { class: 'inline-check' }, [el('input', { type: 'checkbox', checked: cb.consume !== false, onchange: (e) => cb.consume = e.target.checked }), 'both items are used up'])
            ]));
        });
        d.appendChild(smallBtn('+ New combination', 'Add combination', () => { c.combos.push({ consume: true }); render(); }));
        d.appendChild(el('div', { class: 'dialog-actions' }, [el('button', { onclick: () => { c.combos = c.combos.filter(x => x.a && x.b); d.remove(); eng.updateUI(); eng.popup.toast('Items saved (remember SAVE CONFIG)'); } }, 'Done')]));
    };
    render();
}

// ---- interaction settings dialog
export function showInteractionDialog(dbg) {
    const eng = dbg.engine, c = eng.gameConfig;
    const s = c.interaction = Object.assign({ mode: 'verbs', walkFirst: true, defaults: {} }, c.interaction || {});
    s.defaults = s.defaults || {};
    let d = document.getElementById('interaction-dialog'); if (d) d.remove();
    d = el('div', { id: 'interaction-dialog', class: 'modal-dialog' });
    eng.debug.$('gameContainer').appendChild(d);
    const mode = el('select', { onchange: () => s.mode = mode.value }, [opt('verbs', 'Verbs: tap shows Look / Talk / Use', s.mode), opt('simple', 'Simple: one tap does the main action', s.mode)]);
    const walk = el('label', { class: 'inline-check' }, [el('input', { type: 'checkbox', checked: s.walkFirst !== false, onchange: (e) => s.walkFirst = e.target.checked }), 'Knight walks to the hotspot before acting']);
    const wait = el('label', { class: 'inline-check' }, [el('input', { type: 'checkbox', checked: s.textWait !== false, onchange: (e) => s.textWait = e.target.checked }), 'Text stays until the player taps (off = disappears after a while)']);
    const rows = Object.entries({ look: 'Look (nothing defined)', talk: 'Talk (nothing defined)', use: 'Use (nothing defined)', item: 'Item does not fit', combine: 'Items do not combine', bye: 'Leave conversation' })
        .map(([k, l]) => el('label', {}, [l + ':', el('input', { type: 'text', value: s.defaults[k] || '', placeholder: DEFAULT_TEXTS[k], oninput: (e) => { if (e.target.value) s.defaults[k] = e.target.value; else delete s.defaults[k]; } })]));
    d.append(el('h3', {}, 'Interaction'), el('label', {}, ['Tap on a hotspot:', mode]), walk, wait, el('div', { class: 'section-header' }, 'Default answers'), ...rows,
        el('div', { class: 'dialog-actions' }, [el('button', { onclick: () => d.remove() }, 'Done')]));
}
