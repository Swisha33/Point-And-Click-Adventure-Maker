#!/usr/bin/env python3
"""
Build a PS Vita .vpk from the exported Lua game (Lua Player Plus Vita runtime).

Usage (run inside the exported game folder, the one with index.lua):
    python tools/build_vita.py --eboot path/to/eboot_safe.bin

Get eboot_safe.bin from the lpp-vita releases on GitHub (Rinnegatamante/lpp-vita).

What it does:
  * writes sce_sys/param.sfo (title + title id), icon and LiveArea images
  * converts audio to OGG Vorbis (lpp-vita can't open MP3 files without an ID3 tag) - needs ffmpeg
  * downscales very large images (the engine knows the original sizes, so nothing moves)
  * packs everything into dist/<name>.vpk  -> install with VitaShell

Needs: Python 3.8+, Pillow (pip install pillow), ffmpeg in PATH (for audio).
"""
import argparse, io, os, re, shutil, struct, subprocess, sys, zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GAME_DIRS = ["engine", "platform", "game", "assets", "media"]
GAME_FILES = ["index.lua"]

try:
    from PIL import Image
except ImportError:
    Image = None


# ---------------------------------------------------------------- param.sfo
def make_sfo(title, title_id, version="01.00"):
    entries = [  # (key, value, max_len) ; int values use max_len 4
        ("APP_VER", version, 8),
        ("ATTRIBUTE", 0x8000, 4),
        ("ATTRIBUTE2", 0, 4),
        ("ATTRIBUTE_MINOR", 0x10, 4),
        ("BOOT_FILE", "", 32),
        ("CATEGORY", "gd", 4),
        ("CONTENT_ID", "", 48),
        ("EBOOT_APP_MEMSIZE", 0, 4),
        ("EBOOT_ATTRIBUTE", 0, 4),
        ("EBOOT_PHY_MEMSIZE", 0, 4),
        ("LAREA_TYPE", 0, 4),
        ("NP_COMMUNICATION_ID", "", 16),
        ("PARENTAL_LEVEL", 0, 4),
        ("PSP2_DISP_VER", "00.000", 8),
        ("PSP2_SYSTEM_VER", 0, 4),
        ("STITLE", title[:51], 52),
        ("TITLE", title[:127], 128),
        ("TITLE_ID", title_id, 12),
        ("VERSION", "00.00", 8),
    ]
    entries.sort(key=lambda e: e[0])
    keys, data, index = b"", b"", b""
    for key, val, maxlen in entries:
        koff = len(keys)
        keys += key.encode() + b"\0"
        doff = len(data)
        if isinstance(val, int):
            raw, fmt, dlen = struct.pack("<I", val), 0x0404, 4
        else:
            raw = val.encode("utf-8") + b"\0"
            fmt, dlen = 0x0204, len(raw)
            if dlen > maxlen:
                raise ValueError(f"{key} too long")
        data += raw + b"\0" * (maxlen - len(raw))
        index += struct.pack("<HHIII", koff, fmt, dlen, maxlen, doff)
    while len(keys) % 4:
        keys += b"\0"
    key_start = 20 + len(index)
    data_start = key_start + len(keys)
    header = b"\0PSF" + struct.pack("<IIII", 0x0101, key_start, data_start, len(entries))
    return header + index + keys + data


# ---------------------------------------------------------------- livearea images (8-bit palette PNGs required)
def paletted_png(img, size, mode="cover"):
    img = img.convert("RGBA")
    W, H = size
    s = max(W / img.width, H / img.height) if mode == "cover" else min(W / img.width, H / img.height)
    im = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 255))
    canvas.alpha_composite(im, ((W - im.width) // 2, (H - im.height) // 2))
    out = io.BytesIO()
    canvas.convert("RGB").quantize(colors=256, method=Image.MEDIANCUT).save(out, "PNG", optimize=True)
    return out.getvalue()


TEMPLATE_XML = """<?xml version="1.0" encoding="utf-8"?>
<livearea style="a1" format-ver="01.00" content-rev="1">
  <livearea-background>
    <image>bg.png</image>
  </livearea-background>
  <gate>
    <startup-image>startup.png</startup-image>
  </gate>
</livearea>
"""


def find_title_image(config_text):
    m = re.search(r'backgroundImage\s*=\s*"([^"]+)"', config_text)
    return m.group(1) if m else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--eboot", help="lpp-vita eboot_safe.bin (or eboot.bin)")
    ap.add_argument("--title", default="Sir Licks-a-Lot")
    ap.add_argument("--title-id", default="SLAL00001", help="9 chars: 4 capital letters + 5 digits")
    ap.add_argument("--max-image", type=int, default=1024, help="downscale images whose longest side is bigger (0 = never)")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    if not re.fullmatch(r"[A-Z]{4}\d{5}", a.title_id):
        sys.exit("title id must look like ABCD12345")
    eboot = a.eboot
    if not eboot:
        for cand in ["eboot_safe.bin", "eboot.bin", "tools/eboot_safe.bin", "tools/eboot.bin"]:
            if os.path.isfile(os.path.join(ROOT, cand)):
                eboot = os.path.join(ROOT, cand)
                break
    if not eboot or not os.path.isfile(eboot):
        sys.exit("eboot not found. Download eboot_safe.bin from the lpp-vita GitHub releases and pass --eboot <file>.")
    if Image is None:
        sys.exit("Pillow missing:  pip install pillow")

    cfg_path = os.path.join(ROOT, "game", "config.lua")
    config_text = open(cfg_path, encoding="utf-8").read()

    out = a.out or os.path.join(ROOT, "dist", re.sub(r"[^A-Za-z0-9_-]+", "_", a.title) + ".vpk")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    have_ffmpeg = shutil.which("ffmpeg") is not None
    warnings = []

    z = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
    z.write(eboot, "eboot.bin")
    z.writestr("sce_sys/param.sfo", make_sfo(a.title, a.title_id))

    title_img = find_title_image(config_text)
    src = Image.open(os.path.join(ROOT, title_img)) if title_img and os.path.isfile(os.path.join(ROOT, title_img)) else Image.new("RGB", (256, 256), (139, 0, 0))
    z.writestr("sce_sys/icon0.png", paletted_png(src, (128, 128)))
    z.writestr("sce_sys/livearea/contents/bg.png", paletted_png(src, (840, 500)))
    z.writestr("sce_sys/livearea/contents/startup.png", paletted_png(src, (280, 158)))
    z.writestr("sce_sys/livearea/contents/template.xml", TEMPLATE_XML)

    # sprite sheets are never scaled: frames must stay pixel exact
    sprites = set(m.group(2) for m in re.finditer(r'\b(customImage|image)\s*=\s*"([^"]+)"', config_text))
    renamed = {}
    for top in GAME_FILES:
        z.write(os.path.join(ROOT, top), top)
    for d in GAME_DIRS:
        if not os.path.isdir(os.path.join(ROOT, d)):
            continue
        for base, _, files in os.walk(os.path.join(ROOT, d)):
            for f in sorted(files):
                full = os.path.join(base, f)
                rel = os.path.relpath(full, ROOT).replace(os.sep, "/")
                if rel == "game/config.lua":
                    continue
                ext = f.lower().rsplit(".", 1)[-1]
                if ext in ("mp3", "wav", "m4a", "aac", "flac", "opus") or (ext == "ogg" and b"vorbis" not in open(full, "rb").read(64)):
                    new_rel = rel.rsplit(".", 1)[0] + ".ogg"
                    if not have_ffmpeg:
                        warnings.append(f"ffmpeg missing - {rel} copied unchanged (may not play on Vita)")
                        z.write(full, rel)
                        continue
                    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", full, "-vn", "-c:a", "libvorbis", "-q:a", "4", "-f", "ogg", "-"],
                                       capture_output=True)
                    if r.returncode != 0:
                        warnings.append(f"could not convert {rel}: {r.stderr.decode(errors='ignore')[:200]}")
                        z.write(full, rel)
                        continue
                    z.writestr(new_rel, r.stdout)
                    renamed[rel] = new_rel
                elif ext in ("png", "jpg", "jpeg", "bmp") and a.max_image > 0:
                    im = Image.open(full)
                    longest = max(im.size)
                    known = f'["{rel}"]' in config_text   # authored size is in config.imageSizes
                    if longest > a.max_image and known and rel not in sprites:
                        s = a.max_image / longest
                        im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
                        buf = io.BytesIO()
                        im.save(buf, "PNG" if ext == "png" else "JPEG", quality=92)
                        z.writestr(rel, buf.getvalue())
                    else:
                        if longest > 2048:
                            warnings.append(f"{rel} is {im.size} and not listed in imageSizes - kept full size")
                        z.write(full, rel)
                else:
                    z.write(full, rel)

    for old, new in renamed.items():
        config_text = config_text.replace(f'"{old}"', f'"{new}"')
    z.writestr("game/config.lua", config_text)
    z.close()

    for w in warnings:
        print("WARNING:", w)
    print(f"OK -> {out}  ({os.path.getsize(out) // 1024} KB)")
    print("Copy it to the Vita (e.g. ux0:/vpk/) and install it with VitaShell.")


if __name__ == "__main__":
    main()
