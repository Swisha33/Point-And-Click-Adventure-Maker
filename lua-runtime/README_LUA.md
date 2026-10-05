# Sir Licks-a-Lot – Lua-Version (PC · Android · PS Vita)

Dieser Ordner ist das **fertige Spiel** für die Lua-Engine. Erzeugt wird er im
Browser-Editor über **DEBUG → Export → EXPORT FOR LUA**.

```
index.lua            Startdatei für die PS Vita (Lua Player Plus Vita)
main.lua, conf.lua   Startdateien für LÖVE (PC, Android)
engine/              Spiel-Logik (für alle Plattformen gleich)
  game.lua           Szenen, Laufen, Hotspots, Dialoge, Follower, UI, Debug
  nav.lua            Laufraster + A*-Wegsuche
  util.lua           Hilfsfunktionen (Kopieren, Speichern als Lua)
platform/love.lua    Zeichnen/Sound/Dateien für LÖVE
platform/vita.lua    Zeichnen/Sound/Dateien für lpp-vita
game/config.lua      dein Projekt (Level, Hotspots, Dialoge …) aus dem Editor
assets/              Bilder, Sounds, Schrift
tools/               Build-Skripte (.love und .vpk)
```

## PC (Windows/Linux/macOS)

1. LÖVE 11.4 oder 11.5 installieren: https://love2d.org
2. Den Ordner auf `love.exe` ziehen (oder `love .` im Ordner ausführen).
3. Zum Weitergeben: `python tools/build_love.py` → `dist/SirLicks.love`

## Android

- **Schnell testen:** App „LÖVE for Android“ installieren (APK von love2d.org),
  `dist/SirLicks.love` aufs Handy kopieren und damit öffnen.
- **Eigene APK:** Projekt `love-android` (GitHub love2d/love-android) klonen,
  `SirLicks.love` als `app/src/embed/assets/game.love` ablegen und mit
  Android Studio / Gradle die Variante *embedNoRecord* bauen.

Touch funktioniert direkt (Tippen = Klicken). Die Zurück-Taste klappt das Menü ein/aus.

## PS Vita (HENkaku/Ensō + VitaShell nötig)

1. Von https://github.com/Rinnegatamante/lpp-vita/releases die Datei
   **eboot_safe.bin** laden und in diesen Ordner (oder `tools/`) legen.
2. Python 3 + Pillow (`pip install pillow`) und **ffmpeg** installieren.
3. `python tools/build_vita.py --eboot eboot_safe.bin`
   → `dist/Sir_Licks-a-Lot.vpk`
4. VPK auf die Vita kopieren (z. B. per FTP nach `ux0:/vpk/`) und in VitaShell installieren.

Das Skript wandelt alle Sounds in OGG um (lpp-vita kann MP3-Dateien ohne ID3-Tag
nicht öffnen) und verkleinert sehr große Bilder auf max. 1024 px. Die Engine kennt
die Originalgrößen (`imageSizes` in config.lua), dadurch verrutscht nichts.
Titel/Title-ID ändern: `--title "Mein Spiel" --title-id ABCD12345`.

### Steuerung Vita
| Taste | Funktion |
|---|---|
| Touchscreen | tippen = klicken, ziehen = ziehen (Debug) |
| linker Stick / Steuerkreuz | Cursor bewegen |
| ✕ | klicken |
| △ oder START | Seitenmenü ein/aus |
| ◯ | zurück / Menü |
| SELECT | Editor (oder Dignity-Feld gedrückt halten) |

## Versteckter Editor im Spiel (= Maker auf dem Gerät)

**Dignity-Feld im Seitenmenü 1 Sekunde gedrückt halten** · F2 (PC) · SELECT (Vita).

- SELECT/EDIT: Objekt antippen → Name, Hitbox, Form, **PICTURE FROM FILES**, Bildgröße, Nähe-Einblenden,
  versteckt starten, hinlaufen, spiegeln, löschen
- MOVE (Hotspots, Text, Spawn, grüne Laufpunkte), + HOTSPOT, + PICKUP, DELETE
- **+ LEVEL** (neues Level, Hintergrund aus dem Speicher), **BACKGROUND**, **WALK AREA** (Laufbereich malen)
- **EXITS** (Ausgang-Buttons + automatischer Rückweg)
- **UI LAYOUT**: Titelbild / HUD / Menüs bearbeiten – Element antippen und ziehen, grüne Ecke = Größe,
  + BUTTON / + TEXT / + PICTURE / + NEW MENU, Text, Funktion (◀ ▶), Ziel-Szene/-Menü, Bild aus dem Speicher,
  Einpassen, Schrift, Farben, kopieren, löschen. „PANEL >>“ schiebt das Editor-Menü auf die andere Seite.
- **PLUGINS**: Werkzeuge der installierten Plugins
- **SPRITE EDITOR** (Vita): startet eine installierte App per Title-ID, z. B. deine LibreSprite-Portierung
  (vorher wird gespeichert). Danach das Bild mit PICTURE FROM FILES holen.

Bilder suchen: Vita `ux0:data/SirLicks/images`, `ux0:picture`, `ux0:data`, ganzer Speicher ·
PC: Bild ins Fenster ziehen (landet im LÖVE-Speicherordner unter `images/`) · Android: `images/` im Speicherordner.

**SAVE EDITS** speichert im Speicherordner (`config_edit.lua`; Vita: `ux0:/data/SirLicks/`). **RESET EDITS** löscht das wieder.
Ausschalten für die fertige Version: `allowDebug = false` in `game/config.lua`.
Dialoge / Reaktionen macht man weiter im Browser-Editor.

## Plugins

Der Export legt aktivierte Plugins nach `plugins/<id>/game.lua`; die Engine lädt sie beim Start
(Fehler erscheinen als Meldung, das Spiel läuft weiter). Siehe `PLUGINS.md` im Web-Projekt.

## Hinweise

- Auflösung intern 960×540 (Vita: 960×544, 2 px Rand oben/unten); LÖVE skaliert
  auf jede Fenstergröße mit schwarzem Rand.
- Lua-Version: LuaJIT/5.1-kompatibel (LÖVE und lpp-vita nutzen beide LuaJIT),
  läuft zusätzlich unter Lua 5.3.
