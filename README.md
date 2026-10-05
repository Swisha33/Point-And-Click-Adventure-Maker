# Sir Licks-a-Lot – Point & Click Maker (repariert)

## Starten

Den Ordner wie bisher mit **Live Server** (VS Code) oder einem anderen lokalen
Webserver öffnen, z. B. `python -m http.server` und dann http://localhost:8000.
(Direkt per Doppelklick auf index.html geht nicht, weil ES-Module einen Server brauchen.)

- **⚙️ DEBUG** auf dem Titelbild oder **F2** öffnet den Editor.
- **SAVE CONFIG** speichert im Browser (IndexedDB, kein 5-MB-Limit mehr).
- **Export → EXPORT FOR LUA** erzeugt `SirLicks_Lua.zip`: das fertige Spiel für
  PC/Android (LÖVE) und PS Vita (lpp-vita). Anleitung: `lua-runtime/README_LUA.md`.
- **DOWNLOAD PROJECT (Web)** sichert das ganze Projekt als ZIP (inkl. deiner Änderungen in config.js).
- **BACKUP JSON / Import JSON**: Projektstand sichern und wiederherstellen.

## Was kaputt war und was repariert ist

| Problem | Ursache | Fix |
|---|---|---|
| Editor-Dialoge (Speichern, Abbrechen, Bild laden …) taten nichts | `index.html` war ein Schnappschuss der laufenden Seite (alter „DOWNLOAD PLAYABLE“ speicherte `outerHTML`). Die Dialoge existierten schon, deshalb wurden keine Klick-Handler mehr angehängt | saubere `index.html`; Dialoge werden immer neu erzeugt und verdrahtet; Projekt-Download nimmt die Quelldateien, nie mehr das DOM |
| Startbildschirm unsichtbar, Debug-Panel ohne Funktion | ebenfalls Schnappschuss (Klassen `hidden`/`debug-active` eingefroren) | wie oben |
| Export ging nicht mehr („JSZip library not loaded“) | Script-Tag wurde beim Speichern per Regex entfernt | JSZip liegt jetzt lokal in `vendor/` |
| Live-Server-Reload-Code in index.html | mitgespeichert | entfernt |
| Brücke & Turm fehlten in config.js | gingen beim letzten Export verloren | wiederhergestellt (Ausgänge Dorf ↔ Brücke ↔ Turm, Spawnpunkte neu gesetzt) |
| Eigene Hintergründe/Pfadbilder nach Neuladen weg | wurden nur im Speicher gehalten, nie in der Config | stehen jetzt in `images[level]` und werden gespeichert/exportiert |
| „Saved!“ kam nicht / Speichern scheiterte still | Bilder/Sounds als Base64 sprengen localStorage (5 MB) | IndexedDB + Fehlermeldung |
| Laufbereich falsch nach „EDIT BG“ | Pfadmaske ignorierte Verschieben/Zoom des Hintergrunds | gleiche Platzierung für Bild und Maske |
| Musik stumm | Startlautstärke war 0 | 50 % |
| `music.wav`/`click.wav` | waren in Wahrheit MP3s | in `.mp3` umbenannt |
| Followers verschwanden beim Speichern | lagen beim Speichern in einer Hilfsliste | werden beim Speichern an ihren Platz zurückgelegt |
| Hotspot ohne gewähltes Bild bekam riesiges Orb-Sprite | Editor speicherte die Vorschau-URL | nur echte, gewählte Bilder werden gespeichert |
| Klick-Kreis doppelt, `scroll.png`/`button.png` 404 | – | bereinigt, Buttons per CSS |
| Game Over lud die Seite neu | `location.reload()` | „GAME OVER“-Bildschirm, dann zurück zum Titel |

## Neu im Editor

**Update 6**
- Texte bleiben stehen, bis man tippt (▼-Hinweis); abschaltbar unter INTERACTION.
- Pro Hotspot: **„Only visible when near“** – auch Hotspots mit eigenem Bild blenden sich wie normale Hotspots erst in der Nähe (Zeiger oder Ritter) ein. Standard: an für Hotspots, aus für Figuren.
- **Inventar einklappbar** (◀ am Ende der Leiste, „ITEMS ▶ n“ zum Öffnen).
- **+ ITEM PICKUP** im Debug-Panel: Gegenstand wählen, ins Level tippen → liegt dort mit Icon; Use = aufheben (verschwindet), Look = Beschreibung.
- **Größen konsistent**: Figuren behalten beim Folgen ihre Größe und wachsen/schrumpfen dann mit der Tiefe wie der Ritter. Eigene Spielerfigur: Editor-Größe am Spawnpunkt, dann Tiefe.
- **.love / Vita: versteckter Editor** – kein DEBUG-Button mehr; **Dignity-Feld 1 s gedrückt halten** (oder F2 / SELECT). Modi: SELECT/EDIT (Name per Tastatur, Hitbox, Form, Bildgröße, Nähe-Einblenden, versteckt, Hinlaufen, Spiegeln, Löschen), MOVE (Hotspots, Text, Spawn, Laufpunkte), + HOTSPOT, + ITEM PICKUP, DELETE, Level wechseln, Raster, SAVE/RESET EDITS. Reaktionen & Dialoge bleiben im Web-Editor.

**Update 5 – Adventure-System** (läuft gleich im Browser, LÖVE und auf der Vita)
- **Inventar & Gegenstände**: Game Settings → ITEMS & COMBINATIONS (Name, Icon, Beschreibung). Im Spiel: Gegenstand antippen = in die Hand nehmen, dann auf Hotspot tippen = benutzen, auf anderen Gegenstand = kombinieren, nochmal auf sich selbst = ansehen.
- **Reaktionen** im EDIT-Fenster: Auslöser (Look / Talk / Use / Gegenstand benutzen), Bedingungen („nur wenn“ Flag/Gegenstand), Sätze, Aktionen (Gegenstand geben/nehmen, Flag setzen, Hotspot zeigen/verstecken, Ausgang freischalten, Level wechseln, Würde, Sound, Figur folgt).
- **Gesprächsoptionen** (Antwortauswahl) mit „nur einmal“, „beendet Gespräch“, Bedingungen; „Goodbye“ kommt automatisch.
- **Verben**: Antippen öffnet Look / Talk / Use (oder „Simple“-Modus: ein Tipp). Einstellbar unter INTERACTION, inkl. Standardantworten.
- **Erst hinlaufen, dann handeln**: grüner ◆ Laufpunkt pro Hotspot im DRAG-Modus verschiebbar; „Act without walking“ pro Hotspot.
- **Speichern/Laden**: 3 Slots + Autosave bei jedem Levelwechsel; „Continue“ / „Load Game“ auf dem Titelbild.
- **Demo-Rätsel** im Standardprojekt: Briefkasten → Glas, Ente → Fliege, Glas + Fliege kombinieren, dem Frosch geben → Schlüssel, Schlüssel beim Troll → Weg zum Turm.

**Update 4 – Animationen**
- Sprite-Sheets als **Raster (Spalten × Zeilen)**; die Framegröße wird daraus berechnet. Skalieren (auch Pinch im „Frame“-Modus) ändert nur noch die Größe, nie mehr den Bildausschnitt → Animation bleibt sauber.
- **Idle- und Walk-Animation** für Spieler und Figuren (Walk bei Followern): je Zeile im Sheet, Anzahl Frames, Tempo – oder ein **eigenes Bild** (Streifen) pro Animation.
- Raster wird beim Hochladen **automatisch erkannt** (Lücken zwischen Frames oder Wiederholungsmuster).
- Vita-Build verkleinert Sprite-Sheets nicht mehr.

**Update 3**
- **+ HOTSPOT / + CHARACTER**: danach ins Level tippen – das Objekt landet genau dort.
- **Sound im EDIT-Fenster** (Auswahl, ▶ Probehören, neue Datei hinzufügen). Der SOUND-Modus ist weg.
- **Dialogzeilen** direkt bearbeiten, umsortieren (▲▼), Sprecher und Effekt (angry = wackeln, calm = schweben) wählen; „Flip speech bubble“.
- **RENAME LEVEL** (alle Verweise werden mit umbenannt), Ausgänge umbenennen ✎ und sortieren ▲▼; neue Rückwege heißen „To Village“ statt „To village“.
- **Game Settings**: Startlevel, Start-Würde, Standard-Leck-Aktion für alle Level, Debug im Export an/aus. EDIT LICK hat „Use default“.
- **Uploads wirken sofort** (kein Apply-Button mehr); Level-Musik spielt sofort.
- **Hochgeladene Dateien** liegen jetzt einzeln im Browser-Speicher statt in der Config → Speichern ist schnell. Hintergründe > 2048 px werden verkleinert (Sprite-Sheets nie).
  BACKUP JSON packt alles in eine Datei; Restore lädt sie direkt.
- **RESET ENGINE** fragt: Abbrechen / erst Backup, dann löschen / ohne Backup löschen.
- **DRAG** mit Touch: größere Greifbereiche, Objekt springt nicht mehr unter den Finger.

- **DEBUG auf dem Titelbild = Titelbild-Editor** (Titeltext, Button-Text, Hintergrundbild). „EDIT LEVELS ▶“ wechselt in die Level.
- **EDIT** (ein Modus für alles): Spieler, Figur oder Hotspot antippen → passender Editor. „SET IMG“ und „EDIT PLAYER“ sind darin aufgegangen.
- **Exit / Discovery** im Hotspot-Editor: Hotspot schaltet einen Ausgang-Button frei oder ist eine Tür (hinlaufen → Levelwechsel). Funktioniert auch im Lua-Export.
- **Gesten** im Editor-Vorschaufenster und im BG-Editor: 1 Finger ziehen, 2 Finger zoomen, am PC Mausrad.
- Meldungen/Rückfragen erscheinen im Spiel statt als Browser-Fenster (Vollbild bleibt an).

- Level wechseln: **< LEVEL / LEVEL >**
- Pro Level: **BG Fit** (stretch/contain/cover), **Vordergrund-Bild**, **Knight Size (Depth)**
  (die vorher fest eingebaute Größenformel je Level ist jetzt einstellbar)
- Touch-Bedienung im Browser
- Figuren werden nach Y-Position sortiert gezeichnet (Ritter kann hinter/vor NPCs laufen)

## Ordner

```
index.html, style.css, game.js, editor.js, config.js   Web-Editor
assets/                                                Bilder, Sounds, Schrift
vendor/jszip.min.js                                    ZIP-Bibliothek (offline)
lua-runtime/                                           Lua-Engine + Build-Skripte (geht in den Export)
```
