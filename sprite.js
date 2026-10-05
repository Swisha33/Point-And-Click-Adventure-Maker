// Sprite sheets + animations, shared by the game and the editor.
// The Lua engine (lua-runtime/engine/game.lua) uses exactly the same rules.
//
// A sprite object (character hotspot, cfg.player or cfg.knight) may have:
//   customImage | image     the sprite sheet
//   cols, rows              grid of the sheet (frame = sheet size / grid)
//   frameWidth, frameHeight frame size in pixels (written by the editor, = sheet / grid)
//   sheetX, sheetY          offset of the grid inside the sheet
//   dirs                    true = use the _up / _down animations when walking up or down (top-down games)
//   anims = { idle, walk, run, idle_up, walk_up, run_up, idle_down, walk_down, run_down }
//     each: { row, col, frames, speed, image?, cols?, rows? }
//     row/col = first frame (0-based) in the grid; frames continue left→right, then on the next row
//     image   = optional separate sheet with its own grid (cols × rows) instead of the main sheet
// Older projects: idle = first frame (player) / looping all frames (characters), walk = row 0,
// run = walk played faster.

export const BASE_ANIMS = ['idle', 'walk', 'run'];
export const DIR_ANIMS = ['idle_up', 'walk_up', 'run_up', 'idle_down', 'walk_down', 'run_down'];
export const ANIM_LABELS = {
    idle: 'Idle', walk: 'Walk', run: 'Run',
    idle_up: 'Idle ↑', walk_up: 'Walk ↑', run_up: 'Run ↑', idle_down: 'Idle ↓', walk_down: 'Walk ↓', run_down: 'Run ↓'
};

export function spriteInfo(o, kind, sizeOf) {
    const image = o.customImage || o.image;
    const sz = sizeOf(image) || { w: o.frameWidth || 100, h: o.frameHeight || 100 };
    const total = o.totalFrames || o.frames || o.cols || 1;
    const cols = o.cols || (o.frameWidth ? Math.max(1, Math.round(sz.w / o.frameWidth)) : total);
    const rows = o.rows || (o.frameHeight ? Math.max(1, Math.round(sz.h / o.frameHeight)) : 1);
    const fw = o.frameWidth || sz.w / cols;
    const fh = o.frameHeight || sz.h / rows;
    const speed = o.animSpeed || (kind === 'player' ? 6 : 10);
    const a = o.anims || {};
    const norm = (src, def) => Object.assign({ row: 0, col: 0 }, def, src || {});
    const anims = {
        idle: norm(a.idle, { frames: kind === 'player' ? 1 : total, speed }),
        walk: norm(a.walk, { frames: total, speed })
    };
    anims.run = a.run ? norm(a.run, {}) : Object.assign({}, anims.walk, { speed: Math.max(1, Math.round(anims.walk.speed * 0.6)) });
    if (o.dirs) DIR_ANIMS.forEach(n => { if (a[n]) anims[n] = norm(a[n], { frames: 1, speed }); });
    return { image, cols, rows, fw, fh, sheetX: o.sheetX || 0, sheetY: o.sheetY || 0, anims, dirs: !!o.dirs };
}

// which animation to play: base = idle | walk | run, dir = side | up | down
// returns { name, mirrorOk }: up/down views are never mirrored
export function pickAnim(info, base, dir) {
    if (info.dirs && (dir === 'up' || dir === 'down')) {
        const n = base + '_' + dir;
        if (info.anims[n]) return { name: n, mirrorOk: false };
    }
    return { name: info.anims[base] ? base : 'idle', mirrorOk: true };
}

// grid of the sheet an animation uses
export function animGrid(info, a, sizeOf) {
    if (a && a.image) {
        const s = sizeOf(a.image);
        if (s) {
            const cols = a.cols || Math.max(1, Math.floor(a.frames) || 1), rows = a.rows || 1;
            return { path: a.image, cols, fw: s.w / cols, fh: s.h / rows, ox: 0, oy: 0 };
        }
    }
    return { path: info.image, cols: info.cols, fw: info.fw, fh: info.fh, ox: info.sheetX, oy: info.sheetY };
}

// source rectangle of the current frame + draw size factor (keeps the height of the main frame,
// so a separate sheet with another resolution does not change the character's size)
export function spriteFrame(info, animName, tick, sizeOf) {
    const a = info.anims[animName] || info.anims.idle;
    const frames = Math.max(1, Math.floor(a.frames) || 1);
    const i = frames > 1 ? Math.floor(tick / Math.max(1, a.speed || 10)) % frames : 0;
    const g = animGrid(info, a, sizeOf);
    const idx = (a.row || 0) * g.cols + (a.col || 0) + i;
    const c = idx % g.cols, r = Math.floor(idx / g.cols);
    return {
        path: g.path,
        sx: Math.round(g.ox + c * g.fw), sy: Math.round(g.oy + r * g.fh),
        sw: Math.round(g.fw), sh: Math.round(g.fh), k: info.fh / g.fh
    };
}

// movement direction from a movement vector (top-down games)
export function moveDir(dx, dy, prev = 'side') {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return prev;
    if (Math.abs(dy) > Math.abs(dx) * 1.3) return dy < 0 ? 'up' : 'down';
    return 'side';
}
