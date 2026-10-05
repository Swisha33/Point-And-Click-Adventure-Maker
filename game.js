// =============================
// GAME ENGINE CORE (browser / editor version)
// =============================
import { defaultGameConfig } from './config.js';
import { debug } from './editor.js';
import { popup } from './popup.js';
import { spriteInfo, spriteFrame } from './sprite.js';
import { adventure } from './adventure.js';

const VW = 960, VH = 540;
const clone = (o) => JSON.parse(JSON.stringify(o));
// runtime-only keys that must never end up in a saved/exported config
const RUNTIME_KEYS = new Set(['cacheImg', 'speakerType', 'currentEffect', 'dialogIndex', 'isFollowing', 'isDiscovered']);
const cleanReplacer = (k, v) => (RUNTIME_KEYS.has(k) || k.startsWith('_')) ? undefined : v;

// ---------- persistent storage (IndexedDB, falls back to localStorage) ----------
const store = {
    db: null,
    open() {
        if (this.db) return Promise.resolve(this.db);
        return new Promise((res) => {
            try {
                const r = indexedDB.open('SirLicksEditor', 1);
                r.onupgradeneeded = () => r.result.createObjectStore('kv');
                r.onsuccess = () => { this.db = r.result; res(this.db); };
                r.onerror = () => res(null);
            } catch (e) { res(null); }
        });
    },
    async get(k) {
        const db = await this.open();
        if (!db) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
        return new Promise((res) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result ?? null); t.onerror = () => res(null); });
    },
    async set(k, v) {
        const db = await this.open();
        if (!db) { localStorage.setItem(k, JSON.stringify(v)); return; }
        return new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    },
    async keys(prefix = '') {
        const db = await this.open();
        if (!db) return [];
        return new Promise((res) => { const t = db.transaction('kv').objectStore('kv').getAllKeys(); t.onsuccess = () => res((t.result || []).filter(k => typeof k === 'string' && k.startsWith(prefix))); t.onerror = () => res([]); });
    },
    async del(k) {
        try { localStorage.removeItem(k); } catch (e) {}
        const db = await this.open();
        if (!db) return;
        return new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(); tx.onerror = () => res(); });
    }
};

// Bring old (v1) configs up to date and fill in anything missing.
function migrateConfig(stored) {
    const d = clone(defaultGameConfig);
    const c = Object.assign({}, d, stored || {});
    // settings blocks: defaults + saved values
    ['audio', 'volumes', 'ui', 'knight', 'titleScreen'].forEach(k => { c[k] = Object.assign({}, d[k], (stored && stored[k]) || {}); });
    // per-level maps: a saved project keeps exactly its own levels
    ['spawns', 'hotspots', 'exits', 'levelLicks', 'levelFollowerAccess', 'backgrounds', 'images', 'perspective']
        .forEach(k => { c[k] = stored ? Object.assign({}, stored[k] || {}) : d[k]; });
    if (!Object.keys(c.spawns).length) c.spawns = d.spawns;
    // v1 had no "images"/"perspective": levels named like the built-in assets get them back
    for (const s of Object.keys(c.spawns)) {
        if (!c.images[s]) c.images[s] = d.images[s] ? clone(d.images[s]) : {};
        if (!c.perspective[s] && d.perspective[s]) c.perspective[s] = clone(d.perspective[s]);
        if (!c.backgrounds[s]) c.backgrounds[s] = { x: 0, y: 0, scale: 1, fit: 'stretch' };
        if (!c.hotspots[s]) c.hotspots[s] = [];
        if (!c.exits[s]) c.exits[s] = [];
    }
    // every hotspot gets a stable id (used by save games, show/hide actions)
    const ids = new Set();
    for (const list of Object.values(c.hotspots)) for (const h of list) {
        if (!h.id || ids.has(h.id)) h.id = 'h_' + Math.random().toString(36).slice(2, 9);
        ids.add(h.id);
    }
    c.items = c.items || {};
    c.combos = c.combos || [];
    c.interaction = Object.assign({ mode: 'verbs', walkFirst: true, defaults: {} }, c.interaction || {});
    // only keep defaults for scenes that exist
    for (const k of ['images', 'perspective']) for (const s of Object.keys(c[k])) if (!c.spawns[s]) delete c[k][s];
    if (!c.audio.music || c.audio.music === 'assets/music.wav') c.audio.music = 'assets/music.mp3';
    if (!c.audio.click || c.audio.click === 'assets/click.wav') c.audio.click = 'assets/click.mp3';
    c.sceneOrder = (c.sceneOrder || []).filter(s => c.spawns[s]);
    for (const s of Object.keys(c.spawns)) if (!c.sceneOrder.includes(s)) c.sceneOrder.push(s);
    if (!c.spawns[c.startScene]) c.startScene = c.sceneOrder[0];
    c.version = 2;
    return c;
}

const engine = {
    canvas: document.getElementById("gameCanvas"),
    ctx: null,
    pathCanvas: document.createElement("canvas"),
    pathCtx: null,

    // State Flags
    debugMode: false,
    editEnabled: false,
    placeMode: null,     // 'hotspot' | 'character' while waiting for a tap to place a new object
    deleteMode: false,
    editMode: false,
    unlockedExits: {},   // exits found through discovery hotspots (runtime only)
    pendingTravel: null,
    isDragging: false,
    dragTarget: null,
    clickTarget: null,

    gameConfig: null,
    scene: "village",
    dignity: 3,
    isGameRunning: false,
    gameOverTimer: 0,
    gameFrame: 0,
    currentSound: null,
    isMuted: false,

    musicVolume: 0.5,
    ambVolume: 0.5,
    sfxVolume: 0.5,
    mouseX: -999, mouseY: -999, activeDialogue: "", dialogueTimer: 0, talkingTarget: null,
    globalFollowers: [],

    imgCache: new Map(),
    mediaURLs: new Map(), // media/... path -> object URL of an uploaded file (stored in IndexedDB)
    audioCache: new Map(),
    navDirty: true,

    debug: debug,
    popup: popup,
    store: store,

    async init() {
        window.engine = this;
        this.debug.init(this);
        this.ctx = this.canvas.getContext("2d");
        this.canvas.width = VW; this.canvas.height = VH;
        this.pathCtx = this.pathCanvas.getContext("2d", { willReadFrequently: true });
        this.pathCanvas.width = VW; this.pathCanvas.height = VH;

        const cont = document.getElementById("gameContainer");
        const uiLayer = document.getElementById("uiLayer");
        let toggleBtn = document.getElementById("ui-toggle-btn");
        if (!toggleBtn) {
            toggleBtn = document.createElement("div"); toggleBtn.id = "ui-toggle-btn"; toggleBtn.innerHTML = "◀";
            cont.appendChild(toggleBtn);
        }
        toggleBtn.onclick = () => { uiLayer.classList.toggle("minimized"); toggleBtn.innerHTML = uiLayer.classList.contains("minimized") ? "▶" : "◀"; toggleBtn.classList.toggle("btn-minimized"); };
        toggleBtn.classList.add('hidden');

        let stored = await store.get("SirLicksConfig");
        if (!stored) { // old localStorage save from v1
            try { const ls = localStorage.getItem("SirLicksConfig"); if (ls) stored = JSON.parse(ls); } catch (e) {}
        }
        this.gameConfig = migrateConfig(stored);
        await this.loadMedia();
        await this.convertDataURLs();
        const v = this.gameConfig.volumes || {};
        this.musicVolume = v.music ?? 0.5; this.ambVolume = v.amb ?? 0.5; this.sfxVolume = v.sfx ?? 0.5;
        this.scene = this.gameConfig.startScene;

        this.preloadImages();
        this.setupEventListeners();
        this.debug.setupDialogs();
        this.updateUI();
        this.debug.updateTitleScreenElements();
        this.startGameLoop();
    },

    // ---------- assets ----------
    img(src) {
        if (!src) return null;
        let im = this.imgCache.get(src);
        if (!im) {
            im = new Image();
            im.onload = () => { this.navDirty = true; };
            im.onerror = () => console.warn("Image missing:", src.slice(0, 80));
            im.src = this.src(src);
            this.imgCache.set(src, im);
        }
        return im;
    },
    // ---------- uploaded files ("media/...") ----------
    src(path) { return (path && this.mediaURLs.get(path)) || path; },
    async loadMedia() {
        for (const k of await store.keys('media:')) {
            const blob = await store.get(k);
            if (blob instanceof Blob) this.mediaURLs.set(k.slice(6), URL.createObjectURL(blob));
        }
    },
    // store an uploaded file; returns its path for the config
    async putMedia(blob, kind = 'file') {
        const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav' })[blob.type] || (kind === 'audio' ? 'mp3' : 'png');
        const path = `media/${kind}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
        try { await store.set('media:' + path, blob); }
        catch (e) { return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }); } // no IndexedDB: inline
        this.mediaURLs.set(path, URL.createObjectURL(blob));
        return path;
    },
    // walk every string in the config
    mapConfigStrings(fn) {
        const walk = (o) => { for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === 'string') { const n = fn(v); if (n !== v) o[k] = n; } else if (v && typeof v === 'object') walk(v); } };
        walk(this.gameConfig);
    },
    // old saves kept files inline as data: URLs - move them into the media store (much faster saving)
    async convertDataURLs() {
        const found = new Map();
        this.mapConfigStrings(v => { if (v.startsWith('data:')) found.set(v, null); return v; });
        if (!found.size) return;
        for (const d of found.keys()) {
            try { const blob = await (await fetch(d)).blob(); found.set(d, await this.putMedia(blob, blob.type.startsWith('audio') ? 'audio' : 'img')); } catch (e) {}
        }
        this.mapConfigStrings(v => found.get(v) || v);
    },
    async gcMedia() {
        const used = new Set();
        this.mapConfigStrings(v => { if (v.startsWith('media/')) used.add(v); return v; });
        this.globalFollowers.forEach(h => { if (h.customImage) used.add(h.customImage); });
        for (const k of await store.keys('media:')) if (!used.has(k.slice(6))) await store.del(k);
    },
    async mediaBlob(path) { return (await fetch(this.src(path))).blob(); },

    ready(im) { return im && im.complete && im.naturalWidth > 0; },
    sceneImages(scene = this.scene) { return this.gameConfig.images[scene] || {}; },
    audio(name) {
        const src = this.gameConfig.audio[name];
        if (!src) return null;
        let a = this.audioCache.get(name);
        if (!a || a.dataset.src !== src) {
            a = new Audio(this.src(src)); a.dataset.src = src;
            a.loop = name === 'music' || !!this.gameConfig.spawns[name];
            a.muted = this.isMuted;
            this.audioCache.set(name, a);
        }
        return a;
    },
    preloadImages() {
        const c = this.gameConfig;
        Object.values(c.images).forEach(s => { this.img(s.bg); this.img(s.path); this.img(s.fg); });
        Object.values(c.ui).forEach(s => { if (/\.(png|jpe?g|webp|gif)$/i.test(s) || s.startsWith('data:image')) this.img(s); });
        this.img(c.knight.image); this.img(c.titleScreen.backgroundImage);
    },

    // ---------- background placement (shared by drawing, walk mask and Lua export) ----------
    bgRect(scene = this.scene) {
        const imgs = this.sceneImages(scene);
        const bc = this.gameConfig.backgrounds[scene] || {};
        let x = 0, y = 0, w = VW, h = VH;
        const fit = bc.fit || 'stretch';
        const bg = this.img(imgs.bg);
        if (fit !== 'stretch' && this.ready(bg)) {
            const s = fit === 'cover' ? Math.max(VW / bg.naturalWidth, VH / bg.naturalHeight) : Math.min(VW / bg.naturalWidth, VH / bg.naturalHeight);
            w = bg.naturalWidth * s; h = bg.naturalHeight * s; x = (VW - w) / 2; y = (VH - h) / 2;
        }
        const sc = bc.scale || 1;
        return { x: (bc.x || 0) + x * sc, y: (bc.y || 0) + y * sc, w: w * sc, h: h * sc };
    },

    // ---------- walk grid ----------
    gridSize: 12, navGrid: [],
    // returns grid (rows of 0 = walkable / 1 = blocked) for any scene; null if its path image is still loading
    computeNavGrid(scene) {
        const cols = Math.ceil(VW / this.gridSize), rows = Math.ceil(VH / this.gridSize);
        const pathSrc = this.sceneImages(scene).path;
        const pim = this.img(pathSrc);
        const grid = [];
        if (!pathSrc || (pim && pim.complete && !pim.naturalWidth)) { // no/broken path image -> everything walkable
            for (let y = 0; y < rows; y++) grid.push(new Array(cols).fill(0));
            return grid;
        }
        if (!this.ready(pim)) return null;
        const bgSrc = this.sceneImages(scene).bg;
        if (bgSrc && !this.ready(this.img(bgSrc)) && (this.gameConfig.backgrounds[scene]?.fit || 'stretch') !== 'stretch') return null;
        const r = this.bgRect(scene);
        this.pathCtx.clearRect(0, 0, VW, VH);
        this.pathCtx.drawImage(pim, r.x, r.y, r.w, r.h);
        const data = this.pathCtx.getImageData(0, 0, VW, VH).data;
        for (let y = 0; y < rows; y++) {
            const row = [];
            for (let x = 0; x < cols; x++) {
                const px = x * this.gridSize + 6, py = y * this.gridSize + 6;
                row.push(px < VW && py < VH && data[(py * VW + px) * 4 + 3] > 40 ? 0 : 1);
            }
            grid.push(row);
        }
        return grid;
    },
    generateNavGrid() {
        const g = this.computeNavGrid(this.scene);
        if (g) { this.navGrid = g; this.navDirty = false; }
        else { // not loaded yet: walk anywhere for now, retry when the image arrives
            const cols = Math.ceil(VW / this.gridSize), rows = Math.ceil(VH / this.gridSize);
            this.navGrid = Array.from({ length: rows }, () => new Array(cols).fill(0));
        }
    },
    isWalkable(px, py) {
        if (px < 0 || px >= VW || py < 0 || py >= VH) return false;
        const row = this.navGrid[Math.floor(py / this.gridSize)];
        return !!row && row[Math.floor(px / this.gridSize)] === 0;
    },
    getNearestValidNode(px, py) {
        if (this.isWalkable(px, py)) return { x: px, y: py };
        const cx = Math.floor(px / this.gridSize), cy = Math.floor(py / this.gridSize);
        for (let r = 1; r < 60; r++) {
            let best = null;
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                const tx = cx + dx, ty = cy + dy;
                if (ty >= 0 && ty < this.navGrid.length && tx >= 0 && tx < this.navGrid[0].length && this.navGrid[ty][tx] === 0) {
                    const d = dx * dx + dy * dy;
                    if (!best || d < best.d) best = { d, x: tx * this.gridSize + 6, y: ty * this.gridSize + 6 };
                }
            }
            if (best) return best;
        }
        return { x: px, y: py };
    },
    findPath(start, end) {
        const cols = Math.ceil(VW / this.gridSize), rows = Math.ceil(VH / this.gridSize);
        const sP = this.getNearestValidNode(start.x, start.y), eP = this.getNearestValidNode(end.x, end.y);
        const startNode = { x: Math.floor(sP.x / this.gridSize), y: Math.floor(sP.y / this.gridSize) };
        const endNode = { x: Math.floor(eP.x / this.gridSize), y: Math.floor(eP.y / this.gridSize) };
        const key = (n) => n.y * cols + n.x;
        const open = [startNode], cameFrom = new Map(), gScore = new Map(), closed = new Set();
        const h = (n) => Math.hypot(n.x - endNode.x, n.y - endNode.y);
        gScore.set(key(startNode), 0); startNode.f = h(startNode);
        const dirs = [[0, 1, 1], [0, -1, 1], [1, 0, 1], [-1, 0, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
        while (open.length) {
            let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
            const curr = open.splice(bi, 1)[0];
            const ck = key(curr);
            if (closed.has(ck)) continue;
            closed.add(ck);
            if (curr.x === endNode.x && curr.y === endNode.y) {
                const path = [eP]; let k = cameFrom.get(ck);
                while (k !== undefined) { path.unshift({ x: (k % cols) * this.gridSize + 6, y: Math.floor(k / cols) * this.gridSize + 6 }); k = cameFrom.get(k); }
                return path;
            }
            for (const [ox, oy, cost] of dirs) {
                const nx = curr.x + ox, ny = curr.y + oy;
                if (nx < 0 || nx >= cols || ny < 0 || ny >= rows || this.navGrid[ny][nx] !== 0) continue;
                if (cost > 1 && (this.navGrid[curr.y][nx] !== 0 || this.navGrid[ny][curr.x] !== 0)) continue; // no corner cutting
                const nk = ny * cols + nx; if (closed.has(nk)) continue;
                const tg = gScore.get(ck) + cost;
                if (!gScore.has(nk) || tg < gScore.get(nk)) { cameFrom.set(nk, ck); gScore.set(nk, tg); open.push({ x: nx, y: ny, f: tg + h({ x: nx, y: ny }) }); }
            }
        }
        return null;
    },

    knight: { x: 0, y: 0, state: "IDLE", path: [], scale: 1, facingRight: false, custom: null },

    depth(scene, x, y) {
        const p = this.gameConfig.perspective[scene] || { axis: 'y', from: 300, to: 540, far: 0.5, near: 1.1, exp: 1 };
        const v = p.axis === 'x' ? x : y;
        const span = (p.to - p.from) || 1;
        const t = Math.max(0, (v - p.from) / span);
        return p.far + Math.pow(t, p.exp || 1) * (p.near - p.far);
    },

    setScene(name, noAutosave = false) {
        if (!this.gameConfig.spawns[name]) return;
        if (this.adv) { this.adv.verbMenu = null; this.adv.pendingAct = null; this.adv.choices = null; this.adv.seq = null; }
        if (this.gameConfig.hotspots[this.scene]) {
            const leaving = this.gameConfig.hotspots[this.scene].filter(h => h.isFollowing);
            this.globalFollowers = [...this.globalFollowers, ...leaving];
            this.gameConfig.hotspots[this.scene] = this.gameConfig.hotspots[this.scene].filter(h => !h.isFollowing);
        }
        this.scene = name;
        this.generateNavGrid();
        const sp = this.gameConfig.spawns[this.scene];
        this.knight.x = sp.x; this.knight.y = sp.y;
        this.knight.path = []; this.knight.state = "IDLE";
        this.dialogueTimer = 0;

        if (this.gameConfig.levelFollowerAccess[this.scene] !== false) {
            this.globalFollowers.forEach((f, i) => {
                f.x = this.knight.x - 50 - (i * 30); f.y = this.knight.y; f.isFollowing = true;
                if (!this.gameConfig.hotspots[this.scene]) this.gameConfig.hotspots[this.scene] = [];
                this.gameConfig.hotspots[this.scene].push(f);
            });
            this.globalFollowers = [];
        }
        this.stopCurrentSound();
        for (const [key, a] of this.audioCache) { if (key !== 'music' && a.loop) { a.pause(); a.currentTime = 0; } }
        if (this.isGameRunning && this.gameConfig.audio[this.scene]) { const a = this.audio(this.scene); a.loop = true; a.volume = this.ambVolume; a.play().catch(() => {}); }
        if (this.isGameRunning && !this.debugMode && !noAutosave && this.adv) this.saveGame('auto');   // autosave on every level change
        this.updateUI();
    },

    stopCurrentSound() { if (this.currentSound) { this.currentSound.pause(); this.currentSound.currentTime = 0; this.currentSound = null; } },
    playClickSound() { const a = this.audio('click'); if (a && !this.isMuted) { a.currentTime = 0; a.volume = this.sfxVolume; a.play().catch(() => {}); } },

    updateKnight() {
        const p = this.gameConfig.player;
        this.knight.scale = this.playerScale(this.knight.x, this.knight.y);
        if (this.knight.state === "WALKING" && this.knight.path.length > 0) {
            const speed = this.gameConfig.knight.speed || 6;
            const target = this.knight.path[0]; const dx = target.x - this.knight.x, dy = target.y - this.knight.y; const dist = Math.hypot(dx, dy);
            if (Math.abs(dx) > 1) this.knight.facingRight = (dx > 0);
            if (dist < speed) { this.knight.x = target.x; this.knight.y = target.y; this.knight.path.shift(); if (this.knight.path.length === 0) { this.knight.state = "IDLE"; this.onArrive(); } }
            else { this.knight.x += (dx / dist) * speed; this.knight.y += (dy / dist) * speed; }
        }
    },

    onArrive() {
        if (this.advArrive()) return;
        const t = this.pendingTravel;
        if (t) { this.pendingTravel = null; this.setScene(t); }
    },
    // exits for the current level: configured + the ones unlocked by discovery hotspots
    currentExits() {
        const base = this.gameConfig.exits[this.scene] || [];
        const extra = (this.unlockedExits[this.scene] || []).filter(e => !base.some(b => b.target === e.target));
        return [...base, ...extra];
    },

    // where the knight stands to interact (walkTo, or automatic: left of the hotspot at its foot line)
    walkPoint(h) {
        if (h.walkTo) return h.walkTo;
        const hw = (h.w || (h.r ? h.r * 2 : 100)) / 2, hh = (h.h || (h.r ? h.r * 2 : 100)) / 2;
        return { x: Math.round(h.x + (h.hboxX || 0) - hw - 25), y: Math.round(h.y + (h.hboxY || 0) + hh) };
    },

    // size of the player at a point: own player sprites keep their editor scale at the level's spawn point
    // and get bigger/smaller with depth like the default knight
    playerScale(x, y, scene = this.scene) {
        const p = this.gameConfig.player;
        const d = this.depth(scene, x, y);
        if (p && p.customImage) { const sp = this.gameConfig.spawns[scene] || { x, y }; return (p.scale || 1) * d / (this.depth(scene, sp.x, sp.y) || 1); }
        return d * (this.gameConfig.knight.baseScale || 0.55);
    },
    // followers keep the size they had when they started following and then scale with depth
    followerScale(h) {
        const ref = h._ref || this.depth(this.scene, h.x, h.y);
        return (h.scale || 1) * this.depth(this.scene, h.x, h.y) / (ref || 1);
    },
    // 0..1: hotspots that only appear when the pointer or the knight comes near
    nearAlpha(h, max = 1) {
        if (this.debugMode) return 1;
        const hx = h.x + (h.hboxX || 0), hy = h.y + (h.hboxY || 0);
        const d = Math.min(Math.hypot(hx - this.mouseX, hy - this.mouseY), this.isGameRunning ? Math.hypot(hx - this.knight.x, hy - this.knight.y) * 1.3 : 1e9);
        return Math.max(0, Math.min(max, max * (1 - (d - 60) / 140)));
    },
    fadesWhenFar(h) { return h.nearFade ?? !h.isCharacter; },

    hotspotHit(h, x, y) {
        const cx = h.x + (h.hboxX || 0), cy = h.y + (h.hboxY || 0);
        const w = h.w || (h.r * 2) || 120, hgt = h.h || (h.r * 2) || 120;
        if (h.shape === 'rect') return x > cx - w / 2 && x < cx + w / 2 && y > cy - hgt / 2 && y < cy + hgt / 2;
        return Math.hypot(cx - x, cy - y) < w / 2;
    },
    hotspotAt(x, y) { return (this.gameConfig.hotspots[this.scene] || []).find(h => this.hotspotHit(h, x, y)) || null; },

    // draw part of an image anchored at (ax, ay); mirror flips around the anchor like ctx.scale(-1,1)
    drawAnchored(im, sx, sy, sw, sh, ax, ay, lx, ly, w, h, mirror) {
        const ctx = this.ctx; ctx.save(); ctx.translate(ax, ay); if (mirror) ctx.scale(-1, 1);
        ctx.drawImage(im, sx, sy, sw, sh, lx, ly, w, h); ctx.restore();
    },

    sizeOf(path) { const im = path ? this.img(path) : null; return this.ready(im) ? { w: im.naturalWidth, h: im.naturalHeight } : null; },
    // draw one animation frame of a sprite object, feet at (x, y)
    drawSprite(o, kind, anim, x, y, scale, mirror, tick = this.gameFrame) {
        const sizeOf = (p) => this.sizeOf(p);
        const info = spriteInfo(o, kind, sizeOf);
        let fr = spriteFrame(info, anim, tick, sizeOf);
        let im = this.img(fr.path);
        if (!this.ready(im)) { fr = spriteFrame(info, 'none', tick, sizeOf); im = this.img(fr.path); }   // separate sheet still loading
        if (!this.ready(im)) return false;
        const w = fr.sw * fr.k * scale, h = fr.sh * fr.k * scale;
        this.drawAnchored(im, fr.sx, fr.sy, fr.sw, fr.sh, x, y, -w / 2 + (o.offX || 0), -h + (o.offY || 0), w, h, mirror);
        return true;
    },

    drawHotspot(h) {
        const ctx = this.ctx;
        const im = h.customImage ? this.img(h.customImage) : null;
        if (im && this.ready(im)) {
            const rs = h.isFollowing ? this.followerScale(h) : (h.scale || 1);
            ctx.save();
            if (this.fadesWhenFar(h) && !h.isFollowing) ctx.globalAlpha = this.nearAlpha(h);
            if (ctx.globalAlpha <= 0.01) { ctx.restore(); return; }
            this.drawSprite(h, 'character', h._moving ? 'walk' : 'idle', h.x, h.y, rs, h.mirrored);
            ctx.restore();
        } else {
            const orb = this.img(this.gameConfig.ui.orb);
            const al = h.nearFade === false ? 0.6 : this.nearAlpha(h, 0.6);
            if (al > 0.01 && this.ready(orb)) { ctx.save(); ctx.globalAlpha = this.debugMode ? 1 : al; ctx.drawImage(orb, h.x - 25, h.y - 25, 50, 50); ctx.restore(); }
        }
    },

    drawKnight() {
        const p = this.gameConfig.player;
        const custom = p && p.customImage && this.ready(this.img(p.customImage));
        const o = custom ? p : this.gameConfig.knight;
        const anim = this.knight.state === "WALKING" ? 'walk' : 'idle';
        this.drawSprite(custom ? o : Object.assign({ offY: 35 }, o), 'player', anim, this.knight.x, this.knight.y, this.knight.scale, !this.knight.facingRight);
    },

    drawBubble() {
        const ctx = this.ctx, t = this.talkingTarget;
        const bubbleW = 320, bubbleH = 140; let bX, bY;
        if (!t || t.speakerType === 'knight') { bX = this.knight.x; bY = this.knight.y - 200; }
        else if (t.isFollowing) { bX = t.x; bY = t.y - ((t.frameHeight || 100) * this.followerScale(t)) - 20; }
        else { bX = t.tx ?? t.x; bY = (t.ty ?? (t.y - 100)) - 20; }
        bX = Math.min(Math.max(bX, bubbleW / 2 + 4), VW - bubbleW / 2 - 4);
        bY = Math.min(Math.max(bY, bubbleH + 4), VH - 4);
        const bub = this.img(this.gameConfig.ui.bubble);
        if (this.ready(bub)) {
            ctx.save();
            if (t && t.flipBubble) { ctx.translate(bX, bY); ctx.scale(-1, 1); ctx.translate(-bX, -bY); }
            ctx.drawImage(bub, bX - bubbleW / 2, bY - bubbleH, bubbleW, bubbleH);
            ctx.restore();
        }
        ctx.fillStyle = "#4e342e"; ctx.font = "bold 13px 'Courier New', monospace"; ctx.textAlign = "center";
        let ox = 0, oy = 0;
        if (t && t.currentEffect === 'angry') { ox = (Math.random() - 0.5) * 3; oy = (Math.random() - 0.5) * 3; }
        if (t && t.currentEffect === 'peace') { oy = Math.sin(Date.now() / 200) * 2; }
        const words = String(this.activeDialogue).split(' '); let line = '', textY = bY - bubbleH + 50;
        for (const w of words) { const test = line + w + ' '; if (ctx.measureText(test).width > 260 && line) { ctx.fillText(line, bX + ox, textY + oy); line = w + ' '; textY += 18; } else line = test; }
        ctx.fillText(line, bX + ox, textY + oy);
        if (!isFinite(this.dialogueTimer) && Math.floor(Date.now() / 400) % 2) { ctx.fillStyle = '#8b0000'; ctx.font = "bold 14px 'Courier New', monospace"; ctx.fillText('▼', bX + 120, bY - 30); }
    },

    drawDebugOverlay() {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = "rgba(255,0,255,0.25)";
        for (let y = 0; y < this.navGrid.length; y++) for (let x = 0; x < this.navGrid[y].length; x++) if (this.navGrid[y][x] === 0) ctx.fillRect(x * this.gridSize, y * this.gridSize, this.gridSize - 1, this.gridSize - 1);
        (this.gameConfig.hotspots[this.scene] || []).forEach(h => {
            ctx.beginPath();
            const hx = h.x + (h.hboxX || 0), hy = h.y + (h.hboxY || 0);
            const width = h.w || (h.r * 2) || 120, height = h.h || (h.r * 2) || 120;
            if (h.shape === 'rect') ctx.rect(hx - width / 2, hy - height / 2, width, height); else ctx.arc(hx, hy, width / 2, 0, Math.PI * 2);
            ctx.strokeStyle = this.deleteMode ? "red" : (this.editEnabled || this.editMode ? "yellow" : (h.discoverLevel ? "orange" : "cyan")); ctx.lineWidth = 2; ctx.stroke();
            ctx.beginPath(); ctx.arc(h.tx, h.ty, 10, 0, Math.PI * 2); ctx.strokeStyle = "yellow"; ctx.stroke();
            ctx.fillStyle = "white"; ctx.font = "12px Arial"; ctx.textAlign = "center";
            ctx.fillText(h.name || "Hotspot", h.x, h.y - width / 2 - 5); ctx.fillText("TEXT", h.tx, h.ty - 15);
        });
        if (this.editEnabled) (this.gameConfig.hotspots[this.scene] || []).forEach(h => {   // walk-to points
            if (h.noWalk) return;
            const p = this.walkPoint(h);
            ctx.save(); ctx.globalAlpha = h.walkTo ? 1 : 0.5;
            ctx.setLineDash([4, 4]); ctx.strokeStyle = '#3f3'; ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#3f3'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x + 10, p.y); ctx.lineTo(p.x, p.y + 10); ctx.lineTo(p.x - 10, p.y); ctx.closePath(); ctx.fill();
            ctx.restore();
        });
        const sp = this.gameConfig.spawns[this.scene];
        if (sp) { ctx.beginPath(); ctx.arc(sp.x, sp.y, 20, 0, Math.PI * 2); ctx.strokeStyle = "cyan"; ctx.stroke(); ctx.fillStyle = "cyan"; ctx.font = "11px Arial"; ctx.textAlign = "center"; ctx.fillText("SPAWN", sp.x, sp.y - 25); }
        ctx.fillStyle = "#0f0"; ctx.font = "bold 13px monospace"; ctx.textAlign = "right"; ctx.fillText("Level: " + this.scene, VW - 10, 20);
        ctx.restore();
    },

    startGameLoop() {
        const animate = () => {
            const ctx = this.ctx;
            ctx.clearRect(0, 0, VW, VH);
            if (this.navDirty) this.generateNavGrid();
            if (this.isGameRunning || this.debugMode) {
                if (this.isGameRunning && !this.gameOverTimer) this.updateKnight();

                ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH);
                const imgs = this.sceneImages();
                const bg = this.img(imgs.bg);
                const r = this.bgRect();
                if (this.ready(bg)) ctx.drawImage(bg, r.x, r.y, r.w, r.h);
                else { ctx.fillStyle = "#333"; ctx.fillRect(0, 0, VW, VH); }

                const list = this.gameConfig.hotspots[this.scene] || [];
                // followers trail the knight
                list.forEach(h => {
                    if (h.isFollowing && this.dialogueTimer > 0) h._moving = false;
                    if (h.isFollowing && this.dialogueTimer <= 0) {
                        const dx = this.knight.x - h.x, dy = this.knight.y - h.y;
                        h._moving = Math.hypot(dx, dy) > 80;
                        if (h._moving) { h.x += dx * 0.05; h.y += dy * 0.05; h.mirrored = dx < 0; }
                    }
                });
                // y-sorted draw of hotspots + knight
                const order = list.filter(h => this.debugMode || this.isVisible(h)).map(h => ({ y: h.y, h }));
                if (this.isGameRunning) order.push({ y: this.knight.y, knight: true });
                order.sort((a, b) => a.y - b.y);
                order.forEach(o => o.knight ? this.drawKnight() : this.drawHotspot(o.h));

                const fg = this.img(imgs.fg);
                if (this.ready(fg)) ctx.drawImage(fg, r.x, r.y, r.w, r.h);
                if (this.debugMode) this.drawDebugOverlay();
                if (this.isGameRunning && this.dialogueTimer > 0 && this.activeDialogue) { this.drawBubble(); this.dialogueTimer--; }
                if (this.isGameRunning && this.adv) { this.advUpdate(); this.drawAdvUI(ctx); }

                if (this.clickTarget) {
                    ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${this.clickTarget.life / 20})`; ctx.lineWidth = 3;
                    ctx.beginPath(); ctx.arc(this.clickTarget.x, this.clickTarget.y, 5 + this.clickTarget.life, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
                    if (--this.clickTarget.life <= 0) this.clickTarget = null;
                }
                if (this.gameOverTimer > 0) {
                    ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillRect(0, 0, VW, VH);
                    ctx.fillStyle = "#ffd700"; ctx.font = "bold 34px 'Courier New', monospace"; ctx.textAlign = "center";
                    ctx.fillText("Your dignity is gone!", VW / 2, VH / 2 - 10);
                    ctx.fillStyle = "#fff"; ctx.font = "bold 22px 'Courier New', monospace"; ctx.fillText("GAME OVER", VW / 2, VH / 2 + 30);
                    if (--this.gameOverTimer <= 0) this.backToTitle();
                }
            }
            this.gameFrame++; requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    },

    setupEventListeners() {
        // pointer events = mouse, pen and touch with one code path
        this.canvas.style.touchAction = 'none';
        this.canvas.addEventListener('pointerdown', (e) => {
            if (!e.isPrimary) return;
            this.isTouch = e.pointerType !== 'mouse';
            try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
            this.handleMouseMove(e); this.handleMouseDown(e); e.preventDefault();
        });
        this.canvas.addEventListener('pointermove', (e) => { if (e.isPrimary) this.handleMouseMove(e); });
        this.canvas.addEventListener('pointerup', () => this.handleMouseUp());
        this.canvas.addEventListener('pointercancel', () => this.handleMouseUp());
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
    },

    canvasPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        // the canvas keeps 16:9 inside its box (object-fit: contain)
        const s = Math.min(rect.width / VW, rect.height / VH);
        const ox = (rect.width - VW * s) / 2, oy = (rect.height - VH * s) / 2;
        return { x: (e.clientX - rect.left - ox) / s, y: (e.clientY - rect.top - oy) / s };
    },

    handleMouseDown(e) {
        this.playClickSound();
        if (!this.isGameRunning && !this.debugMode) return;
        if (this.gameOverTimer) return;
        const { x: clickX, y: clickY } = this.canvasPos(e);
        const list = this.gameConfig.hotspots[this.scene] || (this.gameConfig.hotspots[this.scene] = []);

        if (this.debugMode) {
            if (!this.isGameRunning) return;          // title screen is edited from the side panel
            if (this.placeMode) {                      // + HOTSPOT / + CHARACTER: tap where it goes
                const kind = this.placeMode; this.placeMode = null;
                const x = Math.round(clickX), y = Math.round(clickY);
                if (kind.startsWith('item:')) { this.debug.makePickup(kind.slice(5), x, y); return; }
                if (kind === 'hotspot') {
                    list.push({ id: 'h_' + Math.random().toString(36).slice(2, 9), x, y, r: 50, name: "New", text: "New", tx: x, ty: Math.max(20, y - 120), anchor: "object", sound: null });
                    this.updateUI(); popup.toast("Hotspot placed - use EDIT to change it");
                } else { this.updateUI(); this.debug.openEditor(null, 'character', { x, y }); }
                return;
            }
            if (this.editMode) {                       // one EDIT mode: player, character or hotspot
                const p = this.gameConfig.player;
                const pRadius = (p && p.r) ? p.r : 60;
                const h = this.hotspotAt(clickX, clickY);
                if (h) { this.debug.openEditor(h); return; }
                if (Math.hypot(this.knight.x - clickX, this.knight.y - 40 - clickY) < pRadius + 20) { this.debug.openEditor('player'); return; }
                popup.toast("Tap a hotspot, character or the player to edit it");
                return;
            }
            if (this.deleteMode) {
                const h = this.hotspotAt(clickX, clickY);
                if (h) popup.confirm(`Delete "${h.name || 'hotspot'}"?`, { ok: 'Delete', danger: true }).then(ok => { if (ok) { list.splice(list.indexOf(h), 1); this.updateUI(); } });
                return;
            }
            if (this.editEnabled) {
                const grab = this.isTouch ? 1.8 : 1;     // fingers are less precise than a mouse
                const sp = this.gameConfig.spawns[this.scene];
                if (sp && Math.hypot(sp.x - clickX, sp.y - clickY) < 30 * grab) { this.isDragging = true; this.dragTarget = { type: 'spawn', ox: sp.x - clickX, oy: sp.y - clickY }; return; }
                const w = list.find(h => { const p = this.walkPoint(h); return Math.hypot(p.x - clickX, p.y - clickY) < 14 * grab; });
                if (w) { const p = this.walkPoint(w); this.isDragging = true; this.dragTarget = { type: 'walk', h: w, ox: p.x - clickX, oy: p.y - clickY }; return; }
                const t = list.find(h => Math.hypot(h.tx - clickX, h.ty - clickY) < 20 * grab);
                if (t) { this.isDragging = true; this.dragTarget = { type: 'text', h: t, ox: t.tx - clickX, oy: t.ty - clickY }; return; }
                const h = this.hotspotAt(clickX, clickY) || (this.isTouch ? list.find(q => Math.hypot(q.x + (q.hboxX || 0) - clickX, q.y + (q.hboxY || 0) - clickY) < 70) : null);
                if (h) { this.isDragging = true; this.dragTarget = { type: 'hotspot', h, ox: h.x - clickX, oy: h.y - clickY }; return; }
                return;
            }
        }

        this.tapPlay(clickX, clickY, list);
    },

    // play mode: adventure UI first, then hotspots, then walking
    tapPlay(x, y, list) {
        if (!this.isGameRunning) return;
        if (this.advTapUI(x, y)) return;
        const a = this.adv;
        const hit = list.slice().reverse().find(h => this.isVisible(h) && this.hotspotHit(h, x, y));
        this.pendingTravel = null;
        if (hit) { this.interact(hit, x, y); return; }
        a.pendingAct = null;
        if (a.held) { a.held = null; return; }   // tap on empty ground puts the item back
        const path = this.findPath({ x: this.knight.x, y: this.knight.y }, { x, y });
        if (path && path.length > 0) {
            this.knight.path = path; this.knight.state = "WALKING";
            const end = path[path.length - 1]; this.clickTarget = { x: end.x, y: end.y, life: 20 };
        }
    },

    handleMouseMove(e) {
        const p = this.canvasPos(e); this.mouseX = p.x; this.mouseY = p.y;
        if (this.isDragging && this.dragTarget) {
            const d = this.dragTarget;
            const mx = this.mouseX + (d.ox || 0), my = this.mouseY + (d.oy || 0);
            if (d.type === 'spawn') { const sp = this.gameConfig.spawns[this.scene]; sp.x = Math.round(mx); sp.y = Math.round(my); }
            else if (d.type === 'hotspot') { const h = d.h; const dx = Math.round(mx) - h.x, dy = Math.round(my) - h.y; h.x += dx; h.y += dy; h.tx = Math.round(h.tx + dx); h.ty = Math.round(h.ty + dy); if (h.walkTo) { h.walkTo.x += dx; h.walkTo.y += dy; } }
            else if (d.type === 'text') { d.h.tx = Math.round(mx); d.h.ty = Math.round(my); }
            else if (d.type === 'walk') { d.h.walkTo = { x: Math.round(mx), y: Math.round(my) }; }
        }
    },
    handleMouseUp() { this.isDragging = false; this.dragTarget = null; },
    handleKeyDown(e) { if (e.key === 'F2') { e.preventDefault(); this.toggleDebugMenu(); } },

    startGame(forLoad = false) {
        document.getElementById("startScreen").classList.add("hidden");
        document.getElementById("uiLayer").classList.remove("hidden");
        document.getElementById('ui-toggle-btn').classList.remove("hidden");
        document.getElementById("startScreen").classList.remove("debug-title");
        this.isGameRunning = true; this.dignity = this.gameConfig.startDignity ?? 3; this.gameOverTimer = 0;
        // fresh play-through: forget discoveries
        this.unlockedExits = {}; this.pendingTravel = null;
        this.restoreFollowers();
        Object.values(this.gameConfig.hotspots).forEach(l => l.forEach(h => { delete h.isDiscovered; delete h._found; delete h.dialogIndex; }));
        this.advReset();
        this.setScene(this.gameConfig.startScene || this.gameConfig.sceneOrder[0], forLoad);
        const m = this.audio('music'); if (m) { m.volume = this.musicVolume; m.play().catch(() => {}); }
        this.updateUI();
    },
    backToTitle() {
        this.isGameRunning = false; this.gameOverTimer = 0; this.dialogueTimer = 0;
        this.stopCurrentSound();
        for (const a of this.audioCache.values()) { a.pause(); a.currentTime = 0; }
        // followers walk home again
        this.restoreFollowers();
        document.getElementById("startScreen").classList.remove("hidden");
        document.getElementById("startScreen").classList.toggle("debug-title", this.debugMode);
        document.getElementById('ui-toggle-btn').classList.add("hidden");
        document.getElementById("uiLayer").classList.toggle('hidden', !this.debugMode);
        this.updateUI();
        this.debug.updateTitleScreenElements();
    },
    restoreFollowers() {
        const all = [];
        for (const s of Object.keys(this.gameConfig.hotspots)) this.gameConfig.hotspots[s] = this.gameConfig.hotspots[s].filter(h => { if (h._home) { all.push(h); return false; } return true; });
        all.push(...this.globalFollowers); this.globalFollowers = [];
        for (const h of all) {
            Object.assign(h, h._homePos || {}); delete h.isFollowing; delete h._homePos;
            const home = h._home; delete h._home;
            (this.gameConfig.hotspots[home] || (this.gameConfig.hotspots[home] = [])).push(h);
        }
    },
    // config without runtime state (followers back home, caches removed) - used for save/export
    cleanConfig() {
        const hs = {};
        for (const s of Object.keys(this.gameConfig.spawns)) hs[s] = [];
        const put = (scene, h) => {
            const c = JSON.parse(JSON.stringify(h, cleanReplacer));
            if (h._homePos) Object.assign(c, h._homePos);
            const target = h._home || scene;
            (hs[target] || (hs[target] = [])).push(c);
        };
        for (const [s, list] of Object.entries(this.gameConfig.hotspots)) list.forEach(h => put(s, h));
        this.globalFollowers.forEach(h => put(h._home, h));
        const c = JSON.parse(JSON.stringify(this.gameConfig, cleanReplacer));
        c.hotspots = hs;
        c.volumes = { music: this.musicVolume, amb: this.ambVolume, sfx: this.sfxVolume };
        return c;
    },

    toggleFullscreen() { const c = document.getElementById('gameContainer'); if (!document.fullscreenElement) c.requestFullscreen?.(); else document.exitFullscreen?.(); },
    toggleMute() { this.isMuted = !this.isMuted; for (const a of this.audioCache.values()) a.muted = this.isMuted; this.updateUI(); },

    updateUI() {
        const uiLayer = document.getElementById("uiLayer"); const statsDiv = document.getElementById("stats"); const buttonsDiv = document.getElementById("buttons"); buttonsDiv.innerHTML = "";
        if (this.debugMode && !this.isGameRunning) { this.buildTitleDebugUI(uiLayer, statsDiv, buttonsDiv); return; }
        if (this.debugMode) { this.buildLevelDebugUI(uiLayer, statsDiv, buttonsDiv); return; }
        {
            uiLayer.classList.remove('debug-active');
            const box = document.createElement('div');
            box.style.cssText = `background: url('${this.gameConfig.ui.panelBox}') no-repeat center; background-size: 100% 100%; width: 220px; height: 80px; display: flex; align-items: center; justify-content: center; color: #4e342e; font-weight: bold; font-size: 18px; margin: 0 auto;`;
            box.textContent = `❤️ Dignity: ${this.dignity}`;
            statsDiv.innerHTML = ''; statsDiv.appendChild(box);
            this.currentExits().forEach(ex => { this.createBtn(ex.text, () => this.setScene(ex.target), "", buttonsDiv); });
            const lConf = this.gameConfig.levelLicks[this.scene] || this.gameConfig.lickConfig;
            this.createBtn(lConf.text, () => {
                if (this.gameOverTimer) return;
                if (this.adv && this.adv.seq) return;
                this.runSeq([{ say: { speaker: 'knight', text: lConf.response } }, { actions: [{ type: 'dignity', value: lConf.dignityChange }] }]);
            }, "", buttonsDiv);
            this.createBtn("Save Game", () => this.saveMenu('save'), "", buttonsDiv);
            this.createBtn("Load Game", () => this.saveMenu('load'), "", buttonsDiv);
            this.createBtn(this.isMuted ? 'UNMUTE' : 'MUTE', () => this.toggleMute(), "", buttonsDiv);
            this.createBtn("Fullscreen", () => this.toggleFullscreen(), "", buttonsDiv);
            this.createBtn("DEB-UI: OFF", () => this.toggleDebugMenu(), "", buttonsDiv);
            this.createVolumeControls(buttonsDiv);
        }
    },

    // file chooser that applies as soon as a file is picked
    fileInput(id, accept, onFile) {
        const inp = this.createDebugInput('file', id, accept);
        inp.onchange = async () => { const f = inp.files && inp.files[0]; if (f) { await onFile(f); inp.value = ''; } };
        return inp;
    },
    pretty(scene) { return String(scene).replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); },

    globalAudioFieldset() {
        return this.createDebugFieldset('Global Audio', [
            this.createDebugLabel('Main Music (applies at once):'), this.fileInput('global-music-file', 'audio/*', f => this.debug.uploadAudio('music', f)),
            this.createDebugLabel('Click SFX (applies at once):'), this.fileInput('click-sfx-file', 'audio/*', f => this.debug.uploadAudio('click', f))
        ]);
    },

    gameSettingsFieldset() {
        const c = this.gameConfig;
        const startSel = document.createElement('select'); startSel.id = 'start-level';
        c.sceneOrder.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; if (s === c.startScene) o.selected = true; startSel.appendChild(o); });
        startSel.onchange = () => { c.startScene = startSel.value; };
        const dig = this.createDebugInput('number', 'start-dignity', '', String(c.startDignity ?? 3));
        dig.onchange = () => { c.startDignity = Math.max(1, parseInt(dig.value) || 3); };
        const dbgRow = document.createElement('div'); dbgRow.className = 'char-checkbox';
        const dbg = document.createElement('input'); dbg.type = 'checkbox'; dbg.id = 'allow-debug'; dbg.checked = c.allowDebug !== false;
        dbg.onchange = () => { c.allowDebug = dbg.checked; };
        const dl = document.createElement('label'); dl.htmlFor = 'allow-debug'; dl.textContent = 'Debug mode in exported game (turn off for release)';
        dbgRow.appendChild(dbg); dbgRow.appendChild(dl);
        return this.createDebugFieldset('Game Settings', [
            this.createDebugLabel('Start level:'), startSel,
            this.createDebugLabel('Starting dignity:'), dig,
            this.createDebugButton('ITEMS & COMBINATIONS', () => this.debug.showItems()),
            this.createDebugButton('INTERACTION (verbs, walking, default answers)', () => this.debug.showInteraction()),
            this.createDebugButton('Default lick action (all levels)', () => this.debug.showLickEditor(true)),
            dbgRow
        ]);
    },

    exportFieldset() {
        return this.createDebugFieldset('Export', [
            this.createDebugButton('EXPORT FOR LUA (PC/Android/Vita)', () => this.debug.exportLua()),
            this.createDebugButton('DOWNLOAD PROJECT (Web)', () => this.debug.downloadGameCopy()),
            this.createDebugButton('BACKUP JSON', () => this.debug.exportJSON()),
            this.createDebugLabel('Restore JSON (loads at once):'), this.fileInput('import-json-file', '.json,application/json', f => this.debug.importJSON(f))
        ]);
    },

    buildLevelDebugUI(uiLayer, statsDiv, buttonsDiv) {
        const c = this.gameConfig;
        uiLayer.classList.add('debug-active'); statsDiv.innerHTML = `<div class="debug-header">DEBUG MODE</div>`;
        const p = document.createElement("div"); p.className = "debug-box";
        this.createBtn("TOGGLE FULLSCREEN", () => this.toggleFullscreen(), "debug-btn full-width-btn", p);
        const resetModes = () => { this.editEnabled = false; this.deleteMode = false; this.editMode = false; this.placeMode = null; };
        const modeBtn = (label, prop, extra = '') => this.createBtn(`${label}: ${this[prop] ? 'ON' : 'OFF'}`, () => { const v = !this[prop]; resetModes(); this[prop] = v; this.updateUI(); }, `debug-btn ${this[prop] && extra ? extra : ''}`, p);
        modeBtn("EDIT", 'editMode', 'delete-active'); modeBtn("DRAG", 'editEnabled', 'delete-active');
        modeBtn("DELETE", 'deleteMode', 'delete-active');
        const place = (kind) => { resetModes(); this.placeMode = kind; this.updateUI(); popup.toast(`Tap the level where the new ${kind} should go`); };
        this.createBtn(this.placeMode === 'hotspot' ? "TAP TO PLACE…" : "+ HOTSPOT", () => place('hotspot'), `debug-btn ${this.placeMode === 'hotspot' ? 'delete-active' : ''}`, p);
        this.createBtn(this.placeMode === 'character' ? "TAP TO PLACE…" : "+ CHARACTER", () => place('character'), `debug-btn ${this.placeMode === 'character' ? 'delete-active' : ''}`, p);
        this.createBtn("+ LEVEL", () => this.debug.addLevel(), "debug-btn", p); this.createBtn("- LEVEL", () => this.debug.deleteLevel(), "debug-btn", p);
        this.createBtn("< LEVEL", () => this.debug.cycleLevel(-1), "debug-btn", p); this.createBtn("LEVEL >", () => this.debug.cycleLevel(1), "debug-btn", p);
        this.createBtn(String(this.placeMode).startsWith('item:') ? "TAP TO PLACE…" : "+ ITEM PICKUP", () => { resetModes(); this.debug.placePickup(); }, `debug-btn ${String(this.placeMode).startsWith('item:') ? 'delete-active' : ''}`, p);
        this.createBtn("RENAME LEVEL", () => this.debug.renameLevel(), "debug-btn", p);
        this.createBtn("EDIT LICK", () => this.debug.showLickEditor(false), "debug-btn", p);
        this.createBtn("SAVE CONFIG", () => this.debug.saveConfig(), "debug-btn full-width-btn", p);
        buttonsDiv.appendChild(p);
        this.createBtn(this.isMuted ? 'UNMUTE' : 'MUTE', () => this.toggleMute(), 'debug-btn full-width-btn reset-btn', buttonsDiv);
        this.createVolumeControls(buttonsDiv);

        // ---- level settings
        const exitDiv = document.createElement('div'); const exits = c.exits[this.scene] || (c.exits[this.scene] = []);
        exits.forEach((ex, i) => {
            const row = document.createElement('div'); row.className = 'exit-item';
            const sp = document.createElement('span'); sp.style.cssText = 'color:#fff;font-size:11px;flex:1'; sp.textContent = `➡ ${ex.target}: "${ex.text}"`; row.appendChild(sp);
            const mk = (t, title, fn) => { const b = document.createElement('button'); b.innerText = t; b.title = title; b.onclick = fn; row.appendChild(b); };
            mk('✎', 'Rename', () => this.debug.renameExit(i));
            if (i > 0) mk('▲', 'Move up', () => this.debug.moveExit(i, -1));
            if (i < exits.length - 1) mk('▼', 'Move down', () => this.debug.moveExit(i, 1));
            mk('X', 'Delete', () => { exits.splice(i, 1); this.updateUI(); });
            exitDiv.appendChild(row);
        });
        const exitControls = document.createElement('div'); const targetSelect = document.createElement('select'); targetSelect.id = 'exit-target-select';
        Object.keys(c.spawns).forEach(s => { if (s !== this.scene) { const opt = document.createElement('option'); opt.value = s; opt.innerText = s; targetSelect.appendChild(opt); } });
        exitControls.appendChild(this.createDebugLabel('Add Exit to:')); exitControls.appendChild(targetSelect); exitControls.appendChild(this.createDebugInput('text', 'exit-btn-text', 'Button Text (e.g. To Cave)'));
        const returnCheckDiv = document.createElement('div'); returnCheckDiv.className = 'char-checkbox'; returnCheckDiv.innerHTML = `<input type="checkbox" id="exit-auto-return" checked><label for="exit-auto-return">Auto-Add Return?</label>`; exitControls.appendChild(returnCheckDiv); exitControls.appendChild(this.createDebugButton('Add Connection', () => this.debug.addExit()));
        const accessDiv = this.createDebugFieldset('Level Access', [this.createDebugLabel('Followers Allowed?')]); const accCheck = document.createElement('input'); accCheck.type = "checkbox"; accCheck.checked = c.levelFollowerAccess[this.scene] !== false; accCheck.onchange = (e) => { c.levelFollowerAccess[this.scene] = e.target.checked; }; accessDiv.appendChild(accCheck);

        const bgc = c.backgrounds[this.scene] || (c.backgrounds[this.scene] = { x: 0, y: 0, scale: 1, fit: 'stretch' });
        const fitSel = document.createElement('select'); ['stretch', 'contain', 'cover'].forEach(f => { const o = document.createElement('option'); o.value = f; o.textContent = f; if ((bgc.fit || 'stretch') === f) o.selected = true; fitSel.appendChild(o); });
        fitSel.onchange = () => { bgc.fit = fitSel.value; this.navDirty = true; };
        const persp = c.perspective[this.scene] || (c.perspective[this.scene] = { axis: 'y', from: 300, to: 540, far: 0.5, near: 1.1, exp: 1 });
        const perspFields = this.createDebugFieldset('Knight Size (Depth)', ['axis', 'from', 'to', 'far', 'near', 'exp'].flatMap(k => {
            const inp = this.createDebugInput(k === 'axis' ? 'text' : 'number', `persp-${k}`, '', String(persp[k]));
            if (k !== 'axis') inp.step = (k === 'from' || k === 'to') ? '10' : '0.05';
            inp.onchange = () => { persp[k] = k === 'axis' ? (inp.value === 'x' ? 'x' : 'y') : parseFloat(inp.value); };
            return [this.createDebugLabel(k === 'axis' ? 'axis (x / y)' : k), inp];
        }));
        buttonsDiv.appendChild(this.createDebugFieldset(`Level Settings: ${this.scene}`, [
            this.createDebugLabel('Background image (applies at once):'), this.fileInput('level-bg-file', 'image/*', f => this.debug.applyLevelImage('bg', f)),
            this.createDebugButton('EDIT BG (Move/Zoom)', () => this.debug.showBackgroundEditor()),
            this.createDebugLabel('BG Fit:'), fitSel,
            this.createDebugLabel('Path image (transparent = blocked):'), this.fileInput('level-path-file', 'image/*', f => this.debug.applyLevelImage('path', f)),
            this.createDebugLabel('Foreground (optional):'), this.fileInput('level-fg-file', 'image/*', f => this.debug.applyLevelImage('fg', f)),
            this.createDebugButton('Remove foreground', () => { delete (c.images[this.scene] || {}).fg; }),
            this.createDebugLabel('Exits:'), exitDiv, exitControls, accessDiv, perspFields,
            this.createDebugLabel('Level music (plays at once):'), this.fileInput('level-music-file', 'audio/*', f => this.debug.uploadAudio(this.scene, f)),
            this.createDebugButton('Remove level music', () => this.debug.removeAudio(this.scene))
        ]));
        buttonsDiv.appendChild(this.globalAudioFieldset());
        buttonsDiv.appendChild(this.gameSettingsFieldset());
        buttonsDiv.appendChild(this.exportFieldset());
        this.createBtn("RESET ENGINE", () => this.debug.resetEngine(), "debug-btn full-width-btn reset-btn", buttonsDiv);
        this.createBtn("BACK TO TITLE (edit title screen)", () => this.backToTitle(), "", buttonsDiv);
        this.createBtn("DEB-UI: ON", () => this.toggleDebugMenu(), "", buttonsDiv);
    },

    buildTitleDebugUI(uiLayer, statsDiv, buttonsDiv) {
        const ts = this.gameConfig.titleScreen;
        uiLayer.classList.add('debug-active');
        statsDiv.innerHTML = `<div class="debug-header">TITLE SCREEN EDITOR</div>`;
        const titleIn = this.createDebugInput('text', 'title-text-input', '', ts.titleText);
        titleIn.oninput = () => { ts.titleText = titleIn.value; this.debug.updateTitleScreenElements(); };
        const showRow = document.createElement('div'); showRow.className = 'char-checkbox';
        const showCb = document.createElement('input'); showCb.type = 'checkbox'; showCb.id = 'title-show'; showCb.checked = ts.showTitleText !== false;
        showCb.onchange = () => { ts.showTitleText = showCb.checked; this.debug.updateTitleScreenElements(); };
        const showLb = document.createElement('label'); showLb.htmlFor = 'title-show'; showLb.textContent = 'Show title text';
        showRow.appendChild(showCb); showRow.appendChild(showLb);
        const btnIn = this.createDebugInput('text', 'title-btn-input', '', ts.startButtonText);
        btnIn.oninput = () => { ts.startButtonText = btnIn.value; this.debug.updateTitleScreenElements(); };
        const bgIn = this.createDebugInput('file', 'title-bg-file', 'image/*');
        bgIn.onchange = () => this.debug.applyTitleBackground(bgIn);
        buttonsDiv.appendChild(this.createDebugFieldset('Title Screen', [
            this.createDebugLabel('Title text:'), titleIn, showRow,
            this.createDebugLabel('Start button text:'), btnIn,
            this.createDebugLabel('Background image (applies at once):'), bgIn,
            this.createDebugButton('Default background', () => { ts.backgroundImage = 'assets/title.png'; this.debug.updateTitleScreenElements(); })
        ]));
        const p = document.createElement('div'); p.className = 'debug-box';
        this.createBtn("TOGGLE FULLSCREEN", () => this.toggleFullscreen(), "debug-btn full-width-btn", p);
        this.createBtn("SAVE CONFIG", () => this.debug.saveConfig(), "debug-btn", p);
        this.createBtn("EDIT LEVELS ▶", () => this.startGame(), "debug-btn", p);
        buttonsDiv.appendChild(p);
        buttonsDiv.appendChild(this.globalAudioFieldset());
        buttonsDiv.appendChild(this.gameSettingsFieldset());
        buttonsDiv.appendChild(this.exportFieldset());
        this.createBtn("RESET ENGINE", () => this.debug.resetEngine(), "debug-btn full-width-btn reset-btn", buttonsDiv);
        this.createBtn("DEB-UI: ON", () => this.toggleDebugMenu(), "", buttonsDiv);
        this.debug.updateTitleScreenElements();
    },

    createBtn(t, c, cl = '', p = null) { const b = document.createElement("button"); b.innerText = t; b.onclick = c; if (cl) b.className = cl; (p || document.getElementById("buttons")).appendChild(b); return b; },
    createVolumeControls(parentDiv) {
        const box = document.createElement("div"); box.className = "slider-group";
        const makeS = (l, v, cb) => { const lb = document.createElement("label"); lb.innerText = l; const s = document.createElement("input"); s.type = "range"; s.min = 0; s.max = 1; s.step = 0.01; s.value = v; s.oninput = (e) => cb(parseFloat(e.target.value)); box.appendChild(lb); box.appendChild(s); };
        makeS("Music", this.musicVolume, (v) => { this.musicVolume = v; const m = this.audioCache.get('music'); if (m) m.volume = v; });
        makeS("Ambience", this.ambVolume, (v) => { this.ambVolume = v; for (const [k, a] of this.audioCache) if (this.gameConfig.spawns[k]) a.volume = v; });
        makeS("SFX", this.sfxVolume, (v) => { this.sfxVolume = v; const c = this.audioCache.get('click'); if (c) c.volume = v; });
        parentDiv.appendChild(box);
    },
    createDebugFieldset(l, el) { const f = document.createElement('fieldset'); const lg = document.createElement('legend'); lg.textContent = l; f.appendChild(lg); el.forEach(e => f.appendChild(e)); return f; },
    createDebugLabel(t) { const l = document.createElement('label'); l.textContent = t; return l; },
    createDebugInput(t, i, p, v = '') { const inp = document.createElement('input'); inp.type = t; inp.id = i; if (t === 'file' && p) inp.accept = p; else if (p) inp.placeholder = p; if (v) inp.value = v; return inp; },
    createDebugButton(t, c) { const b = document.createElement('button'); b.textContent = t; b.onclick = c; return b; },

    toggleDebugMenu() {
        this.debugMode = !this.debugMode;
        document.getElementById('uiLayer').classList.toggle('hidden', !this.debugMode && !this.isGameRunning);
        if (!this.debugMode) { this.editEnabled = false; this.deleteMode = false; this.editMode = false; this.placeMode = null; }
        // debug on the title screen = title screen editor (title shown at its real in-game size)
        document.getElementById('startScreen').classList.toggle('debug-title', this.debugMode && !this.isGameRunning);
        if (this.debugMode) this.generateNavGrid();
        this.updateUI();
    },
};

Object.assign(engine, adventure);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => engine.init());
else engine.init();
