// Sprite sheets + animations, shared by the game and the editor.
// The Lua engine (lua-runtime/engine/game.lua) uses exactly the same rules.
//
// A sprite object (character hotspot, cfg.player or cfg.knight) may have:
//   customImage | image     the sprite sheet
//   cols, rows              grid of the sheet (frame = sheet size / grid)
//   frameWidth, frameHeight frame size in pixels (written by the editor, = sheet / grid)
//   sheetX, sheetY          offset of the grid inside the sheet
//   anims = { idle: {row, frames, speed, image?}, walk: {row, frames, speed, image?} }
//     row    = which grid row the animation uses
//     image  = optional separate sheet (one row, `frames` columns) instead of the main sheet
// Older projects without `anims` get: idle = first frame (player) / looping all frames (characters),
// walk = all frames of row 0.

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
    return {
        image, cols, rows, fw, fh,
        sheetX: o.sheetX || 0, sheetY: o.sheetY || 0,
        anims: {
            idle: Object.assign({ row: 0, frames: kind === 'player' ? 1 : total, speed }, a.idle || {}),
            walk: Object.assign({ row: 0, frames: total, speed }, a.walk || {})
        }
    };
}

// source rectangle of the current frame + draw size factor (keeps the height of the main frame,
// so a separate idle sheet with another resolution does not change the character's size)
export function spriteFrame(info, animName, tick, sizeOf) {
    const a = info.anims[animName] || info.anims.idle;
    const frames = Math.max(1, Math.floor(a.frames) || 1);
    const i = frames > 1 ? Math.floor(tick / Math.max(1, a.speed || 10)) % frames : 0;
    if (a.image) {
        const s = sizeOf(a.image);
        if (s) {
            const w = s.w / frames;
            return { path: a.image, sx: Math.round(i * w), sy: 0, sw: Math.round(w), sh: s.h, k: info.fh / s.h };
        }
    }
    return {
        path: info.image,
        sx: Math.round(info.sheetX + i * info.fw), sy: Math.round(info.sheetY + (a.row || 0) * info.fh),
        sw: Math.round(info.fw), sh: Math.round(info.fh), k: 1
    };
}
