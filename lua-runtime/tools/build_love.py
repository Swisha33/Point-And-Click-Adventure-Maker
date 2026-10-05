#!/usr/bin/env python3
"""
Pack the exported Lua game into dist/SirLicks.love (LÖVE 11.x).

Usage (inside the exported game folder):
    python tools/build_love.py

PC:      love dist/SirLicks.love            (or drag the file onto love.exe)
Android: open the .love with the "LÖVE for Android" app, or build an APK with
         love-android (put the file in app/src/embed/assets/game.love).
"""
import os, sys, zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKIP_DIRS = {"tools", "dist", ".git", "sce_sys"}
SKIP_EXT = {".md", ".vpk", ".bin", ".py", ".love"}


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "SirLicks"
    out = os.path.join(ROOT, "dist", name + ".love")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(ROOT):
            rel_base = os.path.relpath(base, ROOT)
            dirs[:] = [d for d in dirs if not (rel_base == "." and d in SKIP_DIRS)]
            for f in files:
                if os.path.splitext(f)[1].lower() in SKIP_EXT:
                    continue
                full = os.path.join(base, f)
                z.write(full, os.path.relpath(full, ROOT).replace(os.sep, "/"))
                count += 1
    print(f"OK -> {out}  ({count} files, {os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
